// The shell's own pieces (docs/rail/components.md, panels.md, motion.md): the quiet offline line, a side column's frame,
// a running action's row in the sidebar's foot, the away screensaver.
import { attrs, esc } from './html.mjs';
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
