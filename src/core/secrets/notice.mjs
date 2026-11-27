// src/core/secrets/notice.mjs — the pending one-time message about secrets moved into the vault: NOTICE_FILE in the
// Worca home, 0600, written atomically. `{ format: 1, id, at, backend, label, keys: [{ store, name }], left }`: key names
// and counts only, never a value or a reference. The migration records it under its lock; the CLI (`worca secrets ack`)
// and Settings › About (Got it) acknowledge it with a compare-and-delete on `id`, under the same lock.
import { randomBytes } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from '../json-atomic.mjs';
import { acquireLock } from '../metrics/lock.mjs';
import { worcaHome } from '../projects.mjs';
import { MIGRATE_LOCK_FILE, NOTICE_FILE } from './files.mjs';
import { VAULT_STORES } from './refs.mjs';

const FORMAT = 1;
const ID_RE = /^[0-9a-f]{16}$/;

const fileOf = (home) => join(home ?? worcaHome(), NOTICE_FILE);
const validKey = (k) => !!k && typeof k === 'object' && VAULT_STORES.includes(k.store) && typeof k.name === 'string' && k.name.length > 0;

/** The pending notice of `home`, or null (none, malformed or an unknown format). Never throws. */
export function readNotice({ home } = {}) {
  try {
    const n = JSON.parse(readFileSync(fileOf(home), 'utf8'));
    if (!n || typeof n !== 'object' || n.format !== FORMAT || !ID_RE.test(n.id) || !Array.isArray(n.keys) || !n.keys.every(validKey)) return null;
    return {
      format: FORMAT, id: n.id, at: String(n.at ?? ''), backend: String(n.backend ?? ''), label: String(n.label ?? ''),
      keys: n.keys.map((k) => ({ store: k.store, name: k.name })), left: Number.isInteger(n.left) && n.left > 0 ? n.left : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Record moved `keys` (`[{ store, name }]`) for `home`: merged into a pending notice (deduped on store + name), with a
 * fresh 16-hex `id` (so an acknowledgement of the older record clears nothing), written atomically at 0600.
 * @returns {object} the notice written
 */
export function recordMoveNotice({ home, backend, label, keys = [], left = 0, now = Date.now } = {}) {
  const prior = readNotice({ home });
  const merged = [];
  const seen = new Set();
  for (const k of [...(prior?.keys ?? []), ...keys.filter(validKey)]) {
    const id = `${k.store}\0${k.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push({ store: k.store, name: k.name });
  }
  const notice = {
    format: FORMAT, id: randomBytes(8).toString('hex'), at: new Date(now()).toISOString(),
    backend: String(backend ?? ''), label: String(label ?? ''), keys: merged,
    left: Math.max(prior?.left ?? 0, Number.isInteger(left) && left > 0 ? left : 0),
  };
  writeJsonAtomic(fileOf(home), notice, { mode: 0o600 });
  return notice;
}

/** How long an acknowledgement waits for a running migration's lock before it gives up (false). */
export const ACK_LOCK_WAIT_MS = 2_000;

/**
 * Delete `home`'s notice only while its id is `id` (compare-and-delete), under the migration lock (MIGRATE_LOCK_FILE),
 * so a migration recording a newer notice between the read and the unlink keeps it. `held` says the caller already
 * holds that lock (export). True when one was deleted; a busy lock, a stale id or any error is false. Never rejects.
 */
export async function ackNotice({ home, id, held = false, lockWaitMs = ACK_LOCK_WAIT_MS } = {}) {
  const h = home ?? worcaHome();
  let release = null;
  try {
    if (!held) release = await acquireLock(join(h, MIGRATE_LOCK_FILE), { timeoutMs: lockWaitMs, mode: 0o600 });
    const cur = readNotice({ home: h });
    if (!cur || typeof id !== 'string' || cur.id !== id) return false;
    unlinkSync(fileOf(h));
    return true;
  } catch {
    return false;
  } finally {
    await release?.().catch(() => {});
  }
}
