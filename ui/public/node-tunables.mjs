// ui/public/node-tunables.mjs — PURE tunables resolution (no DOM, no fetch),
// shared by the New Pipeline agents accordion (app.js) and the Ask Worca run card
// (ask-panel.mjs). The two panels must never drift: this is the one definition.
// Moved verbatim out of app.js (2026-09-06); app.js keeps thin wrappers that add
// its own ports source (panelPortsFn, which can fall back to the Composer index).
import { classifyLoops } from '../../src/shared/graph/loops.mjs';
import { portsFnFor } from '../../src/shared/graph/ports.mjs';
import { runsOn } from '../../src/shared/connections.mjs';
import { roleReviewOf } from '../../src/shared/graph/role-review-step.mjs';
import { cleanPick, layerPick } from '../../src/shared/graph/role-slots.mjs';

function catalogEntryOf(catalog, id) {
  if (!id || !catalog) return null;
  const lc = String(id).toLowerCase();
  return catalog.find((m) => m && typeof m.id === 'string' && m.id.toLowerCase() === lc) || null;
}

const withoutEngine = ({ engine: _e, ...rest }) => rest;

export function healForEngine(t, { models, engine } = {}) {
  const catalog = Array.isArray(models) && models.length ? models : null;
  if (!catalog) return { t, enginePair: null };
  // A pick its harness cannot run (its connection reaches other harnesses only) — src/shared/connections.mjs. A pinned
  // pick (`engine`) is judged against its own harness, a soft one against the run's; neither known heals nothing.
  const foreign = (id, own) => {
    const on = own || engine;
    if (!on) return false;
    const hit = catalogEntryOf(catalog, id);
    return !!hit && !runsOn(hit, on);
  };
  const def = foreign(t.def.model, t.def.engine) ? { ...withoutEngine(t.def), model: '', effort: '' } : t.def;
  if (!foreign(t.model, t.engine)) return { t: { ...t, def }, enginePair: null };
  const stored = t.override.model !== undefined && foreign(t.override.model, t.override.engine)
    ? { model: t.override.model, effort: t.override.effort || '', ...(t.override.engine ? { engine: t.override.engine } : {}) } : null;
  return { t: { ...withoutEngine(t), def, model: def.model, effort: def.effort, ...(def.engine ? { engine: def.engine } : {}) }, enginePair: stored };
}

/** The project's pick for a node: the node entry over the legacy per-role step key by key, except `engine`, which
 *  travels with its model: taken from whichever of the two names the winning model (else none). */
function projectPick(legacy, entry) {
  const out = { ...(legacy || {}), ...(entry || {}) };
  delete out.engine;
  const winner = entry && entry.model !== undefined ? entry : legacy;
  if (winner && typeof winner.model === 'string' && winner.model && typeof winner.engine === 'string' && winner.engine) out.engine = winner.engine;
  return out;
}

