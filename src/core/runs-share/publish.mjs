// src/core/runs-share/publish.mjs — the run-sharing switch, per-project coalescer and push status (run sharing s1).
// A run of a project whose "Share my runs" switch (`runs.share`) is on — and the Labs flag on — keeps one record on the
// `worca-runs` branch current while it is active: at most one commit per project per SHARE_WINDOW_MS (D8), only when
// the record changed (D9), a keep-alive every KEEPALIVE_MS (D10), and at once when it ends. Every entry point is
// fail-soft (D21): a failed publish is a log line and a stored status, never a run failure.
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { worcaHome, listProjects } from '../projects.mjs';
import { flagEnabled } from '../flags.mjs';
import { resolveSetting } from '../settings-cascade.mjs';
import { readRunsSharePrefs, writeRunsSharePrefs, readTeamMetricsPrefs } from '../config.mjs';
import { onPrStatePersisted, readPrState, findPipelineRowById } from '../artifacts.mjs';
import { runGit, identityArgs, gitUserEmail, gitUserName, withQueuedLock } from '../metrics/sync.mjs';
import { personKey as personKeyOf, actorForRecord, isMockRun } from '../metrics/record.mjs';
import { gitTeamBranchStartError } from '../memory-team.mjs';
import { redactUserinfo } from '../marketplaces.mjs';
import { scanSecrets } from '../secret-scan.mjs';
import {
  END_STATUSES, RECORD_MAX_BYTES, cleanPrUrl, recordFromHarness, recordFromRow, sameRecord, serializeRecord, shareProjectOf,
} from './record.mjs';
import { publishFiles, RUNS_BRANCH, RUNS_SHARE_PROTECTION_HINT } from './branch.mjs';

export const SHARE_WINDOW_MS = 30_000;
export const KEEPALIVE_MS = 600_000;

const ERROR_MAX = 300;
/** At most this many runs are remembered in `extra.runsShare.shared` (runId → last pushed prUrl); the oldest go first. */
const SHARED_MAX = 1000;
let sharedMax = SHARED_MAX;
const WITHHELD = 'Push failed (details withheld: the git error held a secret-shaped value)';
const QUERY_SECRET_RE = /([?&](?:token|access_token|key|secret|password|sig)=)[^&\s#]*/gi;

const realClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clearTimer: (t) => clearTimeout(t),
};
let clock = realClock;
let gitOverride = null;
let maxBytes = RECORD_MAX_BYTES;

/**
 * projectKey → { key, dir, dirty: Map(runId → {harness?, force}), lastFlushAt, retryMs, timer, deps, attached: Map,
 * pushed: Map (attached runs only), inflight }
 */
const projects = new Map();
let prListenerOff = null;

const warn = (text) => { try { console.warn(`run sharing: ${text}`); } catch { /* never throws */ } };
const logTo = (harness, level, text) => { try { harness?._log?.('runs-share', level, `run sharing: ${text}`); } catch { /* never throws */ } };
const normAttribution = (a) => (a === 'none' ? 'none' : 'git-user');
const firstLine = (s) => String(s || '').trim().split('\n')[0] || '';

/** The switch: the Labs flag and this project's `runs.share`. Local DB only, never git (D19, R-arch-7). */
export function runsShareOn(projectKey) {
  try {
    return flagEnabled('runSharing') && resolveSetting('runs.share', { projectKey }).value === true;
  } catch { return false; }
}

/** The stored `lastError` text (D15): first line, URL login masked, token query values masked, withheld on a secret. */
export function shareErrorText(stderr) {
  const line = redactUserinfo(firstLine(stderr)).replace(QUERY_SECRET_RE, '$1***');
  let found = [];
  try { found = scanSecrets(line); } catch { found = [{ kind: 'secret' }]; }
  if (found.some((f) => f.kind === 'secret')) return WITHHELD;
  return line.slice(0, ERROR_MAX);
}

