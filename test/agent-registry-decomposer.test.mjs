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
  assert.deepEqual(d.produces, ['decomposition']);   // the v2 `tasks` output port
  assert.equal(d.connectsTo, '*');                   // v2 drops the authored adjacency list
  assert.equal(d.agentFile, 'worca-cc-decomposer.md');
  assert.deepEqual(d.inputs.map((p) => p.id), ['plan']);
  assert.deepEqual(d.outputs.map((p) => p.id), ['tasks']);
});

test('refiner / planner / planReviewer may connect to the decomposer', () => {
  const reg = loadAgentRegistry();
  // v2 has no per-agent allow-list: every agent connects to every agent, and the
  // graph validator decides legality from the port TYPES instead.
  for (const key of ['refiner', 'planner', 'planReviewer']) {
    assert.equal(reg[key].connectsTo, '*', `${key} -> decomposer must be allowed`);
  }
});
