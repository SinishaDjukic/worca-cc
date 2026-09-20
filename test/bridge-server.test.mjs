// test/bridge-server.test.mjs
// The in-process bridge end to end (model-bridge-design.md §4, §5, §7.4):
// a fake chat/completions upstream and a fake Anthropic-compatible upstream
// on loopback, real catalog entries with `upstream`, the real bridge server,
// and a plain HTTP client standing in for the claude CLI. Sandboxes HOME
// (settings.json) and opts into the catalog guard.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addGlobalModel, updateProvider, removeGlobalModel } from '../src/core/settings.mjs';
import { startBridge, stopBridge, bridgeSecret, bridgeBaseUrl, bridgeRunning } from '../src/core/bridge/server.mjs';
import { resolveModelEnv, bridgedModelInfo, modelHasBaseUrlRouting } from '../src/core/config.mjs';
import { bridgeCallsFor, _resetBridgeTelemetry } from '../src/core/bridge/telemetry.mjs';
import { _resetBridgeWarnings } from '../src/core/bridge/upstream.mjs';
import { _resetForTests } from '../src/core/db.mjs';

let home, worcaHome, chatSrv, chatPort, antSrv, antPort;
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK, MY_KEY: process.env.MY_KEY,
};
const seen = { chat: [], ant: [] };
let chatMode = 'text';   // what the fake upstream answers next

async function serve(handler) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, port: srv.address().port };
}
const readJson = (req) => new Promise((resolve) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => resolve(JSON.parse(s || '{}'))); });

function sse(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-bridge-home-'));
  worcaHome = await mkdtemp(join(tmpdir(), 'worca-cc-bridge-whome-'));
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = worcaHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.MY_KEY = 'sk-from-env';
  _resetForTests();

  ({ srv: chatSrv, port: chatPort } = await serve(async (req, res) => {
    const body = await readJson(req);
    seen.chat.push({ url: req.url, headers: req.headers, body });
    if (req.headers.authorization !== 'Bearer sk-from-env') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"bad key"}}'); }
    if (chatMode === 'ctx') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"maximum context length exceeded"}}'); }
    if (chatMode === '500') { res.writeHead(500); return res.end('kaput'); }
    if (chatMode === 'slow') { await new Promise((r) => setTimeout(r, 300)); }
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'plain' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
    }
    if (chatMode === 'tool') {
      return sse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'Read', arguments: '{"path":"x"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 9, completion_tokens: 4 } },
      ]);
    }
    return sse(res, [
      { choices: [{ delta: { content: 'OK' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 2 } } },
    ]);
  }));

  ({ srv: antSrv, port: antPort } = await serve(async (req, res) => {
    const body = await readJson(req);
    seen.ant.push({ url: req.url, headers: req.headers, body });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: message_start\ndata: {"type":"message_start","message":{"id":"m1","model":"' + body.model + '"}}\n\n');
    res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    res.end();
  }));

  await updateProvider('openai', { apiKey: '${MY_KEY}', baseUrl: `http://127.0.0.1:${chatPort}/v1`, maxConcurrent: 2 });
  await updateProvider('anthropic', { apiKey: 'ant-literal', baseUrl: `http://127.0.0.1:${antPort}` });
  await addGlobalModel({ id: 'gw-gpt', label: 'GPT (gw)', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-x', capabilities: { reasoning: true } }, env: { CLAUDE_CODE_FOO: '1' } });
  await addGlobalModel({ id: 'gw-claude', upstream: { provider: 'anthropic', api: 'anthropic', model: 'claude-y' } });
  await addGlobalModel({ id: 'no-key', upstream: { provider: 'openai', api: 'openai-chat', model: 'z', apiKey: '${UNSET_VAR_FOR_TEST}' } });
  await startBridge({ log: () => {} });
});

after(async () => {
  await stopBridge();
  await new Promise((r) => chatSrv.close(r));
  await new Promise((r) => antSrv.close(r));
  _resetForTests();
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await Promise.all([home, worcaHome].map((d) => rm(d, { recursive: true, force: true })));
});

const headersFor = (extra = {}) => ({ 'content-type': 'application/json', authorization: `Bearer ${bridgeSecret()}`, 'anthropic-version': '2023-06-01', ...extra });
async function callMessages(id, body, { headers = {}, tag } = {}) {
  const r = await fetch(`${bridgeBaseUrl(id, { tag })}/v1/messages`, { method: 'POST', headers: headersFor(headers), body: JSON.stringify(body) });
  return { status: r.status, text: await r.text(), headers: r.headers };
}
const parseEvents = (text) => text.split('\n\n').filter(Boolean).map((blk) => {
  const ev = blk.split('\n').find((l) => l.startsWith('event: '))?.slice(7);
  const data = blk.split('\n').find((l) => l.startsWith('data: '))?.slice(6);
  return { event: ev, data: data ? JSON.parse(data) : null };
});

