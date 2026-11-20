// ui/public/account-menu.mjs
// The account corner at the foot of the sidebar and the menu it opens (docs/ui-levels.md): the
// spend card with its free-request row, who is signed in, and the away
// row. Pure: models, detached DOM and painters that write into the elements they are handed — no
// fetch, no listeners. app.js fetches, mounts and routes; every figure and name is painted as text.
import { BUDGET_WARN_AT, DEFAULT_FMT, fmtResetAt, periodWord, windowSaved, signedUsd, SAVED_NOTE } from './stats-view.mjs';
import { freeDailyRow } from './openrouter-free-view.mjs';
import { ICONS, iconSvg } from './icons.mjs';
import { setAvatarSrc, tooltipModel } from './worca-level/model.mjs';
import { renderSegments } from './worca-level/segments.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The avatar's outer ring radius (viewBox 0 0 38 38), its inner ring's (the usage rings' long window) and the
 *  mini ring's (viewBox 0 0 20 20: the spend card, the Usage row and submenu). */
export const RING_R = 17.5;
export const INNER_R = 14;
export const MINI_R = 7.5;

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const hasLimit = (b) => !!b && typeof b.totalLimitUsd === 'number' && Number.isFinite(b.totalLimitUsd);

/** Spend against the total limit: null without one, else { ratio 0..1, tone '' | 'warn' | 'over' }.
 *  Blocked is full and red whatever the figures say, with or without a limit: a block is never hidden. */
export function spendRing(budget) {
  const b = budget || {};
  if (b.blocked) return { ratio: 1, tone: 'over' };
  if (!hasLimit(b)) return null;
  const spent = Number(b.windowSpendUsd) || 0;
  const raw = b.totalLimitUsd > 0 ? spent / b.totalLimitUsd : (spent > 0 ? 1 : 0);
  const ratio = Math.max(0, Math.min(1, raw));
  return { ratio, tone: ratio >= BUDGET_WARN_AT ? 'warn' : '' };
}

/** stroke-dasharray for an arc that fills `ratio` (clamped 0..1) of a circle of radius `r`. */
export function ringDash(ratio, r) {
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, Number(ratio) || 0));
  return `${(f * c).toFixed(2)} ${c.toFixed(2)}`;
}

/** "in October", "this week", or "this month" when the payload has no bounds. The server's monthly
 *  window is a calendar month in ITS zone, so the window's midpoint names it in any browser zone; with
 *  one bound, the start or the instant before the exclusive end. */
export function spendPeriod(b) {
  if (periodWord(b) === 'week') return 'this week';
  const start = Number.isFinite(b && b.windowStartMs), end = Number.isFinite(b && b.windowEndMs);
  const ms = start && end ? (b.windowStartMs + b.windowEndMs) / 2
    : start ? b.windowStartMs : end ? b.windowEndMs - 1 : null;
  return ms == null ? 'this month' : `in ${MONTHS[new Date(ms).getMonth()]}`;
}

/** A ring as an SVG: a track and an arc filling `ratio` of it. The one ring builder (usage-view.mjs draws with it). */
export function ringSvg(doc, cls, size, r, ratio) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');
  for (const part of ['trk', 'arc']) {
    const c = doc.createElementNS(SVG_NS, 'circle');
    c.setAttribute('class', part);
    c.setAttribute('cx', String(size / 2));
    c.setAttribute('cy', String(size / 2));
    c.setAttribute('r', String(r));
    if (part === 'arc') c.setAttribute('stroke-dasharray', ringDash(ratio, r));
    svg.appendChild(c);
  }
  return svg;
}

/** The spend card at the top of the account menu (shown at every interface mode). Without a limit:
 *  Spent and Saved; with one: Limit and Spent, and a mini ring. "Details" opens Statistics; blocked,
 *  a solid "Raise limit" opens Settings › Runs at the budget card, with the reset in a note. The
 *  OpenRouter free-request row closes the card when there is one. null when there is nothing yet. */
