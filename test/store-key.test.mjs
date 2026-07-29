// test/store-key.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectKey, canonicalProjectRoot, storeRoot, projectStorePath, workspacesStoreRoot, workspaceStorePath } from '../src/core/store.mjs';

function git(cwd, args) { execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }); }

test('main repo and its worktree resolve to the same key', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'worca-cc-key-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 't@t']);
  git(repo, ['config', 'user.name', 't']);
  await writeFile(join(repo, 'f.txt'), 'hi', 'utf8');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'init']);
  const wt = join(repo, '.worca-cc', 'worktrees', 'wt1');
  await mkdir(join(repo, '.worca-cc', 'worktrees'), { recursive: true });
  git(repo, ['worktree', 'add', '-q', '-b', 'feat-x', wt, 'HEAD']);

  const kMain = projectKey(repo);
  const kWt = projectKey(wt);
  assert.equal(kWt, kMain, 'worktree must map to the main repo key');
  assert.match(kMain, /^[a-z0-9-]+-[0-9a-f]{8}$/, 'key is <slug>-<sha1[:8]>');
});

test('non-git dir falls back to a realpath-based key (no throw)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-nogit-'));
  const k = projectKey(dir);
  assert.match(k, /-[0-9a-f]{8}$/);
});

test('store paths are rooted under WORCA_HOME/.worca-cc/store', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-home-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  try {
    assert.equal(storeRoot(), join(home, '.worca-cc', 'store'));
    assert.equal(projectStorePath('abc-12345678'), join(home, '.worca-cc', 'store', 'abc-12345678'));
    assert.ok(canonicalProjectRoot(home).length > 0);
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('workspace store paths nest under store/workspaces/<workspaceKey>', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-home-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  try {
    const store = join(home, '.worca-cc', 'store');
    assert.equal(workspacesStoreRoot(), join(store, 'workspaces'));
    assert.equal(
      workspaceStorePath('wks-demo-12345678'),
      join(store, 'workspaces', 'wks-demo-12345678'),
    );
    // The container is the literal "workspaces" segment under the shared store root.
    assert.equal(workspacesStoreRoot(), projectStorePath('workspaces'));
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});
