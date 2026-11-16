// Insights' live mapper (slice 10, D5): dev's statistics and team-metrics answers → the design model's source shape.
// Pure and deterministic given `now`. The only Insights code that reads dev's field names; every figure is dev's own
// number, from the API answer or from dev's allocate, allocationSeries, aggregate, recordFacts, heatGrid and
// missingKeyTodos. It never rounds: formatting stays in the page. Its own arithmetic is named and pinned in
// test/stillhet-insights-map.test.mjs: paceOf, the N× ratio, the pooled window sum and the per-bucket cohort counts.
import { allocate, allocationSeries, matchesFilters, valueOf, valueLabel, formatShare, reportCsv, savedUsd } from '../../../../src/shared/cost/allocation.mjs';
import { aggregate } from '../../../../src/shared/team-metrics/aggregate.mjs';
import { recordFacts, heatGrid, missingKeyTodos } from '../../../../src/shared/team-metrics/cost-facts.mjs';
import { rowsToCsv } from '../../../../src/shared/csv.mjs';

export const NOT_ANSWERING = 'Worca is not answering';
const DAY = 86_400_000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The design's dims (insights-model.js DIM) → dev's allocation dims (D4). `origin` is the rows allocate adds. */
export const DIM_OF = Object.freeze({ project: 'project', workflow: 'workflow', person: 'person', status: 'status', client: 'tag:client', teamtag: 'tag:team', costcenter: 'tag:cost-center', origin: 'origin' });
export const LIVE_PAGES = Object.freeze(['spend', 'per-task', 'budget', 'time-saved', 'value', 'ends', 'fails', 'shipped', 'throughput', 'team', 'untagged', 'shaping', 'heat']);
export const NOT_LIVE_PAGES = Object.freeze(['why', 'review', 'autonomy', 'cache', 'merge', 'waiting']);
export const TEAM_PAGES = Object.freeze(['team', 'untagged', 'heat']);
/** D17: every live page's figure and the one dev source it reads. */
export const FIGURE_SOURCE = Object.freeze({
  spend: 'GET /api/stats totals.spentUsd',
  'per-task': 'GET /api/stats totals.spentUsd ÷ totals.runs',
  budget: 'GET /api/stats totals.spentUsd against GET /api/budget totalLimitUsd',
  'time-saved': 'GET /api/stats totals.savedUsd',
  value: 'GET /api/stats totals.savedUsd ÷ totals.spentUsd',
  ends: 'GET /api/stats totals.finished, totals.failed, totals.stopped',
  fails: 'GET /api/stats report.runs (failed or stopped) through allocate().total',
  shipped: 'GET /api/stats totals.prsMerged',
  throughput: 'GET /api/stats totals.finished',
  team: 'GET /api/team-metrics records through aggregate().kpis.spendUsd',
  untagged: 'GET /api/team-metrics records through missingKeyTodos().rows',
  shaping: 'GET /api/stats shaping.groups',
  heat: 'GET /api/team-metrics records through heatGrid()',
});
const FIELDS = { money: ['spend', 'hours', 'saved', 'tasks'], ends: ['finished', 'failed', 'stopped'], fails: ['count', 'spend'], shipped: ['prs', 'opened'], throughput: ['finished'], untagged: ['tasks', 'spend'], shaping: ['runs', 'usd', 'uruns', 'uusd', 'mins', 'cycles'] };
const FIELDS_OF = { spend: FIELDS.money, 'per-task': FIELDS.money, budget: FIELDS.money, 'time-saved': FIELDS.money, value: FIELDS.money, ends: FIELDS.ends, fails: FIELDS.fails, shipped: FIELDS.shipped, throughput: FIELDS.throughput, team: FIELDS.money, heat: FIELDS.money, untagged: FIELDS.untagged };
const SHARE_OF = { 'time-saved': 'saved', ends: 'finished', fails: 'count', shipped: 'prs', throughput: 'finished', untagged: 'tasks' };

