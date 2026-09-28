// ui/public/node-tunables.mjs — PURE tunables resolution (no DOM, no fetch),
// shared by the New Pipeline agents accordion (app.js) and the Ask Worca run card
// (ask-panel.mjs). The two panels must never drift: this is the one definition.
// Moved verbatim out of app.js (2026-09-06); app.js keeps thin wrappers that add
// its own ports source (panelPortsFn, which can fall back to the Composer index).
import { classifyLoops } from '../../src/shared/graph/loops.mjs';
import { portsFnFor } from '../../src/shared/graph/ports.mjs';

// Flatten workflow.steps[][] into an ordered list of node rows, joining each
// node's role `key` to its registry metadata (label/color) and resolving every
// setting through the four layers (newpipeline-ux-design.md §4.3):
//   1. the per-project override — run-config nodes[nodeId], or, for the built-in
//      Default workflow, the legacy per-role opts.legacySteps[key];
//   2. the workflow's own node.defaults;
//   3. the agent-registry sidecar (fanOut / questionsDefault);
//   4. nothing configured — the CLI default.
// Order = outer (sequential) then inner (parallel) — exactly the dispatch order.
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
      const saved = { ...(role ? legacySteps[role] : null), ...nodes[node.id] };
      const wfDef = (node.defaults && typeof node.defaults === 'object') ? node.defaults : {};
      const metaFan = meta && typeof meta.fanOut === 'boolean' ? meta.fanOut : false;
      const metaAsks = !!(meta && meta.asksQuestions);
      const metaLocked = !!(meta && meta.questionsLocked);
      const metaQDefault = !!(meta && meta.questionsDefault);

      const t = resolveNodeTunables(saved, wfDef, { fanOut: metaFan, questionsDefault: metaQDefault });

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

  // Layers 2-4 alone: what this row falls back to once its override is gone.
  const def = {
    model: typeof wfDef.model === 'string' ? wfDef.model : '',
    effort: typeof wfDef.model === 'string' && typeof wfDef.effort === 'string' ? wfDef.effort : '',
    fanOut: typeof wfDef.fanOut === 'boolean' ? wfDef.fanOut : !!caps.fanOut,
    askQuestions: typeof wfDef.askQuestions === 'boolean' ? wfDef.askQuestions : !!caps.questionsDefault,
    // No sidecar layer: an agent manifest declares whether a node CAN fan out,
    // never what its children run on. '' = unset (the run resolves auto).
    subagentModel: typeof wfDef.subagentModel === 'string' ? wfDef.subagentModel : '',
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
  return { override, def, model, effort, fanOut, askQuestions, subagentModel };
}

// Which of the five settings deviate from the row's resolved default. Pure; the
// single definition of "modified" for both the row dot and the header count.
export function modifiedFieldsOf(effective, def, caps = {}) {
  const out = [];
  if ((effective.model || '') !== (def.model || '')) out.push('model');
  if ((effective.effort || '') !== (def.effort || '')) out.push('effort');
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
    fanOut: next.fanOut !== undefined ? next.fanOut : row.fanOut,
    askQuestions: next.askQuestions !== undefined ? next.askQuestions : row.askQuestions,
    subagentModel: next.subagentModel !== undefined ? next.subagentModel : row.subagentModel,
  };
  // model+effort prune as a PAIR: an effort is only interpretable against the
  // model that advertises it, so storing one without the other is rejected by
  // the setters ("select a model before choosing an effort").
  const inheritPair = (eff.model || '') === (row.def.model || '')
    && (eff.effort || '') === (row.def.effort || '');
  // A PINNED row (Settings › Memory owns the pair) never edits model/effort, and the setters
  // REPLACE both on every save: re-send the project's own stored pick untouched, so saving
  // another tunable cannot erase it — it applies again the moment the setting is cleared.
  const kept = row.pinned && row.storedPair ? row.storedPair : null;
  return {
    model: kept ? kept.model : (inheritPair ? '' : (eff.model || '')),
    effort: kept ? kept.effort : (inheritPair || !eff.model ? '' : eff.effort),
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
// sidecar -> hard default.
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
  const withoutPair = ({ model: _m, effort: _e, ...rest }) => rest;
  // A pinned row re-sends the project's hidden pick on every save (pruneNodeSelection), and the
  // setter refuses a model that left the catalog or an effort it no longer offers — so heal the
  // pick against the catalog the caller holds (`opts.models`), dropping exactly what an unpinned
  // row's selects would drop. No catalog (not loaded yet) → the pick as stored.
  const catalog = Array.isArray(opts.models) && opts.models.length ? opts.models : null;
  const healPair = (model, effort) => {
    if (!model || !catalog) return { model: model || '', effort: (model && effort) || '' };
    const hit = catalog.find((m) => m && m.id === model);
    if (!hit) return { model: '', effort: '' };
    return { model, effort: effort && Array.isArray(hit.efforts) && hit.efforts.includes(effort) ? effort : '' };
  };
  const order = classifyLoops(tpl, portsFn).launchOrder;
  const byId = new Map(tpl.nodes.map((n) => [n.id, n]));
  const rank = new Map(order.map((id, i) => [id, i]));
  const agentNodes = order.map((id) => byId.get(id)).filter((n) => n && n.kind === 'agent');
  const rows = [];
  for (const node of agentNodes) {
    const meta = reg[node.key] || null;
    const role = legacySteps ? node.key : null;
    const stored = { ...(role ? legacySteps[role] : null), ...nodes[node.id] };
    const authored = (node.config && typeof node.config === 'object') ? node.config : {};
    const saved = pin ? withoutPair(stored) : stored;
    const wfDef = pin
      ? { ...withoutPair(authored), model: pin.model, ...(typeof pin.effort === 'string' && pin.effort ? { effort: pin.effort } : {}) }
      : authored;
    const metaFan = meta && typeof meta.fanOut === 'boolean' ? meta.fanOut : false;
    const metaAsks = !!(meta && meta.asksQuestions);
    const metaLocked = !!(meta && meta.questionsLocked);
    const metaQDefault = !!(meta && meta.questionsDefault);
    const t = resolveNodeTunables(saved, wfDef, { fanOut: metaFan, questionsDefault: metaQDefault });
    rows.push({
      nodeId: node.id, key: node.key, role, // non-null => persist via saveStep (wf_default)
      label: (meta && meta.displayName) || node.key || node.id,
      color: (meta && meta.color) || '', description: (meta && meta.description) || '',
      stepIndex: rank.get(node.id) || 0,
      parallel: false,
      model: t.model, effort: t.effort, fanOut: t.fanOut, subagentModel: t.subagentModel,
      askQuestions: !metaAsks ? null : (metaLocked ? metaQDefault : t.askQuestions),
      questionsLocked: metaAsks && metaLocked,
      def: t.def, override: t.override,
      modified: modifiedFieldsOf(t, t.def,
        { asksQuestions: metaAsks, questionsLocked: metaLocked }).length > 0,
      // `storedPair`: the project's own pick the pin hides — pruneNodeSelection re-sends it.
      ...(pin ? { pinned: 'settings', storedPair: healPair(stored.model, stored.effort) } : {}),
    });
  }
  return rows;
}
