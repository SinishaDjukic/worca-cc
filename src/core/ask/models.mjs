// src/core/ask/models.mjs
// The Ask Worca model picker catalog (D8, ask-worca-design.md §6.9): the COMPOSED
// catalog from config.mjs — built-ins ⊕ plugin models ⊕ the user's GLOBAL models,
// with composeCatalog's precedence (global > plugin > built-in) already applied and
// one entry per id. The only thing dropped here is `custom:'project'`.
import { listModels as realListModels, EFFORTS, engineOfModel as realEngineOf } from '../config.mjs';
import { listPluginModels as realPluginModels, pluginModelSecretStatus as realSecretStatus } from '../plugin-models.mjs';
import { ASK_LIMITS } from './limits.mjs';
import { brokerEnabled } from '../broker-client.mjs';
import { effortlessModels as realEffortless } from '../bridge/upstream.mjs';
import { effortsForEngine, ASK_ENGINES } from '../model-env.mjs';
import { resolveSetting } from '../settings-cascade.mjs';
import { CODEX_ASK_LOCKDOWN } from '../engines/codex.mjs';

export const ENGINE_LABEL = Object.freeze({ claude: 'Claude', codex: 'Codex' });
/** A chat's engine (cascading-settings-design.md D12): its model's engine; unknown or empty is Claude. No column stores it. */
export function chatEngine(thread, { engineOf = realEngineOf } = {}) {
  return (thread && typeof thread.model === 'string' && engineOf(thread.model)) === 'codex' ? 'codex' : 'claude';
}
/** The user's Ask engine and per-engine slots (D17); a settings failure reads as today's defaults. */
function defaultAskPrefs() {
  try {
    return { engine: resolveSetting('askEngine').value, slots: { claude: resolveSetting('models.claude.ask').value, codex: resolveSetting('models.codex.ask').value } };
  } catch { return { engine: 'claude', slots: {} }; }
}

/**
 * @param {{
 *   listModels?: (projectDir:string)=>Promise<Array<object>>,
 *   pluginModels?: ()=>Array<{plugin:string,id:string,secrets?:string[]}>,
 *   secretStatus?: (plugin:string)=>Array<{key:string,set:boolean}>,
 *   defaults?: {defaultModel:string, defaultEffort:string},
 *   effortless?: ()=>Set<string>,
 *   askPrefs?: ()=>{engine?:string, slots?:{claude?:object, codex?:object}},
 *   codexAvailable?: ()=>boolean,
 * }} [deps]
 */
