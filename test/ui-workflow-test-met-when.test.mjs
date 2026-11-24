// test/ui-workflow-test-met-when.test.mjs — workflow tests 3b, Task 14 (U4, D82; boards 43–44 and their polish, items 7–13):
// "Met when" on the command check in the check dialog, and the rows such a check makes in one example side by side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openCheckDialog } from '../ui/public/workflows/example-editor.mjs';
import { renderSideBySide } from '../ui/public/workflows/test-compare.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { metWhyText, COMMAND_HINT } from '../src/shared/workflow-tests/project-text.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const byText = (doc, sel, t) => [...doc.querySelectorAll(sel)].find((x) => x.textContent === t);
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
function dialog(check = null) {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const saved = [];
  openCheckDialog({ doc: window.document, win: window, scripts: [], project: true, check, onSave: (c) => saved.push(c) });
  const doc = window.document;
  if (!check) { const k = doc.querySelector('#wft-ck-kind'); k.value = 'command'; k.dispatchEvent(new window.Event('change')); }
  const cmd = doc.querySelector('#wft-ck-cmd');
  if (!check) { cmd.value = 'npm test'; cmd.dispatchEvent(new window.Event('input')); }
  return { doc, window, saved };
}
const HINT = 'Use this when some tests already fail on the start point. Those tests then do not count against the change, if Worca can read which tests failed.';

test('U4, board 43: Met when, under the command; "It passes" by default and not stored; the other choice saved and previewed', async () => {
  const { doc, window, saved } = dialog();
  const fs = doc.querySelector('.wft-ck-metwhen');
  assert.equal(fs.tagName, 'FIELDSET');
  assert.equal(fs.querySelector('legend').textContent, 'Met when');
  assert.deepEqual(texts(fs, '.wft-rad'), ['It passes · the command ends without an error',
    'It breaks nothing that passed before · Worca runs it once on the start point first and compares']);
  // Each radio's title and sub-line are its label.
  for (const l of fs.querySelectorAll('.wft-rad')) { assert.equal(l.tagName, 'LABEL'); assert.ok(l.querySelector('input[type="radio"]')); }
  assert.deepEqual(texts(fs, '.wft-rad-sub'), [' · the command ends without an error', ' · Worca runs it once on the start point first and compares']);
  assert.equal(fs.querySelector('input[value="passes"]').checked, true);
  const hint = doc.querySelector('.wft-ck-metwhen-hint');
  assert.equal(hint.textContent, HINT, 'polish 8');
  assert.equal(fs.getAttribute('aria-describedby'), hint.id, 'the hint describes the choice');
  // Board 43's order: the command, its time limit, Met when and its hint, then the preview.
  const fields = doc.querySelector('.wft-ck-fields');
  assert.deepEqual([...fields.children].map((n) => n.className), ['field', 'field', 'wft-ck-metwhen-wrap']);
  assert.equal(fields.querySelector('.field .hint').textContent, COMMAND_HINT);
  assert.equal(COMMAND_HINT, 'It runs in Worca\'s own copy of the project after the try is done. Worca shows its last summary line, for example "212 passed, 1 failed".', 'polish 7');
  assert.equal(doc.querySelector('.wft-ck-preview').textContent, 'The command npm test passes');
  click(byText(doc, '.mk-dialog button', 'Add check'));
  await tick();
  assert.deepEqual(saved, [{ kind: 'command', cmd: 'npm test', timeoutMin: 10 }]);

  const two = dialog();
  const r = two.doc.querySelector('.wft-ck-metwhen input[value="breaks-nothing"]');
  r.checked = true;
  r.dispatchEvent(new two.window.Event('change'));
  assert.equal(two.doc.querySelector('.wft-ck-preview').textContent, 'The command npm test breaks nothing that passed before');
  assert.equal(two.doc.querySelector('.wft-ck-preview .code').textContent, 'npm test');
  click(byText(two.doc, '.mk-dialog button', 'Add check'));
  await tick();
  assert.deepEqual(two.saved, [{ kind: 'command', cmd: 'npm test', timeoutMin: 10, metWhen: 'breaks-nothing' }]);
  void window;
});

