// src/core/requirements/model-choice.mjs
// The harness, model and effort of a feature (plans/requirements-9c-design.md D2, D3, D4, D7, D10, D13, D18): the default
// for a new feature, a feature's stored choice, validation of a pick, and the switch. Every reader is injectable through
// `d` (defaults are the real ones), so tests never touch real settings or engines.
import { createAskModels } from '../ask/models.mjs';
import { resolveRunEngine } from '../settings-cascade.mjs';
import { roleModelFor, resolveRoleModel } from '../model-roles.mjs';
import { engineReadiness } from '../engines/readiness.mjs';
import { requirementsEngines, notReadyWords, noRepoStartsOn, capabilities } from '../helper-call/profiles.mjs';
import { runsOn, effortsOn } from '../../shared/connections.mjs';
import { engineLabel } from '../../shared/engine-switch.mjs';
import { tx } from '../db.mjs';
import { interviewModel } from './interview.mjs';
import { editable } from './edits.mjs';
import { RequirementsError } from './spec.mjs';
import { isStarting, STARTING_MESSAGE } from './starting.mjs';
import { requireFeature, updateFeature, appendTurn } from './store.mjs';

const real = createAskModels();
const DEFAULTS = Object.freeze({
  resolveEngine: (scope) => resolveRunEngine(scope),
  engines: () => requirementsEngines(),
  readiness: () => engineReadiness(),
  roleModel: (engine, slot) => roleModelFor(engine, slot),
  resolveRole: (engine, role) => resolveRoleModel(engine, role),
  catalog: () => real.askCatalog({ withSecrets: false }),
  validate: (model, effort, o) => real.validateModelEffort(model, effort, o),
  interviewModel,
});
const dd = (d) => ({ ...DEFAULTS, ...d });

/** The scope a feature's settings read at: a project key, or the workspace layer. */
export function scopeOf(f) {
  return f.scopeType === 'workspace' ? { workspace: true } : { projectKey: f.scopeKey };
}

const claudePair = async (x) => {
  const m = await x.interviewModel(x);
  return { engine: 'claude', model: m.model ?? null, effort: m.effort ?? null };
};

/** Why the default engine cannot start a feature (null when it can), as the D4 sentence. */
async function unreadyReason(engine, x) {
  if (!x.engines().includes(engine)) {
    return engine === 'cursor' ? notReadyWords('cursor', '').startsOn : notReadyWords(engine, 'cannot run Requirements').startsOn;
  }
  if (engine === 'claude') return null;
  let list = [];
  try { list = (await x.readiness()) || []; } catch { list = []; }
  const r = list.find((e) => e.name === engine);
  if (r && (r.broker || !r.ready)) return notReadyWords(engine, r.reason, { broker: !!r.broker }).startsOn;
  return null;
}

/** The engine's own starting pick: the interview role model when the catalog runs it there, else the catalog default. */
async function engineDefault(engine, x) {
  if (engine === 'claude') return claudePair(x);
  let cat = null;
  try { cat = await x.catalog(); } catch { cat = null; }
  const role = x.roleModel(engine, 'requirementsInterview')?.model;
  const hit = role && cat && (cat.models || []).find((m) => m.id.toLowerCase() === String(role).toLowerCase() && runsOn(m, engine));
  const model = hit ? hit.id : cat?.defaults?.[engine]?.model ?? null;
  return { engine, model, effort: null };
}

/** D4: the New feature form's pick: the project's/workspace's Default engine, or Claude with the reason why. */
export async function defaultChoice(scope, d = {}) {
  const x = dd(d);
  const { engine } = x.resolveEngine(scope);
  const reason = await unreadyReason(engine, x);
  if (reason) return { choice: await claudePair(x), fallbackReason: reason };
  return { choice: await engineDefault(engine, x), fallbackReason: null };
}

/** D18: like defaultChoice, but only a harness that reads the repo makes a Product brief. */
export async function briefDefault(scope, d = {}) {
  const x = dd(d);
  const { engine } = x.resolveEngine(scope);
  const reason = await unreadyReason(engine, x);
  if (reason) return { choice: await claudePair(x), fallbackReason: reason };
  if (!capabilities(engine).repo) return { choice: await claudePair(x), fallbackReason: noRepoStartsOn(engine) };
  return { choice: await engineDefault(engine, x), fallbackReason: null };
}

/** The harness's recommended (deep) model, or null. */
export function recommendedModel(engine, d = {}) {
  return dd(d).resolveRole(engine, 'deep')?.model ?? null;
}

/** D2/D13: a feature's choice as it runs today. NULL = from before 9c (Claude, the A1.1 pair); a model that left the
 *  catalog = the engine's default + a notice; an effort the model no longer takes = no effort, no notice. */
export async function featureModel(f, d = {}) {
  const x = dd(d);
  if (!f.model) return { ...(await claudePair(x)), notice: null };
  const { engine, model, effort = null } = f.model;
  const r = await x.validate(model, effort ?? 'medium', { engine });
  if (r.ok) return { engine, model: r.model, effort, notice: null };
  if (/^effort /.test(r.error)) return { engine, model, effort: null, notice: null };
  return { ...(await engineDefault(engine, x)), notice: `${model} is no longer available, so this step used the default.` };
}

/** D3: is this pick offerable? */
export async function checkChoice({ engine, model, effort } = {}, d = {}) {
  const x = dd(d);
  if (engine === 'cursor') return { ok: false, error: "Cursor can't run Requirements." };
  if (!x.engines().includes(engine)) return { ok: false, error: `${engine ? engineLabel(engine) : 'That harness'} can't run Requirements.` };
  const cat = await x.catalog();
  const entry = (cat.models || []).find((m) => typeof model === 'string' && m.id.toLowerCase() === model.toLowerCase());
  if (!entry) return { ok: false, error: `unknown model "${String(model).slice(0, 80)}"` };
  if (!runsOn(entry, engine)) return { ok: false, error: `${entry.id} doesn't run on ${engineLabel(engine)}.` };
  const e = effort == null || effort === '' ? null : effort;
  if (e !== null && !effortsOn(entry, engine).includes(e) && !(engine === 'claude' && entry.efforts.includes(e))) {
    return { ok: false, error: `effort "${e}" is not available for model "${entry.id}"` };
  }
  return { ok: true, choice: { engine, model: entry.id, effort: e } };
}

/** D3: switch a feature's harness/model/effort, as a `model` turn. Refused while busy, archived or starting. */
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
