// test/ui-agents-accordion.test.mjs — the New-Pipeline agents accordion
// (newpipeline-ux-design.md §4.2-§4.6): four-layer resolution, the modified
// marker, prune-on-save, the Reset / Save-as-defaults actions, and the Advanced
// disclosure that must never hide active state.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { lastToast } from './helpers/feedback.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

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
          if (sel.subagentModel) entry.subagentModel = sel.subagentModel;
          else if (sel.subagentModel === '' || sel.subagentModel === null) delete entry.subagentModel;
          if (Object.keys(entry).length) wf.nodes[nodeId] = entry; else delete wf.nodes[nodeId];
        }
      }
      if (method === 'POST' && body && body.step) {
        const entry = { ...cfg.steps[body.step] };
        if (body.model) entry.model = body.model; else delete entry.model;
        if (body.effort) entry.effort = body.effort; else delete entry.effort;
        applyToggle(entry, 'fanOut', body.fanOut);
        applyToggle(entry, 'askQuestions', body.askQuestions);
        if (body.subagentModel) entry.subagentModel = body.subagentModel;
        else if (body.subagentModel === '' || body.subagentModel === null) delete entry.subagentModel;
        if (Object.keys(entry).length) cfg.steps[body.step] = entry; else delete cfg.steps[body.step];
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        config: cfg, models: MODELS, efforts: ['medium', 'high', 'max'],
        subagentModels: ['sonnet', 'opus', 'fable', 'auto', 'inherit'],
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
  assert.deepEqual(n0.def, { model: 'claude-opus-4-8', effort: 'high', fanOut: true, askQuestions: false, subagentModel: '' });
  assert.deepEqual(n0.override, {});
  assert.equal(n0.modified, false);
  // n1: no workflow default, so the registry supplies fanOut:false — overridden.
  assert.deepEqual(n1.def, { model: '', effort: '', fanOut: false, askQuestions: false, subagentModel: '' });
  assert.deepEqual(n1.override, { fanOut: true });
  assert.equal(n1.modified, true);
});

// ── prune-on-save (§4.5) ────────────────────────────────────────────────────

