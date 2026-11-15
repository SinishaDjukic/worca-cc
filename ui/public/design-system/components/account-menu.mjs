// The profile menu's parts (docs/rail/components.md): a side menu opened from the avatar, its rows with an icon, a value
// and sometimes a switch, its Appearance choice, and the link on the spend card.
import { attrs, esc } from './html.mjs';

/**
 * A row of the profile menu.
 * @param {object} o
 * @param {string} o.label
 * @param {string} [o.mark]   the icon or ring before the words
 * @param {string} [o.value]  what it is set to, at the right
 * @param {boolean} [o.valueAlways]  its value keeps its place when it is empty
 * @param {string} [o.hint]
 * @param {boolean} [o.sw]    it holds a switch: role and aria-checked in `attrs`
 * @param {string} [o.chev]   it opens a side menu: its chevron's SVG
 * @param {string} [o.cls]
 * @param {object} [o.attrs]  role defaults to menuitem
 */
export function accountItem({ label, mark = '', value = '', valueAlways = false, hint = '', sw = false, chev = '', cls = '', attrs: a = {} }) {
  return `<button type="button" class="mi menu-item${cls ? ' ' + cls : ''}"${attrs({ role: 'menuitem', ...a })}>${mark}<span class="mi-lbl">${esc(label)}</span>${hint ? `<span class="mi-hint">${esc(hint)}</span>` : ''}${value || valueAlways ? `<span class="mi-val">${esc(value)}</span>` : ''}${sw ? '<span class="switch" aria-hidden="true"></span>' : ''}${chev}</button>`;
}

/** What holds the rows of a side menu. `cls` names it; `body` is markup. */
export function navFlyout({ label, body, cls = '' }) {
  return `<div class="menu nav-fly${cls ? ' ' + cls : ''}" role="menu"${attrs({ 'aria-label': label })}>${body}</div>`;
}

/** One of Appearance's icons. */
export function themeChoice({ label, icon, on = false, attrs: a = {} }) {
  return `<button type="button" class="theme-ic${on ? ' on' : ''}" role="menuitemradio"${attrs({ 'aria-checked': String(on), ...a, 'aria-label': label, title: label })}>${icon}</button>`;
}

/** A card's title that opens what it sums up. */
export function cardTitleLink({ label, attrs: a = {} }) {
  return `<button type="button" class="mc-title pz-mc-link" role="menuitem"${attrs(a)}>${esc(label)}</button>`;
}

/** Up to two initials: an email's local part (or a display name) split on . _ - and spaces. */
function personInitials(name) {
  const base = String(name || '').trim().split('@')[0];
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const ini = parts.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return /^[A-Z0-9]{1,2}$/.test(ini) ? ini : (ini ? ini.replace(/[^A-Z0-9]/g, '').slice(0, 2) || '?' : '?');
}

const VIA = Object.freeze({ access: 'via Cloudflare Access', header: 'via your sign-in proxy' });

/** Who the account corner names, from GET /api/whoami's answer (null when the call failed); dev's rule
 *  (ui/public/account-menu.mjs describeAccount), the same here so a live page never shows a demo name.
 *  shared (a real per-person sign-in): initials, the name up to "@", and the identity card with its `via`;
 *  operator (WORCA_IDENTITY_NAME, one person): initials and the name, no card;
 *  local, nobody, a failed call or an older server with no `shared` field: "P" and "Profile". */
export function describeAccount(who) {
  const raw = who && typeof who.name === 'string' ? who.name.trim() : '';
  const name = raw && raw !== 'local' ? raw : '';
  const short = name.split('@')[0] || name;
  if (name && who.shared === true) return { kind: 'shared', name, short, initials: personInitials(name), via: VIA[who.source] || '' };
  if (name && who.shared === false && who.source === 'operator') return { kind: 'operator', name, short, initials: personInitials(name), via: '' };
  return { kind: 'local', name: '', short: 'Profile', initials: 'P', via: '' };
}
