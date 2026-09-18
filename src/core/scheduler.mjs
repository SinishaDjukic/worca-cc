// src/core/scheduler.mjs
// Scheduled runs (schema v31): the launch-ticket store, the recurring-schedule
// parents, and the due-ticket loop. NO timers live here and NO run is started here:
// the host (ui/server.mjs' tick, or a `--wait` CLI) passes a `start` function, and
// every time-dependent function takes `now` — so the whole module is testable with
// an injected clock.
//
// Model
//   scheduled_runs  one TICKET per planned start. Its id is the runId UUID the fired
//                   run will carry, so links made at scheduling time survive the start.
//   schedules       the parent of a recurring series. It materialises only its NEXT
//                   occurrence as a ticket; when that ticket reaches an end state the
//                   next one is computed. One-shot tickets have no parent.
//
// A waiting run is NEVER a row in `pipelines`: the pipeline row is still born inside
// run(), so stats, sweeps, the delete guard and team metrics never meet it.
//
// Ticket states:  scheduled -> firing -> fired          (then the pipeline's own states)
//                 scheduled -> canceled | skipped | missed
//                 firing    -> failed | scheduled (transient error, retry_at set)
//                 missed    -> scheduled (Run now / reschedule)

import { randomUUID, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { getDb, tx } from './db.mjs';
import { worcaHome } from './projects.mjs';
import { projectKey } from './store.mjs';
import { addNotification, resolveNotifications } from './notifications.mjs';
import {
  normalizeRule, nextOccurrence, describeRule, OVERLAP_POLICIES, MISSED_POLICIES,
} from '../shared/schedule/recurrence.mjs';

export const TICKET_STATUSES = ['scheduled', 'firing', 'fired', 'canceled', 'skipped', 'missed', 'failed'];
/** Ticket states that still occupy their schedule's single "next occurrence" slot. */
const OPEN_TICKET = ['scheduled', 'firing'];
/** Minutes to wait before attempt n+1 after a transient start error. */
export const RETRY_BACKOFF_MIN = [1, 2, 5, 10, 15, 30];
/** A start this close to its slot is "on time" (the tick is 30 s). */
export const ON_TIME_SLACK_MS = 90_000;
/** A late start beyond this is worth a feed item. */
export const LATE_NOTICE_MS = 5 * 60_000;
/** Pipeline statuses under which a previous occurrence still counts as overlapping. */
const LIVE_PIPELINE = ['created', 'starting', 'running', 'pausing'];
/** A fired ticket whose pipeline id is not known yet counts as live this long. */
const FIRED_UNKNOWN_LIVE_MS = 3 * 60_000;
export const TICKET_RETENTION_DAYS = 30;
/** Another host's owner is trusted while it keeps touching its ticket. */
const FOREIGN_OWNER_FRESH_MS = 2 * 60_000;
const STALE_FIRING_MS = 10 * 60_000;

const iso = (ms) => new Date(ms).toISOString();
const parseJson = (s, fallback = null) => { try { return JSON.parse(s); } catch { return fallback; } };

/** True when `pid` is a live process on THIS host (EPERM = alive, not ours). */
export function defaultPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

// ── staging (durable extras) ─────────────────────────────────────────────────

/** `<worcaHome>/scheduled/<id>` — where a ticket's or a series' uploaded extras wait. */
export function scheduleStageDir(id) {
  return join(worcaHome(), 'scheduled', String(id).replace(/[^A-Za-z0-9_-]/g, ''));
}
function removeStage(id) {
  try { rmSync(scheduleStageDir(id), { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── row mapping ──────────────────────────────────────────────────────────────

/** The display summary of a stored request — never the full prompt or file bodies. */
export function summarizeRequest(req) {
  const r = req && typeof req === 'object' ? req : {};
  const text = typeof r.prompt === 'string' && r.prompt ? r.prompt : (typeof r.promptMarkdown === 'string' ? r.promptMarkdown : '');
  const src = r.source && typeof r.source === 'object' ? r.source : null;
  return {
    target: r.workspaceId ? 'workspace' : 'project',
    workflowId: r.workflowId || 'wf_default',
    guardrailsId: r.guardrailsId || null,
    prompt: text.length > 280 ? `${text.slice(0, 280)}…` : text,
    source: src ? { type: src.type || null, plugin: src.plugin || null, sourceId: src.sourceId || null, taskId: src.taskId || null, title: src.title || null, url: src.url || null } : null,
    sourceBranch: r.sourceBranch || null,
    featureBranch: r.featureBranch || null,
    memoryScope: r.memoryScope || null,
    mock: !!r.mock,
    extras: Array.isArray(r.internal?.extrasPaths) ? r.internal.extrasPaths.length : 0,
  };
}

function rowToTicket(r, { withRequest = false } = {}) {
  if (!r) return null;
  const request = parseJson(r.request, {});
  const t = {
    id: r.id,
    kind: 'once',
    scheduleId: r.schedule_id || null,
    title: r.title || null,
    projectKey: r.project_key || null,
    projectDir: r.project_dir || null,
    workspaceId: r.workspace_id || null,
    runAt: r.run_at,
    scheduledFor: r.run_at,
    status: r.status,
    ifMissed: r.if_missed,
    graceMin: r.grace_min,
    attempts: r.attempts,
    retryAt: r.retry_at || null,
    queued: !!r.queued,
    forced: !!r.forced,
    ownerPid: r.owner_pid ?? null,
    ownerHost: r.owner_host || null,
    pipelineId: r.pipeline_id || null,
    failReason: r.fail_reason || null,
    askThreadId: r.ask_thread_id || null,
    askCardId: r.ask_card_id || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    summary: summarizeRequest(request),
  };
  if (withRequest) t.request = request;
  return t;
}

function rowToSchedule(r, { withRequest = false } = {}) {
  if (!r) return null;
  const request = parseJson(r.request, {});
  const rule = parseJson(r.rule, null);
  const s = {
    id: r.id,
    kind: 'recurring',
    title: r.title || null,
    projectKey: r.project_key || null,
    projectDir: r.project_dir || null,
    workspaceId: r.workspace_id || null,
    rule,
    sentence: describeRule(rule),
    tz: rule?.tz || null,
    overlap: r.overlap,
    maxFailures: r.max_failures,
    failureStreak: r.failure_streak,
    ifMissed: r.if_missed,
    graceMin: r.grace_min,
    status: r.status,
    pauseReason: r.pause_reason || null,
    runsCount: r.runs_count,
    nextRunAt: r.next_run_at || null,
    lastResult: r.last_result || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    summary: summarizeRequest(request),
  };
  if (withRequest) s.request = request;
  return s;
}

function targetCols({ projectDir = null, workspaceId = null }) {
  return {
    project_key: projectDir ? projectKey(projectDir) : null,
    project_dir: projectDir || null,
    workspace_id: workspaceId || null,
  };
}

function normPolicy(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}
function normGrace(v, fallback = 360) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 && n <= 10080 ? n : fallback;
}
function normMaxFailures(v, fallback = 3) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 && n <= 100 ? n : fallback;
}

// ── tickets ──────────────────────────────────────────────────────────────────

/**
 * Create one launch ticket.
 * @param {object} o
 * @param {string} [o.id] the runId UUID (minted when absent)
 * @param {number} o.runAtMs UTC instant
 * @param {object} o.request POST /api/run body shape (+ `internal`)
 * @returns {object} the ticket
 */
export function createTicket({
  id = randomUUID(), scheduleId = null, title = null, projectDir = null, workspaceId = null,
  runAtMs, request, ifMissed = 'run', graceMin = 360, ownerPid = null, ownerHost = null,
  askThreadId = null, askCardId = null, forced = false, now = Date.now(),
}) {
  if (!Number.isFinite(runAtMs)) throw new Error('createTicket: runAtMs is required');
  const tc = targetCols({ projectDir, workspaceId });
  const ts = iso(now);
  getDb().prepare(`
    INSERT INTO scheduled_runs (id, schedule_id, title, project_key, project_dir, workspace_id, run_at, request,
      status, if_missed, grace_min, owner_pid, owner_host, ask_thread_id, ask_card_id, forced, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, scheduleId, title, tc.project_key, tc.project_dir, tc.workspace_id, iso(runAtMs), JSON.stringify(request || {}),
    normPolicy(ifMissed, MISSED_POLICIES, 'run'), normGrace(graceMin), ownerPid, ownerPid != null ? (ownerHost || hostname()) : null,
    askThreadId, askCardId, forced ? 1 : 0, ts, ts);
  return getTicket(id);
}

export function getTicket(id, opts = {}) {
  return rowToTicket(getDb().prepare('SELECT * FROM scheduled_runs WHERE id = ?').get(String(id)), opts);
}

/**
 * List tickets, soonest first. `open` (default) keeps scheduled/firing/missed — the
 * ones a person can still act on; `all` adds the ended ones.
 */
export function listTickets({ projectDir = null, workspaceId = null, scheduleId = null, all = false, oneShotOnly = false, limit = 500 } = {}) {
  const where = [];
  const args = [];
  if (projectDir) { where.push('project_key = ?'); args.push(projectKey(projectDir)); }
  if (workspaceId) { where.push('workspace_id = ?'); args.push(workspaceId); }
  if (scheduleId) { where.push('schedule_id = ?'); args.push(scheduleId); }
  if (oneShotOnly) where.push('schedule_id IS NULL');
  if (!all) where.push("status IN ('scheduled', 'firing', 'missed')");
  const sql = `SELECT * FROM scheduled_runs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY run_at ASC LIMIT ${Math.max(1, Math.min(2000, Number(limit) || 500))}`;
  return getDb().prepare(sql).all(...args).map((r) => rowToTicket(r));
}

function touchTicket(id, sets, args, now) {
  return getDb().prepare(`UPDATE scheduled_runs SET ${sets}, updated_at = ? WHERE id = ?`).run(...args, iso(now), id).changes;
}

/**
 * Move a waiting (or missed) ticket to a new time and/or change its missed policy.
 * A missed ticket becomes `scheduled` again and its alarm resolves.
 * @returns {object|null} the ticket, or null when it is not editable
 */
export function updateTicket(id, { runAtMs, ifMissed, graceMin } = {}, { now = Date.now() } = {}) {
  const t = getTicket(id);
  if (!t || !['scheduled', 'missed'].includes(t.status)) return null;
  const sets = [];
  const args = [];
  if (Number.isFinite(runAtMs)) { sets.push('run_at = ?', "status = 'scheduled'", 'attempts = 0', 'retry_at = NULL', 'queued = 0', 'forced = 0', 'fail_reason = NULL'); args.push(iso(runAtMs)); }
  if (ifMissed !== undefined) { sets.push('if_missed = ?'); args.push(normPolicy(ifMissed, MISSED_POLICIES, t.ifMissed)); }
  if (graceMin !== undefined) { sets.push('grace_min = ?'); args.push(normGrace(graceMin, t.graceMin)); }
  if (!sets.length) return t;
  touchTicket(id, sets.join(', '), args, now);
  if (Number.isFinite(runAtMs)) resolveNotifications({ ticketId: id, kinds: ['missed', 'failed'] });
  return getTicket(id);
}

/**
 * Cancel a one-shot ticket (scheduled or missed). For an occurrence of a series use
 * skipNext(). @returns {object|null}
 */
export function cancelTicket(id, { now = Date.now() } = {}) {
  const changed = getDb().prepare("UPDATE scheduled_runs SET status = 'canceled', updated_at = ? WHERE id = ? AND status IN ('scheduled', 'missed')")
    .run(iso(now), String(id)).changes;
  if (!changed) return null;
  const t = getTicket(id);
  resolveNotifications({ ticketId: id });
  if (!t.scheduleId) removeStage(id);
  return t;
}

/**
 * Ask for an immediate start: the ticket becomes due now and bypasses the missed and
 * overlap checks. The host's tick (or the owning `--wait` CLI) picks it up.
 */
export function requestRunNow(id, { now = Date.now() } = {}) {
  const changed = getDb().prepare(`UPDATE scheduled_runs SET status = 'scheduled', forced = 1, retry_at = NULL, queued = 0, fail_reason = NULL, updated_at = ?
    WHERE id = ? AND status IN ('scheduled', 'missed')`).run(iso(now), String(id)).changes;
  if (!changed) return null;
  resolveNotifications({ ticketId: id, kinds: ['missed', 'failed'] });
  return getTicket(id);
}

/**
 * Claim a due ticket for THIS process. One guarded UPDATE: only the process that
 * changes the row proceeds, so two hosts on one home can never start a run twice.
 * An owned ticket can only be claimed by its owner.
 */
export function claimTicket(id, { pid = process.pid, host = hostname(), now = Date.now() } = {}) {
  const changed = getDb().prepare(`UPDATE scheduled_runs SET status = 'firing', owner_pid = ?, owner_host = ?, updated_at = ?
    WHERE id = ? AND status = 'scheduled' AND (owner_pid IS NULL OR (owner_pid = ? AND owner_host = ?))`)
    .run(pid, host, iso(now), String(id), pid, host).changes;
  return changed === 1;
}

/** Keep an owned ticket fresh (a `--wait` CLI calls this while it polls). */
export function heartbeatTicket(id, { now = Date.now() } = {}) {
  return touchTicket(String(id), 'attempts = attempts', [], now) > 0;
}

/** Hand an owned ticket back to the server (the waiting terminal is going away). */
export function releaseTicket(id, { now = Date.now() } = {}) {
  return getDb().prepare("UPDATE scheduled_runs SET owner_pid = NULL, owner_host = NULL, updated_at = ? WHERE id = ? AND status = 'scheduled'")
    .run(iso(now), String(id)).changes > 0;
}

function markFired(id, pipelineId, now) {
  touchTicket(id, "status = 'fired', pipeline_id = COALESCE(?, pipeline_id), forced = 0, queued = 0, retry_at = NULL", [pipelineId || null], now);
}

/**
 * Record the pipeline a fired ticket became, and stamp the run's provenance columns.
 * Safe to call repeatedly; a missing pipelines row (not written yet) is a no-op there.
 */
export function setTicketPipeline(id, pipelineId, { now = Date.now() } = {}) {
  if (!pipelineId) return;
  const t = getTicket(id);
  if (!t) return;
  if (t.pipelineId !== pipelineId) touchTicket(id, 'pipeline_id = ?', [pipelineId], now);
  try {
    getDb().prepare('UPDATE pipelines SET scheduled_for = ?, schedule_id = ? WHERE id = ? AND scheduled_for IS NULL')
      .run(t.runAt, t.scheduleId || null, pipelineId);
  } catch { /* a hand-seeded schema without the columns: provenance is decoration */ }
}

// ── schedules (recurring parents) ────────────────────────────────────────────

/**
 * Create a recurring schedule and materialise its first occurrence.
 * @returns {{schedule: object, ticket: object|null}}
 * @throws {Error} on an invalid rule
 */
export function createSchedule({
  title = null, projectDir = null, workspaceId = null, request, rule, overlap = 'skip',
  maxFailures = 3, ifMissed = 'run', graceMin = 360, id = `sch_${randomBytes(4).toString('hex')}`, now = Date.now(),
}) {
  const norm = normalizeRule(rule, { todayLocal: rule?.anchor || null });
  if (!norm.ok) throw new Error(norm.error);
  const tc = targetCols({ projectDir, workspaceId });
  const ts = iso(now);
  tx(() => {
    getDb().prepare(`
      INSERT INTO schedules (id, title, project_key, project_dir, workspace_id, request, rule, overlap, max_failures,
        if_missed, grace_min, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, title, tc.project_key, tc.project_dir, tc.workspace_id, JSON.stringify(request || {}), JSON.stringify(norm.rule),
      normPolicy(overlap, OVERLAP_POLICIES, 'skip'), normMaxFailures(maxFailures), normPolicy(ifMissed, MISSED_POLICIES, 'run'),
      normGrace(graceMin), ts, ts);
  });
  const ticket = materializeNext(id, { now });
  return { schedule: getSchedule(id), ticket };
}

export function getSchedule(id, opts = {}) {
  return rowToSchedule(getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(String(id)), opts);
}

export function listSchedules({ projectDir = null, workspaceId = null, includeEnded = true } = {}) {
  const where = [];
  const args = [];
  if (projectDir) { where.push('project_key = ?'); args.push(projectKey(projectDir)); }
  if (workspaceId) { where.push('workspace_id = ?'); args.push(workspaceId); }
  if (!includeEnded) where.push("status != 'ended'");
  return getDb().prepare(`SELECT * FROM schedules ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`)
    .all(...args).map((r) => rowToSchedule(r));
}

function dropPendingTickets(scheduleId) {
  getDb().prepare("DELETE FROM scheduled_runs WHERE schedule_id = ? AND status = 'scheduled' AND owner_pid IS NULL").run(scheduleId);
}

/**
 * Ensure the series has its next occurrence as a ticket. No-op when one is already
 * open or the schedule is not active. When the rule is exhausted the schedule ENDS.
 * Catch-up is bounded by construction: the next slot is always computed from `now`,
 * so a backlog is never replayed.
 * @returns {object|null} the open ticket
 */
export function materializeNext(scheduleId, { now = Date.now() } = {}) {
  const s = getSchedule(scheduleId, { withRequest: true });
  if (!s || s.status !== 'active') return null;
  const open = getDb().prepare(`SELECT * FROM scheduled_runs WHERE schedule_id = ? AND status IN (${OPEN_TICKET.map(() => '?').join(', ')}) AND forced = 0 ORDER BY run_at ASC LIMIT 1`)
    .get(scheduleId, ...OPEN_TICKET);
  if (open) return rowToTicket(open);
  const next = nextOccurrence(s.rule, now, { firedCount: s.runsCount });
  if (next == null) {
    getDb().prepare("UPDATE schedules SET status = 'ended', next_run_at = NULL, updated_at = ? WHERE id = ?").run(iso(now), scheduleId);
    addNotification({ kind: 'ended', severity: 'info', scheduleId, projectDir: s.projectDir, title: s.title, message: 'reached its end and will not run again.', now: new Date(now) });
    return null;
  }
  const ticket = createTicket({
    scheduleId, title: s.title, projectDir: s.projectDir, workspaceId: s.workspaceId, runAtMs: next,
    request: s.request, ifMissed: s.ifMissed, graceMin: s.graceMin, now,
  });
  getDb().prepare('UPDATE schedules SET next_run_at = ?, updated_at = ? WHERE id = ?').run(iso(next), iso(now), scheduleId);
  return ticket;
}

/**
 * Edit a schedule. A pending occurrence is REPLACED by one computed from the new
 * rule; a run that already started is untouched.
 * @throws {Error} on an invalid rule
 */
export function updateSchedule(id, patch = {}, { now = Date.now() } = {}) {
  const s = getSchedule(id, { withRequest: true });
  if (!s) return null;
  const sets = [];
  const args = [];
  if (patch.title !== undefined) { sets.push('title = ?'); args.push(patch.title ? String(patch.title) : null); }
  if (patch.rule !== undefined) {
    const norm = normalizeRule({ anchor: s.rule?.anchor, ...patch.rule }, { todayLocal: s.rule?.anchor || null });
    if (!norm.ok) throw new Error(norm.error);
    sets.push('rule = ?'); args.push(JSON.stringify(norm.rule));
  }
  if (patch.overlap !== undefined) {
    if (!OVERLAP_POLICIES.includes(patch.overlap)) throw new Error(`overlap must be one of ${OVERLAP_POLICIES.join(' | ')}`);
    sets.push('overlap = ?'); args.push(patch.overlap);
  }
  if (patch.maxFailures !== undefined) { sets.push('max_failures = ?'); args.push(normMaxFailures(patch.maxFailures, s.maxFailures)); }
  if (patch.ifMissed !== undefined) {
    if (!MISSED_POLICIES.includes(patch.ifMissed)) throw new Error(`ifMissed must be one of ${MISSED_POLICIES.join(' | ')}`);
    sets.push('if_missed = ?'); args.push(patch.ifMissed);
  }
  if (patch.graceMin !== undefined) { sets.push('grace_min = ?'); args.push(normGrace(patch.graceMin, s.graceMin)); }
  if (patch.request !== undefined) { sets.push('request = ?'); args.push(JSON.stringify(patch.request || {})); }
  if (!sets.length) return s;
  tx(() => {
    getDb().prepare(`UPDATE schedules SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, iso(now), id);
    dropPendingTickets(id);
  });
  materializeNext(id, { now });
  return getSchedule(id);
}

/** Pause a series: its pending occurrence is dropped, nothing fires until resume. */
export function pauseSchedule(id, { reason = 'user', now = Date.now() } = {}) {
  const changed = getDb().prepare("UPDATE schedules SET status = 'paused', pause_reason = ?, next_run_at = NULL, updated_at = ? WHERE id = ? AND status = 'active'")
    .run(reason, iso(now), String(id)).changes;
  if (!changed) return null;
  dropPendingTickets(id);
  return getSchedule(id);
}

/** Resume a paused series: the streak resets, its alarms resolve, the next slot appears. */
export function resumeSchedule(id, { now = Date.now() } = {}) {
  const changed = getDb().prepare("UPDATE schedules SET status = 'active', pause_reason = NULL, failure_streak = 0, updated_at = ? WHERE id = ? AND status = 'paused'")
    .run(iso(now), String(id)).changes;
  if (!changed) return null;
  resolveNotifications({ scheduleId: id });
  materializeNext(id, { now });
  return getSchedule(id);
}

/** Skip the pending occurrence of a series and materialise the one after it. */
export function skipNext(id, { now = Date.now() } = {}) {
  const s = getSchedule(id);
  if (!s || s.status !== 'active') return null;
  const row = getDb().prepare("SELECT * FROM scheduled_runs WHERE schedule_id = ? AND status = 'scheduled' AND forced = 0 ORDER BY run_at ASC LIMIT 1").get(id);
  if (!row) return s;
  touchTicket(row.id, "status = 'skipped', fail_reason = 'skipped by user'", [], now);
  materializeNext(id, { now: Math.max(now, Date.parse(row.run_at)) });
  return getSchedule(id);
}

/** Start one extra occurrence now; the series itself does not shift. */
export function runScheduleNow(id, { now = Date.now() } = {}) {
  const s = getSchedule(id, { withRequest: true });
  if (!s || s.status === 'ended') return null;
  return createTicket({
    scheduleId: id, title: s.title, projectDir: s.projectDir, workspaceId: s.workspaceId, runAtMs: now,
    request: s.request, ifMissed: 'run', graceMin: s.graceMin, forced: true, now,
  });
}

/** Delete a series with its tickets and staged extras. */
export function deleteSchedule(id) {
  const changed = getDb().prepare('DELETE FROM schedules WHERE id = ?').run(String(id)).changes;
  if (changed) {
    getDb().prepare('DELETE FROM scheduled_runs WHERE schedule_id = ?').run(String(id)); // FK cascade may be off
    resolveNotifications({ scheduleId: id });
    removeStage(id);
  }
  return changed > 0;
}

/** Cancel every open schedule/ticket of a removed project or workspace. @returns {number} */
export function cancelForTarget({ projectDir = null, workspaceId = null } = {}) {
  let n = 0;
  for (const s of listSchedules({ projectDir, workspaceId })) { if (deleteSchedule(s.id)) n++; }
  for (const t of listTickets({ projectDir, workspaceId, oneShotOnly: true })) { if (cancelTicket(t.id)) n++; }
  return n;
}

/** Open schedules + one-shot tickets that depend on a workflow id (for the archive warning). */
export function dependentsOfWorkflow(workflowId) {
  const out = [];
  for (const s of listSchedules({ includeEnded: false })) if (s.summary.workflowId === workflowId) out.push({ id: s.id, kind: 'recurring', title: s.title });
  for (const t of listTickets({ oneShotOnly: true })) if (t.summary.workflowId === workflowId) out.push({ id: t.id, kind: 'once', title: t.title });
  return out;
}

// ── failure streak ───────────────────────────────────────────────────────────

function bumpFailure(scheduleId, now) {
  const s = getSchedule(scheduleId);
  if (!s) return;
  const streak = s.failureStreak + 1;
  getDb().prepare('UPDATE schedules SET failure_streak = ?, updated_at = ? WHERE id = ?').run(streak, iso(now), scheduleId);
  if (s.status === 'active' && s.maxFailures > 0 && streak >= s.maxFailures) {
    pauseSchedule(scheduleId, { reason: 'failure_streak', now });
    addNotification({
      kind: 'paused', scheduleId, projectDir: s.projectDir, title: s.title,
      message: `paused itself after ${streak} failure${streak === 1 ? '' : 's'} in a row.`, now: new Date(now),
    });
  }
}

function setLastResult(scheduleId, result, now, { resetStreak = false } = {}) {
  if (!scheduleId) return;
  getDb().prepare(`UPDATE schedules SET last_result = ?${resetStreak ? ', failure_streak = 0' : ''}, updated_at = ? WHERE id = ?`).run(result, iso(now), scheduleId);
}

// ── the due loop ─────────────────────────────────────────────────────────────

function ownerAlive(t, { host, pidAlive, now }) {
  if (t.ownerPid == null) return false;
  if (t.ownerHost === host) return pidAlive(t.ownerPid);
  return now - Date.parse(t.updatedAt) < FOREIGN_OWNER_FRESH_MS;
}

function previousStillRunning(t, { now, isLive }) {
  const rows = getDb().prepare("SELECT id, pipeline_id, updated_at FROM scheduled_runs WHERE schedule_id = ? AND status = 'fired' AND id != ? ORDER BY updated_at DESC LIMIT 5")
    .all(t.scheduleId, t.id);
  for (const r of rows) {
    if (isLive && isLive({ id: r.id, pipelineId: r.pipeline_id })) return true;
    if (r.pipeline_id) {
      const p = getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(r.pipeline_id);
      if (p && LIVE_PIPELINE.includes(p.status)) return true;
    } else if (now - Date.parse(r.updated_at) < FIRED_UNKNOWN_LIVE_MS) return true;
  }
  return false;
}

function effectiveGraceMs(t, schedule) {
  let grace = t.graceMin * 60_000;
  if (schedule?.rule) {
    const runAt = Date.parse(t.runAt);
    const next = nextOccurrence(schedule.rule, runAt, { firedCount: 0 });
    if (next != null) grace = Math.min(grace, next - runAt);
  }
  return grace;
}

function miss(t, schedule, now, why) {
  touchTicket(t.id, "status = 'missed', fail_reason = ?", [why], now);
  addNotification({
    kind: 'missed', scheduleId: t.scheduleId, ticketId: t.id, projectDir: t.projectDir, title: t.title,
    message: `was due at ${t.runAt}. ${why}`, now: new Date(now),
  });
  if (schedule) { setLastResult(schedule.id, 'missed', now); bumpFailure(schedule.id, now); materializeNext(schedule.id, { now }); }
}

/** Tickets whose time has come (and whose retry delay, if any, has passed). */
export function dueTickets({ now = Date.now() } = {}) {
  const ts = iso(now);
  // A retry delay holds EVERY ticket, a forced one (Run now) included — otherwise a
  // Run now that hit a transient error would be re-tried on every tick.
  return getDb().prepare(`SELECT * FROM scheduled_runs WHERE status = 'scheduled'
    AND (forced = 1 OR run_at <= ?) AND (retry_at IS NULL OR retry_at <= ?) ORDER BY run_at ASC`)
    .all(ts, ts).map((r) => rowToTicket(r, { withRequest: true }));
}

/**
 * Process every due ticket once. The host supplies:
 *   start(ticket)  -> { ok:true, pipelineId? } | { ok:false, error, transient? }
 *   isLive({id,pipelineId}) -> boolean   (optional: the host's in-memory run view)
 * Returns a summary { fired, missed, skipped, failed, retried, waiting }.
 */
export async function runDueTickets({
  now = Date.now(), start, isLive = null, pid = process.pid, host = hostname(), pidAlive = defaultPidAlive,
  onlyOwned = false, staggerMs = 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const out = { fired: [], missed: [], skipped: [], failed: [], retried: [], waiting: [] };
  let startedAny = false;
  for (const t of dueTickets({ now })) {
    const mine = t.ownerPid === pid && t.ownerHost === host;
    if (onlyOwned && !mine) continue;
    if (!mine && t.ownerPid != null) {
      if (ownerAlive(t, { host, pidAlive, now })) { out.waiting.push(t.id); continue; }
      releaseTicket(t.id, { now }); // the waiting terminal died: the ticket falls back to us
      t.ownerPid = null;
    }
    const schedule = t.scheduleId ? getSchedule(t.scheduleId) : null;
    if (t.scheduleId && !t.forced && (!schedule || schedule.status !== 'active')) {
      touchTicket(t.id, "status = 'canceled', fail_reason = 'schedule is not active'", [], now);
      continue;
    }

    const late = now - Date.parse(t.runAt);
    if (!t.forced && !t.queued && t.attempts === 0 && late > ON_TIME_SLACK_MS) {
      if (t.ifMissed === 'skip') { miss(t, schedule, now, 'Worca was not running, and this schedule skips missed slots.'); out.missed.push(t.id); continue; }
      if (late > effectiveGraceMs(t, schedule)) { miss(t, schedule, now, 'Worca was not running.'); out.missed.push(t.id); continue; }
    }

    if (schedule && !t.forced && schedule.overlap !== 'start' && previousStillRunning(t, { now, isLive })) {
      if (schedule.overlap === 'queue') {
        if (!t.queued) touchTicket(t.id, 'queued = 1', [], now);
        out.waiting.push(t.id);
        continue;
      }
      touchTicket(t.id, "status = 'skipped', fail_reason = 'the previous run was still going'", [], now);
      addNotification({
        kind: 'skipped', severity: 'info', scheduleId: t.scheduleId, ticketId: t.id, projectDir: t.projectDir, title: t.title,
        message: 'was skipped because the previous run was still going.', now: new Date(now),
      });
      setLastResult(schedule.id, 'skipped', now);
      materializeNext(schedule.id, { now });
      out.skipped.push(t.id);
      continue;
    }

    if (!claimTicket(t.id, { pid, host, now })) continue; // another process won the race
    if (startedAny && staggerMs > 0) await sleep(staggerMs);
    startedAny = true;

    let res;
    try { res = await start(t); }
    catch (err) { res = { ok: false, error: err && err.message ? err.message : String(err), transient: false }; }

    if (res && res.ok) {
      markFired(t.id, res.pipelineId || null, now);
      if (res.pipelineId) setTicketPipeline(t.id, res.pipelineId, { now });
      if (!t.forced && late > LATE_NOTICE_MS) {
        addNotification({
          kind: 'late', severity: 'info', scheduleId: t.scheduleId, ticketId: t.id, projectDir: t.projectDir, title: t.title,
          message: `started late. It was due at ${t.runAt}.`, now: new Date(now),
        });
      }
      if (schedule) {
        getDb().prepare('UPDATE schedules SET runs_count = runs_count + 1, updated_at = ? WHERE id = ?').run(iso(now), schedule.id);
        materializeNext(schedule.id, { now });
      }
      out.fired.push(t.id);
      continue;
    }

    const reason = (res && res.error) || 'the run could not be started';
    const backoff = RETRY_BACKOFF_MIN[Math.min(t.attempts, RETRY_BACKOFF_MIN.length - 1)] * 60_000;
    const deadline = Date.parse(t.runAt) + Math.max(effectiveGraceMs(t, schedule), ON_TIME_SLACK_MS);
    if (res && res.transient && now + backoff <= deadline) {
      touchTicket(t.id, "status = 'scheduled', attempts = attempts + 1, retry_at = ?, fail_reason = ?, owner_pid = NULL, owner_host = NULL",
        [iso(now + backoff), reason], now);
      if (t.attempts === 0) {
        addNotification({
          kind: 'retrying', severity: 'info', scheduleId: t.scheduleId, ticketId: t.id, projectDir: t.projectDir, title: t.title,
          message: `could not start yet (${reason}). Worca will retry.`, now: new Date(now),
        });
      }
      out.retried.push(t.id);
      continue;
    }
    touchTicket(t.id, "status = 'failed', fail_reason = ?, forced = 0", [reason], now);
    addNotification({
      kind: 'failed', scheduleId: t.scheduleId, ticketId: t.id, projectDir: t.projectDir, title: t.title,
      message: `could not start: ${reason}`, now: new Date(now),
    });
    if (schedule) { setLastResult(schedule.id, 'failed', now); bumpFailure(schedule.id, now); materializeNext(schedule.id, { now }); }
    else removeStage(t.id);
    out.failed.push(t.id);
  }
  return out;
}

/**
 * Record how a fired ticket's run ended. `done` resets the series' streak and posts a
 * quiet item; `error` counts towards the streak; a forced `paused` (it carries a
 * reason) notifies but does not count; `stopped` (by the user) is silent.
 */
export function recordOutcome(ticketId, { status, pipelineId = null, reason = null, detail = null, now = Date.now() } = {}) {
  const t = getTicket(ticketId);
  if (!t || t.status !== 'fired') return;
  if (pipelineId) setTicketPipeline(ticketId, pipelineId, { now });
  const base = { scheduleId: t.scheduleId, ticketId, pipelineId: pipelineId || t.pipelineId, projectDir: t.projectDir, title: t.title, now: new Date(now) };
  if (status === 'done') {
    addNotification({ ...base, kind: 'completed', severity: 'info', message: 'finished.' });
    setLastResult(t.scheduleId, 'completed', now, { resetStreak: true });
  } else if (status === 'error') {
    addNotification({ ...base, kind: 'run_error', message: `ended with an error${detail ? `: ${detail}` : '.'}` });
    if (t.scheduleId) { setLastResult(t.scheduleId, 'error', now); bumpFailure(t.scheduleId, now); }
  } else if (status === 'paused') {
    if (reason) addNotification({ ...base, kind: 'run_paused', message: `paused (${String(reason).replace(/_/g, ' ')})${detail ? `: ${detail}` : '.'}` });
    setLastResult(t.scheduleId, 'paused', now);
  } else if (status === 'stopped') {
    setLastResult(t.scheduleId, 'stopped', now);
  } else return;
  if (!t.scheduleId && status !== 'paused') removeStage(ticketId);
}

/**
 * Boot/tick janitor: a ticket stuck in `firing` with no pipeline and a dead owner goes
 * back to `scheduled`; every active series gets its next slot. @returns {number} recovered
 */
export function recoverScheduler({ now = Date.now(), host = hostname(), pidAlive = defaultPidAlive } = {}) {
  let n = 0;
  const rows = getDb().prepare("SELECT * FROM scheduled_runs WHERE status = 'firing' AND pipeline_id IS NULL").all();
  for (const r of rows) {
    const dead = r.owner_host === host ? !pidAlive(r.owner_pid) : now - Date.parse(r.updated_at) > STALE_FIRING_MS;
    if (!dead) continue;
    n += getDb().prepare("UPDATE scheduled_runs SET status = 'scheduled', owner_pid = NULL, owner_host = NULL, updated_at = ? WHERE id = ? AND status = 'firing'")
      .run(iso(now), r.id).changes;
  }
  for (const s of getDb().prepare("SELECT id FROM schedules WHERE status = 'active'").all()) materializeNext(s.id, { now });
  return n;
}

/** Drop ended tickets and ended schedules past the retention window. */
export function purgeScheduler({ days = TICKET_RETENTION_DAYS, now = Date.now() } = {}) {
  const cutoff = iso(now - days * 86400000);
  const old = getDb().prepare("SELECT id, schedule_id FROM scheduled_runs WHERE status IN ('fired', 'canceled', 'skipped', 'failed') AND updated_at < ?").all(cutoff);
  for (const r of old) { if (!r.schedule_id) removeStage(r.id); }
  const tickets = getDb().prepare("DELETE FROM scheduled_runs WHERE status IN ('fired', 'canceled', 'skipped', 'failed') AND updated_at < ?").run(cutoff).changes;
  let schedules = 0;
  for (const s of getDb().prepare("SELECT id FROM schedules WHERE status = 'ended' AND updated_at < ?").all(cutoff)) { if (deleteSchedule(s.id)) schedules++; }
  return { tickets, schedules };
}

/** A cheap change probe over both tables (another process may have written them). */
export function scheduleSignature() {
  const db = getDb();
  const a = db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), \'\') AS m FROM scheduled_runs').get();
  const b = db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), \'\') AS m FROM schedules').get();
  return `${a.n}:${a.m}|${b.n}:${b.m}`;
}

/**
 * Mark a claimed ticket fired — for a host that drives the run itself (the `--wait`
 * CLI); runDueTickets does this for its own starts.
 */
export function markTicketFired(id, { pipelineId = null, now = Date.now() } = {}) {
  markFired(String(id), pipelineId, now);
  if (pipelineId) setTicketPipeline(id, pipelineId, { now });
}

/** Counts for nav badges: { scheduled, recurring, missed }. */
export function scheduleCounts() {
  const db = getDb();
  return {
    scheduled: db.prepare("SELECT COUNT(*) AS n FROM scheduled_runs WHERE status IN ('scheduled', 'firing')").get().n,
    missed: db.prepare("SELECT COUNT(*) AS n FROM scheduled_runs WHERE status = 'missed'").get().n,
    recurring: db.prepare("SELECT COUNT(*) AS n FROM schedules WHERE status != 'ended'").get().n,
  };
}