test('U4, board 43: an edited check keeps its choice; "Edit the automatic check" and "Save check"; only the command check has it', async () => {
  const edit = dialog({ id: 'c_1', kind: 'command', cmd: 'npm test', timeoutMin: 10, metWhen: 'breaks-nothing' });
  assert.equal(edit.doc.querySelector('.wft-ck-metwhen input[value="breaks-nothing"]').checked, true);
  assert.equal(edit.doc.querySelector('.wft-ck-metwhen input[value="passes"]').checked, false);
  assert.equal(edit.doc.querySelector('.mk-dialog-title').textContent, 'Edit the automatic check');
  assert.equal(edit.doc.querySelector('.wft-ck-preview').textContent, 'The command npm test breaks nothing that passed before');
  click(byText(edit.doc, '.mk-dialog button', 'Save check'));
  await tick();
  assert.deepEqual(edit.saved, [{ id: 'c_1', kind: 'command', cmd: 'npm test', timeoutMin: 10, metWhen: 'breaks-nothing' }]);
  // Back to "It passes": the default is not stored.
  const back = dialog({ id: 'c_1', kind: 'command', cmd: 'npm test', timeoutMin: 10, metWhen: 'breaks-nothing' });
  const p = back.doc.querySelector('.wft-ck-metwhen input[value="passes"]');
  p.checked = true;
  p.dispatchEvent(new back.window.Event('change'));
  assert.equal(back.doc.querySelector('.wft-ck-preview').textContent, 'The command npm test passes');
  click(byText(back.doc, '.mk-dialog button', 'Save check'));
  await tick();
  assert.deepEqual(back.saved, [{ id: 'c_1', kind: 'command', cmd: 'npm test', timeoutMin: 10 }]);
  // Another kind has no "Met when".
  const other = dialog();
  const k = other.doc.querySelector('#wft-ck-kind');
  k.value = 'max-files';
  k.dispatchEvent(new other.window.Event('change'));
  assert.equal(other.doc.querySelector('.wft-ck-metwhen'), null);
  assert.equal(other.doc.querySelector('.wft-ck-metwhen-hint'), null);
});

const LABEL = 'The command npm test breaks nothing that passed before';
const cmdCheck = (over) => ({ id: 'c_1', label: LABEL, kind: 'command', cmd: 'npm test', metWhen: 'breaks-nothing', output: 'x', ...over });
function side(a, b) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  const v = (check, tryId) => ({ tryId, status: check.met ? 'passed' : 'failed', connectors: 'pretend', text: null, wouldHaveSent: [], answeredReads: [],
    verdict: { basics: [], checks: [check] }, project: null });
  renderSideBySide(root, { run: { id: 5, kind: 'compare' }, compareTitle: 'Your v3 draft compared with v2', example: { id: 1, name: 'Ticket 482' },
    labels: { a: 'v2', b: 'v3 draft' }, row: { result: 'worse', a: { passed: 1, total: 1 }, b: { passed: 0, total: 1 } }, connectors: 'pretend',
    tries: [{ n: 1, a: v(a, 11), b: v(b, 12) }], start: null, nothingPushed: false },
  { back() {}, pick() {}, readWhole() {}, loadChanges() {}, pickFile() {}, readChanges() {}, commandOutput() {} },
  { doc: window.document, tryIndex: 0, patches: new Map(), picked: {}, dateText: () => '28 Oct' });
  return root;
}
const rowOf = (root) => [...root.querySelectorAll('.wft-crow')].find((r) => r.firstChild.textContent === LABEL);

test('U4, board 44: the row reads the choice; met with an error: green dot, its summary and the neutral note; not met says why', () => {
  const root = side(cmdCheck({ met: true, value: '212 passed, 1 failed', metWhy: { why: 'nothing-broke' } }),
    cmdCheck({ met: false, value: '211 passed, 2 failed', metWhy: { why: 'broke', n: 1 } }));
  const row = rowOf(root);
  assert.deepEqual(texts(row.firstChild, '.code'), ['npm test']);
  assert.deepEqual(texts(row, '.wft-res'), ['212 passed, 1 failed · met', '211 passed, 2 failed · not met']);   // final review UI 7: hidden words
  const [ca, cb] = row.querySelectorAll('.wft-res');
  assert.ok(!ca.classList.contains('is-bad'), 'met: not red, though a test fails');
  assert.ok(ca.querySelector('.wft-dot.ok'), 'met: the green dot');
  assert.ok(cb.classList.contains('is-bad') && cb.querySelector('.wft-dot.no'));
  const note = row.querySelector('.wft-met-note');
  assert.equal(note.textContent, 'Met for v2: the command ended with an error, but every test that passed before still passes.');
  assert.equal(note.querySelector('b').textContent, 'Met for v2:', 'the note says "Met" in words, not by colour');
  assert.equal(row.querySelectorAll('.wft-why-cmd').length, 1, 'met: never the red box');
  assert.equal(row.querySelector('.wft-why-cmd .wft-why-col').textContent, 'Not met for v3 draft: it broke 1 test that passed before.');
  assert.equal(row.querySelector('.wft-why-cmd button').textContent, 'See the command output');
  // The note sits where the red box would, before the "Before the change" blocks (none here).
  assert.deepEqual([...row.children].slice(-2).map((n) => n.className), ['wft-met-note', 'wft-why-cmd']);
});

