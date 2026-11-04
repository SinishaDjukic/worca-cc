// src/shared/graph/role-slots.mjs — the ONE model-pick module: clean a pick, keep it only where the run's engine runs
// it, layer it (run overlay > project config > template), and resolve each declared role of a role-review node.
// Node picks (workflows.mjs ownedPair) and role picks go through the same pickOrDrop. Pure and browser-safe.
import { effortOn as defaultEffortOn } from '../connections.mjs';
import { engineLabel } from '../engine-switch.mjs';

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
export function pickOnEngine(sel, engine, env) {
  return pickOrDrop(sel, engine, env).pick;
}

/** The ONE place that decides whether a pick is dropped. `pick` is what the engine runs (pickOnEngine); `dropped` is
 *  the cleaned request when it names a model the engine does not run, or only an effort the engine does not offer.
 *  @returns {{pick:{model?:string, effort?:string}, dropped:{model?:string, effort?:string}|null}} */
export function pickOrDrop(sel, engine, { runs, efforts, effortOn = defaultEffortOn }) {
  if (!sel || typeof sel !== 'object') return { pick: {}, dropped: null };
  const model = typeof sel.model === 'string' && sel.model ? sel.model : undefined;
  if (model && !runs(model)) return { pick: {}, dropped: cleanPick(sel) };
  const own = typeof sel.effort === 'string' && sel.effort ? sel.effort : undefined;
  const effort = own && (engine === 'claude' || efforts.includes(own)) ? own : (own && model ? (effortOn(own, engine) || undefined) : undefined);
  const pick = { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  return { pick, dropped: !model && own && !effort ? cleanPick(sel) : null };
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
 * absent. A requested model (or a lone effort) the engine does not run is dropped (the role runs on the node's pair) and
 * the entry keeps the request as `wanted`.
 */
export function resolveRolePicks({ roles, overlay, project, engine, runs, efforts, effortOn = defaultEffortOn }) {
  const out = {};
  const byKey = (map, key) => (map && typeof map === 'object' && Object.hasOwn(map, key) ? map[key] : null);
  for (const role of Array.isArray(roles) ? roles : []) {
    const layers = [cleanPick(byKey(overlay, role.key)), cleanPick(byKey(project, role.key)), cleanPick({ model: role.model, effort: role.effort })];
    const wanted = layerPick(layers);
    if (!wanted.model && !wanted.effort) continue;
    const at = wanted.model ? layers.findIndex((l) => l?.model) : layers.findIndex((l) => l?.effort);
    const { pick, dropped } = pickOrDrop(wanted, engine, { runs, efforts, effortOn });
    if (dropped) out[role.key] = { source: SOURCES[at], wanted };
    else if (pick.model || pick.effort) out[role.key] = { ...pick, source: SOURCES[at] };
  }
  return out;
}

/** What a dropped pick reads as, and what runs instead. */
const dropText = (w, E, instead) => (w.model ? `${w.model} is not on ${E}, runs ${instead.model}` : `effort ${w.effort} is not on ${E}, runs ${instead.effort}`);

/**
 * The run warnings for every dropped pick (`wanted`), node lines and role lines alike, each once, in node order.
 * `quietTemplate` skips template-sourced drops (a built-in workflow's own defaults are no person's pick).
 * @param {Record<string, object>} nodeCtx resolved node contexts
 * @param {{engine:string, quietTemplate?:boolean, roleLabel?:(nc:object, key:string)=>string}} opts
 * @returns {string[]}
 */
export function pickDropWarnings(nodeCtx, { engine, quietTemplate = false, roleLabel = (nc, key) => key }) {
  const E = engineLabel(engine);
  const lines = new Set();
  const named = (w) => w && typeof w === 'object' && (typeof w.model === 'string' || typeof w.effort === 'string');
  const loud = (source) => !(quietTemplate && source === 'template');
  for (const nc of Object.values(nodeCtx && typeof nodeCtx === 'object' ? nodeCtx : {})) {
    if (!nc || nc.kind !== 'agent') continue;
    const node = nc.meta?.displayName || nc.key;
    if (named(nc.wanted) && loud(nc.wanted.source)) {
      lines.add(`${node}: ${dropText(nc.wanted, E, { model: nc.model || `${E}'s default model`, effort: nc.effort ? `effort ${nc.effort}` : `${E}'s default effort` })}`);
    }
    for (const [key, rec] of Object.entries(nc.roles && typeof nc.roles === 'object' ? nc.roles : {})) {
      if (!rec || !named(rec.wanted) || !loud(rec.source)) continue;
      lines.add(`${node} · ${roleLabel(nc, key)}: ${dropText(rec.wanted, E, { model: "the node's model", effort: "the node's effort" })}`);
    }
  }
  return [...lines];
}
