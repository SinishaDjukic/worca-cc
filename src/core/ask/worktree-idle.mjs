// src/core/ask/worktree-idle.mjs
// Which Ask Worca checkouts can be freed, and the two guarded ways of freeing them: the
// boot / "Free idle" sweep (only `safe` rows) and the hand remove (a confirm when work
// would be lost). Pure of server state — live use (turn, command, followed run, terminal)
// is INJECTED as `busyFor(threadId, path)`: only the server process can see it, so this
// module is deliberately NOT reachable from the MCP child (worktree-deps.mjs, mcp-stdio.mjs
// and tools.mjs never import it — test/ask-tools.test.mjs scans that). Any doubt means keep.
import { createHash } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { join, resolve as resolvePath, sep } from 'node:path';
import { getDb, prepare } from '../db.mjs';
import { runGitCapture } from '../worktree.mjs';
import { ASK_LIMITS } from './limits.mjs';
import { AskWorktreeError, getAskWorktree, removeAskWorktree } from './worktrees.mjs';

const LIVE_REASONS = new Set(['replying', 'command', 'following', 'terminal']);
const MAX_LISTED = 50;               // dirty files / commits a verdict carries (the confirm lists 10)
const STATUS_MAX_BYTES = 1_000_000;  // past this, `git status` output is "could not check" (keep), not "dirty"
const LOG_MAX_BYTES = 200_000;

const parseMs = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : NaN; };
const nowMs = (now) => (typeof now === 'number' ? now : now instanceof Date ? now.getTime() : Date.now());
const mtimeOfGitFile = (path) => { try { return statSync(join(path, '.git')).mtimeMs; } catch { return NaN; } };

/** The signals that say "someone touched this checkout's chat": the row, the thread and its newest message. */
function touchedSignals(row, mtimeOf) {
  const t = prepare('SELECT updated_at FROM ask_threads WHERE id = ?').get(row.threadId);
  const m = prepare('SELECT max(created_at) AS at FROM ask_messages WHERE thread_id = ?').get(row.threadId);
  return [row.updatedAt, row.createdAt, t && t.updated_at, m && m.at].map(parseMs).concat(mtimeOf(row.path));
}

function lastTouchedMs(row, mtimeOf = mtimeOfGitFile) {
  const ok = touchedSignals(row, mtimeOf).filter(Number.isFinite);
  return ok.length ? Math.max(...ok) : NaN;
}

const fingerprintOf = ({ dirtyAll, shas, truncated, loss }) => createHash('sha256').update(JSON.stringify({
  dirty: [...dirtyAll].sort(), commits: [...shas].sort(), truncated, loss,
})).digest('hex');

function liveUse(busyFor, threadId, path) {
  if (typeof busyFor !== 'function') return 'unknown';
  try {
    const r = busyFor(threadId, path);
    if (r === null) return false;
    return LIVE_REASONS.has(r) ? r : 'unknown';
  } catch { return 'unknown'; }
}

/**
 * The verdict of one `ask_worktrees` row (see the plan's Verdict model). `safe` is the only state
 * automatic freeing accepts.
 * @param {{worktreeId:string, threadId:string, path:string, projectDir?:string, createdAt?:string, updatedAt?:string}} row
 * @param {{now?:number|Date, busyFor?:(threadId:string, path:string)=>string|null, runGit?:Function, signal?:AbortSignal, mtimeOf?:(path:string)=>number}} [opts]
 */
