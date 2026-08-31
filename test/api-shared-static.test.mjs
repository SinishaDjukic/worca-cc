// test/api-shared-static.test.mjs
// The /src/shared mount: every file of the shared graph core is served to the
// browser at exactly its repo-relative path, as a module, with nosniff — and a
// typo'd path 404s as text/plain instead of falling through to the SPA shell
// (which the browser reports as an opaque MIME error).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHARED = path.join(ROOT, 'src/shared');
// Only .mjs: a gitignored Finder .DS_Store (invisible to CI, common on macOS) is
// ignored by express.static's dotfile rule and would 404 this walk's first test.
const walk = (d, out = []) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, out) : /\.mjs$/.test(e.name) && out.push(p); } return out; };
const posix = (p) => p.split(path.sep).join('/');

let srv;
let base;

before(async () => {
  const mod = await import('../ui/server.mjs');
  srv = http.createServer(mod.app);
  await new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { srv.off('error', reject); resolve(); });
  });
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((resolve) => { srv.close(resolve); srv.closeAllConnections(); });
});

test('every shared file is served as a module at its repo-relative path', async () => {
  const files = walk(SHARED);
  assert.ok(files.length >= 2, 'the shared core is not empty');
  for (const f of files) {
    const url = `/src/shared/${posix(path.relative(SHARED, f))}`;
    const res = await fetch(`${base}${url}`);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type') || '', /javascript/i, url);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url);
    assert.equal(await res.text(), readFileSync(f, 'utf8'), `${url} body == file`);
  }
});

test('a missing shared path 404s as text/plain, never the SPA shell', async () => {
  for (const url of ['/src/shared/graph/nope.mjs', '/src/shared/graph/', '/src/shared/']) {
    const res = await fetch(`${base}${url}`);
    assert.equal(res.status, 404, url);
    assert.match(res.headers.get('content-type') || '', /text\/plain/, url);
    const body = await res.text();
    assert.equal(body, 'Not found', url);
    assert.doesNotMatch(body, /<!doctype html>/i, url);
  }
});

test('the mount cannot serve outside src/shared (raw, un-normalized paths)', async () => {
  // fetch() normalizes '..' away client-side, so ask the socket directly.
  const raw = (p) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
  for (const p of ['/src/shared/../core/db.mjs', '/src/shared/%2e%2e/core/db.mjs',
    '/src/shared/graph/../../core/db.mjs',
    '/src/shared/core/db.mjs' /* no dot-segments: what a WIDENED ROOT would serve */]) {
    const res = await raw(p);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(res.body, /node:sqlite/, `${p} must never serve a src/core module`);
  }
});

test('the SPA fallback still serves the app shell for a normal route', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
});
