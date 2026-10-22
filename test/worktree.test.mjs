// test/worktree.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

import { writeFile as fsWriteFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { posix } from './helpers/posix-path.mjs';

import {
  sanitizeBranchName,
  suggestBranchName,
  listLocalBranches,
  currentBranch,
  resolveDefaultBranch,
  createWorktree,
  boundCheckoutName,
  removeWorktree,
  deleteBranchIfAt,
  isValidSourceRef,
  worktreePathForBranch,
  createDetachedWorktree,
  worktreeHead,
  commitOf,
  isAncestor,
  reusedBranchBase,
  runGitCapture,
  ASK_GIT_ENV,
} from '../src/core/worktree.mjs';
import { checkRows } from './helpers/rows.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

const created = [];
async function freshRepo({ initialBranch = 'main' } = {}) {
  const dir = templateRepo('wt', { branch: initialBranch, user: true, files: { 'README.md': '# hi\n' } });
  created.push(dir);
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

test('suggestBranchName: keyword slug (stopwords, filler verbs, title wins, word cap, all-stopword fallback, feature fallback)', async () => {
  await checkRows([
    { name: 'suggestBranchName: keyword slug from prompt, drops stopwords', run: async () => {
      // "with" is filler; dropped. No LLM, fully deterministic, no cost.
      const name = await suggestBranchName({
        prompt: 'Add login screen with Google SSO',
        pipelineId: 'abc12345',
      });
      assert.equal(name, 'worca-cc/add-login-screen-google-sso-abc12345');
    } },
    { name: 'suggestBranchName: keyword slug drops leading filler verbs/articles', run: async () => {
      const name = await suggestBranchName({
        prompt: 'Build a central machine-wide pipeline history store',
        pipelineId: 'deadbeef',
      });
      // build + a dropped; first 6 significant words kept.
      assert.equal(name, 'worca-cc/central-machine-wide-pipeline-history-store-deadbeef');
    } },
    { name: 'suggestBranchName: title wins over prompt when given', run: async () => {
      const name = await suggestBranchName({
        prompt: 'Build a central machine-wide pipeline history store',
        title: 'Central History Store',
        pipelineId: 'abc12345',
      });
      assert.equal(name, 'worca-cc/central-history-store-abc12345');
    } },
    { name: 'suggestBranchName: caps significant words to keep names short', run: async () => {
      const name = await suggestBranchName({
        prompt: 'alpha beta gamma delta epsilon zeta eta theta',
        pipelineId: 'cafef00d',
      });
      assert.equal(name, 'worca-cc/alpha-beta-gamma-delta-epsilon-zeta-cafef00d');
    } },
    { name: 'suggestBranchName: all-stopword prompt falls back to raw slug', run: async () => {
      const name = await suggestBranchName({
        prompt: 'build the a',
        pipelineId: 'abc12345',
      });
      // every word is a stopword -> do not emit an empty core; keep the raw slug.
      assert.equal(name, 'worca-cc/build-the-a-abc12345');
    } },
    { name: 'suggestBranchName: empty prompt and no title -> feature fallback', run: async () => {
      const name = await suggestBranchName({ prompt: '', pipelineId: 'abc12345' });
      assert.equal(name, 'worca-cc/feature-abc12345');
    } },
  ]);
});

test('listLocalBranches / currentBranch on a fresh repo', async () => {
  const repo = await freshRepo();
  await checkRows([
    { name: 'listLocalBranches returns the initial branch', run: async () => {
      const branches = await listLocalBranches(repo);
      assert.ok(branches.includes('main'), `expected main in ${branches.join(',')}`);
    } },
    { name: 'currentBranch returns the HEAD branch name', run: async () => {
      assert.equal(await currentBranch(repo), 'main');
    } },
  ]);
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
  assert.match(posix(wt.worktreeDir), /\.worca-cc\/worktrees\/pid1$/);
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

// #411: git's fsmonitor socket is <common dir>/worktrees/<checkout name>/fsmonitor--daemon.ipc,
// and past AF_UNIX's sun_path its client never connects (every `git status` hangs).
test('boundCheckoutName: keeps a name that fits, shortens only the slug of an over-budget projectKey', () => {
  // The issue's measurement: a 58-byte common dir + `worca-cc-7f029152` puts the socket at 108 bytes.
  const common = `/${'a'.repeat(52)}/.git`;
  assert.equal(common.length, 58);
  const socket = (name) => Buffer.byteLength(`${common}/worktrees/${name}/fsmonitor--daemon.ipc`);
  assert.equal(socket('worca-cc-7f029152'), 108);
  assert.equal(boundCheckoutName('worca-cc-7f029152', '/short/.git', 'darwin'), 'worca-cc-7f029152', 'fits: unchanged');
  // macOS: 103 usable bytes, 2 kept for the counter git appends to a taken admin dir name.
  const mac = boundCheckoutName('worca-cc-7f029152', common, 'darwin');
  assert.equal(mac, 'w-7f029152');
  assert.ok(socket(mac) + 2 <= 103);
  // Linux has 4 more bytes.
  const linux = boundCheckoutName('worca-cc-7f029152', common, 'linux');
  assert.equal(linux, 'worca-7f029152');
  assert.ok(socket(linux) + 2 <= 107);
  // A cut that ends on a separator drops it; no room for any slug keeps the hash alone.
  assert.equal(boundCheckoutName('ab-cd-7f029152', `/${'a'.repeat(50)}/.git`, 'darwin'), 'ab-7f029152');
  assert.equal(boundCheckoutName('worca-cc-7f029152', `/${'a'.repeat(54)}/.git`, 'darwin'), '7f029152');
  // So deep that even the hash alone overflows: shortening cannot help, the name stays readable.
  assert.equal(boundCheckoutName('worca-cc-7f029152', `/${'a'.repeat(55)}/.git`, 'darwin'), 'worca-cc-7f029152');
  // Multi-byte path characters count as the bytes sun_path holds.
  assert.equal(boundCheckoutName('worca-cc-7f029152', `/${'é'.repeat(26)}/.git`, 'darwin'), 'w-7f029152');
  // Never throws, never touches a name it cannot shorten safely: no hash, Windows (named pipes), no common dir.
  assert.equal(boundCheckoutName('20585b7b-long-legacy-name', `/${'a'.repeat(80)}/.git`, 'darwin'), '20585b7b-long-legacy-name');
  assert.equal(boundCheckoutName('worca-cc-7f029152', common, 'win32'), 'worca-cc-7f029152');
  assert.equal(boundCheckoutName('worca-cc-7f029152', null, 'darwin'), 'worca-cc-7f029152');
});

test('createWorktree: a checkoutName that would overflow the fsmonitor socket path is shortened (#411)', { skip: process.platform === 'win32' }, async () => {
  // Under /tmp, not tmpdir(): macOS's tmpdir alone is ~57 bytes, past what any checkout name can fix.
  const root = await realpath(await mkdtemp('/tmp/wtd-'));
  created.push(root);
  const repo = join(root, 'my-awesome-microservice');
  mkdirSync(repo, { recursive: true });
  execSync('git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: repo });
  const limit = process.platform === 'linux' ? 107 : 103;
  const base = await mkdtemp(join(tmpdir(), 'worca-cc-wt-base4-'));
  created.push(base);
  const name = 'my-awesome-microservice-1234abcd';
  assert.ok(Buffer.byteLength(join(repo, '.git', 'worktrees', name, 'fsmonitor--daemon.ipc')) > limit, 'precondition: the projectKey overflows');
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'pid-deep', sourceBranch: 'main', featureBranch: 'worca-cc/deep',
    baseDir: base, checkoutName: name,
  });
  const got = basename(wt.worktreeDir);
  assert.notEqual(got, name);
  assert.match(got, /^[a-z0-9-]*-?1234abcd$/, 'the hash that makes the name unique is kept');
  assert.equal(dirname(wt.worktreeDir), await realpath(base));
  const gitDir = spawnSync('git', ['-C', wt.worktreeDir, 'rev-parse', '--absolute-git-dir']).stdout.toString().trim();
  assert.equal(basename(gitDir), got, 'git named the admin dir after the shortened checkout');
  assert.ok(Buffer.byteLength(join(gitDir, 'fsmonitor--daemon.ipc')) <= limit, 'the socket path fits sun_path');
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

// ── P4: the Ask Worca detached-checkout primitives ───────────────────────────
test('createDetachedWorktree: detached HEAD at ref, no branch created, no branch lock, removable', async () => {
  const repo = await freshRepo();
  const g = (args) => spawnSync('git', args, { cwd: repo });
  g(['checkout', '-qb', 'feature']);
  await writeFile(join(repo, 'f.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-qm', 'feat']);
  g(['checkout', '-q', 'main']);
  const base = await mkdtemp(join(tmpdir(), 'worca-cc-dwt-'));
  created.push(base);
  const dir = join(base, 'wt_00000001');
  const { commit } = await createDetachedWorktree({ projectDir: repo, worktreeDir: dir, ref: 'feature' });
  assert.match(commit, /^[0-9a-f]{40}$/);
  assert.ok(existsSync(join(dir, 'f.txt')), 'feature files checked out');
  assert.notEqual(spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: dir }).status, 0, 'HEAD is detached');
  assert.deepEqual((await listLocalBranches(repo)).sort(), ['feature', 'main'], 'no branch created');
  assert.equal(await worktreePathForBranch(repo, 'feature'), null, 'feature is NOT locked by the detached checkout (M2 untouched)');
  assert.equal(await worktreeHead(dir), commit);
  const res = await removeWorktree({ projectDir: repo, worktreeDir: dir, branch: null, force: true });
  assert.ok(res.ok, JSON.stringify(res.steps));
  assert.ok(!existsSync(dir));
  assert.ok(!String(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).stdout).includes('wt_00000001'), 'registration pruned');
});

test('createDetachedWorktree: unknown ref and option-injection are rejected before git worktree add', async () => {
  const repo = await freshRepo();
  const base = await mkdtemp(join(tmpdir(), 'worca-cc-dwt2-'));
  created.push(base);
  await assert.rejects(() => createDetachedWorktree({ projectDir: repo, worktreeDir: join(base, 'w1'), ref: 'no-such-ref' }), /not a valid commit-ish/);
  await assert.rejects(() => createDetachedWorktree({ projectDir: repo, worktreeDir: join(base, 'w2'), ref: '--force' }), /not a valid commit-ish/);
  await assert.rejects(() => createDetachedWorktree({ projectDir: repo, worktreeDir: join(base, 'w3') }), /not a valid commit-ish/);
  assert.equal(existsSync(join(base, 'w1')), false, 'nothing was created');
});

test('runGitCapture: plain capture, never throws, ASK_GIT_ENV hardening applied', async () => {
  const repo = await freshRepo();
  const ok = await runGitCapture(repo, ['rev-parse', 'HEAD']);
  assert.ok(ok.ok);
  assert.match(ok.stdout.trim(), /^[0-9a-f]{40}$/);
  const bad = await runGitCapture(repo, ['definitely-not-a-subcommand']);
  assert.equal(bad.ok, false);
  assert.ok(bad.stderr.length > 0);
  // the pager/prompt hardening reaches the child (else a credential-prompting
  // fetch hangs to the 120s SIGKILL):
  assert.deepEqual(Object.keys(ASK_GIT_ENV).sort(),
    ['GIT_ASKPASS', 'GIT_PAGER', 'GIT_TERMINAL_PROMPT', 'PAGER', 'SSH_ASKPASS']);
  const pager = await runGitCapture(repo, ['var', 'GIT_PAGER']);
  assert.equal(pager.stdout.trim(), 'cat', 'GIT_PAGER=cat reached the git child');
});

// Mutation-audit: the prune step, the throw-on-failure and the AbortError stamp.
test('createDetachedWorktree: prunes a stale registration first, throws on git failure, stamps abort', async () => {
  const repo = await freshRepo();
  const base = await mkdtemp(join(tmpdir(), 'worca-cc-dwt3-'));
  created.push(base);
  const dir = join(base, 'wt_0000000a');
  // 1) a stale registration at the SAME path (dir removed behind git's back) —
  //    without the prune-before-add step the re-add fails "already registered".
  await createDetachedWorktree({ projectDir: repo, worktreeDir: dir, ref: 'main' });
  await rm(dir, { recursive: true, force: true });
  assert.ok(String(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).stdout).includes('wt_0000000a'),
    'precondition: registration still present');
  const again = await createDetachedWorktree({ projectDir: repo, worktreeDir: dir, ref: 'main' });
  assert.match(again.commit, /^[0-9a-f]{40}$/, 'the prune let the re-add through');
  // 2) an occupied path is a THROW, never a {commit:null} success.
  await assert.rejects(() => createDetachedWorktree({ projectDir: repo, worktreeDir: dir, ref: 'main' }),
    /git worktree add --detach failed/);
  // 3) an aborted signal is named AbortError (isAbort classifiers depend on it).
  const ac = new AbortController(); ac.abort();
  await assert.rejects(
    () => createDetachedWorktree({ projectDir: repo, worktreeDir: join(base, 'wt_0000000b'), ref: 'main', signal: ac.signal }),
    (err) => { assert.equal(err.name, 'AbortError'); return true; });
});

const revParse = (dir, ref) => spawnSync('git', ['-C', dir, 'rev-parse', ref]).stdout.toString().trim();

test('deleteBranchIfAt: deletes a branch still at its start commit', async () => {
  const repo = await freshRepo();
  const sha = revParse(repo, 'main');
  spawnSync('git', ['-C', repo, 'branch', 'worca-cc/empty-1', sha]);
  const res = await deleteBranchIfAt({ projectDir: repo, branch: 'worca-cc/empty-1', sha });
  assert.deepEqual(res, { deleted: true });
  assert.ok(!(await listLocalBranches(repo)).includes('worca-cc/empty-1'));
});

test('deleteBranchIfAt: keeps a branch that moved past its start commit', async () => {
  const repo = await freshRepo();
  const sha = revParse(repo, 'main');
  const wt = join(repo, '.wt-moved');
  spawnSync('git', ['-C', repo, 'worktree', 'add', '-b', 'worca-cc/moved-1', '--', wt, 'main']);
  await writeFile(join(wt, 'x.txt'), 'x\n');
  spawnSync('git', ['-C', wt, 'add', '-A']);
  spawnSync('git', ['-C', wt, 'commit', '-qm', 'agent']);
  spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt]);
  const res = await deleteBranchIfAt({ projectDir: repo, branch: 'worca-cc/moved-1', sha });
  assert.equal(res.deleted, false);
  assert.equal(res.reason, 'moved');
  assert.ok((await listLocalBranches(repo)).includes('worca-cc/moved-1'));
});

