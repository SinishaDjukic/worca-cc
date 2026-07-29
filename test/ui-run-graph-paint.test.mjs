// test/ui-run-graph-paint.test.mjs — (copy bootLive from test/ui-run-graph.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

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
  return { window };
}

const MANIFEST = {
  version: 1,
  steps: [
    { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
    { kind: 'agents', nodes: [{ id: 's0_0', key: 'planner', uiPhase: 'plan', label: 'Plan', color: 'violet', cycles: false }] },
    { kind: 'agents', nodes: [{ id: 's1_0', key: 'refiner', uiPhase: 'refine', label: 'Refine Plan', color: 'green', cycles: true }] },
    { kind: 'agents', nodes: [{ id: 's3_0', key: 'implementer', uiPhase: 'implement', label: 'Implementation', color: 'peach', cycles: false }] },
    { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
  ],
  feedbacks: [{ id: 'fb_refine', from: 's1_0', to: 's1_0' }, { id: 'fb_review', from: 's3_0', to: 's1_0' }],
};

test('loopCounts applies the final rule max(0,(cycle||1)-1) per node', async () => {
  const { window } = await bootLive();
  const out = window.__np.loopCounts(MANIFEST, { s1_0: 3, s3_0: 1 });
  assert.equal(out.s1_0, 2, 'refiner ran 3 cycles -> 2 loop-backs');
  assert.equal(out.s3_0, 0, 'one pass -> 0');
  assert.equal(out.s0_0, 0, 'unseen node defaults to cycle 1 -> 0');
});

test('paintRunGraph tints nodes from statusOf and fills .nstatus / .dur / .cost', async () => {
  const { window } = await bootLive();
  const host = window.document.createElement('div');
  host.className = 'run-flow';
  window.__np.buildRunGraph(host, MANIFEST);

  const status = { preflight: 'done', s0_0: 'done', s1_0: 'active', s3_0: 'pending', done: 'pending' };
  window.__np.paintRunGraph(host, MANIFEST, {
    statusOf: (id) => status[id] || 'pending',
    activeId: 's1_0',
    cycles: { s1_0: 1 },
    live: true,
    durText: (id) => (id === 's1_0' ? '12s' : ''),
    costText: (id) => (id === 's1_0' ? '$0.20' : ''),
  });

  const done = host.querySelector('.run-node[data-id="s0_0"]');
  assert.ok(done.classList.contains('is-done'));
  assert.equal(done.querySelector('.nstatus').textContent, 'completed');
  assert.ok(done.querySelector('.nstat.done svg'), 'done badge added on paint');

  const active = host.querySelector('.run-node[data-id="s1_0"]');
  assert.ok(active.classList.contains('is-active'));
  assert.equal(active.querySelector('.nstatus').textContent, 'running…');
  assert.equal(active.querySelector('.dur').textContent, '12s');
  assert.equal(active.querySelector('.cost').textContent, '$0.20');
});

test('paintRunGraph flips a node class+badge between paints (active -> done)', async () => {
  const { window } = await bootLive();
  const host = window.document.createElement('div');
  host.className = 'run-flow';
  window.__np.buildRunGraph(host, MANIFEST);
  const view = (s) => ({ statusOf: () => s, activeId: null, cycles: {}, live: false, durText: () => '', costText: () => '' });

  window.__np.paintRunGraph(host, MANIFEST, view('active'));
  const n = host.querySelector('.run-node[data-id="s1_0"]');
  assert.ok(n.classList.contains('is-active'));
  assert.equal(n.querySelector('.nstat'), null, 'active has no settled badge');

  window.__np.paintRunGraph(host, MANIFEST, view('done'));
  assert.ok(n.classList.contains('is-done'));
  assert.ok(!n.classList.contains('is-active'), 'old status class removed');
  assert.ok(n.querySelector('.nstat.done svg'), 'badge swapped to done');
});

test('paintRunGraph repaints wires only when the signature changes', async () => {
  const { window } = await bootLive();
  // Force composerPaintWires to run in jsdom (offsetParent is null otherwise).
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.parentNode || null; } });
  let calls = 0;
  const real = window.__np.composerPaintWires;
  window.__np.composerPaintWires = (...a) => { calls++; return real(...a); };

  const host = window.document.createElement('div');
  host.className = 'run-flow';
  window.document.body.appendChild(host);
  window.__np.buildRunGraph(host, MANIFEST);
  const view = { statusOf: () => 'done', activeId: 's1_0', cycles: { s1_0: 1 }, live: true, durText: () => '', costText: () => '' };

  window.__np.paintRunGraph(host, MANIFEST, view);
  const after1 = calls;
  assert.ok(after1 >= 1, 'first paint draws wires');
  window.__np.paintRunGraph(host, MANIFEST, view); // identical signature
  assert.equal(calls, after1, 'unchanged signature does not redraw wires');
  window.__np.paintRunGraph(host, MANIFEST, { ...view, activeId: 's3_0' }); // activeId changed
  assert.equal(calls, after1 + 1, 'changed signature redraws wires once');
});
