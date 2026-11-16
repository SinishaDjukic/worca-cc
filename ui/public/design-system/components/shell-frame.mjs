// The shell's frame (docs/stillhet/navigation.md, docs/stillhet/narrow.md): the sidebar and the top bar with their named slots.
// Their ids and classes are the names the Stillhet stylesheets address; the library defines them here.
import { attrs, esc } from './html.mjs';
import { icon } from './icons.mjs';
import { newsMark } from './list.mjs';

const iconBtn = (c, label, svg, a = {}, tip = label) => `<button type="button" class="btn btn-quiet btn-icon ${c}"${attrs({ ...a, 'aria-label': label, title: tip })}>${svg}</button>`;
const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
const HAMBURGER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>';
const PANEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="4.5"></rect><path class="side-toggle-line" d="M7.25 9v6"></path><rect class="side-toggle-fill" x="6" y="8.25" width="4" height="7.5" rx="1.5" fill="currentColor" stroke="none"></rect></svg>';

/**
 * BrandRow: the sidebar's head, the wordmark and the mark (both open Chat) and the phone's Close menu.
 * @param {object} [o]
 * @param {string} [o.href]    where the wordmark and the mark go
 * @param {string} [o.slot]    markup between the links and Close (the bar's head)
 * @param {boolean} [o.close]  draw the Close menu button (phones)
 */
export function brandRow({ href = '#chat/new', slot = '', close = true } = {}) {
  const logo = (c) => `<a class="${c}"${attrs({ href, 'aria-label': 'worca: Chat', title: 'Chat' })}></a>`;
  const x = close ? iconBtn('side-close', 'Close menu', CLOSE, { id: 'side-close' }) : '';
  return `<div class="brand">${slot || logo('logo') + logo('logo-mark')}${x}</div>`;
}

/** NavSection: the group head above a run of places. */
export function navSection({ label }) {
  return `<p class="nav-sect side-g">${esc(label)}</p>`;
}

/**
 * BarGrip: the separator that resizes the bar; dragged past the edge it hides, a double-click restores the default.
 * @param {object} [o]
 * @param {number} [o.min]
 * @param {number} [o.max]
 */
export function barGrip({ min = 264, max = 420 } = {}) {
  return `<div class="bar-grip" role="separator" aria-orientation="vertical" tabindex="0"${attrs({ 'aria-label': 'Resize the bar', 'aria-valuemin': min, 'aria-valuemax': max, title: 'Drag to resize; past the edge it hides. Double-click for the default width' })}></div>`;
}

/**
 * SideToggle: collapses and expands the bar on a wide screen (aria-expanded names the state).
 * @param {object} [o]
 * @param {boolean} [o.expanded]
 */
export function sideToggle({ expanded = true } = {}) {
  const word = expanded ? 'Collapse menu' : 'Expand menu';
  return iconBtn('side-toggle', word, PANEL, { id: 'side-toggle', 'aria-expanded': String(expanded), 'aria-controls': 'side-rail' });
}

/**
 * MenuButton: the phone's hamburger, which opens the bar as a drawer.
 * @param {object} [o]
 * @param {boolean} [o.expanded]
 * @param {boolean} [o.rollup]  draw the needs-you roll-up dot (hidden until a task needs you)
 */
export function menuButton({ expanded = false, rollup = true } = {}) {
  const dot = rollup ? '<span class="nav-rollup" id="mbar-rollup" hidden title="A task needs you"></span>' : '';
  return iconBtn('mbar-menu', 'Menu', HAMBURGER + dot, { id: 'mbar-menu', 'aria-controls': 'side-rail', 'aria-expanded': String(expanded) });
}

/**
 * SidebarFrame: the aside and its one scrolling band. Each slot is drawn once, in this order: brand, then in the band
 * (above, nav, lists), then foot, extras and the grip.
 * @param {object} o
 * @param {string} o.brand  BrandRow
 * @param {string} o.nav    the places, in a nav
 * @param {string} [o.above] in the band, before the nav
 * @param {string} [o.lists] in the band, after the nav
 * @param {string} [o.foot]
 * @param {string} [o.extras]
 * @param {string} [o.grip] BarGrip
 */
export function sidebarFrame({ brand, nav, above = '', lists = '', foot = '', extras = '', grip = '' }) {
  return `<aside class="sidebar" id="side-rail">${brand}<div class="side-scroll" id="side-scroll">${above}<nav class="nav" aria-label="Primary">${nav}</nav>${lists}</div><div class="side-foot" id="side-foot">${foot}</div>${extras}${grip}</aside>`;
}

/**
 * TopBarFrame: the header with its three regions and the page title.
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.left]   before the title (menu button, toggle)
 * @param {string} [o.centre]
 * @param {string} [o.right]
 */
export function topBarFrame({ title, left = '', centre = '', right = '' }) {
  return `<header class="topnav" id="topnav"><div class="topnav-l">${left}<div class="topnav-title" id="topnav-title">${esc(title)}</div></div><div class="topnav-c">${centre}</div><div class="topnav-r">${right}</div></header>`;
}

