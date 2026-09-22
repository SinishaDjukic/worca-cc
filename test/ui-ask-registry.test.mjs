// test/ui-ask-registry.test.mjs — the ask renderer registry (ask-forms design §6,
// D6). Two halves: the pure module, and the proof that app.js's renderQpanel now
// dispatches through it with the four legacy bodies registered and NOTHING about
// the rendered panel moved.
//
// boot()/dispatch()/showRunning() are a deliberate local copy of
// test/ui-question.test.mjs:19-82 — the suites do not import each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { registerAskRenderer, askRendererFor, askKindOf } from '../ui/public/ask/registry.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot() {
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
  return { window, dispatch, showRunning, calls, wsBox };
}

const RUN_ID = 'run-reg-1';
function seed(ctx, question) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [{ runId: RUN_ID, title: 'Demo run', projectDir: '/tmp/p',
    status: 'running', startedAt: '2026-01-01T00:00:00Z', kind: 'run' }] });
  ctx.showRunning();
  ctx.dispatch({ type: 'question', runId: RUN_ID, ...question });
}
const panelOf = (window) => window.document.querySelector('#run-list .run-card .qpanel');

// ---------------------------------------------------------------- pure module

test('askKindOf reproduces the legacy ladder, including the issues-array arm', () => {
  assert.equal(askKindOf(null), null);
  assert.equal(askKindOf({ kind: 'workflow', issues: [] }), 'workflow');
  assert.equal(askKindOf({ kind: 'recovery' }), 'recovery');
  assert.equal(askKindOf({ kind: 'form', form: 'f', version: 1, askId: 'a_1', surface: 'any' }), 'form');
  assert.equal(askKindOf({ kind: 'gate' }), 'gate');
  assert.equal(askKindOf({ issues: [{ title: 'x' }] }), 'gate', 'a bare issues array is still a gate');
  assert.equal(askKindOf({ kind: 'questions' }), 'clarify');
  assert.equal(askKindOf({ kind: 'clarify' }), 'clarify');
  assert.equal(askKindOf({}), 'clarify');
});

test('register/lookup: last wins, missing members are filled, junk is ignored', () => {
  registerAskRenderer('zz-probe', { render: () => 'first' });
  registerAskRenderer('zz-probe', { render: () => 'second' });
  const r = askRendererFor('zz-probe');
  assert.equal(r.render(), 'second');
  assert.equal(r.collect(null), null, 'collect defaults to null');
  assert.equal(r.title({}, {}), '');
  assert.equal(r.count({}, {}), null);
  assert.equal(r.setErrors(null, []), undefined);
  registerAskRenderer('', { render: () => {} });
  assert.equal(askRendererFor(''), null);
  registerAskRenderer('zz-bad', { collect: () => {} });
  assert.equal(askRendererFor('zz-bad'), null, 'no render function, no registration');
  assert.equal(askRendererFor('nope'), null);
});

// ------------------------------------------------- app.js registers the four

test('app.js registers clarify, gate, recovery and workflow', async () => {
  await boot();
  for (const kind of ['clarify', 'gate', 'recovery', 'workflow']) {
    const r = askRendererFor(kind);
    assert.ok(r, `${kind} is registered`);
    assert.equal(typeof r.render, 'function');
    assert.equal(typeof r.title, 'function');
  }
});

test('the clarify panel is byte-identical to the pre-registry markup', async () => {
  const ctx = await boot();
  seed(ctx, { id: 'c1', kind: 'clarify', questions: [
    { id: 'q1', question: 'Where to store sessions?', options: ['Redis', 'Postgres', ''], allowFreeText: true },
  ] });
  const panel = panelOf(ctx.window);
  assert.ok(panel && !panel.classList.contains('hidden'));
  assert.equal(panel.querySelector('.qpanel-head b').textContent, 'Pipeline needs your input');
  assert.equal(panel.querySelector('.qpanel-head .qcount').textContent, '1 question');
  assert.equal(panel.querySelectorAll('.qopt').length, 2, 'the padded empty option is dropped');
  assert.equal(panel.querySelectorAll('.qfree').length, 1);
  assert.equal(panel.querySelector('.qanswered').textContent, '0 of 1 answered');
  assert.ok(panel.querySelector('.qopen'), 'the card keeps its Open run button');
  assert.ok(Array.isArray(panel.__answers), 'per-panel slots still land on panel.__answers');
});

test('kind:questions keeps the agent head; gate, recovery and workflow keep theirs', async () => {
  const q = await boot();
  seed(q, { id: 'q1', kind: 'questions', agent: 'implementer', questions: [{ id: 'a', question: 'Which DB?' }] });
  assert.equal(panelOf(q.window).querySelector('.qpanel-head b').textContent, 'implementer has questions');
  assert.equal(panelOf(q.window).querySelector('.qcount').textContent, '1 question');

  const g = await boot();
  seed(g, { id: 'g1', kind: 'gate', issues: [{ severity: 'major', title: 'Broken' }] });
  assert.equal(panelOf(g.window).querySelector('.qpanel-head b').textContent, 'Cycle gate');
  assert.equal(panelOf(g.window).querySelector('.qcount'), null, 'the gate head carries no count chip');
  assert.ok(panelOf(g.window).querySelector('.gate-another'));

  const rec = await boot();
  seed(rec, { id: 'r1', kind: 'recovery', recovery: { cls: 'rate_limit', message: 'slow down' } });
  assert.equal(panelOf(rec.window).querySelector('.qpanel-head b').textContent, 'rate limit error — action needed');
  assert.ok(panelOf(rec.window).querySelector('.recovery-retry'));
});

test('submitAnswer posts the clarify payload through the registry collect', async () => {
  const ctx = await boot();
  seed(ctx, { id: 'c1', kind: 'clarify', questions: [
    { id: 'q1', question: 'Where to store sessions?', options: ['Redis', 'Postgres'], allowFreeText: true },
  ] });
  const panel = panelOf(ctx.window);
  panel.querySelectorAll('.qopt')[1].dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  panel.querySelector('.btn-go').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const post = ctx.calls.find((c) => c.url === '/api/answer');
  assert.ok(post, 'an answer was posted');
  assert.deepEqual(JSON.parse(post.opts.body), {
    runId: RUN_ID, id: 'c1',
    payload: { answers: [{ id: 'q1', question: 'Where to store sessions?', choice: 'Postgres' }] },
  });
});
