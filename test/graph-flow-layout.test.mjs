import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowOrder, flowPerRow, flowLayout, flowAnchors, routeFlow, FLOW_SCALE } from '../src/shared/graph/flow-layout.mjs';
import { nodeSize } from '../src/shared/graph/geometry.mjs';

const AGENT_PORTS = {
  inputs: [{ id: 'task', type: 'md', required: true }, { id: 'fix', type: 'md', loop: true }, { id: 'await', type: 'any', synthetic: true }],
  outputs: [{ id: 'plan', type: 'md', when: 'always' }, { id: 'review', type: 'md', when: 'blocking' }],
};
const BASE = {
  task: { inputs: [], outputs: [{ id: 'task', type: 'md', when: 'always' }] },
  end: { inputs: [{ id: 'result', type: 'any', required: true }], outputs: [] },
  agent: AGENT_PORTS,
};
/** Registry-free ports: the SHAPE of a v2 template's ports, no agent key consulted. */
function portsFn(n) {
  if (n.kind === 'or') {
    const k = (n.config && n.config.arity) || 2;
    return { known: true, ported: true, inputs: Array.from({ length: k }, (_, i) => ({ id: `in${i + 1}`, type: 'any', required: true })), outputs: [{ id: 'out', type: 'any', when: 'always' }] };
  }
  return { known: true, ported: true, ...(BASE[n.kind] || { inputs: [], outputs: [] }) };
}

const A = (id) => ({ id, kind: 'agent', key: 'k', x: 0, y: 0, config: {} });
const W = (id, f, t, cfg) => ({ id, from: { node: f.split('.')[0], port: f.split('.')[1] }, to: { node: t.split('.')[0], port: t.split('.')[1] }, ...(cfg ? { config: cfg } : {}) });
function theme() {
  return { version: 2, nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, A('n1'), A('n2'), A('n3'), A('n4'), A('n5'), A('n6'), A('n7'),
    { id: 'n_or', kind: 'or', x: 0, y: 0, config: { arity: 2 } }, { id: 'n_end', kind: 'end', x: 0, y: 0, config: {} },
  ], wires: [
    W('w1', 'n_task.task', 'n1.task'), W('w2', 'n_task.task', 'n2.task'), W('w3', 'n1.plan', 'n2.fix'), W('w4', 'n2.plan', 'n3.task'),
    W('w5', 'n3.review', 'n3.fix', { maxCycles: 3 }), W('w6', 'n3.plan', 'n4.task'), W('w7', 'n3.plan', 'n5.task'), W('w8', 'n3.plan', 'n6.task'),
    W('w9', 'n4.plan', 'n5.fix'), W('w10', 'n5.plan', 'n6.await'), W('w11', 'n6.plan', 'n7.task'), W('w12', 'n7.plan', 'n_end.result'),
    W('w13', 'n7.review', 'n_or.in1', { maxCycles: 2 }), W('w14', 'n5.review', 'n_or.in2', { maxCycles: 3 }), W('w15', 'n_or.out', 'n4.fix'),
  ] };
}
const ORDER = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7'];
const rectOf = (tpl, lay, id) => { const n = tpl.nodes.find((x) => x.id === id); const { w, h } = nodeSize(n, portsFn(n), { band: true, scale: lay.scale }); return { x: lay.positions[id].x, y: lay.positions[id].y, w, h }; };
const overlap = (a0, a1, b0, b1) => Math.max(a0, b0) < Math.min(a1, b1) - 0.5;
function crossesCard(pts, r) {
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i - 1]; const q = pts[i];
    if (Math.abs(p.x - q.x) < 0.01) { if (p.x > r.x + 0.5 && p.x < r.x + r.w - 0.5 && overlap(Math.min(p.y, q.y), Math.max(p.y, q.y), r.y, r.y + r.h)) return true; }
    else if (p.y > r.y + 0.5 && p.y < r.y + r.h - 0.5 && overlap(Math.min(p.x, q.x), Math.max(p.x, q.x), r.x, r.x + r.w)) return true;
  }
  return false;
}

test('perRow follows the mockup rule: 702 → 4, 750 → 4, 310 → 1, 0 → 1', () => {
  assert.equal(flowPerRow(702), 4); assert.equal(flowPerRow(750), 4); assert.equal(flowPerRow(310), 1); assert.equal(flowPerRow(0), 1);
  assert.equal(flowPerRow(702, { scale: 0.72 }), 3, 'the brief\'s 0.72 gives 3 per row (mockup F assumptions)');
});

test('order: Task, the agents (rank, then host order), the loop-only valve, End', () => {
  assert.deepEqual(flowOrder(theme(), portsFn, { agentOrder: ORDER }), ['n_task', ...ORDER, 'n_or', 'n_end']);
  const derived = flowOrder(theme(), portsFn);
  assert.equal(derived[0], 'n_task'); assert.equal(derived.at(-1), 'n_end'); assert.equal(derived.at(-2), 'n_or');
  assert.deepEqual(derived.slice(1, 8), ORDER, 'ranks alone reproduce the dispatch order of a chain');
});

