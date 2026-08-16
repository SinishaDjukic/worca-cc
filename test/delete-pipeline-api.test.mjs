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
  assert.ok(existsSync(join(home, '.worca-cc', 'store', KEY, 'pipelines', '04-06-26-my-feature-pp')),
    'discard keeps pipeline history');
});

test('recovery-patch route downloads the fixed pipeline diff artifact', async () => {
  const response = await fetch(`${base}/api/runs/pp/recovery-patch?projectKey=${KEY}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition') || '', /diff-patch-pp\.patch/);
  assert.match(await response.text(), /diff --git/);
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
