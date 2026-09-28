// test/chat-forms-server.test.mjs — a kind:'form' ask across the SERVER seam (spec §8):
// the 'question' event reaches the chat notifier and one rendered message reaches the
// channel; /status names the form; /answer runs through chatActions.answer -> answerRun
// -> orch.answer, where a gate-3 throw (ruling X2) propagates BEFORE resolvePending, so
// the card stays open — and an accepted answer clears it. Same harness as
// test/chat-inbound-e2e.test.mjs (WORCA_MOCK=1, a fixture chat plugin, the mock channel
// host); the orchestrator is a fake because the throw semantics are P2's, pinned there.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { useTempHome } from './helpers/temp-home.mjs';
import { writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { writePluginConfig } from '../src/core/plugin-config.mjs';
import { mockSentMessages, clearMockSentMessages } from '../src/core/chat/channel-host.mjs';

process.env.WORCA_MOCK = '1';
useTempHome(after);

const NAME = 'fixture-form-chat';
const SCHEMA = [
  { key: 'botToken', type: 'text', label: 'Token', secret: true, required: true },
  { key: 'allowedChatIds', type: 'text', label: 'Allowed', secret: false, required: false },
  { key: 'notifyChatIds', type: 'text', label: 'Notify', secret: false, required: false },
];

let channelHost, chatNotifier, runs, app, srv;

before(async () => {
  const cur = pluginCurrentDir(NAME);
  mkdirSync(join(cur, 'channel'), { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
    name: NAME,
    engines: { 'worca-cc-api': '>=2 <3' },
    chatChannels: [{ id: 'main', platform: 'testchat', module: './channel/worker.mjs', configSchema: SCHEMA,
      capabilities: { inbound: true, outbound: true } }],
  }));
  writeFileSync(join(cur, 'channel', 'worker.mjs'), 'export function createChannelWorker() { return { start() {}, stop() {}, send() {} }; }');
  writePluginsLock({
    [NAME]: { repoUrl: 'https://example.test/f.git', subdir: '', pinnedSha: 'a'.repeat(40), version: null, enabled: true, installedAt: '2026-08-12T00:00:00.000Z' },
  });
  writePluginConfig(NAME, SCHEMA, { botToken: 'sekret', allowedChatIds: '42', notifyChatIds: '42' });

  const server = await import('../ui/server.mjs');
  ({ runs, app } = server);
  ({ channelHost, chatNotifier } = server._testing);
  channelHost.start();
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
});

after(async () => { srv?.close(); await channelHost?.stop(); delete process.env.WORCA_MOCK; });

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const lastReplyText = () => {
  const sent = mockSentMessages();
  return sent.length ? sent.at(-1).message.body.map((s) => s.value).join('\n') : null;
};
const inject = (text) => {
  channelHost.injectInboundMessage(NAME, 'main', { chatId: '42', userId: 'u1', text, meta: {} });
  return settle(40); // handleChatInbound is fire-and-forget async
};

/** The P2 envelope (ruling X1) as ui/server.mjs parks it in entry.pendingQuestion. */
const FORM_Q = {
  id: 'clarify-ask-n_a-1', kind: 'form', agent: 'Designer', nodeId: 'n_a', askId: 'clarify-ask-n_a-1',
  form: 'review-mockups', version: 1, title: 'Review mockups', surface: 'any',
  data: { summary: 'Two directions.', images: [] },
  layout: [{ widget: 'markdown', bind: 'data.summary' }, { widget: 'select', field: 'verdict', label: 'Verdict' }],
  answerSchema: { type: 'object', required: ['verdict'], properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'], default: 'approve' } } },
  fileRefs: [], files: [],
};

test('a form question is notified, /status names it, and /answer keeps the card open until gate 3 accepts', async () => {
  const answered = [];
  let rejectOnce = true;
  const orch = new EventEmitter();
  orch.answer = (id, payload) => {
    answered.push([id, payload]);
    if (rejectOnce) {
      rejectOnce = false;
      const err = new Error('invalid answer');
      err.code = 'INVALID_ANSWER';
      err.errors = [{ path: 'verdict', code: 'enum', message: 'must be one of approve, changes' }];
      throw err;
    }
    return true;
  };
  orch.getState = () => ({ phase: 'x', totalCostUsd: 0, steps: [] });
  orch.state = { status: 'running' };
  const entry = {
    id: 'run-e2e-form', orch, projectDir: '/x/demo', title: 'Form fixture run', status: 'running',
    startedAt: new Date().toISOString(), events: [], pendingQuestion: null, pipelineId: 'pipe-form', kind: 'run',
  };
  runs.set('run-e2e-form', entry);
  try {
    clearMockSentMessages();
    chatNotifier.attach(orch, { runId: 'run-e2e-form', entry });
    entry.pendingQuestion = FORM_Q; // what the server's own 'question' listener does
    orch.emit('question', FORM_Q);
    await settle(150);
    const notified = lastReplyText();
    assert.ok(notified, 'the notifier delivered one message to notifyChatIds');
    assert.match(notified, /\*\*Status:\*\* waiting on a form from Designer/);
    assert.match(notified, /Review mockups — Designer/);
    assert.match(notified, /Reply: \/answer \*form verdict=<value>/);

    await inject('/status *form');
    assert.match(lastReplyText(), /waiting on the `review-mockups` form — `\/answer \*form <field>=<value>`/);

    await inject('/answer *form verdict=changes');
    assert.match(lastReplyText(), /`\*form` — that answer was rejected:/);
    assert.match(lastReplyText(), /`verdict`: must be one of approve, changes/);
    assert.match(lastReplyText(), /The question is still open\./);
    assert.equal(runs.get('run-e2e-form').pendingQuestion, FORM_Q, 'a gate-3 throw propagates BEFORE resolvePending: the card stays open');

    await inject('/answer *form verdict=changes');
    assert.match(lastReplyText(), /✅ Answered the `review-mockups` form on `\*form`\./);
    assert.deepEqual(answered, [
      ['clarify-ask-n_a-1', { values: { verdict: 'changes' } }],
      ['clarify-ask-n_a-1', { values: { verdict: 'changes' } }],
    ], 'both attempts reached orch.answer as { values }');
    assert.equal(runs.get('run-e2e-form').pendingQuestion, null, 'resolvePending cleared the card');
  } finally {
    runs.delete('run-e2e-form');
  }
});
