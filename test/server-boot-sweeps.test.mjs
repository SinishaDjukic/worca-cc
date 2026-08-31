// test/server-boot-sweeps.test.mjs
// Phase 7: the BOOT WIRING of worca-cc's two janitors, `bootMaintenance()` in
// ui/server.mjs. The helpers themselves are unit-tested in
// test/run-root-layout.test.mjs (Phase 1 + the Phase-7 fan-out); what is pinned
// HERE is only what the boot path adds:
//   - the PINNED order reconcileStaleRunning -> sweepRunRoots -> sweepLegacyWorktrees
//     (§8.12: reconcile first, so every stale `running` row is already the
//     KEEP-protected `interrupted` before either sweep classifies anything),
//   - that the legacy sweep runs over EVERY REGISTERED PROJECT (projects.mjs), and
//   - that it removes NOTHING while the effective mode is `legacy` (§10 rollback).
//
// MODE PINNING (§6 intro): the default mode is `legacy`, so every test here pins
// process.env.WORCA_RUN_ROOT itself and restores it in `finally`.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, realpath } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWorktree, listLocalBranches } from '../src/core/worktree.mjs';
import { writeRunManifest } from '../src/core/run-manifest.mjs';
import { addProject, worcaHome } from '../src/core/projects.mjs';
import { getDb } from '../src/core/db.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';

useTempHome(after);

// ui/server.mjs is imported LAZILY (after useTempHome has pointed WORCA_HOME at
// the throwaway dir), like every other server-importing suite.
let bootMaintenance;
before(async () => { ({ bootMaintenance } = await import('../ui/server.mjs')); });

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

/** A fresh git repo with one commit (realpath'd: git reports canonical paths). */
async function freshRepo(prefix = 'worca-cc-boot-repo-') {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  created.push(dir);
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'seed.txt'), 'seed\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

/** A LEGACY checkout at <repo>/.worca-cc/worktrees/<id> (the sweep's candidates). */
const legacyWorktree = (repo, id) => createWorktree({
  projectDir: repo, pipelineId: id, sourceBranch: 'main', featureBranch: `worca-cc/${id}`,
});

/** A detached run root with a manifest (the OTHER sweep's candidate). */
async function seedRunRoot(id) {
  const runRoot = join(worcaHome(), 'runs', id);
  await mkdir(join(runRoot, 'repos'), { recursive: true });
  await writeRunManifest(runRoot, { pipelineId: id, runRootMode: 'detached', isWorkspace: false, members: [] });
  return runRoot;
}

const statusOf = (id) => getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(id)?.status;

/** Run `fn` with WORCA_RUN_ROOT pinned, restoring the previous value after. */
async function withMode(mode, fn) {
  const prev = process.env.WORCA_RUN_ROOT;
  process.env.WORCA_RUN_ROOT = mode;
  try { return await fn(); }
  finally {
    if (prev === undefined) delete process.env.WORCA_RUN_ROOT;
    else process.env.WORCA_RUN_ROOT = prev;
  }
}

test('boot (detached): sweeps run roots FIRST, then legacy worktrees over every registered project', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  await addProject({ name: 'boot-a', path: a });
  await addProject({ name: 'boot-b', path: b });

  const gone = await legacyWorktree(a, 'lgdone01');    // done   -> REMOVE
  const kept = await legacyWorktree(b, 'lgpaus01');    // paused -> KEEP (resumable)
  const runRoot = await seedRunRoot('rrdone01');       // done   -> reclaimed by the run-root sweep
  seedPipelineRow({ id: 'lgdone01', status: 'done' });
  seedPipelineRow({ id: 'lgpaus01', status: 'paused' });
  seedPipelineRow({ id: 'rrdone01', status: 'done' });

  const events = [];
  const res = await withMode('detached', () => bootMaintenance({
    log: (scope, level, msg) => events.push({ scope, level, msg }),
  }));

  // The legacy sweep ran, over BOTH registered projects, under the keep-set.
  assert.equal(res.legacy.skipped, false);
  assert.equal(res.legacy.projects, 2, 'every registered project was swept');
  assert.deepEqual(res.legacy.removed, [gone.worktreeDir]);
  assert.deepEqual(res.legacy.keep, [kept.worktreeDir]);
  assert.ok(!existsSync(gone.worktreeDir), 'the terminal legacy checkout is gone');
  assert.ok(existsSync(kept.worktreeDir), 'the paused one SURVIVES (resume re-enters it)');
  assert.ok((await listLocalBranches(a)).includes('worca-cc/lgdone01'), 'branches are never touched');
  // …and so did the run-root sweep, on its own candidate.
  assert.deepEqual(res.runRoots.removed, [runRoot]);
  assert.ok(!existsSync(runRoot));

  // ORDER (§8.12): every run-root line precedes every legacy line.
  const lastRunRoot = events.map((e) => e.scope).lastIndexOf('run-root');
  const firstLegacy = events.map((e) => e.scope).indexOf('legacy');
  assert.ok(lastRunRoot >= 0 && firstLegacy >= 0, `both sweeps logged: ${JSON.stringify(events)}`);
  assert.ok(lastRunRoot < firstLegacy, 'the legacy sweep runs AFTER the run-root sweep');

  // Idempotent: a second boot removes nothing new and still keeps the paused tree.
  const again = await withMode('detached', () => bootMaintenance({ log: () => {} }));
  assert.deepEqual(again.legacy.removed, []);
  assert.deepEqual(again.legacy.keep, [kept.worktreeDir]);
  assert.ok(existsSync(kept.worktreeDir));
});

