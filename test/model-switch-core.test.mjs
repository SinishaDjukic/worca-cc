// test/model-switch-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphManifest } from '../src/shared/graph/manifest.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { completedNodeIds, switchableStages, stageChangeError, applyModelSwitch, validateChanges, engineCatalog, assertPerStageModels,
  subagentModelsOf, subagentEffortsOf } from '../src/core/model-switch.mjs';
import { EFFORTS, ALL_EFFORTS, SUBAGENT_MODEL_VALUES } from '../src/core/model-env.mjs';
import { HARNESS_EFFORTS } from '../src/shared/connections.mjs';
import { ctxSubagentModel, investigatorAgents, INVESTIGATOR_AGENT } from '../src/core/phases.mjs';
import { codexInvestigatorRole } from '../src/core/engines/codex.mjs';
import { copilotInvestigatorAgent } from '../src/core/engines/copilot.mjs';
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
const st = (steps, active, held, ready) => Object.fromEntries(switchableStages({ manifest, steps, active, held, ready }).map((s) => [s.nodeId, s]));
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
    { name: 'a loop partner the scheduler holds READY (no row yet: waiting for an agent slot) keeps the loop open', run: () => {
      const implDone = [...UP, row('n_impl', 'done')];
      assert.equal(st(implDone).n_impl.state, 'completed', 'without the scheduler view the loop reads closed');
      const s = st(implDone, [], [], ['n_review']);
      assert.deepEqual([s.n_impl.state, s.n_impl.switchable], ['may-rerun', true], 'Review will fire and may send Implement round again');
      assert.deepEqual([s.n_review.state, s.n_review.switchable], ['pending', true], 'a ready node has not started: still switchable');
    } },
    { name: 'a ready node off any cycle opens nothing', run: () => {
      const s = st([row('n_clarify', 'done')], [], [], ['n_plan']);
      assert.deepEqual([s.n_plan.state, s.n_clarify.state], ['pending', 'completed']);
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

const CODEX = { id: 'gpt-6.1-sol', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'] };
const BOTH = { id: 'gw-shared', upstream: { provider: 'openai', api: 'openai-responses' }, efforts: ['medium', 'high'] };
const CURSOR = { id: 'cursor-auto', engine: 'cursor', efforts: [] };
const ALL = [...MODELS, CODEX, BOTH, CURSOR];

test('stageChangeError refuses a model the run engine cannot run, and checks efforts in its vocabulary', () => {
  const cell = { model: 'claude-opus-5-5', effort: '', subagentModel: '', subagentEffort: '' };
  assert.match(stageChangeError(cell, { model: CODEX.id }, ALL), /runs on Codex, not on Claude/);
  assert.match(stageChangeError(cell, { model: 'claude-opus-5-5' }, ALL, { engine: 'codex' }), /runs on Claude, not on Codex/);
  assert.equal(stageChangeError(cell, { model: CODEX.id, effort: 'low' }, ALL, { engine: 'codex' }), '');
  assert.match(stageChangeError(cell, { model: CODEX.id, effort: 'xhigh' }, ALL, { engine: 'codex' }), /unknown effort "xhigh"/);
  // A model on two harnesses runs on both.
  assert.equal(stageChangeError(cell, { model: BOTH.id }, ALL), '');
  assert.equal(stageChangeError(cell, { model: BOTH.id }, ALL, { engine: 'codex' }), '');
  // Cursor: no efforts, no sub-agents.
  assert.match(stageChangeError(cell, { model: CURSOR.id, effort: 'medium' }, ALL, { engine: 'cursor' }), /unknown effort "medium"/);
  assert.match(stageChangeError(cell, { subagentModel: 'opus' }, ALL, { engine: 'cursor' }), /runs no sub-agents/);
  assert.equal(stageChangeError(cell, { subagentModel: '' }, ALL, { engine: 'cursor' }), '');
});

test('stageChangeError: an effort on a foreign model is refused; sub-agent changes and clearing the effort pass', () => {
  const foreign = { model: 'claude-opus-5-5', effort: '', subagentModel: '', subagentEffort: '' };
  assert.match(stageChangeError(foreign, { effort: 'low' }, ALL, { engine: 'codex' }), /runs on Claude, not on Codex/);
  assert.equal(stageChangeError(foreign, { effort: '' }, ALL, { engine: 'codex' }), '');
  assert.match(stageChangeError(foreign, { effort: 'medium' }, ALL, { engine: 'cursor' }), /runs on Claude, not on Cursor/);
  assert.equal(stageChangeError(foreign, { subagentEffort: 'high' }, ALL, { engine: 'codex' }), '');
  assert.equal(stageChangeError(foreign, { subagentModel: '' }, ALL, { engine: 'codex' }), '');
});

test('stageChangeError: a sub-agent value the run engine would drop is refused; clearing passes (I1)', () => {
  const cell = { model: '', effort: '', subagentModel: 'opus', subagentEffort: 'xhigh' };
  // Claude: every sub-agent model and effort.
  assert.equal(stageChangeError(cell, { subagentModel: 'sonnet', subagentEffort: 'max' }, ALL), '');
  // Codex: no sub-agent model; a sub-agent effort only where the investigator role carries it as itself.
  assert.equal(stageChangeError(cell, { subagentEffort: 'medium' }, ALL, { engine: 'codex' }), '');
  assert.equal(stageChangeError(cell, { subagentEffort: 'high' }, ALL, { engine: 'codex' }), '');
  for (const e of ['minimal', 'low', 'xhigh', 'max']) {
    assert.equal(stageChangeError(cell, { subagentEffort: e }, ALL, { engine: 'codex' }), `unknown sub-agent effort "${e}" on Codex`);
  }
  for (const m of ['opus', 'auto', 'inherit']) {
    assert.equal(stageChangeError(cell, { subagentModel: m }, ALL, { engine: 'codex' }), 'Codex does not take a sub-agent model — leave it on Default');
  }
  // Copilot: its investigator runs on the node's model and effort.
  assert.equal(stageChangeError(cell, { subagentModel: 'opus' }, ALL, { engine: 'copilot' }), 'Copilot does not take a sub-agent model — leave it on Default');
  assert.equal(stageChangeError(cell, { subagentEffort: 'high' }, ALL, { engine: 'copilot' }), 'Copilot does not take a sub-agent effort — leave it on Default');
  // Clearing always passes; a stored value nobody touched blocks nothing.
  for (const engine of ['claude', 'codex', 'copilot', 'cursor']) {
    assert.equal(stageChangeError(cell, { subagentModel: '', subagentEffort: '' }, ALL, { engine }), '', engine);
  }
  assert.equal(stageChangeError(cell, { model: CODEX.id }, ALL, { engine: 'codex' }), '');
});

test('the per-engine sub-agent lists are what each runtime applies (phases.mjs, engines/codex.mjs, engines/copilot.mjs)', () => {
  const ctx = (node) => ({ node: { fanOut: true, ...node } });
  // Claude: the node keeps every stored model (the prompt block) and effort (the --agents definition).
  assert.deepEqual(subagentModelsOf('claude'), SUBAGENT_MODEL_VALUES.filter((m) => ctxSubagentModel(ctx({ subagentModel: m })) === m));
  assert.deepEqual(subagentEffortsOf('claude'), EFFORTS.filter((e) => investigatorAgents(ctx({ subagentEffort: e }))?.[INVESTIGATOR_AGENT]?.effort === e));
  // Codex: the role never carries a sub-agent model, and carries an effort as itself only for a Codex effort.
  const role = (node) => codexInvestigatorRole({ agents: investigatorAgents(ctx({ subagentEffort: 'high', ...node })) });
  assert.deepEqual(SUBAGENT_MODEL_VALUES.filter((m) => role({ subagentModel: m }).model), []);
  assert.deepEqual(subagentModelsOf('codex'), []);
  const carried = (e) => role({ subagentEffort: e }).toml.includes(`model_reasoning_effort = "${e}"`);
  assert.deepEqual(subagentEffortsOf('codex'), ALL_EFFORTS.filter((e) => carried(e) && HARNESS_EFFORTS.codex.includes(e)));
  assert.deepEqual(subagentEffortsOf('codex'), ['medium', 'high']);
  // Copilot: the investigator agent file is the same whatever model or effort the node pins.
  const agentFile = (node) => copilotInvestigatorAgent({ agents: investigatorAgents(ctx(node)) });
  assert.equal(agentFile({ subagentModel: 'opus', subagentEffort: 'max' }), agentFile({ subagentModel: 'sonnet', subagentEffort: 'medium' }));
  assert.deepEqual([subagentModelsOf('copilot'), subagentEffortsOf('copilot')], [[], []]);
  // Cursor runs no sub-agents; an unknown engine is offered nothing.
  assert.deepEqual([subagentModelsOf('cursor'), subagentEffortsOf('cursor'), subagentModelsOf('nope'), subagentEffortsOf('nope')], [[], [], [], []]);
});

test('engineCatalog: only the models the engine runs, efforts in its vocabulary, hidden ones dropped', () => {
  const ids = (e) => engineCatalog([...ALL, { id: 'claude-hidden', hidden: true, efforts: [] }], e).map((m) => m.id);
  assert.deepEqual(ids('claude'), ['claude-opus-5-5', 'claude-haiku-4-5', 'gw-shared']);
  assert.deepEqual(ids('codex'), ['gpt-6.1-sol', 'gw-shared']);
  assert.deepEqual(engineCatalog(ALL, 'codex').find((m) => m.id === 'gw-shared').efforts, ['medium', 'high']);
});

test('assertPerStageModels: a modelForAll run refuses model/effort touches, keeps sub-agent ones (Review Focus 5)', () => {
  assert.throws(() => assertPerStageModels({ n_impl: { model: 'claude-opus-5-5', effort: '' } }, 'claude-sonnet-5-5'),
    (e) => e.code === 'MODEL_FOR_ALL' && e.status === 409 && /claude-sonnet-5-5/.test(e.message));
  assert.throws(() => assertPerStageModels({ n_impl: { effort: 'high' } }, 'claude-sonnet-5-5'), (e) => e.code === 'MODEL_FOR_ALL');
  assert.doesNotThrow(() => assertPerStageModels({ n_impl: { subagentModel: 'opus' } }, 'claude-sonnet-5-5'));
  assert.doesNotThrow(() => assertPerStageModels({ n_impl: { model: 'claude-opus-5-5' } }, null));
});