// ---- days ----
const pad = (n) => String(n).padStart(2, '0');
const isoLocal = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isoUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
/** A YYYY-MM-DD that is a real day, else null. */
export function dayOf(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? s : null;
}
function customDays(from, to) {
  const f = dayOf(from), t = dayOf(to);
  if (!f || !t || t < f) throw new RangeError('a custom range needs from and to as real days, from not after to');
  return [f, t];
}

/** D7: the stats query of a "when" word (this quarter and this year are custom from the local calendar's first day). */
export function statsQuery(when, { from = null, to = null, tagKeys = [], now = Date.now() } = {}) {
  const d = new Date(now), today = isoLocal(now);
  const PASS = { today: 'today', 'this week': 'week', 'this month': 'month', 'last month': 'lastMonth', 'all time': 'all' };
  let q;
  if (PASS[when]) q = `range=${PASS[when]}`;
  else if (when === 'this quarter') q = `range=custom&from=${isoLocal(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime())}&to=${today}`;
  else if (when === 'this year') q = `range=custom&from=${d.getFullYear()}-01-01&to=${today}`;
  else if (when === 'custom') { const [f, t] = customDays(from, to); q = `range=custom&from=${f}&to=${t}`; }
  else throw new RangeError(`unknown when "${when}"`);
  const tags = tagKeys.length ? `&byTag=1${tagKeys.map((k) => `&tagKey=${encodeURIComponent(k)}`).join('')}` : '';
  return `/api/stats?${q}&report=1${tags}`;
}

/** D7: team metrics' range of a "when" word; today, this week and custom are custom in UTC days. */
export function teamQuery(when, { from = null, to = null, now = Date.now() } = {}) {
  const PASS = { 'this month': 'this-month', 'last month': 'last-month', 'this quarter': 'quarter', 'this year': 'year', 'all time': 'all' };
  if (PASS[when]) return { range: PASS[when], from: null, to: null };
  const today = isoUtc(now);
  if (when === 'today') return { range: 'custom', from: today, to: today };
  if (when === 'this week') { const d = new Date(now), back = (d.getUTCDay() + 6) % 7; return { range: 'custom', from: isoUtc(now - back * DAY), to: today }; }
  if (when === 'custom') { const [f, t] = customDays(from, to); return { range: 'custom', from: f, to: t }; }
  throw new RangeError(`unknown when "${when}"`);
}

// ---- facts ----
const devDim = (d) => DIM_OF[d] || null;
/** D2: the facts for which dev's matchesFilters holds for at least one ticked value of each dim (OR within, AND across).
 *  A ticked name is a row's label (valueLabel), so each is matched back to the raw values that read as it. */
export function selectFacts(facts, filter = []) {
  const by = new Map();
  for (const k of filter) {
    const at = k.indexOf(':'), dim = devDim(k.slice(0, at));
    if (!dim || dim === 'origin') continue;
    if (!by.has(dim)) by.set(dim, new Set());
    by.get(dim).add(k.slice(at + 1));
  }
  if (!by.size) return facts;
  const values = new Map([...by].map(([dim, names]) => [dim, [...new Set(facts.map((f) => valueOf(f, dim)))].filter((v) => names.has(valueLabel(dim, v)))]));
  return facts.filter((f) => [...values].every(([dim, vs]) => vs.some((value) => matchesFilters(f, [{ dim, value }]))));
}
const ticksOf = (filter) => filter.filter((k) => !k.startsWith('origin:'));

/** A dev sum (stats totals, an allocate row or total) → the design's fields. */
function fromSum(s, fields) {
  const all = { spend: s.spentUsd, hours: s.humanHours, saved: s.savedUsd, tasks: s.runs, finished: s.finished, failed: s.failed, stopped: s.stopped, prs: s.prsMerged, opened: s.prsOpened, count: (s.failed || 0) + (s.stopped || 0) };
  return Object.fromEntries(fields.map((f) => [f, all[f] ?? 0]));
}
const fromKpis = (k, fields) => fromSum({ spentUsd: k.spendUsd, humanHours: k.humanHours, savedUsd: k.savedUsd, runs: k.runs, finished: k.done, failed: k.failed, stopped: k.stopped }, fields);
const rowOf = (r, fields, share, totals) => ({ name: r.label, ...fromSum(r, fields), share: formatShare(fromSum(r, [share])[share], totals[share]), ...(r.kind === 'other' ? { other: r.members.length } : {}), ...(r.kind === 'value' ? {} : { kind: r.kind }) });

