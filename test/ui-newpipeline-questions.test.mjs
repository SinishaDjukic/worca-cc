// test/ui-newpipeline-questions.test.mjs — New Pipeline per-NODE Questions
// toggle. The hardcoded per-role stage rows are gone (see
// test/newpipeline-config.test.mjs); every questions toggle is now painted per
// agent node of the selected v2 graph, keyed by data-node-id.
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

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 6; i += 1) await tick(); }

const selectProjectAnd = (window) => {
  const s = window.document.querySelector('#projectSelect');
  s.value = PROJECT; s.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const pickWorkflow = (window, id) => {
  const s = window.document.querySelector('#workflowSelect');
  s.value = id; s.dispatchEvent(new window.Event('change', { bubbles: true }));
};

// Three agents covering the whole capability matrix: editable, locked-on, none.
const AGENTS = [
  {
    key: 'ask', displayName: 'Ask', color: 'violet', order: 1,
    asksQuestions: true, questionsLocked: false, questionsDefault: false,
    inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'out', type: 'md', when: 'always' }],
  },
  {
    key: 'locked', displayName: 'Locked', color: 'red', order: 2,
    asksQuestions: true, questionsLocked: true, questionsDefault: true,
    inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'out', type: 'md', when: 'always' }],
  },
  {
    key: 'plain', displayName: 'Plain', color: 'blue', order: 3,
    inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'out', type: 'md', when: 'always' }],
  },
];
const REGISTRY = Object.fromEntries(AGENTS.map((a) => [a.key, a]));

const WF = {
  id: 'wf_q', name: 'Questions', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'a', kind: 'agent', key: 'ask', x: 300, y: 0, config: {} },
    { id: 'b', kind: 'agent', key: 'locked', x: 600, y: 0, config: {} },
    { id: 'c', kind: 'agent', key: 'plain', x: 900, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} },
  ],
  wires: [
    { id: 'w0', from: { node: 'n_task', port: 'task' }, to: { node: 'a', port: 'task' } },
    { id: 'w1', from: { node: 'a', port: 'out' }, to: { node: 'b', port: 'task' } },
    { id: 'w2', from: { node: 'b', port: 'out' }, to: { node: 'c', port: 'task' } },
    { id: 'w3', from: { node: 'c', port: 'out' }, to: { node: 'n_end', port: 'result' } },
  ],
};
const OPUS = [{ id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['high', 'max'] }];

function workflowFetch(extraConfig = {}, models = OPUS) {
  return (url, opts) => {
    if (url.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    if (url.includes('/api/workflows/wf_q')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => WF });
    }
    if (url.includes('/api/workflows')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [{ id: 'wf_default', name: 'Default', version: 2, nodes: WF.nodes, wires: WF.wires }, WF] }) });
    }
    if (url.includes('/api/agents')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: AGENTS }) });
    }
    if (url.includes('/api/config') && (!opts || !opts.method || opts.method === 'GET')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        config: { steps: {}, customModels: [], ...extraConfig }, models, efforts: ['high', 'max'],
      }) });
    }
    return null;
  };
}

test('buildNodeConfigRows: hidden / locked / editable matrix', async () => {
  const { window } = await boot();
  window.__np._setPalette(AGENTS);
  const rows = window.__np.buildNodeConfigRows(WF, REGISTRY, { nodes: { a: { askQuestions: true } }, wires: {} });
  assert.deepEqual(rows.map((r) => r.nodeId), ['a', 'b', 'c'], 'agent nodes only');
  assert.equal(rows[0].askQuestions, true, 'saved override wins for unlocked');
  assert.equal(rows[0].questionsLocked, false);
  assert.equal(rows[1].askQuestions, true, 'locked follows the sidecar default');
  assert.equal(rows[1].questionsLocked, true);
  assert.equal(rows[2].askQuestions, null, 'no capability => no checkbox');
});

// The node's composer default sits between the per-run overlay and the sidecar,
// exactly as resolveGraph resolves it.
test('buildNodeConfigRows: a node config askQuestions beats the sidecar default', async () => {
  const { window } = await boot();
  window.__np._setPalette(AGENTS);
  const wf = { ...WF, nodes: WF.nodes.map((n) => (n.id === 'a' ? { ...n, config: { askQuestions: true } } : n)) };
  let rows = window.__np.buildNodeConfigRows(wf, REGISTRY, { nodes: {}, wires: {} });
  assert.equal(rows.find((r) => r.nodeId === 'a').askQuestions, true);
  rows = window.__np.buildNodeConfigRows(wf, REGISTRY, { nodes: { a: { askQuestions: false } }, wires: {} });
  assert.equal(rows.find((r) => r.nodeId === 'a').askQuestions, false, 'the per-run overlay still wins');
});

