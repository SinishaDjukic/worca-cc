// test/workflow-test-test-output.test.mjs — workflow tests 3b, Task 7 (D74): the test names in a command's output. The fixtures
// are each tool's own output shape (Step 5 checks them against the real tools on this laptop).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTestOutput, createTestOutputParser, TEST_FORMATS, MAX_TESTS } from '../src/core/workflow-tests/test-output.mjs';
import { beforeAfter, commandMet } from '../src/shared/workflow-tests/before-after.mjs';

const ROUNDS = 'rounds three lines of 0.125 to 0.38';

const TAP = `TAP version 13
# Subtest: invoice totals
    # Subtest: ${ROUNDS}
    not ok 1 - ${ROUNDS}
      ---
      duration_ms: 1.2
      location: '/p/test/billing/invoice-totals.test.mjs:5:3'
      failureType: 'testCodeFailure'
      error: 'Expected values to be strictly equal'
      ok: false
      ...
    # Subtest: adds lines
    ok 2 - adds lines
      ---
      duration_ms: 0.3
      ...
    1..2
not ok 1 - invoice totals
  ---
  duration_ms: 2.1
  type: 'suite'
  ...
# Subtest: parses dates
ok 2 - parses dates
  ---
  duration_ms: 0.2
  ...
# Subtest: later
ok 3 - later # SKIP not today
1..3
# tests 4
# suites 1
# pass 2
# fail 1
# cancelled 0
# skipped 1
# todo 0
# duration_ms 41.2
`;

const SPEC = `▶ invoice totals
  ✖ ${ROUNDS} (1.2ms)
  ✔ adds lines (0.3ms)
✖ invoice totals (2.1ms)
✔ parses dates (0.2ms)
﹣ later (0.1ms) # SKIP not today
ℹ tests 4
ℹ suites 1
ℹ pass 2
ℹ fail 1
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 41.2

✖ failing tests:

test at test/billing/invoice-totals.test.mjs:5:3
✖ ${ROUNDS} (1.2ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
`;

const PYTEST_RA = `============================= test session starts ==============================
platform linux -- Python 3.12.1, pytest-8.3.2, pluggy-1.5.0
collected 3 items

tests/test_dates.py ..F                                                  [100%]

=================================== FAILURES ===================================
_____________________________ test_time_zone[utc] ______________________________
E   assert 1 == 2
==================================== PASSES ====================================
=========================== short test summary info ============================
PASSED tests/test_dates.py::test_parse
PASSED tests/test_dates.py::test_format[a b]
FAILED tests/test_dates.py::test_time_zone[utc] - assert 1 == 2
========================= 1 failed, 2 passed in 0.12s ==========================
`;
const PYTEST_DEFAULT = `============================= test session starts ==============================
collected 3 items

tests/test_dates.py ..F                                                  [100%]

=========================== short test summary info ============================
FAILED tests/test_dates.py::test_time_zone[utc] - assert 1 == 2
========================= 1 failed, 2 passed in 0.12s ==========================
`;

const JEST_DEFAULT = `PASS src/a.test.js
FAIL src/billing/totals.test.js
  ● invoice totals › ${ROUNDS}

    expect(received).toBe(expected) // Object.is equality

  ● Console

    console.log
      hi

Test Suites: 1 failed, 1 passed, 2 total
Tests:       1 failed, 212 passed, 213 total
Snapshots:   0 total
Time:        3.2 s
`;
const JEST_VERBOSE = `FAIL src/billing/totals.test.js
  invoice totals
    ✕ ${ROUNDS} (3 ms)
    ✓ adds lines (1 ms)
    ○ skipped later

  ● invoice totals › ${ROUNDS}

    expect(received).toBe(expected)

Tests:       1 failed, 1 skipped, 1 passed, 3 total
`;

const VITEST_DEFAULT = ` ✓ src/a.test.ts (3 tests) 5ms
 ❯ src/billing/totals.test.ts (2 tests | 1 failed) 7ms
   × invoice totals > ${ROUNDS} 3ms
     → expected 0.37 to be 0.38

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/billing/totals.test.ts > invoice totals > ${ROUNDS}
AssertionError: expected 0.37 to be 0.38

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 4 passed (5)
`;
const VITEST_VERBOSE = ` ✓ src/a.test.ts > parses dates 1ms
 × src/billing/totals.test.ts > invoice totals > ${ROUNDS} 3ms
 ✓ src/billing/totals.test.ts > invoice totals > adds lines 1ms
 ↓ src/billing/totals.test.ts > later

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 2 passed | 1 skipped (4)
`;

