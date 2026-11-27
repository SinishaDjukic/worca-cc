// test/ui-newpipeline-harness-pin.test.mjs — New run's agent row for a step pinned to another harness (spec
// 2026-11-26 "The surfaces"): the REAL app.js against a fetch stub. A project pick or the workflow's own pick that
// names `engine` shows its model locked, says where to change it, and a save of another tunable sends it back with
// its harness. The rig is test/ui-newpipeline-defrag-pin.test.mjs's.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { GRAPH_MEMORY_DEFRAG_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { defragWorkflowView, resolveDefragModel } from '../src/core/memory-defrag-model.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';
const MODELS = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.5', label: 'GPT-5.5', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'] },
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
 *  the setters' replace semantics for model/effort, and plan 1's absent rule for engine), and the
 *  workflow view with `template`'s keys laid into n_defrag's config. */
function makeServer({ stored, pick = null, template = null }) {
  const srv = { stored, writes: [], nodes: pick ? { n_defrag: { ...pick } } : {} };
  srv.handle = (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    if (url.includes('/api/projects')) return ok({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
    if (url.includes('/api/workflows/wf_memory_defrag')) {
      const pair = srv.stored ? resolveDefragModel({ stored: srv.stored, models: MODELS }) : null;
      const tpl = JSON.parse(JSON.stringify(GRAPH_MEMORY_DEFRAG_WORKFLOW));
      if (template) for (const n of tpl.nodes) if (n.id === 'n_defrag') n.config = { ...(n.config || {}), ...template };
      return ok(defragWorkflowView(tpl, pair));
    }
    if (url.includes('/api/workflows')) return ok({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_memory_defrag', name: 'Memory defragment' }] });
    if (url.includes('/api/agents')) return ok({ agents: [DEFRAG_META] });
    if (url.includes('/api/scripts')) return ok({ scripts: [] });
    if (url.includes('/api/config')) {
      if (method === 'PATCH' && body && body.nodes) {
        srv.writes.push(body);
        for (const [id, sel] of Object.entries(body.nodes)) {
          const next = { ...srv.nodes[id] };
          const before = next.model;
          if (typeof sel.engine === 'string' && sel.engine) next.engine = sel.engine;
          else if (sel.engine === '' || sel.engine === null || (sel.engine === undefined && sel.model !== before)) delete next.engine;
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
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4319/#new' }));
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
    sub: doc.querySelector('.step-subagent[data-node-id="n_defrag"]'),
  });
  return { window, doc, row };
}

const ON_CARD = 'Runs on OpenAI Codex. Change it on a Chat run card.';
const PIN = { model: 'gpt-5.5', effort: 'low', engine: 'codex' };
test('a project pick pinned to another harness shows its model, locked, and says to change it on a Chat run card; its Sub-agents hide', async () => {
  const { doc, row } = await boot(makeServer({ stored: null, pick: PIN }));
  assert.deepEqual([row().model.value, row().effort.value, row().model.disabled, row().effort.disabled, row().model.title, row().effort.title],
    ['gpt-5.5', 'low', true, true, ON_CARD, ON_CARD]);
  assert.equal(doc.querySelector('#agents-rows .agent-origin').textContent, ON_CARD);
  assert.equal(row().sub.closest('.select-wrap').hidden, true);
});
test('the workflow\'s own pin says to change it in Workflows', async () => {
  const { row } = await boot(makeServer({ stored: null, template: PIN }));
  assert.deepEqual([row().model.value, row().model.disabled, row().model.title], ['gpt-5.5', true, 'Runs on OpenAI Codex. Change it in Workflows.']);
});
test('a save of another tunable sends the pinned pick back untouched, with its harness; so does a stale pin', async () => {
  for (const pick of [PIN, { model: 'claude-haiku-4-5', effort: 'medium', engine: 'codex' }]) {
    const srv = makeServer({ stored: null, pick });
    const { window, row } = await boot(srv);
    row().fan.checked = true;
    row().fan.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle(24);
    const sent = srv.writes.at(-1).nodes.n_defrag;
    assert.deepEqual([sent.model, sent.effort, sent.engine, sent.fanOut], [pick.model, pick.effort, 'codex', true], pick.model);
  }
});
test('Save as workflow defaults sends a row\'s harness beside its model', async () => {
  const { window } = await boot(makeServer({ stored: null }));
  const of = (row) => window.__np.effectiveDefaultsOf({ fanOut: false, askQuestions: null, subagentModel: '', ...row });
  assert.deepEqual(of({ model: 'gpt-5.5', effort: 'low', engine: 'codex' }), { model: 'gpt-5.5', effort: 'low', engine: 'codex', fanOut: false });
  assert.deepEqual(of({ model: 'claude-haiku-4-5', effort: 'high' }), { model: 'claude-haiku-4-5', effort: 'high', fanOut: false });
});
