// test/chat-settings-view.test.mjs — pure renderers for the Settings
// "Chat notifications" card (design §4.8): render + collect round-trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChatSettings, collectChatSettings } from '../ui/public/chat-settings-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const CHANNELS = [
  { plugin: 'telegram-chat', channelId: 'main', displayName: 'Telegram', platform: 'telegram', state: 'connected', detail: null },
  { plugin: 'teams-chat', channelId: 'main', displayName: 'Teams', platform: 'teams', state: 'unconfigured', detail: 'missing config: appId' },
];

test('renders event checkboxes from prefs and channel rows with state badges', () => {
  const el = renderChatSettings({
    prefs: { notify: { done: true, error: true, question: false, paused: true }, channels: { 'teams-chat/main': { enabled: false } } },
    channels: CHANNELS,
  }, { doc });

  const evs = [...el.querySelectorAll('input.chat-ev')];
  assert.deepEqual(evs.map((e) => e.dataset.ev), ['question', 'done', 'error', 'paused']);
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
});

test('collect round-trips edits; empty channel list renders a hint', () => {
  const el = renderChatSettings({ prefs: { notify: {}, channels: {} }, channels: CHANNELS }, { doc });
  el.querySelector('input.chat-ev[data-ev="done"]').checked = false;
  el.querySelector('input.chat-ch[data-channel-key="telegram-chat/main"]').checked = false;
  assert.deepEqual(collectChatSettings(el), {
    notify: { question: true, done: false, error: true, paused: true },
    channels: { 'telegram-chat/main': { enabled: false }, 'teams-chat/main': { enabled: true } },
  });

  const empty = renderChatSettings({ prefs: { notify: {}, channels: {} }, channels: [] }, { doc });
  assert.match(empty.querySelector('.chat-none').textContent, /No chat channels installed/);
});
