// src/core/model-switch.mjs
// Switch the models of a run's remaining stages — ONE stage rule and ONE validation behind the run
// detail UI (GET/POST /api/pipelines/:id/models) and `worca switch-model`, for two cases:
//  - a PAUSED run has no process driving it, so the switch is a store edit: the frozen manifest
//    (pipelines.stepper AND resume_point.manifest — resume reads the latter first) gets the new
//    per-node model, effort and sub-agent policy, and a node whose MODEL changed is marked so the
//    resume starts it on a fresh Claude session instead of re-attaching the old one;
//  - a RUNNING run is switched by the process that drives it (GraphOrchestrator.switchModels):
//    in memory when that is this process, else through its run-control mailbox
//    (requestLiveModelSwitch → pipeline_commands 'switch-models' → the owner writes `result`).
// A stage may switch unless it is executing now or finished for good (switchableStages).
// Pausing, interrupted, stopped and finished runs are refused.

import { randomUUID } from 'node:crypto';
import { getDb } from './db.mjs';
import { readPipelineForResume, rewritePausedManifest, appendAuditById, isDeadOwner } from './artifacts.mjs';
import { listModels } from './config.mjs';
import { EFFORTS, SUBAGENT_MODEL_VALUES, subagentModelIssue } from './model-env.mjs';
import { byActor } from './identity.mjs';
import { enqueuePipelineCommand } from './pipeline-commands.mjs';
import { cycleGroups } from '../shared/graph/loops.mjs';

/** The four switchable cell fields ('' = inherit the default). */
export const SWITCH_FIELDS = Object.freeze(['model', 'effort', 'subagentModel', 'subagentEffort']);

export class ModelSwitchError extends Error {
  /**
   * @param {string} code    machine-readable reason (NOT_SWITCHABLE_STATUS, STAGE_COMPLETED, NOT_RUNNING, …)
   * @param {string} message what a surface shows
   * @param {number} [status] the HTTP status a route answers with
   */
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const pick = (cell) => Object.fromEntries(SWITCH_FIELDS.map((f) => [f, typeof cell?.[f] === 'string' ? cell[f] : '']));
const parseJson = (text) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };

/** The wire ids a scheduler snapshot (live, or a resume point's `snapshot`) holds at a cycle-cap gate.
 *  Read as scheduler.mjs `restore` reads them: a pre-plural point carries only `gate`; an ended run none. */
export function heldWireIds(snapshot) {
  if (!snapshot || snapshot.ended) return [];
  const gates = Array.isArray(snapshot.gates) ? snapshot.gates : (snapshot.gate ? [snapshot.gate] : []);
  return gates.map((g) => g?.wireId).filter((id) => typeof id === 'string');
}

/** Nodes that finished at least once and have nothing open (paused / running / failed / stopped). */
export function completedNodeIds(steps) {
  const done = new Set();
  const open = new Set();
  for (const s of steps || []) {
    if (!s?.nodeId) continue;
    (s.status === 'done' ? done : open).add(s.nodeId);
  }
  return new Set([...done].filter((id) => !open.has(id)));
}

/**
 * Every agent stage of `manifest` with its selection, its state and whether it may switch. Pure: the
 * paused store edit, the live orchestrator and the describe payload all use it. First match wins:
 *   running    executing now: a ledger row 'start' (the in-flight status) or in `active` → locked
 *   paused     a row 'paused' (a pause parked it mid-execution)                         → switchable
 *   pending    not finished: no 'done' row, or one plus an error/stopped row            → switchable
 *   may-rerun  finished, on a cycle whose OTHER member is running or paused, or whose
 *              loop wire waits at its cycle-cap gate                                     → switchable
 *   completed  finished otherwise (one-way, or its loop has exited)                     → locked
 * @param {{manifest:object, steps?:object[], active?:Iterable<string>, held?:Iterable<string>}} input
 *   `active`: node ids the scheduler is executing. A node's model is read at dispatch, BEFORE its
 *   ledger row exists (orchestrator _execute awaits the human cursor in between), and a composite
 *   (decomposition) keeps its node busy between slices that have no row — so the live caller passes
 *   the scheduler's view.
 *   `held`: wire ids held at their cycle-cap gate (the scheduler snapshot's `gates[].wireId`). While
 *   the user decides, every loop row is 'done' and nothing is active, yet "another cycle" re-runs it.
 */