test('boot (legacy): the legacy sweep removes NOTHING — the §10 rollback stays non-destructive', async () => {
  const c = await freshRepo();
  await addProject({ name: 'boot-c', path: c });
  // `done` would be removed under detached; under legacy this dir is the LIVE
  // location of every active run, so the sweep must not even look at it.
  const live = await legacyWorktree(c, 'lgleg001');
  seedPipelineRow({ id: 'lgleg001', status: 'done' });

  const events = [];
  const res = await withMode('legacy', () => bootMaintenance({
    log: (scope, level, msg) => events.push({ scope, level, msg }),
  }));

  assert.equal(res.legacy.skipped, true, 'the sweep declares itself skipped');
  assert.equal(res.legacy.projects, 0, 'not one registered project is even read');
  assert.deepEqual(res.legacy.removed, []);
  assert.ok(existsSync(live.worktreeDir), 'the legacy checkout is untouched');
  assert.equal(events.filter((e) => e.scope === 'legacy').length, 0, 'and it logs nothing');
});

test('boot: reconcile runs BEFORE the sweeps, so a stale `running` row is KEPT as interrupted', async () => {
  const d = await freshRepo();
  await addProject({ name: 'boot-d', path: d });
  const crashed = await legacyWorktree(d, 'lgcrsh01');
  const OLD = new Date(Date.now() - 60 * 60 * 1000).toISOString();  // 1h > the 30min window
  seedPipelineRow({ id: 'lgcrsh01', status: 'running', startedAt: OLD, updatedAt: OLD });

  const res = await withMode('detached', () => bootMaintenance({ log: () => {} }));

  assert.ok(res.reconciled >= 1, 'the stale running row was reconciled first');
  assert.equal(statusOf('lgcrsh01'), 'interrupted');
  assert.ok(res.legacy.keep.includes(crashed.worktreeDir), 'and its checkout lands in KEEP');
  assert.ok(existsSync(crashed.worktreeDir),
    'the boot that made the run resumable must not delete the work it would resume');
});

// P4/T8: the third janitor — ask worktrees. Reconciles ask_worktrees rows against
// the on-disk checkouts BOTH ways, and reports through the same `log(scope,…)`
// sink the other two use (so a bare production boot keeps each sweep's own
// console default).
test('boot: ask-worktree sweep removes an orphan dir, drops a stale row, and reports both', async () => {
  const repo = await freshRepo('worca-cc-boot-askwt-');
  const { addProject } = await import('../src/core/projects.mjs');
  const { createThread } = await import('../src/core/ask/store.mjs');
  const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
  const p = (await addProject({ name: 'bswt', path: repo })).find((x) => x.name === 'bswt');
  const t = createThread();
  const a = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  const b = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  rmSync(a.path, { recursive: true, force: true });                              // stale row (dir gone)
  getDb().prepare('DELETE FROM ask_worktrees WHERE id = ?').run(b.worktreeId);   // orphan dir (row gone)

  const events = [];
  const res = await bootMaintenance({ log: (scope, level, msg) => events.push({ scope, level, msg }) });

  assert.equal(res.askWorktrees.prunedRows, 1);
  assert.equal(res.askWorktrees.removedDirs, 1);
  assert.equal(res.askWorktrees.failed, 0);
  assert.ok(!existsSync(b.path), 'the orphan checkout is gone');
  assert.ok(events.some((e) => e.scope === 'ask-worktrees'),
    `the sweep logs through sink('ask-worktrees'): ${JSON.stringify(events)}`);
  assert.ok(!String(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).stdout).includes('/wt/'),
    'both registrations were git-pruned in the source repo');
});

// P8a: a DB stamped past 24 by a divergent ladder can still hold v1 resume
// points, so boot sweeps them once, idempotently.
test('bootMaintenance retires runs left paused on the v1 engine', async () => {
  seedPipelineRow({ id: 'v1sweep1', status: 'paused' });
  getDb().prepare('UPDATE pipelines SET resume_point = ? WHERE id = ?')
    .run(JSON.stringify({ version: 1, kind: 'boundary' }), 'v1sweep1');
  const summary = await withMode('legacy', () => bootMaintenance({ log: () => {} }));
  assert.equal(summary.sweptV1, 1);
  const row = getDb().prepare('SELECT status, resume_point FROM pipelines WHERE id = ?').get('v1sweep1');
  assert.equal(row.status, 'interrupted');
  assert.equal(row.resume_point, null);
});
