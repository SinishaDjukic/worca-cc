// test/upstream-proxy.test.mjs — upstream parsing, noProxy, the lockout gate, redaction and saved logins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import net from 'node:net';
import {
  parseUpstreamUrl, resolveUpstream, parseNoProxy, goesDirect, createAuthGate, parseResponseHead,
  authChallenges, UPSTREAM_TIMEOUTS, ProxyCredentials, createUpstreamConnector, checkUpstream, TEST_HOSTS,
} from '../src/core/upstream-proxy.mjs';
import { ntHash } from '../src/core/ntlm.mjs';
import { startFakeUpstream } from './helpers/fake-upstream-proxy.mjs';

test('upstream URL: DOMAIN\\user from %5C or /, default port 80, https and junk rejected without echoing the value', () => {
  assert.deepEqual(parseUpstreamUrl('http://ACME%5Cjdoe:p%40ss@proxy.acme.example:8080'),
    { host: 'proxy.acme.example', port: 8080, credentials: { domain: 'ACME', user: 'jdoe', password: 'p@ss', raw: 'ACME\\jdoe' } });
  assert.equal(parseUpstreamUrl('proxy.acme.example').port, 80);
  assert.equal(parseUpstreamUrl('http://ACME%2Fjdoe:x@p:3128').credentials.domain, 'ACME');
  for (const bad of ['https://p:1', 'http://[nope', 'http://u:%zz@p:1']) {
    const r = parseUpstreamUrl(bad);
    assert.ok(r.error, bad);
    assert.ok(!r.error.includes('nope') && !r.error.includes('%zz'), 'the error never quotes the value');
  }
});

test('resolveUpstream: settings first, env fallback, settings userinfo ignored, auth defaults', () => {
  const env = { HTTPS_PROXY: 'http://ACME%5Cjdoe:Password@corp.example:8080', NO_PROXY: 'intranet.example,*.corp.example' };
  const fromEnv = resolveUpstream({ env, settings: {} });
  assert.equal(fromEnv.source, 'env');
  assert.equal(fromEnv.auth, 'auto');
  assert.deepEqual(fromEnv.noProxy, { all: false, list: ['intranet.example', '.corp.example'] });
  assert.deepEqual(fromEnv.timeouts, { ...UPSTREAM_TIMEOUTS });

  const fromSettings = resolveUpstream({ env, settings: { upstream: 'http://u:pw@other.example:3128', auth: 'ntlm', timeouts: { authMs: 10 } } });
  assert.equal(fromSettings.host, 'other.example');
  assert.equal(fromSettings.credentials, null);
  assert.equal(fromSettings.auth, 'none');
  assert.equal(fromSettings.timeouts.authMs, 500, 'clamped');
  assert.equal(fromSettings.warnings.length, 2);
  assert.equal(resolveUpstream({ env: {}, settings: {} }), null);
});

test('credentials keep one secret per mode and are redacted everywhere they could be printed', () => {
  const env = { HTTPS_PROXY: 'http://ACME%5Cjdoe:Hunter2pw@corp.example:8080' };
  const auto = resolveUpstream({ env, settings: {} });
  assert.equal(auto.credentials.basicToken, null, 'auto is NTLM only: no reversible Basic token');
  assert.equal(auto.credentials.ntHash.length, 16);
  const basic = resolveUpstream({ env, settings: { auth: 'basic' } });
  assert.equal(basic.credentials.ntHash, null);
  assert.equal(basic.credentials.basicToken, Buffer.from('ACME\\jdoe:Hunter2pw').toString('base64'));
  const secrets = ['Hunter2pw', auto.credentials.ntHash.toString('hex'), basic.credentials.basicToken];
  for (const up of [auto, basic]) {
    for (const s of [JSON.stringify(up), inspect(up, { depth: 5 }), String(up.credentials)]) {
      for (const x of secrets) assert.ok(!s.includes(x), s);
    }
  }
});

test('noProxy: loopback always direct, a leading dot covers the apex too, * is everything', () => {
  const np = parseNoProxy('.corp.example, build.local:8080');
  for (const h of ['localhost', '127.0.0.1', '::1', 'corp.example', 'a.corp.example', 'build.local']) assert.equal(goesDirect(h, np), true, h);
  assert.equal(goesDirect('github.com', np), false);
  assert.equal(goesDirect('github.com', parseNoProxy('*')), true);
  assert.equal(goesDirect('github.com', parseNoProxy('10.0.0.0/8')), false, 'CIDR never matches');
});

test('gate: one handshake at a time while unverified, 4 once verified, tripped rejects waiters and newcomers', async () => {
  const gate = createAuthGate({ maxParallel: 4 });
  const first = await gate.acquire();
  let second = null;
  const p2 = gate.acquire().then((r) => { second = r; return r; });
  await new Promise((r) => setImmediate(r));
  assert.equal(second, null, 'unverified: the second waits');
  gate.accepted(); first();
  await p2;
  const more = await Promise.all([gate.acquire(), gate.acquire(), gate.acquire()]);
  assert.equal(more.length, 3, 'verified: 4 in flight');
  const waiter = gate.acquire();
  assert.equal(gate.rejected('proxy needs login: x'), true);
  await assert.rejects(waiter, (e) => e.status === 407 && e.needsLogin === true);
  await assert.rejects(gate.acquire(), /proxy needs login/);
  assert.equal(gate.rejected('again'), false, 'a second trip changes nothing');
  second(); for (const r of more) { r(); r(); }                 // release is idempotent
  gate.reset();
  assert.equal(gate.state(), 'unverified');
});

