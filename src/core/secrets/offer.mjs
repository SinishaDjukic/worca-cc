// src/core/secrets/offer.mjs — whether the setup assistant (and `worca setup`) offers the secret vault, decided with no
// OS key store call: no Keychain prompt, no Secret Service unlock, during detection. It looks at where Worca runs
// (place.mjs), the secretVault flag, whether the native keyring binding loads (keyring-backend.mjs: loading it asks
// the OS nothing) and the counts by kind (summary.mjs). The real write and read check runs only when the person
// chooses the vault (the card's Turn on, the assistant's apply).
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { secretVaultFlagOn } from './flag.mjs';
import { loadKeyring } from './keyring-backend.mjs';
import { BACKEND_LABELS, TEST_OS_STORE_ENV } from './os-store.mjs';
import { vaultUnavailableHere } from './place.mjs';
import { secretCounts } from './summary.mjs';
import { totalOf } from '../../shared/secret-vault-view.mjs';

/**
 * The key store this machine would use, without asking it: `{ kind, label, usable }`. usable: true (a binding that
 * loads on macOS or Windows), 'maybe' (Linux and WSL2: only a call can tell, and detection makes none), false (none).
 * Under node:test with the fake switch it reads the fake's state file instead (never the real store).
 */
export function keyStoreHint({ env = process.env, platform = process.platform, keyring = loadKeyring } = {}) {
  if (vaultUnavailableHere(env)) return { kind: 'none', label: BACKEND_LABELS.none, usable: false, reason: 'container' };
  const fake = env[TEST_OS_STORE_ENV];
  if (fake && isAbsolute(fake) && env.NODE_TEST_CONTEXT) {
    let st = {};
    try { if (existsSync(fake)) st = JSON.parse(readFileSync(fake, 'utf8')); } catch { st = {}; }
    const state = st.state ?? 'available';
    return { kind: 'fake', label: typeof st.label === 'string' ? st.label : BACKEND_LABELS.fake, usable: state !== 'unavailable' };
  }
  if (env.NODE_TEST_CONTEXT) return { kind: 'none', label: BACKEND_LABELS.none, usable: false };   // a test never asks the real one
  if (platform === 'darwin' || platform === 'win32') {
    const kind = platform === 'darwin' ? 'keychain' : 'credential-manager';
    return keyring() ? { kind, label: BACKEND_LABELS[kind], usable: true } : { kind: 'none', label: BACKEND_LABELS.none, usable: false };
  }
  if (platform === 'linux') return keyring() || String(env.WSL_DISTRO_NAME || '') ? { kind: 'secret-service', label: BACKEND_LABELS['secret-service'], usable: 'maybe' }
    : { kind: 'none', label: BACKEND_LABELS.none, usable: false };
  return { kind: 'none', label: BACKEND_LABELS.none, usable: false };
}

/**
 * The setup offer: `{ offer, state, label, inFiles, inVault }`. `offer` is true on a native install with the flag on, a
 * usable key store and secrets still in their files. state: off | interrupted | on | unavailable | container | flag-off.
 */
export function vaultOffer({ env = process.env, home, hint = keyStoreHint({ env }), counts } = {}) {
  if (vaultUnavailableHere(env)) return { offer: false, state: 'container', label: hint.label, inFiles: 0, inVault: 0 };
  if (!secretVaultFlagOn()) return { offer: false, state: 'flag-off', label: hint.label, inFiles: 0, inVault: 0 };
  const c = counts ?? secretCounts({ home });
  const inFiles = totalOf(c.files); const inVault = totalOf(c.vault);
  if (!hint.usable) return { offer: false, state: 'unavailable', label: hint.label, inFiles, inVault };
  const state = inFiles === 0 ? 'on' : inVault > 0 ? 'interrupted' : 'off';
  return { offer: inFiles > 0, state, label: hint.label, inFiles, inVault, files: c.files };
}
