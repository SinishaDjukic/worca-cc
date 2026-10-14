// src/core/skills-registry/host.mjs
// Skills registry §4.1 host gates. A set's skills reach a spawn as a generated `--plugin-dir` plugin, so two facts
// about THIS machine decide what Worca may emit: which Claude Code plugin names are already installed (a session
// plugin replaces an installed one of the same name, so a set named like one is renamed — pluginNameFor), and
// whether the managed settings forbid the flag (`disableSideloadFlags`: the CLI then refuses to start). Best-effort
// reads that never throw: an unreadable file is "nothing installed" / "not forbidden" (the spawn safety net covers
// a managed file Worca could not read).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';

/**
 * A spawn refused because of the skills layer (§4.1 safety net — P4's graph executor and P6's Ask turn test a failed
 * spawn's error text with this one matcher): the managed-settings refusal names the flag and the setting ("--plugin-dir
 * is disabled by your organization's managed settings (disableSideloadFlags)", 2.1.291), an SDK host reports "…managed
 * settings (disableSideloadFlags) refused the launch", and a CLI without the flag says "unknown option '--plugin-dir'".
 * It needs the flag with its dashes or the setting's full name: a bare "sideload" / "plugin-dir" also sits in paths (a
 * run titled "…sideload…" mounts under `…/pipelines/<slug>/skills`, a checkout named vite-plugin-dir-tree), and an
 * unrelated failure that echoes one must not switch a run's skills off. Slugs never hold `--` (slugify collapses it).
 */
export const SIDELOAD_REFUSAL_RE = /--plugin-dir\b|disableSideloadFlags/i;

/**
 * The managed settings file Claude Code reads on `platform` (CLI 2.1.291, read from the binary: macOS
 * `/Library/Application Support/ClaudeCode`, Windows `C:\Program Files\ClaudeCode`, anything else `/etc/claude-code`),
 * with its `managed-settings.d/*.json` drop-ins beside it. `WORCA_CLAUDE_MANAGED_SETTINGS` names another file (tests,
 * a relocated install).
 * @param {string} [platform]
 * @param {Record<string,string|undefined>} [env]
 * @returns {string}
 */
export function managedSettingsPath(platform = process.platform, env = process.env) {
  const override = env?.WORCA_CLAUDE_MANAGED_SETTINGS;
  if (typeof override === 'string' && override.trim()) return override;
  if (platform === 'darwin') return posix.join('/Library/Application Support/ClaudeCode', 'managed-settings.json');
  if (platform === 'win32') return win32.join('C:\\Program Files\\ClaudeCode', 'managed-settings.json');
  return posix.join('/etc/claude-code', 'managed-settings.json');
}

/** The managed settings file and its `managed-settings.d/*.json` drop-ins in the order the CLI layers them (a later one
 *  wins); the drop-ins only when the folder can be read. */
export function managedSettingsFiles(platform = process.platform, env = process.env) {
  const file = managedSettingsPath(platform, env);
  let names = [];
  try { names = readdirSync(join(dirname(file), 'managed-settings.d')).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort(); } catch { names = []; }
  return [file, ...names.map((n) => join(dirname(file), 'managed-settings.d', n))];
}

/** A JSON object read from `file`, or null (missing, unreadable, not JSON, not an object). */
function readObject(file) {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

/** `disableSideloadFlags` as the CLI layers it: the managed file, then each drop-in in name order (a later file wins). */
function sideloadDisabledAt(file) {
  let value = readObject(file)?.disableSideloadFlags;
  const dropIns = join(dirname(file), 'managed-settings.d');
  let names = [];
  try { names = readdirSync(dropIns).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort(); } catch { names = []; }
  for (const n of names) {
    const doc = readObject(join(dropIns, n));
    if (doc && Object.hasOwn(doc, 'disableSideloadFlags')) value = doc.disableSideloadFlags;
  }
  return value === true;
}

/** Plugin names Claude Code loads for this user: every `enabledPlugins` key of `<config>/settings.json` (the part before
 *  `@`, enabled or not) and every skills-dir plugin (`<config>/skills/<name>/.claude-plugin/plugin.json`, loaded as
 *  `<name>@skills-dir`: the folder name and the manifest's `name`). Lower-case, unique, sorted. */
function installedPluginNamesAt(configDir) {
  const names = new Set();
  const add = (n) => { if (typeof n === 'string' && n.trim()) names.add(n.trim().toLowerCase()); };
  const enabled = readObject(join(configDir, 'settings.json'))?.enabledPlugins;
  if (enabled && typeof enabled === 'object' && !Array.isArray(enabled)) {
    for (const key of Object.keys(enabled)) add(key.split('@')[0]);
  }
  let entries = [];
  try { entries = readdirSync(join(configDir, 'skills'), { withFileTypes: true }); } catch { entries = []; }
  for (const d of entries) {
    if (!d.isDirectory() && !d.isSymbolicLink()) continue;
    const manifest = join(configDir, 'skills', d.name, '.claude-plugin', 'plugin.json');
    if (!existsSync(manifest)) continue;
    add(d.name);
    add(readObject(manifest)?.name);
  }
  return [...names].sort();
}

/**
 * This host's facts for the skills layer (§4.1).
 * @param {{ env?: Record<string,string|undefined>, platform?: string, home?: string }} [o]  seams; `CLAUDE_CONFIG_DIR`
 *   in `env` moves Claude Code's config dir off `<home>/.claude`, as it does for the CLI.
 * @returns {{ installedPluginNames: string[], sideloadDisabled: boolean }}
 */
export function skillHostFacts({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  const configDir = typeof env?.CLAUDE_CONFIG_DIR === 'string' && env.CLAUDE_CONFIG_DIR.trim()
    ? env.CLAUDE_CONFIG_DIR : join(home, '.claude');
  return {
    installedPluginNames: installedPluginNamesAt(configDir),
    sideloadDisabled: sideloadDisabledAt(managedSettingsPath(platform, env)),
  };
}
