import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fullSuiteLockFile, mergeTimings, needsFullSuiteLock, parseArgs, planShards, releaseFullSuiteLock, selectFiles, suiteTmpOutsideWorca, tryFullSuiteLock } from '../tools/test.mjs';
import { timingFiles } from '../tools/test-timings-merge.mjs';
import YAML from 'yaml';

const TOOLS = fileURLToPath(new URL('../tools', import.meta.url));
const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 };

const files = Array.from({ length: 23 }, (_, i) => `test/f${String(i).padStart(2, '0')}.test.mjs`);
const timings = Object.fromEntries(files.map((f, i) => [f, (i * 7) % 11]));

test('shards partition the file list exactly (no file lost, none twice) for n = 1..6', () => {
  for (let n = 1; n <= 6; n++) {
    const shards = planShards(files, timings, n);
    assert.equal(shards.length, n, `n=${n}`);
    assert.deepEqual(shards.flat().sort(), [...files].sort(), `n=${n}`);
  }
});

test('shards are balanced by recorded time (max/min load within one file of each other)', () => {
  const shards = planShards(files, timings, 4);
  const load = (s) => s.reduce((a, f) => a + timings[f] + 0.5, 0);
  const loads = shards.map(load);
  assert.ok(Math.max(...loads) - Math.min(...loads) <= 10.5, loads.join(','));
});

test('unknown files get the mean weight and are still placed', () => {
  const extra = [...files, 'test/new-file.test.mjs'];
  assert.ok(planShards(extra, timings, 3).flat().includes('test/new-file.test.mjs'));
  // Mostly-zero timings: the median is 0, the mean 3.2. Priced at the mean (3.7 with the per-file
  // cost) the new file goes on the 6 s shard ahead of the zeros, which then split across both
  // shards; priced at the median every zero and the new file would stack behind the 6 s file.
  const skewed = { 'test/a.test.mjs': 10, 'test/b.test.mjs': 6, 'test/c.test.mjs': 0, 'test/d.test.mjs': 0, 'test/e.test.mjs': 0 };
  assert.deepEqual(planShards([...Object.keys(skewed), 'test/new.test.mjs'], skewed, 2),
    [['test/a.test.mjs', 'test/d.test.mjs'], ['test/b.test.mjs', 'test/new.test.mjs', 'test/c.test.mjs', 'test/e.test.mjs']]);
});

test('tier selection: slow globs and keepFast override', () => {
  const tiers = { slow: ['test/orchestrator-*.test.mjs', 'test/git-sync.test.mjs'], keepFast: ['test/orchestrator-guardrails.test.mjs'] };
  const all = ['test/a.test.mjs', 'test/git-sync.test.mjs', 'test/orchestrator-x.test.mjs', 'test/orchestrator-guardrails.test.mjs'];
  assert.deepEqual(selectFiles({ all, tier: 'slow', tiers }).sort(), ['test/git-sync.test.mjs', 'test/orchestrator-x.test.mjs']);
  assert.deepEqual(selectFiles({ all, tier: 'fast', tiers }).sort(), ['test/a.test.mjs', 'test/orchestrator-guardrails.test.mjs']);
  assert.deepEqual(selectFiles({ all, tier: 'all', tiers }).sort(), [...all].sort());
});

test('main() runs when tools/test.mjs is reached through a symlink (else npm test exits 0 having run nothing)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-link-'));
  try {
    const link = join(dir, 'tools');
    symlinkSync(TOOLS, link, 'junction'); // a junction needs no admin rights on Windows; the type is ignored elsewhere
    // A bad shard exits 2 before main() touches .worca-cc-test or runs anything.
    const r = spawnSync(process.execPath, [join(link, 'test.mjs'), '--shard', '0/1'], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /bad shard "0\/1"/);
  } finally { rmSync(dir, rmOpts); }
});

