// test/api-proxy.test.mjs — Settings › Network proxy over HTTP (docs/network-proxy.md): the five
// /api/proxy routes behind the corporateProxy flag, agent callers refused, the single-flight and
// restart guards on Test, and the live EGRESS wiring through _testing.setEgress.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { startFakeUpstream } from './helpers/fake-upstream-proxy.mjs';
import { saveProxyLogin, readProxyLogin, proxyLoginReads, proxyLoginFile } from '../src/core/proxy-credentials.mjs';
import { ntHash } from '../src/core/ntlm.mjs';

useTempHome(after);

const PROXY_ENV = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'WORCA_EGRESS_PROXY_URL'];
const JSONH = { 'Content-Type': 'application/json' };
let sandboxHome, srv, base, testing, origin, fake;
const prevEnv = {};

const call = async (method, p, b) => {
  const r = await fetch(`${base}${p}`, { method, headers: JSONH, body: b === undefined ? undefined : JSON.stringify(b) });
  const text = await r.text();
  let body = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body, text };
};
const ROUTES = [['GET', '/api/proxy/status'], ['POST', '/api/proxy/login', {}], ['POST', '/api/proxy/logout', {}],
  ['POST', '/api/proxy/test', {}], ['PUT', '/api/proxy/settings', { networkProxy: null }]];
const loginFile = () => proxyLoginFile();

function echoOrigin() {
  return new Promise((resolve) => {
    const s = net.createServer((c) => { c.on('error', () => {}); c.on('data', (d) => c.write(`echo:${d}`)); });
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
  });
}

async function until(cond, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Point settings at `port` and clear the since-boot marker (a restart). */
async function useUpstream(port) {
  const r = await call('PUT', '/api/proxy/settings', { networkProxy: { upstream: `127.0.0.1:${port}`, auth: null } });
  assert.equal(r.status, 200, r.text);
  testing.setEgress(null);
}

async function withAgent(fn) {
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(sandboxHome, 'agent');
  try { return await fn(); } finally { delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; }
}

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-proxy-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_MOCK', 'WORCA_FLAGS', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME', ...PROXY_ENV]) prevEnv[k] = process.env[k];
  for (const k of PROXY_ENV) delete process.env[k];
  delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'corporateProxy';
  const mod = await import('../ui/server.mjs');
  testing = mod._testing;
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  origin = await echoOrigin();
  fake = await startFakeUpstream({ scheme: 'ntlm', domain: 'ACME', user: 'jdoe', password: 'S3cret!', originPort: origin.port });
});
after(async () => {
  testing?.setEgress(null);
  await fake?.close();
  origin?.server.close();
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10 });
});

test('flag off: all five routes are 404 and the login file is never read', async () => {
  saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: 'S3cret!' });
  process.env.WORCA_FLAGS = '-corporateProxy';
  try {
    const reads = proxyLoginReads();
    for (const [m, p, b] of ROUTES) {
      const r = await call(m, p, b);
      assert.equal(r.status, 404, `${m} ${p}`);
      assert.equal(r.body.error, 'not found');
    }
    assert.equal(proxyLoginReads(), reads);
    assert.ok(existsSync(loginFile()), 'the saved login is untouched');
  } finally { process.env.WORCA_FLAGS = 'corporateProxy'; }
  await call('POST', '/api/proxy/logout', {});
});

