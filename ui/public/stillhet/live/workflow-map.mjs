// ui/public/stillhet/live/workflow-map.mjs — dev's workflow, agent and script answers as the prototype's Workflows records
// (Stillhet slice 7 D4). Pure: no I/O. A live workflow keeps dev's template as `tpl` (the graph is drawn from it, D5) and
// its steps are derived from it; dev's ids are used verbatim (workflows/workflow:wf_full).
import { buildGraphManifest } from '../../../../src/shared/graph/manifest.mjs';
import { classifyLoops } from '../../../../src/shared/graph/loops.mjs';
import { portsFnFor } from '../../../../src/shared/graph/ports.mjs';
import { DEFAULT_MAX_CYCLES } from '../../../../src/shared/graph/constants.mjs';

// The model words the prototype's pickers use, and dev's ids (graph-entry.mjs MODEL_IDS); any other id reads as itself.
export const MODEL_IDS = Object.freeze({ 'Opus 5.5': 'claude-opus-5-5', 'Sonnet 5.5': 'claude-sonnet-5-5', 'Haiku 5.5': 'claude-haiku-5-5' });
const MODEL_WORDS = Object.fromEntries(Object.entries(MODEL_IDS).map(([k, v]) => [v, k]));
export const modelWords = (id) => (id ? MODEL_WORDS[id] || String(id) : '');
export const modelIdOf = (words) => MODEL_IDS[words] || words;
/** The words a step reads when its node sets no model: dev's run config decides it. */
export const DEFAULT_MODEL = 'its default model';
export const DEFAULT_EFFORT = 'default effort';

// Workflows that are not a person's own row: dev's built-ins (src/core/graph/builtin-workflows.mjs), the seeded rows
// (src/core/graph/seed-templates.mjs SEED_TEMPLATES) and the shipped graphs db.mjs seeds with origin NULL
// (presentation-, architecture- and promo-video-workflow.mjs). Pinned against all of them by test/stillhet-workflow-map.test.mjs.
export const NOT_OWN_IDS = Object.freeze(['wf_default', 'wf_lean_build', 'wf_memory_defrag', 'wf_shape', 'wf_full', 'wf_no-clarify', 'wf_provided-plan',
  'wf_full-no-decompose', 'wf_quick-fix', 'wf_clarify-implement', 'wf_clarify-quick-fix', 'wf_presentation', 'wf_architecture_c4', 'wf_promo_video']);
const FLOW = new Set(['and', 'or', 'combine']);
const RUNTIME = { node: 'Node.js', python: 'Python', shell: 'Shell' };
const TYPE = { producer: 'producer', verifier: 'verifier', clarifier: 'clarifier' };
const round2 = (n) => Math.round(n * 100) / 100;
const pluginOf = (origin) => (typeof origin === 'string' && origin.startsWith('plugin:') ? origin.slice(7) : '');
const keyed = (n) => n && (n.kind === 'agent' || n.kind === 'script');

/** A step's name: its own label (a rename, D6), else its agent's or script's display name, else its key. */
export function labelOf(node, agentsByKey = {}, scriptsByKey = {}) {
  if (typeof node?.config?.label === 'string' && node.config.label) return node.config.label;
  const meta = node?.kind === 'agent' ? agentsByKey[node.key] : scriptsByKey[node?.key];
  return meta?.displayName || node?.key || node?.id || '';
}

/** The keyed nodes in order from the task node, over the wires that are not loops (ties: left to right, then id). */
function orderOf(tpl, loopIds) {
  const nodes = tpl.nodes || [], ids = new Set(nodes.map((n) => n.id)), into = new Map(nodes.map((n) => [n.id, 0])), out = new Map(nodes.map((n) => [n.id, []]));
  for (const w of tpl.wires || []) {
    if (loopIds.has(w.id) || !ids.has(w.from?.node) || !ids.has(w.to?.node) || w.from.node === w.to.node) continue;
    out.get(w.from.node).push(w.to.node); into.set(w.to.node, into.get(w.to.node) + 1);
  }
  const byId = new Map(nodes.map((n) => [n.id, n])), cmp = (a, b) => (byId.get(a).x || 0) - (byId.get(b).x || 0) || (a < b ? -1 : a > b ? 1 : 0);
  let ready = nodes.filter((n) => !into.get(n.id)).map((n) => n.id).sort(cmp);
  const seen = [];
  while (ready.length) {
    const id = ready.shift(); seen.push(id);
    for (const t of out.get(id)) { into.set(t, into.get(t) - 1); if (!into.get(t)) ready.push(t); }
    ready.sort(cmp);
  }
  for (const n of nodes) if (!seen.includes(n.id)) seen.push(n.id);   // a cycle that is not a loop wire: kept, in the template's order
  return seen.map((id) => byId.get(id));
}

/** Whether the keyed nodes form one chain: no and/or/combine card, no keyed node with two non-loop successors (D7). */
function chainOf(tpl, loopIds) {
  if ((tpl.nodes || []).some((n) => FLOW.has(n.kind))) return false;
  const byId = new Map((tpl.nodes || []).map((n) => [n.id, n])), next = new Map();
  for (const w of tpl.wires || []) {
    if (loopIds.has(w.id) || w.from?.node === w.to?.node || !keyed(byId.get(w.from?.node))) continue;
    (next.get(w.from.node) || next.set(w.from.node, new Set()).get(w.from.node)).add(w.to.node);
  }
  return [...next.values()].every((s) => s.size < 2);
}

