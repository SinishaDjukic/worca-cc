// src/core/secrets/settings-vault.mjs — the settings store's glue to the Worca vault: the async prime that loads the
// master key off the sync path, the primed store that calls the OS store at most until it holds a key, and the seal
// that turns a setter's secret values into vault references before its sync read-modify-write. Loaded only through
// dynamic import() from flag-on paths (src/core/settings.mjs, ui/server.mjs, ui/routes/settings/secrets.mjs), so a
// flag-off process never loads it, vault.mjs or the OS store.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { modelEnvRef } from '../model-env.mjs';
import { worcaHome } from '../projects.mjs';
import { defaultRoot, getWorcaRoot, readSettings } from '../settings.mjs';
import { BACKEND_LABELS, callStore, canonicalHomePath, selectOsStore, storeTimeoutMs, unavailableOsStore } from './os-store.mjs';
import { VAULT_MESSAGES, VaultError, isVaultRef, vaultActionLine } from './refs.mjs';
import { clearSettingsVaultReader, installSettingsVaultReader, onSettingsVaultStale, settingsSecretRefs } from './settings-resolver.mjs';
import { createVault, readVaultEntriesSync, vaultFile } from './vault.mjs';

/**
 * A save the vault refused. `code` is VAULT_UNREACHABLE (the vault could not be used) or VAULT_REF_REFUSED (a
 * reference that is not the field's own). `reason` is the VaultError code (or `io`). `subject` names what was not
 * saved ("The key", "The secret", "The login"). The message holds no value, reference or path: only VAULT_MESSAGES
 * text and a fixed action.
 */
export class SettingsVaultError extends Error {
  constructor(reason, { code = 'VAULT_UNREACHABLE', subject = 'The key' } = {}) {
    const text = VAULT_MESSAGES[reason] ?? 'the Worca vault refused the operation';
    const action = code !== 'VAULT_UNREACHABLE' ? '' : vaultActionLine(reason);
    super(`${subject} was not saved: ${text}.${action}`);
    this.name = 'SettingsVaultError';
    this.code = code;
    this.reason = reason;
  }
}

/**
 * The primed store over `real`: its getKey asks the real store until one answer is a key, then keeps a private copy
 * and returns a fresh Buffer on every call (callers zero what they get). A getKey whose last argument says `fresh`
 * zeroes the held copy first and asks the real store (an item another process deleted is then seen as missing);
 * setKey passes through; deleteKey passes through,
 * then zeroes the held copy and calls `onDelete` (the home's state resets).
 */
function primedStore(real, onDelete = () => {}) {
  let held = null;
  return {
    kind: real.kind,
    label: real.label,
    real,
    holds: () => !!held,
    same: (key) => !!held && Buffer.isBuffer(key) && held.equals(key),
    async getKey(...args) {
      if (args.at(-1)?.fresh && held) { held.fill(0); held = null; }
      if (held) return Buffer.from(held);
      const key = await real.getKey(...args);
      if (Buffer.isBuffer(key) && key.length === 32) held = Buffer.from(key);
      return key;
    },
    setKey: (...args) => real.setKey(...args),
    // The item goes: the held copy is zeroed and the home's cached prime and vault are dropped, so no stale key copy
    // outlives the item.
    async deleteKey(...args) {
      const r = await real.deleteKey(...args);
      if (held) held.fill(0);
      held = null;
      onDelete();
      return r;
    },
  };
}

// One state per Worca home: its primed store, its vault, the last prime result and the prime in flight.
const homes = new Map();
let current = null;   // the home whose reader is installed, and whose stale hook re-primes
let reprimeQueued = false;

function stateFor({ home, env } = {}) {
  const h = resolve(home ?? worcaHome());
  let s = homes.get(h);
  if (!s) {
    const e = env ?? process.env;
    s = { home: h, env: e, timeoutMs: storeTimeoutMs(e), store: null, vault: null, last: null, inflight: null, share: false };
    homes.set(h, s);
  }
  return s;
}

function scheduleReprime() {
  if (reprimeQueued || !current) return;
  reprimeQueued = true;
  const s = current;
  setImmediate(() => { reprimeQueued = false; primeSettingsVault({ home: s.home, env: s.env }); });
}

async function runPrime(s) {
  const file = vaultFile(s.home);
  onSettingsVaultStale(scheduleReprime);
  try {
    if (!s.store) {
      s.store = primedStore(await selectOsStore({ env: s.env, home: s.home }), () => {
        s.last = null;
        s.vault = null;
        s.store = null;
        s.share = false;
        clearSettingsVaultReader({ file });
      });
      s.vault = createVault({ home: s.home, store: s.store, storeTimeoutMs: s.timeoutMs });
    }
    let key;
    try {
      key = await callStore(s.store, 'getKey', [], { timeoutMs: s.timeoutMs });
    } catch (err) {
      clearSettingsVaultReader({ file });
      return { state: err?.code === 'store-locked' ? 'locked' : 'unavailable' };
    }
    if (!key) {
      clearSettingsVaultReader({ file });
      return { state: 'no-key' };
    }
    const own = Buffer.from(key);
    key.fill(0);
    installSettingsVaultReader({ file, read: () => readVaultEntriesSync(file, own) });
    s.share = true;
    return { state: 'ready' };
  } catch {
    clearSettingsVaultReader({ file });
    return { state: 'unavailable' };
  }
}

