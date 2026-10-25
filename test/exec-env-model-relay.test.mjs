// test/exec-env-model-relay.test.mjs
// The model relay (src/core/exec-env/model-relay.mjs + sandbox-relay.mjs, plans/model-relay-design.md §3, §5):
// sandbox-relay.mjs runs as a real child through the loopback fake's client.run; a local stub plays the upstream.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeE2b } from '../src/core/exec-env/e2b-fake.mjs';
import { e2bClient } from '../src/core/exec-env/backends/e2b.mjs';
import { ModelRelay, createByteScrubber, createByteBudget, MAX_LINE } from '../src/core/exec-env/model-relay.mjs';
import { createRouteMeter } from '../src/core/exec-env/relay-usage.mjs';
import { MAX_REQUEST_BYTES } from '../src/broker/service.mjs';
import { REMOVED } from '../src/broker/scrub.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'e2b mode is POSIX-only' : false, timeout: 30_000 };
const SCRIPT = fileURLToPath(new URL('../src/core/exec-env/sandbox-relay.mjs', import.meta.url));
const SECRET = 'real-credential-0123456789';
const scratch = []; after(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** A stub upstream recording every request; `handler(req, res, body)` answers (default: 200 JSON). */
async function stubUpstream(t, handler = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => { const body = Buffer.concat(parts); seen.push({ method: req.method, url: req.url, headers: req.headers, body }); handler(req, res, body); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => { srv.closeAllConnections(); srv.close(); });
  return { seen, url: `http://127.0.0.1:${srv.address().port}` };
}

async function startRelay(t, opts = {}, { network } = {}) {
  const sdk = createFakeE2b({ root: tmp('worca-relay-root-') });
  const real = e2bClient(sdk, { opts: {} }, { mock: true });
  const runs = [];   // every client.run call's options (a spy over the real client)
  const client = { ...real, run: (b, cmd, o) => { runs.push(o); return real.run(b, cmd, o); } };
  const box = await client.create({ environment: 'worca-agent', tags: {}, timeoutMs: 60_000, ...(network ? { network } : {}) });
  const scriptPath = join(box.pathPrefix, 'worca-relay.mjs');
  copyFileSync(SCRIPT, scriptPath);
  const logs = [];
  const relay = new ModelRelay({ log: (level, msg) => logs.push(`${level} ${msg}`), ...opts });
  const start = (o = {}) => relay.start({ client, box: box.box, scriptPath, ...o });
  await start();
  t.after(async () => { await relay.stop(); await sdk.Sandbox.kill(box.id); });
  return { relay, logs, runs, start, sdk };
}

const route = (upstream, extra = {}) => ({
  upstream, authHeaders: () => ({ authorization: `Bearer ${SECRET}` }), extraHeaders: {}, secrets: [SECRET], ...extra,
});
const post = (url, init = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, body: '{"model":"m"}', ...init });
const relayError = async (r, status) => {
  assert.equal(r.status, status);
  assert.match(r.headers.get('content-type'), /application\/json/);
  const j = await r.json();
  assert.equal(j.type, 'error'); assert.match(j.error.message, /^worca-relay: /);
  return j;
};
/** A raw request (no URL normalisation), for path-traversal cases. */
const rawRequest = (port, path, method = 'POST') => new Promise((resolveP, rejectP) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json' } }, (res) => {
    const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => resolveP({ status: res.statusCode, body: Buffer.concat(parts).toString('utf8') }));
  });
  req.on('error', rejectP); req.end('{}');
});

test('forwards a message call with the route credential and without the sandbox token', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay } = await startRelay(t);
  assert.equal(relay.alive, true);
  const { id, baseUrl } = relay.addRoute(route(up.url));
  assert.match(baseUrl, new RegExp(`^http://127\\.0\\.0\\.1:\\d+/r/${id}$`));
  assert.equal(Buffer.from(id, 'base64url').length, 32);
  const r = await post(`${baseUrl}/v1/messages?beta=true`, { headers: { authorization: `Bearer ${id}`, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' } });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  assert.equal(up.seen.length, 1);
  const s = up.seen[0];
  assert.equal(s.method, 'POST'); assert.equal(s.url, '/v1/messages?beta=true');
  assert.equal(s.headers.authorization, `Bearer ${SECRET}`);
  assert.equal(s.headers['anthropic-version'], '2023-06-01');
  assert.equal(s.body.toString(), '{"model":"m"}');
  assert.ok(!JSON.stringify(s.headers).includes(id), 'the route id never reaches the upstream');
  // The id is also accepted from the bearer header alone (no /r/<id> prefix).
  const port = new URL(baseUrl).port;
  const r2 = await post(`http://127.0.0.1:${port}/v1/messages/count_tokens`, { headers: { authorization: `Bearer ${id}`, 'content-type': 'application/json' } });
  assert.equal(r2.status, 200);
  assert.equal(up.seen[1].url, '/v1/messages/count_tokens');
});

// Egress closed (plan Task 13): the relay rides the command's stdio and the sandbox's loopback, which E2B keeps open
// under deny-all (plans/2026-10-22-e2b-kill-egress-checks.md §2), so a model call still answers.
test('a model call through the relay answers with the sandbox egress closed (allowOut empty)', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay, sdk } = await startRelay(t, {}, { network: { denyOut: ['0.0.0.0/0'] } });
  assert.deepEqual(sdk.events.find((e) => e.type === 'create').network, { denyOut: ['0.0.0.0/0'] });
  const { id, baseUrl } = relay.addRoute(route(up.url));
  const r = await post(`${baseUrl}/v1/messages`, { headers: { authorization: `Bearer ${id}`, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' } });
  assert.equal(r.status, 200);
  assert.equal(up.seen.length, 1);
});

test('joins an upstream base path without a double slash; auth wins over custom headers', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay } = await startRelay(t);
  const { baseUrl } = relay.addRoute(route(`${up.url}/gw/v1/`, {
    extraHeaders: { 'X-Gateway': 'g1', Authorization: 'Bearer custom' },
    authHeaders: (h) => ({ authorization: `Bearer ${SECRET}`, 'anthropic-beta': ['oauth-2025-04-20', h['anthropic-beta']].filter(Boolean).join(',') }),
  }));
  const r = await post(`${baseUrl}/v1/messages`, { headers: { 'content-type': 'application/json', 'anthropic-beta': 'b1' } });
  assert.equal(r.status, 200);
  assert.equal(up.seen[0].url, '/gw/v1/v1/messages');
  assert.equal(up.seen[0].headers['x-gateway'], 'g1');
  assert.equal(up.seen[0].headers.authorization, `Bearer ${SECRET}`);
  assert.equal(up.seen[0].headers['anthropic-beta'], 'oauth-2025-04-20,b1');
});

test('unknown route → 403 worca-relay and removed route → 403', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay } = await startRelay(t);
  const { id, baseUrl } = relay.addRoute(route(up.url));
  const port = new URL(baseUrl).port;
  await relayError(await post(`http://127.0.0.1:${port}/r/nope/v1/messages`), 403);
  await relayError(await post(`http://127.0.0.1:${port}/v1/messages`), 403);
  relay.removeRoute(id);
  await relayError(await post(`${baseUrl}/v1/messages`), 403);
  assert.equal(up.seen.length, 0);
});

