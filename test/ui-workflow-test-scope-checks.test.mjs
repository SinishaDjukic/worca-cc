// test/ui-workflow-test-scope-checks.test.mjs — workflow tests 3b, Task 11: the project checks in the check dialog (board 33) and
// their rows in one example side by side (board 36), with the command's "Failed:" line (P45).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openCheckDialog } from '../ui/public/workflows/example-editor.mjs';
import { renderSideBySide } from '../ui/public/workflows/test-compare.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const byText = (doc, sel, t) => [...doc.querySelectorAll(sel)].find((x) => x.textContent === t);
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
function dialog({ project = true, check = null } = {}) {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const saved = [];
  openCheckDialog({ doc: window.document, win: window, scripts: [], project, check, onSave: (c) => saved.push(c) });
  return { doc: window.document, window, saved };
}
const pick = (doc, window, value) => { const k = doc.querySelector('#wft-ck-kind'); k.value = value; k.dispatchEvent(new window.Event('change')); };
const type = (doc, window, sel, v) => { const i = doc.querySelector(sel); i.value = v; i.dispatchEvent(new window.Event('input')); };

test('board 33: the project group lists the four project checks; the result group none of them', () => {
  const { doc } = dialog();
  const [result, proj] = [...doc.querySelectorAll('#wft-ck-kind optgroup')];
  assert.deepEqual([...proj.querySelectorAll('option')].map((o) => o.textContent),
    ['The command passes', 'Changes only files under …', 'Leaves these files unchanged', 'Changes at most N files']);
  assert.ok(![...result.querySelectorAll('option')].some((o) => ['command', 'under', 'unchanged', 'max-files'].includes(o.value)));
  const none = dialog({ project: false }).doc;
  assert.ok(![...none.querySelectorAll('#wft-ck-kind option')].some((o) => ['under', 'unchanged', 'max-files'].includes(o.value)), 'not without a project');
  const kept = dialog({ project: false, check: { id: 'c_1', kind: 'under', dirs: ['src/'] } }).doc;
  assert.equal(kept.querySelector('#wft-ck-kind').value, 'under', 'an edited project check keeps its kind');
});

test('board 33: Changes only files under …: Folders, its hint, the preview in code, and what is saved', async () => {
  const { doc, window, saved } = dialog();
  pick(doc, window, 'under');
  assert.equal(doc.querySelector('label[for="wft-ck-dirs"]').textContent, 'Folders');
  assert.ok(doc.querySelector('#wft-ck-dirs').classList.contains('wft-mono'));
  assert.equal(doc.querySelector('#wft-ck-dirs').closest('.field').querySelector('.hint').textContent,
    'Separate them with commas. Not met when the try changes a file anywhere else.');
  type(doc, window, '#wft-ck-dirs', 'src/, test/');
  assert.equal(doc.querySelector('.wft-ck-preview').textContent, 'Changes only files under src/ and test/');
  assert.deepEqual(texts(doc, '.wft-ck-preview .code'), ['src/', 'test/']);
  click(byText(doc, '.mk-dialog button', 'Add check'));
  await tick();
  assert.deepEqual(saved, [{ kind: 'under', dirs: ['src/', 'test/'] }]);
});

test('board 33: Leaves these files unchanged: Files, its hint with test/** in code', async () => {
  const { doc, window, saved } = dialog();
  pick(doc, window, 'unchanged');
  assert.equal(doc.querySelector('label[for="wft-ck-keep"]').textContent, 'Files');
  const hint = doc.querySelector('#wft-ck-keep').closest('.field').querySelector('.hint');
  assert.equal(hint.textContent, 'A name, or a pattern such as test/** for everything in a folder.');
  assert.equal(hint.querySelector('.code').textContent, 'test/**');
  type(doc, window, '#wft-ck-keep', 'test/fixtures/**, package-lock.json');
  assert.equal(doc.querySelector('.wft-ck-preview').textContent, 'Leaves these files unchanged: test/fixtures/**, package-lock.json');
  click(byText(doc, '.mk-dialog button', 'Add check'));
  await tick();
  assert.deepEqual(saved, [{ kind: 'unchanged', patterns: ['test/fixtures/**', 'package-lock.json'] }]);
});

