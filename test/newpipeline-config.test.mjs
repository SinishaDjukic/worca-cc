// test/newpipeline-config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

// Boot app.js in jsdom with a controllable fetch. Mirrors test/ui-cost.test.mjs.
async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4319/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  };
  window.fetch = (url, opts) => {
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    if (String(url).includes('/api/workflows')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'HTMLInputElement', 'HTMLSelectElement']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

// A two-step workflow with one parallel member and one feedback loop.
const WF = {
  id: 'wf_x', name: 'Demo',
  steps: [
    [{ id: 's0_0', key: 'planner' }],
    [{ id: 's1_0', key: 'implementer' }, { id: 's1_1', key: 'manualTestsChecklist' }],
    [{ id: 's2_0', key: 'reviewer' }],
  ],
  feedbacks: [{ id: 'fb_0', from: 's2_0', to: 's1_0' }],
};
const REGISTRY = {
  planner: { key: 'planner', displayName: 'Plan', color: 'violet', order: 1 },
  implementer: { key: 'implementer', displayName: 'Implement', color: 'peach', order: 3 },
  manualTestsChecklist: { key: 'manualTestsChecklist', displayName: 'Manual Tests Checklist', color: 'blue', order: 5 },
  reviewer: { key: 'reviewer', displayName: 'Review', color: 'blue', order: 4 },
};

test('buildNodeConfigRows flattens steps in order, keyed by nodeId, with registry label+color', async () => {
  const { window } = await boot();
  const rows = window.__np.buildNodeConfigRows(WF, REGISTRY, { nodes: {}, feedbacks: {} });
  assert.deepEqual(rows.map((r) => r.nodeId), ['s0_0', 's1_0', 's1_1', 's2_0']);
  assert.deepEqual(rows.map((r) => r.key), ['planner', 'implementer', 'manualTestsChecklist', 'reviewer']);
  assert.deepEqual(rows.map((r) => r.label), ['Plan', 'Implement', 'Manual Tests Checklist', 'Review']);
  assert.deepEqual(rows.map((r) => r.color), ['violet', 'peach', 'blue', 'blue']); // C5: manualTestsChecklist is blue (two blue pills: checklist + reviewer)
  // step indices preserved (used for the "Step N · parallel" hint)
  assert.deepEqual(rows.map((r) => r.stepIndex), [0, 1, 1, 2]);
  // no run-config => empty model/effort
  assert.deepEqual(rows.map((r) => r.model), ['', '', '', '']);
  assert.deepEqual(rows.map((r) => r.effort), ['', '', '', '']);
});

test('buildNodeConfigRows overlays saved run-config model/effort per nodeId', async () => {
  const { window } = await boot();
  const rc = { nodes: { s1_0: { model: 'claude-opus-4-8', effort: 'high' }, s2_0: { model: 'claude-sonnet-4-6' } }, feedbacks: {} };
  const rows = window.__np.buildNodeConfigRows(WF, REGISTRY, rc);
  const byId = Object.fromEntries(rows.map((r) => [r.nodeId, r]));
  assert.equal(byId.s1_0.model, 'claude-opus-4-8');
  assert.equal(byId.s1_0.effort, 'high');
  assert.equal(byId.s2_0.model, 'claude-sonnet-4-6');
  assert.equal(byId.s2_0.effort, '');      // absent in run-config -> ''
  assert.equal(byId.s0_0.model, '');        // untouched node
});

test('buildNodeConfigRows tolerates a key missing from the registry (falls back to the key as label, no color)', async () => {
  const { window } = await boot();
  const wf = { id: 'w', steps: [[{ id: 'n0', key: 'ghost' }]], feedbacks: [] };
  const rows = window.__np.buildNodeConfigRows(wf, REGISTRY, { nodes: {}, feedbacks: {} });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'ghost');
  assert.equal(rows[0].color, '');
});

