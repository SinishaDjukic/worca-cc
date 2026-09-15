// src/shared/graph/flow-layout.mjs
// The FLOW layout + its channel router: composer cards at a fixed scale in rows
// of `perRow`, in dispatch order, with orthogonal wires routed only through the
// card-free vertical channels (left pad, the column gaps, right pad) and the
// horizontal gutters between rows. Pure and DOM-free like layout.mjs; the view
// applies the positions and paints the routes. No agent key is read (D23).
// A port of the 2026-09-05 mockup's layoutFlow()/routeAll() (docs/superpowers/mockups).
import { NODE_W, nodeSize, portAnchor } from './geometry.mjs';
import { rankNodes } from './layout.mjs';
import { classifyLoops } from './loops.mjs';
import { portsOf } from './ports.mjs';

export const FLOW_SCALE = 0.65;
export const FLOW_PAD = 20;            // host padding on X, NOT scaled
export const FLOW_PAD_Y = 28;          // host padding above the first row and under whatever is painted last
export const FLOW_GAP = 40;            // column gap at 1× (× scale)
export const FLOW_ROW_GAP = 44;        // row gap at 1× (× scale)
export const FLOW_MIN_H = 120;
export const FLOW_DEFAULT_WIDTH = 702; // the chat sheet's inner width; used when a host has no layout width yet
export const FLOW_LANE = 6;            // lane pitch inside gaps and gutters
export const FLOW_PAD_LANE = 5;        // lane pitch inside the pads
export const FLOW_GUT_ROOM = 12;       // lane room in the BOTTOM gutter (3 lanes at the nominal pitch, tighter after)
export const FLOW_BADGE_H = 18;        // the wire badge's painted box (10px/14px line + scaled padding + borders)
export const FLOW_RADIUS = 6;          // wire corner radius

const isNode = (n) => Boolean(n) && typeof n === 'object' && !Array.isArray(n) && typeof n.id === 'string';
const portsAt = (portsFn, node) => portsOf(portsFn, node);   // never null: {known, ported, inputs, outputs, meta}

/**
 * Dispatch order: Task cards → agents and the gates ranked among them → gates fed
 * ONLY by loop wires (the valves) → End. Inside the middle class the key is the
 * graph rank FIRST (so a combine/and gate stays inside its parallel group), then the
 * host-given index (a proposal's `order[]`, rank-consistent by construction), then id.
 */
export function flowOrder(tpl, portsFn, { agentOrder = null } = {}) {
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : []).filter(isNode);
  const loops = classifyLoops(tpl, portsFn);
  const rank = rankNodes(tpl, loops);                       // plain object {[id]: number}
  const nonLoopIn = new Map();
  for (const w of Array.isArray(tpl?.wires) ? tpl.wires : []) {
    if (!w?.to?.node || loops.loopWireIds.has(w.id)) continue;
    nonLoopIn.set(w.to.node, (nonLoopIn.get(w.to.node) || 0) + 1);
  }
  const given = new Map((Array.isArray(agentOrder) ? agentOrder : []).map((id, i) => [id, i]));
  const cls = (n) => (n.kind === 'task' ? 0 : n.kind === 'end' ? 3 : (n.kind !== 'agent' && !nonLoopIn.get(n.id) ? 2 : 1));
  const key = (n) => [cls(n), rank[n.id] ?? 0, given.has(n.id) ? given.get(n.id) : Number.MAX_SAFE_INTEGER, n.id];
  return nodes.map((n) => ({ n, k: key(n) })).sort((a, b) => {
    for (let i = 0; i < 4; i += 1) if (a.k[i] !== b.k[i]) return a.k[i] < b.k[i] ? -1 : 1;
    return 0;
  }).map((x) => x.n.id);
}

/** perRow for a host width: max(1, ⌊(W − 2·pad + gap) / (cardW + gap)⌋). */
export function flowPerRow(width, { scale = FLOW_SCALE, pad = FLOW_PAD, gap = FLOW_GAP } = {}) {
  const cw = NODE_W * scale;
  const g = gap * scale;
  return Math.max(1, Math.floor(((Number(width) || 0) - 2 * pad + g) / (cw + g)));
}

/** How many lanes can the LAST row's gutter hold at most? Only a same-row backwards (non-`direct`) wire
 *  routes there — routeFlow's `g` is `S.r` for a same-row pair, and no wire reaches a gutter below the row
 *  it starts in — and the router gives one interval per output trunk, so the distinct trunk count is an
 *  upper bound on its lane count (allocLanes only ever reuses lanes). */
