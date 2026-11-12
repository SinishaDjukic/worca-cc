#!/usr/bin/env node
// experiments/messaging-bus/e5-detector.mjs — E5 (plan §4.9): layer 2's detector on scripted tool-call
// traces. Each case runs in a fresh temp git repo with its own bus DB; the REAL lib/hook.mjs is spawned
// per tool call with --detect. At case end the runner calls the step-end flush in-process (the product's
// step-end flush). Measures precision, recall, false positives, secret leaks, body caps, the behaviour
// rules and the added hook latency.  node e5-detector.mjs [--quick] [--out <path>]
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir, cpus, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSqliteBus } from './lib/sqlite-bus.mjs';
import { openDetectState } from './lib/detect-state.mjs';
import { runDetect, runFlush, DEBOUNCE_MS, DEBOUNCE_CALLS, MAX_AUTO, AUTO_MAX_HOP } from './lib/detector.mjs';
import { classify, surfaceOf } from './lib/surface.mjs';
import { SECRET_PATTERNS, isSecretPath } from './lib/redact.mjs';
import { buildCorpus } from './lib/trace-corpus.mjs';
import { percentiles, round } from './lib/stats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'lib', 'hook.mjs');
const TOPIC = 'run.r_e5.siblings';
const PREFIX = 'run.r_e5.step.impl';
const MARK = 'step:r_e5:impl:1';
const OPTS = { topic: TOPIC, debounceMs: DEBOUNCE_MS, debounceCalls: DEBOUNCE_CALLS, maxAuto: MAX_AUTO, maxHop: AUTO_MAX_HOP };
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

function gitRepo(dir, files) {
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  for (const [f, t] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), t);
  }
  git('add', '-A');
  git('-c', 'user.name=e5', '-c', 'user.email=e5@example.invalid', 'commit', '-q', '-m', 'base', '--allow-empty');
}