test('buildNodeConfigRows on the Default 4-step topology yields the original four rows in order', async () => {
  const { window } = await boot();
  const def = {
    id: 'wf_default', name: 'Default',
    steps: [
      [{ id: 's0_0', key: 'planner' }],
      [{ id: 's1_0', key: 'refiner' }],
      [{ id: 's2_0', key: 'implementer' }],
      [{ id: 's3_0', key: 'reviewer' }],
    ],
    feedbacks: [],
  };
  const reg = { ...REGISTRY, refiner: { key: 'refiner', displayName: 'Refine', color: 'green', order: 2 } };
  const rows = window.__np.buildNodeConfigRows(def, reg, { nodes: {}, feedbacks: {} });
  assert.deepEqual(rows.map((r) => r.key), ['planner', 'refiner', 'implementer', 'reviewer']);
  assert.deepEqual(rows.map((r) => r.label), ['Plan', 'Refine', 'Implement', 'Review']);
});

import { readFileSync as _rf } from 'node:fs';
const indexHtml = _rf(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');

test('index.html exposes the workflow select + dynamic node/feedback containers', () => {
  assert.ok(indexHtml.includes('id="workflowSelect"'), 'missing #workflowSelect');
  assert.ok(indexHtml.includes('id="wf-default-stages"'), 'missing #wf-default-stages wrapper');
  assert.ok(indexHtml.includes('id="wf-node-config"'), 'missing #wf-node-config container');
  assert.ok(indexHtml.includes('id="wf-feedback-config"'), 'missing #wf-feedback-config container');
  // the original four hardcoded stage rows must remain (Default backward-compat)
  for (const role of ['planner', 'refiner', 'implementer', 'reviewer']) {
    assert.ok(indexHtml.includes(`data-role="${role}"`), `lost default stage row for ${role}`);
  }
});

test('index.html includes a Clarify default-stage card as the first stage with full-parity controls', () => {
  // Clarify must exist as a default-stage row with the same model + effort + fan-out controls.
  assert.ok(indexHtml.includes('data-role="clarify"'), 'missing Clarify default stage row');
  assert.ok(indexHtml.includes('<b>Clarify</b>'), 'missing Clarify title');
  assert.ok(indexHtml.includes('<div class="acc red"></div>'), 'missing Clarify accent bar');
  assert.ok(
    indexHtml.includes('class="step-model select" data-role="clarify"'),
    'Clarify card missing model select',
  );
  assert.ok(
    indexHtml.includes('class="step-effort select" data-role="clarify"'),
    'Clarify card missing effort select',
  );
  assert.ok(
    indexHtml.includes('class="step-fanout" data-role="clarify"'),
    'Clarify card missing fan-out checkbox',
  );
  assert.ok(
    indexHtml.includes('class="step-current" data-role="clarify"'),
    'Clarify card missing summary line',
  );
  // Clarify is the FIRST stage: it must appear before the Plan (planner) card.
  assert.ok(
    indexHtml.indexOf('data-role="clarify"') < indexHtml.indexOf('data-role="planner"'),
    'Clarify card must come before the Plan card',
  );
});

test('the Clarify default-stage card defaults Fan-out ON and is populated from /api/config steps', async () => {
  // Top-level `steps` array carries each step's default fan-out (from the agent meta sidecars),
  // exactly like the existing default-row fan-out test. clarify.meta.json has fanOut:true.
  const steps = [
    { key: 'clarify', label: 'Clarify', fanOut: true },
    { key: 'planner', label: 'Plan', fanOut: true },
    { key: 'refiner', label: 'Refine', fanOut: false },
    { key: 'implementer', label: 'Implement', fanOut: false },
    { key: 'reviewer', label: 'Review', fanOut: false },
  ];
  const MODEL = { id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['medium', 'high', 'xhigh', 'max'] };
  const { window } = await boot({ fetchHandler: (url) => {
    if (url.includes('/api/config')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        config: { steps: {}, customModels: [] },
        models: [MODEL],
        efforts: ['medium', 'high', 'xhigh', 'max'],
        steps, // top-level — app.js reads data.steps for per-step fan-out defaults
      }) });
    }
    return null; // fall through to boot()'s /api/projects + /api/workflows defaults
  } });
  const doc = window.document;
  // Load-bearing assertion: Clarify fan-out defaults ON from clarify.meta.json (fanOut:true).
  const fan = doc.querySelector('.step-fanout[data-role="clarify"]');
  assert.ok(fan, 'missing Clarify fan-out checkbox');
  assert.equal(fan.checked, true, 'Clarify fan-out must default ON (clarify.meta.json fanOut:true)');
  // Parity: the Clarify model dropdown is populated just like the other cards.
  const model = doc.querySelector('.step-model[data-role="clarify"]');
  assert.ok(model && model.options.length >= 1, 'Clarify model select not populated');
});

