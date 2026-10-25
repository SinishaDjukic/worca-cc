// src/core/stats.mjs
// Statistics over ALL pipeline records — archived included, deliberately: the
// archive exists so these numbers survive history cleanup (spec §6.9). Pure
// synchronous DB reads; no gh, no git, offline-correct.
//
// Attribution: money = cost_ledger + ask_cost_ledger + req_cost_ledger by event timestamp
// (exact); runs, time, and PRs = cohort by started_at (a run belongs to the
// bucket its start falls in, with its CURRENT status). 'today' differs: its totals count runs whose
// lifespan [started_at, updated_at] overlaps the day ("active today"), and its
// hourly bars attribute terminal outcomes to the hour of the terminal write
// (updated_at). 'all' money/time use the fallback-aware pipelines sums so
// pre-ledger history still counts. 'lastMonth' is the previous calendar month and 'custom' a
// local [from, to] day range; both read money from the ledger like week/month. A filter (tags AND-ed,
// person) narrows every number and drops Ask Worca and Requirements spend; groupBy splits the window into rows
// (tag value or person) that reconcile exactly with the Spent total.

import { prepare } from './db.mjs';
import { flagEnabled } from './flags.mjs';
import { parseTag, formatTag, MAX_TAGS, TAG_KEY_RE } from '../shared/run-tags.mjs';
import { actorLabel } from './identity.mjs';
import { readTagsFor } from './run-tags-store.mjs';
import {
  budgetStatus, costWindowStart, costWindowEnd, allTimeTotals, roundUsd,
  askWindowedSpendUsd, requirementsWindowedSpendUsd, utilityTotals,
} from './cost-budget.mjs';
import { savedUsd } from '../shared/human-estimate.mjs';
import { effectiveHumanRateUsd } from './human-rate.mjs';

const RANGES = ['today', 'week', 'month', 'lastMonth', 'custom', 'all'];
const DAY_MS = 86400000;
const MAX_CUSTOM_MS = 5 * 366 * DAY_MS;

function hourStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()); }
function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

/** 'YYYY-MM-DD' → local midnight, or RangeError (rejects 2026-02-30 by round-tripping). */
function localDay(s, name) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  if (!d || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) throw new RangeError(`${name} must be a date YYYY-MM-DD`);
  return d;
}

/** Custom window [from 00:00, to+1 00:00), local time. */
function customWindow(from, to) {
  const start = localDay(from, 'from');
  const last = localDay(to, 'to');
  if (last < start) throw new RangeError('to is before from');
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  if (end - start > MAX_CUSTOM_MS) throw new RangeError('a custom range is at most 5 years');
  return { start, end };
}

const NO_FILTER = Object.freeze({ tags: [], person: null });
const EMPTY_ASK = Object.freeze({ spendUsd: 0, sessions: 0, turns: 0 });
// Requirements spend (plans/requirements-design.md D9) is per feature, not per run: like Chat, a filter drops it.
const EMPTY_REQUIREMENTS = Object.freeze({ spendUsd: 0, features: 0 });
const isFiltered = (f) => f.tags.length > 0 || f.person != null;

/** Request filter → { tags: normalised, deduplicated, person|null }. @throws {RangeError} */
export function normaliseStatsFilter(filter = {}) {
  const tags = [];
  for (const raw of [].concat(filter?.tags ?? [])) {
    const r = parseTag(raw);
    if (r.error) throw new RangeError(`bad tag filter: ${r.error}`);
    const t = formatTag(r.tag);
    if (!tags.includes(t)) tags.push(t);
  }
  if (tags.length > MAX_TAGS) throw new RangeError(`at most ${MAX_TAGS} tag filters`);
  const person = typeof filter?.person === 'string' && filter.person.trim() ? filter.person.trim() : null;
  return { tags, person };
}

/** AND-ed SQL over pipelines `p`. One fragment shape per tag ('' value = any value of the key),
 *  so prepare()'s statement cache grows with the tag COUNT only, never with the values. */
function filterSql(filter) {
  let sql = ''; const params = [];
  for (const t of filter.tags) {
    const { tag } = parseTag(t);
    sql += " AND EXISTS (SELECT 1 FROM run_tags ft WHERE ft.pipeline_id = p.id AND ft.key = ? AND (? = '' OR ft.value = ?))";
    params.push(tag.key, tag.value, tag.value);
  }
  if (filter.person != null) { sql += ' AND p.started_by = ?'; params.push(filter.person); }
  return { sql, params };
}

const iso = (ms) => new Date(ms).toISOString();
const WINDOWS = {
  cohort: (a, b) => ({ sql: 'COALESCE(p.started_at, p.updated_at) >= ? AND COALESCE(p.started_at, p.updated_at) < ?', params: [iso(a), iso(b)] }),
  active: (a, b) => ({ sql: 'COALESCE(p.started_at, p.updated_at) < ? AND COALESCE(p.updated_at, p.started_at) >= ?', params: [iso(b), iso(a)] }),
  updated: (a, b) => ({ sql: 'COALESCE(p.updated_at, p.started_at) >= ? AND COALESCE(p.updated_at, p.started_at) < ?', params: [iso(a), iso(b)] }),
};

