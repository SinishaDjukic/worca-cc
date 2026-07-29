// src/core/workspaces.mjs
// Workspace registry: a small persistent list of named project sets (2+ onboarded
// git repos sharing one editable interconnection description). Persisted in SQLite
// (db.mjs) across two tables: workspaces (id, name, description, created/updated)
// and workspace_projects (the ordered member set). The member's absolute PATH is
// stored in the workspace_projects.project_key column (ordinal-ordered) — NOT a
// projectKey: a projectKey is a one-way sha1 hash, so the path could not be
// reconstructed from it. The real projectKey is recomputed on read via
// store.projectKey(path) in annotate().
//
// A workspace is a thin record plus a derived store namespace at
// store/workspaces/<workspaceKey>/. The key is derived ONCE at creation from the
// name slug + a sorted-canonical-roots hash, then frozen: rename never recomputes it
// (D1). projectKeys / exists[] are derived at read time and never persisted.
//
// Reads never throw: a missing row yields []/null. Writes run inside one tx() and
// keep their validation throws (err(message, code), mirrors pipeline-delete.mjs) so
// the server can map codes -> HTTP (BAD_REQUEST->400, DUPLICATE_*->409,
// NOT_FOUND->404). workspacesFile() is retained (vestigial) for import-compat.

import { statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { worcaHome, normalizeProjectPath } from './projects.mjs';
import { canonicalProjectRoot, projectKey, workspaceStorePath } from './store.mjs';
import { slugify } from './artifacts.mjs';
import { getDb, prepare, tx } from './db.mjs';

/** Object-shaped error carrying a machine code (mirrors pipeline-delete.mjs). */
function err(message, code) { return Object.assign(new Error(message), { code }); }

/**
 * The workspace-key shape: "wks-<slug>-<sha1[:8]>". The server imports this as
 * its single source of truth (M2 route validation), so core + route agree on one
 * invariant. Validating an id against it also forecloses any path-traversal: a
 * key matching this regex can never contain "/" or "..", so workspaceStorePath(id)
 * cannot escape the store namespace even before a registry-membership check.
 */
export const WORKSPACE_KEY_RE = /^wks-[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/;

/** Absolute path to the workspace registry file. Sibling of projects.json. */
export function workspacesFile() {
  return join(worcaHome(), 'workspaces.json');
}

/** True when the path exists and is a directory. */
function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/**
 * True when `p` is inside a git work tree (and a directory). Never throws.
 * Exported so the server's run-target loop can reject a member that exists but is
 * no longer a git repo (§2.6 step 3) using the SAME check createWorkspace applies.
 */
export function isGitRepo(p) {
  if (!isDir(p)) return false;
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'],
      { cwd: p, stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch { return false; }
}

/**
 * Roots-only dedupe hash (D1): sha1 of the sorted canonical roots, joined by "\n",
 * sliced to 8 hex. Name-independent and order-independent, so it identifies a
 * project SET regardless of the workspace's name or the input ordering.
 * @param {string[]} projectPaths
 * @returns {string} 8 hex chars
 */
export function rootsHash(projectPaths) {
  const roots = (Array.isArray(projectPaths) ? projectPaths : [])
    .map((p) => canonicalProjectRoot(p))
    .sort();
  return createHash('sha1').update(roots.join('\n')).digest('hex').slice(0, 8);
}

/**
 * Stable workspace key == id: "wks-" + slugify(name) + "-" + rootsHash(paths).
 * The wks- prefix guarantees no collision with any projectKey in the same store.
 * @param {{name:string, projectPaths:string[]}} ws
 * @returns {string}
 */
export function workspaceKey(ws) {
  const name = ws && typeof ws.name === 'string' ? ws.name : '';
  const paths = ws && Array.isArray(ws.projectPaths) ? ws.projectPaths : [];
  return `wks-${slugify(name)}-${rootsHash(paths)}`;
}

/**
 * Annotate a persisted entry with read-time derived fields:
 *   projectKeys (sorted ascending, index-aligned with the returned projectPaths)
 *   exists[]    (per-path on-disk presence)
 * Neither is ever persisted. projectPaths is re-ordered to align with the sorted
 * projectKeys so callers get the canonical member ordering used everywhere.
 */
function annotate(entry) {
  const pairs = entry.projectPaths.map((p) => ({ path: p, key: projectKey(p) }));
  pairs.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    projectPaths: pairs.map((x) => x.path),
    projectKeys: pairs.map((x) => x.key),
    exists: pairs.map((x) => isDir(x.path)),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/** Load the ordered member PATHS for a workspace (stored in the project_key column). */
function memberPaths(id) {
  return prepare(
    'SELECT project_key AS path FROM workspace_projects WHERE workspace_id = ? ORDER BY ordinal'
  ).all(id).map((r) => r.path);
}

/** Map a workspaces row (+ its member rows) to the persisted entry shape. */
function rowToEntry(r) {
  return {
    id: r.id,
    name: r.name,
    description: typeof r.description === 'string' ? r.description : '',
    projectPaths: memberPaths(r.id),
    createdAt: typeof r.created_at === 'string' ? r.created_at : '',
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : '',
  };
}

/** Read one workspace entry by id (persisted shape, pre-annotate). null when absent. */
function readEntry(id) {
  getDb();
  const r = prepare(
    'SELECT id, name, description, created_at, updated_at FROM workspaces WHERE id = ?'
  ).get(id);
  return r ? rowToEntry(r) : null;
}

/**
 * List saved workspaces, each annotated with derived projectKeys/exists.
 * @returns {Promise<Array<{id,name,description,projectPaths,projectKeys,exists:boolean[],createdAt,updatedAt}>>}
 */
export async function listWorkspaces() {
  getDb();
  const rows = prepare(
    'SELECT id, name, description, created_at, updated_at FROM workspaces ORDER BY created_at, name'
  ).all();
  return rows.map(rowToEntry).map(annotate);
}

/**
 * Number of saved workspaces (matches listWorkspaces().length). Cheap COUNT(*).
 * Uses the bare `prepare` already imported at workspaces.mjs:30.
 * @returns {number}
 */
export function countWorkspaces() {
  getDb();
  const row = prepare('SELECT COUNT(*) AS n FROM workspaces').get();
  return row ? Number(row.n) : 0;
}

/**
 * Read one workspace by id, annotated. Returns null when absent.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function readWorkspace(id) {
  if (!id || typeof id !== 'string') return null;
  const entry = readEntry(id);
  return entry ? annotate(entry) : null;
}

/**
 * Normalize + de-dupe member paths by canonical root. Returns the normalized
 * absolute paths in input order, with later paths that resolve to an
 * already-seen canonical root dropped.
 */
function normalizeMembers(projectPaths) {
  const out = [];
  const seenRoots = new Set();
  for (const raw of Array.isArray(projectPaths) ? projectPaths : []) {
    const norm = normalizeProjectPath(raw);
    if (!norm) continue;
    const root = canonicalProjectRoot(norm);
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    out.push(norm);
  }
  return out;
}

/**
 * Create a workspace. Validates name (non-empty + unique case-insensitive),
 * a 2+ distinct-git-repo member set (de-duped by canonical root), and a unique
 * project set (D1, by rootsHash). Persists the workspaces row + ordered
 * workspace_projects member rows (member PATH stored in the project_key column)
 * in ONE tx(). id is the frozen workspaceKey, computed once. Returns the
 * annotated entry.
 * @param {{name:string, projectPaths:string[], description?:string}} input
 * @throws err(code: BAD_REQUEST | DUPLICATE_NAME | DUPLICATE_SET)
 */
export async function createWorkspace(input = {}) {
  const name = (input && typeof input.name === 'string' ? input.name : '').trim();
  if (!name) throw err('workspace name is required', 'BAD_REQUEST');
  const description = typeof input.description === 'string' ? input.description : '';

  const members = normalizeMembers(input.projectPaths);
  if (members.length < 2) {
    throw err('a workspace needs at least 2 distinct member projects', 'BAD_REQUEST');
  }
  for (const p of members) {
    if (!isDir(p)) throw err(`member path does not exist or is not a directory: ${p}`, 'BAD_REQUEST');
    if (!isGitRepo(p)) throw err(`member path is not a git repository: ${p}`, 'BAD_REQUEST');
  }

  const id = workspaceKey({ name, projectPaths: members });
  const hash = rootsHash(members);
  const now = new Date().toISOString();

  getDb();
  tx(() => {
    // Case-insensitive duplicate-name guard (matches the legacy check + NOCASE index).
    if (prepare('SELECT 1 FROM workspaces WHERE name = ? COLLATE NOCASE').get(name)) {
      throw err(`a workspace named "${name}" already exists`, 'DUPLICATE_NAME');
    }
    // D1 duplicate-SET guard: compare rootsHash over existing members.
    for (const row of prepare('SELECT id FROM workspaces').all()) {
      if (rootsHash(memberPaths(row.id)) === hash) {
        throw err('a workspace over this exact project set already exists', 'DUPLICATE_SET');
      }
    }
    prepare(
      'INSERT INTO workspaces (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, description, now, now);
    const insMember = prepare(
      'INSERT INTO workspace_projects (workspace_id, project_key, ordinal) VALUES (?, ?, ?)'
    );
    // projectPaths persisted in input order (ordinal = index); annotate() re-sorts by key.
    members.forEach((p, i) => insMember.run(id, p, i));
  });

  // Return the annotated entry (derived fields recomputed from the persisted paths).
  return annotate({ id, name, description, projectPaths: members, createdAt: now, updatedAt: now });
}

/**
 * Update a workspace's name and/or description. NEVER touches projectPaths (the
 * project set is immutable) and NEVER recomputes the id (D1). Re-validates a new
 * name for case-insensitive uniqueness. Stamps updatedAt.
 * @param {string} id
 * @param {{name?:string, description?:string}} patch
 * @throws err(code: NOT_FOUND | BAD_REQUEST | DUPLICATE_NAME)
 */
export async function updateWorkspace(id, patch = {}) {
  getDb();
  const entry = readEntry(id);
  if (!entry) throw err(`workspace not found: ${id}`, 'NOT_FOUND');

  let { name, description } = entry;
  if (patch && typeof patch.name === 'string') {
    const next = patch.name.trim();
    if (!next) throw err('workspace name is required', 'BAD_REQUEST');
    name = next;
  }
  if (patch && typeof patch.description === 'string') {
    description = patch.description; // cap-on-freeze, not cap-on-store: persisted whole
  }
  const now = new Date().toISOString();

  tx(() => {
    // Re-check NOCASE name clash against OTHER rows (exclude self).
    const clash = prepare(
      'SELECT 1 FROM workspaces WHERE name = ? COLLATE NOCASE AND id <> ?'
    ).get(name, id);
    if (clash) throw err(`a workspace named "${name}" already exists`, 'DUPLICATE_NAME');
    prepare(
      'UPDATE workspaces SET name = ?, description = ?, updated_at = ? WHERE id = ?'
    ).run(name, description, now, id);
  });

  return annotate({ ...entry, name, description, updatedAt: now });
}

/** Thin setter: edit only the description. */
export async function updateWorkspaceDescription(id, text) {
  return updateWorkspace(id, { description: typeof text === 'string' ? text : '' });
}

/** Thin setter: rename only. Never recomputes the id (D1). */
export async function renameWorkspace(id, name) {
  return updateWorkspace(id, { name: typeof name === 'string' ? name : '' });
}

/**
 * Delete a workspace: remove the store/workspaces/<id>/ directory (best-effort) and
 * the registry row. The workspace_projects children are removed by the FK
 * ON DELETE CASCADE (foreign_keys=ON, set on open). The module has no runs map —
 * the live-run 409 guard lives in the server route.
 *
 * Self-guarded: id MUST match the workspace-key shape AND the row MUST exist before
 * anything is removed; a crafted id (e.g. "../..") never reaches the rm — it throws
 * NOT_FOUND. (store_meta cleanup is owned by Phase 3 — see the cross-phase note.)
 * @param {string} id
 * @returns {Promise<{ok:true, warnings:string[]}>}
 * @throws err(code: NOT_FOUND) for a malformed or unknown id
 */
export async function deleteWorkspace(id) {
  if (!id || typeof id !== 'string' || !WORKSPACE_KEY_RE.test(id)) {
    throw err(`workspace not found: ${id}`, 'NOT_FOUND');
  }
  getDb();
  // Membership-first: only act on an id actually present.
  if (!prepare('SELECT 1 FROM workspaces WHERE id = ?').get(id)) {
    throw err(`workspace not found: ${id}`, 'NOT_FOUND');
  }

  const warnings = [];
  try {
    await rm(workspaceStorePath(id), { recursive: true, force: true });
  } catch (e) {
    warnings.push(`store cleanup failed: ${e && e.message ? e.message : 'error'}`);
  }
  try {
    tx(() => {
      // Children cascade via the workspace_projects FK (ON DELETE CASCADE).
      prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    });
  } catch (e) {
    warnings.push(`registry write failed: ${e && e.message ? e.message : 'error'}`);
  }

  return { ok: true, warnings };
}
