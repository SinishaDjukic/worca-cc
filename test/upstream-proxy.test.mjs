// test/upstream-proxy.test.mjs — upstream parsing, noProxy, the lockout gate and redaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import {
  parseUpstreamUrl, resolveUpstream, parseNoProxy, goesDirect, createAuthGate, parseResponseHead,
  authChallenges, UPSTREAM_TIMEOUTS,
} from '../src/core/upstream-proxy.mjs';

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
