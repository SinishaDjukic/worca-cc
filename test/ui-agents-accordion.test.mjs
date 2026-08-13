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

// ── Advanced disclosure (§4.6) ──────────────────────────────────────────────

test('Advanced starts collapsed and holds the safe-default fields', async () => {
  const { window } = await boot();
  const details = window.document.querySelector('#advanced-config');
  assert.ok(details, 'missing the Advanced disclosure');
  assert.equal(details.open, false, 'Advanced must start collapsed');
  for (const id of ['title', 'sourceBranch', 'featureBranch', 'guardrailsSelect', 'extras', 'mock']) {
    assert.ok(details.querySelector(`#${id}`), `#${id} must live inside Advanced`);
  }
});

test('Advanced force-opens when something inside it is non-default, and says what', async () => {
  const { window } = await boot();
  const doc = window.document;
  const details = doc.querySelector('#advanced-config');
  assert.equal(details.open, false);
  doc.querySelector('#featureBranch').value = 'feat/x';
  doc.querySelector('#featureBranch').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(details.open, true, 'active state must never be hidden');
  assert.match(doc.querySelector('#advancedSummary').textContent, /feature branch/);
});

test('advancedIsNonDefault names each deviating field (and stays empty at rest)', async () => {
  const { window } = await boot();
  const doc = window.document;
  const { advancedIsNonDefault } = window.__np;
  assert.deepEqual(advancedIsNonDefault(), []);
  doc.querySelector('#title').value = 'run me';
  doc.querySelector('#mock').checked = true;
  const gr = doc.querySelector('#guardrailsSelect');
  gr.appendChild(new window.Option('Strict', 'secure'));
  gr.value = 'secure';
  assert.deepEqual(advancedIsNonDefault().sort(), ['guardrails', 'mock mode', 'title']);
});

test('the source branch counts as non-default only when it differs from the repo HEAD', async () => {
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
  assert.equal(sel.value, 'dev', 'the current branch is preselected');
  assert.ok(!window.__np.advancedIsNonDefault().includes('source branch'), 'HEAD is the default, not a choice');
  sel.value = 'main';
  assert.ok(window.__np.advancedIsNonDefault().includes('source branch'));
});

test('in workspace mode the per-member branch pickers are what counts as non-default', async () => {
  const { window } = await boot({ fetchHandler: (url) => {
    if (url.includes('/api/branches')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ branches: ['dev', 'main'], current: 'dev' }) });
    }
    return null;
  } });
  selectProjectAnd(window);
  await tick(); await tick();
  const doc = window.document;
  // Hide the single picker exactly as setRunTarget('workspace') does, and stand
  // in two member pickers built the same way populateBranchSelect builds them.
  doc.querySelector('#sourceBranchWrap').classList.add('hidden');
  doc.querySelector('#sourceBranch').value = 'main'; // must now be ignored
  const host = doc.querySelector('#ws-source-branches');
  for (const picked of ['dev', 'dev']) {
    const sel = doc.createElement('select');
    sel.className = 'select ws-src-select';
    for (const b of ['dev', 'main']) {
      const o = new window.Option(b, b);
      if (b === 'dev') o.dataset.default = '1';
      sel.appendChild(o);
    }
    sel.value = picked;
    host.appendChild(sel);
  }
  assert.ok(!window.__np.advancedIsNonDefault().includes('source branch'),
    'the hidden single picker must not leak into workspace mode');
  host.querySelector('select').value = 'main';
  assert.ok(window.__np.advancedIsNonDefault().includes('source branch'), 'one deviating member is enough');
});
