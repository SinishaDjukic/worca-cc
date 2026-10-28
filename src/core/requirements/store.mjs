// src/core/requirements/store.mjs
// Requirements storage (plans/requirements-design.md §3): FEAT-<seq> features, their append-only
// interview thread, and the shared context per project or workspace (D10). The only module that
// touches the req_* tables, except the spend ledger (cost-budget.mjs).
import { randomBytes } from 'node:crypto';
import { getDb, prepare, tx } from '../db.mjs';
import { REQ_ATT_ID_RE } from './attachments.mjs';
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
  if (b.length > LIMITS.context) throw new RequirementsError('BAD_REQUEST', `Your notes are longer than ${LIMITS.context} characters.`);
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
    startedBy: r.started_by || null, startedAt: r.started_at, files: json(r.files_json, []),
  };
}

export function createStart({ featureSeq, version, runId, spec, title, ready, failing = [], reason = null,
  workflowId = null, sourceBranch = null, files = [] } = {}, { by = null } = {}) {
  getDb();
  const r = prepare(`INSERT INTO req_starts (feature_seq, version, run_id, spec_json, title, ready, failing_json,
      reason, workflow_id, source_branch, started_by, started_at, files_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(Number(featureSeq), Number(version), runId, JSON.stringify(spec), title, ready ? 1 : 0,
      JSON.stringify(failing), reason, workflowId, sourceBranch, by, iso(), JSON.stringify(files || []));
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
  return toBrief(prepare('SELECT * FROM req_briefs WHERE scope_type = ? AND scope_key = ?').get(scopeType, scopeKey.trim()));
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
  const b = getBrief(scopeType, scopeKey);
  if (!b) return false;
  // A8 D9: its documents' rows go in the same transaction; the caller removes their bodies (rows first, then bodies).
  return tx(() => {
    prepare("DELETE FROM req_attachments WHERE owner_type = 'brief' AND owner_id = ?").run(b.id);
    return Number(prepare('DELETE FROM req_briefs WHERE id = ?').run(b.id).changes) > 0;
  });
}

/** Features of the scope (not archived) with a round that names the scope's current brief id. */
export function briefUsers(scopeType, scopeKey) {
  const b = getBrief(scopeType, scopeKey);
  if (!b) return [];
  return prepare(`SELECT f.seq FROM req_features f WHERE f.scope_type = ? AND f.scope_key = ? AND f.status != 'archived'
      AND EXISTS (SELECT 1 FROM req_turns t WHERE t.feature_seq = f.seq AND t.kind = 'round'
        AND json_extract(t.payload_json, '$.brief.id') = ?) ORDER BY f.seq`)
    .all(scopeType, b.scopeKey, b.id).map((r) => ({ seq: Number(r.seq), id: featureId(r.seq) }));
}

/** Costs of the newest brief looks (ledger rows with a brief_id), newest first. */
export function recentBriefCosts(limit = 10) {
  getDb();
  // a document's read is not a look (A8 D5)
  return prepare('SELECT amount_usd FROM req_cost_ledger WHERE brief_id IS NOT NULL AND attachment_id IS NULL ORDER BY id DESC LIMIT ?')
    .all(Number(limit)).map((r) => Number(r.amount_usd));
}

// ---- attachments (plans/requirements-a8-design.md §3, D9): a feature's files and a made brief's documents ----

const OWNER_TYPES = Object.freeze(['feature', 'brief']);
const ATT_STATUSES = Object.freeze(['reading', 'done', 'failed', 'unread-budget']);

/** The id a body and its row are named by: the only part of a body's path that is not the store's own. */
export const mintAttachmentId = () => `ratt_${randomBytes(6).toString('hex')}`;

function toAttachment(r) {
  if (!r) return null;
  return {
    id: r.id, ownerType: r.owner_type, ownerId: Number(r.owner_id), name: r.name, kind: r.kind, mime: r.mime, bytes: Number(r.bytes),
    sha256: r.sha256, status: r.status, error: json(r.error_json, null), summary: r.summary || '', summaryEdited: !!r.summary_edited,
    asks: json(r.asks_json, []), history: json(r.history_json, []), sendWithRun: !!r.send_with_run,
    costUsd: Math.round((Number(r.cost_usd) || 0) * 1e4) / 1e4, readCostUsd: r.read_cost_usd == null ? null : Number(r.read_cost_usd),
    readModel: r.read_model || null, readAt: r.read_at || null,
    createdBy: r.created_by || null, createdAt: r.created_at, updatedBy: r.updated_by || null, updatedAt: r.updated_at,
  };
}

export function insertAttachment({ id, ownerType, ownerId, name, kind, mime, bytes, sha256, status = 'reading' } = {}, { by = null } = {}) {
  if (typeof id !== 'string' || !REQ_ATT_ID_RE.test(id)) throw new Error('insertAttachment: refusing an id the store never minted');
  if (!OWNER_TYPES.includes(ownerType)) throw new Error(`insertAttachment: unknown owner type "${ownerType}"`);
  if (!ATT_STATUSES.includes(status)) throw new Error(`insertAttachment: unknown status "${status}"`);
  getDb();
  const ts = iso();
  prepare(`INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status, created_by, created_at,
      updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, ownerType, Number(ownerId), name, kind, mime, Number(bytes), sha256, status, by, ts, by, ts);
  return getAttachment(id);
}

