// src/core/memory-defrag-model.mjs
// Settings › Memory: which model (and effort) a Memory defragment run's agent uses. Pure
// functions — the callers read the setting (settings.mjs#memoryDefragModel) and the catalog
// (config.mjs#listModels) and hand them in, so this module imports nothing but the built-in
// workflow constant.
//
// Precedence, resolved ONCE at run start (orchestrator.mjs _defragAgentPair):
//   1. a pair named explicitly at start — the run's `claude.model` (+ `claude.effort`): the CLI's
//      --model (verbatim, like --model everywhere), a CLI-made schedule's stored model, or the
//      `model`/`effort` of a POST /api/run body starting a defragment run (checkStartPair).
//   2. the stored setting, validated against the run's project catalog.
//   3. nothing: the node layers resolve exactly as before (a project's own node pick, a team
//      default, then the built-in template's model).
// The pair rule holds throughout: an effort travels with its model, so an effort without a model
// is ignored and no lower layer's effort ever rides under a model it was not chosen for.

import { GRAPH_MEMORY_DEFRAG_WORKFLOW } from './graph/builtin-workflows.mjs';

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * @param {{explicit?:{model?:string, effort?:string}, stored?:{model?:string|null, effort?:string|null},
 *   models?:Array<{id:string, efforts?:string[]}>}} o `models` = the catalog the run resolves against
 * @returns {{model:string|null, effort:string|null, source:'explicit'|'setting'|'default', warning:string|null}}
 *   `model: null` = no pair (today's resolution). `warning` = a stored setting that did not survive
 *   the catalog check — the run degrades, it is never refused. It names the problem only: the
 *   caller appends what the run uses instead (agentPairText, once the graph is resolved).
 */
export function resolveDefragModel({ explicit = {}, stored = {}, models = [] } = {}) {
  const exModel = str(explicit && explicit.model);
  if (exModel) return { model: exModel, effort: str(explicit.effort), source: 'explicit', warning: null };
  const model = str(stored && stored.model);
  if (!model) return { model: null, effort: null, source: 'default', warning: null };
  const hit = (Array.isArray(models) ? models : [])
    .find((m) => m && typeof m.id === 'string' && m.id.toLowerCase() === model.toLowerCase());
  if (!hit) {
    return {
      model: null, effort: null, source: 'default',
      warning: `Memory defragment model "${model}" (Settings › Memory) is not in this project's model catalog`,
    };
  }
  const effort = str(stored.effort);
  if (effort && !(Array.isArray(hit.efforts) && hit.efforts.includes(effort))) {
    return {
      model: hit.id, effort: null, source: 'setting',
      warning: `Memory defragment effort "${effort}" (Settings › Memory) is not offered by ${hit.id}`,
    };
  }
  return { model: hit.id, effort, source: 'setting', warning: null };
}

/**
 * The tail of a degrade warning — what the run's agent nodes resolved to INSTEAD (a project's own
 * pick, a team default or the template's model), so the log never claims a fallback the run did
 * not take: `claude-fable-5-1 · max`, `claude-sonnet-5 at its default effort`.
 * @param {Record<string, {kind?:string, model?:string, effort?:string}>} nodes resolveGraph's per-node table
 */
export function agentPairText(nodes) {
  const seen = [];
  for (const nc of Object.values(nodes && typeof nodes === 'object' ? nodes : {})) {
    if (!nc || nc.kind !== 'agent') continue;
    const text = nc.model ? `${nc.model}${nc.effort ? ` · ${nc.effort}` : ' at its default effort'}` : 'the CLI default model';
    if (!seen.includes(text)) seen.push(text);
  }
  return seen.join(', ') || 'the CLI default model';
}

/**
 * POST /api/run: the pair a defragment run names AT START (`body.model` / `body.effort`) — tier 1,
 * above the setting. Checked against the run's project catalog like any model a user picks: the id
 * comes back in the catalog's casing and the effort must be one the entry offers; an effort without
 * a model is refused (it would mean nothing). `models: null` skips the catalog check — a scheduled
 * ticket firing, whose request was checked when it was scheduled (then taken verbatim, like --model).
 * @param {{model?:unknown, effort?:unknown}} body
 * @param {Array<{id:string, efforts?:string[]}>|null} models
 * @returns {{pair: ({model:string, effort:(string|null)}|null)} | {error: string}}
 */
export function checkStartPair({ model, effort } = {}, models = null) {
  const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
  if (blank(model)) return blank(effort) ? { pair: null } : { error: 'effort needs a model — an effort without a model means nothing' };
  if (typeof model !== 'string' || model.length > 200) return { error: 'model must be a catalog model id' };
  if (!blank(effort) && typeof effort !== 'string') return { error: 'effort must be a string' };
  let id = model.trim();
  const eff = blank(effort) ? null : effort.trim();
  if (Array.isArray(models)) {
    const hit = models.find((m) => m && typeof m.id === 'string' && m.id.toLowerCase() === id.toLowerCase());
    if (!hit) return { error: `unknown model "${id}"` };
    id = hit.id;
    if (eff && !(Array.isArray(hit.efforts) && hit.efforts.includes(eff))) return { error: `${id} does not offer effort "${eff}"` };
  }
  return { pair: { model: id, effort: eff } };
}

/** What "(default)" means in Settings › Memory: the built-in template's own agent model. */
export function defragDefaultModel() {
  const agent = GRAPH_MEMORY_DEFRAG_WORKFLOW.nodes.find((n) => n.kind === 'agent');
  return (agent && agent.config && typeof agent.config.model === 'string' && agent.config.model) || null;
}

/**
 * GET /api/workflows/wf_memory_defrag, as every start surface should show it: with a resolved
 * pair the template carries `pinnedAgentModel`, which node-tunables.mjs turns into LOCKED
 * model/effort rows (New pipeline's agent rows, an Ask card's lane) — the run uses the pair
 * whatever the project picked, so an editable model there would be a control that lies. The
 * deep-frozen constant is never mutated: a shallow copy gains one key.
 * @param {object} wf the workflow as assertRunnableWorkflow returned it
 * @param {{model:string|null, effort?:string|null}|null} pair resolveDefragModel's answer
 */
export function defragWorkflowView(wf, pair) {
  if (!wf || !pair || !str(pair.model)) return wf;
  return { ...wf, pinnedAgentModel: { model: str(pair.model), effort: str(pair.effort), source: 'settings' } };
}
