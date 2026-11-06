// test/workflow-test-test-output.test.mjs — workflow tests 3b, Task 7 (D74): the test names in a command's output. The fixtures
// are each tool's own output shape (Step 5 checks them against the real tools on this laptop).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTestOutput, createTestOutputParser, TEST_FORMATS, MAX_TESTS } from '../src/core/workflow-tests/test-output.mjs';

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
