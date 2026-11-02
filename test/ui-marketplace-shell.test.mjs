// test/ui-marketplace-shell.test.mjs — the Marketplace page in the app (marketplace P3): tabs and sub-routes, one load per
// entry, plugins-changed, the three tabs and the sheets and dialogs behind them.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { OFF, EXAMPLE, ROWS } from './helpers/marketplace-fixtures.mjs';

const trackDom = useDomRelease(afterEach);
const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
class WSStub { constructor() { this.readyState = 1; WSStub.last = this; this._l = {}; } send() {} close() {}
  addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); } _open() { (this._l.open || []).forEach((fn) => fn({})); } }
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };
const count = (calls, key) => calls.filter((c) => c === key).length;

async function boot({ marketplaces = [OFF, EXAMPLE], plugins = ROWS, routes = {} } = {}) {
  const { window } = trackDom(new JSDOM(html, { url: 'http://localhost:4319/#runs' }));
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  const calls = [];
  const res = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
  window.fetch = (u, opts = {}) => {
    const key = `${opts.method || 'GET'} ${String(u)}`; calls.push(key);
    if (routes[key]) return res(...routes[key]);
    if (key === 'GET /api/plugins') return res(200, { plugins, orphans: [] });
    if (key === 'GET /api/marketplaces' || key === 'POST /api/marketplaces/refresh') return res(200, { ok: true, marketplaces });
    if (key === 'GET /api/chat/status') return res(200, { channels: [] });
    if (key.startsWith('GET /api/policy/scopes')) return res(200, { projects: [], workspaces: [], scopes: { projects: [], workspaces: [] }, homes: [], requirements: [], blockedPlugins: [], anyEnabled: false });
    return res(200, { config: { steps: {}, customModels: [] }, models: [], efforts: [], projects: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  window.localStorage.clear();
  await import(`${pathToFileURL(appPath).href}?b=${Date.now()}_${Math.random()}`);
  await tick(); if (WSStub.last) WSStub.last._open(); await settle();
  const go = async (h) => { window.location.hash = h; await settle(); };
  const frame = async (msg) => { WSStub.last._l.message.forEach((fn) => fn({ data: JSON.stringify(msg) })); await settle(); };
  return { window, doc: window.document, calls, go, frame };
}
const lit = (doc) => doc.querySelector('.mk-tab[aria-current="page"]').dataset.tab;

test('#marketplace: three tabs with counts, Browse lit; the Marketplaces tab is P7\'s cards; no intro, nothing needs git', async () => {
  const { doc, go } = await boot();
  await go('marketplace');
  assert.deepEqual([...doc.querySelectorAll('#mk-root nav.mk-tabs > a.tab.mk-tab')].map((t) => [t.dataset.tab, t.firstChild.textContent, t.querySelector('.mk-count').textContent]),
    [['browse', 'Browse', '4'], ['installed', 'Installed', '1'], ['marketplaces', 'Marketplaces', '2']]);
  assert.equal(lit(doc), 'browse');
  assert.equal(doc.querySelector('.mk-tab[data-tab="installed"] .mk-upd-chip').textContent, '1 update');
  assert.equal(doc.querySelectorAll('.mk-panel[data-tab="browse"] button.mk-tile').length, 4);
  assert.ok(doc.querySelector('.mk-panel[data-tab="marketplaces"] section.mk-mkt'), 'the Marketplaces tab is P7\u2019s');
  assert.equal(doc.getElementById('plugins-list'), null);
  assert.equal(doc.getElementById('mk-legacy'), null, 'no temporary host is left');
  assert.equal(doc.querySelector('[data-view="marketplace"] [data-needs-git], [data-view="marketplace"] .page-intro'), null);
  assert.deepEqual([...doc.querySelectorAll('[data-view="marketplace"] [data-min-level]')].map((n) => n.className), [],
    'U5: nothing on the page is gated');
  assert.ok(doc.querySelector('.mk-panel[data-tab="installed"] section.mk-all li.mk-row'), 'the Installed tab is P5\u2019s');
});

test('one entry, one load: tab hops refetch nothing; a new entry loads once more; any other sub-path is Browse', async () => {
  const { doc, calls, go } = await boot();
  const g0 = count(calls, 'GET /api/marketplaces');
  await go('marketplace');
  for (const h of ['marketplace/installed', 'marketplace/marketplaces', 'marketplace', 'marketplace/x']) await go(h);
  assert.equal(lit(doc), 'browse', '#marketplace/x is Browse');
  assert.deepEqual([count(calls, 'POST /api/marketplaces/refresh'), count(calls, 'GET /api/marketplaces') - g0], [1, 1]);
  await go('runs'); await go('marketplace/installed');
  assert.deepEqual([count(calls, 'POST /api/marketplaces/refresh'), lit(doc)], [2, 'installed']);
});

test('plugins-changed re-reads while the page is open, never refreshes (SM6); off the page it waits for the next entry', async () => {
  const routes = {};
  const { doc, calls, go, frame } = await boot({ routes });
  await go('marketplace');
  const n = count(calls, 'GET /api/marketplaces');
  routes['GET /api/marketplaces'] = [200, { marketplaces: [OFF] }];
  await frame({ type: 'plugins-changed', action: 'install' });
  assert.deepEqual([count(calls, 'GET /api/marketplaces'), count(calls, 'POST /api/marketplaces/refresh')], [n + 1, 1]);
  assert.equal(doc.querySelector('.mk-tab[data-tab="marketplaces"] .mk-count').textContent, '1', 'no layer open: the re-read paints at once');
  await go('runs');
  await frame({ type: 'plugins-changed', action: 'remove' });
  assert.equal(count(calls, 'GET /api/marketplaces'), n + 1);
});

test('a Browse tile opens the install sheet for a new plugin (P4) and the plugin sheet for an installed one (P6)', async () => {
  const { doc, go } = await boot({ routes: { 'GET /api/plugins/github-source/config': [200, { sources: [], channels: [] }],
    'GET /api/plugins/github-source': [200, { plugin: {}, inventory: {}, repo: null, subdir: '', sha: null, installedAt: null, updatedAt: null, webUrl: null }] } });
  await go('marketplace');
  doc.querySelector('button.mk-tile[data-key="off/slack-chat"]').click(); await settle();
  assert.deepEqual([doc.getElementById('mk-sheet').dataset.mode, doc.getElementById('mk-sheet-title').textContent,
    doc.getElementById('plugin-modal').classList.contains('hidden')], ['install', 'slack-chat', true]);
  doc.querySelector('#mk-sheet .mk-close').click(); await settle();
  doc.querySelector('button.mk-tile[data-key="off/github-source"]').click(); await settle();
  assert.deepEqual([doc.getElementById('mk-sheet').dataset.mode, doc.getElementById('mk-sheet-title').textContent,
    doc.getElementById('plugin-modal').classList.contains('hidden')], ['manage', 'github-source', true]);
});

test('Add marketplace opens the Add dialog over Browse, focused on its field', async () => {
  const { window, doc, go } = await boot();
  await go('marketplace');
  doc.querySelector('.mk-head-actions .mk-add-mkt').click(); await settle();
  assert.deepEqual([window.location.hash, lit(doc), doc.getElementById('mk-dialog').dataset.kind, doc.activeElement.id], ['#marketplace', 'browse', 'add-marketplace', 'mk-add-url']);
});

test('no marketplaces: the inline add opens the Add dialog and adds at once (LC-P3-23); Needs git shows in the dialog', async () => {
  const routes = { 'POST /api/marketplaces': [409, { error: 'git is not installed on this machine', code: 'GIT_MISSING' }] };
  const { window, doc, calls, go } = await boot({ marketplaces: [], plugins: [], routes });
  await go('marketplace');
  assert.equal(doc.querySelector('.mk-empty-title').textContent, 'No marketplaces yet');
  const form = doc.querySelector('.mk-empty-add'); const input = form.querySelector('input');
  input.value = 'https://gitlab.com/a/m';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle();
  assert.deepEqual([count(calls, 'POST /api/marketplaces'), doc.getElementById('mk-add-url').value,
    doc.querySelectorAll('#mk-dialog .pl-needs-git').length, form.querySelector('.pl-needs-git, .field-error'), doc.getElementById('plugins-msg').textContent],
    [1, 'https://gitlab.com/a/m', 1, null, '']);
});

test('Configure… (Team policy) opens Settings over the Installed tab and keeps it', async () => {
  const { window, doc, go } = await boot({ routes: { 'GET /api/plugins/acme/config': [200, { sources: [], channels: [] }] } });
  await go('marketplace/installed');
  const b = doc.createElement('button'); b.className = 'pl-policy-configure'; b.dataset.name = 'acme';
  doc.querySelector('section[data-view="team-policy"]').appendChild(b);
  b.click(); await settle();
  assert.deepEqual([window.location.hash, doc.getElementById('plugin-modal-title').textContent], ['#marketplace/installed', 'Settings: acme']);
});

test('a plugins-changed render held back under #plugin-modal lands when it closes', async () => {
  const routes = { 'GET /api/plugins/acme/config': [200, { sources: [], channels: [] }] };
  const { doc, go, frame } = await boot({ routes });
  await go('marketplace');
  // Team policy › Configure… opens Settings in #plugin-modal and keeps the page (no tile: P4's tiles open the sheet).
  const b = doc.createElement('button'); b.className = 'pl-policy-configure'; b.dataset.name = 'acme';
  doc.querySelector('section[data-view="team-policy"]').appendChild(b);
  b.click(); await settle();
  assert.deepEqual([doc.getElementById('plugin-modal').classList.contains('hidden'), doc.getElementById('plugin-modal-title').textContent],
    [false, 'Settings: acme']);
  routes['GET /api/marketplaces'] = [200, { marketplaces: [OFF] }];
  await frame({ type: 'plugins-changed', action: 'marketplace-remove' });
  assert.equal(doc.querySelector('.mk-tab[data-tab="marketplaces"] .mk-count').textContent, '2', 'no repaint under the Settings dialog');
  doc.getElementById('plugin-modal-close').click(); await settle();
  assert.equal(doc.querySelector('.mk-tab[data-tab="marketplaces"] .mk-count').textContent, '1');
});

test('Configure… from the Team policy page opens the Installed tab (LC-P3-19)', async () => {
  const { window, doc, go } = await boot({ routes: { 'GET /api/plugins/acme/config': [200, { sources: [], channels: [] }] } });
  await go('team-policy');
  const b = doc.createElement('button'); b.className = 'pl-policy-configure'; b.dataset.name = 'acme';
  doc.querySelector('section[data-view="team-policy"]').appendChild(b);
  b.click(); await settle();
  assert.deepEqual([window.location.hash, lit(doc)], ['#marketplace/installed', 'installed']);
});

test('the first read failed: Add marketplace still opens the Add dialog, focused on its field', async () => {
  const { doc, go } = await boot({ routes: { 'GET /api/plugins': [500, { error: 'db locked' }] } });
  await go('marketplace/marketplaces');
  doc.querySelector('.mk-head-actions .mk-add-mkt').click(); await settle();
  assert.deepEqual([doc.getElementById('mk-dialog').dataset.kind, doc.activeElement.id], ['add-marketplace', 'mk-add-url']);
});