export function switchableStages({ manifest, steps, active, held } = {}) {
  const running = new Set(active || []);
  const paused = new Set();
  const done = new Set();
  const unfinished = new Set();
  for (const s of steps || []) {
    if (!s?.nodeId) continue;
    if (s.status === 'start') running.add(s.nodeId);
    else if (s.status === 'paused') paused.add(s.nodeId);
    else if (s.status === 'done') done.add(s.nodeId);
    else unfinished.add(s.nodeId);                     // error / stopped: not completed (today's rule)
  }
  const groups = cycleGroups(manifest?.graph);
  const openGroups = new Set([...running, ...paused].filter((id) => groups.has(id)).map((id) => groups.get(id)));
  const wires = new Map((manifest?.graph?.wires || []).map((w) => [w?.id, w]));
  for (const wireId of held || []) {
    const w = wires.get(wireId);
    const group = groups.get(w?.to?.node);
    if (group !== undefined && group === groups.get(w.from?.node)) openGroups.add(group);   // a loop wire's ends share it
  }
  const stateOf = (id) => {
    if (running.has(id)) return 'running';
    if (paused.has(id)) return 'paused';
    if (!done.has(id) || unfinished.has(id)) return 'pending';
    return groups.has(id) && openGroups.has(groups.get(id)) ? 'may-rerun' : 'completed';
  };
  return (manifest?.graph?.nodes || [])
    .filter((n) => n?.kind === 'agent')
    .map((n) => {
      const state = stateOf(n.id);
      return {
        nodeId: n.id,
        key: n.key || '',
        label: n.label || n.key || n.id,
        ...pick(n),
        fanOut: !!n.fanOut,
        state,
        switchable: state !== 'running' && state !== 'completed',
      };
    });
}

/** '' when `change` may be applied to `cell`. Only TOUCHED fields are checked; a model/effort
 *  touch checks the MERGED pair (setNodeModel's rules, config.mjs). */
export function stageChangeError(cell, change, models) {
  const next = { ...pick(cell), ...change };
  if ('model' in change || 'effort' in change) {
    const entry = next.model ? models.find((m) => m.id === next.model) : null;
    if (next.model && !entry) return `unknown model "${next.model}"`;
    if (next.effort) {
      if (!EFFORTS.includes(next.effort)) return `unknown effort "${next.effort}"`;
      if (!entry) return 'select a model before choosing an effort';
      if (!entry.efforts.includes(next.effort)) return `model "${next.model}" does not support effort "${next.effort}"`;
    }
  }
  if ('subagentModel' in change) {
    const issue = subagentModelIssue(change.subagentModel);
    if (issue) return issue;
  }
  if ('subagentEffort' in change && change.subagentEffort && !EFFORTS.includes(change.subagentEffort)) {
    return `unknown sub-agent effort "${change.subagentEffort}"`;
  }
  return '';
}

/** Pure: a NEW manifest with `changes` applied to the graph cells and the derived steps cells. */
export function applyModelSwitch(manifest, changes) {
  const next = structuredClone(manifest);
  const changed = [];
  for (const cell of next?.graph?.nodes || []) {
    const change = changes[cell.id];
    if (!change || cell.kind !== 'agent') continue;
    const before = pick(cell);
    const after = { ...before, ...change };
    if (SWITCH_FIELDS.every((f) => before[f] === after[f])) continue;
    Object.assign(cell, after);
    changed.push({ nodeId: cell.id, label: cell.label || cell.key || cell.id, before, after });
  }
  // manifest.mjs copies model/effort into steps[].nodes[] (live v2 readers): keep them in step.
  const byId = new Map(changed.map((c) => [c.nodeId, c.after]));
  for (const step of next?.steps || []) {
    for (const n of step.nodes || []) {
      const a = byId.get(n.id);
      if (a) { n.model = a.model; n.effort = a.effort; }
    }
  }
  return { manifest: next, changed };
}

