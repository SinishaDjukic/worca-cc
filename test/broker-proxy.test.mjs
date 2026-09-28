// test/broker-proxy.test.mjs
// The credential broker end to end over HTTP, against a fake provider
// (plans/credential-broker-design.html §8.2): the internal API, the proxy's
// guarantees K2–K4, streaming, limits and usage.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { readBrokerConfig } from '../src/broker/config.mjs';
import { builtinSlots, mergeSlots } from '../src/broker/slots.mjs';
import { startBroker } from '../src/broker/main.mjs';
import { startFakeUpstream, GOOD_KEY } from './helpers/fake-model-upstream.mjs';

const SECRET = 's'.repeat(48);
let up; let broker; let base;

before(async () => {
  up = await startFakeUpstream();
  const { config, errors } = readBrokerConfig({
    WORCA_BROKER_MODE: 'single', WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_HOST: '127.0.0.1',
    WORCA_BROKER_PORT: '0', WORCA_BROKER_UI_PORT: '1', WORCA_BROKER_KEY_ANTHROPIC: GOOD_KEY,
    WORCA_BROKER_KEY_OPENROUTER: GOOD_KEY, WORCA_BROKER_DEFAULT_DAILY_USD: '1',
  });
  assert.deepEqual(errors, []);
  const slots = mergeSlots(builtinSlots(), [{ id: 'anthropic', upstream: up.url }, { id: 'openrouter', upstream: up.url }]);
  broker = await startBroker({ config: { ...config, port: 0 }, slots, log: () => {} });
  base = `http://127.0.0.1:${broker.ports.private}`;
});
after(async () => { await broker?.close(); await up?.close(); });

async function internal(method, path, body, secret = SECRET) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { authorization: `Bearer ${secret}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

let spawnSeq = 0;
async function mint(extra = {}) {
  const r = await internal('POST', '/internal/tokens', { billTo: 'local', slots: ['anthropic'], spawnId: `sp-${++spawnSeq}`, kind: 'phase', issuer: 'srv-test', ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { token: r.body.token, spawnId: `sp-${spawnSeq}` };
}

function messages(token, { stream = false, headers = {}, path = '/p/anthropic/v1/messages?beta=true' } = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 10, stream, messages: [{ role: 'user', content: 'hi' }] }),
  });
}

test('internal API: the wrong secret is refused; info lists slots and mode', async () => {
  assert.equal((await internal('GET', '/internal/info', null, 'wrong')).status, 401);
  const r = await internal('GET', '/internal/info');
  assert.equal(r.body.mode, 'single');
  assert.ok(r.body.slots.some((s) => s.id === 'anthropic'));
});

test('proxy: the upstream gets the real key and only allowlisted headers; the agent\'s own auth never passes', async () => {
  const { token } = await mint();
  up.requests.length = 0;
  const res = await messages(token, { headers: { 'x-api-key': token, cookie: 'a=b', 'x-forwarded-host': 'evil.example', 'x-stainless-lang': 'js', 'anthropic-beta': 'b1' } });
  assert.equal(res.status, 200);
  const got = up.requests.at(-1);
  assert.equal(got.url, '/v1/messages?beta=true');
  assert.equal(got.headers['x-api-key'], GOOD_KEY);
  assert.equal(got.headers.authorization, undefined);
  assert.equal(got.headers.cookie, undefined);
  assert.equal(got.headers['x-forwarded-host'], undefined);
  assert.equal(got.headers['x-stainless-lang'], 'js');
  assert.equal(got.headers['anthropic-beta'], 'b1');
  assert.equal(got.headers['accept-encoding'], 'identity');
  assert.ok(!JSON.stringify(got.headers).includes(token), 'the spawn token never reaches the provider');
});

test('proxy: SSE streams through unbuffered, response headers are allowlisted, usage is recorded', async () => {
  const { token, spawnId } = await mint();
  up.set({ streamDelayMs: 400 });
  const t0 = Date.now();
  const res = await messages(token, { stream: true });
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(res.headers.get('request-id'), 'req_1');
  const reader = res.body.getReader();
  const first = await reader.read();
  assert.ok(Date.now() - t0 < 350, 'the first chunk arrives before the upstream finishes');
  assert.match(Buffer.from(first.value).toString(), /message_start|hello/);
  let rest = '';
  for (;;) { const { value, done } = await reader.read(); if (done) break; rest += Buffer.from(value).toString(); }
  assert.match(rest, /message_stop/);
  up.set({ streamDelayMs: 150 });
  await new Promise((r) => setTimeout(r, 20));
  const u = await internal('GET', `/internal/usage?spawnId=${spawnId}`);
  assert.equal(u.body.rows.length, 1);
  assert.deepEqual([u.body.rows[0].inputTokens, u.body.rows[0].outputTokens, u.body.rows[0].model], [1000, 500, 'claude-sonnet-5']);
  assert.ok(u.body.rows[0].usd > 0);
});

test('proxy: an error body that echoes the key is scrubbed', async () => {
  const { token } = await mint();
  up.set({ mode: 'echo-key' });
  const res = await messages(token);
  const text = await res.text();
  up.set({ mode: 'ok' });
  assert.equal(res.status, 400);
  assert.ok(!text.includes(GOOD_KEY) && !text.includes('sk-ab****wxyz'), text);
  assert.match(text, /removed by worca broker/);
});

test('proxy: an upstream redirect is refused, never followed', async () => {
  const { token } = await mint();
  up.set({ mode: 'redirect' });
  const res = await messages(token);
  up.set({ mode: 'ok' });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error.message, /worca-broker: upstream redirect refused/);
});

test('proxy: paths off the allowlist, unknown slots and slots outside the token are refused', async () => {
  const { token } = await mint();
  const r1 = await messages(token, { path: '/p/anthropic/v1/files' });
  assert.equal(r1.status, 403);
  const r2 = await messages(token, { path: '/p/anthropic/v1/%2e%2e/internal/info' });
  assert.equal(r2.status, 403);
  const r3 = await messages(token, { path: '/p/nope/v1/messages' });
  assert.equal(r3.status, 404);
  const r4 = await fetch(`${base}/p/openrouter/api/v1/models`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r4.status, 403, 'the token was minted for anthropic only');
});

test('proxy: no token, a made-up token, a revoked token, and a token on /internal are all refused', async () => {
  // 403 with an authentication_error body: the CLI stops at once on a 403, while it
  // retries a 401 up to ten times.
  const none = await fetch(`${base}/p/anthropic/v1/models`);
  assert.equal(none.status, 403);
  const noneBody = await none.json();
  assert.match(noneBody.error.message, /no token/);
  assert.equal(noneBody.error.type, 'authentication_error');
  const fake = await fetch(`${base}/p/anthropic/v1/models`, { headers: { 'x-api-key': `wbt_${'Q'.repeat(43)}` } });
  assert.equal(fake.status, 403);
  const { token, spawnId } = await mint();
  assert.equal((await fetch(`${base}/p/anthropic/v1/models`, { headers: { 'x-api-key': token } })).status, 200);
  assert.equal((await internal('DELETE', `/internal/tokens/${spawnId}`)).status, 200);
  const after = await fetch(`${base}/p/anthropic/v1/models`, { headers: { 'x-api-key': token } });
  assert.equal(after.status, 403);
  assert.match((await after.json()).error.message, /expired or revoked/);
  const asInternal = await fetch(`${base}/internal/info`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(asInternal.status, 401);
});

test('proxy: the Host header cannot change the destination; absolute-form and CONNECT are refused', async () => {
  const { token } = await mint();
  up.requests.length = 0;
  const status = await new Promise((resolveP, rejectP) => {
    const req = http.request({ host: '127.0.0.1', port: broker.ports.private, path: '/p/anthropic/v1/models', headers: { host: 'evil.example', 'x-api-key': token } }, (r) => { r.resume(); resolveP(r.statusCode); });
    req.on('error', rejectP); req.end();
  });
  assert.equal(status, 200);
  assert.equal(up.requests.length, 1, 'it went to the pinned upstream');
  const abs = await new Promise((resolveP) => {
    const s = net.connect(broker.ports.private, '127.0.0.1', () => s.write(`GET http://evil.example/p/anthropic/v1/models HTTP/1.1\r\nHost: evil.example\r\nx-api-key: ${token}\r\n\r\n`));
    let buf = ''; s.on('data', (d) => { buf += d; if (buf.includes('\r\n\r\n')) { s.destroy(); resolveP(buf); } });
  });
  assert.match(abs, /^HTTP\/1\.1 400/);
  const conn = await new Promise((resolveP) => {
    const s = net.connect(broker.ports.private, '127.0.0.1', () => s.write('CONNECT evil.example:443 HTTP/1.1\r\nHost: evil.example:443\r\n\r\n'));
    let buf = ''; s.on('data', (d) => { buf += d; }); s.on('close', () => resolveP(buf)); s.on('end', () => resolveP(buf));
  });
  assert.match(conn, /^HTTP\/1\.1 405/);
});

