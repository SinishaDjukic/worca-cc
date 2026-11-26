#!/usr/bin/env node
// src/core/ui-relay.mjs — the hardened box's UI relay (docker/compose.hardened.yml, docs/hardened-box.md).
//
// In the hardened box Worca sits on an internal network with no route out (compose.egress.yml). Docker
// publishes no port for a container that is only on an internal network, so the UI port is published by
// this relay instead: it runs on the default network and the internal one, takes the published port and
// relays each TCP connection to worca:4317. Worca trusts the relay's address as a local caller
// (WORCA_UI_RELAY on the worca service; src/core/remote-access.mjs watchRelayPeers), the way it trusts
// Docker's gateway in the plain container.
//
// The relay must never become a way back in for an agent: agents run inside the worca container (and
// reach the outside through the egress sidecar), so a connection from any address of the hosts in
// WORCA_UI_RELAY_REFUSE (default: worca, egress) is closed before anything is relayed.
//
//   WORCA_UI_RELAY_PORT     listen port (default 4317)
//   WORCA_UI_RELAY_TARGET   host:port to relay to (default worca:4317)
//   WORCA_UI_RELAY_REFUSE   comma-separated hosts whose addresses are refused (default worca,egress)
//
// Dependency-free (node:net and node:dns only): the image installs this one file as
// /usr/local/lib/worca-ui-relay.mjs and runs it on its own.

import net from 'node:net';
import dns from 'node:dns';
import process from 'node:process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const unmap = (a) => String(a || '').replace(/^::ffff:/i, '').toLowerCase();

/** `host:port` (or `[v6]:port`) into { host, port }; null when it is not one. */
export function parseTarget(s) {
  const m = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(String(s || '').trim());
  if (!m) return null;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { host: m[1], port } : null;
}

/** The addresses of `hosts` right now (a host that does not resolve adds none). */
export async function resolveAll(hosts, lookup = dns.promises.lookup) {
  const out = new Set();
  await Promise.all(hosts.map(async (h) => {
    try { for (const r of await lookup(h, { all: true })) out.add(unmap(r.address)); } catch { /* not up yet */ }
  }));
  return out;
}

/**
 * The relay server. Every connection: refuse a peer that is one of `refuse`'s addresses, else pipe it to `target`.
 * @param {{target: {host: string, port: number}, refuse: string[], lookup?: Function, log?: (l: string) => void}} o
 */
export function createUiRelay({ target, refuse = ['worca', 'egress'], lookup = dns.promises.lookup, log = () => {} }) {
  return net.createServer({ pauseOnConnect: true }, async (client) => {
    client.on('error', () => client.destroy());
    const peer = unmap(client.remoteAddress);
    const refused = await resolveAll(refuse, lookup);
    if (!peer || refused.has(peer)) {
      log(`ui-relay: refused ${peer || 'a caller without an address'} (an address of ${refuse.join(', ')})`);
      client.destroy();
      return;
    }
    const up = net.connect(target.port, target.host);
    up.on('error', () => { up.destroy(); client.destroy(); });
    client.on('close', () => up.destroy());
    up.on('close', () => client.destroy());
    up.on('connect', () => { client.pipe(up); up.pipe(client); client.resume(); });
  });
}

function isEntry() {
  try { return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
}

if (isEntry()) {
  const port = Number(process.env.WORCA_UI_RELAY_PORT || 4317);
  const target = parseTarget(process.env.WORCA_UI_RELAY_TARGET || 'worca:4317');
  const refuse = String(process.env.WORCA_UI_RELAY_REFUSE ?? 'worca,egress').split(',').map((s) => s.trim()).filter(Boolean);
  if (!target || !Number.isInteger(port) || port <= 0 || port > 65535) {
    process.stderr.write('ui-relay: WORCA_UI_RELAY_PORT and WORCA_UI_RELAY_TARGET (host:port) must be valid\n');
    process.exit(78);
  }
  const server = createUiRelay({ target, refuse, log: (l) => process.stderr.write(`${l}\n`) });
  server.listen(port, '0.0.0.0', () => process.stdout.write(`ui-relay: :${port} -> ${target.host}:${target.port}; refused: ${refuse.join(', ') || 'none'}\n`));
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => server.close(() => process.exit(0)));
}
