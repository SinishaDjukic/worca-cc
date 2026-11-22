// src/core/secrets/store-vault.mjs — the MCP, plugin and proxy stores' glue to the Worca vault: the seal that turns a
// store's secret values into fresh vault references before its write, and the release that removes the entries a
// write dropped, after that write landed. Loaded only through dynamic import() from flag-on paths, so a flag-off
// process never loads it, settings-vault.mjs, vault.mjs or the OS store.
//
// Lock order: a store lock first, the vault lock second (vault.mjs). The MCP store seals and releases inside its own
// lock; the lockless stores (plugin, proxy, settings) seal before their sync read-modify-write and release after it.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { VaultError } from './refs.mjs';
import { settingsSecretRefs } from './settings-resolver.mjs';
import { SettingsVaultError, sealOwnerSecrets, vaultForHome } from './settings-vault.mjs';
import { vaultFile } from './vault.mjs';

export { refsDropped } from './settings-resolver.mjs';

/** The only refusal codes the three stores fall back to the config file on, and only while nothing is vaulted. */
const FALLBACK_CODES = Object.freeze(['store-unavailable', 'store-locked', 'item-missing']);
const NO_RECHECK = () => {};

/**
 * How long a lockless store's dropped entry stays (marked `droppedAt`) before a later release of its field removes it.
 * The lockless stores (settings, plugin, proxy) have no cross-process lock, so a stale writer in another process can
 * write a dropped reference back after the release; the grace keeps its entry for that window.
 */
export const LOCKLESS_GRACE_MS = 10 * 60 * 1000;

/**
 * Seal a store's secret values, each into a FRESH entry. `store` ∈ mcp | plugin | proxy; `items` =
 * `[{ field, value, current }]` (`current` the field's raw stored value). Non-strings (`{ $env }`), `''`, null and an
 * unchanged value are returned as is with no store call; a trimmed reference that is not the field's current value
 * throws VAULT_REF_REFUSED before any write. `nothingVaulted()` says whether the store's own file holds no reference;
 * with no vault file either, a store-availability refusal falls back to the config file, and `recheck()` (run inside the
 * caller's sync section, before its write) throws VAULT_UNREACHABLE when a vault file or a reference appeared since.
 * Any other failure is a SettingsVaultError (a non-vault error is `io`, with the fixed default text). A successful seal
 * then retries the home's pending prime settle (settleDroppedOnPrime), which never changes its result.
 * @returns {Promise<{ values: any[], recheck: () => void }>}
 */
export async function sealStoreSecrets(store, items, { home, env, nothingVaulted = () => true, subject = 'The secret' } = {}) {
  const h = home ?? worcaHome();
  const none = () => !existsSync(vaultFile(h)) && nothingVaulted();
  let r;
  try {
    r = await sealOwnerSecrets(store, items.map((it) => ({ ...it, vaulted: true, allowRef: false })), {
      home: h, env, nothingVaulted: none, fallbackCodes: FALLBACK_CODES, subject,
    });
  } catch (err) {
    if (err instanceof SettingsVaultError) throw err;
    throw new SettingsVaultError('io', { subject });
  }
  await retryPendingSettle(h, env);
  if (!r.plainFallback) return { values: r.values, recheck: NO_RECHECK };
  return { values: r.values, recheck: () => { if (!none()) throw new SettingsVaultError(r.reason, { subject }); } };
}

/**
 * Copy vaulted secrets into fresh entries of the same owners, in ONE vault transaction (a duplicated MCP set). `items`
 * = `[{ ref, field }]`; the result holds the new reference per item, or null for one that does not resolve
 * (unknown-ref, cross-owner). An unusable vault throws SettingsVaultError VAULT_UNREACHABLE and copies nothing.
 * @returns {Promise<(string|null)[]>}
 */
export async function copyStoreRefs(store, items, { home, env, subject = 'The secret' } = {}) {
  try {
    const vault = await vaultForHome({ home, env });
    if (!vault) throw new VaultError('store-unavailable');
    return await vault.transaction(async (tx) => {
      const out = [];
      for (const { ref, field } of items) {
        let value;
        try { value = await tx.resolve(ref, { store, field }); } catch (err) {
          if (err instanceof VaultError && ['unknown-ref', 'cross-owner', 'bad-ref'].includes(err.code)) { out.push(null); continue; }
          throw err;
        }
        out.push(await tx.put({ store, field, value }));
      }
      return out;
    });
  } catch (err) {
    throw new SettingsVaultError(err instanceof VaultError ? err.code : 'io', { subject });
  }
}

