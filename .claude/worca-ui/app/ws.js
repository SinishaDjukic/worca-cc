/**
 * Persistent WebSocket client with reconnect, request/response correlation,
 * and simple event dispatching.
 */
import { MESSAGE_TYPES, makeRequest, nextId } from './protocol.js';

/**
 * @typedef {'connecting'|'open'|'closed'|'reconnecting'} ConnectionState
 */

/**
 * Create a WebSocket client with auto-reconnect and message correlation.
 *
 * @param {{ url?: string, backoff?: { initialMs?: number, maxMs?: number, factor?: number, jitterRatio?: number } }} [options]
 */
export function createWsClient(options = {}) {
  const backoff = {
    initialMs: options.backoff?.initialMs ?? 1000,
    maxMs: options.backoff?.maxMs ?? 30000,
    factor: options.backoff?.factor ?? 2,
    jitterRatio: options.backoff?.jitterRatio ?? 0.2,
  };

  const resolveUrl = () => {
    if (options.url && options.url.length > 0) return options.url;
    if (typeof location !== 'undefined') {
      return (
        (location.protocol === 'https:' ? 'wss://' : 'ws://') +
        location.host +
        '/ws'
      );
    }
    return 'ws://localhost/ws';
  };

  /** @type {WebSocket | null} */
  let ws = null;
  /** @type {ConnectionState} */
  let state = 'closed';
  let attempts = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reconnectTimer = null;
  let shouldReconnect = true;

  /** @type {Map<string, { resolve: (v: any) => void, reject: (e: any) => void, type: string }>} */
  const pending = new Map();
  /** @type {Array<ReturnType<typeof makeRequest>>} */
  const queue = [];
  /** @type {Map<string, Set<(payload: any) => void>>} */
  const handlers = new Map();
  /** @type {Set<(s: ConnectionState) => void>} */
  const connectionHandlers = new Set();

  function notifyConnection(s) {
    for (const fn of Array.from(connectionHandlers)) {
      try {
        fn(s);
      } catch {
        /* ignore */
      }
    }
  }

  function scheduleReconnect() {
    if (!shouldReconnect || reconnectTimer) return;
    state = 'reconnecting';
    notifyConnection(state);
    const base = Math.min(
      backoff.maxMs,
      backoff.initialMs * backoff.factor ** attempts,
    );
    const jitter = backoff.jitterRatio * base;
    const delay = Math.max(
      0,
      Math.round(base + (Math.random() * 2 - 1) * jitter),
    );
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function sendRaw(req) {
    try {
      ws?.send(JSON.stringify(req));
    } catch {
      /* ignore */
    }
  }

  function onOpen() {
    state = 'open';
    notifyConnection(state);
    attempts = 0;
    while (queue.length) {
      const req = queue.shift();
      if (req) sendRaw(req);
    }
  }

  function onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (!msg || typeof msg.id !== 'string' || typeof msg.type !== 'string')
      return;

    if (pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.ok) {
        entry?.resolve(msg.payload);
      } else {
        entry?.reject(msg.error || new Error('ws error'));
      }
      return;
    }

    // Server-initiated event — pass (payload, envelope) so handlers can check msg.project
    const set = handlers.get(msg.type);
    if (set && set.size > 0) {
      for (const fn of Array.from(set)) {
        try {
          fn(msg.payload, msg);
        } catch {
          /* ignore */
        }
      }
    }
  }

  function onClose() {
    state = 'closed';
    notifyConnection(state);
    for (const [id, p] of pending.entries()) {
      p.reject(new Error('ws disconnected'));
      pending.delete(id);
    }
    attempts += 1;
    scheduleReconnect();
  }

  function connect() {
    if (!shouldReconnect) return;
    const url = resolveUrl();
    try {
      ws = new WebSocket(url);
      state = 'connecting';
      notifyConnection(state);
      ws.addEventListener('open', onOpen);
      ws.addEventListener('message', onMessage);
      ws.addEventListener('error', () => {
        /* let close handle it */
      });
      ws.addEventListener('close', onClose);
    } catch {
      scheduleReconnect();
    }
  }

  connect();

  return {
    sendRaw(msg) {
      sendRaw(msg);
    },

    send(type, payload) {
      if (!MESSAGE_TYPES.includes(type)) {
        return Promise.reject(new Error(`unknown message type: ${type}`));
      }
      const id = nextId();
      const req = makeRequest(type, payload, id);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, type });
        if (ws && ws.readyState === ws.OPEN) {
          sendRaw(req);
        } else {
          queue.push(req);
        }
      });
    },

    on(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      const set = handlers.get(type);
      set?.add(handler);
      return () => {
        set?.delete(handler);
      };
    },

    onConnection(handler) {
      connectionHandlers.add(handler);
      return () => {
        connectionHandlers.delete(handler);
      };
    },

    close() {
      shouldReconnect = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },

    getState() {
      return state;
    },
  };
}