test('the painted rows reflect capability: editable, locked-disabled, absent', async () => {
  const { window } = await boot({ fetchHandler: workflowFetch() });
  selectProjectAnd(window);
  await settle();
  pickWorkflow(window, 'wf_q');
  await settle();
  const doc = window.document;
  const a = doc.querySelector('#wf-node-config .step-questions[data-node-id="a"]');
  assert.ok(a && !a.disabled && !a.checked, 'editable, off by default');
  const b = doc.querySelector('#wf-node-config .step-questions[data-node-id="b"]');
  assert.ok(b && b.disabled && b.checked, 'locked-on, not interactable');
  assert.equal(
    b.closest('.questions-toggle').title, 'Always on for this agent',
    'the lock is explained on hover',
  );
  assert.equal(doc.querySelector('#wf-node-config .step-questions[data-node-id="c"]'), null,
    'no capability => no checkbox at all');
});

test('toggling a node row posts askQuestions with the row model preserved', async () => {
  const posts = [];
  const base = workflowFetch();
  const { window } = await boot({ fetchHandler: (url, opts) => {
    if (url.includes('/api/config') && opts && opts.method === 'PATCH') {
      posts.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] } }) });
    }
    return base(url, opts);
  } });
  selectProjectAnd(window);
  await settle();
  pickWorkflow(window, 'wf_q');
  await settle();
  const doc = window.document;
  doc.querySelector('#wf-node-config .step-model[data-node-id="a"]').value = 'claude-opus-4-8';
  const cb = doc.querySelector('#wf-node-config .step-questions[data-node-id="a"]');
  cb.checked = true;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  const body = posts.find((p) => p.nodes && p.nodes.a && 'askQuestions' in p.nodes.a);
  assert.ok(body, 'PATCH /api/config fired');
  assert.equal(body.workflowId, 'wf_q');
  assert.equal(body.nodes.a.askQuestions, true);
  assert.equal(body.nodes.a.model, 'claude-opus-4-8', 'row model preserved');
  assert.equal(body.nodes.a.fanOut, undefined, 'fanOut omitted so the setter preserves it');
});

// Toggling questions must echo the LIVE selects, not state.config — state lags
// one in-flight save, so echoing it can revert a model picked moments earlier.
test('toggling questions sends the model currently shown in the select, not stale state', async () => {
  const posts = [];
  const base = workflowFetch({ workflows: { wf_q: { nodes: { a: { model: 'claude-opus-4-8' } }, wires: {} } } });
  const { window } = await boot({ fetchHandler: (url, opts) => {
    if (url.includes('/api/config') && opts && opts.method === 'PATCH') {
      posts.push(JSON.parse(opts.body));
      // Respond with a STALE config (the pre-change model) so state.config lags.
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        config: { steps: {}, customModels: [], workflows: { wf_q: { nodes: { a: { model: 'claude-opus-4-8' } }, wires: {} } },
        },
      }) });
    }
    return base(url, opts);
  } });
  selectProjectAnd(window);
  await settle();
  pickWorkflow(window, 'wf_q');
  await settle();
  const doc = window.document;
  // User picks a new model (select now shows it; state.config still has the old one)...
  const modelSel = doc.querySelector('#wf-node-config .step-model[data-node-id="a"]');
  modelSel.appendChild(new window.Option('New Model', 'my-new-model'));
  modelSel.value = 'my-new-model';
  // ...then immediately toggles Questions.
  const cb = doc.querySelector('#wf-node-config .step-questions[data-node-id="a"]');
  cb.checked = true;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  const qPost = posts.find((p) => p.nodes && p.nodes.a && 'askQuestions' in p.nodes.a);
  assert.ok(qPost, 'questions PATCH fired');
  assert.equal(qPost.nodes.a.model, 'my-new-model', 'live select value sent, not stale state.config');
});

// Regression: a failing GET /api/config must NOT dead-end the whole form (the
// live bug: a 500 left the static markup — Default-only dropdown, empty selects,
// unconfigured Questions toggles). The workflow dropdown must still populate
// from /api/workflows, and the error must be visible.
test('GET /api/config failure still populates the workflow dropdown and surfaces the error', async () => {
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
  await settle();
  const doc = window.document;
  const options = [...doc.querySelector('#workflowSelect').options].map((o) => o.textContent);
  assert.deepEqual(options, ['Default', 'My Custom Pipeline'], 'dropdown populated despite config failure');
  const hint = doc.querySelector('#config-error');
  assert.equal(hint.hidden, false, 'error hint visible');
  assert.match(hint.textContent, /no such column: ask_questions/, 'hint carries the server error');
});

// Capability is known only once the rows are painted, so no questions toggle may
// exist in the static markup — an interactable-looking checkbox before ANY JS
// runs (or when it fails) would misrepresent it.
test('index.html ships no questions toggles of its own', () => {
  const html = readFileSync(htmlPath, 'utf8');
  assert.ok(!html.includes('questions-toggle'), 'every toggle is painted per node by app.js');
  assert.ok(!html.includes('step-questions'), 'no static questions checkbox survives');
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