test('renderModelEffortPair fills a model dropdown (default + models + add) and filters efforts by model', async () => {
  const { window } = await boot();
  const doc = window.document;
  // build a bare pair of selects + caption
  const modelSel = doc.createElement('select');
  const effortSel = doc.createElement('select');
  const caption = doc.createElement('small');
  // seed app state with two models
  window.__np._setModels([
    { id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['medium', 'high', 'max'] },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] },
  ]);
  window.__np.renderModelEffortPair(modelSel, effortSel, caption, { model: 'claude-haiku-4-5', effort: 'high' });
  // model dropdown: '(default model)' + 2 models + '+ Add model…' = 4 options
  assert.equal(modelSel.options.length, 4);
  assert.equal(modelSel.value, 'claude-haiku-4-5');
  // effort dropdown filtered to Haiku's two efforts + the '(default effort)' row
  assert.deepEqual([...effortSel.options].map((o) => o.value), ['', 'medium', 'high']);
  assert.equal(effortSel.value, 'high');
  assert.match(caption.textContent, /Haiku 4\.5 · high/);
});

// A saved workflow served by the mocked API for the selector tests below.
const SAVED_WF = {
  id: 'wf_x', name: 'Demo',
  steps: [
    [{ id: 's0_0', key: 'planner' }],
    [{ id: 's1_0', key: 'implementer' }],
    [{ id: 's2_0', key: 'reviewer' }],
  ],
  feedbacks: [{ id: 'fb_0', from: 's2_0', to: 's1_0' }],
};
const AGENTS = [
  { key: 'planner', displayName: 'Plan', color: 'violet', order: 1 },
  { key: 'implementer', displayName: 'Implement', color: 'peach', order: 3 },
  { key: 'reviewer', displayName: 'Review', color: 'blue', order: 4 },
];
const MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['medium', 'high', 'max'] },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', efforts: ['medium', 'high', 'max'] },
];

function workflowFetch(extraConfig = {}) {
  return (url) => {
    if (url.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    if (url.includes('/api/workflows/wf_x')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => SAVED_WF });
    }
    if (url.includes('/api/workflows')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [{ id: 'wf_default', name: 'Default' }, SAVED_WF] }) });
    }
    if (url.includes('/api/agents')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: AGENTS }) });
    }
    if (url.includes('/api/config')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [], ...extraConfig }, models: MODELS, efforts: ['medium', 'high', 'max'] }) });
    }
    return null;
  };
}

