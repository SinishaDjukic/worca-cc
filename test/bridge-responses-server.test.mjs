// test/bridge-responses-server.test.mjs
// The bridge end to end for the OpenAI Responses API
// (2026-09-23-bridge-openai-responses-design.md §10): a fake upstream on
// loopback serving /responses (and a /chat/completions that refuses the model
// the way Copilot does), catalog entries through the OpenAI-compatible
// provider and through Copilot (GitHub's token exchange stubbed via the
// bridge's injected fetch), the real bridge server, and a plain HTTP client
// standing in for the claude CLI. Sandboxes HOME (settings.json) + WORCA_HOME.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addGlobalModel, updateProvider, acknowledgeCopilotTerms } from '../src/core/settings.mjs';
import { startBridge, stopBridge, bridgeSecret, bridgeBaseUrl } from '../src/core/bridge/server.mjs';
import { bridgeEvents, bridgeCallsFor, _resetBridgeTelemetry } from '../src/core/bridge/telemetry.mjs';
import { _resetCopilotCache } from '../src/core/bridge/providers/copilot.mjs';
import { encodeReasoningMarker } from '../src/core/bridge/translate/common.mjs';
import { _resetForTests } from '../src/core/db.mjs';

let home, worcaHome, srv, port;
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK, MY_KEY: process.env.MY_KEY,
};
const seen = [];
const realFetch = globalThis.fetch;
const readJson = (req) => new Promise((resolve) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => resolve(JSON.parse(s || '{}'))); });

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();   // no [DONE]: a Responses stream just ends
}
const REASONING_TOOL = [
  { type: 'response.created', response: { status: 'in_progress' } },
  { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', encrypted_content: 'PRE', summary: [] } },
  { type: 'response.reasoning_summary_text.delta', output_index: 0, item_id: 'r1', delta: 'thinking it over' },
  { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', encrypted_content: 'ENC', summary: [{ type: 'summary_text', text: 'thinking it over' }] } },
  { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', call_id: 'call_1', name: 'Read', arguments: '' } },
  { type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'r2', delta: '{"p":"a"}' },
  { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', call_id: 'call_1', name: 'Read', arguments: '{"p":"a"}', status: 'completed' } },
  { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 12, input_tokens_details: { cached_tokens: 2 }, output_tokens: 5 } } },
];
const FAILED = [
  { type: 'response.created', response: { status: 'in_progress' } },
  { type: 'response.failed', response: { status: 'failed', error: { code: 'server_error', message: 'model overloaded' } } },
];
const OVERFLOW = [
  { type: 'response.created', response: { status: 'in_progress' } },
  { type: 'response.failed', response: { status: 'failed', error: { code: 'context_length_exceeded', message: 'Your input exceeds the context window of this model. Please adjust your input and try again.' } } },
];
let respMode = 'reasoning-tool';   // what the fake /responses answers next

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-bresp-home-'));
  worcaHome = await mkdtemp(join(tmpdir(), 'worca-cc-bresp-whome-'));
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = worcaHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.MY_KEY = 'sk-from-env';
  _resetForTests();
  _resetCopilotCache();

  srv = http.createServer(async (req, res) => {
    const body = await readJson(req);
    seen.push({ url: req.url, headers: req.headers, body });
    if (req.url.endsWith('/chat/completions')) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: `model "${body.model}" is not accessible via the /chat/completions endpoint`, code: 'unsupported_api_for_model' } }));
    }
    if (!req.url.endsWith('/responses')) { res.writeHead(404); return res.end('{}'); }
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      // A server_error whose words sound like an overflow ("too long") — it must stay a 502.
      if (respMode === 'failed') return res.end(JSON.stringify({ status: 'failed', error: { code: 'server_error', message: 'the model took too long to respond' }, output: [] }));
      if (respMode === 'overflow') return res.end(JSON.stringify({ status: 'failed', error: { code: 'context_length_exceeded', message: 'Your input exceeds the context window of this model.' }, output: [] }));
      return res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'plain' }] }], usage: { input_tokens: 3, output_tokens: 1 } }));
    }
    return sse(res, respMode === 'failed' ? FAILED : respMode === 'overflow' ? OVERFLOW : REASONING_TOOL);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;

  await updateProvider('openai', { apiKey: '${MY_KEY}', baseUrl: `http://127.0.0.1:${port}/v1` });
  await updateProvider('copilot', { githubToken: 'gho_test' });
  await acknowledgeCopilotTerms();
  await addGlobalModel({ id: 'oa-resp', upstream: { provider: 'openai', api: 'openai-responses', model: 'gpt-r', capabilities: { reasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh'] } } });
  await addGlobalModel({ id: 'oa-chat-legacy', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-r' } });
  await addGlobalModel({ id: 'copilot-gpt-r', upstream: { provider: 'copilot', api: 'openai-responses', model: 'gpt-r', capabilities: { reasoning: true } } });
  // The bridge's fetch: GitHub's token exchange names the loopback stub as the
  // Copilot API host; every other call really goes out (to the stub).
  await startBridge({
    log: () => {},
    fetch: async (url, init) => {
      if (/copilot_internal\/v2\/token$/.test(String(url))) {
        return new Response(JSON.stringify({ token: 'cp_t', expires_at: Math.floor(Date.now() / 1000) + 1800, endpoints: { api: `http://127.0.0.1:${port}` } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return realFetch(url, init);
    },
  });
});

after(async () => {
  await stopBridge();
  await new Promise((r) => srv.close(r));
  _resetForTests();
  _resetCopilotCache();
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await Promise.all([home, worcaHome].map((d) => rm(d, { recursive: true, force: true })));
});

const headersFor = () => ({ 'content-type': 'application/json', authorization: `Bearer ${bridgeSecret()}`, 'anthropic-version': '2023-06-01' });
async function callMessages(id, body, { tag } = {}) {
  const r = await fetch(`${bridgeBaseUrl(id, { tag })}/v1/messages`, { method: 'POST', headers: headersFor(), body: JSON.stringify(body) });
  return { status: r.status, text: await r.text() };
}
const parseEvents = (text) => text.split('\n\n').filter(Boolean).map((blk) => {
  const ev = blk.split('\n').find((l) => l.startsWith('event: '))?.slice(7);
  const data = blk.split('\n').find((l) => l.startsWith('data: '))?.slice(6);
  return { event: ev, data: data ? JSON.parse(data) : null };
});

test('openai-responses streaming: the upstream gets a Responses body (reasoning replayed, effort mapped); the CLI gets Anthropic SSE with the marker as signature', async () => {
  _resetBridgeTelemetry();
  seen.length = 0;
  const { status, text } = await callMessages('oa-resp', {
    model: 'oa-resp', max_tokens: 32000, stream: true, output_config: { effort: 'max' }, thinking: { type: 'adaptive' },
    system: [{ type: 'text', text: 'You are a coding agent.' }],
    tools: [{ name: 'Read', input_schema: { type: 'object', properties: { p: { type: 'string' } } } }],
    messages: [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'earlier', signature: encodeReasoningMarker('gpt-r', 'PRIOR') }, { type: 'tool_use', id: 'toolu_0', name: 'Read', input: { p: 'z' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_0', content: 'zzz' }] },
    ],
  }, { tag: 'exec-r' });
  assert.equal(status, 200, text);
  const up = seen.at(-1);
  assert.equal(up.url, '/v1/responses');
  assert.equal(up.headers.authorization, 'Bearer sk-from-env');
  assert.equal(up.body.model, 'gpt-r');
  assert.equal(up.body.store, false);
  assert.equal(up.body.stream, true);
  assert.equal(up.body.instructions, 'You are a coding agent.');
  assert.deepEqual(up.body.reasoning, { summary: 'auto', effort: 'xhigh' });
  assert.deepEqual(up.body.include, ['reasoning.encrypted_content']);
  assert.deepEqual(up.body.input.map((i) => i.type || i.role), ['user', 'reasoning', 'function_call', 'function_call_output']);
  assert.equal(up.body.input[1].encrypted_content, 'PRIOR');
  assert.equal('messages' in up.body, false);
  const ev = parseEvents(text);
  assert.deepEqual(ev.map((e) => e.event), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_delta', 'content_block_stop', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.equal(ev[0].data.message.model, 'oa-resp');
  assert.equal(ev[1].data.content_block.type, 'thinking');
  assert.equal(ev[3].data.delta.signature, encodeReasoningMarker('gpt-r', 'ENC'));
  assert.deepEqual(ev[5].data.content_block, { type: 'tool_use', id: 'call_1', name: 'Read', input: {} });
  assert.equal(ev[8].data.delta.stop_reason, 'tool_use');
  assert.deepEqual(ev[8].data.usage, { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 0 });
  assert.deepEqual(bridgeCallsFor('exec-r'), { initiated: 0, continued: 1, errors: 0 });
});

test('openai-responses non-streaming → a Messages JSON object; max_output_tokens floored at 16', async () => {
  const { status, text } = await callMessages('oa-resp', { model: 'oa-resp', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(status, 200, text);
  const j = JSON.parse(text);
  assert.equal(j.type, 'message');
  assert.equal(j.model, 'oa-resp');
  assert.deepEqual(j.content, [{ type: 'text', text: 'plain' }]);
  assert.equal(j.stop_reason, 'end_turn');
  assert.equal(seen.at(-1).body.max_output_tokens, 16);
});

test('copilot + openai-responses: POST <copilot host>/responses with the Copilot token and editor headers', async () => {
  seen.length = 0;
  const { status, text } = await callMessages('copilot-gpt-r', { model: 'copilot-gpt-r', max_tokens: 100, stream: true, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(status, 200, text);
  const up = seen.at(-1);
  assert.equal(up.url, '/responses');
  assert.equal(up.headers.authorization, 'Bearer cp_t');
  assert.equal(up.headers['copilot-integration-id'], 'vscode-chat');
  assert.equal(up.headers['x-initiator'], 'user');
  assert.equal(up.body.model, 'gpt-r');
  assert.deepEqual(up.body.reasoning, { summary: 'auto' });
  assert.equal(parseEvents(text).at(-1).event, 'message_stop');
});

test('a model the upstream serves only through the other API → 400 naming the fix, and a bridge failure event carrying it', async () => {
  const failures = [];
  const onFailure = (e) => failures.push(e);
  bridgeEvents.on('failure', onFailure);
  try {
    const { status, text } = await callMessages('oa-chat-legacy', { model: 'oa-chat-legacy', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(status, 400);
    const j = JSON.parse(text);
    assert.equal(j.error.type, 'invalid_request_error');
    assert.equal(j.error.message, 'openai: model "gpt-r" is not accessible via the /chat/completions endpoint — this model needs a different API: change its API in the model editor');
    assert.equal(failures.length, 1);
    assert.equal(failures[0].catalogId, 'oa-chat-legacy');
    assert.equal(failures[0].message, j.error.message);
  } finally {
    bridgeEvents.off('failure', onFailure);
  }
});

test('openai-responses: a stream that fails mid-flight ends in an SSE error and is booked as a bridge failure (the Test button reads it)', async () => {
  const failures = [];
  const onFailure = (e) => failures.push(e);
  bridgeEvents.on('failure', onFailure);
  respMode = 'failed';
  try {
    const { status, text } = await callMessages('oa-resp', { model: 'oa-resp', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(status, 200);
    const ev = parseEvents(text);
    assert.equal(ev.at(-1).event, 'error');
    assert.equal(ev.at(-1).data.error.message, 'upstream stream error: model overloaded');
    assert.deepEqual(failures.map((f) => [f.catalogId, f.message]), [['oa-resp', 'upstream stream error: model overloaded']]);
  } finally {
    respMode = 'reasoning-tool';
    bridgeEvents.off('failure', onFailure);
  }
});

test('openai-responses: a context overflow — streamed or buffered — reaches the CLI as "prompt is too long"; a failed buffered body is an error, not an empty answer (and not an overflow because it says "too long")', async () => {
  const failures = [];
  const onFailure = (e) => failures.push([e.catalogId, e.message]);
  bridgeEvents.on('failure', onFailure);
  try {
    respMode = 'overflow';
    const streamed = await callMessages('oa-resp', { model: 'oa-resp', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(streamed.status, 200);
    assert.deepEqual(parseEvents(streamed.text).at(-1).data, { type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long' } });
    const buffered = await callMessages('oa-resp', { model: 'oa-resp', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(buffered.status, 400);
    assert.equal(JSON.parse(buffered.text).error.message, 'prompt is too long');
    respMode = 'failed';
    const failed = await callMessages('oa-resp', { model: 'oa-resp', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(failed.status, 502);
    assert.deepEqual(JSON.parse(failed.text).error, { type: 'api_error', message: 'openai: upstream error — the model took too long to respond' });
    assert.deepEqual(failures, [['oa-resp', 'prompt is too long'], ['oa-resp', 'prompt is too long'], ['oa-resp', 'openai: upstream error — the model took too long to respond']]);
  } finally {
    respMode = 'reasoning-tool';
    bridgeEvents.off('failure', onFailure);
  }
});

test('openai-responses: a server tool → 400 naming it and the bridge; nothing reaches the upstream', async () => {
  const before = seen.length;
  const { status, text } = await callMessages('oa-resp', { model: 'oa-resp', messages: [{ role: 'user', content: 'x' }], tools: [{ type: 'web_search_20250305', name: 'web_search' }] });
  assert.equal(status, 400);
  assert.match(JSON.parse(text).error.message, /"web_search" is an Anthropic server tool .*\(openai-responses bridge\)/);
  assert.equal(seen.length, before);
});