test('deleteBranchIfAt: keeps a branch that is checked out in a live worktree', async () => {
  const repo = await freshRepo();
  const sha = revParse(repo, 'main');
  const wt = join(repo, '.wt-live');
  spawnSync('git', ['-C', repo, 'worktree', 'add', '-b', 'worca-cc/live-1', '--', wt, 'main']);
  const res = await deleteBranchIfAt({ projectDir: repo, branch: 'worca-cc/live-1', sha });
  assert.deepEqual([res.deleted, res.reason], [false, 'checked-out']);
  assert.ok((await listLocalBranches(repo)).includes('worca-cc/live-1'));
});

test('deleteBranchIfAt: missing branch, unknown base and option-shaped input are refused, never thrown', async () => {
  const repo = await freshRepo();
  const sha = revParse(repo, 'main');
  assert.equal((await deleteBranchIfAt({ projectDir: repo, branch: 'nope', sha })).reason, 'missing');
  spawnSync('git', ['-C', repo, 'branch', 'worca-cc/b-1']);
  assert.equal((await deleteBranchIfAt({ projectDir: repo, branch: 'worca-cc/b-1', sha: 'f'.repeat(40) })).reason, 'unknown-base');
  assert.equal((await deleteBranchIfAt({ projectDir: repo, branch: '--force', sha })).reason, 'invalid');
  assert.equal((await deleteBranchIfAt({ projectDir: repo, branch: 'worca-cc/b-1', sha: '-q' })).reason, 'invalid');
  assert.equal((await deleteBranchIfAt({})).reason, 'invalid');
  assert.ok((await listLocalBranches(repo)).includes('worca-cc/b-1'), 'nothing was deleted');
});

