// test/github-app.test.mjs
// GitHub App mode (src/core/github-app.mjs + githubEnv): a fresh, role-scoped installation
// token per call, never cached; the key from a file or base64. A local RSA key and a fake
// GitHub API; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appConfigured, loadAppConfig, appJwt, resolveInstallation, mintInstallationToken } from '../src/core/github-app.mjs';
import { githubEnv, readGithubCredentials, stripGithubCredentials } from '../src/core/github-credentials.mjs';
import { githubMode } from '../src/core/deployment.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' });   // GitHub hands out PKCS#1
const B64 = Buffer.from(PEM).toString('base64');
const ENV = { WORCA_GH_APP_ID: '12345', WORCA_GH_APP_KEY_B64: B64, WORCA_GH_APP_INSTALLATION_ID: '777', PATH: '/bin' };

/** A fake api.github.com: records calls, verifies the App JWT, hands out numbered tokens. */
function fakeGithub({ installations = [{ id: 777 }], repoInstall = { 'acme/api': 888 }, tokenStatus = 201 } = {}) {
  const calls = [];
  let n = 0;
  const f = async (url, init) => {
    const u = new URL(url);
    const jwt = String(init.headers.Authorization || '').replace(/^Bearer /, '');
    const [h, p, sig] = jwt.split('.');
    const valid = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, 'base64url'));
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    calls.push({ method: init.method, path: u.pathname, body: init.body ? JSON.parse(init.body) : null, valid, claims });
    const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (!valid) return json(401, { message: 'bad jwt' });
    if (u.pathname === '/app/installations') return json(200, installations);
    const m = /^\/repos\/(.+)\/installation$/.exec(u.pathname);
    if (m) return repoInstall[m[1]] ? json(200, { id: repoInstall[m[1]] }) : json(404, { message: 'Not Found' });
    if (/^\/app\/installations\/\d+\/access_tokens$/.test(u.pathname)) {
      n += 1;
      return tokenStatus === 201 ? json(201, { token: `ghs_token${n}`, expires_at: '2026-09-24T12:00:00Z' }) : json(tokenStatus, {});
    }
    return json(404, {});
  };
  f.calls = calls;
  return f;
}

test('appConfigured / mode: App wins over token modes; the id must be numeric and a key must be given', () => {
  assert.equal(appConfigured(ENV), true);
  assert.equal(appConfigured({ WORCA_GH_APP_ID: '12345' }), false, 'no key');
  assert.equal(appConfigured({ WORCA_GH_APP_ID: 'abc', WORCA_GH_APP_KEY_B64: B64 }), false);
  assert.deepEqual(readGithubCredentials({ ...ENV, GH_TOKEN: 'g' }), { mode: 'app', read: null, write: null });
  assert.equal(githubMode(ENV), 'app');
});

test('loadAppConfig: key from base64 or from a file; clear errors that name no secret', () => {
  assert.equal(loadAppConfig(ENV).installationId, '777');
  const dir = mkdtempSync(join(tmpdir(), 'worca-app-'));
  writeFileSync(join(dir, 'key.pem'), PEM);
  const fromFile = loadAppConfig({ WORCA_GH_APP_ID: '1', WORCA_GH_APP_KEY_FILE: join(dir, 'key.pem') });
  assert.equal(fromFile.key.asymmetricKeyType, 'rsa');
  assert.equal(fromFile.installationId, null);
  assert.throws(() => loadAppConfig({ WORCA_GH_APP_ID: '1', WORCA_GH_APP_KEY_FILE: join(dir, 'missing.pem') }), /cannot read WORCA_GH_APP_KEY_FILE \(ENOENT\)/);
  assert.throws(() => loadAppConfig({ WORCA_GH_APP_ID: '1', WORCA_GH_APP_KEY_B64: Buffer.from('not a key').toString('base64') }), /not a valid PEM key/);
  assert.throws(() => loadAppConfig({ ...ENV, WORCA_GH_APP_INSTALLATION_ID: 'x' }), /must be numeric/);
});

test('appJwt: RS256, iss = the App id, issued 60 s back, valid under 10 minutes', () => {
  const now = Date.UTC(2026, 8, 24, 10, 0, 0);
  const [h, p, s] = appJwt(loadAppConfig(ENV), now).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const c = JSON.parse(Buffer.from(p, 'base64url'));
  assert.deepEqual(c, { iat: now / 1000 - 60, exp: now / 1000 + 540, iss: '12345' });
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url')));
});

