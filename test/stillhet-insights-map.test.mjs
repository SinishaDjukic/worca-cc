// Slice 10 (D5–D10, R-arch-2, Invariant 3): Insights' live mapper — queries, sources, words and the field-name scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  statsQuery, teamQuery, paceOf, wordsOf, DIM_OF, statsSource, selectFacts, pooledOf, monthSpendOf, weekTotalsOf, errorOf, scopesOf,
  budgetOf, ratioOf, LIVE_PAGES, NOT_LIVE_PAGES, FIGURE_SOURCE, tagKeysOf, RUNS_ONLY, runsSpendOf, statsCsv, teamSource,
} from '../ui/public/stillhet/live/insights-map.mjs';
import { savedUsd } from '../src/shared/cost/allocation.mjs';

const NOW = new Date(2026, 10, 14, 12, 0).getTime();   // 14 Nov 2026, local noon
const sum = (a) => a.reduce((x, y) => x + y, 0);

test('statsQuery: every when word, this quarter and this year as custom from the local calendar, tag keys, impossible ranges', () => {
  const q = (w, o = {}) => statsQuery(w, { now: NOW, ...o });
  assert.equal(q('today'), '/api/stats?range=today&report=1');
  assert.equal(q('this week'), '/api/stats?range=week&report=1');
  assert.equal(q('this month'), '/api/stats?range=month&report=1');
  assert.equal(q('last month'), '/api/stats?range=lastMonth&report=1');
  assert.equal(q('all time'), '/api/stats?range=all&report=1');
  assert.equal(q('this quarter'), '/api/stats?range=custom&from=2026-10-01&to=2026-11-14&report=1');
  assert.equal(q('this year'), '/api/stats?range=custom&from=2026-01-01&to=2026-11-14&report=1');
  assert.equal(q('custom', { from: '2026-10-03', to: '2026-10-09' }), '/api/stats?range=custom&from=2026-10-03&to=2026-10-09&report=1');
  assert.equal(q('this month', { tagKeys: ['client', 'cost center'] }), '/api/stats?range=month&report=1&byTag=1&tagKey=client&tagKey=cost%20center');
  assert.throws(() => q('custom', { from: '2026-13-40', to: '2026-11-01' }), RangeError);
  assert.throws(() => q('custom', { from: '2026-11-05', to: '2026-11-01' }), RangeError);
  assert.throws(() => q('fortnight'), RangeError);
});

test('teamQuery: the team ranges pass through; today, this week and custom are custom UTC days', () => {
  assert.deepEqual(teamQuery('this quarter', { now: NOW }), { range: 'quarter', from: null, to: null });
  assert.deepEqual(teamQuery('this year', { now: NOW }), { range: 'year', from: null, to: null });
  assert.equal(teamQuery('this month', { now: NOW }).range, 'this-month');
  assert.equal(teamQuery('last month', { now: NOW }).range, 'last-month');
  assert.equal(teamQuery('all time', { now: NOW }).range, 'all');
  const utcNow = Date.UTC(2026, 10, 12, 9);   // a Thursday
  assert.deepEqual(teamQuery('today', { now: utcNow }), { range: 'custom', from: '2026-11-12', to: '2026-11-12' });
  assert.deepEqual(teamQuery('this week', { now: utcNow }), { range: 'custom', from: '2026-11-09', to: '2026-11-12' });
});

test('DIM_OF is the D4 table; the live and not-live pages split the 19', () => {
  assert.deepEqual({ ...DIM_OF }, { project: 'project', workflow: 'workflow', person: 'person', status: 'status', client: 'tag:client', teamtag: 'tag:team', costcenter: 'tag:cost-center', origin: 'origin' });
  assert.equal(LIVE_PAGES.length, 13); assert.equal(NOT_LIVE_PAGES.length, 6);
  assert.deepEqual(Object.keys(FIGURE_SOURCE).sort(), [...LIVE_PAGES].sort());
  assert.deepEqual(tagKeysOf({ dims: [{ key: 'client' }, { key: 'team' }] }), ['client', 'team']);
});

