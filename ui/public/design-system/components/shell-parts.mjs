// The shell's own pieces (docs/rail/components.md, panels.md, motion.md): the quiet offline line, a side column's frame,
// a running action's row in the sidebar's foot, the away screensaver.
import { attrs, cls, esc } from './html.mjs';
import { button } from './button.mjs';
import { statusDot } from './status-line.mjs';

/** The connection dropped: a quiet line at the end of the top bar, grey dot, until it reconnects. */
export function offlineLine({ text = 'Offline · retrying', tip = 'Worca lost its connection to the server. Your runs keep going there; this page catches up by itself.' } = {}) {
  return `<span class="rc-conn rl-offline" role="status"${attrs({ title: tip })}>${statusDot({ tone: 'is-grey' })}<span class="rl-offline-t">${esc(text)}</span></span>`;
}

/**
 * SideColumn: a column beside the page (Ask worca): its grip, its head with Close, its body, the only scroller.
 * @param {object} o
 * @param {string} o.title
 * @param {string} o.body        markup
 * @param {string} [o.close]     the Close icon's SVG
 * @param {number} [o.width]     what the grip reports to a screen reader
 * @param {object} [o.hooks]     the page's attrs: { close, grip }
 */
export function sideColumn({ title, body, close = '', width = 440, hooks = {} }) {
  const grip = `<div class="ask-side-grip" role="separator" aria-orientation="vertical" tabindex="0"${attrs({ 'aria-label': `Resize ${title}`, 'aria-valuemin': 360, 'aria-valuemax': 680, 'aria-valuenow': width, title: 'Drag to resize, 360 to 680px', ...(hooks.grip || {}) })}></div>`;
  return `${grip}<div class="ask-side-in rl-side"><div class="rl-side-head"><h2 class="rl-side-title">${esc(title)}</h2>${button({ label: 'Close', kind: 'quiet', iconOnly: true, icon: close, attrs: hooks.close || {} })}</div><div class="rl-side-body">${body}</div></div>`;
}

/**
 * A running action in the sidebar's foot: a live dot, what runs (it opens its run), Stop. It must stay stoppable in every
 * interface mode.
 * @param {object} o
 * @param {string} o.text
 * @param {string} o.stop        Stop's tooltip
 * @param {string} o.stopIcon    the SVG
 * @param {object} [o.open]      attrs of the name; without them the name is plain text
 * @param {object} [o.stopAttrs]
 * @param {boolean} [o.menu]     inside a flyout: its buttons are menu items
 */
export function actionRow({ text, stop, stopIcon, open = null, stopAttrs = {}, menu = false }) {
  const role = menu ? { role: 'menuitem' } : {};
  const name = open ? `<button type="button" class="act-srow-name"${attrs({ ...role, ...open })}>${esc(text)}</button>` : `<span class="act-srow-name">${esc(text)}</span>`;
  return `<div class="act-srow"${attrs({ title: text, role: menu ? 'none' : null })}><span class="pdot" aria-hidden="true"></span>${name}<button type="button" class="act-stop"${attrs({ title: stop, 'aria-label': stop, ...role, ...stopAttrs })}>${stopIcon}</button></div>`;
}

export const AWAY_IDLE_MS = 5 * 60 * 1000;
/** The away screensaver shows only with Away and Keep awake on, the window focused and 5 idle minutes; never under reduced motion. */
export const awayShows = ({ away, keepAwake, focused, idleMs, reduced }) => !!(away && keepAwake && focused && !reduced && idleMs >= AWAY_IDLE_MS);

/**
 * The away screensaver (docs/rail/motion.md's one exception): the wordmark and one line that says how things stand. The
 * page moves `.rl-away-mark` through --x and --y; any input hides it, and that input does not reach the page.
 * @param {object} o
 * @param {string} o.line
 * @param {string} [o.word]
 */
export function awayScreen({ line, word = 'Worca' }) {
  return `<div class="rl-away" role="status"${attrs({ 'aria-label': `${word}: ${line}` })}><div class="rl-away-mark"><span class="rl-away-word">${esc(word)}</span><span class="rl-away-line">${esc(line)}</span></div></div>`;
}

/**
 * A place in the sidebar: its icon, its name; off, it says why in its tooltip.
 * @param {object} o
 * @param {string} o.label
 * @param {string} o.icon     SVG
 * @param {boolean} [o.current]
 * @param {boolean} [o.off]
 * @param {string} [o.title]
 * @param {object} [o.attrs]
 */
export function navItem({ label, icon, current = false, off = false, title = '', attrs: a = {} }) {
  return `<button type="button" class="pz-nav-i${current ? ' is-on' : ''}"${attrs({ 'aria-current': current ? 'page' : null, 'aria-disabled': off ? 'true' : null, ...a, title: title || null })}>${icon}<span class="pz-nav-l">${esc(label)}</span></button>`;
}

/**
 * The sidebar's foot: the avatar and name that open the account menu.
 * @param {object} o
 * @param {string} o.name
 * @param {string} o.avatar   markup: the avatar and its rings
 * @param {string} o.chevron  SVG
 * @param {string} o.label    aria-label: what the rings say
 * @param {boolean} [o.away]
 * @param {boolean} [o.open]
 */
export function accountButton({ name, avatar, chevron, label, away = false, open = false }) {
  return `<button type="button" class="pz-acct${open ? ' is-open' : ''}"${attrs({ 'data-acct': true, 'data-presence': away ? 'away' : 'here', 'aria-haspopup': 'menu', 'aria-expanded': String(open), 'aria-label': label })}>${avatar}<span class="pz-acct-name">${esc(name)}</span>${chevron}</button>`;
}

/**
 * In the collapsed sidebar: how many actions run, the tile that opens them.
 * @param {object} o
 * @param {number} o.n
 * @param {string} o.label
 * @param {boolean} [o.open]
 */
export function actionTile({ n, label, open = false }) {
  return `<button type="button" class="act-tile"${attrs({ 'data-act-tile': true, 'aria-haspopup': 'menu', 'aria-expanded': String(open), 'aria-label': label, title: label })}><span class="pdot" aria-hidden="true"></span><span class="act-tile-n">${esc(n)}</span></button>`;
}

/**
 * A top bar's action: its words give way on a narrow screen, its icon and count stay.
 * @param {object} o
 * @param {string} o.label
 * @param {string} o.icon      SVG
 * @param {string} o.labelCls  what hides its words
 * @param {string} [o.kind]    '' | 'primary' | 'quiet'
 * @param {boolean} [o.full]   the top bar's full height, in the captured shell
 * @param {{n:number, tone:string}|null} [o.badge]
 * @param {string} [o.cls]
 * @param {string} [o.title]
 * @param {object} [o.attrs]
 */
export function topBarAction({ label, icon, labelCls, kind = '', full = false, badge = null, cls: c = '', title = '', attrs: a = {} }) {
  const look = cls('btn', !full && 'btn-sm', kind && `btn-${kind}`, c);
  return `<button type="button" class="${look}"${attrs({ ...a, title: title || null })}>${icon}<span class="${labelCls}">${esc(label)}</span>${badge ? `<span class="topnav-badge"${attrs({ 'data-tone': badge.tone })}>${esc(badge.n)}</span>` : ''}</button>`;
}
