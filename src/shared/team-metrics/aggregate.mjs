// src/shared/team-metrics/aggregate.mjs
// Team metrics aggregation (team-metrics-design.md §4.9). PURE: no I/O, no node: imports —
// shared by the server (read.mjs) and the browser (the page re-aggregates per range/group/filter).

export const SUPPORTED_RECORD_VERSION = 1;
export const RANGES = Object.freeze(['this-month', 'last-month', 'quarter', 'year', 'all', 'custom']);
export const GROUP_BYS = Object.freeze(['workflow', 'result', 'actor', 'project']);
export const FILTER_DIMS = Object.freeze(['workflow', 'source', 'actor', 'project', 'models', 'result']);
const DAY = 86_400_000;
const WEEK = 7 * DAY;

// UTC ISO-8601 only (what record.mjs writes). Anything else — "2026-09-01 00:30" (parsed in LOCAL time,
// so server and browser would bucket it differently), "+200000-01-01…" (expanded years) — is malformed.
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

/** @returns {{record:object}|{malformed:true}|{unknownV:true}} */
export function parseRecordLine(line) {
  let v;
  try { v = JSON.parse(line); } catch { return { malformed: true }; }
  if (!v || typeof v !== 'object' || Array.isArray(v) || !Number.isInteger(v.v)) return { malformed: true };
  if (v.v > SUPPORTED_RECORD_VERSION) return { unknownV: true };
  if (v.v < 1 || typeof v.id !== 'string' || typeof v.startedAt !== 'string'
    || !ISO_UTC_RE.test(v.startedAt) || !Number.isFinite(Date.parse(v.startedAt))) return { malformed: true };
  return { record: v };
}

const MAX_CUSTOM_DAYS = 3660; // ~10 years: bounds the weekly series
const MAX_WEEKS = Math.ceil(MAX_CUSTOM_DAYS / 7) + 2;

function parseDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = Date.parse(`${s}T00:00:00Z`);
  // Reject roll-overs such as 2026-02-31 (Date.parse would silently give Mar 3).
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(s) ? ms : null;
}

/**
 * UTC window + the previous window for deltas. startMs inclusive, endMs exclusive.
 * Deltas are like-for-like: while `now` is inside the current window (this month / quarter /
 * year so far), the previous window is cut to the same elapsed length, so "vs prev. month" on
 * Sep 16 compares Sep 1–16 with Aug 1–16, not with all of August.
 */
export function resolveRange(range = 'this-month', { now = Date.now(), from = null, to = null } = {}) {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const win = (startMs, endMs, prevStartMs) => {
    // `>=`, not `>`: at exactly 00:00 on the 1st the window is open with 0 elapsed, so the previous
    // window must be 0 long too. With `>` it fell through to the closed-window branch and compared
    // "nothing so far this month" against ALL of last month for one millisecond.
    const elapsed = now >= startMs && now < endMs ? now - startMs : startMs - prevStartMs;
    return { range, startMs, endMs, prevStartMs, prevEndMs: Math.min(startMs, prevStartMs + elapsed) };
  };
  switch (range) {
    case 'this-month': return win(Date.UTC(y, m, 1), Date.UTC(y, m + 1, 1), Date.UTC(y, m - 1, 1));
    case 'last-month': return win(Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1), Date.UTC(y, m - 2, 1));
    case 'quarter': { const q = Math.floor(m / 3) * 3; return win(Date.UTC(y, q, 1), Date.UTC(y, q + 3, 1), Date.UTC(y, q - 3, 1)); }
    case 'year': return win(Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1), Date.UTC(y - 1, 0, 1));
    case 'all': return { range, startMs: null, endMs: null, prevStartMs: null, prevEndMs: null };
    case 'custom': {
      const s = parseDay(from);
      const e = parseDay(to);
      if (s == null || e == null || e < s) throw new RangeError('custom range needs from and to as valid YYYY-MM-DD dates with from <= to');
      if ((e - s) / DAY > MAX_CUSTOM_DAYS) throw new RangeError(`custom range is limited to ${MAX_CUSTOM_DAYS} days`);
      const endMs = e + DAY;
      return { range, startMs: s, endMs, prevStartMs: s - (endMs - s), prevEndMs: s };
    }
    default: throw new RangeError(`unknown range "${range}" (expected ${RANGES.join(' | ')})`);
  }
}

/** Monday 00:00 UTC of the week containing ms. */
export function weekStartMs(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
}

const startOf = (r) => Date.parse(r.startedAt);
const usdOf = (r) => (Number.isFinite(r?.cost?.usd) ? r.cost.usd : 0);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sum = (a) => a.reduce((s, x) => s + x, 0);
const round2 = (v) => Math.round(v * 100) / 100;
const round1 = (v) => Math.round(v * 10) / 10;

