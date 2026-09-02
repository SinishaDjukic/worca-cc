// Persistence for the Ask Worca chat (ask-worca-design.md §7): ask_threads,
// ask_messages, ask_attachments, ask_run_links over db.mjs. Everything here is
// SYNCHRONOUS (node:sqlite) and goes through getDb()/prepare()/tx() — never
// node:sqlite directly. tx() is NOT re-entrant (db.mjs:897): the server must never
// call a writer from inside its own tx(). Attachment bodies live on disk under
// <worcaHome>/ask/<threadId>/att/<attachmentId><ext> — the path is built from the
// ROW ID plus the row's kind/mime (attachment-kind.mjs), never from the
// user-supplied name. Text kinds stay `.txt`/utf8; binary kinds (#398) keep the
// extension of their SNIFFED mime and raw bytes.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { getDb, prepare, tx } from '../db.mjs';
import { worcaHome } from '../projects.mjs';
import { extensionForAttachment } from './attachment-kind.mjs';

export const ASK_ID_RE = /^[a-z]+_[0-9a-f]{8}$/;
const ROLES = new Set(['user', 'assistant', 'system']);

/** `<prefix>_<8 hex>` — prefixes: ask (thread), askm (message), att, card. */
export function newAskId(prefix) { return `${prefix}_${randomBytes(4).toString('hex')}`; }
/** New top-level root next to store/ — attachment bodies only (docs/storage.md). */
export function askRoot() { return join(worcaHome(), 'ask'); }
/**
 * `<askRoot>/<thread>/att`. The id is the only thing between this path and the rest
 * of the disk, so it is shape-checked here rather than at each caller: a thread row
 * the store never minted (raw SQL, a foreign writer, a future import) with id `..`
 * aimed the write at <home>/ask/att and `../../etc` outside the worca home entirely.
 * Throws rather than returning null so no caller can build a path from the failure.
 */
export function attachmentsDir(threadId) {
  if (typeof threadId !== 'string' || !ASK_ID_RE.test(threadId)) throw new Error('attachmentsDir: refusing a thread id the store never minted');
  return join(askRoot(), threadId, 'att');
}

const now = () => new Date().toISOString();
const parse = (v, fallback) => { if (v == null) return fallback; try { return JSON.parse(v); } catch { return fallback; } };
const str = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
const emptyTotals = () => ({ costUsd: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, turns: 0, agents: 0 });
const round6 = (n) => Math.round(n * 1e6) / 1e6;

function rowToThread(r) {
  return {
    id: r.id, title: r.title ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
    model: r.model ?? null, effort: r.effort ?? null, sessionId: r.session_id ?? null,
    context: parse(r.context, null),
    totals: { ...emptyTotals(), ...(parse(r.totals, {}) || {}) },
  };
}
function rowToMessage(r) {
  return {
    id: r.id, threadId: r.thread_id, seq: r.seq, role: r.role, text: r.text ?? '',
    blocks: parse(r.blocks, null), status: r.status ?? null, reason: r.reason ?? null,
    model: r.model ?? null, effort: r.effort ?? null, usage: parse(r.usage, null),
    costUsd: r.cost_usd ?? null, durationMs: r.duration_ms ?? null, createdAt: r.created_at,
  };
}
function rowToAttachment(r) {
  return {
    id: r.id, threadId: r.thread_id, messageId: r.message_id ?? null, name: r.name, bytes: r.bytes,
    kind: r.kind ?? 'text', mime: r.mime ?? null, // pre-v27 rows carry neither column value: they are text
    createdAt: r.created_at,
  };
}
function rowToRunLink(r) {
  return {
    threadId: r.thread_id, runId: r.run_id, pipelineId: r.pipeline_id ?? null, cardId: r.card_id ?? null,
    status: r.status ?? null, phase: r.phase ?? null,
    commentIds: parse(r.comment_ids, null) || [],     // v22: diff comments this run addresses
    createdAt: r.created_at,
  };
}

// ── threads ─────────────────────────────────────────────────────────────────

