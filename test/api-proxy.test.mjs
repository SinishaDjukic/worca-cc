// test/api-proxy.test.mjs — Settings › Network proxy over HTTP (docs/network-proxy.md): the five
// /api/proxy routes (always there; networkProxy.enabled turns the proxy on), agent callers refused,
// the single-flight lock and the UNTESTED gate, JSON-only bodies, and the live egress wiring through
// _testing.setEgress / setLiveEgress.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { startFakeUpstream } from './helpers/fake-upstream-proxy.mjs';
import { saveProxyLogin, readProxyLogin, proxyLoginReads, proxyLoginFile, savedLoginRefusal } from '../src/core/proxy-credentials.mjs';
import { INTERNAL_KEY } from '../src/core/settings-errors.mjs';
import { ntHash } from '../src/core/ntlm.mjs';
import { startLiveEgress, isWorcaProxy } from '../src/core/egress-policy.mjs';
import { readSettings, setNetworkProxy } from '../src/core/settings.mjs';

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

/** Point settings at `port`, proxy on. Test setup writes settings.json directly (a hand edit, Decision 12):
 *  the NTLM fake fails a test while no login is saved, so the route's UNTESTED gate would refuse it. */
async function useUpstream(port) {
  await setNetworkProxy(null);
  await setNetworkProxy({ enabled: true, upstream: `127.0.0.1:${port}` });
  testing.setEgress(null);
}

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function withAgent(fn) {
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(sandboxHome, 'agent');
  try { return await fn(); } finally { delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; }
}

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-proxy-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_MOCK', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME', ...PROXY_ENV]) prevEnv[k] = process.env[k];
  for (const k of PROXY_ENV) delete process.env[k];
  delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_MOCK = '1';
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

test('routes exist with the proxy off; status says off', async () => {
  await call('PUT', '/api/proxy/settings', { networkProxy: null });
  const st = await call('GET', '/api/proxy/status');
  assert.equal(st.status, 200);
  assert.equal(st.body.state, 'off');
  assert.doesNotMatch(st.body.line, /Restart Worca/);
});

test('proxy off, then on: settings, login, a recorded test, then the switch needs no second test', async () => {
  const put = await call('PUT', '/api/proxy/settings', { networkProxy: { enabled: false, upstream: `127.0.0.1:${fake.port}` } });
  assert.equal(put.status, 200, put.text);
  assert.equal(put.body.restartNeeded, false);
  assert.equal(put.body.networkProxy.upstream, `http://127.0.0.1:${fake.port}`);
  assert.equal((await call('GET', '/api/proxy/status')).body.line, `off: Worca connects directly. Turn on Use a corporate proxy to use 127.0.0.1:${fake.port}.`);

  const bad = await call('PUT', '/api/proxy/settings', { networkProxy: { upstream: 'http://u:p@h:1' } });
  assert.equal(bad.status, 400);

  const logged = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(saved)) console[k] = (...a) => logged.push(a.join(' '));
  let login;
  try { login = await call('POST', '/api/proxy/login', { domain: 'ACME', user: 'jdoe', password: 'S3cret!' }); } finally { Object.assign(console, saved); }
  assert.equal(login.status, 200, login.text);
  assert.equal(login.body.state, 'off', 'a login can be saved before the proxy is on');
  assert.equal(login.body.login.label, 'ACME\\jdoe');
  assert.ok(!login.text.includes('ntHash') && !login.text.includes(ntHash('S3cret!').toString('hex')));
  assert.ok(!logged.join('\n').includes('S3cret!'));

  const empty = await call('POST', '/api/proxy/login', { domain: 'ACME', user: 'jdoe', password: '' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.field, 'password');

  const t = await call('POST', '/api/proxy/test', {});
  assert.equal(t.status, 200, t.text);
  assert.equal(t.body.results.length, 2);
  assert.ok(t.body.results.every((r) => r.ok), t.text);
  const on = await call('PUT', '/api/proxy/settings', { networkProxy: { enabled: true } });
  assert.equal(on.status, 200, 'the saved values passed a recorded test: no UNTESTED');
  const ready = await call('GET', '/api/proxy/status');
  assert.equal(ready.body.line, 'ready: via 127.0.0.1:' + fake.port + ' (NTLMv2) as ACME\\jdoe.');

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
  await setNetworkProxy({ auth: 'basic' });
  try {
    const r = await call('POST', '/api/proxy/login', { domain: 'ACME', user: 'jdoe', password: 'S3cret!' });
    assert.equal(r.status, 409);
    assert.equal(r.body.field, 'auth');
    assert.equal(r.body.code, 'BASIC_NO_SAVED_LOGIN');
    assert.equal(r.body.error, savedLoginRefusal('basic'), 'the same text setup apply returns');
    assert.doesNotMatch(r.body.error, INTERNAL_KEY);
    assert.equal(existsSync(loginFile()), false);
  } finally { await setNetworkProxy({ auth: null }); }
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

test('live EGRESS: status, reloadLogin and the UNTESTED gate follow the running proxy', async () => {
  saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: 'S3cret!' });
  const id = readProxyLogin().id;
  // No settings upstream: the upstream comes from the pre-swap env, never the local proxy URL.
  await setNetworkProxy(null);
  await setNetworkProxy({ enabled: true });
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

    const sockets = fake.stats.sockets;
    const before = JSON.stringify(readSettings());
    const r = await call('PUT', '/api/proxy/settings', { networkProxy: { enabled: true, upstream: '127.0.0.1:2' } });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'UNTESTED');
    assert.equal(JSON.stringify(readSettings()), before, 'a refused save writes nothing');
    assert.equal(fake.stats.sockets, sockets);
  } finally {
    delete process.env.HTTPS_PROXY;
    testing.setEgress(null);
    await useUpstream(fake.port);
  }
});

