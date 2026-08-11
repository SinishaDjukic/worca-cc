// test/newpipeline-config.test.mjs — New Pipeline run setup on v2 GRAPH
// templates: a read-only mini-graph of the selected template plus a collapsed
// "Per-run overrides" disclosure holding one row per AGENT node (flow cards —
// task/end/and/or/combine — never get a row) and one cycle input per LOOP WIRE.
// The hardcoded 5-builtin `#wf-default-stages` block is gone with STEP_ROLES /
// renderStepConfigs; only the per-key config.steps DATA survives, as the last
// fallback in the same overlay > node.config > role chain resolveGraph uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const indexHtml = readFileSync(htmlPath, 'utf8');
const appJs = readFileSync(appPath, 'utf8');
const PROJECT = '/tmp/proj';

// Boot app.js in jsdom with a controllable fetch. Mirrors test/ui-cost.test.mjs.
async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(indexHtml, { url: 'http://localhost:4319/' });
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

// ── fixtures ────────────────────────────────────────────────────────────────
// Registry entries carry real ports: composerPortsFn is what ranks the graph and
// what classifies loop wires (a `when:'blocking'` output closing an SCC).
const AGENTS = [
  {
    key: 'planner', displayName: 'Plan', color: 'violet', order: 1, fanOut: true,
    asksQuestions: true, questionsLocked: false, questionsDefault: false,
    inputs: [{ id: 'task', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }],
  },
  {
    key: 'implementer', displayName: 'Implement', color: 'peach', order: 3,
    asksQuestions: true, questionsLocked: false, questionsDefault: false,
    inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'fix', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'done', type: 'void', when: 'always' }],
  },
  {
    key: 'manualTestsChecklist', displayName: 'Manual Tests Checklist', color: 'blue', order: 5,
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'checklist', type: 'md', when: 'always' }],
  },
  {
    key: 'reviewer', displayName: 'Review', color: 'blue', order: 4,
    asksQuestions: true, questionsLocked: false, questionsDefault: false,
    inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'done', type: 'void', required: false }],
    outputs: [
      { id: 'review', type: 'md', when: 'blocking' },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
  },
];
const REGISTRY = Object.fromEntries(AGENTS.map((a) => [a.key, a]));

// Task -> Plan -> {Implement || Manual Tests Checklist} -> Review -> End, with a
// review->implement loop. Ranks: task 0, plan 1, impl/mtc 2, review 3, end 4 —
// so the AGENT rows densify to steps 1, 2, 2, 3.
const WF = {
  id: 'wf_x', name: 'Demo', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 320, y: 200, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 60, config: {} },
    { id: 'n_mtc', kind: 'agent', key: 'manualTestsChecklist', x: 600, y: 340, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 880, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 1160, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_mtc', port: 'plan' } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w5', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w_fix', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 5 } },
    { id: 'w7', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};

const MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['medium', 'high', 'max'] },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', efforts: ['medium', 'high', 'max'] },
];

// The pure helpers rank the graph through composerPortsFn, which closes over the
// palette — seed it before calling them directly.
async function bootWithPalette(opts) {
  const { window } = await boot(opts);
  window.__np._setPalette(AGENTS);
  return { window };
}

// ── pure helpers: node rows ─────────────────────────────────────────────────

test('buildNodeConfigRows lists AGENT nodes only — no task/end/and/or/combine rows', async () => {
  const { window } = await bootWithPalette();
  const rows = window.__np.buildNodeConfigRows(WF, REGISTRY, { nodes: {}, wires: {} });
  assert.deepEqual(rows.map((r) => r.nodeId), ['n_plan', 'n_impl', 'n_mtc', 'n_review']);
  assert.ok(!rows.some((r) => r.nodeId === 'n_task' || r.nodeId === 'n_end'), 'flow cards never get a row');
});