/** Index of the bucket holding ms: the last start at or before it; a fact before the first bucket counts in the first. */
function bucketAt(buckets, ms) {
  let i = 0;
  for (let k = 0; k < buckets.length && buckets[k] <= ms; k++) i = k;
  return i;
}
/** D6: each cohort fact counts once, in the bucket holding its startedMs (dev's own cohort rule). */
function cohortSeries(facts, buckets, fields, rate, spendSeries) {
  const n = buckets.length, out = Object.fromEntries(fields.map((f) => [f, new Array(n).fill(0)]));
  const hours = new Array(n).fill(0);
  for (const f of facts) {
    if (!f.inCohort || !n) continue;
    const i = Number.isFinite(f.startedMs) ? bucketAt(buckets, f.startedMs) : (f.hourBucket >= 0 ? f.hourBucket : n - 1);
    const one = fromSum({ runs: 1, finished: +(f.status === 'finished'), failed: +(f.status === 'failed'), stopped: +(f.status === 'stopped'), prsMerged: +(f.pr === 'merged'), prsOpened: +!!f.pr }, fields);
    for (const k of fields) if (k !== 'spend' && k !== 'hours' && k !== 'saved') out[k][i] += one[k];
    hours[i] += Number(f.hours) || 0;
  }
  if (out.hours) out.hours = hours;
  if (out.spend) out.spend = spendSeries;
  if (out.saved) out.saved = hours.map((h, i) => savedUsd(h, rate, spendSeries[i]));
  return out;
}
const sumRows = (series, n) => Array.from({ length: n }, (_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));

function labelsOf(buckets, bucket, { utc = false } = {}) {
  const parts = (ms) => { const d = new Date(ms); return utc ? [d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()] : [d.getMonth(), d.getDate(), d.getHours()]; };
  return buckets.map((ms) => { const [m, day, h] = parts(ms); return bucket === 'hour' ? `${pad(h)}:00` : bucket === 'month' ? MON[m] : `${MON[m]} ${day}`; });
}
function daysOf(buckets, bucket, endMs, { utc = false } = {}) {
  const iso = utc ? isoUtc : isoLocal;
  const lastOf = (ms) => { const d = new Date(ms); return utc ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) : new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime(); };
  const days = buckets.map((ms) => iso(ms));
  const last = buckets.map((ms) => iso(Math.min(bucket === 'month' ? lastOf(ms) : ms, Number.isFinite(endMs) ? endMs - 1 : Infinity)));
  return { days, last };
}
const dayCountOf = (bucket, buckets, startMs, endMs, now) => (bucket === 'hour' ? 1 : bucket === 'day' ? buckets.length : Math.max(1, Math.round((Math.min(endMs, now ?? endMs) - startMs) / DAY)));

function rowsAndKids(facts, { dims, by, thenBy, rate, extras, fields, share, totals }) {
  const rows = {}, kids = {};
  for (const d of dims) {
    const m = allocate(facts, { by: DIM_OF[d], thenBy: d === by && thenBy && DIM_OF[thenBy] && thenBy !== 'origin' ? DIM_OF[thenBy] : null, rate, ...extras });   // dev's own top 5, Other (n), Unallocated
    rows[d] = m.rows.map((r) => rowOf(r, fields, share, totals));
    if (d === by && m.thenBy) for (const r of m.rows) kids[r.label] = r.children.map((k) => rowOf(k, fields, share, totals));
  }
  return { rows, kids };
}
const tagDims = (facts, tagKeys) => ['client', 'teamtag', 'costcenter'].filter((d) => { const key = DIM_OF[d].slice(4); return tagKeys.includes(key) || facts.some((f) => f.tags && key in f.tags); });

