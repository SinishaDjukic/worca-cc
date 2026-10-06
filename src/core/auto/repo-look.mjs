// A short-lived, read-only DETACHED checkout the Auto classifier may Grep/Glob/Read
// (spec D6 amendment, 2026-09-07). The run path needs none: the run's own worktree IS
// the checkout (orchestrator.mjs _autoRound passes this.runCwd). The chat path
// (propose_workflow) has no worktree, so it borrows one here for the duration of ONE
// classifier call and removes it in close(). fs + the DB-free git primitives of
// ../worktree.mjs only — no shell, no hard-coded separators; no agent key is named here (D23).
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
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

export const REPO_LOOK_MAX_MEMBERS = 8;   // = the workspace fan-out cap (phases.mjs "cap 8")

/**
 * A throwaway parent dir with a DETACHED checkout of each member's HEAD at repos/<projectKey> —
 * the shape of a detached run root (D-W7). Members past `maxMembers`, without git, or whose
 * checkout fails are skipped (fingerprint-only). Never throws.
 * @param {Array<{projectKey:string, projectDir:string}>} members sorted by projectKey
 * @param {string} baseDir
 * @param {{signal?:AbortSignal|null, log?:(msg:string)=>void, maxMembers?:number}} [o]
 * @returns {Promise<{cwd:string, members:string[], close:() => Promise<void>}|null>} null ⇒ no member checked out
 */
export async function openWorkspaceRepoLook(members, baseDir, { signal = null, log = () => {}, maxMembers = REPO_LOOK_MAX_MEMBERS } = {}) {
  if (!baseDir || !Array.isArray(members) || !members.length) return null;
  const root = join(baseDir, `${REPO_LOOK_DIRNAME}-${randomBytes(4).toString('hex')}`);
  const made = [];                                   // [{ projectDir, worktreeDir, projectKey }]
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const c of made) {
      try {
        const res = await removeWorktree({ projectDir: c.projectDir, worktreeDir: c.worktreeDir, branch: null, force: true });
        for (const s of (res.steps || []).filter((x) => !x.ok)) log(`repo look: ${s.step} failed for ${c.worktreeDir}: ${s.stderr || 'unknown error'}`);
      } catch (err) { log(`repo look: could not remove ${c.worktreeDir}: ${err && err.message ? err.message : err}`); }
    }
    try { rmSync(root, { recursive: true, force: true }); } catch (err) { log(`repo look: could not remove ${root}: ${err && err.message ? err.message : err}`); }
  };
  try {
    mkdirSync(join(root, 'repos'), { recursive: true });
    for (const m of members.slice(0, Math.max(0, maxMembers))) {
      if (signal?.aborted) throw new Error('aborted between checkouts');
      if (!m?.projectKey || !m.projectDir || !existsSync(join(m.projectDir, '.git'))) { log(`repo look: ${m?.projectKey || '?'} has no git repository — fingerprint only`); continue; }
      if (!(await isValidSourceRef(m.projectDir, 'HEAD'))) { log(`repo look: ${m.projectKey} has no valid HEAD — fingerprint only`); continue; }
      const worktreeDir = join(root, 'repos', m.projectKey);
      try {
        await createDetachedWorktree({ projectDir: m.projectDir, worktreeDir, ref: 'HEAD', ...(signal ? { signal } : {}) });
        made.push({ projectDir: m.projectDir, worktreeDir, projectKey: m.projectKey });
      } catch (err) {
        if (signal?.aborted) throw err;
        log(`repo look: ${m.projectKey} checkout failed (${err && err.message ? err.message : err}) — fingerprint only`);
      }
    }
    if (members.length > maxMembers) log(`repo look: ${members.length - maxMembers} member(s) past the ${maxMembers}-checkout cap — fingerprint only`);
    if (!made.length) { await close(); return null; }
    return { cwd: root, members: made.map((c) => c.projectKey), close };
  } catch (err) {
    log(`repo look unavailable (${err && err.message ? err.message : err}); classifying from the task text only`);
    await close();                                   // an abort mid-way leaves nothing behind
    return null;
  }
}

/**
 * Remove `auto-look-*` dirs under baseDir older than `maxAgeMs` (a crashed chat child's leftovers).
 * Handles both layouts: a single-project look (the dir IS the worktree) and a workspace look
 * (repos/<key>/ worktrees). The source repo of each checkout is read from its `.git` FILE
 * (`gitdir: <repo>/.git/worktrees/<name>`); an unreadable one is just deleted —
 * createDetachedWorktree runs `git worktree prune` in that repo before its next checkout.
 * @returns {Promise<{removed:string[], failed:string[]}>}  never throws
 */
export async function sweepRepoLooks(baseDir, { maxAgeMs = 3_600_000, now = Date.now(), log } = {}) {
  const removed = [];
  const failed = [];
  const warn = (msg) => { if (log) log('warn', msg); };
  let entries = [];
  try { entries = baseDir ? readdirSync(baseDir, { withFileTypes: true }) : []; } catch { return { removed, failed }; }   // ENOENT: no chat has run yet
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith(`${REPO_LOOK_DIRNAME}-`)) continue;
    const dir = join(baseDir, e.name);
    try {
      if (statSync(dir).mtimeMs >= now - maxAgeMs) continue;          // maybe a live look of a concurrent chat
      const reposDir = join(dir, 'repos');
      const checkouts = existsSync(join(dir, '.git')) ? [dir]          // single-project look: the dir IS the worktree
        : existsSync(reposDir) ? readdirSync(reposDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(reposDir, d.name))
          : [];
      for (const wt of checkouts) {
        const projectDir = sourceRepoOf(wt);
        if (!projectDir) { warn(`repo-look sweep: ${wt} has no readable .git file — deleting the dir only`); continue; }
        // realpath: git records the worktree by its realpath; baseDir may sit under a symlink (macOS /var → /private/var)
        const res = await removeWorktree({ projectDir, worktreeDir: realpathOr(wt), branch: null, force: true });
        for (const s of (res.steps || []).filter((x) => !x.ok)) warn(`repo-look sweep: ${s.step} failed for ${wt}: ${s.stderr || 'unknown error'}`);
      }
      rmSync(dir, { recursive: true, force: true });
      (existsSync(dir) ? failed : removed).push(dir);                  // success = the dir is gone, not every git step ok
    } catch (err) {
      warn(`repo-look sweep: could not remove ${dir}: ${err && err.message ? err.message : err}`);
      failed.push(dir);
    }
  }
  return { removed, failed };
}

const realpathOr = (p) => { try { return realpathSync(p); } catch { return p; } };

/** `<repo>` from a worktree's `.git` FILE (`gitdir: <repo>/.git/worktrees/<name>`), or null. */
function sourceRepoOf(worktreeDir) {
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(join(worktreeDir, '.git'), 'utf8'));
    if (!m) return null;
    const adminDir = m[1].trim();                        // <repo>/.git/worktrees/<name>
    const repo = dirname(dirname(dirname(adminDir)));    // worktrees/<name> → .git → <repo>
    return isAbsolute(adminDir) && existsSync(join(repo, '.git')) ? repo : null;
  } catch { return null; }
}
