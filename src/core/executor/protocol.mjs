// src/core/executor/protocol.mjs
// Frame vocabulary + validators for the controller <-> worker protocol: one JSON object per
// WebSocket text message. Dependency-free on purpose (the worker process imports this module
// and little else), in the style of chat/channel-protocol.mjs. Unknown types are invalid;
// extra fields on known types are tolerated, so the protocol grows additively.
//
//   worker -> controller                       controller -> worker
//   hello {apiVersion, workerId, scope, pid,   welcome {controllerBootId, pingMs, idleMs}
//          capabilities}                       refuse {reason}            (then the socket closes)
//   started {id, pid}                          exec {id, file, args, cwd, env, stdin, detached, reap?, withheld?}
//   spawn-error {id, code, message}            ack {id, seq}              (flow control, every N out frames)
//   out {id, seq, stream, lines[]}             signal {id, sig}
//   exit {id, code, signal}                    shutdown {graceMs}
//   relay {id, token, line}                    relay-result {id, lines, error}
//   ping {id} / pong {id}                      ping {id} / pong {id}
//   log {level, msg} / bye
//
// An exec's `id` is minted by the controller; `seq` numbers a worker's `out` frames per exec
// from 0, and the controller acknowledges the highest seq it consumed so a chatty child cannot
// outrun the socket (the worker pauses reading after OUT_WINDOW unacknowledged frames).

export const PROTOCOL_VERSION = 1;

/** Hard cap per frame. An exec frame carries the whole child env, the argv and an optional
 *  stdin prompt; 1 MiB would cut a staged prompt, so this is generous. */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** Flow control: out frames a worker may have in flight before it pauses its pipes, and how
 *  often the controller acknowledges. */
export const OUT_WINDOW = 64;
export const ACK_EVERY = 16;
/** Lines per out frame and the flush interval that bound how long a line waits in the worker. */
export const OUT_BATCH_LINES = 64;
export const OUT_FLUSH_MS = 20;

/** Most names an exec frame's `withheld` list may carry. */
export const MAX_WITHHELD = 4096;

export const SIGNALS = Object.freeze(['SIGTERM', 'SIGKILL', 'SIGINT']);
export const STREAMS = Object.freeze(['out', 'err']);
/** Where a worker connects on the controller's worker port, and the largest WebSocket message either side accepts. */
export const WORKER_WS_PATH = '/worker';
export const WS_MAX_PAYLOAD = 8 * 1024 * 1024 + 1024;
export const LOG_LEVELS = Object.freeze(['info', 'warn', 'error']);

export const WORKER_FRAMES = Object.freeze(['hello', 'started', 'spawn-error', 'out', 'exit', 'ping', 'pong', 'relay', 'log', 'bye']);
export const CONTROLLER_FRAMES = Object.freeze(['welcome', 'refuse', 'exec', 'ack', 'signal', 'ping', 'pong', 'relay-result', 'shutdown']);

const str = (v, max = 4096, min = 1) => typeof v === 'string' && v.length >= min && v.length <= max;
const id = (v) => str(v, 128);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isStringMap = (v) => isPlainObject(v) && Object.values(v).every((x) => typeof x === 'string');

/** A worker's scope `{ kind: 'run'|'chat', id }`. */
export function isValidScope(s) {
  return isPlainObject(s) && (s.kind === 'run' || s.kind === 'chat') && str(s.id, 256) && !/[\\/\0]/.test(s.id) && s.id !== '.' && s.id !== '..';   // one path segment: it names the worker HOME
}

/** What a worker found on its PATH: `{ engines: { <name>: { bin, version }|null }, platform, node, user }`. */
export function isValidCapabilities(c) {
  if (!isPlainObject(c) || !isPlainObject(c.engines)) return false;
  for (const v of Object.values(c.engines)) {
    if (v === null) continue;
    if (!isPlainObject(v) || !str(v.bin, 4096) || !(v.version === null || str(v.version, 256))) return false;
  }
  return str(c.platform, 32) && str(c.node, 64) && (c.user === undefined || c.user === null || str(c.user, 256))
    && (c.worca === undefined || c.worca === null || str(c.worca, 64));   // the worker image's worca version
}

/** The one spawn request: what child_process.spawn gets on the worker. `env` is the COMPLETE child env
 *  (a remote exec never inherits the controller's environment). */
