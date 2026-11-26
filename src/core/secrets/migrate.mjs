// src/core/secrets/migrate.mjs — the one-time move of file-stored secrets saved before the vault (settings.json, the
// MCP secrets.json, every plugin's secrets.json and the proxy login's NT hash) into the Worca vault. The one module
// that orders the migration; loaded only through flag.mjs `migrateSecretsIfEnabled` (secretVault on).
//
// Order: a local install only (no OS-store call otherwise); the settings prime; the migration lock
// (MIGRATE_LOCK_FILE, then a store lock, then the vault lock); the literals of all four stores counted read-only
// (none: done, no store call); a round trip on a throwaway OS item and, with a key, a fresh read-back of the master
// key, before anything moves. Then per store, in MIGRATE_STORES order: every value into a FRESH vault entry (lockless
// stores' entries born `droppedAt`-marked), a second transaction that reads them back from disk and compares, the swap
// in the store's own file (one atomic write, only fields still holding the vaulted literal), then the lockless
// entries unmarked. A literal leaves its file only after its vault copy matched; the first failure stops the run.
// The result and every log line carry states, counts and codes only.
import { join } from 'node:path';
import { acquireLock } from '../metrics/lock.mjs';
import { mcpSecretLiteralCount, migrateMcpSecretLiterals } from '../mcp/store.mjs';
import { installedPluginNames, pluginSecretLiterals, pluginSecretRefs, swapPluginSecretLiterals } from '../plugin-config.mjs';
import { worcaHome } from '../projects.mjs';
import { NT_HASH_FIELD, proxyLoginLiteral, storedRef, swapProxyLoginLiteral } from '../proxy-credentials.mjs';
import { readSettings, settingsSecretLiterals, swapSettingsSecretLiterals } from '../settings.mjs';
import { PROXY_KEY_NAME, mcpKeyName, pluginKeyName, settingsKeyName } from '../../shared/secrets-notice.mjs';
import { crashPoint, setCrashStore } from './crash-point.mjs';
import { MIGRATE_LOCK_FILE } from './files.mjs';
import { secretVaultEnabled } from './flag.mjs';
import { recordMoveNotice } from './notice.mjs';
import { VaultError } from './refs.mjs';
import { settingsSecretRefs } from './settings-resolver.mjs';
import { ownsSettingsHome, primeSettingsVault, probeSettingsVaultStore, readBackSettingsVaultKey, settingsVaultBackend, vaultForHome } from './settings-vault.mjs';
import { MAX_VALUE_BYTES, assertVaultLockFree } from './vault.mjs';

/** How long a start waits for another process's migration lock before it answers `busy`. */
export const MIGRATE_LOCK_WAIT_MS = 5_000;
export const MIGRATE_STORES = Object.freeze(['settings', 'mcp', 'plugin', 'proxy']);
export const TEST_MIGRATE_WAIT_ENV = 'WORCA_TEST_MIGRATE_WAIT_MS';

const LOCKLESS = new Set(['settings', 'plugin', 'proxy']);
const RETRY = 'Worca tries again at the next start';

/** The lock wait: 5 s, or `WORCA_TEST_MIGRATE_WAIT_MS` (clamped to 50–30 000) under the node:test runner only. */
export function migrateWaitMs(env = process.env) {
  if (!env.NODE_TEST_CONTEXT || !env[TEST_MIGRATE_WAIT_ENV]) return MIGRATE_LOCK_WAIT_MS;
  const n = Number(env[TEST_MIGRATE_WAIT_ENV]);
  if (!Number.isFinite(n)) return MIGRATE_LOCK_WAIT_MS;
  return Math.min(30_000, Math.max(50, Math.round(n)));
}

// A stop the run reports as `failed` with its own code (read-back, key-read-back), or as `skipped` for `flag-off`.
class Stop extends Error {
  constructor(code) { super(code); this.code = code; }
}

