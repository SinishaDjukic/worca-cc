// test/ui-agents-accordion.test.mjs — the New-Pipeline agents accordion
// (newpipeline-ux-design.md §4.2-§4.6): four-layer resolution, the modified
// marker, prune-on-save, the Reset / Save-as-defaults actions, and the Advanced
// disclosure that must never hide active state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

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

const tick = () => new Promise((r) => setTimeout(r, 0));
const selectProjectAnd = (window) => {
  const s = window.document.querySelector('#projectSelect');
  s.value = PROJECT; s.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const pickWorkflow = (window, id) => {
  const s = window.document.querySelector('#workflowSelect');
  s.value = id; s.dispatchEvent(new window.Event('change', { bubbles: true }));
};

const MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['medium', 'high', 'max'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] },
];
const AGENTS = [
  { key: 'planner', displayName: 'Plan', color: 'violet', fanOut: false, asksQuestions: true, questionsDefault: false },
  { key: 'reviewer', displayName: 'Review', color: 'blue', fanOut: false },
];
// A saved workflow whose planner node ships a tuned default.
const WF_TUNED = {
  id: 'wf_t', name: 'Tuned',
  steps: [
    [{ id: 'n0', key: 'planner', defaults: { model: 'claude-opus-4-8', effort: 'high', fanOut: true } }],
    [{ id: 'n1', key: 'reviewer' }],
  ],
  feedbacks: [],
};

// A stateful stand-in for the config API: writes actually land, so a re-render
// after a save sees what was stored — the mock must not paper over a value the
// real server would have kept (or dropped). Mirrors config.mjs's semantics:
// model/effort replace, a boolean toggle sets, null clears, absent preserves,
// and a selection with nothing left in it deletes the node entry.
function apiFetch({ config = {}, workflow = WF_TUNED, sink } = {}) {
  const cfg = { steps: {}, customModels: [], workflows: {}, ...JSON.parse(JSON.stringify(config)) };
  const applyToggle = (target, key, next) => {
    if (typeof next === 'boolean') target[key] = next;
    else if (next === null) delete target[key];
  };
  return (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    if (sink && method !== 'GET') sink.push({ url, method, body });

    if (url.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    if (url.includes(`/api/workflows/${workflow.id}/defaults`)) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflow, defaults: {} }) });
    }
    if (url.includes(`/api/workflows/${workflow.id}`)) {
      return Promise.resolve({ ok: true, status: 200, json: async () => workflow });
    }
    if (url.includes('/api/workflows')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: workflow.id, name: workflow.name }] }) });
    }
    if (url.includes('/api/agents')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: AGENTS }) });
    }
    if (url.includes('/api/config/workflow')) {
      const wfId = /workflowId=([^&]+)/.exec(url);
      if (wfId) { delete cfg.workflows[decodeURIComponent(wfId[1])]; if (decodeURIComponent(wfId[1]) === 'wf_default') cfg.steps = {}; }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: cfg }) });
    }
    if (url.includes('/api/config')) {
      if (method === 'PATCH' && body && body.nodes) {
        const wf = (cfg.workflows[body.workflowId] ||= { nodes: {}, feedbacks: {} });
        for (const [nodeId, sel] of Object.entries(body.nodes)) {
          const entry = { ...wf.nodes[nodeId] };
          if (sel.model) entry.model = sel.model; else delete entry.model;
          if (sel.effort) entry.effort = sel.effort; else delete entry.effort;
          applyToggle(entry, 'fanOut', sel.fanOut);
          applyToggle(entry, 'askQuestions', sel.askQuestions);
          if (Object.keys(entry).length) wf.nodes[nodeId] = entry; else delete wf.nodes[nodeId];
        }
      }
      if (method === 'POST' && body && body.step) {
        const entry = { ...cfg.steps[body.step] };
        if (body.model) entry.model = body.model; else delete entry.model;
        if (body.effort) entry.effort = body.effort; else delete entry.effort;
        applyToggle(entry, 'fanOut', body.fanOut);
        applyToggle(entry, 'askQuestions', body.askQuestions);
        if (Object.keys(entry).length) cfg.steps[body.step] = entry; else delete cfg.steps[body.step];
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        config: cfg, models: MODELS, efforts: ['medium', 'high', 'max'],
      }) });
    }
    return null;
  };
}

