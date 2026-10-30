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
import { agentIdentityFor } from '../agent-pool.mjs';
import { claimForAgent } from '../agent-user.mjs';
import { currentOwner } from '../billing.mjs';
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

/** 1.4: a chat's folder (its attachments, worktrees, skill mounts, output) belongs to the agent user of the person
 *  whose turns run in it (agent-pool.mjs): with a pool, `ask/<thread>` gets that user's own group, setgid 2770, and
 *  `ask/` is sticky, so no other person's agent can read, edit or swap what this chat's agent loads. Made here when it
 *  is not there yet; refused (throws) when it is a link or another user's folder. A no-op without a pool group. */
export function claimThreadDir(threadId, owner = currentOwner()) {
  const id = agentIdentityFor(owner);
  if (!Number.isInteger(id?.runGid)) return;
  if (typeof threadId !== 'string' || !ASK_ID_RE.test(threadId)) throw new Error('claimThreadDir: refusing a thread id the store never minted');
  const dir = join(askRoot(), threadId);
  mkdirSync(askRoot(), { recursive: true });
  try { mkdirSync(dir); } catch (err) { if (err?.code !== 'EEXIST') throw err; }
  claimForAgent(dir, id);
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
    // #948 s2 (v75): archive and pin timestamps; null = not archived / not pinned.
    archivedAt: r.archived_at ?? null,
    pinnedAt: r.pinned_at ?? null,
    // #948 s3 (v76): the chat's topic group; null = ungrouped.
    groupId: r.group_id ?? null,
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
    ...(r.cost_known === 0 ? { costKnown: false } : {}),   // v82: a turn worca could not price (pricing.mjs), never $0
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
  claimThreadDir(id);   // 1.4: before an attachment lands in it
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
function listWhere(visibleTo, mode, alias, query, { show = null, ids = null } = {}) {
  const where = [];
  const args = [];
  if (visibleTo) { where.push(`(${alias}created_by IS NULL OR ${alias}created_by = ?)`); args.push(visibleTo); }
  if (mode !== 'any') where.push(mode === 'composer' ? `${alias}mode = 'composer'` : `(${alias}mode IS NULL OR ${alias}mode <> 'composer')`);
  // #948 s2: 'all' = not archived, 'archived' = archived only; null (every caller before s2) = both.
  if (show === 'all') where.push(`${alias}archived_at IS NULL`);
  else if (show === 'archived') where.push(`${alias}archived_at IS NOT NULL`);
  if (Array.isArray(ids)) {
    if (!ids.length) where.push('0');
    else { where.push(`${alias}id IN (${ids.map(() => '?').join(', ')})`); args.push(...ids); }
  }
  const q = searchText(query);
  if (q) {
    // #948 s3: a chat also matches through its topic group's name.
    where.push(`(${alias}title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM ask_messages m WHERE m.thread_id = ${alias}id AND m.text LIKE ? ESCAPE '\\' AND ${SEARCHED_MESSAGE})`
      + ` OR EXISTS (SELECT 1 FROM ask_chat_groups g WHERE g.id = ${alias}group_id AND g.name LIKE ? ESCAPE '\\'))`);
    args.push(likeContains(q), likeContains(q), likeContains(q));
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

/** A list row's link counts and what the chat did (the Chats column's kind icon), over `t`. A run card's launch links its
 *  run WITH the card id and a track_run without one; a later track of a run the chat started only patches the row, so
 *  its card id stays. A workflow card is a propose_workflow (`workflow`) or build_workflow (`workflow-build`) card in
 *  any state. The LIKE skips messages that cannot hold one before json_each parses any. */
const LIST_FACTS_SQL = `(SELECT count(*) FROM ask_run_links l WHERE l.thread_id = t.id) AS run_links,
           (SELECT count(*) FROM ask_run_links l WHERE l.thread_id = t.id AND l.card_id IS NOT NULL) AS started_runs,
           (SELECT count(*) FROM ask_run_links l WHERE l.thread_id = t.id AND l.card_id IS NULL) AS tracked_runs,
           EXISTS (SELECT 1 FROM ask_messages m, json_each(CASE WHEN json_valid(m.blocks) THEN m.blocks END) b
                   WHERE m.thread_id = t.id AND m.blocks LIKE '%"type":"workflow%' AND json_extract(b.value, '$.kind') = 'card'
                     AND json_extract(b.value, '$.card.type') IN ('workflow', 'workflow-build')) AS workflow_card,
           (SELECT count(*) FROM ask_worktrees w WHERE w.thread_id = t.id) AS worktrees`;

/** A list row: the thread without its composer canvas, its link counts and, for a message hit, the excerpt. */
function toListRow(r, q) {
  const { composer: _canvas, ...t } = rowToThread(r);
  // #948 s3: a group-name hit says so (the top-bar search prints "Group · NAME"); a title hit says nothing.
  const match = !q || r.title_hit ? {}
    : r.group_hit != null ? { match: { group: r.group_hit } }
    : r.hit_text != null ? { match: { snippet: excerptAround(r.hit_text, q) } } : {};
  return { ...t, runLinks: r.run_links, startedRuns: r.started_runs, trackedRuns: r.tracked_runs, hasWorkflowCard: !!r.workflow_card,
    worktrees: r.worktrees, ...match };
}

export function listThreads({ limit = 50, visibleTo = null, mode = null, query = '' } = {}) {
  getDb();
  const n = Number.isInteger(limit) && limit > 0 ? limit : 50;
  const q = searchText(query);
  const w = listWhere(visibleTo, mode, 't.', q);
  // A search also reads whether the title holds the text and, if not, the first message that does (its excerpt).
  const hit = q ? `,
           (t.title LIKE ? ESCAPE '\\') AS title_hit,
           (SELECT m.text FROM ask_messages m WHERE m.thread_id = t.id AND m.text LIKE ? ESCAPE '\\' AND ${SEARCHED_MESSAGE} ORDER BY m.seq LIMIT 1) AS hit_text,
           (SELECT g.name FROM ask_chat_groups g WHERE g.id = t.group_id AND g.name LIKE ? ESCAPE '\\') AS group_hit` : '';
  const rows = prepare(`
    SELECT t.*, ${LIST_FACTS_SQL}${hit}
    FROM ask_threads t${w.sql} ORDER BY t.updated_at DESC, t.id LIMIT ?
  `).all(...(q ? [likeContains(q), likeContains(q), likeContains(q)] : []), ...w.args, n);
  // A list row never carries the composer canvas (up to 256 KB each): getThread does.
  return rows.map((r) => toListRow(r, q));
}

/** #948 s2: the Chats column's sort keys. `expr` is SQL over `t`; the page also selects it AS sort_key for the cursor. */
const THREAD_SORT_SQL = Object.freeze({
  activity: { expr: 't.updated_at', desc: true },
  created: { expr: 't.created_at', desc: true },
  title: { expr: "lower(COALESCE(t.title, ''))", desc: false },
  cost: { expr: "COALESCE(json_extract(t.totals, '$.costUsd'), 0)", desc: true },
});
export const THREAD_SORTS = Object.freeze(Object.keys(THREAD_SORT_SQL));

const badCursor = () => Object.assign(new Error('invalid cursor'), { code: 'BAD_CURSOR' });
const encodeCursor = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function decodeCursor(s, sort) {
  let o = null;
  try { o = JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8')); } catch { throw badCursor(); }
  const keyOk = typeof o?.k === 'string' || typeof o?.k === 'number';
  if (!o || o.s !== sort || (o.p !== 0 && o.p !== 1) || typeof o.id !== 'string' || !keyOk) throw badCursor();
  return o;
}

/**
 * One page of the Chats column: pinned first, then `sort`, then id. `cursor` is the previous page's answer (null for
 * the first page); the answer's `cursor` is null on the last page. `show`: 'all' | 'archived' | null; `ids` limits the
 * page to those threads (Show = Needs you). Throws `code: 'BAD_CURSOR'` for a cursor of another sort or garbage.
 */
export function listThreadsPage({ limit = 50, visibleTo = null, mode = null, query = '', show = null, sort = 'activity', cursor = null, ids = null } = {}) {
  getDb();
  const s = THREAD_SORT_SQL[sort] ? sort : 'activity';
  const { expr, desc } = THREAD_SORT_SQL[s];
  const n = Number.isInteger(limit) && limit > 0 ? limit : 50;
  const q = searchText(query);
  const w = listWhere(visibleTo, mode, 't.', q, { show, ids });
  const after = cursor ? decodeCursor(cursor, s) : null;
  const keyset = after
    ? `${w.sql ? ' AND' : ' WHERE'} ((t.pinned_at IS NULL) > ? OR ((t.pinned_at IS NULL) = ? AND (${expr} ${desc ? '<' : '>'} ? OR (${expr} = ? AND t.id > ?))))`
    : '';
  const hit = q ? `,
           (t.title LIKE ? ESCAPE '\\') AS title_hit,
           (SELECT m.text FROM ask_messages m WHERE m.thread_id = t.id AND m.text LIKE ? ESCAPE '\\' AND ${SEARCHED_MESSAGE} ORDER BY m.seq LIMIT 1) AS hit_text,
           (SELECT g.name FROM ask_chat_groups g WHERE g.id = t.group_id AND g.name LIKE ? ESCAPE '\\') AS group_hit` : '';
  const rows = prepare(`
    SELECT t.*, ${LIST_FACTS_SQL},
           ${expr} AS sort_key, (t.pinned_at IS NULL) AS unpinned${hit}
    FROM ask_threads t${w.sql}${keyset}
    ORDER BY (t.pinned_at IS NULL), ${expr} ${desc ? 'DESC' : 'ASC'}, t.id LIMIT ?
  `).all(...(q ? [likeContains(q), likeContains(q), likeContains(q)] : []), ...w.args,
    ...(after ? [after.p, after.p, after.k, after.k, after.id] : []), n + 1);
  const page = rows.slice(0, n);
  const last = page.at(-1);
  return {
    threads: page.map((r) => toListRow(r, q)),
    cursor: rows.length > n && last ? encodeCursor({ s, p: Number(last.unpinned), k: last.sort_key, id: last.id }) : null,
  };
}

/** #948 s2: archive (on) or unarchive. Never bumps updated_at (Last activity keeps its order); a second archive keeps
 *  the first time. The thread, or null when it does not exist. */
export function setArchived(id, on) {
  getDb();
  const info = on
    ? prepare('UPDATE ask_threads SET archived_at = COALESCE(archived_at, ?) WHERE id = ?').run(now(), id)
    : prepare('UPDATE ask_threads SET archived_at = NULL WHERE id = ?').run(id);
  return info.changes ? getThread(id) : null;
}

/** #948 s2: pin (on) or unpin, the same rules as setArchived. */
export function setPinned(id, on) {
  getDb();
  const info = on
    ? prepare('UPDATE ask_threads SET pinned_at = COALESCE(pinned_at, ?) WHERE id = ?').run(now(), id)
    : prepare('UPDATE ask_threads SET pinned_at = NULL WHERE id = ?').run(id);
  return info.changes ? getThread(id) : null;
}

// ── chat topic groups (#948 s3, v76) ─────────────────────────────────────────
// A chat names its group in ask_threads.group_id (one at most). A group is never empty: a move, a Remove from group
// or a chat delete that leaves it with no chat deletes it in the same transaction (run groups' removeFromGroup rule).

export class ChatGroupError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export const CHAT_GROUP_NAME_MAX = 120;
const NAME_SOURCES = new Set(['suggested', 'user']);

function rowToGroup(r) {
  return { id: r.id, name: r.name, nameSource: r.name_source, createdBy: r.created_by ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at, ...(r.n != null ? { count: Number(r.n) } : {}) };
}
function groupName(name) {
  const s = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (!s || s.length > CHAT_GROUP_NAME_MAX) throw new ChatGroupError('BAD_NAME', `a group name is 1 to ${CHAT_GROUP_NAME_MAX} characters`);
  return s;
}
function nameSourceOf(src) {
  if (src === undefined || src === null) return 'user';
  if (!NAME_SOURCES.has(src)) throw new ChatGroupError('BAD_NAME_SOURCE', "nameSource is 'suggested' or 'user'");
  return src;
}
/** Inside a tx: delete `groupId` when no chat names it any more. */
function dropIfEmpty(groupId) {
  if (groupId) prepare('DELETE FROM ask_chat_groups WHERE id = ? AND NOT EXISTS (SELECT 1 FROM ask_threads WHERE group_id = ?)').run(groupId, groupId);
}
/** Inside a tx: point every chat in `ids` at `groupId` (a grouped chat moves), then drop the groups it emptied. */
function moveRows(groupId, ids) {
  const left = new Set();
  for (const tid of ids) {
    const r = prepare('SELECT group_id FROM ask_threads WHERE id = ?').get(tid);
    if (!r) throw new ChatGroupError('NO_THREAD', 'thread not found', 404);
    if (r.group_id && r.group_id !== groupId) left.add(r.group_id);
    prepare('UPDATE ask_threads SET group_id = ? WHERE id = ?').run(groupId, tid);
  }
  for (const g of left) dropIfEmpty(g);
}
const uniqueIds = (ids) => [...new Set(Array.isArray(ids) ? ids : [])];

export function getChatGroup(id) {
  getDb();
  const r = prepare('SELECT * FROM ask_chat_groups WHERE id = ?').get(id);
  return r ? rowToGroup(r) : null;
}

/** Every group this person sees, oldest first, with `count` = its chats that are not archived (the picker, the group
 *  row) and `total` = every chat in it, archived included (the Delete group… confirm). */
export function listChatGroups({ visibleTo = null } = {}) {
  getDb();
  const own = visibleTo ? ' WHERE (g.created_by IS NULL OR g.created_by = ?)' : '';
  return prepare(`SELECT g.*,
      (SELECT count(*) FROM ask_threads t WHERE t.group_id = g.id AND t.archived_at IS NULL) AS n,
      (SELECT count(*) FROM ask_threads t WHERE t.group_id = g.id) AS n_all
    FROM ask_chat_groups g${own} ORDER BY g.created_at, g.id`).all(...(visibleTo ? [visibleTo] : []))
    .map((r) => ({ ...rowToGroup(r), total: Number(r.n_all) }));
}

/** A new group holding `threadIds` (at least one; a grouped chat moves). Never bumps a chat's updated_at. */
export function createChatGroup({ name, nameSource, threadIds, createdBy = null } = {}) {
  const n = groupName(name);
  const src = nameSourceOf(nameSource);
  const ids = uniqueIds(threadIds);
  if (!ids.length) throw new ChatGroupError('NO_CHATS', 'a group starts with at least one chat');
  getDb();
  const id = newAskId('askg');
  const t = now();
  tx(() => {
    prepare('INSERT INTO ask_chat_groups (id, name, name_source, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, n, src, createdBy || null, t, t);
    moveRows(id, ids);
  });
  return getChatGroup(id);
}

/** The group, renamed, or null when it does not exist. */
export function renameChatGroup(id, { name, nameSource } = {}) {
  const n = groupName(name);
  const src = nameSourceOf(nameSource);
  getDb();
  const info = prepare('UPDATE ask_chat_groups SET name = ?, name_source = ?, updated_at = ? WHERE id = ?').run(n, src, now(), id);
  return info.changes ? getChatGroup(id) : null;
}

/** Move `threadIds` into the group (404 NOT_FOUND when it is gone). */
export function addToChatGroup(groupId, threadIds) {
  const ids = uniqueIds(threadIds);
  if (!ids.length) throw new ChatGroupError('NO_CHATS', 'name at least one chat');
  if (!getChatGroup(groupId)) throw new ChatGroupError('NOT_FOUND', 'group not found', 404);
  tx(() => moveRows(groupId, ids));
  return getChatGroup(groupId);
}

/** What Undo puts back for these chats: each one's group (null = ungrouped) and those groups' rows. */
export function snapshotChatGroups(threadIds) {
  getDb();
  const rows = uniqueIds(threadIds).map((id) => ({ id, groupId: prepare('SELECT group_id FROM ask_threads WHERE id = ?').get(id)?.group_id || null }));
  const gids = [...new Set(rows.map((r) => r.groupId).filter(Boolean))];
  return { rows, groups: gids.map((g) => prepare('SELECT * FROM ask_chat_groups WHERE id = ?').get(g)).filter(Boolean).map((g) => ({ ...g })), created: null };
}

/** Undo of an add or a create: each chat back in its old group (a group the move dropped comes back with its id,
 *  name and source); the created group, or one the undo empties, is dropped. A chat deleted since is skipped. */
export function restoreChatGroups(snap) {
  getDb();
  tx(() => {
    for (const g of snap.groups) {
      prepare('INSERT OR IGNORE INTO ask_chat_groups (id, name, name_source, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(g.id, g.name, g.name_source, g.created_by, g.created_at, g.updated_at);
    }
    const touched = new Set(snap.created ? [snap.created] : []);
    for (const r of snap.rows) {
      const cur = prepare('SELECT group_id FROM ask_threads WHERE id = ?').get(r.id);
      if (!cur) continue;
      if (cur.group_id) touched.add(cur.group_id);
      prepare('UPDATE ask_threads SET group_id = ? WHERE id = ?').run(r.groupId, r.id);
    }
    for (const g of touched) dropIfEmpty(g);
  });
}

/** Remove from group: { groupId, deleted } (deleted = that was its last chat), or null when the chat had no group. */
export function removeFromChatGroup(threadId) {
  getDb();
  return tx(() => {
    const r = prepare('SELECT group_id FROM ask_threads WHERE id = ?').get(threadId);
    if (!r || !r.group_id) return null;
    prepare('UPDATE ask_threads SET group_id = NULL WHERE id = ?').run(threadId);
    dropIfEmpty(r.group_id);
    return { groupId: r.group_id, deleted: !prepare('SELECT 1 FROM ask_chat_groups WHERE id = ?').get(r.group_id) };
  });
}

/** The group's chat ids, latest activity first (archived ones included). */
export function chatGroupThreadIds(groupId) {
  getDb();
  return prepare('SELECT id FROM ask_threads WHERE group_id = ? ORDER BY updated_at DESC, id').all(groupId).map((r) => r.id);
}

/** Ungroup: the chats stay, ungrouped, and the group goes. { deleted, threadIds }. The API's deleteChats=true deletes
 *  the chats first (ui/server.mjs deleteAskThreadFully), then calls this. */
export function deleteChatGroup(id) {
  getDb();
  return tx(() => {
    const threadIds = prepare('SELECT id FROM ask_threads WHERE group_id = ?').all(id).map((r) => r.id);
    prepare('UPDATE ask_threads SET group_id = NULL WHERE group_id = ?').run(id);
    const deleted = prepare('DELETE FROM ask_chat_groups WHERE id = ?').run(id).changes > 0;
    return { deleted, threadIds };
  });
}

/** The chat's first message the person typed ('' when none): the group-name suggestion reads it, and nothing after it. */
export function firstUserText(threadId) {
  getDb();
  const r = prepare(`SELECT m.text FROM ask_messages m WHERE m.thread_id = ? AND m.role = 'user' AND ${SEARCHED_MESSAGE}
    ORDER BY m.seq LIMIT 1`).get(threadId);
  return r ? String(r.text || '') : '';
}

/** Total saved chats — the History popover shows this, not the capped page listThreads returns. With a `query`, the
 *  chats the search matches (same filter as listThreads). */
export function countThreads({ visibleTo = null, mode = null, query = '', show = null, ids = null } = {}) {
  getDb();
  const w = listWhere(visibleTo, mode, 't.', query, { show, ids });
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
export function addThreadTotals(id, { costUsd = null, usage = null, agents = 0, costKnown = true } = {}) {
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
    if (costKnown === false) t.costKnown = false;   // sticky: one turn worca could not price leaves the total a floor
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
    const gid = prepare('SELECT group_id FROM ask_threads WHERE id = ?').get(id)?.group_id || null;
    // ask_card_comments is keyed by card id, and card ids live inside message
    // blocks (JSON) — no FK can cascade them, so a deleted thread used to leave
    // its proposals' pending comment ids behind for ever (review of PR #376).
    prepare(`DELETE FROM ask_card_comments WHERE card_id IN (
               SELECT json_extract(b.value, '$.id') FROM ask_messages m, json_each(m.blocks) b
               WHERE m.thread_id = ? AND json_valid(m.blocks) AND json_extract(b.value, '$.kind') = 'card')`).run(id);
    const gone = prepare('DELETE FROM ask_threads WHERE id = ?').run(id).changes > 0;
    if (gone) dropIfEmpty(gid);                       // #948 s3: a group is never left empty
    return gone;
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

export function finishMessage(id, { text, blocks, status, reason = null, usage = null, costUsd = null, durationMs = null, costKnown = true } = {}) {
  getDb();
  const info = prepare(`UPDATE ask_messages SET text = ?, blocks = ?, status = ?, reason = ?, usage = ?, cost_usd = ?, duration_ms = ?, cost_known = ?
                        WHERE id = ?`)
    .run(String(text ?? ''), str(blocks), status ?? null, reason, str(usage), costUsd, durationMs, costKnown === false ? 0 : 1, id);
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
 *  a COMMAND card (its helper-job `summary`, #911 slice 2), and a PR fix-run `progress` card, whose outcome lands later, also take a SHALLOW `card` sub-patch; a run
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
        || b.card.type === 'scope-switch' || b.card.type === 'project' || b.card.type === 'command' || b.card.type === 'script-approval'
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
