// src/shared/graph/curves.mjs
// The wire shape of the FLOW hosts (the Auto pop-up, Ask's cards — rows that
// wrap) and of the composer's wiring-drag ghost; the canvas, the run monitor and
// the saved-workflow thumbnails route through lanes.mjs. A wire is ONE smooth
// cubic that leaves its output horizontally and enters its input horizontally
// (the Blueprint "spline"); a backward wire between two cards of the SAME row, and
// a self loop, is a SWOOP of two cubics that passes UNDER the cards, its lowest
// point SWOOP_DROP below the lowest card it passes — that point anchors the
// loop's "≤N" pill. Wires may cross cards: the cards are frosted glass above the
// wire layer. Pure and DOM-free (test/shared-graph-purity.test.mjs).
// Port of the 2026-10-09 mockup (composer-mockup.html canvas.js `route`).

/** Points per cubic segment: the hit polyline and the fit bounds read them. */
export const CURVE_SAMPLES = 16;
/** px between the lowest card a swoop passes and the swoop's lowest point. */
export const SWOOP_DROP = 38;
/** A target this far (px) below the source card's bottom is on another row. */
export const ROW_SLACK = 12;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;
const pt = (p) => `${r1(p.x)} ${r1(p.y)}`;
const bottom = (r) => r.y + r.h;

function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u; const b = 3 * u * u * t; const c = 3 * u * t * t; const d = t * t * t;
  return { x: r1(a * p0.x + b * p1.x + c * p2.x + d * p3.x), y: r1(a * p0.y + b * p1.y + c * p2.y + d * p3.y) };
}

function sample(segs) {
  const out = [{ x: r1(segs[0][0].x), y: r1(segs[0][0].y) }];
  for (const s of segs) for (let i = 1; i <= CURVE_SAMPLES; i += 1) out.push(cubicAt(s[0], s[1], s[2], s[3], i / CURVE_SAMPLES));
  return out;
}

const pathD = (segs) => `M ${pt(segs[0][0])} ${segs.map((s) => `C ${pt(s[1])} ${pt(s[2])} ${pt(s[3])}`).join(' ')}`;

/** The pill point of a non-swoop wire: t = .5, walked ±.0225 per step (≤ 20 steps) until it is
 *  clear of every card (each grown 14px on x and 9px on y, scaled). */
function pillPoint(seg, rects, s) {
  const onCard = (p) => rects.some((r) => p.x >= r.x - 14 * s && p.x <= r.x + r.w + 14 * s && p.y >= r.y - 9 * s && p.y <= bottom(r) + 9 * s);
  const at = (t) => cubicAt(seg[0], seg[1], seg[2], seg[3], t);
  const first = at(0.5);
  if (!onCard(first)) return first;
  for (let k = 1; k <= 20; k += 1) {
    for (const t of [0.5 - k * 0.0225, 0.5 + k * 0.0225]) {
      const p = at(t);
      if (!onCard(p)) return p;
    }
  }
  return first;
}

/**
 * @param {{x:number,y:number}} a  the OUTPUT anchor (where the wire starts)
 * @param {{x:number,y:number}} b  the INPUT anchor (where it ends)
 * @param {object} [o]
 * @param {{x,y,w,h}|null} [o.from]  the source card's box (no label row) — null for a ghost
 * @param {{x,y,w,h}|null} [o.to]    the target card's box
 * @param {Array<{x,y,w,h}>} [o.rects]  every card box: the swoop floor and the pill avoid them
 * @param {boolean} [o.self]  a wire from a card into the same card
 * @param {number} [o.scale]  the host's geometry scale (flow hosts: 0.65)
 * @param {number} [o.xMin]   a hard left edge (a flow host clips at its own x 0): a backward S flattens
 *   (its tangent length × .75, at most 16 times) until no sample lies left of it. Forward wires and swoops ignore it.
 * @returns {{d:string, pts:Array<{x,y}>, mid:{x,y}, swoop:boolean}}
 */
export function wireCurve(a, b, { from = null, to = null, rects = [], self = false, scale = 1, xMin = -Infinity } = {}) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const crossRows = !!(from && to && !self && (b.y > bottom(from) + ROW_SLACK * s || a.y > bottom(to) + ROW_SLACK * s));
  if (!self && dx >= 0) {
    const c = clamp(Math.abs(dx) * 0.5 + Math.abs(dy) * 0.1, 40 * s, 240 * s);
    const seg = [a, { x: a.x + c, y: a.y }, { x: b.x - c, y: b.y }, b];
    return { d: pathD([seg]), pts: sample([seg]), mid: pillPoint(seg, rects, s), swoop: false };
  }
  if (!self && (!from || !to || crossRows)) {
    let c = clamp(90 * s + Math.abs(dx) * 0.35 + Math.abs(dy) * 0.3, 110 * s, 340 * s);
    let seg = [a, { x: a.x + c, y: a.y }, { x: b.x - c, y: b.y }, b];
    let pts = sample([seg]);
    // A host with a hard left edge (flow rows wrap right → left): flatten the S until it stays inside.
    for (let k = 0; k < 16 && pts.some((p) => p.x < xMin); k += 1) {
      c *= 0.75;
      seg = [a, { x: a.x + c, y: a.y }, { x: b.x - c, y: b.y }, b];
      pts = sample([seg]);
    }
    return { d: pathD([seg]), pts, mid: pillPoint(seg, rects, s), swoop: false };
  }
  const lo = Math.min(a.x, b.x) - 20 * s;
  const hi = Math.max(a.x, b.x) + 20 * s;
  const top = Math.min(a.y, b.y) - 4 * s;
  const bot = Math.max(a.y, b.y) + 4 * s;
  let floor = Math.max(from ? bottom(from) : a.y, to ? bottom(to) : b.y);
  for (const r of rects) {
    if (r.x <= hi && r.x + r.w >= lo && r.y <= bot && bottom(r) >= top) floor = Math.max(floor, bottom(r));
  }
  const low = floor + SWOOP_DROP * s;
  const k = clamp(60 * s + Math.abs(dx) * 0.06, 70 * s, 130 * s);
  const m = { x: (a.x + b.x) / 2, y: low };
  const d = Math.max(30 * s, (a.x + k - m.x) * 0.55);
  const segs = [
    [a, { x: a.x + k, y: a.y }, { x: m.x + d, y: low }, m],
    [m, { x: m.x - d, y: low }, { x: b.x - k, y: b.y }, b],
  ];
  return { d: pathD(segs), pts: sample(segs), mid: { x: r1(m.x), y: r1(m.y) }, swoop: true };
}

/** The dashed ghost of a wiring drag (no rects: forward = one cubic, backward = one big S).
 *  `mirror` (a drag that started on an INPUT): the cursor plays the output, so the curve
 *  still leaves the input to its left. */
export function ghostCurve(anchor, end, { mirror = false, scale = 1 } = {}) {
  return (mirror ? wireCurve(end, anchor, { scale }) : wireCurve(anchor, end, { scale })).d;
}
