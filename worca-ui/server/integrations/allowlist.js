/**
 * @param {string[]} allowedIds  — chat IDs permitted to send inbound messages
 * @param {{ debug?: (...args: unknown[]) => void }} [log]
 * @returns {{ isAllowed: (msg: { platform: string, chatId: string }) => boolean }}
 */
export function createAllowlistGuard(allowedIds, log = {}) {
  const set = new Set(allowedIds);
  const debug = log.debug ?? (() => {});

  return {
    isAllowed({ platform, chatId }) {
      if (set.has(chatId)) return true;
      debug(
        `[allowlist] drop inbound message — platform=${platform} chatId=${chatId} not in allowlist`,
      );
      return false;
    },
  };
}
