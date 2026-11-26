// src/shared/graph/role-slots.mjs — the ONE model-pick module: clean a pick, keep it only where its harness runs it,
// layer it (run overlay > project config > template), and resolve each declared role of a role-review node.
// A pick may pin its harness (`engine` beside `model`): that harness, not the run's, then judges it, and the engine
// travels with its model through every merge. A pick without `engine` is judged on the run's engine, as before.
// Node picks (workflows.mjs ownedPair) and role picks go through the same pickOrDrop. Pure and browser-safe.
import { effortOn as defaultEffortOn } from '../connections.mjs';
import { MODEL_ENGINE_NAMES, engineLabel } from '../engine-switch.mjs';

const MODEL_MAX = 200;   // the parseOverlayNodes bounds (src/core/run-overlay.mjs)
const EFFORT_MAX = 32;

/** The harness a pick pins: `sel.engine` when it is one of MODEL_ENGINE_NAMES and `sel.model` is a non-empty string; else null. */
export function pickEngine(sel) {
  if (!sel || typeof sel !== 'object' || typeof sel.model !== 'string' || !sel.model) return null;
  return typeof sel.engine === 'string' && MODEL_ENGINE_NAMES.includes(sel.engine) ? sel.engine : null;
}

/** A pick's model, effort and engine: model and effort trimmed; blanks, non-strings and over-long values dropped; the
 *  engine kept only when it names a harness beside the kept model. Null when nothing is left. */
export function cleanPick(sel) {
  if (!sel || typeof sel !== 'object') return null;
  const model = typeof sel.model === 'string' ? sel.model.trim() : '';
  const effort = typeof sel.effort === 'string' ? sel.effort.trim() : '';
  const kept = model && model.length <= MODEL_MAX ? model : '';
  const engine = pickEngine({ model: kept, engine: sel.engine });
  const out = {
    ...(kept ? { model: kept } : {}),
    ...(effort && effort.length <= EFFORT_MAX ? { effort } : {}),
    ...(engine ? { engine } : {}),
  };
  return Object.keys(out).length ? out : null;
}

const withoutEngine = (p) => { if (!p) return p; const { engine: _e, ...rest } = p; return rest; };

/** The pick as the run's engine runs it: a model the engine does not run drops the whole pick; a model on two
 *  harnesses keeps its own engine's efforts, and this harness takes the nearest one (effortOn).
 *  @param {{runs:(model:string)=>boolean, efforts:string[], effortOn?:Function}} env */
export function pickOnEngine(sel, engine, env) {
  return pickOrDrop(sel, engine, env).pick;
}

/** The ONE place that decides whether a pick is dropped. `pick` is what the harness runs (pickOnEngine); `dropped` is
 *  the cleaned request when it names a model the harness does not run, or only an effort the harness does not offer.
 *  env.envOf(harness) -> { runs, efforts, effortOn? } judges a pinned pick on its own harness (no `effortOn`: connections'
 *  `effortOn`), and `pick` keeps its engine. env.dropPins (an Auto run) drops a pin to another harness whole, `dropped`
 *  keeping its engine; a pin to `engine` itself is judged as the soft pick it then is.
 *  With neither, a pin is ignored: judged soft, and neither `pick` nor `dropped` carries engine.
 *  @returns {{pick:{model?:string, effort?:string, engine?:string}, dropped:{model?:string, effort?:string, engine?:string}|null}} */
export function pickOrDrop(sel, engine, { runs, efforts, effortOn = defaultEffortOn, envOf = null, dropPins = false }) {
  if (!sel || typeof sel !== 'object') return { pick: {}, dropped: null };
  const h = pickEngine(sel);
  if (h && envOf) {
    const own = h !== engine ? envOf(h) : { runs, efforts, effortOn };
    const judged = judge(sel, h, { effortOn: defaultEffortOn, ...own });
    return { pick: judged.pick.model ? { ...judged.pick, engine: h } : judged.pick, dropped: judged.dropped };
  }
  if (h && dropPins && h !== engine) return { pick: {}, dropped: cleanPick(sel) };
  const judged = judge(sel, engine, { runs, efforts, effortOn });
  return { pick: judged.pick, dropped: withoutEngine(judged.dropped) };
}