const openTuned = async (window) => {
  selectProjectAnd(window);
  await tick();
  pickWorkflow(window, 'wf_t');
  await tick(); await tick();
};

// ── resolution + the modified marker ────────────────────────────────────────

test('a workflow default is shown as the row\'s effective config, and does NOT count as modified', async () => {
  const { window } = await boot({ fetchHandler: apiFetch() });
  await openTuned(window);
  const doc = window.document;
  assert.match(doc.querySelector('.agent-sum[data-node-id="n0"]').textContent, /Opus 4\.8 · high · fan-out/);
  assert.equal(doc.querySelector('.agent-row[data-node-id="n0"] .agent-mod'), null, 'a default is not a modification');
  assert.equal(doc.querySelector('#agentsSummary').textContent, 'all defaults');
  // ...and the controls inside the row are pre-filled with it.
  assert.equal(doc.querySelector('.step-model[data-node-id="n0"]').value, 'claude-opus-4-8');
  assert.equal(doc.querySelector('.step-fanout[data-node-id="n0"]').checked, true);
});

test('an override on top of a workflow default marks the row and counts in the header', async () => {
  const config = { workflows: { wf_t: { nodes: { n0: { model: 'claude-haiku-4-5' } }, feedbacks: {} } } };
  const { window } = await boot({ fetchHandler: apiFetch({ config }) });
  await openTuned(window);
  const doc = window.document;
  assert.match(doc.querySelector('.agent-sum[data-node-id="n0"]').textContent, /Haiku 4\.5/);
  assert.ok(doc.querySelector('.agent-row[data-node-id="n0"] .agent-mod'), 'overridden row carries the dot');
  assert.equal(doc.querySelector('#agentsSummary').textContent, '1 modified');
  assert.equal(doc.querySelector('#agentsReset').hidden, false, 'Reset appears only when it would do something');
  assert.equal(doc.querySelector('#agentsPromote').hidden, false);
});

test('buildNodeConfigRows resolves the four layers and reports def/override separately', async () => {
  const { window } = await boot();
  const reg = Object.fromEntries(AGENTS.map((a) => [a.key, a]));
  const rows = window.__np.buildNodeConfigRows(WF_TUNED, reg, { nodes: { n1: { fanOut: true } }, feedbacks: {} });
  const [n0, n1] = rows;
  // n0: workflow default, untouched by the project.
  assert.deepEqual(n0.def, { model: 'claude-opus-4-8', effort: 'high', fanOut: true, askQuestions: false });
  assert.deepEqual(n0.override, {});
  assert.equal(n0.modified, false);
  // n1: no workflow default, so the registry supplies fanOut:false — overridden.
  assert.deepEqual(n1.def, { model: '', effort: '', fanOut: false, askQuestions: false });
  assert.deepEqual(n1.override, { fanOut: true });
  assert.equal(n1.modified, true);
});

test('agentSummaryText and agentsHeaderText phrase the collapsed state', async () => {
  const { window } = await boot();
  const { agentSummaryText, agentsHeaderText } = window.__np;
  window.__np._setModels(MODELS);
  assert.equal(agentSummaryText({ model: '', effort: '', fanOut: false, askQuestions: false }), 'default');
  assert.equal(agentSummaryText({ model: '', effort: '', fanOut: true, askQuestions: false }), 'default · fan-out');
  assert.equal(agentSummaryText({ model: 'claude-opus-4-8', effort: '', fanOut: false }), 'Opus 4.8 · default effort');
  assert.equal(agentSummaryText({ model: 'claude-opus-4-8', effort: 'max', fanOut: true, askQuestions: true }),
    'Opus 4.8 · max · fan-out · questions');
  assert.equal(agentsHeaderText([{ modified: false }, { modified: false }]), 'all defaults');
  assert.equal(agentsHeaderText([{ modified: true }, { modified: false }]), '1 modified');
  assert.equal(agentsHeaderText([{ modified: true }, { modified: true }]), '2 modified');
});

