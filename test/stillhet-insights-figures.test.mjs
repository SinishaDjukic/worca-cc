// Slice 10 (R-qa-1, R-qa-2, Invariant 2): every live Insights figure is dev's own number. One set of seeded runs and one
// fixed custom range: each page's headline, total, period-before total and breakdown row (every DIM_OF dim, filtered and
// unfiltered) equals the matching field of GET /api/stats; the team pages equal dev's aggregate, heatGrid and
// missingKeyTodos over makeRecord records. The team-metrics route is not called: it needs a git sink, and
// test/team-metrics-api.test.mjs already pins its `aggregate` field to the same call.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { makeRecord } from './fixtures/team-metrics/records.mjs';

useTempHome(after);
process.env.WORCA_FLAGS = 'requirements,design';
let sandboxHome, srv, base, app, runs, getDb, recordCostDelta, recordAskCostDelta, recordRequirementsCostDelta, recordDesignCostDelta, insertRunTags, setTotalCostLimitUsd;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-insights-figures-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  ({ app, runs } = await import('../ui/server.mjs'));
  ({ getDb } = await import('../src/core/db.mjs'));
  ({ recordCostDelta, recordAskCostDelta, recordRequirementsCostDelta, recordDesignCostDelta } = await import('../src/core/cost-budget.mjs'));
  ({ insertRunTags } = await import('../src/core/run-tags-store.mjs'));
  ({ setTotalCostLimitUsd } = await import('../src/core/settings.mjs'));
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  await seed();
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  runs?.clear();
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete process.env.WORCA_FLAGS;
  await rm(sandboxHome, { recursive: true, force: true });
});

const M = (() => { const window = {}; vm.runInNewContext(readFileSync('ui/public/stillhet/insights/insights-model.js', 'utf8'), { window }); return window.RailInsightsModel; })();
const map = await import('../ui/public/stillhet/live/insights-map.mjs');
const { allocate } = await import('../src/shared/cost/allocation.mjs');
const { aggregate } = await import('../src/shared/team-metrics/aggregate.mjs');
const { recordFacts, heatGrid, missingKeyTodos } = await import('../src/shared/team-metrics/cost-facts.mjs');
const { costsOf } = await import('../ui/public/stillhet/live/live-map.mjs');

const cents = (n) => Math.round((n ?? 0) * 100);
const eqUsd = (a, b, m) => assert.equal(cents(a), cents(b), `${m}: ${a} vs ${b}`);
const at = (d, h = 12) => new Date(2026, 9, d, h);
const JONAS = 'Jonas';   // the route trims `person` (src/core/stats.mjs), so a stored value whose label differs never matches it
const WF = (name) => ({ template: { id: `wf_${name.toLowerCase()}`, name } });
// [project, person, status, workflow, tags, usd, pr, day, size, shaped]
const SEED = [
  ['billing-api', 'Maya', 'done', 'Default', ['client:acme', 'team:payments', 'cost-center:CC-1'], 40, 'MERGED', 2, 'small', true],
  ['billing-api', JONAS, 'done', 'Full', ['client:globex', 'team:growth'], 25, 'OPEN', 3],
  ['web-app', 'Maya', 'error', 'Default', ['client:acme'], 12.5, null, 5],
  ['web-app', JONAS, 'stopped', 'Full', [], 7.25, null, 6],
  ['web-app', 'Maya', 'done', 'Full', ['client:acme', 'cost-center:CC-2'], 30, 'MERGED', 8, 'medium', true],
  ['worca-cc', JONAS, 'done', 'Default', ['team:payments'], 18, null, 10],
  ['worca-cc', 'Maya', 'done', 'Default', [], 9.75, null, 12, 'small', false],
  ['billing-api', 'Maya', 'error', 'Full', ['client:globex'], 5, null, 14],
  ['worca-cc', JONAS, 'done', 'Default', ['client:acme'], 14, null, 16],
  ['web-app', 'Maya', 'stopped', 'Default', [], 3.5, null, 20],
];
async function seed() {
  const put = async ([project, who, status, wf, tags, usd, pr, day, size, shaped], when) => {
    const { id } = await seedPipeline(`/tmp/${project}`, { status, stepper: WF(wf), humanHours: 2 });
    getDb().prepare('UPDATE pipelines SET started_at = ?, started_by = ? WHERE id = ?').run(when.toISOString(), who, id);
    if (pr) getDb().prepare("UPDATE pipelines SET pr_url = 'https://github.com/o/r/pull/1', pr_state = ? WHERE id = ?").run(pr, id);
    if (size) getDb().prepare('UPDATE pipelines SET run_size = ?, shape_stats = ? WHERE id = ?').run(size, shaped ? JSON.stringify({ reviewCycles: 1 }) : null, id);
    if (tags.length) insertRunTags(id, tags);
    recordCostDelta({ pipelineId: id, amountUsd: usd, tsMs: +when });
  };
  for (const s of SEED) await put(s, at(s[7]));
  await put(['billing-api', 'Maya', 'done', 'Default', [], 20, null], new Date(2026, 8, 10, 12));   // September: the period before
  await put(['web-app', JONAS, 'done', 'Full', [], 10, null], new Date(2026, 8, 20, 12));
  recordAskCostDelta({ threadId: 'ask_aaaaaaaa', messageId: 'askm_00000001', amountUsd: 2, tokens: 10, model: 'x', tsMs: +at(5) });
  recordRequirementsCostDelta({ featureSeq: 1, turnId: 1, amountUsd: 1.5, tsMs: +at(6) });
  recordDesignCostDelta({ designId: 'd_a', amountUsd: 0.75, tsMs: +at(7) });
}

