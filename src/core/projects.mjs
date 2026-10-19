// src/core/projects.mjs
// Named project registry: a small persistent list of { name, path } entries the
// web UI uses to populate its project dropdown.
//
// node:sqlite migration: now persisted in the `projects` table; path helpers vestigial.
//
// Reads never throw: a fresh/empty DB yields an empty list. Writes validate then
// persist inside a single db.mjs tx(). Each row is keyed by projectKey(path)
// (store.mjs), so every worktree of a repo maps to one row.

import { existsSync, statSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { getWorcaRoot, defaultRoot } from './settings.mjs';
import { getDb, prepare, tx } from './db.mjs';
import { projectKey, canonicalProjectRoot, isNoProjectWorkDir } from './store.mjs';
import { gitAvailable, gitState } from './git-available.mjs';
import { detectVcs, normalizeVcs, samePath } from './project-kind.mjs';
import { NO_PROJECT_ERRORS } from '../shared/no-project.mjs';

export { detectVcs, displayPath } from './project-kind.mjs';

/**
 * Absolute path to the .worca-cc data directory. Base resolution precedence:
 *   1. WORCA_HOME env (non-empty)  — tests/smoke isolation + CLI override
 *   2. persisted Settings root        — the user-chosen "Worca CC root folder"
 *   3. defaultRoot()                  — the OS home
 * Read fresh every call, so a saved root applies to new operations w/o restart.
 */
export function worcaHome() {
  const env = process.env.WORCA_HOME;
  if (!(env && env.trim()) && process.env.NODE_TEST_CONTEXT &&
      !process.env.WORCA_TEST_ALLOW_HOME_FALLBACK) {
    // Under the node:test runner the real ~/.worca-cc must be unreachable: a test
    // (or a fire-and-forget write outliving its teardown) that resolves the home
    // with no WORCA_HOME set would silently pollute the user's real store.
    // WORCA_TEST_ALLOW_HOME_FALLBACK opts out for tests that exercise the
    // settings/home fallback tiers and sandbox HOME/USERPROFILE themselves.
    throw new Error(
      'worcaHome(): WORCA_HOME is unset under the node:test runner — ' +
      'tests must never touch the real ~/.worca-cc (use test/helpers/temp-home.mjs#useTempHome)'
    );
  }
  const base = env && env.trim() ? env : (getWorcaRoot() || defaultRoot());
  return join(resolve(base), '.worca-cc');
}

/**
 * Absolute path to the (legacy) registry file.
 *
 * VESTIGIAL (node:sqlite migration §0.6): the registry now lives in the `projects`
 * table, not this JSON file. This export is retained only for backward
 * import-compatibility (test imports); it no longer describes where data lives.
 */
export function projectsFile() {
  return join(worcaHome(), 'projects.json');
}

/**
 * Expand a leading ~ and resolve to an absolute path. Mirrors the web server's
 * historical resolveProjectDir so the registry and runs agree on a path.
 * @param {string} input
 * @returns {string|null} absolute path, or null for empty/non-string input
 */
export function normalizeProjectPath(input) {
  if (!input || typeof input !== 'string' || !input.trim()) return null;
  let p = input.trim();
  if (p.startsWith('~')) p = join(defaultRoot(), p.slice(1));   // HOME, USERPROFILE, else the OS home (an env-scrubbed child)
  return resolve(p);
}

/** True when the path exists and is a directory. */
function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read the raw registry rows from the DB, ordered by creation then name for a
 * stable list. Never throws (a fresh DB simply has no rows). The DB call is
 * synchronous (node:sqlite); we return the plain array.
 * @returns {Array<{key:string, name:string, path:string, vcs:string|null}>}
 */
function readRows() {
  getDb(); // ensure the singleton is open + migrated before preparing
  return prepare(
    'SELECT key, name, path, vcs FROM projects ORDER BY created_at, name'
  ).all();
}

/**
 * List saved projects, each annotated with a runtime `exists` flag (true when the
 * path is an existing directory). The flag is computed, never persisted. `key` is
 * the registry key (store.mjs#projectKey at registration) — the id the Ask Worca
 * catalog and propose_run use, so callers never re-derive it from the path.
 * `vcs` is the stored kind ('git' | 'none'; a NULL row reads as 'git'), never re-inferred.
 * Reads from the projects table; never throws.
 * @returns {Promise<Array<{key:string, name:string, path:string, exists:boolean, vcs:'git'|'none'}>>}
 */
export async function listProjects() {
  return readRows().map((e) => ({ key: e.key, name: e.name, path: e.path, exists: isDir(e.path), vcs: normalizeVcs(e.vcs) }));
}

/**
 * Number of registered projects (missing-on-disk rows included, matching the
 * Projects list + its sidebar count). Cheap COUNT(*); never throws.
 * Uses the bare `prepare` already imported at projects.mjs:14.
 * @returns {number}
 */
export function countProjects() {
  getDb(); // ensure the singleton is open + migrated before preparing
  const row = prepare('SELECT COUNT(*) AS n FROM projects').get();
  return row ? Number(row.n) : 0;
}

/**
 * Validate one {name, path, vcs?} and insert it in its own tx(). Synchronous (node:sqlite): callers
 * await gitState() first. `vcs` omitted → detectVcs(path) when the path exists, else 'git' (a path
 * registered before it exists is created and git-inited by its first run).
 * @returns {{key:string, name:string, path:string, vcs:'git'|'none'}} the stored row
 * @throws {Error} on empty name/path, a path that exists but is not a directory, a vcs other than
 *   'git' / 'none', a Folder inside a git work tree it is not the top of (code NESTED_IN_REPO),
 *   a duplicate name (case-insensitive), or a duplicate path/key.
 */
export function insertProject(input, { gitOn = gitAvailable() } = {}) {
  const name = (input && typeof input.name === 'string' ? input.name : '').trim();
  if (!name) throw new Error('project name is required');
  const path = normalizeProjectPath(input && input.path);
  if (!path) throw new Error('project path is required');
  // P3-D11: a run's work folder is never a project. Before the vcs / nested check: an existing work folder in a
  // git-tracked worcaHome would otherwise answer "Inside a git repository".
  if (isNoProjectWorkDir(path)) throw new Error(NO_PROJECT_ERRORS.register);
  // A path that exists must be a directory; a non-existent path is allowed (the run
  // creates it), matching the orchestrator's mkdir-on-run behavior.
  if (existsSync(path) && !isDir(path)) throw new Error('path is not a directory');

  const vcs = input?.vcs != null ? input.vcs : existsSync(path) ? detectVcs(path) : 'git';
  if (vcs !== 'git' && vcs !== 'none') throw new Error('vcs must be "git" or "none"');
  if (vcs === 'none') {
    // Before the same-key check: a nested folder's projectKey is its parent's, so "already registered" would hide why.
    const nested = nestedRepoOf(path, { gitOn });
    if (nested) {
      const err = new Error(nested.partOf ? `Part of ${nested.partOf}` : 'Inside a git repository');
      err.code = 'NESTED_IN_REPO'; err.repoRoot = nested.repoRoot; err.partOf = nested.partOf;
      throw err;
    }
  }
  const key = projectKey(path);
  const createdAt = new Date().toISOString();
  tx(() => {
    // Case-insensitive duplicate-name guard (matches the legacy check + the index).
    const clash = prepare('SELECT 1 FROM projects WHERE name = ? COLLATE NOCASE').get(name);
    if (clash) throw new Error(`a project named "${name}" already exists`);
    // Same path -> same key -> PK collision; report it cleanly rather than crashing.
    const sameKey = prepare('SELECT 1 FROM projects WHERE key = ?').get(key);
    if (sameKey) throw new Error('this project path is already registered');
    prepare(
      'INSERT INTO projects (key, name, path, created_at, vcs) VALUES (?, ?, ?, ?, ?)'
    ).run(key, name, path, createdAt, vcs);
  });
  return { key, name, path, vcs };
}

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

/** The nearest ancestor of `dir` holding a `.git` entry (dir or file), stat only, up to the filesystem root (S53). */
function nearestGitAncestor(dir) {
  let p = dirname(dir);
  for (;;) {
    if (existsSync(join(p, '.git'))) return p;
    const up = dirname(p);
    if (up === p) return null;
    p = up;
  }
}

/**
 * R8 / L5: a folder without its own .git inside a git work tree it is not the top of → { repoRoot, partOf }, else null.
 * Git on: canonicalProjectRoot (rev-parse). Git missing: the nearest ancestor holding .git, a stat-only walk (S53).
 * `gitOn` picks the method, not whether: canonicalProjectRoot answers a plain realpath while git is missing.
 * `partOf` is the name of the registered project at repoRoot, else null.
 */
export function nestedRepoOf(path, { gitOn = gitAvailable() } = {}) {
  if (!path || !isDir(path) || detectVcs(path) !== 'none') return null;
  const me = real(path);
  let root;
  if (gitOn && gitAvailable()) {
    root = canonicalProjectRoot(path);
    if (samePath(root, me)) return null;
  } else {
    root = nearestGitAncestor(me);
    if (!root) return null;
  }
  const row = readRows().find((e) => samePath(real(e.path), root));
  return { repoRoot: root, partOf: row ? row.name : null };
}

/** The STORED registry row whose path is realpath-equal to `dir` (samePath, S7), or null. */
export function getProjectByPath(dir) {
  if (!dir || typeof dir !== 'string') return null;
  const want = real(resolve(dir));
  const e = readRows().find((r) => samePath(real(r.path), want));
  return e ? { key: e.key, name: e.name, path: e.path, vcs: normalizeVcs(e.vcs) } : null;
}

/**
 * Add a project. Validates and persists to the projects table. Returns the
 * updated annotated list. Keyed by projectKey(path) (store.mjs), so every worktree
 * of a repo maps to one row. Name uniqueness is case-insensitive (checked here AND
 * backed by the NOCASE unique index).
 * @param {{name:string, path:string}} input
 * @throws {Error} on empty name/path, a path that exists but is not a directory,
 *   a duplicate name (case-insensitive), or a duplicate path/key.
 */
export async function addProject(input) {
  await gitState();
  insertProject(input);
  return listProjects();
}

/**
 * Add several projects in one call (the multi-folder "Add projects" review).
 * Each item is validated and inserted in its OWN transaction (tx() cannot nest),
 * so one bad row never rolls back the others; a later row sees the rows committed
 * before it, so a duplicate name or repo WITHIN the batch is skipped too. Unlike
 * addProject, a bulk row's folder must exist: every row came from a folder picker,
 * so a missing folder vanished since it was picked. Never throws for a bad row.
 * @param {Array<{name:string, path:string}>} items
 * @returns {Promise<{results: Array<{index:number, status:'added'|'skipped', name:string,
 *   path:string, key?:string, vcs?:'git'|'none', reason?:string}>, projects: Array<{key,name,path,exists,vcs}>}>}
 */
export async function addProjects(items) {
  await gitState();
  const list = Array.isArray(items) ? items : [];
  const results = list.map((item, index) => {
    const name = item && typeof item.name === 'string' ? item.name.trim() : '';
    const rawPath = item && typeof item.path === 'string' ? item.path : '';
    const path = normalizeProjectPath(rawPath);
    try {
      if (path && !existsSync(path)) throw new Error('folder does not exist');
      const row = insertProject({ name, path: rawPath });
      return { index, status: 'added', key: row.key, name: row.name, path: row.path, vcs: row.vcs };
    } catch (err) {
      return { index, status: 'skipped', name, path: path || rawPath, reason: err && err.message ? err.message : String(err) };
    }
  });
  return { results, projects: await listProjects() };
}

/** How long removeProject waits for the metrics-worktree prune before answering. A test passes a
 *  small `pruneWaitMs`; WORCA_PRUNE_WAIT_MS (1 .. 600000) overrides the 10 s default. */
export function pruneWaitMsFrom(env = process.env) {
  const n = Number(env.WORCA_PRUNE_WAIT_MS);
  return Number.isFinite(n) && n > 0 && n <= 600_000 ? n : 10_000;
}

/**
 * Remove a project by name (case-insensitive). Absent name is a no-op. Also prunes any metrics
 * worktree that belonged to this project's repository, waiting up to ~10s for it: the wait is
 * best-effort — a worktree still held by a running flush is skipped and swept on the next start.
 * @param {string} name
 * @returns {Promise<Array<{key:string, name:string, path:string, exists:boolean}>>}
 */
export async function removeProject(name, { pruneWaitMs = pruneWaitMsFrom() } = {}) {
  const key = (typeof name === 'string' ? name : '').trim();
  let removedPath = null;
  if (key) {
    tx(() => {
      const row = prepare('SELECT key, path FROM projects WHERE name = ? COLLATE NOCASE').get(key);
      removedPath = row ? row.path : null;
      prepare('DELETE FROM projects WHERE name = ? COLLATE NOCASE').run(key);
      // Its team-policy discovery cache goes with it: the home stops being followed here, so its Team set greys with
      // Forget (MCP registry spec §11.2), and a later add of the same path discovers afresh.
      // …unless a workspace still has this repo as a member (its policy and metrics homes are members too): Worca still
      // reaches it there (discoverAllPolicies; findLocalRepoBySlug finds the home a workspace's policy project follows
      // among its members), so the home it carries is still followed and its Team set must not grey.
      const inWorkspace = !!row && prepare('SELECT project_key AS path FROM workspace_projects').all()
        .some((w) => { try { return projectKey(w.path) === row.key; } catch { return false; } });
      const pc = row && !inWorkspace ? prepare('SELECT extra FROM project_config WHERE project_key = ?').get(row.key) : null;
      let extra = null;
      try { extra = pc ? JSON.parse(pc.extra) : null; } catch { /* not JSON: left as it is */ }
      if (extra && typeof extra === 'object' && Object.hasOwn(extra, 'teamPolicy')) {
        // The total-cap acknowledgements stay (policy/state.mjs): a project added again is not asked twice in one window.
        const acks = extra.teamPolicy?.acks;
        if (acks && typeof acks === 'object') extra.teamPolicy = { acks }; else delete extra.teamPolicy;
        prepare('UPDATE project_config SET extra = ? WHERE project_key = ?').run(JSON.stringify(extra), row.key);
      }
    });
  }
  if (removedPath) {
    // Dynamic import: metrics/sync.mjs imports this module (worcaHome, listProjects).
    try {
      const { pruneMetricsWorktreesFor } = await import('./metrics/sync.mjs');
      // Bounded: each removal waits for the slug lock, and a running flush can hold it for minutes.
      // The DELETE request must not hang on that; the prune finishes in the background.
      const prune = pruneMetricsWorktreesFor(removedPath).catch(() => []);
      await Promise.race([prune, new Promise((r) => setTimeout(r, pruneWaitMs).unref?.())]);
    } catch { /* best-effort: a leftover worktree is harmless and re-pruned by git */ }
  }
  return listProjects();
}
