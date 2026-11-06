// A settings tab (docs/rail/build.md: "A settings tab"): sections of rows, each row its
// name, one sentence, and what acts on it at the right. The components own the alignment, so no page draws it by hand:
// every text starts on one left edge (the dividers too), every action ends on one right edge (a quiet button's text,
// not its padding), and the name, the sentence and the actions share one baseline. Under 560px of width a row stacks.
import { attrs, esc } from './html.mjs';
import { compactMenu } from './compact-menu.mjs';
import { button } from './button.mjs';

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
 */
export function sentencePicker({ id, text, items, open = false, tip = '', chevron = '', right = false }) {
  const its = items.map((it) => (it.sep || it.header ? it : { ...it, id: `${id}|${it.id ?? it.text}` }));
  return `<span class="spick"><button type="button" class="spick-b"${attrs({ 'data-menu': id, 'data-key': 'pick:' + id, 'aria-haspopup': 'menu', 'aria-expanded': String(open), title: tip || null })}>${esc(text)}${chevron}</button>${open ? compactMenu({ items: its, cls: 'spick-menu' + (right ? ' is-right' : '') }) : ''}</span>`;
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
 * SettingsRow: the name, one sentence, and its end (a Switch, a button, Changed). `detail` opens under the sentence.
 * @param {object} o
 * @param {string} o.name
 * @param {string} [o.sentence] markup: escaped words and SentencePickers
 * @param {string} [o.end]      markup at the right: a Switch, buttons
 * @param {boolean} [o.changed] differs from its group or default: says Changed
 * @param {string} [o.help]     the name's tooltip
 * @param {string} [o.detailRows] SettingsRows that open under the sentence (the row's fine-tuning)
 * @param {string} [o.detail]   other markup that opens after them (a List of records)
 * @param {string} [o.detailAction] one quiet button under them, on the folded rows' edge ("Back to the group")
 * @param {{open:boolean, attrs?:object, help?:string}} [o.fold]  the row's fine-tuning: Customise opens it, Done closes it
 * @param {object} [o.attrs]
 */
export function settingsRow({ name, sentence = '', end = '', changed = false, help = '', detailRows = '', detail = '', detailAction = '', fold = null, attrs: a = {} }) {
  const foldBtn = fold ? button({ label: fold.open ? 'Done' : 'Customise', kind: 'quiet', attrs: { 'aria-expanded': String(!!fold.open), title: fold.help || null, ...(fold.attrs || {}) } }) : '';
  const all = (detailRows ? `<div class="set-rows">${detailRows}</div>` : '') + detail + (detailAction ? `<div class="set-foot">${detailAction}</div>` : '');
  const shown = fold ? (fold.open ? all : '') : all;
  return `<div class="set-row"${attrs(a)}><span class="set-name"${attrs({ title: help || null })}>${esc(name)}</span><span class="set-text">${sentence}</span><span class="set-end">${changed ? '<span class="set-changed">Changed</span>' : ''}${end}${foldBtn}</span>${shown ? `<div class="set-detail" data-motion="open">${shown}</div>` : ''}</div>`;
}

/**
 * SettingsSection: a head (and the one action on the whole section, such as a reset), then its rows.
 * @param {object} o
 * @param {string} o.title
 * @param {string} o.rows      SettingsRow markup
 * @param {string} [o.action]  a quiet button at the head's right
 * @param {string} [o.meta]    one line under the head
 * @param {object} [o.attrs]
 */
export function settingsSection({ title, rows, action = '', meta = '', attrs: a = {} }) {
  return `<section class="set-sec"${attrs(a)}><div class="set-sec-head"><h2 class="set-sec-h">${esc(title)}</h2>${action}</div>${meta ? `<p class="set-sec-meta">${esc(meta)}</p>` : ''}<div class="set-rows">${rows}</div></section>`;
}
