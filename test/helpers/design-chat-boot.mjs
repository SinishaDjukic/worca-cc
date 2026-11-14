// test/helpers/design-chat-boot.mjs
// One in-process worca server for a Design chat test file, on the mock engine with the `design` flag on. It boots
// INLINE (top-level await in the caller), so the values a test file destructures at top level are real: a cwd git
// sandbox, its own WORCA_HOME, HOME and USERPROFILE (callers do not call useTempHome), WORCA_MOCK=1 and
// WORCA_FLAGS=design, all set before the server import. The teardown goes through the `after` the caller passes and
// puts every env key and the cwd back. Base: test/ask-api-workflow-cards.test.mjs (boot and teardown).
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { _resetForTests as closeDbForTests } from '../../src/core/db.mjs';

const JSONH = { 'Content-Type': 'application/json' };
const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_MOCK', 'WORCA_FLAGS'];
// A hang detector, not a budget: the loaded Windows VM runs a mock turn 5-10x slower than macOS.
const WAIT_MS = process.platform === 'win32' ? 60000 : 10000;

function gitInit(dir) {
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'README.md'), '# x\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
}

/** Polls `pred` (sync or async) every 15 ms until it returns a truthy value, which it resolves with. */
async function poll(pred, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`${what} timed out`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

/**
 * Boots the server and registers its teardown on `after`.
 * @param {(fn: () => Promise<void>) => void} after node:test's `after`
 * @returns {Promise<{ base: string,
 *   call: (method: string, path: string, body?: object, headers?: object) => Promise<{status: number, body: any}>,
 *   openWs: (onFrame: (frame: object) => void) => Promise<WebSocket>,
 *   waitFrame: (frames: object[], pred: (frame: object) => boolean, ms?: number) => Promise<object>,
 *   waitFor: (fn: () => unknown, ms?: number) => Promise<unknown>,
 *   settled: (threadId: string) => Promise<object>, homeDir: string, mod: object }>}
 */
export async function bootDesignChat(after) {
  const origCwd = process.cwd();
  const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const sockets = [];
  let mod = null;
  let srv = null;
  const cwdSandbox = mkdtempSync(join(tmpdir(), 'worca-cc-designchat-cwd-'));
  const homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-designchat-'));

  after(async () => {
    for (const ws of sockets) { try { ws.terminate(); } catch { /* reap */ } }
    if (mod) {
      for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
      for (const r of mod.runs.values()) { try { r.orch?.stop?.(); } catch { /* reap */ } }
      mod.runs.clear();
      if (mod.designBuilds) { mod.designBuilds.pauseAll(); await mod.designBuilds.settled(); }
    }
    if (srv) {
      // An upgraded socket is NOT destroyed by closeAllConnections(), so a red WS test would hang server.close():
      // bound the wait so the failures print.
      await Promise.race([
        new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
        new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
      ]);
    }
    for (const k of ENV_KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    process.chdir(origCwd);
    // Close the sqlite handle first: Windows cannot unlink an open file. A stopped turn still flushes for a few
    // ticks, so the rm retries and never fails the file.
    closeDbForTests();
    const reap = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
    await reap(cwdSandbox);
    await reap(homeDir);
  });

  gitInit(cwdSandbox);
  process.chdir(cwdSandbox);
  // settings.json lives under HOME, not WORCA_HOME: a setting a test writes never reaches the real home.
  Object.assign(process.env, { WORCA_HOME: homeDir, HOME: homeDir, USERPROFILE: homeDir, WORCA_MOCK: '1', WORCA_FLAGS: 'design' });
  closeDbForTests();
  mod = await import('../../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  /** One request; `headers` adds to the JSON content type (e.g. a shared sign-in header). */
  async function call(method, path, body, headers = {}) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : JSONH), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: r.status, body: parsed };
  }

  /** Resolves once the socket is open; every parsed frame goes to `onFrame`. No `?threadId=`: that replays a job ring. */
  function openWs(onFrame) {
    const ws = new WebSocket(wsUrl, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
    sockets.push(ws);
    ws.on('message', (d) => {
      let frame;
      try { frame = JSON.parse(String(d)); } catch { return; }
      onFrame(frame);
    });
    return new Promise((res, rej) => { ws.once('open', () => res(ws)); ws.once('error', rej); });
  }

  const waitFrame = (frames, pred, ms = WAIT_MS) => poll(() => frames.find(pred), ms, 'waitFrame');
  const waitFor = (fn, ms = WAIT_MS) => poll(fn, ms, 'waitFor');

  /** The thread's snapshot once no job runs on it (`inFlight` is null while a job is only reserved). */
  async function settled(threadId) {
    for (let i = 0; i < 600; i++) {
      const s = await call('GET', `/api/ask/threads/${threadId}`);
      if (!s.body?.inFlight) return s.body;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error('the turn never settled');
  }

  return { base, call, openWs, waitFrame, waitFor, settled, homeDir, mod };
}
