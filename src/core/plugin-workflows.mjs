// src/core/plugin-workflows.mjs
// Plugin workflow templates (spec §9.3): import at install/update upserts
// namespaced rows into the existing `workflows` table (id wfp_<plugin>_<slug>,
// origin 'plugin:<plugin>' — column added by SCHEMA_V13); uninstall removes
// plugin-origin rows behind a reference guard. User duplicates (origin NULL)
// are separate rows and are NEVER touched here.

import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

import { getDb, prepare, tx } from './db.mjs';
import { slugify } from './artifacts.mjs';
import { loadAgentRegistry } from './agent-registry.mjs';
import { registryPortsFn } from './graph/registry-ports.mjs';
import { validateGraph } from '../shared/graph/validate.mjs';
import { NOT_GRAPH_V2 } from './plugin-manifest.mjs';
import { pluginCurrentDir } from './plugins-lock.mjs';

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
 * READ + VALIDATE every <versionDir>/workflows/*.json WITHOUT touching the DB.
 * Split out of importPluginWorkflows so the Plugins card, the doctor and the
 * install receipt can name a skipped template with the SAME reason the importer
 * logged — a second, re-derived reader would be free to disagree with it.
 * @param {string} name
 * @param {string} versionDir
 * @param {{registry?: object, quiet?: boolean}} [opts] registry: reuse ONE
 *        loadAgentRegistry() across plugins; quiet: no console.warn (read-only
 *        callers must not re-log what the importer already logged).
 * @returns {{ready: Array<object>, skipped: Array<{file:string, errors:string[]}>}}
 */
export function readPluginWorkflows(name, versionDir, { registry = null, quiet = false } = {}) {
  const origin = `plugin:${name}`;
  const dir = join(versionDir, 'workflows');
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { /* no workflows/ */ }
  const ready = [];
  const skipped = [];
  if (!files.length) return { ready, skipped };
  // ONE registry load for the whole read, and the SHARED port synthesis over
  // it: agent meta ports plus the universal `await` gate and the flow-card
  // table. The templates are not in the DB yet, so resolveGraph is unavailable —
  // registryPortsFn exists for exactly this caller and the server's save route.
  const portsFn = registryPortsFn(registry || loadAgentRegistry());
  const warn = (msg) => { if (!quiet) console.warn(msg); };
  const skip = (f, errors) => {
    skipped.push({ file: f, errors });
    warn(`[plugin-workflows] ${name}/${f}: invalid template — skipped (${errors.join('; ')})`);
  };
  for (const f of files) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch (err) {
      skipped.push({ file: f, errors: [`unreadable JSON: ${err.message}`] });
      warn(`[plugin-workflows] ${name}/${f}: unreadable JSON — skipped`);
      continue;
    }
    // A v1 `steps` template is called out by name rather than left to V1's
    // generic "version must be 2": the plugin author needs to know their
    // template needs porting, not that a field is off by one. Same clause the
    // validator prints, imported so the two can never drift.
    if (Number(raw?.version) !== 2) { skip(f, [NOT_GRAPH_V2]); continue; }
    const id = `wfp_${name}_${slugify(basename(f, '.json'))}`;
    const rowName = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : basename(f, '.json');
    const domain = normDomain(raw.domain);
    const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
    const wires = Array.isArray(raw.wires) ? raw.wires : [];
    // The FULL kind set {agent, task, and, or, combine, end} and every rule
    // V1-V21 — including V20/V21's mandatory Task + End cards and V7's
    // one-wire-per-input — apply to a plugin template exactly as they do to a
    // hand-composed one. Warnings never block an import (they do not block a
    // save either); they are logged so a template that will misbehave at run
    // time says so at install.
    const { errors, warnings } = validateGraph({ id, name: rowName, version: 2, domain, nodes, wires }, portsFn);
    if (errors.length) { skip(f, errors.map((e) => `${e.code}: ${e.message}`)); continue; }
    for (const w of warnings) warn(`[plugin-workflows] ${name}/${f}: ${w.code}: ${w.message}`);
    // graph holds {nodes, wires, canvas?} ONLY — id/name/domain/origin are row
    // columns, so a rename can never drift between the two.
    const graph = { nodes, wires };
    if (raw.canvas && typeof raw.canvas === 'object') graph.canvas = raw.canvas; // accepted, engine-ignored
    ready.push({ file: f, id, rowName, domain, graph, origin });
  }
  return { ready, skipped };
}

/**
 * Upsert every <versionDir>/workflows/*.json into the workflows table.
 * id = wfp_<plugin>_<slug(filename)>, origin = 'plugin:<plugin>'. Each template
 * is validated by the SHARED `validateGraph` over `registryPortsFn(loadAgentRegistry())`
 * — importing runs AFTER the symlink swap + lock write, so the plugin's own agents resolve. An
 * invalid/unreadable template is skipped with a warning, never thrown (spec §9.3).
 * No workflows/ dir => { imported: [], skipped: [] } (feature-off no-op).
 * @param {string} name       plugin name (kebab-case; id stays SAFE_WORKFLOW_ID-legal)
 * @param {string} versionDir the exported version dir (or current/ — same tree)
 * @returns {Promise<{imported: string[], skipped: Array<{file:string, errors:string[]}>}>}
 */
export async function importPluginWorkflows(name, versionDir) {
  const { ready, skipped } = readPluginWorkflows(name, versionDir);
  const imported = [];
  if (!ready.length && !skipped.length) return { imported, skipped };
  getDb(); // open + migrate: workflows.origin/graph/archived_at exist (V13/V23)
  const now = new Date().toISOString();
  for (const r of ready) {
    tx(() => {
      prepare(`
        INSERT INTO workflows (id, name, version, domain, graph, steps, feedbacks, origin, created_at, updated_at, archived_at)
        VALUES (?, ?, 2, ?, ?, '[]', '[]', ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, version = 2, domain = excluded.domain,
          graph = excluded.graph, steps = '[]', feedbacks = '[]',
          origin = excluded.origin, updated_at = excluded.updated_at,
          archived_at = NULL
      `).run(r.id, r.rowName, r.domain, JSON.stringify(r.graph), r.origin, now, now);
    });
    imported.push(r.id);
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
 * plugins' rows — anything not origin 'plugin:<name>') whose steps JSON references
 * one of THIS plugin's agent keys. Keys come from current/agents/*.meta.json.
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
    'SELECT id, name, steps, graph FROM workflows WHERE origin IS NULL OR origin != ?',
  ).all(`plugin:${name}`)) {
    const found = new Set();
    let steps;
    try { steps = JSON.parse(row.steps); } catch { steps = null; }
    for (const group of Array.isArray(steps) ? steps : []) {
      for (const node of Array.isArray(group) ? group : []) if (node && keys.has(node.key)) found.add(node.key);
    }
    let graph;
    try { graph = JSON.parse(row.graph || 'null'); } catch { graph = null; }
    // v2 rows: only kind 'agent' nodes carry a key (a task/end/and/or/combine
    // card never does), so the walk is narrowed rather than key-only.
    for (const node of Array.isArray(graph?.nodes) ? graph.nodes : []) {
      if (node && node.kind === 'agent' && keys.has(node.key)) found.add(node.key);
    }
    if (found.size) out.push({ workflowId: row.id, name: row.name, keys: [...found].sort() });
  }
  return out;
}