test('gate: ambiguous outcomes after credentials were sent', async () => {
  const hard = createAuthGate();
  assert.equal(hard.unconfirmed('closed after Type 3', 2), true, 'unverified + close/timeout trips at once');
  assert.equal(hard.state(), 'tripped');

  const soft = createAuthGate();
  assert.equal(soft.unconfirmed('503 + Proxy-Authenticate', 1), false, 'one challenged 5xx is a strike');
  assert.equal(soft.state(), 'unverified');
  assert.equal(soft.unconfirmed('503 + Proxy-Authenticate', 1), true, 'the second strike trips');

  const ok = createAuthGate();
  ok.unconfirmed('503', 1); ok.accepted();
  assert.equal(ok.state(), 'verified');
  assert.equal(ok.unconfirmed('reset', 2), false, 'verified: an ambiguous outcome demotes, never trips');
  assert.equal(ok.state(), 'unverified');
  const a = await ok.acquire();
  let b = null; ok.acquire().then((r) => { b = r; });
  await new Promise((r) => setImmediate(r));
  assert.equal(b, null, 'after the demotion logins run one at a time again');
  a();
  assert.equal(ok.unconfirmed('reset', 2), true, 'and the next ambiguous outcome trips');
});

test('response heads and challenges', () => {
  const h = parseResponseHead('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: NTLM\r\nProxy-Authenticate: Basic realm="ACME, Inc"\r\nContent-Length: 12');
  assert.equal(h.status, 407);
  assert.equal(h.persistent, true);
  assert.deepEqual(authChallenges(h).map((c) => c.scheme), ['ntlm', 'basic']);
  assert.equal(parseResponseHead('HTTP/1.0 407 x\r\nContent-Length: 0').persistent, false);
  assert.equal(parseResponseHead('garbage'), null);
});

// ── Saved logins (slice 2): a stored NT hash, login generations, useLogin and checkUpstream ──

const savedLogin = (id, password, extra = {}) => ({ id, domain: 'ACME', user: 'jdoe', ntHash: ntHash(password), savedAt: '2026-10-23T10:00:00.000Z', rejected: null, ...extra });

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

test('ProxyCredentials from a stored NT hash: NTLM only, no Basic token', () => {
  const c = new ProxyCredentials({ domain: 'ACME', user: 'jdoe', ntHash: ntHash('S3cret!') }, 'auto');
  assert.deepEqual(c.ntHash, ntHash('S3cret!'));
  assert.equal(c.basicToken, null);
  assert.equal(c.saved, true);
  assert.equal(c.label, 'ACME\\jdoe');
});

test('resolveUpstream with a saved login: wins over the URL user, Basic and an explicit none skip it', () => {
  const login = savedLogin('a1', 'S3cret!');
  const up = resolveUpstream({ env: {}, settings: { upstream: 'http://p:8080' }, login });
  assert.equal(up.auth, 'auto');
  assert.equal(up.credentials.label, 'ACME\\jdoe');
  assert.equal(up.login.id, login.id);
  assert.equal(up.requestedAuth, null);

  const basic = resolveUpstream({ env: {}, settings: { upstream: 'http://p:8080', auth: 'basic' }, login });
  assert.equal(basic.auth, 'none');
  assert.ok(basic.warnings.some((w) => /Basic/.test(w)), basic.warnings.join('|'));

  const over = resolveUpstream({ env: { HTTPS_PROXY: 'http://OTHER%5Cbob:pw@p:8080' }, settings: {}, login });
  assert.equal(over.credentials.label, 'ACME\\jdoe');
  assert.equal(over.urlCredentials.label, 'OTHER\\bob');
  assert.ok(over.warnings.some((w) => /proxy URL are not used/.test(w)));

  const none = resolveUpstream({ env: {}, settings: { upstream: 'http://p:8080', auth: 'none' }, login });
  assert.equal(none.auth, 'none');
  assert.equal(none.login, null);
  assert.ok(none.warnings.some((w) => /auth is none/.test(w)));
});

test('createAuthGate({ tripped }) starts shut', async () => {
  const gate = createAuthGate({ tripped: 'proxy needs login: x' });
  assert.equal(gate.state(), 'tripped');
  await assert.rejects(gate.acquire(), (e) => e.status === 407 && e.needsLogin === true);
});

