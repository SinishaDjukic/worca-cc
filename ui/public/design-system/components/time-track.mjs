// TimeTrack (docs/rail/look.md › look.time-track): a person's tasks on a day axis taken from the page's own range. Each
// row is one task: its button opens the task; its lane draws the work as a solid ink span (first run to last), the wait
// for review as a dashed tail, and ends in a GitMark at the PR's time, the row's one second target (it opens the PR).
// No hue: state colour comes from the KindMark and the GitMark.
import { attrs, esc } from './html.mjs';
import { gitMark, timelineCard } from './kind-mark.mjs';
import { textLink } from './text-link.mjs';

const DAY = 86_400_000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clamp = (v) => Math.min(1, Math.max(0, v));
const pct = (v) => `${+(v * 100).toFixed(2)}%`;
export const isWebUrl = (u) => /^https?:\/\//i.test(String(u || ''));   // a PR link is written only for http(s)
let cards = 0;   // a card's id, unique on the page

/** Where a time sits on a track, 0 to 1 (clamped). A track whose end is not after its start throws. */
export function trackX(t, start, end) {
  if (!(end > start)) throw new RangeError('empty track');
  return clamp((t - start) / (end - start));
}

/**
 * The day axis of a track: its UTC days from `start` to `end`, and a label on every ⌈days/max⌉-th day, the first always.
 * @param {number} start  epoch ms
 * @param {number} end    epoch ms, the last moment on the track
 * @param {{max?:number}} [o]
 * @returns {{days:number, ticks:{x:number, label:string}[]}}
 */
export function dayTicks(start, end, { max = 10 } = {}) {
  const d0 = Math.floor(start / DAY), days = Math.max(1, Math.floor(end / DAY) - d0 + 1), step = Math.ceil(days / max), ticks = [];
  for (let i = 0; i < days; i += step) { const at = (d0 + i) * DAY, d = new Date(at); ticks.push({ x: end > start ? trackX(at, start, end) : 0, label: `${MON[d.getUTCMonth()]} ${d.getUTCDate()}` }); }
  return { days, ticks };
}

/**
 * WorkBar: one lane's marks.
 * @param {object} o
 * @param {[number, number]} o.work                 first run to last, 0 to 1
 * @param {[number, number]|null} [o.wait]          the PR waiting for review, 0 to 1
 * @param {{status:'merged'|'open'|'closed', x:number, url?:string, label:string, attrs?:object}|null} [o.end]   the PR's mark
 * @param {{title:string, line:string}|null} [o.card]   the mark's TimelineCard, on hover and focus
 */
export function workBar({ work, wait = null, end = null, card = null }) {
  const span = ([a, b], kind) => { const x0 = clamp(a), x1 = Math.max(x0, clamp(b)); return `<span class="tt-${kind}${a < 0 ? ' is-cut' : ''}" style="left:${pct(x0)};width:${pct(x1 - x0)}"></span>`; };
  let mark = '';
  if (end) {
    const id = card ? `tt-card-${++cards}` : null, x = clamp(end.x);
    const a = { ...(end.attrs || {}), 'aria-label': end.label, 'aria-describedby': id, style: `left:${pct(x)}` };
    const quiet = (m) => (card ? m.replace(/ title="[^"]*"/, '') : m);   // with a card, the card says the state: no native tooltip beside it
    const inner = quiet(gitMark({ status: end.status, size: 14 }));
    mark = isWebUrl(end.url) ? `<a class="tt-end"${attrs({ href: end.url, target: '_blank', rel: 'noopener noreferrer', ...a })}>${inner}</a>` : `<button type="button" class="tt-end"${attrs(a)}>${inner}</button>`;
    if (card) mark += timelineCard({ mark: quiet(gitMark({ status: end.status, size: 14 })), title: card.title, line: card.line, x, id });
  }
  return `${span(work, 'work')}${wait ? span(wait, 'wait') : ''}${mark}`;
}

/**
 * MarkLegend: names the marks of a TimeTrack (not series): a solid or dashed line, or a mark.
 * @param {{items:({line:'solid'|'dashed', text:string}|{mark:string, text:string})[]}} o
 */
export function markLegend({ items }) {
  const key = (it) => `<span class="ch-key">${it.mark ? it.mark : `<i class="ch-swatch ${it.line === 'dashed' ? 'is-before' : 'is-main'}"></i>`}${esc(it.text)}</span>`;
  return `<div class="ch-legend tt-legend">${items.map(key).join('')}</div>`;
}

/**
 * TimeTrack: the axis, the rows, the legend and Show N more.
 * @param {object} o
 * @param {string} o.label
 * @param {{x:number, label:string}[]} o.ticks
 * @param {number} o.days   faint day lines
 * @param {{id:string, mark:string, title:string, sub:string, bar:string, label:string, attrs?:object}[]} o.rows
 * @param {string} [o.legend]  markLegend's markup
 * @param {{n:number, attrs?:object}|null} [o.more]
 */
export function timeTrack({ label, ticks, days, rows, legend = '', more = null }) {
  const axis = `<div class="tt-axis" aria-hidden="true"><span></span><div class="tt-ticks">${ticks.map((t) => `<span class="tt-tick" style="left:${pct(t.x)}">${esc(t.label)}</span>`).join('')}</div></div>`;
  const row = (r) => `<div class="tt-row"${attrs({ 'data-tt-row': r.id })}><button type="button" class="tt-open"${attrs({ 'aria-label': r.label, ...(r.attrs || {}) })}>${r.mark}<span class="tt-t"><span class="tt-title">${esc(r.title)}</span><span class="tt-sub">${esc(r.sub)}</span></span></button><div class="tt-lane">${r.bar}</div></div>`;
  return `<div class="tt" role="group"${attrs({ 'aria-label': label, style: `--tt-days:${days}` })}>${axis}${rows.map(row).join('')}${legend}${more ? `<p class="tt-more">${textLink({ label: `Show ${more.n} more`, attrs: more.attrs || {} })}</p>` : ''}</div>`;
}
