// src/core/secrets/export.mjs — `worca secrets export`: every vaulted secret back into its own config file
// (0600), then the vault file and its OS key item deleted, the secretVault flag turned off and the pending notice
// dropped. Local CLI only: only src/cli/secrets.mjs imports it (pinned by test/secrets-doors.test.mjs), and no HTTP
// route reaches it.
//
// Order (D6): inspect (an unreadable vault refuses, no change); refuse while a Worca app runs for this home or while
// WORCA_FLAGS locks the flag on; confirm; the migration lock (MIGRATE_LOCK_FILE, so the lock order stays MIGRATE → a
// store lock → the vault lock); in ONE vault transaction every reference of the owned stores resolved (any that does
// not resolve for its owner refuses `unresolved`, writing nothing) and every entry snapshotted as a digest; the literals
// restored per store, each slot only while it still holds that reference; every store re-read (zero references and the
// restored values in place, else `changed`); then deleteVault (under the vault lock: an entry added or changed since
// the snapshot refuses `changed`) and the key item; on success, the flag off and the notice gone. A failed key delete
// keeps the flag on so a rerun reaches the item. Results, reasons and log lines carry codes, counts and key names only.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listFlags, setFlags } from '../flags.mjs';
import { acquireLock } from '../metrics/lock.mjs';
import { mcpSecretRefs, restoreMcpSecretRefs } from '../mcp/store.mjs';
import { installedPluginNames, pluginSecretRefs, restorePluginSecretRefs } from '../plugin-config.mjs';
import { worcaHome } from '../projects.mjs';
import { NT_HASH_FIELD, restoreProxyLoginRef, storedLogin, storedRef } from '../proxy-credentials.mjs';
import { readSettings, restoreSettingsSecretRefs } from '../settings.mjs';
import { processAlive, readUiInstance } from '../ui-instance.mjs';
import { PROXY_KEY_NAME, mcpKeyName, pluginKeyName, settingsKeyName } from '../../shared/secrets-notice.mjs';
import { crashPoint, setCrashStore } from './crash-point.mjs';
import { MIGRATE_LOCK_FILE } from './files.mjs';
import { ackNotice, readNotice } from './notice.mjs';
import { BACKEND_LABELS, storeTimeoutMs } from './os-store.mjs';
import { VaultError, isVaultRef, refId } from './refs.mjs';
import { settingsSecretSlots } from './settings-resolver.mjs';
import { ownsSettingsHome, primedVaultStore, vaultForHome } from './settings-vault.mjs';
import { createVault, deleteVault, entryDigest, inspectVault, vaultFile } from './vault.mjs';

/** How long export waits for another process's migration lock before it refuses `lock-busy`. */
export const EXPORT_LOCK_WAIT_MS = 5_000;

const zero = () => ({ settings: 0, mcp: 0, plugin: 0, proxy: 0 });
const labelOf = (store) => store?.label ?? BACKEND_LABELS[store?.kind] ?? BACKEND_LABELS.none;

// Every reference the owned stores hold, read fresh: `{ store, ref, field, name, ...slot }`. Settings only when this
// home owns settings.json.
function storeRefs(home, ownsSettings) {
  const out = [];
  if (ownsSettings) {
    for (const slot of settingsSecretSlots(readSettings())) {
      if (isVaultRef(slot.value)) out.push({ store: 'settings', ref: slot.value, field: slot.field, name: settingsKeyName(slot), path: slot.path, modelId: slot.modelId });
    }
  }
  for (const r of mcpSecretRefs()) out.push({ store: 'mcp', ref: r.ref, field: r.field, name: mcpKeyName(r) });
  for (const name of installedPluginNames()) {
    for (const r of pluginSecretRefs(name)) out.push({ store: 'plugin', ref: r.ref, field: r.field, name: pluginKeyName({ name, profile: r.profile, key: r.key }), plugin: name, profile: r.profile, key: r.key });
  }
  const proxy = storedRef(home);
  if (proxy) out.push({ store: 'proxy', ref: proxy, field: NT_HASH_FIELD, name: PROXY_KEY_NAME });
  return out;
}

