// src/core/requirements/store.mjs
// Requirements storage (plans/requirements-design.md §3): FEAT-<seq> features, their append-only
// interview thread, and the shared context per project or workspace (D10). The only module that
// touches the req_* tables, except the spend ledger (cost-budget.mjs).
import { getDb, prepare } from '../db.mjs';
import {
  RequirementsError, SCOPE_TYPES, STATUSES, TURN_KINDS, LIMITS, emptySpec, featureId,
} from './spec.mjs';

const iso = () => new Date().toISOString();
const json = (t, d) => { try { return t ? JSON.parse(t) : d; } catch { return d; } };

function checkScope(scopeType, scopeKey) {
  if (!SCOPE_TYPES.includes(scopeType)) throw new RequirementsError('BAD_REQUEST', 'scopeType must be "project" or "workspace"');
  if (typeof scopeKey !== 'string' || !scopeKey.trim()) throw new RequirementsError('BAD_REQUEST', 'scopeKey is required');
}

function requiredText(v, field, max, { oneLine = false } = {}) {
  let s = typeof v === 'string' ? v.trim() : '';
  if (oneLine) s = s.replace(/\s+/g, ' ');
  if (!s) throw new RequirementsError('BAD_REQUEST', `${field} is required`);
  if (s.length > max) throw new RequirementsError('BAD_REQUEST', `${field} is longer than ${max} characters`);
  return s;
}

function toFeature(r) {
  if (!r) return null;
  return {
    seq: Number(r.seq), id: featureId(r.seq), scopeType: r.scope_type, scopeKey: r.scope_key,
    epicSeq: r.epic_seq == null ? null : Number(r.epic_seq), title: r.title, description: r.description,
    status: r.status, spec: { ...emptySpec(), ...json(r.spec_json, {}) }, orientation: json(r.orientation_json, null),
    criteriaSeq: Number(r.criteria_seq), assumptionSeq: Number(r.assumption_seq), rounds: Number(r.rounds),
    costUsd: Math.round((Number(r.cost_usd) || 0) * 1e4) / 1e4, savedPath: r.saved_path || null,
    createdBy: r.created_by || null, createdAt: r.created_at, updatedBy: r.updated_by || null, updatedAt: r.updated_at,
  };
}

export function createFeature({ scopeType, scopeKey, title, description } = {}, { by = null } = {}) {
  checkScope(scopeType, scopeKey);
  const t = requiredText(title, 'title', LIMITS.title, { oneLine: true });   // one line: the Markdown heading cannot break
  const d = requiredText(description, 'description', LIMITS.description);
  getDb();
  const ts = iso();
  const r = prepare(`INSERT INTO req_features (scope_type, scope_key, title, description, status, spec_json,
      created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, 'looking', ?, ?, ?, ?, ?)`)
    .run(scopeType, scopeKey.trim(), t, d, JSON.stringify(emptySpec()), by, ts, by, ts);
  return getFeature(Number(r.lastInsertRowid));
}

export function getFeature(seq) {
  getDb();
  return toFeature(prepare('SELECT * FROM req_features WHERE seq = ?').get(Number(seq)));
}

export function requireFeature(seq) {
  const f = getFeature(seq);
  if (!f) throw new RequirementsError('NOT_FOUND', 'feature not found');
  return f;
}

/** Newest first; archived features only with `archived: true`. */
export function listFeatures({ scopeType = null, scopeKey = null, archived = false } = {}) {
  getDb();
  return prepare('SELECT * FROM req_features ORDER BY seq DESC').all().map(toFeature)
    .filter((f) => (archived || f.status !== 'archived')
      && (!scopeType || f.scopeType === scopeType) && (!scopeKey || f.scopeKey === scopeKey));
}

const COLUMNS = Object.freeze({
  title: 'title', description: 'description', scopeType: 'scope_type', scopeKey: 'scope_key', status: 'status',
  spec: 'spec_json', orientation: 'orientation_json', criteriaSeq: 'criteria_seq', assumptionSeq: 'assumption_seq',
  rounds: 'rounds', savedPath: 'saved_path',
});
const JSON_FIELDS = new Set(['spec', 'orientation']);

