// test/subagent-state.test.mjs — state.subAgents init + getState() deep clone
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

test('a fresh orchestrator exposes an empty subAgents array in state', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  assert.deepEqual(orch.getState().subAgents, []);
});

test('getState() deep-clones subAgents (mutating the clone never touches live state)', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch.state.subAgents.push({ id: 'a', status: 'running' });
  const snap = orch.getState();
  snap.subAgents[0].status = 'finished';
  assert.equal(orch.state.subAgents[0].status, 'running', 'clone must not alias live records');
  assert.equal(snap.subAgents.length, 1);
});
