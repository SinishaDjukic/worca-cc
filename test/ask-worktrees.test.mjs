// test/ask-worktrees.test.mjs
// P4/T4: the per-thread worktree registry (ask-worca-worktrees-design.md §3-§5)
// — open/list/remove over a real repo, caps, run-id sugar, navigation row
// updates, the sweep, and the unminted-id doctrine.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { addProject } from '../src/core/projects.mjs';
import { createThread, deleteThread } from '../src/core/ask/store.mjs';
import { prepare, getDb, _resetForTests } from '../src/core/db.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import {
  openAskWorktree, listAskWorktrees, getAskWorktree, removeAskWorktree,
  removeThreadWorktrees, noteWorktreeNavigation, sweepAskWorktrees,
  worktreesDir, worktreeDirFor, AskWorktreeError, WT_ID_RE,
} from '../src/core/ask/worktrees.mjs';

useTempHome(after);

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));
async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-awt-'));
  created.push(dir);
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  g(['checkout', '-qb', 'worca-cc/feat-00000001']);
  await writeFile(join(dir, 'feat.txt'), 'F\n');
  g(['add', '-A']); g(['commit', '-qm', 'feat']);
  g(['checkout', '-q', 'main']);
  return dir;
}

test('open/list/get/remove round trip; row shape; detached checkout on disk', async () => {
  const repo = await freshRepo();
  // addProject returns listProjects() — an ARRAY, not the row; pick the entry.
  const p = (await addProject({ name: 'awt-one', path: repo })).find((x) => x.name === 'awt-one');
  const t = createThread();
  const wt = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  assert.match(wt.worktreeId, WT_ID_RE);
  assert.equal(wt.projectKey, p.key);
  assert.equal(wt.ref, 'main');
  assert.match(wt.commit, /^[0-9a-f]{40}$/);
  assert.ok(wt.path.startsWith(worktreesDir(t.id)), 'placed under <askRoot>/<tid>/wt');
  assert.ok(existsSync(join(wt.path, 'README.md')));
  assert.deepEqual(listAskWorktrees(t.id).map((w) => w.worktreeId), [wt.worktreeId]);
  assert.equal(getAskWorktree(t.id, wt.worktreeId).path, wt.path);
  const out = await removeAskWorktree({ threadId: t.id, wtId: wt.worktreeId });
  assert.equal(out.ok, true);
  assert.ok(!existsSync(wt.path));
  assert.deepEqual(listAskWorktrees(t.id), []);
  await assert.rejects(() => removeAskWorktree({ threadId: t.id, wtId: wt.worktreeId }), AskWorktreeError);
});

test('errors: unknown thread, unknown project, bad ref, both-or-neither target, non-repo dir', async () => {
  const repo = await freshRepo();
  const p = (await addProject({ name: 'awt-err', path: repo })).find((x) => x.name === 'awt-err');
  const t = createThread();
  await assert.rejects(() => openAskWorktree({ threadId: 'ask_ffffffff', projectKey: p.key, ref: 'main' }), /unknown thread/);
  await assert.rejects(() => openAskWorktree({ threadId: t.id, projectKey: 'nope-00000000', ref: 'main' }), /unknown projectKey/);
  await assert.rejects(() => openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'no-such' }), /does not resolve/);
  await assert.rejects(() => openAskWorktree({ threadId: t.id, projectKey: p.key, ref: '--force' }), /does not resolve/);
  await assert.rejects(() => openAskWorktree({ threadId: t.id }), /give \(projectKey and ref\) or runId/);
  assert.throws(() => worktreesDir('..'), /never minted/);
  assert.throws(() => worktreeDirFor(t.id, '../etc'), /never minted/);
  // a registered project whose dir is NOT a git repo (pins the .git check — it
  // survived mutation without this assertion):
  const plain = await mkdtemp(join(tmpdir(), 'worca-cc-awt-plain-'));
  created.push(plain);
  const np = (await addProject({ name: 'awt-nogit', path: plain })).find((x) => x.name === 'awt-nogit');
  await assert.rejects(() => openAskWorktree({ threadId: t.id, projectKey: np.key, ref: 'main' }), /has no git repository/);
});