// D19: the flag is read fresh (settings.json) before each store's first put and again right before each swap's write.
// Turned off meanwhile: the run stops there; swaps already written stay vaulted (still readable: the vault is in use).
function assertFlagOn() {
  if (!secretVaultEnabled()) throw new Stop('flag-off');
}
const beforeSwap = () => { assertFlagOn(); crashPoint('before-config-rewrite'); };

const tooBig = (value) => Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES;
const fits = (it) => !tooBig(it.value);


// The literals of all four stores, read-only. `movable` counts what fits the vault; `left` what stays in the config file (a
// value over the vault limit, an insecure proxy login file, settings.json of a non-default Worca home).
function countLiterals(home, settings) {
  let movable = 0;
  let left = 0;
  const add = (values) => { for (const v of values) { if (tooBig(v)) left++; else movable++; } };
  const lits = settingsSecretLiterals(readSettings());
  if (settings) add(lits.map((l) => l.value));
  else left += lits.length;
  movable += mcpSecretLiteralCount();
  for (const name of installedPluginNames()) add(pluginSecretLiterals(name).map((l) => l.value));
  const proxy = proxyLoginLiteral({ home });
  if (proxy?.insecure) left++;
  else if (proxy) add([proxy.value]);
  return { movable, left };
}

/**
 * Migrate the file-stored secrets of Worca home `home` (default the Worca home) and the user's settings.json. Never
 * rejects. `deployment` is the house deployment (`local` | `container` | `hosted`; only `local` migrates). `reason`
 * names the caller (`start`, `flag-on`, `cli`); the `done` line is printed for every caller but the CLI.
 * Every moved key is listed by name in `keys` (`[{ store, name }]`) and, under the lock, recorded in the one-time
 * notice (notice.mjs). Turning the flag off mid-run stops it before its next put or swap: `skipped`/`flag-off`.
 * @returns {Promise<{ state: 'done'|'skipped'|'busy'|'failed', reason?: string, code?: string,
 *   moved: { settings: number, mcp: number, plugin: number, proxy: number }, left: number, keys: object[] }>}
 */
export async function migrateSecrets({ home, env, deployment, reason = 'start', log } = {}) {
  const moved = { settings: 0, mcp: 0, plugin: 0, proxy: 0 };
  const run = { left: 0, keys: [] };
  const result = (state, extra = {}) => ({ state, ...extra, moved: { ...moved }, left: run.left, keys: run.keys.map((k) => ({ ...k })) });
  const say = (line) => { try { (log ?? ((l) => console.warn(l)))(line); } catch { /* a broken logger never fails the run */ } };
  try {
    if (deployment !== 'local') return result('skipped', { reason: 'deployment' });
    const h = home ?? worcaHome();
    const e = env ?? process.env;
    const prime = await primeSettingsVault({ home: h, env: e });
    if (prime.state === 'locked' || prime.state === 'unavailable') return result('skipped', { reason: prime.state });
    assertVaultLockFree('migrate');
    let release;
    try {
      release = await acquireLock(join(h, MIGRATE_LOCK_FILE), { timeoutMs: migrateWaitMs(e), mode: 0o600 });
    } catch (err) {
      if (err?.code !== 'LOCK_TIMEOUT') throw err;
      say(`[worca] vault: secrets were not moved: another Worca process is moving them (busy); ${RETRY}`);
      return result('busy');
    }
    try {
      let out;
      try {
        out = await underLock({ home: h, env: e, prime: prime.state, moved, run, result, say });
      } finally {
        recordNotice({ home: h, env: e, run, say });   // under the lock, also after a partial move
      }
      const total = Object.values(moved).reduce((a, b) => a + b, 0);
      if (out.state === 'done' && total > 0 && reason !== 'cli') {
        say(`[worca] vault: ${total} saved secrets moved into the vault${run.left > 0 ? `, ${run.left} left in the config file` : ''}`);
      }
      return out;
    } finally {
      setCrashStore(null);
      await release();
    }
  } catch (err) {
    if (err instanceof Stop && err.code === 'flag-off') {
      say('[worca] vault: the secretVault flag was turned off; the saved secrets not moved yet stay in the config file');
      return result('skipped', { reason: 'flag-off' });
    }
    const code = err instanceof VaultError || err instanceof Stop ? err.code : 'io';
    say(`[worca] vault: moving saved secrets stopped (${code}); they keep working and ${RETRY}`);
    return result('failed', { code });
  }
}

