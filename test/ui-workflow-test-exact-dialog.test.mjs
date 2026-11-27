// test/ui-workflow-test-exact-dialog.test.mjs — P4-M1: the four exact kinds in the dialog, and Switch from a criterion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openCheckDialog, renderExampleEditor } from '../ui/public/workflows/example-editor.mjs';

const setup = () => { const win = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true }).window; return { win, doc: win.document }; };
const pick = (doc, value) => { const k = doc.getElementById('wft-ck-kind'); k.value = value; k.dispatchEvent(new doc.defaultView.Event('change')); };

test('the four kinds are listed with their labels', () => {
  const { win, doc } = setup();
  openCheckDialog({ doc, win, onSave: () => {} });
  const labels = [...doc.getElementById('wft-ck-kind').options].map((o) => o.textContent);
  for (const l of ['Every quote is in the files', 'Numbers come from the files', 'No personal data', 'Links work']) assert.ok(labels.includes(l), l);
});

test('each exact kind shows the board hint and no fields, and saves a bare check', () => {
  const hints = {
    quotes: "Each sentence in quotation marks must appear word for word in the example's files or request. Small differences in spacing and quotation marks are ignored.",
    numbers: "Each number in the result must appear in the example's files or request.",
    'no-personal': 'No e-mail addresses, phone numbers, bank account or card numbers.',
    links: 'Every link in the result opens a real page.',
  };
  for (const [kind, hint] of Object.entries(hints)) {
    const { win, doc } = setup();
    let saved = null;
    openCheckDialog({ doc, win, onSave: (c) => { saved = c; } });
    pick(doc, kind);
    assert.equal(doc.querySelector('.wft-ck-kind-hint').textContent, hint, kind);
    assert.equal(doc.querySelectorAll('.wft-ck-fields input').length, 0, `${kind}: no fields`);
    assert.ok(doc.querySelector('.wft-ck-preview').textContent.length > 0, `${kind}: preview`);
    doc.querySelector('.wft-dlg-ok').click();
    assert.deepEqual(saved, { kind }, kind);
  }
});

test('Links work says how many links Worca opens', () => {
  const { win, doc } = setup();
  openCheckDialog({ doc, win, onSave: () => {} });
  pick(doc, 'links');
  assert.match(doc.querySelector('.wft-ck-fields').textContent, /opens at most 20 links of a result\. It never opens a link that may carry data from your example\./);
});

test('a project example reads quotes, numbers and personal data from the result or a file; links have no choice', () => {
  const { win, doc } = setup();
  let saved = null;
  openCheckDialog({ doc, win, project: true, onSave: (c) => { saved = c; } });
  pick(doc, 'numbers');
  assert.equal(doc.querySelectorAll('input[name="wft-ck-from"]').length, 2);
  doc.querySelector('input[name="wft-ck-from"][value="file"]').click();
  doc.getElementById('wft-ck-from-file').value = 'docs/release-notes.md';
  doc.querySelector('.wft-dlg-ok').click();
  assert.deepEqual(saved, { kind: 'numbers', file: 'docs/release-notes.md' });
  pick(doc, 'links');
  assert.equal(doc.querySelectorAll('input[name="wft-ck-from"]').length, 0);
});

test('Switch: the dialog opens on the suggestion, says so, and the check keeps the criterion\'s words', () => {
  const { win, doc } = setup();
  let saved = null;
  openCheckDialog({ doc, win, onSave: (c) => { saved = c; },
    suggest: { criterion: { id: 'k_2', text: "Mentions that today's export stops at 200 invoices" }, alt: { kind: 'mentions', text: '200' } } });
  assert.equal(doc.getElementById('wft-ck-kind').value, 'mentions');
  assert.equal(doc.getElementById('wft-ck-text').value, '200');
  assert.match(doc.querySelector('.wft-sugg').textContent, /Worca suggests[\s\S]*can be checked exactly/);
  assert.match(doc.querySelector('.wft-sugg').textContent, /An exact check is free, fast, and gives the same answer every time\./);
  doc.querySelector('.wft-sugg .btn-primary').click();   // "Switch to an exact check"
  assert.deepEqual({ kind: saved.kind, text: saved.text, said: saved.said }, { kind: 'mentions', text: '200', said: "Mentions that today's export stops at 200 invoices" });
});

