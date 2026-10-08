// test/chat-notifier.test.mjs — outbound notification pipeline (design §4.5):
// event -> render -> prefs gating -> per-channel fan-out to notifyChatIds ->
// mute suppression -> delivery via the (fake) channel host; plus the
// chatPrefs/setChatPrefs settings round-trip (HOME sandboxed — the settings
// file lives under defaultRoot()/.worca-cc, not WORCA_HOME).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { writePluginConfig } from '../src/core/plugin-config.mjs';
import { createChatContext } from '../src/core/chat/chat-context.mjs';
import { createNotifier } from '../src/core/chat/notifier.mjs';
import { chatPrefs, setChatPrefs } from '../src/core/settings.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);

const SCHEMA = [{ key: 'notifyChatIds', type: 'text', label: 'Notify', secret: false, required: false }];

function fixture({ prefs } = {}) {
  writePluginConfig('tg-chat', SCHEMA, { notifyChatIds: '100, 200' });
  const sent = [];
  const channelHost = {
    list: () => [
      { plugin: 'tg-chat', channelId: 'main', platform: 'telegram', capabilities: { inbound: true, outbound: true }, configSchema: SCHEMA },
      { plugin: 'inonly', channelId: 'main', platform: 'x', capabilities: { inbound: true, outbound: false }, configSchema: SCHEMA },
    ],
    sendMessage: async (args) => { sent.push(args); },
  };
  const chatContext = createChatContext(join(worcaHome(), `cc-${Math.random().toString(36).slice(2)}.json`));
  const state = { prefs: prefs ?? { notify: { done: true, error: true, question: true, paused: true }, channels: {} } };
  const notifier = createNotifier({ channelHost, getPrefs: () => state.prefs, chatContext, logger: () => {} });
  const orch = new EventEmitter();
  orch.state = { totalCostUsd: 0.5, totalActiveMs: 60000 };
  const entry = { title: 'Notify me' };
  notifier.attach(orch, { runId: 'run-abcd9999', entry });
  const settle = () => new Promise((r) => setTimeout(r, 25));
  return { orch, sent, settle, chatContext, state, notifier, entry };
}

test('done, question and error events fan out to outbound notifyChatIds with their own messages', async () => {
  await checkRows([
    { name: 'done event fans out to every notifyChatIds of outbound channels only', run: async () => {
      const { orch, sent, settle } = fixture();
      orch.emit('done', { status: 'done' });
      await settle();
      assert.equal(sent.length, 2, 'two chat ids, one outbound channel (inbound-only skipped)');
      assert.deepEqual(sent.map((s) => s.chatId).sort(), ['100', '200']);
      assert.ok(sent.every((s) => s.plugin === 'tg-chat'));
      assert.match(sent[0].message.body[0].value, /\*9999[\s\S]*completed/);
      assert.match(sent[0].message.body[0].value, /Notify me/, 'title read from the entry at send time');
    } },
    { name: 'question and error events render their specific messages', run: async () => {
      const { orch, sent, settle } = fixture();
      orch.emit('question', { id: 'gate-1', kind: 'gate', issues: [{ severity: 'major', summary: 'X' }] });
      await settle();
      assert.match(sent[0].message.body[0].value, /\/approve \*9999/);
      sent.length = 0;
      orch.emit('error', { message: 'boom' });
      orch.emit('done', { status: 'error' });
      await settle();
      assert.equal(sent.length, 2, "error renders once per chat id; done{status:'error'} is suppressed");
      assert.match(sent[0].message.body[0].value, /\*\*Error:\*\* boom/);
    } },
  ]);
});