// ── prune-on-save (§4.5) ────────────────────────────────────────────────────

test('pruneNodeSelection stores a deviation and clears anything equal to the default', async () => {
  const { window } = await boot();
  const { pruneNodeSelection } = window.__np;
  const row = {
    model: 'claude-opus-4-8', effort: 'high', fanOut: true, askQuestions: false,
    questionsLocked: false,
    def: { model: 'claude-opus-4-8', effort: 'high', fanOut: true, askQuestions: false },
  };
  // Nothing changed -> everything inherits.
  assert.deepEqual(pruneNodeSelection(row, {}),
    { model: '', effort: '', fanOut: null, askQuestions: null });
  // A different model is stored; so is its (default-matching) effort, because an
  // effort is only interpretable next to the model that advertises it.
  assert.deepEqual(pruneNodeSelection(row, { model: 'claude-haiku-4-5' }),
    { model: 'claude-haiku-4-5', effort: 'high', fanOut: null, askQuestions: null });
  // Changing only the effort still pins the model alongside it.
  assert.deepEqual(pruneNodeSelection(row, { effort: 'max' }),
    { model: 'claude-opus-4-8', effort: 'max', fanOut: null, askQuestions: null });
  // A toggle that deviates is stored as a boolean.
  assert.deepEqual(pruneNodeSelection(row, { fanOut: false }),
    { model: '', effort: '', fanOut: false, askQuestions: null });
});

test('pruneNodeSelection never persists a value for an absent or locked questions toggle', async () => {
  const { window } = await boot();
  const { pruneNodeSelection } = window.__np;
  const def = { model: '', effort: '', fanOut: false, askQuestions: true };
  assert.equal(pruneNodeSelection({ model: '', effort: '', fanOut: false, askQuestions: null, def }, {}).askQuestions, undefined);
  assert.equal(pruneNodeSelection({ model: '', effort: '', fanOut: false, askQuestions: true, questionsLocked: true, def }, {}).askQuestions, undefined);
});

test('re-picking the workflow default clears the override instead of storing it again', async () => {
  const sink = [];
  const config = { workflows: { wf_t: { nodes: { n0: { model: 'claude-haiku-4-5' } }, feedbacks: {} } } };
  const { window } = await boot({ fetchHandler: apiFetch({ config, sink }) });
  await openTuned(window);
  const doc = window.document;

  // Step 1: back to the default's model. Picking a model resets the effort, so
  // Opus·(default effort) is still a real deviation from the default Opus·high
  // — and is therefore stored, not swallowed.
  const sel = doc.querySelector('.step-model[data-node-id="n0"]');
  sel.value = 'claude-opus-4-8';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(); await tick();
  let patch = sink.filter((c) => c.method === 'PATCH' && c.body && c.body.nodes).pop();
  assert.equal(patch.body.nodes.n0.model, 'claude-opus-4-8');
  assert.equal(patch.body.nodes.n0.effort, '', 'a new model resets the effort it no longer qualifies');

  // Step 2: restore the default's effort too. Now the pair matches the workflow
  // default exactly and the whole override is dropped.
  const eff = doc.querySelector('.step-effort[data-node-id="n0"]');
  eff.value = 'high';
  eff.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(); await tick();
  patch = sink.filter((c) => c.method === 'PATCH' && c.body && c.body.nodes).pop();
  assert.equal(patch.body.nodes.n0.model, '', 'stored as inherit, not as a redundant copy of the default');
  assert.equal(patch.body.nodes.n0.effort, '');
});

// ── header actions ──────────────────────────────────────────────────────────

