// src/core/effort-intents.mjs — per-step effort intents. Every agent step carries an intent (light | standard | deep);
// the intent is mapped to a concrete effort for the step's model family and clamped to the efforts that model lists.
//
// Precedence: an intent fills ONLY an unset effort. Any effort a layer names (template, project node, legacy per-role,
// team slot, role, run overlay, a pinned agentPair) wins. The fill happens in resolveGraph (workflows.mjs), and only
// when the caller passes `fillIntents: true` — the two run-start resolves (orchestrator.mjs _resolveTopology and
// _autoAdopt). A future resolveGraph caller that starts a run must pass it too, or its steps run at the model's default.
// Previews, saved run setups and exports never fill, so no filled effort is frozen into them as an explicit pick.
// The filled effort lands on the node ctx, so the manifest (and a resume) carries the effort that really ran.
//
// The values are starting values from the per-model prompting guides, to be measured.
//
// STEP_INTENTS is not the model-roles split (shared/model-roles.mjs): roles pick a MODEL tier and keep their deep set
// small (five keys) so a person's deep model is not spent widely; intents pick only an EFFORT for whatever model runs,
// so every judgement step is deep.
import { resolveModelFamily } from './model-addons.mjs';
import { nearestEffort } from '../shared/connections.mjs';

export const EFFORT_INTENTS = Object.freeze(['light', 'standard', 'deep']);
export const DEFAULT_INTENT = 'standard';

const intents = (deep, light, standard) => Object.freeze(Object.fromEntries([
  ...deep.map((k) => [k, 'deep']), ...light.map((k) => [k, 'light']), ...standard.map((k) => [k, 'standard']),
].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));

/** One intent per built-in agent key (the AUTHORED key, as factoryNodePick and the legacy per-role layer use). */
export const STEP_INTENTS = intents(
  // deep — judgement
  ['planner', 'planReviewer', 'refiner', 'reviewer', 'deckReviewer', 'deckAudit', 'requirementsReviewer', 'requirementsRefiner',
    'workspaceReviewer', 'promoReview', 'architect'],
  // light — mechanical
  ['decomposer', 'manualTestsChecklist', 'deckExport', 'memoryDefragmenter', 'promoCapture'],
  // standard — producers and everything else
  ['implementer', 'clarify', 'architectSetup', 'deckBuilder', 'deckClarify', 'deckNarrative', 'deckOutputs', 'deckSystem',
    'manualWebUiTesting', 'promoExplorer', 'promoMascot', 'promoScenes', 'promoSetup', 'promoVoice', 'promoWriter',
    'requirementsDrafter', 'workspaceScanner', 'workspaceSynthesizer', 'workspaceUsageMapper'],
);

/** For keys not in STEP_INTENTS (plugin and user agents): the lowercased display name, as roleOf's DEEP_STEP_NAMES. */
export const STEP_INTENT_NAMES = Object.freeze({
  plan: 'deep', 'plan review': 'deep', 'refine plan': 'deep', 'review implementation': 'deep', 'bug root cause': 'deep',
  'deck review': 'deep',
  'bug report analysis': 'light', 'bug triage report': 'light', decompose: 'light', 'manual tests checklist': 'light',
  'deck export': 'light',
});

/** The effort each mapped family runs an intent at (starting values, to be measured). Any other family has no row. */
export const INTENT_EFFORTS = Object.freeze({
  'fable-5-2': Object.freeze({ light: 'low', standard: 'medium', deep: 'high' }),
  'opus-5-5': Object.freeze({ light: 'low', standard: 'medium', deep: 'high' }),
  'sonnet-5-5': Object.freeze({ light: 'low', standard: 'medium', deep: 'high' }),
  'opus-4-8': Object.freeze({ light: 'medium', standard: 'high', deep: 'xhigh' }),
  'haiku-5-5': Object.freeze({ light: 'low', standard: 'medium', deep: 'high' }),
});

/** A step's intent: its agent key's row, else its display name's row, else the default. Never throws. */
export function stepIntent(agentKey, { name = '' } = {}) {
  if (typeof agentKey === 'string' && Object.hasOwn(STEP_INTENTS, agentKey)) return STEP_INTENTS[agentKey];
  const n = typeof name === 'string' ? name.trim().toLowerCase() : '';
  if (n && Object.hasOwn(STEP_INTENT_NAMES, n)) return STEP_INTENT_NAMES[n];
  return DEFAULT_INTENT;
}

/** The family of a model the intents map, or null (no family, or a family with no row). */
function mappedFamily(model, engine) {
  const family = resolveModelFamily(model, { engine });
  return family && Object.hasOwn(INTENT_EFFORTS, family) ? family : null;
}

/**
 * The effort an intent runs at on `model`, clamped to `efforts` (the model's list), or null. Pure; never throws.
 * @param {{ intent?: string, model?: string|null, engine?: string|null, efforts?: string[] }} [opts]
 * @returns {string|null}
 */
export function intentEffort({ intent, model, engine, efforts } = {}) {
  const family = mappedFamily(model, engine);
  if (!family || !EFFORT_INTENTS.includes(intent)) return null;
  return nearestEffort(INTENT_EFFORTS[family][intent], efforts);
}

/**
 * A step's intent effort on its model (what resolveGraph calls). `efforts` may be a list or a (sync or async) function
 * returning it; a function is called only for a mapped family, so an unmapped model never reads the catalog.
 * @param {{ agentKey?: string, name?: string, model?: string|null, engine?: string|null, efforts?: string[]|(() => string[]|Promise<string[]>) }} [opts]
 * @returns {Promise<string|null>}
 */
export async function intentEffortFor({ agentKey, name, model, engine, efforts } = {}) {
  if (!mappedFamily(model, engine)) return null;
  const list = typeof efforts === 'function' ? await efforts() : efforts;
  return intentEffort({ intent: stepIntent(agentKey, { name }), model, engine, efforts: list });
}