export async function classifyAskWorktree(row, { now, busyFor, runGit = runGitCapture, signal, mtimeOf = mtimeOfGitFile } = {}) {
  const at = nowMs(now);
  const touched = lastTouchedMs(row, mtimeOf);
  const v = {
    worktreeId: row.worktreeId, threadId: row.threadId,
    inUse: liveUse(busyFor, row.threadId, row.path),
    loss: 'none', dirty: false, ownCommits: false, recent: false, missingDir: !existsSync(row.path), safe: false,
    lastTouchedAt: new Date(Number.isFinite(touched) ? touched : 0).toISOString(),
    lost: { dirtyFiles: [], commits: [], truncated: false, fingerprint: '' },
  };
  const seal = () => { v.lost.fingerprint = fingerprintOf({ dirtyAll: v.lost.dirtyFiles, shas: v.lost.commits.map((c) => c.sha), truncated: v.lost.truncated, loss: v.loss }); return v; };
  if (v.inUse !== false) return seal();             // never removable: no probes, no recency
  if (v.missingDir) { v.safe = true; return seal(); }   // a slot with nothing to lose

  const probe = (args, maxBytes) => runGit(row.path, args, { signal, timeoutMs: ASK_LIMITS.worktreeGitCheckMs, maxBytes });
  const status = await probe(['-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all'], STATUS_MAX_BYTES);
  let dirtyAll = [];
  if (!status || !status.ok || status.truncated) v.loss = 'unknown';
  else {
    dirtyAll = status.stdout.split('\n').filter(Boolean).map((l) => l.slice(3));
    if (dirtyAll.length) { v.dirty = true; v.loss = 'work'; }
  }
  const log = await probe(['log', '-n', String(MAX_LISTED), '--format=%H%x09%s', 'HEAD', '--not', '--branches', '--remotes', '--tags'], LOG_MAX_BYTES);
  let commits = [];
  if (!log || !log.ok || log.truncated) v.loss = 'unknown';
  else {
    commits = log.stdout.split('\n').filter(Boolean).map((l) => { const i = l.indexOf('\t'); return { sha: l.slice(0, i), subject: l.slice(i + 1) }; });
    if (commits.length) { v.ownCommits = true; if (v.loss !== 'unknown') v.loss = 'work'; }
  }
  if (v.loss === 'unknown') { v.dirty = false; v.ownCommits = false; }   // a failed probe: the lists would be half-true
  else {
    v.lost.dirtyFiles = dirtyAll.slice(0, MAX_LISTED);
    v.lost.commits = commits;
    v.lost.truncated = dirtyAll.length > MAX_LISTED || commits.length >= MAX_LISTED;
  }
  if (!Number.isFinite(touched)) v.loss = 'unknown';   // no usable clock signal: keep
  v.recent = Number.isFinite(touched) && at - touched < ASK_LIMITS.worktreeIdleMs;
  v.safe = v.loss === 'none' && !v.recent;
  // The fingerprint binds the dirty LIST AS SEEN, not its capped copy, so a swap past the cap is still stale.
  v.lost.fingerprint = fingerprintOf({ dirtyAll, shas: commits.map((c) => c.sha), truncated: v.lost.truncated, loss: v.loss });
  return v;
}

/** Every row joined to its thread, oldest signal first. */
function orderedRows() {
  getDb();
  const rows = prepare(`SELECT w.*, t.title AS thread_title, t.created_by AS thread_created_by
                        FROM ask_worktrees w LEFT JOIN ask_threads t ON t.id = w.thread_id`).all().map((r) => ({
    worktreeId: r.id, threadId: r.thread_id, projectKey: r.project_key, projectDir: r.project_dir, ref: r.ref,
    path: r.worktree_dir, createdAt: r.created_at, updatedAt: r.updated_at,
    title: r.thread_title ?? null, createdBy: r.thread_created_by ?? null,
  }));
  const touched = new Map(rows.map((r) => [r.worktreeId, lastTouchedMs(r)]));
  const key = (r) => (Number.isFinite(touched.get(r.worktreeId)) ? touched.get(r.worktreeId) : 0);
  return rows.sort((a, b) => key(a) - key(b) || a.worktreeId.localeCompare(b.worktreeId));
}

/**
 * Settings › Chat: slots used and every checkout's verdict. Sequential — each row is up to two git probes.
 * @returns {Promise<{capacity:number, used:number, items:object[]}>}
 */
export async function listAskWorktreeVerdicts({ now, busyFor, runGit, signal } = {}) {
  const rows = orderedRows();
  const items = [];
  for (const r of rows) {
    const v = await classifyAskWorktree(r, { now, busyFor, runGit, signal });
    items.push({ ...v, title: r.title, createdBy: r.createdBy, projectKey: r.projectKey, ref: r.ref, createdAt: r.createdAt, path: r.path });
  }
  return { capacity: ASK_LIMITS.worktreesGlobal, used: rows.length, items };
}

/** One last synchronous look, right before the remove: a turn or terminal that began during the probes shows here. */
const stillIdle = (busyFor, row) => { try { return busyFor(row.threadId, row.path) === null; } catch { return false; } };

/**
 * Free every `safe` checkout, oldest first, up to `limit`. Each candidate is classified, re-classified with fresh
 * probes, and checked for live use once more immediately before its removal; `claim(threadId)` then holds the chat (the
 * server refuses a turn start in it) until `release(threadId)`, once the removal settles. A failure on one row never stops the rest.
 * @returns {Promise<{freed:string[], dropped:string[], kept:number, failed:number}>}
 */