export { icon };

const ASK_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4H6.5A2.5 2.5 0 0 0 4 6.5V20l3.6-2.7h9.9a2.5 2.5 0 0 0 2.5-2.5V12"></path><path d="M18 3v6M15 6h6"></path></svg>';

/**
 * AskButton: the top bar's Ask worca. Chat is the only place to type (chat-first): it hands the page you are on to Chat as a chip.
 * @param {object} [o]
 * @param {string} [o.mark]      the Ask worca mark's SVG
 */
export function askButton({ mark = '' } = {}) {
  return `<button type="button" class="btn btn-quiet topnav-ask" id="topnav-ask" data-min-level="simple"${attrs({ 'aria-label': 'Ask worca', title: 'Ask worca about this page, in Chat' })}><span class="ask-ic" aria-hidden="true">${mark}</span>${ASK_PLUS}<span class="topnav-ask-label">Ask worca</span><span class="topnav-ask-dot" id="topnav-ask-dot" hidden></span></button>`;
}

/**
 * PlaceButton (nav.place-button; from classic's sidebar, where a place's whole name is the control): the bar's name and
 * its chevron as ONE button, at least 28px high, that opens the list of places.
 * @param {object} o
 * @param {string} o.title     the place's name ("Tasks")
 * @param {boolean} [o.open]   its menu shows
 * @param {object} [o.attrs]
 */
export function placeButton({ title, open = false, attrs: a = {} }) {
  return `<button type="button" class="place-btn"${attrs({ 'aria-haspopup': 'menu', 'aria-expanded': String(!!open), 'aria-label': `${title}: go to another place`, title: 'Go to another place', ...a })}><span class="place-btn-t">${esc(title)}</span>${icon('chevron', 12)}</button>`;
}

/**
 * The items of the place button's menu: the place's own home first, then every place with its count where it has one,
 * the current one checked. A pick reports `<prefix><id>`.
 * @param {object} o
 * @param {{id:string, label:string}} [o.home]     the current place's home ("Tasks home")
 * @param {{id:string, label:string, count?:number|string, current?:boolean, lab?:boolean, icon?:string}[]} o.places
 * @param {string} [o.prefix]
 */
export function placeItems({ home = null, places, prefix = 'bar-go|' }) {
  const hint = (p) => (p.count || p.count === 0 ? String(p.count) : p.lab ? 'Labs' : undefined);
  // small.one-count: the numbers are what needs you there; one quiet caption at the menu's top says so
  const counted = places.some((p) => p.count || p.count === 0);
  return [...(home ? [{ id: `${prefix}${home.id}`, text: home.label, mark: icon('home', 14) }, { sep: true }] : []),
    ...(counted ? [{ header: 'Places', end: 'need you' }] : []),
    ...places.map((p) => ({ id: `${prefix}${p.id}`, text: p.label, checked: !!p.current, hint: hint(p), mark: p.news && p.icon ? newsMark(p.icon, p.news === 'need') : p.icon || '' }))];   // list.news
}

/**
 * BarPlaceHead: the bar's head. The W mark alone goes home; the place's name is the PlaceButton; then the place's + and
 * Hide. On the home bar, which lists the places itself, the name is plain text.
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.logo]     the product's mark (markup)
 * @param {boolean} [o.places]  the name opens the places (false on the home bar)
 * @param {boolean} [o.open]    the places menu shows
 * @param {string} [o.menu]     the places menu's markup, when open
 * @param {string} [o.action]   the place's + (markup)
 * @param {string} [o.hide]     the Hide button (markup)
 * @param {{home?:object, place?:object}} [o.hooks]  the page's attrs on the W and on the PlaceButton
 */
export function barPlaceHead({ title, logo = '', places = true, open = false, menu = '', action = '', hide = '', hooks = {} }) {
  const home = `<button type="button" class="bar-house"${attrs({ 'data-bar-home': '', title: 'Home', 'aria-label': 'Home', ...(hooks.home || {}) })}>${logo || icon('home', 16)}</button>`;
  const name = places ? placeButton({ title, open, attrs: { 'data-bar-house': '', ...(hooks.place || {}) } }) : `<span class="bar-title-w">${esc(title)}</span>`;
  return `<div class="bar-head">${home}<h2 class="bar-title">${name}</h2>${open && menu ? `<span class="rc-pop bar-quick">${menu}</span>` : ''}${action}${hide}</div>`;
}

/**
 * SkipLink (key.skip-link): the page's first Tab stop; it shows only while focused and moves the focus to the content.
 * @param {object} [o]
 * @param {string} [o.to]     the id of the content
 * @param {string} [o.label]
 */
export function skipLink({ to = 'main-content', label = 'Skip to content' } = {}) {
  return `<a class="skip-link"${attrs({ href: `#${to}`, 'data-skip': to })}>${esc(label)}</a>`;
}
