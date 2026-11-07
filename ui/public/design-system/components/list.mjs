// ListRow and List (docs/rail/components.md: "A list of things"; Patterns › A list).
// A row is one thing: its state mark on the rail (hanging left of the text edge, so every title starts on the page's
// text edge), a title line, a meta line, and at its right a figure or time and the row's ⋯. The whole row opens its
// one target. Rows are split by space; a list grouped by something draws one line where each group after the first
// starts, from the text edge. Never a box per item.
import { attrs, esc } from './html.mjs';
import { button } from './button.mjs';
import { compactMenu } from './compact-menu.mjs';
import { row } from './row.mjs';
import { checkbox } from './checkbox.mjs';
import { icon } from './icons.mjs';

/**
 * The ⋯ that holds a thing's own actions: a quiet icon button and, when open, its CompactMenu at the right.
 * A pick reports `data-menu-pick="<id>|<item>"`.
 * @param {object} o
 * @param {string} o.id        the menu's id (data-menu)
 * @param {string} o.label     what it is for ("More for Bug fix")
 * @param {string} o.icon      the ⋯ SVG
 * @param {(string|object)[]} o.items   the actions, a word or a MenuItem; Remove, Revoke, Delete, Uninstall and Reject come last, after one rule
 * @param {boolean} [o.open]
 */
export function moreMenu({ id, label, icon, items, open = false }) {
  const DANGER = /^(Remove|Revoke|Delete|Uninstall|Reject)$/;
  const item = (x) => (typeof x === 'string' ? { text: x, danger: DANGER.test(x) } : x);
  const all = items.map(item), sorted = [...all.filter((x) => !x.danger), ...all.filter((x) => x.danger)];
  const its = sorted.map((x) => (x.sep ? x : { ...x, id: `${id}|${x.id || x.text}` }));
  return `<span class="rc-pop is-right">${button({ label, kind: 'quiet', iconOnly: true, title: false, icon, attrs: { 'data-menu': id, 'aria-haspopup': 'menu', 'aria-expanded': String(open) } })}${open ? compactMenu({ items: its }) : ''}</span>`;
}

/**
 * ListRow.
 * @param {object} o
 * @param {string} o.title          the thing's name
 * @param {string} [o.meta]         one line of facts, as text ("Any project · Fix workflow · updated 3 Oct")
 * @param {string} [o.mark]         the rail mark's markup (a statusDot, a kind icon); empty for a thing with no state
 * @param {string} [o.end]          at the right: a figure or time (text), then the row's ⋯ (markup)
 * @param {string} [o.endText]      a figure or time, as text
 * @param {object} [o.open]         the row's one target: attrs on its button (data-open, title); none, a row that only shows
 * @param {object} [o.menu]         its own actions in a ⋯: moreMenu's options
 * @param {object} [o.attrs]        on the row
 * @param {boolean} [o.check]       selecting: is it ticked; its tick box takes the mark's place. Undefined: not selecting
 * @param {string} [o.boxAttrs]     the tick box's attrs
 * @param {string} [o.lead]         before the title: a chat's origin logo (markup)
 * @param {boolean} [o.unread]
 * @param {boolean} [o.current]     it is the one open now
 * @param {boolean} [o.holds]       a folded group holding the one open now
 * @param {boolean} [o.flash]       it just landed here: lights once
 * @param {string} [o.after]        under the row, in its text column: members, rounds (markup)
 * @param {{open:boolean, attrs?:object, help?:string}} [o.fold]  a record's own fine-tuning: Customise shows `after`, Done hides it
 */
export function listRow({ title, meta = '', mark = '', end = '', endText = '', open = null, menu = null, attrs: a = {}, check, boxAttrs = {}, lead = '', unread = false, current = false, holds = false, flash = false, after = '', fold = null }) {
  const body = `<span class="lr-t">${lead}${esc(title)}</span>${meta ? `<span class="lr-m">${esc(meta)}</span>` : ''}`;
  const main = open ? `<button type="button" class="lr-main"${attrs(open)}>${body}</button>` : `<span class="lr-main">${body}</span>`;
  const more = menu ? moreMenu(menu) : '';
  const rail = check === undefined ? mark : checkbox({ cls: 'lr-check', why: 'Select', checked: !!check, attrs: { 'aria-label': `Select ${title}`, ...boxAttrs } });
  const foldBtn = fold ? button({ label: fold.open ? 'Done' : 'Customise', kind: 'quiet', attrs: { 'aria-expanded': String(!!fold.open), title: fold.help || null, ...(fold.attrs || {}) } }) : '';
  const shown = !fold || fold.open ? after : '';
  const state = [unread && 'is-unread', current && 'is-current', holds && 'is-holds', flash && 'is-flash', check && 'is-sel'].filter(Boolean).join(' ');
  return row({ kind: 'list', rail, text: main, cls: state, end: `${endText ? `<span class="lr-fig">${esc(endText)}</span>` : ''}${foldBtn}${end}`, more, attrs: current ? { 'aria-current': 'true', ...a } : a, after: shown ? `<div class="lr-after">${shown}</div>` : '' });
}

/**
 * List: its sentence (what it shows), then its groups in a fixed order; an empty group is not drawn; a long group
 * shows its first rows, then Show N more opens the rest in place. A group by date folds: its head is a button with a
 * chevron, and folded it keeps its head and count and hides its rows.
 * @param {object} o
 * @param {string} [o.sentence]   the list's sentence, markup with SentencePickers ("Showing everything from all projects")
 * @param {{title?:string, meta?:string, count?:string|number, chip?:string, rows:string[], more?:{n:number, attrs:object}, fold?:{open:boolean, attrs:object}}[]} o.groups
 * @param {string} [o.empty]      EmptyState markup when every group is empty
 * @param {string} [o.tools]      at the sentence's right: Select all while selecting, the list's ⋯
 * @param {string} [o.foot]       at the list's foot: the SelectionBar
 * @param {object} [o.attrs]
 */
function groupHtml(g) {
  const shut = g.fold && !g.fold.open, n = g.count !== undefined ? ` <span class="n">${esc(g.count)}</span>` : '';
  const head = !g.title ? '' : g.fold
    ? `<h3 class="list-h"><button type="button" class="list-h-b"${attrs({ ...g.fold.attrs, 'aria-expanded': String(!shut), title: shut ? `Shows ${g.title}` : `Folds ${g.title}` })}>${icon('chevron', 10)}${esc(g.title)}</button>${n}${g.chip || ''}</h3>`
    : `<h3 class="list-h">${esc(g.title)}${n}${g.chip || ''}</h3>`;
  if (shut) return `<section class="list-group is-shut">${head}</section>`;
  return `<section class="list-group">${head}${g.meta ? `<p class="list-m">${esc(g.meta)}</p>` : ''}<div class="list-rows">${g.rows.join('')}</div>${g.more ? `<button type="button" class="dc-link list-more"${attrs(g.more.attrs)}>Show ${esc(g.more.n)} more</button>` : ''}</section>`;
}

export function list({ sentence = '', groups, empty = '', tools = '', foot = '', attrs: a = {} }) {
  const shown = groups.filter((g) => g.rows.length);
  const body = shown.length ? shown.map((g) => groupHtml(g)).join('') : empty;
  return `<div class="list"${attrs(a)}>${tools ? `<div class="list-head"><div class="list-sentence">${sentence}</div><span class="list-tools">${tools}</span></div>` : sentence ? `<div class="list-sentence">${sentence}</div>` : ''}${body}${foot}</div>`;
}
