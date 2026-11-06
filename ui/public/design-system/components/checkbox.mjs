// Checkbox (docs/rail/components.md): picking items from a list, an opt-out, a consent.
import { esc, attrs, cls } from './html.mjs';

/**
 * @param {object} o
 * @param {string} o.label       the words beside it (markup-free)
 * @param {boolean} [o.checked]
 * @param {boolean} [o.disabled]
 * @param {string} [o.why]       the tooltip; when disabled, why
 * @param {string} [o.cls]       the label's class (pd-check by default)
 * @param {object} [o.attrs]     on the input
 */
export function checkbox({ label, checked = false, disabled = false, why = '', cls: c = 'pd-check', attrs: a = {} }) {
  return `<label class="${cls(c)}"${attrs({ title: why || null })}><input type="checkbox"${attrs({ ...a, checked, disabled })}> ${esc(label)}</label>`;
}
