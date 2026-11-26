// test/api-proxy-sidecar.test.mjs — Settings › Network proxy over HTTP in a container with the egress sidecar (#1619):
// /api/proxy/status|login|logout|test|settings|detect forward to the sidecar, the password passes through the server
// in memory only, nothing is written in the box, and agent callers are still refused. Real server, real sidecar,
// the fake NTLM proxy; no Docker.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { startFakeUpstream } from './helpers/fake-upstream-proxy.mjs';
import { startSidecar, echoOrigin, SECRET } from './helpers/egress-sidecar.mjs';
import { proxyLoginFile } from '../src/core/proxy-credentials.mjs';
import { readSettings } from '../src/core/settings.mjs';

useTempHome(after);

const HASH = 'a4f49c406510bdcab6824ee7c30fd852';
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_MOCK', 'WORCA_EGRESS_API_URL', 'WORCA_EGRESS_SECRET', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'];
const prev = {};
let home, srv, base, origin, fake, side;
const call = async (method, p, b) => {
  const r = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  const text = await r.text();
  let body = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body, text };
};

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-proxy-sidecar-home-'));
  for (const k of KEYS) prev[k] = process.env[k];
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'WORCA_EGRESS_API_URL', 'WORCA_EGRESS_SECRET']) delete process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  origin = await echoOrigin();
  fake = await startFakeUpstream({ originPort: origin.port });
  side = await startSidecar({ HTTPS_PROXY: fake.url() });
  // The box's environment from compose.proxy.yml.
  process.env.WORCA_EGRESS_API_URL = `http://127.0.0.1:${side.apiPort}`;
  process.env.WORCA_EGRESS_SECRET = SECRET;
});
after(async () => {
  await side?.close(); await fake?.close(); await origin?.close();
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  for (const k of KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true, maxRetries: 10 });
});

test('the routes forward to the sidecar: status, login, test, settings, detect, logout', async () => {
  const st = await call('GET', '/api/proxy/status');
  assert.equal(st.status, 200, st.text);
  assert.equal(st.body.sidecar, true);
  assert.equal(st.body.settings.upstream, `http://127.0.0.1:${fake.port}`);
  const li = await call('POST', '/api/proxy/login', { domain: 'Domain', user: 'User', password: 'Password' });
  assert.equal(li.status, 200, li.text);
  assert.equal(li.body.login.label, 'Domain\\User');
  assert.ok(!li.text.includes(HASH) && !li.text.includes('Password'));
  assert.equal(existsSync(proxyLoginFile()), false, 'nothing in the box');
  assert.equal(readSettings().networkProxy, undefined, 'and nothing in the box settings');
  const t = await call('POST', '/api/proxy/test', {});
  assert.equal(t.status, 200, t.text);
  assert.equal(t.body.ok, true);
  const d = await call('GET', '/api/proxy/detect');
  assert.equal(d.body.source, 'sidecar');
  assert.equal(d.body.port, fake.port);
  const put = await call('PUT', '/api/proxy/settings', { networkProxy: { timeouts: { authMs: 20_000 } } });
  assert.equal(put.status, 200, put.text);
  assert.equal(put.body.applied, true);
  const untested = await call('PUT', '/api/proxy/settings', { networkProxy: { upstream: 'http://proxy.acme.invalid:8080' } });
  assert.equal(untested.status, 409);
  assert.equal(untested.body.code, 'UNTESTED');
  const bad = await call('POST', '/api/proxy/login', { domain: 'Domain', user: '', password: 'x' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, 'user');
  const out = await call('POST', '/api/proxy/logout', {});
  assert.equal(out.status, 200);
  assert.equal(out.body.login, null);
});

test('an agent caller is still refused before anything reaches the sidecar', async () => {
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(home, 'agent');
  try {
    const r = await call('POST', '/api/proxy/login', { domain: 'Domain', user: 'User', password: 'Password' });
    assert.equal(r.status, 403);
    assert.match(r.body.code, /AGENT/);   // refused by the server's agent guard
  } finally { delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; }
  assert.equal((await side.api('GET', '/v1/status')).body.login, null, 'the sidecar never saw it');
});