test('refuses other paths and methods', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay, logs } = await startRelay(t);
  const { id, baseUrl } = relay.addRoute(route(up.url));
  const port = new URL(baseUrl).port;
  await relayError(await fetch(`${baseUrl}/v1/models`), 403);
  await relayError(await post(`${baseUrl}/v1/files`), 403);
  await relayError(await fetch(`${baseUrl}/v1/messages`), 403);
  for (const p of [`/r/${id}/../internal/tokens`, `/r/${id}/v1/messages/../../internal/tokens`, `/r/${id}/v1/%2e%2e/internal`,
    `/r/${id}/v1/messages%2f..%2finternal`, `/r/${id}/v1/messages?x=..`]) {
    const r = await rawRequest(port, p);
    assert.equal(r.status, 403, p); assert.match(JSON.parse(r.body).error.message, /^worca-relay: /);
  }
  assert.equal(up.seen.length, 0);
  assert.ok(logs.some((l) => l.includes('/v1/models') && l.includes('403')), 'refusals are logged');
  assert.ok(!logs.some((l) => l.includes(id)), 'the route id is never logged');
});

test('answers HEAD /api/hello itself', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay } = await startRelay(t);
  const { baseUrl } = relay.addRoute(route(up.url));
  const port = new URL(baseUrl).port;
  for (const u of [`http://127.0.0.1:${port}/api/hello`, `${baseUrl}/api/hello`]) {
    const r = await fetch(u, { method: 'HEAD' });
    assert.equal(r.status, 200, u); assert.equal(await r.text(), '');
  }
  assert.equal(up.seen.length, 0);
});

test('drops headers outside the allowlist', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay } = await startRelay(t);
  const { baseUrl } = relay.addRoute(route(up.url));
  const r = await post(`${baseUrl}/v1/messages`, { headers: { 'content-type': 'application/json', cookie: 'a=b', 'x-forwarded-for': '1.2.3.4', 'x-api-key': 'k' } });
  assert.equal(r.status, 200);
  const h = up.seen[0].headers;
  assert.equal(h.cookie, undefined); assert.equal(h['x-forwarded-for'], undefined); assert.equal(h['x-api-key'], undefined);
});

test('body over 32 MiB → 413', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay } = await startRelay(t);
  const { baseUrl } = relay.addRoute(route(up.url));
  await relayError(await post(`${baseUrl}/v1/messages`, { body: Buffer.alloc((32 << 20) + 1, 0x61) }), 413);
  assert.equal(up.seen.length, 0);
});

test('upstream redirect → 502, not followed', POSIX, async (t) => {
  const up = await stubUpstream(t, (req, res) => { res.writeHead(302, { location: '/elsewhere' }); res.end(); });
  const { relay } = await startRelay(t);
  const { baseUrl } = relay.addRoute(route(up.url));
  const j = await relayError(await post(`${baseUrl}/v1/messages`), 502);
  assert.match(j.error.message, /redirected/);
  assert.equal(up.seen.length, 1);
});

test('an unreachable upstream → 502 without details', POSIX, async (t) => {
  const { relay } = await startRelay(t);
  const { baseUrl } = relay.addRoute(route('http://127.0.0.1:1'));
  const j = await relayError(await post(`${baseUrl}/v1/messages`), 502);
  assert.equal(j.error.message, 'worca-relay: the model endpoint could not be reached');
});

test('over the per-route concurrency cap → 429', POSIX, async (t) => {
  const held = [];
  const up = await stubUpstream(t, (req, res) => held.push(res));
  const { relay } = await startRelay(t, { maxConcurrentPerRoute: 2 });
  const { baseUrl } = relay.addRoute(route(up.url));
  const a = post(`${baseUrl}/v1/messages`); const b = post(`${baseUrl}/v1/messages`);
  while (held.length < 2) await pause(10);
  await relayError(await post(`${baseUrl}/v1/messages`), 429);
  for (const res of held) { res.writeHead(200); res.end('{}'); }
  assert.equal((await a).status, 200); assert.equal((await b).status, 200);
  assert.equal(up.seen.length, 2);
});

