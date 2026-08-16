// test/chat-inbound-e2e.test.mjs — the full inbound pipeline through the REAL
// server wiring under WORCA_MOCK=1 (chat-connectivity-design.md §10.2):
// injectInboundMessage -> channel host -> handleChatInbound -> command router
// (allowlist + parse + actions over the runs Map) -> reply via
// channelHost.sendMessage -> mockSentMessages. Also proves answering from chat
// clears entry.pendingQuestion through the same resolvePending chokepoint the
// UI uses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { writePluginConfig } from '../src/core/plugin-config.mjs';
import { mockSentMessages, clearMockSentMessages } from '../src/core/chat/channel-host.mjs';

process.env.WORCA_MOCK = '1';
useTempHome(after);

const NAME = 'fixture-chat';
const SCHEMA = [
  { key: 'botToken', type: 'text', label: 'Token', secret: true, required: true },
  { key: 'allowedChatIds', type: 'text', label: 'Allowed', secret: false, required: false },
];

let channelHost, chatActions, enqueueChatWork, runs, app, srv, base;

before(async () => {
  const cur = pluginCurrentDir(NAME);
  mkdirSync(join(cur, 'channel'), { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
    name: NAME,
    engines: { 'worca-cc-api': '>=2 <3' },
    chatChannels: [{ id: 'main', platform: 'testchat', module: './channel/worker.mjs', configSchema: SCHEMA }],
  }));
  writeFileSync(join(cur, 'channel', 'worker.mjs'), 'export function createChannelWorker() { return { start() {}, stop() {}, send() {} }; }');
  writePluginsLock({
    [NAME]: { repoUrl: 'https://example.test/f.git', subdir: '', pinnedSha: 'a'.repeat(40), version: null, enabled: true, installedAt: '2026-08-12T00:00:00.000Z' },
  });
  writePluginConfig(NAME, SCHEMA, { botToken: 'sekret', allowedChatIds: '42' });

  const server = await import('../ui/server.mjs');
  ({ runs, app } = server);
  ({ channelHost, chatActions, enqueueChatWork } = server._testing);
  channelHost.start();
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => { srv?.close(); await channelHost?.stop(); delete process.env.WORCA_MOCK; });

const lastReplyText = () => {
  const sent = mockSentMessages();
  return sent.length ? sent.at(-1).message.body.map((s) => s.value).join('\n') : null;
};

const inject = (text, chatId = '42') => {
  channelHost.injectInboundMessage(NAME, 'main', { chatId, userId: 'u1', text, meta: {} });
  // handleChatInbound is fire-and-forget async: give the promise chain a tick
  return new Promise((r) => setTimeout(r, 25));
};

test('mock channel is connected; /help round-trips through the full pipeline', async () => {
  assert.equal(channelHost.status()[0].state, 'connected');
  clearMockSentMessages();
  await inject('/help');
  assert.match(lastReplyText(), /worca-cc chat commands/);
  const sent = mockSentMessages().at(-1);
  assert.equal(sent.plugin, NAME);
  assert.equal(sent.chatId, '42', 'reply goes to the originating chat');
});

test('allowlist enforced at the server seam: unlisted chat gets NO reply', async () => {
  clearMockSentMessages();
  await inject('/help', '666');
  assert.equal(mockSentMessages().length, 0);
});

test('a live run is visible and a gate answered from chat clears pendingQuestion', async () => {
  const answered = [];
  runs.set('run-e2e-77', {
    id: 'run-e2e-77',
    orch: {
      answer: (id, payload) => answered.push([id, payload]),
      getState: () => ({ phase: 'review', totalCostUsd: 0.5, steps: [{ status: 'done' }] }),
    },
    projectDir: '/x/demo',
    title: 'E2E fixture run',
    status: 'running',
    startedAt: new Date().toISOString(),
    events: [],
    pendingQuestion: { id: 'gate-7', kind: 'gate' },
    pipelineId: 'pipe-e2e-77',
    kind: 'run',
  });
  try {
    clearMockSentMessages();
    await inject('/runs');
    assert.match(lastReplyText(), /E2E fixture run/);

    await inject('/status *e-77');
    assert.match(lastReplyText(), /waiting on you/);

    await inject('/approve *e-77');
    assert.deepEqual(answered, [['gate-7', { decision: 'continue' }]]);
    assert.equal(runs.get('run-e2e-77').pendingQuestion, null, 'resolvePending cleared the card');
    assert.match(lastReplyText(), /approved — continuing/);
  } finally {
    runs.delete('run-e2e-77');
  }
});

test('GET /api/chat/status lists channels; POST /api/chat/test needs notifyChatIds', async () => {
  const status = await (await fetch(`${base}/api/chat/status`)).json();
  assert.equal(status.channels.length, 1);
  assert.equal(status.channels[0].plugin, NAME);
  assert.equal(status.channels[0].state, 'connected');

  // no notifyChatIds configured on the fixture -> caller error 400
  const bad = await fetch(`${base}/api/chat/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plugin: NAME, channelId: 'main' }),
  });
  assert.equal(bad.status, 400);
  const missing = await fetch(`${base}/api/chat/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(missing.status, 400);
});

test('settings round-trip: chat prefs ride GET/POST /api/settings without clearing root', async () => {
  const before0 = await (await fetch(`${base}/api/settings`)).json();
  assert.deepEqual(before0.chat.notify, { done: true, error: true, question: true, paused: true });
  const posted = await (await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat: { notify: { question: false } } }),
  })).json();
  assert.equal(posted.chat.notify.question, false);
  assert.equal(posted.chat.notify.done, true);
  const after1 = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(after1.chat.notify.question, false);
  assert.equal(after1.root, before0.root, 'a chat-only POST must not clear root (legacy contract)');
  // restore
  await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat: { notify: { question: true } } }),
  });
});

test('same-chat commands execute strictly in order (batched /use then /runs)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  // monkey-patch listProjects to hold /use mid-flight (restore in finally)
  const orig = chatActions.listProjects;
  chatActions.listProjects = async () => { await gate; return [{ name: 'beta', path: '/tmp/beta' }]; };
  try {
    clearMockSentMessages();
    channelHost.injectInboundMessage(NAME, 'main', { chatId: '42', userId: 'u', text: '/use beta', meta: {} });
    channelHost.injectInboundMessage(NAME, 'main', { chatId: '42', userId: 'u', text: '/runs', meta: {} });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(mockSentMessages().length, 0, '/runs must wait behind /use');
    release();
    await new Promise((r) => setTimeout(r, 50));
    const texts = mockSentMessages().map((m) => m.message.body[0].value);
    assert.match(texts[0], /Active project: \*\*beta\*\*/);
  } finally {
    chatActions.listProjects = orig;
    channelHost.injectInboundMessage(NAME, 'main', { chatId: '42', userId: 'u', text: '/use -', meta: {} });
    await new Promise((r) => setTimeout(r, 30));
  }
});

test('a throwing handler neither kills the queue nor leaks an unhandled rejection', async () => {
  const rejections = [];
  const onUR = (err) => rejections.push(err);
  process.on('unhandledRejection', onUR);
  try {
    await enqueueChatWork('probe:1', () => { throw new Error('probe-boom'); });
    let ran = false;
    await enqueueChatWork('probe:1', () => { ran = true; });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ran, true, 'queue keeps draining after a failure');
    assert.equal(rejections.length, 0, 'no unhandled rejection escaped');
  } finally { process.off('unhandledRejection', onUR); }
});