function percentile(values, p) {
  const xs = values.filter(isNum).sort((a, b) => a - b);
  if (!xs.length) return null;
  return xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(p * xs.length) - 1))]; // nearest rank
}

const NONE = '__none__';

/** Dimension keys for filtering/breakdowns. Each returns [{key,label,sub?,weight}] (a run may touch several projects). */
export const DIMENSIONS = {
  workflow: (r) => [{ key: r.workflow?.id || r.workflow?.name || NONE, label: r.workflow?.name || r.workflow?.id || 'Unknown workflow' }],
  // A hand-written or future record may carry no `result`: without the guard it became the stack
  // key "undefined" with an undefined label.
  result: (r) => [{ key: typeof r.result === 'string' && r.result ? r.result : NONE, label: typeof r.result === 'string' && r.result ? r.result : 'Unknown result' }],
  actor: (r) => [{ key: r.actor || NONE, label: r.actor || 'No actor' }],
  source: (r) => (r.source
    ? [{ key: `${r.source.type}:${r.source.ref ?? r.source.url ?? ''}`, label: [r.source.ref, r.source.title].filter(Boolean).join(' ') || r.source.url || r.source.type, sub: r.source.type }]
    : [{ key: NONE, label: 'No ticket', sub: 'ad-hoc prompts' }]),
  models: (r) => {
    const ms = Array.isArray(r.agents?.models) ? [...r.agents.models].sort() : [];
    return [{ key: ms.join(' + ') || NONE, label: ms.join(' + ') || 'Unknown models' }];
  },
  project: (r) => {
    if (r.target?.kind === 'workspace') {
      const t = Array.isArray(r.target.touched) ? r.target.touched : [];
      return t.length ? t.map((p) => ({ key: p, label: p, weight: 1 / t.length })) : [{ key: NONE, label: 'No project touched', weight: 1 }];
    }
    return [{ key: r.target?.project || NONE, label: r.target?.project || 'Unknown project', weight: 1 }];
  },
};

export function applyFilter(records, filter = {}) {
  const active = Object.entries(filter || {}).filter(([dim, key]) => FILTER_DIMS.includes(dim) && key != null && key !== '');
  if (!active.length) return records;
  return records.filter((r) => active.every(([dim, key]) => DIMENSIONS[dim](r).some((k) => k.key === key)));
}

function computeKpis(rs, now) {
  const n = rs.length;
  const count = (res) => rs.filter((r) => r.result === res).length;
  const usd = sum(rs.map(usdOf));
  const paired = rs.filter((r) => isNum(r.wallMs) && isNum(r.activeMs));
  const wallSum = sum(paired.map((r) => r.wallMs));
  const withPr = rs.filter((r) => r.pr && (r.pr.url || r.pr.number != null));
  const reviews = rs.map((r) => r.cycles?.review).filter(isNum);
  const d = new Date(now);
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return {
    spendUsd: round2(usd),
    spendThisMonthUsd: round2(sum(rs.filter((r) => startOf(r) >= monthStart).map(usdOf))),
    runs: n,
    done: count('done'), failed: count('failed'), stopped: count('stopped'),
    successRate: n ? count('done') / n : null,
    costPerRunUsd: n ? round2(usd / n) : null,
    costPerRunMedianUsd: percentile(rs.map(usdOf), 0.5),
    costPerRunP90Usd: percentile(rs.map(usdOf), 0.9),
    runsWithPr: withPr.length,
    costPerRunWithPrUsd: withPr.length ? round2(sum(withPr.map(usdOf)) / withPr.length) : null,
    durationMedianMs: percentile(rs.map((r) => r.wallMs), 0.5),
    machineMs: sum(rs.map((r) => r.activeMs).filter(isNum)),
    autonomy: wallSum > 0 ? sum(paired.map((r) => r.activeMs)) / wallSum : null,
    interventionsPerRun: n ? round1(sum(rs.map((r) => (r.interventions?.questions | 0) + (r.interventions?.pauses | 0))) / n) : null,
    reviewCyclesMean: reviews.length ? round1(sum(reviews) / reviews.length) : null,
    convergeInOneRate: reviews.length ? reviews.filter((c) => c <= 1).length / reviews.length : null,
    filesChanged: sum(rs.map((r) => r.git?.filesChanged).filter(isNum)),
  };
}

const pct = (cur, prev) => (isNum(cur) && isNum(prev) && prev > 0 ? (cur - prev) / prev : null);

