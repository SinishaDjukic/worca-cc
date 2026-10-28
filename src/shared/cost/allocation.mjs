// src/shared/cost/allocation.mjs — the Cost and value report's math (Statistics › Cost; Team metrics › Cost reuses it).
// Allocates per-run facts by a primary then a secondary dimension: top 5 + Other (n) + Unallocated (+ Ask Worca,
// + Requirements),
// hours / Saved / $ per hour, shares, chart series, the dimension picker's order and the CSV. PURE and browser-safe
// (the browser imports /src/shared/**). Money is summed in integer units of $0.0001 (roundUsd's precision), so every
// part adds up to its parent and the rows to the total, exactly.
import { savedUsd, roundHours } from '../human-estimate.mjs';
import { rowsToCsv } from '../csv.mjs';

export { savedUsd };
export const TOP_N = 5;
export const UNALLOCATED = 'Unallocated';
export const BUILTIN_DIMS = Object.freeze([
  Object.freeze({ id: 'person', label: 'Person' }),
  Object.freeze({ id: 'project', label: 'Project' }),
  Object.freeze({ id: 'workflow', label: 'Workflow' }),
  Object.freeze({ id: 'status', label: 'Status' }),
]);
const STATUS_LABELS = { finished: 'Finished', stopped: 'Stopped', failed: 'Failed', paused: 'Paused', running: 'Running' };
// Today's Statistics group columns (ui/public/stats-view.mjs groupsToCsv), then the hours columns the report adds.
export const TODAY_CSV_COLS = Object.freeze(['spendUsd', 'runs', 'finished', 'stopped', 'failed', 'running', 'paused', 'prsOpened', 'prsMerged']);
export const HOURS_CSV_COLS = Object.freeze(['humanHours', 'savedUsd', 'usdPerHour']);

const UNIT = 1e4;
const toUnits = (usd) => Math.round((Number(usd) || 0) * UNIT);
const fromUnits = (u) => u / UNIT;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A run's raw value for a dimension ('tag:client' | 'person' | 'project' | 'workflow' | 'status'); null = Unallocated.
 *  A plain tag (`spike`) has the value ''. */
export function valueOf(run, dim) {
  if (dim.startsWith('tag:')) {
    const v = run.tags ? run.tags[dim.slice(4)] : undefined;
    return typeof v === 'string' ? v : null;
  }
  const v = run[dim];
  return typeof v === 'string' && v !== '' ? v : null;
}

/** What a value reads as on screen and in the CSV. A plain tag reads as its key, as Statistics does today. */
export function valueLabel(dim, value) {
  if (value === null) return UNALLOCATED;
  if (dim === 'status') return STATUS_LABELS[value] || value;
  if (value === '' && dim.startsWith('tag:')) return dim.slice(4);
  return value;
}

/** Every filter ({ dim, value }, value null = Unallocated) holds for the run. */
export function matchesFilters(run, filters = []) {
  return filters.every((f) => valueOf(run, f.dim) === f.value);
}

/** spend ÷ hours, 2 dp; null (no value) at 0 hours, never Infinity. */
export function costPerHour(spentUsd, hours) {
  const h = Number(hours);
  const s = Number(spentUsd);
  if (!(h > 0) || !Number.isFinite(s)) return null;
  return Math.round((s / h + Number.EPSILON) * 100) / 100;
}

/** A share as the report prints it: '—' for no spend, '<1%' under one percent (never '0%'), '>99%' short of the whole. */
export function formatShare(part, total) {
  if (!(total > 0) || !(part > 0)) return '—';
  const pct = (part / total) * 100;
  if (pct < 1) return '<1%';
  if (pct > 99 && part < total) return '>99%';
  return `${Math.round(pct)}%`;
}

/** Whole-percent change vs the previous period; null when there is nothing to compare with. */
export function changePct(cur, prev) {
  return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
}

/** Σ over runs (+ extra units, for Ask Worca): money, hours, and cohort counts. A run that only spent in the window
 *  counts its money, not itself (D5). */