test('the formats', () => {
  assert.deepEqual(TEST_FORMATS, ['tap', 'node-spec', 'pytest', 'jest', 'vitest']);
});

test('TAP (node --test piped): nested names, the YAML blocks skipped, a SKIP, the counts', () => {
  assert.deepEqual(parseTestOutput(TAP), { format: 'tap', pass: ['invoice totals > adds lines', 'parses dates'], fail: [`invoice totals > ${ROUNDS}`],
    skip: ['later'], passListed: true, counts: { passed: 2, failed: 1, skipped: 1 }, truncated: false });
});

test('node:test\'s spec reporter gives the same names; its "failing tests" repeat is skipped', () => {
  const r = parseTestOutput(SPEC);
  assert.equal(r.format, 'node-spec');
  assert.deepEqual([r.pass, r.fail, r.skip, r.passListed, r.counts], [['invoice totals > adds lines', 'parses dates'], [`invoice totals > ${ROUNDS}`], ['later'], true,
    { passed: 2, failed: 1, skipped: 1 }]);
});

test('pytest: -rA names every test; the default names only the failures', () => {
  assert.deepEqual(parseTestOutput(PYTEST_RA), { format: 'pytest', pass: ['tests/test_dates.py::test_format[a b]', 'tests/test_dates.py::test_parse'],
    fail: ['tests/test_dates.py::test_time_zone[utc]'], skip: [], passListed: true, counts: { passed: 2, failed: 1, skipped: 0 }, truncated: false });
  const d = parseTestOutput(PYTEST_DEFAULT);
  assert.deepEqual([d.format, d.pass, d.fail, d.passListed, d.counts], ['pytest', [], ['tests/test_dates.py::test_time_zone[utc]'], false, { passed: 2, failed: 1, skipped: 0 }]);
  assert.deepEqual(parseTestOutput('tests/test_a.py::test_one PASSED  [ 50%]\ntests/test_a.py::test_two FAILED  [100%]\n').pass, ['tests/test_a.py::test_one'], '-v lines');
});

test('Jest: the default names the failures (with their file); verbose names every test', () => {
  const d = parseTestOutput(JEST_DEFAULT);
  assert.deepEqual([d.format, d.pass, d.fail, d.passListed, d.counts], ['jest', [], [`src/billing/totals.test.js › invoice totals › ${ROUNDS}`], false,
    { passed: 212, failed: 1, skipped: 0 }]);
  const v = parseTestOutput(JEST_VERBOSE);
  assert.deepEqual([v.pass, v.fail, v.skip, v.passListed], [['src/billing/totals.test.js › invoice totals › adds lines'],
    [`src/billing/totals.test.js › invoice totals › ${ROUNDS}`], ['src/billing/totals.test.js › invoice totals › later'], true]);
});

test('Vitest: the default names the failures; verbose names every test; both name a test the same way', () => {
  const d = parseTestOutput(VITEST_DEFAULT);
  assert.deepEqual([d.format, d.pass, d.fail, d.passListed, d.counts], ['vitest', [], [`src/billing/totals.test.ts > invoice totals > ${ROUNDS}`], false,
    { passed: 4, failed: 1, skipped: 0 }]);
  const v = parseTestOutput(VITEST_VERBOSE);
  assert.deepEqual([v.pass, v.fail, v.skip, v.passListed, v.counts], [['src/a.test.ts > parses dates', 'src/billing/totals.test.ts > invoice totals > adds lines'],
    [`src/billing/totals.test.ts > invoice totals > ${ROUNDS}`], ['src/billing/totals.test.ts > later'], true, { passed: 2, failed: 1, skipped: 1 }]);
});

