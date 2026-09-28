// src/shared/workspace-map/layout.mjs
// Layered layout for the workspace Map tab (spec D17): one column group per change-order layer
// (providers left, consumers right), rows sorted by key, a cycle's members share a layer. A layer
// with more than MAX_ROWS members wraps into adjacent sub-columns (a full column gap apart when the
// layer holds a cycle, whose loops bulge right). Pure and deterministic: the same members + pairs
// in any input order give the same coordinates.
import { changeOrder } from './order.mjs';
import { KINDS, confidenceRank } from './schema.mjs';

export const MAP_LAYOUT = Object.freeze({
  NODE_W: 176, NODE_H: 44, COL_GAP: 104, SUB_GAP: 28, ROW_GAP: 18, PAD: 24, MAX_ROWS: 10, LOOP_PAD: 64,
  LANE_GAP: 8, MAX_LANES: 12, CORNER: 6,
});

const str = (v) => (typeof v === 'string' ? v : '');
const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const kindIndex = (k) => { const i = KINDS.indexOf(k); return i === -1 ? KINDS.length : i; };
const r1 = (v) => Math.round(v * 10) / 10;

/** An axis-aligned polyline with rounded corners (radius ≤ r, never more than half a segment). */
function roundedPath(pts, r) {
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    const k = Math.min(r, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    d += ` L${r1(x + Math.sign(px - x) * k)} ${r1(y + Math.sign(py - y) * k)}`;
    d += ` Q${r1(x)} ${r1(y)} ${r1(x + Math.sign(nx - x) * k)} ${r1(y + Math.sign(ny - y) * k)}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return `${d} L${r1(lx)} ${r1(ly)}`;
}

/** Effective edges (GET /map `edges`) → one pair per ordered (from, to). Rejected, missing and
 *  stale edges are excluded; self edges and edges without both ends are dropped. kinds: most edges
 *  first, ties in KINDS order (unknown kinds count as 'other'); confidence: the strongest one
 *  among its non-manual edges (null when none names one: a manual edge has no confidence, whatever
 *  P1 stamped on it); state: 'confirmed' when any edge is confirmed, 'manual' when every edge is
 *  manual, else 'auto'. Sorted by from, then to. */
export function pairsOf(edges) {
  const acc = new Map();
  for (const e of Array.isArray(edges) ? edges : []) {
    if (!e || typeof e !== 'object') continue;
    const from = str(e.from);
    const to = str(e.to);
    if (!from || !to || from === to) continue;
    const state = str(e.state) || 'auto';
    if (state === 'rejected' || state === 'missing' || state === 'stale') continue;
    const id = `${from}\u0000${to}`;
    let p = acc.get(id);
    if (!p) { p = { from, to, byKind: new Map(), confidence: null, count: 0, states: new Set() }; acc.set(id, p); }
    const kind = KINDS.includes(e.kind) ? e.kind : 'other';
    p.byKind.set(kind, (p.byKind.get(kind) || 0) + 1);
    p.count += 1;
    p.states.add(state);
    const c = state === 'manual' ? '' : str(e.confidence);   // a manual edge has no confidence (P1 v1 stamped 'verified')
    if (c && confidenceRank(c) < 99 && (p.confidence === null || confidenceRank(c) < confidenceRank(p.confidence))) p.confidence = c;
  }
  return [...acc.values()]
    .map((p) => ({
      from: p.from,
      to: p.to,
      kinds: [...p.byKind.entries()].sort((a, b) => b[1] - a[1] || kindIndex(a[0]) - kindIndex(b[0])).map(([k]) => k),
      confidence: p.confidence,
      count: p.count,
      state: p.states.has('confirmed') ? 'confirmed' : (p.states.size === 1 && p.states.has('manual') ? 'manual' : 'auto'),
    }))
    .sort((a, b) => byStr(a.from, b.from) || byStr(a.to, b.to));
}

/** `order` when it names every key exactly once (layers sorted inside); else null. */
function givenLayers(order, keys) {
  if (!Array.isArray(order) || !order.length) return null;
  const want = new Set(keys);
  const got = new Set();
  const out = [];
  for (const layer of order) {
    if (!Array.isArray(layer)) return null;
    const row = [];
    for (const k of layer) {
      if (typeof k !== 'string' || !want.has(k) || got.has(k)) return null;
      got.add(k);
      row.push(k);
    }
    if (row.length) out.push(row.sort(byStr));
  }
  return got.size === want.size ? out : null;
}

/** The layers to draw: the map's `order` when every drawn pair runs from a later layer to an
 *  earlier one (or stays inside one cycle), else changeOrder over the drawn pairs — so a manual
 *  edge or a rejection never draws a provider right of its consumer. Keys a buggy order misses
 *  land in one extra last layer. */
function pickLayers(keys, pairs, order) {
  const fresh = changeOrder(keys, pairs.map((p) => ({ from: p.from, to: p.to })));
  const given = givenLayers(order, keys);
  let layers = fresh && Array.isArray(fresh.order) ? fresh.order.map((l) => [...l].sort(byStr)) : [];
  if (given) {
    const layerOf = new Map();
    given.forEach((layer, i) => layer.forEach((k) => layerOf.set(k, i)));
    const cycleOf = new Map();
    ((fresh && fresh.cycles) || []).forEach((c, i) => c.forEach((k) => cycleOf.set(k, i)));
    const fits = pairs.every((p) => {
      const provider = layerOf.get(p.to);
      const consumer = layerOf.get(p.from);
      if (provider < consumer) return true;
      return provider === consumer && cycleOf.has(p.from) && cycleOf.get(p.from) === cycleOf.get(p.to);
    });
    if (fits) layers = given;
  }
  const placed = new Set(layers.flat());
  const rest = keys.filter((k) => !placed.has(k));
  return rest.length ? [...layers.filter((l) => l.length), rest] : layers.filter((l) => l.length);
}

/** Layered layout (index contract, P6). members: map.members ([{key, name, coverage}]); pairs:
 *  pairsOf(edges); order: map.order (optional). → { width, height,
 *  nodes: [{key, name, x, y, w, h, level, layer}], edges: [{from, to, d, kinds, confidence, state, count}] }
 *  level = the member's coverage level ('rich'|'partial'|'none', 'none' when absent);
 *  layer = the change-order layer index (0 = providers). Edge paths run consumer → provider. */
export function layoutMap({ members, pairs, order = null } = {}) {
  const L = MAP_LAYOUT;
  const seen = new Set();
  const list = [];
  for (const m of Array.isArray(members) ? members : []) {
    const key = m && typeof m === 'object' ? str(m.key) : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const lvl = m.coverage && typeof m.coverage === 'object' ? str(m.coverage.level) : '';
    list.push({ key, name: str(m.name) || key, level: ['rich', 'partial', 'none'].includes(lvl) ? lvl : 'none' });
  }
  list.sort((a, b) => byStr(a.key, b.key));
  const keys = list.map((n) => n.key);
  const drawn = (Array.isArray(pairs) ? pairs : [])
    .filter((p) => p && seen.has(p.from) && seen.has(p.to) && p.from !== p.to)
    .sort((a, b) => byStr(a.from, b.from) || byStr(a.to, b.to));
  const layers = pickLayers(keys, drawn, order);

  // Columns: each layer splits into sub-columns of at most MAX_ROWS rows.
  const cols = [];
  layers.forEach((layer, li) => {
    for (let i = 0; i < layer.length; i += L.MAX_ROWS) cols.push({ layer: li, keys: layer.slice(i, i + L.MAX_ROWS) });
  });
  const rows = Math.max(1, ...cols.map((c) => c.keys.length));
  const innerH = rows * L.NODE_H + (rows - 1) * L.ROW_GAP;
  const colOf = new Map();
  cols.forEach((c, ci) => c.keys.forEach((k) => colOf.set(k, ci)));
  // A pair that skips a column (leftwards between layers, or either way inside a wrapped cycle)
  // never crosses a node: it runs up the gap beside its consumer, along a lane in a band above
  // every node, and down the gap beside its provider.
  const longCount = drawn.filter((p) => Math.abs(colOf.get(p.from) - colOf.get(p.to)) > 1).length;
  const band = longCount ? L.LANE_GAP * (Math.min(longCount, L.MAX_LANES) + 1) : 0;
  const byKey = new Map(list.map((n) => [n.key, n]));
  const nodeOf = new Map();
  // A layer holding a cycle keeps full column gaps between its sub-columns: its loops bulge right.
  const layerOfKey = new Map(cols.flatMap((c) => c.keys.map((k) => [k, c.layer])));
  const cyclic = new Set(drawn.filter((p) => layerOfKey.get(p.from) === layerOfKey.get(p.to)).map((p) => layerOfKey.get(p.from)));
  let x = L.PAD;
  cols.forEach((c, ci) => {
    if (ci > 0) x += cols[ci - 1].layer === c.layer && !cyclic.has(c.layer) ? L.SUB_GAP : L.COL_GAP;
    const colH = c.keys.length * L.NODE_H + (c.keys.length - 1) * L.ROW_GAP;
    const y0 = L.PAD + band + (innerH - colH) / 2;
    c.keys.forEach((k, i) => {
      const src = byKey.get(k);
      nodeOf.set(k, { key: k, name: src.name, x, y: y0 + i * (L.NODE_H + L.ROW_GAP), w: L.NODE_W, h: L.NODE_H, level: src.level, layer: c.layer, col: ci });
    });
    c.x = x;
    x += L.NODE_W;
  });

  // Geometry per pair: 'left' (provider in an earlier column: consumer's left side → provider's
  // right side), 'same' (one column: both right sides, bulging right), 'right' (a cycle wrapped
  // into sub-columns: consumer's right side → provider's left side).
  let lane = 0;
  const geo = drawn.map((p) => {
    const a = nodeOf.get(p.from);
    const b = nodeOf.get(p.to);
    const dir = b.col < a.col ? 'left' : b.col === a.col ? 'same' : 'right';
    const g = { p, a, b, dir, startSide: dir === 'left' ? 'L' : 'R', endSide: dir === 'right' ? 'L' : 'R', lane: -1 };
    if (Math.abs(a.col - b.col) > 1) { g.lane = lane % L.MAX_LANES; lane += 1; }
    return g;
  });
  // The free gap left of column ci (to the previous column, or the padding) and right of it.
  const gapLeft = (ci) => (ci > 0 ? cols[ci].x - (cols[ci - 1].x + L.NODE_W) : L.PAD);
  const gapRight = (ci) => cols[ci + 1].x - (cols[ci].x + L.NODE_W);
  const inGap = (mid, width, k) => mid + (((k % 5) - 2) * Math.min(6, Math.max(0, width / 2 - 4) / 2));
  // Ports: every node side spreads its attachments over its height, ordered by the other end's y.
  const slots = new Map();
  const slot = (key, side) => { const id = `${key}|${side}`; if (!slots.has(id)) slots.set(id, []); return slots.get(id); };
  geo.forEach((g, i) => {
    slot(g.a.key, g.startSide).push({ i, end: 'start', other: g.b });
    slot(g.b.key, g.endSide).push({ i, end: 'end', other: g.a });
  });
  const portY = new Map();
  for (const [id, arr] of slots) {
    arr.sort((u, v) => u.other.y - v.other.y || byStr(u.other.key, v.other.key) || u.i - v.i || byStr(u.end, v.end));
    const node = nodeOf.get(id.slice(0, id.lastIndexOf('|')));
    arr.forEach((s, k) => portY.set(`${s.i}|${s.end}`, node.y + (node.h * (k + 1)) / (arr.length + 1)));
  }
  const edges = geo.map((g, i) => {
    const sx = g.startSide === 'L' ? g.a.x : g.a.x + g.a.w;
    const ex = g.endSide === 'L' ? g.b.x : g.b.x + g.b.w;
    const sy = portY.get(`${i}|start`);
    const ey = portY.get(`${i}|end`);
    let d;
    if (g.lane >= 0) {
      // 'left': up the gap left of the consumer, down the gap right of the provider; 'right' (a
      // wrapped cycle): up the gap right of the consumer, down the gap left of the provider.
      const up = g.dir === 'left' ? inGap(g.a.x - gapLeft(g.a.col) / 2, gapLeft(g.a.col), g.lane)
        : inGap(g.a.x + g.a.w + gapRight(g.a.col) / 2, gapRight(g.a.col), g.lane);
      const down = g.dir === 'left' ? inGap(g.b.x + g.b.w + gapRight(g.b.col) / 2, gapRight(g.b.col), g.lane + 2)
        : inGap(g.b.x - gapLeft(g.b.col) / 2, gapLeft(g.b.col), g.lane + 2);
      const y = L.PAD + L.LANE_GAP * (g.lane + 0.5);
      d = roundedPath([[sx, sy], [up, sy], [up, y], [down, y], [down, ey], [ex, ey]], L.CORNER);
    } else if (g.dir === 'same') {
      const bulge = 40 + Math.min(60, Math.abs(ey - sy) / 4);
      d = `M${r1(sx)} ${r1(sy)} C${r1(sx + bulge)} ${r1(sy)} ${r1(ex + bulge)} ${r1(ey)} ${r1(ex)} ${r1(ey)}`;
    } else {
      const dx = Math.max(24, Math.abs(sx - ex) / 2);
      const s = g.dir === 'left' ? -1 : 1;
      d = `M${r1(sx)} ${r1(sy)} C${r1(sx + s * dx)} ${r1(sy)} ${r1(ex - s * dx)} ${r1(ey)} ${r1(ex)} ${r1(ey)}`;
    }
    return {
      from: g.p.from, to: g.p.to, d,
      kinds: Array.isArray(g.p.kinds) && g.p.kinds.length ? [...g.p.kinds] : ['other'],
      confidence: g.p.confidence ?? null, state: str(g.p.state) || 'auto', count: Number(g.p.count) || 0,
    };
  });
  const loops = geo.some((g) => g.dir === 'same');
  const nodes = keys.map((k) => { const { col, ...n } = nodeOf.get(k); return n; });
  return { width: x + L.PAD + (loops ? L.LOOP_PAD : 0), height: 2 * L.PAD + band + innerH, nodes, edges };
}