export function updateFeature(seq, patch = {}, { by = null } = {}) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(patch)) {
    const col = COLUMNS[k];
    if (!col) throw new Error(`updateFeature: unknown field "${k}"`);
    if (k === 'status' && !STATUSES.includes(v)) throw new Error(`updateFeature: unknown status "${v}"`);
    sets.push(`${col} = ?`);
    vals.push(JSON_FIELDS.has(k) ? (v == null ? null : JSON.stringify(v)) : v);
  }
  sets.push('updated_by = ?', 'updated_at = ?');
  vals.push(by, iso());
  getDb();
  prepare(`UPDATE req_features SET ${sets.join(', ')} WHERE seq = ?`).run(...vals, Number(seq));
  return requireFeature(seq);
}

export function addFeatureCost(seq, usd) {
  if (!Number.isFinite(usd) || usd <= 0) return;
  getDb();
  prepare('UPDATE req_features SET cost_usd = cost_usd + ? WHERE seq = ?').run(usd, Number(seq));
}

export function appendTurn(seq, { kind, payload = {}, model = null, costUsd = null } = {}, { by = null } = {}) {
  if (!TURN_KINDS.includes(kind)) throw new Error(`appendTurn: unknown kind "${kind}"`);
  getDb();
  const r = prepare(`INSERT INTO req_turns (feature_seq, kind, payload_json, model, cost_usd, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(Number(seq), kind, JSON.stringify(payload), model, Number.isFinite(costUsd) ? costUsd : null, by, iso());
  return Number(r.lastInsertRowid);
}

export function listTurns(seq) {
  getDb();
  return prepare('SELECT * FROM req_turns WHERE feature_seq = ? ORDER BY id').all(Number(seq)).map((r) => ({
    id: Number(r.id), kind: r.kind, payload: json(r.payload_json, {}), model: r.model || null,
    costUsd: r.cost_usd == null ? null : Number(r.cost_usd), by: r.created_by || null, at: r.created_at,
  }));
}

export function getContext(scopeType, scopeKey) {
  checkScope(scopeType, scopeKey);
  getDb();
  const r = prepare('SELECT * FROM req_contexts WHERE scope_type = ? AND scope_key = ?').get(scopeType, scopeKey);
  return { scopeType, scopeKey, body: r ? r.body : '', lookAtCode: r ? !!r.look_at_code : true,
    updatedBy: r?.updated_by || null, updatedAt: r?.updated_at || null };
}

export function setContext(scopeType, scopeKey, { body, lookAtCode } = {}, { by = null } = {}) {
  const cur = getContext(scopeType, scopeKey);
  const b = body === undefined ? cur.body : String(body ?? '');
  if (b.length > LIMITS.context) throw new RequirementsError('BAD_REQUEST', `the context is longer than ${LIMITS.context} characters`);
  const look = lookAtCode === undefined ? cur.lookAtCode : !!lookAtCode;
  prepare(`INSERT INTO req_contexts (scope_type, scope_key, body, look_at_code, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (scope_type, scope_key) DO UPDATE SET body = excluded.body, look_at_code = excluded.look_at_code,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(scopeType, scopeKey, b, look ? 1 : 0, by, iso());
  return getContext(scopeType, scopeKey);
}

// ---- starts (plans/requirements-a2-design.md §3, D8) ----

function toStart(r) {
  if (!r) return null;
  return {
    id: Number(r.id), featureSeq: Number(r.feature_seq), version: Number(r.version), runId: r.run_id,
    pipelineId: r.pipeline_id || null, spec: { ...emptySpec(), ...json(r.spec_json, {}) }, title: r.title,
    ready: !!r.ready, failing: json(r.failing_json, []), reason: r.reason || null,
    workflowId: r.workflow_id || null, sourceBranch: r.source_branch || null,
    startedBy: r.started_by || null, startedAt: r.started_at,
  };
}

export function createStart({ featureSeq, version, runId, spec, title, ready, failing = [], reason = null,
  workflowId = null, sourceBranch = null } = {}, { by = null } = {}) {
  getDb();
  const r = prepare(`INSERT INTO req_starts (feature_seq, version, run_id, spec_json, title, ready, failing_json,
      reason, workflow_id, source_branch, started_by, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(Number(featureSeq), Number(version), runId, JSON.stringify(spec), title, ready ? 1 : 0,
      JSON.stringify(failing), reason, workflowId, sourceBranch, by, iso());
  return toStart(prepare('SELECT * FROM req_starts WHERE id = ?').get(Number(r.lastInsertRowid)));
}

export function listStarts(seq) {
  getDb();
  return prepare('SELECT * FROM req_starts WHERE feature_seq = ? ORDER BY version DESC').all(Number(seq)).map(toStart);
}

export function latestStart(seq) {
  getDb();
  return toStart(prepare('SELECT * FROM req_starts WHERE feature_seq = ? ORDER BY version DESC LIMIT 1').get(Number(seq)));
}

export function startByRunId(runId) {
  getDb();
  return toStart(prepare('SELECT * FROM req_starts WHERE run_id = ?').get(String(runId)));
}

/** The start a pipeline belongs to: a resumed run gets a new run UUID but keeps its pipeline id. */
export function startByPipelineId(pipelineId) {
  getDb();
  return toStart(prepare('SELECT * FROM req_starts WHERE pipeline_id = ?').get(String(pipelineId)));
}

/** Fill the pipeline id once; true only when this call filled a NULL. */
export function linkPipeline(runId, pipelineId) {
  getDb();
  const r = prepare('UPDATE req_starts SET pipeline_id = ? WHERE run_id = ? AND pipeline_id IS NULL')
    .run(String(pipelineId), String(runId));
  return Number(r.changes) > 0;
}

/** Costs of the newest orientation ("look at the code") turns that cost something, newest first.
 *  With `model`, only the looks made on that model. */
export function recentLookCosts(limit = 10, { model = null } = {}) {
  getDb();
  const sql = `SELECT cost_usd FROM req_turns WHERE kind = 'orientation' AND cost_usd > 0${model ? ' AND model = ?' : ''}
      ORDER BY id DESC LIMIT ?`;
  const args = model ? [String(model), Number(limit)] : [Number(limit)];
  return prepare(sql).all(...args).map((r) => Number(r.cost_usd));
}

// ---- product briefs (plans/requirements-a7-design.md §3) ----

const emptySections = () => ({ product: '', users: [], terms: [], areas: [] });

function toBrief(r) {
  if (!r) return null;
  return {
    id: Number(r.id), scopeType: r.scope_type, scopeKey: r.scope_key, status: r.status,
    sections: { ...emptySections(), ...json(r.sections_json, {}) }, edited: json(r.edited_json, {}),
    sources: json(r.sources_json, []), files: json(r.files_json, []), seed: json(r.seed_json, null),
    model: r.model || null, costUsd: Math.round((Number(r.cost_usd) || 0) * 1e4) / 1e4,
    error: json(r.error_json, null), madeBy: r.made_by || null, madeAt: r.made_at || null,
    createdBy: r.created_by || null, createdAt: r.created_at, updatedBy: r.updated_by || null, updatedAt: r.updated_at,
  };
}

const briefById = (id) => toBrief(prepare('SELECT * FROM req_briefs WHERE id = ?').get(Number(id)));

export function getBrief(scopeType, scopeKey) {
  checkScope(scopeType, scopeKey);
  getDb();
  return toBrief(prepare('SELECT * FROM req_briefs WHERE scope_type = ? AND scope_key = ?').get(scopeType, scopeKey));
}

/** The brief once it has been made (also while it is being refreshed), else null. */
export function usableBrief(scopeType, scopeKey) {
  const b = getBrief(scopeType, scopeKey);
  return b && b.madeAt ? b : null;
}

export function listBriefs() {
  getDb();
  return prepare('SELECT scope_type, scope_key, status, made_at FROM req_briefs ORDER BY id').all()
    .map((r) => ({ scopeType: r.scope_type, scopeKey: r.scope_key, status: r.status, madeAt: r.made_at || null }));
}

export function listMakingBriefs() {
  getDb();
  return prepare("SELECT * FROM req_briefs WHERE status = 'making' ORDER BY id").all().map(toBrief);
}

/** Upsert into `making`; BUSY when the brief is already being made (checked and set in one UPDATE). */
export function beginBrief(scopeType, scopeKey, { by = null } = {}) {
  checkScope(scopeType, scopeKey);
  getDb();
  const key = scopeKey.trim();
  const ts = iso();
  prepare(`INSERT OR IGNORE INTO req_briefs (scope_type, scope_key, status, created_by, created_at, updated_by, updated_at)
      VALUES (?, ?, 'empty', ?, ?, ?, ?)`).run(scopeType, key, by, ts, by, ts);
  const r = prepare(`UPDATE req_briefs SET status = 'making', error_json = NULL, updated_by = ?, updated_at = ?
      WHERE scope_type = ? AND scope_key = ? AND status != 'making'`).run(by, ts, scopeType, key);
  if (!Number(r.changes)) throw new RequirementsError('BUSY', 'Worca is already making this brief.');
  return getBrief(scopeType, key);
}

export function saveBriefResult(id, { sections, edited, sources, files, seed, model } = {}, { by = null } = {}) {
  getDb();
  const ts = iso();
  prepare(`UPDATE req_briefs SET status = 'ready', sections_json = ?, edited_json = ?, sources_json = ?, files_json = ?,
      seed_json = ?, model = ?, error_json = NULL, made_by = ?, made_at = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(sections || emptySections()), JSON.stringify(edited || {}), JSON.stringify(sources || []),
      JSON.stringify(files || []), seed ? JSON.stringify(seed) : null, model || null, by, ts, by, ts, Number(id));
  return briefById(id);
}

export function failBrief(id, { code, message } = {}) {
  getDb();
  const ts = iso();
  prepare(`UPDATE req_briefs SET error_json = ?, status = CASE WHEN made_at IS NOT NULL THEN 'ready' ELSE 'empty' END,
      updated_at = ? WHERE id = ?`).run(JSON.stringify({ code, message, at: ts }), ts, Number(id));
  return briefById(id);
}

/** The owner's edits; never touches status or sources. */
export function setBriefSections(id, { sections, edited } = {}, { by = null } = {}) {
  getDb();
  prepare('UPDATE req_briefs SET sections_json = ?, edited_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(sections || emptySections()), JSON.stringify(edited || {}), by, iso(), Number(id));
  return briefById(id);
}

export function addBriefCost(id, usd) {
  if (!Number.isFinite(usd) || usd <= 0) return;
  getDb();
  prepare('UPDATE req_briefs SET cost_usd = cost_usd + ? WHERE id = ?').run(usd, Number(id));
}

export function deleteBrief(scopeType, scopeKey) {
  checkScope(scopeType, scopeKey);
  getDb();
  return Number(prepare('DELETE FROM req_briefs WHERE scope_type = ? AND scope_key = ?').run(scopeType, scopeKey).changes) > 0;
}

/** Features of the scope (not archived) with a round that names the scope's current brief id. */
export function briefUsers(scopeType, scopeKey) {
  const b = getBrief(scopeType, scopeKey);
  if (!b) return [];
  return prepare(`SELECT f.seq FROM req_features f WHERE f.scope_type = ? AND f.scope_key = ? AND f.status != 'archived'
      AND EXISTS (SELECT 1 FROM req_turns t WHERE t.feature_seq = f.seq AND t.kind = 'round'
        AND json_extract(t.payload_json, '$.brief.id') = ?) ORDER BY f.seq`)
    .all(scopeType, scopeKey, b.id).map((r) => ({ seq: Number(r.seq), id: featureId(r.seq) }));
}

/** Costs of the newest brief looks (ledger rows with a brief_id), newest first. */
export function recentBriefCosts(limit = 10) {
  getDb();
  return prepare('SELECT amount_usd FROM req_cost_ledger WHERE brief_id IS NOT NULL ORDER BY id DESC LIMIT ?')
    .all(Number(limit)).map((r) => Number(r.amount_usd));
}
