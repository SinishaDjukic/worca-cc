// test/pipeline-delete.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, chmod, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { deletePipeline, discardRetainedWorktrees } from '../src/core/pipeline-delete.mjs';
import {
  recordArtifact, listArtifacts, writeStoreMeta, readPipelineByKey, retainedWorkFor, runDirForRow,
} from '../src/core/artifacts.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import {
  listLocalBranches, createWorktree, sweepRunRoots, snapshotWorktreePatch,
} from '../src/core/worktree.mjs';
import { writeRunManifest, updateRunManifest } from '../src/core/run-manifest.mjs';
import { deleteWorkspace } from '../src/core/workspaces.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';

const created = [];
after(() => {
  _resetForTests();
  return Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});

// A real git repo so branch/worktree teardown is exercised for real.
async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-del-repo-'));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}

// A store key dir with one pipeline + its plan/review files, plus a sibling that
// must survive (proves the index-based deleter only ever unlinks the EXACT
// recorded files). The pipeline dir is named exactly like the real one:
// <datePrefix>-<base>-<id>. The plan/review md live on the FS (still markdown);
// the durable record is the DB pipelines row + the artifacts index pointing at
// those store-root-relative paths.
async function freshStore(repoDir, { id, base, datePrefix, status, branch, title }) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-del-store-'));
  created.push(home);
  _resetForTests(); process.env.WORCA_HOME = home;           // DB opens under this home
  const key = 'proj-00000001';
  const root = join(home, '.worca-cc', 'store', key);
  const pdir = join(root, 'pipelines', `${datePrefix}-${base}-${id}`);
  await mkdir(join(pdir, 'extras'), { recursive: true });
  await writeFile(join(pdir, 'prompt.md'), `# ${title ?? 'Add login screen'}\n`, 'utf8');
  await mkdir(join(root, 'plans'), { recursive: true });
  await mkdir(join(root, 'reviews'), { recursive: true });
  await writeFile(join(root, 'plans', `${datePrefix}-${base}.md`), '# plan', 'utf8');
  await writeFile(join(root, 'plans', `${datePrefix}-${base}-v2.md`), '# plan v2', 'utf8');
  await writeFile(join(root, 'reviews', `${datePrefix}-${base}-impl-review.md`), '# r', 'utf8');
  await writeFile(join(root, 'reviews', `${datePrefix}-${base}-plan-review.md`), '# r', 'utf8');
  await writeFile(join(root, 'plans', `${datePrefix}-${base}-extra.md`), '# keep', 'utf8'); // NOT indexed -> survives
  // DB: the project store_meta (so rowToState reconstructs state.projectDir, the
  // teardown repo), the pipeline row, and the indexed artifacts (store-root-relative
  // for plan/review). Mirrors what createPipeline's ensureMeta + INSERT persist.
  writeStoreMeta(key, 'project', { key, name: 'Proj', path: repoDir });
  seedPipelineRow({ id, projectKey: key, title: title ?? 'Add login screen', status,
    baseName: base, datePrefix,
    branch: branch === undefined ? null : branch });
  recordArtifact(id, 'plan', `plans/${datePrefix}-${base}.md`);
  recordArtifact(id, 'plan', `plans/${datePrefix}-${base}-v2.md`);
  recordArtifact(id, 'review', `reviews/${datePrefix}-${base}-impl-review.md`);
  recordArtifact(id, 'review', `reviews/${datePrefix}-${base}-plan-review.md`);
  return { home, key, root, pdir };
}

