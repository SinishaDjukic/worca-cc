// desktop/src/server-process.mjs — the worca server the desktop app starts, and the stop that touches only it
// (docs/desktop.md). The server runs on a bundled, pinned Node (never Electron's binary): the server writes
// process.execPath into hook and MCP commands that agents run later. Imports only node: builtins.
import { spawn as realSpawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { mergePath } from './shell-path.mjs';
import { waitForReady as realWaitForReady } from './ready.mjs';

const STDERR_TAIL_BYTES = 64 * 1024;

/** The first executable `name` on env's PATH, or null. */
export function whichOnPath(name, { env = process.env, platform = process.platform } = {}) {
  const pathValue = env.PATH ?? env.Path ?? '';
  const exts = platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of String(pathValue).split(platform === 'win32' ? ';' : delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    for (const ext of exts) {
      const p = join(dir, name + ext);
      try { if (statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}

/** Which node runs which server tree: the bundled pair when packaged, the checkout + a system node in dev. */
export function resolveServerRuntime({ packaged, resourcesPath, desktopDir, platform = process.platform, env = process.env, which = (n) => whichOnPath(n, { env, platform }) }) {
  if (packaged) {
    return { nodePath: join(resourcesPath, 'node', platform === 'win32' ? 'node.exe' : 'node'), serverRoot: join(resourcesPath, 'server') };
  }
  const nodePath = (env.WORCA_DESKTOP_NODE && String(env.WORCA_DESKTOP_NODE).trim()) || which('node');
  if (!nodePath) {
    throw Object.assign(new Error('Worca needs Node 22.19 or newer to run from a checkout: install it or set WORCA_DESKTOP_NODE'), { code: 'NODE_NOT_FOUND' });
  }
  return { nodePath, serverRoot: resolve(desktopDir, '..') };
}

/**
 * The server's env: the app's own env minus every ELECTRON_* key, the login-shell PATH merged in front (darwin/linux),
 * PORT and WORCA_DESKTOP=1 (the in-app npm updater stays off). It never invents WORCA_HOME, WORCA_UI_SUPERVISOR or
 * WORCA_HOST: the server shares the store a CLI or web install uses.
 */
export function buildServerEnv({ baseEnv = process.env, loginPath = null, port, platform = process.platform }) {
  const env = {};
  for (const [k, v] of Object.entries(baseEnv || {})) {
    if (k.startsWith('ELECTRON_') || v === undefined) continue;
    env[k] = String(v);
  }
  if (platform !== 'win32') env.PATH = mergePath(loginPath, env.PATH);
  env.PORT = String(port);
  env.WORCA_DESKTOP = '1';
  return env;
}

export function serverSpawnSpec({ nodePath, serverRoot, env, home }) {
  return {
    command: nodePath,
    args: ['--disable-warning=ExperimentalWarning', join(serverRoot, 'ui', 'server.mjs')],
    options: { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: false },
  };
}

const hasExited = (child) => (child.exitCode ?? null) !== null || (child.signalCode ?? null) !== null;

/**
 * Spawn the server and wait until it is ready. Resolves a ServerHandle
 * `{ child, pid, url, port, owned: true, exited, stderrTail() }`. A failed start stops the child first, then rethrows.
 * `onSpawn(handle)` runs as soon as the child exists (url and port still null), so a Quit during the start can stop it.
 */
export async function startServer({ runtime, env, spawn = realSpawn, waitForReady = realWaitForReady, logStream = null, home, readyTimeoutMs = 60000, onSpawn = null }) {
  const spec = serverSpawnSpec({ nodePath: runtime.nodePath, serverRoot: runtime.serverRoot, env, home });
  const child = spawn(spec.command, spec.args, spec.options);
  let tail = '';
  const exited = new Promise((r) => {
    if (hasExited(child)) r({ code: child.exitCode ?? null, signal: child.signalCode ?? null });
    else child.once('exit', (code, signal) => r({ code, signal }));
  });
  child.once('error', () => { /* spawn failure: the exit/timeout path reports it */ });
  if (child.stderr) child.stderr.on('data', (d) => { tail = (tail + String(d)).slice(-STDERR_TAIL_BYTES); });
  if (logStream) {
    if (child.stdout) child.stdout.pipe(logStream, { end: false });
    if (child.stderr) child.stderr.pipe(logStream, { end: false });
  }
  const handle = { child, pid: child.pid, url: null, port: null, owned: true, exited, stderrTail: () => tail };
  if (onSpawn) onSpawn(handle);
  try {
    const ready = await waitForReady(child, { timeoutMs: readyTimeoutMs });
    handle.url = ready.url;
    handle.port = ready.port;
    return handle;
  } catch (err) {
    await stopServer(handle, { storeDir: null }).catch(() => {});
    throw err;
  }
}

/** Wait for `exited` up to ms; true when it exited. */
function exitedWithin(handle, ms, setT, clearT) {
  return new Promise((r) => {
    let t = null;
    handle.exited.then(() => { if (t !== null) clearT(t); r(true); });
    t = setT(() => r(false), ms);
  });
}

/**
 * Stop ONLY handle.child. The shutdown request goes out only when <storeDir>/ui.json is this child (same pid AND port);
 * otherwise, or when the request is not answered 202, SIGTERM to the child; SIGKILL when it outlives timeoutMs
 * (above the server's ~33 s drain backstop). Never signals a pid read from a file.
 */
export async function stopServer(handle, { storeDir, readFile = readFileSync, fetch = globalThis.fetch, timeoutMs = 40000, graceMs = 5000, setTimeout: setT = globalThis.setTimeout, clearTimeout: clearT = globalThis.clearTimeout } = {}) {
  const { child } = handle;
  if (hasExited(child)) return { exitCode: child.exitCode ?? null, via: 'already-exited' };
  let via = 'signal';
  let file = null;
  if (storeDir) {
    try { file = JSON.parse(String(readFile(join(storeDir, 'ui.json'), 'utf8'))); } catch { file = null; }
  }
  if (file && Number(file.pid) === handle.pid && Number(file.port) === handle.port && typeof file.token === 'string' && handle.url) {
    try {
      const r = await fetch(`${handle.url}/api/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${file.token}` }, signal: AbortSignal.timeout(5000) });
      if (r && r.status === 202) via = 'request';
    } catch { /* fall through to the signal */ }
  }
  if (via === 'signal') { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
  if (!(await exitedWithin(handle, timeoutMs, setT, clearT))) {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    await exitedWithin(handle, graceMs, setT, clearT);
  }
  return { exitCode: hasExited(child) ? (child.exitCode ?? null) : null, via };
}