test('U4: met outright (the command passed) needs no note; a "passes" check keeps 3a\'s rows', () => {
  const root = side(cmdCheck({ met: true, value: '213 passed' }), cmdCheck({ met: true, value: '213 passed' }));
  const row = rowOf(root);
  assert.equal(row.querySelector('.wft-met-note'), null);
  assert.equal(row.querySelector('.wft-why-cmd'), null);
  const plain = side({ id: 'c_1', label: 'The command npm test passes', kind: 'command', cmd: 'npm test', met: true, value: '213 passed' },
    { id: 'c_1', label: 'The command npm test passes', kind: 'command', cmd: 'npm test', met: false, value: '212 passed, 1 failed', output: 'x' });
  const prow = [...plain.querySelectorAll('.wft-crow')].find((r) => r.firstChild.textContent === 'The command npm test passes');
  assert.equal(prow.querySelector('.wft-why-cmd .wft-why-col').textContent, 'Not met for v3 draft: the command ended with an error.');
  assert.equal(prow.querySelector('.wft-met-note'), null);
});

test('U4: not met although the command passed (a test skipped, gone, fewer passing, more skipped): no green dot, the red box says why', () => {
  const cases = [
    [{ why: 'broke', n: 1 }, 'Not met for v3 draft: it broke 1 test that passed before.'],
    [{ why: 'lost', n: 2 }, 'Not met for v3 draft: 2 tests that passed before no longer run.'],
    [{ why: 'fewer-pass', before: 212, after: 209 }, 'Not met for v3 draft: fewer tests pass now: 212 before, 209 now.'],
    [{ why: 'more-skipped', before: 0, after: 1 }, 'Not met for v3 draft: more tests are skipped now: 0 before, 1 now.'],
  ];
  for (const [metWhy, words] of cases) {
    // A command that passed has no output kept: the red box still says why, without "See the command output".
    const root = side(cmdCheck({ met: true, value: '213 passed' }), cmdCheck({ met: false, value: '212 passed', output: undefined, metWhy }));
    const row = rowOf(root);
    const cb = row.querySelectorAll('.wft-res')[1];
    assert.ok(cb.classList.contains('is-bad'), `${metWhy.why}: the not-met cell`);
    assert.equal(cb.querySelector('.wft-dot.ok'), null, `${metWhy.why}: no green dot`);
    assert.ok(cb.querySelector('.wft-dot.no'));
    assert.equal(row.querySelector('.wft-why-cmd .wft-why-col').textContent, words);
    assert.equal(row.querySelector('.wft-why-cmd button'), null);
    assert.equal(row.querySelector('.wft-met-note'), null);
  }
});

test('U4, board 44: "cannot tell" with no output and a time limit hit still say why', () => {
  const root = side(cmdCheck({ met: true, value: '213 passed' }), cmdCheck({ met: false, value: 'Ended with an error', output: undefined, metWhy: { why: 'cannot-tell' } }));
  assert.equal(rowOf(root).querySelector('.wft-why-cmd .wft-why-col').textContent,
    'Not met for v3 draft: the command ended with an error, and Worca could not read which tests failed, so it cannot tell whether the change broke something.');
  const t = side(cmdCheck({ met: true, value: '213 passed' }), cmdCheck({ met: false, value: 'Stopped', timedOut: true, metWhy: { why: 'timed-out' } }));
  assert.equal(rowOf(t).querySelector('.wft-why-cmd .wft-why-col').textContent, 'Not met for v3 draft: the command ran longer than its time limit and was stopped.');
  // A runner that threw never ran the command (a Worca problem): no reason to give, as in 3a.
  const w = side(cmdCheck({ met: true, value: '213 passed' }), cmdCheck({ met: false, value: 'Ended with an error', output: undefined, worcaProblem: true,
    error: 'spawn failed', metWhy: { why: 'no-before' } }));
  assert.equal(rowOf(w).querySelector('.wft-why-cmd'), null);
});