test('buildNodeConfigRows orders rows topologically and densifies the step numbers', async () => {
  const { window } = await bootWithPalette();
  const rows = window.__np.buildNodeConfigRows(WF, REGISTRY, { nodes: {}, wires: {} });
  assert.deepEqual(rows.map((r) => r.label), ['Plan', 'Implement', 'Manual Tests Checklist', 'Review']);
  assert.deepEqual(rows.map((r) => r.color), ['violet', 'peach', 'blue', 'blue']);
  // Task sits at rank 0 and End at rank 4, but the AGENT rows still read 1..3.
  assert.deepEqual(rows.map((r) => r.stepIndex), [0, 1, 1, 2]);
  // Implement and Manual Tests Checklist share a rank.
  assert.deepEqual(rows.map((r) => r.parallel), [false, true, true, false]);
});

test('buildNodeConfigRows excludes LOOP wires from the ranking (a fix loop never reorders the graph)', async () => {
  const { window } = await bootWithPalette();
  const rows = window.__np.buildNodeConfigRows(WF, REGISTRY, { nodes: {}, wires: {} });
  const impl = rows.find((r) => r.nodeId === 'n_impl');
  const review = rows.find((r) => r.nodeId === 'n_review');
  assert.ok(impl.stepIndex < review.stepIndex, 'review->implement is a loop, not a forward edge');
});

test('buildNodeConfigRows overlays saved run-config model/effort per nodeId', async () => {
  const { window } = await bootWithPalette();
  const rc = { nodes: { n_impl: { model: 'claude-opus-4-8', effort: 'high' }, n_review: { model: 'claude-sonnet-4-6' } }, wires: {} };
  const rows = window.__np.buildNodeConfigRows(WF, REGISTRY, rc);
  const byId = Object.fromEntries(rows.map((r) => [r.nodeId, r]));
  assert.equal(byId.n_impl.model, 'claude-opus-4-8');
  assert.equal(byId.n_impl.effort, 'high');
  assert.equal(byId.n_review.model, 'claude-sonnet-4-6');
  assert.equal(byId.n_review.effort, '');   // absent in run-config -> ''
  assert.equal(byId.n_plan.model, '');      // untouched node
});

// resolveGraph resolves overlay > node.config > role > meta. The rows must show
// the SAME value the next run will use, or the picker lies about the run.
test('buildNodeConfigRows falls back overlay > composer node config > legacy per-key config', async () => {
  const { window } = await bootWithPalette();
  const wf = {
    ...WF,
    nodes: WF.nodes.map((n) => (n.id === 'n_impl' ? { ...n, config: { model: 'claude-sonnet-4-6', effort: 'medium' } } : n)),
  };
  const roleCfg = { planner: { model: 'claude-opus-4-8', effort: 'max' }, implementer: { model: 'claude-opus-4-8' } };
  const rows = window.__np.buildNodeConfigRows(wf, REGISTRY, { nodes: {}, wires: {} }, roleCfg);
  const byId = Object.fromEntries(rows.map((r) => [r.nodeId, r]));
  assert.equal(byId.n_impl.model, 'claude-sonnet-4-6', 'node config beats the legacy per-key layer');
  assert.equal(byId.n_impl.effort, 'medium');
  assert.equal(byId.n_plan.model, 'claude-opus-4-8', 'legacy per-key config is still the last fallback');
  assert.equal(byId.n_plan.effort, 'max');

  const withOverlay = window.__np.buildNodeConfigRows(
    wf, REGISTRY, { nodes: { n_impl: { model: 'claude-opus-4-8' } }, wires: {} }, roleCfg,
  );
  assert.equal(withOverlay.find((r) => r.nodeId === 'n_impl').model, 'claude-opus-4-8', 'the per-run overlay wins');
});

test('buildNodeConfigRows tolerates a key missing from the registry (label falls back to the key)', async () => {
  const { window } = await bootWithPalette();
  const wf = {
    id: 'w', version: 2,
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n0', kind: 'agent', key: 'ghost', x: 300, y: 0, config: {} },
    ],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n0', port: 'task' } }],
  };
  const rows = window.__np.buildNodeConfigRows(wf, REGISTRY, { nodes: {}, wires: {} });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'ghost');
  assert.equal(rows[0].color, '');
});

