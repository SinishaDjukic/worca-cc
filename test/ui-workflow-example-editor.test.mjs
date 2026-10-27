// test/ui-workflow-example-editor.test.mjs — Edit an example (canvas boards 2 and 24; C3, C5, C12, C20, G1, G5, G11, G17, G19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderExampleEditor, BLANK_EXAMPLE } from '../ui/public/workflows/example-editor.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((b) => b.textContent === text);
const example = () => ({
  id: 4, name: 'Bulk invoice export', request: 'Write the product brief for a bulk invoice export.',
  answers: [{ question: 'Which file formats should the export have?', answer: 'PDF and CSV, in one ZIP file.' }],
  otherwise: 'pick', basics: { noError: true, noHelp: true, maxCostUsd: 1.5, maxSentBack: null },
  checks: [{ id: 'c_1', kind: 'words', min: 400, max: 900 }, { id: 'c_2', kind: 'sections', names: ['Problem', 'Users', 'Success metric', 'Risks'] }],
  tries: 3, files: [{ name: 'interviews-q3.md', size: 10, sha256: 'x' }], note: null,
});
function boot(ex = example(), { perTryUsd = 0.55, result = { ok: true }, testRunning = false } = {}) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const calls = [];
  const actions = {
    back: () => calls.push(['back']),
    save: async (v) => { calls.push(['save', v]); return result; },
    tryOnce: async (v) => { calls.push(['tryOnce', v]); return { ok: true }; },
    addFiles: async (files, v) => { calls.push(['addFiles', files.map((f) => f.name), v.name]); return { ok: true, example: { id: 4, files: [...ex.files, { name: files[0].name, size: 1, sha256: 'y' }] } }; },
    removeFile: async (name) => { calls.push(['removeFile', name]); return { ok: true, example: { id: 4, files: [] } }; },
  };
  const root = window.document.getElementById('root');
  const ed = renderExampleEditor(root, ex, actions, { doc: window.document, win: window, scripts: [{ key: 'lint-md', displayName: 'Markdown lint' }], perTryUsd, draftLabel: 'v5 draft', testRunning });
  return { root, doc: window.document, win: window, calls, ed };
}

test('the board-2 layout: title, actions, cards 1, 2, 4 on the left and 3 on the right', () => {
  const { root } = boot();
  assert.equal(root.querySelector('.wft-crumbs .wft-title').textContent, 'Example: Bulk invoice export');
  assert.deepEqual([...root.querySelectorAll('.wft-crumbs .wft-acts button')].map((b) => b.textContent), ['Cancel', 'Try it once now', 'Save example']);
  assert.deepEqual([...root.querySelectorAll('.wft-col > .card h2')].map((h) => h.textContent), ['1. What Worca gets', "2. Your answers to Worca's questions", '4. How many tries']);
  assert.equal(root.querySelector('.wft-cols > .card h2').textContent, '3. What a good result needs');
  assert.deepEqual([...root.querySelectorAll('.wft-card > h2 + .hint')].map((h) => h.textContent), [
    'The same request and files are used every time this example is tried.',
    'Nobody watches while a test runs. If Worca asks one of these questions, it gets your answer.',
    'AI can answer differently each time. More tries give a surer result, and cost more.',
    'A try passes only when everything below is met.',
  ]);
  assert.equal(root.querySelector('.wft-grp-hint').textContent, 'Counted exactly, without AI. Pick a ready check, or a script from the Library.');
  assert.deepEqual([...root.querySelectorAll('.wft-sect .wft-line-text')].map((n) => n.textContent), ['Length is 400 to 900 words', 'Has the sections Problem, Users, Success metric and Risks']);
  const name = root.querySelector('#wft-ex-name');
  name.value = 'Bulk export'; name.dispatchEvent(new name.ownerDocument.defaultView.Event('input'));
  assert.equal(root.querySelector('.wft-crumbs .wft-title').textContent, 'Example: Bulk export');
});

