// src/core/requirements/model-choice.mjs
// The harness, model and effort of a feature (plans/requirements-9c-design.md D2, D3, D4, D7, D10, D13, D18): the default
// for a new feature, a feature's stored choice, validation of a pick, and the switch. Every reader is injectable through
// `d` (defaults are the real ones), so tests never touch real settings or engines.
import { tx } from '../db.mjs';
import { dd, featureModel, scopeOf, defaultChoice, briefDefault, recommendedModel, checkChoice } from './feature-model.mjs';
export { featureModel, scopeOf, defaultChoice, briefDefault, recommendedModel, checkChoice };
import { editable } from './edits.mjs';
import { RequirementsError } from './spec.mjs';
import { isStarting, STARTING_MESSAGE } from './starting.mjs';
import { requireFeature, updateFeature, appendTurn } from './store.mjs';

/** D3: switch a feature's harness, model and effort, as a `model` turn. Callers validate the pick with checkChoice first (the API route does). Refused while busy, archived or starting. */
export async function setFeatureModel(seq, choice, { by = null } = {}, d = {}) {
  const x = dd(d);
  const f = editable(seq);
  if (isStarting(seq)) throw new RequirementsError('BUSY', STARTING_MESSAGE);
  const { notice: _n, ...from } = await featureModel(f, x);
  const to = { engine: choice.engine, model: choice.model, effort: choice.effort ?? null };
  editable(seq);   // nothing is awaited between this re-check and the write
  const out = tx(() => {
    appendTurn(seq, { kind: 'model', payload: { ...to, from } }, { by });
    return updateFeature(seq, { model: to }, { by });
  });
  if (typeof x.afterSwitch === 'function') await x.afterSwitch(seq, to.engine);
  return out;
}