/**
 * Load the master key for `home` (default the Worca home) with one getKey through the primed store, and install the
 * sync reader when there is one. Single-flight; never rejects. A `ready` prime is kept: later calls make no store call.
 * @returns {Promise<{ state: 'ready'|'no-key'|'locked'|'unavailable' }>}
 */
export function primeSettingsVault(opts = {}) {
  const s = stateFor(opts);
  current = s;
  if (s.last?.state === 'ready') return Promise.resolve(s.last);
  if (!s.inflight) s.inflight = runPrime(s).then((r) => { s.last = r; s.inflight = null; return r; });
  return s.inflight;
}

/**
 * The store the Settings status probe asks, after `home`'s prime settles. Its first getKey after a ready prime is the
 * primed store's (a fresh copy of the held key: the start's prime and probe make one store call, and the probe can
 * never zero the key the settings vault holds); every later getKey asks the real store, so a store locked since
 * still shows as locked.
 */
export async function settingsVaultStore(opts = {}) {
  const s = stateFor(opts);
  await primeSettingsVault({ home: s.home, env: s.env });
  if (!s.store) return unavailableOsStore();
  const primed = s.store;
  return {
    kind: primed.kind,
    label: primed.label,
    getKey(...args) {
      if (s.share && primed.holds()) { s.share = false; return primed.getKey(...args); }
      return primed.real.getKey(...args);
    },
    setKey: (...args) => primed.setKey(...args),
  };
}

/** The backend `home`'s prime selected, `{ kind, label }` (the no-store label when none was): for the secrets notice. */
export function settingsVaultBackend(opts = {}) {
  const st = stateFor(opts).store;
  return st ? { kind: st.kind, label: st.label ?? BACKEND_LABELS[st.kind] ?? BACKEND_LABELS.none } : { kind: 'none', label: BACKEND_LABELS.none };
}

/**
 * The primed store of `home` after its prime settled (the unavailable store when none could be selected). Export
 * deletes the key item through it, so the held copy and the home's cached prime and vault go with the item.
 */
export async function primedVaultStore(opts = {}) {
  const s = stateFor(opts);
  await primeSettingsVault({ home: s.home, env: s.env });
  return s.store ?? unavailableOsStore();
}

/**
 * The migration's preflight (D6): one time-limited `probe` on the real OS store `home`'s prime selected (never the key
 * item). Called after the prime settled; it never primes again (a `no-key` prime would ask the store once more).
 * Rejects with the VaultError callStore maps the failure to (`reason` the probe code).
 */
export async function probeSettingsVaultStore(opts = {}) {
  const s = stateFor(opts);
  await s.inflight;
  if (!s.store) throw new VaultError('store-unavailable', { reason: 'unavailable' });
  await callStore(s.store.real, 'probe', [], { timeoutMs: s.timeoutMs });
}

/**
 * The migration's master-key read-back (D8): after `home`'s prime settled, ONE fresh getKey on the real store (never the
 * primed copy, never cached), compared with the key the primed store holds. True when they are equal; false when they
 * differ or no key is held or read. A store failure rejects with its VaultError (store-locked or store-unavailable).
 * @returns {Promise<boolean>}
 */
export async function readBackSettingsVaultKey(opts = {}) {
  const s = stateFor(opts);
  await primeSettingsVault({ home: s.home, env: s.env });
  if (!s.store) throw new VaultError('store-unavailable');
  const fresh = await callStore(s.store.real, 'getKey', [], { timeoutMs: s.timeoutMs });
  try {
    return s.store.same(fresh);
  } finally {
    fresh?.fill(0);
  }
}

/**
 * Whether settings.json's references belong to Worca home `home`: they resolve in the home a start without WORCA_HOME
 * uses (the movable root's, settings.root, else the HOME base). Any other home (a WORCA_HOME sandbox, a second install)
 * leaves settings.json alone: migration counts its literals as left, export restores none of its references.
 */
export function ownsSettingsHome(home) {
  return canonicalHomePath(home) === canonicalHomePath(join(resolve(getWorcaRoot() || defaultRoot()), '.worca-cc'));
}

/** Whether nothing is vaulted yet for `home`: no vault file, and no secret field of `settings` holds a reference. */
export function nothingVaulted(home, settings) {
  return !existsSync(vaultFile(home)) && settingsSecretRefs(settings).length === 0;
}

/**
 * The re-check inside a setter's sync section after a plain fallback: a vault or a reference that appeared since
 * (another writer vaulted first) refuses the plain write.
 * @throws {SettingsVaultError}
 */
export function assertNothingVaulted(settings, reason = 'store-unavailable', { home } = {}) {
  if (!nothingVaulted(stateFor({ home }).home, settings)) throw new SettingsVaultError(reason);
}

