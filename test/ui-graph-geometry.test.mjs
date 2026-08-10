// test/ui-graph-geometry.test.mjs
// graph-geometry.mjs is the pure geometry layer of the composer: card sizing
// (STACKED port zones — all inputs, 9px separator, all outputs, then the agent
// card's second separator + bottom await gate row), port anchors, wire beziers
// and the hit tests. Every pixel value below is pinned by the plan/spec, so a
// silent geometry drift breaks here rather than in the renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_DEFAULT, FIXTURE_FLOW, FIXTURE_PORTS, portsFnFor } from '../src/core/graph/fixtures.mjs';
import {
  NODE_W, HEADER_H, PORT_ROW_H, PORT_SEP, PAD_T, PAD_B, BORDER, FOOTER_H, EXEC_ROW_H, SNAP,
  PORT_HIT_R, WIRE_HIT_TOL,
  nodeSize, portAnchor, bezierPath, snap, hitNode, hitPort, hitWire, fitBounds,
} from '../ui/public/graph/graph-geometry.mjs';

const ports = portsFnFor(FIXTURE_PORTS);
const nodeOf = (template, id) => template.nodes.find((n) => n.id === id);

/** The endpoints an `M x y C ..., ..., x y` cubic actually starts and ends at. */
function endpoints(d) {
  const m = /^M (-?[\d.]+) (-?[\d.]+) C .*, (-?[\d.]+) (-?[\d.]+)$/.exec(d);
  assert.ok(m, `not a single cubic: ${d}`);
  return { a: { x: Number(m[1]), y: Number(m[2]) }, b: { x: Number(m[3]), y: Number(m[4]) } };
}

test('the pinned geometry constants', () => {
  assert.equal(NODE_W, 220);
  assert.equal(HEADER_H, 34);
  assert.equal(PORT_ROW_H, 24);
  assert.equal(PORT_SEP, 9);
  assert.equal(PAD_T, 8.5);
  assert.equal(PAD_B, 8);
  assert.equal(BORDER, 1.5);
  assert.equal(FOOTER_H, 26);
  assert.equal(EXEC_ROW_H, 22);
  assert.equal(SNAP, 11);
  assert.equal(PORT_HIT_R, 14);
  assert.equal(WIRE_HIT_TOL, 6);
});

// ------------------------------------------------------------------ nodeSize

test('agent card height is 95.5 + 24*(nInMeta + nOut) — the await row is measured, not counted as a meta input', () => {
  for (const [id, nInMeta, nOut] of [['n_clarify', 1, 1], ['n_refine', 2, 2], ['n_review', 2, 2], ['n_impl', 3, 1]]) {
    const p = ports(nodeOf(FIXTURE_DEFAULT, id));
    assert.equal(p.inputs.filter((i) => !i.synthetic).length, nInMeta, `${id} meta inputs`);
    assert.equal(p.outputs.length, nOut, `${id} outputs`);
    assert.deepEqual(nodeSize(p), { w: 220, h: 95.5 + 24 * (nInMeta + nOut) }, `${id} size`);
  }
});

test('Task and End are 1-port caption cards: H = 110.5', () => {
  const task = ports(nodeOf(FIXTURE_DEFAULT, 'n_task'));
  const end = ports(nodeOf(FIXTURE_DEFAULT, 'n_end'));
  assert.deepEqual(task.inputs, []);
  assert.equal(task.outputs.length, 1);
  assert.equal(end.inputs.length, 1);
  assert.deepEqual(end.outputs, []);
  assert.deepEqual(nodeSize(task, { caption: true }), { w: 220, h: 110.5 });
  assert.deepEqual(nodeSize(end, { caption: true }), { w: 220, h: 110.5 });
});

test("the caption's own separator fires only when BOTH port zones are non-empty (the AND/OR pair)", () => {
  const or2 = ports(nodeOf(FIXTURE_FLOW, 'n_or'));
  const or3 = ports({ kind: 'or', config: { arity: 3 } });
  const and2 = ports(nodeOf(FIXTURE_FLOW, 'n_and'));
  assert.deepEqual(nodeSize(or2, { caption: true }), { w: 220, h: 167.5 });
  assert.deepEqual(nodeSize(or3, { caption: true }), { w: 220, h: 191.5 });
  assert.deepEqual(nodeSize(and2), { w: 220, h: 134.5 });          // no caption on and/combine
  // Same ports, caption off: exactly one caption row + its separator (24 + 9) apart.
  assert.equal(nodeSize(or2, { caption: true }).h - nodeSize(or2).h, 33);
  // Task/End: one zone empty, so the caption adds the row only (24) — no second separator.
  const end = ports(nodeOf(FIXTURE_DEFAULT, 'n_end'));
  assert.equal(nodeSize(end, { caption: true }).h - nodeSize(end).h, 24);
});