test('paceOf: $412 after 8 of 30 days against $1,000 is on pace for $1,545, $545 over; under budget has no over', () => {
  const start = new Date(2026, 10, 1).getTime(), end = new Date(2026, 11, 1).getTime(), now = new Date(2026, 10, 9).getTime();
  assert.deepEqual(paceOf({ spent: 412, startMs: start, endMs: end, now, limit: 1000 }), { pace: 1545, over: 545 });
  const under = paceOf({ spent: 100, startMs: start, endMs: end, now, limit: 1000 });
  assert.equal(under.pace, 375); assert.equal('over' in under, false);
});

test('wordsOf: Spend leaves out the budget part with no limit; the N× ratio reads 3.2× for $320 on $100', () => {
  const src = { totals: { spend: 100, saved: 320, hours: 4, tasks: 5 }, rows: { client: [{ name: 'acme', spend: 60 }, { name: 'Unallocated', spend: 40 }] }, none: 'Unallocated' };
  const w = wordsOf('spend', src, { budget: null, now: NOW });
  assert.equal(w.word, '$100');
  assert.equal(w.why, 'Saved about $320, 3.2× what it cost · $40 has no client');
  assert.equal(w.pace, '');
  assert.equal(ratioOf(320, 100), '3.2×'); assert.equal(ratioOf(5, 0), '');
  const budget = { limit: 1000, spent: 412, startMs: new Date(2026, 10, 1).getTime(), endMs: new Date(2026, 11, 1).getTime() };
  const on = wordsOf('spend', src, { budget, now: new Date(2026, 10, 9).getTime() });
  assert.equal(on.word, '$100 of $1,000');
  assert.equal(on.pace, 'On pace for $1,545, $545 over');
  assert.match(on.why, /on pace for \$1,545/);
  assert.equal(wordsOf('shipped', { totals: { prs: 2, opened: 5 }, rows: {} }).why, '5 opened, 2 merged');
  assert.equal(wordsOf('fails', { totals: { count: 4 }, rows: { project: [{ name: 'a', count: 1 }, { name: 'b', count: 3 }] } }).why, 'Most at b: 3 of 4');
  assert.equal(wordsOf('untagged', { totals: { tasks: 3, spend: 12 }, rows: {} }, { key: 'client' }).word, '3 tasks without a client');
  assert.equal(wordsOf('team', { totals: { spend: 50 }, rows: { person: [{}, {}, {}] }, people: 2 }).why, '2 people', 'F-6-10: the people, not the rows');
});

test('budgetOf: reads the store costs part (or a raw GET /api/budget) and its window; null with no limit', () => {
  assert.equal(budgetOf({ budget: { period: 'this month', spent: 3, limit: null } }), null);
  assert.equal(budgetOf({ budget: null }), null);
  const b = budgetOf({ budget: { period: 'this month', spent: 3, limit: 500 } }, NOW);
  assert.deepEqual(b, { limit: 500, spent: 3, startMs: new Date(2026, 10, 1).getTime(), endMs: new Date(2026, 11, 1).getTime() });
  assert.equal(budgetOf({ budget: { totalLimitUsd: 700, windowSpendUsd: 9, windowStartMs: 1, windowEndMs: 2 } }).limit, 700);
});

test('pooledOf: the records inside a monthly and a weekly cap window, one each side of each edge; null with no pooled cap', () => {
  const now = new Date(2026, 10, 12, 12).getTime();   // Thu 12 Nov
  const at = (y, m, d, h = 12) => new Date(y, m, d, h).toISOString();
  const records = [
    { startedAt: at(2026, 9, 31, 23), cost: { usd: 100 } },   // before the month
    { startedAt: at(2026, 10, 1, 0), cost: { usd: 2 } },      // first moment of the month, before the week
    { startedAt: at(2026, 10, 9, 0), cost: { usd: 5 } },      // Monday 9 Nov: first moment of the week
    { startedAt: at(2026, 11, 1, 0), cost: { usd: 1000 } },   // after both
  ];
  const month = pooledOf({ policy: { caps: { pooled: { value: 300, window: 'monthly' } } } }, records, now);
  assert.equal(month.spent, 7); assert.equal(month.limit, 300);
  const week = pooledOf({ policy: { caps: { pooled: { value: 80, window: 'weekly' } } } }, records, now);
  assert.equal(week.spent, 5);
  assert.equal(week.endMs - week.startMs, 7 * 86_400_000);
  assert.equal(pooledOf({ policy: { caps: { pooled: null } } }, records, now), null);
  assert.equal(pooledOf(null, records, now), null);
});