/** Why the switch cannot turn on for this checkout, or null. */
export function runsShareStartError(projectDir) {
  return gitTeamBranchStartError(projectDir, { feature: 'run sharing', branch: RUNS_BRANCH, subject: 'each shared run' });
}
/** Refuse the switch. @throws {Error} {status:400, code:'NO_GIT'|'FOLDER_PROJECT'|'NO_ORIGIN'} */
export async function assertRunsShareCanStart(projectDir) {
  const err = await runsShareStartError(projectDir);
  if (err) throw err;
}

function entryFor(projectKey, projectDir) {
  let e = projects.get(projectKey);
  if (!e) {
    e = { key: projectKey, dir: projectDir, dirty: new Map(), lastFlushAt: 0, retryMs: 0, timer: null, deps: {}, attached: new Map(), pushed: new Map(), inflight: null };
    projects.set(projectKey, e);
  }
  if (projectDir) e.dir = projectDir;
  return e;
}
const gitOf = (e) => e.deps.git || gitOverride || runGit;
const nowOf = (e) => (e.deps.now || clock.now)();
const setTimerOf = (e) => e.deps.setTimer || clock.setTimer;
const clearTimerOf = (e) => e.deps.clearTimer || clock.clearTimer;

function markDirty(e, runId, { harness = null, force = false } = {}) {
  const cur = e.dirty.get(runId);
  e.dirty.set(runId, { harness: harness || cur?.harness || e.attached.get(runId)?.harness || null, force: force || !!cur?.force });
}

/** Arm the project's one trailing-edge timer at max(now, lastFlushAt + window), or + the back-off after a failure (D8). */
function schedule(e) {
  if (e.timer) return;
  const now = nowOf(e);
  const at = Math.max(now, e.lastFlushAt + (e.retryMs || SHARE_WINDOW_MS));
  e.timer = setTimerOf(e)(() => { e.timer = null; void flushProject(e.key); }, at - now);
}

function armKeepAlive(e, att) {
  if (att.keepAlive) clearTimerOf(e)(att.keepAlive);
  att.keepAlive = setTimerOf(e)(() => {
    att.keepAlive = null;
    try { markDirty(e, att.runId, { force: true }); schedule(e); } catch (err) { warn(err?.message || err); }
  }, KEEPALIVE_MS);
}

/**
 * Attach the publisher to a starting run (D11). Returns null — with 0 git calls — for a skipped run (D18) or with the
 * switch off; the person key, the starter and the attribution are resolved lazily at the first flush.
 * @returns {{detach():void}|null}
 */
export function attachRunShare(harness, deps = {}) {
  try {
    const p = shareProjectOf(harness);
    const runId = harness?.pipeline?.id;
    if (!p || !runId || !runsShareOn(p.projectKey)) return null;
    ensurePrListener();
    const e = entryFor(p.projectKey, p.projectDir);
    e.deps = { ...e.deps, ...Object.fromEntries(Object.entries(deps).filter(([, v]) => v != null)) };
    if (!e.timer) e.lastFlushAt = nowOf(e);
    const att = { runId, harness, keepAlive: null, detached: false };
    const onState = () => {
      try { markDirty(e, runId, { harness }); schedule(e); } catch (err) { logTo(harness, 'warn', err?.message || err); }
    };
    const onDone = (ev) => {
      try {
        markDirty(e, runId, { harness });
        const status = ev?.status ?? harness.state?.status;
        if (END_STATUSES.includes(status)) void flushProject(e.key);
        else schedule(e);
      } catch (err) { logTo(harness, 'warn', err?.message || err); }
      try { att.detach(); } catch { /* never throws */ }
    };
    att.detach = () => {
      if (att.detached) return;
      att.detached = true;
      harness.off?.('state', onState);
      harness.off?.('done', onDone);
      if (att.keepAlive) clearTimerOf(e)(att.keepAlive);
      att.keepAlive = null;
      if (e.attached.get(runId) === att) e.attached.delete(runId);
    };
    e.attached.set(runId, att);
    harness.on('state', onState);
    harness.on('done', onDone);
    armKeepAlive(e, att);
    markDirty(e, runId, { harness });
    schedule(e);
    return { detach: () => att.detach() };
  } catch (err) {
    logTo(harness, 'warn', err?.message || err);
    return null;
  }
}

