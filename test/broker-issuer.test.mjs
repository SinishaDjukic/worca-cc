// test/broker-issuer.test.mjs
// The key page behind a gate with its own identity issuer (W1): the broker's config accepts
// WORCA_IDENTITY_ISSUER for multi mode, and the key page verifies X-Worca-Identity itself with
// the key page's host as the audience. The Access cases stay in test/broker-ui.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readBrokerConfig } from '../src/broker/config.mjs';
import { builtinSlots } from '../src/broker/slots.mjs';
import { openStore } from '../src/broker/store.mjs';
import { createBrokerService } from '../src/broker/service.mjs';
import { createUiHandler, createIdentity } from '../src/broker/ui-server.mjs';
import { TEAM } from './helpers/access-jwt.mjs';
import { ISSUER, JWKS_URL, makeIssuerKey, signIssuerJwt, jwksFetch } from './helpers/issuer-jwt.mjs';

const KEY_HOST = 'k7m2qz9xwp-keys.example.run';
const BASE_ENV = {
  WORCA_BROKER_MODE: 'multi', WORCA_BROKER_SECRET: 's'.repeat(40), WORCA_BROKER_VAULT_KEY: randomBytes(32).toString('base64'),
  WORCA_BROKER_PUBLIC_URL: `https://${KEY_HOST}`, WORCA_BROKER_RETURN_URL: 'https://k7m2qz9xwp.example.run',
};

test('multi mode accepts an issuer; JWKS URL and audience default from the issuer and the public URL', () => {
  const { config, errors } = readBrokerConfig({ ...BASE_ENV, WORCA_IDENTITY_ISSUER: `${ISSUER}/` });
  assert.deepEqual(errors, []);
  assert.deepEqual(config.identity, { kind: 'issuer', issuer: ISSUER, jwksUrl: JWKS_URL, audience: [KEY_HOST], claims: { email: 'email', teams: 'teams' } });
});

test('the platform\'s explicit variables are used as given', () => {
  const { config, errors } = readBrokerConfig({
    ...BASE_ENV, WORCA_IDENTITY_ISSUER: ISSUER, WORCA_IDENTITY_JWKS_URL: 'https://keys.example.dev/jwks', WORCA_IDENTITY_AUDIENCE: KEY_HOST.toUpperCase(),
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(config.identity.audience, [KEY_HOST]);
  assert.equal(config.identity.jwksUrl, 'https://keys.example.dev/jwks');
});

test('Access and an issuer together is an error; http issuer is an error; Access alone is unchanged', () => {
  const both = readBrokerConfig({ ...BASE_ENV, WORCA_IDENTITY_ISSUER: ISSUER, WORCA_CF_ACCESS_TEAM_DOMAIN: TEAM, WORCA_CF_ACCESS_AUD: 'aud' });
  assert.match(both.errors.join('\n'), /both WORCA_CF_ACCESS_\* and WORCA_IDENTITY_ISSUER/);
  assert.equal(both.errors.filter((e) => /multi mode needs an identity check/.test(e)).length, 0, 'one clear message, not two');
  const http = readBrokerConfig({ ...BASE_ENV, WORCA_IDENTITY_ISSUER: 'http://app.example.dev' });
  assert.match(http.errors.join('\n'), /WORCA_IDENTITY_ISSUER must be an https URL/);
  const access = readBrokerConfig({ ...BASE_ENV, WORCA_CF_ACCESS_TEAM_DOMAIN: TEAM, WORCA_CF_ACCESS_AUD: 'aud' });
  assert.deepEqual(access.errors, []);
  assert.deepEqual(access.config.identity, { kind: 'access', teamDomain: TEAM, aud: 'aud' });
  const none = readBrokerConfig(BASE_ENV);
  assert.match(none.errors.join('\n'), /multi mode needs an identity check for the key page: .*WORCA_IDENTITY_ISSUER/);
});

test('the key page takes the same claim names; a bad one is an error', () => {
  const ok = readBrokerConfig({ ...BASE_ENV, WORCA_IDENTITY_ISSUER: ISSUER, WORCA_IDENTITY_EMAIL_CLAIM: 'preferred_username', WORCA_IDENTITY_TEAMS_CLAIM: 'roles' });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.config.identity.claims, { email: 'preferred_username', teams: 'roles' });
  const bad = readBrokerConfig({ ...BASE_ENV, WORCA_IDENTITY_ISSUER: ISSUER, WORCA_IDENTITY_EMAIL_CLAIM: 'a b' });
  assert.match(bad.errors.join('\n'), /WORCA_IDENTITY_EMAIL_CLAIM must be a claim name/);
  assert.equal(bad.errors.filter((e) => /multi mode needs an identity check/.test(e)).length, 0, 'one clear message, not two');
});

let server, base, store;
const key = makeIssuerKey();
before(async () => {
  const { config } = readBrokerConfig({ ...BASE_ENV, WORCA_IDENTITY_ISSUER: ISSUER });
  store = openStore();
  const service = createBrokerService({ config, slots: builtinSlots(), store });
  const identity = createIdentity(config, { fetchImpl: jwksFetch({ keys: [key] }) });
  server = http.createServer(createUiHandler({ config, service, store, identity }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); store?.close(); });

test('the key page: the platform token for its own host signs in, keyed by the (lowercased) email', async () => {
  const res = await fetch(`${base}/api/me`, { headers: { 'x-worca-identity': signIssuerJwt(key, { aud: KEY_HOST, email: 'Ada@Example.com' }) } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).email, 'ada@example.com');
});

test('the key page refuses: no token, the instance\'s token (other audience), an Access header', async () => {
  assert.equal((await fetch(`${base}/api/me`)).status, 401);
  assert.equal((await fetch(`${base}/api/me`, { headers: { 'x-worca-identity': signIssuerJwt(key) } })).status, 401);
  assert.equal((await fetch(`${base}/api/me`, { headers: { 'cf-access-jwt-assertion': signIssuerJwt(key, { aud: KEY_HOST }) } })).status, 401);
});