function assertChanges(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) {
    throw new ModelSwitchError('BAD_REQUEST', 'changes must name at least one stage', 400);
  }
}

function normalizeChange(raw, nodeId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ModelSwitchError('BAD_REQUEST', `changes for "${nodeId}" must be an object`, 400);
  }
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!SWITCH_FIELDS.includes(k)) {
      throw new ModelSwitchError('BAD_FIELD', `"${k}" cannot be switched (only ${SWITCH_FIELDS.join(', ')})`, 400);
    }
    if (v != null && typeof v !== 'string') throw new ModelSwitchError('BAD_REQUEST', `${k} for "${nodeId}" must be a string`, 400);
    out[k] = v == null ? '' : v.trim();
  }
  return out;
}

/**
 * Validate `changes` against `stages` and the model catalog. The first unknown stage, bad field or
 * invalid selection refuses the WHOLE request. Does NOT look at `switchable`: the paused path refuses
 * a locked stage, the live path skips it (D3).
 * @returns {Record<string, object>} the normalized changes by node id
 */
export function validateChanges(stages, changes, models) {
  assertChanges(changes);
  const byId = new Map((stages || []).map((s) => [s.nodeId, s]));
  const out = {};
  for (const [nodeId, raw] of Object.entries(changes)) {
    const stage = byId.get(nodeId);
    if (!stage) throw new ModelSwitchError('UNKNOWN_STAGE', `no agent stage "${nodeId}" in this run`, 400);
    const change = normalizeChange(raw, nodeId);
    const issue = stageChangeError(stage, change, models);
    if (issue) throw new ModelSwitchError('INVALID_SELECTION', `${stage.label}: ${issue}`, 400);
    out[nodeId] = change;
  }
  return out;
}

/** The paused path's refusal for a stage it may not touch. */
function lockedStageError(stage) {
  return stage.state === 'running'
    ? new ModelSwitchError('STAGE_RUNNING', `${stage.label} is running — its model cannot change while it runs`)
    : new ModelSwitchError('STAGE_COMPLETED', `${stage.label} already completed and cannot run again`);
}

/** The audit/log text of one change. */
export const describeModelChange = (c) => {
  const parts = [];
  if (c.before.model !== c.after.model) parts.push(`${c.before.model || 'default'} → ${c.after.model || 'default'}`);
  if (c.before.effort !== c.after.effort) parts.push(`effort ${c.after.effort || 'default'}`);
  if (c.before.subagentModel !== c.after.subagentModel) parts.push(`sub-agents ${c.after.subagentModel || 'default'}`);
  if (c.before.subagentEffort !== c.after.subagentEffort) parts.push(`sub-agent effort ${c.after.subagentEffort || 'default'}`);
  return `${c.label} ${parts.join(', ')}`;
};

/** One line per switched stage whose new model needs a sign-in. */
export function modelSwitchWarnings(changed, models) {
  return (changed || [])
    .filter((c) => c.after.model && models.find((m) => m.id === c.after.model)?.needsSignIn)
    .map((c) => `${c.label}: model "${c.after.model}" needs a sign-in before it can run`);
}

/**
 * Load + gate on status. `live`: the caller holds the run's in-process orchestrator, which is the
 * authority on "running" (the row may lag a tick). Paused additionally needs a v2 resume point.
 */