/** F-G-fid-14: each bucket cut by the top rows of `by`, as classic's cost report stacks them: dev's allocate over the same
 *  facts, its allocationSeries for the money (Chat, Requirements and Design from their own series when nothing is
 *  ticked), and each row's own facts counted per bucket as the page's series are. `perDay[field][bucket][row]`, the rows
 *  in `names` order. A time "by" (or one dev cannot cut by) has none: the page draws whole bars and says so. */
function cutOf(sel, { by, rate, extras, fields, buckets, rep, whole }) {
  const n = buckets.length;
  if (!n || !DIM_OF[by] || by === 'origin') return null;
  const model = allocate(sel, { by: DIM_OF[by], rate, ...extras });
  const own = (k) => (whole ? rep[k]?.series || null : null);
  const money = allocationSeries(model, sel, { buckets, askSeries: own('ask'), requirementsSeries: own('requirements'), designSeries: own('design') });
  const byId = new Map(sel.filter((f) => f.id).map((f) => [f.id, f]));
  const rows = model.rows.map((row, k) => cohortSeries((row.factIds || []).map((id) => byId.get(id)).filter(Boolean), buckets, fields, rate, money[k]?.values || new Array(n).fill(0)));
  const perDay = Object.fromEntries(fields.map((f) => [f, buckets.map((_, i) => rows.map((r) => r[f]?.[i] || 0))]));
  return { by, names: model.rows.map((r) => r.label), perDay };
}

/** D2–D6: one stats answer (report=1) → a live source for a page. */
export function statsSource(answer, { by = 'project', thenBy = '', filter = [], page = 'spend', tagKeys = [], now } = {}) {
  const fields = FIELDS_OF[page] || FIELDS.money, share = SHARE_OF[page] || 'spend';
  const rep = answer.report || {}, facts = rep.runs || [], rate = answer.humanRateUsd || 0;
  const ticks = ticksOf(filter), extra = page === 'fails' ? ['status:Failed', 'status:Stopped'] : [];
  const select = (list) => (ticks.length || extra.length ? selectFacts(selectFacts(list, ticks), extra) : list);
  const sel = select(facts), whole = !ticks.length && !extra.length;
  const t = answer.totals || {}, extras = whole ? { askUsd: t.ask?.spendUsd || 0, requirementsUsd: t.requirements?.spendUsd || 0, designUsd: t.design?.spendUsd || 0 } : {};
  const totals = whole ? fromSum(t, fields) : fromSum(allocate(sel, { by: 'project', rate }).total, fields);
  const prev = answer.prev == null || !rep.prevRuns && !whole ? null : whole ? fromSum(answer.prev, fields) : fromSum(allocate(select(rep.prevRuns), { by: 'project', rate }).total, fields);
  const buckets = rep.buckets || (answer.series || []).map((s) => s.bucketStartMs), n = buckets.length;
  const spendSeries = whole ? (answer.series || []).map((s) => s.spentUsd)
    : sumRows(allocationSeries(allocate(sel, { by: 'project', top: Infinity }), sel, { buckets }), n);
  const series = cohortSeries(sel, buckets, fields, rate, spendSeries);
  if (whole) for (const k of ['finished', 'failed', 'stopped']) if (series[k]) series[k] = (answer.series || []).map((s) => s[k]);
  if (series.count && whole) series.count = (answer.series || []).map((s) => s.failed + s.stopped);
  const dims = ['project', 'workflow', 'person', 'status', ...tagDims(facts, tagKeys)];
  const { rows, kids } = rowsAndKids(sel, { dims, by, thenBy, rate, extras, fields, share, totals });
  if (whole) { const m = allocate([], { by: 'project', rate, ...extras }); const o = m.rows.map((r) => rowOf(r, fields, share, totals)); if (o.length) rows.origin = o; }
  const { days, last } = daysOf(buckets, answer.bucket, answer.windowEndMs);
  const cut = cutOf(sel, { by, rate, extras, fields, buckets, rep, whole });
  return { live: true, fields, labels: labelsOf(buckets, answer.bucket), days, last, dayCount: dayCountOf(answer.bucket, buckets, answer.windowStartMs, answer.windowEndMs, now), series, before: null, totals, prev, rows, kids, cut, none: 'Unallocated' };
}

