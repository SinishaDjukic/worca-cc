// ui/public/usage-view.mjs
// The providers' plan-limit usage (GET /api/usage-limits) in the account corner: the two rings around the avatar
// (outer = Session, inner = Week, else Day; each the provider closest to its limit), the menu's Usage row and its
// Usage submenu ("Limits", one block per provider, one row per window). Pure: a model, texts and painters that write
// into the elements they are handed; every provider value is set as text. app.js fetches, mounts and routes.
// Rings are drawn only through account-menu.mjs (`ringSvg`, `ringDash`), which never imports this module.
import { ringSvg, ringDash, RING_R, INNER_R, MINI_R } from './account-menu.mjs';
import { BUDGET_WARN_AT } from './stats-view.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ENGINE_ORDER = ['claude', 'codex', 'gemini'];
/** The names on screen (the requirement's and the mocks'), not engineLabel's "OpenAI Codex". */
const NAMES = Object.freeze({ claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini' });
const KIND_ORDER = ['session', 'week', 'day'];
const LABELS = Object.freeze({ session: 'Session', week: 'Week', day: 'Day' });
const WARN_PCT = Math.round(BUDGET_WARN_AT * 100);

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** The answer's harnesses with only the windows still live at `now`; engines with none left, unknown engines and
 *  malformed windows are dropped. */
export function liveHarnesses(answer, now) {
  const list = answer && Array.isArray(answer.harnesses) ? answer.harnesses : [];
  const out = [];
  for (const h of list) {
    if (!h || !(h.engine in NAMES) || !Array.isArray(h.windows)) continue;
    const windows = h.windows.filter((w) => w && KIND_ORDER.includes(w.kind) && finite(w.pct) && finite(w.resetsAt) && w.resetsAt > now)
      .map((w) => ({ kind: w.kind, pct: Math.max(0, Math.min(100, Math.round(w.pct))), resetsAt: w.resetsAt }));
    if (windows.length) out.push({ engine: h.engine, observedAt: finite(h.observedAt) ? h.observedAt : null, windows });
  }
  return out;
}

/** Below the warning line neutral, at it amber, full red. */
export function usageTone(pct) {
  return pct >= 100 ? 'over' : pct >= WARN_PCT ? 'warn' : 'ok';
}

/** The entry closest to its limit: highest pct, then the earlier reset, then claude, codex, gemini. */
export function pickTightest(entries) {
  let best = null;
  for (const e of entries || []) {
    if (!best || e.pct > best.pct || (e.pct === best.pct && (e.resetsAt < best.resetsAt
      || (e.resetsAt === best.resetsAt && ENGINE_ORDER.indexOf(e.engine) < ENGINE_ORDER.indexOf(best.engine))))) best = e;
  }
  return best;
}

const slotOf = (engine, w) => (w ? { engine, name: NAMES[engine], kind: w.kind, pct: w.pct, tone: usageTone(w.pct), resetsAt: w.resetsAt } : null);

/** `{ session, long, row, blocks }`: the outer ring's slot, the inner ring's (each engine's week, else its day), the
 *  Usage row's (every window) and the submenu's blocks in engine order. */
export function usageModel(answer, { now = Date.now() } = {}) {
  const hs = liveHarnesses(answer, now).sort((a, b) => ENGINE_ORDER.indexOf(a.engine) - ENGINE_ORDER.indexOf(b.engine));
  const sessions = [];
  const longs = [];
  const all = [];
  for (const h of hs) {
    const by = Object.fromEntries(h.windows.map((w) => [w.kind, w]));
    if (by.session) sessions.push(slotOf(h.engine, by.session));
    const long = by.week || by.day;
    if (long) longs.push(slotOf(h.engine, long));
    for (const w of h.windows) all.push(slotOf(h.engine, w));
  }
  return {
    session: pickTightest(sessions),
    long: pickTightest(longs),
    row: pickTightest(all),
    blocks: hs.map((h) => ({ engine: h.engine, name: NAMES[h.engine], observedAt: h.observedAt,
      windows: KIND_ORDER.flatMap((k) => h.windows.filter((w) => w.kind === k))
        .map((w) => ({ kind: w.kind, label: LABELS[w.kind], pct: w.pct, tone: usageTone(w.pct), resetsAt: w.resetsAt })) })),
  };
}

/** "86%", or "Reached" at 100. */
export function pctText(pct) {
  return pct >= 100 ? 'Reached' : `${pct}%`;
}

function fmt(locale, timeZone, o) {
  try { return new Intl.DateTimeFormat(locale, { ...o, ...(timeZone ? { timeZone } : {}) }); }
  catch { return new Intl.DateTimeFormat(undefined, o); }
}
const timeOf = (ms, { locale, timeZone } = {}) => fmt(locale, timeZone, { hour: '2-digit', minute: '2-digit' }).format(ms);
const dayKey = (ms, timeZone) => fmt('en-CA', timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

/** "14:50" when the reset is today, "Thu 09:00" otherwise, in the person's locale. */
export function resetText(ms, { now = Date.now(), locale, timeZone } = {}) {
  if (!finite(ms)) return '';
  const t = timeOf(ms, { locale, timeZone });
  if (dayKey(ms, timeZone) === dayKey(now, timeZone)) return t;
  return `${fmt(locale, timeZone, { weekday: 'short' }).format(ms)} ${t}`;
}

/** "as of" is always the time alone. */
export function asOfText(ms, { locale, timeZone } = {}) {
  return finite(ms) ? timeOf(ms, { locale, timeZone }) : '';
}

/** One accessible-name part per drawn ring: "Session · Codex: 86%, resets 14:50". */
export function ringParts(model, opts = {}) {
  return [model && model.session, model && model.long].filter(Boolean)
    .map((s) => `${LABELS[s.kind]} · ${s.name}: ${pctText(s.pct)}, resets ${resetText(s.resetsAt, opts)}`);
}

/** The avatar's rings: data-usage-s / data-usage-l (none | ok | warn | over) and each arc's fill. A slot nobody
 *  reports has no dasharray (and the CSS draws no ring for `none`). */
export function paintUsageRings(btn, model) {
  if (!btn) return;
  for (const [key, slot, cls, r] of [['usageS', model && model.session, '.ring-s .arc', RING_R], ['usageL', model && model.long, '.ring-l .arc', INNER_R]]) {
    btn.dataset[key] = slot ? slot.tone : 'none';
    const arc = btn.querySelector(cls);
    if (!arc) continue;
    if (slot) arc.setAttribute('stroke-dasharray', ringDash(slot.pct / 100, r));
    else arc.removeAttribute('stroke-dasharray');
  }
}

function el(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function chevron(doc) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'mi-chev');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = doc.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', 'M9 6l6 6-6 6');
  svg.appendChild(p);
  return svg;
}

/** The menu's Usage row (#acct-usage): a mini ring of the tightest window, "Usage", "Codex 86%" and a chevron.
 *  Hidden with its section when nobody reports. */
export function paintUsageRow(row, model, { doc = globalThis.document } = {}) {
  if (!row) return;
  const sect = row.closest('.usage-sect');
  const slot = model && model.row;
  row.hidden = !slot;
  if (sect) sect.hidden = !slot;
  if (!slot) { row.removeAttribute('data-tone'); return; }
  row.dataset.tone = slot.tone;
  row.replaceChildren(ringSvg(doc, 'mini-ring', 20, MINI_R, slot.pct / 100), el(doc, 'span', 'mi-lbl', 'Usage'),
    el(doc, 'span', 'mi-val', `${slot.name} ${pctText(slot.pct)}`), chevron(doc));
}

/** The Usage submenu (#usage-menu): "Limits" (a heading, not an item), then per provider a group named
 *  "Codex, as of 14:28" with one menuitem row per window. Repaints in place, keeping focus on the same row. */
export function renderUsageMenu(menu, model, { doc = globalThis.document, now = Date.now(), locale, timeZone } = {}) {
  if (!menu) return;
  const a = doc.activeElement;
  const focused = a && menu.contains(a) && a.dataset ? { engine: a.dataset.engine, kind: a.dataset.kind } : null;
  const opts = { now, locale, timeZone };
  const head = el(doc, 'div', 'nav-fly-k', 'Limits');
  head.setAttribute('aria-hidden', 'true');
  const parts = [head];
  for (const b of (model && model.blocks) || []) {
    const asOf = asOfText(b.observedAt, opts);
    const group = el(doc, 'div', 'uw-block');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', asOf ? `${b.name}, as of ${asOf}` : b.name);
    group.dataset.engine = b.engine;
    const bh = el(doc, 'div', 'uw-head');
    bh.setAttribute('aria-hidden', 'true');
    bh.append(el(doc, 'span', 'uw-name', b.name), el(doc, 'span', 'uw-asof', asOf ? `as of ${asOf}` : ''));
    group.appendChild(bh);
    for (const w of b.windows) {
      const r = el(doc, 'div', 'menu-item uw-row');
      r.setAttribute('role', 'menuitem');
      r.setAttribute('tabindex', '-1');
      r.title = `Reported by ${b.name}`;
      r.dataset.tone = w.tone;
      r.dataset.engine = b.engine;
      r.dataset.kind = w.kind;
      r.append(ringSvg(doc, 'mini-ring', 20, MINI_R, w.pct / 100), el(doc, 'span', 'uw-kind', w.label),
        el(doc, 'span', 'uw-pct', pctText(w.pct)), el(doc, 'span', 'uw-reset', `resets ${resetText(w.resetsAt, opts)}`));
      group.appendChild(r);
    }
    parts.push(group);
  }
  menu.replaceChildren(...parts);
  if (focused) {
    const same = [...menu.querySelectorAll('.uw-row')].find((r) => r.dataset.engine === focused.engine && r.dataset.kind === focused.kind);
    (same || menu.querySelector('.uw-row'))?.focus();
  }
}
