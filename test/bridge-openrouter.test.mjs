// test/bridge-openrouter.test.mjs
// OpenRouter through the openai-chat bridge (docs/models.md › OpenRouter): the
// error body's metadata.raw reaches the message, reasoning streams become
// thinking blocks, the request carries OpenRouter's own params (usage
// accounting, unified reasoning, provider routing, fallback models) and
// attribution headers, and the reported USD cost is booked under the run's tag.
// A plain OpenAI-compatible endpoint is untouched by all of it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upstreamMessage, upstreamCode, mapUpstreamError } from '../src/core/bridge/errors.mjs';
import { classifyError } from '../src/core/recoverable-error.mjs';
import { isOpenRouter, adaptOpenRouterChatBody, OPENROUTER_HEADERS } from '../src/core/bridge/openrouter.mjs';
import { assertModelUpstream } from '../src/core/model-env.mjs';
import { toChatRequest } from '../src/core/bridge/translate/request.mjs';
import { ChatStreamTranslator } from '../src/core/bridge/translate/stream.mjs';
import { toMessagesResponse } from '../src/core/bridge/translate/response.mjs';
import { CHAT_REASONING_SIGNATURE } from '../src/core/bridge/translate/common.mjs';
import { handleMessages, _resetBridgeWarnings } from '../src/core/bridge/upstream.mjs';
import { bridgeCostFor, forgetBridgeTag, _resetBridgeTelemetry } from '../src/core/bridge/telemetry.mjs';

const RATE_LIMITED = JSON.stringify({
  error: {
    message: 'Provider returned error', code: 429,
    metadata: {
      raw: 'qwen/qwen3.8-27b:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations',
      provider_name: 'ModelRun', is_byok: false, limit_source: 'upstream_provider_shared_pool',
    },
  },
});

// ── errors (item 3) ─────────────────────────────────────────────────────────

test('upstreamMessage: OpenRouter\'s metadata.raw rides along with the generic message; plain bodies are unchanged', () => {
  const m = upstreamMessage(RATE_LIMITED);
  assert.match(m, /^Provider returned error — qwen\/qwen3\.8-27b:free is temporarily rate-limited upstream/);
  assert.equal(upstreamMessage(JSON.stringify({ error: { message: 'bad key' } })), 'bad key');
  assert.equal(upstreamMessage('plain text'), 'plain text');
  // metadata.raw may itself be a JSON string from the provider: its message is used.
  assert.equal(upstreamMessage(JSON.stringify({ error: { message: 'Provider returned error', metadata: { raw: '{"error":{"message":"model overloaded"}}' } } })),
    'Provider returned error — model overloaded');
  // Capped: a provider can put a whole HTML page in raw.
  assert.ok(upstreamMessage(JSON.stringify({ error: { message: 'x', metadata: { raw: 'y'.repeat(5000) } } })).length <= 600);
});

test('upstreamCode: a numeric code (OpenRouter\'s HTTP status) is not a machine code', () => {
  assert.equal(upstreamCode(RATE_LIMITED), '');
  assert.equal(upstreamCode(JSON.stringify({ error: { code: 'context_length_exceeded' } })), 'context_length_exceeded');
});

const HARNESS_ONLY = JSON.stringify({ error: { message: 'thinkingmachines/inkling:free is only available on agentic harnesses. Try plugging it into a coding agent or productivity app listed on https://openrouter.ai/apps', code: 403 } });

// The CLI reads ANY 403 from its endpoint as a sign-in failure ("Failed to authenticate",
// or on worca-01 "Not logged in · Please run /login") and buries the reason, so the bridge
// answers a policy refusal as a plain 400 carrying it.
test('mapUpstreamError: a 403 policy refusal reaches the CLI as a 400 that leads with the body, not an auth failure', () => {
  const e = mapUpstreamError(403, HARNESS_ONLY, { provider: 'openai' });
  assert.equal(e.status, 400, 'never a 403 to the CLI');
  assert.equal(e.body.error.type, 'invalid_request_error');
  assert.match(e.body.error.message, /^openai: refused \(403\) — thinkingmachines\/inkling:free is only available on agentic harnesses/);
  assert.doesNotMatch(e.body.error.message, /authentication/);
  assert.equal(classifyError(new Error(e.body.error.message)), null, 'permanent: never retried');
});

test('mapUpstreamError: a 403 that names the key, or has no body, is still an auth failure', () => {
  for (const body of ['', JSON.stringify({ error: { message: 'Invalid API key' } }), '{}']) {
    const e = mapUpstreamError(403, body, { provider: 'openai' });
    assert.equal(e.body.error.type, 'authentication_error', body);
    assert.match(e.body.error.message, /authentication failed \(403\)/);
  }
});