test('anything else: no format; colours and Windows line ends are read; line by line equals all at once', () => {
  assert.deepEqual(parseTestOutput('Building…\nAll good.\n'), { format: null, pass: [], fail: [], skip: [], passListed: false, counts: null, truncated: false });
  assert.deepEqual(parseTestOutput(`\u001b[32mTAP version 13\u001b[0m\r\nok 1 - a\r\n\u001b[31mnot ok 2 - b\u001b[0m\r\n`).fail, ['b']);
  const p = createTestOutputParser();
  for (const l of TAP.split('\n')) p.line(l);
  assert.deepEqual(p.result(), parseTestOutput(TAP));
});

test('a huge run keeps at most MAX_TESTS names and says so; a long name is cut', () => {
  const p = createTestOutputParser();
  p.line('TAP version 13');
  for (let i = 0; i <= MAX_TESTS; i += 1) p.line(`ok ${i + 1} - t${i}`);
  const r = p.result();
  assert.equal(r.pass.length, MAX_TESTS);
  assert.equal(r.truncated, true);
  assert.equal(parseTestOutput(`TAP version 13\nok 1 - ${'x'.repeat(400)}\n`).pass[0].length, 300);
});

test('node:test (real output): a skip reason without the word SKIP is not part of the name', () => {
  const r = parseTestOutput(`▶ invoice totals
  ✔ adds lines (0.5ms)
  ﹣ later (0.1ms) # not today
✔ invoice totals (2.2ms)
ℹ pass 1
ℹ skipped 1
`);
  assert.deepEqual([r.pass, r.skip], [['invoice totals > adds lines'], ['invoice totals > later']]);
});

test('long lines parse fast (no pathological regex time)', () => {
  const ws = parseOnce(`TAP version 13\nok 1 - x${' '.repeat(100_000)}\n`);
  const colons = parseOnce(`${'a::'.repeat(20_000)}a\n`);
  assert.ok(ws.ms < 200, `whitespace run took ${ws.ms} ms`);
  assert.ok(colons.ms < 200, `:: line took ${colons.ms} ms`);
});
function parseOnce(text) {
  const t0 = performance.now();
  parseTestOutput(text);
  return { ms: performance.now() - t0 };
}

test('a suite that fails with no failing child (a failing hook) is in fail, TAP', () => {
  const r = parseTestOutput(`TAP version 13
# Subtest: db suite
    # Subtest: inserts
    ok 1 - inserts
    1..1
not ok 1 - db suite
  ---
  type: 'suite'
  ...
1..1
`);
  assert.ok(r.fail.includes('db suite'), JSON.stringify(r));
  assert.ok(r.pass.includes('db suite > inserts'));
});

test('a suite that fails with no failing child (a failing hook) is in fail, node-spec', () => {
  const r = parseTestOutput(`▶ db suite
  ✔ inserts (0.2ms)
✖ db suite (1.5ms)
ℹ pass 1
ℹ fail 1
`);
  assert.ok(r.fail.includes('db suite'), JSON.stringify(r));
  assert.ok(r.pass.includes('db suite > inserts'));
});

test('a failing suite with a failing child does not add the suite to fail', () => {
  const r = parseTestOutput(`▶ s
  ✖ bad (0.2ms)
✖ s (1.5ms)
`);
  assert.deepEqual(r.fail, ['s > bad']);
});

// ---- Real tool output (2026-11-12, WSL Ubuntu: pytest 9.2, Jest 30.5 and 29.7, Vitest 5.1; `.c0` colour off, `.c1` on). Each
// file in test/fixtures/test-output/ is a tool's own output, byte for byte (.superpowers/sdd/tool-formats-report.md).
const FIX = (name) => readFileSync(new URL(`./fixtures/test-output/${name}`, import.meta.url), 'utf8');
const S = (list) => [...list].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
const R = (format, pass, fail, skip, passListed, counts) => ({ format, pass: S(pass), fail: S(fail), skip: S(skip), passListed, counts, truncated: false });

const PY_PASS = ['test_a.py::test_top_pass', 'test_a.py::test_param[it\'s a "quoted" name with spaces]', 'test_a.py::TestOuter::test_in_class',
  'test_a.py::TestOuter::TestInner::test_nested', 'test_b.py::test_b_pass', 'test_b.py::test_b_other'];