test('parseArgs: a flag that needs a value refuses a missing one (a bare --shard once ran the whole suite); the shard env never splits a file list', () => {
  for (const flag of ['--shard', '--tier', '--concurrency', '--timings-out']) {
    assert.throws(() => parseArgs([flag], {}), new RegExp(`${flag} needs a value`));
    assert.throws(() => parseArgs([flag, '--write-timings'], {}), new RegExp(`${flag} needs a value`));
  }
  assert.throws(() => parseArgs(['--concurrency', '0'], {}), /positive integer/);
  assert.equal(parseArgs([], { WORCA_TEST_SHARD: '2/4' }).shard, '2/4');
  assert.equal(parseArgs(['test/a.test.mjs'], { WORCA_TEST_SHARD: '2/4' }).shard, null);
  assert.equal(parseArgs(['--shard', '1/3', 'test/a.test.mjs'], {}).shard, '1/3');
});

test('parseArgs takes the worker cap from WORCA_TEST_CONCURRENCY', () => {
  assert.equal(parseArgs([], { WORCA_TEST_CONCURRENCY: '6' }).concurrency, 6);
});

test('--concurrency beats WORCA_TEST_CONCURRENCY; a bad value is ignored', () => {
  assert.equal(parseArgs([], { WORCA_TEST_CONCURRENCY: '4' }).concurrency, 4);
  assert.equal(parseArgs(['--concurrency', '2'], { WORCA_TEST_CONCURRENCY: '6' }).concurrency, 2);
  for (const v of ['', '0', 'x', '2.5']) assert.equal(parseArgs([], { WORCA_TEST_CONCURRENCY: v }).concurrency, null, `"${v}"`);
});

test('a test file never inherits WORCA_TEST_CONCURRENCY (the worker cap travels in files.json)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-cap-'));
  try {
    const file = join(dir, 'scope.test.mjs');
    writeFileSync(file, "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('no cap', () => { assert.equal(process.env.WORCA_TEST_CONCURRENCY, undefined); });\n");
    const r = spawnSync(process.execPath, [join(TOOLS, 'test.mjs'), file],
      { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, WORCA_TEST_CONCURRENCY: '6' } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /pass 1\b/);
  } finally { rmSync(dir, rmOpts); }
});

test('a file subset runs in its own WORCA_HOME (never the shared .worca-cc-test a full run may be using), ignores WORCA_TEST_SHARD and never inherits CLAUDE_CONFIG_DIR, exports WORCA_GIT=1 unless set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-scope-'));
  try {
    const file = join(dir, 'scope.test.mjs');
    writeFileSync(file, [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { isAbsolute, join } from 'node:path';",
      "test('scoped', () => {",
      '  const h = process.env.WORCA_HOME;',
      "  assert.ok(isAbsolute(h) && !h.endsWith('.worca-cc-test'), h);",
      "  assert.equal(process.env.WORCA_NO_REAL_CLAUDE_LOG, join(h, 'real-claude-spawns.log'));",
      "  assert.equal(process.env.CLAUDE_CONFIG_DIR, undefined, 'a test never reads the developer Claude config');",
      "  assert.equal(process.env.WORCA_GIT, '1', 'the suite runs with git forced on unless set (P0, S1)');",
      '});',
      '',
    ].join('\n'));
    const env = { ...process.env, NODE_TEST_CONTEXT: undefined, WORCA_TEST_SHARD: '2/4', CLAUDE_CONFIG_DIR: dir, WORCA_GIT: undefined };
    const r = spawnSync(process.execPath, [join(TOOLS, 'test.mjs'), file], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /pass 1\b/);
  } finally { rmSync(dir, rmOpts); }
});

test('--timings-out writes the run\'s own per-file seconds, spawn to exit (what a CI shard uploads), and leaves test/timings.json alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-timings-'));
  try {
    const file = join(dir, 'timed.test.mjs');
    // 400 ms of module-level setup outside any test: a shard pays it, so the recorded time must include it.
    writeFileSync(file, "import { test } from 'node:test';\nawait new Promise((r) => setTimeout(r, 400));\ntest('a', () => {});\ntest('b', () => {});\n");
    const out = join(dir, 'nested', 'shard-1.json');
    const before = readFileSync(new URL('./timings.json', import.meta.url), 'utf8');
    const r = spawnSync(process.execPath, [join(TOOLS, 'test.mjs'), '--timings-out', out, file],
      { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const measured = JSON.parse(readFileSync(out, 'utf8'));
    assert.deepEqual(Object.keys(measured), [Object.keys(measured)[0]]);
    assert.ok(Object.keys(measured)[0].endsWith('/timed.test.mjs'), Object.keys(measured)[0]);
    assert.ok(Object.values(measured)[0] >= 0.4, `the file's whole run, not just its tests: ${Object.values(measured)[0]}`);
    assert.equal(readFileSync(new URL('./timings.json', import.meta.url), 'utf8'), before, 'only --write-timings rewrites test/timings.json');
  } finally { rmSync(dir, rmOpts); }
});

