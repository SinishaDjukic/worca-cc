// src/core/model-switch.mjs
// Switch the models of a PAUSED run's remaining stages — ONE implementation behind the run
// detail UI (GET/POST /api/pipelines/:id/models) and `worca switch-model`. A paused run has no
// process driving it, so the switch is a store edit: the frozen manifest (pipelines.stepper AND
// resume_point.manifest — resume reads the latter first) gets the new per-node model, effort and
// sub-agent policy, and a node whose MODEL changed is marked so the resume starts it on a fresh
// Claude session instead of re-attaching the old one. Only stages that have not completed are
// switchable; interrupted, stopped and finished runs are refused (stop-paused.mjs's gate).

import { randomUUID } from 'node:crypto';
import { readPipelineForResume, rewritePausedManifest, appendAuditById } from './artifacts.mjs';
import { listModels } from './config.mjs';
import { EFFORTS, SUBAGENT_MODEL_VALUES, subagentModelIssue } from './model-env.mjs';
import { byActor } from './identity.mjs';

/** The four switchable cell fields ('' = inherit the default). */
export const SWITCH_FIELDS = Object.freeze(['model', 'effort', 'subagentModel', 'subagentEffort']);

export class ModelSwitchError extends Error {
  /**
   * @param {string} code    machine-readable reason (NOT_PAUSED, STAGE_COMPLETED, …)
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

/** Every agent stage of the frozen manifest with its current selection and whether it may switch. */
export function switchableStages(saved) {
  const completed = completedNodeIds(saved?.steps);
  const paused = new Set((saved?.steps || []).filter((s) => s?.status === 'paused' && s.nodeId).map((s) => s.nodeId));
  return (saved?.resumePoint?.manifest?.graph?.nodes || [])
    .filter((n) => n?.kind === 'agent')
    .map((n) => ({
      nodeId: n.id,
      key: n.key || '',
      label: n.label || n.key || n.id,
      ...pick(n),
      fanOut: !!n.fanOut,
      state: completed.has(n.id) ? 'completed' : paused.has(n.id) ? 'paused' : 'pending',
      switchable: !completed.has(n.id),
    }));
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

/** Load + gate: only a paused, unarchived v2 run with an adopted graph. */
function loadPaused(pipelineId) {
  if (!pipelineId || typeof pipelineId !== 'string') throw new ModelSwitchError('BAD_REQUEST', 'pipelineId is required', 400);
  const saved = readPipelineForResume(pipelineId);
  if (!saved) throw new ModelSwitchError('NOT_FOUND', 'pipeline not found', 404);
  const { row, resumePoint: rp } = saved;
  if (row.status !== 'paused') {
    throw new ModelSwitchError('NOT_PAUSED', `pipeline is "${row.status}" — models can be switched only while it is paused`);
  }
  if (row.archived_at) throw new ModelSwitchError('ARCHIVED', 'pipeline is archived');
  if (!rp) throw new ModelSwitchError('NO_RESUME_POINT', 'pipeline has no resume point');
  if (rp.version !== 2) throw new ModelSwitchError('ENGINE_RETIRED', 'this run was made by the retired engine');
  if (!rp.manifest?.graph?.nodes?.length) {
    throw new ModelSwitchError('NO_GRAPH', 'the workflow is still being decided — there are no stages to switch yet');
  }
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
 * What the switch UI / `worca switch-model <id>` show: stages + the run project's catalog.
 * @param {string} pipelineId
 * @param {{projectDirFor?:(key:string)=>Promise<string|null>|string|null}} [opts]
 */
export async function describeModelSwitch(pipelineId, { projectDirFor } = {}) {
  const saved = loadPaused(pipelineId);
  const rp = saved.resumePoint;
  const models = await listModels(await catalogDirOf(saved.row, projectDirFor));
  return {
    pipelineId,
    title: saved.row.title || '',
    pauseReason: typeof rp.pauseReason === 'string' ? rp.pauseReason : null,
    pauseDetail: typeof rp.pauseDetail === 'string' ? rp.pauseDetail : null,
    runDefault: rp.claude?.model || '',
    stages: switchableStages(saved),
    models: models.filter((m) => !m.hidden).map((m) => ({
      id: m.id, label: m.label || m.id, efforts: Array.isArray(m.efforts) ? m.efforts : [],
      ...(m.needsSignIn ? { needsSignIn: true } : {}),
    })),
    efforts: [...EFFORTS],
    subagentModels: [...SUBAGENT_MODEL_VALUES],
  };
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

const describe = (c) => {
  const parts = [];
  if (c.before.model !== c.after.model) parts.push(`${c.before.model || 'default'} → ${c.after.model || 'default'}`);
  if (c.before.effort !== c.after.effort) parts.push(`effort ${c.after.effort || 'default'}`);
  if (c.before.subagentModel !== c.after.subagentModel) parts.push(`sub-agents ${c.after.subagentModel || 'default'}`);
  if (c.before.subagentEffort !== c.after.subagentEffort) parts.push(`sub-agent effort ${c.after.subagentEffort || 'default'}`);
  return `${c.label} ${parts.join(', ')}`;
};

/**
 * Switch a paused run's remaining stages. Throws ModelSwitchError; resolves with what changed.
 * @param {string} pipelineId
 * @param {object} opts
 * @param {Record<string, {model?:string,effort?:string,subagentModel?:string,subagentEffort?:string}>} opts.changes by node id
 * @param {string} [opts.by] identity.mjs actor, named in the audit line
 * @param {(key:string)=>Promise<string|null>|string|null} [opts.projectDirFor]
 */
export async function switchPausedRunModels(pipelineId, { changes, by = 'local', projectDirFor } = {}) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) {
    throw new ModelSwitchError('BAD_REQUEST', 'changes must name at least one stage', 400);
  }
  const saved = loadPaused(pipelineId);
  const stages = new Map(switchableStages(saved).map((s) => [s.nodeId, s]));
  const models = await listModels(await catalogDirOf(saved.row, projectDirFor));
  const normalized = {};
  for (const [nodeId, raw] of Object.entries(changes)) {
    const stage = stages.get(nodeId);
    if (!stage) throw new ModelSwitchError('UNKNOWN_STAGE', `no agent stage "${nodeId}" in this run`, 400);
    if (!stage.switchable) {
      throw new ModelSwitchError('STAGE_COMPLETED', `${stage.label} already completed — only the paused stage and later ones can be switched`);
    }
    const change = normalizeChange(raw, nodeId);
    const issue = stageChangeError(stage, change, models);
    if (issue) throw new ModelSwitchError('INVALID_SELECTION', `${stage.label}: ${issue}`, 400);
    normalized[nodeId] = change;
  }
  const rp = saved.resumePoint;
  const { manifest, changed } = applyModelSwitch(rp.manifest, normalized);
  if (!changed.length) return { ok: true, pipelineId, changed: [], stages: [...stages.values()], stepper: rp.manifest, warnings: [] };

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
  try { appendAuditById(pipelineId, `Models switched${byActor(by)}: ${changed.map(describe).join('; ')}.`, { actor: by }); }
  catch { /* the audit is best-effort; the switch landed */ }
  const warnings = changed
    .filter((c) => c.after.model && models.find((m) => m.id === c.after.model)?.needsSignIn)
    .map((c) => `${c.label}: model "${c.after.model}" needs a sign-in before it can run`);
  return {
    ok: true, pipelineId, changed,
    stages: switchableStages({ ...saved, resumePoint: nextRp }),
    stepper: manifest,
    warnings,
  };
}