export function getAttachment(id) {
  getDb();
  return toAttachment(prepare('SELECT * FROM req_attachments WHERE id = ?').get(String(id)));
}

/** An owner's files in upload order. */
export function listAttachments(ownerType, ownerId) {
  getDb();
  return prepare('SELECT * FROM req_attachments WHERE owner_type = ? AND owner_id = ? ORDER BY rowid').all(ownerType, Number(ownerId)).map(toAttachment);
}

const ATT_COLUMNS = Object.freeze({
  name: 'name', kind: 'kind', mime: 'mime', bytes: 'bytes', sha256: 'sha256', status: 'status', error: 'error_json', summary: 'summary',
  summaryEdited: 'summary_edited', asks: 'asks_json', history: 'history_json', sendWithRun: 'send_with_run',
  readCostUsd: 'read_cost_usd', readModel: 'read_model', readAt: 'read_at',
});
const ATT_JSON = new Set(['error', 'asks', 'history']);
const ATT_BOOL = new Set(['summaryEdited', 'sendWithRun']);

export function updateAttachment(id, patch = {}, { by = null } = {}) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(patch)) {
    const col = ATT_COLUMNS[k];
    if (!col) throw new Error(`updateAttachment: unknown field "${k}"`);
    if (k === 'status' && !ATT_STATUSES.includes(v)) throw new Error(`updateAttachment: unknown status "${v}"`);
    sets.push(`${col} = ?`);
    vals.push(ATT_JSON.has(k) ? (v == null ? (k === 'error' ? null : '[]') : JSON.stringify(v)) : ATT_BOOL.has(k) ? (v ? 1 : 0) : v);
  }
  sets.push('updated_by = ?', 'updated_at = ?');
  vals.push(by, iso());
  getDb();
  prepare(`UPDATE req_attachments SET ${sets.join(', ')} WHERE id = ?`).run(...vals, String(id));
  return getAttachment(id);
}

export function addAttachmentCost(id, usd) {
  if (!Number.isFinite(usd) || usd <= 0) return;
  getDb();
  prepare('UPDATE req_attachments SET cost_usd = cost_usd + ? WHERE id = ?').run(usd, String(id));
}

export function deleteAttachmentRow(id) {
  getDb();
  return Number(prepare('DELETE FROM req_attachments WHERE id = ?').run(String(id)).changes) > 0;
}

/** Deletes an owner's rows and returns them (the caller removes their bodies: row first, then body, D9). */
export function deleteOwnerAttachments(ownerType, ownerId) {
  const rows = listAttachments(ownerType, ownerId);
  prepare('DELETE FROM req_attachments WHERE owner_type = ? AND owner_id = ?').run(ownerType, Number(ownerId));
  return rows;
}

export function listReadingAttachments() {
  getDb();
  return prepare("SELECT * FROM req_attachments WHERE status = 'reading' ORDER BY rowid").all().map(toAttachment);
}

/** The last reads' costs of one kind, newest finished first (the estimates, D5 / §5). */
export function recentReadCosts(kind, limit = 10) {
  getDb();
  return prepare('SELECT read_cost_usd FROM req_attachments WHERE kind = ? AND read_cost_usd IS NOT NULL ORDER BY read_at DESC LIMIT ?')
    .all(String(kind), Number(limit)).map((r) => Number(r.read_cost_usd));
}

export function getBriefById(id) {
  getDb();
  return briefById(id);
}

