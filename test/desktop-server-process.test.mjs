// test/desktop-server-process.test.mjs — the server child of the desktop app (desktop/src/server-process.mjs):
// its env, spawn spec and runtime, the stop that touches only that child, and one real-server row. The real row is
// heavier (it spawns ui/server.mjs) because it is the only proof that the ready parsing and the graceful stop match
// the real server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { readServerSource } from '../src/core/read-server-source.mjs';
import { resolveServerRuntime, serverTreeRoot, buildServerEnv, serverSpawnSpec, startServer, stopServer } from '../desktop/src/server-process.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('buildServerEnv: PORT and WORCA_DESKTOP set; PATH merged on darwin, kept on win32; ELECTRON_* removed; WORCA_HOME only inherited', () => {
  const base = { PATH: '/usr/bin:/bin', HOME: '/h', ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1', FOO: 'x' };
  const e = buildServerEnv({ baseEnv: base, loginPath: '/opt/homebrew/bin:/usr/bin', port: 4317, platform: 'darwin' });
  assert.equal(e.PORT, '4317');
  assert.equal(e.WORCA_DESKTOP, '1');
  assert.equal(e.PATH, '/opt/homebrew/bin:/usr/bin:/bin');
  assert.equal(e.FOO, 'x');
  assert.ok(!Object.keys(e).some((k) => k.startsWith('ELECTRON_')), 'no ELECTRON_* key');
  assert.ok(!('WORCA_HOME' in e), 'never invents WORCA_HOME');
  for (const k of ['WORCA_UI_SUPERVISOR', 'WORCA_HOST']) assert.ok(!(k in e), k);
  assert.equal(base.ELECTRON_RUN_AS_NODE, '1', 'the base env is not mutated');
  assert.equal(buildServerEnv({ baseEnv: { ...base, WORCA_HOME: '/mine' }, loginPath: null, port: 0, platform: 'linux' }).WORCA_HOME, '/mine');
  assert.equal(buildServerEnv({ baseEnv: base, loginPath: null, port: 0, platform: 'linux' }).PORT, '0');
  const w = buildServerEnv({ baseEnv: { Path: 'C:\\Windows', ELECTRON_RUN_AS_NODE: '1' }, loginPath: '/ignored', port: 1, platform: 'win32' });
  assert.equal(w.Path, 'C:\\Windows');
  assert.ok(!('PATH' in w), 'keeps the key casing that exists');
  assert.ok(!('ELECTRON_RUN_AS_NODE' in w));
});