/**
 * Remove the vault entries a store write dropped, after that write landed. `dropped` = `[{ ref, field }]` (store
 * `settings` allowed). In ONE vault transaction each reference that `stillReferenced(ref)` (a sync re-read of the
 * owner's files) denies is removed for its own owner; a still-referenced or `cross-owner` one is kept. With `sweep`
 * (the MCP store only, under its lock) every entry of `store` that `stillReferenced` denies is removed too, so earlier
 * failed releases heal. With `graceMs` (the lockless stores: LOCKLESS_GRACE_MS) a denied entry is marked `droppedAt`
 * instead of removed, and every marked entry of `store` on a dropped field is settled too: still referenced (a stale
 * writer wrote it back) clears its mark, marked `graceMs` ago or more removes it; the result then carries `marked`.
 * `scope(field)` widens that settling to every marked entry of `store` on a field it accepts (the writer's whole file:
 * every settings or proxy field, or one plugin's own fields), so an owner deleted for good still loses its entry on
 * the writer's next release; `stillReferenced` must then cover every field in scope.
 * An empty list and no sweep make no store call. Never rejects: any failure is `{ removed: 0, kept: 0, error }` (the
 * VaultError code, else `io`) plus one log line naming only the code. On every path, after its own transaction closed,
 * it retries the home's pending prime settle (settleDroppedOnPrime); the result is its own, unchanged by the retry.
 * @returns {Promise<{ removed: number, kept: number, marked?: number, error?: string }>}
 */
export async function releaseStoreRefs(store, dropped, opts = {}) {
  const out = await releaseOwn(store, dropped, opts);
  await retryPendingSettle(opts.home ?? worcaHome(), opts.env);
  return out;
}

async function releaseOwn(store, dropped, { home, env, stillReferenced = () => false, sweep = false,
  graceMs = 0, scope = () => false, now = Date.now, log = (line) => console.warn(line) } = {}) {
  if (!dropped.length && !sweep) return graceMs ? { removed: 0, kept: 0, marked: 0 } : { removed: 0, kept: 0 };
  if (graceMs) return releaseAfterGrace(store, dropped, { home, env, stillReferenced, graceMs, scope, now, log });
  try {
    const vault = await vaultForHome({ home, env });
    if (!vault) throw new VaultError('store-unavailable');
    return await vault.transaction(async (tx) => {
      let removed = 0;
      let kept = 0;
      for (const { ref, field } of dropped) {
        if (stillReferenced(ref)) { kept++; continue; }
        try {
          if (await tx.remove(ref, { store, field })) removed++;
        } catch (err) {
          if (err instanceof VaultError && err.code === 'cross-owner') { kept++; continue; }
          throw err;
        }
      }
      if (sweep) {
        for (const e of await tx.list()) {
          if (e.store !== store || stillReferenced(e.ref)) continue;
          if (await tx.remove(e.ref, { store: e.store, field: e.field })) removed++;
        }
      }
      return { removed, kept };
    });
  } catch (err) {
    return releaseFailed(err, log);
  }
}

function releaseFailed(err, log) {
  const error = err instanceof VaultError ? err.code : 'io';
  log(`[worca] vault cleanup skipped (${error})`);
  return { removed: 0, kept: 0, error };
}

// releaseStoreRefs with `graceMs`: mark, unmark or remove, in one transaction. Only entries of `store` on a field of
// `dropped` or in `scope` are looked at, so `stillReferenced` (a re-read of the writer's own file) covers every one.
async function releaseAfterGrace(store, dropped, { home, env, stillReferenced, graceMs, scope, now, log }) {
  try {
    const vault = await vaultForHome({ home, env });
    if (!vault) throw new VaultError('store-unavailable');
    return await vault.transaction(async (tx) => {
      const at = now();
      const fields = new Set(dropped.map((d) => d.field));
      const rows = new Map((await tx.list()).filter((e) => e.store === store && (fields.has(e.field) || scope(e.field)))
        .map((e) => [e.ref, e]));
      const out = { removed: 0, kept: 0, marked: 0 };
      for (const { ref, field } of dropped) {
        if (rows.has(ref)) continue;
        try { await tx.resolve(ref, { store, field }); } catch (err) {
          if (err instanceof VaultError && err.code === 'cross-owner') { out.kept++; continue; }
          if (!(err instanceof VaultError) || err.code !== 'unknown-ref') throw err;   // unknown-ref: already gone
        }
      }
      const isDropped = new Set(dropped.map((d) => d.ref));
      for (const e of rows.values()) {
        const owner = { store, field: e.field };
        const marked = e.droppedAt !== undefined;
        if (!isDropped.has(e.ref) && !marked) continue;   // a live entry of the field: not ours to settle
        if (stillReferenced(e.ref)) {
          out.kept++;
          if (marked) await tx.mark(e.ref, owner, null);
        } else if (!marked) {
          await tx.mark(e.ref, owner, at);
          out.marked++;
        } else if (at - e.droppedAt >= graceMs) {
          if (await tx.remove(e.ref, owner)) out.removed++;
        }
      }
      return out;
    });
  } catch (err) {
    return releaseFailed(err, log);
  }
}

