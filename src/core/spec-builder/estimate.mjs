// src/core/spec-builder/estimate.mjs
// The Spec Builder estimate (plans/spec-builder D7, §3.4): deterministic, no model call. The stages are the
// recipe Auto runs for this front-matter (RECIPE_SHAPES; the Auto guard enforces the same pick); each stage
// is priced from this machine's finished runs (stats.mjs stepCostHistory) or, with fewer than MIN_SAMPLES,
// from list prices × a typical token count ("rough"). When the Auto cost policy lands, run the shape through
// applyCostPolicy here so the two agree — until then a stage's model is the recipe's (none: the run default).
import { RECIPE_SHAPES } from '../auto/recipes.mjs';
import { DEFAULT_MAX_CYCLES } from '../../shared/graph/constants.mjs';
import { listPriceFor } from '../list-prices.mjs';

export const MIN_SAMPLES = 3;
/** Priced when a stage has no model of its own and none is given (the classifier's own default family). */
export const ROUGH_PRICE_MODEL = 'claude-sonnet-5';
/** A verifier that sends work back re-runs the implementer and itself, up to DEFAULT_MAX_CYCLES. */
const VERIFIER_LOOP = new Set(['implementer', 'reviewer', 'manualWebUiTesting']);
/** Typical tokens + wall time of one execution, for rough pricing. Hand-tuned; refresh from real runs. */
export const TYPICAL_STAGE = Object.freeze({
  refiner: Object.freeze({ input: 40_000, cacheRead: 600_000, output: 20_000, ms: 6 * 60_000 }),
  implementer: Object.freeze({ input: 80_000, cacheRead: 3_000_000, output: 60_000, ms: 20 * 60_000 }),
  reviewer: Object.freeze({ input: 50_000, cacheRead: 900_000, output: 15_000, ms: 6 * 60_000 }),
  manualTestsChecklist: Object.freeze({ input: 20_000, cacheRead: 200_000, output: 8_000, ms: 3 * 60_000 }),
  manualWebUiTesting: Object.freeze({ input: 60_000, cacheRead: 1_500_000, output: 20_000, ms: 15 * 60_000 }),
});
const TYPICAL_DEFAULT = Object.freeze({ input: 40_000, cacheRead: 500_000, output: 15_000, ms: 6 * 60_000 });

export function pickRecipe(fm) {
  const big = fm.size === 'large' || (fm.signals || []).includes('risky');
  const web = (fm.roles || []).includes('ux');
  if (big) return web ? 'plan-complete-large+web' : 'plan-complete-large';
  return web ? 'plan-complete-detailed+web' : 'plan-complete-detailed';
}

/** The flat stage list of a recipe (parallel groups expanded). */
export function recipeStages(id) {
  const r = RECIPE_SHAPES.find((x) => x.id === id);
  if (!r) throw new Error(`unknown recipe ${id}`);
  return r.shape.stages.flatMap((s) => (Array.isArray(s.parallel) ? s.parallel : [s]));
}

/** Linear-interpolated quantile of a COPY of `values`; 0 for none. */
export function quantile(values, q) {
  const s = [...(values || [])].filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return 0;
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

const round2 = (n) => Math.round(n * 100) / 100;
const loopsOf = (st) => (st.selfLoop || VERIFIER_LOOP.has(st.agent) ? DEFAULT_MAX_CYCLES : 1);
function roughCost(model, t) {
  const p = listPriceFor(model) || listPriceFor(ROUGH_PRICE_MODEL);
  return (t.input * p.input + t.cacheRead * p.cacheRead + t.output * p.output) / 1e6;
}
const sum = (xs, k) => xs.reduce((a, s) => a + s[k], 0);

/**
 * @param {{size:string, signals?:string[], roles:string[]}} fm a VALIDATED worca: block
 * @param {{history?:Record<string,{costs:number[],ms:number[]}>, models?:Record<string,string>}} [opts]
 *   models: per-agent model ids, `default` for the rest (omitted: the run default, priced as ROUGH_PRICE_MODEL)
 */
export function estimateSpec(fm, { history = {}, models = {} } = {}) {
  const recipe = pickRecipe(fm);
  const stages = recipeStages(recipe).map((st) => {
    const phase = st.agent;
    const model = st.model || models[phase] || models.default || null;
    const loops = loopsOf(st);
    const h = history[phase];
    const n = h ? Math.min(h.costs.length, h.ms.length) : 0;
    if (n >= MIN_SAMPLES) {
      const runs = Number.isInteger(h.runs) ? h.runs : n;   // tests may pass bare {costs, ms}
      return { phase, model, effort: st.effort || null, loops, n, runs, basis: 'history',
        low: round2(quantile(h.costs, 0.5)), high: round2(quantile(h.costs, 0.9) * loops),
        ms: Math.round(quantile(h.ms, 0.5)), msHigh: Math.round(quantile(h.ms, 0.9) * loops) };
    }
    const t = TYPICAL_STAGE[phase] || TYPICAL_DEFAULT;
    const c = round2(roughCost(model, t));
    return { phase, model, effort: st.effort || null, loops, n, runs: 0, basis: 'rough',
      low: c, high: round2(c * 2 * loops), ms: t.ms, msHigh: t.ms * 2 * loops };
  });
  const hist = stages.filter((s) => s.basis === 'history');
  return {
    recipe, stages,
    low: round2(sum(stages, 'low')), high: round2(sum(stages, 'high')),
    ms: sum(stages, 'ms'), msHigh: sum(stages, 'msHigh'),
    basis: hist.length === stages.length ? 'history' : hist.length ? 'mixed' : 'rough',
    samples: hist.length ? Math.min(...hist.map((s) => s.runs)) : 0,
  };
}
