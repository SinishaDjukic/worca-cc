// Slice 10 (R-arch-4, D7, D13–D16, Invariant 1 and 8): Insights' model. The demo path is pinned against the checkpoint's
// own output (test/fixtures/stillhet-insights-demo-golden.json, captured once from the unchanged model and never
// regenerated); the design-first parts and the link have their own cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const window = {};
vm.runInNewContext(readFileSync('ui/public/stillhet/insights/insights-model.js', 'utf8'), { window });
const M = window.RailInsightsModel;
const GOLDEN = JSON.parse(readFileSync('test/fixtures/stillhet-insights-demo-golden.json', 'utf8'));
const plain = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const eq = (a, b, m) => assert.deepEqual(plain(a), plain(b), m);
const rowPin = (r, fields) => ({ name: r.name, ...Object.fromEntries(fields.map((f) => [f, r[f]])), ...(r.kids ? { kids: r.kids.map((k) => rowPin(k, fields)) } : {}) });
const pin = (sub, st) => { const c = M.compute(sub, st), f = sub.src.fields; return plain({ T: c.T, P: c.P, v: c.v, p: c.p, labels: c.labels, days: c.days, points: c.points, before: c.before, timeWord: c.timeWord, rowCount: c.rowCount, rows: c.rows.map((r) => rowPin(r, f)) }); };

test('Invariant 1: the 17 checkpoint pages at their default state, and Spend by client then workflow last month, equal the golden', () => {
  assert.equal(Object.keys(GOLDEN.pages).length, 17);
  for (const id of Object.keys(GOLDEN.pages)) {
    const sub = M.SUB[id];
    assert.ok(sub, id);
    eq(plain(M.defaults(sub)), GOLDEN.defaults[id], `${id}: defaults`);
    eq(pin(sub, M.defaults(sub)), GOLDEN.pages[id], id);
  }
  eq(pin(M.SUB.spend, { ...M.defaults(M.SUB.spend), by: 'client', then: 'workflow', when: 'last month' }), GOLDEN.extra['spend-client-workflow-last-month']);
});

test('D15: the person filter: person rows come last in money, ends and prs; Maya ticked is Maya\'s own rows', () => {
  assert.ok(M.FILTERS.includes('person'));
  const money = M.SUB.spend.src;
  assert.equal(Object.keys(money.rows).at(-1), 'person');
  assert.equal(M.dimsOf(money, M.defaults(M.SUB.spend)).filter((d) => !M.TIME.has(d) && d !== 'hour').includes('person'), true);
  eq(money.rows.person.map((r) => r.name), ['Maya', 'Jonas', 'Priya', 'Lee']);
  const maya = money.rows.person.find((r) => r.name === 'Maya');
  const c = M.compute(M.SUB.spend, { ...M.defaults(M.SUB.spend), filter: ['person:Maya'] });
  assert.equal(c.T.spend, maya.spend);
  assert.equal(c.T.saved, maya.saved);
  for (const id of ['ends', 'shipped']) assert.equal(Object.keys(M.SUB[id].src.rows).at(-1), 'person', id);
  for (const [id, f] of [['spend', 'spend'], ['ends', 'finished'], ['shipped', 'prs']]) assert.equal(M.sum(M.SUB[id].src.rows.person.map((r) => r[f])), M.sum(M.SUB[id].src.rows.project.map((r) => r[f])), `${id}: the people add up to the projects`);
});

test('D7: this quarter is the October weeks and Nov 1-8; this year is five months with no year before', () => {
  eq(M.WHEN, ['today', 'this week', 'this month', 'last month', 'this quarter', 'this year', 'all time']);
  const q = M.compute(M.SUB.spend, { ...M.defaults(M.SUB.spend), when: 'this quarter', by: 'day' });
  assert.equal(q.labels.length, 6); assert.equal(q.labels.at(-1), 'Nov 1-8');
  assert.ok(q.P, 'a quarter has a period before');
  const y = M.compute(M.SUB.spend, { ...M.defaults(M.SUB.spend), when: 'this year', by: 'day' });
  assert.equal(y.labels.length, 5); assert.equal(y.P, null);
});

test('D16: linkOf writes only what differs from the defaults', () => {
  const st = { ...M.defaults(M.SUB.spend), by: 'client', then: 'workflow' };
  assert.equal(M.linkOf('spend', st), 'insights/spend?by=client&then=workflow');
  assert.equal(M.linkOf('spend', M.defaults(M.SUB.spend)), 'insights/spend');
  assert.equal(M.linkOf('spend', { ...M.defaults(M.SUB.spend), when: 'this quarter' }), 'insights/spend?when=this%20quarter');
  assert.equal(M.linkOf('spend', { ...M.defaults(M.SUB.spend), narrow: [2, 4], custom: true }), 'insights/spend?from=2026-11-03&to=2026-11-05');
});

