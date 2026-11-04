// Field and Tooltip (docs/design-system.md › Field; Worca Rail › Which component).
import { attrs, esc } from './html.mjs';

/**
 * Field: text, a number or a path in a form. 32px; its label above it; its hint, or its error, one line under it.
 * @param {object} o
 * @param {string} o.id
 * @param {string} o.label
 * @param {string} [o.value]
 * @param {string} [o.placeholder]
 * @param {'text'|'number'|'url'|'password'} [o.type]
 * @param {boolean} [o.multiline]   a textarea that grows
 * @param {string} [o.hint]
 * @param {string} [o.error]        replaces the hint; the field says it is invalid
 * @param {object} [o.attrs]        on the input
 */
export function field({ id, label, value = '', placeholder = '', type = 'text', multiline = false, hint = '', error = '', attrs: a = {} }) {
  const note = error ? `<span class="fld-err" id="${esc(id)}-note" role="alert">${esc(error)}</span>` : hint ? `<span class="fld-hint" id="${esc(id)}-note">${esc(hint)}</span>` : '';
  const common = { id, placeholder: placeholder || null, 'aria-invalid': error ? 'true' : null, 'aria-describedby': note ? id + '-note' : null, ...a };
  const input = multiline ? `<textarea class="textarea"${attrs({ rows: 3, ...common })}>${esc(value)}</textarea>` : `<input class="input"${attrs({ type, value, ...common })}>`;
  return `<div class="fld"><label class="fld-l"${attrs({ for: id })}>${esc(label)}</label>${input}${note}</div>`;
}

/**
 * Tooltip: why a control is off, a cut-off text, an id. The words are the element's title; a disabled control gets a
 * wrapper that carries them, since a disabled button shows no tooltip of its own in every browser.
 * @param {object} o
 * @param {string} o.text      the tooltip
 * @param {string} o.html      the control's markup
 * @param {boolean} [o.off]    the control is disabled: wrap it so the tooltip still shows
 */
export function tooltip({ text, html, off = false }) {
  return off ? `<span class="tip-wrap"${attrs({ title: text, tabindex: '0' })}>${html}</span>` : html.replace(/^<(\w+)/, (m) => `${m}${attrs({ title: text })}`);
}
