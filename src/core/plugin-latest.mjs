// src/core/plugin-latest.mjs — the Installed rows' "Update x.y" hint (Marketplace redesign, CONTRACT §1.1 `latest`,
// S3 G2 a–d). Zero network: it reads only the marketplaces.json snapshots the caller hands in, and names a version
// only when Update would pull it — from the marketplace that installed the plugin (a), on the branch the lock follows
// (b), with a real version on both sides (c, a version-less plugin's lock version is its sha7). The snapshot is only
// as fresh as that marketplace's last refresh (d); the update preview stays the authority.
import { semverAtLeast } from './policy/registry.mjs';
import { inventoryAccessChanges } from '../shared/plugin-access.mjs';

const VERSION_RE = /^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** A prerelease: a `-tag` before any `+build`. */
const isPrerelease = (v) => /^[^+-]*-/.test(v);

/** `candidate` orders above `installed`: both look like versions (a sha, null or other text never orders) and either
 *  semverAtLeast(installed, candidate) is false (numeric major.minor.patch), or the two share major.minor.patch and only
 *  the installed one is a prerelease (1.0.0 above 1.0.0-beta.1). Two prereleases of one version never order. */
export function isNewerVersion(candidate, installed) {
  if (typeof candidate !== 'string' || typeof installed !== 'string' || !VERSION_RE.test(candidate) || !VERSION_RE.test(installed)) return false;
  if (!semverAtLeast(installed, candidate)) return true;
  return semverAtLeast(candidate, installed) && isPrerelease(installed) && !isPrerelease(candidate);
}

/**
 * The newer version a plugin's own marketplace snapshot lists, or null.
 * @param {string} name                     the installed plugin's name
 * @param {object} lockEntry                its plugins.lock.json entry
 * @param {object|null} installedInventory  installedInventory(name); null when the installed manifest is unreadable
 * @param {object|null} marketplaces        readMarketplaces().marketplaces (null, e.g. the CLI: never a hint)
 * @returns {null | { version: string, sha: string, marketplace: string, access: Array<{kind, id, red}> }}
 */
export function pluginLatest(name, lockEntry, installedInventory, marketplaces) {
  const lock = lockEntry && typeof lockEntry === 'object' ? lockEntry : {};
  if (lock.linked === true || !marketplaces || typeof marketplaces !== 'object') return null;
  const id = lock.marketplace;
  if (typeof id !== 'string' || !Object.hasOwn(marketplaces, id)) return null;
  const entry = marketplaces[id];
  const sha = entry?.lastSync?.sha;
  if (typeof sha !== 'string' || !sha) return null;
  const snap = (Array.isArray(entry.plugins) ? entry.plugins : []).find((p) => p && p.name === name);
  if (!snap) return null;
  if ((lock.ref ?? null) !== (entry.ref ?? null)) return null;
  if (typeof lock.pinnedSha === 'string' && lock.version === lock.pinnedSha.slice(0, 7)) return null;
  if (!isNewerVersion(snap.version, lock.version)) return null;
  return {
    version: snap.version,
    sha,
    marketplace: id,
    access: installedInventory ? inventoryAccessChanges(installedInventory, snap.inventory) : [],
  };
}
