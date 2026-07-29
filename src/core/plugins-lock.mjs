// src/core/plugins-lock.mjs
// Plugin on-disk layout roots + plugins.lock.json (plugin spec §5). The lock is
// a diffable FILE, deliberately NOT a worca-cc.db table: the shared-DB
// cross-branch user_version stamping is a recorded hazard (db.mjs
// reconcileSchema), and the plugin layer is machine-global like ~/.worca-cc/agents.
// Lock shape: { [name]: { repo, subdir, pinnedSha, version, enabled,
// installedAt, linked?: true, ...unknown keys preserved verbatim } }.
// Sync IO mirrors settings.mjs: reads never throw; write is temp+rename atomic
// (the settings.mjs:89-92 idiom, sync variant).

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { worcaHome } from './projects.mjs';

/** Anti-traversal guard: a plugin name is a bare kebab dir stem, never a path. */
export const DIR_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
function safeName(name) {
  const n = String(name ?? '');
  if (!DIR_NAME_RE.test(n)) throw new Error(`invalid plugin name "${n}"`);
  return n;
}

export function pluginsRoot() { return join(worcaHome(), 'plugins'); }
export function pluginDir(name) { return join(pluginsRoot(), safeName(name)); }
export function pluginCurrentDir(name) { return join(pluginDir(name), 'current'); }
export function pluginDataDir(name) { return join(pluginDir(name), 'data'); }
export function pluginsLockFile() { return join(pluginsRoot(), 'plugins.lock.json'); }

/** Read the lock; missing/corrupt/non-object -> {}. Entries are NOT normalized:
 *  unknown keys written by newer worca-cc versions survive read-modify-write cycles. */
export function readPluginsLock() {
  try {
    const v = JSON.parse(readFileSync(pluginsLockFile(), 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Atomic write (temp+rename). Creates the plugins root on first use. */
export function writePluginsLock(lock) {
  const file = pluginsLockFile();
  mkdirSync(pluginsRoot(), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(lock ?? {}, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
  return lock ?? {};
}
