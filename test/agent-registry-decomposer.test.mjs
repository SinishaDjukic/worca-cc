import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';

test('decomposer is registered with the expected port contract', () => {
  const reg = loadAgentRegistry(); // scans the real agents/ dir
  const d = reg.decomposer;
  assert.ok(d, 'decomposer not found in registry');
  assert.equal(d.runnerType, 'producer');
  assert.equal(d.fanOut, true);
  assert.equal(d.scope, 'project');
  assert.equal(d.agentFile, 'worca-cc-decomposer.md');
  assert.deepEqual(d.inputs.map((p) => p.id), ['plan']);
  assert.deepEqual(d.outputs.map((p) => p.id), ['tasks']);
});

test('refiner / planner / planReviewer may connect to the decomposer', () => {
  const reg = loadAgentRegistry();
  // v2 has no per-agent allow-list: legality comes from the port TYPES alone, so
  // every plan-producing agent can reach the decomposer's `plan` input.
  const planIn = reg.decomposer.inputs.find((p) => p.id === 'plan');
  for (const key of ['refiner', 'planner', 'planReviewer']) {
    const out = reg[key].outputs.find((p) => p.type === planIn.type);
    assert.ok(out, `${key} emits a ${planIn.type} payload the decomposer accepts`);
  }
});
