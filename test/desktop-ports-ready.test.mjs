// test/desktop-ports-ready.test.mjs — the desktop app's port choice and its reading of the server's ready line
// (desktop/src/ports.mjs, desktop/src/ready.mjs). Pure: a fake child and a fake clock, except isPortFree (real net).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { PREFERRED_PORT, choosePort, isPortFree } from '../desktop/src/ports.mjs';
import { READY_RE, PORT_BUSY_RE, parseReadyLine, probeHealth, waitForReady } from '../desktop/src/ready.mjs';

const tick = () => new Promise((r) => setImmediate(r));

test('choosePort: 4317 when it is free, else 0 (the server binds an OS port)', async () => {
  assert.equal(PREFERRED_PORT, 4317);
  assert.equal(await choosePort({ isFree: async () => true }), 4317);
  assert.equal(await choosePort({ isFree: async () => false }), 0);
  const asked = [];
  await choosePort({ preferred: 5000, host: '127.0.0.1', isFree: async (p, h) => { asked.push([p, h]); return true; } });
  assert.deepEqual(asked, [[5000, '127.0.0.1']]);
});

test('isPortFree: a held port is not free; a just-closed one is (real net, 127.0.0.1)', async () => {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  assert.equal(await isPortFree(port, '127.0.0.1'), false);
  await new Promise((r) => srv.close(r));
  assert.equal(await isPortFree(port, '127.0.0.1'), true);
});

test('isPortFree: an error other than EADDRINUSE/EACCES rejects', async () => {
  const fakeNet = { createServer() {
    const s = new EventEmitter();
    s.listen = () => setImmediate(() => s.emit('error', Object.assign(new Error('boom'), { code: 'EINVAL' })));
    s.close = (cb) => cb && cb();
    return s;
  } };
  await assert.rejects(isPortFree(1, '127.0.0.1', { net: fakeNet }), /boom/);
  const busyNet = { createServer() {
    const s = new EventEmitter();
    s.listen = () => setImmediate(() => s.emit('error', Object.assign(new Error('perm'), { code: 'EACCES' })));
    s.close = (cb) => cb && cb();
    return s;
  } };
  assert.equal(await isPortFree(80, '127.0.0.1', { net: busyNet }), false);
});

test('parseReadyLine: the exact server line → url and port; anything else → null', () => {
  assert.deepEqual(parseReadyLine('[worca-ui] listening on http://127.0.0.1:54321 (bound to 127.0.0.1)'), { url: 'http://127.0.0.1:54321', port: 54321 });
  assert.deepEqual(parseReadyLine('noise\n[worca-ui] listening on http://localhost:4317 (bound to ::1)\n'), { url: 'http://localhost:4317', port: 4317 });
  assert.equal(parseReadyLine('[worca-ui] stopping (SIGTERM)'), null);
  assert.equal(parseReadyLine(''), null);
  assert.ok(READY_RE.test('[worca-ui] listening on http://127.0.0.1:1 (bound to 0.0.0.0)'));
  assert.ok(PORT_BUSY_RE.test('[worca-ui] port 4317 is already in use — is the UI already running?'));
});

test('probeHealth: worca health → its fields; a non-ok answer or a throw → null', async () => {
  const urls = [];
  const ok = async (u) => { urls.push(u); return { ok: true, json: async () => ({ name: '@worca/app', version: '1.2.3', pid: 7, port: 9, host: 'x' }) }; };
  assert.deepEqual(await probeHealth('http://127.0.0.1:9', { fetch: ok }), { name: '@worca/app', version: '1.2.3', pid: 7, port: 9 });
  assert.deepEqual(urls, ['http://127.0.0.1:9/api/health']);
  assert.equal(await probeHealth('http://x', { fetch: async () => ({ ok: false, json: async () => ({}) }) }), null);
  assert.equal(await probeHealth('http://x', { fetch: async () => { throw new Error('ECONNREFUSED'); } }), null);
});

function fakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}
function fakeClock() {
  const timers = [];
  return {
    timers,
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
    fire(ms) { for (const t of timers.filter((x) => x.ms === ms && !x.cleared && !x.fired)) { t.fired = true; t.fn(); } },
  };
}
const allTimersDone = (clock) => clock.timers.every((t) => t.cleared || t.fired);
const counts = (c) => [c.listenerCount('exit'), c.stdout.listenerCount('data'), c.stderr.listenerCount('data')];

