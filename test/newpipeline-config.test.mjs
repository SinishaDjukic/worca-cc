// test/newpipeline-config.test.mjs
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

// Boot app.js in jsdom with a controllable fetch. Mirrors test/ui-cost.test.mjs.
async function boot({ fetchHandler } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4319/' }));
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
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
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

test('buildNodeConfigRows (v1 steps): order, labels/colors, run-config overlay, unknown key fallback, fan-out precedence', async () => {
  const { window } = await boot();
  await checkRows([
    { name: 'buildNodeConfigRows flattens steps in order, keyed by nodeId, with registry label+color', run: () => {
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
    } },
    { name: 'buildNodeConfigRows overlays saved run-config model/effort per nodeId', run: () => {
      const rc = { nodes: { s1_0: { model: 'claude-opus-4-8', effort: 'high' }, s2_0: { model: 'claude-sonnet-4-6' } }, feedbacks: {} };
      const rows = window.__np.buildNodeConfigRows(WF, REGISTRY, rc);
      const byId = Object.fromEntries(rows.map((r) => [r.nodeId, r]));
      assert.equal(byId.s1_0.model, 'claude-opus-4-8');
      assert.equal(byId.s1_0.effort, 'high');
      assert.equal(byId.s2_0.model, 'claude-sonnet-4-6');
      assert.equal(byId.s2_0.effort, '');      // absent in run-config -> ''
      assert.equal(byId.s0_0.model, '');        // untouched node
    } },
    { name: 'buildNodeConfigRows tolerates a key missing from the registry (falls back to the key as label, no color)', run: () => {
      const wf = { id: 'w', steps: [[{ id: 'n0', key: 'ghost' }]], feedbacks: [] };
      const rows = window.__np.buildNodeConfigRows(wf, REGISTRY, { nodes: {}, feedbacks: {} });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].label, 'ghost');
      assert.equal(rows[0].color, '');
    } },
    { name: 'buildNodeConfigRows on the Default 4-step topology yields the original four rows in order', run: () => {
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
    } },
    { name: 'buildNodeConfigRows resolves fanOut: saved override > sidecar default > false', run: () => {
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
    } },
  ]);
});

import { useDomRelease } from './helpers/jsdom-release.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

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

test('selecting Default again renders the five built-in stages through the SAME accordion', async () => {
  const { window } = await boot({ fetchHandler: workflowFetch() });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_x');
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_default');
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  // The Default workflow is no longer static markup — it is rows like any other,
  // but its controls still carry the legacy per-ROLE key that saveStep writes.
  const names = [...doc.querySelectorAll('#agents-rows .agent-name')].map((n) => n.textContent);
  assert.deepEqual(names, ['Clarify', 'Plan', 'Refine', 'Implement', 'Review']);
  assert.equal(doc.querySelector('.step-model[data-role="planner"]').options.length, 4);
});

test('saved run-config preselects a node\'s model+effort and marks the row modified', async () => {
  const extra = { workflows: { wf_x: { nodes: { s1_0: { model: 'claude-opus-4-8', effort: 'high' } }, feedbacks: { fb_0: { maxCycles: 7 } } } } };
  const { window } = await boot({ fetchHandler: workflowFetch(extra) });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_x');
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  assert.equal(doc.querySelector('#agents-rows .step-model[data-node-id="s1_0"]').value, 'claude-opus-4-8');
  assert.equal(doc.querySelector('#agents-rows .step-effort[data-node-id="s1_0"]').value, 'high');
  assert.equal(doc.querySelector('#wf-feedback-config input[data-fb-id="fb_0"]').value, '7');
  // the collapsed row states the effective config, so nothing has to be opened
  assert.match(doc.querySelector('.agent-sum[data-node-id="s1_0"]').textContent, /Opus 4\.8 · high/);
  // ...and is flagged as deviating from the workflow default
  const row = doc.querySelector('.agent-row[data-node-id="s1_0"]');
  assert.ok(row.querySelector('.agent-mod'), 'modified row must carry the dot');
  assert.ok(!doc.querySelector('.agent-row[data-node-id="s0_0"] .agent-mod'), 'untouched row must not');
  assert.equal(doc.querySelector('#agentsSummary').textContent, '1 modified');
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
  const modelSel = window.document.querySelector('#agents-rows .step-model[data-node-id="s1_0"]');
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

test('submitting posts the selected workflowId (default first, then a picked saved workflow)', async () => {
  const runs = [];
  const base = workflowFetch();
  const { window } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/run') && opts && opts.method === 'POST') {
        runs.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ runId: `r${runs.length}` }) });
      }
      return base(url);
    },
  });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  await checkRows([
    { name: 'submitting the run posts the selected workflowId (default by default)', run: async () => {
      // default selected
      window.document.querySelector('#prompt').value = 'do a thing';
      window.document.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(runs.length, 1);
      assert.equal(runs[0].workflowId, 'wf_default');
      assert.equal(runs[0].prompt, 'do a thing');
    } },
    { name: 'submitting after selecting a saved workflow posts that workflowId', run: async () => {
      const before = runs.length;
      pickWorkflow(window, 'wf_x');
      await new Promise((r) => setTimeout(r, 0));
      window.document.querySelector('#prompt').value = 'ship it';
      window.document.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(runs.length, before + 1);
      assert.equal(runs[runs.length - 1].workflowId, 'wf_x');
    } },
  ]);
});

