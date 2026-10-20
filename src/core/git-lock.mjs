// A git killed while it holds the index lock (SIGKILL — a timeout, an OOM kill, a crashed
// agent tool — skips git's own cleanup) leaves `index.lock` behind, and every later index
// write in that checkout fails with "File exists" until someone removes it. Left alone, one
// such leftover silently breaks the per-step staging for the rest of a run and then the
// teardown commit (pipeline 25d78e23).
import { execFile } from 'node:child_process';
import { stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gitAvailable } from './git-available.mjs';

// git writes index.lock once, when it takes the lock, so the mtime is the lock's age, not
// its last activity. No index write that worca or an agent runs should hold it this long;
// the one known exception is a `git commit` whose pre-commit hook runs longer than this.
export const STALE_INDEX_LOCK_MS = 10 * 60_000;

/** The checkout's index.lock path; asking git covers linked worktrees (.git/worktrees/<n>/). */
function indexLockPath(cwd) {
  if (!gitAvailable()) return Promise.resolve(null);
  return new Promise((done) => {
    execFile('git', ['rev-parse', '--git-path', 'index.lock'], { cwd, timeout: 30_000 }, (err, stdout) => {
      done(err ? null : resolve(cwd, String(stdout).trim()));
    });
  });
}

/**
 * Remove the checkout's `index.lock` when it is stale. Call it after an index write failed;
 * it reads the lock from disk rather than git's (localized) error text. Returns
 * `{ path, ageMs }` when it removed a lock, so the caller should retry, else `null` (no
 * lock, or one young enough that a live git may own it).
 * @param {string} cwd
 * @param {{maxAgeMs?:number}} [opts]
 * @returns {Promise<{path:string, ageMs:number}|null>}
 */
export async function clearStaleIndexLock(cwd, { maxAgeMs = STALE_INDEX_LOCK_MS } = {}) {
  const path = await indexLockPath(cwd);
  if (!path) return null;
  let st;
  try { st = await stat(path); } catch { return null; }
  const ageMs = Date.now() - st.mtimeMs;
  if (ageMs < maxAgeMs) return null;
  // A live git could replace the lock between the stat and the unlink; the window is a few
  // microseconds against a lock nobody has touched for STALE_INDEX_LOCK_MS.
  try { await unlink(path); } catch (err) { if (err.code !== 'ENOENT') return null; }
  return { path, ageMs };
}

/** The run warning / audit line for a lock clearStaleIndexLock removed. */
export function staleIndexLockNote({ path, ageMs }) {
  return `removed a stale git index lock (${Math.round(ageMs / 60_000)} min old, left by a killed git process): ${path}`;
}
