// src/core/chat/channel-protocol.mjs
// Frame vocabulary + message contracts for the persistent channel-worker
// protocol (chat-connectivity-design.md §4.4). JSON-lines over stdio: one
// `\n`-terminated JSON object per frame, stdout protocol-reserved.
//
// Deliberately dependency-free (no core imports): channel-worker-child.mjs
// runs under a scrubbed env and imports THIS module and env-proxy.mjs only;
// plugins vendor their own minimal copies (lib/message.mjs) and never import the host.
//
// Message contracts are ported from the pre-1.0 integrations adapter.js:
//   NormalizedMessage = { title: string|null, body: MessageSegment[], severity }
//   MessageSegment    = { kind, value, href? }
//   IncomingMessage   = { chatId, userId, text, meta } (platform payloads stay
//                       in the worker — no `raw` across the pipe: size + secret
//                       hygiene, deliberate deviation from the old adapter.js)
// v2 additive: optional `controls`, `send.options`, `interaction`/`interaction-reply` frames — only for `interactive` channels
// v2 additive (chat context): optional inbound `attachments`, `replyTo`, `history` and the `history` host frame

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

export const HOST_FRAMES = ['hello', 'send', 'webhook', 'config', 'ping', 'shutdown', 'interaction-reply', 'react', 'history'];
export const WORKER_FRAMES = ['ready', 'status', 'inbound', 'send-result', 'webhook-result', 'state-delta', 'pong', 'log', 'interaction'];

/** Native controls (interactive channels only). Executable controls carry a host-issued opaque `ref`; the platform
 *  echoes it back in an `interaction` frame. Links carry no ref and execute nothing. */
export const CONTROL_KINDS = ['button', 'link', 'select'];
export const BUTTON_STYLES = ['primary', 'secondary', 'success', 'danger'];
export const INTERACTION_KINDS = ['button', 'select', 'modal'];
export const CONTROL_REF_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MODAL_FIELD_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
export const CONTROL_LIMITS = Object.freeze({
  controls: 10, selects: 1, selectOptions: 25, label: 80, optionValue: 100, optionLabel: 100, description: 100,
  placeholder: 100, url: 512, modalTitle: 45, modalFields: 5, modalFieldLabel: 45, modalFieldMax: 4000,
  interactionValues: 25, fieldValue: 4000, replyText: 2000,
});
const L = CONTROL_LIMITS;
const str = (v, max, min = 1) => typeof v === 'string' && v.length >= min && v.length <= max;

function isValidModal(m) {
  if (!m || typeof m !== 'object' || !str(m.title, L.modalTitle)) return false;
  if (!Array.isArray(m.fields) || m.fields.length < 1 || m.fields.length > L.modalFields) return false;
  return m.fields.every((f) => f && typeof f === 'object' && typeof f.id === 'string' && MODAL_FIELD_ID_RE.test(f.id)
    && str(f.label, L.modalFieldLabel) && (f.style === 'short' || f.style === 'paragraph')
    && typeof f.required === 'boolean' && Number.isInteger(f.maxLength) && f.maxLength >= 1 && f.maxLength <= L.modalFieldMax);
}

export function isValidControl(c) {
  if (!c || typeof c !== 'object' || !CONTROL_KINDS.includes(c.kind)) return false;
  if (c.kind === 'link') {
    if (!str(c.label, L.label) || !str(c.url, L.url)) return false;
    try { const u = new URL(c.url); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
  }
  if (typeof c.ref !== 'string' || !CONTROL_REF_RE.test(c.ref)) return false;
  if (c.kind === 'button') {
    return str(c.label, L.label) && BUTTON_STYLES.includes(c.style) && (c.modal === undefined || isValidModal(c.modal));
  }
  if (c.placeholder !== undefined && !str(c.placeholder, L.placeholder)) return false;
  if (!Array.isArray(c.options) || c.options.length < 1 || c.options.length > L.selectOptions) return false;
  const seen = new Set();
  for (const o of c.options) {
    if (!o || typeof o !== 'object' || !str(o.value, L.optionValue) || !str(o.label, L.optionLabel)) return false;
    if (o.description !== undefined && !str(o.description, L.description)) return false;
    if (seen.has(o.value)) return false;
    seen.add(o.value);
  }
  return true;
}

export function isValidControls(list) {
  if (!Array.isArray(list) || list.length > L.controls) return false;
  if (list.filter((c) => c && c.kind === 'select').length > L.selects) return false;
  return list.every(isValidControl);
}

/** send.options: at most one of edit {messageId} | thread {fromMessageId, name} (start a thread off a message). */
export function isValidSendOptions(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const keys = Object.keys(o);
  if (keys.length !== 1) return false;
  if (keys[0] === 'edit') return !!o.edit && typeof o.edit === 'object' && str(o.edit.messageId, 64);
  if (keys[0] === 'thread') return !!o.thread && typeof o.thread === 'object' && str(o.thread.fromMessageId, 64) && str(o.thread.name, 100);
  return false;
}

/** One component interaction the worker already acknowledged. No platform token ever rides it. */
export function isValidInteraction(e) {
  if (!e || typeof e !== 'object') return false;
  if (!str(e.id, 64) || !str(e.chatId, 64) || typeof e.userId !== 'string') return false;
  if (typeof e.ref !== 'string' || !CONTROL_REF_RE.test(e.ref) || !INTERACTION_KINDS.includes(e.kind)) return false;
  if (e.values !== undefined && !(Array.isArray(e.values) && e.values.length <= L.interactionValues && e.values.every((v) => str(v, L.optionValue)))) return false;
  if (e.fields !== undefined) {
    if (!e.fields || typeof e.fields !== 'object' || Array.isArray(e.fields)) return false;
    for (const [k, v] of Object.entries(e.fields)) if (!MODAL_FIELD_ID_RE.test(k) || !str(v, L.fieldValue, 0)) return false;
  }
  return e.meta === undefined || (e.meta !== null && typeof e.meta === 'object');
}

export function isValidSegment(seg) {
  if (!seg || typeof seg !== 'object') return false;
  return MESSAGE_SEGMENT_KINDS.includes(seg.kind) && typeof seg.value === 'string'
    && (seg.href === undefined || typeof seg.href === 'string');
}

export function isValidMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.title !== null && typeof msg.title !== 'string') return false;
  if (!Array.isArray(msg.body) || !msg.body.every(isValidSegment)) return false;
  return SEVERITY_LEVELS.includes(msg.severity) && (msg.controls === undefined || isValidControls(msg.controls));
}