test('a measuring run: a file whose process stays up over 2 s after its last test gets a tail warning; a file that exits at once does not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-tail-'));
  try {
    const held = join(dir, 'held.test.mjs');
    const clean = join(dir, 'clean.test.mjs');
    // A ref'd timer armed by the test holds the process 2.5 s after the test passes.
    writeFileSync(held, "import { test } from 'node:test';\ntest('arms a timer', () => { setTimeout(() => {}, 2500); });\n");
    writeFileSync(clean, "import { test } from 'node:test';\ntest('arms an unref timer', () => { setTimeout(() => {}, 2500).unref(); });\n");
    // Only a measuring run sees tails: elsewhere forceExit ends a file as soon as its tests are done.
    const r = spawnSync(process.execPath, [join(TOOLS, 'test.mjs'), '--timings-out', join(dir, 't.json'), held, clean],
      { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const warned = r.stderr.split('\n').filter((l) => l.startsWith('warning: '));
    assert.equal(warned.length, 1, r.stderr);
    const m = warned[0].match(/\/held\.test\.mjs stayed up (\d+\.\d) s outside its tests/);
    assert.ok(m && +m[1] >= 2.4, warned[0]);
  } finally { rmSync(dir, rmOpts); }
});

test('forceExit: a file still held open after its tests (a live server, a ref\'d timer) no longer holds the run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-force-'));
  try {
    const held = join(dir, 'held.test.mjs');
    writeFileSync(held, "import { test } from 'node:test';\nimport { createServer } from 'node:http';\ntest('leaves a server listening', () => { createServer().listen(0); setTimeout(() => {}, 60_000); });\n");
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [join(TOOLS, 'test.mjs'), held],
      { encoding: 'utf8', timeout: 30_000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(Date.now() - t0 < 20_000, `took ${Date.now() - t0} ms: the file's process outlived its tests`);
  } finally { rmSync(dir, rmOpts); }
});

test('the whole-suite timeout stops the run and every test process it started (WORCA_TEST_SUITE_TIMEOUT_MIN)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-limit-'));
  try {
    const hung = join(dir, 'hung.test.mjs');
    const pidFile = join(dir, 'pid');
    writeFileSync(hung, `import { test } from 'node:test';\nimport { writeFileSync } from 'node:fs';\ntest('never ends', async () => { writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); await new Promise(() => setInterval(() => {}, 1000)); });\n`);
    const t0 = Date.now();
    const child = spawn(process.execPath, [join(TOOLS, 'test.mjs'), hung],
      { env: { ...process.env, NODE_TEST_CONTEXT: undefined, WORCA_TEST_SUITE_TIMEOUT_MIN: '0.05' } });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const code = await new Promise((r) => child.on('close', r));
    assert.equal(code, 1, err);
    assert.match(err, /ran past its \d+ min limit/);
    assert.ok(Date.now() - t0 < 20_000, `took ${Date.now() - t0} ms`);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 200));
    assert.throws(() => process.kill(pid, 0), /ESRCH/, 'the test file\'s own process was killed too');
  } finally { rmSync(dir, rmOpts); }
});