function bottomGutterTrunks(tpl, pos, lastR) {
  if (lastR < 0) return 0;
  const keys = new Set();
  for (const w of Array.isArray(tpl?.wires) ? tpl.wires : []) {
    const S = pos[w?.from?.node]; const T = pos[w?.to?.node];
    if (!S || !T || S.r !== lastR || T.r !== lastR || T.c === S.c + 1) continue;
    keys.add(`${w.from.node}.${w.from.port || ''}`);
  }
  return keys.size;
}

/**
 * @returns {{positions:{[id]:{x,y}}, pos:{[id]:{r,c,h,x,y}}, order:string[], rows:{top,h,ids}[],
 *            perRow:number, height:number, cardW:number, gap:number, rowGap:number, pad:number,
 *            scale:number, width:number, band:boolean}}
 */
export function flowLayout(tpl, portsFn, {
  width = FLOW_DEFAULT_WIDTH, scale = FLOW_SCALE, band = true, order = null, agentOrder = null,
  pad = FLOW_PAD, padY = FLOW_PAD_Y, gap = FLOW_GAP, rowGap = FLOW_ROW_GAP, minHeight = FLOW_MIN_H,
} = {}) {
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : []).filter(isNode);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = (Array.isArray(order) ? order.filter((id) => byId.has(id)) : flowOrder(tpl, portsFn, { agentOrder }));
  for (const n of nodes) if (!ids.includes(n.id)) ids.push(n.id);      // a host order may be partial
  const cw = NODE_W * scale;
  const g = gap * scale;
  const rg = rowGap * scale;
  const per = flowPerRow(width, { scale, pad, gap });
  const rows = [];
  const pos = {};
  ids.forEach((id, i) => {
    const node = byId.get(id);
    const r = Math.floor(i / per);
    const c = i % per;
    if (!rows[r]) rows[r] = { top: 0, h: 0, ids: [] };
    const { h } = nodeSize(node, portsAt(portsFn, node), { band, scale });
    rows[r].h = Math.max(rows[r].h, h);                              // row height = its tallest card; cards top-align
    rows[r].ids.push(id);
    pos[id] = { r, c, h, x: 0, y: 0 };
  });
  let y = padY;
  for (const row of rows) { row.top = y; y = y + row.h + rg; }        // left-to-right, the order the tests reproduce
  // A backwards wire inside the LAST row is routed through the bottom gutter and carries its `N×` badge
  // there (routeFlow's `g === rows.length - 1` case), so the height must bill that band too — billing the
  // cards alone left half a badge sitting on the host's border (it read as clipped).
  const trunks = bottomGutterTrunks(tpl, pos, rows.length - 1);
  const bottomBand = trunks ? END_OFF + Math.min(FLOW_GUT_ROOM, (trunks - 1) * FLOW_LANE) + FLOW_BADGE_H / 2 : 0;
  // Height from the LAST row's own numbers (never `y - rg + padY`: 0.65-scaled sums do not round-trip through
  // a subtraction — 464.775 vs 464.77500000000003 — and the placement test compares with `===`).
  const last = rows[rows.length - 1];
  const height = Math.max(minHeight, last ? last.top + last.h + bottomBand + padY : 2 * padY);
  const positions = {};
  for (const id of ids) {
    const p = pos[id];
    p.x = pad + p.c * (cw + g);
    p.y = rows[p.r].top;
    positions[id] = { x: p.x, y: p.y };
  }
  return { positions, pos, order: ids, rows, perRow: per, height, cardW: cw, gap: g, rowGap: rg, pad, padY, bottomBand, scale, width: Number(width) || 0, band };
}

/** The anchor list the router consumes, from a laid-out template: one entry per wire
 *  whose both ends resolve. `a`/`b` come from portAnchor with the SAME band/scale; it is
 *  the mockup's `S.x + cw` / `S.y + portY(node, dir, port)·s` with the band term. The synthetic
 *  await row is addressed as port id `await` (the mockup called it `gate`). */
