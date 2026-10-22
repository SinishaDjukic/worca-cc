// test/git-raw-spawn-lint.test.mjs — security G2 drift guard. Every git call worca runs in a project or run
// checkout gets git-guard's env (guardedGitEnv), and every `worktree add` goes through guardedWorktreeAdd.
// A raw execFile/spawn of git anywhere else in src/ must be listed here, with why it is safe: the call passes the
// guarded env itself, or it is plumbing that never runs a config command (rev-parse, ls-files without an index
// refresh, remote get-url, …), or it runs in a repository worca made and agents cannot write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RAW = /\b(?:execFile|execFileSync|execFileP|spawn|spawnSync|exec|execSync)\(\s*['"`]git\b/g;

// file → [count, why]
const ALLOWED = {
  'src/core/git-guard.mjs': [3, 'the guard itself: the config listing (async + sync) and guardedWorktreeAdd, which pass the guarded env'],
  'src/core/worktree.mjs': [1, 'git(): env from guardedGitEnv'],
  'src/core/run-harness.mjs': [1, '_git(): env from guardedGitEnv'],
  'src/core/git-sync.mjs': [1, 'env from guardedGitEnv'],
  'src/core/metrics/sync.mjs': [2, 'defaultGit(): env from guardedGitEnv; originUrl(): plumbing (remote get-url)'],
  'src/core/preflight.mjs': [1, 'env from guardedGitEnvSync'],
  'src/core/mcpjson-approval.mjs': [1, 'env from guardedGitEnvSync'],
  'src/core/run-context.mjs': [2, 'env from guardedGitEnvSync'],
  'src/core/engines/cursor.mjs': [1, 'env from guardedGitEnvSync'],
  'src/core/workspace-map/files.mjs': [1, 'env from guardedGitEnv'],
  'src/core/git-lock.mjs': [1, 'plumbing: rev-parse / for-each-ref'],
  'src/core/in-base.mjs': [1, 'plumbing: merge-base / rev-parse'],
  'src/core/store.mjs': [1, 'plumbing: rev-parse --git-common-dir'],
  'src/core/workspaces.mjs': [2, 'plumbing: rev-parse'],
  'src/core/workspace-import.mjs': [1, 'plumbing: rev-parse / remote get-url / for-each-ref, no optional locks'],
  'src/core/script-bench.mjs': [1, 'plumbing: rev-parse HEAD'],
  'src/core/checkout.mjs': [1, 'plumbing: worktree prune (removes stale registrations, runs no command)'],
  'src/core/workspace-map/detectors/git-submodules.mjs': [1, 'plumbing: remote get-url'],
  'src/core/git-available.mjs': [1, 'git --version, no repository'],
  'src/core/project-create.mjs': [2, 'git init of a new folder worca creates'],
  'src/core/skills-registry/import.mjs': [1, 'clone/fetch of a registry into a worca-owned cache, never a project'],
  'src/core/marketplace-publish.mjs': [1, 'a worca-owned clone of a marketplace repository, hook-free'],
  'src/core/plugin-repo.mjs': [2, 'a worca-owned bare cache of a plugin repository (--git-dir), no work tree'],
  'src/core/plugin-inventory.mjs': [1, 'git archive from the same worca-owned bare cache'],
  'src/cli/container.mjs': [1, 'git config --get from the CLI user\'s own shell, outside any checkout'],
};

function* files(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(mjs|js|cjs)$/.test(e.name)) yield p;
  }
}

test('no raw git spawn outside git-guard and the listed, reviewed call sites', () => {
  const found = {};
  for (const f of files(join(ROOT, 'src'))) {
    const n = (readFileSync(f, 'utf8').match(RAW) || []).length;
    if (n) found[relative(ROOT, f).split('\\').join('/')] = n;
  }
  const expected = Object.fromEntries(Object.entries(ALLOWED).map(([f, [n]]) => [f, n]));
  assert.deepEqual(found, expected, 'a new raw git spawn: use the file\'s guarded runner, or add it to ALLOWED with why it is safe');
});

test('every `worktree add` goes through guardedWorktreeAdd', () => {
  const hits = [];
  for (const f of files(join(ROOT, 'src'))) {
    const rel = relative(ROOT, f).split('\\').join('/');
    if (rel === 'src/core/git-guard.mjs') continue;
    if (/['"`]worktree['"`]\s*,\s*['"`]add['"`]/.test(readFileSync(f, 'utf8'))) hits.push(rel);
  }
  assert.deepEqual(hits, []);
});
