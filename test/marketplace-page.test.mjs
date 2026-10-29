// test/marketplace-page.test.mjs — the Marketplace page controller (marketplace P3, CONTRACT §3.5, §4, §5).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { OFF, ROWS, pageHarness } from './helpers/marketplace-fixtures.mjs';
import { tabFromParam, tabHash, targetFromParam, updatesChip } from '../ui/public/marketplace/page.mjs';
import { createSheet } from '../ui/public/marketplace/layers.mjs';

const trackDom = useDomRelease(afterEach);
const tick = () => new Promise((r) => setTimeout(r, 0));
function specs(page, doc, log = []) {
  page.registerTab('browse', { count: (s) => s.catalog.length, render: (s, el) => { log.push('browse'); el.textContent = String(s.catalog.length); },
    header: (s, el) => { el.textContent = 'browse head'; } });
  page.registerTab('installed', { count: (s) => s.plugins.length, chip: (s) => updatesChip(doc, s.plugins.filter((p) => p.latest).length),
    render: (s, el) => { el.textContent = 'installed'; }, header: (s, el) => { el.textContent = 'installed head'; } });
  page.registerTab('marketplaces', { count: (s) => s.marketplaces.length, render: (s, el) => { el.textContent = 'mkts'; } });
  return log;
}

test('tabFromParam / tabHash / updatesChip', () => {
  const { doc } = pageHarness({ trackDom });
  assert.deepEqual(['', 'browse', 'installed', 'marketplaces', 'installed/github-source', 'x'].map(tabFromParam),
    ['browse', 'browse', 'installed', 'marketplaces', 'installed', 'browse']);
  assert.deepEqual(['browse', 'installed', 'marketplaces'].map(tabHash), ['#marketplace', '#marketplace/installed', '#marketplace/marketplaces']);
  assert.deepEqual([updatesChip(doc, 0), updatesChip(doc, 1).outerHTML, updatesChip(doc, 2).textContent],
    [null, '<span class="badge mk-chip mk-chip-upd mk-upd-chip">1 update</span>', '2 updates']);
});

test('the shell: tab links in order, one header-actions slot, a busy panel per tab', () => {
  const { doc } = pageHarness({ trackDom });
  const nav = doc.querySelector('#mk-root > .mk-head > nav.tabs.mk-tabs');
  assert.equal(nav.getAttribute('aria-label'), 'Marketplace sections');
  assert.deepEqual([...nav.querySelectorAll('a.tab.mk-tab')].map((a) => [a.dataset.tab, a.getAttribute('href'), a.firstChild.textContent, a.querySelector('.mk-count').hidden]),
    [['browse', '#marketplace', 'Browse', true], ['installed', '#marketplace/installed', 'Installed', true], ['marketplaces', '#marketplace/marketplaces', 'Marketplaces', true]]);
  assert.ok(doc.querySelector('#mk-root > .mk-head > .mk-head-actions'));
  assert.deepEqual([...doc.querySelectorAll('#mk-root > .mk-panel')].map((p) => [p.dataset.tab, p.hidden, p.getAttribute('aria-busy')]),
    [['browse', false, 'true'], ['installed', true, 'true'], ['marketplaces', true, 'true']]);
});

test('load: three reads, then counts, the updates chip, every panel and the header; no refresh unless asked', async () => {
  const { doc, page, calls, msgs } = pageHarness({ trackDom });
  specs(page, doc);
  await page.load();
  assert.deepEqual([calls, msgs], [['GET /api/plugins', 'GET /api/marketplaces', 'GET /api/chat/status'], [['', null]]]);
  assert.deepEqual([...doc.querySelectorAll('.mk-tab .mk-count')].map((c) => [c.textContent, c.hidden]), [['4', false], ['1', false], ['2', false]]);
  assert.equal(doc.querySelector('.mk-tab[data-tab="installed"] .mk-upd-chip').textContent, '1 update');
  assert.deepEqual([page.state.loaded, page.state.catalog.length, page.state.channelStatus, page.state.policy], [true, 4, [], { requirements: [] }], 'SM35');
  assert.deepEqual([...doc.querySelectorAll('.mk-panel')].map((p) => [p.textContent, p.getAttribute('aria-busy')]), [['4', null], ['installed', null], ['mkts', null]]);
  assert.equal(doc.querySelector('.mk-head-actions').textContent, 'browse head');
});

