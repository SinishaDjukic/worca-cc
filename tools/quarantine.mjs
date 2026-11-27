#!/usr/bin/env node
// tools/quarantine.mjs — the quarantine list (test/quarantine.json): a test file, Playwright spec or CDP proof that is
// distrusted leaves its blocking job and runs in the non-blocking Quarantined tests workflow
// (.github/workflows/quarantine.yml) instead, with its reason, its exit condition and a pass rate over the last runs.
// tools/test.mjs leaves quarantined test files out of every tier, e2e/extension/playwright.config.mjs ignores
// quarantined specs, and ci.yml's cdp loop skips quarantined proofs (`skips-proof`).
// node: builtins only: the Playwright config imports this file.
//
// CLI: node tools/quarantine.mjs COMMAND [--root DIR]
//   list --kind test|spec|proof            the listed paths of that kind, one per line
//   skips-proof NAME                       exit 0 when npm script NAME's proof is listed, 1 otherwise
//   run --kind test|spec|proof --out FILE  run each entry of that kind, write { [path]: { result, seconds } }
//   report --results FILE... --history-in DIR --history-out FILE --run-id ID --sha SHA --event EVENT
//                                          union the histories in DIR (and its per-run subfolders) by runId, add
//                                          this run's results and write the job summary
// A failing entry never fails the tool: it exits 2 only on bad usage or an invalid list.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const QUARANTINE_FILE = 'test/quarantine.json';
export const HISTORY_MAX = 30;

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENTRY_TIMEOUT_MS = 15 * 60_000;
const KEYS = ['path', 'reason', 'exitCondition'];
const KINDS = {
  test: /^test\/[A-Za-z0-9._-]+\.test\.mjs$/,
  spec: /^e2e\/extension\/[A-Za-z0-9._-]+\.spec\.mjs$/,
  proof: /^tools\/verify-[A-Za-z0-9._-]+-cdp\.mjs$/,
};
const RESULTS = new Set(['pass', 'fail', 'not run']);

/** The raw entries of ROOT's test/quarantine.json; a missing file is an empty list. */
export function readQuarantine(root) {
  let text;
  try { text = readFileSync(join(root, QUARANTINE_FILE), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new Error(`${QUARANTINE_FILE} is not valid JSON: ${e.message}`); }
  if (!Array.isArray(doc?.entries)) throw new Error(`${QUARANTINE_FILE}: "entries" must be an array`);
  return doc.entries;
}

/** 'test' | 'spec' | 'proof' by the path alone, or null. */
export function entryKind(path) {
  if (typeof path !== 'string') return null;
  return Object.keys(KINDS).find((k) => KINDS[k].test(path)) ?? null;
}

const filled = (v) => typeof v === 'string' && v.trim() !== '';

/** Every problem of the list, one message each, starting with the entry's path (or `entry N`). Empty when clean. */
export function quarantineProblems(entries, { exists, tiers = {} }) {
  const problems = [];
  const seen = new Set();
  const keepFast = new Set(tiers.keepFast || []);
  const slow = new Set(tiers.slow || []);
  entries.forEach((e, i) => {
    const hasPath = typeof e?.path === 'string' && e.path !== '';
    const at = hasPath ? e.path : `entry ${i + 1}`;
    if (!hasPath) problems.push(`${at}: no path`);
    else if (!entryKind(e.path)) problems.push(`${at}: not a test file (test/NAME.test.mjs), Playwright spec (e2e/extension/NAME.spec.mjs) or CDP proof (tools/verify-NAME-cdp.mjs)`);
    else {
      if (!exists(e.path)) problems.push(`${at}: no such file`);
      if (seen.has(e.path)) problems.push(`${at}: listed twice`);
      if (keepFast.has(e.path)) problems.push(`${at}: also in test/tiers.json keepFast`);
      if (slow.has(e.path)) problems.push(`${at}: also a slow entry in test/tiers.json (remove it there)`);
      seen.add(e.path);
    }
    if (!filled(e?.reason)) problems.push(`${at}: no reason`);
    if (!filled(e?.exitCondition)) problems.push(`${at}: no exitCondition`);
    for (const k of Object.keys(e && typeof e === 'object' ? e : {}))
      if (!KEYS.includes(k)) problems.push(`${at}: unknown key "${k}" (allowed: ${KEYS.join(', ')})`);
  });
  return problems;
}

/** The listed paths of one kind, or of every kind when `kind` is omitted. */
export function quarantinedPaths(entries, kind) {
  return new Set(entries.map((e) => e?.path).filter((p) => (kind ? entryKind(p) === kind : entryKind(p) !== null)));
}

/** The tools/verify-…-cdp.mjs path that npm script `name` runs, or null. */
export function proofScriptPath(scripts, name) {
  const m = /(?:^|\s)(tools\/verify-[A-Za-z0-9._-]+-cdp\.mjs)(?=\s|$)/.exec(String(scripts?.[name] ?? ''));
  return m ? m[1] : null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Playwright testIgnore: one anchored RegExp per quarantined spec, none inside the quarantine run itself. */
export function specIgnores(root, env) {
  if (env.WORCA_QUARANTINE_RUN === '1') return [];
  return [...quarantinedPaths(readQuarantine(root), 'spec')].map((p) => new RegExp(`^${escapeRe(join(root, p))}$`));
}

/** The history with `record` appended, oldest first, at most `max` runs kept. A wrong-shaped history counts as empty. */
export function mergeHistory(history, record, max = HISTORY_MAX) {
  const runs = Array.isArray(history?.runs) ? history.runs : [];
  return { version: 1, runs: [...runs, record].slice(-max) };
}

/** One history from several (the newest dev runs', which can diverge when runs overlap): every run once by runId,
 *  sorted by `at`, oldest first. A wrong-shaped history counts as empty. */
export function unionHistories(histories) {
  const byId = new Map();
  for (const h of histories)
    for (const r of Array.isArray(h?.runs) ? h.runs : []) if (r && !byId.has(r.runId)) byId.set(r.runId, r);
  return { version: 1, runs: [...byId.values()].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? ''))) };
}