test('buildFeedbackRows (v1): "<to> ← <from>", self-loop, (step N) disambiguation incl. self-loop, raw-id fallback', async () => {
  const { window } = await boot();
  await checkRows([
    { name: 'buildFeedbackRows labels a loop "<toName> ← <fromName>" resolved via the registry', run: () => {
      const rows = window.__np.buildFeedbackRows(WF, REGISTRY, { feedbacks: {} });
      assert.equal(rows.length, 1);
      const r = rows[0];
      assert.equal(r.fbId, 'fb_0');
      assert.equal(r.fromLabel, 'Review');     // s2_0 -> reviewer  -> "Review"
      assert.equal(r.toLabel, 'Implement');    // s1_0 -> implementer -> "Implement"
      assert.equal(r.selfLoop, false);
      assert.equal(r.label, 'Implement ← Review');
      assert.equal(r.maxCycles, 3);            // unset -> default 3 (unchanged)
    } },
    { name: 'buildFeedbackRows renders a self-loop (from === to) as "<name> ↺ (self loop)"', run: () => {
      const wf = {
        id: 'w',
        steps: [[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'refiner' }]],
        feedbacks: [{ id: 'fb_refine', from: 's1_0', to: 's1_0' }],
      };
      const reg = { ...REGISTRY, refiner: { key: 'refiner', displayName: 'Refine Plan', color: 'green' } };
      const rows = window.__np.buildFeedbackRows(wf, reg, { feedbacks: {} });
      assert.equal(rows[0].selfLoop, true);
      assert.equal(rows[0].label, 'Refine Plan ↺ (self loop)');
    } },
    { name: 'buildFeedbackRows appends "(step N)" when an endpoint agent appears more than once', run: () => {
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
    } },
    { name: 'buildFeedbackRows composes the "(step N)" suffix with the self-loop wrapper', run: () => {
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
    } },
    { name: 'buildFeedbackRows falls back to the raw node id when an endpoint is unknown', run: () => {
      const wf = {
        id: 'w',
        steps: [[{ id: 's0_0', key: 'planner' }]],
        feedbacks: [{ id: 'fb_0', from: 's9_9', to: 's0_0' }],   // s9_9 absent from steps
      };
      const rows = window.__np.buildFeedbackRows(wf, REGISTRY, { feedbacks: {} });
      assert.equal(rows[0].fromLabel, 's9_9');   // unknown id -> raw id, never blank
      assert.equal(rows[0].toLabel, 'Plan');     // s0_0 -> planner -> "Plan"
      assert.equal(rows[0].label, 'Plan ← s9_9');
    } },
  ]);
});

test('default-row fan-out checkbox reflects the sidecar default from /api/config steps', async () => {
  const steps = [
    { key: 'planner', label: 'Plan', fanOut: true },
    { key: 'refiner', label: 'Refine', fanOut: false },
    { key: 'implementer', label: 'Implement', fanOut: false },
    { key: 'reviewer', label: 'Review', fanOut: false },
    { key: 'clarify', label: 'Clarify', fanOut: true },
  ];
  const { window } = await boot({ fetchHandler: (url) => {
    if (url.includes('/api/config')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], steps }) });
    }
    return null;
  } });
  assert.equal(window.document.querySelector('.step-fanout[data-role="planner"]').checked, true);
  assert.equal(window.document.querySelector('.step-fanout[data-role="refiner"]').checked, false);
  assert.equal(window.document.querySelector('.step-fanout[data-role="clarify"]').checked, true);
  const clarify = window.document.querySelector('.step-model[data-role="clarify"]');
  const planner = window.document.querySelector('.step-model[data-role="planner"]');
  assert.deepEqual([...clarify.options].map((o) => o.value), [...planner.options].map((o) => o.value));
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
  assert.ok(window.document.querySelectorAll('#agents-rows .agent-row').length > 0, 'node rows still rendered');
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
  const host = window.document.querySelector('#agents-rows');
  assert.match(host.textContent, /Could not load this workflow/, 'hint painted');
  assert.equal(host.querySelectorAll('.step-model').length, 0, 'no capability-stripped rows');
});