export function isValidExecSpec(f) {
  return id(f.id) && str(f.file, 4096) && Array.isArray(f.args) && f.args.every((a) => typeof a === 'string')
    && (f.cwd === null || str(f.cwd, 4096)) && isStringMap(f.env)   // null: the worker's own cwd, as a local spawn without one
    && (f.stdin === null || typeof f.stdin === 'string')
    && (f.detached === undefined || typeof f.detached === 'boolean')
    // `reap`: when the process ends, whatever it left running in its group is killed too (an engine's step, as locally).
    && (f.reap === undefined || typeof f.reap === 'boolean')
    // `withheld`: names the controller deliberately left out of `env` (an env scrub, the broker): the worker never
    // fills them in from its own environment.
    && (f.withheld === undefined || (Array.isArray(f.withheld) && f.withheld.length <= MAX_WITHHELD && f.withheld.every((n) => str(n, 256))));
}

/** Structural check of any protocol frame (either direction). */
export function isValidFrame(frame) {
  if (!isPlainObject(frame) || typeof frame.type !== 'string') return false;
  switch (frame.type) {
    case 'hello':
      return Number.isInteger(frame.apiVersion) && id(frame.workerId) && isValidScope(frame.scope)
        && Number.isInteger(frame.pid) && frame.pid > 0 && isValidCapabilities(frame.capabilities);
    case 'welcome':
      return str(frame.controllerBootId, 128) && Number.isInteger(frame.pingMs) && frame.pingMs > 0
        && (frame.idleMs === null || (Number.isInteger(frame.idleMs) && frame.idleMs > 0));
    case 'refuse':
      return str(frame.reason, 1024);
    case 'exec':
      return isValidExecSpec(frame);
    case 'started':
      return id(frame.id) && Number.isInteger(frame.pid) && frame.pid > 0;
    case 'spawn-error':
      return id(frame.id) && (frame.code === null || frame.code === undefined || str(frame.code, 64)) && str(frame.message, 4096);
    case 'out':
      return id(frame.id) && Number.isInteger(frame.seq) && frame.seq >= 0 && STREAMS.includes(frame.stream)
        && Array.isArray(frame.lines) && frame.lines.length >= 1 && frame.lines.every((l) => typeof l === 'string')
        // `more`: the frame's last line is not finished — it continues in the stream's next frame (a line too long
        // for one frame travels in pieces and must arrive as the ONE line it was).
        && (frame.more === undefined || typeof frame.more === 'boolean');
    case 'ack':
      return id(frame.id) && Number.isInteger(frame.seq) && frame.seq >= 0;
    case 'exit':
      return id(frame.id) && (frame.code === null || Number.isInteger(frame.code)) && (frame.signal === null || str(frame.signal, 32))
        && (frame.code !== null || frame.signal !== null);
    case 'signal':
      return id(frame.id) && SIGNALS.includes(frame.sig);
    case 'relay':
      return id(frame.id) && str(frame.token, 512) && typeof frame.line === 'string';
    case 'relay-result':
      return id(frame.id)
        && (frame.lines === null || (Array.isArray(frame.lines) && frame.lines.every((l) => typeof l === 'string')))
        && (frame.error === null || frame.error === undefined || str(frame.error, 4096));
    case 'ping':
    case 'pong':
      return id(frame.id);
    case 'shutdown':
      return frame.graceMs === undefined || (Number.isInteger(frame.graceMs) && frame.graceMs >= 0);
    case 'log':
      return LOG_LEVELS.includes(frame.level) && typeof frame.msg === 'string';
    case 'bye':
      return true;
    default:
      return false;
  }
}

/** One serialized frame. Throws on an invalid or oversize frame: a bug on the sending side. */
export function encodeFrame(frame) {
  // Coded, so a sender can tell "this request is malformed" (EPROTO) and "too large" (E2BIG) from a socket that is gone.
  if (!isValidFrame(frame)) throw Object.assign(new Error(`invalid ${frame?.type ?? 'frame'} frame`), { code: 'EPROTO' });
  const text = JSON.stringify(frame);
  if (Buffer.byteLength(text, 'utf8') > MAX_FRAME_BYTES) throw Object.assign(new Error(`frame exceeds MAX_FRAME_BYTES (${MAX_FRAME_BYTES})`), { code: 'E2BIG' });
  return text;
}

/** Parse one received message -> frame, or null on any violation (the receiver drops the peer). */
export function decodeFrame(data) {
  const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : null;
  if (text === null || Buffer.byteLength(text, 'utf8') > MAX_FRAME_BYTES) return null;
  let frame;
  try { frame = JSON.parse(text); } catch { return null; }
  return isValidFrame(frame) ? frame : null;
}
