// test/server-health-shutdown.test.mjs
// GET /api/health and POST /api/shutdown (the server side of `worca ui
// status|stop`). App imported (no port bind) on an ephemeral http server, temp
// WORCA_HOME — the api-guardrails pattern. uiControl is reached through _testing
// so the shutdown branch can be exercised without exiting the test runner.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

import { useTempHome } from './helpers/temp-home.mjs';
import { UI_HEALTH_NAME } from '../src/core/ui-instance.mjs';

useTempHome(after);

const PKG_VERSION = createRequire(import.meta.url)('../package.json').version;

let srv, base, uiControl, bearerMatches;

before(async () => {
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs'); // imported => no port bind, uiControl empty
  ({ uiControl, bearerMatches } = mod._testing);
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
});

test('GET /api/health identifies the process: name, version, pid, port', async () => {
  const r = await fetch(`${base}/api/health`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.name, UI_HEALTH_NAME);
  assert.equal(body.version, PKG_VERSION);
  assert.equal(body.pid, process.pid);
  assert.equal(body.port, srv.address().port, 'reports the port it was reached on');
  assert.equal(body.startedAt, null, 'not booted via isMain — no start time');
});

test('GET /api/health honours the localhost-only guard like every other route', async () => {
  // fetch() drops a caller-set Host header (forbidden header name) — go raw.
  const status = await new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/health', headers: { host: 'evil.example:80' } }, (r) => { r.resume(); res(r.statusCode); });
    req.on('error', rej);
    req.end();
  });
  assert.equal(status, 403);
});

test('POST /api/shutdown is 503 when the server did not boot as a process (no token)', async () => {
  assert.equal(uiControl.token, null);
  const r = await fetch(`${base}/api/shutdown`, { method: 'POST', headers: { authorization: 'Bearer anything' } });
  assert.equal(r.status, 503);
});

test('POST /api/shutdown: 401 without/with a wrong token, 202 + onShutdown with the right one', async () => {
  const calls = [];
  uiControl.token = 'a'.repeat(64);
  uiControl.onShutdown = (why) => calls.push(why);
  try {
    let r = await fetch(`${base}/api/shutdown`, { method: 'POST' });
    assert.equal(r.status, 401, 'no header');
    r = await fetch(`${base}/api/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${'b'.repeat(64)}` } });
    assert.equal(r.status, 401, 'wrong token');
    r = await fetch(`${base}/api/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(63)}` } });
    assert.equal(r.status, 401, 'length mismatch never reaches timingSafeEqual');
    assert.deepEqual(calls, [], 'refusals never trigger shutdown');

    r = await fetch(`${base}/api/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(64)}` } });
    assert.equal(r.status, 202);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.pid, process.pid);
    await new Promise((res) => setImmediate(res));
    await new Promise((res) => setImmediate(res));
    assert.deepEqual(calls, ['request'], 'shutdown runs AFTER the 202 is answered');
  } finally {
    uiControl.token = null;
    uiControl.onShutdown = null;
  }
});

test('bearerMatches: scheme is case-insensitive, whitespace tolerant, never matches empty', () => {
  assert.equal(bearerMatches('Bearer abc', 'abc'), true);
  assert.equal(bearerMatches('bearer abc', 'abc'), true);
  assert.equal(bearerMatches('  Bearer   abc  ', 'abc'), true);
  assert.equal(bearerMatches('Basic abc', 'abc'), false);
  assert.equal(bearerMatches('Bearer abd', 'abc'), false);
  assert.equal(bearerMatches('Bearer ', ''), false);
  assert.equal(bearerMatches(undefined, 'abc'), false);
  assert.equal(bearerMatches('Bearer abc', null), false);
});
