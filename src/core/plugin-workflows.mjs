// src/core/plugin-workflows.mjs
// Plugin workflow templates (spec §9.3): import at install/update upserts
// namespaced rows into the existing `workflows` table (id wfp_<plugin>_<slug>,
// origin 'plugin:<plugin>' — column added by SCHEMA_V13); uninstall removes
// plugin-origin rows behind a reference guard. User duplicates (origin NULL)
// are separate rows and are NEVER touched here.
//
// Templates are v2 GRAPHS (worca-cc-api 2): the same flat {version, nodes, wires}
// document a composed template is, stored in the same `graph` column (SCHEMA_V17)
// and gated by the same validateGraph — a plugin template is a first-class
// template, never a second dialect.

import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

import { getDb, prepare, tx } from './db.mjs';
import { slugify } from './artifacts.mjs';
import { pluginCurrentDir } from './plugins-lock.mjs';
import { loadAgentRegistry } from './agent-registry.mjs';
import { registryPortsFn } from './workflows.mjs';
import { validateGraph } from './graph/validate.mjs';

/** Uninstall guard error: plugin workflows are still referenced by project state. */
export class ReferencedError extends Error {
  constructor(message, references) {
    super(message);
    this.name = 'ReferencedError';
    this.references = references; // [{ workflowId, referencedBy: string[] }]
  }
}

/** Mirrors workflows.mjs normDomain (deliberately duplicated one-liner, same rationale). */
const DOMAIN_RE = /^[a-z][a-z0-9-]{0,31}$/;
const normDomain = (raw) => {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return DOMAIN_RE.test(v) ? v : 'general';
};

/**
 * Upsert every <versionDir>/workflows/*.json into the workflows table.
 * id = wfp_<plugin>_<slug(filename)>, origin = 'plugin:<plugin>'. Each template
 * is a v2 GRAPH and goes through the shared validator before it lands.
 * Importing runs AFTER the symlink swap + lock write, so the plugin's own agents
 * resolve against the MERGED registry. An unreadable, v1 or invalid template is
 * skipped with a warning, never thrown (spec §9.3).
 * No workflows/ dir => { imported: [], skipped: [] } (feature-off no-op).
 * @param {string} name       plugin name (kebab-case; id stays SAFE_WORKFLOW_ID-legal)
 * @param {string} versionDir the exported version dir (or current/ — same tree)
 * @returns {Promise<{imported: string[], skipped: Array<{file:string, errors:string[]}>}>}
 */
export async function importPluginWorkflows(name, versionDir) {
  const origin = `plugin:${name}`;
  const dir = join(versionDir, 'workflows');
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { /* no workflows/ */ }
  const imported = [];
  const skipped = [];
  if (!files.length) return { imported, skipped };
  getDb(); // open + migrate: workflows.origin/graph exist (SCHEMA_V13/V17)
  const now = new Date().toISOString();
  // ONE registry load for the whole import, and the SHARED port synthesis over
  // it: agent meta ports plus the universal `await` gate and the flow-card
  // table. Templates are not in the DB yet, so resolveGraph is unavailable —
  // registryPortsFn exists for exactly this caller and the server save route.
  const portsFn = registryPortsFn(loadAgentRegistry());
  const skip = (f, errors) => {
    skipped.push({ file: f, errors });
    console.warn(`[plugin-workflows] ${name}/${f}: invalid template — skipped (${errors.join('; ')})`);
  };
  for (const f of files) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch (err) {
      skipped.push({ file: f, errors: [`unreadable JSON: ${err.message}`] });
      console.warn(`[plugin-workflows] ${name}/${f}: unreadable JSON — skipped`);
      continue;
    }
    const id = `wfp_${name}_${slugify(basename(f, '.json'))}`;
    const rowName = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : basename(f, '.json');
    const domain = normDomain(raw?.domain);
    // A v1 `steps` template is called out by name rather than left to V1's
    // generic "version must be 2": the plugin author needs to know their
    // template needs porting, not that a field is off by one.
    if (Number(raw?.version) !== 2) {
      skip(f, [`not a version-2 graph template (got version ${JSON.stringify(raw?.version)}) — `
        + 'port the "steps" pipeline to nodes/wires']);
      continue;
    }
    // createdAt is preserved across re-imports the same way the row column is:
    // the graph document carries it, so a re-save must not restamp it.
    const existing = prepare('SELECT created_at FROM workflows WHERE id = ?').get(id);
    const createdAt = (typeof raw.createdAt === 'string' && raw.createdAt) || existing?.created_at || now;
    const graph = {
      id, name: rowName, version: 2, domain, createdAt,
      nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
      wires: Array.isArray(raw.wires) ? raw.wires : [],
    };
    if (raw.canvas && typeof raw.canvas === 'object') graph.canvas = raw.canvas; // view state, engine-ignored
    // The FULL kind set {agent, task, and, or, combine, end} and every rule
    // V1-V21 — including V20/V21's mandatory task + end nodes and V7's
    // one-wire-per-input — apply to a plugin template exactly as they do to a
    // hand-composed one. Warnings never block an import (they do not block a
    // save either); they are logged so a template that will misbehave at run
    // time says so at install.
    const { errors, warnings } = validateGraph(graph, portsFn);
    if (errors.length) { skip(f, errors.map((e) => `${e.code}: ${e.msg}`)); continue; }
    for (const w of warnings) console.warn(`[plugin-workflows] ${name}/${f}: ${w.code}: ${w.msg}`);
    tx(() => {
      prepare(`
        INSERT INTO workflows (id, name, version, domain, graph, steps, feedbacks, origin, created_at, updated_at)
        VALUES (?, ?, 2, ?, ?, '[]', '[]', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, version = 2, domain = excluded.domain,
          graph = excluded.graph, steps = '[]', feedbacks = '[]',
          origin = excluded.origin, updated_at = excluded.updated_at
      `).run(id, rowName, domain, JSON.stringify(graph), origin, createdAt, now);
    });
    imported.push(id);
  }
  return { imported, skipped };
}

