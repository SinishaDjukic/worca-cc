// src/shared/graph/route.mjs
// THE wire router: one orthogonal, obstacle-avoiding path generator for every
// surface (composer canvas, run monitor, static host, thumbnail) and for the hit
// test. Pure, DOM-free and deterministic — same template in, byte-identical
// routes out — so the whole shape of a wire is unit-testable without jsdom and
// a repaint never measures.
//
// A route is an orthogonal polyline: the port anchor, a mandatory straight stub,
// an A*-found middle section over a sparse channel grid, the entry stub, the
// target anchor. Corners are rounded at paint time (routePathD), never in the
// model, so hit testing reads the same vertices the painter drew.
import { WIRE_HIT_TOL } from './geometry.mjs';

/** obstacle inflation: the minimum gap between a wire and a card edge. 24 keeps
 *  the mid-wire `N×` pill (18px tall, centred on the line → ±9px) clear of the
 *  ornaments overhanging a card's top edge (.nrun at top:-9px, .npip/.ngate at
 *  -7px) with 6px of air. */
export const ROUTE_CLEARANCE = 24;
/** straight exit/entry length at a port (> CLEARANCE, so stub tips clear their own card's inflated rect). */
export const ROUTE_STUB = 28;
/** corner rounding radius (clamped to half of the adjacent segments). */
export const ROUTE_RADIUS = 8;
/** separation between parallel wires sharing a channel. */
export const ROUTE_LANE_GAP = 7;
/** A* bend penalty, in px-equivalent. */
const TURN_COST = 40;
const EPS = 0.01;

// The direction priority is NORMATIVE, not cosmetic: it is the FINAL tie-break
// key, and it is what resolves a true above/below tie BELOW the cards (both goal
// entries agree on every positional key, so only the arrival direction is left —
// `up` means arriving from below and must outrank `down`).
const DIRS = ['right', 'up', 'left', 'down'];
const DIR_RANK = new Map(DIRS.map((d, i) => [d, i]));
const STEP = { right: [1, 0], up: [0, -1], left: [-1, 0], down: [0, 1] };

const inflate = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
const containsStrict = (r, p) =>
  p.x > r.x + EPS && p.x < r.x + r.w - EPS && p.y > r.y + EPS && p.y < r.y + r.h - EPS;

/** True when the axis-aligned segment p→q overlaps a rect INTERIOR. Running
 *  exactly along an inflated boundary is legal — wires hug the clearance line. */
function segBlocked(p, q, rects) {
  const x0 = Math.min(p.x, q.x); const x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y); const y1 = Math.max(p.y, q.y);
  for (const r of rects) {
    if (x1 < r.x + EPS || x0 > r.x + r.w - EPS) continue;
    if (y1 < r.y + EPS || y0 > r.y + r.h - EPS) continue;
    return true; // axis-aligned segment overlaps the rect interior in both axes
  }
  return false;
}

/** Candidate coordinates on one axis: the given values (rect edges + stub tips),
 *  deduped and sorted, plus the midline between each adjacent pair. */
function axisCoords(values) {
  const uniq = [...new Set(values)].sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i < uniq.length; i += 1) {
    out.push(uniq[i]);
    if (i + 1 < uniq.length) out.push((uniq[i] + uniq[i + 1]) / 2);
  }
  return out;
}

/** A binary min-heap over the fully-ordered comparator below. */
function createHeap(better) {
  const items = [];
  const swap = (i, j) => { const t = items[i]; items[i] = items[j]; items[j] = t; };
  return {
    get size() { return items.length; },
    push(node) {
      items.push(node);
      let i = items.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (!better(items[i], items[parent])) break;
        swap(i, parent);
        i = parent;
      }
    },
    pop() {
      const top = items[0];
      const last = items.pop();
      if (items.length) {
        items[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1; const r = l + 1;
          let m = i;
          if (l < items.length && better(items[l], items[m])) m = l;
          if (r < items.length && better(items[r], items[m])) m = r;
          if (m === i) break;
          swap(i, m);
          i = m;
        }
      }
      return top;
    },
  };
}

/**
 * A* from stub tip `sa` to stub tip `sb` over the sparse channel grid, in states
 * `(xi, yi, dir)`. Returns the polyline INCLUDING sa and sb, or null when there
 * is no corridor (the caller falls back to an elbow).
 *
 * Normative rules (two independent implementations must converge on these):
 *  · the goal is detected when its state is POPPED, never at push time — the
 *    tie-break can only arbitrate between goal entries that are both in the heap;
 *  · the closed set is keyed per (xi, yi, dir), never per coordinate alone;
 *  · relaxation needs a STRICT g improvement;
 *  · arrival rules apply only when `strictArrival` (a committed wire): a vertical
 *    arrival costs TURN_COST/2 (added to g, NOT to the `turns` tie-break key) and
 *    a leftward arrival is banned (no U-turn into the input's rightward stub).
 *    A loose cursor end is approachable from any direction at no cost.
 */