export function createThread({ title = null, model = null, effort = null } = {}) {
  getDb();
  const id = newAskId('ask');
  const t = now();
  prepare('INSERT INTO ask_threads (id, title, created_at, updated_at, model, effort, totals) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, title, t, t, model, effort, JSON.stringify(emptyTotals()));
  return getThread(id);
}

export function getThread(id) {
  getDb();
  const r = prepare('SELECT * FROM ask_threads WHERE id = ?').get(id);
  return r ? rowToThread(r) : null;
}

export function listThreads({ limit = 50 } = {}) {
  getDb();
  const n = Number.isInteger(limit) && limit > 0 ? limit : 50;
  const rows = prepare(`
    SELECT t.*, (SELECT count(*) FROM ask_run_links l WHERE l.thread_id = t.id) AS run_links,
           (SELECT count(*) FROM ask_worktrees w WHERE w.thread_id = t.id) AS worktrees
    FROM ask_threads t ORDER BY t.updated_at DESC, t.id LIMIT ?
  `).all(n);
  return rows.map((r) => ({ ...rowToThread(r), runLinks: r.run_links, worktrees: r.worktrees }));
}

const THREAD_PATCH_COLS = { title: 'title', model: 'model', effort: 'effort', sessionId: 'session_id', context: 'context' };

/** Patch ⊆ {title, model, effort, sessionId, context}; unknown keys ignored; always bumps updated_at. */
export function updateThread(id, patch = {}) {
  const db = getDb();
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(THREAD_PATCH_COLS)) {
    if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
    sets.push(`${col} = ?`);
    vals.push(k === 'context' ? str(patch[k]) : (patch[k] ?? null));
  }
  sets.push('updated_at = ?');
  vals.push(now(), id);
  const info = db.prepare(`UPDATE ask_threads SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return info.changes ? getThread(id) : null;
}

/** D13: `onlyIf` = replace the title only while it still IS that value (the user may have renamed it). */
export function setThreadTitle(id, title, { onlyIf } = {}) {
  getDb();
  const info = onlyIf === undefined
    ? prepare('UPDATE ask_threads SET title = ?, updated_at = ? WHERE id = ?').run(title, now(), id)
    : prepare('UPDATE ask_threads SET title = ?, updated_at = ? WHERE id = ? AND title IS ?').run(title, now(), id, onlyIf);
  return info.changes > 0;
}

/** Every turn — done, stopped or error — adds to the thread totals; a null cost adds 0 but counts the turn. */
export function addThreadTotals(id, { costUsd = null, usage = null, agents = 0 } = {}) {
  return tx(() => {
    const row = prepare('SELECT totals FROM ask_threads WHERE id = ?').get(id);
    if (!row) return null;
    const t = { ...emptyTotals(), ...(parse(row.totals, {}) || {}) };
    t.costUsd = round6(t.costUsd + (typeof costUsd === 'number' && Number.isFinite(costUsd) ? costUsd : 0));
    for (const k of ['input', 'output', 'cacheRead', 'cacheCreation']) t[k] += Number(usage?.[k]) || 0;
    if (Number.isFinite(usage?.ctx)) t.ctx = usage.ctx;                   // context fill: the turn's last per-call figure REPLACES (never sums)
    t.turns += 1;
    t.agents += Number.isInteger(agents) && agents > 0 ? agents : 0;
    prepare('UPDATE ask_threads SET totals = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(t), now(), id);
    return t;
  });
}

/**
 * Row delete (cascades to messages/attachments/links) then rm -rf of the attachment
 * root (spec §7.5). The id is validated FIRST because the rm path is built from it:
 * a row this store never minted (raw SQL, a foreign writer, a future import) with id
 * `..` would aim the rmSync at the whole worca home, and sweepEmptyThreads runs it
 * unattended at boot. "The DELETE matched" is not a shape check.
 */
export function deleteThread(id) {
  if (typeof id !== 'string' || !ASK_ID_RE.test(id)) return false;
  const removed = tx(() => {
    // ask_card_comments is keyed by card id, and card ids live inside message
    // blocks (JSON) — no FK can cascade them, so a deleted thread used to leave
    // its proposals' pending comment ids behind for ever (review of PR #376).
    prepare(`DELETE FROM ask_card_comments WHERE card_id IN (
               SELECT json_extract(b.value, '$.id') FROM ask_messages m, json_each(m.blocks) b
               WHERE m.thread_id = ? AND json_valid(m.blocks) AND json_extract(b.value, '$.kind') = 'card')`).run(id);
    return prepare('DELETE FROM ask_threads WHERE id = ?').run(id).changes > 0;
  });
  if (removed) rmSync(join(askRoot(), id), { recursive: true, force: true });
  return removed;
}

/** Boot sweep (spec §6.2.1): threads that never received a message and are older than the cutoff. */
export function sweepEmptyThreads({ olderThanMs = 24 * 60 * 60 * 1000, now: nowMs = Date.now() } = {}) {
  getDb();
  const cutoff = new Date(nowMs - olderThanMs).toISOString();
  const ids = prepare(`
    SELECT t.id FROM ask_threads t
    WHERE t.created_at < ? AND NOT EXISTS (SELECT 1 FROM ask_messages m WHERE m.thread_id = t.id)
  `).all(cutoff).map((r) => r.id);
  let removed = 0;
  for (const id of ids) if (deleteThread(id)) removed += 1;   // a row deleteThread refuses is not counted as swept
  return removed;
}

// ── messages ────────────────────────────────────────────────────────────────

/** seq = MAX(seq)+1 inside tx(): follower notices interleave with turns (spec §7.1). */
export function appendMessage(threadId, { role, text = '', blocks = null, status = null, model = null, effort = null } = {}) {
  if (!ROLES.has(role)) throw new Error(`appendMessage: invalid role ${JSON.stringify(role)}`);
  return tx(() => {
    if (!prepare('SELECT 1 FROM ask_threads WHERE id = ?').get(threadId)) {
      throw new Error(`appendMessage: unknown thread ${threadId}`);
    }
    const { next } = prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM ask_messages WHERE thread_id = ?').get(threadId);
    const id = newAskId('askm');
    const t = now();
    prepare(`INSERT INTO ask_messages (id, thread_id, seq, role, text, blocks, status, model, effort, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, threadId, next, role, String(text ?? ''), str(blocks), status, model, effort, t);
    prepare('UPDATE ask_threads SET updated_at = ? WHERE id = ?').run(t, threadId);
    return getMessage(id);
  });
}

