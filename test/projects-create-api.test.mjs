// test/projects-create-api.test.mjs — New by name, the folder probe and Use git over HTTP; the default projects root.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, readdir, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { _testing as gitTesting } from '../src/core/git-available.mjs';
import { displayPath } from '../src/core/projects.mjs';
import { createTicket, listTickets } from '../src/core/scheduler.mjs';
import { gitDir as makeGitDir } from './helpers/git-dir.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { checkRows } from './helpers/rows.mjs';

let homeDir, srv, base, root, rootDisplay, runs;
const made = [];                                                  // fixtures outside homeDir, removed in after()
const gitDir = (tag) => { const d = makeGitDir(tag); made.push(d); return d; };
const prev = {};
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const plainDir = async (t) => { const d = await mkdtemp(join(tmpdir(), `worca-cc-pcapi-${t}-`)); made.push(d); return d; };
const projectRow = async (dir) => (await (await fetch(`${base}/api/projects`)).json()).projects.find((p) => realpathSync(p.path) === realpathSync(dir));
const gitInit = (key, body = {}) => post(`/api/projects/${encodeURIComponent(key)}/git-init`, body);
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
  const mod = await import('../ui/server.mjs');
  runs = mod.runs;
  srv = http.createServer(mod.app);
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
    assert.equal((await gitInit('p0proj-00000001')).status, 409);
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

