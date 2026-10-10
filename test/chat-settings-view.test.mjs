// test/chat-settings-view.test.mjs — pure renderers for the Settings
// "Chat notifications" card (design §4.8): render + collect round-trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChatSettings, collectChatSettings, renderScriptToolsToggle, collectScriptToolsToggle } from '../ui/public/chat-settings-view.mjs';
import { checkRows } from './helpers/rows.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const CHANNELS = [
  { plugin: 'telegram-chat', channelId: 'main', displayName: 'Telegram', platform: 'telegram', state: 'connected', detail: null },
  { plugin: 'teams-chat', channelId: 'main', displayName: 'Teams', platform: 'teams', state: 'unconfigured', detail: 'missing config: appId' },
];

test('chat settings render and round-trip, including the Ask Worca script toggle', async () => {
  await checkRows([
    { name: 'chat settings: render from prefs + channels, collect round-trips edits, empty list hint', run: async () => {
      await checkRows([
        { name: 'renders event checkboxes from prefs and channel rows with state badges', run: () => {
          const el = renderChatSettings({
            prefs: { notify: { done: true, error: true, question: false, paused: true }, channels: { 'teams-chat/main': { enabled: false } } },
            channels: CHANNELS,
          }, { doc });

          const evs = [...el.querySelectorAll('input.chat-ev')];
          assert.deepEqual(evs.map((e) => e.dataset.ev), ['question', 'done', 'error', 'paused', 'away']);
          assert.equal(evs.find((e) => e.dataset.ev === 'question').checked, false);
          assert.equal(evs.find((e) => e.dataset.ev === 'done').checked, true);

          const rows = [...el.querySelectorAll('.chat-channel-row')];
          assert.equal(rows.length, 2);
          assert.match(rows[0].textContent, /Telegram \(telegram\)/);
          assert.equal(rows[0].querySelector('input.chat-ch').checked, true, 'absent pref -> enabled');
          assert.equal(rows[1].querySelector('input.chat-ch').checked, false, 'explicit opt-out honored');
          assert.match(el.querySelector('.chat-state[data-channel-key="telegram-chat/main"]').className, /green/);
          const teamsBadge = el.querySelector('.chat-state[data-channel-key="teams-chat/main"]');
          assert.match(teamsBadge.className, /waiting/);
          assert.equal(teamsBadge.title, 'missing config: appId');

          const test0 = rows[0].querySelector('.chat-test');
          assert.equal(test0.dataset.plugin, 'telegram-chat');
          assert.equal(test0.dataset.channelId, 'main');
        } },
        { name: 'collect round-trips edits; empty channel list renders a hint', run: () => {
          const el = renderChatSettings({ prefs: { notify: {}, channels: {} }, channels: CHANNELS }, { doc });
          el.querySelector('input.chat-ev[data-ev="done"]').checked = false;
          el.querySelector('input.chat-ch[data-channel-key="telegram-chat/main"]').checked = false;
          assert.deepEqual(collectChatSettings(el), {
            notify: { question: true, done: false, error: true, paused: true, away: true },
            channels: { 'telegram-chat/main': { enabled: false }, 'teams-chat/main': { enabled: true } },
          });

          const empty = renderChatSettings({ prefs: { notify: {}, channels: {} }, channels: [] }, { doc });
          assert.equal(empty.querySelector('.chat-none').textContent, 'No chat channels installed. Install a chat plugin (e.g. telegram-chat) on the Marketplace page.');
        } },
      ]);
    } },
    { name: 'the Ask Worca script toggle: default on, explicit off honored, round-trips, no prose', run: () => {
      const on = renderScriptToolsToggle({ prefs: {} }, { doc });
      assert.equal(on.querySelector('input#askScriptTools').checked, true, 'an absent pref is ON (W20)');
      assert.equal(on.textContent.trim(), 'Create and run scripts');
      assert.equal(on.getAttribute('for'), 'askScriptTools');
      assert.equal(on.querySelectorAll('p, small, .hint').length, 0, 'labels only — no explanatory prose in the UI');
      assert.deepEqual(collectScriptToolsToggle(on), { scriptTools: true });
      const off = renderScriptToolsToggle({ prefs: { scriptTools: false } }, { doc });
      assert.equal(off.querySelector('input#askScriptTools').checked, false);
      assert.deepEqual(collectScriptToolsToggle(off), { scriptTools: false });
      off.querySelector('input#askScriptTools').checked = true;
      assert.deepEqual(collectScriptToolsToggle(off), { scriptTools: true });
      assert.deepEqual(collectScriptToolsToggle(doc.createElement('div')), { scriptTools: true }, 'a host with no control means ON');
    } },
  ]);
});

// #555: the delegated Test button in the booted app goes through withButton — busy "Sending…",
// done "Delivered"; a delivery failure is a card alert naming the chats, and the button skips done.
async function bootApp(testResults) {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const { cardAlertOf } = await import('./helpers/feedback.mjs');
  const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
  const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const sent = [];
  const json = (body, ok = true, status = 200) => Promise.resolve({ ok, status, json: async () => body });
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (u.includes('/api/chat/test') && method === 'POST') { sent.push(JSON.parse(opts.body)); return json({ results: testResults }); }
    if (u.includes('/api/chat/status')) return json({ channels: CHANNELS.slice(0, 1) });
    if (u.includes('/api/settings')) return json({ chat: { notify: {}, channels: {} }, app: {}, theme: {} });
    if (u.includes('/api/projects')) return json({ projects: [] });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  window.location.hash = 'settings/runs';
  window.dispatchEvent(new window.Event('hashchange'));
  for (let i = 0; i < 8; i++) await tick();
  return { window, sent, tick, cardAlertOf, close: () => window.close() };
}

test('#555 chat Test: busy → Delivered on the button; a delivery failure is a card alert naming the chats', async () => {
  const ok = await bootApp([{ ok: true, chatId: '-1001' }]);
  const b = ok.window.document.querySelector('#chat-settings-card .chat-test');
  assert.ok(b, 'the channel row rendered its Test button');
  b.click();
  assert.equal(b.textContent, 'Sending…');
  for (let i = 0; i < 4; i++) await ok.tick();
  assert.deepEqual(ok.sent, [{ plugin: 'telegram-chat', channelId: 'main' }]);
  assert.equal(b.textContent, 'Delivered');
  assert.equal(ok.cardAlertOf(ok.window.document.getElementById('chat-settings-card')), null);
  assert.equal(ok.window.document.getElementById('chatSettingsMsg'), null, 'no hint line under the card');
  ok.close();

  const bad = await bootApp([{ ok: true, chatId: '-1001' }, { ok: false, chatId: '-1002', error: { kind: 'not_found', message: 'chat not found' } }]);
  const t = bad.window.document.querySelector('#chat-settings-card .chat-test');
  t.click();
  for (let i = 0; i < 4; i++) await bad.tick();
  assert.deepEqual(bad.cardAlertOf(bad.window.document.getElementById('chat-settings-card')), { title: 'Delivery failed for -1002', detail: 'chat not found' });
  assert.equal(t.textContent, 'Test', 'a failure skips "Delivered"');
  assert.equal(t.disabled, false);
  bad.close();
});
