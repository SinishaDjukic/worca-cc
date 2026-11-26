#!/usr/bin/env node
// src/core/ui-relay.mjs — the hardened box's UI relay (docker/compose.hardened.yml, docs/hardened-box.md).
//
// Why it exists: in the hardened box Worca sits on an internal network with no route out (compose.egress.yml).
// Docker publishes no port for a container that is only on an internal network, so the UI port is published by
// this relay instead. It runs on the default network and the internal one, takes the published port and relays each
// TCP connection to worca:4317. Worca trusts the relay's address as a local caller (WORCA_UI_RELAY on the worca
// service; src/core/remote-access.mjs watchRelayPeers), the way it trusts Docker's gateway in the plain container.
//
// Who gets through: an allow-list, fail closed. A connection is relayed only when its socket peer is one Worca's own
// single-user rule admits (createPeerGuard in local mode, docs/docker.md "Network"): a loopback peer inside this
// container (the image's healthcheck), or the gateway of this container's default route, which is where Docker's
// published port arrives from. Every other peer is closed before a byte is relayed: an agent in Worca's container,
// the egress sidecar, any other container. No header and no name lookup decides it. When this container has no
// default-route gateway, the relay does not start (exit 78) rather than guess.
//
//   WORCA_UI_RELAY_PORT     listen port (default 4317)
//   WORCA_UI_RELAY_TARGET   host:port to relay to (default worca:4317)
//
// The image runs this file from the installed package (it imports remote-access.mjs for the peer rule).

import net from 'node:net';
import process from 'node:process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createPeerGuard, readRemoteAccessConfig, readRouteGateways } from './remote-access.mjs';

/** `host:port` (or `[v6]:port`) into { host, port }; null when it is not one. */
export function parseTarget(s) {
  const m = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(String(s || '').trim());
  if (!m) return null;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { host: m[1], port } : null;
}

/**
 * The admission rule: Worca's own local-mode peer guard over this container's default-route gateways.
 * @param {() => string[]} gateways  readRouteGateways by default; an empty list or a throw is an error, never "admit all"
 * @returns {{allow: (addr: string) => boolean, gateways: string[]} | {error: string}}
 */
export function relayPeerRule(gateways = () => readRouteGateways()) {
  let list;
  try { list = gateways(); } catch (e) { return { error: `cannot read this container's routes (${e && e.message ? e.message : e})` }; }
  if (!Array.isArray(list) || !list.length) return { error: 'this container has no default-route gateway, so the published-port peer is unknown' };
  const guard = createPeerGuard(readRemoteAccessConfig({}), { gateways: list });
  return { allow: (addr) => !!addr && guard({ socket: { remoteAddress: addr } }), gateways: list };
}

/**
 * The relay server: a peer `allow` admits is piped to `target`; every other connection is closed at once.
 * @param {{target: {host: string, port: number}, allow: (addr: string) => boolean, log?: (l: string) => void}} o
 */
export function createUiRelay({ target, allow, log = () => {} }) {
  if (typeof allow !== 'function') throw new TypeError('createUiRelay needs an allow rule');
  return net.createServer({ pauseOnConnect: true }, (client) => {
    client.on('error', () => client.destroy());
    const peer = client.remoteAddress;
    let ok = false;
    try { ok = allow(peer) === true; } catch { ok = false; }
    if (!ok) {
      log(`ui-relay: refused ${peer || 'a caller without an address'} (not this container's published-port gateway)`);
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
  if (!target || !Number.isInteger(port) || port <= 0 || port > 65535) {
    process.stderr.write('ui-relay: WORCA_UI_RELAY_PORT and WORCA_UI_RELAY_TARGET (host:port) must be valid\n');
    process.exit(78);
  }
  const rule = relayPeerRule();
  if (rule.error) {
    process.stderr.write(`ui-relay: ${rule.error}; not relaying. The ui service must be on the default network (docker/compose.hardened.yml).\n`);
    process.exit(78);
  }
  const server = createUiRelay({ target, allow: rule.allow, log: (l) => process.stderr.write(`${l}\n`) });
  server.listen(port, '0.0.0.0', () => process.stdout.write(`ui-relay: :${port} -> ${target.host}:${target.port}; admits loopback and ${rule.gateways.join(', ')} only\n`));
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => server.close(() => process.exit(0)));
}