test('Reset DELETEs the workflow\'s overrides for this project', async () => {
  const sink = [];
  const config = { workflows: { wf_t: { nodes: { n0: { model: 'claude-haiku-4-5' } }, feedbacks: {} } } };
  const { window } = await boot({ fetchHandler: apiFetch({ config, sink }) });
  await openTuned(window);
  window.document.querySelector('#agentsReset').dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick(); await tick();
  const del = sink.find((c) => c.method === 'DELETE');
  assert.ok(del, 'no DELETE fired');
  assert.match(del.url, /\/api\/config\/workflow\?/);
  assert.match(del.url, /workflowId=wf_t/);
  assert.match(del.url, new RegExp(`projectDir=${encodeURIComponent(PROJECT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('Save-as-defaults PATCHes every row\'s effective config onto the workflow, then resets', async () => {
  const sink = [];
  const config = { workflows: { wf_t: { nodes: { n0: { model: 'claude-haiku-4-5', effort: 'high' } }, feedbacks: {} } } };
  const { window } = await boot({ fetchHandler: apiFetch({ config, sink }) });
  await openTuned(window);
  window.document.querySelector('#agentsPromote').dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick(); await tick(); await tick();
  const promo = sink.find((c) => c.method === 'PATCH' && /\/defaults$/.test(c.url));
  assert.ok(promo, 'no defaults PATCH fired');
  // The overridden row promotes what it actually shows...
  assert.deepEqual(promo.body.defaults.n0, { model: 'claude-haiku-4-5', effort: 'high', fanOut: true, askQuestions: false });
  // ...and an untouched row promotes its own resolved value, so the workflow
  // ends up describing exactly the pipeline the user was about to run.
  assert.deepEqual(promo.body.defaults.n1, { fanOut: false });
  // Promotion is only half the job: the now-redundant overrides are cleared.
  assert.ok(sink.some((c) => c.method === 'DELETE' && c.url.includes('/api/config/workflow')), 'overrides not cleared');
});

test('the built-in Default workflow cannot promote defaults (it has no row to store them)', async () => {
  const config = { steps: { planner: { model: 'claude-opus-4-8' } } };
  const { window } = await boot({ fetchHandler: apiFetch({ config }) });
  selectProjectAnd(window);
  await tick(); await tick();
  const doc = window.document;
  assert.equal(doc.querySelector('#agentsSummary').textContent, '1 modified', 'legacy per-role config still reads as an override');
  assert.equal(doc.querySelector('#agentsReset').hidden, false, 'but it CAN be reset');
  assert.equal(doc.querySelector('#agentsPromote').hidden, true, 'promote stays hidden for wf_default');
});

// ── the accordion keeps its state across a save ─────────────────────────────

test('an open row stays open after a value is saved and the rows are repainted', async () => {
  const { window } = await boot({ fetchHandler: apiFetch() });
  await openTuned(window);
  const doc = window.document;
  doc.querySelector('.agent-row-head[data-node-id="n0"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(doc.querySelector('#agent-body-n0').hidden, false);
  const fan = doc.querySelector('.step-fanout[data-node-id="n0"]');
  fan.checked = false;
  fan.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(); await tick();
  assert.equal(doc.querySelector('#agent-body-n0').hidden, false, 'the row must not slam shut under the user');
  assert.equal(doc.querySelector('.agent-row-head[data-node-id="n0"]').getAttribute('aria-expanded'), 'true');
});

test('the collapsed caption follows the controls immediately, without waiting for the save', async () => {
  // Deliberately never resolve the write: the head must already be correct.
  const { window } = await boot({ fetchHandler: (url, opts) => {
    if (url.includes('/api/config') && opts && opts.method) return new Promise(() => {});
    return apiFetch()(url, opts);
  } });
  await openTuned(window);
  const doc = window.document;
  doc.querySelector('.agent-row-head[data-node-id="n0"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const fan = doc.querySelector('.step-fanout[data-node-id="n0"]');
  fan.checked = false;
  fan.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(doc.querySelector('.agent-sum[data-node-id="n0"]').textContent, 'Opus 4.8 · high',
    'the head drops "fan-out" as soon as the box is unticked');
});

// ── no project selected: read-only, and it SAYS so ──────────────────────────
// Per-agent config is stored per project. With none selected the save no-ops
// and the re-render undoes the edit — which reads as "this control is broken".

test('with no project the accordion renders but every control is disabled, and the header says why', async () => {
  const { window } = await boot({ fetchHandler: apiFetch() });
  await tick(); await tick(); // no selectProjectAnd: this IS the empty state
  const doc = window.document;
  assert.ok(doc.querySelectorAll('#agents-rows .agent-row').length > 0, 'rows still render — seeing the plan is useful');
  assert.equal(doc.querySelector('#agentsSummary').textContent, 'select a project to change these');
  for (const sel of ['.step-model', '.step-effort', '.step-fanout', '.step-questions']) {
    const c = doc.querySelector(`#agents-rows ${sel}`);
    if (c) assert.equal(c.disabled, true, `${sel} must be disabled without a project`);
  }
  // The two header actions would have nothing to act on.
  assert.equal(doc.querySelector('#agentsReset').hidden, true);
  assert.equal(doc.querySelector('#agentsPromote').hidden, true);
});

test('an edit that reaches the save without a project reports it instead of silently reverting', async () => {
  const { window } = await boot({ fetchHandler: apiFetch() });
  await tick(); await tick();
  const doc = window.document;
  const row = window.__np.buildNodeConfigRows(WF_TUNED, Object.fromEntries(AGENTS.map((a) => [a.key, a])),
    { nodes: {}, feedbacks: {} })[0];
  await window.__np.saveAgentRow(row, { fanOut: false });
  assert.match(doc.querySelector('#form-msg').textContent, /Select a project first/,
    'a silent no-op is what made the control look broken');
});

test('selecting a project re-enables the controls', async () => {
  const { window } = await boot({ fetchHandler: apiFetch() });
  await tick(); await tick();
  const doc = window.document;
  assert.equal(doc.querySelector('#agents-rows .step-model').disabled, true, 'precondition: disabled');
  await openTuned(window);
  assert.equal(doc.querySelector('.step-model[data-node-id="n0"]').disabled, false);
  assert.equal(doc.querySelector('.step-fanout[data-node-id="n0"]').disabled, false);
  assert.notEqual(doc.querySelector('#agentsSummary').textContent, 'select a project to change these');
});

test('re-enabling the accordion never un-locks an agent whose questions are fixed', async () => {
  const { window } = await boot();
  const doc = window.document;
  const def = { model: '', effort: '', fanOut: false, askQuestions: true };
  window.__np.renderAgentRows([
    { nodeId: 'free', key: 'ask', label: 'Ask', color: '', stepIndex: 0, parallel: false,
      model: '', effort: '', fanOut: false, askQuestions: false, questionsLocked: false, def, override: {} },
    { nodeId: 'lockd', key: 'locked', label: 'Locked', color: '', stepIndex: 1, parallel: false,
      model: '', effort: '', fanOut: false, askQuestions: true, questionsLocked: true, def, override: {} },
  ]);
  window.__np.setAgentRowsEnabled(false);
  assert.equal(doc.querySelector('.step-questions[data-node-id="free"]').disabled, true);
  window.__np.setAgentRowsEnabled(true);
  assert.equal(doc.querySelector('.step-questions[data-node-id="free"]').disabled, false, 'the editable one comes back');
  assert.equal(doc.querySelector('.step-questions[data-node-id="lockd"]').disabled, true,
    'the manifest-locked one must stay locked');
});

test('effort explains its dependency on the model instead of just greying out', async () => {
  const { window } = await boot();
  const doc = window.document;
  const modelSel = doc.createElement('select');
  const effortSel = doc.createElement('select');
  window.__np._setModels(MODELS);

  window.__np.renderModelEffortPair(modelSel, effortSel, null, {});
  assert.equal(effortSel.disabled, true, 'no model -> no effort list to offer');
  assert.equal(effortSel.options[0].textContent, '(pick a model first)');
  assert.match(effortSel.title, /Pick a model first/);

  window.__np.renderModelEffortPair(modelSel, effortSel, null, { model: 'claude-opus-4-8' });
  assert.equal(effortSel.disabled, false);
  assert.equal(effortSel.options[0].textContent, '(default effort)');
  assert.equal(effortSel.title, '', 'no explanation needed once it works');
});

// ── Advanced disclosure (§4.6) ──────────────────────────────────────────────

// ── agents live under Advanced, and say which workflow they belong to ───────

test('the agents accordion sits inside Advanced, while the workflow picker stays out', async () => {
  const { window } = await boot();
  const doc = window.document;
  const adv = doc.querySelector('#advanced-config');
  assert.ok(adv.contains(doc.querySelector('#agents-config')), 'the accordion belongs to Advanced');
  assert.ok(adv.contains(doc.querySelector('#wf-feedback-config')), 'so do the feedback loops');
  // Choosing a workflow is a run decision; tuning its agents is not.
  assert.ok(!adv.contains(doc.querySelector('#workflowSelect')), 'the picker must stay in the main column');
});

test('the agents header names the workflow the rows come from', async () => {
  const { window } = await boot({ fetchHandler: apiFetch() });
  await openTuned(window);
  const doc = window.document;
  assert.equal(doc.querySelector('#agentsWorkflow').textContent, 'Tuned',
    'with the picker elsewhere, the header must say which workflow these are');
  pickWorkflow(window, 'wf_default');
  await tick(); await tick();
  assert.equal(doc.querySelector('#agentsWorkflow').textContent, 'Default', 'and follow the selection');
});

test('Advanced stays collapsed even when an agent is modified', async () => {
  const config = { workflows: { wf_t: { nodes: { n0: { model: 'claude-haiku-4-5' } }, feedbacks: {} } } };
  const { window } = await boot({ fetchHandler: apiFetch({ config }) });
  const doc = window.document;
  await openTuned(window);
  assert.ok(doc.querySelector('.agent-mod'), 'precondition: a row is modified');
  assert.equal(doc.querySelector('#advanced-config').open, false,
    'the section never opens itself — the accordion states the override once you open it');
});

// The hint reports that the model catalog and saved agent config could not be
// read. Advanced never opens itself, so the hint cannot live inside it.
test('a config-load failure is reported in the main column, not inside Advanced', async () => {
  const { window } = await boot({ fetchHandler: (url, opts) => {
    if (url.includes('/api/config') && (!opts || !opts.method || opts.method === 'GET')) {
      return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    }
    return null;
  } });
  selectProjectAnd(window);
  await tick(); await tick();
  const doc = window.document;
  const hint = doc.querySelector('#config-error');
  assert.equal(hint.hidden, false, 'the hint is painted');
  assert.match(hint.textContent, /boom/);
  assert.ok(!doc.querySelector('#advanced-config').contains(hint), 'it must not be buried in a collapsed section');
});

test('Advanced holds only the set-and-forget settings; the often-used fields are promoted', async () => {
  const { window } = await boot();
  const doc = window.document;
  const details = doc.querySelector('#advanced-config');
  assert.ok(details, 'missing the Advanced disclosure');
  assert.equal(details.open, false, 'Advanced must start collapsed');
  for (const id of ['agents-config', 'guardrailsSelect', 'mock']) {
    assert.ok(details.querySelector(`#${id}`), `#${id} must live inside Advanced`);
  }
  // Title, the branch pair and extra files are edited often enough to earn a
  // place in the main column — burying them behind a disclosure was the bug.
  for (const id of ['title', 'sourceBranch', 'featureBranch', 'extras']) {
    assert.ok(doc.querySelector(`#${id}`), `#${id} must exist`);
    assert.ok(!details.contains(doc.querySelector(`#${id}`)), `#${id} must NOT be inside Advanced`);
  }
});

test('the target switch shares one row with the picker it selects', async () => {
  const { window } = await boot();
  const doc = window.document;
  const row = doc.querySelector('#target-seg').closest('.split-row');
  assert.ok(row, 'missing the target row');
  // Both panes live in the SECOND cell, so flipping the switch swaps the picker
  // without the switch itself moving.
  const panes = row.querySelector('.target-panes');
  assert.ok(panes, 'missing the panes cell');
  for (const id of ['target-project-pane', 'target-workspace-pane']) {
    assert.ok(panes.querySelector(`#${id}`), `#${id} must sit in the panes cell`);
  }
  assert.equal(doc.querySelector('#target-workspace-pane').classList.contains('hidden'), true,
    'workspace pane starts hidden');
});

// Flipping the target must not relayout the form below it. jsdom has no layout
// engine, so pin the two things that made the workspace pane taller than the
// project pane: a second hint line, and an empty flex container still holding
// its 10px top margin.
test('the workspace pane is no taller than the project pane: one hint, no empty-container margin', async () => {
  const { window } = await boot();
  const doc = window.document;
  // Direct children only, and not the add-project form's message line.
  const hints = (sel) => [...doc.querySelectorAll(`${sel} > .hint`)];
  assert.equal(hints('#target-workspace-pane').length, 1, 'one hint line, matching the project pane');
  assert.equal(hints('#target-project-pane').length, 1);
  assert.equal(doc.querySelector('#workspaceHintConfig'), null, 'the second line must be gone');

  const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
  assert.match(css, /\.ws-members:empty\{[^}]*display:\s*none/,
    'an empty .ws-members keeps its margin unless it is display:none');
});

// Workspace mode used to blank the source-branch field entirely, leaving an
// empty column that read as a broken control (and moved the row).
test('workspace mode keeps the source-branch field, disabled, stating what will happen', async () => {
  const { window } = await boot({ fetchHandler: (url) => {
    if (url.includes('/api/branches')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ branches: ['dev', 'main'], current: 'dev' }) });
    }
    return null;
  } });
  selectProjectAnd(window);
  await tick(); await tick();
  const doc = window.document;
  const sel = doc.querySelector('#sourceBranch');
  assert.equal(sel.disabled, false, 'project mode: a real, editable picker');

  [...doc.querySelectorAll('#target-seg button')].find((b) => b.dataset.target === 'workspace')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick(); await tick();
  assert.equal(doc.querySelector('#sourceBranchWrap').classList.contains('hidden'), false,
    'the field must stay put, not vanish');
  assert.equal(sel.disabled, true, 'but not be editable — branches are chosen per member');
  assert.equal(sel.options.length, 1);
  assert.match(sel.options[0].textContent, /current branch \(auto\)/);
  assert.match(sel.title, /per project/i, 'and say why it is disabled');

  // Flipping back restores a working picker.
  [...doc.querySelectorAll('#target-seg button')].find((b) => b.dataset.target === 'project')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick(); await tick();
  assert.equal(sel.disabled, false, 'project mode must not inherit the disabled state');
});

