// test/ui-history-legacy.test.mjs
// Task 19: the LEGACY (v1) history renderer. A run frozen before the graph engine
// has no graph to draw — its `pipelines.stepper` is the v1 `{version:1, steps:[
// {kind, nodes:[…]}]}` cell array — so the history card degrades to the flat chip
// strip (spec §7: label + status tint + cost/duration).
//
// This suite also pins the GENERICITY CHARTER's sanctioned exception (c): the v1
// phase vocabulary (`uiPhase` / the phase-keyed step rows) may be read by THIS
// renderer and by nothing else. It renders FROZEN data — no v2 run can reach it.
//
// Same harness as test/ui-history.test.mjs: the REAL app.js booted against the
// REAL index.html under jsdom, fetch + WebSocket stubbed, one fresh module import
// per test so top-level state cannot leak.
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
    constructor() { this.readyState = 1; }
    send() {}
    close() {}
    addEventListener() {}
  };

  window.fetch = (url) => {
    if (fetchHandler) {
      const r = fetchHandler(String(url));
      if (r) return r;
    }
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }),
      });
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }),
    });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch {
      /* read-only global already present — leave it */
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  function showHistory() {
    window.location.hash = 'history';
    window.dispatchEvent(new window.Event('hashchange'));
  }
  return { window, showHistory };
}

const runsList = (pipelines) => Promise.resolve({
  ok: true, status: 200, json: async () => ({ pipelines, live: [] }),
});

/** Boot, load one history row backed by `state`, expand it, return its .hist-detail. */
async function legacyDetail(state) {
  const { window, showHistory } = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/runs/')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ state, auditMarkdown: '' }) });
      }
      if (url.includes('/api/history')) {
        return runsList([{ id: 'p1', title: 'Frozen run', status: 'done', startedAt: '2026-05-01T00:00:00Z' }]);
      }
      return null;
    },
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  window.document.querySelector('#history .hist-head').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  return { window, detail: window.document.querySelector('#history .hist-card .hist-detail') };
}

const chips = (detail) => [...detail.querySelectorAll('.run-strip .rchip')];

