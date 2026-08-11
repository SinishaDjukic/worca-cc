// test/ui-subagent-fan.test.mjs — (copy bootLive from test/ui-run-graph-paint.test.mjs)
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

// v2 run manifest (buildGraphManifest, src/core/workflows.mjs:567): the run
// monitor renders the graph the run actually ran, so a fixture carries one.
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
const MANIFEST = gmanifest([
  ['s0_0', 'planner', 'Plan', 'violet'],
  ['s1_0', 'refiner', 'Refine Plan', 'green'],
  ['s3_0', 'implementer', 'Implementation', 'peach'],
]);

test('subFanHtml renders one .sq per sub, .on iff running, exact ×N, capped at 24', async () => {
  const { window } = await bootLive();
  const { subFanHtml } = window.__np;
  const host = window.document.createElement('div');

  host.innerHTML = subFanHtml([{ status: 'running' }, { status: 'finished' }, { status: 'error' }]);
  assert.equal(host.querySelectorAll('.fan .sq').length, 3, 'one square per sub');
  assert.equal(host.querySelectorAll('.fan .sq.on').length, 1, 'only running squares are .on');
  assert.equal(host.querySelector('.fan .fl').textContent, '×3', 'count is exact');

  // empty -> no strip at all (no dangling border row)
  assert.equal(subFanHtml([]), '', 'no subs -> empty string');

  // render-cap: 30 subs -> 24 squares but ×30 exact
  host.innerHTML = subFanHtml(Array.from({ length: 30 }, () => ({ status: 'finished' })));
  assert.equal(host.querySelectorAll('.fan .sq').length, 24, 'squares capped at 24');
  assert.equal(host.querySelector('.fan .fl').textContent, '×30', 'count stays exact past the cap');
});

const decor = (o = {}) => ({
  live: true, runStatus: 'running', active: [], executions: [], steps: [],
  endReached: false, result: null, warnings: [], gateWireId: null, expanded: [], now: 0, ...o,
});

test('the run decor injects the .fan strip into a card from decor.subsOf', async () => {
  const { window } = await bootLive();
  const host = window.document.createElement('div');
  host.className = 'run-flow';

  const subs = { s1_0: [{ status: 'running' }, { status: 'finished' }] };
  window.__np.paintRunGraph(host, MANIFEST, decor({
    active: [{ nodeId: 's1_0', executionId: 'x:s1_0:1' }],
    executions: [{ executionId: 'x:s1_0:1', nodeId: 's1_0', ordinal: 1, kind: 'cycle', status: 'start', agentKey: 'refiner' }],
    subsOf: (id) => subs[id] || [],
  }));

  const n = host.querySelector('.node[data-node-id="s1_0"]');
  assert.equal(n.querySelectorAll('.fan .sq').length, 2, 'card gets two squares');
  assert.equal(n.querySelectorAll('.fan .sq.on').length, 1);
  assert.equal(n.querySelector('.fan .fl').textContent, '×2');

  // a node with no subs has no .fan
  assert.equal(host.querySelector('.node[data-node-id="s0_0"] .fan'), null, 'no subs -> no strip');

  // repaint with the sub finished -> .on drops to 0 (idempotent, no duplicate strip)
  window.__np.paintRunGraph(host, MANIFEST, decor({
    live: false, runStatus: 'done',
    executions: [{ executionId: 'x:s1_0:1', nodeId: 's1_0', ordinal: 1, kind: 'cycle', status: 'done', agentKey: 'refiner' }],
    subsOf: (id) => (id === 's1_0' ? [{ status: 'finished' }, { status: 'finished' }] : []),
  }));
  assert.equal(n.querySelectorAll('.fan').length, 1, 'strip not duplicated on repaint');
  assert.equal(n.querySelectorAll('.fan .sq.on').length, 0, 'no running square after finish');
});

test('the run decor tolerates a bag with no subsOf', async () => {
  const { window } = await bootLive();
  const host = window.document.createElement('div');
  host.className = 'run-flow';
  window.__np.paintRunGraph(host, MANIFEST, decor({ live: false, runStatus: 'done' }));
  assert.equal(host.querySelector('.fan'), null, 'absent subsOf -> no strip, no throw');
});