// ---- the helper chat (plans/requirements-a3-design.md §3, D14): one Feature chat per feature ----

const HELPER_ROLES = Object.freeze(['po', 'worca']);

function toHelperMessage(r) {
  if (!r) return null;
  return {
    id: Number(r.id), featureSeq: Number(r.feature_seq), role: r.role, text: r.text || '', focus: json(r.focus_json, null),
    roundTurnId: r.round_turn_id == null ? null : Number(r.round_turn_id), drafts: json(r.drafts_json, []), proposals: json(r.proposals_json, []),
    error: json(r.error_json, null), costUsd: r.cost_usd == null ? null : Math.round(Number(r.cost_usd) * 1e4) / 1e4, model: r.model || null,
    createdBy: r.created_by || null, createdAt: r.created_at, updatedBy: r.updated_by || null, updatedAt: r.updated_at,
  };
}

export function insertHelperMessage({ featureSeq, role, text = '', focus = null, roundTurnId = null, drafts = [], proposals = [], error = null,
  costUsd = null, model = null } = {}, { by = null } = {}) {
  if (!HELPER_ROLES.includes(role)) throw new Error(`insertHelperMessage: unknown role "${role}"`);
  getDb();
  const ts = iso();
  const r = prepare(`INSERT INTO req_helper_messages (feature_seq, role, text, focus_json, round_turn_id, drafts_json, proposals_json, error_json,
      cost_usd, model, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(Number(featureSeq), role, String(text ?? ''), focus ? JSON.stringify(focus) : null, roundTurnId == null ? null : Number(roundTurnId),
      JSON.stringify(drafts || []), JSON.stringify(proposals || []), error ? JSON.stringify(error) : null,
      Number.isFinite(costUsd) ? costUsd : null, model || null, by, ts, by, ts);
  return getHelperMessage(Number(r.lastInsertRowid));
}

export function getHelperMessage(id) {
  getDb();
  return toHelperMessage(prepare('SELECT * FROM req_helper_messages WHERE id = ?').get(Number(id)));
}

/** A feature's chat, oldest first. */
export function listHelperMessages(seq) {
  getDb();
  return prepare('SELECT * FROM req_helper_messages WHERE feature_seq = ? ORDER BY id').all(Number(seq)).map(toHelperMessage);
}

/** How many messages a feature's chat holds (the feature view's `helper.messages`), without reading the rows. */
export function countHelperMessages(seq) {
  getDb();
  return Number(prepare('SELECT count(*) AS n FROM req_helper_messages WHERE feature_seq = ?').get(Number(seq)).n);
}

const HELPER_COLUMNS = Object.freeze({ text: 'text', drafts: 'drafts_json', proposals: 'proposals_json', error: 'error_json', costUsd: 'cost_usd', model: 'model' });
const HELPER_JSON = new Set(['drafts', 'proposals', 'error']);

export function updateHelperMessage(id, patch = {}, { by = null } = {}) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(patch)) {
    const col = HELPER_COLUMNS[k];
    if (!col) throw new Error(`updateHelperMessage: unknown field "${k}"`);
    sets.push(`${col} = ?`);
    vals.push(HELPER_JSON.has(k) ? (v == null ? (k === 'error' ? null : '[]') : JSON.stringify(v)) : k === 'costUsd' ? (Number.isFinite(v) ? v : null) : v);
  }
  sets.push('updated_by = ?', 'updated_at = ?');
  vals.push(by, iso());
  getDb();
  prepare(`UPDATE req_helper_messages SET ${sets.join(', ')} WHERE id = ?`).run(...vals, Number(id));
  return getHelperMessage(id);
}

/** Clear chat (D14): the feature's rows go; the ledger keeps what the chat cost, and accepted changes stay in the spec. */
export function deleteHelperMessages(seq) {
  getDb();
  return Number(prepare('DELETE FROM req_helper_messages WHERE feature_seq = ?').run(Number(seq)).changes);
}

/** The amounts of the newest helper calls (ledger rows with a helper_message_id), newest first: the composer's estimate (D13). */
export function recentHelperCosts(limit = 10) {
  getDb();
  return prepare('SELECT amount_usd FROM req_cost_ledger WHERE helper_message_id IS NOT NULL ORDER BY id DESC LIMIT ?')
    .all(Number(limit)).map((r) => Number(r.amount_usd));
}
