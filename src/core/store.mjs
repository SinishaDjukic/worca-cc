// src/core/store.mjs
// Durable project identity + external history store paths.
// key = <repo-basename-slug>-<sha1(canonicalRoot)[:8]>. Canonical root is the
// parent of the shared .git (via `git rev-parse --git-common-dir`), so every
// worktree of a repo maps to the SAME key. All resolution is sync + fail-safe:
// a non-repo / missing git degrades to the realpath of the dir, never throwing.

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname, basename, isAbsolute } from 'node:path';
import { worcaHome } from './projects.mjs';
import { gitAvailable } from './git-available.mjs';

const _keyCache = new Map();

const _rootCache = new Map(); // resolve(projectDir) -> { root, marker, common }

/** Test seam: forget every cached canonicalProjectRoot() answer. */
export function _resetCanonicalRootCache() { _rootCache.clear(); }

// The nearest .git at or above dir (the one git discovers first), as a string that changes when
// that .git is created, removed or replaced (its inode; a worktree's .git FILE also by mtime).
function gitMarker(dir) {
  for (let p = dir; ;) {
    try {
      const st = statSync(join(p, '.git'));
      if (st.isFile()) return JSON.stringify([p, st.ino, st.mtimeMs]);
      // git skips a .git dir it cannot use (no HEAD), so the marker does too: else a later
      // `git init` in that very dir (same inode) would leave the cached parent answer standing.
      if (existsSync(join(p, '.git', 'HEAD'))) return JSON.stringify([p, st.ino, 'dir']);
    } catch { /* not here: one level up */ }
    const up = dirname(p);
    if (up === p) return '';
    p = up;
  }
}

/** Absolute path to the canonical main-repo root for `projectDir`. Memoized while the nearest
 *  .git marker is unchanged (workspaces.mjs assertUniqueSet resolves every member of every
 *  workspace on each write); the non-git fallback is never cached — a dir can become a repo. */
export function canonicalProjectRoot(projectDir) {
  const dir = resolve(projectDir);
  const marker = gitMarker(dir);
  const hit = _rootCache.get(dir);
  if (hit && marker && hit.marker === marker && existsSync(hit.common)) return hit.root;
  if (!gitAvailable()) { _rootCache.delete(dir); try { return realpathSync(dir); } catch { return dir; } }
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (common) {
      const commonAbs = isAbsolute(common) ? common : resolve(dir, common);
      const root = dirname(commonAbs); // parent of the .git dir
      let out;
      try { out = realpathSync(root); } catch { out = resolve(root); }
      if (marker) _rootCache.set(dir, { root: out, marker, common: commonAbs });
      else _rootCache.delete(dir);
      return out;
    }
  } catch {
    /* not a git repo, or git unavailable — fall through */
  }
  _rootCache.delete(dir);
  try { return realpathSync(dir); } catch { return dir; }
}

/** The SHAPE projectKey() produces — `<slug>-<sha1[:8]>`, lowercase. One source of truth for the
 *  readers that validate a key before a lookup or a path join (ui/server.mjs' /api/memory routes),
 *  next to WORKSPACE_KEY_RE's role in workspaces.mjs. */
export const PROJECT_KEY_RE = /^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/;

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
  if (gitAvailable()) _keyCache.set(cacheKey, key);
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
