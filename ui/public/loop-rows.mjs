// ui/public/loop-rows.mjs — PURE row builders for a workflow's per-loop cycle budgets (no DOM, no fetch, no
// module globals). New Pipeline's panel (app.js) and the requirements run-setup overlay both build their loop
// rows here; the caller passes the scripts index and the ports function explicitly.
import { FLOW_LABEL, KEYED_KINDS } from '../../src/shared/graph/constants.mjs';
import { classifyLoops } from '../../src/shared/graph/loops.mjs';

// Flatten workflow.feedbacks into row data for the per-loop cycle-count inputs,
// overlaying the run-config's saved maxCycles (default 3 when unset). Resolves each
// loop's endpoints (node ids like "s2_0") to human agent names via the registry +
// workflow.steps, and precomputes the directional `label`:
//   - normal loop:  "<toName> ← <fromName>"   (feedback points to <- from)
//   - self loop:    "<name> ↺ (self loop)"    (from === to)
// A "(step N)" suffix (1-based) disambiguates an endpoint whose display name is shared
// by more than one node in the workflow. Unknown ids fall back to the raw id.

// `scriptReg` is the scripts index (key → script meta); `portsFn(node)` resolves a node's ports (classifyLoops).
// v2: one row per LOOP wire (a plain wire has no budget — V13). Labels reuse the
// v1 vocabulary: "<toName> ← <fromName>", "(step N)" only when a name repeats.
export function buildGraphWireRows(tpl, registry, runConfig, scriptReg, portsFn) {
  const reg = registry || {};
  const scripts = scriptReg || {};
  const saved = (runConfig && runConfig.wires) || {};
  const { loopWireIds, launchOrder } = classifyLoops(tpl, portsFn);
  const byId = new Map(tpl.nodes.map((n) => [n.id, n]));
  const rank = new Map(launchOrder.map((id, i) => [id, i]));
  const nameCount = new Map();
  const nameOf = (id) => {
    const n = byId.get(id);
    if (!n) return id;
    // A flow card has no registry meta and no key: name it from the SHARED
    // FLOW_LABEL table the manifest uses, never from its raw n_* id (MAJ-21).
    if (!KEYED_KINDS.includes(n.kind)) return FLOW_LABEL[n.kind] || n.kind;
    // A script card is keyed too: its name comes from the script registry the panel fetched, else its key.
    const meta = reg[n.key] || scripts[n.key];
    return (meta && meta.displayName) || n.key || n.id;
  };
  for (const n of tpl.nodes) nameCount.set(nameOf(n.id), (nameCount.get(nameOf(n.id)) || 0) + 1);
  const labelFor = (id) => {
    const nm = nameOf(id);
    return (nameCount.get(nm) || 0) > 1 ? `${nm} (step ${(rank.get(id) || 0) + 1})` : nm;
  };
  return tpl.wires.filter((w) => loopWireIds.has(w.id)).map((w) => {
    const rc = saved[w.id] || {};
    const n = Number(rc.maxCycles);
    const cfg = Number(w.config && w.config.maxCycles);
    const fromLabel = labelFor(w.from.node);
    const toLabel = labelFor(w.to.node);
    const selfLoop = w.from.node === w.to.node;
    return {
      fbId: w.id, from: w.from.node, to: w.to.node, fromLabel, toLabel, selfLoop,
      label: selfLoop ? `${toLabel} ↺ (self loop)` : `${toLabel} ← ${fromLabel}`,
      maxCycles: Number.isFinite(n) && n >= 1 ? n : (Number.isFinite(cfg) && cfg >= 1 ? cfg : 3),
    };
  });
}

export function buildFeedbackRows(workflow, registry, runConfig, scriptReg, portsFn) {
  if (workflow && workflow.version === 2) return buildGraphWireRows(workflow, registry, runConfig, scriptReg, portsFn);
  const steps = Array.isArray(workflow && workflow.steps) ? workflow.steps : [];
  const fbs = Array.isArray(workflow && workflow.feedbacks) ? workflow.feedbacks : [];
  const reg = registry || {};
  const saved = (runConfig && runConfig.feedbacks) || {};

  // node id -> { name, step } (1-based) + a display-name frequency map so the
  // "(step N)" suffix is added only when a name is non-unique.
  const byId = new Map();
  const nameCount = new Map();
  steps.forEach((group, stepIndex) => {
    (Array.isArray(group) ? group : []).forEach((node) => {
      if (!node || !node.id) return;
      const meta = reg[node.key] || null;
      const name = (meta && meta.displayName) || node.key || node.id; // mirror buildNodeConfigRows
      byId.set(node.id, { name, step: stepIndex + 1 });
      nameCount.set(name, (nameCount.get(name) || 0) + 1);
    });
  });

  // Endpoint label: display name, disambiguated with "(step N)" when that name is
  // shared by >1 node. Ids absent from steps fall back to the raw id (never blank).
  const labelFor = (nodeId) => {
    const info = byId.get(nodeId);
    if (!info) return nodeId;
    return (nameCount.get(info.name) || 0) > 1 ? `${info.name} (step ${info.step})` : info.name;
  };

  return fbs.map((fb) => {
    const rc = saved[fb.id] || {};
    const n = Number(rc.maxCycles);
    const fromLabel = labelFor(fb.from);
    const toLabel = labelFor(fb.to);
    const selfLoop = fb.from === fb.to;
    const label = selfLoop ? `${toLabel} ↺ (self loop)` : `${toLabel} ← ${fromLabel}`;
    return {
      fbId: fb.id,
      from: fb.from,
      to: fb.to,
      fromLabel,
      toLabel,
      selfLoop,
      label,
      maxCycles: Number.isFinite(n) && n >= 1 ? n : 3,
    };
  });
}
