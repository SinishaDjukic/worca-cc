// src/core/project-sync.mjs
// The service layer over git-sync.mjs (#527): effective per-project settings, one sync block
// shape for every route, workspace fan-out, and the scheduled background refresh that feeds the
// Projects/Workspaces chips through projectSyncEvents ('changed' → ws `project-sync-changed`).
import { EventEmitter } from 'node:events';
import { syncDefaults, normalizeSyncSettings } from './settings.mjs';
import { readSyncPrefs } from './config.mjs';
import { listProjects } from './projects.mjs';
import { readWorkspace } from './workspaces.mjs';
import { currentBranch, resolveDefaultBranch } from './worktree.mjs';
import { mapWithCap, fanoutCap } from './fanout.mjs';
import { gitAvailable, onGitChange } from './git-available.mjs';
import {
  syncRepo, remoteInfo, incomingCommits, commitInfo, isSafeBranchName, lastFetchedAt,
  INTERACTIVE_TTL_MS, INTERACTIVE_TIMEOUT_MS, RUN_TIMEOUT_MS,
} from './git-sync.mjs';

export const projectSyncEvents = new EventEmitter();

/** Project over instance over built-in. Never throws (an unregistered dir has no prefs row). */
export function effectiveSyncSettings(projectKey) {
  let own = null;
  try { own = projectKey ? readSyncPrefs(projectKey) : null; } catch { own = null; }
  return normalizeSyncSettings(own || {}, syncDefaults());
}

/** The branch a project's chip describes: HEAD's branch, else the default branch; null if not a branch. */
export async function chipBase(dir) {
  const b = (await currentBranch(dir)) || (await resolveDefaultBranch(dir));
  return isSafeBranchName(b) ? b : null;
}

/**
 * One SyncBlock (plan §1) for `dir`/`base`. mode 'status' never touches the network.
 * `details` adds local/remote tip facts and the incoming commits (≤ 20).
 */
export async function projectSyncBlock({ dir, projectKey = null, base = null, mode = 'status', details = false,
  maxAgeMs = INTERACTIVE_TTL_MS, timeoutMs = INTERACTIVE_TIMEOUT_MS } = {}) {
  const settings = effectiveSyncSettings(projectKey);
  // An explicit base that is not syncable (a tag, a SHA, 'plus+branch') describes THAT ref as
  // unknown; it is never swapped for HEAD's branch, which would report another branch's state.
  const explicit = base != null && base !== '';
  const b = explicit ? (isSafeBranchName(base) ? base : null) : await chipBase(dir);
  const info = await remoteInfo(dir, settings.remote);
  const pub = { beforeRun: settings.beforeRun, onDiverged: settings.onDiverged };
  if (!info.ok) return { base: explicit ? base : b, remote: null, state: 'unknown', settings: pub };
  if (explicit && !b) return { base, remote: info.name, remoteLabel: info.label, state: 'unknown', settings: pub };
  if (!b) return { base: null, remote: info.name, remoteLabel: info.label, state: 'unknown', settings: pub };
  const r = await syncRepo(dir, { base: b, remote: info.name, mode, maxAgeMs, timeoutMs });
  const block = {
    base: b, remote: info.name, remoteLabel: info.label, state: r.state || 'unknown',
    ahead: r.ahead || 0, behind: r.behind || 0, dirty: !!r.dirty, dirtyCount: r.dirtyCount || 0,
    checkedOutHere: !!r.checkedOutHere, shallow: !!r.shallow, headSha: r.headSha || null, remoteSha: r.remoteSha || null,
    fetchedAt: r.fetch?.fetchedAt || r.fetchedAt || null, stale: !!r.stale, settings: pub,
    ...(r.fetchError ? { fetchError: r.fetchError } : {}), ...(r.ff ? { ff: r.ff } : {}),
  };
  if (details) {
    const [local, remoteTip, incoming] = await Promise.all([
      block.headSha ? commitInfo(dir, block.headSha) : null,
      block.remoteSha ? commitInfo(dir, block.remoteSha) : null,
      block.behind > 0 && block.headSha ? incomingCommits(dir, { base: b, remote: info.name, limit: 20 }) : [],
    ]);
    Object.assign(block, { local, remoteTip, incoming });
  }
  return block;
}