test('serverSpawnSpec: the bundled node runs ui/server.mjs from the home folder, stdin ignored', () => {
  const env = { A: '1' };
  const s = serverSpawnSpec({ nodePath: '/r/node/node', serverRoot: '/r/server', env, home: '/Users/u' });
  assert.equal(s.command, '/r/node/node');
  assert.deepEqual(s.args, ['--disable-warning=ExperimentalWarning', join('/r/server', 'ui', 'server.mjs')]);
  assert.equal(s.options.cwd, '/Users/u');
  assert.equal(s.options.env, env);
  assert.deepEqual(s.options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(s.options.windowsHide, true);
  assert.equal(s.options.detached, false);
});

test('resolveServerRuntime: packaged darwin/win32 paths; dev WORCA_DESKTOP_NODE beats which; none → NODE_NOT_FOUND', () => {
  assert.deepEqual(resolveServerRuntime({ packaged: true, resourcesPath: '/A/Resources', platform: 'darwin', env: {}, which: () => '/usr/bin/node' }),
    { nodePath: join('/A/Resources', 'node', 'node'), serverRoot: join('/A/Resources', 'server') });
  assert.equal(resolveServerRuntime({ packaged: true, resourcesPath: 'C:\\R', platform: 'win32', env: {}, which: () => null }).nodePath, join('C:\\R', 'node', 'node.exe'));
  const dev = resolveServerRuntime({ packaged: false, desktopDir: '/repo/desktop', platform: 'darwin', env: { WORCA_DESKTOP_NODE: '/opt/node24/bin/node' }, which: () => '/usr/bin/node' });
  assert.deepEqual(dev, { nodePath: '/opt/node24/bin/node', serverRoot: '/repo' });
  assert.equal(resolveServerRuntime({ packaged: false, desktopDir: '/repo/desktop', platform: 'darwin', env: {}, which: () => '/usr/local/bin/node' }).nodePath, '/usr/local/bin/node');
  assert.throws(() => resolveServerRuntime({ packaged: false, desktopDir: '/repo/desktop', platform: 'darwin', env: {}, which: () => null }),
    (e) => e.code === 'NODE_NOT_FOUND' && /Worca needs Node 22\.19 or newer to run from a checkout: install it or set WORCA_DESKTOP_NODE/.test(e.message));
});

test('serverTreeRoot: packaged → <resources>/server, dev → the checkout; resolveServerRuntime agrees', () => {
  assert.equal(serverTreeRoot({ packaged: true, resourcesPath: '/A/Resources', desktopDir: '/repo/desktop' }), join('/A/Resources', 'server'));
  assert.equal(serverTreeRoot({ packaged: false, resourcesPath: '/A/Resources', desktopDir: '/repo/desktop' }), '/repo');
  assert.equal(serverTreeRoot({ packaged: false, desktopDir: join(ROOT, 'desktop') }), join(ROOT).replace(/[\\/]$/, ''));
  for (const packaged of [true, false]) {
    const o = { packaged, resourcesPath: '/A/Resources', desktopDir: '/repo/desktop' };
    assert.equal(resolveServerRuntime({ ...o, platform: 'darwin', env: { WORCA_DESKTOP_NODE: '/n' }, which: () => null }).serverRoot, serverTreeRoot(o), `packaged ${packaged}`);
  }
  assert.doesNotThrow(() => serverTreeRoot({ packaged: false, desktopDir: '/x/desktop' }), 'needs no Node binary');
});

function fakeChild(pid = 4242, { exitsOn = ['SIGTERM', 'SIGKILL'] } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null; child.signalCode = null;
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kills = [];
  child.kill = (sig) => {
    child.kills.push(sig);
    if (exitsOn.includes(sig)) setImmediate(() => { child.signalCode = sig; child.emit('exit', null, sig); });
    return true;
  };
  return child;
}
function handleFor(child, { port = 50001 } = {}) {
  const exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));
  return { child, pid: child.pid, url: `http://127.0.0.1:${port}`, port, owned: true, exited, stderrTail: () => '' };
}
const uiJson = (o) => () => JSON.stringify({ host: '127.0.0.1', token: 'tok', ...o });
const instantClock = { setTimeout: (fn) => setImmediate(fn), clearTimeout: () => {} };

function spyProcessKill(t) {
  const calls = [];
  const real = process.kill;
  process.kill = (...a) => { calls.push(a); return true; };
  t.after(() => { process.kill = real; });
  return { calls, restore: () => { process.kill = real; } };
}

test('stopServer: matching ui.json → POST /api/shutdown with the bearer token, no signal', async (t) => {
  const pk = spyProcessKill(t);
  const child = fakeChild();
  const h = handleFor(child);
  const reqs = [];
  const fetch = async (url, init) => { reqs.push({ url, init }); setImmediate(() => { child.exitCode = 0; child.emit('exit', 0, null); }); return { status: 202 }; };
  const r = await stopServer(h, { storeDir: '/s', readFile: uiJson({ pid: 4242, port: 50001 }), fetch });
  pk.restore();
  assert.deepEqual(r, { exitCode: 0, via: 'request' });
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].url, 'http://127.0.0.1:50001/api/shutdown');
  assert.equal(reqs[0].init.method, 'POST');
  assert.equal(reqs[0].init.headers.authorization, 'Bearer tok');
  assert.deepEqual(child.kills, []);
  assert.deepEqual(pk.calls, []);
});