// The one-time notice (notice.mjs): every moved key by name and the backend label, never a value. Recorded whenever
// at least one secret moved; a failure to write it never fails the run.
function recordNotice({ home, env, run, say }) {
  if (!run.keys.length) return;
  try {
    const { kind, label } = settingsVaultBackend({ home, env });
    recordMoveNotice({ home, backend: kind, label, keys: run.keys, left: run.left });
  } catch (err) {
    say(`[worca] vault: the message about moved secrets could not be saved (${err?.code || 'io'})`);
  }
}

async function underLock({ home, env, prime, moved, run, result, say }) {
  const settings = ownsSettingsHome(home);
  const count = countLiterals(home, settings);
  run.left = count.left;
  if (!count.movable) return result('done');

  // The OS store proves itself before anything moves: a round trip on a throwaway item, then the key read back.
  const skipped = (err, fallback) => {
    const code = err?.reason ?? fallback;
    say(`[worca] vault: secrets were not moved: the OS key store failed its check (${code}); they keep working and ${RETRY}`);
    return result('skipped', { reason: err?.code === 'store-locked' ? 'locked' : 'unavailable', code });
  };
  try { await probeSettingsVaultStore({ home, env }); } catch (err) {
    if (!(err instanceof VaultError)) throw err;
    return skipped(err, err.code);
  }
  if (prime === 'ready') {
    let same;
    try { same = await readBackSettingsVaultKey({ home, env }); } catch (err) {
      if (!(err instanceof VaultError)) throw err;
      return skipped(err, 'key-read-back');
    }
    if (!same) return skipped({ code: 'store-unavailable' }, 'key-read-back');
  }

  const vault = await vaultForHome({ home, env });
  if (!vault) throw new VaultError('store-unavailable');
  // With no key at the start, the first put created it (createKey sets, reads back and compares before the vault file
  // is written); before the first swap the run re-primes and reads that key back fresh once more.
  let keyChecked = prime === 'ready';
  const checkKey = async () => {
    if (keyChecked) return;
    keyChecked = true;
    const again = await primeSettingsVault({ home, env });
    if (again.state !== 'ready' || !(await readBackSettingsVaultKey({ home, env }))) throw new Stop('key-read-back');
  };
  const steps = { settings: moveSettings, mcp: moveMcp, plugin: movePlugins, proxy: moveProxy };
  for (const [i, store] of MIGRATE_STORES.entries()) {
    if (store === 'settings' && !settings) continue;
    setCrashStore(store);
    await steps[store]({ vault, store, home, moved, run, checkKey });
    if (i < MIGRATE_STORES.length - 1) crashPoint('between-stores');
  }
  return result('done');
}

// Put `items` (`[{ field, value }]`) into fresh entries of `store` (pending-marked for a lockless store), then read
// them back in a second transaction (a fresh load from disk) and compare. Returns the references, in order.
async function putAndReadBack(vault, store, items, checkKey) {
  assertFlagOn();
  const at = Date.now();
  const refs = await vault.transaction(async (tx) => {
    const out = [];
    for (const it of items) out.push(await tx.put({ store, field: it.field, value: it.value, ...(LOCKLESS.has(store) ? { droppedAt: at } : {}) }));
    return out;
  });
  await checkKey();
  crashPoint('after-vault-write');
  await vault.transaction(async (tx) => {
    for (const [i, it] of items.entries()) {
      if ((await tx.resolve(refs[i], { store, field: it.field })) !== it.value) throw new Stop('read-back');
    }
  });
  crashPoint('after-read-back');
  return refs;
}

