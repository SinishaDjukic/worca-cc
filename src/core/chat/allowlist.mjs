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