/** Every workspace member's block (mode status|fetch|ff), fanned out under the orchestrator cap. */
export async function workspaceSyncBlocks(workspaceId, { mode = 'status', bases = {} } = {}) {
  const ws = await readWorkspace(workspaceId);
  if (!ws) return null;
  const members = ws.projectPaths.map((dir, i) => ({ dir, projectKey: ws.projectKeys[i], i }));
  // A person's explicit fetch/ff: no TTL and the long bound (as syncProjectAction).
  const act = mode === 'status' ? {} : { maxAgeMs: 0, timeoutMs: RUN_TIMEOUT_MS };
  // readWorkspace returns `exists[]` aligned with projectPaths: a gone folder runs no git in a dead cwd.
  const blocks = await mapWithCap(members, fanoutCap(), (m) => (ws.exists && ws.exists[m.i] === false
    ? { base: null, remote: null, state: 'unknown', missing: true }
    // P5: a Folder member (annotated vcs 'none') has no branch and no remote: never git in its folder — nested in a
    // repository, a fetch / ff there would move THAT repository.
    : Array.isArray(ws.vcs) && ws.vcs[m.i] === 'none' ? { base: null, remote: null, state: 'unknown', folder: true }
    : projectSyncBlock({ dir: m.dir, projectKey: m.projectKey, base: bases[m.projectKey] || null, mode, ...act })));
  return members.map((m, i) => ({ projectKey: m.projectKey, ...blocks[i] }));
}

// No ties: the workspace chip must not depend on member order.
const RANK = { diverged: 4, dirty: 3, behind: 2, offline: 1, local: 0.5, ok: 0 };
/** 'diverged'|'dirty'|'behind'|'offline'|'local'|'ok' — the chip word ('local' = the branch is not on
 *  the remote: never "up to date"); shared by the server and ui/public/branch-sync.mjs (keep equal). */
export function chipState(b) {
  if (!b || !b.remote || b.state === 'unknown') return null;
  if (b.stale) return 'offline';
  if (b.state === 'diverged') return 'diverged';
  if (b.dirty && b.checkedOutHere) return 'dirty';
  if (b.state === 'behind') return 'behind';
  // remote-only = the branch IS on the remote, only the local copy is missing: no chip.
  if (b.state === 'remote-only') return null;
  if (b.state === 'no-upstream' || b.state === 'missing') return 'local';
  return 'ok';
}
export function worstChipState(blocks) {
  return (blocks || []).map(chipState).filter(Boolean).sort((a, b) => RANK[b] - RANK[a])[0] || null;
}

const syncLoopCanRun = () => gitAvailable();

/**
 * Scheduled background fetch (NOT per page load): one project at a time, each only when its
 * FETCH_HEAD is older than its refreshMinutes (0 = never). Emits 'changed' {projectKey} when a
 * project's chip facts changed. WORCA_SYNC_BACKGROUND=0 disables it. Returns a stop function.
 */
export function startProjectSyncBackground({ log = (m) => console.warn(m), tickMs = 60_000, listProjectsFn = listProjects } = {}) {
  if (process.env.WORCA_SYNC_BACKGROUND === '0') return async () => {};
  const seen = new Map();
  const retryAt = new Map();   // projectKey -> ms: a failed fetch never touches FETCH_HEAD, so back off
  let busy = null;             // the running tick's promise
  let stopped = false;
  // Decide "due" from FETCH_HEAD alone (one rev-parse + a stat) BEFORE building a block: a full
  // block (≈12 git spawns incl. `git status`) per project per tick is far too much for a
  // feature that is on by default.
  const due = async (p, s) => {
    if ((retryAt.get(p.key) || 0) > Date.now()) return false;
    if (!(await remoteInfo(p.path, s.remote)).ok) return false;   // local-only project: one spawn a tick
    const at = await lastFetchedAt(p.path, { remote: s.remote });
    return !at || Date.now() - Date.parse(at) >= s.refreshMinutes * 60_000;
  };
  const runTick = async () => {
    if (!syncLoopCanRun()) return;
    try {
      for (const p of await listProjectsFn()) {
        if (stopped) return;                       // stop() lands between projects
        if (!p || !p.exists) continue;
        const s = effectiveSyncSettings(p.key);
        if (!s.refreshMinutes || !(await due(p, s))) continue;
        const b = await projectSyncBlock({ dir: p.path, projectKey: p.key, mode: 'fetch',
          maxAgeMs: s.refreshMinutes * 60_000, timeoutMs: RUN_TIMEOUT_MS });
        if (b.stale) retryAt.set(p.key, Date.now() + s.refreshMinutes * 60_000); else retryAt.delete(p.key);
        if (stopped || !b.remote) continue;
        const fp = JSON.stringify([b.state, b.ahead, b.behind, b.headSha, b.remoteSha, b.dirty, b.stale, b.fetchedAt]);
        if (seen.get(p.key) !== fp) { seen.set(p.key, fp); projectSyncEvents.emit('changed', { projectKey: p.key }); }
      }
    } catch (err) {
      log(`[worca-ui] project sync refresh: ${err?.message || err}`);
    }
  };
  const tick = () => {
    if (busy || stopped) return busy;
    busy = runTick().finally(() => { busy = null; });
    return busy;
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, tickMs);
  timer.unref?.();
  const offGit = onGitChange((s) => { if (s.available) void tick(); });
  /** Stop the timer; resolves once a tick already in flight has finished (tests await it). */
  return async () => { offGit(); stopped = true; clearInterval(timer); await (busy || null); };
}

export const _testing = { RANK };