export function createAskModels({
  listModels = realListModels,
  pluginModels = realPluginModels,
  secretStatus = realSecretStatus,
  defaults = ASK_LIMITS,
  effortless = realEffortless,
  askPrefs = defaultAskPrefs,
  codexAvailable = () => !!CODEX_ASK_LOCKDOWN,
} = {}) {
  /**
   * lc id -> the modelSecrets keys that model needs but that are NOT set.
   * Mirrors pluginModelsPayload() in ui/server.mjs (which ships the full
   * [{key,label,set}] for the editor); the chat only needs the missing keys.
   * Keying by id alone is safe because listPluginModels() already dedupes to one
   * entry per id (plugin-models.mjs:64-77). Like the server, this only sees keys
   * the manifest DECLARES in modelSecrets — an env {secret:…} naming an
   * undeclared key is invisible here exactly as it is in the Models view.
   * Built lazily: an install with no plugin models does no extra disk reads.
   */
  function missingSecretsByIdLc() {
    const byPlugin = new Map();   // pluginModelSecretStatus hits disk per call — memoize
    const out = new Map();
    for (const m of pluginModels()) {
      const needed = Array.isArray(m.secrets) ? m.secrets : [];
      if (!needed.length) continue;
      if (!byPlugin.has(m.plugin)) byPlugin.set(m.plugin, secretStatus(m.plugin) || []);
      const missing = byPlugin.get(m.plugin).filter((s) => needed.includes(s.key) && !s.set).map((s) => s.key);
      if (missing.length) out.set(m.id.toLowerCase(), missing);
    }
    return out;
  }

  /** The initial pick for a new chat on `engine` (D8, D17): the Ask slot when the catalog has it; Claude falls back to
   *  ASK_LIMITS.defaultModel, Codex to its first visible model. Hidden built-ins are never the initial pick (#422). */
  function pickDefault(models, engine = 'claude', slot = null) {
    const own = models.filter((m) => (m.engine || 'claude') === engine);
    const visible = own.filter((m) => !m.hidden);
    const pool = visible.length ? visible : own;
    const byId = (id) => (id ? pool.find((m) => m.id.toLowerCase() === String(id).toLowerCase()) : null);
    const hit = byId(slot && slot.model) || (engine === 'claude' ? byId(defaults.defaultModel) : null) || pool[0] || null;
    if (!hit) return null;
    const efforts = hit.efforts.length ? hit.efforts : [...effortsForEngine(engine)];
    const want = (slot && slot.effort) || (engine === 'claude' ? defaults.defaultEffort : 'medium');
    const fallback = engine === 'claude' ? (efforts.includes('high') ? 'high' : efforts[0]) : (efforts.includes('medium') ? 'medium' : efforts[0]);
    return { model: hit.id, effort: efforts.includes(want) ? want : fallback };
  }

  /**
   * @param {{withSecrets?:boolean}} [opts] `withSecrets:false` skips the per-model
   *   secret probe — the extra listPluginModels() + one manifest/config read per
   *   plugin, all synchronous. Only validateModelEffort passes it: that path keeps
   *   id/efforts and throws the rest away, and it runs on every message POST.
   * @returns {Promise<{models:Array<object>, efforts:string[], default:{model:string,effort:string}|null,
   *   defaults:{claude:{model:string,effort:string}|null, codex:{model:string,effort:string}|null}, askEngine:'claude'|'codex'}>}
   */
  async function askCatalog({ withSecrets = true } = {}) {
    const all = await listModels('');
    const models = [];
    const noEffort = effortless();
    let missing = null; // lazily built on the first plugin entry
    for (const m of all) {
      if (!m || typeof m.id !== 'string') continue;
      // Legacy per-project models stay out: the chat is project-less (listModels('')
      // never composes them anyway — config.mjs:296), and offering them needs a
      // project-selection design first. Everything else — built-in, global,
      // plugin — is offered.
      if (m.custom === 'project') continue;
      // D12: both Ask engines are offered; the panel groups them and locks a chat to its own. Codex rows only when this
      // codex can be locked down (plans/ask-on-codex-spike.md (a)) — otherwise a Codex chat could never start.
      // D5: only engines an Ask chat can be locked down on (model-env.mjs ASK_ENGINES). A Cursor row stays out, so a
      // hand-made pick of one is an unknown model.
      const engine = m.engine || 'claude';
      if (!ASK_ENGINES.includes(engine)) continue;
      if (engine === 'codex' && !codexAvailable()) continue;
      const custom = m.custom === 'global' || m.custom === 'plugin' ? m.custom : false;
      const entry = {
        id: m.id,
        label: typeof m.label === 'string' && m.label ? m.label : m.id,
        efforts: Array.isArray(m.efforts) ? [...m.efforts] : [...effortsForEngine(engine)],
        custom,
        hasEnv: m.hasEnv === true,
      };
      if (engine !== 'claude') entry.engine = engine;   // a Claude row keeps today's exact shape
      if (custom === 'plugin' && typeof m.plugin === 'string' && m.plugin) entry.plugin = m.plugin;
      if (m.hidden === true) entry.hidden = true;
      // Its upstream refused a reasoning effort (bridge/upstream.mjs leaves it out from then
      // on): the picker shows the effort as not applicable. The effort still validates.
      if (noEffort.has(m.id)) entry.noEffort = true;   // the picker skips it; validation does not (#422)
      // Only globals and plugin entries can arrive flagged: composeCatalog emits an
      // UNSHADOWED built-in as {...m, custom:false, hasEnv:false} with no
      // ...unreliable(lc) (src/core/config.mjs:200), so a built-in in model_cost_flags
      // shows no ⚠cost here. Pre-existing gap, shared with the pipeline dropdown and
      // /api/config; fixing it means editing composeCatalog and its three other consumers.
      if (m.costUnreliable === true) entry.costUnreliable = true;
      // Model bridge (model-bridge-design.md §8.5/§8.7): the picker skips a
      // bridged entry whose provider is not usable, and shows why.
      if (m.bridged) {
        entry.bridged = m.bridged;
        if (m.upstreamApi) entry.upstreamApi = m.upstreamApi;
        if (m.needsSignIn) {
          entry.needsSignIn = true;
          entry.signInMessage = m.signInReason === 'terms' ? 'GitHub Copilot notice not acknowledged — the Providers page.'
            : m.signInReason === 'no_key' ? `No API key for ${m.bridged} — the Providers page.`
              : `Not signed in to ${m.bridged} — the Providers page.`;
        }
      }
      // With the credential broker on, plugin secrets are never read: the broker's key
      // status (the pickers' credential badges) says whether this person has the key.
      if (custom === 'plugin' && withSecrets && !brokerEnabled()) {
        if (!missing) missing = missingSecretsByIdLc();
        const keys = missing.get(m.id.toLowerCase());
        if (keys && keys.length) entry.secretsMissing = [...keys];
      }
      models.push(entry);
    }
    let prefs = { engine: 'claude', slots: {} };
    try { prefs = askPrefs() || prefs; } catch { /* today's defaults */ }
    const slots = prefs.slots || {};
    const byEngine = { claude: pickDefault(models, 'claude', slots.claude || null), codex: pickDefault(models, 'codex', slots.codex || null) };
    const askEngine = prefs.engine === 'codex' && byEngine.codex ? 'codex' : 'claude';
    return { models, efforts: [...EFFORTS], default: byEngine[askEngine], defaults: byEngine, askEngine };
  }

  /**
   * @param {unknown} model
   * @param {unknown} effort
   * @returns {Promise<{ok:true, model:string, effort:string}|{ok:false, error:string}>}
   */
  async function validateModelEffort(model, effort, { engine = null } = {}) {
    if (typeof model !== 'string' || !model.trim()) return { ok: false, error: 'model is required' };
    if (typeof effort !== 'string' || !effort.trim()) return { ok: false, error: 'effort is required' };
    const id = model.trim();
    const { models } = await askCatalog({ withSecrets: false });   // id/efforts only — a missing secret never blocks (D9)
    const entry = models.find((m) => m.id.toLowerCase() === id.toLowerCase());
    if (!entry) return { ok: false, error: `unknown model "${id}"` };
    const e = effort.trim();
    if (!entry.efforts.includes(e)) return { ok: false, error: `effort "${e}" is not available for model "${entry.id}"` };
    // D12: inside a chat (engine given) only the chat's engine; switching engine means a new chat.
    const own = entry.engine || 'claude';
    if (engine && own !== engine) return { ok: false, error: `this chat runs on ${ENGINE_LABEL[engine]}; start a new chat to use ${ENGINE_LABEL[own]}` };
    return { ok: true, model: entry.id, effort: e };
  }

  return { askCatalog, validateModelEffort };
}

const bound = createAskModels();
/** Bound to the real catalog — what ui/server.mjs uses for GET /api/ask/models and the message POST. */
export const askCatalog = bound.askCatalog;
export const validateModelEffort = bound.validateModelEffort;
