// src/core/night/config.mjs
// Night mode settings: defaults, one validator shared by the user settings, the project
// prefs and the team policy reader, and the per-field precedence project > user > team.
//
// ZERO-IMPORT LEAF: settings.mjs, config.mjs and policy/registry.mjs import this module,
// and settings.mjs must import nothing from the core graph. All I/O lives in effective.mjs.

export const NIGHT_KINDS = Object.freeze(['clarify', 'questions', 'form', 'gate', 'workflow', 'recovery']);
export const NIGHT_STRATEGIES = Object.freeze(['weights', 'analysis', 'mixed']);
export const NIGHT_CRITERIA = Object.freeze(['matchesMemory', 'reversible', 'smallestScope', 'codebaseConventions', 'cost']);
export const NIGHT_TOGGLES = Object.freeze(['auto', 'on', 'off']);
export const NIGHT_ACTOR = 'night-mode';
/** The decider's effort levels: a copy of model-env.mjs EFFORTS (this leaf imports nothing;
 *  test/night-decider-model.test.mjs pins the two equal). */
export const NIGHT_EFFORTS = Object.freeze(['medium', 'high', 'xhigh', 'max']);
/** The effort the decider runs at when none is set (what it always ran at before). */
export const NIGHT_DEFAULT_EFFORT = 'medium';
const MODEL_ID_MAX_LEN = 200;   // settings.mjs TITLE_MODEL_MAX_LEN

export const NIGHT_DEFAULTS = Object.freeze({
  enabled: false, window: null, timeZone: null, graceMinutes: 30, strategy: 'mixed',
  minConfidence: 60, minMargin: 25,
  criteria: Object.freeze({ matchesMemory: 3, reversible: 3, smallestScope: 2, codebaseConventions: 2, cost: 1 }),
  neverDecide: Object.freeze([]), spendCapUsd: null, maxDecisions: 20,
  // 0: at a spent loop Away continues (flagged) like a --yes run instead of buying another round.
  maxExtraCycles: 0,
  allowCostCapOverride: false,
  // The nightDecider's model (a catalog id; null = the run's model) and effort (null = medium).
  // Shape only here: catalog membership is checked when the decider runs (night/decider-model.mjs).
  deciderModel: null, deciderEffort: null,
});
export const NIGHT_FIELDS = Object.freeze(Object.keys(NIGHT_DEFAULTS));

/** Must night mode leave this ask to the user? A form the clarifier or an agent asked with
 *  (`origin` 'clarify' | 'questions') follows that kind's entry as well as 'form'. */
export function nightNeverDecides(config, { kind, origin } = {}) {
  return config.neverDecide.includes(kind) || (kind === 'form' && origin != null && config.neverDecide.includes(origin));
}
/** Fields a project may NOT set: the spend cap is measured across all runs. */
const USER_TEAM_ONLY = new Set(['spendCapUsd']);
/** Fields where an explicit null is a meaningful "off". deciderModel / deciderEffort are NOT here:
 *  their null is only the default ("same as the run", medium), so a stored null never hides a team value. */
const NULLABLE = new Set(['window', 'timeZone', 'graceMinutes', 'spendCapUsd']);

