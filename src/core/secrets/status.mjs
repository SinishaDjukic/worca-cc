// src/core/secrets/status.mjs — the one status and reset core for `worca secrets`, `worca doctor` and the server's
// Settings line, so their wording cannot drift. Status is read-only: it never creates a key, never writes and never
// migrates. Reset only moves an unreadable vault aside, under the vault lock; it never touches the OS item.
import { existsSync } from 'node:fs';
import { worcaHome } from '../projects.mjs';
import { BACKEND_LABELS, selectOsStore, storeTimeoutMs } from './os-store.mjs';
import { UNLOCK_LINE, VAULT_MESSAGES } from './refs.mjs';
import { inspectVault, moveVaultAside, vaultFile } from './vault.mjs';

/** Unreadable codes that reset may move aside. */
const RESETTABLE = new Set(['item-missing', 'wrong-key', 'tampered']);

/** The status reported when the check itself failed. */
export function unavailableStatus() {
  return {
    backend: 'none', label: BACKEND_LABELS.none, state: 'unavailable', vault: 'unknown',
    reason: 'store-unavailable', message: VAULT_MESSAGES['store-unavailable'], checkedAt: new Date().toISOString(),
  };
}

/**
 * The backend and vault status of `home`: `{ backend, label, state, vault, reason, message, entries?, checkedAt }`.
 * state ∈ ready | locked | unavailable; vault ∈ none | readable | unreadable | unknown; reason a VaultError code or
 * null; message its fixed text or null; `entries` the entry count of a readable vault.
 */
export async function secretsStatus({ home, env, store } = {}) {
  const h = home ?? worcaHome();
  const e = env ?? process.env;
  const s = store ?? await selectOsStore({ env: e, home: h });
  const base = { backend: s.kind, label: s.label ?? BACKEND_LABELS[s.kind] ?? BACKEND_LABELS.none };
  const notChecked = (state, reason) => ({
    ...base, state, vault: existsSync(vaultFile(h)) ? 'unknown' : 'none',
    reason, message: VAULT_MESSAGES[reason], checkedAt: new Date().toISOString(),
  });
  if (s.kind === 'none') return notChecked('unavailable', 'store-unavailable');
  const r = await inspectVault({ home: h, store: s, timeoutMs: storeTimeoutMs(e) });
  if (r.code === 'store-locked') return notChecked('locked', 'store-locked');
  if (r.code === 'store-unavailable') return notChecked('unavailable', 'store-unavailable');
  const vault = !r.present ? 'none' : r.readable ? 'readable' : 'unreadable';
  return {
    ...base, state: 'ready', vault, reason: r.code ?? null, message: r.code ? VAULT_MESSAGES[r.code] : null,
    ...(r.readable ? { entries: r.entries } : {}), checkedAt: new Date().toISOString(),
  };
}

/**
 * Move an unreadable vault aside. `confirm()` runs after the first inspect and before the lock; the second inspect
 * runs under the lock. Returns `{ outcome, movedTo?, reason? }`, outcome ∈ moved | nothing | refused | cancelled.
 * A readable vault is refused with reason `readable`.
 */
export async function resetVault({ home, env, store, confirm = async () => false, lockTimeoutMs, now } = {}) {
  const h = home ?? worcaHome();
  const e = env ?? process.env;
  const s = store ?? await selectOsStore({ env: e, home: h });
  const timeoutMs = storeTimeoutMs(e);
  const first = await inspectVault({ home: h, store: s, timeoutMs });
  if (!first.present) return { outcome: 'nothing' };
  if (first.readable) return { outcome: 'refused', reason: 'readable' };
  if (!RESETTABLE.has(first.code)) return { outcome: 'refused', reason: first.code };
  if (!(await confirm())) return { outcome: 'cancelled' };
  let movedTo;
  try {
    movedTo = await moveVaultAside({
      home: h, now, lockTimeoutMs,
      check: async () => {
        const again = await inspectVault({ home: h, store: s, timeoutMs });
        return again.present && RESETTABLE.has(again.code);
      },
    });
  } catch (err) {
    if (err?.name === 'VaultError') return { outcome: 'refused', reason: err.code };
    throw err;
  }
  return movedTo ? { outcome: 'moved', movedTo } : { outcome: 'nothing' };
}