const PY_FAIL = ['test_a.py::test_top_fail'];
const PY_COUNTS = { passed: 6, failed: 1, skipped: 1 };
const PY_X_PASS = ['test_x.py::test_slow', 'test_x.py::test_xp'];
const PY_X_COUNTS = { passed: 2, failed: 1, skipped: 2 };

test('pytest -v (real): SKIPPED/XFAIL/XPASS with a reason before [ NN%] are read', () => {
  for (const f of ['pytest-v.c0.txt', 'pytest-v.c1.txt']) {
    assert.deepEqual(parseTestOutput(FIX(f)), R('pytest', PY_PASS, PY_FAIL, ['test_a.py::test_top_skip'], true, PY_COUNTS), f);
  }
  // XPASS is a pass. XFAIL (an expected failure) is read as a skip, like the counts' "xfailed": never a pass, so a test that keeps
  // failing as expected is never a pass that "broke", and never a failure that is "still failing".
  assert.deepEqual(parseTestOutput(FIX('extra-pytest-v.txt')), R('pytest', PY_X_PASS, ['test_x.py::test_err'], ['test_x.py::test_skipif', 'test_x.py::test_xf'],
    true, PY_X_COUNTS));
});

test('pytest -rA (real): "SKIPPED [1] file.py:9: reason" names the skip by its place', () => {
  for (const f of ['pytest-rA.c0.txt', 'pytest-rA.c1.txt']) {
    assert.deepEqual(parseTestOutput(FIX(f)), R('pytest', PY_PASS, PY_FAIL, ['test_a.py:9'], true, PY_COUNTS), f);
  }
  assert.deepEqual(parseTestOutput(FIX('extra-pytest-rA.txt')), R('pytest', PY_X_PASS, ['test_x.py::test_err'], ['test_x.py:10', 'test_x.py::test_xf'], true,
    PY_X_COUNTS));
  // A reason holding "::" is still the reason, not a test name.
  assert.deepEqual(parseTestOutput('=== short test summary info ===\nSKIPPED [2] tests/test_b.py:14: needs a::b\n').skip, ['tests/test_b.py:14']);
});

test('pytest -q and -q -rA (real): the summary line without = bars gives the counts', () => {
  for (const f of ['pytest-q.c0.txt', 'pytest-q.c1.txt']) assert.deepEqual(parseTestOutput(FIX(f)), R('pytest', [], PY_FAIL, [], false, PY_COUNTS), f);
  for (const f of ['pytest-q-rA.c0.txt', 'pytest-q-rA.c1.txt']) {
    assert.deepEqual(parseTestOutput(FIX(f)), R('pytest', PY_PASS, PY_FAIL, ['test_a.py:9'], true, PY_COUNTS), f);
  }
  for (const f of ['pytest-default.c0.txt', 'pytest-default.c1.txt']) {
    assert.deepEqual(parseTestOutput(FIX(f)), R('pytest', [], PY_FAIL, [], false, PY_COUNTS), f);
  }
  // A line without bars is the counts only when it is nothing but counts.
  assert.equal(parseTestOutput('=== short test summary info ===\nFAILED t.py::a - x\nwe saw 3 passed runs in 2s\n').counts, null);
});

test('pytest collection error (real): "ERROR file.py" is a failure named by the file, never "nothing failed"', () => {
  assert.deepEqual(parseTestOutput(FIX('extra-pytest-collecterr.txt')), R('pytest', [], ['test_collect.py'], [], false, { passed: 0, failed: 1, skipped: 0 }));
  assert.deepEqual(parseTestOutput('=== short test summary info ===\nERROR tests/test_c.py - ModuleNotFoundError: x\n').fail, ['tests/test_c.py']);
});

const VT_PASS = ['a', 'b'].flatMap((x) => [`${x}.test.js > outer ${x} > passes ${x}`, `${x}.test.js > outer ${x} > inner ${x} > it's a "quoted" name with spaces ${x}`,
  `${x}.test.js > outer ${x} > second inner ${x} > another ${x}`, `${x}.test.js > top level ${x}`]);
const VT_FAIL = ['a.test.js > outer a > fails a'];
const VT_COUNTS = { passed: 8, failed: 1, skipped: 2 };

