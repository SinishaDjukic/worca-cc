// src/core/diff-comments.mjs
// Internal, line-anchored comments on a run's persisted diff (diff_comments, v21).
// The ONE mutation module: the REST routes in ui/server.mjs and the Ask MCP tools
// (through src/core/ask/comment-deps.mjs) both write through here, so anchor
// validation, the protected-path floor, the body cap and the change notification
// can never drift apart. Synchronous DB via getDb()/prepare() — the
// src/core/ask/store.mjs conventions; ids are shape-checked before use.
//
// NOTE on the notification: listeners are PROCESS-LOCAL. ui/server.mjs subscribes
// at boot and turns each poke into a `diff-comments-changed` broadcast. The MCP
// stdio server is a separate OS process with its own module instance, so its writes
// fire only its own (empty) listener set — those reach the UI through the reducer
// hook in ask/events.mjs instead.
import { randomBytes } from 'node:crypto';
import { getDb, prepare, tx } from './db.mjs';
import { resolveAnchor, AnchorError } from './diff-anchor.mjs';

export const DC_ID_RE = /^dc_[0-9a-f]{8}$/;
export const COMMENT_BODY_MAX = 4000;
export const COMMENT_AUTHORS = Object.freeze(['user', 'ask']);

const newCommentId = () => `dc_${randomBytes(4).toString('hex')}`;
const now = () => new Date().toISOString();

/** A refusal the caller returns verbatim (HTTP 400/409, AskToolError text). */
export class DiffCommentError extends Error {
  constructor(message) { super(message); this.name = 'DiffCommentError'; }
}

function rowToComment(r) {
  return {
    id: r.id, storeKey: r.store_key, pipelineId: r.pipeline_id,
    projectKey: r.project_key ?? null, path: r.path, oldPath: r.old_path ?? null,
    side: r.side, line: r.line_no, lineText: r.line_text ?? '',
    body: r.body, author: r.author,
    resolved: !!r.resolved, resolvedAt: r.resolved_at ?? null,
    sentRunId: r.sent_run_id ?? null, createdAt: r.created_at,
  };
}

// ── change notification ─────────────────────────────────────────────────────
const listeners = new Set();

/** Subscribe to "this run's comments changed". Returns an unsubscribe function. */
export function onDiffCommentsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** ids only, no payload: idempotent for the receiver, no ordering concerns. */
function notify(storeKey, pipelineId) {
  for (const fn of listeners) {
    try { fn({ storeKey, pipelineId }); } catch { /* a broken sink never breaks a write */ }
  }
}

// ── reads ───────────────────────────────────────────────────────────────────

/** One comment by id, or null. Shape-checks the id: it reaches a SQL parameter only. */
export function getDiffComment(id) {
  if (typeof id !== 'string' || !DC_ID_RE.test(id)) return null;
  getDb();
  const r = prepare('SELECT * FROM diff_comments WHERE id = ?').get(id);
  return r ? rowToComment(r) : null;
}

/**
 * A run's comments, ordered by path, then line, then CREATION ORDER (the brief:
 * multiple comments on one line stack in creation order).
 *
 * The final key is `rowid`, NOT `created_at, id`: created_at is millisecond ISO
 * text, so two comments written in the same tick tie, and `id` is random hex — the
 * pair would order those two randomly. rowid is SQLite's monotonic insertion
 * counter and the table is not WITHOUT ROWID (D17).
 *
 * The SQL is assembled from a CLOSED set of fragments (3 statuses x 2 path
 * options = 6 texts), so the prepare() cache stays bounded; no caller value is ever
 * interpolated.
 * @param {{status?: 'all'|'unresolved'|'resolved', path?: string|null}} [opts]
 */
export function listDiffComments(storeKey, pipelineId, { status = 'all', path = null } = {}) {
  getDb();
  const where = ['store_key = ?', 'pipeline_id = ?'];
  const vals = [String(storeKey ?? ''), String(pipelineId ?? '')];
  if (status === 'unresolved') where.push('resolved = 0');
  else if (status === 'resolved') where.push('resolved = 1');
  if (path) { where.push('path = ?'); vals.push(String(path)); }
  return prepare(`SELECT * FROM diff_comments WHERE ${where.join(' AND ')}
                  ORDER BY path, line_no, rowid`).all(...vals).map(rowToComment);
}

/** { "<storeKey>/<pipelineId>": <unresolved count> } for every run that has any. */
export function unresolvedCounts() {
  getDb();
  const out = {};
  for (const r of prepare(`SELECT store_key, pipeline_id, count(*) AS n FROM diff_comments
                           WHERE resolved = 0 GROUP BY store_key, pipeline_id`).all()) {
    out[`${r.store_key}/${r.pipeline_id}`] = r.n;
  }
  return out;
}

// ── writes ──────────────────────────────────────────────────────────────────

/**
 * Create one comment. `patchText` is the run's diff-patch.patch as READ BY THE
 * CALLER (the server through readRunArtifactText, the MCP bundle through
 * deps.readDiffPatch) — the anchor, and the line_text snapshot, come from it and
 * never from the caller's input.
 * @throws {DiffCommentError} — including for an AnchorError, re-wrapped so callers
 *   have one error type to map onto 400 / tool-error.
 */