// A workspace store dir (store/workspaces/<wkey>/) with one pipeline whose
// workspaceMeta.branches is the per-project map. `members` is [{ projectDir, branch }].
// The ws row stores branches/projects in the workspace_meta JSON column; the
// reconstructed state.branches/state.projects drive the per-member teardown.
async function freshWorkspaceStore({ wkey, id, base, datePrefix, status, title, members }) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-del-ws-'));
  created.push(home);
  _resetForTests(); process.env.WORCA_HOME = home;           // DB opens under this home
  const root = join(home, '.worca-cc', 'store', 'workspaces', wkey);
  const pdir = join(root, 'pipelines', `${datePrefix}-${base}-${id}`);
  await mkdir(pdir, { recursive: true });
  const branches = {};
  const projects = [];
  for (let i = 0; i < members.length; i++) {
    const pk = `member-0000000${i + 1}`;
    projects.push({ projectKey: pk, projectDir: members[i].projectDir, projectName: `m${i}` });
    branches[pk] = members[i].branch; // { source, feature, worktreeDir, reusedExisting }
  }
  await writeFile(join(pdir, 'prompt.md'), `# ${title ?? 'Add login screen'}\n`, 'utf8');
  await mkdir(join(root, 'plans'), { recursive: true });
  await mkdir(join(root, 'reviews'), { recursive: true });
  await writeFile(join(root, 'plans', `${datePrefix}-${base}.md`), '# plan', 'utf8');
  await writeFile(join(root, 'reviews', `${datePrefix}-${base}-impl-review.md`), '# r', 'utf8');
  await writeFile(join(root, 'plans', `${datePrefix}-${base}-extra.md`), '# keep', 'utf8'); // NOT indexed -> survives
  // DB: ws pipeline row (workspace_meta carries branches/projects) + indexed md.
  seedPipelineRow({
    id, projectKey: 'ws-primary-00000001', workspaceKey: wkey, target: 'workspace',
    title: title ?? 'Add login screen', status, baseName: base, datePrefix,
    workspaceMeta: { workspaceId: wkey, workspaceName: 'demo', projectKeys: projects.map((p) => p.projectKey), projects, branches },
  });
  recordArtifact(id, 'plan', `plans/${datePrefix}-${base}.md`);
  recordArtifact(id, 'review', `reviews/${datePrefix}-${base}-impl-review.md`);
  return { home, root, pdir };
}

