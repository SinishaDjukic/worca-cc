// test/ui-instance.test.mjs
// src/core/ui-instance.mjs: the instance file, the /api/health probe's three
// states (+ the legacy fallback), and stopUi's request path and signal fallback.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import {
  DEFAULT_UI_PORT, UI_HEALTH_NAME, uiInstanceFile, writeUiInstance, readUiInstance, removeUiInstance,
  probeUi, stopUi, uiUrl, urlHost, waitForUiState, newUiToken, callUi,
} from '../src/core/ui-instance.mjs';

useTempHome(after);

/** An ephemeral http server on 127.0.0.1; `handler(req, res)` answers everything. */
async function serve(handler) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const close = () => new Promise((r) => srv.close(r));
  return { srv, port, close };
}
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

/** A port nothing listens on (bind 0, read, release). */
async function freePort() {
  const { port, close } = await serve(() => {});
  await close();
  return port;
}

test('uiUrl/urlHost: loopback binds print as localhost, IPv6 literals get brackets', () => {
  assert.equal(uiUrl(), `http://localhost:${DEFAULT_UI_PORT}`);
  assert.equal(uiUrl({ host: '::1', port: 5 }), 'http://localhost:5');
  assert.equal(uiUrl({ host: '0.0.0.0', port: 5 }), 'http://0.0.0.0:5');
  assert.equal(urlHost('fe80::1'), '[fe80::1]');
});

test('instance file: write is 0600 + atomic, read normalises, remove honours ifPid', async () => {
  const file = uiInstanceFile();
  assert.equal(readUiInstance(), null, 'missing file reads as null');
  const token = newUiToken();
  await writeUiInstance({ pid: 4242, host: '127.0.0.1', port: '4317', token, version: '1.2.3', startedAt: 't' });
  assert.ok(existsSync(file));
  assert.ok(!existsSync(`${file}.4242.tmp`), 'tmp file renamed away');
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  const inst = readUiInstance();
  assert.equal(inst.port, 4317, 'port is coerced to a number');
  assert.equal(inst.pid, 4242);
  assert.equal(inst.token, token);

  assert.equal(removeUiInstance({ ifPid: 9999 }), false, 'another pid must not delete it');
  assert.ok(existsSync(file));
  assert.equal(removeUiInstance({ ifPid: 4242 }), true);
  assert.ok(!existsSync(file));
  assert.equal(removeUiInstance(), false, 'already gone');

  await writeFile(file, '{not json');
  assert.equal(readUiInstance(), null, 'corrupt file reads as null');
  await writeFile(file, JSON.stringify({ pid: 1, port: 'nope' }));
  assert.equal(readUiInstance(), null, 'bad port reads as null');
  removeUiInstance();
});

