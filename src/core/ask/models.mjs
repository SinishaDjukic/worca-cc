// src/core/ask/models.mjs
// The Ask Worca model picker catalog (D8, ask-worca-design.md §6.9): the COMPOSED
// catalog from config.mjs — built-ins ⊕ plugin models ⊕ the user's GLOBAL models,
// with composeCatalog's precedence (global > plugin > built-in) already applied and
// one entry per id. The only thing dropped here is `custom:'project'`.
import { listModels as realListModels, EFFORTS } from '../config.mjs';
import { listPluginModels as realPluginModels, pluginModelSecretStatus as realSecretStatus } from '../plugin-models.mjs';
import { ASK_LIMITS } from './limits.mjs';

/**
 * @param {{
 *   listModels?: (projectDir:string)=>Promise<Array<object>>,
 *   pluginModels?: ()=>Array<{plugin:string,id:string,secrets?:string[]}>,
 *   secretStatus?: (plugin:string)=>Array<{key:string,set:boolean}>,
 *   defaults?: {defaultModel:string, defaultEffort:string},
 * }} [deps]
 */
export function createAskModels({
  listModels = realListModels,
  pluginModels = realPluginModels,
  secretStatus = realSecretStatus,
  defaults = ASK_LIMITS,
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

  /** The D8 initial pick, validated against the live catalog (D5). */
  function pickDefault(models) {
    const want = String(defaults.defaultModel || '').toLowerCase();
    const hit = models.find((m) => m.id.toLowerCase() === want) || models[0] || null;
    if (!hit) return null;
    const efforts = hit.efforts.length ? hit.efforts : [...EFFORTS];
    const effort = efforts.includes(defaults.defaultEffort)
      ? defaults.defaultEffort
      : (efforts.includes('high') ? 'high' : efforts[0]);
    return { model: hit.id, effort };
  }

  /**
   * @param {{withSecrets?:boolean}} [opts] `withSecrets:false` skips the per-model
   *   secret probe — the extra listPluginModels() + one manifest/config read per
   *   plugin, all synchronous. Only validateModelEffort passes it: that path keeps
   *   id/efforts and throws the rest away, and it runs on every message POST.
   * @returns {Promise<{models:Array<object>, efforts:string[], default:{model:string,effort:string}|null}>}
   */
  async function askCatalog({ withSecrets = true } = {}) {
    const all = await listModels('');
    const models = [];
    let missing = null; // lazily built on the first plugin entry
    for (const m of all) {
      if (!m || typeof m.id !== 'string') continue;
      // Legacy per-project models stay out: the chat is project-less (listModels('')
      // never composes them anyway — config.mjs:296), and offering them needs a
      // project-selection design first. Everything else — built-in, global,
      // plugin — is offered.
      if (m.custom === 'project') continue;
      const custom = m.custom === 'global' || m.custom === 'plugin' ? m.custom : false;
      const entry = {
        id: m.id,
        label: typeof m.label === 'string' && m.label ? m.label : m.id,
        efforts: Array.isArray(m.efforts) ? [...m.efforts] : [...EFFORTS],
        custom,
        hasEnv: m.hasEnv === true,
      };
      if (custom === 'plugin' && typeof m.plugin === 'string' && m.plugin) entry.plugin = m.plugin;
      // Only globals and plugin entries can arrive flagged: composeCatalog emits an
      // UNSHADOWED built-in as {...m, custom:false, hasEnv:false} with no
      // ...unreliable(lc) (src/core/config.mjs:200), so a built-in in model_cost_flags
      // shows no ⚠cost here. Pre-existing gap, shared with the pipeline dropdown and
      // /api/config; fixing it means editing composeCatalog and its three other consumers.
      if (m.costUnreliable === true) entry.costUnreliable = true;
      if (custom === 'plugin' && withSecrets) {
        if (!missing) missing = missingSecretsByIdLc();
        const keys = missing.get(m.id.toLowerCase());
        if (keys && keys.length) entry.secretsMissing = [...keys];
      }
      models.push(entry);
    }
    return { models, efforts: [...EFFORTS], default: pickDefault(models) };
  }

  /**
   * @param {unknown} model
   * @param {unknown} effort
   * @returns {Promise<{ok:true, model:string, effort:string}|{ok:false, error:string}>}
   */
  async function validateModelEffort(model, effort) {
    if (typeof model !== 'string' || !model.trim()) return { ok: false, error: 'model is required' };
    if (typeof effort !== 'string' || !effort.trim()) return { ok: false, error: 'effort is required' };
    const id = model.trim();
    const { models } = await askCatalog({ withSecrets: false });   // id/efforts only — a missing secret never blocks (D9)
    const entry = models.find((m) => m.id.toLowerCase() === id.toLowerCase());
    if (!entry) return { ok: false, error: `unknown model "${id}"` };
    const e = effort.trim();
    if (!entry.efforts.includes(e)) return { ok: false, error: `effort "${e}" is not available for model "${entry.id}"` };
    return { ok: true, model: entry.id, effort: e };
  }

  return { askCatalog, validateModelEffort };
}

const bound = createAskModels();
/** Bound to the real catalog — what ui/server.mjs uses for GET /api/ask/models and the message POST. */
export const askCatalog = bound.askCatalog;
export const validateModelEffort = bound.validateModelEffort;
