import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankNodes, autoLayout } from '../src/shared/graph/layout.mjs';
import { classifyLoops } from '../src/shared/graph/loops.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';
import { checkRows } from './helpers/rows.mjs';
import { LABEL_H, nodeSize } from '../src/shared/graph/geometry.mjs';

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

test('autoLayout/rankNodes never throw: malformed entries ignored, empty and wireless templates', async () => {
  await checkRows([
    { name: 'malformed nodes/wires entries never throw and are never laid out', run: () => {
      // `filter(Boolean)` kept a truthy non-object (`7`) and indexed an id-less node
      // under `undefined`, so nonLoopEdges resolved a half-wire through it and threw.
      const tpl = { version: 2, nodes: [null, 7, {}, ...TPL.nodes], wires: [{}, 'junk', { id: 'w0' }, ...TPL.wires] };
      const loops = classifyLoops(tpl, portsFn);
      const rank = rankNodes(tpl, loops);
      assert.deepEqual(Object.keys(rank).sort(), ['n_end', 'n_impl', 'n_plan', 'n_rev', 'n_task']);
      const p = autoLayout(tpl, portsFn);
      assert.deepEqual(Object.keys(p).sort(), ['n_end', 'n_impl', 'n_plan', 'n_rev', 'n_task']);
      assert.deepEqual(p, autoLayout(TPL, portsFn), 'the junk changes nothing about the real cards');
    } },
    { name: 'autoLayout on an empty or wireless template never throws', run: () => {
      assert.deepEqual(autoLayout({ version: 2, nodes: [], wires: [] }, portsFn), {});
      const solo = autoLayout({ version: 2, nodes: [{ id: 'x', kind: 'task', x: 5, y: 5, config: {} }], wires: [] }, portsFn);
      assert.deepEqual(solo, { x: { x: 60, y: 55 } });
    } },
  ]);
});

test('autoLayout {describe}: a stacked edit-host card clears the label row of the card below it', () => {
  const A = { key: 'a', displayName: 'A', inputs: [{ id: 'task', type: 'md', required: true }], outputs: [{ id: 'x', type: 'md' }] };
  const pf = portsFnFor({ a: A }, {});
  const tpl = { id: '', name: '', version: 2, domain: '',
    nodes: [{ id: 'n_t', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_1', kind: 'agent', key: 'a', x: 0, y: 0, config: {} }, { id: 'n_2', kind: 'agent', key: 'a', x: 0, y: 0, config: {} }],
    wires: [{ id: 'w_1', from: { node: 'n_t', port: 'task' }, to: { node: 'n_1', port: 'task' } },
      { id: 'w_2', from: { node: 'n_t', port: 'task' }, to: { node: 'n_2', port: 'task' } }] };
  const lift = (pos) => [pos.n_1, pos.n_2].sort((p, q) => p.y - q.y);
  const h = nodeSize(tpl.nodes[1], pf(tpl.nodes[1]), { describe: true }).h;
  const [top, low] = lift(autoLayout(tpl, pf, { describe: true }));
  assert.equal(top.x, low.x, 'one column');
  assert.ok(low.y - LABEL_H >= top.y + h, `the lower card's label row (${low.y - LABEL_H}) clears the upper card's bottom (${top.y + h})`);
  const [t2, l2] = lift(autoLayout(tpl, pf));
  assert.ok(l2.y - LABEL_H < t2.y + h, 'without describe the same stack would overlap — the option is what makes room');
});

test('autoLayout: a card fed only by loop wires sits after the cards it collects from, under their bottoms', async () => {
  const { deckTemplate, deckPortsFn } = await import('./helpers/deck-fixture.mjs');
  const tpl = deckTemplate();
  const pos = autoLayout(tpl, deckPortsFn, { describe: true });
  const sources = tpl.wires.filter((w) => w.to.node === 'n_or').map((w) => w.from.node);
  for (const id of sources) assert.ok(pos.n_or.x > pos[id].x, `OR is right of ${id}`);
  assert.equal(pos.n_or.x, pos.n_end.x, 'one column after the last reviewer: End\'s');
  const bottom = (id) => pos[id].y + nodeSize(tpl.nodes.find((n) => n.id === id), deckPortsFn(tpl.nodes.find((n) => n.id === id)), { describe: true }).h;
  assert.ok(pos.n_or.y - LABEL_H > Math.max(...sources.map(bottom)), 'its label row clears every source\'s bottom');
  assert.ok(pos.n_end.y < pos.n_or.y, 'End keeps the main row');
  const applied = { ...tpl, nodes: tpl.nodes.map((n) => ({ ...n, ...pos[n.id] })) };
  assert.deepEqual(autoLayout(applied, deckPortsFn, { describe: true }), pos, 'idempotent');
});