test('flipping the target swaps the picker in place, leaving the switch put', async () => {
  const { window } = await boot();
  const doc = window.document;
  const segBefore = doc.querySelector('#target-seg').closest('.field');
  [...doc.querySelectorAll('#target-seg button')].find((b) => b.dataset.target === 'workspace')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick();
  assert.equal(doc.querySelector('#target-project-pane').classList.contains('hidden'), true);
  assert.equal(doc.querySelector('#target-workspace-pane').classList.contains('hidden'), false);
  assert.equal(doc.querySelector('#target-seg').closest('.field'), segBefore, 'the switch must not move');
});

test('the workflow picker owns the line above the task-source switch', async () => {
  const { window } = await boot();
  const doc = window.document;
  const wfField = doc.querySelector('#workflowSelect').closest('.field');
  const srcField = doc.querySelector('#source-seg').closest('.field');
  assert.ok(wfField && srcField);
  assert.notEqual(wfField, srcField, 'the workflow picker gets its own line');
  assert.ok(!doc.querySelector('#source-seg').closest('.split-row'),
    'the task source no longer shares a split row');
  assert.ok(!wfField.querySelector('#source-seg'), 'nothing else rides the workflow line');
  // Workflow first, task source under it.
  assert.equal(wfField.compareDocumentPosition(srcField) & window.Node.DOCUMENT_POSITION_FOLLOWING,
    window.Node.DOCUMENT_POSITION_FOLLOWING, 'the workflow picker sits above the task source');
  // The textarea is NOT on either line — it spans the full width below them.
  assert.ok(!srcField.querySelector('#prompt'), 'the prompt box must not be squeezed into the row');
});

