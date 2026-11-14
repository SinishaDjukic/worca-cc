// test/ask-chat-message-deps.test.mjs — Q18: the classic MCP child's cross-chat message bridge client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultChatMessageDeps } from '../src/core/ask/chat-message-deps.mjs';

const URL = 'http://127.0.0.1:4317/api/ask/chat-messages';
const env = (o = {}) => ({ WORCA_ASK_MESSAGES: JSON.stringify({ url: URL }), ASK_MESSAGE_TOKEN: 'tok-1', ...o });

test('Q18 a missing env or a non-loopback url gives no bundle', () => {
  const never = () => { throw new Error('no fetch'); };
  assert.deepEqual(defaultChatMessageDeps({ env: {}, fetchImpl: never }), {});
  assert.deepEqual(defaultChatMessageDeps({ env: env({ ASK_MESSAGE_TOKEN: '' }), fetchImpl: never }), {});
  assert.deepEqual(defaultChatMessageDeps({ env: { ASK_MESSAGE_TOKEN: 'tok-1' }, fetchImpl: never }), {});
  assert.deepEqual(defaultChatMessageDeps({ env: env({ WORCA_ASK_MESSAGES: JSON.stringify({ url: 'http://evil.example:80/x' }) }), fetchImpl: never }), {});
  assert.deepEqual(defaultChatMessageDeps({ env: env({ WORCA_ASK_MESSAGES: 'not json' }), fetchImpl: never }), {});
});

test('Q18 send posts {input} with the token header and returns the result; a refusal comes back as {ok:false, code, error}', async () => {
  const calls = [];
  let answer = { status: 200, body: { result: { ok: true, messageId: 'cmsg_00000001' } } };
  const fetchImpl = async (url, opts) => {
    calls.push([url, opts]);
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body };
  };
  const deps = defaultChatMessageDeps({ env: env(), fetchImpl });
  const input = { chatId: 'ask_0000000b', text: 'hi' };
  assert.deepEqual(await deps.chatMessages.send(input), { ok: true, messageId: 'cmsg_00000001' });
  assert.equal(calls[0][0], URL);
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers['x-worca-ask-message'], 'tok-1');
  assert.deepEqual(JSON.parse(calls[0][1].body), { input });
  answer = { status: 429, body: { error: 'Too many chat messages; wait a minute.', code: 'CHAT_MESSAGE_RATE_LIMIT' } };
  assert.deepEqual(await deps.chatMessages.send(input), { ok: false, code: 'CHAT_MESSAGE_RATE_LIMIT', error: 'Too many chat messages; wait a minute.' });
  answer = { status: 500, body: {} };
  const r = await deps.chatMessages.send(input);
  assert.equal(r.ok, false);
  assert.match(r.error, /HTTP 500/);
});

test('Q18 the bundle carries list beside send; list posts {op:\'list\', input} with the token header; a refusal comes back as {ok:false, code, error}', async () => {
  const calls = [];
  let answer = { status: 200, body: { result: { ok: true, chats: [], total: 0, offset: 0, limit: 20, nextOffset: null } } };
  const fetchImpl = async (url, opts) => {
    calls.push([url, opts]);
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body };
  };
  const deps = defaultChatMessageDeps({ env: env(), fetchImpl });
  assert.deepEqual(Object.keys(deps.chatMessages).sort(), ['list', 'send']);
  const input = { query: 'release', limit: 5 };
  assert.deepEqual(await deps.chatMessages.list(input), answer.body.result);
  assert.equal(calls[0][0], URL);
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers['x-worca-ask-message'], 'tok-1');
  assert.deepEqual(JSON.parse(calls[0][1].body), { op: 'list', input });
  answer = { status: 403, body: { error: 'Messages between chats are turned off in Settings → Chat.', code: 'CHAT_MESSAGES_OFF' } };
  assert.deepEqual(await deps.chatMessages.list({}), { ok: false, code: 'CHAT_MESSAGES_OFF', error: 'Messages between chats are turned off in Settings → Chat.' });
  answer = { status: 502, body: {} };
  assert.deepEqual(await deps.chatMessages.list({}), { ok: false, code: 'CHAT_MESSAGE_ERROR', error: 'worca answered HTTP 502' });
  // send's wire body stays exactly {input}: no op key.
  answer = { status: 200, body: { result: { ok: true } } };
  await deps.chatMessages.send({ chatId: 'ask_0000000b', text: 'hi' });
  assert.deepEqual(JSON.parse(calls.at(-1)[1].body), { input: { chatId: 'ask_0000000b', text: 'hi' } });
});
