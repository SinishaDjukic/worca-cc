// src/core/ask/worktrees.mjs
// Per-thread detached git worktrees of the Ask Worca chat
// (ask-worca-worktrees-design.md §3-§5): registry rows in ask_worktrees,
// checkouts under <worcaHome>/ask/<threadId>/wt/<wtId>. Git mechanics come from
// ../worktree.mjs (DB-free primitives); this module owns rows, paths, caps and
// the sweep. Synchronous DB via getDb()/prepare() — the store.mjs conventions;
// ids are shape-checked before they reach any path (the store.mjs doctrine:
// these paths feed recursive removes).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { getDb, prepare } from '../db.mjs';
import { listProjects } from '../projects.mjs';
import { readStoreMeta, findPipelineRowById } from '../artifacts.mjs';
import { branchExists } from '../git-info.mjs';
import { createDetachedWorktree, removeWorktree, worktreeHead, isValidSourceRef } from '../worktree.mjs';
import { ASK_ID_RE, askRoot } from './store.mjs';
import { ASK_LIMITS } from './limits.mjs';

export const WT_ID_RE = /^wt_[0-9a-f]{8}$/;
// The shared ASK_ID_RE (store.mjs) is the loose /^[a-z]+_[0-9a-f]{8}$/; a thread
// id that becomes a filesystem path is re-checked here against the strict
// ask_-anchored form (matches askWorktreeAllowRules), so a `wt_…`/other-prefix id
// can never reach a path.
const ASK_THREAD_RE = /^ask_[0-9a-f]{8}$/;

export class AskWorktreeError extends Error {
  constructor(message) { super(message); this.name = 'AskWorktreeError'; }
}

const newWtId = () => `wt_${randomBytes(4).toString('hex')}`;
const now = () => new Date().toISOString();
const parse = (v, fallback) => { if (v == null) return fallback; try { return JSON.parse(v); } catch { return fallback; } };

/**
 * `<askRoot>/<threadId>/wt` — refuses a thread id the store never minted, and
 * REALPATHS the dir once it exists. openAskWorktree stores a realpath'd
 * worktree_dir (git emits realpaths; the base is realpath'd), so without this
 * every later `worktreeDirFor`/lookup would MISS on a symlinked home (macOS
 * `/var` -> `/private/var`, any home on a symlinked mount).
 */
export function worktreesDir(threadId) {
  if (typeof threadId !== 'string' || !ASK_THREAD_RE.test(threadId)) {
    throw new Error('worktreesDir: refusing a thread id the store never minted');
  }
  const dir = join(askRoot(), threadId, 'wt');
  try { return realpathSync(dir); } catch { return dir; }   // realpath'd once it exists
}

/** `<askRoot>/<threadId>/wt/<wtId>` — both ids shape-checked. */
export function worktreeDirFor(threadId, wtId) {
  if (typeof wtId !== 'string' || !WT_ID_RE.test(wtId)) {
    throw new Error('worktreeDirFor: refusing a worktree id the store never minted');
  }
  return join(worktreesDir(threadId), wtId);
}