// ── guardrails picker (per-run model) ────────────────────────────────────────

const GR_EMPTY = { honorProjectSettings: true, envScrub: false, envAllowlist: [], protectedPaths: [], deny: [] };
const GR_SETS = [
  { id: 'permissive', name: 'Permissive', origin: 'builtin', settings: { ...GR_EMPTY } },
  { id: 'normal', name: 'Normal', origin: 'builtin',
    settings: { ...GR_EMPTY, protectedPaths: ['.env*'], deny: ['Bash(git push)', 'Bash(git push:*)'] } },
  { id: 'secure', name: 'Strict', origin: 'builtin',
    settings: { ...GR_EMPTY, envScrub: true, protectedPaths: ['.env*'], deny: ['Bash(curl:*)'] } },
  { id: 'gr_org', name: 'Org Policy', origin: null,
    settings: { ...GR_EMPTY, envScrub: true, deny: ['Bash(curl:*)', 'Bash(nc:*)'] } },
];
function guardrailsFetch(sets = GR_SETS, dflt = 'normal') {
  const base = workflowFetch();
  return (url, opts) => {
    if (url.includes('/api/guardrails')) {
      const list = typeof sets === 'function' ? sets() : sets;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ guardrails: list, default: dflt }) });
    }
    return base(url, opts);
  };
}
const pickGuardrails = (window, id) => {
  const s = window.document.querySelector('#guardrailsSelect');
  s.value = id; s.dispatchEvent(new window.Event('change', { bubbles: true }));
};

// G13: the picker starts on the install's default (GET /api/guardrails `default`) and the
// form always names its set, so an explicit Permissive pick is never read as "use the default".
for (const [dflt, label] of [['normal', 'a fresh install'], ['permissive', 'an upgraded install']]) {
  test(`default submit posts the install default (${dflt} on ${label}) and labels it in the picker`, async () => {
    const runs = [];
    const base = guardrailsFetch(GR_SETS, dflt);
    const { window } = await boot({
      fetchHandler: (url, opts) => {
        if (url.includes('/api/run') && opts && opts.method === 'POST') {
          runs.push(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ runId: 'r9' }) });
        }
        return base(url, opts);
      },
    });
    selectProjectAnd(window);
    await new Promise((r) => setTimeout(r, 0));
    const sel = window.document.querySelector('#guardrailsSelect');
    assert.equal(sel.value, dflt, 'preselected');
    assert.match(sel.selectedOptions[0].textContent, /\(default\)/);
    window.document.querySelector('#prompt').value = 'ship it';
    window.document.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(runs.length, 1);
    assert.equal(runs[0].guardrailsId, dflt);
  });
}

test('picking Permissive on a Normal-default install posts guardrailsId "permissive"', async () => {
  const runs = [];
  const base = guardrailsFetch();
  const { window } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/run') && opts && opts.method === 'POST') {
        runs.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ runId: 'r11' }) });
      }
      return base(url, opts);
    },
  });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickGuardrails(window, 'permissive');
  window.document.querySelector('#prompt').value = 'ship it';
  window.document.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(runs[0].guardrailsId, 'permissive');
});

test('picking a set posts its guardrailsId and paints the selected-set summary hint', async () => {
  const runs = [];
  const base = guardrailsFetch();
  const { window } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/run') && opts && opts.method === 'POST') {
        runs.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ runId: 'r10' }) });
      }
      return base(url, opts);
    },
  });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickGuardrails(window, 'gr_org');
  await new Promise((r) => setTimeout(r, 0));
  const hint = window.document.querySelector('#guardrailsHint').textContent;
  assert.match(hint, /2 deny · 0 paths · scrub on/, 'the SELECTED set is the whole policy — its raw counts');
  window.document.querySelector('#prompt').value = 'ship it';
  window.document.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(runs[0].guardrailsId, 'gr_org');
});