/**
 * dev's template as the prototype's workflow record (workflows.js data.workflow), plus `tpl`, `nodeIds` (parallel to
 * `steps`), `chain`, `agentsByKey` and `scriptsByKey`.
 */
export function workflowOf(tpl, { usage = {}, agentsByKey = {}, scriptsByKey = {}, pins = [] } = {}) {
  const portsFn = portsFnFor(agentsByKey, scriptsByKey), loops0 = classifyLoops(tpl, portsFn), u = usage[tpl.id] || {};
  const byId = new Map((tpl.nodes || []).map((n) => [n.id, n]));
  const steps = [], nodeIds = [];
  for (const n of orderOf(tpl, loops0.loopWireIds)) {
    if (!keyed(n)) continue;
    const cfg = n.config || {}, fig = u.nodes?.[n.id] || {};
    steps.push([labelOf(n, agentsByKey, scriptsByKey), n.key, n.kind === 'agent' ? modelWords(cfg.model) || DEFAULT_MODEL : '', n.kind === 'agent' ? cfg.effort || DEFAULT_EFFORT : '',
      Math.round(fig.minutes || 0), round2(fig.costUsd || 0), undefined, undefined, undefined, n.id]);   // [9]: its node (workflow-draft.mjs DRAFT_NODE), kept by every copy of the tuple
    nodeIds.push(n.id);
  }
  // a loop wire into a flow card (wf_full's Review → OR → Build) names the step that card feeds
  const target = (id, hops = 0) => { const n = byId.get(id); if (keyed(n) || hops > 4) return n; const w = (tpl.wires || []).find((x) => x.from?.node === id); return w ? target(w.to.node, hops + 1) : n; };
  const loops = (tpl.wires || []).filter((w) => loops0.loopWireIds.has(w.id)).map((w) => [labelOf(byId.get(w.from.node), agentsByKey, scriptsByKey), labelOf(target(w.to.node), agentsByKey, scriptsByKey), Number(w.config?.maxCycles) || DEFAULT_MAX_CYCLES]);
  const plugin = pluginOf(tpl.origin), own = !plugin && !NOT_OWN_IDS.includes(tpl.id) && tpl.createdAt !== '1970-01-01T00:00:00.000Z';
  const from = plugin ? `From the plugin ${plugin}` : !own ? 'Made with Worca' : tpl.origin === 'auto' ? 'Made in a chat' : 'Yours';
  return { id: tpl.id, title: tpl.name || tpl.id, own, domain: tpl.domain || 'coding', what: steps.length ? `${steps.map((s) => s[0]).join(', ')}.` : 'No steps yet.',
    tasks: u.tasks || 0, merged: u.merged ?? 0, from, steps, loops, ...(plugin ? { plugin } : {}), ...(u.running ? { running: true } : {}), ...(pins.includes(tpl.id) ? { pinned: true } : {}),
    tpl, nodeIds, chain: chainOf(tpl, loops0.loopWireIds), agentsByKey, scriptsByKey };
}

const portWords = (ports) => (Array.isArray(ports) && ports.length ? ports.map((p) => String(p.id).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()).join(', ') : 'nothing');

/** A registry entry (GET /api/agents) as the prototype's agent record (D15: model and effort from the .md frontmatter). */
export function agentOf(m) {
  const fm = m.frontmatter || {};
  return { id: m.key, title: m.displayName || m.key, own: m.origin === 'user', domain: m.domain || 'coding', type: TYPE[m.runnerType] || 'producer',
    ins: portWords(m.inputs), outs: portWords(m.outputs), model: modelWords(fm.model && fm.model !== 'inherit' ? fm.model : '') || DEFAULT_MODEL, effort: fm.effort || fm.fields?.effort || DEFAULT_EFFORT,
    asks: !!m.asksQuestions, fan: !!m.fanOut, ...(pluginOf(m.origin) ? { plugin: pluginOf(m.origin) } : {}) };
}

/** A script list entry (GET /api/scripts) as the prototype's script record. */
export function scriptOf(s) {
  const p = Array.isArray(s.params) ? s.params[0] : null;
  return { id: s.key, title: s.displayName || s.key, own: s.origin === 'user', domain: s.domain || 'coding', runtime: RUNTIME[s.runtime] || String(s.runtime || ''),
    what: String(s.description || '').replace(/\.$/, '') || 'A check a workflow runs', param: p ? [p.label || p.id, p.default === undefined ? 'none' : String(p.default)] : ['Settings', 'none'],
    timeout: `${Math.round((Number(s.timeoutMs) || 600000) / 1000)} s`, cases: Number(s.caseCount) || 0 };
}

/** The graph's nodes and wires, as dev's manifest has them (Invariant 5). */
export function graphModelOf(tpl, agentsByKey, opts = {}) {
  const g = buildGraphManifest(tpl, agentsByKey, opts).graph;
  return { nodes: g.nodes.map((n) => ({ id: n.id, kind: n.kind, key: n.key })), wires: g.wires.map((w) => ({ id: w.id, from: { ...w.from }, to: { ...w.to }, maxCycles: w.maxCycles })) };
}
