// src/core/exec-env/status.mjs
// The live status of each execution backend (GET /api/exec-envs/status, docs/e2b.md "Which E2B server Worca uses"):
// the backend's own status() (reachable, key, running sandboxes) plus what this server knows — the cap
// (maxConcurrent) and its runs queued for a slot (slots.mjs). One entry per backend with a `servers` list, which
// holds one server today (a backend reaches the server its env names); several servers per backend are #806.
import { execEnvLimit } from '../settings.mjs';
import { listExecBackends } from './registry.mjs';
import { slotWaiters } from './slots.mjs';
import { STATUS_REQUEST_TIMEOUT_MS } from './e2b-config.mjs';

export const STATUS_CACHE_MS = 5_000;
const STATUS_TIMEOUT_MS = STATUS_REQUEST_TIMEOUT_MS + 1_000;   // a backend that ignores its own request cap

/** One backend's entry. Never throws: a backend that throws or hangs past `timeoutMs` reads unreachable. */
export async function execEnvStatus(backend, { env = process.env, mock = false, timeoutMs = STATUS_TIMEOUT_MS } = {}) {
  let timer;
  let s;
  try {
    // The timer stays ref'd: a hung backend may leave nothing else pending, and it is cleared once the check settles.
    s = await Promise.race([backend.status({ env, mock }), new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`the status check timed out after ${timeoutMs} ms`)), timeoutMs);
    })]);
  } catch (err) {
    let server = backend.title;
    try { server = backend.serverIdentity?.(env)?.label || server; } catch { /* keep the title */ }
    s = { state: 'unreachable', server, error: String(err?.message || err) };
  } finally { clearTimeout(timer); }
  const one = { label: s.server, state: s.state, running: s.state === 'connected' && Number.isFinite(s.running) ? s.running : null,
    cap: execEnvLimit(backend, 'maxConcurrent'), waiting: slotWaiters(backend.name), ...(s.error ? { error: s.error } : {}) };
  return { name: backend.name, label: backend.label, title: backend.title, state: one.state, servers: [one] };
}

let cache = null;   // { at, promise }
export function _resetExecEnvStatusForTests() { cache = null; }

/** Every backend with a status(), cached STATUS_CACHE_MS so many open pages polling cost one provider call. */
export function execEnvStatuses({ env = process.env, mock = false, now = Date.now } = {}) {
  const t = now();
  if (!cache || t - cache.at >= STATUS_CACHE_MS) {
    cache = { at: t, promise: Promise.all(listExecBackends().filter((b) => typeof b.status === 'function').map((b) => execEnvStatus(b, { env, mock }))) };
  }
  return cache.promise;
}
