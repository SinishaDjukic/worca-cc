// test/ui-relay.test.mjs
// The hardened box's UI relay (src/core/ui-relay.mjs) and how Worca trusts it (src/core/remote-access.mjs
// watchRelayPeers, createPeerGuard). Real sockets on loopback; name lookups are stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createUiRelay, parseTarget, relayPeerRule } from '../src/core/ui-relay.mjs';
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

test('parseTarget', () => {
  assert.deepEqual(parseTarget('worca:4317'), { host: 'worca', port: 4317 });
  assert.deepEqual(parseTarget('[::1]:80'), { host: '::1', port: 80 });
  assert.equal(parseTarget('worca'), null);
  assert.equal(parseTarget('worca:0'), null);
});

test('the relay admits only the published-port gateway (and its own loopback), fail closed', () => {
  const rule = relayPeerRule(() => ['172.30.1.1']);
  assert.equal(rule.error, undefined);
  assert.equal(rule.allow('172.30.1.1'), true, 'the default-route gateway: where the published port arrives');
  assert.equal(rule.allow('::ffff:172.30.1.1'), true);
  assert.equal(rule.allow('127.0.0.1'), true, 'the image healthcheck inside the relay container');
  for (const peer of ['172.30.0.3', '172.30.1.4', '10.0.0.1', '', undefined, null]) assert.equal(rule.allow(peer), false, `unknown peer ${peer} is refused`);
  // No gateway, or routes that cannot be read: no rule at all, never "admit everyone".
  assert.match(relayPeerRule(() => []).error, /no default-route gateway/);
  assert.match(relayPeerRule(() => { throw new Error('ENOENT'); }).error, /cannot read this container's routes \(ENOENT\)/);
  assert.match(relayPeerRule(() => null).error, /no default-route gateway/);
  assert.throws(() => createUiRelay({ target: { host: '127.0.0.1', port: 1 } }), /needs an allow rule/);
});

test('on a socket: an admitted peer is piped to Worca; a refused one, or a rule that throws, gets nothing', async () => {
  const target = net.createServer((c) => c.on('data', (d) => c.end(`echo:${d}`)));
  const tport = await listen(target);
  const logs = [];
  const t = { host: '127.0.0.1', port: tport };
  const admitted = createUiRelay({ target: t, allow: relayPeerRule(() => ['172.30.1.1']).allow });
  const unknown = createUiRelay({ target: t, allow: (a) => a === '172.30.1.1', log: (l) => logs.push(l) });
  const broken = createUiRelay({ target: t, allow: () => { throw new Error('rule broke'); } });
  const truthy = createUiRelay({ target: t, allow: () => 'yes' });
  try {
    assert.equal(await roundTrip(await listen(admitted), 'GET'), 'echo:GET');
    assert.equal(await roundTrip(await listen(unknown), 'GET'), '', 'an unknown peer gets nothing');
    assert.match(logs[0], /refused (::ffff:)?127\.0\.0\.1 \(not this container's published-port gateway\)/);
    assert.equal(await roundTrip(await listen(broken), 'GET'), '', 'a throwing rule refuses');
    assert.equal(await roundTrip(await listen(truthy), 'GET'), '', 'only true admits');
  } finally { await Promise.all([close(target), close(admitted), close(unknown), close(broken), close(truthy)]); }
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

test('the image labels the hardened box; the relay reuses the server peer rule; the server wires the relay in', () => {
  const df = readFileSync(join(ROOT, 'docker', 'Dockerfile'), 'utf8');
  assert.match(df, /dev\.worca\.hardened-box="1"/);
  const server = readServerSource();
  assert.match(server, /relays: watchRelayPeers\(DEPLOYMENT === 'container' && !REMOTE_MODE \? process\.env : \{\}\)/);
  const relay = readFileSync(join(ROOT, 'src', 'core', 'ui-relay.mjs'), 'utf8');
  assert.match(relay, /import \{ createPeerGuard, readRemoteAccessConfig, readRouteGateways \} from '\.\/remote-access\.mjs';/, 'the same check as the server');
  assert.doesNotMatch(relay, /node:dns|lookup\(/, 'no name lookup decides who gets in');
});

