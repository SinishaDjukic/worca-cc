/**
 * @typedef {('text'|'bold'|'code'|'code_block'|'link')} MessageSegmentKind
 *
 * @typedef {{
 *   kind: MessageSegmentKind,
 *   value: string,
 *   href?: string
 * }} MessageSegment
 *
 * @typedef {{
 *   title: string|null,
 *   body: MessageSegment[],
 *   severity: 'info'|'success'|'warning'|'error'
 * }} NormalizedMessage
 *
 * @typedef {{
 *   platform: string,
 *   chatId: string,
 *   userId: string,
 *   text: string,
 *   raw: object
 * }} IncomingMessage
 *
 * @typedef {object} ChatAdapter
 * @property {string} name
 * @property {boolean} supportsInbound
 * @property {() => Promise<void>} start
 * @property {() => Promise<void>} stop
 * @property {(chatId: string, msg: NormalizedMessage) => Promise<void>} send
 * @property {(cb: (msg: IncomingMessage) => void) => void} onInbound
 */

export const MESSAGE_SEGMENT_KINDS = [
  'text',
  'bold',
  'code',
  'code_block',
  'link',
];

export const SEVERITY_LEVELS = ['info', 'success', 'warning', 'error'];

export const ADAPTER_INTERFACE_KEYS = [
  'name',
  'supportsInbound',
  'start',
  'stop',
  'send',
  'onInbound',
];

/** @param {unknown} seg @returns {seg is MessageSegment} */
export function isValidSegment(seg) {
  if (!seg || typeof seg !== 'object') return false;
  return (
    MESSAGE_SEGMENT_KINDS.includes(seg.kind) && typeof seg.value === 'string'
  );
}

/** @param {unknown} msg @returns {msg is NormalizedMessage} */
export function isValidMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.title !== null && typeof msg.title !== 'string') return false;
  if (!Array.isArray(msg.body) || !msg.body.every(isValidSegment)) return false;
  return SEVERITY_LEVELS.includes(msg.severity);
}

/** @param {unknown} inc @returns {inc is IncomingMessage} */
export function isValidIncoming(inc) {
  if (!inc || typeof inc !== 'object') return false;
  return (
    typeof inc.platform === 'string' &&
    typeof inc.chatId === 'string' &&
    typeof inc.userId === 'string' &&
    typeof inc.text === 'string' &&
    inc.raw !== undefined
  );
}

/** @param {unknown} adapter @returns {adapter is ChatAdapter} */
export function isValidAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') return false;
  return (
    typeof adapter.name === 'string' &&
    typeof adapter.supportsInbound === 'boolean' &&
    typeof adapter.start === 'function' &&
    typeof adapter.send === 'function' &&
    typeof adapter.onInbound === 'function'
  );
}