test('reusedBranchBase / isAncestor / commitOf: fork point vs <remote>/<source> first, then local source; null on unrelated or bad input', async () => {
  const repo = await freshRepo();
  const g = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const fork = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'feat/x'); await writeFile(join(repo, 'x.txt'), 'x\n'); g('add', '-A'); g('commit', '-qm', 'x');
  g('checkout', '-q', 'main'); await writeFile(join(repo, 'm.txt'), 'm\n'); g('add', '-A'); g('commit', '-qm', 'm');
  await checkRows([
    { name: 'local source only', run: async () => {
      assert.deepEqual(await reusedBranchBase(repo, { feature: 'feat/x', source: 'main' }), { sha: fork, against: 'main' });
    } },
    { name: 'remote-tracking ref preferred over the local source', run: async () => {
      g('update-ref', 'refs/remotes/origin/main', fork);
      try {
        assert.deepEqual(await reusedBranchBase(repo, { feature: 'feat/x', source: 'main', remote: 'origin' }), { sha: fork, against: 'origin/main' });
      } finally {
        g('update-ref', '-d', 'refs/remotes/origin/main');   // checkRows runs the later rows even after a failure
      }
    } },
    { name: 'unrelated history / bad input → null', run: async () => {
      g('checkout', '-q', '--orphan', 'island'); g('commit', '-q', '--allow-empty', '-m', 'island'); g('checkout', '-q', 'main');
      assert.equal(await reusedBranchBase(repo, { feature: 'island', source: 'main' }), null);
      assert.equal(await reusedBranchBase(repo, { feature: '', source: 'main' }), null);
      assert.equal(await reusedBranchBase(repo, { feature: 'feat/x', source: '--output=x' }), null);
      assert.equal(await commitOf(repo, '-x'), null);
    } },
    { name: 'isAncestor', run: async () => {
      assert.equal(await isAncestor(repo, fork, 'feat/x'), true);
      assert.equal(await isAncestor(repo, 'feat/x', 'main'), false);
      assert.equal(await isAncestor(repo, 'nope', 'main'), false);
    } },
  ]);
});