test('stopServer: ui.json of another pid or port → no request, SIGTERM to the child', async (t) => {
  const pk = spyProcessKill(t);
  for (const file of [{ pid: 999, port: 50001 }, { pid: 4242, port: 4317 }]) {
    const child = fakeChild();
    let fetched = 0;
    const r = await stopServer(handleFor(child), { storeDir: '/s', readFile: uiJson(file), fetch: async () => { fetched++; return { status: 202 }; } });
    assert.equal(fetched, 0);
    assert.deepEqual(child.kills, ['SIGTERM']);
    assert.equal(r.via, 'signal');
  }
  pk.restore();
  assert.deepEqual(pk.calls, []);
});

test('stopServer: a refused request (not 202) or a missing ui.json → SIGTERM', async () => {
  const child = fakeChild();
  const r = await stopServer(handleFor(child), { storeDir: '/s', readFile: uiJson({ pid: 4242, port: 50001 }), fetch: async () => ({ status: 401 }) });
  assert.deepEqual([r.via, child.kills], ['signal', ['SIGTERM']]);
  const c2 = fakeChild();
  const r2 = await stopServer(handleFor(c2), { storeDir: '/s', readFile: () => { throw new Error('ENOENT'); }, fetch: async () => { throw new Error('no'); } });
  assert.deepEqual([r2.via, c2.kills], ['signal', ['SIGTERM']]);
});

test('stopServer: a child that never exits gets SIGKILL after the timeout (fake clock)', async (t) => {
  const pk = spyProcessKill(t);
  const child = fakeChild(4242, { exitsOn: [] });
  const r = await stopServer(handleFor(child), { storeDir: '/s', readFile: () => { throw new Error('ENOENT'); }, fetch: async () => ({ status: 202 }), ...instantClock });
  pk.restore();
  assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL']);
  assert.equal(r.via, 'signal');
  assert.equal(r.exitCode, null);
  assert.deepEqual(pk.calls, []);
});

test('stopServer: an already-exited child → no request, no signal', async () => {
  const child = fakeChild();
  child.exitCode = 1;
  let fetched = 0;
  const r = await stopServer(handleFor(child), { storeDir: '/s', readFile: uiJson({ pid: 4242, port: 50001 }), fetch: async () => { fetched++; return { status: 202 }; } });
  assert.deepEqual(r, { exitCode: 1, via: 'already-exited' });
  assert.equal(fetched, 0);
  assert.deepEqual(child.kills, []);
});

test('startServer: a failed start stops the child it spawned, then rethrows', async () => {
  const child = fakeChild(777);
  let spec = null;
  const spawn = (command, args, options) => { spec = { command, args, options }; return child; };
  const failing = async () => { throw Object.assign(new Error('worca server was not ready after 60 s'), { code: 'SERVER_TIMEOUT', stderrTail: '' }); };
  await assert.rejects(startServer({ runtime: { nodePath: '/n', serverRoot: '/srv' }, env: { A: '1' }, spawn, waitForReady: failing, logStream: new PassThrough(), home: '/h' }),
    (e) => e.code === 'SERVER_TIMEOUT');
  assert.deepEqual(child.kills, ['SIGTERM'], 'the child is stopped before the error is reported');
  assert.equal(spec.command, '/n');
  assert.equal(spec.options.cwd, '/h');
});

