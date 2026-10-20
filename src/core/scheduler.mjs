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
import { projectKey, isNoProjectKey } from './store.mjs';
import { NO_PROJECT_ERRORS } from '../shared/no-project.mjs';
import { addNotification, resolveNotifications } from './notifications.mjs';
import { usageLimitSwitches, engineList } from '../shared/engine-switch.mjs';
import { readyEnginesCached } from './engines/ready-cache.mjs';
import { readRunTags } from './run-tags-store.mjs';
import {
  normalizeRule, nextOccurrence, countOccurrences, isSubDaily, describeRule, OVERLAP_POLICIES, MISSED_POLICIES,
} from '../shared/schedule/recurrence.mjs';

export const TICKET_STATUSES = ['scheduled', 'firing', 'fired', 'canceled', 'skipped', 'missed', 'failed'];
/** An after-ticket's run_at until its gate opens: an older build's dueTickets never sees it (spec D11). */
export const AFTER_RUN_AT = '9999-12-31T00:00:00.000Z';
export const AFTER_POLICIES = ['done', 'any'];
const AFTER_KINDS = ['ticket', 'pipeline'];
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
    ...(r.sameAsSource === true ? { sameAsSource: true } : {}),
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
    after: r.after_kind ? { kind: r.after_kind, id: r.after_id, policy: r.after_policy || 'done' } : null,
    resumePipelineId: r.resume_pipeline_id || null,
    sourceFromPrevious: !!r.source_from_previous,
    ownerPid: r.owner_pid ?? null,
    ownerHost: r.owner_host || null,
    pipelineId: r.pipeline_id || null,
    failReason: r.fail_reason || null,
    askThreadId: r.ask_thread_id || null,
    askCardId: r.ask_card_id || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    // v39: who made it / last changed it (identity.mjs actor; 'local' allowed, null = before v39).
    createdBy: r.created_by || null,
    updatedBy: r.updated_by || null,
    summary: summarizeRequest(request),
    ...(r.preset_id ? { presetId: r.preset_id } : {}),
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
    askThreadId: r.ask_thread_id || null,
    askCardId: r.ask_card_id || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdBy: r.created_by || null,
    updatedBy: r.updated_by || null,
    summary: summarizeRequest(request),
    ...(r.preset_id ? { presetId: r.preset_id } : {}),
  };
  if (withRequest) s.request = request;
  return s;
}

function targetCols({ projectDir = null, workspaceId = null }, { allowNoProject = false } = {}) {
  const key = projectDir ? projectKey(projectDir) : null;
  // P3 (L7): a run without a project cannot be scheduled or chained yet; its resume tickets can.
  if (isNoProjectKey(key) && !allowNoProject) throw new Error(NO_PROJECT_ERRORS.schedule);
  return {
    project_key: key,
    project_dir: projectDir || null,
    workspace_id: workspaceId || null,
  };
}

