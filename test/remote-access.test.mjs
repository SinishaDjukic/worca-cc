// test/remote-access.test.mjs
// src/core/remote-access.mjs: the opt-in remote-access config, its fail-closed
// validation, the Host/Origin allowlist and the provider-agnostic identity check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAllowedHosts, readRemoteAccessConfig, checkRemoteAccessConfig, isRemoteMode,
  createHostGuard, isInContainer, createIdentityCheck, hostnameOf,
} from '../src/core/remote-access.mjs';
import { TEAM, AUD, makeAccessKey, signAccessJwt, certsFetch } from './helpers/access-jwt.mjs';

const req = ({ host, origin, peer = '10.0.0.5', headers = {} } = {}) => ({
  headers: { ...(host !== undefined ? { host } : {}), ...(origin ? { origin } : {}), ...headers },
  socket: { remoteAddress: peer },
});
const CF = { WORCA_CF_ACCESS_TEAM_DOMAIN: TEAM, WORCA_CF_ACCESS_AUD: AUD };

test('parseAllowedHosts: trims, lowercases, dedupes, flags schemes/ports/junk', () => {
  assert.deepEqual(parseAllowedHosts(' Worca-01.Example.com , .example.org,worca-01.example.com,, '),
    { hosts: ['worca-01.example.com', '.example.org'], invalid: [] });
  assert.deepEqual(parseAllowedHosts('https://a.example.com, a.example.com:443, *.example.com, .').invalid,
    ['https://a.example.com', 'a.example.com:443', '*.example.com', '.']);
  assert.deepEqual(parseAllowedHosts(undefined), { hosts: [], invalid: [] });
});

test('unset environment = local mode, no errors, no warnings', () => {
  const cfg = readRemoteAccessConfig({});
  assert.equal(isRemoteMode(cfg), false);
  assert.equal(cfg.identity, null);
  assert.deepEqual(checkRemoteAccessConfig(cfg), { errors: [], warnings: [] });
  assert.equal(createIdentityCheck(cfg), null);
});

