// test/orchestrator-worktree.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { setMockSourceResponses } from '../src/core/plugin-shim.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { posix } from './helpers/posix-path.mjs';

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
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-orch-'));
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

test('orchestrator creates a worktree on source branch with a derived feature branch', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo,
    prompt: 'Add login flow',
    auto: true,
    claude: { mock: true },
    branch: { source: 'main' },
  });
  const result = await orch.run();
  assert.equal(result.status, 'done', JSON.stringify(result));

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
});

test('explicit featureBranch is honored verbatim (after sanitize)', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo,
    prompt: 'whatever',
    auto: true,
    claude: { mock: true },
    branch: { source: 'main', feature: 'feat/my-thing' },
  });
  await orch.run();
  assert.equal(orch.getState().branch.feature, 'feat/my-thing');
});

// ── C1: worktree lifecycle (teardown actually runs) ──────────────────────────
function branchList(dir) {
  return spawnSync('git', ['-C', dir, 'branch', '--format=%(refname:short)'])
    .stdout.toString().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

test('C1: on done the worktree dir is removed but the feature branch is kept', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'Add login flow', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  const result = await orch.run();
  assert.equal(result.status, 'done', JSON.stringify(result));
  const feature = orch.getState().branch.feature;
  const wtDir = orch.getState().branch.worktreeDir;
  assert.ok(!existsSync(wtDir), `worktree dir should be removed, still present: ${wtDir}`);
  assert.ok(branchList(repo).includes(feature), `feature branch ${feature} should be KEPT on success`);
});

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

test('on done the agent work is COMMITTED to the kept feature branch', async () => {
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
  assert.ok(injected, 'precondition: a file was injected into the worktree');
  const feature = orch.getState().branch.feature;

  // The kept branch must have advanced past main and contain the agent's file.
  const featSha = spawnSync('git', ['-C', repo, 'rev-parse', feature]).stdout.toString().trim();
  assert.notEqual(featSha, mainSha, 'feature branch should carry a new commit, not still equal main');
  const fileInCommit = spawnSync('git', ['-C', repo, 'show', `${feature}:agent-output.txt`]);
  assert.equal(fileInCommit.status, 0, 'agent-output.txt must be committed on the kept feature branch');
  assert.match(fileInCommit.stdout.toString(), /work from the agent/);
});

// ── C2: nested projectDir must NOT mutate the enclosing repo ──────────────────
test('C2: a projectDir nested in an enclosing repo gets its own repo, parent untouched', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'worca-cc-parent-'));
  created.push(parent);
  const gp = (a) => spawnSync('git', a, { cwd: parent });
  gp(['init', '-q', '-b', 'main']);
  gp(['config', 'user.email', 't@t']); gp(['config', 'user.name', 't']);
  await writeFile(join(parent, 'root.txt'), 'root\n');
  gp(['add', '-A']); gp(['commit', '-qm', 'init']);

  // Nested dir with NO .git of its own (this is the C2 footgun).
  const sub = join(parent, 'sub');
  await mkdir(sub, { recursive: true });
  await writeFile(join(sub, 'app.txt'), 'app\n');

  const orch = createOrchestrator({ projectDir: sub, prompt: 'x', auto: true, claude: { mock: true } });
  const result = await orch.run();
  assert.equal(result.status, 'done', JSON.stringify(result));

  assert.ok(existsSync(join(sub, '.git')), 'sub should have been given its OWN git repo');
  const feature = orch.getState().branch.feature;
  assert.ok(branchList(sub).includes(feature), `feature branch should live in sub's repo`);
  assert.ok(!branchList(parent).includes(feature), `parent repo must NOT have ${feature}`);
  assert.ok(!branchList(parent).some((b) => b.startsWith('worca-cc/')), 'parent repo must have no worca-cc/* branches');
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
  await orch.run();
  assert.equal(orch.getState().branch.source, 'master');
});

