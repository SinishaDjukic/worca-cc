// Stillhet slice 10: Insights in the live kind, in the app host (D3, D8, D11, D12, D16–D18, D24; R-qa-4 to R-qa-6). The
// pages draw dev's figures through live/insights-live.mjs; the demo kind sends nothing. The host is
// test/helpers/stillhet-insights-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { insightsHost, insightsCalls, statsAnswer, RECORDS, settle, go, closeHosts } from './helpers/stillhet-insights-host.mjs';
import { saidText } from './helpers/stillhet-chat-live-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';
import { gate } from './helpers/stillhet-projects-host.mjs';
import { LIVE_PAGES, NOT_LIVE_PAGES, statsCsv } from '../ui/public/stillhet/live/insights-map.mjs';

afterEach(closeHosts);
const page = (d) => d.getElementById('route-place');
const text = (d) => page(d).textContent.replace(/\s+/g, ' ');
const barIds = (d) => [...d.querySelectorAll('[data-in-go]')].map((b) => b.dataset.inGo);
const pick = async (d, menu, v) => { page(d).querySelector(`[data-menu="${menu}"]`).click(); await settle(30); const b = page(d).querySelector(`[data-pick="${menu}|${v}"]`); assert.ok(b, `${menu}|${v} is offered`); b.click(); await settle(80); };

test('R-qa-4: with a budget and a tag key the bar lists the 13 live pages and none of the 6 not offered; fewer without', async () => {
  const h = await insightsHost();
  assert.deepEqual(barIds(h.d).sort(), [...LIVE_PAGES].sort());
  assert.ok(!barIds(h.d).some((id) => NOT_LIVE_PAGES.includes(id)));
  closeHosts();
  const noLimit = await insightsHost({ limit: null });
  assert.equal(barIds(noLimit.d).length, 12); assert.ok(!barIds(noLimit.d).includes('budget'));
  await go(noLimit.w, '#insights/budget', 150);
  assert.match(noLimit.d.body.textContent, /There is no view called budget/);
  closeHosts();
  const neither = await insightsHost({ limit: null, tagKeys: 0 });
  assert.equal(barIds(neither.d).length, 11); assert.ok(!barIds(neither.d).includes('untagged'));
  await go(neither.w, '#insights/cache', 150);
  assert.match(neither.d.body.textContent, /There is no view called cache/, 'a page dev has no figure for is not found (D12)');
});

test('R-qa-4: a held read shows the loading state; a 500 shows failed with dev\'s error, and Try again reads again', async () => {
  const g = gate();
  const h = await insightsHost({ hold: (u) => (u.startsWith('/api/stats?') ? g.p : null) });
  assert.match(text(h.d), /Loading/);
  g.open(); await settle(150);
  assert.match(text(h.d), /\$412 of \$100/);
  closeHosts();
  let fail = true;
  const f = await insightsHost({ read: (u) => (u.startsWith('/api/stats?') && fail ? [500, { error: 'the database is locked' }] : null) });
  assert.match(text(f.d), /Could not load Spend: the database is locked/);
  fail = false;
  const n = insightsCalls(f.calls).length;
  page(f.d).querySelector('[data-in-retry]').click(); await settle(200);
  assert.equal(insightsCalls(f.calls).length, n + 1);
  assert.match(text(f.d), /\$412 of \$100/);
});

test('D3: with no team sharing its numbers, By person says so; with two, "of" lists both under team and the second is read', async () => {
  const none = await insightsHost({ hash: '#insights/team', scopes: 0 });
  assert.match(text(none.d), /No project shares its team numbers yet/);
  closeHosts();
  const two = await insightsHost({ hash: '#insights/team', scopes: 2 });
  assert.match(text(two.d), /of the billing-api team/);
  page(two.d).querySelector('[data-menu="in-of"]').click(); await settle(40);
  const menu = page(two.d).textContent;
  assert.match(menu, /team/); assert.match(menu, /Shop/);
  page(two.d).querySelector('[data-pick="in-of|scope:workspace:wks-shop"]').click(); await settle(200);
  assert.ok(insightsCalls(two.calls).some((u) => u.startsWith('/api/team-metrics?scope=workspace%3Awks-shop&')));
  assert.match(text(two.d), /of the Shop team/);
});

test('Spend reads totals.spentUsd; ticking Maya sends nothing and draws her total; this quarter re-reads as custom', async () => {
  const h = await insightsHost();
  assert.match(text(h.d), /\$412 of \$100/);
  const n = h.calls.length;
  await pick(h.d, 'in-of', 'person:Maya');
  assert.equal(h.calls.length, n, 'the person filter re-cuts the answer it has (D2)');
  assert.match(text(h.d), /\$300 this month/);
  await pick(h.d, 'in-when', 'this quarter');
  assert.ok(insightsCalls(h.calls).at(-1).startsWith('/api/stats?range=custom&from=2026-10-01&to=2026-11-12'));
  assert.match(text(h.d), /\$600 this quarter/, 'Maya\'s figure in the quarter\'s own answer');
});

