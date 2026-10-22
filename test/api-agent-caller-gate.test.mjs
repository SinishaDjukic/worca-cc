// test/api-agent-caller-gate.test.mjs — G1: under agent isolation a caller on this machine
// may be the agent itself (its tools reach worca's port on 127.0.0.1), so loopback is no
// identity. Such a caller gets the API only with the server's per-boot token (ui.json, 0600,
// readable by the worca user and not by the agent user); without it every /api route and the
// WebSocket answer 403, except the healthcheck and the per-turn Ask relay routes, which carry
// their own credential. G17: a configured identity header from such a caller is ignored.
// Local mode, app imported (no port bind), loopback fetch, temp HOME.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WebSocket } from 'ws';

import { useTempHome } from './helpers/temp-home.mjs';
import { UI_TOKEN_HEADER, writeUiInstance } from '../src/core/ui-instance.mjs';

useTempHome(after);

const ENV_KEYS = ['WORCA_HOME', 'WORCA_MOCK', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME', 'WORCA_IDENTITY_HEADER', 'WORCA_IDENTITY_TRUSTED_PROXIES'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const JSONH = { 'content-type': 'application/json' };
let homeDir, srv, base, port, token, testing;
// The TCP peer the server sees, when a test sets one (any local user can bind 127.0.0.2; this host may not route it).
let PEER = null;

const isolate = () => { process.env.WORCA_AGENT_USER = 'worca-agent'; process.env.WORCA_AGENT_HOME = '/home/worca-agent'; };
const unisolate = () => { delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; };

async function call(method, path, body, headers = {}) {
  const r = await fetch(`${base}${path}`, { method, headers: { ...JSONH, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body: json };
}
const withToken = () => ({ [UI_TOKEN_HEADER]: token });

function wsOpen(headers = {}) {
  return new Promise((done) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    ws.once('message', (m) => { const hello = JSON.parse(String(m)); ws.close(); done({ ok: true, hello }); });
    ws.once('unexpected-response', (_q, res) => done({ ok: false, status: res.statusCode }));
    ws.once('error', () => done({ ok: false, status: 0 }));
  });
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-g1-'));
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  testing = mod._testing;
  token = testing.uiToken();
  srv = http.createServer(mod.app);
  srv.on('connection', (sock) => {
    const real = sock.remoteAddress;
    Object.defineProperty(sock, 'remoteAddress', { configurable: true, get: () => PEER ?? real });
  });
  mod.server.listeners('upgrade').forEach((l) => srv.on('upgrade', l));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  unisolate();
  if (srv) { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
  for (const k of ENV_KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(homeDir, { recursive: true, force: true });
});

test('a per-boot token exists even when the server is imported, and it is never in process.env', () => {
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.ok(!Object.values(process.env).includes(token), 'an agent spawn inherits env: the token must not be there');
});

test('isolation off (a local install): loopback keeps the whole API without a token', async () => {
  unisolate();
  assert.equal((await call('GET', '/api/settings')).status, 200);
  const g = await call('POST', '/api/guardrails', { name: 'Local Set', settings: {} });
  assert.equal(g.status, 201);
});

test('isolation on: an untokened loopback caller cannot link a plugin, edit guardrails, settings or schedules', async () => {
  isolate();
  try {
    const plugin = resolve('plugins/notion-mcp');
    const attempts = [
      ['POST', '/api/plugins/link', { dir: plugin }],
      ['POST', '/api/guardrails', { name: 'Agent Set', settings: {} }],
      ['POST', '/api/settings', { theme: 'dark' }],
      ['POST', '/api/schedules', { name: 'x' }],
      ['POST', '/api/run', { projectDir: homeDir, prompt: 'x' }],
      ['POST', '/api/drain', {}],
      ['GET', '/api/settings'],
      ['GET', '/api/ask/threads'],
      ['GET', '/api/plugins'],
    ];
    for (const [method, path, body] of attempts) {
      const r = await call(method, path, body);
      assert.equal(r.status, 403, `${method} ${path} answered ${r.status}`);
      assert.equal(r.body?.code, 'AGENT_CALLER_BLOCKED', `${method} ${path}`);
    }
    const listed = await call('GET', '/api/plugins', undefined, withToken());
    assert.ok(!JSON.stringify(listed.body).includes('notion-mcp'), 'the link never landed');
  } finally { unisolate(); }
});

test('isolation on: the healthcheck and the per-turn relay routes stay reachable without the token', async () => {
  isolate();
  try {
    const h = await call('GET', '/api/health');
    assert.equal(h.status, 200);
    assert.equal(h.body.name, '@worca/app');
    // The relay routes answer for themselves: an unknown turn token is their own 403, not the gate's.
    const relay = await call('POST', '/api/ask/relay', { line: '{}' }, { 'x-worca-relay': 'nope' });
    assert.equal(relay.status, 403);
    assert.notEqual(relay.body?.code, 'AGENT_CALLER_BLOCKED');
    const cmds = await call('POST', '/api/ask/commands', { op: 'list' }, { 'x-worca-ask-command': 'nope' });
    assert.notEqual(cmds.body?.code, 'AGENT_CALLER_BLOCKED');
  } finally { unisolate(); }
});

test('isolation on: the per-boot token restores the API (the in-box worca CLI); a wrong token does not', async () => {
  isolate();
  try {
    assert.equal((await call('GET', '/api/settings', undefined, { [UI_TOKEN_HEADER]: 'f'.repeat(64) })).status, 403);
    assert.equal((await call('GET', '/api/settings', undefined, withToken())).status, 200);
    const g = await call('POST', '/api/guardrails', { name: 'Operator Set', settings: {} }, withToken());
    assert.equal(g.status, 201);
  } finally { unisolate(); }
});

test('isolation on: the WebSocket refuses an untokened loopback caller and accepts the token', async () => {
  isolate();
  try {
    const bare = await wsOpen();
    assert.equal(bare.ok, false);
    assert.equal(bare.status, 403);
    const ok = await wsOpen(withToken());
    assert.equal(ok.ok, true);
    assert.equal(ok.hello.type, 'hello');
  } finally { unisolate(); }
});

test('G17: with isolation on, a configured identity header from this machine names nobody', async () => {
  process.env.WORCA_IDENTITY_HEADER = 'X-Forwarded-User';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1';
  try {
    unisolate();
    const local = await call('GET', '/api/whoami', undefined, { 'x-forwarded-user': 'ada@example.com' });
    assert.equal(local.body.name, 'ada@example.com', 'isolation off: unchanged (no boundary to defend)');
    isolate();
    const boxed = await call('GET', '/api/whoami', undefined, { ...withToken(), 'x-forwarded-user': 'ada@example.com' });
    assert.equal(boxed.status, 200);
    assert.equal(boxed.body.source, 'local');
    assert.equal(boxed.body.name, null);
  } finally { unisolate(); delete process.env.WORCA_IDENTITY_HEADER; delete process.env.WORCA_IDENTITY_TRUSTED_PROXIES; }
});

test('X1: the identity header names a person only from WORCA_IDENTITY_TRUSTED_PROXIES', async () => {
  process.env.WORCA_IDENTITY_HEADER = 'X-Forwarded-Email';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1';
  const as = (peer) => { PEER = peer; return call('GET', '/api/whoami', undefined, { 'x-forwarded-email': 'victim@example.com' }); };
  try {
    unisolate();
    assert.equal((await as('127.0.0.1')).body.name, 'victim@example.com', 'the trusted proxy vouches');
    for (const peer of ['127.0.0.2', '::ffff:127.0.0.3', '::1']) {
      const r = await as(peer);
      assert.deepEqual([r.status, r.body.source, r.body.name], [200, 'local', null], `${peer} named a person`);
    }
    process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '10.9.9.9';
    assert.equal((await as('127.0.0.1')).body.source, 'local', 'a peer that is not the listed proxy');
  } finally { PEER = null; delete process.env.WORCA_IDENTITY_HEADER; delete process.env.WORCA_IDENTITY_TRUSTED_PROXIES; }
});

test('the worca CLI sends the instance file token: `worca run --preset` lists presets under isolation', async () => {
  const { cmdRun } = await import('../src/cli/run-preset.mjs');
  await writeUiInstance({ pid: process.pid, host: '127.0.0.1', port, token, version: 't', startedAt: new Date().toISOString() });
  isolate();
  try {
    const errs = [];
    const code = await cmdRun(['--preset', 'nope', '--prompt', 'x'], { out: () => {}, err: (s) => errs.push(s),
      fail: (m) => { throw new Error(m); }, ui: async () => base, cwd: homeDir });
    assert.equal(code, 1);
    // Past the gate: the server answered the preset list (unknown preset, or presets off), not a 403.
    assert.ok(!errs.join('\n').includes('agent isolation'), errs.join('\n'));
    assert.ok(errs.join('\n').match(/no run preset named|run presets are turned off/), errs.join('\n'));
  } finally { unisolate(); }
});

test('G1: every 127/8 peer is this box, not only 127.0.0.1 (HTTP, WebSocket, terminal)', async () => {
  isolate();
  try {
    for (const peer of ['127.0.0.2', '::ffff:127.0.0.2', '127.1.2.3']) {
      PEER = peer;
      const settings = await call('GET', '/api/settings');
      assert.equal(settings.status, 403, `${peer}: GET /api/settings`);
      assert.equal(settings.body?.code, 'AGENT_CALLER_BLOCKED');
      assert.equal((await call('POST', '/api/guardrails', { name: 'Agent Set', settings: {} })).status, 403, `${peer}: POST /api/guardrails`);
      assert.equal((await call('GET', '/api/terminal')).status, 403, `${peer}: GET /api/terminal`);
      const ws = await wsOpen();
      assert.deepEqual([ws.ok, ws.status], [false, 403], `${peer}: the WebSocket`);
      assert.equal((await call('GET', '/api/settings', undefined, withToken())).status, 200, `${peer}: the token still admits`);
    }
  } finally { PEER = null; unisolate(); }
});
