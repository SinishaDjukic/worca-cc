// ui/public/shape/run-order-map.mjs — Shaper small runs slice 9 (R-ux-4): the still run order map of a marked feature.
// `runOrderLayout` is pure: it places each run of featureView's `slices` in a column right of every run it builds on
// (rows in run-number order), keeps only the links that still hold a run back (implied links left out through
// `namedWaits`), and routes each through the gaps between columns and the lanes between rows, so no link meets a dot
// or a number. `renderRunOrderMap` paints it: the shared status dot per run, an SVG of straight links, no motion but the
// live dot's existing pulse. The rows beside it stay the accessible source, so the map is aria-hidden.
import { namedWaits, runStatus } from '../../../src/shared/shape/run-status.mjs';
import { RUN_STATES } from '../../../src/shared/run-model.mjs';
import { markDot, renderStatusDot } from '../status-dot.mjs';

export const RUN_ORDER_GEOMETRY = Object.freeze({
  COL_W: 64, ROW_H: 36, PAD: 24, DOT: 12, LABEL_PX: 11, DIGIT_W: 7, GAP_X: 22, LANE_Y: 7, TRACK: 4, GAP_TRACKS: 9, LANE_TRACKS: 5,
});

const { COL_W, ROW_H, PAD, DOT, DIGIT_W, GAP_X, LANE_Y, TRACK, GAP_TRACKS, LANE_TRACKS } = RUN_ORDER_GEOMETRY;
const HALF = DOT / 2;
const NOT_STARTED = new Set(['planned', 'held']);
const BASE = { state: 'waiting', ...RUN_STATES.waiting };
const SVG_NS = 'http://www.w3.org/2000/svg';
const EMPTY = () => ({ width: 0, height: 0, runs: [], links: [], implied: [] });
const BAND = (LANE_TRACKS - 1) * TRACK;

const isObj = (x) => !!x && typeof x === 'object';
const byPair = (a, b) => a.from - b.from || a.to - b.to;

/**
 * Tracks by stretch. Each key (one run's exits, one run's entries, one run's stretch of a lane) has a stretch [lo, hi];
 * keys whose stretches come within a track pitch of each other take different tracks. Sorted by start, the first free
 * track is an optimal colouring, so a channel needs only as many tracks as stretches overlap at one point.
 * @returns {{track: Map<string|number, number>, count: number}}
 */
function colour(stretches) {
  const ends = [];
  const track = new Map();
  const list = [...stretches].sort((p, q) => p[1][0] - q[1][0] || String(p[0]).localeCompare(String(q[0])));
  for (const [key, [lo, hi]] of list) {
    let k = ends.findIndex((end) => lo - end >= TRACK);
    if (k < 0) k = ends.push(hi) - 1;
    else ends[k] = hi;
    track.set(key, k);
  }
  return { track, count: ends.length };
}
/** Each key's stretch: the span of every [lo, hi] it was given, grouped by channel. */
function spans() {
  const m = new Map();
  return {
    add(channel, key, lo, hi) {
      if (!m.has(channel)) m.set(channel, new Map());
      const c = m.get(channel);
      const s = c.get(key);
      c.set(key, s ? [Math.min(s[0], lo), Math.max(s[1], hi)] : [lo, hi]);
    },
    channels: () => [...m.entries()],
  };
}

/**
 * Pure. slices: featureView slice rows (`index`, `state`, `kind`, `buildsOn`, `waitsFor`, …).
 * @returns {{width: number, height: number, runs: object[], links: {from: number, to: number, points: number[][]}[],
 *   implied: {from: number, to: number}[]}}
 */
