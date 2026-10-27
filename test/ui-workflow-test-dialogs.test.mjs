// test/ui-workflow-test-dialogs.test.mjs — Use this run as a test example (board 3, C4), the run picker (G7), and the
// rule for the run page's ⋯ item (G6). Task 13 adds Test a version (board 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openFromRunDialog, openPickRunDialog, canUseAsExample } from '../ui/public/workflows/test-dialogs.mjs';

const dom = () => { const d = new JSDOM('<!doctype html><body></body>'); return { doc: d.window.document, win: d.window }; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const past = (over = {}) => ({
  pipelineId: 'abcd1234', workflowId: 'wf_b', workflowName: 'Product brief writer', title: 'Saved filters for reports',
  request: 'Write the brief.', files: ['reports-interviews.md', 'usage.csv'],
  qa: [{ question: 'Who uses filters?', answer: 'Analysts' }, { question: 'Which reports?', answer: 'Monthly' }],
  use: 4, useLabel: 'v4', testable: true, reason: null, reasonText: null, ...over,
});

test('board 3: the heading, what is kept, the verdict and its hint, and what is sent', async () => {
  const { doc, win } = dom();
  let sent = null;
  openFromRunDialog({ doc, win, past: past(), onSubmit: async (b) => { sent = b; return { ok: true }; } });
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Use this run as a test example');
  assert.equal(doc.querySelector('.wft-fr-intro').textContent, 'Worca keeps the request and files, so every new version of Product brief writer can be tried on exactly the same thing.');
  assert.equal(doc.querySelector('#wft-fr-name').value, 'Saved filters for reports');
  assert.deepEqual([...doc.querySelectorAll('.wft-keep .wft-chk')].map((l) => l.textContent), [
    'The request and its 2 files (reports-interviews.md, usage.csv)',
    'The 2 questions Worca asked and your answers, so the test can run without you',
  ]);
  assert.ok(doc.querySelector('#wft-fr-request').checked && doc.querySelector('#wft-fr-answers').checked);
  assert.ok([...doc.querySelectorAll('.wft-keep input')].every((b) => b.classList.contains('wft-keep-box')), 'the listed picker token (ui-shared-controls)');
  const hint = doc.querySelector('.wft-fr-hint');
  assert.equal(hint.hidden, true, 'no verdict, no hint');
  click([...doc.querySelectorAll('.seg button')].find((b) => b.textContent === 'Not good enough'));
  assert.deepEqual([hint.hidden, hint.textContent], [false, 'This result came from v4 and was not good enough, so v4 shows as not good on this example until it is tested.']);
  click([...doc.querySelectorAll('.seg button')].find((b) => b.textContent === 'Good: keep it like this'));
  assert.equal(hint.textContent, 'This result came from v4 and was good, so v4 shows as good on this example until it is tested.');
  doc.querySelector('#wft-fr-answers').checked = false;
  doc.querySelector('#wft-fr-note').value = 'It should say how many people use filters today.';
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.deepEqual(sent, { name: 'Saved filters for reports', keepRequest: true, keepAnswers: false, verdict: 'good', note: 'It should say how many people use filters today.' });
  assert.equal(doc.querySelector('#mk-dialog'), null, 'closes on success');
});

test('one file, no questions, no name: the words follow, and a name is needed', async () => {
  const { doc, win } = dom();
  openFromRunDialog({ doc, win, past: past({ files: ['usage.csv'], qa: [], title: '' }), onSubmit: async () => ({ ok: false, error: 'Never sent.' }) });
  assert.deepEqual([...doc.querySelectorAll('.wft-keep .wft-chk')].map((l) => l.textContent), ['The request and its file (usage.csv)']);
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(doc.querySelector('.wft-dlg-error').textContent, 'Give the example a name.');
});

test('G7: pick a past run, then Next', async () => {
  const { doc, win } = dom();
  const picked = [];
  openPickRunDialog({ doc, win, workflowName: 'Product brief writer', dateText: () => '14 Oct', onPick: (id) => picked.push(id),
    runs: [{ pipelineId: 'p1', title: 'Bulk invoice export', at: 'x', status: 'done', files: 2, sameAs: null },
      { pipelineId: 'p2', title: 'Saved filters', at: 'x', status: 'error', files: 0, sameAs: null }] });
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Add from a past run');
  assert.equal(doc.querySelector('.mk-dialog-body > .hint').textContent, 'Pick a run of Product brief writer to keep as an example.');
  assert.deepEqual([...doc.querySelectorAll('.wft-pick-row')].map((r) => r.textContent), ['Bulk invoice export · 14 Oct · Finished', 'Saved filters · 14 Oct · Failed']);
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(doc.querySelector('.wft-dlg-error').textContent, 'Pick a run first.');
  doc.querySelectorAll('.wft-pick-row input')[1].checked = true;
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.deepEqual(picked, ['p2']);
  const empty = dom();
  openPickRunDialog({ doc: empty.doc, win: empty.win, workflowName: 'Product brief writer', runs: [], dateText: () => '', onPick: () => {} });
  assert.equal(empty.doc.querySelector('.mk-dialog-body > .hint').textContent, 'Worca found no runs of Product brief writer without a project yet. Run the workflow once, or write an example yourself.');
  assert.equal(empty.doc.querySelector('.wft-dlg-ok').disabled, true, 'board 25: nothing to pick, Next is disabled');
});

test('G6: only a finished no-project run of a saved user workflow, with the flag on', () => {
  const ok = { flag: true, noProject: true, status: 'done', templateId: 'wf_b', reserved: false };
  assert.equal(canUseAsExample(ok), true);
  assert.equal(canUseAsExample({ ...ok, status: 'error' }), true);
  for (const bad of [{ flag: false }, { noProject: false }, { status: 'running' }, { templateId: null }, { reserved: true }, { templateId: 'wfp_acme_brief' }]) {
    assert.equal(canUseAsExample({ ...ok, ...bad }), false, JSON.stringify(bad));
  }
});

test('board 3: one post per Add (busy while it posts), and a throw or refusal gives the button back with the reason', async () => {
  const { doc, win } = dom();
  let calls = 0;
  let release;
  let mode = 'hold';
  openFromRunDialog({ doc, win, past: past(), onSubmit: () => {
    calls += 1;
    if (mode === 'hold') return new Promise((r) => { release = r; });
    throw new Error('Worca did not answer.');
  } });
  const ok = doc.querySelector('.wft-dlg-ok');
  click(ok);
  assert.equal(ok.disabled, true, 'busy while it posts');
  click(ok);
  await tick();
  assert.equal(calls, 1, 'a second click while busy posts nothing');
  release({ ok: false, error: 'This run is of another workflow.' });
  await tick();
  assert.deepEqual([ok.disabled, doc.querySelector('.wft-dlg-error').textContent], [false, 'This run is of another workflow.']);
  mode = 'throw';
  click(ok);
  await tick();
  assert.deepEqual([calls, ok.disabled, doc.querySelector('.wft-dlg-error').textContent], [2, false, 'Worca did not answer.']);
  assert.ok(doc.querySelector('#mk-dialog'), 'still open');
});
