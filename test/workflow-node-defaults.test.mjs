// test/workflow-node-defaults.test.mjs — per-node workflow defaults
// (newpipeline-ux-design.md §4.4): sanitization at write time, the resolution
// layer resolveGraph inserts between run-config and the agent registry, and
// the setWorkflowNodeDefaults writer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WORCA_HOME = mkdtempSync(join(tmpdir(), 'worca-wfdef-'));

const {
  writeWorkflow, readWorkflow, writeGraphWorkflow, resolveGraph, setWorkflowNodeDefaults,
  sanitizeNodeDefaults, sanitizeWorkflowSteps, workflowNodeDefaults, GRAPH_DEFAULT_WORKFLOW,
} = await import('../src/core/workflows.mjs');
const { setStep, setNodeModel } = await import('../src/core/config.mjs');

const PROJECT = mkdtempSync(join(tmpdir(), 'worca-wfdef-proj-'));

const PORTS = {
  metaVersion: 2,
  inputs: [{ id: 'task', type: 'md' }],
  outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
};
const REGISTRY = {
  planner: { key: 'planner', displayName: 'Plan', fanOut: false, asksQuestions: true, questionsDefault: false, ...PORTS },
  reviewer: { key: 'reviewer', displayName: 'Review', fanOut: false, ...PORTS },
  locked: { key: 'locked', displayName: 'Locked', asksQuestions: true, questionsLocked: true, questionsDefault: true, ...PORTS },
};

// ── sanitizeNodeDefaults ────────────────────────────────────────────────────

test('sanitizeNodeDefaults keeps well-formed fields and drops malformed ones individually', () => {
  const out = sanitizeNodeDefaults({
    model: '  claude-opus-4-8 ', effort: 'high', fanOut: true, askQuestions: false,
  });
  assert.deepEqual(out, { model: 'claude-opus-4-8', effort: 'high', fanOut: true, askQuestions: false });

  // A bad field is dropped; its siblings survive (loud-and-lenient house style).
  const partial = sanitizeNodeDefaults({ model: 'm', effort: 'ludicrous', fanOut: 'yes', askQuestions: true });
  assert.deepEqual(partial, { model: 'm', askQuestions: true });
});

test('sanitizeNodeDefaults refuses an effort with no model to interpret it', () => {
  assert.equal(sanitizeNodeDefaults({ effort: 'high' }), undefined);
  assert.deepEqual(sanitizeNodeDefaults({ effort: 'high', fanOut: true }), { fanOut: true });
});

test('sanitizeNodeDefaults yields undefined for absent/empty/non-object blocks', () => {
  for (const raw of [undefined, null, {}, [], 'x', 7, { model: '' }]) {
    assert.equal(sanitizeNodeDefaults(raw), undefined, `expected undefined for ${JSON.stringify(raw)}`);
  }
});

test('sanitizeWorkflowSteps normalizes defaults but passes unknown node fields through', () => {
  const steps = sanitizeWorkflowSteps([[
    { id: 'a', key: 'planner', defaults: { model: 'm', effort: 'nope' }, custom: { plugin: 'x' } },
    { id: 'b', key: 'reviewer', defaults: {} },
  ]]);
  assert.deepEqual(steps[0][0], { id: 'a', key: 'planner', defaults: { model: 'm' }, custom: { plugin: 'x' } });
  assert.deepEqual(steps[0][1], { id: 'b', key: 'reviewer' }, 'an empty block is dropped entirely');
});

// ── persistence ─────────────────────────────────────────────────────────────

test('writeWorkflow round-trips node defaults; workflowNodeDefaults flattens them', async () => {
  await writeWorkflow({
    id: 'wf_def_rt', name: 'RT',
    steps: [[{ id: 'n0', key: 'planner', defaults: { model: 'claude-opus-4-8', effort: 'high', fanOut: true } }],
      [{ id: 'n1', key: 'reviewer' }]],
    feedbacks: [],
  });
  const tpl = await readWorkflow('wf_def_rt');
  assert.deepEqual(tpl.steps[0][0].defaults, { model: 'claude-opus-4-8', effort: 'high', fanOut: true });
  assert.deepEqual(workflowNodeDefaults(tpl), {
    n0: { model: 'claude-opus-4-8', effort: 'high', fanOut: true },
  });
});

test('setWorkflowNodeDefaults sets, clears, and ignores unknown node ids without touching topology', async () => {
  await writeWorkflow({
    id: 'wf_def_set', name: 'Set',
    steps: [[{ id: 'n0', key: 'planner', defaults: { model: 'old-model' } }], [{ id: 'n1', key: 'reviewer' }]],
    feedbacks: [{ id: 'fb', from: 'n1', to: 'n0' }],
  });

  await setWorkflowNodeDefaults('wf_def_set', {
    n0: { model: 'claude-opus-4-8', effort: 'high' },
    n1: { fanOut: true },
    ghost: { model: 'nope' }, // not in the template -> ignored, never resurrected
  });
  let tpl = await readWorkflow('wf_def_set');
  assert.deepEqual(tpl.steps[0][0].defaults, { model: 'claude-opus-4-8', effort: 'high' });
  assert.deepEqual(tpl.steps[1][0].defaults, { fanOut: true });
  assert.equal(tpl.steps.flat().length, 2, 'topology unchanged');
  assert.deepEqual(tpl.feedbacks, [{ id: 'fb', from: 'n1', to: 'n0' }]);

  // null clears one node; a node absent from the map keeps what it has.
  await setWorkflowNodeDefaults('wf_def_set', { n0: null });
  tpl = await readWorkflow('wf_def_set');
  assert.equal(tpl.steps[0][0].defaults, undefined);
  assert.deepEqual(tpl.steps[1][0].defaults, { fanOut: true }, 'untouched node kept its defaults');
});

