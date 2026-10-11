import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowOrder, flowPerRow, flowLayout, flowAnchors, routeFlow, FLOW_SCALE, FLOW_PAD_Y, FLOW_BADGE_H } from '../src/shared/graph/flow-layout.mjs';
import { nodeSize, NODE_W } from '../src/shared/graph/geometry.mjs';
import { LABEL_H } from '../src/shared/graph/geometry.mjs';
import { SWOOP_DROP } from '../src/shared/graph/curves.mjs';

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

test('order: Task, the agents (rank, then host order), the loop-only valve, End', () => {
  assert.deepEqual(flowOrder(theme(), portsFn, { agentOrder: ORDER }), ['n_task', ...ORDER, 'n_or', 'n_end']);
  const derived = flowOrder(theme(), portsFn);
  assert.equal(derived[0], 'n_task'); assert.equal(derived.at(-1), 'n_end'); assert.equal(derived.at(-2), 'n_or');
  assert.deepEqual(derived.slice(1, 8), ORDER, 'ranks alone reproduce the dispatch order of a chain');
});

test('placement: rows top/left aligned, row height = tallest card, host height = rows + vertical pad (min 120)', () => {
  const tpl = theme(); const lay = flowLayout(tpl, portsFn, { width: 702, order: ['n_task', ...ORDER, 'n_or', 'n_end'] });
  const per = flowPerRow(702);
  assert.equal(lay.perRow, per); assert.equal(lay.rows.length, Math.ceil(10 / per));
  assert.deepEqual(lay.rows.map((r) => r.ids.length), [per, per, per, 10 - 3 * per]);
  const step = NODE_W * FLOW_SCALE + 40 * FLOW_SCALE;
  assert.equal(lay.positions.n_task.x, 20); assert.equal(lay.positions.n1.x, 20 + step); assert.equal(lay.positions.n2.x, 20 + 2 * step);
  assert.equal(lay.positions.n3.x, 20, 'row 2 starts at the pad'); assert.equal(lay.positions.n3.y, lay.rows[1].top);
  const agentH = nodeSize(A('n1'), portsFn(A('n1')), { band: true, scale: FLOW_SCALE }).h;
  assert.equal(lay.rows[0].h, agentH, 'the tallest card in the row (an agent, band included)');
  assert.equal(lay.rows[0].top, FLOW_PAD_Y + LABEL_H * FLOW_SCALE, 'the first row starts under its label row');
  assert.equal(lay.rows[1].top, lay.rows[0].top + agentH + 44 * FLOW_SCALE + LABEL_H * FLOW_SCALE);
  assert.equal(lay.height, lay.rows[3].top + lay.rows[3].h + FLOW_PAD_Y, 'nothing routes under the last row here');
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
  for (const id of ['w5', 'w14']) {          // w13 (n7 → n_or) is a direct neighbour wire at 3 per row
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

// The screenshot bug: a one-row proposal whose reviewer loops back to the implementer routes that
// wire through the BOTTOM gutter and paints a `N×` badge centred on it. The height billed only the
// cards (lastRow + pad), so the badge — half of it below the gutter y — sat on the host's border and
// read as clipped. The bottom band must be billed, and the vertical pad kept clear under it.
test('a loop in the LAST row is billed: the badge clears the host edge by the full vertical pad', () => {
  const tpl = { version: 2, nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, A('n1'), A('n2'), { id: 'n_end', kind: 'end', x: 0, y: 0, config: {} },
  ], wires: [
    W('w1', 'n_task.task', 'n1.task'), W('w2', 'n1.plan', 'n2.task'),
    W('w3', 'n2.review', 'n1.fix', { maxCycles: 3 }), W('w4', 'n2.plan', 'n_end.result'),
  ] };
  const lay = flowLayout(tpl, portsFn, { width: 760, agentOrder: ['n1', 'n2'] });
  assert.equal(lay.rows.length, 1, 'all four cards on one row');
  const { badges } = routeFlow(flowAnchors(tpl, portsFn, lay), lay);
  const b = badges.get('w3');
  assert.ok(b.y > lay.rows[0].top + lay.rows[0].h, 'the loop badge sits in the bottom gutter');
  assert.ok(b.y + FLOW_BADGE_H / 2 + FLOW_PAD_Y <= lay.height,
    `badge bottom ${b.y + FLOW_BADGE_H / 2} + pad ${FLOW_PAD_Y} must fit in ${lay.height}`);
  // two trunks in the same gutter take a second lane — the band grows with them
  const two = { version: 2, nodes: [...tpl.nodes, A('n3')], wires: [
    ...tpl.wires.filter((w) => w.id !== 'w4'), W('w4', 'n2.plan', 'n3.task'),
    W('w5', 'n3.review', 'n2.fix', { maxCycles: 2 }), W('w6', 'n3.plan', 'n_end.result'),
  ] };
  const lay2 = flowLayout(two, portsFn, { width: 1040, agentOrder: ['n1', 'n2', 'n3'] });   // 5 cards, still one row
  assert.equal(lay2.rows.length, 1);
  const b2 = routeFlow(flowAnchors(two, portsFn, lay2), lay2).badges;
  for (const id of ['w3', 'w5']) {
    assert.ok(b2.get(id).y + FLOW_BADGE_H / 2 + FLOW_PAD_Y <= lay2.height, `${id} badge crowds the host edge`);
  }
  // and a graph with nothing under the last row keeps the plain pad — no dead band
  const flat = flowLayout({ version: 2, nodes: tpl.nodes, wires: tpl.wires.filter((w) => w.id !== 'w3') }, portsFn, { width: 760, agentOrder: ['n1', 'n2'] });
  assert.equal(flat.height, flat.rows[0].top + flat.rows[0].h + FLOW_PAD_Y, 'no bottom gutter ⇒ just the pad');
});

const LOOP_PORTS = (n) => ({
  task: { inputs: [], outputs: [{ id: 'task', type: 'md' }] },
  end: { inputs: [{ id: 'result', type: 'any' }], outputs: [] },
  agent: n.key === 'implementer'
    ? { inputs: [{ id: 'task', type: 'md' }, { id: 'fix', type: 'md', required: false, loop: true }], outputs: [{ id: 'done', type: 'void' }] }
    : { inputs: [{ id: 'done', type: 'void' }], outputs: [{ id: 'fix', type: 'md', when: 'blocking' }, { id: 'ok', type: 'void', when: 'clean' }] },
}[n.kind]);

test('every row reserves its label row above the cards; a same-row loop in the last row bills the swoop', () => {
  const tpl = {
    nodes: [
      { id: 'n_t', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_a', kind: 'agent', key: 'implementer', x: 0, y: 0, config: {} },
      { id: 'n_r', kind: 'agent', key: 'reviewer', x: 0, y: 0, config: {} },
      { id: 'n_e', kind: 'end', x: 0, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_t', port: 'task' }, to: { node: 'n_a', port: 'task' } },
      { id: 'w2', from: { node: 'n_a', port: 'done' }, to: { node: 'n_r', port: 'done' } },
      { id: 'w3', from: { node: 'n_r', port: 'fix' }, to: { node: 'n_a', port: 'fix' }, config: { maxCycles: 2 } },
      { id: 'w4', from: { node: 'n_r', port: 'ok' }, to: { node: 'n_e', port: 'result' } },
    ],
  };
  const lay = flowLayout(tpl, LOOP_PORTS, { width: 2000, scale: 0.65, band: false });   // one row
  assert.equal(lay.rows[0].top, 28 + LABEL_H * 0.65);
  assert.equal(lay.bottomBand, SWOOP_DROP * 0.65 + FLOW_BADGE_H / 2 + 1, 'the drop scales, the 18px pill does not');
});
