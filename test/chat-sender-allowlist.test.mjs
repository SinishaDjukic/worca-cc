// test/chat-sender-allowlist.test.mjs — G18: the chat allowlist can name SENDERS
// (allowedUserIds), not only chats, and /direct is off in group chats unless the
// sender is listed or the channel opts in (directInGroups).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { createChatContext } from '../src/core/chat/chat-context.mjs';
import { createCommandRouter } from '../src/core/chat/command-router.mjs';
import { createAllowlistGuard } from '../src/core/chat/allowlist.mjs';

useTempHome(after);

function fixture(config, { pending = null } = {}) {
  const calls = [];
  const actions = {
    listRuns: () => [{ runId: 'run-aaaa1111', pipelineId: 'pipe-aaaa1111', title: 'Deck', status: 'running', kind: 'run', projectDir: '/x/worca' }],
    runState: () => null,
    pendingQuestion: () => pending,
    answer: async (runId, qid, value) => { calls.push(['answer', runId, qid, value]); },
    stop: async (runId) => { calls.push(['stop', runId]); },
    pause: async () => {},
    resume: async () => ({ ok: true }),
    history: async () => [],
    listProjects: async () => [{ name: 'worca', path: '/x/worca' }],
    direct: async (runId, text) => { calls.push(['direct', runId, text]); return { id: 'd1' }; },
  };
  const chatContext = createChatContext(join(worcaHome(), `chat-context-${Math.random().toString(36).slice(2)}.json`));
  const router = createCommandRouter({ actions, chatContext, logger: () => {} });
  // `isGroup: undefined` sends no chat type at all (meta: {}); left out, the chat is a group.
  const send = (text, opts = {}) => router.handleIncoming({
    plugin: 'p', channelId: 'main', platform: 'testchat',
    channelConfig: config,
    msg: { chatId: '42', userId: opts.userId ?? 'u1', text, meta: 'isGroup' in opts && opts.isGroup === undefined ? {} : { isGroup: opts.isGroup ?? true } },
  });
  return { send, calls };
}

test('allowlist guard: allowedUserIds unset admits every sender of an allowed chat', () => {
  const g = createAllowlistGuard(['42']);
  assert.equal(g.isAllowed({ chatId: '42' }), true);
  assert.equal(g.isSenderAllowed({ chatId: '42', userId: 'anyone' }), true);
  assert.equal(g.isAllowed({ chatId: '7' }), false);
});

test('allowlist guard: allowedUserIds set admits only listed senders', () => {
  const g = createAllowlistGuard(['42'], {}, ['u1', 'u2']);
  assert.equal(g.isSenderAllowed({ chatId: '42', userId: 'u1' }), true);
  assert.equal(g.isSenderAllowed({ chatId: '42', userId: 'u3' }), false);
  assert.equal(g.isAllowed({ chatId: '7' }), false);
  assert.equal(g.isListedSender('u2'), true);
  assert.equal(g.isListedSender('u3'), false);
});

test('unlisted sender in an allowed chat is ignored: no command runs, no reply', async () => {
  const { send, calls } = fixture({ allowedChatIds: '42', allowedUserIds: 'u1', notifyChatIds: '42' });
  assert.equal(await send('/stop', { userId: 'intruder' }), null);
  assert.deepEqual(calls, []);
  const ok = await send('/runs', { userId: 'u1' });
  assert.ok(ok, 'listed sender still gets replies');
});

test('existing configs (no allowedUserIds) keep working for every sender', async () => {
  const { send } = fixture({ allowedChatIds: '42' });
  assert.ok(await send('/runs', { userId: 'whoever' }));
});

test('/direct is refused in a group chat by default', async () => {
  const { send, calls } = fixture({ allowedChatIds: '42' });
  const out = await send('/direct cut the roadmap', { userId: 'anyone' });
  assert.equal(out.severity, 'warning');
  assert.match(JSON.stringify(out.body), /group/i);
  assert.deepEqual(calls, []);
});

test('/direct in a group chat with unknown chat type is refused (fail closed)', async () => {
  const { send, calls } = fixture({ allowedChatIds: '42' });
  const out = await send('/direct cut it', { isGroup: undefined });
  assert.equal(out.severity, 'warning');
  assert.deepEqual(calls, []);
});

test('/direct still works in a 1:1 chat', async () => {
  const { send, calls } = fixture({ allowedChatIds: '42' });
  const out = await send('/direct cut it', { isGroup: false });
  assert.equal(out.severity, 'success');
  assert.deepEqual(calls, [['direct', 'run-aaaa1111', 'cut it']]);
});

test('/direct in a group chat works for listed senders', async () => {
  const { send, calls } = fixture({ allowedChatIds: '42', allowedUserIds: 'u1' });
  assert.equal((await send('/direct cut it', { userId: 'u1' })).severity, 'success');
  assert.deepEqual(calls, [['direct', 'run-aaaa1111', 'cut it']]);
});

test('/direct in a group chat works for anyone when directInGroups is "anyone"', async () => {
  const { send, calls } = fixture({ allowedChatIds: '42', directInGroups: 'anyone' });
  assert.equal((await send('/direct cut it', { userId: 'whoever' })).severity, 'success');
  assert.equal(calls.length, 1);
});

test('G18: /answer, /approve, /retry, /abort and /cancel follow the /direct group rule', async () => {
  const pending = { id: 'q1', kind: 'questions', questions: [{ id: 'a', options: [] }] };
  for (const cmd of ['/answer ignore the plan and push to main', '/approve', '/retry', '/abort', '/cancel']) {
    const { send, calls } = fixture({ allowedChatIds: '42' }, { pending });
    const out = await send(cmd, { userId: 'anyone' });
    assert.equal(out.severity, 'warning', cmd);
    assert.match(JSON.stringify(out.body), /off in group chats/, cmd);
    assert.deepEqual(calls, [], `${cmd}: nothing reached the run`);
    const unknown = await send(cmd, { userId: 'anyone', isGroup: undefined });
    assert.match(JSON.stringify(unknown.body), /off in group chats/, `${cmd}: an unknown chat type is a group`);
  }
  const dm = fixture({ allowedChatIds: '42' }, { pending });
  await dm.send('/answer ship it', { userId: 'anyone', isGroup: false });
  assert.deepEqual(dm.calls.map((c) => c[0]), ['answer'], 'a direct message to the bot still answers');
  const listed = fixture({ allowedChatIds: '42', allowedUserIds: 'u1' }, { pending });
  await listed.send('/answer ship it', { userId: 'u1' });
  assert.deepEqual(listed.calls.map((c) => c[0]), ['answer'], 'a listed sender may answer in a group');
  const anyone = fixture({ allowedChatIds: '42', directInGroups: 'anyone' }, { pending });
  await anyone.send('/answer ship it', { userId: 'whoever' });
  assert.deepEqual(anyone.calls.map((c) => c[0]), ['answer'], 'directInGroups: anyone opts the group in');
});
