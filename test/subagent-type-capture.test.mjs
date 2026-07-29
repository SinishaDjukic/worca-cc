// test/subagent-type-capture.test.mjs  (harness copied from skill-capture.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

const ATTR = { nodeId: 'n1', stepIndex: 2, cycle: 1, stepKey: '2:n1' };
const mainTurn = (blocks) => ({ type: 'assistant', raw: { type: 'assistant', message: { content: blocks } } });

function orchWithStep() {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch.state.steps.push({ key: ATTR.stepKey, nodeId: ATTR.nodeId, cycle: ATTR.cycle, status: 'running' });
  return orch;
}

test('a spawned sub-agent captures input.subagent_type onto the record AND the delta', () => {
  const orch = orchWithStep();
  const deltas = [];
  orch.on('subagent', (d) => deltas.push(d));
  orch._onAgentEvent('planner', mainTurn([
    { type: 'tool_use', id: 'sub_1', name: 'Agent', input: { description: 'area A', subagent_type: 'Explore' } },
  ]), ATTR);
  assert.equal(orch.state.subAgents.find((s) => s.id === 'sub_1').subagentType, 'Explore');
  assert.equal(deltas.at(-1).transition, 'spawn');
  assert.equal(deltas.at(-1).subagentType, 'Explore', 'spawn delta carries the type');
});

test('a sub-agent spawned without subagent_type records null and omits it from the delta', () => {
  const orch = orchWithStep();
  const deltas = [];
  orch.on('subagent', (d) => deltas.push(d));
  orch._onAgentEvent('planner', mainTurn([
    { type: 'tool_use', id: 'sub_2', name: 'Agent', input: { description: 'area B' } },
  ]), ATTR);
  assert.equal(orch.state.subAgents.find((s) => s.id === 'sub_2').subagentType, null);
  assert.equal('subagentType' in deltas.at(-1), false, 'no type -> field omitted from delta');
});
