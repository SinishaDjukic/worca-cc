// test/ui-newpipeline-questions.test.mjs — New Pipeline per-step Questions toggle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

// Boot app.js in jsdom with a controllable fetch. Mirrors test/ui-cost.test.mjs.
async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4319/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  };
  window.fetch = (url, opts) => {
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    if (String(url).includes('/api/workflows')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'HTMLInputElement', 'HTMLSelectElement']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

const selectProjectAnd = (window) => {
  const s = window.document.querySelector('#projectSelect');
  s.value = PROJECT; s.dispatchEvent(new window.Event('change', { bubbles: true }));
};

// (after the copied boot() + selectProjectAnd() helpers)
const STEPS = [
  { key: 'clarify', label: 'Clarify', fanOut: true, asksQuestions: true, questionsLocked: true, questionsDefault: true },
  { key: 'planner', label: 'Plan', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false },
  { key: 'refiner', label: 'Refine', fanOut: false, asksQuestions: false, questionsLocked: false, questionsDefault: false },
  { key: 'implementer', label: 'Implement', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false },
  { key: 'reviewer', label: 'Review', fanOut: false, asksQuestions: true, questionsLocked: false, questionsDefault: false },
];
const configFetch = (extraConfig = {}, models = []) => (url, opts) => {
  if (url.includes('/api/config') && (!opts || !opts.method || opts.method === 'GET')) {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      config: { steps: {}, customModels: [], ...extraConfig }, models, efforts: [], steps: STEPS,
    }) });
  }
  return null;
};
const OPUS = [{ id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['high', 'max'] }];

test('default rows: clarify locked-checked; planner editable-unchecked; refiner hidden', async () => {
  const { window } = await boot({ fetchHandler: configFetch() });
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  const clarify = doc.querySelector('.step-questions[data-role="clarify"]');
  assert.ok(clarify, 'clarify questions checkbox exists');
  assert.equal(clarify.checked, true);
  assert.equal(clarify.disabled, true);
  const planner = doc.querySelector('.step-questions[data-role="planner"]');
  assert.equal(planner.checked, false);
  assert.equal(planner.disabled, false);
  const refinerWrap = doc.querySelector('.step-questions[data-role="refiner"]').closest('.questions-toggle');
  assert.equal(refinerWrap.hidden, true, 'no capability => toggle hidden');
});

test('toggling a default row posts askQuestions with the row model preserved', async () => {
  const posts = [];
  const { window } = await boot({ fetchHandler: (url, opts) => {
    if (url.includes('/api/config') && opts && opts.method === 'POST') {
      posts.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        config: { steps: { planner: { model: 'claude-opus-4-8', askQuestions: true } }, customModels: [] },
      }) });
    }
    // The saved model must be in the models list so the row's select can show
    // it — the toggle echoes the LIVE select (WYSIWYG), not state.config.
    return configFetch({ steps: { planner: { model: 'claude-opus-4-8' } } }, OPUS)(url, opts);
  } });
  selectProjectAnd(window); // saveStep needs a selected project
  await new Promise((r) => setTimeout(r, 0));
  const cb = window.document.querySelector('.step-questions[data-role="planner"]');
  cb.checked = true;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posts.length, 1, 'POST /api/config fired');
  assert.equal(posts[0].step, 'planner');
  assert.equal(posts[0].askQuestions, true);
  assert.equal(posts[0].model, 'claude-opus-4-8', 'row model preserved');
  assert.ok(!('fanOut' in posts[0]), 'fanOut omitted so the setter preserves it');
});

test('buildNodeConfigRows: hidden / locked / editable matrix', async () => {
  const { window } = await boot();
  const { buildNodeConfigRows } = window.__np;
  const wf = { steps: [[{ id: 'a', key: 'ask' }], [{ id: 'b', key: 'locked' }], [{ id: 'c', key: 'plain' }]], feedbacks: [] };
  const reg = {
    ask:    { key: 'ask', displayName: 'Ask', asksQuestions: true, questionsLocked: false, questionsDefault: false },
    locked: { key: 'locked', displayName: 'Locked', asksQuestions: true, questionsLocked: true, questionsDefault: true },
    plain:  { key: 'plain', displayName: 'Plain' },
  };
  const rows = buildNodeConfigRows(wf, reg, { nodes: { a: { askQuestions: true } }, feedbacks: {} });
  assert.equal(rows[0].askQuestions, true, 'saved override wins for unlocked');
  assert.equal(rows[0].questionsLocked, false);
  assert.equal(rows[1].askQuestions, true, 'locked follows manifest default');
  assert.equal(rows[1].questionsLocked, true);
  assert.equal(rows[2].askQuestions, null, 'no capability => no checkbox');
});

