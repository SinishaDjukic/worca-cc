// test/worktree.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { writeFile as fsWriteFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import {
  sanitizeBranchName,
  suggestBranchName,
  listLocalBranches,
  currentBranch,
  resolveDefaultBranch,
  createWorktree,
  removeWorktree,
  isValidSourceRef,
  worktreePathForBranch,
} from '../src/core/worktree.mjs';

const created = [];
async function freshRepo({ initialBranch = 'main' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wt-'));
  created.push(dir);
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', initialBranch]);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

test('sanitizeBranchName: kebab, strips junk, forbids leading slash', () => {
  assert.equal(sanitizeBranchName('Add Multi Branch!!'), 'add-multi-branch');
  assert.equal(sanitizeBranchName('feat/Foo Bar'), 'feat/foo-bar');
  assert.equal(sanitizeBranchName('   '), '');
  assert.equal(sanitizeBranchName('--bad--'), 'bad');
  assert.equal(sanitizeBranchName('a..b'), 'a-b');
  assert.equal(sanitizeBranchName('weird@{ref}'), 'weird-ref');
  assert.ok(sanitizeBranchName('a'.repeat(120)).length <= 80);
});

test('suggestBranchName: keyword slug from prompt, drops stopwords', async () => {
  // "with" is filler; dropped. No LLM, fully deterministic, no cost.
  const name = await suggestBranchName({
    prompt: 'Add login screen with Google SSO',
    pipelineId: 'abc12345',
  });
  assert.equal(name, 'worca-cc/add-login-screen-google-sso-abc12345');
});

test('suggestBranchName: keyword slug drops leading filler verbs/articles', async () => {
  const name = await suggestBranchName({
    prompt: 'Build a central machine-wide pipeline history store',
    pipelineId: 'deadbeef',
  });
  // build + a dropped; first 6 significant words kept.
  assert.equal(name, 'worca-cc/central-machine-wide-pipeline-history-store-deadbeef');
});

test('suggestBranchName: title wins over prompt when given', async () => {
  const name = await suggestBranchName({
    prompt: 'Build a central machine-wide pipeline history store',
    title: 'Central History Store',
    pipelineId: 'abc12345',
  });
  assert.equal(name, 'worca-cc/central-history-store-abc12345');
});

test('suggestBranchName: caps significant words to keep names short', async () => {
  const name = await suggestBranchName({
    prompt: 'alpha beta gamma delta epsilon zeta eta theta',
    pipelineId: 'cafef00d',
  });
  assert.equal(name, 'worca-cc/alpha-beta-gamma-delta-epsilon-zeta-cafef00d');
});

test('suggestBranchName: all-stopword prompt falls back to raw slug', async () => {
  const name = await suggestBranchName({
    prompt: 'build the a',
    pipelineId: 'abc12345',
  });
  // every word is a stopword -> do not emit an empty core; keep the raw slug.
  assert.equal(name, 'worca-cc/build-the-a-abc12345');
});

test('suggestBranchName: empty prompt and no title -> feature fallback', async () => {
  const name = await suggestBranchName({ prompt: '', pipelineId: 'abc12345' });
  assert.equal(name, 'worca-cc/feature-abc12345');
});

test('listLocalBranches returns the initial branch', async () => {
  const repo = await freshRepo();
  const branches = await listLocalBranches(repo);
  assert.ok(branches.includes('main'), `expected main in ${branches.join(',')}`);
});

test('resolveDefaultBranch picks the actual HEAD even when not "main"', async () => {
  const repo = await freshRepo({ initialBranch: 'master' });
  assert.equal(await resolveDefaultBranch(repo), 'master');
});

test('createWorktree checks out a new branch from source in an isolated dir', async () => {
  const repo = await freshRepo();
  const wt = await createWorktree({
    projectDir: repo,
    pipelineId: 'pid1',
    sourceBranch: 'main',
    featureBranch: 'worca-cc/x-pid1',
  });
  assert.match(wt.worktreeDir, /\.worca-cc\/worktrees\/pid1$/);
  assert.equal(wt.branch, 'worca-cc/x-pid1');
  assert.equal(wt.reusedExisting, false);
  const head = spawnSync('git', ['-C', wt.worktreeDir, 'rev-parse', '--abbrev-ref', 'HEAD']);
  assert.equal(head.stdout.toString().trim(), 'worca-cc/x-pid1');
});

test('two worktrees on the same project coexist (concurrent runs)', async () => {
  const repo = await freshRepo();
  const a = await createWorktree({ projectDir: repo, pipelineId: 'a', sourceBranch: 'main', featureBranch: 'worca-cc/a' });
  const b = await createWorktree({ projectDir: repo, pipelineId: 'b', sourceBranch: 'main', featureBranch: 'worca-cc/b' });
  assert.notEqual(a.worktreeDir, b.worktreeDir);
  const list = await listLocalBranches(repo);
  assert.ok(list.includes('worca-cc/a'));
  assert.ok(list.includes('worca-cc/b'));
});

test('createWorktree reuses an existing branch and reports reusedExisting=true', async () => {
  const repo = await freshRepo();
  spawnSync('git', ['-C', repo, 'branch', 'worca-cc/resume']);
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'r1', sourceBranch: 'main', featureBranch: 'worca-cc/resume',
  });
  assert.equal(wt.reusedExisting, true);
});