function deltas(k, p) {
  return {
    spendPct: pct(k.spendUsd, p.spendUsd),
    runsPct: pct(k.runs, p.runs),
    costPerRunPct: pct(k.costPerRunUsd, p.costPerRunUsd),
    durationPct: pct(k.durationMedianMs, p.durationMedianMs),
    autonomyPts: isNum(k.autonomy) && isNum(p.autonomy) ? Math.round((k.autonomy - p.autonomy) * 100) : null,
    reviewCycles: isNum(k.reviewCyclesMean) && isNum(p.reviewCyclesMean) ? round1(k.reviewCyclesMean - p.reviewCyclesMean) : null,
  };
}

function breakdown(rs, dim) {
  const rows = new Map();
  for (const r of rs) {
    for (const k of DIMENSIONS[dim](r)) {
      const row = rows.get(k.key) || { key: k.key, label: k.label, sub: k.sub ?? null, runs: 0, usd: 0, done: 0, reviews: [], filesChanged: 0 };
      row.runs += 1;
      row.usd += usdOf(r);                       // "a run touching two projects counts in both"
      if (r.result === 'done') row.done += 1;
      if (isNum(r.cycles?.review)) row.reviews.push(r.cycles.review);
      if (isNum(r.git?.filesChanged)) row.filesChanged += r.git.filesChanged;
      rows.set(k.key, row);
    }
  }
  // `share` is normalised against THIS column's own sum, not against the run total. For every
  // single-key dimension the two are equal; for `project` on a workspace scope a run touching two
  // projects deliberately counts its full spend in BOTH rows (decision 19, the mockup subtitle),
  // so dividing by the run total made the bars sum to 200%. The weekly stacked chart keeps the
  // 1/n weight instead, so its column heights still add up to the real spend — the table answers
  // "how much did work on this project cost", the chart answers "where did the money go".
  const colTotal = [...rows.values()].reduce((a, r) => a + r.usd, 0);
  return [...rows.values()]
    .map((row) => ({
      key: row.key, label: row.label, sub: row.sub, runs: row.runs, usd: round2(row.usd),
      perRunUsd: row.runs ? round2(row.usd / row.runs) : null,
      successRate: row.runs ? row.done / row.runs : null,
      cyclesMean: row.reviews.length ? round1(sum(row.reviews) / row.reviews.length) : null,
      share: colTotal > 0 ? row.usd / colTotal : 0,
      filesChanged: row.filesChanged,
      isNone: row.key === NONE,
    }))
    .sort((a, b) => (a.isNone - b.isNone) || b.usd - a.usd || b.runs - a.runs);
}

function weekSpan(rs, win, now) {
  // reduce, not Math.min(...spread): a spread over ~100k+ records overflows the call stack.
  let minStart = Infinity;
  let maxStart = -Infinity;
  for (const r of rs) { const t = startOf(r); if (t < minStart) minStart = t; if (t > maxStart) maxStart = t; }
  const first = win.startMs ?? (rs.length ? minStart : null);
  if (first == null) return [];
  // Series stop at `now`, but never before the newest record in range (a teammate's clock may run
  // ahead) — by at most 31 days: records come from a branch anyone with push access can write,
  // and one record dated year 20000 must not produce ~900k weeks (a 100 MB response / Map overflow).
  const cap = Math.max(now, rs.length ? Math.min(maxStart, now + 31 * DAY) : -Infinity);
  const last = Math.min(win.endMs != null ? win.endMs - 1 : cap, cap);
  const to = weekStartMs(Math.max(first, last));
  const from = Math.max(weekStartMs(first), to - (MAX_WEEKS - 1) * WEEK); // at most ~10 years of columns
  const weeks = [];
  for (let w = from; w <= to; w += WEEK) weeks.push(w);
  return weeks;
}

function series(rs, win, groupBy, now) {
  const weeks = weekSpan(rs, win, now);
  const idx = new Map(weeks.map((w, i) => [w, i]));
  // Null-prototype maps: keys are record-supplied strings ("constructor", "__proto__" must not collide).
  const spend = weeks.map((w) => ({ weekStartMs: w, totalUsd: 0, stacks: Object.create(null) }));
  const runs = weeks.map((w) => ({ weekStartMs: w, done: 0, failed: 0, stopped: 0 }));
  const labels = Object.create(null);
  const totals = Object.create(null);
  for (const r of rs) {
    const i = idx.get(weekStartMs(startOf(r)));
    if (i == null) continue;
    if (r.result === 'done' || r.result === 'failed' || r.result === 'stopped') runs[i][r.result] += 1;
    spend[i].totalUsd += usdOf(r);
    for (const k of DIMENSIONS[groupBy](r)) {
      const v = usdOf(r) * (k.weight ?? 1);       // stacked by project touched: split evenly
      spend[i].stacks[k.key] = (spend[i].stacks[k.key] || 0) + v;
      totals[k.key] = (totals[k.key] || 0) + v;
      labels[k.key] = k.label;
    }
  }
  for (const pt of spend) {
    pt.totalUsd = round2(pt.totalUsd);
    // Back to a plain object (Object.fromEntries defines own data properties, so "__proto__" survives)
    // — callers and deepStrictEqual expect ordinary objects.
    pt.stacks = Object.fromEntries(Object.entries(pt.stacks).map(([key, v]) => [key, round2(v)]));
  }
  const stackKeys = Object.keys(totals).sort((a, b) => totals[b] - totals[a])
    .map((key) => ({ key, label: labels[key], totalUsd: round2(totals[key]) }));
  return { spend, runs, stackKeys };
}

