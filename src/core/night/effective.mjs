import { NIGHT_FIELDS, NIGHT_DEFAULTS, resolveNightConfig } from './config.mjs';
import { resolveMany, nightRawLayers } from '../settings-cascade.mjs';

const NIGHT_IDS = NIGHT_FIELDS.map((field) => `nightMode.${field}`);
export function nightLayers(projectDir) {
  try { return nightRawLayers(projectDir || null); } catch { return { project: null, user: null, team: {} }; }
}
export function effectiveNightConfig(projectDir) {
  let all;
  try { all = resolveMany(NIGHT_IDS, projectDir ? { projectDir } : null); } catch { return resolveNightConfig({}); }
  const config = {}; const sources = {};
  for (const field of NIGHT_FIELDS) { const r = all[`nightMode.${field}`]; config[field] = r.value; sources[field] = r.source; }
  config.criteria = { ...NIGHT_DEFAULTS.criteria, ...(config.criteria || {}) };
  config.neverDecide = [...config.neverDecide];
  return { config, sources };
}
export function effectiveNightConfigLocalOnly(projectDir) {
  const layers = nightLayers(projectDir);
  return resolveNightConfig({ project: layers.project, user: layers.user });
}
