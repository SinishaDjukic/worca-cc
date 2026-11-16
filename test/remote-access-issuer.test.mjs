// test/remote-access-issuer.test.mjs
// src/core/remote-access.mjs with an identity issuer (W1) and the exact-hosts rule (W2). The
// Cloudflare Access cases stay in test/remote-access.test.mjs, unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readRemoteAccessConfig, checkRemoteAccessConfig, isRemoteMode, createHostGuard, createIdentityCheck,
} from '../src/core/remote-access.mjs';
import { TEAM, AUD } from './helpers/access-jwt.mjs';
import { ISSUER, JWKS_URL, INSTANCE_HOST, makeIssuerKey, signIssuerJwt, jwksFetch } from './helpers/issuer-jwt.mjs';

const ISS = { WORCA_ALLOWED_HOSTS: INSTANCE_HOST, WORCA_IDENTITY_ISSUER: ISSUER };
const CLAIMS = { email: 'email', teams: 'teams' };
const req = (headers = {}) => ({ headers: { host: INSTANCE_HOST, ...headers }, socket: { remoteAddress: '10.0.0.5' } });

test('issuer config: defaults the JWKS URL and the audience from the allowed hosts', () => {
  const cfg = readRemoteAccessConfig(ISS);
  assert.equal(isRemoteMode(cfg), true);
  assert.deepEqual(cfg.identity, { provider: 'issuer', issuer: ISSUER, jwksUrl: JWKS_URL, audience: [INSTANCE_HOST], claims: CLAIMS });
  assert.deepEqual(checkRemoteAccessConfig(cfg, { bindHost: '::' }), { errors: [], warnings: [] });
});

test('issuer config: explicit JWKS URL and audience, as the platform sets them', () => {
  const cfg = readRemoteAccessConfig({ ...ISS, WORCA_IDENTITY_ISSUER: `${ISSUER}/`, WORCA_IDENTITY_JWKS_URL: 'https://keys.example.dev/jwks', WORCA_IDENTITY_AUDIENCE: INSTANCE_HOST.toUpperCase() });
  assert.deepEqual(cfg.identity, { provider: 'issuer', issuer: ISSUER, jwksUrl: 'https://keys.example.dev/jwks', audience: [INSTANCE_HOST], claims: CLAIMS });
  assert.deepEqual(checkRemoteAccessConfig(cfg, { bindHost: '::' }).errors, []);
});

test('both Access and an issuer is a startup error naming both', () => {
  const cfg = readRemoteAccessConfig({ ...ISS, WORCA_CF_ACCESS_TEAM_DOMAIN: TEAM, WORCA_CF_ACCESS_AUD: AUD });
  const { errors } = checkRemoteAccessConfig(cfg, { bindHost: '::' });
  assert.match(errors.join('\n'), /both WORCA_CF_ACCESS_\* and WORCA_IDENTITY_ISSUER/);
});

test('W2: suffix entries are refused with an issuer, still allowed with Access', () => {
  const iss = readRemoteAccessConfig({ ...ISS, WORCA_ALLOWED_HOSTS: `${INSTANCE_HOST},.example.run` });
  assert.match(checkRemoteAccessConfig(iss, { bindHost: '::' }).errors.join('\n'), /exact hosts only \(remove \.example\.run\)/);
  const access = readRemoteAccessConfig({ WORCA_ALLOWED_HOSTS: 'worca-01.example.com,.example.com', WORCA_CF_ACCESS_TEAM_DOMAIN: TEAM, WORCA_CF_ACCESS_AUD: AUD });
  assert.deepEqual(checkRemoteAccessConfig(access, { bindHost: '::' }).errors, []);
});