/** The stores whose dropped entries are marked first (no cross-process lock), and so settled by settleDroppedRefs. */
const LOCKLESS_STORES = Object.freeze(['settings', 'plugin', 'proxy']);

/**
 * Settle every marked entry of a lockless store in ONE vault transaction, whatever field it is on (the flag-on prime
 * at server and CLI start: an owner deleted for good has no later release of its own). `held(store)` returns the Set
 * of references that store's files hold now, or null when they cannot be read (that store is left alone). A held
 * entry is unmarked; one marked `graceMs` ago or more is removed. Never rejects (as releaseStoreRefs).
 * @returns {Promise<{ removed: number, kept: number, error?: string }>}
 */
export async function settleDroppedRefs(held, { home, env, graceMs = LOCKLESS_GRACE_MS, now = Date.now,
  log = (line) => console.warn(line) } = {}) {
  try {
    const vault = await vaultForHome({ home, env });
    if (!vault) throw new VaultError('store-unavailable');
    return await vault.transaction(async (tx) => {
      const at = now();
      const out = { removed: 0, kept: 0 };
      const refs = new Map();
      for (const e of await tx.list()) {
        if (e.droppedAt === undefined || !LOCKLESS_STORES.includes(e.store)) continue;
        if (!refs.has(e.store)) {
          let own = null;
          try { own = held(e.store); } catch { /* unreadable: leave the store alone */ }
          refs.set(e.store, own);
        }
        const own = refs.get(e.store);
        if (!own) continue;
        const owner = { store: e.store, field: e.field };
        if (own.has(e.ref)) { out.kept++; await tx.mark(e.ref, owner, null); }
        else if (at - e.droppedAt >= graceMs && await tx.remove(e.ref, owner)) out.removed++;
      }
      return out;
    });
  } catch (err) {
    return releaseFailed(err, log);
  }
}

// Per home (resolved): 'done' (settled), 'running', or { pending: env } (the last attempt failed; its env).
const primeSettle = new Map();

/**
 * At the flag-on prime (server and CLI start), once per home and process once it succeeded: settleDroppedRefs over
 * the references settings.json, the proxy login file and every installed plugin's secrets.json hold now. A failed
 * attempt is retried by the next seal or release for that home, or the next prime. Done, running or no vault file:
 * null with no call. Never rejects.
 * @returns {Promise<{ removed: number, kept: number, error?: string }|null>}
 */
export async function settleDroppedOnPrime({ home, env, now } = {}) {
  const h = home ?? worcaHome();
  const key = resolve(h);
  const st = primeSettle.get(key);
  if (st === 'done' || st === 'running' || !existsSync(vaultFile(h))) return null;
  primeSettle.set(key, 'running');
  const result = await settleOnce(h, env, now);
  primeSettle.set(key, result.error ? { pending: env } : 'done');
  return result;
}

async function settleOnce(h, env, now) {
  try {
    const { settingsFile } = await import('../settings.mjs');
    const { storedRef } = await import('../proxy-credentials.mjs');
    const { pluginSecretRefs } = await import('../plugin-config.mjs');
    const { pluginsRoot } = await import('../plugins-lock.mjs');
    const readOr = (read, missing) => { try { return read(); } catch (err) { if (err?.code === 'ENOENT') return missing; throw err; } };
    const held = (store) => {
      if (store === 'settings') {
        return new Set(readOr(() => settingsSecretRefs(JSON.parse(readFileSync(settingsFile(), 'utf8'))), []).map((r) => r.ref));
      }
      if (store === 'proxy') return new Set([storedRef(h)].filter(Boolean));
      const names = readOr(() => readdirSync(pluginsRoot(), { withFileTypes: true }), []).filter((d) => d.isDirectory());
      return new Set(names.flatMap((d) => pluginSecretRefs(d.name).map((r) => r.ref)));
    };
    return await settleDroppedRefs(held, { home: h, env, ...(now ? { now } : {}) });
  } catch (err) {
    return releaseFailed(err, (line) => console.warn(line));
  }
}

// Retry `home`'s prime settle when its last attempt failed; nothing (no store call) otherwise. Never rejects.
async function retryPendingSettle(home, env) {
  const st = primeSettle.get(resolve(home));
  if (!st?.pending) return;
  await settleDroppedOnPrime({ home, env: env ?? st.pending });
}