// Flatten workflow.steps[][] into an ordered list of node rows, joining each
// node's role `key` to its registry metadata (label/color) and resolving every
// setting through the four layers (newpipeline-ux-design.md §4.3):
//   1. the per-project override — run-config nodes[nodeId], or, for the built-in
//      Default workflow, the legacy per-role opts.legacySteps[key];
//   2. the workflow's own node.defaults;
//   3. the agent-registry sidecar (fanOut / questionsDefault);
//   4. nothing configured — the CLI default.
// Order = outer (sequential) then inner (parallel) — exactly the dispatch order.
// An `engine` (the harness a pick names) travels with its model through every layer: the layer whose model wins
// gives the row its engine, or none (the run's default harness).
//
// model/effort/fanOut/askQuestions on the returned row are the EFFECTIVE values
// (what the run will use). `def` carries the same four resolved WITHOUT layer 1,
// so the renderer can mark deviation and the writer can prune a redundant save
// back to "inherit". `override` is layer 1 verbatim.
export function buildNodeConfigRows(workflow, registry, runConfig, opts = {}) {
  if (workflow && workflow.version === 2) return buildGraphNodeRows(workflow, registry, runConfig, opts);
  const steps = Array.isArray(workflow && workflow.steps) ? workflow.steps : [];
  const reg = registry || {};
  const nodes = (runConfig && runConfig.nodes) || {};
  const legacySteps = opts.legacySteps || null; // wf_default only: per-ROLE storage
  const rows = [];
  steps.forEach((group, stepIndex) => {
    const members = Array.isArray(group) ? group : [];
    members.forEach((node) => {
      if (!node || !node.id) return;
      const meta = reg[node.key] || null;
      // The Default workflow's overrides live under the role key; a saved
      // workflow's under the node-instance id. Both can exist for wf_default
      // (a node write wins, mirroring resolveWorkflow's firstDefined order).
      const role = legacySteps ? node.key : null;
      const saved = projectPick(role ? legacySteps[role] : null, nodes[node.id]);
      const wfDef = (node.defaults && typeof node.defaults === 'object') ? node.defaults : {};
      const metaFan = meta && typeof meta.fanOut === 'boolean' ? meta.fanOut : false;
      const metaAsks = !!(meta && meta.asksQuestions);
      const metaLocked = !!(meta && meta.questionsLocked);
      const metaQDefault = !!(meta && meta.questionsDefault);

      const healed = healForEngine(resolveNodeTunables(saved, wfDef, { fanOut: metaFan, questionsDefault: metaQDefault }), opts);
      const t = healed.t;

      rows.push({
        nodeId: node.id,
        key: node.key,
        role, // non-null => persist via the legacy per-role path (saveStep)
        label: (meta && meta.displayName) || node.key || node.id,
        color: (meta && meta.color) || '',
        description: (meta && meta.description) || '',
        stepIndex,
        parallel: members.length > 1,
        model: t.model,
        effort: t.effort,
        ...(t.engine ? { engine: t.engine } : {}),
        fanOut: t.fanOut,
        subagentModel: t.subagentModel,
        // null => the agent has no questions capability (no checkbox rendered).
        askQuestions: !metaAsks ? null : (metaLocked ? metaQDefault : t.askQuestions),
        questionsLocked: metaAsks && metaLocked,
        def: t.def,
        override: t.override,
        // A locked questions toggle is never the user's doing, so it never counts
        // as a modification (it cannot be reset either).
        modified: modifiedFieldsOf(t, t.def,
          { asksQuestions: metaAsks, questionsLocked: metaLocked }).length > 0,
        ...(healed.enginePair ? { enginePair: healed.enginePair } : {}),
      });
    });
  });
  return rows;
}

// ONE resolution rule for a node's five tunables, shared verbatim by the v1
// (buildNodeConfigRows) and v2 (buildGraphNodeRows) row builders — the two
// panels must never drift (the v2 path is the one every live workflow uses).
// `saved` = the per-project override entry (role + node merged), `wfDef` = the
// workflow's own defaults block (node.defaults in v1, node.config in v2),
// `caps` = the registry meta's capability booleans.
export function resolveNodeTunables(saved, wfDef, caps = {}) {
  const override = {};
  if (typeof saved.model === 'string' && saved.model) override.model = saved.model;
  if (typeof saved.effort === 'string' && saved.effort) override.effort = saved.effort;
  if (typeof saved.fanOut === 'boolean') override.fanOut = saved.fanOut;
  if (typeof saved.askQuestions === 'boolean') override.askQuestions = saved.askQuestions;
  if (typeof saved.subagentModel === 'string' && saved.subagentModel) override.subagentModel = saved.subagentModel;
  // A harness is valid only beside a model.
  if (override.model !== undefined && typeof saved.engine === 'string' && saved.engine) override.engine = saved.engine;
  const defEngine = typeof wfDef.model === 'string' && wfDef.model && typeof wfDef.engine === 'string' && wfDef.engine ? wfDef.engine : '';

  // Layers 2-4 alone: what this row falls back to once its override is gone.
  const def = {
    model: typeof wfDef.model === 'string' ? wfDef.model : '',
    effort: typeof wfDef.model === 'string' && typeof wfDef.effort === 'string' ? wfDef.effort : '',
    fanOut: typeof wfDef.fanOut === 'boolean' ? wfDef.fanOut : !!caps.fanOut,
    askQuestions: typeof wfDef.askQuestions === 'boolean' ? wfDef.askQuestions : !!caps.questionsDefault,
    // No sidecar layer: an agent manifest declares whether a node CAN fan out,
    // never what its children run on. '' = unset (the run resolves auto).
    subagentModel: typeof wfDef.subagentModel === 'string' ? wfDef.subagentModel : '',
    ...(defEngine ? { engine: defEngine } : {}),
  };

  // An effort is only meaningful for the model that advertises it, so an
  // override naming its own model does not inherit the default's effort.
  const model = override.model !== undefined ? override.model : def.model;
  const effort = override.effort !== undefined
    ? override.effort
    : (override.model !== undefined ? '' : def.effort);
  const fanOut = override.fanOut !== undefined ? override.fanOut : def.fanOut;
  const askQuestions = override.askQuestions !== undefined ? override.askQuestions : def.askQuestions;
  const subagentModel = override.subagentModel !== undefined ? override.subagentModel : def.subagentModel;
  // The harness travels with the model that wins.
  const engine = override.model !== undefined ? override.engine : def.engine;
  return { override, def, model, effort, ...(engine ? { engine } : {}), fanOut, askQuestions, subagentModel };
}

