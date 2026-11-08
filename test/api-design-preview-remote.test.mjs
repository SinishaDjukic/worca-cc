// test/api-design-preview-remote.test.mjs
// Design P3 Task 12, remote mode (REMOTE_MODE is fixed at import, hence its own file): the preview gate serves on the
// token with no Access sign-in but still checks the Host, the CSP names X-Forwarded-Proto's scheme, every other route
// keeps its sign-in and S1, and the mint route filters by owner.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { designWorkDir } from '../src/core/design/paths.mjs';
import { previewGrants } from '../src/core/design/preview-grants.mjs';
import { createDesign } from '../src/core/design/store.mjs';
import { TEAM, AUD, CERTS_URL, makeAccessKey, signAccessJwt, certsFetch } from './helpers/access-jwt.mjs';
import { writeDesignWork } from './helpers/design-preview-fixture.mjs';

const PUBLIC = 'worca-01.example.com';
const accessKey = makeAccessKey();
const fakeCerts = certsFetch({ keys: [accessKey] });
const realFetch = globalThis.fetch;
const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_MOCK', 'WORCA_ALLOWED_HOSTS', 'WORCA_CF_ACCESS_TEAM_DOMAIN',
  'WORCA_CF_ACCESS_AUD', 'WORCA_FLAGS'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let homeDir, srv, port, mine, theirs, base, tok;

/** method + path + headers -> { status, headers, body }. Host defaults to PUBLIC (the remote host). */
function call(method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: PUBLIC, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let body = null; try { body = text ? JSON.parse(text) : null; } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, body }); });
    });
    r.on('error', reject);
    r.end();
  });
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-dprev-remote-'));
  process.env.WORCA_HOME = homeDir;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_ALLOWED_HOSTS = PUBLIC;
  process.env.WORCA_CF_ACCESS_TEAM_DOMAIN = TEAM;
  process.env.WORCA_CF_ACCESS_AUD = AUD;
  process.env.WORCA_FLAGS = 'design';   // tools/test.mjs deletes it, and the flag is off by default
  _resetForTests();
  // Before the import: the Access verifier takes the global fetch when the server builds it.
  globalThis.fetch = (url, opts) => (String(url) === CERTS_URL ? fakeCerts(url) : realFetch(url, opts));
  mine = createDesign({ kind: 'web' }, { by: 'me@example.com' }).id;
  theirs = createDesign({ kind: 'web' }, { by: 'other@example.com' }).id;
  writeDesignWork(designWorkDir(mine));
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  const minted = await call('POST', `/api/design/${mine}/preview-token`,
    { host: PUBLIC, origin: `https://${PUBLIC}`, 'cf-access-jwt-assertion': signAccessJwt(accessKey) });
  assert.equal(minted.status, 200, 'mint for the signed-in maker');
  base = minted.body.base;
  tok = base.split('/').pop();
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  globalThis.fetch = realFetch;
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (homeDir) await rm(homeDir, { recursive: true, force: true, maxRetries: 3 });
});

test('token route: no sign-in needed, Host still checked, X-Forwarded-Proto names https', async () => {
  const r = await call('GET', `${base}/build/`, { host: PUBLIC, origin: 'null', 'x-forwarded-proto': 'https' });
  assert.equal(r.status, 200);
  assert.ok(r.headers['content-security-policy'].includes(`https://${PUBLIC}/design-preview/${tok}/`));
  const plain = await call('GET', `${base}/build/`, { host: PUBLIC });
  assert.ok(plain.headers['content-security-policy'].includes(`http://${PUBLIC}/design-preview/${tok}/`));
  assert.equal((await call('GET', `${base}/build/`, { host: 'evil.example' })).status, 403);
});
test('every other route keeps its sign-in and its S1', async () => {
  assert.equal((await call('GET', '/api/design', { host: PUBLIC })).status, 401);
  assert.equal((await call('GET', '/api/design', { host: PUBLIC, origin: 'null', 'cf-access-jwt-assertion': signAccessJwt(accessKey) })).status, 403);
  assert.equal((await call('GET', `/design-previewx/${tok}/build/`, { host: PUBLIC })).status, 401);
});
test('owner filter on mint', async () => {
  const me = { host: PUBLIC, origin: `https://${PUBLIC}`, 'cf-access-jwt-assertion': signAccessJwt(accessKey) };
  assert.equal((await call('POST', `/api/design/${mine}/preview-token`, me)).status, 200);
  assert.equal((await call('POST', `/api/design/${theirs}/preview-token`, me)).status, 404);
});
test('a design with no maker mints for anyone signed in, and the grant records who minted it', async () => {
  const me = { host: PUBLIC, origin: `https://${PUBLIC}`, 'cf-access-jwt-assertion': signAccessJwt(accessKey) };
  const nobody = createDesign({ kind: 'web' }).id;   // no maker: everyone's, as listDesigns keeps it
  const r = await call('POST', `/api/design/${nobody}/preview-token`, me);
  assert.equal(r.status, 200);
  assert.equal(previewGrants.check(r.body.base.split('/').pop()).owner, 'me@example.com');
  assert.equal(previewGrants.check(tok).owner, 'me@example.com');
});
