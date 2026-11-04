// src/shared/graph/role-slots.mjs — the ONE model-pick module: clean a pick, keep it only where the run's engine runs
// it, layer it (run overlay > project config > template), and resolve each declared role of a role-review node.
// Node picks (workflows.mjs ownedPair) and role picks go through the same pickOnEngine. Pure and browser-safe.
import { effortOn as defaultEffortOn } from '../connections.mjs';

const MODEL_MAX = 200;   // the parseOverlayNodes bounds (src/core/run-overlay.mjs)
const EFFORT_MAX = 32;

/** A pick's model and effort, trimmed; blanks, non-strings and over-long values dropped. Null when nothing is left. */
export function cleanPick(sel) {
  if (!sel || typeof sel !== 'object') return null;
  const model = typeof sel.model === 'string' ? sel.model.trim() : '';
  const effort = typeof sel.effort === 'string' ? sel.effort.trim() : '';
  const out = {
    ...(model && model.length <= MODEL_MAX ? { model } : {}),
    ...(effort && effort.length <= EFFORT_MAX ? { effort } : {}),
  };
  return Object.keys(out).length ? out : null;
}

/** The pick as the run's engine runs it: a model the engine does not run drops the whole pick; a model on two
 *  harnesses keeps its own engine's efforts, and this harness takes the nearest one (effortOn).
 *  @param {{runs:(model:string)=>boolean, efforts:string[], effortOn?:Function}} env */
export function pickOnEngine(sel, engine, { runs, efforts, effortOn = defaultEffortOn }) {
  if (!sel || typeof sel !== 'object') return {};
  const model = typeof sel.model === 'string' && sel.model ? sel.model : undefined;
  if (model && !runs(model)) return {};
  const own = typeof sel.effort === 'string' && sel.effort ? sel.effort : undefined;
  const effort = own && (engine === 'claude' || efforts.includes(own)) ? own : (own && model ? (effortOn(own, engine) || undefined) : undefined);
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

/** The first layer that names a model wins, with its own effort only (an effort travels with its model). With no
 *  model in any layer, the first defined effort wins. */
export function layerPick(layers) {
  const list = (Array.isArray(layers) ? layers : []).filter((l) => l && typeof l === 'object');
  const withModel = list.find((l) => l.model);
  if (withModel) return { model: withModel.model, ...(withModel.effort ? { effort: withModel.effort } : {}) };
  const withEffort = list.find((l) => l.effort);
  return withEffort ? { effort: withEffort.effort } : {};
}

const SOURCES = ['run', 'project', 'template'];

/**
 * Each declared role's pick: `{ [key]: { model?, effort?, source, wanted? } }`. A role whose layers name nothing is
 * absent. A requested model the engine does not run is dropped (the role runs on the node's pair) and the entry keeps
 * the request as `wanted`.
 */
export function resolveRolePicks({ roles, overlay, project, engine, runs, efforts, effortOn = defaultEffortOn }) {
  const out = {};
  const byKey = (map, key) => (map && typeof map === 'object' && Object.hasOwn(map, key) ? map[key] : null);
  for (const role of Array.isArray(roles) ? roles : []) {
    const layers = [cleanPick(byKey(overlay, role.key)), cleanPick(byKey(project, role.key)), cleanPick({ model: role.model, effort: role.effort })];
    const wanted = layerPick(layers);
    if (!wanted.model && !wanted.effort) continue;
    const at = wanted.model ? layers.findIndex((l) => l?.model) : layers.findIndex((l) => l?.effort);
    const pick = pickOnEngine(wanted, engine, { runs, efforts, effortOn });
    if (wanted.model && !pick.model) out[role.key] = { source: SOURCES[at], wanted };
    else if (pick.model || pick.effort) out[role.key] = { ...pick, source: SOURCES[at] };
  }
  return out;
}
