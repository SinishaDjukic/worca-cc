// test/ghe-host.test.mjs — the pure GHE.com (data residency) host helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GHE_COM_ACCOUNT_TYPE, normalizeGheHost, gheUrls, gheGatewayFallback, isTenantOrigin, gheTenantOfUrl, gheEgressAllow, isGithubClientId,
} from '../src/core/ghe-host.mjs';
import { COPILOT_ACCOUNT_TYPES } from '../src/core/model-env.mjs';

test('normalizeGheHost: accepted forms normalize; path, port, credentials, http, apex, nested and non-ghe hosts are null', () => {
  for (const ok of ['acme.ghe.com', ' ACME.ghe.com ', 'https://acme.ghe.com', 'https://acme.ghe.com/', 'a.ghe.com', 'my-co1.ghe.com']) {
    assert.equal(normalizeGheHost(ok), ok.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/$/, ''), ok);
  }
  for (const bad of [
    'http://acme.ghe.com', 'acme.ghe.com:443', 'acme.ghe.com/path', 'user@acme.ghe.com', 'https://acme.ghe.com?x',
    'ghe.com', 'api.acme.ghe.com', 'acme.github.com', '-acme.ghe.com', 'acme-.ghe.com', '', '   ', null, undefined, 5, {},
    `${'a'.repeat(64)}.ghe.com`, 'https://acme.ghe.com//', 'acme.ghe.com.evil.example',
  ]) assert.equal(normalizeGheHost(bad), null, String(bad));
});

test('gheUrls: null is github.com; a tenant derives web and api', () => {
  assert.deepEqual(gheUrls(null), { host: 'github.com', web: 'https://github.com', api: 'https://api.github.com' });
  assert.deepEqual(gheUrls('acme.ghe.com'), { host: 'acme.ghe.com', web: 'https://acme.ghe.com', api: 'https://api.acme.ghe.com' });
  assert.equal(gheGatewayFallback('acme.ghe.com'), 'https://copilot-api.acme.ghe.com');
});

test('isTenantOrigin: only https subdomains of that tenant, no port, no userinfo; another tenant and look-alikes fail', () => {
  assert.equal(isTenantOrigin('https://copilot-api.acme.ghe.com', 'acme.ghe.com'), true);
  assert.equal(isTenantOrigin('https://api.acme.ghe.com/x', 'acme.ghe.com'), true);
  for (const bad of [
    'http://copilot-api.acme.ghe.com', 'https://copilot-api.acme.ghe.com:8443', 'https://u:p@copilot-api.acme.ghe.com',
    'https://copilot-api.other.ghe.com', 'https://acme.ghe.com', 'https://acme.ghe.com.evil.example', 'https://evilacme.ghe.com',
    'https://api.githubcopilot.com', 'not a url', '',
  ]) assert.equal(isTenantOrigin(bad, 'acme.ghe.com'), false, bad);
  assert.equal(isTenantOrigin('https://copilot-api.acme.ghe.com', 'bad host'), false);
  assert.equal(isTenantOrigin('https://x.ghe.com', null), false);
});

test('gheTenantOfUrl: tenant web and api URLs map to the tenant; github.com and http are null', () => {
  assert.equal(gheTenantOfUrl('https://acme.ghe.com'), 'acme.ghe.com');
  assert.equal(gheTenantOfUrl('https://api.acme.ghe.com/copilot_internal/v2/token'), 'acme.ghe.com');
  for (const bad of ['https://api.github.com/x', 'https://github.com', 'http://acme.ghe.com', 'https://copilot-api.acme.ghe.com', 'nope', undefined]) {
    assert.equal(gheTenantOfUrl(bad), null, String(bad));
  }
});

test('gheEgressAllow: apex plus subdomains for a valid host, nothing otherwise', () => {
  assert.deepEqual(gheEgressAllow('acme.ghe.com'), ['acme.ghe.com', '.acme.ghe.com']);
  assert.deepEqual(gheEgressAllow('https://ACME.ghe.com/'), ['acme.ghe.com', '.acme.ghe.com']);
  assert.deepEqual(gheEgressAllow('github.com'), []);
  assert.deepEqual(gheEgressAllow(null), []);
});

test('COPILOT_ACCOUNT_TYPES includes GHE_COM_ACCOUNT_TYPE', () => {
  assert.ok(COPILOT_ACCOUNT_TYPES.includes(GHE_COM_ACCOUNT_TYPE));
  assert.equal(GHE_COM_ACCOUNT_TYPE, 'ghe-com');
});

test('isGithubClientId: 8–64 of letters, digits, . _ -; anything else is false', () => {
  for (const ok of ['Iv1.b507a08c87ecfe98', 'Ov23liCUSTOM123', 'abcdefgh', 'a'.repeat(64)]) assert.equal(isGithubClientId(ok), true, ok);
  for (const bad of ['short', 'a'.repeat(65), 'has space1', 'bad id!', '', null, undefined, 12345678]) assert.equal(isGithubClientId(bad), false, String(bad));
});
