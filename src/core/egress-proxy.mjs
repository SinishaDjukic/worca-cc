#!/usr/bin/env node
// src/core/egress-proxy.mjs — the outbound network policy proxy.
//
// A forward proxy (HTTP CONNECT + plain HTTP) that relays only to hosts the policy allows. It
// serves two setups from one file:
//
// 1. The Docker egress overlay (docker/compose.egress.yml, plans/container-isolation-design.md
//    §8.3). The image copies this file to /usr/local/lib/worca-egress-proxy.mjs and the `egress`
//    sidecar runs it on both the internal network worca is confined to and the default network.
//    Anything in the worca container that ignores HTTPS_PROXY cannot reach the internet at all:
//    the internal network has no route out.
//
//      WORCA_EGRESS_ALLOW   comma-separated hostnames; a leading "." allows every subdomain
//                           (".github.com" -> api.github.com, ...) and the name itself.
//                           Empty -> DEFAULT_ALLOW.
//      WORCA_EGRESS_PORT    listen port (default 3128)
//
// 2. A hosting platform's per-instance policy (WORCA_EGRESS_MODE set). worca itself starts this
//    proxy on loopback and points every child process at it (src/core/egress-policy.mjs). There
//    is no internal network there, so a tool that ignores the proxy variables is not covered.
//
//      WORCA_EGRESS_MODE    open | block | allow. Anything else fails closed as `allow`.
//      WORCA_EGRESS_ALLOW   read in `allow` mode only; DEFAULT_ALLOW never applies.
//      WORCA_EGRESS_DENY    always wins. ".invalid" is the platform's "nothing listed".
//      Under a mode, ".example.com" means the subdomains only, not example.com itself.
//
// Dependency-free (node:http + node:net only): the image runs this one file on its own, outside
// the package. The pure parts are exported for the tests; the server only starts when this file
// is the entry point.

import http from 'node:http';
import net from 'node:net';
import process from 'node:process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULT_ALLOW = Object.freeze([
  'api.anthropic.com',
  'github.com', '.github.com', '.githubusercontent.com',
  'registry.npmjs.org',
]);

export const EGRESS_MODES = Object.freeze(['open', 'block', 'allow']);

/** A host as the policy compares it: lower case, no IPv6 brackets, no trailing dot. */
export function normalizeHost(host) {
  let h = String(host ?? '').trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  return h.replace(/\.+$/, '');
}

/** "host", "host:443", "[::1]:443" -> { host, port } (port null when absent). */
export function splitHostPort(target) {
  const s = String(target ?? '').trim();
  const v6 = /^\[([^\]]*)\](?::(\d+))?$/.exec(s);
  if (v6) return { host: normalizeHost(v6[1]), port: v6[2] ? Number(v6[2]) : null };
  const m = /^([^:]*):(\d+)$/.exec(s);
  if (m) return { host: normalizeHost(m[1]), port: Number(m[2]) };
  return { host: normalizeHost(s), port: null };
}

/** One list entry: trimmed, lower case, port and trailing dot dropped (".x.com." -> ".x.com"). */
function normalizeEntry(entry) {
  const raw = String(entry ?? '').trim();
  if (!raw) return '';
  const dot = raw.startsWith('.');
  const host = splitHostPort(dot ? raw.slice(1) : raw).host;
  return host ? (dot ? `.${host}` : host) : '';
}

