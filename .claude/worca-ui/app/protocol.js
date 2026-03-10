/**
 * Protocol definitions for worca-ui WebSocket communication.
 */

/** @typedef {'subscribe-run'|'unsubscribe-run'|'subscribe-log'|'unsubscribe-log'|'list-runs'|'get-agent-prompt'|'get-preferences'|'set-preferences'|'stop-run'|'resume-run'|'run-snapshot'|'run-update'|'runs-list'|'log-line'|'log-bulk'|'preferences'} MessageType */

/** @type {MessageType[]} */
export const MESSAGE_TYPES = [
  'subscribe-run', 'unsubscribe-run',
  'subscribe-log', 'unsubscribe-log',
  'list-runs',
  'get-agent-prompt',
  'get-preferences', 'set-preferences',
  'stop-run', 'resume-run',
  // Server → Client events
  'run-snapshot', 'run-update', 'runs-list',
  'log-line', 'log-bulk',
  'preferences'
];

export function nextId() {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${now}-${rand}`;
}

export function makeRequest(type, payload, id = nextId()) {
  return { id, type, payload };
}

export function makeOk(req, payload) {
  return { id: req.id, ok: true, type: req.type, payload };
}

export function makeError(req, code, message, details) {
  return { id: req.id, ok: false, type: req.type, error: { code, message, details } };
}

export function isMessageType(value) {
  return typeof value === 'string' && MESSAGE_TYPES.includes(value);
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isRequest(value) {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && typeof value.type === 'string';
}

export function decodeRequest(json) {
  if (!isRequest(json)) throw new Error('Invalid request envelope');
  return json;
}