test('scrubs the credential when the upstream echoes it, also split across two chunks', POSIX, async (t) => {
  const up = await stubUpstream(t, async (req, res, body) => {
    const mode = JSON.parse(body).mode;
    if (mode === 'error') { res.writeHead(401, { 'content-type': 'application/json' }); res.end(`{"error":"bad key ${SECRET} and sk-ant-abcdefgh12345"}`); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: whole ${SECRET} done\n\ndata: split ${SECRET.slice(0, 9)}`);
    await pause(60);
    res.end(`${SECRET.slice(9)} end sk-ant-abcdefgh12345\n\n`);
  });
  const { relay } = await startRelay(t);
  const { baseUrl } = relay.addRoute(route(up.url));
  const ok = await (await post(`${baseUrl}/v1/messages`, { body: '{"mode":"ok"}' })).text();
  assert.equal(ok, `data: whole ${REMOVED} done\n\ndata: split ${REMOVED} end sk-ant-abcdefgh12345\n\n`, 'exact values only on a 2xx body');
  const r = await post(`${baseUrl}/v1/messages`, { body: '{"mode":"error"}' });
  assert.equal(r.status, 401);
  const err = await r.text();
  assert.ok(!err.includes(SECRET) && !err.includes('sk-ant-abcdefgh'), err);
  assert.ok(err.includes(REMOVED));
});

test('keeps a multi-byte character split across chunks intact', POSIX, async (t) => {
  const euro = Buffer.from('€');
  const up = await stubUpstream(t, async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.write(Buffer.concat([Buffer.from('price '), euro.subarray(0, 1)]));
    await pause(60);
    res.end(Buffer.concat([euro.subarray(1), Buffer.from(' 5')]));
  });
  const { relay } = await startRelay(t);
  const { baseUrl } = relay.addRoute(route(up.url));
  const r = await post(`${baseUrl}/v1/messages`);
  assert.equal(Buffer.from(await r.arrayBuffer()).toString('utf8'), 'price € 5');
});

test('two concurrent requests get their own bodies', POSIX, async (t) => {
  const up = await stubUpstream(t, async (req, res, body) => {
    const tag = JSON.parse(body).tag;
    res.writeHead(200, { 'content-type': 'text/plain' });
    for (let i = 0; i < 20; i++) { res.write(`${tag}${i};`); await pause(5); }
    res.end();
  });
  const { relay } = await startRelay(t);
  const { baseUrl } = relay.addRoute(route(up.url));
  const [a, b] = await Promise.all(['A', 'B'].map((tag) => post(`${baseUrl}/v1/messages`, { body: JSON.stringify({ tag }) }).then((r) => r.text())));
  const want = (tag) => Array.from({ length: 20 }, (_, i) => `${tag}${i};`).join('');
  assert.equal(a, want('A')); assert.equal(b, want('B'));
});

test('streams 300 SSE chunks byte-identical and in order', POSIX, async (t) => {
  const events = Array.from({ length: 300 }, (_, i) => `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"tok ${i} ✓"}}\n\n`);
  const up = await stubUpstream(t, async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_1', 'set-cookie': 'x=y' });
    for (const e of events) { res.write(e); await new Promise((r) => setImmediate(r)); }
    res.end();
  });
  const { relay } = await startRelay(t);
  const { baseUrl } = relay.addRoute(route(up.url));
  const r = await post(`${baseUrl}/v1/messages`);
  assert.equal(r.headers.get('content-type'), 'text/event-stream');
  assert.equal(r.headers.get('request-id'), 'req_1');
  assert.equal(r.headers.get('set-cookie'), null);
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(Buffer.from(events.join(''))));
});

test('a broker 403 worca-broker body reaches the caller unchanged', POSIX, async (t) => {
  const body = '{"type":"error","error":{"type":"permission_error","message":"worca-broker: the budget for this run is reached"}}';
  const up = await stubUpstream(t, (req, res) => { res.writeHead(403, { 'content-type': 'application/json' }); res.end(body); });
  const { relay } = await startRelay(t);
  const { baseUrl } = relay.addRoute(route(up.url));
  const r = await post(`${baseUrl}/v1/messages`);
  assert.equal(r.status, 403); assert.equal(await r.text(), body);
});

test('the relay command runs with no command deadline (timeoutMs 0)', POSIX, async (t) => {
  const { runs } = await startRelay(t);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].timeoutMs, 0); assert.equal(runs[0].background, true); assert.equal(runs[0].stdin, true);
});

const SSE = (type, o) => `event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`;
const START = SSE('message_start', { message: { id: 'm1', type: 'message', model: 'claude-opus-5', usage: { input_tokens: 100, output_tokens: 1 } } });
const TAIL = SSE('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 32000 } }) + SSE('message_stop', {});

test('a client hang-up mid-stream (audit 2.3): the upstream is read to its end and metered; the slot frees after it', POSIX, async (t) => {
  let closedEarly = 0; let finishAll; const finished = new Promise((r) => { finishAll = r; });
  const up = await stubUpstream(t, (req, res) => {
    res.on('close', () => { if (!res.writableEnded) closedEarly++; });
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(START);
    finished.then(() => res.end(TAIL));             // the usage comes last, after the hang-up
  });
  const { relay } = await startRelay(t);
  const meter = createRouteMeter();
  const { baseUrl } = relay.addRoute(route(up.url, { meter: meter.reply }));
  const calls = Array.from({ length: 16 }, () => new AbortController());
  await Promise.all(calls.map(async (ac) => {
    const r = await post(`${baseUrl}/v1/messages`, { signal: ac.signal });
    const reader = r.body.getReader(); await reader.read();   // the first event arrived: mid-stream
    ac.abort();
  }));
  await pause(200);
  assert.equal(closedEarly, 0, 'no upstream call was cut');
  const busy = await relayError(await post(`${baseUrl}/v1/messages`), 429);
  assert.match(busy.error.message, /more than 16 calls/, 'a call the sandbox hung up on keeps its slot until it ends');
  finishAll();
  const took = { messages: 0, out: 0 };
  for (let i = 0; took.messages < 16 && i < 500; i++) { await pause(10); const g = meter.take(); took.messages += g.messages; took.out += g.byModel['claude-opus-5']?.output_tokens || 0; }
  assert.equal(took.messages, 16);
  assert.equal(took.out, 16 * 32000, 'every reply booked with the output the upstream reported at its end');
  assert.equal(closedEarly, 0);
  const next = await Promise.all(Array.from({ length: 16 }, () => post(`${baseUrl}/v1/messages`)));
  assert.equal(next.filter((r) => r.status === 200).length, 16, 'all 16 slots are free again');
});

test('removeRoute resolves once the route\'s calls in flight have ended, with their usage metered (audit 2.4)', POSIX, async (t) => {
  let finish; const finished = new Promise((r) => { finish = r; });
  const up = await stubUpstream(t, (req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(START); finished.then(() => res.end(TAIL)); });
  const { relay } = await startRelay(t);
  const meter = createRouteMeter();
  const { id, baseUrl } = relay.addRoute(route(up.url, { meter: meter.reply }));
  const r = await post(`${baseUrl}/v1/messages`);
  await r.body.getReader().read();
  let settled = false;
  const done = relay.removeRoute(id).then(() => { settled = true; });
  await relayError(await post(`${baseUrl}/v1/messages`), 403);   // no new call reaches a removed route
  await pause(100);
  assert.equal(settled, false, 'the call is still running');
  assert.equal(meter.take().messages, 0);
  finish();
  await done;
  assert.equal(meter.take().byModel['claude-opus-5'].output_tokens, 32000);
  await relay.removeRoute('no-such-route');
});

test('an upstream silent past the idle timeout → 504', POSIX, async (t) => {
  const up = await stubUpstream(t, () => { /* never answers */ });
  const { relay } = await startRelay(t, { upstreamIdleMs: 150 });
  const { baseUrl } = relay.addRoute(route(up.url));
  const j = await relayError(await post(`${baseUrl}/v1/messages`), 504);
  assert.equal(j.error.message, 'worca-relay: the model endpoint stopped answering');
});

test('after the relay exits on its own, start() works again and an existing route still answers', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay, start, logs } = await startRelay(t);
  const { id } = relay.addRoute(route(up.url));
  await relay.handle.kill();   // the process dies without stop()
  for (let i = 0; relay.alive && i < 200; i++) await pause(10);
  assert.equal(relay.alive, false);
  assert.equal(relay.handle, null);
  assert.ok(logs.some((l) => l.includes('stopped')));
  await start();
  assert.equal(relay.alive, true);
  const r = await post(`${relay.baseUrlFor(id)}/v1/messages`);
  assert.equal(r.status, 200);
});

test('a restart on the remembered port keeps a route URL handed out before it', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay, start } = await startRelay(t);
  const { baseUrl, id } = relay.addRoute(route(up.url));
  const port = relay.port;
  await relay.handle.kill();
  for (let i = 0; relay.alive && i < 200; i++) await pause(10);
  // a spawn's env is built before beforeSpawn restarts a dead relay: its URL must still be valid after the restart
  const late = relay.addRoute(route(up.url));
  assert.match(late.baseUrl, new RegExp(`^http://127\\.0\\.0\\.1:${port}/r/`));
  await start({ port });
  assert.equal(relay.port, port);
  assert.equal(relay.baseUrlFor(id), baseUrl);
  assert.equal((await post(`${baseUrl}/v1/messages`)).status, 200);
  assert.equal((await post(`${late.baseUrl}/v1/messages`)).status, 200);
});

test('a port that cannot be bound fails start(): no fallback to another port', POSIX, async (t) => {
  const busy = http.createServer(() => {});
  await new Promise((r) => busy.listen(0, '127.0.0.1', r));
  t.after(() => busy.close());
  const { relay, start } = await startRelay(t);
  await relay.handle.kill();
  for (let i = 0; relay.alive && i < 200; i++) await pause(10);
  await assert.rejects(start({ port: busy.address().port }), /exited before it was ready/);
  assert.equal(relay.alive, false);
});

test('a request from before a restart never writes into the new relay process', POSIX, async (t) => {
  // The first upstream call ignores the abort and answers once released: its late frames carry id 1, which the
  // restarted relay has handed to a NEW request.
  let release; const gate = new Promise((r) => { release = r; });
  let calls = 0; let staleCalled;
  const staleStarted = new Promise((r) => { staleCalled = r; });
  const fetchImpl = async (url, init) => {
    if (++calls === 1) { staleCalled(); await gate; return new Response('stale-body', { status: 200, headers: { 'content-type': 'text/plain' } }); }
    return fetch(url, init);
  };
  const up = await stubUpstream(t, (req, res) => setTimeout(() => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('fresh-body'); }, 300));
  const { relay, start } = await startRelay(t, { fetchImpl });
  const { id } = relay.addRoute(route(up.url));
  const port = relay.port;
  const first = post(`${relay.baseUrlFor(id)}/v1/messages`).then((r) => r.text()).catch(() => null);
  await staleStarted;
  await relay.handle.kill();
  for (let i = 0; relay.alive && i < 200; i++) await pause(10);
  await start({ port });
  const second = post(`${relay.baseUrlFor(id)}/v1/messages`);
  for (let i = 0; up.seen.length < 1 && i < 200; i++) await pause(10);
  release();
  const r = await second;
  assert.equal(await r.text(), 'fresh-body', 'the new request got its own reply');
  await first;
});

test('onDrop fires when a ready relay ends without stop(), never after stop()', POSIX, async (t) => {
  let drops = 0;
  const { relay, start } = await startRelay(t, { onDrop: () => { drops++; } });
  await relay.handle.kill();                       // the process dies on its own
  for (let i = 0; drops < 1 && i < 200; i++) await pause(10);
  assert.equal(drops, 1);
  await start();
  await relay.stop();
  await pause(200);
  assert.equal(drops, 1, 'a deliberate stop is not a drop');
});