test('removeWorktree prunes the dir + branch', async () => {
  const repo = await freshRepo();
  const wt = await createWorktree({ projectDir: repo, pipelineId: 'gone', sourceBranch: 'main', featureBranch: 'worca-cc/gone' });
  await removeWorktree({ projectDir: repo, worktreeDir: wt.worktreeDir, branch: wt.branch, force: true });
  const list = await listLocalBranches(repo);
  assert.ok(!list.includes('worca-cc/gone'));
});

test('createWorktree throws a useful error when sourceBranch does not resolve', async () => {
  const repo = await freshRepo();
  await assert.rejects(
    () => createWorktree({ projectDir: repo, pipelineId: 'oops', sourceBranch: 'no-such-branch', featureBranch: 'worca-cc/x' }),
    /not a valid ref/,
  );
});

test('createWorktree rejects featureBranch equal to sourceBranch (hang guard)', async () => {
  const repo = await freshRepo();
  await assert.rejects(
    () => createWorktree({ projectDir: repo, pipelineId: 'same', sourceBranch: 'main', featureBranch: 'main' }),
    /must differ/,
  );
  // Case variants collapse to the same sanitized name and are rejected too.
  await assert.rejects(
    () => createWorktree({ projectDir: repo, pipelineId: 'same2', sourceBranch: 'Main', featureBranch: 'Main' }),
    /must differ/,
  );
});

// currentBranch sanity (separate so failure points are obvious).
test('currentBranch returns the HEAD branch name', async () => {
  const repo = await freshRepo();
  assert.equal(await currentBranch(repo), 'main');
});

// ── M1: sourceBranch validation / argument-injection ──────────────────────────
test('isValidSourceRef accepts a real branch, rejects unknown + leading-dash', async () => {
  const repo = await freshRepo();
  assert.equal(await isValidSourceRef(repo, 'main'), true);
  assert.equal(await isValidSourceRef(repo, 'no-such'), false);
  assert.equal(await isValidSourceRef(repo, '--force'), false);
  assert.equal(await isValidSourceRef(repo, '-q'), false);
  assert.equal(await isValidSourceRef(repo, ''), false);
});

test('createWorktree refuses an option-like sourceBranch (M1 injection)', async () => {
  const repo = await freshRepo();
  await assert.rejects(
    () => createWorktree({ projectDir: repo, pipelineId: 'inj', sourceBranch: '--force', featureBranch: 'worca-cc/x' }),
    /not a valid ref/,
  );
  // git never created a stray worktree dir for the rejected run.
  assert.ok(!existsSync(join(repo, '.worca-cc', 'worktrees', 'inj')));
});