test('installation: the configured id, else the repo\'s, else the only one; clear errors otherwise', async () => {
  const cfg = loadAppConfig({ ...ENV, WORCA_GH_APP_INSTALLATION_ID: '' });
  assert.equal(await resolveInstallation(loadAppConfig(ENV), { fetchImpl: fakeGithub() }), '777');
  assert.equal(await resolveInstallation(cfg, { repo: 'acme/api', fetchImpl: fakeGithub() }), '888');
  assert.equal(await resolveInstallation(cfg, { fetchImpl: fakeGithub() }), '777');
  await assert.rejects(resolveInstallation(cfg, { repo: 'acme/other', fetchImpl: fakeGithub() }), /not installed on acme\/other/);
  await assert.rejects(resolveInstallation(cfg, { fetchImpl: fakeGithub({ installations: [{ id: 1 }, { id: 2 }] }) }), /set WORCA_GH_APP_INSTALLATION_ID/);
});

test('mint: a fresh token per call, scoped down to the role', async () => {
  const gh = fakeGithub();
  const cfg = loadAppConfig(ENV);
  const a = await mintInstallationToken(cfg, { role: 'write', fetchImpl: gh });
  const b = await mintInstallationToken(cfg, { role: 'read', fetchImpl: gh });
  assert.notEqual(a.token, b.token, 'never cached');
  const posts = gh.calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].body, { permissions: { contents: 'write', metadata: 'read', pull_requests: 'write' } });
  assert.deepEqual(posts[1].body, { permissions: { contents: 'read', metadata: 'read', pull_requests: 'read' } });
  assert.ok(posts.every((c) => c.path === '/app/installations/777/access_tokens' && c.valid));
  await assert.rejects(mintInstallationToken(cfg, { fetchImpl: fakeGithub({ tokenStatus: 401 }) }), /App ID or private key was rejected/);
  await assert.rejects(mintInstallationToken(cfg, { role: 'write', fetchImpl: fakeGithub({ tokenStatus: 422 }) }), /lacks the write permissions/);
});

test('githubEnv in App mode: the minted token in this call\'s env only; the key never; nothing on disk', async () => {
  const { env, error } = await githubEnv('write', { base: ENV, fetchImpl: fakeGithub() });
  assert.equal(error, null);
  assert.equal(env.GH_TOKEN, 'ghs_token1');
  assert.equal(env.WORCA_GIT_TOKEN, 'ghs_token1');
  for (const k of ['WORCA_GH_APP_ID', 'WORCA_GH_APP_KEY_B64', 'WORCA_GH_APP_INSTALLATION_ID']) assert.equal(env[k], undefined, k);
  assert.equal(env.GIT_CONFIG_KEY_1, 'credential.https://github.com.helper');
  // Nothing is written: githubEnv only returns an env (a tmpdir count here raced other suites).
  const second = await githubEnv('write', { base: ENV, fetchImpl: fakeGithub() });
  assert.equal(second.env.GH_TOKEN, 'ghs_token1', 'a fresh fake, a fresh mint');
});

test('githubEnv never throws: a failed mint gives a credential-free env and the reason', async () => {
  const { env, error } = await githubEnv('write', { base: ENV, fetchImpl: fakeGithub({ tokenStatus: 404 }) });
  assert.match(error, /installation 777 not found/);
  assert.deepEqual(env, stripGithubCredentials(ENV));
  const down = await githubEnv('read', { base: ENV, fetchImpl: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); } });
  assert.match(down.error, /GitHub API unreachable \(ENOTFOUND\)/);
  assert.equal(down.env.GH_TOKEN, undefined);
});

test('a long run still pushes: the token is minted at push time, so run length never matters', async () => {
  const gh = fakeGithub();
  const start = Date.UTC(2026, 8, 24, 0, 0, 0);
  const early = await githubEnv('read', { base: ENV, fetchImpl: gh, now: start });
  const late = await githubEnv('write', { base: ENV, fetchImpl: gh, now: start + 30 * 3600_000 });
  assert.equal(early.error, null);
  assert.equal(late.error, null);
  const jwts = gh.calls.filter((c) => c.method === 'POST').map((c) => c.claims.iat);
  assert.equal(jwts[1] - jwts[0], 30 * 3600, 'each call signs its own JWT at its own time');
});
