// src/core/run-tags-store.mjs — run tags in SQLite (#718). Creation writes once (insertRunTags);
// a human edit replaces the set and records before/after (editRunTags). Reads are batched for lists.
import { getDb, tx } from './db.mjs';
import { normaliseTags, parseTag, formatTag, MAX_TAGS } from '../shared/run-tags.mjs';

const same = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);

export function readRunTags(pipelineId) {
  return getDb().prepare('SELECT key, value FROM run_tags WHERE pipeline_id = ? ORDER BY key')
    .all(pipelineId).map(formatTag);
}

/** pipeline id → string[] for many runs (lists): one query per 500 ids, never a JOIN. */
export function readTagsFor(ids) {
  const out = new Map();
  const list = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const rows = getDb().prepare(
      `SELECT pipeline_id, key, value FROM run_tags WHERE pipeline_id IN (${chunk.map(() => '?').join(',')}) ORDER BY pipeline_id, key`,
    ).all(...chunk);
    for (const r of rows) {
      if (!out.has(r.pipeline_id)) out.set(r.pipeline_id, []);
      out.get(r.pipeline_id).push(formatTag(r));
    }
  }
  return out;
}

function writeRows(pipelineId, tags) {
  const db = getDb();
  db.prepare('DELETE FROM run_tags WHERE pipeline_id = ?').run(pipelineId);
  const ins = db.prepare('INSERT INTO run_tags (pipeline_id, key, value) VALUES (?, ?, ?)');
  for (const t of tags) { const { tag } = parseTag(t); ins.run(pipelineId, tag.key, tag.value); }
}

/** Creation-time write (createPipeline, outside writeState's tx). Internal callers pass validated
 *  lists; anything invalid is dropped and the list is capped at MAX_TAGS, so this never throws. */
export function insertRunTags(pipelineId, tags) {
  const clean = normaliseTags(Array.isArray(tags) ? tags.filter((t) => !parseTag(t).error) : []).tags.slice(0, MAX_TAGS);
  if (clean.length) tx(() => writeRows(pipelineId, clean));
  return clean;
}

/** A human edit. New tags must be key:value; one already on the run passes as stored. Throws { code: 'BAD_TAGS' }. A no-op writes nothing. */
export function editRunTags(pipelineId, input, { actor = null, now = new Date() } = {}) {
  const { tags, errors } = normaliseTags(input, { strict: true, keep: readRunTags(pipelineId) });
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { code: 'BAD_TAGS' });
  let before = [];
  let changed = false;
  tx(() => {
    before = readRunTags(pipelineId);
    if (same(before, tags)) return;
    writeRows(pipelineId, tags);
    getDb().prepare('INSERT INTO run_tag_events (pipeline_id, ts, actor, before_tags, after_tags) VALUES (?, ?, ?, ?, ?)')
      .run(pipelineId, now.toISOString(), actor, JSON.stringify(before), JSON.stringify(tags));
    changed = true;
  });
  return { tags, before, changed };
}

export function readTagEvents(pipelineId) {
  return getDb().prepare('SELECT ts, actor, before_tags, after_tags FROM run_tag_events WHERE pipeline_id = ? ORDER BY id')
    .all(pipelineId)
    .map((r) => ({ ts: r.ts, actor: r.actor, before: JSON.parse(r.before_tags), after: JSON.parse(r.after_tags) }));
}

/**
 * Keys and values in use on active runs, most used first: { keys: [{key, count, plain, valued}], values: { key: [{value, count, lastAt}] } }.
 * s2 (D5): `projectKey` scopes it to that project's runs; `lastAt` is each value's newest start.
 */
export function tagVocabulary({ projectKey = null } = {}) {
  const rows = getDb().prepare(`
    SELECT t.key, t.value, COUNT(*) AS n, MAX(p.started_at) AS last_at FROM run_tags t JOIN pipelines p ON p.id = t.pipeline_id
    WHERE p.archived_at IS NULL${projectKey ? ' AND p.project_key = ?' : ''}
    GROUP BY t.key, t.value ORDER BY n DESC, t.key, t.value`).all(...(projectKey ? [projectKey] : []));
  const keys = new Map();
  const values = {};
  for (const r of rows) {
    const k = keys.get(r.key) || { key: r.key, count: 0, plain: false, valued: false };
    k.count += r.n;
    if (r.value) { k.valued = true; (values[r.key] ||= []).push({ value: r.value, count: r.n, lastAt: r.last_at || null }); } else k.plain = true;
    keys.set(r.key, k);
  }
  return { keys: [...keys.values()].sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1)), values };
}

/** Pre-fill source (D5): this person's newest pipeline in the project that has tags → its tags; [] without one. */
export function lastUsedTags(projectKey, person) {
  if (!projectKey || !person) return [];
  const row = getDb().prepare(`
    SELECT p.id FROM pipelines p
    WHERE p.project_key = ? AND p.started_by = ?
      AND EXISTS (SELECT 1 FROM run_tags t WHERE t.pipeline_id = p.id)
    ORDER BY p.started_at DESC LIMIT 1`).get(projectKey, person);
  return row ? readRunTags(row.id) : [];
}
