// src/core/chat/allowlist.mjs
// Inbound chat-ID gate, ported from pre-1.0 integrations/allowlist.js.
// DENY BY DEFAULT: an empty allowlist admits nobody — configuring a bot token
// without allowedChatIds gives outbound notifications but zero inbound control
// (chat-connectivity-design.md §4.6). allowedUserIds narrows an allowed chat to
// named senders: in a group chat, membership alone is not authority.

/**
 * @param {string[]} allowedIds chat IDs permitted to send inbound commands
 * @param {{ debug?: (...args: unknown[]) => void }} [log]
 * @param {string[]} [allowedUserIds] when non-empty, only these SENDERS (platform user IDs)
 *   of an allowed chat may command; empty keeps today's per-chat gate (everyone in the chat)
 */
export function createAllowlistGuard(allowedIds, log = {}, allowedUserIds = []) {
  const set = new Set((allowedIds || []).map((s) => String(s).trim()).filter(Boolean));
  const users = new Set((allowedUserIds || []).map((s) => String(s).trim()).filter(Boolean));
  const debug = log.debug ?? (() => {});

  return {
    /** The chat gate: is `chatId` allowed at all. */
    isAllowed({ platform, chatId }) {
      if (set.has(String(chatId))) return true;
      debug(`[allowlist] drop inbound message — platform=${platform} chatId=${chatId} not in allowlist`);
      return false;
    },
    /** The sender gate inside an allowed chat: true for everyone unless allowedUserIds names senders. */
    isSenderAllowed({ platform, chatId, userId }) {
      if (!users.size || users.has(String(userId ?? ''))) return true;
      debug(`[allowlist] drop inbound message: platform=${platform} chatId=${chatId} sender=${userId} not in allowedUserIds`);
      return false;
    },
    /** Whether `userId` is one of the named senders (false when none are named). */
    isListedSender(userId) {
      return users.has(String(userId ?? ''));
    },
  };
}

/** Comma-separated config value -> id list ("123, 456" -> ['123','456']). */
export function parseIdList(value) {
  return String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

// The character rule of src/core/identity.mjs VALUE_RE (C0, DEL, C1, U+2028/U+2029, < and >): a mapped identity must
// be one actorOf accepts, else createdBy and the recorded actor disagree. Built from a string, because a raw U+2028 in
// a regex literal is a line terminator.
const MEMBER_BAD_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029<>]');

/** "platformUserId=worca identity" pairs (comma or newline separated) → Map(userId → identity). Bad entries are skipped;
 *  ids are 1–64 of [A-Za-z0-9_-] (a Discord snowflake, a Teams Entra object id GUID); identities one printable line ≤ 200. */
export function parseChatMembers(raw) {
  const out = new Map();
  for (const item of String(raw ?? '').split(/[,\n]/)) {
    const eq = item.indexOf('=');
    if (eq <= 0) continue;
    const id = item.slice(0, eq).trim();
    const who = item.slice(eq + 1).trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !who || who.length > 200 || MEMBER_BAD_CHARS.test(who)) continue;
    out.set(id, who);
  }
  return out;
}