test('Basics, tries and the estimate read back into the value', () => {
  const { root, ed } = boot();
  assert.deepEqual([...root.querySelectorAll('.wft-chk')].map((l) => [...l.querySelectorAll('.switch-label')].map((s) => s.textContent).join(' ')),
    ['Finishes without an error', 'Finishes without needing help from someone', 'Costs at most', 'Sent back for fixes at most times']);
  assert.ok([...root.querySelectorAll('.wft-chk')].every((l) => l.matches('label.switch-row') && l.querySelector('input.sw-input[role="switch"]')), 'on/off is a switch (design system)');
  assert.equal(root.querySelector('#wft-b-cost-usd').value, '$1.50');
  assert.equal(root.querySelector('#wft-b-fix').checked, false);
  assert.equal(root.querySelector('.wft-estimate').textContent, 'About $0.55 a try with v5 draft, so about $1.65 for this example.');
  click(byText(root, '.wft-c4 .seg button', '5'));
  assert.equal(root.querySelector('.wft-estimate').textContent, 'About $0.55 a try with v5 draft, so about $2.75 for this example.');
  root.querySelector('#wft-b-help').checked = false;
  root.querySelector('#wft-b-fix').checked = true;
  root.querySelector('#wft-b-fix-n').value = '1';
  root.querySelector('#wft-b-cost-usd').value = '$2';
  click(byText(root, '.wft-c2 .seg button', 'The try counts as failed'));
  const v = ed.value();
  assert.deepEqual([v.tries, v.otherwise, v.basics], [5, 'fail', { noError: true, noHelp: false, maxCostUsd: 2, maxSentBack: 1 }]);
  root.querySelector('#wft-b-cost').checked = false;
  assert.equal(ed.value().basics.maxCostUsd, null);
});

test('a new example: no cost limit unless set, the limit pre-filled from the usual cost, the C12 text when unknown', () => {
  const a = boot({ ...BLANK_EXAMPLE }, { perTryUsd: 0.55 });
  assert.equal(a.root.querySelector('.wft-crumbs .wft-title').textContent, 'New example');
  assert.deepEqual([a.root.querySelector('#wft-b-cost').checked, a.root.querySelector('#wft-b-cost-usd').value], [false, '$1.50']);
  const b = boot({ ...BLANK_EXAMPLE }, { perTryUsd: null });
  assert.equal(b.root.querySelector('.wft-estimate').textContent, 'Worca does not know the cost of a try yet: it learns it from the first tries.');
  assert.equal(b.root.querySelector('#wft-b-cost-usd').value, '');
});

test('questions and answers: edit, remove and add in a small dialog', async () => {
  const { root, doc, ed } = boot();
  click(byText(root, '.wft-c2 .wft-line button', 'Edit'));
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Edit the question and answer');
  doc.querySelector('#wft-qa-answer').value = 'CSV only.';
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.deepEqual(ed.value().answers, [{ question: 'Which file formats should the export have?', answer: 'CSV only.' }]);
  click(byText(root, '.wft-c2 button', 'Add a question and answer'));
  doc.querySelector('#wft-qa-question').value = 'Who may export?';
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(doc.querySelector('.wft-dlg-error').textContent, 'Write both the question and your answer.');
  doc.querySelector('#wft-qa-answer').value = 'Finance admins.';
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(ed.value().answers.length, 2);
  click(byText(root, '.wft-c2 .wft-line button', 'Edit'));
  click(doc.querySelector('.wft-dlg-remove'));
  assert.deepEqual(ed.value().answers.map((a) => a.question), ['Who may export?']);
});

test('automatic checks: the G1 dialog with a live label, refusals in plain words, scripts by name', async () => {
  const { root, doc, ed } = boot();
  click(byText(root, '.wft-sect button', 'Add an automatic check'));
  const kind = doc.querySelector('#wft-ck-kind');
  assert.deepEqual([...kind.options].map((o) => o.textContent), ['Length in words', 'Has these sections', 'Must mention a text', 'Must not mention a text', 'A file with this name is in the result', 'A Library script']);
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(doc.querySelector('.wft-dlg-error').textContent, 'Give a smallest or a largest number of words.');
  kind.value = 'mentions'; kind.dispatchEvent(new doc.defaultView.Event('change'));
  const text = doc.querySelector('#wft-ck-text');
  text.value = '200 invoices'; text.dispatchEvent(new doc.defaultView.Event('input'));
  assert.equal(doc.querySelector('.wft-ck-preview').textContent, 'Mentions "200 invoices"');
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(ed.value().checks.at(-1).text, '200 invoices');
  click(byText(root, '.wft-sect button', 'Add an automatic check'));
  const k2 = doc.querySelector('#wft-ck-kind');
  k2.value = 'script'; k2.dispatchEvent(new doc.defaultView.Event('change'));
  assert.equal(doc.querySelector('.wft-ck-preview').textContent, 'The Library script "Markdown lint" passes');
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.deepEqual([...root.querySelectorAll('.wft-sect .wft-line-text')].map((n) => n.textContent).slice(-2), ['Mentions "200 invoices"', 'The Library script "Markdown lint" passes']);
  click(byText(root, '.wft-sect .wft-line button', 'Edit'));
  assert.equal(doc.querySelector('#wft-ck-min').value, '400');
  click(doc.querySelector('.wft-dlg-remove'));
  assert.equal(ed.value().checks.length, 3);
});

