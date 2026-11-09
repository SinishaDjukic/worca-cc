// test/workflow-test-before-after.test.mjs — workflow tests 3b, Task 8 (D76): the command before and after the change,
// classified (SWE-bench's FAIL_TO_PASS / PASS_TO_PASS), and the words the side by side uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beforeAfter, NAMES_MAX, commandMet } from '../src/shared/workflow-tests/before-after.mjs';
import { normaliseCheck, checkLabel, COMMAND_MET_WHEN } from '../src/shared/workflow-tests/checks.mjs';
import { exampleFingerprint } from '../src/core/workflow-tests/store.mjs';
import { BEFORE_HEADING, beforeExitText, beforeNotRunText, BEFORE_GROUPS, FAILURES_ONLY_NOTE, EXIT_ONLY_NOTE, passedCountsText, addedText, moreNamesText,
  BEFORE_KEPT_TEXT, splitTestName, FAILED_LEAD } from '../src/shared/workflow-tests/project-text.mjs';

const T = (format, pass, fail, { skip = [], passListed = true, counts = null, truncated = false } = {}) => ({ format, pass, fail, skip, passListed, counts, truncated });
const B = (ok, tests, over = {}) => ({ ran: true, ok, exitCode: ok ? 0 : 1, timedOut: false, tests, at: '2026-10-28T09:00:00.000Z', cached: false, ...over });
const A = (ok, tests, over = {}) => ({ ok, exitCode: ok ? 0 : 1, timedOut: false, tests, ...over });

test('no before run: nothing; a before run that did not run: why', () => {
  assert.equal(beforeAfter(null, A(true, null)), null);
  assert.deepEqual(beforeAfter({ ran: false, reason: 'setup' }, A(true, null)), { ran: false, reason: 'setup' });
  assert.deepEqual(beforeAfter({ ran: false, reason: 'error', text: 'git failed' }, A(true, null)), { ran: false, reason: 'error', text: 'git failed' });
});

test('every test by name on both sides: made pass, still pass, broke, still failing, new, gone', () => {
  const before = B(false, T('tap', ['a', 'b', 'c', 'gone1'], ['x', 'y']));
  const after = A(false, T('tap', ['a', 'b', 'x', 'n1'], ['c', 'y', 'n2']));
  assert.deepEqual(beforeAfter(before, after), { ran: true, level: 'tests', beforeOk: false, beforeTimedOut: false, afterOk: false, cached: false,
    at: '2026-10-28T09:00:00.000Z',
    madePass: { n: 1, names: ['x'] }, stillPass: { n: 2 }, broke: { n: 1, names: ['c'] }, stillFailing: { n: 1, names: ['y'] },
    added: { n: 2, failing: 1 }, gone: { n: 1, names: ['gone1'] }, lostPass: { n: 1 } });
});

test('names are capped, counts are not; a cut parse is marked', () => {
  const many = Array.from({ length: 30 }, (_, i) => `t${String(i).padStart(2, '0')}`);
  const r = beforeAfter(B(true, T('tap', many, [])), A(false, T('tap', [], many, { truncated: true })));
  assert.equal(r.broke.n, 30);
  assert.equal(r.broke.names.length, NAMES_MAX);
  assert.equal(r.truncated, true);
});

test('only failures by name: failing now, no longer failing, still failing, and both counts', () => {
  const r = beforeAfter(B(false, T('jest', [], ['x', 'y'], { passListed: false, counts: { passed: 212, failed: 2, skipped: 0 } })),
    A(false, T('jest', [], ['y', 'z'], { passListed: false, counts: { passed: 212, failed: 2, skipped: 0 } })));
  assert.equal(r.level, 'failures');
  assert.deepEqual([r.failingNow, r.noLongerFail, r.stillFailing], [{ n: 1, names: ['z'] }, { n: 1, names: ['x'] }, { n: 1, names: ['y'] }]);
  assert.deepEqual(r.counts, { before: { passed: 212, failed: 2, skipped: 0 }, after: { passed: 212, failed: 2, skipped: 0 } });
});

test('exit code only: no format, different formats, or a time-out on either side', () => {
  for (const [b, a] of [[B(true, T(null, [], [])), A(false, T(null, [], []))], [B(true, T('tap', ['a'], [])), A(true, T('jest', [], [], { passListed: false }))],
    [B(false, T('tap', ['a'], []), { timedOut: true }), A(true, T('tap', ['a'], []))], [B(true, null), A(true, null)]]) {
    const r = beforeAfter(b, a);
    assert.equal(r.level, 'exit');
    assert.equal(r.madePass, undefined);
  }
});

