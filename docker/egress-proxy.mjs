#!/usr/bin/env node
// docker/egress-proxy.mjs — the egress-allowlist sidecar (plans/container-isolation-design.md §8.3).
//
// A forward proxy (HTTP CONNECT + plain HTTP) that only relays to hosts on an
// allowlist. Runs from the Worca image itself (no extra image), on both the
// internal network the worca service is confined to and the default network.
// Anything in the worca container that ignores HTTPS_PROXY cannot reach the
// internet at all: the internal network has no route out.
//
//   WORCA_EGRESS_ALLOW   comma-separated hostnames; a leading "." allows every
//                        subdomain (".github.com" -> api.github.com, objects...).
//   WORCA_EGRESS_PORT    listen port (default 3128)
//
// Dependency-free: node:http + node:net only, so it runs in the slim image.
// The pure parts are exported for test/docker-files.test.mjs; the server only
// starts when this file is the entry point.

import http from 'node:http';
import net from 'node:net';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const DEFAULT_ALLOW = Object.freeze([
  'api.anthropic.com',
  'github.com', '.github.com', '.githubusercontent.com',
  'registry.npmjs.org',
]);

/** "a.com, .b.org" -> ['a.com', '.b.org'] (lower-cased, blanks dropped). Empty -> the default list. */
export function parseAllow(str) {
  const list = String(str ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : [...DEFAULT_ALLOW];
}

/** Exact match, or subdomain match for entries with a leading dot (".x.com" also allows "x.com"). */
export function isAllowed(host, allow) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  return allow.some((a) => (a.startsWith('.') ? h === a.slice(1) || h.endsWith(a) : h === a));
}

/** Build (not start) the proxy server. `log` receives one line per decision. */
export function createProxy({ allow, log = () => {} }) {
  const verdict = (ok, method, target) => log(`${new Date().toISOString()} ${ok ? 'ALLOW' : 'DENY'} ${method} ${target}`);

  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url); } catch { res.writeHead(400).end(); return; }
    if (!isAllowed(url.hostname, allow)) {
      verdict(false, req.method, url.host);
      res.writeHead(403, { 'content-type': 'text/plain' }).end(`egress denied: ${url.host}\n`);
      return;
    }
    verdict(true, req.method, url.host);
    const up = http.request(
      { host: url.hostname, port: url.port || 80, method: req.method, path: url.pathname + url.search, headers: req.headers },
      (ur) => { res.writeHead(ur.statusCode, ur.headers); ur.pipe(res); },
    );
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  });

  // A client that resets the connection (curl after a 403, an aborted tunnel)
  // raises 'error' on its socket; without a listener that is an uncaught
  // exception and the sidecar dies. Attach it before any decision.
  server.on('clientError', (_err, socket) => socket.destroy());
  server.on('connect', (req, clientSocket, head) => {
    clientSocket.on('error', () => clientSocket.destroy());
    const [host, portStr] = String(req.url).split(':');
    const port = Number(portStr) || 443;
    if (!isAllowed(host, allow)) {
      verdict(false, 'CONNECT', req.url);
      clientSocket.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\negress denied: ${host}\n`);
      return;
    }
    verdict(true, 'CONNECT', req.url);
    const up = net.connect(port, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) up.write(head);
      up.pipe(clientSocket);
      clientSocket.pipe(up);
    });
    up.on('error', () => clientSocket.destroy());
    clientSocket.on('close', () => up.destroy());
  });

  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.WORCA_EGRESS_PORT) || 3128;
  const allow = parseAllow(process.env.WORCA_EGRESS_ALLOW);
  const server = createProxy({ allow, log: (line) => process.stdout.write(line + '\n') });
  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`worca-egress-proxy listening on :${port}; allow = ${allow.join(', ')}\n`);
  });
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
}
