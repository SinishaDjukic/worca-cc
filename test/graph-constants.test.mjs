// test/graph-constants.test.mjs — the shared v2 vocabulary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATE_VERSION, KINDS, FLOW_KINDS, PORT_TYPES, AWAIT_PORT, TASK_PORTS, END_PORTS,
  gatePorts, NODE_ID_RE, WIRE_ID_RE, PORT_ID_RE, DEFAULT_MAX_CYCLES, MAX_PORTS_PER_SIDE, LIMITS,
  BOOKEND_EXECUTION_IDS, FLOW_LABEL,
} from '../src/shared/graph/constants.mjs';

test('scalars and kind sets', () => {
  assert.equal(TEMPLATE_VERSION, 2);
  assert.equal(DEFAULT_MAX_CYCLES, 3);
  assert.equal(MAX_PORTS_PER_SIDE, 8);
  assert.deepEqual([...KINDS], ['agent', 'task', 'end', 'and', 'or', 'combine']);
  assert.deepEqual([...FLOW_KINDS], ['task', 'end', 'and', 'or', 'combine']);
  assert.deepEqual([...PORT_TYPES], ['md', 'json', 'void', 'any']);
  assert.deepEqual(FLOW_KINDS.filter((k) => !KINDS.includes(k)), [], 'flow kinds are kinds');
  assert.deepEqual(KINDS.filter((k) => !FLOW_KINDS.includes(k)), ['agent']);
});

test('every exported table is deep-frozen (a shared constant no consumer can mutate)', () => {
  for (const v of [KINDS, FLOW_KINDS, PORT_TYPES, AWAIT_PORT, TASK_PORTS, END_PORTS, LIMITS]) {
    assert.ok(Object.isFrozen(v));
  }
  assert.ok(Object.isFrozen(TASK_PORTS.outputs) && Object.isFrozen(TASK_PORTS.outputs[0]));
  assert.ok(Object.isFrozen(END_PORTS.inputs[0]));
  assert.throws(() => { KINDS.push('nope'); }, TypeError);
});

test('AWAIT_PORT is the synthesized any-typed optional gate', () => {
  assert.deepEqual({ ...AWAIT_PORT }, { id: 'await', type: 'any', required: false, synthetic: true });
});

test('TASK_PORTS: zero inputs, one always-firing md output named task', () => {
  assert.deepEqual(TASK_PORTS.inputs, []);
  assert.equal(TASK_PORTS.outputs.length, 1);
  assert.deepEqual({ ...TASK_PORTS.outputs[0] }, { id: 'task', type: 'md', when: 'always' });
});

test('END_PORTS: one any-typed required input named result, zero outputs', () => {
  assert.equal(END_PORTS.outputs.length, 0);
  assert.deepEqual({ ...END_PORTS.inputs[0] }, { id: 'result', type: 'any', required: true, loop: false, expands: false });
});

test('gatePorts: in1..inN + out, with the per-kind out type', () => {
  const and = gatePorts('and', 3);
  assert.deepEqual(and.inputs.map((p) => p.id), ['in1', 'in2', 'in3']);
  assert.deepEqual(and.inputs.map((p) => p.type), ['any', 'any', 'any']);
  assert.deepEqual({ ...and.outputs[0] }, { id: 'out', type: 'void', when: 'always' });
  const or = gatePorts('or', 2);
  assert.deepEqual(or.inputs.map((p) => p.type), ['any', 'any']);
  assert.equal(or.outputs[0].type, 'any', 'OR out stays any until resolved from wiring');
  const combine = gatePorts('combine', 2);
  assert.deepEqual(combine.inputs.map((p) => p.type), ['md', 'md']);
  assert.equal(combine.outputs[0].type, 'md');
});

test('gatePorts: arity is clamped to [2, MAX_PORTS_PER_SIDE] and never throws', () => {
  for (const bad of [undefined, null, 0, 1, -4, NaN, 'x', {}]) {
    assert.equal(gatePorts('and', bad).inputs.length, 2, `arity ${String(bad)} -> 2`);
  }
  assert.equal(gatePorts('and', 99).inputs.length, MAX_PORTS_PER_SIDE);
  assert.equal(gatePorts('and', 2.9).inputs.length, 2);
  assert.ok(Object.isFrozen(gatePorts('or', 2)) && Object.isFrozen(gatePorts('or', 2).inputs[0]));
});

test('id shapes: minted ids and the seed graphs both match', () => {
  for (const id of ['n_task', 'n_or', 'n_a1b2c3d4']) assert.match(id, NODE_ID_RE);
  for (const id of ['task', 'N_task', 'n_', 'n_Task', 'w1']) assert.doesNotMatch(id, NODE_ID_RE);
  for (const id of ['w1', 'w17', 'w_a1b2c3d4']) assert.match(id, WIRE_ID_RE);
  for (const id of ['fb_0', 'W1', 'n_task', 'w_']) assert.doesNotMatch(id, WIRE_ID_RE);
  for (const id of ['task', 'revise', 'in1', 'await', 'planStoreSeed']) assert.match(id, PORT_ID_RE);
  for (const id of ['Task', 'in-1', 'in_1', '1in', '', 'x'.repeat(33)]) assert.doesNotMatch(id, PORT_ID_RE);
});

test('BOOKEND_EXECUTION_IDS names the two bookend ledger rows, frozen', () => {
  assert.deepEqual([...BOOKEND_EXECUTION_IDS], ['x:preflight:1', 'x:done:1']);
  assert.ok(Object.isFrozen(BOOKEND_EXECUTION_IDS));
});

test('LIMITS carries the ceilings the validator reads', () => {
  assert.deepEqual(LIMITS, {
    maxNodes: 80, maxWires: 200, maxPortsPerSide: 8, minArity: 2, maxArity: 8, maxCycles: 20, maxNameLen: 80,
  });
});

// MAJ-21: the flow cards' display names live HERE, next to FLOW_KINDS, so the
// manifest, the run monitor and the New-pipeline caption all read one table.
test('FLOW_LABEL names every flow kind and is frozen', () => {
  assert.deepEqual(FLOW_LABEL, { task: 'Task', end: 'End', and: 'AND', or: 'OR', combine: 'Combine' });
  assert.deepEqual(Object.keys(FLOW_LABEL).sort(), [...FLOW_KINDS].sort(), 'one label per flow kind');
  assert.ok(Object.isFrozen(FLOW_LABEL));
});
