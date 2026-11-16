// Field and Tooltip (docs/stillhet/components.md), and a form's other labelled parts (docs/stillhet/forms.md): PickField (a
// labelled picker shaped like a field), FormGrid (fields in fixed places), FieldFold (a part of a form that opens in
// place) and FormReadback (the one supporting line that reads the choices back).
import { attrs, esc } from './html.mjs';
import { compactMenu } from './compact-menu.mjs';
import { icon } from './icons.mjs';

/**
 * Field: text, a number or a path in a form. 32px; its label above it; its hint, or its error, one line under it.
 * @param {object} o
 * @param {string} o.id
 * @param {string} o.label
 * @param {string} [o.value]
 * @param {string} [o.placeholder]
 * @param {'text'|'number'|'url'|'password'|'date'|'time'} [o.type]   a date or a time is the browser's own picker, so any time can be given
 * @param {boolean} [o.multiline]   a textarea that grows
 * @param {string} [o.hint]
 * @param {string} [o.error]        replaces the hint; the field says it is invalid
 * @param {object} [o.attrs]        on the input
 */
export function field({ id, label, value = '', placeholder = '', type = 'text', multiline = false, hint = '', error = '', quietLabel = false, attrs: a = {} }) {
  const note = error ? `<span class="fld-err" id="${esc(id)}-note" role="alert">${esc(error)}</span>` : hint ? `<span class="fld-hint" id="${esc(id)}-note">${esc(hint)}</span>` : '';
  const common = { id, placeholder: placeholder || null, 'aria-invalid': error ? 'true' : null, 'aria-describedby': note ? id + '-note' : null, ...a };
  const input = multiline ? `<textarea class="textarea"${attrs({ rows: 3, ...common })}>${esc(value)}</textarea>` : `<input class="input"${attrs({ type, value, ...common })}>`;
  return `<div class="fld"><label class="fld-l${quietLabel ? ' is-quiet' : ''}"${attrs({ for: id })}>${esc(label)}</label>${input}${note}</div>`;   // quietLabel: read aloud, not shown, where the row already names it
}

// The root tag's own title, which would make a second tip (small.one-tooltip); its aria-label (the name) stays.
const OWN_TITLE = /\stitle=(?:"[^"]*"|'[^']*'|[^\s>]*)/;

/**
 * Tooltip (OffTip): why a control is off, a cut-off text, an id. The words are the element's title; a disabled control
 * gets a wrapper that carries them, since a disabled button shows no tooltip of its own in every browser. Exactly one
 * title results, and it is `text`, the detailed tip: the control's own title gives way (small.one-tooltip).
 * @param {object} o
 * @param {string} o.text      the tooltip
 * @param {string} o.html      the control's markup
 * @param {boolean} [o.off]    the control is disabled: wrap it so the tooltip still shows
 */
export function tooltip({ text, html, off = false }) {
  const bare = html.replace(/^<\w+[^>]*>/, (tag) => tag.replace(OWN_TITLE, ''));
  return off ? `<span class="tip-wrap"${attrs({ title: text, tabindex: '0' })}>${bare}</span>` : bare.replace(/^<(\w+)/, (m) => `${m}${attrs({ title: text })}`);
}

/**
 * PickField: a choice in a form, as a labelled field (form.fields; from classic's labelled selects). Its label above
 * it, then a button shaped like a field that holds the chosen words and a chevron; its menu opens under it and floats
 * over the form. It fills its place in the grid and its value cuts short, so a pick never moves another field.
 * The button reports `data-menu="<id>"`; a pick reports `data-menu-pick="<id>|<item>"`, as a SentencePicker does.
 * @param {object} o
 * @param {string} o.id
 * @param {string} o.label
 * @param {string} o.text        the chosen words, said in full: never a bare "Default"
 * @param {object[]} [o.items]   CompactMenu items; a choice carries `checked`
 * @param {boolean} [o.open]
 * @param {string} [o.hint]      one line under it
 * @param {string} [o.error]     replaces the hint
 * @param {string} [o.tip]
 * @param {boolean} [o.disabled] it cannot be changed here; `tip` says why
 * @param {string} [o.openSub]   the open group's id (comp.menu-sub)
 * @param {boolean} [o.quietLabel]  read aloud, not shown: inside a FieldPair, whose label names both
 */
