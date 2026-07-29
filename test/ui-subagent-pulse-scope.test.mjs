// test/ui-subagent-pulse-scope.test.mjs — capstone integration guard: the hard
// pulse-scoping requirement against the REAL rendered DOM. The graph .fan .sq.on
// is the only pulsing hook; the tree panel and a history-rendered card must carry
// no pulsing square. Dual-boot: boot()+recv() (LIVE, from ui-subagent-log) and
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

const STEPPER = {
  version: 1,
  steps: [
    { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
    { kind: 'agents', nodes: [{ id: 's0_0', key: 'planner', uiPhase: 'plan', label: 'Plan', color: 'violet' }] },
    { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
  ],
  feedbacks: [],
};

// jsdom does not run CSS animations; assert on the class hook that the stylesheet
// scopes sqPulse to. The CSS test (ui-run-flow-css) proves only that hook animates.
function pulses(el) {
  return !!el && el.classList.contains('sq') && el.classList.contains('on') && !!el.closest('.fan');
}

test('PULSE SCOPING: live graph square pulses; the tree panel never does', async () => {
  const ctx = await boot();
  ctx.selectProject();
  ctx.window.location.hash = 'running';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  // FLAT live `state` frame — the server emits { type, runId, ...snapshot } and
  // onState reads msg.stepper/msg.subAgents at top level (see ui-subagent-views).
  ctx.recv({ type: 'state', runId: 'p1', stepper: STEPPER, status: 'running', phase: 'plan', steps: [{ nodeId: 's0_0', phase: 'plan', status: 'active' }], subAgents: [{ id: 't1', nodeId: 's0_0', stepIndex: 0, cycle: 0, label: 'research', status: 'running' }] });
  await new Promise((r) => setTimeout(r, 0));

  const card = ctx.window.document.querySelector('[data-run-id="p1"]');
  // graph square: present + on (the pulsing hook)
  const graphSq = card.querySelector('.run-flow .node .fan .sq.on');
  assert.ok(graphSq, 'live running sub paints a graph .fan .sq.on');
  assert.ok(pulses(graphSq), 'the graph square is the pulsing scope');

  // open the tree and assert NOTHING under it pulses
  const bar = card.querySelector('.subs-bar');
  assert.ok(!bar.hidden, 'pill visible with one sub');
  bar.querySelector('.btn-subs').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const panel = card.querySelector('.subs-panel');
  assert.ok(panel.querySelector('.subs-tree li'), 'tree rendered a row');
  for (const el of panel.querySelectorAll('.sq, .led')) {
    assert.ok(!pulses(el), 'no tree/legend square is in the pulsing scope');
  }
  assert.equal(panel.querySelectorAll('.fan .sq.on').length, 0, 'tree has zero .fan .sq.on');
});

test('PULSE SCOPING: a history-rendered card has no pulsing square', async () => {
  const state = {
    phase: 'done', status: 'done', cycle: 1, stepper: STEPPER,
    steps: [{ nodeId: 's0_0', phase: 'plan', status: 'done' }],
    subAgents: [{ id: 't1', nodeId: 's0_0', stepIndex: 0, cycle: 0, label: 'research', status: 'finished' }],
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
  const detail = ctx.window.document.querySelector('#history .hist-detail');

  // squares exist (finished sub) but none is the pulsing hook
  assert.ok(detail.querySelector('.run-flow .node .fan .sq'), 'history paints a (grey) square');
  assert.equal(detail.querySelectorAll('.run-flow .node .fan .sq.on').length, 0, 'history square is never .on -> never pulses');
  for (const el of detail.querySelectorAll('.sq, .led')) {
    assert.ok(!pulses(el), 'no history square is in the pulsing scope');
  }
});
