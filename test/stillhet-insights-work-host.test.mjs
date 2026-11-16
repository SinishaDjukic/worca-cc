// test/stillhet-insights-work-host.test.mjs — a person's timeline on Insights › By person (#1310), in the live app host:
// a person's row opens their work in place (list.row-opens-in-place), each task opens your task or a teammate's,
// read only (thing.read-only), and the PR marks open the pull request at its host (look.time-track).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { insightsHost, settle, go, closeHosts } from './helpers/stillhet-insights-host.mjs';
import { makeRecord } from './fixtures/team-metrics/records.mjs';

afterEach(closeHosts);
const DAY = 86_400_000, H = 3_600_000;
const T = (m, d, h = 10) => Date.UTC(2026, m, d, h);
const iso = (t) => new Date(t).toISOString();
const rec = (id, t, actor, o = {}) => makeRecord({ id, startedAt: iso(t), actor, title: o.title || `Task ${id}`, project: 'acme/billing-api', ...o });
const PR = (n, state, created, extra = {}) => [{ repo: 'acme/billing-api', number: n, url: `https://github.com/acme/billing-api/pull/${n}`, title: `PR ${n}`, state, createdAt: iso(created), mergedAt: null, closedAt: null, ...extra }];

// Maya: the mock's counts (7 merged, 1 open for review, 1 closed, 6 failed) this month, and two tasks in October;
// Sam: 102 tasks; Jonas: one
function world() {
  const records = [], prs = {};
  for (let i = 0; i < 7; i++) { const t = T(10, 1 + i); records.push(rec(`m${i + 1}`, t, 'Maya', { title: `Merged ${i + 1}` })); prs[`m${i + 1}`] = PR(1400 + i, 'MERGED', t + 2 * H, { mergedAt: iso(t + DAY) }); }
  records.push(rec('m8', T(10, 11), 'Maya', { title: 'Currency rounding in reports' })); prs.m8 = PR(1421, 'OPEN', T(10, 11, 12));
  records.push(rec('m9', T(10, 9), 'Maya', { title: 'Remove legacy coupon code' })); prs.m9 = PR(1396, 'CLOSED', T(10, 9, 12), { closedAt: iso(T(10, 10)) });
  for (let i = 0; i < 6; i++) records.push(rec(`m${10 + i}`, T(10, 3 + i, 14), 'Maya', { title: `Failed ${i + 1}`, result: 'failed' }));
  records.push(rec('o1', T(9, 10), 'Maya', { title: 'October one' }), rec('o2', T(9, 12), 'Maya', { title: 'October two' }));
  for (let i = 0; i < 102; i++) records.push(rec(`s${i + 1}`, T(10, 2) + i * 2 * H, 'Sam', { title: `Sam ${i + 1}` }));
  records.push(rec('j1', T(10, 5), 'Jonas', { title: 'Jonas one' }));
  return { records, prs };
}
const W = world();
const host = (o = {}) => insightsHost({ hash: '#insights/team', records: W.records, prs: W.prs, ...o });
const page = (d) => d.getElementById('route-place');
const row = (d, name) => page(d).querySelector(`[data-in-person="${name}"]`);
const detail = (d) => page(d).querySelector('.fr-detail');
const open = async (d, name) => { row(d, name).click(); await settle(120); };
const pick = async (d, menu, v) => { page(d).querySelector(`[data-menu="${menu}"]`).click(); await settle(30); page(d).querySelector(`[data-pick="${menu}|${v}"]`).click(); await settle(200); };
const headText = (d) => detail(d).querySelector('.fr-d-t').textContent.replace(/\s+/g, ' ');
const esc = (w, el) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

