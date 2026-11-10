// src/worker/relay-shim.mjs
// A chat's worca tools run on the controller: the MCP child a chat turn starts (ask/mcp-stdio.mjs
// in relay mode) POSTs each JSON-RPC line to `http://127.0.0.1:<port>/api/ask/relay` with the
// turn's token. On a worker that loopback is this shim: it forwards each line over the worker's
// socket as a `relay` frame and answers with the controller's `relay-result`. Same wire shape
// as the server's route, so the MCP child needs no change.
import http from 'node:http';

export const DEFAULT_RELAY_PORT = 4320;   // not 4318, the OTLP/HTTP port a telemetry sidecar or an instrumented CLI may use
const BODY_MAX = 4 * 1024 * 1024;
/** How long one relayed line may take to be answered: a chat tool call can run a script or wait on a run, so this is
 *  long; the socket's loss answers sooner when the controller is gone. WORCA_WORKER_RELAY_TIMEOUT_MS overrides it. */
const RELAY_TIMEOUT_MS = 15 * 60_000;

/**
 * @param {{ relay: (token: string, line: string) => Promise<{lines: string[]|null, error: string|null}>,
 *   port?: number, host?: string, log?: (msg: string) => void }} o
 * @returns {Promise<{ port: number, url: string, close: () => Promise<void> }>}
 */
export function startRelayShim({ relay, port = DEFAULT_RELAY_PORT, host = '127.0.0.1', timeoutMs = RELAY_TIMEOUT_MS, log = () => {} }) {
  const server = http.createServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST' || req.url !== '/api/ask/relay') return reply(404, { error: 'not found' });
    const token = String(req.headers['x-worca-relay'] || '');
    if (!token) return reply(401, { error: 'relay token required' });
    let size = 0; const chunks = [];
    let tooBig = false;
    // Over the limit: answer 413 and let the rest of the body drain (a destroy here would reset the socket before the
    // client reads the answer), then the connection closes.
    req.on('data', (c) => { size += c.length; if (tooBig) return; if (size > BODY_MAX) { tooBig = true; chunks.length = 0; res.setHeader('connection', 'close'); reply(413, { error: `body larger than ${BODY_MAX} bytes` }); return; } chunks.push(c); });
    req.on('end', async () => {
      if (tooBig) return;
      let line;
      try { ({ line } = JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { return reply(400, { error: 'bad json' }); }
      if (typeof line !== 'string') return reply(400, { error: 'line required' });
      try {
        const r = await relay(token, line, { timeoutMs });   // the relay itself gives up after timeoutMs and frees its slot
        if (r?.error) return reply(502, { error: r.error });
        return reply(200, { out: r?.lines ?? [] });
      } catch (err) {
        return reply(502, { error: err?.message || 'relay failed' });
      }
    });
  });
  server.on('clientError', (_err, socket) => socket.destroy());
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const p = server.address().port;
      log(`relay shim on http://${host}:${p}/api/ask/relay`);
      resolve({ port: p, url: `http://${host}:${p}/api/ask/relay`, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }) });
    });
  });
}
