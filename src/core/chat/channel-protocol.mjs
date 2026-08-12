// src/core/chat/channel-protocol.mjs
// Frame vocabulary + message contracts for the persistent channel-worker
// protocol (chat-connectivity-design.md §4.4). JSON-lines over stdio: one
// `\n`-terminated JSON object per frame, stdout protocol-reserved.
//
// Deliberately dependency-free (no core imports): channel-worker-child.mjs
// runs under a scrubbed env and imports THIS module only; plugins vendor their
// own minimal copies (lib/message.mjs) and never import the host.
//
// Message contracts are ported from the pre-1.0 integrations adapter.js:
//   NormalizedMessage = { title: string|null, body: MessageSegment[], severity }
//   MessageSegment    = { kind, value, href? }
//   IncomingMessage   = { chatId, userId, text, meta } (platform payloads stay
//                       in the worker — no `raw` across the pipe: size + secret
//                       hygiene, deliberate deviation from the old adapter.js)

export const MESSAGE_SEGMENT_KINDS = ['text', 'bold', 'code', 'code_block', 'link', 'markdown'];
export const SEVERITY_LEVELS = ['info', 'success', 'warning', 'error'];

/** Worker connection states (status frames; supervisor adds 'unconfigured' and
 *  'failed' for channels it refuses to spawn / gave up restarting). */
export const CONNECTION_STATES = ['connecting', 'connected', 'degraded', 'disconnected'];

/** Hard cap per protocol line; an oversize frame is a protocol violation and
 *  the supervisor kills + restarts the worker. */
export const MAX_FRAME_BYTES = 1024 * 1024;

/** Op/send error kinds — same vocabulary as PluginOpError (plugin spec §11). */
export const ERROR_KINDS = ['auth', 'rate-limit', 'network', 'plugin', 'timeout', 'protocol'];

export const HOST_FRAMES = ['hello', 'send', 'webhook', 'config', 'ping', 'shutdown'];
export const WORKER_FRAMES = ['ready', 'status', 'inbound', 'send-result', 'webhook-result', 'state-delta', 'pong', 'log'];

export function isValidSegment(seg) {
  if (!seg || typeof seg !== 'object') return false;
  return MESSAGE_SEGMENT_KINDS.includes(seg.kind) && typeof seg.value === 'string'
    && (seg.href === undefined || typeof seg.href === 'string');
}

export function isValidMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.title !== null && typeof msg.title !== 'string') return false;
  if (!Array.isArray(msg.body) || !msg.body.every(isValidSegment)) return false;
  return SEVERITY_LEVELS.includes(msg.severity);
}

export function isValidIncoming(inc) {
  if (!inc || typeof inc !== 'object') return false;
  return typeof inc.chatId === 'string' && inc.chatId !== ''
    && typeof inc.userId === 'string'
    && typeof inc.text === 'string'
    && (inc.meta === undefined || (inc.meta !== null && typeof inc.meta === 'object'));
}

/** Structural check of any protocol frame (either direction). Loose by design:
 *  unknown types are invalid, but extra fields on known types are tolerated so
 *  the protocol can grow additively without breaking old hosts/workers. */
export function isValidFrame(frame) {
  if (!frame || typeof frame !== 'object' || typeof frame.type !== 'string') return false;
  switch (frame.type) {
    case 'hello':
      return Number.isInteger(frame.apiVersion)
        && typeof frame.plugin === 'string' && typeof frame.channelId === 'string'
        && typeof frame.platform === 'string' && typeof frame.module === 'string'
        && !!frame.config && typeof frame.config === 'object'
        && !!frame.state && typeof frame.state === 'object';
    case 'send':
      return typeof frame.id === 'string' && typeof frame.chatId === 'string' && isValidMessage(frame.message);
    case 'webhook':
      return typeof frame.id === 'string' && typeof frame.method === 'string'
        && typeof frame.path === 'string'
        && !!frame.headers && typeof frame.headers === 'object'
        && typeof frame.bodyB64 === 'string';
    case 'config':
      return !!frame.config && typeof frame.config === 'object';
    case 'ping':
    case 'pong':
      return typeof frame.id === 'string';
    case 'shutdown':
      return true;
    case 'ready':
      return frame.identity === undefined || frame.identity === null || typeof frame.identity === 'string';
    case 'status':
      return CONNECTION_STATES.includes(frame.state)
        && (frame.detail === undefined || frame.detail === null || typeof frame.detail === 'string');
    case 'inbound':
      return isValidIncoming(frame.msg);
    case 'send-result':
      return typeof frame.id === 'string' && typeof frame.ok === 'boolean'
        && (frame.ok || (!!frame.error && typeof frame.error.message === 'string'));
    case 'webhook-result':
      return typeof frame.id === 'string' && Number.isInteger(frame.statusCode);
    case 'state-delta':
      return !!frame.delta && typeof frame.delta === 'object' && !Array.isArray(frame.delta);
    case 'log':
      return typeof frame.msg === 'string';
    default:
      return false;
  }
}

/** One serialized protocol line (with trailing newline). Throws on oversize. */
export function encodeFrame(frame) {
  const line = JSON.stringify(frame);
  if (Buffer.byteLength(line, 'utf8') > MAX_FRAME_BYTES) {
    throw new Error(`frame exceeds MAX_FRAME_BYTES (${MAX_FRAME_BYTES})`);
  }
  return `${line}\n`;
}

/** Parse one protocol line -> frame object, or null on any violation. */
export function decodeFrame(line) {
  if (typeof line !== 'string' || Buffer.byteLength(line, 'utf8') > MAX_FRAME_BYTES) return null;
  let frame;
  try { frame = JSON.parse(line); } catch { return null; }
  return isValidFrame(frame) ? frame : null;
}
