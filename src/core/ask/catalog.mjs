// src/core/ask/catalog.mjs
// The static catalog the assistant sees (ask-worca-design.md §6.1, D9): projects,
// workspaces and workflows with their ordered step groups. ONE builder feeds both
// the system prompt (prompt.mjs renders a subset) and the list_projects /
// list_workflows tools (tools.mjs returns the objects) — never two readers.
// Readers are injected so unit tests run without a DB.
import { listProjects as realListProjects } from '../projects.mjs';
import { listWorkspaces as realListWorkspaces } from '../workspaces.mjs';
import { listWorkflows as realListWorkflows, DEFAULT_WORKFLOW } from '../workflows.mjs';
import { loadAgentRegistry as realLoadAgentRegistry } from '../agent-registry.mjs';

/**
 * Pure: a stored workflow template → the catalog shape. `tpl.steps` is already
 * Array<Array<{id,key}>> (outer = ordered step groups, inner = parallel nodes,
 * workflows.mjs:93-111 / :208-220), so this is a straight map against the agent
 * registry for display names; unknown keys fall back to the key itself.
 */
export function shapeWorkflow(tpl, registry = {}) {
  const steps = Array.isArray(tpl.steps) ? tpl.steps : [];
  const feedbacks = Array.isArray(tpl.feedbacks) ? tpl.feedbacks : [];
  return {
    id: tpl.id,
    name: tpl.name,
    domain: typeof tpl.domain === 'string' && tpl.domain ? tpl.domain : 'general',
    origin: tpl.origin ?? null,
    steps: steps.map((group) => (Array.isArray(group) ? group : []).map((node) => {
      const meta = registry && node && registry[node.key] ? registry[node.key] : null;
      return {
        nodeId: node.id,
        key: node.key,
        displayName: meta && typeof meta.displayName === 'string' && meta.displayName ? meta.displayName : node.key,
        description: meta && typeof meta.description === 'string' ? meta.description : '',
      };
    })),
    feedbacks: feedbacks.map((f) => ({ id: f.id, from: f.from, to: f.to })),
  };
}

/**
 * @param {{listProjects?:Function, listWorkspaces?:Function, listWorkflows?:Function, defaultWorkflow?:object, loadAgentRegistry?:Function}} [deps]
 */
export function createCatalog({
  listProjects = realListProjects,
  listWorkspaces = realListWorkspaces,
  listWorkflows = realListWorkflows,
  defaultWorkflow = DEFAULT_WORKFLOW,
  loadAgentRegistry = realLoadAgentRegistry,
} = {}) {
  async function buildCatalog() {
    const [projects, workspaces, workflows] = await Promise.all([listProjects(), listWorkspaces(), listWorkflows()]);
    let registry = {};
    try { registry = loadAgentRegistry() || {}; } catch { registry = {}; }
    const templates = [defaultWorkflow, ...workflows.filter((t) => t && t.id !== defaultWorkflow.id)];
    return {
      projects: projects.map((p) => ({ key: p.key, name: p.name, path: p.path })),
      workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, projectKeys: [...(w.projectKeys || [])] })),
      workflows: templates.map((t) => shapeWorkflow(t, registry)),
    };
  }
  return { buildCatalog };
}

/** Bound to the real readers — what the server and the MCP child use. */
export const buildCatalog = createCatalog().buildCatalog;
