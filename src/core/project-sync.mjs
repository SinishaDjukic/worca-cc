// src/core/project-sync.mjs
// The service layer over git-sync.mjs (#527): effective per-project settings, one sync block
// shape for every route, workspace fan-out, and the scheduled background refresh that feeds the
// Projects/Workspaces chips through projectSyncEvents ('changed' → ws `project-sync-changed`).
import { EventEmitter } from 'node:events';
import { syncDefaults, normalizeSyncSettings } from './settings.mjs';
import { readSyncPrefs } from './config.mjs';
import { listProjects } from './projects.mjs';
import { readWorkspace } from './workspaces.mjs';
import { currentBranch, unbornBranch, resolveDefaultBranch } from './worktree.mjs';
import { mapWithCap, fanoutCap } from './fanout.mjs';
import { gitAvailable, onGitChange } from './git-available.mjs';
import { prepare } from './db.mjs';
import {
  syncRepo, remoteInfo, incomingCommits, commitInfo, isSafeBranchName, isSafeRemoteName, lastFetchedAt,
  INTERACTIVE_TTL_MS, INTERACTIVE_TIMEOUT_MS, RUN_TIMEOUT_MS,
} from './git-sync.mjs';
import { branchTips, tipsRelation } from './git-info.mjs';

export const projectSyncEvents = new EventEmitter();

// A project nobody opened (no sync chip or branch read of its own, no run) for QUIET_AFTER_MS is a quiet one: the
// background refresh fetches it every QUIET_REFRESH_MINUTES at most, and again at its own pace once it is opened.
export const QUIET_AFTER_MS = 24 * 3600_000;
export const QUIET_REFRESH_MINUTES = 60;
let bootAt = Date.now();       // a restart knows no history: every project starts as recently opened
const openedAt = new Map();    // projectKey -> ms of the last read a person asked for
const activity = new EventEmitter();
/** A person looked at `projectKey` (its chip, its branches, a sync): it is not quiet. */
export function noteProjectActive(projectKey) {
  if (!projectKey) return;
  openedAt.set(projectKey, Date.now());
  activity.emit('active', projectKey);
}
/** projectKey -> ms of its last run (started or updated); empty when the database cannot say. */
function lastRunAt() {
  try {
    const rows = prepare(`SELECT project_key AS k, MAX(COALESCE(updated_at, started_at)) AS at FROM pipelines
      WHERE project_key IS NOT NULL GROUP BY project_key`).all();
    return new Map(rows.map((r) => [r.k, Date.parse(r.at) || 0]));
  } catch { return new Map(); }
}

/** Project over instance over built-in. Never throws (an unregistered dir has no prefs row). */
export function effectiveSyncSettings(projectKey) {
  let own = null;
  try { own = projectKey ? readSyncPrefs(projectKey) : null; } catch { own = null; }
  return normalizeSyncSettings(own || {}, syncDefaults());
}

/** The remote a run on its source branch (branch.sameAsSource) pushes its source to (POST /api/push): the
 *  run's recorded sync remote, else the project's sync setting. Validated: the value ends up in git's argv. */
export function sourcePushRemote(br, projectKey) {
  return isSafeRemoteName(br?.sync?.remote) ? br.sync.remote : (effectiveSyncSettings(projectKey).remote || 'origin');
}

/** A run's source branch (br.source) push state from refs only (no network), as publishStatus reads a published
 *  branch. The remote is the recorded push's (br.pushed), else sourcePushRemote's.
 *  'pushed' = the remote has every local commit (equal, or only the remote is ahead), 'ahead' = local commits
 *  not on the remote, 'diverged' = both sides have commits (a plain push is refused), 'unpushed' = no remote
 *  branch. -> { remote, state } | null (no source, no local branch, or git failed). */
export async function sourcePushStatus(repoDir, br, projectKey) {
  if (!repoDir || !isSafeBranchName(br?.source)) return null;
  const remote = isSafeRemoteName(br.pushed?.remote) ? br.pushed.remote : sourcePushRemote(br, projectKey);
  const tips = await branchTips(repoDir, br.source, remote);
  if (!tips?.local) return null;
  if (!tips.remote) return { remote, state: 'unpushed' };
  const rel = await tipsRelation(repoDir, tips.local, tips.remote);
  // null with two different tips: git could not tell, so keep reading it as local commits.
  const ahead = rel === 'ahead' || (rel === null && tips.local !== tips.remote);
  return { remote, state: ahead ? 'ahead' : rel === 'diverged' ? 'diverged' : 'pushed' };
}

async function chipHead(dir) {
  const head = await currentBranch(dir);
  const unborn = head ? null : await unbornBranch(dir);
  const b = head || unborn || (await resolveDefaultBranch(dir));
  return { base: isSafeBranchName(b) ? b : null, noCommits: !!unborn };
}
/** The branch a project's chip describes: HEAD's branch (an unborn one too), else the default branch; null if not a branch. */
export async function chipBase(dir) {
  return (await chipHead(dir)).base;
}

/**
 * One SyncBlock (plan §1) for `dir`/`base`. mode 'status' never touches the network.
 * `details` adds local/remote tip facts and the incoming commits (≤ 20).
 */
