// test/projects-create-api.test.mjs — New by name, the folder probe and Use git over HTTP; the default projects root.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { _testing as gitTesting } from '../src/core/git-available.mjs';
import { displayPath } from '../src/core/projects.mjs';
import { gitDir as makeGitDir } from './helpers/git-dir.mjs';
import { checkRows } from './helpers/rows.mjs';

let homeDir, srv, base, root, rootDisplay;
const made = [];                                                  // fixtures outside homeDir, removed in after()
const gitDir = (tag) => { const d = makeGitDir(tag); made.push(d); return d; };
const prev = {};
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const plainDir = async (t) => { const d = await mkdtemp(join(tmpdir(), `worca-cc-pcapi-${t}-`)); made.push(d); return d; };
async function noGit(fn) {
  process.env.WORCA_GIT = '0'; gitTesting.reset();
  try { return await fn(); } finally { process.env.WORCA_GIT = '1'; gitTesting.reset(); }
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-pcapi-'));
  for (const k of ['WORCA_HOME', 'WORCA_PROJECTS_ROOT', 'WORCA_GIT']) prev[k] = process.env[k];
  process.env.WORCA_HOME = homeDir;
  delete process.env.WORCA_PROJECTS_ROOT;                    // the default: <worcaHome>/projects
  process.env.WORCA_GIT = '1'; gitTesting.reset();
  root = join(homeDir, '.worca-cc', 'projects');
  rootDisplay = displayPath(root);
  _resetForTests();
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  gitTesting.reset();
  await rm(homeDir, { recursive: true, force: true, maxRetries: 3 });
  for (const d of made) await rm(d, { recursive: true, force: true, maxRetries: 3 });
});

test('POST /api/projects/create: Folder by name, Git with useGit, a dry run, and 400s that create nothing', async () => {
  await checkRows([
    { name: 'by name: 201, a folder under the default projects root, no .git, vcs none', run: async () => {
      assert.equal(existsSync(root), false, 'no projects root before the first New');
      const r = await post('/api/projects/create', { name: 'site' });
      assert.equal(r.status, 201, await r.clone().text());
      const j = await r.json();
      assert.equal(j.root, root);
      assert.equal(j.project.path, join(root, 'site'));
      assert.equal(j.project.vcs, 'none');
      assert.equal(existsSync(join(root, 'site', '.git')), false);
      const list = (await (await fetch(`${base}/api/projects`)).json()).projects;
      assert.ok(list.some((p) => p.name === 'site' && p.vcs === 'none'));
    } },
    { name: 'useGit: git init once, vcs git', run: async () => {
      const j = await (await post('/api/projects/create', { name: 'gitsite', useGit: true })).json();
      assert.equal(j.project.vcs, 'git');
      assert.equal(existsSync(join(root, 'gitsite', '.git', 'HEAD')), true);
    } },
    { name: 'dry run: 200 with the location, nothing created; a blank name still answers the root', run: async () => {
      const r = await post('/api/projects/create', { name: 'later', dryRun: true });
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { ok: true, root, rootDisplay, path: join(root, 'later'), name: 'later', displayPath: displayPath(join(root, 'later')) });
      assert.equal(existsSync(join(root, 'later')), false);
      const blank = await post('/api/projects/create', { name: '', dryRun: true });
      assert.equal(blank.status, 400);
      assert.deepEqual(await blank.json(), { error: 'a project name is required', code: 'INVALID', root, rootDisplay });
    } },
    { name: '400 for "../x", "a/b", "", a registered name and an existing folder; nothing is created', run: async () => {
      await mkdir(join(root, 'loose'));
      const before = (await readdir(root)).sort();
      for (const [name, code, error] of [
        ['../x', 'INVALID', 'the name must be one folder name, without / or \\'],
        ['a/b', 'INVALID', 'the name must be one folder name, without / or \\'],
        ['', 'INVALID', 'a project name is required'],
        ['site', 'EXISTS', 'a project named "site" already exists'],
        ['loose', 'EXISTS', `${join(root, 'loose')} already exists; pick another name`],
      ]) {
        const r = await post('/api/projects/create', { name });
        assert.equal(r.status, 400, name);
        assert.deepEqual(await r.json(), { error, code, root, rootDisplay }, name);
      }
      assert.deepEqual((await readdir(root)).sort(), before, 'nothing created');
    } },
  ]);
});

test('no git on this machine: useGit answers 409 GIT_MISSING and creates nothing; a plain New still works', async () => {
  await noGit(async () => {
    const r = await post('/api/projects/create', { name: 'nogit', useGit: true });
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), { error: 'git is not installed on this machine', code: 'GIT_MISSING', root, rootDisplay });
    assert.equal(existsSync(join(root, 'nogit')), false);
    assert.equal((await post('/api/projects/create', { name: 'nogit-plain' })).status, 201);
    const dir = await plainDir('nogit');
    const add = await post('/api/projects', { name: 'nogit-add', path: dir, useGit: true });
    assert.equal(add.status, 409);
    assert.equal((await add.json()).code, 'GIT_MISSING');
    assert.equal(existsSync(join(dir, '.git')), false);
  });
});

test('GET /api/projects/probe: kind and file count; 400 without a path', async () => {
  const dir = await plainDir('probe'); await writeFile(join(dir, 'a.txt'), 'x');
  const r = await fetch(`${base}/api/projects/probe?path=${encodeURIComponent(dir)}`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { path: dir, exists: true, isDir: true, vcs: 'none', files: 1, filesCapped: false, insideRepo: false, partOf: null });
  const repo = gitDir('pcapi-probe');
  assert.equal((await (await fetch(`${base}/api/projects/probe?path=${encodeURIComponent(repo)}`)).json()).vcs, 'git');
  const blank = await fetch(`${base}/api/projects/probe?path=`);
  assert.equal(blank.status, 400);
  assert.equal((await blank.json()).error, 'path is required');
});

test('POST /api/projects with useGit: git init once on a no-git folder, stored Git; without it, today; bulk computes the kind', async () => {
  const a = await plainDir('addgit'); await writeFile(join(a, 'keep.txt'), 'k');
  const r = await post('/api/projects', { name: 'addgit', path: a, useGit: true });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).projects.find((p) => p.name === 'addgit').vcs, 'git');
  assert.equal(existsSync(join(a, '.git', 'HEAD')), true);
  const b = await plainDir('addplain');
  assert.equal((await (await post('/api/projects', { name: 'addplain', path: b })).json()).projects.find((p) => p.name === 'addplain').vcs, 'none');
  assert.equal(existsSync(join(b, '.git')), false);
  const c = gitDir('pcapi-bulk'); const d = await plainDir('bulk');
  const bulk = await (await post('/api/projects/bulk', { projects: [{ name: 'bulk-git', path: c }, { name: 'bulk-plain', path: d }] })).json();
  assert.deepEqual(bulk.results.map((x) => x.status), ['added', 'added']);
  assert.equal(bulk.projects.find((p) => p.name === 'bulk-git').vcs, 'git');
  assert.equal(bulk.projects.find((p) => p.name === 'bulk-plain').vcs, 'none');
});
