// test/ui-ask-form-panel.test.mjs — a kind:'form' ask end to end on the run page
// (ask-forms design §6): the panel head, the mounted form, the submit payload, the
// 422 arm, the busy sweep, and the rebuild key that must include `form` + `version`.
// The panel mounts only on the run page (test/helpers/run-page-boot.mjs); the Runs
// list row is just a link to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp as boot, runPanel, openRunPanel } from './helpers/run-page-boot.mjs';
import { checkRows } from './helpers/rows.mjs';

const RUN_ID = 'run-form-1';
// X1: `id` is the question id (POST /api/answer, the rebuild key); `askId` is the
// sanitized route token and is ONLY used to build /ask-files/<askId>/<index>.
const ASK = {
  type: 'question', runId: RUN_ID, id: 'questions-x:n_impl:1-r1', askId: 'questions-x_n_impl_1-r1',
  kind: 'form', agent: 'designer', surface: 'any',
  form: 'review-mockups', version: 1, title: 'Review mockups',
  data: { summary: 'Two directions.' },
  layout: [
    { widget: 'markdown', bind: 'data.summary' },
    { widget: 'select', field: 'verdict', label: 'Verdict' },
    { widget: 'textarea', field: 'notes', label: 'What should change?', when: { verdict: 'changes' } },
  ],
  answerSchema: { type: 'object', required: ['verdict'], properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'] },
    notes: { type: 'string', maxLength: 4000 },
  } },
  files: [],
};

// Open the run page for a run parked on `ask`; resolves to its .qpanel.
const seed = (ctx, ask = ASK) => openRunPanel(ctx, { runId: RUN_ID, question: ask });
const cardPanel = (w) => w.document.querySelector('#runs-list .qpanel');
const click = (w, n) => n.dispatchEvent(new w.Event('click', { bubbles: true }));

test('a form ask mounts on the run page (title, field count) and a valid answer posts { values } under the QUESTION id', async () => {
  const ctx = await boot();
  const panel = await seed(ctx);
  await checkRows([
    { name: 'a form ask paints the agent title, a field count and the mounted form', run: async () => {
      assert.ok(panel && !panel.classList.contains('hidden'));
      assert.equal(panel.querySelector('.qpanel-head b').textContent, 'Review mockups');
      assert.equal(panel.querySelector('.qcount').textContent, '1 field');
      assert.ok(panel.querySelector('.af-form'), 'the form renderer is mounted');
      assert.ok(panel.__askForm, 'the handle rides on the panel, per mount');
      assert.equal(panel.querySelector('.qanswered').textContent, '0 of 1 answered');
      assert.ok(panel.querySelector('.btn-primary'), 'the panel keeps the house Submit button');
      assert.equal(panel.querySelector('.qopen'), null, 'no Open run: you are on the run page');
      assert.ok(ctx.window.document.querySelector(`#runs-list .runs-row[data-run-id="${RUN_ID}"]`), 'the run is listed beside the page');
      assert.equal(cardPanel(ctx.window), null, 'and the list mounts no panel');
    } },
    { name: 'a valid answer posts { values } and leaves the question open until resume', run: async () => {
      click(ctx.window, panel.querySelectorAll('.af-choice')[1]);   // "changes"
      const ta = panel.querySelector('textarea');
      assert.equal(ta.closest('.af-fld').hidden, false, '`when` revealed the notes field');
      ta.value = 'tighten the spacing';
      ta.dispatchEvent(new ctx.window.Event('input'));
      assert.equal(panel.querySelector('.qanswered').textContent, '1 of 1 answered');
      click(ctx.window, panel.querySelector('.btn-primary'));
      await new Promise((r) => setTimeout(r, 0));
      const post = ctx.calls.find((c) => c.url === '/api/answer');
      assert.deepEqual(JSON.parse(post.opts.body), {
        runId: RUN_ID, id: 'questions-x:n_impl:1-r1',      // the QUESTION id, never askId
        payload: { values: { verdict: 'changes', notes: 'tighten the spacing' } },
      });
    } },
  ]);
});

test('a preview file URL is built from askId, never from the question id', async () => {
  const ask = { ...ASK, id: 'q:2', askId: 'q_2',
    layout: [{ widget: 'image', bind: 'data.hero' }, ...ASK.layout],
    data: { ...ASK.data, hero: 'shots/a.png' },
    fileRefs: [{ path: 'data.hero', rel: 'shots/a.png' }],
    files: [{ index: 0, rel: 'shots/a.png', name: 'a.png', mime: 'image/png', bytes: 2048, sha256: 'z' }] };
  const ctx = await boot();
  const src = (await seed(ctx, ask)).querySelector('.af-img img').getAttribute('src');
  assert.equal(src, `/api/runs/${RUN_ID}/ask-files/q_2/0`);
  assert.ok(!src.includes('q:2'), 'a raw question id is not a legal path segment');
});

