// server/actions-store.js
//
// A persistent, self-healing ledger of long-running *actions* (a Run launch or a
// Regrade sweep) so the UI can show "started / running / completed / failed" with
// start+end times — visible at all times and surviving a page reload. Mirrors the
// append-only, dependency-free pattern of results-store.js: the source of truth is
// `<target-dir>/actions.jsonl`, one JSON object per write; the latest line for a
// given `id` wins, so a lifecycle transition is just another append.
//
// The server spawns Run/Regrade as *detached* subprocesses (it never waits for
// exit), so terminal state is detected by reconciling pid liveness on read: a
// `running` action whose pid is no longer alive is marked `completed` and that
// terminal record is persisted (stable `ended_at`). Progress (instances done /
// regrade counts) is NOT stored here — app.js derives it by joining results.jsonl
// and the regrade heartbeat at read time, keeping this ledger pure identity+state.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = 'actions.jsonl';

/** Terminal statuses — a pid is no longer expected to be alive for these. */
const TERMINAL = new Set(['completed', 'failed', 'stopped']);

/** POSIX liveness probe. `kill(pid, 0)` throws ESRCH if gone, EPERM if alive
 *  but not ours (still counts as alive). Never actually signals the process. */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function _file(targetDir) {
  return join(targetDir, FILE);
}

/** Append one ledger record (a create or a patch). */
export function appendAction(targetDir, rec) {
  appendFileSync(_file(targetDir), `${JSON.stringify(rec)}\n`, 'utf8');
}

/**
 * Record a freshly-spawned action as `running`. Returns the stored record.
 *
 * The real CLI (worca_bench/actions.py) is the production writer; this mirrors its
 * schema (incl. `source_dir`, from which the server backfills `src`). Kept here
 * for tests + as a JS reference of the on-disk format.
 */
export function recordAction(
  targetDir,
  { type, profile, src, source_dir, pid, params, startedAt },
) {
  const started = startedAt || new Date().toISOString();
  const rec = {
    id: `${type}-${profile}-${pid}-${Date.parse(started)}`,
    type,
    profile,
    source_dir: source_dir ?? null,
    src: src ?? null,
    pid: pid ?? null,
    params: params ?? {},
    status: 'running',
    started_at: started,
    updated_at: started,
  };
  appendAction(targetDir, rec);
  return rec;
}

/** Append a lifecycle/field patch for an existing action id. */
export function patchAction(targetDir, id, patch) {
  appendAction(targetDir, {
    id,
    ...patch,
    updated_at: new Date().toISOString(),
  });
}

function _collapse(targetDir) {
  const path = _file(targetDir);
  if (!existsSync(path)) return new Map();
  const byId = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try {
      rec = JSON.parse(t);
    } catch {
      continue; // skip a torn append, never blank the ledger
    }
    if (!rec.id) continue;
    const prev = byId.get(rec.id);
    byId.set(rec.id, prev ? { ...prev, ...rec } : rec);
  }
  return byId;
}

/**
 * Read all actions (latest record per id), reconciling dead pids to a terminal
 * `completed` state. Returns newest-first.
 *
 * @param {string} targetDir
 * @param {{_pidAlive?: (pid:number)=>boolean, reconcile?: boolean, now?: string}} [opts]
 *   `_pidAlive` is injectable for tests; `reconcile:false` skips the write-back.
 */
export function readActions(targetDir, opts = {}) {
  const { _pidAlive = pidAlive, reconcile = true, now } = opts;
  const byId = _collapse(targetDir);
  const out = [];
  for (const rec of byId.values()) {
    let a = rec;
    if (!TERMINAL.has(a.status) && !_pidAlive(a.pid)) {
      // The detached subprocess is gone with no explicit terminal write —
      // mark it completed (per-instance errors surface via derived progress).
      const ended = now || new Date().toISOString();
      a = { ...a, status: 'completed', ended_at: ended, updated_at: ended };
      if (reconcile)
        appendAction(targetDir, {
          id: a.id,
          status: 'completed',
          ended_at: ended,
          updated_at: ended,
        });
    }
    out.push(a);
  }
  out.sort((x, y) => (y.started_at || '').localeCompare(x.started_at || ''));
  return out;
}

/** Find one action by id (no reconcile write-back). */
export function findAction(targetDir, id, opts = {}) {
  return (
    readActions(targetDir, { ...opts, reconcile: false }).find(
      (a) => a.id === id,
    ) || null
  );
}
