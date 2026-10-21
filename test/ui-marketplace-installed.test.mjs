// test/ui-marketplace-installed.test.mjs — the Installed tab mounted in the real app: one load, the live channel chip,
// the row menu's Remove dialog, Check health's interim dialog, and trusted-home auto-install (S2 risks 2, 11).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast } from './helpers/feedback.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };
const ZERO = { taskSources: 0, chatChannels: 0, mcpServers: 0, models: 0, agents: 0, scripts: 0, skills: 0, workflows: 0 };
const row = (name, extra = {}) => ({ name, version: '0.1.0', pinnedSha: 'a'.repeat(40), repo: 'https://github.com/SinishaDjukic/worca-cc', subdir: `plugins/${name}`,
  marketplace: 'worca-cc', marketplaceName: 'Worca CC Official', enabled: true, linked: false, broken: false, apiMismatch: null, pythonMissing: false,
  ignored: [], mcpSets: [], skillSets: [], contributions: { ...ZERO }, description: null, ref: null, latest: null,
  setup: { ok: true, missing: [], noProfiles: [] }, notes: [], ...extra });
const L = (version, access = []) => ({ version, sha: 'b'.repeat(40), marketplace: 'worca-cc', access });
const PLUGINS = [
  row('atlassian-mcp', { contributions: { ...ZERO, mcpServers: 1 }, latest: L('0.1.1') }),
  row('discretestack-models', { version: '0.4.0', contributions: { ...ZERO, models: 2 } }),
  row('github-source', { version: '0.2.0', contributions: { ...ZERO, taskSources: 1 }, latest: L('0.3.0', [{ kind: 'secret', id: 'github.webhookSecret', red: true }]) }),
  row('slack-chat', { contributions: { ...ZERO, chatChannels: 1 }, setup: { ok: false, missing: [{ kind: 'chatChannel', id: 'slack', keys: ['botToken'] }], noProfiles: [] } }),
];
const MKT = { id: 'worca-cc', name: 'Worca CC Official', url: 'https://github.com/SinishaDjukic/worca-cc', ref: 'dev', builtin: true, warnings: [], lastError: null,
  lastSync: { sha: '735b354' + '0'.repeat(33), at: '2026-10-20T10:00:00.000Z' },
  plugins: [{ name: 'acme-jira', subdir: 'plugins/acme-jira', description: 'Jira', version: '1.2.0', installed: false, notes: [], inventory: { taskSources: [{ id: 'jira', displayName: 'Jira', secrets: [] }] } }] };
const SCOPES = { projects: [], workspaces: [], scopes: { projects: [], workspaces: [] }, homes: [], requirements: [], blockedPlugins: [], anyEnabled: false };
const ok = (body) => ({ status: 200, body });

async function boot(over = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  const sockets = [];
  window.WebSocket = class { constructor() { this.readyState = 1; this.l = {}; sockets.push(this); } send() {} close() {} addEventListener(t, f) { (this.l[t] ||= []).push(f); } };
  const routes = {
    'GET /api/plugins': ok({ plugins: PLUGINS, orphans: [{ name: 'telegram-chat', dataDir: '/h/.worca-cc/plugins/telegram-chat/data' }] }),
    'GET /api/marketplaces': ok({ marketplaces: [MKT] }),
    'POST /api/marketplaces/refresh': ok({ ok: true, marketplaces: [MKT] }),
    'GET /api/chat/status': ok({ channels: [{ plugin: 'slack-chat', channelId: 'slack', displayName: 'Slack', platform: 'slack', state: 'unconfigured', detail: 'missing config: botToken', missingConfig: ['botToken'] }] }),
    'GET /api/policy/scopes': ok(SCOPES),
    ...over,
  };
  const calls = [];
  window.fetch = (url, opts = {}) => {
    const u = String(url).replace(/^https?:\/\/[^/]+/, '');
    const key = `${opts.method || 'GET'} ${u}`;
    calls.push({ key, body: opts.body ? JSON.parse(opts.body) : undefined });
    const hit = routes[key];
    const { status, body } = (typeof hit === 'function' ? hit() : hit)
      || ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], projects: [], workspaces: [], agents: [] });
    return Promise.resolve({ ok: status < 400, status, json: async () => body });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle(2);
  const go = async (hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); await settle(); };
  const recv = (obj) => sockets.forEach((s) => (s.l.message || []).forEach((f) => f({ data: JSON.stringify(obj) })));
  return { window, doc: window.document, calls, go, recv };
}

