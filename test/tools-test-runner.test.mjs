import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
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
  // Quarantine wins over tiers: a quarantined fast file and a quarantined slow-glob file leave fast, slow and all.
  const quarantined = new Set(['test/a.test.mjs', 'test/orchestrator-x.test.mjs']);
  assert.deepEqual(selectFiles({ all, tier: 'slow', tiers, quarantined }).sort(), ['test/git-sync.test.mjs']);
  assert.deepEqual(selectFiles({ all, tier: 'fast', tiers, quarantined }).sort(), ['test/orchestrator-guardrails.test.mjs']);
  assert.deepEqual(selectFiles({ all, tier: 'all', tiers, quarantined }).sort(),
    ['test/git-sync.test.mjs', 'test/orchestrator-guardrails.test.mjs']);
});

test('filesToRun: a temp root\'s quarantined file leaves fast, slow and all, an explicit list keeps it, and a malformed list throws', async () => {
  const { filesToRun } = await import('../tools/test.mjs');
  assert.equal(typeof filesToRun, 'function', 'tools/test.mjs exports filesToRun(root, o)');
  const root = mkdtempSync(join(tmpdir(), 'worca-cc-runner-quarantine-'));
  try {
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test', 'tiers.json'), JSON.stringify({ slow: ['test/s.test.mjs'], keepFast: [] }));
    writeFileSync(join(root, 'test', 'quarantine.json'), JSON.stringify({ entries: [{ path: 'test/q.test.mjs', reason: 'flaky', exitCondition: 'green 20x' }] }));
    for (const n of ['f', 's', 'q']) writeFileSync(join(root, 'test', `${n}.test.mjs`), '');
    const got = {};
    for (const tier of ['fast', 'slow', 'all']) {
      const r = filesToRun(root, { files: [], tier });
      assert.ok(!r.files.includes('test/q.test.mjs'), `${tier}: ${r.files}`);
      assert.equal(r.left, 1, `${tier}: left`);
      got[tier] = r.files;
    }
    assert.deepEqual(got.fast, ['test/f.test.mjs']);
    assert.deepEqual(got.slow, ['test/s.test.mjs']);
    assert.deepEqual(got.all, ['test/f.test.mjs', 'test/s.test.mjs']);
    // I1: fast and slow are disjoint and, with the quarantined file, cover every test file.
    assert.deepEqual([...got.fast, ...got.slow, 'test/q.test.mjs'].sort(), ['test/f.test.mjs', 'test/q.test.mjs', 'test/s.test.mjs']);
    // I3: an explicit list runs what it is given, quarantined or not.
    assert.deepEqual(filesToRun(root, { files: ['test/q.test.mjs'], tier: 'all' }), { files: ['test/q.test.mjs'], left: 0 });
    // I7: a broken list never silently re-tiers.
    writeFileSync(join(root, 'test', 'quarantine.json'), '{ not json');
    assert.throws(() => filesToRun(root, { files: [], tier: 'fast' }), /not valid JSON/);
  } finally { rmSync(root, rmOpts); }
  // main() keeps no selection of its own: it goes through the one seam.
  const src = readFileSync(join(TOOLS, 'test.mjs'), 'utf8');
  const body = src.slice(src.indexOf('async function main()'));
  assert.ok(body.includes('filesToRun(ROOT, o)'), 'main() calls filesToRun(ROOT, o)');
  assert.ok(!body.includes('selectFiles('), 'main() makes no selectFiles( call');
});

