// test/api-local-peer-guard.test.mjs
// G4: in local mode the Host guard compares header text only, so a server bound to a non-loopback
// address (WORCA_HOST=0.0.0.0) answered a network caller that simply sent `Host: localhost`, terminal
// included. Local mode now also needs a loopback TCP peer (or, in the worca image, Docker's gateway).
// Booted as a child on 0.0.0.0 and called through this machine's own non-loopback address, whose TCP
// peer is that address: the same position as a LAN caller.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'server.mjs');
const LAN = Object.values(os.networkInterfaces()).flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const skip = LAN ? false : 'no non-loopback IPv4 interface on this machine';

const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => r(p)); }); });

let child, port, home, out = '';
before(async () => {
  if (skip) return;
  port = await freePort();
  home = mkdtempSync(join(os.tmpdir(), 'worca-peer-guard-'));
  const base = Object.fromEntries(Object.entries(process.env)
    .filter(([k]) => !/^WORCA_(ALLOWED_HOSTS|CF_ACCESS_|IDENTITY_|INSECURE_NO_IDENTITY_CHECK|CONTAINER|DATA_DIR)/.test(k)));
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    env: { ...base, WORCA_MOCK: '1', WORCA_HOME: home, HOME: home, PORT: String(port), WORCA_HOST: '0.0.0.0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 20_000);
    const onData = (c) => { out += c; if (/\] listening on /.test(out)) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}:\n${out}`)); });
  });
});
after(() => {
  if (child && child.exitCode === null) child.kill('SIGKILL');
  if (home) rmSync(home, { recursive: true, force: true });
});

const get = (addr, path, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: addr, port, path, headers }, (res) => {
    let body = ''; res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject);
});

const wsStatus = (addr) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://${addr}:${port}/ws`, { headers: { host: `localhost:${port}` } });
  ws.on('open', () => { ws.close(); resolve('open'); });
  ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
  ws.on('error', () => resolve('error'));
});

test('boot warning says a non-loopback bind answers loopback callers only', { skip }, () => {
  assert.match(out, /listening on 0\.0\.0\.0 but WORCA_ALLOWED_HOSTS is empty: only connections from this machine/);
});

test('a loopback caller still gets the API', { skip }, async () => {
  const r = await get('127.0.0.1', '/api/settings', { host: `localhost:${port}` });
  assert.equal(r.status, 200);
});

test('a network caller spoofing Host: localhost is refused, terminal included', { skip }, async () => {
  for (const path of ['/api/settings', '/api/terminal']) {
    const r = await get(LAN, path, { host: `localhost:${port}` });
    assert.equal(r.status, 403, `${path}: ${r.body}`);
  }
});

test('a network caller spoofing Host: localhost cannot open the WebSocket', { skip }, async () => {
  assert.equal(await wsStatus('127.0.0.1'), 'open');
  assert.equal(await wsStatus(LAN), 403);
});

test('a network caller spoofing Host: localhost cannot reach the extension pairing route', { skip }, async () => {
  const r = await get(LAN, '/api/extension/hello', { host: `localhost:${port}`, 'x-worca-extension': 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' });
  assert.equal(r.status, 403, r.body);
});