test('a req frame whose id is already in flight is ignored and logged once, metadata only (Minor 6)', async () => {
  let onStdout = null; const sent = [];
  const client = { run: async (box, cmd, o) => { onStdout = o.onStdout; setImmediate(() => onStdout('{"t":"ready","port":4999}\n'));
    return { wait: () => new Promise(() => {}), kill: async () => true, sendStdin: async (d) => { sent.push(d); } }; } };
  const calls = [];
  const fetchImpl = (url, init) => new Promise((_, rej) => { calls.push(url); init.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
  const logs = [];
  const relay = new ModelRelay({ log: (level, msg) => logs.push(`${level} ${msg}`), fetchImpl });
  await relay.start({ client, box: {}, scriptPath: '/x/relay.mjs' });
  const { id } = relay.addRoute(route('http://upstream.invalid'));
  const frame = (b64) => `${JSON.stringify({ t: 'req', id: 7, method: 'POST', path: `/r/${id}/v1/messages`, headers: {}, b64 })}\n`;
  onStdout(frame(Buffer.from('{"a":"first"}').toString('base64')));
  for (let i = 0; calls.length < 1 && i < 100; i++) await pause(5);
  onStdout(frame(Buffer.from('{"a":"second"}').toString('base64')));
  onStdout(frame(''));
  await pause(50);
  assert.equal(calls.length, 1, 'the duplicate never reaches the upstream');
  assert.deepEqual(sent, [], 'and is not answered (the first call owns that id)');
  const dup = logs.filter((l) => l.includes('already in flight'));
  assert.equal(dup.length, 1, logs.join('\n'));
  assert.ok(!dup[0].includes(id) && !dup[0].includes('second'), 'no route id, no body');
  await relay.stop();
});

/** A relay on a fake command handle: `sent` is every sendStdin text, `req(id, route)` is a request frame from the
 *  sandbox, `hold()` makes writes wait until `release()`, `fail()` makes the next write reject. */
async function fakeRelay(opts = {}) {
  let onStdout = null; const sent = []; let gate = null; let open = null; let failNext = false;
  const handle = { wait: () => new Promise(() => {}), kill: async () => true, sendStdin: async (d) => {
    if (failNext) { failNext = false; throw new Error('EPIPE'); }
    sent.push(d); if (gate) await gate;
  } };
  const client = { run: async (box, cmd, o) => { onStdout = o.onStdout; setImmediate(() => onStdout('{"t":"ready","port":4999}\n')); return handle; } };
  const logs = [];
  const relay = new ModelRelay({ log: (level, msg) => logs.push(`${level} ${msg}`), ...opts });
  await relay.start({ client, box: {}, scriptPath: '/x/relay.mjs' });
  return {
    relay, sent, logs,
    req: (id, routeId, body = '') => onStdout(`${JSON.stringify({ t: 'req', id, method: 'POST', path: `/r/${routeId}/v1/messages`, headers: {}, b64: Buffer.from(body).toString('base64') })}\n`),
    raw: (text) => onStdout(text),
    hold: () => { gate = new Promise((r) => { open = r; }); },
    release: () => { gate = null; open?.(); },
    fail: () => { failNext = true; },
  };
}
const framesOf = (sent) => sent.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const linesIn = (text) => text.split('\n').filter(Boolean).length;
const bodyOf = (frames, id) => Buffer.concat(frames.filter((f) => f.id === id && f.t === 'data').map((f) => Buffer.from(f.b64, 'base64'))).toString();
const ended = (sent, id) => framesOf(sent).some((f) => f.id === id && f.t === 'end');

test('reply frames queued during a write go out together, at most sendBatch chars per sendStdin, in order', async () => {
  const chunks = Array.from({ length: 40 }, (_, i) => `chunk-${i};`.padEnd(200, '.'));
  const fetchImpl = async () => new Response(new ReadableStream({ start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close(); } }),
    { status: 200, headers: { 'content-type': 'text/plain' } });
  const { relay, sent, req, hold, release } = await fakeRelay({ fetchImpl, sendBatch: 2000 });
  const { id } = relay.addRoute(route('http://upstream.invalid'));
  hold();                                          // the head's write waits: every frame after it queues
  req(1, id);
  for (let i = 0; sent.length < 1 && i < 200; i++) await pause(5);
  await pause(30);
  release();
  for (let i = 0; !ended(sent, 1) && i < 400; i++) await pause(5);
  const frames = framesOf(sent);
  assert.deepEqual([frames[0].t, frames.at(-1).t], ['head', 'end']);
  assert.equal(bodyOf(frames, 1), chunks.join(''), 'every byte, in order');
  assert.ok(sent.length < frames.length, `${frames.length} frames in ${sent.length} writes`);
  assert.ok(sent.some((s) => linesIn(s) > 1), 'frames were joined');
  for (const s of sent) assert.ok(s.length <= 2000 || linesIn(s) === 1, `a batch of ${s.length} chars`);
  await relay.stop();
});

test('while more than sendHighWater chars wait to be written, the relay stops reading the upstream', async () => {
  let pulled = 0;
  const body = new ReadableStream({ pull(c) { if (pulled >= 100) { c.close(); return; } pulled++; c.enqueue(Buffer.alloc(500, 0x61)); } }, { highWaterMark: 0 });
  const fetchImpl = async () => new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
  const { relay, sent, req, hold, release } = await fakeRelay({ fetchImpl, sendHighWater: 3000 });
  const { id } = relay.addRoute(route('http://upstream.invalid'));
  hold();
  req(1, id);
  await pause(150);
  assert.ok(pulled >= 2, `it reads ahead while a write is in flight (pulled ${pulled})`);
  assert.ok(pulled <= 8, `and stops once about 3000 chars are queued (pulled ${pulled} of 100)`);
  release();
  for (let i = 0; !ended(sent, 1) && i < 400; i++) await pause(5);
  assert.equal(pulled, 100);
  assert.equal(bodyOf(framesOf(sent), 1), 'a'.repeat(50_000));
  await relay.stop();
});

/** An SSE reply: message_start, `n` 500-byte content events read one at a time, then the usage. */
const longReply = (n) => {
  let pulled = 0;
  const filler = SSE('content_block_delta', { delta: { type: 'text_delta', text: 'a'.repeat(450) } });
  const body = new ReadableStream({ pull(c) {
    if (pulled === 0) c.enqueue(Buffer.from(START)); else if (pulled <= n) c.enqueue(Buffer.from(filler)); else if (pulled === n + 1) c.enqueue(Buffer.from(TAIL)); else { c.close(); return; }
    pulled++;
  } }, { highWaterMark: 0 });
  return { fetchImpl: async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }), read: () => pulled };
};

test('a sandbox that stops taking frames is a hang-up after clientDrainMs: the upstream is read on and metered (audit 2.3)', async () => {
  const up = longReply(100);
  const { relay, req, hold, release } = await fakeRelay({ fetchImpl: up.fetchImpl, sendHighWater: 3000, clientDrainMs: 150 });
  const meter = createRouteMeter();
  const { id } = relay.addRoute(route('http://upstream.invalid', { meter: meter.reply }));
  hold();                                          // the sandbox never drains the queue
  req(1, id);
  await pause(60);
  assert.ok(up.read() < 20, `it waits for the sandbox first (read ${up.read()})`);
  for (let i = 0; up.read() < 102 && i < 400; i++) await pause(5);
  assert.equal(up.read(), 102, 'then reads the whole reply');
  let got = null;
  for (let i = 0; !got && i < 200; i++) { await pause(5); const g = meter.take(); if (g.messages) got = g; }
  assert.equal(got?.byModel['claude-opus-5']?.output_tokens, 32000);
  release();
  await relay.stop();
});

