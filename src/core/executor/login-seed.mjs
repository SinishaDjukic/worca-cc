// src/core/executor/login-seed.mjs
// A Claude Code sign-in stored on the controller (`worca container login`: its ~/.claude volume) reaches a worker
// as a COPY — and copies of one OAuth sign-in fall out of step: a refresh rotates the refresh token, so the first
// copy to refresh invalidates every other. Two rules keep the copies usable without a broker or a long-lived token:
//   seedClaudeLogin    worker side, before it starts and before every spawn: the seed is copied in when this HOME has
//                      none, and again when the seed is NEWER (a login renewed on the controller reaches a living
//                      worker; a token this HOME's own engine refreshed is newer than the seed and stays).
//   reclaimClaudeLogin controller side, when a worker is released: a sign-in the worker's engine refreshed (newer,
//                      and expiring later, than the seed's) is written back, so the next worker — and the controller's
//                      own helper spawns — start from the live token rather than the revoked one.
// No worca imports: the worker process loads this module too.
import { existsSync, mkdirSync, copyFileSync, chmodSync, statSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export const LOGIN_FILES = Object.freeze(['.credentials.json', 'settings.json']);
const CREDENTIALS = '.credentials.json';

/** When the OAuth access token in a Claude credentials file expires (ms since epoch), or null when unreadable. */
export function loginExpiresAt(file) {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))?.claudeAiOauth?.expiresAt;
    return Number.isFinite(v) ? Number(v) : null;
  } catch { return null; }
}

/**
 * Copy the seed's sign-in and settings into `home/.claude` when that HOME has none, and again when the seed is newer.
 * Never sessions or projects, which belong to this HOME. Best effort (a read-only seed, nothing to copy).
 * @returns {string[]} the files copied
 */
export function seedClaudeLogin(home, seedDir) {
  const dir = String(seedDir || '').trim();
  if (!dir || !home) return [];
  const copied = [];
  const target = join(home, '.claude');
  for (const name of LOGIN_FILES) {
    const from = join(dir, name);
    const to = join(target, name);
    if (!existsSync(from)) continue;
    if (existsSync(to)) { try { if (statSync(from).mtimeMs <= statSync(to).mtimeMs) continue; } catch { continue; } }
    try { mkdirSync(target, { recursive: true, mode: 0o700 }); copyFileSync(from, to); chmodSync(to, 0o600); copied.push(name); } catch { /* read-only seed, or nothing to copy */ }
  }
  return copied;
}

/**
 * Write a sign-in the worker's engine refreshed back into the seed: only when the HOME's copy is newer than the
 * seed's AND its token expires later (a copy whose refresh FAILED is newer too, with its expiry cleared — never that
 * one). Written next to the seed and renamed into place, so a worker copying the seed meanwhile reads whole files.
 * Best effort; never throws.
 * @returns {boolean} whether the seed was replaced
 */
export function reclaimClaudeLogin(home, seedDir) {
  const dir = String(seedDir || '').trim();
  if (!dir || !home) return false;
  const from = join(home, '.claude', CREDENTIALS);
  const to = join(dir, CREDENTIALS);
  try {
    if (!existsSync(from)) return false;
    const fresh = loginExpiresAt(from);
    if (!(fresh > 0)) return false;
    if (existsSync(to)) {
      if (statSync(from).mtimeMs <= statSync(to).mtimeMs) return false;
      const seed = loginExpiresAt(to);
      if (seed != null && fresh <= seed) return false;
    }
    const tmp = `${to}.${process.pid}.${Date.now().toString(36)}.tmp`;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(tmp, readFileSync(from), { mode: 0o600 });
    renameSync(tmp, to);
    return true;
  } catch { return false; }
}
