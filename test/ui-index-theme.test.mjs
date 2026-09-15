// test/ui-index-theme.test.mjs — first paint in the stored theme (spec §5.2):
// the server rewrites the one anchor in index.html into <html data-theme="…">
// on every shell request, with no-store so a theme change is never served stale.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIndexHtml, INDEX_THEME_ANCHOR } from '../src/core/index-html.mjs';

const indexPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));

test('index.html carries the anchor exactly once, plus the color-scheme meta', () => {
  const html = readFileSync(indexPath, 'utf8');
  assert.equal(html.split(INDEX_THEME_ANCHOR).length - 1, 1, 'exactly one anchor');
  assert.equal(INDEX_THEME_ANCHOR, '<html lang="en" data-theme="system">');
  assert.match(html, /<meta name="color-scheme" content="light dark" \/>/);
  assert.match(html, /<meta name="theme-color" content="#ffffff" \/>/, 'the light default stays; JS keeps it current');
});

test('renderIndexHtml replaces the anchor and nothing else; throws without it', () => {
  const html = '<!DOCTYPE html>\n<html lang="en" data-theme="system">\n<head></head><body>x</body></html>';
  assert.equal(renderIndexHtml(html, 'dark'), '<!DOCTYPE html>\n<html lang="en" data-theme="dark">\n<head></head><body>x</body></html>');
  assert.equal(renderIndexHtml(html, 'system'), html);
  assert.throws(() => renderIndexHtml('<html lang="en">', 'dark'), /index\.html theme anchor missing/);
});

let home, srv, base, prev;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-indextheme-'));
  prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME };
  process.env.HOME = home; process.env.USERPROFILE = home; delete process.env.WORCA_HOME;
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
});
const postJson = (body) => fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('GET /, /index, /index.html (any case) and an SPA path serve the shell in the stored theme, no-store', async () => {
  for (const p of ['/', '/index', '/index.html', '/Index.html', '/history/some-key/pl_0000']) {
    const r = await fetch(`${base}${p}`);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), /^text\/html; charset=utf-8/i, p);
    assert.equal(r.headers.get('cache-control'), 'no-store', p);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
    assert.match(await r.text(), /<html lang="en" data-theme="system">/, p);
  }
  try {
    assert.equal((await postJson({ theme: 'dark' })).status, 200);
    for (const p of ['/', '/index.html', '/composer']) {
      const html = await (await fetch(`${base}${p}`)).text();
      assert.match(html, /<html lang="en" data-theme="dark">/, p);
      assert.equal(html.split('data-theme=').length - 1, 1, 'one attribute');
    }
  } finally { await postJson({ theme: 'system' }); }
});

test('the API and vendor paths are not the shell', async () => {
  const api = await fetch(`${base}/api/settings`);
  assert.match(api.headers.get('content-type'), /application\/json/);
  const vendor = await fetch(`${base}/vendor/hljs/nope.js`);
  assert.notEqual(vendor.headers.get('content-type') || '', 'text/html; charset=utf-8');
});