test('full-suite lock: one holder at a time, a dead holder is taken over, release only frees our own lock; only unscoped local runs take it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-lock-'));
  try {
    const file = join(dir, 'full.lock');
    const now = Date.now();
    const me = { pid: process.pid, cwd: '/a', at: now };
    assert.deepEqual(tryFullSuiteLock(file, me), { ok: true });
    const other = tryFullSuiteLock(file, { pid: process.ppid, cwd: '/b', at: now });
    assert.equal(other.ok, false);
    assert.equal(other.holder.cwd, '/a');
    releaseFullSuiteLock(file, process.ppid);                 // not the holder: no effect
    assert.equal(tryFullSuiteLock(file, { pid: process.ppid, cwd: '/b', at: now }).ok, false);
    releaseFullSuiteLock(file, process.pid);
    assert.equal(tryFullSuiteLock(file, { pid: process.ppid, cwd: '/b', at: now }).ok, true);
    writeFileSync(file, JSON.stringify({ pid: 2 ** 22 + 12345, cwd: '/dead', at: 0 }));   // no such process
    assert.equal(tryFullSuiteLock(file, me).ok, true);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).cwd, '/a');
    // A live pid that took the lock longer ago than any suite may run (a pid taken again): stale too.
    writeFileSync(file, JSON.stringify({ pid: process.ppid, cwd: '/old', at: now - 3 * 3600_000 }));
    assert.equal(tryFullSuiteLock(file, me).ok, true);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).cwd, '/a');
    // A stale lock nobody can remove (a folder holding a file at the name) is run past, never waited on or thrown.
    const stuck = join(dir, 'stuck.lock');
    mkdirSync(stuck); writeFileSync(join(stuck, 'f'), 'x'); utimesSync(stuck, 1, 1);
    assert.deepEqual(tryFullSuiteLock(stuck, me), { ok: true });
    const o = (x) => ({ files: [], shard: null, ...x });
    assert.equal(needsFullSuiteLock(o({}), {}), true);
    assert.equal(needsFullSuiteLock(o({ files: ['test/a.test.mjs'] }), {}), false);
    assert.equal(needsFullSuiteLock(o({ shard: '1/4' }), {}), false);
    assert.equal(needsFullSuiteLock(o({}), { CI: 'true' }), false);
    assert.equal(needsFullSuiteLock(o({}), { WORCA_TEST_NO_LOCK: '1' }), false);
    // One lock for the whole machine: a run's own TMPDIR never moves it; the override still does.
    assert.equal(fullSuiteLockFile({ TMPDIR: '/Users/u/.worca-cc/runs/r1/.scratch' }, 'darwin', 501), '/tmp/worca-cc-full-suite-501.lock');
    assert.equal(fullSuiteLockFile({}, 'linux', 1000), '/tmp/worca-cc-full-suite-1000.lock');
    assert.equal(fullSuiteLockFile({ WORCA_TEST_LOCK_FILE: '/x/l.lock' }, 'darwin'), '/x/l.lock');
    assert.equal(fullSuiteLockFile({}, 'win32'), join(tmpdir(), 'worca-cc-full-suite.lock'));
  } finally { rmSync(dir, rmOpts); }
});

test('mergeTimings: later measurements win, files that are gone drop out, keys sorted; timingFiles walks dirs for .json only', () => {
  const live = new Set(['test/a.test.mjs', 'test/b.test.mjs', 'test/c.test.mjs']);
  assert.deepEqual(
    Object.entries(mergeTimings({ 'test/b.test.mjs': 9, 'test/gone.test.mjs': 4, 'test/a.test.mjs': 1 },
      [{ 'test/b.test.mjs': 2 }, { 'test/c.test.mjs': 3, 'test/b.test.mjs': 5 }], (k) => live.has(k))),
    [['test/a.test.mjs', 1], ['test/b.test.mjs', 5], ['test/c.test.mjs', 3]],
  );
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-timings-merge-'));
  try {
    mkdirSync(join(dir, 'test-timings-fast-2'), { recursive: true });
    writeFileSync(join(dir, 'test-timings-fast-2', 'fast-2.json'), '{}');
    writeFileSync(join(dir, 'fast-1.json'), '{}');
    writeFileSync(join(dir, 'notes.txt'), '');
    assert.deepEqual(timingFiles([dir]).map((f) => f.slice(dir.length + 1).replace(/\\/g, '/')), ['fast-1.json', 'test-timings-fast-2/fast-2.json']);
  } finally { rmSync(dir, rmOpts); }
});