// After a lockless store's swap: its adopted entries become live (one transaction). `held()` re-reads the store's
// file under the vault lock, and only a reference it still holds is unmarked (settleDroppedRefs's rule): one replaced
// meanwhile, by another process too, stays marked and is collected after the grace period. A crash before this is
// healed by the next prime's settle.
export async function unmarkHeld(vault, store, adopted, held) {
  if (!adopted.length) return;
  await vault.transaction(async (tx) => {
    const own = held();
    for (const a of adopted) if (own.has(a.ref)) await tx.mark(a.ref, { store, field: a.field }, null);
  });
}

const refSet = (refs) => new Set(refs.map((r) => r.ref));

async function moveSettings({ vault, store, moved, run, checkKey }) {
  const items = settingsSecretLiterals(readSettings()).filter(fits);
  if (!items.length) return;
  const refs = await putAndReadBack(vault, store, items, checkKey);
  const { adopted, write } = swapSettingsSecretLiterals(items.map((it, i) => ({ ...it, ref: refs[i] })), { beforeWrite: beforeSwap });
  await write;
  crashPoint('after-swap');
  await unmarkHeld(vault, store, adopted, () => refSet(settingsSecretRefs(readSettings())));
  moved.settings = adopted.length;
  run.keys.push(...adopted.map((a) => ({ store, name: settingsKeyName(a) })));
  run.left += items.length - adopted.length;
}

async function moveMcp({ vault, store, moved, run, checkKey }) {
  const r = await migrateMcpSecretLiterals(async (items) => {
    const fit = items.map(fits);
    const take = items.filter((_, i) => fit[i]);
    if (!take.length) return items.map(() => null);
    const refs = await putAndReadBack(vault, store, take, checkKey);
    let j = 0;
    return items.map((_, i) => (fit[i] ? refs[j++] : null));
  }, { beforeWrite: beforeSwap });
  crashPoint('after-swap');
  moved.mcp = r.moved;
  run.keys.push(...r.names.map((x) => ({ store, name: mcpKeyName(x) })));
  run.left += r.left;
}

async function movePlugins({ vault, store, moved, run, checkKey }) {
  const items = installedPluginNames().flatMap((name) => pluginSecretLiterals(name).filter(fits).map((it) => ({ ...it, name })));
  if (!items.length) return;
  const refs = await putAndReadBack(vault, store, items, checkKey);
  const adopted = [];
  for (const name of new Set(items.map((it) => it.name))) {
    const swaps = items.flatMap((it, i) => (it.name === name ? [{ ...it, ref: refs[i] }] : []));
    adopted.push(...swapPluginSecretLiterals(name, swaps, { beforeWrite: beforeSwap }).adopted);
  }
  crashPoint('after-swap');
  const names = [...new Set(items.map((it) => it.name))];
  await unmarkHeld(vault, store, adopted, () => refSet(names.flatMap((name) => pluginSecretRefs(name))));
  moved.plugin = adopted.length;
  run.keys.push(...adopted.map((a) => ({ store, name: pluginKeyName(a) })));
  run.left += items.length - adopted.length;
}

async function moveProxy({ vault, store, home, moved, run, checkKey }) {
  const lit = proxyLoginLiteral({ home });
  if (!lit || lit.insecure || tooBig(lit.value)) return;
  const item = { field: NT_HASH_FIELD, value: lit.value };
  const [ref] = await putAndReadBack(vault, store, [item], checkKey);
  const swapped = swapProxyLoginLiteral({ home, id: lit.id, value: lit.value, ref }, { beforeWrite: beforeSwap });
  crashPoint('after-swap');
  await unmarkHeld(vault, store, swapped ? [{ ref, field: item.field }] : [], () => new Set([storedRef(home)]));
  moved.proxy = swapped ? 1 : 0;
  if (swapped) run.keys.push({ store, name: PROXY_KEY_NAME });
  run.left += swapped ? 0 : 1;
}
