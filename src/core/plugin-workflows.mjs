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
import { validateWorkflow } from './workflow-validator.mjs';
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
 * Upsert every <versionDir>/workflows/*.json into the workflows table.
 * id = wfp_<plugin>_<slug(filename)>, origin = 'plugin:<plugin>'. Each template
 * is validated (workflow-validator) against the MERGED registry — importing runs
 * AFTER the symlink swap + lock write, so the plugin's own agents resolve. An
 * invalid/unreadable template is skipped with a warning, never thrown (spec §9.3).
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
  getDb(); // open + migrate: workflows.origin exists (SCHEMA_V13, Task 10)
  const registry = loadAgentRegistry(); // merged builtin+user+plugin (Task 6)
  const now = new Date().toISOString();
  for (const f of files) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch (err) {
      skipped.push({ file: f, errors: [`unreadable JSON: ${err.message}`] });
      console.warn(`[plugin-workflows] ${name}/${f}: unreadable JSON — skipped`);
      continue;
    }
    const tpl = {
      steps: Array.isArray(raw?.steps) ? raw.steps : [],
      feedbacks: Array.isArray(raw?.feedbacks) ? raw.feedbacks : [],
    };
    const v = validateWorkflow(tpl, registry);
    if (!v.ok) {
      skipped.push({ file: f, errors: v.errors });
      console.warn(`[plugin-workflows] ${name}/${f}: invalid template — skipped (${v.errors.join('; ')})`);
      continue;
    }
    const id = `wfp_${name}_${slugify(basename(f, '.json'))}`;
    const rowName = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : basename(f, '.json');
    tx(() => {
      prepare(`
        INSERT INTO workflows (id, name, version, domain, steps, feedbacks, origin, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, version = 1, domain = excluded.domain,
          steps = excluded.steps, feedbacks = excluded.feedbacks,
          origin = excluded.origin, updated_at = excluded.updated_at
      `).run(id, rowName, normDomain(raw.domain), JSON.stringify(tpl.steps),
             JSON.stringify(tpl.feedbacks), origin, now, now);
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
  for (const p of prepare('SELECT id, resume_point FROM pipelines WHERE resume_point IS NOT NULL').all()) {
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
    'SELECT id, name, steps FROM workflows WHERE origin IS NULL OR origin != ?',
  ).all(`plugin:${name}`)) {
    let steps;
    try { steps = JSON.parse(row.steps); } catch { continue; }
    const found = new Set();
    for (const group of Array.isArray(steps) ? steps : []) {
      for (const node of Array.isArray(group) ? group : []) {
        if (node && keys.has(node.key)) found.add(node.key);
      }
    }
    if (found.size) out.push({ workflowId: row.id, name: row.name, keys: [...found].sort() });
  }
  return out;
}