test('flag on: settings, the restart guard, login, test and logout', async () => {
  const put = await call('PUT', '/api/proxy/settings', { networkProxy: { upstream: `127.0.0.1:${fake.port}` } });
  assert.equal(put.status, 200, put.text);
  assert.equal(put.body.restartNeeded, true);
  assert.equal(put.body.networkProxy.upstream, `http://127.0.0.1:${fake.port}`);
  const sockets = fake.stats.sockets;
  const early = await call('POST', '/api/proxy/test', {});
  assert.equal(early.status, 409);
  assert.equal(early.body.code, 'RESTART_NEEDED');
  assert.equal(fake.stats.sockets, sockets, 'a host saved since boot gets no connection');
  testing.setEgress(null);   // the restart

  const bad = await call('PUT', '/api/proxy/settings', { networkProxy: { upstream: 'http://u:p@h:1' } });
  assert.equal(bad.status, 400);

  const logged = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(saved)) console[k] = (...a) => logged.push(a.join(' '));
  let login;
  try { login = await call('POST', '/api/proxy/login', { domain: 'ACME', user: 'jdoe', password: 'S3cret!' }); } finally { Object.assign(console, saved); }
  assert.equal(login.status, 200, login.text);
  assert.equal(login.body.state, 'ready');
  assert.equal(login.body.login.label, 'ACME\\jdoe');
  assert.ok(!login.text.includes('ntHash') && !login.text.includes(ntHash('S3cret!').toString('hex')));
  assert.ok(!logged.join('\n').includes('S3cret!'));
  assert.equal(login.body.line, 'ready: via 127.0.0.1:' + fake.port + ' (NTLMv2) as ACME\\jdoe. Restart Worca to start the proxy.');

  const empty = await call('POST', '/api/proxy/login', { domain: 'ACME', user: 'jdoe', password: '' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.field, 'password');

  const t = await call('POST', '/api/proxy/test', {});
  assert.equal(t.status, 200, t.text);
  assert.equal(t.body.results.length, 2);
  assert.ok(t.body.results.every((r) => r.ok), t.text);

  const out = await call('POST', '/api/proxy/logout', {});
  assert.equal(out.status, 200);
  assert.equal(out.body.state, 'no-login');
  assert.equal(existsSync(loginFile()), false);
});

test('agent callers cannot log in, log out, test or change the settings', async () => {
  saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: 'S3cret!' });
  const id = readProxyLogin().id;
  await withAgent(async () => {
    for (const [m, p, b] of ROUTES.slice(1)) {
      const r = await call(m, p, p.endsWith('login') ? { domain: 'ACME', user: 'evil', password: 'x' } : b);
      assert.equal(r.status, 403, `${m} ${p}`);
      assert.equal(r.body.code, 'PROXY_AGENT_BLOCKED');
    }
  });
  assert.equal(readProxyLogin().id, id, 'neither replaced nor deleted');
  await call('POST', '/api/proxy/logout', {});
  await withAgent(async () => {
    assert.equal((await call('POST', '/api/proxy/login', { domain: 'ACME', user: 'jdoe', password: 'x' })).status, 403);
  });
  assert.equal(existsSync(loginFile()), false, 'no file written');
});

test('auth basic: Log in is refused with 409 field auth', async () => {
  assert.equal((await call('PUT', '/api/proxy/settings', { networkProxy: { auth: 'basic' } })).status, 200);
  try {
    const r = await call('POST', '/api/proxy/login', { domain: 'ACME', user: 'jdoe', password: 'S3cret!' });
    assert.equal(r.status, 409);
    assert.equal(r.body.field, 'auth');
    assert.equal(existsSync(loginFile()), false);
  } finally { await call('PUT', '/api/proxy/settings', { networkProxy: { auth: null } }); }
});

test('one test at a time: a second POST test while one runs is 409 TEST_RUNNING', async () => {
  const held = await startFakeUpstream({ scheme: 'ntlm', domain: 'ACME', user: 'jdoe', password: 'S3cret!', originPort: origin.port, holdType3: true });
  try {
    await useUpstream(held.port);
    saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: 'S3cret!' });
    const first = call('POST', '/api/proxy/test', {});
    await until(() => held.stats.type3 === 1);
    const second = await call('POST', '/api/proxy/test', {});
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'TEST_RUNNING');
    held.release();
    await until(() => held.stats.type3 === 2);
    held.release();
    const r = await first;
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.ok, true);
  } finally {
    await call('POST', '/api/proxy/logout', {});
    await useUpstream(fake.port);
    await held.close();
  }
});

test('live EGRESS: status, reloadLogin and the restart guard follow the running proxy', async () => {
  saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: 'S3cret!' });
  const id = readProxyLogin().id;
  // No settings upstream: the upstream comes from the pre-swap env, never the local proxy URL.
  assert.equal((await call('PUT', '/api/proxy/settings', { networkProxy: null })).status, 200);
  const label = `127.0.0.1:${fake.port}`;
  const reloadLogin = mock.fn(() => true);
  const stub = (upstream) => ({ sourceEnv: { HTTPS_PROXY: `http://${label}` }, reloadLogin,
    connector: { status: () => ({ upstream, state: 'tripped', auth: 'auto', loginId: id }) } });
  process.env.HTTPS_PROXY = 'http://127.0.0.1:1';
  try {
    testing.setEgress(stub(label));
    const st = await call('GET', '/api/proxy/status');
    assert.equal(st.body.state, 'needs-login');
    assert.equal(st.body.running, true);
    assert.equal(st.body.upstream, label);
    assert.equal((await call('POST', '/api/proxy/login', { domain: 'ACME', user: 'jdoe', password: 'S3cret!' })).status, 200);
    assert.equal(reloadLogin.mock.callCount(), 1);
    assert.equal((await call('POST', '/api/proxy/logout', {})).status, 200);
    assert.equal(reloadLogin.mock.callCount(), 2);

    testing.setEgress(stub('127.0.0.1:2'));
    const sockets = fake.stats.sockets;
    const r = await call('POST', '/api/proxy/test', {});
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'RESTART_NEEDED');
    assert.equal(fake.stats.sockets, sockets);
  } finally {
    delete process.env.HTTPS_PROXY;
    testing.setEgress(null);
    await useUpstream(fake.port);
  }
});

