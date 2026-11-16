// src/core/github-quota.mjs
// The GitHub quota window every Worca process on this machine honours (F-X-02). When GitHub says a
// resource's quota is used up, the reset time is written to <worcaHome>/github/quota.json; every
// read-only gh call checks it first and spawns nothing until then. One window per resource: GraphQL
// and REST core have separate quotas, so REST keeps working while GraphQL is used up.
// Leaf module: node:fs, node:path, json-atomic and worcaHome only. Nothing here throws. Without a
// Worca home (no WORCA_HOME under node --test) or while suspended (a scripted test runner) every
// call is a no-op: quotaBlocked is null and a noted window is returned, never stored.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './json-atomic.mjs';
import { worcaHome } from './projects.mjs';

const RESOURCES = new Set(['graphql', 'core']);
const MIN_WINDOW_MS = 5_000;
const MAX_WINDOW_MS = 3_600_000;
export const QUOTA_FALLBACK_MS = 15 * 60_000;

let _dir = null;
let _suspended = false;

/** <worcaHome>/github/quota.json, or the test override's quota.json. Throws only when there is no home. */
export function quotaPath() {
  return join(_dir || join(worcaHome(), 'github'), 'quota.json');
}

/** The file's path, or null when the module is suspended or there is no Worca home. */
function activePath() {
  if (_suspended) return null;
  try { return quotaPath(); } catch { return null; }
}

function readFileState(path) {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'));
    return v && typeof v === 'object' && v.v === 1 ? v : { v: 1 };
  } catch { return { v: 1 }; }
}

/** Is a window recorded at all (a Worca home, not suspended)? Lets a caller skip work that only feeds the file. */
export function quotaTracking() {
  return activePath() !== null;
}

/** { until } while `resource`'s quota is used up, else null. */
export function quotaBlocked(resource, { now = Date.now() } = {}) {
  const path = RESOURCES.has(resource) ? activePath() : null;
  if (!path) return null;
  const w = readFileState(path)[resource];
  return w && Number.isFinite(w.until) && now < w.until ? { until: w.until } : null;
}

/**
 * Record that `resource`'s quota is used up until `resetAt` (ms), or for `fallbackMs` when GitHub gave no reset.
 * Clamped to 5 s … 60 min from now; a later window already on file is never shortened. No lock: two writers race
 * to near-equal values. → { until }.
 */
export function noteQuotaExhausted(resource, { resetAt = null, fallbackMs = QUOTA_FALLBACK_MS, now = Date.now(), source = null } = {}) {
  const raw = Number.isFinite(resetAt) ? resetAt : now + fallbackMs;
  const until = Math.min(Math.max(raw, now + MIN_WINDOW_MS), now + MAX_WINDOW_MS);
  const path = RESOURCES.has(resource) ? activePath() : null;
  if (!path) return { until };
  try {
    const state = readFileState(path);
    const prev = state[resource];
    if (prev && Number.isFinite(prev.until) && prev.until > until) return { until: prev.until };
    state[resource] = { until, at: now, source: source || (Number.isFinite(resetAt) ? 'reset' : 'fallback') };
    writeJsonAtomic(path, state);
  } catch { /* a window that cannot be written only costs one more call */ }
  return { until };
}

/** Does gh's stderr (or an API message) say a rate limit was hit? One definition for every caller. */
export function isRateLimitText(text) {
  return /rate.?limit|secondary rate|abuse detection/i.test(String(text || ''));
}

/** 'HH:MM' in local time, for the skipped-call message and the metrics status. */
export function formatResetTime(until) {
  const d = new Date(until);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const _testing = {
  useDir(dir) { _dir = dir || null; if (dir) _suspended = false; },
  suspend() { _suspended = true; },
  resume() { _suspended = false; },
  reset() { _dir = null; _suspended = false; },
};
