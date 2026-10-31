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
  row('example-models', { version: '0.4.0', contributions: { ...ZERO, models: 2 } }),
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
    return Promise.resolve(typeof hit === 'function' ? hit() : hit).then((r) => {   // a route may answer later (a promise)
      const { status, body } = r
        || ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], projects: [], workspaces: [], agents: [] });
      return { ok: status < 400, status, json: async () => body };
    });
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
  assert.deepEqual([...panel.querySelectorAll('section.mk-all li.mk-row')].map((r) => r.dataset.name), ['atlassian-mcp', 'example-models', 'github-source', 'slack-chat']);
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

test('⋯ → Check health opens the plugin sheet at Health; ⋯ → Remove… opens the Remove dialog over the page', async () => {
  const { doc, go } = await boot({
    'POST /api/plugins/atlassian-mcp/doctor': ok({ ok: true, checks: [{ id: 'installed', ok: true, detail: 'lockfile entry present' }] }),
    'GET /api/plugins/atlassian-mcp': ok({ plugin: {}, inventory: { mcpServers: [{ name: 'atlassian' }] }, repo: null, subdir: '', sha: 'a'.repeat(40), installedAt: null, updatedAt: null, webUrl: null }),
    'GET /api/plugins/atlassian-mcp/references': ok({ references: [] }),
    'GET /api/plugins/atlassian-mcp/config': ok({ sources: [], channels: [] }),
  });
  await go('marketplace/installed');
  const menuItem = async (label) => {
    doc.querySelector('section.mk-all .mk-more[data-name="atlassian-mcp"]').click();
    [...doc.querySelectorAll('.wfv-menu [role="menuitem"]')].find((b) => b.textContent === label).click();
    await settle();
  };
  await menuItem('Check health');
  assert.deepEqual([doc.getElementById('mk-sheet').dataset.mode, doc.getElementById('mk-sheet-title').textContent,
    doc.querySelector('#mk-sheet [data-sec="health"] .mk-chip').textContent.trim()], ['manage', 'atlassian-mcp', '1 of 1 checks passed']);
  doc.querySelector('#mk-sheet-host .mk-close').click(); await settle();
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

const DETAIL = (name, inventory) => ok({ plugin: {}, inventory, repo: 'https://github.com/SinishaDjukic/worca-cc',
  subdir: `plugins/${name}`, sha: 'a'.repeat(40), installedAt: null, updatedAt: null, webUrl: null });
const PREVIEW = (from, to, access = []) => ({ pinnedSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), pinnedVersion: from,
  candidateVersion: to, previewedAt: '2026-10-20T10:00:00.000Z', access, commits: [{ sha: 'c'.repeat(40), subject: 'Fix' }],
  diffstat: ' 1 file changed, 1 insertion(+)', manifestDelta: {} });

test('P6: a plugin name opens its installed plugin sheet; Escape closes it and focus returns to the name', async () => {
  const { doc, go } = await boot({
    'GET /api/plugins/github-source': DETAIL('github-source', { taskSources: [{ id: 'github', displayName: 'GitHub Issues' }] }),
    'GET /api/plugins/github-source/config': ok({ sources: [], channels: [] }),
  });
  await go('marketplace/installed');
  const nameBtn = () => doc.querySelector('section.mk-all button.mk-name[data-name="github-source"]');
  nameBtn().focus(); nameBtn().click(); await settle();
  assert.deepEqual([doc.getElementById('mk-sheet').dataset.mode, doc.getElementById('mk-sheet-title').textContent,
    doc.querySelector('#mk-sheet .mk-add-row .mk-add-name').textContent, doc.getElementById('plugin-modal').classList.contains('hidden')],
  ['manage', 'github-source', 'GitHub Issues', true]);
  doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
  assert.deepEqual([doc.getElementById('mk-sheet-host').classList.contains('hidden'), doc.activeElement === nameBtn()], [true, true]);
});

test('P6: "Update all · 2" opens the review sheet with both updates, previewed one after the other', async () => {
  const { doc, go, calls } = await boot({
    'POST /api/plugins/atlassian-mcp/update': ok({ preview: PREVIEW('0.1.0', '0.1.1') }),
    'POST /api/plugins/github-source/update': ok({ preview: PREVIEW('0.2.0', '0.3.0', [{ kind: 'secret', id: 'github.webhookSecret', red: true }]) }),
  });
  await go('marketplace/installed');
  doc.querySelector('.mk-head-actions .mk-update-all').click(); await settle(20);
  assert.deepEqual([doc.getElementById('mk-sheet').dataset.mode, doc.getElementById('mk-sheet-title').textContent,
    [...doc.querySelectorAll('#mk-sheet .mk-upd')].map((c) => c.dataset.name), doc.querySelector('#mk-sheet .mk-upd-meta').textContent],
  ['update', 'Update 2 plugins', ['atlassian-mcp', 'github-source'], '1 of 2 ready']);
  assert.deepEqual(calls.filter((c) => c.key.startsWith('POST /api/plugins/') && c.key.endsWith('/update')).map((c) => [c.key, c.body]),
    [['POST /api/plugins/atlassian-mcp/update', {}], ['POST /api/plugins/github-source/update', {}]]);
});

test('P6: a stale catalog ("already installed") hands the install sheet to the plugin sheet once the page has re-read', async () => {
  let installed = false;
  const JIRA = row('acme-jira', { version: '1.2.0', contributions: { ...ZERO, taskSources: 1 } });
  const { doc, go } = await boot({
    'GET /api/plugins': () => ok({ plugins: installed ? [...PLUGINS, JIRA] : PLUGINS, orphans: [] }),
    'POST /api/plugins/install': () => { installed = true; return { status: 500, body: { error: 'plugin "acme-jira" is already installed' } }; },
    'GET /api/plugins/acme-jira': DETAIL('acme-jira', { taskSources: [{ id: 'jira', displayName: 'Jira' }] }),
    'GET /api/plugins/acme-jira/config': ok({ sources: [], channels: [] }),
  });
  await go('marketplace');
  doc.querySelector('button.mk-tile[data-key="worca-cc/acme-jira"]').click(); await settle();
  doc.querySelector('#mk-sheet [data-act="install"]').click(); await settle(30);
  assert.deepEqual([doc.getElementById('mk-sheet-host').classList.contains('hidden'), doc.getElementById('mk-sheet').dataset.mode,
    doc.getElementById('mk-sheet-title').textContent], [false, 'manage', 'acme-jira']);
});

test('P6: Done after "Update all" (the button leaves with the reload) puts focus on the Installed tab, never <body>', async () => {
  const done = new Set();
  const plugins = () => PLUGINS.map((p) => (done.has(p.name) ? { ...p, latest: null } : p));
  const seen = {};   // this file's boot calls a route with no body: the first POST is the preview, the second the confirm
  const apply = (name) => () => ((seen[name] = (seen[name] || 0) + 1) > 1 ? (done.add(name), ok({ ok: true, updated: true }))
    : ok({ preview: PREVIEW('0.1.0', '0.2.0', name === 'github-source' ? [{ kind: 'secret', id: 'github.webhookSecret', red: true }] : []) }));
  const { window, doc, go } = await boot({
    'GET /api/plugins': () => ok({ plugins: plugins(), orphans: [] }),
    'POST /api/plugins/atlassian-mcp/update': apply('atlassian-mcp'),
    'POST /api/plugins/github-source/update': apply('github-source'),
  });
  await go('marketplace/installed');
  const all = doc.querySelector('.mk-head-actions .mk-update-all');
  all.focus(); all.click(); await settle(20);
  const tickBox = doc.querySelector('#mk-sheet .mk-reviewed');
  tickBox.checked = true; tickBox.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.querySelector('#mk-sheet .mk-sheet-foot [data-act="go"]').click(); await settle(30);
  assert.equal(doc.querySelector('#mk-sheet .mk-upd-meta').textContent, '2 of 2 updated');
  assert.equal(doc.querySelector('.mk-head-actions .mk-update-all'), null, 'the opener left with the reload');
  doc.querySelector('#mk-sheet .mk-sheet-foot [data-act="go"]').click(); await settle();
  assert.equal(doc.getElementById('mk-sheet-host').classList.contains('hidden'), true);
  assert.equal(doc.activeElement, doc.querySelector('.mk-tab[data-tab="installed"]'));
});

test('P6: a row Update that hands over to the review sheet (GIT_MISSING) gives focus back to that Update on Done', async () => {
  const { window, doc, go } = await boot({
    'POST /api/plugins/atlassian-mcp/update': { status: 409, body: { error: 'git is not installed on this machine', code: 'GIT_MISSING' } },
  });
  // Chromium's focus fixup: the focused Update turns disabled (busy) and focus drops to <body>
  const P = window.HTMLButtonElement.prototype;
  const d = Object.getOwnPropertyDescriptor(P, 'disabled');
  Object.defineProperty(P, 'disabled', { configurable: true, get() { return d.get.call(this); },
    set(v) { if (v && this.ownerDocument.activeElement === this) this.blur(); d.set.call(this, v); } });
  await go('marketplace/installed');
  const upd = doc.querySelector('section.mk-attention button[data-act="update"][data-name="atlassian-mcp"]');
  upd.focus(); upd.click(); await settle(20);
  assert.deepEqual([doc.getElementById('mk-sheet').dataset.mode, doc.querySelector('#mk-sheet .mk-upd').dataset.state], ['update', 'failed']);
  doc.querySelector('#mk-sheet .mk-sheet-foot [data-act="go"]').click(); await settle();
  assert.equal(doc.activeElement, doc.querySelector('section.mk-attention button[data-act="update"][data-name="atlassian-mcp"]'));
});

test('P6: a profile prompt or confirm the user cancels gives focus back to the control in the sheet that asked', async () => {
  const cfg = { sources: [{ id: 'jira', multiProfile: true, profile: 'default', profiles: [{ id: 'default', label: '' }, { id: 'work', label: '' }],
    schema: [{ key: 'baseUrl', label: 'Base URL', required: true }], values: { baseUrl: 'https://a' } }], channels: [] };
  const JIRA = row('jira-source', { contributions: { ...ZERO, taskSources: 1 } });
  const { window, doc, go } = await boot({
    'GET /api/plugins': ok({ plugins: [...PLUGINS, JIRA], orphans: [] }),
    'GET /api/plugins/jira-source': DETAIL('jira-source', { taskSources: [{ id: 'jira', displayName: 'Jira' }] }),
    'GET /api/plugins/jira-source/config': ok(cfg),
    'DELETE /api/plugins/jira-source/profiles/default?sourceId=jira': { status: 500, body: { error: 'profile is bound to a project' } },
  });
  await go('marketplace/installed');
  doc.querySelector('section.mk-all button.mk-name[data-name="jira-source"]').click(); await settle();
  const $ = (s) => doc.querySelector(`#mk-sheet ${s}`);
  for (const sel of ['.mk-profile-add', '.mk-profile-del']) {
    $(sel).focus(); $(sel).click(); await settle();
    assert.equal(doc.getElementById('confirm-modal').classList.contains('hidden'), false, sel);
    doc.getElementById('confirm-cancel').click(); await settle();
    assert.equal(doc.activeElement, $(sel), `${sel}: focus is back on the button`);
  }
  const base = $('[data-key="baseUrl"]');
  base.value = 'https://b'; base.dispatchEvent(new window.Event('input', { bubbles: true }));
  const pick = $('.mk-profile-sel');
  pick.focus(); pick.value = 'work'; pick.dispatchEvent(new window.Event('change', { bubbles: true })); await settle();
  doc.getElementById('confirm-cancel').click(); await settle();
  assert.deepEqual([pick.value, doc.activeElement === pick], ['default', true]);
  $('.mk-profile-del').focus(); $('.mk-profile-del').click(); await settle();
  doc.getElementById('confirm-ok').click(); await settle();
  assert.deepEqual([$('.mk-group-err')?.textContent, doc.activeElement === $('.mk-profile-del')], ['profile is bound to a project', true],
    'a refused delete: the error and the focus stay in the sheet');
});

test('P6: install → Done → "Manage <name>" opens the plugin sheet; closing it (the Browse tile is hidden now) focuses the Installed tab', async () => {
  let installed = false;
  const JIRA = row('acme-jira', { version: '1.2.0', contributions: { ...ZERO, taskSources: 1 } });
  const { window, doc, go } = await boot({
    'GET /api/plugins': () => ok({ plugins: installed ? [...PLUGINS, JIRA] : PLUGINS, orphans: [] }),
    'POST /api/plugins/install': () => { installed = true; return ok({ ok: true, inventory: {}, warnings: [], ignored: [] }); },
    'GET /api/plugins/acme-jira': DETAIL('acme-jira', { taskSources: [{ id: 'jira', displayName: 'Jira' }] }),
    'GET /api/plugins/acme-jira/config': ok({ sources: [], channels: [] }),
  });
  // Chromium: an element in a hidden subtree (the Browse panel once the Installed tab shows) cannot take focus
  const focus = window.HTMLElement.prototype.focus;
  window.HTMLElement.prototype.focus = function (o) { if (!this.closest('[hidden]')) focus.call(this, o); };
  await go('marketplace');
  const tile = doc.querySelector('button.mk-tile[data-key="worca-cc/acme-jira"]');
  tile.focus(); tile.click(); await settle();
  doc.querySelector('#mk-sheet [data-act="install"]').click(); await settle(30);
  doc.querySelector('#mk-sheet [data-link="manage"]').click(); await settle(20);
  assert.deepEqual([doc.getElementById('mk-sheet').dataset.mode, doc.getElementById('mk-sheet-title').textContent], ['manage', 'acme-jira']);
  doc.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
  assert.equal(doc.activeElement, doc.querySelector('.mk-tab[data-tab="installed"]'));
});

test('P6: a ⋯ Check for update that answers after the plugin sheet opened (typed settings) takes nothing over', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const cfg = { sources: [{ id: 'jira', multiProfile: false, profile: 'default', profiles: [{ id: 'default', label: '' }],
    schema: [{ key: 'baseUrl', label: 'Base URL', required: true }], values: { baseUrl: 'https://a' } }], channels: [] };
  const JIRA = row('jira-source', { contributions: { ...ZERO, taskSources: 1 } });
  const { window, doc, go } = await boot({
    'GET /api/plugins': ok({ plugins: [...PLUGINS, JIRA], orphans: [] }),
    'GET /api/plugins/jira-source': DETAIL('jira-source', { taskSources: [{ id: 'jira', displayName: 'Jira' }] }),
    'GET /api/plugins/jira-source/config': ok(cfg),
    'POST /api/plugins/atlassian-mcp/update': () => held.then(() => ok({ preview: PREVIEW('0.1.0', '0.1.1') })),   // a git fetch takes seconds
  });
  await go('marketplace/installed');
  doc.querySelector('section.mk-all .mk-more[data-name="atlassian-mcp"]').click();
  [...doc.querySelectorAll('.wfv-menu [role="menuitem"]')].find((b) => b.textContent === 'Check for update').click();
  await settle(4);
  doc.querySelector('section.mk-all button.mk-name[data-name="jira-source"]').click(); await settle();
  const base = doc.querySelector('#mk-sheet [data-key="baseUrl"]');
  base.value = 'https://typed'; base.dispatchEvent(new window.Event('input', { bubbles: true }));
  release(); await settle(20);
  assert.deepEqual([doc.getElementById('mk-sheet').dataset.mode, doc.getElementById('mk-sheet-title').textContent,
    doc.querySelector('#mk-sheet [data-key="baseUrl"]')?.value], ['manage', 'jira-source', 'https://typed'], 'the typed value is still on screen');
});