test('footerRows: 0 = none, 1 = the 26px strip, >1 adds 22px execution rows', () => {
  const p = ports(nodeOf(FIXTURE_DEFAULT, 'n_review'));
  const base = nodeSize(p).h;
  assert.equal(nodeSize(p, { footerRows: 0 }).h, base);
  assert.equal(nodeSize(p, { footerRows: 1 }).h, base + 26);
  assert.equal(nodeSize(p, { footerRows: 2 }).h, base + 26 + 22);
  assert.equal(nodeSize(p, { footerRows: 4 }).h, base + 26 + 3 * 22);
});

// ---------------------------------------------------------------- portAnchor

test('agent anchors: meta-input i at y+56+24i, output j at y+65+24*nInMeta+24j, await at y+74+24*(nInMeta+nOut)', () => {
  const node = { ...nodeOf(FIXTURE_DEFAULT, 'n_review'), x: 100, y: 200 };
  const p = ports(node);                                    // ins plan, done, await · outs review, pass
  assert.deepEqual(portAnchor(node, p, 'plan', 'in'), { x: 100, y: 256 });
  assert.deepEqual(portAnchor(node, p, 'done', 'in'), { x: 100, y: 280 });
  assert.deepEqual(portAnchor(node, p, 'review', 'out'), { x: 320, y: 313 });
  assert.deepEqual(portAnchor(node, p, 'pass', 'out'), { x: 320, y: 337 });
  assert.deepEqual(portAnchor(node, p, 'await', 'in'), { x: 100, y: 370 });   // 200 + 74 + 24*4
});

test('the await anchor sits on the LEFT edge below every meta row, for any port count', () => {
  for (const id of ['n_clarify', 'n_plan', 'n_refine', 'n_impl', 'n_review']) {
    const node = { ...nodeOf(FIXTURE_DEFAULT, id), x: 12, y: 34 };
    const p = ports(node);
    const nInMeta = p.inputs.filter((i) => !i.synthetic).length;
    assert.deepEqual(portAnchor(node, p, 'await', 'in'), { x: 12, y: 34 + 74 + 24 * (nInMeta + p.outputs.length) });
  }
});

test('a 0-input card (Task) renders its output FIRST, in the input-zone slot at y+56', () => {
  const node = { ...nodeOf(FIXTURE_DEFAULT, 'n_task'), x: 40, y: 200 };
  assert.deepEqual(portAnchor(node, ports(node), 'task', 'out'), { x: 260, y: 256 });
});

test("End's result input anchors at y+56 via the standard input formula", () => {
  const node = { ...nodeOf(FIXTURE_DEFAULT, 'n_end'), x: 500, y: 90 };
  assert.deepEqual(portAnchor(node, ports(node), 'result', 'in'), { x: 500, y: 146 });
});

test('flow-card anchors use the standard formulas (or arity 2)', () => {
  const node = { ...nodeOf(FIXTURE_FLOW, 'n_or'), x: 0, y: 0 };
  const p = ports(node);
  assert.deepEqual(portAnchor(node, p, 'in1', 'in'), { x: 0, y: 56 });
  assert.deepEqual(portAnchor(node, p, 'in2', 'in'), { x: 0, y: 80 });
  assert.deepEqual(portAnchor(node, p, 'out', 'out'), { x: 220, y: 113 });    // 56 + 9 + 24*2
});

test('a caption never shifts an anchor — the OR out stays in the output zone above it', () => {
  const node = { ...nodeOf(FIXTURE_FLOW, 'n_or'), x: 0, y: 0 };
  const p = ports(node);
  const withCaption = nodeSize(p, { caption: true });
  assert.ok(portAnchor(node, p, 'out', 'out').y < withCaption.h);
  assert.deepEqual(portAnchor(node, p, 'out', 'out'), { x: 220, y: 113 });
});