// The flag's state for export: `locked-on` (WORCA_FLAGS sets it on), `locked-off`, `on` or `off`.
function flagState() {
  const f = listFlags().find((x) => x.key === 'secretVault');
  if (!f) return 'off';
  if (f.locked) return f.on ? 'locked-on' : 'locked-off';
  return f.on ? 'on' : 'off';
}

function serverRunning() {
  const inst = readUiInstance();
  return !!inst?.pid && processAlive(inst.pid);
}

// Flag off and the notice gone (success). A flag locked off stays as it is; one already off is `unchanged`.
async function finish(home, state) {
  let flag = 'unchanged';
  if (state === 'locked-off') flag = 'locked';
  else if (state === 'on') { await setFlags({ secretVault: false }); flag = 'off'; }
  const n = readNotice({ home });
  if (n) await ackNotice({ home, id: n.id, held: true });
  return flag;
}

/**
 * Export every vaulted secret of `home` (default the Worca home). `store` injects the OS store (tests); by default the
 * settings vault's primed store. `confirm()` is asked once, after the refusals that need no lock. Never rejects for a
 * VaultError.
 * @returns {Promise<{ outcome: 'exported'|'key-removed'|'nothing'|'cancelled'|'refused', restored: object,
 *   files: string[], keyRemoved: boolean, keyError?: string, flag: 'off'|'locked'|'unchanged', reason?: string,
 *   unresolved?: string[], label?: string }>} `label` (exported, key-removed) names the OS store the key was in.
 */
export async function exportSecrets({ home, env, store, confirm = async () => false, lockWaitMs = EXPORT_LOCK_WAIT_MS, log = () => {} } = {}) {
  const h = home ?? worcaHome();
  const e = env ?? process.env;
  const timeoutMs = storeTimeoutMs(e);
  const restored = zero();
  const files = [];
  const result = (outcome, extra = {}) => ({ outcome, restored: { ...restored }, files: [...files], keyRemoved: false, flag: 'unchanged', ...extra });
  const refused = (reason, extra = {}) => result('refused', { reason, ...extra });
  const say = (line) => { try { log(line); } catch { /* a broken logger never fails the export */ } };
  const owns = ownsSettingsHome(h);
  const state = flagState();

  try {
    if (!existsSync(vaultFile(h))) return await noVault({ h, e, store, owns, state, timeoutMs, confirm, lockWaitMs, result, refused, say });

    const s = store ?? await primedVaultStore({ home: h, env: e });
    const first = await inspectVault({ home: h, store: s, timeoutMs });
    if (first.present && !first.readable) return refused(first.code ?? 'store-unavailable');
    if (serverRunning()) return refused('server-running');
    if (state === 'locked-on') return refused('flag-locked');
    if (!(await confirm())) return result('cancelled');

    return await withMigrateLock(h, lockWaitMs, refused, async () => {
      // The app may have started while confirm waited.
      if (serverRunning()) return refused('server-running');
      return underLock({ h, e, s, store, owns, state, timeoutMs, restored, files, result, refused, say });
    });
  } catch (err) {
    if (err instanceof VaultError) return refused(err.code);
    throw err;
  }
}

// The migration lock (MIGRATE_LOCK_FILE) around `fn`, with the export crash store set; a lock wait past `lockWaitMs`
// refuses `lock-busy`.
async function withMigrateLock(h, lockWaitMs, refused, fn) {
  let release;
  try {
    release = await acquireLock(join(h, MIGRATE_LOCK_FILE), { timeoutMs: lockWaitMs });
  } catch (err) {
    if (err?.code === 'LOCK_TIMEOUT') return refused('lock-busy');
    throw err;
  }
  try {
    setCrashStore('export');
    return await fn();
  } finally {
    setCrashStore(null);
    await release();
  }
}

