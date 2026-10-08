// test/pr-watch-api.test.mjs — Watch PR routes (#619): GET/POST /api/pr/watch, the optional
// `watch` flag on POST /api/pr, and the server's watcher wiring (origin, branch-busy check).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, _testing as server } from '../ui/server.mjs';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import { _testing as gitSync } from '../src/core/git-sync.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { writeStoreMeta, persistPrState, persistMemberPrState } from '../src/core/artifacts.mjs';
import { getWatch, updateWatch } from '../src/core/pr-watch.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';

const GH = 'https://github.com/me/repo/pull/7';
const WK = 'wks-team-w-00000001';
const KEY = `workspaces/${WK}`;
let srv, base, home, prevHome, repo, seeded, wsId, apiDir, webDir;

async function seedRun(title, extra = {}) {
  const s = await seedPipeline(repo, { title, status: 'done', startedAt: '2026-06-01T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/watch-me', branchKept: true },
    stepper: { version: 2, template: { id: 'wf_default', name: 'Default' } }, ...extra });
  writeStoreMeta(s.key, 'project', { key: s.key, name: 'Repo', path: repo });
  return s;
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-prwatch-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  repo = await mkdtemp(join(tmpdir(), 'worca-cc-prwatch-repo-'));
  seeded = await seedRun('Watch me');
  apiDir = await mkdtemp(join(tmpdir(), 'worca-cc-prwatch-api-'));
  webDir = await mkdtemp(join(tmpdir(), 'worca-cc-prwatch-web-'));
  const members = [
    { projectKey: 'api-00000001', projectDir: apiDir, projectName: 'api' },
    { projectKey: 'web-00000002', projectDir: webDir, projectName: 'web' },
  ];
  const branches = {
    'api-00000001': { source: 'main', feature: 'worca-cc/feat-api', branchKept: true },
    'web-00000002': { source: 'dev', feature: 'worca-cc/feat-web', branchKept: true },
  };
  ({ id: wsId } = await seedWorkspacePipeline(apiDir, WK, { title: 'Cross repo', status: 'done', workspaceName: 'Team W',
    projects: members, projectKeys: members.map((m) => m.projectKey), branches, branch: { ...branches['api-00000001'] },
    stepper: { version: 2, template: { id: 'wf_default' } } }, members));
  persistMemberPrState(wsId, 'api-00000001', { url: 'https://github.com/o/api/pull/1', number: 1, state: 'OPEN' });
  persistMemberPrState(wsId, 'web-00000002', { url: 'https://github.com/o/web/pull/2', number: 2, state: 'MERGED' });
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  gitInfo.reset(); gitSync.reset();
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

beforeEach(() => {
  gitInfo.reset(); gitSync.reset();
  getDb().exec('DELETE FROM pr_watch_runs; DELETE FROM pr_watches');
  persistPrState(seeded.id, { url: GH, number: 7, state: 'OPEN' });
});

const get = (q) => fetch(`${base}/api/pr/watch?${new URLSearchParams(q)}`);
const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const scope = () => ({ id: seeded.id, projectKey: seeded.key });

test('GET answers the defined shape for an unwatched open PR', async () => {
  const r = await get(scope());
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { watching: false, status: null, reason: null, activePipelineId: null });
});

test('POST validates watch, turns it on and off, and the stored watch keeps its history', async () => {
  let r = await post('/api/pr/watch', { ...scope(), watch: 'yes' });
  assert.equal(r.status, 400); await r.json();
  r = await post('/api/pr/watch', { ...scope(), watch: true });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { watching: true, status: 'watching', reason: null, activePipelineId: null });
  assert.equal(getWatch(GH).pipelineId, seeded.id);
  updateWatch(GH, { status: 'fixing', activeRunId: 'r1', activePipelineId: 'fixp' });
  r = await post('/api/pr/watch', { ...scope(), watch: false });
  // Active work drains: only `enabled` flips.
  assert.deepEqual(await r.json(), { watching: false, status: 'fixing', reason: null, activePipelineId: 'fixp' });
  r = await get(scope());
  assert.deepEqual(await r.json(), { watching: false, status: 'fixing', reason: null, activePipelineId: 'fixp' });
});

test('a non-github or closed PR, a scope mismatch and an archived origin are refused', async () => {
  persistPrState(seeded.id, { url: 'https://dev.azure.com/a/b/_git/c/pullrequest/3', number: 3, state: 'OPEN' });
  let r = await get(scope());
  assert.equal(r.status, 400); await r.json();
  persistPrState(seeded.id, { url: 'https://ghe.corp/me/repo/pull/7', number: 7, state: 'OPEN' });
  r = await get(scope());
  assert.equal(r.status, 400); await r.json();
  persistPrState(seeded.id, { url: GH, number: 7, state: 'MERGED' });
  r = await post('/api/pr/watch', { ...scope(), watch: true });
  assert.equal(r.status, 400); await r.json();
  persistPrState(seeded.id, { url: GH, number: 7, state: 'OPEN' });
  r = await get({ id: seeded.id, projectKey: 'other-00000009' });
  assert.equal(r.status, 404); await r.json();
  const archived = await seedRun('Archived');
  persistPrState(archived.id, { url: 'https://github.com/me/repo/pull/8', number: 8, state: 'OPEN' });
  getDb().prepare("UPDATE pipelines SET archived_at='2026-06-02T00:00:00Z' WHERE id=?").run(archived.id);
  r = await get({ id: archived.id, projectKey: archived.key });
  assert.equal(r.status, 404); await r.json();
});