test('a relay that exits or is stopped mid-reply leaves the upstream read to its end and metered (audit 2.3)', async () => {
  for (const end of ['drop', 'stop']) {
    const up = longReply(20);
    const { relay, req, hold } = await fakeRelay({ fetchImpl: up.fetchImpl, sendHighWater: 3000 });
    const meter = createRouteMeter();
    const { id } = relay.addRoute(route('http://upstream.invalid', { meter: meter.reply }));
    hold();
    req(1, id);
    await pause(60);
    if (end === 'drop') await relay._lose(); else await relay.stop();
    let got = null;
    for (let i = 0; !got && i < 400; i++) { await pause(5); const g = meter.take(); if (g.messages) got = g; }
    assert.equal(got?.byModel['claude-opus-5']?.output_tokens, 32000, end);
  }
});

test('a write to the relay that fails stops it and reports the drop; the call gets nothing more', async () => {
  let drops = 0;
  const fetchImpl = async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  const { relay, sent, logs, req, fail } = await fakeRelay({ fetchImpl, onDrop: () => { drops++; } });
  const { id } = relay.addRoute(route('http://upstream.invalid'));
  fail();
  req(1, id);
  for (let i = 0; drops < 1 && i < 200; i++) await pause(5);
  assert.equal(drops, 1);
  assert.equal(relay.alive, false);
  assert.ok(logs.some((l) => l.includes('writing to the relay failed')), logs.join('\n'));
  assert.deepEqual(sent, []);
  await relay.stop();
});

test('a write to an old relay process that ends after a restart leaves the new process\'s queue alone', async () => {
  // Two command handles: the relay before and after a restart. Each holds its writes until released and counts the
  // sendStdin calls in flight at once.
  const mk = () => {
    const h = { sent: [], busy: 0, maxBusy: 0, gate: null, open: null };
    h.hold = () => { h.gate = new Promise((r) => { h.open = r; }); };
    h.release = () => { const o = h.open; h.gate = null; h.open = null; o?.(); };
    h.handle = { wait: () => new Promise(() => {}), kill: async () => true, sendStdin: async (d) => {
      h.busy++; h.maxBusy = Math.max(h.maxBusy, h.busy); h.sent.push(d);
      try { if (h.gate) await h.gate; } finally { h.busy--; }
    } };
    return h;
  };
  const old = mk(); const neu = mk(); const handles = [old, neu]; let onStdout = null;
  const client = { run: async (box, cmd, o) => { onStdout = o.onStdout; setImmediate(() => onStdout('{"t":"ready","port":4999}\n')); return handles.shift().handle; } };
  const fetchImpl = async () => new Response('x'.repeat(3000), { status: 200, headers: { 'content-type': 'text/plain' } });
  const relay = new ModelRelay({ fetchImpl });
  const req = (n, routeId) => onStdout(`${JSON.stringify({ t: 'req', id: n, method: 'POST', path: `/r/${routeId}/v1/messages`, headers: {}, b64: '' })}\n`);
  await relay.start({ client, box: {}, scriptPath: '/x/relay.mjs' });
  const { id } = relay.addRoute(route('http://upstream.invalid'));
  old.hold();
  req(1, id);
  for (let i = 0; old.sent.length < 1 && i < 200; i++) await pause(5);
  assert.equal(old.busy, 1, 'the old process has a write in flight');
  await relay._lose();
  await relay.start({ client, box: {}, scriptPath: '/x/relay.mjs', port: 4999 });
  neu.hold();
  req(1, id);                                      // the new process reuses the frame id
  for (let i = 0; neu.sent.length < 1 && i < 200; i++) await pause(5);
  await pause(30);                                 // the rest of the reply queues behind the held head
  old.release();                                   // the stale write completes now
  await pause(30);
  assert.equal(neu.maxBusy, 1, 'never two sendStdin calls at once on the new process');
  neu.release();
  for (let i = 0; !ended(neu.sent, 1) && i < 400; i++) await pause(5);
  assert.equal(bodyOf(framesOf(neu.sent), 1), 'x'.repeat(3000));
  assert.equal(neu.maxBusy, 1);
  assert.equal(relay._queued, 0, 'the old batch is not taken off the new queue');
  await relay.stop();
});

test('a response header that carries a secret is dropped, on a 2xx and on an error reply', async () => {
  let status = 200;
  const fetchImpl = async () => new Response('{}', { status, headers: { 'content-type': 'application/json', 'request-id': `req-${SECRET}`, 'anthropic-ratelimit-requests-remaining': '7' } });
  const { relay, sent, req } = await fakeRelay({ fetchImpl });
  const { id } = relay.addRoute(route('http://upstream.invalid'));
  req(1, id);
  for (let i = 0; !ended(sent, 1) && i < 200; i++) await pause(5);
  status = 429;
  req(2, id);
  for (let i = 0; !ended(sent, 2) && i < 200; i++) await pause(5);
  const heads = framesOf(sent).filter((f) => f.t === 'head');
  assert.deepEqual(heads.map((h) => h.status), [200, 429]);
  for (const h of heads) {
    assert.equal(h.headers['request-id'], undefined);
    assert.equal(h.headers['anthropic-ratelimit-requests-remaining'], '7', 'a clean header is kept');
    assert.equal(h.headers['content-type'], 'application/json');
  }
  assert.ok(!sent.join('').includes(SECRET));
  await relay.stop();
});

test('a reply on one route is scrubbed of every route\'s credential: body split across chunks, error body and headers', async () => {
  const OTHER = 'other-route-key-9876543210';
  const LATER = 'rotated-route-key-5555555555';
  let status = 200;
  const fetchImpl = async () => {
    const enc = new TextEncoder();
    const parts = [`a ${OTHER.slice(0, 10)}`, `${OTHER.slice(10)} b ${LATER} c`];
    const body = status === 200
      ? new ReadableStream({ start(ctl) { for (const p of parts) ctl.enqueue(enc.encode(p)); ctl.close(); } })
      : `bad ${OTHER} and ${LATER}`;
    return new Response(body, { status, headers: { 'content-type': 'text/plain', 'request-id': `req-${OTHER}` } });
  };
  const { relay, sent, req } = await fakeRelay({ fetchImpl });
  const { id } = relay.addRoute(route('http://a.invalid'));
  const b = relay.addRoute(route('http://b.invalid', { secrets: [OTHER] }));
  relay.addRoute(route('http://c.invalid', { secrets: [LATER] }));   // a rotated credential, added after A
  relay.removeRoute(b.id);   // a route that ended: its credential is still one worca holds
  req(1, id);
  for (let i = 0; !ended(sent, 1) && i < 200; i++) await pause(5);
  status = 401;
  req(2, id);
  for (let i = 0; !ended(sent, 2) && i < 200; i++) await pause(5);
  const frames = framesOf(sent);
  assert.equal(bodyOf(frames, 1), `a ${REMOVED} b ${REMOVED} c`);
  assert.equal(bodyOf(frames, 2), `bad ${REMOVED} and ${REMOVED}`);
  for (const h of frames.filter((f) => f.t === 'head')) assert.equal(h.headers['request-id'], undefined);
  assert.ok(!sent.join('').includes(OTHER) && !sent.join('').includes(LATER));
  await relay.stop();
});

