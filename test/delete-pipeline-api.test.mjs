// test/delete-pipeline-api.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, runs } from '../ui/server.mjs';
import { recordArtifact, writeStoreMeta } from '../src/core/artifacts.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';

let srv, base, home, prevHome;
const KEY = 'beta-00000002';

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-del-api-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home; // store.mjs appends '.worca-cc'
  _resetForTests();                                                     // DB singleton opens under this home
  const root = join(home, '.worca-cc', 'store', KEY);
  const pdir = join(root, 'pipelines', '04-06-26-my-feature-pp');
  await mkdir(pdir, { recursive: true });
  await writeFile(join(pdir, 'prompt.md'), '# My feature\n', 'utf8');
  await writeFile(join(pdir, 'diff-patch.patch'), 'diff --git a/a b/a\n', 'utf8');
  await mkdir(join(root, 'plans'), { recursive: true });
  await mkdir(join(root, 'reviews'), { recursive: true });
  await writeFile(join(root, 'plans', '04-06-26-my-feature.md'), '# p', 'utf8');
  await writeFile(join(root, 'reviews', '04-06-26-my-feature-impl-review.md'), '# r', 'utf8');
  // DB instead of state.json/meta.json: store_meta + the pipelines row + indexed md.
  // No branch -> no git calls; isolates store-removal behavior.
  writeStoreMeta(KEY, 'project', { key: KEY, name: 'Beta', path: '/repo/beta' });
  seedPipelineRow({
    id: 'pp', projectKey: KEY, title: 'My feature', status: 'stopped',
    baseName: 'my-feature', datePrefix: '04-06-26',
  });
  recordArtifact('pp', 'plan', 'plans/04-06-26-my-feature.md');
  recordArtifact('pp', 'review', 'reviews/04-06-26-my-feature-impl-review.md');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  runs.clear();
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

const del = (id, qs) => fetch(`${base}/api/runs/${id}?${qs}`, { method: 'DELETE' });
const discard = (id, qs) => fetch(`${base}/api/runs/${id}/discard-worktree?${qs}`, { method: 'POST' });

test('400 when neither projectKey nor projectDir is given', async () => {
  assert.equal((await del('pp', '')).status, 400);
});

test('404 for an unknown id', async () => {
  assert.equal((await del('nope', `projectKey=${KEY}`)).status, 404);
});

test('409 when the pipeline is live/active in this process', async () => {
  runs.set('uuid-1', { id: 'uuid-1', pipelineId: 'pp', status: 'running' });
  assert.equal((await del('pp', `projectKey=${KEY}`)).status, 409);
  runs.clear();
});

