import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { SUPPORTED_LANGUAGE_IDS } from '../ui/public/syntax-highlight.mjs';

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

test('dependency and lock pin the reviewed runtime package exactly', () => {
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
  const lock = JSON.parse(readFileSync(`${root}/package-lock.json`, 'utf8'));
  assert.equal(pkg.dependencies['@highlightjs/cdn-assets'], '11.12.0');
  assert.equal(pkg.dependencies['highlight.js'], undefined);
  assert.equal(pkg.devDependencies['highlight.js'], undefined);
  const locked = lock.packages['node_modules/@highlightjs/cdn-assets'];
  assert.equal(locked.version, '11.12.0');
  assert.equal(locked.integrity,
    'sha512-KvOKXODaiFmId9xaq3xc5xCL66wVLUuOngDbO9B/kewbFTqdGbn2nJxNhN3H5R1cgDTVj6R8vH0zgiNDEGjpDw==');
  assert.notEqual(locked.dev, true);
  assert.equal(lock.packages['node_modules/highlight.js'], undefined);
});

test('vendor core and every reviewed grammar are exact JavaScript ESM assets', async () => {
  const paths = [
    '/vendor/hljs/core.min.js',
    ...SUPPORTED_LANGUAGE_IDS.map((id) => `/vendor/hljs/languages/${id}.min.js`),
    '/vendor/hljs/languages/javascript.min.js?retry=1',
  ];
  for (const pathname of paths) {
    const res = await fetch(`${base}${pathname}`);
    assert.equal(res.status, 200, pathname);
    assert.match(res.headers.get('content-type') || '', /javascript/i, pathname);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', pathname);
    const source = await res.text();
    assert.match(source, /export(?:\s+default|\s*\{)/, pathname);
    const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    assert.ok(mod.default, `${pathname} has a default export`);
  }
});

test('vendor misses are plain, no-store responses and never the SPA shell', async () => {
  const paths = [
    '/vendor', '/vendor/', '/vendor/hljs/', '/vendor/hljs/package.json',
    '/vendor/hljs/languages/javascript.js',
    '/vendor/hljs/languages/missing.min.js',
    '/vendor/hljs/languages/brainfuck.min.js',
    '/vendor/hljs/languages/%2e%2e%2fcore.min.js',
    '/vendor/hljs/languages/javascript.min.js.map',
  ];
  for (const pathname of paths) {
    const res = await fetch(`${base}${pathname}`);
    assert.equal(res.status, 404, pathname);
    assert.doesNotMatch(res.headers.get('content-type') || '', /text\/html/i, pathname);
    assert.match(res.headers.get('cache-control') || '', /no-store/i, pathname);
    assert.doesNotMatch(await res.text(), /<!doctype html/i, pathname);
  }
});

test('malformed vendor encoding becomes a plain 400', async () => {
  const res = await fetch(`${base}/vendor/hljs/languages/%ZZ`);
  assert.equal(res.status, 400);
  assert.match(res.headers.get('content-type') || '', /text\/plain/i);
  assert.match(res.headers.get('cache-control') || '', /no-store/i);
  assert.doesNotMatch(await res.text(), /<!doctype html/i);
});

test('SPA fallback remains narrow and index has no highlighter script tag', async () => {
  for (const pathname of ['/vendorish', '/history/example']) {
    const res = await fetch(`${base}${pathname}`);
    assert.equal(res.status, 200, pathname);
    assert.match(res.headers.get('content-type') || '', /text\/html/i, pathname);
    assert.match(await res.text(), /<!doctype html/i, pathname);
  }
  const index = readFileSync(`${root}/ui/public/index.html`, 'utf8');
  assert.doesNotMatch(index, /highlight(?:\.min)?\.js|window\.hljs|vendor\/hljs/i);
});

test('asset resolution failure returns null and warns once', () => {
  const warnings = [];
  const result = testing.resolveHljsAssets(
    () => { throw new Error('unavailable'); },
    (message) => warnings.push(message),
  );
  assert.equal(result, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /syntax-highlighter assets unavailable: unavailable/);
});
