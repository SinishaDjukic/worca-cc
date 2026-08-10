// test/ui-graph-layout.test.mjs
// graph-layout.mjs is the composer's auto-layout: longest-path ranks with LOOP
// WIRES EXCLUDED (a node whose only non-loop feed is rank N ranks N+1, no matter
// how deep the loop wire coming back into it), x = 60 + rank*300, barycenter
// y-ordering, y snapped to the 11px grid. It must be deterministic — the button
// is idempotent — and must never overlap two cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_DEFAULT, FIXTURE_FLOW, FIXTURE_PORTS } from '../src/core/graph/fixtures.mjs';
import { portsFnFor, CAPTION_KINDS } from '../ui/public/graph/graph-model.mjs';
import { nodeSize, SNAP } from '../ui/public/graph/graph-geometry.mjs';
import { RANK_X0, RANK_DX, rankNodes, autoLayout } from '../ui/public/graph/graph-layout.mjs';

const ports = portsFnFor(FIXTURE_PORTS);

/** The card rects a layout produces, for the overlap check. */
function rects(template, positions) {
  return template.nodes.map((n) => {
    const size = nodeSize(ports(n), { caption: CAPTION_KINDS.has(n.kind) });
    return { id: n.id, ...positions[n.id], w: size.w, h: size.h };
  });
}

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('the pinned rank geometry', () => {
  assert.equal(RANK_X0, 60);
  assert.equal(RANK_DX, 300);
});

test('longest-path ranks over wf_default, loop wires excluded', () => {
  assert.deepEqual(rankNodes(FIXTURE_DEFAULT, ports), {
    n_task: 0, n_clarify: 1, n_plan: 2, n_refine: 3, n_impl: 4, n_review: 5, n_end: 6,
  });
});

test('a node whose only NON-LOOP feed is rank N ranks N+1', () => {
  const rank = rankNodes(FIXTURE_DEFAULT, ports);
  // n_impl is fed by w6 (refine.plan, plain) and w9 (review.review, a LOOP wire).
  // Ranking sees only w6, so impl stays one past refine and BELOW review.
  assert.equal(rank.n_impl, rank.n_refine + 1);
  assert.equal(rank.n_impl, rank.n_review - 1);
  // The refine self-loop (w5) is likewise excluded — it does not push refine past itself.
  assert.equal(rank.n_refine, rank.n_plan + 1);
});

test('ranks over the flow fixture: the AND card pushes the checklist past the OR path', () => {
  assert.deepEqual(rankNodes(FIXTURE_FLOW, ports), {
    n_task2: 0, n_plan: 1, n_refine: 2, n_impl: 3, n_or: 3, n_review: 4, n_and: 5, n_check: 6, n_end: 7,
  });
});

test('x is exactly 60 + rank*300 and y lands on the 11px grid', () => {
  const rank = rankNodes(FIXTURE_DEFAULT, ports);
  const positions = autoLayout(FIXTURE_DEFAULT, ports);
  for (const node of FIXTURE_DEFAULT.nodes) {
    assert.equal(positions[node.id].x, 60 + rank[node.id] * 300, node.id);
    assert.equal(positions[node.id].y % SNAP, 0, `${node.id} y snapped`);
  }
});

test('layout is deterministic — the button is idempotent', () => {
  for (const fixture of [FIXTURE_DEFAULT, FIXTURE_FLOW]) {
    const once = autoLayout(fixture, ports);
    assert.deepEqual(once, autoLayout(fixture, ports));
    // Re-running over the ALREADY laid-out template reproduces it exactly.
    const relaid = autoLayout({ ...fixture, nodes: fixture.nodes.map((n) => ({ ...n, ...once[n.id] })) }, ports);
    assert.deepEqual(relaid, once);
  }
});

test('no two cards overlap', () => {
  for (const fixture of [FIXTURE_DEFAULT, FIXTURE_FLOW]) {
    const boxes = rects(fixture, autoLayout(fixture, ports));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        assert.equal(overlaps(boxes[i], boxes[j]), false, `${boxes[i].id} / ${boxes[j].id}`);
      }
    }
  }
});

test('barycenter ordering follows the predecessors, not the declaration order', () => {
  const crossed = {
    id: 'wf_cross', name: 'Cross', version: 2, domain: 'coding',
    nodes: [
      { id: 's1', kind: 'task', x: 0, y: 0, config: {} },
      { id: 's2', kind: 'task', x: 0, y: 0, config: {} },
      { id: 't2', kind: 'agent', key: 'manualTestsChecklist', x: 0, y: 0, config: {} },
      { id: 't1', kind: 'agent', key: 'manualTestsChecklist', x: 0, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 's1', port: 'task' }, to: { node: 't1', port: 'plan' } },
      { id: 'w2', from: { node: 's2', port: 'task' }, to: { node: 't2', port: 'plan' } },
    ],
  };
  const positions = autoLayout(crossed, ports);
  assert.ok(positions.s1.y < positions.s2.y, 's1 above s2');
  // t1 is declared SECOND but fed by the FIRST source, so it sorts above t2.
  assert.ok(positions.t1.y < positions.t2.y, 't1 above t2');
});

test('an isolated node still gets a rank-0 slot', () => {
  const lonely = {
    ...FIXTURE_DEFAULT,
    nodes: [...FIXTURE_DEFAULT.nodes, { id: 'n_lonely', kind: 'and', x: 0, y: 0, config: { arity: 2 } }],
  };
  const positions = autoLayout(lonely, ports);
  assert.equal(positions.n_lonely.x, 60);
  assert.equal(Object.keys(positions).length, lonely.nodes.length);
});

test('a residual cycle (no loop wire to cut) still terminates with every node placed', () => {
  const knot = {
    id: 'wf_knot', name: 'Knot', version: 2, domain: 'coding',
    nodes: [
      { id: 'a', kind: 'agent', key: 'refiner', x: 0, y: 0, config: {} },
      { id: 'b', kind: 'agent', key: 'refiner', x: 0, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'a', port: 'plan' }, to: { node: 'b', port: 'plan' } },
      { id: 'w2', from: { node: 'b', port: 'plan' }, to: { node: 'a', port: 'plan' } },
    ],
  };
  const positions = autoLayout(knot, ports);
  assert.deepEqual(Object.keys(positions).sort(), ['a', 'b']);
  assert.ok(Number.isFinite(positions.a.x) && Number.isFinite(positions.b.y));
});
