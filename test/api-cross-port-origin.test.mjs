// test/api-cross-port-origin.test.mjs
// G10: the Origin check compared hostnames only, so a page on another localhost port (any dev server,
// or one an agent starts) could open /ws and read every run's live stream, and send body-less POSTs.
// A browser Origin must now name this server exactly (host and port); callers that send no Origin
// (the CLI, curl, an editor extension in Node) are unchanged.
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
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => r(p)); }); });

let child, port, home, out = '';
before(async () => {
  port = await freePort();
  home = mkdtempSync(join(os.tmpdir(), 'worca-cross-port-'));
  const base = Object.fromEntries(Object.entries(process.env)
    .filter(([k]) => !/^WORCA_(ALLOWED_HOSTS|CF_ACCESS_|IDENTITY_|INSECURE_NO_IDENTITY_CHECK|CONTAINER|DATA_DIR|HOST$)/.test(k)));
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    env: { ...base, WORCA_MOCK: '1', WORCA_HOME: home, HOME: home, PORT: String(port) },
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

const request = (method, path, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method, path, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
    let body = ''; res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', reject);
  req.end();
});

/** 'hello' when the socket opened and got its first frame, else the refusal's status. */
const wsResult = (origin) => new Promise((resolve) => {
  const headers = { host: `localhost:${port}`, ...(origin ? { origin } : {}) };
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.type === 'hello') { ws.close(); resolve('hello'); } });
  ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
  ws.on('close', () => resolve('closed'));
  ws.on('error', () => resolve('error'));
});

test('a page on another localhost port cannot open the WebSocket', async () => {
  assert.equal(await wsResult('http://localhost:3000'), 403);
  assert.equal(await wsResult('http://127.0.0.1:3000'), 403);
  assert.equal(await wsResult(`http://127.0.0.1:${port}`), 403, 'another origin, even on the same port');
});

test("worca's own page and Origin-less clients (CLI, editor extensions) still get the stream", async () => {
  assert.equal(await wsResult(`http://localhost:${port}`), 'hello');
  assert.equal(await wsResult(`http://LOCALHOST:${port}`), 'hello', 'case-insensitive');
  assert.equal(await wsResult(null), 'hello');
});

test('a page on another localhost port cannot call the API, body-less POSTs included', async () => {
  for (const [method, path] of [['GET', '/api/settings'], ['POST', '/api/runs/nope/stop']]) {
    const r = await request(method, path, { origin: 'http://localhost:3000' });
    assert.equal(r.status, 403, `${method} ${path}: ${r.body}`);
  }
  assert.equal((await request('GET', '/api/settings', { origin: `http://localhost:${port}` })).status, 200);
  assert.equal((await request('GET', '/api/settings')).status, 200);
});
