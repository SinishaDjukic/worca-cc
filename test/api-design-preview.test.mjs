// test/api-design-preview.test.mjs
// Design P3 Task 12, local mode: the preview gate mounted in ui/server.mjs after the peer check and before S1,
// identity and G1, and POST /api/design/:id/preview-token. A sandboxed `Origin: null` frame loads a real design's
// build doc by token, and every other route still refuses `Origin: null`. Requests go through http.request, so `..`
// and `%2e` reach the server as typed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readServerSource } from '../src/core/read-server-source.mjs';
import { BRIDGE_MARKER } from '../src/core/design/assemble.mjs';
import { designWorkDir } from '../src/core/design/paths.mjs';
import { previewGrants } from '../src/core/design/preview-grants.mjs';
import { createDesign, deleteDesign } from '../src/core/design/store.mjs';
import { useDesignEnv } from './helpers/design-fixture.mjs';
import { writeDesignWork } from './helpers/design-preview-fixture.mjs';

let srv, port, id;

// P8 Task 8: the local rule (no identity proxy, so no inline) decides here, not a developer's override. tools/test.mjs
// does not delete it.
delete process.env.WORCA_DESIGN_PREVIEW_INLINE;

// Registered before useDesignEnv's own hooks, which run after it (FIFO): the server closes before its home goes.
after(async () => { if (srv) await new Promise((r) => srv.close(r)); });
useDesignEnv(after);

before(async () => {
  id = createDesign({ kind: 'web' }).id;
  writeDesignWork(designWorkDir(id));
  writeFileSync(join(designWorkDir(id), 'assets', 'logo.png'), 'PNG-logo');
  writeFileSync(join(designWorkDir(id), 'sections', 'hero', 'index.html'), '<section data-section="hero"><h1>Ship</h1><img src="assets/logo.png" alt=""></section>');
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});

/** method + raw path + headers -> { status, headers, text, json }. Host is the listener's own `127.0.0.1:<port>`. */
function req(method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    r.on('error', reject);
    r.end();
  });
}