test('issuer must be https (http only on loopback); an audience is required', () => {
  const http = readRemoteAccessConfig({ ...ISS, WORCA_IDENTITY_ISSUER: 'http://app.example.dev' });
  assert.match(checkRemoteAccessConfig(http).errors.join('\n'), /WORCA_IDENTITY_ISSUER must be an https URL/);
  const local = readRemoteAccessConfig({ ...ISS, WORCA_IDENTITY_ISSUER: 'http://localhost:8787' });
  assert.deepEqual(checkRemoteAccessConfig(local, { bindHost: '::' }).errors, []);
  const badJwks = readRemoteAccessConfig({ ...ISS, WORCA_IDENTITY_JWKS_URL: 'http://keys.example.dev' });
  assert.match(checkRemoteAccessConfig(badJwks).errors.join('\n'), /WORCA_IDENTITY_JWKS_URL must be/);
  const noAud = readRemoteAccessConfig({ WORCA_IDENTITY_ISSUER: ISSUER });
  assert.match(checkRemoteAccessConfig(noAud).errors.join('\n'), /no audience/);
});

test('an issuer counts as an identity check: no fail-closed error, insecure flag ignored with a warning', () => {
  const cfg = readRemoteAccessConfig({ ...ISS, WORCA_INSECURE_NO_IDENTITY_CHECK: '1' });
  const { errors, warnings } = checkRemoteAccessConfig(cfg, { bindHost: '::' });
  assert.deepEqual(errors, []);
  assert.match(warnings.join('\n'), /ignored: an identity issuer check is configured/);
});

test('createIdentityCheck reads X-Worca-Identity, never Cf-Access-Jwt-Assertion', async () => {
  const key = makeIssuerKey();
  const check = createIdentityCheck(readRemoteAccessConfig(ISS), { fetchImpl: jwksFetch({ keys: [key] }) });
  const token = signIssuerJwt(key);
  const who = await check(req({ 'x-worca-identity': token }));
  assert.equal(who.email, 'ada@example.com');
  assert.equal(who.provider, 'issuer');
  assert.deepEqual(who.teams, ['team_mobile']);
  assert.equal(await check(req({ 'cf-access-jwt-assertion': token })), null);
  assert.equal(await check(req()), null);
  assert.equal(await check(req({ 'x-worca-identity': signIssuerJwt(key, { aud: 'other.example.run' }) })), null, 'another instance\'s token');
});

test('the host guard with an exact host refuses a sibling instance\'s Origin', () => {
  const guard = createHostGuard(readRemoteAccessConfig(ISS).allowedHosts);
  assert.equal(guard(req({ origin: `https://${INSTANCE_HOST}` })), true);
  assert.equal(guard(req({ origin: 'https://sibling.example.run' })), false);
});

test('claim names: Entra-style email and teams claims are read and passed to the verifier', async () => {
  const key = makeIssuerKey();
  const cfg = readRemoteAccessConfig({ ...ISS, WORCA_IDENTITY_EMAIL_CLAIM: ' preferred_username ', WORCA_IDENTITY_TEAMS_CLAIM: 'roles' });
  assert.deepEqual(cfg.identity.claims, { email: 'preferred_username', teams: 'roles' });
  assert.deepEqual(checkRemoteAccessConfig(cfg, { bindHost: '::' }).errors, []);
  const check = createIdentityCheck(cfg, { fetchImpl: jwksFetch({ keys: [key] }) });
  const token = signIssuerJwt(key, { email: undefined, teams: undefined, preferred_username: 'ada@contoso.com', roles: ['worca.team-a'] });
  const who = await check(req({ 'x-worca-identity': token }));
  assert.equal(who.email, 'ada@contoso.com');
  assert.deepEqual(who.teams, ['worca.team-a']);
});

test('claim names with spaces are a startup error naming the variable', () => {
  const cfg = readRemoteAccessConfig({ ...ISS, WORCA_IDENTITY_EMAIL_CLAIM: 'pre ferred', WORCA_IDENTITY_TEAMS_CLAIM: 'a b' });
  const { errors } = checkRemoteAccessConfig(cfg, { bindHost: '::' });
  assert.ok(errors.some((e) => e.startsWith('WORCA_IDENTITY_EMAIL_CLAIM')));
  assert.ok(errors.some((e) => e.startsWith('WORCA_IDENTITY_TEAMS_CLAIM')));
});
