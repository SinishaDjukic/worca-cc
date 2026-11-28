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
import { rm, mkdir } from 'node:fs/promises';
import { existsSync, realpathSync, rmSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { createWorktree, listLocalBranches } from '../src/core/worktree.mjs';
import { writeRunManifest } from '../src/core/run-manifest.mjs';
import { addProject, worcaHome } from '../src/core/projects.mjs';
import { getDb } from '../src/core/db.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { readServerSource } from '../src/core/read-server-source.mjs';

useTempHome(after);

// ui/server.mjs is imported LAZILY (after useTempHome has pointed WORCA_HOME at
// the throwaway dir), like every other server-importing suite.
let bootMaintenance;
before(async () => { ({ bootMaintenance } = await import('../ui/server.mjs')); });

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

/** A fresh git repo with one commit (realpath'd: git reports canonical paths). */
async function freshRepo(prefix = 'worca-cc-boot-repo-') {
  const dir = realpathSync(templateRepo('boot-repo', { branch: 'main', user: true, files: { 'seed.txt': 'seed\n' }, prefix }));
  created.push(dir);
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

// The fourth janitor — chat repo looks (auto-look-*) a crashed MCP child left under
// <worcaHome>/tmp/ask. The helper is unit-tested in auto-repo-look.test.mjs; this pins
// the WIRING (a typo'd identifier would only log "sweep failed").
test('boot: repo-look sweep removes a stale auto-look-* dir under tmp/ask and reports it', async () => {
  const repo = await freshRepo('worca-cc-boot-look-');
  const { openRepoLook } = await import('../src/core/auto/repo-look.mjs');
  const base = join(worcaHome(), 'tmp', 'ask');
  await mkdir(base, { recursive: true });
  const look = await openRepoLook(repo, base);
  assert.ok(look && existsSync(look.cwd), 'fixture: a single-project look checked out');
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);                     // 2h > the 1h window
  utimesSync(look.cwd, old, old);

  const events = [];
  const res = await bootMaintenance({ log: (scope, level, msg) => events.push({ scope, level, msg }) });

  assert.deepEqual(res.repoLooks.removed, [look.cwd]);
  assert.deepEqual(res.repoLooks.failed, []);
  assert.ok(!existsSync(look.cwd), 'the stale look is gone');
  assert.ok(!String(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).stdout).includes('auto-look-'),
    'its registration was removed from the source repo');
});