test('buildNodeConfigRows resolves fanOut: overlay > node config > sidecar default > false', async () => {
  const { window } = await bootWithPalette();
  // planner's sidecar default is fanOut:true; implementer has none.
  let rows = window.__np.buildNodeConfigRows(WF, REGISTRY, { nodes: {}, wires: {} });
  assert.equal(rows.find((r) => r.nodeId === 'n_plan').fanOut, true);
  assert.equal(rows.find((r) => r.nodeId === 'n_impl').fanOut, false);

  const wf = { ...WF, nodes: WF.nodes.map((n) => (n.id === 'n_impl' ? { ...n, config: { fanOut: true } } : n)) };
  rows = window.__np.buildNodeConfigRows(wf, REGISTRY, { nodes: {}, wires: {} });
  assert.equal(rows.find((r) => r.nodeId === 'n_impl').fanOut, true, 'node config beats the sidecar default');

  rows = window.__np.buildNodeConfigRows(wf, REGISTRY, { nodes: { n_plan: { fanOut: false }, n_impl: { fanOut: false } }, wires: {} });
  assert.equal(rows.find((r) => r.nodeId === 'n_plan').fanOut, false, 'overlay wins both directions');
  assert.equal(rows.find((r) => r.nodeId === 'n_impl').fanOut, false);
});

// The questions capability matrix and the questions-toggle round trip live in
// test/ui-newpipeline-questions.test.mjs.

// ── pure helpers: loop-wire budget rows ─────────────────────────────────────

test('buildLoopWireRows yields one row per LOOP wire, labelled "<to> ← <from>"', async () => {
  const { window } = await bootWithPalette();
  const rows = window.__np.buildLoopWireRows(WF, REGISTRY, { wires: {} });
  assert.equal(rows.length, 1, 'only the review->implement wire is a loop');
  assert.equal(rows[0].wireId, 'w_fix');
  assert.equal(rows[0].fromLabel, 'Review');
  assert.equal(rows[0].toLabel, 'Implement');
  assert.equal(rows[0].selfLoop, false);
  assert.equal(rows[0].label, 'Implement ← Review');
});

test('buildLoopWireRows resolves maxCycles: overlay > wire.config > 3', async () => {
  const { window } = await bootWithPalette();
  assert.equal(window.__np.buildLoopWireRows(WF, REGISTRY, { wires: {} })[0].maxCycles, 5, 'the template budget');
  assert.equal(
    window.__np.buildLoopWireRows(WF, REGISTRY, { wires: { w_fix: { maxCycles: 7 } } })[0].maxCycles, 7,
    'the per-run overlay wins',
  );
  const bare = { ...WF, wires: WF.wires.map((w) => (w.id === 'w_fix' ? { id: w.id, from: w.from, to: w.to } : w)) };
  assert.equal(window.__np.buildLoopWireRows(bare, REGISTRY, { wires: {} })[0].maxCycles, 3, 'unset => 3');
});

test('buildLoopWireRows renders a self-loop (from === to) as "<name> ↺ (self loop)"', async () => {
  const { window } = await bootWithPalette();
  const wf = {
    id: 'w', version: 2,
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      // planner's `plan` output is when:'always', so make the loop a blocking arm
      // by reusing the reviewer's shape: a self-wired blocking output.
      { id: 'w_self', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_plan', port: 'revise' } },
    ],
  };
  const reg = { ...REGISTRY, planner: { ...REGISTRY.planner, outputs: [{ id: 'plan', type: 'md', when: 'blocking' }] } };
  window.__np._setPalette(Object.values(reg));
  const rows = window.__np.buildLoopWireRows(wf, reg, { wires: {} });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].selfLoop, true);
  assert.equal(rows[0].label, 'Plan ↺ (self loop)');
});

