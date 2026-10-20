// src/core/run-labels-store.mjs — run labels (slice 1): read, replace, bulk add/remove, vocabulary.
// Mirrors run-tags-store.mjs; no events table and no audit line (labels organise, they are not records).
import { getDb, tx } from './db.mjs';
import { normaliseLabels } from '../shared/run-labels.mjs';

const badLabels = (errors) => Object.assign(new Error(errors[0]), { code: 'BAD_LABELS' });

/** A run's labels in the order they were added. */
export function readRunLabels(pipelineId) {
  return getDb().prepare('SELECT label FROM run_labels WHERE pipeline_id = ? ORDER BY added_at, rowid').all(pipelineId).map((r) => r.label);
}

/** Bulk read for lists: Map(id → labels). An id without labels is absent. One IN query per 500 ids, never a JOIN. */
export function readLabelsFor(ids) {
  const out = new Map();
  const list = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const rows = getDb().prepare(
      `SELECT pipeline_id, label FROM run_labels WHERE pipeline_id IN (${chunk.map(() => '?').join(',')}) ORDER BY pipeline_id, added_at, rowid`,
    ).all(...chunk);
    for (const r of rows) (out.get(r.pipeline_id) || out.set(r.pipeline_id, []).get(r.pipeline_id)).push(r.label);
  }
  return out;
}

// Inside a tx: a kept label keeps its added_at (so its place in the row), a new one gets `ts`.
function writeLabels(pipelineId, before, next, ts) {
  const db = getDb();
  const del = db.prepare('DELETE FROM run_labels WHERE pipeline_id = ? AND label = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO run_labels (pipeline_id, label, added_at) VALUES (?, ?, ?)');
  for (const l of before) if (!next.includes(l)) del.run(pipelineId, l);
  for (const l of next) if (!before.includes(l)) ins.run(pipelineId, l, ts);
}

const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** Replace a run's set. Throws { code: 'BAD_LABELS' } on any invalid entry. A no-op writes nothing. */
export function editRunLabels(pipelineId, input, { now = new Date() } = {}) {
  const n = normaliseLabels(input);
  if (n.errors.length) throw badLabels(n.errors);
  const before = readRunLabels(pipelineId);
  if (same(before, n.labels)) return { labels: before, before, changed: false };
  tx(() => writeLabels(pipelineId, before, n.labels, now.toISOString()));
  return { labels: readRunLabels(pipelineId), before, changed: true };
}

/**
 * Add and/or remove labels on many runs at once (the selection bar). ids: pipeline ids that exist (the route checks).
 * → [{ id, labels, changed }]. Throws BAD_LABELS when add/remove hold an invalid label, or a run would pass MAX_LABELS.
 */
export function changeLabels(ids, { add = [], remove = [] } = {}, { now = new Date() } = {}) {
  const a = normaliseLabels(add);
  const r = normaliseLabels(remove);
  const errors = [...a.errors, ...r.errors];
  if (errors.length) throw badLabels(errors);
  const ts = now.toISOString();
  const current = readLabelsFor(ids);
  const plan = ids.map((id) => {
    const before = current.get(id) || [];
    const gone = new Set(r.labels);
    const next = [...before.filter((l) => !gone.has(l)), ...a.labels.filter((l) => !before.includes(l) && !gone.has(l))];
    return { id, before, next };
  });
  const over = plan.find((p) => normaliseLabels(p.next).errors.length);
  if (over) throw badLabels(normaliseLabels(over.next).errors);
  tx(() => { for (const p of plan) if (!same(p.before, p.next)) writeLabels(p.id, p.before, p.next, ts); });
  const after = readLabelsFor(ids);
  return plan.map((p) => ({ id: p.id, labels: after.get(p.id) || [], changed: !same(p.before, p.next) }));
}

/** Labels in use on non-archived runs: [{ label, count }], most used, then most recently added, then A–Z. */
export function labelVocabulary() {
  return getDb().prepare(`
    SELECT l.label, COUNT(*) AS count, MAX(l.added_at) AS last FROM run_labels l JOIN pipelines p ON p.id = l.pipeline_id
    WHERE p.archived_at IS NULL GROUP BY l.label ORDER BY count DESC, last DESC, l.label`).all()
    .map((r) => ({ label: r.label, count: r.count }));
}
