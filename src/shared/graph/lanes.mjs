// src/shared/graph/lanes.mjs
// THE wire router of the workflow canvas (the composer, the run monitor, the
// saved-workflow thumbnails). Every wire is routed TOGETHER with the others, as
// an orthogonal polyline painted with ROUTE_RADIUS corners (route.mjs
// routePathD): a straight wire, a one-bend wire that runs at its source or
// target height and bends once in a gap, a wire that rises into a free LANE
// above / below the cards when its straight run would cut across one, or a
// backward wire that returns on a FLOOR lane under the cards. Lanes keep LANE
// px apart (shorter spans take the inner lanes, so lanes nest instead of
// crossing); the vertical legs sharing a gap each get their own slot, in the
// order with the fewest crossings. OR / AND inputs are order-free, so
// routeGraph may hand a merge card's WIRED inputs out in the order the wires
// arrive (mergePorts). Wires may pass behind cards: the cards are frosted glass
// above the wire layer. Flow hosts (rows that wrap) keep curves.mjs.
// Pure, DOM-free and deterministic — same template in, byte-identical routes out.
// Port of the 2026-10-10 wire-lanes study (Lanes router, no trunks).
import { LABEL_H } from './geometry.mjs';
import { routePathD, routeMid, ROUTE_RADIUS } from './route.mjs';

/** px between two parallel lane runs, and between two vertical legs sharing a gap. */
export const LANE = 12;
/** clearance a lane keeps from a card (label row included). */
const M_CORR = 14;
/** clearance a straight run at a port's height keeps from a card it does not touch. */
const M_RUN = 8;
/** the widest gap a one-bend wire bends in. */
const GAP_MAX = 96;
/** the closest two vertical legs may be squeezed before a crossing is cheaper. */
const SLOT_MIN = 6;
/** straight run kept at a port before a corner (8px corner + a visible stub). */
const MIN_STUB = 14;
/** lane-choice costs (px-equivalent): passing a wired port on the way in or out, crossing a one-bend wire. */
const PORT_PENALTY = 60;
const CROSS_PENALTY = 90;
/** a loop that would ride ABOVE the cards pays this: loops come back along the floor. */
const LOOP_ROOF = 600;
/** an input this little right of its output is a backward wire. */
const BACKWARD_DX = 24;
const MERGE_KINDS = new Set(['or', 'and']);   // combine concatenates its inputs in port order: never reordered

const isNode = (n) => Boolean(n) && typeof n === 'object' && !Array.isArray(n) && typeof n.id === 'string';
const near = (p, q) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01;

/** Drop repeated and collinear vertices: the painter and the hit test read the same clean polyline. */
function clean(pts) {
  const out = [];
  for (const p of pts) {
    if (out.length && near(out[out.length - 1], p)) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2]; const b = out[out.length - 1];
      if ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - p.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - p.y) < 0.01)) out.pop();
    }
    out.push(p);
  }
  return out;
}

/**
 * Route every wire at once.
 * @param {Array<{id:string,x:number,y:number,w:number,h:number}>} cards  card BOXES (each one's label row is added above it)
 * @param {Array<{id:string,from:string,to:string,a:{x,y},b:{x,y},loop?:boolean,pill?:boolean}>} wires
 *   from/to = card ids, a = the output anchor, b = the input anchor; `loop` prefers the floor; `pill` places
 *   the wire's "≤N" pill on its lane run nearest its source (every other wire's mid is its arc midpoint).
 * @param {{scale?:number}} [opts]
 * @returns {Map<string,{pts:Array<{x,y}>, d:string, mid:{x,y}}>}
 */