const RANGE = 'range=custom&from=2026-10-01&to=2026-10-31&report=1';
const TAG_Q = '&byTag=1&tagKey=client&tagKey=team&tagKey=cost-center';
const get = async (q) => { const r = await fetch(`${base}/api/stats?${q}`); assert.equal(r.status, 200, q); return r.json(); };
const asserted = new Set();
const liveSub = (id, src) => ({ ...M.SUB[id], src });
const computeOf = (id, src, st = {}) => M.compute(liveSub(id, src), { ...M.defaults(liveSub(id, src)), ...st });

// what each live stats page's total fields are in dev's totals
const TOTAL_FIELDS = { spend: 'spentUsd', hours: 'humanHours', saved: 'savedUsd', tasks: 'runs', finished: 'finished', failed: 'failed', stopped: 'stopped', prs: 'prsMerged', opened: 'prsOpened' };
const STATS_PAGES = ['spend', 'per-task', 'budget', 'time-saved', 'value', 'ends', 'shipped', 'throughput'];

test('totals: each stats page\'s headline, totals and period before are GET /api/stats totals and prev, to the cent', async () => {
  const a = await get(RANGE + TAG_Q);
  assert.equal(a.totals.runs, 10); eqUsd(a.totals.spentUsd, 165 + 2 + 1.5 + 0.75, 'seeded spend');
  for (const id of STATS_PAGES) {
    const src = map.statsSource(a, { page: id, tagKeys: ['client', 'team', 'cost-center'] }), c = computeOf(id, src);
    for (const f of src.fields) { eqUsd(c.T[f], a.totals[TOTAL_FIELDS[f]], `${id} ${f}`); eqUsd(c.P[f], a.prev[TOTAL_FIELDS[f]], `${id} prev ${f}`); }
    const sub = M.SUB[id], whole = (T) => (sub.den ? (T[sub.den] ? T[sub.num] / T[sub.den] : 0) : T[sub.num]);
    assert.equal(c.v, whole(Object.fromEntries(src.fields.map((f) => [f, a.totals[TOTAL_FIELDS[f]]]))), `${id}: the headline`);
    asserted.add(id);
  }
  const fails = map.statsSource(a, { page: 'fails' }), fc = computeOf('fails', fails);
  assert.equal(fc.T.count, a.totals.failed + a.totals.stopped);
  eqUsd(fc.T.spend, 12.5 + 7.25 + 5 + 3.5, 'Where it fails: the spend of the runs that did not finish');
  assert.equal(fc.st.by, 'project', 'no stage live: the first dim the source has');
  asserted.add('fails');
});

