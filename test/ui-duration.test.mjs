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

// A v2 run manifest (buildGraphManifest, src/core/workflows.mjs:567). The run
// monitor renders the graph the run actually ran; there is no client-side
// phase-keyed default any more, so every history fixture carries one.
function graphManifest(nodes) {
  return {
    version: 2,
    graph: {
      nodes: nodes.map(([id, key, label, color], i) => ({
        id, kind: key ? 'agent' : 'task', key: key || null, label, color: color || '', sub: '',
        x: 60 + i * 300, y: 200, model: '', effort: '', loop: false,
        ports: {
          inputs: key ? [{ id: 'in', type: 'md', required: true, loop: false, expands: false },
                         { id: 'await', type: 'any', required: false, loop: false, expands: false }] : [],
          outputs: [{ id: 'out', type: 'md', when: 'always' }],
        },
      })),
      wires: nodes.slice(1).map((n, i) => ({
        id: `w${i + 1}`, from: { node: nodes[i][0], port: 'out' }, to: { node: n[0], port: 'in' }, loop: false,
      })),
    },
    bookends: { preflight: true, done: true },
  };
}
const STEPPER = graphManifest([
  ['n_clarify', 'clarify', 'Clarify', 'red'],
  ['n_plan', 'planner', 'Plan', 'violet'],
  ['n_refine', 'refiner', 'Refine', 'green'],
  ['n_impl', 'implementer', 'Implement', 'peach'],
  ['n_review', 'reviewer', 'Review', 'blue'],
]);
// The graph card's totals live in `.nrun`; index them by node id.
function nodeTotals(doc, scope) {
  const out = {};
  for (const el of doc.querySelectorAll(`${scope} .node[data-node-id]`)) {
    const run = el.querySelector(':scope > .nrun');
    out[el.dataset.nodeId] = {
      cost: run ? run.querySelector('.cost').textContent : null,
      dur: run ? run.querySelector('.dur').textContent : null,
    };
  }
  return out;
}
const stepRow = (nodeId, ordinal, o) => ({
  key: `x:${nodeId}:${ordinal}`, executionId: `x:${nodeId}:${ordinal}`, nodeId,
  cycle: ordinal, status: 'done', runningSince: null, ...o,
});

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

