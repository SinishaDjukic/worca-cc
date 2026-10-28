#!/usr/bin/env node
// tools/test.mjs — `npm test` on macOS, Linux and Windows: a hermetic HOME/WORCA_HOME,
// the no-real-claude PATH guard, tier selection (test/tiers.json) and duration-balanced
// shards (test/timings.json, longest-processing-time-first), and --related: only the test files a
// working-tree change can affect (tools/test-related.mjs). Replaces the POSIX-only shell one-liner
// and node's index-modulo --test-shard. --timings-out writes the run's own per-file seconds to a file
// (each CI shard uploads one; tools/test-timings-merge.mjs folds them into test/timings.json).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedFiles, relatedTests } from './test-related.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PER_FILE_S = 0.5; // process spawn + imports per file (measured 2026-10-04: ~0.54 s)

const readJson = (rel, dflt) => { try { return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')); } catch { return dflt; } };
const globRe = (g) => new RegExp('^' + g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');

export function selectFiles({ all, tier = 'all', tiers = {} }) {
  const slow = (tiers.slow || []).map(globRe);
  const keep = new Set(tiers.keepFast || []);
  const isSlow = (f) => !keep.has(f) && slow.some((re) => re.test(f));
  if (tier === 'fast') return all.filter((f) => !isSlow(f));
  if (tier === 'slow') return all.filter(isSlow);
  return [...all];
}

export function planShards(files, timings, n) {
  // A file with no recorded time weighs the MEAN, not the median: most files take ~0 s, so the
  // median (0.2 s) priced a new file far under what new files actually cost (2.3 s on average on
  // 2026-10-22, when 636 untimed files had piled onto one shard and made it the CI long pole).
  const known = Object.values(timings);
  const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const w = (f) => (timings[f] ?? mean) + PER_FILE_S;
  // Code-unit tie-break, never localeCompare: every CI shard must compute the same plan.
  const order = [...files].sort((a, b) => w(b) - w(a) || (a < b ? -1 : a > b ? 1 : 0));
  const shards = Array.from({ length: n }, () => ({ load: 0, files: [] }));
  for (const f of order) {
    let min = shards[0];
    for (const s of shards) if (s.load < min.load) min = s;
    min.load += w(f);
    min.files.push(f); // longest first inside each shard too: no idle tail
  }
  return shards.map((s) => s.files);
}

// test/timings.json after a run: the newer measurements win, files that no longer exist drop out,
// keys sorted so the file diffs cleanly.
export function mergeTimings(base, measured, exists) {
  const merged = Object.assign({}, base, ...measured);
  return Object.fromEntries(Object.keys(merged).filter(exists).sort().map((k) => [k, merged[k]]));
}

export const writeTimings = (root, timings) =>
  writeFileSync(join(root, 'test', 'timings.json'), JSON.stringify(timings, null, 1) + '\n');

export function parseArgs(argv, env = process.env) {
  const o = { tier: 'all', shard: null, writeTimings: false, timingsOut: null, concurrency: null, related: false, base: null, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--tier') o.tier = value();
    else if (a === '--shard') o.shard = value();
    else if (a === '--concurrency') o.concurrency = Number(value());
    else if (a === '--write-timings') o.writeTimings = true;
    else if (a === '--timings-out') o.timingsOut = value();
    else if (a === '--related') o.related = true;
    else if (a === '--base') o.base = value();
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else o.files.push(a.replace(/\\/g, '/'));
  }
  if (!['fast', 'slow', 'all'].includes(o.tier)) throw new Error(`bad --tier "${o.tier}" (want fast|slow|all)`);
  if (o.concurrency !== null && !(Number.isInteger(o.concurrency) && o.concurrency > 0)) throw new Error('--concurrency needs a positive integer');
  if (o.base && !o.related) throw new Error('--base needs --related');
  if (o.related && o.files.length) throw new Error('--related picks its own files: drop the file list');
  // CI's shard env splits the selected suite; it never applies to an explicit file list or --related.
  if (!o.shard && !o.files.length && !o.related) o.shard = env.WORCA_TEST_SHARD || null;
  return o;
}

function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (o.related) {
    let r;
    try { r = relatedTests(ROOT, changedFiles(ROOT, o.base || 'HEAD')); } catch (e) { console.error(e.message); process.exit(2); }
    if (r.full) console.log(`related: ${r.reason}, running the full suite`);
    else if (!r.tests.length) { console.log('related: no test file depends on the changed files'); process.exit(0); }
    else { console.log(`related: ${r.tests.length} test files`); o.files = r.tests; }
  }
  const all = o.files.length ? o.files
    : readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.mjs')).sort().map((f) => `test/${f}`);
  let files = o.files.length ? all : selectFiles({ all, tier: o.tier, tiers: readJson('test/tiers.json', {}) });
  const timings = readJson('test/timings.json', {});
  if (o.shard) {
    const m = /^(\d+)\/(\d+)$/.exec(o.shard);
    if (!m || +m[1] < 1 || +m[1] > +m[2]) { console.error(`bad shard "${o.shard}" (want i/n)`); process.exit(2); }
    files = planShards(files, timings, +m[2])[+m[1] - 1];
    const untimed = files.filter((f) => !(f in timings)).length;
    console.log(`shard ${o.shard}: ${files.length} files${untimed ? ` (${untimed} with no recorded time: npm run test:timings:merge rebalances)` : ''}`);
  } else {
    files = planShards(files, timings, 1)[0];
  }
  if (!files.length) { console.error('no test files selected'); process.exit(2); }

  const home = mkdtempSync(join(tmpdir(), 'worca-cc-test-home-'));
  const work = mkdtempSync(join(tmpdir(), 'worca-cc-test-run-'));
  // A file subset gets its own WORCA_HOME: the shared .worca-cc-test may belong to a full run
  // in progress, and wiping it would turn that run red.
  const scoped = o.files.length > 0;
  const testHome = scoped ? join(work, 'worca-home') : join(ROOT, '.worca-cc-test');
  if (!scoped) rmSync(testHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  const listFile = join(work, 'files.json');
  const timingsOut = join(work, 'timings.json');
  const measure = o.writeTimings || o.timingsOut;
  writeFileSync(listFile, JSON.stringify({ files, concurrency: o.concurrency, timingsOut: measure ? timingsOut : null }));

  const env = { ...process.env, WORCA_HOME: scoped ? testHome : '.worca-cc-test', HOME: home, USERPROFILE: home,
    WORCA_NO_REAL_CLAUDE_LOG: join(testHome, 'real-claude-spawns.log'), // read by the shim and assert-none.mjs
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ') };
  delete env.WORCA_HOST_PID; // a test run is never a worca-hosted child
  delete env.WORCA_FLAGS; // feature flags (docs/feature-flags.md): a developer's shell flags never reach the suite
  env.WORCA_GIT ??= '1'; // P0 (S1): git forced on (no probe) unless the caller set it; rows that need "missing" use test/helpers/git-off.mjs
  delete env.CLAUDE_CONFIG_DIR; // skillHostFacts reads it (skills registry §4.1): a test never sees the developer's Claude config
  delete env.NODE_TEST_CONTEXT; // set inside a node:test file; run() would then skip every file
  // A developer's own Azure DevOps / Bitbucket / push-as-person settings must not open host-lookup gates in tests
  // (D6/D7/D20): tests that need them set them with withEnv.
  for (const k of ['WORCA_ADO_TOKEN', 'WORCA_ADO_READ_TOKEN', 'WORCA_ADO_WRITE_TOKEN', 'AZURE_DEVOPS_EXT_PAT', 'WORCA_ADO_GIT_TOKEN',
    'WORCA_ADO_BOARDS_TOKEN', 'WORCA_BB_TOKEN', 'WORCA_BB_READ_TOKEN', 'WORCA_BB_WRITE_TOKEN', 'WORCA_BB_EMAIL', 'WORCA_BB_GIT_TOKEN', 'WORCA_BB_GIT_USER', 'WORCA_GH_AS_PERSON', 'WORCA_BROKER_URL']) delete env[k];
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[pathKey] = join(ROOT, 'test', 'helpers', 'no-real-claude') + delimiter + (env[pathKey] || '');

  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'test-run.mjs'), listFile], { cwd: ROOT, env, stdio: 'inherit' });
  let code = r.status ?? 1;
  const g = spawnSync(process.execPath, [join(ROOT, 'test', 'helpers', 'no-real-claude', 'assert-none.mjs')], { cwd: ROOT, env, stdio: 'inherit' });
  if (g.status !== 0) code = 1;
  if (measure && existsSync(timingsOut)) {
    const measured = JSON.parse(readFileSync(timingsOut, 'utf8'));
    if (o.writeTimings) writeTimings(ROOT, mergeTimings(timings, [measured], (k) => existsSync(join(ROOT, k))));
    if (o.timingsOut) {
      const out = resolve(o.timingsOut);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(measured, null, 1) + '\n');
    }
  }
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  process.exit(code);
}

// Real paths on both sides: node loads the main module through its realpath (/tmp is
// /private/tmp on macOS; a symlinked checkout; a Windows junction), so a plain resolve()
// mismatch would skip main() and exit 0 having run no tests.
const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) main();
