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

// ── slice 3: a run question answered from a chat's channel thread (answerFromChat) ───────────────────────────────
const CHAT = 'ask_0000000b';
const MSG = 'cmsg_00000001';
const ASK = 'questions-x:n:1-r1';
const runBlock = (over = {}, q = {}) => ({ kind: 'chat-message', id: MSG, direction: 'in', intent: 'question',
  from: { kind: 'run', runId: 'aaaaaaaa', liveRunId: 'old-uuid', title: 't', scope: null, owner: null },
  question: { askId: ASK, kind: 'questions', questions: [{ id: 'q1', question: 'Ship?', options: ['Yes', 'No'], allowFreeText: true }], state: 'open', answer: null, ...q },
  ...over });
function answerWorld({ block = runBlock(), live = { id: 'run-uuid-2', pipelineId: 'aaaaaaaa', pendingQuestion: { id: ASK } }, answerRun } = {}) {
  const calls = [];
  const m = fakeMessenger();
  m.readIncoming = (chatId, messageId) => (chatId === CHAT && block && messageId === block.id ? structuredClone(block) : null);
  const lookups = [];
  const b = createRunChatBridge({ messenger: m, findLiveRun: (pid) => { lookups.push(pid); return live && pid === live.pipelineId ? live : null; },
    answerRun: answerRun === undefined ? (...a) => { calls.push(a); } : answerRun });
  const press = (choices, messageId = MSG) => b.answerFromChat({ chatId: CHAT, messageId, choices, by: 'ada via Discord' });
  return { b, calls, lookups, press };
}

test('R1 an open question with a waiting run answers through answerRun once, with the person', () => {
  const w = answerWorld();
  const r = w.press([{ index: 0, value: '0' }]);
  assert.deepEqual(r, { status: 200, body: { ok: true } });
  assert.deepEqual(w.calls, [['run-uuid-2', ASK, { answers: [{ id: 'q1', choice: 'Yes' }] }, 'ada via Discord']]);
  const t = answerWorld();
  assert.equal(t.press([{ index: 0, text: '  ship friday  ' }]).status, 200);
  assert.equal(t.calls[0][2].answers[0].choice, 'ship friday', 'a typed answer is trimmed');
});

test('R2 an unknown message or a chat (not run) message is 404', () => {
  const w = answerWorld();
  assert.equal(w.press([{ index: 0, value: '0' }], 'cmsg_ffffffff').body.code, 'CHAT_QUESTION_NOT_FOUND');
  const chat = answerWorld({ block: runBlock({ from: { kind: 'chat', chatId: 'ask_0000000a' }, question: undefined }) });
  const r = chat.press([{ index: 0, value: '0' }]);
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { code: 'CHAT_QUESTION_NOT_FOUND', error: 'This question is no longer in the chat.' });
  const note = answerWorld({ block: runBlock({ question: undefined }) });
  assert.equal(note.press([{ index: 0, value: '0' }]).status, 404);
  assert.equal(w.calls.length + chat.calls.length + note.calls.length, 0);
});

test('R3 an answered or closed record is 409 and never reaches answerRun', () => {
  for (const state of ['answered', 'closed']) {
    const w = answerWorld({ block: runBlock({}, { state }) });
    const r = w.press([{ index: 0, value: '0' }]);
    assert.equal(r.status, 409, state);
    assert.deepEqual(r.body, { code: 'CHAT_QUESTION_CLOSED', error: 'This question was already answered or closed.' });
    assert.equal(w.calls.length, 0);
  }
});

test('R4 the live run is found by pipeline id (a resumed run has a new id); no live run or another pending question is 409', () => {
  const w = answerWorld();
  w.press([{ index: 0, value: '1' }]);
  assert.deepEqual(w.lookups, ['aaaaaaaa'], 'by from.runId, never from.liveRunId');
  assert.equal(w.calls[0][0], 'run-uuid-2');
  for (const live of [null, { id: 'run-uuid-2', pipelineId: 'aaaaaaaa', pendingQuestion: null }, { id: 'run-uuid-2', pipelineId: 'aaaaaaaa', pendingQuestion: { id: 'questions-x:n:1-r2' } }]) {
    const x = answerWorld({ live });
    const r = x.press([{ index: 0, value: '0' }]);
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { code: 'CHAT_QUESTION_CLOSED', error: 'The run is no longer waiting for this answer.' });
    assert.equal(x.calls.length, 0);
  }
});

test('R5 a bad answer is 400; an answer the run refuses is 422 with its errors on one clipped line; any other throw is 500', () => {
  const bad = { code: 'CHAT_QUESTION_BAD_ANSWER', error: 'Answer every question.' };
  for (const choices of [[{ index: 0, value: '2' }], [{ index: 0, value: 'x' }], [{ index: 0, value: '-1' }], [{ index: 0, text: '   ' }], [{ index: 1, value: '0' }], [], null]) {
    const w = answerWorld();
    const r = w.press(choices);
    assert.deepEqual(r, { status: 400, body: bad }, JSON.stringify(choices));
    assert.equal(w.calls.length, 0);
  }
  const two = answerWorld({ block: runBlock({}, { questions: [{ id: 'q1', question: 'A?', options: [] }, { id: 'q2', question: 'B?', options: [] }] }) });
  assert.deepEqual(two.press([{ index: 0, text: 'x' }]), { status: 400, body: bad });
  const thrower = (err) => answerWorld({ answerRun: () => { throw err; } });
  const inv = thrower(Object.assign(new Error('invalid answer'), { code: 'INVALID_ANSWER', errors: ['bad'] })).press([{ index: 0, value: '0' }]);
  assert.equal(inv.status, 422);
  assert.equal(inv.body.code, 'CHAT_QUESTION_INVALID');
  assert.equal(inv.body.error, 'That answer was not accepted: bad');
  const objs = thrower(Object.assign(new Error('invalid answer'), { code: 'INVALID_ANSWER', errors: [{ path: 'q1', code: 'enum', message: 'not an option' }] })).press([{ index: 0, value: '0' }]);
  assert.match(objs.body.error, /not an option/);
  const long = thrower(Object.assign(new Error('x'), { code: 'INVALID_ANSWER', errors: Array.from({ length: 10 }, () => `${'e'.repeat(95)}\nline`) })).press([{ index: 0, value: '0' }]);
  assert.ok(long.body.error.length <= 330, String(long.body.error.length));
  assert.ok(!/[\r\n]/.test(long.body.error));
  const other = thrower(new Error('unknown runId')).press([{ index: 0, value: '0' }]);
  assert.deepEqual(other, { status: 500, body: { error: 'unknown runId' } });
});

test('R6 without answerRun the bridge cannot answer', () => {
  const w = answerWorld({ answerRun: null });
  assert.deepEqual(w.press([{ index: 0, value: '0' }]), { status: 500, body: { error: 'answering is unavailable' } });
});
