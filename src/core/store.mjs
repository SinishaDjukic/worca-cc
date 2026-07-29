// src/core/store.mjs
// Durable project identity + external history store paths.
// key = <repo-basename-slug>-<sha1(canonicalRoot)[:8]>. Canonical root is the
// parent of the shared .git (via `git rev-parse --git-common-dir`), so every
// worktree of a repo maps to the SAME key. All resolution is sync + fail-safe:
// a non-repo / missing git degrades to the realpath of the dir, never throwing.

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname, basename, isAbsolute } from 'node:path';
import { worcaHome } from './projects.mjs';

const _keyCache = new Map();

/** Absolute path to the canonical main-repo root for `projectDir`. */
export function canonicalProjectRoot(projectDir) {
  const dir = resolve(projectDir);
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (common) {
      const commonAbs = isAbsolute(common) ? common : resolve(dir, common);
      const root = dirname(commonAbs); // parent of the .git dir
      try { return realpathSync(root); } catch { return resolve(root); }
    }
  } catch {
    /* not a git repo, or git unavailable — fall through */
  }
  try { return realpathSync(dir); } catch { return dir; }
}

/** Stable key for a project. Memoized by resolved input path. */
export function projectKey(projectDir) {
  const cacheKey = resolve(projectDir);
  const hit = _keyCache.get(cacheKey);
  if (hit) return hit;
  const root = canonicalProjectRoot(projectDir);
  const slug =
    basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  const hash = createHash('sha1').update(root).digest('hex').slice(0, 8);
  const key = `${slug}-${hash}`;
  _keyCache.set(cacheKey, key);
  return key;
}

/** Root of the external history store: <worcaHome>/store. */
export function storeRoot() {
  return join(worcaHome(), 'store');
}

/** Per-project store directory: <worcaHome>/store/<key>. */
export function projectStorePath(key) {
  return join(storeRoot(), key);
}

/** Root of the workspace store namespace: <worcaHome>/store/workspaces. */
export function workspacesStoreRoot() {
  return join(storeRoot(), 'workspaces');
}

/** Per-workspace store directory: <worcaHome>/store/workspaces/<workspaceKey>. */
export function workspaceStorePath(workspaceKey) {
  return join(workspacesStoreRoot(), workspaceKey);
}