test('board 33: Changes at most N files: Most files, a number box, its refusal (P41)', async () => {
  const { doc, window, saved } = dialog();
  pick(doc, window, 'max-files');
  const most = doc.querySelector('#wft-ck-max');
  assert.equal(doc.querySelector('label[for="wft-ck-max"]').textContent, 'Most files');
  assert.equal(most.inputMode, 'numeric');
  assert.ok(most.classList.contains('wft-ck-num'));
  assert.equal(most.closest('.field').querySelector('.hint').textContent, 'Added, changed and removed files all count.');
  type(doc, window, '#wft-ck-max', 'six');
  click(byText(doc, '.mk-dialog button', 'Add check'));
  await tick();
  assert.equal(doc.querySelector('.wft-dlg-error').textContent, 'The most files must be a whole number from 0 to 10000.');
  type(doc, window, '#wft-ck-max', '6');
  assert.equal(doc.querySelector('.wft-ck-preview').textContent, 'Changes at most 6 files');
  click(byText(doc, '.mk-dialog button', 'Add check'));
  await tick();
  assert.deepEqual(saved, [{ kind: 'max-files', max: 6 }]);
});

const verdict = (scope, command) => ({ basics: [], checks: [
  { id: 'c_1', label: 'The command npm test passes', kind: 'command', cmd: 'npm test', ...command },
  { id: 'c_2', label: 'Changes only files under src/ and test/', kind: 'under', dirs: ['src/', 'test/'], met: true, value: 'Met' },
  { id: 'c_3', label: 'Leaves these files unchanged: test/fixtures/**', kind: 'unchanged', patterns: ['test/fixtures/**'], met: true, value: 'Met' },
  { id: 'c_4', label: 'Changes at most 6 files', kind: 'max-files', max: 6, met: scope.met, value: scope.value }] });
function side() {
  const A = { tryId: 11, status: 'passed', connectors: 'pretend', text: null, wouldHaveSent: [], answeredReads: [],
    verdict: verdict({ met: true, value: '3 files' }, { met: true, value: '213 passed', output: 'ℹ pass 213' }), project: null };
  const B = { ...A, tryId: 12, status: 'failed', verdict: verdict({ met: true, value: '4 files' }, { met: false, value: '212 passed, 1 failed', output: 'ℹ pass 212\nℹ fail 1',
    failed: ['test/billing/invoice-totals.test.mjs > rounds three lines of 0.125 to 0.38', 'invoice totals > adds lines', 'x', 'y'], failedCount: 5 }) };
  return { run: { id: 5, kind: 'compare' }, compareTitle: 'Your v3 draft compared with v2', example: { id: 1, name: 'Ticket 482' }, labels: { a: 'v2', b: 'v3 draft' },
    row: { result: 'worse', a: { passed: 3, total: 3 }, b: { passed: 1, total: 3 } }, connectors: 'pretend', tries: [{ n: 1, a: A, b: B }], start: null, nothingPushed: false };
}

test('board 36: the scope rows with folders and patterns in code; the command\'s Failed line (P45)', () => {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  renderSideBySide(root, side(), { back() {}, pick() {}, readWhole() {}, loadChanges() {}, pickFile() {}, readChanges() {}, commandOutput() {} },
    { doc: window.document, tryIndex: 0, patches: new Map(), picked: {}, dateText: () => '28 Oct' });
  const rows = [...root.querySelectorAll('.wft-crow')].filter((r) => !r.classList.contains('is-head'));
  const byLabel = (start) => rows.find((r) => r.firstChild.textContent.startsWith(start));
  const under = byLabel('Changes only files under');
  assert.deepEqual(texts(under.firstChild, '.code'), ['src/', 'test/']);
  assert.equal(under.firstChild.textContent, 'Changes only files under src/ and test/');
  assert.deepEqual(texts(byLabel('Leaves these files unchanged'), '.wft-res'), ['Met', 'Met']);
  assert.deepEqual(texts(byLabel('Leaves these files unchanged').firstChild, '.code'), ['test/fixtures/**']);
  assert.deepEqual(texts(byLabel('Changes at most 6 files'), '.wft-res'), ['3 files', '4 files']);
  const why = root.querySelector('.wft-why-cmd');
  assert.equal(why.querySelector('span').textContent.startsWith('Not met for v3 draft: the command ended with an error.'), true);
  const failed = why.querySelector('.wft-failed-line');
  assert.equal(failed.textContent, 'Failed: test/billing/invoice-totals.test.mjs · "rounds three lines of 0.125 to 0.38"; "invoice totals > adds lines"; "x" and 2 more');
  assert.deepEqual(texts(failed, '.code'), ['test/billing/invoice-totals.test.mjs']);
});