test('Vitest default reporter (real, piped): tree lines are not tests; the failure is named once, as verbose names it; passListed is false', () => {
  for (const f of ['vitest-default.c0.txt', 'vitest-default.c1.txt']) {
    assert.deepEqual(parseTestOutput(FIX(f)), R('vitest', [], VT_FAIL, [], false, VT_COUNTS), f);
  }
  // A slow test is listed under a collapsed all-pass file: still not a list of every test.
  assert.deepEqual(parseTestOutput(FIX('extra-vitest-default.txt')), R('vitest', [], [], [], false, { passed: 3, failed: 0, skipped: 1 }));
});

test('Vitest verbose (real): every test by name, the same failure name as the default reporter; □ todo is a skip', () => {
  for (const f of ['vitest-verbose.c0.txt', 'vitest-verbose.c1.txt']) {
    assert.deepEqual(parseTestOutput(FIX(f)), R('vitest', VT_PASS, VT_FAIL, ['a.test.js > outer a > inner a > skipped a', 'b.test.js > outer b > inner b > skipped b'],
      true, VT_COUNTS), f);
  }
  assert.deepEqual(parseTestOutput(FIX('extra-vitest-verbose.txt')), R('vitest', ['s.test.js > slow one', 's.test.js > g1 > t1', 's.test.js > g2 > t2'], [],
    ['s.test.js > todo item'], true, { passed: 3, failed: 0, skipped: 1 }));
});

const J = (...parts) => parts.join(' › ');
const JEST_PASS = ['a', 'b'].flatMap((x) => [J(`jest/${x}.test.js`, `top level ${x}`), J(`jest/${x}.test.js`, `outer ${x}`, `passes ${x}`),
  J(`jest/${x}.test.js`, `outer ${x}`, `inner ${x}`, `it's a "quoted" name with spaces ${x}`), J(`jest/${x}.test.js`, `outer ${x}`, `second inner ${x}`, `another ${x}`)]);
const JEST_SKIP = ['a', 'b'].map((x) => J(`jest/${x}.test.js`, `outer ${x}`, `inner ${x}`, `skipped ${x}`));
const JEST_FAIL = [J('jest/a.test.js', 'outer a', 'fails a')];

test('Jest verbose (real, 30.5 and 29.7) and default: every test, the same failure name; ✎ todo is a skip', () => {
  for (const f of ['jest-verbose.c0.txt', 'jest-verbose.c1.txt', 'extra-jest29-verbose.txt']) {
    assert.deepEqual(parseTestOutput(FIX(f)), R('jest', JEST_PASS, JEST_FAIL, JEST_SKIP, true, VT_COUNTS), f);
  }
  for (const f of ['jest-default.c0.txt', 'jest-default.c1.txt']) assert.deepEqual(parseTestOutput(FIX(f)), R('jest', [], JEST_FAIL, [], false, VT_COUNTS), f);
  const s = 'x/jest/s.test.js';
  assert.deepEqual(parseTestOutput(FIX('extra-jest-verbose.txt')), R('jest', [J(s, 'slow one'), J(s, 'g1', 't1'), J(s, 'g2', 't2')], [], [J(s, 'todo item')],
    true, { passed: 3, failed: 0, skipped: 1 }));
});

test('a failure after MAX_TESTS names is still kept (a pass makes room); the run stays marked as cut', () => {
  const p = createTestOutputParser();
  p.line('TAP version 13');
  for (let i = 0; i < MAX_TESTS + 5; i += 1) p.line(`ok ${i + 1} - t${i}`);
  p.line(`not ok ${MAX_TESTS + 6} - late`);
  const r = p.result();
  assert.deepEqual(r.fail, ['late']);
  assert.equal(r.truncated, true);
  assert.equal(r.pass.length + r.fail.length + r.skip.length, MAX_TESTS);
  const q = createTestOutputParser();   // the report's case: pytest's summary, a FAILED line after 20,000 PASSED ones
  q.line('=========================== short test summary info ============================');
  for (let i = 0; i < MAX_TESTS; i += 1) q.line(`PASSED t.py::p${i}`);
  q.line('FAILED t.py::late_fail - assert 1 == 2');
  assert.deepEqual([q.result().fail, q.result().truncated], [['t.py::late_fail'], true]);
});