test('a failing guardrails list keeps the dropdown options and selection (never silently reroute)', async () => {
  let fail = false;
  const base = guardrailsFetch();
  const { window } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/guardrails')) {
        if (fail) return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ guardrails: GR_SETS }) });
      }
      return base(url, opts);
    },
  });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickGuardrails(window, 'secure');
  fail = true;
  selectProjectAnd(window); // project change re-runs loadConfig -> loadGuardrailsInto, which now fails
  await new Promise((r) => setTimeout(r, 0));
  const opts = [...window.document.querySelectorAll('#guardrailsSelect option')].map((o) => o.value);
  assert.ok(opts.includes('secure'), 'options kept on failure');
  assert.equal(window.document.querySelector('#guardrailsSelect').value, 'secure', 'selection kept');
});

test('a VANISHED selection falls back to the default set with a VISIBLE form message (never a silent revert)', async () => {
  let list = GR_SETS;
  const { window } = await boot({ fetchHandler: guardrailsFetch(() => list) });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickGuardrails(window, 'gr_org');
  // The set is deleted server-side; the next repopulation no longer lists it.
  list = GR_SETS.filter((g) => g.id !== 'gr_org');
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(window.document.querySelector('#guardrailsSelect').value, 'normal', 'fell back to the default');
  assert.match(window.document.querySelector('#form-msg').textContent, /no longer exists/, 'said out loud');
});

// Review of PR #376: populateBranchSelect had three un-guarded callers (project
// change, target change, prefill) and whichever /api/branches response resolved
// LAST rebuilt the options — wiping the source branch the prefill had just set.
test('branch select: a slower, older /api/branches response cannot overwrite a newer one', async () => {
  let releaseA = null;
  const branches = (list, current) => ({ ok: true, status: 200, json: async () => ({ branches: list, current }) });
  const { window } = await boot({ fetchHandler: (url) => {
    if (url.includes('/api/branches') && url.includes('projA')) return new Promise((r) => { releaseA = () => r(branches(['main', 'a-only'], 'main')); });
    if (url.includes('/api/branches') && url.includes('projB')) return Promise.resolve(branches(['main', 'b-only'], 'b-only'));
    if (url.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'projA', path: '/tmp/projA', exists: true }, { name: 'projB', path: '/tmp/projB', exists: true }] }) });
    return null;
  } });
  const doc = window.document;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 5; i++) await tick();
  const sel = [...doc.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === '/tmp/projA'));
  assert.ok(sel, 'the project select lists both projects');
  const branchSel = doc.getElementById('sourceBranch');
  const values = () => [...branchSel.options].map((o) => o.value);
  sel.value = '/tmp/projA'; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  for (let i = 0; i < 3; i++) await tick();
  assert.ok(releaseA, 'A is in flight');
  sel.value = '/tmp/projB'; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  for (let i = 0; i < 5; i++) await tick();
  assert.ok(values().includes('b-only'), `B's branches landed: ${values()}`);
  releaseA();                                            // the stale response for A
  for (let i = 0; i < 5; i++) await tick();
  assert.ok(values().includes('b-only') && !values().includes('a-only'), `the stale A response lost: ${values()}`);
});

// ── v2 graph workflows in the New-Pipeline panel ─────────────────────────────
// Every stored template is a version-2 graph now (P8 retired v1), so the panel's
// fetch wrapper, its node rows and its cycle inputs must all speak `nodes`/`wires`.

const V2_AGENTS = [
  { key: 'planner', displayName: 'Plan', color: 'violet', order: 1,
    inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  { key: 'implementer', displayName: 'Implement', color: 'peach', order: 3,
    inputs: [{ id: 'fix', type: 'md', required: false, loop: true },
      { id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'done', type: 'void', when: 'always' }] },
  { key: 'reviewer', displayName: 'Review', color: 'blue', order: 4,
    inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'done', type: 'void', required: false }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
];

const graphOf = (id, name) => ({
  id, name, version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 280, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 560, y: 0, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 840, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 1120, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w5', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w6', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
});
const SAVED_V2 = graphOf('wf_g', 'Graph');
const DEFAULT_V2 = graphOf('wf_default', 'Default');

function v2Fetch(extraConfig = {}) {
  return (url) => {
    if (url.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    if (url.includes('/api/workflows/wf_g')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => SAVED_V2 });
    }
    if (url.includes('/api/workflows/wf_default')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => DEFAULT_V2 });
    }
    if (url.includes('/api/workflows')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [DEFAULT_V2, SAVED_V2] }) });
    }
    if (url.includes('/api/agents')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: V2_AGENTS }) });
    }
    if (url.includes('/api/config')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [], ...extraConfig }, models: MODELS, efforts: ['medium', 'high', 'max'] }) });
    }
    return null;
  };
}