test('the gate sits after the peer check and before S1 and identity', () => {
  const src = readServerSource();   // src/core/read-server-source.mjs: test/public-assets.test.mjs fails any direct read of ui/server.mjs
  const peer = src.indexOf('if (!isTrustedPeer(req)) return res.status(403)');
  const gate = src.indexOf("app.use('/design-preview'");
  const s1 = src.indexOf('!req.worcaExtensionRoute && !isLocalRequest(req)');
  const identity = src.indexOf('if (!identityCheck && !REMOTE_ACCESS_CHECK.errors.length) return next();');
  assert.ok(peer > 0 && peer < gate && gate < s1 && s1 < identity, JSON.stringify({ peer, gate, s1, identity }));
  assert.equal(src.match(/app\.use\('\/design-preview'/g).length, 1);
});
test('mint: base and expiry; unknown or malformed ids are 404', async () => {
  const r = await req('POST', `/api/design/${id}/preview-token`);
  assert.equal(r.status, 200);
  assert.match(r.json.base, /^\/design-preview\/[A-Za-z0-9_-]{43}$/);
  assert.ok(r.json.expiresAt > Date.now() + 43_190_000);
  assert.equal((await req('POST', '/api/design/d_000000000000/preview-token')).status, 404);
  assert.equal((await req('POST', '/api/design/nope/preview-token')).status, 404);
});
test('the token route answers Origin: null, with the real doc', async () => {
  const { json: { base } } = await req('POST', `/api/design/${id}/preview-token`);
  const r = await req('GET', `${base}/build/`, { origin: 'null' });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-security-policy'], /^sandbox allow-scripts; default-src 'none'; script-src 'nonce-/);
  assert.equal(r.headers['access-control-allow-origin'], '*');
  assert.ok(r.text.includes(BRIDGE_MARKER));
  assert.ok(r.text.includes('data-worca-slot="price"'));
});
test('P8 Task 8: with no identity proxy the doc keeps its asset URLs, nothing is embedded', async () => {
  const { json: { base } } = await req('POST', `/api/design/${id}/preview-token`);
  for (const mode of ['build', 'run']) {
    const r = await req('GET', `${base}/${mode}/`, { origin: 'null' });
    assert.equal(r.status, 200, mode);
    assert.ok(r.text.includes('src="assets/logo.png"'), mode);
    assert.ok(!r.text.includes('src="data:'), mode);
  }
});
test('Origin: null stays refused on every other route, even holding a valid token', async () => {
  const { json: { base } } = await req('POST', `/api/design/${id}/preview-token`);
  const tok = base.split('/').pop();
  const OTHER = [['GET', '/'], ['GET', '/index.html'], ['GET', '/design/'], ['GET', '/style.css'], ['GET', '/api/health'], ['GET', '/api/flags'], ['GET', '/api/runs'],
    ['GET', '/api/design'], ['GET', `/api/design/${id}`], ['POST', `/api/design/${id}/preview-token`], ['GET', `/api/runs?token=${tok}`],
    ['GET', `/design-previewx/${tok}/build/`], ['GET', `/design-preview-x/${tok}/build/`], ['GET', '/vendor/dompurify/purify.es.mjs']];
  for (const [m, p] of OTHER) assert.equal((await req(m, p, { origin: 'null' })).status, 403, `${m} ${p}`);
});
test('the token route does not open anything else: raw traversal stays in the gate', async () => {
  const { json: { base } } = await req('POST', `/api/design/${id}/preview-token`);
  for (const p of [`${base}/build/../../../api/flags`, `${base}/../../api/flags`, `${base}/build/%2e%2e/%2e%2e/%2e%2e/api/flags`, `${base}/build/..%2f..%2f..%2fapi%2fflags`, '/design-preview/../api/flags']) {
    const r = await req('GET', p, { origin: 'null' });
    assert.equal(r.status, 404, p); assert.equal(r.text.includes('"flags"'), false, p);
  }
});
test('nothing under /design-preview reaches the SPA fallback', async () => {
  for (const p of ['/design-preview', '/design-preview/', '/design-preview/x', '/DESIGN-PREVIEW/x']) {
    const r = await req('GET', p);
    assert.equal(r.status, 404, p); assert.ok(!r.text.includes('<!DOCTYPE'), p);
  }
});
test("Review Focus: a deleted design's token is dead", async () => {
  const gone = createDesign({ kind: 'web' });
  const { json: { base } } = await req('POST', `/api/design/${gone.id}/preview-token`);
  deleteDesign(gone.id);
  const r = await req('GET', `${base}/build/`);
  assert.equal(r.status, 404); assert.ok(!r.text.includes('<'));
  assert.equal(previewGrants.check(base.split('/').pop()), null);
});
test('C-8: the DELETE route drops the grants itself, before any frame asks', async () => {
  const gone = createDesign({ kind: 'web' });
  const tok = (await req('POST', `/api/design/${gone.id}/preview-token`)).json.base.split('/').pop();
  assert.ok(previewGrants.check(tok));
  assert.ok((await req('DELETE', `/api/design/${gone.id}`)).status < 300);
  assert.equal(previewGrants.check(tok), null, 'dropGrants is wired into registerDesignRoutes');
});
test('flag off: the mint route and the gate are 404', async (t) => {
  const { json: { base } } = await req('POST', `/api/design/${id}/preview-token`);
  process.env.WORCA_FLAGS = '-design';
  t.after(() => { process.env.WORCA_FLAGS = 'design'; });
  assert.equal((await req('POST', `/api/design/${id}/preview-token`)).status, 404);
  assert.equal((await req('GET', `${base}/build/`)).status, 404);
});
test('mint on a local install: a design P2 made here (createdBy "local") mints, and the grant has no owner', async () => {
  const made = createDesign({ kind: 'web' }, { by: 'local' }).id;   // P2's POST records actorOf(req), 'local' on this box
  const r = await req('POST', `/api/design/${made}/preview-token`);
  assert.equal(r.status, 200, 'askViewer is null locally, so the maker is not compared');
  assert.equal(previewGrants.check(r.json.base.split('/').pop()).owner, null);
});