test('load({refresh}): one POST /api/marketplaces/refresh at a time; its answer replaces the marketplaces', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const fresh = { ...OFF, lastSync: { ...OFF.lastSync, at: '2026-10-20T12:00:00.000Z' } };
  const { doc, page, calls } = pageHarness({ trackDom, routes: { 'POST /api/marketplaces/refresh': async () => { await gate; return { ok: true, status: 200, data: { ok: true, marketplaces: [fresh] } }; } } });
  specs(page, doc);
  const seen = []; page.onChange((s) => seen.push(s.marketplaces.length));
  await page.load({ refresh: true });
  assert.equal(page.state.refreshing, true);
  await page.load({ refresh: true });
  assert.equal(calls.filter((c) => c === 'POST /api/marketplaces/refresh').length, 1);
  release(); await tick(); await tick();
  assert.deepEqual([page.state.refreshing, page.state.marketplaces, page.state.catalog.length, seen], [false, [fresh], 3, [2, 2, 1]], 'the refresh answer reaches onChange');
});

test('overlapping loads coalesce: three calls, two reads', async () => {
  const { page, calls } = pageHarness({ trackDom });
  await Promise.all([page.load(), page.load(), page.load()]);
  assert.equal(calls.filter((c) => c === 'GET /api/plugins').length, 2);
});

test('setTab: one tab lit (.on + aria-current), its panel shown, its header painted; an unknown tab is Browse', async () => {
  const { doc, page } = pageHarness({ trackDom }); specs(page, doc); await page.load();
  page.setTab('installed');
  assert.deepEqual([...doc.querySelectorAll('.mk-tab')].map((a) => [a.dataset.tab, a.classList.contains('on'), a.getAttribute('aria-current')]),
    [['browse', false, null], ['installed', true, 'page'], ['marketplaces', false, null]]);
  assert.deepEqual([...doc.querySelectorAll('.mk-panel')].map((p) => p.hidden), [true, false, true]);
  assert.deepEqual([doc.querySelector('.mk-head-actions').dataset.tab, doc.querySelector('.mk-head-actions').textContent], ['installed', 'installed head']);
  page.setTab('marketplaces');
  assert.equal(doc.querySelector('.mk-head-actions').textContent, '', 'a tab without a header empties the slot');
  page.setTab('nope');
  assert.equal(page.state.tab, 'browse');
});

test('setTab keeps the address in step (SM63): it routes only when the address names another tab, and never refetches', async () => {
  const { doc, page, navs, calls } = pageHarness({ trackDom, url: 'http://localhost:4319/#marketplace/x' }); specs(page, doc); await page.load();
  const n = calls.length;
  page.setTab('browse');
  assert.deepEqual(navs, [], '#marketplace/x already is Browse: the address stays as typed');
  page.setTab('installed'); page.setTab('installed');
  assert.deepEqual([navs, calls.length - n], [['#marketplace/installed'], 0]);
});

test('a tab click selects its tab through setTab and routes', async () => {
  const { doc, page, navs } = pageHarness({ trackDom }); specs(page, doc); await page.load();
  page.setTab('installed');
  doc.querySelector('.mk-tab[data-tab="browse"]').click();
  assert.deepEqual([page.state.tab, navs.at(-1)], ['browse', '#marketplace']);
});

test('nothing is lit before the first setTab (a page never entered marks no aria-current)', () => {
  const { doc } = pageHarness({ trackDom });
  assert.equal(doc.querySelector('#mk-root [aria-current]'), null);
});