/** Records come from a branch anyone with push access can write: only http(s) links survive. */
export function safeHttpUrl(u) {
  if (typeof u !== 'string' || !u) return null;
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; }
}

function toRunRow(r) {
  return {
    id: r.id, title: r.title ?? '(untitled)', startedAt: r.startedAt,
    workflow: r.workflow?.name ?? r.workflow?.id ?? null, result: r.result,
    usd: usdOf(r), wallMs: isNum(r.wallMs) ? r.wallMs : null, activeMs: isNum(r.activeMs) ? r.activeMs : null,
    reviewCycles: isNum(r.cycles?.review) ? r.cycles.review : null,
    pr: r.pr && (r.pr.url || r.pr.number != null) ? { number: Number.isInteger(r.pr.number) ? r.pr.number : null, url: safeHttpUrl(r.pr.url) } : null,
    actor: r.actor ?? null,
    source: r.source ? [r.source.ref, r.source.title].filter(Boolean).join(' ') : null,
    projects: r.target?.kind === 'workspace'
      ? (Array.isArray(r.target.touched) ? r.target.touched.filter((p) => typeof p === 'string') : [])
      : [r.target?.project].filter((p) => typeof p === 'string' && p),
  };
}

/**
 * @param {object[]} records  v1 records (already parsed; unknown v / malformed already dropped)
 * @param {{range?:string, from?:string|null, to?:string|null, groupBy?:string, filter?:object, now?:number}} [opts]
 */
export function aggregate(records, { range = 'this-month', from = null, to = null, groupBy = 'workflow', filter = {}, now = Date.now() } = {}) {
  if (!GROUP_BYS.includes(groupBy)) throw new RangeError(`unknown groupBy "${groupBy}" (expected ${GROUP_BYS.join(' | ')})`);
  const win = resolveRange(range, { now, from, to });
  const usable = (records || []).filter((r) => r && Number.isFinite(startOf(r)));
  const filtered = applyFilter(usable, filter);
  const inWin = (s, e) => (r) => (s == null || startOf(r) >= s) && (e == null || startOf(r) < e);
  const inRange = filtered.filter(inWin(win.startMs, win.endMs));
  const kpis = computeKpis(inRange, now);
  const prevKpis = win.prevStartMs == null ? null : computeKpis(filtered.filter(inWin(win.prevStartMs, win.prevEndMs)), now);
  const hasActor = inRange.some((r) => r.actor);
  const hasWorkspace = inRange.some((r) => r.target?.kind === 'workspace');
  return {
    range: win, groupBy, filter: { ...filter },
    kpis, prev: prevKpis, deltas: prevKpis ? deltas(kpis, prevKpis) : null,
    series: series(inRange, win, groupBy, now),
    breakdowns: {
      workflow: breakdown(inRange, 'workflow'),
      source: breakdown(inRange, 'source'),
      actor: hasActor ? breakdown(inRange, 'actor') : null,
      project: hasWorkspace ? breakdown(inRange, 'project') : null,
      models: breakdown(inRange, 'models'),
    },
    runs: [...inRange].sort((a, b) => startOf(b) - startOf(a)).map(toRunRow),
    totalRecords: usable.length,
  };
}

export const CSV_COLUMNS = Object.freeze(['startedAt', 'title', 'workflow', 'result', 'costUsd', 'wallMs', 'activeMs', 'reviewCycles', 'prNumber', 'prUrl', 'actor', 'source', 'projects', 'id']);

function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;            // spreadsheet formula injection guard
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of aggregate().runs rows (the filtered run table). */
export function toCsv(runRows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of runRows) {
    lines.push([
      r.startedAt, r.title, r.workflow, r.result, r.usd, r.wallMs, r.activeMs, r.reviewCycles,
      r.pr?.number, r.pr?.url, r.actor, r.source, (r.projects || []).join(' '), r.id,
    ].map(csvCell).join(','));
  }
  // BOM: Excel otherwise reads the file as the local code page and mangles every non-ASCII
  // actor/title ("Siniša Đukić"). Sheets and LibreOffice ignore it.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
