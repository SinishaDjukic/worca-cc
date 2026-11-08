// BarChart (docs/rail/look.md › look.chart): one question, one series, one chart. Thin ink bars with 4px rounded ends on
// the baseline and a 2px gap; the period you are in is the darkest; only the highest and the current carry a number;
// each bar says its value on hover and focus; a table under it says the same to a screen reader. No legend for one
// series (the title names it), no grid, no second axis, no colour: colour stays for what needs you.
import { attrs, esc } from './html.mjs';

/**
 * @param {object} o
 * @param {string} o.label                    what it shows, for a screen reader: "Spend by day, November"
 * @param {{label:string, value:number, text:string, diff?:string, note?:string}[]} o.bars   each period: its axis word, its number, the number in words ("$42"); a difference and a note when it can be read (watchChart)
 * @param {number} [o.current]                the index of the period you are in
 * @param {number} [o.height]                 the plot's height in px
 * @param {boolean} [o.play]                  it is read and narrowed under the hand (watchChart)
 * @param {string} [o.hint]                   one quiet line under it
 * @param {string} [o.caption]                what it shows, above the plot, when the rows under it are not by time: "Per day, by project"
 * @param {{label:string, values:number[], texts?:string[]}[]} [o.parts]   what each bar is made of, at most four, the largest first; ink shades and a legend (look.chart-play)
 * @param {{value:number, text:string}} [o.limit]   a thin line across the plot, named once in the legend: the budget's daily pace
 */
export function barChart({ label, bars, current = -1, height = 120, play = false, hint = '', caption = '', parts = null, limit = null }) {
  const high = Math.max(1, ...bars.map((b) => b.value)), max = Math.max(high, limit ? limit.value : 0), top = bars.findIndex((b) => b.value === high);
  const segs = (i) => parts.filter((p) => p.values[i]).map((p) => `<i class="ch-seg is-s${parts.indexOf(p)}" style="flex-grow:${p.values[i]}"></i>`).join('');
  const partWords = (i) => parts.map((p) => `${p.label} ${p.texts ? p.texts[i] : p.values[i]}`).join(' · ');
  const noted = (b, i) => (parts ? { ...b, note: [partWords(i), b.note].filter(Boolean).join(' · ') } : b);
  const lineAt = limit ? Math.round((limit.value / max) * (height - 18)) : 0;
  const cols = bars.map((b, i) => {
    const h = Math.max(b.value ? 3 : 0, Math.round((b.value / max) * (height - 18)));
    const shown = i === top || i === current;
    // a number that would sit on the limit line goes beside its bar, under the line, so it never reads as the line's value
    const onLine = shown && limit && h <= lineAt && lineAt <= h + 20;
    const beside = onLine ? ` class="bc-v is-beside${i === 0 ? ' is-after' : ''}" style="bottom:${Math.max(0, h - 14)}px"` : ' class="bc-v"';
    return `<span class="bc-col${i === current ? ' is-now' : ''}" data-i="${i}" tabindex="0"${play ? attrs({ 'data-read': readOf(noted(b, i)) }) : attrs({ title: `${b.label}: ${b.text}` })}><span${beside}>${shown ? esc(b.text) : ''}</span><span class="bc-bar${parts ? ' is-stack' : ''}" style="height:${h}px">${parts ? segs(i) : ''}</span><span class="bc-x">${esc(b.label)}</span></span>`;
  }).join('');
  const table = parts
    ? srTable(label, ['All', ...parts.map((p) => p.label)], bars.map((b, i) => [b.label, b.text, ...parts.map((p) => (p.texts ? p.texts[i] : String(p.values[i])))]))
    : `<table class="bc-table"><caption>${esc(label)}</caption><tbody>${bars.map((b) => `<tr><th scope="row">${esc(b.label)}</th><td>${esc(b.text)}</td></tr>`).join('')}</tbody></table>`;
  const line = limit ? `<span class="bc-limit" style="bottom:${lineAt}px"></span>` : '';
  const legend = legendOf([...(parts || []).map((p, k) => ({ cls: `is-s${k}`, text: p.label })), ...(limit ? [{ cls: 'is-limit', text: limit.text }] : [])]);
  return `<figure class="bar-chart${play ? ' is-read-able' : ''}" style="--bc-h:${height}px"${play ? ` data-chart data-n="${bars.length}"` : ''}>${capOf(caption)}${play ? '<div class="ch-read" hidden></div>' : ''}<div class="bc-plot${limit ? ' has-limit' : ''}" aria-hidden="true">${cols}${line}</div>${legend}${hintOf(hint)}${table}</figure>`;
}

