// Team metrics › Cost (labels-cost-tags s4). Team records → the per-run facts the
// Cost and value report allocates (src/shared/cost/allocation.mjs, the shape GET /api/stats?report=1 serves), plus the
// person × value heat grid and the missing cost tags to-do. PURE and browser-safe. A record's whole cost lands in the
// bucket of its startedAt: team records carry one total per run. The record format is read, never changed.
import { resolveRange, recordTags } from './aggregate.mjs';
import { canonicalMetricsSlug } from './slug.mjs';
import { parseTag } from '../run-tags.mjs';
import { allocate, valueOf, TOP_N } from '../cost/allocation.mjs';

const DAY = 86_400_000;
const MAX_ALL_DAYS = 3660;                          // aggregate.mjs MAX_CUSTOM_DAYS: one far-past record must not make 12 000 buckets
const UNIT = 1e4;                                   // allocation.mjs's money precision: parts add up exactly
const toUnits = (usd) => Math.round((Number(usd) || 0) * UNIT);
const STATUS = { done: 'finished', failed: 'failed', stopped: 'stopped' };
const startOf = (r) => Date.parse(r?.startedAt);

/** One record → one report fact. person = actor; a workspace run's project is the workspace (spend is never split). */
export function recordFact(r) {
  const tags = {};
  for (const t of recordTags(r)) {
    const { tag } = parseTag(t);
    if (tag && !(tag.key in tags)) tags[tag.key] = tag.value || '';
  }
  const t = r.target || {};
  const project = t.kind === 'workspace'
    ? (typeof t.workspace === 'string' && t.workspace ? t.workspace : null)
    : (typeof t.project === 'string' && t.project ? canonicalMetricsSlug(t.project) : null);
  return {
    id: r.id,
    person: typeof r.actor === 'string' && r.actor ? r.actor : null,
    project,
    workflow: r.workflow?.name || r.workflow?.id || null,
    status: STATUS[r.result] || null,
    pr: r.pr && (r.pr.url || r.pr.number != null) ? 'opened' : null,   // records do not say whether it merged
    tags,
    usd: Number.isFinite(r.cost?.usd) ? r.cost.usd : 0,
    hours: Number.isFinite(r.human?.hours) ? r.human.hours : 0,
    inCohort: true,
    startedMs: startOf(r),
    spend: [],
    hourBucket: -1,
  };
}

/** Bucket starts (ms) over [startMs, endMs): UTC days up to 62 days, else UTC months. */
export function costBuckets(startMs, endMs) {
  if (!(endMs > startMs)) return { bucket: 'day', buckets: [] };
  const out = [];
  if (endMs - startMs <= 62 * DAY) {
    for (let t = Math.floor(startMs / DAY) * DAY; t < endMs; t += DAY) out.push(t);
    return { bucket: 'day', buckets: out };
  }
  const d = new Date(startMs);
  for (let y = d.getUTCFullYear(), m = d.getUTCMonth(), t = Date.UTC(y, m, 1); t < endMs; t = Date.UTC(y, ++m, 1)) out.push(t);
  return { bucket: 'month', buckets: out };
}

const bucketIndex = (buckets, ms) => {
  let i = -1;
  for (let k = 0; k < buckets.length && buckets[k] <= ms; k++) i = k;
  return i;
};

/** The report's input for a Team metrics range: { bucket, buckets, runs, prevRuns, windowStartMs, windowEndMs }. */
export function recordFacts(records, { range = 'this-month', from = null, to = null, now = Date.now() } = {}) {
  const win = resolveRange(range, { now, from, to });
  const all = (records || []).filter((r) => r && typeof r.id === 'string' && Number.isFinite(startOf(r)));
  const within = (s, e) => all.filter((r) => { const t = startOf(r); return (s == null || t >= s) && (e == null || t < e); });
  const runs = within(win.startMs, win.endMs).map(recordFact);
  const first = runs.reduce((a, f) => Math.min(a, f.startedMs), now);
  // All time: from the first record's day, but at most MAX_ALL_DAYS back. An older record keeps its cost in the
  // table and the KPIs; bucketIndex gives it -1, so it has no chart bucket.
  const floor = Math.floor((now - MAX_ALL_DAYS * DAY) / DAY) * DAY;
  const windowStartMs = win.startMs ?? Math.max(floor, Math.floor(first / DAY) * DAY);
  const windowEndMs = win.endMs ?? now + 1;
  const { bucket, buckets } = costBuckets(windowStartMs, windowEndMs);
  for (const f of runs) {
    const i = bucketIndex(buckets, f.startedMs);
    f.hourBucket = i;
    f.spend = i >= 0 ? [[i, f.usd]] : [];
  }
  const prevRuns = win.prevStartMs == null ? null : within(win.prevStartMs, win.prevEndMs).map(recordFact);
  return { bucket, buckets, runs, prevRuns, windowStartMs, windowEndMs };
}

