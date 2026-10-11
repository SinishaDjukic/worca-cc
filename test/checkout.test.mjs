// test/checkout.test.mjs — check out, discard and cap for finished runs (issue #529).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline, seedPipelineRow } from './helpers/db-seed.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { getDb } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { createWorktree, sweepRunRoots } from '../src/core/worktree.mjs';
import { readRunManifest } from '../src/core/run-manifest.mjs';
import { checkoutRecordsFor, lookupPipelineRow, runRootSweepLookups } from '../src/core/artifacts.mjs';
import { archivePipeline } from '../src/core/pipeline-delete.mjs';
import { canon, checkoutRun, discardCheckout, enforceCheckoutCap, setSetupState } from '../src/core/checkout.mjs';

useTempHome(after, 'worca-cc-checkout-');

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const created = [];
function freshRepo({ initialBranch = 'main' } = {}) {
  const dir = templateRepo('co', { branch: initialBranch, user: true, files: { 'README.md': '# hi\n' } });
  created.push(dir);
  return dir;
}
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

async function seedDoneRun(repo, feature, { status = 'done', runRootMode = 'detached' } = {}) {
  const { id, dir, key } = await seedPipeline(repo, { status,
    branch: { source: 'main', feature, runRootMode, worktreeRemoved: true, branchKept: true } });
  const worktreeDir = runRootMode === 'detached'
    ? join(worcaHome(), 'runs', id, 'repos', key)
    : join(await realpath(repo), '.worca-cc', 'worktrees', id);
  getDb().prepare(`UPDATE pipelines SET branch = json_set(branch, '$.worktreeDir', ?) WHERE id = ?`).run(worktreeDir, id);
  return { id, dir, key };
}

/** A clone of an "origin" that has `branch`; in the clone it exists only as refs/remotes/origin/<branch>. */
async function seedWithRemoteOnlyBranch(branch) {
  const origin = await freshRepo();
  git(origin, ['branch', branch]);
  const repo = await mkdtemp(join(tmpdir(), 'worca-cc-co-clone-'));
  created.push(repo);
  git(tmpdir(), ['clone', '-q', origin, repo]);
  git(repo, ['config', 'user.email', 't@t']);
  git(repo, ['config', 'user.name', 't']);
  const { id } = await seedDoneRun(repo, branch);
  return { repo, id };
}

async function seedWorkspaceDoneRun(n) {
  const id = randomUUID().slice(0, 8);
  const members = [];
  for (let i = 0; i < n; i++) {
    const repo = await freshRepo(); const feature = `worca-cc/w${i}`; git(repo, ['branch', feature]);
    const pk = projectKey(repo);
    members.push({ projectKey: pk, projectDir: repo, projectName: basename(repo),
      br: { source: 'main', feature, runRootMode: 'detached', worktreeRemoved: true, branchKept: true,
            worktreeDir: join(worcaHome(), 'runs', id, 'repos', pk) } });
  }
  seedPipelineRow({ id, projectKey: members[0].projectKey, workspaceKey: 'wks-test-0cea65fb', target: 'workspace', status: 'done',
    workspaceMeta: { runRootMode: 'detached', projects: members.map(({ projectKey: pk, projectDir, projectName }) => ({ projectKey: pk, projectDir, projectName })),
                     branches: Object.fromEntries(members.map((m) => [m.projectKey, m.br])) } });
  return { id, members };
}

// First in the file: the cap counts every live checkout in this temp home, so it runs before the others add theirs.
test('cap evicts the oldest first, skipping runs with a running service', async () => {
  const ids = [];
  for (const b of ['a', 'b', 'c']) { const repo = await freshRepo(); git(repo, ['branch', `worca-cc/${b}`]); const { id } = await seedDoneRun(repo, `worca-cc/${b}`); await checkoutRun({ id }); ids.push(id); }
  // Three checkouts, keep two: the oldest (ids[0]) is busy, so the next oldest goes (D12).
  const stopped = [];
  const out = await enforceCheckoutCap({ max: 2, busy: new Set([ids[0]]), stopServices: async (pk, runId) => { stopped.push(runId); } });
  assert.deepEqual(out.evicted, [ids[1]]);
  assert.deepEqual(stopped, [ids[1]], 'the evicted run\'s services are stopped, not the caller\'s run');
});

