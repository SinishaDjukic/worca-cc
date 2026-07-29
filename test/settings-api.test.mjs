// test/settings-api.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let home, srv, base, prev;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-setapi-'));
  prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME };
  process.env.HOME = home; process.env.USERPROFILE = home; delete process.env.WORCA_HOME;
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME']) {
    if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
  }
  await rm(home, { recursive: true, force: true });
});

const post = (root) => fetch(`${base}/api/settings`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root }),
});

test('GET /api/settings returns root + default', async () => {
  const r = await fetch(`${base}/api/settings`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.root, '');        // nothing set yet
  assert.equal(j.default, home);   // default = sandboxed home
});

test('POST sets the root; GET reflects it; empty resets it', async () => {
  const target = await mkdtemp(join(tmpdir(), 'worca-cc-setapi-tgt-'));
  assert.equal((await (await post(target)).json()).root, target);
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).root, target);
  assert.equal((await (await post('')).json()).root, '');
  await rm(target, { recursive: true, force: true });
});

test('POST rejects a file path -> 400', async () => {
  const filePath = fileURLToPath(import.meta.url); // this test file: a file, not a dir
  assert.equal((await post(filePath)).status, 400);
});
