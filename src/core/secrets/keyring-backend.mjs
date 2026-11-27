// src/core/secrets/keyring-backend.mjs — the macOS Keychain, Windows Credential Manager and Linux Secret Service
// backends, through the optional native `@napi-rs/keyring`. The only module that touches that package. It is loaded
// lazily (a missing binding gives null), only the async entry is used so a hung store never blocks the event loop, and
// every entry is pinned to the Secret Service on Linux: the kernel keyring fallback is never used.
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PRIME_MS = 1000;
const LOCKED_RE = /NoStorageAccess|locked|denied|cancel/i;
const ENTRY_OPTIONS = Object.freeze({ linux: Object.freeze({ store: 'secret-service' }) });

let cached; // undefined: not tried yet

/** `@napi-rs/keyring`, or null when it cannot be loaded (no binding, unsupported arch, a missing libdbus). Cached. */
export function loadKeyring({ requireImpl = require } = {}) {
  if (cached !== undefined) return cached;
  try { cached = requireImpl('@napi-rs/keyring'); } catch { cached = null; }
  return cached;
}
export function _resetKeyringForTests() { cached = undefined; }

const storeError = (code) => Object.assign(new Error(`OS key store: ${code}`), { code });
// The library's own text is matched, never kept.
const mapError = (err) => storeError(LOCKED_RE.test(String(err?.message ?? err)) ? 'locked' : 'unavailable');

/**
 * An OS store over `new keyring.AsyncEntry(item.service, item.account, { linux: { store: 'secret-service' } })`.
 * In-flight guard: one native call per store at a time. A getKey made while a read is pending joins that read; any
 * other call waits for the pending one to settle first, so a hung store holds at most one native task. `prime(key)`
 * keeps a probe's answer for the next getKey within 1000 ms. `probe()` round-trips random bytes on a second entry,
 * `probeItem` (never `item`), through the same guard, and drops the primed answer first. `deleteKey()` removes the item
 * through the same guard.
 */
export function keyringOsStore({ keyring, item, kind, probeItem, now = Date.now }) {
  let entry = null;
  let pending = null; // { op, promise }
  let primed = null; // { key, at }

  const entryOf = () => (entry ??= new keyring.AsyncEntry(item.service, item.account, ENTRY_OPTIONS));

  function track(op, start) {
    const promise = Promise.resolve().then(start);
    const p = { op, promise };
    pending = p;
    const clear = () => { if (pending === p) pending = null; };
    promise.then(clear, clear);
    return promise;
  }

  async function nativeGet(signal) {
    while (pending) {
      if (pending.op === 'get') return pending.promise;
      await pending.promise.catch(() => {});
    }
    return track('get', () => entryOf().getSecret(signal));
  }

  // A caller that timed out while waiting never writes: its existence read is stale and the vault lock is gone.
  // The abort check and track() run in one synchronous step, so no other call slips in between.
  async function nativeSet(bytes, signal) {
    while (pending) await pending.promise.catch(() => {});
    if (signal?.aborted) throw storeError('locked');
    return track('set', () => entryOf().setSecret(bytes, signal));
  }

  // Write, read back, compare; the delete runs once the write happened, whatever the read gave.
  async function nativeProbe(signal) {
    const probeEntry = new keyring.AsyncEntry(probeItem.service, probeItem.account, ENTRY_OPTIONS);
    const bytes = randomBytes(32);
    try { await probeEntry.setSecret(bytes, signal); } catch (err) { throw mapError(err); }
    let failure = null;
    try {
      const raw = await probeEntry.getSecret(signal);
      if (raw == null) failure = storeError('probe-missing');
      else if (!Buffer.from(raw).equals(bytes)) failure = storeError('probe-mismatch');
    } catch (err) { failure = mapError(err); }
    let deleted = false;
    try { deleted = (await probeEntry.deleteCredential(signal)) !== false; } catch { deleted = false; }
    if (failure) throw failure;
    if (!deleted) throw storeError('probe-delete');
  }

  function dropPrimed() {
    if (primed?.key) primed.key.fill(0);
    primed = null;
  }

  async function readKey(signal) {
    let raw;
    try { raw = await nativeGet(signal); } catch (err) { throw mapError(err); }
    return raw == null ? null : Buffer.from(raw);
  }

  return {
    kind,
    prime(key) {
      dropPrimed();
      primed = { key, at: now() };
    },
    async getKey({ signal } = {}) {
      if (primed) {
        const p = primed;
        primed = null;
        if (now() - p.at <= PRIME_MS) return p.key;
        if (p.key) p.key.fill(0);
      }
      return readKey(signal);
    },
    async probe({ signal } = {}) {
      dropPrimed();
      if (!probeItem) throw storeError('unavailable');
      while (pending) await pending.promise.catch(() => {});
      if (signal?.aborted) throw storeError('locked');
      return track('probe', () => nativeProbe(signal));
    },
    // Remove the key item (export). Waits for the pending call, then one native delete through the guard. True when
    // an item was removed.
    async deleteKey({ signal } = {}) {
      dropPrimed();
      while (pending) await pending.promise.catch(() => {});
      if (signal?.aborted) throw storeError('locked');
      try {
        return (await track('delete', () => entryOf().deleteCredential(signal))) !== false;
      } catch (err) { throw mapError(err); }
    },
    // Create-only: an existing item is never replaced.
    async setKey(key, { signal } = {}) {
      dropPrimed();
      if ((await readKey(signal)) !== null) throw storeError('exists');
      if (signal?.aborted) throw storeError('locked');
      try { await nativeSet(key, signal); } catch (err) { throw err?.code === 'locked' ? err : mapError(err); }
    },
  };
}
