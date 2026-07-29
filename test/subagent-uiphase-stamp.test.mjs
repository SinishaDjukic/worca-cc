// test/subagent-uiphase-stamp.test.mjs — spawn record + subagent delta carry uiPhase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

function spawnRaw(id, desc) {
  return { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Task', input: { description: desc } }] } };
}

test('_recordSubAgentSpawns stamps uiPhase from attr onto the record', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch._recordSubAgentSpawns(spawnRaw('t1', 'research'), { nodeId: 's0_0', stepIndex: 0, cycle: 0, stepKey: '0:s0_0', uiPhase: 'plan' });
  assert.equal(orch.state.subAgents.length, 1);
  assert.equal(orch.state.subAgents[0].uiPhase, 'plan', 'record carries uiPhase');
});

test('_subAgentTransition emits uiPhase in the subagent delta', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const seen = [];
  orch.on('subagent', (e) => seen.push(e));
  orch._recordSubAgentSpawns(spawnRaw('t2', 'scan'), { nodeId: 's1_0', stepIndex: 1, cycle: 2, stepKey: '1:s1_0', uiPhase: 'refine' });
  assert.equal(seen.length, 1, 'one spawn delta emitted');
  assert.equal(seen[0].transition, 'spawn');
  assert.equal(seen[0].uiPhase, 'refine', 'delta carries uiPhase');
});