test('missing lists default to [] (an app harness answers unknown URLs with another shape)', async () => {
  const { page, msgs } = pageHarness({ trackDom, routes: { 'GET /api/plugins': () => ({ ok: true, status: 200, data: { config: {} } }),
    'GET /api/marketplaces': () => ({ ok: true, status: 200, data: {} }), 'GET /api/chat/status': () => ({ ok: true, status: 200, data: {} }) } });
  await page.load();
  assert.deepEqual([page.state.plugins, page.state.orphans, page.state.marketplaces, page.state.channelStatus, page.state.catalog, msgs], [[], [], [], [], [], [['', null]]]);
});

test('provide (a later provider replaces an earlier one, SM16) / act / onChange', async () => {
  const { page } = pageHarness({ trackDom });
  page.provide('openPlugin', () => 'fallback');
  page.provide('openPlugin', (t) => `opened ${t.name}`);
  assert.equal(page.act('openPlugin', { name: 'x' }), 'opened x');
  assert.throws(() => page.act('openManage', 'x'), /no provider for openManage/);
  const seen = []; const off = page.onChange((s) => seen.push(s.marketplaces.length));
  await page.load(); off(); await page.load();
  assert.deepEqual(seen, [2]);
});

test('a background render waits while a sheet is open and lands when it closes; an explicit load renders at once', async () => {
  const { doc, window, page } = pageHarness({ trackDom });
  const log = specs(page, doc);
  await page.load();
  const sheet = createSheet({ doc, win: window }); sheet.open(doc.body);
  await page.load({ background: true });
  assert.equal(log.length, 1, 'data in, no redraw under the sheet');
  sheet.close();
  assert.equal(log.length, 2, 'the pending render lands on close');
  sheet.open(doc.body); await page.load();
  assert.equal(log.length, 3, 'an explicit load renders at once, under the sheet');
  sheet.close();
  assert.equal(log.length, 3, 'nothing is pending at close');
});

test('a failed read keeps the last lists and says why on #plugins-msg (err-inline)', async () => {
  let fail = false;
  const { page, msgs, calls } = pageHarness({ trackDom, routes: { 'GET /api/plugins': () => (fail
    ? { ok: false, status: 500, data: { error: 'store unreadable' } } : { ok: true, status: 200, data: { plugins: ROWS, orphans: [] } }) } });
  await page.load(); fail = true; await page.load({ refresh: true });
  assert.deepEqual([msgs.at(-1), page.state.plugins, calls.includes('POST /api/marketplaces/refresh')], [['store unreadable', 'err-inline'], ROWS, false], 'no refresh after a failed read');
});

test('a held render waits for the LAST open layer; the plugin modal\'s own mk-layer-closed flushes it (m-P3-2)', async () => {
  const { doc, window, page } = pageHarness({ trackDom });
  const log = specs(page, doc);
  await page.load();
  const modal = doc.createElement('div'); modal.className = 'viewer-modal'; doc.body.append(modal);   // an open #plugin-modal
  const sheet = createSheet({ doc, win: window }); sheet.open(doc.body);
  await page.load({ background: true });
  sheet.close();
  assert.equal(log.length, 1, 'the sheet closed; the modal is still open');
  modal.classList.add('hidden'); doc.dispatchEvent(new window.CustomEvent('mk-layer-closed', { detail: { layer: 'plugin-modal' } }));
  assert.equal(log.length, 2);
});

test('a coalesced load refreshes if any caller asked and renders at once unless every caller was background; a background load keeps #plugins-msg', async () => {
  const { doc, window, page, calls, msgs } = pageHarness({ trackDom });
  const log = specs(page, doc);
  await Promise.all([page.load(), page.load(), page.load({ refresh: true })]); await tick();
  assert.equal(calls.filter((c) => c === 'POST /api/marketplaces/refresh').length, 1);
  const sheet = createSheet({ doc, win: window }); sheet.open(doc.body);
  const n = log.length;
  await Promise.all([page.load({ background: true }), page.load({ background: true }), page.load()]);
  assert.equal(log.length, n + 1, 'one caller was explicit: the trailing load renders under the sheet');
  const m = msgs.length;
  await page.load({ background: true });
  assert.deepEqual([msgs.length - m, log.length - n], [0, 1], 'a background load clears no message and waits');
  sheet.close();
});