// ── task-source checkout hint: attach to an existing (PR head) branch ─────────
const g = (dir, args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
async function originWithBranch() {
  const origin = await freshRepo();
  g(origin, ['checkout', '-q', '-b', 'Feature/Flux']);
  await writeFile(join(origin, 'flux.txt'), 'flux\n'); g(origin, ['add', '-A']); g(origin, ['commit', '-qm', 'flux']);
  g(origin, ['checkout', '-q', 'main']);
  const repo = await freshRepo();
  g(repo, ['remote', 'add', 'origin', origin]);
  return { origin, repo, tip: g(origin, ['rev-parse', 'Feature/Flux']).stdout.trim() };
}
const PR_TASK = {
  id: 'acme/api#42:thread:PRRT_1', title: '#42 src/x.mjs:42 — fix null check', state: 'open', updatedAt: 'x',
  body: 'fix it', meta: { kind: 'thread' }, checkout: { branch: 'Feature/Flux', base: 'main', repo: 'acme/api', sha: null },
};
const PR_SOURCE = { type: 'plugin', plugin: 'github-source', sourceId: 'github-pr-comments', taskId: 'acme/api#42:thread:PRRT_1' };

test('a task-source checkout hint attaches the run to the fetched PR head branch, re-checkpoints to its tip and commits onto it', async () => {
  const { repo, tip } = await originWithBranch();
  process.env.WORCA_MOCK = '1';
  try {
    setMockSourceResponses({ getTask: PR_TASK });
    const orch = createOrchestrator({
      projectDir: repo, auto: true, claude: { mock: true }, source: PR_SOURCE,
      branch: { source: 'main' },                        // the UI's default — must NOT win over the hint (D9)
    });
    const result = await orch.run();
    assert.equal(result.status, 'done', JSON.stringify(result));
    const st = orch.getState();
    assert.equal(st.branch.feature, 'Feature/Flux');
    assert.equal(st.branch.source, 'main', 'source = PR base (Create PR base/head differ, D8)');
    assert.equal(st.branch.attached, true);
    assert.equal(st.branch.reusedExisting, true);
    assert.equal(st.checkpointRef, tip, 'diff base is the PR tip, not the project HEAD (D14)');
    assert.equal(st.checkpointRefs[Object.keys(st.checkpointRefs)[0]], tip, 'per-member map moved too');
    assert.ok(branchList(repo).includes('Feature/Flux'), 'branch kept after teardown');
    assert.equal(g(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim(), 'main', 'main working tree untouched');
    // Whatever the mock run committed sits on Feature/Flux, on top of the PR tip.
    assert.ok(g(repo, ['merge-base', '--is-ancestor', tip, 'Feature/Flux']).status === 0);
  } finally { delete process.env.WORCA_MOCK; setMockSourceResponses(null); }
});

test('a second run on the same PR (local branch ahead of origin, nothing pushed) attaches on top of the earlier commits', async () => {
  const { repo, tip } = await originWithBranch();
  process.env.WORCA_MOCK = '1';
  try {
    setMockSourceResponses({ getTask: PR_TASK });
    const first = await createOrchestrator({ projectDir: repo, auto: true, claude: { mock: true }, source: PR_SOURCE }).run();
    assert.equal(first.status, 'done', JSON.stringify(first));
    // Simulate run 1 having produced a commit (the mock may or may not have): commit on the branch via a temp worktree.
    const wt = join(repo, '.tmp-wt');
    g(repo, ['worktree', 'add', '-q', '--', wt, 'Feature/Flux']);
    await writeFile(join(wt, 'run1.txt'), 'run 1\n'); g(wt, ['add', '-A']); g(wt, ['commit', '-qm', 'run 1']);
    g(repo, ['worktree', 'remove', '--force', wt]);
    const localTip = g(repo, ['rev-parse', 'Feature/Flux']).stdout.trim();
    assert.notEqual(localTip, tip);

    const second = createOrchestrator({ projectDir: repo, auto: true, claude: { mock: true }, source: PR_SOURCE });
    const r = await second.run();
    assert.equal(r.status, 'done', JSON.stringify(r));
    const st = second.getState();
    assert.equal(st.branch.attached, true);
    assert.equal(st.checkpointRef, localTip, 'diff base = the local tip incl. run 1 (D14), never reset to origin');
    assert.ok(g(repo, ['merge-base', '--is-ancestor', localTip, 'Feature/Flux']).status === 0, 'run 1 commits preserved');
  } finally { delete process.env.WORCA_MOCK; setMockSourceResponses(null); }
});

test('a checkout hint whose branch is checked out in the main working tree fails the run with an actionable error', async () => {
  const { repo } = await originWithBranch();
  g(repo, ['fetch', '-q', 'origin', 'refs/heads/Feature/Flux:refs/heads/Feature/Flux']);
  g(repo, ['checkout', '-q', 'Feature/Flux']);
  process.env.WORCA_MOCK = '1';
  try {
    setMockSourceResponses({ getTask: PR_TASK });
    const orch = createOrchestrator({ projectDir: repo, auto: true, claude: { mock: true }, source: PR_SOURCE });
    const result = await orch.run();
    // run() never rethrows a setup failure: it returns { status:'error', pipelineDir, error } (orchestrator.mjs:791).
    assert.equal(result.status, 'error', JSON.stringify(result));
    assert.match(String(result.error), /Cannot work on "Feature\/Flux": it is checked out in .*switch it to another branch/);
    assert.equal(g(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim(), 'Feature/Flux', 'the user checkout is untouched');
  } finally { delete process.env.WORCA_MOCK; setMockSourceResponses(null); }
});

test('an explicit featureBranch wins over the checkout hint', async () => {
  const repo = await freshRepo();
  process.env.WORCA_MOCK = '1';
  try {
    setMockSourceResponses({ getTask: { id: 'T', title: 'T', state: 'open', updatedAt: 'x', body: 'b', meta: {}, checkout: { branch: 'Feature/Flux' } } });
    const orch = createOrchestrator({
      projectDir: repo, auto: true, claude: { mock: true },
      source: { type: 'plugin', plugin: 'gh', sourceId: 'prs', taskId: 'T' },
      branch: { source: 'main', feature: 'feat/mine' },
    });
    const r = await orch.run();
    assert.equal(r.status, 'done', JSON.stringify(r));
    assert.equal(orch.getState().branch.feature, 'feat/mine');
    assert.equal(orch.getState().branch.attached, undefined);
  } finally { delete process.env.WORCA_MOCK; setMockSourceResponses(null); }
});