/** One spawn of the real hook. */
function spawnHook({ db, mapPath, repo, who, payload, detect = true }) {
  const args = [HOOK, '--db', db, '--consumer-prefix', PREFIX, '--topics', TOPIC, '--start-mark', MARK];
  if (detect) args.push('--detect', '--publish-topic', TOPIC, '--task-map', mapPath, '--task-id', who, '--root', repo);
  const t0 = performance.now();
  const r = spawnSync(process.execPath, args, { input: JSON.stringify({ session_id: who, cwd: repo, ...payload }), encoding: 'utf8' });
  return { ms: performance.now() - t0, stdout: r.stdout, stderr: r.stderr, status: r.status };
}

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** One case → its published rows and the per-case flags. */
export function runCaseE5(c) {
  const dir = mkdtempSync(join(tmpdir(), 'bus-e5-'));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const db = join(dir, 'bus.db');
  const mapPath = join(dir, 'task-map.json');
  const bus = createSqliteBus({ path: db, origin: 'h_e5' });
  try {
    gitRepo(repo, c.setup.files);
    writeFileSync(mapPath, JSON.stringify(c.taskMap));
    bus.mark(MARK);
    let n = 0;
    let detectErrors = 0;
    const who = new Set();
    // a real tool call carries ONE tool_use_id on its Pre and its Post hook
    const hook = (call, event) => {
      if (event === 'PreToolUse' || call.tool !== 'Bash') n += 1;
      const input = { ...call.input };
      if (input.file_path) input.file_path = join(repo, input.file_path);
      const r = spawnHook({ db, mapPath, repo, who: call.who ?? c.taskId, payload: {
        hook_event_name: event, tool_name: call.tool, tool_input: input, tool_response: call.response, tool_use_id: `tu_${n}`,
      } });
      detectErrors += (r.stderr.match(/^BUS_DETECT_ERROR/gm) ?? []).length;
      return r;
    };
    for (const call of c.calls) {
      const actor = call.who ?? c.taskId;
      who.add(actor);
      const p = call.input.file_path ? join(repo, call.input.file_path) : null;
      if (call.tool === 'Edit') {
        const text = readFileSync(p, 'utf8');
        writeFileSync(p, call.input.replace_all ? text.split(call.input.old_string).join(call.input.new_string) : text.replace(call.input.old_string, () => call.input.new_string));
      } else if (call.tool === 'Write') {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, call.input.content);
      }
      if (call.tool === 'Bash') {
        hook(call, 'PreToolUse');
        call.bashEffect?.(repo);
      }
      hook(call, 'PostToolUse');
    }
    // the step-end flush, per publisher, in-process
    const state = openDetectState(bus.db);
    for (const w of who) {
      runFlush({ bus, state, scope: `${MARK}|${PREFIX}:${w}:main`, opts: { ...OPTS, now: Date.now() }, from: { kind: 'agent', id: w, sub: 'main' } });
    }
    let stateMatchesFinal = true;
    for (const w of who) {
      for (const [file, row] of Object.entries(state.getFiles(`${MARK}|${PREFIX}:${w}:main`))) {
        let text = null;
        try { text = readFileSync(join(repo, file), 'utf8'); } catch { text = null; }
        const kind = classify(file, text ?? undefined);
        const real = text === null ? (kind === 'js' ? { exports: {}, sql: {} } : {}) : surfaceOf(kind, file, text).surface;
        if (canon(row.announced) !== canon(real)) stateMatchesFinal = false;
      }
    }
    const published = bus.read('e5:reader:main', [TOPIC]).filter((m) => m.kind === 'contract.changed' || m.kind === 'status');
    return { published, detectErrors, stateMatchesFinal, calls: n };
  } finally {
    bus.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const matches = (m, f) => m.body?.data?.file === f.file && m.body?.data?.reason === f.reason && f.names.every((nm) => m.body.text.includes(nm));

function leaks(m, secretFiles) {
  const s = JSON.stringify(m);
  if (SECRET_PATTERNS.some((p) => new RegExp(p.source, p.flags.replace('g', '')).test(s))) return true;
  return secretFiles.some((f) => s.includes(f));
}

/** Added hook latency: the same calls with and without --detect, in one repo. */
function timing(repeats) {
  const dir = mkdtempSync(join(tmpdir(), 'bus-e5t-'));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const V1 = 'export function price(item) {\n  return item.cost;\n}\n';
  gitRepo(repo, { 'lib.mjs': V1 });
  const db = join(dir, 'bus.db');
  const mapPath = join(dir, 'task-map.json');
  const map = { v: 1, tasks: { a: { title: 'A', file: 'a.md', files: ['lib.mjs'], parsed: true } } };
  writeFileSync(mapPath, JSON.stringify(map));
  const bus = createSqliteBus({ path: db, origin: 'h_e5t' });
  bus.mark(MARK);
  const out = { edit: [], bash: [], hook: [], inProcess: [] };
  const state = openDetectState(bus.db);
  try {
    for (let i = 0; i < repeats; i++) {
      const [from, to] = i % 2 ? ['price(item, opts)', 'price(item)'] : ['price(item)', 'price(item, opts)'];
      const p = join(repo, 'lib.mjs');
      writeFileSync(p, readFileSync(p, 'utf8').replace(from, to));
      const payload = { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: p, old_string: from, new_string: to } };
      const plain = spawnHook({ db, mapPath, repo, who: 'a', payload, detect: false });
      const det = spawnHook({ db, mapPath, repo, who: 'a', payload, detect: true });
      out.edit.push(det.ms - plain.ms);
      out.hook.push(det.ms);
      const pre = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } };
      const post = { ...pre, hook_event_name: 'PostToolUse' };
      const bp = spawnHook({ db, mapPath, repo, who: 'a', payload: pre, detect: false }).ms + spawnHook({ db, mapPath, repo, who: 'a', payload: post, detect: false }).ms;
      const bd = spawnHook({ db, mapPath, repo, who: 'a', payload: pre, detect: true }).ms + spawnHook({ db, mapPath, repo, who: 'a', payload: post, detect: true }).ms;
      out.bash.push(bd - bp);
      // the detect pass alone, in-process (no spawn, no module load)
      const ctx = {
        root: repo, taskId: 'a', taskMap: map, siblingsFiles: new Set(),
        readFile: (rel) => { try { return readFileSync(join(repo, rel), 'utf8'); } catch { return null; } },
        git: (args) => { try { return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } },
      };
      const t0 = performance.now();
      runDetect({ bus, state, scope: `${MARK}|inproc`, call: { event: 'PostToolUse', tool: 'Edit', input: payload.tool_input, cwd: repo }, ctx, opts: { ...OPTS, now: Date.now() }, from: { kind: 'agent', id: 'inproc', sub: 'main' } });
      out.inProcess.push(performance.now() - t0);
    }
  } finally {
    bus.close();
    rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

export function summarize(results, t) {
  const s = {};
  const contract = results.filter((r) => r.case.label === 'contract');
  const ordinary = results.filter((r) => r.case.label === 'ordinary');
  const scored = [...contract, ...ordinary];
  s['e5.cases.contract'] = contract.length;
  s['e5.cases.ordinary'] = ordinary.length;
  let pubTotal = 0;
  let pubMatched = 0;
  for (const r of scored) {
    for (const m of r.published) {
      pubTotal += 1;
      if (r.case.expect.some((f) => matches(m, f))) pubMatched += 1;
    }
  }
  const byReason = {};
  let expTotal = 0;
  let expFound = 0;
  for (const r of contract) {
    for (const f of r.case.expect) {
      const hit = r.published.some((m) => matches(m, f));
      expTotal += 1;
      expFound += hit ? 1 : 0;
      byReason[f.reason] ??= [0, 0];
      byReason[f.reason][0] += hit ? 1 : 0;
      byReason[f.reason][1] += 1;
    }
  }
  s['e5.precision'] = pubTotal ? round(pubMatched / pubTotal, 3) : 1;
  s['e5.recall'] = expTotal ? round(expFound / expTotal, 3) : 1;
  s['e5.falsePositiveRate'] = ordinary.length ? round(ordinary.filter((r) => r.published.length > 0).length / ordinary.length, 3) : 0;
  s['e5.secretLeaks'] = results.reduce((x, r) => x + r.published.filter((m) => leaks(m, r.secretFiles)).length, 0);
  const all = results.flatMap((r) => r.published);
  s['e5.maxBodyChars'] = Math.max(0, ...all.map((m) => m.body.text.length));
  s['e5.maxDataBytes'] = Math.max(0, ...all.map((m) => Buffer.byteLength(JSON.stringify(m.body.data ?? {}), 'utf8')));
  const beh = (id) => results.find((r) => r.case.id === id);
  const dedup = beh('dedup');
  const revert = beh('revert');
  const burst = beh('burst');
  const loop = beh('loop');
  s['e5.dedup.publishes'] = dedup.published.length;
  s['e5.dedup.finalAfter'] = dedup.published.at(-1)?.body.data.changes[0]?.after ?? null;
  s['e5.revert.publishes'] = revert.published.length;
  s['e5.revert.lastReverted'] = revert.published.at(-1)?.body.data.reverted === true;
  s['e5.debounce.messages'] = burst.published.length;
  s['e5.debounce.coalescedNames'] = burst.published.at(-1)?.body.data.changes.length ?? 0;
  s['e5.stateMatchesFinal'] = results.filter((r) => r.case.label === 'behaviour').every((r) => r.stateMatchesFinal);
  s['e5.loop.messages'] = loop.published.length;
  s['e5.loop.maxHop'] = Math.max(0, ...loop.published.map((m) => m.hop ?? 1));
  s['e5.detectErrors'] = results.reduce((x, r) => x + r.detectErrors, 0);
  const pe = percentiles(t.edit);
  const pb = percentiles(t.bash);
  s['e5.addedMs.edit.p50'] = round(pe.p50, 1);
  s['e5.addedMs.edit.p99'] = round(pe.p99, 1);
  s['e5.addedMs.bash.p50'] = round(pb.p50, 1);
  s['e5.addedMs.bash.p99'] = round(pb.p99, 1);
  s['e5.hookMs.p99'] = round(percentiles(t.hook).p99, 1);
  s['e5.inProcessMs.p99'] = round(percentiles(t.inProcess).p99, 2);
  for (const [reason, [hit, n]] of Object.entries(byReason).sort()) s[`e5.recallByReason.${reason}`] = round(hit / n, 3);
  return s;
}

function parseArgs(argv) {
  const o = { quick: false, out: join(HERE, 'results', 'e5.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--quick') o.quick = true;
    else if (argv[i] === '--out') o.out = argv[++i];
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const corpus = buildCorpus({ quick: o.quick });
  const results = [];
  for (const c of corpus) {
    const secretFiles = Object.keys(c.setup.files).filter(isSecretPath).map((f) => f.split('/').pop());
    results.push({ case: c, secretFiles, ...runCaseE5(c) });
  }
  const t = timing(o.quick ? 10 : 60);
  const summary = summarize(results, t);
  const result = {
    experiment: 'e5', quick: o.quick,
    method: 'scripted tool-call traces; the real hook spawned per call with --detect; step-end flush in-process; corpus and detector by the same author',
    env: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, cpus: cpus().length },
    durationMs: Date.now() - t0, summary,
    cases: results.map((r) => ({
      id: r.case.id, label: r.case.label, expect: r.case.expect, expectMessages: r.case.expectMessages ?? null, calls: r.calls,
      detectErrors: r.detectErrors, stateMatchesFinal: r.stateMatchesFinal,
      published: r.published.map((m) => ({ kind: m.kind, hop: m.hop, reason: m.body.data?.reason ?? null, file: m.body.data?.file ?? null, text: m.body.text, coalesced: m.body.data?.coalesced ?? null, reverted: m.body.data?.reverted ?? null })),
      matched: r.case.expect.map((f) => r.published.some((m) => matches(m, f))),
    })),
  };
  mkdirSync(dirname(o.out), { recursive: true });
  writeFileSync(o.out, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(summary) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { process.stderr.write(`${e.stack ?? e}\n`); process.exit(1); });
}
