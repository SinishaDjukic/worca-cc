// test/ui-duration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

// Identical boot harness to test/ui-cost.test.mjs (jsdom + stubbed WS/fetch).
async function boot({ fetchHandler } = {}) {
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

test('history card shows total pipeline duration next to the date', async () => {
  const ctx = await boot({
    fetchHandler: (url) => url.includes('/api/history')
      ? runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalActiveMs: 83_000 }])
      : null,
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const t = ctx.window.document.querySelector('#history .hist-card .hist-time');
  assert.equal(t.textContent, '1m 23s');
});

test('a pipeline with no timing data renders a blank time chip', async () => {
  const ctx = await boot({
    fetchHandler: (url) => url.includes('/api/history')
      ? runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalActiveMs: null }])
      : null,
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ctx.window.document.querySelector('#history .hist-card .hist-time').textContent, '');
});

test('expanding a card paints per-phase duration from saved steps (refine cycles summed; never-run blank; 0ms -> 0s)', async () => {
  const state = {
    phase: 'done', status: 'done', cycle: 2, totalActiveMs: 8500,
    steps: [
      { key: 'preflight', phase: 'preflight', activeMs: 500, runningSince: null },
      { key: 'plan', phase: 'plan', activeMs: 4000, runningSince: null },
      { key: 'refine#1', phase: 'refine', activeMs: 1500, runningSince: null },
      { key: 'refine#2', phase: 'refine', activeMs: 1000, runningSince: null }, // two cycles -> 2500
      { key: 'implement', phase: 'implement', activeMs: 0, runningSince: null }, // ran sub-ms -> 0s
      // no review step recorded -> review stays blank
    ],
  };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) return runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalActiveMs: 8500 }]);
      if (url.includes('/api/runs/p1')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ state, auditMarkdown: '' }) });
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.window.document.querySelector('#history .hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const byStep = {};
  for (const s of ctx.window.document.querySelectorAll('#history .hist-detail .run-node[data-id]')) byStep[s.dataset.id] = s;
  assert.equal(byStep.plan.querySelector('.dur').textContent, '4s');
  assert.equal(byStep.refine.querySelector('.dur').textContent, '3s', 'refine cycles summed (2500ms -> 3s)');
  assert.equal(byStep.implement.querySelector('.dur').textContent, '0s', 'executed sub-ms phase shows 0s');
  assert.equal(byStep.review.querySelector('.dur').textContent, '', 'never-run review stays blank');
  assert.equal(byStep.preflight.querySelector('.dur').textContent, '1s', 'preflight has its own dur chip');
});

test('clarify active time shows in its own Clarify stage chip (no longer folds into Plan)', async () => {
  // normalizePhase now maps clarify -> 'clarify' (its own UI phase), so a clarify
  // step's activeMs shows in a separate Clarify chip and no longer sums into Plan.
  const state = {
    phase: 'done', status: 'done', cycle: 0, totalActiveMs: 3000,
    steps: [
      { key: 'clarify#1', phase: 'clarify', activeMs: 1000, runningSince: null },
      { key: 'plan', phase: 'plan', activeMs: 2000, runningSince: null },
    ],
  };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) return runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalActiveMs: 3000 }]);
      if (url.includes('/api/runs/p1')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ state, auditMarkdown: '' }) });
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.window.document.querySelector('#history .hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const planStage = ctx.window.document.querySelector('#history .hist-detail .run-node[data-id="plan"]');
  assert.equal(planStage.querySelector('.dur').textContent, '2s', 'plan(2000) -> 2s in the Plan chip (clarify no longer folded in)');
  const clarifyStage = ctx.window.document.querySelector('#history .hist-detail .run-node[data-id="clarify"]');
  assert.equal(clarifyStage.querySelector('.dur').textContent, '1s', 'clarify(1000) -> 1s in its own Clarify chip');
});

test('history ignores a dangling runningSince (saved data is treated as final)', async () => {
  // A run killed mid-phase can persist a step with runningSince set while status
  // is still 'running'. History must show the finalized activeMs only — never
  // now - runningSince (which, with a stale epoch, would be a runaway value).
  const state = {
    phase: 'implement', status: 'running', cycle: 0, totalActiveMs: 2000,
    steps: [
      { key: 'plan', phase: 'plan', activeMs: 2000, runningSince: null },
      { key: 'implement', phase: 'implement', activeMs: 0, runningSince: 1 }, // stale -> huge if added live
    ],
  };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) return runsList([{ id: 'p1', title: 'Run', status: 'running', startedAt: '2026-01-01T00:00:00Z', totalActiveMs: 2000 }]);
      if (url.includes('/api/runs/p1')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ state, auditMarkdown: '' }) });
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.window.document.querySelector('#history .hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const byStep = {};
  for (const s of ctx.window.document.querySelectorAll('#history .hist-detail .run-node[data-id]')) byStep[s.dataset.id] = s;
  assert.equal(byStep.implement.querySelector('.dur').textContent, '0s', 'finalized 0ms; dangling clock ignored');
});