test('startServer: onSpawn gets the handle before ready; resolves a handle owned by this app; stdout and stderr reach the log; stderrTail() keeps the end', async () => {
  const child = fakeChild(778);
  const log = new PassThrough();
  let logged = '';
  log.on('data', (d) => { logged += d; });
  const spawned = [];
  const ready = async (c) => { assert.equal(spawned.length, 1, 'onSpawn ran before ready'); c.stdout.write('hello out\n'); c.stderr.write('hello err\n'); await new Promise((r) => setImmediate(r)); return { url: 'http://127.0.0.1:6000', port: 6000, health: { pid: 778 } }; };
  const h = await startServer({ runtime: { nodePath: '/n', serverRoot: '/srv' }, env: {}, spawn: () => child, waitForReady: ready, logStream: log, home: '/h', onSpawn: (x) => spawned.push(x) });
  assert.deepEqual(spawned, [h], 'onSpawn gets the very handle, while the start is still in flight');
  assert.deepEqual([h.pid, h.url, h.port, h.owned, h.child], [778, 'http://127.0.0.1:6000', 6000, true, child]);
  await new Promise((r) => setImmediate(r));
  assert.match(logged, /hello out/);
  assert.match(logged, /hello err/);
  assert.match(h.stderrTail(), /hello err/);
  child.emit('exit', 0, null);
  assert.deepEqual(await h.exited, { code: 0, signal: null });
});

test('real server: starts on PORT=0, health pid is the child, /api/app/update says desktop, the request stop exits 0 and removes ui.json', { timeout: 120_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'desk-srv-home-'));
  const wh = mkdtempSync(join(tmpdir(), 'desk-srv-wh-'));
  const storeDir = join(wh, '.worca-cc');
  const env = buildServerEnv({
    baseEnv: { ...process.env, WORCA_MOCK: '1', WORCA_UPDATE_CHECK_LATEST: '99.0.0', HOME: home, USERPROFILE: home, WORCA_HOME: wh },
    loginPath: null, port: 0, platform: process.platform,
  });
  delete env.WORCA_HOST_PID;
  let handle = null;
  try {
    handle = await startServer({ runtime: { nodePath: process.execPath, serverRoot: ROOT }, env, logStream: createWriteStream(devNull), home, readyTimeoutMs: 90_000 });
    assert.ok(handle.port > 0);
    assert.notEqual(handle.port, 4317);
    const health = await (await fetch(`${handle.url}/api/health`)).json();
    assert.equal(health.pid, handle.child.pid);
    const upd = await (await fetch(`${handle.url}/api/app/update`)).json();
    assert.equal(upd.reason, 'desktop', 'WORCA_DESKTOP reached the real server');
    const file = join(storeDir, 'ui.json');
    for (let i = 0; i < 100 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, handle.pid);
    const r = await stopServer(handle, { storeDir });
    assert.deepEqual(r, { exitCode: 0, via: 'request' });
    assert.equal(existsSync(file), false, 'the server removed ui.json on exit');
  } finally {
    if (handle && handle.child.exitCode === null && handle.child.signalCode === null) handle.child.kill('SIGKILL');
    rmSync(home, { recursive: true, force: true });
    rmSync(wh, { recursive: true, force: true });
  }
});

test('a server the app leaves behind outlives its closed stdout/stderr pipes (WORCA_DESKTOP=1); a web server still dies on EPIPE; ui/server.mjs installs the guard at boot', { timeout: 30_000 }, async () => {
  // The same guard ui/server.mjs runs first when it is the main module, in a child that keeps logging after the
  // parent closed the read ends of its pipes (the app crashed, or quit during a start or a Restart).
  const mod = pathToFileURL(join(ROOT, 'src/core/update-eligibility.mjs')).href;
  const code = `const { ignoreClosedDesktopOutput } = await import(${JSON.stringify(mod)}); ignoreClosedDesktopOutput();
let n = 0; const t = setInterval(() => { console.log('line', n); console.error('err', n); if (++n === 6) { clearInterval(t); process.exit(0); } }, 50);`;
  const run = (env) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.destroy();
    child.stderr.destroy();
    child.once('exit', (c, sig) => resolve(c ?? sig));
  });
  const base = { ...process.env };
  delete base.WORCA_DESKTOP;
  assert.equal(await run({ ...base, WORCA_DESKTOP: '1' }), 0, 'the desktop server keeps running');
  assert.equal(await run(base), 1, 'web: the EPIPE is unhandled as before');
  const src = readServerSource();
  assert.match(src, /\nif \(isMain\) \{\n  ignoreClosedDesktopOutput\(\);\n/, 'the guard is the first thing the server does when run directly');
});
