// test/broker-upstream-env-proxy.test.mjs
// The broker's model upstream follows HTTP(S)_PROXY on a Node without
// http.setGlobalProxyFromEnv (useEnvProxy's undici fallback, which only covers fetch):
// an outside upstream goes through the proxy as a CONNECT, a NO_PROXY host and a loopback
// upstream go direct.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { useEnvProxy } from '../src/core/env-proxy.mjs';
import { readBrokerConfig } from '../src/broker/config.mjs';
import { builtinSlots, mergeSlots } from '../src/broker/slots.mjs';
import { startBroker } from '../src/broker/main.mjs';
import { fetchUpstream } from '../src/broker/upstream-request.mjs';
import { startFakeUpstream, GOOD_KEY } from './helpers/fake-model-upstream.mjs';

const SECRET = 's'.repeat(48);
const seen = [];
let proxy; let up; let broker; let base; let envProxy;

before(async () => {
  // The proxy only records what it was asked for (CONNECT or absolute-form), then refuses.
  proxy = http.createServer((req, res) => { seen.push(req.url); res.writeHead(502).end(); });
  proxy.on('connect', (req, socket) => { seen.push(`CONNECT ${req.url}`); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  // api: {} = a Node without setGlobalProxyFromEnv: only fetch gets the proxy.
  envProxy = useEnvProxy({ env: { HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, NO_PROXY: 'direct.upstream.test' }, api: {} });
  assert.equal(envProxy.status, 'on');

  up = await startFakeUpstream();
  const { config, errors } = readBrokerConfig({
    WORCA_BROKER_MODE: 'single', WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_HOST: '127.0.0.1',
    WORCA_BROKER_PORT: '0', WORCA_BROKER_UI_PORT: '1',
    WORCA_BROKER_KEY_ANTHROPIC: GOOD_KEY, WORCA_BROKER_KEY_OPENAI: GOOD_KEY, WORCA_BROKER_KEY_OPENROUTER: GOOD_KEY,
  });
  assert.deepEqual(errors, []);
  const slots = mergeSlots(builtinSlots(), [
    { id: 'anthropic', upstream: 'https://api.upstream.test' },
    { id: 'openai', upstream: 'https://direct.upstream.test' },
    { id: 'openrouter', upstream: up.url },
  ]);
  broker = await startBroker({ config: { ...config, port: 0 }, slots, log: () => {} });
  base = `http://127.0.0.1:${broker.ports.private}`;
});
after(async () => {
  envProxy?.restore();
  await broker?.close();
  await up?.close();
  proxy?.closeAllConnections?.();
  await new Promise((r) => (proxy ? proxy.close(r) : r()));
});

let spawnSeq = 0;
async function call(slot, path) {
  const r = await fetch(`${base}/internal/tokens`, {
    method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ billTo: 'local', slots: [slot], spawnId: `sp-${++spawnSeq}`, kind: 'phase', issuer: 'srv-test' }),
  });
  const { token } = await r.json();
  const res = await fetch(`${base}/p/${slot}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, text: await res.text() };
}

test('an outside upstream goes through HTTPS_PROXY as a CONNECT', async () => {
  seen.length = 0;
  const r = await call('anthropic', '/v1/models');
  assert.equal(r.status, 502, r.text);   // the fake proxy refuses the tunnel
  assert.deepEqual(seen, ['CONNECT api.upstream.test:443']);
});

test('a NO_PROXY upstream goes direct', async () => {
  seen.length = 0;
  const r = await call('openai', '/v1/models');
  assert.equal(r.status, 502, r.text);   // .test never resolves
  assert.deepEqual(seen, []);
});

test('a loopback upstream goes direct and answers', async () => {
  seen.length = 0;
  up.requests.length = 0;
  const r = await call('openrouter', '/api/v1/models');
  assert.equal(r.status, 200, r.text);
  assert.equal(up.requests.at(-1).headers.authorization, `Bearer ${GOOD_KEY}`);
  assert.deepEqual(seen, []);
});

test('fetchUpstream: destroy() without a reason errors the response, or the request before one', { timeout: 5000 }, async () => {
  const srv = http.createServer((req, res) => { if (req.url === '/slow') return; res.writeHead(200); res.write('x'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const at = (p) => new URL(`http://127.0.0.1:${srv.address().port}${p}`);
  try {
    const a = fetchUpstream(at('/stream'));
    // Every wait is bounded, so a missing event fails the test and `finally` still closes srv
    // (an unbounded wait outlives the test timeout and keeps the file from exiting).
    const within = () => ({ signal: AbortSignal.timeout(2000) });
    const responded = once(a, 'response', within());
    a.end();
    const [ur] = await responded;
    const urErr = once(ur, 'error', within());
    a.destroy();
    assert.equal((await urErr)[0].message, 'aborted');
    const b = fetchUpstream(at('/slow'));
    const reqErr = once(b, 'error', within());
    b.end();
    b.destroy();
    assert.equal((await reqErr)[0].code, 'ECONNRESET');
  } finally {
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
  }
});

