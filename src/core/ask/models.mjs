// src/core/ask/models.mjs
// The Ask Worca model picker catalog (D8, ask-worca-design.md §6.9): the COMPOSED
// catalog from config.mjs — built-ins ⊕ plugin models ⊕ the user's GLOBAL models,
// with composeCatalog's precedence (global > plugin > built-in) already applied and
// one entry per id. The only thing dropped here is `custom:'project'`.
import { listModels as realListModels, EFFORTS, engineOfModel as realEngineOf } from '../config.mjs';
import { listPluginModels as realPluginModels, pluginModelSecretStatus as realSecretStatus } from '../plugin-models.mjs';
import { ASK_LIMITS } from './limits.mjs';
import { brokerEnabled, brokerEngineRefusal } from '../broker-client.mjs';
import { effortlessModels as realEffortless } from '../bridge/upstream.mjs';
import { findBridgedEntry, isOpenRouterEntry } from '../bridge/registry.mjs';
import { providerConfig } from '../settings.mjs';
import { effortsForEngine, ASK_ENGINES } from '../model-env.mjs';
import { resolveSetting } from '../settings-cascade.mjs';
import { withRole } from '../model-roles.mjs';
import { chatDescriptor, chatEngineNotInstalled as realNotInstalled } from '../engines/chat.mjs';
import { engineSetupDocs } from '../../shared/engine-setup.mjs';
import { harnessesOf, runsOn, effortsOn } from '../../shared/connections.mjs';
import { engineLabel } from '../../shared/engine-switch.mjs';

export const ENGINE_LABEL = Object.freeze(Object.fromEntries(ASK_ENGINES.map((e) => [e, engineLabel(e)])));
/** The effort a chat on an engine with no effort vocabulary carries (none today: Gemini CLI and Qwen Code took one with
 *  their thinking settings): it validates, the picker hides it (`noEffort`), and the adapter ignores it. */
const NO_EFFORT_PLACEHOLDER = 'medium';
/** A chat's engine (cascading-settings-design.md D12): the engine stored on the thread (v53), so a model that left the
 *  catalog never moves the chat to another engine; a chat from before v53 reads its model's engine (unknown is Claude). */
export function chatEngine(thread, { engineOf = realEngineOf } = {}) {
  if (thread && ASK_ENGINES.includes(thread.engine)) return thread.engine;
  const own = thread && typeof thread.model === 'string' ? engineOf(thread.model) : null;
  return ASK_ENGINES.includes(own) ? own : 'claude';
}
/** The user's Ask engine and per-engine slots (D17), an unset slot taking the STORED everyday model role (D3) — never
 *  a Worca default (#1450): Chat's own D8 default (ASK_LIMITS) already names a model. A settings failure reads as
 *  today's defaults. */
export function defaultAskPrefs() {
  try {
    return { engine: resolveSetting('askEngine').value,
      slots: Object.fromEntries(ASK_ENGINES.map((e) => [e, withRole(resolveSetting(`models.${e}.ask`).value, e, 'askModels', { floor: false })])) };
  } catch { return { engine: 'claude', slots: {} }; }
}

/** Whether a catalog id reaches OpenRouter: its entry is an OpenAI-compatible one whose effective base URL is on
 *  openrouter.ai (the bridge's own rule). The picker row carries no base URL, so the entry is looked up. */
function realIsOpenRouterModel(id) {
  try {
    const e = findBridgedEntry(id);
    return !!e && isOpenRouterEntry(e.upstream, providerConfig('openai'));
  } catch { return false; }
}
/** The Models › Providers row each bridged provider is set up on. */
const PROVIDER_ROW = Object.freeze({ copilot: 'GitHub Copilot', openai: 'OpenAI-compatible', anthropic: 'Anthropic-compatible' });

/**
 * @param {{
 *   listModels?: (projectDir:string)=>Promise<Array<object>>,
 *   pluginModels?: ()=>Array<{plugin:string,id:string,secrets?:string[]}>,
 *   secretStatus?: (plugin:string)=>Array<{key:string,set:boolean}>,
 *   defaults?: {defaultModel:string, defaultEffort:string},
 *   effortless?: ()=>Set<string>,
 *   askPrefs?: ()=>{engine?:string, slots?:{claude?:object, codex?:object}},
 *   codexAvailable?: ()=>boolean,
 *   copilotAvailable?: ()=>boolean,
 *   geminiAvailable?: ()=>boolean,
 *   qwenAvailable?: ()=>boolean,
 *   isOpenRouterModel?: (id:string)=>boolean,
 *   notInstalled?: (engine:string)=>string|null,
 * }} [deps]  `<engine>Available`: whether Chat on that engine can be offered (default: its chat descriptor's lockdown);
 *   `isOpenRouterModel`: whether a bridged row reaches OpenRouter (its sign-in message names that row);
 *   `notInstalled`: why an engine's CLI is not on this machine, or null (default: its chat descriptor's check, never in
 *   mock mode, where every engine is there)
 */
