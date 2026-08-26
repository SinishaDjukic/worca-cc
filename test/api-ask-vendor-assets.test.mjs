// test/api-ask-vendor-assets.test.mjs
// Ask Worca §10.7: the two ESM vendor routes for the chat's markdown pipeline.
// marked has NO default export (use mod.marked); dompurify default-exports a
// factory. Both files are self-contained ESM, so the data:-URL import proves
// the served bytes are the real module. Misses fall into the existing /vendor
// no-store 404; nothing here may disturb the hljs routes or the SPA fallback.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

const root = fileURLToPath(new URL('..', import.meta.url));
let srv;
let base;
let testing;

before(async () => {
  const mod = await import('../ui/server.mjs');
  testing = mod._testing;
  srv = http.createServer(mod.app);
  await new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      srv.off('error', reject);
      resolve();
    });
  });
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) {
    await new Promise((resolve) => {
      srv.close(resolve);
      srv.closeAllConnections();
    });
  }
});

test('dependencies and lock pin the reviewed markdown packages exactly', () => {
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
  const lock = JSON.parse(readFileSync(`${root}/package-lock.json`, 'utf8'));
  assert.equal(pkg.dependencies.marked, '18.0.10');
  assert.equal(pkg.dependencies.dompurify, '3.4.14');
  assert.equal((pkg.devDependencies || {}).marked, undefined);
  assert.equal((pkg.devDependencies || {}).dompurify, undefined);
  const markedLock = lock.packages['node_modules/marked'];
  assert.equal(markedLock.version, '18.0.10');
  assert.equal(markedLock.integrity,
    'sha512-FJeH4bRpYoXiggcgriCGItKCSv3xkngJc4QCZ/rkQCogU3VYaLxYJoZl8Nw/b4+x7iij/pd+09mZ6A1dXzpL0A==');
  assert.notEqual(markedLock.dev, true);
  const purifyLock = lock.packages['node_modules/dompurify'];
  assert.equal(purifyLock.version, '3.4.14');
  assert.equal(purifyLock.integrity,
    'sha512-dVoH9z+MY+C9IilgGCk3YfFqjLi3fChm2OiKJMzh6axrJ5qwxqWaZamgmHrpv22CN/KdbZJuGEGgfQoL00LTdg==');
  assert.notEqual(purifyLock.dev, true);
});

test('both vendor modules are served as importable ESM with the promised shapes', async () => {
  const cases = [
    { path: '/vendor/marked/marked.esm.js', expectMarked: true },
    { path: '/vendor/marked/marked.esm.js?retry=1', expectMarked: true },
    { path: '/vendor/dompurify/purify.es.mjs', expectMarked: false },
  ];
  for (const { path: pathname, expectMarked } of cases) {
    const res = await fetch(`${base}${pathname}`);
    assert.equal(res.status, 200, pathname);
    assert.match(res.headers.get('content-type') || '', /javascript/i, pathname);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', pathname);
    const source = await res.text();
    const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    if (expectMarked) {
      assert.equal(typeof mod.marked, 'function', `${pathname} exposes mod.marked`);
      assert.equal(mod.default, undefined, `${pathname} has no default export`);
      assert.equal(mod.marked.parse('**b**', { gfm: true, breaks: true, async: false }), '<p><strong>b</strong></p>\n');
    } else {
      assert.equal(typeof mod.default, 'function', `${pathname} default-exports the DOMPurify factory`);
    }
  }
});

test('vendor misses stay plain no-store 404s and never the SPA shell', async () => {
  const paths = [
    '/vendor/marked/',
    '/vendor/marked/marked.cjs',
    '/vendor/marked/package.json',
    '/vendor/dompurify/purify.cjs.js',
    '/vendor/dompurify/%2e%2e%2fpackage.json',
    '/vendor/marked/marked.esm.js.map',
  ];
  for (const pathname of paths) {
    const res = await fetch(`${base}${pathname}`);
    assert.equal(res.status, 404, pathname);
    assert.doesNotMatch(res.headers.get('content-type') || '', /text\/html/i, pathname);
    assert.match(res.headers.get('cache-control') || '', /no-store/i, pathname);
    assert.doesNotMatch(await res.text(), /<!doctype html/i, pathname);
  }
});

test('hljs vendor routes are untouched', async () => {
  const res = await fetch(`${base}/vendor/hljs/core.min.js`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('resolution failure returns null and warns once, and the routes degrade to 404', () => {
  const warnings = [];
  const result = testing.resolveEsmAsset(
    'marked',
    () => { throw new Error('unavailable'); },
    (message) => warnings.push(message),
  );
  assert.equal(result, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ask markdown asset unavailable \(marked\): unavailable/);
});