/** A pick judged on one harness: its model must run there, its effort is that harness's (or the nearest one). */
function judge(sel, engine, { runs, efforts, effortOn }) {
  const model = typeof sel.model === 'string' && sel.model ? sel.model : undefined;
  if (model && !runs(model)) return { pick: {}, dropped: cleanPick(sel) };
  const own = typeof sel.effort === 'string' && sel.effort ? sel.effort : undefined;
  const effort = own && (engine === 'claude' || efforts.includes(own)) ? own : (own && model ? (effortOn(own, engine) || undefined) : undefined);
  const pick = { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  return { pick, dropped: !model && own && !effort ? cleanPick(sel) : null };
}

/** The first layer that names a model wins, with its own effort and engine only (both travel with their model). With
 *  no model in any layer, the first defined effort wins. */
export function layerPick(layers) {
  const list = (Array.isArray(layers) ? layers : []).filter((l) => l && typeof l === 'object');
  const withModel = list.find((l) => l.model);
  if (withModel) {
    const engine = pickEngine(withModel);
    return { model: withModel.model, ...(withModel.effort ? { effort: withModel.effort } : {}), ...(engine ? { engine } : {}) };
  }
  const withEffort = list.find((l) => l.effort);
  return withEffort ? { effort: withEffort.effort } : {};
}

/** `top` over `base` key by key, except that a top naming a model and no engine leaves none of base's. */
export function overPick(base, top) {
  const out = { ...(base || {}), ...(top || {}) };
  return top?.model !== undefined && !Object.hasOwn(top, 'engine') ? withoutEngine(out) : out;
}

const SOURCES = ['run', 'project', 'slot', 'template'];

/**
 * Each declared role's pick: `{ [key]: { model?, effort?, engine?, source, wanted? } }`. A role whose layers name
 * nothing is absent. A requested model (or a lone effort) its harness does not run is dropped (the role runs on the
 * node's pair) and the entry keeps the request as `wanted`. A pinned role is judged on its own harness (`envOf`) and
 * keeps its `engine`; a soft role on the node's (`engine`, `runs`, `efforts` are the NODE's harness). Layers: run
 * overlay > project > `slot` (a helper job's pick, by role key) > the template's role pick.
 */
export function resolveRolePicks({ roles, overlay, project, slot, engine, runs, efforts, effortOn = defaultEffortOn, envOf = null, dropPins = false }) {
  const out = {};
  const byKey = (map, key) => (map && typeof map === 'object' && Object.hasOwn(map, key) ? map[key] : null);
  for (const role of Array.isArray(roles) ? roles : []) {
    const layers = [cleanPick(byKey(overlay, role.key)), cleanPick(byKey(project, role.key)), cleanPick(byKey(slot, role.key)),
      cleanPick({ model: role.model, effort: role.effort, engine: role.engine })];
    const layered = layerPick(layers);
    const wanted = envOf || dropPins ? layered : withoutEngine(layered);
    if (!wanted.model && !wanted.effort) continue;
    const at = wanted.model ? layers.findIndex((l) => l?.model) : layers.findIndex((l) => l?.effort);
    const { pick, dropped } = pickOrDrop(wanted, engine, { runs, efforts, effortOn, envOf, dropPins });
    if (dropped) out[role.key] = { source: SOURCES[at], wanted };
    else if (pick.model || pick.effort) out[role.key] = { ...pick, source: SOURCES[at] };
  }
  return out;
}

/** What a dropped pick reads as, and what runs instead. */
const dropText = (w, E, instead) => (w.model ? `${w.model} is not on ${E}, runs ${instead.model}` : `effort ${w.effort} is not on ${E}, runs ${instead.effort}`);

/**
 * The run warnings for every dropped pick (`wanted`), node lines and role lines alike, each once, in node order.
 * "is not on <X>": X is the harness the pick named, else the run's engine (a node) or its node's harness (a role);
 * "<X>'s default model": X is the node's harness, else the run's engine.
 * `quietTemplate` skips template-sourced drops (a built-in workflow's own defaults are no person's pick). A `default`
 * source (a factory default, factory-models.mjs) is never printed: nobody picked it, and its own warning names it.
 * @param {Record<string, object>} nodeCtx resolved node contexts
 * @param {{engine:string, quietTemplate?:boolean, roleLabel?:(nc:object, key:string)=>string}} opts
 * @returns {string[]}
 */
export function pickDropWarnings(nodeCtx, { engine, quietTemplate = false, roleLabel = (nc, key) => key }) {
  const lines = new Set();
  const named = (w) => w && typeof w === 'object' && (typeof w.model === 'string' || typeof w.effort === 'string');
  const loud = (source) => source !== 'default' && !(quietTemplate && source === 'template');
  for (const nc of Object.values(nodeCtx && typeof nodeCtx === 'object' ? nodeCtx : {})) {
    if (!nc || nc.kind !== 'agent') continue;
    const node = nc.meta?.displayName || nc.key;
    const N = engineLabel(nc.engine || engine);
    if (named(nc.wanted) && loud(nc.wanted.source)) {
      const W = engineLabel(nc.wanted.engine || engine);
      lines.add(`${node}: ${dropText(nc.wanted, W, { model: nc.model || `${N}'s default model`, effort: nc.effort ? `effort ${nc.effort}` : `${N}'s default effort` })}`);
    }
    for (const [key, rec] of Object.entries(nc.roles && typeof nc.roles === 'object' ? nc.roles : {})) {
      if (!rec || !named(rec.wanted) || !loud(rec.source)) continue;
      const W = engineLabel(rec.wanted.engine || nc.engine || engine);
      lines.add(`${node} · ${roleLabel(nc, key)}: ${dropText(rec.wanted, W, { model: "the node's model", effort: "the node's effort" })}`);
    }
  }
  return [...lines];
}

/** One line per pin an Auto run dropped (a `wanted` that carries `engine`), node lines and role lines, each once.
 *  An Auto run uses one harness, so the step runs on the run's engine instead. */
export function autoPinWarnings(nodeCtx, { engine, roleLabel = (nc, key) => key }) {
  const D = engineLabel(engine);
  const lines = new Set();
  const pinned = (w) => w && typeof w === 'object' && typeof w.engine === 'string' && w.engine;
  for (const nc of Object.values(nodeCtx && typeof nodeCtx === 'object' ? nodeCtx : {})) {
    if (!nc || nc.kind !== 'agent') continue;
    const node = nc.meta?.displayName || nc.key;
    if (pinned(nc.wanted)) {
      lines.add(`${node}: set to ${engineLabel(nc.wanted.engine)}, but an Auto run uses one harness, so it runs ${nc.model || `${D}'s default model`} on ${D}`);
    }
    for (const [key, rec] of Object.entries(nc.roles && typeof nc.roles === 'object' ? nc.roles : {})) {
      if (!rec || !pinned(rec.wanted)) continue;
      lines.add(`${node} · ${roleLabel(nc, key)}: set to ${engineLabel(rec.wanted.engine)}, but an Auto run uses one harness, so it runs the node's model on ${D}`);
    }
  }
  return [...lines];
}
