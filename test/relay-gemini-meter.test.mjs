// test/relay-gemini-meter.test.mjs
// The Gemini API through worca's model relay (R11): the relay meters its usageMetadata (relay-usage.mjs), so a sandbox's
// Gemini CLI, Qwen Code, Goose or OpenCode on a Gemini model books what the upstream said, never the sandbox's figure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteMeter, geminiUsage } from '../src/core/exec-env/relay-usage.mjs';

const feed = (path, text) => {
  const m = createRouteMeter();
  const r = m.reply(path);
  const buf = Buffer.from(text);
  r.push(buf.subarray(0, 7)); r.push(buf.subarray(7));
  r.end();
  return m.take();
};
const PATH = '/v1beta/models/gemini-2.5-pro:streamGenerateContent';

test('a streamed Gemini reply counts its last running usage once, cached reads apart and thinking as output', () => {
  const sse = [{ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 }, modelVersion: 'gemini-2.5-pro' },
    { usageMetadata: { promptTokenCount: 900, cachedContentTokenCount: 300, candidatesTokenCount: 50, thoughtsTokenCount: 25 }, modelVersion: 'gemini-2.5-pro' }]
    .map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join('');
  const take = feed(PATH, sse);
  assert.equal(take.messages, 1);
  assert.deepEqual(take.byModel['gemini-2.5-pro'], { input_tokens: 600, output_tokens: 75, cache_read_input_tokens: 300, cache_creation_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } });
});

test('a Gemini reply without ?alt=sse (one JSON array of chunks) and a generateContent reply count too; countTokens counts nothing', () => {
  const arr = JSON.stringify([{ usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } }, { usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 }, modelVersion: 'm' }]);
  assert.deepEqual(feed(PATH, arr).byModel.m.input_tokens, 7);
  const one = JSON.stringify({ usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 }, modelVersion: 'm' });
  assert.equal(feed('/v1beta/models/m:generateContent', one).byModel.m.output_tokens, 2);
  assert.deepEqual(feed('/v1beta/models/m:countTokens', JSON.stringify({ totalTokens: 9 })), { messages: 0, byModel: {} });
});

test('geminiUsage never counts a cached read twice or a negative input', () => {
  assert.equal(geminiUsage({ promptTokenCount: 5, cachedContentTokenCount: 9 }).input_tokens, 0);
  assert.equal(geminiUsage({ promptTokenCount: -3 }).input_tokens, 0);
});

// R11-3: a non-streamed reply made larger than the meter parses whole (a Gemini stream without ?alt=sse, a chat reply
// with logprobs) is still metered, from its tail, as the broker reads it.
test('a reply over 4 MiB is metered from its tail: a Gemini JSON array, an OpenAI chat completion, a Responses object and a Message', () => {
  const pad = 'x'.repeat(5 << 20);
  const arr = JSON.stringify([{ candidates: [{ content: { parts: [{ text: pad }] } }], modelVersion: 'gemini-2.5-pro' },
    { usageMetadata: { promptTokenCount: 70, cachedContentTokenCount: 20, candidatesTokenCount: 30, thoughtsTokenCount: 5 }, modelVersion: 'gemini-2.5-pro' }]);
  assert.deepEqual(feed(PATH, arr).byModel['gemini-2.5-pro'], { input_tokens: 50, output_tokens: 35, cache_read_input_tokens: 20,
    cache_creation_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } });
  const chat = JSON.stringify({ id: 'c', object: 'chat.completion', model: 'gpt-x', choices: [{ message: { content: pad } }], usage: { prompt_tokens: 11, completion_tokens: 900000 } });
  assert.equal(feed('/v1/chat/completions', chat).byModel['gpt-x'].output_tokens, 900000);
  const resp = JSON.stringify({ id: 'r', object: 'response', model: 'gpt-y', output: [{ content: [{ text: pad }] }], usage: { input_tokens: 3, output_tokens: 800000 } });
  assert.equal(feed('/v1/responses', resp).byModel['gpt-y'].output_tokens, 800000);
  const msg = JSON.stringify({ id: 'm', type: 'message', model: 'claude-z', content: [{ type: 'text', text: pad }], usage: { input_tokens: 4, output_tokens: 700000 } });
  assert.equal(feed('/v1/messages', msg).byModel['claude-z'].output_tokens, 700000);
});

test('a reply the relay held to a model is booked under that model ("" for the step\'s own), whatever the reply names', () => {
  const sse = `data: ${JSON.stringify({ usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 }, modelVersion: 'gemini-9-ultra' })}\n\n`;
  for (const checked of ['', 'gemini-aux']) {
    const m = createRouteMeter();
    const r = m.reply(PATH, checked); r.push(Buffer.from(sse)); r.end();
    assert.deepEqual(Object.keys(m.take().byModel), [checked]);
  }
});