export function routeLanes(cards, wires, { scale = 1 } = {}) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  const lane = LANE * s; const mCorr = M_CORR * s; const mRun = M_RUN * s; const gapMax = GAP_MAX * s;
  const slotMin = SLOT_MIN * s; const stub = MIN_STUB * s;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const rects = cards.map((c) => ({ id: c.id, x: c.x, y: c.y - LABEL_H * s, r: c.x + c.w, b: c.y + c.h }));
  const recs = [];
  for (const w of wires) {
    const src = byId.get(w.from); const dst = byId.get(w.to);
    if (src && dst && w.a && w.b) recs.push({ w, id: w.id, src, dst, a: w.a, b: w.b });
  }
  const hitsBox = (r, x0, x1, y0, y1) => r.x < x1 && r.r > x0 && r.y < y1 && r.b > y0;
  const runClear = (y, x0, x1, skip) => x1 - x0 < 1 || !rects.some((r) => !skip.has(r.id) && hitsBox(r, x0, x1, y - mRun, y + mRun));
  // the gap left of x = bx (right of x = ax) that a vertical leg spanning y0..y1 may use
  const gapLeft = (bx, y0, y1, self) => {
    let L = bx - gapMax;
    for (const r of rects) if (r.id !== self && r.r <= bx + 0.5 && r.y < y1 + 4 * s && r.b > y0 - 4 * s) L = Math.max(L, r.r);
    return Math.min(L, bx - stub);
  };
  const gapRight = (ax, y0, y1, self) => {
    let R = ax + gapMax;
    for (const r of rects) if (r.id !== self && r.x >= ax - 0.5 && r.y < y1 + 4 * s && r.b > y0 - 4 * s) R = Math.min(R, r.x);
    return Math.max(R, ax + stub);
  };

  // 1. classify: straight, one bend in a gap (direct), laned forward, backward ------------------
  for (const R of recs) {
    const { a, b } = R; const skip = new Set([R.src.id, R.dst.id]);
    const y0 = Math.min(a.y, b.y); const y1 = Math.max(a.y, b.y);
    R.kind = 'lane'; R.fwd = false;
    if (R.src === R.dst || b.x - a.x < BACKWARD_DX * s) continue;
    R.fwd = true;
    if (Math.abs(a.y - b.y) < 0.5 && runClear(a.y, a.x, b.x, skip)) { R.kind = 'straight'; continue; }
    const gL = Math.max(a.x, gapLeft(b.x, y0, y1, R.dst.id));
    if (runClear(a.y, a.x, gL, skip)) { R.kind = 'direct'; R.at = 'entry'; R.gap = [gL, b.x]; continue; }
    const gR = Math.min(b.x, gapRight(a.x, y0, y1, R.src.id));
    if (runClear(b.y, gR, b.x, skip)) { R.kind = 'direct'; R.at = 'exit'; R.gap = [a.x, gR]; continue; }
  }

  // 2. one lane unit per laned wire --------------------------------------------------------------
  const units = recs.filter((R) => R.kind === 'lane').map((R) => {
    const u = { key: R.id, fwd: R.fwd, loop: Boolean(R.w.loop), m: R };
    if (R.fwd) { u.x0 = R.a.x; u.x1 = R.b.x; } else { u.x0 = R.b.x - 30 * s; u.x1 = R.a.x + 30 * s; }
    u.span = u.x1 - u.x0;
    R.unit = u;
    return u;
  });
  const wiredIn = new Map(); const wiredOut = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const R of recs) { push(wiredIn, R.dst.id, R.b.y); push(wiredOut, R.src.id, R.a.y); }
  const between = (arr, y0, y1) => (arr || []).filter((y) => y > Math.min(y0, y1) + 0.5 && y < Math.max(y0, y1) - 0.5).length;
  const directs = recs.filter((R) => R.kind === 'direct');
  function freeBands(x0, x1) {
    const ivs = rects.filter((r) => r.x < x1 && r.r > x0).map((r) => [r.y - mCorr, r.b + mCorr]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const out = []; let prev = -Infinity;
    for (const [lo, hi] of ivs) { if (lo > prev) out.push([prev, lo]); prev = Math.max(prev, hi); }
    out.push([prev, Infinity]);
    return out;
  }
  // Cost of a band: vertical travel, a penalty per wired port passed on the way in or out, one per
  // one-bend wire the lane would cross; a loop pays to ride above the cards.
  function bandsFor(u) {
    const { a, b, src, dst } = u.m;
    const mid = (Math.min(a.y, b.y) + Math.max(a.y, b.y)) / 2;
    const list = [];
    for (const [top, bot] of freeBands(u.x0 + 1, u.x1 - 1)) {
      let base; let dir;
      if (top === -Infinity) { base = bot; dir = -1; } else if (bot === Infinity) { base = top; dir = 1; }
      else if (Math.abs(top - mid) <= Math.abs(bot - mid)) { base = top; dir = 1; } else { base = bot; dir = -1; }
      let cost = Math.abs(base - a.y) + Math.abs(base - b.y)
        + PORT_PENALTY * s * (between(wiredIn.get(dst.id), base, b.y) + between(wiredOut.get(src.id), base, a.y));
      cost += CROSS_PENALTY * s * directs.filter((R) => R.gap[0] < u.x1 && R.gap[1] > u.x0
        && base > Math.min(R.a.y, R.b.y) + 0.5 && base < Math.max(R.a.y, R.b.y) - 0.5).length;
      if (u.loop && top === -Infinity) cost += LOOP_ROOF * s;
      list.push({ top, bot, base, dir, cost });
    }
    return list.sort((p, q) => p.cost - q.cost || p.base - q.base);
  }

  // 3. tracks: shortest span first, each takes the first track LANE clear of every run it overlaps ---
  const placed = [];
  for (const R of recs) {
    if (R.kind === 'straight') placed.push({ y: R.a.y, x0: R.a.x, x1: R.b.x });
    if (R.kind === 'direct') placed.push(R.at === 'entry' ? { y: R.a.y, x0: R.a.x, x1: R.gap[0] } : { y: R.b.y, x0: R.gap[1], x1: R.b.x });
  }
  const padX = 14 * s;
  const conflict = (y, x0, x1) => placed.some((p) => p.x0 < x1 + padX && p.x1 > x0 - padX && Math.abs(p.y - y) < lane - 0.01);
  for (const u of [...units].sort((p, q) => p.span - q.span || (p.key < q.key ? -1 : p.key > q.key ? 1 : 0))) {
    let y = null;
    for (const band of bandsFor(u)) {
      for (let k = 0; k < 60 && y === null; k += 1) {
        const at = band.base + band.dir * k * lane;
        if (at < band.top - 0.01 || at > band.bot + 0.01) break;
        if (!conflict(at, u.x0, u.x1)) y = at;
      }
      if (y !== null) break;
    }
    if (y === null) y = Math.max(...rects.map((r) => r.b)) + mCorr;
    u.lane = y;
    placed.push({ y, x0: u.x0, x1: u.x1 });
  }

  // 4. bends: every vertical leg, with the gap it may sit in and the heights its horizontals attach at --
  const bends = [];
  const mk = (o) => {
    o.flat = Math.abs(o.y1 - o.y0) < 0.5;
    if (o.R - o.L < stub) { if (o.edgeR != null) o.L = o.R - stub; else o.R = o.L + stub; }
    o.lo = Math.max(o.edgeL != null ? o.edgeL + stub : -Infinity, o.ax != null ? o.ax + stub : -Infinity);
    o.hi = Math.min(o.edgeR != null ? o.edgeR - stub : Infinity, o.bx != null ? o.bx - stub : Infinity);
    bends.push(o);
    return o;
  };
  for (const R of recs) {
    if (R.kind !== 'direct') continue;
    R.bend = mk({ y0: R.a.y, y1: R.b.y, L: R.gap[0], R: R.gap[1], edgeL: R.at === 'exit' ? R.a.x : null, edgeR: R.at === 'entry' ? R.b.x : null,
      ax: R.a.x, bx: R.b.x, leftH: [R.a.y], rightH: [R.b.y] });
  }
  for (const u of units) {
    const R = u.m; const y = u.lane;
    const exitGap = gapRight(R.a.x, Math.min(R.a.y, y), Math.max(R.a.y, y), R.src.id);
    const entryGap = gapLeft(R.b.x, Math.min(R.b.y, y), Math.max(R.b.y, y), R.dst.id);
    if (u.fwd) {
      R.exit = mk({ y0: R.a.y, y1: y, L: R.a.x, R: exitGap, edgeL: R.a.x, edgeR: null, leftH: [R.a.y], rightH: [y] });
      R.entry = mk({ y0: y, y1: R.b.y, L: entryGap, R: R.b.x, edgeL: null, edgeR: R.b.x, leftH: [y], rightH: [R.b.y] });
    } else {   // out to the right, down (or up) to the lane, back left along it, up into the input
      R.exit = mk({ y0: R.a.y, y1: y, L: R.a.x, R: exitGap, edgeL: R.a.x, edgeR: null, leftH: [R.a.y, y], rightH: [] });
      R.entry = mk({ y0: y, y1: R.b.y, L: entryGap, R: R.b.x, edgeL: null, edgeR: R.b.x, leftH: [], rightH: [y, R.b.y] });
    }
  }

  // 5. cluster the legs that share a gap, order each cluster, slot it -------------------------------
  const act = bends.filter((b) => !b.flat);
  const parent = act.map((_, i) => i);
  const find = (i) => { let j = i; while (parent[j] !== j) { parent[j] = parent[parent[j]]; j = parent[j]; } return j; };
  const ylo = (b) => Math.min(b.y0, b.y1); const yhi = (b) => Math.max(b.y0, b.y1);
  for (let i = 0; i < act.length; i += 1) {
    for (let j = i + 1; j < act.length; j += 1) {
      const A = act[i]; const B = act[j];
      if (A.L < B.R - 1 && B.L < A.R - 1 && ylo(A) < yhi(B) + 30 * s && ylo(B) < yhi(A) + 30 * s) parent[find(i)] = find(j);
    }
  }
  const clusters = new Map();
  act.forEach((b, i) => { const r = find(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(b); });
  const inSpan = (y, b) => y > ylo(b) + 0.5 && y < yhi(b) - 0.5;
  const crossCost = (ord) => {
    let c = 0;
    for (let i = 0; i < ord.length; i += 1) {
      for (let j = i + 1; j < ord.length; j += 1) {
        for (const y of ord[i].rightH) if (inSpan(y, ord[j])) c += 1;
        for (const y of ord[j].leftH) if (inSpan(y, ord[i])) c += 1;
      }
    }
    return c;
  };
  // Centre the legs in the gap `sp` apart, push right past each leg's lower bound, then left under its
  // upper bound; the widest spacing (LANE … SLOT_MIN) the bounds allow wins.
  function place(ord, Lc, Rc) {
    const n = ord.length;
    const tryAt = (sp) => {
      const c = (Lc + Rc) / 2; const x = ord.map((_, i) => c + (i - (n - 1) / 2) * sp);
      for (let i = 0; i < n; i += 1) x[i] = Math.max(x[i], ord[i].lo, i ? x[i - 1] + sp : -Infinity);
      for (let i = n - 1; i >= 0; i -= 1) x[i] = Math.min(x[i], ord[i].hi, i < n - 1 ? x[i + 1] - sp : Infinity);
      return { x, sp, ok: x.every((v, i) => v >= ord[i].lo - 0.5 && (i === 0 || v - x[i - 1] >= sp - 0.5)) };
    };
    for (let sp = lane; sp >= slotMin; sp -= s) { const r = tryAt(sp); if (r.ok) return r; }
    return { ...tryAt(slotMin), sp: slotMin - s };
  }
  // Order cost: crossings, plus one per px the gap forces two legs under 10px apart.
  const orderCost = (ord, Lc, Rc) => { const r = place(ord, Lc, Rc); return { c: crossCost(ord) + Math.max(0, (10 * s - r.sp) / s), r }; };
  function bestOrder(list, Lc, Rc) {
    const init = [...list].sort((p, q) => (p.edgeL != null ? 0 : 1) - (q.edgeL != null ? 0 : 1) || p.y1 - q.y1);
    if (init.length > 6) {   // greedy insertion past six legs (Heap's walk would be 7! orders and up)
      const out = [];
      for (const b of init) {
        let best = 0; let bc = Infinity;
        for (let i = 0; i <= out.length; i += 1) {
          const c = crossCost([...out.slice(0, i), b, ...out.slice(i)]);
          if (c < bc) { bc = c; best = i; }
        }
        out.splice(best, 0, b);
      }
      return { ord: out, r: place(out, Lc, Rc) };
    }
    let best = { ord: init, ...orderCost(init, Lc, Rc) };
    const a = [...init]; const n = a.length; const cnt = new Array(n).fill(0);
    let i = 0;
    while (i < n && best.c > 0) {   // Heap's algorithm: every order of ≤ 6 legs
      if (cnt[i] < i) {
        const j = i % 2 ? cnt[i] : 0;
        [a[j], a[i]] = [a[i], a[j]];
        const o = orderCost(a, Lc, Rc);
        if (o.c < best.c - 1e-9) best = { ord: [...a], ...o };
        cnt[i] += 1; i = 0;
      } else { cnt[i] = 0; i += 1; }
    }
    return best;
  }
  for (const list of clusters.values()) {
    let Lc = Math.max(...list.map((b) => b.L)); let Rc = Math.min(...list.map((b) => b.R));
    if (Rc - Lc < 16 * s) { Lc = Math.min(...list.map((b) => b.L)); Rc = Math.max(...list.map((b) => b.R)); }
    const { ord, r } = bestOrder(list, Lc, Rc);
    ord.forEach((b, i) => { b.slot = r.x[i]; });
  }
  for (const b of bends) if (b.flat) b.slot = (b.L + b.R) / 2;

  // 6. polylines, and each wire's horizontal run (its pill sits there) -------------------------------
  const P = (x, y) => ({ x, y });
  const raw = new Map(); const runs = new Map();
  for (const R of recs) {
    const { a, b } = R;
    let v;
    if (R.kind === 'straight') { v = [a, b]; runs.set(R.id, { x0: a.x, x1: b.x, y: a.y, from: 'lo' }); }
    else if (R.kind === 'direct') {
      const x = R.bend.slot;
      v = R.bend.flat ? [a, b] : [a, P(x, a.y), P(x, b.y), b];
      runs.set(R.id, R.at === 'entry' ? { x0: a.x, x1: x, y: a.y, from: 'lo' } : { x0: x, x1: b.x, y: b.y, from: 'lo' });
    } else if (R.fwd) {
      const y = R.unit.lane; const sx = R.exit.slot; const ex = R.entry.slot;
      v = R.exit.flat ? [a] : [a, P(sx, a.y), P(sx, y)];
      if (R.entry.flat) v.push(b); else v.push(P(ex, y), P(ex, b.y), b);
      runs.set(R.id, { x0: R.exit.flat ? a.x : sx, x1: R.entry.flat ? b.x : ex, y, from: 'lo' });
    } else {
      const y = R.unit.lane; const hx = R.exit.slot; const cx = R.entry.slot;
      v = [a, P(hx, a.y), P(hx, y), P(cx, y), P(cx, b.y), b];
      runs.set(R.id, { x0: cx, x1: hx, y, from: 'hi' });
    }
    raw.set(R.id, clean(v.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }))));
  }

  // 7. pills on their lane runs, nearest the source, clear of cards and of each other ----------------
  const pills = new Map(); const taken = [];
  for (const R of recs) {
    if (!R.w.pill) continue;
    const run = runs.get(R.id);
    const lo = Math.min(run.x0, run.x1) + 22 * s; const hi = Math.max(run.x0, run.x1) - 22 * s;
    const cands = [];
    for (let x = lo; x <= hi; x += 12 * s) cands.push(x);
    if (run.from === 'hi') cands.reverse();
    const clearOf = (x, strict) => !rects.some((r) => r.x < x + 21 * s && r.r > x - 21 * s && r.y < run.y + 12 * s && r.b > run.y - 12 * s)
      && !taken.some((p) => Math.abs(p.x - x) < 40 * s && Math.abs(p.y - run.y) < 20 * s)
      && (!strict || !placed.some((p) => Math.abs(p.y - run.y) > 0.5 && Math.abs(p.y - run.y) < 12 * s && p.x0 < x + 20 * s && p.x1 > x - 20 * s));
    let x = cands.find((c) => clearOf(c, true));
    if (x == null) x = cands.find((c) => clearOf(c, false));
    if (x == null) x = (run.x0 + run.x1) / 2;
    const p = { x: Math.round(x * 10) / 10, y: Math.round(run.y * 10) / 10 };
    taken.push(p); pills.set(R.id, p);
  }

  const out = new Map();
  for (const R of recs) {
    const pts = raw.get(R.id);
    out.set(R.id, { pts, d: routePathD(pts, ROUTE_RADIUS * s), mid: pills.get(R.id) || routeMid(pts) });
  }
  return out;
}

