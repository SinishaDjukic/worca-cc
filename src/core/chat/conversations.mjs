// src/core/chat/conversations.mjs — v84/v85 freeform chat store: platform thread ↔ Ask thread bindings, opaque control
// refs, delivered message parts, and handled platform event ids. Pure SQL over core/db.mjs; no network, no clock
// beyond the injected `now`. Loads in the server and in the Ask MCP child (tool-deps reads conversationForThread).
import { randomBytes } from 'node:crypto';
import { getDb, prepare, tx } from '../db.mjs';

const iso = (ms) => new Date(ms).toISOString();
export const CARD_CONTROL_TTL_MS = 24 * 60 * 60 * 1000;
export const HEADER_CONTROL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SEEN_TTL_MS = 2 * 24 * 60 * 60 * 1000;
export const USED_CONTROL_KEEP_MS = 24 * 60 * 60 * 1000;

function rowToConversation(r) {
  return {
    id: r.id, plugin: r.plugin, channelId: r.channel_id, platform: r.platform, guildId: r.guild_id ?? null,
    parentChatId: r.parent_chat_id, chatId: r.chat_id, ownerUserId: r.owner_user_id, worcaIdentity: r.worca_identity,
    askThreadId: r.ask_thread_id, headerMessageId: r.header_message_id ?? null, headerNewOff: r.header_new_off === 1, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function newControlRef() { return randomBytes(18).toString('base64url'); }

export function createConversation({ plugin, channelId, platform, guildId = null, parentChatId, chatId, ownerUserId, worcaIdentity, askThreadId, headerMessageId = null }, { now = Date.now() } = {}) {
  getDb();
  const id = `chc_${randomBytes(4).toString('hex')}`;
  const t = iso(now);
  prepare(`INSERT INTO chat_conversations (id, plugin, channel_id, platform, guild_id, parent_chat_id, chat_id, owner_user_id,
    worca_identity, ask_thread_id, header_message_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .run(id, plugin, channelId, platform, guildId, parentChatId, chatId, ownerUserId, worcaIdentity, askThreadId, headerMessageId, t, t);
  return getConversation(id);
}

export function getConversation(id) {
  getDb();
  const r = prepare('SELECT * FROM chat_conversations WHERE id = ?').get(id);
  return r ? rowToConversation(r) : null;
}

export function findConversation({ plugin, channelId, chatId }) {
  getDb();
  const r = prepare("SELECT * FROM chat_conversations WHERE plugin = ? AND channel_id = ? AND chat_id = ? AND status = 'active'").get(plugin, channelId, chatId);
  return r ? rowToConversation(r) : null;
}

/** The active binding of an Ask thread, or null (the MCP child calls this per tool list). */
export function conversationForThread(askThreadId) {
  if (typeof askThreadId !== 'string' || !askThreadId) return null;
  getDb();
  const r = prepare("SELECT * FROM chat_conversations WHERE ask_thread_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(askThreadId);
  return r ? rowToConversation(r) : null;
}

/** Where each of these Ask threads came from: Map threadId -> { plugin, channelId, platform } for threads a chat
 *  integration opened; app chats are absent. The current binding wins; a thread a New conversation left behind keeps
 *  its origin through its delivered rows (chat_deliveries still name the conversation after the rebind). */
export function chatOrigins(threadIds) {
  const ids = [...new Set((threadIds || []).filter((id) => typeof id === 'string' && id))];
  const out = new Map();
  if (!ids.length) return out;
  getDb();
  const marks = ids.map(() => '?').join(', ');
  const rows = prepare(`SELECT c.ask_thread_id AS tid, c.plugin, c.channel_id, c.platform, 0 AS rank, c.created_at
      FROM chat_conversations c WHERE c.ask_thread_id IN (${marks})
    UNION ALL
    SELECT DISTINCT m.thread_id AS tid, c.plugin, c.channel_id, c.platform, 1 AS rank, c.created_at
      FROM chat_deliveries d JOIN ask_messages m ON m.id = d.ask_message_id JOIN chat_conversations c ON c.id = d.conversation_id
      WHERE m.thread_id IN (${marks})
    ORDER BY rank, created_at DESC`).all(...ids, ...ids);
  for (const r of rows) if (!out.has(r.tid)) out.set(r.tid, { plugin: r.plugin, channelId: r.channel_id, platform: r.platform });
  return out;
}

export function listActiveConversations({ plugin = null, channelId = null } = {}) {
  getDb();
  const rows = plugin
    ? prepare("SELECT * FROM chat_conversations WHERE status = 'active' AND plugin = ? AND channel_id = ? ORDER BY created_at").all(plugin, channelId)
    : prepare("SELECT * FROM chat_conversations WHERE status = 'active' ORDER BY created_at").all();
  return rows.map(rowToConversation);
}

/** New conversation: the same platform thread moves to a fresh Ask thread; old controls die with the old binding. */
export function rebindConversation(id, { askThreadId }, { now = Date.now() } = {}) {
  return tx(() => {
    prepare('UPDATE chat_conversations SET ask_thread_id = ?, updated_at = ? WHERE id = ?').run(askThreadId, iso(now), id);
    prepare("UPDATE chat_controls SET used_at = ? WHERE conversation_id = ? AND used_at IS NULL AND action NOT LIKE 'header:%'").run(iso(now), id);
    return getConversation(id);
  });
}

export function setHeaderMessage(id, messageId) {
  getDb();
  prepare('UPDATE chat_conversations SET header_message_id = ? WHERE id = ?').run(messageId, id);
}

/** Any successful header scope pick (v85): the header never offers New conversation again for this conversation. Its
 *  live refs are spent in the same transaction, so a click on an older header answers "no longer valid". Idempotent. */
export function retireNewConversation(id, { now = Date.now() } = {}) {
  return tx(() => {
    prepare('UPDATE chat_conversations SET header_new_off = 1 WHERE id = ?').run(id);
    prepare("UPDATE chat_controls SET used_at = ? WHERE conversation_id = ? AND action = 'header:new' AND used_at IS NULL").run(iso(now), id);
  });
}

// ── controls ────────────────────────────────────────────────────────────────

/** Mint one opaque ref. action: 'start' | 'dismiss' | 'choice' | 'text' (card controls, single use), 'changes'
 *  (card control, REUSABLE: a change request leaves the proposal open, D8) or 'header:scope' | 'header:new' |
 *  'header:stop' (reusable, survive restarts because the op is stored here). */
export function issueControl({ conversationId, cardId = null, action, issuedState = null, ownerUserId, singleUse = true, ttlMs = CARD_CONTROL_TTL_MS }, { now = Date.now() } = {}) {
  getDb();
  const ref = newControlRef();
  prepare(`INSERT INTO chat_controls (ref, conversation_id, card_id, action, issued_state, owner_user_id, single_use, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(ref, conversationId, cardId, action, issuedState, ownerUserId, singleUse ? 1 : 0, iso(now + ttlMs), iso(now));
  return ref;
}

export function getControl(ref) {
  getDb();
  const r = prepare('SELECT * FROM chat_controls WHERE ref = ?').get(ref);
  return r ? { ref: r.ref, conversationId: r.conversation_id, cardId: r.card_id ?? null, action: r.action,
    issuedState: r.issued_state ?? null, ownerUserId: r.owner_user_id, singleUse: r.single_use === 1,
    expiresAt: r.expires_at, usedAt: r.used_at ?? null } : null;
}

/** Atomic single-use claim: true for exactly one caller. Reusable controls always claim. */
export function claimControl(ref, { now = Date.now() } = {}) {
  getDb();
  const c = getControl(ref);
  if (!c) return false;
  if (!c.singleUse) return c.usedAt === null;
  return prepare('UPDATE chat_controls SET used_at = ? WHERE ref = ? AND used_at IS NULL').run(iso(now), ref).changes === 1;
}

/** A refused apply gives the control back so the person can retry. */
export function releaseControl(ref) {
  getDb();
  prepare('UPDATE chat_controls SET used_at = NULL WHERE ref = ? AND single_use = 1').run(ref);
}

/** The header is about to be re-issued: its older reusable refs are spent (a click on an old header answers stale). */
export function retireHeaderControls(conversationId, { now = Date.now() } = {}) {
  getDb();
  prepare("UPDATE chat_controls SET used_at = ? WHERE conversation_id = ? AND action LIKE 'header:%' AND used_at IS NULL").run(iso(now), conversationId);
}

/** The card left its issued state: every control of that card is spent. */
export function retireCardControls(conversationId, cardId, { now = Date.now() } = {}) {
  getDb();
  prepare('UPDATE chat_controls SET used_at = ? WHERE conversation_id = ? AND card_id = ? AND used_at IS NULL').run(iso(now), conversationId, cardId);
}

// ── deliveries ──────────────────────────────────────────────────────────────

export function deliveredParts(conversationId, askMessageId) {
  getDb();
  return prepare("SELECT part, platform_message_id, shown_state FROM chat_deliveries WHERE conversation_id = ? AND ask_message_id = ? AND part <> 'status'")
    .all(conversationId, askMessageId)
    .map((r) => ({ part: r.part, platformMessageId: r.platform_message_id ?? null, shownState: r.shown_state ?? null }));
}

export function recordDelivery({ conversationId, askMessageId, part, platformMessageId = null, shownState = null }, { now = Date.now() } = {}) {
  getDb();
  prepare(`INSERT INTO chat_deliveries (conversation_id, ask_message_id, part, platform_message_id, shown_state, delivered_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (conversation_id, ask_message_id, part) DO UPDATE SET platform_message_id = excluded.platform_message_id,
    shown_state = excluded.shown_state, delivered_at = excluded.delivered_at`)
    .run(conversationId, askMessageId, part, platformMessageId, shownState, iso(now));
}

// ── live status messages (discord-chat 0.5.0) ─────────────────────────────────
// A turn's "working" message lives in chat_deliveries as part 'status' (no schema change): ask_message_id is
// 'pending:<platform id>' until the turn's reply row is known, then that row's id. A row that is still here after a
// restart is a status message left saying "working" (the bridge's sweep finishes it).

const STATUS_PART = 'status';
const PENDING = 'pending:';

export function recordStatus({ conversationId, platformMessageId }, { now = Date.now() } = {}) {
  getDb();
  prepare(`INSERT OR REPLACE INTO chat_deliveries (conversation_id, ask_message_id, part, platform_message_id, shown_state, delivered_at)
    VALUES (?, ?, ?, ?, 'working', ?)`).run(conversationId, PENDING + platformMessageId, STATUS_PART, platformMessageId, iso(now));
}

/** The status message now waits for this reply row. */
export function bindStatus(conversationId, platformMessageId, askMessageId) {
  getDb();
  prepare('UPDATE chat_deliveries SET ask_message_id = ? WHERE conversation_id = ? AND part = ? AND platform_message_id = ?')
    .run(askMessageId, conversationId, STATUS_PART, platformMessageId);
}

/** Every status message of a conversation still marked working, oldest first. */
export function listStatuses(conversationId) {
  getDb();
  return prepare('SELECT ask_message_id, platform_message_id, delivered_at FROM chat_deliveries WHERE conversation_id = ? AND part = ? ORDER BY delivered_at, platform_message_id')
    .all(conversationId, STATUS_PART)
    .map((r) => ({ platformMessageId: r.platform_message_id, askMessageId: r.ask_message_id.startsWith(PENDING) ? null : r.ask_message_id, startedAt: r.delivered_at }));
}

export function clearStatus(conversationId, platformMessageId) {
  getDb();
  prepare('DELETE FROM chat_deliveries WHERE conversation_id = ? AND part = ? AND platform_message_id = ?').run(conversationId, STATUS_PART, platformMessageId);
}

// ── inbound dedup ───────────────────────────────────────────────────────────

/** Drop dead rows: event ids older than SEEN_TTL_MS, expired controls, and controls used more than a day ago (a
 *  click on a pruned ref finds no row and answers "no longer valid", exactly like a used one). */
export function pruneChatRows({ now = Date.now() } = {}) {
  getDb();
  prepare('DELETE FROM chat_inbound_seen WHERE seen_at < ?').run(iso(now - SEEN_TTL_MS));
  prepare('DELETE FROM chat_controls WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)')
    .run(iso(now), iso(now - USED_CONTROL_KEEP_MS));
}

/** true the FIRST time an event id is seen for this channel; prunes dead rows first. */
export function markSeen({ plugin, channelId, eventId }, { now = Date.now() } = {}) {
  if (typeof eventId !== 'string' || !eventId) return true;   // no id = cannot dedup, never drop
  pruneChatRows({ now });
  return prepare('INSERT OR IGNORE INTO chat_inbound_seen (plugin, channel_id, event_id, seen_at) VALUES (?, ?, ?, ?)')
    .run(plugin, channelId, eventId, iso(now)).changes === 1;
}
