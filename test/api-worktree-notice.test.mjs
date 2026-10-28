// test/api-worktree-notice.test.mjs — the summary card's worktree notice routes, over a real repository:
// Get the diff (read-only, a linked folder too) and Apply to branch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { _resetForTests } from '../src/core/db.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

const prev = { WORCA_HOME: process.env.WORCA_HOME, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
const created = [];
let homeDir, srv, base, repo;
const JSONH = { 'Content-Type': 'application/json' };
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const POSIX = { skip: process.platform === 'win32' ? 'hook scripts are POSIX shell' : false };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wtn-home-'));
  process.env.WORCA_HOME = homeDir;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  _resetForTests();
  const { addProject } = await import('../src/core/projects.mjs');
  const raw = templateRepo('wtn', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } });
  created.push(raw);
  repo = await realpath(raw);
  await addProject({ name: basename(repo), path: repo });
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  for (const d of created) await rm(d, { recursive: true, force: true, maxRetries: 10 }).catch(() => {});
  await rm(homeDir, { recursive: true, force: true, maxRetries: 10 }).catch(() => {});
});

/** A finished run on `feature`, branch created from main. */
async function doneRun(feature, extra = {}) {
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  git(repo, ['branch', feature]);
  return seedPipeline(repo, { status: 'done', title: 'Add login', branch: { source: 'main', feature, worktreeRemoved: true, branchKept: true, ...extra } });
}