// D7: no vault file. A reference left keeps the item (`unresolved`); with none and the flag on (a crash after the
// unlink), one deleteKey after confirm, under the migration lock (the references, the app and the vault file checked
// again there, so a migration in between keeps its key); with none and the flag off, nothing at all.
async function noVault({ h, e, store, owns, state, timeoutMs, confirm, lockWaitMs, result, refused }) {
  const unresolvedOf = () => {
    const left = storeRefs(h, owns);
    return left.length ? refused('unresolved', { unresolved: [...new Set(left.map((r) => r.name))] }) : null;
  };
  const first = unresolvedOf();
  if (first) return first;
  if (state !== 'on' && state !== 'locked-on') return result('nothing');
  if (serverRunning()) return refused('server-running');
  if (state === 'locked-on') return refused('flag-locked');
  if (!(await confirm())) return result('cancelled');
  return withMigrateLock(h, lockWaitMs, refused, async () => {
    if (serverRunning()) return refused('server-running');
    if (existsSync(vaultFile(h))) return refused('changed');
    const again = unresolvedOf();
    if (again) return again;
    const s = store ?? await primedVaultStore({ home: h, env: e });
    const r = await deleteVault({ home: h, store: s, snapshot: new Map(), storeTimeoutMs: timeoutMs });
    if (r.keyError) return result('key-removed', { keyError: r.keyError, label: labelOf(s) });
    return result('key-removed', { keyRemoved: r.keyRemoved, flag: await finish(h, state), label: labelOf(s) });
  });
}

async function underLock({ h, e, s, store, owns, state, timeoutMs, restored, files, result, refused, say }) {
  const vault = store ? createVault({ home: h, store, storeTimeoutMs: timeoutMs }) : await vaultForHome({ home: h, env: e });
  if (!vault) return refused('store-unavailable');

  // Step 5: every reference resolved for its owner and every entry snapshotted, in one transaction.
  const refs = storeRefs(h, owns);
  const { snapshot, values } = await vault.transaction(async (tx) => {
    const snap = new Map();
    const byRef = new Map();
    for (const entry of await tx.list()) {
      const value = await tx.resolve(entry.ref, entry);
      snap.set(refId(entry.ref), entryDigest({ ...entry, value }));
      byRef.set(entry.ref, { store: entry.store, field: entry.field, value });
    }
    return { snapshot: snap, values: byRef };
  });
  const own = (r) => { const v = values.get(r.ref); return v && v.store === r.store && v.field === r.field ? v.value : null; };
  const unresolved = refs.filter((r) => own(r) === null);
  if (unresolved.length) return refused('unresolved', { unresolved: [...new Set(unresolved.map((r) => r.name))] });

  // Step 6: reference → literal, per store, each slot only while it still holds that reference.
  const settings = refs.filter((r) => r.store === 'settings');
  if (settings.length) {
    restored.settings = (await restoreSettingsSecretRefs(settings.map((r) => ({ path: r.path, modelId: r.modelId, ref: r.ref, value: own(r) })))).restored;
    if (restored.settings) files.push('settings');
  }
  if (refs.some((r) => r.store === 'mcp')) {
    const m = await restoreMcpSecretRefs(async (items) => items.map((it) => own({ store: 'mcp', ...it })));
    restored.mcp = m.restored;
    if (m.restored) files.push('mcp');
  }
  for (const name of new Set(refs.filter((r) => r.store === 'plugin').map((r) => r.plugin))) {
    const swaps = refs.filter((r) => r.store === 'plugin' && r.plugin === name).map((r) => ({ profile: r.profile, key: r.key, ref: r.ref, value: own(r) }));
    const n = restorePluginSecretRefs(name, swaps).restored;
    restored.plugin += n;
    if (n) files.push(`plugin:${name}`);
  }
  const proxy = refs.find((r) => r.store === 'proxy');
  if (proxy) {
    const login = storedLogin({ home: h });
    if (login && login.ntHash === proxy.ref && restoreProxyLoginRef({ home: h, id: login.id, ref: proxy.ref, value: own(proxy) })) {
      restored.proxy = 1;
      files.push('proxy');
    }
  }
  crashPoint('after-restore');

  // Step 7: zero references left, and every restored value in place.
  const after = storeRefs(h, owns);
  if (after.length) return refused('changed');
  const total = Object.values(restored).reduce((a, b) => a + b, 0);
  say(`[worca] vault: ${total} saved secrets written back to the config file`);

  // Steps 8–10: the vault and the item, then the flag and the notice.
  const del = await deleteVault({ home: h, store: s, snapshot, storeTimeoutMs: timeoutMs });
  if (del.keyError) return result('exported', { keyRemoved: false, keyError: del.keyError, label: labelOf(s) });
  return result('exported', { keyRemoved: del.keyRemoved, flag: await finish(h, state), label: labelOf(s) });
}