/** Crossings between the routed polylines (horizontal × vertical legs; near a shared port they don't count). */
export function countCrossings(routes, { scale = 1 } = {}) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  const legs = [];
  for (const [id, r] of routes) {
    const p = r.pts;
    for (let i = 1; i < p.length; i += 1) legs.push({ id, a: p[i - 1], b: p[i], h: Math.abs(p[i].y - p[i - 1].y) < 0.01, ends: [p[0], p[p.length - 1]] });
  }
  const hits = [];
  for (const H of legs) {
    if (!H.h) continue;
    const hx0 = Math.min(H.a.x, H.b.x); const hx1 = Math.max(H.a.x, H.b.x);
    for (const V of legs) {
      if (V.h || V.id === H.id) continue;
      const vy0 = Math.min(V.a.y, V.b.y); const vy1 = Math.max(V.a.y, V.b.y);
      const x = V.a.x; const y = H.a.y;
      if (!(x > hx0 + 0.5 && x < hx1 - 0.5 && y > vy0 + 0.5 && y < vy1 - 0.5)) continue;
      const shared = H.ends.filter((e) => V.ends.some((f) => near(e, f)));
      if (shared.some((e) => Math.hypot(e.x - x, e.y - y) < 16 * s)) continue;
      if (!hits.some((q) => Math.abs(q.x - x) < 3 && Math.abs(q.y - y) < 3)) hits.push({ x, y });
    }
  }
  return hits.length;
}