test('setFilters re-renders the Browse panel only', async () => {
  const { doc, page } = pageHarness({ trackDom });
  const log = specs(page, doc);
  page.registerTab('installed', { count: (s) => s.plugins.length, render: () => { log.push('installed'); } });
  await page.load(); log.length = 0;
  page.setFilters({ q: 'x' });
  assert.deepEqual([log, page.state.filters], [['browse'], { q: 'x', adds: null, from: null, hideInstalled: false }]);
});

test('a background render paints at once when no layer is open', async () => {
  const { doc, page } = pageHarness({ trackDom });
  const log = specs(page, doc);
  await page.load();
  await page.load({ background: true });
  assert.equal(log.length, 2);
});

test('a held render lands when focus comes back into the page and no layer is open (#confirm-modal closes without mk-layer-closed)', async () => {
  const { doc, page } = pageHarness({ trackDom });
  const log = specs(page, doc);
  await page.load();
  const confirm = doc.createElement('div'); confirm.className = 'viewer-modal'; doc.body.append(confirm);   // an open #confirm-modal
  await page.load({ background: true });
  doc.querySelector('#mk-root .mk-tab[data-tab="installed"]').focus();
  assert.equal(log.length, 1, 'focus inside the page under an open layer: still held');
  confirm.classList.add('hidden');
  doc.querySelector('#mk-root .mk-tab[data-tab="browse"]').focus();
  assert.equal(log.length, 2, 'the confirm closed: focus back in the page lands the held render');
  doc.querySelector('#mk-root .mk-tab[data-tab="installed"]').focus();
  assert.equal(log.length, 2, 'nothing held: focus alone never renders');
});

test('a held render never lands in the middle of a press: the pressed control survives to its click, the render lands after (M2)', async () => {
  const { window, doc, page } = pageHarness({ trackDom });
  const log = specs(page, doc); const clicks = [];
  page.registerTab('marketplaces', { count: (s) => s.marketplaces.length, render: (s, el) => {
    const b = doc.createElement('button'); b.className = 'probe'; b.addEventListener('click', () => clicks.push('probe')); el.replaceChildren(b); } });
  await page.load(); page.setTab('marketplaces');
  const confirm = doc.createElement('div'); confirm.className = 'viewer-modal'; doc.body.append(confirm);   // an open #confirm-modal
  await page.load({ background: true });
  confirm.classList.add('hidden');                                                                          // Cancel: no mk-layer-closed
  const btn = doc.querySelector('#mk-root .probe'); const n = log.length;
  btn.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  btn.focus();
  assert.equal(log.length, n, 'focusin during the press holds the render');
  btn.dispatchEvent(new window.Event('pointerup', { bubbles: true }));
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual([clicks, btn.isConnected], [['probe'], true], 'the pressed control was not rebuilt before its click');
  await tick();
  assert.equal(log.length, n + 1, 'the held render lands after the click');
  assert.notEqual(doc.querySelector('#mk-root .probe'), btn);
  confirm.classList.remove('hidden');
  await page.load({ background: true });
  confirm.classList.add('hidden');
  doc.querySelector('#mk-root .mk-tab[data-tab="browse"]').focus();
  assert.equal(log.length, n + 2, 'the release ended the press: focus with no press lands the next held render');
});