test('setWorkflowNodeDefaults refuses the built-in default workflow and unknown ids', async () => {
  await assert.rejects(() => setWorkflowNodeDefaults(GRAPH_DEFAULT_WORKFLOW.id, { n_plan: { fanOut: true } }),
    /cannot store defaults/);
  await assert.rejects(() => setWorkflowNodeDefaults('wf_nope', {}), /not found/);
});

// ── resolution (§4.3) ───────────────────────────────────────────────────────

async function resolve(id) {
  return (await resolveGraph(PROJECT, id, REGISTRY, '/nonexistent-agents-dir')).nodes;
}

/** A one- or two-agent GRAPH whose node `config` IS its defaults block (§4). */
function graph(id, name, nodes) {
  return {
    id, name,
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      ...nodes.map((n, i) => ({ id: n.id, kind: 'agent', key: n.key, x: 240 * (i + 1), y: 0, config: n.config || {} })),
      { id: 'n_end', kind: 'end', x: 240 * (nodes.length + 1), y: 0, config: {} },
    ],
    wires: [],
  };
}

test('a workflow default supplies model/effort when the project has no override', async () => {
  await writeGraphWorkflow(graph('wf_res_a', 'A',
    [{ id: 'n_a', key: 'planner', config: { model: 'claude-opus-4-8', effort: 'high' } }]));
  const nodes = await resolve('wf_res_a');
  assert.equal(nodes.n_a.model, 'claude-opus-4-8');
  assert.equal(nodes.n_a.effort, 'high');
});

test('a per-project override beats the workflow default, and takes its effort with it', async () => {
  await writeGraphWorkflow(graph('wf_res_b', 'B',
    [{ id: 'n_a', key: 'planner', config: { model: 'claude-opus-4-8', effort: 'max' } }]));
  await setNodeModel(PROJECT, 'wf_res_b', 'n_a', { model: 'claude-haiku-4-5' });
  const nodes = await resolve('wf_res_b');
  assert.equal(nodes.n_a.model, 'claude-haiku-4-5');
  // The default's 'max' belonged to Opus — inheriting it here would silently
  // pair an effort with a model that may not advertise it.
  assert.equal(nodes.n_a.effort, undefined);
});

test('workflow defaults sit ABOVE the agent registry for fanOut and askQuestions', async () => {
  await writeGraphWorkflow(graph('wf_res_c', 'C', [
    { id: 'n_a', key: 'planner', config: { fanOut: true, askQuestions: true } },
    { id: 'n_b', key: 'reviewer' },
  ]));
  const nodes = await resolve('wf_res_c');
  assert.equal(nodes.n_a.fanOut, true, 'registry default false -> workflow default true');
  assert.equal(nodes.n_a.askQuestions, true, 'registry questionsDefault false -> workflow true');
  assert.equal(nodes.n_b.fanOut, false, 'a node with no defaults still follows the registry')
});

test('a locked questions agent ignores a workflow default, exactly as it ignores an override', async () => {
  await writeGraphWorkflow(graph('wf_res_d', 'D',
    [{ id: 'n_a', key: 'locked', config: { askQuestions: false } }]));
  const nodes = await resolve('wf_res_d');
  assert.equal(nodes.n_a.askQuestions, true, 'locked agents always follow their manifest');
});

test('a workflow with no defaults resolves exactly as before (no migration needed)', async () => {
  await writeGraphWorkflow(graph('wf_res_e', 'E', [{ id: 'n_a', key: 'planner' }]));
  const nodes = await resolve('wf_res_e');
  assert.equal(nodes.n_a.model, undefined);
  assert.equal(nodes.n_a.effort, undefined);
  assert.equal(nodes.n_a.fanOut, false);
});

test('the legacy per-role config still outranks a workflow default on wf_default', async () => {
  // wf_default carries no defaults by design (D6) — this pins that the legacy
  // path the CLI writes keeps winning wherever both could apply.
  await setStep(PROJECT, 'planner', { model: 'claude-haiku-4-5' });
  const reg = Object.fromEntries(['clarify', 'planner', 'refiner', 'implementer', 'reviewer']
    .map((k) => [k, { key: k, runnerType: k === 'reviewer' ? 'verifier' : 'producer', ...PORTS }]));
  const nodes = (await resolveGraph(PROJECT, GRAPH_DEFAULT_WORKFLOW.id, reg, '/nonexistent-agents-dir')).nodes;
  const planner = Object.values(nodes).find((n) => n.key === 'planner');
  assert.equal(planner.model, 'claude-haiku-4-5');
});
