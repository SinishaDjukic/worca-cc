// test/graph-sessions-geometry.test.mjs — tray rectangles from the model alone (no DOM), hand-computed fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionHeads, sessionRects } from '../src/shared/graph/sessions.mjs';

const N = (id, x, y) => ({ id, kind: 'agent', key: 'k', x, y, config: {} });
const sizeOf = () => ({ w: 232, h: 150 });
const spec = (sid, members, internalWires = []) => ({ sid, members, closure: members, flows: [], internalWires });
const byId = (...ns) => new Map(ns.map((n) => [n.id, n]));

test('one session, two cards at y 100: head 46..70, tray -12,46 576×216', () => {
  const nodes = byId(N('a', 0, 100), N('b', 320, 100));
  assert.deepEqual(sessionHeads([spec('s1', ['a', 'b'])], nodes, sizeOf), [{ id: 's1', x: -12, y: 46, w: 576, h: 24 }]);
  const r = sessionRects([spec('s1', ['a', 'b'])], nodes, sizeOf, new Map()).get('s1');
  assert.deepEqual({ x: r.x, y: r.y, w: r.w, h: r.h }, { x: -12, y: 46, w: 576, h: 216 });
  assert.deepEqual(r.head, { x: -12, y: 46, w: 576, h: 24 });
});

test('an internal floor loop below the cards grows the tray to hold its pill', () => {
  const nodes = byId(N('a', 0, 100), N('b', 320, 100));
  const routes = new Map([['w9', { pts: [{ x: 552, y: 200 }, { x: 560, y: 300 }, { x: -6, y: 300 }, { x: 0, y: 120 }], mid: { x: 270, y: 300 } }]]);
  const r = sessionRects([spec('s1', ['a', 'b'], ['w9'])], nodes, sizeOf, routes).get('s1');
  assert.equal(r.y + r.h, 312 + 12, 'pill bottom (300 + 12) + PAD_B');
  assert.equal(r.x, -18, 'the leg at x -6, minus PAD_X');
});

test('adjacent trays are clamped to an 8 px gutter; pads never shrink below 4', () => {
  const nodes = byId(N('a', 0, 100), N('b', 320, 100), N('c', 572, 100), N('d', 892, 100));
  const m = sessionRects([spec('s1', ['a', 'b']), spec('s2', ['c', 'd'])], nodes, sizeOf, new Map());
  const A = m.get('s1'); const B = m.get('s2');
  assert.equal(A.x + A.w, 558);
  assert.equal(B.x, 566);
  assert.equal(B.x - (A.x + A.w), 8);
});

test('scale multiplies every constant; header:false drops the strip', () => {
  const nodes = byId(N('a', 0, 100), N('b', 320, 100));
  const r = sessionRects([spec('s1', ['a', 'b'])], nodes, sizeOf, new Map(), { scale: 0.5, header: false }).get('s1');
  assert.equal(r.head, null);
  assert.equal(r.x, -6);
  assert.equal(r.y, 100 - 13 - 4);
});

test('flow cards and internal routes count; a wire that leaves the session does not', () => {
  const nodes = byId(N('a', 0, 100), N('b', 320, 100), N('f', 120, 400));
  const routes = new Map([['w1', { pts: [{ x: 232, y: 160 }, { x: 320, y: 160 }], mid: { x: 276, y: 160 } }],
    ['w2', { pts: [{ x: 552, y: 160 }, { x: 900, y: 700 }], mid: { x: 726, y: 430 } }]]);
  const r = sessionRects([{ ...spec('s1', ['a', 'b'], ['w1']), flows: ['f'] }], nodes, sizeOf, routes).get('s1');
  assert.equal(r.y + r.h, 400 + 150 + 12, 'the flow card bottom + PAD_B');
  assert.equal(r.x + r.w, 552 + 12, 'w2 is not internal: its far point is ignored');
  assert.deepEqual(r.content, { x: 0, y: 74, r: 552, b: 550 });
});

