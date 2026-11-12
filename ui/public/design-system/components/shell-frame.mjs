// The shell's frame (docs/rail/navigation.md, docs/rail/narrow.md): the sidebar and the top bar with their named slots.
// Their ids and classes are the names the Stillhet stylesheets address; the library defines them here.
import { attrs, esc } from './html.mjs';
import { icon } from './icons.mjs';

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
 * @param {boolean} [o.rollup]  draw the needs-you roll-up dot (hidden until a run needs you)
 */
export function menuButton({ expanded = false, rollup = true } = {}) {
  const dot = rollup ? '<span class="nav-rollup" id="mbar-rollup" hidden title="A pipeline needs your input"></span>' : '';
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
  return `<header class="topnav" id="topnav"><div class="topnav-l">${left}<h1 class="topnav-title" id="topnav-title">${esc(title)}</h1></div><div class="topnav-c">${centre}</div><div class="topnav-r">${right}</div></header>`;
}

export { icon };

const ASK_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4H6.5A2.5 2.5 0 0 0 4 6.5V20l3.6-2.7h9.9a2.5 2.5 0 0 0 2.5-2.5V12"></path><path d="M18 3v6M15 6h6"></path></svg>';

/**
 * AskButton: the top bar's door to the Ask worca column; its mark says whether Worca is answering or the column is open.
 * @param {object} [o]
 * @param {string} [o.mark]      the Ask worca mark's SVG
 * @param {boolean} [o.expanded]
 */
export function askButton({ mark = '', expanded = false } = {}) {
  return `<button type="button" class="btn btn-quiet topnav-ask" id="topnav-ask" data-min-level="simple"${attrs({ 'aria-expanded': String(expanded), 'aria-controls': 'ask-side', 'aria-label': 'Ask worca', title: 'Ask worca' })}><span class="ask-ic" aria-hidden="true">${mark}</span>${ASK_PLUS}<span class="topnav-ask-label">Ask worca</span><span class="topnav-ask-dot" id="topnav-ask-dot" hidden></span></button>`;
}
