// test/ui-newpipeline-defrag-pin.test.mjs — New pipeline's agent row for the built-in Memory
// defragment workflow while Settings › Memory pins the pair (memory-defrag-model.mjs): the REAL
// app.js against a fetch stub whose GET /api/workflows/wf_memory_defrag is built by the REAL
// server-side view builder. A save of another tunable keeps the project's own (hidden) pick, and a
// settings-changed frame re-reads the pin while the page is open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { GRAPH_MEMORY_DEFRAG_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { defragWorkflowView, resolveDefragModel } from '../src/core/memory-defrag-model.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';
const MODELS = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: ['medium', 'high', 'xhigh', 'max'] },
];
const DEFRAG_META = JSON.parse(readFileSync(fileURLToPath(new URL('../agents/memoryDefragmenter.meta.json', import.meta.url)), 'utf8'));
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 16) => { for (let i = 0; i < n; i++) await tick(); };
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

class WSStub {
  constructor() { this.readyState = 1; this._listeners = {}; WSStub.last = this; }
  send() {} close() {}
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  _open() { (this._listeners.open || []).forEach((fn) => fn({})); }
  _message(obj) { (this._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) })); }
}

/** A tiny server: the stored Settings › Memory pair, the project's run-config (PATCH applied with
 *  the setters' replace semantics for model/effort), and the pinned workflow view. */
function makeServer({ stored, pick = null }) {
  const srv = { stored, writes: [], nodes: pick ? { n_defrag: { ...pick } } : {} };
  srv.handle = (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    if (url.includes('/api/projects')) return ok({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
    if (url.includes('/api/workflows/wf_memory_defrag')) {
      const pair = srv.stored ? resolveDefragModel({ stored: srv.stored, models: MODELS }) : null;
      return ok(defragWorkflowView(JSON.parse(JSON.stringify(GRAPH_MEMORY_DEFRAG_WORKFLOW)), pair));
    }
    if (url.includes('/api/workflows')) return ok({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_memory_defrag', name: 'Memory defragment' }] });
    if (url.includes('/api/agents')) return ok({ agents: [DEFRAG_META] });
    if (url.includes('/api/scripts')) return ok({ scripts: [] });
    if (url.includes('/api/config')) {
      if (method === 'PATCH' && body && body.nodes) {
        srv.writes.push(body);
        for (const [id, sel] of Object.entries(body.nodes)) {
          const next = { ...srv.nodes[id] };
          if (sel.model) next.model = sel.model; else delete next.model;         // model/effort are REPLACED
          if (sel.effort) next.effort = sel.effort; else delete next.effort;
          if (typeof sel.fanOut === 'boolean') next.fanOut = sel.fanOut; else if (sel.fanOut === null) delete next.fanOut;
          if (Object.keys(next).length) srv.nodes[id] = next; else delete srv.nodes[id];
        }
      }
      const config = { steps: {}, customModels: [], workflows: { wf_memory_defrag: { nodes: JSON.parse(JSON.stringify(srv.nodes)), feedbacks: {} } } };
      return ok({ config, models: MODELS, efforts: ['medium', 'high', 'xhigh', 'max'], subagentModels: ['sonnet', 'opus', 'auto', 'inherit'] });
    }
    return null;
  };
  return srv;
}

async function boot(srv) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4319/' });
  const { window } = dom;
  window.document.documentElement.dataset.level = 'expert';
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  window.fetch = (url, opts) => srv.handle(String(url), opts || {}) || ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'HTMLInputElement', 'HTMLSelectElement']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  if (WSStub.last) WSStub.last._open();
  await settle();
  const doc = window.document;
  const pick = async (sel, value) => { const s = doc.querySelector(sel); s.value = value; s.dispatchEvent(new window.Event('change', { bubbles: true })); await settle(); };
  await pick('#projectSelect', PROJECT);
  await pick('#workflowSelect', 'wf_memory_defrag');
  const row = () => ({
    model: doc.querySelector('.step-model[data-node-id="n_defrag"]'),
    effort: doc.querySelector('.step-effort[data-node-id="n_defrag"]'),
    fan: doc.querySelector('.step-fanout[data-node-id="n_defrag"]'),
  });
  return { window, doc, row };
}

test('a fan-out save on the pinned row keeps the project\'s own defragmenter pick — it applies again once the setting is cleared', async () => {
  const srv = makeServer({ stored: { model: 'claude-haiku-4-5', effort: 'high' }, pick: { model: 'claude-fable-5-1', effort: 'max' } });
  const { window, row } = await boot(srv);
  assert.deepEqual([row().model.value, row().effort.value, row().model.disabled, row().effort.disabled], ['claude-haiku-4-5', 'high', true, true], 'the pinned pair, locked');
  row().fan.checked = true;
  row().fan.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(24);
  const patch = srv.writes.at(-1);
  assert.ok(patch, 'the fan-out toggle saved');
  assert.deepEqual([patch.nodes.n_defrag.model, patch.nodes.n_defrag.effort, patch.nodes.n_defrag.fanOut], ['claude-fable-5-1', 'max', true], 'the hidden pick rides along untouched');
  assert.deepEqual(srv.nodes.n_defrag, { model: 'claude-fable-5-1', effort: 'max', fanOut: true });
  // Another tab clicks "Use default" in Settings › Memory: the frame unpins the open row at once.
  srv.stored = null;
  WSStub.last._message({ type: 'settings-changed' });
  await settle(24);
  assert.deepEqual([row().model.value, row().effort.value, row().model.disabled], ['claude-fable-5-1', 'max', false], 'the project\'s pick is back, editable');
});

test('a settings-changed frame locks the open row when another tab SETS the defragment model', async () => {
  const srv = makeServer({ stored: null });
  const { row } = await boot(srv);
  assert.equal(row().model.disabled, false, 'unset: an ordinary editable row');
  srv.stored = { model: 'claude-opus-5-5', effort: 'xhigh' };
  WSStub.last._message({ type: 'settings-changed' });
  await settle(24);
  assert.deepEqual([row().model.value, row().effort.value, row().model.disabled, row().model.title], ['claude-opus-5-5', 'xhigh', true, 'Set in Settings › Memory'],
    'no editable control the run would ignore');
});

test('a pinned row re-sends a hidden pick the setter would refuse only after healing it against the catalog', async () => {
  // Haiku 4.5 offers medium/high: a stored "max" (efforts narrowed since) must not ride along.
  const srv = makeServer({ stored: { model: 'claude-opus-5-5', effort: 'high' }, pick: { model: 'claude-haiku-4-5', effort: 'max' } });
  const { window, row } = await boot(srv);
  row().fan.checked = true;
  row().fan.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(24);
  const patch = srv.writes.at(-1);
  assert.ok(patch, 'the fan-out toggle saved');
  assert.deepEqual([patch.nodes.n_defrag.model, patch.nodes.n_defrag.effort, patch.nodes.n_defrag.fanOut], ['claude-haiku-4-5', '', true],
    'the model it still offers is kept; the effort it dropped is not re-sent (setNodeModel would 400 the whole save)');
});
