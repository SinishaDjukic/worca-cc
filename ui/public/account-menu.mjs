// ui/public/account-menu.mjs
// The account corner at the foot of the sidebar and the menu it opens (docs/ui-levels.md): the spend
// ring around the avatar, the spend card with its free-request row, who is signed in, and the away
// row. Pure: models, detached DOM and painters that write into the elements they are handed — no
// fetch, no listeners. app.js fetches, mounts and routes; every figure and name is painted as text.
import { BUDGET_WARN_AT, DEFAULT_FMT, fmtResetAt, periodWord, windowSaved, signedUsd, SAVED_NOTE } from './stats-view.mjs';
import { freeDailyRow } from './openrouter-free-view.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The avatar ring's radius (viewBox 0 0 38 38) and the spend card's mini ring (viewBox 0 0 20 20). */
export const RING_R = 17.5;
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

function ringSvg(doc, cls, size, r, ratio) {
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
      ` · resets ${fmtResetAt(b.windowEndMs)} — Claude Code client-side estimate (total_cost_usd), not authoritative billing` +
      (saved != null ? `. Saved this ${periodWord(b)}: ${signedUsd(fmt, saved)} (${SAVED_NOTE})` : '');
    const head = h(doc, 'div', 'mc-head');
    if (ring) head.appendChild(ringSvg(doc, 'mini-ring', 20, MINI_R, ring.ratio));
    head.appendChild(h(doc, 'span', 'mc-title', title));
    const go = h(doc, 'button', b.blocked ? 'mc-btn solid' : 'mc-btn', b.blocked ? 'Raise limit' : 'Details');
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
    const btn = h(doc, 'button', 'mi mc-free');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.dataset.nav = 'providers';
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

function limitPhrase(b, fmt) {
  if (!b) return '';
  if (!hasLimit(b)) return b.blocked ? 'new runs blocked' : '';
  const s = `${fmt.usd(b.windowSpendUsd)} of ${fmt.usd(b.totalLimitUsd)} spent ${spendPeriod(b)}`;
  return b.blocked ? `${s}, new runs blocked` : s;
}

/** The corner's accessible name and tooltip: who it is, then away and the limit, then what the menu holds. */
export function accountLabel(acct, { away = false, budget = null, fmt = DEFAULT_FMT } = {}) {
  const extra = [away ? 'away' : '', limitPhrase(budget, fmt)].filter(Boolean).join(' · ');
  const tail = extra ? ` · ${extra}` : '';
  const who = acct.kind === 'local' ? 'Profile' : acct.name;
  return {
    label: `${who}${tail}: ${MENU_WHAT}`,
    title: acct.kind === 'local' ? `Profile: ${MENU_WHAT}${tail}` : `${acct.name}${tail}`,
  };
}

/** Paint the corner button (#side-acct): the avatar's initials, the short name, the spend ring
 *  (data-spend none | ok | warn | over), the away dot (data-presence) and the label. */
export function paintAccountCorner(btn, acct, { budget = null, away = false, fmt = DEFAULT_FMT } = {}) {
  if (!btn) return;
  const ring = spendRing(budget);
  btn.dataset.account = acct.kind;
  btn.dataset.spend = ring ? (ring.tone || 'ok') : 'none';
  btn.dataset.presence = away ? 'away' : 'here';
  const arc = btn.querySelector('.acct-ring .arc');
  if (arc) arc.setAttribute('stroke-dasharray', ringDash(ring ? ring.ratio : 0, RING_R));
  const ava = btn.querySelector('.acct-ava');
  if (ava) ava.textContent = acct.initials;
  const name = btn.querySelector('.acct-name');
  if (name) name.textContent = acct.short;
  const { label, title } = accountLabel(acct, { away, budget, fmt });
  btn.setAttribute('aria-label', label);
  btn.title = title;
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

// ── The away row ─────────────────────────────────────────────────────────────

/** Here: a step-out arrow, where a sign-out would sit. Away: a home, to come back to. */
const AWAY_ICON_PATHS = Object.freeze({
  here: ['M10 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4', 'M15 16l4-4-4-4', 'M19 12H9'],
  away: ['M3.5 10.5L12 3.5l8.5 7', 'M5.5 9v11h13V9', 'M10 20v-5.5h4V20'],
});

/** Paint the away row (#acct-away) from describeAwayRow's answer. `busy`: a click is in flight;
 *  `err`: the last click's failure, kept in the tip until the next one. */
export function paintAwayRow(btn, row, { busy = false, err = '' } = {}) {
  if (!btn || !row) return;
  btn.dataset.state = row.state;
  btn.dataset.status = row.status;
  const ic = btn.querySelector('.mi-ic');
  if (ic) {
    const doc = btn.ownerDocument;
    ic.replaceChildren(...AWAY_ICON_PATHS[row.state === 'away' ? 'away' : 'here'].map((d) => {
      const p = doc.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      return p;
    }));
  }
  const label = btn.querySelector('.mi-lbl');
  if (label) label.textContent = row.label;
  const hint = btn.querySelector('.mi-hint');
  if (hint) hint.textContent = row.hint;
  btn.title = err ? `${row.tip} (Could not change it: ${err})` : row.tip;
  if (row.disabled || busy) btn.setAttribute('aria-disabled', 'true');
  else btn.removeAttribute('aria-disabled');
}