/** Register the post-write PR listener once per process (D12). */
export function ensurePrListener() {
  if (!prListenerOff) prListenerOff = onPrStatePersisted((id) => sharePrUpdate(id));
}

/** The runs this machine has pushed, with the PR link each last carried (`extra.runsShare.shared`). */
function sharedRuns(projectKey) {
  const v = readRunsSharePrefs(projectKey)?.shared;
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/**
 * A PR link stored (often after the run ended): rebuild that run's record from its row and schedule a flush. Only for
 * a run this machine already shared, and only when its link changed: the History PR refresh stores links for every
 * past run, and those must neither be published nor re-pushed after a restart.
 */
export function sharePrUpdate(pipelineId) {
  try {
    const row = findPipelineRowById(pipelineId);
    if (!row || !row.project_key || row.workspace_key || isMockRun(null) || !runsShareOn(row.project_key)) return;
    const key = row.project_key;
    const shared = sharedRuns(key);
    if (!Object.hasOwn(shared, row.id)) return;
    let url = null;
    try { url = cleanPrUrl(readPrState(row.id)?.url ?? null); } catch { url = null; }
    if ((shared[row.id] ?? null) === url) return;
    const known = projects.get(key);
    const go = (dir) => { const e = entryFor(key, dir); markDirty(e, row.id); schedule(e); };
    if (known?.dir) { go(known.dir); return; }
    void listProjects().then((list) => { const p = list.find((x) => x.key === key); if (p) go(p.path); })
      .catch((err) => warn(err?.message || err));
  } catch (err) { warn(err?.message || err); }
}

async function identityFor(e) {
  const attribution = normAttribution(readTeamMetricsPrefs(e.key)?.config?.attribution);
  let pk = attribution === 'git-user' ? personKeyOf(await gitUserEmail(e.dir)) : null;
  if (!pk) {
    const prefs = readRunsSharePrefs(e.key) || {};
    pk = typeof prefs.machineKey === 'string' && /^[0-9a-f]{16}$/.test(prefs.machineKey) ? prefs.machineKey : null;
    if (!pk) { pk = randomBytes(8).toString('hex'); writeRunsSharePrefs(e.key, { machineKey: pk }); }
  }
  const gitName = attribution === 'none' ? null : await gitUserName(e.dir);
  return { attribution, personKey: pk, gitName, identity: await identityArgs(e.dir, attribution) };
}

function writeFailure(key, code, stderr) {
  try {
    writeRunsSharePrefs(key, { lastError: code === 'RECORD_TOO_LARGE' ? stderr : shareErrorText(stderr), lastErrorCode: code, lastErrorAt: new Date().toISOString() });
  } catch (err) { warn(err?.message || err); }
}

/** Remember the pushed runs and their PR links, keeping the newest SHARED_MAX. */
function rememberShared(key, built) {
  const next = { ...sharedRuns(key) };
  for (const [runId, rec] of built) { delete next[runId]; next[runId] = rec.prUrl ?? null; }
  const ids = Object.keys(next);
  for (const id of ids.slice(0, Math.max(0, ids.length - sharedMax))) delete next[id];
  return next;
}

/** Put a failed batch back (a newer mark wins) and retry after a back-off doubling up to KEEPALIVE_MS. */
function requeue(e, batch, ids) {
  for (const runId of ids) if (!e.dirty.has(runId) && batch.has(runId)) e.dirty.set(runId, batch.get(runId));
  if (!e.dirty.size) return;
  e.retryMs = Math.min(KEEPALIVE_MS, e.retryMs ? e.retryMs * 2 : SHARE_WINDOW_MS);
  schedule(e);
}

async function flushLocked(e) {
  if (e.timer) { clearTimerOf(e)(e.timer); e.timer = null; }
  e.lastFlushAt = nowOf(e);
  if (!e.dirty.size) return { ok: true, pushed: false };
  if (!runsShareOn(e.key)) { e.dirty.clear(); e.retryMs = 0; return { ok: true, pushed: false }; }
  const batch = new Map(e.dirty);
  e.dirty.clear();
  const tooLargeIds = new Set();
  const built = new Map();
  try {
    const id = await identityFor(e);
    const files = {};
    let tooLarge = null;
    const now = new Date(nowOf(e));
    for (const [runId, item] of batch) {
      let prUrl = null;
      try { prUrl = readPrState(runId)?.url ?? null; } catch { prUrl = null; }
      let rec = null;
      if (item.harness) {
        const startedBy = id.attribution === 'none' ? null : actorForRecord(item.harness.state?.startedBy) ?? id.gitName;
        rec = recordFromHarness(item.harness, { personKey: id.personKey, startedBy, prUrl, now });
      } else {
        const row = findPipelineRowById(runId);
        const startedBy = id.attribution === 'none' ? null : actorForRecord(row?.started_by) ?? id.gitName;
        rec = row ? recordFromRow(row, { personKey: id.personKey, startedBy, prUrl, now }) : null;
      }
      if (!rec) continue;
      if (!item.force && sameRecord(rec, e.pushed.get(runId))) continue;
      try {
        files[`runs/${rec.personKey}/${rec.runId}.json`] = serializeRecord(rec, maxBytes);
        built.set(runId, rec);
      } catch (err) {
        if (err?.code !== 'RECORD_TOO_LARGE') throw err;
        tooLarge = err.message;
        tooLargeIds.add(runId);
      }
    }
    if (tooLarge) writeFailure(e.key, 'RECORD_TOO_LARGE', tooLarge);
    if (!built.size) {
      e.retryMs = 0;
      return tooLarge ? { ok: false, code: 'RECORD_TOO_LARGE', stderr: tooLarge, hint: null, attempts: 0 } : { ok: true, pushed: false };
    }
    const r = await publishFiles(e.dir, { files, message: `worca-runs: ${built.size} run(s)`, identity: id.identity, git: gitOf(e), hooks: e.deps.hooks || {} });
    if (r.ok) {
      e.retryMs = 0;
      // Only an attached run needs the in-memory copy (D9 between its own flushes); a detached run's later PR update is
      // gated by the persisted `shared` link instead, so this map stays bounded by the live runs.
      for (const [runId, rec] of built) {
        if (e.attached.has(runId)) e.pushed.set(runId, rec); else e.pushed.delete(runId);
      }
      try {
        writeRunsSharePrefs(e.key, {
          ...(r.pushed ? { lastPushAt: new Date().toISOString() } : {}),
          ...(tooLarge ? {} : { lastError: null, lastErrorCode: null, lastErrorAt: null }),
          shared: rememberShared(e.key, built),
        });
      } catch (err) { warn(err?.message || err); }
      for (const runId of built.keys()) { const att = e.attached.get(runId); if (att && !att.detached) armKeepAlive(e, att); }
      // A PR stored while this push was in flight was refused by sharePrUpdate (the run was not in `shared` yet): compare
      // the stored link with the one just pushed, and publish it at the next window when it differs.
      for (const [runId, rec] of built) {
        let url = null;
        try { url = cleanPrUrl(readPrState(runId)?.url ?? null); } catch { url = null; }
        if (url !== (rec.prUrl ?? null)) markDirty(e, runId);
      }
      if (e.dirty.size) schedule(e);
    } else {
      writeFailure(e.key, r.code, r.stderr);
      warn(`${e.key}: ${r.code} ${shareErrorText(r.stderr)}`);
      requeue(e, batch, built.keys());
    }
    return r;
  } catch (err) {
    requeue(e, batch, [...batch.keys()].filter((runId) => !tooLargeIds.has(runId)));
    throw err;
  }
}

/** Flush every dirty run of a project in ONE commit, under the project's cross-process lock. Never throws. */
export async function flushProject(projectKey) {
  const e = projects.get(projectKey);
  if (!e) return { ok: true, pushed: false };
  const lock = join(worcaHome(), 'runs-share', 'locks', `${projectKey}.lock`);
  const run = withQueuedLock(lock, () => flushLocked(e)).catch((err) => {
    warn(err?.message || err);
    return { ok: false, code: 'COMMIT_FAILED', stderr: String(err?.message || err), hint: null, attempts: 0 };
  });   // a run marked during the push armed the next timer itself (onState / onDone / keep-alive call schedule)
  e.inflight = run;
  run.finally(() => { if (e.inflight === run) e.inflight = null; });
  return run;
}

/** Flush every pending project, bounded by `timeoutMs` (D22). Never throws. */
export async function drainRunShare({ timeoutMs = 30_000 } = {}) {
  const work = [...projects.values()].map((e) => {
    if (e.dirty.size) return flushProject(e.key);
    return e.inflight || null;
  }).filter(Boolean);
  if (!work.length) return;
  let t = null;
  await Promise.race([
    Promise.allSettled(work),
    new Promise((res) => { t = setTimeout(res, timeoutMs); t.unref?.(); }),
  ]);
  clearTimeout(t);
}

/** This machine's push status for the project's Settings card (D15/D16). */
export async function runsShareStatus(projectKey, projectDir) {
  const prefs = readRunsSharePrefs(projectKey) || {};
  const err = await runsShareStartError(projectDir);
  let pk = null;
  try {
    const attribution = normAttribution(readTeamMetricsPrefs(projectKey)?.config?.attribution);
    pk = attribution === 'git-user' && !err ? personKeyOf(await gitUserEmail(projectDir)) : null;
  } catch { pk = null; }
  if (!pk && typeof prefs.machineKey === 'string') pk = prefs.machineKey;
  const code = prefs.lastErrorCode ?? null;
  return {
    enabled: runsShareOn(projectKey),
    flag: flagEnabled('runSharing'),
    branch: RUNS_BRANCH,
    personKey: pk,
    lastPushAt: prefs.lastPushAt ?? null,
    lastError: prefs.lastError ?? null,
    lastErrorCode: code,
    lastErrorAt: prefs.lastErrorAt ?? null,
    hint: code === 'PUSH_REJECTED' ? RUNS_SHARE_PROTECTION_HINT : null,
    canStart: !err,
    startError: err ? { code: err.code, message: err.message } : null,
  };
}

export const _testing = {
  setClock({ now, setTimer, clearTimer } = {}) { clock = { now: now || realClock.now, setTimer: setTimer || realClock.setTimer, clearTimer: clearTimer || realClock.clearTimer }; },
  setGit(fn) { gitOverride = fn || null; },
  setMaxBytes(n) { maxBytes = n; },
  setSharedMax(n) { sharedMax = n; },
  reset() {
    for (const e of projects.values()) {
      if (e.timer) clearTimerOf(e)(e.timer);
      for (const att of e.attached.values()) { try { att.detach(); } catch { /* ignore */ } }
    }
    projects.clear();
    clock = realClock;
    gitOverride = null;
    maxBytes = RECORD_MAX_BYTES;
    sharedMax = SHARED_MAX;
  },
  /** Resolves once no flush is in flight (a wait that, unlike drainRunShare, starts no flush itself). */
  async idle() { for (let e = [...projects.values()].find((x) => x.inflight); e; e = [...projects.values()].find((x) => x.inflight)) await e.inflight.catch(() => {}); },
  pushedCount(projectKey) { return projects.get(projectKey)?.pushed.size ?? 0; },
  pending() { return [...projects.values()].filter((e) => e.dirty.size || e.timer || e.inflight).map((e) => e.key); },
};
