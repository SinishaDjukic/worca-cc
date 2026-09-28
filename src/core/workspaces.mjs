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

import { realpathSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { worcaHome, normalizeProjectPath } from './projects.mjs';
import { canonicalProjectRoot, projectKey, workspaceStorePath } from './store.mjs';
import { slugify, retainedWorkFor } from './artifacts.mjs';
import { getDb, prepare, tx } from './db.mjs';
import { WORKSPACE_MAX_PROJECTS, scanDescriptionBudget } from '../shared/workspace-size.mjs';
import { KINDS, checkOverrides, checkSynthesis } from '../shared/workspace-map/schema.mjs';
import { LIMITS } from '../shared/workspace-map/limits.mjs';
import {
  emptyOverrides, effectiveEdges, setEdgeState, addManualEdge, removeManualEdge, rekeyOverrides,
} from '../shared/workspace-map/overrides.mjs';
import { renderWorkspaceDescription } from '../shared/workspace-map/render.mjs';
import { mapSummary } from '../shared/workspace-map/summary.mjs';

/** Object-shaped error carrying a machine code (mirrors pipeline-delete.mjs). */
function err(message, code) { return Object.assign(new Error(message), { code }); }

/**
 * Validate a metricsProject candidate against a workspace's member paths.
 * null/'' means "no home" and returns null. Anything else must resolve (by exact
 * match or by canonical git root) to one of `paths`; the member's OWN stored path
 * is returned (workspace_projects convention), not the normalized candidate.
 * @param {string[]} paths
 * @param {string|null|undefined} candidate
 * @returns {string|null}
 * @throws err(code: BAD_REQUEST)
 */
function memberPathFor(paths, candidate, field = 'metricsProject') {
  if (candidate == null || candidate === '') return null;
  if (typeof candidate !== 'string') throw err(`${field} must be a project path or null`, 'BAD_REQUEST');
  const want = normalizeProjectPath(candidate);
  // normalizeProjectPath('   ') -> null; canonicalProjectRoot(null) would throw ERR_INVALID_ARG_TYPE -> 500.
  if (!want) throw err(`${field} must be a project path or null`, 'BAD_REQUEST');
  const hit = paths.find((p) => p === want || canonicalProjectRoot(p) === canonicalProjectRoot(want));
  if (!hit) throw err(`${field} must be one of the workspace projects`, 'BAD_REQUEST');
  return hit;
}

/**
 * The workspace-key shape: "wks-<slug>-<sha1[:8]>". The server imports this as
 * its single source of truth (M2 route validation), so core + route agree on one
 * invariant. Validating an id against it also forecloses any path-traversal: a
 * key matching this regex can never contain "/" or "..", so workspaceStorePath(id)
 * cannot escape the store namespace even before a registry-membership check.
 */
export const WORKSPACE_KEY_RE = /^wks-[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/;

/** Every workspaces column a read needs (readEntry + listWorkspaces share it). */
const WORKSPACE_COLUMNS =
  'id, name, description, metrics_project, policy_project, map_json, map_overrides_json, description_origin, created_at, updated_at';

/** description_origin values; anything else (NULL = before v40) reads as null. */
const DESCRIPTION_ORIGINS = new Set(['generated', 'edited']);

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
 * Why a READ-ONLY Workspace scan cannot run over each member: a scan never `git init`s or commits
 * a member (run-harness `_ensureGitCheckpointFor` refuses), so each member must BE the top folder of
 * its own git repository — the harness's test: `git rev-parse --show-toplevel` is the folder itself,
 * both realpath'd (a folder inside a monorepo is not; neither is a bare repository) — and have a
 * commit. Both scan routes check it before a run starts; plain create keeps its own contract
 * (isGitRepo). Never throws.
 * @param {string[]} projectPaths
 * @returns {string[]} one `<path> <why>` per member a scan cannot run over ([] = every member can)
 */
export function scanMemberProblems(projectPaths) {
  const git = (cwd, args) => {
    try { return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; }
  };
  const real = (p) => { try { return realpathSync.native(p); } catch { return resolve(p); } };
  const out = [];
  for (const p of Array.isArray(projectPaths) ? projectPaths : []) {
    if (!isDir(p)) { out.push(`${p} does not exist`); continue; }
    const top = git(p, ['rev-parse', '--show-toplevel']);
    if (!top || real(top) !== real(p)) out.push(`${p} is not its own git repository`);
    else if (git(p, ['rev-parse', '--verify', '-q', 'HEAD']) === null) out.push(`${p} has no commit`);
  }
  return out;
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
    metricsProject: entry.metricsProject ?? null,
    policyProject: entry.policyProject ?? null,
    // The list carries the map's counts only; the map itself is GET /api/workspaces/:id/map.
    mapSummary: mapSummary(entry.mapDoc ? entry.mapDoc.map : null, entry.overrides || emptyOverrides()),
    descriptionOrigin: entry.descriptionOrigin ?? null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/**
 * True for a workspace-map document (spec §5.7) this module can store and render: an object
 * with members[] and edges[]. Everything else is "no map".
 * @param {unknown} map
 * @returns {boolean}
 */
export function isWorkspaceMap(map) {
  return !!map && typeof map === 'object' && !Array.isArray(map)
    && Array.isArray(map.members) && Array.isArray(map.edges);
}

/** JSON.parse that answers null for NULL, '' and garbage (a hand-edited DB never breaks a read). */
function parseJsonColumn(text) {
  if (typeof text !== 'string' || !text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** map_json -> { map, synthesis } | null. */
function parseMapDoc(text) {
  const doc = parseJsonColumn(text);
  if (!doc || typeof doc !== 'object' || !isWorkspaceMap(doc.map)) return null;
  const synthesis = doc.synthesis && typeof doc.synthesis === 'object' && !Array.isArray(doc.synthesis) ? doc.synthesis : null;
  return { map: doc.map, synthesis };
}

/** map_overrides_json -> a valid overrides doc (invalid items dropped; NULL / garbage -> empty). */
function parseOverrides(text) {
  const doc = parseJsonColumn(text);
  return doc ? checkOverrides(doc).value : emptyOverrides();
}

/**
 * The description's last line when the scan merged a cross-project graph (P7): finalize
 * rewrites map.graph.file to the ABSOLUTE path of the copy in the workspace store. A relative
 * or missing file has no line. The command's path is quoted: a home directory may hold spaces
 * (`C:\Users\Jane Doe\…`), and an agent copies the command as written.
 * @param {object|null} map
 * @returns {string|null}
 */
export function graphLineFor(map) {
  const file = map && map.graph && typeof map.graph.file === 'string' ? map.graph.file : '';
  if (!file || !isAbsolute(file)) return null;
  return `Cross-project graph: ${file} — graphify query "<question>" --graph "${file}"`;
}

/** Render a stored entry's description from a map doc + overrides (pure; safe inside tx()). */
function renderFor(entry, mapDoc, overrides) {
  return renderWorkspaceDescription({
    name: entry.name,
    map: mapDoc.map,
    synthesis: mapDoc.synthesis,
    overrides,
    budget: scanDescriptionBudget(entry.projectPaths.length),
    graphLine: graphLineFor(mapDoc.map),
  });
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
    metricsProject: r.metrics_project ?? null,
    policyProject: r.policy_project ?? null,
    mapDoc: parseMapDoc(r.map_json),
    overrides: parseOverrides(r.map_overrides_json),
    descriptionOrigin: DESCRIPTION_ORIGINS.has(r.description_origin) ? r.description_origin : null,
    createdAt: typeof r.created_at === 'string' ? r.created_at : '',
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : '',
  };
}

/** Read one workspace entry by id (persisted shape, pre-annotate). null when absent. */
function readEntry(id) {
  getDb();
  const r = prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE id = ?`).get(id);
  return r ? rowToEntry(r) : null;
}

/**
 * List saved workspaces, each annotated with derived projectKeys/exists.
 * @returns {Promise<Array<{id,name,description,projectPaths,projectKeys,exists:boolean[],createdAt,updatedAt}>>}
 */
export async function listWorkspaces() {
  getDb();
  const rows = prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces ORDER BY created_at, name`).all();
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

/** Name + member validation shared by createWorkspace and checkNewWorkspace. */
function prepareCreate(input) {
  const name = (input && typeof input.name === 'string' ? input.name : '').trim();
  if (!name) throw err('workspace name is required', 'BAD_REQUEST');
  const members = normalizeMembers(input && input.projectPaths);
  if (members.length < 2) {
    throw err('a workspace needs at least 2 distinct member projects', 'BAD_REQUEST');
  }
  // D22: 2–40 members, counted after the canonical-root de-dupe, before any per-member git check.
  if (members.length > WORKSPACE_MAX_PROJECTS) {
    throw err(`a workspace holds at most ${WORKSPACE_MAX_PROJECTS} member projects (${members.length} given)`, 'BAD_REQUEST');
  }
  for (const p of members) {
    if (!isDir(p)) throw err(`member path does not exist or is not a directory: ${p}`, 'BAD_REQUEST');
    if (!isGitRepo(p)) throw err(`member path is not a git repository: ${p}`, 'BAD_REQUEST');
  }
  return { name, members };
}

/** Case-insensitive name clash + D1 duplicate-SET guard. Call inside tx() when writing. */
function assertNoDuplicate(name, members) {
  if (prepare('SELECT 1 FROM workspaces WHERE name = ? COLLATE NOCASE').get(name)) {
    throw err(`a workspace named "${name}" already exists`, 'DUPLICATE_NAME');
  }
  const hash = rootsHash(members);
  for (const row of prepare('SELECT id FROM workspaces').all()) {
    if (rootsHash(memberPaths(row.id)) === hash) {
      throw err('a workspace over this exact project set already exists', 'DUPLICATE_SET');
    }
  }
}

/**
 * Validate a NEW workspace exactly as createWorkspace will, without writing — the Workspace scan
 * launch (POST /api/workspaces/scan) refuses up front what the run's final save would refuse.
 * @param {{name:string, projectPaths:string[]}} input
 * @returns {{id:string, name:string, projectPaths:string[]}}  id === the key createWorkspace mints
 * @throws err(code: BAD_REQUEST | DUPLICATE_NAME | DUPLICATE_SET)
 */
export function checkNewWorkspace(input = {}) {
  const { name, members } = prepareCreate(input);
  getDb();
  assertNoDuplicate(name, members);
  return { id: workspaceKey({ name, projectPaths: members }), name, projectPaths: members };
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
  const { name, members } = prepareCreate(input);
  const description = typeof input.description === 'string' ? input.description : '';

  const metricsProject = memberPathFor(members, input.metricsProject ?? null);
  const policyProject = memberPathFor(members, input.policyProject ?? null, 'policyProject');
  const id = workspaceKey({ name, projectPaths: members });
  const now = new Date().toISOString();

  getDb();
  tx(() => {
    assertNoDuplicate(name, members);
    prepare(
      'INSERT INTO workspaces (id, name, description, metrics_project, policy_project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, name, description, metricsProject, policyProject, now, now);
    const insMember = prepare(
      'INSERT INTO workspace_projects (workspace_id, project_key, ordinal) VALUES (?, ?, ?)'
    );
    // projectPaths persisted in input order (ordinal = index); annotate() re-sorts by key.
    members.forEach((p, i) => insMember.run(id, p, i));
  });

  // Return the annotated entry (derived fields recomputed from the persisted paths).
  return annotate({
    id, name, description, projectPaths: members, metricsProject, policyProject, createdAt: now, updatedAt: now,
  });
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
  let descriptionOrigin = null;   // set under the write lock below, from the row as it is then
  let fresh = entry;
  if (patch && typeof patch.name === 'string') {
    const next = patch.name.trim();
    if (!next) throw err('workspace name is required', 'BAD_REQUEST');
    name = next;
  }
  if (patch && typeof patch.description === 'string') {
    description = patch.description; // cap-on-freeze, not cap-on-store: persisted whole
  }
  const metricsProject = Object.prototype.hasOwnProperty.call(patch || {}, 'metricsProject')
    ? memberPathFor(entry.projectPaths, patch.metricsProject)
    : entry.metricsProject ?? null;
  const policyProject = Object.prototype.hasOwnProperty.call(patch || {}, 'policyProject')
    ? memberPathFor(entry.projectPaths, patch.policyProject, 'policyProject')
    : entry.policyProject ?? null;
  const now = new Date().toISOString();

  tx(() => {
    // Re-check NOCASE name clash against OTHER rows (exclude self).
    const clash = prepare(
      'SELECT 1 FROM workspaces WHERE name = ? COLLATE NOCASE AND id <> ?'
    ).get(name, id);
    if (clash) throw err(`a workspace named "${name}" already exists`, 'DUPLICATE_NAME');
    // Re-read under the write lock: a scan's finalize (possibly in another process — a scan
    // resumed from the CLI) or an override re-render may have landed since the read above. A
    // patch without a description keeps THAT text and its origin. A CHANGED text is a hand edit
    // (D8): overrides stop re-rendering it until "Regenerate description"; saving the editor
    // unchanged keeps the origin.
    fresh = readEntry(id);
    if (!fresh) throw err(`workspace not found: ${id}`, 'NOT_FOUND');
    if (patch && typeof patch.description === 'string') {
      descriptionOrigin = patch.description !== fresh.description ? 'edited' : (fresh.descriptionOrigin ?? null);
    } else {
      description = fresh.description;
      descriptionOrigin = fresh.descriptionOrigin ?? null;
    }
    if (name !== fresh.name && descriptionOrigin === 'generated' && fresh.mapDoc) {
      // A rename re-renders a generated description: its first line names the workspace.
      description = renderFor({ ...fresh, name }, fresh.mapDoc, fresh.overrides);
    }
    prepare(
      'UPDATE workspaces SET name = ?, description = ?, description_origin = ?, metrics_project = ?, policy_project = ?, updated_at = ? WHERE id = ?'
    ).run(name, description, descriptionOrigin, metricsProject, policyProject, now, id);
  });

  return annotate({ ...fresh, name, description, descriptionOrigin, metricsProject, policyProject, updatedAt: now });
}

/**
 * The stored map of a workspace. null when the workspace does not exist.
 * @param {string} id
 * @returns {Promise<{map:object|null, synthesis:object|null, overrides:object, descriptionOrigin:('generated'|'edited'|null)}|null>}
 */
export async function readWorkspaceMap(id) {
  if (!id || typeof id !== 'string') return null;
  const entry = readEntry(id);
  if (!entry) return null;
  return {
    map: entry.mapDoc ? entry.mapDoc.map : null,
    synthesis: entry.mapDoc ? entry.mapDoc.synthesis : null,
    overrides: entry.overrides,
    descriptionOrigin: entry.descriptionOrigin,
  };
}

/**
 * Save a finished scan (finalize, D7): the map + synthesis replace the stored ones, the
 * description is replaced and marked 'generated'. Confirm / reject / manual edges survive every
 * re-scan: map_overrides_json changes only to MOVE an override whose edge an agent reworded onto
 * the new edge (rekeyOverrides: a unique match both ways; never a drop). With a map the
 * description is RE-RENDERED here, inside the write transaction, from the map + the overrides
 * stored at that moment (an override saved while the scan ran is never lost); `description` is used
 * as-is only without a map (a scan whose join wrote nothing). The synthesis is stored
 * CHECKED: P1's checkSynthesis over the workspace's project keys drops every invalid item and
 * redacts every string it keeps (D21 — the synthesizer is an LLM that may quote a credential it
 * read in a checkout), so every writer, finalize or a direct caller, stores the same safe shape.
 * @param {string} id
 * @param {{description?:string, map?:object|null, synthesis?:object|null}} result
 * @returns {Promise<object>} the annotated workspace
 * @throws err(code: NOT_FOUND)
 */
export async function saveWorkspaceScanResult(id, { description = '', map = null, synthesis = null } = {}) {
  getDb();
  // The member set is immutable (D1): its keys are computed before the write lock is taken
  // (projectKey may spawn git). An unknown id has none; readEntry below answers NOT_FOUND.
  const memberKeys = memberPaths(id).map((p) => projectKey(p));
  const checked = synthesis === null ? null : checkSynthesis(synthesis, { memberKeys }).value;
  const mapDoc = isWorkspaceMap(map) ? { map, synthesis: checked } : null;
  const now = new Date().toISOString();
  const entry = tx(() => {
    const cur = readEntry(id);
    if (!cur) throw err(`workspace not found: ${id}`, 'NOT_FOUND');
    // M14: moved under this lock and before the render, so the description applies the moved override.
    const overrides = mapDoc ? rekeyOverrides(cur.overrides, mapDoc.map) : cur.overrides;
    const text = mapDoc ? renderFor(cur, mapDoc, overrides) : (typeof description === 'string' ? description : '');
    prepare('UPDATE workspaces SET description = ?, map_json = ?, description_origin = ?, updated_at = ? WHERE id = ?')
      .run(text, mapDoc ? JSON.stringify(mapDoc) : null, 'generated', now, id);
    if (overrides !== cur.overrides) prepare('UPDATE workspaces SET map_overrides_json = ? WHERE id = ?').run(JSON.stringify(overrides), id);
    return { ...cur, overrides, description: text, mapDoc, descriptionOrigin: 'generated', updatedAt: now };
  });
  return annotate(entry);
}

/**
 * "Regenerate description": re-render from the stored map + overrides, discarding a hand
 * edit; the origin becomes 'generated' again.
 * @param {string} id
 * @returns {Promise<object>} the annotated workspace
 * @throws err(code: NOT_FOUND | BAD_REQUEST — no map yet)
 */
export async function regenerateWorkspaceDescription(id) {
  getDb();
  const now = new Date().toISOString();
  const entry = tx(() => {
    const cur = readEntry(id);
    if (!cur) throw err(`workspace not found: ${id}`, 'NOT_FOUND');
    if (!cur.mapDoc) throw err('this workspace has no map yet: scan it first', 'BAD_REQUEST');
    const description = renderFor(cur, cur.mapDoc, cur.overrides);
    prepare('UPDATE workspaces SET description = ?, description_origin = ?, updated_at = ? WHERE id = ?')
      .run(description, 'generated', now, id);
    return { ...cur, description, descriptionOrigin: 'generated', updatedAt: now };
  });
  return annotate(entry);
}

/** Edge ids (src/shared/workspace-map/ids.mjs): x_ = an edge the scan found, m_ = a manual edge. */
export const AUTO_EDGE_ID_RE = /^x_[0-9a-f]{12}$/;
export const MANUAL_EDGE_ID_RE = /^m_[0-9a-f]{12}$/;
/** A manual edge's display is one line of the description. */
export const MANUAL_DISPLAY_MAX = 200;

/**
 * Change a workspace's edge overrides (confirm / reject / manual) in ONE write transaction.
 * `next` is the new overrides doc, or a mutator `(current, { map, memberKeys }) => doc` that
 * runs INSIDE the transaction — the read-modify-write callers must use, so two quick changes
 * never lose one another. A mutator may throw err(…) to refuse (nothing is written). A mutator
 * that returns `current` itself writes nothing. The doc is validated (checkOverrides). The
 * description is re-rendered only while it is 'generated' and a map exists (D8): a hand-edited
 * description, or one no map produced, is never overwritten.
 * @param {string} id
 * @param {object|Function} next
 * @returns {Promise<{workspace:object, overrides:object, rerendered:boolean}>}
 * @throws err(code: NOT_FOUND | BAD_REQUEST)
 */
export async function updateWorkspaceOverrides(id, next) {
  getDb();
  // The member set is immutable (D1), so its keys are computed before the write lock is taken
  // (projectKey may spawn git) — from the member rows only, not a second parse of map_json.
  // An unknown id has no member rows; readEntry inside the transaction answers NOT_FOUND.
  const memberKeys = memberPaths(id).map((p) => projectKey(p));
  const now = new Date().toISOString();
  const { entry, rerendered } = tx(() => {
    const cur = readEntry(id);
    if (!cur) throw err(`workspace not found: ${id}`, 'NOT_FOUND');
    const produced = typeof next === 'function'
      ? next(cur.overrides, { map: cur.mapDoc ? cur.mapDoc.map : null, memberKeys })
      : next;
    if (produced === cur.overrides) return { entry: cur, rerendered: false };
    const checked = checkOverrides(produced);
    if (!checked.ok) throw err(`invalid overrides: ${checked.errors.slice(0, 3).join('; ')}`, 'BAD_REQUEST');
    const overrides = checked.value;
    const rerender = cur.descriptionOrigin === 'generated' && !!cur.mapDoc;
    const description = rerender ? renderFor(cur, cur.mapDoc, overrides) : cur.description;
    prepare('UPDATE workspaces SET map_overrides_json = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(overrides), description, now, id);
    return { entry: { ...cur, overrides, description, updatedAt: now }, rerendered: rerender };
  });
  return { workspace: annotate(entry), overrides: entry.overrides, rerendered };
}

/**
 * Confirm, reject or clear (state null) one scanned edge. The edge must be on the stored map
 * or already carry an override (a confirmed edge a re-scan lost, a rejected one it dropped).
 * @param {string} id
 * @param {string} edgeId  x_<12 hex>
 * @param {'confirmed'|'rejected'|null} state
 * @returns {Promise<{workspace:object, overrides:object, rerendered:boolean, edge:object|null}>}
 *   edge = the effective edge after the change (null when a cleared edge is no longer on the map)
 * @throws err(code: BAD_REQUEST | NOT_FOUND)
 */
export async function setWorkspaceEdgeState(id, edgeId, state) {
  if (typeof edgeId === 'string' && MANUAL_EDGE_ID_RE.test(edgeId)) {
    throw err('a manual edge cannot be confirmed or rejected: delete it instead', 'BAD_REQUEST');
  }
  if (typeof edgeId !== 'string' || !AUTO_EDGE_ID_RE.test(edgeId)) throw err(`bad edge id: ${edgeId}`, 'BAD_REQUEST');
  if (state !== null && state !== 'confirmed' && state !== 'rejected') {
    throw err('state must be "confirmed", "rejected" or null', 'BAD_REQUEST');
  }
  let edge = null;
  const res = await updateWorkspaceOverrides(id, (current, { map }) => {
    const present = effectiveEdges(map, current).find((e) => e.id === edgeId) || null;
    const stored = Object.prototype.hasOwnProperty.call(current.edges, edgeId) ? current.edges[edgeId] : null;
    if (!present && !stored) throw err(`edge not found: ${edgeId}`, 'NOT_FOUND');
    const target = present
      || { id: edgeId, from: stored.from, to: stored.to, kind: stored.kind, display: stored.display };
    const out = setEdgeState(current, target, state, new Date().toISOString());
    edge = effectiveEdges(map, out).find((e) => e.id === edgeId) || null;
    return out;
  });
  return { ...res, edge };
}

/** One line of text: every whitespace run (newlines included) collapsed to a space, trimmed. */
function oneLine(v) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Add a manual edge (`from` uses `to`). from / to must be two different member project keys
 * of this workspace; kind one of KINDS; display 1..MANUAL_DISPLAY_MAX chars and detail
 * ≤ LIMITS.DETAIL_MAX chars, each collapsed to ONE line (the description is one line per
 * edge and is injected into every agent). Adding an identical edge (same from, to, kind,
 * display) again returns the existing one (`created: false`) — a double submit adds nothing.
 * A workspace with no stored map refuses (BAD_REQUEST, like Regenerate): the Map tab could
 * neither show nor delete the edge.
 * @param {string} id
 * @param {{from:string, to:string, kind:string, display:string, detail?:string}} input
 * @returns {Promise<{workspace:object, overrides:object, rerendered:boolean, edge:object, created:boolean}>}
 * @throws err(code: BAD_REQUEST | NOT_FOUND)
 */
export async function addWorkspaceManualEdge(id, input = {}) {
  const from = typeof input.from === 'string' ? input.from : '';
  const to = typeof input.to === 'string' ? input.to : '';
  if (!from || !to) throw err('from and to are required', 'BAD_REQUEST');
  if (from === to) throw err('from and to must be two different member projects', 'BAD_REQUEST');
  if (!KINDS.includes(input.kind)) throw err(`kind must be one of: ${KINDS.join(', ')}`, 'BAD_REQUEST');
  if (typeof input.display !== 'string') throw err('display is required', 'BAD_REQUEST');
  if (input.detail != null && typeof input.detail !== 'string') throw err('detail must be a string', 'BAD_REQUEST');
  const kind = input.kind;
  const display = oneLine(input.display);
  const detail = oneLine(input.detail);
  if (!display) throw err('display is required', 'BAD_REQUEST');
  if (display.length > MANUAL_DISPLAY_MAX) throw err(`display is at most ${MANUAL_DISPLAY_MAX} characters`, 'BAD_REQUEST');
  if (detail.length > LIMITS.DETAIL_MAX) throw err(`detail is at most ${LIMITS.DETAIL_MAX} characters`, 'BAD_REQUEST');
  let edge = null;
  let created = false;
  const res = await updateWorkspaceOverrides(id, (current, { map, memberKeys }) => {
    if (!map) throw err('this workspace has no map yet: scan it first', 'BAD_REQUEST');
    if (!memberKeys.includes(from) || !memberKeys.includes(to)) {
      throw err('from and to must be member project keys of this workspace', 'BAD_REQUEST');
    }
    const same = current.manual.find((m) => m.from === from && m.to === to && m.kind === kind && m.display === display);
    if (same) {
      edge = effectiveEdges(map, current).find((e) => e.id === same.id) || same;
      return current;
    }
    const out = addManualEdge(current, { from, to, kind, display, detail }, new Date().toISOString());
    // P1 answers bad input with { overrides, edge: null, error } instead of throwing; the checks
    // above are at least as strict today, but a refusal must stay a 400, never a TypeError (500).
    if (!out.edge) throw err(out.error || 'invalid manual edge', 'BAD_REQUEST');
    edge = effectiveEdges(map, out.overrides).find((e) => e.id === out.edge.id) || out.edge;
    created = true;
    return out.overrides;
  });
  return { ...res, edge, created };
}

/**
 * Delete a manual edge. A scanned edge (x_) is never deleted — reject it instead.
 * @param {string} id
 * @param {string} edgeId  m_<12 hex>
 * @returns {Promise<{workspace:object, overrides:object, rerendered:boolean}>}
 * @throws err(code: BAD_REQUEST | NOT_FOUND)
 */
export async function removeWorkspaceManualEdge(id, edgeId) {
  if (typeof edgeId === 'string' && AUTO_EDGE_ID_RE.test(edgeId)) {
    throw err('only manual edges can be deleted: reject a scanned edge instead', 'BAD_REQUEST');
  }
  if (typeof edgeId !== 'string' || !MANUAL_EDGE_ID_RE.test(edgeId)) throw err(`bad edge id: ${edgeId}`, 'BAD_REQUEST');
  return updateWorkspaceOverrides(id, (current) => {
    if (!current.manual.some((m) => m.id === edgeId)) throw err(`edge not found: ${edgeId}`, 'NOT_FOUND');
    return removeManualEdge(current, edgeId);
  });
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

  // Never orphan retained uncommitted work: deleting the store removes the
  // pipeline dir the discard flow needs for its recovery patch, wedging the run.
  const memberRows = prepare(
    'SELECT * FROM pipelines WHERE workspace_key = ? AND archived_at IS NULL',
  ).all(id);
  for (const memberRow of memberRows) {
    if (retainedWorkFor(memberRow)) {
      throw err(
        `workspace has retained uncommitted work (pipeline ${memberRow.id}); recover or discard it first — ` +
        'and copy any retained-work*.patch out of the workspace store before deleting, deletion removes it',
        'RETAINED_WORKTREE',
      );
    }
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