/**
 * Person × value for the Allocate by dimension. Columns are the report's own top-level rows (top 5, Other (n),
 * Unallocated), people every person by spend (+ Unallocated); one cell per pair, so each person's cells sum to
 * their total. null for Allocate by Person: the grid would be its own diagonal.
 */
export function heatGrid(runs, { by, top = TOP_N } = {}) {
  if (!by || by === 'person') return null;
  const columns = allocate(runs, { by, top }).rows.filter((r) => r.kind !== 'ask');
  const colOf = new Map();                          // raw value (null = Unallocated) → column key
  for (const c of columns) {
    if (c.kind === 'value' || c.kind === 'none') colOf.set(c.value, c.key);
    if (c.kind === 'other') for (const m of c.members) colOf.set(m.value, c.key);
  }
  const people = allocate(runs, { by: 'person', top: Infinity }).rows;
  const personOf = new Map(people.map((p) => [p.value, p.key]));
  // One pass over the runs (not people × columns × runs): a year of team records stays cheap on every repaint.
  const acc = new Map();
  for (const r of runs) {
    const k = `${personOf.get(valueOf(r, 'person'))}\u0000${colOf.get(valueOf(r, by))}`;
    const a = acc.get(k) || { units: 0, runs: 0 };
    a.units += toUnits(r.usd);
    if (r.inCohort) a.runs += 1;
    acc.set(k, a);
  }
  const cells = [];
  let maxUnits = 0;
  for (const p of people) {
    for (const c of columns) {
      const a = acc.get(`${p.key}\u0000${c.key}`) || { units: 0, runs: 0 };
      maxUnits = Math.max(maxUnits, a.units);
      cells.push({ person: p.key, col: c.key, spentUsd: a.units / UNIT, runs: a.runs });
    }
  }
  return {
    by,
    people: people.map((p) => ({ key: p.key, label: p.label, spentUsd: p.spentUsd, runs: p.runs })),
    columns: columns.map((c) => ({ key: c.key, label: c.label, kind: c.kind })),
    cells,
    maxUsd: maxUnits / UNIT,
  };
}

/** Runs missing a required cost tag key, per person: [{ person, label, runs, spentUsd, keys }] by spend.
 *  A tag of the key without a value (`client`) counts as present, as missingRequired (tag-dimensions.mjs) does. */
export function missingKeyTodos(runs, dims = []) {
  const keys = (dims || []).filter((d) => d && d.required).map((d) => d.key);
  if (!keys.length) return { keys, rows: [] };
  const byPerson = new Map();
  for (const r of runs) {
    if (!r.inCohort) continue;
    const missing = keys.filter((k) => valueOf(r, `tag:${k}`) === null);
    if (!missing.length) continue;
    const p = valueOf(r, 'person');
    if (!byPerson.has(p)) byPerson.set(p, { person: p, units: 0, runs: 0, keys: new Set() });
    const row = byPerson.get(p);
    row.runs += 1;
    row.units += toUnits(r.usd);
    for (const k of missing) row.keys.add(k);
  }
  const rows = [...byPerson.values()].map((x) => ({
    person: x.person, label: x.person ?? 'Unallocated', runs: x.runs, spentUsd: x.units / UNIT, keys: keys.filter((k) => x.keys.has(k)),
  })).sort((a, b) => b.spentUsd - a.spentUsd || b.runs - a.runs || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return { keys, rows };
}