test('fail closed: an allowlist without an identity check is an error', () => {
  const cfg = readRemoteAccessConfig({ WORCA_ALLOWED_HOSTS: 'worca-01.example.com' });
  const { errors } = checkRemoteAccessConfig(cfg, { bindHost: '::' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no identity check is configured/);
  assert.match(errors[0], /WORCA_INSECURE_NO_IDENTITY_CHECK=1/);
});

test('an allowlist of loopback names only is not remote mode', () => {
  const cfg = readRemoteAccessConfig({ WORCA_ALLOWED_HOSTS: 'localhost,127.0.0.1' });
  assert.equal(isRemoteMode(cfg), false);
  assert.deepEqual(checkRemoteAccessConfig(cfg).errors, []);
});

test('the explicit insecure flag downgrades the error to a loud warning', () => {
  for (const v of ['1', 'true', 'YES']) {
    const cfg = readRemoteAccessConfig({ WORCA_ALLOWED_HOSTS: 'worca-01.example.com', WORCA_INSECURE_NO_IDENTITY_CHECK: v });
    const { errors, warnings } = checkRemoteAccessConfig(cfg, { bindHost: '::' });
    assert.deepEqual(errors, []);
    assert.match(warnings.join('\n'), /checks no identity/);
    assert.equal(createIdentityCheck(cfg), null);
  }
  const off = readRemoteAccessConfig({ WORCA_ALLOWED_HOSTS: 'w.example.com', WORCA_INSECURE_NO_IDENTITY_CHECK: '0' });
  assert.equal(checkRemoteAccessConfig(off).errors.length, 1, '"0" is not an opt-out');
});

test('Cloudflare Access config: both halves required; valid config has no errors', () => {
  const ok = readRemoteAccessConfig({ WORCA_ALLOWED_HOSTS: 'worca-01.example.com', ...CF });
  assert.deepEqual(checkRemoteAccessConfig(ok, { bindHost: '::' }), { errors: [], warnings: [] });
  assert.deepEqual(ok.identity, { provider: 'cloudflare-access', teamDomain: TEAM, aud: AUD });

  const noAud = readRemoteAccessConfig({ WORCA_ALLOWED_HOSTS: 'w.example.com', WORCA_CF_ACCESS_TEAM_DOMAIN: TEAM });
  assert.match(checkRemoteAccessConfig(noAud).errors.join('\n'), /WORCA_CF_ACCESS_AUD is not/);
  const noTeam = readRemoteAccessConfig({ WORCA_ALLOWED_HOSTS: 'w.example.com', WORCA_CF_ACCESS_AUD: AUD });
  assert.match(checkRemoteAccessConfig(noTeam).errors.join('\n'), /WORCA_CF_ACCESS_TEAM_DOMAIN is not/);
});

test('warnings: exposed bind without allowlist, Access without allowlist, redundant insecure flag', () => {
  const w = (env, bindHost) => checkRemoteAccessConfig(readRemoteAccessConfig(env), { bindHost }).warnings.join('\n');
  assert.match(w({}, '0.0.0.0'), /every request not addressed to localhost gets a 403/);
  assert.equal(w({}, '127.0.0.1'), '');
  assert.match(w({ ...CF }, '127.0.0.1'), /only localhost requests are accepted/);
  assert.match(w({ WORCA_ALLOWED_HOSTS: 'w.example.com', ...CF, WORCA_INSECURE_NO_IDENTITY_CHECK: '1' }, '::'), /is ignored/);
});

test('invalid allowlist entries are an error', () => {
  const cfg = readRemoteAccessConfig({ WORCA_ALLOWED_HOSTS: 'https://w.example.com', ...CF });
  assert.match(checkRemoteAccessConfig(cfg).errors.join('\n'), /invalid entries: https:\/\/w\.example\.com/);
});

test('host guard: loopback always, exact names, leading-dot suffixes, Origin checked too', () => {
  const g = createHostGuard(['worca-01.example.com', '.corp.example']);
  assert.equal(g(req({ host: 'localhost:4317' })), true);
  assert.equal(g(req({ host: '[::1]:4317' })), true);
  assert.equal(g(req({ host: 'worca-01.example.com', origin: 'https://worca-01.example.com' })), true);
  assert.equal(g(req({ host: 'WORCA-01.EXAMPLE.COM' })), true, 'case-insensitive');
  assert.equal(g(req({ host: 'a.corp.example' })), true);
  assert.equal(g(req({ host: 'worca-02.example.com' })), false, 'exact means exact');
  assert.equal(g(req({ host: 'evilcorp.example' })), false, 'suffix needs the dot');
  assert.equal(g(req({ host: 'worca-01.example.com.evil.net' })), false);
  assert.equal(g(req({ host: 'worca-01.example.com', origin: 'https://evil.net' })), false, 'foreign Origin');
  assert.equal(g(req({ host: 'worca-01.example.com', origin: 'null' })), false, 'opaque Origin');
  assert.equal(g(req({})), false, 'no Host');
});

test('host guard with an empty allowlist is exactly the old loopback-only guard', () => {
  const g = createHostGuard([]);
  assert.equal(g(req({ host: '127.0.0.1:4317', origin: 'http://localhost:4317' })), true);
  assert.equal(g(req({ host: 'worca-01.example.com' })), false);
  assert.equal(g(req({ host: 'localhost', origin: 'https://evil.net' })), false);
});

test('isInContainer needs a loopback peer AND a loopback Host', () => {
  assert.equal(isInContainer(req({ host: 'localhost:4317', peer: '127.0.0.1' })), true);
  assert.equal(isInContainer(req({ host: 'localhost:4317', peer: '::ffff:127.0.0.1' })), true);
  assert.equal(isInContainer(req({ host: 'localhost:4317', peer: 'fd12::5' })), false, 'cloudflared on the private network');
  assert.equal(isInContainer(req({ host: 'worca-01.example.com', peer: '127.0.0.1' })), false, 'a same-box proxy forwarding the public Host');
});

test('createIdentityCheck reads Cf-Access-Jwt-Assertion', async () => {
  const key = makeAccessKey();
  const cfg = readRemoteAccessConfig({ WORCA_ALLOWED_HOSTS: 'w.example.com', ...CF });
  const check = createIdentityCheck(cfg, { fetchImpl: certsFetch({ keys: [key] }) });
  assert.deepEqual(await check(req({ host: 'w.example.com', headers: { 'cf-access-jwt-assertion': signAccessJwt(key) } })),
    { email: 'me@example.com', sub: 'user-1' });
  assert.equal(await check(req({ host: 'w.example.com' })), null);
});

test('hostnameOf handles Host values and Origin URLs', () => {
  assert.equal(hostnameOf('Example.com:8080'), 'example.com');
  assert.equal(hostnameOf('https://example.com'), 'example.com');
  assert.equal(hostnameOf('[::1]:4317'), '[::1]');
  assert.equal(hostnameOf(''), null);
});
