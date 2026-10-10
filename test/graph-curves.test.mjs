// test/graph-curves.test.mjs — the one wire shape (mockup:2060-2097): forward/S cubics, the same-row swoop
// under the cards with its lowest point as the pill anchor, samples that hitRoute can test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireCurve, ghostCurve, SWOOP_DROP, CURVE_SAMPLES } from '../src/shared/graph/curves.mjs';
import { hitRoute } from '../src/shared/graph/route.mjs';

const card = (x, y, w = 232, h = 100) => ({ x, y, w, h });

test('a forward wire is one cubic with horizontal tangents: c = clamp(|dx|·.5 + |dy|·.1, 40, 240)', () => {
  const c = wireCurve({ x: 0, y: 0 }, { x: 300, y: 0 });
  assert.equal(c.d, 'M 0 0 C 150 0 150 0 300 0');
  assert.equal(c.swoop, false);
  assert.deepEqual(c.mid, { x: 150, y: 0 });
  const far = wireCurve({ x: 0, y: 0 }, { x: 1000, y: 100 });
  assert.equal(far.d, 'M 0 0 C 240 0 760 100 1000 100', 'c clamps at 240');
});

test('a backward wire with no card rects (the ghost) is one big S: c = clamp(90 + |dx|·.35 + |dy|·.3, 110, 340)', () => {
  const c = wireCurve({ x: 300, y: 0 }, { x: 0, y: 0 });
  assert.equal(c.d, 'M 300 0 C 495 0 -195 0 0 0');
  assert.equal(c.swoop, false);
});

test('a same-row backward wire swoops UNDER both cards; the pill sits at the lowest point', () => {
  const A = card(0, 0); const B = card(400, 0);
  const c = wireCurve({ x: 632, y: 50 }, { x: 0, y: 17 }, { from: B, to: A, rects: [A, B] });
  assert.equal(c.swoop, true);
  assert.equal(c.d, 'M 632 50 C 729.9 50 543.7 138 316 138 C 88.3 138 -97.9 17 0 17');
  assert.deepEqual(c.mid, { x: 316, y: 100 + SWOOP_DROP });
});

test('the swoop floor drops below any card it passes, not only its own two', () => {
  const A = card(0, 0); const B = card(800, 0); const tall = card(400, 0, 232, 180);
  const c = wireCurve({ x: 1032, y: 50 }, { x: 0, y: 17 }, { from: B, to: A, rects: [A, B, tall] });
  assert.equal(c.mid.y, 180 + SWOOP_DROP);
});

test('a self loop swoops under its own card', () => {
  const A = card(0, 0);
  const c = wireCurve({ x: 232, y: 60 }, { x: 0, y: 40 }, { from: A, to: A, rects: [A], self: true });
  assert.equal(c.swoop, true);
  assert.deepEqual(c.mid, { x: 116, y: 138 });
  assert.match(c.d, /^M 232 60 C 305\.9 60 220\.5 138 116 138 C 11\.5 138 -73\.9 40 0 40$/);
});

test('a backward wire into a LOWER row is an S, not a swoop', () => {
  const B = card(400, 0); const A = card(0, 200);
  const c = wireCurve({ x: 632, y: 50 }, { x: 0, y: 217 }, { from: B, to: A, rects: [A, B] });
  assert.equal(c.swoop, false);
  assert.match(c.d, /^M 632 50 C /);
});

test('xMin (a flow host clips at its left edge): a backward S flattens until no sample is left of it', () => {
  const B = card(400, 0); const A = card(20, 200);
  const a = { x: 632, y: 50 }; const b = { x: 20, y: 217 };
  const free = wireCurve(a, b, { from: B, to: A, rects: [A, B] });
  assert.ok(free.pts.some((p) => p.x < 1), 'unbounded, the S lobe leaves the host');
  const kept = wireCurve(a, b, { from: B, to: A, rects: [A, B], xMin: 1 });
  assert.equal(kept.swoop, false);
  assert.ok(kept.pts.every((p) => p.x >= 1), `every sample stays right of xMin (${kept.d})`);
  assert.deepEqual([kept.pts[0], kept.pts.at(-1)], [a, b], 'still anchored on both ports');
  assert.equal(wireCurve(a, b, { from: B, to: A, rects: [A, B], xMin: -1e5 }).d, free.d, 'an edge it never reaches changes nothing');
});

test('samples start and end on the anchors, and hitRoute finds the drawn line', () => {
  const A = card(0, 0); const B = card(400, 0);
  const c = wireCurve({ x: 632, y: 50 }, { x: 0, y: 17 }, { from: B, to: A, rects: [A, B] });
  assert.equal(c.pts.length, 2 * CURVE_SAMPLES + 1);
  assert.deepEqual(c.pts[0], { x: 632, y: 50 });
  assert.deepEqual(c.pts.at(-1), { x: 0, y: 17 });
  assert.ok(hitRoute(c.pts, c.mid));
  assert.ok(!hitRoute(c.pts, { x: 316, y: 60 }));
});

test('a pill that would land on a card walks along the wire until it is clear', () => {
  const blocker = card(100, -50, 100, 100);
  const c = wireCurve({ x: 0, y: 0 }, { x: 300, y: 0 }, { rects: [blocker] });
  const inside = (p) => p.x >= 100 - 14 && p.x <= 200 + 14 && p.y >= -50 - 9 && p.y <= 50 + 9;
  assert.ok(!inside(c.mid), `pill at ${JSON.stringify(c.mid)} is still on the card`);
});

test('scale multiplies every fixed offset (a 0.65 flow host)', () => {
  const A = card(0, 0, 150.8, 65); const B = card(260, 0, 150.8, 65);
  const c = wireCurve({ x: 410.8, y: 30 }, { x: 0, y: 11 }, { from: B, to: A, rects: [A, B], scale: 0.65 });
  assert.equal(c.mid.y, 65 + SWOOP_DROP * 0.65);
});

test('ghostCurve: an output drag runs anchor→cursor; a mirrored (input) drag leaves the input to the LEFT', () => {
  assert.equal(ghostCurve({ x: 0, y: 0 }, { x: 300, y: 0 }), 'M 0 0 C 150 0 150 0 300 0');
  const m = ghostCurve({ x: 300, y: 0 }, { x: 0, y: 0 }, { mirror: true });
  assert.equal(m, 'M 0 0 C 150 0 150 0 300 0', 'mirrored: drawn from the cursor (as the output) into the input anchor');
});
