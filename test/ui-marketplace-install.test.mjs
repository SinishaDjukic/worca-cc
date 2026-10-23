// test/ui-marketplace-install.test.mjs — P4 in the real app: a Browse tile opens the install sheet (never #plugin-modal);
// the whole Review → Install → Set up → Done path; the Done chip follows channel-status frames (app.js onChannelStatus);
// Done returns focus to the live tile.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { bootGitApp } from './helpers/git-app-boot.mjs';
import { SHA, INV, SLACK_CONFIG } from './helpers/marketplace-install-fixtures.mjs';

const trackDom = useDomRelease(afterEach);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SLACK_INV = INV({ chatChannels: [{ id: 'main', displayName: 'Slack', platform: 'slack', ingress: 'connect', inbound: true, outbound: true, secrets: ['botToken', 'appToken'] }] });
const MKT = { id: 'official', url: 'https://github.com/SinishaDjukic/worca-cc', name: 'Worca CC Official', builtin: true, warnings: [],
  lastSync: { sha: SHA, at: '2026-10-20T08:00:00.000Z' },
  plugins: [{ name: 'slack-chat', subdir: 'plugins/slack-chat', description: 'Two-way Slack channel', version: '0.1.0', inventory: SLACK_INV, installed: false }] };
async function boot() {
  const { window, doc, ws } = await bootGitApp({ trackDom, git: true });
  for (const k of ['Element', 'HTMLElement', 'Node', 'Event', 'CustomEvent']) Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
  const calls = []; const base = window.fetch;
  const j = (status, body) => Promise.resolve({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fake = (url, opts = {}) => {
    const u = String(url); const m = opts.method || 'GET';
    calls.push([m, u, opts.body ? JSON.parse(opts.body) : undefined]);
    if (u === '/api/plugins/install') return j(200, { ok: true, inventory: SLACK_INV, warnings: [], ignored: [] });
    if (u === '/api/plugins/slack-chat/config') return m === 'PUT' ? j(200, { ok: true }) : j(200, SLACK_CONFIG);
    if (u.startsWith('/api/chat/status')) return j(200, { channels: [{ plugin: 'slack-chat', channelId: 'main', displayName: 'Slack', platform: 'slack', state: 'connecting', detail: null }] });
    if (u.startsWith('/api/marketplaces')) return j(200, { ok: true, marketplaces: [MKT] });
    if (u.startsWith('/api/plugins')) return j(200, { plugins: [], orphans: [] });
    if (u.startsWith('/api/policy/scopes')) return j(200, { projects: [], workspaces: [], scopes: { projects: [], workspaces: [] }, homes: [], requirements: [], blockedPlugins: [], anyEnabled: false });
    return base(url, opts);
  };
  window.fetch = fake; globalThis.fetch = fake;
  window.location.hash = '#marketplace'; for (let i = 0; i < 10; i++) await wait(5);
  return { window, doc, ws, calls };
}
const tile = (doc) => doc.querySelector('button.mk-tile[data-key="official/slack-chat"]');
const act = (doc, a) => doc.querySelector(`#mk-sheet [data-act="${a}"]`);
const sheetOpen = (doc) => { const h = doc.getElementById('mk-sheet-host'); return !!h && !h.hidden && !h.classList.contains('hidden'); };
const type = (doc, key, v) => { const i = doc.querySelector(`#mk-sheet [data-key="${key}"]`); i.value = v; i.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true })); };

test('the install sheet in the app', async () => {
  await checkRows([
    { name: 'a Browse tile opens the install sheet at Review, not the consent modal', run: async () => {
      const { doc } = await boot();
      tile(doc).focus(); tile(doc).click(); await wait(5);
      assert.deepEqual([doc.getElementById('mk-sheet')?.dataset.mode, doc.getElementById('mk-sheet-title').textContent,
        doc.getElementById('plugin-modal').classList.contains('hidden')], ['install', 'slack-chat', true]);
    } },
    { name: 'the whole path: one install POST, one channel PUT, a live chip, focus back on the tile', run: async () => {
      const { doc, ws, calls } = await boot();
      tile(doc).focus(); tile(doc).click(); await wait(5);
      act(doc, 'install').click(); for (let i = 0; i < 10; i++) await wait(5);
      type(doc, 'botToken', 'xoxb-1'); type(doc, 'appToken', 'xapp-1'); type(doc, 'notifyChatIds', 'C07Q2M4KD1');
      act(doc, 'save').click(); for (let i = 0; i < 10; i++) await wait(5);
      assert.deepEqual(calls.filter(([m]) => m === 'PUT').map(([, , b]) => b),
        [{ channelId: 'main', values: { botToken: 'xoxb-1', appToken: 'xapp-1', notifyChatIds: 'C07Q2M4KD1', allowedChatIds: '', channelAllowlist: '' } }]);
      const chip = () => doc.querySelector('#mk-sheet .pl-channel[data-channel-key="slack-chat/main"]');
      assert.equal(chip().textContent, 'Slack · connecting');
      ws._msg({ type: 'channel-status', plugin: 'slack-chat', channelId: 'main', platform: 'slack', state: 'connected', detail: null });
      assert.deepEqual([chip().textContent, chip().className], ['Slack · connected', 'badge mk-chip mk-chip-ok pl-channel']);   // SM37: P5 later rewrites this className
      assert.equal(calls.filter(([m, u]) => m === 'POST' && u === '/api/plugins/install').length, 1);
      act(doc, 'done').click(); await wait(5);
      assert.deepEqual([sheetOpen(doc), doc.activeElement === tile(doc)], [false, true]);
    } },
    { name: 'Skip for now lands on Installed with the address in step; the Browse tab still works (SM63, review B M3)', run: async () => {
      const { window, doc } = await boot();
      const lit = () => doc.querySelector('.mk-tab[aria-current="page"]').dataset.tab;
      tile(doc).click(); await wait(5);
      act(doc, 'install').click(); for (let i = 0; i < 10; i++) await wait(5);
      act(doc, 'skip').click(); for (let i = 0; i < 6; i++) await wait(5);
      assert.deepEqual([sheetOpen(doc), window.location.hash, lit()], [false, '#marketplace/installed', 'installed']);
      doc.querySelector('.mk-tab[data-tab="browse"]').click(); for (let i = 0; i < 6; i++) await wait(5);
      assert.deepEqual([window.location.hash, lit()], ['#marketplace', 'browse']);
    } },
  ]);
});

test('SM25: app.js hands invalidateAgentCaches to the Marketplace page (the sheet calls it after an install)', () => {
  const src = readFileSync(fileURLToPath(new URL('../ui/public/app.js', import.meta.url)), 'utf8');
  const at = src.indexOf('marketplacePage = mountMarketplace({');
  assert.match(src.slice(at, src.indexOf('} });', at)), /\binvalidateAgentCaches\b/);
});