// Each row owns its own tiny server and closes it in its own finally; checkRows runs
// the rows one after another, so a failing row never leaves a server for the next.
test('probeUi classifies a port: free, worca (with info), busy (other program / 500 / hang), legacy worca via /api/settings', async () => {
  await checkRows([
    { name: 'probeUi: free port -> free', run: async () => {
      const port = await freePort();
      assert.deepEqual(await probeUi({ port }), { state: 'free' });
    } },
    { name: 'probeUi: a Worca /api/health -> worca with its info', run: async () => {
      const { port, close } = await serve((req, res) => {
        if (req.url === '/api/health') return json(res, 200, { name: UI_HEALTH_NAME, version: '9.9.9', pid: 77 });
        json(res, 404, { error: 'nope' });
      });
      try {
        const r = await probeUi({ port });
        assert.equal(r.state, 'worca');
        assert.equal(r.info.pid, 77);
        assert.equal(r.info.version, '9.9.9');
      } finally { await close(); }
    } },
    { name: 'probeUi: a different program (HTML, other JSON name, 500) -> busy', run: async () => {
      const cases = [
        (_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>hi</html>'); },
        (_req, res) => json(res, 200, { name: 'something-else' }),
        (_req, res) => json(res, 500, { error: 'boom' }),
      ];
      for (const handler of cases) {
        const { port, close } = await serve(handler);
        try { assert.deepEqual(await probeUi({ port }), { state: 'busy' }); } finally { await close(); }
      }
    } },
    { name: 'probeUi: a hang is busy, not free (timeout)', run: async () => {
      const { port, close, srv } = await serve(() => { /* never answers */ });
      srv.on('connection', (s) => s.setTimeout(0));
      try {
        const r = await probeUi({ port, timeoutMs: 200 });
        assert.equal(r.state, 'busy');
      } finally { srv.closeAllConnections?.(); await close(); }
    } },
    { name: 'probeUi: an older Worca UI (no /api/health, but /api/settings) -> worca + legacy', run: async () => {
      const { port, close } = await serve((req, res) => {
        if (req.url === '/api/settings') return json(res, 200, { projectsRootDefault: '/home/x', askMaxTurns: 40, chat: {} });
        json(res, 404, { error: 'not found' });
      });
      try {
        const r = await probeUi({ port });
        assert.equal(r.state, 'worca');
        assert.equal(r.info.legacy, true);
        const s = await stopUi({ port });
        assert.equal(s.status, 'failed');
        assert.match(s.reason, /older Worca UI/);
      } finally { await close(); }
    } },
  ]);
});

test('callUi: null with no instance file or a closed port; a live Worca UI gets the JSON call with its body', async () => {
  removeUiInstance();
  assert.equal(await callUi('/api/health'), null, 'no instance file');
  const closed = await freePort();
  await writeUiInstance({ pid: 1, host: '127.0.0.1', port: closed, token: 'x', version: '0', startedAt: 't' });
  assert.equal(await callUi('/api/health'), null, 'a closed port is null, not an ECONNREFUSED rejection');
  const { port, close } = await serve((req, res) => {
    if (req.url === '/api/health') return json(res, 200, { name: UI_HEALTH_NAME });
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => json(res, 200, { method: req.method, url: req.url, got: JSON.parse(body || 'null') }));
  });
  try {
    await writeUiInstance({ pid: 1, host: '127.0.0.1', port, token: 'x', version: '0', startedAt: 't' });
    assert.deepEqual(await callUi('/api/echo', { method: 'POST', body: { backend: 'e2b' } }),
      { status: 200, ok: true, data: { method: 'POST', url: '/api/echo', got: { backend: 'e2b' } } });
  } finally { await close(); removeUiInstance(); }
});

test('stopUi: free port -> not-running (idempotent) and clears a stale instance file', async () => {
  const port = await freePort();
  await writeUiInstance({ pid: 1, host: '127.0.0.1', port, token: 'x', version: '0', startedAt: 't' });
  assert.deepEqual(await stopUi({ port }), { status: 'not-running' });
  assert.equal(readUiInstance(), null, 'stale file removed');
});

test('stopUi: busy port -> busy, nothing signalled', async () => {
  const { port, close } = await serve((_req, res) => json(res, 200, { name: 'other' }));
  try { assert.deepEqual(await stopUi({ port }), { status: 'busy' }); } finally { await close(); }
});

test('stopUi: request path — bearer token from the instance file, server closes, port frees', async () => {
  const token = newUiToken();
  let seenAuth = null;
  const { port, close, srv } = await serve((req, res) => {
    if (req.url === '/api/health') return json(res, 200, { name: UI_HEALTH_NAME, pid: process.pid });
    if (req.method === 'POST' && req.url === '/api/shutdown') {
      seenAuth = req.headers.authorization;
      json(res, 202, { ok: true });
      setImmediate(() => { srv.closeAllConnections?.(); srv.close(); });
      return;
    }
    json(res, 404, {});
  });
  await writeUiInstance({ pid: process.pid, host: '127.0.0.1', port, token, version: '0', startedAt: 't' });
  try {
    const r = await stopUi({ port, timeoutMs: 5000 });
    assert.equal(r.status, 'stopped');
    assert.equal(r.method, 'request');
    assert.equal(seenAuth, `Bearer ${token}`);
    assert.equal(readUiInstance(), null, 'instance file cleaned up');
  } finally { await close().catch(() => {}); }
});