test('test/quarantine.json: every entry names an existing test file, spec or proof and carries reason and exitCondition', async () => {
  const { readQuarantine, quarantineProblems } = await import('../tools/quarantine.mjs');
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const exists = (p) => existsSync(join(ROOT, p));
  const tiers = JSON.parse(readFileSync(new URL('./tiers.json', import.meta.url), 'utf8'));
  const entries = readQuarantine(ROOT);
  assert.deepEqual(quarantineProblems(entries, { exists, tiers }), []);
  // Each mutated copy of the real list yields exactly its one message. The probe paths leave the base copy first, so a
  // real entry for one of them never adds a "listed twice".
  const withEntry = (e) => quarantineProblems([...structuredClone(entries).filter((x) => x.path !== e.path), e], { exists, tiers });
  assert.deepEqual(withEntry({ path: 'test/ui-ask-side-shell.test.mjs', exitCondition: 'x' }), ['test/ui-ask-side-shell.test.mjs: no reason']);
  assert.deepEqual(withEntry({ path: 'test/ui-ask-side-shell.test.mjs', reason: 'x' }), ['test/ui-ask-side-shell.test.mjs: no exitCondition']);
  assert.deepEqual(withEntry({ path: 'test/no-such-file.test.mjs', reason: 'x', exitCondition: 'x' }), ['test/no-such-file.test.mjs: no such file']);
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
  for (const flag of ['--shard', '--tier', '--concurrency', '--timings-out', '--failures-out']) {
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

// --failures-out: a red run writes one failure record { version, tier, shard, node, files } (what a CI shard
// uploads for the gate summary); a green run writes nothing.
const failuresFixture = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-failures-'));
  try {
    const w = (name, body) => { const f = join(dir, name); writeFileSync(f, "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n" + body); return f; };
    const f = {
      bad: w('bad.test.mjs', "test('passes', () => {});\ntest('fails', () => { assert.equal(1, 2); });\n"),
      good: w('good.test.mjs', "test('passes', () => {});\n"),
      todo: w('todo.test.mjs', "test('a failing todo', { todo: true }, () => { assert.equal(1, 2); });\n"),
      boom: w('boom.test.mjs', "throw new Error('boom at import');\n"),
    };
    return fn({ dir, f });
  } finally { rmSync(dir, rmOpts); }
};
const runFailures = (args) => spawnSync(process.execPath, [join(TOOLS, 'test.mjs'), ...args],
  { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } });

test('--failures-out lists the failing file only', () => failuresFixture(({ dir, f }) => {
  const out = join(dir, 'nested', 'fast-24-3.json');
  const r = runFailures(['--failures-out', out, '--shard', '1/1', f.bad, f.good, f.todo]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(existsSync(out), 'a red run writes its record: ' + r.stderr);
  const record = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(Object.keys(record).sort(), ['files', 'node', 'shard', 'tier', 'version']);
  assert.deepEqual({ ...record, files: undefined }, { version: 1, tier: 'all', shard: '1/1', node: process.versions.node, files: undefined });
  assert.equal(record.files.length, 1, JSON.stringify(record.files));
  assert.ok(record.files[0].endsWith('/bad.test.mjs'), record.files[0]);

  // A file that throws at import (no test of its own) fails at file level and is listed too.
  const out2 = join(dir, 'boom.json');
  const r2 = runFailures(['--failures-out', out2, f.boom, f.good]);
  assert.equal(r2.status, 1, r2.stdout + r2.stderr);
  const record2 = JSON.parse(readFileSync(out2, 'utf8'));
  assert.equal(record2.shard, '1/1', 'unsharded reads 1/1');
  assert.equal(record2.files.length, 1, JSON.stringify(record2.files));
  assert.ok(record2.files[0].endsWith('/boom.test.mjs'), record2.files[0]);
}));

test('--failures-out: a green run writes nothing', () => failuresFixture(({ dir, f }) => {
  const out = join(dir, 'green.json');
  const r = runFailures(['--failures-out', out, '--shard', '1/1', f.good, f.todo]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(existsSync(out), false, 'a green run (a failing todo included) writes no record');
}));

test('failureRecord: the D2 shape, files sorted by code unit and deduped', async () => {
  const mod = await import('../tools/test.mjs');
  assert.equal(typeof mod.failureRecord, 'function', 'tools/test.mjs exports failureRecord');
  assert.deepEqual(mod.failureRecord({ tier: 'fast', shard: '3/4', node: '24.11.0', files: ['test/b.test.mjs', 'test/B.test.mjs', 'test/a.test.mjs', 'test/b.test.mjs'] }),
    { version: 1, tier: 'fast', shard: '3/4', node: '24.11.0', files: ['test/B.test.mjs', 'test/a.test.mjs', 'test/b.test.mjs'] });
});

const heldTimer = "import { test } from 'node:test';\ntest('arms a timer', () => { setTimeout(() => {}, 4000); });\n";
const cleanTimer = "import { test } from 'node:test';\ntest('arms an unref timer', () => { setTimeout(() => {}, 4000).unref(); });\n";
const runTools = (args, extra = {}) => spawnSync(process.execPath, [join(TOOLS, 'test.mjs'), ...args],
  { encoding: 'utf8', timeout: 60_000, env: { ...process.env, NODE_TEST_CONTEXT: undefined, ...extra } });

test('parseArgs: --measure-tails is a bare flag, off by default, and combines with --timings-out', () => {
  assert.equal(parseArgs([]).measureTails, false);
  assert.equal(parseArgs(['--measure-tails']).measureTails, true);
  const o = parseArgs(['--measure-tails', '--timings-out', 'x.json']);
  assert.equal(o.measureTails, true);
  assert.equal(o.timingsOut, 'x.json');
});

test('forceExit under --timings-out: a file holding a 4 s timer frees its slot in under 1 s and the log names the Timeout handle', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-slot-'));
  try {
    const held = join(dir, 'held.test.mjs');
    const clean = join(dir, 'clean.test.mjs');
    writeFileSync(held, heldTimer);
    writeFileSync(clean, cleanTimer);
    const out = join(dir, 't.json');
    const t0 = Date.now();
    const r = runTools(['--timings-out', out, held, clean]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(Date.now() - t0 < 20_000, `took ${Date.now() - t0} ms`);
    const measured = JSON.parse(readFileSync(out, 'utf8'));
    const key = Object.keys(measured).find((k) => k.endsWith('/held.test.mjs'));
    assert.ok(key, JSON.stringify(measured));
    assert.ok(measured[key] < 1, `the slot is freed at once: ${measured[key]} s`);
    const lines = r.stderr.split('\n').filter((l) => l.startsWith('warning: '));
    const handle = lines.filter((l) => /held\.test\.mjs held the process open after its tests: Timeout \(force-closed/.test(l));
    assert.equal(handle.length, 1, r.stderr);
    assert.ok(!lines.some((l) => /clean\.test\.mjs/.test(l)), 'an unref\'d timer holds nothing: ' + r.stderr);
    assert.ok(!lines.some((l) => /stayed up/.test(l)), r.stderr);
  } finally { rmSync(dir, rmOpts); }
});

test('measure-tails: the same 4 s fixture logs a tail warning of about 4 s; a clean file none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-tail-'));
  try {
    const held = join(dir, 'held.test.mjs');
    const clean = join(dir, 'clean.test.mjs');
    writeFileSync(held, heldTimer);
    writeFileSync(clean, cleanTimer);
    const r = runTools(['--measure-tails', held, clean]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const warned = r.stderr.split('\n').filter((l) => l.startsWith('warning: '));
    const tails = warned.filter((l) => /stayed up/.test(l));
    assert.equal(tails.length, 1, r.stderr);
    const m = tails[0].match(/\/held\.test\.mjs stayed up (\d+\.\d) s outside its tests/);
    assert.ok(m && +m[1] >= 3.9 && +m[1] < 8, tails[0]);
    assert.ok(!warned.some((l) => /held the process open/.test(l)), 'forceExit is off, so no handle line: ' + r.stderr);
  } finally { rmSync(dir, rmOpts); }
});

test('forceExit: a file still held open after its tests (a live server, a ref\'d timer) no longer holds the run, and its handles are named', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-force-'));
  try {
    const held = join(dir, 'held.test.mjs');
    writeFileSync(held, "import { test } from 'node:test';\nimport { createServer } from 'node:http';\ntest('leaves a server listening', () => { createServer().listen(0); setTimeout(() => {}, 60_000); });\n");
    const t0 = Date.now();
    const r = runTools([held]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(Date.now() - t0 < 20_000, `took ${Date.now() - t0} ms: the file's process outlived its tests`);
    const line = r.stderr.split('\n').find((l) => /held the process open after its tests/.test(l));
    assert.ok(line, r.stderr);
    assert.match(line, /TCPServerWrap/);
    assert.match(line, /Timeout/);
  } finally { rmSync(dir, rmOpts); }
});

test('a slow top-level after() hook is hook time, not a tail: no tail line under forceExit; under --measure-tails the line names hooks too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-hook-'));
  try {
    const hook = join(dir, 'hook.test.mjs');
    writeFileSync(hook, "import { test, after } from 'node:test';\nafter(() => new Promise((r) => setTimeout(r, 2500)));\ntest('a', () => {});\n");
    const forced = runTools([hook]);
    assert.equal(forced.status, 0, forced.stdout + forced.stderr);
    assert.ok(!/stayed up/.test(forced.stderr), forced.stderr);
    const measured = runTools(['--measure-tails', hook]);
    assert.equal(measured.status, 0, measured.stdout + measured.stderr);
    assert.match(measured.stderr, /hook\.test\.mjs stayed up \d+\.\d s outside its tests \(top-level hooks, or a timer or child/);
  } finally { rmSync(dir, rmOpts); }
});