test('an invalid answer never leaves the browser: the field is marked, nothing is posted', async () => {
  const ctx = await boot();
  const panel = await seed(ctx);
  click(ctx.window, panel.querySelector('.btn-primary'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ctx.calls.some((c) => c.url === '/api/answer'), false);
  const slot = panel.querySelector('.af-err');
  assert.equal(slot.hidden, false);
  assert.ok(slot.closest('.af-fld').classList.contains('af-bad'));
  assert.equal(panel.querySelector('.btn-primary').disabled, false, 'the panel is still usable');
});

test('a 422 un-busies, marks the field and keeps the typed value; a resubmit clears the stale marks and posts again', async () => {
  let n = 0;
  const ctx = await boot({ fetchHandler: (url) => (url === '/api/answer' ? Promise.resolve((n += 1) === 1
    ? { ok: false, status: 422, json: async () => ({ error: 'invalid answer',
      errors: [{ path: 'notes', code: 'maxLength', message: 'At most 4000 characters.' }] }) }
    : { ok: true, status: 200, json: async () => ({ ok: true }) }) : null) });
  const panel = await seed(ctx);
  await checkRows([
    { name: 'a 422 un-busies the panel, marks the field and keeps the question open', run: async () => {
      click(ctx.window, panel.querySelectorAll('.af-choice')[1]);
      panel.querySelector('textarea').value = 'x';
      panel.querySelector('textarea').dispatchEvent(new ctx.window.Event('input'));
      click(ctx.window, panel.querySelector('.btn-primary'));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(panel.querySelector('.btn-primary').disabled, false, 'un-busied');
      assert.equal(panel.querySelector('.btn-primary').textContent.includes('Resuming'), false);
      const slot = [...panel.querySelectorAll('.af-err')].find((s) => !s.hidden);
      assert.equal(slot.textContent, 'At most 4000 characters.');
      assert.ok(panel.querySelector('.af-form'), 'the panel was NOT rebuilt');
      assert.equal(panel.querySelector('textarea').value, 'x', 'the typed value survived');
    } },
    { name: 'a resubmit that passes locally clears the previous 422 marks before it posts', run: async () => {
      const shown = () => [...panel.querySelectorAll('.af-err')].filter((s) => !s.hidden).length;
      assert.equal(shown(), 1, 'the 422 marked notes');
      click(ctx.window, panel.querySelector('.btn-primary'));            // unchanged, resubmitted as is
      assert.equal(shown(), 0, 'the stale mark went with the resubmit, not only with the next edit');
      assert.equal(n, 2, 'and the answer was posted again');
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(panel.querySelector('.btn-primary').disabled, true, 'busy until the run resumes');
    } },
  ]);
});

test('form panel lifecycle: rebuild keyed on question id + form + version (unrelated frames never wipe a pick), resolve disposes the handle', async () => {
  const ctx = await boot();
  await checkRows([
    { name: 'the run page rebuild key includes form + version', run: async () => {
      const before = await seed(ctx);
      assert.equal(before.dataset.qid, 'questions-x:n_impl:1-r1|form|review-mockups|1|0',
        'the rebuild key is keyed on the QUESTION id plus form + version');
      before.querySelector('.af-choice').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
      ctx.dispatch({ type: 'log', runId: 'another-run', source: 'x', level: 'info', text: 'noise', ts: Date.now() });
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(runPanel(ctx).querySelector('.af-choice').getAttribute('aria-pressed'), 'true',
        'an unrelated frame never wipes the picked choice');

      ctx.dispatch({ ...ASK, version: 2 });
      const after = runPanel(ctx);
      assert.equal(after.dataset.qid, 'questions-x:n_impl:1-r1|form|review-mockups|2|0');
      assert.equal(after.querySelector('.af-choice').getAttribute('aria-pressed'), 'false',
        'a changed version forces a rebuild');
    } },
    { name: 'resolving the question disposes the form handle', run: async () => {
      const panel = runPanel(ctx);   // the version-2 rebuild from the previous row
      assert.ok(panel.__askForm);
      ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: 'questions-x:n_impl:1-r1' });
      assert.equal(panel.__askForm, null);
      assert.equal(panel.innerHTML, '');
      assert.equal(panel.dataset.qid || '', '', 'the rebuild stamp is cleared (paintRdQuestions stamps \'\')');
    } },
  ]);
});