test('fetchUpstream: timeout fires after `timeout` ms without bytes, and destroy() errors the response', async () => {
  const stall = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: 1\n\n'); });
  await new Promise((r) => stall.listen(0, '127.0.0.1', r));
  try {
    const req = fetchUpstream(new URL(`http://127.0.0.1:${stall.address().port}/`), { timeout: 150 });
    const ur = await new Promise((resolve, reject) => { req.on('response', resolve); req.on('error', reject); req.end(); });
    assert.equal(ur.statusCode, 200);
    assert.equal(ur.headers['content-type'], 'text/event-stream');
    const chunks = [];
    ur.on('data', (c) => chunks.push(String(c)));
    await new Promise((r) => req.once('timeout', r));
    assert.deepEqual(chunks, ['data: 1\n\n']);
    const errs = [];
    ur.on('error', (e) => errs.push(e.message));
    req.on('error', (e) => errs.push(e.message));
    req.destroy(new Error('upstream idle timeout'));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(errs, ['upstream idle timeout', 'upstream idle timeout']);
  } finally {
    stall.closeAllConnections();
    await new Promise((r) => stall.close(r));
  }
});

test('an agent that hangs up mid-stream frees its concurrency slot (more aborts than the per-token limit, then a 200)', { timeout: 20000 }, async () => {
  const stall = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {}\n\n'); });
  await new Promise((r) => stall.listen(0, '127.0.0.1', r));
  const { config } = readBrokerConfig({
    WORCA_BROKER_MODE: 'single', WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_HOST: '127.0.0.1',
    WORCA_BROKER_PORT: '0', WORCA_BROKER_UI_PORT: '1', WORCA_BROKER_KEY_OPENROUTER: GOOD_KEY,
  });
  const b = await startBroker({ config: { ...config, port: 0 }, slots: mergeSlots(builtinSlots(), [{ id: 'openrouter', upstream: `http://127.0.0.1:${stall.address().port}` }]), log: () => {} });
  const bBase = `http://127.0.0.1:${b.ports.private}`;
  try {
    const t = await fetch(`${bBase}/internal/tokens`, {
      method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ billTo: 'local', slots: ['openrouter'], spawnId: 'sp-abort', kind: 'phase', issuer: 'srv-test' }),
    });
    const { token } = await t.json();
    const statuses = [];
    for (let i = 0; i < 10; i++) {
      const ac = new AbortController();
      const res = await fetch(`${bBase}/p/openrouter/api/v1/chat/completions`, {
        method: 'POST', signal: ac.signal, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}',
      });
      statuses.push(res.status);
      if (res.status === 200) { await res.body.getReader().read(); ac.abort(); } else await res.text();
      // The hang-up reaches the broker's request 'close' asynchronously.
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.deepEqual(statuses, Array(10).fill(200));
  } finally {
    stall.closeAllConnections();
    await new Promise((r) => stall.close(r));
    await b.close();
  }
});
