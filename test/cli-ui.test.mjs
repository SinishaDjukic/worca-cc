// test/cli-ui.test.mjs
// `worca ui start|stop|restart|status` and the `--ui` alias. The probe-only arms
// run against fake occupants (a Worca-shaped health server, a foreign server, a
// free port); the lifecycle arm boots the REAL ui/server.mjs on a free port in
// mock mode and drives start -> restart -> stop through the CLI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { UI_HEALTH_NAME, probeUi, waitForUiState } from '../src/core/ui-instance.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');

useTempHome(after);

const created = [];
async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-cli-ui-'));
  created.push(dir);
  return dir;
}
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

function run(args, { home, extraEnv } = {}) {
  return new Promise((res) => {
    const env = { ...process.env, ...(extraEnv || {}) };
    if (home) env.WORCA_HOME = home;
    const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code) => res({ code, stdout, stderr }));
  });
}

/** Start the CLI and keep it running (a `ui start` that spawns the real server). */
function runDetachedCli(args, { home, extraEnv } = {}) {
  const env = { ...process.env, ...(extraEnv || {}) };
  if (home) env.WORCA_HOME = home;
  const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((res) => child.on('exit', (code) => res(code)));
  return { child, exited, out: () => stdout, err: () => stderr };
}

async function serve(handler) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, port: srv.address().port, close: () => new Promise((r) => srv.close(r)) };
}
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
async function freePort() { const { port, close } = await serve(() => {}); await close(); return port; }

test('ui help / bad verb / bad port', async () => {
  let r = await run(['ui', 'help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /worca ui stop/);
  assert.match(r.stdout, /--open/);

  r = await run(['ui', 'bogus']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown ui command "bogus"/);

  r = await run(['ui', 'status', '--port', 'abc']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--port must be an integer/);

  r = await run(['ui', '--nope']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Unknown flag: --nope/);

  r = await run(['--help']);
  assert.match(r.stdout, /worca ui \[start\|stop\|restart\|status\]/, 'top-level help advertises the subcommand');
});

test('ui status: free port -> "not running", exit 1; stop there is idempotent (exit 0)', async () => {
  const port = await freePort();
  const home = await freshHome();
  let r = await run(['ui', 'status', '--port', String(port)], { home });
  assert.equal(r.code, 1);
  assert.match(r.stdout, new RegExp(`not running on port ${port}\\.`));
  r = await run(['ui', 'stop', '--port', String(port)], { home });
  assert.equal(r.code, 0, 'stopping a stopped UI is not an error');
  assert.match(r.stdout, /not running/);
});

test('ui start against a running Worca: friendly block, exit 0, no server spawned', async () => {
  const { port, close } = await serve((req, res) => {
    if (req.url === '/api/health') return json(res, 200, { name: UI_HEALTH_NAME, version: '1.0.0', pid: 4242 });
    json(res, 404, {});
  });
  try {
    const home = await freshHome();
    let r = await run(['ui', '--port', String(port)], { home });
    assert.equal(r.code, 0);
    assert.match(r.stdout, new RegExp(`already running at http://127.0.0.1:${port}`));
    assert.match(r.stdout, /Restart it:\s+worca ui restart/);
    assert.match(r.stdout, new RegExp(`Another port:\\s+worca ui --port ${port + 1}`));
    assert.equal(r.stderr, '', 'an expected state prints nothing on stderr');
    assert.doesNotMatch(r.stdout, /Starting Worca UI/, 'no second instance');

    r = await run(['--ui', '--port', String(port)], { home });
    assert.equal(r.code, 0, '--ui is an alias of ui start');
    assert.match(r.stdout, /already running/);

    r = await run(['ui', 'status', '--port', String(port)], { home });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /running at http:\/\/127\.0\.0\.1:\d+ \(pid 4242, v1\.0\.0\)/);

    // PORT env is honoured when --port is absent.
    r = await run(['ui', 'status'], { home, extraEnv: { PORT: String(port) } });
    assert.equal(r.code, 0);
  } finally { await close(); }
});

test('ui start against another program: three-line conflict on stderr, exit 1', async () => {
  const { port, close } = await serve((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h1>not worca</h1>'); });
  try {
    const home = await freshHome();
    let r = await run(['ui', 'start', '--port', String(port)], { home });
    assert.equal(r.code, 1);
    assert.match(r.stderr, new RegExp(`port ${port} is in use by another program`));
    assert.match(r.stderr, new RegExp(`worca ui --port ${port + 1}`));
    assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+/, 'no stack trace');
    assert.ok(r.stderr.trim().split('\n').length <= 3, `short: ${JSON.stringify(r.stderr)}`);

    r = await run(['ui', 'stop', '--port', String(port)], { home });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not a Worca UI — nothing to stop/);
    r = await run(['ui', 'status', '--port', String(port)], { home });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /in use by another program/);
  } finally { await close(); }
});

