// A settings tab (docs/stillhet/settings.md: "A settings tab"): sections of rows, each row its
// name, its value with one supporting line, and what acts on it at the right. The components own the alignment, so no page draws it by hand:
// every text starts on one left edge (the dividers too), every action ends on one right edge (a quiet button's text,
// not its padding), and the name, the sentence and the actions share one baseline. Under 560px of width a row stacks.
import { attrs, esc } from './html.mjs';
import { compactMenu } from './compact-menu.mjs';
import { button } from './button.mjs';
import { tooltip } from './field.mjs';
import { row } from './row.mjs';
import { icon } from './icons.mjs';

/**
 * SentencePicker: the chosen words inside the sentence they change; a CompactMenu opens under them. It keeps the
 * sentence's line: no padding, the sentence's own font and line height, the hover tint drawn outside the text.
 * A pick reports `data-menu-pick="<id>|<value>"`.
 * @param {object} o
 * @param {string} o.id        the picker's id (data-menu)
 * @param {string} o.text      the chosen words
 * @param {import('./compact-menu.mjs').MenuItem[]} o.items  the choices; each `id` is its value
 * @param {boolean} [o.open]
 * @param {string} [o.tip]     what the choice decides (the tooltip)
 * @param {string} [o.chevron] the ▾ icon's SVG
 * @param {boolean} [o.right]  the menu opens to the left (a picker at the row's end)
 * @param {string} [o.body]    in place of a menu, what opens under it (a ListEditor: find or make one)
 * @param {string} [o.label]   the button's accessible name, when the words alone do not say what they choose
 * @param {string} [o.openSub] the open group's id: a group's items open in place (comp.menu-sub); a sub pick reports `<id>|<value>` too
 */
