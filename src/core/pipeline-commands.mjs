// src/core/pipeline-commands.mjs
//
// The run-control mailbox (#513): a client — the CLI today, chat / the UI for
// runs they do not own later — writes a command row, and the run's OWNING
// process claims and executes it through its own orchestrator. The scheduled_runs
// transport pattern for a second kind of intent (see PIPELINE_COMMANDS_DDL in
// db.mjs for why it is a separate table): transient rows that want to die once
// consumed, unlike a ticket, which lives on as the run's provenance.
//
// NO timers live here and NO run is stopped here (the scheduler's rule): the
// harness owns the ~1s check interval and passes nothing — it calls claim when
// its timer fires. The claim is ONE guarded UPDATE, scheduler.mjs#claimTicket's
// shape: only the process that changes the row proceeds, so two racing clients
// can never double-execute a command. `consumed_at` is both the claim marker and
// the issuing client's "executed vs enqueued" signal — one column, one write.

import { hostname } from 'node:os';

import { getDb } from './db.mjs';

/** The actions a command may carry today. `answer` joins here when question
 *  publication (its own issue) gives it something to carry in `payload`. */
export const PIPELINE_COMMAND_ACTIONS = ['stop', 'pause', 'switch-models'];

/** How often an OWNING harness polls its control slot. Deliberately NOT the
 *  ownership heartbeat's cadence — HEARTBEAT_INTERVAL_MS is 30s, right for
 *  liveness, far too slow for a stop button — and deliberately small: one indexed
 *  SELECT per live run per second is noise next to what the harness already does.
 *  Run-chain dependents already skip the 30s tick for the same reason. */
export const CONTROL_CHECK_INTERVAL_MS = 1000;

/** The control-slot poll period; WORCA_CONTROL_CHECK_MS (10 .. 60000) overrides it (tests use 25). */
export function controlCheckIntervalMs(env = process.env) {
  const n = Number(env.WORCA_CONTROL_CHECK_MS);
  return Number.isFinite(n) && n >= 10 && n <= 60_000 ? n : CONTROL_CHECK_INTERVAL_MS;
}

/** The statuses under which a pipeline no longer has a live orchestrator, so any
 *  command row targeting it is garbage — reaped, never claimed. Mirrors the
 *  SETTLED_RUN notion (ui/server.mjs) minus 'error', which is not a pipelines
 *  status; the store vocabulary is created|running|paused|stopped|interrupted|done. */
const SETTLED_PIPELINE = ['done', 'stopped', 'paused', 'interrupted'];

const iso = (t) => new Date(t).toISOString();

/**
 * Write one command for a LIVE pipeline. The caller resolves the id/prefix and
 * checks liveness first (the CLI reads owner_pid/heartbeat_at before writing) —
 * this is the write, not the policy.
 * @param {string} pipelineId
 * @param {'stop'|'pause'|'switch-models'} action
 * @param {{ payload?:object|null, by?:string, now?:number }} [opts]
 * @returns {{ id:number, createdAt:string }}
 */
export function enqueuePipelineCommand(pipelineId, action, { payload = null, by = 'local', now = Date.now() } = {}) {
  if (!PIPELINE_COMMAND_ACTIONS.includes(action)) throw new Error(`unknown command action: ${action}`);
  if (!pipelineId || typeof pipelineId !== 'string') throw new Error('pipelineId is required');
  const createdAt = iso(now);
  const res = getDb().prepare(
    'INSERT INTO pipeline_commands (pipeline_id, action, payload, by, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(pipelineId, action, payload == null ? null : JSON.stringify(payload), String(by || 'local'), createdAt);
  return { id: Number(res.lastInsertRowid), createdAt };
}

/**
 * Claim the OLDEST pending command for a pipeline — the owner's pickup, one row
 * at a time. A guarded UPDATE decides ownership (changes === 1); the losing side
 * of a race gets null and simply checks again on its next tick, the way
 * claimTicket's loser waits for the next due-query.
 * @param {string} pipelineId
 * @param {{ now?:number, by?:string }} [opts]  `by` defaults to this pid@host stamp
 * @returns {{ id:number, action:string, payload:object|null, by:string, createdAt:string }|null}
 */
export function claimPipelineCommand(pipelineId, { now = Date.now(), by } = {}) {
  if (!pipelineId || typeof pipelineId !== 'string') return null;
  const claimedBy = by || `${process.pid}@${hostname()}`;
  const next = getDb().prepare(
    'SELECT id, action, payload, by, created_at FROM pipeline_commands WHERE pipeline_id = ? AND consumed_at IS NULL ORDER BY id LIMIT 1',
  ).get(pipelineId);
  if (!next) return null;
  // The guard is on consumed_at, not just the id: between the SELECT and the
  // UPDATE another process could claim the same row — the WHERE re-checks, so
  // only one claimant ever sees changes === 1.
  const changed = getDb().prepare(
    'UPDATE pipeline_commands SET consumed_at = ?, consumed_by = ? WHERE id = ? AND pipeline_id = ? AND consumed_at IS NULL',
  ).run(iso(now), claimedBy, next.id, pipelineId).changes;
  if (changed !== 1) return null;
  let payload = null;
  try { payload = next.payload ? JSON.parse(next.payload) : null; } catch { /* corrupt blob: no payload */ }
  return { id: next.id, action: next.action, payload, by: next.by, createdAt: next.created_at };
}

/**
 * Record what a payload-bearing command did (v52 `result`): the issuing client polls for it
 * (model-switch.mjs requestLiveModelSwitch). Only a CLAIMED row is written — a pending one has not run.
 * @param {number} id  the command id claimPipelineCommand returned
 * @param {object} result JSON-serializable
 * @returns {boolean} whether a row was written
 */
export function completePipelineCommand(id, result) {
  if (!Number.isInteger(id)) return false;
  return getDb().prepare(
    'UPDATE pipeline_commands SET result = ? WHERE id = ? AND consumed_at IS NOT NULL',
  ).run(JSON.stringify(result ?? null), id).changes === 1;
}

/**
 * Drop every UNCLAIMED command for one pipeline — called by the harness the
 * moment it takes ownership (start or resume). Anything pending then was written
 * for an earlier incarnation of the run: an unconfirmed `worca stop` whose run
 * was paused or interrupted another way must not stop the run once resumed.
 * Claimed rows stay (they are the audit trail of what was executed).
 * @param {string} pipelineId
 * @returns {number} rows removed
 */
export function discardPendingPipelineCommands(pipelineId) {
  if (!pipelineId || typeof pipelineId !== 'string') return 0;
  return getDb().prepare(
    'DELETE FROM pipeline_commands WHERE pipeline_id = ? AND consumed_at IS NULL',
  ).run(pipelineId).changes;
}

/**
 * Drop command rows whose target pipeline is settled — the mailbox's reaper. A
 * command for a done/stopped/paused/interrupted run can never be executed (no
 * live orchestrator), so consuming it would be a lie; deleting is the honest
 * end, and the issuing CLI reports it through the run's status instead. Called
 * best-effort by the control CLI before each enqueue; never load-bearing — the
 * harness discards a resumed run's leftovers itself (discardPendingPipelineCommands).
 * @param {{ now?:number }} [opts]
 * @returns {number} rows removed
 */
export function reapPipelineCommands({ now = Date.now() } = {}) {
  const marks = SETTLED_PIPELINE.map(() => '?').join(', ');
  return getDb().prepare(`
    DELETE FROM pipeline_commands WHERE pipeline_id IN (
      SELECT id FROM pipelines WHERE status IN (${marks})
    )
  `).run(...SETTLED_PIPELINE).changes;
}
