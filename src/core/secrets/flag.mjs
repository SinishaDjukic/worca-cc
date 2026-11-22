// src/core/secrets/flag.mjs — the one gate the secret vault slices call. Kept apart from files.mjs so the guardrail
// and Ask modules that take the secret file names do not import the flags and settings chain.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { flagEnabled } from '../flags.mjs';
import { worcaHome } from '../projects.mjs';
import { VAULT_FILE } from './files.mjs';

/** Whether the secretVault flag is on (read fresh on every call). Gates sealing new values, migration and reset. */
export function secretVaultEnabled() {
  return flagEnabled('secretVault');
}

/**
 * Whether the vault is in use for `home` (default the Worca home): the flag is on, or the home's vault file exists (a
 * migration left it, and the flag was turned off since). Reading, priming, releasing, status and export gate on this.
 * One existsSync, no store call; never throws (a home that cannot be resolved gives false).
 */
export function vaultInUse({ home } = {}) {
  try {
    return secretVaultEnabled() || existsSync(join(home ?? worcaHome(), VAULT_FILE));
  } catch {
    return false;
  }
}

/**
 * The secret migration's gate (D2): with the secretVault flag off `{ state: 'off' }` and nothing more is loaded; with
 * it on, migrate.mjs's `migrateSecrets(opts)`. The only importer of migrate.mjs. Never rejects.
 * @returns {Promise<object>}
 */
export async function migrateSecretsIfEnabled(opts = {}) {
  if (!secretVaultEnabled()) return { state: 'off' };
  try {
    const { migrateSecrets } = await import('./migrate.mjs');
    return await migrateSecrets(opts);
  } catch {
    return { state: 'failed', code: 'io', moved: { settings: 0, mcp: 0, plugin: 0, proxy: 0 }, left: 0 };
  }
}
