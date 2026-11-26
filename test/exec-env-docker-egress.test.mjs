// test/exec-env-docker-egress.test.mjs — the Local sandbox (Docker) network (backends/docker-egress.mjs and the in-container
// relay docker-egress-relay.mjs): which addresses a sandbox may reach in open and allow mode, and the relay end to end —
// the in-container script run here as a local process, framing connections to the host-side policy proxy, which
// dials through a stand-in for Worca's local proxy (the corporate-login path). No Docker needed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { routeFor, addressRefusal, unmapAddress, sandboxPolicy, EgressRelay } from '../src/core/exec-env/backends/docker-egress.mjs';

const RELAY = fileURLToPath(new URL('../src/core/exec-env/docker-egress-relay.mjs', import.meta.url));
const own = new Set(['192.168.1.20']);
const lookupOf = (map) => async (h) => { if (!(h in map)) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); return map[h].map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 })); };

test('addresses: never this machine, loopback, link-local or multicast; private only in allow mode', () => {
  for (const a of ['127.0.0.1', '127.9.9.9', '0.0.0.0', '169.254.169.254', '224.0.0.1', '::1', '::', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1']) {
    assert.ok(addressRefusal(a, 'allow', own), a);
  }
  assert.match(addressRefusal('192.168.1.20', 'allow', own), /this machine/);
  for (const a of ['10.1.2.3', '172.16.0.1', '192.168.65.254', '100.64.0.1', 'fd00::1']) {
    assert.match(addressRefusal(a, 'open', own), /private network/, a);
    assert.equal(addressRefusal(a, 'allow', own), null, a);
  }
  assert.equal(addressRefusal('93.184.216.34', 'open', own), null);
  assert.equal(addressRefusal('2606:4700::1', 'open', own), null);
  assert.equal(unmapAddress('::ffff:c0a8:0101'), '192.168.1.1');
});

test('routeFor: a name is resolved and every address checked; host names of this machine are refused before any lookup', async () => {
  const lookup = lookupOf({ 'pub.acme.example': ['93.184.216.34'], 'rebind.acme.example': ['93.184.216.34', '127.0.0.1'], 'lan.acme.example': ['10.0.0.5'] });
  assert.deepEqual(await routeFor('pub.acme.example', { env: {}, lookup, own }), { address: '93.184.216.34' });
  await assert.rejects(routeFor('rebind.acme.example', { env: {}, lookup, own }), (e) => e.status === 403 && /127\.0\.0\.1/.test(e.message));
  await assert.rejects(routeFor('lan.acme.example', { env: {}, lookup, own }), (e) => e.status === 403);
  assert.deepEqual(await routeFor('lan.acme.example', { mode: 'allow', env: {}, lookup, own }), { address: '10.0.0.5' });
  for (const h of ['localhost', 'a.localhost', 'host.docker.internal', 'gateway.docker.internal', 'host-gateway']) {
    await assert.rejects(routeFor(h, { mode: 'allow', env: {}, lookup: () => { throw new Error('no lookup'); }, own }), (e) => e.status === 403, h);
  }
  await assert.rejects(routeFor('[::1]', { env: {}, lookup, own }), (e) => e.status === 403);
  await assert.rejects(routeFor('nowhere.acme.example', { env: {}, lookup, own }), (e) => e.status === 502);
});

test('routeFor with a proxy in the server env: through it, credential-free; unresolvable names go to it by name', async () => {
  const env = { HTTPS_PROXY: 'http://127.0.0.1:3999', NO_PROXY: 'direct.acme.example' };
  const lookup = lookupOf({ 'pub.acme.example': ['93.184.216.34'], 'direct.acme.example': ['93.184.216.35'], 'evil.acme.example': ['127.0.0.1'] });
  assert.deepEqual(await routeFor('pub.acme.example', { env, lookup, own }), { proxy: 'http://127.0.0.1:3999' });
  assert.deepEqual(await routeFor('outside.example', { env, lookup, own }), { proxy: 'http://127.0.0.1:3999' }, 'the corporate proxy resolves what this machine cannot');
  assert.deepEqual(await routeFor('direct.acme.example', { env, lookup, own }), { address: '93.184.216.35' }, 'NO_PROXY goes direct');
  await assert.rejects(routeFor('evil.acme.example', { env, lookup, own }), (e) => e.status === 403, 'the address check comes before the proxy');
  // A login in the env's proxy URL is never used for a sandbox (env-proxy.mjs withoutProxyLogin): direct then.
  assert.deepEqual(await routeFor('pub.acme.example', { env: { HTTPS_PROXY: 'http://u:p@proxy.acme.example:8080' }, lookup, own }), { address: '93.184.216.34' });
});

test('sandboxPolicy: open, or the listed hosts (".x" is x and its subdomains) minus the deny list', () => {
  assert.deepEqual(sandboxPolicy(null), { mode: 'open', allow: [], deny: [] });
  assert.deepEqual(sandboxPolicy({ allowOut: ['.acme.example', 'a.b'], denyOut: ['x.acme.example'] }), { mode: 'allow', allow: ['.acme.example', 'acme.example', 'a.b'], deny: ['x.acme.example'] });
});

// ── end to end ──
const closers = []; after(async () => { for (const c of closers.reverse()) await c(); });
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

/** A stand-in for Worca's local proxy (which, with a corporate proxy, does the login): it answers every CONNECT by
 *  connecting to `echoPort` and records the targets it was asked for. */
async function fakeLocalProxy(echoPort) {
  const targets = [];
  const srv = http.createServer();
  srv.on('connect', (req, sock, head) => {
    targets.push(req.url);
    const up = net.connect(echoPort, '127.0.0.1', () => { sock.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head?.length) up.write(head); up.pipe(sock); sock.pipe(up); });
    up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
  });
  const port = await listen(srv);
  closers.push(() => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }));
  return { port, targets };
}