export function addDiffComment({
  storeKey, pipelineId, patchText, project = null, path, side, line, body, author,
} = {}) {
  if (patchText == null || String(patchText) === '') {
    throw new DiffCommentError('this run has no stored diff — comments cannot be created on it');
  }
  if (!COMMENT_AUTHORS.includes(author)) throw new DiffCommentError('author must be "user" or "ask"');
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw new DiffCommentError('body is required');
  if (text.length > COMMENT_BODY_MAX) throw new DiffCommentError(`body exceeds ${COMMENT_BODY_MAX} characters`);

  let anchor;
  try {
    anchor = resolveAnchor(patchText, { project, path, side, line });
  } catch (err) {
    throw err instanceof AnchorError ? new DiffCommentError(err.message) : err;
  }

  const id = newCommentId();
  const ts = now();
  getDb();
  prepare(`INSERT INTO diff_comments
    (id, store_key, pipeline_id, project_key, path, old_path, side, line_no, line_text,
     body, author, resolved, resolved_at, sent_run_id, source, external_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?)`)
    .run(id, String(storeKey), String(pipelineId), anchor.project, anchor.path, anchor.oldPath,
      anchor.side, anchor.line, anchor.lineText, text, author, ts);
  notify(String(storeKey), String(pipelineId));
  return getDiffComment(id);
}

/** Toggle. Returns the updated comment, or null when the id is unknown. */
export function setDiffCommentResolved(id, resolved = true) {
  const before = getDiffComment(id);
  if (!before) return null;
  const on = resolved !== false;
  getDb();
  prepare('UPDATE diff_comments SET resolved = ?, resolved_at = ? WHERE id = ?')
    .run(on ? 1 : 0, on ? now() : null, id);
  notify(before.storeKey, before.pipelineId);
  return getDiffComment(id);
}

/** Hard delete. true when a row went away. */
export function deleteDiffComment(id) {
  const before = getDiffComment(id);
  if (!before) return false;
  getDb();
  const info = prepare('DELETE FROM diff_comments WHERE id = ?').run(id);
  if (!info.changes) return false;
  notify(before.storeKey, before.pipelineId);
  return true;
}

/**
 * Stamp `sent_run_id` on every id given. NEVER resolves anything (the brief) and
 * never notifies: the stamp lands during a run launch, where the History view is
 * already being repainted by the run's own events.
 * @returns {number} rows stamped
 */
export function stampSentRunId(commentIds, pipelineId) {
  const ids = (Array.isArray(commentIds) ? commentIds : []).filter((s) => typeof s === 'string' && DC_ID_RE.test(s));
  const pid = typeof pipelineId === 'string' ? pipelineId : '';
  if (!ids.length || !pid) return 0;
  getDb();
  return tx(() => {
    const stmt = getDb().prepare('UPDATE diff_comments SET sent_run_id = ? WHERE id = ?');
    let n = 0;
    for (const id of ids) n += stmt.run(pid, id).changes;
    return n;
  });
}

/**
 * Delete every comment of a run. NO transaction of its own — the CALLER owns it
 * (db.mjs tx() is not re-entrant and throws on nesting, and archivePipeline calls
 * this from inside its own tx). Used only by the archive path.
 */
export function deleteCommentsForRun(pipelineId) {
  getDb();
  return getDb().prepare('DELETE FROM diff_comments WHERE pipeline_id = ?').run(String(pipelineId)).changes;
}

// ── proposal → launch hand-off (D11) ────────────────────────────────────────

/**
 * Record the comment ids a proposal card is meant to address. Called from the
 * turn's proposal hook, which is the only place that sees propose_run's raw input:
 * commentIds deliberately never enter the card block (its key set is pinned in
 * test/ask-proposal.test.mjs) nor CARD_PATCH_KEYS. Unknown ids are dropped
 * silently — the model may cite a comment the user deleted in the meantime, and
 * that must not sink the proposal.
 */
export function setPendingCardComments(cardId, commentIds) {
  const card = typeof cardId === 'string' ? cardId.trim() : '';
  const ids = (Array.isArray(commentIds) ? commentIds : []).filter((s) => typeof s === 'string' && DC_ID_RE.test(s));
  if (!card || !ids.length) return 0;
  getDb();
  return tx(() => {
    const stmt = getDb().prepare('INSERT OR IGNORE INTO ask_card_comments (card_id, comment_id, created_at) VALUES (?, ?, ?)');
    const known = getDb().prepare('SELECT 1 AS ok FROM diff_comments WHERE id = ?');
    const ts = now();
    let n = 0;
    for (const id of ids) {
      if (!known.get(id)) continue;
      n += stmt.run(card, id, ts).changes;
    }
    return n;
  });
}

/**
 * The pending ids of a card, WITHOUT consuming them. Split from the delete so the
 * caller can write them onto ask_run_links first and only then drop them: the
 * consumer's catch merely logs, so a combined take-then-write loses the ids for good
 * if the write throws.
 */
export function peekPendingCardComments(cardId) {
  const card = typeof cardId === 'string' ? cardId.trim() : '';
  if (!card) return [];
  getDb();
  return getDb().prepare('SELECT comment_id FROM ask_card_comments WHERE card_id = ? ORDER BY rowid')
    .all(card).map((r) => r.comment_id);
}

/** Drop a card's pending ids once they are safely on the link row. */
export function clearPendingCardComments(cardId) {
  const card = typeof cardId === 'string' ? cardId.trim() : '';
  if (!card) return 0;
  getDb();
  return getDb().prepare('DELETE FROM ask_card_comments WHERE card_id = ?').run(card).changes;
}