test('placement: rows top/left aligned, row height = tallest card, host height = rows + pad (min 120)', () => {
  const tpl = theme(); const lay = flowLayout(tpl, portsFn, { width: 702, order: ['n_task', ...ORDER, 'n_or', 'n_end'] });
  assert.equal(lay.perRow, 4); assert.equal(lay.rows.length, 3);
  assert.deepEqual(lay.rows.map((r) => r.ids.length), [4, 4, 2]);
  assert.equal(lay.positions.n_task.x, 20); assert.equal(lay.positions.n1.x, 20 + 143 + 26); assert.equal(lay.positions.n3.x, 20 + 3 * 169);
  assert.equal(lay.positions.n4.x, 20, 'row 2 starts at the pad'); assert.equal(lay.positions.n4.y, lay.rows[1].top);
  const agentH = nodeSize(A('n1'), portsFn(A('n1')), { band: true, scale: FLOW_SCALE }).h;
  assert.equal(Math.round(agentH * 10) / 10, 140.1, 'Plan-shaped agent at chat scale (mockup F)');
  assert.equal(lay.rows[0].h, agentH, 'the tallest card in the row (an agent, band included)');
  assert.equal(lay.rows[1].top, 20 + agentH + 44 * FLOW_SCALE);
  assert.equal(lay.height, lay.rows[2].top + lay.rows[2].h + 20);
  assert.equal(flowLayout({ nodes: [], wires: [] }, portsFn).height, 120, 'min height');
  const narrow = flowLayout(tpl, portsFn, { width: 310, order: lay.order });
  assert.equal(narrow.perRow, 1); assert.ok(narrow.order.every((id) => narrow.positions[id].x === 20), 'one under another');
  assert.deepEqual(flowLayout(tpl, portsFn, { width: 702, order: lay.order }), lay, 'deterministic');
});

test('routes never enter a card body, lanes never overlap, trunks share a lane, every point stays inside the host', () => {
  const tpl = theme(); const lay = flowLayout(tpl, portsFn, { width: 702, agentOrder: ORDER });
  const { raw, routes, badges } = routeFlow(flowAnchors(tpl, portsFn, lay), lay);
  assert.equal(raw, routes, 'raw and routes are the same map (the view reads both)');
  assert.equal(routes.size, tpl.wires.length, 'all 15 wires route (the valve exit included)');
  const rects = tpl.nodes.map((n) => rectOf(tpl, lay, n.id));
  for (const [id, pts] of routes) {
    assert.ok(pts.length >= 2, id);
    for (const r of rects) assert.ok(!crossesCard(pts, r), `${id} crosses a card`);
    for (const p of pts) assert.ok(p.x >= 0 && p.x <= 702 && p.y >= 0 && p.y <= lay.height, `${id} leaves the host at ${p.x},${p.y}`);
  }
  // trunk: w6/w7/w8 leave n3.plan and share the vertical lane right of n3
  const xOf = (id) => routes.get(id)[1].x;
  assert.equal(xOf('w6'), xOf('w7')); assert.equal(xOf('w7'), xOf('w8'));
  // lanes: two vertical legs in the same channel with overlapping y ranges have distinct x unless they share a trunk
  const legs = [];
  for (const [id, pts] of routes) for (let i = 1; i < pts.length; i += 1) if (Math.abs(pts[i].x - pts[i - 1].x) < 0.01) legs.push({ id, x: pts[i].x, y0: Math.min(pts[i].y, pts[i - 1].y), y1: Math.max(pts[i].y, pts[i - 1].y) });
  const srcOf = (id) => { const w = tpl.wires.find((x) => x.id === id); return `${w.from.node}.${w.from.port}`; };
  for (const a of legs) for (const b of legs) {
    if (a === b || a.id === b.id) continue;
    if (Math.abs(a.x - b.x) < 0.01 && overlap(a.y0, a.y1, b.y0, b.y1)) assert.equal(srcOf(a.id), srcOf(b.id), `${a.id}/${b.id} overlap without sharing a trunk`);
  }
  // loop badges: on a horizontal leg of their own route, outside every card, at the gutter y
  for (const id of ['w5', 'w13', 'w14']) {
    const b = badges.get(id); const pts = routes.get(id);
    assert.ok(pts.some((p, i) => i > 0 && Math.abs(p.y - pts[i - 1].y) < 0.01 && Math.abs(b.y - p.y) < 0.01 && b.x >= Math.min(p.x, pts[i - 1].x) && b.x <= Math.max(p.x, pts[i - 1].x)), `${id} badge sits on its gutter run`);
    for (const r of rects) assert.ok(!(b.x > r.x && b.x < r.x + r.w && b.y > r.y && b.y < r.y + r.h), `${id} badge inside a card`);
  }
});

test('narrow host (310 → 1 per row): every wire still routes inside the host and outside every card (A30)', () => {
  // Every return leg lands in the LEFT pad here (perRow 1 ⇒ chB is always 0), so the pad needs 4+ lanes: the mockup's
  // fixed 5px pitch put lane 3 at x = −3 (measured in the dry-run); pitchFor tightens the pitch so lanes stay in [2, 12].
  const tpl = theme(); const lay = flowLayout(tpl, portsFn, { width: 310, agentOrder: ORDER });
  assert.equal(lay.perRow, 1);
  const { routes } = routeFlow(flowAnchors(tpl, portsFn, lay), lay);
  assert.equal(routes.size, tpl.wires.length);
  const rects = tpl.nodes.map((n) => rectOf(tpl, lay, n.id));
  for (const [id, pts] of routes) {
    for (const r of rects) assert.ok(!crossesCard(pts, r), `${id} crosses a card at 310`);
    for (const p of pts) assert.ok(p.x >= 0 && p.x <= 310 && p.y >= 0 && p.y <= lay.height, `${id} leaves the 310 host at ${p.x},${p.y}`);
  }
  const padXs = [...routes.values()].flatMap((pts) => pts.map((p) => p.x)).filter((x) => x < 20);
  assert.ok(padXs.length && padXs.every((x) => x >= 2 && x <= 12), `left-pad lanes inside [2, 12]: ${[...new Set(padXs)].join(',')}`);
});
