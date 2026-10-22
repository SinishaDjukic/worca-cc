// test/api-extension-pairing.test.mjs
// ui/server.mjs + the browser-extension gate (src/core/extension-pairing.mjs), local mode.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after);
const CHROME = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
// Pair budget: PAIR_RATE allows 10 requests per origin per 10 min. The tests below the first block pair with this one.
const CHROME_B = 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
let srv, port, mod;

before(async () => {
  process.env.HOME = process.env.WORCA_HOME;           // settings.json under the temp dir too
  process.env.USERPROFILE = process.env.WORCA_HOME;
  process.env.WORCA_MOCK = '1';
  delete process.env.WORCA_AGENT_USER;
  delete process.env.WORCA_AGENT_HOME;
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});
after(async () => { if (srv) await new Promise((r) => srv.close(r)); delete process.env.WORCA_MOCK; });

function call(method, path, { origin, token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const h = { host: `127.0.0.1:${port}`, ...headers };
    if (origin) h.origin = origin;
    if (token) h.authorization = `Bearer ${token}`;
    if (data) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: h }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, body: json }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function pair(origin = CHROME) {
  const r = await call('POST', '/api/extension/pair', { origin, body: { name: 'Worca for Chrome', browser: 'chrome' } });
  assert.equal(r.status, 201);
  const ok = await call('POST', `/api/extension/pair/${r.body.requestId}/approve`);   // the UI: same origin, no Origin header
  assert.equal(ok.status, 200);
  const got = await call('GET', `/api/extension/pair/${r.body.requestId}`, { origin, headers: { 'x-worca-pair-poll': r.body.pollKey } });
  assert.equal(got.body.status, 'approved');
  return got.body;
}

/** An open socket plus the frames it received. Extension sockets offer [worca-ext, token]; UI sockets offer nothing. */
async function openSocket({ origin, token } = {}) {
  const ws = token
    ? new WebSocket(`ws://127.0.0.1:${port}/ws`, ['worca-ext', token], { headers: { origin } })
    : new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const frames = [];
  ws.on('message', (m) => frames.push(JSON.parse(String(m))));
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  return { ws, frames };
}
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