export function runOrderLayout(slices) {
  if (!Array.isArray(slices)) return EMPTY();
  const map = new Map();
  for (const s of slices) if (isObj(s) && Number.isInteger(s.index) && !map.has(s.index)) map.set(s.index, s);
  if (!map.size) return EMPTY();
  const indexes = [...map.keys()].sort((a, b) => a - b);
  const known = (s) => (Array.isArray(s.buildsOn) ? [...new Set(s.buildsOn)] : []).filter((d) => map.has(d));

  // Columns: longest path over the full buildsOn graph; an edge back onto the DFS stack closes a cycle and is dropped.
  const col = new Map();
  const onStack = new Set();
  const back = new Set();
  const depth = (i) => {
    if (col.has(i)) return col.get(i);
    onStack.add(i);
    let c = 0;
    for (const d of known(map.get(i))) {
      if (onStack.has(d)) { back.add(`${d}>${i}`); continue; }
      c = Math.max(c, depth(d) + 1);
    }
    onStack.delete(i);
    col.set(i, c);
    return c;
  };
  for (const i of indexes) depth(i);

  // Rows: number order inside each column.
  const columns = new Map();
  for (const i of indexes) {
    const c = col.get(i);
    if (!columns.has(c)) columns.set(c, []);
    columns.get(c).push(i);
  }
  const place = new Map();
  for (const [c, list] of columns) list.forEach((i, row) => place.set(i, { index: i, col: c, row, x: PAD + c * COL_W, y: PAD + row * ROW_H }));
  const maxCol = Math.max(...columns.keys());
  const maxRows = Math.max(...[...columns.values()].map((l) => l.length));

  const runs = indexes.map((index) => {
    const slice = map.get(index);
    const { col: c, row, x, y } = place.get(index);
    const st = runStatus({ slice, slices: map, snap: null });
    return {
      index, col: c, row, x, y, mark: st.mark, word: st.word, kind: slice.kind ?? null,
      dot: { x0: x - HALF, y0: y - HALF, x1: x + HALF, y1: y + HALF },
      label: { x0: x + 7, y0: y - 12, x1: x + 7 + DIGIT_W * String(index).length, y1: y - 1 },
    };
  });

  // Links: the transitive reduction of each run's buildsOn (namedWaits), kept only while it still holds the run back.
  const held = [];
  const implied = [];
  for (const to of indexes) {
    const target = map.get(to);
    const builds = known(target).filter((from) => !back.has(`${from}>${to}`));
    const reduced = new Set(namedWaits({ waitsFor: builds }, map));
    for (const from of builds) {
      if (!reduced.has(from)) implied.push({ from, to });
      else if (map.get(from).state !== 'done' && (NOT_STARTED.has(target.state) || target.stop?.held)) held.push({ from, to });
    }
  }
  held.sort(byPair);
  implied.sort(byPair);

  // Routes (D5): a link to the next column on the same row is one straight segment. Every other link leaves on its
  // source's exit track (the left band of the gap after its column), runs along the lane beside its source row (inside
  // that gap when the target is in the next column), and comes in on its target's entry track (the right band of the gap
  // before the target's column). Exit stubs end left of the entry band, so an exit and an entry on one row never meet.
  const colX = (c) => PAD + c * COL_W;
  const laneTop = (lane) => PAD + lane * ROW_H + LANE_Y;
  const routed = held.filter(({ from, to }) => {
    const a = place.get(from);
    const b = place.get(to);
    return !(b.col - a.col === 1 && a.y === b.y);
  });
  // Lanes (the lane between row `lane` and row `lane + 1`): below the source row when the target row is the same or lower,
  // else above. A source whose lane is full (more stretches at one point than LANE_TRACKS, measured on the widest x its
  // links could take) moves to the lane on the other side of its row when that one has room.
  const prefer = (a, b) => (b.row >= a.row ? a.row : a.row - 1);
  const wide = spans();
  for (const { from, to } of routed) {
    const a = place.get(from);
    const b = place.get(to);
    wide.add(prefer(a, b), from, colX(a.col) + GAP_X, colX(b.col - 1) + GAP_X + (GAP_TRACKS - 1) * TRACK);
  }
  const lanes = new Map(wide.channels());
  const moved = new Map();
  const fits = (stretches) => colour(stretches).count <= LANE_TRACKS;
  for (const lane of [...lanes.keys()].sort((p, q) => p - q)) {
    const { track } = colour(lanes.get(lane));
    for (const [from, k] of [...track].sort((p, q) => p[0] - q[0])) {
      if (k < LANE_TRACKS || fits(lanes.get(lane))) continue;
      const row = place.get(from).row;
      const alt = lane === row ? row - 1 : row;
      if (alt < 0) continue;
      const here = new Map(lanes.get(lane));
      const there = new Map(lanes.get(alt) ?? []);
      const [lo, hi] = here.get(from);
      const had = there.get(from);
      there.set(from, had ? [Math.min(had[0], lo), Math.max(had[1], hi)] : [lo, hi]);
      if (!fits(there)) continue;
      here.delete(from);
      lanes.set(lane, here);
      lanes.set(alt, there);
      moved.set(`${lane}|${from}`, alt);
    }
  }
  const laneOf = (a, b) => { const l = prefer(a, b); return moved.get(`${l}|${a.index}`) ?? l; };
  const outs = spans();
  const ins = spans();
  for (const { from, to } of routed) {
    const a = place.get(from);
    const b = place.get(to);
    const top = laneTop(laneOf(a, b));
    outs.add(a.col, from, Math.min(a.y, top), Math.max(a.y, top + BAND));
    ins.add(b.col - 1, to, Math.min(b.y, top), Math.max(b.y, top + BAND));
  }
  // A gap's GAP_TRACKS tracks: exits take them from the left, entries from the right, so every exit track lies left of
  // every entry track (one pitch apart at least). A gap that needs more wraps (a known gap the proof logs, D6).
  const exitX = new Map();
  const entryX = new Map();
  for (const c of new Set([...outs.channels(), ...ins.channels()].map(([k]) => k))) {
    const o = colour(outs.channels().find(([k]) => k === c)?.[1] ?? []);
    const e = colour(ins.channels().find(([k]) => k === c)?.[1] ?? []);
    const gx = (k) => colX(c) + GAP_X + (k % GAP_TRACKS) * TRACK;
    for (const [from, k] of o.track) exitX.set(from, gx(k));
    for (const [to, k] of e.track) entryX.set(to, gx(GAP_TRACKS - e.count + k));
  }
  const along = spans();
  for (const { from, to } of routed) along.add(laneOf(place.get(from), place.get(to)), from, exitX.get(from), entryX.get(to));
  const laneY = new Map();
  for (const [lane, stretches] of along.channels()) {
    for (const [from, k] of colour(stretches).track) laneY.set(`${lane}|${from}`, laneTop(lane) + (k % LANE_TRACKS) * TRACK);
  }
  const links = held.map(({ from, to }) => {
    const a = place.get(from);
    const b = place.get(to);
    const start = [a.x + HALF, a.y];
    const end = [b.x - HALF, b.y];
    if (b.col - a.col === 1 && a.y === b.y) return { from, to, points: [start, end] };
    const gx1 = exitX.get(from);
    const gx2 = entryX.get(to);
    const ly = laneY.get(`${laneOf(a, b)}|${from}`);
    return { from, to, points: [start, [gx1, a.y], [gx1, ly], [gx2, ly], [gx2, b.y], end] };
  });

  return {
    width: 2 * PAD + maxCol * COL_W,
    height: 2 * PAD + (maxRows - 1) * ROW_H,
    runs, links, implied,
  };
}