/**
 * Route a template the way a host draws it.
 * @param {object} tpl  {nodes, wires}
 * @param {object} o
 * @param {(node:object) => {w:number,h:number}} o.sizeOf  the host's card size
 * @param {(node:object, port:string, dir:'in'|'out') => {x,y}|null} o.anchorOf  the host's port anchor
 * @param {Set<string>} [o.loopWireIds]  loop wires (they prefer the floor and carry a pill)
 * @param {(wire:object) => boolean} [o.pill]  every other wire that carries a pill
 * @param {boolean} [o.reorder]  hand OR / AND inputs out in the order with the fewest crossings
 * @param {Map<string,string>|null} [o.portMap]  a FROZEN assignment to draw with (a drag in progress)
 * @returns {{routes: Map<string,{pts,d,mid}>, portMap: Map<string,string>}}  portMap: wireId -> the input
 *   it is DRAWN into, for the wires drawn somewhere other than their own `to.port`.
 */
export function routeGraph(tpl, { sizeOf, anchorOf, loopWireIds = new Set(), pill = null, reorder = true, portMap = null, scale = 1 } = {}) {
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : []).filter(isNode);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cards = nodes.map((n) => ({ id: n.id, x: Number(n.x) || 0, y: Number(n.y) || 0, ...sizeOf(n) }));
  const wires = (Array.isArray(tpl?.wires) ? tpl.wires : [])
    .filter((w) => w && w.from && w.to && byId.has(w.from.node) && byId.has(w.to.node));
  const outOf = new Map(wires.map((w) => [w.id, anchorOf(byId.get(w.from.node), w.from.port, 'out')]));
  const build = (map) => wires.map((w) => ({
    id: w.id, from: w.from.node, to: w.to.node, a: outOf.get(w.id),
    b: anchorOf(byId.get(w.to.node), (map && map.get(w.id)) || w.to.port, 'in'),
    loop: loopWireIds.has(w.id), pill: loopWireIds.has(w.id) || Boolean(pill && pill(w)),
  }));
  const route = (map) => routeLanes(cards, build(map), { scale });
  const map = portMap instanceof Map ? portMap : reorder ? mergePorts(nodes, wires, { outOf, anchorOf, route, scale }) : new Map();
  return { routes: route(map), portMap: map };
}

