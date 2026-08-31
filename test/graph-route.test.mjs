// test/graph-route.test.mjs — the orthogonal router: every claim provable
// without DOM. Fixtures use real card sizes (NODE_W=220) so clearances are honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  routeWire, routeAll, routePathD, routeMid, hitRoute,
  ROUTE_CLEARANCE, ROUTE_STUB,
} from '../src/shared/graph/route.mjs';

const CARD = (x, y, h = 120) => ({ x, y, w: 220, h });
const orthogonal = (pts) => pts.every((p, i) => !i || p.x === pts[i - 1].x || p.y === pts[i - 1].y);
const insideRect = (p, r, m) =>
  p.x > r.x - m + 0.01 && p.x < r.x + r.w + m - 0.01 &&
  p.y > r.y - m + 0.01 && p.y < r.y + r.h + m - 0.01;
/**
 * Sample every leg at 1px steps. A route is "crossing" when any sample sits
 * inside a RAW card (any leg — stubs exit outward, they never enter a card),
 * or inside a CLEARANCE-inflated card on an INTERIOR leg (the first and last
 * legs are the port exits: they legally cross their own card's clearance band
 * because the anchor sits ON the card edge).
 */
function crossesObstacle(pts, rects) {
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]; const b = pts[i];
    const endLeg = i === 1 || i === pts.length - 1;
    const n = Math.max(1, Math.round(Math.abs(b.x - a.x) + Math.abs(b.y - a.y)));
    for (let k = 1; k < n; k += 1) {
      const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
      if (rects.some((r) => insideRect(p, r, 0))) return true;
      if (!endLeg && rects.some((r) => insideRect(p, r, ROUTE_CLEARANCE))) return true;
    }
  }
  return false;
}

test('clearance headroom: stubs outrank the inflation; the inflation clears the card-top ornaments', () => {
  // A wire hugging the clearance line carries the mid-arc `N×` pill (18px tall,
  // centred on the line → ±9px) past ornaments overhanging the card top: .nrun
  // at top:-9px, .npip/.ngate at -7px. 9 + 9 + 6px air = 24.
  assert.ok(ROUTE_CLEARANCE >= 24, 'the badge (±9px) must clear .nrun (-9px) with air');
  assert.ok(ROUTE_STUB > ROUTE_CLEARANCE, 'stub tips must clear their own card\'s inflated rect');
});

test('same-row, clear channel: a dead-straight wire, zero bends', () => {
  const a = { x: 280, y: 116 }; const b = { x: 400, y: 116 };
  const pts = routeWire(a, b, [CARD(60, 60), CARD(400, 60)]);
  assert.deepEqual(pts, [a, b]);
});

test('offset rows, clear channel: orthogonal, starts and ends at the anchors, honors stubs', () => {
  const a = { x: 280, y: 199 }; const b = { x: 400, y: 136 };
  const pts = routeWire(a, b, [CARD(60, 60, 200), CARD(400, 80, 200)]);
  assert.ok(orthogonal(pts));
  assert.deepEqual(pts[0], a);
  assert.deepEqual(pts[pts.length - 1], b);
  assert.equal(pts[1].y, a.y);                       // leaves horizontally
  assert.ok(pts[1].x >= a.x + ROUTE_STUB);           // full exit stub
  assert.equal(pts[pts.length - 2].y, b.y);          // enters horizontally
  assert.ok(pts[pts.length - 2].x <= b.x - ROUTE_STUB);
});

test('a card square in the corridor: the route detours around it, never inside the clearance band', () => {
  const blocker = CARD(360, 40, 300);                // sits between source (right edge 280) and target (left edge 680)
  const a = { x: 280, y: 190 }; const b = { x: 680, y: 190 };
  const obstacles = [CARD(60, 100, 200), blocker, CARD(680, 100, 200)];
  const pts = routeWire(a, b, obstacles);
  assert.ok(orthogonal(pts));
  assert.ok(!crossesObstacle(pts, obstacles), 'route stays out of every card + interior legs out of every clearance band');
});