test('mapUpstreamError: a shared-pool 429 names the provider behind OpenRouter and says it is upstream', () => {
  const e = mapUpstreamError(429, RATE_LIMITED, { provider: 'openai', retryAfter: '7' });
  assert.equal(e.status, 429);
  assert.equal(e.body.error.type, 'rate_limit_error');
  assert.match(e.body.error.message, /rate limited \(429\)/);
  assert.match(e.body.error.message, /ModelRun/);
  assert.match(e.body.error.message, /rate-limited upstream/);
  assert.match(e.body.error.message, /upstream_provider_shared_pool/);
  assert.deepEqual(e.headers, { 'retry-after': '7' });
});

// ── detection + validation (item 8) ─────────────────────────────────────────

test('isOpenRouter: openrouter.ai and its subdomains only', () => {
  assert.equal(isOpenRouter('https://openrouter.ai/api/v1'), true);
  assert.equal(isOpenRouter('https://eu.openrouter.ai/api/v1/'), true);
  assert.equal(isOpenRouter('https://notopenrouter.ai/api/v1'), false);
  assert.equal(isOpenRouter('https://openrouter.ai.evil.com/v1'), false);
  assert.equal(isOpenRouter('http://127.0.0.1:8080/v1'), false);
  assert.equal(isOpenRouter(''), false);
  assert.equal(isOpenRouter(undefined), false);
});

test('assertModelUpstream: an openai entry may carry OpenRouter routing — normalized, and rejected when malformed or on another provider', () => {
  const base = { provider: 'openai', api: 'openai-chat', model: 'qwen/qwen3.8-27b:free', baseUrl: 'https://openrouter.ai/api/v1' };
  assert.deepEqual(assertModelUpstream({ ...base, openrouter: { models: [' qwen/qwen3.8-27b ', ''], provider: { order: ['ModelRun', ' Chutes '], allow_fallbacks: false, sort: 'throughput' } } }).openrouter,
    { models: ['qwen/qwen3.8-27b'], provider: { order: ['ModelRun', 'Chutes'], allow_fallbacks: false, sort: 'throughput' } });
  assert.equal(assertModelUpstream({ ...base, openrouter: {} }).openrouter, undefined, 'empty block is dropped');
  assert.equal(assertModelUpstream({ ...base, openrouter: { models: [], provider: { order: [] } } }).openrouter, undefined);
  assert.throws(() => assertModelUpstream({ ...base, openrouter: { sort: 'price' } }), /unknown upstream\.openrouter key "sort"/);
  assert.throws(() => assertModelUpstream({ ...base, openrouter: { provider: { sort: 'cheapest' } } }), /sort must be one of price \| throughput \| latency/);
  assert.throws(() => assertModelUpstream({ ...base, openrouter: { provider: { allow_fallbacks: 'no' } } }), /allow_fallbacks must be true or false/);
  assert.throws(() => assertModelUpstream({ ...base, openrouter: { models: 'a,b' } }), /models must be an array/);
  assert.throws(() => assertModelUpstream({ provider: 'anthropic', api: 'anthropic', model: 'c', openrouter: { models: ['x'] } }), /only for the openai provider/);
});

// ── request body (items 6, 7, 8) ────────────────────────────────────────────

test('adaptOpenRouterChatBody: usage accounting on, unified reasoning, max_tokens, routing + fallbacks passed through', () => {
  const chat = { model: 'm', messages: [], max_completion_tokens: 4000, reasoning_effort: 'high', stream: true, stream_options: { include_usage: true } };
  const out = adaptOpenRouterChatBody(chat, { openrouter: { models: ['m2'], provider: { order: ['A'], allow_fallbacks: true, sort: 'price' } } });
  assert.deepEqual(out.usage, { include: true });
  assert.deepEqual(out.reasoning, { effort: 'high' });
  assert.equal(out.reasoning_effort, undefined);
  assert.equal(out.max_tokens, 4000);
  assert.equal(out.max_completion_tokens, undefined);
  assert.deepEqual(out.models, ['m2']);
  assert.deepEqual(out.provider, { order: ['A'], allow_fallbacks: true, sort: 'price' });
  assert.equal(chat.reasoning_effort, 'high', 'input not mutated');
  const plain = adaptOpenRouterChatBody({ model: 'm', messages: [], max_tokens: 10 }, {});
  assert.deepEqual(plain, { model: 'm', messages: [], max_tokens: 10, usage: { include: true } });
});

test('attribution headers name Worca, its title and at most two known categories', () => {
  assert.deepEqual(OPENROUTER_HEADERS, {
    'HTTP-Referer': 'https://worca.dev',
    'X-Title': 'Worca',
    'X-OpenRouter-Title': 'Worca',
    'X-OpenRouter-Categories': 'cloud-agent,cli-agent',
  });
  assert.ok(OPENROUTER_HEADERS['X-OpenRouter-Categories'].split(',').length <= 2);
});

