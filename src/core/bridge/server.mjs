// src/core/bridge/server.mjs
// The in-process loopback bridge (model-bridge-design.md §4.1): an http
// server on 127.0.0.1 that presents the Anthropic Messages API to the spawned
// `claude` CLI under /m/<catalogId>/v1/... and forwards each request to the
// entry's configured upstream. One per worca process (UI server or CLI),
// started lazily by resolveModelEnv on the first bridged dispatch — or ahead
// of time by startBridge() at boot — bound to an ephemeral port, unref'd so
// an idle bridge never keeps the process alive.
//
// Auth to the bridge is a per-process random secret handed to the CLI as
// ANTHROPIC_AUTH_TOKEN: the bridge holds real credentials, and loopback alone
// would let any local process (or a sub-agent shelling out to curl) borrow
// them. The secret is never persisted and never logged.

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { findBridgedEntry } from './registry.mjs';
import { handleMessages } from './upstream.mjs';
import { estimateInputTokens } from './translate/response.mjs';
import { bridgeErrors, PAYLOAD_CEILING_BYTES } from './errors.mjs';

let state = null;   // { server, port, secret, listening: Promise<number>, log }
const ROUTE_RE = /^\/m\/([^/]+)(?:\/r\/([^/]+))?\/v1\/(messages|messages\/count_tokens|models)\/?$/;

/** The bridge's per-process bearer secret (created on first use). */
export function bridgeSecret() {
  if (!state) state = createState();
  return state.secret;
}

function createState() {
  return { server: null, port: 0, secret: randomBytes(32).toString('hex'), listening: null, log: null };
}

/**
 * Start the bridge if it is not running and resolve once it listens.
 * @param {{log?:(line:string)=>void, fetch?:typeof fetch}} [opts]
 * @returns {Promise<{port:number, secret:string}>}
 */
export async function startBridge(opts = {}) {
  ensureBridgeSync(opts);
  await state.listening;
  return { port: state.port, secret: state.secret };
}

/**
 * The bridge's {port, secret}, starting it on a random loopback port when it
 * is not running yet. Synchronous by contract (resolveModelEnv is sync): the
 * server is listening by the time the spawned CLI makes its first request,
 * and startBridge() at boot is the normal path that makes this a no-op.
 */
export function ensureBridgeSync({ log, fetch: f } = {}) {
  if (!state) state = createState();
  if (log) state.log = log;
  if (f) state.fetch = f;
  if (state.server) return { port: state.port, secret: state.secret };
  const server = http.createServer((req, res) => handle(req, res).catch((err) => {
    try { if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: `bridge: ${err && err.message ? err.message : String(err)}` } })); } catch { /* gone */ }
  }));
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = 0;   // long-running streams
  state.server = server;
  state.port = pickPort();
  state.listening = new Promise((resolve) => {
    let attempts = 0;
    const tryListen = () => {
      server.once('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && attempts < 10) {
          attempts += 1;
          state.port = pickPort();
          (state.log || console.warn)(`[worca] bridge: port in use, retrying on ${state.port}`);
          tryListen();
          return;
        }
        (state.log || console.warn)(`[worca] bridge: failed to listen — ${err && err.message}`);
        state.server = null;
        resolve(0);
      });
      server.listen(state.port, '127.0.0.1', () => {
        state.port = server.address().port;
        server.unref();
        resolve(state.port);
      });
    };
    tryListen();
  });
  return { port: state.port, secret: state.secret };
}

/** A random port in the private range; the listen retry covers a collision. */
function pickPort() { return 20000 + Math.floor(Math.random() * 40000); }

/** The base URL the CLI gets for a catalog id (optionally tagged with a run's execution id). */
export function bridgeBaseUrl(catalogId, { tag } = {}) {
  const { port } = ensureBridgeSync();
  const t = tag ? `/r/${encodeURIComponent(String(tag))}` : '';
  return `http://127.0.0.1:${port}/m/${encodeURIComponent(catalogId)}${t}`;
}

/** Whether the bridge is up (listening or about to). */
export function bridgeRunning() { return !!(state && state.server); }
export function bridgePort() { return state ? state.port : 0; }

/** Stop the bridge (tests, shutdown). */
export async function stopBridge() {
  if (!state || !state.server) { state = null; return; }
  const s = state.server;
  state = null;
  await new Promise((r) => { try { s.closeAllConnections?.(); } catch { /* n/a */ } s.close(() => r()); });
}

// ── request handling ─────────────────────────────────────────────────────────

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { code: 'TOO_LARGE' })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj, headers) {
  if (res.headersSent) { res.end(); return; }
  res.writeHead(status, { 'content-type': 'application/json', ...(headers || {}) });
  res.end(JSON.stringify(obj));
}

function authorized(req) {
  const h = req.headers;
  const bearer = typeof h.authorization === 'string' && /^bearer\s+/i.test(h.authorization) ? h.authorization.replace(/^bearer\s+/i, '').trim() : '';
  const key = typeof h['x-api-key'] === 'string' ? h['x-api-key'].trim() : '';
  return (bearer && bearer === state.secret) || (key && key === state.secret);
}

async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const m = ROUTE_RE.exec(url.pathname);
  if (!m) { const e = bridgeErrors.notFound(); return sendJson(res, e.status, e.body); }
  if (!authorized(req)) { const e = bridgeErrors.unauthorized(); return sendJson(res, e.status, e.body); }
  const catalogId = decodeURIComponent(m[1]);
  const tag = m[2] ? decodeURIComponent(m[2]) : '';
  const route = m[3];
  const entry = findBridgedEntry(catalogId);
  if (!entry) { const e = bridgeErrors.unknownModel(catalogId); return sendJson(res, e.status, e.body); }

  if (route === 'models') {
    return sendJson(res, 200, { data: [{ id: entry.id, type: 'model', display_name: entry.label, created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: entry.id, last_id: entry.id });
  }
  if (req.method !== 'POST') { const e = bridgeErrors.notFound(); return sendJson(res, e.status, e.body); }

  let text;
  try {
    text = await readBody(req, PAYLOAD_CEILING_BYTES + 1024);
  } catch (err) {
    const e = err && err.code === 'TOO_LARGE' ? bridgeErrors.tooLarge() : bridgeErrors.badJson();
    return sendJson(res, e.status, e.body);
  }
  let body;
  try { body = JSON.parse(text); } catch { const e = bridgeErrors.badJson(); return sendJson(res, e.status, e.body); }
  if (!body || typeof body !== 'object') { const e = bridgeErrors.badJson(); return sendJson(res, e.status, e.body); }

  if (route === 'messages/count_tokens') {
    return sendJson(res, 200, { input_tokens: estimateInputTokens(body) });
  }

  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ctrl.abort(); });
  const reply = {
    status: (code, headers) => { if (!res.headersSent) res.writeHead(code, headers || {}); },
    write: (chunk) => { if (!res.destroyed) res.write(chunk); },
    end: () => { if (!res.destroyed) res.end(); },
    json: (code, obj, headers) => sendJson(res, code, obj, headers),
  };
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k.toLowerCase()] = v;
  await handleMessages({ entry, body, requestHeaders: headers, tag, signal: ctrl.signal, fetch: state.fetch, log: state.log }, reply);
}
