// src/core/secrets/os-store.mjs — the seam between the Worca vault and the OS key store that holds its master key.
// An OS store is `{ kind, label, async getKey({ signal }?) → Buffer(32) | null, async setKey(key: Buffer, { signal }?),
// async deleteKey({ signal }?) → boolean }` (deleteKey removes the home's key item: export only).
// `setKey` is create-only: with an item already present it throws code `exists` and never overwrites it. Stores throw
// errors carrying `code` ∈ unavailable | locked | exists. `selectOsStore` picks the real store for the machine (the
// macOS Keychain, the Windows Credential Manager, the Linux Secret Service, or DPAPI on WSL2); every call goes through
// `callStore`, which bounds it in time and maps the store's errors onto fixed VaultError codes, dropping the store's
// own text. One item per Worca home: `osItemName`. `probe({ signal }?)` proves a store before the secret migration: it
// writes random bytes to the home's own probe item (`osProbeItemName`, never the key item), reads them back, compares
// and deletes; it throws code locked | unavailable | probe-mismatch | probe-missing | probe-delete.
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { isWsl } from '../system-proxy.mjs';
import { WRAPPED_KEY_FILE } from './files.mjs';
import { keyringOsStore, loadKeyring } from './keyring-backend.mjs';
import { VaultError } from './refs.mjs';
import { dpapiOsStore, findPowershell, runWithInput } from './wsl-dpapi.mjs';

export const TEST_OS_STORE_ENV = 'WORCA_TEST_OS_STORE';
export const TEST_STORE_TIMEOUT_ENV = 'WORCA_TEST_STORE_TIMEOUT_MS';

/** The one time limit for every OS store call. */
export const STORE_TIMEOUT_MS = 10_000;

/** What each backend is called wherever Worca shows it. */
export const BACKEND_LABELS = Object.freeze({
  keychain: 'macOS Keychain',
  'credential-manager': 'Windows Credential Manager',
  'secret-service': 'Secret Service',
  'wsl-dpapi': 'Windows DPAPI (WSL2)',
  none: 'No OS key store',
  fake: 'test store',
});

const SERVICE = 'worca-cc';

// The test fake. It lives under test/, which the published package does not ship.
const FAKE_URL = new URL('../../../test/helpers/os-store-fake.mjs', import.meta.url);

/** The store used when no OS key store is available: every call throws code `unavailable`. */
export function unavailableOsStore() {
  const fail = async () => { throw Object.assign(new Error('no OS key store'), { code: 'unavailable' }); };
  return { kind: 'none', label: BACKEND_LABELS.none, getKey: fail, setKey: fail, probe: fail, deleteKey: fail };
}

/**
 * The canonical form of a home path: the realpath of its nearest existing ancestor (the path itself when it exists)
 * joined with the components below it that do not exist yet, so a home names the same item before and after it is
 * created, also under a symlinked parent (macOS `/var` → `/private/var`). Nothing resolvable: the resolved path. Never
 * throws. A missing ancestor later created as a symlink, or a dangling symlink home, still changes the result.
 */
export function canonicalHomePath(p) {
  let cur = resolve(p);
  const rest = [];
  for (;;) {
    try { return join(realpathSync.native(cur), ...rest); } catch {
      const parent = dirname(cur);
      if (parent === cur) return resolve(p);
      rest.unshift(basename(cur));
      cur = parent;
    }
  }
}

