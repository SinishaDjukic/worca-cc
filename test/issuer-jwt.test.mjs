// test/issuer-jwt.test.mjs
// createIssuerVerifier (W1): ES256 tokens from a configured issuer, checked against its JWKS with
// the instance host as audience. Mirrors test/cf-access.test.mjs for the Access verifier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createIssuerVerifier, normalizeIssuer, readClaim, parseClaimName } from '../src/core/issuer-jwt.mjs';
import { ISSUER, JWKS_URL, INSTANCE_HOST, makeIssuerKey, signIssuerJwt, jwksFetch } from './helpers/issuer-jwt.mjs';

const key = makeIssuerKey();
const make = (keysRef = { keys: [key] }, opts = {}) => {
  const fetchImpl = jwksFetch(keysRef);
  return { fetchImpl, verify: createIssuerVerifier({ issuer: ISSUER, jwksUrl: JWKS_URL, audience: INSTANCE_HOST, fetchImpl, ...opts }) };
};

test('normalizeIssuer drops a trailing slash and whitespace', () => {
  assert.equal(normalizeIssuer(' https://app.example.dev/ '), 'https://app.example.dev');
  assert.equal(normalizeIssuer(''), '');
});

test('a valid token yields the identity with the platform claims (W4)', async () => {
  const { verify } = make();
  const who = await verify(signIssuerJwt(key));
  assert.equal(who.email, 'ada@example.com');
  assert.equal(who.sub, 'usr_ada');
  assert.equal(who.name, 'Ada');
  assert.equal(who.org, 'org_1');
  assert.equal(who.inst, 'inst_1');
  assert.deepEqual(who.teams, ['team_mobile']);
  assert.equal(typeof who.exp, 'number');
});

test('refused: another instance\'s audience, another issuer, expired, not yet valid, tampered', async () => {
  const { verify } = make();
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await verify(signIssuerJwt(key, { aud: 'other.example.run' })), null);
  assert.equal(await verify(signIssuerJwt(key, { iss: 'https://evil.example' })), null);
  assert.equal(await verify(signIssuerJwt(key, { exp: now - 120 })), null);
  assert.equal(await verify(signIssuerJwt(key, { nbf: now + 600 })), null);
  const [h, p] = signIssuerJwt(key).split('.');
  assert.equal(await verify(`${h}.${p}.AAAA`), null);
  const evilP = Buffer.from(JSON.stringify({ iss: ISSUER, aud: INSTANCE_HOST, email: 'eve@example.com', exp: now + 300 })).toString('base64url');
  assert.equal(await verify(`${h}.${evilP}.${signIssuerJwt(key).split('.')[2]}`), null);
});

test('refused: alg none / HS256, unknown kid, junk, no email or sub', async () => {
  const { verify } = make();
  assert.equal(await verify(signIssuerJwt(key, {}, { alg: 'none' })), null);
  assert.equal(await verify(signIssuerJwt(key, {}, { alg: 'HS256' })), null);
  assert.equal(await verify(signIssuerJwt(key, {}, { kid: 'nope' })), null);
  assert.equal(await verify('not.a.jwt'), null);
  assert.equal(await verify(undefined), null);
  assert.equal(await verify(signIssuerJwt(key, { email: undefined, sub: undefined })), null);
  assert.equal(await verify(signIssuerJwt(key, { email: undefined })), null, 'no email: would be attributed as local');
  assert.equal(await verify(signIssuerJwt(key, { sub: undefined })), null);
});

test('a key of the wrong type for the alg is refused (RS256 header on an EC key)', async () => {
  const { verify } = make();
  assert.equal(await verify(signIssuerJwt(key, {}, { alg: 'RS256' })), null);
});

test('an ES256 token signed with a P-384 key is refused', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const p384 = { kid: 'es-384', privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid: 'es-384', use: 'sig' } };
  const { verify } = make({ keys: [p384] });
  assert.equal(await verify(signIssuerJwt(p384)), null);
});