const REFERENCE_KEEPING = new Set(['unknown-ref', 'cross-owner']);

/**
 * The primed vault of `home` (default the Worca home), or null when no store could be selected.
 * @returns {Promise<object|null>}
 */
export async function vaultForHome({ home, env } = {}) {
  const s = stateFor({ home, env });
  await primeSettingsVault({ home: s.home, env: s.env });
  return s.vault;
}

/**
 * Seal one owner store's string leaves. `items` = `[{ field, value, current, allowRef, vaulted }]`: `field` the owner
 * field of a vaulted item, `current` the field's stored value, `allowRef` the server copy marker. Every reference must
 * be the field's stored value (a masked echo) or carry the copy marker on a vaulted field; others are refused
 * (VAULT_REF_REFUSED). Vaulted items other than clears, an unchanged value and (with `envRefs`) `${VAR}` go into the
 * vault in one transaction, each into a FRESH entry (diff-on-write releases the reference it replaces). When the vault refuses with a code in `fallbackCodes` (null: every code) and `nothingVaulted()`
 * says nothing is vaulted yet, the values pass through to the config file (`plainFallback`); otherwise SettingsVaultError
 * VAULT_UNREACHABLE.
 * @returns {Promise<{ values: any[], plainFallback: boolean, reason?: string }>}
 */
export async function sealOwnerSecrets(store, items, { nothingVaulted: none, fallbackCodes = null, subject,
  envRefs = false, home, env } = {}) {
  const trimmed = (v) => (typeof v === 'string' ? v.trim() : v);
  const refused = (reason) => new SettingsVaultError(reason, { code: 'VAULT_REF_REFUSED', subject });
  for (const it of items) {
    const v = trimmed(it.value);
    if (!isVaultRef(v) || v === it.current) continue;
    if (!(it.allowRef && it.vaulted)) throw refused('cross-owner');
  }
  // An echoed own reference is stored as the field holds it (trimmed), so the write's diff never drops it.
  const echo = (it) => isVaultRef(trimmed(it.value)) && trimmed(it.value) === it.current;
  const values = items.map((it) => (echo(it) ? it.current : it.value));
  const work = [];
  items.forEach((it, i) => {
    const v = trimmed(it.value);
    if (!it.vaulted || typeof v !== 'string' || !v || (envRefs && modelEnvRef(v) !== null) || v === it.current) return;
    work.push(i);
  });
  if (!work.length) return { values, plainFallback: false };
  const s = stateFor({ home, env });
  await primeSettingsVault({ home: s.home, env: s.env });
  try {
    if (!s.vault) throw new VaultError('store-unavailable');
    await s.vault.transaction(async (tx) => {
      for (const i of work) {
        const it = items[i];
        const owner = { store, field: it.field };
        let value = trimmed(it.value);
        if (isVaultRef(value)) {
          try { value = await tx.resolve(value, owner); } catch (err) {
            if (err instanceof VaultError && (REFERENCE_KEEPING.has(err.code) || err.code === 'bad-ref')) throw refused('cross-owner');
            throw err;
          }
        }
        values[i] = await tx.put({ ...owner, value });
      }
    });
  } catch (err) {
    if (!(err instanceof VaultError)) throw err;
    if ((!fallbackCodes || fallbackCodes.includes(err.code)) && none()) {
      return { values: items.map((it) => it.value), plainFallback: true, reason: err.code };
    }
    throw new SettingsVaultError(err.code, { subject });
  }
  if (s.last?.state !== 'ready') await primeSettingsVault({ home: s.home, env: s.env });
  return { values, plainFallback: false };
}

/**
 * Seal a settings setter's string leaves (sealOwnerSecrets for store `settings`): `${VAR}` stays as typed, a changed
 * value gets a fresh entry (never an in-place update: no concurrent release can be holding the new reference), and
 * every refusal code falls back to the config file while nothing is vaulted yet.
 * @returns {Promise<{ values: any[], plainFallback: boolean, reason?: string }>}
 */
export function sealSettingsSecrets(items, opts = {}) {
  const s = stateFor(opts);
  return sealOwnerSecrets('settings', items, {
    home: s.home, env: s.env, envRefs: true, nothingVaulted: () => nothingVaulted(s.home, readSettings()),
  });
}

/**
 * Settle `home`'s prime within a bounded time: the prime raced against the home's store time limit plus 250 ms (the
 * OS store selection itself is not bounded). The timer wins as `{ state: 'locked' }`; the prime keeps running
 * (single-flight) and installs the reader whenever it lands. Never rejects.
 * @returns {Promise<{ state: string }>}
 */
export function settleSettingsVaultPrime(opts = {}) {
  const s = stateFor(opts);
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ state: 'locked' }), s.timeoutMs + 250);
    timer.unref?.();
  });
  const prime = primeSettingsVault({ home: s.home, env: s.env }).catch(() => ({ state: 'unavailable' }));
  return Promise.race([prime, late]).finally(() => clearTimeout(timer));
}