test('the words (U1 proposals; the approved mock wins)', () => {
  assert.equal(BEFORE_HEADING, 'Before the change');
  const x = (beforeOk, afterOk, beforeTimedOut = false) => beforeExitText({ beforeOk, afterOk, beforeTimedOut });
  assert.deepEqual([x(true, true), x(false, true), x(true, false), x(false, false), x(false, true, true)], [
    'It passed before the change too.', 'It failed before the change, and passes now.', 'It passed before the change: the change broke it.',
    'It failed before the change too.', 'Before the change, it ran longer than its time limit.']);
  assert.deepEqual([beforeNotRunText({ reason: 'setup' }), beforeNotRunText({ reason: 'stopped' }), beforeNotRunText({ reason: 'error', text: 'git failed.' }),
    beforeNotRunText({ reason: 'error' })], ['Worca could not run it before the change: the setup step failed.',
    'Worca did not run it before the change: the test was stopped.', 'Worca could not run it before the change: git failed.',
    'Worca could not run it before the change.']);
  assert.deepEqual(BEFORE_GROUPS, { madePass: 'Tests the change made pass', stillPass: 'Tests that passed before and still pass', broke: 'Tests it broke',
    stillFailing: 'Tests that failed before and still fail', added: 'New tests', gone: 'Tests that no longer run',
    failingNow: 'Tests failing now that did not fail before', noLongerFail: 'Tests that failed before and no longer fail' });
  assert.equal(FAILURES_ONLY_NOTE, 'This test tool names only the tests that fail, so the tests that pass are counted, not named.');
  assert.equal(EXIT_ONLY_NOTE, "Worca could not read test names in this command's output, so it compares only whether the command passed.");
  assert.equal(passedCountsText(212, 213), 'Passed: 212 before, 213 now');
  assert.deepEqual([addedText(3, 1), addedText(1, 0)], ['3, 1 failing', '1']);
  assert.equal(moreNamesText(4), 'and 4 more');
  assert.equal(BEFORE_KEPT_TEXT, ' · kept from an earlier test');
  assert.equal(FAILED_LEAD, 'Failed: ');
});

test('D82: the choice on the command check: stored only when it is "breaks nothing", its label, its fingerprint', () => {
  assert.deepEqual(COMMAND_MET_WHEN, ['passes', 'breaks-nothing']);
  const c = (raw) => normaliseCheck({ kind: 'command', cmd: 'npm test', ...raw }).check;
  assert.deepEqual(c({}), { kind: 'command', cmd: 'npm test', timeoutMin: 10 });
  assert.deepEqual(c({ metWhen: 'passes' }), { kind: 'command', cmd: 'npm test', timeoutMin: 10 }, 'the default is not stored');
  assert.deepEqual(c({ metWhen: 'breaks-nothing' }), { kind: 'command', cmd: 'npm test', timeoutMin: 10, metWhen: 'breaks-nothing' });
  assert.equal(normaliseCheck({ kind: 'command', cmd: 'npm test', metWhen: 'sometimes' }).error,
    'pick when the command is met: it passes, or it breaks nothing that passed before');
  assert.equal(checkLabel(c({ metWhen: 'breaks-nothing' })), 'The command npm test breaks nothing that passed before');
  assert.equal(checkLabel(c({})), 'The command npm test passes');
  const ex = (check) => ({ request: 'r', files: [], answers: [], otherwise: 'pick', basics: {}, checks: [check], project: null });
  assert.equal(exampleFingerprint(ex(c({ metWhen: 'passes' }))), exampleFingerprint(ex(c({}))), 'the default keeps every fingerprint');
  assert.notEqual(exampleFingerprint(ex(c({ metWhen: 'breaks-nothing' }))), exampleFingerprint(ex(c({}))), 'switching it: earlier tries are not reused');
});