export function flowAnchors(tpl, portsFn, lay) {
  const byId = new Map((tpl?.nodes || []).filter(isNode).map((n) => [n.id, { ...n, ...lay.positions[n.id] }]));
  const out = [];
  for (const w of Array.isArray(tpl?.wires) ? tpl.wires : []) {
    const S = byId.get(w?.from?.node); const T = byId.get(w?.to?.node);
    if (!S || !T) continue;
    const a = portAnchor(S, portsAt(portsFn, S), w.from.port, 'out', { band: lay.band, scale: lay.scale });
    const b = portAnchor(T, portsAt(portsFn, T), w.to.port, 'in', { band: lay.band, scale: lay.scale });
    if (a && b) out.push({ id: w.id, a, b, from: w.from.node, to: w.to.node, fromPort: w.from.port });
  }
  return out;
}

const CLEAR = 4;         // min clearance between two intervals sharing a lane (mockup alloc(items, 4))
const RUN_PAD = 8;       // a gutter run extends 8px past both channel centres
const PAD_OFF = 8;       // first pad lane sits 8px outside the card edge
const END_OFF = 8;       // the bottom gutter (below the last row) starts 8px under it
const EDGE = 2;          // a lane never comes closer than this to a card edge or the host edge (A30)

/** The lane pitch that keeps `n` lanes inside `room` px: the nominal pitch while it fits, tighter after (A30). */
const pitchFor = (n, room, nominal) => (n <= 1 ? nominal : Math.min(nominal, Math.max(0, room) / (n - 1)));

/** Greedy interval colouring, sorted by start — ties keep insertion order exactly like the mockup's alloc()
 *  (a stable sort, NO length tiebreak: a trunk and a sibling often start at the same port y). Sets `it.lane`, returns the lane count. */
function allocLanes(items, clear = CLEAR) {
  const ends = [];
  for (const it of [...items].sort((p, q) => p.a - q.a)) {
    let k = ends.findIndex((e) => e + clear < it.a);
    if (k < 0) { k = ends.length; ends.push(it.b); } else ends[k] = it.b;
    it.lane = k;
  }
  return ends.length;
}
/** Wires leaving the same output share ONE interval (a trunk that splits). The merge normalises `a`/`b` first —
 *  a DELIBERATE fix over the mockup's putIn, which merged the raw pair and under-extended a trunk whose new leg
 *  runs upward (ys > yg on a loop wire); do not "restore" the mockup's version. */
function putIn(map, ch, a, b, key) {
  if (!map.has(ch)) map.set(ch, []);
  const list = map.get(ch);
  const lo = Math.min(a, b); const hi = Math.max(a, b);
  let it = key ? list.find((x) => x.key === key) : null;
  if (it) { it.a = Math.min(it.a, lo); it.b = Math.max(it.b, hi); return it; }
  it = { a: lo, b: hi, key: key || null, lane: 0, x: 0 };
  list.push(it);
  return it;
}
/** Drop duplicate points and merge collinear runs so routePathD/routeMid see clean legs. */
export function simplifyOrtho(pts) {
  const p = [];
  for (const q of pts) { const l = p[p.length - 1]; if (!l || Math.abs(l.x - q.x) > 0.01 || Math.abs(l.y - q.y) > 0.01) p.push({ x: q.x, y: q.y }); }
  for (let i = 1; i < p.length - 1;) {
    const a = p[i - 1]; const b = p[i]; const c = p[i + 1];
    const sameX = Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01;
    const sameY = Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01;
    if (sameX || sameY) p.splice(i, 1); else i += 1;
  }
  return p;
}

/**
 * Route every wire through channels and gutters. `wires` = flowAnchors() output; `lay` = flowLayout() output.
 * Channel `ch` (0 … perRow) is the card-free strip LEFT of column `ch` (0 = left pad, perRow = right pad);
 * gutter `g` is the strip BELOW row `g` (the last one is the bottom pad). A wire leaves its out-dot into the
 * channel right of its card, runs vertically to a gutter lane (below its row for forward/same-row wires,
 * above it for loops going up), horizontally to the channel left of its target, vertically to the port and
 * into the in-dot. Adjacent same-row cards skip the gutter (one jog).
 * @returns {{raw:Map<string,{x,y}[]>, routes:Map<string,{x,y}[]>, badges:Map<string,{x,y}>}}
 *   `raw` and `routes` are the SAME map — the view reads `routesBag.raw` (as `prev`) and `routesBag.routes`.
 */
