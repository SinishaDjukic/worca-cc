#!/usr/bin/env node
// tools/test.mjs — `npm test` on macOS, Linux and Windows: a hermetic HOME/WORCA_HOME,
// the no-real-claude PATH guard, tier selection (test/tiers.json) and duration-balanced
// shards (test/timings.json, longest-processing-time-first), and --related: only the test files a
// working-tree change can affect (tools/test-related.mjs). Replaces the POSIX-only shell one-liner
// and node's index-modulo --test-shard. --timings-out writes the run's own per-file seconds to a file
// (each CI shard uploads one; tools/test-timings-merge.mjs folds them into test/timings.json).
// --failures-out writes a red run's failure record (the files that failed; each red CI shard uploads one and
// tools/ci-gate.mjs names them in the gate summary); a green run writes nothing.
// --measure-tails turns forceExit off, so each file's tail (its process staying up after its tests) is measured and
// logged; every other run force-closes such a file and names the handles it held (tools/test-run.mjs).
// A full suite takes a machine-wide lock (one full suite at a time, wherever it runs: two at once each
// took 2-3x as long and tripped the timing budgets, perf audit T1), and every run has a whole-suite
// timeout, so no test can hold `npm test` open forever (process audit §8c).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quarantinedPaths, readQuarantine } from './quarantine.mjs';
import { changedFiles, relatedTests } from './test-related.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PER_FILE_S = 0.5; // process spawn + imports per file (measured 2026-10-04: ~0.54 s)
const SUITE_TIMEOUT_MIN = 60; // the slowest suite seen took 23 min, at load 49 on 12 cores
const LOCK_POLL_MS = 2000;
// A suite is stopped at its time limit, so a lock or a temp folder twice the default limit old belongs to none still
// running, whatever its pid looks like from here (a pid taken again; a sandbox with its own pid numbers).
const SUITE_STALE_MS = 2 * SUITE_TIMEOUT_MIN * 60_000;