test('rows: every DIM_OF dim the live source offers equals dev\'s groups, tag groups or allocate rows; the buckets equal series[]', async () => {
  const a = await get(RANGE + TAG_Q), byPerson = await get(`${RANGE}&groupBy=person`);
  const src = map.statsSource(a, { page: 'spend', tagKeys: ['client', 'team', 'cost-center'] });
  const NONE = { person: '(unknown person)', client: '(no client)', teamtag: '(no team)', costcenter: '(no cost-center)' };
  const byName = (rows) => Object.fromEntries(rows.map((r) => [r.name, r]));
  const checkGroup = (d, groupRows) => {
    const mine = byName(src.rows[d]);
    for (const g of groupRows) {
      const name = g.kind === 'none' ? 'Unallocated' : g.label;
      assert.ok(mine[name], `${d}: ${name} (${g.kind})`);
      eqUsd(mine[name].spend, g.spentUsd, `${d} ${name} spend`);
      assert.equal(mine[name].tasks, g.runs, `${d} ${name} runs`);
    }
    assert.ok(!NONE[d] || !src.rows[d].some((r) => r.name === NONE[d]), `${d}: Unallocated, not ${NONE[d]}`);
  };
  const tags = Object.fromEntries(a.tagGroups.map((t) => [t.key, t.rows]));
  const seen = new Set();
  for (const d of Object.keys(src.rows)) {
    seen.add(d);
    if (d === 'person') checkGroup(d, byPerson.groups.rows);
    else if (d === 'client') checkGroup(d, tags.client);
    else if (d === 'teamtag') checkGroup(d, tags.team);
    else if (d === 'costcenter') checkGroup(d, tags['cost-center']);
    else if (['project', 'workflow', 'status'].includes(d)) {
      const want = allocate(a.report.runs, { by: d }).rows;
      for (const w of want) { const r = src.rows[d].find((x) => x.name === w.label); eqUsd(r.spend, w.spentUsd, `${d} ${w.label}`); assert.equal(r.tasks, w.runs, `${d} ${w.label} runs`); }
      const hand = (k) => SEED.filter((s) => ({ project: s[0], workflow: s[3], status: { done: 'Finished', error: 'Failed', stopped: 'Stopped' }[s[2]] })[d] === k).length;
      for (const w of want.filter((x) => x.kind === 'value')) assert.equal(w.runs, hand(w.label), `${d} ${w.label}: the hand count`);
    } else if (d === 'origin') {
      assert.deepEqual(src.rows.origin.map((r) => [r.name, cents(r.spend)]), [['Chat', cents(a.totals.ask.spendUsd)], ['Requirements', cents(a.totals.requirements.spendUsd)], ['Design', cents(a.totals.design.spendUsd)]]);
    } else assert.fail(`the live source offers ${d}, which this test does not assert`);
  }
  for (const d of Object.keys(map.DIM_OF)) assert.ok(seen.has(d), `the live source offers ${d}`);
  assert.equal(byPerson.groups.rows.find((r) => r.kind === 'value' && r.label === 'Jonas').runs, 4, 'Jonas started four runs in October');
  // buckets: each equals series[], and they add up to the totals
  a.series.forEach((s, i) => { eqUsd(src.series.spend[i], s.spentUsd, `bucket ${i}`); for (const k of ['finished', 'failed', 'stopped']) assert.equal(computeOf('ends', map.statsSource(a, { page: 'ends' })).F[k][i], s[k], `${k} ${i}`); });
  eqUsd(src.series.spend.reduce((x, y) => x + y, 0), a.totals.spentUsd, 'the spend buckets');
  assert.equal(src.series.tasks.reduce((x, y) => x + y, 0), a.totals.runs);
  assert.equal(map.statsSource(a, { page: 'shipped' }).series.prs.reduce((x, y) => x + y, 0), a.totals.prsMerged);
});

