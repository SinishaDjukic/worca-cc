// test/api-brand-icons.test.mjs — GET /vendor/brand-icons/:file (models-menu P1 Task 2): the icon pack's svgs one
// file at a time; anything else, a path outside icons/ above all, is the /vendor tail's plain no-store 404.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { useTempHome } from './helpers/temp-home.mjs';

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

test('a mark of the pack is an svg image, nosniff, sandboxed, cached for a day', async () => {
  for (const file of ['openai.svg', 'claudecode-color.svg', 'aws-color.svg']) {
    const res = await fetch(`${base}/vendor/brand-icons/${file}`);
    assert.equal(res.status, 200, file);
    assert.match(res.headers.get('content-type') || '', /^image\/svg\+xml/, file);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', file);
    // An svg opened top-level runs no script with the app's origin (the pack's svgs use inline style: no default-src).
    assert.equal(res.headers.get('content-security-policy'), 'sandbox', file);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=86400', file);
    assert.match(await res.text(), /<svg/, file);
  }
});

test('a missing mark, another type, upper case or a way out of icons/ is a plain no-store 404', async () => {
  const files = ['nope-nope.svg', '..%2Fpackage.json', 'openai.png', 'OPENAI.svg', '%2e%2e%2f%2e%2e%2fpackage.json',
    '-openai.svg', 'openai.svg.map', '.svg'];
  for (const file of files) {
    const res = await fetch(`${base}/vendor/brand-icons/${file}`);
    assert.equal(res.status, 404, file);
    assert.match(res.headers.get('cache-control') || '', /no-store/, file);
    assert.doesNotMatch(res.headers.get('content-type') || '', /text\/html/i, file);
    assert.doesNotMatch(await res.text(), /<svg|"name"/, file);
  }
});

test('a pack that cannot be resolved leaves no folder and warns once', () => {
  const warnings = [];
  const dir = testing.resolveBrandIconsDir(() => { throw new Error('unavailable'); }, (message) => warnings.push(message));
  assert.equal(dir, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /brand icons unavailable: unavailable/);
});