function loadSwitchable(pipelineId, { live = false } = {}) {
  if (!pipelineId || typeof pipelineId !== 'string') throw new ModelSwitchError('BAD_REQUEST', 'pipelineId is required', 400);
  const saved = readPipelineForResume(pipelineId);
  if (!saved) throw new ModelSwitchError('NOT_FOUND', 'pipeline not found', 404);
  const { row, resumePoint: rp } = saved;
  const status = live ? 'running' : row.status;
  // The pause markers persist the row as 'pausing' while the run unwinds (a GET can land there).
  if (status === 'pausing') throw new ModelSwitchError('NOT_RUNNING', 'the run is pausing — switch its models once it is paused');
  if (status !== 'paused' && status !== 'running') {
    throw new ModelSwitchError('NOT_SWITCHABLE_STATUS', `pipeline is "${row.status}" — models can be switched while it is running or paused`);
  }
  if (row.archived_at) throw new ModelSwitchError('ARCHIVED', 'pipeline is archived');
  if (status === 'paused') {
    if (!rp) throw new ModelSwitchError('NO_RESUME_POINT', 'pipeline has no resume point');
    if (rp.version !== 2) throw new ModelSwitchError('ENGINE_RETIRED', 'this run was made by the retired engine');
  }
  return { ...saved, status };
}

const noGraph = () => new ModelSwitchError('NO_GRAPH', 'the workflow is still being decided — there are no stages to switch yet');

/** The paused store edit's gate: a row that is running again was resumed since the caller listed it. */
function loadPaused(pipelineId) {
  const saved = loadSwitchable(pipelineId);
  if (saved.status !== 'paused') {
    throw new ModelSwitchError('CHANGED', 'the run is running again (resumed meanwhile) — reload and try again');
  }
  if (!saved.resumePoint.manifest?.graph?.nodes?.length) throw noGraph();
  return saved;
}

/** The catalog directory: a workspace's first member, else the registered project (or '' —
 *  the project-less catalog; a switch needs no worktree, resume still checks it). */
async function catalogDirOf(row, projectDirFor) {
  if (row.target === 'workspace') {
    try { return JSON.parse(row.workspace_meta || 'null')?.projects?.[0]?.projectDir || ''; } catch { return ''; }
  }
  try { return (projectDirFor ? await projectDirFor(row.project_key) : '') || ''; } catch { return ''; }
}

/**
 * What the switch UI / `worca switch-model <id>` show: status, stages + the run project's catalog.
 * @param {string} pipelineId
 * @param {{projectDirFor?:(key:string)=>Promise<string|null>|string|null,
 *          live?:{manifest:object, steps:object[], active?:string[], held?:string[], runDefault?:string}|null}} [opts]
 *   `live`: the in-process orchestrator's modelSwitchSnapshot() (the server passes it for a run it drives).
 */
export async function describeModelSwitch(pipelineId, { projectDirFor, live = null } = {}) {
  const saved = loadSwitchable(pipelineId, { live: !!live });
  const { row, status } = saved;
  const rp = saved.resumePoint;
  const running = status === 'running';
  const input = !running ? { manifest: rp.manifest, steps: saved.steps, held: heldWireIds(rp.snapshot) }
    : live ? { manifest: live.manifest, steps: live.steps, active: live.active, held: live.held }
    // Another process drives it: its row's resume point is its last clean snapshot (holds included).
    : { manifest: parseJson(row.stepper), steps: saved.steps, held: heldWireIds(rp?.snapshot) };
  if (!input.manifest?.graph?.nodes?.length) throw noGraph();
  const models = await listModels(await catalogDirOf(row, projectDirFor));
  return {
    pipelineId,
    title: row.title || '',
    status,
    pauseReason: !running && typeof rp.pauseReason === 'string' ? rp.pauseReason : null,
    pauseDetail: !running && typeof rp.pauseDetail === 'string' ? rp.pauseDetail : null,
    runDefault: (running && live ? live.runDefault : rp?.claude?.model) || '',
    stages: switchableStages(input),
    models: models.filter((m) => !m.hidden).map((m) => ({
      id: m.id, label: m.label || m.id, efforts: Array.isArray(m.efforts) ? m.efforts : [],
      ...(m.needsSignIn ? { needsSignIn: true } : {}),
    })),
    efforts: [...EFFORTS],
    subagentModels: [...SUBAGENT_MODEL_VALUES],
  };
}

