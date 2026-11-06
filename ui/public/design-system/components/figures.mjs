// Figures (docs/rail/components.md): the few numbers of a thing (time, cost against its budget,
// the diff), one line, the value bold. A figure with a home opens it.
import { attrs, esc } from './html.mjs';

/**
 * One figure.
 * @param {object} o
 * @param {string} o.k          its name ("Cost")
 * @param {string} o.v          its value ("$4.10")
 * @param {string} [o.of]       against what ("of $10")
 * @param {boolean} [o.warn]    `of` is near its limit
 * @param {string} [o.title]    the tooltip
 * @param {string} [o.tab]      the tab it opens
 * @param {boolean} [o.current] that tab is open
 * @param {{open?:boolean, html?:string, attrs?:object}} [o.pop]  the figure opens its detail in place (Cost by stage):
 *   `html` is the open panel, `attrs` the trigger's hooks
 */
export function figure({ k, v, of = '', warn = false, title, tab, current = false, pop }) {
  const ofHtml = of ? `<span class="rc-of${warn ? ' is-warn' : ''}">${esc(of)}</span>` : '';
  if (pop) return `<span class="rc-pop"><button type="button" class="rc-fig-link"${attrs({ ...pop.attrs, 'aria-haspopup': 'dialog', 'aria-expanded': String(!!pop.open), title: title ?? '' })}>${esc(k)} <b>${esc(v)}</b></button>${ofHtml}${pop.open ? pop.html || '' : ''}</span>`;
  if (tab) return `<button type="button" class="rc-fig-link"${attrs({ 'data-tab': tab, 'data-key': 'fig:' + tab, title: title || 'Open ' + tab, 'aria-current': current ? 'true' : null })}>${esc(k)}<b>${esc(v)}</b></button>`;
  return `<span${attrs({ title })}>${esc(k)} <b>${esc(v)}</b>${ofHtml}</span>`;
}

/** The figures line; each entry is figure() markup (or a figure that opens a picker, built by the page). */
export const figures = (parts) => `<div class="rc-figs">${parts.join('')}</div>`;

/**
 * What a figure opens: its parts, the total, one line of help.
 * @param {object} o
 * @param {string} o.label             the head and the name ("Cost by stage")
 * @param {[string,string][]} o.rows   name, figure
 * @param {string} o.total
 * @param {string} [o.help]
 */
export function figureBreakdown({ label, rows, total, help = '' }) {
  return `<div class="menu rc-cost" role="dialog" data-motion="in"${attrs({ 'aria-label': label })}><p class="menu-h">${esc(label)}</p><ul>${rows.map(([k, v]) => `<li><span>${esc(k)}</span><span class="ct">${esc(v)}</span></li>`).join('')}<li class="is-total"><span>Total</span><span class="ct">${esc(total)}</span></li></ul><p class="menu-help">${esc(help)}</p></div>`;
}