/** Slice 10 (D3): the feature page offers "Show order" from this many distinct runs. */
export const SHOW_ORDER_MIN_RUNS = 5;

/**
 * Pure, never throws. True when the drawing adds something to the rows: at least SHOW_ORDER_MIN_RUNS distinct runs and
 * links that are not a plain chain (some run builds on 2 or more known runs, or is built on by 2 or more runs). Reads
 * only `index` and `buildsOn` (unknown indexes ignored, duplicates folded), never `state`, so the answer holds as runs go.
 */
export function showOrderOffered(slices) {
  if (!Array.isArray(slices)) return false;
  const map = new Map();
  for (const s of slices) if (isObj(s) && Number.isInteger(s.index) && !map.has(s.index)) map.set(s.index, s);
  if (map.size < SHOW_ORDER_MIN_RUNS) return false;
  const builtOn = new Map();
  for (const s of map.values()) {
    const known = (Array.isArray(s.buildsOn) ? [...new Set(s.buildsOn)] : []).filter((d) => d !== s.index && map.has(d));
    if (known.length >= 2) return true;
    for (const d of known) {
      builtOn.set(d, (builtOn.get(d) || 0) + 1);
      if (builtOn.get(d) >= 2) return true;
    }
  }
  return false;
}

function el(doc, tag, cls) {
  const n = doc.createElement(tag);
  n.className = cls;
  return n;
}
function svg(doc, tag, attrs) {
  const n = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/** The map as a new `div.rom` (aria-hidden, never a tab stop); the caller places it. */
export function renderRunOrderMap(doc, slices) {
  const layout = runOrderLayout(slices);
  const root = el(doc, 'div', 'rom');
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('tabindex', '-1');
  const plot = el(doc, 'div', 'rom-plot');
  plot.style.width = `${layout.width}px`;
  plot.style.height = `${layout.height}px`;
  const lines = svg(doc, 'svg', { class: 'rom-links', width: layout.width, height: layout.height, focusable: 'false' });
  for (const link of layout.links) {
    const d = link.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('');
    const path = svg(doc, 'path', { class: 'rom-link', d });
    path.dataset.from = String(link.from);
    path.dataset.to = String(link.to);
    lines.append(path);
  }
  plot.append(lines);
  for (const r of layout.runs) {
    const run = el(doc, 'span', 'rom-run');
    run.style.left = `${r.x}px`;
    run.style.top = `${r.y}px`;
    run.dataset.run = String(r.index);
    if (r.mark) run.dataset.mark = r.mark;
    if (r.kind === 'change') run.dataset.kind = 'change';
    const n = el(doc, 'span', 'rom-n num');
    n.textContent = String(r.index);
    run.append(renderStatusDot(doc, markDot(BASE, r.mark, r.word)), n);
    plot.append(run);
  }
  root.append(plot);
  return root;
}