// Regression: a failing GET /api/config must NOT dead-end the whole form (the
// live bug: a 500 left the static markup — Default-only dropdown, empty selects,
// unconfigured Questions toggles). The workflow dropdown must still populate
// from /api/workflows, and the capability-unknown questions toggles must hide.
test('GET /api/config failure still populates the workflow dropdown and hides questions toggles', async () => {
  const { window } = await boot({ fetchHandler: (url, opts) => {
    if (url.includes('/api/config') && (!opts || !opts.method || opts.method === 'GET')) {
      return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'no such column: ask_questions' }) });
    }
    if (url.includes('/api/workflows') && !url.includes('/api/workflows/')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [
        { id: 'wf_default', name: 'Default' }, { id: 'wf_1', name: 'My Custom Pipeline' },
      ] }) });
    }
    return null;
  } });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  const options = [...doc.querySelector('#workflowSelect').options].map((o) => o.textContent);
  assert.deepEqual(options, ['Default', 'My Custom Pipeline'], 'dropdown populated despite config failure');
  for (const cb of doc.querySelectorAll('.step-questions[data-role]')) {
    assert.equal(cb.closest('.questions-toggle').hidden, true, `${cb.dataset.role} toggle hidden when capability unknown`);
  }
  const hint = doc.querySelector('#config-error');
  assert.equal(hint.hidden, false, 'error hint visible');
  assert.match(hint.textContent, /no such column: ask_questions/, 'hint carries the server error');
});

// The static markup must ship the questions toggles hidden: before ANY JS runs
// (or when it fails), an interactable-looking checkbox would misrepresent
// capability (refiner has none; clarify is locked-on).
test('index.html ships the default-stage questions toggles hidden', () => {
  const html = readFileSync(htmlPath, 'utf8');
  const toggles = html.match(/class="fanout-toggle questions-toggle"[^>]*/g) || [];
  assert.equal(toggles.length, 5, 'five static questions toggles');
  for (const t of toggles) assert.match(t, /\bhidden\b/, `static toggle not hidden: ${t}`);
});

// Toggling questions must echo the LIVE selects, not state.config — state lags
// one in-flight save, so echoing it can revert a model picked moments earlier.
test('toggling questions sends the model currently shown in the select, not stale state', async () => {
  const posts = [];
  const { window } = await boot({ fetchHandler: (url, opts) => {
    if (url.includes('/api/config') && opts && opts.method === 'POST') {
      posts.push(JSON.parse(opts.body));
      // Respond with a STALE config (the pre-change model) so state.config lags.
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        config: { steps: { planner: { model: 'claude-opus-4-8' } }, customModels: [] },
      }) });
    }
    return configFetch({ steps: { planner: { model: 'claude-opus-4-8' } } })(url, opts);
  } });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  // User picks a new model (select now shows it; state.config still has the old one)...
  const modelSel = doc.querySelector('.step-model[data-role="planner"]');
  modelSel.appendChild(new window.Option('New Model', 'my-new-model'));
  modelSel.value = 'my-new-model';
  // ...then immediately toggles Questions.
  const cb = doc.querySelector('.step-questions[data-role="planner"]');
  cb.checked = true;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const qPost = posts.find((p) => 'askQuestions' in p);
  assert.ok(qPost, 'questions POST fired');
  assert.equal(qPost.model, 'my-new-model', 'live select value sent, not stale state.config');
});

test('renderNodeRows: locked checkbox disabled; unsupported row has no checkbox', async () => {
  const { window } = await boot();
  const doc = window.document;
  const { renderNodeRows } = window.__np;
  renderNodeRows([
    { nodeId: 'a', key: 'ask', label: 'Ask', color: '', stepIndex: 0, parallel: false, model: '', effort: '', fanOut: false, askQuestions: false, questionsLocked: false },
    { nodeId: 'b', key: 'locked', label: 'Locked', color: '', stepIndex: 1, parallel: false, model: '', effort: '', fanOut: false, askQuestions: true, questionsLocked: true },
    { nodeId: 'c', key: 'plain', label: 'Plain', color: '', stepIndex: 2, parallel: false, model: '', effort: '', fanOut: false, askQuestions: null, questionsLocked: false },
  ]);
  const a = doc.querySelector('.step-questions[data-node-id="a"]');
  assert.ok(a && !a.disabled && !a.checked);
  const b = doc.querySelector('.step-questions[data-node-id="b"]');
  assert.ok(b && b.disabled && b.checked);
  assert.equal(doc.querySelector('.step-questions[data-node-id="c"]'), null);
});
