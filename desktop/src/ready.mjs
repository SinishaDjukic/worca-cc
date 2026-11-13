// desktop/src/ready.mjs — when the server the desktop app started is ready (docs/desktop.md).
// The server prints `[worca-ui] listening on <url> (bound to <host>)` once it listens (ui/server.mjs); the app then
// asks /api/health and accepts only an answer whose pid is its own child. Imports only node: builtins.

export const READY_RE = /\[worca-ui\] listening on (http:\/\/[^\s]+) \(bound to /;
export const PORT_BUSY_RE = /\[worca-ui\] port \d+ is already in use/;
const STDERR_TAIL_BYTES = 64 * 1024;
const PROBE_EVERY_MS = 250;
const EXIT_FLUSH_MS = 500;

/** `{ url, port }` from text holding the server's ready line, or null. */
export function parseReadyLine(text) {
  const m = READY_RE.exec(String(text || ''));
  if (!m) return null;
  let port;
  try { port = Number(new URL(m[1]).port); } catch { return null; }
  if (!Number.isInteger(port) || port <= 0) return null;
  return { url: m[1], port };
}

/** GET <url>/api/health → `{ name, version, pid, port }`, or null when it does not answer as a server. */
export async function probeHealth(url, { fetch = globalThis.fetch, timeoutMs = 1500 } = {}) {
  try {
    const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!r || !r.ok) return null;
    const h = await r.json();
    if (!h || typeof h !== 'object') return null;
    return { name: h.name, version: h.version, pid: h.pid, port: h.port };
  } catch {
    return null;
  }
}

function failure(code, message, stderrTail, extra = {}) {
  return Object.assign(new Error(message), { code, stderrTail, ...extra });
}

/**
 * Resolves `{ url, port, health }` once `child` printed its ready line and /api/health answers from that very pid.
 * Rejects with an Error carrying `.code` (SERVER_EXITED with `.portBusy`, also for a spawn error; SERVER_TIMEOUT;
 * SERVER_NOT_OURS) and `.stderrTail` (the last 64 KiB of stderr). Every listener and timer is removed when it settles.
 */
export function waitForReady(child, { timeoutMs = 60000, probe = probeHealth, setTimeout: setT = globalThis.setTimeout, clearTimeout: clearT = globalThis.clearTimeout } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBuf = '';
    let stderrTail = '';
    let ready = null;
    const timers = new Set();
    const later = (fn, ms) => { const t = setT(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

    const onStdout = (chunk) => {
      if (ready) return;
      stdoutBuf += String(chunk);
      let nl;
      while (!ready && (nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl);
        stdoutBuf = stdoutBuf.slice(nl + 1);
        const hit = parseReadyLine(line);
        if (hit) { ready = hit; stdoutBuf = ''; probeLoop(); }
      }
      if (stdoutBuf.length > STDERR_TAIL_BYTES) stdoutBuf = stdoutBuf.slice(-STDERR_TAIL_BYTES);
    };
    const onStderr = (chunk) => {
      stderrTail = (stderrTail + String(chunk)).slice(-STDERR_TAIL_BYTES);
    };
    const onExit = (code, signal) => {
      // stderr can still hold the busy-port line: let the stream drain (bounded) before deciding.
      const decide = () => {
        if (settled) return;
        const c = code ?? signal;
        finish(failure('SERVER_EXITED', `worca server exited with code ${c} before it was ready`, stderrTail, { portBusy: PORT_BUSY_RE.test(stderrTail), exitCode: code, signal }));
      };
      const err = child.stderr;
      if (!err || err.readableEnded || err.destroyed) return decide();
      err.once('end', decide);
      err.once('close', decide);
      later(decide, EXIT_FLUSH_MS);
    };

    // A spawn failure (the node binary is missing) emits only 'error', never 'exit'.
    const onError = (err) => {
      finish(failure('SERVER_EXITED', `worca server could not start: ${err && err.message ? err.message : err}`, stderrTail, { portBusy: false }));
    };

    function cleanup() {
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
      if (child.stdout) child.stdout.removeListener('data', onStdout);
      if (child.stderr) child.stderr.removeListener('data', onStderr);
      for (const t of timers) clearT(t);
      timers.clear();
    }
    function finish(err, value) {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err); else resolve(value);
    }
    async function probeLoop() {
      if (settled) return;
      const health = await probe(ready.url);
      if (settled) return;
      if (health && health.name === '@worca/app') {
        if (health.pid === child.pid) return finish(null, { url: ready.url, port: ready.port, health });
        return finish(failure('SERVER_NOT_OURS', `the worca server on ${ready.url} is process ${health.pid}, not the one this app started (${child.pid})`, stderrTail));
      }
      later(probeLoop, PROBE_EVERY_MS);
    }

    child.on('exit', onExit);
    child.on('error', onError);
    if (child.stdout) child.stdout.on('data', onStdout);
    if (child.stderr) child.stderr.on('data', onStderr);
    later(() => finish(failure('SERVER_TIMEOUT', `worca server was not ready after ${Math.round(timeoutMs / 1000)} s`, stderrTail)), timeoutMs);
  });
}