test('a right-click ends the press: its context menu swallows the pointerup, focus still lands a held render', async () => {
  const { window, doc, page } = pageHarness({ trackDom });
  const log = specs(page, doc);
  await page.load();
  const confirm = doc.createElement('div'); confirm.className = 'viewer-modal'; doc.body.append(confirm);   // an open #confirm-modal
  await page.load({ background: true });
  confirm.classList.add('hidden');
  const tab = doc.querySelector('#mk-root .mk-tab[data-tab="installed"]');
  tab.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  tab.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
  await tick();
  assert.equal(log.length, 2, 'the contextmenu released the press and landed the held render');
  confirm.classList.remove('hidden');
  await page.load({ background: true });
  confirm.classList.add('hidden');
  doc.querySelector('#mk-root .mk-tab[data-tab="browse"]').focus();
  assert.equal(log.length, 3, 'no press pending: focus lands the next held render');
});

test('one tab renderer that throws reports on #plugins-msg; the other tabs still paint (M1)', async () => {
  const { doc, page, msgs } = pageHarness({ trackDom });
  specs(page, doc);
  page.registerTab('browse', { count: () => 0, render: () => { throw new TypeError('bad manifest'); } });
  await page.load();
  assert.deepEqual(msgs.at(-1), ['bad manifest', 'err-inline']);
  assert.deepEqual([...doc.querySelectorAll('.mk-panel')].map((el) => el.textContent), ['', 'installed', 'mkts']);
  assert.equal(page.state.loaded, true);
});

test('the refresh answer keeps the name order of GET /api/marketplaces (m2)', async () => {
  const a = { ...OFF, id: 'zz', name: 'alpha' }; const b = { ...OFF, id: 'aa', name: 'beta' };
  const { doc, page } = pageHarness({ trackDom, routes: { 'POST /api/marketplaces/refresh': { ok: true, marketplaces: [b, a] } } });
  specs(page, doc);
  await page.load({ refresh: true }); await tick(); await tick();
  assert.deepEqual(page.state.marketplaces.map((m) => m.name), ['alpha', 'beta']);
});

test('a background read that works takes the loader\'s own error off #plugins-msg; it never clears another message', async () => {
  let fail = true;
  const { page, msgs } = pageHarness({ trackDom, routes: { 'GET /api/plugins': () => (fail
    ? { ok: false, status: 500, data: { error: 'db locked' } } : { ok: true, status: 200, data: { plugins: ROWS, orphans: [] } }) } });
  await page.load();
  assert.deepEqual(msgs.at(-1), ['db locked', 'err-inline']);
  fail = false; await page.load({ background: true });
  assert.deepEqual([msgs.at(-1), page.state.plugins], [['', null], ROWS], 'the read worked: its old error goes');
  const n = msgs.length; await page.load({ background: true });
  assert.equal(msgs.length, n, 'no error of its own on the line: a background read leaves the line alone');
});

test('state.channelStatus carries the GET /api/chat/status channels (the Installed list\'s chat badges)', async () => {
  const channels = [{ plugin: 'slack-chat', channelId: 'slack', state: 'connected' }];
  const { page } = pageHarness({ trackDom, routes: { 'GET /api/chat/status': { channels } } });
  await page.load();
  assert.deepEqual(page.state.channelStatus, channels);
});

test('a modified click on a tab keeps the browser default (a new tab or window)', async () => {
  const { doc, window, page, navs } = pageHarness({ trackDom }); specs(page, doc); await page.load(); page.setTab('browse');
  for (const mod of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
    const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, [mod]: true });
    doc.querySelector('.mk-tab[data-tab="installed"]').dispatchEvent(ev);
    assert.deepEqual([mod, ev.defaultPrevented, page.state.tab], [mod, false, 'browse']);
  }
  assert.deepEqual(navs, []);
});

test('setFilters before the first load only stores the patch', () => {
  const { doc, page } = pageHarness({ trackDom });
  const log = specs(page, doc);
  page.setFilters({ adds: 'skills' });
  assert.deepEqual([log, page.state.filters.adds, doc.querySelector('.mk-panel[data-tab="browse"]').childElementCount], [[], 'skills', 0]);
});