// The bug: getWorkflowApi kept the v1 shape guard (`Array.isArray(data.steps)`),
// so every saved graph — which carries nodes/wires and no steps — resolved to
// null and painted "Could not load this workflow."
test('selecting a saved v2 graph renders one row per agent node, not the could-not-load hint', async () => {
  const { window } = await boot({ fetchHandler: v2Fetch() });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_g');
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  const host = window.document.querySelector('#agents-rows');
  assert.doesNotMatch(host.textContent, /Could not load this workflow/, 'no hint');
  const ids = [...host.querySelectorAll('.agent-row')].map((r) => r.dataset.nodeId);
  assert.deepEqual(ids, ['n_plan', 'n_impl', 'n_review'], 'agent nodes only, in launch order');
});

// The cycle inputs are driven by classifyLoops, which needs the agents' PORTS.
// The panel must source them itself: the Composer's registry is only populated
// when that view has been opened.
test('a v2 loop wire gets its cycle input without the Composer ever loading', async () => {
  const { window } = await boot({ fetchHandler: v2Fetch() });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_g');
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  const fb = window.document.querySelector('#wf-feedback-config');
  const inputs = [...fb.querySelectorAll('input[data-fb-id]')];
  assert.deepEqual(inputs.map((i) => i.dataset.fbId), ['w5'], 'the review -> fix loop wire');
  assert.equal(fb.dataset.graph, '1', 'stamped as a graph row set (writes go to wires:{})');
});

// wf_default is a v2 graph too, and resolveGraph still layers the legacy
// per-ROLE config under the per-node one. The rows must read the same layers,
// or the panel shows "inherit" for a model the run actually uses.
test('the built-in Default paints its real graph nodes and layers the legacy per-role config', async () => {
  const { window } = await boot({ fetchHandler: v2Fetch({ steps: { planner: { model: 'claude-opus-4-8', effort: 'high' } } }) });
  selectProjectAnd(window);
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  const host = window.document.querySelector('#agents-rows');
  const ids = [...host.querySelectorAll('.agent-row')].map((r) => r.dataset.nodeId);
  assert.deepEqual(ids, ['n_plan', 'n_impl', 'n_review'], 'the served graph, not the v1 fallback');
  const rows = window.__np.buildNodeConfigRows(DEFAULT_V2, Object.fromEntries(V2_AGENTS.map((a) => [a.key, a])),
    { nodes: {}, wires: {} }, { legacySteps: { planner: { model: 'claude-opus-4-8', effort: 'high' } } });
  const plan = rows.find((r) => r.nodeId === 'n_plan');
  assert.equal(plan.model, 'claude-opus-4-8', 'legacy per-role model is the effective value');
  assert.equal(plan.effort, 'high');
});