const WINDOW_RE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function validTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** @returns {string|null} an error for ONE field value, null when valid */
export function fieldError(field, v) {
  if (v === null && NULLABLE.has(field)) return null;
  switch (field) {
    case 'enabled': case 'allowCostCapOverride': return typeof v === 'boolean' ? null : 'must be true or false';
    case 'window': return typeof v === 'string' && WINDOW_RE.test(v) && v.slice(0, 5) !== v.slice(6) ? null : 'window must be "HH:MM-HH:MM" (24 h) with different start and end';
    case 'timeZone': return typeof v === 'string' && validTimeZone(v) ? null : 'timeZone must be an IANA time zone';
    case 'graceMinutes': return intIn(v, 1, 1440) ? null : 'graceMinutes must be an integer 1-1440 or null';
    case 'strategy': return NIGHT_STRATEGIES.includes(v) ? null : `strategy must be one of ${NIGHT_STRATEGIES.join(' | ')}`;
    case 'minConfidence': case 'minMargin': return intIn(v, 0, 100) ? null : `${field} must be an integer 0-100`;
    case 'criteria':
      if (!isObj(v)) return 'criteria must be an object of criterion → weight';
      for (const [k, w] of Object.entries(v)) {
        if (!NIGHT_CRITERIA.includes(k)) return `criteria: unknown criterion "${k}"`;
        if (!(typeof w === 'number' && Number.isFinite(w) && w >= 0 && w <= 10)) return `criteria.${k} must be a number 0-10`;
      }
      return null;
    case 'neverDecide': return Array.isArray(v) && v.every((k) => NIGHT_KINDS.includes(k)) ? null : `neverDecide must list kinds from ${NIGHT_KINDS.join(', ')}`;
    case 'spendCapUsd': return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 10_000 ? null : 'spendCapUsd must be a positive number or null';
    case 'maxDecisions': return intIn(v, 1, 500) ? null : 'maxDecisions must be an integer 1-500';
    case 'maxExtraCycles': return intIn(v, 0, 10) ? null : 'maxExtraCycles must be an integer 0-10';
    case 'deciderModel': return typeof v === 'string' && v.trim() !== '' && v === v.trim() && v.length <= MODEL_ID_MAX_LEN
      ? null : `deciderModel must be a model id (at most ${MODEL_ID_MAX_LEN} characters, no surrounding spaces)`;
    case 'deciderEffort': return NIGHT_EFFORTS.includes(v) ? null : `deciderEffort must be one of ${NIGHT_EFFORTS.join(' | ')}`;
    default: return `unknown night mode field "${field}"`;
  }
}

/**
 * Validate a (partial) patch for storage. Throws a 400-style Error naming the field.
 * `level: 'project'` rejects user/team-only fields.
 * @returns {object} the clean patch (only known fields)
 */
export function validateNightPatch(input, { level = 'user' } = {}) {
  if (!isObj(input)) throw Object.assign(new Error('nightMode must be an object'), { status: 400 });
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (level === 'project' && USER_TEAM_ONLY.has(k)) throw Object.assign(new Error(`${k} is set per user, not per project (it spans all runs)`), { status: 400 });
    const err = fieldError(k, v);
    if (err) throw Object.assign(new Error(`nightMode.${k}: ${err}`), { status: 400 });
    out[k] = Array.isArray(v) ? [...new Set(v)] : isObj(v) ? { ...v } : v;
  }
  return out;
}

/** Drop invalid stored values (a hand-edited settings.json must never break a run). */
function cleanLayer(layer, level) {
  const out = {};
  if (!isObj(layer)) return out;
  for (const f of NIGHT_FIELDS) {
    if (layer[f] === undefined) continue;
    if (level === 'project' && USER_TEAM_ONLY.has(f)) continue;
    if (!fieldError(f, layer[f])) out[f] = layer[f];
  }
  return out;
}

/**
 * Per-field precedence: project > user > team > default.
 * @returns {{config: object, sources: Record<string,'project'|'user'|'team'|'default'>}}
 */
export function resolveNightConfig({ project = null, user = null, team = null } = {}) {
  const layers = [['project', cleanLayer(project, 'project')], ['user', cleanLayer(user, 'user')], ['team', cleanLayer(team, 'team')]];
  const config = {}; const sources = {};
  for (const f of NIGHT_FIELDS) {
    const hit = layers.find(([, l]) => l[f] !== undefined);
    config[f] = hit ? hit[1][f] : NIGHT_DEFAULTS[f];
    sources[f] = hit ? hit[0] : 'default';
  }
  config.criteria = { ...NIGHT_DEFAULTS.criteria, ...(config.criteria || {}) };
  config.neverDecide = [...config.neverDecide];
  return { config, sources };
}

/** The team layer from the cached policy's default-kind `night.*` fields. */
export function teamNightLayer(get) {
  const out = {};
  for (const f of NIGHT_FIELDS) { const v = get(`night.${f}`); if (v !== undefined) out[f] = v; }
  return out;
}