const selectProjectAnd = (window) => {
  const s = window.document.querySelector('#projectSelect');
  s.value = PROJECT; s.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const pickWorkflow = (window, id) => {
  const s = window.document.querySelector('#workflowSelect');
  s.value = id; s.dispatchEvent(new window.Event('change', { bubbles: true }));
};

test('the workflow select is populated with Default + saved names from GET /api/workflows', async () => {
  const { window } = await boot({ fetchHandler: workflowFetch() });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  const opts = [...window.document.querySelectorAll('#workflowSelect option')].map((o) => o.textContent);
  assert.deepEqual(opts, ['Default', 'Demo']);
});

test('selecting a saved workflow renders one node row per node (keyed by node id) + one cycle input per feedback', async () => {
  const { window } = await boot({ fetchHandler: workflowFetch() });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_x');
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  // default stages hidden, dynamic containers shown
  assert.ok(doc.querySelector('#wf-default-stages').classList.contains('hidden'));
  assert.ok(!doc.querySelector('#wf-node-config').classList.contains('hidden'));
  // one model select per node, keyed by data-node-id
  const ids = [...doc.querySelectorAll('#wf-node-config .step-model')].map((s) => s.dataset.nodeId);
  assert.deepEqual(ids, ['s0_0', 's1_0', 's2_0']);
  // model dropdown is populated (default + 2 models + add)
  assert.equal(doc.querySelector('#wf-node-config .step-model[data-node-id="s1_0"]').options.length, 4);
  // one cycle input per feedback, keyed by data-fb-id, default 3
  const cyc = doc.querySelector('#wf-feedback-config input[data-fb-id="fb_0"]');
  assert.ok(cyc, 'missing cycle input for fb_0');
  assert.equal(cyc.value, '3');
});

test('selecting Default again restores the original four stage rows and hides the dynamic containers', async () => {
  const { window } = await boot({ fetchHandler: workflowFetch() });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_x');
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_default');
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  assert.ok(!doc.querySelector('#wf-default-stages').classList.contains('hidden'), 'default stages shown');
  assert.ok(doc.querySelector('#wf-node-config').classList.contains('hidden'), 'node config hidden');
  assert.ok(doc.querySelector('#wf-feedback-config').classList.contains('hidden'), 'feedback config hidden');
  // the original four role rows still render their model dropdowns
  assert.equal(doc.querySelector('.step-model[data-role="planner"]').options.length, 4);
});

test('saved run-config preselects a node\'s model+effort when the workflow is opened', async () => {
  const extra = { workflows: { wf_x: { nodes: { s1_0: { model: 'claude-opus-4-8', effort: 'high' } }, feedbacks: { fb_0: { maxCycles: 7 } } } } };
  const { window } = await boot({ fetchHandler: workflowFetch(extra) });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_x');
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  assert.equal(doc.querySelector('#wf-node-config .step-model[data-node-id="s1_0"]').value, 'claude-opus-4-8');
  assert.equal(doc.querySelector('#wf-node-config .step-effort[data-node-id="s1_0"]').value, 'high');
  assert.equal(doc.querySelector('#wf-feedback-config input[data-fb-id="fb_0"]').value, '7');
});

// Capture PATCH /api/config bodies (CONV-2) while still serving the
// workflow/agents/config GETs. Returns { window, posts } (posts = PATCH bodies).
async function bootCapturing(extraConfig = {}) {
  const posts = [];
  const base = workflowFetch(extraConfig);
  const { window } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/config') && opts && opts.method === 'PATCH') {
        posts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [], ...extraConfig } }) });
      }
      return base(url);
    },
  });
  return { window, posts };
}

test('changing a node model PATCHes { ..., nodes: { [nodeId]: { model, effort } } }', async () => {
  const { window, posts } = await bootCapturing();
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_x');
  await new Promise((r) => setTimeout(r, 0));
  const modelSel = window.document.querySelector('#wf-node-config .step-model[data-node-id="s1_0"]');
  modelSel.value = 'claude-opus-4-8';
  modelSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const body = posts.find((p) => p.nodes && p.nodes.s1_0);
  assert.ok(body, 'no PATCH captured for the node');
  assert.equal(body.projectDir, PROJECT);
  assert.equal(body.workflowId, 'wf_x');
  assert.equal(body.nodes.s1_0.model, 'claude-opus-4-8');
  assert.equal(body.nodes.s1_0.effort, ''); // new model resets effort
});

