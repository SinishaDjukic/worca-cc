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
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { getDb, prepare, tx } from '../db.mjs';
import { worcaHome } from '../projects.mjs';
import { extensionForAttachment } from './attachment-kind.mjs';
import { mergeContexts } from './contexts.mjs';

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

/** Ask's output folder for one chat — $WORCA_ASK_OUT in its run_command shells (commands.mjs). What Ask saves there,
 *  show_files may show. Under the thread folder, so deleteThread's rm -r of ask/<id> removes it. */
export function askOutDir(threadId) {
  if (typeof threadId !== 'string' || !ASK_ID_RE.test(threadId)) throw new Error('askOutDir: refusing a thread id the store never minted');
  return join(askRoot(), threadId, 'out');
}

const now = () => new Date().toISOString();
const parse = (v, fallback) => { if (v == null) return fallback; try { return JSON.parse(v); } catch { return fallback; } };
const str = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
const emptyTotals = () => ({ costUsd: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, turns: 0, agents: 0 });
const round6 = (n) => Math.round(n * 1e6) / 1e6;

function rowToThread(r) {
  const contexts = parse(r.contexts, null);
  return {
    id: r.id, title: r.title ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
    model: r.model ?? null, effort: r.effort ?? null, sessionId: r.session_id ?? null,
    context: parse(r.context, null),
    // Context chips (contexts.mjs): accumulated across turns, origin first. NULL (a chat from
    // before v46) reads as [] — no indicator.
    contexts: Array.isArray(contexts) ? contexts : [],
    totals: { ...emptyTotals(), ...(parse(r.totals, {}) || {}) },
    // The thread's owner (identity.mjs actor); null = ownerless (before attribution).
    createdBy: r.created_by ?? null,
    // MCP registry §9.4: the picker's switched-off {sets, members}; null = none (v45).
    mcpOff: parse(r.mcp_off, null),
    // Agent mode (#574): NULL (every chat before v51, and a new one) reads as on.
    agentMode: r.agent_mode == null ? true : r.agent_mode !== 0,
    // The engine the chat is locked to (#635): written with the model on every turn. NULL (a chat from
    // before v53) is read from its model (ask/models.mjs chatEngine).
    engine: r.engine ?? null,
    // Workflows view (v54): a composer chat's mode and the canvas its last message carried. Absent on Ask chats.
    ...(r.mode ? { mode: r.mode } : {}),
    ...(r.composer ? { composer: parse(r.composer, null) } : {}),
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
    // v64: a show_files copy remembers where it came from. Only the flag leaves the store: the path itself is read by
    // attachmentSourcePath for Show in folder and never reaches the browser.
    hasSource: r.source_path != null,
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

export function createThread({ title = null, model = null, effort = null, createdBy = null, mode = null } = {}) {
  getDb();
  const id = newAskId('ask');
  const t = now();
  prepare('INSERT INTO ask_threads (id, title, created_at, updated_at, model, effort, totals, created_by, mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, title, t, t, model, effort, JSON.stringify(emptyTotals()), createdBy || null, mode === 'composer' ? 'composer' : null);
  return getThread(id);
}

export function getThread(id) {
  getDb();
  const r = prepare('SELECT * FROM ask_threads WHERE id = ?').get(id);
  return r ? rowToThread(r) : null;
}

/** The History search as a LIKE operand: a substring match where `%`, `_` and `\` in the user's text match themselves
 *  (every LIKE here says ESCAPE '\'). */
const likeContains = (q) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
const searchText = (query) => (typeof query === 'string' ? query.trim() : '');
/** The search reads only messages the person sees as text: a synthetic event row (a card action, a terminal exit) keeps
 *  the model-facing `[worca event] …` line as its `text` and shows a notice block instead. `blocks` is JSON.stringify'd, so
 *  the bare `"synthetic":true` can only be that flag (a string value escapes its quotes); COALESCE keeps rows with no
 *  blocks (a NULL here would drop every plain user message). */
const SEARCHED_MESSAGE = `NOT (m.role = 'user' AND COALESCE(m.blocks, '') LIKE '%"synthetic":true%')`;

/** WHERE for a thread list: the owner filter (shared deployments) AND the surface (D9). `mode: 'any'` (the History
 *  "Delete all" count, which deletes composer chats too) skips the surface filter. A `query` (the History search) also
 *  keeps only chats whose title OR any message's text holds it — case-insensitive (SQLite's LIKE folds ASCII only).
 *  `alias` must name the threads table: the message subquery has an `id` of its own. */
function listWhere(visibleTo, mode, alias, query) {
  const where = [];
  const args = [];
  if (visibleTo) { where.push(`(${alias}created_by IS NULL OR ${alias}created_by = ?)`); args.push(visibleTo); }
  if (mode !== 'any') where.push(mode === 'composer' ? `${alias}mode = 'composer'` : `(${alias}mode IS NULL OR ${alias}mode <> 'composer')`);
  const q = searchText(query);
  if (q) {
    where.push(`(${alias}title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM ask_messages m WHERE m.thread_id = ${alias}id AND m.text LIKE ? ESCAPE '\\' AND ${SEARCHED_MESSAGE}))`);
    args.push(likeContains(q), likeContains(q));
  }
  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', args };
}

const EXCERPT_BEFORE = 30;
const EXCERPT_CHARS = 90;
/** One line of `text` around the first hit of `q` (whitespace collapsed, … where it was cut): the History row shows it
 *  under the title of a chat that matched on a message, not on its title. Plain text — the client sets textContent. */
function excerptAround(text, q) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(q.replace(/\s+/g, ' ').toLowerCase());
  const from = Math.max(0, Math.min(at < 0 ? 0 : at - EXCERPT_BEFORE, flat.length - EXCERPT_CHARS));
  const to = Math.min(flat.length, from + EXCERPT_CHARS);
  return `${from > 0 ? '…' : ''}${flat.slice(from, to)}${to < flat.length ? '…' : ''}`;
}

export function listThreads({ limit = 50, visibleTo = null, mode = null, query = '' } = {}) {
  getDb();
  const n = Number.isInteger(limit) && limit > 0 ? limit : 50;
  const q = searchText(query);
  const w = listWhere(visibleTo, mode, 't.', q);
  // A search also reads whether the title holds the text and, if not, the first message that does (its excerpt).
  const hit = q ? `,
           (t.title LIKE ? ESCAPE '\\') AS title_hit,
           (SELECT m.text FROM ask_messages m WHERE m.thread_id = t.id AND m.text LIKE ? ESCAPE '\\' AND ${SEARCHED_MESSAGE} ORDER BY m.seq LIMIT 1) AS hit_text` : '';
  const rows = prepare(`
    SELECT t.*, (SELECT count(*) FROM ask_run_links l WHERE l.thread_id = t.id) AS run_links,
           (SELECT count(*) FROM ask_worktrees w WHERE w.thread_id = t.id) AS worktrees${hit}
    FROM ask_threads t${w.sql} ORDER BY t.updated_at DESC, t.id LIMIT ?
  `).all(...(q ? [likeContains(q), likeContains(q)] : []), ...w.args, n);
  // A list row never carries the composer canvas (up to 256 KB each): getThread does.
  return rows.map((r) => {
    const { composer: _canvas, ...t } = rowToThread(r);
    const match = q && !r.title_hit && r.hit_text != null ? { match: { snippet: excerptAround(r.hit_text, q) } } : {};
    return { ...t, runLinks: r.run_links, worktrees: r.worktrees, ...match };
  });
}

/** Total saved chats — the History popover shows this, not the capped page listThreads returns. With a `query`, the
 *  chats the search matches (same filter as listThreads). */
export function countThreads({ visibleTo = null, mode = null, query = '' } = {}) {
  getDb();
  const w = listWhere(visibleTo, mode, 't.', query);
  const row = prepare(`SELECT count(*) AS n FROM ask_threads t${w.sql}`).get(...w.args);
  return row ? Number(row.n) : 0;
}

/** Every thread id, oldest-updated first, NO limit — the bulk delete walks all of them. */
export function listThreadIds({ ownedBy = null } = {}) {
  getDb();
  // ownedBy: only that person's threads (a shared deployment's "delete all" never touches others').
  if (ownedBy) return prepare('SELECT id FROM ask_threads WHERE created_by = ? ORDER BY updated_at, id').all(ownedBy).map((r) => r.id);
  return prepare('SELECT id FROM ask_threads ORDER BY updated_at, id').all().map((r) => r.id);
}

/** Global ask_worktrees row count (the per-thread count rides listThreads rows). */
export function countWorktrees() {
  getDb();
  const row = prepare('SELECT count(*) AS n FROM ask_worktrees').get();
  return row ? Number(row.n) : 0;
}

/** Global ask_attachments row count. */
export function countAttachments() {
  getDb();
  const row = prepare('SELECT count(*) AS n FROM ask_attachments').get();
  return row ? Number(row.n) : 0;
}

const THREAD_PATCH_COLS = { title: 'title', model: 'model', effort: 'effort', sessionId: 'session_id', context: 'context', mcpOff: 'mcp_off', agentMode: 'agent_mode', engine: 'engine', composer: 'composer' };
const JSON_PATCH_KEYS = new Set(['context', 'mcpOff', 'composer']);

/** Patch ⊆ {title, model, effort, sessionId, context, mcpOff, agentMode, engine, composer}; unknown keys ignored; always bumps updated_at. */
export function updateThread(id, patch = {}) {
  const db = getDb();
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(THREAD_PATCH_COLS)) {
    if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
    sets.push(`${col} = ?`);
    // node:sqlite cannot bind a boolean: agentMode is stored 0/1 (NULL = on).
    vals.push(JSON_PATCH_KEYS.has(k) ? str(patch[k])
      : k === 'agentMode' ? (patch[k] == null ? null : (patch[k] ? 1 : 0))
        : (patch[k] ?? null));
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
    if (Number.isInteger(usage?.ctxWindow) && usage.ctxWindow > 0) t.ctxWindow = usage.ctxWindow;   // the model's window: REPLACES; a turn without one keeps the last
    t.turns += 1;
    t.agents += Number.isInteger(agents) && agents > 0 ? agents : 0;
    prepare('UPDATE ask_threads SET totals = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(t), now(), id);
    return t;
  });
}

/** Merge one turn's context chips into the thread (mergeContexts: origin first, deduped).
 *  The ONLY writer of ask_threads.contexts; leaves updated_at alone (the turn already bumped it).
 *  Returns the stored list, or null for an unknown thread. */
export function addThreadContexts(id, entries) {
  return tx(() => {
    const row = prepare('SELECT contexts FROM ask_threads WHERE id = ?').get(id);
    if (!row) return null;
    const cur = parse(row.contexts, []);
    const next = mergeContexts(cur, entries);
    // a legacy NULL row with an empty turn stays NULL; anything that changes the list is written
    if (JSON.stringify(next) !== JSON.stringify(Array.isArray(cur) ? cur : [])) {
      prepare('UPDATE ask_threads SET contexts = ? WHERE id = ?').run(JSON.stringify(next), id);
    }
    return next;
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

/** Every card block whose message's JSON holds `needle` (a PR url, a run id), in thread then seq order: a cheap instr()
 *  prefilter in SQL, the exact match by the caller on the parsed block. → [{ threadId, block }] */
function cardsMentioning(needle) {
  getDb();
  if (typeof needle !== 'string' || !needle) return [];
  const out = [];
  const rows = prepare('SELECT thread_id, blocks FROM ask_messages WHERE blocks IS NOT NULL AND instr(blocks, ?) > 0 ORDER BY thread_id, seq').all(needle);
  for (const r of rows) {
    const blocks = parse(r.blocks, null);
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks) if (b && b.kind === 'card' && b.card && typeof b.card === 'object') out.push({ threadId: r.thread_id, block: b });
  }
  return out;
}

/** The applied pull-request cards that opened this PR — its url, or one workspace member's (receipt.mjs prCardResult):
 *  how PR watch reaches their chats without a turn. → [{ threadId, cardId, pipelineId, projectKey, workspaceId, memberKey }] */
export function findPullRequestCards(prUrl) {
  const out = [];
  for (const { threadId, block } of cardsMentioning(prUrl)) {
    const c = block.card;
    if (c.type !== 'pull-request' || block.state !== 'applied' || !c.result || typeof c.result !== 'object') continue;
    const member = Array.isArray(c.result.members) ? c.result.members.find((m) => m && m.url === prUrl) || null : null;
    if (!member && c.result.url !== prUrl) continue;
    out.push({ threadId, cardId: block.id, pipelineId: c.pipelineId || null, projectKey: c.projectKey || null,
      workspaceId: c.workspaceId || null, memberKey: (member && member.memberKey) || null });
  }
  return out;
}

/** The PR fix-run cards (a `progress` card with `fix`, ui/server.mjs askPrFixRun) posted for this fix run. → [{ threadId, block }] */
export function findFixRunCards(runId) {
  return cardsMentioning(runId).filter(({ block }) => block.card.type === 'progress' && !!block.card.fix && block.card.runId === runId);
}

// scheduledFor: a run card the user scheduled (state 'scheduled'); scheduleId + sentence: one that became a
// repeating schedule (docs/scheduled-runs.md "Chat").
const CARD_PATCH_KEYS = ['state', 'runId', 'error', 'workflowId', 'scheduledFor', 'scheduleId', 'sentence', 'after'];

/** Patch ⊆ {state, runId, error, workflowId} on one card block. A WORKFLOW card (card.type === 'workflow') and a
 *  METRICS, POLICY, SCHEDULE or MODEL card (card.type 'metrics' | 'policy' | 'schedule' | 'model', whose `result` lands at Apply),
 *  and a PR fix-run `progress` card, whose outcome lands later, also take a SHALLOW `card` sub-patch; a run
 *  card's `card` is never touched (its key set is pinned). The 'proposed' precondition is the caller's (route) business. */
export function updateCardBlock(threadId, cardId, patch = {}) {
  return tx(() => {
    const found = findCard(threadId, cardId);
    if (!found) return null;
    const allowed = {};
    for (const k of CARD_PATCH_KEYS) if (Object.prototype.hasOwnProperty.call(patch, k)) allowed[k] = patch[k];
    const sub = patch.card && typeof patch.card === 'object' && !Array.isArray(patch.card) ? patch.card : null;
    const blocks = found.message.blocks.map((b) => {
      if (!(b && b.kind === 'card' && b.id === cardId)) return b;
      const subPatchable = !!(b.card && (b.card.type === 'workflow' || b.card.type === 'metrics'
        || b.card.type === 'policy' || b.card.type === 'schedule' || b.card.type === 'model' || b.card.type === 'clone' || b.card.type === 'web'
        || b.card.type === 'workspace' || b.card.type === 'actions' || b.card.type === 'away' || b.card.type === 'proxy'
        || b.card.type === 'receipt' || b.card.type === 'run-stop' || b.card.type === 'pull-request' || b.card.type === 'ship'
        || b.card.type === 'changes' || b.card.type === 'route'
        || b.card.type === 'canvas-edit' || b.card.type === 'workflow-build' || b.card.type === 'agent-draft' || b.card.type === 'script-draft'
        || b.card.type === 'scope-switch' || b.card.type === 'project'
        || (b.card.type === 'progress' && !!b.card.fix)));
      return { ...b, ...allowed, ...(sub && subPatchable ? { card: { ...(b.card || {}), ...sub } } : {}) };
    });
    prepare('UPDATE ask_messages SET blocks = ? WHERE id = ?').run(JSON.stringify(blocks), found.message.id);
    return blocks.find((b) => b && b.kind === 'card' && b.id === cardId);
  });
}

/** Boot sweep for clone cards: a clone job lives in the server process, so a card still `cloning`
 *  after a restart can never finish — it fails with `text` (the folder may hold a partial clone;
 *  the next attempt refuses it as existing). Returns the number of cards failed. */
export function sweepCloningCards({ text = 'interrupted by a restart; the clone did not finish' } = {}) {
  return tx(() => {
    let n = 0;
    const rows = prepare("SELECT id, blocks FROM ask_messages WHERE blocks LIKE '%\"state\":\"cloning\"%'").all();
    for (const r of rows) {
      const prev = parse(r.blocks, []);
      if (!Array.isArray(prev)) continue;
      let changed = false;
      const blocks = prev.map((b) => {
        if (!(b && b.kind === 'card' && b.state === 'cloning' && b.card && b.card.type === 'clone')) return b;
        changed = true; n += 1;
        return { ...b, state: 'failed', error: text, card: { ...b.card, result: { ok: false, code: 'failed', error: text } } };
      });
      if (changed) prepare('UPDATE ask_messages SET blocks = ? WHERE id = ?').run(JSON.stringify(blocks), r.id);
    }
    return n;
  });
}

/** Boot sweep (spec §6.2): a turn the previous server process never finished. A workflow card still
 *  `building` in such a row can never flip (its turn is gone) — it fails with the same text. */
export function sweepStreamingMessages({ text = 'interrupted by restart' } = {}) {
  return tx(() => {
    const rows = prepare("SELECT id, blocks FROM ask_messages WHERE status = 'streaming'").all();
    for (const r of rows) {
      // The whole sweep is ONE tx(): a TypeError on a single poisoned row would roll
      // back every other row's fix, and would do so again on every later boot.
      const prev = parse(r.blocks, []);
      const blocks = (Array.isArray(prev) ? prev : [])
        .map((b) => (b && b.kind === 'card' && b.state === 'building' ? { ...b, state: 'failed', error: text } : b));
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
export function addAttachment(threadId, messageId, { name, text, kind = 'text', mime = null, data = null, sourcePath = null, sourceOrigin = null } = {}) {
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
  const src = typeof sourcePath === 'string' && sourcePath ? sourcePath : null;
  const str = (v) => (typeof v === 'string' && v ? v : null);
  // v70: an origin is kept only with its project and relative path: that pair is all Show in folder's fallback reads.
  const o = src && str(sourceOrigin?.projectKey) && str(sourceOrigin?.rel) ? sourceOrigin : null;
  prepare('INSERT INTO ask_attachments (id, thread_id, message_id, name, bytes, kind, mime, source_path, source_run_id, source_project_key, source_rel, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, threadId, messageId ?? null, safeName, bytes, kind, mime, src, o ? str(o.runId) : null, o ? o.projectKey : null, o ? o.rel : null, now());
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
 * Same guards as readAttachmentText: row must exist, id must be store-minted —
 * and the body must actually be on disk. A row that outlived its file (DB-only
 * restore, an external sweep of ask/<thread>/att) is the same `null` as a
 * missing row: the model must never be handed a path whose Read fails ENOENT.
 */
export function attachmentPath(threadId, id) {
  const a = getAttachment(threadId, id);
  if (!a || !ASK_ID_RE.test(a.id)) return null;
  const path = join(attachmentsDir(threadId), `${a.id}${extensionForAttachment(a.kind, a.mime)}`);
  return existsSync(path) ? path : null;
}

/** The real path a show_files copy was made from (v64), or null: an upload, or no such attachment in this thread.
 *  Server-only: Show in folder opens it, and nothing else reads it. */
export function attachmentSourcePath(threadId, id) {
  getDb();
  const r = prepare('SELECT source_path FROM ask_attachments WHERE thread_id = ? AND id = ?').get(threadId, id);
  return r && typeof r.source_path === 'string' && r.source_path ? r.source_path : null;
}

/** Where a show_files copy found under a run's or project's folder came from (v70): { runId, projectKey, rel } with
 *  `rel` the POSIX path below that folder, or null (an upload, a copy from the out folder, an older row, another thread).
 *  Server-only, like attachmentSourcePath: Show in folder falls back to `rel` inside the project once the run's
 *  worktree is gone. */
export function attachmentSourceOrigin(threadId, id) {
  getDb();
  const r = prepare('SELECT source_run_id, source_project_key, source_rel FROM ask_attachments WHERE thread_id = ? AND id = ?').get(threadId, id);
  if (!r || !r.source_project_key || !r.source_rel) return null;
  return { runId: r.source_run_id ?? null, projectKey: r.source_project_key, rel: r.source_rel };
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

/** An old `#running/<runId>` link (chat history) → its saved run: `{ pipelineId, historyKey }` (the `#history/` key,
 *  as listAllPipelines builds it), or null when no chat ever linked that id or the run was deleted. A resumed run's
 *  link row carries the new runId (updateRunLink), so a link from before the resume cannot resolve. */
export function runLinkTarget(runId) {
  getDb();
  if (typeof runId !== 'string' || !runId) return null;
  const r = prepare(`SELECT p.id, p.target, p.project_key, p.workspace_key FROM ask_run_links l
    JOIN pipelines p ON p.id = l.pipeline_id
    WHERE l.run_id = ? AND p.deleted_at IS NULL ORDER BY l.created_at DESC LIMIT 1`).get(runId);
  if (!r) return null;
  const historyKey = r.target === 'workspace' && r.workspace_key ? `workspaces/${r.workspace_key}` : r.project_key || null;
  return historyKey ? { pipelineId: r.id, historyKey } : null;
}

export function listRunLinks(threadId) {
  getDb();
  return prepare('SELECT * FROM ask_run_links WHERE thread_id = ? ORDER BY created_at DESC, run_id').all(threadId).map(rowToRunLink);
}