// ── S2: pipelineId path traversal ─────────────────────────────────────────────
test('createWorktree rejects a traversal pipelineId (S2)', async () => {
  const repo = await freshRepo();
  for (const bad of ['../escape', '..', '.', 'a/b', 'a\\b']) {
    await assert.rejects(
      () => createWorktree({ projectDir: repo, pipelineId: bad, sourceBranch: 'main', featureBranch: 'worca-cc/x' }),
      /invalid pipelineId|escapes base/,
      `expected rejection for ${JSON.stringify(bad)}`,
    );
  }
});

// ── M2: branch already checked out in a live worktree ─────────────────────────
test('createWorktree fails actionably when the branch is in use by a live worktree (M2)', async () => {
  const repo = await freshRepo();
  spawnSync('git', ['-C', repo, 'branch', 'worca-cc/dup']);
  const first = await createWorktree({ projectDir: repo, pipelineId: 'one', sourceBranch: 'main', featureBranch: 'worca-cc/dup' });
  assert.equal(first.reusedExisting, true);
  assert.equal(await worktreePathForBranch(repo, 'worca-cc/dup'), first.worktreeDir);
  await assert.rejects(
    () => createWorktree({ projectDir: repo, pipelineId: 'two', sourceBranch: 'main', featureBranch: 'worca-cc/dup' }),
    /already checked out in worktree/,
  );
});

test('createWorktree reuse succeeds again after the stale worktree is pruned (M2)', async () => {
  const repo = await freshRepo();
  spawnSync('git', ['-C', repo, 'branch', 'worca-cc/resume2']);
  const wt = await createWorktree({ projectDir: repo, pipelineId: 'p1', sourceBranch: 'main', featureBranch: 'worca-cc/resume2' });
  // Simulate a crash that left the dir orphaned, then a resume: removing the
  // dir + prune frees the branch so the next reuse attaches cleanly.
  await rm(wt.worktreeDir, { recursive: true, force: true });
  const again = await createWorktree({ projectDir: repo, pipelineId: 'p2', sourceBranch: 'main', featureBranch: 'worca-cc/resume2' });
  assert.equal(again.reusedExisting, true);
});

// ── M3: removeWorktree is non-silent + force-correct ──────────────────────────
test('removeWorktree force:true removes an agent-dirtied worktree + reports steps (M3)', async () => {
  const repo = await freshRepo();
  const wt = await createWorktree({ projectDir: repo, pipelineId: 'dirty', sourceBranch: 'main', featureBranch: 'worca-cc/dirty' });
  await fsWriteFile(join(wt.worktreeDir, 'agent-edit.txt'), 'modified by agent\n');
  const res = await removeWorktree({ projectDir: repo, worktreeDir: wt.worktreeDir, branch: wt.branch, force: true });
  assert.equal(res.ok, true, JSON.stringify(res.steps));
  assert.ok(!existsSync(wt.worktreeDir), 'dir should be gone');
  assert.ok(!(await listLocalBranches(repo)).includes('worca-cc/dirty'));
  assert.ok(res.steps.some((s) => s.step === 'worktree-remove'));
});

test('removeWorktree non-force surfaces failure on a dirty worktree (M3)', async () => {
  const repo = await freshRepo();
  const wt = await createWorktree({ projectDir: repo, pipelineId: 'dirty2', sourceBranch: 'main', featureBranch: 'worca-cc/dirty2' });
  await fsWriteFile(join(wt.worktreeDir, 'agent-edit.txt'), 'modified\n');
  const res = await removeWorktree({ projectDir: repo, worktreeDir: wt.worktreeDir, branch: wt.branch, force: false });
  assert.equal(res.ok, false, 'non-force on a dirty worktree must report failure, not silently no-op');
  assert.ok(existsSync(wt.worktreeDir), 'dir survives the refused non-force removal');
  const removeStep = res.steps.find((s) => s.step === 'worktree-remove');
  assert.ok(removeStep && /modified or untracked|use --force/i.test(removeStep.stderr));
});

