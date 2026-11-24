// test/ask-worktrees.test.mjs
// P4/T4: the per-thread worktree registry (ask-worca-worktrees-design.md §3-§5)
// — open/list/remove over a real repo, caps, run-id sugar, navigation row
// updates, the sweep, and the unminted-id doctrine.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { addProject } from '../src/core/projects.mjs';
import { createThread, deleteThread } from '../src/core/ask/store.mjs';
import { prepare, getDb, _resetForTests } from '../src/core/db.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import {
  openAskWorktree, listAskWorktrees, getAskWorktree, removeAskWorktree,
  removeThreadWorktrees, noteWorktreeNavigation, sweepAskWorktrees,
  worktreesDir, worktreeDirFor, AskWorktreeError, WT_ID_RE,
} from '../src/core/ask/worktrees.mjs';
import { _testing as gitSyncTesting } from '../src/core/git-sync.mjs';

useTempHome(after);

// #527: the remote fallback reads effectiveSyncSettings → settings.json under HOME, so a
// developer's own sync.remote must not change these results (nor may a test write it).
const realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
const fakeHome = mkdtempSync(join(tmpdir(), 'worca-cc-awt-home-'));
before(() => { process.env.HOME = fakeHome; process.env.USERPROFILE = fakeHome; });
after(() => {
  for (const [k, v] of Object.entries(realHome)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(fakeHome, { recursive: true, force: true });
});

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));
async function freshRepo() {
  const dir = templateRepo('awt', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } });
  created.push(dir);
  const g = (args) => spawnSync('git', args, { cwd: dir });
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

test('run-id sugar: a single-project run resolves the feature branch; a workspace run needs projectKey and resolves the member branch; a deleted branch errors with the get_run_diff hint', async () => {
  await checkRows([
    { name: 'run-id sugar: single-project run resolves the feature branch; deleted branch errors with the diff hint', run: async () => {
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
    } },
    { name: 'run-id sugar: workspace run needs projectKey and resolves the member branch', run: async () => {
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
    } },
  ]);
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

// ── #527: remote-only refs ──────────────────────────────────────────────────
/** A bare origin (main + optional pre-clone branches) and a clone of it; push() adds a branch
 *  to origin AFTER the clone, so only a fetch can see it. The clone has no FETCH_HEAD. */
async function clonedRepo(preClone = []) {
  const root = await mkdtemp(join(tmpdir(), 'worca-cc-awt-remote-'));
  created.push(root);
  const g = (cwd, args) => {
    const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const clone = join(root, 'clone');
  g(root, ['init', '-q', '--bare', '-b', 'main', origin]);
  g(root, ['init', '-q', '-b', 'main', seed]);
  await writeFile(join(seed, 'README.md'), '# hi\n');
  g(seed, ['add', '-A']); g(seed, ['commit', '-qm', 'init']);
  g(seed, ['remote', 'add', 'origin', origin]);
  g(seed, ['push', '-q', 'origin', 'main']);
  const push = async (name) => {
    g(seed, ['checkout', '-qB', name, 'main']);
    await writeFile(join(seed, `${name.replace(/\//g, '_')}.txt`), `${name}\n`);
    g(seed, ['add', '-A']); g(seed, ['commit', '-qm', name]);
    g(seed, ['push', '-q', 'origin', name]);
  };
  for (const b of preClone) await push(b);
  g(root, ['clone', '-q', origin, clone]);
  return { clone, push };
}

test('#527 open_worktree: a bare remote-only branch resolves to origin/<name> (resolvedFrom); <remote>/<name> without a remote is a plain "does not resolve"', async () => {
  await checkRows([
    { name: '#527 open_worktree: a bare remote-only branch resolves to origin/<name> with resolvedFrom', run: async () => {
      const { clone, push } = await clonedRepo();
      await push('feat/remote');
      const p = (await addProject({ name: 'awt-remote', path: clone })).find((x) => x.name === 'awt-remote');
      const t = createThread();
      const wt = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'feat/remote' });
      assert.equal(wt.ref, 'origin/feat/remote');
      assert.equal(wt.resolvedFrom, 'feat/remote');
      assert.equal('stale' in wt, false);
      assert.ok(existsSync(join(wt.path, 'feat_remote.txt')));
      await assert.rejects(() => openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'nowhere' }), /ref does not resolve: "nowhere"/);
      const local = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
      assert.equal(local.ref, 'main');
      assert.equal('resolvedFrom' in local, false);
      await removeThreadWorktrees(t.id);
    } },
    { name: '#527 open_worktree: <remote>/<name> in a project with no remote is a plain "does not resolve" (no fetch note)', run: async () => {
      const { clone } = await clonedRepo();
      spawnSync('git', ['remote', 'remove', 'origin'], { cwd: clone });
      const p = (await addProject({ name: 'awt-noremote', path: clone })).find((x) => x.name === 'awt-noremote');
      const t = createThread();
      await assert.rejects(() => openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'origin/feat' }),
        (err) => /ref does not resolve: "origin\/feat"$/.test(err.message));
      await removeThreadWorktrees(t.id);
    } },
  ]);
});