// ── reasoning → thinking (item 7) ───────────────────────────────────────────

const kinds = (events) => events.map((e) => (e.event === 'content_block_start' ? `start:${e.data.content_block.type}`
  : e.event === 'content_block_delta' ? `delta:${e.data.delta.type}` : e.event));

test('stream: delta.reasoning becomes a thinking block that closes (with our signature) before the text starts', () => {
  const t = new ChatStreamTranslator({ model: 'or-qwen' });
  const ev = [
    ...t.push({ choices: [{ delta: { reasoning: 'Let me ', reasoning_details: [{ type: 'reasoning.text', text: 'Let me ' }] } }] }),
    ...t.push({ choices: [{ delta: { reasoning: 'think.' } }] }),
    ...t.push({ choices: [{ delta: { content: 'Hi' } }] }),
    ...t.push({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    ...t.finish(),
  ];
  assert.deepEqual(kinds(ev), ['message_start', 'start:thinking', 'delta:thinking_delta', 'delta:thinking_delta', 'delta:signature_delta',
    'content_block_stop', 'start:text', 'delta:text_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  const thinking = ev.filter((e) => e.data.delta?.type === 'thinking_delta').map((e) => e.data.delta.thinking).join('');
  assert.equal(thinking, 'Let me think.', 'reasoning_details is not double-counted when reasoning is present');
  assert.equal(ev.find((e) => e.data.delta?.type === 'signature_delta').data.delta.signature, CHAT_REASONING_SIGNATURE);
  assert.equal(ev.find((e) => e.event === 'content_block_start' && e.data.content_block.type === 'text').data.index, 1);
});

test('stream: reasoning_content (vLLM/DeepSeek) and reasoning_details-only chunks map too; a tool call closes thinking first', () => {
  const t = new ChatStreamTranslator({ model: 'x' });
  const ev = [
    ...t.push({ choices: [{ delta: { reasoning_content: 'a' } }] }),
    ...t.push({ choices: [{ delta: { reasoning: null, reasoning_details: [{ type: 'reasoning.summary', summary: 'b' }, { type: 'reasoning.encrypted', data: 'zz' }] } }] }),
    ...t.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'Read', arguments: '{}' } }] } }] }),
    ...t.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
    ...t.finish(),
  ];
  assert.deepEqual(kinds(ev), ['message_start', 'start:thinking', 'delta:thinking_delta', 'delta:thinking_delta', 'delta:signature_delta',
    'content_block_stop', 'start:tool_use', 'delta:input_json_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.equal(ev.at(-2).data.delta.stop_reason, 'tool_use');
});

test('stream: usage.cost is kept for the bridge to book', () => {
  const t = new ChatStreamTranslator({ model: 'x' });
  t.push({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] });
  t.push({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.00042 } });
  t.finish();
  assert.equal(t.costUsd, 0.00042);
  const t2 = new ChatStreamTranslator({ model: 'x' });
  t2.push({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  assert.equal(t2.costUsd, null);
});

test('buffered: message.reasoning becomes a leading thinking block', () => {
  const r = toMessagesResponse({ choices: [{ message: { role: 'assistant', content: 'Hi', reasoning: 'hmm' }, finish_reason: 'stop' }] }, { model: 'x' });
  assert.deepEqual(r.content, [{ type: 'thinking', thinking: 'hmm', signature: CHAT_REASONING_SIGNATURE }, { type: 'text', text: 'Hi' }]);
  const plain = toMessagesResponse({ choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }] }, { model: 'x' });
  assert.deepEqual(plain.content, [{ type: 'text', text: 'Hi' }]);
});

test('request: our own chat thinking blocks are dropped silently on replay; a foreign thinking block still warns', () => {
  const body = (sig) => ({
    max_tokens: 100,
    messages: [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm', signature: sig }, { type: 'text', text: 'a' }] },
      { role: 'user', content: 'q2' },
    ],
  });
  const ours = toChatRequest(body(CHAT_REASONING_SIGNATURE), { upstreamModel: 'm' });
  assert.deepEqual(ours.warnings, []);
  assert.deepEqual(ours.body.messages[1], { role: 'assistant', content: 'a' });
  const foreign = toChatRequest(body('EqQBCkYIBxgCKkB...'), { upstreamModel: 'm' });
  assert.deepEqual(foreign.warnings, ['thinking']);
});

// ── end to end through handleMessages (items 6, 8, 9) ───────────────────────

let home;
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-openrouter-'));
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(home, { recursive: true, force: true });
});