test('RS256 issuers work too', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsa = { kid: 'rs-1', jwk: { ...publicKey.export({ format: 'jwk' }), kid: 'rs-1', alg: 'RS256', use: 'sig' } };
  const { verify } = make({ keys: [rsa] });
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'RS256', kid: 'rs-1' });
  const p = b({ iss: ISSUER, aud: INSTANCE_HOST, sub: 'u', email: 'r@example.com', exp: Math.floor(Date.now() / 1000) + 60 });
  const sig = sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
  assert.equal((await verify(`${h}.${p}.${sig}`)).email, 'r@example.com');
});

test('keys are cached; an unknown kid refetches at most once per 30 s (rotation); keys down -> rejects', async () => {
  const keysRef = { keys: [key] };
  let t = Date.now();
  const { verify, fetchImpl } = make(keysRef, { now: () => t });
  await verify(signIssuerJwt(key));
  await verify(signIssuerJwt(key));
  assert.equal(fetchImpl.calls, 1);
  const next = makeIssuerKey('es-2');
  keysRef.keys = [key, next];
  assert.equal(await verify(signIssuerJwt(next)), null, 'inside the 30 s floor: no refetch');
  t += 31_000;
  assert.equal((await verify(signIssuerJwt(next))).email, 'ada@example.com');
  assert.equal(fetchImpl.calls, 2);

  const down = make({ keys: [key], down: true });
  await assert.rejects(down.verify(signIssuerJwt(key)));
});

test('audience matching is case-insensitive and accepts a list', async () => {
  const fetchImpl = jwksFetch({ keys: [key] });
  const verify = createIssuerVerifier({ issuer: `${ISSUER}/`, jwksUrl: JWKS_URL, audience: ['A.example.run', INSTANCE_HOST.toUpperCase()], fetchImpl });
  assert.ok(await verify(signIssuerJwt(key)));
  assert.ok(await verify(signIssuerJwt(key, { aud: ['x', 'a.example.run'] })));
});

test('readClaim: exact key first (namespaced claims), then a dotted path; own properties only', () => {
  const p = { 'https://example.com/roles': ['a'], realm_access: { roles: ['r1'] }, 'a.b': 1, a: { b: 2 } };
  assert.deepEqual(readClaim(p, 'https://example.com/roles'), ['a']);
  assert.deepEqual(readClaim(p, 'realm_access.roles'), ['r1']);
  assert.equal(readClaim(p, 'a.b'), 1, 'the exact key wins over the path');
  assert.equal(readClaim(p, 'realm_access.nope'), undefined);
  assert.equal(readClaim(p, 'constructor'), undefined);
  assert.equal(readClaim(p, 'realm_access.roles.length'), undefined, 'no walking into arrays');
});

test('parseClaimName: trimmed, fallback when empty, null when unusable', () => {
  assert.equal(parseClaimName(' roles ', 'teams'), 'roles');
  assert.equal(parseClaimName('', 'teams'), 'teams');
  assert.equal(parseClaimName(undefined, 'email'), 'email');
  assert.equal(parseClaimName('a b', 'teams'), null);
  assert.equal(parseClaimName('x'.repeat(201), 'teams'), null);
});

test('configured claims: email from preferred_username, teams from a nested roles list', async () => {
  const { verify } = make(undefined, { claims: { email: 'preferred_username', teams: 'realm_access.roles' } });
  const who = await verify(signIssuerJwt(key, { email: undefined, teams: undefined, preferred_username: 'ada@example.com', realm_access: { roles: ['team-a', 'team-b'] } }));
  assert.equal(who.email, 'ada@example.com');
  assert.deepEqual(who.teams, ['team-a', 'team-b']);
  // The configured claim is the only source: the default `email` is not a fallback.
  assert.equal(await verify(signIssuerJwt(key, { preferred_username: undefined })), null);
});

test('teams: a single string is a one-entry list; non-strings and empties are dropped; absent is []', async () => {
  const { verify } = make(undefined, { claims: { teams: 'groups' } });
  assert.deepEqual((await verify(signIssuerJwt(key, { groups: 'team-a' }))).teams, ['team-a']);
  assert.deepEqual((await verify(signIssuerJwt(key, { groups: ['a', 1, '', null, 'b'] }))).teams, ['a', 'b']);
  assert.deepEqual((await verify(signIssuerJwt(key, { groups: undefined }))).teams, []);
});