// ---- Chart play (docs/rail/look.md › look.chart-play): other forms appear only when you ask for them ----

/** What a point differs by: "+$27, +41%". Nothing to compare with, nothing said. */
export function diffWords(now, before, text = (n) => String(n)) {
  if (before == null || now == null) return '';
  const d = now - before, sign = d > 0 ? '+' : d < 0 ? '−' : '';
  const pct = before ? `, ${sign}${Math.abs(Math.round((d / before) * 100))}%` : '';
  return `${sign}${text(Math.abs(d))}${pct}`;
}

const srTable = (label, columns, rows) => `<table class="bc-table"><caption>${esc(label)}</caption><thead><tr><th scope="col"></th>${columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(([head, ...cells]) => `<tr><th scope="row">${esc(head)}</th>${cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const legendOf = (items) => (items.length ? `<div class="ch-legend">${items.map((l) => `<span class="ch-key"><i class="ch-swatch ${l.cls}"></i>${esc(l.text)}</span>`).join('')}</div>` : '');
const capOf = (caption) => (caption ? `<p class="ch-cap">${esc(caption)}</p>` : '');
const hintOf = (hint) => (hint ? `<p class="ch-hint">${esc(hint)}</p>` : '');
// the bottom words, thinned when there are many; each sits under its column
const axisOf = (labels) => { const step = labels.length > 12 ? 5 : 1; return `<div class="ch-xs" style="--ch-n:${labels.length}" aria-hidden="true">${labels.map((l, i) => `<span class="ch-x${step > 1 && i === labels.length - 1 ? ' is-end' : ''}">${(i + 1) % step === 0 || i === 0 ? esc(l) : ''}</span>`).join('')}</div>`; };
const readOf = (p) => [p.label, p.text, p.diff, p.note].filter(Boolean).join('|');

/**
 * LineChart: a number over time, when you asked for lines: one series solid, a comparison dashed, a limit as a quiet line;
 * a legend names them; one axis, from zero.
 * @param {object} o
 * @param {string} o.label     what it shows, for a screen reader
 * @param {string[]} o.labels  every column's axis word
 * @param {{label:string, dashed?:boolean, part?:number, points:({value:number, text:string, diff?:string, note?:string}|null)[]}[]} o.series  the first is the one you read; null is no data yet
 * @param {{value:number, text:string}} [o.limit]   a budget line
 * @param {number} [o.current]  the index of the period you are in
 * @param {number} [o.height]
 * @param {string} [o.hint]     one quiet line under it
 * @param {string} [o.caption]  what it shows, above the plot
 */
export function lineChart({ label, labels, series, limit = null, current = -1, height = 140, hint = '', caption = '' }) {
  const n = labels.length, x = (i) => ((i + 0.5) / n) * 100;
  const top = Math.max(1, limit ? limit.value : 0, ...series.flatMap((s) => s.points.map((p) => (p ? p.value : 0)))) * 1.12, y = (v) => 100 - (v / top) * 100;
  const path = (s) => { const pts = s.points.map((p, i) => (p ? [x(i), y(p.value)] : null)).filter(Boolean); return pts.length ? `<path class="ch-l${s.dashed ? ' is-before' : ''}${s.part != null ? ` is-p${s.part}` : ''}" vector-effect="non-scaling-stroke" d="${pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(2)} ${b.toFixed(2)}`).join('')}"/>` : ''; };
  const main = series[0].points, known = main.map((p, i) => (p ? i : -1)).filter((i) => i >= 0), peak = Math.max(...known.map((i) => main[i].value)), high = known.find((i) => main[i].value === peak);
  const lim = limit ? `<path class="ch-l is-limit" vector-effect="non-scaling-stroke" d="M0 ${y(limit.value).toFixed(2)}H100"/>` : '';
  const dots = known.map((i) => `<span class="ch-dot${i === current ? ' is-now' : ''}" data-dot="${i}" style="left:${x(i).toFixed(2)}%;top:${y(main[i].value).toFixed(2)}%"></span>`).join('');
  const nums = [...new Set([high, current].filter((i) => i >= 0 && main[i]))].map((i) => `<span class="ch-v" style="left:${x(i).toFixed(2)}%;top:${y(main[i].value).toFixed(2)}%">${esc(main[i].text)}</span>`).join('');
  const hits = labels.map((l, i) => (main[i] ? `<span class="ch-hit" data-i="${i}" tabindex="0" role="img" aria-label="${esc([l, main[i].text, main[i].diff].filter(Boolean).join(', '))}" data-read="${esc(readOf({ ...main[i], label: l }))}"></span>` : '<span class="ch-none"></span>')).join('');
  const legend = series.length > 1 || limit ? legendOf([...series.map((s) => ({ cls: s.part != null ? `is-line is-s${s.part}` : s.dashed ? 'is-before' : 'is-main', text: s.label })), ...(limit ? [{ cls: 'is-limit', text: limit.text }] : [])]) : '';
  const rows = labels.flatMap((l, i) => (main[i] ? [[l, ...series.map((s) => (s.points[i] ? s.points[i].text : ''))]] : []));
  return `<figure class="chart" style="--ch-h:${height}px" data-chart data-n="${n}" data-last="${known[known.length - 1] ?? 0}">${capOf(caption)}<div class="ch-read" hidden></div><div class="ch-plot"><svg class="ch-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lim}${series.slice(1).map(path).join('')}${path(series[0])}</svg>${dots}${nums}<div class="ch-hits" style="--ch-n:${n}">${hits}</div></div>${axisOf(labels)}${legend}${hintOf(hint)}${srTable(label, series.map((s) => s.label), rows)}</figure>`;
}

