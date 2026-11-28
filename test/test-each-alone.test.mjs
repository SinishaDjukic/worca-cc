// test/test-each-alone.test.mjs — tools/test-each-alone.mjs, the proof that no test depends on another's leftovers:
// it runs each top-level test of a file on its own, and a run in which no test (or more than one) ran never counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = fileURLToPath(new URL('../tools', import.meta.url));
const tool = () => import('../tools/test-each-alone.mjs');

// The tool and the runner are spawned as a person would run them: without this file's test context or colors,
// and without a WORCA_HOME, which only tools/test.mjs may provide to a fixture.
const env = () => ({ ...process.env, NODE_TEST_CONTEXT: undefined, FORCE_COLOR: undefined, WORCA_HOME: undefined });
const node = (args) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 90_000, env: env() });
  return { status: r.status, stdout: r.stdout, out: r.stdout + r.stderr };
};
const eachAlone = (...files) => node([join(TOOLS, 'test-each-alone.mjs'), ...files]);

function withFixtures(sources, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-each-alone-'));
  try {
    const files = Object.fromEntries(Object.entries(sources).map(([name, source]) => {
      const file = join(dir, `${name}.test.mjs`);
      writeFileSync(file, source);
      return [name, file];
    }));
    return fn(files);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}
const lines = (...l) => `${l.join('\n')}\n`;
const HEAD = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';";

// ── listTestNames ───────────────────────────────────────────────────────────
test('listTestNames: top-level test() and it() with a string or a plain template; .skip, .todo and subtests left out', async () => {
  const { listTestNames } = await tool();
  const source = lines(
    "import { test, it } from 'node:test';",
    "test('single', () => {});",
    'it("double", () => {});',
    'test(`template`, () => {});',
    "test.skip('skipped', () => {});",
    "test.todo('later');",
    "it.skip('skipped too', () => {});",
    "test('outer', async (t) => { await t.test('nested', () => {}); });",
  );
  assert.deepEqual(listTestNames(source), { names: ['single', 'double', 'template', 'outer'], dynamic: [], duplicates: [], suites: [] });
});

test('listTestNames: reports the lines of names that are not static and of describe/suite calls', async () => {
  const { listTestNames } = await tool();
  const got = listTestNames(lines(
    "import { test, describe, suite } from 'node:test';",
    "const n = 'x';",
    'test(`case ${n}`, () => {});',
    'test(n, () => {});',
    "test('static', () => {});",
    "describe('group', () => {});",
    "suite('other', () => {});",
  ));
  assert.deepEqual(got.dynamic, [3, 4]);
  assert.deepEqual(got.suites, [6, 7]);
  assert.deepEqual(got.duplicates, []);
  assert.ok(got.names.includes('static'), String(got.names));
});

test('listTestNames: a test() or it() call that is not a top-level statement counts as dynamic, by line; t.test subtests do not', async () => {
  const { listTestNames } = await tool();
  const got = listTestNames(lines(
    "import { test, it } from 'node:test';",
    "for (const n of ['a', 'b']) test(n, () => {});",
    "if (process.env.X) { test('guarded', () => {}); }",
    "const f = () => it('in a function', () => {});",
    "test('outer', async (t) => { await t.test('nested', () => {}); });",
    "[1].forEach(() => test.only('looped', () => {}));",
    "if (process.env.X) test.skip('skipped', () => {});",
  ));
  assert.deepEqual(got.dynamic, [2, 3, 4, 6]);
  assert.deepEqual(got.names, ['outer']);
});

test('listTestNames: reports a name used twice', async () => {
  const { listTestNames } = await tool();
  const got = listTestNames(lines("import { test, it } from 'node:test';", "test('same', () => {});", "it('same', () => {});", "test('own', () => {});"));
  assert.deepEqual(got.duplicates, ['same']);
});

// ── namePattern ─────────────────────────────────────────────────────────────
test('namePattern: anchored, with every RegExp metacharacter escaped', async () => {
  const { namePattern } = await tool();
  assert.equal(namePattern('plain name'), '^plain name$');
  const names = ['reads (a) [b].', 'a?b*c+d', '$HOME costs ^ more', 'x|y', 'back\\slash', '{n} of {2,3}', 'cut off… at $5?', '/slashed/i'];
  for (const name of names) {
    const re = new RegExp(namePattern(name));
    assert.ok(re.test(name), `${name}: matches itself`);
    assert.ok(!re.test(`${name} and more`), `${name}: anchored at the end`);
    assert.ok(!re.test(`more of ${name}`), `${name}: anchored at the start`);
  }
  for (const [name, other] of [['a.b', 'aXb'], ['ab?', 'a'], ['ab*', 'abbb'], ['ab+', 'abb'], ['(a)', 'a'], ['[ab]', 'a'], ['x|y', 'x'], ['a{2}', 'aa']]) {
    assert.ok(!new RegExp(namePattern(name)).test(other), `${name} must not match ${other}`);
  }
});

// ── judge ───────────────────────────────────────────────────────────────────
const report = (tests, pass) => `✔ something (1ms)\nℹ tests ${tests}\nℹ suites 0\nℹ pass ${pass}\nℹ fail ${tests - pass}\nℹ skipped 0\n`;

test('judge: exactly one test ran and passed', async () => {
  const { judge } = await tool();
  assert.deepEqual(judge({ status: 0, stdout: report(1, 1) }), { ok: true, tests: 1, pass: 1 });
});

test('judge: a run of 0 tests is never a pass', async () => {
  const { judge } = await tool();
  assert.deepEqual(judge({ status: 0, stdout: report(0, 0) }), { ok: false, tests: 0, pass: 0 });
  assert.equal(judge({ status: 0, stdout: '' }).ok, false, 'no report at all');
});

test('judge: two tests, a test that did not pass, or a non-zero exit is not ok', async () => {
  const { judge } = await tool();
  assert.deepEqual(judge({ status: 0, stdout: report(2, 2) }), { ok: false, tests: 2, pass: 2 });
  assert.deepEqual(judge({ status: 1, stdout: report(1, 0) }), { ok: false, tests: 1, pass: 0 });
  assert.equal(judge({ status: 0, stdout: report(1, 0) }).ok, false, 'a skipped test');
  assert.equal(judge({ status: 1, stdout: report(1, 1) }).ok, false, 'a failing after() hook');
});

// ── the CLI ─────────────────────────────────────────────────────────────────
const LEFTOVER = lines(
  HEAD,
  'let seeded = false;',
  "test('seeds module state', () => { seeded = true; });",
  "test('reads the leftover (a) [b].', () => { assert.equal(seeded, true); });",
  "test('runs in the runner\\'s own WORCA_HOME', () => { assert.ok(process.env.WORCA_HOME); });",
);
const CLEAN = lines(HEAD, "test('first', () => {});", "test('second $ (2)', () => {});");

test('CLI: a test that depends on a previous test\'s leftovers fails alone (2/3 passed, exit 1)', () => withFixtures({ leftover: LEFTOVER }, ({ leftover }) => {
  const whole = node([join(TOOLS, 'test.mjs'), leftover]);
  assert.equal(whole.status, 0, `the file passes whole:\n${whole.out}`);
  const r = eachAlone(leftover);
  assert.equal(r.status, 1, r.out);
  assert.ok(r.stdout.includes('✖ alone: reads the leftover (a) [b]. (exit 1, tests 1)'), r.out);
  assert.equal(r.stdout.match(/✖ alone: /g).length, 1, r.out);
  assert.ok(r.stdout.includes(`each alone: 2/3 passed in ${leftover}`), r.out);
}));

test('CLI: every test passing alone exits 0', () => withFixtures({ clean: CLEAN }, ({ clean }) => {
  const r = eachAlone(clean);
  assert.equal(r.status, 0, r.out);
  assert.ok(r.stdout.includes(`each alone: 2/2 passed in ${clean}`), r.out);
  assert.doesNotMatch(r.stdout, /✖ alone/);
}));

test('CLI: with several files, one failing file makes the exit 1 and each file gets its count', () => withFixtures({ leftover: LEFTOVER, clean: CLEAN }, ({ leftover, clean }) => {
  const r = eachAlone(leftover, clean);
  assert.equal(r.status, 1, r.out);
  assert.ok(r.stdout.includes(`each alone: 2/3 passed in ${leftover}`), r.out);
  assert.ok(r.stdout.includes(`each alone: 2/2 passed in ${clean}`), r.out);
}));

// A file the tool cannot prove: exit 2, with the offending line in the message. Padding puts it on line 41, and the
// file's own path is removed before the number is looked for.
const onLine41 = (line) => lines(HEAD, ...Array.from({ length: 38 }, () => ''), line);

test('CLI: a dynamic test name exits 2 and names the line', () => withFixtures({ dynamic: onLine41('const n = 1; test(`case ${n}`, () => {});') }, ({ dynamic }) => {
  const r = eachAlone(dynamic);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out.replaceAll(dynamic, 'FILE'), /\b41\b/);
  assert.doesNotMatch(r.out, /each alone: \d+\/\d+ passed/);
}));

test('CLI: a test inside a loop exits 2 and names the line', () => withFixtures({ looped: onLine41("for (const n of ['a', 'b']) test(n, () => {});") }, ({ looped }) => {
  const r = eachAlone(looped);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out.replaceAll(looped, 'FILE'), /\b41\b/);
  assert.doesNotMatch(r.out, /each alone: \d+\/\d+ passed/);
}));

test('CLI: a describe suite exits 2 and names the line', () => withFixtures({ suites: onLine41("import { describe } from 'node:test'; describe('group', () => {});") }, ({ suites }) => {
  const r = eachAlone(suites);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out.replaceAll(suites, 'FILE'), /\b41\b/);
}));

test('CLI: a duplicate name or a file with no tests exits 2', () => withFixtures({
  twice: lines(HEAD, "test('same', () => {});", "test('same', () => {});"),
  empty: lines(HEAD),
}, ({ twice, empty }) => {
  const dup = eachAlone(twice);
  assert.equal(dup.status, 2, dup.out);
  assert.match(dup.out, /same/);
  const none = eachAlone(empty);
  assert.equal(none.status, 2, none.out);
  assert.doesNotMatch(none.out, /each alone: 0\/0 passed/);
}));
