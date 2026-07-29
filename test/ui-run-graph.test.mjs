// test/ui-run-graph.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

// Boot harness copied from test/ui-stepper.test.mjs (bootLive).
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
  return { window, selectProject, showRunning, emit };
}

const MANIFEST = {
  version: 1,
  steps: [
    { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
    { kind: 'agents', nodes: [{ id: 's0_0', key: 'planner', uiPhase: 'plan', label: 'Plan', color: 'violet', model: 'opus', effort: 'high', cycles: false }] },
    { kind: 'agents', nodes: [{ id: 's1_0', key: 'refiner', uiPhase: 'refine', label: 'Refine Plan', color: 'green', sub: 'tighten', cycles: true }] },
    { kind: 'agents', nodes: [
      { id: 's3_0', key: 'implementer', uiPhase: 'implement', label: 'Implementation', color: 'peach', sub: 'write code', cycles: false },
      { id: 's3_1', key: 'manualTestsChecklist', uiPhase: 'manual-checklist', label: 'Manual Tests Checklist', color: 'blue', sub: 'draft cases', cycles: false },
    ] },
    { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
  ],
  feedbacks: [],
};

test('buildRunGraph builds .run-flow with leading/trailing strip, one .col per cell, one .run-node per cell node', async () => {
  const { window } = await bootLive();
  window.__np._setModels([{ id: 'opus', label: 'Opus 4.8', efforts: ['low', 'high'] }]);
  const host = window.document.createElement('div');
  host.className = 'run-flow';
  window.__np.buildRunGraph(host, MANIFEST);

  // Two strips (lead/trail) + one wires svg + 5 cols.
  assert.equal(host.querySelectorAll(':scope > .strip').length, 2);
  assert.equal(host.querySelectorAll(':scope > svg.wires').length, 1);
  const cols = host.querySelectorAll(':scope > .col');
  assert.equal(cols.length, 5);

  // Col tags: "Step N" 1-based; parallel cell gets the parallel suffix.
  assert.match(cols[0].querySelector('.col-tag').textContent, /^Step 1/);
  assert.match(cols[3].querySelector('.col-tag').textContent, /Step 4.*parallel/);
  assert.ok(!/parallel/.test(cols[0].querySelector('.col-tag').textContent), 'single-node col has no parallel suffix');

  // Nodes addressable by data-id; 6 nodes total (parallel cell has 2).
  assert.equal(host.querySelectorAll('.run-node[data-id]').length, 6);
  assert.ok(host.querySelector('.run-node[data-id="s0_0"]'));
  assert.ok(host.querySelector('.run-node[data-id="s3_0"]'));
  assert.ok(host.querySelector('.run-node[data-id="s3_1"]'));
});

test('runNode markup: class, --c color, visible model·effort sub-line, and the .nic/.nmeta/.nrun slots', async () => {
  const { window } = await bootLive();
  window.__np._setModels([{ id: 'opus', label: 'Opus 4.8', efforts: ['low', 'high'] }]);
  const node = MANIFEST.steps[1].nodes[0]; // plan, model opus / effort high
  const el = window.__np.runNode(node, 'pending');
  assert.ok(el.classList.contains('node'));
  assert.ok(el.classList.contains('run-node'));
  assert.ok(el.classList.contains('is-pending'));
  assert.equal(el.dataset.id, 's0_0');
  assert.ok(el.style.getPropertyValue('--c'), 'color var set');
  // model · effort is now a visible .nmodel sub-line using the friendly label, not a tooltip.
  assert.equal(el.getAttribute('title'), null, 'tooltip removed');
  assert.equal(el.querySelector('.nmeta .nmodel').textContent, 'Opus 4.8 · high');
  assert.ok(el.querySelector('.nic svg'), 'agent icon present');
  assert.equal(el.querySelector('.nmeta b').textContent, 'Plan');
  assert.ok(el.querySelector('.nmeta .nstatus'), 'status caption slot present');
  assert.ok(el.querySelector('.nrun .dur'), 'duration slot present');
  assert.ok(el.querySelector('.nrun .cost'), 'cost slot present');
});

test('runNode adds .iterates only when the node is its own self-cycle target', async () => {
  const { window } = await bootLive();
  const m = { ...MANIFEST, feedbacks: [{ id: 'fb_refine', from: 's1_0', to: 's1_0' }] };
  const host = window.document.createElement('div');
  host.className = 'run-flow';
  window.__np.buildRunGraph(host, m);
  assert.ok(host.querySelector('.run-node[data-id="s1_0"]').classList.contains('iterates'), 'self-cycle node iterates');
  assert.ok(!host.querySelector('.run-node[data-id="s0_0"]').classList.contains('iterates'), 'non-target node does not');
});

test('runNode renders the status badge svg for done/paused/stopped', async () => {
  const { window } = await bootLive();
  const n = MANIFEST.steps[1].nodes[0];
  assert.ok(window.__np.runNode(n, 'done').querySelector('.nstat.done svg'), 'done -> check badge');
  assert.ok(window.__np.runNode(n, 'paused').querySelector('.nstat.paused svg'), 'paused -> two-bar badge');
  assert.ok(window.__np.runNode(n, 'stopped').querySelector('.nstat.stopped svg'), 'stopped -> X badge');
  // pending/active have no settled badge.
  assert.equal(window.__np.runNode(n, 'pending').querySelector('.nstat'), null);
});

test('buildRunGraph is idempotent: same node-id set rebuilds nothing (node identity preserved)', async () => {
  const { window } = await bootLive();
  const host = window.document.createElement('div');
  host.className = 'run-flow';
  window.__np.buildRunGraph(host, MANIFEST);
  const first = host.querySelector('.run-node[data-id="s0_0"]');
  first.dataset.marker = 'keep';
  window.__np.buildRunGraph(host, MANIFEST); // same topology -> no rebuild
  assert.equal(host.querySelector('.run-node[data-id="s0_0"]').dataset.marker, 'keep', 'DOM reused when node-id set unchanged');
});

test('buildRunGraph tolerates a manifest with no feedbacks (old runs) — nodes only, no iterates', async () => {
  const { window } = await bootLive();
  const m = { version: 1, steps: MANIFEST.steps }; // no feedbacks key
  const host = window.document.createElement('div');
  host.className = 'run-flow';
  assert.doesNotThrow(() => window.__np.buildRunGraph(host, m));
  assert.equal(host.querySelectorAll('.run-node[data-id]').length, 6);
  assert.equal(host.querySelectorAll('.run-node.iterates').length, 0, 'no self-loops without feedbacks');
});

test('buildRunGraph on the legacy default manifest renders the bookends + agents', async () => {
  const { window } = await bootLive();
  const host = window.document.createElement('div');
  host.className = 'run-flow';
  window.__np.buildRunGraph(host, window.__np.manifestFor(undefined));
  const labels = [...host.querySelectorAll('.run-node .nmeta b')].map((e) => e.textContent);
  assert.deepEqual(labels, ['Preflight', 'Clarify', 'Plan', 'Refine', 'Implement', 'Review', 'Done']);
});

test('paintRunGraph with no feedbacks does not throw and still tints', async () => {
  const { window } = await bootLive();
  const m = { version: 1, steps: MANIFEST.steps };
  const host = window.document.createElement('div');
  host.className = 'run-flow';
  window.__np.buildRunGraph(host, m);
  assert.doesNotThrow(() => window.__np.paintRunGraph(host, m, {
    statusOf: () => 'done', activeId: null, cycles: {}, live: false, durText: () => '', costText: () => '',
  }));
  assert.ok(host.querySelector('.run-node[data-id="s0_0"]').classList.contains('is-done'));
});