function homeHash(home, platform) {
  let canonical = canonicalHomePath(home);
  if (platform === 'win32') canonical = canonical.toLowerCase();
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * The OS item that holds `home`'s vault key: service `worca-cc`, account `vault-key-` plus 16 hex characters of the
 * SHA-256 of the canonical home (the realpath of its nearest existing ancestor plus the rest; lowercased on win32). The
 * path never appears.
 */
export function osItemName(home, { platform = process.platform } = {}) {
  return { service: SERVICE, account: 'vault-key-' + homeHash(home, platform) };
}

/**
 * The throwaway item `probe` writes for `home`: account `vault-probe-` plus the same home hash (canonical home: the
 * realpath of its nearest existing ancestor plus the rest). Never the key item.
 */
export function osProbeItemName(home, { platform = process.platform } = {}) {
  return { service: SERVICE, account: 'vault-probe-' + homeHash(home, platform) };
}

/** The store time limit: 10 s, or `WORCA_TEST_STORE_TIMEOUT_MS` (clamped to 50–10 000) under the node:test runner. */
export function storeTimeoutMs(env = process.env) {
  if (!env.NODE_TEST_CONTEXT) return STORE_TIMEOUT_MS;
  const n = Number(env[TEST_STORE_TIMEOUT_ENV]);
  if (!env[TEST_STORE_TIMEOUT_ENV] || !Number.isFinite(n)) return STORE_TIMEOUT_MS;
  return Math.min(STORE_TIMEOUT_MS, Math.max(50, Math.round(n)));
}

function productionDeps(env) {
  return {
    platform: process.platform,
    isWsl: () => isWsl(env, readFile),
    loadKeyring: () => loadKeyring(),
    findPowershell: () => findPowershell(),
    run: runWithInput,
    existsWrapped: (home) => {
      try { lstatSync(join(home, WRAPPED_KEY_FILE)); return true; } catch { return false; }
    },
  };
}

// D5: one time-limited read-only getKey on the home's item. An answer (null or key) is present, and is kept on the
// store as its one-shot primed answer; store-locked (a timeout included) is present but locked; store-unavailable
// is absent.
async function probeSecretService(store, timeoutMs) {
  try {
    store.prime(await callStore(store, 'getKey', [], { timeoutMs }));
    return true;
  } catch (err) {
    return err?.code === 'store-locked';
  }
}

const labelled = (store) => Object.assign(store, { label: BACKEND_LABELS[store.kind] });

// One keyring store per loaded module, kind and OS item, so its in-flight guard holds across every status re-probe:
// a hung store keeps at most one native call, however often Settings asks.
const keyringStores = new WeakMap();
function sharedKeyringStore(keyring, item, kind, probeItem) {
  let byItem = keyringStores.get(keyring);
  if (!byItem) keyringStores.set(keyring, (byItem = new Map()));
  const id = `${kind}\0${item.service}\0${item.account}`;
  let store = byItem.get(id);
  if (!store) byItem.set(id, (store = labelled(keyringOsStore({ keyring, item, kind, probeItem }))));
  return store;
}

async function realSelect(d, home, env) {
  const item = osItemName(home, { platform: d.platform });
  const probeItem = osProbeItemName(home, { platform: d.platform });
  const timeoutMs = storeTimeoutMs(env);
  const dpapi = () => {
    const powershell = d.findPowershell();
    return powershell ? labelled(dpapiOsStore({ home, powershell, run: d.run })) : unavailableOsStore();
  };
  if (d.platform === 'darwin' || d.platform === 'win32') {
    const keyring = d.loadKeyring();
    if (!keyring) return unavailableOsStore();
    return sharedKeyringStore(keyring, item, d.platform === 'darwin' ? 'keychain' : 'credential-manager', probeItem);
  }
  if (d.platform !== 'linux') return unavailableOsStore();
  const wsl = await d.isWsl();
  // D10: a key DPAPI already wrapped stays the key, even when a Secret Service appears later.
  if (wsl && d.existsWrapped(home)) return dpapi();
  const keyring = d.loadKeyring();
  if (keyring) {
    const store = sharedKeyringStore(keyring, item, 'secret-service', probeItem);
    if (await probeSecretService(store, timeoutMs)) return store;
  }
  return wsl ? dpapi() : unavailableOsStore();
}

/**
 * The OS store for `home`. Order:
 * 1. `WORCA_TEST_OS_STORE` (an absolute path to the fake's state file), honoured only with `NODE_TEST_CONTEXT` (the
 *    node:test runner marker) and only when the fake module exists beside `src/`; the fake is bound to the home's item.
 * 2. Inside a test run with no injected `deps`, the unavailable store: a test never reaches the real Keychain.
 * 3. The real selection, through `deps` `{ platform, isWsl, loadKeyring, findPowershell, run, existsWrapped }`.
 */
export async function selectOsStore({ env = process.env, home, deps } = {}) {
  const statePath = env[TEST_OS_STORE_ENV];
  if (statePath && isAbsolute(statePath) && env.NODE_TEST_CONTEXT) {
    let mod;
    try {
      mod = await import(FAKE_URL.href);
    } catch (err) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND' && err.url === FAKE_URL.href) return unavailableOsStore();
      throw err;
    }
    const h = home ?? worcaHome();
    return mod.fileFakeOsStore(statePath, { item: osItemName(h), probeItem: osProbeItemName(h) });
  }
  if (env.NODE_TEST_CONTEXT && !deps) return unavailableOsStore();
  return realSelect({ ...productionDeps(env), ...deps }, home ?? worcaHome(), env);
}

const TIMEOUT = Symbol('timeout');

const PROBE_CODES = new Set(['probe-mismatch', 'probe-missing', 'probe-delete']);

// A probe keeps its store code as `reason` (the migration reports it); the other calls keep only the VaultError code.
function mapStoreError(err, op) {
  if (err?.code === 'exists') return new VaultError('store-locked', { reason: 'exists' });
  if (PROBE_CODES.has(err?.code)) return new VaultError('store-unavailable', { reason: err.code });
  const locked = err?.code === 'locked';
  if (op === 'probe') return new VaultError(locked ? 'store-locked' : 'store-unavailable', { reason: locked ? 'locked' : 'unavailable' });
  return new VaultError(locked ? 'store-locked' : 'store-unavailable');
}

/**
 * Call `store[op](...args, { signal })`, raced against `timeoutMs` (a timeout is `store-locked`, reason `timeout`, and
 * aborts the signal). A thrown code `unavailable` maps to `store-unavailable`, `locked` to `store-locked` (`exists`
 * too, reason `exists`), anything else to `store-unavailable`; the store's message is never kept. A `probe` failure
 * keeps its code as `reason` (probe-mismatch, probe-missing and probe-delete are `store-unavailable`). A `getKey` result
 * that is neither null nor a 32-byte Buffer is `store-unavailable`. `fresh: true` adds `fresh: true` to that last
 * argument: a store that keeps a key copy (the settings vault's primed store) then asks the real store again.
 */
export async function callStore(store, op, args = [], { timeoutMs = STORE_TIMEOUT_MS, fresh = false } = {}) {
  const ac = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), timeoutMs); });
  let result;
  try {
    result = await Promise.race([Promise.resolve().then(() => store[op](...args, fresh ? { signal: ac.signal, fresh: true } : { signal: ac.signal })), timeout]);
  } catch (err) {
    throw mapStoreError(err, op);
  } finally {
    clearTimeout(timer);
  }
  if (result === TIMEOUT) {
    ac.abort();
    throw new VaultError('store-locked', { reason: 'timeout' });
  }
  if (op === 'getKey' && result !== null && !(Buffer.isBuffer(result) && result.length === 32)) throw new VaultError('store-unavailable');
  return result;
}