export function renderSpendCard(budget, { doc = globalThis.document, fmt = DEFAULT_FMT, free = null, now = Date.now() } = {}) {
  const fr = freeDailyRow(free, { now });
  if (!budget && !fr) return null;
  const card = h(doc, 'div', 'mcard spend-card');
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Spend');
  if (budget) {
    const b = budget;
    const ring = spendRing(b);
    const limit = hasLimit(b);
    const saved = limit ? null : windowSaved(b);
    const title = `Spend ${spendPeriod(b)}`;
    card.setAttribute('aria-label', title);
    card.dataset.spend = ring ? (ring.tone || 'ok') : 'none';
    card.title = `Estimated spend this ${periodWord(b)}: ${fmt.usd4(b.windowSpendUsd)}` +
      (limit ? ` of ${fmt.usd(b.totalLimitUsd)}` : '') +
      ` · resets ${fmtResetAt(b.windowEndMs)}. Claude Code client-side estimate (total_cost_usd), not authoritative billing` +
      (saved != null ? `. Saved this ${periodWord(b)}: ${signedUsd(fmt, saved)} (${SAVED_NOTE})` : '');
    const head = h(doc, 'div', 'mc-head');
    if (ring) head.appendChild(ringSvg(doc, 'mini-ring', 20, MINI_R, ring.ratio));
    head.appendChild(h(doc, 'span', 'mc-title', title));
    const go = h(doc, 'button', b.blocked ? 'btn btn-sm btn-primary mc-btn' : 'btn btn-sm mc-btn', b.blocked ? 'Raise limit' : 'Details');
    go.type = 'button';
    go.setAttribute('role', 'menuitem');
    go.dataset.nav = b.blocked ? 'settings' : 'stats';
    if (b.blocked) go.dataset.hash = 'settings/runs/budget';
    head.appendChild(go);
    card.appendChild(head);
    const dl = h(doc, 'dl', 'mc-rows');
    const row = (k, v, tone = '') => { dl.appendChild(h(doc, 'dt', '', k)); dl.appendChild(h(doc, 'dd', tone, v)); };
    if (limit) {
      row('Limit', fmt.usd(b.totalLimitUsd));
      row('Spent', fmt.usd(b.windowSpendUsd), ring.tone);
    } else {
      row('Spent', fmt.usd(b.windowSpendUsd));
      if (saved != null) row('Saved', signedUsd(fmt, saved), saved >= 0 ? 'pos' : '');
    }
    card.appendChild(dl);
    if (b.blocked) card.appendChild(h(doc, 'p', 'mc-note', `New runs are blocked until ${fmtResetAt(b.windowEndMs)}.`));
  }
  if (fr) {
    const btn = h(doc, 'button', 'mi menu-item mc-free');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.dataset.nav = 'models';
    btn.dataset.hash = 'models/providers/openrouter';
    if (fr.tone) btn.dataset.tone = fr.tone;
    btn.title = fr.title;
    btn.appendChild(h(doc, 'span', 'mi-lbl', 'Free requests today'));
    btn.appendChild(h(doc, 'span', 'mi-val', fr.text));
    card.appendChild(btn);
  }
  return card;
}

// ── Who is looking ───────────────────────────────────────────────────────────

/** Up to two initials: an email's local part (or a display name) split on . _ - and spaces. */
export function personInitials(name) {
  const base = String(name || '').trim().split('@')[0];
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const ini = parts.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return /^[A-Z0-9]{1,2}$/.test(ini) ? ini : (ini ? ini.replace(/[^A-Z0-9]/g, '').slice(0, 2) || '?' : '?');
}

const VIA = Object.freeze({ access: 'via Cloudflare Access', header: 'via your sign-in proxy' });

/** What the corner shows for GET /api/whoami's answer (null when the call failed).
 *  shared (a real per-person sign-in): initials, the name up to "@", and the identity card;
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

const MENU_WHAT = 'spend, away mode, interface mode and settings';
const MENU_WHAT_USAGE = 'spend, usage, away mode, interface mode and settings';

/** The avatar no longer shows spend (the spend card does), but a block is never hidden: it still names it. */
function limitPhrase(b) {
  return b && b.blocked ? 'new runs blocked' : '';
}

/** The corner's accessible name and tooltip: who it is, then away, a block and each drawn usage ring (usage-view.mjs
 *  `ringParts`), then the level, then what the menu holds. */
