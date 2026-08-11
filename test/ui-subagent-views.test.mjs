// test/ui-subagent-views.test.mjs — wire subAgentsOf into the live + history graph
// adapters. Dual-boot: boot()+recv() (LIVE, from ui-subagent-log) and
// bootHist({fetchHandler})+showHistory() (HISTORY, from ui-cost).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url) => String(url).includes('/api/projects')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const selectProject = () => { const s = window.document.querySelector('#projectSelect'); s.value = PROJECT; s.dispatchEvent(new window.Event('change', { bubbles: true })); };
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  return { window, selectProject, recv };
}

async function bootHist({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
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
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const selectProject = () => { const s = window.document.querySelector('#projectSelect'); s.value = PROJECT; s.dispatchEvent(new window.Event('change', { bubbles: true })); };
  const showHistory = () => { window.location.hash = 'history'; window.dispatchEvent(new window.Event('hashchange')); };
  return { window, selectProject, showHistory };
}
const runsList = (pipelines, live = []) => Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live }) });

// v2 run manifest (buildGraphManifest, src/core/workflows.mjs:567).
const gnode = (id, key, label, color, i) => ({
  id, kind: 'agent', key, label, color, sub: '', x: 60 + i * 300, y: 200, model: '', effort: '', loop: false,
  ports: {
    inputs: [{ id: 'in', type: 'md', required: true, loop: false, expands: false }],
    outputs: [{ id: 'out', type: 'md', when: 'always' }],
  },
});
const gmanifest = (rows) => ({
  version: 2,
  graph: { nodes: rows.map((r, i) => gnode(r[0], r[1], r[2], r[3], i)), wires: [] },
  bookends: { preflight: true, done: true },
});
const STEPPER = gmanifest([['s0_0', 'planner', 'Plan', 'violet']]);

test('LIVE: a spawned sub-agent paints a blue .fan .sq.on on its node card', async () => {
  const ctx = await boot();
  ctx.selectProject();
  ctx.window.location.hash = 'running';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  // NOTE: the live WS `state` frame is FLAT — the server emits { type:'state',
  // runId, ...stateSnapshot } (ui/server.mjs record/subscribe), and onState reads
  // msg.stepper / msg.status / msg.subAgents at top level (see ui-stepper.test.mjs
  // and ui-subagent-state.test.mjs). A nested `state:{…}` wrapper would leave
  // r.stepper null, so the card would render the legacy default ids, not s0_0.
  ctx.recv({ type: 'state', runId: 'p1', stepper: STEPPER, status: 'running', phase: 'plan', steps: [{ nodeId: 's0_0', phase: 'plan', status: 'active' }], subAgents: [] });
  ctx.recv({ type: 'subagent', runId: 'p1', transition: 'spawn', id: 't1', nodeId: 's0_0', stepIndex: 0, cycle: 0, label: 'research', status: 'running' });
  await new Promise((r) => setTimeout(r, 0));
  const node = ctx.window.document.querySelector('[data-run-id="p1"] .node[data-node-id="s0_0"]');
  assert.equal(node.querySelectorAll('.fan .sq').length, 1, 'one square for the spawned sub');
  assert.equal(node.querySelectorAll('.fan .sq.on').length, 1, 'running -> .on (blue, pulses via CSS)');
  assert.equal(node.querySelector('.fan .fl').textContent, '×1');
});

test('HISTORY: saved finished sub-agents paint grey squares, none .on (no pulse)', async () => {
  const state = {
    phase: 'done', status: 'done', cycle: 1, stepper: STEPPER,
    steps: [{ nodeId: 's0_0', phase: 'plan', status: 'done' }],
    subAgents: [
      { id: 't1', nodeId: 's0_0', stepIndex: 0, cycle: 0, label: 'a', status: 'finished' },
      { id: 't2', nodeId: 's0_0', stepIndex: 0, cycle: 0, label: 'b', status: 'finished' },
    ],
  };
  const ctx = await bootHist({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: [{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z' }], live: [] }) });
      if (url.includes('/api/runs/p1')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ state, auditMarkdown: '' }) });
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.window.document.querySelector('#history .hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const node = ctx.window.document.querySelector('#history .hist-detail .node[data-node-id="s0_0"]');
  assert.equal(node.querySelectorAll('.fan .sq').length, 2, 'two finished squares');
  assert.equal(node.querySelectorAll('.fan .sq.on').length, 0, 'history has no .on -> never pulses');
  assert.equal(node.querySelector('.fan .fl').textContent, '×2');
});

// The uiPhase fallback is GONE with the client-side phase-keyed default graph:
// a run has no graph to draw until its manifest arrives, and every sub-agent the
// graph engine spawns is attributed by nodeId (orchestrator.mjs:2805).
test('LIVE: nothing paints until the run manifest arrives', async () => {
  const ctx = await boot();
  ctx.selectProject();
  ctx.window.location.hash = 'running';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  ctx.recv({ type: 'state', runId: 'p1', status: 'running', active: [], steps: [], warnings: [] });
  ctx.recv({ type: 'subagent', runId: 'p1', transition: 'spawn', id: 't1', nodeId: 's0_0', uiPhase: 'plan', cycle: 0, label: 'research', status: 'running' });
  await new Promise((r) => setTimeout(r, 0));
  const card = ctx.window.document.querySelector('[data-run-id="p1"]');
  assert.equal(card.querySelector('.node[data-node-id]'), null, 'no manifest -> no cards');

  // The manifest lands; the same record now paints on its own node.
  ctx.recv({ type: 'state', runId: 'p1', status: 'running', stepper: STEPPER, active: [], steps: [], warnings: [] });
  await new Promise((r) => setTimeout(r, 0));
  const node = card.querySelector('.node[data-node-id="s0_0"]');
  assert.ok(node, 's0_0 card rendered from the manifest');
  assert.equal(node.querySelectorAll('.fan .sq.on').length, 1, 'the buffered spawn paints once the graph exists');
});

test('subAgentsForNode matches on nodeId alone', async () => {
  const { window } = await boot();
  const r = { subAgents: [{ id: 't1', nodeId: 's0_0', uiPhase: 'plan', status: 'running' }], stepper: STEPPER };
  assert.equal(window.__np.subAgentsForNode(r, 's0_0').length, 1);
  assert.equal(window.__np.subAgentsForNode(r, 'plan').length, 0, 'a phase keyword is not a node id');
});