test('pruneNodeSelection stores only deviations and never persists an absent or locked questions toggle', async () => {
  const { window } = await boot();
  const { pruneNodeSelection } = window.__np;
  await checkRows([
    { name: 'pruneNodeSelection stores a deviation and clears anything equal to the default', run: async () => {
      const row = {
        model: 'claude-opus-4-8', effort: 'high', fanOut: true, askQuestions: false,
        questionsLocked: false,
        def: { model: 'claude-opus-4-8', effort: 'high', fanOut: true, askQuestions: false, subagentModel: '' },
      };
      // Nothing changed -> everything inherits.
      assert.deepEqual(pruneNodeSelection(row, {}),
        { model: '', effort: '', fanOut: null, askQuestions: null, subagentModel: '' });
      // A different model is stored; so is its (default-matching) effort, because an
      // effort is only interpretable next to the model that advertises it.
      assert.deepEqual(pruneNodeSelection(row, { model: 'claude-haiku-4-5' }),
        { model: 'claude-haiku-4-5', effort: 'high', fanOut: null, askQuestions: null, subagentModel: '' });
      // Changing only the effort still pins the model alongside it.
      assert.deepEqual(pruneNodeSelection(row, { effort: 'max' }),
        { model: 'claude-opus-4-8', effort: 'max', fanOut: null, askQuestions: null, subagentModel: '' });
      // A toggle that deviates is stored as a boolean.
      assert.deepEqual(pruneNodeSelection(row, { fanOut: false }),
        { model: '', effort: '', fanOut: false, askQuestions: null, subagentModel: '' });
    } },
    { name: 'pruneNodeSelection never persists a value for an absent or locked questions toggle', run: async () => {
      const def = { model: '', effort: '', fanOut: false, askQuestions: true };
      assert.equal(pruneNodeSelection({ model: '', effort: '', fanOut: false, askQuestions: null, def }, {}).askQuestions, undefined);
      assert.equal(pruneNodeSelection({ model: '', effort: '', fanOut: false, askQuestions: true, questionsLocked: true, def }, {}).askQuestions, undefined);
    } },
  ]);
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

test('Save-as-defaults with a version in use: the draft gets the defaults, the project keeps its picks, and the hint says so', async () => {
  const sink = [];
  const config = { workflows: { wf_t: { nodes: { n0: { model: 'claude-haiku-4-5', effort: 'high' } }, feedbacks: {} } } };
  // GET /api/workflows/:id?use=live carries versionNo once a version is in use (flag workflowTests on).
  const { window } = await boot({ fetchHandler: apiFetch({ config, sink, workflow: { ...WF_TUNED, versionNo: 2 } }) });
  await openTuned(window);
  window.document.querySelector('#agentsPromote').dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick(); await tick(); await tick();
  assert.ok(sink.some((c) => c.method === 'PATCH' && /\/defaults$/.test(c.url)), 'the defaults still go into the draft');
  assert.equal(sink.some((c) => c.method === 'DELETE' && c.url.includes('/api/config/workflow')), false,
    'the project picks are kept: new runs use the version in use, which does not have these defaults');
  assert.equal(lastToast(window.document)?.title, 'Saved to your draft. New runs keep these picks until you use a new version.');
});

test('Save-as-defaults without a version in use (versionNo null): exactly as before, the picks are cleared and no hint', async () => {
  const sink = [];
  const config = { workflows: { wf_t: { nodes: { n0: { model: 'claude-haiku-4-5', effort: 'high' } }, feedbacks: {} } } };
  const { window } = await boot({ fetchHandler: apiFetch({ config, sink, workflow: { ...WF_TUNED, versionNo: null } }) });
  await openTuned(window);
  window.document.querySelector('#agentsPromote').dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick(); await tick(); await tick();
  assert.ok(sink.some((c) => c.method === 'DELETE' && c.url.includes('/api/config/workflow')), 'overrides cleared');
  assert.equal(lastToast(window.document), null);
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

// ── no project selected: read-only, and it SAYS so ──────────────────────────
// Per-agent config is stored per project. With none selected the save no-ops
// and the re-render undoes the edit — which reads as "this control is broken".

test('with no project every control is disabled and the header says why; selecting a project re-enables them', async () => {
  const { window } = await boot({ fetchHandler: apiFetch() });
  await tick(); await tick(); // no selectProjectAnd: this IS the empty state
  const doc = window.document;
  await checkRows([
    { name: 'with no project the accordion renders but every control is disabled, and the header says why', run: async () => {
      assert.ok(doc.querySelectorAll('#agents-rows .agent-row').length > 0, 'rows still render — seeing the plan is useful');
      assert.equal(doc.querySelector('#agentsSummary').textContent, 'select a project to change these');
      for (const sel of ['.step-model', '.step-effort', '.step-fanout', '.step-questions']) {
        const c = doc.querySelector(`#agents-rows ${sel}`);
        if (c) assert.equal(c.disabled, true, `${sel} must be disabled without a project`);
      }
      // The two header actions would have nothing to act on.
      assert.equal(doc.querySelector('#agentsReset').hidden, true);
      assert.equal(doc.querySelector('#agentsPromote').hidden, true);
    } },
    { name: 'selecting a project re-enables the controls', run: async () => {
      assert.equal(doc.querySelector('#agents-rows .step-model').disabled, true, 'precondition: disabled');
      await openTuned(window);
      assert.equal(doc.querySelector('.step-model[data-node-id="n0"]').disabled, false);
      assert.equal(doc.querySelector('.step-fanout[data-node-id="n0"]').disabled, false);
      assert.notEqual(doc.querySelector('#agentsSummary').textContent, 'select a project to change these');
    } },
  ]);
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

// ── Advanced disclosure (§4.6) ──────────────────────────────────────────────

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

// ── the sub-agent model policy control ──────────────────────────────────────

test('sub-agent model control: option list (no haiku), workflow default pre-fills unmodified, caption shows a stored policy with fan-out off', async () => {
  // One boot: n0's workflow default stores a policy with fan-out off; n1 has nothing configured.
  const wf = { ...WF_TUNED, steps: [
    [{ id: 'n0', key: 'planner', defaults: { model: 'claude-opus-4-8', effort: 'high', subagentModel: 'auto' } }],
    [{ id: 'n1', key: 'reviewer' }],
  ] };
  const { window } = await boot({ fetchHandler: apiFetch({ workflow: wf }) });
  await openTuned(window);
  const doc = window.document;
  await checkRows([
    { name: 'every agent row offers a sub-agent model; unset shows as the auto default', run: async () => {
      const sel = doc.querySelector('.step-subagent[data-node-id="n1"]');
      assert.ok(sel, 'the control is rendered beside Fan-out, whose children it governs');
      assert.equal(sel.value, '', "nothing configured -> unset (the run resolves 'auto': agents pick)");
      assert.deepEqual([...sel.options].map((o) => o.value), ['', 'sonnet', 'opus', 'fable', 'auto', 'inherit']);
      assert.match([...sel.options][0].textContent, /agent picks/,
        'the blank option is honest about the auto default, never labelled as a value');
      assert.equal([...sel.options].some((o) => o.value === 'haiku'), false, 'haiku is off the menu');
    } },
    { name: 'a workflow default pre-fills the control and does not count as modified', run: async () => {
      assert.equal(doc.querySelector('.step-subagent[data-node-id="n0"]').value, 'auto');
      assert.match(doc.querySelector('.agent-sum[data-node-id="n0"]').textContent, /subs: agent picks/);
      assert.equal(doc.querySelector('.agent-row[data-node-id="n0"] .agent-mod'), null);
    } },
    { name: 'the caption admits a stored policy even when fan-out is off (stored state is never hidden)', run: async () => {
      assert.equal(doc.querySelector('.step-fanout[data-node-id="n0"]').checked, false, 'precondition: fan-out is off');
      const sum = doc.querySelector('.agent-sum[data-node-id="n0"]').textContent;
      assert.match(sum, /subs: agent picks/,
        'the value is stored and survives a fan-out toggle; hiding it while the modified dot shows was a contradiction');
    } },
  ]);
});

test("sub-agent model writes: a value is PATCHed and marked, inherit is stored as a value, '' prunes back to a clean row", async () => {
  const sink = [];
  const { window } = await boot({ fetchHandler: apiFetch({ sink }) });
  await openTuned(window);
  const doc = window.document;
  // One boot, sequential changes opus -> inherit -> ''; each row reads only its own write.
  await checkRows([
    { name: 'picking a sub-agent model saves it, marks the row, and shows in the caption', run: async () => {
      sink.length = 0;
      const sel = doc.querySelector('.step-subagent[data-node-id="n0"]');
      sel.value = 'opus';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick(); await tick();

      const write = sink.find((w) => w.method === 'PATCH' && w.body && w.body.nodes && w.body.nodes.n0);
      assert.equal(write.body.nodes.n0.subagentModel, 'opus', 'the value reaches the node writer');
      assert.match(doc.querySelector('.agent-sum[data-node-id="n0"]').textContent, /subs: opus/);
      assert.ok(doc.querySelector('.agent-row[data-node-id="n0"] .agent-mod'), 'it deviates from the default');
    } },
    { name: 'an explicit inherit is stored as a value, marked modified, and captioned', run: async () => {
      sink.length = 0;
      const sel = doc.querySelector('.step-subagent[data-node-id="n0"]');
      sel.value = 'inherit';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick(); await tick();

      const write = sink.find((w) => w.method === 'PATCH' && w.body && w.body.nodes && w.body.nodes.n0);
      assert.equal(write.body.nodes.n0.subagentModel, 'inherit',
        'inherit reaches the writer as a VALUE — it must survive, unlike the empty clear');
      assert.match(doc.querySelector('.agent-sum[data-node-id="n0"]').textContent, /subs: inherit/);
      assert.ok(doc.querySelector('.agent-row[data-node-id="n0"] .agent-mod'), 'deviates from the auto default');
    } },
    { name: 'choosing the default back prunes the override to unset', run: async () => {
      sink.length = 0;
      assert.equal(doc.querySelector('.step-subagent[data-node-id="n0"]').value, 'inherit', 'the previous row stored inherit');

      const sel = doc.querySelector('.step-subagent[data-node-id="n0"]');
      sel.value = '';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick(); await tick();
      const write = sink.find((w) => w.method === 'PATCH' && w.body && w.body.nodes && w.body.nodes.n0);
      assert.equal(write.body.nodes.n0.subagentModel, '', "'' is the clear (unset != the stored 'inherit' value)");
      assert.equal(doc.querySelector('.agent-row[data-node-id="n0"] .agent-mod'), null, 'back to a clean row');
    } },
  ]);
});

test('resolveNodeTunables is the ONE resolution rule shared by the v1 and v2 row builders', async () => {
  const { window } = await boot({ fetchHandler: apiFetch() });
  const r = window.__np.resolveNodeTunables(
    { subagentModel: 'fable', fanOut: true },
    { model: 'claude-opus-4-8', effort: 'high', subagentModel: 'auto' },
    { fanOut: false, asksQuestions: false, questionsLocked: false, questionsDefault: false });
  assert.deepEqual(r.override, { subagentModel: 'fable', fanOut: true });
  assert.equal(r.def.subagentModel, 'auto');
  assert.equal(r.subagentModel, 'fable', 'the project override wins');
  assert.equal(r.fanOut, true);
  assert.equal(r.model, 'claude-opus-4-8', 'the workflow-default model flows through');

  const bare = window.__np.resolveNodeTunables({}, {}, {
    fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: true });
  assert.equal(bare.subagentModel, '', 'unset stays raw — the RUNTIME resolves auto');
  assert.equal(bare.fanOut, true, 'meta fanOut is the last layer');
  assert.equal(bare.askQuestions, true, 'meta questionsDefault is the last layer');
});