// ── defaultBranchRef (Requirements A7, design D8/Q-B) ────────────────────────────────────
import { defaultBranchRef } from '../src/core/worktree.mjs';
import { mkdtempSync as _mk, rmSync as _rm } from 'node:fs';
import { tmpdir as _tmp } from 'node:os';

const _dbrDirs = [];
after(() => { for (const d of _dbrDirs) { try { _rm(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } } });
const _dbrRepo = (branch = 'main') => {
  const dir = _mk(join(_tmp(), 'worca-dbr-')); _dbrDirs.push(dir);
  const g = (...a) => { const r = spawnSync('git', a, { cwd: dir, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
  g('init', '-q', '-b', branch); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  return { dir, g };
};

test('defaultBranchRef: origin/HEAD with the local branch present → refs/heads/<b>', async () => {
  const { dir, g } = _dbrRepo('main');
  g('update-ref', 'refs/remotes/origin/main', 'HEAD'); g('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  g('checkout', '-q', '-b', 'feature');
  assert.deepEqual(await defaultBranchRef(dir), { branch: 'main', ref: 'refs/heads/main' });
});

test('defaultBranchRef: origin/HEAD with only the remote branch → refs/remotes/origin/<b>', async () => {
  const { dir, g } = _dbrRepo('main');
  g('update-ref', 'refs/remotes/origin/main', 'HEAD'); g('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  g('checkout', '-q', '-b', 'feature'); g('branch', '-D', 'main');
  assert.deepEqual(await defaultBranchRef(dir), { branch: 'main', ref: 'refs/remotes/origin/main' });
});

test('defaultBranchRef: no origin/HEAD → init.defaultBranch when it exists locally, else the current branch, else null', async () => {
  const { dir, g } = _dbrRepo('trunk');
  g('checkout', '-q', '-b', 'work');
  g('config', 'init.defaultBranch', 'trunk');
  assert.deepEqual(await defaultBranchRef(dir), { branch: 'trunk', ref: 'refs/heads/trunk' });
  g('config', 'init.defaultBranch', 'ghost');                       // configured but absent → current branch
  assert.deepEqual(await defaultBranchRef(dir), { branch: 'work', ref: 'refs/heads/work' });
  g('checkout', '-q', '--detach');                                   // detached HEAD, no usable default → null
  g('config', '--unset', 'init.defaultBranch');
  assert.equal(await defaultBranchRef(dir), null);
  assert.equal(await defaultBranchRef(_mk(join(_tmp(), 'worca-dbr-nogit-'))), null);
  assert.equal(await defaultBranchRef(''), null);
});

test('createDetachedWorktree returns the commit of the ref it checked out (not the live HEAD branch)', async () => {
  const { dir, g } = _dbrRepo('main');
  const main = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'other'); g('commit', '-q', '--allow-empty', '-m', 'o');
  const wtDir = `${dir}-wt`; _dbrDirs.push(wtDir);
  const r = await createDetachedWorktree({ projectDir: dir, worktreeDir: wtDir, ref: 'main' });
  assert.equal(r.commit, main);
});

test('commitOf / isAncestor / defaultBranchRef take an additive timeout (the brief page bounds its git calls)', async () => {
  const { dir, g } = _dbrRepo('main');
  const head = g('rev-parse', 'HEAD');
  assert.equal(await commitOf(dir, 'refs/heads/main', { timeout: 10_000 }), head);
  assert.equal(await isAncestor(dir, head, 'refs/heads/main', { timeout: 10_000 }), true);
  assert.deepEqual(await defaultBranchRef(dir, { timeout: 10_000 }), { branch: 'main', ref: 'refs/heads/main' });
  // a 1 ms budget cannot spawn git: the call gives up instead of using the 30 s default
  assert.equal(await commitOf(dir, 'refs/heads/main', { timeout: 1 }), null);
  assert.equal(await isAncestor(dir, head, 'refs/heads/main', { timeout: 1 }), false);
  assert.equal(await defaultBranchRef(dir, { timeout: 1 }), null);
});
