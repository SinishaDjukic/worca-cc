// test/ui-composer-save.test.mjs — the Composer -> POST /api/workflows transport.
// The editor hands app.js a v2 template body ({id,name,version,domain,nodes,wires,
// canvas}); saveWorkflow must forward it VERBATIM. A helper that only forwards the
// v1 field set drops nodes/wires/version, and ui/server.mjs then validates an empty
// graph and 422s EVERY save — invisible to the graph suites, which never cross the
// wire. bootLive() copied from ui-graphify-count-pill.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

/** The shape composer-editor's confirmSave() builds: serialize() + name + domain. */
const V2_BODY = {
  id: 'wf_mine',
  name: 'Mine',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 320, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } },
  ],
  canvas: { zoom: 1, panX: 0, panY: 0 },
};

async function bootLive(onPost) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  };
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.includes('/api/workflows') && opts && opts.method === 'POST') {
      onPost(JSON.parse(opts.body));
      return Promise.resolve({
        ok: true, status: 201,
        json: async () => ({ workflow: { ...V2_BODY }, warnings: [] }),
      });
    }
    if (u.includes('/api/projects')) {
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

test('saveWorkflow POSTs the v2 template body verbatim — nodes/wires/version survive', async () => {
  let posted = null;
  const { window } = await bootLive((body) => { posted = body; });
  const { saveWorkflow } = window.__np;
  assert.equal(typeof saveWorkflow, 'function', 'saveWorkflow is reachable from the test hook');

  await saveWorkflow(V2_BODY);

  assert.ok(posted, 'a POST /api/workflows went out');
  assert.equal(posted.version, 2, 'version 2 reaches the route — without it validateGraph V1 rejects');
  assert.deepEqual(posted.nodes, V2_BODY.nodes, 'the graph nodes are not dropped');
  assert.deepEqual(posted.wires, V2_BODY.wires, 'the graph wires are not dropped');
  assert.equal(posted.id, 'wf_mine', 'the id rides along so a re-save updates instead of forking');
  assert.deepEqual(posted.canvas, V2_BODY.canvas, 'the canvas viewport is persisted');
  assert.equal(posted.name, 'Mine');
  assert.equal(posted.domain, 'coding');
});

test('saveWorkflow returns the {workflow, warnings} envelope the composer logs from', async () => {
  const { window } = await bootLive(() => {});
  const saved = await window.__np.saveWorkflow(V2_BODY);
  assert.equal(saved.workflow.name, 'Mine', 'the saved row is under .workflow, not spread onto the envelope');
  assert.deepEqual(saved.warnings, []);
});