test('#marketplace/installed: Needs attention, All installed and Leftover data from one load; the tab carries 2 updates', async () => {
  const { doc, go, calls } = await boot();
  await go('marketplace/installed');
  const panel = doc.querySelector('#mk-root .mk-panel[data-tab="installed"]');
  assert.deepEqual([...panel.querySelectorAll('section.mk-attention li.mk-row')].map((r) => [r.dataset.name, r.querySelector('button[data-act]').textContent]),
    [['atlassian-mcp', 'Update'], ['github-source', 'Review'], ['slack-chat', 'Set up']]);
  assert.deepEqual([...panel.querySelectorAll('section.mk-all li.mk-row')].map((r) => r.dataset.name), ['atlassian-mcp', 'discretestack-models', 'github-source', 'slack-chat']);
  assert.ok(panel.querySelector('section.mk-leftover li.mk-orphan[data-name="telegram-chat"]'));
  assert.equal(doc.querySelector('.mk-tab[data-tab="installed"] .mk-upd-chip').textContent, '2 updates');
  assert.equal(doc.querySelector('.mk-head-actions .mk-update-all').textContent, 'Update all · 2');
  assert.equal(calls.filter((c) => c.key === 'POST /api/marketplaces/refresh').length, 1, 'one entry, one refresh');
  assert.equal(doc.getElementById('plugins-list'), null);
  assert.equal(doc.getElementById('plugins-policy'), null);
});

test('a channel-status frame patches the live chip in Needs attention in place (onChannelStatus)', async () => {
  const { doc, go, recv } = await boot();
  await go('marketplace/installed');
  const chip = () => doc.querySelector('section.mk-attention .pl-channel[data-channel-key="slack-chat/slack"]');
  assert.deepEqual([chip().textContent, chip().className], ['Slack · unconfigured', 'badge mk-chip mk-chip-off pl-channel']);
  recv({ type: 'channel-status', plugin: 'slack-chat', channelId: 'slack', platform: 'slack', state: 'connected', detail: null });
  assert.deepEqual([chip().textContent, chip().className], ['Slack · connected', 'badge mk-chip mk-chip-ok pl-channel']);
  doc.querySelector('.mk-head-actions .mk-refresh').click();   // the refresh repaints from the page state, no new chat status
  await settle();
  assert.equal(chip().textContent, 'Slack · connected', 'the page state followed the frame');
});

test('⋯ → Check health opens the interim Health dialog; ⋯ → Remove… opens the Remove dialog over the page', async () => {
  const { doc, go } = await boot({
    'POST /api/plugins/atlassian-mcp/doctor': ok({ ok: true, checks: [{ id: 'installed', ok: true, detail: 'lockfile entry present' }] }),
    'GET /api/plugins/atlassian-mcp': ok({ plugin: {}, inventory: { mcpServers: [{ name: 'atlassian' }] }, repo: null, subdir: '', sha: 'a'.repeat(40), installedAt: null, updatedAt: null, webUrl: null }),
    'GET /api/plugins/atlassian-mcp/references': ok({ references: [] }),
  });
  await go('marketplace/installed');
  const menuItem = async (label) => {
    doc.querySelector('section.mk-all .mk-more[data-name="atlassian-mcp"]').click();
    [...doc.querySelectorAll('.wfv-menu [role="menuitem"]')].find((b) => b.textContent === label).click();
    await settle();
  };
  await menuItem('Check health');
  assert.equal(doc.getElementById('plugin-modal-title').textContent, 'Health: atlassian-mcp');
  assert.ok(doc.querySelector('#plugin-modal-body .pl-doctor-report'));
  doc.getElementById('plugin-modal-close').click();
  await menuItem('Remove…');
  assert.equal(doc.getElementById('mk-dialog').dataset.kind, 'remove');
  assert.equal(doc.getElementById('mk-dialog-title').textContent, 'Remove atlassian-mcp?');
});

test('trusted home: a missing required plugin installs once, silently, on entry; the card follows the policy', async () => {
  const REQ = { name: 'acme-jira', marketplace: 'worca-cc', minVersion: '1.2.0', state: 'missing', installed: null, homes: ['acme/gateway'] };
  // The server reports `ok` once the install landed; a fixture that stays `missing` would install again on every reload.
  let installed = false;
  const { window, doc, go, calls } = await boot({
    'GET /api/policy/scopes': () => ok({ ...SCOPES, requirements: [installed ? { ...REQ, state: 'ok', installed: { version: '1.2.0', enabled: true } } : REQ] }),
    'POST /api/plugins/install': () => { installed = true; return ok({ ok: true, inventory: {}, warnings: [], ignored: [] }); },
  });
  window.localStorage.setItem('worca.policy.trust.acme/gateway', '1');
  await go('marketplace/installed');
  assert.deepEqual(calls.filter((c) => c.key === 'POST /api/plugins/install').map((c) => c.body),
    [{ repoUrl: MKT.url, subdir: 'plugins/acme-jira', name: 'acme-jira', sha: MKT.lastSync.sha, marketplace: 'worca-cc' }]);
  assert.equal(lastToast(doc).title, 'Installed acme-jira (trusted policy home).');
  assert.equal(doc.querySelector('section.mk-policy li.mk-policy-row[data-name="acme-jira"]'), null, 'the reload reads the policy: ok → off the card');
});