test('Get the diff: a checkout\'s uncommitted changes as a patch; the folder\'s index untouched', async () => {
  const { id, key } = await doneRun('worca-cc/diff1');
  const co = await fetch(`${base}/api/runs/${id}/checkout?projectKey=${key}`, { method: 'POST', headers: JSONH, body: '{}' });
  assert.equal(co.status, 200);
  const dir = (await co.json()).members[0].worktreeDir;
  await writeFile(join(dir, 'README.md'), '# hi\nmore\n');
  await writeFile(join(dir, 'new.txt'), 'untracked\n');
  const before = [git(dir, ['status', '--porcelain']).stdout, git(dir, ['diff', '--cached', '--name-only']).stdout];
  const res = await fetch(`${base}/api/runs/${id}/checkout/diff?projectKey=${key}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/x-diff/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="uncommitted-worca-cc-diff1\.patch"/);
  const patch = await res.text();
  assert.match(patch, /\+more/);
  assert.match(patch, /new\.txt[\s\S]*\+untracked/);
  assert.deepEqual([git(dir, ['status', '--porcelain']).stdout, git(dir, ['diff', '--cached', '--name-only']).stdout], before);
  git(dir, ['checkout', '--', 'README.md']);
  await rm(join(dir, 'new.txt'));
  assert.equal((await fetch(`${base}/api/runs/${id}/checkout/diff?projectKey=${key}`)).status, 204, 'clean: nothing to download');
});

test('Get the diff works on a linked folder (the person\'s own clone) without staging anything', async () => {
  const { id, key } = await doneRun('worca-cc/linked1');
  const mine = await mkdtemp(join(tmpdir(), 'worca-cc-wtn-mine-'));
  created.push(mine);
  await rm(mine, { recursive: true });
  git(repo, ['worktree', 'add', '-q', mine, 'worca-cc/linked1']);   // the branch lives in "their" folder
  const co = await fetch(`${base}/api/runs/${id}/checkout?projectKey=${key}`, { method: 'POST', headers: JSONH, body: JSON.stringify({ useExisting: true }) });
  assert.equal(co.status, 200);
  assert.equal((await co.json()).members[0].external, true);
  await writeFile(join(mine, 'staged.txt'), 'theirs, staged\n');
  git(mine, ['add', 'staged.txt']);
  await writeFile(join(mine, 'loose.txt'), 'theirs, not staged\n');
  const res = await fetch(`${base}/api/runs/${id}/checkout/diff?projectKey=${key}`);
  assert.equal(res.status, 200);
  const patch = await res.text();
  assert.match(patch, /staged\.txt/);
  assert.match(patch, /loose\.txt/);
  assert.equal(git(mine, ['diff', '--cached', '--name-only']).stdout.trim(), 'staged.txt', 'their index is exactly as they left it');
});

test('Get the diff refuses a run that is not checked out (409) and a scope that does not match (404)', async () => {
  const { id, key } = await doneRun('worca-cc/none1');
  const r = await fetch(`${base}/api/runs/${id}/checkout/diff?projectKey=${key}`);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'NOT_CHECKED_OUT');
  assert.equal((await fetch(`${base}/api/runs/${id}/checkout/diff?projectKey=other-0cea65fb`)).status, 404);
});

/** A retained run: worktree with staged work, the commitFailed stamp on its record. */
async function retainedRun(feature) {
  const { createWorktree } = await import('../src/core/worktree.mjs');
  const { updateBranchRecords } = await import('../src/core/checkout.mjs');
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  const { id, key } = await seedPipeline(repo, { status: 'done', title: 'Add login', branch: { source: 'main' } });
  const wt = await createWorktree({ projectDir: repo, pipelineId: id, sourceBranch: 'main', featureBranch: feature });
  await writeFile(join(wt.worktreeDir, 'login.js'), 'export const login = 1;\n');
  git(wt.worktreeDir, ['add', '-A']);
  updateBranchRecords(id, [key], (br) => Object.assign(br, { feature: wt.branch, worktreeDir: wt.worktreeDir,
    worktreeRemoved: false, branchKept: true, commitFailed: { code: 'commit_failed', step: 'commit', message: 'boom', at: new Date().toISOString() } }));
  return { id, key, wt };
}

test('Apply to branch: the work lands on the branch, the worktree goes, and Check out works again', async () => {
  const { id, key, wt } = await retainedRun('worca-cc/apply1');
  const refused = await fetch(`${base}/api/runs/${id}/checkout?projectKey=${key}`, { method: 'POST', headers: JSONH, body: '{}' });
  assert.equal((await refused.json()).code, 'RETAINED', 'Check out is refused while work is retained');
  const res = await fetch(`${base}/api/runs/${id}/apply-retained?projectKey=${key}`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.applied.length, 1);
  assert.equal(body.failed.length, 0);
  assert.equal(git(repo, ['cat-file', '-e', `${wt.branch}:login.js`]).status, 0);
  assert.equal(existsSync(wt.worktreeDir), false);
  const co = await fetch(`${base}/api/runs/${id}/checkout?projectKey=${key}`, { method: 'POST', headers: JSONH, body: '{}' });
  assert.equal(co.status, 200, 'Check out works again');
  await fetch(`${base}/api/runs/${id}/checkout?projectKey=${key}`, { method: 'DELETE', headers: JSONH, body: '{}' });
});

test('Apply to branch: a commit that fails again answers 409 COMMIT_FAILED with git\'s message', POSIX, async () => {
  const { id, key, wt } = await retainedRun('worca-cc/apply2');
  const hook = join(repo, '.git', 'hooks', 'pre-commit');
  await writeFile(hook, '#!/bin/sh\necho "typecheck failed" >&2\nexit 1\n');
  await chmod(hook, 0o755);
  try {
    const res = await fetch(`${base}/api/runs/${id}/apply-retained?projectKey=${key}`, { method: 'POST' });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'COMMIT_FAILED');
    assert.match(body.error, /typecheck failed/);
    assert.equal(existsSync(wt.worktreeDir), true, 'the retained state stays');
  } finally {
    await rm(hook, { force: true });
  }
});

test('Apply to branch: 404 for an unknown run, 400 without a scope, 200 empty when nothing is retained', async () => {
  const { id, key } = await doneRun('worca-cc/apply3');
  assert.equal((await fetch(`${base}/api/runs/deadbeef/apply-retained?projectKey=${key}`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${base}/api/runs/${id}/apply-retained`, { method: 'POST' })).status, 400);
  const res = await fetch(`${base}/api/runs/${id}/apply-retained?projectKey=${key}`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).applied, []);
});

test('Get the diff of a linked folder switched off the run\'s branch: only its uncommitted work, never the run\'s commits reversed', async () => {
  const { id, key } = await doneRun('worca-cc/linked2');
  const mine = await mkdtemp(join(tmpdir(), 'worca-cc-wtn-mine-'));
  created.push(mine);
  await rm(mine, { recursive: true });
  git(repo, ['worktree', 'add', '-q', mine, 'worca-cc/linked2']);
  await writeFile(join(mine, 'run.txt'), 'the run\'s work\n');
  git(mine, ['add', 'run.txt']);
  git(mine, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'the run']);   // the branch now carries a commit main lacks
  const co = await fetch(`${base}/api/runs/${id}/checkout?projectKey=${key}`, { method: 'POST', headers: JSONH, body: JSON.stringify({ useExisting: true }) });
  assert.equal(co.status, 200);
  git(mine, ['switch', '-q', '-c', 'elsewhere', 'main']);            // the person moves their folder on, still linked
  await writeFile(join(mine, 'loose.txt'), 'theirs\n');
  const res = await fetch(`${base}/api/runs/${id}/checkout/diff?projectKey=${key}`);
  assert.equal(res.status, 200);
  const patch = await res.text();
  assert.match(patch, /loose\.txt/);
  assert.doesNotMatch(patch, /run\.txt|deleted file/, 'the patch is against the folder\'s own HEAD');
});
