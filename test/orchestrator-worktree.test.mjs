// test/orchestrator-worktree.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';

import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { projectKey } from '../src/core/store.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { posix } from './helpers/posix-path.mjs';
import { checkRows } from './helpers/rows.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { stopAt, afterStarts } from './helpers/engines.mjs';

useTempHome(after); // store writes -> isolated temp home, not real ~/.worca-cc

// §6 mode-pinning rule: this file is the LEGACY single-project contract guard —
// in-project worktree placement, C1/C2 lifecycle, verbatim branch semantics
// (§10 rollback contract). Pinned explicitly since the Phase-5 default flip;
// the detached-mode siblings live in test/run-root-layout.test.mjs and
// test/orchestrator-workspace.test.mjs.
const prevRunRootMode = process.env.WORCA_RUN_ROOT;
process.env.WORCA_RUN_ROOT = 'legacy';
after(() => {
  if (prevRunRootMode === undefined) delete process.env.WORCA_RUN_ROOT;
  else process.env.WORCA_RUN_ROOT = prevRunRootMode;
});

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

async function freshRepo() {
  const dir = templateRepo('orch', { branch: 'main', user: true, files: { 'seed.txt': 'seed\n' } });
  created.push(dir);
  return dir;
}

test('legacy single-project run: worktree off main with derived worca-cc/ branch, agent work committed to the kept branch, worktree removed, no workspace discriminators', async () => {
  // One legacy single-project run serves four former tests (one row each), among them
  // orchestrator-workspace.test.mjs's single-project back-compat guard (same run, same pin).
  const repo = await freshRepo();
  const mainSha = spawnSync('git', ['-C', repo, 'rev-parse', 'main']).stdout.toString().trim();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'Add login flow', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  // Simulate an agent editing a file inside the worktree as soon as it exists.
  let injected = false;
  orch.on('state', (s) => {
    if (!injected && s.branch && s.branch.worktreeDir && existsSync(s.branch.worktreeDir)) {
      injected = true;
      writeFileSync(join(s.branch.worktreeDir, 'agent-output.txt'), 'work from the agent\n');
    }
  });
  const result = await orch.run();
  assert.equal(result.status, 'done', JSON.stringify(result));

  await checkRows([
    { name: 'orchestrator creates a worktree on source branch with a derived feature branch', run: () => {
      const wtBase = join(repo, '.worca-cc', 'worktrees');
      assert.ok(existsSync(wtBase), 'worktrees base dir should exist');

      const state = orch.getState();
      assert.ok(state.branch, 'state.branch should be set');
      assert.equal(state.branch.source, 'main');
      assert.match(state.branch.feature, /^worca-cc\//);
      assert.match(posix(state.branch.worktreeDir), /\.worca-cc\/worktrees\//);
      assert.equal(state.branch.reusedExisting, false);

      // The plan/review name linkage is persisted so a later delete is exact.
      assert.equal(typeof state.baseName, 'string');
      assert.match(state.datePrefix, /^\d{2}-\d{2}-\d{2}$/);

      const head = spawnSync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD']);
      assert.equal(head.stdout.toString().trim(), 'main');
    } },
    { name: 'C1: on done the worktree dir is removed but the feature branch is kept', run: () => {
      const feature = orch.getState().branch.feature;
      const wtDir = orch.getState().branch.worktreeDir;
      assert.ok(!existsSync(wtDir), `worktree dir should be removed, still present: ${wtDir}`);
      assert.ok(branchList(repo).includes(feature), `feature branch ${feature} should be KEPT on success`);
    } },
    { name: 'on done the agent work is COMMITTED to the kept feature branch', run: () => {
      assert.ok(injected, 'precondition: a file was injected into the worktree');
      const feature = orch.getState().branch.feature;

      // The kept branch must have advanced past main and contain the agent's file.
      const featSha = spawnSync('git', ['-C', repo, 'rev-parse', feature]).stdout.toString().trim();
      assert.notEqual(featSha, mainSha, 'feature branch should carry a new commit, not still equal main');
      const fileInCommit = spawnSync('git', ['-C', repo, 'show', `${feature}:agent-output.txt`]);
      assert.equal(fileInCommit.status, 0, 'agent-output.txt must be committed on the kept feature branch');
      assert.match(fileInCommit.stdout.toString(), /work from the agent/);
    } },
    { name: 'back-compat: a single-project run (no workspace opts) is unchanged', run: () => {
      const state = orch.getState();
      assert.equal(state.target, undefined, 'no workspace discriminator on a single-project run');
      assert.equal(state.workspaceKey, undefined);
      // P1 (Review Focus #4): a git run's state stays byte-identical — no Folder-run keys
      assert.equal('workMode' in state, false, 'no workMode on a git run');
      assert.equal('projectKey' in state, false, 'no stored projectKey on a git run');
      // Phase 1 (run-root plumbing): the per-member maps are initialized in the
      // constructor state literal so getState()'s snapshot shape is stable across modes
      // and targets — a single-project run now carries a ONE-entry map keyed by its own
      // projectKey (previously undefined). Nothing else about the single-project shape
      // moved: `target`/`workspaceKey` stay absent and the scalars below are unchanged.
      const onlyKey = projectKey(repo);
      assert.deepEqual(Object.keys(state.checkpointRefs), [onlyKey], 'one-entry per-member ref map');
      assert.deepEqual(Object.keys(state.branches), [onlyKey], 'one-entry per-member branches map');
      // The single-project branch object shape is unchanged.
      assert.ok(state.branch && typeof state.branch === 'object');
      assert.equal('workMode' in state.branch, false, 'no workMode in a git run\'s branch record');
      assert.equal(state.branch.source, 'main');
      assert.match(state.branch.feature, /^worca-cc\//);
      // Pipeline routes to the PROJECT store, never workspaces/.
      assert.doesNotMatch(state.pipelineDir, /\/store\/workspaces\//);
      assert.match(posix(state.pipelineDir), new RegExp(`/store/${projectKey(repo)}/pipelines/`));
    } },
  ]);
});

// The branch is resolved and checked out during setup, before the first agent dispatch, so
// the naming tests (this one and the HEAD-default source below) stop there instead of
// running every node.
test('explicit featureBranch is honored verbatim (after sanitize)', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo,
    prompt: 'whatever',
    auto: true,
    claude: { mock: true },
    branch: { source: 'main', feature: 'feat/my-thing' },
  });
  assert.equal((await stopAt(orch, afterStarts(1))).status, 'stopped');
  assert.equal(orch.getState().branch.feature, 'feat/my-thing');
});

// ── C1: worktree lifecycle (teardown actually runs) ──────────────────────────
function branchList(dir) {
  return spawnSync('git', ['-C', dir, 'branch', '--format=%(refname:short)'])
    .stdout.toString().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

test('C1: on stop the worktree dir is removed but the branch is KEPT with partial work', async () => {
  const repo = await freshRepo();
  const mainSha = spawnSync('git', ['-C', repo, 'rev-parse', 'main']).stdout.toString().trim();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  // Simulate an agent writing partial work into the worktree, THEN stop the run.
  let injected = false;
  orch.on('state', (s) => {
    if (s.branch && s.branch.worktreeDir && existsSync(s.branch.worktreeDir) && !injected) {
      injected = true;
      writeFileSync(join(s.branch.worktreeDir, 'partial.txt'), 'work in progress\n');
    }
    if (s.branch && s.branch.feature) orch.stop();
  });
  const result = await orch.run();
  assert.equal(result.status, 'stopped', JSON.stringify(result));
  assert.ok(injected, 'precondition: partial work was injected into the worktree');
  const feature = orch.getState().branch.feature;
  const wtDir = orch.getState().branch.worktreeDir;
  assert.ok(!existsSync(wtDir), 'worktree dir should be removed on stop');
  assert.ok(branchList(repo).includes(feature), `branch ${feature} should be KEPT on stop`);
  // The kept branch must carry the partial work committed up to the stop point.
  const featSha = spawnSync('git', ['-C', repo, 'rev-parse', feature]).stdout.toString().trim();
  assert.notEqual(featSha, mainSha, 'kept branch should carry the partial-work commit');
  const fileInCommit = spawnSync('git', ['-C', repo, 'show', `${feature}:partial.txt`]);
  assert.equal(fileInCommit.status, 0, 'partial.txt must be committed on the kept branch');
  assert.match(fileInCommit.stdout.toString(), /work in progress/);
});

// ── C2 / #693: a projectDir nested in an enclosing repo is refused, never git-inited ──
// (an UNREGISTERED nested dir: git mode, L4 — e.g. a CLI run in a sub-folder)
test('C2 (#693): a projectDir nested in an enclosing repo ends the run with a clear error; nothing is git-inited', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'worca-cc-parent-'));
  created.push(parent);
  const gp = (a) => spawnSync('git', a, { cwd: parent });
  gp(['init', '-q', '-b', 'main']);
  gp(['config', 'user.email', 't@t']); gp(['config', 'user.name', 't']);
  await writeFile(join(parent, 'root.txt'), 'root\n');
  gp(['add', '-A']); gp(['commit', '-qm', 'init']);
  const sub = join(parent, 'sub');
  await mkdir(sub, { recursive: true });
  await writeFile(join(sub, 'app.txt'), 'app\n');

  const orch = createOrchestrator({ projectDir: sub, prompt: 'x', auto: true, claude: { mock: true } });
  const errors = [];
  orch.on('error', (e) => errors.push(e.message));
  const result = await orch.run();
  assert.equal(result.status, 'error', JSON.stringify(result));   // terminal: not "Paused after an error"
  assert.match(errors.join('\n'), /is inside the git repository at .*Worca runs only on the top folder of a git repository\. Add .* as a project and run there\./);
  assert.equal(existsSync(join(sub, '.git')), false, 'sub must NOT be git-inited');
  assert.ok(!branchList(parent).some((b) => b.startsWith('worca-cc/')), 'parent repo must have no worca-cc/* branches');
  assert.equal(gp(['status', '--porcelain']).stdout.toString(), '?? sub/\n', 'the parent work tree only has the user\'s own untracked sub/');
});