function astar(sa, sb, rects, { startDir = 'right', strictArrival = true } = {}) {
  const xs = axisCoords([sa.x, sb.x, ...rects.flatMap((r) => [r.x, r.x + r.w])]);
  const ys = axisCoords([sa.y, sb.y, ...rects.flatMap((r) => [r.y, r.y + r.h])]);
  const xi0 = xs.indexOf(sa.x); const yi0 = ys.indexOf(sa.y);
  const xg = xs.indexOf(sb.x); const yg = ys.indexOf(sb.y);
  if (xi0 < 0 || yi0 < 0 || xg < 0 || yg < 0) return null;
  const midX = (sa.x + sb.x) / 2; const midY = (sa.y + sb.y) / 2;
  const heuristic = (xi, yi) => Math.abs(xs[xi] - sb.x) + Math.abs(ys[yi] - sb.y);
  const better = (p, q) => {
    if (p.f !== q.f) return p.f < q.f;
    if (p.turns !== q.turns) return p.turns < q.turns;
    const dp = Math.abs(xs[p.xi] - midX) + Math.abs(ys[p.yi] - midY);
    const dq = Math.abs(xs[q.xi] - midX) + Math.abs(ys[q.yi] - midY);
    if (dp !== dq) return dp < dq;
    if (ys[p.yi] !== ys[q.yi]) return ys[p.yi] > ys[q.yi];        // y DESC (biases below)
    if (xs[p.xi] !== xs[q.xi]) return xs[p.xi] < xs[q.xi];        // x ASC
    return DIR_RANK.get(p.dir) < DIR_RANK.get(q.dir);             // right < up < left < down
  };
  const heap = createHeap(better);
  const closed = new Set();
  const bestG = new Map();
  heap.push({ xi: xi0, yi: yi0, dir: startDir, g: 0, f: heuristic(xi0, yi0), turns: 0, parent: null });
  bestG.set(`${xi0},${yi0},${startDir}`, 0);
  while (heap.size) {
    const cur = heap.pop();
    const key = `${cur.xi},${cur.yi},${cur.dir}`;
    if (closed.has(key)) continue;
    closed.add(key);
    if (cur.xi === xg && cur.yi === yg) {                          // goal at POP time
      const pts = [];
      for (let n = cur; n; n = n.parent) pts.push({ x: xs[n.xi], y: ys[n.yi] });
      return simplify(pts.reverse());
    }
    const p = { x: xs[cur.xi], y: ys[cur.yi] };
    for (const dir of DIRS) {
      const [dx, dy] = STEP[dir];
      const nx = cur.xi + dx; const ny = cur.yi + dy;
      if (nx < 0 || nx >= xs.length || ny < 0 || ny >= ys.length) continue;
      const goal = nx === xg && ny === yg;
      if (goal && strictArrival && dir === 'left') continue;       // no U-turn into the entry stub
      const q = { x: xs[nx], y: ys[ny] };
      if (segBlocked(p, q, rects)) continue;
      const turned = dir !== cur.dir;
      const turns = cur.turns + (turned ? 1 : 0);
      const arrival = goal && strictArrival && (dir === 'up' || dir === 'down') ? TURN_COST / 2 : 0;
      const g = cur.g + Math.abs(q.x - p.x) + Math.abs(q.y - p.y) + (turned ? TURN_COST : 0) + arrival;
      const k = `${nx},${ny},${dir}`;
      if (closed.has(k)) continue;
      const seen = bestG.get(k);
      if (seen !== undefined && seen <= g) continue;               // STRICT improvement only
      bestG.set(k, g);
      heap.push({ xi: nx, yi: ny, dir, g, f: g + heuristic(nx, ny), turns, parent: cur });
    }
  }
  return null;
}

/**
 * Route ONE wire a→b around `obstacles` (RAW card rects; inflated here).
 * mirror   = the ghost drag STARTED on an input, so the stub leaves leftward.
 * looseEnd = b is a free cursor point (ghost): no entry stub, no arrival
 *            direction rules, and any obstacle containing b is dropped so
 *            hovering a target card still routes.
 * stub     = per-wire exit stub length (routeAll staggers fan-out siblings).
 * Returns an orthogonal polyline INCLUDING a and b. NEVER throws, never NaN:
 * an unroutable pair (jammed/overlapping cards, or an anchor stub tip engulfed
 * by an overlapping card's inflated rect) falls back to a plain elbow.
 * NOTE the exit leg a→sa and entry leg sb→b intentionally pass through their
 * OWN card's clearance band (the anchor sits ON the card edge) — that is the
 * port exit, not a violation.
 */
