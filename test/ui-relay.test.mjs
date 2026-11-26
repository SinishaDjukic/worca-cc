// test/ui-relay.test.mjs
// The hardened box's UI relay (src/core/ui-relay.mjs) and how Worca trusts it (src/core/remote-access.mjs
// watchRelayPeers, createPeerGuard). Real sockets on loopback; name lookups are stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createUiRelay, parseTarget, resolveAll } from '../src/core/ui-relay.mjs';
import { createPeerGuard, watchRelayPeers, readRemoteAccessConfig } from '../src/core/remote-access.mjs';
import { readServerSource } from '../src/core/read-server-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const close = (srv) => new Promise((r) => srv.close(() => r()));

/** Send `msg`, read until the peer closes. */
function roundTrip(port, msg) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    let got = '';
    s.on('connect', () => s.write(msg));
    s.on('data', (d) => { got += d; s.end(); });
    s.on('close', () => resolve(got));
    s.on('error', () => resolve(got));
  });
}

test('parseTarget and resolveAll', async () => {
  assert.deepEqual(parseTarget('worca:4317'), { host: 'worca', port: 4317 });
  assert.deepEqual(parseTarget('[::1]:80'), { host: '::1', port: 80 });
  assert.equal(parseTarget('worca'), null);
  assert.equal(parseTarget('worca:0'), null);
  const got = await resolveAll(['worca', 'gone'], async (h) => { if (h === 'gone') throw new Error('ENOTFOUND'); return [{ address: '::ffff:172.30.0.4' }]; });
  assert.deepEqual([...got], ['172.30.0.4']);
});

test('the relay pipes a caller to Worca, and refuses an address of worca or egress', async () => {
  const target = net.createServer((c) => c.on('data', (d) => c.end(`echo:${d}`)));
  const tport = await listen(target);
  const open = createUiRelay({ target: { host: '127.0.0.1', port: tport }, refuse: ['worca', 'egress'], lookup: async () => [{ address: '172.30.0.9' }] });
  const shut = createUiRelay({ target: { host: '127.0.0.1', port: tport }, refuse: ['worca'], lookup: async () => [{ address: '127.0.0.1' }] });
  const logs = [];
  const shutLogged = createUiRelay({ target: { host: '127.0.0.1', port: tport }, refuse: ['worca'], lookup: async () => [{ address: '::ffff:127.0.0.1' }], log: (l) => logs.push(l) });
  try {
    assert.equal(await roundTrip(await listen(open), 'GET'), 'echo:GET');
    assert.equal(await roundTrip(await listen(shut), 'GET'), '', 'an agent\'s address gets nothing');
    assert.equal(await roundTrip(await listen(shutLogged), 'GET'), '');
    assert.match(logs[0], /refused 127\.0\.0\.1/);
  } finally { await Promise.all([close(target), close(open), close(shut), close(shutLogged)]); }
});

test('Worca trusts the relay\'s address as a local caller, in local mode only', async () => {
  const relays = watchRelayPeers({ WORCA_UI_RELAY: 'ui' }, { lookup: async () => [{ address: '172.30.0.5' }], intervalMs: 60_000 });
  await relays.refresh();
  try {
    const guard = createPeerGuard(readRemoteAccessConfig({}), { gateways: [], relays });
    assert.equal(guard({ socket: { remoteAddress: '::ffff:172.30.0.5' } }), true);
    assert.equal(guard({ socket: { remoteAddress: '172.30.0.6' } }), false, 'another container on the network is not the relay');
    assert.equal(guard({ socket: { remoteAddress: '127.0.0.1' } }), true);
    const none = watchRelayPeers({});
    assert.equal(none.has('172.30.0.5'), false, 'no WORCA_UI_RELAY: nothing trusted');
    assert.equal(createPeerGuard(readRemoteAccessConfig({}))({ socket: { remoteAddress: '172.30.0.5' } }), false);
  } finally { relays.stop(); }
});

test('the image installs the relay and labels the hardened box; the server wires the relay in', () => {
  const df = readFileSync(join(ROOT, 'docker', 'Dockerfile'), 'utf8');
  assert.match(df, /install -m 755 "\$\{app\}\/src\/core\/ui-relay\.mjs" \/usr\/local\/lib\/worca-ui-relay\.mjs/);
  assert.match(df, /dev\.worca\.hardened-box="1"/);
  const server = readServerSource();
  assert.match(server, /relays: watchRelayPeers\(DEPLOYMENT === 'container' && !REMOTE_MODE \? process\.env : \{\}\)/);
  const relay = readFileSync(join(ROOT, 'src', 'core', 'ui-relay.mjs'), 'utf8');
  for (const m of relay.matchAll(/^import .* from '([^']+)';$/gm)) assert.match(m[1], /^node:/, 'standalone: node: modules only');
});
