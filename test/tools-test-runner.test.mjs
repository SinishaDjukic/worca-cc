import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeTimings, parseArgs, planShards, selectFiles } from '../tools/test.mjs';
import { timingFiles } from '../tools/test-timings-merge.mjs';

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
