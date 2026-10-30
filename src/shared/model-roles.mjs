// Model roles (plans/setup-assistant-design.md D1–D5): three kinds of work every model slot falls back to.
// Pure: shared by src/core (resolution) and ui/public (the Roles card and the Engines rows' "From …" text).
import { HELPER_ENGINE_NAMES } from './engine-switch.mjs';

export const MODEL_ROLES = Object.freeze(['deep', 'everyday', 'quick']);
export const ROLE_LABELS = Object.freeze({ deep: 'Deep thinking', everyday: 'Everyday coding', quick: 'Quick jobs' });
export const ROLE_HINTS = Object.freeze({
  deep: 'Plans and reviews. Worth the strongest model.',
  everyday: 'Writes the code and answers in Chat.',
  quick: 'Short, frequent helper calls. Cheap and fast.',
});
// The harnesses the Models page shows roles for: the helper engines (the catalog's helperSlots).
export const ROLE_HARNESSES = HELPER_ENGINE_NAMES;

// D4 judgement steps by agent key; "Bug Root Cause" ships only in plugins, so it is matched by its display name.
const DEEP_STEP_KEYS = new Set(['planner', 'planReviewer', 'refiner', 'reviewer', 'deckReviewer']);
const DEEP_STEP_NAMES = new Set(['plan', 'plan review', 'refine plan', 'review implementation', 'bug root cause', 'deck review']);
// D4 puts memoryDefrag under quick; its step is the defragment run's only agent.
const QUICK_STEP_KEYS = new Set(['memoryDefragmenter']);
// D4 by setting key. autoWorkflowModel (Claude's Auto classifier) is everyday; utilityModels.<engine>.* is quick.
export const SLOT_ROLES = Object.freeze({
  'nightMode.deciderModel': 'deep',
  askModels: 'everyday', agentGenModel: 'everyday', requirementsInterview: 'everyday', autoWorkflowModel: 'everyday',
  titleModel: 'quick', namingModel: 'quick', commandSummaryModel: 'quick', prDescriptionModel: 'quick',
  memoryDefrag: 'quick', workspaceScan: 'quick',
});

/** The role a slot falls back to, or null for a slot without one.
 *  `slot`: 'steps.<agentKey>', 'utilityModels.<job>' or a settings key from SLOT_ROLES.
 *  @param {string} slot @param {{name?: string}} [opts] the step's display name, for plugin judgement steps */
export function roleOf(slot, { name = '' } = {}) {
  const id = typeof slot === 'string' ? slot : '';
  if (id.startsWith('steps.')) {
    const key = id.slice('steps.'.length);
    if (DEEP_STEP_KEYS.has(key) || DEEP_STEP_NAMES.has(String(name || '').trim().toLowerCase())) return 'deep';
    return QUICK_STEP_KEYS.has(key) ? 'quick' : 'everyday';
  }
  if (id.startsWith('utilityModels.')) return 'quick';
  return Object.hasOwn(SLOT_ROLES, id) ? SLOT_ROLES[id] : null;
}

// Claude's helper jobs are stored under their own keys (settings-cascade.mjs CLAUDE_USER); Codex's under utilityModels.codex.
const CLAUDE_JOB_KEYS = Object.freeze({
  title: 'titleModel', classifier: 'autoWorkflowModel', prDescription: 'prDescriptionModel', memoryDefrag: 'memoryDefrag',
  workspaceScan: 'workspaceScan', overview: 'utilityModels.overview',
});
// Jobs with one key whatever the engine (user-only, Claude-only slots).
const ENGINE_FREE_JOB_KEYS = Object.freeze({
  agentGen: 'agentGenModel', naming: 'namingModel', commandSummary: 'commandSummaryModel', requirementsInterview: 'requirementsInterview',
});

/** The settings slot a Models-page helper job reads on `engine` (engine-settings-view.mjs JOB_LABELS keys). */
export function jobSlot(engine, job) {
  if (Object.hasOwn(ENGINE_FREE_JOB_KEYS, job)) return ENGINE_FREE_JOB_KEYS[job];
  return engine === 'claude' && Object.hasOwn(CLAUDE_JOB_KEYS, job) ? CLAUDE_JOB_KEYS[job] : `utilityModels.${job}`;
}
export const roleOfJob = (engine, job) => roleOf(jobSlot(engine, job));

/** The role of an Engines-card row by its setting id ('models.<e>.steps.<key>', 'models.<e>.utility.<job>',
 *  'models.<e>.<job>'), or null. A Roles-card id ('models.<e>.roles.<role>') has no role of its own.
 *  `name`: the step's label, for plugin judgement steps. */
export function roleOfSettingId(settingId, { name = '' } = {}) {
  const m = /^models\.([A-Za-z0-9_-]+)\.(.+)$/.exec(typeof settingId === 'string' ? settingId : '');
  if (!m) return null;
  const [, engine, rest] = m;
  if (rest.startsWith('roles.')) return null;
  if (rest.startsWith('steps.')) return roleOf(rest, { name });
  const job = rest.startsWith('utility.') ? rest.slice('utility.'.length) : rest;
  return roleOfJob(engine, job);
}