// Requirements code looks (plans/requirements-design.md D7) live under <worcaHome>/tmp/requirements: a
// crash mid-orientation leaves the checkout there, so boot sweeps that base too.
test('boot: repo-look sweep also removes a stale look under tmp/requirements', async () => {
  const repo = await freshRepo('worca-cc-boot-reqlook-');
  const { openRepoLook } = await import('../src/core/auto/repo-look.mjs');
  const base = join(worcaHome(), 'tmp', 'requirements');
  await mkdir(base, { recursive: true });
  const look = await openRepoLook(repo, base);
  assert.ok(look && existsSync(look.cwd), 'fixture: a single-project look checked out');
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(look.cwd, old, old);

  const res = await bootMaintenance({ log: () => {} });

  assert.deepEqual(res.requirementsRepoLooks.removed, [look.cwd]);
  assert.deepEqual(res.requirementsRepoLooks.failed, []);
  assert.ok(!existsSync(look.cwd), 'the stale requirements look is gone');
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

// Requirements A7 (D15): a product brief left `making` by a restart, whose job is not running, gets INTERRUPTED
// through the boot path (next to the interview's own sweep). The helper is unit-tested in
// requirements-brief-job.test.mjs; this pins the WIRING.
test('boot: a product brief left making by a restart becomes INTERRUPTED', async () => {
  const { beginBrief, getBrief } = await import('../src/core/requirements/store.mjs');
  beginBrief('project', 'boot-brief-1');
  assert.equal(getBrief('project', 'boot-brief-1').status, 'making');

  const res = await bootMaintenance({ log: () => {} });

  assert.equal(res.recoveredBriefs, 1);
  const b = getBrief('project', 'boot-brief-1');
  assert.equal(b.status, 'empty', 'never made: back to empty');
  assert.equal(b.error.code, 'INTERRUPTED');
  assert.equal(b.error.message, 'The code look did not finish because Worca restarted. Try again.');
  assert.equal((await bootMaintenance({ log: () => {} })).recoveredBriefs, 0, 'idempotent');
});

// Requirements A8 (D5, D9): the three file janitors run at boot. The helpers are unit-tested in
// requirements-attachment-job.test.mjs; this pins the WIRING.
test('boot: a file left reading fails INTERRUPTED; old read folders and temp bodies go, fresh ones stay', async () => {
  const store = await import('../src/core/requirements/store.mjs');
  const left = store.insertAttachment({ id: store.mintAttachmentId(), ownerType: 'feature', ownerId: 1, name: 'x.md', kind: 'text', mime: 'text/plain', bytes: 1, sha256: 'boot-att-1' });
  const reads = join(worcaHome(), 'tmp', 'requirements');
  const bodies = join(worcaHome(), 'requirements', 'att');
  const oldRead = join(reads, 'att-read-0123abcd');
  const freshRead = join(reads, 'att-read-4567cdef');
  const oldTemp = join(bodies, 'ratt_0123456789ab.txt.tmp-0123abcd');
  const freshTemp = join(bodies, 'ratt_0123456789ab.txt.tmp-4567cdef');
  for (const d of [oldRead, freshRead]) await mkdir(d, { recursive: true });
  await mkdir(bodies, { recursive: true });
  const { writeFileSync } = await import('node:fs');
  for (const f of [oldTemp, freshTemp]) writeFileSync(f, 'x');
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  for (const p of [oldRead, oldTemp]) utimesSync(p, old, old);

  const res = await bootMaintenance({ log: () => {} });

  assert.equal(res.recoveredAttachmentReads, 1);
  assert.equal(store.getAttachment(left.id).error.code, 'INTERRUPTED');
  assert.deepEqual([res.attachmentReadFolders.removed, res.attachmentTempBodies.removed], [[oldRead], [oldTemp]]);
  assert.deepEqual([existsSync(oldRead), existsSync(freshRead), existsSync(oldTemp), existsSync(freshTemp)], [false, true, false, true]);
  assert.equal((await bootMaintenance({ log: () => {} })).recoveredAttachmentReads, 0, 'idempotent');
});

// Idle chat checkouts: after the reconcile sweep, boot frees the ones nothing needs (clean, nothing only on them,
// untouched for a week, not in use here) and keeps everything else. Never gated on the cap.
test('boot: idle chat checkouts — frees the old clean one, keeps dirty / own-commit / recent / unreadable / in-use rows, reports, emits', async () => {
  const repo = await freshRepo('worca-cc-boot-idle-');
  const { addProject } = await import('../src/core/projects.mjs');
  const { createThread, getThread } = await import('../src/core/ask/store.mjs');
  const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
  const { writeFileSync } = await import('node:fs');
  const mod = await import('../ui/server.mjs');
  const p = (await addProject({ name: 'bsidle', path: repo })).find((x) => x.name === 'bsidle');
  const db = getDb();
  const DAY = 24 * 60 * 60_000;
  /** A checkout whose every signal is `days` old. */
  const seed = async (days) => {
    const t = createThread({ title: `idle ${days}` });
    const w = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
    const at = Date.now() - days * DAY;
    db.prepare('UPDATE ask_worktrees SET created_at = ?, updated_at = ? WHERE id = ?').run(new Date(at).toISOString(), new Date(at).toISOString(), w.worktreeId);
    db.prepare('UPDATE ask_threads SET updated_at = ? WHERE id = ?').run(new Date(at).toISOString(), t.id);
    utimesSync(join(w.path, '.git'), at / 1000, at / 1000);
    return { t, w };
  };
  const old = await seed(30);
  const dirty = await seed(30);
  writeFileSync(join(dirty.w.path, 'wip.txt'), 'wip\n');
  const commit = await seed(30);
  writeFileSync(join(commit.w.path, 'c.txt'), 'c\n');
  spawnSync('git', ['add', '-A'], { cwd: commit.w.path });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'mine'], { cwd: commit.w.path });
  const recent = await seed(1);
  const unreadable = await seed(30);
  writeFileSync(join(unreadable.w.path, '.git'), 'not a gitdir pointer\n');            // git cannot read it: unknown, keep
  utimesSync(join(unreadable.w.path, '.git'), (Date.now() - 30 * DAY) / 1000, (Date.now() - 30 * DAY) / 1000);
  const running = await seed(30);
  mod._testing.askJobs.set(running.t.id, { status: 'running' });                      // a live turn in THIS process

  const frames = [];
  const onFrame = (f) => frames.push(f);
  mod._testing.askBus.on(old.t.id, onFrame);
  let res;
  try {
    res = await bootMaintenance({ log: () => {} });
  } finally {
    mod._testing.askJobs.delete(running.t.id);
    mod._testing.askBus.off(old.t.id, onFrame);
  }

  assert.deepEqual(res.askWorktreesIdle.freed, [old.w.worktreeId]);
  assert.equal(res.askWorktreesIdle.failed, 0);
  assert.equal(res.askWorktreesIdle.kept, 5);
  assert.ok(!existsSync(old.w.path), 'the idle checkout is gone');
  for (const c of [dirty, commit, recent, unreadable, running]) assert.ok(existsSync(c.w.path), `${c.t.title} is kept`);
  assert.ok(getThread(old.t.id), 'its chat stays');
  assert.deepEqual(frames.filter((f) => f.type === 'ask-worktrees').map((f) => f.worktrees), [[]], 'a freed row is announced');
  for (const c of [dirty, commit, recent, unreadable, running]) db.prepare('DELETE FROM ask_worktrees WHERE id = ?').run(c.w.worktreeId);
});