test('filters: one person, both people, and Maya with client:acme equal the server\'s filtered answers, rows and period before', async () => {
  const unfiltered = await get(RANGE + TAG_Q);
  const answers = async (people, tag = '') => Promise.all(people.map((p) => get(`${RANGE}&person=${encodeURIComponent(p)}${tag}`)));
  const cases = [[['Maya'], ['person:Maya'], ''], [['Maya', JONAS], ['person:Maya', 'person:Jonas'], ''], [['Maya'], ['person:Maya', 'client:acme'], '&tag=client:acme']];
  for (const [people, filter, tag] of cases) {
    const refs = await answers(people, tag), src = map.statsSource(unfiltered, { page: 'spend', filter, tagKeys: ['client', 'team', 'cost-center'] }), c = computeOf('spend', src, { filter });
    const sumOf = (k, prev = false) => refs.reduce((x, r) => x + (prev ? r.prev[k] : r.totals[k]), 0);
    for (const f of src.fields) { eqUsd(c.T[f], sumOf(TOTAL_FIELDS[f]), `${filter} ${f}`); eqUsd(c.P[f], sumOf(TOTAL_FIELDS[f], true), `${filter} prev ${f}`); }
    assert.equal(src.rows.origin, undefined, 'a filter drops Chat, Requirements and Design, as dev does');
    for (const d of Object.keys(src.rows)) {
      if (!map.DIM_OF[d] || d === 'origin') assert.fail(`${d} is not asserted`);
      const want = {};
      for (const r of refs) for (const w of allocate(r.report.runs, { by: map.DIM_OF[d] }).rows) { const x = (want[w.label] ||= { spend: 0, runs: 0 }); x.spend += w.spentUsd; x.runs += w.runs; }
      for (const [name, w] of Object.entries(want)) { const row = src.rows[d].find((r) => r.name === name); assert.ok(row, `${filter} ${d} ${name}`); eqUsd(row.spend, w.spend, `${filter} ${d} ${name}`); assert.equal(row.tasks, w.runs, `${filter} ${d} ${name} runs`); }
      assert.equal(src.rows[d].length, Object.keys(want).length, `${filter} ${d}: no more rows`);
    }
    const prevWant = refs.reduce((x, r) => x + allocate(r.report.prevRuns, { by: 'project' }).total.spentUsd, 0);
    eqUsd(c.P.spend, prevWant, `${filter}: allocate over prevRuns`);
  }
  const maya = computeOf('spend', map.statsSource(unfiltered, { page: 'spend', filter: ['person:Maya'] }), { filter: ['person:Maya'] });
  eqUsd(maya.T.spend, 100.75, 'Maya: 40 + 12.5 + 30 + 9.75 + 5 + 3.5');
  eqUsd(maya.P.spend, 20, 'Maya in September');
});

test('Shaping is shaping.groups as given; Budget\'s word holds GET /api/budget totalLimitUsd', async () => {
  const a = await get(RANGE);
  const sh = map.shapingSource(a);
  assert.deepEqual(sh.rows.size.map((r) => r.name), a.shaping.groups.map((g) => g.size));
  for (const g of a.shaping.groups) {
    const r = sh.rows.size.find((x) => x.name === g.size);
    assert.equal(r.runs, g.shaped.runs); assert.equal(r.uruns, g.unshaped.runs);
    if (g.shaped.runs) eqUsd(r.usd / r.runs, g.shaped.avgCostUsd, `${g.size} shaped average`);
  }
  assert.deepEqual(a.shaping.groups.map((g) => [g.size, g.shaped.runs]), [['small', 1], ['medium', 1]]);
  asserted.add('shaping');
  setTotalCostLimitUsd(500);
  const budget = await (await fetch(`${base}/api/budget`)).json();
  assert.equal(budget.totalLimitUsd, 500);
  const b = map.budgetOf(costsOf(budget, [], { now: Date.now() }), Date.now());
  const w = map.wordsOf('budget', map.statsSource(await get(RANGE), { page: 'budget' }), { budget: b, now: Date.now() });
  assert.match(w.word, /of \$500 used/);
  assert.match(map.wordsOf('spend', map.statsSource(await get(RANGE), { page: 'spend' }), { budget: b }).word, /of \$500$/);
});

// ---- team pages: dev's aggregate over makeRecord records ----
const NOW = Date.UTC(2026, 10, 14, 12);
const rec = (id, d, usd, actor, project, extra = {}) => ({ ...makeRecord({ id, startedAt: new Date(Date.UTC(2026, d[0], d[1], 10)).toISOString(), usd, actor, project, ...extra }), human: { hours: 1 } });
const RECORDS = [
  { ...rec('t1', [9, 3], 40, 'Maya', 'acme/billing-api'), tags: ['client:acme'] },
  { ...rec('t2', [9, 20], 25, 'Jonas', 'acme/web-app', { workflow: { id: 'wf_full', name: 'Full', version: 1 } }) },
  { ...rec('t3', [10, 2], 10, 'Maya', 'acme/web-app', { result: 'failed' }), tags: ['client:globex'] },
  { ...rec('t4', [10, 5], 7.5, 'Jonas', 'acme/billing-api') },
  { ...rec('t5', [1, 5], 100, 'Maya', 'acme/billing-api') },   // February: in the year, not the quarter
];
const RATE = 50;