test('waitForReady: the ready line + a health answer whose pid is the child → resolves; listeners removed', async () => {
  const child = fakeChild();
  const before = counts(child);
  const probe = async (url) => ({ name: '@worca/app', version: '1', pid: 4242, port: 50001, url });
  const p = waitForReady(child, { probe });
  child.stdout.write('[worca-ui] booting\n[worca-ui] listening on http://127.0.0.1:50001 (bound to 127.0.0.1)\n');
  const r = await p;
  assert.equal(r.url, 'http://127.0.0.1:50001');
  assert.equal(r.port, 50001);
  assert.equal(r.health.pid, 4242);
  assert.deepEqual(counts(child), before);
});

test('waitForReady: a ready line split across chunks still parses; health retries until it answers', async () => {
  const child = fakeChild();
  const clock = fakeClock();
  let n = 0;
  const probe = async () => (++n < 2 ? null : { name: '@worca/app', pid: 4242, port: 1 });
  let settled = null;
  const p = waitForReady(child, { probe, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }).then((v) => { settled = v; });
  child.stdout.write('[worca-ui] listening on http://127.0.0.1:');
  child.stdout.write('1 (bound to 127.0.0.1)\n');
  await tick(); await tick();
  assert.equal(settled, null, 'first probe answered null: waits for the retry timer');
  clock.fire(250);
  await tick(); await tick();
  await p;
  assert.equal(settled.port, 1);
  assert.equal(n, 2);
  assert.ok(allTimersDone(clock), 'the 60 s deadline is cleared once ready');
});

test('waitForReady: busy-port stderr + exit 1 → SERVER_EXITED with portBusy and stderrTail', async () => {
  const child = fakeChild();
  const before = counts(child);
  const p = waitForReady(child, { probe: async () => null });
  child.stderr.write('[worca-ui] port 4317 is already in use — is the UI already running?\n');
  child.stderr.end();
  await tick();
  child.emit('exit', 1, null);
  await assert.rejects(p, (e) => e.code === 'SERVER_EXITED' && e.portBusy === true && /already in use/.test(e.stderrTail)
    && /exited with code 1 before it was ready/.test(e.message));
  assert.deepEqual(counts(child), before);
});

test('waitForReady: an exit without the busy line → portBusy false', async () => {
  const child = fakeChild();
  const p = waitForReady(child, { probe: async () => null });
  child.stderr.write('Error: Node 22.19.0 or newer is required\n');
  child.stderr.end();
  await tick();
  child.emit('exit', 1, null);
  await assert.rejects(p, (e) => e.code === 'SERVER_EXITED' && e.portBusy === false);
});

test('waitForReady: a spawn error (node missing: no exit event) → SERVER_EXITED at once, not a timeout', async () => {
  const child = fakeChild();
  child.pid = undefined;
  const before = counts(child);
  const p = waitForReady(child, { probe: async () => null });
  child.emit('error', Object.assign(new Error('spawn /nope/node ENOENT'), { code: 'ENOENT' }));
  await assert.rejects(p, (e) => e.code === 'SERVER_EXITED' && e.portBusy === false && /could not start: spawn \/nope\/node ENOENT/.test(e.message));
  assert.deepEqual(counts(child), before);
  assert.equal(child.listenerCount('error'), 0);
});

test('waitForReady: no ready line before the deadline → SERVER_TIMEOUT (fake clock, settled flag)', async () => {
  const child = fakeChild();
  const before = counts(child);
  const clock = fakeClock();
  let settled = null;
  waitForReady(child, { timeoutMs: 60000, probe: async () => null, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout })
    .then(() => { settled = 'resolved'; }, (e) => { settled = e; });
  await tick();
  assert.equal(settled, null);
  clock.fire(60000);
  await new Promise((r) => setImmediate(r));
  assert.ok(settled instanceof Error, 'rejected right after the deadline tick');
  assert.equal(settled.code, 'SERVER_TIMEOUT');
  assert.match(settled.message, /not ready after 60 s/);
  assert.deepEqual(counts(child), before);
  assert.ok(allTimersDone(clock));
});

test('waitForReady: health answered by another pid → SERVER_NOT_OURS', async () => {
  const child = fakeChild(1000);
  const p = waitForReady(child, { probe: async () => ({ name: '@worca/app', pid: 2000, port: 4317 }) });
  child.stdout.write('[worca-ui] listening on http://127.0.0.1:4317 (bound to 127.0.0.1)\n');
  await assert.rejects(p, (e) => e.code === 'SERVER_NOT_OURS');
});

test('waitForReady: stderrTail keeps only the last 64 KiB', async () => {
  const child = fakeChild();
  const p = waitForReady(child, { probe: async () => null });
  child.stderr.write('A'.repeat(70 * 1024));
  child.stderr.write('TAIL');
  child.stderr.end();
  await tick();
  child.emit('exit', 1, null);
  const e = await p.catch((x) => x);
  assert.equal(e.stderrTail.length, 64 * 1024);
  assert.ok(e.stderrTail.endsWith('TAIL'));
});