test('changing a feedback cycle count PATCHes { ..., feedbacks: { [fbId]: { maxCycles } } }', async () => {
  const { window, posts } = await bootCapturing();
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_x');
  await new Promise((r) => setTimeout(r, 0));
  const cyc = window.document.querySelector('#wf-feedback-config input[data-fb-id="fb_0"]');
  cyc.value = '4';
  cyc.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const body = posts.find((p) => p.feedbacks && p.feedbacks.fb_0);
  assert.ok(body, 'no PATCH captured for the feedback');
  assert.equal(body.workflowId, 'wf_x');
  assert.equal(body.feedbacks.fb_0.maxCycles, 4);
});

test('selecting a workflow persists it as the active workflow', async () => {
  const { window, posts } = await bootCapturing();
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_x');
  await new Promise((r) => setTimeout(r, 0));
  const body = posts.find((p) => p.activeWorkflowId === 'wf_x');
  assert.ok(body, 'active workflow not persisted');
  assert.equal(body.projectDir, PROJECT);
});

test('submitting the run posts the selected workflowId (default by default)', async () => {
  const runs = [];
  const base = workflowFetch();
  const { window } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/run') && opts && opts.method === 'POST') {
        runs.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ runId: 'r1' }) });
      }
      return base(url);
    },
  });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  // default selected
  window.document.querySelector('#prompt').value = 'do a thing';
  window.document.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].workflowId, 'wf_default');
  assert.equal(runs[0].prompt, 'do a thing');
});

test('submitting after selecting a saved workflow posts that workflowId', async () => {
  const runs = [];
  const base = workflowFetch();
  const { window } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/run') && opts && opts.method === 'POST') {
        runs.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ runId: 'r2' }) });
      }
      return base(url);
    },
  });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_x');
  await new Promise((r) => setTimeout(r, 0));
  window.document.querySelector('#prompt').value = 'ship it';
  window.document.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].workflowId, 'wf_x');
});

test('buildFeedbackRows labels a loop "<toName> ← <fromName>" resolved via the registry', async () => {
  const { window } = await boot();
  const rows = window.__np.buildFeedbackRows(WF, REGISTRY, { feedbacks: {} });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.fbId, 'fb_0');
  assert.equal(r.fromLabel, 'Review');     // s2_0 -> reviewer  -> "Review"
  assert.equal(r.toLabel, 'Implement');    // s1_0 -> implementer -> "Implement"
  assert.equal(r.selfLoop, false);
  assert.equal(r.label, 'Implement ← Review');
  assert.equal(r.maxCycles, 3);            // unset -> default 3 (unchanged)
});

test('buildFeedbackRows renders a self-loop (from === to) as "<name> ↺ (self loop)"', async () => {
  const { window } = await boot();
  const wf = {
    id: 'w',
    steps: [[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'refiner' }]],
    feedbacks: [{ id: 'fb_refine', from: 's1_0', to: 's1_0' }],
  };
  const reg = { ...REGISTRY, refiner: { key: 'refiner', displayName: 'Refine Plan', color: 'green' } };
  const rows = window.__np.buildFeedbackRows(wf, reg, { feedbacks: {} });
  assert.equal(rows[0].selfLoop, true);
  assert.equal(rows[0].label, 'Refine Plan ↺ (self loop)');
});

test('buildFeedbackRows appends "(step N)" when an endpoint agent appears more than once', async () => {
  const { window } = await boot();
  // Two implementer nodes (steps 3 & 4); loop from the later one back to the earlier one.
  const wf = {
    id: 'w',
    steps: [
      [{ id: 's0_0', key: 'planner' }],
      [{ id: 's1_0', key: 'reviewer' }],
      [{ id: 's2_0', key: 'implementer' }],
      [{ id: 's3_0', key: 'implementer' }],
    ],
    feedbacks: [{ id: 'fb_0', from: 's3_0', to: 's2_0' }],
  };
  const rows = window.__np.buildFeedbackRows(wf, REGISTRY, { feedbacks: {} });
  assert.equal(rows[0].fromLabel, 'Implement (step 4)');
  assert.equal(rows[0].toLabel, 'Implement (step 3)');
  assert.equal(rows[0].label, 'Implement (step 3) ← Implement (step 4)');
});

