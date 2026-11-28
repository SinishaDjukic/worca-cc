// ui/public/shape/run-order-map.mjs — Shaper small runs slice 9 (R-ux-4): the still run order map of a marked feature.
// `runOrderLayout` is pure: it places each run of featureView's `slices` in a column right of every run it builds on
// (rows in run-number order); a change run or an extra run that builds on nothing (added from the chat card or a run's
// stop) stands in the column after the last run before it (no link is drawn into it); a follow-up keeps its place. It keeps only the links that still hold a run back (implied links left out
// through `namedWaits`); once none holds a run back, every link is drawn faint. Links follow the agreed mock's routing
// (R-ux-6): one curve to the next column; a link that skips columns runs in the lane in the free gap under its upper row
// (below its kept rings, above the next row's numbers: slice 16), never through a number nor within 7px of a dot it
// does not join. `renderRunOrderMap` paints it: the shared status dot per run over its row's base
// (a paused or stopped run shows the row's dot), its number above it, an SVG of the links, no motion but the live dot's
// existing pulse. `markRunOrderMap` lights a pointed or kept run and its drawn links (the rows' bindRunLinks drives it).
// The rows beside it stay the accessible source, so the map is aria-hidden and listens to nothing.
import { namedWaits, runStatus } from '../../../src/shared/shape/run-status.mjs';
import { RUN_STATES } from '../../../src/shared/run-model.mjs';
import { markDot, renderStatusDot } from '../status-dot.mjs';

export const RUN_ORDER_GEOMETRY = Object.freeze({
  COL_W: 64, ROW_H: 38, PAD: 24, DOT: 12, LABEL_PX: 11, DIGIT_W: 7, LANE_IN: 0.6, PULL: 0.35,
});

const { COL_W, ROW_H, PAD, DOT, LABEL_PX, DIGIT_W, LANE_IN, PULL } = RUN_ORDER_GEOMETRY;
const HALF = DOT / 2;
/** The kept ring's outer radius: the run number's bottom stands this far above the dot's centre. */
const RING_R = 11;
/** `missed`: a run whose turn passed while the run before it was stopped; it still waits for that run. */
const NOT_STARTED = new Set(['planned', 'held', 'missed']);
/** The chained append kinds: one that builds on nothing stands after the last run before it (a follow-up is not chained). */
const AFTER_LAST_KINDS = new Set(['change', 'extra']);
/** A slice state → the run model state its feature page row's dot starts from; any other state is `waiting`. */
const ROW_STATE = Object.freeze({ paused: 'paused', stopped: 'stopped', canceled: 'stopped', error: 'failed', failed: 'failed' });
const SVG_NS = 'http://www.w3.org/2000/svg';
const EMPTY = () => ({ width: 0, height: 0, runs: [], links: [], implied: [] });

const isObj = (x) => !!x && typeof x === 'object';
const byPair = (a, b) => a.from - b.from || a.to - b.to;
/** Every x of a link to 0.1px, so float noise in LANE_IN·COL_W and PULL·COL_W never reaches `d`. */
const tenth = (v) => Math.round(v * 10) / 10;
const pt = (x, y) => [tenth(x), y];
/** `M p0` then each segment as `C c1 c2 p1` or `L p1`, single-spaced. */
const pathOf = (segments) => [`M ${segments[0].p[0].join(' ')}`, ...segments.map(({ c, p }) => `${c} ${p.slice(1).flat().join(' ')}`)].join(' ');

/**
 * The agreed mock's link loop (plans/shaper-refresh/run-order-mock.html `paintMap`), in centre coordinates. From the
 * source dot's right edge to the target's left edge: to the next column, one cubic with both control points at the mid
 * x; skipping columns, a cubic down (or up) into the lane under the upper row, a straight run along it, and a cubic
 * out to the target. Slice 16 (direction d8776dd9f): the lane lies in the free band between rows, below the upper row's
 * kept ring (+ RING_R) and above the lower row's number box (+ ROW_H − RING_R − LABEL_PX), at a whole y.
 */
function route(a, b) {
  const [x1, y1, x2, y2] = [a.x + HALF, a.y, b.x - HALF, b.y];
  if (b.col - a.col <= 1) {
    const mid = (x1 + x2) / 2;
    return [{ c: 'C', p: [pt(x1, y1), pt(mid, y1), pt(mid, y2), pt(x2, y2)] }];
  }
  const lane = Math.min(y1, y2) + Math.floor((ROW_H - LABEL_PX) / 2);
  const [inX, outX, pull] = [x1 + LANE_IN * COL_W, x2 - LANE_IN * COL_W, PULL * COL_W];
  return [
    { c: 'C', p: [pt(x1, y1), pt(x1 + pull, y1), pt(inX - pull, lane), pt(inX, lane)] },
    { c: 'L', p: [pt(inX, lane), pt(outX, lane)] },
    { c: 'C', p: [pt(outX, lane), pt(outX + pull, lane), pt(x2 - pull, y2), pt(x2, y2)] },
  ];
}

