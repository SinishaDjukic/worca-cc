// src/core/guide-model.mjs — the model the composer's Guide check runs on (Shaper ask screens). It resolves exactly
// like Command summaries: the stored `guideModel` pair, else the Quick jobs role, else the cheapest ready Claude model.
import { withRole } from './model-roles.mjs';
import { resolveNamingModel } from './naming.mjs';
import { guideModel } from './settings.mjs';

/** `{ model, effort, source: 'settings'|'auto'|'default', stale }` for `models` (the catalog) and `costOf`. */
export function resolveGuideModel(models, costOf) {
  return resolveNamingModel(withRole(guideModel(), 'claude', 'guideModel', { floor: false }), models, costOf);
}
