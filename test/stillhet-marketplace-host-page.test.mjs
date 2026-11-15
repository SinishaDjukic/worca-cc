// test/stillhet-marketplace-host-page.test.mjs — Stillhet's Marketplace drawn from dev's lists in the live kind (slice 8
// D3, D7, D13, D15, D18, D20): the shelves, the bar's counts, the Needs set-up word, the list states, the sort, View its
// source; and the demo kind, which sends nothing.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { marketplaceHost, MK_LISTS, PIN, settle, go, closeHosts } from './helpers/stillhet-marketplace-host.mjs';
import { liveHost, LISTS } from './helpers/stillhet-chat-live-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
const mk = (calls) => calls.filter((c) => /^\/api\/(plugins|marketplaces)/.test(c.url));
const text = (d) => d.querySelector('#route-place')?.textContent.replace(/\s+/g, ' ') || d.body.textContent.replace(/\s+/g, ' ');

test('#marketplace lists the fake API\'s plugins on the shelves; the head counts them; For you is empty (D20)', async () => {
  const { d } = await marketplaceHost();
  const cards = [...d.querySelectorAll('[data-mk-plugin]')].map((e) => e.dataset.mkPlugin).sort();
  assert.deepEqual(cards, ['jira-source', 'seed-ready', 'seed-setup', 'slack-chat', 'team-tool']);
  assert.match(text(d), /5 plugins · 2 installed · from 2 sources/);
  assert.ok(!d.querySelector('.pg-for'), 'no For you shelf live');
  assert.match(text(d), /Where plugins come from/);
  // the built-in market has no Remove; the team market has one; each market's URL is a link to GitHub (D14, D15)
  assert.ok(!d.querySelector('[data-mk-unsource="worca-official"]'));
  assert.ok(d.querySelector('[data-mk-unsource="team-plugins"]'));
  assert.deepEqual([...d.querySelectorAll('[data-mk-market]')].map((e) => e.dataset.mkMarket), ['worca-official', 'team-plugins']);
});

test('opened at #marketplace (a reload there): the lists load once the live layer is up, never stuck on Loading', async () => {
  const { d } = await liveHost({ hash: '#marketplace', lists: { ...LISTS, ...structuredClone(MK_LISTS) } });
  await settle(200);
  assert.doesNotMatch(text(d), /Loading plugins/);
  assert.equal(d.querySelectorAll('[data-mk-plugin]').length, 5);
});

test('the bar: Updates counts the plugins with latest; Installed the installed rows; Sources each market', async () => {
  const { d } = await marketplaceHost();
  const end = (key) => d.querySelector(`[data-row="way:${key}"] .lr-fig`)?.textContent.trim();
  const ups = MK_LISTS['/api/plugins'].plugins.filter((p) => p.latest).length;
  assert.equal(end('updates'), String(ups));
  assert.equal(end('installed'), '2');
  assert.equal(end('for-you'), '0');
  assert.equal(end('src-team-plugins'), '1');
});

test('#marketplace/seed-setup shows Needs set-up and offers Set it up', async () => {
  const { d } = await marketplaceHost({ hash: '#marketplace/seed-setup' });
  assert.match(text(d), /Needs set-up/);
  assert.equal(d.querySelector('[data-mk-step]')?.textContent.trim(), 'Set it up');
});

test('?state is ignored live; a failed GET /api/plugins shows the failed list state, and Try again reads it again', async () => {
  let fail = true;
  const { w, d, calls } = await marketplaceHost({ hash: '#marketplace', read: (u) => (u === '/api/plugins' && fail ? [500, { error: 'boom' }] : null) });
  assert.match(text(d), /Could not load the plugins/);
  const retry = d.querySelector('[data-mk-retry]');
  assert.ok(retry, 'Try again');
  fail = false;
  const n = calls.filter((c) => c.url === '/api/plugins').length;
  retry.click(); await settle(100);
  assert.ok(calls.filter((c) => c.url === '/api/plugins').length > n);
  assert.ok(d.querySelector('[data-mk-plugin="slack-chat"]'));
  await go(w, '#marketplace', 50);
});

test('RailPlaces.marketplace.has: true while loading, false for nope once ready', async () => {
  let release; const held = new Promise((r) => { release = r; });
  const { w } = await marketplaceHost({ hash: '#chat', hold: (u) => (u === '/api/plugins' ? held : null) });
  const place = w.RailPlaces.marketplace;
  place.records();   // asks for the lists
  assert.equal(place.has('nope'), true, 'a deep link waits for the lists');
  release(); await settle(100);
  assert.equal(place.has('nope'), false);
  assert.equal(place.has('slack-chat'), true);
  assert.equal(place.has('~src-team-plugins'), true);
});

test('the sort offers no "most used" live (dev has no usage figure) and starts on A–Z', async () => {
  const { d } = await marketplaceHost({ hash: '#marketplace/~all' });
  const picker = d.querySelector('[data-menu="mk-sort"]');
  assert.ok(picker);
  assert.match(picker.textContent, /A–Z/);
  picker.click(); await settle(20);
  const items = [...d.querySelectorAll('[data-menu-pick^="mk-sort|"]')].map((e) => e.textContent.trim());
  assert.ok(!items.some((t) => /most used/.test(t)), items.join());
  const order = [...d.querySelectorAll('[data-mk-plugin]')].map((e) => e.querySelector('.pg-t, h3, [class*="title"]')?.textContent.trim() || e.dataset.mkPlugin);
  assert.deepEqual(order, [...order].sort((a, b) => a.localeCompare(b)));
});

test('View its source opens the pinned commit on GitHub in a new tab', async () => {
  const web = `https://github.com/SinishaDjukic/worca-cc/tree/${PIN}/plugins/jira-source`;
  const { w, d } = await marketplaceHost({ hash: '#marketplace/jira-source', read: (u) => (u === '/api/plugins/jira-source' ? [200, { webUrl: web }] : null) });
  d.querySelector('[data-menu="mk-more"]').click(); await settle(10);
  d.querySelector('[data-menu-pick="mk-more|source"]').click(); await settle(60);
  assert.deepEqual(w.__opened, [[web, '_blank', 'noopener']]);
});

test('demo kind: Install sends nothing', async () => {
  const calls = [];
  const w = stillhetHost({ after, hash: '#chat', fetch: async (u, o = {}) => { calls.push([o.method || 'GET', String(u)]); return { ok: true, status: 200, json: async () => ({}) }; } });
  w.RailUI.prefs.setMode('expert'); await go(w, '#marketplace/slack-chat', 50);
  const d = w.document;
  d.querySelector('[data-mk-step]').click(); await settle(10);
  d.querySelector('[data-confirm="yes"]').click(); await settle(30);
  assert.deepEqual(calls.filter(([, u]) => /^\/api\/(plugins|marketplaces)/.test(u)), []);
  assert.match(d.body.textContent, /Installed slack-chat/);
});

test('demo kind: notion-mcp needs set-up; the built-in market has no Remove', async () => {
  const w = stillhetHost({ after, hash: '#chat' });
  w.RailUI.prefs.setMode('expert'); await go(w, '#marketplace/notion-mcp', 50);
  assert.match(w.document.body.textContent, /Needs set-up/);
  w.location.hash = '#marketplace'; await settle(50);
  assert.ok(!w.document.querySelector('[data-mk-unsource="official"]'));
  assert.equal(mk([]).length, 0);
});