const TOTALS_COLUMNS = `COUNT(*) AS runs,
      COALESCE(SUM(status = 'done'), 0)                                      AS finished,
      COALESCE(SUM(status = 'stopped'), 0)                                   AS stopped,
      COALESCE(SUM(status = 'error'), 0)                                     AS failed,
      COALESCE(SUM(status IN ('paused','interrupted')), 0)                   AS paused,
      COALESCE(SUM(status IN ('created','starting','running','pausing')), 0) AS running,
      COALESCE(SUM(pr_url IS NOT NULL), 0)                                   AS prsOpened,
      COALESCE(SUM(pr_state = 'MERGED'), 0)                                  AS prsMerged,
      COALESCE(SUM(CASE WHEN p.total_cost_usd  > 0 THEN p.total_cost_usd  ELSE COALESCE(s.sc, 0) END), 0) AS spend,
      COALESCE(SUM(CASE WHEN p.total_active_ms > 0 THEN p.total_active_ms ELSE COALESCE(s.sa, 0) END), 0) AS active,
      COALESCE(SUM(p.human_hours), 0) AS humanHours`;
const TOTALS_FROM = `
    FROM pipelines p
    LEFT JOIN (SELECT pipeline_id, SUM(cost_usd) sc, SUM(active_ms) sa
               FROM pipeline_steps GROUP BY pipeline_id) s ON s.pipeline_id = p.id`;
const TOTALS_SELECT = `
    SELECT ${TOTALS_COLUMNS}${TOTALS_FROM}`;

/** Spend over the given pipelines with Statistics' own per-row rule (row total, else the step sum), deleted and
 *  archived rows included, so a group total and Statistics agree (runs redesign §2.4). */
export function spendOfPipelines(ids) {
  const list = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!list.length) return { usd: 0, byPipeline: {} };
  const rows = prepare(`SELECT p.id AS id,
      CASE WHEN p.total_cost_usd > 0 THEN p.total_cost_usd ELSE COALESCE(s.sc, 0) END AS usd ${TOTALS_FROM}
    WHERE p.id IN (${list.map(() => '?').join(', ')})`).all(...list);
  const byPipeline = Object.fromEntries(rows.map((r) => [r.id, roundUsd(r.usd)]));
  return { usd: roundUsd(rows.reduce((a, r) => a + Number(r.usd || 0), 0)), byPipeline };
}

export const RUN_SIZES = Object.freeze(['small', 'medium', 'large']);

// Shaper (D28): finished runs started in the window that have a size, shaped (shape_stats set) vs not.
// Cost and active time fall back to the step sums the way TOTALS_SELECT does; review cycles count the code
// reviewer's verdicts (reviews.kind = 'impl'), the same source for both groups.
const SHAPING_SELECT = `
    SELECT p.run_size AS size, (p.shape_stats IS NOT NULL) AS shaped, COUNT(*) AS runs,
      AVG(CASE WHEN p.total_cost_usd  > 0 THEN p.total_cost_usd  ELSE COALESCE(s.sc, 0) END) AS cost,
      AVG(CASE WHEN p.total_active_ms > 0 THEN p.total_active_ms ELSE COALESCE(s.sa, 0) END) AS active,
      AVG((SELECT COUNT(*) FROM reviews r WHERE r.pipeline_id = p.id AND r.kind = 'impl')) AS cycles
    FROM pipelines p
    LEFT JOIN (SELECT pipeline_id, SUM(cost_usd) sc, SUM(active_ms) sa
               FROM pipeline_steps GROUP BY pipeline_id) s ON s.pipeline_id = p.id
    WHERE p.status = 'done' AND p.run_size IS NOT NULL
      AND COALESCE(p.started_at, p.updated_at) >= ?
      AND COALESCE(p.started_at, p.updated_at) <  ?
    GROUP BY p.run_size, shaped`;

/** @returns {{groups: Array<{size:string, shaped:object, unshaped:object}>}} sizes with at least one run, in size order */
export function shapingGroups(fromMs, toMs) {
  const none = () => ({ runs: 0, avgCostUsd: null, avgActiveMs: null, avgReviewCycles: null });
  const bySize = new Map(RUN_SIZES.map((size) => [size, { size, shaped: none(), unshaped: none() }]));
  for (const r of prepare(SHAPING_SELECT).all(new Date(fromMs).toISOString(), new Date(toMs).toISOString())) {
    const g = bySize.get(r.size);
    if (!g) continue;
    g[r.shaped ? 'shaped' : 'unshaped'] = {
      runs: r.runs,
      avgCostUsd: roundUsd(r.cost || 0),
      avgActiveMs: Math.round(Number(r.active || 0)),
      avgReviewCycles: Math.round(Number(r.cycles || 0) * 10) / 10,
    };
  }
  return { groups: [...bySize.values()].filter((g) => g.shaped.runs || g.unshaped.runs) };
}

