import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tarjanSccs, classifyLoops } from '../src/shared/graph/loops.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';

const REG = {
  planner: { key: 'planner', inputs: [{ id: 'task', type: 'md', required: true },
    { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  reviewer: { key: 'reviewer', verdict: { filename: 'r.json' },
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
};
const portsFn = portsFnFor(REG);
const n = (id, key) => ({ id, kind: 'agent', key, x: 0, y: 0, config: {} });
const w = (id, fn, fp, tn, tp) => ({ id, from: { node: fn, port: fp }, to: { node: tn, port: tp } });
// planner -> reviewer -> planner (blocking review), plus a task source and an end sink.
const LOOPY = {
  version: 2,
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, n('n_plan', 'planner'),
    n('n_rev', 'reviewer'), { id: 'n_end', kind: 'end', x: 0, y: 0, config: {} }],
  wires: [w('w1', 'n_task', 'task', 'n_plan', 'task'), w('w2', 'n_plan', 'plan', 'n_rev', 'plan'),
    w('w3', 'n_rev', 'review', 'n_plan', 'revise'), w('w4', 'n_rev', 'pass', 'n_end', 'result')],
};

test('tarjanSccs: components sorted, deterministic, singletons included', () => {
  const sccs = tarjanSccs(['c', 'a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]);
  assert.deepEqual(sccs.map((s) => s.join('+')).sort(), ['a+b', 'c']);
  assert.deepEqual(tarjanSccs(['a'], [{ from: 'a', to: 'a' }]), [['a']]);
  assert.deepEqual(tarjanSccs([], []), []);
});

test('classifyLoops finds the blocking-source loop wire and the meta loop inputs', () => {
  const { loopWireIds, loopInputs } = classifyLoops(LOOPY, portsFn);
  assert.deepEqual([...loopWireIds], ['w3']);
  assert.deepEqual([...loopInputs].sort(), ['n_plan.revise']);
});

test('a clean-sourced wire inside the cycle is NOT a loop wire', () => {
  const tpl = { ...LOOPY, wires: [...LOOPY.wires, w('w5', 'n_rev', 'pass', 'n_plan', 'revise')] };
  const { loopWireIds } = classifyLoops(tpl, portsFn);
  assert.equal(loopWireIds.has('w5'), false);
  assert.equal(loopWireIds.has('w3'), true);
});

test('a self-wire with a blocking source is a loop wire (singleton SCC counts)', () => {
  const tpl = { version: 2, nodes: [n('n_rev', 'reviewer')],
    wires: [w('w1', 'n_rev', 'review', 'n_rev', 'plan')] };
  assert.deepEqual([...classifyLoops(tpl, portsFn).loopWireIds], ['w1']);
});

test('a blocking wire OUTSIDE any cycle is not a loop wire', () => {
  const tpl = { version: 2, nodes: [n('n_rev', 'reviewer'), n('n_plan', 'planner')],
    wires: [w('w1', 'n_rev', 'review', 'n_plan', 'revise')] };
  assert.equal(classifyLoops(tpl, portsFn).loopWireIds.size, 0);
});

test('launchOrder is condensation-topo with a nodeId tiebreak, cycle members together', () => {
  const { launchOrder, sccOf } = classifyLoops(LOOPY, portsFn);
  assert.deepEqual(launchOrder, ['n_task', 'n_plan', 'n_rev', 'n_end']);
  assert.equal(sccOf.get('n_plan'), sccOf.get('n_rev'), 'the two loop members share one component');
  assert.notEqual(sccOf.get('n_task'), sccOf.get('n_plan'));
});

test('dangling endpoints and unknown keys never crash the walk', () => {
  const tpl = { version: 2, nodes: [n('n_x', 'nope')], wires: [w('w1', 'ghost', 'out', 'n_x', 'plan')] };
  const r = classifyLoops(tpl, portsFn);
  assert.equal(r.loopWireIds.size, 0);
  assert.deepEqual(r.launchOrder, ['n_x']);
  assert.deepEqual(classifyLoops(null, portsFn).launchOrder, []);
});

test('malformed nodes/wires entries never crash the walk', () => {
  // A node with no id used to be indexed under the key `undefined`, so a wire
  // with a missing `from`/`to` passed the `byId.has(...)` filter and the next
  // dereference threw (loops.mjs:75).
  const tpl = { version: 2, nodes: [null, {}, 7, n('n_x', 'planner')], wires: [{}, 'junk', { id: 'w1' }] };
  const r = classifyLoops(tpl, portsFn);
  assert.equal(r.loopWireIds.size, 0);
  assert.deepEqual(r.launchOrder, ['n_x']);
  assert.equal(r.sccOf.has(undefined), false, 'an id-less node is never a component member');
});