test('proxy: a spent per-token budget stops spending with a quota error', async () => {
  const { token } = await mint({ budgetUsd: 0.000001 });
  assert.equal((await messages(token)).status, 200);           // spends a little
  const res = await messages(token);
  assert.equal(res.status, 403);
  assert.match((await res.json()).error.message, /worca-broker: quota reached: this spawn's budget/);
});

test('proxy: OpenAI-shaped slots use Bearer auth and book the provider-reported cost', async () => {
  const { token, spawnId } = await mint({ slots: ['openrouter'] });
  up.requests.length = 0;
  const res = await fetch(`${base}/p/openrouter/api/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'http-referer': 'https://worca.dev', 'x-title': 'Worca' },
    body: JSON.stringify({ model: 'x', messages: [] }),
  });
  assert.equal(res.status, 200);
  const got = up.requests.at(-1);
  assert.equal(got.headers.authorization, `Bearer ${GOOD_KEY}`);
  assert.equal(got.headers['http-referer'], 'https://worca.dev');
  await new Promise((r) => setTimeout(r, 20));
  const u = await internal('GET', `/internal/usage?spawnId=${spawnId}`);
  assert.equal(u.body.rows[0].usd, 0.0123);
});

test('proxy: a missing key names the slot and where to add it', async () => {
  const { token } = await mint({ slots: ['openai'] });
  const res = await fetch(`${base}/p/openai/v1/models`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error.message, /worca-broker: no OpenAI API key for local\. Set WORCA_BROKER_KEY_OPENAI on the broker/);
  assert.equal(body.error.type, 'authentication_error', 'OpenAI envelope for an OpenAI slot');
});

test('healthz answers on the private port', async () => {
  const r = await fetch(`${base}/healthz`);
  assert.deepEqual((await r.json()).mode, 'single');
});
