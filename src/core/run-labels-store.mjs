// src/core/run-labels-store.mjs — run labels (slice 1): read, replace, bulk add/remove, vocabulary.
// Mirrors run-tags-store.mjs; no events table and no audit line (labels organise, they are not records).
import { getDb, tx } from './db.mjs';
import { normaliseLabels, normaliseLabel, MAX_LABELS } from '../shared/run-labels.mjs';

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

/** s2: creation-time write, like insertRunTags: never throws, drops invalid entries. → the stored list. */
export function insertRunLabels(pipelineId, labels, { now = new Date() } = {}) {
  const list = Array.isArray(labels) ? labels.filter((l) => !normaliseLabels([l]).errors.length) : [];
  const clean = normaliseLabels(list).labels.slice(0, MAX_LABELS);
  if (clean.length) tx(() => writeLabels(pipelineId, [], clean, now.toISOString()));
  return clean;
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

// s2: Settings › Labels — rename, merge or delete a label on every run.
const oneLabel = (raw) => { const r = normaliseLabel(raw); if (r.error) throw badLabels([r.error]); return r.label; };
const idsWith = (label) => getDb().prepare('SELECT pipeline_id FROM run_labels WHERE label = ?').all(label).map((r) => r.pipeline_id);

/**
 * Rename a label on every run, archived ones too, in one tx. Onto a label that exists it merges: a run that has both
 * keeps only `to` (with its own added_at), so no run gains a row. → { from, label, ids, merged }; ids = the runs that
 * changed ([] when `from` is on no run, or when both names normalise to the same label). Throws BAD_LABELS on a bad name.
 */
export function renameLabel(from, to) {
  const f = oneLabel(from);
  const t = oneLabel(to);
  if (f === t) return { from: f, label: t, ids: [], merged: false };
  const db = getDb();
  let ids = [];
  let merged = false;
  tx(() => {
    ids = idsWith(f);
    if (!ids.length) return;
    merged = !!db.prepare('SELECT 1 FROM run_labels WHERE label = ? LIMIT 1').get(t);
    db.prepare('DELETE FROM run_labels WHERE label = ? AND pipeline_id IN (SELECT pipeline_id FROM run_labels WHERE label = ?)').run(f, t);
    db.prepare('UPDATE run_labels SET label = ? WHERE label = ?').run(t, f);
  });
  return { from: f, label: t, ids, merged };
}

/** Remove a label from every run, archived ones too, in one tx. → { label, ids }; ids = [] when no run had it. */
export function deleteLabel(label) {
  const l = oneLabel(label);
  let ids = [];
  tx(() => {
    ids = idsWith(l);
    if (ids.length) getDb().prepare('DELETE FROM run_labels WHERE label = ?').run(l);
  });
  return { label: l, ids };
}