function shapeTotals(row) {
  return {
    runs: row.runs, finished: row.finished, stopped: row.stopped, failed: row.failed,
    paused: row.paused, running: row.running,
    prsOpened: row.prsOpened, prsMerged: row.prsMerged,
    workedMs: Number(row.active || 0),
    cohortSpendUsd: roundUsd(row.spend || 0),
    humanHours: Math.round(Number(row.humanHours || 0) * 100) / 100,
  };
}

function totalsRow(win, filter) {
  const f = filterSql(filter);
  return shapeTotals(prepare(`${TOTALS_SELECT} WHERE ${win.sql}${f.sql}`).get(...win.params, ...f.params));
}

/** Cohort totals over runs started in [fromMs, toMs). Legacy fs->db imports have
 *  no started_at; they fall back to updated_at so their money (which always
 *  lands in the all-time sums) is never counted without its run. */
function cohortTotals(fromMs, toMs, filter = NO_FILTER) { return totalsRow(WINDOWS.cohort(fromMs, toMs), filter); }

/** Runs whose lifespan [started_at, updated_at] overlaps [fromMs, toMs) —
 *  "active in the window": started, updated, or finished inside it. There is
 *  no finished_at column; updated_at is the terminal-write proxy. */
function activeTotals(fromMs, toMs, filter = NO_FILTER) { return totalsRow(WINDOWS.active(fromMs, toMs), filter); }

/** Runs whose LAST write (updated_at, ≈ the terminal write for finished runs)
 *  falls in [fromMs, toMs) — hourly outcome attribution for the today range. */
function updatedTotals(fromMs, toMs, filter = NO_FILTER) { return totalsRow(WINDOWS.updated(fromMs, toMs), filter); }

/** Ledger spend in [fromMs, toMs); with a filter, only ledger rows of matching runs. */
function ledgerSpend(fromMs, toMs, filter = NO_FILTER) {
  if (!isFiltered(filter)) {
    const row = prepare('SELECT SUM(amount_usd) AS s FROM cost_ledger WHERE ts >= ? AND ts < ?').get(fromMs, toMs);
    return roundUsd(row?.s || 0);
  }
  const f = filterSql(filter);
  const row = prepare(`SELECT SUM(l.amount_usd) AS s FROM cost_ledger l JOIN pipelines p ON p.id = l.pipeline_id
    WHERE l.ts >= ? AND l.ts < ?${f.sql}`).get(fromMs, toMs, ...f.params);
  return roundUsd(row?.s || 0);
}

/** Fallback-aware all-time money/time (allTimeTotals' CASE) over the runs a filter matches. */
function filteredAllTime(filter) {
  const c = totalsRow({ sql: '1 = 1', params: [] }, filter);
  return { spendUsd: c.cohortSpendUsd, activeMs: c.workedMs, humanHours: c.humanHours };
}

