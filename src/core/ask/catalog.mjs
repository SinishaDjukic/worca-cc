// src/core/ask/catalog.mjs
// The static catalog the assistant sees (ask-worca-design.md §6.1, D9): projects,
// workspaces and workflows with their ordered step groups. ONE builder feeds both
// the system prompt (prompt.mjs renders a subset) and the list_projects /
// list_workflows tools (tools.mjs returns the objects) — never two readers.
// Readers are injected so unit tests run without a DB.
import { listProjects as realListProjects } from '../projects.mjs';
import { listWorkspaces as realListWorkspaces } from '../workspaces.mjs';
import { listWorkflows as realListWorkflows, GRAPH_DEFAULT_WORKFLOW } from '../workflows.mjs';
import { classifyLoops } from '../../shared/graph/loops.mjs';
import { rankNodes } from '../../shared/graph/layout.mjs';
import { registryPortsFn } from '../graph/registry-ports.mjs';

/** A v2 graph -> the v1-shaped step groups the assistant already understands:
 *  one group per rank (loop wires excluded), agent nodes only. */
function graphSteps(tpl, portsFn) {
  const ranks = rankNodes(tpl, classifyLoops(tpl, portsFn));
  const byRank = new Map();
  for (const node of tpl.nodes) {
    // buildCatalog maps EVERY template, so one malformed node used to take down
    // the whole Ask system prompt and list_workflows, not just its own row.
    if (!node || node.kind !== 'agent') continue;
    const r = ranks[node.id] ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(node);
  }
  return [...byRank.keys()].sort((a, b) => a - b).map((r) => byRank.get(r));
}
import { loadAgentRegistry as realLoadAgentRegistry } from '../agent-registry.mjs';
import { agentVocabulary } from '../auto/classify.mjs';

/** The agents a hand-authored shape may place (spec §8.5): the classifier's vocabulary, one compact record each.
 *  selfLoop mirrors the assembler's BAD_SELF_LOOP rule EXACTLY (assemble.mjs:349,:363-367): the agent's FIRST
 *  `when:'blocking'` output exists and one of its `loop` inputs accepts that type (equal, or the input is `any`).
 *  Read from the registry's port objects, not the card's summary strings. */
export function shapeAgents(registry) {
  const loops = (m) => {
    const outs = Array.isArray(m?.outputs) ? m.outputs : [];
    const blocking = outs.find((o) => o && o.when === 'blocking') || null;
    if (!blocking) return false;
    const ins = Array.isArray(m?.inputs) ? m.inputs.filter((p) => p && p.loop) : [];
    return ins.some((i) => i.type === 'any' || i.type === blocking.type);
  };
  return agentVocabulary(registry, { domain: 'coding' })
    .map((c) => ({
      key: c.key, displayName: c.displayName, purpose: c.purpose, inputs: c.inputs, outputs: c.outputs,
      verifier: c.verifier, clarifier: c.clarifier, selfLoop: loops(registry[c.key]), fanOut: c.fanOut, asksQuestions: c.asksQuestions,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Pure: a stored workflow template → the catalog shape. `tpl.steps` is already
 * Array<Array<{id,key}>> (outer = ordered step groups, inner = parallel nodes,
 * workflows.mjs:93-111 / :208-220), so this is a straight map against the agent
 * registry for display names; unknown keys fall back to the key itself.
 */
export function shapeWorkflow(tpl, registry = {}) {
  if (tpl && tpl.version === 2 && Array.isArray(tpl.nodes)) {
    const portsFn = registryPortsFn(registry);
    const groups = graphSteps(tpl, portsFn);
    const { loopWireIds } = classifyLoops(tpl, portsFn);
    return {
      id: tpl.id,
      name: tpl.name,
      domain: typeof tpl.domain === 'string' && tpl.domain ? tpl.domain : 'general',
      origin: tpl.origin ?? null,
      steps: groups.map((group) => group.map((node) => {
        const meta = registry && registry[node.key] ? registry[node.key] : null;
        return {
          nodeId: node.id,
          key: node.key,
          displayName: meta && meta.displayName ? meta.displayName : node.key,
          description: meta && typeof meta.description === 'string' ? meta.description : '',
        };
      })),
      feedbacks: (tpl.wires || []).filter((w) => w && loopWireIds.has(w.id))
        .map((w) => ({ id: w.id, from: w.from.node, to: w.to.node })),
    };
  }
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
  defaultWorkflow = GRAPH_DEFAULT_WORKFLOW,
  loadAgentRegistry = realLoadAgentRegistry,
} = {}) {
  async function buildCatalog() {
    const [projects, workspaces, workflows] = await Promise.all([listProjects(), listWorkspaces(), listWorkflows()]);
    let registry = {};
    try { registry = loadAgentRegistry() || {}; } catch { registry = {}; }
    // Same order as GET /api/workflows: the graph default, then saved rows.
    // shapeWorkflow already derives `steps` (condensation-topo ranks) +
    // `feedbacks` (loop wires) for a v2 template, so the LLM-facing shape is unchanged.
    const templates = [
      defaultWorkflow,
      ...workflows.filter((t) => t && t.id !== defaultWorkflow.id),
    ];
    return {
      projects: projects.map((p) => ({ key: p.key, name: p.name, path: p.path })),
      workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, projectKeys: [...(w.projectKeys || [])] })),
      workflows: templates.map((t) => shapeWorkflow(t, registry)),
      agents: shapeAgents(registry),
    };
  }
  return { buildCatalog };
}

/** Bound to the real readers — what the server and the MCP child use. */
export const buildCatalog = createCatalog().buildCatalog;