test('R-qa-5: a link opened cold draws loading, sends its one custom read, then its state; a from-to link sends that range', async () => {
  const g = gate();
  const h = await insightsHost({ hash: '#insights/spend?by=client&when=this%20quarter', hold: (u) => (u.includes('range=custom') ? g.p : null) });
  assert.match(text(h.d), /Loading/);
  g.open(); await settle(200);
  assert.deepEqual(insightsCalls(h.calls).filter((u) => u.startsWith('/api/stats')), ['/api/stats?range=custom&from=2026-10-01&to=2026-11-12&report=1&byTag=1&tagKey=client']);
  assert.match(text(h.d), /this quarter/);
  assert.match(text(h.d), /acme/); assert.match(text(h.d), /Unallocated/);
  closeHosts();
  const r = await insightsHost({ hash: '#insights/spend?from=2026-11-02&to=2026-11-03' });
  assert.ok(insightsCalls(r.calls).includes('/api/stats?range=custom&from=2026-11-02&to=2026-11-03&report=1&byTag=1&tagKey=client'));
  assert.match(text(r.d), /custom/, 'a from-to link opens as a custom stretch, its from and to pickers shown');
  await pick(r.d, 'in-when', 'this month'); await settle(150);
  assert.equal(insightsCalls(r.calls).filter((u) => u.startsWith('/api/stats')).at(-1), '/api/stats?range=month&report=1&byTag=1&tagKey=client', 'leaving custom reads the month again');
  assert.match(text(r.d), /\$412 of \$100/);
});

test('D17: a project row opens Tasks narrowed to it; a person row narrows Tasks to who started them', async () => {
  const h = await insightsHost();
  const got = []; h.w.RailRunsList.filter = (f) => got.push(JSON.parse(JSON.stringify(f)));
  page(h.d).querySelector('[data-in-row]').click();
  assert.deepEqual(got.at(-1), { project: 'billing-api' });
  await pick(h.d, 'in-by', 'person');
  [...page(h.d).querySelectorAll('[data-in-row]')].find((b) => /Jonas/.test(b.textContent)).click();
  assert.deepEqual(got.at(-1), { person: 'Jonas' });
});

// gate G F-G-fid-14: live Spend by project draws the prototype's stacked bars, with their legend and caption
test('F-G-fid-14: Spend by project on live stacks each day by project, with a legend and "Per day, by project"', async () => {
  const h = await insightsHost();
  const fig = page(h.d).querySelector('.bar-chart');
  assert.ok(fig, 'the bar chart');
  assert.ok(fig.querySelector('.bc-bar.is-stack .ch-seg'), 'stacked bars');
  const t = (e) => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  assert.match(t(fig.querySelector('.ch-legend')), /billing-api/);
  assert.match(t(fig.querySelector('.ch-cap')), /^Per day, by project/);
});

// F-G-fid-14: a live source with no day cut (By person, from the team's records) draws whole bars, no legend, and says so
test('F-G-fid-14: By person (no day cut on live) draws whole bars, no legend, and the caption says "all together"', async () => {
  const h = await insightsHost({ hash: '#insights/team' });
  const fig = page(h.d).querySelector('.bar-chart');
  assert.ok(fig, 'the bar chart');
  assert.equal(fig.querySelector('.ch-seg'), null, 'no parts');
  assert.equal(fig.querySelector('.ch-legend'), null, 'no empty legend');
  assert.match(fig.querySelector('.ch-cap').textContent, /^Per day, all together; by person in the rows below/);
});

// gate G (coordinator): a budget's daily pace is money: only a money chart draws it (look.chart-play), never How tasks end
test('F-G-fid-17: How tasks end (a count) draws no budget pace and no "you average $"; Spend still does', async () => {
  const ends = await insightsHost({ hash: '#insights/ends' });
  const fig = page(ends.d).querySelector('.bar-chart');
  assert.ok(fig, 'the bar chart');
  assert.equal(fig.querySelector('.bc-limit'), null, 'no pace line');
  assert.doesNotMatch(fig.textContent, /Budget pace|you average \$/);
  const spend = await insightsHost();
  assert.match(page(spend.d).querySelector('.bar-chart').textContent, /Budget pace/);
});

// F-FM2-04: a project keeps its shade when the view changes (look.chart-play): ticking Jonas reorders the parts, not the shades
test('F-FM2-04: a project keeps one shade across views', async () => {
  const h = await insightsHost();
  const shadeOf = (name) => { const k = [...page(h.d).querySelectorAll('.bar-chart .ch-key')].find((x) => x.textContent.trim() === name); return k && [...k.querySelector('.ch-swatch').classList].find((c) => /^is-s\d$/.test(c)); };
  const before = { billing: shadeOf('billing-api'), web: shadeOf('web-app') };
  assert.ok(before.billing && before.web, 'both in the legend');
  const pickIt = async (menu, v) => { page(h.d).querySelector(`[data-menu="${menu}"]`).click(); await settle(40); page(h.d).querySelector(`[data-pick="${menu}|${v}"]`).click(); await settle(200); };
  await pickIt('in-of', 'person:Jonas');
  assert.equal(shadeOf('web-app'), before.web, 'web-app keeps its shade though it is now the largest');
  assert.equal(shadeOf('billing-api'), before.billing);
});

// F-FM2-05: a bar's number never wraps at 360 ("2 / tasks")
test('F-FM2-05: a bar value is kept on one line', () => {
  const css = readFileSync(new URL('../ui/public/stillhet/css/rail.css', import.meta.url), 'utf8');
  assert.match(css, /\.bc-v\{[^}]*white-space:nowrap/);
});
