// test/ask-run-chat-bridge.test.mjs — cross-chat messaging slice 2, the in-process adapter between a run and the
// messenger (src/core/ask/run-chat-bridge.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunChatBridge } from '../src/core/ask/run-chat-bridge.mjs';

function fakeMessenger({ enabled = true, post = null } = {}) {
  const m = { posts: [], marks: [] };
  m.enabled = () => enabled;
  m.postFromRun = async (sender, input) => { m.posts.push([{ ...sender }, input]); return post ? post(sender, input) : { ok: true, messageId: 'cmsg_00000001', conversationId: 'cxm_00000001', delivery: 'started' }; };
  m.markRunQuestion = (ref, patch) => { m.marks.push([ref, patch]); return { ok: true }; };
  return m;
}

test('post stamps liveRunId from the live entry, or null without one', async () => {
  const m = fakeMessenger();
  const live = { id: 'run-uuid-1', pipelineId: 'aaaaaaaa' };
  const b = createRunChatBridge({ messenger: m, findLiveRun: (pid) => (pid === 'aaaaaaaa' ? live : null) });
  assert.equal(b.enabled(), true);
  const r = await b.post({ pipelineId: 'aaaaaaaa', liveRunId: 'forged', title: 't', owner: null, context: null }, { chatId: 'ask_0000000b', text: 'x', intent: 'note' });
  assert.equal(r.ok, true);
  assert.equal(m.posts[0][0].liveRunId, 'run-uuid-1');
  await b.post({ pipelineId: 'bbbbbbbb', title: null, owner: null, context: null }, { chatId: 'ask_0000000b', text: 'x', intent: 'note' });
  assert.equal(m.posts[1][0].liveRunId, null);
  assert.equal(createRunChatBridge({ messenger: fakeMessenger({ enabled: false }), findLiveRun: () => null }).enabled(), false);
});

test('a throwing messenger answers CHAT_MESSAGE_ERROR and never rejects', async () => {
  const logs = [];
  const b = createRunChatBridge({ messenger: fakeMessenger({ post: () => { throw new Error('db gone'); } }), findLiveRun: () => null, log: (...a) => logs.push(a) });
  const r = await b.post({ pipelineId: 'aaaaaaaa' }, { chatId: 'ask_0000000b', text: 'x', intent: 'note' });
  assert.deepEqual(r, { ok: false, code: 'CHAT_MESSAGE_ERROR', error: 'db gone' });
  const b2 = createRunChatBridge({ messenger: fakeMessenger(), findLiveRun: () => { throw new Error('map'); } });
  assert.equal((await b2.post({ pipelineId: 'aaaaaaaa' }, {})).code, 'CHAT_MESSAGE_ERROR');
});

test('answered calls markRunQuestion exactly once with the ref and the same answers and actor', () => {
  const m = fakeMessenger();
  const b = createRunChatBridge({ messenger: m, findLiveRun: () => null });
  const ref = { chatId: 'ask_0000000b', messageId: 'cmsg_00000001', askId: 'questions-x:n:1-r1' };
  const answers = [{ id: 'q1', question: 'Q?', choice: 'A' }];
  const actedBy = { kind: 'person', label: 'ada@x' };
  b.answered(ref, { answers, actedBy });
  assert.deepEqual(m.marks, [[ref, { state: 'answered', answers, actedBy }]]);
  const t = createRunChatBridge({ messenger: { ...m, markRunQuestion: () => { throw new Error('x'); } }, findLiveRun: () => null });
  assert.doesNotThrow(() => t.answered(ref, { answers, actedBy }));
  assert.doesNotThrow(() => t.closed({ id: 'q', chat: { chatId: 'ask_0000000b', messageId: 'cmsg_00000001' } }, 'stopped'));
});

test('closed: a no-op without chat; keep reasons make no call; every other resolvePending reason closes', () => {
  const m = fakeMessenger();
  const b = createRunChatBridge({ messenger: m, findLiveRun: () => null });
  b.closed({ id: 'q1' }, 'stopped');
  b.closed(null, 'stopped');
  assert.equal(m.marks.length, 0);
  const event = { id: 'questions-x:n:1-r1', chat: { chatId: 'ask_0000000b', messageId: 'cmsg_00000001' } };
  for (const reason of ['answered', 'night-mode', 'network-back', 'resolved']) b.closed(event, reason);
  assert.equal(m.marks.length, 0, 'keep reasons never close');
  for (const reason of ['stopped', 'paused', 'error', 'done', 'interrupted']) {
    m.marks.length = 0;
    b.closed(event, reason);
    assert.deepEqual(m.marks, [[{ chatId: 'ask_0000000b', messageId: 'cmsg_00000001', askId: event.id }, { state: 'closed', reason }]], reason);
  }
  m.marks.length = 0;
  b.closed(event, undefined);
  assert.equal(m.marks.length, 0, 'no reason is the default "resolved", a keep reason');
});