test('P6: "Set up" → Save: the reload takes the Set up row away and focus lands on the Installed tab, never <body>', async () => {
  let saved = false;
  const cfg = { sources: [], channels: [{ id: 'slack', displayName: 'Slack', platform: 'slack',
    schema: [{ key: 'botToken', type: 'text', label: 'Bot token', secret: true, required: true }], values: { botToken: { set: false } } }] };
  const { window, doc, go } = await boot({
    'GET /api/plugins': () => ok({ plugins: PLUGINS.map((p) => (p.name === 'slack-chat' && saved ? { ...p, setup: { ok: true, missing: [], noProfiles: [] } } : p)), orphans: [] }),
    'GET /api/plugins/slack-chat': DETAIL('slack-chat', { chatChannels: [{ id: 'slack', displayName: 'Slack' }] }),
    'GET /api/plugins/slack-chat/config': ok(cfg),
    'PUT /api/plugins/slack-chat/config': () => { saved = true; return ok({ ok: true }); },
  });
  await go('marketplace/installed');
  const setup = doc.querySelector('section.mk-attention button[data-act="setup"][data-name="slack-chat"]');
  setup.focus(); setup.click(); await settle();
  const tok = doc.querySelector('#mk-sheet [data-key="botToken"]');
  assert.equal(doc.activeElement, tok, 'opened at Settings');
  tok.value = 'xoxb-1'; tok.dispatchEvent(new window.Event('input', { bubbles: true }));
  doc.querySelector('#mk-sheet [data-act="save"]').click(); await settle(30);
  assert.deepEqual([doc.getElementById('mk-sheet-host').classList.contains('hidden'),
    doc.querySelector('section.mk-attention button[data-act="setup"][data-name="slack-chat"]')], [true, null], 'saved, closed, the row left');
  assert.equal(doc.activeElement, doc.querySelector('.mk-tab[data-tab="installed"]'));
});