// Phase-label harness (CONV-4): identical jsdom/WS/fetch stubs to boot() above,
// but the WebSocket stub records its instances + can fire a `message`, so a
// `phase` event can be driven into the live Running view. We feed a run whose
// uiPhase is one of the two new agents' buckets ('manual-web'/'manual-checklist')
// and assert the running card's phase chip is labelled (not the 'Preflight'
// default that normalizePhase->null leaves it on).
async function bootLive() {
  const wsInstances = [];
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsInstances.push(this); }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
    _fire(type, data) { for (const fn of (this._listeners[type] || [])) fn(data); }
  };
  window.fetch = (url) => {
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
  const showRunning = () => { window.location.hash = '#running'; window.dispatchEvent(new window.Event('hashchange')); };
  const emit = (msg) => wsInstances[0]._fire('message', { data: JSON.stringify(msg) });
  const chipText = () => window.document.querySelector('#run-list [data-run-id] .chip').textContent;
  return { window, selectProject, showRunning, emit, chipText };
}

test('a manual-web phase labels the running chip "Manual web UI" (not the Preflight default)', async () => {
  const ctx = await bootLive();
  ctx.selectProject();
  await new Promise((r) => setTimeout(r, 0));
  ctx.emit({ type: 'phase', runId: 'r_mw', phase: 'manual-web', status: 'running' });
  ctx.showRunning();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ctx.chipText(), 'Manual web UI', 'manual-web must map to its label, not null/Preflight');
});

test('a manual-checklist phase labels the running chip "Manual tests" (not swallowed by review/implement)', async () => {
  const ctx = await bootLive();
  ctx.selectProject();
  await new Promise((r) => setTimeout(r, 0));
  ctx.emit({ type: 'phase', runId: 'r_mc', phase: 'manual-checklist', status: 'running' });
  ctx.showRunning();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ctx.chipText(), 'Manual tests', 'manual-checklist must map to its own label');
});

test('durByNode buckets per nodeId, falling back to uiPhase for legacy steps', async () => {
  const { window } = await boot();
  const fn = window.__np.durByNode;
  const a = fn([{ nodeId: 's1_0', phase: 'refiner', activeMs: 1500, runningSince: null }], 0, false);
  assert.equal(a['s1_0'], 1500);
  const b = fn([{ phase: 'refine', activeMs: 800, runningSince: null }], 0, false);
  assert.equal(b['refine'], 800); // legacy: node id == uiPhase
});

test('clarify folds into the Plan cell on a per-node manifest (nodeId-tagged)', async () => {
  // New runs persist a per-node stepper (plan node id 's0_0') AND tag the clarify
  // step with that id. normalizePhase can't help here (it maps clarify -> 'plan',
  // which is NOT the node id 's0_0'); the explicit nodeId is what folds it.
  const stepper = {
    version: 1,
    steps: [
      { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight' }] },
      { kind: 'agents', nodes: [{ id: 's0_0', uiPhase: 'plan', label: 'Plan', cycles: false }] },
      { kind: 'done', nodes: [{ id: 'done', label: 'Done' }] },
    ],
  };
  const state = {
    phase: 'done', status: 'done', cycle: 1, totalActiveMs: 3000, stepper,
    steps: [
      { key: 'clarify#1', phase: 'clarify', nodeId: 's0_0', activeMs: 1000, runningSince: null },
      { key: '0:s0_0', phase: 'planner', nodeId: 's0_0', activeMs: 2000, runningSince: null },
    ],
  };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) return runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalActiveMs: 3000 }]);
      if (url.includes('/api/runs/p1')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ state, auditMarkdown: '' }) });
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.window.document.querySelector('#history .hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const planStage = ctx.window.document.querySelector('#history .hist-detail .run-node[data-id="s0_0"]');
  assert.equal(planStage.querySelector('.dur').textContent, '3s', 'clarify(1000)+plan(2000) -> 3s on the s0_0 cell');
});

test('an untagged clarify step (old run) does NOT fold on a per-node manifest', async () => {
  // Backward-compat: pre-fix saved runs have clarify#1 with no nodeId. On a
  // per-node stepper its FIGURE buckets to 'plan' (via normalizePhase), which is not
  // the node id 's0_0' -> paints on nothing. Exactly today's behavior; must not crash.
  const stepper = {
    version: 1,
    steps: [
      { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight' }] },
      { kind: 'agents', nodes: [{ id: 's0_0', uiPhase: 'plan', label: 'Plan', cycles: false }] },
      { kind: 'done', nodes: [{ id: 'done', label: 'Done' }] },
    ],
  };
  const state = {
    phase: 'done', status: 'done', cycle: 1, totalActiveMs: 3000, stepper,
    steps: [
      { key: 'clarify#1', phase: 'clarify', activeMs: 1000, runningSince: null }, // no nodeId (legacy)
      { key: '0:s0_0', phase: 'planner', nodeId: 's0_0', activeMs: 2000, runningSince: null },
    ],
  };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) return runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalActiveMs: 3000 }]);
      if (url.includes('/api/runs/p1')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ state, auditMarkdown: '' }) });
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.window.document.querySelector('#history .hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const planStage = ctx.window.document.querySelector('#history .hist-detail .run-node[data-id="s0_0"]');
  assert.equal(planStage.querySelector('.dur').textContent, '2s', 'only the plan step (2000) shows; clarify not folded');
});