test('#527 open_worktree: origin/<name> pushed since the last fetch is fetched and opened; a failed fetch still opens a previously fetched branch, marked stale', async () => {
  await checkRows([
    { name: '#527 open_worktree: origin/<name> pushed since the last fetch is fetched and opened as given', run: async () => {
      const { clone, push } = await clonedRepo();
      await push('feat/late');
      const p = (await addProject({ name: 'awt-late', path: clone })).find((x) => x.name === 'awt-late');
      const t = createThread();
      const wt = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'origin/feat/late' });
      assert.equal(wt.ref, 'origin/feat/late');
      assert.equal('resolvedFrom' in wt, false);
      await assert.rejects(() => openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'origin/never' }), /ref does not resolve/);
      await removeThreadWorktrees(t.id);
    } },
    { name: '#527 open_worktree: a failed fetch still opens a previously fetched remote-only branch, stale', run: async () => {
      const { clone } = await clonedRepo(['feat/old']);     // origin/feat/old came with the clone
      const p = (await addProject({ name: 'awt-stale', path: clone })).find((x) => x.name === 'awt-stale');
      const t = createThread();
      gitSyncTesting.setRunner(async (args, o) => (args[0] === 'fetch'
        ? { ok: false, stdout: '', stderr: 'fatal: unable to access: Could not resolve host: github.com', code: 128, timedOut: false }
        : gitSyncTesting.defaultRun(args, o)));
      try {
        const wt = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'feat/old' });
        assert.equal(wt.ref, 'origin/feat/old');
        assert.equal(wt.resolvedFrom, 'feat/old');
        assert.equal(wt.stale, true);
        assert.ok('fetchedAt' in wt);
        await assert.rejects(() => openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'feat/missing' }), /the remote could not be fetched/);
      } finally { gitSyncTesting.reset(); }
      await removeThreadWorktrees(t.id);
    } },
  ]);
});

test('global cap error names the chats that hold slots and what to do, and removes nothing', async () => {
  const repo = await freshRepo();
  const p = (await addProject({ name: 'awt-holders', path: repo })).find((x) => x.name === 'awt-holders');
  const longTitle = 'T'.repeat(60);
  const chats = [createThread({ title: longTitle }), ...Array.from({ length: 6 }, (_, i) => createThread({ title: `chat ${i}` }))];
  // 7 chats hold the 15 slots (3 + 2 + 2 + 2 + 2 + 2 + 2); rows are seeded directly — only the cap check reads them
  const per = [3, 2, 2, 2, 2, 2, 2];
  const ts = new Date().toISOString();
  chats.forEach((c, ci) => {
    for (let i = 0; i < per[ci]; i++) {
      prepare(`INSERT INTO ask_worktrees (id, thread_id, project_key, project_dir, ref, resolved_commit, run_id, worktree_dir, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'main', '', NULL, ?, ?, ?)`)
        .run(`wt_${ci}${i}000000`.slice(0, 11), c.id, p.key, repo, join(repo, `nope-${ci}-${i}`), ts, ts);
    }
  });
  const asker = createThread({ title: 'asker' });
  const err = await openAskWorktree({ threadId: asker.id, projectKey: p.key, ref: 'main' }).then(() => null, (e) => e);
  assert.ok(err instanceof AskWorktreeError);
  assert.match(err.message, /^global worktree cap reached \(15\)\. Held by: "T{39}…" \(3\), /);
  assert.match(err.message, /, … \(\+2 more chats\)\. Free slots in Settings › Chat › Chat checkouts \(safe ones are listed\), or remove one with remove_worktree in the chat that holds it\.$/);
  assert.equal((err.message.match(/\(\d\)/g) || []).length, 5);
  assert.equal(prepare('SELECT count(*) AS n FROM ask_worktrees').get().n, ASK_LIMITS.worktreesGlobal);   // nothing was removed
  // the per-thread message is unchanged; plain errors carry no code
  assert.equal(new AskWorktreeError('x').code, undefined);
  assert.equal(new AskWorktreeError('x', 'C', { a: 1 }).detail.a, 1);
  assert.equal(new AskWorktreeError('x').name, 'AskWorktreeError');
  prepare('DELETE FROM ask_worktrees').run();
});