export function accountLabel(acct, { away = false, budget = null, level = '', usageParts = [] } = {}) {
  const usage = (usageParts || []).filter(Boolean).join('; ');
  const extra = [away ? 'away' : '', limitPhrase(budget), usage, level].filter(Boolean).join(' · ');
  const tail = extra ? ` · ${extra}` : '';
  const who = acct.kind === 'local' ? 'Profile' : acct.name;
  const what = usage ? MENU_WHAT_USAGE : MENU_WHAT;
  return {
    label: `${who}${tail}: ${what}`,
    title: acct.kind === 'local' ? `Profile: ${what}${tail}` : `${acct.name}${tail}`,
  };
}

const ART_KEY = /([a-z][a-z0-9-]*)\.svg$/;

/** The level key the art belongs to: the one the caller names, else the art file's own name. */
function levelKey(avatar) {
  if (avatar.key) return avatar.key;
  const m = ART_KEY.exec(avatar.src);
  return m ? m[1] : '';
}

/** Fill .acct-ava with the level image (kept as is while its src is unchanged, so a repaint does not
 *  flicker) or, without one, the person's initials. data-worca-level lets the CSS tint the initials
 *  fallback with the level's ink. The only writer of .acct-ava. */
function paintAvatar(ava, acct, avatar) {
  if (!avatar) {
    ava.removeAttribute('data-worca-level');
    ava.textContent = acct.initials;
    return;
  }
  const key = levelKey(avatar);
  if (key) ava.setAttribute('data-worca-level', key);
  else ava.removeAttribute('data-worca-level');
  const cur = ava.firstElementChild;
  const img = cur && cur.tagName === 'IMG' && ava.childNodes.length === 1 ? cur : ava.ownerDocument.createElement('img');
  if (img.getAttribute('src') !== avatar.src) img.setAttribute('src', avatar.src);
  img.setAttribute('alt', avatar.alt);
  if (img.parentNode !== ava) ava.replaceChildren(img);
}

/** Paint the corner button (#side-acct): the avatar (the level image when `avatar` {src, alt} is given,
 *  else the initials), the short name, the away badge with its walking person (data-presence) and the label.
 *  The usage rings are usage-view.mjs `paintUsageRings`; their texts come in as `usageParts`. With an image the
 *  aria-label also names the level, and the native title carries only a block and the usage parts (none: no title). */
export function paintAccountCorner(btn, acct, { budget = null, away = false, avatar = null, usageParts = [] } = {}) {
  if (!btn) return;
  btn.dataset.account = acct.kind;
  btn.removeAttribute('data-spend');
  btn.dataset.presence = away ? 'away' : 'here';
  const dot = btn.querySelector('.acct-dot');
  if (dot && !dot.firstChild) dot.innerHTML = iconSvg('stepped-out', 8);   // the icon set's own literal, never data
  const ava = btn.querySelector('.acct-ava');
  const shown = avatar && typeof avatar.src === 'string' && avatar.src
    ? { src: avatar.src, alt: String(avatar.alt || ''), key: typeof avatar.key === 'string' ? avatar.key : '' }
    : null;
  if (ava) paintAvatar(ava, acct, shown);
  const name = btn.querySelector('.acct-name');
  if (name) name.textContent = acct.short;
  const { label, title } = accountLabel(acct, { away, budget, level: shown ? shown.alt : '', usageParts });
  btn.setAttribute('aria-label', label);
  if (!shown) { btn.title = title; return; }
  const tip = [limitPhrase(budget), (usageParts || []).filter(Boolean).join('; ')].filter(Boolean).join(' · ');
  if (tip) btn.title = tip;
  else btn.removeAttribute('title');
}

/** The identity card (#acct-id): "Signed in as", the full value and how; a shared identity only. */
export function paintIdentityCard(card, acct) {
  if (!card) return;
  const shared = acct.kind === 'shared';
  card.hidden = !shared;
  const name = card.querySelector('.id-name');
  if (name) name.textContent = shared ? acct.name : '';
  const via = card.querySelector('.id-via');
  if (via) via.textContent = shared ? acct.via : '';
}

// ── Your level ───────────────────────────────────────────────────────────────

const CARD_AVATAR_PX = 22;
const TOP_NOTE = "You've reached the top level.";

/** The level card, the account menu's first item: a 22px avatar, the level name and
 *  "View level"; then "To <Next>" with the progress ("1 of 4", or "12 of 30 days"); then small segments.
 *  At the top level it says so instead, with no second row and no segments. The progress is in the
 *  button's accessible name, so the segments are aria-hidden. Opens #profile/level. No data-min-level:
 *  every interface mode reaches it. null until the level view has loaded. app-wiring mounts it. */