test('D82: "breaks nothing that passed before", judged at each level on the evidence that level has', () => {
  const tests = (o) => ({ ran: true, level: 'tests', beforeOk: false, beforeTimedOut: false, afterOk: false, broke: { n: 0, names: [] }, lostPass: { n: 0 }, ...o });
  const BN = (afterOk, ba, afterTimedOut = false) => commandMet({ metWhen: 'breaks-nothing', afterOk, afterTimedOut, ba });
  assert.deepEqual(commandMet({ metWhen: 'passes', afterOk: false, ba: tests() }), { met: false, why: 'failed' }, 'the default: the exit code only');
  assert.deepEqual(commandMet({ afterOk: true, ba: null }), { met: true, why: null });
  assert.deepEqual(BN(true, null), { met: true, why: null }, 'it passes: nothing it checks broke');
  assert.deepEqual(BN(false, tests(), true), { met: false, why: 'timed-out' });
  assert.deepEqual(BN(false, null), { met: false, why: 'no-before' });
  assert.deepEqual(BN(false, { ran: false, reason: 'setup' }), { met: false, why: 'no-before' });
  assert.deepEqual(BN(false, tests()), { met: true, why: 'nothing-broke' });
  assert.deepEqual(BN(false, tests({ broke: { n: 2, names: ['a', 'b'] } })), { met: false, why: 'broke', n: 2 });
  assert.deepEqual(BN(false, tests({ lostPass: { n: 1 } })), { met: false, why: 'lost', n: 1 }, 'a test that passed and no longer runs hides a breakage');
  assert.deepEqual(BN(false, tests({ truncated: true })), { met: false, why: 'cannot-tell' }, 'a cut list proves nothing');
  const counts = (b, a) => ({ before: { passed: b, failed: 1, skipped: 0 }, after: { passed: a, failed: 1, skipped: 0 } });
  const fails = (o) => ({ ran: true, level: 'failures', beforeOk: false, beforeTimedOut: false, afterOk: false, failingNow: { n: 0, names: [] }, counts: counts(212, 212), ...o });
  assert.deepEqual(BN(false, fails()), { met: true, why: 'nothing-broke' });
  assert.deepEqual(BN(false, fails({ failingNow: { n: 1, names: ['x'] } })), { met: false, why: 'failing-now', n: 1 });
  assert.deepEqual(BN(false, fails({ counts: counts(212, 209) })), { met: false, why: 'fewer-pass', before: 212, after: 209 });
  assert.deepEqual(BN(false, fails({ counts: { before: null, after: null } })), { met: false, why: 'cannot-tell' });
  const exit = (beforeOk) => ({ ran: true, level: 'exit', beforeOk, beforeTimedOut: false, afterOk: false });
  assert.deepEqual(BN(false, exit(true)), { met: false, why: 'broke-exit' });
  assert.deepEqual(BN(false, exit(false)), { met: false, why: 'cannot-tell' }, 'failing before too is no evidence that the same tests fail');
  assert.deepEqual(BN(false, { ...exit(false), beforeTimedOut: true }), { met: false, why: 'cannot-tell' });
});

test('a test name split for board 36\'s Failed line: the test file, then the test', () => {
  assert.deepEqual(splitTestName(`test/billing/invoice-totals.test.mjs > invoice totals > rounds`), { file: 'test/billing/invoice-totals.test.mjs', test: 'invoice totals > rounds' });
  assert.deepEqual(splitTestName('src/a.test.js › suite › t'), { file: 'src/a.test.js', test: 'suite › t' });
  assert.deepEqual(splitTestName('tests/test_dates.py::test_time_zone[utc]'), { file: 'tests/test_dates.py', test: 'test_time_zone[utc]' });
  assert.deepEqual(splitTestName('invoice totals > rounds'), { file: null, test: 'invoice totals > rounds' });
  assert.deepEqual(splitTestName('plain'), { file: null, test: 'plain' });
});