test('C2 (#693): where git cannot see the enclosing repo (a ceiling, a "dubious ownership" parent), the stat walk still refuses', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'worca-cc-parent-')); created.push(parent);
  const gp = (a) => spawnSync('git', a, { cwd: parent });
  gp(['init', '-q', '-b', 'main']); gp(['config', 'user.email', 't@t']); gp(['config', 'user.name', 't']);
  await writeFile(join(parent, 'root.txt'), 'root\n'); gp(['add', '-A']); gp(['commit', '-qm', 'init']);
  const sub = join(parent, 'sub'); await mkdir(sub, { recursive: true }); await writeFile(join(sub, 'app.txt'), 'app\n');
  const prev = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = realpathSync(parent);             // rev-parse in sub no longer finds parent
  try {
    const orch = createOrchestrator({ projectDir: sub, prompt: 'x', auto: true, claude: { mock: true } });
    const errors = [];
    orch.on('error', (e) => errors.push(e.message));
    assert.equal((await orch.run()).status, 'error');
    assert.match(errors.join('\n'), /sub is inside the git repository at /);
    assert.equal(existsSync(join(sub, '.git')), false, 'sub must NOT be git-inited');
  } finally {
    if (prev === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = prev;
  }
});

test('#693: a repository an older worca git-inited inside the user\'s repository runs, with a warning that says how to fix it', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'worca-cc-parent-')); created.push(parent);
  const gp = (a) => spawnSync('git', a, { cwd: parent });
  gp(['init', '-q', '-b', 'main']); gp(['config', 'user.email', 't@t']); gp(['config', 'user.name', 't']);
  await writeFile(join(parent, 'root.txt'), 'root\n'); gp(['add', '-A']); gp(['commit', '-qm', 'init']);
  const sub = join(parent, 'sub'); await mkdir(sub, { recursive: true }); await writeFile(join(sub, 'app.txt'), 'app\n');
  // What 1.10.0 left behind (run-harness _ensureGitCheckpointFor's old !isOwnRepo branch).
  const gs = (a) => spawnSync('git', a, { cwd: sub });
  gs(['init', '-q', '-b', 'main']); gs(['config', 'user.email', 'orchestrator@local']); gs(['config', 'user.name', 'orchestrator']);
  gs(['add', '-A']); gs(['commit', '-qm', 'orchestrator: initial checkpoint']);
  const configBefore = readFileSync(join(sub, '.git', 'config'), 'utf8');

  const orch = createOrchestrator({ projectDir: sub, prompt: 'x', auto: true, claude: { mock: true } });
  const warns = [];
  orch.on('log', (e) => { if (e.level === 'warn' && e.source === 'git') warns.push(e.text); });
  const result = await orch.run();
  assert.equal(result.status, 'done', JSON.stringify(result));
  assert.equal(warns.length, 1, warns.join('\n'));
  assert.match(warns[0], /An older Worca created it\..*delete it, remove this project from Worca, then add /s);
  assert.ok(existsSync(join(sub, '.git')), 'nothing removed');
  assert.equal(readFileSync(join(sub, '.git', 'config'), 'utf8'), configBefore, 'its config is untouched');
});