export function routeWire(a, b, obstacles, { mirror = false, looseEnd = false, stub = ROUTE_STUB } = {}) {
  const s = mirror ? -1 : 1;
  const sa = { x: a.x + s * stub, y: a.y };
  const sb = looseEnd ? { x: b.x, y: b.y } : { x: b.x - ROUTE_STUB, y: b.y };
  const inflated = (Array.isArray(obstacles) ? obstacles : [])
    .filter((r) => r && r.w > 0 && r.h > 0)
    .map((r) => inflate(r, ROUTE_CLEARANCE));
  const rects = looseEnd ? inflated.filter((r) => !containsStrict(r, sb)) : inflated;
  const jammed = rects.some((r) => containsStrict(r, sa)) || (!looseEnd && rects.some((r) => containsStrict(r, sb)));
  const core = jammed ? null : astar(sa, sb, rects, { startDir: mirror ? 'left' : 'right', strictArrival: !looseEnd });
  const mid = core || fallbackElbow(sa, sb, mirror);
  return simplify([a, ...mid, ...(looseEnd ? [] : [b])]);
}

/** Straight when possible, one mid-channel elbow forward, a dive-below detour backward. */
function fallbackElbow(sa, sb, mirror) {
  const fwd = mirror ? sb.x <= sa.x : sb.x >= sa.x;
  if (fwd && sa.y === sb.y) return [sa, sb];
  if (fwd) {
    const mx = (sa.x + sb.x) / 2;
    return [sa, { x: mx, y: sa.y }, { x: mx, y: sb.y }, sb];
  }
  const my = Math.max(sa.y, sb.y) + 3 * ROUTE_CLEARANCE;
  return [sa, { x: sa.x, y: my }, { x: sb.x, y: my }, sb];
}

/** Drop repeated + collinear points so corners are real corners. */
function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && q.x === p.x && q.y === p.y) continue;
    const r = out[out.length - 2];
    if (q && r && ((r.x === q.x && q.x === p.x) || (r.y === q.y && q.y === p.y))) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/** Strict AABB overlap — rectangles that merely touch edges count as disjoint. */
const overlaps = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;

/** The drag fast path's reuse contract: the SAME array instance comes back when
 *  the endpoints are unchanged (VALUE equality — anchors are rebuilt every frame)
 *  and the cached route's inflated bbox is disjoint from the dirty world rect. */
