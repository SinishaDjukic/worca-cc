import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flowPorts, portsFnFor, portsOf, findPort, typeCompatible,
  resolveOrOutType, inboundWires, outboundWires, firedOutputs,
} from '../src/shared/graph/ports.mjs';

const REG = {
  planner: { key: 'planner', metaVersion: 2, inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  reviewer: { key: 'reviewer', metaVersion: 2, verdict: { filename: 'r.json' },
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
  legacy: { key: 'legacy' },                       // v1-only sidecar: no inputs/outputs
};
const portsFn = portsFnFor(REG);
const agent = (id, key) => ({ id, kind: 'agent', key, x: 0, y: 0, config: {} });

test('agent ports carry the synthesized await gate LAST and never mutate the meta', () => {
  const p = portsFn(agent('n1', 'planner'));
  assert.deepEqual(p.inputs.map((i) => i.id), ['task', 'await']);
  assert.equal(p.inputs.at(-1).type, 'any');
  assert.equal(p.inputs.at(-1).required, false);
  assert.equal(p.inputs.at(-1).synthetic, true);
  assert.equal(REG.planner.inputs.length, 1, 'the registry meta is untouched');
});

test('flowPorts: task/end/and/or/combine, arity-driven, unknown kind undefined', () => {
  assert.deepEqual(flowPorts({ kind: 'task' }).outputs, [{ id: 'task', type: 'md', when: 'always' }]);
  assert.deepEqual(flowPorts({ kind: 'task' }).inputs, []);
  assert.deepEqual(flowPorts({ kind: 'end' }).inputs.map((i) => i.id), ['result']);
  assert.equal(flowPorts({ kind: 'end' }).inputs[0].type, 'any');
  assert.deepEqual(flowPorts({ kind: 'end' }).outputs, []);
  const and3 = flowPorts({ kind: 'and', config: { arity: 3 } });
  assert.deepEqual(and3.inputs.map((i) => i.id), ['in1', 'in2', 'in3']);
  assert.equal(and3.outputs[0].type, 'void');
  assert.equal(flowPorts({ kind: 'or' }).outputs[0].type, 'any');
  assert.equal(flowPorts({ kind: 'combine' }).outputs[0].type, 'md');
  assert.deepEqual(flowPorts({ kind: 'combine' }).inputs.map((i) => i.type), ['md', 'md']);
  assert.equal(flowPorts({ kind: 'nope' }), undefined);
});

test('portsOf never throws and distinguishes unknown from un-ported', () => {
  assert.deepEqual(portsOf(portsFn, agent('n', 'nope')), { known: false, ported: false, inputs: [], outputs: [], meta: null });
  const legacy = portsOf(portsFn, agent('n', 'legacy'));
  assert.equal(legacy.known, true);
  assert.equal(legacy.ported, false);
  assert.deepEqual(legacy.inputs, []);
  const ok = portsOf(portsFn, agent('n', 'planner'));
  assert.equal(ok.known && ok.ported, true);
  assert.equal(ok.meta.key, 'planner');
  assert.equal(portsOf(() => { throw new Error('boom'); }, agent('n', 'planner')).known, false);
  assert.equal(portsOf(null, agent('n', 'planner')).known, false);
});

test('findPort + typeCompatible', () => {
  const p = portsFn(agent('n', 'reviewer'));
  assert.equal(findPort(p, 'pass', 'out').type, 'void');
  assert.equal(findPort(p, 'pass', 'in'), null);
  assert.equal(findPort(p, 'await', 'in').type, 'any');
  assert.equal(typeCompatible('md', 'md'), true);
  assert.equal(typeCompatible('json', 'md'), false);
  assert.equal(typeCompatible('json', 'any'), true);
  assert.equal(typeCompatible(null, 'md'), true, 'unresolvable source: caller skips');
});

test('resolveOrOutType walks inbound wires by inK index then wire id, through chained ors', () => {
  const tpl = { version: 2, nodes: [
    agent('n_p', 'planner'), { id: 'or1', kind: 'or', x: 0, y: 0, config: { arity: 2 } },
    { id: 'or2', kind: 'or', x: 0, y: 0, config: { arity: 2 } }],
    wires: [
      { id: 'w2', from: { node: 'or1', port: 'out' }, to: { node: 'or2', port: 'in1' } },
      { id: 'w1', from: { node: 'n_p', port: 'plan' }, to: { node: 'or1', port: 'in1' } },
    ] };
  assert.equal(resolveOrOutType(tpl, portsFn, 'or1'), 'md');
  assert.equal(resolveOrOutType(tpl, portsFn, 'or2'), 'md', 'resolves THROUGH the chained or');
  assert.equal(resolveOrOutType({ version: 2, nodes: [{ id: 'or1', kind: 'or', x: 0, y: 0, config: {} }], wires: [] }, portsFn, 'or1'), null);
});

test('resolveOrOutType terminates on a cyclic or chain (seen-set)', () => {
  const tpl = { version: 2, nodes: [
    { id: 'a', kind: 'or', x: 0, y: 0, config: {} }, { id: 'b', kind: 'or', x: 0, y: 0, config: {} }],
    wires: [
      { id: 'w1', from: { node: 'a', port: 'out' }, to: { node: 'b', port: 'in1' } },
      { id: 'w2', from: { node: 'b', port: 'out' }, to: { node: 'a', port: 'in1' } },
    ] };
  assert.equal(resolveOrOutType(tpl, portsFn, 'a'), null);
});

test('inboundWires / outboundWires filter by node and optional port', () => {
  const tpl = { version: 2, nodes: [agent('a', 'planner'), agent('b', 'reviewer')], wires: [
    { id: 'w1', from: { node: 'a', port: 'plan' }, to: { node: 'b', port: 'plan' } },
    { id: 'w2', from: { node: 'a', port: 'plan' }, to: { node: 'b', port: 'await' } },
  ] };
  assert.deepEqual(inboundWires(tpl, 'b').map((w) => w.id), ['w1', 'w2']);
  assert.deepEqual(inboundWires(tpl, 'b', 'await').map((w) => w.id), ['w2']);
  assert.deepEqual(outboundWires(tpl, 'a', 'plan').map((w) => w.id), ['w1', 'w2']);
  assert.deepEqual(outboundWires(tpl, 'b'), []);
});

test('firedOutputs fires always + exactly one conditional side, in declared order', () => {
  const outs = portsFn(agent('n', 'reviewer')).outputs;
  assert.deepEqual(firedOutputs(outs, { issues: [{ severity: 'major' }] }).map((o) => o.id), ['review']);
  assert.deepEqual(firedOutputs(outs, { issues: [{ severity: 'minor' }] }).map((o) => o.id), ['pass']);
  assert.deepEqual(firedOutputs(outs, null).map((o) => o.id), ['pass']);
  assert.deepEqual(firedOutputs(portsFn(agent('n', 'planner')), null).map((o) => o.id), ['plan'],
    'accepts a resolved ports object as well as an array');
});