/** A v1 manifest cell array, exactly as buildStepperManifest froze it. */
const v1cells = () => [
  { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
  { kind: 'agents', nodes: [{ id: 'plan', uiPhase: 'plan', label: 'Plan', color: 'violet', cycles: false }] },
  { kind: 'agents', nodes: [{ id: 'implement', uiPhase: 'implement', label: 'Implement', color: 'amber', cycles: false }] },
  { kind: 'agents', nodes: [{ id: 'review', uiPhase: 'review', label: 'Review', color: 'blue', cycles: true }] },
  { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
];

test('a v1 stepper with NO version field renders one chip per node, no graph', async () => {
  const { detail } = await legacyDetail({
    status: 'done',
    stepper: { steps: v1cells() },                       // version absent — still v1
    steps: [{ key: 'plan#1', nodeId: 'plan', status: 'done', activeMs: 4000, costUsd: 0.03 }],
  });

  assert.deepEqual(chips(detail).map((c) => c.dataset.id),
    ['preflight', 'plan', 'implement', 'review', 'done']);
  assert.equal(chips(detail)[1].textContent, 'Plan · 4s · $0.03');
  assert.equal(detail.querySelector('.node[data-node-id]'), null, 'a v1 run has no graph cards');
  assert.equal(detail.querySelector('.xfoot'), null, 'and no executions footer — v1 had no executions');
});

test('a pre-node_id v1 run tints its chips from the step rows\' PHASE', async () => {
  // pipeline_steps.node_id is nullable (db.mjs) and stepRowToStep omits `nodeId`
  // entirely when the column is NULL (artifacts.mjs:1603) — the oldest frozen runs
  // identify their step rows by `phase` alone. Without the legacy phase fallback
  // every chip of such a run reads `pending` with no cost and no duration.
  const { detail } = await legacyDetail({
    status: 'done',
    stepper: { version: 1, steps: v1cells() },
    steps: [
      { key: 'plan#1', phase: 'plan', status: 'done', activeMs: 4000, costUsd: 0.03 },
      { key: 'implement#1', phase: 'implement', status: 'done', activeMs: 65000, costUsd: 0.42 },
      { key: 'review#1', phase: 'review', status: 'error', activeMs: 1000, costUsd: 0 },
    ],
  });

  const [preflight, plan, implement, review, done] = chips(detail);
  assert.equal(plan.textContent, 'Plan · 4s · $0.03');
  assert.ok(plan.classList.contains('is-done'));
  assert.equal(implement.textContent, 'Implement · 1m 5s · $0.42');
  assert.equal(review.textContent, 'Review · 1s', 'a $0 legacy step gets no cost pill');
  assert.ok(review.classList.contains('is-error'));
  assert.ok(preflight.classList.contains('is-pending'), 'a node with no step row never ran');
  assert.ok(done.classList.contains('is-pending'));
});

test('a phase-keyed v1 node that ALSO looped folds its cycles into one chip', async () => {
  const { detail } = await legacyDetail({
    status: 'done',
    stepper: { version: 1, steps: v1cells() },
    steps: [
      { key: 'review#1', phase: 'review', status: 'done', activeMs: 30000, costUsd: 0.2 },
      { key: 'review#2', phase: 'review', status: 'done', activeMs: 35000, costUsd: 0.1 },
    ],
  });

  const review = chips(detail).find((c) => c.dataset.id === 'review');
  assert.equal(review.textContent, 'Review · 1m 5s · $0.30', 'cost + duration sum across cycles');
});

test('a step row naming an unknown phase is ignored, not crashed on', async () => {
  const { detail } = await legacyDetail({
    status: 'done',
    stepper: { version: 1, steps: v1cells() },
    steps: [
      { key: 'ghost#1', phase: 'no-such-phase', status: 'done', activeMs: 9000, costUsd: 1 },
      { key: 'plan#1', phase: 'plan', status: 'done', activeMs: 1000, costUsd: 0 },
    ],
  });

  assert.equal(chips(detail).length, 5);
  assert.equal(chips(detail).find((c) => c.dataset.id === 'plan').textContent, 'Plan · 1s');
});

test('the v1 phase fallback never reaches a v2 run', async () => {
  // Charter: the generic path resolves a step row by nodeId ONLY. A v2 manifest
  // fed a phase-keyed row renders its graph, and that row binds to nothing.
  const gnode = (id, label, key) => ({
    id, kind: key ? 'agent' : 'task', key: key || null, label, color: '', sub: '', x: 0, y: 200,
    model: '', effort: '', loop: false,
    ports: { inputs: [], outputs: [{ id: 'out', type: 'md', when: 'always' }] },
  });
  const { detail } = await legacyDetail({
    status: 'done',
    stepper: {
      version: 2,
      graph: { nodes: [gnode('n_task', 'Task'), gnode('n_plan', 'Plan', 'planner')], wires: [] },
      bookends: { preflight: true, done: true },
    },
    steps: [{ key: 'x:n_plan:1', phase: 'plan', status: 'done', activeMs: 4000, costUsd: 0.03 }],
  });

  assert.equal(detail.querySelector('.run-strip'), null, 'a v2 run draws the graph, never the strip');
  assert.deepEqual([...detail.querySelectorAll('.node[data-node-id]')].map((n) => n.dataset.nodeId),
    ['n_task', 'n_plan']);
  assert.ok(detail.querySelector('.node[data-node-id="n_plan"]').classList.contains('is-pending'),
    'no phase fallback outside the legacy renderer: the row binds to no node');
});

test('the v1 phase vocabulary is CONFINED to the legacy renderer', async () => {
  const src = readFileSync(appPath, 'utf8');

  assert.ok(!/PHASE_LABEL/.test(src), 'the v1 phase->label map is gone from the client');

  const start = src.indexOf('function legacyStepRows');
  const end = src.indexOf('function execsFromSteps');
  assert.ok(start > -1, 'the legacy renderer owns the phase mapping');
  assert.ok(end > start, 'and execsFromSteps closes the legacy block');

  for (const m of src.matchAll(/\.uiPhase\b|\bstep\.phase\b|\bs\.phase\b/g)) {
    assert.ok(m.index > start && m.index < end,
      `v1 phase read outside the legacy renderer at index ${m.index}: ${m[0]}`);
  }
});