/**
 * `worca secrets status --check` (D21): the migration's preflight, a round trip on the throwaway probe item and, with a
 * key, the key read back fresh, without the migrate lock and without moving anything. Never rejects.
 * @returns {Promise<{ ok: boolean, label: string, code?: string }>} `code` a VaultError code when it failed
 */
export async function checkOsStore({ home, env } = {}) {
  const m = await import('./settings-vault.mjs');
  const label = () => m.settingsVaultBackend({ home, env }).label;
  try {
    const prime = await m.primeSettingsVault({ home, env });
    if (prime.state === 'locked') return { ok: false, label: label(), code: 'store-locked' };
    if (prime.state === 'unavailable') return { ok: false, label: label(), code: 'store-unavailable' };
    await m.probeSettingsVaultStore({ home, env });
    if (prime.state === 'ready' && !(await m.readBackSettingsVaultKey({ home, env }))) return { ok: false, label: label(), code: 'store-check' };
    return { ok: true, label: label() };
  } catch (err) {
    return { ok: false, label: label(), code: err?.name === 'VaultError' ? err.code : 'store-unavailable' };
  }
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export { UNLOCK_LINE };
/** Shown with the flag on while nothing can be vaulted: saves fall back to the config file. */
export const VAULT_INACTIVE_LINE = 'The vault is not active: keys are saved in settings.json, protected by its file permissions.';

/** Shown with the flag off while a vault is present (a migration left it in use). */
export const FLAG_OFF_VAULT_LINE = 'The secretVault flag is off: saved secrets are still read from the vault and new keys are saved in the config file. Run `worca secrets export` to move the vaulted ones back to their config files.';

/**
 * The `worca secrets status` lines. Each fact once: the state in the parentheses, the action on its own line.
 * `flagOn` adds VAULT_INACTIVE_LINE while the store is not ready and no vault exists; `flagOff` adds
 * FLAG_OFF_VAULT_LINE while a vault is present. A readable vault shows its entry count, never a value.
 */
export function statusLines(status, { flagOn = false, flagOff = false } = {}) {
  const lines = [`Secrets backend: ${status.label} (${status.state})`];
  const offLine = () => { if (flagOff && status.vault !== 'none') lines.push(FLAG_OFF_VAULT_LINE); };
  if (status.state === 'ready') {
    if (status.vault === 'unreadable') {
      lines.push(`Vault: unreadable: ${status.message}`);
      lines.push('Run `worca secrets reset` to move it aside and start a new vault.');
    } else if (status.vault === 'readable' && Number.isInteger(status.entries)) {
      lines.push(`Vault: readable (${status.entries} ${status.entries === 1 ? 'entry' : 'entries'})`);
    } else {
      lines.push(`Vault: ${status.vault}`);
    }
    offLine();
    return lines;
  }
  lines.push('Vault: not checked');
  if (status.state === 'locked') lines.push(UNLOCK_LINE);
  else if (status.backend !== 'none') lines.push(`${capital(status.message ?? VAULT_MESSAGES['store-unavailable'])}.`);
  if (flagOn && status.vault === 'none') lines.push(VAULT_INACTIVE_LINE);
  offLine();
  return lines;
}

/** The `worca doctor` line: `secrets: LABEL (ready)`, or a warning starting `secrets: !`. */
export function doctorLine(status) {
  if (status.state !== 'ready') return { text: `secrets: ! ${status.label} (${status.state}); run \`worca secrets status\``, warn: true };
  if (status.vault === 'unreadable') return { text: `secrets: ! ${status.label} (ready), vault unreadable; run \`worca secrets status\``, warn: true };
  return { text: `secrets: ${status.label} (ready)`, warn: false };
}

/**
 * The server's last status, single-flight: concurrent `refresh()` calls share one probe. `refresh()` never
 * rejects; a throwing probe settles to the unavailable status.
 */
export function createStatusCache({ probe }) {
  let inflight = null;
  let last = null;
  return {
    refresh() {
      if (inflight) return inflight;
      inflight = Promise.resolve()
        .then(() => probe())
        .catch(() => unavailableStatus())
        .then((s) => { last = s; inflight = null; return s; });
      return inflight;
    },
    last: () => last,
  };
}