test('a lane above the strip lifts the tray; the strip keeps its own y', () => {
  const nodes = byId(N('a', 0, 100), N('b', 320, 100));
  const routes = new Map([['w1', { pts: [{ x: 232, y: 120 }, { x: 250, y: 20 }, { x: 300, y: 20 }, { x: 320, y: 120 }], mid: { x: 275, y: 20 } }]]);
  const r = sessionRects([spec('s1', ['a', 'b'], ['w1'])], nodes, sizeOf, routes).get('s1');
  assert.equal(r.y, 12, 'the lane at y 20, minus 8');
  assert.deepEqual(r.head, { x: -12, y: 46, w: 576, h: 24 });
});

test('the clamp: trays in different rows are left alone; a 6 px gap keeps 4 px pads and the strip follows', () => {
  const rows = byId(N('a', 0, 100), N('b', 320, 100), N('c', 572, 400), N('d', 892, 400));
  const m = sessionRects([spec('s1', ['a', 'b']), spec('s2', ['c', 'd'])], rows, sizeOf, new Map());
  assert.equal(m.get('s1').x + m.get('s1').w, 564);
  assert.equal(m.get('s2').x, 560);
  const tight = byId(N('a', 0, 100), N('b', 320, 100), N('c', 558, 100), N('d', 878, 100));
  const t = sessionRects([spec('s1', ['a', 'b']), spec('s2', ['c', 'd'])], tight, sizeOf, new Map());
  assert.equal(t.get('s1').x + t.get('s1').w, 556, 'max(555 - 4, 552 + 4)');
  assert.equal(t.get('s2').x, 554, 'min(555 + 4, 558 - 4)');
  assert.equal(t.get('s2').head.x, 554);
  assert.equal(t.get('s1').head.w, t.get('s1').w);
});

test('a session with no member on the canvas has no head and no tray', () => {
  const nodes = byId(N('a', 0, 100));
  assert.deepEqual(sessionHeads([spec('s1', ['x', 'y'])], nodes, sizeOf), []);
  assert.equal(sessionRects([spec('s1', ['x', 'y'])], nodes, sizeOf, new Map()).size, 0);
});

test('scale multiplies every constant with the strip on: the head, the pads, the pill, the gutter and the pad floor', () => {
  const nodes = byId(N('a', 0, 100), N('b', 320, 100));
  assert.deepEqual(sessionHeads([spec('s1', ['a', 'b'])], nodes, sizeOf, { scale: 0.5 }), [{ id: 's1', x: -6, y: 73, w: 564, h: 12 }]);
  const routes = new Map([['w9', { pts: [{ x: 552, y: 200 }, { x: 552, y: 300 }], mid: { x: 270, y: 300 } }]]);
  const r = sessionRects([spec('s1', ['a', 'b'], ['w9'])], nodes, sizeOf, routes, { scale: 0.5 }).get('s1');
  assert.deepEqual({ x: r.x, y: r.y, w: r.w, h: r.h }, { x: -6, y: 73, w: 564, h: 239 }, 'the pill to 300 + 6, then PAD_B 6');
  const pair = (cx) => {
    const m = sessionRects([spec('s1', ['a', 'b']), spec('s2', ['c', 'd'])],
      byId(N('a', 0, 100), N('b', 320, 100), N('c', cx, 100), N('d', cx + 320, 100)), sizeOf, new Map(), { scale: 0.5 });
    return [m.get('s1').x + m.get('s1').w, m.get('s2').x];
  };
  assert.deepEqual(pair(570), [558, 564], 'a 6 px gap is wider than the 4 px gutter: no clamp');
  assert.deepEqual(pair(566), [557, 561], 'm 559, half the gutter each side');
  assert.deepEqual(pair(558), [554, 556], 'the 2 px pad floor on both sides');
});

test('the clamp leaves trays stacked in rows alone (their boxes overlap in x)', () => {
  // autoLayout stacks rows ROW_GAP 64 apart: the upper tray's PAD_B (12) and the lower strip (54 above its cards) overlap by 2.
  const m = sessionRects([spec('s1', ['a', 'b']), spec('s2', ['c', 'd'])],
    byId(N('a', 0, 100), N('b', 320, 100), N('c', 0, 314), N('d', 320, 314)), sizeOf, new Map());
  assert.deepEqual([...m.values()].map((t) => [t.x, t.w]), [[-12, 576], [-12, 576]]);
});