test('the promoted fields sit in the intended order around the task box', async () => {
  const { window } = await boot();
  const doc = window.document;
  const form = doc.querySelector('#run-form');
  const posOf = (sel) => [...form.querySelectorAll('*')].indexOf(form.querySelector(sel));
  const title = posOf('#title');
  const taskSeg = posOf('#source-seg');
  const extras = posOf('#extras');
  const source = posOf('#sourceBranch');
  const advanced = posOf('#advanced-config');
  assert.ok(title < taskSeg, 'Title sits above the task source');
  assert.ok(taskSeg < extras, 'Extra files sit under the task source, grouped with it');
  assert.ok(extras < source, 'the branch pair follows the extra files');
  assert.ok(source < advanced, 'everything promoted stays above Advanced');
  // Source + feature branch share one compact row.
  const pair = doc.querySelector('.field-grid-2');
  assert.ok(pair, 'missing the two-column row');
  assert.ok(pair.querySelector('#sourceBranch') && pair.querySelector('#featureBranch'),
    'both branch fields must share the row');
});

test('Extra files is labelled like the other optional fields', () => {
  const html = readFileSync(htmlPath, 'utf8');
  assert.match(html, /Extra files <span class="opt">\(optional\)<\/span>/, 'label drifted from the "(optional)" convention');
  assert.ok(!html.includes('Optional extra files'), 'the old label must be gone');
});