test('test-run exits like node --test: a failing test or an import crash is red, a failing todo is green', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-exit-'));
  try {
    const cases = [
      ['todo.test.mjs', "test('t', { todo: true }, () => { throw new Error('later'); });", 0],
      ['red.test.mjs', "test('r', () => { throw new Error('red'); });", 1],
      ['crash.test.mjs', "throw new Error('at import');", 1],
    ];
    for (const [name, body, want] of cases) {
      const file = join(dir, name);
      writeFileSync(file, `import { test } from 'node:test';\n${body}\n`);
      const list = join(dir, `${name}.json`);
      writeFileSync(list, JSON.stringify({ files: [file], concurrency: 1, timingsOut: null }));
      // NODE_TEST_CONTEXT is set inside this test file; inherited, run() would skip every file.
      const r = spawnSync(process.execPath, [join(TOOLS, 'test-run.mjs'), list],
        { cwd: dir, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
      assert.equal(r.status, want, `${name}\n${r.stdout}${r.stderr}`);
    }
  } finally { rmSync(dir, rmOpts); }
});

test('every tiers.json entry matches at least one test file (a typo silently moves nothing)', () => {
  const tiers = JSON.parse(readFileSync(new URL('./tiers.json', import.meta.url), 'utf8'));
  const all = readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.mjs')).map((f) => `test/${f}`);
  for (const g of [...tiers.slow, ...tiers.keepFast]) {
    assert.ok(selectFiles({ all, tier: 'slow', tiers: { slow: [g] } }).length > 0, `${g} matches no file`);
  }
});

test('ci.yml engine filter lists every slow-tier entry of tiers.json', () => {
  const yml = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const { slow } = JSON.parse(readFileSync(new URL('./tiers.json', import.meta.url), 'utf8'));
  for (const g of slow) assert.ok(yml.includes(`- '${g}'`), `ci.yml engine filter is missing ${g}`);
});

test('parseArgs --related: takes --base, refuses --base alone and a file list, and never reads the shard env', () => {
  assert.deepEqual(
    (({ related, base, shard, files }) => ({ related, base, shard, files }))(parseArgs(['--related', '--base', 'origin/dev'], { WORCA_TEST_SHARD: '1/4' })),
    { related: true, base: 'origin/dev', shard: null, files: [] },
  );
  assert.throws(() => parseArgs(['--base', 'origin/dev']), /--base needs --related/);
  assert.throws(() => parseArgs(['--related', 'test/a.test.mjs']), /drop the file list/);
  assert.throws(() => parseArgs(['--related', '--base']), /--base needs a value/);
});

test('suiteTmpOutsideWorca: a TMPDIR inside a .worca-cc folder gets a folder of its own under root, sweeping our dead suites\' folders; any other TMPDIR, Windows, or an unwritable root, none', () => {
  const root = mkdtempSync(join(tmpdir(), 'worca-cc-suite-tmp-'));
  try {
    const dead = 2 ** 22 + 12345;                                      // no such process
    for (const n of [`worca-cc-test-tmp-${dead}-aaaaaa`, `worca-cc-test-tmp-${process.pid}-live01`, 'unrelated']) mkdirSync(join(root, n));
    const victim = join(root, 'unrelated');
    writeFileSync(join(victim, 'keep'), 'x');
    symlinkSync(victim, join(root, `worca-cc-test-tmp-${dead}-link`));   // a link at one of our names is never followed
    const run = '/Users/u/.worca-cc/runs/ab12/.scratch';
    const names = () => readdirSync(root).sort();
    const before = names();
    // A dead runner's folder younger than the limit (a live suite in a sandbox with its own pids), or another user's: kept.
    const young = suiteTmpOutsideWorca(run, { platform: 'darwin', root, pid: 776 });
    const foreign = suiteTmpOutsideWorca(run, { platform: 'darwin', root, pid: 776, minAgeMs: 0, uid: -2 });
    assert.deepEqual(names(), [...before, young.slice(root.length + 1), foreign.slice(root.length + 1)].sort());
    const got = suiteTmpOutsideWorca(run, { platform: 'darwin', root, pid: 777, minAgeMs: 0 });
    assert.ok(got.startsWith(join(root, 'worca-cc-test-tmp-777-')), got);
    // Ours, dead and old enough goes.
    assert.equal(names().includes(`worca-cc-test-tmp-${dead}-aaaaaa`), false);
    for (const n of [`worca-cc-test-tmp-${process.pid}-live01`, got.slice(root.length + 1), 'unrelated', `worca-cc-test-tmp-${dead}-link`]) assert.ok(names().includes(n), n);
    assert.equal(readFileSync(join(victim, 'keep'), 'utf8'), 'x');
    assert.ok(suiteTmpOutsideWorca('/Users/u/.worca-cc', { platform: 'linux', root }));
    assert.equal(suiteTmpOutsideWorca(run, { platform: 'darwin', root: join(root, 'missing') }), null);
    assert.equal(suiteTmpOutsideWorca('/var/folders/x/T', { platform: 'darwin', root }), null);
    assert.equal(suiteTmpOutsideWorca('/Users/u/my.worca-cc/tmp', { platform: 'linux', root }), null);
    assert.equal(suiteTmpOutsideWorca('C:\\Users\\u\\.worca-cc\\runs\\x', { platform: 'win32', root }), null);
  } finally { rmSync(root, rmOpts); }
});

// ── ci.yml's `CI gate` ─────────────────────────────────────────────────────────────────────
// One always-running job, `ci-gate`, needs every other job, so a required check always reports
// (docs-only PRs too) and no job can slip past it. gateProblems is pure so each rule is proven on a
// mutated copy without touching the real workflow. It returns one string per problem.
const ALWAYS = '${{ always() }}';
export function gateProblems(doc) {
  const problems = [];
  const jobs = doc?.jobs || {};
  for (const ev of ['push', 'pull_request']) {
    for (const key of ['paths', 'paths-ignore']) {
      if (doc?.on?.[ev] && typeof doc.on[ev] === 'object' && key in doc.on[ev]) problems.push(`on.${ev}.${key}: the workflow must always start so the gate always reports`);
    }
  }
  const c = doc?.concurrency || {};
  if (c['cancel-in-progress'] !== "${{ github.event_name == 'pull_request' }}") problems.push(`concurrency: cancel-in-progress must be \${{ github.event_name == 'pull_request' }}, not ${JSON.stringify(c['cancel-in-progress'])}`);
  if (!String(c.group || '').includes('github.run_id')) problems.push('concurrency: the push group must be per run (github.run_id)');

  const gate = jobs['ci-gate'];
  if (!gate) return [...problems, 'ci-gate: no job with id ci-gate'];
  if (gate.name !== 'CI gate') problems.push(`ci-gate name: ${JSON.stringify(gate.name)}, want "CI gate"`);
  if (gate.if !== ALWAYS) problems.push(`ci-gate if: ${JSON.stringify(gate.if)}, want ${ALWAYS} (a skipped gate reads as Success)`);
  if (gate.permissions?.['pull-requests'] !== 'read') problems.push('ci-gate permissions: pull-requests: read is needed for the PR-head lookup');
  const others = Object.keys(jobs).filter((id) => id !== 'ci-gate');
  const needs = [].concat(gate.needs || []);
  for (const id of others) if (!needs.includes(id)) problems.push(`ci-gate needs is missing ${id}`);
  for (const id of needs) if (!others.includes(id)) problems.push(`ci-gate needs names unknown job ${id}`);
  if (others.every((id) => needs.includes(id)) && needs.length === others.length && needs.join() !== others.join()) problems.push(`ci-gate needs: not in file order (${others.join(', ')})`);

  const steps = gate.steps || [];
  const checkout = steps.find((s) => String(s.uses || '').startsWith('actions/checkout@'));
  const sparse = checkout?.with?.['sparse-checkout'];
  if (!checkout) problems.push('ci-gate checkout: no actions/checkout step');
  else if (sparse != null && checkout.with['sparse-checkout-cone-mode'] !== false) {
    const pats = String(sparse).split('\n').map((s) => s.trim()).filter(Boolean);
    if (!pats.some((p) => p === 'tools' || p === 'tools/') || pats.some((p) => /\.[A-Za-z0-9]+$/.test(p)))
      problems.push(`ci-gate checkout: sparse-checkout ${JSON.stringify(sparse)} in cone mode must list the tools directory, not a file`);
  }
  const last = steps[steps.length - 1] || {};
  if (!/\bnode tools\/ci-gate\.mjs\b/.test(String(last.run || '')) || last.env?.NEEDS !== '${{ toJSON(needs) }}')
    problems.push('ci-gate steps: the last step must run node tools/ci-gate.mjs with NEEDS: ${{ toJSON(needs) }}');

  const changes = jobs.changes;
  const codeRef = String(changes?.outputs?.code || '').match(/steps\.([\w-]+)\.outputs\.code/);
  const codeStep = codeRef && (changes.steps || []).find((s) => s.id === codeRef[1]);
  if (!codeRef) problems.push('changes: no outputs.code from a filter step');
  else if (!codeStep || !String(codeStep.uses || '').startsWith('dorny/paths-filter@') || codeStep.with?.['predicate-quantifier'] !== 'every')
    problems.push('changes: the code filter step must be dorny/paths-filter with predicate-quantifier: every');

  for (const id of others.filter((j) => j !== 'changes')) {
    const job = jobs[id] || {};
    const cond = String(job.if || '');
    if (![].concat(job.needs || []).includes('changes')) problems.push(`${id}: needs: changes is missing`);
    if (!cond.includes('!cancelled()') || !cond.includes("needs.changes.outputs.code != 'false'"))
      problems.push(`${id}: if must hold !cancelled() and needs.changes.outputs.code != 'false'`);
  }
  if (jobs['test-slow'] && !String(jobs['test-slow'].if || '').includes("needs.changes.outputs.engine != 'false'"))
    problems.push("test-slow: if lost needs.changes.outputs.engine != 'false'");

  for (const [id, job] of Object.entries(jobs)) {
    for (const s of job?.steps || []) if (String(s.run ?? '').trim() === 'exit 1') problems.push(`${id}: a step runs exactly "exit 1" (a proof step leaked in)`);
  }
  return problems;
}

const ciDoc = () => YAML.parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
// Each mutation is checked against a clean real ci.yml, so a rule can't "pass" on an unrelated problem.
const mutated = (fn) => {
  const base = ciDoc();
  assert.deepEqual(gateProblems(base), [], 'the real ci.yml is clean before the mutation');
  const doc = structuredClone(base);
  fn(doc);
  return gateProblems(doc);
};
const hasProblem = (problems, re, what) => assert.ok(problems.some((p) => re.test(p)), `${what}: ${JSON.stringify(problems)}`);

test('ci.yml CI gate: the real workflow has no gate problem', () => {
  assert.deepEqual(gateProblems(ciDoc()), []);
});

test('ci.yml CI gate: a lint job missing from the gate\'s needs is named', () => {
  const p = mutated((d) => { d.jobs.lint = { name: 'lint', needs: 'changes', if: "${{ !cancelled() && (github.event_name != 'pull_request' || needs.changes.outputs.code != 'false') }}", 'runs-on': 'ubuntu-latest', steps: [{ run: 'npm run lint' }] }; });
  hasProblem(p, /ci-gate needs is missing lint/, 'lint missing');
});

test('ci.yml CI gate: the gate\'s if must be exactly ${{ always() }}', () => {
  hasProblem(mutated((d) => { d.jobs['ci-gate'].if = '${{ !cancelled() }}'; }), /^ci-gate if:/, '!cancelled()');
  hasProblem(mutated((d) => { delete d.jobs['ci-gate'].if; }), /^ci-gate if:/, 'no if');
});

test('ci.yml CI gate: paths or paths-ignore under on: is a problem', () => {
  hasProblem(mutated((d) => { d.on.pull_request = { ...(d.on.pull_request || {}), paths: ['**', '!docs/**'] }; }), /on\.pull_request\.paths\b/, 'pull_request.paths');
  hasProblem(mutated((d) => { d.on.push['paths-ignore'] = ['docs/**']; }), /on\.push\.paths-ignore/, 'push.paths-ignore');
});

test('ci.yml CI gate: a job without needs: changes or the docs-only if is named', () => {
  hasProblem(mutated((d) => { delete d.jobs.cdp.needs; }), /^cdp: needs: changes/, 'cdp needs');
  hasProblem(mutated((d) => { d.jobs.cdp.if = "${{ github.event_name != 'pull_request' || needs.changes.outputs.code != 'false' }}"; }), /^cdp: if/, 'cdp no !cancelled()');
  hasProblem(mutated((d) => { d.jobs.cdp.if = '${{ !cancelled() }}'; }), /^cdp: if/, 'cdp no code clause');
});

test('ci.yml CI gate: changes must output code from an every-quantifier filter step', () => {
  hasProblem(mutated((d) => { delete d.jobs.changes.outputs.code; }), /^changes:/, 'no outputs.code');
  hasProblem(mutated((d) => {
    const id = d.jobs.changes.outputs.code.match(/steps\.([\w-]+)\./)[1];
    delete d.jobs.changes.steps.find((s) => s.id === id).with['predicate-quantifier'];
  }), /^changes:/, 'no predicate-quantifier');
});

test('ci.yml CI gate: test-slow keeps its engine clause', () => {
  hasProblem(mutated((d) => { d.jobs['test-slow'].if = d.jobs['test-slow'].if.replace(" && needs.changes.outputs.engine != 'false'", '').replace("needs.changes.outputs.engine != 'false'", 'true'); }), /^test-slow:/, 'engine clause');
});

test('ci.yml CI gate: the gate needs the other jobs in file order', () => {
  hasProblem(mutated((d) => { d.jobs['ci-gate'].needs = [].concat(d.jobs['ci-gate'].needs).reverse(); }), /ci-gate needs: not in file order/, 'reversed needs');
});

test('ci.yml CI gate: concurrency cancels PR runs only, with a per-run push group', () => {
  hasProblem(mutated((d) => { d.concurrency['cancel-in-progress'] = true; }), /^concurrency:/, 'cancel-in-progress: true');
  hasProblem(mutated((d) => { d.concurrency.group = 'ci-${{ github.head_ref || github.ref_name }}'; }), /^concurrency:.*run_id/, 'no run_id');
});

test('ci.yml CI gate: the sparse checkout lists the tools directory, never a file', () => {
  const co = (d) => d.jobs['ci-gate'].steps.find((s) => String(s.uses || '').startsWith('actions/checkout@'));
  hasProblem(mutated((d) => { co(d).with = { ...(co(d).with || {}), 'sparse-checkout': 'tools/ci-gate.mjs' }; }), /^ci-gate checkout:/, 'file path');
  const base = ciDoc();
  const none = structuredClone(base); delete co(none).with?.['sparse-checkout'];
  assert.deepEqual(gateProblems(none), [], 'no sparse-checkout passes');
  const dir = structuredClone(base); co(dir).with = { ...(co(dir).with || {}), 'sparse-checkout': 'tools' };
  assert.deepEqual(gateProblems(dir), [], 'tools in cone mode passes');
});

test('ci.yml CI gate: the last gate step runs node tools/ci-gate.mjs with NEEDS from toJSON(needs)', () => {
  hasProblem(mutated((d) => { const s = d.jobs['ci-gate'].steps; s[s.length - 1].run = 'echo ok'; }), /^ci-gate steps:/, 'wrong run');
  hasProblem(mutated((d) => { const s = d.jobs['ci-gate'].steps; delete s[s.length - 1].env.NEEDS; }), /^ci-gate steps:/, 'no NEEDS');
});

test('ci.yml CI gate: a bare "exit 1" proof step is rejected', () => {
  hasProblem(mutated((d) => { d.jobs.extension.steps.unshift({ run: 'exit 1' }); }), /^extension: .*exit 1/, 'exit 1');
});
