// src/core/run-assets.mjs
// Declared-asset resolution and run-folder staging.
//
// Worca CC agents may declare `requiresAssets: string[]` in their meta sidecar:
// folders shipped with worca under `assets/<name>/` that the agent needs as
// plain files. Skills mount into a worktree's `.claude/skills` because that is
// the only path the headless `claude -p` child scans; an asset is not a skill —
// it is data the agent reads or copies — so it is staged into the RUN FOLDER,
// the one directory every agent can reach on both detached and legacy runs and
// the one resume preserves.
//
// This exists because the deck kit had no staging at all: the builder prompt
// said "cp from the project checkout", the kit ships inside worca rather than
// the user's project, and a run whose project was an unrelated repo only found
// it because the agent globbed the filesystem under permissive guardrails.
//
//   - isValidAssetName()      pure: the path-segment guard (skills.mjs S2 standard)
//   - collectRequiredAssets() pure: union of requiresAssets across the plan's agents
//   - stageAssets()           side-effect: copy assets/<name>/ into the run folder
import { existsSync } from 'node:fs';
import { cp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The asset name is used as a PATH SEGMENT on both the source and the target
 *  side and arrives from author-controlled sidecar data, so it takes the same
 *  conservative guard `isValidSkillName` applies: `[A-Za-z0-9._-]+` plus the two
 *  dot cases the class alone still admits. Without it `../../x` turns the stage
 *  into a write-anywhere primitive. */
export function isValidAssetName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..';
}

/**
 * Union of `requiresAssets` across the agents in the resolved plan, sorted so a
 * run's audit line and its resume replay agree byte for byte.
 * @param {Record<string, {requiresAssets?: string[]}>} registry
 * @param {Iterable<string>} agentKeys
 * @returns {string[]}
 */
export function collectRequiredAssets(registry, agentKeys) {
  const out = new Set();
  for (const key of agentKeys || []) {
    for (const asset of registry?.[key]?.requiresAssets || []) out.add(asset);
  }
  return [...out].sort();
}

/**
 * Copy each named asset into `<target>/<name>/`, resolving it from `<root>/assets/`
 * first and then from each plugin layer in turn — the same precedence skills get
 * (pluginSkillDirs). Plugin layers contribute agents to the registry and
 * normalizeAgentMeta validates only the NAME of a `requiresAssets` entry, so
 * without a plugin layer here a plugin-shipped agent declaring one failed the
 * whole run at setup with no way to satisfy it. worca's own asset wins, so a
 * plugin cannot shadow a kit worca ships.
 *
 * Throws on an invalid or missing asset rather than staging a partial set: an
 * agent whose kit is half-present fails later, deeper, and less legibly than one
 * that never started. Overwrites on resume — the shipped asset is canonical, and
 * an agent that edited it in a previous cycle must not keep the edit.
 *
 * @param {string[]} names
 * @param {{root:string, target:string, pluginDirs?:Array<{plugin:string, dir:string}>}} opts
 * @returns {Promise<string[]>} the staged names, in the order given
 */
/** File written into every staged asset folder: worca's package root (one line). */
export const APP_ROOT_MARKER = '.worca-app-root';

export async function stageAssets(names, { root, target, pluginDirs = [] }) {
  const staged = [];
  for (const name of names || []) {
    if (!isValidAssetName(name)) throw new Error(`requiresAssets: "${name}" is not a valid asset name`);
    const candidates = [join(root, 'assets', name), ...pluginDirs.map((p) => join(p.dir, name))];
    const src = candidates.find((dir) => existsSync(dir));
    if (!src) {
      throw new Error(`requiresAssets: asset "${name}" not found at ${candidates.join(' or ')}`);
    }
    await cp(src, join(target, name), { recursive: true, force: true });
    // A staged copy has no node_modules beside it: record worca's package root so the kit's own tools can
    // resolve worca's dependencies (promo-kit's capture lib needs playwright-core) from the run folder.
    await writeFile(join(target, name, APP_ROOT_MARKER), String(root) + '\n');
    staged.push(name);
  }
  return staged;
}
