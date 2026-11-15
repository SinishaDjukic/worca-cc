// test/stillhet-tasks-center-week-host.test.mjs — B3.6 (#1360): the Tasks center's week figures, one line per task on a
// card, short button labels. F-3-10: live, the head's week count and cost are GET /api/stats?range=week's totals (or the
// chosen project's allocation row), never a row sum; demo, each run counts once by its own date and cost. F-3-16: a card's
// tasks each get their own line. V-TW-01 / V3-01: two waiting tasks name themselves in short. jsdom app host.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES } from './helpers/stillhet-chat-live-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';
import { TASK_DETAILS, PR_URL } from './helpers/stillhet-live-fixture.mjs';

afterEach(closeHosts);
const WEEK_URL = '/api/stats?range=week&report=1';
const LIVE_TIP = 'Opens this week\'s tasks in the list. The figure counts every run Worca recorded this week, so the two can differ';
const fact = (id, project, usd) => ({ id, person: 'Maya', project, workflow: 'Default', status: 'finished', pr: null, tags: {}, usd, hours: 1, inCohort: true, startedMs: 1, hourBucket: 0, spend: [[0, usd]] });
const WEEK = { bucket: 'day', windowStartMs: 0, windowEndMs: 1, humanRateUsd: 0, prev: null, series: [],
  totals: { spentUsd: 6321.75, pipelineSpendUsd: 2551.75, humanHours: 0, savedUsd: 0, runs: 49, finished: 49, failed: 0, stopped: 0, prsMerged: 0, prsOpened: 0 },
  report: { buckets: [0], runs: [fact('x1', 'api', 10), fact('x2', 'api', 2.4), fact('x3', 'api', 0), fact('x4', 'ops', 7)], prevRuns: null } };
const facts = (d) => { if (!d.querySelector('#route-runs .figs-line')) d.querySelector('#route-runs [data-c-figs="tasks"]').click(); return d.querySelector('#route-runs .figs-line')?.textContent || ''; };
const sources = () => { const s = clone(SOURCES); for (const p of s.history.pipelines) p.projectKey = 'web-1'; return s; };

test('F-3-10 live: the head equals GET /api/stats?range=week runs (49 tasks this week · $2,551.75 this week, F-fm-02: chat spend left out, thousands separated) while the list holds more rows', async () => {
  const { w, d, calls } = await liveHost({ sources: sources(), read: (u) => (u === WEEK_URL ? [200, WEEK] : null) });
  await go(w, '#runs', 200);
  assert.equal(facts(d), '49 tasks this week · $2,551.75 this week');
  assert.notEqual(w.RailRunsList.rows().length, 49, 'the list itself holds another number of rows');
  assert.equal(calls.filter((c) => c.url === WEEK_URL).length, 1, 'one read');
  const n = d.querySelector('#route-runs .figs-line [data-c-filter]');
  assert.deepEqual(JSON.parse(n.dataset.cFilter), { range: { from: 1102, to: 1108, label: 'this week' } }, 'the count opens this week\'s tasks');
  assert.equal(n.title, LIVE_TIP, 'B3.6 review: live, the link says what it opens, since the list can hold fewer than the count');
});

test('B3.6 review: a chosen project\'s week count opens that project\'s week, not every project', async () => {
  const { w, d } = await liveHost({ sources: sources(), read: (u) => (u === WEEK_URL ? [200, WEEK] : null) });
  await go(w, '#runs', 200);
  w.RailRunsList.filter({ project: 'api' }); await go(w, '#runs', 60);
  facts(d);
  for (const n of d.querySelectorAll('#route-runs .figs-line [data-c-filter]')) assert.deepEqual(JSON.parse(n.dataset.cFilter), { range: { from: 1102, to: 1108, label: 'this week' }, project: 'api' });
});

test('B3.6 review: a failed week read is read again when Tasks is opened again', async () => {
  let status = 500;
  const { w, d, calls } = await liveHost({ sources: sources(), read: (u) => (u === WEEK_URL ? [status, status === 200 ? WEEK : { error: 'boom' }] : null) });
  await go(w, '#runs', 200);
  assert.equal(facts(d), '', 'failed: no figures');
  status = 200;
  await go(w, '#chat', 60); await go(w, '#runs', 200);
  assert.equal(calls.filter((c) => c.url === WEEK_URL).length, 2, 'the visit re-reads the failed week');
  assert.equal(facts(d), '49 tasks this week · $2,551.75 this week');
});