export function sentencePicker({ id, text, items = [], open = false, tip = '', chevron = '', right = false, body = '', label = '', openSub = '' }) {
  const prefix = (list) => list.map((it) => (it.sep || it.header ? it : it.sub ? { ...it, id: it.id ?? it.text, sub: prefix(it.sub) } : { ...it, id: `${id}|${it.id ?? it.text}` }));   // an opener keeps its raw id (comp.menu-sub)
  const its = prefix(items);
  const pop = body ? body.replace(/^<div class="menu /, `<div class="menu spick-menu${right ? ' is-right' : ''} `) : compactMenu({ items: its, cls: 'spick-menu' + (right ? ' is-right' : ''), openSub });
  return `<span class="spick"><button type="button" class="spick-b"${attrs({ 'data-menu': id, 'data-key': 'pick:' + id, 'aria-haspopup': body ? 'dialog' : 'menu', 'aria-expanded': String(open), title: tip || null, 'aria-label': label || null })}>${esc(text)}${chevron}</button>${open ? pop : ''}</span>`;
}

/**
 * WordPicker: a picker among a form's or a panel's words (the base branch, the remote, how many PRs), its menu under it.
 * @param {object} o
 * @param {string} o.text        the chosen words
 * @param {string} o.chevron     its ▾'s SVG
 * @param {boolean} [o.open]
 * @param {string} [o.menuHtml]  the CompactMenu, when open
 * @param {string} [o.tip]
 * @param {string} [o.cls]       the button's hook class (pd-ship, is-words)
 * @param {string} [o.wrapCls]   what holds it and its menu
 * @param {object} [o.attrs]     data-menu, data-key
 */
export function wordPicker({ text, chevron, open = false, menuHtml = '', tip = '', cls = '', wrapCls = 'rc-pop pd-basepop', attrs: a = {} }) {
  return `<span class="${wrapCls}"><button type="button" class="pd-base${cls ? ' ' + cls : ''}"${attrs({ ...a, 'aria-haspopup': 'menu', 'aria-expanded': String(open), title: tip || null })}>${esc(text)}${chevron}</button>${menuHtml}</span>`;
}

/**
 * Switch: on or off, at once.
 * @param {object} o
 * @param {boolean} o.on
 * @param {string} o.label     what it turns on (aria-label)
 * @param {string} [o.why]     the tooltip; when disabled, why
 * @param {boolean} [o.disabled]
 * @param {object} [o.attrs]
 */
export function switchButton({ on, label, why = '', disabled = false, attrs: a = {} }) {
  return `<button type="button" class="switch" role="switch"${attrs({ 'aria-checked': String(!!on), 'aria-label': label, title: why || null, disabled, ...a })}></button>`;
}

/**
 * ChangedDot: a value in this row differs from Worca's default. A tiny neutral dot right after the row's name; its
 * tooltip says Changed, then a line per value with its default (docs/stillhet/settings.md: `set.changed`). No reset here.
 * @param {true|{name:string, was:string}[]} [changes]  each changed value and its default words; `true` when none can be named
 */
export function changedDot(changes) {
  if (!changes || changes.length === 0) return '';
  const lines = ['Changed', ...(changes === true ? [] : changes.map((c) => `${c.name}: default ${c.was}`))];
  return `<span class="set-dot" role="img"${attrs({ title: lines.join('\n'), 'aria-label': lines.join('. ') })}></span>`;
}

/**
 * RowPicker: a choice among a few values, as a labelled field of fixed width (docs/stillhet/settings.md: the value leads). It
 * stands at a row's end when it is the row's one choice (the row's name is its label), or in the line of pickers under
 * the row's supporting line, each under its own small label. A CompactMenu opens under it; a pick reports
 * `data-menu-pick="<id>|<value>"`, as a SentencePicker's does. Nothing moves when the value changes: the field keeps its
 * width and a long value folds to "…" with the whole value in its tooltip.
 * @param {object} o
 * @param {string} o.id        the picker's id (data-menu)
 * @param {string} o.label     what it chooses: its accessible name, and its visible label with `showLabel`
 * @param {string} o.text      the chosen value, short
 * @param {import('./compact-menu.mjs').MenuItem[]} o.items  the choices; each `id` is its value
 * @param {boolean} [o.open]
 * @param {boolean} [o.showLabel] the label shows above the field (several pickers in one row)
 * @param {string} [o.tip]     what the choice decides (the tooltip)
 * @param {string} [o.chevron] the ▾ icon's SVG
 * @param {boolean} [o.left]   the menu opens from the field's left edge (a picker under the text); else from its right
 * @param {boolean} [o.off]    it shows its value and cannot be changed: no menu hook is written, and `tip` says why
 * @param {string} [o.openSub] the open group's id (comp.menu-sub)
 */
export function rowPicker({ id, label, text, items = [], open = false, showLabel = false, tip = '', chevron = '', left = false, off = false, openSub = '' }) {
  const prefix = (list) => list.map((it) => (it.sep || it.header ? it : it.sub ? { ...it, id: it.id ?? it.text, sub: prefix(it.sub) } : { ...it, id: `${id}|${it.id ?? it.text}` }));
  const pop = open && !off ? compactMenu({ items: prefix(items), cls: 'spick-menu' + (left ? '' : ' is-right'), label, openSub }) : '';
  const field = `<button type="button" class="pd-base is-words is-field set-pick-b"${attrs({ 'data-menu': off ? null : id, 'data-key': 'pick:' + id, 'aria-haspopup': off ? null : 'menu', 'aria-expanded': off ? null : String(!!open), 'aria-label': `${label}: ${text}`, title: tip || (String(text).length > 20 ? text : null), disabled: off })}><span class="set-pick-t">${esc(text)}</span>${chevron}</button>`;
  // off: a disabled button shows no tooltip of its own in every browser, so the OffTip's wrapper carries the reason
  return `<span class="spick set-pick${showLabel ? ' has-label' : ''}">${showLabel ? `<span class="set-pick-l" aria-hidden="true">${esc(label)}</span>` : ''}${off && tip ? tooltip({ text: tip, off: true, html: field }) : field}${pop}</span>`;
}

/**
 * SettingsRow (docs/stillhet/settings.md: the value leads): the name (and its ChangedDot) on the left; then the value,
 * short, in the body style and full ink, with at most one supporting line under it in the secondary style; then its end:
 * a Switch, a RowPicker or a bordered button. A sentence is never the control: what you choose is a labelled picker.
 * A row with more to show (`fold`) clicks as a whole: its line highlights on hover, a chevron at its end turns when it
 * opens, and no word or width changes. What opens sits in a container on the row's line (a 2px line at its left).
 * @param {object} o
 * @param {string} o.name
 * @param {string} [o.value]    markup: the row's value, short ("$1,000 a month")
 * @param {string} [o.note]     markup: one supporting line ("All tasks pause when it is spent")
 * @param {string} [o.sentence] the old name of `note`: a row that only explains itself
 * @param {string} [o.picks]    markup: RowPickers with their labels, in a line under the supporting line (two or more choices)
 * @param {string} [o.end]      markup at the right: a Switch, one RowPicker, buttons
 * @param {boolean|{name:string, was:string}[]} [o.changed] what differs from its group or default, folded rows' values too: the ChangedDot
 * @param {string} [o.help]     the name's tooltip
 * @param {string} [o.detailRows] SettingsRows that open under the row (the row's fine-tuning)
 * @param {string} [o.detail]   other markup that opens after them (a List of records)
 * @param {string} [o.detailAction] one button under them, on the folded rows' edge ("Back to the group")
 * @param {{open:boolean, label?:string, attrs?:object, help?:string}} [o.fold]  the row opens in place: the whole line is its trigger; `label` names what it holds ("Paired browsers") when that is not fine-tuning
 * @param {object} [o.attrs]
 */
export function settingsRow({ name, value = '', note = '', sentence = '', picks = '', end = '', changed = false, help = '', detailRows = '', detail = '', detailAction = '', fold = null, attrs: a = {} }) {
  const say = note || sentence;
  const all = (detailRows ? `<div class="set-rows">${detailRows}</div>` : '') + detail + (detailAction ? `<div class="set-foot">${detailAction}</div>` : '');
  const shown = fold ? (fold.open ? all : '') : all;
  // the whole line is the trigger: one button under the row's words, so the controls at its end stay their own
  const opener = fold ? `<button type="button" class="set-open"${attrs({ 'aria-expanded': String(!!fold.open), 'aria-label': `${name}: ${fold.label || 'more settings'}`, title: fold.help || help || null, ...(fold.attrs || {}) })}></button>` : '';
  const chev = fold ? `<span class="set-chev" aria-hidden="true">${icon('chevR', 14)}</span>` : '';
  const text = `${opener}<span class="set-name"${attrs({ title: fold ? null : help || null })}>${esc(name)}${changedDot(changed)}</span><span class="set-text">${value ? `<span class="set-value">${value}</span>` : ''}${say ? `<span class="set-note">${say}</span>` : ''}${picks ? `<span class="set-picks" role="group"${attrs({ 'aria-label': name })}>${picks}</span>` : ''}</span>`;
  return row({ kind: 'setting', cls: fold ? `is-opens${fold.open ? ' is-open' : ''}` : '', text, end: `${end}${chev}`, after: shown ? `<div class="set-detail" data-motion="open">${shown}</div>` : '', attrs: a });
}

/**
 * SettingsGroup: rows of one kind inside a section (Labs' stages), under a small head on the rows' edge. A record's
 * groups are a List's (list.mjs); this is the same head over SettingsRows.
 * @param {object} o
 * @param {string} o.title
 * @param {string} o.rows      SettingsRow markup
 */
export function settingsGroup({ title, rows }) {
  return `<section class="set-group"><h3 class="list-h">${esc(title)}</h3><div class="set-rows">${rows}</div></section>`;
}

/**
 * SettingsSection: a head (and the one action on the whole section, such as a reset), then its rows.
 * @param {object} o
 * @param {string} [o.title]   none on a tab that is one list: the tab's title already says it
 * @param {string} o.rows      SettingsRow markup
 * @param {string} [o.action]  a quiet button at the head's right
 * @param {string} [o.meta]    one line under the head
 * @param {string} [o.icon]    one small line icon before the head
 * @param {object} [o.attrs]
 */
export function settingsSection({ title = '', rows, action = '', meta = '', icon: mark = '', attrs: a = {} }) {
  return `<section class="set-sec"${attrs(a)}>${title || action ? `<div class="set-sec-head">${title ? `<h2 class="set-sec-h">${mark}${esc(title)}</h2>` : ''}${action}</div>` : ''}${meta ? `<p class="set-sec-meta">${esc(meta)}</p>` : ''}<div class="set-rows">${rows}</div></section>`;
}
