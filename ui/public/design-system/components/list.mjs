// ListRow and List (docs/stillhet/components.md: "A list of things"; Patterns › A list).
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
/** list.news: a mark with the small light dot of new activity on its corner; `need` gives it the level's colour. */
export function newsMark(mark, need = false) {
  return `<span class="lr-news-w">${mark}<span class="lr-news${need ? ' is-need' : ''}" role="img" aria-label="new activity"></span></span>`;
}

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
 * @param {boolean} [o.wrap]        its second line is the news (why it needs you): it wraps to two lines, never cut (list.row-facts)
 * @param {boolean|'need'} [o.news]  list.news: new activity you have not seen; a light dot on its mark (takes the place of `unread`'s bold title)
 * @param {boolean} [o.unread]
 * @param {boolean} [o.current]     it is the one open now
 * @param {boolean} [o.holds]       a folded group holding the one open now
 * @param {boolean} [o.flash]       it just landed here: lights once
 * @param {string} [o.after]        under the row, in its text column: members, rounds (markup)
 * @param {{open:boolean, attrs?:object, help?:string, label?:string}} [o.fold]  a record's own fine-tuning, shown under it: the whole line is the
 *   trigger and a chevron at its end turns, as on a SettingsRow (no word swap). A row that also opens a page keeps its name as the
 *   way there, and the chevron alone is the trigger
 */
export function listRow({ title, meta = '', mark = '', end = '', endText = '', open = null, menu = null, attrs: a = {}, check, boxAttrs = {}, lead = '', unread = false, current = false, holds = false, flash = false, after = '', fold = null, markFold = null, wrap = false, news = false }) {
  const body = `<span class="lr-t">${lead}${esc(title)}</span>${meta ? `<span class="lr-m">${esc(meta)}</span>` : ''}`;
  const foldAttrs = fold ? { 'aria-expanded': String(!!fold.open), 'aria-label': `${title}: ${fold.label || 'more settings'}`, title: fold.help || null, ...(fold.attrs || {}) } : null;
  const main = open ? `<button type="button" class="lr-main"${attrs(open)}>${body}</button>` : fold ? `<button type="button" class="lr-main lr-opens"${attrs(foldAttrs)}>${body}</button>` : `<span class="lr-main">${body}</span>`;
  const more = menu ? moreMenu(menu) : '';
  // a row with rows under it folds from its mark (list.fold-by-mark): the root icon is the trigger, its name still opens it
  // list.news: something happened here that you have not seen: a small light dot on the mark's corner, and never the
  // bold title too (one sign); `news: 'need'` wears its level's colour because it needs you
  if (news && mark) mark = newsMark(mark, news === 'need');
  const railMark = markFold ? `<button type="button" class="lr-mark-fold"${attrs({ 'aria-expanded': String(!!markFold.open), title: markFold.label || `${markFold.open ? 'Fold' : 'Show'} what is under ${title}`, 'aria-label': markFold.label || `${markFold.open ? 'Fold' : 'Show'} what is under ${title}`, ...(markFold.attrs || {}) })}>${mark}</button>` : mark;
  const rail = check === undefined ? railMark : checkbox({ cls: 'lr-check', why: 'Select', checked: !!check, attrs: { 'aria-label': `Select ${title}`, ...boxAttrs } });
  const chev = `<span class="set-chev" aria-hidden="true">${icon('chevR', 14)}</span>`;
  const foldBtn = !fold ? '' : open ? `<button type="button" class="lr-fold"${attrs(foldAttrs)}>${chev}</button>` : chev;
  const shown = (!fold || fold.open) && (!markFold || markFold.open) ? after : '';
  const state = [fold && 'is-opens', fold && fold.open && 'is-open', wrap && 'is-wrap', unread && !news && 'is-unread', news && 'has-news', current && 'is-current', holds && 'is-holds', flash && 'is-flash', check && 'is-sel'].filter(Boolean).join(' ');
  return row({ kind: 'list', rail, text: main, cls: state, end: `${endText ? `<span class="lr-fig">${esc(endText)}</span>` : ''}${foldBtn}${end}`, more, attrs: { role: 'listitem', ...(current ? { 'aria-current': 'true' } : {}), ...a }, after: shown ? `<div class="lr-after">${shown}</div>` : '' });
}

/**
 * List: its sentence (what it shows), then its groups in a fixed order; an empty group is not drawn; a long group
 * shows its first rows, then Show N more opens the rest in place. A group by date folds: its head is a button with a
 * chevron, and folded it keeps its head and count and hides its rows.
 * @param {object} o
 * @param {string} [o.sentence]   the list's filters: a FilterRow's markup
 * @param {{title?:string, meta?:string, count?:string|number, of?:string|number, chip?:string, rows:string[], more?:{n:number, attrs:object}, fold?:{open:boolean, attrs:object}}[]} o.groups
 * @param {string} [o.empty]      EmptyState markup when every group is empty
 * @param {string} [o.tools]      at the sentence's right: Select all while selecting, the list's ⋯
 * @param {string} [o.selection]  under the head, kept in sight while the list scrolls: the SelectionBar
 * @param {string} [o.note]       under the filters: one line about this visit (NarrowedLine)
 * @param {number} [o.level]     the heading level of a group's title: 3 in a bar (under its h2), 2 on a page whose h1 it follows
 * @param {object} [o.attrs]
 */
function groupHtml(g, H = 'h3') {
  // small.one-count: a place that holds a part of the one count says so in words: "Needs you 6 · of 11"
  const of = g.of !== undefined && g.of !== '' && g.of !== null ? ` <span class="n n-of">· of ${esc(g.of)}</span>` : '';
  const shut = g.fold && !g.fold.open, n = (g.count !== undefined ? ` <span class="n">${esc(g.count)}</span>` : '') + of;
  const head = !g.title ? '' : g.fold
    ? `<${H} class="list-h"><button type="button" class="list-h-b"${attrs({ ...g.fold.attrs, 'aria-expanded': String(!shut), title: shut ? `Shows ${g.title}` : `Folds ${g.title}` })}>${icon('chevron', 10)}${esc(g.title)}</button>${n}${g.chip || ''}</${H}>`
    : `<${H} class="list-h">${esc(g.title)}${n}${g.chip || ''}</${H}>`;
  if (shut) return `<section class="list-group is-shut">${head}</section>`;
  return `<section class="list-group">${head}${g.meta ? `<p class="list-m">${esc(g.meta)}</p>` : ''}<div class="list-rows" role="list"${attrs({ 'aria-label': g.title || null })}>${g.rows.join('')}</div>${g.more ? `<button type="button" class="dc-link list-more"${attrs(g.more.attrs)}>${g.more.less ? 'Show less' : `Show ${esc(g.more.n)} more`}</button>` : ''}</section>`;
}

export function list({ sentence = '', groups, empty = '', tools = '', selection = '', note = '', level = 3, attrs: a = {} }) {
  const shown = groups.filter((g) => g.rows.length);
  const body = shown.length ? shown.map((g) => groupHtml(g, level === 2 ? 'h2' : 'h3')).join('') : empty;
  return `<div class="list"${attrs(a)}>${tools ? `<div class="list-head"><div class="list-sentence">${sentence}</div><span class="list-tools">${tools}</span></div>` : sentence ? `<div class="list-sentence">${sentence}</div>` : ''}${note}${selection ? `<div class="list-select">${selection}</div>` : ''}${body}</div>`;
}