// ── Phase 1: baseDir + checkoutName (the detached run-root placement) ─────────
test('createWorktree: baseDir relocates the checkout out of the project entirely', async () => {
  const repo = await freshRepo();
  const base = await mkdtemp(join(tmpdir(), 'worca-cc-wt-base-'));
  created.push(base);
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'relo1', sourceBranch: 'main', featureBranch: 'worca-cc/relo1',
    baseDir: join(base, 'repos'),
  });
  // No checkoutName -> the name falls back to the pipelineId.
  assert.equal(wt.worktreeDir, join(await realpath(base), 'repos', 'relo1'));
  assert.ok(existsSync(join(wt.worktreeDir, 'README.md')), 'a real checkout landed under baseDir');
  assert.ok(!existsSync(join(repo, '.worca-cc')), 'nothing was created inside the project');
  // The shared object store stays in the real repo: the branch is there, and git
  // reports the out-of-tree checkout in the repo's worktree list.
  assert.ok((await listLocalBranches(repo)).includes('worca-cc/relo1'));
  const head = spawnSync('git', ['-C', wt.worktreeDir, 'rev-parse', '--abbrev-ref', 'HEAD']);
  assert.equal(head.stdout.toString().trim(), 'worca-cc/relo1');
});

test('createWorktree: checkoutName names the dir (projectKey on a detached run)', async () => {
  const repo = await freshRepo();
  const base = await mkdtemp(join(tmpdir(), 'worca-cc-wt-base2-'));
  created.push(base);
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'pid-shared', sourceBranch: 'main', featureBranch: 'worca-cc/named',
    baseDir: base, checkoutName: 'proj-abcd1234',
  });
  assert.equal(wt.worktreeDir, join(await realpath(base), 'proj-abcd1234'));
});

test('createWorktree: omitting baseDir preserves the legacy default byte-for-byte', async () => {
  const repo = await freshRepo();
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'legacy-default', sourceBranch: 'main', featureBranch: 'worca-cc/ld',
  });
  assert.equal(wt.worktreeDir, join(await realpath(repo), '.worca-cc', 'worktrees', 'legacy-default'));
});

test('createWorktree: rejects a traversal/invalid checkoutName (containment guard)', async () => {
  const repo = await freshRepo();
  const base = await mkdtemp(join(tmpdir(), 'worca-cc-wt-base3-'));
  created.push(base);
  for (const bad of ['../escape', '..', '.', 'a/b', 'a\\b']) {
    await assert.rejects(
      () => createWorktree({
        projectDir: repo, pipelineId: 'ok', sourceBranch: 'main', featureBranch: 'worca-cc/x',
        baseDir: base, checkoutName: bad,
      }),
      /invalid checkout name|escapes base/,
      `expected rejection for checkoutName ${JSON.stringify(bad)}`,
    );
  }
});

// ── m1: detached HEAD default-branch fallback ─────────────────────────────────
test('resolveDefaultBranch falls back to the HEAD SHA on a detached HEAD with no branches (m1)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-detached-'));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  // Override any machine-global init.defaultBranch=main so the fallback chain
  // actually reaches the SHA branch (m1) instead of returning that config value.
  g(['config', 'init.defaultBranch', '']);
  await writeFile(join(dir, 'a'), 'a'); g(['add', '-A']); g(['commit', '-qm', 'init']);
  const sha = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD']).stdout.toString().trim();
  // Detach + delete every local branch so only the SHA remains.
  g(['checkout', '-q', '--detach', sha]);
  g(['branch', '-D', 'main']);
  const resolved = await resolveDefaultBranch(dir);
  assert.equal(resolved, sha, 'should return the SHA, never the literal "main"');
});

test('createWorktree names an aborted `git worktree add` AbortError (a stop is not a git failure)', async () => {
  const repo = await freshRepo();
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => createWorktree({ projectDir: repo, pipelineId: 'ab1', sourceBranch: 'main', featureBranch: 'worca-cc/ab1', signal: ac.signal }),
    (err) => {
      assert.equal(err.name, 'AbortError');
      assert.match(err.message, /git worktree add failed/);
      return true;
    },
  );
});