/** Distinct named starters, for the person picker. */
function peopleInUse() {
  const names = prepare('SELECT DISTINCT started_by AS who FROM pipelines WHERE started_by IS NOT NULL').all()
    .map((r) => actorLabel(r.who)).filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

const COUNT_KEYS = ['runs', 'finished', 'stopped', 'failed', 'paused', 'running', 'prsOpened', 'prsMerged'];
const NONE_ORDER = { value: 0, none: 1, ask: 2, requirements: 3 };

/** 'person' | 'tag:<key>' | null → { kind, key } | null. @throws {RangeError} */
export function parseGroupBy(groupBy) {
  if (groupBy == null || groupBy === '') return null;
  if (groupBy === 'person') return { kind: 'person', key: null };
  const m = /^tag:(.*)$/.exec(String(groupBy));
  if (m && TAG_KEY_RE.test(m[1])) return { kind: 'tag', key: m[1] };
  throw new RangeError(`unknown groupBy "${groupBy}"`);
}

/** The per-row SQL: an extra LEFT JOIN for a tag key, and the raw group column. */
function groupSql(g) {
  return g.kind === 'person'
    ? { join: '', col: 'p.started_by', params: [] }
    : { join: ' LEFT JOIN run_tags gt ON gt.pipeline_id = p.id AND gt.key = ?', col: 'gt.value', params: [g.key] };
}

/** Raw group value → the row's identity. Person rows fold NULL/'local' into one unknown row. */
function rowIdentity(g, raw) {
  if (g.kind === 'person') {
    const who = actorLabel(raw);
    return who ? { kind: 'value', key: who, label: who } : { kind: 'none', key: null, label: '(unknown person)' };
  }
  if (raw == null) return { kind: 'none', key: null, label: `(no ${g.key})` };
  return { kind: 'value', key: raw, label: raw || g.key };   // '' = a plain tag
}

/**
 * Grouped rows over one window: cohort/active counts per group and money per group — ledger by
 * timestamp for a bounded range, the fallback-aware pipelines sums for 'all'. The Ask Worca row and
 * the Requirements row are added unless a filter is active. Rows reconcile to totalUsd exactly (residual on the top row).
 */
function groupedRows(g, { win, fromMs, toMs, filter, allTime, ask, requirements, totalUsd }) {
  const { join, col, params: jp } = groupSql(g);
  const f = filterSql(filter);
  const rows = new Map();
  const rowFor = (raw) => {
    const id = rowIdentity(g, raw);
    const k = `${id.kind}\u0000${id.key}`;
    if (!rows.has(k)) rows.set(k, { ...id, spentUsd: 0, ...Object.fromEntries(COUNT_KEYS.map((c) => [c, 0])) });
    return rows.get(k);
  };
  for (const r of prepare(`SELECT ${col} AS g, ${TOTALS_COLUMNS}${TOTALS_FROM}${join}
      WHERE ${win.sql}${f.sql} GROUP BY g`).all(...jp, ...win.params, ...f.params)) {
    const row = rowFor(r.g);
    for (const c of COUNT_KEYS) row[c] += r[c];
  }
  const money = allTime
    ? prepare(`SELECT ${col} AS g, ${TOTALS_COLUMNS}${TOTALS_FROM}${join} WHERE 1 = 1${f.sql} GROUP BY g`)
        .all(...jp, ...f.params).map((r) => ({ g: r.g, usd: r.spend }))
    : prepare(`SELECT ${col} AS g, SUM(l.amount_usd) AS usd
        FROM cost_ledger l LEFT JOIN pipelines p ON p.id = l.pipeline_id${join}
        WHERE l.ts >= ? AND l.ts < ?${f.sql} GROUP BY g`).all(...jp, fromMs, toMs, ...f.params);
  for (const r of money) rowFor(r.g).spentUsd += r.usd || 0;

  const out = [...rows.values()].map((r) => ({ ...r, spentUsd: roundUsd(r.spentUsd) }));
  if (ask) out.push({ kind: 'ask', key: null, label: 'Chat', spentUsd: ask.spendUsd,
    sessions: ask.sessions, ...Object.fromEntries(COUNT_KEYS.map((c) => [c, 0])) });
  if (requirements) out.push({ kind: 'requirements', key: null, label: 'Requirements', spentUsd: requirements.spendUsd,
    features: requirements.features, ...Object.fromEntries(COUNT_KEYS.map((c) => [c, 0])) });
  const kept = out.filter((r) => r.spentUsd !== 0 || r.runs !== 0)
    .sort((a, b) => NONE_ORDER[a.kind] - NONE_ORDER[b.kind] || b.spentUsd - a.spentUsd
      || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const drift = roundUsd(totalUsd - kept.reduce((a, r) => a + r.spentUsd, 0));
  if (drift && kept.length) {
    const top = kept.reduce((m, r) => (r.spentUsd > m.spentUsd ? r : m), kept[0]);
    top.spentUsd = roundUsd(top.spentUsd + drift);
  }
  return kept;
}

// The configured keys are the instance's merged dimensions (every project's plus the local ones, mergeDimensions
// does not cap them), so the per-run MAX_TAGS (20) is the wrong bound here. This one only stops a runaway query string.
const MAX_TAG_KEYS = 50;

/** By tag (#718 slice 4): configured keys → validated, de-duplicated; null = no By tag tables. @throws {RangeError} */
function normaliseTagKeys(tagKeys) {
  if (tagKeys == null) return null;
  const out = [];
  for (const raw of [].concat(tagKeys)) {
    const k = String(raw);
    if (!TAG_KEY_RE.test(k)) throw new RangeError(`bad tagKey "${k}"`);
    if (!out.includes(k)) out.push(k);
  }
  if (out.length > MAX_TAG_KEYS) throw new RangeError(`at most ${MAX_TAG_KEYS} tag keys`);
  return out;
}

/** One groupedRows table per key: configured keys first (always), then every other key a run in the
 *  range carries (it has a value row), by value spend. Same money rule as the Group by table. */
function tagGroupsFor(configured, ctx) {
  const table = (key, isConfigured) => ({ key, configured: isConfigured, rows: groupedRows({ kind: 'tag', key }, ctx) });
  const valueUsd = (t) => t.rows.reduce((a, r) => a + (r.kind === 'value' ? r.spentUsd : 0), 0);
  const others = prepare('SELECT DISTINCT key FROM run_tags ORDER BY key').all().map((r) => r.key)
    .filter((k) => !configured.includes(k))
    .map((k) => table(k, false))
    .filter((t) => t.rows.some((r) => r.kind === 'value'))
    .sort((a, b) => valueUsd(b) - valueUsd(a) || (a.key < b.key ? -1 : 1));
  return configured.map((k) => table(k, true)).concat(others);
}

// Statistics › Cost (value report, labels-cost-tags s3): one fact per run the window counts.
const FACT_SELECT = `
    SELECT p.id AS id, p.project_key AS projectKey, pj.name AS projectName, p.started_by AS who, p.status AS status,
      p.pr_url AS prUrl, p.pr_state AS prState, COALESCE(p.human_hours, 0) AS hours,
      COALESCE(p.started_at, p.updated_at) AS startedAt,
      json_extract(CASE WHEN json_valid(p.stepper) THEN p.stepper END, '$.template.name') AS wfName,
      json_extract(CASE WHEN json_valid(p.stepper) THEN p.stepper END, '$.template.id') AS wfId,
      CASE WHEN p.total_cost_usd > 0 THEN p.total_cost_usd ELSE COALESCE(s.sc, 0) END AS totalUsd${TOTALS_FROM}
    LEFT JOIN projects pj ON pj.key = p.project_key`;
const FACT_STATUS = { done: 'finished', stopped: 'stopped', error: 'failed', paused: 'paused', interrupted: 'paused' };
// Ledger spend whose pipelines row is gone (src/core/pipeline-delete.mjs keeps cost_ledger rows): it counts in the
// totals, so it gets a fact too. `orphan: true` keeps it out of runIds (nothing to open), not out of the chart.
const ORPHAN_FACT = Object.freeze({ person: null, project: null, workflow: null, status: null, pr: null,
  usd: 0, hours: 0, inCohort: false, orphan: true, startedMs: null, hourBucket: -1 });

/** The project as people know it (D10): its registered name, else the key's slug. project_key is
 *  `<slug>-<sha1[:8]>` (store.mjs projectKey), not a path, so the hash suffix is cut. */
function projectOf(name, key) {
  if (name) return String(name);
  const k = String(key || '');
  return k ? k.replace(/-[0-9a-f]{8}$/, '') || k : null;
}

function factOf(r, inCohort) {
  return {
    id: r.id, person: actorLabel(r.who) || null, project: projectOf(r.projectName, r.projectKey),
    workflow: r.wfName || r.wfId || null, status: FACT_STATUS[r.status] || 'running',
    pr: r.prUrl ? (r.prState === 'MERGED' ? 'merged' : 'opened') : null,
    tags: {}, usd: 0, hours: inCohort ? Math.round(Number(r.hours || 0) * 100) / 100 : 0, inCohort,
    startedMs: Date.parse(r.startedAt) || null, hourBucket: -1, spend: [],
  };
}

/** Ledger spend per run in [fromMs, toMs); with a filter, only rows of matching runs. */
function ledgerByRun(fromMs, toMs, filter) {
  if (!isFiltered(filter)) {
    return prepare('SELECT pipeline_id AS id, SUM(amount_usd) AS usd FROM cost_ledger WHERE ts >= ? AND ts < ? GROUP BY pipeline_id')
      .all(fromMs, toMs);
  }
  const f = filterSql(filter);
  return prepare(`SELECT l.pipeline_id AS id, SUM(l.amount_usd) AS usd FROM cost_ledger l JOIN pipelines p ON p.id = l.pipeline_id
    WHERE l.ts >= ? AND l.ts < ?${f.sql} GROUP BY l.pipeline_id`).all(fromMs, toMs, ...f.params);
}

/**
 * Per-run facts over one window: the cohort (runs, hours, outcomes) plus every run with ledger spend in it. Money is
 * the ledger by timestamp for a bounded range, the fallback-aware row totals for 'all' (groupedRows' rule). The
 * rounding drift goes onto the top spender, so Σ usd === pipelineSpendUsd. `buckets` adds each run's per-bucket spend
 * ([index, usd]) and the bucket its hours are drawn in (its start, clamped into the window).
 */
function reportFacts({ win, fromMs, toMs, allTime, filter, pipelineSpendUsd, buckets = null }) {
  const f = filterSql(filter);
  const facts = new Map();
  for (const r of prepare(`${FACT_SELECT} WHERE ${win.sql}${f.sql}`).all(...win.params, ...f.params)) {
    const x = factOf(r, true);
    if (allTime) x.usd = roundUsd(r.totalUsd || 0);
    facts.set(r.id, x);
  }
  if (!allTime) {
    const money = ledgerByRun(fromMs, toMs, filter);
    const missing = money.map((m) => m.id).filter((id) => id && !facts.has(id));
    for (let i = 0; i < missing.length; i += 500) {
      const chunk = missing.slice(i, i + 500);
      for (const r of prepare(`${FACT_SELECT} WHERE p.id IN (${chunk.map(() => '?').join(', ')})`).all(...chunk)) {
        facts.set(r.id, factOf(r, false));
      }
    }
    for (const m of money) {
      let x = facts.get(m.id);
      if (!x) { x = { ...ORPHAN_FACT, id: `orphan:${m.id}`, tags: {}, spend: [] }; facts.set(x.id, x); }   // no pipeline row
      x.usd = roundUsd(x.usd + (m.usd || 0));
    }
  }
  for (const [id, list] of readTagsFor([...facts.values()].filter((x) => !x.orphan).map((x) => x.id))) {
    const x = facts.get(id);
    for (const t of list) { const { tag } = parseTag(t); if (tag) x.tags[tag.key] = tag.value; }
  }
  const list = [...facts.values()];
  const drift = roundUsd(pipelineSpendUsd - list.reduce((a, x) => a + x.usd, 0));
  if (drift && list.length) {
    const top = list.reduce((m, x) => (x.usd > m.usd ? x : m), list[0]);
    top.usd = roundUsd(top.usd + drift);
  }
  if (buckets && buckets.length) {
    buckets.forEach(({ startMs, endMs }, i) => {
      for (const m of ledgerByRun(startMs, endMs, filter)) {
        const x = facts.get(m.id) || facts.get(`orphan:${m.id}`);
        if (x && m.usd) x.spend.push([i, roundUsd(m.usd)]);
      }
    });
    for (const x of list) {
      if (!x.inCohort || x.startedMs == null) continue;
      const at = Math.max(x.startedMs, buckets[0].startMs);
      x.hourBucket = buckets.findIndex((b) => at >= b.startMs && at < b.endMs);
    }
  }
  return list;
}

/** Ask Worca window aggregate (ask-cost-statistics-design.md D5/D6): spend,
 *  DISTINCT sessions, turns. A thread is a session in every window it has a
 *  costed turn in. */
function askTotals(fromMs, toMs) {
  // A reply's next-prompt suggestion books its own row on the reply's message id: one turn, two costs.
  const row = prepare(`
    SELECT COALESCE(SUM(amount_usd), 0)                        AS s,
           COUNT(DISTINCT thread_id)                           AS sessions,
           COUNT(DISTINCT COALESCE(message_id, 'row:' || id))  AS turns
    FROM ask_cost_ledger WHERE ts >= ? AND ts < ?`).get(fromMs, toMs);
  return { spendUsd: roundUsd(row?.s || 0), sessions: row?.sessions || 0, turns: row?.turns || 0 };
}

/** Requirements window aggregate (plans/requirements-design.md D9): spend, and the DISTINCT features
 *  that spent in the window (orientation passes and interview rounds). Product brief looks (A7: feature_seq 0
 *  with a brief_id) count in the spend but not in the feature count. */
function requirementsTotals(fromMs, toMs) {
  const row = prepare(`
    SELECT COALESCE(SUM(amount_usd), 0) AS s, COUNT(DISTINCT NULLIF(feature_seq, 0)) AS features
    FROM req_cost_ledger WHERE ts >= ? AND ts < ?`).get(fromMs, toMs);
  return { spendUsd: roundUsd(row?.s || 0), features: row?.features || 0 };
}

/** "Saved this month/week" for the account menu's spend card (money-saved design §10): human
 *  hours × rate − spent over the budget's own reset window. The same cohort (runs STARTED in
 *  [windowStartMs, windowEndMs), archived included), the same rate and the same spend as the
 *  Statistics "Saved" tile for the matching range, so the spend card and the tile never disagree.
 *  A lean SUM rather than cohortTotals(): /api/budget is refetched on every tick while runs
 *  are live, and the pipeline_steps join TOTALS_SELECT carries is dead weight for one column.
 *  @param {{windowStartMs:number, windowEndMs:number, windowSpendUsd:number}} budget  budgetStatus()
 *  @returns {{windowHumanHours:number, windowSavedUsd:number}} */
export function budgetWindowSavings(budget) {
  const row = prepare(`
    SELECT COALESCE(SUM(p.human_hours), 0) AS humanHours
    FROM pipelines p
    WHERE COALESCE(p.started_at, p.updated_at) >= ?
      AND COALESCE(p.started_at, p.updated_at) <  ?`)
    .get(new Date(budget.windowStartMs).toISOString(), new Date(budget.windowEndMs).toISOString());
  const windowHumanHours = Math.round(Number(row?.humanHours || 0) * 100) / 100;
  return {
    windowHumanHours,
    windowSavedUsd: savedUsd(windowHumanHours, effectiveHumanRateUsd(), budget.windowSpendUsd),
  };
}

/** Build zero-filled buckets [{startMs, endMs}] from windowStart through `now`. */
function buildBuckets(windowStart, now, bucket) {
  const out = [];
  if (bucket === 'hour') {
    for (let h = hourStart(windowStart); h <= now;
         h = new Date(h.getFullYear(), h.getMonth(), h.getDate(), h.getHours() + 1)) {
      out.push({ startMs: h.getTime(),
        endMs: new Date(h.getFullYear(), h.getMonth(), h.getDate(), h.getHours() + 1).getTime() });
    }
  } else if (bucket === 'day') {
    for (let d = dayStart(windowStart); d <= now; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      out.push({ startMs: d.getTime(), endMs: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() });
    }
  } else {
    for (let m = monthStart(windowStart); m <= now; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      out.push({ startMs: m.getTime(), endMs: new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime() });
    }
  }
  return out;
}

/** GET /api/stats backing (spec §6.9). `requirementsEnabled` defaults to the `requirements` flag. @throws {RangeError} on unknown range. */
export function getStats({ range = 'month', now = new Date(), from = null, to = null, filter: rawFilter = null, groupBy = null, tagKeys = null, report = false,
  requirementsEnabled = undefined } = {}) {
  if (!RANGES.includes(range)) throw new RangeError(`unknown stats range: ${range}`);
  const filter = normaliseStatsFilter(rawFilter || {});
  const filtered = isFiltered(filter);
  const group = parseGroupBy(groupBy);
  const tagKeyList = normaliseTagKeys(tagKeys);
  const budget = budgetStatus(now);
  const rate = effectiveHumanRateUsd();

  let windowStart, windowEnd, prevStart, prevEnd, bucket;
  if (range === 'today') {
    windowStart = dayStart(now);
    windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    prevStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    prevEnd = windowStart; bucket = 'hour';
  } else if (range === 'week') {
    windowStart = costWindowStart(now, 'weekly'); windowEnd = costWindowEnd(now, 'weekly');
    prevStart = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() - 7);
    prevEnd = windowStart; bucket = 'day';
  } else if (range === 'month') {
    windowStart = costWindowStart(now, 'monthly'); windowEnd = costWindowEnd(now, 'monthly');
    prevStart = new Date(windowStart.getFullYear(), windowStart.getMonth() - 1, 1);
    prevEnd = windowStart; bucket = 'day';
  } else if (range === 'lastMonth') {
    windowStart = new Date(now.getFullYear(), now.getMonth() - 1, 1); windowEnd = monthStart(now);
    prevStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    prevEnd = windowStart; bucket = 'day';
  } else if (range === 'custom') {
    ({ start: windowStart, end: windowEnd } = customWindow(from, to));
    const days = Math.round((windowEnd - windowStart) / DAY_MS);   // DST-safe: whole local days
    prevStart = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() - days);
    prevEnd = windowStart; bucket = days > 92 ? 'month' : 'day';
  } else {
    // all time: series over the last 12 months; totals over everything
    windowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    windowEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    prevStart = null; prevEnd = null; bucket = 'month';
  }

  // 'today' counts runs ACTIVE in the window (Q&A: started, updated, or
  // finished today); every other range keeps cohort-by-start. prev flows
  // through the same closure, so the yesterday delta compares like with like.
  const windowTotalsFn = range === 'today' ? activeTotals : cohortTotals;
  const shapeWindow = (fromMs, toMs) => {
    const c = windowTotalsFn(fromMs, toMs, filter);
    const pipelineSpendUsd = ledgerSpend(fromMs, toMs, filter);
    const ask = filtered ? EMPTY_ASK : askTotals(fromMs, toMs);
    const requirements = filtered ? EMPTY_REQUIREMENTS : requirementsTotals(fromMs, toMs);
    const spentUsd = roundUsd(pipelineSpendUsd + ask.spendUsd + requirements.spendUsd);
    return {
      spentUsd, pipelineSpendUsd, ask, requirements,
      humanHours: c.humanHours, savedUsd: savedUsd(c.humanHours, rate, spentUsd),
      workedMs: c.workedMs,
      runs: c.runs, finished: c.finished, stopped: c.stopped, failed: c.failed,
      paused: c.paused, running: c.running,
      prsOpened: c.prsOpened, prsMerged: c.prsMerged,
    };
  };

  let totals;
  if (range === 'all') {
    const at = filtered ? filteredAllTime(filter) : allTimeTotals();
    const c = cohortTotals(0, windowEnd.getTime(), filter);
    const ask = filtered ? EMPTY_ASK : askTotals(0, windowEnd.getTime());
    const requirements = filtered ? EMPTY_REQUIREMENTS : requirementsTotals(0, windowEnd.getTime());
    const spentUsd = roundUsd(at.spendUsd + ask.spendUsd + requirements.spendUsd);
    totals = {
      spentUsd,
      pipelineSpendUsd: at.spendUsd, ask, requirements,
      humanHours: at.humanHours,
      savedUsd: savedUsd(at.humanHours, rate, spentUsd),
      workedMs: at.activeMs,
      runs: c.runs, finished: c.finished, stopped: c.stopped, failed: c.failed,
      paused: c.paused, running: c.running,
      prsOpened: c.prsOpened, prsMerged: c.prsMerged,
    };
  } else {
    totals = shapeWindow(windowStart.getTime(), windowEnd.getTime());
  }

  const prev = prevStart ? shapeWindow(prevStart.getTime(), prevEnd.getTime()) : null;

  // Hourly bars pin terminal outcomes to the hour of the terminal write; the
  // day/month bars keep cohort-by-start. Money is ledger-exact either way.
  const bucketTotalsFn = range === 'today' ? updatedTotals : cohortTotals;
  // Buckets end at min(now, windowEnd − 1 ms) and are clamped to the window, so a past window
  // (Last month) is fully drawn and a month bucket of a custom range never counts money outside it.
  const seriesEnd = new Date(Math.min(now.getTime(), windowEnd.getTime() - 1));
  const seriesWindows = buildBuckets(windowStart, seriesEnd, bucket).map(({ startMs: s0, endMs: e0 }) => ({
    startMs: Math.max(s0, windowStart.getTime()), endMs: Math.min(e0, windowEnd.getTime()),
  }));
  const series = seriesWindows.map(({ startMs, endMs }) => {
    const c = bucketTotalsFn(startMs, endMs, filter);
    return {
      bucketStartMs: startMs,
      spentUsd: roundUsd(ledgerSpend(startMs, endMs, filter)
        + (filtered ? 0 : askWindowedSpendUsd(startMs, endMs) + requirementsWindowedSpendUsd(startMs, endMs))),
      finished: c.finished, stopped: c.stopped, failed: c.failed,
    };
  });

  const groupCtx = {
    win: range === 'all' ? WINDOWS.cohort(0, windowEnd.getTime())
      : (range === 'today' ? WINDOWS.active : WINDOWS.cohort)(windowStart.getTime(), windowEnd.getTime()),
    fromMs: windowStart.getTime(), toMs: windowEnd.getTime(), filter,
    allTime: range === 'all', ask: filtered ? null : totals.ask,
    requirements: filtered ? null : totals.requirements, totalUsd: totals.spentUsd,
  };
  const groups = group ? {
    by: groupBy,
    label: group.kind === 'person' ? 'person' : group.key,
    rows: groupedRows(group, groupCtx),
  } : null;
  const tagGroups = tagKeyList ? tagGroupsFor(tagKeyList, groupCtx) : null;

  const out = {
    range, bucket,
    windowStartMs: windowStart.getTime(), windowEndMs: windowEnd.getTime(),
    totals, prev, budget, series, humanRateUsd: rate,
    filter, filtered, groupBy: group ? groupBy : null, groups, tagGroups, people: peopleInUse(),
    // Spend with no run behind it (Smart run naming): its own line, never part of spentUsd.
    utility: filtered ? { naming: { usd: 0, count: 0 } } : utilityTotals(range === 'all' ? 0 : windowStart.getTime(), windowEnd.getTime()),
  };
  if (report) {
    const winOf = range === 'today' ? WINDOWS.active : WINDOWS.cohort;
    out.report = {
      buckets: seriesWindows.map((b) => b.startMs),
      runs: reportFacts({ win: groupCtx.win, fromMs: groupCtx.fromMs, toMs: groupCtx.toMs, allTime: range === 'all',
        filter, pipelineSpendUsd: totals.pipelineSpendUsd, buckets: seriesWindows }),
      prevRuns: prev ? reportFacts({ win: winOf(prevStart.getTime(), prevEnd.getTime()), fromMs: prevStart.getTime(),
        toMs: prevEnd.getTime(), allTime: false, filter, pipelineSpendUsd: prev.pipelineSpendUsd }) : null,
      ask: filtered ? null : {
        spentUsd: totals.ask.spendUsd,
        prevSpentUsd: prev ? prev.ask.spendUsd : null,
        series: seriesWindows.map((b) => roundUsd(askWindowedSpendUsd(b.startMs, b.endMs))),
      },
      // Requirements spend (plans/requirements-design.md D9): in Spent, so in the report too; dropped by a filter like Chat's.
      requirements: filtered ? null : {
        spentUsd: totals.requirements.spendUsd,
        prevSpentUsd: prev ? prev.requirements.spendUsd : null,
        series: seriesWindows.map((b) => roundUsd(requirementsWindowedSpendUsd(b.startMs, b.endMs))),
      },
    };
  }
  // The requirements flag off: money already spent stays in Spent, its Group by row and the report (so they
  // reconcile), but the tile's figures go, and report.requirements is sent only when there is spend to show.
  if (!(requirementsEnabled ?? flagEnabled('requirements'))) {
    delete totals.requirements;
    if (prev) delete prev.requirements;
    const r = out.report && out.report.requirements;
    if (out.report && !(r && (r.spentUsd || r.prevSpentUsd || r.series.some((x) => x)))) delete out.report.requirements;
  }
  return out;
}
