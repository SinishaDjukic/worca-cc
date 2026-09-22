// test/ui-ask-form-panel.test.mjs — a kind:'form' ask end to end in the run card
// and the run detail (ask-forms design §6): the panel head, the mounted form, the
// submit payload, the 422 arm, the busy sweep, the dual mount, and the rebuild
// key that must include `form` + `version`.
//
// boot()/dispatch()/showRunning() are a deliberate local copy of
// test/ui-question.test.mjs:19-82 — the suites do not import each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {} close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };
  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    return Promise.resolve({ ok: true, status: 200,
      json: async () => ({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); }
    catch { /* read-only global already present */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const dispatch = (msg) => wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
  const showRunning = () => { window.location.hash = 'running'; window.dispatchEvent(new window.Event('hashchange')); };
  const openDetail = async () => {
    window.location.hash = `running/${RUN_ID}`;
    window.dispatchEvent(new window.Event('hashchange'));
    await new Promise((r) => setTimeout(r, 0));
  };
  return { window, dispatch, showRunning, openDetail, calls, wsBox };
}

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

function seed(ctx, ask = ASK) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [{ runId: RUN_ID, title: 'Demo run', projectDir: '/tmp/p',
    status: 'running', startedAt: '2026-01-01T00:00:00Z', kind: 'run' }] });
  ctx.showRunning();
  ctx.dispatch(ask);
}
const cardPanel = (w) => w.document.querySelector('#run-list .run-card .qpanel');
const detailPanel = (w) => w.document.querySelector('#run-detail .rd-questions .qpanel');
const click = (w, n) => n.dispatchEvent(new w.Event('click', { bubbles: true }));

test('a form ask paints the agent title, a field count and the mounted form', async () => {
  const ctx = await boot();
  seed(ctx);
  const panel = cardPanel(ctx.window);
  assert.ok(panel && !panel.classList.contains('hidden'));
  assert.equal(panel.querySelector('.qpanel-head b').textContent, 'Review mockups');
  assert.equal(panel.querySelector('.qcount').textContent, '1 field');
  assert.ok(panel.querySelector('.af-form'), 'the form renderer is mounted');
  assert.ok(panel.__askForm, 'the handle rides on the panel, per mount');
  assert.equal(panel.querySelector('.qanswered').textContent, '0 of 1 answered');
  assert.ok(panel.querySelector('.btn-go'), 'the panel keeps the house Submit button');
  assert.ok(panel.querySelector('.qopen'), 'the card keeps Open run');
});

test('a valid answer posts { values } and leaves the question open until resume', async () => {
  const ctx = await boot();
  seed(ctx);
  const panel = cardPanel(ctx.window);
  click(ctx.window, panel.querySelectorAll('.af-choice')[1]);   // "changes"
  const ta = panel.querySelector('textarea');
  assert.equal(ta.closest('.af-fld').hidden, false, '`when` revealed the notes field');
  ta.value = 'tighten the spacing';
  ta.dispatchEvent(new ctx.window.Event('input'));
  assert.equal(panel.querySelector('.qanswered').textContent, '1 of 1 answered');
  click(ctx.window, panel.querySelector('.btn-go'));
  await new Promise((r) => setTimeout(r, 0));
  const post = ctx.calls.find((c) => c.url === '/api/answer');
  assert.deepEqual(JSON.parse(post.opts.body), {
    runId: RUN_ID, id: 'questions-x:n_impl:1-r1',      // the QUESTION id, never askId
    payload: { values: { verdict: 'changes', notes: 'tighten the spacing' } },
  });
});

test('a preview file URL is built from askId, never from the question id', async () => {
  const ask = { ...ASK, id: 'q:2', askId: 'q_2',
    layout: [{ widget: 'image', bind: 'data.hero' }, ...ASK.layout],
    data: { ...ASK.data, hero: 'shots/a.png' },
    fileRefs: [{ path: 'data.hero', rel: 'shots/a.png' }],
    files: [{ index: 0, rel: 'shots/a.png', name: 'a.png', mime: 'image/png', bytes: 2048, sha256: 'z' }] };
  const ctx = await boot();
  seed(ctx, ask);
  const src = cardPanel(ctx.window).querySelector('.af-img img').getAttribute('src');
  assert.equal(src, `/api/runs/${RUN_ID}/ask-files/q_2/0`);
  assert.ok(!src.includes('q:2'), 'a raw question id is not a legal path segment');
});