const fact = (id, o) => ({ id, person: 'Maya', project: 'billing-api', workflow: 'Default', status: 'finished', pr: null, tags: {}, usd: 1, hours: 1, inCohort: true, startedMs: 0, hourBucket: 0, spend: [], ...o });

test('selectFacts: OR within a dim, AND across dims, by the rows\' own labels', () => {
  const facts = [fact('a', { person: 'Maya', tags: { client: 'acme' } }), fact('b', { person: 'Maya', tags: { client: 'globex' } }), fact('c', { person: 'Jonas', tags: { client: 'acme' } }), fact('d', { person: 'Priya' }), fact('e', { person: 'Maya' })];
  assert.deepEqual(selectFacts(facts, ['person:Maya', 'person:Jonas']).map((f) => f.id), ['a', 'b', 'c', 'e']);
  assert.deepEqual(selectFacts(facts, ['person:Maya', 'client:acme']).map((f) => f.id), ['a']);
  assert.deepEqual(selectFacts(facts, ['client:Unallocated']).map((f) => f.id), ['d', 'e']);
  assert.deepEqual(selectFacts(facts, ['status:Finished']).length, 5);
  assert.equal(selectFacts(facts, []), facts);
});

// A small stats answer in dev's shape: 3 day buckets, 4 facts, a Chat spend.
const B = [new Date(2026, 9, 1).getTime(), new Date(2026, 9, 2).getTime(), new Date(2026, 9, 3).getTime()];
const FACTS = [
  fact('r1', { usd: 10, hours: 2, startedMs: B[0] + 1, spend: [[0, 4], [1, 6]], pr: 'merged', tags: { client: 'acme' } }),
  fact('r2', { usd: 5, hours: 1, startedMs: B[1] + 1, spend: [[1, 5]], status: 'failed', person: 'Jonas' }),
  fact('r3', { usd: 2.5, hours: 0, startedMs: B[2] + 1, spend: [[2, 2.5]], project: 'web-app', pr: 'opened' }),
  fact('r4', { usd: 1.25, hours: 0, startedMs: B[0] - 5, inCohort: false, spend: [[0, 1.25]] }),
];
const ANSWER = {
  bucket: 'day', windowStartMs: B[0], windowEndMs: B[2] + 86_400_000, humanRateUsd: 50,
  totals: { spentUsd: 21.75, humanHours: 3, savedUsd: 128.25, runs: 3, finished: 2, failed: 1, stopped: 0, prsMerged: 1, prsOpened: 2, ask: { spendUsd: 3 }, requirements: { spendUsd: 0 } },
  prev: { spentUsd: 4, humanHours: 0, savedUsd: -4, runs: 1, finished: 1, failed: 0, stopped: 0, prsMerged: 0, prsOpened: 0 },
  series: [{ bucketStartMs: B[0], spentUsd: 5.25 + 1, finished: 1, failed: 0, stopped: 0 }, { bucketStartMs: B[1], spentUsd: 11 + 1, finished: 0, failed: 1, stopped: 0 }, { bucketStartMs: B[2], spentUsd: 2.5 + 1, finished: 1, failed: 0, stopped: 0 }],
  report: { buckets: B, runs: FACTS, prevRuns: [fact('p1', { usd: 4, hours: 0 })], ask: { spentUsd: 3, series: [1, 1, 1] } },
};