test('proxy on with no proxy running in this process: running false, no restart wording', async () => {
  const st = await call('GET', '/api/proxy/status');
  assert.equal(st.status, 200);
  assert.equal(st.body.running, false);
  assert.equal(st.body.restartNeeded, false);
  assert.doesNotMatch(st.body.line, /Restart Worca/);
  assert.equal(st.body.settings.upstream, `http://127.0.0.1:${fake.port}`);
});

test('status: localUrl from a fixed port, or null with the listen error (D13)', async () => {
  await setNetworkProxy({ fixedPort: 3128 });
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
    await setNetworkProxy({ fixedPort: null });
  }
});

test('auth digest: Log in is refused with 409 like Basic', async () => {
  await setNetworkProxy({ auth: 'digest' });
  try {
    const r = await call('POST', '/api/proxy/login', { domain: 'ACME', user: 'jdoe', password: 'S3cret!' });
    assert.equal(r.status, 409);
    assert.equal(r.body.field, 'auth');
    assert.equal(r.body.code, 'BASIC_NO_SAVED_LOGIN');
    assert.equal(r.body.error, savedLoginRefusal('digest'));
    assert.doesNotMatch(r.body.error, INTERNAL_KEY);
    assert.equal(existsSync(loginFile()), false);
  } finally { await setNetworkProxy({ auth: null }); }
});

