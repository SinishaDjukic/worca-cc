// src/core/ask/models.mjs
// The Ask Worca model picker catalog (D8, ask-worca-design.md §6.9): the
// predefined ids ⊕ the user's GLOBAL custom models. listModels('') alone is not
// that set — it also carries plugin entries, and a plugin that shadows a
// predefined id re-emits it with custom:'plugin' (config.mjs:194-198), so the
// filter is by ID membership OR custom === 'global', never by `custom` alone.
import { listModels as realListModels, PREDEFINED_MODELS, EFFORTS } from '../config.mjs';

/**
 * @param {{listModels?: (projectDir:string)=>Promise<Array<object>>, predefinedIds?: string[]}} [deps]
 */
export function createAskModels({
  listModels = realListModels,
  predefinedIds = PREDEFINED_MODELS.map((m) => m.id),
} = {}) {
  const predefinedLc = new Set(predefinedIds.map((id) => id.toLowerCase()));

  /** @returns {Promise<{models:Array<{id:string,label:string,efforts:string[],custom:false|'global'}>, efforts:string[]}>} */
  async function askCatalog() {
    const all = await listModels('');
    const models = [];
    for (const m of all) {
      if (!m || typeof m.id !== 'string') continue;
      const predefined = predefinedLc.has(m.id.toLowerCase());
      if (!predefined && m.custom !== 'global') continue;           // plugin-only / project entries
      models.push({
        id: m.id,
        label: typeof m.label === 'string' && m.label ? m.label : m.id,
        efforts: Array.isArray(m.efforts) ? [...m.efforts] : [...EFFORTS],
        custom: m.custom === 'global' ? 'global' : false,
      });
    }
    return { models, efforts: [...EFFORTS] };
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
    const { models } = await askCatalog();
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