export function renderLevelCard(view, { doc = globalThis.document } = {}) {
  const level = view && view.level;
  if (!level || typeof level.name !== 'string' || !level.name) return null;
  const m = tooltipModel(view);
  const card = h(doc, 'button', 'wl-card');
  card.type = 'button';
  card.id = 'acct-level-card';
  card.setAttribute('role', 'menuitem');
  card.dataset.nav = 'profile';
  card.dataset.hash = 'profile/level';

  const head = h(doc, 'span', 'wl-card-head');
  const img = h(doc, 'img', 'wl-card-ava');
  setAvatarSrc(img, level.avatar);
  img.setAttribute('alt', '');
  img.setAttribute('width', String(CARD_AVATAR_PX));
  img.setAttribute('height', String(CARD_AVATAR_PX));
  head.append(img, h(doc, 'span', 'wl-card-name', m.name), h(doc, 'span', 'wl-card-go', 'View level'));
  card.appendChild(head);

  if (m.topLine || !m.nextName) {
    card.appendChild(h(doc, 'span', 'wl-card-top', TOP_NOTE));
    card.setAttribute('aria-label', `${m.name}, you've reached the top level. View level`);
    return card;
  }
  const row = h(doc, 'span', 'wl-card-row');
  row.appendChild(h(doc, 'span', 'wl-card-next', `To ${m.nextName}`));
  if (m.segments) row.appendChild(h(doc, 'b', 'wl-card-prog', view.progress.unit === 'days' ? m.progressText : `${m.segments.done} of ${m.segments.total}`));
  card.appendChild(row);
  if (m.segments) {
    const seg = renderSegments(doc, m.segments, { size: 'sm' });
    seg.setAttribute('aria-hidden', 'true');
    card.appendChild(seg);
  }
  const progress = m.progressText ? `, ${m.progressText}` : '';
  card.setAttribute('aria-label', `${m.name}, to ${m.nextName}${progress}. View level`);
  return card;
}

// ── The away row ─────────────────────────────────────────────────────────────

/** The away row's icon: a person walking out (a step-out arrow read as Sign out; a moon read as dark
 *  mode, the appearance switcher's own icon), the same person as the corner's away badge. One icon in
 *  both states: the switch at the row's right edge shows whether you are away. */
const AWAY_ICON_PATHS = Object.freeze([...ICONS['stepped-out'].matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]));

/** Fill the Appearance row's empty `svg.mi-ic` placeholder with ICONS.appearance, as SVG-namespace nodes
 *  (the markup is parsed with an xmlns, so the circle and path render). No-op on null or a filled one. */
export function paintAppearanceIcon(svg) {
  if (!svg || svg.firstChild) return;
  const doc = svg.ownerDocument;
  const parsed = new doc.defaultView.DOMParser().parseFromString(`<svg xmlns="${SVG_NS}">${ICONS.appearance}</svg>`, 'image/svg+xml');
  svg.replaceChildren(...[...parsed.documentElement.childNodes].map((node) => doc.importNode(node, true)));
}

/** Paint the away row (#acct-away, a menuitemcheckbox: checked = away) from describeAwayRow's answer.
 *  The label stays "Away"; aria-checked carries the state. `busy`: a click is in flight; `err`: the last
 *  click's failure, kept in the tip (title and aria-description) until the next one. */
export function paintAwayRow(btn, row, { busy = false, err = '' } = {}) {
  if (!btn || !row) return;
  btn.dataset.state = row.state;
  btn.dataset.status = row.status;
  btn.setAttribute('aria-checked', String(row.state === 'away'));
  const ic = btn.querySelector('.mi-ic');
  if (ic && !ic.firstChild) {
    const doc = btn.ownerDocument;
    ic.replaceChildren(...AWAY_ICON_PATHS.map((d) => {
      const p = doc.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      return p;
    }));
  }
  const hint = btn.querySelector('.mi-hint');
  if (hint) hint.textContent = row.hint;
  const tip = err ? `${row.tip} (Could not change it: ${err})` : row.tip;
  btn.title = tip;
  btn.setAttribute('aria-description', tip);
  if (row.disabled || busy) btn.setAttribute('aria-disabled', 'true');
  else btn.removeAttribute('aria-disabled');
}