test('P6: a row Update or ⋯ Check for update whose preview lands after the person left #marketplace opens no sheet over that page (SM70)', async () => {
  for (const via of ['row', 'menu']) {
    let release;
    const held = new Promise((r) => { release = r; });
    const { window, doc, go } = await boot({
      'POST /api/plugins/atlassian-mcp/update': () => held.then(() => ok({ preview: PREVIEW('0.1.0', '0.1.1', [{ kind: 'secret', id: 'atlassian.token', red: true }]) })),
    });
    await go('marketplace/installed');
    if (via === 'row') doc.querySelector('section.mk-attention button[data-act="update"][data-name="atlassian-mcp"]').click();
    else {
      doc.querySelector('section.mk-all .mk-more[data-name="atlassian-mcp"]').click();
      [...doc.querySelectorAll('.wfv-menu [role="menuitem"]')].find((b) => b.textContent === 'Check for update').click();
    }
    await settle(4);
    await go('runs');
    release(); await settle(20);
    assert.deepEqual([window.location.hash, doc.getElementById('mk-sheet-host')?.classList.contains('hidden') ?? true], ['#runs', true], via);
  }
});

test('P6: the entry refresh landing while "Review update" in the plugin sheet has focus keeps it on that button', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { doc, go } = await boot({
    'POST /api/marketplaces/refresh': () => held.then(() => ok({ ok: true, marketplaces: [MKT] })),   // a git fetch per marketplace: seconds
    'GET /api/plugins/github-source': DETAIL('github-source', { taskSources: [{ id: 'github', displayName: 'GitHub Issues' }] }),
    'GET /api/plugins/github-source/config': ok({ sources: [], channels: [] }),
  });
  await go('marketplace/installed');
  doc.querySelector('section.mk-all button.mk-name[data-name="github-source"]').click(); await settle();
  doc.querySelector('#mk-sheet .mk-review-update').focus();
  release(); await settle(20);
  assert.equal(doc.activeElement, doc.querySelector('#mk-sheet .mk-review-update'));
});

test('P6: a plugin removed elsewhere closes its open sheet; focus lands on the Installed tab, never <body>', async () => {
  let gone = false;
  const JIRA = row('jira-source', { contributions: { ...ZERO, taskSources: 1 } });
  const { doc, go, recv } = await boot({
    'GET /api/plugins': () => ok({ plugins: gone ? PLUGINS : [...PLUGINS, JIRA], orphans: [] }),
    'GET /api/plugins/jira-source': DETAIL('jira-source', { taskSources: [{ id: 'jira', displayName: 'Jira' }] }),
    'GET /api/plugins/jira-source/config': ok({ sources: [], channels: [] }),
  });
  await go('marketplace/installed');
  const nameBtn = doc.querySelector('section.mk-all button.mk-name[data-name="jira-source"]');
  nameBtn.focus(); nameBtn.click(); await settle();
  gone = true;
  recv({ type: 'plugins-changed', action: 'remove' });   // the CLI or another tab removed it
  await settle(20);
  assert.deepEqual([doc.getElementById('mk-sheet-host').classList.contains('hidden'), doc.activeElement === doc.querySelector('.mk-tab[data-tab="installed"]')], [true, true]);
});
