// src/core/human-rate.mjs
// The rate that prices human hours (money-saved design §8): the developer's stored setting wins
// when set, then the team policy's `cost.humanRateUsd` default, then 35. Read fresh per call.
import { humanRateUsdPerHour, DEFAULT_HUMAN_RATE_USD } from './settings.mjs';
import { teamDefault } from './policy/cache.mjs';

/** @param {string|null} [projectDir] the project whose policy home applies (null: no policy lookup) */
export function effectiveHumanRateUsd(projectDir = null) {
  const local = humanRateUsdPerHour();
  if (local != null) return local;
  if (projectDir) {
    let team;
    try { team = teamDefault(projectDir, 'cost.humanRateUsd'); } catch { team = undefined; }   // a policy read must never break a metrics page
    if (typeof team === 'number' && Number.isFinite(team) && team > 0) return team;
  }
  return DEFAULT_HUMAN_RATE_USD;
}