test('caps: 6th per-thread and 16th global are refused with actionable errors', async () => {
  const repo = await freshRepo();
  const p = (await addProject({ name: 'awt-cap', path: repo })).find((x) => x.name === 'awt-cap');
  const t = createThread();
  for (let i = 0; i < ASK_LIMITS.worktreesPerThread; i++) {
    await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  }
  await assert.rejects(() => openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' }), /cap reached \(5 per chat\)/);
  // global: fill the remaining 10 slots across other threads, then refuse the 16th
  const others = [];
  for (let i = 0; i < ASK_LIMITS.worktreesGlobal - ASK_LIMITS.worktreesPerThread; i++) {
    const tt = createThread(); others.push(tt);
    await openAskWorktree({ threadId: tt.id, projectKey: p.key, ref: 'main' });
  }
  const t2 = createThread();
  await assert.rejects(() => openAskWorktree({ threadId: t2.id, projectKey: p.key, ref: 'main' }), /global worktree cap/);
  // MUST release the global cap: node:test runs a file's top-level tests in order,
  // so 15 leaked rows fail every later test in this file with "global cap reached".
  await removeThreadWorktrees(t.id);
  for (const tt of others) await removeThreadWorktrees(tt.id);
});

test('run-id sugar: single-project run resolves the feature branch; deleted branch errors with the diff hint', async () => {
  const repo = await freshRepo();
  (await addProject({ name: 'awt-run', path: repo }));            // registers + writes store_meta
  const t = createThread();
  // seedPipeline(projectDir, state) is POSITIONAL and MINTS its own id
  // (db-seed.mjs: callers MUST use the returned {id}, never a hardcoded one).
  const run = await seedPipeline(repo, { status: 'done',
    branch: { source: 'main', feature: 'worca-cc/feat-00000001' } });
  const wt = await openAskWorktree({ threadId: t.id, runId: run.id });
  assert.equal(wt.ref, 'worca-cc/feat-00000001');
  assert.equal(wt.runId, run.id);
  assert.ok(existsSync(join(wt.path, 'feat.txt')));
  spawnSync('git', ['branch', '-D', 'worca-cc/feat-00000001'], { cwd: repo });
  await assert.rejects(() => openAskWorktree({ threadId: t.id, runId: run.id }), /no longer exists.*get_run_diff/);
  await assert.rejects(() => openAskWorktree({ threadId: t.id, runId: 'ffffffff' }), /run not found/);
});

test('run-id sugar: workspace run needs projectKey and resolves the member branch', async () => {
  const repoA = await freshRepo();
  const repoB = await freshRepo();
  const t = createThread();
  // seedWorkspacePipeline(primaryDir, workspaceKey, state, projects) is POSITIONAL
  // and mints its id. The members/branches the impl reads come from `state`
  // (workspace_meta.projects / .branches); the 4th arg only seeds store_meta, and
  // its second writeState re-serializes workspace_meta FROM state, so `projects`
  // must be repeated inside state or meta.projects persists as [] ("one of: none").
  const members = [
    { projectKey: 'alpha-00000001', projectDir: repoA, projectName: 'alpha' },
    { projectKey: 'beta-00000002',  projectDir: repoB, projectName: 'beta'  },
  ];
  const run = await seedWorkspacePipeline(repoA, 'wks-demo-00000001', {
    status: 'done',
    projects: members,                                 // -> workspace_meta.projects
    projectKeys: members.map((m) => m.projectKey),
    branches: {                                         // -> workspace_meta.branches
      'alpha-00000001': { source: 'main', feature: 'worca-cc/feat-00000001' },
      'beta-00000002':  { source: 'main', feature: 'worca-cc/feat-00000001' },
    },
  }, members);
  await assert.rejects(() => openAskWorktree({ threadId: t.id, runId: run.id }), /workspace run.*alpha-00000001.*beta-00000002/s);
  const wt = await openAskWorktree({ threadId: t.id, runId: run.id, projectKey: 'beta-00000002' });
  assert.equal(wt.projectDir, repoB);                  // row.project_dir stored VERBATIM (not realpath'd)
  assert.equal(wt.ref, 'worca-cc/feat-00000001');
  // §5 step 3 (deleted-branch) applies to workspace members too — pins A8.
  spawnSync('git', ['branch', '-D', 'worca-cc/feat-00000001'], { cwd: repoB });
  await assert.rejects(() => openAskWorktree({ threadId: t.id, runId: run.id, projectKey: 'beta-00000002' }),
    /no longer exists.*get_run_diff/);
});

test('navigation note updates ref + commit; thread delete removes checkouts, rows and git registrations', async () => {
  const repo = await freshRepo();
  const p = (await addProject({ name: 'awt-nav', path: repo })).find((x) => x.name === 'awt-nav');
  const t = createThread();
  const wt = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  spawnSync('git', ['checkout', '-q', '--detach', 'worca-cc/feat-00000001'], { cwd: wt.path });
  const upd = await noteWorktreeNavigation(t.id, wt.worktreeId, { ref: 'worca-cc/feat-00000001' });
  assert.equal(upd.ref, 'worca-cc/feat-00000001');
  assert.notEqual(upd.commit, wt.commit);
  await removeThreadWorktrees(t.id);
  deleteThread(t.id);
  assert.ok(!existsSync(wt.path));
  // SCOPE the count by thread_id — other tests in this file leave rows, so an
  // unscoped `count(*)` fails on residue. (This asserts the
  // removeThreadWorktrees+deleteThread teardown, NOT the FK — the FK gets its own
  // test below, because removeThreadWorktrees already emptied the rows here.)
  assert.equal(prepare('SELECT count(*) AS n FROM ask_worktrees WHERE thread_id = ?').get(t.id).n, 0, 'rows gone after teardown');
  assert.ok(!String(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).stdout).includes('/wt/'), 'no stale registration');
});