test('2026-11-09: a test that passed before and is skipped now counts as broken; "breaks nothing" is never met by skipping it', () => {
  const BN = (afterOk, ba) => commandMet({ metWhen: 'breaks-nothing', afterOk, ba });
  // Tests by name: listed with the broken ones (one list, sorted), not as missing (it still runs, skipped).
  const r = beforeAfter(B(true, T('tap', ['a', 'b', 'c', 'd'], [])), A(false, T('tap', ['a', 'd'], ['c'], { skip: ['b'] })));
  assert.deepEqual([r.broke, r.lostPass, r.stillPass, r.gone], [{ n: 2, names: ['b', 'c'] }, { n: 0 }, { n: 2 }, { n: 0, names: [] }]);
  assert.deepEqual(BN(false, r), { met: false, why: 'broke', n: 2 });
  const onlySkipped = beforeAfter(B(true, T('tap', ['a', 'b'], [])), A(true, T('tap', ['a'], [], { skip: ['b'] })));
  assert.deepEqual(onlySkipped.broke, { n: 1, names: ['b'] });
  assert.deepEqual(BN(true, onlySkipped), { met: false, why: 'broke', n: 1 }, 'the command passes because the test was switched off');
  assert.deepEqual(commandMet({ metWhen: 'passes', afterOk: true, ba: onlySkipped }), { met: true, why: null }, 'the default stays the exit code');
  // A test that failed before and is skipped now did not pass before: not broken.
  const failToSkip = beforeAfter(B(false, T('tap', ['a'], ['x'])), A(false, T('tap', ['a'], ['y'], { skip: ['x'] })));
  assert.deepEqual([failToSkip.broke, BN(false, failToSkip)], [{ n: 0, names: [] }, { met: true, why: 'nothing-broke' }]);
  // Only failures by name: nothing is named, so the counts decide; more skipped now than before is not met (fail closed).
  const counts = (b, a) => ({ before: { passed: b[0], failed: 1, skipped: b[1] }, after: { passed: a[0], failed: 1, skipped: a[1] } });
  const fails = (c) => ({ ran: true, level: 'failures', beforeOk: false, beforeTimedOut: false, afterOk: false, failingNow: { n: 0, names: [] }, counts: c });
  assert.deepEqual(BN(false, fails(counts([212, 0], [212, 1]))), { met: false, why: 'more-skipped', before: 0, after: 1 }, 'one skipped, one new passing test');
  assert.deepEqual(BN(false, fails(counts([212, 0], [211, 1]))), { met: false, why: 'fewer-pass', before: 212, after: 211 });
  assert.deepEqual(BN(true, fails(counts([212, 0], [212, 1]))), { met: false, why: 'more-skipped', before: 0, after: 1 });
  assert.deepEqual(BN(false, fails(counts([212, 2], [212, 2]))), { met: true, why: 'nothing-broke' });
  assert.deepEqual(BN(true, fails(counts([212, 2], [213, 1]))), { met: true, why: null });
  // With no evidence a passing command stays met: nothing shows a test switched off.
  assert.deepEqual(BN(true, { ran: true, level: 'exit', beforeOk: true, beforeTimedOut: false, afterOk: true }), { met: true, why: null });
});

test('2026-11-09 (fix round 2): a passing test deleted, or fewer passing than before, makes "breaks nothing" not met even when the command passes', () => {
  const BN = (afterOk, ba) => commandMet({ metWhen: 'breaks-nothing', afterOk, ba });
  // (a) Tests by name, the command passes, a test that passed before is gone now.
  const deleted = beforeAfter(B(true, T('tap', ['a', 'b'], [])), A(true, T('tap', ['a'], [])));
  assert.deepEqual([deleted.lostPass, deleted.gone, deleted.broke], [{ n: 1 }, { n: 1, names: ['b'] }, { n: 0, names: [] }]);
  assert.deepEqual(BN(true, deleted), { met: false, why: 'lost', n: 1 });
  assert.deepEqual(commandMet({ metWhen: 'passes', afterOk: true, ba: deleted }), { met: true, why: null }, 'the default stays the exit code');
  // A broken test is named first, as when the command fails.
  const both = beforeAfter(B(true, T('tap', ['a', 'b', 'c'], [])), A(true, T('tap', ['a'], [], { skip: ['c'] })));
  assert.deepEqual(BN(true, both), { met: false, why: 'broke', n: 1 });
  // A test that failed before and is gone now did not pass before: still met.
  assert.deepEqual(BN(true, beforeAfter(B(false, T('tap', ['a'], ['x'])), A(true, T('tap', ['a'], [])))), { met: true, why: null });
  // (b) Only failures by name, the command passes, fewer passing now than before.
  const counts = (b, a) => ({ before: { passed: b, failed: 0, skipped: 0 }, after: { passed: a, failed: 0, skipped: 0 } });
  const fails = (c) => ({ ran: true, level: 'failures', beforeOk: true, beforeTimedOut: false, afterOk: true, failingNow: { n: 0, names: [] }, counts: c });
  assert.deepEqual(BN(true, fails(counts(212, 209))), { met: false, why: 'fewer-pass', before: 212, after: 209 });
  assert.deepEqual(BN(true, fails(counts(212, 212))), { met: true, why: null });
  assert.deepEqual(BN(true, fails({ before: null, after: null })), { met: true, why: null }, 'no counts: no evidence, still met');
  // (c) A rename (one gone, one new, both passing): not met; the expert sees both names and can overrule.
  const renamed = beforeAfter(B(true, T('tap', ['a', 'old name'], [])), A(true, T('tap', ['a', 'new name'], [])));
  assert.deepEqual([renamed.gone, renamed.added, renamed.lostPass], [{ n: 1, names: ['old name'] }, { n: 1, failing: 0 }, { n: 1 }]);
  assert.deepEqual(BN(true, renamed), { met: false, why: 'lost', n: 1 });
  // A cut list proves nothing went missing: a passing command stays met (as with no evidence).
  const cut = beforeAfter(B(true, T('tap', ['a', 'b'], [])), A(true, T('tap', ['a'], [], { truncated: true })));
  assert.deepEqual(BN(true, cut), { met: true, why: null });
});