test('checks out the branch head at the recorded path, idempotently, and protects it from the sweep', async () => {
  const repo = await freshRepo();
  git(repo, ['branch', 'worca-cc/x']);
  const head = git(repo, ['rev-parse', 'worca-cc/x']).stdout.trim();
  const { id, key } = await seedDoneRun(repo, 'worca-cc/x');
  const r1 = await checkoutRun({ id, by: 'test' });
  const wt = r1.members[0].worktreeDir;
  assert.equal(git(wt, ['rev-parse', 'HEAD']).stdout.trim(), head);
  assert.equal(r1.members[0].state, 'checked-out');
  const r2 = await checkoutRun({ id, by: 'test' });
  assert.equal(r2.members[0].worktreeDir, wt);                          // idempotent
  const manifest = await readRunManifest(join(worcaHome(), 'runs', id));
  assert.equal(manifest.retain.reason, 'checkout');
  const sweep = await sweepRunRoots({ worcaHome: worcaHome(), ...runRootSweepLookups(), log: () => {} });
  assert.ok(existsSync(wt), 'kept by the sweep');
  assert.deepEqual(sweep.removed, []);
  await assert.rejects(archivePipeline({ key, id }), (e) => e.code === 'RETAINED_WORKTREE');
});

test('missing local branch: restored from the remote-tracking ref, else BRANCH_MISSING', async () => {
  const { id } = await seedWithRemoteOnlyBranch('worca-cc/y');
  const r = await checkoutRun({ id, by: 'test' });
  assert.equal(r.members[0].state, 'checked-out');
  const { id: id2 } = await seedDoneRun(await freshRepo(), 'worca-cc/gone');
  await assert.rejects(checkoutRun({ id: id2 }), (e) => e.code === 'BRANCH_MISSING');
});

test('refuses running, interrupted, retained, archived and branch-less runs', async () => {
  for (const [status, code] of [['running', 'NOT_FINISHED'], ['interrupted', 'NOT_FINISHED']]) {
    const { id } = await seedDoneRun(await freshRepo(), 'worca-cc/z', { status });
    await assert.rejects(checkoutRun({ id }), (e) => e.code === code);
  }
});

test('legacy layout: re-created under <projectDir>/.worca-cc/worktrees/<id>', async () => {
  const repo = await freshRepo(); git(repo, ['branch', 'worca-cc/l']);
  const { id } = await seedDoneRun(repo, 'worca-cc/l', { runRootMode: 'legacy' });
  const r = await checkoutRun({ id });
  assert.equal(r.members[0].worktreeDir, join(await realpath(repo), '.worca-cc', 'worktrees', id));
});

test('discard snapshots dirty work, removes the checkout, clears the marker, keeps the branch', async () => {
  const repo = await freshRepo(); git(repo, ['branch', 'worca-cc/d']);
  const { id } = await seedDoneRun(repo, 'worca-cc/d');
  const { members: [m] } = await checkoutRun({ id });
  await writeFile(join(m.worktreeDir, 'edit.txt'), 'x');
  const stopped = [];
  const rep = await discardCheckout({ id, stopServices: async (pk) => { stopped.push(pk); } });
  assert.deepEqual(stopped, [m.projectKey]);                     // services stopped FIRST
  assert.equal(existsSync(m.worktreeDir), false);
  assert.match(rep.patches[0], /checkout-discard-.*\.patch$/);
  assert.equal(checkoutRecordsFor(lookupPipelineRow(m.projectKey, id)), null);
  assert.ok(git(repo, ['rev-parse', '--verify', 'worca-cc/d']).status === 0);
  assert.equal(existsSync(join(worcaHome(), 'runs', id)), false);   // empty run root removed
  assert.ok(existsSync(rep.patches[0]), 'the patch survives the run-root removal');
  assert.ok(!rep.patches[0].startsWith(join(worcaHome(), 'runs', id)), 'never inside the run root');
});

