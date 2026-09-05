// The `workflow` question payload (spec §5.3/§5.4) and the sanitiser for its
// answer. Pure: the orchestrator hands in the template (new or matched), the
// per-node tunables and the registry slice, and gets back exactly what the CLI
// and the browser render.
import { buildGraphManifest } from '../../shared/graph/manifest.mjs';
import { cleanText } from '../../shared/graph/assemble.mjs';
import { slugify } from '../artifacts.mjs';
import { GRAPH_DEFAULT_WORKFLOW, AUTO_WORKFLOW_ID } from '../workflows.mjs';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Tunables keyed by assembled node ids -> keyed by the matched row's node ids. */
export function remapTunables(tunables, nodeMap) {
  const out = {};
  for (const [id, sel] of Object.entries(tunables || {})) {
    const to = nodeMap?.get?.(id);
    if (to) out[to] = { ...sel };
  }
  return out;
}

/**
 * @param {{round:number, shape:object, template:object, match:{id:string,name:string}|null,
 *          tunables:Record<string,object>, registry:Record<string,object>,
 *          models:Array<{id:string,label?:string,efforts?:string[],hidden?:boolean}>, warnings?:Array, costUsd?:number,
 *          fingerprint?:string, ignoredProjectOverrides?:boolean}} o
 */
export function buildProposal({ round, shape, template, match = null, tunables = {}, registry = {}, models = [], warnings = [], costUsd = 0, fingerprint = '', ignoredProjectOverrides = false }) {
  const name = shape?.name || template?.name || 'Auto workflow';
  const agentsByKey = {};
  for (const n of template.nodes || []) if (n.kind === 'agent' && registry[n.key]) agentsByKey[n.key] = registry[n.key];
  const manifest = buildGraphManifest({ ...template, id: match ? match.id : AUTO_WORKFLOW_ID, name }, agentsByKey, { overlays: { nodes: tunables } });
  const nodes = {};
  for (const n of template.nodes || []) {
    if (n.kind !== 'agent') continue;
    const meta = registry[n.key] || {};
    const cfg = n.config || {};
    const t = tunables[n.id] || {};
    const asks = !!meta.asksQuestions;
    nodes[n.id] = {
      key: n.key,
      label: meta.displayName || n.key,
      model: t.model ?? cfg.model ?? '',
      effort: t.effort ?? cfg.effort ?? '',
      fanOut: !!(t.fanOut ?? cfg.fanOut ?? meta.fanOut ?? false),
      askQuestions: asks ? (meta.questionsLocked ? !!meta.questionsDefault : !!(t.askQuestions ?? cfg.askQuestions ?? meta.questionsDefault ?? false)) : false,
      asksQuestions: asks,
      questionsLocked: asks && !!meta.questionsLocked,
      canFanOut: !!meta.fanOut,
    };
  }
  // The DISPATCH order of the AGENT nodes (rank, then launch order) — the manifest
  // already computes it for the run monitor; a reused composer row's graph.nodes order
  // is arbitrary. The steps cells bucket EVERY node — the Task card, End and the gates
  // ride along with `key: null` — so keep only the agent cells.
  const order = (manifest.steps || [])
    .filter((s) => s.kind === 'agents')
    .flatMap((s) => s.nodes.filter((n) => n.key).map((n) => n.id));
  return {
    round,
    name,
    reasoning: shape?.reasoning || '',
    warnings: (warnings || []).map((w) => (typeof w === 'string' ? w : w.message)).filter(Boolean),
    match: match ? { id: match.id, name: match.name } : null,
    manifest,
    order,
    nodes,
    models: models.filter((m) => m && !m.hidden).map((m) => ({ id: m.id, label: m.label || m.id, efforts: [...(m.efforts || [])] })),
    costUsd: Number.isFinite(costUsd) ? costUsd : 0,
    fingerprint: typeof fingerprint === 'string' ? fingerprint : '',
    ignoredProjectOverrides: !!ignoredProjectOverrides,
  };
}

/**
 * @returns {{decision:'accept',name:string,nodes:object}|{decision:'revise',text:string}|{decision:'cancel'}|null}
 */
export function sanitizeProposalAnswer(payload, { proposal, models = [], registry = {} }) {
  if (!isObject(payload)) return null;
  const d = payload.decision;
  if (d === 'cancel') return { decision: 'cancel' };
  if (d === 'revise') {
    const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 4096) : '';
    return text ? { decision: 'revise', text } : null;
  }
  if (d !== 'accept') return null;
  const name = cleanText(payload.name, 60) || proposal.name;
  const byId = new Map(models.map((m) => [String(m.id).toLowerCase(), m]));   // the FULL catalog: a hidden id still resolves
  const nodes = {};
  for (const [nodeId, sel] of Object.entries(isObject(payload.nodes) ? payload.nodes : {})) {
    const known = proposal.nodes?.[nodeId];
    if (!known || !isObject(sel)) continue;
    const meta = registry[known.key] || {};
    const out = {};
    if (typeof sel.model === 'string') {
      const m = byId.get(sel.model.trim().toLowerCase());
      if (m) out.model = m.id;
      // '' clears the model AND the effort: resolveGraph keeps a row's authored effort
      // when the overlay's model is falsy, which would leave an effort with no model.
      else if (sel.model.trim() === '') { out.model = ''; out.effort = ''; }
    }
    if (typeof sel.effort === 'string') {
      const mid = out.model !== undefined ? out.model : known.model;
      const m = mid ? byId.get(String(mid).toLowerCase()) : null;
      if (m && (m.efforts || []).includes(sel.effort)) out.effort = sel.effort;
    }
    if (typeof sel.fanOut === 'boolean' && meta.fanOut) out.fanOut = sel.fanOut;
    if (typeof sel.askQuestions === 'boolean' && meta.asksQuestions && !meta.questionsLocked) out.askQuestions = sel.askQuestions;
    if (Object.keys(out).length) nodes[nodeId] = out;
  }
  return { decision: 'accept', name, nodes };
}

/** `wf_<slug>` that no row owns; reserved / empty slugs become wf_auto-workflow. */
export async function mintAutoWorkflowId(name, exists) {
  let stem = `wf_${slugify(name)}`;
  if (stem === GRAPH_DEFAULT_WORKFLOW.id || stem === AUTO_WORKFLOW_ID || stem === 'wf_untitled') stem = 'wf_auto-workflow';
  let id = stem;
  for (let n = 2; await exists(id); n += 1) id = `${stem}-${n}`;
  return id;
}
