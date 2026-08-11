// test/subagent-backstop.test.mjs — execution-boundary force-close of running subs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

// The graph engine keys everything by executionId, which IS the step key. The
// minimal _execStep ctx is that pair plus the ordinal and the UI phase.
const EXEC = { executionId: 'x:n1:1', nodeId: 'n1', ordinal: 1, uiPhase: 'plan' };
const spawnEvt = (id) => ({
  type: 'assistant',
  raw: { type: 'assistant', message: { content: [
    { type: 'tool_use', id, name: 'Agent', input: { description: 'd' } },
  ] } },
});

function withSpawn(status) {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch._onAgentEvent('planner', spawnEvt('toolu_A'),
    { nodeId: 'n1', executionId: EXEC.executionId, cycle: 1, stepKey: EXEC.executionId });
  if (status) orch.state.status = status; // simulate a stopped/errored run
  return orch;
}

test("a node's 'done' marker force-closes its still-running subs to finished", () => {
  const orch = withSpawn();
  orch._execStep(EXEC, 'done');
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_A').status, 'finished');
});

test("when the run is stopped, the backstop closes them as 'stopped'", () => {
  const orch = withSpawn('stopped');
  orch._execStep(EXEC, 'done');
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_A').status, 'stopped');
});

test('the backstop emits a finish delta for each forced sub-agent', () => {
  const orch = withSpawn();
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._execStep(EXEC, 'done');
  const fin = evts.find((m) => m.transition === 'finish' && m.id === 'toolu_A');
  assert.ok(fin, 'a finish delta fires for the forced sub-agent');
  assert.equal(fin.status, 'finished');
});

test('the backstop only touches THIS execution’s subs and never re-closes a terminal one', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  // Two subs on two different executions; close only x:n1:1.
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), { nodeId: 'n1', executionId: 'x:n1:1', cycle: 1, stepKey: 'x:n1:1' });
  orch._onAgentEvent('planner', spawnEvt('toolu_B'), { nodeId: 'n2', executionId: 'x:n2:1', cycle: 1, stepKey: 'x:n2:1' });
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._execStep(EXEC, 'done'); // executionId "x:n1:1"
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_A').status, 'finished');
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_B').status, 'running', 'other execution untouched');
  // 'start' must never close anything.
  orch._execStep({ executionId: 'x:n2:1', nodeId: 'n2', ordinal: 1, uiPhase: 'x' }, 'start');
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_B').status, 'running');
  assert.equal(evts.filter((m) => m.transition === 'finish').length, 1, 'exactly one forced finish');
});