function normPolicy(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/** `{ kind:'ticket'|'pipeline', id }` or null. */
function normAfter(after) {
  if (!after || typeof after !== 'object') return null;
  const kind = String(after.kind || '');
  const id = typeof after.id === 'string' ? after.id.trim() : '';
  return AFTER_KINDS.includes(kind) && id ? { kind, id } : null;
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
 * @param {{kind:'ticket'|'pipeline', id:string}|null} [o.after] a predecessor instead of a time: run_at becomes AFTER_RUN_AT and runAtMs is ignored (run chains)
 * @param {'done'|'any'} [o.afterPolicy] with `after`: start only when it finishes `done` (default), or `any` way it ends
 * @param {boolean} [o.sourceFromPrevious] with `after`: start on the predecessor's feature branch, resolved when the ticket fires
 * @param {object} o.request POST /api/run body shape (+ `internal`)
 * @returns {object} the ticket
 */
export function createTicket({
  id = randomUUID(), scheduleId = null, title = null, projectDir = null, workspaceId = null,
  runAtMs, request, ifMissed = 'run', graceMin = 360, ownerPid = null, ownerHost = null,
  askThreadId = null, askCardId = null, forced = false,
  after = null, afterPolicy = 'done', sourceFromPrevious = false,
  resumePipelineId = null,
  presetId = null,
  createdBy = null,
  now = Date.now(),
}) {
  const chained = normAfter(after);
  if (after && !chained) throw new Error('createTicket: after.kind must be ticket | pipeline and after.id a string');
  if (resumePipelineId != null && (typeof resumePipelineId !== 'string' || !resumePipelineId.trim())) throw new Error('createTicket: resumePipelineId must be a non-empty string');
  if (resumePipelineId && chained) throw new Error('createTicket: a resume ticket cannot wait on another run');
  if (!chained && !Number.isFinite(runAtMs)) throw new Error('createTicket: runAtMs is required');
  const tc = targetCols({ projectDir, workspaceId }, { allowNoProject: !!resumePipelineId });
  const ts = iso(now);
  getDb().prepare(`
    INSERT INTO scheduled_runs (id, schedule_id, title, project_key, project_dir, workspace_id, run_at, request,
      status, if_missed, grace_min, owner_pid, owner_host, ask_thread_id, ask_card_id, forced,
      after_kind, after_id, after_policy, source_from_previous, resume_pipeline_id, preset_id, created_at, updated_at, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, scheduleId, title, tc.project_key, tc.project_dir, tc.workspace_id, chained ? AFTER_RUN_AT : iso(runAtMs), JSON.stringify(request || {}),
    normPolicy(ifMissed, MISSED_POLICIES, 'run'), normGrace(graceMin), ownerPid, ownerPid != null ? (ownerHost || hostname()) : null,
    askThreadId, askCardId, forced ? 1 : 0,
    chained ? chained.kind : null, chained ? chained.id : null, normPolicy(afterPolicy, AFTER_POLICIES, 'done'), chained && sourceFromPrevious ? 1 : 0,
    resumePipelineId ? resumePipelineId.trim() : null, presetId || null, ts, ts, byOf(createdBy), byOf(createdBy));
  return getTicket(id);
}

export function getTicket(id, opts = {}) {
  return rowToTicket(getDb().prepare('SELECT * FROM scheduled_runs WHERE id = ?').get(String(id)), opts);
}

/**
 * List tickets, soonest first. `open` (default) keeps scheduled/firing/missed — the
 * ones a person can still act on; `all` adds the ended ones. `newestFirst` orders
 * latest first, so a limit keeps the recent ones.
 */
export function listTickets({ projectDir = null, workspaceId = null, scheduleId = null, all = false, oneShotOnly = false, limit = 500, newestFirst = false } = {}) {
  const where = [];
  const args = [];
  if (projectDir) { where.push('project_key = ?'); args.push(projectKey(projectDir)); }
  if (workspaceId) { where.push('workspace_id = ?'); args.push(workspaceId); }
  if (scheduleId) { where.push('schedule_id = ?'); args.push(scheduleId); }
  if (oneShotOnly) where.push('schedule_id IS NULL');
  if (!all) where.push("status IN ('scheduled', 'firing', 'missed')");
  const sql = `SELECT * FROM scheduled_runs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY run_at ${newestFirst ? 'DESC' : 'ASC'} LIMIT ${Math.max(1, Math.min(2000, Number(limit) || 500))}`;
  return getDb().prepare(sql).all(...args).map((r) => rowToTicket(r));
}

function touchTicket(id, sets, args, now, by = undefined) {
  if (by !== undefined && byOf(by)) return getDb().prepare(`UPDATE scheduled_runs SET ${sets}, updated_at = ?, updated_by = ? WHERE id = ?`).run(...args, iso(now), byOf(by), id).changes;
  return getDb().prepare(`UPDATE scheduled_runs SET ${sets}, updated_at = ? WHERE id = ?`).run(...args, iso(now), id).changes;
}

/** A stored actor: a trimmed one-line string (identity.mjs values), else null. */
function byOf(by) {
  const v = typeof by === 'string' ? by.trim() : '';
  return v && v.length <= 200 && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(v) ? v : null;
}

/**
 * Move a waiting (or missed) ticket to a new time and/or change its missed policy.
 * A missed ticket becomes `scheduled` again and its alarm resolves.
 * @returns {object|null} the ticket, or null when it is not editable
 */
export function updateTicket(id, { runAtMs, ifMissed, graceMin, after, afterPolicy, sourceFromPrevious } = {}, { now = Date.now(), by = undefined } = {}) {
  const t = getTicket(id);
  if (!t || !['scheduled', 'missed'].includes(t.status)) return null;
  const sets = [];
  const args = [];
  if (Number.isFinite(runAtMs) && after) throw new Error('updateTicket: give runAtMs OR after, not both');
  if (Number.isFinite(runAtMs)) {
    // Back to a time: every after_* column goes, the policy included — a later re-chaining that
    // says nothing about the policy must start from `done`, never from a stale `any`.
    sets.push('run_at = ?', "status = 'scheduled'", 'attempts = 0', 'retry_at = NULL', 'queued = 0', 'forced = 0', 'fail_reason = NULL',
      'after_kind = NULL', 'after_id = NULL', "after_policy = 'done'", 'source_from_previous = 0');
    args.push(iso(runAtMs));
  }
  const chained = after === undefined ? undefined : normAfter(after);
  // `after: null` is "not given"; anything else that does not normalise is a caller bug — refuse it
  // like createTicket does, never answer "no change".
  if (after !== undefined && after !== null && !chained) throw new Error('updateTicket: after.kind must be ticket | pipeline and after.id a string');
  if (chained) {
    sets.push('run_at = ?', 'after_kind = ?', 'after_id = ?', "status = 'scheduled'", 'attempts = 0', 'retry_at = NULL', 'queued = 0', 'forced = 0', 'fail_reason = NULL');
    args.push(AFTER_RUN_AT, chained.kind, chained.id);
  }
  // A policy only rides with (or on) a predecessor. On a move to a time it is dropped, never pushed:
  // a second `after_policy = ?` in the same SET would win over the reset above (SQLite keeps the LAST
  // assignment of a repeated column), and the stale `any` the reset exists to clear would survive.
  if (afterPolicy !== undefined && !Number.isFinite(runAtMs) && AFTER_POLICIES.includes(afterPolicy)) { sets.push('after_policy = ?'); args.push(afterPolicy); }
  if (sourceFromPrevious !== undefined && (chained || (t.after && !Number.isFinite(runAtMs)))) { sets.push('source_from_previous = ?'); args.push(sourceFromPrevious ? 1 : 0); }
  if (ifMissed !== undefined) { sets.push('if_missed = ?'); args.push(normPolicy(ifMissed, MISSED_POLICIES, t.ifMissed)); }
  if (graceMin !== undefined) { sets.push('grace_min = ?'); args.push(normGrace(graceMin, t.graceMin)); }
  if (!sets.length) return t;
  touchTicket(id, sets.join(', '), args, now, by);
  if (Number.isFinite(runAtMs) || chained) resolveNotifications({ ticketId: id, kinds: ['missed', 'failed'] });
  return getTicket(id);
}

/**
 * Cancel a one-shot ticket (scheduled or missed). For an occurrence of a series use
 * skipNext(). @returns {object|null}
 */
export function cancelTicket(id, { now = Date.now(), by = undefined } = {}) {
  const changed = getDb().prepare("UPDATE scheduled_runs SET status = 'canceled', updated_at = ?, updated_by = COALESCE(?, updated_by) WHERE id = ? AND status IN ('scheduled', 'missed')")
    .run(iso(now), byOf(by), String(id)).changes;
  if (!changed) return null;
  const t = getTicket(id);
  resolveNotifications({ ticketId: id });
  if (!t.scheduleId) removeStage(id);
  return t;
}

/** Open (scheduled/missed) one-off tickets that resume the given pipeline. */
export function resumeTicketsFor(pipelineId) {
  if (typeof pipelineId !== 'string' || !pipelineId) return [];
  return getDb().prepare("SELECT * FROM scheduled_runs WHERE resume_pipeline_id = ? AND status IN ('scheduled', 'missed')")
    .all(pipelineId).map((r) => rowToTicket(r));
}

/**
 * Cancel every open resume ticket for a pipeline — the run was resumed or stopped by
 * hand, so its scheduled resume no longer applies. Each cancellation leaves an info
 * feed entry; the ticket leaves the open list. @returns {number} how many were canceled
 */
export function cancelResumeTicketsFor(pipelineId, { now = Date.now(), by = undefined, reason = 'the run was resumed or stopped by hand' } = {}) {
  const open = resumeTicketsFor(pipelineId);
  for (const t of open) {
    cancelTicket(t.id, { now, by });
    addNotification({
      kind: 'canceled', severity: 'info', scheduleId: null, ticketId: t.id,
      pipelineId, projectDir: t.projectDir, title: t.title,
      message: `was canceled: ${reason}${byOf(by) ? ` (by ${byOf(by)})` : ''}.`, now: new Date(now),
    });
  }
  return open.length;
}

/**
 * Ask for an immediate start: the ticket becomes due now and bypasses the missed and
 * overlap checks. The host's tick (or the owning `--wait` CLI) picks it up.
 */
export function requestRunNow(id, { now = Date.now(), by = undefined } = {}) {
  const changed = getDb().prepare(`UPDATE scheduled_runs SET status = 'scheduled', forced = 1, retry_at = NULL, queued = 0, fail_reason = NULL, updated_at = ?,
    updated_by = COALESCE(?, updated_by)
    WHERE id = ? AND status IN ('scheduled', 'missed')`).run(iso(now), byOf(by), String(id)).changes;
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

// ── run chains (spec 2026-09-21-run-chains-design.md) ────────────────────────

/** Pipeline statuses that mean "still going" for a predecessor (LIVE_PIPELINE + a parked run). */
const OPEN_PIPELINE = [...LIVE_PIPELINE, 'paused'];
const PIPELINE_REF_SQL = 'SELECT id, title, status, target, project_key, workspace_key, branch, workspace_meta, updated_at, archived_at FROM pipelines WHERE id = ?';
const BAD_TICKET_REASON = { canceled: 'was canceled', missed: 'was missed', failed: 'could not start', skipped: 'was skipped' };
const BAD_PIPELINE_REASON = { error: 'ended with an error', stopped: 'was stopped', interrupted: 'was interrupted' };

function pipelineRefRow(id) {
  return getDb().prepare(PIPELINE_REF_SQL).get(String(id)) || null;
}

/** A predecessor by id — a ticket first, else a pipeline — as one shape for validators and cards. */
export function afterRefOf(id) {
  if (typeof id !== 'string' || !id) return null;
  const t = getTicket(id);
  if (t) return { kind: 'ticket', id: t.id, title: t.title, status: t.status, pipelineId: t.pipelineId, projectKey: t.projectKey, workspaceId: t.workspaceId, scheduleId: t.scheduleId };
  const p = pipelineRefRow(id);
  if (!p) return null;
  return { kind: 'pipeline', id: p.id, title: p.title, status: p.status, pipelineId: p.id,
    projectKey: p.target === 'project' ? p.project_key : null, workspaceId: p.workspace_key || null, scheduleId: null };
}

// Run on the source branch (branch.sameAsSource): the work lands on the source in teardown, AFTER the row
// reads `done` (run-harness persists `done`, emits it, then tears down). Pending = a DONE row (only a done
// run merges back; an interrupted one gets no teardown until it is resumed) with a member record that has
// a worktree and no mergeBack yet; a record without a worktreeDir (a setup failure) never gets a teardown.
// Bounded from the row's last write: a host killed mid-teardown must not hold its dependents forever.
const MERGE_BACK_WAIT_MS = 10 * 60_000;
function mergeBackPending(row, now = Date.now()) {
  if (!row || row.status !== 'done') return false;
  const records = row.target === 'workspace'
    ? Object.values(parseJson(row.workspace_meta, null)?.branches || {})
    : [parseJson(row.branch, null)];
  if (!records.some((b) => b && b.sameAsSource === true && b.worktreeDir && !b.mergeBack)) return false;
  const age = now - Date.parse(row.updated_at);
  return !(age >= MERGE_BACK_WAIT_MS);   // no updated_at (NaN) → still within the bound
}
/** The branch a finished run's work is on: its feature branch — or its source once that branch is gone
 *  again: dropped at teardown as unchanged (branchKept:false), or merged back by a run on its source branch. */
const workBranchOf = (b) => (!b ? null
  : (b.branchKept === false || (b.sameAsSource === true && b.mergeBack && b.mergeBack.merged === true)) ? b.source : b.feature);

function pipelineGate(row, { policy, isLive, now = Date.now() }) {
  const base = { pipelineId: row.id, title: row.title, status: row.status };
  // Archive (DELETE /api/runs/:id -> pipeline-delete.mjs) never DELETEs the row: it stamps archived_at and
  // removes the branch, the worktree and the artifacts. For a chain that IS spec D9's removed predecessor:
  // a `done` row whose branch is gone must strand its dependents as missed (the pinned Archive note), not
  // start them — or fail them on a vanished ref. Archive refuses a live run, so this sits above isLive.
  if (row.archived_at) return { state: 'gone', reason: 'was archived', ...base };
  if ((isLive && isLive({ id: row.id, pipelineId: row.id })) || OPEN_PIPELINE.includes(row.status)) return { state: 'waiting', ...base };
  // A run on its source branch is not finished until its merge back is: a dependent started now would
  // branch off the source before that run's work lands on it.
  if (mergeBackPending(row, now)) return { state: 'waiting', ...base };
  if (row.status === 'done') return { state: 'ok', ...base };
  if (BAD_PIPELINE_REASON[row.status]) return policy === 'any' ? { state: 'ok', ...base } : { state: 'bad', reason: BAD_PIPELINE_REASON[row.status], ...base };
  return { state: 'waiting', ...base };   // an unknown status: keep waiting rather than guess
}

/**
 * Where a predecessor stands (spec §3.2): waiting (still going), ok (the gate is open),
 * bad (it ended in a way the policy refuses), gone (no such row any more).
 * @param {{kind:'ticket'|'pipeline', id:string}} after
 */
export function predecessorState(after, { policy = 'done', now = Date.now(), isLive = null } = {}) {
  if (!after || !after.kind || !after.id) return { state: 'gone', reason: 'was removed', pipelineId: null, title: null, status: null };
  if (after.kind === 'ticket') {
    const t = getTicket(after.id);
    if (!t) return { state: 'gone', reason: 'was removed', pipelineId: null, title: null, status: null };
    const base = { pipelineId: t.pipelineId, title: t.title, status: t.status };
    if (t.status === 'scheduled' || t.status === 'firing') return { state: 'waiting', ...base };
    if (BAD_TICKET_REASON[t.status]) return { state: 'bad', reason: BAD_TICKET_REASON[t.status], ...base };
    // fired
    if (!t.pipelineId) {
      if (isLive && isLive({ id: t.id, pipelineId: null })) return { state: 'waiting', ...base };
      return now - Date.parse(t.updatedAt) < FIRED_UNKNOWN_LIVE_MS ? { state: 'waiting', ...base } : { state: 'bad', reason: 'could not start', ...base };
    }
    const row = pipelineRefRow(t.pipelineId);
    if (!row) return { state: 'gone', reason: 'was removed', ...base };
    return { ...pipelineGate(row, { policy, isLive: isLive ? (q) => isLive({ id: t.id, pipelineId: q.pipelineId }) : null, now }), title: t.title || row.title };
  }
  const row = pipelineRefRow(after.id);
  if (!row) return { state: 'gone', reason: 'was removed', pipelineId: null, title: null, status: null };
  return pipelineGate(row, { policy, isLive, now });
}

/** The feature branch(es) a finished pipeline left, in POST /api/run's own field names.
 *  A member whose branch is gone again chains from the source it started from: dropped at teardown
 *  as unchanged (`branchKept:false` — the dropped branch no longer exists, and fireTicket would refuse
 *  the whole run for it), or merged back by a run on its source branch. `{ pending: true }` while a
 *  run on its source branch is still merging back (the gate waits on that; this is the backstop for
 *  a forced ticket, which skips the gate). */
export function previousBranchesOf(pipelineId, { now = Date.now() } = {}) {
  const row = pipelineRefRow(pipelineId);
  if (!row) return null;
  if (mergeBackPending(row, now)) return { pending: true };
  if (row.target === 'workspace') {
    const meta = parseJson(row.workspace_meta, null);
    const branches = meta && meta.branches && typeof meta.branches === 'object' ? meta.branches : null;
    if (!branches) return null;
    const byKey = {};
    for (const [key, b] of Object.entries(branches)) {
      const br = workBranchOf(b);
      if (typeof br === 'string' && br) byKey[key] = br;
    }
    return Object.keys(byKey).length ? { sourceBranchByKey: byKey } : null;
  }
  const br = workBranchOf(parseJson(row.branch, null));
  return typeof br === 'string' && br ? { sourceBranch: br } : null;
}

const AFTER_TAG_HOPS = 10;
/**
 * D9a: the tags a Run after ticket that names none will inherit when it fires (#718 reads the
 * predecessor's run tags then). A pipeline → its tags; a ticket → its own stored tags, else its
 * run's tags, else its own predecessor's. [] when nothing is known yet.
 */
export function inheritedTagsAtCreation(after) {
  let cur = after;
  for (let hop = 0; cur && cur.id && hop < AFTER_TAG_HOPS; hop++) {
    if (cur.kind === 'pipeline') return readRunTags(cur.id);
    const t = getTicket(cur.id, { withRequest: true });   // a plain getTicket has no `request`
    if (!t) return [];
    if (Array.isArray(t.request?.tags)) return t.request.tags;
    if (t.pipelineId) return readRunTags(t.pipelineId);
    cur = t.after;
  }
  return [];
}

/** Open tickets that wait for the given run — what a cancel or an archive would strand. */
export function dependentsOfRun({ ticketId = null, pipelineId = null } = {}) {
  const ids = [];
  if (ticketId) ids.push(String(ticketId));
  if (pipelineId) {
    ids.push(String(pipelineId));
    // A dependent may name the TICKET that became this pipeline (kind 'ticket'): predecessorState follows
    // it into the same row, so an archive strands it all the same — the Archive note must name it too.
    for (const r of getDb().prepare('SELECT id FROM scheduled_runs WHERE pipeline_id = ?').all(String(pipelineId))) ids.push(r.id);
  }
  if (!ids.length) return [];
  return getDb().prepare(`SELECT id, title FROM scheduled_runs WHERE after_id IN (${ids.map(() => '?').join(', ')}) AND status IN ('scheduled', 'firing', 'missed') ORDER BY created_at ASC`)
    .all(...ids).map((r) => ({ id: r.id, kind: 'once', title: r.title || null }));
}

const CHAIN_DEPTH_CAP = 100;

/** True when following `after` upward reaches `selfId` (spec D8). */
function chainReaches(after, selfId) {
  let cur = after;
  for (let depth = 0; cur && cur.kind === 'ticket' && depth < CHAIN_DEPTH_CAP; depth++) {
    if (cur.id === selfId) return true;
    const t = getTicket(cur.id);
    cur = t ? t.after : null;
  }
  return false;
}

/** The run whose feature branch `pipelineId` started from: its latest ticket's predecessor when that ticket
 *  started it "from its branch" (source_from_previous). null = no previous run (or its ticket was purged). */
function chainPredecessorOf(pipelineId) {
  const t = getDb().prepare('SELECT after_kind, after_id, source_from_previous FROM scheduled_runs WHERE pipeline_id = ? ORDER BY updated_at DESC LIMIT 1').get(String(pipelineId));
  if (!t || !t.source_from_previous || !t.after_id) return null;
  return (t.after_kind === 'ticket' ? getTicket(t.after_id)?.pipelineId : t.after_id) || null;
}

/**
 * The base branches a run's PR can target along its chain, root first:
 * [root, …, directSource]. Walks back through the tickets that started each run
 * "from its branch" (source_from_previous) while the predecessor's feature branch
 * IS the run's source; a run started any other way is the root. A missing link
 * (a purged ticket, a gone row), a mismatch or a repeat ends the walk, so a run
 * outside a chain answers [its own source]; no recorded source answers [].
 */
export function chainBaseBranchesOf(pipelineId) {
  const branchOf = (row) => {
    const b = row && row.target !== 'workspace' ? parseJson(row.branch, null) : null;
    return b && typeof b === 'object' ? b : null;
  };
  const row = pipelineRefRow(pipelineId);
  const source = branchOf(row)?.source;
  if (typeof source !== 'string' || !source) return [];
  const chain = [source];
  const seen = new Set([row.id]);
  let cur = row.id;
  for (let depth = 0; depth < CHAIN_DEPTH_CAP; depth++) {
    const predId = chainPredecessorOf(cur);
    if (!predId || seen.has(predId)) break;
    const pred = branchOf(pipelineRefRow(predId));
    if (!pred || pred.feature !== chain[0] || typeof pred.source !== 'string' || !pred.source) break;
    chain.unshift(pred.source);
    seen.add(predId);
    cur = predId;
  }
  return chain;
}

/**
 * The PR dialog's default base for a run started from the previous run's branch (L10, generic): its direct
 * source, the chain's last entry, until the previous run's PR is MERGED. null = keep the chain root.
 * `chain` is chainBaseBranchesOf's answer (mapped to remote branch names): two entries or more prove the first
 * link matched. A workspace row never stacks: each member's base stays its own source.
 */
export function stackedPrBaseOf(pipelineId, chain) {
  if (!Array.isArray(chain) || chain.length < 2) return null;
  const row = pipelineRefRow(pipelineId);
  if (!row || row.target === 'workspace') return null;
  const predId = chainPredecessorOf(row.id);
  if (!predId) return null;
  const pr = getDb().prepare('SELECT pr_url, pr_state FROM pipelines WHERE id = ?').get(String(predId));
  return pr && pr.pr_url && pr.pr_state === 'MERGED' ? null : chain[chain.length - 1];
}

// ── run progress: chains (spec 2026-10-14 run-progress P8) ───────────────────

const CHAIN_TICKET_SQL = 'SELECT id, title, status, after_kind, after_id, pipeline_id, project_key, project_dir, workspace_id, created_at FROM scheduled_runs';
const CHAIN_PIPELINE_SQL = 'SELECT id, title, status, target, project_key, workspace_key, pr_url FROM pipelines WHERE id = ?';
const WAITING_TICKET = new Set(['scheduled', 'firing']);
const PR_URL_RE = /^https:\/\/\S+$/i;   // the expander makes it a link: never a javascript:/data: href

/**
 * Every "Run after" chain with a run still going or waiting, root first. A chain is one tree of
 * `after` links (a ticket waits on a ticket or a pipeline; a fired ticket IS its pipeline), read in
 * pre-order with siblings by creation time: a plain line reads in its own order, a fork lists each
 * branch whole. A link whose predecessor ticket was purged starts its own chain; a hand-made cycle
 * has no root and is never listed. Read-only.
 * Member: { ticketId, pipelineId, title, state: done|current|waiting|failed, prUrl, historyKey, projectKey, workspaceId, projectDir }.
 * @param {{isLive?: (q:{id:string, pipelineId:string|null}) => boolean}} [opts]
 * @returns {Array<{id:string, title:string|null, members:object[]}>}
 */
export function runChains({ isLive = null } = {}) {
  const db = getDb();
  const linked = db.prepare(`${CHAIN_TICKET_SQL} WHERE after_id IS NOT NULL ORDER BY created_at ASC, id ASC`).all();
  if (!linked.length) return [];
  const tickets = new Map(linked.map((t) => [t.id, t]));
  const ticketRow = (id) => {
    if (!tickets.has(id)) tickets.set(id, db.prepare(`${CHAIN_TICKET_SQL} WHERE id = ?`).get(String(id)) || null);
    return tickets.get(id);
  };
  const keyOf = (t) => (t.pipeline_id ? `p:${t.pipeline_id}` : `t:${t.id}`);
  const nodes = new Map();
  const node = (key) => {
    if (!nodes.has(key)) nodes.set(key, { key, ticket: null, pipelineId: key.startsWith('p:') ? key.slice(2) : null, parent: null, children: [] });
    return nodes.get(key);
  };
  for (const t of linked) {
    const self = node(keyOf(t));
    self.ticket = t;
    let parentKey;
    if (t.after_kind === 'ticket') {
      const pt = ticketRow(t.after_id);
      if (!pt) continue;
      parentKey = keyOf(pt);
      const p = node(parentKey);
      if (!p.ticket) p.ticket = pt;
    } else parentKey = `p:${t.after_id}`;
    if (parentKey === self.key || self.parent) continue;
    self.parent = parentKey;
    node(parentKey).children.push(self.key);
  }
  const created = (n) => (n.ticket && n.ticket.created_at) || '';
  const member = (n) => {
    const t = n.ticket;
    const row = n.pipelineId ? db.prepare(CHAIN_PIPELINE_SQL).get(n.pipelineId) || null : null;
    let state;
    if (n.pipelineId) {
      if (!row) state = 'failed';
      else if ((isLive && isLive({ id: t ? t.id : row.id, pipelineId: row.id })) || OPEN_PIPELINE.includes(row.status)) state = 'current';
      else if (row.status === 'done') state = 'done';
      else if (BAD_PIPELINE_REASON[row.status]) state = 'failed';
      else state = 'current';                      // an unknown status: still going (pipelineGate's reading)
    } else if (WAITING_TICKET.has(t.status)) state = 'waiting';
    else if (t.status === 'fired') state = 'current';   // fired, its pipeline not linked yet
    else state = 'failed';                              // canceled | skipped | failed | missed
    const projectKey = (row && row.target === 'project' ? row.project_key : null) || (t && t.project_key) || null;
    return {
      ticketId: t ? t.id : null, pipelineId: n.pipelineId, title: (t && t.title) || (row && row.title) || null, state,
      prUrl: row && typeof row.pr_url === 'string' && PR_URL_RE.test(row.pr_url) ? row.pr_url : null,
      // The `#history/<key>/<id>` key, exactly as listAllPipelines builds it (artifacts.mjs ~2339).
      historyKey: !row ? null : row.target === 'workspace' && row.workspace_key ? `workspaces/${row.workspace_key}` : row.project_key || null,
      projectKey, workspaceId: (row && row.workspace_key) || (t && t.workspace_id) || null, projectDir: (t && t.project_dir) || null,
    };
  };
  const out = [];
  const seen = new Set();
  for (const root of nodes.values()) {
    if (root.parent) continue;
    const order = [];
    const walk = (n) => {
      if (!n || seen.has(n.key) || order.length >= CHAIN_DEPTH_CAP) return;
      seen.add(n.key);
      order.push(n);
      n.children.map((k) => nodes.get(k))
        .sort((a, b) => created(a).localeCompare(created(b)) || a.key.localeCompare(b.key))
        .forEach(walk);
    };
    walk(root);
    if (order.length < 2) continue;
    const members = order.map(member);
    // D29: the 1-based position of the member this one runs after (null for the root), for "starts after run N".
    order.forEach((n, i) => { const j = n.parent ? order.findIndex((x) => x.key === n.parent) : -1; members[i].after = j >= 0 ? j + 1 : null; });
    if (!members.some((m) => m.state === 'current' || m.state === 'waiting')) continue;
    out.push({ id: root.key, title: members[0].title, members });
  }
  return out;
}

/**
 * The ONE validator for a predecessor reference (server, CLI, Ask parent — spec §3.4).
 * `after.kind` is advisory: the row decides. Accepts a predecessor that is waiting or done.
 */
export function resolveAfterRef(after, { projectDir = null, workspaceId = null, policy = 'done', selfId = null, isLive = null } = {}) {
  const id = after && typeof after === 'object' && typeof after.id === 'string' ? after.id.trim() : '';
  if (!id || !after || !AFTER_KINDS.includes(String(after.kind))) return { ok: false, error: 'after must be { kind: ticket | pipeline, id }' };
  if (id.startsWith('sch_')) return { ok: false, error: 'after a repeating schedule is not supported — give the id of one of its runs' };
  const ref = afterRefOf(id);
  if (!ref) return { ok: false, error: `no run or scheduled run has id ${id}` };
  if (ref.scheduleId) return { ok: false, error: 'after a repeating schedule is not supported — give the id of one of its runs' };
  const name = `‘${ref.title || id.slice(0, 8)}’`;
  const wantKey = projectDir ? projectKey(projectDir) : null;
  if (isNoProjectKey(wantKey) || isNoProjectKey(ref.projectKey)) return { ok: false, error: NO_PROJECT_ERRORS.schedule };
  if (workspaceId) {
    if (!ref.workspaceId) return { ok: false, error: `${name} targets a project; this run targets a workspace` };
    if (ref.workspaceId !== workspaceId) return { ok: false, error: `${name} targets another workspace; this run targets ${workspaceId}` };
  } else {
    if (ref.workspaceId) return { ok: false, error: `${name} targets a workspace; this run targets a project` };
    if (wantKey && ref.projectKey !== wantKey) return { ok: false, error: `${name} targets another project; this run targets ${projectDir}` };
  }
  if (selfId && ref.kind === 'ticket') {
    if (ref.id === selfId) return { ok: false, error: `${name} is this run` };
    if (chainReaches({ kind: 'ticket', id: ref.id }, selfId)) return { ok: false, error: `${name} already waits for this run` };
  }
  const p = predecessorState({ kind: ref.kind, id: ref.id }, { policy, isLive });
  if (p.state === 'bad' || p.state === 'gone') return { ok: false, error: `${name} ${p.reason} — nothing to wait for` };
  return { ok: true, after: { kind: ref.kind, id: ref.id, title: ref.title || null, status: ref.status, pipelineId: ref.pipelineId || null } };
}

// ── schedules (recurring parents) ────────────────────────────────────────────

/**
 * Create a recurring schedule and materialise its first occurrence.
 * @returns {{schedule: object, ticket: object|null}}
 * @throws {Error} on an invalid rule
 */
export function createSchedule({
  title = null, projectDir = null, workspaceId = null, request, rule, overlap = 'skip',
  maxFailures = 3, ifMissed = 'run', graceMin = 360, id = `sch_${randomBytes(4).toString('hex')}`,
  askThreadId = null, askCardId = null, presetId = null, createdBy = null, now = Date.now(),
}) {
  const norm = normalizeRule(rule, { todayLocal: rule?.anchor || null });
  if (!norm.ok) throw new Error(norm.error);
  const tc = targetCols({ projectDir, workspaceId });
  const ts = iso(now);
  tx(() => {
    getDb().prepare(`
      INSERT INTO schedules (id, title, project_key, project_dir, workspace_id, request, rule, overlap, max_failures,
        if_missed, grace_min, status, ask_thread_id, ask_card_id, preset_id, created_at, updated_at, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
    `).run(id, title, tc.project_key, tc.project_dir, tc.workspace_id, JSON.stringify(request || {}), JSON.stringify(norm.rule),
      normPolicy(overlap, OVERLAP_POLICIES, 'skip'), normMaxFailures(maxFailures), normPolicy(ifMissed, MISSED_POLICIES, 'run'),
      normGrace(graceMin), askThreadId, askCardId, presetId || null, ts, ts, byOf(createdBy), byOf(createdBy));
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
 * so a backlog is never replayed. A sub-daily series starts one late slot within its
 * grace; the passed slots are reported in one `missed` notification, never replayed.
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
    request: s.request, ifMissed: s.ifMissed, graceMin: s.graceMin, presetId: s.presetId || null, createdBy: s.createdBy, now,
  });
  getDb().prepare('UPDATE schedules SET next_run_at = ?, updated_at = ? WHERE id = ?').run(iso(next), iso(now), scheduleId);
  return ticket;
}

/**
 * Edit a schedule. A pending occurrence is REPLACED by one computed from the new
 * rule; a run that already started is untouched.
 * @throws {Error} on an invalid rule
 */
export function updateSchedule(id, patch = {}, { now = Date.now(), by = undefined } = {}) {
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
    getDb().prepare(`UPDATE schedules SET ${sets.join(', ')}, updated_at = ?, updated_by = COALESCE(?, updated_by) WHERE id = ?`).run(...args, iso(now), byOf(by), id);
    dropPendingTickets(id);
  });
  materializeNext(id, { now });
  return getSchedule(id);
}

