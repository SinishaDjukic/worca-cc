// HeatGrid (docs/rail/look.md › look.heat-grid, slice 10 D14): the team heat grid, Insights' Who spends where.
import { attrs, esc } from './html.mjs';
/**
 * HeatGrid (docs/rail/look.md › look.heat-grid): who spends where. People down the side, the top values of one dimension
 * across, each cell a person's part of a column in ink shades scaled to the largest cell (never a hue). Each cell says
 * its value on hover and focus; a table under it says the same to a screen reader. The cells open nothing.
 * @param {object} o
 * @param {string} o.label                         what it shows, for a screen reader
 * @param {{label:string}[]} o.rows                the people
 * @param {{label:string}[]} o.columns             the values across
 * @param {{value:number, text:string}[][]} o.cells   per row, per column: its number and the number in words ("$186, 21 tasks"); '' reads "none"
 * @param {number} o.max                           the largest cell: the darkest shade
 * @param {string} [o.off]                         why a cell opens nothing, after its words in the tooltip
 */
export function heatGrid({ label, rows, columns, cells, max, off = '' }) {
  const shade = (v) => (v > 0 && max > 0 ? Math.min(4, Math.max(1, Math.ceil((v / max) * 4))) : 0);
  const words = (i, j) => { const x = cells[i]?.[j]; return x && x.value > 0 && x.text ? x.text : 'none'; };
  const say = (i, j) => `${rows[i].label}, ${columns[j].label}: ${words(i, j)}`;
  const head = `<div class="hg-row is-head" aria-hidden="true"><span></span>${columns.map((c) => `<span class="hg-col">${esc(c.label)}</span>`).join('')}</div>`;
  const body = rows.map((r, i) => `<div class="hg-row" aria-hidden="true"><span class="hg-name">${esc(r.label)}</span>${columns.map((_, j) => `<span class="hg-cell is-h${shade(cells[i]?.[j]?.value || 0)}" tabindex="0" role="img"${attrs({ 'aria-label': say(i, j), title: [say(i, j), off].filter(Boolean).join(' · ') })}></span>`).join('')}</div>`).join('');
  return `<div class="heat-grid" role="group" style="--hg-n:${columns.length}"${attrs({ 'aria-label': label })}>${head}${body}${`<table class="bc-table"><caption>${esc(label)}</caption><thead><tr><th scope="col"></th>${columns.map((c) => `<th scope="col">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr><th scope="row">${esc(r.label)}</th>${columns.map((_, j) => `<td>${esc(words(i, j))}</td>`).join('')}</tr>`).join('')}</tbody></table>`}</div>`;
}