/**
 * Pure. slices: featureView slice rows (`index`, `state`, `kind`, `buildsOn`, `waitsFor`, …).
 * @returns {{width: number, height: number, runs: object[],
 *   links: {from: number, to: number, segments: {c: 'C'|'L', p: number[][]}[], d: string, faint?: true}[],
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
  // A change or extra run that builds on no known run, and is not the first run, stands after the last run before it.
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
    const before = indexes[indexes.indexOf(i) - 1];
    const s = map.get(i);
    if (AFTER_LAST_KINDS.has(s.kind) && !known(s).length && before !== undefined && !onStack.has(before)) c = depth(before) + 1;
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
    const w = DIGIT_W * String(index).length;
    return {
      index, col: c, row, x, y, mark: st.mark, word: st.word, kind: slice.kind ?? null,
      rowState: ROW_STATE[slice.state] || 'waiting',
      dot: { x0: x - HALF, y0: y - HALF, x1: x + HALF, y1: y + HALF },
      label: { x0: x - w / 2, y0: y - RING_R - LABEL_PX, x1: x + w / 2, y1: y - RING_R },
    };
  });

  // Links: the transitive reduction of each run's buildsOn (namedWaits), kept only while it still holds the run back.
  // When none holds a run back, every reduced link (`met`) is drawn, faint.
  const held = [];
  const met = [];
  const implied = [];
  for (const to of indexes) {
    const target = map.get(to);
    const builds = known(target).filter((from) => !back.has(`${from}>${to}`));
    const reduced = new Set(namedWaits({ waitsFor: builds }, map));
    for (const from of builds) {
      if (!reduced.has(from)) { implied.push({ from, to }); continue; }
      met.push({ from, to });
      if (map.get(from).state !== 'done' && (NOT_STARTED.has(target.state) || target.stop?.held)) held.push({ from, to });
    }
  }
  held.sort(byPair);
  met.sort(byPair);
  implied.sort(byPair);
  const faint = !held.length;
  const drawn = faint ? met : held;

  const links = drawn.map(({ from, to }) => {
    const segments = route(place.get(from), place.get(to));
    const link = { from, to, segments, d: pathOf(segments) };
    return faint ? { ...link, faint: true } : link;
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
    const path = svg(doc, 'path', { class: link.faint ? 'rom-link is-faint' : 'rom-link', d: link.d });
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
    run.append(renderStatusDot(doc, markDot({ state: r.rowState, ...RUN_STATES[r.rowState] }, r.mark, r.word)), n);
    plot.append(run);
  }
  root.append(plot);
  return root;
}

/**
 * The marks of a pointed or kept run (R-ux-6), fed by bindRunLinks' `onShow`; the map itself listens to nothing. Clears
 * every mark under `root`, then, for a drawn run, lights its `.rom-run` and every drawn link that starts or ends at it
 * and dims every other link. The lit links move to the end of the SVG (a shared lane never paints over them); the rest
 * keep the layout order (from, to). Changes only classes and child order. Never throws.
 * @returns {number} how many links are lit
 */
export function markRunOrderMap(root, run) {
  // Class lookups, not selectors: the map stays a plain tree walk (jsdom's selector engine binds window listeners).
  if (!root || typeof root.getElementsByClassName !== 'function') return 0;
  const byClass = (cls) => [...root.getElementsByClassName(cls)];
  const paths = byClass('rom-link').filter((p) => p.localName === 'path');
  for (const n of [...byClass('rom-run'), ...paths]) n.classList.remove('is-lit', 'is-dim');
  const src = (p) => Number(p.dataset.from);
  const dst = (p) => Number(p.dataset.to);
  const dot = Number.isInteger(run) ? byClass('rom-run').find((r) => r.dataset.run === String(run)) : null;
  const lit = dot ? paths.filter((p) => src(p) === run || dst(p) === run) : [];
  if (dot) {
    dot.classList.add('is-lit');
    for (const p of paths) p.classList.add(lit.includes(p) ? 'is-lit' : 'is-dim');
  }
  const lines = byClass('rom-links')[0];
  if (lines) {
    const order = (p, q) => src(p) - src(q) || dst(p) - dst(q);
    const want = [...paths.filter((p) => !lit.includes(p)).sort(order), ...lit.sort(order)];
    if (want.some((p, i) => lines.children[i] !== p)) lines.append(...want);
  }
  return lit.length;
}
