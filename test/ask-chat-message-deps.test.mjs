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
