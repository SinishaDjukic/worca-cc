// SuggestionField (docs/rail/forms.md): text Worca writes for you. A sparkle inside the field, a Suggested chip, the violet
// shimmer while it writes, and a grey line when it could not; the field then keeps the text it had.
import { esc, attrs, cls } from './html.mjs';
import { icon } from './icons.mjs';

/** The Suggested chip. */
export const suggestedChip = () => '<span class="pd-sug">Suggested</span>';

/** The grey line when Worca could not write it: the text stays, Try again. */
export function suggestionFail({ model = '', retry = {}, cls: c = '', attrs: a = {} }) {
  return `<span class="${cls('pd-fail', c)}" role="status"${attrs(a)}>Could not write it: no answer${model ? ` from ${esc(model)}` : ''} in 20s. The text is as it was. ${failureLink({ label: 'Try again', attrs: retry })}</span>`;
}

/** The way on from a failure's line: Try again, Details. */
export const failureLink = ({ label, attrs: a = {} }) => `<button type="button" class="pd-retry"${attrs(a)}>${esc(label)}</button>`;

/** Write or preview a description: the eye beside its label. */
export const previewToggle = ({ on = false, attrs: a = {} }) => `<button type="button" class="pd-eye${on ? ' is-on' : ''}"${attrs({ ...a, 'aria-pressed': String(on), title: 'Preview', 'aria-label': 'Preview' })}>${icon('eye', 14)}</button>`;

/** The field's text as it will read, in the field's place. */
export const suggestionPreview = ({ html, writing = false }) => `<div class="${cls('pd-adorn', writing && 'is-writing')}"><div class="pd-preview">${html}</div></div>`;

/**
 * @param {object} o
 * @param {string} o.id
 * @param {string} [o.value]
 * @param {string} [o.placeholder]
 * @param {string} [o.writingPlaceholder]  what the field says while Worca writes
 * @param {boolean} [o.writing]            Worca is writing: the shimmer, read only, no text
 * @param {number} [o.rows]                a textarea of this many rows; otherwise one line
 * @param {string} [o.inputCls]
 * @param {object} [o.attrs]               on the input
 * @param {string} [o.act]                 the buttons inside the field (the sparkle, Stop)
 * @param {string} [o.cls]
 */
export function suggestionField({ id, value = '', placeholder = '', writingPlaceholder = '', writing = false, rows = 0, inputCls = '', attrs: a = {}, act = '', cls: c = '' }) {
  const ph = writing && writingPlaceholder ? writingPlaceholder : placeholder;
  const common = attrs({ id, placeholder: ph, ...a, readonly: writing });
  const field = rows
    ? `<textarea class="${cls('textarea', inputCls)}" rows="${rows}"${common}>${writing ? '' : esc(value)}</textarea>`
    : `<input class="${cls('input', inputCls)}" type="text"${attrs({ value: writing ? '' : value })}${common}>`;
  return `<div class="${cls('pd-adorn', writing && 'is-writing', c)}">${field}${act ? `<span class="pd-act">${act}</span>` : ''}</div>`;
}

/** The sparkle inside a field: asks Worca to write it; its tooltip names the helper job. */
export function suggestButton({ tip, label = tip, attrs: a = {} }) {
  return `<button type="button" class="pd-ai"${attrs({ title: tip, 'aria-label': label, ...a })}>${icon('sparkle', 14)}</button>`;
}

/** Stop, while Worca writes. */
export function stopWriting({ attrs: a = {}, size = 12 }) {
  return `<button type="button" class="pd-stop"${attrs({ title: 'Stop', 'aria-label': 'Stop writing', ...a })}>${icon('x', size)}</button>`;
}