/**
 * MixChart: what each period was made of, when you asked for the mix: stacked columns in ink shades, never hues, with a legend.
 * @param {object} o
 * @param {string} o.label
 * @param {string[]} o.labels
 * @param {{label:string, values:number[], texts?:string[]}[]} o.parts   at most four, the largest first
 * @param {string[]} [o.reads]  each column's words after its label ("$93 · 10 tasks")
 * @param {number} [o.height]
 * @param {string} [o.hint]
 * @param {string} [o.caption]
 */
export function mixChart({ label, labels, parts, reads = [], height = 120, hint = '', caption = '' }) {
  const totals = labels.map((_, i) => parts.reduce((a, p) => a + (p.values[i] || 0), 0)), max = Math.max(1, ...totals);
  const cols = labels.map((l, i) => `<span class="ch-col" data-i="${i}" tabindex="0" role="img" aria-label="${esc(`${l}: ${parts.map((p) => `${p.label} ${p.texts ? p.texts[i] : p.values[i]}`).join(', ')}`)}" data-read="${esc(readOf({ label: l, text: reads[i] || String(totals[i]), note: parts.map((p) => `${p.label} ${p.texts ? p.texts[i] : p.values[i]}`).join(' · ') }))}"><span class="ch-stack" style="height:${((totals[i] / max) * 100).toFixed(2)}%">${parts.map((p, k) => `<i class="ch-seg is-s${k}" style="flex-grow:${p.values[i] || 0}"></i>`).join('')}</span></span>`).join('');
  const rows = labels.map((l, i) => [l, ...parts.map((p) => (p.texts ? p.texts[i] : String(p.values[i])))]);
  return `<figure class="chart" style="--ch-h:${height}px" data-chart data-n="${labels.length}" data-last="${labels.length - 1}">${capOf(caption)}<div class="ch-read" hidden></div><div class="ch-plot"><div class="ch-hits is-cols" style="--ch-n:${labels.length}">${cols}</div></div>${axisOf(labels)}${legendOf(parts.map((p, k) => ({ cls: `is-s${k}`, text: p.label })))}${hintOf(hint)}${srTable(label, parts.map((p) => p.label), rows)}</figure>`;
}

/**
 * What a chart does under the hand: hover or focus reads a point, a click or Enter opens it, a drag across narrows.
 * Call it on a chart after drawing; nothing moves, so reduced motion has nothing to take away.
 * @param {HTMLElement} fig   a figure from barChart, lineChart or mixChart
 * @param {object} [o]
 * @param {(i:number)=>void} [o.open]
 * @param {(from:number,to:number)=>void} [o.narrow]
 */
