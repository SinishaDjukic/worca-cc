// src/core/secrets/vault.mjs — the encrypted Worca vault: one file (VAULT_FILE in the Worca home), AES-256-GCM under
// a 32-byte master key that lives only in the OS key store (os-store.mjs). The file is a JSON envelope
// `{ format: 1, keyId, nonce, tag, data }`, written only through writeJsonAtomic at mode 0600, with a fresh nonce on
// every write. The plaintext is `{ entries: { [id]: { store, field, value, droppedAt? } } }`: the owner sits inside
// the authenticated ciphertext, and every reference resolves only for the owner it was created for. `droppedAt` (ms
// since the epoch) marks an entry a lockless store's write dropped; it still resolves (store-vault.mjs releases it
// after a grace period).
//
// Every read-modify-write runs inside one cross-process lock (VAULT_LOCK_FILE, metrics/lock.mjs) through
// `transaction`. The lock order is fixed: a store lock first, the vault lock second. The vault lock never nests,
// across every vault instance in the process, and later store locks call `assertVaultLockFree` before they wait.
// Refusals are VaultErrors with fixed messages; a refusal never changes the vault file.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, linkSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { writeJsonAtomic } from '../json-atomic.mjs';
import { withLock } from '../metrics/lock.mjs';
import { worcaHome } from '../projects.mjs';
import { VAULT_ASIDE_INFIX, VAULT_FILE, VAULT_LOCK_FILE } from './files.mjs';
import { secretVaultEnabled } from './flag.mjs';
import { crashPoint } from './crash-point.mjs';
import { callStore, selectOsStore, storeTimeoutMs as defaultStoreTimeoutMs } from './os-store.mjs';
import { VAULT_REF_PREFIX, VaultError, checkOwner, isVaultRef, newVaultRef, refId } from './refs.mjs';

export { VaultError };

const FORMAT = 1;
/** The largest value the vault holds, in UTF-8 bytes. */
export const MAX_VALUE_BYTES = 65536;
const ENVELOPE_KEYS = 'data,format,keyId,nonce,tag';
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const ID_RE = /^[A-Za-z0-9_-]{22}$/;

/** The vault file of a Worca home. */
export function vaultFile(home) {
  return join(home, VAULT_FILE);
}

// Marks the vault lock as held, for every vault instance and home in this process.
const holding = new AsyncLocalStorage();
// Per-home in-process queues in front of the cross-process lock.
const queues = new Map();

/** Throws `lock-order` when called while this operation holds the vault lock (a store lock must never wait then). */
export function assertVaultLockFree(lockName) {
  if (holding.getStore()?.active) throw new VaultError('lock-order', { name: lockName });
}

function keyIdOf(key) {
  return createHash('sha256').update(Buffer.concat([Buffer.from('worca vault key id'), Buffer.from([0]), key])).digest('hex').slice(0, 16);
}

const aadOf = (keyId) => Buffer.from(`worca vault format=${FORMAT} keyId=${keyId}`, 'utf8');

function decode64(s, length) {
  if (typeof s !== 'string' || !BASE64_RE.test(s)) throw new VaultError('tampered');
  const b = Buffer.from(s, 'base64');
  if (length !== undefined && b.length !== length) throw new VaultError('tampered');
  return b;
}

/** The parsed envelope, or null when the file is missing. Shape errors are `tampered`. */
function readEnvelope(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new VaultError('tampered');
  }
  let env;
  try { env = JSON.parse(raw); } catch { throw new VaultError('tampered'); }
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw new VaultError('tampered');
  if (Number.isInteger(env.format) && env.format > FORMAT) throw new VaultError('unsupported-format', { format: env.format });
  if (env.format !== FORMAT || Object.keys(env).sort().join() !== ENVELOPE_KEYS) throw new VaultError('tampered');
  if (typeof env.keyId !== 'string' || !/^[0-9a-f]{16}$/.test(env.keyId)) throw new VaultError('tampered');
  return { keyId: env.keyId, nonce: decode64(env.nonce, 12), tag: decode64(env.tag, 16), data: decode64(env.data) };
}

