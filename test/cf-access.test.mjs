// test/cf-access.test.mjs
// createAccessVerifier (src/core/cf-access.mjs): the Cloudflare Access JWT check
// behind remote access. Local RSA keys + a fake certs endpoint; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccessVerifier, normalizeTeamDomain } from '../src/core/cf-access.mjs';
import { TEAM, AUD, makeAccessKey, signAccessJwt, certsFetch } from './helpers/access-jwt.mjs';

const keyA = makeAccessKey('kid-a');
const keyB = makeAccessKey('kid-b');

function setup({ keys = [keyA], clock } = {}) {
  const ref = { keys };
  const fetchImpl = certsFetch(ref);
  const now = clock ? () => clock.t : undefined;
  const verify = createAccessVerifier({ teamDomain: TEAM, aud: AUD, fetchImpl, now });
  return { verify, fetchImpl, ref };
}

test('accepts a valid token and returns the identity', async () => {
  const { verify } = setup();
  assert.deepEqual(await verify(signAccessJwt(keyA)), { email: 'me@example.com', sub: 'user-1' });
});

test('accepts a string aud as well as an array', async () => {
  const { verify } = setup();
  assert.ok(await verify(signAccessJwt(keyA, { aud: AUD })));
});

test('rejects wrong aud, wrong issuer, expired and not-yet-valid tokens', async () => {
  const { verify } = setup();
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await verify(signAccessJwt(keyA, { aud: ['aud-worca-02'] })), null, 'token for another app');
  assert.equal(await verify(signAccessJwt(keyA, { iss: 'https://evil.cloudflareaccess.com' })), null, 'other team');
  assert.equal(await verify(signAccessJwt(keyA, { exp: now - 120 })), null, 'expired');
  assert.equal(await verify(signAccessJwt(keyA, { exp: undefined })), null, 'no exp');
  assert.equal(await verify(signAccessJwt(keyA, { nbf: now + 300 })), null, 'not yet valid');
});

test('tolerates 30 s of clock skew', async () => {
  const { verify } = setup();
  const now = Math.floor(Date.now() / 1000);
  assert.ok(await verify(signAccessJwt(keyA, { exp: now - 10 })));
  assert.ok(await verify(signAccessJwt(keyA, { nbf: now + 10 })));
});

test('rejects alg none / HS256, a tampered payload, a foreign key and garbage', async () => {
  const { verify } = setup();
  const good = signAccessJwt(keyA);
  const [h, , s] = good.split('.');
  const forged = Buffer.from(JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], email: 'admin@example.com', exp: 9e9 })).toString('base64url');
  assert.equal(await verify(`${h}.${forged}.${s}`), null, 'tampered payload');
  assert.equal(await verify(signAccessJwt(keyA, {}, { alg: 'none' })), null, 'alg none');
  assert.equal(await verify(signAccessJwt(keyA, {}, { alg: 'HS256' })), null, 'HS256');
  // Signed by B but claiming A's kid.
  assert.equal(await verify(signAccessJwt({ ...keyB, kid: 'kid-a' })), null, 'wrong key for kid');
  for (const junk of [undefined, '', 'abc', 'a.b', 'a.b.c', '..', `${h}.${forged}.`]) {
    assert.equal(await verify(junk), null, `junk ${JSON.stringify(junk)}`);
  }
});

test('an unknown kid refetches the keys (rotation), at most once per 30 s', async () => {
  const clock = { t: Date.now() };
  const { verify, fetchImpl, ref } = setup({ clock });
  assert.ok(await verify(signAccessJwt(keyA)));
  assert.equal(fetchImpl.calls, 1);

  // Rotation: B appears. The first unknown-kid request inside 30 s cannot refetch.
  ref.keys = [keyA, keyB];
  clock.t += 5_000;
  assert.equal(await verify(signAccessJwt(keyB)), null, 'refetch throttled');
  assert.equal(fetchImpl.calls, 1);

  clock.t += 30_000;
  assert.ok(await verify(signAccessJwt(keyB)), 'after the throttle window the new key is fetched');
  assert.equal(fetchImpl.calls, 2);

  clock.t += 1_000;
  for (let i = 0; i < 5; i++) assert.equal(await verify(signAccessJwt(makeAccessKey('kid-x'))), null);
  assert.equal(fetchImpl.calls, 2, 'a flood of unknown kids does not hammer the certs endpoint');
});

test('keys are cached for 10 minutes, then refreshed', async () => {
  const clock = { t: Date.now() };
  const { verify, fetchImpl } = setup({ clock });
  await verify(signAccessJwt(keyA));
  clock.t += 9 * 60_000;
  await verify(signAccessJwt(keyA));
  assert.equal(fetchImpl.calls, 1);
  clock.t += 2 * 60_000;
  await verify(signAccessJwt(keyA));
  assert.equal(fetchImpl.calls, 2);
});

test('certs endpoint down: rejects with no keys cached, keeps stale keys otherwise', async () => {
  const clock = { t: Date.now() };
  const { verify, ref } = setup({ clock });
  ref.down = true;
  await assert.rejects(verify(signAccessJwt(keyA)), /Access certs: HTTP 502/);
  ref.down = false;
  assert.ok(await verify(signAccessJwt(keyA)));
  ref.down = true;
  clock.t += 11 * 60_000;
  const exp = Math.floor(clock.t / 1000) + 600;
  assert.ok(await verify(signAccessJwt(keyA, { exp })), 'stale keys still verify when the refresh fails');
});

test('concurrent first requests share one certs fetch', async () => {
  const { verify, fetchImpl } = setup();
  const results = await Promise.all(Array.from({ length: 8 }, () => verify(signAccessJwt(keyA))));
  assert.ok(results.every(Boolean));
  assert.equal(fetchImpl.calls, 1);
});

test('constructor validation and team-domain normalisation', () => {
  assert.throws(() => createAccessVerifier({ teamDomain: '', aud: AUD }), /teamDomain/);
  assert.throws(() => createAccessVerifier({ teamDomain: TEAM, aud: '' }), /aud/);
  assert.equal(normalizeTeamDomain(' https://Acme.CloudflareAccess.com/ '), 'acme.cloudflareaccess.com');
});