export function routeFlow(wires, lay) {
  const { pos, rows, perRow: per, cardW: cw, gap, pad, rowGap } = lay;
  const rightEdge = pad + per * cw + (per - 1) * gap;
  const W = Math.max(Number(lay.width) || 0, rightEdge + pad);          // the host's width (never narrower than the rows)
  const chanC = (ch) => (ch === 0 ? pad - 10 : ch === per ? rightEdge + 10 : pad + ch * (cw + gap) - gap / 2);
  // Lanes keep their nominal pitch while they fit and tighten when they do not (A30): `room` is the strip's
  // free width minus an EDGE margin, so a lane never lands inside a card or outside the host. At the mockup's
  // width every pitch below equals the nominal one (3 left-pad lanes at 12/7/2, 2 right-pad lanes, ≤ 4 gutter lanes).
  const chanX = (ch, lane, n) => {
    if (ch === 0) return pad - PAD_OFF - pitchFor(n, pad - PAD_OFF - EDGE, FLOW_PAD_LANE) * lane;
    if (ch === per) return rightEdge + PAD_OFF + pitchFor(n, W - rightEdge - PAD_OFF - EDGE, FLOW_PAD_LANE) * lane;
    return chanC(ch) + (lane - (n - 1) / 2) * pitchFor(n, gap - 2 * EDGE, FLOW_LANE);
  };
  const gutY = (g, lane, n) => {
    const row = rows[g]; const bottom = row.top + row.h;
    if (g === rows.length - 1) return bottom + END_OFF + pitchFor(n, FLOW_GUT_ROOM, FLOW_LANE) * lane;
    return bottom + rowGap / 2 + (lane - (n - 1) / 2) * pitchFor(n, rowGap - 2 * EDGE, FLOW_LANE);
  };
  const R = [];
  for (const w of wires) {
    const S = pos[w.from]; const T = pos[w.to];
    if (!S || !T || !w.a || !w.b) continue;
    const direct = S.r === T.r && T.c === S.c + 1;
    const g = direct ? -1 : (T.r > S.r ? S.r : (T.r < S.r ? S.r - 1 : S.r));
    R.push({ w, xs: w.a.x, ys: w.a.y, xt: w.b.x, yt: w.b.y, direct, chA: S.c + 1, chB: T.c, g, key: `${w.from}.${w.fromPort || ''}` });
  }
  // gutters first (their y feeds the channel intervals)
  const gut = new Map();
  for (const r of R) { if (r.direct) continue; const a = chanC(r.chA); const b = chanC(r.chB); r.gi = putIn(gut, r.g, Math.min(a, b) - RUN_PAD, Math.max(a, b) + RUN_PAD, r.key); }
  const gn = new Map();
  for (const [g, items] of gut) gn.set(g, allocLanes(items));
  for (const r of R) if (!r.direct) r.yg = gutY(r.g, r.gi.lane, gn.get(r.g));
  // channels: the source channel is keyed (trunk), the target channel never is
  const chan = new Map();
  for (const r of R) {
    if (r.direct) r.ia = putIn(chan, r.chA, r.ys, r.yt, r.key);
    else { r.ia = putIn(chan, r.chA, r.ys, r.yg, r.key); r.ib = putIn(chan, r.chB, r.yg, r.yt, null); }
  }
  for (const [ch, items] of chan) { const n = allocLanes(items); for (const it of items) it.x = chanX(ch, it.lane, n); }
  const routes = new Map(); const badges = new Map();
  for (const r of R) {
    const pts = simplifyOrtho(r.direct
      ? [{ x: r.xs, y: r.ys }, { x: r.ia.x, y: r.ys }, { x: r.ia.x, y: r.yt }, { x: r.xt, y: r.yt }]
      : [{ x: r.xs, y: r.ys }, { x: r.ia.x, y: r.ys }, { x: r.ia.x, y: r.yg }, { x: r.ib.x, y: r.yg }, { x: r.ib.x, y: r.yt }, { x: r.xt, y: r.yt }]);
    routes.set(r.w.id, pts);
    // Badge = the gutter run's midpoint (mockup §F). A direct wire has no gutter: the badge sits on its vertical jog
    // (`ia.x`, ON the wire) where the mockup used (xs+xt)/2, which floats off the path — unreachable for loop wires anyway
    // (a loop wire runs backwards in dispatch order and is never `direct`).
    badges.set(r.w.id, r.direct ? { x: r.ia.x, y: (r.ys + r.yt) / 2 } : { x: (r.ia.x + r.ib.x) / 2, y: r.yg });
  }
  return { raw: routes, routes, badges };
}
