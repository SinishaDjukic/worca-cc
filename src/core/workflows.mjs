// src/core/workflows.mjs
// node:sqlite migration: now persisted in the `workflows` table; path helpers vestigial.
// Global workflow-template store + the built-in GRAPH_DEFAULT_WORKFLOW + resolveGraph.
//
// Templates are TOPOLOGY + PER-NODE DEFAULTS (steps + feedbacks by node-instance
// id; each node may carry an optional `defaults` block — newpipeline-ux-design.md
// §4.4). Per-project model/effort/cycle data is the run-config in config.mjs and
// OVERRIDES those defaults; resolveGraph merges both.
//
// Reads never throw: a missing/corrupt store yields []/null.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getDb, prepare, tx } from './db.mjs';
import { worcaHome } from './projects.mjs';
import { resolveRunConfig, readConfig, EFFORTS } from './config.mjs';
import { slugify } from './artifacts.mjs';
import { DEFAULT_AGENTS_DIR } from './agent-registry.mjs'; // fileURLToPath-based (Windows-safe)
import { classifyLoops } from '../shared/graph/loops.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from './graph/builtin-workflows.mjs';
export { GRAPH_DEFAULT_WORKFLOW };
import { registryPortsFn } from './graph/registry-ports.mjs';

/**
 * Default feedback cycle count when run-config does not override it. Matches the
 * Composer's per-loop input default (app.js), so an unset loop runs 3 cycles.
 */
const DEFAULT_MAX_CYCLES = 3;

/** Local domain guard (mirrors agent-registry DOMAIN_RE). workflows.mjs deliberately
 *  does not import the registry, so a one-line constant is cheaper than a new coupling.
 *  Unlike the registry's normalizeDomain, this .trim()s — store input may carry
 *  whitespace from a prompt. Absent/malformed → the VISIBLE 'general' default. */
const DOMAIN_RE = /^[a-z][a-z0-9-]{0,31}$/;
function normDomain(raw) {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return DOMAIN_RE.test(v) ? v : 'general';
}

/**
 * Read an agent prompt file and pull its declared tools from YAML frontmatter.
 * Returns { prompt, tools }. A missing file => { prompt:'', tools:[] } (fails
 * safe; the orchestrator already tolerates an empty agent body). The frontmatter
 * `tools:` line is a comma-separated list (matches agents/*.md convention).
 * @param {string} agentsDir
 * @param {string|null} agentFile
 * @param {string|null} [agentPath]
 * @returns {Promise<{prompt:string, tools:string[]}>}
 */
export async function loadAgentFile(agentsDir, agentFile, agentPath = null) {
  if (!agentFile && !agentPath) return { prompt: '', tools: [] };
  let text = '';
  try {
    // Layered registry: the meta's stamped absolute agentPath (built-in, user OR
    // plugin layer) wins; the agentsDir+agentFile join serves hand-built
    // registries (tests) that carry no agentPath. A stamped path that cannot be
    // read is an EMPTY prompt, never a fallback into the built-in dir: that
    // fallback let a plugin sidecar naming an absent built-in file (e.g.
    // worca-cc-manual-web-ui-testing.md) run the built-in's prompt and tool
    // grants while its consent card said "none declared" (C-1).
    text = await readFile(agentPath || join(agentsDir, agentFile), 'utf8');
  } catch {
    return { prompt: '', tools: [] };
  }
  return { prompt: text, tools: parseFrontmatterTools(text) };
}