test('B3.6 review: an Insights read landing redraws the Projects center once', async () => {
  const { w } = await liveHost({ sources: sources(), read: (u) => (u === WEEK_URL ? [200, WEEK] : null) });
  await go(w, '#runs', 200);
  let n = 0; const p = w.RailPlaces.projects, was = p.redraw; p.redraw = (...a) => { n += 1; return was.apply(p, a); };
  w.RailInsightsLive.frame({ type: 'pipelines-changed' }); await settle(450);
  p.redraw = was;
  assert.equal(n, 1, `one redraw per landed read, not ${n}`);
});

test('F-3-10 live: while /api/stats is pending (hold) or 500, the head shows no week figures and no row sum; when it lands the center repaints with them', async () => {
  let open; const gate = new Promise((r) => { open = r; });
  const { w, d } = await liveHost({ sources: sources(), hold: (u) => (u === WEEK_URL ? gate : null), read: (u) => (u === WEEK_URL ? [200, WEEK] : null) });
  await go(w, '#runs', 200);
  assert.equal(facts(d), '', 'pending: no figures');
  assert.doesNotMatch(d.querySelector('#route-runs').textContent, /tasks? this week|\$\d/);
  open(); await settle(80);
  assert.equal(facts(d), '49 tasks this week · $2,551.75 this week', 'the landed read repaints the center');
  const bad = await liveHost({ sources: sources(), read: (u) => (u === WEEK_URL ? [500, { error: 'boom' }] : null) });
  await go(bad.w, '#runs', 200);
  assert.equal(facts(bad.d), '', 'failed: no figures');
  assert.match(bad.d.querySelector('#route-runs').textContent, /Your tasks/);
});

test('F-3-10 live: a chosen project reads its own allocation row', async () => {
  const { w, d } = await liveHost({ sources: sources(), read: (u) => (u === WEEK_URL ? [200, WEEK] : null) });
  await go(w, '#runs', 200);
  w.RailRunsList.filter({ project: 'api' }); await go(w, '#runs', 60);
  assert.equal(facts(d), '3 tasks this week · $12.40 this week');
  w.RailRunsList.filter({ project: 'web' }); await go(w, '#runs', 60);
  assert.ok(w.RailRunsList.rows().some((t) => t.project === 'web'), 'web has tasks in the list');
  assert.equal(facts(d), '0 tasks this week', 'no allocation row this week: 0, and no cost');
});

test('F-3-10 live: a pipelines-changed frame re-reads the week and the head follows', async () => {
  let answer = WEEK;
  const { w, d, calls, sockets } = await liveHost({ sources: sources(), read: (u) => (u === WEEK_URL ? [200, answer] : null) });
  await go(w, '#runs', 200);
  assert.equal(facts(d), '49 tasks this week · $2,551.75 this week');
  answer = { ...WEEK, totals: { ...WEEK.totals, runs: 50, spentUsd: 6330, pipelineSpendUsd: 2560 } };
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'pipelines-changed' }) });
  await settle(450);
  assert.equal(calls.filter((c) => c.url === WEEK_URL).length, 2);
  assert.equal(facts(d), '50 tasks this week · $2,560.00 this week');
});

test('F-3-10 demo: a group counts each member once, by its own date and cost (no group × inWeek)', async () => {
  const w = stillhetHost({ hash: '#chat' });
  const W = w.RailWorld, L = () => w.RailRunsList;
  await settle();
  const g = W.data().groups.find((x) => W.membersOf(x).length);
  assert.ok(g, 'the seed has a group');
  W.data().runs.push({ id: 'old-1', case: 'merged', title: 'Last month', project: g.project, detail: 'Merged', time: 'Oct 20', day: 'older', labels: [], cost: 100, archived: false, group: g.id, pos: 99, kind: 'Git', by: 'Emil Angelov', workflow: 'Default' });
  W.touch();
  const inWeek = (t) => { const k = L().dateOf(t); return k >= 1102 && k <= 1108; };
  const perRun = (rows) => rows.flatMap((t) => (t.group ? W.membersOf(t.group).map((m) => ({ run: m, day: m.day })) : [t])).filter(inWeek);
  const costOf = (runs) => runs.reduce((a, t) => a + (t.run.cost || 0), 0);
  const runs = perRun(L().rows()), cost = costOf(runs);
  const old = L().rows().filter(inWeek).reduce((a, t) => a + (t.run ? t.run.cost || 0 : W.membersOf(t.group).reduce((x, m) => x + (m.cost || 0), 0)), 0);
  assert.notEqual(cost, old, 'the seeded member is outside the week: the old group sum counted it');
  await go(w, '#runs', 120);
  assert.equal(facts(w.document), `${runs.length} task${runs.length === 1 ? '' : 's'} this week · $${cost.toFixed(2)} this week`);
  // the group's project card says the same per-run sum (g.cost)
  const mine = costOf(perRun(L().rows().filter((t) => (t.project || 'No project') === (g.project || 'No project'))));
  const tips = [...w.document.querySelectorAll('#route-runs [title*="this week"]')].map((e) => e.title).join('\n');
  assert.ok(tips.includes(`$${mine.toFixed(2)} this week`), `${mine} in ${tips}`);
  w.close();
});

