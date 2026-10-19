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

function requiredText(v, field, max) {
  const s = typeof v === 'string' ? v.trim() : '';
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
  const t = requiredText(title, 'title', LIMITS.title);
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
