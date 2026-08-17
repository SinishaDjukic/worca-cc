// src/core/chat/allowlist.mjs
// Inbound chat-ID gate, ported from pre-1.0 integrations/allowlist.js.
// DENY BY DEFAULT: an empty allowlist admits nobody — configuring a bot token
// without allowedChatIds gives outbound notifications but zero inbound control
// (chat-connectivity-design.md §4.6).

/**
 * @param {string[]} allowedIds chat IDs permitted to send inbound commands
 * @param {{ debug?: (...args: unknown[]) => void }} [log]
 */
export function createAllowlistGuard(allowedIds, log = {}) {
  const set = new Set((allowedIds || []).map((s) => String(s).trim()).filter(Boolean));
  const debug = log.debug ?? (() => {});

  return {
    isAllowed({ platform, chatId }) {
      if (set.has(String(chatId))) return true;
      debug(`[allowlist] drop inbound message — platform=${platform} chatId=${chatId} not in allowlist`);
      return false;
    },
  };
}

/** Comma-separated config value -> id list ("123, 456" -> ['123','456']). */
export function parseIdList(value) {
  return String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}
