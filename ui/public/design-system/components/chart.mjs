// BarChart (docs/rail/look.md › look.chart): one question, one series, one chart. Thin ink bars with 4px rounded ends on
// the baseline and a 2px gap; the period you are in is the darkest; only the highest and the current carry a number;
// each bar says its value on hover and focus; a table under it says the same to a screen reader. No legend for one
// series (the title names it), no grid, no second axis, no colour: colour stays for what needs you.
import { esc } from './html.mjs';

/**
 * @param {object} o
 * @param {string} o.label                    what it shows, for a screen reader: "Spend by day, November"
 * @param {{label:string, value:number, text:string}[]} o.bars   each period: its axis word, its number, the number in words ("$42")
 * @param {number} [o.current]                the index of the period you are in
 * @param {number} [o.height]                 the plot's height in px
 */
export function barChart({ label, bars, current = -1, height = 120 }) {
  const max = Math.max(1, ...bars.map((b) => b.value)), top = bars.findIndex((b) => b.value === max);
  const cols = bars.map((b, i) => {
    const h = Math.max(b.value ? 3 : 0, Math.round((b.value / max) * (height - 18)));
    const shown = i === top || i === current;
    return `<span class="bc-col${i === current ? ' is-now' : ''}" tabindex="0" title="${esc(`${b.label}: ${b.text}`)}"><span class="bc-v">${shown ? esc(b.text) : ''}</span><span class="bc-bar" style="height:${h}px"></span><span class="bc-x">${esc(b.label)}</span></span>`;
  }).join('');
  const table = `<table class="bc-table"><caption>${esc(label)}</caption><tbody>${bars.map((b) => `<tr><th scope="row">${esc(b.label)}</th><td>${esc(b.text)}</td></tr>`).join('')}</tbody></table>`;
  return `<figure class="bar-chart" style="--bc-h:${height}px"><div class="bc-plot" aria-hidden="true">${cols}</div>${table}</figure>`;
}