/** "a.com, .B.org ,," -> ['a.com', '.b.org'] (normalised, blanks and duplicates dropped). */
export function parseHostList(str) {
  const out = [];
  for (const part of String(str ?? '').split(',')) {
    const e = normalizeEntry(part);
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

/** The overlay's list: parseHostList, and an empty value means DEFAULT_ALLOW. */
export function parseAllow(str) {
  const list = parseHostList(str);
  return list.length ? list : [...DEFAULT_ALLOW];
}

/**
 * Does `host` match `entry`? An exact entry matches that host only. A leading-dot entry matches
 * every subdomain, and the name itself too unless `subdomainsOnly` (the platform's contract).
 */
export function hostMatches(host, entry, { subdomainsOnly = false } = {}) {
  const h = normalizeHost(host);
  const e = String(entry || '');
  if (!h || !e) return false;
  if (!e.startsWith('.')) return h === e;
  return h.endsWith(e) || (!subdomainsOnly && h === e.slice(1));
}

/** The overlay's check: any entry matches, ".x.com" also allowing "x.com". */
export function isAllowed(host, allow) {
  return (allow || []).some((a) => hostMatches(host, a));
}

/**
 * The policy in `env`.
 *   enforced: false              no WORCA_EGRESS_MODE (or `open`): no proxy, nothing changes.
 *   mode: 'block'                everything except deny.
 *   mode: 'allow'                only allow, minus deny. An unknown mode lands here (invalidMode).
 * @returns {{mode: 'open'|'block'|'allow', enforced: boolean, allow: string[], deny: string[], invalidMode?: string}}
 */
export function readEgressPolicy(env = process.env) {
  const raw = String(env.WORCA_EGRESS_MODE ?? '').trim();
  const allow = parseHostList(env.WORCA_EGRESS_ALLOW);
  const deny = parseHostList(env.WORCA_EGRESS_DENY);
  if (!raw) return { mode: 'open', enforced: false, allow, deny };
  const m = raw.toLowerCase();
  if (m === 'open') return { mode: 'open', enforced: false, allow, deny };
  if (m === 'block') return { mode: 'block', enforced: true, allow, deny };
  if (m === 'allow') return { mode: 'allow', enforced: true, allow, deny };
  return { mode: 'allow', enforced: true, allow, deny, invalidMode: raw };
}

/**
 * Is `host` allowed under `policy`? DENY wins over ALLOW. Ports never matter.
 * @param {string} host
 * @param {{mode: string, allow: string[], deny?: string[]}} policy
 * @returns {{ok: boolean, rule: 'deny'|'allow'|'not-allowed'|'open'}}
 */
export function decide(host, policy) {
  const h = normalizeHost(host);
  if (!h) return { ok: false, rule: 'not-allowed' };
  const opts = { subdomainsOnly: true };
  if ((policy.deny || []).some((e) => hostMatches(h, e, opts))) return { ok: false, rule: 'deny' };
  if (policy.mode === 'open' || policy.mode === 'block') return { ok: true, rule: 'open' };
  if ((policy.allow || []).some((e) => hostMatches(h, e, opts))) return { ok: true, rule: 'allow' };
  return { ok: false, rule: 'not-allowed' };
}

/** The 403 body an agent sees for a refused host. */
export function refusalText(host, policy) {
  if (!policy) return `egress denied: ${host}\n`;
  const why = policy.mode === 'block' || (policy.deny || []).some((e) => hostMatches(host, e, { subdomainsOnly: true }))
    ? 'it is on the blocklist'
    : 'it is not on the allowlist';
  return `worca: outbound connection to ${host} refused: your organization's outbound network policy `
    + `blocks this host (${why}). Ask an administrator to change the policy if this host is needed.\n`;
}

/**
 * Build (not start) the proxy server. `log` receives one line per decision.
 * @param {{allow?: string[], policy?: {mode: string, allow: string[], deny: string[]}, log?: (line: string) => void}} opts
 *   `policy` (a platform mode) or `allow` (the overlay's list, legacy matching).
 */
export function createProxy({ allow, policy = null, log = () => {} }) {
  const permits = policy ? (host) => decide(host, policy).ok : (host) => isAllowed(host, allow);
  const verdict = (ok, method, target) => log(`${new Date().toISOString()} ${ok ? 'ALLOW' : 'DENY'} ${method} ${target}`);
  const refusal = (host) => {
    const body = refusalText(host, policy);
    return { body, headers: { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body), 'x-worca-egress': 'denied' } };
  };

  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url); } catch { res.writeHead(400).end(); return; }
    const host = normalizeHost(url.hostname);
    if (!permits(host)) {
      verdict(false, req.method, url.host);
      const r = refusal(host);
      res.writeHead(403, r.headers).end(r.body);
      return;
    }
    verdict(true, req.method, url.host);
    const up = http.request(
      { host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || 80, method: req.method, path: url.pathname + url.search, headers: req.headers },
      (ur) => { res.writeHead(ur.statusCode, ur.headers); ur.pipe(res); },
    );
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  });

  // A client that resets the connection (curl after a 403, an aborted tunnel)
  // raises 'error' on its socket; without a listener that is an uncaught
  // exception and the proxy dies. Attach it before any decision.
  server.on('clientError', (_err, socket) => socket.destroy());
  server.on('connect', (req, clientSocket, head) => {
    clientSocket.on('error', () => clientSocket.destroy());
    const { host, port: p } = splitHostPort(req.url);
    const port = p || 443;
    if (!permits(host)) {
      verdict(false, 'CONNECT', req.url);
      const r = refusal(host);
      const lines = Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      clientSocket.end(`HTTP/1.1 403 Forbidden\r\n${lines}\r\n\r\n${r.body}`);
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

// The image runs a copy of this file (/usr/local/lib/worca-egress-proxy.mjs); compare real paths
// so a symlinked entry point still counts.
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
}

if (isEntryPoint()) {
  const port = Number(process.env.WORCA_EGRESS_PORT) || 3128;
  const policy = readEgressPolicy(process.env);
  // The sidecar keeps its overlay meaning unless a platform mode is set; `open` relays everything.
  const opts = String(process.env.WORCA_EGRESS_MODE ?? '').trim()
    ? { policy }
    : { allow: parseAllow(process.env.WORCA_EGRESS_ALLOW) };
  const server = createProxy({ ...opts, log: (line) => process.stdout.write(line + '\n') });
  server.listen(port, '0.0.0.0', () => {
    const what = opts.policy
      ? `mode = ${policy.mode}; allow = ${policy.mode === 'allow' ? policy.allow.join(', ') : '(any)'}; deny = ${policy.deny.join(', ') || '(none)'}`
      : `allow = ${opts.allow.join(', ')}`;
    process.stdout.write(`worca-egress-proxy listening on :${port}; ${what}\n`);
  });
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
}
