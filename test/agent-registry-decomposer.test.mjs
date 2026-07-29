import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';

test('decomposer is registered with the expected channel spec', () => {
  const reg = loadAgentRegistry(); // scans the real agents/ dir
  const d = reg.decomposer;
  assert.ok(d, 'decomposer not found in registry');
  assert.equal(d.runnerType, 'producer');
  assert.equal(d.fanOut, true);
  assert.equal(d.scope, 'project');
  assert.deepEqual(d.consumes, ['plan']);
  assert.deepEqual(d.produces, ['decomposition']);
  assert.deepEqual(d.connectsTo, ['implementer']);
  assert.equal(d.agentFile, 'worca-cc-decomposer.md');
});

test('refiner / planner / planReviewer may connect to the decomposer', () => {
  const reg = loadAgentRegistry();
  assert.ok(reg.refiner.connectsTo.includes('decomposer'), 'refiner -> decomposer must be allowed');
  assert.ok(reg.planner.connectsTo.includes('decomposer'), 'planner -> decomposer must be allowed');
  assert.ok(reg.planReviewer.connectsTo.includes('decomposer'), 'planReviewer -> decomposer must be allowed');
});