/** The Cost report's model for a page as drawn (D24's Download CSV): dev's allocate over the same facts, then reportCsv. */
/** A live page's rows as drawn (the team pages have no stats answer), through dev's one CSV writer: its formula guard
 *  keeps a teammate's person, project or tag value such as `=1+1` from reaching a spreadsheet as a formula. */
export const rowsCsv = (header, rows) => rowsToCsv(header, rows);

export function statsCsv(answer, { by = 'project', thenBy = '', filter = [], page = 'spend', byLabel, thenByLabel = '' } = {}) {
  const facts = selectFacts((answer.report || {}).runs || [], ticksOf(filter)), t = answer.totals || {}, whole = !ticksOf(filter).length;
  const dev = DIM_OF[by] && by !== 'origin' ? DIM_OF[by] : 'project', then = thenBy && DIM_OF[thenBy] && thenBy !== 'origin' ? DIM_OF[thenBy] : null;
  const model = allocate(page === 'fails' ? selectFacts(facts, ['status:Failed', 'status:Stopped']) : facts, { by: dev, thenBy: then, rate: answer.humanRateUsd || 0, ...(whole && page !== 'fails' ? { askUsd: t.ask?.spendUsd || 0, requirementsUsd: t.requirements?.spendUsd || 0, designUsd: t.design?.spendUsd || 0 } : {}) });
  return reportCsv(model, { byLabel, thenByLabel });
}

/** D13: the stats answer's shaping groups as given, by size. A size's totals are its averages times its runs (time in
 *  minutes), so the page's average (total ÷ runs) is dev's own per size. */
export function shapingSource(answer) {
  const groups = answer.shaping?.groups || [], fields = FIELDS.shaping;
  const tot = (x, k) => (x && x[k] != null ? x[k] * x.runs : 0);
  const rows = groups.map((g) => ({ name: g.size, runs: g.shaped?.runs || 0, usd: tot(g.shaped, 'avgCostUsd'), uruns: g.unshaped?.runs || 0, uusd: tot(g.unshaped, 'avgCostUsd'), mins: tot(g.shaped, 'avgActiveMs') / 60000, cycles: tot(g.shaped, 'avgReviewCycles'), share: '' }));
  const totals = Object.fromEntries(fields.map((f) => [f, rows.reduce((a, r) => a + r[f], 0)]));
  return { live: true, fields, labels: [], days: [], last: [], dayCount: 0, series: Object.fromEntries(fields.map((f) => [f, []])), before: null, totals, prev: null, rows: { size: rows }, kids: {}, noTime: true, none: 'Unallocated' };
}

/** D3: the enabled scopes of GET /api/team-metrics/scopes, as [{id, name}]. */
export function scopesOf(answer) {
  const s = answer?.scopes || {};
  return [...(s.projects || []), ...(s.workspaces || [])].filter((x) => x && x.id && x.enabled !== false).map((x) => ({ id: x.id, name: x.label || x.name || x.id }));
}