// Which of the five settings deviate from the row's resolved default. Pure; the
// single definition of "modified" for both the row dot and the header count.
export function modifiedFieldsOf(effective, def, caps = {}) {
  const out = [];
  if ((effective.model || '') !== (def.model || '')) out.push('model');
  if ((effective.effort || '') !== (def.effort || '')) out.push('effort');
  if ((effective.engine || '') !== (def.engine || '')) out.push('engine');
  if (!!effective.fanOut !== !!def.fanOut) out.push('fanOut');
  if ((effective.subagentModel || '') !== (def.subagentModel || '')) out.push('subagentModel');
  if (caps.asksQuestions && !caps.questionsLocked && !!effective.askQuestions !== !!def.askQuestions) {
    out.push('askQuestions');
  }
  return out;
}

// Prune a row's would-be selection against its resolved default (§4.5): a value
// equal to the default is stored as "inherit" instead — '' clears a model/effort,
// null clears a boolean toggle (config.mjs#inheritOr). Returns the patch to send.
// `next` carries only the fields the caller is changing; the rest ride along at
// their current effective value so the setters' replace semantics cannot wipe them.
export function pruneNodeSelection(row, next = {}) {
  const eff = {
    model: next.model !== undefined ? next.model : row.model,
    effort: next.effort !== undefined ? next.effort : row.effort,
    engine: next.engine ?? row.engine,
    fanOut: next.fanOut !== undefined ? next.fanOut : row.fanOut,
    askQuestions: next.askQuestions !== undefined ? next.askQuestions : row.askQuestions,
    subagentModel: next.subagentModel !== undefined ? next.subagentModel : row.subagentModel,
  };
  // model+effort prune as a PAIR: an effort is only interpretable against the
  // model that advertises it, so storing one without the other is rejected by
  // the setters ("select a model before choosing an effort").
  const inheritPair = (eff.model || '') === (row.def.model || '')
    && (eff.effort || '') === (row.def.effort || '')
    && (eff.engine || '') === (row.def.engine || '');
  // A PINNED row (Settings › Memory owns the pair) never edits model/effort, and the setters
  // REPLACE both on every save: re-send the project's own stored pick untouched, so saving
  // another tunable cannot erase it — it applies again the moment the setting is cleared.
  // A pick of the other engine (healed off this run's rows) is re-sent the same way while the
  // row's model and effort are left as shown: the New pipeline save passes the live controls,
  // so "untouched" is "equal to the healed row", not "absent". A pinned pick (`engine`) rides the same way: the pair
  // carries its harness, and a pick whose model left its harness goes back with it (the server keeps it unchecked).
  const untouched = (next.model === undefined || (next.model || '') === (row.model || ''))
    && (next.effort === undefined || (next.effort || '') === (row.effort || ''))
    && (next.engine === undefined || (next.engine || '') === (row.engine || ''));
  const kept = row.pinned && row.storedPair ? row.storedPair
    : (row.enginePair && untouched ? row.enginePair : null);
  const engine = kept ? (kept.engine || '') : (inheritPair || !eff.model ? '' : (eff.engine || ''));
  // `engine` goes only when there is one, or as '' to clear a stored one; else no key (the server keeps nothing).
  const sendEngine = engine || (row.override && row.override.engine) || (row.storedPair && row.storedPair.engine);
  return {
    model: kept ? kept.model : (inheritPair ? '' : (eff.model || '')),
    effort: kept ? kept.effort : (inheritPair || !eff.model ? '' : eff.effort),
    ...(sendEngine ? { engine } : {}),
    fanOut: !!eff.fanOut === !!row.def.fanOut ? null : !!eff.fanOut,
    askQuestions: row.askQuestions === null || row.questionsLocked
      ? undefined // no capability / locked: never persist a value for it
      : (!!eff.askQuestions === !!row.def.askQuestions ? null : !!eff.askQuestions),
    // '' IS the clear for a string tunable (config.mjs#inheritOrSubagentModel), so
    // a value equal to the default prunes to inherit exactly like model/effort.
    subagentModel: (eff.subagentModel || '') === (row.def.subagentModel || '') ? '' : (eff.subagentModel || ''),
  };
}