test('resolveModelEnv: a bridged entry gets the loopback routing keys, its own extra env, the tier keys, and no ANTHROPIC_API_KEY', () => {
  const env = resolveModelEnv('gw-gpt', { tag: 'exec-1' });
  assert.ok(bridgeRunning());
  assert.match(env.ANTHROPIC_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+\/m\/gw-gpt\/r\/exec-1$/);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, bridgeSecret());
  assert.equal(env.ANTHROPIC_MODEL, 'gw-gpt');
  assert.equal(env.CLAUDE_CODE_FOO, '1');
  assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'gw-gpt');
  assert.equal('ANTHROPIC_API_KEY' in env, false);
  assert.equal(modelHasBaseUrlRouting('gw-gpt'), true);
  assert.deepEqual(bridgedModelInfo('gw-gpt'), { id: 'gw-gpt', provider: 'openai', api: 'openai-chat', upstreamModel: 'gpt-x', excludeTools: ['WebSearch', 'WebFetch'], ready: true });
  assert.deepEqual(bridgedModelInfo('gw-claude').excludeTools, []);
  assert.equal(bridgedModelInfo('claude-opus-4-8'), null);
});

test('resolveModelEnv: an entry-level ${VAR} key falls back to the provider key; with neither it fails fast with an auth-class error naming the fix', async () => {
  assert.equal(bridgedModelInfo('no-key').ready, true);   // provider key covers it
  await updateProvider('openai', { apiKey: null });
  try {
    assert.throws(() => resolveModelEnv('no-key'), (err) => err.errorClass === 'auth' && err.bridgeReason === 'no_key' && /\$\{VAR\}/.test(err.message));
    const info = bridgedModelInfo('no-key');
    assert.equal(info.ready, false);
    assert.equal(info.reason, 'no_key');
    assert.equal(bridgedModelInfo('gw-gpt').reason, 'no_key');
  } finally {
    await updateProvider('openai', { apiKey: '${MY_KEY}' });
  }
});

