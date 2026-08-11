// test/ui-cost.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

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
const P = (id, type, extra = {}) => ({ id, type, required: true, loop: false, expands: false, ...extra });
function graphManifest(nodes) {
  return {
    version: 2,
    graph: {
      nodes: nodes.map(([id, key, label, color], i) => ({
        id, kind: key ? 'agent' : 'task', key: key || null, label, color: color || '', sub: '',
        x: 60 + i * 300, y: 200, model: '', effort: '', loop: false,
        ports: {
          inputs: key ? [P('in', 'md'), { id: 'await', type: 'any', required: false, loop: false, expands: false }] : [],
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

const runsList = (pipelines, live = []) => Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live }) });

test('history card shows the pipeline total next to the date', async () => {
  const ctx = await boot({
    fetchHandler: (url) => url.includes('/api/history')
      ? runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalCostUsd: 0.42 }])
      : null,
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const total = ctx.window.document.querySelector('#history .hist-card .hist-total');
  assert.equal(total.textContent, '$0.42');
});

test('the history total is tooltip-labelled as an estimate with the exact value', async () => {
  const ctx = await boot({
    fetchHandler: (url) => url.includes('/api/history')
      ? runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalCostUsd: 0.42 }])
      : null,
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const total = ctx.window.document.querySelector('#history .hist-card .hist-total');
  assert.equal(total.textContent, '$0.42', 'visible figure unchanged');
  assert.match(total.title, /[Ee]stimat/, 'tooltip marks it as an estimate');
  assert.match(total.title, /\$0\.4200/, 'tooltip shows the exact 4-dp value');
});

test('expanding a card paints per-node cost from saved steps (refine cycles summed)', async () => {
  const state = {
    status: 'done', endReached: true, totalCostUsd: 0.30, stepper: STEPPER,
    steps: [
      { key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', cycle: 1, status: 'done', costUsd: 0.10 },
      { key: 'x:n_refine:1', executionId: 'x:n_refine:1', nodeId: 'n_refine', cycle: 1, status: 'done', costUsd: 0.05 },
      { key: 'x:n_refine:2', executionId: 'x:n_refine:2', nodeId: 'n_refine', cycle: 2, status: 'done', costUsd: 0.05 }, // two cycles sum to $0.10
      { key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', cycle: 1, status: 'done', costUsd: 0.07 },
      { key: 'x:n_review:1', executionId: 'x:n_review:1', nodeId: 'n_review', cycle: 1, status: 'done', costUsd: 0.03 },
    ],
  };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) return runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalCostUsd: 0.30 }]);
      if (url.includes('/api/runs/p1')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ state, auditMarkdown: '' }) });
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const head = ctx.window.document.querySelector('#history .hist-head');
  head.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const byNode = nodeTotals(ctx.window.document, '#history .hist-detail');
  assert.equal(byNode.n_plan.cost, '$0.10');
  assert.equal(byNode.n_refine.cost, '$0.10', 'refine cycles summed');
  assert.equal(byNode.n_impl.cost, '$0.07');
  assert.equal(byNode.n_review.cost, '$0.03');
});

test('an executed-but-zero node (mock) renders $0.00; a never-run node stays blank', async () => {
  const state = {
    status: 'done', endReached: true, totalCostUsd: 0, stepper: STEPPER,
    steps: [
      { key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', cycle: 1, status: 'done', costUsd: 0 }, // ran in mock -> $0.00
      { key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', cycle: 1, status: 'done', costUsd: 0 },
      // no refine / review steps recorded -> those stay blank
    ],
  };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) return runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalCostUsd: 0 }]);
      if (url.includes('/api/runs/p1')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ state, auditMarkdown: '' }) });
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  // collapsed total is a truthful $0.00
  assert.equal(ctx.window.document.querySelector('#history .hist-card .hist-total').textContent, '$0.00');
  const head = ctx.window.document.querySelector('#history .hist-head');
  head.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const byNode = nodeTotals(ctx.window.document, '#history .hist-detail');
  assert.equal(byNode.n_plan.cost, '$0.00', 'executed zero shows $0.00');
  assert.equal(byNode.n_impl.cost, '$0.00');
  assert.equal(byNode.n_refine.cost, null, 'never-run refine has no totals row');
  assert.equal(byNode.n_review.cost, null, 'never-run review has no totals row');
});

test('costByNode buckets per nodeId; a step with no nodeId belongs to no card', async () => {
  const { window } = await boot();
  const fn = window.__np.costByNode;
  assert.equal(fn([{ nodeId: 's0_0', phase: 'planner', costUsd: 0.12 }])['s0_0'], 0.12);
  assert.deepEqual(fn([{ phase: 'plan', costUsd: 0.05 }]), {}, 'the graph engine always attributes by node');
});

test('costByNode folds a nodeId-tagged clarify step onto the plan node', async () => {
  const { window } = await boot();
  const fn = window.__np.costByNode;
  const out = fn([
    { key: 'clarify#1', phase: 'clarify', nodeId: 's0_0', costUsd: 0.01 },
    { key: '0:s0_0', phase: 'planner', nodeId: 's0_0', costUsd: 0.02 },
  ]);
  assert.equal(out['s0_0'], 0.03);
});
