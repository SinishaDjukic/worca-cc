// src/core/ui-instance.mjs
// The web UI is a singleton over the machine-wide store, so `worca ui` needs to
// know whether one is already up before it spawns another — and needs a way to
// stop the one that is. This module is the CLI side of that lifecycle; the server
// side (GET /api/health, POST /api/shutdown, the instance file) lives in
// ui/server.mjs.
//
// Discovery is the Jupyter runtime-file pattern: the server writes
// <worcaHome>/ui.json ({ pid, host, port, token, version, startedAt }) once it is
// listening and removes it on exit. The file is a HINT, never the truth — a
// crashed server leaves it behind, so every decision re-probes the port:
//
//   probeUi({ port })  -> { state: 'worca', info }   a Worca UI answered /api/health
//                      -> { state: 'busy' }          something else owns the port
//                      -> { state: 'free' }          nothing is listening
//
// Stopping goes through POST /api/shutdown with the file's bearer token so the
// server runs its graceful path (chat channel workers die cleanly) on every
// platform — a bare signal is a hard kill on Windows. The signal is the fallback
// when the token is unavailable (file missing, or a server too old to have one).

import fs from 'node:fs';
import http from 'node:http';
import fsp from 'node:fs/promises';
import process from 'node:process';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { worcaHome } from './projects.mjs';

export const DEFAULT_UI_PORT = 4317;
export const DEFAULT_UI_HOST = '127.0.0.1';
/** What GET /api/health must report as `name` for the occupant to count as a Worca UI. */
export const UI_HEALTH_NAME = '@worca/app';

/** Absolute path of the instance file for the current worcaHome. */
export function uiInstanceFile() {
  return join(worcaHome(), 'ui.json');
}

/** A fresh shutdown token (hex, 32 bytes of entropy). */
export function newUiToken() {
  return randomBytes(32).toString('hex');
}

/**
 * Persist the running instance's coordinates. Atomic (tmp + rename) and 0600:
 * the token authorizes a shutdown, so it must not be world-readable.
 */
export async function writeUiInstance({ pid, host, port, token, version, startedAt }) {
  const file = uiInstanceFile();
  await fsp.mkdir(join(file, '..'), { recursive: true });
  const tmp = `${file}.${pid}.tmp`;
  const body = JSON.stringify({ pid, host, port, token, version, startedAt }, null, 2) + '\n';
  await fsp.writeFile(tmp, body, { mode: 0o600 });
  await fsp.rename(tmp, file);
  return file;
}