test('U4: every reason has its sentence (board 44, plus "more skipped")', () => {
  assert.deepEqual([
    metWhyText({ why: 'broke', n: 1 }), metWhyText({ why: 'broke', n: 3 }), metWhyText({ why: 'lost', n: 1 }), metWhyText({ why: 'lost', n: 2 }),
    metWhyText({ why: 'failing-now', n: 1 }), metWhyText({ why: 'failing-now', n: 2 }), metWhyText({ why: 'fewer-pass', before: 212, after: 209 }),
    metWhyText({ why: 'more-skipped', before: 0, after: 1 }), metWhyText({ why: 'more-skipped', before: 2, after: 5 }),
    metWhyText({ why: 'broke-exit' }), metWhyText({ why: 'cannot-tell' }), metWhyText({ why: 'no-before' }), metWhyText({ why: 'timed-out' }),
  ], [
    ' it broke 1 test that passed before.', ' it broke 3 tests that passed before.', ' 1 test that passed before no longer runs.',
    ' 2 tests that passed before no longer run.', ' 1 test fails now that did not fail before.', ' 2 tests fail now that did not fail before.',
    ' fewer tests pass now: 212 before, 209 now.', ' more tests are skipped now: 0 before, 1 now.', ' more tests are skipped now: 2 before, 5 now.',
    ' it passed before the change and fails now.',
    ' the command ended with an error, and Worca could not read which tests failed, so it cannot tell whether the change broke something.',
    ' Worca could not run it before the change, so it cannot tell what broke.', ' the command ran longer than its time limit and was stopped.',
  ]);
});

test('U4 styles: the Met when block and the neutral note are in workflow-tests.css', () => {
  const css = readStyleCss();
  assert.match(css, /\.wft-ck-metwhen-wrap\{[^}]*flex-direction:column/);
  assert.match(css, /\.wft-ck-metwhen-hint\{[^}]*margin:0/);
  assert.match(css, /\.wft-met-note\{[^}]*grid-column:1 \/ -1[^}]*background:var\(--field\)/);
});

// Final review M3: the failing tests were read (board 36's "Failed:" line names them), only the pass counts were not: the
// sentence above that line must not say Worca could not read which tests failed.
test('M3: failing names read but no pass counts: its own true sentence above the Failed line', () => {
  const words = ' Worca read which tests failed, but not how many passed, so it cannot tell whether the change broke something.';
  assert.equal(metWhyText({ why: 'no-counts' }), words);
  const root = side(cmdCheck({ met: true, value: '213 passed' }), cmdCheck({ met: false, value: 'Ended with an error', failed: ['test_x.py::test_b'], failedCount: 1,
    metWhy: { why: 'no-counts' } }));
  const row = rowOf(root);
  assert.equal(row.querySelector('.wft-why-cmd .wft-why-col').textContent.startsWith(`Not met for v3 draft:${words}`), true,
    row.querySelector('.wft-why-cmd .wft-why-col').textContent);
  assert.match(row.textContent, /Failed: test_x\.py/);
});

// Final review UI 7: in "What was checked", met or not met is never shown by colour alone: each cell says it in hidden words.
test('UI 7: every checked cell says met or not met in words a screen reader reads (the dot is hidden, red is colour)', () => {
  const root = side(cmdCheck({ met: true, value: '212 passed, 1 failed', metWhy: { why: 'nothing-broke' } }),
    cmdCheck({ met: false, value: '211 passed, 2 failed', metWhy: { why: 'broke', n: 1 } }));
  const [ca, cb] = rowOf(root).querySelectorAll('.wft-res');
  assert.deepEqual([ca.querySelector('.sr-only').textContent, cb.querySelector('.sr-only').textContent], [' · met', ' · not met']);
  assert.deepEqual([ca.textContent, cb.textContent], ['212 passed, 1 failed · met', '211 passed, 2 failed · not met']);
  // A value that already says it ("Met", "Not met") needs no second word.
  const said = side(cmdCheck({ met: true, value: 'Met' }), cmdCheck({ met: false, value: 'Not met' }));
  const cells = [...rowOf(said).querySelectorAll('.wft-res')];
  assert.deepEqual(cells.map((c) => [c.textContent, c.querySelector('.sr-only')]), [['Met', null], ['Not met', null]]);
});