test('stopUi: signal fallback — stale token refused, SIGTERM on the pid the instance file names', { skip: process.platform === 'win32' && 'signal semantics differ on Windows' }, async () => {
  const port = await freePort();
  // A child that serves /api/health with ITS pid and refuses /api/shutdown (401).
  const script = `
    const http = require('node:http');
    http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/health') return res.end(JSON.stringify({ name: ${JSON.stringify(UI_HEALTH_NAME)}, pid: process.pid }));
      res.statusCode = 401; res.end('{}');
    }).listen(${port}, '127.0.0.1', () => process.stdout.write('up\\n'));
  `;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => child.stdout.on('data', (d) => { if (String(d).includes('up')) r(); }));
  const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
  await writeUiInstance({ pid: child.pid, host: '127.0.0.1', port, token: newUiToken(), version: '0', startedAt: 't' });
  try {
    const r = await stopUi({ port, timeoutMs: 5000 });
    assert.equal(r.status, 'stopped');
    assert.equal(r.method, 'signal');
    assert.equal(r.pid, child.pid);
    const { signal } = await exited;
    assert.equal(signal, 'SIGTERM');
    assert.deepEqual(await probeUi({ port }), { state: 'free' });
  } finally { try { child.kill('SIGKILL'); } catch { /* gone */ } }
});

/** A process the test owns, standing in for someone else's UI server: it must survive. */
function spawnBystander() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  let signal = null;
  child.on('exit', (_c, sig) => { signal = sig || 'exited'; });
  return { pid: child.pid, signalled: () => signal, kill: () => { try { child.kill('SIGKILL'); } catch { /* gone */ } } };
}

// Incident 2026-10-02: a `worca ui stop` from a test's WORCA_HOME fell back to the
// default port, found the user's real UI there, had no token and SIGTERMed the pid
// /api/health reported. A Worca UI this worcaHome's instance file does not name
// (same port AND same pid) must never be signalled — or sent this home's token.
for (const [label, fileFor] of [
  ['no instance file', () => null],
  ['instance file names another pid', (port, pid) => ({ pid: pid + 100000, port })],
  ['instance file names another port', (port, pid) => ({ pid, port: port + 1 })],
]) {
  test(`stopUi: ${label} -> failed, the health pid is never signalled`, async () => {
    const bystander = spawnBystander();
    let shutdownAuth = null;
    const { port, close } = await serve((req, res) => {
      if (req.url === '/api/health') return json(res, 200, { name: UI_HEALTH_NAME, pid: bystander.pid });
      if (req.url === '/api/shutdown') { shutdownAuth = req.headers.authorization || 'none'; return json(res, 401, {}); }
      json(res, 404, {});
    });
    removeUiInstance();
    const f = fileFor(port, bystander.pid);
    if (f) await writeUiInstance({ ...f, host: '127.0.0.1', token: newUiToken(), version: '0', startedAt: 't' });
    try {
      const r = await stopUi({ port, timeoutMs: 1000 });
      assert.equal(r.status, 'failed');
      assert.equal(r.pid, bystander.pid);
      assert.match(r.reason, /does not name this server/);
      assert.equal(shutdownAuth, null, 'no token is offered to a server the file does not name');
      await new Promise((res) => setTimeout(res, 200));
      assert.equal(bystander.signalled(), null, 'the bystander must not be signalled');
    } finally { bystander.kill(); removeUiInstance(); await close(); }
  });
}

test('waitForUiState: resolves when the state appears, null on deadline', async () => {
  const port = await freePort();
  assert.equal((await waitForUiState({ port, states: ['free'], timeoutMs: 1000 }))?.state, 'free');
  assert.equal(await waitForUiState({ port, states: ['worca'], timeoutMs: 300 }), null);
});