/**
 * Switch a paused run's remaining stages (a store edit). Throws ModelSwitchError; resolves with what
 * changed. Since v2 of this feature a loop stage that already ran is switchable while its loop is open.
 * @param {string} pipelineId
 * @param {object} opts
 * @param {Record<string, {model?:string,effort?:string,subagentModel?:string,subagentEffort?:string}>} opts.changes by node id
 * @param {string} [opts.by] identity.mjs actor, named in the audit line
 * @param {(key:string)=>Promise<string|null>|string|null} [opts.projectDirFor]
 */
export async function switchPausedRunModels(pipelineId, { changes, by = 'local', projectDirFor } = {}) {
  assertChanges(changes);
  const saved = loadPaused(pipelineId);
  const rp = saved.resumePoint;
  const held = heldWireIds(rp.snapshot);
  const stages = switchableStages({ manifest: rp.manifest, steps: saved.steps, held });
  const models = await listModels(await catalogDirOf(saved.row, projectDirFor));
  const normalized = validateChanges(stages, changes, models);
  for (const nodeId of Object.keys(normalized)) {
    const stage = stages.find((s) => s.nodeId === nodeId);
    if (!stage.switchable) throw lockedStageError(stage);
  }
  const { manifest, changed } = applyModelSwitch(rp.manifest, normalized);
  if (!changed.length) return { ok: true, pipelineId, changed: [], skipped: [], stages, stepper: rp.manifest, warnings: [] };

  const modelChanged = changed.filter((c) => c.before.model !== c.after.model).map((c) => c.nodeId);
  const fresh = [...new Set([...(Array.isArray(rp.freshSessionNodes) ? rp.freshSessionNodes : []), ...modelChanged])];
  const nextRp = {
    ...rp,
    manifest,
    ...(fresh.length ? { freshSessionNodes: fresh } : {}),
    // A NEW token: a paused harness still held in memory now reads its row as handed off
    // (run-harness _rowHandedOff) and can never write the old manifest back.
    pausedBy: `switch:${randomUUID()}`,
  };
  if (!rewritePausedManifest(pipelineId, { stepper: manifest, resumePoint: nextRp, expect: saved.row.resume_point })) {
    throw new ModelSwitchError('CHANGED', 'the run changed meanwhile (resumed, stopped or switched) — reload and try again');
  }
  try { appendAuditById(pipelineId, `Models switched${byActor(by)}: ${changed.map(describeModelChange).join('; ')}.`, { actor: by }); }
  catch { /* the audit is best-effort; the switch landed */ }
  return {
    ok: true, pipelineId, changed, skipped: [],
    stages: switchableStages({ manifest, steps: saved.steps, held }),
    stepper: manifest,
    warnings: modelSwitchWarnings(changed, models),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** How long a mailbox switch waits for the owner's answer (control.mjs's confirm window). */
const confirmMs = () => {
  const n = Number(process.env.WORCA_CONTROL_CONFIRM_MS);
  return Number.isFinite(n) && n > 0 ? n : 10_000;
};

/** The owner's answer (pipeline_commands.result). A refusal is re-thrown as the error it was. */
function liveResult(text) {
  const r = parseJson(text);
  if (r?.ok === true) return { ok: true, changed: r.changed || [], skipped: r.skipped || [], warnings: r.warnings || [] };
  throw new ModelSwitchError(r?.code || 'ERROR', r?.error || 'the run could not switch its models', Number(r?.httpStatus) || 409);
}

/**
 * Ask the process that drives a RUNNING run to switch its models (run-control mailbox, D2/D4) and wait
 * for its answer. Used by the CLI and by the server for runs another process drives.
 * @param {string} pipelineId
 * @param {{changes:object, by?:string, timeoutMs?:number}} opts
 * @returns {Promise<{ok:true, changed:object[], skipped:object[], warnings:string[]}
 *   | {ok:false, outcome:'enqueued'|'received'|'not-applied', runStatus:string, commandId:number}>}
 *   `ok:false` = no answer: 'enqueued' (not claimed yet — may still apply), 'received' (the owner
 *   claimed it but its answer never arrived: it may have applied), or 'not-applied' (never claimed,
 *   and the run left `running` or the command was reaped — an unclaimed command never runs later:
 *   the next owner discards it on (re)start).
 * @throws {ModelSwitchError} a refusal before enqueuing, or the owner's refusal
 */
export async function requestLiveModelSwitch(pipelineId, { changes, by = 'local', timeoutMs = confirmMs() } = {}) {
  assertChanges(changes);
  if (!pipelineId || typeof pipelineId !== 'string') throw new ModelSwitchError('BAD_REQUEST', 'pipelineId is required', 400);
  const db = getDb();
  const row = db.prepare(
    'SELECT id, status, archived_at, owner_pid, owner_host, heartbeat_at, updated_at, started_at FROM pipelines WHERE id = ?',
  ).get(pipelineId);
  if (!row) throw new ModelSwitchError('NOT_FOUND', 'pipeline not found', 404);
  if (row.archived_at) throw new ModelSwitchError('ARCHIVED', 'pipeline is archived');
  if (row.status !== 'running') throw new ModelSwitchError('NOT_RUNNING', `pipeline is "${row.status}" — a live switch needs a running run`);
  if (isDeadOwner(row)) {
    throw new ModelSwitchError('NO_OWNER', `no live owner process for run ${row.id} (pid ${row.owner_pid ?? '—'} on ${row.owner_host ?? '—'})`
      + ` — the stale sweep will mark it interrupted; resume with: worca resume ${row.id}`);
  }
  const { id: commandId } = enqueuePipelineCommand(row.id, 'switch-models', { payload: { changes }, by });
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  let runStatus = row.status;
  let consumed = false;
  let gone = false;
  let grace = false;
  for (;;) {
    const cmd = db.prepare('SELECT consumed_at, result FROM pipeline_commands WHERE id = ?').get(commandId);
    if (cmd?.result != null) return liveResult(cmd.result);
    gone = !cmd;                                          // reaped (control.mjs reaps settled runs' rows)
    if (cmd) consumed = Boolean(cmd.consumed_at);         // keep the last SEEN claim state once it is gone
    runStatus = db.prepare('SELECT status FROM pipelines WHERE id = ?').get(row.id)?.status || runStatus;
    if (gone || Date.now() >= deadline) break;
    if (runStatus !== 'running') { if (grace) break; grace = true; }   // one more look: an answer may be landing
    await sleep(Math.min(250, Math.max(10, deadline - Date.now())));
  }
  // A claimed command may have been applied even when its answer is lost (reaped with a settled run).
  const outcome = consumed ? 'received' : gone || runStatus !== 'running' ? 'not-applied' : 'enqueued';
  return { ok: false, outcome, runStatus, commandId };
}

/**
 * A switch for a run THIS process does not drive (the CLI; the server without a live entry): the
 * row's status at call time picks the path — paused → the store edit, running → the owner's mailbox —
 * so a run resumed since the caller listed it still lands on the right one.
 * @returns {Promise<object>} the path's result plus `mode: 'paused' | 'running'`
 */
export async function switchRunModels(pipelineId, { changes, by = 'local', projectDirFor, timeoutMs } = {}) {
  const status = typeof pipelineId === 'string' && pipelineId
    ? getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(pipelineId)?.status
    : null;
  if (status === 'running') return { mode: 'running', ...(await requestLiveModelSwitch(pipelineId, { changes, by, timeoutMs })) };
  return { mode: 'paused', ...(await switchPausedRunModels(pipelineId, { changes, by, projectDirFor })) };
}