test('buildFeedbackRows composes the "(step N)" suffix with the self-loop wrapper', async () => {
  const { window } = await boot();
  // A duplicated agent that also feeds back to itself: suffix is computed on the
  // endpoint, THEN the self-loop wrapper is applied — both rules compose.
  const wf = {
    id: 'w',
    steps: [
      [{ id: 's0_0', key: 'reviewer' }],
      [{ id: 's1_0', key: 'reviewer' }],   // "Review" now appears twice -> ambiguous
    ],
    feedbacks: [{ id: 'fb_self', from: 's1_0', to: 's1_0' }],
  };
  const rows = window.__np.buildFeedbackRows(wf, REGISTRY, { feedbacks: {} });
  assert.equal(rows[0].selfLoop, true);
  assert.equal(rows[0].toLabel, 'Review (step 2)');
  assert.equal(rows[0].label, 'Review (step 2) ↺ (self loop)');
});

test('buildFeedbackRows falls back to the raw node id when an endpoint is unknown', async () => {
  const { window } = await boot();
  const wf = {
    id: 'w',
    steps: [[{ id: 's0_0', key: 'planner' }]],
    feedbacks: [{ id: 'fb_0', from: 's9_9', to: 's0_0' }],   // s9_9 absent from steps
  };
  const rows = window.__np.buildFeedbackRows(wf, REGISTRY, { feedbacks: {} });
  assert.equal(rows[0].fromLabel, 's9_9');   // unknown id -> raw id, never blank
  assert.equal(rows[0].toLabel, 'Plan');     // s0_0 -> planner -> "Plan"
  assert.equal(rows[0].label, 'Plan ← s9_9');
});

test('the feedback cycle input is labelled with human agent names, not raw step ids', async () => {
  const { window } = await boot({ fetchHandler: workflowFetch() });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_x');
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  const input = doc.querySelector('#wf-feedback-config input[data-fb-id="fb_0"]');
  const labelText = input.closest('.field').querySelector('label').textContent;
  assert.equal(labelText, 'Implement ← Review — max cycles');
  assert.ok(!/s\d+_\d+/.test(labelText), 'label still leaks a raw step id');
  assert.ok(!/^Loop /.test(labelText), 'label still uses the old "Loop …" prefix');
});

test('buildNodeConfigRows resolves fanOut: saved override > sidecar default > false', async () => {
  const { window } = await boot();
  const reg = {
    planner: { key: 'planner', displayName: 'Plan', color: 'violet', order: 1, fanOut: true },
    implementer: { key: 'implementer', displayName: 'Implement', color: 'peach', order: 3 },
    manualTestsChecklist: { key: 'manualTestsChecklist', displayName: 'MTC', color: 'blue', order: 5 },
    reviewer: { key: 'reviewer', displayName: 'Review', color: 'blue', order: 4 },
  };
  // No run-config => sidecar defaults (planner true, others false/absent).
  let rows = window.__np.buildNodeConfigRows(WF, reg, { nodes: {}, feedbacks: {} });
  assert.equal(rows.find((r) => r.nodeId === 's0_0').fanOut, true);
  assert.equal(rows.find((r) => r.nodeId === 's1_0').fanOut, false);
  // Saved override beats sidecar default both directions.
  rows = window.__np.buildNodeConfigRows(WF, reg, { nodes: { s0_0: { fanOut: false }, s1_0: { fanOut: true } }, feedbacks: {} });
  assert.equal(rows.find((r) => r.nodeId === 's0_0').fanOut, false);
  assert.equal(rows.find((r) => r.nodeId === 's1_0').fanOut, true);
});

