// Which model runs the Auto classifier (spec D14): WORCA_AUTO_MODEL (verbatim,
// an operator override) > the Settings pick (catalog ids only) > Sonnet 5 (the
// model the classifier's costs were measured on — exact id, so Sonnet 5.5 sitting
// ahead of it in the catalog does not take the default) > any Sonnet > the first
// catalog entry.
import { autoWorkflowModel } from '../settings.mjs';

export const AUTO_MODEL_ENV = 'WORCA_AUTO_MODEL';

/**
 * The catalog half of that order, shared by every Sonnet-class helper call (the
 * Auto classifier, the PR description): the setting while the catalog still
 * carries it (in the catalog's casing) > Sonnet 5 > any Sonnet > the first entry.
 * @param {Array<{id:string}>} models the effective catalog (listModels)
 * @param {string} [setting] the stored id, '' when unset
 * @returns {string} a model id, or '' when the catalog is empty
 */
export function pickCatalogModel(models, setting, { engine = 'claude' } = {}) {
  const pool = (Array.isArray(models) ? models : []).filter((m) => m && (m.engine || 'claude') === engine);
  const ids = pool.map((m) => m.id).filter((id) => typeof id === 'string' && id);
  const find = (id) => ids.find((x) => x.toLowerCase() === String(id || '').trim().toLowerCase());
  if (engine !== 'claude') return find(setting) || pool.find((m) => m.builtin)?.id || ids[0] || '';
  return find(setting)
    || ids.find((id) => /^claude-sonnet-5$/i.test(id))
    || ids.find((id) => /^claude-sonnet/i.test(id))
    || ids[0]
    || '';
}

/**
 * @param {Array<{id:string}>} models the effective catalog (listModels)
 * @param {{env?:object, setting?:string}} [o] injectable for tests
 * @returns {string} a model id, or '' when the catalog is empty and nothing is configured
 */
export function resolveAutoModel(models, { env = process.env, setting = autoWorkflowModel(), engine = 'claude' } = {}) {
  if (engine !== 'claude') {
    const id = typeof setting === 'string' ? setting.trim().toLowerCase() : '';
    const hit = id ? (Array.isArray(models) ? models : []).find((m) => m && (m.engine || 'claude') === engine && String(m.id).toLowerCase() === id) : null;
    return hit ? hit.id : '';
  }
  const fromEnv = typeof env?.[AUTO_MODEL_ENV] === 'string' ? env[AUTO_MODEL_ENV].trim() : '';
  if (fromEnv) return fromEnv;
  return pickCatalogModel(models, setting);
}