function sum(runs, rate, extraUnits = 0) {
  let units = extraUnits, hours = 0;
  const c = { runs: 0, finished: 0, stopped: 0, failed: 0, running: 0, paused: 0, prsOpened: 0, prsMerged: 0 };
  for (const r of runs) {
    units += toUnits(r.usd);
    hours += Number(r.hours) || 0;
    if (!r.inCohort) continue;
    c.runs += 1;
    if (r.status in STATUS_LABELS) c[r.status] += 1;
    if (r.pr) c.prsOpened += 1;
    if (r.pr === 'merged') c.prsMerged += 1;
  }
  const spentUsd = fromUnits(units);
  const humanHours = roundHours(hours);
  return { units, spentUsd, humanHours, savedUsd: savedUsd(humanHours, rate, spentUsd),
    usdPerHour: costPerHour(spentUsd, humanHours), ...c };
}

/** One level: value rows by spend (ties by label), the values past `top` folded into Other (n) when 2+ are left, then
 *  Unallocated. Value and Unallocated rows carry the then-by level as `children`; Other carries its values as `members`. */
function level(runs, dim, opts) {
  const groups = new Map();
  for (const r of runs) {
    const v = valueOf(r, dim);
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(r);
  }
  const make = (kind, value, rs, label) => ({
    // D20: the value is encoded, so a '/' in it cannot split the parent/child row paths the table builds.
    kind, dim, value, key: kind === 'value' ? `v:${encodeURIComponent(value)}` : kind, label: label ?? valueLabel(dim, value),
    ...sum(rs, opts.rate),
    // factIds feed the chart (deleted runs' spend included); runIds are the runs a person can open or tag.
    factIds: [...new Set(rs.map((r) => r.id).filter(Boolean))],
    runIds: [...new Set(rs.filter((r) => !r.orphan).map((r) => r.id).filter(Boolean))],
    children: opts.thenBy && kind !== 'other' ? level(rs, opts.thenBy, { ...opts, thenBy: null }) : [],
    members: [],
  });
  const values = [...groups].filter(([v]) => v !== null).map(([v, rs]) => make('value', v, rs))
    .sort((a, b) => b.units - a.units || byText(a.label, b.label));
  const fold = values.length > opts.top + 1;
  const out = fold ? values.slice(0, opts.top) : values;
  if (fold) {
    const rest = values.slice(opts.top);
    const other = make('other', null, rest.flatMap((r) => groups.get(r.value)), `Other (${rest.length})`);
    other.members = rest;
    out.push(other);
  }
  if (groups.has(null)) out.push(make('none', null, groups.get(null)));
  return out;
}

/**
 * The report model. runs: facts as GET /api/stats?report=1 serves them (filtered by the caller). askUsd and
 * requirementsUsd (plans/requirements-design.md D9) are spend that belongs to no run: each is a last row of its own,
 * part of the total, never allocated.
 * @returns {{ by, thenBy, rows, total, allocatedShare: number|null }}
 */
export function allocate(runs, { by, thenBy = null, rate = 0, askUsd = 0, requirementsUsd = 0, top = TOP_N } = {}) {
  const second = thenBy && thenBy !== by ? thenBy : null;
  const rows = level(runs, by, { thenBy: second, rate, top });
  const askUnits = toUnits(askUsd);
  if (askUnits > 0) {
    rows.push({ kind: 'ask', dim: by, value: null, key: 'ask', label: 'Chat', ...sum([], rate, askUnits),
      factIds: [], runIds: [], children: [], members: [] });
  }
  const reqUnits = toUnits(requirementsUsd);
  if (reqUnits > 0) {
    rows.push({ kind: 'requirements', dim: by, value: null, key: 'requirements', label: 'Requirements', ...sum([], rate, reqUnits),
      factIds: [], runIds: [], children: [], members: [] });
  }
  const total = sum(runs, rate, askUnits + reqUnits);
  const allocated = rows.filter((r) => r.kind === 'value' || r.kind === 'other').reduce((a, r) => a + r.units, 0);
  return { by, thenBy: second, rows, total, allocatedShare: total.units > 0 ? allocated / total.units : null };
}

/** Stacked chart series, one per top-level row (the rows' order, bottom first), one value per bucket. 'spend' reads
 *  each run's [bucketIndex, usd] pairs and the Ask Worca and Requirements series; 'hours' each cohort run's hours at
 *  its hours bucket. Ask Worca and Requirements have no hours, so the hours chart leaves them out. */