// ---------------------------------------------------------------- bezierPath

test('bezier endpoints equal the anchors it was handed', () => {
  const from = { ...nodeOf(FIXTURE_DEFAULT, 'n_refine'), x: 880, y: 200 };
  const to = { ...nodeOf(FIXTURE_DEFAULT, 'n_impl'), x: 1160, y: 200 };
  const a = portAnchor(from, ports(from), 'plan', 'out');
  const b = portAnchor(to, ports(to), 'plan', 'in');
  assert.deepEqual(endpoints(bezierPath(a, b)), { a, b });
  assert.deepEqual(endpoints(bezierPath(a, b, { loop: true })), { a, b });
});

test('control-point dx is 0.45 of the horizontal span, clamped to 48..160', () => {
  assert.equal(bezierPath({ x: 0, y: 0 }, { x: 100, y: 50 }), 'M 0 0 C 48 0, 52 50, 100 50');
  assert.equal(bezierPath({ x: 0, y: 0 }, { x: 200, y: 0 }), 'M 0 0 C 90 0, 110 0, 200 0');
  assert.equal(bezierPath({ x: 0, y: 0 }, { x: 400, y: 0 }), 'M 0 0 C 160 0, 240 0, 400 0');
  assert.equal(bezierPath({ x: 400, y: 0 }, { x: 0, y: 0 }), 'M 400 0 C 560 0, -160 0, 0 0');   // |dx|
});

test('loop wires bow underneath by 56 + 0.2 of the vertical span', () => {
  assert.equal(bezierPath({ x: 0, y: 0 }, { x: 100, y: 50 }, { loop: true }), 'M 0 0 C 48 66, 52 116, 100 50');
  assert.notEqual(bezierPath({ x: 0, y: 0 }, { x: 100, y: 50 }, { loop: true }),
    bezierPath({ x: 0, y: 0 }, { x: 100, y: 50 }));
});

// ----------------------------------------------------------- snap + hit tests

test('snap rounds to the 11px half-grid', () => {
  assert.equal(snap(0), 0);
  assert.equal(snap(5), 0);
  assert.equal(snap(6), 11);
  assert.equal(snap(17), 22);
  assert.equal(snap(-6), -11);
  assert.equal(snap(220), 220);
});

test('hitNode is the card rect', () => {
  const node = { x: 100, y: 100 };
  const size = { w: 220, h: 110.5 };
  assert.equal(hitNode(node, size, { x: 110, y: 110 }), true);
  assert.equal(hitNode(node, size, { x: 319, y: 210 }), true);
  assert.equal(hitNode(node, size, { x: 321, y: 110 }), false);
  assert.equal(hitNode(node, size, { x: 110, y: 99 }), false);
});

test('hitPort is a 14px radius around the dot', () => {
  const anchor = { x: 100, y: 100 };
  assert.equal(hitPort(anchor, { x: 100, y: 100 }), true);
  assert.equal(hitPort(anchor, { x: 113, y: 100 }), true);
  assert.equal(hitPort(anchor, { x: 115, y: 100 }), false);
  assert.equal(hitPort(anchor, { x: 110, y: 110 }), false);      // 14.14 away
});

test('hitWire is a 6px corridor around the curve', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 200, y: 0 };
  assert.equal(hitWire(a, b, { x: 100, y: 0 }), true);
  assert.equal(hitWire(a, b, { x: 100, y: 5 }), true);
  assert.equal(hitWire(a, b, { x: 100, y: 9 }), false);
  assert.equal(hitWire(a, b, { x: 100, y: 40 }, { loop: true }), true);   // the bow passes here
  assert.equal(hitWire(a, b, { x: 100, y: 40 }), false);
});

test('fitBounds unions the boxes, with optional padding', () => {
  const boxes = [{ x: 40, y: 200, w: 220, h: 110.5 }, { x: 600, y: 100, w: 220, h: 191.5 }];
  assert.deepEqual(fitBounds(boxes), { x: 40, y: 100, w: 780, h: 210.5 });
  assert.deepEqual(fitBounds(boxes, 10), { x: 30, y: 90, w: 800, h: 230.5 });
  assert.equal(fitBounds([]), null);
});