test('Invariant 8: stateOfLink round-trips every key, drops what is unknown or impossible, clamps a day past the labels', () => {
  const sub = M.SUB.spend;
  const q = 'by=client&then=workflow&when=last%20month&of=client%3Aacme,person%3AMaya&as=table&vs=before&from=2026-10-08&to=2026-10-21';
  const st = M.stateOfLink(q, sub);
  assert.equal(st.by, 'client'); assert.equal(st.then, 'workflow'); assert.equal(st.when, 'last month');
  eq(st.filter, ['client:acme', 'person:Maya']); assert.equal(st.as, 'table'); assert.equal(st.against, 'before');
  eq(st.narrow, [1, 2]);
  assert.equal(M.linkOf('spend', st), `insights/spend?${q}`);
  assert.equal(M.stateOfLink('by=bogus', sub).by, 'project');
  assert.equal(M.stateOfLink('when=fortnight&as=pie&vs=moon&zap=1', sub).when, 'this month');
  eq(M.stateOfLink('from=2026-13-40&to=2026-11-03', sub).narrow, [0, 2]);
  assert.equal(M.stateOfLink('from=2026-11-05&to=2026-11-03', sub).narrow, null);
  eq(M.stateOfLink('from=2026-11-04&to=2027-01-01', sub).narrow, [3, 7]);
  assert.doesNotThrow(() => M.stateOfLink('%E0%A4%A&by', sub));
  const live = M.stateOfLink('from=2026-10-02&to=2026-10-09&when=this%20quarter', sub, { live: true });
  assert.equal(live.from, '2026-10-02'); assert.equal(live.to, '2026-10-09'); assert.equal(live.narrow, null); assert.equal(live.custom, true);
  assert.equal(M.linkOf('spend', live), 'insights/spend?when=this%20quarter&from=2026-10-02&to=2026-10-09');
  // ledger row 3: a team picked in the of sentence stays out of the link (classic's carries none); an old link's is still
  // read, and an unknown demo team is dropped
  const team = { ...M.defaults(M.SUB.team), scope: 'workspace:web-shop' };
  assert.equal(M.linkOf('team', team), 'insights/team');
  assert.equal(M.stateOfLink('scope=workspace%3Aweb-shop', M.SUB.team).scope, 'workspace:web-shop');
  assert.equal(M.stateOfLink('scope=workspace%3Anope', M.SUB.team).scope, M.defaults(M.SUB.team).scope);
  assert.equal(M.stateOfLink('scope=workspace%3Awks-x', M.SUB.team, { live: true }).scope, 'workspace:wks-x');
  assert.equal(M.linkOf('spend', { ...M.defaults(M.SUB.spend), scope: 'workspace:web-shop' }), 'insights/spend', 'only a team page has a team');
});

test('D13, D14, D15: Shaping has 3 sizes; Who spends where has 5 people; the demo team source has 2 scopes', () => {
  const sh = M.SUB.shaping;
  assert.equal(sh.group, 'Cost');
  eq(sh.src.rows.size.map((r) => r.name), ['small', 'medium', 'large']);
  eq(M.dimsOf(sh.src, M.defaults(sh)), ['size']);
  assert.equal(M.defaults(sh).by, 'size');
  const heat = M.SUB.heat;
  assert.equal(heat.team, true);
  for (const by of ['project', 'workflow', 'client']) { assert.equal(heat.src.heat[by].rows.length, 5, by); assert.equal(heat.src.heat[by].cells.length, 5, by); }
  eq(M.dimsOf(heat.src, M.defaults(heat)).filter((d) => !M.TIME.has(d)), ['project', 'workflow', 'client']);
  assert.equal(M.SUB.team.src.scopes.length, 2);
});