test('buildLoopWireRows appends "(step N)" when an endpoint name is shared by more than one node', async () => {
  const { window } = await bootWithPalette();
  // Two reviewers: the loop must say WHICH one, or the input is ambiguous.
  const wf = {
    id: 'w', version: 2,
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} },
      { id: 'n_r1', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: {} },
      { id: 'n_r2', kind: 'agent', key: 'reviewer', x: 900, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
      { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_r1', port: 'plan' } },
      { id: 'w3', from: { node: 'n_r1', port: 'pass' }, to: { node: 'n_r2', port: 'plan' } },
      { id: 'w_fix', from: { node: 'n_r2', port: 'review' }, to: { node: 'n_impl', port: 'fix' } },
    ],
  };
  const rows = window.__np.buildLoopWireRows(wf, REGISTRY, { wires: {} });
  assert.equal(rows[0].fromLabel, 'Review (step 3)');
  assert.equal(rows[0].toLabel, 'Implement');
  assert.equal(rows[0].label, 'Implement ← Review (step 3)');
});

test('buildLoopWireRows labels a flow endpoint by its card name', async () => {
  const { window } = await bootWithPalette();
  const wf = {
    id: 'w', version: 2,
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} },
      { id: 'n_or', kind: 'or', x: 600, y: 0, config: {} },
      { id: 'n_review', kind: 'agent', key: 'reviewer', x: 900, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
      { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'plan' } },
      { id: 'w3', from: { node: 'n_review', port: 'review' }, to: { node: 'n_or', port: 'a' } },
      { id: 'w4', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } },
    ],
  };
  const rows = window.__np.buildLoopWireRows(wf, REGISTRY, { wires: {} });
  const labels = rows.map((r) => r.label);
  assert.ok(labels.includes('OR ← Review'), `flow card named, got ${JSON.stringify(labels)}`);
});

// Two OR cards share a name and neither sits on an AGENT rank — the suffix must
// still tell them apart, or two loop inputs read identically.
test('buildLoopWireRows disambiguates two flow cards of the same kind', async () => {
  const { window } = await bootWithPalette();
  const wf = {
    id: 'w', version: 2,
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
      { id: 'n_or1', kind: 'or', x: 600, y: 0, config: {} },
      { id: 'n_impl', kind: 'agent', key: 'implementer', x: 900, y: 0, config: {} },
      { id: 'n_or2', kind: 'or', x: 1200, y: 0, config: {} },
      { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1500, y: 0, config: {} },
    ],
    wires: [
      { id: 'w0', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w1', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_or1', port: 'a' } },
      { id: 'w2', from: { node: 'n_or1', port: 'out' }, to: { node: 'n_impl', port: 'plan' } },
      { id: 'w3', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_or2', port: 'a' } },
      { id: 'w4', from: { node: 'n_or2', port: 'out' }, to: { node: 'n_review', port: 'plan' } },
      // Two loops, one into each OR — their labels must not be identical.
      { id: 'w_l1', from: { node: 'n_review', port: 'review' }, to: { node: 'n_or1', port: 'b' } },
      { id: 'w_l2', from: { node: 'n_review', port: 'review' }, to: { node: 'n_or2', port: 'b' } },
    ],
  };
  const labels = window.__np.buildLoopWireRows(wf, REGISTRY, { wires: {} }).map((r) => r.label);
  assert.equal(labels.length, 2, `expected two loop rows, got ${JSON.stringify(labels)}`);
  assert.equal(new Set(labels).size, 2, `both loops read the same: ${JSON.stringify(labels)}`);
});

// ── markup ──────────────────────────────────────────────────────────────────

