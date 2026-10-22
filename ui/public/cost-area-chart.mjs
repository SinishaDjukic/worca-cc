// ui/public/cost-area-chart.mjs — the Cost report's smooth stacked area chart (Statistics › Cost). One area per
// top-level row (largest at the bottom), Other in slate, Unallocated hatched, Ask Worca in indigo. Areas are kept per
// series key, so an update morphs them (Web Animations on `d`) instead of redrawing; the first paint wipes in. Under
// prefers-reduced-motion, or without element.animate (jsdom), shapes are set at once. Tooltips: .ch-hit[data-tip],
// handled by app.js bindChartTips like every Statistics chart.
import { niceScale, bucketLabel, tipDate, compactUsd, DEFAULT_FMT } from './stats-view.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CW = 560, CH = 260, L = 44, R = 12, T = 18, B = 26;
export const SERIES_FILLS = Object.freeze(['var(--blue)', 'var(--green)', 'var(--teal)', 'var(--amber)', 'var(--pink)']);
const KIND_FILLS = { other: 'var(--slate)', ask: 'var(--indigo)', requirements: 'var(--violet)' };
let chartSeq = 0;
const r1 = (v) => Math.round(v * 10) / 10;

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function s(doc, tag, attrs = {}) {
  const n = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/** Monotone cubic (Fritsch–Carlson) through [[x, y]…] → 'M…C…'. It never overshoots between two points, so a
 *  stacked band never dips under the band below it. */
export function smoothPath(pts) {
  const n = pts.length;
  if (!n) return '';
  if (n === 1) return `M${r1(pts[0][0])},${r1(pts[0][1])}`;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], q = a * a + b * b;
    if (q > 9) { const t = 3 / Math.sqrt(q); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let out = `M${r1(pts[0][0])},${r1(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], dx = (x1 - x0) / 3;
    out += ` C${r1(x0 + dx)},${r1(y0 + m[i] * dx)} ${r1(x1 - dx)},${r1(y1 - m[i + 1] * dx)} ${r1(x1)},${r1(y1)}`;
  }
  return out;
}

/** One closed band: the top curve left to right, the bottom curve back. */
export function areaPath(lo, hi) {
  return `${smoothPath(hi)} L${smoothPath([...lo].reverse()).slice(1)} Z`;
}

/** Cumulative bands, bottom first: [{ lo, hi }] per series (negative values count as 0). */
export function stackBands(series) {
  const n = series[0]?.values.length || 0;
  const base = new Array(n).fill(0);
  return series.map((sr) => {
    const lo = base.slice();
    sr.values.forEach((v, i) => { base[i] += Math.max(0, v); });
    return { lo, hi: base.slice() };
  });
}

/** @returns {{ el: HTMLElement, update(spec): void, focus(key: string|null): void }} */
export function createAreaChart({ doc = globalThis.document, fmt = DEFAULT_FMT, reducedMotion = false, onTagRuns = () => {} } = {}) {
  const hatchId = `cr-hatch-${++chartSeq}`;
  const fig = h(doc, 'figure', 'chart-fig cr-chart');
  // The chart spans the full card, so a fixed 560-wide viewBox stretched its axis text to 18px+. The canvas tracks the
  // rendered width instead (1 unit = 1 CSS px) at a fixed 260px height (docs/design-system.md › Charts), and a resize
  // redraws it.
  let cw = CW, pw = CW - L - R;
  const ph = CH - T - B;
  let last = null;
  const svg = s(doc, 'svg', { class: 'chart-svg', viewBox: `0 0 ${CW} ${CH}` });
  const defs = s(doc, 'defs');
  const pat = s(doc, 'pattern', { id: hatchId, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pat.append(s(doc, 'rect', { width: 6, height: 6, fill: 'var(--surface)' }),
    s(doc, 'line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'var(--ink-3)', 'stroke-width': 2 }));
  defs.append(pat);
  const axis = s(doc, 'g', { class: 'cr-axis' });
  const plot = s(doc, 'g', { class: 'cr-plot' });
  const hits = s(doc, 'g', { class: 'cr-hits' });
  svg.append(defs, axis, plot, hits);
  const legend = h(doc, 'div', 'chart-legend cr-legend');
  const sr = h(doc, 'table', 'sr-only');
  fig.append(svg, legend, sr);
  const paths = new Map();
  let drawn = false;
  let tagIds = [];
  const fillOf = (row, i) => (row.kind === 'none' ? `url(#${hatchId})` : KIND_FILLS[row.kind] || SERIES_FILLS[i % SERIES_FILLS.length]);
  plot.addEventListener('animationend', () => plot.classList.remove('is-wiping'));

  function focus(key) {
    for (const [k, p] of paths) p.classList.toggle('is-dim', key != null && k !== key);
  }
  fig.addEventListener('pointerover', (e) => {
    const k = e.target.closest && e.target.closest('[data-key]');
    if (k) focus(k.dataset.key);
  });
  fig.addEventListener('pointerleave', () => focus(null));
  // The .ch-hit tooltip rects cover the areas, so a hover over an area lands on a rect: find the band under the pointer.
  let stack = { keys: [], bands: [], top: 1 };
  hits.addEventListener('pointermove', (e) => {
    const hit = e.target.closest && e.target.closest('.ch-hit');
    if (!hit) return;
    const box = svg.getBoundingClientRect();
    if (!box.height) return;
    const i = Number(hit.dataset.i);
    const v = ((T + ph - (e.clientY - box.top) * (CH / box.height)) / ph) * stack.top;
    const at = stack.bands.findIndex((b) => v >= b.lo[i] && v < b.hi[i]);
    focus(at < 0 ? null : stack.keys[at]);
  });
  legend.addEventListener('click', (e) => { if (e.target.closest('.cr-tag-runs')) onTagRuns(tagIds); });
  const RO = doc.defaultView?.ResizeObserver;
  if (typeof RO === 'function') {
    new RO(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (!w || w === cw) return;                       // hidden, or our own viewBox change settling
      cw = w; pw = cw - L - R;
      svg.setAttribute('viewBox', `0 0 ${cw} ${CH}`);
      if (last) draw(last, false);
    }).observe(svg);
  }

  function update(spec) {
    last = spec;
    draw(spec, !reducedMotion);
  }

  function draw({ series, buckets, bucket, metric = 'spend', unallocated = null }, morph) {
    const n = buckets.length;
    const bands = stackBands(series);
    const max = bands.length ? Math.max(0, ...bands[bands.length - 1].hi) : 0;
    const { step, top } = niceScale(max);
    const xOf = (i) => (n > 1 ? L + (i / (n - 1)) * pw : L + pw / 2);
    const yOf = (v) => T + ph - (v / top) * ph;
    stack = { keys: series.map((row) => row.key), bands, top };
    const yFmt = metric === 'hours' ? (v) => `${Math.round(v * 10) / 10} h` : (v) => compactUsd(fmt, v);
    svg.setAttribute('aria-label', metric === 'hours' ? 'Human hours by group' : 'AI spend by group');

    axis.replaceChildren();
    for (let v = 0; v <= top + 1e-9; v += step) {
      const y = yOf(v);
      axis.append(s(doc, 'line', { x1: L, y1: y, x2: cw - R, y2: y, stroke: v === 0 ? 'var(--line-2)' : 'var(--line)', 'stroke-width': 1 }));
      const t = s(doc, 'text', { class: 'ch-ytick', x: L - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--ink-3)' });
      t.textContent = yFmt(v);
      axis.append(t);
    }
    const every = n <= 10 ? 1 : Math.ceil(n / 8);
    buckets.forEach((ms, i) => {
      // The last bucket always gets a label; a regular one just before it would collide with it ("Mon 19 20").
      if (i !== n - 1 && (i % every || n - 1 - i < every / 2)) return;
      const t = s(doc, 'text', { x: xOf(i), y: CH - 8, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--ink-3)' });
      t.textContent = bucketLabel(ms, bucket);
      axis.append(t);
    });

    const seen = new Set();
    series.forEach((row, i) => {
      seen.add(row.key);
      const d = areaPath(bands[i].lo.map((v, j) => [xOf(j), yOf(v)]), bands[i].hi.map((v, j) => [xOf(j), yOf(v)]));
      let p = paths.get(row.key);
      if (!p) { p = s(doc, 'path', { class: 'cr-area' }); p.dataset.key = row.key; paths.set(row.key, p); }
      plot.append(p);                                   // re-append keeps the stacking order
      p.setAttribute('fill', fillOf(row, i));
      p.classList.toggle('cr-area-none', row.kind === 'none');
      const from = p.getAttribute('d');
      p.setAttribute('d', d);
      if (morph && from && from !== d && typeof p.animate === 'function') {
        p.animate([{ d: `path("${from}")` }, { d: `path("${d}")` }], { duration: 320, easing: 'ease-out' });
      }
    });
    for (const [k, p] of paths) if (!seen.has(k)) { p.remove(); paths.delete(k); }
    if (!drawn && !reducedMotion) plot.classList.add('is-wiping');
    drawn = true;

    hits.replaceChildren();
    const bandW = n > 1 ? pw / (n - 1) : pw;
    const valueText = (v) => (metric === 'hours' ? fmt.hours(v) : fmt.usd(v));
    buckets.forEach((ms, i) => {
      const lines = series.filter((row) => row.values[i] > 0).map((row) => `${row.label}: ${valueText(row.values[i])}`);
      const hit = s(doc, 'rect', { class: 'ch-hit', x: Math.max(L, xOf(i) - bandW / 2), y: T, width: bandW, height: ph,
        tabindex: 0, role: 'img', 'aria-label': `${tipDate(ms, bucket)}, ${lines.join(', ') || 'none'}` });
      hit.dataset.i = String(i);
      hit.dataset.tip = [tipDate(ms, bucket), ...(lines.length ? lines : ['None'])].join('\n');
      hits.append(hit);
    });

    legend.replaceChildren();
    tagIds = unallocated ? unallocated.ids : [];
    series.forEach((row, i) => {
      const item = h(doc, 'span', 'lg-item');
      item.dataset.key = row.key;
      const sw = s(doc, 'svg', { class: 'cr-swatch', width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': 'true' });
      sw.append(s(doc, 'rect', { width: 10, height: 10, fill: fillOf(row, i) }));
      item.append(sw, h(doc, 'span', null, row.label));
      if (row.kind === 'none' && tagIds.length) {
        const b = h(doc, 'button', 'linkish cr-tag-runs', `Tag ${tagIds.length} ${tagIds.length === 1 ? 'run' : 'runs'}`);
        b.type = 'button';
        b.setAttribute('aria-label', `Select the ${tagIds.length} unallocated runs in the Runs list`);
        item.append(b);
      }
      legend.append(item);
    });

    sr.replaceChildren(h(doc, 'caption', null, svg.getAttribute('aria-label')));
    const head = h(doc, 'tr');
    for (const c of ['Period', ...series.map((row) => row.label)]) head.append(h(doc, 'th', null, c));
    sr.append(head);
    buckets.forEach((ms, i) => {
      const tr = h(doc, 'tr');
      for (const c of [tipDate(ms, bucket), ...series.map((row) => valueText(row.values[i]))]) tr.append(h(doc, 'td', null, c));
      sr.append(tr);
    });
  }

  return { el: fig, update, focus };
}