test('expanding a card paints per-node duration from saved steps (cycles summed; never-run blank; 0ms -> 0s)', async () => {
  const state = {
    status: 'done', endReached: true, totalActiveMs: 8500, stepper: STEPPER,
    steps: [
      stepRow('n_plan', 1, { activeMs: 4000 }),
      stepRow('n_refine', 1, { activeMs: 1500 }),
      stepRow('n_refine', 2, { activeMs: 1000 }), // two cycles -> 2500
      stepRow('n_impl', 1, { activeMs: 0 }),      // ran sub-ms -> 0s
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
  const byNode = nodeTotals(ctx.window.document, '#history .hist-detail');
  assert.equal(byNode.n_plan.dur, '4s');
  assert.equal(byNode.n_refine.dur, '3s', 'refine cycles summed (2500ms -> 3s)');
  assert.equal(byNode.n_impl.dur, '0s', 'executed sub-ms node shows 0s');
  assert.equal(byNode.n_review.dur, null, 'never-run review has no totals row');
});

test('a clarifier is its own graph node, so its time never folds into the planner', async () => {
  const state = {
    status: 'done', endReached: true, totalActiveMs: 3000, stepper: STEPPER,
    steps: [stepRow('n_clarify', 1, { activeMs: 1000 }), stepRow('n_plan', 1, { activeMs: 2000 })],
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
  const byNode = nodeTotals(ctx.window.document, '#history .hist-detail');
  assert.equal(byNode.n_plan.dur, '2s', 'plan(2000) -> 2s on the planner card');
  assert.equal(byNode.n_clarify.dur, '1s', 'clarify(1000) -> 1s on its own card');
});

test('history ignores a dangling runningSince (saved data is treated as final)', async () => {
  // A run killed mid-phase can persist a step with runningSince set while status
  // is still 'running'. History must show the finalized activeMs only — never
  // now - runningSince (which, with a stale epoch, would be a runaway value).
  const state = {
    status: 'running', totalActiveMs: 2000, stepper: STEPPER,
    steps: [
      stepRow('n_plan', 1, { activeMs: 2000 }),
      stepRow('n_impl', 1, { activeMs: 0, status: 'start', runningSince: 1 }), // stale -> huge if added live
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
  const byNode = nodeTotals(ctx.window.document, '#history .hist-detail');
  assert.equal(byNode.n_impl.dur, '0s', 'finalized 0ms; dangling clock ignored');
});

// Live-chip harness: identical jsdom/WS/fetch stubs to boot() above, but the
// WebSocket stub records its instances + can fire a `message`, so graph engine
// events can be driven into the live Running view. The foot chip and the status
// pill now name the node that is EXECUTING (state.active + the run manifest) —
// v1's phase keyword is gone from the engine, so there is nothing to map.
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
  const pillText = () => window.document.querySelector('#run-list [data-run-id] .pill-text').textContent;
  return { window, selectProject, showRunning, emit, chipText, pillText };
}

// The two agents that used to need their own phase keywords ('manual-web',
// 'manual-checklist') are ordinary graph nodes now: their card labels come
// straight off the manifest, so no keyword table can swallow or mislabel them.
const MANUAL = graphManifest([
  ['n_webui', 'manualWebUiTesting', 'Manual web UI', 'violet'],
  ['n_check', 'manualTestsChecklist', 'Manual tests', 'blue'],
]);

async function liveRunOn(nodeId) {
  const ctx = await bootLive();
  ctx.selectProject();
  await new Promise((r) => setTimeout(r, 0));
  ctx.emit({
    type: 'state', runId: 'r1', status: 'running', stepper: MANUAL,
    active: [{ nodeId, executionId: `x:${nodeId}:1` }], steps: [], warnings: [],
  });
  ctx.emit({ type: 'exec', runId: 'r1', nodeId, executionId: `x:${nodeId}:1`, ordinal: 1, kind: 'cycle', status: 'start', agentKey: null, trigger: { wireIds: [], freshPorts: [] } });
  ctx.showRunning();
  await new Promise((r) => setTimeout(r, 0));
  return ctx;
}

test('the running chip names the EXECUTING node, from the manifest', async () => {
  const ctx = await liveRunOn('n_webui');
  assert.equal(ctx.chipText(), 'Manual web UI');
  assert.equal(ctx.pillText(), 'Manual web UI', 'the status pill agrees with the chip');
});

test('a second node executing relabels the chip — no keyword table in the path', async () => {
  const ctx = await liveRunOn('n_check');
  assert.equal(ctx.chipText(), 'Manual tests');
});

test('with nothing executing the chip falls back to a neutral label', async () => {
  const ctx = await bootLive();
  ctx.selectProject();
  await new Promise((r) => setTimeout(r, 0));
  ctx.emit({ type: 'state', runId: 'r2', status: 'running', stepper: MANUAL, active: [], steps: [], warnings: [] });
  ctx.showRunning();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ctx.chipText(), 'Running');
});

test('a run that finished at quiescence carries the warning banner into History', async () => {
  const state = {
    status: 'done', endReached: false, totalActiveMs: 1000, stepper: STEPPER,
    warnings: ['finished at quiescence — End not reached'],
    steps: [stepRow('n_plan', 1, { activeMs: 1000 })],
  };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) return runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalActiveMs: 1000 }]);
      if (url.includes('/api/runs/p1')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ state, auditMarkdown: '' }) });
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.window.document.querySelector('#history .hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const banner = ctx.window.document.querySelector('#history .hist-detail .run-warn');
  assert.equal(banner.hidden, false);
  assert.equal(banner.textContent, 'finished at quiescence — End not reached');
});