// A loop wire is one whose SOURCE output is `when: 'blocking'` (classifyLoops), so a loop that STARTS at a
// script card — a test gate sending its failures back to the implementer — needs the script registry as
// well as the agents' (spec §8.4: the panel fetches /api/agents and /api/scripts together). Cold page: the
// Composer, whose index would otherwise be the fallback, never loaded.
const GATE_SCRIPT = {
  key: 'runTests', displayName: 'Run tests', runtime: 'node', color: 'violet', verdict: { filename: 'tests-cycle{cycle}.json' },
  inputs: [{ id: 'done', type: 'void', required: false }],
  outputs: [{ id: 'fail', type: 'md', when: 'blocking', filename: 'tests-cycle{cycle}.md' }, { id: 'pass', type: 'void', when: 'clean' }],
};
const GATE_V2 = {
  id: 'wf_tests', name: 'Test gate', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 280, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 560, y: 0, config: {} },
    { id: 'n_tests', kind: 'script', key: 'runTests', x: 840, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 1120, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_tests', port: 'done' } },
    { id: 'w4', from: { node: 'n_tests', port: 'fail' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 5 } },
    { id: 'w5', from: { node: 'n_tests', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};
function gateFetch(scriptsReply) {
  const base = v2Fetch();
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  return (url) => {
    if (url.includes('/api/scripts')) return scriptsReply();
    if (url.includes('/api/workflows/wf_tests')) return ok(GATE_V2);
    if (url.includes('/api/workflows/')) return base(url);
    if (url.includes('/api/workflows')) return ok({ workflows: [DEFAULT_V2, SAVED_V2, GATE_V2] });
    return base(url);
  };
}

test('a loop wire that starts at a SCRIPT card gets its cycle input on a cold page, named from the script registry', async () => {
  const { window } = await boot({ fetchHandler: gateFetch(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ scripts: [GATE_SCRIPT] }) })) });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_tests');
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  const fb = window.document.querySelector('#wf-feedback-config');
  const inputs = [...fb.querySelectorAll('input[data-fb-id]')];
  assert.deepEqual(inputs.map((i) => [i.dataset.fbId, i.value]), [['w4', '5']], 'the tests -> fix loop wire, with the template budget');
  assert.match(fb.textContent, /Implement ← Run tests/, 'the script end is named by its registry name, not its key');
  const ids = [...window.document.querySelectorAll('#agents-rows .agent-row')].map((r) => r.dataset.nodeId);
  assert.deepEqual(ids, ['n_plan', 'n_impl'], 'a script card has no per-project tunables: agent rows only');
  // The pure builder takes the scripts explicitly (a list or a key -> meta index); without them the wire is not a loop.
  const reg = Object.fromEntries(V2_AGENTS.map((a) => [a.key, a]));
  assert.deepEqual(window.__np.buildFeedbackRows(GATE_V2, reg, {}, [GATE_SCRIPT]).map((r) => [r.fbId, r.label, r.maxCycles]), [['w4', 'Implement ← Run tests', 5]]);
  assert.deepEqual(window.__np.buildFeedbackRows(GATE_V2, reg, { wires: { w4: { maxCycles: 2 } } }, { runTests: GATE_SCRIPT }).map((r) => r.maxCycles), [2]);
});

test('a failed /api/scripts fetch degrades to agent-only loop rows instead of breaking the panel', async () => {
  const { window } = await boot({ fetchHandler: gateFetch(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })) });
  selectProjectAnd(window);
  await new Promise((r) => setTimeout(r, 0));
  pickWorkflow(window, 'wf_g');
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  const fb = window.document.querySelector('#wf-feedback-config');
  assert.deepEqual([...fb.querySelectorAll('input[data-fb-id]')].map((i) => i.dataset.fbId), ['w5'], 'the agent loop still paints');
  assert.doesNotMatch(window.document.querySelector('#agents-rows').textContent, /Could not load this workflow/);
});

// Settings › Memory: a pinned row (node-tunables.mjs `pinned`) shows the pair and locks model +
// effort — through setAgentRowsEnabled(true) too, which re-enables every other control.
test('a pinned agent row keeps its model and effort locked through a re-enable; the other tunables stay live', async () => {
  const { window } = await boot();
  window.__np._setModels([{ id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] }]);
  const def = { model: 'claude-haiku-4-5', effort: 'high', fanOut: false, askQuestions: false, subagentModel: '' };
  window.__np.renderAgentRows([{ nodeId: 'n_defrag', key: 'memoryDefragmenter', label: 'Memory defragmenter', color: '', stepIndex: 1, parallel: false,
    model: 'claude-haiku-4-5', effort: 'high', fanOut: false, subagentModel: '', askQuestions: null, def, override: {}, modified: false, pinned: 'settings' }]);
  window.__np.setAgentRowsEnabled(false);
  window.__np.setAgentRowsEnabled(true);
  const doc = window.document;
  const model = doc.querySelector('#agents-rows .step-model');
  const effort = doc.querySelector('#agents-rows .step-effort');
  assert.deepEqual([model.value, effort.value], ['claude-haiku-4-5', 'high']);
  assert.equal(model.disabled, true, 'model locked after the re-enable');
  assert.equal(effort.disabled, true, 'effort locked after the re-enable');
  assert.equal(doc.querySelector('#agents-rows .step-fanout').disabled, false, 'fan-out stays editable');
  assert.match(doc.querySelector('#agents-rows .agent-origin').textContent, /^Set in Settings › Memory/);
});