test('D9: a live source is taken as given: no re-cut, no seeded periods', () => {
  const src = { live: true, fields: ['spend', 'hours', 'saved', 'tasks'], labels: ['Oct 1', 'Oct 2'], days: ['2026-10-01', '2026-10-02'], last: ['2026-10-01', '2026-10-02'], dayCount: 2,
    series: { spend: [1.25, 2.5], hours: [1, 0], saved: [10, 0], tasks: [1, 1] }, before: null, totals: { spend: 3.75, hours: 1, saved: 10, tasks: 2 }, prev: { spend: 1.5, hours: 0, saved: 0, tasks: 1 },
    rows: { project: [{ name: 'a', spend: 1.25, hours: 1, saved: 10, tasks: 1, share: '33%' }, { name: 'b', spend: 2.5, hours: 0, saved: 0, tasks: 1, share: '67%' }] }, kids: { a: [{ name: 'x', spend: 1.25, hours: 1, saved: 10, tasks: 1, share: '33%' }] } };
  const sub = { ...M.SUB.spend, src };
  const c = M.compute(sub, { ...M.defaults(sub), then: 'person' });
  eq(c.T, src.totals); eq(c.P, src.prev);
  eq(c.points, [1.25, 2.5]); assert.equal(c.days, 2);
  eq(c.rows.map((r) => [r.name, r.spend]), [['b', 2.5], ['a', 1.25]]);
  eq(c.rows[1].kids.map((k) => k.name), ['x']);
  assert.equal(c.v, 3.75); assert.equal(c.p, 1.5);
});

// ---- a person's work on By person (#1310, D13) ----
test('workOf: Maya\'s first six are the mock\'s, her counts add up to her row\'s tasks, and it is deterministic', async () => {
  const c = M.compute(M.SUB.team, M.defaults(M.SUB.team)), maya = c.rows.find((r) => r.name === 'Maya');
  const w = M.workOf('Maya', c.labels);
  eq(w.items.slice(0, 6).map((i) => [i.title, i.project, i.prNumber, i.word]), [
    ['Retry failed webhook deliveries', 'billing-api', 1418, 'Merged'], ['Currency rounding in reports', 'billing-api', 1421, 'Open for review'],
    ['Tax ID validation', 'web-app', null, 'Failed'], ['CSV export: totals row', 'invoices', 1402, 'Merged'],
    ['Remove legacy coupon code', 'billing-api', 1396, 'Closed'], ['Stripe event dedupe', 'billing-api', 1391, 'Merged']]);
  assert.equal(w.items.length, maya.tasks);
  assert.equal(Object.values(w.counts).reduce((a, b) => a + b, 0), maya.tasks);
  assert.ok(w.items.every((i) => i.work[0] >= w.axis.start && i.work[1] <= w.axis.end && i.prUrl === '' && !i.own));
  eq(M.workOf('Maya', c.labels), w);
  assert.equal(M.workTask(w.items[3].runId, c.labels).title, 'CSV export: totals row');
  assert.equal(M.workTask('nope', c.labels), null);
  // the page's range (review cycle 1, issue 1): as many as the row's tasks for THAT range, all inside its axis
  for (const when of ['today', 'this week', 'last month']) {
    const r = M.compute(M.SUB.team, { ...M.defaults(M.SUB.team), when }), row = r.rows.find((x) => x.name === 'Maya'), wr = M.workOf('Maya', r.labels, row.tasks);
    assert.equal(wr.items.length, row.tasks, when);
    assert.equal(Object.values(wr.counts).reduce((a, b) => a + b, 0), row.tasks, when);
    assert.ok(wr.items.every((i) => i.work[0] >= wr.axis.start && i.work[1] <= wr.axis.end && (!i.end || i.end.at <= wr.axis.end)), when);
  }
  const today = M.compute(M.SUB.team, { ...M.defaults(M.SUB.team), when: 'today' });
  assert.equal(M.workTask('demo-maya-16', today.labels, today.rows).actor, 'Maya');
  assert.equal(M.workTask('demo-maya-17', today.labels, today.rows), null);
  // the demo's words are the live map's (live/work-map.mjs)
  const L = await import('../ui/public/stillhet/live/work-map.mjs');
  eq(M.cardOf(w.items[0]), L.cardOf(w.items[0]));
  assert.equal(M.cardOf(w.items[0]).line, '#1418 merged Nov 8, 11:00 · 1d 1h from first run · opens the pull request');
  for (const it of w.items.slice(0, 12)) { eq(M.taskViewOf(it), L.taskViewOf(it)); assert.equal(it.word, L.WORDS[it.state]); }
  for (const pr of [{ state: 'ready' }, { state: 'pending' }, { state: 'failed', why: 'x' }, { state: 'unknown' }]) eq(M.workHead('Maya', 'this month', w.counts, pr), L.workHead('Maya', 'this month', w.counts, pr));
});

test('F-G-G4-05: Hours saved shows whole hours, never a live figure\'s decimals', () => {
  const hours = M.SUB.spend.cols.find(([n]) => n === 'Hours saved')[1];
  assert.equal(hours({ hours: 18224.66 }), '18225 h');
  assert.equal(hours({ hours: 12 }), '12 h');
});