/** The instance file's contents, or null when missing/corrupt/not an object. */
export function readUiInstance() {
  try {
    const data = JSON.parse(fs.readFileSync(uiInstanceFile(), 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const port = Number(data.port);
    if (!Number.isInteger(port) || port <= 0) return null;
    return { ...data, port, pid: Number(data.pid) || null };
  } catch {
    return null;
  }
}

/**
 * Remove the instance file. With `ifPid`, only when the file still belongs to
 * that process — an old server exiting late must not delete the file a newer
 * one just wrote. Synchronous so it is usable from a process 'exit' handler.
 */
export function removeUiInstance({ ifPid } = {}) {
  const file = uiInstanceFile();
  try {
    if (ifPid !== undefined) {
      const cur = readUiInstance();
      if (cur && cur.pid && cur.pid !== ifPid) return false;
    }
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/** Host as it appears inside a URL (IPv6 literals need brackets). */
export function urlHost(host) {
  if (!host) return 'localhost';
  if (host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === 'localhost') return 'localhost';
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/** The URL a browser should open for a UI bound to host:port. */
export function uiUrl({ host = DEFAULT_UI_HOST, port = DEFAULT_UI_PORT } = {}) {
  return `http://${urlHost(host)}:${port}`;
}

/** Host to CONNECT to (bind-any addresses are not dialable). */
function dialHost(host) {
  if (!host || host === '0.0.0.0' || host === '::') return DEFAULT_UI_HOST;
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/** Every error code nested in a request failure (Node wraps them in `cause`, sometimes an AggregateError). */
function errorCodes(err) {
  const out = new Set();
  const walk = (e, depth) => {
    if (!e || depth > 4) return;
    if (typeof e.code === 'string') out.add(e.code);
    if (e.cause) walk(e.cause, depth + 1);
    if (Array.isArray(e.errors)) for (const inner of e.errors) walk(inner, depth + 1);
  };
  walk(err, 0);
  return out;
}

/**
 * One-shot HTTP call on a throwaway connection. NOT fetch(): the lifecycle verbs
 * call process.exit() right after a probe, and undici's pooled keep-alive socket is
 * still closing at that moment — on Windows libuv asserts on it
 * (`!(handle->flags & UV_HANDLE_CLOSING)`, src/win/async.c) and the CLI dies with
 * 0xC0000409 instead of its exit code, after printing the right message. A bare
 * `agent: false` + `Connection: close` request leaves nothing behind to tear down.
 * Rejects with the socket error (its `code` intact, e.g. ECONNREFUSED) or the
 * signal's AbortError.
 */
function request(url, { method = 'GET', headers = {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, agent: false, signal, headers: { ...headers, connection: 'close' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => resolve({
        status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** GET a JSON object from the UI, or null (non-2xx, non-JSON, non-object). Network errors propagate. */
async function getJson(url, signal) {
  const res = await request(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  try {
    const data = JSON.parse(res.text);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Ask host:port whether a Worca UI is listening there.
 *
 * @returns {Promise<{state:'worca', info:object} | {state:'busy'} | {state:'free'}>}
 *   'busy' covers every occupant that is not a Worca UI: a non-JSON answer, a
 *   different `name`, a hang (timeout) or a reset. Only a clean connection
 *   refusal is 'free'. A Worca UI from before /api/health existed is recognised
 *   by its settings route and reported with `info.legacy = true` (no pid, no
 *   token — it cannot be stopped from here, only from its own terminal).
 */
export async function probeUi({ host = DEFAULT_UI_HOST, port = DEFAULT_UI_PORT, timeoutMs = 1500 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const base = `http://${dialHost(host)}:${port}`;
  try {
    const info = await getJson(`${base}/api/health`, ctl.signal);
    if (info) return info.name === UI_HEALTH_NAME ? { state: 'worca', info } : { state: 'busy' };
    const legacy = await getJson(`${base}/api/settings`, ctl.signal);
    if (legacy && typeof legacy.projectsRootDefault === 'string' && 'askMaxTurns' in legacy) {
      return { state: 'worca', info: { name: UI_HEALTH_NAME, legacy: true } };
    }
    return { state: 'busy' };
  } catch (err) {
    const codes = errorCodes(err);
    if (codes.has('ECONNREFUSED')) return { state: 'free' };
    return { state: 'busy' };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until probeUi reports `state` (or any of `states`), or give up after timeoutMs. */
export async function waitForUiState({ host, port, states, timeoutMs = 10000, intervalMs = 100 } = {}) {
  const want = new Set(Array.isArray(states) ? states : [states]);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await probeUi({ host, port, timeoutMs: Math.min(1500, Math.max(200, deadline - Date.now())) });
    if (want.has(r.state)) return r;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

/** True when a process with that pid exists (signal 0 probes without killing). */
export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err && err.code === 'EPERM'; }
}

/**
 * Stop the Worca UI on host:port, gracefully when possible.
 *
 * Order: (1) POST /api/shutdown with the instance file's token — the server
 * answers 202 and exits through its signal path; (2) if that is refused or no
 * token is known, SIGTERM the pid the health probe reported; (3) wait for the
 * port to free up. Idempotent: a port with no Worca UI is `notRunning`, not an
 * error. The instance file is cleaned up whenever the port ends up free.
 *
 * @returns {Promise<{status:'stopped', method:'request'|'signal', pid:number|null}
 *                  |{status:'not-running'}
 *                  |{status:'busy'}
 *                  |{status:'failed', pid:number|null, reason:string}
 *                  |{status:'timeout', pid:number|null}>}
 */
export async function stopUi({ host = DEFAULT_UI_HOST, port = DEFAULT_UI_PORT, token, timeoutMs = 10000 } = {}) {
  const probe = await probeUi({ host, port });
  if (probe.state === 'free') { removeUiInstance(); return { status: 'not-running' }; }
  if (probe.state === 'busy') return { status: 'busy' };
  if (probe.info.legacy) {
    return { status: 'failed', pid: null, reason: 'it is an older Worca UI without shutdown support — stop it from its own terminal (Ctrl+C) and start again' };
  }
  const pid = Number(probe.info.pid) || null;

  const file = readUiInstance();
  const bearer = token || (file && file.port === port ? file.token : null);
  let method = null;

  if (bearer) {
    try {
      const res = await request(`http://${dialHost(host)}:${port}/api/shutdown`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 202 || res.status === 200) method = 'request';
    } catch {
      // The server may drop the connection while exiting — the wait below decides.
      method = 'request';
    }
  }
  if (!method && pid) {
    try { process.kill(pid, 'SIGTERM'); method = 'signal'; } catch { /* already gone, or not ours */ }
  }
  if (!method) return { status: 'failed', pid, reason: 'no shutdown token in the instance file and no pid to signal' };

  const freed = await waitForUiState({ host, port, states: ['free'], timeoutMs });
  if (!freed) return { status: 'timeout', pid };
  removeUiInstance();
  return { status: 'stopped', method, pid };
}