/** Pause a series: its pending occurrence is dropped, nothing fires until resume. */
export function pauseSchedule(id, { reason = 'user', now = Date.now(), by = undefined } = {}) {
  const changed = getDb().prepare("UPDATE schedules SET status = 'paused', pause_reason = ?, next_run_at = NULL, updated_at = ?, updated_by = COALESCE(?, updated_by) WHERE id = ? AND status = 'active'")
    .run(reason, iso(now), byOf(by), String(id)).changes;
  if (!changed) return null;
  dropPendingTickets(id);
  return getSchedule(id);
}

/** Resume a paused series: the streak resets, its alarms resolve, the next slot appears. */
export function resumeSchedule(id, { now = Date.now(), by = undefined } = {}) {
  const changed = getDb().prepare("UPDATE schedules SET status = 'active', pause_reason = NULL, failure_streak = 0, updated_at = ?, updated_by = COALESCE(?, updated_by) WHERE id = ? AND status = 'paused'")
    .run(iso(now), byOf(by), String(id)).changes;
  if (!changed) return null;
  resolveNotifications({ scheduleId: id });
  materializeNext(id, { now });
  return getSchedule(id);
}

/** Skip the pending occurrence of a series and materialise the one after it. */
export function skipNext(id, { now = Date.now(), by = undefined } = {}) {
  const s = getSchedule(id);
  if (!s || s.status !== 'active') return null;
  const row = getDb().prepare("SELECT * FROM scheduled_runs WHERE schedule_id = ? AND status = 'scheduled' AND forced = 0 ORDER BY run_at ASC LIMIT 1").get(id);
  if (!row) return s;
  touchTicket(row.id, "status = 'skipped', fail_reason = 'skipped by user'", [], now, by);
  if (byOf(by)) getDb().prepare('UPDATE schedules SET updated_at = ?, updated_by = ? WHERE id = ?').run(iso(now), byOf(by), id);
  materializeNext(id, { now: Math.max(now, Date.parse(row.run_at)) });
  return getSchedule(id);
}