test('1: a click on Maya\'s row opens one detail under it: head, 6 tasks, legend, Show 9 more, in tab order', async () => {
  const { d } = await host();
  assert.equal(row(d, 'Maya').getAttribute('aria-expanded'), 'false');
  await open(d, 'Maya');
  const r = row(d, 'Maya');
  assert.equal(r.getAttribute('aria-expanded'), 'true'); assert.match(r.className, /is-open/);
  assert.equal(page(d).querySelectorAll('.fr-detail').length, 1);
  assert.equal(r.nextElementSibling, detail(d)); assert.equal(r.getAttribute('aria-controls'), detail(d).id);
  assert.equal(headText(d).trim(), "Maya's work, this month · newest first · 7 merged, 1 open for review, 1 closed, 6 failed");
  assert.equal(detail(d).querySelector('.fr-d-head [data-fr-hide]').textContent, 'Hide');
  assert.equal(detail(d).querySelectorAll('.tt-row').length, 6);
  assert.deepEqual([...detail(d).querySelectorAll('.tt-legend .ch-key')].map((k) => k.textContent), ['Agent working, first run to last', 'Waiting for review', 'Merged', 'Open', 'Closed']);
  assert.equal(detail(d).querySelector('[data-in-more]').textContent, 'Show 9 more');
  const order = [r, ...detail(d).querySelectorAll('button, a[href]')].map((e) => (e === r ? 'row' : e.matches('[data-fr-hide]') ? 'hide' : e.matches('.tt-open') ? `open:${e.closest('.tt-row').dataset.ttRow}` : e.matches('.tt-end') ? `mark:${e.closest('.tt-row').dataset.ttRow}` : e.matches('[data-in-more]') ? 'more' : 'other'));
  assert.deepEqual(order.slice(0, 2), ['row', 'hide']); assert.equal(order.at(-1), 'more'); assert.ok(!order.includes('other'));
  order.forEach((o, i) => { if (o.startsWith('mark:')) assert.equal(order[i - 1], `open:${o.slice(5)}`, 'a mark follows its own task'); });
});

test('2: Hide and Esc close the detail and focus the row; with a mark\'s card showing the first Esc only hides the card', async () => {
  const { w, d } = await host();
  await open(d, 'Maya');
  detail(d).querySelector('[data-fr-hide]').click(); await settle(60);
  assert.equal(detail(d), null); assert.equal(d.activeElement, row(d, 'Maya')); assert.equal(row(d, 'Maya').getAttribute('aria-expanded'), 'false');
  await open(d, 'Maya');
  const mark = detail(d).querySelector('.tt-end'); mark.focus();
  esc(w, mark); await settle(20);
  assert.ok(detail(d), 'the first Esc keeps the detail'); assert.ok(mark.closest('.tt-lane').hasAttribute('data-card-off'));
  esc(w, mark); await settle(60);
  assert.equal(detail(d), null); assert.equal(d.activeElement, row(d, 'Maya'));
  await open(d, 'Maya');
  esc(w, detail(d).querySelector('.tt-open')); await settle(60);
  assert.equal(detail(d), null); assert.equal(d.activeElement, row(d, 'Maya'));
});

test('3: opening a second row closes the first; "by" away from person shows no detail', async () => {
  const { d } = await host();
  await open(d, 'Maya'); await open(d, 'Jonas');
  assert.equal(page(d).querySelectorAll('.fr-detail').length, 1);
  assert.equal(row(d, 'Maya').getAttribute('aria-expanded'), 'false'); assert.equal(row(d, 'Jonas').getAttribute('aria-expanded'), 'true');
  await pick(d, 'in-by', 'project');
  assert.equal(page(d).querySelector('.fr-detail'), null);
  await pick(d, 'in-by', 'person');
  assert.equal(page(d).querySelector('.fr-detail'), null, 'it closed when by left person');
});