test('boot: the idle checkout step does not run on an empty registry, and a failure inside it never fails boot', async () => {
  getDb().prepare('DELETE FROM ask_worktrees').run();
  const empty = await bootMaintenance({ log: () => {} });
  assert.equal(empty.askWorktreesIdle, null);
  // a log sink that throws inside the step must still leave boot standing
  const repo = await freshRepo('worca-cc-boot-idle2-');
  const { addProject } = await import('../src/core/projects.mjs');
  const { createThread } = await import('../src/core/ask/store.mjs');
  const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
  const p = (await addProject({ name: 'bsidle2', path: repo })).find((x) => x.name === 'bsidle2');
  const t = createThread();
  const w = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  const db = getDb();
  const at = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  db.prepare('UPDATE ask_worktrees SET created_at = ?, updated_at = ? WHERE id = ?').run(at, at, w.worktreeId);
  db.prepare('UPDATE ask_threads SET updated_at = ? WHERE id = ?').run(at, t.id);
  utimesSync(join(w.path, '.git'), Date.parse(at) / 1000, Date.parse(at) / 1000);
  const res = await bootMaintenance({ log: (scope) => { if (scope === 'ask-worktrees') throw new Error('sink exploded'); } });
  assert.ok(res.reconciled !== undefined, 'boot finished');
  assert.equal(res.askWorktreesIdle, null, 'the step threw (its log sink did), boot carried on');
  db.prepare('DELETE FROM ask_worktrees WHERE id = ?').run(w.worktreeId);
});

// Slice 5 (R-arch-1, D6): the boot marks the runs it is about to resume as soon as the reconcile has named them,
// before bootMaintenance's first await, so they hold their turn before the scheduler's first tick.
test('bootMaintenance reports the reconciled ids before its first await', async () => {
  seedPipelineRow({ id: 'bootmk01', status: 'running', heartbeatAt: '2000-01-01T00:00:00.000Z' });
  let seen = null;
  const pending = bootMaintenance({ log: () => {}, onReconciled: (ids) => { seen = ids; } });
  const beforeAwait = seen;
  const res = await pending;
  assert.ok(Array.isArray(beforeAwait), 'onReconciled is called synchronously');
  assert.ok(beforeAwait.includes('bootmk01'));
  assert.deepEqual(beforeAwait, res.reconciledIds);
});

test('bootMaintenance: a throwing onReconciled does not stop maintenance', async () => {
  seedPipelineRow({ id: 'bootmk02', status: 'running', heartbeatAt: '2000-01-01T00:00:00.000Z' });
  let calls = 0;
  const res = await bootMaintenance({ log: () => {}, onReconciled: () => { calls += 1; throw new Error('boom'); } });
  assert.equal(calls, 1);
  assert.ok(res.reconciledIds.includes('bootmk02'));
  assert.ok(res.legacy, 'the later sweeps still ran');
});

test('boot wiring: the boot bootMaintenance call passes onReconciled, and its rejection handler clears the marks', () => {
  const src = readServerSource(undefined, { routes: false });
  const main = src.slice(src.indexOf('if (isMain) {'));
  const from = main.indexOf('bootMaintenance({');
  assert.ok(from > 0, 'the boot call passes options');
  const boot = main.slice(from, main.indexOf("server.on('error'"));
  assert.match(boot, /^bootMaintenance\(\{\s*onReconciled\b[\s\S]*?markBootResumes\(\s*bootResumePicks\(/);
  const rejected = boot.slice(boot.lastIndexOf('}, (err) => {'));
  assert.ok(rejected.includes('bootMaintenanceFailed = true'), 'the rejection handler of the boot call');
  assert.ok(rejected.includes('bootResuming.clear()'));
});
