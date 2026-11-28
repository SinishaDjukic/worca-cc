// test/workflow-node-defaults.test.mjs — per-node workflow defaults
// (newpipeline-ux-design.md §4.4): sanitization at write time, the resolution
// layer resolveGraph inserts between run-config and the agent registry, and
// the setWorkflowNodeDefaults writer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRows } from './helpers/rows.mjs';

process.env.WORCA_HOME = mkdtempSync(join(tmpdir(), 'worca-wfdef-'));

const {
  writeGraphWorkflow, resolveGraph, setWorkflowNodeDefaults,
  sanitizeNodeDefaults, GRAPH_DEFAULT_WORKFLOW,
} = await import('../src/core/workflows.mjs');
const { setStep } = await import('../src/core/config.mjs');

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

// [input, expected] per original test title.
const SANITIZE = {
  'sanitizeNodeDefaults keeps well-formed fields and drops malformed ones individually': [
    [{ model: '  claude-opus-4-8 ', effort: 'high', fanOut: true, askQuestions: false },
      { model: 'claude-opus-4-8', effort: 'high', fanOut: true, askQuestions: false }],
    // A bad field is dropped; its siblings survive (loud-and-lenient house style).
    [{ model: 'm', effort: 'ludicrous', fanOut: 'yes', askQuestions: true }, { model: 'm', askQuestions: true }],
  ],
  'sanitizeNodeDefaults refuses an effort with no model to interpret it': [
    [{ effort: 'high' }, undefined],
    [{ effort: 'high', fanOut: true }, { fanOut: true }],
  ],
  'sanitizeNodeDefaults yields undefined for absent/empty/non-object blocks':
    [undefined, null, {}, [], 'x', 7, { model: '' }].map((raw) => [raw, undefined]),
};

test('sanitizeNodeDefaults: keeps well-formed fields, drops malformed ones individually, refuses a model-less effort, undefined for empty/non-object', async () => {
  await checkRows(Object.entries(SANITIZE).map(([name, cases]) => ({ name, run: () => {
    for (const [raw, expected] of cases) {
      assert.deepEqual(sanitizeNodeDefaults(raw), expected, `expected ${JSON.stringify(expected)} for ${JSON.stringify(raw)}`);
    }
  } })));
});

// ── persistence ─────────────────────────────────────────────────────────────

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

test('a defaults patch naming the stored model and no engine keeps the engine; null or another model clears it', async () => {
  await writeGraphWorkflow(graph('wf_eng_a', 'E', [{ id: 'n_a', key: 'planner', config: { model: 'gpt-5.5', engine: 'codex' } }]));
  const cfg = async (patch) => (await setWorkflowNodeDefaults('wf_eng_a', { n_a: patch })).nodes.find((n) => n.id === 'n_a').config;
  assert.deepEqual(await cfg({ model: 'gpt-5.5', effort: 'low' }), { model: 'gpt-5.5', effort: 'low', engine: 'codex' });
  assert.deepEqual(await cfg({ model: 'gpt-5.5', engine: null }), { model: 'gpt-5.5' });
  await cfg({ model: 'gpt-5.5', engine: 'codex' });
  assert.deepEqual(await cfg({ model: 'gpt-5.6-sol' }), { model: 'gpt-5.6-sol' });
});
