// src/core/skills.mjs
// Declared-skill resolution, validation, and worktree injection.
//
// Worca CC agents may declare `requiresSkills: string[]` in their meta sidecar.
// A skill is only reachable by the headless `claude -p` child when it sits on a
// scan path: `<cwd>/.claude/skills/<name>/` or `~/.claude/skills/<name>/`.
// Worca CC's own repo `skills/` dir is on NEITHER, so a bundled skill must be
// COPIED into the run's worktree before any node runs. This module:
//   - resolveSkill()          pure: where does a skill live? (bundle|global|project|none)
//   - collectRequiredSkills() pure: union of requiresSkills across the plan's agents
//   - validateSkills()        gate: throw a structured abort if any are unresolvable
//   - injectSkills()          side-effect: copy bundle/plugin skills into given target(s)

import { existsSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readPluginsLock, pluginCurrentDir } from './plugins-lock.mjs'; // plugin skill roots (Task 2)

/**
 * Ordered plugin skill roots for resolveSkill's ctx.pluginDirs: every ENABLED
 * plugin's current/skills dir that exists, lexicographic by plugin name (the
 * same determinism as pluginAgentLayers). try/catch mirrors userAgentsDir():
 * no resolvable home / no lock => [] — zero plugins is byte-identical to today.
 * @returns {Array<{plugin: string, dir: string}>}
 */
export function pluginSkillDirs() {
  try {
    const lock = readPluginsLock();
    return Object.keys(lock)
      .sort()
      .filter((name) => lock[name] && lock[name].enabled !== false)
      .map((name) => ({ plugin: name, dir: join(pluginCurrentDir(name), 'skills') }))
      .filter(({ dir }) => existsSync(dir));
  } catch {
    return [];
  }
}

/**
 * S2 (path-segment guard). A skill name is used as a PATH SEGMENT at both mount
 * sites — `injectSkills`' `join(t, '.claude', 'skills', skill)` and
 * `assembleSkills`' `join(target, effective)` (run-context.mjs) — and it arrives
 * from author-controlled agent frontmatter (`requiresSkills`) or, on resume, from a
 * disk-read `run.json.skillResolutions`. Unvalidated, `../../x` turns either mount
 * into a write-anywhere primitive.
 *
 * The standard is `createWorktree`'s, verbatim (worktree.mjs S2/checkoutName): the
 * conservative `[A-Za-z0-9._-]+` class plus the two dot cases the class alone still
 * admits. Callers differ only in POSTURE — a declared skill is rejected LOUDLY at
 * preflight (validateSkills), a manifest entry is SKIPPED with a warning (§8.20:
 * a corrupt run.json must not make a paused run unresumable).
 * @param {unknown} name
 * @returns {boolean}
 */
export function isValidSkillName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..';
}

/**
 * Resolve a skill name to its source, in priority order:
 *   0. plugin (OWNER)  — <plugins>/<name>/current/skills/<skill>/SKILL.md, only for
 *                        the plugin named by ctx.origin ('plugin:<name>' — the
 *                        requesting agent's registry origin)
 *   1. bundle  — <repoRoot>/skills/<name>/SKILL.md     (injectSkills copies this into the worktree)
 *   2. global  — <homeDir>/.claude/skills/<name>/SKILL.md   (already on the scan path)
 *   3. project — <projectDir>/.claude/skills/<name>/SKILL.md (committed; already on the scan path)
 *   4. plugin (others) — every remaining ctx.pluginDirs entry, in given order
 *   5. none    — unresolvable
 * pluginDirs entries are { plugin, dir } (pluginSkillDirs()); a plain-string dir is
 * tolerated (never owner, source 'plugin'). pluginDirs=[] + origin=null keeps the
 * legacy 3-path chain and 3-entry `searched` byte-identical. Pure: existsSync only.
 * @param {string} name
 * @param {{repoRoot:string, projectDir:string, homeDir?:string,
 *          pluginDirs?:Array<{plugin:string,dir:string}|string>, origin?:string|null}} ctx
 * @returns {{source:string|null, path:string|null, searched:string[]}}
 */
export function resolveSkill(name, { repoRoot, projectDir, homeDir = homedir(), pluginDirs = [], origin = null }) {
  const dirs = (Array.isArray(pluginDirs) ? pluginDirs : [])
    .map((p) => (typeof p === 'string' ? { plugin: null, dir: p } : p))
    .filter((p) => p && typeof p.dir === 'string' && p.dir);
  const ownerName = typeof origin === 'string' && origin.startsWith('plugin:')
    ? origin.slice('plugin:'.length)
    : null;
  const asHit = (p) => ({ source: p.plugin ? `plugin:${p.plugin}` : 'plugin', dir: join(p.dir, name) });
  const chain = [
    ...dirs.filter((p) => p.plugin !== null && p.plugin === ownerName).map(asHit), // owner FIRST
    { source: 'bundle',  dir: join(repoRoot, 'skills', name) },
    { source: 'global',  dir: join(homeDir, '.claude', 'skills', name) },
    { source: 'project', dir: join(projectDir, '.claude', 'skills', name) },
    ...dirs.filter((p) => p.plugin === null || p.plugin !== ownerName).map(asHit), // others LAST
  ];
  const searched = chain.map((c) => join(c.dir, 'SKILL.md'));
  for (let i = 0; i < chain.length; i++) {
    if (existsSync(searched[i])) return { source: chain[i].source, path: chain[i].dir, searched };
  }
  return { source: null, path: null, searched };
}