test('backward (loop) wire: a TRUE above/below tie resolves BELOW the cards', () => {
  // Anchors at card mid-height (cards span y 60..240, inflated 48..252):
  // above channel cost (150−48)·2 = 204 equals below (252−150)·2 = 204, turns
  // and arrival penalty identical — a REAL tie. At the goal both candidate
  // entries share x, y, f, turns and mid-distance, so ONLY the arrival
  // direction can decide: §3.2's dir priority ranks 'up' (from below) over
  // 'down' (from above). This test pins that priority — with the naive
  // right,down,left,up order the route resolves ABOVE and this stays red.
  const from = CARD(400, 60, 180); const to = CARD(60, 60, 180);
  const a = { x: 620, y: 150 }; const b = { x: 60, y: 150 };
  const pts = routeWire(a, b, [from, to]);
  assert.ok(orthogonal(pts));
  assert.ok(!crossesObstacle(pts, [from, to]));
  assert.ok(Math.max(...pts.map((p) => p.y)) > 60 + 180, 'detour dives below the card row');
});

test('looseEnd ghost: a straight leftward mirror drag stays a dead-straight two-point route', () => {
  // Arrival rules are strict-only (§3.2): a free cursor may be approached
  // moving leftward. Without that scoping this red test paints a 3-bend staple.
  const a = { x: 400, y: 160 };                      // input anchor on the card's left edge
  const pts = routeWire(a, { x: 300, y: 160 }, [CARD(400, 80)], { mirror: true, looseEnd: true });
  assert.deepEqual(pts, [a, { x: 300, y: 160 }]);
});

test('deterministic: same inputs, same route, and obstacle ARRAY ORDER does not matter', () => {
  const a = { x: 280, y: 190 }; const b = { x: 680, y: 190 };
  const obs = [CARD(60, 100), CARD(360, 40, 300), CARD(680, 100)];
  const r1 = routeWire(a, b, obs);
  const r2 = routeWire(a, b, [...obs].reverse());
  assert.deepEqual(r1, r2);
});

test('jammed: target buried under an overlapping card still yields a clean orthogonal fallback', () => {
  const a = { x: 280, y: 100 }; const b = { x: 300, y: 100 };
  const pts = routeWire(a, b, [CARD(60, 40), CARD(200, 40), CARD(280, 40)]);
  assert.ok(orthogonal(pts));
  assert.ok(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), 'never NaN');
});

// ------------------------------------------- routeAll: stagger + separation

test('fan-out from ONE output anchor: siblings peel apart at distinct, id-ordered positions', () => {
  // Empirical note: A*'s late-bend + simplify collapse the staggered stub tips
  // here (all three raw routes bend at x=380); separateRoutes then shifts the
  // clustered bend legs to 375/380/385. The assertions pin the visible outcome.
  const a = { x: 280, y: 116 };
  const wires = [
    { id: 'w1', a, b: { x: 400, y: 96 } },
    { id: 'w2', a, b: { x: 400, y: 156 } },
    { id: 'w3', a, b: { x: 400, y: 216 } },
  ];
  const { routes } = routeAll(wires, [CARD(60, 60), CARD(400, 60, 220)]);
  const tips = [...routes.values()].map((pts) => pts[1].x);
  assert.equal(new Set(tips).size, 3, 'three distinct peel-off x positions');
  assert.deepEqual(tips, [...tips].sort((p, q) => p - q), 'w1 innermost — lane order follows the id sort');
});

/** The shared-channel fixture: both anchors sit BELOW the blocker's midline, so
 *  both wires genuinely take the same below channel. */
const CHANNEL_OBSTACLES = [CARD(60, 100, 260), CARD(360, 40, 300), CARD(680, 100, 260)];
const CHANNEL_WIRES = [
  { id: 'wa', a: { x: 280, y: 260 }, b: { x: 680, y: 260 } },
  { id: 'wb', a: { x: 280, y: 300 }, b: { x: 680, y: 300 } },
];

test('two wires sharing a below-channel separate by a lane gap; the spread never exceeds the clearance budget', () => {
  const { raw, routes } = routeAll(CHANNEL_WIRES, CHANNEL_OBSTACLES);
  // raw routes share the descent/channel/ascent lines; separated ones do not overlap
  const vx = (pts) => pts.filter((p, i) => i && pts[i - 1].x === p.x).map((p) => p.x);
  const sharedRaw = vx(raw.get('wa')).filter((x) => vx(raw.get('wb')).includes(x));
  assert.ok(sharedRaw.length, 'fixture really produces shared vertical channels');
  const sharedSep = vx(routes.get('wa')).filter((x) => vx(routes.get('wb')).includes(x));
  assert.equal(sharedSep.length, 0, 'separated wires no longer share a channel line');
  assert.ok(orthogonal(routes.get('wa')) && orthogonal(routes.get('wb')), 'shifts preserve orthogonality');
});

