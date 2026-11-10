// src/core/requirements/feature-model.mjs — a feature's harness, model and effort as a step reads it (9c D2, D13), plus the
// helpers the default pick shares. Split out of model-choice.mjs so interview.mjs can use it without an import cycle.
import { createAskModels } from '../ask/models.mjs';
import { resolveRunEngine } from '../settings-cascade.mjs';
import { roleModelFor, resolveRoleModel } from '../model-roles.mjs';
import { engineReadiness } from '../engines/readiness.mjs';
import { requirementsEngines } from '../helper-call/profiles.mjs';
import { runsOn } from '../../shared/connections.mjs';
import { interviewModel } from './interview-model.mjs';

const real = createAskModels();
export const DEFAULTS = Object.freeze({
  resolveEngine: (scope) => resolveRunEngine(scope),
  engines: () => requirementsEngines(),
  readiness: () => engineReadiness(),
  roleModel: (engine, slot) => roleModelFor(engine, slot),
  resolveRole: (engine, role) => resolveRoleModel(engine, role),
  catalog: () => real.askCatalog({ withSecrets: false }),
  validate: (model, effort, o) => real.validateModelEffort(model, effort, o),
  interviewModel,
});
export const dd = (d) => ({ ...DEFAULTS, ...d });

export const claudePair = async (x) => {
  const m = await x.interviewModel(x);
  return { engine: 'claude', model: m.model ?? null, effort: m.effort ?? null };
};

/** The engine's own starting pick: the interview role model when the catalog runs it there, else the catalog default. */
export async function engineDefault(engine, x) {
  if (engine === 'claude') return claudePair(x);
  let cat = null;
  try { cat = await x.catalog(); } catch { cat = null; }
  const role = x.roleModel(engine, 'requirementsInterview')?.model;
  const hit = role && cat && (cat.models || []).find((m) => m.id.toLowerCase() === String(role).toLowerCase() && runsOn(m, engine));
  const model = hit ? hit.id : cat?.defaults?.[engine]?.model ?? null;
  return { engine, model, effort: null };
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
  // Only a model missing from an engine that IS available is removed; an unavailable engine's models are not listed at all,
  // so the stored pick stays and the step stops with D13's not-ready error.
  let cat = null;
  try { cat = await x.catalog(); } catch { cat = null; }
  const available = engine === 'claude' || !cat || (cat.models || []).some((m) => runsOn(m, engine));
  if (!available) return { engine, model, effort, notice: null };
  const def = await engineDefault(engine, x);
  if (!def.model) return { engine, model, effort, notice: null };
  return { ...def, notice: `${model} is no longer available, so this step used the default.` };
}

