// test/subagent-lifecycle.test.mjs — spawn/finish reducer over _onAgentEvent
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { checkRows } from './helpers/rows.mjs';

const ATTR = { nodeId: 'n1', stepIndex: 2, cycle: 1, stepKey: '2:n1' };
const spawnEvt = (id, name = 'Task', description = 'research auth') => ({
  type: 'assistant',
  raw: { type: 'assistant', message: { content: [
    { type: 'tool_use', id, name, input: { description } },
  ] } },
});

function fresh() { return createOrchestrator({ projectDir: '/tmp/proj' }); }

test('a new Task tool_use pushes a running record carrying attr and emits a matching spawn delta', async () => {
  const orch = fresh();
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  await checkRows([
    { name: 'a new Task tool_use pushes a running sub-agent record carrying attr', run: () => {
      assert.equal(orch.state.subAgents.length, 1);
      const r = orch.state.subAgents[0];
      assert.equal(r.id, 'toolu_A');
      assert.equal(r.label, 'research auth');
      assert.equal(r.nodeId, 'n1');
      assert.equal(r.stepIndex, 2);
      assert.equal(r.cycle, 1);
      assert.equal(r.stepKey, '2:n1');
      assert.equal(r.status, 'running');
      assert.ok(r.startedAt, 'startedAt stamped');
      assert.equal(r.finishedAt, null);
    } },
    { name: 'spawn emits a subagent event with transition:spawn and the record fields', run: () => {
      assert.equal(evts.length, 1);
      assert.equal(evts[0].transition, 'spawn');
      assert.equal(evts[0].id, 'toolu_A');
      assert.equal(evts[0].label, 'research auth');
      assert.equal(evts[0].nodeId, 'n1');
      assert.equal(evts[0].stepKey, '2:n1');
      assert.equal(evts[0].stepIndex, 2);
      assert.equal(evts[0].cycle, 1);
      assert.equal(evts[0].status, 'running');
      assert.ok(evts[0].ts, 'carries a ts');
    } },
  ]);
});

const ATTR2 = { nodeId: 'n1', stepIndex: 2, cycle: 1, stepKey: '2:n1' };
const finishEvt = (toolUseId, isError = false) => ({
  type: 'user',
  raw: { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: toolUseId, ...(isError ? { is_error: true } : {}) },
  ] } },
});

test('a tool_result for a tracked spawn finishes it (finishedAt stamped) and emits one finish delta; is_error:true marks it error', async () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR2);
  orch._onAgentEvent('planner', finishEvt('toolu_A'));
  await checkRows([
    { name: 'a tool_result matching a tracked spawn marks it finished + stamps finishedAt', run: () => {
      const r = orch.state.subAgents.find((s) => s.id === 'toolu_A');
      assert.equal(r.status, 'finished');
      assert.ok(r.finishedAt, 'finishedAt stamped');
    } },
    { name: 'finish emits a subagent event with transition:finish + terminal status', run: () => {
      const fin = evts.find((m) => m.transition === 'finish');
      assert.ok(fin, 'a finish delta is emitted');
      assert.equal(fin.id, 'toolu_A');
      assert.equal(fin.status, 'finished');
    } },
    { name: 'a tool_result with is_error:true marks the sub-agent error', run: () => {
      const orch = createOrchestrator({ projectDir: '/tmp/proj' });
      orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR2);
      orch._onAgentEvent('planner', finishEvt('toolu_A', true));
      assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_A').status, 'error');
    } },
  ]);
});