test('flag on with no proxy started at boot: running false, restartNeeded true', async () => {
  const st = await call('GET', '/api/proxy/status');
  assert.equal(st.status, 200);
  assert.equal(st.body.running, false);
  assert.equal(st.body.restartNeeded, true);
  assert.match(st.body.line, /Restart Worca/);
  assert.equal(st.body.settings.upstream, `http://127.0.0.1:${fake.port}`);
});

test('status: localUrl from a fixed port, or null with the listen error (D13)', async () => {
  assert.equal((await call('PUT', '/api/proxy/settings', { networkProxy: { fixedPort: 3128 } })).status, 200);
  const busy = 'the local proxy cannot listen on 127.0.0.1:3128: another program already uses that port (EADDRINUSE). Free the port or change networkProxy.fixedPort';
  try {
    testing.setEgress(null);
    const st = await call('GET', '/api/proxy/status');
    assert.equal(st.body.localUrl, 'http://127.0.0.1:3128');
    assert.equal(st.body.localError, null);
    testing.setEgress({ status: 'off', upstreamError: busy });
    const off = await call('GET', '/api/proxy/status');
    assert.equal(off.body.localUrl, null);
    assert.equal(off.body.localError, busy);
  } finally {
    testing.setEgress(null);
    await call('PUT', '/api/proxy/settings', { networkProxy: { fixedPort: null } });
  }
});

test('auth digest: Log in is refused with 409 like Basic', async () => {
  assert.equal((await call('PUT', '/api/proxy/settings', { networkProxy: { auth: 'digest' } })).status, 200);
  try {
    const r = await call('POST', '/api/proxy/login', { domain: 'ACME', user: 'jdoe', password: 'S3cret!' });
    assert.equal(r.status, 409);
    assert.equal(r.body.field, 'auth');
    assert.match(r.body.error, /networkProxy\.auth is digest/);
    assert.equal(existsSync(loginFile()), false);
  } finally { await call('PUT', '/api/proxy/settings', { networkProxy: { auth: null } }); }
});

test('POST /api/ask/proxy: per-turn token, loopback, flag, agent refusal; status and test share the routes\' guards', async () => {
  const bad = await fetch(`${base}/api/ask/proxy`, { method: 'POST', headers: { ...JSONH, 'x-worca-ask-proxy': 'nope' }, body: '{"op":"status"}' });
  assert.equal(bad.status, 403);
  const b = testing.askProxyBridge({ threadId: 'ask_00000001' });
  const op = (o, h = {}) => fetch(`${base}/api/ask/proxy`, { method: 'POST', headers: { ...JSONH, 'x-worca-ask-proxy': b.token, ...h }, body: JSON.stringify({ op: o }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const s = await op('status');
  assert.equal(s.body.result.flag, true);
  assert.ok(!JSON.stringify(s.body).includes('ntHash'));
  testing.setEgress(null);   // no running proxy, marker cleared (stands in for a restart)
  await call('PUT', '/api/proxy/settings', { networkProxy: { upstream: '127.0.0.1:19', auth: null } });   // a host no earlier test saved: changed since boot
  assert.equal(testing.proxyHost.changedSinceBoot(), true);
  assert.equal((await op('test')).body.result.code, 'RESTART_NEEDED', 'D14 through the chat, the same marker as the route');
  process.env.WORCA_FLAGS = '-corporateProxy';
  try { assert.deepEqual((await op('status')).body.result, { flag: false }); } finally { process.env.WORCA_FLAGS = 'corporateProxy'; }
  await withAgent(async () => assert.equal((await op('status')).status, 403));
  b.dispose();
  assert.equal((await op('status')).status, 403, 'a finished turn\'s token is dead');
  testing.setEgress(null);
});