test('useLogin restores the requested auth mode; an explicit none never swaps (D23)', () => {
  const creds = new ProxyCredentials({ domain: 'ACME', user: 'jdoe', ntHash: ntHash('x') }, 'auto');
  const none = createUpstreamConnector(resolveUpstream({ env: {}, settings: { upstream: 'http://p:8080', auth: 'none' }, login: savedLogin('a', 'x') }));
  assert.equal(none.useLogin(creds, { id: 'b' }), false);
  assert.equal(none.status().auth, 'none');
  none.close();
  const ntlm = createUpstreamConnector(resolveUpstream({ env: {}, settings: { upstream: 'http://p:8080', auth: 'ntlm' } }));
  assert.equal(ntlm.status().auth, 'none', 'no login at boot');
  assert.equal(ntlm.useLogin(creds, { id: 'b' }), true);
  assert.equal(ntlm.status().auth, 'ntlm');
  assert.equal(ntlm.status().loginId, 'b');
  ntlm.close();
  const auto = createUpstreamConnector(resolveUpstream({ env: {}, settings: { upstream: 'http://p:8080' } }));
  auto.useLogin(creds, { id: 'b' });
  assert.equal(auto.status().auth, 'auto');
  auto.useLogin(null);
  assert.equal(auto.status().auth, 'none', 'logged out without URL credentials: nothing is sent');
  auto.close();
});

test('stale generation: a 407 to an older login neither trips the gate nor calls onTrip', async (t) => {
  const origin = await echoOrigin();
  const fake = await startFakeUpstream({ domain: 'ACME', user: 'jdoe', password: 'S3cret!', originPort: origin.port, holdType3: true });
  t.after(async () => { await fake.close(); origin.server.close(); });
  const trips = [];
  const up = resolveUpstream({ env: {}, settings: { upstream: fake.url() }, login: savedLogin('a', 'wrong') });
  const connector = createUpstreamConnector(up, { onTrip: (x) => trips.push(x) });
  t.after(() => connector.close());
  const first = connector.tunnel({ host: 'github.com', port: 443 }).then(() => null, (e) => e);
  await until(() => fake.stats.type3 === 1);
  const b = new ProxyCredentials({ domain: 'ACME', user: 'jdoe', ntHash: ntHash('S3cret!') }, 'auto');
  assert.equal(connector.useLogin(b, { id: 'b' }), true);
  fake.release();
  const err = await first;
  assert.equal(err.status, 407);
  assert.equal(connector.status().state, 'unverified');
  assert.deepEqual(trips, []);
  const second = connector.tunnel({ host: 'github.com', port: 443 });
  await until(() => fake.stats.type3 === 2);
  fake.release();
  const { socket } = await second;
  socket.destroy();
  assert.equal(connector.status().state, 'verified');
});

test('useLogin(null) falls back to the URL login', async (t) => {
  const origin = await echoOrigin();
  const fake = await startFakeUpstream({ domain: 'ACME', user: 'jdoe', password: 'S3cret!', originPort: origin.port });
  t.after(async () => { await fake.close(); origin.server.close(); });
  const up = resolveUpstream({ env: { HTTPS_PROXY: fake.url('ACME%5Cjdoe:S3cret!@') }, settings: {}, login: savedLogin('a', 'wrong') });
  const connector = createUpstreamConnector(up);
  t.after(() => connector.close());
  assert.equal(connector.useLogin(null), true);
  assert.equal(connector.status().auth, 'auto');
  assert.equal(connector.status().login, 'ACME\\jdoe');
  const { socket } = await connector.tunnel({ host: 'github.com', port: 443 });
  socket.destroy();
  assert.equal(fake.stats.authHeaders.length, 2, 'Type 1 + Type 3 from the URL login');
});

test('checkUpstream: a wrong login costs one Type 3 for both hosts, and its log never carries a secret', async (t) => {
  const origin = await echoOrigin();
  const fake = await startFakeUpstream({ domain: 'ACME', user: 'jdoe', password: 'S3cret!', originPort: origin.port });
  t.after(async () => { await fake.close(); origin.server.close(); });
  const logs = [];
  const trips = [];
  const up = resolveUpstream({ env: {}, settings: { upstream: fake.url() }, login: savedLogin('a', 'wrong') });
  const r = await checkUpstream(up, { log: (l) => logs.push(l), onTrip: (x) => trips.push(x) });
  assert.equal(r.ok, false);
  assert.deepEqual(r.results.map((x) => [x.host, x.ok]), [['github.com', false], ['api.anthropic.com', false]]);
  assert.equal(r.results[1].needsLogin, true);
  assert.equal(fake.stats.type3, 1);
  assert.deepEqual(trips, [{ upstream: `127.0.0.1:${fake.port}`, loginId: 'a' }]);
  const joined = logs.join('\n');
  assert.ok(logs.length >= 1);
  for (const s of ['wrong', ntHash('wrong').toString('hex')]) assert.ok(!joined.includes(s), joined);

  const good = await checkUpstream(resolveUpstream({ env: {}, settings: { upstream: fake.url() }, login: savedLogin('b', 'S3cret!') }));
  assert.equal(good.ok, true);
  assert.deepEqual(TEST_HOSTS, ['github.com', 'api.anthropic.com']);
});
