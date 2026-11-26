// src/core/secrets/summary.mjs — how many saved secrets of each kind sit in the vault and how many are still in their
// config files, for Settings › General › Secret vault. Counts only: never a value, never a name. It reads the config
// files' references and literals (the same readers migrate.mjs and export.mjs use) and never asks the OS key store, so
// it can run on every Settings open without a Keychain prompt.
import { mcpSecretLiteralCount, mcpSecretRefs } from '../mcp/store.mjs';
import { installedPluginNames, pluginSecretLiterals, pluginSecretRefs } from '../plugin-config.mjs';
import { worcaHome } from '../projects.mjs';
import { proxyLoginLiteral, storedRef } from '../proxy-credentials.mjs';
import { readSettings, settingsSecretLiterals } from '../settings.mjs';
import { isVaultRef } from './refs.mjs';
import { settingsSecretSlots } from './settings-resolver.mjs';
import { ownsSettingsHome } from './settings-vault.mjs';

/** The four kinds, in the order every surface lists them. */
export const SECRET_KINDS = Object.freeze(['settings', 'mcp', 'plugin', 'proxy']);
const zero = () => ({ settings: 0, mcp: 0, plugin: 0, proxy: 0 });
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

/**
 * `{ vault: {settings, mcp, plugin, proxy}, files: {…} }`: references (in the vault) and literals (still in a config
 * file) per kind. A store that cannot be read counts 0. settings.json counts only for the default Worca home.
 */
export function secretCounts({ home } = {}) {
  const h = home ?? worcaHome();
  const vault = zero();
  const files = zero();
  if (safe(() => ownsSettingsHome(h), false)) {
    const s = safe(() => readSettings(), {});
    vault.settings = safe(() => settingsSecretSlots(s).filter((slot) => isVaultRef(slot.value)).length, 0);
    files.settings = safe(() => settingsSecretLiterals(s).length, 0);
  }
  vault.mcp = safe(() => mcpSecretRefs().length, 0);
  files.mcp = safe(() => mcpSecretLiteralCount(), 0);
  for (const name of safe(() => installedPluginNames(), [])) {
    vault.plugin += safe(() => pluginSecretRefs(name).length, 0);
    files.plugin += safe(() => pluginSecretLiterals(name).length, 0);
  }
  vault.proxy = safe(() => (storedRef(h) ? 1 : 0), 0);
  files.proxy = safe(() => { const p = proxyLoginLiteral({ home: h }); return p && !p.insecure ? 1 : 0; }, 0);
  return { vault, files };
}