test('statsSource: the per-bucket series add up to dev\'s totals; the rows with Chat add up to totals.spentUsd (Invariant 3)', () => {
  const s = statsSource(ANSWER, { page: 'spend', now: B[2] + 3600_000 });
  assert.equal(sum(s.series.spend), ANSWER.totals.spentUsd);
  assert.equal(sum(s.series.tasks), ANSWER.totals.runs);
  assert.equal(sum(s.series.hours), ANSWER.totals.humanHours);
  assert.equal(s.totals.spend, 21.75); assert.equal(s.prev.spend, 4);
  assert.deepEqual(s.labels, ['Oct 1', 'Oct 2', 'Oct 3']);
  assert.deepEqual(s.days, ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.equal(s.dayCount, 3);
  for (const d of ['project', 'workflow', 'person', 'status', 'client']) assert.equal(Math.round(sum(s.rows[d].map((r) => r.spend)) * 1e4), Math.round(21.75 * 1e4), d);
  assert.deepEqual(s.rows.origin.map((r) => [r.name, r.spend]), [['Chat', 3]]);
  const shipped = statsSource(ANSWER, { page: 'shipped' });
  assert.equal(sum(shipped.series.prs), ANSWER.totals.prsMerged);
  assert.equal(sum(shipped.series.opened), ANSWER.totals.prsOpened);
  assert.equal(statsSource(ANSWER, { page: 'spend', by: 'project', thenBy: 'person' }).kids['billing-api'].length, 2);
});

test('statsSource filtered: dev\'s allocate over the selected facts; Chat leaves; the series still add up', () => {
  const s = statsSource(ANSWER, { page: 'spend', filter: ['person:Maya'] });
  assert.equal(s.totals.spend, 10 + 2.5 + 1.25);
  assert.equal(s.totals.tasks, 2);
  assert.equal(sum(s.series.spend), s.totals.spend);
  assert.equal(sum(s.series.tasks), s.totals.tasks);
  assert.equal(s.rows.origin, undefined);
  assert.deepEqual(s.prev, { spend: 4, hours: 0, saved: -4, tasks: 1 });
  const fails = statsSource(ANSWER, { page: 'fails' });
  assert.deepEqual(fails.totals, { count: 1, spend: 5 });
  assert.equal(sum(fails.series.count), 1);
});

test('monthSpendOf, errorOf, scopesOf', () => {
  assert.equal(monthSpendOf(ANSWER, 'billing-api'), 10 + 5 + 1.25);
  assert.equal(monthSpendOf(ANSWER, 'nope'), null);
  assert.equal(monthSpendOf({}, 'billing-api'), null);
  assert.equal(errorOf(500, { error: 'x' }), 'x');
  assert.equal(errorOf(0, {}), 'Worca is not answering');
  assert.equal(errorOf(404, {}), 'HTTP 404');
  assert.deepEqual(scopesOf({ scopes: { projects: [{ id: 'project:a', label: 'acme/a' }, { id: 'project:b', label: 'b', enabled: false }], workspaces: [{ id: 'workspace:w', label: 'Shop' }] } }), [{ id: 'project:a', name: 'acme/a' }, { id: 'workspace:w', name: 'Shop' }]);
  assert.deepEqual(scopesOf({}), []);
});

test('F-3-10: weekTotalsOf reads totals for every project and the allocation row for one; 0 for a project with no row; null without totals', () => {
  const runsUsd = Math.round(ANSWER.report.runs.reduce((a, f) => a + f.usd, 0) * 100) / 100;
  assert.deepEqual(weekTotalsOf(ANSWER), { runs: 3, spentUsd: runsUsd }, 'F-fm-02: no pipelineSpendUsd: the runs\' own sum');
  assert.deepEqual(weekTotalsOf(ANSWER, null), { runs: 3, spentUsd: runsUsd });
  const row = weekTotalsOf(ANSWER, 'billing-api');
  assert.equal(row.spentUsd, monthSpendOf(ANSWER, 'billing-api'), 'the same row monthSpendOf reads');
  assert.equal(row.runs, FACTS.filter((f) => f.project === 'billing-api' && f.inCohort).length);
  assert.deepEqual(weekTotalsOf(ANSWER, 'nope'), { runs: 0, spentUsd: 0 });
  assert.equal(weekTotalsOf({}), null);
  assert.equal(weekTotalsOf(null, 'billing-api'), null);
  assert.equal(weekTotalsOf({ totals: { runs: 1, spentUsd: 1 } }, 'billing-api'), null, 'no report.runs: no project row');
});

test('F-fm-02: the all-projects week cost is the runs\' cost (pipelineSpendUsd), never totals.spentUsd with chat; the project rows add up to it', () => {
  const runsUsd = ANSWER.report.runs.reduce((a, f) => a + f.usd, 0);
  const withChat = { ...ANSWER, totals: { ...ANSWER.totals, spentUsd: runsUsd + 3770, pipelineSpendUsd: runsUsd } };
  const all = weekTotalsOf(withChat);
  assert.equal(all.spentUsd, runsUsd, 'chat spend stays out of the Tasks center');
  const projects = [...new Set(ANSWER.report.runs.map((f) => f.project))];
  const sum = projects.reduce((a, p) => a + weekTotalsOf(withChat, p).spentUsd, 0);
  assert.equal(Math.round(sum * 100) / 100, Math.round(all.spentUsd * 100) / 100, 'each project\'s figure adds up to the all-projects one');
});

// ---- R-arch-2: dev field names are read only in insights-map.mjs ----
const NAMES = ['spentUsd', 'prsMerged', 'kpis', 'breakdowns', 'windowSpendUsd', 'totalLimitUsd', 'caps', 'groups', 'error'];
const reads = (src, name) => new RegExp(`(?:\\?\\.|(?<!\\.)\\.)${name}\\b|\\[\\s*['"]${name}['"]\\s*\\]`).test(src) || new RegExp(`(?:const|let|var)\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`).test(src);

test('the scan\'s own check: it matches a.groups, a?.error and a[\'caps\'], and not an object key written as an argument', () => {
  assert.ok(reads('x = a.groups', 'groups')); assert.ok(reads('x = a?.error', 'error')); assert.ok(reads("x = a['caps']", 'caps'));
  assert.ok(reads('const { kpis } = agg', 'kpis'));
  assert.ok(!reads('R.sideMenu({ groups })', 'groups')); assert.ok(!reads('[...groups, x]', 'groups')); assert.ok(!reads('R.list({ label, groups: [] })', 'groups'));
});

test('R-arch-2: Insights\' pages, the live module and Projects read no dev field name; only insights-live.mjs names /api/', () => {
  const files = ['ui/public/stillhet/insights/insights.js', 'ui/public/stillhet/insights/insights-model.js', 'ui/public/stillhet/live/insights-live.mjs', 'ui/public/stillhet/projects/projects.js', 'ui/public/stillhet/workspaces/workspaces.js'];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const n of NAMES) assert.ok(!reads(src, n), `${f} reads .${n}`);
    if (!f.endsWith('insights-live.mjs') && /insights/.test(f)) assert.doesNotMatch(src, /\/api\//, f);
  }
  assert.match(readFileSync('ui/public/stillhet/live/insights-live.mjs', 'utf8'), /\/api\//);
});

// gate G F-G-fid-14: a live chart by project stacks each day by its rows, as classic's cost report does (allocationSeries over
// the same facts, Chat's series included): each day's parts add up to the day, each row's days to the row.
test('F-G-fid-14: statsSource cuts each day by the rows of "by" from the facts; a time "by" has no cut', () => {
  const s = statsSource(ANSWER, { page: 'spend', by: 'project', now: B[2] + 3600_000 });
  assert.ok(s.cut, 'the day cut'); assert.equal(s.cut.by, 'project');
  assert.deepEqual(s.cut.names, s.rows.project.map((r) => r.name));
  const day = s.cut.perDay.spend;
  assert.equal(day.length, 3);
  day.forEach((parts, i) => assert.equal(Math.round(sum(parts) * 1e4), Math.round(s.series.spend[i] * 1e4), `day ${i} adds up`));
  s.cut.names.forEach((n, k) => assert.equal(Math.round(sum(day.map((p) => p[k])) * 1e4), Math.round(s.rows.project[k].spend * 1e4), `${n} adds up`));
  const ends = statsSource(ANSWER, { page: 'ends', by: 'project' });
  ends.cut.perDay.finished.forEach((parts, i) => assert.equal(sum(parts), ends.series.finished[i], `ends day ${i}`));
  assert.equal(statsSource(ANSWER, { page: 'spend', by: 'week' }).cut, null);
});

test('F-6-11 = V3-10: wordsOf writes \u2212$ for a negative saved; never $-', () => {
  const w = wordsOf('value', { totals: { saved: -412.4, spend: 412.4, hours: 0 }, rows: {} });
  assert.ok(w.why.includes('\u2212$412 saved on $412'), w.why);
  assert.ok(!w.why.includes('$-'), w.why);
  const neg = wordsOf('value', { totals: { saved: -4, spend: 4, hours: 2 }, rows: {} });
  assert.equal(neg.why, '\u2212$4 saved on $4 \u00b7 $2.00 for each hour saved');
});

// ---- B4.9: Per task counts tasks only (F-6-08) ----
const MODEL = (() => { const window = {}; vm.runInNewContext(readFileSync('ui/public/stillhet/insights/insights-model.js', 'utf8'), { window }); return window.RailInsightsModel; })();
const RUN_FACTS = [
  fact('t1', { usd: 2000, hours: 30, startedMs: B[0] + 1, spend: [[0, 1200], [1, 800]] }),
  fact('t2', { usd: 1500, hours: 20, startedMs: B[1] + 1, spend: [[1, 1500]], person: 'Jonas', status: 'failed' }),
  fact('t3', { usd: 549.95, hours: 0, startedMs: B[2] + 1, spend: [[2, 549.95]], project: 'web-app' }),
];
const CHATTY = {
  ...ANSWER,
  totals: { ...ANSWER.totals, runs: 107, pipelineSpendUsd: 4049.95, spentUsd: 27649.45, humanHours: 50, savedUsd: savedUsd(50, 50, 27649.45), ask: { spendUsd: 23598 }, requirements: { spendUsd: 1.5 } },
  prev: { ...ANSWER.prev, spentUsd: 500, pipelineSpendUsd: 4, ask: { spendUsd: 496 } },
  series: B.map((b, i) => ({ bucketStartMs: b, spentUsd: [9000, 10000, 8649.45][i], finished: 0, failed: 0, stopped: 0 })),
  report: { buckets: B, runs: RUN_FACTS, prevRuns: [fact('p1', { usd: 4, hours: 0 })], ask: { spentUsd: 23598, series: [7000, 8000, 8598] }, requirements: { spentUsd: 1.5, series: [0, 1.5, 0] } },
};

test('F-6-08: Per task divides the runs\' cost (pipelineSpendUsd) by tasks; Chat, Requirements and Design stay out of headline, series, rows, cut and CSV', () => {
  assert.deepEqual(RUNS_ONLY, ['per-task']);
  const s = statsSource(CHATTY, { page: 'per-task', by: 'project', now: B[2] + 3600_000 });
  assert.equal(s.totals.spend, 4049.95);
  assert.equal(s.totals.tasks, 107);
  assert.equal(s.totals.saved, savedUsd(50, 50, 4049.95), 'Saved is against the runs\' cost');
  assert.equal(s.prev.spend, 4, 'the period before: its runs\' cost');
  const sub = { ...MODEL.SUB['per-task'], src: s }, c = MODEL.compute(sub, MODEL.defaults(sub));
  assert.equal(Math.round(c.v * 100), 3785, 'not 258.4…');
  assert.equal(Math.round(sum(s.series.spend) * 100), 404995, 'the series are the facts\' own');
  for (const [d, rows] of Object.entries(s.rows)) {
    assert.ok(!rows.some((r) => ['Chat', 'Requirements', 'Design'].includes(r.name)), d);
    assert.equal(Math.round(sum(rows.map((r) => r.spend)) * 100), 404995, `${d} adds up to the runs' cost`);
  }
  assert.equal(s.rows.origin, undefined);
  assert.ok(!s.cut.names.includes('Chat'));
  s.cut.perDay.spend.forEach((parts, i) => assert.equal(Math.round(sum(parts) * 100), Math.round(s.series.spend[i] * 100), `day ${i}`));
  const csv = statsCsv(CHATTY, { page: 'per-task', byLabel: 'Project' });
  assert.doesNotMatch(csv, /^"?Chat/m); assert.doesNotMatch(csv, /^"?Requirements/m);
  assert.match(statsCsv(CHATTY, { page: 'spend', byLabel: 'Project' }), /^"?Chat/m, 'Spend\'s CSV keeps Chat');
  assert.equal(statsSource(CHATTY, { page: 'spend' }).totals.spend, 27649.45, 'Spend keeps the whole spend');
  // runsSpendOf: pipelineSpendUsd, else the facts summed to the cent, else null
  assert.equal(runsSpendOf({ pipelineSpendUsd: 4049.95 }, []), 4049.95);
  assert.equal(runsSpendOf({}, [{ usd: 0.105 }, { usd: 0.2 }]), 0.31);
  assert.equal(runsSpendOf({}, undefined), null);
  assert.equal(runsSpendOf(null, null), null);
});

test('F-6-10: By person counts 9 named people, not the 7 rows of top 5, Other and Unallocated', async () => {
  const { makeRecord } = await import('./fixtures/team-metrics/records.mjs');
  const names = ['Maya', 'Jonas', 'Priya', 'Lee', 'Ana', 'Ben', 'Cleo', 'Dev', 'Eli'];
  const records = names.map((actor, i) => makeRecord({ id: `r${i}`, actor, usd: 10 - i, startedAt: '2026-11-10T10:00:00Z' }));
  records.push(makeRecord({ id: 'nobody', actor: null, usd: 3, startedAt: '2026-11-10T11:00:00Z' }));
  const s = teamSource(records, { when: 'this month', now: NOW });
  assert.equal(s.rows.person.length, 7, 'top 5, Other (4), Unallocated');
  assert.equal(s.people, 9);
  assert.match(wordsOf('team', s).why, /^9 people/);
  const maya = teamSource(records, { when: 'this month', now: NOW, filter: ['person:Maya'] });
  assert.equal(maya.people, 1);
  assert.match(wordsOf('team', maya).why, /^1 person/);
});

test('F-6-12: How tasks end\'s headline, bars and rows count the same runs over the shown buckets (all time, today, month)', () => {
  const ENDS = ['finished', 'failed', 'stopped'];
  const pick = (o) => Object.fromEntries(ENDS.map((k) => [k, o[k]]));
  const adds = (s, want, label) => {
    assert.deepEqual(pick(s.totals), want, `${label}: totals`);
    for (const k of ENDS) {
      assert.equal(sum(s.series[k]), want[k], `${label}: Σ bars ${k}`);
      for (const d of ['status', 'project']) assert.equal(sum(s.rows[d].map((r) => r[k])), want[k], `${label}: Σ rows.${d} ${k}`);
    }
  };
  // all time: totals over everything, bars over the last months; the page shows the bars' runs only
  const MB = [new Date(2026, 8, 1).getTime(), new Date(2026, 9, 1).getTime(), new Date(2026, 10, 1).getTime()];
  const runs = [];
  const add = (count, status, startedMs, project = 'billing-api') => { for (let i = 0; i < count; i++) runs.push(fact(`f${runs.length}`, { status, startedMs, project })); };
  add(30, 'finished', MB[0] + 1); add(25, 'finished', MB[1] + 1, 'web-app'); add(15, 'finished', MB[2] + 1);
  add(4, 'failed', MB[0] + 1); add(5, 'failed', MB[2] + 1, 'web-app'); add(5, 'stopped', MB[1] + 1);
  add(30, 'finished', MB[0] - 86_400_000); add(3, 'failed', MB[0] - 86_400_000); add(3, 'stopped', MB[0] - 1);
  const all = { range: 'all', bucket: 'month', windowStartMs: MB[0], windowEndMs: new Date(2026, 11, 1).getTime(), humanRateUsd: 0,
    totals: { runs: 120, finished: 100, failed: 12, stopped: 8, spentUsd: 120 }, prev: null,
    series: MB.map((b) => ({ bucketStartMs: b, spentUsd: 0, finished: 30, failed: 4, stopped: 2 })),
    report: { buckets: MB, runs, prevRuns: null } };
  adds(statsSource(all, { page: 'ends', now: NOW }), { finished: 70, failed: 9, stopped: 5 }, 'all time');
  // today: totals are the active window, dev's bars the updated buckets; the page counts each active run once, by its start
  const HB = Array.from({ length: 12 }, (_, i) => new Date(2026, 10, 14, i).getTime());
  const today = { range: 'today', bucket: 'hour', windowStartMs: HB[0], windowEndMs: HB[0] + 86_400_000, humanRateUsd: 0,
    totals: { runs: 2, finished: 1, failed: 1, stopped: 0, spentUsd: 2 }, prev: { runs: 0, finished: 0, failed: 0, stopped: 0, spentUsd: 0 },
    series: HB.map((b, i) => ({ bucketStartMs: b, spentUsd: 0, finished: i === 5 ? 1 : 0, failed: i === 5 ? 1 : 0, stopped: 0 })),
    report: { buckets: HB, runs: [fact('y', { startedMs: HB[0] - 3_600_000 }), fact('t', { startedMs: HB[3] + 1, status: 'failed' })], prevRuns: [] } };
  const t = statsSource(today, { page: 'ends', now: HB[11] });
  adds(t, { finished: 1, failed: 1, stopped: 0 }, 'today');
  assert.equal(t.series.finished[0], 1, 'started yesterday: once, in the first bucket');
  assert.equal(t.series.failed[3], 1);
  // a cohort range: the same numbers as dev's totals and series
  const m = statsSource(ANSWER, { page: 'ends' });
  adds(m, { finished: 2, failed: 1, stopped: 0 }, 'month');
  assert.deepEqual(m.series.finished, ANSWER.series.map((s) => s.finished));
  assert.deepEqual(m.series.failed, ANSWER.series.map((s) => s.failed));
  assert.deepEqual(pick(m.prev), pick(ANSWER.prev), 'the period before keeps dev\'s prev');
});

// ---- B4.9 review minors (impl-review-cycle1) ----
test('B4.9 F-6-08 review: Per task under all time draws the shown months only and names that span (seriesSpan); the totals stay all time', () => {
  const MB = [new Date(2026, 8, 1).getTime(), new Date(2026, 9, 1).getTime(), new Date(2026, 10, 1).getTime()];
  const runs = [
    fact('old', { usd: 900, hours: 0, startedMs: MB[0] - 40 * 86_400_000, spend: [] }),
    fact('a', { usd: 10, hours: 0, startedMs: MB[0] + 1, spend: [[0, 10]] }),
    fact('b', { usd: 20, hours: 0, startedMs: MB[2] + 1, spend: [[2, 20]] }),
  ];
  const all = { range: 'all', bucket: 'month', windowStartMs: MB[0], windowEndMs: new Date(2026, 11, 1).getTime(), humanRateUsd: 0,
    totals: { runs: 3, finished: 3, failed: 0, stopped: 0, spentUsd: 930, pipelineSpendUsd: 930, humanHours: 0, savedUsd: -930 }, prev: null,
    series: MB.map((b) => ({ bucketStartMs: b, spentUsd: 0, finished: 0, failed: 0, stopped: 0 })), report: { buckets: MB, runs, prevRuns: null } };
  const s = statsSource(all, { page: 'per-task', now: NOW });
  assert.equal(s.totals.spend, 930, 'the headline stays all time');
  assert.equal(s.totals.tasks, 3);
  assert.equal(s.seriesSpan, 'the last 3 months');
  assert.deepEqual(s.series.tasks, [1, 0, 1], 'a task begun before the first month is not drawn in it');
  assert.deepEqual(s.series.spend, [10, 0, 20]);
  assert.equal(statsSource(ANSWER, { page: 'per-task' }).seriesSpan, null, 'a bounded range: the bars are the whole period');
});

test('B4.9 F-6-08 review: with no runs spend known, Per task keeps tasks and hours and leaves spend and saved unknown (null), never 0', () => {
  const blind = { ...ANSWER, totals: { ...ANSWER.totals, runs: 107, humanHours: 50 }, prev: { ...ANSWER.prev }, report: { buckets: B } };
  const s = statsSource(blind, { page: 'per-task', now: B[2] + 3600_000 });
  assert.equal(s.totals.tasks, 107);
  assert.equal(s.totals.hours, 50);
  assert.equal(s.totals.spend, null);
  assert.equal(s.totals.saved, null);
  assert.equal(s.prev, null, 'no period before to compare with');
  assert.deepEqual(s.series.spend, [null, null, null]);
  const sub = { ...MODEL.SUB['per-task'], src: s }, c = MODEL.compute(sub, MODEL.defaults(sub));
  assert.equal(c.v, null);
  assert.equal(sub.word(c), 'Cost a task not known');
  assert.equal(sub.why(c), '107 tasks, their cost not known');
  assert.equal(MODEL.cmp(c, sub), '');
});

test('B4.9 F-6-11 review: against a zero base the comparison says new this period, never "Up from $0"', () => {
  assert.equal(MODEL.cmp({ p: 0, v: 10 }, MODEL.SUB.spend), 'New this period, none in the period before');
  assert.equal(MODEL.cmp({ p: 0, v: -12 }, MODEL.SUB['time-saved']), 'New this period, none in the period before');
  assert.equal(MODEL.cmp({ p: 0, v: 0 }, MODEL.SUB.spend), 'About the same as $0 in the period before');
  assert.equal(MODEL.cmp({ p: 0, v: 4 }, MODEL.SUB['per-task']), 'New this period, none in the period before');
});