test('4: a range change and a narrowed range keep Maya open; the axis shows the page\'s days', async () => {
  const { d } = await host();
  await open(d, 'Maya');
  await pick(d, 'in-when', 'last month');
  assert.ok(detail(d)); assert.match(headText(d), /Maya's work, last month/);
  assert.equal(detail(d).querySelector('.tt-tick').textContent, 'Oct 1');
  await pick(d, 'in-when', 'this month');
  await pick(d, 'in-when', 'custom');
  await pick(d, 'in-from', '2');
  assert.ok(detail(d), 'the narrowed range keeps the row open');
  assert.equal(detail(d).querySelector('.tt-tick').textContent, 'Nov 3');
});

test('5: Sam\'s 102 tasks show Show 96 more; it shows all, goes away and focuses the first revealed task', async () => {
  const { d } = await host();
  await open(d, 'Sam');
  const more = detail(d).querySelector('[data-in-more]');
  assert.equal(more.textContent, 'Show 96 more');
  more.click(); await settle(80);
  assert.equal(detail(d).querySelectorAll('.tt-row').length, 102);
  assert.equal(detail(d).querySelector('[data-in-more]'), null);
  assert.equal(d.activeElement, detail(d).querySelectorAll('.tt-open')[6]);
});

test('6: a teammate\'s task opens read only at #insights/team?task=RUNID; Back returns with Maya open and focused', async () => {
  const { w, d } = await host();
  await open(d, 'Maya');
  const first = detail(d).querySelector('.tt-open');
  const id = first.dataset.inWork;
  first.click(); await settle(200);
  assert.equal(w.location.hash, `#insights/team?task=${id}`);
  assert.ok(page(d).querySelector('.task-view')); assert.equal(page(d).querySelector('.fr-list'), null);
  assert.match(page(d).querySelector('.tv-back').textContent, /By person › Maya/);
  assert.equal(page(d).querySelectorAll('.task-view button').length, 1, 'no action: only the back link');
  page(d).querySelector('[data-in-back]').click(); await settle(200);
  assert.equal(w.location.hash, '#insights/team');
  assert.ok(detail(d)); assert.equal(d.activeElement, row(d, 'Maya'));
  closeHosts();
  let release; const held = new Promise((r) => { release = r; });
  const h2 = await host({ hash: `#insights/team?task=m9`, hold: (u) => (u.startsWith('/api/team-metrics?') ? held : null) });
  assert.match(page(h2.d).textContent, /Loading/);
  release(); await settle(250);
  assert.match(page(h2.d).querySelector('.tv-title').textContent, /Remove legacy coupon code/);
  assert.equal(page(h2.d).querySelector('.rc-word').textContent, 'Closed');
  assert.equal(page(h2.d).querySelectorAll('table.rt tbody tr').length, 1);
  // the shell's tasks reword leaves a task view's Runs figure and table alone (they are its runs)
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../ui/public/stillhet/shell/shell.js', import.meta.url), 'utf8');
  assert.match(src.match(/const SKIP = '([^']*)'/)[1], /(^|, )\.task-view(,|$)/, 'text nodes inside .task-view are skipped');
  assert.match(src, /!e\.closest\(SKIP_ATTR\)/, 'title and aria-label inside .task-view are skipped too');
});

test('7: your own task opens #run/ID; with its local run deleted it opens read only', async () => {
  let localId = '';   // a run this Worca knows, known once the host is up; the team records are read after
  const h = await insightsHost({ hash: '#chat', records: () => W.records.map((r) => (r.id === 'm9' ? { ...r, id: localId } : r)), prs: W.prs });
  localId = h.w.RailWorld.data().runs[0].id;
  await go(h.w, '#insights/team', 250);
  await open(h.d, 'Maya');
  const mine = detail(h.d).querySelector(`[data-in-work="${localId}"]`);
  assert.ok(mine, 'the local run is one of Maya\'s tasks'); assert.equal(mine.dataset.inOwn, localId);
  mine.click(); await settle(100);
  assert.equal(h.w.location.hash, `#run/${localId}`);
  h.w.RailWorld.find = () => undefined;   // the run was deleted here; its record still syncs
  await go(h.w, '#insights/team', 200);
  if (!detail(h.d)) await open(h.d, 'Maya');
  detail(h.d).querySelector(`[data-in-work="${localId}"]`).click(); await settle(150);
  assert.equal(h.w.location.hash, `#insights/team?task=${localId}`);
});

test('8: a PR mark links to the PR in a new tab, and names its card', async () => {
  const { d } = await host();
  await open(d, 'Maya');
  const mark = detail(d).querySelector('a.tt-end');
  assert.match(mark.getAttribute('href'), /^https:\/\/github\.com\/acme\/billing-api\/pull\/\d+$/);
  assert.equal(mark.getAttribute('target'), '_blank'); assert.equal(mark.getAttribute('rel'), 'noopener noreferrer');
  const card = d.getElementById(mark.getAttribute('aria-describedby'));
  assert.ok(card && card.matches('.tline-card.is-track')); assert.match(card.textContent, /opens the pull request/);
});

test('9: a held PR lookup draws the tasks without marks and says it is looking', async () => {
  const { d } = await host({ hold: (u) => (u === '/api/team-metrics/prs' ? new Promise(() => {}) : null) });
  await open(d, 'Maya');
  assert.match(headText(d), / · looking up pull requests/);
  assert.equal(detail(d).querySelectorAll('.tt-end').length, 0); assert.equal(detail(d).querySelectorAll('.tt-row').length, 6);
});

test('10: a failed lookup says why and offers Try again, which sends 1 POST; nothing else is written', async () => {
  const { d, calls } = await host({ prs: 500 });
  await open(d, 'Maya');
  assert.match(headText(d), / · pull requests could not be read: gh is not signed in/);
  assert.equal(detail(d).querySelectorAll('.tt-row').length, 6);
  const n = calls.filter((c) => c.method === 'POST').length;
  detail(d).querySelector('[data-in-work-retry]').click(); await settle(150);
  assert.equal(calls.filter((c) => c.method === 'POST').length, n + 1);
  detail(d).querySelector('[data-fr-hide]').click(); await settle(60);
  await open(d, 'Sam'); detail(d).querySelector('[data-in-more]').click(); await settle(60);
  assert.deepEqual(calls.filter((c) => ['PUT', 'PATCH', 'DELETE'].includes(c.method)), [], 'I3: no write');
  assert.deepEqual([...new Set(calls.filter((c) => c.method === 'POST').map((c) => c.url))], ['/api/team-metrics/prs'], 'I3: the only POST is the lookup');
});

test('11: an unknown answer says the states are not known here and draws no marks', async () => {
  const { d } = await host({ prs: 'unknown' });
  await open(d, 'Maya');
  assert.match(headText(d), / · pull request states are not known here/);
  assert.equal(detail(d).querySelectorAll('.tt-end').length, 0);
});

test('12: no work in the range says so with no legend; records still reading show the loading line', async () => {
  const { w, d } = await host();
  const real = w.RailInsightsLive.work;
  w.RailInsightsLive.work = () => ({ state: 'ready', items: [], counts: { merged: 0, review: 0, closed: 0, failed: 0, stopped: 0, done: 0 }, axis: null, pr: { state: 'ready', why: '' } });
  await open(d, 'Maya');
  assert.equal(headText(d).trim(), "Maya's work, this month");
  assert.match(detail(d).textContent, /No tasks in this month/);
  assert.equal(detail(d).querySelector('.tt-legend'), null); assert.equal(detail(d).querySelector('[data-in-more]'), null);
  w.RailInsightsLive.work = () => ({ state: 'loading', items: [], counts: {}, axis: null, pr: { state: 'pending', why: '' } });
  w.RailPlaces.insights.redraw(); await settle(30);
  assert.match(detail(d).textContent, /Loading Maya's work…/);
  w.RailInsightsLive.work = real;
});

test('13: a task no record holds says it is gone, with Back to By person', async () => {
  const { w, d } = await host({ hash: '#insights/team?task=nope' });
  assert.match(page(d).textContent, /This task is no longer in the team's records/);
  page(d).querySelector('[data-in-back]').click(); await settle(200);
  assert.equal(w.location.hash, '#insights/team'); assert.ok(row(d, 'Maya'));
});

test('14: #team-metrics/timeline lands on By person, whose rows open in place', async () => {
  const { w, d } = await host({ hash: '#team-metrics/timeline' });
  assert.equal(w.location.hash, '#insights/team');
  assert.match(page(d).textContent, /By person/);
  assert.equal(row(d, 'Maya').getAttribute('aria-expanded'), 'false');
});