test('index.html: the hardcoded per-role stage block is gone', () => {
  assert.ok(!indexHtml.includes('id="wf-default-stages"'), '#wf-default-stages must be deleted');
  assert.ok(!/data-role="/.test(indexHtml), 'no hardcoded per-role stage controls survive');
  for (const blurb of [
    'Turns hidden decisions into questions before planning',
    'Explores the codebase and writes the implementation plan',
    'Rewrites the latest plan into a tighter version',
    'Writes the code from the approved plan, strict TDD',
    'Reviews the implementation diff against the plan',
  ]) {
    assert.ok(!indexHtml.includes(blurb), `stale hardcoded stage blurb survived: ${blurb}`);
  }
});

test('index.html: workflow select, mini-graph host and the collapsed overrides disclosure', () => {
  assert.ok(indexHtml.includes('id="workflowSelect"'), 'missing #workflowSelect');
  assert.ok(indexHtml.includes('id="wf-preview"'), 'missing the read-only mini-graph host');
  assert.ok(indexHtml.includes('id="wf-overrides-toggle"'), 'missing the Per-run overrides toggle');
  assert.ok(indexHtml.includes('>Per-run overrides<'), 'the disclosure is labelled "Per-run overrides"');
  assert.ok(indexHtml.includes('id="wf-node-config"'), 'missing #wf-node-config container');
  assert.ok(indexHtml.includes('id="wf-feedback-config"'), 'missing #wf-feedback-config container');
  assert.ok(indexHtml.indexOf('id="wf-overrides"') < indexHtml.indexOf('id="wf-node-config"'),
    'both containers live inside the disclosure panel');
  assert.ok(indexHtml.indexOf('id="wf-node-config"') < indexHtml.indexOf('id="wf-feedback-config"'),
    'node rows precede the loop budgets');
});

test('index.html: the entry prompt says it feeds the Task node', () => {
  const pane = indexHtml.slice(indexHtml.indexOf('id="prompt-pane"'), indexHtml.indexOf('id="markdown-pane"'));
  assert.match(pane, /feeds the Task node/, 'the prompt copy must name the Task node it feeds');
});

test('app.js: STEP_ROLES and renderStepConfigs are gone', () => {
  assert.ok(!appJs.includes('STEP_ROLES'), 'STEP_ROLES must be deleted');
  assert.ok(!appJs.includes('renderStepConfigs'), 'renderStepConfigs must be deleted');
  assert.ok(!appJs.includes('data-role='), 'no per-role selectors survive in the config path');
});

// ── DOM: the wired-up view ──────────────────────────────────────────────────

function workflowFetch(extraConfig = {}) {
  return (url) => {
    if (url.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    if (url.includes('/api/workflows/wf_x')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => WF });
    }
    if (url.includes('/api/workflows/wf_default')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...WF, id: 'wf_default', name: 'Default' }) });
    }
    if (url.includes('/api/workflows')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [{ id: 'wf_default', name: 'Default', version: 2, nodes: WF.nodes, wires: WF.wires }, WF] }) });
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
// The render chain is fetch -> palette -> preview -> rows; settle it.
async function settle() { for (let i = 0; i < 6; i += 1) await tick(); }

test('the workflow select is populated with Default + saved names from GET /api/workflows', async () => {
  const { window } = await boot({ fetchHandler: workflowFetch() });
  selectProjectAnd(window);
  await settle();
  const opts = [...window.document.querySelectorAll('#workflowSelect option')].map((o) => o.textContent);
  assert.deepEqual(opts, ['Default', 'Demo']);
});

test('selecting a workflow renders the read-only mini-graph, End card included', async () => {
  const { window } = await boot({ fetchHandler: workflowFetch() });
  selectProjectAnd(window);
  await settle();
  pickWorkflow(window, 'wf_x');
  await settle();
  const host = window.document.querySelector('#wf-preview');
  const cards = [...host.querySelectorAll('.node')];
  assert.equal(cards.length, WF.nodes.length, 'one card per node');
  assert.ok(host.querySelector('.node-end'), 'the End card renders for free');
  assert.ok(host.querySelector('.node-task'), 'the Task card renders');
  assert.ok(host.querySelectorAll('.gv-wires path.wire').length >= WF.wires.length - 1, 'wires painted');
  // Read-only: the composer chrome (palette rail, inspector, zoom) is absent.
  assert.equal(host.querySelector('.gv-stage'), null, 'no composer stage chrome in the preview');
});