export function getMessage(id) {
  getDb();
  const r = prepare('SELECT * FROM ask_messages WHERE id = ?').get(id);
  return r ? rowToMessage(r) : null;
}

export function listMessages(threadId) {
  getDb();
  return prepare('SELECT * FROM ask_messages WHERE thread_id = ? ORDER BY seq').all(threadId).map(rowToMessage);
}

export function finishMessage(id, { text, blocks, status, reason = null, usage = null, costUsd = null, durationMs = null } = {}) {
  getDb();
  const info = prepare(`UPDATE ask_messages SET text = ?, blocks = ?, status = ?, reason = ?, usage = ?, cost_usd = ?, duration_ms = ?
                        WHERE id = ?`)
    .run(String(text ?? ''), str(blocks), status ?? null, reason, str(usage), costUsd, durationMs, id);
  if (!info.changes) return null;
  const m = getMessage(id);
  prepare('UPDATE ask_threads SET updated_at = ? WHERE id = ?').run(now(), m.threadId);
  return m;
}

export function setMessageBlocks(id, blocks) {
  getDb();
  const info = prepare('UPDATE ask_messages SET blocks = ? WHERE id = ?').run(str(blocks), id);
  return info.changes ? getMessage(id) : null;
}

export function findCard(threadId, cardId) {
  for (const message of listMessages(threadId)) {
    if (!Array.isArray(message.blocks)) continue;   // a non-array JSON value parses truthy; skip it rather than throw
    const block = message.blocks.find((b) => b && b.kind === 'card' && b.id === cardId);
    if (block) return { message, block };
  }
  return null;
}

const CARD_PATCH_KEYS = ['state', 'runId', 'error'];