const readJson = (rel, dflt) => { try { return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')); } catch { return dflt; } };
const globRe = (g) => new RegExp('^' + g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');

// Quarantine wins over tiers: a quarantined file (test/quarantine.json) leaves fast, slow and all.
export function selectFiles({ all, tier = 'all', tiers = {}, quarantined = new Set() }) {
  const slow = (tiers.slow || []).map(globRe);
  const keep = new Set(tiers.keepFast || []);
  const isSlow = (f) => !keep.has(f) && slow.some((re) => re.test(f));
  const kept = all.filter((f) => !quarantined.has(f));
  if (tier === 'fast') return kept.filter((f) => !isSlow(f));
  if (tier === 'slow') return kept.filter(isSlow);
  return kept;
}

/**
 * The sorted test/*.mjs files of `root` for `tier`, with its test/tiers.json and test/quarantine.json applied.
 * `left` counts the quarantined test files among them (the same for every tier). A malformed quarantine list throws.
 */
export function tierFiles(root, tier) {
  const all = readdirSync(join(root, 'test')).filter((f) => f.endsWith('.mjs')).sort().map((f) => `test/${f}`);
  let tiers = {};
  try { tiers = JSON.parse(readFileSync(join(root, 'test', 'tiers.json'), 'utf8')); } catch { /* no tiers: every file is fast */ }
  const quarantined = quarantinedPaths(readQuarantine(root), 'test');
  return { files: selectFiles({ all, tier, tiers, quarantined }), left: all.filter((f) => quarantined.has(f)).length };
}

/** The files a run takes: an explicit list (or --related's) as given, quarantined or not; else the tier's files. */
export function filesToRun(root, o) {
  return o.files.length ? { files: o.files, left: 0 } : tierFiles(root, o.tier);
}

// A file with no recorded time weighs the MEAN, not the median: most files take ~0 s, so the
// median (0.2 s) priced a new file far under what new files actually cost (2.3 s on average on
// 2026-10-22, when 636 untimed files had piled onto one shard and made it the CI long pole).
export function fallbackWeight(timings) {
  const known = Object.values(timings);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
}

/** The once-per-tier-run warning for files with no recorded time, or null when every file is timed. */
export function untimedWarning(files, timings) {
  const n = files.filter((f) => !(f in timings)).length;
  if (!n) return null;
  return `${n} test ${n === 1 ? 'file has' : 'files have'} no recorded timing: each is priced at the mean recorded time `
    + `(${fallbackWeight(timings).toFixed(2)} s) until the weekly Refresh test timings PR measures it`;
}

/** In GitHub Actions only a run with no shard or shard 1/n annotates the warning: one annotation per tier and Node leg. */
export const annotateUntimed = (env, shard) => env.GITHUB_ACTIONS === 'true' && (!shard || shard.startsWith('1/'));

export function planShards(files, timings, n) {
  const mean = fallbackWeight(timings);
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

/** One shard's failure record (what tools/ci-gate.mjs reads): files sorted by code unit, each once. */
export function failureRecord({ tier, shard, node, files }) {
  return { version: 1, tier, shard, node, files: [...new Set(files)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) };
}

export function parseArgs(argv, env = process.env) {
  const o = { tier: 'all', shard: null, writeTimings: false, timingsOut: null, failuresOut: null, measureTails: false, concurrency: null, related: false, base: null, files: [] };
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
    else if (a === '--failures-out') o.failuresOut = value();
    else if (a === '--measure-tails') o.measureTails = true;
    else if (a === '--related') o.related = true;
    else if (a === '--base') o.base = value();
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else o.files.push(a.replace(/\\/g, '/'));
  }
  if (!['fast', 'slow', 'all'].includes(o.tier)) throw new Error(`bad --tier "${o.tier}" (want fast|slow|all)`);
  if (o.concurrency !== null && !(Number.isInteger(o.concurrency) && o.concurrency > 0)) throw new Error('--concurrency needs a positive integer');
  // Worca sets WORCA_TEST_CONCURRENCY in every agent's env (Settings › Runs › Machine load). This is its only
  // reader: the cap travels to test-run.mjs in files.json, never to the test files. A bad value is ignored.
  const envCap = Number(env.WORCA_TEST_CONCURRENCY);
  if (o.concurrency === null && Number.isInteger(envCap) && envCap > 0) o.concurrency = envCap;
  if (o.base && !o.related) throw new Error('--base needs --related');
  if (o.related && o.files.length) throw new Error('--related picks its own files: drop the file list');
  // CI's shard env splits the selected suite; it never applies to an explicit file list or --related.
  if (!o.shard && !o.files.length && !o.related) o.shard = env.WORCA_TEST_SHARD || null;
  return o;
}

const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

/**
 * Take the full-suite lock file, or report who holds it. A holder whose process is gone or that took the lock more
 * than SUITE_STALE_MS ago, or a file nobody could parse for 10 s, is stale and is taken over. A stale lock that cannot
 * be removed (another account's file or folder at the name) is run past: no lock beats waiting for ever.
 * @returns {{ ok: true } | { ok: false, holder: { pid:number, cwd:string, at:number } | null }}
 */
export function tryFullSuiteLock(file, me = { pid: process.pid, cwd: ROOT, at: Date.now() }) {
  for (let i = 0; i < 2; i++) {
    try { writeFileSync(file, JSON.stringify(me), { flag: 'wx' }); return { ok: true }; } catch (e) { if (e.code !== 'EEXIST') return { ok: true }; }
    let holder = null;
    try { holder = JSON.parse(readFileSync(file, 'utf8')); } catch { /* mid-write, or junk */ }
    let fresh = false;
    try { fresh = Date.now() - statSync(file).mtimeMs < 10_000; } catch { continue; }   // gone already: retry
    if (holder ? alive(holder.pid) && Date.now() - holder.at < SUITE_STALE_MS : fresh) return { ok: false, holder };
    try { rmSync(file, { force: true }); } catch { return { ok: true }; }
  }
  return { ok: false, holder: null };
}

/** Release the lock only when it is still ours (a takeover after a stale read must not be undone). */
export function releaseFullSuiteLock(file, pid = process.pid) {
  try { if (JSON.parse(readFileSync(file, 'utf8')).pid === pid) rmSync(file, { force: true }); } catch { /* gone */ }
}

/**
 * The machine-wide full-suite lock file (one per user account). Not under tmpdir(): a Worca run sets TMPDIR to its own scratch folder,
 * so a lock there would be one per run and parallel runs' suites would never wait for each other.
 */
export function fullSuiteLockFile(env = process.env, platform = process.platform, uid = process.getuid?.()) {
  if (env.WORCA_TEST_LOCK_FILE) return env.WORCA_TEST_LOCK_FILE;
  // Per user: /tmp is shared and sticky, so another account's stale lock could be neither taken over nor removed.
  return platform === 'win32' ? join(tmpdir(), 'worca-cc-full-suite.lock') : `/tmp/worca-cc-full-suite-${uid}.lock`;
}

/** Whether this run waits for the machine-wide full-suite lock: an unscoped run on a developer machine. */
export function needsFullSuiteLock(o, env = process.env) {
  return !o.files.length && !o.shard && !env.CI && !/^(1|true|yes)$/i.test(env.WORCA_TEST_NO_LOCK || '');
}

async function waitForFullSuiteLock(file) {
  let told = false;
  for (;;) {
    const r = tryFullSuiteLock(file);
    if (r.ok) return;
    if (!told) {
      const h = r.holder;
      console.log(`waiting for another full test suite to finish${h ? ` (pid ${h.pid} in ${h.cwd}, started ${new Date(h.at).toTimeString().slice(0, 8)})` : ''}: one full suite runs at a time on this machine. Let this run wait, or stop this run (never the other suite) and run only the related tests (node tools/test.mjs --related)`);
      told = true;
    }
    await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
  }
}

/** Run test-run.mjs in its own process group, killed whole (every test file's process too) at the timeout. */
function runSuite(args, opts, timeoutMs) {
  return new Promise((resolveP) => {
    const group = process.platform !== 'win32';
    const child = spawn(process.execPath, args, { ...opts, stdio: 'inherit', detached: group });
    const kill = (sig) => { try { if (group) process.kill(-child.pid, sig); else child.kill(sig); } catch { /* gone */ } };
    const timer = setTimeout(() => {
      console.error(`\nThe test suite ran past its ${Math.round(timeoutMs / 60000)} min limit (WORCA_TEST_SUITE_TIMEOUT_MIN): stopped it and every test process.`);
      kill('SIGKILL');
    }, timeoutMs);
    // The child has its own process group, so a Ctrl-C at the terminal no longer reaches it: pass it on.
    const forward = (sig) => () => kill(sig);
    const onInt = forward('SIGINT'), onTerm = forward('SIGTERM');
    process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
      resolveP(signal ? 1 : (code ?? 1));
    });
  });
}

/**
 * A temp folder outside Worca's state for the suite when `tmp` lies inside a `.worca-cc` folder (a run's scratch),
 * else null. POSIX only: Windows' temp folder is never a run's. A run's teardown never sees this folder, so a suite
 * that was killed leaves it behind: the name carries the runner's pid, and each start removes our own folders whose
 * runner is gone and that are `minAgeMs` old (a live runner in a sandbox with its own pid numbers looks gone from
 * here; none outlives its time limit). A `root` we cannot write to gives null too (the suite then stays in tmpdir()).
 * Exported for tests.
 */
export function suiteTmpOutsideWorca(tmp, { platform = process.platform, root = '/tmp', pid = process.pid, uid = process.getuid?.(), minAgeMs = SUITE_STALE_MS } = {}) {
  if (platform === 'win32' || !/(^|\/)\.worca-cc\//.test(`${tmp}/`)) return null;
  let names = [];
  try { names = readdirSync(root); } catch { /* unreadable: nothing to sweep */ }
  for (const name of names) {
    const m = /^worca-cc-test-tmp-(\d+)-/.exec(name);
    if (!m || alive(Number(m[1]))) continue;
    const p = join(root, name);
    try { const st = lstatSync(p); if (st.isDirectory() && st.uid === uid && Date.now() - st.birthtimeMs >= minAgeMs) rmSync(p, { recursive: true, force: true }); } catch { /* another user's, or gone */ }
  }
  try { return mkdtempSync(join(root, `worca-cc-test-tmp-${pid}-`)); } catch { return null; }
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (o.related) {
    let r;
    try { r = relatedTests(ROOT, changedFiles(ROOT, o.base || 'HEAD')); } catch (e) { console.error(e.message); process.exit(2); }
    if (r.full) console.log(`related: ${r.reason}, running the full suite`);
    else if (!r.tests.length) { console.log('related: no test file depends on the changed files'); process.exit(0); }
    else { console.log(`related: ${r.tests.length} test files`); o.files = r.tests; }
  }
  let picked;
  try { picked = filesToRun(ROOT, o); } catch (e) { console.error(e.message); process.exit(2); }
  let files = picked.files;
  if (picked.left) console.log(`quarantine: ${picked.left} test files left out (test/quarantine.json)`);
  const timings = readJson('test/timings.json', {});
  const warning = o.files.length ? null : untimedWarning(files, timings);
  if (warning) console.log(`${annotateUntimed(process.env, o.shard) ? '::warning::' : ''}${warning}`);
  if (o.shard) {
    const m = /^(\d+)\/(\d+)$/.exec(o.shard);
    if (!m || +m[1] < 1 || +m[1] > +m[2]) { console.error(`bad shard "${o.shard}" (want i/n)`); process.exit(2); }
    files = planShards(files, timings, +m[2])[+m[1] - 1];
    console.log(`shard ${o.shard}: ${files.length} files`);
  } else {
    files = planShards(files, timings, 1)[0];
  }
  if (!files.length) { console.error('no test files selected'); process.exit(2); }

  const lockFile = fullSuiteLockFile();
  const locked = needsFullSuiteLock(o);
  if (locked) {
    await waitForFullSuiteLock(lockFile);
    process.on('exit', () => releaseFullSuiteLock(lockFile));
  }
  // Inside a Worca run TMPDIR is the run's scratch folder, under <home>/runs/: Ask's deny rules refuse every path there
  // (src/core/ask/deny-rules.mjs), so each file-tool fixture made in it reads as protected. The suite's temp files
  // then go to a folder of their own outside Worca's state, removed at the end.
  const outsideTmp = suiteTmpOutsideWorca(tmpdir());
  const tmpBase = outsideTmp ?? tmpdir();
  const home = mkdtempSync(join(tmpBase, 'worca-cc-test-home-'));
  const work = mkdtempSync(join(tmpBase, 'worca-cc-test-run-'));
  // A file subset gets its own WORCA_HOME: the shared .worca-cc-test may belong to a full run
  // in progress, and wiping it would turn that run red.
  const scoped = o.files.length > 0;
  const testHome = scoped ? join(work, 'worca-home') : join(ROOT, '.worca-cc-test');
  if (!scoped) rmSync(testHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  const listFile = join(work, 'files.json');
  const timingsOut = join(work, 'timings.json');
  const measure = o.writeTimings || o.timingsOut;
  const failuresFile = join(work, 'failures.json');
  writeFileSync(listFile, JSON.stringify({ files, concurrency: o.concurrency, timingsOut: measure ? timingsOut : null,
    measureTails: o.measureTails,
    ...(o.failuresOut ? { failuresOut: failuresFile } : {}) }));

  const env = { ...process.env, WORCA_HOME: scoped ? testHome : '.worca-cc-test', HOME: home, USERPROFILE: home,
    WORCA_NO_REAL_CLAUDE_LOG: join(testHome, 'real-claude-spawns.log'), // read by the shim and assert-none.mjs
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ') };
  delete env.WORCA_HOST_PID; // a test run is never a worca-hosted child
  delete env.WORCA_FLAGS; // feature flags (docs/feature-flags.md): a developer's shell flags never reach the suite
  delete env.WORCA_TEST_CONCURRENCY; // the worker cap travels in files.json (parseArgs); a test file never sees the runner's value
  env.WORCA_GIT ??= '1'; // P0 (S1): git forced on (no probe) unless the caller set it; rows that need "missing" use test/helpers/git-off.mjs
  delete env.CLAUDE_CONFIG_DIR; // skillHostFacts reads it (skills registry §4.1): a test never sees the developer's Claude config
  delete env.NODE_TEST_CONTEXT; // set inside a node:test file; run() would then skip every file
  if (outsideTmp) env.TMPDIR = outsideTmp;
  // HOME is the suite's own, so git's global config is too: a caller's GIT_CONFIG_GLOBAL (a developer's url.insteadOf
  // rewrites a remote a test pins), GIT_CONFIG_SYSTEM, XDG_CONFIG_HOME (git reads <it>/git/config beside the global
  // file) or injected config never reaches the tests.
  for (const k of Object.keys(env)) if (/^(GIT_CONFIG_(GLOBAL|SYSTEM|PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)|XDG_CONFIG_HOME)$/.test(k)) delete env[k];
  // A developer's own Azure DevOps / Bitbucket / push-as-person settings must not open host-lookup gates in tests
  // (D6/D7/D20): tests that need them set them with withEnv.
  for (const k of ['WORCA_ADO_TOKEN', 'WORCA_ADO_READ_TOKEN', 'WORCA_ADO_WRITE_TOKEN', 'AZURE_DEVOPS_EXT_PAT', 'WORCA_ADO_GIT_TOKEN',
    'WORCA_ADO_BOARDS_TOKEN', 'WORCA_BB_TOKEN', 'WORCA_BB_READ_TOKEN', 'WORCA_BB_WRITE_TOKEN', 'WORCA_BB_EMAIL', 'WORCA_BB_GIT_TOKEN', 'WORCA_BB_GIT_USER', 'WORCA_GH_AS_PERSON', 'WORCA_BROKER_URL']) delete env[k];
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[pathKey] = join(ROOT, 'test', 'helpers', 'no-real-claude') + delimiter + (env[pathKey] || '');

  const limitMin = Number(process.env.WORCA_TEST_SUITE_TIMEOUT_MIN);
  const timeoutMs = (Number.isFinite(limitMin) && limitMin > 0 ? limitMin : SUITE_TIMEOUT_MIN) * 60_000;
  let code = await runSuite([join(ROOT, 'tools', 'test-run.mjs'), listFile], { cwd: ROOT, env }, timeoutMs);
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
  if (o.failuresOut && code !== 0) {
    try {
      let failed = [];
      try { const v = JSON.parse(readFileSync(failuresFile, 'utf8')); if (Array.isArray(v)) failed = v.filter((f) => typeof f === 'string'); } catch { /* none recorded, or cut mid-write */ }
      const out = resolve(o.failuresOut);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(`${out}.tmp`, JSON.stringify(failureRecord({ tier: o.tier, shard: o.shard || '1/1', node: process.versions.node, files: failed }), null, 1) + '\n');
      renameSync(`${out}.tmp`, out);
    } catch (e) { console.error(`--failures-out: could not write the failure record: ${e.message}`); }
  }
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  if (outsideTmp) rmSync(outsideTmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  process.exit(code);
}

// Real paths on both sides: node loads the main module through its realpath (/tmp is
// /private/tmp on macOS; a symlinked checkout; a Windows junction), so a plain resolve()
// mismatch would skip main() and exit 0 having run no tests.
const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) await main();
