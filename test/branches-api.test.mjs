// test/branches-api.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { app } from '../ui/server.mjs';
import { checkRows } from './helpers/rows.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

let srv, base;
const created = [];

before(async () => {
  srv = appServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});

function freshRepo() {
  const dir = templateRepo('api', { branch: 'main', user: true, files: { a: 'a' } });
  created.push(dir);
  spawnSync('git', ['branch', 'feature/x'], { cwd: dir });
  return dir;
}

test('GET /api/branches returns local branches + current', async () => {
  const repo = await freshRepo();
  const r = await fetch(`${base}/api/branches?projectDir=${encodeURIComponent(repo)}`);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.ok(Array.isArray(data.branches));
  assert.ok(data.branches.includes('main'));
  assert.ok(data.branches.includes('feature/x'));
  assert.equal(data.current, 'main');
});

test('GET /api/branches 400s without projectDir', async () => {
  const r = await fetch(`${base}/api/branches`);
  assert.equal(r.status, 400);
});

test('GET /api/branches on a non-git dir returns empty branches + null current', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-nogit-'));
  created.push(dir);
  const r = await fetch(`${base}/api/branches?projectDir=${encodeURIComponent(dir)}`);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.deepEqual(data.branches, []);
  assert.equal(data.current, null);
});

test('POST /api/run rejects an option-like or unknown sourceBranch with 400 (M1)', async () => {
  const repo = await freshRepo();
  await checkRows([
    { name: 'POST /api/run rejects an option-like sourceBranch with 400 (M1)', run: async () => {
      const r = await fetch(`${base}/api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', connection: 'close' },
        body: JSON.stringify({ projectDir: repo, prompt: 'x', mock: true, sourceBranch: '--force' }),
      });
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /sourceBranch/);
    } },
    { name: 'POST /api/run rejects an unknown sourceBranch with 400 (M1)', run: async () => {
      const r = await fetch(`${base}/api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', connection: 'close' },
        body: JSON.stringify({ projectDir: repo, prompt: 'x', mock: true, sourceBranch: 'no-such-branch' }),
      });
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /sourceBranch/);
    } },
  ]);
});
