// SideMenu and Search (docs/rail/settings.md, docs/rail/components.md).
import { attrs, esc } from './html.mjs';
import { compactMenu } from './compact-menu.mjs';
import { icon } from './icons.mjs';

/**
 * SideMenu: a place's own menu in the sidebar (Settings): ‹ back to where you came from, then its sections under small
 * group heads, the current one marked. On a narrow screen the same menu is the page's first view, as a list (`list`):
 * 44px rows with a ›, a line where each group after the first starts.
 * @param {object} o
 * @param {string} o.label                     what it is (aria-label: "Settings")
 * @param {{label:string, icon?:string, attrs?:object}} [o.back]
 * @param {{title:string, items:{label:string, icon?:string, current?:boolean, count?:string|number, attrs?:object}[]}[]} o.groups
 * @param {boolean} [o.list]                   the narrow screen's list
 * @param {string} [o.chevron]                 the › SVG, for the list
 * @param {string} [o.cls]
 */
export function sideMenu({ label, back = null, groups, list = false, chevron = '', cls = '' }) {
  const item = (it) => `<button type="button" class="side-i"${attrs({ 'aria-current': it.current ? 'page' : null, ...(it.attrs || {}) })}>${it.icon ? icon(it.icon, 16, { cls: 'side-ic' }) : ''}<span class="side-l">${esc(it.label)}</span>${it.count != null ? `<span class="side-n">${esc(it.count)}</span>` : ''}${list ? chevron : ''}</button>`;
  const head = back ? `<button type="button" class="side-i side-back"${attrs(back.attrs || {})}>${back.icon || ''}<span class="side-l">${esc(back.label)}</span></button>` : '';
  return `<nav class="side-menu${list ? ' is-list' : ''}${cls ? ' ' + cls : ''}"${attrs({ 'aria-label': label })}>${head}${groups.map((g) => `<div class="side-group"><p class="side-g">${esc(g.title)}</p>${g.items.map(item).join('')}</div>`).join('')}</nav>`;
}

/**
 * Search: the top bar's field; what it finds opens under it, each result with where it lives. A pick reports
 * `data-menu-pick="<id>"`; the page lands on it (motion.mjs › land).
 * @param {object} o
 * @param {string} [o.value]
 * @param {string} [o.placeholder]
 * @param {string} [o.label]        aria-label
 * @param {string} [o.results]      searchResults markup (its items may carry `area` and `mark`; `areas` orders the heads)
 */
export function search({ value = '', placeholder = 'Search or ask', label = 'Search', results = '' }) {
  return `<div class="rl-search rc-pop"><input class="input input-sm" type="search" data-search autocomplete="off"${attrs({ value, placeholder, 'aria-label': label, 'data-key': 'search' })}><div data-search-res>${results}</div></div>`;
}

/**
 * What a search found: a CompactMenu, each result's name and where it lives; none, one line saying so.
 * @param {{id:string, text:string, where?:string}[]} items
 * @param {string} [empty]
 */
export function searchResults(items, empty = 'Nothing matches', { areas = [], tail = [] } = {}) {
  const line = (x) => ({ id: x.id, text: x.text, hint: x.where, mark: x.mark });
  if (!items.length) return compactMenu({ cls: 'rl-search-res', label: 'Found', items: [{ id: 'none', text: empty, off: true }, ...tail] });
  // what it finds, under the area it belongs to, each with its own mark (set.search)
  const grouped = areas.length ? areas.flatMap(([area, mark]) => { const hits = items.filter((x) => x.area === area); return hits.length ? [{ header: area, mark }, ...hits.map(line)] : []; }) : items.map(line);
  return compactMenu({ cls: 'rl-search-res', label: 'Found', items: [...grouped, ...(tail.length ? [{ sep: true }, ...tail] : [])] });
}

/**
 * BackLink: ‹ the place one step up, above a page's title on a narrow screen ("‹ Settings").
 * @param {object} o
 * @param {string} o.label
 * @param {string} [o.icon]   the ‹ SVG
 * @param {object} [o.attrs]
 */
export function backLink({ label, icon = '', attrs: a = {} }) {
  return `<button type="button" class="rl-back"${attrs(a)}>${icon}${esc(label)}</button>`;
}