// Every optional field answers the same question — "what happens if I skip
// this?" — with the same sentence, so the answer is learned once.
const PROPOSE_HINT = 'Leave empty and Worca will propose one.';
const EXTRAS_EMPTY = 'Leave empty and the run gets no extra files.';

test('the fields Worca fills in for you carry the identical hint', async () => {
  const { window } = await boot();
  const doc = window.document;
  for (const id of ['title', 'featureBranch']) {
    const field = doc.querySelector(`#${id}`).closest('.field');
    const hint = field.querySelector('.hint');
    assert.ok(hint, `#${id} must carry a hint`);
    assert.equal(hint.textContent, PROPOSE_HINT, `#${id} hint drifted from the shared sentence`);
  }
  // The instruction lives in the hint now, so the placeholder is a plain example.
  assert.ok(!doc.querySelector('#featureBranch').placeholder.includes('leave empty'),
    'the placeholder must not repeat the hint');
});

test('extra files uses the same opener but does not claim Worca proposes files', async () => {
  const { window } = await boot();
  const doc = window.document;
  const note = doc.querySelector('#extrasNote');
  assert.equal(note.textContent, EXTRAS_EMPTY);
  assert.ok(!note.textContent.includes('propose'), 'nothing is proposed here — the copy must not say so');

  // Picking files then clearing them must land back on the SAME empty-state
  // sentence the markup ships (these two strings had drifted apart).
  const extras = doc.querySelector('#extras');
  Object.defineProperty(extras, 'files', { value: [], configurable: true });
  extras.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(note.textContent, EXTRAS_EMPTY, 'the reset path must reuse the markup\'s wording');
});

test('one verb across the app: no field says "Leave blank"', () => {
  const html = readFileSync(htmlPath, 'utf8');
  assert.ok(!/Leave blank/i.test(html), 'mixing "leave blank" with "leave empty" is the inconsistency');
  assert.ok(html.includes('Leave empty'), 'the shared opener must be present');
});

// The header is a plain "Advanced": a summary line restated what opening the
// section already shows, and its two modes (contents vs deviations) shared one
// slot, so it could not be read at a glance.
test('the Advanced header carries no summary line, and the section never opens itself', async () => {
  const { window } = await boot();
  const doc = window.document;
  const details = doc.querySelector('#advanced-config');
  const summary = details.querySelector('summary');
  assert.equal(summary.textContent.trim(), 'Advanced', 'the header says only "Advanced"');
  assert.equal(doc.querySelector('#advancedSummary'), null, 'the sub-line must be gone');
  assert.equal(details.open, false);
  // Turning on the settings inside it must not spring it open.
  doc.querySelector('#mock-switch').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(doc.querySelector('#mock').checked, true, 'the switch still works');
  assert.equal(details.open, false, 'collapsed by default means collapsed, always');
});