const validValue = (v) => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= MAX_VALUE_BYTES;
const validMark = (t) => Number.isSafeInteger(t) && t >= 0;

function parseEntries(plain) {
  let obj;
  try { obj = JSON.parse(plain.toString('utf8')); } catch { throw new VaultError('tampered'); }
  const entries = obj?.entries;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new VaultError('tampered');
  const out = {};
  for (const [id, e] of Object.entries(entries)) {
    if (!ID_RE.test(id) || !e || typeof e !== 'object' || checkOwner(e) || !validValue(e.value)) throw new VaultError('tampered');
    if (e.droppedAt !== undefined && !validMark(e.droppedAt)) throw new VaultError('tampered');
    out[id] = { store: e.store, field: e.field, value: e.value };
    if (e.droppedAt !== undefined) out[id].droppedAt = e.droppedAt;
  }
  return out;
}

function decrypt(env, key) {
  let plain;
  try {
    const d = createDecipheriv('aes-256-gcm', key, env.nonce, { authTagLength: 16 });
    d.setAAD(aadOf(env.keyId));
    d.setAuthTag(env.tag);
    plain = Buffer.concat([d.update(env.data), d.final()]);
  } catch { throw new VaultError('tampered'); }
  return parseEntries(plain);
}

function encrypt(entries, key) {
  const keyId = keyIdOf(key);
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  c.setAAD(aadOf(keyId));
  const data = Buffer.concat([c.update(JSON.stringify({ entries }), 'utf8'), c.final()]);
  return { keyId, envelope: { format: FORMAT, keyId, nonce: nonce.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') } };
}

/**
 * The vault file's entries under `key`, read synchronously without the lock (the file is only ever replaced
 * atomically). `{ keyId, entries }`, or null when the file is missing. Throws VaultError `wrong-key`, `tampered` or
 * `unsupported-format`; GCM authentication and the keyId check are the same as a transaction's read.
 */
export function readVaultEntriesSync(file, key) {
  const env = readEnvelope(file);
  if (!env) return null;
  if (keyIdOf(key) !== env.keyId) throw new VaultError('wrong-key');
  return { keyId: env.keyId, entries: decrypt(env, key) };
}

/**
 * A vault on `home` with the injected OS `store`. `storeTimeoutMs` bounds every store call; `lockTimeoutMs` bounds
 * the wait for the cross-process lock (a timeout is `lock-busy`).
 */
export function createVault({ home = worcaHome(), store, storeTimeoutMs = defaultStoreTimeoutMs(), lockTimeoutMs = 30_000 } = {}) {
  const file = vaultFile(home);
  const lockFile = join(home, VAULT_LOCK_FILE);
  // The key is cached for reads only; every write re-fetches it. A failure is never cached.
  let cachedKey = null;
  const call = (op, ...args) => callStore(store, op, args, { timeoutMs: storeTimeoutMs });

  async function fetchKey() {
    try { return await call('getKey'); } catch (err) { cachedKey = null; throw err; }
  }

  async function keyForRead(keyId) {
    let key = cachedKey;
    if (key && keyIdOf(key) !== keyId) { cachedKey = null; key = null; } // dropped and fetched once more
    if (!key) key = await fetchKey();
    if (!key) throw new VaultError('item-missing');
    if (keyIdOf(key) !== keyId) throw new VaultError('wrong-key');
    cachedKey = key;
    return key;
  }

  // D11: only inside the lock, only with the file absent and no key: generate, store, read back, and only then write.
  // setKey is create-only: an item that appeared since our getKey (e.g. an earlier timed-out setKey landing late) is
  // refused as store-locked/exists and never replaced, and the key it holds is used, since no vault file exists yet.
  async function createKey() {
    const key = randomBytes(32);
    try { await call('setKey', key); } catch (err) {
      if (err?.reason !== 'exists') throw err;
      const held = await call('getKey');
      if (!held) throw err;
      return held;
    }
    const back = await call('getKey');
    if (!back || !back.equals(key)) throw new VaultError('store-unavailable');
    return key;
  }

  // With no vault file the key is read fresh: a store keeping a copy (the primed store) must not seal a new vault
  // under a key whose item another process deleted (export).
  async function keyForWrite(snap) {
    try {
      const key = await callStore(store, 'getKey', [], { timeoutMs: storeTimeoutMs, fresh: !snap.present });
      if (!key) {
        if (snap.present) throw new VaultError('item-missing');
        return await createKey();
      }
      if (snap.present && keyIdOf(key) !== snap.keyId) throw new VaultError('wrong-key');
      return key;
    } catch (err) { cachedKey = null; throw err; }
  }

  async function load() {
    const env = readEnvelope(file);
    if (!env) return { present: false, keyId: null, entries: {} };
    const key = await keyForRead(env.keyId);
    return { present: true, keyId: env.keyId, entries: decrypt(env, key) };
  }

  async function save(snap, entries, live) {
    const key = await keyForWrite(snap);
    live(); // re-checked after the last await: a tx kept past its transaction never writes after the lock is gone
    const { keyId, envelope } = encrypt(entries, key);
    writeJsonAtomic(file, envelope, { mode: 0o600, beforeRename: () => crashPoint('mid-vault-write') });
    Object.assign(snap, { present: true, keyId, entries });
    cachedKey = key;
  }

  function entryFor(snap, ref, owner) {
    if (!isVaultRef(ref)) throw new VaultError('bad-ref');
    if (checkOwner(owner)) throw new VaultError('bad-owner');
    const id = refId(ref);
    const e = Object.hasOwn(snap.entries, id) ? snap.entries[id] : null;
    if (e && (e.store !== owner.store || e.field !== owner.field)) throw new VaultError('cross-owner');
    return { id, e };
  }

  function makeTx(snap, hold) {
    const live = () => { if (!hold.active) throw new Error('vault: tx used after the transaction ended'); };
    return {
      // `droppedAt` (optional) writes the entry already marked, in the same save (a migration's pending entry).
      async put({ store: s, field, value, ref, droppedAt } = {}) {
        live();
        if (checkOwner({ store: s, field })) throw new VaultError('bad-owner');
        if (!validValue(value)) throw new VaultError('bad-value');
        if (droppedAt !== undefined && !validMark(droppedAt)) throw new VaultError('bad-value');
        let id;
        if (ref != null) {
          const found = entryFor(snap, ref, { store: s, field });
          if (!found.e) throw new VaultError('unknown-ref');
          id = found.id;
        } else {
          do { ref = newVaultRef(); id = refId(ref); } while (Object.hasOwn(snap.entries, id));
        }
        await save(snap, { ...snap.entries, [id]: { store: s, field, value, ...(droppedAt !== undefined ? { droppedAt } : {}) } }, live);
        return ref;
      },
      async resolve(ref, owner) {
        live();
        const { e } = entryFor(snap, ref, owner);
        if (!e) throw new VaultError('unknown-ref');
        return e.value;
      },
      async remove(ref, owner) {
        live();
        const { id, e } = entryFor(snap, ref, owner);
        if (!e) return false;
        const rest = { ...snap.entries };
        delete rest[id];
        await save(snap, rest, live);
        return true;
      },
      // Set (`at` ms) or clear (`at` null) the entry's droppedAt mark. False when there is no such entry.
      async mark(ref, owner, at) {
        live();
        const { id, e } = entryFor(snap, ref, owner);
        if (!e) return false;
        if (at !== null && !validMark(at)) throw new VaultError('bad-value');
        if ((e.droppedAt ?? null) === at) return true;
        const { droppedAt: _old, ...rest } = e;
        await save(snap, { ...snap.entries, [id]: at === null ? rest : { ...rest, droppedAt: at } }, live);
        return true;
      },
      async list() {
        live();
        return Object.entries(snap.entries).map(([id, e]) => ({ ref: VAULT_REF_PREFIX + id, store: e.store, field: e.field,
          ...(e.droppedAt !== undefined ? { droppedAt: e.droppedAt } : {}) }));
      },
    };
  }

  const queueKey = resolvePath(home);
  function transaction(fn) {
    if (holding.getStore()?.active) return Promise.reject(new VaultError('lock-nested'));
    const run = (queues.get(queueKey) ?? Promise.resolve()).then(() => withLock(lockFile, () => {
      // `hold` ends with fn: a tx kept past fn throws, and work fn left scheduled may take the lock later.
      const hold = { active: true };
      return holding.run(hold, async () => {
        try {
          const snap = await load();
          return await fn(makeTx(snap, hold));
        } finally { hold.active = false; }
      });
    }, { timeoutMs: lockTimeoutMs, mode: 0o600 }));
    const tail = run.catch(() => {});
    queues.set(queueKey, tail);
    tail.then(() => { if (queues.get(queueKey) === tail) queues.delete(queueKey); });
    return run.catch((err) => { throw err?.code === 'LOCK_TIMEOUT' ? new VaultError('lock-busy') : err; });
  }

  return {
    transaction,
    put: (args) => transaction((tx) => tx.put(args)),
    resolve: (ref, owner) => transaction((tx) => tx.resolve(ref, owner)),
    remove: (ref, owner) => transaction((tx) => tx.remove(ref, owner)),
    list: () => transaction((tx) => tx.list()),
  };
}

/**
 * The production entry: null while the secretVault flag is off (no home resolution, no file or store access),
 * else a vault on `home` (default the Worca home) with the OS store `selectOsStore({ env, home })` picks.
 */
export async function openVaultIfEnabled({ home, env } = {}) {
  if (!secretVaultEnabled()) return null;
  const h = home ?? worcaHome();
  const e = env ?? process.env;
  return createVault({ home: h, store: await selectOsStore({ env: e, home: h }), storeTimeoutMs: defaultStoreTimeoutMs(e) });
}

/**
 * Read-only check of `home`'s vault: one getKey, the envelope read without the lock, then the keyId and decryption
 * checks. Never writes, never creates a key. `code` is null or item-missing, wrong-key, tampered, unsupported-format,
 * store-locked or store-unavailable. A readable vault also gives `entries`, its entry count (dropped entries included:
 * they still hold values).
 */
export async function inspectVault({ home, store, timeoutMs = defaultStoreTimeoutMs() }) {
  const file = vaultFile(home);
  let key;
  try {
    key = await callStore(store, 'getKey', [], { timeoutMs });
  } catch (err) {
    return { present: existsSync(file), readable: false, code: err?.code ?? 'store-unavailable' };
  }
  try {
    const env = readEnvelope(file);
    if (!env) return { present: false, readable: false, code: null };
    if (!key) return { present: true, readable: false, code: 'item-missing' };
    if (keyIdOf(key) !== env.keyId) return { present: true, readable: false, code: 'wrong-key' };
    const entries = Object.keys(decrypt(env, key)).length;
    return { present: true, readable: true, code: null, entries };
  } catch (err) {
    if (err instanceof VaultError) return { present: true, readable: false, code: err.code };
    throw err;
  } finally {
    key?.fill(0);
  }
}

/**
 * Move `home`'s vault aside, under the vault lock (not a transaction: load() refuses an unreadable vault). Inside
 * the lock `check()` runs again; when it says no, nothing moves and the result is null. Otherwise the vault is
 * linked to `VAULT_FILE + VAULT_ASIDE_INFIX + stamp` (then `-1` when that exists) and unlinked; the result is the
 * new basename. A lock timeout is `lock-busy`, both names taken is `aside-exists`; neither moves anything.
 */
export async function moveVaultAside({ home, now = new Date(), lockTimeoutMs = 30_000, check }) {
  assertVaultLockFree(VAULT_LOCK_FILE);
  const file = vaultFile(home);
  try {
    return await withLock(join(home, VAULT_LOCK_FILE), async () => {
      if (!(await check())) return null;
      const base = VAULT_FILE + VAULT_ASIDE_INFIX + now.toISOString().replace(/[:.]/g, '-');
      for (const name of [base, `${base}-1`]) {
        try {
          linkSync(file, join(home, name));
        } catch (err) {
          if (err.code === 'EEXIST') continue;
          throw err;
        }
        unlinkSync(file);
        return name;
      }
      throw new VaultError('aside-exists');
    }, { timeoutMs: lockTimeoutMs, mode: 0o600 });
  } catch (err) {
    throw err?.code === 'LOCK_TIMEOUT' ? new VaultError('lock-busy') : err;
  }
}

/**
 * The digest export snapshots per entry (`id → entryDigest(entry)`): a sha256 of `{ store, field, value, droppedAt }`,
 * so an entry added, re-sealed or re-marked since the snapshot is seen. Never the value itself.
 */
export function entryDigest({ store, field, value, droppedAt } = {}) {
  return createHash('sha256').update(JSON.stringify({ store, field, value, droppedAt: droppedAt ?? null })).digest('hex');
}

/**
 * Delete `home`'s vault file and then its OS key item (export only). Under the vault lock the entries are re-read
 * (one getKey through `store`): when any live entry is missing from `snapshot` (`Map<id, entryDigest>`) or has another
 * digest, it throws VaultError `changed` and removes nothing; ids of `snapshot` gone from the vault are fine. Otherwise
 * the vault file is unlinked (ENOENT is fine). Then, still under the lock, `deleteKey` through `store`: a failure is returned as
 * `keyError` (its VaultError code), never thrown. A lock timeout is `lock-busy`, with nothing removed.
 * @returns {Promise<{ vaultRemoved: boolean, keyRemoved: boolean, keyError?: string }>}
 */
export async function deleteVault({ home, store, snapshot, lockTimeoutMs = 30_000, storeTimeoutMs = defaultStoreTimeoutMs() }) {
  assertVaultLockFree(VAULT_LOCK_FILE);
  const file = vaultFile(home);
  let vaultRemoved = false;
  try {
    return await withLock(join(home, VAULT_LOCK_FILE), async () => {
      const env = readEnvelope(file);
      if (env) {
        const key = await callStore(store, 'getKey', [], { timeoutMs: storeTimeoutMs });
        if (!key) throw new VaultError('item-missing');
        let entries;
        try {
          if (keyIdOf(key) !== env.keyId) throw new VaultError('wrong-key');
          entries = decrypt(env, key);
        } finally { key.fill(0); }
        for (const [id, e] of Object.entries(entries)) {
          if (!snapshot.has(id) || snapshot.get(id) !== entryDigest(e)) throw new VaultError('changed');
        }
      }
      try { unlinkSync(file); vaultRemoved = !!env; } catch (err) { if (err.code !== 'ENOENT') throw err; }
      crashPoint('after-vault-unlink');
      // Still under the lock: a seal waiting on it then creates a fresh vault and key, never one under a deleted key.
      try {
        const removed = await callStore(store, 'deleteKey', [], { timeoutMs: storeTimeoutMs });
        return { vaultRemoved, keyRemoved: removed !== false };
      } catch (err) {
        return { vaultRemoved, keyRemoved: false, keyError: err?.code ?? 'store-unavailable' };
      }
    }, { timeoutMs: lockTimeoutMs, mode: 0o600 });
  } catch (err) {
    throw err?.code === 'LOCK_TIMEOUT' ? new VaultError('lock-busy') : err;
  }
}