test('an invalid answer never leaves the browser: the field is marked, nothing is posted', async () => {
  const ctx = await boot();
  seed(ctx);
  const panel = cardPanel(ctx.window);
  click(ctx.window, panel.querySelector('.btn-go'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ctx.calls.some((c) => c.url === '/api/answer'), false);
  const slot = panel.querySelector('.af-err');
  assert.equal(slot.hidden, false);
  assert.ok(slot.closest('.af-fld').classList.contains('af-bad'));
  assert.equal(panel.querySelector('.btn-go').disabled, false, 'the panel is still usable');
});

test('a 422 un-busies the panel, marks the field and keeps the question open', async () => {
  const ctx = await boot({ fetchHandler: (url) => (url === '/api/answer' ? Promise.resolve({
    ok: false, status: 422,
    json: async () => ({ error: 'invalid answer',
      errors: [{ path: 'notes', code: 'maxLength', message: 'At most 4000 characters.' }] }),
  }) : null) });
  seed(ctx);
  const panel = cardPanel(ctx.window);
  click(ctx.window, panel.querySelectorAll('.af-choice')[1]);
  panel.querySelector('textarea').value = 'x';
  panel.querySelector('textarea').dispatchEvent(new ctx.window.Event('input'));
  click(ctx.window, panel.querySelector('.btn-go'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(panel.querySelector('.btn-go').disabled, false, 'un-busied');
  assert.equal(panel.querySelector('.btn-go').textContent.includes('Resuming'), false);
  const slot = [...panel.querySelectorAll('.af-err')].find((s) => !s.hidden);
  assert.equal(slot.textContent, 'At most 4000 characters.');
  assert.ok(panel.querySelector('.af-form'), 'the panel was NOT rebuilt');
  assert.equal(panel.querySelector('textarea').value, 'x', 'the typed value survived');
});

test('a resubmit that passes locally clears the previous 422 marks before it posts', async () => {
  let n = 0;
  const ctx = await boot({ fetchHandler: (url) => (url === '/api/answer' ? Promise.resolve((n += 1) === 1
    ? { ok: false, status: 422, json: async () => ({ error: 'invalid answer',
      errors: [{ path: 'notes', code: 'maxLength', message: 'At most 4000 characters.' }] }) }
    : { ok: true, status: 200, json: async () => ({ ok: true }) }) : null) });
  seed(ctx);
  const panel = cardPanel(ctx.window);
  click(ctx.window, panel.querySelectorAll('.af-choice')[1]);
  panel.querySelector('textarea').value = 'x';
  panel.querySelector('textarea').dispatchEvent(new ctx.window.Event('input'));
  click(ctx.window, panel.querySelector('.btn-go'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const shown = () => [...panel.querySelectorAll('.af-err')].filter((s) => !s.hidden).length;
  assert.equal(shown(), 1, 'the 422 marked notes');
  click(ctx.window, panel.querySelector('.btn-go'));            // unchanged, resubmitted as is
  assert.equal(shown(), 0, 'the stale mark went with the resubmit, not only with the next edit');
  assert.equal(n, 2, 'and the answer was posted again');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(panel.querySelector('.btn-go').disabled, true, 'busy until the run resumes');
});

test('submitting busies both mounted panels, including the rank drag rows', async () => {
  const ask = { ...ASK, id: 'q:rank', askId: 'q_rank', layout: [
    { widget: 'rank', field: 'order', label: 'Order', bind: 'data.items', titleKey: 'title' },
  ], data: { items: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] },
  answerSchema: { type: 'object', required: ['order'], properties: { order: { type: 'array', items: { type: 'string' } } } } };
  const ctx = await boot({ fetchHandler: (url) => (url === '/api/answer'
    ? new Promise(() => {}) : null) });          // never resolves: the panel stays busy
  seed(ctx, ask);
  await ctx.openDetail();
  const card = cardPanel(ctx.window);
  const detail = detailPanel(ctx.window);
  assert.ok(card && detail, 'both panels are mounted');
  assert.notEqual(card.__askForm, detail.__askForm, 'and hold independent handles');
  click(ctx.window, detail.querySelector('.btn-go'));
  await new Promise((r) => setTimeout(r, 0));
  for (const p of [card, detail]) {
    assert.equal(p.querySelector('.btn-go').disabled, true);
    assert.equal(p.querySelector('.af-rank li').draggable, false, 'drag is off while an answer is in flight');
  }
});

test('the detail rebuild key includes form + version', async () => {
  const ctx = await boot();
  seed(ctx);
  await ctx.openDetail();
  const before = detailPanel(ctx.window);
  assert.equal(before.dataset.qid, 'questions-x:n_impl:1-r1|form|review-mockups|1|0',
    'the rebuild key is keyed on the QUESTION id plus form + version');
  before.querySelector('.af-choice').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  ctx.dispatch({ type: 'log', runId: 'another-run', source: 'x', level: 'info', text: 'noise', ts: Date.now() });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(detailPanel(ctx.window).querySelector('.af-choice').getAttribute('aria-pressed'), 'true',
    'an unrelated frame never wipes the picked choice');

  ctx.dispatch({ ...ASK, version: 2 });
  const after = detailPanel(ctx.window);
  assert.equal(after.dataset.qid, 'questions-x:n_impl:1-r1|form|review-mockups|2|0');
  assert.equal(after.querySelector('.af-choice').getAttribute('aria-pressed'), 'false',
    'a changed version forces a rebuild');
});

test('resolving the question disposes the form handle', async () => {
  const ctx = await boot();
  seed(ctx);
  const panel = cardPanel(ctx.window);
  assert.ok(panel.__askForm);
  ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: 'questions-x:n_impl:1-r1' });
  assert.equal(panel.__askForm, null);
  assert.equal(panel.innerHTML, '');
  assert.equal(panel.dataset.qid, undefined);
});
