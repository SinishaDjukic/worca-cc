// Trail and Pager (docs/rail/navigation.md). The trail goes one depth up (a thing to
// its place, a run to its group): it never names the page itself, and on a narrow screen it is its parent alone,
// ‹ Parent. The pager goes sideways, to a sibling (the next run in a group); one that has not started yet is disabled
// and says why. Both sit in the top bar; the trail is the one way back on screen.
import { attrs, esc } from './html.mjs';
import { button } from './button.mjs';

/**
 * Trail.
 * @param {object} o
 * @param {{label:string, attrs?:object, button?:boolean}[]} o.items  the place first, the parent last; `button` for a
 *   step that acts in the page (a group opened in place), else a link
 * @param {string} [o.label]   aria-label
 */
export function trail({ items, label = 'Breadcrumb' }) {
  const step = (it) => (it.button
    ? `<button type="button" class="rc-crumb"${attrs({ ...(it.attrs || {}), title: it.label })}>${esc(it.label)}</button>`
    : `<a class="rc-crumb"${attrs({ href: it.href || '#', ...(it.attrs || {}), title: it.label })}>${esc(it.label)}</a>`);
  return `<nav class="rc-crumbs"${attrs({ 'aria-label': label })}><ol>${items.map((it, i) => `<li${i === items.length - 1 ? ' class="is-parent"' : ''}>${step(it)}</li>`).join('')}</ol></nav>`;
}

/**
 * Pager.
 * @param {object} o
 * @param {string} o.label            what it pages through (aria-label: "Runs in this group")
 * @param {number} o.index            the current one, from 0
 * @param {number} o.n                how many
 * @param {string} o.noun             one of them ("run"): the buttons are Previous run, Next run
 * @param {{ok:boolean, why?:string, attrs?:object}|null} o.prev
 * @param {{ok:boolean, why?:string, attrs?:object}|null} o.next
 * @param {{prev:string, next:string}} o.icons   the ‹ and › SVGs
 */
export function pager({ label, index, n, noun, prev, next, icons }) {
  const sib = (x, dir) => button({ label: (dir === 'prev' ? 'Previous ' : 'Next ') + noun, kind: 'quiet', iconOnly: true, icon: icons[dir], title: x && !x.ok ? x.why || false : false,
    attrs: { ...((x && x.attrs) || {}), disabled: !(x && x.ok) } });
  return `<span class="rc-pager" role="group"${attrs({ 'aria-label': label })}>${sib(prev, 'prev')}<span class="rc-pager-n">${index + 1} of ${n}</span>${sib(next, 'next')}</span>`;
}
