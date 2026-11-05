// src/shared/review/quality.mjs — review quality per role (#990 slice 6). One run's summary of its role reviews, and the
// totals over many runs, built only from structured role-record counts (`roleCounts`: the stored counts, else derived
// from finding statuses). No title, fix, reason, section or summary is ever read. Pure and browser-safe.
import { roleCounts } from './findings.mjs';

export const REVIEW_STATS_VERSION = 1;
export const MAX_ROLE_ROWS = 200;

const KEY_MAX = 40;
const LABEL_MAX = 80;
const TARGETS = ['plan', 'diff'];
const NUMBERS = ['reviews', 'raised', 'fixed', 'disputed', 'open'];
const COUNT_KEYS = ['raised', 'fixed', 'disputed', 'open'];
const targetOf = (round) => (round?.target === 'diff' ? 'diff' : 'plan');   // a round saved without one reads as the plan
const labelOf = (label, key) => (typeof label === 'string' && label ? label.slice(0, LABEL_MAX) : key);
const rowKey = (target, role) => `${target}\u0000${role}`;

/** `state.roleReviews` → { v, roles: [{ target, role, label, reviews, raised, fixed, disputed, open }] }, one entry per
 *  (target, role); null when no role record was reviewed. A skipped record (a copy of the last round's) counts nothing. */
export function runReviewStats(roleReviews) {
  if (!roleReviews || typeof roleReviews !== 'object' || !Array.isArray(roleReviews.rounds)) return null;
  const rows = new Map();
  for (const round of roleReviews.rounds) {
    const target = targetOf(round);
    for (const r of Array.isArray(round?.roles) ? round.roles : []) {
      if (!r || r.skipped || typeof r.key !== 'string' || !r.key) continue;
      const k = rowKey(target, r.key);
      if (!rows.has(k)) rows.set(k, { target, role: r.key, label: r.key, reviews: 0, raised: 0, fixed: 0, disputed: 0, open: 0 });
      const row = rows.get(k);
      if (typeof r.label === 'string' && r.label) row.label = labelOf(r.label, r.key);
      row.reviews += 1;
      const c = roleCounts(r);
      for (const n of COUNT_KEYS) row[n] += c[n];
    }
  }
  return rows.size ? { v: REVIEW_STATS_VERSION, roles: [...rows.values()] } : null;
}

const validEntry = (e) => !!e && typeof e === 'object' && TARGETS.includes(e.target)
  && typeof e.role === 'string' && e.role.length >= 1 && e.role.length <= KEY_MAX
  && NUMBERS.every((n) => Number.isInteger(e[n]) && e[n] >= 0);

/** Run summaries, newest first → [{ target, role, label, runs, reviews, raised, fixed, disputed, open }], plan rows
 *  before diff rows, then by label. An unknown version or an invalid entry is dropped; at most MAX_ROLE_ROWS rows. */
export function aggregateReviewQuality(summaries) {
  const rows = new Map();
  for (const s of Array.isArray(summaries) ? summaries : []) {
    if (s?.v !== REVIEW_STATS_VERSION || !Array.isArray(s.roles)) continue;
    for (const e of s.roles) {
      if (!validEntry(e)) continue;
      const k = rowKey(e.target, e.role);
      if (!rows.has(k)) {
        if (rows.size >= MAX_ROLE_ROWS) continue;
        rows.set(k, { target: e.target, role: e.role, label: labelOf(e.label, e.role), runs: 0, reviews: 0, raised: 0, fixed: 0, disputed: 0, open: 0 });
      }
      const row = rows.get(k);
      row.runs += 1;
      for (const n of NUMBERS) row[n] += e[n];
    }
  }
  return [...rows.values()].sort((a, b) => TARGETS.indexOf(a.target) - TARGETS.indexOf(b.target)
    || a.label.localeCompare(b.label) || (a.role < b.role ? -1 : a.role > b.role ? 1 : 0));
}
