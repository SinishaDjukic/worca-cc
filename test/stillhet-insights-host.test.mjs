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

test('R-qa-5: Copy a link writes the page as narrowed and says so; a refused clipboard says why; nothing is sent', async () => {
  const h = await insightsHost();
  let clip = '';
  Object.defineProperty(h.w.navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { clip = t; return Promise.resolve(); } } });
  await pick(h.d, 'in-by', 'client');
  const n = h.calls.length;
  page(h.d).querySelector('[data-menu="in-more"]').click(); await settle(30);
  page(h.d).querySelector('[data-menu-pick="in-more|link"]').click(); await settle(60);
  assert.match(clip, /#insights\/spend\?by=client$/);
  assert.match(saidText(h.d), /Copied a link to Spend/);
  assert.equal(h.calls.length, n);
  Object.defineProperty(h.w.navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
  page(h.d).querySelector('[data-menu="in-more"]').click(); await settle(30);
  page(h.d).querySelector('[data-menu-pick="in-more|link"]').click(); await settle(60);
  assert.match(saidText(h.d), /Could not copy the link: your browser did not allow it/);
});

test('D24: Download CSV is dev\'s Cost report CSV for the page; Tag these N tasks hands over N untagged', async () => {
  const h = await insightsHost();
  let blob = null; h.w.URL.createObjectURL = (b) => { blob = b; return 'blob:x'; }; h.w.URL.revokeObjectURL = () => {};
  await pick(h.d, 'in-by', 'client');
  page(h.d).querySelector('[data-in-csv]').click(); await settle(30);
  const got = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blob.arrayBuffer());
  assert.equal(got, statsCsv(statsAnswer(1), { by: 'client', page: 'spend', byLabel: 'client (cost tag)' }));
  const handed = []; h.w.RailConversation.handOver = (x) => handed.push(x);
  const tag = page(h.d).querySelector('[data-in-tag]');
  assert.equal(tag.textContent.trim(), 'Tag these 2 tasks');
  tag.click();
  assert.match(handed[0].ph, /the 2 tasks without a client/);
});

test('Set a default for a project: live, it opens the top untagged project\'s tags from the page as drawn and sends no read', async () => {
  for (const [hash, by] of [['#insights/untagged', ''], ['#insights/spend', 'client']]) {
    const h = await insightsHost({ hash });
    if (by) await pick(h.d, 'in-by', by);
    const edited = [];
    h.w.RailProjects.all = () => [{ id: 'p-web', name: 'web-app' }, { id: 'p-acme-web', name: 'acme/web-app' }, { id: 'p-bill', name: 'billing-api' }];
    h.w.RailProjects.editTags = (id) => edited.push(id);
    const n = insightsCalls(h.calls).length, before = text(h.d);
    for (let i = 0; i < 2; i += 1) { page(h.d).querySelector('[data-in-default]').click(); await settle(150); }
    assert.equal(edited.length, 2, `${hash}: every click opens a project's tags`);
    assert.equal(edited[0], edited[1]);
    if (!by) assert.match(edited[0], /web/, 'Missing cost tags: web-app has both untagged tasks');
    assert.equal(insightsCalls(h.calls).length, n, `${hash}: nothing is read again`);
    assert.equal(text(h.d), before, `${hash}: the page stays as drawn`);
    closeHosts();
  }
});

test('Download CSV on a live team page goes through dev\'s CSV writer: a teammate named =1+1 is no formula', async () => {
  const records = [{ ...RECORDS[0], actor: '=1+1' }, ...RECORDS.slice(1)];
  const h = await insightsHost({ hash: '#insights/team', read: (u) => (u.startsWith('/api/team-metrics?') ? [200, { scope: {}, records, humanRateUsd: 0, aggregate: null }] : null) });
  let blob = null; h.w.URL.createObjectURL = (b) => { blob = b; return 'blob:x'; }; h.w.URL.revokeObjectURL = () => {};
  page(h.d).querySelector('[data-in-csv]').click(); await settle(30);
  const got = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blob.arrayBuffer());
  assert.match(got, /^\uFEFF/);
  assert.match(got, /(^|\r\n)'=1\+1,/);
  assert.doesNotMatch(got, /(^|\r\n)"?=1\+1/);
});

test('R-arch-1: the live pages call no RailWould and insights.js holds none; saved views are kept in this browser', async () => {
  assert.doesNotMatch(readFileSync('ui/public/stillhet/insights/insights.js', 'utf8'), /RailWould\(/);
  const h = await insightsHost();
  const would = []; h.w.RailWould = (t) => { would.push(t); return t; };
  page(h.d).querySelector('[data-in-save]').click(); await settle(60);
  assert.match(saidText(h.d), /Saved Spend by project, this month to Your views/);
  assert.equal(JSON.parse(h.w.localStorage.getItem('worca-rail.insights-views')).length, 1);
  for (const id of LIVE_PAGES) { await go(h.w, `#insights/${id}`, 80); }
  assert.deepEqual(would, []);
  assert.ok(h.calls.every((c) => c.method === 'GET'), 'Invariant 4: Insights writes nothing');
});

test('R-qa-6: in the demo kind every Insights page sends no request', async () => {
  const calls = [];
  const w = stillhetHost({ hash: '#insights/spend', fetch: async (u) => { calls.push(String(u)); return { ok: false, status: 404, json: async () => ({}) }; }, after: () => {}, beforeScripts: (win) => win.localStorage.setItem('worca-rail.mode', 'expert') });
  await settle(60);
  const before = calls.length;
  for (const s of w.RailInsightsModel.SUBS) { w.location.hash = `#insights/${s.id}`; await settle(20); }
  assert.deepEqual(calls.slice(before), []);
  assert.match(w.document.getElementById('route-place').textContent, /Missing cost tags|Who spends where/);
  // I4 (#1310): a person's row and a teammate's task open in the demo with no request either
  w.location.hash = '#insights/team'; await settle(40);
  const place = w.document.getElementById('route-place');
  place.querySelector('[data-in-person="Maya"]').click(); await settle(30);
  assert.match(place.querySelector('.fr-detail .fr-d-t').textContent, /^Maya's work, this month · newest first/);
  assert.equal(place.querySelector('.fr-detail .tt-title').textContent, 'Retry failed webhook deliveries');
  place.querySelector('.fr-detail [data-in-work]').click(); await settle(40);
  assert.match(w.location.hash, /^#insights\/team\?task=demo-maya-1$/);
  assert.match(place.querySelector('.tv-title').textContent, /Retry failed webhook deliveries/);
  assert.deepEqual(calls.slice(before), []);
  w.close();
});