/** OR / AND fire the same whichever input a wire lands on: per merge card, try the orders that make
 *  geometric sense (as wired, by source x, by source y, each way) over the inputs that ARE wired, keep
 *  the fewest crossings (ties keep the earlier order, so a graph that is already tidy never changes). */
function mergePorts(nodes, wires, { outOf, anchorOf, route, scale }) {
  let map = new Map();
  for (const merge of nodes.filter((n) => MERGE_KINDS.has(n.kind))) {
    const into = wires.filter((w) => w.to.node === merge.id && w.to.port !== 'await' && outOf.get(w.id));
    if (into.length < 2) continue;
    const yOf = (port) => (anchorOf(merge, port, 'in') || { y: Infinity }).y;
    const ports = into.map((w) => w.to.port).sort((p, q) => yOf(p) - yOf(q) || (p < q ? -1 : 1));
    const sa = (w) => outOf.get(w.id);
    const orders = [
      [...into].sort((p, q) => yOf(p.to.port) - yOf(q.to.port)),
      [...into].sort((p, q) => sa(p).x - sa(q).x || sa(p).y - sa(q).y),
      [...into].sort((p, q) => sa(q).x - sa(p).x || sa(q).y - sa(p).y),
      [...into].sort((p, q) => sa(p).y - sa(q).y || sa(p).x - sa(q).x),
      [...into].sort((p, q) => sa(q).y - sa(p).y || sa(q).x - sa(p).x),
    ];
    const seen = new Set();
    let best = null;
    for (const ord of orders) {
      const sig = ord.map((w) => w.id).join('\n');
      if (seen.has(sig)) continue;
      seen.add(sig);
      const m = new Map(map);
      ord.forEach((w, i) => { if (ports[i] === w.to.port) m.delete(w.id); else m.set(w.id, ports[i]); });
      const c = countCrossings(route(m), { scale });
      if (!best || c < best.c) best = { c, m };
    }
    map = best.m;
  }
  return map;
}
