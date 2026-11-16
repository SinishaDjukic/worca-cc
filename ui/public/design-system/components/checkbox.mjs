// Checkbox (docs/stillhet/components.md): picking items from a list, an opt-out, a consent.
import { esc, attrs, cls } from './html.mjs';

/**
 * @param {object} o
 * @param {string} [o.label]     the words beside it (markup-free); none when the row beside it names it (`aria-label` in attrs)
 * @param {string} [o.html]      words that hold a Text link or a second line: markup, in a span
 * @param {boolean} [o.checked]
 * @param {boolean} [o.disabled]
 * @param {string} [o.help]      one line of help under the label (an option in a form): what turning it on does
 * @param {string} [o.why]       the tooltip; when disabled, why
 * @param {string} [o.cls]       the label's class (pd-check by default)
 * @param {object} [o.attrs]     on the input
 */
export function checkbox({ label = '', html = '', help = '', checked = false, disabled = false, why = '', cls: c = 'pd-check', attrs: a = {} }) {
  if (help) return `<label class="${cls(c, 'has-help')}"${attrs({ title: why || null })}><input type="checkbox"${attrs({ ...a, checked, disabled })}><span class="pd-check-w"><span class="pd-check-l">${esc(label)}</span><span class="pd-check-h">${esc(help)}</span></span></label>`;
  return `<label class="${cls(c)}"${attrs({ title: why || null })}><input type="checkbox"${attrs({ ...a, checked, disabled })}>${html ? `<span>${html}</span>` : label ? ' ' + esc(label) : ''}</label>`;
}
