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
import { checkRows } from './helpers/rows.mjs';

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

test('GET /api/fs/dirs in local mode lists any folder, unlimited (the hosted limit does not apply)', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'worca-cc-fsapi-out-'));
  try {
    await mkdir(join(outside, 'elsewhere'));
    const r = await fetch(`${base}/api/fs/dirs?path=${encodeURIComponent(outside)}`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.deepEqual(j.dirs.map((d) => d.name), ['elsewhere']);
    assert.equal(j.limited, undefined);
    assert.equal(j.roots, undefined);
  } finally { await rm(outside, { recursive: true, force: true }); }
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

test('POST /api/fs/pick-folder: multiple:true returns every path; a non-boolean multiple is single', async () => {
  // afterEach resets only between tests: each row starts from a reset, as its own test did.
  await checkRows([
    { name: 'POST /api/fs/pick-folder {multiple:true} returns every picked path', run: async () => {
      const a = join(fixture, 'sub-a');
      const b = join(fixture, 'sub-b');
      let args = null;
      dialogTesting.set({
        platform: 'darwin', env: {},
        runner: async (_cmd, a2) => { args = a2; return { ok: true, stdout: `${a}\n${b}\n`, stderr: '', code: 0, timedOut: false }; },
      });
      const r = await fetch(`${base}/api/fs/pick-folder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'project', multiple: true }),
      });
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { status: 'picked', path: a, paths: [a, b] });
      assert.match(args.join('\n'), /multiple selections allowed/);
    } },
    { name: 'POST /api/fs/pick-folder treats a non-boolean multiple as single', run: async () => {
      dialogTesting.reset();
      dialogTesting.set({
        platform: 'darwin', env: {},
        runner: async () => ({ ok: true, stdout: `${fixture}\n`, stderr: '', code: 0, timedOut: false }),
      });
      const r = await fetch(`${base}/api/fs/pick-folder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ multiple: 'yes' }),
      });
      assert.deepEqual(await r.json(), { status: 'picked', path: fixture });
    } },
  ]);
});

test('GET /api/fs/pick-folder says whether a native dialog can open here, and never opens one', async () => {
  let opened = 0;
  const runner = async () => { opened += 1; return { ok: true, stdout: `${fixture}\n`, stderr: '', code: 0, timedOut: false }; };
  const available = async () => {
    const r = await fetch(`${base}/api/fs/pick-folder`);
    assert.equal(r.status, 200);
    return r.json();
  };
  await checkRows([
    { name: 'a desktop OS answers available', run: async () => {
      dialogTesting.set({ platform: 'darwin', env: {}, runner });
      assert.deepEqual(await available(), { available: true });
    } },
    { name: 'Linux without a display answers unavailable', run: async () => {
      dialogTesting.set({ platform: 'linux', env: {}, runner });
      assert.deepEqual(await available(), { available: false });
    } },
    { name: 'WORCA_NO_NATIVE_DIALOG=1 answers unavailable', run: async () => {
      dialogTesting.set({ platform: 'darwin', env: { WORCA_NO_NATIVE_DIALOG: '1' }, runner });
      assert.deepEqual(await available(), { available: false });
    } },
  ]);
  assert.equal(opened, 0, 'asking never opens the dialog');
});

test('POST /api/fs/pick-folder {purpose:"repos", multiple:true}: on macOS one JXA panel; its folders and .code-workspace files come back', async () => {
  const calls = [];
  const ws = join(fixture, 'acme.code-workspace');
  dialogTesting.set({
    platform: 'darwin', env: {},
    runner: async (cmd, args) => { calls.push({ cmd, args }); return { ok: true, stdout: `${join(fixture, 'sub-a')}\n${ws}\n`, stderr: '', code: 0, timedOut: false }; },
  });
  const r = await fetch(`${base}/api/fs/pick-folder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purpose: 'repos', multiple: true }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: 'picked', path: join(fixture, 'sub-a'), paths: [join(fixture, 'sub-a'), ws] });
  assert.deepEqual(calls[0].args.slice(0, 2), ['-l', 'JavaScript']);
});
