// test/subagent-lifecycle.test.mjs — spawn/finish reducer over _onAgentEvent
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

const ATTR = { nodeId: 'n1', stepIndex: 2, cycle: 1, stepKey: '2:n1' };
const spawnEvt = (id, name = 'Task', description = 'research auth') => ({
  type: 'assistant',
  raw: { type: 'assistant', message: { content: [
    { type: 'tool_use', id, name, input: { description } },
  ] } },
});

function fresh() { return createOrchestrator({ projectDir: '/tmp/proj' }); }

test('a new Task tool_use pushes a running sub-agent record carrying attr', () => {
  const orch = fresh();
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
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
});

test('spawn emits a subagent event with transition:spawn and the record fields', () => {
  const orch = fresh();
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
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
});

test('the same Task id is recorded once (idempotent spawn)', () => {
  const orch = fresh();
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  assert.equal(orch.state.subAgents.length, 1, 'a repeated tool_use id does not duplicate');
});

test('a spawn with no attr in scope (clarify pre-step) is ignored, not crashed', () => {
  const orch = fresh();
  orch._onAgentEvent('planner', spawnEvt('toolu_A')); // attr === null
  assert.equal(orch.state.subAgents.length, 0, 'no attr → no record (cannot attribute to a step)');
});

const ATTR2 = { nodeId: 'n1', stepIndex: 2, cycle: 1, stepKey: '2:n1' };
const finishEvt = (toolUseId, isError = false) => ({
  type: 'user',
  raw: { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: toolUseId, ...(isError ? { is_error: true } : {}) },
  ] } },
});

test('a tool_result matching a tracked spawn marks it finished + stamps finishedAt', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR2);
  orch._onAgentEvent('planner', finishEvt('toolu_A'));
  const r = orch.state.subAgents.find((s) => s.id === 'toolu_A');
  assert.equal(r.status, 'finished');
  assert.ok(r.finishedAt, 'finishedAt stamped');
});

test('a tool_result with is_error:true marks the sub-agent error', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR2);
  orch._onAgentEvent('planner', finishEvt('toolu_A', true));
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_A').status, 'error');
});

test('finish emits a subagent event with transition:finish + terminal status', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR2);
  orch._onAgentEvent('planner', finishEvt('toolu_A'));
  const fin = evts.find((m) => m.transition === 'finish');
  assert.ok(fin, 'a finish delta is emitted');
  assert.equal(fin.id, 'toolu_A');
  assert.equal(fin.status, 'finished');
});

test('a tool_result for an UNKNOWN id is ignored (no record, no throw)', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch._onAgentEvent('planner', finishEvt('not_a_subagent'));
  assert.equal(orch.state.subAgents.length, 0);
});

test('a finish for an already-terminal sub-agent does not flip it back or re-emit', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR2);
  orch._onAgentEvent('planner', finishEvt('toolu_A'));
  orch._onAgentEvent('planner', finishEvt('toolu_A', true)); // late duplicate
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_A').status, 'finished', 'stays finished');
  assert.equal(evts.filter((m) => m.transition === 'finish').length, 1, 'finish emitted once');
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

test('a non-sub-agent tool_use (Read) never becomes a sub-agent record', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch._onAgentEvent('planner', { type: 'assistant', raw: { type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/x' } } ] } } },
    { nodeId: 'n', stepIndex: 0, cycle: 1, stepKey: '0:n' });
  assert.equal(orch.state.subAgents.length, 0);
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