test('a Connect route asks for uncompressed replies, scrubs inside a gzip message and cuts a stream it cannot read', async () => {
  const env = (flag, b) => { const h = Buffer.alloc(5); h[0] = flag; h.writeUInt32BE(b.length, 1); return Buffer.concat([h, b]); };
  const seen = []; let enc = 'gzip'; let parts = null;
  const fetchImpl = async (_url, init) => {
    seen.push(init.headers);
    const chunks = parts ?? (() => { const gz = env(1, gzipSync(Buffer.from(`echo ${SECRET}`))); return [env(0, Buffer.from('ok')), gz.subarray(0, 3), gz.subarray(3)]; })();
    return new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } }),
      { status: 200, headers: { 'content-type': 'application/connect+proto', 'connect-content-encoding': enc } });
  };
  const { relay, sent, req } = await fakeRelay({ fetchImpl });
  const { id } = relay.addRoute(route('http://cursor.invalid', { protocol: 'connect', allow: [['POST', '/v1/messages']], responseHeaders: ['connect-content-encoding'] }));
  req(1, id); for (let i = 0; !ended(sent, 1) && i < 200; i++) await pause(5);
  assert.equal(seen[0]['connect-accept-encoding'], 'identity');
  let frames = framesOf(sent);
  const data = Buffer.concat(frames.filter((f) => f.id === 1 && f.t === 'data').map((f) => Buffer.from(f.b64, 'base64')));
  assert.ok(data.equals(Buffer.concat([env(0, Buffer.from('ok')), env(0, Buffer.from(`echo ${REMOVED}`))])), 'inflated, scrubbed, re-framed');
  assert.equal(frames.find((f) => f.id === 1 && f.t === 'end').error, undefined);
  parts = [env(0, Buffer.from('ok')), env(1, Buffer.from(`not gzip ${SECRET}`))];
  req(2, id); for (let i = 0; !ended(sent, 2) && i < 200; i++) await pause(5);
  frames = framesOf(sent);
  assert.equal(frames.find((f) => f.id === 2 && f.t === 'end').error, true, 'the stream is cut');
  assert.ok(!sent.join('').includes(SECRET));
  parts = null; enc = 'br';
  req(3, id); for (let i = 0; !ended(sent, 3) && i < 200; i++) await pause(5);
  frames = framesOf(sent);
  assert.equal(frames.find((f) => f.id === 3 && f.t === 'head').status, 502);
  assert.match(JSON.parse(bodyOf(frames, 3)).message, /^worca-relay: the upstream sent .*br.* worca cannot check for credentials/);
  await relay.stop();
});

test('stop() ends the relay: alive turns false', POSIX, async (t) => {
  const { relay } = await startRelay(t);
  assert.equal(relay.alive, true);
  await relay.stop();
  assert.equal(relay.alive, false);
  assert.throws(() => relay.addRoute(route('http://127.0.0.1:1')));
});

/** An upstream that holds every call until `finish()` answers them all with 200 {}. */
function heldUpstream() {
  const calls = [];
  const fetchImpl = (url, init) => new Promise((res, rej) => {
    calls.push({ res, body: init.body });
    init.signal.addEventListener('abort', () => rej(new Error('aborted')));
  });
  const finish = () => { for (const c of calls.splice(0)) c.res(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })); };
  return { calls, fetchImpl, finish };
}
const refusalOf = (sent, id) => {
  const frames = framesOf(sent);
  const head = frames.find((f) => f.id === id && f.t === 'head');
  return head && { status: head.status, error: JSON.parse(bodyOf(frames, id)).error };
};
const waitFor = async (cond) => { for (let i = 0; !cond() && i < 200; i++) await pause(5); };

test('over the per-relay byte budget → 429 worca-relay, nothing forwarded; room comes back when a call ends', async () => {
  const up = heldUpstream();
  const { relay, sent, req } = await fakeRelay({ fetchImpl: up.fetchImpl, maxInflightBytes: 1000, budget: createByteBudget(1 << 20) });
  const a = relay.addRoute(route('http://upstream.invalid')).id;
  const b = relay.addRoute(route('http://upstream.invalid')).id;
  req(1, a, 'x'.repeat(600));
  await waitFor(() => up.calls.length === 1);
  req(2, b, 'y'.repeat(600));                     // another route of the same relay shares its budget
  await waitFor(() => ended(sent, 2));
  const r = refusalOf(sent, 2);
  assert.equal(r?.status, 429); assert.equal(r.error.type, 'rate_limit_error');
  assert.match(r.error.message, /^worca-relay: .*in flight/);
  assert.equal(up.calls.length, 1, 'the refused call never reaches the upstream');
  up.finish();
  await waitFor(() => ended(sent, 1));
  req(3, b, 'z'.repeat(600));
  await waitFor(() => up.calls.length === 1);
  assert.equal(Buffer.from(up.calls[0].body).toString(), 'z'.repeat(600));
  up.finish();
  await relay.stop();
});

test('over the process-wide byte budget → 529 worca-relay across relays; it frees when its calls end, also those stop() left running', async () => {
  const budget = createByteBudget(1000);
  const up = heldUpstream();
  const one = await fakeRelay({ fetchImpl: up.fetchImpl, budget });
  const two = await fakeRelay({ fetchImpl: up.fetchImpl, budget });
  const r1 = one.relay.addRoute(route('http://upstream.invalid')).id;
  const r2 = two.relay.addRoute(route('http://upstream.invalid')).id;
  one.req(1, r1, 'x'.repeat(600));
  await waitFor(() => up.calls.length === 1);
  assert.equal(budget.used, 600);
  two.req(1, r2, 'y'.repeat(600));
  await waitFor(() => ended(two.sent, 1));
  const r = refusalOf(two.sent, 1);
  assert.equal(r?.status, 529); assert.equal(r.error.type, 'overloaded_error');
  assert.match(r.error.message, /^worca-relay: /);
  assert.equal(up.calls.length, 1);
  up.finish();
  await waitFor(() => budget.used === 0);
  assert.equal(budget.used, 0, 'a finished call gives its bytes back');
  two.req(2, r2, 'y'.repeat(600));
  await waitFor(() => up.calls.length === 1);
  assert.equal(budget.used, 600);
  await two.relay.stop();
  await pause(50);
  assert.equal(budget.used, 600, 'a call stop() left running keeps its bytes until it ends');
  up.finish();
  await waitFor(() => budget.used === 0);
  assert.equal(budget.used, 0, 'and gives them back then');
  await one.relay.stop();
});

test('a frame line longer than one maximum body needs stops the relay before it is complete', async () => {
  assert.ok(MAX_LINE - Math.ceil(MAX_REQUEST_BYTES / 3) * 4 <= 64 << 10, 'at most 64 KiB over the base64 of the largest body');
  let drops = 0;
  const { relay, logs, raw } = await fakeRelay({ onDrop: () => { drops++; } });
  const piece = 'a'.repeat(1 << 20);
  raw('{"t":"req","b64":"');
  for (let n = 0; n <= MAX_LINE && relay.alive; n += piece.length) raw(piece);
  assert.equal(relay.alive, false);
  await waitFor(() => drops === 1);
  assert.equal(drops, 1);
  assert.ok(logs.some((l) => l.includes('too long')), logs.join('\n'));
  await relay.stop();
});

test('a request with the largest allowed body, sent in pieces, still goes through', async () => {
  const up = heldUpstream();
  const { relay, raw } = await fakeRelay({ fetchImpl: up.fetchImpl });
  const { id } = relay.addRoute(route('http://upstream.invalid'));
  const headers = { 'content-type': 'application/json', 'user-agent': 'claude-cli/2 (external, cli)', 'x-pad': 'h'.repeat(8000) };
  const line = `${JSON.stringify({ t: 'req', id: 1, method: 'POST', path: `/r/${id}/v1/messages?beta=true`, headers, b64: Buffer.alloc(MAX_REQUEST_BYTES, 0x61).toString('base64') })}\n`;
  for (let i = 0; i < line.length; i += 3 << 20) raw(line.slice(i, i + (3 << 20)));
  await waitFor(() => up.calls.length === 1);
  assert.equal(relay.alive, true);
  assert.equal(up.calls[0].body.length, MAX_REQUEST_BYTES);
  up.finish();
  await relay.stop();
});