test('prefs, per-channel toggles and muting gate delivery', async () => {
  await checkRows([
    { name: 'prefs gate events; per-channel toggle disables a channel', run: async () => {
      const { orch, sent, settle, state } = fixture();
      state.prefs = { notify: { done: false, error: true, question: true, paused: true }, channels: {} };
      orch.emit('done', { status: 'done' });
      await settle();
      assert.equal(sent.length, 0, 'notify.done=false suppresses');

      state.prefs = { notify: { done: true, paused: false }, channels: {} };
      orch.emit('done', { status: 'paused', reason: 'cost_total' });
      await settle();
      assert.equal(sent.length, 0, 'paused gated separately from done');

      state.prefs = { notify: { done: true }, channels: { 'tg-chat/main': { enabled: false } } };
      orch.emit('done', { status: 'done' });
      await settle();
      assert.equal(sent.length, 0, 'channel toggle wins');

      state.prefs = { notify: { done: true, paused: false, error: true }, channels: {} };
      orch.emit('done', { status: 'paused', reason: 'error', detail: 'boom' });
      await settle();
      assert.equal(sent.length, 2, 'an error-pause follows notify.error, not notify.paused');
      assert.match(sent[0].message.body[0].value, /\*\*Error:\*\* boom/);
      sent.length = 0;
      state.prefs = { notify: { done: true, paused: true, error: false }, channels: {} };
      orch.emit('done', { status: 'paused', reason: 'error', detail: 'boom' });
      await settle();
      assert.equal(sent.length, 0, 'notify.error=false suppresses the error-pause');
    } },
    { name: 'muted chats are skipped and counted; unmuted keep receiving', run: async () => {
      const { orch, sent, settle, chatContext } = fixture();
      chatContext.set('telegram:100', { mute_until: new Date(Date.now() + 60000).toISOString() });
      orch.emit('done', { status: 'done' });
      await settle();
      assert.deepEqual(sent.map((s) => s.chatId), ['200'], 'muted chat 100 skipped');
      assert.equal(chatContext.get('telegram:100').muted_messages, 1, 'suppression counted');
    } },
  ]);
});

test('delivery failures are contained (logged, never thrown into the run)', async () => {
  writePluginConfig('tg-chat', SCHEMA, { notifyChatIds: '100' });
  const logs = [];
  const channelHost = {
    list: () => [{ plugin: 'tg-chat', channelId: 'main', platform: 'telegram', capabilities: { outbound: true }, configSchema: SCHEMA }],
    sendMessage: async () => { const e = new Error('worker gone'); e.kind = 'plugin'; throw e; },
  };
  const notifier = createNotifier({
    channelHost,
    getPrefs: () => ({ notify: { done: true }, channels: {} }),
    chatContext: createChatContext(join(worcaHome(), 'cc-f.json')),
    logger: (level, msg) => logs.push(`${level}:${msg}`),
  });
  const orch = new EventEmitter();
  notifier.attach(orch, { runId: 'r-1', entry: { title: 't' } });
  orch.emit('done', { status: 'done' });
  await new Promise((r) => setTimeout(r, 25));
  assert.ok(logs.some((l) => /chat notify failed .*worker gone/.test(l)));
});

test('sendTest: explicit action, reports per-chat results, errors on missing config', async () => {
  const { notifier } = fixture();
  const out = await notifier.sendTest('tg-chat', 'main', { title: 't', body: [{ kind: 'text', value: 'x' }], severity: 'info' });
  assert.equal(out.ok, true);
  assert.equal(out.results.length, 2);
  writePluginConfig('tg-chat', SCHEMA, { notifyChatIds: null });
  await assert.rejects(notifier.sendTest('tg-chat', 'main', { title: null, body: [], severity: 'info' }), /notifyChatIds is not configured/);
  await assert.rejects(notifier.sendTest('nope', 'main', { title: null, body: [], severity: 'info' }), /no such chat channel/);
});