test('the override rows are AGENT-only and live behind a collapsed "Per-run overrides" disclosure', async () => {
  const { window } = await boot({ fetchHandler: workflowFetch() });
  selectProjectAnd(window);
  await settle();
  pickWorkflow(window, 'wf_x');
  await settle();
  const doc = window.document;
  const panel = doc.querySelector('#wf-overrides');
  const toggle = doc.querySelector('#wf-overrides-toggle');
  assert.equal(panel.hidden, true, 'collapsed by default');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');

  const ids = [...doc.querySelectorAll('#wf-node-config .step-model')].map((s) => s.dataset.nodeId);
  assert.deepEqual(ids, ['n_plan', 'n_impl', 'n_mtc', 'n_review'], 'agent nodes only, topological order');
  assert.equal(doc.querySelector('#wf-node-config .step-model[data-node-id="n_task"]'), null);
  assert.equal(doc.querySelector('#wf-node-config .step-model[data-node-id="n_end"]'), null);
  assert.equal(doc.querySelector('#wf-node-config .step-model[data-node-id="n_impl"]').options.length, 4);

  toggle.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(panel.hidden, false, 'clicking expands');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  toggle.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(panel.hidden, true, 'clicking again collapses');
});

test('one cycle input per LOOP wire, keyed by data-wire-id', async () => {
  const { window } = await boot({ fetchHandler: workflowFetch() });
  selectProjectAnd(window);
  await settle();
  pickWorkflow(window, 'wf_x');
  await settle();
  const doc = window.document;
  const inputs = [...doc.querySelectorAll('#wf-feedback-config input[data-wire-id]')];
  assert.deepEqual(inputs.map((i) => i.dataset.wireId), ['w_fix']);
  assert.equal(inputs[0].value, '5', 'the template budget');
  const labelText = inputs[0].closest('.field').querySelector('label').textContent;
  assert.equal(labelText, 'Implement ← Review — max cycles');
  assert.ok(!/n_[a-z]+/.test(labelText), 'the label never leaks a raw node id');
});

test('saved run-config preselects a node model+effort and its loop budget', async () => {
  const extra = { workflows: { wf_x: { nodes: { n_impl: { model: 'claude-opus-4-8', effort: 'high' } }, wires: { w_fix: { maxCycles: 7 } } } } };
  const { window } = await boot({ fetchHandler: workflowFetch(extra) });
  selectProjectAnd(window);
  await settle();
  pickWorkflow(window, 'wf_x');
  await settle();
  const doc = window.document;
  assert.equal(doc.querySelector('#wf-node-config .step-model[data-node-id="n_impl"]').value, 'claude-opus-4-8');
  assert.equal(doc.querySelector('#wf-node-config .step-effort[data-node-id="n_impl"]').value, 'high');
  assert.equal(doc.querySelector('#wf-feedback-config input[data-wire-id="w_fix"]').value, '7');
});

// Capture PATCH /api/config bodies while still serving the GETs.
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
  await settle();
  pickWorkflow(window, 'wf_x');
  await settle();
  const modelSel = window.document.querySelector('#wf-node-config .step-model[data-node-id="n_impl"]');
  modelSel.value = 'claude-opus-4-8';
  modelSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  const body = posts.find((p) => p.nodes && p.nodes.n_impl);
  assert.ok(body, 'no PATCH captured for the node');
  assert.equal(body.projectDir, PROJECT);
  assert.equal(body.workflowId, 'wf_x');
  assert.equal(body.nodes.n_impl.model, 'claude-opus-4-8');
  assert.equal(body.nodes.n_impl.effort, ''); // new model resets effort
});