// The other half of the same durable surface (sibling of the banner case above):
// a run that DID reach End must render its result card and its loop badges from
// the persisted state alone. Both ride the exec ledger History synthesizes out of
// the step rows, so the payload here is exactly what rowToState hands the client.
test('a finished v2 run renders its End result card and loop badges in History', async () => {
  const IN = (id, type, extra = {}) => ({ id, type, required: true, loop: false, expands: false, ...extra });
  const OUT = (id, type, when = 'always') => ({ id, type, when });
  const ENDED = {
    version: 2,
    graph: {
      nodes: [
        { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementation', color: 'peach', sub: '', x: 60, y: 200, model: '', effort: '', loop: true,
          ports: { inputs: [IN('fix', 'md', { required: false, loop: true })], outputs: [OUT('code', 'md')] } },
        { id: 'n_review', kind: 'agent', key: 'reviewer', label: 'Review', color: 'blue', sub: '', x: 360, y: 200, model: '', effort: '', loop: false,
          ports: { inputs: [IN('code', 'md')], outputs: [OUT('pass', 'md', 'clean'), OUT('review', 'json', 'blocking')] } },
        { id: 'n_end', kind: 'end', key: null, label: 'End', color: '', sub: '', x: 660, y: 200, model: '', effort: '', loop: false,
          ports: { inputs: [IN('result', 'any')], outputs: [] } },
      ],
      wires: [
        { id: 'w1', from: { node: 'n_impl', port: 'code' }, to: { node: 'n_review', port: 'code' }, loop: false },
        { id: 'w2', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, loop: true, maxCycles: 3 },
        { id: 'w3', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' }, loop: false },
      ],
    },
    bookends: { preflight: true, done: true },
  };
  const result = { type: 'md', path: '/tmp/pl/reviews/impl-review-cycle2.md' };
  const state = {
    status: 'done', endReached: true, result, warnings: [], totalActiveMs: 4000, stepper: ENDED,
    steps: [
      stepRow('n_impl', 1, { activeMs: 1000 }),
      stepRow('n_review', 1, { activeMs: 1000 }),
      stepRow('n_impl', 2, { activeMs: 1000, trigger: { wireIds: ['w2'], freshPorts: ['fix'] } }),
      stepRow('n_review', 2, { activeMs: 1000 }),
      stepRow('n_end', 1, { activeMs: 0, result }),
    ],
  };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) return runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalActiveMs: 4000 }]);
      if (url.includes('/api/runs/p1')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ state, auditMarkdown: '' }) });
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.window.document.querySelector('#history .hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  const detail = ctx.window.document.querySelector('#history .hist-detail');
  assert.equal(detail.querySelector('.run-warn').hidden, true, 'a run that reached End raises no banner');
  const end = detail.querySelector('.node[data-node-id="n_end"]');
  assert.ok(end, 'the End node renders in History');
  assert.equal(end.classList.contains('is-skipped'), false, 'End is not the quiescence treatment');
  const link = end.querySelector('.xresult a');
  assert.ok(link, 'the End result card renders from the persisted state');
  assert.equal(link.textContent, 'impl-review-cycle2.md');
  assert.equal(link.dataset.path, result.path);
  // The loop badge proves the persisted trigger reached the ledger, not just the
  // result: it is counted off the executions the loop wire triggered.
  const badge = detail.querySelector('.wbadge[data-wire-id="w2"] .wfired');
  assert.ok(badge, 'the loop wire carries its fired badge');
  assert.equal(badge.textContent, '1×');
});

test('a live run carries a run-level warning on its own card banner', async () => {
  const ctx = await bootLive();
  ctx.selectProject();
  await new Promise((r) => setTimeout(r, 0));
  ctx.emit({ type: 'state', runId: 'r3', status: 'running', stepper: MANUAL, active: [], steps: [], warnings: [] });
  ctx.showRunning();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ctx.window.document.querySelector('#run-list [data-run-id] .run-warn').hidden, true);
  ctx.emit({ type: 'state', runId: 'r3', status: 'running', stepper: MANUAL, active: [], steps: [], warnings: ['worktree drifted'] });
  await new Promise((r) => setTimeout(r, 0));
  const banner = ctx.window.document.querySelector('#run-list [data-run-id] .run-warn');
  assert.equal(banner.hidden, false);
  assert.equal(banner.textContent, 'worktree drifted');
});

test('durByNode buckets per nodeId; a step with no nodeId belongs to no card', async () => {
  const { window } = await boot();
  const fn = window.__np.durByNode;
  const a = fn([{ nodeId: 's1_0', phase: 'refiner', activeMs: 1500, runningSince: null }], 0, false);
  assert.equal(a['s1_0'], 1500);
  assert.deepEqual(fn([{ phase: 'refine', activeMs: 800, runningSince: null }], 0, false), {});
});

test('several executions of one node fold onto its single card', async () => {
  const state = {
    status: 'done', endReached: true, totalActiveMs: 3000, stepper: STEPPER,
    steps: [stepRow('n_plan', 1, { activeMs: 1000 }), stepRow('n_plan', 2, { activeMs: 2000 })],
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
  const byNode = nodeTotals(ctx.window.document, '#history .hist-detail');
  assert.equal(byNode.n_plan.dur, '3s', 'cycle 1 (1000) + cycle 2 (2000) -> 3s on the one card');
  const rows = ctx.window.document.querySelectorAll('#history .hist-detail .node[data-node-id="n_plan"] .xsum');
  assert.equal(rows[0].textContent, '2 runs', 'the executions footer counts both, with no cost to show');
});
