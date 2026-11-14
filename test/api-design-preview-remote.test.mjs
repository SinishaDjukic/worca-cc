// test/api-design-preview-remote.test.mjs
// Design P3 Task 12, remote mode (REMOTE_MODE is fixed at import, hence its own file): the preview gate serves on the
// token with no Access sign-in but still checks the Host, the CSP names X-Forwarded-Proto's scheme, every other route
// keeps its sign-in and S1, and the mint route filters by owner. P8 Task 8: behind the proxy the doc embeds its CSS,
// fonts and images by the server-side default, so the frame requests nothing after it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { truncateSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { BRIDGE_MARKER, STANDALONE_MAX_FILE_BYTES } from '../src/core/design/assemble.mjs';
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
  'WORCA_CF_ACCESS_AUD', 'WORCA_FLAGS', 'WORCA_DESIGN_PREVIEW_INLINE'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let homeDir, srv, port, mine, theirs, base, tok;
// A real 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const signedIn = () => ({ host: PUBLIC, origin: `https://${PUBLIC}`, 'cf-access-jwt-assertion': signAccessJwt(accessKey) });

/** Hero (done in .crew.json) shows `<img src="assets/<img>">`, and global.css loads a font from assets/. */
function writeAssetWork(work, img) {
  writeDesignWork(work);
  writeFileSync(join(work, 'assets', 'logo.png'), PNG);
  writeFileSync(join(work, 'assets', 'brand.woff2'), 'wOF2-font-bytes');
  writeFileSync(join(work, 'global.css'), '@font-face{font-family:Brand;src:url(assets/brand.woff2) format("woff2")}body{margin:0;font-family:Brand}');
  writeFileSync(join(work, 'sections', 'hero', 'index.html'), `<section data-section="hero"><h1>Ship</h1><img src="assets/${img}" alt=""></section>`);
}

/** method + path + headers -> { status, headers, text, body }. Host defaults to PUBLIC (the remote host). */
function call(method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: PUBLIC, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let body = null; try { body = text ? JSON.parse(text) : null; } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, text, body }); });
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
  delete process.env.WORCA_DESIGN_PREVIEW_INLINE;   // the rule decides, not a developer's override
  _resetForTests();
  // Before the import: the Access verifier takes the global fetch when the server builds it.
  globalThis.fetch = (url, opts) => (String(url) === CERTS_URL ? fakeCerts(url) : realFetch(url, opts));
  mine = createDesign({ kind: 'web' }, { by: 'me@example.com' }).id;
  theirs = createDesign({ kind: 'web' }, { by: 'other@example.com' }).id;
  writeAssetWork(designWorkDir(mine), 'logo.png');
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
test('behind an identity proxy nothing is requested after the doc, and the CSP is unchanged', async () => {
  for (const mode of ['build', 'run']) {
    const r = await call('GET', `${base}/${mode}/`, { host: PUBLIC, origin: 'null' });
    assert.equal(r.status, 200, mode);
    assert.ok(!r.text.includes('src="assets/logo.png"'), `${mode}: the image URL is gone`);
    assert.ok(r.text.includes('src="data:image/png;base64,'), `${mode}: the image is embedded`);
    assert.ok(r.text.includes(BRIDGE_MARKER), `${mode}: the bridge is still there`);
    assert.match(r.headers['content-security-policy'], /^sandbox allow-scripts; default-src 'none'; script-src /);
    assert.ok(r.headers['content-security-policy'].includes(`http://${PUBLIC}/design-preview/${tok}/`), `${mode}: {B} kept`);
    assert.ok(!r.text.includes('url(assets/brand.woff2)'), `${mode}: the font URL is gone`);
    assert.ok(r.text.includes('url(data:font/woff2;base64,'), `${mode}: the font is embedded`);
  }
});
test('an asset over the limit is left as its URL, never a 500', async () => {
  const big = createDesign({ kind: 'web' }, { by: 'me@example.com' }).id;
  const work = designWorkDir(big);
  writeAssetWork(work, 'huge.png');
  const huge = join(work, 'assets', 'huge.png');
  writeFileSync(huge, ''); truncateSync(huge, STANDALONE_MAX_FILE_BYTES + 1);
  const minted = await call('POST', `/api/design/${big}/preview-token`, signedIn());
  assert.equal(minted.status, 200);
  for (const mode of ['build', 'run']) {
    const r = await call('GET', `${minted.body.base}/${mode}/`, { host: PUBLIC, origin: 'null' });
    assert.equal(r.status, 200, mode);
    assert.ok(r.text.includes('src="assets/huge.png"'), `${mode}: the URL is kept`);
    assert.ok(r.text.includes('url(data:font/woff2;base64,'), `${mode}: what fits is still embedded`);
  }
});
