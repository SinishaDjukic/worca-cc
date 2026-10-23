// src/core/projects.mjs
// Named project registry: a small persistent list of { name, path } entries the
// web UI uses to populate its project dropdown.
//
// node:sqlite migration: now persisted in the `projects` table; path helpers vestigial.
//
// Reads never throw: a fresh/empty DB yields an empty list. Writes validate then
// persist inside a single db.mjs tx(). Each row is keyed by projectKey(path)
// (store.mjs), so every worktree of a repo maps to one row.

import { existsSync, statSync, realpathSync, lstatSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { getWorcaRoot, defaultRoot, worcaProjectsFolder } from './settings.mjs';
import { isWithin } from './fs-scope.mjs';
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

/** Folder → Git, once (Use git, docs/storage.md): the only write of projects.vcs after insert. True when the row moved. */
export function markProjectGit(key) {
  getDb();
  let changes = 0;
  tx(() => { changes = Number(prepare("UPDATE projects SET vcs = 'git' WHERE key = ? AND vcs = 'none'").run(key).changes); });
  return changes === 1;
}

/**
 * Validate one {name, path, vcs?} and insert it in its own tx(). Synchronous (node:sqlite): callers
 * await gitState() first. `vcs` omitted → detectVcs(path) when the path exists, else 'git' (a path
 * registered before it exists is created and git-inited by its first run, only outside any repository).
 * @returns {{key:string, name:string, path:string, vcs:'git'|'none'}} the stored row
 * @throws {Error} on empty name/path, a path that exists but is not a directory, a vcs other than
 *   'git' / 'none', a folder inside a git work tree it is not the top of, or a missing path whose nearest
 *   existing ancestor is (code NESTED_IN_REPO),
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
  // Every kind (R8): a folder inside a git work tree it is not the top of is never a project. A path that does not
  // exist yet counts by its nearest existing ancestor: its first run would otherwise `git init` inside the repository
  // (#693). Before the same-key check: a nested folder's projectKey is its parent's, so "already registered" would hide why.
  const nested = existsSync(path) ? nestedRepoOf(path, { gitOn }) : enclosingRepoOf(path, { gitOn });
  if (nested) {
    const err = new Error(nested.partOf ? `Part of ${nested.partOf}` : 'Inside a git repository');
    err.code = 'NESTED_IN_REPO'; err.repoRoot = nested.repoRoot; err.partOf = nested.partOf;
    throw err;
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

/**
 * R8 for a path that may not exist yet, with or without git (S53: the Add chip, registration and run start agree).
 * An existing `dir` → nestedRepoOf(dir). A missing `dir` → its nearest existing ancestor `a`: a repository top
 * (`a/.git`) ⇒ nested (a folder made directly under it would be inside it), else nestedRepoOf(a).
 * @returns {{repoRoot:string, partOf:string|null}|null}
 */
export function enclosingRepoOf(dir, { gitOn = gitAvailable() } = {}) {
  if (!dir || typeof dir !== 'string') return null;
  const p = resolve(dir);
  if (existsSync(p)) return isDir(p) ? nestedRepoOf(p, { gitOn }) : null;
  let a = dirname(p);
  while (!existsSync(a)) {
    const up = dirname(a);
    if (up === a) return null;
    a = up;
  }
  if (!isDir(a)) return null;
  if (detectVcs(a) === 'git') return { repoRoot: real(a), partOf: getProjectByPath(a)?.name ?? null };
  return nestedRepoOf(a, { gitOn });
}

/** The refusal for a run (or a project) in a folder inside a git repository it is not the top of (#693). */
export function nestedInRepoMessage(dir, { repoRoot, partOf = null } = {}) {
  const rule = 'Worca runs only on the top folder of a git repository.';
  return partOf
    ? `${dir} is inside the project "${partOf}" (${repoRoot}). ${rule} Run on "${partOf}" instead.`
    : `${dir} is inside the git repository at ${repoRoot}. ${rule} Add ${repoRoot} as a project and run there.`;
}

/**
 * A repository an older worca (≤ 1.10.0) `git init`ed inside the user's repository (#693): `dir/.git` is a directory,
 * its local config carries worca's identity `orchestrator@local` (only that `git init` ever wrote it there — every
 * other worca commit passes it with `-c`), and an ancestor holds a `.git`. Stat and one small read: no git, no write.
 * @returns {{repoRoot:string, partOf:string|null}|null} the enclosing repository, or null
 */
export function worcaNestedRepoOf(dir) {
  if (!dir || typeof dir !== 'string' || !isDir(dir)) return null;
  const gitDir = join(dir, '.git');
  try { if (!lstatSync(gitDir).isDirectory()) return null; } catch { return null; }
  let config;
  try { config = readFileSync(join(gitDir, 'config'), 'utf8'); } catch { return null; }
  if (!/^\s*email\s*=\s*orchestrator@local\s*$/m.test(config)) return null;
  const repoRoot = nearestGitAncestor(real(dir));
  if (!repoRoot) return null;
  return { repoRoot: real(repoRoot), partOf: getProjectByPath(repoRoot)?.name ?? null };
}

/** How to fix a worca-made nested repository. Worca never changes it by itself (#693). */
export function worcaNestedRepoHint(dir, { repoRoot }) {
  return `${dir} has its own git repository inside your repository at ${repoRoot}. An older Worca created it. ` +
    'Runs here use that inner repository, not yours, so your branches are not in it. ' +
    `To fix it: check that ${join(dir, '.git')} holds nothing you need, delete it, remove this project from Worca, then add ${repoRoot}. ` +
    'Worca does not change it for you.';
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

/** The STORED registry row named `name` — case-insensitive, the match removeProject deletes by — or null. */
export function getProjectByName(name) {
  const want = (typeof name === 'string' ? name : '').trim();
  if (!want) return null;
  getDb(); // ensure the singleton is open + migrated before preparing
  const e = prepare('SELECT key, name, path, vcs FROM projects WHERE name = ? COLLATE NOCASE').get(want);
  return e ? { key: e.key, name: e.name, path: e.path, vcs: normalizeVcs(e.vcs) } : null;
}

/** realpathSync.native: the real path with the letter case on disk (macOS, Windows), or null when it cannot be read. */
const realOnDisk = (p) => { try { return realpathSync.native(p); } catch { return null; } };

/**
 * True when worca owns this project's folder, so Remove takes the folder with it: a Folder project (stored vcs 'none',
 * and no .git in the folder now) whose folder is a real directory — lstat, never a symlink or junction — sitting
 * DIRECTLY in worca's own projects folder <worcaHome>/projects (worcaProjectsFolder(); a custom projects root, from
 * Settings or WORCA_PROJECTS_ROOT, never counts). Real paths with the case on disk on both sides. Never the projects
 * folder or the Worca home themselves, nor a folder holding either. Never throws: what it cannot read is not worca's.
 * @param {{path?:string, vcs?:string}|null|undefined} project
 * @returns {boolean}
 */
export function ownsProjectFolder(project) {
  try {
    if (!project || project.vcs !== 'none' || typeof project.path !== 'string' || !project.path.trim()) return false;
    const dir = resolve(project.path);
    if (!lstatSync(dir).isDirectory()) return false;     // lstat: a symlink or junction is not a directory here
    if (detectVcs(dir) !== 'none') return false;         // a repository made in it since: the user's history
    const folder = worcaProjectsFolder();
    const me = realOnDisk(dir);
    const projectsDir = realOnDisk(folder);
    const home = realOnDisk(dirname(folder));
    if (!me || !projectsDir || !home) return false;
    if (dirname(me) !== projectsDir) return false;       // a direct child only
    return !isWithin(projectsDir, me) && !isWithin(home, me);   // never the projects folder or the home, nor a folder holding one
  } catch {
    return false;
  }
}

/**
 * Unregister a project by name (case-insensitive; absent name is a no-op): its row and its team-policy cache, then
 * its metrics worktrees, waiting up to `pruneWaitMs`. Never touches the project's folder.
 * @returns {Promise<{removed:{key:string,name:string,path:string,vcs:'git'|'none'}|null, projects:object[]}>}
 */
async function unregisterProject(name, { pruneWaitMs }) {
  const key = (typeof name === 'string' ? name : '').trim();
  let removed = null;
  if (key) {
    tx(() => {
      const row = prepare('SELECT key, name, path, vcs FROM projects WHERE name = ? COLLATE NOCASE').get(key);
      removed = row ? { key: row.key, name: row.name, path: row.path, vcs: normalizeVcs(row.vcs) } : null;
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
  if (removed) {
    // Dynamic import: metrics/sync.mjs imports this module (worcaHome, listProjects).
    try {
      const { pruneMetricsWorktreesFor } = await import('./metrics/sync.mjs');
      // Bounded: each removal waits for the slug lock, and a running flush can hold it for minutes.
      // The DELETE request must not hang on that; the prune finishes in the background.
      const prune = pruneMetricsWorktreesFor(removed.path).catch(() => []);
      await Promise.race([prune, new Promise((r) => setTimeout(r, pruneWaitMs).unref?.())]);
    } catch { /* best-effort: a leftover worktree is harmless and re-pruned by git */ }
  }
  return { removed, projects: await listProjects() };
}

/**
 * Remove a project by name (case-insensitive). Absent name is a no-op. Also prunes any metrics
 * worktree that belonged to this project's repository, waiting up to ~10s for it: the wait is
 * best-effort — a worktree still held by a running flush is skipped and swept on the next start.
 * The folder stays on disk: removeProjectAndFolder deletes one worca owns.
 * @param {string} name
 * @returns {Promise<Array<{key:string, name:string, path:string, exists:boolean}>>}
 */
export async function removeProject(name, { pruneWaitMs = pruneWaitMsFrom() } = {}) {
  return (await unregisterProject(name, { pruneWaitMs })).projects;
}

// Unlinks a symlink or junction inside the folder, never follows it.
const removeTree = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 3 });

/**
 * Remove a project (as removeProject) and, when worca owns its folder — ownsProjectFolder, judged again here on the
 * row this call deleted — that folder and every file in it. The row goes first: a failed delete leaves an unregistered
 * folder on disk (reported in `folder.error`, never swallowed), never a registered project without its folder.
 * A folder worca does not own is left as it is (`folder` null).
 * @param {string} name
 * @param {{pruneWaitMs?:number, removeFolder?:(dir:string)=>Promise<unknown>}} [opts] removeFolder: a test seam
 * @returns {Promise<{projects:object[], removed:{key:string,name:string,path:string,vcs:'git'|'none'}|null,
 *   folder:null|{path:string, deleted:true}|{path:string, deleted:false, error:string}}>}
 */
export async function removeProjectAndFolder(name, { pruneWaitMs = pruneWaitMsFrom(), removeFolder = removeTree } = {}) {
  const { removed, projects } = await unregisterProject(name, { pruneWaitMs });
  if (!removed || !ownsProjectFolder(removed)) return { projects, removed, folder: null };
  try {
    await removeFolder(resolve(removed.path));
    return { projects, removed, folder: { path: removed.path, deleted: true } };
  } catch (err) {
    return { projects, removed, folder: { path: removed.path, deleted: false, error: err && err.message ? err.message : String(err) } };
  }
}
