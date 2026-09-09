// A short-lived, read-only DETACHED checkout the Auto classifier may Grep/Glob/Read
// (spec D6 amendment, 2026-09-07). The run path needs none: the run's own worktree IS
// the checkout (orchestrator.mjs _autoRound passes this.runCwd). The chat path
// (propose_workflow) has no worktree, so it borrows one here for the duration of ONE
// classifier call and removes it in close(). fs + the DB-free git primitives of
// ../worktree.mjs only — no shell, no hard-coded separators; no agent key is named here (D23).
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createDetachedWorktree, removeWorktree, isValidSourceRef } from '../worktree.mjs';

export const REPO_LOOK_DIRNAME = 'auto-look';

/**
 * @param {string} projectDir the project's live checkout — read for HEAD, never used as cwd
 * @param {string} baseDir where the throwaway checkout lives (the chat passes <worcaHome>/tmp/ask)
 * @param {{signal?:AbortSignal|null, log?:(msg:string)=>void}} [o]
 * @returns {Promise<{cwd:string, close:() => Promise<void>}|null>} null ⇒ no git repository, HEAD does
 *   not resolve, or git failed — the caller then classifies from the task text only, as before.
 */
export async function openRepoLook(projectDir, baseDir, { signal = null, log = () => {} } = {}) {
  try {
    if (!projectDir || !baseDir || !existsSync(join(projectDir, '.git'))) return null;
    if (signal?.aborted) throw new Error('aborted before the checkout');
    if (!(await isValidSourceRef(projectDir, 'HEAD'))) return null;
    mkdirSync(baseDir, { recursive: true });
    const worktreeDir = join(baseDir, `${REPO_LOOK_DIRNAME}-${randomBytes(4).toString('hex')}`);
    // The signal is spread in ONLY when present: worktree.mjs's git() forwards it verbatim to
    // child_process.spawn, and Node rejects `options.signal: null` (ERR_INVALID_ARG_TYPE) — git()
    // would swallow that as ok:false and this whole look would silently degrade to text-only.
    await createDetachedWorktree({ projectDir, worktreeDir, ref: 'HEAD', ...(signal ? { signal } : {}) });
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      try {
        const res = await removeWorktree({ projectDir, worktreeDir, branch: null, force: true });
        for (const s of (res.steps || []).filter((x) => !x.ok)) log(`repo look: ${s.step} failed for ${worktreeDir}: ${s.stderr || 'unknown error'}`);
      } catch (err) { log(`repo look: could not remove ${worktreeDir}: ${err && err.message ? err.message : err}`); }
    };
    return { cwd: worktreeDir, close };
  } catch (err) {
    log(`repo look unavailable (${err && err.message ? err.message : err}); classifying from the task text only`);
    return null;
  }
}