/**
 * Union of `requiresSkills` across the agents that appear in the resolved plan.
 * Returns one entry per distinct skill with the agent keys that require it (for
 * error attribution), sorted by skill name.
 *
 * `registry` is the plain object returned by loadAgentRegistry (keyed by agent
 * key); `plan.steps` is Array<Array<node>> and each node has `.key`.
 * @param {Record<string, {requiresSkills?: string[]}>} registry
 * @param {{steps?: Array<Array<{key:string}>>}} plan
 * @returns {Array<{skill:string, requiredBy:string[]}>}
 */
export function collectRequiredSkills(registry, plan) {
  const nodeKeys = new Set();
  for (const group of plan?.steps || []) for (const node of group) nodeKeys.add(node.key);
  /** @type {Map<string, Set<string>>} */
  const bySkill = new Map();
  for (const key of nodeKeys) {
    for (const skill of registry?.[key]?.requiresSkills || []) {
      if (!bySkill.has(skill)) bySkill.set(skill, new Set());
      bySkill.get(skill).add(key);
    }
  }
  return [...bySkill.keys()].sort().map((skill) => {
    const requiredBy = [...bySkill.get(skill)].sort();
    // Owner attribution for plugin-first search: the FIRST (sorted) requiring
    // agent whose registry meta carries a plugin origin. The key is OMITTED when
    // none does, so legacy fixtures/deepEqual call sites are byte-identical.
    const origin = requiredBy
      .map((k) => registry?.[k]?.origin)
      .find((o) => typeof o === 'string' && o.startsWith('plugin:'));
    return origin ? { skill, requiredBy, origin } : { skill, requiredBy };
  });
}

/**
 * Preflight gate. Resolve every required skill; if ANY is unresolvable, throw a
 * single aggregated error naming each (requiring agent(s), skill, searched paths)
 * so the user fixes them all at once. On success, return the resolutions keyed by
 * skill (consumed by injectSkills). Throws BEFORE any node runs; the thrown plain
 * Error lands in run()'s error branch → run ends with status 'error', message
 * surfaced.
 * @param {Array<{skill:string, requiredBy:string[]}>} required
 * @param {{repoRoot:string, projectDir:string, homeDir?:string}} ctx
 * @returns {Map<string, {source:string, path:string, requiredBy:string[]}>}
 */
export function validateSkills(required, ctx) {
  const resolved = new Map();
  const missing = [];
  const invalid = [];
  for (const { skill, requiredBy, origin } of required) {
    // S2 FIRST: a name that cannot be a path segment is never searched, so a
    // traversal is always reported as a traversal instead of being masked by a
    // "not found" listing of three joined-and-normalized paths.
    if (!isValidSkillName(skill)) { invalid.push({ skill, requiredBy }); continue; }
    const r = resolveSkill(skill, { ...ctx, origin: origin ?? null });
    if (r.source === null) missing.push({ skill, requiredBy, searched: r.searched });
    else resolved.set(skill, { source: r.source, path: r.path, requiredBy });
  }
  if (invalid.length) {
    throw new Error(
      `Preflight failed: ${invalid.length} required skill(s) have an invalid skill name. ` +
        'A skill name becomes a directory name under `.claude/skills/`, so it may contain only ' +
        'letters, digits, `.`, `_` and `-`, and may not be `.` or `..`:\n' +
        invalid
          .map((m) => `  - ${JSON.stringify(m.skill)} (required by ${m.requiredBy.join(', ')})`)
          .join('\n'),
    );
  }
  if (missing.length) {
    const lines = missing.map(
      (m) =>
        `  - skill "${m.skill}" (required by ${m.requiredBy.join(', ')}) not found. Searched:\n` +
        m.searched.map((p) => `      ${p}`).join('\n'),
    );
    throw new Error(
      `Preflight failed: ${missing.length} required skill(s) unavailable. ` +
        `Bundle them in the worca-cc repo (skills/<name>/) or install under ~/.claude/skills/:\n` +
        lines.join('\n'),
    );
  }
  return resolved;
}

/**
 * Copy each BUNDLE- or PLUGIN-sourced skill into every given target's
 * .claude/skills/ (global/project skills are already on the scan path — nothing to
 * copy). Runs ONLY after validateSkills passes. A copy failure rejects, aborting
 * the run before any node starts (no half-injected skill dir reaches a node).
 *
 * `targets` MUST be dirs worca-cc owns — real isolated checkouts (never the main
 * projectDir) or a run root. The orchestrator guards this before calling (see §5)
 * so injection cannot pollute the user's working tree. The parameter is generic
 * because a detached WORKSPACE run mounts once at the run root instead of N
 * worktrees (§5.6 entry class 3); that call site lives in run-context.mjs, so under
 * `detached` this function is not the delivery path at all — it stays the byte-
 * identical LEGACY one (§10 rollback contract).
 * @param {Map<string, {source:string, path:string}>} resolutions
 * @param {{targets:string[]}} ctx
 * @returns {Promise<string[]>} skill names actually injected
 */
export async function injectSkills(resolutions, { targets }) {
  const injected = [];
  for (const [skill, r] of resolutions) {
    if (r.source !== 'bundle' && !String(r.source || '').startsWith('plugin:')) continue;
    for (const t of targets || []) {
      await cp(r.path, join(t, '.claude', 'skills', skill), { recursive: true });
    }
    injected.push(skill);
  }
  return injected;
}