function reusable(prevPts, w, dirty) {
  if (!Array.isArray(prevPts) || prevPts.length < 2) return null;
  const first = prevPts[0]; const last = prevPts[prevPts.length - 1];
  if (first.x !== w.a.x || first.y !== w.a.y) return null;
  if (last.x !== w.b.x || last.y !== w.b.y) return null;
  const m = ROUTE_CLEARANCE + 2 * ROUTE_LANE_GAP;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of prevPts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const box = { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
  return overlaps(box, dirty) ? null : prevPts;
}

/**
 * Route a whole template's wires with separation. `wires` = [{id, a, b}].
 * Deterministic: processing order and lane assignment key on the wire id sort,
 * never on Map/insertion order.
 * `prev`/`dirty` are the drag fast path: a wire whose endpoints are unchanged
 * and whose cached RAW route's bbox (inflated by CLEARANCE + 2·LANE_GAP) does
 * not touch the `dirty` world-rect reuses its cached raw route instead of
 * re-running A*. The cache is DRAG-ONLY: callers must finish every drag with
 * a full `dirty = null` pass (D15) so committed state is always canonical.
 */
export function routeAll(wires, obstacles, { prev = null, dirty = null } = {}) {
  const sorted = [...wires].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  // Fan-out stagger: wires leaving the SAME output anchor peel off at different
  // stub lengths (outward only, so every tip stays clear of the inflated rect).
  // For same-row fan-outs A*'s late-bend preference + the collinear simplify
  // collapse the staggered tips back onto one line — there the visible
  // peel-apart is delivered by separateRoutes shifting the siblings' first-bend
  // legs. The stagger still differentiates routes that bend early.
  const groups = new Map(); // `${a.x},${a.y}` -> ordered wire ids
  for (const w of sorted) {
    const k = `${w.a.x},${w.a.y}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w.id);
  }
  const raw = new Map();
  for (const w of sorted) {
    const lane = groups.get(`${w.a.x},${w.a.y}`).indexOf(w.id);
    const stub = ROUTE_STUB + Math.min(lane * ROUTE_LANE_GAP, 24);
    const cached = prev && dirty ? reusable(prev.get(w.id), w, dirty) : null;
    raw.set(w.id, cached || routeWire(w.a, w.b, obstacles, { stub }));
  }
  return { raw, routes: separateRoutes(raw) };
}

/**
 * Spread wires apart where they share a channel. Only INTERIOR segments move —
 * the anchor legs at each end are pinned so ports stay honest (stub tips may
 * slide sideways within the clearance budget; anchors never move).
 * Offsets are centered lanes ordered by wire id; the total spread is clamped to
 * ±(ROUTE_CLEARANCE − 2) so a nudged wire can never cross a REAL card edge
 * (the clearance inflation is the budget it moves within).
 */
export function separateRoutes(raw, { gap = ROUTE_LANE_GAP } = {}) {
  const segs = []; // {id, i, axis, coord, lo, hi}
  for (const [id, pts] of [...raw.entries()].sort(([p], [q]) => (p < q ? -1 : 1))) {
    for (let i = 2; i <= pts.length - 2; i += 1) {          // every leg except the two anchor legs
      const p = pts[i - 1]; const q = pts[i];
      if (p.x === q.x) segs.push({ id, i, axis: 'v', coord: p.x, lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y) });
      else if (p.y === q.y) segs.push({ id, i, axis: 'h', coord: p.y, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x) });
    }
  }
  const shifts = new Map(); // `${id}:${i}` -> { axis, off }
  const byLine = new Map();
  for (const s of segs) {
    const k = `${s.axis}:${s.coord}`;
    if (!byLine.has(k)) byLine.set(k, []);
    byLine.get(k).push(s);
  }
  for (const line of byLine.values()) {
    line.sort((p, q) => p.lo - q.lo);
    let cluster = [];
    let end = -Infinity;
    const flush = () => {
      if (cluster.length < 2) { cluster = []; return; }
      cluster.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : p.i - q.i));
      const n = cluster.length;
      const g = Math.min(gap, (2 * (ROUTE_CLEARANCE - 2)) / (n - 1));
      cluster.forEach((s, k) => shifts.set(`${s.id}:${s.i}`, { axis: s.axis, off: (k - (n - 1) / 2) * g }));
      cluster = [];
    };
    for (const s of line) {
      if (s.lo > end) flush();
      cluster.push(s);
      end = Math.max(end, s.hi);
    }
    flush();
  }
  const out = new Map();
  for (const [id, pts] of raw) {
    const copy = pts.map((p) => ({ ...p }));
    for (let i = 2; i <= copy.length - 2; i += 1) {         // SAME range as collection
      const sh = shifts.get(`${id}:${i}`);
      if (!sh || !sh.off) continue;
      if (sh.axis === 'v') { copy[i - 1].x += sh.off; copy[i].x += sh.off; }
      else { copy[i - 1].y += sh.off; copy[i].y += sh.off; }
    }
    out.set(id, copy);
  }
  return out;
}

const num = (v) => String(Math.round(v * 100) / 100);
const dist = (p, q) => Math.abs(q.x - p.x) + Math.abs(q.y - p.y); // legs are axis-aligned
const towards = (from, to, r) => {
  const l = dist(from, to) || 1;
  return { x: from.x + ((to.x - from.x) / l) * r, y: from.y + ((to.y - from.y) / l) * r };
};

/** Rounded-corner SVG path for an orthogonal polyline. Radius clamps to half
 *  of each adjacent leg so short jogs never overshoot. */
export function routePathD(pts, radius = ROUTE_RADIUS) {
  if (!Array.isArray(pts) || pts.length < 2) return '';
  let d = `M ${num(pts[0].x)} ${num(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const p = pts[i - 1]; const c = pts[i]; const n = pts[i + 1];
    const r = Math.min(radius, dist(p, c) / 2, dist(c, n) / 2);
    const tin = towards(c, p, r); const tout = towards(c, n, r);
    d += ` L ${num(tin.x)} ${num(tin.y)} Q ${num(c.x)} ${num(c.y)} ${num(tout.x)} ${num(tout.y)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${num(last.x)} ${num(last.y)}`;
}

/** Point at half the polyline's arc length — where the wire badge sits. */
export function routeMid(pts) {
  if (!Array.isArray(pts) || !pts.length) return { x: 0, y: 0 };
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) total += dist(pts[i - 1], pts[i]);
  let acc = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const leg = dist(pts[i - 1], pts[i]);
    if (acc + leg >= total / 2) {
      const t = leg ? (total / 2 - acc) / leg : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    acc += leg;
  }
  return { ...pts[pts.length - 1] };
}

/** Exact point-to-segment distance per leg — no sampling, no gap (the MAJ-18
 *  class of bug stays fixed). Painted corners are rounded by ≤ r·(1−1/√2) ≈
 *  2.35px relative to this sharp polyline — well inside WIRE_HIT_TOL = 6. */
export function hitRoute(pts, pt, tol = WIRE_HIT_TOL) {
  for (let i = 1; i < (pts?.length || 0); i += 1) {
    if (distanceToSegment(pt, pts[i - 1], pts[i]) <= tol) return true;
  }
  return false;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function distanceToSegment(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}
