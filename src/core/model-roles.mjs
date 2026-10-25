// The one resolver for model roles (plans/setup-assistant-design.md D3–D5). Imports neither the config module nor the
// settings cascade, so config, workflows and title can all import it without a cycle.
import { modelRolesSetting } from './settings.mjs';
import { MODEL_ENGINES } from './model-env.mjs';
import { effortOn } from '../shared/connections.mjs';
import { MODEL_ROLES, ROLE_LABELS, SLOT_ROLES, roleOf, roleOfJob, jobSlot } from '../shared/model-roles.mjs';

export { MODEL_ROLES, ROLE_LABELS, SLOT_ROLES, roleOf, roleOfJob, jobSlot };

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// The harnesses that run a catalog id, or null for an id no catalog layer knows. config.mjs registers the SAME
// synchronous reader the slot cascade uses (setCascadeModelOwnerReader → enginesOfModel: no listModels, no
// async), so a role costs what a slot pick already costs. Not imported here: config.mjs imports this module.
let roleOwnerReader = null;
export function setRoleModelOwnerReader(fn) { roleOwnerReader = typeof fn === 'function' ? fn : null; }

/** `engine`'s pick for `role`, effort mapped to the nearest one the harness takes, or null when unset (D5: a harness
 *  without roles keeps today's fallbacks) or when its model is not in the catalog / not runnable on `engine` (a failed
 *  import after setup saved the role): the slot then falls back as for an empty role (D3). `roles` and `owners`
 *  are injectable for tests (`owners: null` skips the catalog check).
 *  @returns {{model:string, effort:(string|undefined), role:string, source:'role'}|null} */
export function resolveRoleModel(engine, role, { roles = modelRolesSetting(), owners = roleOwnerReader } = {}) {
  if (!MODEL_ENGINES.includes(engine) || !MODEL_ROLES.includes(role)) return null;
  const forEngine = isObj(roles) ? roles[engine] : null;
  const pick = isObj(forEngine) ? forEngine[role] : null;
  const model = isObj(pick) && typeof pick.model === 'string' ? pick.model.trim() : '';
  if (!model) return null;
  if (owners) {
    let harnesses = null;
    try { harnesses = owners(model); } catch { harnesses = null; }
    if (!Array.isArray(harnesses) || !harnesses.includes(engine)) return null;
  }
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

/** What a role shows when no source on this machine serves the team's model (D13, AC-5.3). */
export const NO_SOURCE_LINE = 'None of your sources offer it.';

/** The comparable form of an upstream model id: claude-opus-5.5, anthropic/claude-opus-5.5 and claude-opus-5-5 are one model. */
export function upstreamKey(id) {
  return String(id ?? '').trim().toLowerCase()
    .replace(/^[a-z0-9._-]+\//, '')     // vendor prefix (OpenRouter anthropic/…)
    .replace(/\[1m\]$/, '')
    .replace(/-\d{8}$/, '')             // dated snapshot
    .replace(/\./g, '-');
}

// Lower ranks win (D13's order): the harness sign-in, a Copilot import, an API-key / OpenRouter entry; a sign-in
// whose state is unknown last, so a probe gap never beats a source that is known to work.
const SOURCE_RANK = Object.freeze({ copilot: 1, openai: 2, anthropic: 2 });
const runsOnEngine = (r, engine) => (Array.isArray(r.harnesses) ? r.harnesses.includes(engine) : (r.engine || 'claude') === engine);
// Only a harness built-in (no `custom`) or the person's own entry (`custom: 'global'`, config.mjs listModels) may
// serve a team role. Policy, plugin and project rows are excluded: a team artifact must never pick a source it added.
const ownRow = (r) => !r.custom || r.custom === 'global';

/**
 * D13: the catalog entry that serves `upstream` on `engine` here, or why none does. Pure: `catalog` is listModels()
 * rows (bridged rows carry `bridged`, `upstreamModel`, `needsSignIn`), `claudeAuth` probeClaudeAuth().state.
 * @returns {{id:string, source:string}|{id:null, line:string}}
 */
export function mapUpstreamModel(upstream, engine, { catalog = [], claudeAuth = 'unknown' } = {}) {
  const want = upstreamKey(upstream);
  let best = null;
  for (const r of Array.isArray(catalog) ? catalog : []) {
    if (!r || typeof r.id !== 'string' || !want || !ownRow(r) || !runsOnEngine(r, engine)) continue;
    let rank = -1; let source = null;
    if (r.bridged) {
      if (!r.needsSignIn && upstreamKey(r.upstreamModel) === want) { rank = SOURCE_RANK[r.bridged] ?? 3; source = r.bridged; }
    } else if (!r.custom && upstreamKey(r.id) === want) {
      // A harness built-in (config.mjs PREDEFINED_MODELS / CODEX_BUILTIN_MODELS): served by that harness's own sign-in.
      const state = engine === 'claude' ? claudeAuth : 'signed-in';
      rank = state === 'signed-in' ? 0 : state === 'unknown' ? 4 : -1; source = 'signin';
    }
    if (rank >= 0 && (!best || rank < best.rank)) best = { id: r.id, source, rank };
  }
  return best ? { id: best.id, source: best.source } : { id: null, line: NO_SOURCE_LINE };
}

/**
 * D17: the upstream name a catalog id is shared as: the harness built-in id it stands for, or null. A Copilot or
 * OpenRouter entry for a built-in model shares the built-in id. A custom or unknown id is never shared (T24): it would
 * name a source of this machine and serve nobody else.
 */
export function shareUpstream(id, catalog = []) {
  const rows = Array.isArray(catalog) ? catalog : [];
  const row = rows.find((r) => r?.id === id);
  if (!row) return null;
  const raw = row.upstreamModel || id;
  const builtin = rows.find((r) => r && !r.bridged && !r.custom && upstreamKey(r.id) === upstreamKey(raw));
  return builtin ? builtin.id : null;
}

/**
 * D15: the roles runs on one project use for `engine`. `team` is the project's `models.roles` entry from
 * fieldsForRun ({ kind, value }) or null. Default: the person's own role wins. Soft: the team's does. A team role no
 * source serves is left out (the person's role or today's fallback applies) and listed in `unmapped`.
 */
export function projectRoles(engine, { user = {}, team = null, catalog = [], claudeAuth = 'unknown' } = {}) {
  const mine = isObj(user?.[engine]) ? user[engine] : {};
  const theirs = isObj(team?.value?.[engine]) ? team.value[engine] : {};
  const out = { ...mine }; const unmapped = [];
  for (const role of MODEL_ROLES) {
    const pick = theirs[role];
    if (!isObj(pick) || typeof pick.model !== 'string') continue;
    if (team.kind !== 'soft' && isObj(mine[role]) && typeof mine[role].model === 'string' && mine[role].model.trim()) continue;
    const hit = mapUpstreamModel(pick.model, engine, { catalog, claudeAuth });
    if (!hit.id) { unmapped.push({ role, upstream: pick.model, line: hit.line }); continue; }
    out[role] = { model: hit.id, ...(pick.effort ? { effort: pick.effort } : {}) };
  }
  return { roles: { ...(isObj(user) ? user : {}), [engine]: out }, unmapped };
}