export function pickField({ id, label, text, items = [], open = false, hint = '', error = '', tip = '', disabled = false, openSub = '', quietLabel = false }) {
  const prefix = (list) => list.map((it) => (it.sep || it.header ? it : it.sub ? { ...it, id: it.id ?? it.text, sub: prefix(it.sub) } : { ...it, id: `${id}|${it.id ?? it.text}` }));
  const note = error ? `<span class="fld-err" id="${esc(id)}-note" role="alert">${esc(error)}</span>` : hint ? `<span class="fld-hint" id="${esc(id)}-note">${esc(hint)}</span>` : '';
  const menu = open && !disabled ? compactMenu({ items: prefix(items), cls: 'spick-menu fld-pick-menu', openSub }) : '';
  const btn = `<button type="button" class="pd-base is-words is-field fld-pick-b"${attrs({ id: `${id}-b`, 'data-menu': id, 'data-key': 'pick:' + id, 'aria-haspopup': 'menu', 'aria-expanded': String(open && !disabled), 'aria-label': `${label}: ${text}`, 'aria-describedby': note ? id + '-note' : null, title: tip || (String(text).length > 24 ? text : null), disabled })}><span class="fld-pick-t">${esc(text)}</span>${icon('chevron', 12)}</button>`;
  return `<div class="fld fld-pick">${quietLabel ? '' : `<span class="fld-l" aria-hidden="true">${esc(label)}</span>`}<span class="spick fld-spick">${btn}${menu}</span>${note}</div>`;
}

/**
 * FormGrid: a form's fields in fixed places: two columns that stack to one on a narrow screen. A field given in
 * `wide` takes the whole row (the text, a note).
 * @param {object} o
 * @param {(string|{html:string, wide?:boolean})[]} o.fields  each field's markup
 */
export function formGrid({ fields = [] }) {
  return `<div class="fld-grid">${fields.filter(Boolean).map((f) => (typeof f === 'string' ? `<div class="fld-cell">${f}</div>` : f.html ? `<div class="fld-cell${f.wide ? ' is-wide' : ''}">${f.html}</div>` : '')).join('')}</div>`;
}

/**
 * FieldFold: a part of a form that opens in place ("More options"). Closed, it is one bordered button with its chevron;
 * open, the same border holds its fields under the button, so what opened is seen to belong to it.
 * @param {object} o
 * @param {string} o.label
 * @param {boolean} [o.open]
 * @param {string} [o.says]    while closed: what is inside, in a few words
 * @param {string} [o.body]    markup: its fields, drawn while open
 * @param {object} [o.attrs]   on the button
 */
export function fieldFold({ label, open = false, says = '', body = '', attrs: a = {} }) {
  return `<div class="fld-fold${open ? ' is-open' : ''}"><button type="button" class="fld-fold-b"${attrs({ 'aria-expanded': String(open), ...a })}>${icon(open ? 'chevron' : 'chevR', 12)}<span class="fld-fold-l">${esc(label)}</span>${!open && says ? `<span class="fld-fold-s">${esc(says)}</span>` : ''}</button>${open ? `<div class="fld-fold-body">${body}</div>` : ''}</div>`;
}

/**
 * FormReadback: the one short line under a form's fields that reads the choices back ("Starts now on billing-api, then
 * opens a PR"). It explains, in the secondary text style; it is never a control.
 * @param {string} text
 */
export const formReadback = (text) => (text ? `<p class="fld-read" role="status">${esc(text)}</p>` : '');

/**
 * FieldPair: two fields that are one choice (Engine and model; a date and a time), under one label, side by side in
 * one place of the grid. Each field inside keeps its own name for a screen reader (`quietLabel`).
 * @param {object} o
 * @param {string} o.label
 * @param {string[]} o.fields  markup: Fields or PickFields made with `quietLabel`
 * @param {string} [o.hint]
 * @param {'first'|'second'} [o.wider]  the field that holds the longer value takes more of the place
 */
export function fieldPair({ label, fields = [], hint = '', wider = '' }) {
  return `<div class="fld fld-pair${wider === 'first' ? ' is-first' : wider === 'second' ? ' is-second' : ''}" role="group"${attrs({ 'aria-label': label })}><span class="fld-l" aria-hidden="true">${esc(label)}</span><div class="fld-pair-in">${fields.filter(Boolean).join('')}</div>${hint ? `<span class="fld-hint">${esc(hint)}</span>` : ''}</div>`;
}

/**
 * FieldValue: a fact on an inspect view, in the place a field would have: its label over its value. It is read, not
 * changed: no border, no chevron, nothing to press. A long value wraps (`lines` clamps a text to that many lines).
 * @param {object} o
 * @param {string} o.label
 * @param {string} o.value     markup-free
 * @param {string} [o.hint]    one line under it
 */
export function fieldValue({ label, value, hint = '' }) {
  return `<div class="fld fld-value"><span class="fld-l">${esc(label)}</span><span class="fld-v">${esc(value)}</span>${hint ? `<span class="fld-hint">${esc(hint)}</span>` : ''}</div>`;
}

