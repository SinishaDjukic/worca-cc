// test/subagent-backstop.test.mjs — step-boundary force-close of still-running subs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

const NODE = { nodeId: 'n1', key: 'planner', uiPhase: 'plan' };
const spawnEvt = (id) => ({
  type: 'assistant',
  raw: { type: 'assistant', message: { content: [
    { type: 'tool_use', id, name: 'Agent', input: { description: 'd' } },
  ] } },
});

function withSpawn(status) {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const stepKey = orch._stepKeyFor(NODE, 0, 1); // "0:n1"
  orch._onAgentEvent('planner', spawnEvt('toolu_A'),
    { nodeId: 'n1', stepIndex: 0, cycle: 1, stepKey });
  if (status) orch.state.status = status; // simulate a stopped/errored run
  return orch;
}

test("a node's 'done' marker force-closes its still-running subs to finished", () => {
  const orch = withSpawn();
  orch._nodeStep(NODE, 0, 1, 'done');
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_A').status, 'finished');
});

test("when the run is stopped, the backstop closes them as 'stopped'", () => {
  const orch = withSpawn('stopped');
  orch._nodeStep(NODE, 0, 1, 'done');
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_A').status, 'stopped');
});

test('the backstop emits a finish delta for each forced sub-agent', () => {
  const orch = withSpawn();
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._nodeStep(NODE, 0, 1, 'done');
  const fin = evts.find((m) => m.transition === 'finish' && m.id === 'toolu_A');
  assert.ok(fin, 'a finish delta fires for the forced sub-agent');
  assert.equal(fin.status, 'finished');
});

test('the backstop only touches THIS step’s subs and never re-closes a terminal one', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  // Two subs on two different steps; close only step 0:n1.
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), { nodeId: 'n1', stepIndex: 0, cycle: 1, stepKey: '0:n1' });
  orch._onAgentEvent('planner', spawnEvt('toolu_B'), { nodeId: 'n2', stepIndex: 1, cycle: 1, stepKey: '1:n2' });
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._nodeStep(NODE, 0, 1, 'done'); // stepKey "0:n1"
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_A').status, 'finished');
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_B').status, 'running', 'other step untouched');
  // 'start' must never close anything.
  orch._nodeStep({ nodeId: 'n2', key: 'x' }, 1, 1, 'start');
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_B').status, 'running');
  assert.equal(evts.filter((m) => m.transition === 'finish').length, 1, 'exactly one forced finish');
});
