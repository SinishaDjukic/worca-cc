// A git killed while it holds a lock (SIGKILL — a timeout, an OOM kill, a crashed agent tool —
// skips git's own cleanup) leaves the lock file behind, and every later git that needs it fails
// with "File exists" until someone removes it. Left alone, one such leftover silently breaks the
// per-step staging for the rest of a run and then the teardown commit (pipeline 25d78e23).
// `git commit` holds index.lock until after it has moved the branch, and moving the branch takes
// HEAD.lock and the branch's ref lock too, so a commit killed at that point leaves all three.
// The reftable ref backend (extensions.refStorage=reftable) locks reftable/tables.list.lock instead
// of HEAD and ref lock files; it is out of scope: its leftover is not cleared here.
import { execFile } from 'node:child_process';
import { stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gitAvailable } from './git-available.mjs';

// git writes a lock once, when it takes it, so the mtime is the lock's age, not its last
// activity. No git that worca or an agent runs should hold one this long; the one known
// exception is a `git commit` whose pre-commit hook runs longer than this (index.lock).
// The branch ref lock and packed-refs.lock live in the common git folder, so another run's
// commit in another worktree may hold the very same file right now: the age keeps that safe
// too, since a live git holds a ref lock for milliseconds, never for this long.
export const STALE_INDEX_LOCK_MS = 10 * 60_000;

function gitOut(cwd, args) {
  return new Promise((done) => {
    execFile('git', args, { cwd, timeout: 30_000 }, (err, stdout) => done(err ? null : String(stdout)));
  });
}

/**
 * The checkout's lock paths, each with the kind its note names. `--git-path` maps each one to its
 * folder: index.lock and HEAD.lock to the checkout's own gitdir (.git/worktrees/<n>/ for a linked
 * worktree), the branch ref and packed-refs locks to the common .git. A detached HEAD has no branch,
 * so no ref lock is checked.
 */
async function gitLockPaths(cwd) {
  if (!gitAvailable()) return [];
  const ref = (await gitOut(cwd, ['symbolic-ref', '-q', 'HEAD']))?.trim();
  const locks = [['index', 'index.lock'], ['HEAD', 'HEAD.lock'],
    ...(ref ? [['branch ref', `${ref}.lock`]] : []), ['packed-refs', 'packed-refs.lock']];
  const out = await gitOut(cwd, ['rev-parse', ...locks.flatMap(([, name]) => ['--git-path', name])]);
  const paths = out === null ? [] : out.split('\n').slice(0, locks.length);
  if (paths.length !== locks.length || paths.some((p) => !p)) return [];
  return locks.map(([kind], i) => ({ kind, path: resolve(cwd, paths[i]) }));
}

/**
 * Remove every stale lock of the checkout: index.lock, HEAD.lock, the checked-out branch's ref lock
 * and packed-refs.lock. Call it after a git that writes the index or moves the branch failed; it reads
 * the locks from disk rather than git's (localized) error text. Returns `{ kind, path, ageMs }` for
 * each lock it removed, so the caller should retry when the list is not empty; a lock young enough
 * that a live git may own it is kept.
 * @param {string} cwd
 * @param {{maxAgeMs?:number}} [opts]
 * @returns {Promise<Array<{kind:string, path:string, ageMs:number}>>}
 */
export async function clearStaleGitLocks(cwd, { maxAgeMs = STALE_INDEX_LOCK_MS } = {}) {
  const removed = [];
  for (const { kind, path } of await gitLockPaths(cwd)) {
    let st;
    try { st = await stat(path); } catch { continue; }
    const ageMs = Date.now() - st.mtimeMs;
    if (ageMs < maxAgeMs) continue;
    // A live git could replace the lock between the stat and the unlink; the window is a few
    // microseconds against a lock nobody has touched for STALE_INDEX_LOCK_MS.
    try { await unlink(path); } catch (err) { if (err.code !== 'ENOENT') continue; }
    removed.push({ kind, path, ageMs });
  }
  return removed;
}

/** The run warning / audit line for one lock clearStaleGitLocks removed. */
export function staleGitLockNote({ kind, path, ageMs }) {
  return `removed a stale git ${kind} lock (${Math.round(ageMs / 60_000)} min old, left by a killed git process): ${path}`;
}
