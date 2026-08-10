// test/graph-fixtures.test.mjs
// The canonical v2 graph fixtures are the shared contract stub every graph test
// (engine AND UI) imports: wf_default as a version-2 template, a flow-card graph
// exercising the payload-forwarding OR card / static AND card / synthesized
// await port / End node, the spec §5 port table as data, and the ports function
// that synthesizes the universal agent `await` input plus the flow-card ports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_DEFAULT, FIXTURE_FLOW, FIXTURE_PORTS, portsFnFor } from '../src/core/graph/fixtures.mjs';

test('FIXTURE_DEFAULT is a version-2 template: 1 task + 5 agent + 1 end nodes, 10 wires', () => {
  assert.equal(FIXTURE_DEFAULT.version, 2);
  assert.equal(FIXTURE_DEFAULT.nodes.length, 7);
  assert.equal(FIXTURE_DEFAULT.wires.length, 10);
  assert.equal(FIXTURE_DEFAULT.nodes.filter((n) => n.kind === 'task').length, 1);
  assert.equal(FIXTURE_DEFAULT.nodes.filter((n) => n.kind === 'agent').length, 5);
  assert.equal(FIXTURE_DEFAULT.nodes.filter((n) => n.kind === 'end').length, 1);
  assert.ok(FIXTURE_DEFAULT.nodes.every((n) => typeof n.x === 'number'));
});

test('portsFnFor synthesizes the agent await port and and/or/end flow ports', () => {
  const ports = portsFnFor(FIXTURE_PORTS);
  const reviewer = FIXTURE_DEFAULT.nodes.find((n) => n.key === 'reviewer');
  const p = ports(reviewer);
  assert.deepEqual(p.inputs.map((i) => i.id), ['plan', 'done', 'await']);   // synthesized last
  assert.deepEqual(p.inputs.at(-1), { id: 'await', type: 'any', required: false, synthetic: true });
  assert.deepEqual(p.outputs.map((o) => [o.id, o.when]), [['review', 'blocking'], ['pass', 'clean']]);
  const impl = FIXTURE_DEFAULT.nodes.find((n) => n.key === 'implementer');
  assert.deepEqual(ports(impl).inputs.map((i) => i.id), ['plan', 'fix', 'task', 'await']); // no 'start'
  const andNode = FIXTURE_FLOW.nodes.find((n) => n.kind === 'and');
  const ap = ports(andNode);
  assert.equal(ap.inputs.length, andNode.config.arity);
  assert.equal(ap.inputs[0].type, 'any');
  assert.deepEqual(ap.outputs.map((o) => [o.id, o.type, o.when]), [['out', 'void', 'always']]);
  const orNode = FIXTURE_FLOW.nodes.find((n) => n.kind === 'or');           // the fixture's real or node
  const orP = ports(orNode);
  assert.equal(orP.inputs.length, orNode.config.arity);
  assert.equal(orP.inputs[0].type, 'any');
  assert.deepEqual(orP.outputs.map((o) => [o.id, o.type, o.when]), [['out', 'any', 'always']]);
  // DECLARED or.out type is 'any' — resolution to the wired type happens in ports.mjs/validate
  // (resolveOrOutType, plan Task 2), never in the static port table; AND stays 'void'.
  const taskP = ports(FIXTURE_DEFAULT.nodes.find((n) => n.kind === 'task'));
  assert.deepEqual(taskP, { inputs: [], outputs: [{ id: 'task', type: 'md', when: 'always' }] });
  const comb = ports({ kind: 'combine', config: { arity: 2 } });            // literal combine — all six kinds covered
  assert.deepEqual(comb.inputs.map((i) => [i.id, i.type]), [['in1', 'md'], ['in2', 'md']]);
  assert.deepEqual(comb.outputs, [{ id: 'out', type: 'md', when: 'always' }]);
  const endNode = FIXTURE_FLOW.nodes.find((n) => n.kind === 'end');
  const ep = ports(endNode);
  assert.deepEqual(ep.inputs, [{ id: 'result', type: 'any', required: true }]);
  assert.deepEqual(ep.outputs, []);
});

test('FIXTURE_FLOW is a version-2 template: 1 task + 5 agent + 1 or + 1 and + 1 end nodes, 14 wires', () => {
  assert.equal(FIXTURE_FLOW.nodes.length, 9);
  assert.equal(FIXTURE_FLOW.wires.length, 14);
  assert.equal(FIXTURE_FLOW.nodes.filter((n) => n.kind === 'agent').length, 5);
  for (const k of ['task', 'or', 'and', 'end']) {
    assert.equal(FIXTURE_FLOW.nodes.filter((n) => n.kind === k).length, 1);
  }
});
