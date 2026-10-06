// test/model-switch-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphManifest } from '../src/shared/graph/manifest.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { completedNodeIds, switchableStages, stageChangeError, applyModelSwitch } from '../src/core/model-switch.mjs';

const manifest = buildGraphManifest(GRAPH_DEFAULT_WORKFLOW, loadAgentRegistry());
const MODELS = [
  { id: 'claude-opus-5-5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-haiku-4-5', efforts: ['medium', 'high'] },
];

test('completed = done at least once and nothing open; a paused or failed row keeps it open', () => {
  const steps = [
    { nodeId: 'n_clarify', status: 'done' },
    { nodeId: 'n_plan', status: 'done' }, { nodeId: 'n_plan', status: 'paused' },
    { nodeId: 'n_refine', status: 'error' },
  ];
  assert.deepEqual([...completedNodeIds(steps)], ['n_clarify']);
});

test('switchableStages lists agent nodes only, locks completed ones, marks the paused one', () => {
  const stages = switchableStages({
    resumePoint: { manifest },
    steps: [{ nodeId: 'n_clarify', status: 'done' }, { nodeId: 'n_plan', status: 'paused', sessionId: 's1' }],
  });
  const by = Object.fromEntries(stages.map((s) => [s.nodeId, s]));
  assert.deepEqual(Object.keys(by), ['n_clarify', 'n_plan', 'n_refine', 'n_impl', 'n_review']);
  assert.equal(by.n_clarify.switchable, false); assert.equal(by.n_clarify.state, 'completed');
  assert.equal(by.n_plan.state, 'paused'); assert.equal(by.n_plan.switchable, true);
  assert.equal(by.n_impl.state, 'pending'); assert.equal(by.n_impl.switchable, true);
});

test('stageChangeError checks only touched fields, the merged model/effort pair included', () => {
  const cell = { model: 'claude-opus-5-5', effort: 'xhigh', subagentModel: '', subagentEffort: '' };
  assert.equal(stageChangeError(cell, { model: 'claude-opus-5-5', effort: 'high' }, MODELS), '');
  assert.match(stageChangeError(cell, { model: 'claude-haiku-4-5' }, MODELS), /does not support effort "xhigh"/);
  assert.equal(stageChangeError(cell, { model: 'claude-haiku-4-5', effort: '' }, MODELS), '');
  assert.match(stageChangeError(cell, { model: 'nope' }, MODELS), /unknown model "nope"/);
  assert.match(stageChangeError({ ...cell, model: '' }, { effort: 'high' }, MODELS), /select a model/);
  assert.match(stageChangeError(cell, { subagentModel: 'haiku' }, MODELS), /unknown sub-agent model/);
  assert.match(stageChangeError(cell, { subagentEffort: 'low' }, MODELS), /unknown sub-agent effort "low"/);
  // An untouched model that left the catalog does not block a sub-agent change.
  assert.equal(stageChangeError({ ...cell, model: 'gone-model' }, { subagentModel: 'opus' }, MODELS), '');
});

test('applyModelSwitch rewrites graph cells AND the derived steps cells; no-op changes are dropped', () => {
  const { manifest: next, changed } = applyModelSwitch(manifest, {
    n_refine: { model: 'claude-opus-5-5', effort: 'high', subagentModel: 'opus' },
    n_impl: { model: '' },   // already '' — not a change
  });
  assert.deepEqual(changed.map((c) => c.nodeId), ['n_refine']);
  const cell = next.graph.nodes.find((n) => n.id === 'n_refine');
  assert.equal(cell.model, 'claude-opus-5-5'); assert.equal(cell.effort, 'high'); assert.equal(cell.subagentModel, 'opus');
  const shim = next.steps.flatMap((s) => s.nodes).find((n) => n.id === 'n_refine');
  assert.equal(shim.model, 'claude-opus-5-5'); assert.equal(shim.effort, 'high');
  assert.equal(manifest.graph.nodes.find((n) => n.id === 'n_refine').model, '', 'the input is not mutated');
});