test('style.css: the tab strip keeps one height, an empty header slot and an empty message line take no room; a sha version is mono', () => {
  const CSS = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  for (const re of [/\.mk-tabs\{flex:1 1 auto;padding-top:4px;\}/, /\.mk-head-actions:empty\{display:none;\}/,
    /\[data-view="marketplace"\] > \.form-msg:empty\{margin:0;min-height:0;\}/, /\.mk-ver\.mk-sha\{font-family:var\(--mono\);/]) assert.match(CSS, re);
});
test('the Installed chip is replaced on each render, never stacked', async () => {
  const { doc, page } = pageHarness({ trackDom }); specs(page, doc);
  await page.load(); await page.load();
  assert.equal(doc.querySelectorAll('.mk-tab[data-tab="installed"] .mk-upd-chip').length, 1);
});
test('the refresh answer waits under an open layer and lands when it closes', async () => {
  const { doc, window, page } = pageHarness({ trackDom }); const log = specs(page, doc);
  await page.load();
  const sheet = createSheet({ doc, win: window }); sheet.open(doc.body);
  await page.load({ refresh: true }); await tick(); await tick();
  assert.equal(log.length, 2, 'the explicit load painted; the refresh answer waits');
  sheet.close();
  assert.equal(log.length, 3, 'it lands on close');
});
test('coalescing does not depend on call order', async () => {
  const { doc, window, page, calls } = pageHarness({ trackDom }); const log = specs(page, doc);
  await Promise.all([page.load(), page.load({ refresh: true }), page.load()]); await tick(); await tick();
  assert.equal(calls.filter((c) => c === 'POST /api/marketplaces/refresh').length, 1, 'a refresh asked in the middle is kept');
  const sheet = createSheet({ doc, win: window }); sheet.open(doc.body);
  const n = log.length;
  await Promise.all([page.load({ background: true }), page.load(), page.load({ background: true })]);
  assert.equal(log.length, n + 1, 'an explicit caller in the middle makes the trailing load render at once');
  sheet.close();
});

test('a re-render whose twin of the focused control comes back disabled moves the focus to Add marketplace, never <body> (fix cycle 1, m2)', async () => {
  const { doc, page } = pageHarness({ trackDom });
  let off = false;
  page.registerTab('browse', { count: () => 0, render: () => {} });
  page.registerTab('installed', { count: () => 0, render: () => {} });
  page.registerTab('marketplaces', { count: () => 0,
    render: (s, el) => { const b = doc.createElement('button'); b.className = 'mk-mkt-browse'; b.dataset.focusKey = 'browse:x'; b.disabled = off; el.replaceChildren(b); },
    header: (s, el) => { const a = doc.createElement('button'); a.className = 'mk-add-mkt'; el.replaceChildren(a); } });
  page.setTab('marketplaces');
  await page.load();
  doc.querySelector('.mk-mkt-browse').focus();
  assert.equal(doc.activeElement, doc.querySelector('.mk-mkt-browse'));
  off = true;
  await page.load({ background: true });
  assert.equal(doc.activeElement, doc.querySelector('#mk-root .mk-head-actions .mk-add-mkt'));
});

test('targetFromParam: installed/<name>[/settings] opens the manage sheet, browse/<marketplace>/<name> the install sheet; anything else names a tab only', () => {
  assert.deepEqual(targetFromParam('installed/jira'), { kind: 'manage', name: 'jira', section: null });
  assert.deepEqual(targetFromParam('installed/a%20b/settings'), { kind: 'manage', name: 'a b', section: 'settings' });
  assert.deepEqual(targetFromParam('browse/m%2F1/slack-chat'), { kind: 'install', marketplace: 'm/1', name: 'slack-chat' });
  for (const p of ['', 'installed', 'browse', 'marketplaces', 'installed/jira/health', 'installed/jira/settings/x',
    'browse/m1', 'browse/m1/x/y', 'installed/%E0%A4%A', 'marketplaces/m1/x']) {
    assert.equal(targetFromParam(p), null, JSON.stringify(p));
  }
  assert.equal(tabFromParam('installed/jira/settings'), 'installed', 'the tab still reads the first segment');
});