/** Patch ⊆ {state, runId, error} on one card block; the 'proposed' precondition is the caller's (route) business. */
export function updateCardBlock(threadId, cardId, patch = {}) {
  return tx(() => {
    const found = findCard(threadId, cardId);
    if (!found) return null;
    const allowed = {};
    for (const k of CARD_PATCH_KEYS) if (Object.prototype.hasOwnProperty.call(patch, k)) allowed[k] = patch[k];
    const blocks = found.message.blocks.map((b) => (b && b.kind === 'card' && b.id === cardId ? { ...b, ...allowed } : b));
    prepare('UPDATE ask_messages SET blocks = ? WHERE id = ?').run(JSON.stringify(blocks), found.message.id);
    return blocks.find((b) => b && b.kind === 'card' && b.id === cardId);
  });
}

/** Boot sweep (spec §6.2): a turn the previous server process never finished. */
export function sweepStreamingMessages({ text = 'interrupted by restart' } = {}) {
  return tx(() => {
    const rows = prepare("SELECT id, blocks FROM ask_messages WHERE status = 'streaming'").all();
    for (const r of rows) {
      // The whole sweep is ONE tx(): a TypeError on a single poisoned row would roll
      // back every other row's fix, and would do so again on every later boot.
      const prev = parse(r.blocks, []);
      const blocks = Array.isArray(prev) ? prev : [];
      blocks.push({ kind: 'notice', text });
      prepare("UPDATE ask_messages SET status = 'error', blocks = ? WHERE id = ?").run(JSON.stringify(blocks), r.id);
    }
    return rows.length;
  });
}

// ── attachments ─────────────────────────────────────────────────────────────

/**
 * Text kinds pass `{name, text}` (the pre-#398 signature, kind defaults 'text');
 * binary kinds pass `{name, kind, mime, data}` with a Buffer that has already
 * been sniffed by the route (attachment-kind.mjs) — the store trusts kind/mime
 * only to pick the on-disk extension, never to build a path from `name`.
 * NOTE (#398, issue point 8): binary bodies are raw pixel/PDF bytes — the
 * redactAskText guard that runs over text attachment content structurally
 * cannot apply to them; the model reads them via its Read tool as-is.
 */
