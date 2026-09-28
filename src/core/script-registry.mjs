// src/core/script-registry.mjs
// Data-driven script registry (spec §8.1): scripts/*.meta.json (built-in) +
// ~/.worca-cc/scripts (user) + <plugin>/current/scripts (enabled plugins), merged
// builtin > user > plugin, sorted by `.order`. A sibling of agent-registry.mjs
// that shares its layer scanner and its plugin-layer walk. D16: keys share ONE
// namespace with agents — a script whose key an agent holds is dropped here,
// with a warning, so a log role, a results row and a palette pill are never
// ambiguous. Read synchronously, no cache: always reloadable.
import { join, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worcaHome } from './projects.mjs';
import { scanMetaLayer, pluginLayers, loadAgentRegistry } from './agent-registry.mjs';
import { normalizeScriptMeta, resolvePlatformValue } from '../shared/graph/script-meta.mjs';

/** The built-in layer: repo `scripts/` (D20), the pair of `agents/`. fileURLToPath, never `.pathname` (Windows). */
export const DEFAULT_SCRIPTS_DIR = fileURLToPath(new URL('../../scripts/', import.meta.url));

/** <worcaHome()>/scripts, resolved fresh; null when the home cannot be resolved (bare node:test). */
export function userScriptsDir() {
  try { return join(worcaHome(), 'scripts'); } catch { return null; }
}

export function pluginScriptLayers() { return pluginLayers('scripts'); }

/** The registry's normalizer: the shared one, with the skip-and-warn contract the loader needs. */
export function normalizeScript(raw, { warn = console.warn } = {}) {
  const key = typeof raw?.key === 'string' && raw.key.trim() ? raw.key.trim() : '<unkeyed>';
  const { meta, errors } = normalizeScriptMeta(raw, { warn });
  if (errors.length) {
    warn(`[script-registry] sidecar "${key}" is invalid; skipped: ${errors.join('; ')}`);
    return null;
  }
  return meta;
}

/** Stamp the host-platform program path and command. A `file` that resolves
 *  outside its layer dir drops the sidecar (belt and braces behind the basename rule). */
function stampPaths(dir, origin, platform, onDrop) {
  return ({ meta, file }) => {
    const rel = resolvePlatformValue(meta.file, platform);
    if (meta.file && !rel) {
      console.warn(`[script-registry] ${origin}/${file}: file has no entry for ${platform}; skipped`);
      if (onDrop) onDrop({ origin, file, reason: `no file for ${platform}` });
      return null;
    }
    if (rel && (isAbsolute(rel) || !resolve(dir, rel).startsWith(resolve(dir) + sep))) {
      console.warn(`[script-registry] ${origin}/${file}: file "${rel}" resolves outside the scripts dir — ignored`);
      if (onDrop) onDrop({ origin, file, reason: `file "${rel}" resolves outside the scripts dir` });
      return null;
    }
    meta.scriptPath = rel ? join(dir, rel) : null;             // computed, never stored
    meta.commandResolved = resolvePlatformValue(meta.command, platform);
    meta.scriptsDir = dir;
    return meta;
  };
}

/**
 * @param {{scriptsDir?:string, userScriptsDir?:string|null, includePlugins?:boolean,
 *   agentKeys?:Set<string>|string[]|null, onDrop?:Function, platform?:string}} [opts]
 *   agentKeys: the agent registry's keys (D16). Absent => loadAgentRegistry() is
 *   consulted; null => no collision check (tests).
 * @returns {Record<string, object>} script key -> meta, sorted by `.order`
 */
export function loadScriptRegistry(opts = {}) {
  const platform = opts.platform || process.platform;
  const onDrop = typeof opts.onDrop === 'function' ? opts.onDrop : null;
  const scriptsDir = opts.scriptsDir || DEFAULT_SCRIPTS_DIR;
  const scan = (dir, origin, extra = {}) => scanMetaLayer(dir, origin, { normalize: normalizeScript, tag: 'script-registry', onDrop, ...extra })
    .map(stampPaths(dir, origin, platform, onDrop)).filter(Boolean);

  const builtins = scan(scriptsDir, 'builtin');
  const taken = new Set(builtins.map((m) => m.key));
  const userDir = opts.userScriptsDir === undefined ? userScriptsDir() : opts.userScriptsDir;
  const users = [];
  if (userDir) {
    for (const m of scan(userDir, 'user')) {
      if (taken.has(m.key)) {
        console.warn(`[script-registry] user script "${m.key}" shadows a built-in and was skipped (built-ins are immutable)`);
        if (onDrop) onDrop({ origin: 'user', file: `${m.key}.meta.json`, reason: 'shadows a built-in script' });
        continue;
      }
      taken.add(m.key);
      users.push(m);
    }
  }
  const plugins = [];
  if (opts.includePlugins !== false) {
    for (const { plugin, dir, builtFor } of pluginScriptLayers()) {
      for (const m of scan(dir, `plugin:${plugin}`, { builtFor })) {
        if (taken.has(m.key)) {
          console.warn(`[script-registry] plugin script "${m.key}" (plugin "${plugin}") collides with an existing script and was skipped`);
          if (onDrop) onDrop({ origin: `plugin:${plugin}`, file: `${m.key}.meta.json`, reason: 'collides with an existing script' });
          continue;
        }
        taken.add(m.key);
        plugins.push(m);
      }
    }
  }
  // D16: agents win a shared key, deterministically.
  const agentKeys = opts.agentKeys === null ? new Set()
    : opts.agentKeys instanceof Set ? opts.agentKeys
      : Array.isArray(opts.agentKeys) ? new Set(opts.agentKeys)
        : new Set(Object.keys(loadAgentRegistry()));
  const registry = {};
  for (const m of [...builtins, ...users, ...plugins].sort((a, b) => a.order - b.order)) {
    if (agentKeys.has(m.key)) {
      console.warn(`[script-registry] "${m.key}" collides with an agent key; skipped`);
      if (onDrop) onDrop({ origin: m.origin, file: `${m.key}.meta.json`, reason: 'collides with an agent key' });
      continue;
    }
    registry[m.key] = m;
  }
  return registry;
}
