// test/model-switch-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphManifest } from '../src/shared/graph/manifest.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { completedNodeIds, switchableStages, stageChangeError, applyModelSwitch, validateChanges } from '../src/core/model-switch.mjs';
import { checkRows } from './helpers/rows.mjs';

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
  const stages = switchableStages({ manifest, steps: [{ nodeId: 'n_clarify', status: 'done' }, { nodeId: 'n_plan', status: 'paused', sessionId: 's1' }] });
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

// wf_default: n_impl <-> n_review is a cycle (w8/w9); n_refine is self-wired (w5).
const row = (nodeId, status, n = 1) => ({ key: `x:${nodeId}:${n}`, executionId: `x:${nodeId}:${n}`, nodeId, status });
const st = (steps, active, held) => Object.fromEntries(switchableStages({ manifest, steps, active, held }).map((s) => [s.nodeId, s]));
const UP = [row('n_clarify', 'done'), row('n_plan', 'done'), row('n_refine', 'done')];
const wire = (a, b) => ({ id: `w_${a}_${b}`, from: { node: a, port: 'o' }, to: { node: b, port: 'i' } });

test('switchableStages: the state table', async () => {
  await checkRows([
    { name: "a 'start' row is running and locked; later stages are pending", run: () => {
      const s = st([row('n_clarify', 'done'), row('n_plan', 'start')]);
      assert.deepEqual([s.n_plan.state, s.n_plan.switchable], ['running', false]);
      assert.deepEqual([s.n_refine.state, s.n_refine.switchable], ['pending', true]);
    } },
    { name: 'a node the scheduler holds before its row exists is running', run: () => {
      const s = st([row('n_clarify', 'done')], ['n_plan']);
      assert.deepEqual([s.n_plan.state, s.n_plan.switchable], ['running', false]);
    } },
    { name: 'a paused row is switchable', run: () => {
      const s = st([row('n_plan', 'paused')]);
      assert.deepEqual([s.n_plan.state, s.n_plan.switchable], ['paused', true]);
    } },
    { name: 'a loop member that ran is may-rerun while its partner runs or is paused', run: () => {
      const ran = [...UP, row('n_impl', 'done'), row('n_review', 'done')];
      const s = st([...ran, row('n_impl', 'start', 2)]);
      assert.deepEqual([s.n_review.state, s.n_review.switchable], ['may-rerun', true]);
      assert.equal(s.n_impl.state, 'running');
      assert.equal(st([...ran, row('n_impl', 'paused', 2)]).n_review.state, 'may-rerun');
      assert.equal(st(ran, ['n_impl']).n_review.state, 'may-rerun', 'active counts as open');
    } },
    { name: 'the same member is completed once every cycle member is done', run: () => {
      const s = st([...UP, row('n_impl', 'done'), row('n_review', 'done'), row('n_impl', 'done', 2), row('n_review', 'done', 2)]);
      assert.deepEqual([s.n_review.state, s.n_review.switchable], ['completed', false]);
      assert.equal(s.n_impl.state, 'completed');
    } },
    { name: 'a loop held at its cycle-cap gate is still going: "another cycle" re-runs its members', run: () => {
      const capped = [...UP, ...[1, 2, 3].flatMap((n) => [row('n_impl', 'done', n), row('n_review', 'done', n)])];
      assert.deepEqual([st(capped).n_impl.state, st(capped).n_review.state], ['completed', 'completed'], 'no hold: the loop ended');
      const s = st(capped, [], ['w9']);   // Review -> Implement held at maxCycles
      assert.deepEqual([s.n_impl.state, s.n_impl.switchable], ['may-rerun', true]);
      assert.deepEqual([s.n_review.state, s.n_review.switchable], ['may-rerun', true]);
      assert.deepEqual([s.n_refine.state, s.n_clarify.state], ['completed', 'completed'], 'a hold opens only its own loop');
      assert.equal(st(UP, [], ['w5']).n_refine.state, 'may-rerun', 'a held self-loop');
    } },
    { name: 'a held wire that is no loop wire, or names no wire, opens nothing', run: () => {
      const capped = [...UP, row('n_impl', 'done'), row('n_review', 'done')];
      const s = st(capped, [], ['w6', 'w_nope']);   // w6: Refine -> Implement, one-way into the loop
      assert.deepEqual([s.n_impl.state, s.n_review.state], ['completed', 'completed']);
    } },
    { name: 'a self-wired node is on a cycle but has no OTHER member: done reads completed', run: () => {
      assert.equal(st(UP).n_refine.state, 'completed');
      assert.equal(st([row('n_refine', 'done'), row('n_refine', 'start', 2)]).n_refine.state, 'running');
    } },
    { name: 'a never-fired member does not keep a finished loop open', run: () => {
      const tri = { graph: { nodes: ['n_a', 'n_b', 'n_fix'].map((id) => ({ id, kind: 'agent', key: id })),
        wires: [wire('n_a', 'n_b'), wire('n_b', 'n_a'), wire('n_b', 'n_fix'), wire('n_fix', 'n_b')] } };
      const s = Object.fromEntries(switchableStages({ manifest: tri, steps: [row('n_a', 'done'), row('n_b', 'done')] })
        .map((x) => [x.nodeId, x]));
      assert.deepEqual([s.n_a.state, s.n_b.state, s.n_fix.state], ['completed', 'completed', 'pending']);
    } },
    { name: 'a one-way stage that finished stays locked', run: () => {
      const s = st([row('n_clarify', 'done'), row('n_impl', 'start')]);
      assert.deepEqual([s.n_clarify.state, s.n_clarify.switchable], ['completed', false]);
    } },
    { name: 'done plus an error row reads pending, as before', run: () => {
      assert.equal(st([row('n_plan', 'done'), row('n_plan', 'error', 2)]).n_plan.state, 'pending');
    } },
  ]);
});

test('validateChanges: refuses unknown stages and invalid selections, normalizes, ignores `switchable`', () => {
  const stages = switchableStages({ manifest, steps: [row('n_clarify', 'done')] });
  assert.throws(() => validateChanges(stages, { n_nope: { model: '' } }, MODELS), (e) => e.code === 'UNKNOWN_STAGE' && e.status === 400);
  assert.throws(() => validateChanges(stages, { n_plan: { model: 'nope' } }, MODELS), (e) => e.code === 'INVALID_SELECTION');
  assert.throws(() => validateChanges(stages, {}, MODELS), (e) => e.code === 'BAD_REQUEST');
  assert.deepEqual(validateChanges(stages, { n_clarify: { model: ' claude-opus-5-5 ', effort: null } }, MODELS),
    { n_clarify: { model: 'claude-opus-5-5', effort: '' } }, 'a locked stage is validated, not refused');
});
