// Which model runs the Auto classifier (spec D14): WORCA_AUTO_MODEL (verbatim,
// an operator override) > the Settings pick (catalog ids only) > the cheapest
// Sonnet-class catalog entry > the first catalog entry.
import { autoWorkflowModel } from '../settings.mjs';

export const AUTO_MODEL_ENV = 'WORCA_AUTO_MODEL';

/**
 * @param {Array<{id:string}>} models the effective catalog (listModels)
 * @param {{env?:object, setting?:string}} [o] injectable for tests
 * @returns {string} a model id, or '' when the catalog is empty and nothing is configured
 */
export function resolveAutoModel(models, { env = process.env, setting = autoWorkflowModel() } = {}) {
  const fromEnv = typeof env?.[AUTO_MODEL_ENV] === 'string' ? env[AUTO_MODEL_ENV].trim() : '';
  if (fromEnv) return fromEnv;
  const ids = (Array.isArray(models) ? models : []).map((m) => m && m.id).filter((id) => typeof id === 'string' && id);
  const find = (id) => ids.find((x) => x.toLowerCase() === String(id || '').trim().toLowerCase());
  return find(setting)
    || ids.find((id) => /^claude-sonnet-5/i.test(id))
    || ids.find((id) => /^claude-sonnet/i.test(id))
    || ids[0]
    || '';
}