test('chatPrefs/setChatPrefs: defaults ON, merge-patch, unknown keys rejected', async () => {
  const prevHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'worca-cc-chatprefs-'));
  process.env.HOME = home;
  try {
    assert.deepEqual(chatPrefs(), { notify: { done: true, error: true, question: true, paused: true, away: true, prWatch: true }, channels: {}, scriptTools: true });
    await setChatPrefs({ notify: { done: false }, channels: { 'tg-chat/main': { enabled: false } } });
    const p = chatPrefs();
    assert.equal(p.notify.done, false);
    assert.equal(p.notify.error, true, 'unpatched keys keep defaults');
    assert.deepEqual(p.channels, { 'tg-chat/main': { enabled: false } });
    await setChatPrefs({ notify: { done: true } });
    assert.equal(chatPrefs().notify.done, true, 'merge does not clobber channels');
    assert.deepEqual(chatPrefs().channels, { 'tg-chat/main': { enabled: false } });
    await assert.rejects(setChatPrefs({ notify: { chaos: true } }), /unknown chat notify event/);
    // W20: the chat's script tools, merged like every other chat pref.
    await setChatPrefs({ scriptTools: false });
    assert.equal(chatPrefs().scriptTools, false);
    assert.deepEqual(chatPrefs().channels, { 'tg-chat/main': { enabled: false } }, 'the toggle does not clobber the channels');
    await setChatPrefs({ notify: { error: false } });
    assert.equal(chatPrefs().scriptTools, false, 'a notify patch does not clobber the toggle');
    await setChatPrefs({ scriptTools: true });
    assert.equal(chatPrefs().scriptTools, true);
    await assert.rejects(setChatPrefs({ scriptTools: 'yes' }), /chat scriptTools must be true or false/);
    await assert.rejects(setChatPrefs('nope'), /must be an object/);
    // chat prefs: "away" is a notify event, on by default
    assert.equal(chatPrefs().notify.away, true);
    await setChatPrefs({ notify: { away: false } });
    assert.equal(chatPrefs().notify.away, false);
  } finally {
    process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
});

// meta() omitted `directions`, so renderDone's "Directions pending" warning was
// unreachable from chat — the one surface /direct is posted from, i.e. the user
// who posted the direction was the only one who could not be told it went unread.
test('the done notification warns about unapplied directions, and only then', async () => {
  await checkRows([
    { name: 'the done notification warns about directions the run never applied', run: async () => {
      const { orch, sent, settle } = fixture();
      orch.state.directions = { posted: 2, applied: 1, pending: [{ id: 'd2', text: 'cut the roadmap' }] };
      orch.emit('done', { status: 'done' });
      await settle();
      assert.ok(sent.length > 0);
      assert.match(JSON.stringify(sent[0]), /Directions pending:\*\* 1/);
    } },
    { name: 'a run that applied every direction carries no such warning', run: async () => {
      const { orch, sent, settle } = fixture();
      orch.state.directions = { posted: 2, applied: 2, pending: [] };
      orch.emit('done', { status: 'done' });
      await settle();
      assert.doesNotMatch(JSON.stringify(sent[0]), /Directions pending/);
    } },
  ]);
});

test('away hours: notifyAway sends one info message; notify.away=false keeps it out of chat', async () => {
  const { sent, settle, notifier, state } = fixture();
  notifier.notifyAway('Away hours started (22:00 to 07:00). worca now answers questions on 1 run.');
  await settle();
  assert.equal(sent.length, 2);
  assert.match(sent[0].message.body[0].value, /Away hours started \(22:00 to 07:00\)/);
  assert.equal(sent[0].message.severity, 'info');
  sent.length = 0;
  state.prefs = { notify: { away: false }, channels: {} };
  notifier.notifyAway('Away hours ended. worca answered 3 questions while you were away; 1 to check.');
  await settle();
  assert.equal(sent.length, 0);
});

test('Watch PR: notifyPrWatch renders started/published as info and needs-person as a warning; notify.prWatch=false mutes it', async () => {
  const { sent, settle, notifier, state } = fixture();
  notifier.notifyPrWatch({ kind: 'started', title: 'https://github.com/o/r/pull/1', message: 'Fix run 1 of 3 started.' });
  notifier.notifyPrWatch({ kind: 'needs-person', title: 'https://github.com/o/r/pull/1', message: 'cap' });
  await settle();
  assert.equal(sent.length, 4);
  assert.match(sent[0].message.body[0].value, /PR watch — https:\/\/github\.com\/o\/r\/pull\/1:\*\* Fix run 1 of 3 started\./);
  assert.equal(sent[0].message.severity, 'info');
  assert.equal(sent[2].message.severity, 'warning');
  sent.length = 0;
  state.prefs = { notify: { prWatch: false }, channels: {} };
  notifier.notifyPrWatch({ kind: 'published', title: 'x', message: 'Pushed.' });
  await settle();
  assert.equal(sent.length, 0);
});
