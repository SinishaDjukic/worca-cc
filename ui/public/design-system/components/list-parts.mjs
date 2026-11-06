// The parts of a list (docs/rail/lists.md): its sentence, a group row with its members, a run's stacked fix rounds, the
// list's own state, and a chat's marks. list.mjs holds the row and the list; list-page.mjs joins them to a page.
import { attrs, esc } from './html.mjs';
import { button } from './button.mjs';
import { compactMenu } from './compact-menu.mjs';
import { emptyState } from './empty-state.mjs';
import { listRow } from './list.mjs';
import { wordPicker } from './settings-row.mjs';
import { icon } from './icons.mjs';
import { ORIGIN_MARKS, originLabel } from '../../chat-origin.mjs';

/**
 * One word of a sentence: the chosen words and a chevron, its menu under it while open. A pick reports `data-pick="<id>|<item>"`.
 * @param {object} p
 * @param {string} p.id
 * @param {string} p.text
 * @param {object[]} p.items  CompactMenu items; each choice carries `hint`, its count
 * @param {string} [p.tip]
 * @param {object} o
 * @param {string} [o.open]     the id of the open menu
 * @param {string} [o.chevron]
 * @param {string} [o.menuCls]  a state on the menu (its fade)
 */
export function listWord({ id, text, items, tip = '', align = '' }, { open = '', chevron = '', menuCls = '' } = {}) {
  const on = open === id;
  const menu = on ? compactMenu({ items: items.map((it) => (it.sep || it.header ? it : { ...it, id: `${id}|${it.id}` })), cls: `pz-menu${align === 'right' ? ' is-right' : ''}${menuCls}`, pickAttr: 'data-pick', motion: false }) : '';
  return wordPicker({ text, tip, cls: 'is-words', wrapCls: 'pz-pick', chevron: chevron || icon('chevron', 12, { stroke: 1.8 }), open: on, menuHtml: menu, attrs: { 'data-menu': id } });
}

/**
 * The list's sentence: `Showing [what ▾] from [where ▾] by [grouping ▾]`, each choice in its menu with its count.
 * @param {object} o
 * @param {{word:string, id:string, text:string, items:object[], tip?:string}[]} o.parts
 * @param {string} [o.open]
 * @param {string} [o.chevron]
 * @param {string} [o.menuCls]
 */
export function listSentence({ parts, open = '', chevron = '', menuCls = '' }) {
  return parts.map((p) => `${esc(p.word)} ${listWord(p, { open, chevron, menuCls })}`).join(' ');
}

/**
 * A group row: a feature, a chain, a person's group, a chat group. A ListRow with its count, its ⌄, and its members under
 * it while open.
 * @param {object} o          listRow's options, and:
 * @param {string} o.count    "2/3"
 * @param {boolean} o.shown   its members show
 * @param {string} o.noun     "runs"
 * @param {object} o.toggle   attrs of the ⌄
 * @param {string} [o.rows]   the member rows' markup
 */
export function groupRow({ count, shown, noun, toggle, rows = '', end = '', ...row }) {
  const fold = button({ label: `${shown ? 'Hide' : 'Show'} the ${noun} in ${row.title}`, kind: 'quiet', iconOnly: true, title: false, icon: icon(shown ? 'chevron' : 'chevR', 14, { stroke: 1.8 }), attrs: { 'aria-expanded': String(shown), ...toggle } });
  return listRow({ ...row, endText: count, end: fold + end, after: shown && rows ? `<div class="lr-members" role="list"><div class="list-rows">${rows}</div></div>` : '' });
}

/**
 * A run's PR fix rounds, stacked under it: the newest round's line and `7 rounds`; while open each round, newest first, then `+n earlier`.
 * @param {object} o
 * @param {string} o.line       the stack's line
 * @param {number} o.n
 * @param {boolean} o.open
 * @param {object} o.toggle     attrs of `7 rounds`
 * @param {{n:number, words:string, time?:string, attrs?:object}[]} [o.rounds]  the ones shown
 * @param {{n:number, attrs:object}} [o.more]   the ones not shown yet
 */
export function roundRows({ line, n, open, toggle, rounds = [], more = null }) {
  const word = `${n} ${n === 1 ? 'round' : 'rounds'}`;
  const head = `<div class="lr-round-line"><span class="lr-m"${attrs({ title: line })}>${esc(line)}</span>${button({ label: word, kind: 'quiet', icon: icon(open ? 'chevron' : 'chevR', 12, { stroke: 1.8 }), attrs: { 'aria-expanded': String(open), 'aria-label': `${open ? 'Hide' : 'Show'} the ${word}`, ...toggle } })}</div>`;
  if (!open) return `<div class="lr-rounds">${head}</div>`;
  return `<div class="lr-rounds">${head}<div class="list-rows">${rounds.map((r) => listRow({ title: `Round ${r.n} · ${r.words}`, endText: r.time || '', open: r.attrs || null })).join('')}</div>${more ? button({ label: `+${more.n} earlier`, kind: 'quiet', attrs: more.attrs }) : ''}</div>`;
}

/**
 * What a list says instead of rows: loading (a page draws nothing for its first 300ms), offline, could not load, empty.
 * @param {object} o
 * @param {'loading'|'offline'|'failed'|'empty'} o.state
 * @param {string} o.noun      "runs"
 * @param {string} [o.text]    empty: its words ("Nothing needs you.")
 * @param {object} [o.retry]   Try again's attrs
 * @param {string} [o.action]  empty: the one way on, a Button
 */
export function listState({ state, noun, text = '', retry = null, action = '' }) {
  const again = retry ? button({ label: 'Try again', kind: 'quiet', attrs: retry }) : '';
  if (state === 'loading') return emptyState({ title: `Loading ${noun}…` });
  if (state === 'offline') return emptyState({ title: `The ${noun} show here once Worca's server is reachable again.`, actions: again });
  if (state === 'failed') return emptyState({ title: `Could not load the ${noun}`, text: 'The server did not answer. Nothing changed.', actions: again, error: true });
  return emptyState({ title: text || `No ${noun} yet.`, actions: action });
}

// The app's own marks (chat-origin.mjs): filled with the text's colour; any other platform gets a plug.
/** A chat a chat integration opened wears its platform's logo before its title. */
export function originMark({ platform, label = '' }) {
  const d = Object.hasOwn(ORIGIN_MARKS, platform) ? ORIGIN_MARKS[platform] : '';
  const name = originLabel({ platform, label });
  if (!d) return `<span class="lr-origin"${attrs({ title: name, 'aria-label': name, role: 'img' })}>${icon('plug', 12, { stroke: 1.8 })}</span>`;
  return `<span class="lr-origin"${attrs({ title: name, 'aria-label': name, role: 'img' })}><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${d}"></path></svg></span>`;
}

/** An idle chat's mark: what it did, its kind's icon in the dot's place. */
export function chatKindIcon({ icon: name, label }) {
  return `<span class="lr-kind"${attrs({ title: label, 'aria-label': label, role: 'img' })}>${icon(name, 14, { stroke: 1.8 })}</span>`;
}