test('Team policy card: Set up… opens today\'s setup checklist (deps.openSetupChecklist, L3)', async () => {
  const REQ = { name: 'acme-jira', marketplace: 'worca-cc', minVersion: '1.2.0', state: 'missing', installed: null, homes: ['acme/gateway'] };
  const { doc, go } = await boot({ 'GET /api/policy/scopes': ok({ ...SCOPES, requirements: [REQ] }) });
  await go('marketplace/installed');
  doc.querySelector('section.mk-policy button.mk-policy-setup').click();
  await settle();
  assert.equal(doc.getElementById('plugin-modal').classList.contains('hidden'), false);
  assert.equal(doc.getElementById('plugin-modal-title').textContent, 'Set up for acme/gateway');
});

test('Team policy card: Install opens P4\'s install sheet on the snapshot the policy names; an unlisted plugin gets P4\'s not-found toast', async () => {
  const REQ = (name, marketplace) => ({ name, marketplace, minVersion: null, state: 'missing', installed: null, homes: ['acme/gateway'] });   // not a trusted home
  const policy = { 'GET /api/policy/scopes': ok({ ...SCOPES, requirements: [REQ('acme-jira', 'Worca CC Official'), REQ('ghost', 'gone')] }) };
  const sheetOpen = (doc) => { const h = doc.getElementById('mk-sheet-host'); return !!h && !h.hidden && !h.classList.contains('hidden'); };
  const one = await boot(policy);
  await one.go('marketplace/installed');
  one.doc.querySelector('section.mk-policy [data-act="policy-install"][data-name="acme-jira"]').click();
  await settle();
  assert.deepEqual([sheetOpen(one.doc), one.doc.getElementById('mk-sheet')?.dataset.mode,
    one.doc.getElementById('mk-sheet-title')?.textContent, one.doc.querySelector('#mk-sheet .mk-sheet-id .mk-meta')?.textContent],
    [true, 'install', 'acme-jira', '1.2.0 · Worca CC Official'], 'the sheet at Review for the MKT snapshot\'s acme-jira');
  assert.equal(one.calls.filter((c) => c.key === 'POST /api/plugins/install').length, 0, 'nothing installs before the sheet\'s own click');
  const two = await boot(policy);
  await two.go('marketplace/installed');
  two.doc.querySelector('section.mk-policy [data-act="policy-install"][data-name="ghost"]').click();
  await settle();
  assert.deepEqual(lastToast(two.doc), { tone: 'err', title: 'ghost', detail: 'not found in a synced marketplace — refresh marketplaces (the policy names gone).', action: '' });
  assert.equal(sheetOpen(two.doc), false);
});

test('a team-policy-changed frame re-reads the page: the Team policy card follows the policy (SM59)', async () => {
  const REQ = { name: 'acme-jira', marketplace: 'worca-cc', minVersion: '1.2.0', state: 'missing', installed: null, homes: ['acme/gateway'] };
  let met = false;
  const { doc, go, recv } = await boot({
    'GET /api/policy/scopes': () => ok({ ...SCOPES, requirements: [met ? { ...REQ, state: 'ok', installed: { version: '1.2.0', enabled: true } } : REQ] }),
  });
  await go('marketplace/installed');
  const row = () => doc.querySelector('section.mk-policy li.mk-policy-row[data-name="acme-jira"]');
  assert.ok(row(), 'the card lists the missing plugin');
  met = true;
  recv({ type: 'team-policy-changed', action: 'updated' });
  await settle();
  assert.equal(row(), null, 'the reload read the new scopes');
});

test('a team-policy-changed frame runs the trusted-home install too: a plugin the policy now requires installs once', async () => {
  const REQ = { name: 'acme-jira', marketplace: 'worca-cc', minVersion: '1.2.0', state: 'missing', installed: null, homes: ['acme/gateway'] };
  let required = false;
  let installed = false;
  const { window, go, calls, recv } = await boot({
    'GET /api/policy/scopes': () => ok({ ...SCOPES, requirements: required ? [installed ? { ...REQ, state: 'ok', installed: { version: '1.2.0', enabled: true } } : REQ] : [] }),
    'POST /api/plugins/install': () => { installed = true; return ok({ ok: true, inventory: {}, warnings: [], ignored: [] }); },
  });
  window.localStorage.setItem('worca.policy.trust.acme/gateway', '1');
  await go('marketplace/installed');
  const installs = () => calls.filter((c) => c.key === 'POST /api/plugins/install').length;
  assert.equal(installs(), 0);
  required = true;
  recv({ type: 'team-policy-changed', action: 'updated' });
  await settle(20);
  assert.equal(installs(), 1);
});