/** CONNECT through the in-container relay's port, then send `msg` and read the echo (or the refusal). */
function connectThrough(port, target, msg) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let buf = ''; let sent = false;
    s.setEncoding('utf8');
    s.on('data', (d) => {
      buf += d;
      if (!sent && /\r\n\r\n/.test(buf)) {
        if (!/^HTTP\/1\.1 200/.test(buf)) { s.destroy(); resolve({ status: Number(buf.split(' ')[1]), body: buf }); return; }
        sent = true; buf = ''; s.write(msg);
      } else if (sent && buf.length >= msg.length) { s.end(); resolve({ status: 200, echo: buf }); }
    });
    s.on('error', reject);
    s.on('close', () => { if (!sent) resolve({ status: Number(buf.split(' ')[1]) || 0, body: buf }); });
  });
}

test('the relay end to end: an allowed host is reached through the proxy, others are refused, and this machine is never reachable', { skip: process.platform === 'win32', timeout: 30_000 }, async () => {
  const echo = net.createServer((s) => s.pipe(s));
  const echoPort = await listen(echo);
  closers.push(() => new Promise((r) => echo.close(() => r())));
  const proxy = await fakeLocalProxy(echoPort);
  const lookup = lookupOf({ 'api.acme.example': ['93.184.216.34'], 'other.acme.example': ['93.184.216.35'], 'evil.acme.example': ['127.0.0.1'] });
  const logs = [];
  // `exec` is what the docker client hands it: here the in-container script runs as a plain local process, port 0.
  const relay = new EgressRelay({ network: { allowOut: ['api.acme.example'], denyOut: [] }, env: { HTTPS_PROXY: `http://127.0.0.1:${proxy.port}` }, lookup,
    log: (l) => logs.push(l), exec: async () => spawn(process.execPath, [RELAY, '0'], { stdio: ['pipe', 'pipe', 'pipe'] }) });
  await relay.start();
  closers.push(() => relay.stop());
  assert.ok(Number.isInteger(relay.port) && relay.port > 0);

  const ok = await connectThrough(relay.port, 'api.acme.example:443', 'hello through the relay');
  assert.equal(ok.status, 200, ok.body);
  assert.equal(ok.echo, 'hello through the relay');
  assert.deepEqual(proxy.targets, ['api.acme.example:443'], 'it went through the server env\'s proxy, by name');

  const notListed = await connectThrough(relay.port, 'other.acme.example:443', 'x');
  assert.equal(notListed.status, 403);
  assert.match(notListed.body, /not on the allowlist/);
  const loop = await connectThrough(relay.port, '127.0.0.1:4317', 'x');
  assert.equal(loop.status, 403, 'Worca\'s own server port is never reachable');
  assert.deepEqual(proxy.targets, ['api.acme.example:443'], 'refused targets never reached the proxy');
  assert.ok(logs.some((l) => /refused other\.acme\.example/.test(l)), logs.join('\n'));

  // Open mode: any public host, still never this machine.
  const open = new EgressRelay({ network: null, env: { HTTPS_PROXY: `http://127.0.0.1:${proxy.port}` }, lookup, exec: async () => spawn(process.execPath, [RELAY, '0'], { stdio: ['pipe', 'pipe', 'pipe'] }) });
  await open.start(); closers.push(() => open.stop());
  assert.equal((await connectThrough(open.port, 'other.acme.example:443', 'open')).echo, 'open');
  assert.equal((await connectThrough(open.port, 'evil.acme.example:443', 'x')).status, 403, 'a public name that resolves to loopback');

  // Stopping the host side ends the in-container relay (its stdin closes).
  const child = open.child;
  await open.stop();
  await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
});