function rowToWorktree(r) {
  return {
    worktreeId: r.id, threadId: r.thread_id, projectKey: r.project_key,
    projectDir: r.project_dir, ref: r.ref, commit: r.resolved_commit,
    runId: r.run_id ?? null, path: r.worktree_dir,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function listAskWorktrees(threadId) {
  getDb();
  return prepare('SELECT * FROM ask_worktrees WHERE thread_id = ? ORDER BY created_at, id')
    .all(threadId).map(rowToWorktree);
}

export function getAskWorktree(threadId, wtId) {
  getDb();
  const r = prepare('SELECT * FROM ask_worktrees WHERE thread_id = ? AND id = ?').get(threadId, wtId);
  return r ? rowToWorktree(r) : null;
}

/** (projectKey, ref) directly, or runId → the record's feature branch;
 *  workspace records need projectKey to pick the member (§5 steps 1-3). */
async function resolveTarget({ projectKey, ref, runId }) {
  if (runId) {
    const row = findPipelineRowById(runId);
    if (!row) throw new AskWorktreeError(`run not found: ${runId}`);
    const isWs = row.target === 'workspace' || !!row.workspace_key;
    if (isWs) {
      const meta = parse(row.workspace_meta, {}) || {};
      const members = Array.isArray(meta.projects) ? meta.projects : [];
      if (!projectKey) {
        throw new AskWorktreeError(`run ${runId} is a workspace run — pass projectKey to pick the member (one of: ${members.map((m) => m.projectKey).join(', ') || 'none'})`);
      }
      const member = members.find((m) => m.projectKey === projectKey);
      const b = (meta.branches || {})[projectKey];
      if (!member || !b || !b.feature) throw new AskWorktreeError(`run ${runId} has no member ${projectKey} with a feature branch`);
      if (!(await branchExists(member.projectDir, b.feature))) {
        throw new AskWorktreeError(`branch ${b.feature} no longer exists — use get_run_diff for the recorded diff`);
      }
      return { projectKey, projectDir: member.projectDir, ref: b.feature, runId };
    }
    const branch = parse(row.branch, {}) || {};
    if (!branch.feature) throw new AskWorktreeError(`run ${runId} has no feature branch`);
    const meta = readStoreMeta(row.project_key);
    const projectDir = meta && meta.path;
    if (!projectDir) throw new AskWorktreeError(`run ${runId}: project directory unknown`);
    if (!(await branchExists(projectDir, branch.feature))) {
      throw new AskWorktreeError(`branch ${branch.feature} no longer exists — use get_run_diff for the recorded diff`);
    }
    return { projectKey: row.project_key, projectDir, ref: branch.feature, runId };
  }
  if (!projectKey || !ref) throw new AskWorktreeError('open_worktree: give (projectKey and ref) or runId');
  const projects = await listProjects();
  const p = projects.find((x) => x.key === projectKey);
  if (!p) throw new AskWorktreeError(`unknown projectKey: ${projectKey} — see list_projects`);
  return { projectKey, projectDir: p.path, ref, runId: null };
}

export async function openAskWorktree({ threadId, projectKey, ref, runId, signal } = {}) {
  getDb();
  if (typeof threadId !== 'string' || !ASK_ID_RE.test(threadId)
      || !prepare('SELECT 1 FROM ask_threads WHERE id = ?').get(threadId)) {
    throw new AskWorktreeError('unknown thread');
  }
  const perThread = prepare('SELECT count(*) AS n FROM ask_worktrees WHERE thread_id = ?').get(threadId).n;
  if (perThread >= ASK_LIMITS.worktreesPerThread) {
    throw new AskWorktreeError(`worktree cap reached (${ASK_LIMITS.worktreesPerThread} per chat) — remove one with remove_worktree, or reuse one from list_worktrees`);
  }
  const globalCount = prepare('SELECT count(*) AS n FROM ask_worktrees').get().n;
  if (globalCount >= ASK_LIMITS.worktreesGlobal) {
    throw new AskWorktreeError(`global worktree cap reached (${ASK_LIMITS.worktreesGlobal}) — remove unused worktrees first`);
  }
  const t = await resolveTarget({
    projectKey: projectKey || undefined, ref: ref || undefined, runId: runId || undefined,
  });
  if (!existsSync(join(t.projectDir, '.git'))) {
    throw new AskWorktreeError(`project ${t.projectKey} has no git repository at ${t.projectDir}`);
  }
  if (!(await isValidSourceRef(t.projectDir, t.ref))) {
    throw new AskWorktreeError(`ref does not resolve: ${JSON.stringify(t.ref)}`);
  }
  const wtId = newWtId();
  mkdirSync(worktreesDir(threadId), { recursive: true });
  // Re-read AFTER mkdir: worktreesDir() realpaths an existing dir, so the stored
  // worktree_dir matches BOTH what `git worktree list` reports AND every later
  // worktreesDir()/worktreeDirFor() lookup. Reading `base` before mkdir would get
  // the un-realpath'd form and every subsequent lookup would miss on a symlinked
  // home (macOS /var -> /private/var). The createWorktree precedent.
  const baseReal = worktreesDir(threadId);
  const dir = join(baseReal, wtId);
  if (!dir.startsWith(baseReal + sep)) throw new AskWorktreeError('worktree path escapes base'); // belt-and-braces
  const { commit } = await createDetachedWorktree({ projectDir: t.projectDir, worktreeDir: dir, ref: t.ref, signal });
  const ts = now();
  prepare(`INSERT INTO ask_worktrees (id, thread_id, project_key, project_dir, ref, resolved_commit, run_id, worktree_dir, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(wtId, threadId, t.projectKey, t.projectDir, t.ref, commit ?? '', t.runId, dir, ts, ts);
  return getAskWorktree(threadId, wtId);
}

export async function removeAskWorktree({ threadId, wtId } = {}) {
  const wt = typeof wtId === 'string' && WT_ID_RE.test(wtId) ? getAskWorktree(threadId, wtId) : null;
  if (!wt) throw new AskWorktreeError('worktree not found');
  const res = await removeWorktree({ projectDir: wt.projectDir, worktreeDir: wt.path, branch: null, force: true });
  prepare('DELETE FROM ask_worktrees WHERE thread_id = ? AND id = ?').run(threadId, wtId);
  return { ok: true, steps: res.steps };
}

/** Thread-delete cascade step (§5): git-proper removal of every row BEFORE the
 *  SQL cascade + the thread-dir rmSync backstop. Never throws — a dead source
 *  repo degrades to removeWorktree's rm-rf + prune best effort. */
export async function removeThreadWorktrees(threadId) {
  if (typeof threadId !== 'string' || !ASK_ID_RE.test(threadId)) return { removed: 0 };
  let removed = 0;
  for (const wt of listAskWorktrees(threadId)) {
    try {
      await removeAskWorktree({ threadId, wtId: wt.worktreeId });
      removed += 1;
    } catch { /* row raced away or repo gone — the rmSync backstop covers the dir */ }
  }
  return { removed };
}

/** After a successful checkout/switch: re-read HEAD and stamp the row so
 *  list_worktrees and the UI always show where the checkout actually points. */
export async function noteWorktreeNavigation(threadId, wtId, { ref } = {}) {
  const wt = getAskWorktree(threadId, wtId);
  if (!wt) return null;
  const head = await worktreeHead(wt.path);
  prepare('UPDATE ask_worktrees SET ref = ?, resolved_commit = ?, updated_at = ? WHERE thread_id = ? AND id = ?')
    .run(ref ?? wt.ref, head ?? wt.commit, now(), threadId, wtId);
  return getAskWorktree(threadId, wtId);
}

/** Recover the source repo of an orphan dir from its `.git` gitdir pointer
 *  (`gitdir: <repo>/.git/worktrees/<name>`), or null. */
function repoDirOfOrphan(dir) {
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(join(dir, '.git'), 'utf8'));
    if (!m) return null;
    const gitdir = m[1].trim();
    const marker = `${sep}.git${sep}worktrees${sep}`;
    const i = gitdir.lastIndexOf(marker);
    return i > 0 ? gitdir.slice(0, i) : null;
  } catch { return null; }
}

/**
 * Boot/doctor sweep (§5): reconcile rows vs dirs BOTH ways. Three-state
 * doctrine — a DB failure aborts the sweep with nothing removed (failed > 0),
 * never "no rows ⇒ reclaim everything".
 * @param {{log?: (level:string, msg:string) => void}} [opts]
 */
export async function sweepAskWorktrees({ log = () => {} } = {}) {
  const summary = { removedDirs: 0, prunedRows: 0, failed: 0 };
  let rows;
  try {
    getDb();
    rows = prepare('SELECT * FROM ask_worktrees').all().map(rowToWorktree);
  } catch (err) {
    summary.failed += 1;
    log('warn', `ask-worktrees: row scan failed — nothing swept (${err.message})`);
    return summary;
  }
  const live = new Set();
  for (const wt of rows) {
    if (existsSync(wt.path)) {
      live.add(await realpath(wt.path).catch(() => wt.path));
      continue;
    }
    try {
      // dir already gone: this is prune + registration cleanup only
      await removeWorktree({ projectDir: wt.projectDir, worktreeDir: wt.path, branch: null, force: true });
      prepare('DELETE FROM ask_worktrees WHERE thread_id = ? AND id = ?').run(wt.threadId, wt.worktreeId);
      summary.prunedRows += 1;
      log('info', `ask-worktrees: dropped stale row ${wt.worktreeId} (dir missing)`);
    } catch (err) {
      summary.failed += 1;
      log('warn', `ask-worktrees: row ${wt.worktreeId} skipped (${err.message})`);
    }
  }
  let root;
  try { root = askRoot(); } catch { return summary; }
  let threads = [];
  try {
    threads = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && ASK_ID_RE.test(d.name)).map((d) => d.name);
  } catch { return summary; }                                 // no ask root yet — nothing to do
  for (const tid of threads) {
    const base = join(root, tid, 'wt');
    let entries = [];
    try {
      entries = readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory() && WT_ID_RE.test(d.name)).map((d) => d.name);
    } catch { continue; }                                     // thread has no wt/ dir
    for (const wtId of entries) {
      const dir = join(base, wtId);
      const real = await realpath(dir).catch(() => dir);
      if (live.has(real)) continue;
      const repoDir = repoDirOfOrphan(dir);
      try {
        await removeWorktree({ projectDir: repoDir ?? dir, worktreeDir: dir, branch: null, force: true });
        if (!existsSync(dir)) {
          summary.removedDirs += 1;
          log('info', `ask-worktrees: removed orphan dir ${dir}`);
        } else {
          summary.failed += 1;
          log('warn', `ask-worktrees: orphan ${dir} could not be removed`);
        }
      } catch (err) {
        summary.failed += 1;
        log('warn', `ask-worktrees: orphan ${dir} skipped (${err.message})`);
      }
    }
  }
  return summary;
}