// v2: agent nodes only, in condensation-topo launch order (loop wires excluded
// from the ranking, exactly as the scheduler orders launches). The four config
// layers are the same as v1: run-config nodes[nodeId] -> template node.config ->
// sidecar -> hard default. A Settings step slot fills over a soft workflow pick as
// today, and skips a pinned one (a pick with `engine` counts as set, the server's rule 6).
export function buildGraphNodeRows(tpl, registry, runConfig, opts = {}) {
  const reg = registry || {};
  const nodes = (runConfig && runConfig.nodes) || {};
  // wf_default only: the legacy per-ROLE storage, layered under the per-node one
  // exactly as resolveGraph does (sel -> legacy -> node config).
  const legacySteps = opts.legacySteps || null;
  // app.js hands its own panelPortsFn (falls back to the Composer's index for
  // agents the palette omits); the card and the tests use the registry alone.
  const portsFn = typeof opts.portsFn === 'function' ? opts.portsFn : portsFnFor(reg);
  // Settings › Memory (the built-in Memory defragment workflow only): GET /api/workflows/:id
  // stamps `pinnedAgentModel` when a valid pair is stored, and every run of the workflow then
  // uses it for every agent node whatever the project picked (resolveGraph `agentPair`). So the
  // rows SHOW the pair as the default and carry `pinned`; both renderers lock model and effort —
  // an editable model the run ignores would be a control that lies.
  const pin = tpl && tpl.pinnedAgentModel && typeof tpl.pinnedAgentModel.model === 'string' && tpl.pinnedAgentModel.model
    ? tpl.pinnedAgentModel : null;
  const withoutPair = ({ model: _m, effort: _e, engine: _g, ...rest }) => rest;
  // A pinned row re-sends the project's hidden pick on every save (pruneNodeSelection), and the
  // setter refuses a model that left the catalog or an effort it no longer offers — so heal the
  // pick against the catalog the caller holds (`opts.models`), dropping exactly what an unpinned
  // row's selects would drop. No catalog (not loaded yet) → the pick as stored.
  const catalog = Array.isArray(opts.models) && opts.models.length ? opts.models : null;
  const healPair = (model, effort, engine) => {
    const eng = model && typeof engine === 'string' && engine ? { engine } : {};
    if (!model || !catalog) return { model: model || '', effort: (model && effort) || '', ...eng };
    const hit = catalog.find((m) => m && m.id === model);
    if (!hit) return { model: '', effort: '' };
    return { model, effort: effort && Array.isArray(hit.efforts) && hit.efforts.includes(effort) ? effort : '', ...eng };
  };
  const order = classifyLoops(tpl, portsFn).launchOrder;
  const byId = new Map(tpl.nodes.map((n) => [n.id, n]));
  const rank = new Map(order.map((id, i) => [id, i]));
  const agentNodes = order.map((id) => byId.get(id)).filter((n) => n && n.kind === 'agent');
  const rows = [];
  for (const node of agentNodes) {
    const meta = reg[node.key] || null;
    const role = legacySteps ? node.key : null;
    const stored = projectPick(role ? legacySteps[role] : null, nodes[node.id]);
    const authored = (node.config && typeof node.config === 'object') ? node.config : {};
    const saved = pin ? withoutPair(stored) : stored;
    const authoredPinned = typeof authored.model === 'string' && !!authored.model && typeof authored.engine === 'string' && !!authored.engine;
    const slot = !pin && !authoredPinned && opts.slotDefaults && node.key ? opts.slotDefaults[node.key] : null;
    const wfDef = pin
      ? { ...withoutPair(authored), model: pin.model, ...(typeof pin.effort === 'string' && pin.effort ? { effort: pin.effort } : {}) }
      : (slot && (slot.model || slot.effort) ? { ...withoutPair(authored), ...(slot.model ? { model: slot.model } : {}), ...(slot.effort ? { effort: slot.effort } : {}) } : authored);
    const metaFan = meta && typeof meta.fanOut === 'boolean' ? meta.fanOut : false;
    const metaAsks = !!(meta && meta.asksQuestions);
    const metaLocked = !!(meta && meta.questionsLocked);
    const metaQDefault = !!(meta && meta.questionsDefault);
    const healed = healForEngine(resolveNodeTunables(saved, wfDef, { fanOut: metaFan, questionsDefault: metaQDefault }), opts);
    const t = healed.t;
    rows.push({
      nodeId: node.id, key: node.key, role, // non-null => persist via saveStep (wf_default)
      label: (meta && meta.displayName) || node.key || node.id,
      color: (meta && meta.color) || '', description: (meta && meta.description) || '',
      stepIndex: rank.get(node.id) || 0,
      parallel: false,
      model: t.model, effort: t.effort, ...(t.engine ? { engine: t.engine } : {}), fanOut: t.fanOut, subagentModel: t.subagentModel,
      askQuestions: !metaAsks ? null : (metaLocked ? metaQDefault : t.askQuestions),
      questionsLocked: metaAsks && metaLocked,
      def: t.def, override: t.override,
      modified: modifiedFieldsOf(t, t.def,
        { asksQuestions: metaAsks, questionsLocked: metaLocked }).length > 0,
      // `storedPair`: the project's own pick the pin hides — pruneNodeSelection re-sends it.
      ...(pin ? { pinned: 'settings', storedPair: healPair(stored.model, stored.effort, stored.engine) } : {}),
      ...(healed.enginePair ? { enginePair: healed.enginePair } : {}),
    });
  }
  return rows;
}