/** Start one extra occurrence now; the series itself does not shift. */
export function runScheduleNow(id, { now = Date.now(), by = undefined } = {}) {
  const s = getSchedule(id, { withRequest: true });
  if (!s || s.status === 'ended') return null;
  return createTicket({
    scheduleId: id, title: s.title, projectDir: s.projectDir, workspaceId: s.workspaceId, runAtMs: now,
    request: s.request, ifMissed: 'run', graceMin: s.graceMin, forced: true, presetId: s.presetId || null, createdBy: byOf(by) || s.createdBy, now,
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

// ── who last changed it (notification text) ─────────────────────────────────

/** " Last changed by X." for a ticket/series whose last actor is a person, else ''.
 *  The series' actor wins over its occurrence ticket's (the ticket inherits it). */
export function lastChangedSuffix(t, schedule = null) {
  const who = byOf(schedule?.updatedBy || schedule?.createdBy || t?.updatedBy || t?.createdBy || null);
  return who && who !== 'local' ? ` Last changed by ${who}.` : '';
}

/** The suffix after a free-text reason: nothing locally; else a closing period if needed + the suffix. */
function withLastChanged(reason, t, schedule) {
  const suffix = lastChangedSuffix(t, schedule);
  return suffix ? `${/[.!?]$/.test(String(reason)) ? '' : '.'}${suffix}` : '';
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
      message: `paused itself after ${streak} failure${streak === 1 ? '' : 's'} in a row.${lastChangedSuffix(null, s)}`, now: new Date(now),
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

/**
 * How late a series slot may still start. A once-a-day (or rarer) series is capped at
 * the gap to its next slot. A sub-daily series is not: after a downtime it starts ONE
 * catch-up run within its grace and reports the slots in between as missed.
 */
function effectiveGraceMs(t, schedule) {
  let grace = t.graceMin * 60_000;
  if (schedule?.rule && !isSubDaily(schedule.rule)) {
    const runAt = Date.parse(t.runAt);
    const next = nextOccurrence(schedule.rule, runAt, { firedCount: 0 });
    if (next != null) grace = Math.min(grace, next - runAt);
  }
  return grace;
}

/** A sub-daily series' slots strictly after `t` up to `now`: the ones a downtime swallowed. */
function passedSlots(t, schedule, now) {
  return schedule?.rule && isSubDaily(schedule.rule) ? countOccurrences(schedule.rule, Date.parse(t.runAt), now) : { count: 0, last: null };
}
const slotsText = (n) => `${n} slot${n === 1 ? '' : 's'}`;

function miss(t, schedule, now, why) {
  touchTicket(t.id, "status = 'missed', fail_reason = ?", [why], now);
  const passed = passedSlots(t, schedule, now);
  const more = passed.count ? ` ${slotsText(passed.count)} after it, up to ${iso(passed.last)}, passed too.` : '';
  addNotification({
    kind: 'missed', scheduleId: t.scheduleId, ticketId: t.id, projectDir: t.projectDir, title: t.title,
    message: `was due at ${t.runAt}. ${why}${more}${lastChangedSuffix(t, schedule)}`, now: new Date(now),
  });
  if (schedule) {
    setLastResult(schedule.id, 'missed', now);
    // A sub-daily series misses a slot on every sleep of the laptop: that is not a failure.
    if (!isSubDaily(schedule.rule)) bumpFailure(schedule.id, now);
    materializeNext(schedule.id, { now });
  }
}

/** An after-ticket whose predecessor ended in a way its policy refuses, or vanished (spec §3.3). */
function missAfter(t, now, p) {
  touchTicket(t.id, "status = 'missed', fail_reason = ?", [`The run before it ${p.reason}.`], now);
  addNotification({
    kind: 'missed', ticketId: t.id, projectDir: t.projectDir, title: t.title,
    message: `was waiting for ‘${p.title || 'the run before it'}’, which ${p.reason}.${lastChangedSuffix(t)}`, now: new Date(now),
  });
}

/** Tickets whose time has come (and whose retry delay, if any, has passed). */
export function dueTickets({ now = Date.now() } = {}) {
  const ts = iso(now);
  // A retry delay holds EVERY ticket, a forced one (Run now) included — otherwise a
  // Run now that hit a transient error would be re-tried on every tick.
  return getDb().prepare(`SELECT * FROM scheduled_runs WHERE status = 'scheduled'
    AND (forced = 1 OR run_at <= ? OR after_id IS NOT NULL) AND (retry_at IS NULL OR retry_at <= ?) ORDER BY run_at ASC`)
    .all(ts, ts).map((r) => rowToTicket(r, { withRequest: true }));
}

/**
 * Process every due ticket once. The host supplies:
 *   start(ticket)  -> { ok:true, pipelineId? } | { ok:false, error, transient? } | { ok:false, skip:true, error }
 *   isLive({id,pipelineId}) -> boolean   (optional: the host's in-memory run view)
 * Returns a summary { fired, missed, skipped, failed, retried, waiting }.
 */
/**
 * Park a due ticket as skipped with its reason (info feed item). A series occurrence also records
 * Last: skipped and plans the next one; a one-shot drops its stage, like the failure arm. Not a
 * failure: the streak is untouched.
 */
export function skipTicket(t, reason, { now = Date.now(), schedule = t.scheduleId ? getSchedule(t.scheduleId) : null } = {}) {
  touchTicket(t.id, "status = 'skipped', fail_reason = ?, forced = 0", [reason], now);
  addNotification({
    kind: 'skipped', severity: 'info', scheduleId: t.scheduleId, ticketId: t.id,
    pipelineId: t.resumePipelineId || null, projectDir: t.projectDir, title: t.title,
    message: `was skipped: ${reason}.`, now: new Date(now),
  });
  if (schedule) { setLastResult(schedule.id, 'skipped', now); materializeNext(schedule.id, { now }); }
  else removeStage(t.id);
}

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

    if (t.after) {
      const p = predecessorState(t.after, { policy: t.after.policy, now, isLive });
      if (!t.forced) {
        if (p.state === 'waiting') { out.waiting.push(t.id); continue; }
        if (p.state !== 'ok') { missAfter(t, now, p); out.missed.push(t.id); continue; }
      }
      // D11: due from now — the late / retry maths below start here, never at the sentinel.
      if (t.attempts === 0) { touchTicket(t.id, 'run_at = ?', [iso(now)], now); t.runAt = iso(now); }
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
      // A sub-daily series overlaps often: the skipped ticket is the record, with no feed item.
      if (!isSubDaily(schedule.rule)) {
        addNotification({
          kind: 'skipped', severity: 'info', scheduleId: t.scheduleId, ticketId: t.id, projectDir: t.projectDir, title: t.title,
          message: 'was skipped because the previous run was still going.', now: new Date(now),
        });
      }
      setLastResult(schedule.id, 'skipped', now);
      materializeNext(schedule.id, { now });
      out.skipped.push(t.id);
      continue;
    }

    if (!claimTicket(t.id, { pid, host, now })) continue; // another process won the race
    // A sub-daily catch-up: this late slot starts, the later ones that already passed do not.
    const passed = !t.forced && !t.queued && t.attempts === 0 && late > ON_TIME_SLACK_MS ? passedSlots(t, schedule, now) : { count: 0 };
    if (passed.count) {
      addNotification({
        kind: 'missed', scheduleId: t.scheduleId, projectDir: t.projectDir, title: t.title,
        message: `missed ${slotsText(passed.count)}, up to ${iso(passed.last)}, while Worca was not running. Only the slot due at ${t.runAt} starts now, late.${lastChangedSuffix(t, schedule)}`,
        now: new Date(now),
      });
    }
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

    // A one-shot action whose target vanished (a resume ticket whose run was resumed or
    // stopped by hand): not a failure — park it as skipped with an info feed item.
    // (Mirrors the overlap-skip arm above; 'skipped' is a known terminal status —
    // TICKET_STATUSES / purgeScheduler.)
    if (res && res.skip) {
      skipTicket(t, (res && res.error) || 'no longer applies', { now, schedule });
      out.skipped.push(t.id);
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
      message: `could not start: ${reason}${withLastChanged(reason, t, schedule)}`, now: new Date(now),
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
export function recordOutcome(ticketId, { status, pipelineId = null, reason = null, detail = null, limitEngine = null, now = Date.now() } = {}) {
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
    // A usage limit the engine hit says how to continue now: on another engine.
    const others = usageLimitSwitches({ reason, limitEngine }, readyEnginesCached());
    const hint = others.length ? `${detail ? ' —' : ''} resume on ${engineList(others)} to continue now.` : '';
    if (reason) addNotification({ ...base, kind: 'run_paused', message: `paused (${String(reason).replace(/_/g, ' ')})${detail ? `: ${detail}` : '.'}${hint}` });
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
