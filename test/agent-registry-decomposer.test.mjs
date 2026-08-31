import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';

test('decomposer is registered with the expected typed ports', () => {
  const reg = loadAgentRegistry(); // scans the real agents/ dir
  const d = reg.decomposer;
  assert.ok(d, 'decomposer not found in registry');
  assert.equal(d.runnerType, 'producer');
  assert.equal(d.fanOut, true);
  assert.equal(d.scope, 'project');
  assert.equal(d.metaVersion, 2);
  assert.deepEqual(d.inputs.map((p) => p.id), ['plan']);
  assert.deepEqual(d.outputs.map((p) => p.id), ['tasks']);
  assert.equal(d.agentFile, 'worca-cc-decomposer.md');
});

test("the decomposer's `tasks` output types-matches the implementer's `task` input", () => {
  const reg = loadAgentRegistry();
  const out = reg.decomposer.outputs.find((p) => p.id === 'tasks');
  const inp = reg.implementer.inputs.find((p) => p.id === 'task');
  assert.ok(out && inp, 'both ports exist — a wire between them is what replaced connectsTo');
  assert.equal(out.type, inp.type, 'the port TYPES are what make the wire legal');
  assert.equal(out.type, 'json');
});