export function addAttachment(threadId, messageId, { name, text, kind = 'text', mime = null, data = null } = {}) {
  getDb();
  if (!prepare('SELECT 1 FROM ask_threads WHERE id = ?').get(threadId)) {
    throw new Error(`addAttachment: unknown thread ${threadId}`);
  }
  const id = newAskId('att');
  const safeName = (basename(String(name ?? '')).slice(0, 255)) || 'attachment.txt';
  const dir = attachmentsDir(threadId);
  mkdirSync(dir, { recursive: true });
  let bytes;
  if (kind === 'text') {
    const body = String(text ?? '');
    bytes = Buffer.byteLength(body, 'utf8');
    writeFileSync(join(dir, `${id}.txt`), body, 'utf8'); // file FIRST: a row without a file would 404 on read
  } else {
    if (!Buffer.isBuffer(data)) throw new Error('addAttachment: a non-text attachment needs a Buffer body');
    bytes = data.length;
    writeFileSync(join(dir, `${id}${extensionForAttachment(kind, mime)}`), data); // no encoding: raw bytes
  }
  prepare('INSERT INTO ask_attachments (id, thread_id, message_id, name, bytes, kind, mime, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, threadId, messageId ?? null, safeName, bytes, kind, mime, now());
  return getAttachment(threadId, id);
}

export function listAttachments(threadId) {
  getDb();
  return prepare('SELECT * FROM ask_attachments WHERE thread_id = ? ORDER BY created_at, id').all(threadId).map(rowToAttachment);
}

export function getAttachment(threadId, id) {
  getDb();
  const r = prepare('SELECT * FROM ask_attachments WHERE thread_id = ? AND id = ?').get(threadId, id);
  return r ? rowToAttachment(r) : null;
}

/**
 * Thread-scoped read; the file path comes from the row id, never from `name` — and
 * the row is not proof of the id's shape, so `a.id` is checked too: an
 * `ask_attachments` row this store never minted, hung off a legitimate thread,
 * otherwise read any file on disk (`../../../../etc/hosts`). Both failures are the
 * same `null` a missing row returns; the caller (tool-deps.mjs) turns it into a
 * not-found, and a reader must not throw where a 404 is the answer.
 */
export function readAttachmentText(threadId, id) {
  const a = getAttachment(threadId, id);
  if (!a || !ASK_ID_RE.test(a.id) || a.kind !== 'text') return null; // a binary body is not utf8-readable
  try {
    return { ...a, text: readFileSync(join(attachmentsDir(threadId), `${a.id}.txt`), 'utf8') };
  } catch {
    return null;
  }
}

/**
 * Absolute on-disk path of an attachment's body — the pointer the read_attachment
 * tool hands the model for binary kinds (its Read tool renders images and PDFs
 * natively; the ask/ subtree is deliberately outside spawn.mjs ASK_DENY_RULES).
 * Same guards as readAttachmentText: row must exist, id must be store-minted.
 */
export function attachmentPath(threadId, id) {
  const a = getAttachment(threadId, id);
  if (!a || !ASK_ID_RE.test(a.id)) return null;
  return join(attachmentsDir(threadId), `${a.id}${extensionForAttachment(a.kind, a.mime)}`);
}

/** Raw thread-scoped read for the download route: any kind, body as a Buffer. */
export function readAttachmentRaw(threadId, id) {
  const a = getAttachment(threadId, id);
  const path = attachmentPath(threadId, id);
  if (!a || !path) return null;
  try {
    return { ...a, buffer: readFileSync(path) };
  } catch {
    return null;
  }
}

export function threadAttachmentBytes(threadId) {
  getDb();
  return prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM ask_attachments WHERE thread_id = ?').get(threadId).n;
}

// ── run links ───────────────────────────────────────────────────────────────

export function linkRun(threadId, { runId, cardId = null, pipelineId = null, status = null, phase = null } = {}) {
  getDb();
  prepare('INSERT INTO ask_run_links (thread_id, run_id, pipeline_id, card_id, status, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(threadId, runId, pipelineId, cardId, status, phase, now());
  return getRunLink(threadId, runId);
}

function getRunLink(threadId, runId) {
  const r = prepare('SELECT * FROM ask_run_links WHERE thread_id = ? AND run_id = ?').get(threadId, runId);
  return r ? rowToRunLink(r) : null;
}

// `runId` is patchable so a RESUMED run (a new runs-Map id for the same pipeline)
// can take over its link row instead of leaving it on the dead lineage.
const LINK_PATCH_COLS = { runId: 'run_id', pipelineId: 'pipeline_id', status: 'status', phase: 'phase', commentIds: 'comment_ids' };

export function updateRunLink(threadId, runId, patch = {}) {
  const db = getDb();
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(LINK_PATCH_COLS)) {
    if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
    sets.push(`${col} = ?`);
    // comment_ids is the one JSON column here; every other patch key is a scalar.
    // An empty array stores NULL so "no pending comments" has exactly one encoding.
    vals.push(k === 'commentIds' ? (Array.isArray(patch[k]) && patch[k].length ? str(patch[k]) : null) : (patch[k] ?? null));
  }
  if (!sets.length) return getRunLink(threadId, runId);
  vals.push(threadId, runId);
  const info = db.prepare(`UPDATE ask_run_links SET ${sets.join(', ')} WHERE thread_id = ? AND run_id = ?`).run(...vals);
  return info.changes ? getRunLink(threadId, Object.prototype.hasOwnProperty.call(patch, 'runId') ? patch.runId : runId) : null;
}

/** Every link row (any thread) pointing at a History pipeline id — what resumeRun
 *  re-attaches followers for. */
export function findRunLinksByPipeline(pipelineId) {
  getDb();
  if (typeof pipelineId !== 'string' || !pipelineId) return [];
  return prepare('SELECT * FROM ask_run_links WHERE pipeline_id = ? ORDER BY created_at DESC, run_id').all(pipelineId).map(rowToRunLink);
}

export function listRunLinks(threadId) {
  getDb();
  return prepare('SELECT * FROM ask_run_links WHERE thread_id = ? ORDER BY created_at DESC, run_id').all(threadId).map(rowToRunLink);
}
