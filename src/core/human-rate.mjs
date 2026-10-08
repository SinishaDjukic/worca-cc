// src/core/human-rate.mjs
// The rate that prices human hours (money-saved design §8): the developer's stored setting wins
// when set, then the team policy's `cost.humanRateUsd` default, then 35. Read fresh per call.
import { DEFAULT_HUMAN_RATE_USD } from './settings.mjs';
import { resolveSetting } from './settings-cascade.mjs';

/** @param {string|null} [projectDir] the project whose policy home applies (null: no policy lookup) */
export function effectiveHumanRateUsd(projectDir = null) {
  try { return resolveSetting('humanRateUsdPerHour', projectDir ? { projectDir } : null).value; }
  catch { return DEFAULT_HUMAN_RATE_USD; }
}