/** D3, D4: one scope's records → a live team source (dev's aggregate for the headline, recordFacts and allocate for rows). */
export function teamSource(records, { when = 'this month', from = null, to = null, by = 'person', thenBy = '', filter = [], now = Date.now(), humanRateUsd = 0, page = 'team' } = {}) {
  const q = teamQuery(when, { from, to, now }), fields = FIELDS_OF[page] || FIELDS.money, share = SHARE_OF[page] || 'spend';
  const facts = recordFacts(records, { range: q.range, from: q.from, to: q.to, now }), ticks = ticksOf(filter);
  const sel = selectFacts(facts.runs, ticks), rate = humanRateUsd;
  const agg = aggregate(records, { range: q.range, from: q.from, to: q.to, groupBy: 'actor', filter: {}, now, humanRateUsd });
  const totals = ticks.length ? fromSum(allocate(sel, { by: 'person', rate }).total, fields) : fromKpis(agg.kpis, fields);
  const prev = facts.prevRuns == null ? null : ticks.length ? fromSum(allocate(selectFacts(facts.prevRuns, ticks), { by: 'person', rate }).total, fields) : agg.prev ? fromKpis(agg.prev, fields) : null;
  const n = facts.buckets.length, spendSeries = sumRows(allocationSeries(allocate(sel, { by: 'person', top: Infinity }), sel, { buckets: facts.buckets }), n);
  const series = cohortSeries(sel, facts.buckets, fields, rate, spendSeries);
  const dims = ['person', 'project', 'workflow', ...tagDims(facts.runs, [])];
  const { rows, kids } = rowsAndKids(sel, { dims, by, thenBy, rate, extras: {}, fields, share, totals });
  const { days, last } = daysOf(facts.buckets, facts.bucket, facts.windowEndMs, { utc: true });
  return { live: true, fields, labels: labelsOf(facts.buckets, facts.bucket, { utc: true }), days, last, dayCount: dayCountOf(facts.bucket, facts.buckets, facts.windowStartMs, facts.windowEndMs, now), series, before: null, totals, prev, rows, kids, none: 'Unallocated', facts: sel };
}

/** D14: dev's heatGrid over the window's facts, or null. `by` is dev's dim (project, workflow, tag:client). */
export function heatOf(records, { by, window: w = {}, now = Date.now() } = {}) {
  const q = teamQuery(w.when || 'this month', { from: w.from, to: w.to, now });
  const facts = recordFacts(records, { range: q.range, from: q.from, to: q.to, now });
  return heatGrid(selectFacts(facts.runs, ticksOf(w.filter || [])), { by });
}
/** Dev's heat grid → the heatGrid component's rows, columns and cells (value: spend, runs). */
export function gridOf(h) {
  if (!h) return null;
  const at = new Map(h.cells.map((c) => [`${c.person}\u0000${c.col}`, c]));
  return { rows: h.people.map((p) => ({ label: p.label })), columns: h.columns.map((c) => ({ label: c.label })), cells: h.people.map((p) => h.columns.map((c) => { const x = at.get(`${p.key}\u0000${c.key}`); return { value: x ? x.spentUsd : 0, runs: x ? x.runs : 0 }; })), max: h.maxUsd };
}

/** D11: the Missing cost tags page over facts with no value for the key: dev's missingKeyTodos for the totals and person
 *  rows, dev's allocate over the same facts for the project and workflow rows. */
export function untaggedSource(facts, key, base = {}) {
  const todo = missingKeyTodos(facts, [{ key, required: true }]), fields = FIELDS.untagged;
  const totals = { tasks: todo.rows.reduce((a, r) => a + r.runs, 0), spend: todo.rows.reduce((a, r) => a + r.spentUsd, 0) };
  const lacking = facts.filter((f) => f.inCohort && valueOf(f, `tag:${key}`) === null);
  const rows = { person: todo.rows.map((r) => ({ name: r.label, tasks: r.runs, spend: r.spentUsd, share: formatShare(r.runs, totals.tasks) })) };
  for (const d of ['project', 'workflow']) rows[d] = allocate(lacking, { by: d, top: Infinity }).rows.map((r) => ({ name: r.label, tasks: r.runs, spend: r.spentUsd, share: formatShare(r.runs, totals.tasks) }));
  const n = (base.labels || []).length, series = { tasks: new Array(n).fill(0), spend: new Array(n).fill(0) };
  for (const f of lacking) { const i = f.hourBucket; if (i >= 0 && i < n) { series.tasks[i] += 1; series.spend[i] += f.usd; } }
  return { live: true, fields, labels: base.labels || [], days: base.days || [], last: base.last || [], dayCount: base.dayCount || 0, series, before: null, totals, prev: null, rows, kids: {}, none: 'Unallocated', key };
}

