// test/api-clone-project.test.mjs — POST /api/projects/clone (a job: 202, then clone-changed) and
// `worca add --clone`. Offline: refusals answer at once, and a clone of an unresolvable
// .invalid host fails fast and leaves nothing behind. The successful path is unit-tested
// in clone-project.test.mjs and verified against GitHub on a deployment.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const CLI = resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'cli', 'worca-cc.mjs');

let homeDir, rootDir, prevHome, prevRoot, srv, base;
const post = (b) => fetch(`${base}/api/projects/clone`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-clone-home-'));
  rootDir = await mkdtemp(join(tmpdir(), 'worca-cc-clone-root-'));
  prevHome = process.env.WORCA_HOME;
  prevRoot = process.env.WORCA_PROJECTS_ROOT;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_PROJECTS_ROOT = rootDir;
  const mod = await import('../ui/server.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  if (prevRoot === undefined) delete process.env.WORCA_PROJECTS_ROOT; else process.env.WORCA_PROJECTS_ROOT = prevRoot;
  await rm(homeDir, { recursive: true, force: true });
  await rm(rootDir, { recursive: true, force: true });
});

test('refusals known up front answer at once with a status and a code', async () => {
  let r = await post({ url: 'git@github.com:acme/api.git' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'invalid');
  r = await post({ url: 'https://user:tok@github.com/acme/api' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /contains credentials/);
  await mkdir(join(rootDir, 'taken'));
  r = await post({ url: 'https://github.com/acme/taken' });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'exists');
  process.env.WORCA_CLONE_ALLOW = 'github.com/acme/*';
  try {
    r = await post({ url: 'https://github.com/other/x' });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'not-allowed');
  } finally { delete process.env.WORCA_CLONE_ALLOW; }
});

test('a clone runs as a job: 202, then GET shows it end, and a failure leaves no folder', async () => {
  const r = await post({ url: 'https://git.worca-test.invalid/acme/nothing', name: 'nothing' });
  assert.equal(r.status, 202, await r.clone().text());
  const { jobId, job } = await r.json();
  assert.match(jobId, /^cln_[0-9a-f]{8}$/);
  assert.equal(job.state, 'running');
  assert.equal(job.dir, join(rootDir, 'nothing'));
  let j;
  for (let i = 0; i < 200; i++) {
    j = (await (await fetch(`${base}/api/projects/clone/${jobId}`)).json()).job;
    if (j.state !== 'running') break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.equal(j.state, 'error');
  assert.equal(j.code, 'failed');
  assert.equal(existsSync(join(rootDir, 'nothing')), false);
  assert.equal((await fetch(`${base}/api/projects/clone/cln_00000000`)).status, 404);
});

test('worca add --clone: the same path from the CLI, with flag checks', () => {
  const run = (args) => spawnSync(process.execPath, [CLI, 'add', ...args], { env: { ...process.env }, encoding: 'utf8' });
  let r = run(['--clone', 'http://github.com/acme/api']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /only https:\/\/ repository URLs are supported \(invalid\)/);
  r = run(['--branch', 'main']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /--branch and --name go with --clone/);
  r = run(['--clone', 'https://github.com/acme/api', '--path', '/tmp/x']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /cannot be combined/);
  r = run(['--clone', 'https://git.worca-test.invalid/acme/cli', '--name', 'cli-one']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Cloning https:\/\/git\.worca-test\.invalid\/acme\/cli/);
  assert.match(r.stderr, /\(failed\)/);
  assert.equal(existsSync(join(rootDir, 'cli-one')), false);
});