test('a run of failures only stays bounded: past MAX_TESTS failures the rest are dropped and the run is marked cut', () => {
  const p = createTestOutputParser();
  p.line('TAP version 13');
  for (let i = 0; i < MAX_TESTS + 10; i += 1) p.line(`not ok ${i + 1} - f${i}`);
  const r = p.result();
  assert.deepEqual([r.fail.length, r.truncated], [MAX_TESTS, true]);
});

// Vitest's default reporter in the real shape (vitest-default.c0.txt): a file with a failure is expanded as a tree, an all-pass
// file is one line. Before: a.test.js and b.test.js each fail one test. After: a.test.js is fixed (one line now) and b.test.js
// still fails the same test. Nothing broke, so a tree listed only before must not read as "lost" or "broke".
const VT_B_FAILING = ` ❯ b.test.js (5 tests | 1 failed | 1 skipped) 7ms
   ❯ outer b (4)
     × passes b 4ms
     ✓ inner b (2)
       ✓ it's a "quoted" name with spaces b 0ms
       ↓ skipped b
     ✓ second inner b (1)
       ✓ another b 0ms
   ✓ top level b 0ms`;
const VT_BEFORE = ` RUN  v5.1.0 /p/vt

${VT_B_FAILING}
 ❯ a.test.js (6 tests | 1 failed | 1 skipped) 17ms
   ❯ outer a (5)
     ✓ passes a 3ms
     ✓ inner a (2)
       ✓ it's a "quoted" name with spaces a 0ms
       ↓ skipped a
     ✓ second inner a (1)
       ✓ another a 0ms
     × fails a 10ms
   ✓ top level a 0ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  b.test.js > outer b > passes b
AssertionError: expected 1 to be 2 // Object.is equality

 FAIL  a.test.js > outer a > fails a
AssertionError: expected 1 to be 2 // Object.is equality

 Test Files  2 failed (2)
      Tests  2 failed | 7 passed | 2 skipped (11)
`;
const VT_AFTER = ` RUN  v5.1.0 /p/vt

${VT_B_FAILING}
 ✓ a.test.js (6 tests | 1 skipped) 12ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  b.test.js > outer b > passes b
AssertionError: expected 1 to be 2 // Object.is equality

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 8 passed | 2 skipped (11)
`;

test('Vitest default before and after: tests it listed only on one side are never "lost" or "broke"', () => {
  const b = parseTestOutput(VT_BEFORE);
  const a = parseTestOutput(VT_AFTER);
  assert.deepEqual([b.fail, b.passListed, a.fail, a.passListed], [['a.test.js > outer a > fails a', 'b.test.js > outer b > passes b'], false,
    ['b.test.js > outer b > passes b'], false]);
  const run = (ok, tests) => ({ ran: true, ok, exitCode: ok ? 0 : 1, timedOut: false, tests });
  const ba = beforeAfter(run(false, b), run(false, a));
  assert.deepEqual([ba.level, ba.failingNow, ba.noLongerFail.names], ['failures', { n: 0, names: [] }, ['a.test.js > outer a > fails a']]);
  assert.deepEqual(commandMet({ metWhen: 'breaks-nothing', afterOk: false, ba }), { met: true, why: 'nothing-broke' });
  // Fixed everywhere (every file one line now): met, nothing "lost".
  const allPass = parseTestOutput(' ✓ b.test.js (5 tests | 1 skipped) 6ms\n ✓ a.test.js (6 tests | 1 skipped) 12ms\n\n Test Files  2 passed (2)\n      Tests  9 passed | 2 skipped (11)\n');
  assert.deepEqual(commandMet({ metWhen: 'breaks-nothing', afterOk: true, ba: beforeAfter(run(false, b), run(true, allPass)) }), { met: true, why: null });
  // The other way round (a test listed after, not before) is no "broke" either: a.test.js fails anew, which is all it reports.
  const back = beforeAfter(run(false, a), run(false, b));
  assert.deepEqual(commandMet({ metWhen: 'breaks-nothing', afterOk: false, ba: back }), { met: false, why: 'failing-now', n: 1 });
});