test('a red file under forceExit still reports red and still gets its handle line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-redforce-'));
  try {
    const bad = join(dir, 'bad.test.mjs');
    writeFileSync(bad, "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('fails', () => { setTimeout(() => {}, 4000); assert.equal(1, 2); });\n");
    const r = runTools([bad]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /bad\.test\.mjs held the process open after its tests: Timeout/);
  } finally { rmSync(dir, rmOpts); }
});

test('ci.yml never passes --measure-tails (forceExit stays on in every tier)', () => {
  const wf = YAML.parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  const runs = Object.values(wf.jobs).flatMap((j) => (j.steps || []).map((s) => String(s.run || '')));
  assert.ok(runs.length > 0);
  assert.equal(runs.filter((r) => r.includes('--measure-tails')).length, 0);
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

// The slow-filter lines of ci.yml's `changes` job (filter step id `filter`, its `engine` list) against tiers.json
// "slow", entry for entry. Only "test/NAME.test.mjs" lines (globs included) are slow-tier entries; test/helpers/**,
// test/fixtures/** and test/tiers.json are path triggers and stay out of the comparison.
function slowFilterDrift(doc, slow) {
  const step = (doc?.jobs?.changes?.steps || []).find((s) => s.id === 'filter');
  const engine = (YAML.parse(String(step?.with?.filters || '')) || {}).engine || [];
  const lines = engine.filter((l) => /^test\/[^/]+\.test\.mjs$/.test(l));
  const want = new Set(slow);
  const problems = [];
  const seen = new Set();
  for (const l of lines) {
    if (seen.has(l)) problems.push(`ci.yml engine filter lists ${l} twice`);
    else if (!want.has(l)) problems.push(`ci.yml engine filter has ${l}, which test/tiers.json slow lacks`);
    seen.add(l);
  }
  for (const g of slow) if (!seen.has(g)) problems.push(`ci.yml engine filter is missing ${g}`);
  return problems;
}

test('ci.yml engine filter lists exactly the slow-tier entries of tiers.json, entry for entry', () => {
  const { slow } = JSON.parse(readFileSync(new URL('./tiers.json', import.meta.url), 'utf8'));
  const base = ciDoc();
  assert.deepEqual(slowFilterDrift(base, slow), []);
  const drift = (fn) => {
    const doc = structuredClone(base);
    const step = doc.jobs.changes.steps.find((s) => s.id === 'filter');
    const filters = YAML.parse(step.with.filters);
    fn(filters.engine);
    step.with.filters = YAML.stringify(filters);
    return slowFilterDrift(doc, slow);
  };
  assert.deepEqual(drift((e) => e.push('test/extra-slow.test.mjs')),
    ['ci.yml engine filter has test/extra-slow.test.mjs, which test/tiers.json slow lacks']);
  assert.deepEqual(drift((e) => e.splice(e.indexOf('test/git-sync.test.mjs'), 1)),
    ['ci.yml engine filter is missing test/git-sync.test.mjs']);
  assert.deepEqual(drift((e) => e.push('test/git-sync.test.mjs')),
    ['ci.yml engine filter lists test/git-sync.test.mjs twice']);
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
// PRs never start on labeled: a label's run would skip the gate, and a skipped gate reads as Success to the
// required check. The full-node-matrix label takes effect from the PR's next push (or a close and reopen).
export const CI_GROUP = "ci-${{ github.event_name == 'pull_request' && format('pr-{0}-{1}', github.event.pull_request.head.repo.full_name, github.head_ref) || format('push-{0}', github.run_id) }}";
const GATE_IF = ALWAYS;
const PR_TYPES = ['opened', 'synchronize', 'reopened'];
// The top-level operands of an expression (an optional ${{ }} wrapper stripped), split on && and ||
// outside parentheses and quotes, plus the operators found between them.
export function topLevel(expr) {
  let s = String(expr ?? '').trim();
  const w = s.match(/^\$\{\{([\s\S]*)\}\}$/);
  if (w) s = w[1];
  const parts = [];
  const ops = [];
  let depth = 0;
  let quote = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") quote = !quote;
    else if (quote) continue;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && (s.startsWith('&&', i) || s.startsWith('||', i))) {
      parts.push(s.slice(start, i).trim());
      ops.push(s.slice(i, i + 2));
      start = i + 2;
      i++;
    }
  }
  parts.push(s.slice(start).trim());
  return { parts, ops };
}
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
  if (c.group !== CI_GROUP) problems.push('concurrency: group must be CI_GROUP');
  const types = [].concat(doc?.on?.pull_request?.types || []);
  if (!PR_TYPES.every((t) => types.includes(t))) problems.push(`on.pull_request.types must hold opened, synchronize and reopened, not ${JSON.stringify(types)}`);
  if (types.includes('labeled')) problems.push('on.pull_request.types must not hold labeled: a label run that skips the gate reads as Success');

  const gate = jobs['ci-gate'];
  if (!gate) return [...problems, 'ci-gate: no job with id ci-gate'];
  if (gate.name !== 'CI gate') problems.push(`ci-gate name: ${JSON.stringify(gate.name)}, want "CI gate"`);
  if (gate.if !== GATE_IF) problems.push(`ci-gate if: ${JSON.stringify(gate.if)}, want ${GATE_IF} (a skipped gate reads as Success)`);
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
    // The fast tier reads pages under docs/, so it runs on a docs-only pull request too.
    if (id === 'test-fast') {
      if (!cond.includes('!cancelled()') || cond.includes('needs.changes.outputs.code'))
        problems.push('test-fast: if must hold !cancelled() and no docs-only skip (fast tests read docs/)');
    } else if (!cond.includes('!cancelled()') || !cond.includes("needs.changes.outputs.code != 'false'"))
      problems.push(`${id}: if must hold !cancelled() and needs.changes.outputs.code != 'false'`);
  }
  if (jobs['test-slow'] && !String(jobs['test-slow'].if || '').includes("needs.changes.outputs.engine != 'false'"))
    problems.push("test-slow: if lost needs.changes.outputs.engine != 'false'");

  // Failing test files in the gate summary: each red fast or slow shard uploads its failure record (this
  // attempt's name only), the gate downloads this attempt's records before the verdict, and the verdict reads them.
  const ATTEMPT = 'test-failures-${{ github.run_attempt }}-';
  for (const [id, script] of [['test-fast', 'test:fast'], ['test-slow', 'test:slow']]) {
    const steps = jobs[id]?.steps;
    if (!steps) continue;
    const runStep = steps.find((s) => String(s.run || '').includes(`npm run ${script}`));
    const upload = steps.find((s) => String(s.uses || '').startsWith('actions/upload-artifact@') && String(s.if || '').includes('failure()')
      && String(s.with?.name || '').startsWith(ATTEMPT));
    if (!runStep || !String(runStep.run).includes('--failures-out .test-failures/') || !upload) problems.push(`${id}: no test-failures upload on failure()`);
  }
  const download = steps.slice(0, -1).find((s) => String(s.uses || '').startsWith('actions/download-artifact@'));
  if (!download || download.with?.pattern !== `${ATTEMPT}*` || download.if !== ALWAYS || download['continue-on-error'] !== true)
    problems.push('ci-gate: no test-failures download before the verdict');
  if (!last.env || !('FAILURES_DIR' in last.env) || !('BASE_QUARANTINE_ROOT' in last.env))
    problems.push('ci-gate steps: the verdict needs FAILURES_DIR and BASE_QUARANTINE_ROOT');

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

test('ci.yml CI gate: paths or paths-ignore under on: is a problem', () => {
  hasProblem(mutated((d) => { d.on.pull_request = { ...(d.on.pull_request || {}), paths: ['**', '!docs/**'] }; }), /on\.pull_request\.paths\b/, 'pull_request.paths');
  hasProblem(mutated((d) => { d.on.push['paths-ignore'] = ['docs/**']; }), /on\.push\.paths-ignore/, 'push.paths-ignore');
});

test('ci.yml CI gate: a job without needs: changes or the docs-only if is named', () => {
  hasProblem(mutated((d) => { delete d.jobs.cdp.needs; }), /^cdp: needs: changes/, 'cdp needs');
  hasProblem(mutated((d) => { d.jobs.cdp.if = "${{ github.event_name != 'pull_request' || needs.changes.outputs.code != 'false' }}"; }), /^cdp: if/, 'cdp no !cancelled()');
  hasProblem(mutated((d) => { d.jobs.cdp.if = '${{ !cancelled() }}'; }), /^cdp: if/, 'cdp no code clause');
});

test('ci.yml CI gate: the fast tier with a docs-only skip is named', () => {
  hasProblem(mutated((d) => { d.jobs['test-fast'].if = "${{ !cancelled() && (github.event_name != 'pull_request' || needs.changes.outputs.code != 'false') }}"; }), /^test-fast: if/, 'test-fast docs-only skip');
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

// ── triggers and concurrency (PR fast tier on .nvmrc only) ──
test('ci.yml CI gate: the real ci.yml never starts on labeled, and the gate always runs', () => {
  const d = ciDoc();
  assert.deepEqual(d.on.pull_request.types, ['opened', 'synchronize', 'reopened']);
  assert.equal(d.concurrency.group, CI_GROUP);
  assert.equal(d.jobs['ci-gate'].if, ALWAYS);
});

test('ci.yml CI gate: the gate\'s if must be exactly always()', () => {
  hasProblem(mutated((d) => { d.jobs['ci-gate'].if = '${{ !cancelled() }}'; }), /^ci-gate if:/, '!cancelled()');
  hasProblem(mutated((d) => { delete d.jobs['ci-gate'].if; }), /^ci-gate if:/, 'no if');
});

test('ci.yml CI gate: pull_request types keep the defaults and never add labeled', () => {
  hasProblem(mutated((d) => { d.on.pull_request.types = ['opened', 'reopened']; }), /on\.pull_request\.types must hold/, 'without synchronize');
  hasProblem(mutated((d) => { d.on.pull_request.types = ['opened', 'synchronize', 'reopened', 'labeled']; }), /must not hold labeled/, 'with labeled');
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

const failUpload = (d, id) => d.jobs[id].steps.findIndex((s) => String(s.uses || '').startsWith('actions/upload-artifact@') && String(s.if || '').includes('failure()'));

test('ci.yml CI gate: a shard without its test-failures upload is named', () => {
  for (const id of ['test-fast', 'test-slow']) {
    hasProblem(mutated((d) => { d.jobs[id].steps.splice(failUpload(d, id), 1); }), new RegExp(`^${id}: no test-failures upload on failure\\(\\)`), `${id} upload removed`);
    hasProblem(mutated((d) => { d.jobs[id].steps[failUpload(d, id)].with.name = 'test-failures-' + id; }), new RegExp(`^${id}: no test-failures upload`), `${id} name without run_attempt`);
    hasProblem(mutated((d) => { delete d.jobs[id].steps[failUpload(d, id)].if; }), new RegExp(`^${id}: no test-failures upload`), `${id} upload not on failure()`);
    hasProblem(mutated((d) => {
      const s = d.jobs[id].steps.find((x) => String(x.run || '').includes('--failures-out'));
      s.run = s.run.replace(/\s*--failures-out \S+/, '');
    }), new RegExp(`^${id}: no test-failures upload`), `${id} run without --failures-out`);
  }
});

test('ci.yml CI gate: the gate without the test-failures download is named', () => {
  const dl = (d) => d.jobs['ci-gate'].steps.findIndex((s) => String(s.uses || '').startsWith('actions/download-artifact@'));
  hasProblem(mutated((d) => { d.jobs['ci-gate'].steps.splice(dl(d), 1); }), /^ci-gate: no test-failures download before the verdict/, 'download removed');
  hasProblem(mutated((d) => { d.jobs['ci-gate'].steps[dl(d)].with.pattern = 'test-failures-*'; }), /^ci-gate: no test-failures download/, 'every attempt');
  hasProblem(mutated((d) => { delete d.jobs['ci-gate'].steps[dl(d)]['continue-on-error']; }), /^ci-gate: no test-failures download/, 'no continue-on-error');
  hasProblem(mutated((d) => { delete d.jobs['ci-gate'].steps[dl(d)].if; }), /^ci-gate: no test-failures download/, 'not always()');
});

test('ci.yml CI gate: the verdict without FAILURES_DIR or BASE_QUARANTINE_ROOT is named', () => {
  for (const key of ['FAILURES_DIR', 'BASE_QUARANTINE_ROOT']) {
    hasProblem(mutated((d) => { const s = d.jobs['ci-gate'].steps; delete s[s.length - 1].env[key]; }),
      /^ci-gate steps: the verdict needs FAILURES_DIR and BASE_QUARANTINE_ROOT/, `no ${key}`);
  }
});

// ── untimed files: the stated fallback, the warning and the merger's completeness line ────────

// Imported per test, so a missing export fails its own case instead of the whole file.
const runnerExport = async (name, from = '../tools/test.mjs') => {
  const mod = await import(from);
  assert.equal(typeof mod[name], 'function', `${from.slice(3)} exports ${name}`);
  return mod[name];
};
const untimedNames = (n) => Array.from({ length: n }, (_, i) => `test/new${String(i + 1).padStart(2, '0')}.test.mjs`);
const recorded = { 'test/timed-a.test.mjs': 4, 'test/timed-b.test.mjs': 2 }; // mean 3.00 s, so the stated number is checkable
const priced = 'is priced at the mean recorded time (3.00 s) until the weekly Refresh test timings PR measures it';
const manyUntimed = `12 test files have no recorded timing: each ${priced}`;
const oneUntimed = `1 test file has no recorded timing: each ${priced}`;

test('untimedWarning: 12 untimed files return "12 test files have no recorded timing: …" with the mean shown', async () => {
  const untimedWarning = await runnerExport('untimedWarning');
  assert.equal(untimedWarning([...Object.keys(recorded), ...untimedNames(12)], recorded), manyUntimed);
});

test('untimedWarning: 1 untimed file returns the singular "1 test file has no recorded timing"', async () => {
  const untimedWarning = await runnerExport('untimedWarning');
  assert.equal(untimedWarning([...Object.keys(recorded), ...untimedNames(1)], recorded), oneUntimed);
});

test('untimedWarning: all files timed returns null (a recorded 0 s counts as timed)', async () => {
  const untimedWarning = await runnerExport('untimedWarning');
  assert.equal(untimedWarning(Object.keys(recorded), recorded), null);
  assert.equal(untimedWarning(['test/zero.test.mjs'], { 'test/zero.test.mjs': 0 }), null);
});

test('fallbackWeight returns the mean of the recorded values, and 1 for an empty map', async () => {
  const fallbackWeight = await runnerExport('fallbackWeight');
  // Median 0, mean 3.2: only the mean passes.
  assert.equal(fallbackWeight({ a: 10, b: 6, c: 0, d: 0, e: 0 }), 3.2);
  assert.equal(fallbackWeight({}), 1);
});

test('annotateUntimed returns true for GITHUB_ACTIONS=true with no shard or 1/4, false for 2/4 and outside Actions', async () => {
  const annotateUntimed = await runnerExport('annotateUntimed');
  const actions = { GITHUB_ACTIONS: 'true' };
  assert.equal(annotateUntimed(actions, null), true);
  assert.equal(annotateUntimed(actions, ''), true);
  assert.equal(annotateUntimed(actions, '1/4'), true);
  assert.equal(annotateUntimed(actions, '2/4'), false);
  assert.equal(annotateUntimed(actions, '11/12'), false);
  assert.equal(annotateUntimed({}, '1/4'), false);
  assert.equal(annotateUntimed({ GITHUB_ACTIONS: 'false' }, null), false);
});

test('completenessLine returns "0 test files have no recorded timing" when all are timed, else the warning', async () => {
  const completenessLine = await runnerExport('completenessLine', '../tools/test-timings-merge.mjs');
  assert.equal(completenessLine(Object.keys(recorded), recorded), '0 test files have no recorded timing');
  assert.equal(completenessLine([...Object.keys(recorded), ...untimedNames(12)], recorded), manyUntimed);
});

/**
 * A throwaway repo root holding a copy of the runner and the merger: what they print and write is checked on a real run
 * over a known set of test files, never on this repo's own (its untimed count moves with every new file).
 */
const runnerRepo = (fn, { tests, timings: base, slow = [] }) => {
  const root = mkdtempSync(join(tmpdir(), 'worca-cc-runner-untimed-'));
  try {
    mkdirSync(join(root, 'tools'));
    mkdirSync(join(root, 'test', 'helpers'), { recursive: true });
    for (const n of ['test.mjs', 'test-run.mjs', 'test-handles.mjs', 'test-related.mjs', 'test-timings-merge.mjs', 'quarantine.mjs']) {
      copyFileSync(join(TOOLS, n), join(root, 'tools', n));
    }
    symlinkSync(fileURLToPath(new URL('../src', import.meta.url)), join(root, 'src'), 'junction'); // test-related.mjs imports it
    cpSync(fileURLToPath(new URL('./helpers/no-real-claude', import.meta.url)), join(root, 'test', 'helpers', 'no-real-claude'), { recursive: true });
    for (const f of tests) writeFileSync(join(root, f), "import { test } from 'node:test';\ntest('ok', () => {});\n");
    writeFileSync(join(root, 'test', 'tiers.json'), JSON.stringify({ slow, keepFast: [] }));
    writeFileSync(join(root, 'test', 'quarantine.json'), JSON.stringify({ entries: [] }));
    writeFileSync(join(root, 'test', 'timings.json'), JSON.stringify(base));
    const node = (tool, args, extra = {}) => spawnSync(process.execPath, [join(root, 'tools', tool), ...args], {
      cwd: root, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, WORCA_TEST_SHARD: undefined, GITHUB_ACTIONS: undefined, WORCA_TEST_NO_LOCK: '1', ...extra },
    });
    return fn({ root, node });
  } finally { rmSync(root, rmOpts); }
};
const warningLines = (stdout) => stdout.split('\n').filter((l) => /no recorded tim/.test(l));
// 12 new fast files beside 2 timed ones, and one untimed slow file that a fast run must not count.
const twelveNew = {
  tests: [...Object.keys(recorded), ...untimedNames(12), 'test/slow-new.test.mjs'],
  timings: recorded,
  slow: ['test/slow-new.test.mjs'],
};

test('a run with 12 new files logs "12 test files have no recorded timing", once, counted over the whole tier', () => runnerRepo(({ node }) => {
  const r = node('test.mjs', ['--tier', 'fast']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(warningLines(r.stdout), [manyUntimed], r.stdout);
}, twelveNew));

test('every shard prints the whole tier\'s untimed count; in GitHub Actions only shard 1/n annotates it; the shard line carries no count of its own', () => runnerRepo(({ node }) => {
  const first = node('test.mjs', ['--tier', 'fast', '--shard', '1/2'], { GITHUB_ACTIONS: 'true' });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.deepEqual(warningLines(first.stdout), [`::warning::${manyUntimed}`], first.stdout);
  // CI passes the shard through the env.
  const second = node('test.mjs', ['--tier', 'fast'], { GITHUB_ACTIONS: 'true', WORCA_TEST_SHARD: '2/2' });
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.deepEqual(warningLines(second.stdout), [manyUntimed], second.stdout);
  assert.match(first.stdout, /^shard 1\/2: \d+ files$/m);
  assert.match(second.stdout, /^shard 2\/2: \d+ files$/m);
  const local = node('test.mjs', ['--tier', 'fast', '--shard', '1/2']);
  assert.deepEqual(warningLines(local.stdout), [manyUntimed], 'outside Actions: no annotation prefix');
}, twelveNew));

test('no untimed warning for an explicit file list, or for a tier whose files are all timed', () => {
  runnerRepo(({ node }) => {
    // The tier run of this root warns, so the silence for a file list is the file list's.
    assert.deepEqual(warningLines(node('test.mjs', ['--tier', 'fast']).stdout), [manyUntimed]);
    const r = node('test.mjs', ['test/new01.test.mjs']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(warningLines(r.stdout), [], r.stdout);
  }, twelveNew);
  runnerRepo(({ node }) => {
    const r = node('test.mjs', ['--tier', 'fast', '--shard', '1/1'], { GITHUB_ACTIONS: 'true' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(warningLines(r.stdout), [], r.stdout);
    assert.match(r.stdout, /^shard 1\/1: 2 files$/m);
  }, { tests: Object.keys(recorded), timings: recorded });
});

test('the merger adds last week\'s new files to test/timings.json, then prints the untimed count over the fast and slow tiers', () => runnerRepo(({ root, node }) => {
  const shard = (name, body) => {
    const dir = join(root, 'artifacts', `test-timings-${name}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(body));
  };
  const read = () => JSON.parse(readFileSync(join(root, 'test', 'timings.json'), 'utf8'));
  shard('fast-1', { 'test/new-fast.test.mjs': 7 });
  const partial = node('test-timings-merge.mjs', [join(root, 'artifacts')]);
  assert.equal(partial.status, 0, partial.stdout + partial.stderr);
  assert.equal(read()['test/new-fast.test.mjs'], 7);
  assert.match(partial.stdout, /^1 test file has no recorded timing/m, 'the slow-tier file is still untimed');

  shard('slow-1', { 'test/new-slow.test.mjs': 9 });
  const full = node('test-timings-merge.mjs', [join(root, 'artifacts')]);
  assert.equal(full.status, 0, full.stdout + full.stderr);
  assert.deepEqual(read(), { 'test/new-fast.test.mjs': 7, 'test/new-slow.test.mjs': 9, 'test/timed-a.test.mjs': 4, 'test/timed-b.test.mjs': 2 });
  assert.match(full.stdout, /^0 test files have no recorded timing$/m);
}, { tests: [...Object.keys(recorded), 'test/new-fast.test.mjs', 'test/new-slow.test.mjs'], timings: recorded, slow: ['test/new-slow.test.mjs'] }));
// --test-name-pattern: one file, filtered by name through the same hermetic runner (tools/test-each-alone.mjs).
test('parseArgs --test-name-pattern: kept with a file list; refused without one, and without a value', () => {
  assert.equal(parseArgs(['test/a.test.mjs'], {}).namePattern, null);
  const o = parseArgs(['test/a.test.mjs', '--test-name-pattern', '^a$'], {});
  assert.equal(o.namePattern, '^a$');
  assert.deepEqual(o.files, ['test/a.test.mjs']);
  assert.throws(() => parseArgs(['--test-name-pattern', '^a$'], {}), { message: '--test-name-pattern needs a file list' });
  assert.throws(() => parseArgs(['--related', '--test-name-pattern', '^a$'], {}), { message: '--test-name-pattern needs a file list' });
  assert.throws(() => parseArgs(['test/a.test.mjs', '--test-name-pattern'], {}), { message: '--test-name-pattern needs a value' });
  assert.throws(() => parseArgs(['test/a.test.mjs', '--test-name-pattern', '--write-timings'], {}), { message: '--test-name-pattern needs a value' });
});

const runTool = (script, args) => spawnSync(process.execPath, [join(TOOLS, script), ...args],
  { encoding: 'utf8', timeout: 60_000, env: { ...process.env, NODE_TEST_CONTEXT: undefined, FORCE_COLOR: undefined } });

test('--test-name-pattern without a file list exits 2 (it never filters a whole suite)', () => {
  const r = runTool('test.mjs', ['--test-name-pattern', '^a$']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--test-name-pattern needs a file list/);
});

test('--test-name-pattern runs only the matching test of the file, as Node reads the pattern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-name-'));
  try {
    const file = join(dir, 'two.test.mjs');
    writeFileSync(file, "import { test } from 'node:test';\ntest('a', () => {});\ntest('b', () => { throw new Error('b must not run'); });\n");
    for (const pattern of ['^a$', '/^A$/i']) {
      const r = runTool('test.mjs', [file, '--test-name-pattern', pattern]);
      assert.equal(r.status, 0, `${pattern}\n${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /ℹ tests 1\b/, pattern);
      assert.match(r.stdout, /ℹ pass 1\b/, pattern);
    }
  } finally { rmSync(dir, rmOpts); }
});

// --sum: the converted files' summed seconds from downloaded CI timing artifacts.
test('sumTimings: rows in the order asked, the total rounded to 0.01 s', async () => {
  const { sumTimings } = await import('../tools/test-timings-merge.mjs');
  assert.equal(typeof sumTimings, 'function', 'tools/test-timings-merge.mjs exports sumTimings(measured, files)');
  assert.deepEqual(
    sumTimings([{ 'test/a.test.mjs': 0.1, 'test/other.test.mjs': 9 }, { 'test/b.test.mjs': 0.2 }], ['test/b.test.mjs', 'test/a.test.mjs']),
    { rows: [{ file: 'test/b.test.mjs', seconds: 0.2 }, { file: 'test/a.test.mjs', seconds: 0.1 }], total: 0.3, missing: [], duplicated: [] },
  );
});

test('sumTimings: a file with no timing is missing, a file timed twice is duplicated', async () => {
  const { sumTimings } = await import('../tools/test-timings-merge.mjs');
  assert.equal(typeof sumTimings, 'function', 'tools/test-timings-merge.mjs exports sumTimings(measured, files)');
  const gone = sumTimings([{ 'test/a.test.mjs': 1.5 }], ['test/x.test.mjs', 'test/a.test.mjs', 'test/y.test.mjs']);
  assert.deepEqual(gone.rows, [{ file: 'test/x.test.mjs', seconds: null }, { file: 'test/a.test.mjs', seconds: 1.5 }, { file: 'test/y.test.mjs', seconds: null }]);
  assert.equal(gone.total, 1.5);
  assert.deepEqual(gone.missing, ['test/x.test.mjs', 'test/y.test.mjs']);
  assert.deepEqual(gone.duplicated, []);
  const twice = sumTimings([{ 'test/a.test.mjs': 1 }, { 'test/a.test.mjs': 2 }], ['test/a.test.mjs']);
  assert.deepEqual(twice.duplicated, ['test/a.test.mjs']);
  assert.deepEqual(twice.missing, []);
});

test('test-timings-merge --sum: prints the table and exits 0, 1 or 2, and never writes test/timings.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-timings-sum-'));
  const timingsFile = new URL('./timings.json', import.meta.url);
  const before = readFileSync(timingsFile);
  // Real file names with made-up seconds: a run that merged them would change test/timings.json.
  const one = 'test/ui-one-model.test.mjs';
  const two = 'test/ui-history-shipit.test.mjs';
  try {
    mkdirSync(join(dir, 'test-timings-fast-1'));
    mkdirSync(join(dir, 'test-timings-fast-2'));
    writeFileSync(join(dir, 'test-timings-fast-1', 'fast-1.json'), JSON.stringify({ [one]: 1.5 }));
    writeFileSync(join(dir, 'test-timings-fast-2', 'fast-2.json'), JSON.stringify({ [two]: 2.25 }));
    const sum = (...args) => runTool('test-timings-merge.mjs', ['--sum', ...args]);

    const ok = sum(`${one},${two}`, dir);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const table = ok.stdout.split('\n').filter((l) => l.startsWith('|'));
    const at = (name) => table.findIndex((l) => l.includes(name));
    assert.match(table[at(one)] ?? '', /\|\s*test\/ui-one-model\.test\.mjs\s*\|\s*1\.50?\s*\|/, ok.stdout);
    assert.match(table[at(two)] ?? '', /\|\s*test\/ui-history-shipit\.test\.mjs\s*\|\s*2\.25\s*\|/, ok.stdout);
    assert.match(table[at('Total')] ?? '', /\|\s*Total\s*\|\s*3\.75\s*\|/, ok.stdout);
    assert.ok(at(one) < at(two) && at(two) < at('Total'), ok.stdout);

    const missing = sum(`${one},${two},test/ui-workflows-app.test.mjs,test/ui-running-detail.test.mjs`, dir);
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    const named = (missing.stdout + missing.stderr).split('\n').filter((l) => l.includes('has no timing in the given files'));
    assert.deepEqual(named.map((l) => l.trim()).sort(), [
      'test/ui-running-detail.test.mjs has no timing in the given files',
      'test/ui-workflows-app.test.mjs has no timing in the given files',
    ]);

    writeFileSync(join(dir, 'test-timings-fast-2', 'again.json'), JSON.stringify({ [one]: 4 }));
    const twice = sum(one, dir);
    assert.equal(twice.status, 1, twice.stdout + twice.stderr);
    assert.match(twice.stdout + twice.stderr, /test\/ui-one-model\.test\.mjs appears in 2 timing files/);

    assert.equal(sum().status, 2, 'no list');
    assert.equal(sum(one).status, 2, 'no timing files');
    assert.ok(readFileSync(timingsFile).equals(before), '--sum never writes test/timings.json');
  } finally {
    if (!readFileSync(timingsFile).equals(before)) writeFileSync(timingsFile, before);
    rmSync(dir, rmOpts);
  }
});