/**
 * Delete this plugin's imported workflow rows (origin = 'plugin:<name>').
 * Guarded: a project_config.active_workflow_id pinning one, or a pipeline whose
 * resume_point.workflowId pins one (resume re-reads the workflow row), throws
 * ReferencedError with the full referencing list — nothing deleted. Scope note:
 * done/stopped rows never trip this — the orchestrator nulls resumePoint on both
 * paths (orchestrator.mjs:527/:557 and :702/:720) and writeState persists the
 * NULL — while paused/interrupted rows legitimately do. ERRORED rows may retain
 * a resume_point (the error path does not clear it) and also block: intended,
 * since an errored run can still be recovered via the recoverable-error gate.
 * @param {string} name
 * @returns {Promise<{removed: string[]}>}
 */
export async function removePluginWorkflows(name) {
  const origin = `plugin:${name}`;
  getDb();
  const rows = prepare('SELECT id FROM workflows WHERE origin = ?').all(origin);
  if (!rows.length) return { removed: [] };
  const ids = new Set(rows.map((r) => r.id));

  const references = [];
  for (const cfg of prepare(
    'SELECT project_key, active_workflow_id FROM project_config WHERE active_workflow_id IS NOT NULL',
  ).all()) {
    if (ids.has(cfg.active_workflow_id)) {
      references.push({ workflowId: cfg.active_workflow_id, referencedBy: [`project_config ${cfg.project_key}`] });
    }
  }
  // archived_at IS NULL for the same reason guardrail-store.mjs filters it: an
  // archived row keeps its resume_point but can never be resumed or seen again,
  // so a pin held there would strand `worca plugin remove` permanently.
  for (const p of prepare(
    'SELECT id, resume_point FROM pipelines WHERE resume_point IS NOT NULL AND archived_at IS NULL',
  ).all()) {
    try {
      const rp = JSON.parse(p.resume_point);
      if (rp && ids.has(rp.workflowId)) references.push({ workflowId: rp.workflowId, referencedBy: [`pipeline ${p.id}`] });
    } catch { /* corrupt resume point: not a reference */ }
  }
  if (references.length) {
    const lines = references.map((r) => `  - ${r.workflowId} (referenced by ${r.referencedBy.join(', ')})`);
    throw new ReferencedError(
      `cannot remove workflows of plugin "${name}" — still referenced:\n${lines.join('\n')}`,
      references,
    );
  }
  tx(() => { prepare('DELETE FROM workflows WHERE origin = ?').run(origin); });
  return { removed: rows.map((r) => r.id) };
}

/**
 * Uninstall guard input (spec §6.3): NON-plugin workflows (user rows and other
 * plugins' rows — anything not origin 'plugin:<name>') whose GRAPH references one
 * of THIS plugin's agent keys. Keys come from current/agents/*.meta.json.
 *
 * The walk is over `graph.nodes[]`, not the v1 `steps` column: every v2 writer
 * blanks `steps` to '[]', so the pre-V17 scan matched nothing and the guard let
 * `worca plugin remove` rip an agent out from under a user's saved template.
 * Only `kind: 'agent'` nodes carry a key (V3), so no other kind can match.
 *
 * Synchronous, never throws: no current/agents (already-broken install) => [].
 * @param {string} name
 * @returns {Array<{workflowId: string, name: string, keys: string[]}>}
 */
export function referencedPluginAgents(name) {
  const keys = new Set();
  try {
    const dir = join(pluginCurrentDir(name), 'agents');
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.meta.json')) continue;
      try {
        const k = JSON.parse(readFileSync(join(dir, f), 'utf8'))?.key;
        if (typeof k === 'string' && k.trim()) keys.add(k.trim());
      } catch { /* malformed sidecar: nothing to guard */ }
    }
  } catch { return []; }
  if (!keys.size) return [];
  getDb();
  const out = [];
  for (const row of prepare(
    'SELECT id, name, graph FROM workflows WHERE origin IS NULL OR origin != ?',
  ).all(`plugin:${name}`)) {
    let graph;
    try { graph = JSON.parse(row.graph); } catch { continue; }
    const found = new Set();
    for (const node of Array.isArray(graph?.nodes) ? graph.nodes : []) {
      if (node && node.kind === 'agent' && keys.has(node.key)) found.add(node.key);
    }
    if (found.size) out.push({ workflowId: row.id, name: row.name, keys: [...found].sort() });
  }
  return out;
}
