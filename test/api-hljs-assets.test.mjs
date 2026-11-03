import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { useTempHome } from './helpers/temp-home.mjs';
import { SUPPORTED_LANGUAGE_IDS } from '../ui/public/syntax-highlight.mjs';
import { HLJS_GRAMMAR_IDS } from '../ui/public/hljs-loader.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

useTempHome(after);

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

test('vendor core and every reviewed or sub-language grammar are exact JavaScript ESM assets', async () => {
  // The loader's closure needs grammars that are not primaries (mojolicious for
  // perl); the server allowlist is HLJS_GRAMMAR_IDS, a superset of the primaries.
  assert.ok(SUPPORTED_LANGUAGE_IDS.every((id) => HLJS_GRAMMAR_IDS.includes(id)));
  assert.ok(HLJS_GRAMMAR_IDS.length > SUPPORTED_LANGUAGE_IDS.length);
  const paths = [
    '/vendor/hljs/core.min.js',
    ...HLJS_GRAMMAR_IDS.map((id) => `/vendor/hljs/languages/${id}.min.js`),
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
  const index = readIndexHtml();
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
