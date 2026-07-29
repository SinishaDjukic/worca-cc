// test/fs-api.test.mjs
// API tests for the folder-selector endpoints: GET /api/fs/dirs (in-app
// browser data) and POST /api/fs/pick-folder (native dialog, runner injected).
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { _testing as dialogTesting } from '../src/core/folder-dialog.mjs';

let homeDir, fixture, srv, base, prevHome;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-fsapi-'));
  fixture = join(homeDir, 'fixture');
  await mkdir(join(fixture, 'sub-a'), { recursive: true });
  await mkdir(join(fixture, 'sub-b'));
  await mkdir(join(fixture, '.git'));
  await writeFile(join(fixture, 'readme.md'), 'x');
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
});

afterEach(() => dialogTesting.reset());

test('GET /api/fs/dirs lists only visible subdirectories', async () => {
  const r = await fetch(`${base}/api/fs/dirs?path=${encodeURIComponent(fixture)}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.path, fixture);
  assert.deepEqual(j.dirs.map((d) => d.name), ['sub-a', 'sub-b']);
  assert.equal(j.parent, homeDir);
});

test('GET /api/fs/dirs rejects a missing path with 400 + error envelope', async () => {
  const r = await fetch(`${base}/api/fs/dirs?path=${encodeURIComponent(join(fixture, 'nope'))}`);
  assert.equal(r.status, 400);
  assert.ok((await r.json()).error);
});

test('POST /api/fs/pick-folder returns the picked path (runner injected)', async () => {
  dialogTesting.set({
    platform: 'darwin', env: {},
    runner: async () => ({ ok: true, stdout: `${fixture}\n`, stderr: '', code: 0, timedOut: false }),
  });
  const r = await fetch(`${base}/api/fs/pick-folder`, { method: 'POST' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: 'picked', path: fixture });
});

test('POST /api/fs/pick-folder degrades to unsupported on a headless platform', async () => {
  dialogTesting.set({ platform: 'linux', env: {} }); // no DISPLAY
  const r = await fetch(`${base}/api/fs/pick-folder`, { method: 'POST' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: 'unsupported' });
});