test('DELETE /api/projects: a New Folder project goes with its folder only on deleteFolder=1; other folders stay; a live or paused run refuses', async () => {
  const del = (name, flag) => fetch(`${base}/api/projects?name=${encodeURIComponent(name)}${flag ? '&deleteFolder=1' : ''}`, { method: 'DELETE' });
  const listed = async () => (await (await fetch(`${base}/api/projects`)).json()).projects;
  const make = async (name, extra = {}) => {
    const r = await post('/api/projects/create', { name, ...extra });
    assert.equal(r.status, 201, await r.clone().text());
    return (await r.json()).project;
  };
  await checkRows([
    { name: 'ownedFolder: a New Folder project yes; New + Use git and a folder added from elsewhere no', run: async () => {
      assert.equal((await make('rm-own')).ownedFolder, true, 'the create answer carries it too');
      await make('rm-git', { useGit: true });
      const outside = await plainDir('rm-outside');
      assert.equal((await post('/api/projects', { name: 'rm-outside', path: outside })).status, 200);
      const by = Object.fromEntries((await listed()).map((p) => [p.name, p.ownedFolder]));
      assert.deepEqual([by['rm-own'], by['rm-git'], by['rm-outside']], [true, false, false]);
    } },
    { name: 'nestedRepo (#693): a repository an older worca git-inited inside the user\'s repository; every other row has none', run: async () => {
      const outer = gitDir('pcapi-outer693');
      const svc = join(outer, 'svc'); mkdirSync(svc);
      // A 1.10.0 row (registration refuses it now), then what its first run left behind.
      getDb().prepare("INSERT INTO projects (key, name, path, created_at, vcs) VALUES ('svc-0000aaaa', 'svc693', ?, ?, 'git')").run(svc, new Date().toISOString());
      for (const a of [['init', '-q'], ['config', 'user.email', 'orchestrator@local']]) spawnSync('git', a, { cwd: svc });
      try {
        const list = await listed();
        const row = list.find((p) => p.name === 'svc693');
        assert.equal(row.nestedRepo.repoRoot, realpathSync(outer));
        assert.match(row.nestedRepo.hint, /An older Worca created it\./);
        assert.deepEqual(list.filter((p) => 'nestedRepo' in p).map((p) => p.name), ['svc693']);
      } finally { getDb().prepare("DELETE FROM projects WHERE key = 'svc-0000aaaa'").run(); }
    } },
    { name: 'eligible without deleteFolder=1: 409 DELETE_FOLDER_REQUIRED naming the folder; nothing removed', run: async () => {
      const r = await del('rm-own');
      assert.equal(r.status, 409);
      const j = await r.json();
      assert.equal(j.code, 'DELETE_FOLDER_REQUIRED');
      assert.equal(j.displayPath, displayPath(join(root, 'rm-own')));
      assert.ok(j.error.includes(`also deletes its folder ${displayPath(join(root, 'rm-own'))} and every file in it`), j.error);
      assert.ok((await listed()).some((p) => p.name === 'rm-own'), 'still registered');
      assert.equal(existsSync(join(root, 'rm-own')), true);
    } },
    { name: 'eligible with deleteFolder=1 (any letter case): 200, the folder is gone, New with the same name works again', run: async () => {
      await writeFile(join(root, 'rm-own', 'notes.txt'), 'x');
      const r = await del('RM-OWN', true);
      assert.equal(r.status, 200, await r.clone().text());
      const j = await r.json();
      assert.deepEqual(j.folder, { path: join(root, 'rm-own'), deleted: true, displayPath: displayPath(join(root, 'rm-own')) });
      assert.equal(j.warning, undefined);
      assert.equal(existsSync(join(root, 'rm-own')), false);
      assert.equal(j.projects.some((p) => p.name === 'rm-own'), false);
      assert.equal((await post('/api/projects/create', { name: 'rm-own' })).status, 201, 'diskClash no longer blocks the name');
    } },
    { name: 'deleteFolder=1 on a project worca does not own removes it and keeps the folder, with a notice', run: async () => {
      for (const name of ['rm-git', 'rm-outside']) {
        const p = (await listed()).find((x) => x.name === name);
        const r = await del(name, true);
        assert.equal(r.status, 200, name);
        const j = await r.json();
        assert.equal(j.folder, undefined, name);
        assert.match(j.notice, /folder was kept/, name);
        assert.equal(existsSync(p.path), true, name);
        assert.equal(j.projects.some((x) => x.name === name), false, name);
      }
    } },
    { name: '409 PROJECT_BUSY while a run of it runs, a workspace run holds it, or a saved run is paused', run: async () => {
      const p = await make('rm-busy');
      const refused = async (label) => {
        const r = await del('rm-busy', true);
        assert.equal(r.status, 409, label);
        const j = await r.json();
        assert.equal(j.code, 'PROJECT_BUSY', label);
        assert.match(j.error, /Stop it first/, label);
        assert.equal(existsSync(p.path), true, label);
        assert.ok((await listed()).some((x) => x.name === 'rm-busy'), label);
      };
      runs.set('rm-live', { id: 'rm-live', kind: 'run', projectDir: p.path, status: 'running', events: [] });
      try { await refused('a running run of the project'); } finally { runs.delete('rm-live'); }
      runs.set('rm-ws', { id: 'rm-ws', kind: 'workspace-run', workspaceId: 'ws-rm', projectDir: join(root, 'elsewhere'),
        status: 'pausing', events: [], orch: { members: [{ projectDir: p.path }] } });
      try { await refused('a workspace run with it as a member'); } finally { runs.delete('rm-ws'); }
      seedPipelineRow({ id: 'rmbusy01', projectKey: p.key, target: 'project', status: 'paused', startedAt: new Date().toISOString() });
      await refused('a paused run saved in the DB (it outlives a restart)');
      getDb().prepare("UPDATE pipelines SET status = 'stopped' WHERE id = ?").run('rmbusy01');
      runs.set('rm-fin', { id: 'rm-fin', kind: 'run', projectDir: p.path, pipelineId: 'rmfin001', status: 'done', settled: false, events: [] });
      try { await refused('a run that is done but still tearing down'); } finally { runs.delete('rm-fin'); }
      for (const [id, member] of [['rmws0001', { projectKey: p.key }], ['rmws0002', { projectDir: p.path }]]) {
        seedPipelineRow({ id, projectKey: 'ws-rm-00000001', target: 'workspace', status: 'paused', startedAt: new Date().toISOString(),
          workspaceMeta: { projects: [member] } });
        await refused(`a paused workspace run saved with it as a member (by ${Object.keys(member)[0]})`);
        getDb().prepare("UPDATE pipelines SET status = 'stopped' WHERE id = ?").run(id);
      }
      const r = await del('rm-busy', true);
      assert.equal(r.status, 200, 'stopped: the removal goes through');
      assert.equal(existsSync(p.path), false);
    } },
    { name: 'a settled paused entry holds only while its saved row is parked: an archived or interrupted run (Stop refuses both) no longer blocks', run: async () => {
      const settles = [
        ['rm-arch', 'rmarch01', (id) => getDb().prepare('UPDATE pipelines SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), id)],
        ['rm-intr', 'rmintr01', (id) => getDb().prepare("UPDATE pipelines SET status = 'interrupted' WHERE id = ?").run(id)],
      ];
      for (const [name, id, settle] of settles) {
        const p = await make(name);
        seedPipelineRow({ id, projectKey: p.key, target: 'project', status: 'paused', startedAt: new Date().toISOString() });
        runs.set(name, { id: name, kind: 'run', projectDir: p.path, pipelineId: id, status: 'paused', settled: true, events: [] });
        try {
          const held = await del(name, true);
          assert.equal(held.status, 409, `${name}: still parked, so Stop works and the run holds`);
          assert.equal((await held.json()).code, 'PROJECT_BUSY', name);
          settle(id);
          const r = await del(name, true);
          assert.equal(r.status, 200, `${name}: ${await r.clone().text()}`);
          assert.equal(existsSync(p.path), false, name);
        } finally { runs.delete(name); }
      }
    } },
    { name: 'a removal by another letter case still cancels the project\'s scheduled runs', run: async () => {
      const p = await make('rm-sched');
      createTicket({ projectDir: p.path, title: 'later', runAtMs: Date.now() + 3_600_000,
        request: { projectDir: p.path, prompt: 'x', workflowId: 'wf_default' } });
      assert.equal(listTickets({ projectDir: p.path }).length, 1);
      assert.equal((await del('RM-SCHED', true)).status, 200);
      assert.equal(listTickets({ projectDir: p.path }).length, 0);
    } },
  ]);
});

test('POST /api/projects/:key/git-init: Folder → Git, link, refusals, and Remove keeps the folder after', async () => {
  await checkRows([
    { name: 'converts and links in one call; the answer carries the new list', run: async () => {
      const dir = await plainDir('gi-ok');
      assert.equal((await post('/api/projects', { name: 'gi-ok', path: dir })).status, 200);
      const p = await projectRow(dir);
      assert.equal(p.vcs, 'none');
      const r = await gitInit(p.key, { remoteUrl: 'https://github.com/me/gi-ok' });
      assert.equal(r.status, 200);
      const out = await r.json();
      assert.deepEqual(out.project, { key: p.key, name: 'gi-ok', path: p.path, vcs: 'git' });
      assert.equal(out.initialized, true);
      assert.equal(out.remote, 'https://github.com/me/gi-ok');
      const row = out.projects.find((x) => x.key === p.key);
      assert.equal(row.vcs, 'git'); assert.equal(row.workMode, 'git'); assert.equal(row.ownedFolder, false);
      assert.equal(spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8' }).stdout.trim(), 'https://github.com/me/gi-ok');
    } },
    { name: 'link remote on a Git project with no origin; a second link is 400 EXISTS', run: async () => {
      const dir = await plainDir('gi-link');
      await post('/api/projects', { name: 'gi-link', path: dir });
      const p = await projectRow(dir);
      assert.equal((await gitInit(p.key)).status, 200);
      const r = await gitInit(p.key, { remoteUrl: 'git@github.com:me/gi-link.git' });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).initialized, false);
      const again = await gitInit(p.key, { remoteUrl: 'git@github.com:me/other.git' });
      assert.equal(again.status, 400);
      assert.deepEqual(await again.json(), { error: 'this project already has an origin remote', code: 'EXISTS' });
    } },
    { name: '400 INVALID for a URL with credentials: no .git, still a Folder project', run: async () => {
      const dir = await plainDir('gi-bad');
      await post('/api/projects', { name: 'gi-bad', path: dir });
      const p = await projectRow(dir);
      const r = await gitInit(p.key, { remoteUrl: 'https://me:tok@github.com/me/x' });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).code, 'INVALID');
      assert.equal(existsSync(join(dir, '.git')), false);
      assert.equal((await projectRow(dir)).vcs, 'none');
    } },
    { name: '404 for an unknown key', run: async () => {
      const r = await gitInit('nope-00000000');
      assert.equal(r.status, 404);
      assert.deepEqual(await r.json(), { error: 'project not found', code: 'NOT_FOUND' });
    } },
    { name: '409 PROJECT_BUSY while a run of the project is live', run: async () => {
      const dir = await plainDir('gi-busy');
      await post('/api/projects', { name: 'gi-busy', path: dir });
      const p = await projectRow(dir);
      seedPipelineRow({ id: 'gibusy01', projectKey: p.key, target: 'project', status: 'paused', startedAt: new Date().toISOString() });
      try {
        const r = await gitInit(p.key);
        assert.equal(r.status, 409);
        const body = await r.json();
        assert.equal(body.code, 'PROJECT_BUSY'); assert.equal(body.pipelineId, 'gibusy01');
        assert.match(body.error, /^“gi-busy” has a run that is paused\. Stop it first, then use git here\.$/);
        assert.equal(existsSync(join(dir, '.git')), false);
      } finally { getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = ?").run('gibusy01'); }
    } },
    { name: 'a converted worca-made folder: Remove keeps the folder, even when deleteFolder=1 is sent', run: async () => {
      const made = await (await post('/api/projects/create', { name: 'gi-own' })).json();
      assert.equal(made.project.vcs, 'none');
      assert.equal((await projectRow(made.project.path)).ownedFolder, true);
      assert.equal((await gitInit(made.project.key)).status, 200);
      assert.equal((await projectRow(made.project.path)).ownedFolder, false);
      // An old tab could still send the flag: the server decides, and a non-owned folder is never deleted.
      const del = await fetch(`${base}/api/projects?name=gi-own&deleteFolder=1`, { method: 'DELETE' });
      assert.equal(del.status, 200);
      const body = await del.json();
      assert.equal(body.folder, undefined, 'no folder removal was attempted');
      assert.match(body.notice, /^Removed "gi-own"\. Its folder was kept: /);
      assert.equal(existsSync(join(made.project.path, '.git')), true, 'the folder (now with git history) stays');
    } },
  ]);
});