test('createByteScrubber: any chunking yields the same scrubbed bytes', () => {
  const LONG = `${SECRET}-extra`; const OUTER = `pre-${SECRET}`;
  const cases = [
    { keys: [SECRET, 'short'], input: `a ${SECRET} b ${SECRET}${SECRET} € c real-cred`, want: `a ${REMOVED} b ${REMOVED}${REMOVED} € c real-cred` },
    // Overlapping values: one is the other plus a suffix, or plus a prefix. The longer one wins whole, any chunking.
    { keys: [SECRET, LONG], input: `a ${LONG} b ${SECRET} c ${SECRET}-ext d`, want: `a ${REMOVED} b ${REMOVED} c ${REMOVED}-ext d` },
    { keys: [SECRET, OUTER], input: `a ${OUTER} b ${SECRET} c pre-x`, want: `a ${REMOVED} b ${REMOVED} c pre-x` },
  ];
  for (const { keys, input, want } of cases) {
    const bytes = Buffer.from(input);
    for (let size = 1; size <= bytes.length; size++) {
      const s = createByteScrubber(keys);
      const out = [];
      for (let i = 0; i < bytes.length; i += size) out.push(s.push(bytes.subarray(i, i + size)));
      out.push(s.flush());
      assert.equal(Buffer.concat(out).toString(), want, `keys ${keys.length}, chunk size ${size}`);
    }
  }
  const none = createByteScrubber([]);
  assert.ok(none.push(Buffer.from('xyz')).equals(Buffer.from('xyz')));
});

// ── per-route rules (Codex, Copilot and Cursor routes, relay-route.mjs engineModelRoute) ──

test('a route`s own allowlist: its methods and paths only, GET without a body, refusals in its protocol`s shape', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay } = await startRelay(t);
  const { baseUrl } = relay.addRoute(route(up.url, { protocol: 'openai', call: 'an OpenAI Responses call', allow: [['POST', '/responses'], ['GET', '/models']] }));
  assert.equal((await post(`${baseUrl}/responses`)).status, 200);
  const g = await fetch(`${baseUrl}/models`);
  assert.equal(g.status, 200);
  assert.equal(up.seen.at(-1).method, 'GET'); assert.equal(up.seen.at(-1).body.length, 0);
  for (const [method, path] of [['POST', '/v1/messages'], ['POST', '/models'], ['DELETE', '/models'], ['GET', '/responses']]) {
    const r = await fetch(`${baseUrl}${path}`, { method, ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.equal(r.status, 403, `${method} ${path}`);
    const j = await r.json();
    assert.match(j.error.message, new RegExp(`^worca-relay: ${method} ${path} is not an OpenAI Responses call$`));
    assert.equal(j.error.type, 'permission_error');
  }
  assert.deepEqual(up.seen.map((s) => `${s.method} ${s.url}`), ['POST /responses', 'GET /models']);
  const c = relay.addRoute(route(up.url, { protocol: 'connect', allow: [['POST', /^\/agent\.v1\.AgentService\/RunSSE$/]] }));
  assert.equal((await post(`${c.baseUrl}/agent.v1.AgentService/RunSSE`)).status, 200, 'a RegExp path');
  const refused = await post(`${c.baseUrl}/agent.v1.AgentService/Run`);
  assert.equal(refused.status, 403);
  assert.deepEqual(Object.keys(await refused.json()), ['code', 'message'], 'a Connect-shaped refusal');
});

test('a route`s forwarded request headers and kept response headers; the dummy credential never reaches the upstream', POSIX, async (t) => {
  const up = await stubUpstream(t, (req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'connect-content-encoding': 'identity', 'x-other': '1' }); res.end('{}'); });
  const { relay } = await startRelay(t);
  const statuses = [];
  const { baseUrl } = relay.addRoute(route(up.url, { allow: [['POST', '/x']], forwardHeaders: ['x-initiator'], responseHeaders: ['connect-content-encoding'],
    extraHeaders: { 'copilot-integration-id': 'copilot-developer-cli' }, onStatus: (s) => statuses.push(s) }));
  const r = await post(`${baseUrl}/x`, { headers: { 'content-type': 'application/json', 'x-initiator': 'user', 'x-client-machine-id': 'm', 'x-api-key': 'dummy-from-the-sandbox', authorization: 'Bearer dummy-from-the-sandbox' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('connect-content-encoding'), 'identity');
  assert.equal(r.headers.get('x-other'), null);
  const h = up.seen[0].headers;
  assert.equal(h['x-initiator'], 'user');
  assert.equal(h['x-client-machine-id'], undefined);
  assert.equal(h['x-api-key'], undefined);
  assert.equal(h.authorization, `Bearer ${SECRET}`);
  assert.equal(h['copilot-integration-id'], 'copilot-developer-cli');
  assert.deepEqual(statuses, [200]);
});

test('async auth and upstream: a token worca derives is scrubbed from replies; a failure is a refusal without the secret', POSIX, async (t) => {
  const DERIVED = 'derived-access-token-0123456789'; const LATER = 'refresh-token-added-later-0123';
  const up = await stubUpstream(t, (req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`echo ${req.headers.authorization} ${LATER}`); });
  const { relay } = await startRelay(t);
  const secrets = [SECRET];
  const { baseUrl } = relay.addRoute(route(async () => up.url, { allow: [['POST', '/x']], secrets,
    authHeaders: async () => { await pause(5); secrets.push(LATER); return { authorization: `Bearer ${DERIVED}` }; } }));
  const r = await post(`${baseUrl}/x`);
  const text = await r.text();
  assert.equal(up.seen[0].headers.authorization, `Bearer ${DERIVED}`);
  assert.equal(text.includes(DERIVED), false, text);
  assert.equal(text.includes(LATER), false, 'a secret the route added at call time is scrubbed too');
  const bad = relay.addRoute(route(up.url, { allow: [['POST', '/x']], authHeaders: async () => { throw new Error(`exchange refused for ${SECRET}`); } }));
  const j = await relayError(await post(`${bad.baseUrl}/x`), 502);
  assert.match(j.error.message, /^worca-relay: worca could not sign the call: exchange refused for \[removed/);
  const noHost = relay.addRoute(route(async () => { throw new Error('no Copilot host'); }, { allow: [['POST', '/x']] }));
  assert.match((await relayError(await post(`${noHost.baseUrl}/x`), 502)).error.message, /no Copilot host/);
  assert.equal(up.seen.length, 1, 'a failed sign-in never reaches the upstream');
});

// ── the step's model (core protection layer, Task 9: catalog relay.modelCheck 'body') ──
const OPENAI_ALLOW = [['POST', '/responses'], ['GET', '/models']];
const openaiRefusal = async (r, status, re) => {
  assert.equal(r.status, status);
  const j = await r.json();
  assert.match(j.error.message, re);
  return j;
};

test('relay refuses another model', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay } = await startRelay(t);
  const { baseUrl } = relay.addRoute(route(up.url, { protocol: 'anthropic', modelCheck: 'body', models: ['claude-haiku-4-5'] }));
  const j = await relayError(await post(`${baseUrl}/v1/messages`, { body: '{"model":"claude-opus-4"}' }), 403);
  assert.match(j.error.message, /^worca-relay: model "claude-opus-4" is not this step's model/);
  assert.equal(up.seen.length, 0, 'the upstream saw no request');
  const ok = await post(`${baseUrl}/v1/messages`, { body: '{"model":"claude-haiku-4-5"}' });
  assert.equal(ok.status, 200);
});