test('ignored frames: a spawn with no attr, a tool_result for an unknown id and a non-Agent tool_use leave no record and never throw', async () => {
  await checkRows([
    { name: 'a spawn with no attr in scope (clarify pre-step) is ignored, not crashed', run: () => {
      const orch = fresh();
      orch._onAgentEvent('planner', spawnEvt('toolu_A')); // attr === null
      assert.equal(orch.state.subAgents.length, 0, 'no attr → no record (cannot attribute to a step)');
    } },
    { name: 'a tool_result for an UNKNOWN id is ignored (no record, no throw)', run: () => {
      const orch = createOrchestrator({ projectDir: '/tmp/proj' });
      orch._onAgentEvent('planner', finishEvt('not_a_subagent'));
      assert.equal(orch.state.subAgents.length, 0);
    } },
    { name: 'a non-sub-agent tool_use (Read) never becomes a sub-agent record', run: () => {
      const orch = createOrchestrator({ projectDir: '/tmp/proj' });
      orch._onAgentEvent('planner', { type: 'assistant', raw: { type: 'assistant', message: { content: [
        { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/x' } } ] } } },
        { nodeId: 'n', stepIndex: 0, cycle: 1, stepKey: '0:n' });
      assert.equal(orch.state.subAgents.length, 0);
    } },
  ]);
});

test('idempotency: a repeated spawn id records once; a late finish never flips a terminal record or re-emits', async () => {
  await checkRows([
    { name: 'the same Task id is recorded once (idempotent spawn)', run: () => {
      const orch = fresh();
      orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
      orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
      assert.equal(orch.state.subAgents.length, 1, 'a repeated tool_use id does not duplicate');
    } },
    { name: 'a finish for an already-terminal sub-agent does not flip it back or re-emit', run: () => {
      const orch = createOrchestrator({ projectDir: '/tmp/proj' });
      const evts = [];
      orch.on('subagent', (m) => evts.push(m));
      orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR2);
      orch._onAgentEvent('planner', finishEvt('toolu_A'));
      orch._onAgentEvent('planner', finishEvt('toolu_A', true)); // late duplicate
      assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_A').status, 'finished', 'stays finished');
      assert.equal(evts.filter((m) => m.transition === 'finish').length, 1, 'finish emitted once');
    } },
  ]);
});

test("both 'Task' and 'Agent' tool_use names are tracked (CLI v2.1.63 rename)", () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const ev = (id, name) => ({ type: 'assistant', raw: { type: 'assistant', message: { content: [
    { type: 'tool_use', id, name, input: { description: `${name} job` } } ] } } });
  orch._onAgentEvent('planner', ev('id_task', 'Task'),  { nodeId: 'n', stepIndex: 0, cycle: 1, stepKey: '0:n' });
  orch._onAgentEvent('planner', ev('id_agent', 'Agent'), { nodeId: 'n', stepIndex: 0, cycle: 1, stepKey: '0:n' });
  const ids = orch.state.subAgents.map((s) => s.id).sort();
  assert.deepEqual(ids, ['id_agent', 'id_task'], 'both alias names spawn a record');
});

test('a subagent delta does NOT carry its own runId (the server stamps the run UUID)', () => {
  const orch = fresh();
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  assert.equal(evts.length, 1, 'one spawn delta emitted');
  assert.ok(!('runId' in evts[0]),
    'subagent payloads must not self-tag runId; wireRun owns the authoritative tag');
});

// ── the model each child ran on (sub_agents.run_model) ──────────────────────

const spawnWithModel = (id, model) => ({
  type: 'assistant',
  raw: { type: 'assistant', message: { content: [
    { type: 'tool_use', id, name: 'Task', input: { description: 'research auth', ...(model ? { model } : {}) } },
  ] } },
});

test('runModel: the Task-call alias wins, else the parent model, else null — and the spawn delta carries it', async () => {
  await checkRows([
    { name: 'a child that names a model records THAT model, not the parent\'s', run: () => {
      const orch = fresh();
      orch._onAgentEvent('planner', spawnWithModel('toolu_M', 'sonnet'), { ...ATTR, model: 'claude-fable-5-1' });
      assert.equal(orch.state.subAgents[0].runModel, 'sonnet',
        'the alias the Task call asked for — this is what proves a policy fired');
    } },
    { name: 'a child that names no model records the parent model it inherits', run: () => {
      const orch = fresh();
      orch._onAgentEvent('planner', spawnWithModel('toolu_N', null), { ...ATTR, model: 'claude-fable-5-1' });
      assert.equal(orch.state.subAgents[0].runModel, 'claude-fable-5-1');
    } },
    { name: 'with no parent model either, the child records nothing rather than a guess', run: () => {
      const orch = fresh();
      orch._onAgentEvent('planner', spawnWithModel('toolu_O', null), ATTR);
      assert.equal(orch.state.subAgents[0].runModel, null);
    } },
    { name: 'the spawn delta carries runModel, so the live view can paint the pill immediately', run: () => {
      const orch = fresh();
      const evts = [];
      orch.on('subagent', (m) => evts.push(m));
      orch._onAgentEvent('planner', spawnWithModel('toolu_P', 'sonnet'), { ...ATTR, model: 'claude-fable-5-1' });
      assert.equal(evts.length, 1);
      assert.equal(evts[0].runModel, 'sonnet',
        'without this the Running view shows no model pill until the next full state snapshot');
    } },
  ]);
});

// ── moved from subagent-state / subagent-uiphase-stamp / subagent-type-capture ──

test('getState() deep-clones subAgents (mutating the clone never touches live state)', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch.state.subAgents.push({ id: 'a', status: 'running' });
  const snap = orch.getState();
  snap.subAgents[0].status = 'finished';
  assert.equal(orch.state.subAgents[0].status, 'running', 'clone must not alias live records');
  assert.equal(snap.subAgents.length, 1);
});

const subagentSpawn = (id, desc) => ({ type: 'subagent', event: 'spawn', toolUseId: id, label: desc });

test('_recordSubAgentSpawn stamps uiPhase from attr onto the record and the spawn delta', async () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const seen = [];
  orch.on('subagent', (e) => seen.push(e));
  orch._recordSubAgentSpawn(subagentSpawn('t1', 'research'), { nodeId: 's0_0', stepIndex: 0, cycle: 0, stepKey: '0:s0_0', uiPhase: 'plan' });
  await checkRows([
    { name: '_recordSubAgentSpawn stamps uiPhase from attr onto the record', run: () => {
      assert.equal(orch.state.subAgents.length, 1);
      assert.equal(orch.state.subAgents[0].uiPhase, 'plan', 'record carries uiPhase');
    } },
    { name: '_subAgentTransition emits uiPhase in the subagent delta', run: () => {
      assert.equal(seen.length, 1, 'one spawn delta emitted');
      assert.equal(seen[0].transition, 'spawn');
      assert.equal(seen[0].uiPhase, 'plan', 'delta carries uiPhase');
    } },
  ]);
});

const mainTurn = (blocks) => ({ type: 'assistant', raw: { type: 'assistant', message: { content: blocks } } });

test('subagent_type is captured onto the record and the spawn delta; absent -> null on the record and omitted from the delta', async () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch.state.steps.push({ key: ATTR.stepKey, nodeId: ATTR.nodeId, cycle: ATTR.cycle, status: 'running' });
  const deltas = [];
  orch.on('subagent', (d) => deltas.push(d));
  orch._onAgentEvent('planner', mainTurn([
    { type: 'tool_use', id: 'sub_1', name: 'Agent', input: { description: 'area A', subagent_type: 'Explore' } },
  ]), ATTR);
  const typed = deltas.at(-1);
  orch._onAgentEvent('planner', mainTurn([
    { type: 'tool_use', id: 'sub_2', name: 'Agent', input: { description: 'area B' } },
  ]), ATTR);
  const untyped = deltas.at(-1);
  await checkRows([
    { name: 'a spawned sub-agent captures input.subagent_type onto the record AND the delta', run: () => {
      assert.equal(orch.state.subAgents.find((s) => s.id === 'sub_1').subagentType, 'Explore');
      assert.equal(typed.transition, 'spawn');
      assert.equal(typed.subagentType, 'Explore', 'spawn delta carries the type');
    } },
    { name: 'a sub-agent spawned without subagent_type records null and omits it from the delta', run: () => {
      assert.equal(orch.state.subAgents.find((s) => s.id === 'sub_2').subagentType, null);
      assert.equal('subagentType' in untyped, false, 'no type -> field omitted from delta');
    } },
  ]);
});