test('ui stop without --port never signals a Worca UI this WORCA_HOME did not start', { skip: process.platform === 'win32' && 'signal semantics differ on Windows' }, async () => {
  // Incident 2026-10-02: no instance file, so the portless stop fell back to PORT
  // (inherited 4317) and SIGTERMed the pid the real UI's /api/health reported.
  // Here PORT points at a fake Worca UI reporting a bystander pid the test owns.
  const bystander = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  let signalled = null;
  bystander.on('exit', (_c, sig) => { signalled = sig || 'exited'; });
  const { port, close } = await serve((req, res) => {
    if (req.url === '/api/health') return json(res, 200, { name: UI_HEALTH_NAME, version: '1.0.0', pid: bystander.pid });
    json(res, 401, {});
  });
  try {
    const home = await freshHome();
    const r = await run(['ui', 'stop'], { home, extraEnv: { PORT: String(port) } });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /does not name this server/);
    await new Promise((res) => setTimeout(res, 200));
    assert.equal(signalled, null, 'the bystander must not be signalled');
  } finally { try { bystander.kill('SIGKILL'); } catch { /* gone */ } await close(); }
});

test('lifecycle: real server start -> instance file -> restart (new pid) -> stop (graceful, exit 0)', { timeout: 90000 }, async () => {
  const home = await freshHome();
  const port = await freePort();
  const env = { WORCA_MOCK: '1' };

  const first = runDetachedCli(['ui', 'start', '--port', String(port)], { home, extraEnv: env });
  try {
    const up = await waitForUiState({ port, states: ['worca'], timeoutMs: 45000 });
    assert.ok(up, `server did not come up: ${first.err()}`);
    assert.match(first.out(), new RegExp(`Starting Worca UI on http://127.0.0.1:${port}`));
    assert.doesNotMatch(first.out(), /server\.mjs/, 'the script path stays behind the debug-spawn toggle');
    const pid1 = up.info.pid;

    const file = join(home, '.worca-cc', 'ui.json');
    for (let i = 0; i < 50 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 100));
    const inst = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(inst.pid, pid1);
    assert.equal(inst.port, port);
    assert.match(inst.token, /^[0-9a-f]{64}$/);

    // stop/status/restart find the port from the instance file — no --port needed.
    let r = await run(['ui', 'status'], { home });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`127\\.0\\.0\\.1:${port} \\(pid ${pid1}`));

    const second = runDetachedCli(['ui', 'restart'], { home, extraEnv: env });
    try {
      assert.equal(await first.exited, 0, `stopped server exits 0 (graceful), got stderr: ${first.err()}`);
      let pid2 = null;
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        const p = await probeUi({ port });
        if (p.state === 'worca' && p.info.pid && p.info.pid !== pid1) { pid2 = p.info.pid; break; }
        await new Promise((res) => setTimeout(res, 150));
      }
      assert.ok(pid2, `restart did not bring up a new server: ${second.out()} ${second.err()}`);
      // The server answers /api/health before it writes ui.json; a portless stop in
      // that window resolves PORT/4317 instead (incident 2026-10-02). Wait for the
      // file to name the new server before relying on it.
      let named = false;
      for (let i = 0; i < 100 && !named; i++) {
        try { named = JSON.parse(await readFile(file, 'utf8')).pid === pid2; } catch { /* not yet */ }
        if (!named) await new Promise((res) => setTimeout(res, 50));
      }
      assert.ok(named, 'restarted server wrote its instance file');
      assert.match(second.out(), /Starting Worca UI/);
      assert.doesNotMatch(second.out(), /not running/, 'restart is quiet about the stop it just did');

      r = await run(['ui', 'stop'], { home });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp(`Stopped Worca UI on port ${port} \\(pid ${pid2}\\)`));
      assert.equal(await second.exited, 0, `stopped server exits 0, stderr: ${second.err()}`);
      assert.ok(!existsSync(file), 'instance file removed on exit');
      assert.deepEqual(await probeUi({ port }), { state: 'free' });
    } finally { try { second.child.kill('SIGKILL'); } catch { /* gone */ } }
  } finally { try { first.child.kill('SIGKILL'); } catch { /* gone */ } }
});

test('node ui/server.mjs on a taken port: two lines, no stack, exit 1', { timeout: 60000 }, async () => {
  const { port, close } = await serve((_req, res) => { res.end('x'); });
  const home = await freshHome();
  try {
    const server = resolve(__dirname, '..', 'ui', 'server.mjs');
    const r = await new Promise((res) => {
      const child = spawn(process.execPath, [server], {
        env: { ...process.env, WORCA_HOME: home, WORCA_MOCK: '1', PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('exit', (code) => res({ code, stdout, stderr }));
    });
    assert.equal(r.code, 1);
    assert.match(r.stderr, new RegExp(`port ${port} is already in use`));
    assert.match(r.stderr, /worca ui restart/);
    assert.doesNotMatch(r.stderr, /EADDRINUSE|Unhandled 'error' event|at Server\./, `stack leaked: ${r.stderr}`);
  } finally { await close(); }
});