test('separation moves INTERIOR legs only: every route still starts/ends exactly at its anchors', () => {
  const { routes } = routeAll(CHANNEL_WIRES, CHANNEL_OBSTACLES);
  for (const w of CHANNEL_WIRES) {
    const pts = routes.get(w.id);
    assert.deepEqual(pts[0], w.a, 'the output anchor never moves');
    assert.deepEqual(pts[pts.length - 1], w.b, 'the input anchor never moves');
    assert.equal(pts[1].y, w.a.y, 'the exit leg stays horizontal');
    assert.equal(pts[pts.length - 2].y, w.b.y, 'the entry leg stays horizontal');
  }
});

test('routeAll is deterministic under input order (wires shuffled ⇒ identical routes)', () => {
  const straight = routeAll(CHANNEL_WIRES, CHANNEL_OBSTACLES);
  const shuffled = routeAll([...CHANNEL_WIRES].reverse(), CHANNEL_OBSTACLES);
  assert.deepEqual(shuffled.routes, straight.routes);
  assert.deepEqual(shuffled.raw, straight.raw);
});

test('routeAll with prev+dirty reuses far routes and re-routes near ones; a dirty=null pass is canonical', () => {
  const ids = ['wa', 'wb', 'wc'];
  const wires = ids.map((id, k) => ({ id, a: { x: 280, y: 116 + 300 * k }, b: { x: 400, y: 116 + 300 * k } }));
  const obstacles = ids.flatMap((_, k) => [CARD(60, 60 + 300 * k), CARD(400, 60 + 300 * k)]);
  const first = routeAll(wires, obstacles);
  const dirty = { x: 290, y: 60, w: 60, h: 80 };                    // covers only wa's corridor
  const mixed = routeAll(wires, obstacles, { prev: first.raw, dirty });
  assert.equal(mixed.raw.get('wb'), first.raw.get('wb'), 'a far wire reuses the SAME cached array');
  assert.equal(mixed.raw.get('wc'), first.raw.get('wc'), 'a far wire reuses the SAME cached array');
  assert.notEqual(mixed.raw.get('wa'), first.raw.get('wa'), 'the dirty corridor is re-routed');
  const canonical = routeAll(wires, obstacles, { prev: mixed.raw, dirty: null });
  assert.deepEqual(canonical.routes, routeAll(wires, obstacles).routes, 'a dirty=null pass is canonical');
});

// -------------------------------------------------- paint, midpoint, hit test

test('routePathD: straight line has no Q; each corner is L + Q; radius clamps on short jogs', () => {
  assert.equal(routePathD([{ x: 0, y: 0 }, { x: 100, y: 0 }]), 'M 0 0 L 100 0');
  const d = routePathD([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }]);
  assert.equal(d, 'M 0 0 L 32 0 Q 40 0 40 8 L 40 30');           // r = 8
  const tight = routePathD([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 40 }]);
  assert.equal(tight, 'M 0 0 L 3 0 Q 6 0 6 3 L 6 40');           // r clamps to 6/2
});

test('routeMid: half the arc length, exact on a two-bend elbow', () => {
  // legs 40 + 30 + 40 = 110; midpoint 55 → 15 into the vertical leg
  assert.deepEqual(routeMid([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 80, y: 30 }]), { x: 40, y: 15 });
});

test('hitRoute: every 1px sample ON the polyline hits; a point 7px off any leg misses', () => {
  const pts = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 80, y: 30 }];
  for (let x = 0; x <= 40; x += 1) assert.ok(hitRoute(pts, { x, y: 0 }));
  assert.ok(!hitRoute(pts, { x: 20, y: 7 }));
  assert.ok(hitRoute(pts, { x: 20, y: 6 }), 'WIRE_HIT_TOL = 6 boundary is inclusive');
});
