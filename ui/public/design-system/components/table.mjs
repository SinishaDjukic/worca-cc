// Table (docs/rail/components.md): the same figures across many rows. Divided rows, tabular figures, no box per row, the
// name first; on a narrow screen a column marked `narrow: false` moves to the row's detail line.
import { esc, attrs, cls } from './html.mjs';

/**
 * @param {object} o
 * @param {string} o.label
 * @param {{id:string, label:string, num?:boolean, narrow?:boolean, bare?:boolean}[]} o.columns  the first is the name; `bare`: a sentence on the detail line, without its label
 * @param {Record<string,string|number>[]} o.rows
 * @param {object} [o.attrs]
 */
export function table({ label, columns, rows, attrs: a = {} }) {
  const cell = (c, v, tag) => `<${tag} class="${cls('rt-c', c.num && 'is-num', c.narrow === false && 'is-wide')}">${esc(v ?? '')}</${tag}>`;
  const drop = columns.filter((c) => c.narrow === false);
  return `<div class="rt-wrap"${attrs(a)}><table class="rt" aria-label="${esc(label)}"><thead><tr>${columns.map((c) => cell(c, c.label, 'th')).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${columns.map((c, i) => (i === 0 && drop.length
    ? `<td class="rt-c"><span class="rt-name">${esc(r[c.id] ?? '')}</span><span class="rt-detail">${drop.map((d) => `${d.bare ? '' : `${esc(d.label)} `}${esc(r[d.id] ?? '')}`).join(' · ')}</span></td>`
    : cell(c, r[c.id], 'td'))).join('')}</tr>`).join('')}</tbody></table></div>`;
}