// ---- words (D10) ----
const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`, usd2 = (n) => `$${n.toFixed(2)}`, pct = (n) => `${Math.round(n * 100)}%`;
const DAY_START = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

/** The budget of the store's costs part (GET /api/budget through live-map costsOf), with its reset window; null unset. */
export function budgetOf(costs, now = Date.now()) {
  const b = costs?.budget;
  const limit = b ? (b.limit ?? b.totalLimitUsd ?? null) : null;
  if (!(limit > 0)) return null;
  const d = new Date(now), period = b.period || (b.resetPeriod === 'weekly' ? 'this week' : 'this month');
  let startMs = b.windowStartMs ?? null, endMs = b.windowEndMs ?? null;
  if (startMs == null && period === 'this week') { startMs = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime(); endMs = startMs + 7 * DAY; }
  if (startMs == null && period === 'this month') { startMs = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); endMs = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); }
  if (startMs == null && period === 'today') { startMs = DAY_START(now); endMs = startMs + DAY; }
  return { limit, spent: b.spent ?? b.windowSpendUsd ?? 0, startMs, endMs };
}

/** D10: the pooled cap of GET /api/policy and the spend in its window, by paintPooledBudgetTile's rule (local calendar
 *  month or Monday week; records whose startedAt falls in it), restated because dev keeps it inline in app.js. */
export function pooledOf(policy, records = [], now = Date.now()) {
  const pooled = policy?.policy?.caps?.pooled;
  if (!pooled || !(pooled.value > 0)) return null;
  const d = new Date(now);
  const start = pooled.window === 'weekly' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)) : new Date(d.getFullYear(), d.getMonth(), 1);
  const end = pooled.window === 'weekly' ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) : new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const spent = records.filter((r) => { const t = Date.parse(r.startedAt); return t >= start.getTime() && t < end.getTime(); }).reduce((a, r) => a + (Number(r.cost?.usd) || 0), 0);
  return { limit: pooled.value, spent, startMs: start.getTime(), endMs: end.getTime() };
}

/** D10: spend straight-lined over the reset window; `over` only past the limit. */
export function paceOf({ spent, startMs, endMs, now, limit }) {
  const gone = Math.min(endMs, now) - startMs, all = endMs - startMs;
  if (!(gone > 0) || !(all > 0)) return { pace: spent };
  const pace = (spent * all) / gone;
  return limit != null && pace > limit ? { pace, over: pace - limit } : { pace };
}
/** The N× ratio: saved ÷ spent, one decimal; '' with nothing spent. */
export const ratioOf = (saved, spent) => (spent > 0 ? `${(saved / spent).toFixed(1)}×` : '');

/** D10: a page's word, why and pace from its live source; a part with no figure is left out, never a dash. */
export function wordsOf(id, source, { budget = null, pooled = null, now = Date.now(), by = 'project', key = '' } = {}) {
  const T = source.totals, join = (l) => l.filter(Boolean).join(' · ');
  const paceText = (b) => { if (!b || b.startMs == null) return null; const p = paceOf({ ...b, now }); return { p, head: p.over != null ? `On pace for ${usd(p.pace)}, ${usd(p.over)} over` : '' }; };
  if (id === 'spend') {
    const pc = paceText(budget), none = (source.rows.client || []).find((r) => r.name === source.none);
    const ratio = ratioOf(T.saved, T.spend);
    return { word: `${usd(T.spend)}${budget ? ` of ${usd(budget.limit)}` : ''}`, why: join([ratio && T.saved > 0 && `Saved about ${usd(T.saved)}, ${ratio} what it cost`, pc && `on pace for ${usd(pc.p.pace)}`, none && none.spend > 0 && `${usd(none.spend)} has no client`]), pace: pc?.head || '' };
  }
  if (id === 'budget' && budget) {
    const pc = paceText(budget), gone = Math.max(1, Math.ceil((Math.min(now, budget.endMs) - budget.startMs) / DAY)), all = Math.round((budget.endMs - budget.startMs) / DAY);
    return { word: `${pct(T.spend / budget.limit)} of ${usd(budget.limit)} used`, why: join([`${usd(T.spend)} so far`, pc && `on pace for ${usd(pc.p.pace)}${pc.p.over != null ? `, ${usd(pc.p.over)} over` : ''}`, `${gone} of ${all} days gone`]), pace: pc?.head || '' };
  }
  if (id === 'value') return { why: join([`${usd(T.saved)} saved on ${usd(T.spend)}`, T.hours > 0 && `${usd2(T.spend / T.hours)} for each hour saved`]) };
  if (id === 'ends') { const all = T.finished + T.failed + T.stopped; return { why: all ? `${T.failed} failed, ${T.stopped} stopped · ${pct(T.finished / all)} finish` : '' }; }
  if (id === 'fails') { const top = [...(source.rows[by] || [])].sort((a, b) => b.count - a.count)[0]; return { why: top && T.count ? `Most at ${top.name}: ${top.count} of ${T.count}` : '' }; }
  if (id === 'shipped') return { why: `${T.opened} opened, ${T.prs} merged` };
  if (id === 'team') {
    const n = (source.rows.person || []).length, pc = paceText(pooled);
    return { word: `${usd(T.spend)}${pooled ? ` of ${usd(pooled.limit)}` : ''}`, why: join([`${n} ${n === 1 ? 'person' : 'people'}`, pc && `on pace for ${usd(pc.p.pace)}`, pooled && `pooled budget at ${pct(pooled.spent / pooled.limit)}`]) };
  }
  if (id === 'untagged') return { word: `${T.tasks} ${T.tasks === 1 ? 'task' : 'tasks'} without a ${key}`, why: `${usd(T.spend)} has no ${key}` };
  return {};
}

/** D19: a project's spend in the this-month stats answer: its `project` row, matched by name; null when absent. */
export function monthSpendOf(answer, name) {
  const facts = answer?.report?.runs;
  if (!Array.isArray(facts)) return null;
  const row = allocate(facts, { by: 'project', top: Infinity }).rows.find((r) => r.kind === 'value' && r.label === name);
  return row ? row.spentUsd : null;
}

/** F-3-10: this week's task count and spend for the Tasks center's head: the answer's totals for every project, else the
 *  project's allocation row (0 when it has none this week); null without totals, or without facts for a project.
 *  F-fm-02: the Tasks center counts tasks, so its cost is the runs' only (pipelineSpendUsd, else the runs' facts summed),
 *  never totals.spentUsd, which holds chat spend too: the project rows add up to it. Insights keeps the whole spend. */
export function weekTotalsOf(answer, project = null) {
  const t = answer?.totals;
  if (!t) return null;
  const facts = answer.report?.runs;
  if (project == null) {
    const runsUsd = Number.isFinite(t.pipelineSpendUsd) ? t.pipelineSpendUsd : Array.isArray(facts) ? Math.round(facts.reduce((a, f) => a + (f.usd || 0), 0) * 100) / 100 : null;
    return runsUsd == null ? null : { runs: t.runs, spentUsd: runsUsd };
  }
  if (!Array.isArray(facts)) return null;
  const row = allocate(facts, { by: 'project', top: Infinity }).rows.find((r) => r.kind === 'value' && r.label === project);
  return row ? { runs: row.runs, spentUsd: row.spentUsd } : { runs: 0, spentUsd: 0 };
}

/** D8: the failed state's words. */
export function errorOf(status, body) {
  if (!status) return NOT_ANSWERING;
  return (body && typeof body.error === 'string' && body.error) || `HTTP ${status}`;
}

/** The cost tag keys of GET /api/tag-dimensions, in order. */
export const tagKeysOf = (answer) => (Array.isArray(answer?.dims) ? answer.dims.map((d) => d && d.key).filter((k) => typeof k === 'string' && k) : []);
/** A team answer's records and human rate. */
export const recordsOf = (answer) => ({ records: Array.isArray(answer?.records) ? answer.records : [], humanRateUsd: answer?.humanRateUsd || 0 });