test('changing a loop cycle count PATCHes { ..., wires: { [wireId]: { maxCycles } } }', async () => {
  const { window, posts } = await bootCapturing();
  selectProjectAnd(window);
  await settle();
  pickWorkflow(window, 'wf_x');
  await settle();
  const cyc = window.document.querySelector('#wf-feedback-config input[data-wire-id="w_fix"]');
  cyc.value = '4';
  cyc.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  const body = posts.find((p) => p.wires && p.wires.w_fix);
  assert.ok(body, 'no PATCH captured for the wire');
  assert.equal(body.workflowId, 'wf_x');
  assert.equal(body.wires.w_fix.maxCycles, 4);
});

test('selecting a workflow persists it as the active workflow', async () => {
  const { window, posts } = await bootCapturing();
  selectProjectAnd(window);
  await settle();
  pickWorkflow(window, 'wf_x');
  await settle();
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
  await settle();
  window.document.querySelector('#prompt').value = 'do a thing';
  window.document.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
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
  await settle();
  pickWorkflow(window, 'wf_x');
  await settle();
  window.document.querySelector('#prompt').value = 'ship it';
  window.document.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].workflowId, 'wf_x');
});

test('renderModelEffortPair fills a model dropdown (default + models + add) and filters efforts by model', async () => {
  const { window } = await boot();
  const doc = window.document;
  const modelSel = doc.createElement('select');
  const effortSel = doc.createElement('select');
  const caption = doc.createElement('small');
  window.__np._setModels([
    { id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['medium', 'high', 'max'] },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] },
  ]);
  window.__np.renderModelEffortPair(modelSel, effortSel, caption, { model: 'claude-haiku-4-5', effort: 'high' });
  assert.equal(modelSel.options.length, 4);
  assert.equal(modelSel.value, 'claude-haiku-4-5');
  assert.deepEqual([...effortSel.options].map((o) => o.value), ['', 'medium', 'high']);
  assert.equal(effortSel.value, 'high');
  assert.match(caption.textContent, /Haiku 4\.5 · high/);
});

test('renderNodeRows paints an .acc swatch carrying each node color', async () => {
  const { window } = await boot();
  window.__np.renderNodeRows([
    { nodeId: 'n_plan', key: 'planner', label: 'Plan', color: 'violet', stepIndex: 0, parallel: false, model: '', effort: '', fanOut: false },
    { nodeId: 'n_pr', key: 'planReviewer', label: 'Plan Review', color: 'amber', stepIndex: 1, parallel: false, model: '', effort: '', fanOut: false },
  ]);
  const accs = [...window.document.querySelectorAll('#wf-node-config .acc')];
  assert.deepEqual(accs.map((a) => a.className), ['acc violet', 'acc amber']);
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
  await settle();
  pickWorkflow(window, 'wf_x');
  await settle();
  failList = true;
  selectProjectAnd(window); // re-entry -> loadConfig -> loadWorkflowsInto hits the failing list
  await settle();
  const sel = window.document.querySelector('#workflowSelect');
  assert.ok([...sel.options].map((o) => o.value).includes('wf_x'), 'saved workflow entry kept in the dropdown');
  assert.equal(sel.value, 'wf_x', 'active selection preserved');
  assert.ok(window.document.querySelectorAll('#wf-node-config .step-model').length, 'node rows still rendered');
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
  await settle();
  pickWorkflow(window, 'wf_x');
  await settle();
  const host = window.document.querySelector('#wf-node-config');
  assert.match(host.textContent, /Could not load this workflow/, 'hint painted');
  assert.equal(host.querySelectorAll('.step-model').length, 0, 'no capability-stripped rows');
});