export function watchChart(fig, { open, narrow } = {}) {
  const plot = fig?.querySelector('.ch-plot, .bc-plot'), read = fig?.querySelector('.ch-read');
  if (!plot) return;
  if (narrow && (+fig.dataset.n || 0) > 2) plot.title = 'Drag across to narrow';
  const doc = plot.ownerDocument, hits = [...plot.querySelectorAll('[data-i]')], n = +fig.dataset.n || hits.length, last = fig.dataset.last ? +fig.dataset.last : n - 1;
  const hitAt = (i) => hits.find((h) => +h.dataset.i === i);
  const at = (clientX) => { const r = plot.getBoundingClientRect(), w = r.width / n; return Math.min(last, Math.max(0, Math.floor((clientX - r.left) / w))); };
  const clear = () => { for (const el of plot.querySelectorAll('.is-read')) el.classList.remove('is-read'); if (read) read.hidden = true; };
  const show = (i) => {
    clear();
    const hit = hitAt(i); if (!hit) return;
    hit.classList.add('is-read'); plot.querySelector(`[data-dot="${i}"]`)?.classList.add('is-read');
    if (!read || !hit.dataset.read) return;
    const [head, ...rest] = hit.dataset.read.split('|');
    read.replaceChildren(Object.assign(doc.createElement('b'), { textContent: head }), Object.assign(doc.createElement('span'), { textContent: rest.join(' · ') }));
    read.hidden = false;
    // in the band above the plot, so it never covers the line; centred on its point, kept inside the chart
    const box = plot.getBoundingClientRect(), mid = ((i + 0.5) / n) * box.width, w = read.offsetWidth;
    read.style.left = `${Math.max(0, Math.min(box.width - w, mid - w / 2))}px`;
  };
  let start = -1, startX = 0, dragging = false, brush = null;
  const paint = (a, b) => {
    if (!brush) { brush = doc.createElement('span'); brush.className = 'ch-brush'; plot.append(brush); }
    brush.style.left = `${(Math.min(a, b) / n) * 100}%`; brush.style.width = `${((Math.abs(a - b) + 1) / n) * 100}%`;
  };
  plot.addEventListener('pointerdown', (e) => { if (e.button) return; start = at(e.clientX); startX = e.clientX; dragging = false; plot.setPointerCapture?.(e.pointerId); });
  plot.addEventListener('pointermove', (e) => {
    const i = at(e.clientX);
    if (start < 0) { show(i); return; }
    if (narrow && n > 2 && Math.abs(e.clientX - startX) > 6) dragging = true;
    if (dragging) { clear(); paint(start, i); }
  });
  plot.addEventListener('pointerup', (e) => {
    if (start < 0) return;
    const a = start, b = at(e.clientX), was = dragging; start = -1; dragging = false; brush?.remove(); brush = null;
    if (was) { if (a !== b) narrow(Math.min(a, b), Math.max(a, b)); return; }
    if (hitAt(b)) open?.(b);
  });
  plot.addEventListener('pointerleave', () => { if (start < 0) clear(); });
  plot.addEventListener('focusin', (e) => { const h = e.target.closest('[data-i]'); if (h) show(+h.dataset.i); });
  plot.addEventListener('focusout', clear);
  plot.addEventListener('keydown', (e) => {
    const h = e.target.closest('[data-i]'); if (!h) return;
    const i = +h.dataset.i;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open?.(i); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); hitAt(i + (e.key === 'ArrowRight' ? 1 : -1))?.focus(); }
  });
}

/**
 * FigureRows: the same figures across rows, each whole row one target (its tasks); a second level sits under its parent.
 * @param {object} o
 * @param {string} o.label
 * @param {{label:string, narrow?:boolean}[]} o.columns   after the name; narrow:false leaves on a narrow screen
 * @param {{name:string, cells:string[], sub?:boolean, quiet?:boolean, attrs?:object}[]} o.rows
 */
export function figureRows({ label, columns, rows }) {
  const cell = (t, c) => `<span class="fr-c${c.narrow === false ? ' is-wide' : ''}">${esc(t ?? '')}</span>`;
  return `<div class="fr-list" role="group" style="--fr-n:${columns.length}"${attrs({ 'aria-label': label })}><div class="fr-row is-head" aria-hidden="true"><span></span>${columns.map((c) => cell(c.label, c)).join('')}</div>${rows.map((r) => `<button type="button" class="fr-row${r.sub ? ' is-sub' : ''}${r.quiet ? ' is-quiet' : ''}"${attrs({ 'aria-label': `${r.name}: ${columns.map((c, i) => `${c.label} ${r.cells[i]}`).join(', ')}`, ...(r.attrs || {}) })}><span class="fr-name">${esc(r.name)}</span>${columns.map((c, i) => cell(r.cells[i], c)).join('')}</button>`).join('')}</div>`;
}