export function allocationSeries(model, runs, { buckets, metric = 'spend', askSeries = null, requirementsSeries = null }) {
  const n = buckets.length;
  const byId = new Map(runs.filter((r) => r.id).map((r) => [r.id, r]));
  const scale = metric === 'hours' ? 100 : UNIT;
  return model.rows.filter((row) => !(metric === 'hours' && (row.kind === 'ask' || row.kind === 'requirements'))).map((row) => {
    const units = new Array(n).fill(0);
    if (row.kind === 'ask') (askSeries || []).forEach((usd, i) => { if (i < n) units[i] += toUnits(usd); });
    if (row.kind === 'requirements') (requirementsSeries || []).forEach((usd, i) => { if (i < n) units[i] += toUnits(usd); });
    for (const id of row.factIds) {
      const r = byId.get(id);
      if (!r) continue;
      if (metric === 'hours') {
        if (r.hourBucket >= 0 && r.hourBucket < n) units[r.hourBucket] += Math.round((Number(r.hours) || 0) * 100);
      } else {
        for (const [i, usd] of r.spend || []) if (i >= 0 && i < n) units[i] += toUnits(usd);
      }
    }
    return { key: row.key, kind: row.kind, label: row.label, values: units.map((u) => u / scale) };
  });
}

/** The dimension picker's options ({ id, label, group, share? }): policy dimensions in their order, the built-ins,
 *  then every other cost tag key a run carries, by share of spend (ties by key). */
export function dimensionOptions({ dims = [], runs = [] } = {}) {
  const policy = dims.map((d) => ({ id: `tag:${d.key}`, label: d.label || d.key, group: 'policy' }));
  const taken = new Set(dims.map((d) => d.key));
  let total = 0;
  const byKey = new Map();
  for (const r of runs) {
    const u = toUnits(r.usd);
    total += u;
    for (const k of Object.keys(r.tags || {})) if (!taken.has(k)) byKey.set(k, (byKey.get(k) || 0) + u);
  }
  const other = [...byKey].map(([k, u]) => ({ id: `tag:${k}`, label: k, group: 'other', share: total > 0 ? u / total : 0 }))
    .sort((a, b) => b.share - a.share || byText(a.label, b.label));
  return [...policy, ...BUILTIN_DIMS.map((b) => ({ ...b, group: 'builtin' })), ...other];
}

/** Options whose label or id contains the typed text, case-insensitive; an empty query keeps them all. */
export function filterDimensionOptions(options, text) {
  const q = String(text || '').trim().toLowerCase();
  return q ? options.filter((o) => o.label.toLowerCase().includes(q) || String(o.id).toLowerCase().includes(q)) : options;
}

/** A filter's value choices for a dimension: every value by spend, then Unallocated when some run lacks it. */
export function valueOptions(runs, dim) {
  return level(runs, dim, { top: Infinity, rate: 0, thenBy: null })
    .map((r) => ({ value: r.value, label: r.label, spentUsd: r.spentUsd }));
}

const unfold = (rows) => rows.flatMap((r) => (r.kind === 'other' ? r.members : [r]));

/** The report as CSV (BOM + CRLF via rowsToCsv). One row per value, with Other (n) unfolded. With a then-by dimension,
 *  one row per (value, then-by value) leaf. Columns: the dimension label(s), today's columns, the hours columns. */
export function reportCsv(model, { byLabel, thenByLabel = '' }) {
  const two = !!model.thenBy;
  const header = [byLabel, ...(two ? [thenByLabel] : []), ...TODAY_CSV_COLS, ...HOURS_CSV_COLS];
  const cols = (r) => [r.spentUsd, r.runs, r.finished, r.stopped, r.failed, r.running, r.paused, r.prsOpened,
    r.prsMerged, r.humanHours, r.savedUsd, r.usdPerHour];
  const rows = [];
  for (const top of unfold(model.rows)) {
    if (!two || !top.children.length) rows.push([top.label, ...(two ? [''] : []), ...cols(top)]);
    else for (const c of unfold(top.children)) rows.push([top.label, c.label, ...cols(c)]);
  }
  return rowsToCsv(header, rows);
}