function fakeReply() {
  const r = { statusCode: 0, headers: null, chunks: [], body: null, ended: false };
  return Object.assign(r, {
    status(code, headers) { r.statusCode = code; r.headers = headers; },
    write(c) { r.chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString()); },
    end() { r.ended = true; },
    json(status, obj, headers) { r.statusCode = status; r.body = obj; r.headers = headers || null; r.ended = true; },
  });
}
function sseResponse(chunks) {
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const entryFor = (baseUrl, extra = {}) => ({
  id: 'or-qwen',
  upstream: { provider: 'openai', api: 'openai-chat', model: 'qwen/qwen3.8-27b', baseUrl, apiKey: 'sk-test', capabilities: { reasoning: true }, ...extra },
});

test('handleMessages → OpenRouter: attribution headers, OpenRouter body params, reasoning as thinking, cost booked under the tag', async () => {
  _resetBridgeTelemetry(); _resetBridgeWarnings();
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return sseResponse([
      { choices: [{ delta: { reasoning: 'thinking…' } }] },
      { choices: [{ delta: { content: 'OK' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.0015 } },
    ]);
  };
  const entry = entryFor('https://openrouter.ai/api/v1', { openrouter: { models: ['qwen/qwen3.8-27b:free'], provider: { sort: 'throughput' } } });
  const body = { model: 'or-qwen', max_tokens: 500, stream: true, output_config: { effort: 'medium' }, messages: [{ role: 'user', content: 'hi' }] };
  const reply = fakeReply();
  await handleMessages({ entry, body, tag: 'exec-or', fetch, log: () => {} }, reply);
  assert.equal(reply.statusCode, 200);
  assert.equal(seen[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(seen[0].headers['HTTP-Referer'], 'https://worca.dev');
  assert.equal(seen[0].headers['X-Title'], 'Worca');
  assert.equal(seen[0].headers.authorization, 'Bearer sk-test');
  assert.deepEqual(seen[0].body.usage, { include: true });
  assert.deepEqual(seen[0].body.reasoning, { effort: 'medium' });
  assert.deepEqual(seen[0].body.models, ['qwen/qwen3.8-27b:free']);
  assert.deepEqual(seen[0].body.provider, { sort: 'throughput' });
  const out = reply.chunks.join('');
  assert.match(out, /"type":"thinking"/);
  assert.match(out, /thinking…/);
  assert.deepEqual(bridgeCostFor('exec-or'), { costUsd: 0.0015, calls: 1 });

  // A second (buffered) call on the same tag accumulates.
  const fetch2 = async () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0005 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  await handleMessages({ entry, body: { ...body, stream: false }, tag: 'exec-or', fetch: fetch2, log: () => {} }, fakeReply());
  assert.deepEqual(bridgeCostFor('exec-or'), { costUsd: 0.002, calls: 2 });
  forgetBridgeTag('exec-or');
  assert.equal(bridgeCostFor('exec-or'), null);
});

test('handleMessages → a plain OpenAI-compatible endpoint: no OpenRouter headers or params, routing options ignored', async () => {
  _resetBridgeTelemetry(); _resetBridgeWarnings();
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return sseResponse([{ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] }]);
  };
  const entry = entryFor('https://gateway.example.com/v1', { openrouter: { models: ['x'] } });
  await handleMessages({ entry, body: { model: 'or-qwen', max_tokens: 50, stream: true, output_config: { effort: 'high' }, messages: [{ role: 'user', content: 'hi' }] }, tag: 'exec-plain', fetch, log: () => {} }, fakeReply());
  assert.equal(seen[0].headers['HTTP-Referer'], undefined);
  assert.equal(seen[0].headers['X-Title'], undefined);
  assert.equal(seen[0].body.usage, undefined);
  assert.equal(seen[0].body.models, undefined);
  assert.equal(seen[0].body.reasoning, undefined);
  assert.equal(seen[0].body.reasoning_effort, 'high');
  assert.equal(bridgeCostFor('exec-plain'), null);
});

test('handleMessages → OpenRouter 429: the mapped error carries the explanation and retry-after', async () => {
  _resetBridgeTelemetry(); _resetBridgeWarnings();
  const fetch = async () => new Response(RATE_LIMITED, { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '3' } });
  const reply = fakeReply();
  await handleMessages({ entry: entryFor('https://openrouter.ai/api/v1'), body: { model: 'or-qwen', max_tokens: 5, messages: [{ role: 'user', content: 'x' }] }, tag: 'exec-429', fetch, log: () => {} }, reply);
  assert.equal(reply.statusCode, 429);
  assert.match(reply.body.error.message, /rate-limited upstream/);
  assert.deepEqual(reply.headers, { 'retry-after': '3' });
});
