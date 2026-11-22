// test/api-ask-vendor-assets.test.mjs
// Ask Worca §10.7: the two ESM vendor routes for the chat's markdown pipeline.
// marked has NO default export (use mod.marked); dompurify default-exports a
// factory. Both files are self-contained ESM, so the data:-URL import proves
// the served bytes are the real module. Misses fall into the existing /vendor
// no-store 404; nothing here may disturb the hljs routes or the SPA fallback.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let srv;
let base;

before(async () => {
  const mod = await import('../ui/server.mjs');
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

test('T-V1 the Office preview fallback\'s two UMD scripts are served (JS, nosniff) and, evaluated in that order, set JSZip and docx', async () => {
  const { JSDOM } = await import('jsdom');
  const { window: win } = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost:4317/' });
  for (const pathname of ['/vendor/jszip/jszip.min.js', '/vendor/docx-preview/docx-preview.min.js']) {
    const res = await fetch(`${base}${pathname}`);
    assert.equal(res.status, 200, pathname);
    assert.match(res.headers.get('content-type') || '', /^text\/javascript/i, pathname);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', pathname);
    win.eval(await res.text());     // UMD, never a data: ESM import (it has no exports)
  }
  assert.equal(typeof win.JSZip.loadAsync, 'function');
  assert.equal(typeof win.docx.renderAsync, 'function');
  assert.equal(typeof win.docx.parseAsync, 'function');
});

test('T-V2 no other jszip / docx-preview path is served: plain no-store 404s, never the SPA shell', async () => {
  for (const pathname of ['/vendor/docx-preview/docx-preview.mjs', '/vendor/jszip/jszip.js', '/vendor/jszip/../package.json',
    '/vendor/jszip/%2e%2e%2fpackage.json', '/vendor/docx-preview/docx-preview.min.js.map', '/vendor/jszip/']) {
    const res = await fetch(`${base}${pathname}`);
    assert.equal(res.status, 404, pathname);
    assert.doesNotMatch(res.headers.get('content-type') || '', /text\/html/i, pathname);
    assert.match(res.headers.get('cache-control') || '', /no-store/i, pathname);
    assert.doesNotMatch(await res.text(), /<!doctype html/i, pathname);
  }
});