export async function freeIdleAskWorktrees({ now, busyFor, runGit, limit = Infinity, log = () => {}, onFreed = () => {}, remove = removeAskWorktree, claim = () => {}, release = () => {} } = {}) {
  const out = { freed: [], dropped: [], kept: 0, failed: 0 };
  for (const cand of orderedRows()) {
    if (out.freed.length + out.dropped.length >= limit) break;
    try {
      const first = await classifyAskWorktree(cand, { now, busyFor, runGit });
      if (!first.safe) { out.kept += 1; continue; }
      const row = getAskWorktree(cand.threadId, cand.worktreeId);   // fresh row, fresh probes
      if (!row) continue;
      const again = await classifyAskWorktree(row, { now, busyFor, runGit });
      if (!again.safe || !stillIdle(busyFor, row)) { out.kept += 1; continue; }
      claim(row.threadId);   // same tick as the check above: no turn starts in this chat while git deletes the tree
      try { await remove({ threadId: row.threadId, wtId: row.worktreeId }); } finally { release(row.threadId); }
      (again.missingDir ? out.dropped : out.freed).push(row.worktreeId);
      log('info', `ask-worktrees: ${again.missingDir ? 'dropped stale row' : 'freed idle checkout'} ${row.worktreeId}`);
      try { onFreed(row.threadId); } catch { /* a ws emit never undoes a removal */ }
    } catch (err) {
      out.failed += 1;
      log('warn', `ask-worktrees: idle checkout ${cand.worktreeId} skipped (${err && err.message ? err.message : err})`);
    }
  }
  return out;
}

/**
 * The hand remove. Re-classifies on every call, so a preview shown earlier is never trusted: `confirmFingerprint` must
 * equal the fresh `lost.fingerprint` for a checkout that would lose work. Throws AskWorktreeError with a `code`:
 * CHECKOUT_BUSY, CHECKOUT_NOT_OWNER, CHECKOUT_UNKNOWN, CHECKOUT_NEEDS_CONFIRM (carries `detail.lost`).
 * @returns {Promise<{ok:true, steps:any, discarded:object|null}>}
 */
export async function removeAskWorktreeChecked({ threadId, wtId, discard, confirmFingerprint, canDiscard, now, busyFor, runGit, claim = () => {}, release = () => {} } = {}) {
  const row = getAskWorktree(threadId, wtId);
  if (!row) throw new AskWorktreeError('worktree not found');
  const busy = () => new AskWorktreeError('A live chat turn, command, followed run or terminal is using this checkout. Stop it first.', 'CHECKOUT_BUSY');
  const v = await classifyAskWorktree(row, { now, busyFor, runGit });
  if (v.inUse !== false) throw busy();
  if (!v.safe && !canDiscard) {
    throw new AskWorktreeError('This checkout belongs to another person\'s chat and is not safe to remove.', 'CHECKOUT_NOT_OWNER');
  }
  if (v.loss === 'unknown' && discard !== true) {
    throw new AskWorktreeError('The check of this checkout could not run, so removing it may lose work. Confirm to discard it anyway.', 'CHECKOUT_UNKNOWN', { lost: v.lost, loss: v.loss });
  }
  if (v.loss !== 'none' && (discard !== true || confirmFingerprint !== v.lost.fingerprint)) {
    throw new AskWorktreeError('This checkout has work that would be lost. Confirm to discard it.', 'CHECKOUT_NEEDS_CONFIRM', { lost: v.lost, loss: v.loss });
  }
  if (!stillIdle(busyFor, row)) throw busy();
  claim(threadId);   // same tick as the check above (see freeIdleAskWorktrees)
  let res;
  try { res = await removeAskWorktree({ threadId, wtId }); } finally { release(threadId); }
  return { ok: true, steps: res.steps, discarded: v.loss === 'none' ? null : v.lost };
}

/** A row by its id alone (the hand-remove route knows only the checkout), or null. */
export function findAskWorktreeById(wtId) {
  getDb();
  const r = typeof wtId === 'string' ? prepare('SELECT thread_id FROM ask_worktrees WHERE id = ?').get(wtId) : null;
  return r ? getAskWorktree(r.thread_id, wtId) : null;
}

/**
 * The `busyFor` of the server process: a chat's checkout is in use when its chat is being deleted or replying, runs a
 * command or follows a live run (`busyReason`), or a live terminal's cwd is the checkout or inside it. Paths are
 * compared resolved, on a separator boundary (`wt1` is not `wt10`), case-folded on win32, and by realpath too (a
 * symlinked cwd leans toward "in use"). Throws are the classifier's "unknown" (kept).
 * @param {{isDeleting:(threadId:string)=>boolean, busyReason:(threadId:string)=>string|null, liveCwds:()=>string[]}} src
 */
export function createWorktreeBusyFor({ isDeleting, busyReason, liveCwds }) {
  const norm = (p) => { const r = resolvePath(String(p)); return process.platform === 'win32' ? r.toLowerCase() : r; };
  const real = (p) => { try { return norm(realpathSync(p)); } catch { return null; } };
  const forms = (p) => [norm(p), real(p)].filter(Boolean);
  const inside = (cwd, root) => cwd === root || cwd.startsWith(root.endsWith(sep) ? root : root + sep);
  return (threadId, dir) => {
    if (isDeleting(threadId)) return 'replying';
    const reason = busyReason(threadId);
    if (reason) return reason;
    const roots = forms(dir);
    return liveCwds().some((cwd) => forms(cwd).some((c) => roots.some((r) => inside(c, r)))) ? 'terminal' : null;
  };
}