test('bridge: bad bearer → 401 envelope; unknown id → 404; unknown route → 404', async () => {
  const r = await fetch(`${bridgeBaseUrl('gw-gpt')}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer nope' }, body: '{}' });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error.type, 'authentication_error');
  const u = await callMessages('does-not-exist', { messages: [] });
  assert.equal(u.status, 404);
  const x = await fetch(`${bridgeBaseUrl('gw-gpt')}/v1/other`, { method: 'POST', headers: headersFor(), body: '{}' });
  assert.equal(x.status, 404);
});

test('bridge: openai-chat streaming → Anthropic SSE with the catalog id as model, usage mapped, call booked under the tag', async () => {
  _resetBridgeTelemetry();
  chatMode = 'text';
  const { status, text, headers } = await callMessages('gw-gpt', { model: 'gw-gpt', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hi' }] }, { tag: 'exec-7' });
  assert.equal(status, 200);
  assert.match(headers.get('content-type'), /text\/event-stream/);
  const ev = parseEvents(text);
  assert.deepEqual(ev.map((e) => e.event), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.equal(ev[0].data.message.model, 'gw-gpt');
  assert.equal(ev[2].data.delta.text, 'OK');
  assert.deepEqual(ev[4].data.usage, { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 0 });
  const up = seen.chat.at(-1);
  assert.equal(up.url, '/v1/chat/completions');
  assert.equal(up.body.model, 'gpt-x');
  assert.equal(up.body.max_completion_tokens, 10);   // reasoning capability pinned on the entry
  assert.deepEqual(bridgeCallsFor('exec-7'), { initiated: 1, continued: 0, errors: 0 });
});

test('bridge: a tool-result continuation is booked as continued, not initiated', async () => {
  _resetBridgeTelemetry();
  chatMode = 'tool';
  const body = { model: 'gw-gpt', max_tokens: 10, stream: true, messages: [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'c0', name: 'Read', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c0', content: 'x' }] },
  ], tools: [{ name: 'Read', input_schema: { type: 'object' } }] };
  const { status, text } = await callMessages('gw-gpt', body, { tag: 'exec-8' });
  assert.equal(status, 200);
  const ev = parseEvents(text);
  assert.equal(ev.find((e) => e.event === 'content_block_start').data.content_block.name, 'Read');
  assert.equal(ev.find((e) => e.event === 'message_delta').data.delta.stop_reason, 'tool_use');
  assert.deepEqual(bridgeCallsFor('exec-8'), { initiated: 0, continued: 1, errors: 0 });
});

test('bridge: non-streaming → a Messages JSON object', async () => {
  chatMode = 'text';
  const { status, text } = await callMessages('gw-gpt', { model: 'gw-gpt', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(status, 200);
  const m = JSON.parse(text);
  assert.equal(m.type, 'message');
  assert.deepEqual(m.content, [{ type: 'text', text: 'plain' }]);
  assert.equal(m.model, 'gw-gpt');
});

test('bridge: count_tokens is answered locally; /v1/models lists the entry', async () => {
  const before = seen.chat.length;
  const r = await fetch(`${bridgeBaseUrl('gw-gpt')}/v1/messages/count_tokens`, { method: 'POST', headers: headersFor(), body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(40) }] }) });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { input_tokens: 10 });
  assert.equal(seen.chat.length, before);
  const m = await fetch(`${bridgeBaseUrl('gw-gpt')}/v1/models`, { headers: headersFor() });
  assert.equal((await m.json()).data[0].id, 'gw-gpt');
});

test('bridge: a server tool → 400 invalid_request naming it; context overflow → "prompt is too long"; 500 → 502 api_error', async () => {
  chatMode = 'text';
  const st = await callMessages('gw-gpt', { model: 'gw-gpt', messages: [{ role: 'user', content: 'x' }], tools: [{ type: 'web_search_20250305', name: 'web_search' }] });
  assert.equal(st.status, 400, st.text);
  assert.match(JSON.parse(st.text).error.message, /web_search/);
  chatMode = 'ctx';
  const ctx = await callMessages('gw-gpt', { model: 'gw-gpt', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(ctx.status, 400);
  assert.equal(JSON.parse(ctx.text).error.message, 'prompt is too long');
  chatMode = '500';
  const five = await callMessages('gw-gpt', { model: 'gw-gpt', messages: [{ role: 'user', content: 'x' }] }, { tag: 'exec-e' });
  assert.equal(five.status, 502);
  assert.equal(JSON.parse(five.text).error.type, 'api_error');
  assert.equal(bridgeCallsFor('exec-e').errors, 1);
  chatMode = 'text';
});

test('bridge: not-ready provider → 401 with the fix in the message, no upstream call', async () => {
  const before = seen.chat.length;
  await updateProvider('openai', { apiKey: null });
  try {
    const r = await callMessages('no-key', { model: 'no-key', messages: [{ role: 'user', content: 'x' }] });
    assert.equal(r.status, 401, r.text);
    assert.match(JSON.parse(r.text).error.message, /not set in worca's environment/);
    assert.equal(seen.chat.length, before);
  } finally {
    await updateProvider('openai', { apiKey: '${MY_KEY}' });
  }
});

test('bridge: anthropic passthrough re-auths, rewrites model, forwards anthropic-* headers and pipes bytes', async () => {
  const { status, text } = await callMessages('gw-claude', { model: 'gw-claude', stream: true, messages: [{ role: 'user', content: 'x' }], thinking: { type: 'enabled', budget_tokens: 1024 } }, { headers: { 'anthropic-beta': 'interleaved-thinking-2025-05-14' } });
  assert.equal(status, 200);
  const up = seen.ant.at(-1);
  assert.equal(up.url, '/v1/messages');
  assert.equal(up.headers['x-api-key'], 'ant-literal');
  assert.equal(up.headers['anthropic-version'], '2023-06-01');
  assert.equal(up.headers['anthropic-beta'], 'interleaved-thinking-2025-05-14');
  assert.equal(up.headers.authorization, undefined);
  assert.equal(up.body.model, 'claude-y');
  assert.deepEqual(up.body.thinking, { type: 'enabled', budget_tokens: 1024 });
  assert.match(text, /"model":"claude-y"/);   // bytes untouched
});

test('bridge: the per-provider concurrency cap queues the third request instead of failing it', async () => {
  _resetBridgeWarnings();
  chatMode = 'slow';
  const t0 = Date.now();
  const body = { model: 'gw-gpt', max_tokens: 5, stream: true, messages: [{ role: 'user', content: 'x' }] };
  const rs = await Promise.all([1, 2, 3].map(() => callMessages('gw-gpt', body)));
  chatMode = 'text';
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]);
  assert.ok(Date.now() - t0 >= 550, 'third request waited for a slot');
});

test('catalog: removing the entry stops the bridge from serving it', async () => {
  await addGlobalModel({ id: 'tmp-bridged', upstream: { provider: 'openai', api: 'openai-chat', model: 'q' } });
  assert.equal((await callMessages('tmp-bridged', { model: 'tmp-bridged', messages: [{ role: 'user', content: 'x' }] })).status, 200);
  await removeGlobalModel('tmp-bridged');
  assert.equal((await callMessages('tmp-bridged', { model: 'tmp-bridged', messages: [{ role: 'user', content: 'x' }] })).status, 404);
});
