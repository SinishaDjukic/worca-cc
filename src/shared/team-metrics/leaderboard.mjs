// src/shared/team-metrics/leaderboard.mjs
// Team metrics → By person → Leaderboard. PURE: no I/O, no node: imports — the browser ranks the
// records it already holds (plus the PR states the Timeline path resolved). Each part of the score
// is compared with the best person on the team in the same period, so a score says "how close to
// the best of the team", not "how big is the team".
import { resolveRange } from './aggregate.mjs';

export const LEADERBOARD_WEIGHTS = Object.freeze({ merged: 35, success: 35, runs: 15, perRun: 15 });
export const LEADERBOARD_MIN_RUNS = 3;
export const LEADERBOARD_RANGES = Object.freeze(['this-month', 'last-month', 'quarter', 'year', 'all']);
const PHASE = { 'this-month': 'open', quarter: 'open', year: 'open', 'last-month': 'closed', all: 'all-time' };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round1 = (v) => Math.round(v * 10) / 10;

/** Ids of the runs whose pull request merged. `prMap` is a Map or a plain object of runId → PR[] | null. */
export function mergedRunIds(prMap, records = []) {
  const out = new Set();
  if (!prMap) return out;
  const get = prMap instanceof Map ? (id) => prMap.get(id) : (id) => prMap[id];
  for (const r of records) {
    const prs = get(r.id);
    if (Array.isArray(prs) && prs.some((p) => String(p?.state).toUpperCase() === 'MERGED')) out.add(r.id);
  }
  return out;
}

/** The window of a leaderboard range ({startMs, endMs}, null for 'all'); RangeError for anything else, custom included. */
function windowOf(range, now) {
  if (!LEADERBOARD_RANGES.includes(range)) throw new RangeError(`unknown leaderboard range "${range}" (expected ${LEADERBOARD_RANGES.join(' | ')})`);
  return resolveRange(range, { now });
}

/** The records a leaderboard for `range` ranks: a named person, started inside the window. */
export function leaderboardRecords(records, range, now = Date.now()) {
  const { startMs, endMs } = windowOf(range, now);
  return (records || []).filter((r) => {
    if (typeof r?.actor !== 'string' || !r.actor) return false;
    const t = Date.parse(r.startedAt);
    return Number.isFinite(t) && (startMs == null || t >= startMs) && (endMs == null || t < endMs);
  });
}

export function buildLeaderboard(records, { range, now = Date.now(), mergedRunIds: merged = new Set(), minRuns = LEADERBOARD_MIN_RUNS } = {}) {
  const { startMs, endMs } = windowOf(range, now);
  const people = new Map();
  const inWindow = leaderboardRecords(records, range, now);
  const totalRuns = inWindow.length;
  for (const r of inWindow) {
    let p = people.get(r.actor);
    if (!p) people.set(r.actor, (p = { key: r.actor, label: r.actor, runs: 0, done: 0, merged: 0, costed: 0, usd: 0 }));
    p.runs++;
    if (r.result === 'done') p.done++;
    if (merged.has(r.id)) p.merged++;
    if (isNum(r.cost?.usd)) { p.costed++; p.usd += r.cost.usd; }
  }
  const all = [...people.values()];
  const pool = all.filter((p) => p.runs >= minRuns).map((p) => ({
    ...p, perRunUsd: p.costed ? p.usd / p.costed : null, successRate: p.done / p.runs,
  }));
  const notEligible = all.filter((p) => p.runs < minRuns)
    .map((p) => ({ key: p.key, label: p.label, runs: p.runs, needs: minRuns - p.runs }))
    .sort((a, b) => b.runs - a.runs || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const out = { range, startMs, endMs, phase: PHASE[range], status: 'ranked', totalRuns, rows: [], notEligible, winners: [] };
  if (!totalRuns) { out.status = 'no-runs'; return out; }
  if (!pool.length) { out.status = 'none-eligible'; return out; }

  const max = (f) => pool.reduce((m, p) => Math.max(m, f(p)), 0);
  const maxN = max((p) => p.runs);
  const maxM = max((p) => p.merged);
  const maxS = max((p) => p.successRate);
  const positive = pool.map((p) => p.perRunUsd).filter((v) => v > 0);
  const bestPerRun = positive.length ? Math.min(...positive) : null;
  const W = LEADERBOARD_WEIGHTS;
  const part = (share, weight) => ({ points: share * weight, weight });
  const rows = pool.map((p) => {
    const perRunShare = p.perRunUsd == null ? 0 : p.perRunUsd === 0 ? 1 : bestPerRun / p.perRunUsd;
    const parts = {
      runs: part(p.runs / maxN, W.runs),
      perRun: part(perRunShare, W.perRun),
      merged: part(maxM ? p.merged / maxM : 0, W.merged),
      success: part(maxS ? p.successRate / maxS : 0, W.success),
    };
    const score = parts.runs.points + parts.perRun.points + parts.merged.points + parts.success.points;
    return { key: p.key, label: p.label, rank: 0, score, runs: p.runs, costed: p.costed, perRunUsd: p.perRunUsd, merged: p.merged, successRate: p.successRate, parts };
  });
  rows.sort((a, b) => round1(b.score) - round1(a.score) || b.score - a.score || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  rows.forEach((row, i) => {
    row.rank = i > 0 && round1(row.score) === round1(rows[i - 1].score) ? rows[i - 1].rank : i + 1;
  });
  out.rows = rows;
  out.winners = rows.filter((r) => r.rank === 1).map((r) => r.key);
  return out;
}

const PR_PROVIDERS = Object.freeze([
  { name: 'GitHub', state: 'gh', error: 'ghError' },
  { name: 'Azure DevOps', state: 'azure', error: 'azureError' },
  { name: 'Bitbucket', state: 'bitbucket', error: 'bitbucketError' },
]);
const PROVIDER_DOWN = Object.freeze(['missing', 'unauthenticated']);

/**
 * What kept the pull-request lookup (prs.mjs resolveRunPrs `status`) from a full answer: the providers that
 * could not answer (no CLI or token, a refused token, or an error), and the Azure DevOps repositories whose
 * listing was cut short. Runs behind either count as not merged, so the card says so.
 * @returns {{ providers: string[], truncated: string[] }}
 */
export function mergedLookupGaps(status) {
  const st = status || {};
  const providers = PR_PROVIDERS.filter((p) => !!st[p.error] || PROVIDER_DOWN.includes(st[p.state])).map((p) => p.name);
  const truncated = Array.isArray(st.azureTruncated) ? [...st.azureTruncated] : [];
  return { providers, truncated };
}
