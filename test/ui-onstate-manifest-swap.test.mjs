import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '../ui/public/index.html');
const appPath = join(here, '../ui/public/app.js');

// Mirror test/ui-hello-stepper-seed.test.mjs:11-29 (no shared helper exists).
async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; } send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { np: window.__np, window };
}

// A v2 manifest, which is the only shape a retune can reach. `graph.nodes` holds
// the cells patchManifestNodeTune targets and every model reader treats as
// authoritative; `steps` is the derived v1 shim that mirrors them.
const v2 = (model = '', effort = '') => ({
  version: 2,
  graph: { nodes: [{ id: 's2_0', kind: 'agent', model, effort }], wires: [] },
  steps: [{ nodes: [{ id: 's2_0', model, effort }] }],
});

test('onState adopts the manifest the frame carries, first one included', async () => {
  const { np } = await boot();
  const r = np.makeRun({ runId: 'rid' });
  r.el = null;
  assert.equal(r.stepper, null);
  np.onState(r, { stepper: v2(), status: 'running' });
  assert.deepEqual(r.stepper.graph.nodes.map((n) => n.id), ['s2_0']);
});

test('onState adopts a manifest that differs ONLY by a retune', async () => {
  const { np } = await boot();
  const r = np.makeRun({ runId: 'rid' });
  r.stepper = v2();
  r.el = null;
  // A retune patches `model`/`effort` in place and moves no ids. The old node-id
  // signature called that manifest unchanged and DISCARDED it, so the card kept
  // the stale model for the life of the run — which is why a dedicated
  // `noderetune` event used to be needed. Adopting whatever the frame carries
  // needs no field list to keep in step with the engine's patcher.
  np.onState(r, { stepper: v2('claude-opus-5', 'high'), status: 'running' });
  assert.equal(r.stepper.graph.nodes[0].model, 'claude-opus-5');
  assert.equal(r.stepper.graph.nodes[0].effort, 'high');
});

test('onState adopts a manifest that differs by a scalar NOTHING special-cases', async () => {
  const { np } = await boot();
  const r = np.makeRun({ runId: 'rid' });
  r.stepper = v2();
  r.el = null;
  // The point of dropping the signature: a cell carries more mutable scalars than
  // model/effort (subagentModel, fanOut, a loop's maxCycles). A whitelist would
  // silently discard each new one in turn.
  const next = v2();
  next.graph.nodes[0].subagentModel = 'opus';
  np.onState(r, { stepper: next, status: 'running' });
  assert.equal(r.stepper.graph.nodes[0].subagentModel, 'opus');
});

test('a frame with NO stepper leaves the one we have alone', async () => {
  const { np } = await boot();
  const r = np.makeRun({ runId: 'rid' });
  r.stepper = v2('claude-opus-5', 'high');
  r.el = null;
  np.onState(r, { status: 'running', steps: [] });
  assert.equal(r.stepper.graph.nodes[0].model, 'claude-opus-5');
});

test('a decomposition still drives a STRUCTURAL rebuild — that gate moved, it did not vanish', async () => {
  // Adoption is unconditional now, so asserting `r.stepper` changed proves nothing.
  // The gate that used to live here — "did the node ids move?" — is run-hosts' own
  // `nodeSig`, and it is what rebuilds the graph DOM so later paints address the
  // right cards. Exercise it, rather than pinning its source text.
  const { mountRunGraph } = await import('../ui/public/graph/run-hosts.mjs');
  const dom = new JSDOM('<!doctype html><div class="run-flow-wrap"><div class="run-flow"></div></div>');
  const host = dom.window.document.querySelector('.run-flow');
  const m = mountRunGraph(host, { mode: 'monitor', doc: dom.window.document,
    raf: (fn) => { fn(); return 1; }, viewport: () => ({ left: 0, top: 0, width: 900, height: 520 }) });
  const cell = (id) => ({ id, kind: 'agent', key: 'k', x: 0, y: 0, label: id, color: '',
    ports: { inputs: [], outputs: [], await: false } });
  const man = (ids) => ({ version: 2, template: { id: 't', name: 'T' },
    graph: { nodes: ids.map(cell), wires: [] }, steps: [], feedbacks: [] });
  const bag = (ids) => ({ version: 2, nodeIds: ids, wireIds: [], status: {}, colors: {},
    footers: {}, totals: {}, tune: {} });

  m.update('r1', man(['s2_0']), bag(['s2_0']));
  assert.deepEqual([...host.querySelectorAll('[data-node-id]')].map((e) => e.dataset.nodeId), ['s2_0']);
  // The decomposition rewrites the implementer into per-task nodes.
  m.update('r1', man(['s_impl_p1_t1', 's_impl_p1_t2']), bag(['s_impl_p1_t1', 's_impl_p1_t2']));
  assert.deepEqual([...host.querySelectorAll('[data-node-id]')].map((e) => e.dataset.nodeId),
    ['s_impl_p1_t1', 's_impl_p1_t2'], 'the cards were rebuilt for the new ids');
  m.destroy();   // the mount owns document listeners and a ResizeObserver
});