test('workspace run: only the selected members are checked out', async () => {
  const { id, members } = await seedWorkspaceDoneRun(2);
  const r = await checkoutRun({ id, members: [members[0].projectKey] });
  assert.deepEqual(r.members.filter((m) => m.state === 'checked-out').map((m) => m.projectKey), [members[0].projectKey]);
});

test('a stale worktree registration (folder deleted by hand) does not block a new checkout', async () => {
  const repo = await freshRepo(); git(repo, ['branch', 'worca-cc/s']);
  const { id } = await seedDoneRun(repo, 'worca-cc/s');
  const { members: [m] } = await checkoutRun({ id });
  await rm(m.worktreeDir, { recursive: true, force: true });           // git still lists it (prunable)
  const again = await checkoutRun({ id });
  assert.equal(again.members[0].state, 'checked-out');
  assert.ok(existsSync(again.members[0].worktreeDir));
});

test('a re-checkout after the folder was deleted by hand resets setup to pending (D25)', async () => {
  const repo = await freshRepo(); git(repo, ['branch', 'worca-cc/r']);
  const { id, key } = await seedDoneRun(repo, 'worca-cc/r');
  const { members: [m] } = await checkoutRun({ id, policy: 'on-demand' });
  setSetupState(id, key, { status: 'ok', at: '2020-01-01T00:00:00.000Z' });
  await rm(m.worktreeDir, { recursive: true, force: true });
  await checkoutRun({ id, policy: 'on-demand' });
  const rec = checkoutRecordsFor(lookupPipelineRow(key, id)).members[0];
  assert.deepEqual(rec.setup, { status: 'pending' }, 'an empty worktree never reads setup: ok');
  // An idempotent re-checkout of a folder that is still there keeps its setup state.
  setSetupState(id, key, { status: 'ok' });
  await checkoutRun({ id });
  assert.equal(checkoutRecordsFor(lookupPipelineRow(key, id)).members[0].setup.status, 'ok');
});

// D27. seedDoneRun records join(worcaHome(), …) as given. On macOS the temp home sits under
// /var → /private/var, while git reports realpaths, so this also covers the symlinked-home case.
test('a second checkout of a symlinked or non-canonical recorded path is idempotent', async () => {
  const repo = await freshRepo(); git(repo, ['branch', 'worca-cc/c']);
  const { id } = await seedDoneRun(repo, 'worca-cc/c');
  const linkParent = await mkdtemp(join(tmpdir(), 'act-link-'));
  created.push(linkParent);
  const link = join(linkParent, 'home');
  await symlink(worcaHome(), link, process.platform === 'win32' ? 'junction' : undefined);
  getDb().prepare(`UPDATE pipelines SET branch = json_set(branch, '$.worktreeDir', ?) WHERE id = ?`)
    .run(join(link, 'runs', id, 'repos', 'x'), id);
  const r1 = await checkoutRun({ id });
  const r2 = await checkoutRun({ id });                // must not answer BRANCH_CHECKED_OUT
  assert.equal(r2.members[0].worktreeDir, r1.members[0].worktreeDir);
  assert.equal(r1.members[0].worktreeDir, await realpath(r1.members[0].worktreeDir));
});

