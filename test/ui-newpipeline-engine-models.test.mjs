// test/ui-newpipeline-engine-models.test.mjs — New pipeline's agent rows offer the run engine's
// models (cascading-settings-design.md §6, D10), re-filter on an engine switch, hide the
// sub-agent model on Codex, and keep a hidden pick through a save (Review Focus 4).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj-engine';

const MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['medium', 'high', 'max'], engine: 'claude' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], engine: 'claude' },
  { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['minimal', 'low', 'medium', 'high'], engine: 'codex', builtin: true },
];
const AGENTS = [
  { key: 'planner', displayName: 'Plan', color: 'violet', fanOut: true },
  { key: 'reviewer', displayName: 'Review', color: 'blue', fanOut: false },
];
const WF = {
  id: 'wf_t', name: 'Tuned',
  steps: [[{ id: 'n0', key: 'planner', defaults: { model: 'claude-opus-4-8', effort: 'high' } }], [{ id: 'n1', key: 'reviewer' }]],
  feedbacks: [],
};

function apiFetch({ config = {}, sink = [] } = {}) {
  const cfg = { steps: {}, customModels: [], workflows: {}, ...JSON.parse(JSON.stringify(config)) };
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  return (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (method !== 'GET') sink.push({ url, method, body });
    if (url.includes('/api/projects')) return ok({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
    if (url.includes(`/api/workflows/${WF.id}/defaults`)) return ok({ workflow: WF, defaults: {} });
    if (url.includes(`/api/workflows/${WF.id}`)) return ok(WF);
    if (url.includes('/api/workflows')) return ok({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: WF.id, name: WF.name }] });
    if (url.includes('/api/agents')) return ok({ agents: AGENTS });
    if (url.includes('/api/config')) {
      if (method === 'PATCH' && body && body.nodes) {
        const wf = (cfg.workflows[body.workflowId] ||= { nodes: {}, feedbacks: {} });
        for (const [id, sel] of Object.entries(body.nodes)) {
          const e = { ...wf.nodes[id] };
          if (sel.model) e.model = sel.model; else delete e.model;
          if (sel.effort) e.effort = sel.effort; else delete e.effort;
          if (typeof sel.fanOut === 'boolean') e.fanOut = sel.fanOut; else if (sel.fanOut === null) delete e.fanOut;
          if (Object.keys(e).length) wf.nodes[id] = e; else delete wf.nodes[id];
        }
      }
      return ok({ config: cfg, models: MODELS, efforts: ['medium', 'high', 'max'], subagentModels: ['sonnet', 'opus', 'fable', 'auto', 'inherit'] });
    }
    return null;
  };
}

async function boot(fetchHandler) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4319/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  };
  window.fetch = (url, opts) => {
    const r = fetchHandler(String(url), opts || {});
    if (r) return r;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'HTMLInputElement', 'HTMLSelectElement']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function waitFor(pred, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) { if (Date.now() > end) throw new Error('waitFor timed out'); await tick(); }
}
async function openWf(window) {
  const doc = window.document;
  const p = doc.querySelector('#projectSelect');
  p.value = PROJECT; p.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  const w = doc.querySelector('#workflowSelect');
  w.value = WF.id; w.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => doc.querySelector('.step-model[data-node-id="n1"]'));
}
const ids = (doc, node) => [...doc.querySelectorAll(`.step-model[data-node-id="${node}"] option`)].map((o) => o.value);
const pick = (doc, engine) => doc.querySelector(`#engine-seg button[data-engine="${engine}"]`).click();
const CLAUDE_IDS = ['', 'claude-haiku-4-5', 'claude-opus-4-8', '__add__'];

test('the agent rows offer the run engine\'s models and re-filter on an engine switch', async () => {
  const { window } = await boot(apiFetch());
  await openWf(window);
  const doc = window.document;
  assert.deepEqual(ids(doc, 'n1'), CLAUDE_IDS);
  pick(doc, 'codex');
  await waitFor(() => ids(doc, 'n1').includes('gpt-5.5'));
  assert.deepEqual(ids(doc, 'n1'), ['', 'gpt-5.5', '__add__']);
  assert.equal(doc.querySelector('.step-subagent[data-node-id="n1"]').closest('.select-wrap').hidden, true, 'no sub-agents on codex');
  pick(doc, 'claude');
  await waitFor(() => !ids(doc, 'n1').includes('gpt-5.5'));
  assert.deepEqual(ids(doc, 'n1'), CLAUDE_IDS);
  assert.equal(doc.querySelector('.step-subagent[data-node-id="n1"]').closest('.select-wrap').hidden, false);
});

test('switching to Codex heals a Claude pick, and saving another tunable keeps it (Review Focus 4)', async () => {
  const sink = [];
  const config = { workflows: { wf_t: { nodes: { n0: { model: 'claude-haiku-4-5' } }, feedbacks: {} } } };
  const { window } = await boot(apiFetch({ config, sink }));
  await openWf(window);
  const doc = window.document;
  assert.equal(doc.querySelector('.step-model[data-node-id="n0"]').value, 'claude-haiku-4-5');
  pick(doc, 'codex');
  await waitFor(() => ids(doc, 'n0').includes('gpt-5.5'));
  assert.equal(doc.querySelector('.step-model[data-node-id="n0"]').value, '');
  const fan = doc.querySelector('.step-fanout[data-node-id="n0"]');
  fan.checked = !fan.checked;
  fan.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => sink.some((c) => c.method === 'PATCH' && c.body && c.body.nodes && c.body.nodes.n0));
  const patch = sink.find((c) => c.method === 'PATCH' && c.body && c.body.nodes && c.body.nodes.n0);
  assert.equal(patch.body.nodes.n0.model, 'claude-haiku-4-5', 'the stored Claude pick survives the save');
});

test('a row healed for the run says which pick of the other engine it keeps (review #3)', async () => {
  const config = { workflows: { wf_t: { nodes: { n0: { model: 'claude-haiku-4-5' } }, feedbacks: {} } } };
  const { window } = await boot(apiFetch({ config }));
  await openWf(window);
  const doc = window.document;
  const kept = () => doc.querySelector('.step-model[data-node-id="n0"]').closest('.agent-row').querySelector('.agent-kept-pick');
  assert.equal(kept(), null, 'on its own engine the pick is simply shown');
  pick(doc, 'codex');
  await waitFor(() => kept());
  assert.equal(kept().textContent, 'Your Claude pick Haiku 4.5 is kept for Claude runs — choose a model here to replace it.');
});