// A v1 row (steps/feedbacks, no nodes) is not a template this view can render.
test('a workflow served without a v2 nodes array is rejected, not half-rendered', async () => {
  const base = workflowFetch();
  const { window } = await boot({ fetchHandler: (url, opts) => {
    if (String(url).includes('/api/workflows/wf_x')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'wf_x', name: 'Demo', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] }) });
    }
    return base(url, opts);
  } });
  selectProjectAnd(window);
  await settle();
  pickWorkflow(window, 'wf_x');
  await settle();
  const doc = window.document;
  assert.match(doc.querySelector('#wf-node-config').textContent, /Could not load this workflow/);
  assert.equal(doc.querySelector('#wf-preview').querySelectorAll('.node').length, 0, 'nothing painted in the preview');
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
function guardrailsFetch(sets = GR_SETS) {
  const base = workflowFetch();
  return (url, opts) => {
    if (url.includes('/api/guardrails')) {
      const list = typeof sets === 'function' ? sets() : sets;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ guardrails: list }) });
    }
    return base(url, opts);
  };
}
const pickGuardrails = (window, id) => {
  const s = window.document.querySelector('#guardrailsSelect');
  s.value = id; s.dispatchEvent(new window.Event('change', { bubbles: true }));
};

test('index.html: #guardrailsSelect + #guardrailsHint live inside #pipeline-config', () => {
  const cfg = indexHtml.slice(indexHtml.indexOf('id="pipeline-config"'), indexHtml.indexOf('id="wf-preview"'));
  assert.ok(cfg.includes('id="guardrailsSelect"'), 'select present before the preview');
  assert.ok(cfg.includes('id="guardrailsHint"'), 'hint line present');
});

test('the guardrails select is populated from GET /api/guardrails with Permissive (default) selected', async () => {
  const { window } = await boot({ fetchHandler: guardrailsFetch() });
  selectProjectAnd(window);
  await settle();
  const opts = [...window.document.querySelectorAll('#guardrailsSelect option')].map((o) => [o.value, o.textContent]);
  assert.deepEqual(opts, [
    ['permissive', 'Permissive (default)'],
    ['normal', 'Normal'],
    ['secure', 'Strict'],
    ['gr_org', 'Org Policy'],
  ]);
  assert.equal(window.document.querySelector('#guardrailsSelect').value, 'permissive', 'defaults to Permissive');
});

test('default submit posts NO guardrailsId key (Permissive default = byte-identical request)', async () => {
  const runs = [];
  const base = guardrailsFetch();
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
  await settle();
  window.document.querySelector('#prompt').value = 'ship it';
  window.document.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(runs.length, 1);
  assert.equal('guardrailsId' in runs[0], false, 'key absent, not null (omit-when-default)');
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
  await settle();
  pickGuardrails(window, 'gr_org');
  await tick();
  const hint = window.document.querySelector('#guardrailsHint').textContent;
  assert.match(hint, /2 deny · 0 paths · scrub on/, 'the SELECTED set is the whole policy — its raw counts');
  window.document.querySelector('#prompt').value = 'ship it';
  window.document.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
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
  await settle();
  pickGuardrails(window, 'secure');
  fail = true;
  selectProjectAnd(window); // project change re-runs loadConfig -> loadGuardrailsInto, which now fails
  await settle();
  const opts = [...window.document.querySelectorAll('#guardrailsSelect option')].map((o) => o.value);
  assert.ok(opts.includes('secure'), 'options kept on failure');
  assert.equal(window.document.querySelector('#guardrailsSelect').value, 'secure', 'selection kept');
});

test('a VANISHED selection falls back to Permissive with a VISIBLE form message (never a silent revert)', async () => {
  let list = GR_SETS;
  const { window } = await boot({ fetchHandler: guardrailsFetch(() => list) });
  selectProjectAnd(window);
  await settle();
  pickGuardrails(window, 'gr_org');
  // The set is deleted server-side; the next repopulation no longer lists it.
  list = GR_SETS.filter((g) => g.id !== 'gr_org');
  selectProjectAnd(window);
  await settle();
  assert.equal(window.document.querySelector('#guardrailsSelect').value, 'permissive', 'fell back to the default');
  assert.match(window.document.querySelector('#form-msg').textContent, /no longer exists/, 'said out loud');
});