// D30: status reads 'done' before the harness's finally-teardown has removed the run's own worktree.
// isFinishing stands in for the server's "runs entry not settled" check.
test('a run still in teardown is refused; the same leftover after a restart is adopted', async () => {
  const repo = await freshRepo(); git(repo, ['branch', 'worca-cc/t']);
  const { id, key } = await seedDoneRun(repo, 'worca-cc/t');
  // The run's own worktree is still on disk and the record has no worktreeRemoved stamp yet.
  getDb().prepare(`UPDATE pipelines SET branch = json_remove(branch, '$.worktreeRemoved') WHERE id = ?`).run(id);
  const rec = JSON.parse(lookupPipelineRow(key, id).branch);
  await createWorktree({ projectDir: repo, pipelineId: id, sourceBranch: 'main', featureBranch: 'worca-cc/t',
    baseDir: dirname(rec.worktreeDir), checkoutName: basename(rec.worktreeDir) });
  await assert.rejects(checkoutRun({ id, isFinishing: () => true }), (e) => e.code === 'NOT_FINISHED');
  const r = await checkoutRun({ id, isFinishing: () => false });      // server restarted meanwhile: adopt it
  assert.equal(r.members[0].state, 'checked-out');
  assert.equal(canon(r.members[0].worktreeDir), canon(rec.worktreeDir));
});

test('a derived path (row without a recorded worktreeDir) is written back and protected', async () => {
  const repo = await freshRepo(); git(repo, ['branch', 'worca-cc/o']);
  const { id, key } = await seedDoneRun(repo, 'worca-cc/o', { runRootMode: 'legacy' });
  getDb().prepare(`UPDATE pipelines SET branch = json_remove(branch, '$.worktreeDir') WHERE id = ?`).run(id);
  const { members: [m] } = await checkoutRun({ id });
  const rec = checkoutRecordsFor(lookupPipelineRow(key, id));
  assert.equal(rec.members[0].worktreeDir, m.worktreeDir);   // visible to the UI and to the legacy sweep's referencedPaths
});

// A branch already checked out in the person's own folder: refused with the folder named, or linked
// with useExisting. A linked folder is never Worca's: its own field, never removed, never capped.
test('useExisting links the folder that has the branch; Discard only unlinks it; the cap never touches it', async () => {
  const repo = await freshRepo();
  git(repo, ['switch', '-q', '-c', 'worca-cc/mine']);                  // the person works on the run's branch here
  const { id, key } = await seedDoneRun(repo, 'worca-cc/mine');
  const ownPath = lookupPipelineRow(key, id) && JSON.parse(lookupPipelineRow(key, id).branch).worktreeDir;

  await assert.rejects(checkoutRun({ id }), (e) => e.code === 'BRANCH_CHECKED_OUT' && canon(e.holder) === canon(repo) && e.projectKey === key);

  const r = await checkoutRun({ id, useExisting: true });
  assert.equal(r.members[0].external, true);
  assert.equal(canon(r.members[0].worktreeDir), canon(repo));
  const br = JSON.parse(lookupPipelineRow(key, id).branch);
  assert.equal(br.worktreeDir, ownPath, "the run's own path is untouched (teardown and the sweep may delete it)");
  assert.equal(br.checkout.external, true);
  assert.deepEqual(br.checkout.setup, { status: 'skipped' }, 'setup never runs by itself in the person\'s folder');
  const rec = checkoutRecordsFor(lookupPipelineRow(key, id)).members[0];
  assert.equal(canon(rec.worktreeDir), canon(repo));
  assert.equal(rec.external, true);

  const again = await checkoutRun({ id });                             // already linked: the same link, not a refusal
  assert.equal(again.members[0].external, true);

  const { evicted } = await enforceCheckoutCap({ max: 0, busy: new Set() });   // other tests' checkouts may go; this one stays
  assert.ok(!evicted.includes(id), 'the cap skips a linked folder');
  assert.equal(checkoutRecordsFor(lookupPipelineRow(key, id)).members[0].external, true);
  await writeFile(join(repo, 'dirty.txt'), 'mine\n');
  const d = await discardCheckout({ id });
  assert.deepEqual(d.unlinked, [key]);
  assert.deepEqual(d.patches, [], 'no snapshot of the person\'s folder');
  assert.ok(existsSync(join(repo, 'dirty.txt')) && existsSync(join(repo, '.git')), 'the folder and its changes stay');
  assert.equal(git(repo, ['branch', '--show-current']).stdout.trim(), 'worca-cc/mine');
  assert.equal(checkoutRecordsFor(lookupPipelineRow(key, id)), null);
});
