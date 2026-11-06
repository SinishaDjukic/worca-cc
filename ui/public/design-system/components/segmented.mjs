// Segmented (docs/rail/components.md): two to four views of the same thing, one pressed.
import { attrs, esc } from './html.mjs';

/**
 * @param {object} o
 * @param {string} o.label   the group's name ("Show")
 * @param {{id:string, label:string, pressed?:boolean}[]} o.items
 * @param {string} [o.hook]  the data-* name a pick reports in (data-filter="all"); also the data-key prefix
 */
export function segmented({ label, items, hook = 'seg' }) {
  return `<div class="seg" role="group"${attrs({ 'aria-label': label })}>${items.map((x) => `<button type="button"${attrs({ ['data-' + hook]: x.id, 'data-key': hook + ':' + x.id, 'aria-pressed': String(!!x.pressed) })}>${esc(x.label)}</button>`).join('')}</div>`;
}