/** Chat context around an inbound message (v2 additive, every field optional): the files on it, the message it replies
 *  to and recent channel history. The host validates all of it and treats the content as untrusted DATA: it is quoted
 *  to the model, never obeyed. A worker that sends none behaves exactly as before. */
export const INBOUND_LIMITS = Object.freeze({
  attachments: 10, attachmentName: 255, contentType: 128, url: 2048, attachmentSize: 2 ** 40,
  author: 100, text: 4000, at: 40, link: 512, history: 50,
});
const IL = INBOUND_LIMITS;
const httpsUrl = (v, max) => {
  if (!str(v, max)) return false;
  try { return new URL(v).protocol === 'https:'; } catch { return false; }
};

/** One file on a message: the host downloads `url` (only from the plugin's declared attachmentHosts). */
export function isValidAttachmentRef(a) {
  return !!a && typeof a === 'object' && !Array.isArray(a)
    && str(a.name, IL.attachmentName) && httpsUrl(a.url, IL.url)
    && Number.isSafeInteger(a.size) && a.size >= 0 && a.size <= IL.attachmentSize
    && (a.contentType === undefined || a.contentType === null || str(a.contentType, IL.contentType));
}
const isValidAttachmentList = (list) => Array.isArray(list) && list.length <= IL.attachments && list.every(isValidAttachmentRef);

/** A quoted message (`replyTo`, a `history` entry): who wrote it, when, its text, its link and its files. */
export function isValidQuotedMessage(q) {
  return !!q && typeof q === 'object' && !Array.isArray(q)
    && str(q.author, IL.author) && str(q.text, IL.text, 0)
    && str(q.at, IL.at) && Number.isFinite(Date.parse(q.at))
    && (q.link === undefined || q.link === null || httpsUrl(q.link, IL.link))
    && (q.attachments === undefined || isValidAttachmentList(q.attachments));
}

/** A history list (oldest first), from an inbound frame or a `history` RPC answer. */
export function isValidHistory(list) {
  return Array.isArray(list) && list.length <= IL.history && list.every(isValidQuotedMessage);
}

export function isValidIncoming(inc) {
  if (!inc || typeof inc !== 'object') return false;
  return typeof inc.chatId === 'string' && inc.chatId !== ''
    && typeof inc.userId === 'string'
    && typeof inc.text === 'string'
    && (inc.meta === undefined || (inc.meta !== null && typeof inc.meta === 'object'))
    && (inc.attachments === undefined || isValidAttachmentList(inc.attachments))
    && (inc.replyTo === undefined || isValidQuotedMessage(inc.replyTo))
    && (inc.history === undefined || isValidHistory(inc.history));
}

/** The message without its chat context: what a worker still delivers when only the context was refused. */
export function withoutInboundContext(inc) {
  const { attachments, replyTo, history, ...rest } = inc || {};
  return rest;
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
      return typeof frame.id === 'string' && typeof frame.chatId === 'string' && isValidMessage(frame.message)
        && (frame.options === undefined || isValidSendOptions(frame.options));
    case 'interaction-reply':
      return typeof frame.id === 'string' && typeof frame.interactionId === 'string' && frame.interactionId !== ''
        && typeof frame.text === 'string' && frame.text.length >= 1 && frame.text.length <= CONTROL_LIMITS.replyText;
    case 'react':   // v2 interactive: add/remove the bot's OWN reaction on one message
      return typeof frame.id === 'string'
        && typeof frame.chatId === 'string' && frame.chatId !== '' && frame.chatId.length <= 64
        && typeof frame.messageId === 'string' && frame.messageId !== '' && frame.messageId.length <= 64
        && typeof frame.emoji === 'string' && frame.emoji !== '' && frame.emoji.length <= 32
        && typeof frame.on === 'boolean';
    case 'history':   // v2 interactive (chat context): the recent messages of one chat before one message
      return typeof frame.id === 'string'
        && typeof frame.chatId === 'string' && frame.chatId !== '' && frame.chatId.length <= 64
        && typeof frame.before === 'string' && frame.before !== '' && frame.before.length <= 64
        && Number.isInteger(frame.limit) && frame.limit >= 1 && frame.limit <= INBOUND_LIMITS.history;
    case 'interaction':
      return isValidInteraction(frame.evt);
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