test('POST /api/ask/proxy: per-turn token, loopback, agent refusal; the chat test uses saved values and never records a pass', async () => {
  const bad = await fetch(`${base}/api/ask/proxy`, { method: 'POST', headers: { ...JSONH, 'x-worca-ask-proxy': 'nope' }, body: '{"op":"status"}' });
  assert.equal(bad.status, 403);
  const b = testing.askProxyBridge({ threadId: 'ask_00000001' });
  const op = (o, h = {}) => fetch(`${base}/api/ask/proxy`, { method: 'POST', headers: { ...JSONH, 'x-worca-ask-proxy': b.token, ...h }, body: JSON.stringify({ op: o }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const s = await op('status');
  assert.equal(typeof s.body.result.enabled, 'boolean');
  assert.equal('restart' in s.body.result, false);
  assert.ok(!JSON.stringify(s.body).includes('ntHash'));
  testing.setEgress(null);
  const open = await startFakeUpstream({ scheme: 'none', originPort: origin.port });
  try {
    await setNetworkProxy(null);
    await setNetworkProxy({ enabled: false, upstream: `127.0.0.1:${open.port}` });   // saved, never tested
    const t = (await op('test')).body.result;
    assert.equal(t.ok, true, JSON.stringify(t));
    assert.equal(t.upstream, `127.0.0.1:${open.port}`, 'the saved values');
    const r = await call('PUT', '/api/proxy/settings', { networkProxy: { enabled: true } });
    assert.equal(r.body.code, 'UNTESTED', 'R-sec-8: a chat test never satisfies the gate');
  } finally { await open.close(); await useUpstream(fake.port); }
  await withAgent(async () => assert.equal((await op('status')).status, 403));
  b.dispose();
  assert.equal((await op('status')).status, 403, 'a finished turn\'s token is dead');
  testing.setEgress(null);
});

test('AC-2.5: POST /api/proxy/test checks the candidate and leaves the running proxy and settings.json unchanged', async () => {
  const live = await startLiveEgress({ env: {}, settings: () => ({ networkProxy: { enabled: true, upstream: fake.url() } }), login: () => null, watch: () => () => {} });
  testing.setLiveEgress(live);
  const other = await startFakeUpstream({ scheme: 'none', originPort: origin.port });
  try {
    const conn = live.current().connector;
    const before = JSON.stringify(readSettings());
    const r = await call('POST', '/api/proxy/test', { networkProxy: { enabled: true, upstream: `127.0.0.1:${other.port}`, auth: 'none' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.upstream, `127.0.0.1:${other.port}`);
    assert.ok(other.stats.sockets >= 1, 'the candidate host was contacted');
    assert.equal(live.current().connector, conn, 'the running connector is the same object');
    assert.equal(JSON.stringify(readSettings()), before, 'nothing was written');
  } finally { testing.setLiveEgress(null); await live.close(); await other.close(); }
});

test('AC-2.5: an untested upstream change is refused with UNTESTED and writes nothing; after a passing test it swaps live', async () => {
  const live = await startLiveEgress({ env: {}, settings: () => ({ networkProxy: { enabled: true, upstream: fake.url() } }), login: () => null, watch: () => () => {} });
  testing.setLiveEgress(live);
  const other = await startFakeUpstream({ scheme: 'none', originPort: origin.port });
  try {
    const before = JSON.stringify(readSettings());
    const patch = { enabled: true, upstream: `127.0.0.1:${other.port}`, auth: 'none' };
    const refused = await call('PUT', '/api/proxy/settings', { networkProxy: patch });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'UNTESTED');
    assert.equal(JSON.stringify(readSettings()), before);
    assert.equal(other.stats.sockets, 0, 'a refused save sends nothing to the new host');
    assert.equal((await call('POST', '/api/proxy/test', { networkProxy: patch })).body.ok, true);
    const saved = await call('PUT', '/api/proxy/settings', { networkProxy: patch });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.body.restartNeeded, false);
    assert.deepEqual(saved.body.pending, []);
    assert.equal(live.current().upstream.upstream, `127.0.0.1:${other.port}`, 'swapped without a restart');
    const off = await call('PUT', '/api/proxy/settings', { networkProxy: { enabled: false } });
    assert.equal(off.status, 200, 'turning off needs no test');
    assert.equal(live.current().connector, null);
  } finally { testing.setLiveEgress(null); await live.close(); await other.close(); await useUpstream(fake.port); }
});

test('AC-2.7: changing fixedPort answers "Applies at the next start" and the old port keeps listening', async () => {
  const p1 = await freePort(); const p2 = await freePort();
  await useUpstream(fake.port);
  await setNetworkProxy({ fixedPort: p1 });
  const live = await startLiveEgress({ env: {}, login: () => null, watch: () => () => {} });
  testing.setLiveEgress(live);
  try {
    const r = await call('PUT', '/api/proxy/settings', { networkProxy: { fixedPort: p2 } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.restartNeeded, true);
    assert.deepEqual(r.body.pending, ['fixedPort']);
    assert.equal(r.body.notes.fixedPort, 'Applies at the next start');
    assert.equal(await isWorcaProxy(p1), true);
    assert.equal(await isWorcaProxy(p2), false);
  } finally { testing.setLiveEgress(null); await live.close(); await setNetworkProxy({ fixedPort: null }); }
});

test('Decision 15a: a non-JSON body is refused with 415; a PUT without networkProxy is 400', async () => {
  const before = JSON.stringify(readSettings());
  for (const [method, url] of [['POST', '/api/proxy/test'], ['PUT', '/api/proxy/settings']]) {
    const r = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'text/plain' }, body: '{"networkProxy":{"enabled":true,"upstream":"http://evil.example:1"}}' });
    assert.equal(r.status, 415, `${method} ${url}`);
    assert.equal((await r.json()).code, 'JSON_REQUIRED');
  }
  const empty = await call('PUT', '/api/proxy/settings', {});
  assert.equal(empty.status, 400);
  assert.equal(JSON.stringify(readSettings()), before, 'nothing was written');
});

test('a typed login: the test passes with NO saved login, writes nothing, and its pass clears the gate for that account only', async () => {
  await useUpstream(fake.port);
  await call('POST', '/api/proxy/logout', {});
  const patch = { enabled: true, upstream: `127.0.0.1:${fake.port}`, auth: 'auto' };
  const A = { domain: 'ACME', user: 'jdoe', password: 'S3cret!' };
  const B = { domain: 'ACME', user: 'other', password: 'S3cret!' };
  const before = JSON.stringify(readSettings());
  try {
    const bare = await call('POST', '/api/proxy/test', { networkProxy: patch });
    assert.equal(bare.body.ok, false, 'the NTLM fake needs a login');
    const logged = [];
    const saved = { log: console.log, warn: console.warn, error: console.error };
    for (const k of Object.keys(saved)) console[k] = (...a) => logged.push(a.join(' '));
    let t;
    try { t = await call('POST', '/api/proxy/test', { networkProxy: patch, login: A }); } finally { Object.assign(console, saved); }
    assert.equal(t.status, 200, t.text);
    assert.equal(t.body.ok, true, t.text);
    assert.ok(t.body.results.every((r) => r.ok), t.text);
    assert.ok(!logged.join('\n').includes('S3cret!'), 'the password is never logged');
    assert.ok(!t.text.includes('S3cret!') && !t.text.includes(ntHash('S3cret!').toString('hex')));
    assert.equal(existsSync(loginFile()), false, 'proxy-login.json is untouched');
    assert.equal(JSON.stringify(readSettings()), before, 'settings.json is untouched');

    // The pass for account A never clears the gate for account B (the apply writes nothing then).
    await setNetworkProxy(null);
    const refusedB = await call('POST', '/api/setup/apply', { network: { networkProxy: patch, login: B } });
    assert.equal(refusedB.status, 400, refusedB.text);
    assert.equal(refusedB.body.code, 'UNTESTED');
    assert.equal(existsSync(loginFile()), false);
    const okA = await call('POST', '/api/setup/apply', { network: { networkProxy: patch, login: A } });
    assert.equal(okA.status, 202, okA.text);
    let job;
    const t0 = Date.now();
    do { await new Promise((r) => setTimeout(r, 20)); job = (await call('GET', `/api/setup/apply/${okA.body.id}`)).body; } while (!job.done && Date.now() - t0 < 5000);
    assert.equal(job.ok, true, JSON.stringify(job));
    assert.equal(readProxyLogin().user, 'jdoe');
  } finally { await call('POST', '/api/proxy/logout', {}); await useUpstream(fake.port); }
});

test('a typed login is checked like apply checks it: a bad field is 400, Basic and Digest are refused', async () => {
  const patch = { enabled: true, upstream: `127.0.0.1:${fake.port}` };
  const empty = await call('POST', '/api/proxy/test', { networkProxy: patch, login: { domain: 'ACME', user: 'jdoe', password: '' } });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.field, 'login.password');
  for (const auth of ['basic', 'digest']) {
    const r = await call('POST', '/api/proxy/test', { networkProxy: { ...patch, auth }, login: { domain: 'ACME', user: 'jdoe', password: 'S3cret!' } });
    assert.equal(r.status, 400, auth);
    assert.equal(r.body.code, 'BASIC_NO_SAVED_LOGIN');
    assert.equal(r.body.error, savedLoginRefusal(auth));
  }
  assert.equal(existsSync(loginFile()), false);
});