// two approved PRs in one project, each with a long title
function readySources(titles) {
  const s = sources(), h2 = s.history.pipelines.find((p) => p.id === 'h2');
  h2.pr = { url: PR_URL, state: 'OPEN' }; h2.title = titles[0];
  s.history.pipelines.push({ ...h2, id: 'h7', title: titles[1], pr: { url: `${PR_URL}0`, state: 'OPEN' } });
  return s;
}
const checksRead = (u) => { if (u === WEEK_URL) return [200, WEEK]; return /^\/api\/pr\/checks\?id=(h2|h7)/.test(u) ? [200, TASK_DETAILS.approved.checks] : null; };
const readyCard = (d) => [...d.querySelectorAll('#route-runs .pg-card, #route-runs [class*="card"]')].find((c) => c.querySelectorAll('[data-c-act^="merge|"]').length === 2);

test('F-3-16: a Ready card with two approved tasks draws one line per task, no \';\'', async () => {
  const { w, d } = await liveHost({ sources: readySources(['Add pager', 'Fix flaky login']), read: checksRead });
  await go(w, '#runs', 900);
  const card = readyCard(d);
  assert.ok(card, 'one card holds both approved tasks');
  const what = card.querySelector('.pg-w');
  assert.equal(what.querySelectorAll('br').length, 1, 'one break between the two tasks');
  assert.doesNotMatch(what.textContent, /;/);
  assert.match(what.innerHTML, /Add pager[\s\S]*<br>[\s\S]*Fix flaky login|Fix flaky login[\s\S]*<br>[\s\S]*Add pager/);
});

test('V-TW-01 / V3-01: two waiting live tasks with long titles get buttons at most verb + 25 characters; the full title stays in the tooltip; demo short names unchanged', async () => {
  const long = ['Add pager to the audit log page so long lists stay fast', 'Supercalifragilisticexpialidocious'];
  const { w, d } = await liveHost({ sources: readySources(long), read: checksRead });
  await go(w, '#runs', 900);
  const btns = [...readyCard(d).querySelectorAll('[data-c-act^="merge|"]')];
  const byId = Object.fromEntries(btns.map((b) => [b.dataset.cAct.split('|')[1], b]));
  assert.equal(byId.h2.textContent.trim(), 'Merge Add pager to the audit…');
  assert.equal(byId.h2.title, `Merge: ${long[0]}`);
  assert.equal(byId.h7.textContent.trim(), 'Merge Supercalifragilisticexp…', 'one long word: 23 characters and …');
  assert.equal(byId.h7.title, `Merge: ${long[1]}`);
  for (const b of btns) assert.ok(b.textContent.trim().length <= 'Merge '.length + 25, b.textContent);
  // the demo's own short names win (its seed rows r2 and r9, shell/world.js), through the same actionsOf
  const seed = [{ id: 'r2', case: 'gate', title: 'Migrate cron parser', short: 'cron parser' }, { id: 'r9', case: 'approved', title: 'Add pager to the audit log', short: 'audit pager' }];
  const box = d.createElement('div'); box.innerHTML = w.RailCenters.actionsOf(seed);
  const demo = [...box.querySelectorAll('[data-c-act]')];
  assert.deepEqual(demo.map((b) => b.textContent.trim().split(' ').slice(-2).join(' ')), ['cron parser', 'audit pager']);
  assert.deepEqual(demo.map((b) => b.title.split(': ')[1]), ['Migrate cron parser', 'Add pager to the audit log']);
});