// One row per declared role of every agent node that runs a role review (roleReviewOf), in the node rows' order:
// `${node label} · ${role label}`. `def` is the project's role pick (runConfig.nodes[id].roles[key]) else the
// template's; '' = the node's setting. Not Shaper-specific: any workflow whose node config declares roles gets rows.
export function buildRoleRows(workflow, nodeRows, runConfig) {
  const byId = new Map((Array.isArray(workflow && workflow.nodes) ? workflow.nodes : []).map((n) => [n && n.id, n]));
  const saved = (runConfig && runConfig.nodes) || {};
  const rows = [];
  for (const nr of Array.isArray(nodeRows) ? nodeRows : []) {
    const node = byId.get(nr.nodeId);
    const spec = node && node.kind === 'agent' ? roleReviewOf(node.config) : null;
    if (!spec) continue;
    const project = saved[nr.nodeId] && saved[nr.nodeId].roles && typeof saved[nr.nodeId].roles === 'object' ? saved[nr.nodeId].roles : {};
    for (const role of spec.roles) {
      const pick = layerPick([cleanPick(Object.hasOwn(project, role.key) ? project[role.key] : null), cleanPick(role)]);
      // layerPick keeps the engine of the layer whose model it chose.
      const def = { model: pick.model || '', effort: pick.effort || '', ...(pick.engine ? { engine: pick.engine } : {}) };
      rows.push({ nodeId: nr.nodeId, roleKey: role.key, label: `${nr.label} · ${role.label}`, model: def.model, effort: def.effort,
        ...(def.engine ? { engine: def.engine } : {}), def });
    }
  }
  return rows;
}
