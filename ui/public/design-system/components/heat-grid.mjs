// HeatGrid (docs/stillhet/look.md › look.heat-grid, slice 10 D14): the team heat grid, Insights' Who spends where.
import { attrs, esc } from './html.mjs';
/**
 * HeatGrid (docs/stillhet/look.md › look.heat-grid): who spends where. People down the side, the top values of one dimension
 * across, each cell a person's part of a column in ink shades scaled to the largest cell (never a hue). A cell opens
 * nothing, so it is not drawn as a control: no pointer, no hover fill. It shows its number in a small card on hover, on
 * focus and on tap (a tap focuses it); a table under it says the same to a screen reader. Its legend runs from the
 * weakest shade to the strongest and says so in words that hold in both themes ("stronger", never "darker").
 * @param {object} o
 * @param {string} o.label                         what it shows, for a screen reader
 * @param {{label:string}[]} o.rows                the people
 * @param {{label:string}[]} o.columns             the values across
 * @param {{value:number, text:string, short?:string}[][]} o.cells   per row, per column: its number and the number in words ("$186, 21 tasks"); '' reads "none".
 *   `short` ("$186") is the number the cell shows at rest when it is wide enough, and always on a narrow screen; without it, the words up to their first comma
 * @param {number} o.max                           the largest cell: the strongest shade
 * @param {string} [o.off]                         why a cell opens nothing: one line under the grid
 * @param {string} [o.legend]                      the legend's words; '' draws no legend
 */
export function heatGrid({ label, rows, columns, cells, max, off = '', legend = 'The stronger the cell, the more it spent' }) {
  const shade = (v) => (v > 0 && max > 0 ? Math.min(4, Math.max(1, Math.ceil((v / max) * 4))) : 0);
  const words = (i, j) => { const x = cells[i]?.[j]; return x && x.value > 0 && x.text ? x.text : 'none'; };
  const short = (i, j) => { const x = cells[i]?.[j]; return x && x.value > 0 ? x.short || String(x.text || '').split(',')[0] : ''; };
  const say = (i, j) => `${rows[i].label}, ${columns[j].label}: ${words(i, j)}`;
  const head = `<div class="hg-row is-head" aria-hidden="true"><span></span>${columns.map((c) => `<span class="hg-col">${esc(c.label)}</span>`).join('')}</div>`;
  const edge = (j) => (j === 0 ? ' is-first' : j === columns.length - 1 ? ' is-last' : '');
  const body = rows.map((r, i) => `<div class="hg-row" aria-hidden="true"><span class="hg-name">${esc(r.label)}</span>${columns.map((_, j) => `<span class="hg-cell is-h${shade(cells[i]?.[j]?.value || 0)}${edge(j)}" tabindex="0" role="img"${attrs({ 'aria-label': say(i, j) })}>${short(i, j) ? `<span class="hg-n" aria-hidden="true">${esc(short(i, j))}</span>` : ''}<span class="hg-tip">${esc(words(i, j))}</span></span>`).join('')}</div>`).join('');
  const key = legend ? `<p class="hg-legend"><span aria-hidden="true">Less</span>${[1, 2, 3, 4].map((k) => `<span class="hg-key is-h${k}" aria-hidden="true"></span>`).join('')}<span aria-hidden="true">More</span><span class="hg-legend-t">${esc(legend)}</span></p>` : '';
  const note = off ? `<p class="hg-note">${esc(off)}</p>` : '';
  return `<div class="heat-grid" role="group" style="--hg-n:${columns.length}"${attrs({ 'aria-label': label })}>${head}${body}${`<table class="bc-table"><caption>${esc(label)}</caption><thead><tr><th scope="col"></th>${columns.map((c) => `<th scope="col">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr><th scope="row">${esc(r.label)}</th>${columns.map((_, j) => `<td>${esc(words(i, j))}</td>`).join('')}</tr>`).join('')}</tbody></table>`}</div>${key}${note}`;
}