test('a plain web origin is refused by S1 with no CORS headers (unchanged)', async () => {
  const r = await call('GET', '/api/projects', { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'forbidden: worca is a localhost-only tool');
  assert.equal(r.headers['access-control-allow-origin'], undefined);
});

test('an unpaired extension reaches hello (no server details) but not /api/health', async () => {
  const h = await call('GET', '/api/extension/hello', { origin: CHROME });
  assert.equal(h.status, 200);
  assert.deepEqual(h.body, { worca: true });
  assert.equal((await call('GET', '/api/health', { origin: CHROME })).body.code, 'extension-route');
});

test('preflight from an extension origin: exact ACAO, Vary: Origin, never credentials or *', async () => {
  const r = await call('OPTIONS', '/api/ask/threads', { origin: CHROME, headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers['access-control-allow-origin'], CHROME);
  assert.match(String(r.headers.vary), /Origin/);
  assert.equal(r.headers['access-control-allow-credentials'], undefined);
  const bad = await call('OPTIONS', '/api/settings', { origin: CHROME, headers: { 'access-control-request-method': 'GET' } });
  assert.equal(bad.status, 403);
  const x = await call('OPTIONS', '/api/extension/hello', { origin: CHROME, headers: { 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-worca-extension' } });
  assert.equal(x.status, 204);
  assert.match(String(x.headers['access-control-allow-headers']), /\bx-worca-extension\b/);
});

// The sidebar opened on the tab showing Worca: activeTab grants the extension that origin, and Chrome then sends its
// GETs with no Origin. X-Worca-Extension names it, and the same rules hold (hello, token routes, pairing poll).
test('no Origin + X-Worca-Extension: hello, the token routes and the pairing poll work as for an Origin; a mismatch is refused', async () => {
  const xh = (o = CHROME) => ({ 'x-worca-extension': o });
  const h = await call('GET', '/api/extension/hello', { headers: xh() });
  assert.deepEqual([h.status, h.body], [200, { worca: true }]);
  assert.equal((await call('GET', '/api/extension/hello')).body.code, 'extension-origin', 'no Origin, no header: unchanged');
  const r = await call('POST', '/api/extension/pair', { origin: CHROME_B, body: { name: 'Worca for Chrome', browser: 'chrome' } });
  assert.equal(r.status, 201);
  assert.equal((await call('POST', `/api/extension/pair/${r.body.requestId}/approve`)).status, 200);
  const got = await call('GET', `/api/extension/pair/${r.body.requestId}`, { headers: { ...xh(CHROME_B), 'x-worca-pair-poll': r.body.pollKey } });
  assert.equal(got.body.status, 'approved', 'the poll is bound to the named origin');
  const { token } = got.body;
  const ok = await call('GET', '/api/ask/threads', { token, headers: xh(CHROME_B) });
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.body.threads));
  assert.equal((await call('GET', '/api/ask/threads', { headers: xh(CHROME_B) })).body.code, 'extension-unpaired');
  assert.equal((await call('GET', '/api/ask/threads', { token, headers: xh(CHROME) })).status, 401, 'the token is bound to its origin');
  assert.equal((await call('GET', '/api/settings', { token, headers: xh(CHROME_B) })).body.code, 'extension-route');
  const mismatch = await call('GET', '/api/ask/threads', { origin: CHROME, token, headers: xh(CHROME_B) });
  assert.deepEqual([mismatch.status, mismatch.body.code], [403, 'extension-origin']);
  assert.equal(mismatch.headers['access-control-allow-origin'], undefined);
});

test('pair → token reaches the allowlist only; cards, commands, HEAD refused; missing/foreign token is 401', async () => {
  const { token } = await pair();
  const ok = await call('GET', '/api/ask/threads', { origin: CHROME, token });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['access-control-allow-origin'], CHROME);
  assert.equal((await call('GET', '/api/ask/threads', { origin: CHROME })).body.code, 'extension-unpaired');
  assert.equal((await call('GET', '/api/ask/threads', { origin: 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', token })).status, 401);
  assert.equal((await call('GET', '/api/settings', { origin: CHROME, token })).body.code, 'extension-route');
  const inst = await call('GET', '/api/extension/install', { origin: CHROME, token });
  assert.equal(inst.status, 403, 'the install info is UI-only');
  assert.equal(inst.body.code, 'extension-route');
  assert.equal((await call('POST', '/api/run', { origin: CHROME, token, body: {} })).status, 403);
  const card = await call('POST', '/api/ask/threads/askt_x/cards/card_x', { origin: CHROME, token, body: { action: 'start' } });
  assert.deepEqual([card.status, card.body.code], [403, 'extension-route']);                       // M2
  assert.equal((await call('GET', '/api/ask/commands/status', { origin: CHROME, token })).body.code, 'extension-route');   // s2
  assert.equal((await call('HEAD', '/api/ask/threads', { origin: CHROME, token })).status, 403);   // s2
  const st = await call('GET', '/api/extension/status', { origin: CHROME, token });
  assert.equal(st.body.paired, true);
});

test('the running-Action match: extension-only, one http(s) origin in, the instance list stays refused (D7)', async () => {
  const { token } = await pair(CHROME_B);
  const ok = await call('GET', `/api/extension/actions/match?origin=${encodeURIComponent('http://localhost:5999')}`, { origin: CHROME_B, token });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { match: null });
  assert.equal((await call('GET', '/api/extension/actions/match?origin=javascript:alert(1)', { origin: CHROME_B, token })).status, 400);
  const plain = await call('GET', `/api/extension/actions/match?origin=${encodeURIComponent('http://localhost:5999')}`);
  assert.deepEqual([plain.status, plain.body.code], [403, 'extension-only']);
  const list = await call('GET', '/api/actions/running', { origin: CHROME_B, token });
  assert.deepEqual([list.status, list.body.code], [403, 'extension-route']);
});

test('approve/deny/revoke/list are refused for an extension caller, a cross-origin caller and an agent caller', async () => {
  const r = await call('POST', '/api/extension/pair', { origin: CHROME, body: { browser: 'chrome' } });
  assert.equal((await call('POST', `/api/extension/pair/${r.body.requestId}/approve`, { origin: CHROME })).status, 403);
  assert.equal((await call('POST', `/api/extension/pair/${r.body.requestId}/approve`, { origin: 'http://localhost:9999' })).status, 403);
  assert.equal((await call('GET', '/api/extension/pairings', { origin: CHROME })).status, 403);
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(process.env.WORCA_HOME, 'agent-home');
  try {
    const a = await call('POST', `/api/extension/pair/${r.body.requestId}/approve`);
    assert.equal(a.status, 403);
    assert.equal(a.body.code, 'AGENT_CALLER_BLOCKED');
  } finally { delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; }
});

test('the pairings file holds a hash, not the token, at mode 0600', async () => {
  const { token } = await pair();
  const file = join(worcaHome(), 'extension-pairings.json');   // exactly the file the server wrote
  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes(token));
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('WS: token in the subprotocol; only ask-* frames reach an extension socket; revoke closes it', async () => {
  const { token, id } = await pair();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ['worca-ext', token], { headers: { origin: CHROME } });
  const frames = [];
  ws.on('message', (m) => frames.push(JSON.parse(String(m))));
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  assert.equal(ws.protocol, 'worca-ext');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(frames[0].type, 'hello');
  assert.equal(frames[0].runs, undefined);
  mod._testing.broadcast({ type: 'notification', notification: { id: 'n1' } });
  mod._testing.broadcast({ type: 'ask-title', threadId: 't_x', title: 'T' });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(frames.slice(1).map((f) => f.type), ['ask-title']);
  const closed = new Promise((r) => ws.once('close', (code) => r(code)));
  assert.equal((await call('DELETE', `/api/extension/pairings/${id}`)).status, 200);
  assert.equal(await closed, 4003);
  assert.equal((await call('GET', '/api/ask/threads', { origin: CHROME, token })).status, 401);
});

test('re-pair: the old token stops working AND its open socket is closed with 4003 (review m3)', async () => {
  const old = await pair();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ['worca-ext', old.token], { headers: { origin: CHROME } });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const closed = new Promise((r) => ws.once('close', (code) => r(code)));
  const fresh = await pair();                                   // same origin: rotates the token
  assert.equal(await closed, 4003);
  assert.equal((await call('GET', '/api/ask/threads', { origin: CHROME, token: old.token })).status, 401);
  assert.equal((await call('GET', '/api/ask/threads', { origin: CHROME, token: fresh.token })).status, 200);
});

test('an extension cannot create a composer (Workflows) thread', async () => {
  const { token } = await pair();
  const r = await call('POST', '/api/ask/threads', { origin: CHROME, token, body: { mode: 'composer' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'extension-route');
  assert.equal((await call('POST', '/api/ask/threads', { origin: CHROME, token, body: {} })).status, 201);
});

test('WS without a token from an extension origin is refused', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ['worca-ext'], { headers: { origin: CHROME } });
  const status = await new Promise((r) => ws.once('unexpected-response', (_q, res) => r(res.statusCode)));
  assert.equal(status, 401);
});

test('approve tells every Worca tab which request was answered (extension-pairings-changed + requestId)', async () => {
  const ui = await openSocket();
  const r = await call('POST', '/api/extension/pair', { origin: CHROME_B, body: { name: 'Worca for Chrome', browser: 'chrome' } });
  assert.equal(r.status, 201);
  await tick();
  assert.ok(ui.frames.some((f) => f.type === 'extension-pair-request' && f.request.requestId === r.body.requestId));
  assert.equal((await call('POST', `/api/extension/pair/${r.body.requestId}/approve`)).status, 200);
  await tick();
  const changed = ui.frames.filter((f) => f.type === 'extension-pairings-changed');
  assert.deepEqual(changed.map((f) => f.requestId), [r.body.requestId]);
  const got = await call('GET', `/api/extension/pair/${r.body.requestId}`, { origin: CHROME_B, headers: { 'x-worca-pair-poll': r.body.pollKey } });
  assert.equal(got.body.status, 'approved');
  ui.ws.close();
});

test('composer threads are closed to an extension: list, get, patch, messages, stop, frames; exact paths only', async () => {
  // A local caller (the Workflows editor) creates the composer thread; the extension's token must never reach it.
  const made = await call('POST', '/api/ask/threads', { body: { mode: 'composer', title: 'ACME flow' } });
  assert.equal(made.status, 201);
  const cid = made.body.thread.id;
  const plain = await call('POST', '/api/ask/threads', { body: { title: 'ACME chat' } });
  const pid = plain.body.thread.id;
  const { token } = await pair(CHROME_B);
  const as = { origin: CHROME_B, token };

  const list = await call('GET', '/api/ask/threads?mode=composer', as);
  assert.equal(list.status, 200);
  assert.ok(!list.body.threads.some((t) => t.id === cid));
  const refused = async (method, path, body) => {
    const r = await call(method, path, { ...as, body });
    assert.deepEqual([r.status, r.body && r.body.code], [403, 'extension-route'], `${method} ${path}`);
  };
  await refused('GET', `/api/ask/threads/${cid}`);
  await refused('PATCH', `/api/ask/threads/${cid}`, { title: 'x' });
  assert.equal((await call('GET', `/api/ask/threads/${cid}`)).body.thread.title, 'ACME flow');
  await refused('POST', `/api/ask/threads/${cid}/messages`, { text: 'hi' });
  await refused('POST', `/api/ask/threads/${cid}/stop`, {});
  await refused('GET', '/api/ask/threads/');   // Express routing is non-strict; the gate matches paths exactly

  const ext = await openSocket(as);
  await tick();
  mod._testing.broadcast({ type: 'ask-delta', threadId: cid, text: 'x' });
  mod._testing.broadcast({ type: 'ask-delta', threadId: pid, text: 'y' });
  await tick();
  assert.deepEqual(ext.frames.filter((f) => f.type === 'ask-delta').map((f) => f.threadId), [pid]);
  ext.ws.close();
});

test('Pinpoint: a token holder gets the web surface whatever it sends (step 8)', async () => {
  const { token } = await pair(CHROME_B);
  const res = await fetch(`http://127.0.0.1:${port}/api/pinpoint`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: CHROME_B, authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'explain', quote: 'rate limits', surface: 'chat' }),
  });
  assert.equal(res.status, 200);
  const text = (await res.text()).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
    .filter((l) => l.type === 'delta').map((l) => l.text).join('');
  assert.match(text, /web surface/);
});

test('GET /api/extension/install: a local UI call answers paths, version, steps and release zips', async () => {
  const r = await call('GET', '/api/extension/install');
  assert.equal(r.status, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(r.body.version, pkg.version);
  assert.equal(r.body.remoteMode, false);
  assert.equal(r.body.buildCommand, 'npm run ext:build');
  assert.deepEqual(r.body.builds.map((b) => b.browser), ['chrome', 'edge', 'firefox']);
  for (const b of r.body.builds) {
    assert.ok(isAbsolute(b.path) && b.path.endsWith(join('extension', 'dist', b.browser)), b.path);
    assert.equal(typeof b.present, 'boolean');
    assert.ok(b.steps.length > 0);
    assert.match(b.downloadUrl, new RegExp(`/releases/download/worca-app-v${pkg.version.replace(/\./g, '\\.')}/worca-${b.browser}-`));
  }
});

test('GET /api/extension/install stays behind the host guard', async () => {
  const r = await call('GET', '/api/extension/install', { headers: { host: 'evil.example' } });
  assert.equal(r.status, 403);
});