test('user decision 1: opened from Switch, "Add check" is hidden; only the two suggestion buttons show', () => {
  const { win, doc } = setup();
  openCheckDialog({ doc, win, onSave: () => {}, suggest: { criterion: { id: 'k_1', text: 'Every quote is real' }, alt: { kind: 'quotes' } } });
  assert.equal(doc.getElementById('wft-ck-kind').value, 'quotes');
  assert.equal(doc.querySelector('.wft-dlg-ok').hidden, true, 'Add check is hidden');
  assert.deepEqual([...doc.querySelectorAll('.wft-sugg button')].map((b) => b.textContent), ['Switch to an exact check', 'Keep it as a criterion']);
  // Without a suggestion the dialog is the plain one.
  const other = setup();
  openCheckDialog({ doc: other.doc, win: other.win, onSave: () => {} });
  assert.equal(other.doc.querySelector('.wft-dlg-ok').hidden, false);
  assert.equal(other.doc.querySelector('.wft-sugg'), null);
});

test('Keep it as a criterion closes the dialog and saves nothing', () => {
  const { win, doc } = setup();
  let saved = null;
  openCheckDialog({ doc, win, onSave: (c) => { saved = c; }, suggest: { criterion: { id: 'k_1', text: 'Every quote is real' }, alt: { kind: 'quotes' } } });
  doc.querySelectorAll('.wft-sugg button')[1].click();
  assert.equal(saved, null);
  assert.equal(doc.getElementById('wft-ck-kind'), null, 'the dialog is gone');
});

test('editing a check keeps the words it had', () => {
  const { win, doc } = setup();
  let saved = null;
  openCheckDialog({ doc, win, check: { id: 'c_abc12345', kind: 'mentions', text: '200', said: 'Mentions 200' }, onSave: (c) => { saved = c; } });
  doc.getElementById('wft-ck-text').value = '300';
  doc.querySelector('.wft-dlg-ok').click();
  assert.equal(saved.said, 'Mentions 200');
  assert.equal(saved.text, '300');
});

test('I8: after Switch, value() has the new check with the criterion\'s words, and not the criterion', async () => {
  const { win, doc } = setup();
  doc.body.append(Object.assign(doc.createElement('section'), { id: 'root' }));
  const ex = { id: 4, name: 'Bulk invoice export', request: 'Write the brief.', answers: [], otherwise: 'pick',
    basics: { noError: true, noHelp: false, maxCostUsd: null, maxSentBack: null }, checks: [], tries: 1, files: [], note: null,
    criteria: [{ id: 'k_1', text: 'Names a success metric' }, { id: 'k_2', text: "Mentions that today's export stops at 200 invoices" }],
    judge: { model: 'claude-haiku-4-5' } };
  const ok = async () => ({ ok: true });
  const ed = renderExampleEditor(doc.getElementById('root'), ex, { back() {}, save: ok, tryOnce: ok, addFiles: ok, removeFile: ok, stopTest: ok },
    { doc, win, judgeModels: { models: [{ id: 'claude-haiku-4-5', label: 'Haiku 4.5', pays: 'Claude sign-in' }], suggested: null } });
  doc.querySelectorAll('.wft-crit')[1].querySelector('button.wft-switch').click();
  doc.querySelector('.wft-sugg .btn-primary').click();
  await new Promise((r) => setTimeout(r, 0));
  const v = ed.value();
  assert.deepEqual(v.criteria.map((c) => c.id), ['k_1'], 'the switched criterion is not saved again');
  assert.deepEqual(v.checks.map((c) => [c.kind, c.text, c.said]), [['mentions', '200', "Mentions that today's export stops at 200 invoices"]]);
  assert.equal(doc.querySelectorAll('.wft-crit').length, 1, 'the section repainted without it');
});
