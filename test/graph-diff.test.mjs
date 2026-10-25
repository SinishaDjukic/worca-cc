// test/graph-diff.test.mjs — diffGraphs: what changed between two workflow graphs, in plain words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffGraphs, canon } from '../src/shared/graph/diff-graphs.mjs';

const g = (over = {}) => ({
  name: 'Brief writer',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_draft', kind: 'agent', key: 'drafter', x: 100, y: 0, config: { model: 'opus' } },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 200, y: 0, config: {} },
  ],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_draft', port: 'task' } },
    { id: 'w_loop', from: { node: 'n_rev', port: 'issues' }, to: { node: 'n_draft', port: 'feedback' }, maxCycles: 3 }],
  ...over,
});
const labelOf = (n) => ({ drafter: 'Draft brief', reviewer: 'Review', checker: 'Fact check' }[n.key] || n.key || n.kind);

test('identical graphs and layout-only moves: nothing changed', () => {
  assert.deepEqual(diffGraphs(g(), g(), { labelOf }), []);
  const moved = g(); moved.nodes[1] = { ...moved.nodes[1], x: 999, y: 42 };
  assert.deepEqual(diffGraphs(g(), moved, { labelOf }), []);
});

test('model, a new step, a loop budget and a rename read as plain sentences', () => {
  const after = g({ name: 'Product brief writer' });
  after.nodes[1] = { ...after.nodes[1], config: { model: 'sonnet' } };
  after.nodes.push({ id: 'n_fact', kind: 'agent', key: 'checker', x: 300, y: 0, config: {} });
  after.wires[1] = { ...after.wires[1], maxCycles: 2 };
  assert.deepEqual(diffGraphs(g(), after, { labelOf }).map((c) => c.text), [
    'Renamed from "Brief writer" to "Product brief writer"',
    'New step Fact check',
    'Draft brief: AI model opus → sonnet',
    'Draft brief loop: at most 3 rounds → 2',
  ]);
});

test('a removed step, a replaced agent and other settings', () => {
  const after = g();
  after.nodes = after.nodes.filter((n) => n.id !== 'n_rev');
  after.nodes[1] = { ...after.nodes[1], key: 'checker', config: { model: 'opus', fanOut: true } };
  after.wires = after.wires.slice(0, 1);
  assert.deepEqual(diffGraphs(g(), after, { labelOf }).map((c) => c.kind), ['removed', 'replaced', 'config', 'wires']);
});

test('canon sorts keys at every depth', () => {
  assert.equal(canon({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
});