test('discard-worktree route returns 400 / 404 / 409 and an idempotent 200', async () => {
  assert.equal((await discard('pp', '')).status, 400);
  assert.equal((await discard('nope', `projectKey=${KEY}`)).status, 404);
  runs.set('uuid-2', { id: 'uuid-2', pipelineId: 'pp', status: 'running' });
  assert.equal((await discard('pp', `projectKey=${KEY}`)).status, 409);
  runs.clear();
  const response = await discard('pp', `projectKey=${KEY}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.discarded, false, 'no retained record is an idempotent no-op');
  assert.equal(body.remaining, 0, 'a no-op discard leaves nothing retained');
  assert.ok(existsSync(join(home, '.worca-cc', 'store', KEY, 'pipelines', '04-06-26-my-feature-pp')),
    'discard keeps pipeline history');
});

test('recovery-patch route downloads the fixed pipeline diff artifact', async () => {
  const response = await fetch(`${base}/api/runs/pp/recovery-patch?projectKey=${KEY}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition') || '', /diff-patch-pp\.patch/);
  assert.match(await response.text(), /diff --git/);
});

test('recovery-patch route prefers the retained-work snapshot when one is indexed', async () => {
  const pdir = join(home, '.worca-cc', 'store', KEY, 'pipelines', '04-06-26-my-feature-pp');
  await writeFile(join(pdir, 'retained-work.patch'), 'diff --git a/kept b/kept\n', 'utf8');
  recordArtifact('pp', 'retained-work-patch', 'retained-work.patch');
  const res = await fetch(`${base}/api/runs/pp/recovery-patch?projectKey=${KEY}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /retained-work-pp\.patch/);
  assert.match(await res.text(), /kept/);
  // Restore the fixture: later tests rely on the diff-patch fallback identity.
  getDb().prepare("DELETE FROM artifacts WHERE pipeline_id = 'pp' AND kind = 'retained-work-patch'").run();
  await rm(join(pdir, 'retained-work.patch'), { force: true });
});

test('discard-worktree maps SNAPSHOT_FAILED to 409 with the actionable message', async () => {
  // A row with NO on-disk run dir: findRunDir returns null -> SNAPSHOT_FAILED.
  // Deliberately its own id so the suite's shared 04-06-26-my-feature-pp fixture
  // (and the final archive test's assertions) stays intact.
  const retained = join(home, 'retained-snapfail');
  await mkdir(retained, { recursive: true });
  seedPipelineRow({
    id: 'sf', projectKey: KEY, title: 'Snapshot fail', status: 'stopped',
    baseName: 'snapfail', datePrefix: '04-06-26',
    branch: {
      worktreeDir: retained, feature: 'worca/x',
      commitFailed: { code: 'commit_failed', step: 'commit', message: 'hook failed' },
    },
  });
  const res = await discard('sf', `projectKey=${KEY}`);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /recovery patch/);
});

test('archive route refuses a live commit-failed worktree even when called directly', async () => {
  const retained = join(home, 'retained-worktree');
  await mkdir(retained);
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify({
    worktreeDir: retained,
    commitFailed: { code: 'commit_failed', step: 'commit', message: 'hook failed' },
  }), 'pp');
  const response = await del('pp', `projectKey=${KEY}`);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /retained uncommitted work/);
  getDb().prepare('UPDATE pipelines SET branch = NULL WHERE id = ?').run('pp');
});

test('DELETE /api/workspaces/:id returns 409 while a member has retained uncommitted work', async () => {
  const WKEY = 'wks-apidel-0000ab12';
  const wt = join(home, 'retained-apidel');
  await mkdir(wt, { recursive: true });
  const now = new Date().toISOString();
  getDb().prepare('INSERT INTO workspaces (id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(WKEY, 'Api Del', '', now, now);
  seedPipelineRow({
    id: 'wd', projectKey: KEY, workspaceKey: WKEY, target: 'workspace', title: 'WS del',
    status: 'done', baseName: 'ws-del', datePrefix: '04-06-26',
    workspaceMeta: { branches: { 'proj-0000aaaa': {
      feature: 'worca/x', worktreeDir: wt,
      commitFailed: { code: 'commit_failed', step: 'commit', message: 'hook' },
    } } },
  });
  const res = await fetch(`${base}/api/workspaces/${WKEY}`, { method: 'DELETE' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /retained uncommitted work/);
});

test('run-scope guards: bad projectKey shape is 404 and missing scope is 400 on both retained-work routes', async () => {
  for (const [method, path] of [['GET', 'recovery-patch'], ['POST', 'discard-worktree']]) {
    const bad = await fetch(`${base}/api/runs/pp/${path}?projectKey=..%2Fevil`, { method });
    assert.equal(bad.status, 404, `${path}: malformed projectKey must 404`);
    const none = await fetch(`${base}/api/runs/pp/${path}`, { method });
    assert.equal(none.status, 400, `${path}: missing scope must 400`);
  }
  // Pin the shape guard ITSELF: with a row whose project_key IS the traversal
  // string, the lookup SUCCEEDS, so only the guard can stop the request. Without
  // it the POST returns 200 and the GET's 404 message degrades to
  // 'recovery patch not found' — the bare status does NOT distinguish the two.
  seedPipelineRow({ id: 'trav', projectKey: '../evil', title: 'Traversal',
    status: 'stopped', baseName: 'trav', datePrefix: '04-06-26' });
  for (const [method, path] of [['GET', 'recovery-patch'], ['POST', 'discard-worktree']]) {
    const res = await fetch(`${base}/api/runs/trav/${path}?projectKey=..%2Fevil`, { method });
    assert.equal(res.status, 404, `${path}: a traversal projectKey must never resolve`);
    assert.match((await res.json()).error, /pipeline not found/,
      `${path}: rejected by the shape guard, not incidentally by a lookup miss`);
  }
});

test('200 removes the pipeline dir + shared plan/review files', async () => {
  const r = await del('pp', `projectKey=${KEY}`);
  assert.equal(r.status, 200);
  const root = join(home, '.worca-cc', 'store', KEY);
  assert.equal(existsSync(join(root, 'pipelines', '04-06-26-my-feature-pp')), false);
  assert.equal(existsSync(join(root, 'plans', '04-06-26-my-feature.md')), false);
  assert.equal(existsSync(join(root, 'reviews', '04-06-26-my-feature-impl-review.md')), false);
  // The FS is reclaimed, but the run's statistical record is permanent: the row
  // survives as a soft delete stamped with archived_at.
  const row = getDb().prepare('SELECT archived_at FROM pipelines WHERE id = ?').get('pp');
  assert.ok(row, 'pipelines row survives the archive');
  assert.ok(row.archived_at, 'archived_at stamped');
});
