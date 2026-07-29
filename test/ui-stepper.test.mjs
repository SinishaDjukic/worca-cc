// test/ui-stepper.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

// Copied verbatim from test/ui-duration.test.mjs (the live Running-view harness):
// collects wsInstances and exposes emit/selectProject/showRunning. Task 5 needs
// it; the pure-helper tests below just read ctx.window.__np.
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

test('buildRunGraph renders one .col per manifest step with node labels', async () => {
  const { window } = await bootLive();
  const host = window.document.createElement('div');
  host.className = 'run-flow';
  window.__np.buildRunGraph(host, {
    version: 1,
    steps: [
      { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
      { kind: 'agents', nodes: [{ id: 's0_0', key: 'planner', uiPhase: 'plan', label: 'Plan', color: 'violet', cycles: false }] },
      { kind: 'agents', nodes: [{ id: 's1_0', key: 'refiner', uiPhase: 'refine', label: 'Refine Plan', color: 'green', cycles: true }] },
      { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
    ],
    feedbacks: [],
  });
  assert.equal(host.querySelectorAll('.col').length, 4);
  assert.equal(host.querySelector('.run-node[data-id="s0_0"] .nmeta b').textContent, 'Plan');
  assert.equal(host.querySelector('.run-node[data-id="s1_0"] .nmeta b').textContent, 'Refine Plan');
});

test('parallel cell yields two .run-node in one .col with the parallel col-tag', async () => {
  const { window } = await bootLive();
  const host = window.document.createElement('div');
  host.className = 'run-flow';
  window.__np.buildRunGraph(host, {
    version: 1,
    steps: [
      { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
      { kind: 'agents', nodes: [
        { id: 's0_0', key: 'planner', label: 'Plan', color: 'violet', cycles: false },
        { id: 's0_1', key: 'reviewer', label: 'Review', color: 'blue', cycles: false },
      ] },
      { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
    ],
    feedbacks: [],
  });
  const cols = host.querySelectorAll(':scope > .col');
  assert.match(cols[1].querySelector('.col-tag').textContent, /parallel/);
  assert.equal(cols[1].querySelectorAll('.run-node').length, 2);
});

test('the templates host .run-flow, not the retired .stages.compact', async () => {
  const { window } = await bootLive();
  assert.equal(window.document.querySelectorAll('.stages.compact').length, 0, 'no .stages.compact in the DOM');
  assert.ok(window.document.querySelector('#run-card-tpl').content.querySelector('.run-flow'), 'run template hosts .run-flow');
  assert.ok(window.document.querySelector('#hist-card-tpl').content.querySelector('.run-flow'), 'hist template hosts .run-flow');
});

test('manifestFor falls back to the legacy default when state has no stepper', async () => {
  const { window } = await bootLive();
  const m = window.__np.manifestFor(undefined);
  assert.equal(m.steps[0].kind, 'preflight');
  assert.equal(m.steps.at(-1).kind, 'done');
  assert.deepEqual(m.steps.map((s) => s.nodes[0].label),
    ['Preflight', 'Clarify', 'Plan', 'Refine', 'Implement', 'Review', 'Done']);
});

test('Running card renders the run\'s graph (run-flow, not stages.compact) and tints by nodeId', async () => {
  const ctx = await bootLive();
  ctx.selectProject();
  await new Promise((r) => setTimeout(r, 0));

  const manifest = {
    version: 1,
    steps: [
      { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
      { kind: 'agents', nodes: [{ id: 's0_0', key: 'planner', uiPhase: 'plan', label: 'Plan', color: 'violet', cycles: false }] },
      { kind: 'agents', nodes: [{ id: 's1_0', key: 'refiner', uiPhase: 'refine', label: 'Refine Plan', color: 'green', cycles: true }] },
      { kind: 'agents', nodes: [{ id: 's4_0', key: 'manualTestsChecklist', uiPhase: 'manual-checklist', label: 'Manual Tests Checklist', color: 'blue', cycles: false }] },
      { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
    ],
    feedbacks: [{ id: 'fb_refine', from: 's1_0', to: 's1_0' }],
  };
  const RID = 'run-1';
  ctx.emit({ type: 'state', runId: RID, status: 'running', phase: 'refine', stepper: manifest, steps: [] });
  ctx.emit({ type: 'phase', runId: RID, phase: 'refine', status: 'start', nodeId: 's1_0' });
  ctx.showRunning();
  await new Promise((r) => setTimeout(r, 0));

  const card = ctx.window.document.querySelector('#run-list [data-run-id="run-1"]');
  assert.ok(card, 'run card exists');
  assert.ok(card.querySelector('.run-flow'), 'graph host present');
  assert.equal(card.querySelector('.stages.compact'), null, 'old flat stepper gone');

  const labels = [...card.querySelectorAll('.run-node .nmeta b')].map((e) => e.textContent);
  assert.deepEqual(labels, ['Preflight', 'Plan', 'Refine Plan', 'Manual Tests Checklist', 'Done']);

  // s1_0 (Refine Plan) is the frontier -> is-active; earlier nodes is-done.
  assert.ok(card.querySelector('.run-node[data-id="s1_0"]').classList.contains('is-active'));
  assert.ok(card.querySelector('.run-node[data-id="s0_0"]').classList.contains('is-done'));
  assert.ok(card.querySelector('.run-node[data-id="preflight"]').classList.contains('is-done'));
  // Self-cycle target carries the iterates ring.
  assert.ok(card.querySelector('.run-node[data-id="s1_0"]').classList.contains('iterates'));
});

test('Running card frontier reflects pause/stop and tracks per-node cycle for the active loop', async () => {
  const ctx = await bootLive();
  ctx.selectProject();
  await new Promise((r) => setTimeout(r, 0));
  const manifest = {
    version: 1,
    steps: [
      { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
      { kind: 'agents', nodes: [{ id: 's1_0', key: 'refiner', uiPhase: 'refine', label: 'Refine Plan', color: 'green', cycles: true }] },
      { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
    ],
    feedbacks: [{ id: 'fb_refine', from: 's1_0', to: 's1_0' }],
  };
  const RID = 'run-2';
  ctx.emit({ type: 'state', runId: RID, status: 'running', phase: 'refine', stepper: manifest, steps: [] });
  ctx.emit({ type: 'phase', runId: RID, phase: 'refine', status: 'start', nodeId: 's1_0', cycle: 1 });
  ctx.emit({ type: 'phase', runId: RID, phase: 'refine', status: 'start', nodeId: 's1_0', cycle: 2 });
  ctx.showRunning();
  await new Promise((r) => setTimeout(r, 0));
  const card = ctx.window.document.querySelector('#run-list [data-run-id="run-2"]');
  assert.ok(card.querySelector('.run-node[data-id="s1_0"]').classList.contains('is-active'));

  // A stop status forces the frontier node to is-stopped.
  ctx.emit({ type: 'state', runId: RID, status: 'stopped' });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(card.querySelector('.run-node[data-id="s1_0"]').classList.contains('is-stopped'));
});
