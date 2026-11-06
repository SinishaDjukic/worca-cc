// Toast (docs/rail/components.md): says what just happened, once, and goes; it never holds a
// decision. The error toast is for a break nobody planned for: what happened, that the work goes on, and its actions.
import { attrs, esc } from './html.mjs';

/** The page's one live toast; empty, it takes no room. */
export const toast = ({ text = '', on = !!text } = {}) => `<div class="rc-toast${on ? ' is-on' : ''}" role="status" aria-live="polite">${esc(text)}</div>`;

/**
 * @param {object} o
 * @param {string} o.title     "Something went wrong"
 * @param {string} o.text      what still works
 * @param {string} o.icon      the alert icon's SVG markup
 * @param {string} [o.count]   how many times it happened (a repeat counts, never a second toast)
 * @param {string} [o.actions] the buttons' markup
 * @param {string} [o.close]   the close button's markup
 */
export function errorToast({ title, text, icon, count = '', actions = '', close = '' }) {
  const n = count && +count > 1 ? ` <span class="badge"${attrs({ title: `It happened ${count} times` })}>${esc(count)}</span>` : '';
  return `<div class="toasts"><div class="toast err" role="alert"><span class="ti">${icon}</span><span class="tb"><span class="tt">${esc(title)}${n}</span><span class="td">${esc(text)}</span>${actions ? `<span class="el-acts">${actions}</span>` : ''}</span>${close}</div></div>`;
}

/** Undo inside the toast: puts back what the step just did. */
export const toastUndo = ({ title = '', attrs: a = {} } = {}) => `<button type="button" class="pz-undo"${attrs({ 'data-undo': true, title: title || null, ...a })}>Undo</button>`;
