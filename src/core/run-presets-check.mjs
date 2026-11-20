// src/core/run-presets-check.mjs — what stops a preset's setup from starting, named per item (#712 point 6),
// and the full-picks snapshot a preset stores. Never falls back: a gone guardrail set is an item, not Permissive, and a
// setup that names none is checked as what a start runs on, the install default (defaultGuardrailSetId).
import { checkRunOverlay } from './run-overlay.mjs';
import { nodeLabel } from '../shared/run-presets.mjs';

/**
 * @param {object} setup  PRESET_SETUP_KEYS of the body being started (or of the stored preset on pick)
 * @param {{ scope?: {kind:string, ref:string|null}, scopeExists?: (scope)=>Promise<boolean>|boolean,
 *   assertWorkflow: (id:string)=>Promise<object>, guardrailExists: (id:string)=>Promise<boolean>,
 *   models: object[], engine?: string, engineRefusal?: ()=>Promise<string|null>, defaultGuardrailsId: ()=>string }} ctx
 * @returns {Promise<{item:string, ref:string|null, message:string, reset:boolean}[]>}
 */
export async function presetRefusals(setup, ctx) {
  const out = [];
  const add = (item, ref, message, reset = true) => out.push({ item, ref, message, reset });
  const scope = ctx.scope || { kind: 'global', ref: null };
  if (scope.kind !== 'global' && !(await ctx.scopeExists(scope))) {
    add(scope.kind, scope.ref, `${scope.kind === 'project' ? 'Project' : 'Workspace'} ${scope.ref} is no longer registered in worca`, false);
  }
  let workflow = null;
  const wfId = setup.workflowId || 'wf_default';
  try { workflow = await ctx.assertWorkflow(wfId); } catch (e) {
    add('workflow', wfId, e && e.code === 'NOT_FOUND' ? `Workflow ${wfId} no longer exists` : `Workflow ${wfId}: ${e.message}`);
  }
  const gr = setup.guardrailsId || ctx.defaultGuardrailsId();
  if (!(await ctx.guardrailExists(gr))) add('guardrails', gr, `Guardrail set ${gr} no longer exists`);
  const nodes = setup.overlay?.nodes || {};
  const wires = setup.overlay?.wires || {};
  if (workflow && !workflow.auto) {
    const byId = new Map((workflow.nodes || []).filter((n) => n && n.kind === 'agent').map((n) => [n.id, n]));
    const catalog = new Set((ctx.models || []).map((m) => String(m.id).toLowerCase()));
    for (const [id, sel] of Object.entries(nodes)) {
      const node = byId.get(id);
      if (!node) { add('node', id, `${id}: no longer an agent of workflow ${workflow.id}`); continue; }
      const label = nodeLabel(node);
      if (typeof sel?.model === 'string' && sel.model && !catalog.has(sel.model.toLowerCase())) { add('model', id, `${label}: model ${sel.model} is no longer in the catalog`); continue; }
      const { errors } = checkRunOverlay({ [id]: sel }, { workflow, models: ctx.models, engine: ctx.engine || 'claude' });
      for (const e of errors) add('model', id, `${label}: ${e.replace(/^node "[^"]*":\s*/, '')}`);
    }
    const wireIds = new Set((workflow.wires || []).map((w) => w.id));
    for (const id of Object.keys(wires)) if (!wireIds.has(id)) add('loop', id, `Loop ${id}: no longer a loop of workflow ${workflow.id}`);
  }
  if (ctx.engineRefusal) {
    const why = await ctx.engineRefusal();
    if (why) add('engine', setup.engine || 'claude', `Engine ${setup.engine || 'claude'}: ${why}`);
  }
  return out;
}

/** Full picks (#712 Q&A): every agent node's effective values and every loop's budget, from the resolved graph. */
export function completeSnapshot(setup, resolved) {
  if (!resolved || (setup.workflowId || 'wf_default') === 'wf_auto') return setup;
  const nodes = {};
  for (const [id, n] of Object.entries(resolved.nodes || {})) {
    if (!n || n.kind !== 'agent') continue;
    const pick = { ...(setup.overlay?.nodes?.[id] || {}) };
    if (pick.model === undefined && typeof n.model === 'string' && n.model) { pick.model = n.model; pick.effort = n.effort || ''; }
    for (const k of ['fanOut', 'askQuestions']) if (pick[k] === undefined && typeof n[k] === 'boolean') pick[k] = n[k];
    if (pick.subagentModel === undefined && typeof n.subagentModel === 'string' && n.subagentModel) pick.subagentModel = n.subagentModel;
    nodes[id] = pick;
  }
  const wires = {};
  for (const [id, w] of Object.entries(resolved.wires || {})) wires[id] = { maxCycles: setup.overlay?.wires?.[id]?.maxCycles ?? w.maxCycles };
  return { ...setup, overlay: { ...(Object.keys(nodes).length ? { nodes } : {}), ...(Object.keys(wires).length ? { wires } : {}) } };
}