test('C2 (Folder mode): the same nested dir on a copy gets no .git, the parent repo is left alone, the run root is used even under legacy', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'worca-cc-parent-')); created.push(parent);
  const gp = (a) => spawnSync('git', a, { cwd: parent });
  gp(['init', '-q', '-b', 'main']); gp(['config', 'user.email', 't@t']); gp(['config', 'user.name', 't']);
  await writeFile(join(parent, 'root.txt'), 'root\n'); gp(['add', '-A']); gp(['commit', '-qm', 'init']);
  const sub = join(parent, 'sub'); await mkdir(sub, { recursive: true }); await writeFile(join(sub, 'app.txt'), 'app\n');
  const before = gp(['status', '--porcelain']).stdout.toString();
  const orch = createOrchestrator({ projectDir: sub, prompt: 'x', auto: true, claude: { mock: true }, workMode: 'folder' });
  assert.equal((await orch.run()).status, 'done');
  assert.equal(existsSync(join(sub, '.git')), false);
  assert.ok(!branchList(parent).some((b) => b.startsWith('worca-cc/')));
  assert.equal(gp(['status', '--porcelain']).stdout.toString(), before, 'the parent work tree is unchanged');
  assert.match(posix(orch.getState().branch.copyDir), /\/runs\/[0-9a-f]{8}\/repos\//);
});

test('source branch defaults to actual HEAD when not "main"', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-master-'));
  created.push(dir);
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'master']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'a.txt'), 'a\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'x', auto: true, claude: { mock: true },
  });
  assert.equal((await stopAt(orch, afterStarts(1))).status, 'stopped');
  assert.equal(orch.getState().branch.source, 'master');
});