test('save, try once, the error line, files', async () => {
  const { root, calls } = boot(example(), { result: { ok: false, error: 'The name must be 1 to 120 characters.' } });
  click(byText(root, '.wft-acts button', 'Save example'));
  await tick();
  assert.equal(calls[0][0], 'save');
  assert.equal(root.querySelector('.wft-error').textContent, 'The name must be 1 to 120 characters.');
  click(byText(root, '.wft-acts button', 'Try it once now'));
  await tick();
  assert.equal(calls[1][0], 'tryOnce');
  const x = root.querySelector('.wft-file-x');
  assert.deepEqual([x.getAttribute('aria-label'), x.textContent, !!x.querySelector('svg')], ['Remove interviews-q3.md', '', true], 'an icon, not a glyph');
  click(x);
  await tick();
  assert.deepEqual(calls[2], ['removeFile', 'interviews-q3.md']);
  assert.equal(root.querySelectorAll('.wft-file').length, 0);
  const picker = root.querySelector('#wft-ex-file');
  Object.defineProperty(picker, 'files', { configurable: true, value: [{ name: 'usage.csv' }] });
  picker.dispatchEvent(new picker.ownerDocument.defaultView.Event('change'));
  await tick();
  assert.deepEqual(calls[3], ['addFiles', ['usage.csv'], 'Bulk invoice export']);
  assert.deepEqual([...root.querySelectorAll('.wft-file > span')].map((s) => s.textContent), ['interviews-q3.md', 'usage.csv']);
  click(byText(root, '.wft-acts button', 'Cancel'));
  assert.deepEqual(calls.at(-1), ['back']);
});

test('while a test of the workflow runs, Try it once now is disabled with the hint (G19); Save still works', async () => {
  const { root, calls } = boot(example(), { testRunning: true });
  const tryBtn = byText(root, '.wft-acts button', 'Try it once now');
  assert.deepEqual([tryBtn.disabled, tryBtn.getAttribute('aria-describedby')], [true, 'wft-busy']);
  assert.equal(root.querySelector('#wft-busy').textContent, 'A test of this workflow is running. Wait for it, or stop it first.');
  click(byText(root, '.wft-acts button', 'Save example'));
  await tick();
  assert.equal(calls[0][0], 'save');
});

test('a file that differs from one already here only in case is refused before the upload; the same name replaces', async () => {
  const { root, calls } = boot();
  const picker = root.querySelector('#wft-ex-file');
  Object.defineProperty(picker, 'files', { configurable: true, value: [{ name: ' Interviews-Q3.MD ' }] });
  picker.dispatchEvent(new picker.ownerDocument.defaultView.Event('change'));
  await tick();
  assert.equal(root.querySelector('.wft-error').textContent, 'A file named interviews-q3.md is already here.');
  assert.equal(calls.length, 0, 'nothing is uploaded');
  Object.defineProperty(picker, 'files', { configurable: true, value: [{ name: 'notes.md' }, { name: 'NOTES.md' }] });
  picker.dispatchEvent(new picker.ownerDocument.defaultView.Event('change'));
  await tick();
  assert.equal(root.querySelector('.wft-error').textContent, 'A file named notes.md is already here.', 'two picks that are case twins');
  assert.equal(calls.length, 0);
  Object.defineProperty(picker, 'files', { configurable: true, value: [{ name: 'interviews-q3.md' }] });
  picker.dispatchEvent(new picker.ownerDocument.defaultView.Event('change'));
  await tick();
  assert.deepEqual(calls[0], ['addFiles', ['interviews-q3.md'], 'Bulk invoice export']);
  assert.equal(root.querySelector('.wft-error').textContent, '');
});
