import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankNodes, autoLayout } from '../src/shared/graph/layout.mjs';
import { classifyLoops } from '../src/shared/graph/loops.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';

const REG = {
  planner: { key: 'planner', inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  impl: { key: 'impl', inputs: [{ id: 'plan', type: 'md', required: true },
      { id: 'fix', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'done', type: 'void', when: 'always' }] },
  reviewer: { key: 'reviewer', verdict: { filename: 'r.json' },
    inputs: [{ id: 'done', type: 'void', required: true }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
};
const portsFn = portsFnFor(REG);
const TPL = { version: 2,
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 0, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'impl', x: 0, y: 0, config: {} },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 0, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 0, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_rev', port: 'done' } },
    { id: 'w4', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w5', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }] };

test('rankNodes: longest path with loop wires excluded', () => {
  assert.deepEqual(rankNodes(TPL, classifyLoops(TPL, portsFn)),
    { n_task: 0, n_plan: 1, n_impl: 2, n_rev: 3, n_end: 4 });
});

test('rankNodes without loop exclusion would NOT rank the implementer past the reviewer', () => {
  const noLoops = { loopWireIds: new Set(), loopInputs: new Set(), sccOf: new Map(), launchOrder: [] };
  const r = rankNodes(TPL, noLoops);
  assert.equal(r.n_impl <= r.n_rev, true, 'a residual cycle still terminates and ranks bounded');
});

test('autoLayout: x = 60 + rank*320, y snapped to 11, deterministic and idempotent', () => {
  const a = autoLayout(TPL, portsFn);
  assert.deepEqual(Object.keys(a).sort(), ['n_end', 'n_impl', 'n_plan', 'n_rev', 'n_task']);
  assert.equal(a.n_task.x, 60);
  assert.equal(a.n_plan.x, 380);
  assert.equal(a.n_end.x, 1340);
  for (const p of Object.values(a)) assert.equal(p.y % 11, 0, 'every row snaps to the 11px grid');
  const applied = { ...TPL, nodes: TPL.nodes.map((n) => ({ ...n, ...a[n.id] })) };
  assert.deepEqual(autoLayout(applied, portsFn), a, 'idempotent');
  assert.deepEqual(autoLayout(TPL, portsFn), a, 'deterministic');
});

test('autoLayout stacks a column with a 64px gap below the previous card', () => {
  const tpl = { version: 2,
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'a', kind: 'agent', key: 'planner', x: 0, y: 0, config: {} },
      { id: 'b', kind: 'agent', key: 'planner', x: 0, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'a', port: 'task' } },
      { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'b', port: 'task' } }] };
  const p = autoLayout(tpl, portsFn);
  assert.equal(p.a.x, p.b.x);
  // y0 60 snaps to 55; planner card = 95.5 + 24*2 = 143.5, so 55 + 143.5 + 64 = 262.5 -> 264
  assert.equal(p.a.y, 55);
  assert.equal(p.b.y, 264);
});

test('malformed nodes/wires entries never throw and are never laid out', () => {
  // `filter(Boolean)` kept a truthy non-object (`7`) and indexed an id-less node
  // under `undefined`, so nonLoopEdges resolved a half-wire through it and threw.
  const tpl = { version: 2, nodes: [null, 7, {}, ...TPL.nodes], wires: [{}, 'junk', { id: 'w0' }, ...TPL.wires] };
  const loops = classifyLoops(tpl, portsFn);
  const rank = rankNodes(tpl, loops);
  assert.deepEqual(Object.keys(rank).sort(), ['n_end', 'n_impl', 'n_plan', 'n_rev', 'n_task']);
  const p = autoLayout(tpl, portsFn);
  assert.deepEqual(Object.keys(p).sort(), ['n_end', 'n_impl', 'n_plan', 'n_rev', 'n_task']);
  assert.deepEqual(p, autoLayout(TPL, portsFn), 'the junk changes nothing about the real cards');
});

test('autoLayout on an empty or wireless template never throws', () => {
  assert.deepEqual(autoLayout({ version: 2, nodes: [], wires: [] }, portsFn), {});
  const solo = autoLayout({ version: 2, nodes: [{ id: 'x', kind: 'task', x: 5, y: 5, config: {} }], wires: [] }, portsFn);
  assert.deepEqual(solo, { x: { x: 60, y: 55 } });
});
