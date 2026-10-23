// test/http-digest.test.mjs — RFC 7616 / RFC 2617 Digest for the corporate proxy (src/core/http-digest.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseChallenges, pickDigest, digestHa1, digestAuthorization, isStaleDigest, DigestError } from '../src/core/http-digest.mjs';

const RFC7616 = { realm: 'http-auth@example.org', nonce: '7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v',
  opaque: 'FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS', qop: 'auth' };
const CNONCE = 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ';
const respOf = (h) => /response="([0-9a-f]+)"/.exec(h)[1];

test('RFC 7616 §3.9.1: MD5 and SHA-256 responses for Mufasa / Circle of Life', () => {
  for (const [algorithm, want] of [['MD5', '8ca523f5e9506fed4657c9700eebdbec'],
    ['SHA-256', '753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1']]) {
    const h = digestAuthorization({ challenge: { scheme: 'digest', params: { ...RFC7616, algorithm } },
      username: 'Mufasa', password: 'Circle of Life', method: 'GET', uri: '/dir/index.html', cnonce: CNONCE, nc: 1 });
    assert.equal(respOf(h), want, algorithm);
    assert.match(h, /^Digest username="Mufasa", realm="http-auth@example.org", nonce="7ypf/);
    assert.match(h, /qop=auth, nc=00000001, cnonce="f2\/wE4q/);
    assert.match(h, /opaque="FQhe/);
  }
});

test('RFC 2617 §3.5: MD5 with qop auth', () => {
  const h = digestAuthorization({ challenge: { scheme: 'digest', params: { realm: 'testrealm@host.com', qop: 'auth,auth-int',
    nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093', opaque: '5ccc069c403ebaf9f0171e9517f40e41' } },
  username: 'Mufasa', password: 'Circle Of Life', method: 'GET', uri: '/dir/index.html', cnonce: '0a4f113b', nc: 1 });
  assert.equal(respOf(h), '6629fae49393a05397450978507c4ef1');
});

test('parseChallenges: several schemes on one line, quoted commas, token68', () => {
  const c = parseChallenges(['Negotiate, NTLM TlRMTVNTUAACAAAA==, Digest realm="ACME, Inc", nonce="a,b", qop="auth,auth-int", algorithm=SHA-256, Basic realm="x"']);
  assert.deepEqual(c.map((x) => x.scheme), ['negotiate', 'ntlm', 'digest', 'basic']);
  assert.equal(c[1].token, 'TlRMTVNTUAACAAAA==');
  assert.deepEqual(c[2].params, { realm: 'ACME, Inc', nonce: 'a,b', qop: 'auth,auth-int', algorithm: 'SHA-256' });
});

test('pickDigest prefers SHA-256 over MD5 and skips what Worca cannot answer', () => {
  const c = parseChallenges(['Digest realm="r", nonce="n", algorithm=MD5', 'Digest realm="r", nonce="n", algorithm=SHA-256',
    'Digest realm="r", nonce="n", algorithm=SHA-512-256']);
  assert.equal(pickDigest(c).params.algorithm, 'SHA-256');
  assert.equal(pickDigest(parseChallenges(['Digest realm="r", nonce="n", qop="auth-int"'])), null);
  assert.equal(pickDigest(parseChallenges(['Basic realm="r"'])), null);
});

test('-sess variants, no qop, escaping, stale and refusals', () => {
  const base = { scheme: 'digest', params: { realm: 'r', nonce: 'n' } };
  const noQop = digestAuthorization({ challenge: base, username: 'Domain\\User', password: 'p', method: 'CONNECT', uri: 'github.com:443' });
  assert.match(noQop, /username="Domain\\\\User"/);
  assert.doesNotMatch(noQop, /qop=|nc=|cnonce=/);
  // -sess (RFC 7616 §3.4.2): HA1 = H(H(user:realm:pass):nonce:cnonce). Computed here from the RFC formula,
  // independently of the module.
  for (const [algorithm, h] of [['SHA-256-sess', 'sha256'], ['MD5-sess', 'md5']]) {
    const H = (s) => createHash(h).update(s).digest('hex');
    const ha1 = H(`${H('u:r:p')}:n:c`);
    const want = H(`${ha1}:n:00000001:c:auth:${H('GET:/')}`);
    const sess = digestAuthorization({ challenge: { scheme: 'digest', params: { ...base.params, algorithm, qop: 'auth' } },
      username: 'u', password: 'p', method: 'GET', uri: '/', cnonce: 'c' });
    assert.match(sess, new RegExp(`algorithm=${algorithm}`));
    assert.equal(respOf(sess), want, algorithm);
  }
  // The ha1 callback (how ProxyCredentials answers, D8a) gives the same header as the password.
  const viaHa1 = digestAuthorization({ challenge: { scheme: 'digest', params: { ...RFC7616, algorithm: 'SHA-256' } },
    username: 'Mufasa', ha1: (realm, alg) => digestHa1({ username: 'Mufasa', realm, password: 'Circle of Life', algorithm: alg }),
    method: 'GET', uri: '/dir/index.html', cnonce: CNONCE, nc: 1 });
  assert.equal(respOf(viaHa1), '753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1');
  assert.throws(() => digestAuthorization({ challenge: base, username: 'u', password: 'p', method: 'GET', uri: '/', cnonce: 'a\r\nb' }), DigestError);
  assert.throws(() => digestAuthorization({ challenge: { scheme: 'digest', params: { realm: 'r' } }, username: 'u', password: 'p', method: 'GET', uri: '/' }), DigestError);
  assert.throws(() => digestAuthorization({ challenge: { scheme: 'digest', params: { ...base.params, userhash: 'true' } }, username: 'u', password: 'p', method: 'GET', uri: '/' }), /userhash/);
  assert.throws(() => digestAuthorization({ challenge: base, username: 'u\r\nX: y', password: 'p', method: 'GET', uri: '/' }), DigestError);
  // Every value that reaches the header refuses CR/LF (Threats 4).
  const ok = { challenge: { scheme: 'digest', params: { realm: 'r', nonce: 'n', opaque: 'o' } }, username: 'u', password: 'p', method: 'GET', uri: '/' };
  for (const key of ['realm', 'nonce', 'opaque']) {
    assert.throws(() => digestAuthorization({ ...ok, challenge: { scheme: 'digest', params: { ...ok.challenge.params, [key]: 'a\r\nX: y' } } }), DigestError, key);
  }
  for (const key of ['uri', 'method']) {
    assert.throws(() => digestAuthorization({ ...ok, [key]: 'a\r\nX: y' }), DigestError, key);
  }
  assert.equal(isStaleDigest(['Digest realm="r", nonce="n2", stale=true']), true);
  assert.equal(isStaleDigest(['Digest realm="r", nonce="n2"']), false);
});