test('team By person: totals and rows equal dev\'s aggregate (this quarter and this year); a person filter equals the filtered aggregate', () => {
  for (const [when, range, hand] of [['this quarter', 'quarter', 82.5], ['this year', 'year', 182.5]]) {
    const src = map.teamSource(RECORDS, { when, now: NOW, humanRateUsd: RATE, page: 'team' }), c = computeOf('team', src, { when });
    const agg = aggregate(RECORDS, { range, now: NOW, groupBy: 'actor', humanRateUsd: RATE });
    eqUsd(c.T.spend, agg.kpis.spendUsd, `${when} spend`); eqUsd(c.T.spend, hand, `${when}: by hand`);
    assert.equal(c.T.tasks, agg.kpis.runs); eqUsd(c.T.hours, agg.kpis.humanHours, 'hours'); eqUsd(c.T.saved, agg.kpis.savedUsd, 'saved');
    for (const b of agg.breakdowns.actor) { const r = src.rows.person.find((x) => x.name === b.label); eqUsd(r.spend, b.usd, `${when} ${b.label}`); assert.equal(r.tasks, b.runs); }
    const maya = map.teamSource(RECORDS, { when, now: NOW, humanRateUsd: RATE, filter: ['person:Maya'] });
    const fagg = aggregate(RECORDS, { range, now: NOW, groupBy: 'actor', humanRateUsd: RATE, filter: { actor: 'Maya' } });
    eqUsd(maya.totals.spend, fagg.kpis.spendUsd, `${when} Maya`); assert.equal(maya.totals.tasks, fagg.kpis.runs);
  }
  const pooled = map.pooledOf({ policy: { caps: { pooled: { value: 200, window: 'monthly' } } } }, RECORDS, NOW);
  const w = map.wordsOf('team', map.teamSource(RECORDS, { when: 'this month', now: NOW, page: 'team' }), { pooled, now: NOW });
  assert.match(w.word, /of \$200$/);
  assert.match(w.why, new RegExp(`pooled budget at ${Math.round((pooled.spent / 200) * 100)}%`));
  eqUsd(pooled.spent, 10 + 7.5, 'November records');
  asserted.add('team');
});

test('team Who spends where equals dev\'s heatGrid by project, workflow and client; Missing cost tags equals missingKeyTodos', () => {
  const facts = recordFacts(RECORDS, { range: 'quarter', now: NOW }).runs;
  for (const by of ['project', 'workflow', 'tag:client']) {
    const h = map.heatOf(RECORDS, { by, window: { when: 'this quarter' }, now: NOW });
    assert.deepEqual(h, heatGrid(facts, { by }), by);
  }
  const g = map.gridOf(map.heatOf(RECORDS, { by: 'project', window: { when: 'this quarter' }, now: NOW }));
  const at2 = (person, col) => g.cells[g.rows.findIndex((r) => r.label === person)][g.columns.findIndex((c) => c.label === col)];
  assert.deepEqual(at2('Maya', 'acme/billing-api'), { value: 40, runs: 1 });
  asserted.add('heat');
  const base0 = map.teamSource(RECORDS, { when: 'this quarter', now: NOW, page: 'team' });
  const un = map.untaggedSource(base0.facts, 'client', base0), todo = missingKeyTodos(facts, [{ key: 'client', required: true }]);
  assert.equal(un.totals.tasks, todo.rows.reduce((x, r) => x + r.runs, 0));
  eqUsd(un.totals.spend, todo.rows.reduce((x, r) => x + r.spentUsd, 0), 'untagged spend');
  assert.equal(un.totals.tasks, 2, 'by hand: t2 and t4 have no client');
  eqUsd(un.totals.spend, 32.5, 'by hand: 25 + 7.5');
  assert.equal(map.wordsOf('untagged', un, { key: 'client' }).word, '2 tasks without a client');
  asserted.add('untagged');
});

test('coverage: every FIGURE_SOURCE page id is asserted above', () => {
  assert.deepEqual([...asserted].sort(), Object.keys(map.FIGURE_SOURCE).sort());
});