test('default-row fan-out checkbox reflects the sidecar default from /api/config steps', async () => {
  const steps = [
    { key: 'planner', label: 'Plan', fanOut: true },
    { key: 'refiner', label: 'Refine', fanOut: false },
    { key: 'implementer', label: 'Implement', fanOut: false },
    { key: 'reviewer', label: 'Review', fanOut: false },
  ];
  const { window } = await boot({ fetchHandler: (url) => {
    if (url.includes('/api/config')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], steps }) });
    }
    return null;
  } });
  assert.equal(window.document.querySelector('.step-fanout[data-role="planner"]').checked, true);
  assert.equal(window.document.querySelector('.step-fanout[data-role="refiner"]').checked, false);
});

test('renderNodeRows paints an .acc swatch carrying each node color (amber Plan Review included)', async () => {
  const { window } = await boot();
  const rows = [
    { nodeId: 's0_0', key: 'planner',      label: 'Plan',        color: 'violet', stepIndex: 0, parallel: false, model: '', effort: '', fanOut: false },
    { nodeId: 's1_0', key: 'planReviewer', label: 'Plan Review', color: 'amber',  stepIndex: 1, parallel: false, model: '', effort: '', fanOut: false },
  ];
  window.__np.renderNodeRows(rows);
  const accs = [...window.document.querySelectorAll('#wf-node-config .acc')];
  assert.deepEqual(accs.map((a) => a.className), ['acc violet', 'acc amber']);
});

test('toggling a default-row fan-out checkbox POSTs the step fanOut', async () => {
  const posts = [];
  const { window } = await boot({ fetchHandler: (url, opts) => {
    if (url.includes('/api/config') && opts && opts.method === 'POST') {
      posts.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] } }) });
    }
    if (url.includes('/api/config')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], steps: [{ key: 'planner', label: 'Plan', fanOut: false }] }) });
    }
    return null;
  } });
  selectProjectAnd(window); // saveStep needs a selected project (selectedProjectPath)
  await new Promise((r) => setTimeout(r, 0));
  const cb = window.document.querySelector('.step-fanout[data-role="planner"]');
  cb.checked = true;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].step, 'planner');
  assert.equal(posts[0].fanOut, true);
});

// A transient /api/workflows failure must not silently rebuild the dropdown to
// Default-only — that would reroute the next run submit to wf_default while the
// user believes their saved workflow is active.
test('a failing GET /api/workflows keeps the dropdown entries and the active selection', async () => {
  let failList = false;
  const base = workflowFetch();
  const { window } = await boot({ fetchHandler: (url, opts) => {
    if (failList && String(url).includes('/api/workflows') && !String(url).includes('/api/workflows/')) {
      return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    }
    return base(url, opts);
  } });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_x');
  await new Promise((r) => setTimeout(r, 0));
  failList = true;
  selectProjectAnd(window); // re-entry -> loadConfig -> loadWorkflowsInto hits the failing list
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const sel = window.document.querySelector('#workflowSelect');
  const values = [...sel.options].map((o) => o.value);
  assert.ok(values.includes('wf_x'), 'saved workflow entry kept in the dropdown');
  assert.equal(sel.value, 'wf_x', 'active selection preserved');
  assert.ok(!window.document.querySelector('#wf-node-config').classList.contains('hidden'), 'node rows still rendered');
});

// An empty registry is a failed /api/agents fetch, not a real state: painting
// rows against it silently strips capability (labels degrade to raw keys, all
// questions toggles vanish). It must paint the could-not-load hint instead.
test('a failing GET /api/agents paints the could-not-load hint instead of capability-stripped rows', async () => {
  const base = workflowFetch();
  const { window } = await boot({ fetchHandler: (url, opts) => {
    if (String(url).includes('/api/agents')) {
      return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    }
    return base(url, opts);
  } });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_x');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const host = window.document.querySelector('#wf-node-config');
  assert.match(host.textContent, /Could not load this workflow/, 'hint painted');
  assert.equal(host.querySelectorAll('.step-model').length, 0, 'no capability-stripped rows');
});
