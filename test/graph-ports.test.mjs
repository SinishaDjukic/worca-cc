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

const SCRIPTS = {
  runTests: { key: 'runTests', metaVersion: 2, runtime: 'node', verdict: { filename: 'tests-cycle{cycle}.json' },
    inputs: [{ id: 'done', type: 'void', required: false }],
    outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'tests-cycle{cycle}.md' }, { id: 'pass', type: 'void', when: 'clean' }] },
  shellLike: { key: 'shellLike', metaVersion: 2, runtime: 'shell', ports: 'config', verdict: { filename: 'shell-cycle{cycle}.json' },
    defaultPorts: { inputs: [], outputs: [] }, params: [{ id: 'command', type: 'command', required: true }] },
};
const both = portsFnFor(REG, SCRIPTS);
const script = (id, key, config = {}) => ({ id, kind: 'script', key, x: 0, y: 0, config });

test('script nodes resolve through the scripts index: sidecar ports + await; unknown keys stay undefined', () => {
  const p = both(script('n1', 'runTests'));
  assert.equal(p.known, true);
  assert.equal(p.ported, true);
  assert.deepEqual(p.inputs.map((i) => i.id), ['done', 'await']);
  assert.deepEqual(p.outputs.map((o) => o.id), ['log', 'pass']);
  assert.equal(p.runtime, 'node');
  assert.equal(both(script('n1', 'ghost')), undefined);
  assert.equal(both(agent('n2', 'runTests')), undefined, 'an agent node never resolves through the scripts index');
  assert.equal(portsFn(script('n1', 'runTests')), undefined, 'one-argument portsFnFor has no scripts');
});

test('ports: "config" scripts read node.config.ports; missing and invalid configs are told apart for V4', () => {
  const ok = both(script('n1', 'shellLike', { ports: {
    inputs: [{ id: 'in', type: 'md', required: false }],
    outputs: [{ id: 'fail', type: 'md', when: 'blocking', filename: 'shell-cycle{cycle}.md' }, { id: 'pass', type: 'void', when: 'clean' }] } }));
  assert.equal(ok.ported, true);
  assert.deepEqual(ok.inputs.map((i) => i.id), ['in', 'await']);
  assert.deepEqual(ok.outputs.map((o) => [o.id, o.when]), [['fail', 'blocking'], ['pass', 'clean']]);
  assert.equal(ok.outputs[0].artifactKind, 'fail', 'config ports are normalized like sidecar ports');
  const missing = both(script('n1', 'shellLike'));
  assert.deepEqual([missing.known, missing.ported, missing.configPortsMissing], [true, false, true]);
  const bad = both(script('n1', 'shellLike', { ports: { inputs: [{ id: 'x', type: 'md', as: 'file' }], outputs: [] } }));
  assert.deepEqual([bad.known, bad.ported, bad.configPortsInvalid], [true, false, true]);
  assert.match(bad.configPortsErrors[0], /prompt-side field/);
  assert.deepEqual(portsOf(both, missing && script('n1', 'shellLike')).inputs, [], 'portsOf collapses an un-ported node to no ports');
});

test('a script card that opts in carries the engine params port after its own inputs and before await', () => {
  const SCR = { gitDiff: { key: 'gitDiff', runtime: 'node', inputs: [{ id: 'done', type: 'void', required: false }],
      outputs: [{ id: 'diff', type: 'md', when: 'always', filename: 'd.md' }], params: [{ id: 'ref', type: 'string' }] },
    shellLike: { key: 'shellLike', runtime: 'shell', ports: 'config', defaultPorts: { inputs: [], outputs: [] },
      params: [{ id: 'command', type: 'command', required: true }, { id: 'target', type: 'string' }] },
    cmdOnly: { key: 'cmdOnly', runtime: 'shell', inputs: [], outputs: [], params: [{ id: 'command', type: 'command', required: true }] } };
  const fn = portsFnFor(REG, SCR);
  const S = (key, config = {}) => ({ id: 'n_s', kind: 'script', key, x: 0, y: 0, config });
  assert.deepEqual(fn(S('gitDiff')).inputs.map((i) => i.id), ['done', 'await'], 'off by default');
  const on = fn(S('gitDiff', { paramsPort: true }));
  assert.deepEqual(on.inputs.map((i) => i.id), ['done', 'params', 'await']);
  assert.deepEqual(on.inputs[1], { id: 'params', type: 'json', required: false, engine: 'params' });
  assert.equal(on.inputs.filter((i) => i.synthetic).length, 1, 'still exactly one synthetic gate, and it is LAST');
  assert.equal(on.inputs.at(-1).synthetic, true);
  assert.equal(SCR.gitDiff.inputs.length, 1, 'the registry meta is untouched');
  const cfg = fn(S('shellLike', { paramsPort: true, ports: { inputs: [{ id: 'in', type: 'md', required: false }], outputs: [] } }));
  assert.deepEqual(cfg.inputs.map((i) => i.id), ['in', 'params', 'await']);
  assert.deepEqual(fn(S('cmdOnly', { paramsPort: true })).inputs.map((i) => i.id), ['await'], 'nothing a wire may set: no port');
  assert.deepEqual(fn(agent('n1', 'planner')).inputs.map((i) => i.id), ['task', 'await'], 'agents never get it');
  assert.equal(typeCompatible('json', on.inputs[1].type), true);
  assert.equal(typeCompatible('md', on.inputs[1].type), false, 'only a json output can drive it');
});
