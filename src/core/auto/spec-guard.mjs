// src/core/auto/spec-guard.mjs
// The Spec Builder guard on the Auto classifier (plans/spec-builder D6; clarify "hint plus a guard"): the model
// decides; then a VALID `worca:` front-matter block corrects what it contradicts. size and the risky signal
// always follow the block. A COMPLETE spec (every role section present) is a plan of record: taskKind
// plan-complete-detailed, and when the model's stages plan again (clarify/planner/decomposer), skip Refine on
// large or risky work, or skip the web tests UX asked for, the stages become the recipe's. Specs without a
// block are returned untouched. Replaced stages carry the classifier's model picks (a recipe stage has none), and
// guardClassifiedShape re-checks the result so a guard never makes a runnable shape unrunnable.
import { parseWorcaFrontMatter } from '../../shared/spec-builder/front-matter.mjs';
import { missingSections } from '../../shared/spec-builder/roles.mjs';
import { pickRecipe } from '../spec-builder/estimate.mjs';
import { RECIPE_SHAPES, SPEC_PLANNING_AGENTS, SPEC_REFINE_AGENT, SPEC_WEB_AGENTS } from './recipes.mjs';
import { SHAPE_LIMITS, normalizeShape, ShapeError } from '../../shared/graph/assemble.mjs';

const PLANNING = new Set(SPEC_PLANNING_AGENTS);
const flatStages = (stages) => (stages || []).flatMap((s) => (Array.isArray(s.parallel) ? s.parallel : [s]));
const agentsOf = (stages) => flatStages(stages).map((s) => s.agent);

/** model/effort of a stage, raw (`model`) or normalized (`tunables.model`). */
const picksOf = (st) => {
  const t = { ...(st.tunables || {}), ...(typeof st.model === 'string' ? { model: st.model } : {}), ...(typeof st.effort === 'string' ? { effort: st.effort } : {}) };
  return t.model ? { model: t.model, ...(t.effort ? { effort: t.effort } : {}) } : null;
};

/** Recipe stages with the classifier's per-agent picks. An agent it staged keeps exactly that pick (none = the
 *  run default, as the classifier chose); an agent it did not stage takes its first model pick. */
function carryModels(recipeStages, modelStages) {
  const byAgent = new Map();
  for (const st of flatStages(modelStages)) if (!byAgent.has(st.agent)) byAgent.set(st.agent, picksOf(st));
  const first = [...byAgent.values()].find(Boolean) || null;
  const carry = (st) => { const p = byAgent.has(st.agent) ? byAgent.get(st.agent) : first; return p ? { ...st, ...p } : { ...st }; };
  return recipeStages.map((st) => (Array.isArray(st.parallel) ? { ...st, parallel: st.parallel.map(carry) } : carry(st)));
}

export function applySpecGuard(shape, taskText) {
  const parsed = parseWorcaFrontMatter(taskText);
  if (!parsed || !parsed.ok) return shape;
  const { fm, body } = parsed;
  const risky = (fm.signals || []).includes('risky');
  const signals = (risky ? ['risky', ...(shape.signals || []).filter((s) => s !== 'risky')] : [...(shape.signals || [])]).slice(0, SHAPE_LIMITS.maxSignals);
  let next = { ...shape, size: fm.size, signals };
  if (missingSections(body, fm.roles).length) return next;
  next.taskKind = 'plan-complete-detailed';
  const agents = agentsOf(next.stages);
  const big = fm.size === 'large' || risky;
  const contradicts = agents.some((a) => PLANNING.has(a))
    || (big && !agents.includes(SPEC_REFINE_AGENT))
    || (fm.roles.includes('ux') && !SPEC_WEB_AGENTS.every((a) => agents.includes(a)));
  if (contradicts) {
    const recipe = RECIPE_SHAPES.find((r) => r.id === pickRecipe(fm));
    next = { ...next, stages: carryModels(structuredClone(recipe.shape.stages), shape.stages) };
    delete next.loops;                        // the model's loops referenced its own stage ids
  }
  return next;
}

/**
 * The classify.mjs seam: guard a VALIDATED, normalized shape and re-check it like the model's reply.
 * @param {object} shape normalized
 * @param {{taskText:string, feedback?:string[], known:Set<string>, checkModels:(shape)=>Array<{message:string}>}} o
 *   checkModels: (s) => checkShapeModels(s, models, { requireModel }) — injected (classify.mjs owns it; no import cycle)
 * @returns {{shape:object, warning:null|{code:'SPEC_GUARD_SKIPPED', message:string}}}
 */
export function guardClassifiedShape(shape, { taskText, feedback = [], known, checkModels }) {
  if (Array.isArray(feedback) && feedback.length) return { shape, warning: null };   // revise round: the user's feedback wins
  const raw = applySpecGuard(shape, taskText);
  if (raw === shape) return { shape, warning: null };
  let guarded;
  try { guarded = normalizeShape(raw); } catch (e) {
    if (e instanceof ShapeError) return { shape, warning: { code: 'SPEC_GUARD_SKIPPED', message: `spec guard: ${e.issues.map((i) => i.message).join('; ')}` } };
    throw e;
  }
  const issues = [
    ...flatStages(guarded.stages).filter((s) => !known.has(s.agent)).map((s) => ({ message: `unknown agent "${s.agent}"` })),
    ...checkModels(guarded),
  ];
  if (issues.length) return { shape, warning: { code: 'SPEC_GUARD_SKIPPED', message: `spec guard: ${issues.map((i) => i.message).join('; ')}` } };
  return { shape: guarded, warning: null };
}
