// A settings tab (docs/rail/settings.md: "A settings tab"): sections of rows, each row its
// name, one sentence, and what acts on it at the right. The components own the alignment, so no page draws it by hand:
// every text starts on one left edge (the dividers too), every action ends on one right edge (a quiet button's text,
// not its padding), and the name, the sentence and the actions share one baseline. Under 560px of width a row stacks.
import { attrs, esc } from './html.mjs';
import { compactMenu } from './compact-menu.mjs';
import { button } from './button.mjs';
import { row } from './row.mjs';

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
 * @param {string} [o.openSub] the open group's id: a group's items open in place (comp.menu-sub); a sub pick reports `<id>|<value>` too
 */
export function sentencePicker({ id, text, items = [], open = false, tip = '', chevron = '', right = false, body = '', openSub = '' }) {
  const prefix = (list) => list.map((it) => (it.sep || it.header ? it : it.sub ? { ...it, id: it.id ?? it.text, sub: prefix(it.sub) } : { ...it, id: `${id}|${it.id ?? it.text}` }));   // an opener keeps its raw id (comp.menu-sub)
  const its = prefix(items);
  const pop = body ? body.replace(/^<div class="menu /, `<div class="menu spick-menu${right ? ' is-right' : ''} `) : compactMenu({ items: its, cls: 'spick-menu' + (right ? ' is-right' : ''), openSub });
  return `<span class="spick"><button type="button" class="spick-b"${attrs({ 'data-menu': id, 'data-key': 'pick:' + id, 'aria-haspopup': body ? 'dialog' : 'menu', 'aria-expanded': String(open), title: tip || null })}>${esc(text)}${chevron}</button>${open ? pop : ''}</span>`;
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
 * tooltip says Changed, then a line per value with its default (docs/rail/settings.md: `set.changed`). No reset here.
 * @param {true|{name:string, was:string}[]} [changes]  each changed value and its default words; `true` when none can be named
 */
export function changedDot(changes) {
  if (!changes || changes.length === 0) return '';
  const lines = ['Changed', ...(changes === true ? [] : changes.map((c) => `${c.name}: default ${c.was}`))];
  return `<span class="set-dot" role="img"${attrs({ title: lines.join('\n'), 'aria-label': lines.join('. ') })}></span>`;
}

/**
 * SettingsRow: the name (and its ChangedDot), one sentence, and its end (a Switch, a button). `detail` opens under the sentence.
 * @param {object} o
 * @param {string} o.name
 * @param {string} [o.sentence] markup: escaped words and SentencePickers
 * @param {string} [o.end]      markup at the right: a Switch, buttons
 * @param {boolean|{name:string, was:string}[]} [o.changed] what differs from its group or default, folded rows' values too: the ChangedDot
 * @param {string} [o.help]     the name's tooltip
 * @param {string} [o.detailRows] SettingsRows that open under the sentence (the row's fine-tuning)
 * @param {string} [o.detail]   other markup that opens after them (a List of records)
 * @param {string} [o.detailAction] one quiet button under them, on the folded rows' edge ("Back to the group")
 * @param {{open:boolean, label?:string, attrs?:object, help?:string}} [o.fold]  the row's fine-tuning: Customise opens it, Done closes it; `label` names what it holds when that is not fine-tuning (Paired browsers)
 * @param {object} [o.attrs]
 */
export function settingsRow({ name, sentence = '', end = '', changed = false, help = '', detailRows = '', detail = '', detailAction = '', fold = null, attrs: a = {} }) {
  const foldBtn = fold ? button({ label: fold.open ? 'Done' : fold.label || 'Customise', kind: 'quiet', attrs: { 'aria-expanded': String(!!fold.open), title: fold.help || null, ...(fold.attrs || {}) } }) : '';
  const all = (detailRows ? `<div class="set-rows">${detailRows}</div>` : '') + detail + (detailAction ? `<div class="set-foot">${detailAction}</div>` : '');
  const shown = fold ? (fold.open ? all : '') : all;
  return row({ kind: 'setting', text: `<span class="set-name"${attrs({ title: help || null })}>${esc(name)}${changedDot(changed)}</span><span class="set-text">${sentence}</span>`, end: `${foldBtn}${end}`, after: shown ? `<div class="set-detail" data-motion="open">${shown}</div>` : '', attrs: a });
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