/** Every quarantine-history.json in DIR itself or in one of its direct subfolders (one per downloaded run). */
function readHistories(dir) {
  let names = [];
  try { names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(dir, d.name)); } catch { /* no dir: none */ }
  return [dir, ...names].map((d) => readJsonFile(join(d, 'quarantine-history.json'))).filter(Boolean);
}

/** { [path]: { passed, ran } } over the history's runs; `not run` counts in neither. */
export function passRates(history, paths) {
  const runs = Array.isArray(history?.runs) ? history.runs : [];
  return Object.fromEntries(paths.map((p) => {
    let passed = 0, ran = 0;
    for (const r of runs) {
      const v = r?.results?.[p];
      if (v === 'pass') { passed++; ran++; } else if (v === 'fail') ran++;
    }
    return [p, { passed, ran }];
  }));
}

const cell = (s) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
const rateCell = (r) => (r?.ran ? `${r.passed}/${r.ran} (${Math.round((100 * r.passed) / r.ran)}%)` : 'no runs yet');

/** The job summary: one row per entry, in list order. */
export function renderQuarantineSummary({ entries, results, rates, window }) {
  const out = ['## Quarantined tests', ''];
  if (!entries.length) return [...out, 'No quarantined entries.', ''].join('\n');
  out.push(`| Entry | This run | Pass rate (last ${window} runs) | Reason | Exit condition |`, '|---|---|---|---|---|');
  for (const e of entries)
    out.push(`| \`${cell(e.path)}\` | ${cell(results[e.path] ?? 'not run')} | ${rateCell(rates[e.path])} | ${cell(e.reason)} | ${cell(e.exitCondition)} |`);
  return [...out, ''].join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────

const USAGE = `usage: node tools/quarantine.mjs COMMAND [--root DIR]
  list --kind test|spec|proof
  skips-proof NAME
  run --kind test|spec|proof --out FILE
  report --results FILE... --history-in DIR --history-out FILE --run-id ID --sha SHA --event EVENT`;

const FLAGS = {
  list: ['--kind'],
  'skips-proof': [],
  run: ['--kind', '--out'],
  report: ['--results', '--history-in', '--history-out', '--run-id', '--sha', '--event'],
};

class UsageError extends Error {}

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!FLAGS[command]) throw new UsageError(`unknown command "${command ?? ''}"`);
  const o = { command, root: REPO, positional: [], results: [] };
  const allowed = [...FLAGS[command], '--root'];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) { o.positional.push(a); continue; }
    if (!allowed.includes(a)) throw new UsageError(`unknown flag ${a} for ${command}`);
    if (a === '--results') {
      while (rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) o.results.push(rest[++i]);
      if (!o.results.length) throw new UsageError('--results needs at least one file');
      continue;
    }
    const v = rest[++i];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`);
    o[a.slice(2)] = v;
  }
  o.root = resolve(o.root);
  for (const f of FLAGS[command]) if (f !== '--results' && o[f.slice(2)] === undefined) throw new UsageError(`${command} needs ${f}`);
  if (o.kind !== undefined && !KINDS[o.kind]) throw new UsageError(`bad --kind "${o.kind}" (want test|spec|proof)`);
  if (command === 'skips-proof' && o.positional.length !== 1) throw new UsageError('skips-proof needs one npm script name');
  if (command !== 'skips-proof' && o.positional.length) throw new UsageError(`unexpected argument "${o.positional[0]}"`);
  return o;
}

const readJsonFile = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/** The validated list of `root`, or exit 2 with each problem on stderr. */
function validList(root) {
  let entries;
  try { entries = readQuarantine(root); } catch (e) { console.error(e.message); process.exit(2); }
  const tiers = readJsonFile(join(root, 'test', 'tiers.json')) || {};
  const problems = quarantineProblems(entries, { exists: (p) => existsSync(join(root, p)), tiers });
  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(2);
  }
  return entries;
}

function entryCommand(kind, abs) {
  if (kind === 'test')
    return { cmd: process.execPath, args: [join(REPO, 'tools', 'test.mjs'), abs], env: { WORCA_TEST_SUITE_TIMEOUT_MIN: '15' } };
  if (kind === 'proof')
    return { cmd: process.execPath, args: ['--disable-warning=ExperimentalWarning', abs], env: { CHROME_NO_SANDBOX: '1' }, timeout: ENTRY_TIMEOUT_MS };
  return { cmd: 'npx', args: ['playwright', 'test', '-c', 'e2e/extension/playwright.config.mjs', abs], env: { WORCA_QUARANTINE_RUN: '1' }, timeout: ENTRY_TIMEOUT_MS };
}

function runEntries(o, entries) {
  const out = {};
  for (const path of quarantinedPaths(entries, o.kind)) {
    const { cmd, args, env, timeout } = entryCommand(o.kind, join(o.root, path));
    console.log(`quarantine: running ${path}`);
    const t0 = Date.now();
    const r = spawnSync(cmd, args, { cwd: REPO, stdio: 'inherit', env: { ...process.env, ...env }, timeout, killSignal: 'SIGKILL', shell: cmd === 'npx' && process.platform === 'win32' });
    const result = r.status === 0 ? 'pass' : 'fail';
    out[path] = { result, seconds: Math.round((Date.now() - t0) / 100) / 10 };
    console.log(`quarantine: ${path}: ${result}${r.error ? ` (${r.error.message})` : ''}`);
  }
  const file = resolve(o.out);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
}

function report(o, entries) {
  const merged = {};
  for (const f of o.results) {
    const r = readJsonFile(resolve(f));
    if (r && typeof r === 'object') Object.assign(merged, r);
    else console.error(`quarantine: no results in ${f} (its entries read "not run")`);
  }
  const results = Object.fromEntries(entries.map((e) => {
    const v = merged[e.path]?.result;
    return [e.path, RESULTS.has(v) ? v : 'not run'];
  }));
  const history = mergeHistory(unionHistories(readHistories(resolve(o['history-in']))),
    { runId: o['run-id'], at: new Date().toISOString(), sha: o.sha, event: o.event, results });
  const out = resolve(o['history-out']);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(history, null, 1) + '\n');
  const md = renderQuarantineSummary({ entries, results, rates: passRates(history, entries.map((e) => e.path)), window: HISTORY_MAX });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  process.stdout.write(md);
}

function main() {
  let o;
  try { o = parseCli(process.argv.slice(2)); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`${e.message}\n${USAGE}`);
    process.exit(2);
  }
  const entries = validList(o.root);
  if (o.command === 'list') {
    for (const p of quarantinedPaths(entries, o.kind)) console.log(p);
  } else if (o.command === 'skips-proof') {
    const name = o.positional[0];
    const proof = proofScriptPath(readJsonFile(join(o.root, 'package.json'))?.scripts, name);
    if (!proof || !quarantinedPaths(entries, 'proof').has(proof)) process.exit(1);
    console.log(`${name} is quarantined (${QUARANTINE_FILE}): it runs in the Quarantined tests workflow`);
  } else if (o.command === 'run') runEntries(o, entries);
  else report(o, entries);
  process.exit(0);
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) main();