export function createAskModels({
  listModels = realListModels,
  pluginModels = realPluginModels,
  secretStatus = realSecretStatus,
  defaults = ASK_LIMITS,
  effortless = realEffortless,
  askPrefs = defaultAskPrefs,
  isOpenRouterModel = realIsOpenRouterModel,
  notInstalled = realNotInstalled,
  ...engineAvailable
} = {}) {
  const available = (e) => (typeof engineAvailable[`${e}Available`] === 'function' ? engineAvailable[`${e}Available`]() : !!chatDescriptor(e)?.lockdown());
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
    const own = models.filter((m) => runsOn(m, engine));
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
   * The rows of an engine whose CLI is not on this machine stay (a chat already on it still validates, and its turn says
   * why it cannot run); `notReady` names each such engine with the reason, Claude too, and the pickers leave it out of a
   * new chat and show it only to a chat already on it. A new chat never starts on it: `askEngine` and `default` take the
   * user's Ask engine when it is installed, else the first engine (picker order) that is; with none, the Ask engine still,
   * and the pickers ask for a harness to be set up.
   * An engine with no rows yet is checked too, so the picker's More harnesses (the engines to add a model on) leaves it out;
   * it lists the missing engines at its foot instead, each opening its setup dialog (Connect <engine>), or its `setupDocs`
   * section where there is no dialog (the extension).
   * `notReady` and `setupDocs` are there only when something is missing, so an install with every engine keeps today's
   * payload.
   * @returns {Promise<{models:Array<object>, efforts:string[], default:{model:string,effort:string}|null,
   *   defaults:Record<'claude'|'codex'|'copilot', {model:string,effort:string}|null>, askEngine:'claude'|'codex'|'copilot',
   *   notReady?:Record<string,string>, setupDocs?:Record<string,string|null>}>}
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
      // D12: every Ask engine is offered; the panel groups them and locks a chat to its own. Codex and Copilot rows only
      // when that engine can be locked down (and the credential broker is off); Codex: this codex can be locked down (plans/ask-on-codex-spike.md (a)) — otherwise a Codex chat could never start.
      // D5: only engines an Ask chat can be locked down on (model-env.mjs ASK_ENGINES). A Cursor row stays out, so a
      // hand-made pick of one is an unknown model.
      // A row runs on every harness its connection reaches (src/shared/connections.mjs); a chat takes the ones Ask
      // runs on. An endpoint model Codex reaches too is offered in both groups.
      // A model its engine's chat descriptor rules out (a provider that is itself an agent CLI, OpenCode Zen's free
      // models) is not offered on that engine.
      const offered = (e) => e === 'claude' || available(e) && !brokerEngineRefusal(e) && !chatDescriptor(e).modelProblem(m.id);
      const harnesses = harnessesOf(m).filter((e) => ASK_ENGINES.includes(e) && offered(e));
      if (!harnesses.length) continue;
      const engine = harnesses.includes(m.engine || 'claude') ? (m.engine || 'claude') : harnesses[0];
      const custom = m.custom === 'global' || m.custom === 'plugin' ? m.custom : false;
      const entry = {
        id: m.id,
        label: typeof m.label === 'string' && m.label ? m.label : m.id,
        // A sign-in engine's row with no efforts of its own takes the engine's whole vocabulary (Gemini CLI, Qwen Code).
        efforts: Array.isArray(m.efforts) && (m.efforts.length || engine === 'claude') ? [...m.efforts] : [...effortsForEngine(engine)],
        custom,
        hasEnv: m.hasEnv === true,
      };
      // An engine with no effort vocabulary: one placeholder effort the picker hides.
      const effortless = !entry.efforts.length && !effortsForEngine(engine).length;
      if (effortless) entry.efforts = [NO_EFFORT_PLACEHOLDER];
      if (engine !== 'claude') entry.engine = engine;   // a Claude row keeps today's exact shape
      if (custom === 'plugin' && typeof m.plugin === 'string' && m.plugin) entry.plugin = m.plugin;
      if (m.hidden === true) entry.hidden = true;
      // Its upstream refused a reasoning effort (bridge/upstream.mjs leaves it out from then
      // on): the picker shows the effort as not applicable. The effort still validates.
      if (noEffort.has(m.id) || effortless) entry.noEffort = true;   // the picker skips it; validation does not (#422)
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
        if (m.bridgedHost) entry.bridgedHost = m.bridgedHost;
        if (m.needsSignIn) {
          entry.needsSignIn = true;
          const row = isOpenRouterModel(m.id) ? 'OpenRouter' : PROVIDER_ROW[m.bridged] || m.bridged;
          entry.signInMessage = m.signInReason === 'no_key' ? `No API key for ${row} — Models › Providers › ${row}.`
            : `Not signed in to ${row} — Models › Providers › ${row}.`;
        }
      }
      // With the credential broker on, plugin secrets are never read: the broker's key
      // status (the pickers' credential badges) says whether this person has the key.
      if (custom === 'plugin' && withSecrets && !brokerEnabled()) {
        if (!missing) missing = missingSecretsByIdLc();
        const keys = missing.get(m.id.toLowerCase());
        if (keys && keys.length) entry.secretsMissing = [...keys];
      }
      // The harnesses only when the row's own shape would say otherwise (a Claude row keeps today's exact shape).
      if (JSON.stringify(harnessesOf(entry)) !== JSON.stringify(harnesses)) entry.harnesses = harnesses;
      models.push(entry);
    }
    let prefs = { engine: 'claude', slots: {} };
    try { prefs = askPrefs() || prefs; } catch { /* today's defaults */ }
    const slots = prefs.slots || {};
    const byEngine = Object.fromEntries(ASK_ENGINES.map((e) => [e, pickDefault(models, e, slots[e] || null)]));
    // Every chat engine is checked, rows or not (a few stat calls each, never a spawn); Claude's sign-in is the turn's
    // check. `setupDocs` names each missing engine's setup section: the extension's More harnesses links to it.
    const notReady = {};
    const setupDocs = {};
    for (const e of ASK_ENGINES) {
      const why = notInstalled(e);
      if (!why) continue;
      notReady[e] = why;
      setupDocs[e] = engineSetupDocs(e);
    }
    const want = ASK_ENGINES.includes(prefs.engine) ? prefs.engine : 'claude';
    const usable = (e) => !!byEngine[e] && !notReady[e];
    const askEngine = usable(want) ? want : ASK_ENGINES.find(usable) || (byEngine[want] ? want : 'claude');
    return { models, efforts: [...EFFORTS], default: byEngine[askEngine], defaults: byEngine, askEngine,
      ...(Object.keys(notReady).length ? { notReady, setupDocs } : {}) };
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
    // A model on two harnesses keeps its own efforts; a chat on the other harness takes them mapped (effortsOn).
    if (!entry.efforts.includes(e) && !(engine && effortsOn(entry, engine).includes(e))) return { ok: false, error: `effort "${e}" is not available for model "${entry.id}"` };
    // D12 / #943: inside a chat (engine given) only a model its engine runs. Moving the chat to another engine is its own
    // step (POST /api/ask/threads/:id/engine, after a confirm): a PATCH or a message never moves it.
    const own = entry.engine || 'claude';
    if (engine && !runsOn(entry, engine)) return { ok: false, error: `this chat runs on ${ENGINE_LABEL[engine]}; switch it to ${ENGINE_LABEL[own]} from the Chat model picker first` };
    return { ok: true, model: entry.id, effort: e };
  }

  /**
   * The model an automatic turn (a card event, a finished command) runs on: the chat's own pick, else the default of
   * the engine the chat is locked to — never the other engine's — else, before the first reply, the user's Ask default.
   * `fallback` is set when the chat's own model could not be used, so the caller can say so in the chat.
   * @returns {Promise<{ok:true, model:string, effort:string, fallback?:{from:string, engine:string|null}}|null>}
   */
  async function eventPick(thread, lockedEngine = null) {
    const mv = await validateModelEffort(thread && thread.model, thread && thread.effort, { engine: lockedEngine });
    if (mv.ok) return mv;
    const cat = await askCatalog({ withSecrets: false });
    const d = lockedEngine ? cat.defaults[lockedEngine] : cat.default;
    if (!d) return null;
    const from = thread && typeof thread.model === 'string' ? thread.model : '';
    return { ok: true, ...d, ...(from ? { fallback: { from, engine: lockedEngine } } : {}) };
  }

  return { askCatalog, validateModelEffort, eventPick };
}

/** The chat notice for an eventPick fallback: which model was unavailable and what the reply runs on instead. */
export function eventFallbackNotice({ fallback, model, effort }) {
  if (!fallback) return null;
  const on = fallback.engine ? `${ENGINE_LABEL[fallback.engine]}'s default, ${model} (${effort})` : `${model} (${effort})`;
  return fallback.from.toLowerCase() === String(model).toLowerCase()
    ? `This chat's effort is not available for ${fallback.from} any more, so this reply uses ${on}.`
    : `This chat's model ${fallback.from} is not available any more, so this reply uses ${on}.`;
}

const bound = createAskModels();
/** Bound to the real catalog — what ui/server.mjs uses for GET /api/ask/models and the message POST. */
export const askCatalog = bound.askCatalog;
export const validateModelEffort = bound.validateModelEffort;
export const askEventPick = bound.eventPick;
