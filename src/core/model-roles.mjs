// The one resolver for model roles (plans/setup-assistant-design.md D3–D5). Imports neither the config module nor the
// settings cascade, so config, workflows and title can all import it without a cycle.
import { modelRolesSetting } from './settings.mjs';
import { MODEL_ENGINES } from './model-env.mjs';
import { effortOn } from '../shared/connections.mjs';
import { MODEL_ROLES, ROLE_LABELS, SLOT_ROLES, roleOf, roleOfJob, jobSlot } from '../shared/model-roles.mjs';

export { MODEL_ROLES, ROLE_LABELS, SLOT_ROLES, roleOf, roleOfJob, jobSlot };

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** `engine`'s pick for `role`, effort mapped to the nearest one the harness takes, or null when unset (D5: a harness
 *  without roles keeps today's fallbacks). `roles` is injectable for tests.
 *  @returns {{model:string, effort:(string|undefined), role:string, source:'role'}|null} */
export function resolveRoleModel(engine, role, { roles = modelRolesSetting() } = {}) {
  if (!MODEL_ENGINES.includes(engine) || !MODEL_ROLES.includes(role)) return null;
  const forEngine = isObj(roles) ? roles[engine] : null;
  const pick = isObj(forEngine) ? forEngine[role] : null;
  const model = isObj(pick) && typeof pick.model === 'string' ? pick.model.trim() : '';
  if (!model) return null;
  const effort = typeof pick.effort === 'string' && pick.effort ? (effortOn(pick.effort, engine) || undefined) : undefined;
  return { model, effort, role, source: 'role' };
}

/** The role pick for a slot key (A6: call sites name slots, only roleOf names roles). */
export function roleModelFor(engine, slot, deps = {}) {
  const role = roleOf(slot);
  return role ? resolveRoleModel(engine, role, deps) : null;
}

/** `pair` when it names a model (the slot's own setting wins, D3), else the role of `slot` on `engine`, else `pair`.
 *  @param {{model?:string|null, effort?:string|null}|null|undefined} pair @param {string} engine @param {string} slot */
export function withRole(pair, engine, slot, deps = {}) {
  if (pair && typeof pair.model === 'string' && pair.model.trim()) return pair;
  return roleModelFor(engine, slot, deps) || pair;
}

/** Workspace scan's stored pick, or the defaults with the quick role as the scan model when nothing is stored.
 *  The sub-agent alias (agentModel/agentEffort) keeps its default. */
export function withScanRole(stored, defaults, deps = {}) {
  if (stored) return stored;
  const role = roleModelFor('claude', 'workspaceScan', deps);
  return role ? { ...defaults, scanModel: role.model, ...(role.effort ? { scanEffort: role.effort } : {}) } : null;
}