test('relay passes aux models', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay } = await startRelay(t);
  const { baseUrl } = relay.addRoute(route(up.url, { protocol: 'openai', allow: OPENAI_ALLOW, modelCheck: 'body', models: ['gpt-6.1-sol', 'gpt-aux'] }));
  const r = await post(`${baseUrl}/responses`, { body: '{"model":"gpt-aux"}' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test('relay forwards the body it checked', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay } = await startRelay(t);
  const { baseUrl } = relay.addRoute(route(up.url, { protocol: 'openai', allow: OPENAI_ALLOW, modelCheck: 'body', models: ['gpt-6.1-sol'] }));
  const r = await post(`${baseUrl}/responses`, { body: '{"model":"evil","model":"gpt-6.1-sol"}' });
  assert.equal(r.status, 200);
  assert.equal(up.seen[0].body.toString(), '{"model":"gpt-6.1-sol"}', 're-serialised: the upstream reads the model worca checked');
  // A Go upstream (encoding/json) matches field names case-insensitively, the last one winning: a second, differently
  // cased model key would run another model than the one worca checked.
  for (const extra of ['"MODEL":"evil"', '"Model":"evil"']) {
    await openaiRefusal(await post(`${baseUrl}/responses`, { body: `{"model":"gpt-6.1-sol",${extra}}` }), 400,
      /^worca-relay: the request body names its model more than once/);
  }
  assert.equal(up.seen.length, 1, 'a case-variant model key never reaches the upstream');
});

test('relay checks only body routes', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay } = await startRelay(t);
  const proto = Buffer.from([0x0a, 0x03, 0x61, 0x62, 0x63]);
  const connect = relay.addRoute(route(up.url, { protocol: 'connect', allow: [['POST', /^\/x\.v1\.S\/M$/]], modelCheck: 'partial' }));
  const c = await post(`${connect.baseUrl}/x.v1.S/M`, { body: proto, headers: { 'content-type': 'application/proto' } });
  assert.equal(c.status, 200);
  assert.deepEqual(up.seen[0].body, proto, 'a partial route forwards a protobuf body untouched');
  const body = relay.addRoute(route(up.url, { protocol: 'openai', allow: OPENAI_ALLOW, modelCheck: 'body', models: ['gpt-6.1-sol'] }));
  await openaiRefusal(await post(`${body.baseUrl}/responses`, { body: 'not json' }), 400, /^worca-relay: the request body is not JSON/);
  const g = await fetch(`${body.baseUrl}/models`);
  assert.equal(g.status, 200, 'GET /models has no body to check');
});

// R11: a per-mode route's path pin (Gemini's /models/{m}:, Azure's deployment, Databricks' endpoint), the broker's
// path rule, and a body the relay can meter.
test('a path-checked route admits the step model\'s path only, on every method; another model never reaches the upstream', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay } = await startRelay(t);
  const gem = relay.addRoute(route(up.url, { protocol: 'gemini', allow: [['POST', /^\/v1beta\/models\/[A-Za-z0-9._-]+:(streamGenerateContent|generateContent|countTokens)$/]],
    modelCheck: 'path', pathModel: /\/models\/([^/:]+):/, models: ['gemini-2.5-flash'], stepModel: 'gemini-2.5-flash' }));
  const other = await post(`${gem.baseUrl}/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse`, { body: '{}' });
  assert.equal(other.status, 403);
  assert.match((await other.json()).error.message, /^worca-relay: model "gemini-3-pro" is not this step's model/);
  assert.equal((await post(`${gem.baseUrl}/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse`, { body: '{}' })).status, 200);
  const db = relay.addRoute(route(up.url, { protocol: 'openai', allow: [['GET', /^\/api\/2\.0\/serving-endpoints\/[A-Za-z0-9._-]+$/], ['POST', /^\/serving-endpoints\/[A-Za-z0-9._-]+\/invocations$/]],
    modelCheck: 'path', pathModel: /^\/(?:api\/2\.0\/)?serving-endpoints\/([^/]+)/, models: ['my-llm'], stepModel: 'my-llm' }));
  assert.equal((await fetch(`${db.baseUrl}/api/2.0/serving-endpoints/other-rag`)).status, 403, 'another endpoint`s config');
  assert.equal((await post(`${db.baseUrl}/serving-endpoints/other-rag/invocations`)).status, 403, 'another endpoint');
  assert.equal((await fetch(`${db.baseUrl}/api/2.0/serving-endpoints/my-llm`)).status, 200);
  assert.deepEqual(up.seen.map((x) => x.url), ['/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse', '/api/2.0/serving-endpoints/my-llm']);
});

test('a dot, empty or encoded path segment is refused before the route reads the path (R11-5)', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay } = await startRelay(t);
  const r = relay.addRoute(route(up.url, { protocol: 'openai', allow: [['POST', /^\/openai\/deployments\/[^/]+\/chat\/completions$/], ['POST', /^\/serving-endpoints\/[^/]+\/invocations$/]] }));
  const port = new URL(r.baseUrl).port;
  const at = new URL(r.baseUrl).pathname;
  for (const p of ['/openai/deployments/../chat/completions', '/serving-endpoints/%2E%2E/invocations', '/serving-endpoints/%2e./invocations',
    '/openai/deployments/x%2Fy/chat/completions']) {
    const res = await rawRequest(port, `${at}${p}`);
    assert.equal(res.status, 403, p);
  }
  assert.equal(up.seen.length, 0, 'nothing reached the upstream');
});

test('a streamed Chat Completions call asks for its usage, and a background Responses call is refused (R11-2)', POSIX, async (t) => {
  const up = await stubUpstream(t);
  const { relay } = await startRelay(t);
  const r = relay.addRoute(route(up.url, { protocol: 'openai', origin: 'https://api.openai.com', allow: [['POST', '/v1/chat/completions'], ['POST', '/v1/responses'],
    ['POST', /^\/serving-endpoints\/[A-Za-z0-9._-]+\/invocations$/]], modelCheck: 'body', models: ['gpt-x'], stepModel: 'gpt-x' }));
  assert.equal((await post(`${r.baseUrl}/v1/chat/completions`, { body: '{"model":"gpt-x","stream":true}' })).status, 200);
  assert.deepEqual(JSON.parse(up.seen[0].body), { model: 'gpt-x', stream: true, stream_options: { include_usage: true } });
  assert.equal((await post(`${r.baseUrl}/serving-endpoints/e/invocations`, { body: '{"model":"gpt-x","stream":true,"stream_options":{"include_usage":false}}' })).status, 200);
  assert.deepEqual(JSON.parse(up.seen[1].body).stream_options, { include_usage: true }, 'a Databricks invocation too, whatever the sandbox sent');
  await openaiRefusal(await post(`${r.baseUrl}/v1/responses`, { body: '{"model":"gpt-x","background":true}' }), 400, /^worca-relay: a background response is not supported/);
  assert.equal(up.seen.length, 2, 'the background call never reached the upstream');
});

// ── closing a route (core protection layer, Task 10: the usage ledger) ──
test('drainRoute waits for the route\'s in-flight reply and refuses new calls meanwhile', POSIX, async (t) => {
  let release;
  const held = new Promise((r) => { release = r; });
  const up = await stubUpstream(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: message_start\ndata: {"type":"message_start","message":{"model":"m","usage":{"input_tokens":5,"output_tokens":1}}}\n\n');
    held.then(() => res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
  });
  const { relay } = await startRelay(t);
  const { id, baseUrl } = relay.addRoute(route(up.url));
  const first = post(`${baseUrl}/v1/messages`);
  for (let i = 0; !up.seen.length && i < 400; i++) await pause(10);
  assert.equal(up.seen.length, 1, 'the first call is streaming');
  let settled = false;
  relay.drainRoute(id, 60_000).then(() => { settled = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false, 'the drain waits while a reply is in flight');
  const second = await post(`${baseUrl}/v1/messages`);
  assert.equal(second.status, 403, 'a drained route takes no new call');
  assert.match((await second.json()).error.message, /unknown or ended route/);
  assert.equal(up.seen.length, 1, 'the second call never reached the upstream');
  release();
  const r = await first;
  await r.text();
  // The reply's end wakes the drain, not its 60 s timer (never `await` the drain: without the wake-up it would hang).
  for (let i = 0; !settled && i < 200; i++) await pause(10);
  assert.equal(settled, true, 'the drain ends once the reply did');
});