test('cascade: deleting the ask_threads row ALONE reaps its ask_worktrees rows (FK, not bookkeeping)', async () => {
  // Pins ON DELETE CASCADE. The nav test above deletes rows via removeThreadWorktrees
  // FIRST, so dropping the FK survives there; this deletes the thread row directly.
  const repo = await freshRepo();
  const p = (await addProject({ name: 'awt-casc', path: repo })).find((x) => x.name === 'awt-casc');
  const t = createThread();
  const wt = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  assert.deepEqual(listAskWorktrees(t.id).map((w) => w.worktreeId), [wt.worktreeId]);
  getDb().prepare('DELETE FROM ask_threads WHERE id = ?').run(t.id);   // no removeThreadWorktrees
  assert.deepEqual(listAskWorktrees(t.id), [], 'ON DELETE CASCADE reaped the registry rows');
  // The row is gone but the checkout dir survives on disk — remove it so the sweep
  // test below (shared temp home, scans <askRoot>/*/wt/*) does not count it as an
  // extra orphan and see `removedDirs 2 !== 1`.
  rmSync(wt.path, { recursive: true, force: true });
});

test('sweep: orphan dir removed, stale row dropped+git-pruned, both reported', async () => {
  const repo = await freshRepo();
  const p = (await addProject({ name: 'awt-sweep', path: repo })).find((x) => x.name === 'awt-sweep');
  const t = createThread();
  const a = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  const b = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  rmSync(a.path, { recursive: true, force: true });                       // stale row (dir gone)
  getDb();
  prepare('DELETE FROM ask_worktrees WHERE id = ?').run(b.worktreeId);    // orphan dir (row gone)
  const reg = () => String(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).stdout);
  assert.ok(reg().includes(a.worktreeId), 'precondition: git still holds the stale registration');
  const r = await sweepAskWorktrees({ log: () => {} });
  assert.equal(r.prunedRows, 1);
  assert.equal(r.removedDirs, 1);
  assert.equal(r.failed, 0);
  assert.deepEqual(listAskWorktrees(t.id), []);
  assert.ok(!existsSync(b.path));
  // the stale row must be git-PRUNED in project_dir, not merely row-deleted
  // (dropping removeWorktree from the stale-row path survives without this):
  assert.ok(!reg().includes(a.worktreeId), 'the stale registration was pruned');
});

// MUST be the LAST test in this file: it DROPs ask_worktrees to make the row scan
// throw, then heals via _resetForTests + getDb. Pins the three-state doctrine.
test('sweep: an unreadable registry skips everything — never guess-delete (three-state doctrine)', async () => {
  const repo = await freshRepo();
  const p = (await addProject({ name: 'awt-throw', path: repo })).find((x) => x.name === 'awt-throw');
  const t = createThread();
  const wt = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  getDb().exec('DROP TABLE ask_worktrees');                 // the row lookup itself now THROWS
  const logged = [];
  const r = await sweepAskWorktrees({ log: (lvl, msg) => logged.push(`${lvl}:${msg}`) });
  assert.equal(r.failed, 1, 'the failure is counted, not swallowed');
  assert.equal(r.removedDirs, 0, 'a DB failure must NOT read as "no rows => reclaim everything"');
  assert.equal(r.prunedRows, 0);
  assert.ok(existsSync(wt.path), 'the live checkout survived the unreadable registry');
  assert.ok(logged.some((l) => l.startsWith('warn:')), 'reported in the sweep summary');
  _resetForTests();                                        // reopen heals the dropped table
  getDb();
});

// Review of PR #376: an open_worktree in flight when its thread is deleted used
// to register nothing (or an orphan row) and leave the checkout in the user's
// repo until the next sweep. The checkout is rolled back and the call throws.
test('a thread deleted while `git worktree add` runs: open rolls the checkout back and throws', async () => {
  const repo = await freshRepo();
  const p = (await addProject({ name: 'awt-race', path: repo })).find((x) => x.name === 'awt-race');
  const t = createThread();
  const pending = openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  deleteThread(t.id);                                    // lands during the ref check / spawn
  await assert.rejects(pending, AskWorktreeError);
  assert.equal(prepare('SELECT count(*) AS n FROM ask_worktrees WHERE thread_id = ?').get(t.id).n, 0, 'no row');
  const wtl = String(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).stdout);
  assert.ok(!wtl.includes(t.id), 'no orphan checkout registered in the source repo');
  assert.ok(!existsSync(join(repo, '..', t.id)), 'nothing on disk');
});
