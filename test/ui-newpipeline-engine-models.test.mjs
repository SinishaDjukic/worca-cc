// test/ui-newpipeline-engine-models.test.mjs — New pipeline's agent rows: each row's picker opens on the run's default
// harness and offers the others (cascading-settings-design.md §6, D10), a pinned pick keeps its harness through a
// default-harness switch, the sub-agent model hides off Claude, a hidden pick survives a save (Review Focus 4), and
// Add model under an empty Model column opens the Models page on that harness.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

const trackDom = useDomRelease(afterEach);
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
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4319/' }));
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
const pick = (doc, engine) => { const s = doc.getElementById('engineSelect'); s.value = engine; s.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true })); };
const openRow = (doc, node) => { doc.querySelector(`.step-model[data-node-id="${node}"]`).click(); return doc.querySelector('.mdl-cols-pop'); };
const modelKeys = (pop) => [...pop.querySelectorAll('[data-col="model"] [role="option"]')].map((b) => b.dataset.key);
const shownHarness = (pop) => pop.querySelector('[data-col="harness"] [aria-selected="true"]');
const subHidden = (doc, node) => doc.querySelector(`.step-subagent[data-node-id="${node}"]`).closest('.select-wrap').hidden;

test('a row\'s picker opens on the run\'s default harness and offers the others', async () => {
  const { window } = await boot(apiFetch());
  await openWf(window);
  const doc = window.document;
  const eng = doc.getElementById('engineSelect');
  assert.deepEqual([doc.querySelector('label[for="engineSelect"]').textContent, eng.getAttribute('aria-label'), eng.title], ['Default harness', 'Default harness', 'Steps set to inherit run here']);
  let pop = openRow(doc, 'n1');
  assert.deepEqual([shownHarness(pop).dataset.key, shownHarness(pop).querySelector('.badge').textContent, modelKeys(pop)], ['claude', 'Default', ['claude-opus-4-8', 'claude-haiku-4-5']]);
  assert.ok(pop.querySelector('[data-col="harness"] [data-key="codex"]'));
  pick(doc, 'codex');
  await waitFor(() => subHidden(doc, 'n1'));
  pop = openRow(doc, 'n1');
  assert.deepEqual([shownHarness(pop).dataset.key, modelKeys(pop)], ['codex', ['gpt-5.5']]);
  pick(doc, 'claude');
  await waitFor(() => !subHidden(doc, 'n1'));
});
test('Review Focus 3: a pinned pick keeps its model, harness and Sub-agents when the default harness changes', async () => {
  const config = { workflows: { wf_t: { nodes: { n0: { model: 'claude-haiku-4-5', engine: 'claude' } }, feedbacks: {} } } };
  const { window } = await boot(apiFetch({ config }));
  await openWf(window);
  const doc = window.document;
  pick(doc, 'codex');
  await waitFor(() => subHidden(doc, 'n1'));
  const m = doc.querySelector('.step-model[data-node-id="n0"]');
  assert.deepEqual([m.value, m.dataset.engine, subHidden(doc, 'n0'), m.closest('.agent-row').querySelector('.agent-kept-pick')], ['claude-haiku-4-5', 'claude', false, null]);
});

test('switching to Codex heals a Claude pick, and saving another tunable keeps it (Review Focus 4)', async () => {
  const sink = [];
  const config = { workflows: { wf_t: { nodes: { n0: { model: 'claude-haiku-4-5' } }, feedbacks: {} } } };
  const { window } = await boot(apiFetch({ config, sink }));
  await openWf(window);
  const doc = window.document;
  assert.equal(doc.querySelector('.step-model[data-node-id="n0"]').value, 'claude-haiku-4-5');
  pick(doc, 'codex');
  await waitFor(() => subHidden(doc, 'n1'));
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
  assert.equal(kept().textContent, 'Your Claude Code pick Haiku 4.5 is kept for Claude Code runs. Choose a model here to replace it.');
});

test('Add model under an empty Model column opens the Models page with that harness picked', async () => {
  const { window } = await boot(apiFetch());
  await openWf(window);
  const doc = window.document;
  const pop = openRow(doc, 'n1');
  pop.querySelector('[data-col="harness"] [data-key="cursor"]').click();
  pop.querySelector('.mdl-cols-add').click();
  await waitFor(() => !doc.getElementById('model-editor-modal').classList.contains('hidden'));
  assert.equal(window.location.hash, '#models');
  assert.ok(doc.querySelector('#mv-editor-host .mdl-add[data-step="1"] .mdl-hx-t[data-engine="cursor"][aria-pressed="true"]'), 'the Cursor tile pressed');
});

// #1450: what "default" resolves to on the run card, and the tool-decides warning in the engine hint.
const EFFECTIVE = {
  claude: { deep: { model: 'claude-opus-4-8', source: 'worca-default' }, everyday: { model: 'claude-haiku-4-5', source: 'worca-default' }, quick: { model: 'claude-haiku-4-5', source: 'worca-default' } },
  codex: { deep: { source: 'cli-decides' }, everyday: { model: 'gpt-5.5', source: 'worca-default' }, quick: { model: 'gpt-5.5', source: 'worca-default' } },
  copilot: { deep: { source: 'tool-decides' }, everyday: { source: 'tool-decides' }, quick: { source: 'tool-decides' } },
};
const withDefaults = (inner) => (url, opts) => (url.includes('/api/run-defaults')
  ? Promise.resolve({ ok: true, status: 200, json: async () => ({ engine: { value: 'claude', source: 'default' }, steps: {}, projectKey: null, tags: [], pr: null, effectiveRoles: EFFECTIVE }) })
  : inner(url, opts));

test('#1450: an empty step says which model it runs on; a tool-decides engine warns in the hint', async () => {
  const { window } = await boot(withDefaults(apiFetch()));
  await openWf(window);
  const doc = window.document;
  const row = (id) => doc.querySelector(`.step-model[data-node-id="${id}"]`).closest('.agent-row');
  await waitFor(() => /Worca/.test(row('n1').querySelector('.agent-origin').textContent));
  assert.equal(row('n1').querySelector('.agent-origin').textContent, 'No model set: runs on Opus 4.8 (Worca’s default for Deep thinking).');
  assert.equal(row('n1').querySelector('.agent-sum').textContent, 'default: Opus 4.8');
  pick(doc, 'codex');
  await waitFor(() => /decides/.test(row('n1').querySelector('.agent-origin').textContent));
  assert.equal(row('n1').querySelector('.agent-origin').textContent, 'No model set: Codex decides (your Deep thinking role).');
  pick(doc, 'copilot');
  await waitFor(() => /can't know/.test(doc.getElementById('engine-hint').textContent));
  assert.match(doc.getElementById('engine-hint').textContent, /Steps with no model: GitHub Copilot decides: Worca can't know which model runs\.$/);
  await waitFor(() => /Copilot/.test(row('n1').querySelector('.agent-origin').textContent));
  assert.equal(row('n1').querySelector('.agent-origin').textContent, "GitHub Copilot decides: Worca can't know which model runs.");
});