export async function projectSyncBlock({ dir, projectKey = null, base = null, mode = 'status', details = false,
  maxAgeMs = INTERACTIVE_TTL_MS, timeoutMs = INTERACTIVE_TIMEOUT_MS, opened = true } = {}) {
  // `opened: false` for reads no person asked for of this project (the background refresh, the all-projects list).
  if (opened) noteProjectActive(projectKey);
  const settings = effectiveSyncSettings(projectKey);
  // An explicit base that is not syncable (a tag, a SHA, 'plus+branch') describes THAT ref as
  // unknown; it is never swapped for HEAD's branch, which would report another branch's state.
  const explicit = base != null && base !== '';
  const head = explicit ? null : await chipHead(dir);
  const b = explicit ? (isSafeBranchName(base) ? base : null) : head.base;
  const nc = head && head.noCommits ? { noCommits: true } : {};   // an unborn repo (Use git, no commit yet)
  const info = await remoteInfo(dir, settings.remote);
  const pub = { beforeRun: settings.beforeRun, onDiverged: settings.onDiverged };
  if (!info.ok) return { base: explicit ? base : b, remote: null, state: 'unknown', settings: pub, ...nc };
  if (explicit && !b) return { base, remote: info.name, remoteLabel: info.label, state: 'unknown', settings: pub, ...nc };
  if (!b) return { base: null, remote: info.name, remoteLabel: info.label, state: 'unknown', settings: pub, ...nc };
  const r = await syncRepo(dir, { base: b, remote: info.name, mode, maxAgeMs, timeoutMs });
  const block = {
    base: b, remote: info.name, remoteLabel: info.label, state: r.state || 'unknown',
    ahead: r.ahead || 0, behind: r.behind || 0, dirty: !!r.dirty, dirtyCount: r.dirtyCount || 0,
    checkedOutHere: !!r.checkedOutHere, shallow: !!r.shallow, headSha: r.headSha || null, remoteSha: r.remoteSha || null,
    fetchedAt: r.fetch?.fetchedAt || r.fetchedAt || null, stale: !!r.stale, settings: pub,
    ...(r.fetchError ? { fetchError: r.fetchError } : {}), ...(r.ff ? { ff: r.ff } : {}), ...nc,
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
 * FETCH_HEAD is older than its refreshMinutes (0 = never), or QUIET_REFRESH_MINUTES for a quiet project.
 * Emits 'changed' {projectKey} when a project's chip facts changed. WORCA_SYNC_BACKGROUND=0 disables it.
 * Returns a stop function. `now` is the clock (tests).
 */
export function startProjectSyncBackground({ log = (m) => console.warn(m), tickMs = 60_000, listProjectsFn = listProjects,
  now = () => Date.now() } = {}) {
  if (process.env.WORCA_SYNC_BACKGROUND === '0') return async () => {};
  const seen = new Map();
  // projectKey -> { at, every }: no git until `at`, while the project's interval is still `every` (ms). An outside
  // fetch only makes a project fresher, so a check at the remembered time is never late. A failed fetch never
  // touches FETCH_HEAD, so it backs off the same way.
  const nextCheck = new Map();
  let busy = null;             // the running tick's promise
  let stopped = false;
  const intervalMs = (p, s, runs) => {
    const last = Math.max(bootAt, openedAt.get(p.key) || 0, runs.get(p.key) || 0);
    const quiet = now() - last >= QUIET_AFTER_MS;
    return (quiet ? Math.max(s.refreshMinutes, QUIET_REFRESH_MINUTES) : s.refreshMinutes) * 60_000;
  };
  // Decide "due" from FETCH_HEAD alone (get-url, one rev-parse + a stat) BEFORE building a block, and only once the
  // remembered time has come: a full block (≈12 git spawns incl. `git status`) per project per tick, or even the
  // check itself every tick, is far too much for a feature that is on by default.
  const due = async (p, s, every) => {
    const memo = nextCheck.get(p.key);
    if (memo && memo.every === every && memo.at > now()) return false;
    const info = await remoteInfo(p.path, s.remote);
    // A local-only project: looked at again once per interval (a remote added meanwhile waits that long).
    if (!info.ok) { nextCheck.set(p.key, { at: now() + every, every }); return false; }
    const at = Date.parse(await lastFetchedAt(p.path, { remote: s.remote, info })) || 0;
    if (at && now() - at < every) { nextCheck.set(p.key, { at: at + every, every }); return false; }
    return true;
  };
  const runTick = async () => {
    if (!syncLoopCanRun()) return;
    try {
      const runs = lastRunAt();
      for (const p of await listProjectsFn()) {
        if (stopped) return;                       // stop() lands between projects
        if (!p || !p.exists) continue;
        const s = effectiveSyncSettings(p.key);
        if (!s.refreshMinutes) continue;
        const every = intervalMs(p, s, runs);
        if (!(await due(p, s, every))) continue;
        const b = await projectSyncBlock({ dir: p.path, projectKey: p.key, mode: 'fetch', opened: false,
          maxAgeMs: every, timeoutMs: RUN_TIMEOUT_MS });
        const fetched = !b.stale && Date.parse(b.fetchedAt);
        nextCheck.set(p.key, { at: (fetched || now()) + every, every });
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
  // Git came back: every project is looked at again. A quiet project opened: at its own pace from the next tick.
  const offGit = onGitChange((s) => { if (s.available) { nextCheck.clear(); void tick(); } });
  const onActive = (key) => { const m = nextCheck.get(key); if (m && m.every > effectiveSyncSettings(key).refreshMinutes * 60_000) nextCheck.delete(key); };
  activity.on('active', onActive);
  /** Stop the timer; resolves once a tick already in flight has finished (tests await it). */
  return async () => { offGit(); activity.off('active', onActive); stopped = true; clearInterval(timer); await (busy || null); };
}

export const _testing = { RANK, openedAt, setBootAt: (ms) => { bootAt = ms; } };
