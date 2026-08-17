/**
 * NormalizedMessage / IncomingMessage contracts + validators — the plugin-side
 * copy of the channel protocol's message shapes (ported from the pre-1.0
 * integrations adapter.js, ChatAdapter interface dropped). Vendored
 * byte-identically into every chat plugin; test/chat-lib-drift.test.mjs
 * enforces the copies never diverge.
 * @module lib/message
 */

export const MESSAGE_SEGMENT_KINDS = ['text', 'bold', 'code', 'code_block', 'link', 'markdown'];

export const SEVERITY_LEVELS = ['info', 'success', 'warning', 'error'];

/** @param {unknown} seg */
export function isValidSegment(seg) {
  if (!seg || typeof seg !== 'object') return false;
  return MESSAGE_SEGMENT_KINDS.includes(seg.kind) && typeof seg.value === 'string';
}

/** @param {unknown} msg */
export function isValidMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.title !== null && typeof msg.title !== 'string') return false;
  if (!Array.isArray(msg.body) || !msg.body.every(isValidSegment)) return false;
  return SEVERITY_LEVELS.includes(msg.severity);
}

/** @param {unknown} inc */
export function isValidIncoming(inc) {
  if (!inc || typeof inc !== 'object') return false;
  return typeof inc.chatId === 'string' && inc.chatId !== ''
    && typeof inc.userId === 'string'
    && typeof inc.text === 'string';
}