/** Extract a comma-separated `tools:` list from leading --- YAML frontmatter. */
function parseFrontmatterTools(text) {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  if (!m) return [];
  const line = m[1].split(/\r?\n/).find((l) => /^tools\s*:/.test(l));
  if (!line) return [];
  return line
    .replace(/^tools\s*:/, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Sanitize one node's `defaults` block (newpipeline-ux-design.md §4.4). Loud and
 * lenient, matching the module's house style: a malformed FIELD is dropped with a
 * console.warn naming it, the rest of the block survives. An empty/absent block
 * (or one left empty after dropping) yields undefined so callers omit the key.
 * Structural only — that `model` names a catalog entry is validated at the API
 * boundary (where the effective per-project catalog is reachable), exactly like
 * setStep/setNodeModel.
 * @param {unknown} raw
 * @param {string} [nodeId] for the warning message
 * @returns {{model?:string,effort?:string,fanOut?:boolean,askQuestions?:boolean}|undefined}
 */
export function sanitizeNodeDefaults(raw, nodeId = '?') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  const warn = (field, why) =>
    console.warn(`workflow node "${nodeId}": dropping defaults.${field} (${why})`);

  if (raw.model !== undefined) {
    const model = typeof raw.model === 'string' ? raw.model.trim() : '';
    if (model) out.model = model;
    else if (raw.model !== '' && raw.model !== null) warn('model', 'not a non-empty string');
  }
  if (raw.effort !== undefined) {
    const effort = typeof raw.effort === 'string' ? raw.effort.trim() : '';
    if (EFFORTS.includes(effort)) out.effort = effort;
    else if (effort) warn('effort', `unknown effort "${effort}"`);
  }
  // An effort without a model is meaningless (it is filtered by the model's
  // advertised effort list), so it never survives on its own.
  if (out.effort && !out.model) {
    warn('effort', 'no model to interpret it');
    delete out.effort;
  }
  for (const field of ['fanOut', 'askQuestions']) {
    if (raw[field] === undefined) continue;
    if (typeof raw[field] === 'boolean') out[field] = raw[field];
    else warn(field, 'not a boolean');
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Normalize a steps matrix for persistence: pass every node through untouched
 * EXCEPT its `defaults` block, which is sanitized (and dropped when empty).
 * Unknown node fields are preserved verbatim — plugin-shipped templates may carry
 * their own, and this function must not be the thing that silently eats them.
 * Pure: returns new arrays/objects, never mutates the input.
 * @param {unknown} steps
 * @returns {Array<Array<object>>}
 */
export function sanitizeWorkflowSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((group) => (Array.isArray(group) ? group.map((node) => {
    if (!node || typeof node !== 'object') return node;
    const { defaults, ...rest } = node;
    const clean = sanitizeNodeDefaults(defaults, node.id);
    return clean ? { ...rest, defaults: clean } : rest;
  }) : group));
}

/**
 * Flatten a template's per-node defaults to { [nodeId]: defaults }. Nodes without
 * a defaults block are absent from the map. Used by the UI/API to answer "what is
 * this workflow's default for node X" without re-walking steps.
 * @param {object|null} tpl
 * @returns {Record<string,object>}
 */
export function workflowNodeDefaults(tpl) {
  const out = {};
  if (Array.isArray(tpl?.nodes)) {                       // v2: defaults ARE node.config
    for (const node of tpl.nodes) {
      if (node?.kind !== 'agent') continue;
      const clean = sanitizeNodeDefaults(node.config, node.id);
      if (clean) out[node.id] = clean;
    }
    return out;
  }
  for (const group of Array.isArray(tpl?.steps) ? tpl.steps : []) {
    for (const node of Array.isArray(group) ? group : []) {
      if (node && node.id && node.defaults && typeof node.defaults === 'object') out[node.id] = node.defaults;
    }
  }
  return out;
}

/** Absolute path to ~/.worca-cc/workflows (honors WORCA_HOME via projects.mjs). */
export function workflowsDir() {
  return join(worcaHome(), 'workflows');
}

/** A workflow id is a stem; reject anything that could escape a path-built store
 *  (path separators, "..", dots, spaces). Valid ids are wf_<slug> / wf_default.
 *  EXPORTED because it is also the API's gate: PATCH /api/config keys three
 *  normalized tables by workflowId, and a workflow id is used as an OBJECT KEY
 *  (config.mjs readWorkflowsMap, app.js state.config.workflows[id]) — so every
 *  own property name of Object.prototype is refused too. The bare regex accepts
 *  "__proto__" (it is only letters and underscores), which is exactly how MAJ-1
 *  slipped through. Minted ids are always wf_/wfp_-prefixed, so nothing
 *  legitimate can collide with that rule. One rule, one source of truth. */
const SAFE_WORKFLOW_ID = /^[A-Za-z0-9_-]+$/;
/** A workflow id is also an OBJECT KEY (config.mjs readWorkflowsMap, app.js state.config.workflows[id]),
 *  so any own property name of Object.prototype ('__proto__', 'constructor', 'hasOwnProperty',
 *  'toString', …) is refused: on a plain object those resolve truthy and the next `.wires[id] =` throws. */
const isInheritedName = (id) => Object.prototype.hasOwnProperty.call(Object.prototype, id);
export function isSafeWorkflowId(id) {
  return typeof id === 'string' && SAFE_WORKFLOW_ID.test(id) && !isInheritedName(id);
}

/** Fail-safe JSON.parse to an array; returns [] on any error. */
function parseArr(text) {
  if (typeof text !== 'string' || !text) return [];
  try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Map a workflows row to the template object shape. Version-aware: `graph`
 *  carries {nodes, wires, canvas?} ONLY — id/name/domain/origin stay row columns,
 *  so a rename can never drift. */
function rowToTpl(r) {
  const base = {
    id: r.id,
    name: r.name,
    version: r.version,
    domain: r.domain || 'general',          // pre-migration NULL → 'general'
    origin: r.origin || null,               // 'plugin:<name>' provenance; NULL = user-created
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at || null,
  };
  if (r.version === 2) {
    let graph = {};
    try { graph = JSON.parse(r.graph || '{}') || {}; } catch { graph = {}; }
    base.nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    base.wires = Array.isArray(graph.wires) ? graph.wires : [];
    if (graph.canvas && typeof graph.canvas === 'object') base.canvas = graph.canvas;
    return base;
  }
  base.steps = parseArr(r.steps);
  base.feedbacks = parseArr(r.feedbacks);
  return base;
}

const ROW_COLS = 'id, name, version, domain, steps, feedbacks, graph, archived_at, created_at, updated_at, origin';

/** Read + shallow-validate one stored template row. Unsafe id / missing => null. */
function readRaw(id, { includeArchived = false } = {}) {
  if (!isSafeWorkflowId(id)) return null; // SECURITY: reject path-traversal / unsafe ids
  getDb();
  const r = prepare(`SELECT ${ROW_COLS} FROM workflows WHERE id = ?`).get(id);
  if (!r) return null;
  if (!includeArchived && r.archived_at) return null;
  const tpl = rowToTpl(r);
  if (tpl.version === 2) return Array.isArray(tpl.nodes) ? tpl : null;
  return Array.isArray(tpl.steps) ? tpl : null; // mirror the legacy steps-array check
}

/**
 * Persist a template. Stamps a wf_<slug> id (from the name) when missing, version 1,
 * createdAt (preserved across re-saves), and a fresh updatedAt. steps/feedbacks are
 * stored as JSON. Returns the stored object. Never mutates the input.
 * @param {object} tpl { id?, name, steps, feedbacks, createdAt? }
 * @returns {Promise<object>}
 */
export async function writeWorkflow(tpl) {
  const now = new Date().toISOString();
  const name = (tpl && typeof tpl.name === 'string' && tpl.name.trim()) || 'Untitled';
  const id = (tpl && typeof tpl.id === 'string' && tpl.id.trim()) || `wf_${slugify(name)}`;
  const steps = sanitizeWorkflowSteps(tpl?.steps);
  const feedbacks = Array.isArray(tpl?.feedbacks) ? tpl.feedbacks : [];
  const domain = normDomain(tpl && tpl.domain);

  getDb();
  // Preserve the original createdAt if this id already exists (re-save).
  const existing = isSafeWorkflowId(id)
    ? prepare('SELECT created_at FROM workflows WHERE id = ?').get(id)
    : null;
  const createdAt =
    (tpl && typeof tpl.createdAt === 'string' && tpl.createdAt) ||
    (existing && existing.created_at) ||
    now;

  const stored = { id, name, version: 1, domain, steps, feedbacks, createdAt, updatedAt: now };
  tx(() => {
    prepare(`
      INSERT INTO workflows (id, name, version, domain, steps, feedbacks, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, version = 1, domain = excluded.domain,
        steps = excluded.steps, feedbacks = excluded.feedbacks,
        updated_at = excluded.updated_at
    `).run(id, name, domain, JSON.stringify(steps), JSON.stringify(feedbacks), createdAt, now);
  });
  return stored;
}

/**
 * Persist a v2 graph template. Saving over an archived id UN-archives it (the
 * user rebuilt it on purpose). v1 columns are written empty so a v1 reader can
 * never mistake a graph row for a step plan.
 * @param {{id?:string, name:string, domain?:string, origin?:string, nodes:Array, wires:Array, canvas?:object}} tpl
 */
export async function writeGraphWorkflow(tpl) {
  const now = new Date().toISOString();
  const name = (tpl && typeof tpl.name === 'string' && tpl.name.trim()) || 'Untitled';
  // The ONE reserved id is the built-in default's; a save may never claim it,
  // so it falls back to the slug.
  const asked = tpl && typeof tpl.id === 'string' ? tpl.id.trim() : '';
  const id = asked && isSafeWorkflowId(asked) && asked !== GRAPH_DEFAULT_WORKFLOW.id
    ? asked
    : `wf_${slugify(name)}`;
  const domain = normDomain(tpl && tpl.domain);
  const origin = typeof tpl?.origin === 'string' && tpl.origin ? tpl.origin : null;
  const graph = { nodes: Array.isArray(tpl?.nodes) ? tpl.nodes : [], wires: Array.isArray(tpl?.wires) ? tpl.wires : [] };
  if (tpl?.canvas && typeof tpl.canvas === 'object') graph.canvas = tpl.canvas;

  getDb();
  const existing = prepare('SELECT created_at FROM workflows WHERE id = ?').get(id);
  const createdAt = (typeof tpl?.createdAt === 'string' && tpl.createdAt) || existing?.created_at || now;
  tx(() => {
    prepare(`
      INSERT INTO workflows (id, name, version, domain, steps, feedbacks, graph, archived_at, created_at, updated_at, origin)
      VALUES (?, ?, 2, ?, '[]', '[]', ?, NULL, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, version = 2, domain = excluded.domain,
        steps = '[]', feedbacks = '[]', graph = excluded.graph, archived_at = NULL,
        updated_at = excluded.updated_at,
        -- COALESCE, never a plain overwrite: the composer's Save on a loaded row
        -- sends {id, name, nodes, wires} and NO origin, so a plain
        -- "origin = excluded.origin" would silently detach a plugin-owned wfp_* row
        -- from removePluginWorkflows' guard. v1's writeWorkflow never touches origin
        -- on conflict either. (SQL comments only: a backtick here would END the JS literal.)
        origin = COALESCE(excluded.origin, workflows.origin)
    `).run(id, name, domain, JSON.stringify(graph), createdAt, now, origin);
  });
  // Re-read `origin`: the UPSERT may have KEPT an existing one this call omitted.
  const stored = prepare('SELECT origin FROM workflows WHERE id = ?').get(id);
  return { id, name, version: 2, domain, origin: stored?.origin ?? null, ...graph, createdAt, updatedAt: now };
}

/**
 * Read a template by id. Returns the built-in GRAPH_DEFAULT_WORKFLOW for "wf_default";
 * otherwise the stored row, or null when absent/corrupt/unsafe-id/archived.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function readWorkflow(id, opts = {}) {
  // `wf_default` IS the graph: the v1 default died with the v1 engine.
  if (id === GRAPH_DEFAULT_WORKFLOW.id) return GRAPH_DEFAULT_WORKFLOW;
  return readRaw(id, opts);
}

/**
 * List user templates (NOT GRAPH_DEFAULT_WORKFLOW — callers prepend it), newest first by
 * createdAt. Archived rows are hidden unless asked for. Empty store => [].
 * @returns {Promise<object[]>}
 */
export async function listWorkflows({ includeArchived = false } = {}) {
  getDb();
  const where = includeArchived ? '' : 'WHERE archived_at IS NULL';
  const rows = prepare(`SELECT ${ROW_COLS} FROM workflows ${where} ORDER BY created_at DESC, id`).all();
  return rows.filter((r) => r.id !== GRAPH_DEFAULT_WORKFLOW.id).map(rowToTpl);
}

/** The ONE gate every run path goes through (POST /api/run, the CLI's
 *  --workflow, Ask's proposal validation). Throws with a `code` the callers map
 *  to HTTP/exit codes; the ARCHIVED text is user-facing and verbatim. */
export async function assertRunnableWorkflow(id) {
  const wanted = typeof id === 'string' && id.trim() ? id.trim() : GRAPH_DEFAULT_WORKFLOW.id;
  const live = await readWorkflow(wanted);
  if (live) return live;
  const archived = await readWorkflow(wanted, { includeArchived: true });
  if (archived) {
    throw Object.assign(new Error(`workflow "${wanted}" was archived by the v2 upgrade `
      + '(v1 template, not runnable) — pick a v2 pipeline or rebuild it in the Composer'), { code: 'ARCHIVED' });
  }
  throw Object.assign(new Error(`unknown workflowId "${wanted}"`), { code: 'NOT_FOUND' });
}

/**
 * Replace the per-node `defaults` of a SAVED template (newpipeline-ux-design.md
 * §4.4). `map` is { [nodeId]: defaults|null }: a sanitized block sets that node's
 * defaults, null/empty clears them, and a node absent from the map keeps what it
 * has. Node ids unknown to the template are ignored (a stale UI must not
 * resurrect deleted nodes). Topology is untouched.
 *
 * Refuses wf_default: the built-in is frozen and never persisted, so it has no row
 * to carry defaults — its sensible defaults come from the agent registry instead
 * (design D6). Duplicating it in Composer yields a saved workflow that can.
 *
 * @param {string} id
 * @param {Record<string,object|null>} map
 * @returns {Promise<object>} the updated template
 * @throws {Error} unknown/unsafe id, or the built-in default
 */
export async function setWorkflowNodeDefaults(id, map) {
  if (id === GRAPH_DEFAULT_WORKFLOW.id) {
    throw new Error('the built-in Default workflow cannot store defaults — save a copy in Composer first');
  }
  const tpl = readRaw(id);
  if (!tpl) throw new Error(`workflow not found: ${id}`);
  const patch = map && typeof map === 'object' ? map : {};

  if (tpl.version === 2) {
    const TUNABLES = ['model', 'effort', 'fanOut', 'askQuestions'];
    const nodes = tpl.nodes.map((node) => {
      if (!Object.prototype.hasOwnProperty.call(patch, node.id)) return node;
      const clean = sanitizeNodeDefaults(patch[node.id], node.id) || {};
      // Only the 4 tunables are defaults; awaitAll/arity/planStoreSeed are
      // TOPOLOGY and must survive a defaults patch untouched.
      const kept = Object.fromEntries(Object.entries(node.config || {}).filter(([k]) => !TUNABLES.includes(k)));
      return { ...node, config: { ...kept, ...clean } };
    });
    const now = new Date().toISOString();
    tx(() => {
      prepare('UPDATE workflows SET graph = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify({ nodes, wires: tpl.wires, ...(tpl.canvas ? { canvas: tpl.canvas } : {}) }), now, id);
    });
    return { ...tpl, nodes, updatedAt: now };
  }

  const steps = tpl.steps.map((group) => (Array.isArray(group) ? group.map((node) => {
    if (!node || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(patch, node.id)) return node;
    const { defaults, ...rest } = node;
    const clean = sanitizeNodeDefaults(patch[node.id], node.id);
    return clean ? { ...rest, defaults: clean } : rest;
  }) : group));

  const now = new Date().toISOString();
  tx(() => {
    prepare('UPDATE workflows SET steps = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(steps), now, id);
  });
  return { ...tpl, steps, updatedAt: now };
}

/**
 * Delete a saved template by id. Refuses the built-in GRAPH_DEFAULT_WORKFLOW (false) and
 * unsafe ids (false). Returns false when no row exists; true on removal.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteWorkflow(id) {
  if (id === GRAPH_DEFAULT_WORKFLOW.id) return false; // built-in default is undeletable
  if (!isSafeWorkflowId(id)) return false;      // SECURITY: reject unsafe ids
  getDb();
  let changed = 0;
  tx(() => {
    changed = prepare('DELETE FROM workflows WHERE id = ?').run(id).changes;
  });
  return changed > 0;
}
/**
 * Merge a workflow template + the project's run-config + the agent registry into
 * an ExecutablePlan the dispatcher runs:
 *   { id, name, steps:[[Node]], feedbacks:[{id,from,to,maxCycles,gate}] }
 *   Node = { nodeId, key, uiPhase, runnerType, agentFile, agentPrompt, model, effort, tools, loopSource }
 * model/effort come from run-config (undefined when unset; the orchestrator folds
 * in the global fallback at dispatch). maxCycles defaults to DEFAULT_MAX_CYCLES.
 * [v2/C5] When `opts.isWorkspace` is set, the review node is substituted at resolve
 * time: any `reviewer` node key becomes `workspaceReviewer` (the fan-out synthesizer
 * that diffs each member's checkpoint and folds one merged verdict). This is the ONE
 * topology change a workspace run makes here; the orchestrator then forces fanOut on
 * the eligible nodes (which now includes `workspaceReviewer`). Absent `isWorkspace`,
 * the resolved plan is BYTE-IDENTICAL to today's single-project path.
 * @param {string} projectDir
 * @param {string} workflowId
 * @param {Record<string,object>} registry  loadAgentRegistry() output
 * @param {string} [agentsDir]  override for tests; defaults to ../../agents
 * @param {{ isWorkspace?: boolean }} [opts]  workspace-mode resolve options
 * @returns {Promise<object>} ExecutablePlan
 * @throws {Error} when the workflow id is unknown, or a node resolves the off-pipeline scanner
 */
/** Port SIGNATURE for the workspace-variant check: the fields that change
 *  SCHEDULING (ids, types, cardinality, loop/expands, conditional routing).
 *  Deliberately excludes `as`, filename and store — a variant may render and
 *  store differently, it may not fire differently. */
function portSignature(meta) {
  return JSON.stringify({
    inputs: (meta?.inputs || []).map((p) => ({ id: p.id, type: p.type, required: p.required !== false,
      loop: !!p.loop, expands: !!p.expands })),
    outputs: (meta?.outputs || []).map((p) => ({ id: p.id, type: p.type, when: p.when || 'always' })),
    verdict: Boolean(meta?.verdict),
  });
}

const LAYER_RANK = (origin) => (origin === 'builtin' ? 0 : String(origin || '').startsWith('plugin:') ? 2 : 1);

/**
 * Workspace substitutions, derived from META alone (no agent-key literals): every
 * `scope:'workspace-only'` meta that declares `workspaceVariantOf` claims that
 * target. Ties break by layer — builtin > user > plugin.
 * @returns {Record<string, object>} target key -> variant meta
 */
export function workspaceVariants(registry) {
  const out = {};
  for (const meta of Object.values(registry || {})) {
    if (!meta || meta.scope !== 'workspace-only' || !meta.workspaceVariantOf) continue;
    const prev = out[meta.workspaceVariantOf];
    if (!prev || LAYER_RANK(meta.origin) < LAYER_RANK(prev.origin)) out[meta.workspaceVariantOf] = meta;
  }
  return out;
}

/**
 * Merge a v2 template + the project's run-config + the registry into everything a
 * graph run needs. The template comes back UNMUTATED; effective per-node config
 * lives in `nodes`, per-loop-wire budgets in `wires`. P4's _resolveTopology feeds
 * `nodes`/`wires` to buildGraphManifest as `overlays`.
 * @throws {Error} unknown workflow, a v1 row, an unknown/un-ported/unplaceable agent
 */
export async function resolveGraph(projectDir, workflowId, registry, agentsDir = DEFAULT_AGENTS_DIR, opts = {}) {
  const stored = await readWorkflow(workflowId);
  if (!stored) throw new Error(`unknown workflowId "${workflowId}"`);
  if (stored.version !== 2) throw new Error('template is not a graph — runs on the v1 engine');
  // The RESOLVED template: a private deep copy (the alias row spreads a deep-frozen
  // constant) whose agent nodes carry the RESOLVED key after workspace substitution.
  const tpl = structuredClone(stored);
  const reg = registry && typeof registry === 'object' ? registry : {};
  const isWorkspace = !!opts.isWorkspace;
  const variants = isWorkspace ? workspaceVariants(reg) : {};
  const { nodes: nodeCfg, wires: wireCfg } = await resolveRunConfig(projectDir, workflowId);
  // The legacy per-role layer is the Default workflow's storage only (saved rows
  // use nodeCfg); it is addressed by agent KEY, never by node id.
  const stepsCfg = workflowId === GRAPH_DEFAULT_WORKFLOW.id ? (await readConfig(projectDir)).steps : {};
  const firstDefined = (...vals) => vals.find((v) => v !== undefined);

  const nodes = {};
  const agentsByKey = {};
  const agentKeys = new Set();
  for (const node of Array.isArray(tpl.nodes) ? tpl.nodes : []) {
    if (node.kind !== 'agent') {
      nodes[node.id] = { nodeId: node.id, kind: node.kind, key: null, config: { ...(node.config || {}) } };
      continue;
    }
    const authored = node.key;
    const key = variants[authored]?.key || authored;
    if (key !== authored) node.key = key;          // the resolved template carries the resolved key
    const meta = reg[key];
    if (!meta) throw new Error(`unknown agent "${key}" — no such key in the registry`);
    if (!Array.isArray(meta.inputs) || !Array.isArray(meta.outputs)) {
      throw new Error(`agent "${key}" has no v2 ports — port its sidecar to metaVersion 2`);
    }
    if (meta.placeable === false) throw new Error(`agent "${key}" declares placeable: false and cannot be a graph node`);
    if (key !== authored && portSignature(meta) !== portSignature(reg[authored] || {})) {
      throw new Error(`workspace variant "${key}" does not match the port signature of "${authored}"`);
    }
    const { prompt, tools } = await loadAgentFile(agentsDir, meta.agentFile ?? null, meta.agentPath ?? null);
    const sel = nodeCfg[node.id] || {};
    // Legacy per-role config is keyed by the AUTHORED key, so a substituted
    // variant still inherits the user's model/effort for that role.
    const legacy = stepsCfg[authored] || {};
    const cfg = node.config && typeof node.config === 'object' ? node.config : {};
    nodes[node.id] = {
      nodeId: node.id,
      kind: 'agent',
      key,
      authoredKey: authored,
      meta,
      runnerType: meta.runnerType || 'producer',
      agentFile: meta.agentFile ?? null,
      agentPrompt: prompt,
      promptHints: typeof meta.promptHints === 'string' ? meta.promptHints : '',
      tools,
      config: { ...cfg },
      model: firstDefined(sel.model, legacy.model, cfg.model),
      // An effort only travels with the model that advertises it: an override
      // naming its own model must not inherit the lower layer's effort.
      effort: firstDefined(sel.effort, legacy.effort, (sel.model || legacy.model) ? undefined : cfg.effort),
      // workspaceFanOut forces fan-out on a workspace run (the generic
      // replacement for the v1 FANOUT_ELIGIBLE key list).
      fanOut: isWorkspace && meta.workspaceFanOut
        ? true
        : !!firstDefined(sel.fanOut, legacy.fanOut, cfg.fanOut, meta.fanOut, false),
      askQuestions: !meta.asksQuestions
        ? false
        : (meta.questionsLocked
          ? !!meta.questionsDefault
          : !!firstDefined(sel.askQuestions, legacy.askQuestions, cfg.askQuestions, meta.questionsDefault, false)),
      awaitAll: !!cfg.awaitAll,
    };
    agentsByKey[key] = meta;
    agentKeys.add(key);
  }

  // Two nodes sharing one agent key prefix their run-store outputs (executor dupPrefix).
  const keyCount = new Map();
  for (const nc of Object.values(nodes)) if (nc.kind === 'agent') keyCount.set(nc.key, (keyCount.get(nc.key) || 0) + 1);
  for (const nc of Object.values(nodes)) if (nc.kind === 'agent') nc.duplicateKey = (keyCount.get(nc.key) || 0) > 1;

  // Budgets ride LOOP wires only: overlay > authored > DEFAULT_MAX_CYCLES.
  // portsFn + loops are computed ONCE here and RETURNED — P4 hands them to the
  // scheduler and the manifest builder instead of re-deriving them.
  const portsFn = registryPortsFn(agentsByKey);
  const loops = classifyLoops(tpl, portsFn);
  const { loopWireIds } = loops;
  const wires = {};
  for (const w of Array.isArray(tpl.wires) ? tpl.wires : []) {
    if (!loopWireIds.has(w.id)) continue;
    const raw = Number(wireCfg[w.id]?.maxCycles ?? w.config?.maxCycles);
    wires[w.id] = { maxCycles: Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_MAX_CYCLES };
  }
  return { template: tpl, ports: portsFn, loops, nodes, wires, agentsByKey, agentKeys };
}
