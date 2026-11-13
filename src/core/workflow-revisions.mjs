// src/core/workflow-revisions.mjs
// Workflow history (#721, workflow part) and named versions (plans/workflow-tests-plan.md Part 1) in ONE append-only
// table. Leaf module: it imports only db.mjs and the fingerprint, so workflows.mjs can call the *Tx helpers inside
// its own transactions (db.tx() is not re-entrant). Rows: version_no NULL = an automatic snapshot (the last
// AUTO_KEEP per workflow), 1,2,… = a named version (never pruned).
import { getDb, prepare } from './db.mjs';
import { workflowFingerprint } from './workflow-fingerprint.mjs';

export const AUTO_KEEP = 50;

const parse = (text, fallback) => { try { const v = JSON.parse(text); return v ?? fallback; } catch { return fallback; } };
const graphOf = (row) => { const g = parse(row && row.graph ? row.graph : '{}', {}); return g && typeof g === 'object' ? g : {}; };

/** D5: a format-2 row that no plugin owns (built-ins are never rows). */
export function isVersionableRow(row) {
  return !!row && row.version === 2 && !(typeof row.origin === 'string' && row.origin.startsWith('plugin:'));
}

const INSERT = `INSERT INTO workflow_revisions
  (workflow_id, version_no, note, name, domain, graph, fingerprint, parts, source, made_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Snapshot the row a write is about to replace. Call INSIDE tx(). @returns {number|null} the revision id */
export function snapshotRowTx(prev, { source = 'save', by = null, now = new Date().toISOString() } = {}) {
  if (!isVersionableRow(prev)) return null;
  const graph = graphOf(prev);
  // An automatic snapshot records the graph shape only: workflowFingerprint(graph, []) with no parts. Never compare it
  // with a named version's fingerprint (graph + parts); compare graphShape() when that is needed (Part 2).
  const info = prepare(INSERT).run(prev.id, null, null, prev.name, prev.domain || null, JSON.stringify(graph),
    workflowFingerprint(graph, []), '[]', source, by, now);
  prepare(`DELETE FROM workflow_revisions WHERE workflow_id = ? AND version_no IS NULL AND id NOT IN (
    SELECT id FROM workflow_revisions WHERE workflow_id = ? AND version_no IS NULL ORDER BY id DESC LIMIT ?)`)
    .run(prev.id, prev.id, AUTO_KEEP);
  return Number(info.lastInsertRowid);
}

/** Keep the row as the next numbered version. Call INSIDE tx(). @returns {number} the new version number */
export function insertVersionTx(row, { note = null, by = null, parts = [], fingerprint, now = new Date().toISOString() }) {
  const last = prepare('SELECT MAX(version_no) AS m FROM workflow_revisions WHERE workflow_id = ?').get(row.id);
  const next = (last && last.m ? Number(last.m) : 0) + 1;
  prepare(INSERT).run(row.id, next, note, row.name, row.domain || null, JSON.stringify(graphOf(row)),
    fingerprint, JSON.stringify(parts), 'version', by, now);
  return next;
}

/** Call INSIDE tx(). */
export function setLiveVersionTx(workflowId, versionNo) {
  prepare('UPDATE workflows SET live_version_no = ? WHERE id = ?').run(versionNo, workflowId);
}

/** @returns {number|null} */
export function liveVersionNo(workflowId) {
  getDb();
  const r = prepare('SELECT live_version_no AS n FROM workflows WHERE id = ?').get(workflowId);
  return r && Number.isInteger(r.n) ? r.n : null;
}

const COLS = 'id, version_no, note, name, domain, source, made_by, created_at, fingerprint';
const entry = (r) => ({ id: Number(r.id), versionNo: r.version_no ?? null, note: r.note ?? null, name: r.name,
  domain: r.domain ?? null, source: r.source, by: r.made_by ?? null, createdAt: r.created_at, fingerprint: r.fingerprint });
const full = (r) => (r ? { ...entry(r), graph: parse(r.graph, {}), parts: parse(r.parts, []) } : null);

/** Newest first. */
export function listRevisions(workflowId) {
  getDb();
  return prepare(`SELECT ${COLS} FROM workflow_revisions WHERE workflow_id = ? ORDER BY id DESC`).all(workflowId).map(entry);
}

export function readRevision(workflowId, id) {
  getDb();
  return full(prepare(`SELECT ${COLS}, graph, parts FROM workflow_revisions WHERE workflow_id = ? AND id = ?`).get(workflowId, Number(id)));
}

export function readVersion(workflowId, versionNo) {
  getDb();
  return full(prepare(`SELECT ${COLS}, graph, parts FROM workflow_revisions WHERE workflow_id = ? AND version_no = ?`).get(workflowId, Number(versionNo)));
}

export function latestVersion(workflowId) {
  getDb();
  return full(prepare(`SELECT ${COLS}, graph, parts FROM workflow_revisions WHERE workflow_id = ? AND version_no IS NOT NULL
    ORDER BY version_no DESC LIMIT 1`).get(workflowId));
}
