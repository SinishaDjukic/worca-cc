// src/core/model-guard.mjs — the premium-model guard (#1450). Pure decisions, no side effects: the harness pauses
// before a step that would run on a premium model nobody chose (preStepVerdict), the executor stops a step at its
// [init] line when Claude Code started a premium model nobody chose or another model than asked for (initVerdict), and
// POST /api/resume checks a `confirmModel` against the pause it answers (checkConfirmModel).
import { upstreamKey } from './model-roles.mjs';

/** Model sources (workflows.mjs modelSource) where nobody chose the model. A legacy `undefined` reads as null. */
export const UNCHOSEN_SOURCES = new Set(['worca-default', 'factory', 'auto', null]);

const unchosen = (source) => UNCHOSEN_SOURCES.has(source ?? null);
const isConfirmed = (confirmed, model) => Array.isArray(confirmed) && confirmed.includes(model);

/** An alias the CLI maps itself (opus, sonnet, haiku, fable) or any id without a dash: its [init] id never compares. */
export const isAlias = (id) => /^(opus|sonnet|haiku|fable)$/i.test(id) || !String(id).includes('-');

/**
 * Before a step spawns: pause iff its model is premium, nobody chose it, and the run has not confirmed it.
 * @param {{model?:string, source?:string|null, step:string, confirmed?:string[], premium:(id:string)=>boolean}} o
 * @returns {{ok:true}|{pause:true, model:string, detail:string}}
 */
export function preStepVerdict({ model, source, step, confirmed = [], premium }) {
  if (model && premium(model) && unchosen(source) && !isConfirmed(confirmed, model)) {
    return { pause: true, model, detail: `Paused before ${step}: it would run on ${model}, a premium model nobody chose.` };
  }
  return { ok: true };
}

/**
 * At the step's [init] line (the model Claude Code actually started).
 * @param {{requested?:string, init?:string, source?:string|null, step:string, confirmed?:string[],
 *   premium:(id:string)=>boolean, routed:(id:string)=>boolean}} o
 * @returns {{ok:true, note?:string}|{pause:true, model:string, detail:string}}
 */
export function initVerdict({ requested, init, source, step, confirmed = [], premium, routed }) {
  if (!init) return { ok: true };
  if (isConfirmed(confirmed, init)) return { ok: true };
  if (source === 'cli-decides') return premium(init) ? { ok: true, note: `Claude Code picked ${init} (premium).` } : { ok: true };
  if (!requested && premium(init)) {
    return { pause: true, model: init, detail: `Claude Code started ${step} on ${init}, a premium model nobody chose.` };
  }
  if (requested && !isAlias(requested) && !routed(requested) && upstreamKey(init) !== upstreamKey(requested)) {
    return { pause: true, model: init, detail: `${step} asked for ${requested} but Claude Code started ${init}.` };
  }
  if (premium(init) && unchosen(source)) {
    return { pause: true, model: init, detail: `Claude Code started ${step} on ${init}, a premium model nobody chose.` };
  }
  return { ok: true };
}

/**
 * POST /api/resume `confirmModel`: null when there is nothing to refuse, else `{ status, body }`. Checked before
 * anything is written. `resumePoint`: the paused run's resume point.
 */
export function checkConfirmModel(resumePoint, body) {
  const given = body && typeof body.confirmModel === 'string' ? body.confirmModel.trim() : '';
  if (!given) return null;
  const pending = resumePoint && resumePoint.pauseReason === 'model_confirm' && resumePoint.modelConfirm ? resumePoint.modelConfirm : null;
  if (!pending) return { status: 409, body: { code: 'confirm-not-pending', error: 'This run is not waiting for a model confirmation.' } };
  if (typeof body.model === 'string' && body.model.trim()) {
    return { status: 400, body: { code: 'confirm-and-switch', error: 'Confirm the model or switch it, not both.' } };
  }
  if (given !== pending.model) {
    return { status: 400, body: { code: 'confirm-mismatch', error: `The run is waiting to confirm ${pending.model}, not ${given}.` } };
  }
  return null;
}
