// The shell's own pieces (docs/rail/components.md, panels.md, motion.md): the quiet offline line, a side column's frame,
// the away screensaver.
import { attrs, cls, esc } from './html.mjs';
import { button } from './button.mjs';
import { statusDot } from './status-line.mjs';
import { icon } from './icons.mjs';
import { compactMenu } from './compact-menu.mjs';

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
 * @param {string} [o.tools]     in its head, before Close
 * @param {string} [o.closeLabel]
 */
export function sideColumn({ title, body, close = '', width = 440, hooks = {}, tools = '', closeLabel = 'Close' }) {
  const grip = `<div class="ask-side-grip" role="separator" aria-orientation="vertical" tabindex="0"${attrs({ 'aria-label': `Resize ${title}`, 'aria-valuemin': 360, 'aria-valuemax': 680, 'aria-valuenow': width, title: 'Drag to resize, 360 to 680px', ...(hooks.grip || {}) })}></div>`;
  return `${grip}<div class="ask-side-in rl-side"><div class="rl-side-head"><h2 class="rl-side-title">${esc(title)}</h2><span class="rl-side-tools">${tools}${button({ label: closeLabel, kind: 'quiet', iconOnly: true, icon: close, attrs: hooks.close || {} })}</span></div><div class="rl-side-body">${body}</div></div>`;
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
 * The sidebar's foot: the avatar and name that open the profile menu.
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
/**
 * CountBadge: how many, on the corner of what it counts: Pulse, the hidden bar's kinds of work. `need` when any waits on you.
 * @param {object} o
 * @param {number|string} o.n
 * @param {''|'need'|'run'} [o.tone]
 * @param {boolean} [o.corner]   on the corner of its icon
 */
export function countBadge({ n, tone = '', corner = false }) {
  return `<span class="topnav-badge${corner ? ' is-corner' : ''}"${attrs({ 'data-tone': tone || null })}>${esc(n)}</span>`;
}

/**
 * InView: the things you keep in view, in the top bar, on every page, like a browser's tabs: each its mark and its name,
 * cut short (a narrow window keeps the marks only). A mark holds still and only says where its thing stands (no pulse,
 * no breathing); hovered or focused, a card says what it is, with a way out of
 * view; a click opens it; past the shown ones, one +N opens a menu of the rest.
 * @param {object} o
 * @param {{title:string, line?:string, icon:string, attrs?:object, drop?:object}[]} o.items
 * @param {{n:number, open?:boolean, attrs?:object, items?:{id:string, text:string, mark?:string}[], pickAttr?:string}} [o.more]
 */
export function inView({ items, more = null }) {
  if (!items.length && !more) return '';
  const one = (x) => `<span class="in-view-w"><button type="button" class="in-view-i is-named"${attrs({ ...(x.attrs || {}), 'aria-label': [x.title, x.line].filter(Boolean).join(': ') })}>${x.icon}<span class="in-view-n" aria-hidden="true">${esc(x.title)}</span></button><span class="in-view-card" role="tooltip">${x.icon}<span><b>${esc(x.title)}</b>${x.line ? `<span>${esc(x.line)}</span>` : ''}</span>${x.drop ? `<button type="button" class="in-view-x"${attrs({ ...x.drop, 'aria-label': `Out of view: ${x.title}`, title: 'Out of view' })}>${icon('sym-x', 12)}</button>` : ''}</span></span>`;
  const rest = more ? `<span class="rc-pop is-right in-view-more"><button type="button" class="in-view-i is-more"${attrs({ ...(more.attrs || {}), 'aria-haspopup': 'menu', 'aria-expanded': String(!!more.open), title: `${more.n} more in view`, 'aria-label': `${more.n} more in view` })}>+${esc(more.n)}</button>${more.open ? compactMenu({ label: 'More in view', items: more.items || [], pickAttr: more.pickAttr || 'data-in-view' }) : ''}</span>` : '';
  return `<nav class="in-view" aria-label="In view">${items.map(one).join('')}${rest}</nav>`;
}

/**
 * AskWorcaMark: Ask worca's icon in the top bar, saying what it does: the bubble with its W at rest, three dots while
 * Worca writes, filled while its column is open (writing wins over open). A reply you have not read is its dot.
 * @param {object} o
 * @param {boolean} [o.answering]
 * @param {boolean} [o.open]
 * @param {number} [o.size]
 */
export function askWorcaMark({ answering = false, open = false, size = 20 } = {}) {
  return icon(answering ? 'ask-worca-answering' : open ? 'ask-worca-open' : 'ask-worca', size);
}

/**
 * BarStrip: the hidden bar, as a strip: one icon per kind of work, its count as a CountBadge on its corner; each opens its place.
 * @param {object} o
 * @param {{label:string, icon:string, n:number, tone?:string, attrs?:object}[]} o.items
 * @param {string} [o.label]
 * @param {boolean} [o.news]  something new just arrived: its icon shakes once (never while reduced motion is on)
 */
export function barStrip({ items, label = 'Your work' }) {
  return `<nav class="bar-strip"${attrs({ 'aria-label': label })}>${items.map((x) => `<button type="button" class="bar-strip-i"${attrs({ ...(x.attrs || {}), title: x.label, 'aria-label': x.label })}>${x.icon}${x.n ? countBadge({ n: x.n, tone: x.tone, corner: true }) : ''}</button>`).join('')}</nav>`;
}

export function topBarAction({ label, icon, labelCls, kind = '', full = false, badge = null, news = false, cls: c = '', title = '', attrs: a = {} }) {
  const look = cls('btn', !full && 'btn-sm', kind && `btn-${kind}`, news && 'is-news', c);
  return `<button type="button" class="${look}"${attrs({ ...a, title: title || null })}>${icon}<span class="${labelCls}">${esc(label)}</span>${badge ? countBadge({ n: badge.n, tone: badge.tone }) : ''}</button>`;
}

/**
 * PanelFrame: what lies under a top-bar button, over any page: a head that stays, a body that scrolls, a foot if it has one.
 * Where it sits is the page's (`cls`). Closing is dismissOnOutside's.
 * @param {object} o
 * @param {string} o.label  what it is (aria-label)
 * @param {string} o.head   Tabs, and its ⋯ at the right
 * @param {string} o.body
 * @param {string} [o.foot]
 * @param {string} [o.cls]
 */
export function panelFrame({ label, head, body, foot = '', cls = '' }) {
  return `<div class="panel-frame${cls ? ' ' + cls : ''}" role="dialog"${attrs({ 'aria-label': label })}><div class="panel-head">${head}</div><div class="panel-body">${body}</div>${foot}</div>`;
}
