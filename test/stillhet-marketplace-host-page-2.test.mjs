// test/stillhet-marketplace-host-page-2.test.mjs — second half of stillhet-marketplace-host-page (split to stay under CI's 300 s per file):
// the set-up form's disabled rows and the fresh-install first sync. Live app host (jsdom).
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { marketplaceHost, MK_LISTS, PIN, settle, go, closeHosts } from './helpers/stillhet-marketplace-host.mjs';
import { liveHost, LISTS } from './helpers/stillhet-chat-live-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
const mk = (calls) => calls.filter((c) => /^\/api\/(plugins|marketplaces)/.test(c.url));
const text = (d) => d.querySelector('#route-place')?.textContent.replace(/\s+/g, ' ') || d.body.textContent.replace(/\s+/g, ' ');


// a fresh install (#1298): dev seeds the builtin with lastSync: null and no plugins, and never syncs it
const FRESH = (edit = (m) => m) => { const l = structuredClone(MK_LISTS); l['/api/marketplaces'].marketplaces = l['/api/marketplaces'].marketplaces.filter((m) => m.builtin).map((m) => edit({ ...m, lastSync: null, plugins: [] })); l['/api/plugins'] = { plugins: [], orphans: [] }; return l; };
const REFRESH = '/api/marketplaces/worca-official/refresh';

test('fresh install: Loading the catalogue… while the first sync is held, and the source\'s Sync reads Syncing…', async () => {
  let release; const held = new Promise((r) => { release = r; });
  const draws = [];
  const { w, d, calls } = await marketplaceHost({ lists: FRESH(), hold: (u) => (u === REFRESH ? held : null), beforeScripts: (win) => {
    new win.MutationObserver(() => { const t = win.document.getElementById('route-place')?.textContent || ''; if (t) draws.push(t); }).observe(win.document, { subtree: true, childList: true, characterData: true });
  } });
  assert.match(text(d), /Loading the catalogue…/);
  assert.equal(d.querySelector('[data-mk-sync="worca-official"]')?.textContent.trim(), 'Syncing…');
  assert.equal(d.querySelector('[data-mk-sync="worca-official"]').disabled, true);
  await go(w, '#marketplace/~all', 60);
  assert.match(text(d), /Loading the catalogue…/, 'a side view loads too');
  assert.ok(draws.length > 0, 'the draws were recorded');
  assert.ok(draws.every((t) => !/No plugins yet|Nothing here yet/.test(t)), 'no draw before the sync answers reads empty');
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url === REFRESH).length, 1, 'one first sync');
  release(); await settle(100);
  assert.match(text(d), /No plugins yet/, 'once it answers, the empty catalogue says so');
});

test('fresh install, sync gives 0 plugins: No plugins yet with Sync on Home and on ~all; Sync posts the builtin\'s refresh', async () => {
  const { w, d, calls } = await marketplaceHost({ lists: FRESH() });
  const sent = () => calls.filter((c) => c.method === 'POST' && c.url === REFRESH).length;
  assert.equal(sent(), 1, 'the first sync went once');
  const empty = () => [...d.querySelectorAll('#route-place .empty-line')].find((e) => /No plugins yet/.test(e.textContent));
  assert.ok(empty(), 'Home: No plugins yet');
  assert.match(empty().textContent, /Sync fetches the catalogue from Worca CC Official\./);
  assert.ok(empty().querySelector('[data-mk-sync="worca-official"]'), 'with its Sync');
  assert.doesNotMatch(text(d), /Nothing here yet/);
  await go(w, '#marketplace/~all', 60);
  assert.ok(empty()?.querySelector('[data-mk-sync="worca-official"]'), '~all: No plugins yet with Sync');
  assert.ok(empty().querySelector('[data-mk-goto="~all"]'), 'and All plugins, where today\'s line has it');
  empty().querySelector('[data-mk-sync]').click(); await settle(100);
  assert.equal(sent(), 2, 'Sync posts the builtin\'s refresh');
  closeHosts();
  // a failed sync names its first line, cut to 120 characters; no markets at all: add one, no Sync
  const why = `fatal: could not read from remote ${'x'.repeat(200)}\nsecond line`;
  const failed = await marketplaceHost({ lists: FRESH((m) => ({ ...m, lastError: { message: why, at: '2026-11-15T10:00:00.000Z' } })) });
  const line = [...failed.d.querySelectorAll('#route-place .empty-line')].find((e) => /No plugins yet/.test(e.textContent));
  assert.ok(line.textContent.includes(`The last sync of Worca CC Official failed: ${why.split('\n')[0].slice(0, 120)}`));
  assert.ok(!line.textContent.includes('second line') && !line.textContent.includes('x'.repeat(130)));
  closeHosts();
  const none = structuredClone(FRESH()); none['/api/marketplaces'].marketplaces = [];
  const bare = await marketplaceHost({ lists: none });
  const l2 = [...bare.d.querySelectorAll('#route-place .empty-line')].find((e) => /No plugins yet/.test(e.textContent));
  assert.match(l2.textContent, /Add a source to see plugins\./);
  assert.equal(l2.querySelector('[data-mk-sync]'), null, 'no Sync without a source');
});

test('while the set-up form is open, the rows\' Set up buttons are disabled and say why (gate.controls: no dead control)', async () => {
  const w = stillhetHost({ after, hash: '#chat' });
  w.RailUI.prefs.setMode('expert'); await go(w, '#marketplace/jira-source', 50);
  const d = w.document;
  const rows = () => [...d.querySelectorAll('[data-mk-setup]')];
  assert.equal(rows().length, 2);
  assert.ok(rows().every((b) => !b.disabled), 'each acts while no form is open');
  rows()[0].click(); await settle(20);
  assert.ok(d.querySelector('form[data-form="setup"]'), 'the form opened');
  for (const b of rows()) { assert.equal(b.disabled, true); assert.match(b.closest('[title]')?.title || '', /set-up form above is open/); }
  d.querySelector('[data-confirm="no"]').click(); await settle(20);
  assert.ok(rows().every((b) => !b.disabled), 'back once the form closes');
});

test('F-G-G5-05: the side chat on a list names the list, not a plugin; a plugin\'s page names the plugin', async () => {
  const { w, d } = await marketplaceHost();
  await go(w, '#marketplace', 60);
  d.getElementById('topnav-ask').click(); await settle(60);
  const side = () => d.getElementById('ask-side')?.textContent.replace(/\s+/g, ' ') || '';
  assert.match(side(), /List · Marketplace/, 'the chip names the list');
  assert.match(side(), /Worca sees this list\./);
  assert.doesNotMatch(side(), /Plugin · Marketplace|this plugin|What would Marketplace add/);
  assert.equal(w.RailShell.pageContext().kind, 'list');
  await go(w, '#marketplace/~all', 60);
  assert.equal(w.RailShell.pageContext().kind, 'list', 'a side view is the list too');
  await go(w, '#marketplace/jira-source', 60);
  assert.equal(w.RailShell.pageContext().kind, 'plugin', 'a plugin\'s own page is the plugin');
  // same cause as F-7a-08: the Projects list is no project
  await go(w, '#projects', 60);
  assert.deepEqual([w.RailShell.pageContext().kind, w.RailShell.pageContext().name, w.RailShell.pageContext().project], ['list', 'Projects', '']);
});