test('workspace: memberKey is required and each member PR is watched on its own', async () => {
  let r = await get({ id: wsId, projectKey: KEY });
  assert.equal(r.status, 400); await r.json();
  r = await post('/api/pr/watch', { id: wsId, projectKey: KEY, memberKey: 'api-00000001', watch: true });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).watching, true);
  assert.equal(getWatch('https://github.com/o/api/pull/1').memberKey, 'api-00000001');
  r = await get({ id: wsId, projectKey: KEY, memberKey: 'web-00000002' });   // merged member
  assert.equal(r.status, 400); await r.json();
});

test('a fix row carrying the same PR URL addresses the existing watch', async () => {
  await (await post('/api/pr/watch', { ...scope(), watch: true })).json();
  const fix = await seedRun('Fix PR #7 feedback');
  persistPrState(fix.id, { url: GH, number: 7, state: 'OPEN' });
  const r = await get({ id: fix.id, projectKey: fix.key });
  assert.equal((await r.json()).watching, true);
});

test('POST /api/pr rejects a non-boolean watch before doing any work', async () => {
  const seen = [];
  gitInfo.setRunner(async (cmd, args) => { seen.push([cmd, ...args]); return { ok: true, stdout: '', stderr: '', code: 0 }; });
  const r = await post('/api/pr', { ...scope(), watch: 'on' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /watch must be a boolean/);
  assert.equal(seen.filter((c) => c[1] === 'push').length, 0);
});

test('the watcher origin is the run\'s member project, branch and frozen workflow; archived means gone', async () => {
  const o = server.prWatchOrigin({ pipelineId: seeded.id, memberKey: '' });
  assert.equal(o.projectDir, repo);
  assert.equal(o.branch, 'worca-cc/watch-me');
  assert.equal(o.sourceBranch, 'main');
  assert.equal(o.stepper.template.id, 'wf_default');
  const w = server.prWatchOrigin({ pipelineId: wsId, memberKey: 'web-00000002' });
  assert.deepEqual([w.projectDir, w.branch, w.sourceBranch], [webDir, 'worca-cc/feat-web', 'dev']);
  // A workspace origin is flagged: its manifest was resolved for the workspace, not for one project.
  assert.deepEqual([o.workspace, w.workspace], [false, true]);
  const gone = await seedRun('Gone');
  getDb().prepare("UPDATE pipelines SET archived_at='2026-06-02T00:00:00Z' WHERE id=?").run(gone.id);
  assert.equal(server.prWatchOrigin({ pipelineId: gone.id, memberKey: '' }), null);
});

test('a paused run on the exact project and branch makes the branch busy; another branch does not', async () => {
  assert.equal(server.liveRunOnBranch({ projectDir: repo, branch: 'worca-cc/watch-me' }), false);
  const paused = await seedRun('Paused', { status: 'paused' });
  assert.equal(server.liveRunOnBranch({ projectDir: repo, branch: 'worca-cc/watch-me' }), true);
  assert.equal(server.liveRunOnBranch({ projectDir: repo, branch: 'worca-cc/other' }), false);
  assert.equal(server.liveRunOnBranch({ projectDir: apiDir, branch: 'worca-cc/watch-me' }), false);
  getDb().prepare("UPDATE pipelines SET status='done' WHERE id=?").run(paused.id);
});

test('the background loop is not started by importing the server; kicks are no-ops then', async () => {
  const seen = [];
  gitInfo.setRunner(async (cmd, args) => { seen.push([cmd, ...args]); return { ok: false, stdout: '', stderr: '', code: 1 }; });
  await (await post('/api/pr/watch', { ...scope(), watch: true })).json();
  await server.prWatcher.runner.kick();
  assert.deepEqual(seen, []);
});

test('shutdown awaits an in-flight watcher stop step', async () => {
  let release; let done = false;
  const slow = () => new Promise((r) => { release = () => { done = true; r(); }; });
  const p = server.settleShutdownSteps({ prWatch: slow }, { timeoutMs: 2000, log: () => {} });
  setTimeout(() => release(), 20);
  assert.deepEqual(await p, []);
  assert.equal(done, true);
});

test('POST /api/pr: watch:true watches the new github.com PR; omitting watch keeps the response shape', async () => {
  gitSync.setRunner((args) => Promise.resolve(args[0] === 'remote' && args[1] === 'get-url'
    ? { ok: true, stdout: 'https://github.com/me/repo.git\n', stderr: '', code: 0 }
    : args[0] === 'rev-parse' ? { ok: false, stdout: '', stderr: '', code: 1 } : { ok: true, stdout: '0\n', stderr: '', code: 0 }));
  let n = 20;
  gitInfo.setRunner(async (cmd, args) => {
    const ok = (stdout = '') => ({ ok: true, stdout, stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === '--version') return ok('gh 2.x');
    if (cmd === 'git' && args[0] === 'remote') return ok('origin\thttps://github.com/me/repo.git (fetch)\norigin\thttps://github.com/me/repo.git (push)\n');
    if (cmd === 'git' && args[0] === 'for-each-ref') return ok('refs/remotes/origin/main\n');
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') return ok(`https://github.com/me/repo/pull/${n++}\n`);
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return ok('MERGEABLE\n');
    return ok();
  });
  const a = await seedRun('Ship watched');
  let r = await post('/api/pr', { id: a.id, projectKey: a.key, watch: true });
  let body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.watching, true);
  assert.equal(getWatch(body.url).pipelineId, a.id);
  const b = await seedRun('Ship plain');
  r = await post('/api/pr', { id: b.id, projectKey: b.key });
  body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(Object.hasOwn(body, 'watching'), false);
  assert.equal(getWatch(body.url), null);
});