test('deletePipeline removes dir, indexed plan/review files, local branch; keeps non-indexed siblings + remote', async () => {
  const repo = await freshRepo();
  // Real worktree + feature branch off main.
  const { worktreeDir, branch } = await createWorktree({
    projectDir: repo, pipelineId: 'abc123', sourceBranch: 'main',
    featureBranch: 'worca-cc/add-login-screen-abc123',
  });
  const prev = process.env.WORCA_HOME;
  const { root, pdir } = await freshStore(repo, {
    id: 'abc123', base: 'add-login-screen', datePrefix: '04-06-26', status: 'done',
    title: 'Add login screen', branch: { source: 'main', feature: branch, worktreeDir },
  });
  try {
    const report = await deletePipeline({ key: 'proj-00000001', id: 'abc123' });
    assert.ok(report && report.ok);
    assert.equal(existsSync(pdir), false, 'pipeline dir removed');
    const plans = await readdir(join(root, 'plans'));
    assert.deepEqual(plans.sort(), ['04-06-26-add-login-screen-extra.md'], 'only the non-indexed sibling survives');
    const reviews = await readdir(join(root, 'reviews'));
    assert.equal(reviews.length, 0, 'both indexed review md removed');
    assert.equal(existsSync(worktreeDir), false, 'worktree gone');
    assert.ok(!(await listLocalBranches(repo)).includes(branch), 'local branch deleted');
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('discardRetainedWorktrees snapshots untracked work, removes only the checkout, and clears retention', async () => {
  const repo = await freshRepo();
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'retain11', sourceBranch: 'main',
    featureBranch: 'worca-cc/retain11',
  });
  await writeFile(join(wt.worktreeDir, 'agent-new.txt'), 'uncommitted agent work\n');
  const prev = process.env.WORCA_HOME;
  const { pdir } = await freshStore(repo, {
    id: 'retain11', base: 'retained-work', datePrefix: '04-06-26', status: 'done',
    branch: {
      source: 'main', feature: wt.branch, worktreeDir: wt.worktreeDir,
      worktreeRemoved: false, branchKept: true,
      commitFailed: { code: 'commit_failed', step: 'commit', message: 'hook failed', at: new Date().toISOString() },
    },
  });
  try {
    getDb().prepare('UPDATE pipelines SET resume_point = ? WHERE id = ?')
      .run(JSON.stringify({ version: 1 }), 'retain11');
    const before = getDb().prepare('SELECT updated_at, resume_point FROM pipelines WHERE id = ?').get('retain11');
    const report = await discardRetainedWorktrees({ key: 'proj-00000001', id: 'retain11' });
    assert.equal(report.discarded, true);
    assert.equal(existsSync(wt.worktreeDir), false, 'retained checkout reclaimed');
    assert.ok((await listLocalBranches(repo)).includes(wt.branch), 'feature branch is kept');
    assert.ok(existsSync(pdir), 'pipeline history directory is kept');
    assert.equal(report.patches.length, 1);
    const patch = await readFile(report.patches[0], 'utf8');
    assert.match(patch, /agent-new\.txt/, 'the patch includes formerly-untracked work');
    assert.match(patch, /uncommitted agent work/);
    const saved = await readPipelineByKey('proj-00000001', 'retain11');
    assert.equal(saved.state.branch.commitFailed, undefined);
    assert.equal(saved.state.branch.worktreeRemoved, true);
    assert.ok((await listArtifacts('retain11')).some((a) => a.kind === 'retained-work-patch'));
    assert.equal(report.remaining, 0, 'nothing left retained after a full discard');
    const afterRow = getDb().prepare('SELECT updated_at, resume_point FROM pipelines WHERE id = ?').get('retain11');
    assert.equal(afterRow.updated_at, before.updated_at, 'discard must not restamp updated_at (stats proxy)');
    assert.equal(afterRow.resume_point, before.resume_point, 'discard must not clobber resume_point');
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('discardRetainedWorktrees snapshots every retained workspace member before reclaiming either checkout', async () => {
  const repoA = await freshRepo();
  const repoB = await freshRepo();
  const wtA = await createWorktree({ projectDir: repoA, pipelineId: 'retainws', sourceBranch: 'main', featureBranch: 'worca-cc/retainws-a' });
  const wtB = await createWorktree({ projectDir: repoB, pipelineId: 'retainws', sourceBranch: 'main', featureBranch: 'worca-cc/retainws-b' });
  await writeFile(join(wtA.worktreeDir, 'a.txt'), 'workspace A\n');
  await writeFile(join(wtB.worktreeDir, 'b.txt'), 'workspace B\n');
  const prev = process.env.WORCA_HOME;
  const failure = (message) => ({ code: 'commit_failed', step: 'commit', message, at: new Date().toISOString() });
  const { pdir } = await freshWorkspaceStore({
    wkey: 'wks-retain', id: 'retainws', base: 'retained-workspace', datePrefix: '04-06-26', status: 'done',
    members: [
      { projectDir: repoA, branch: { source: 'main', feature: wtA.branch, worktreeDir: wtA.worktreeDir, commitFailed: failure('A hook failed') } },
      { projectDir: repoB, branch: { source: 'main', feature: wtB.branch, worktreeDir: wtB.worktreeDir, commitFailed: failure('B hook failed') } },
    ],
  });
  try {
    const report = await discardRetainedWorktrees({ workspaceKey: 'wks-retain', id: 'retainws' });
    assert.equal(report.discarded, true);
    assert.equal(report.worktrees.length, 2);
    assert.equal(report.patches.length, 2, 'one independently applicable patch per repository');
    assert.equal(existsSync(wtA.worktreeDir), false);
    assert.equal(existsSync(wtB.worktreeDir), false);
    assert.ok((await listLocalBranches(repoA)).includes(wtA.branch));
    assert.ok((await listLocalBranches(repoB)).includes(wtB.branch));
    assert.match(await readFile(report.patches[0], 'utf8'), /workspace [AB]/);
    assert.match(await readFile(report.patches[1], 'utf8'), /workspace [AB]/);
    assert.ok(existsSync(pdir), 'workspace history survives');
    const saved = await readPipelineByKey('workspaces/wks-retain', 'retainws');
    assert.ok(Object.values(saved.state.branches).every((br) => br.commitFailed === undefined));
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('deletePipeline needs no title/slug heuristic: indexed files are removed even when title equals the dir basename', async () => {
  // The OLD hard case for the name-pattern deleter: no usable title (it equals the
  // auto dir basename), so deriveNames had to fall back to the dir slug / prompt.
  // The index-based deleter unlinks the EXACT recorded rel_paths regardless of title.
  const repo = await freshRepo();
  const prev = process.env.WORCA_HOME;
  const { root, pdir } = await freshStore(repo, {
    id: 'zz', base: 'rename-widget', datePrefix: '04-06-26', status: 'done',
    title: '04-06-26-rename-widget-zz', branch: null,
  });
  try {
    const report = await deletePipeline({ key: 'proj-00000001', id: 'zz' });
    assert.ok(report && report.ok);
    assert.equal(existsSync(pdir), false, 'pipeline dir removed');
    const plans = await readdir(join(root, 'plans'));
    assert.deepEqual(plans.sort(), ['04-06-26-rename-widget-extra.md'], 'indexed v1+v2 removed, non-indexed sibling kept');
    const reviews = await readdir(join(root, 'reviews'));
    assert.equal(reviews.length, 0, 'indexed review md removed');
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('deletePipeline refuses an active pipeline (running/pausing; status from the DB row)', async () => {
  const repo = await freshRepo();
  const prev = process.env.WORCA_HOME;
  try {
    for (const status of ['running', 'pausing']) {
      await freshStore(repo, {
        id: 'run1', base: 'add-login-screen', datePrefix: '04-06-26', status, branch: null,
      });
      await assert.rejects(() => deletePipeline({ key: 'proj-00000001', id: 'run1' }),
        (e) => e && e.code === 'RUNNING', `status=${status} must refuse deletion`);
    }
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('deletePipeline returns null for an unknown id', async () => {
  const repo = await freshRepo();
  const prev = process.env.WORCA_HOME;
  await freshStore(repo, {
    id: 'x', base: 'add-login-screen', datePrefix: '04-06-26', status: 'done', branch: null,
  });
  try {
    assert.equal(await deletePipeline({ key: 'proj-00000001', id: 'nope' }), null);
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('deletePipeline({workspaceKey}) removes the ws-store dir + iterates state.branches per project', async () => {
  // Two real repos, each with its own worktree + feature branch, recorded in the
  // per-project workspace_meta.branches map. Delete must clean BOTH and remove the
  // ws dir + the indexed ws-store markdown.
  const repoA = await freshRepo();
  const repoB = await freshRepo();
  const wtA = await createWorktree({
    projectDir: repoA, pipelineId: 'ws01', sourceBranch: 'main',
    featureBranch: 'worca-cc/add-login-screen-ws01',
  });
  const wtB = await createWorktree({
    projectDir: repoB, pipelineId: 'ws01', sourceBranch: 'main',
    featureBranch: 'worca-cc/add-login-screen-ws01',
  });
  const prev = process.env.WORCA_HOME;
  const wkey = 'wks-demo-9f3a1c20';
  const { root, pdir } = await freshWorkspaceStore({
    wkey, id: 'ws01', base: 'add-login-screen', datePrefix: '04-06-26', status: 'done',
    title: 'Add login screen',
    members: [
      { projectDir: repoA, branch: { source: 'main', feature: wtA.branch, worktreeDir: wtA.worktreeDir, reusedExisting: false } },
      { projectDir: repoB, branch: { source: 'main', feature: wtB.branch, worktreeDir: wtB.worktreeDir, reusedExisting: false } },
    ],
  });
  try {
    const report = await deletePipeline({ workspaceKey: wkey, id: 'ws01' });
    assert.ok(report && report.ok);
    assert.equal(existsSync(pdir), false, 'workspace pipeline dir removed');
    // Indexed plan/review markdown in the WORKSPACE store removed (sibling kept).
    const plans = await readdir(join(root, 'plans'));
    assert.deepEqual(plans.sort(), ['04-06-26-add-login-screen-extra.md'], 'only the non-indexed sibling survives');
    const reviews = await readdir(join(root, 'reviews'));
    assert.equal(reviews.length, 0, 'indexed review md removed');
    // BOTH per-project worktrees + branches cleaned.
    assert.equal(existsSync(wtA.worktreeDir), false, 'member A worktree gone');
    assert.equal(existsSync(wtB.worktreeDir), false, 'member B worktree gone');
    assert.ok(!(await listLocalBranches(repoA)).includes(wtA.branch), 'member A branch deleted');
    assert.ok(!(await listLocalBranches(repoB)).includes(wtB.branch), 'member B branch deleted');
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('deletePipeline({workspaceKey}) refuses a running workspace pipeline', async () => {
  const repoA = await freshRepo();
  const repoB = await freshRepo();
  const prev = process.env.WORCA_HOME;
  const wkey = 'wks-demo-9f3a1c20';
  await freshWorkspaceStore({
    wkey, id: 'wsrun', base: 'add-login-screen', datePrefix: '04-06-26', status: 'running',
    members: [
      { projectDir: repoA, branch: null },
      { projectDir: repoB, branch: null },
    ],
  });
  try {
    await assert.rejects(() => deletePipeline({ workspaceKey: wkey, id: 'wsrun' }),
      (e) => e && e.code === 'RUNNING');
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('deletePipeline({workspaceKey}) returns null for an unknown workspace id', async () => {
  const repoA = await freshRepo();
  const repoB = await freshRepo();
  const prev = process.env.WORCA_HOME;
  const wkey = 'wks-demo-9f3a1c20';
  await freshWorkspaceStore({
    wkey, id: 'present', base: 'add-login-screen', datePrefix: '04-06-26', status: 'done',
    members: [
      { projectDir: repoA, branch: null },
      { projectDir: repoB, branch: null },
    ],
  });
  try {
    assert.equal(await deletePipeline({ workspaceKey: wkey, id: 'nope' }), null);
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('artifact index rows are cleaned on archive; the pipelines row survives', async () => {
  const repo = await freshRepo();
  const prev = process.env.WORCA_HOME;
  await freshStore(repo, {
    id: 'cas1', base: 'add-login-screen', datePrefix: '04-06-26', status: 'done', branch: null,
  });
  try {
    assert.equal((await listArtifacts('cas1')).length, 4, 'artifacts indexed before archive');
    const report = await deletePipeline({ key: 'proj-00000001', id: 'cas1' });
    assert.ok(report && report.ok);
    // No FK cascade fires any more (the row is UPDATEd, not DELETEd) — the archive
    // deletes the artifacts index explicitly, because its files were just unlinked.
    assert.equal((await listArtifacts('cas1')).length, 0, 'artifacts index cleared explicitly');
    // Inverted expectation: archive is a SOFT delete. The row is the permanent
    // statistical record of the run, so it must outlive its files.
    const row = getDb().prepare('SELECT archived_at FROM pipelines WHERE id = ?').get('cas1');
    assert.ok(row, 'pipelines row survives the archive');
    assert.ok(row.archived_at, 'archived_at is stamped');
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

// ── Phase 1: the detached run root is removed too (§8.13 guards) ──────────────
// Without this, archiving a paused or interrupted detached run from the UI would
// leave the generated CLAUDE.md, mcp.json, run.json, the workspace skill mount and
// the emptied repos/ shell on disk permanently — nothing else ever reclaims a run
// root, and the archived row keeps pointing at it.

test('deleting a PAUSED detached run removes <worcaHome>/runs/<id>; a later sweep finds nothing', async () => {
  const repo = await freshRepo();
  const prev = process.env.WORCA_HOME;
  const { home } = await freshStore(repo, {
    id: 'det00001', base: 'add-login-screen', datePrefix: '04-06-26', status: 'paused',
    branch: null,
  });
  try {
    // A realistic detached run root: repos/<key> holding a live checkout, plus the
    // generated files a completed run would have left had it not been paused.
    const runRoot = join(home, '.worca-cc', 'runs', 'det00001');
    const wt = await createWorktree({
      projectDir: repo, pipelineId: 'det00001', sourceBranch: 'main',
      featureBranch: 'worca-cc/add-login-screen-det00001',
      baseDir: join(runRoot, 'repos'), checkoutName: 'proj-00000001',
    });
    await writeFile(join(runRoot, 'CLAUDE.md'), '# generated\n');
    await writeFile(join(runRoot, 'mcp.json'), '{}\n');
    await writeFile(join(runRoot, 'run.json'), JSON.stringify({
      pipelineId: 'det00001', runRootMode: 'detached', isWorkspace: false,
      members: [{ projectKey: 'proj-00000001', projectDir: repo, worktreeDir: wt.worktreeDir }],
    }));
    // Re-point the row's branch column at the run-root checkout so the existing
    // per-member cleanup has something to do, exactly as a real run would.
    getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(
      JSON.stringify({ source: 'main', feature: wt.branch, worktreeDir: wt.worktreeDir, runRootMode: 'detached' }),
      'det00001',
    );
    assert.ok(existsSync(runRoot), 'precondition: the run root exists');

    const report = await deletePipeline({ key: 'proj-00000001', id: 'det00001' });
    assert.ok(report && report.ok);
    assert.equal(report.runRoot, runRoot, 'the report names the removed run root');
    assert.equal(existsSync(runRoot), false, 'the whole run root is gone');
    assert.equal(existsSync(wt.worktreeDir), false, 'the member checkout with it');

    // The sweep now has nothing to do: no row-less run root is left to quarantine.
    const res = await sweepRunRoots({
      worcaHome: join(home, '.worca-cc'), statusOf: () => null, log: () => {},
    });
    assert.deepEqual(res, { keep: [], removed: [], quarantined: [], failed: [], warnings: [] },
      'a subsequent sweep finds nothing to quarantine');
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('deleting a LEGACY run touches no run root (there is none) and still succeeds', async () => {
  const repo = await freshRepo();
  const prev = process.env.WORCA_HOME;
  const { home, pdir } = await freshStore(repo, {
    id: 'leg00001', base: 'add-login-screen', datePrefix: '04-06-26', status: 'done',
    branch: null,
  });
  try {
    // A sibling run root belonging to a DIFFERENT pipeline must survive untouched
    // (the §8.13 basename guard is what makes that true).
    const other = join(home, '.worca-cc', 'runs', 'other001');
    await mkdir(other, { recursive: true });
    await writeFile(join(other, 'run.json'), '{"pipelineId":"other001"}');
    const report = await deletePipeline({ key: 'proj-00000001', id: 'leg00001' });
    assert.ok(report && report.ok);
    assert.equal(report.runRoot, null, 'no run root was reported for a legacy run');
    assert.equal(existsSync(pdir), false, 'the pipeline dir is still removed');
    assert.ok(existsSync(other), "another pipeline's run root is untouched");
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('snapshotWorktreePatch writes the patch to the given file (no in-memory string)', async () => {
  const repo = await freshRepo();
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'snapfile1', sourceBranch: 'main', featureBranch: 'worca-cc/snapfile1',
  });
  await writeFile(join(wt.worktreeDir, 'x.bin'), 'binary-ish\n');
  const out = join(tmpdir(), `worca-snap-${Date.now()}.patch`);
  const res = await snapshotWorktreePatch(wt.worktreeDir, out);
  assert.equal(res.ok, true);
  assert.equal(res.file, out);
  assert.ok(res.bytes > 0);
  assert.match(await readFile(out, 'utf8'), /x\.bin/);
  assert.equal(existsSync(`${out}.part`), false, 'no temp file left behind');
  await rm(out, { force: true });
});

test('snapshotWorktreePatch on a clean tree is success with no file (discard-after-manual-commit must not fail)', async () => {
  const repo = await freshRepo();
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'snapclean1', sourceBranch: 'main', featureBranch: 'worca-cc/snapclean1',
  });
  const out = join(tmpdir(), `worca-snap-clean-${Date.now()}.patch`);
  const res = await snapshotWorktreePatch(wt.worktreeDir, out);
  assert.equal(res.ok, true);
  assert.equal(res.file, null);
  assert.equal(existsSync(out), false, 'no 0-byte patch is left behind');
});

test('discard reports the truth when a checkout survives removal (and keeps its stamp + run root)', async () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return; // chmod is inert under root
  const repo = await freshRepo();
  const prev = process.env.WORCA_HOME;
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'retainkeep', sourceBranch: 'main', featureBranch: 'worca-cc/retainkeep',
  });
  await writeFile(join(wt.worktreeDir, 'kept.txt'), 'uncommitted\n');
  await freshStore(repo, {
    id: 'retainkp1', base: 'retain-keep', datePrefix: '04-06-26', status: 'done',
    branch: {
      source: 'main', feature: wt.branch, worktreeDir: wt.worktreeDir,
      commitFailed: { code: 'commit_failed', step: 'commit', message: 'hook', at: new Date().toISOString() },
    },
  });
  const runRoot = join(worcaHome(), 'runs', 'retainkp1');
  await mkdir(runRoot, { recursive: true });
  // Make removal fail while the snapshot still works: the worktree DIR is made
  // read-only, so `git add -A` / `git diff` still READ it (the index lives in the
  // main repo's .git), but neither `git worktree remove --force` nor the rm
  // backstop can unlink its contents. (Assumes a non-root test user, like the
  // rest of the suite.)
  await chmod(wt.worktreeDir, 0o555);
  try {
    // freshStore hardcodes store key 'proj-00000001' (NOT projectKey(repo)), so
    // the discard must address the row by key — projectDir would miss it.
    const report = await discardRetainedWorktrees({ key: 'proj-00000001', id: 'retainkp1' });
    assert.equal(report.remaining, 1, 'the surviving checkout is counted');
    assert.equal(report.discarded, false, 'discarded must not claim success');
    assert.ok(report.warnings.some((w) => /worktree still exists/.test(w)));
    assert.ok(existsSync(runRoot), 'the run root is kept while a checkout survives');
    const row = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get('retainkp1');
    assert.ok(retainedWorkFor(row), 'the DB retention stamp survives a failed removal');
  } finally {
    await chmod(wt.worktreeDir, 0o755);
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('discard honors a manifest-only retention (DB stamp lost in the F2 crash window)', async () => {
  const repo = await freshRepo();
  const prev = process.env.WORCA_HOME;
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'manifonly', sourceBranch: 'main', featureBranch: 'worca-cc/manifonly',
  });
  await writeFile(join(wt.worktreeDir, 'm.txt'), 'kept\n');
  await freshStore(repo, { id: 'manifly01', base: 'manif-only', datePrefix: '04-06-26', status: 'error' });
  const runRoot = join(worcaHome(), 'runs', 'manifly01');
  await mkdir(runRoot, { recursive: true });
  await writeRunManifest(runRoot, { pipelineId: 'manifly01', runRootMode: 'detached', isWorkspace: false, members: [] });
  await updateRunManifest(runRoot, {
    retain: { reason: 'commit_failed', members: [{ projectKey: null, worktreeDir: wt.worktreeDir, branch: wt.branch }] },
  });
  try {
    // Address by store key: freshStore hardcodes 'proj-00000001' (see Task 9).
    const report = await discardRetainedWorktrees({ key: 'proj-00000001', id: 'manifly01' });
    assert.equal(report.discarded, true, 'manifest-only retention is discardable, not a permanent wedge');
    assert.equal(existsSync(wt.worktreeDir), false, 'the checkout is reclaimed');
    assert.equal(report.patches.length, 1, 'a recovery patch was saved first');
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('runDirForRow matches the archive resolver: case-insensitive -<id> suffix', async () => {
  const prev = process.env.WORCA_HOME;
  try {
    await freshStore(await freshRepo(), {
      id: 'casemix', base: 'x', datePrefix: '04-06-26', status: 'done',
    });
    // Rename the run dir to an upper-cased suffix the current readdir fallback misses.
    const pipelinesDir = join(process.env.WORCA_HOME, '.worca-cc', 'store', 'proj-00000001', 'pipelines');
    const [dir] = (await readdir(pipelinesDir)).filter((d) => d.endsWith('-casemix'));
    await rename(join(pipelinesDir, dir), join(pipelinesDir, dir.toUpperCase()));
    const row = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get('casemix');
    const resolved = await runDirForRow(row);
    assert.match(resolved, /-CASEMIX$/, 'resolves case-insensitively, like findRunDir');
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('deleteWorkspace refuses while a member pipeline has retained uncommitted work', async () => {
  const WKEY = 'wks-retain-0000abcd'; // MUST satisfy WORKSPACE_KEY_RE (8-hex tail)
  const repoA = await freshRepo();
  const wtA = await createWorktree({ projectDir: repoA, pipelineId: 'retainwd', sourceBranch: 'main', featureBranch: 'worca-cc/retainwd-a' });
  await writeFile(join(wtA.worktreeDir, 'a.txt'), 'kept\n');
  const prev = process.env.WORCA_HOME;
  await freshWorkspaceStore({
    wkey: WKEY, id: 'retainwd', base: 'retained-del', datePrefix: '04-06-26', status: 'done',
    members: [{ projectDir: repoA, branch: { source: 'main', feature: wtA.branch, worktreeDir: wtA.worktreeDir, commitFailed: { code: 'commit_failed', step: 'commit', message: 'hook', at: new Date().toISOString() } } }],
  });
  // freshWorkspaceStore seeds only the pipelines row; deleteWorkspace's
  // membership-first check needs the registry row too. Insert AFTER
  // freshWorkspaceStore (its _resetForTests() wipes anything earlier).
  const now = new Date().toISOString();
  getDb().prepare('INSERT INTO workspaces (id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(WKEY, 'Retain Del WS', '', now, now);
  try {
    await assert.rejects(() => deleteWorkspace(WKEY), (e) => e.code === 'RETAINED_WORKTREE');
    await discardRetainedWorktrees({ workspaceKey: WKEY, id: 'retainwd' });
    const after = await deleteWorkspace(WKEY);
    assert.equal(after.ok, true, 'delete succeeds once the retention is resolved');
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});
