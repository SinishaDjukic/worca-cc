// src/core/run-overlay.mjs
// A run's per-node overlay (docs/models.md "Per-agent models for one run"): agent picks that merge PER NODE over the
// project's saved agent settings for ONE run — the Ask run card's lane (POST /api/run `overlay`) and Ask Worca's
// proposal (propose_run `nodes`). ONE check for both: a node must be an agent node of the workflow, and the model
// check is auto/classify.mjs checkShapeModels (unknown model, an effort the model does not list, an effort without a
// model, a node without a model on a signed-out install) plus connections.mjs runsOn (the run's engine must run it).
// Pure: the caller hands in the workflow row, the catalog and the engine. Nothing here writes project config.
import { checkShapeModels } from './auto/classify.mjs';
import { runsOn, harnessesLabel } from '../shared/connections.mjs';
import { engineLabel } from '../shared/engine-switch.mjs';
import { subagentModelIssue } from './model-env.mjs';

/** The keys a run overlay's node entry may carry (resolveGraph reads exactly these from it). */
export const OVERLAY_KEYS = Object.freeze(['model', 'effort', 'fanOut', 'askQuestions', 'subagentModel']);
/** More nodes than any workflow has: a bound on what one body may make the checks walk. */
export const OVERLAY_MAX_NODES = 64;

const idText = (id) => JSON.stringify(String(id).slice(0, 64));
const idPath = (id) => String(id).slice(0, 64);

export const OVERLAY_ERRORS = Object.freeze({
  shape: 'overlay must be an object: { nodes: { <nodeId>: { model, effort, … } } }',
  extra: (keys) => `overlay takes nodes only (got ${keys.map(idText).join(', ')})`,
  nodes: (what) => `${what} must be an object keyed by node id`,
  tooMany: (what) => `${what} names more than ${OVERLAY_MAX_NODES} nodes`,
  entry: (what, id) => `${what}.${idPath(id)} must be an object`,
  key: (what, id, k) => `${what}.${idPath(id)}: unknown key ${idText(k)}`,
  keys: (what, id, keys) => `${what}.${idPath(id)} takes only ${keys.join(', ')}`,
  model: (id) => `node ${idText(id)}: model must be a catalog model id`,
  effort: (id) => `node ${idText(id)}: effort must be a string naming one of the model's efforts`,
  flag: (id, k) => `node ${idText(id)}: ${k} must be true or false`,
  subagent: (id, issue) => `node ${idText(id)}: ${issue}`,
  reason: (id) => `node ${idText(id)}: reason must be a string`,
  notAgent: (id, wfId) => `node ${idText(id)} is not an agent node of workflow ${wfId}`,
  foreign: (id, m, engine) => `node ${idText(id)}: ${m.id} runs on ${harnessesLabel(m)}, not on ${engineLabel(engine)} — pick a model this run's engine runs`,
  auto: 'overlay needs a saved workflow — Auto picks its agents and their models when the run starts',
  scan: 'the workspace scan picks its own models — it takes no overlay',
});

function fail(errors) { return { error: errors.join('; '), errors }; }

/** Shape-check an overlay's nodes map: { nodes } (null = empty) or { error, errors }. Values are typed and trimmed;
 *  '' is simply absent (an overlay names values, it never clears the project's). Built with a Map + fromEntries, so
 *  an id like "__proto__" stays an own key (and the agent-node check refuses it). */
export function parseOverlayNodes(raw, { what = 'overlay.nodes', keys = OVERLAY_KEYS } = {}) {
  if (raw === undefined || raw === null) return { nodes: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return fail([OVERLAY_ERRORS.nodes(what)]);
  const ids = Object.keys(raw);
  if (ids.length > OVERLAY_MAX_NODES) return fail([OVERLAY_ERRORS.tooMany(what)]);
  const errors = [];
  const out = new Map();
  for (const id of ids) {
    const sel = raw[id];
    if (!sel || typeof sel !== 'object' || Array.isArray(sel)) { errors.push(OVERLAY_ERRORS.entry(what, id)); continue; }
    const entry = {};
    const ks = Object.keys(sel);
    // An entry names each allowed key at most once, so more keys than that hold unknown ones: ONE error, never one per
    // key (the body may carry millions — the 64-node bound covers what one entry makes the checks walk too).
    if (ks.length > keys.length) { errors.push(OVERLAY_ERRORS.keys(what, id, keys)); continue; }
    for (const k of ks) {
      const v = sel[k];
      if (!keys.includes(k)) errors.push(OVERLAY_ERRORS.key(what, id, k));
      else if (k === 'model') {
        if (typeof v !== 'string' || !v.trim() || v.length > 200) errors.push(OVERLAY_ERRORS.model(id)); else entry.model = v.trim();
      } else if (k === 'effort') {
        // Longer than any effort: refused here, so checkShapeModels' BAD_EFFORT never echoes it whole into an error.
        if (typeof v !== 'string' || v.length > 32) errors.push(OVERLAY_ERRORS.effort(id)); else if (v.trim()) entry.effort = v.trim();
      } else if (k === 'fanOut' || k === 'askQuestions') {
        if (typeof v !== 'boolean') errors.push(OVERLAY_ERRORS.flag(id, k)); else entry[k] = v;
      } else if (k === 'subagentModel') {
        if (typeof v !== 'string') errors.push(OVERLAY_ERRORS.subagent(id, 'subagentModel must be a string'));
        // The issue quotes the value: a long one is cut (no sub-agent value is that long, so the cut one is refused too).
        else if (subagentModelIssue(v)) errors.push(OVERLAY_ERRORS.subagent(id, subagentModelIssue(v.length > 64 ? `${v.slice(0, 64)}…` : v)));
        else if (v) entry.subagentModel = v;
      } else if (k === 'reason') {
        if (typeof v !== 'string') errors.push(OVERLAY_ERRORS.reason(id)); else entry.reason = v;
      }
    }
    out.set(id, entry);
  }
  if (errors.length) return fail(errors);
  return { nodes: out.size ? Object.fromEntries(out) : null };
}

/** POST /api/run's `overlay`: { overlay: { nodes } | null } or { error }. Shape only — checkRunOverlay checks it. */
export function parseRunOverlay(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: OVERLAY_ERRORS.shape };
  const extra = Object.keys(raw).filter((k) => k !== 'nodes');
  if (extra.length) return { error: OVERLAY_ERRORS.extra(extra) };
  const r = parseOverlayNodes(raw.nodes, { what: 'overlay.nodes' });
  if (r.error) return { error: r.error };
  return { overlay: r.nodes ? { nodes: r.nodes } : null };
}

/** Why a workflow takes no per-run overlay, or null: Auto decides its agents at start; the workspace scan pins its own. */
export function overlayWorkflowRefusal(workflow, { scan = false } = {}) {
  if (!workflow || workflow.auto === true || workflow.id === 'wf_auto') return OVERLAY_ERRORS.auto;
  if (scan) return OVERLAY_ERRORS.scan;
  return null;
}

/** The models a run's overlay set that its nodes really run (manifest.runOverlay beside the resolved cells), as
 *  policy/effective.mjs deviationsFor's `stepModels`: the run records an off-policy pick as it does a role's. */
export function overlayStepModels(manifest) {
  const picks = manifest && manifest.runOverlay && typeof manifest.runOverlay.nodes === 'object' ? manifest.runOverlay.nodes : null;
  const cells = manifest && manifest.graph && Array.isArray(manifest.graph.nodes) ? manifest.graph.nodes : [];
  if (!picks) return [];
  const out = [];
  for (const n of cells) {
    if (!n || n.kind !== 'agent' || typeof n.id !== 'string' || !Object.hasOwn(picks, n.id)) continue;
    const pick = picks[n.id] && typeof picks[n.id].model === 'string' ? picks[n.id].model : '';
    if (pick && typeof n.model === 'string' && n.model.toLowerCase() === pick.toLowerCase()) out.push({ role: n.key || n.id, model: n.model });
  }
  return out;
}

/**
 * Check parsed overlay nodes against the workflow and the catalog the run's engine runs.
 * @returns {{nodes: object, errors: string[]}} canonical nodes (catalog casing; a model always carries `effort`,
 *   '' = the model's default, so a stored effort never rides under it — resolveGraph merges per key) + errors.
 */
export function checkRunOverlay(nodes, { workflow = null, models = [], engine = 'claude', requireModel = false } = {}) {
  const errors = [];
  const wfId = workflow && typeof workflow.id === 'string' ? workflow.id : '(unknown)';
  const agentIds = new Set((Array.isArray(workflow?.nodes) ? workflow.nodes : [])
    .filter((n) => n && n.kind === 'agent' && typeof n.id === 'string').map((n) => n.id));
  const out = new Map();
  const stages = [];
  for (const [id, sel] of Object.entries(nodes && typeof nodes === 'object' ? nodes : {})) {
    if (!agentIds.has(id)) { errors.push(OVERLAY_ERRORS.notAgent(id, wfId)); continue; }
    const { reason: _reason, ...tunables } = sel && typeof sel === 'object' ? sel : {};
    if (tunables.model !== undefined && typeof tunables.model !== 'string') { errors.push(OVERLAY_ERRORS.model(id)); continue; }
    if (tunables.effort !== undefined && typeof tunables.effort !== 'string') { errors.push(OVERLAY_ERRORS.effort(id)); continue; }
    if (tunables.effort === '') delete tunables.effort;
    out.set(id, tunables);
    stages.push({ id, tunables });
  }
  // Signed out (auto/runnable.mjs): the install has no default model, so EVERY agent node must name one.
  if (requireModel) for (const id of agentIds) if (!out.has(id)) stages.push({ id, tunables: {} });
  const catalog = Array.isArray(models) ? models.filter((m) => m && typeof m.id === 'string') : [];
  for (const issue of checkShapeModels({ stages }, catalog, { requireModel })) errors.push(issue.message.replace(/^stage /, 'node '));
  const byId = new Map(catalog.map((m) => [m.id.toLowerCase(), m]));
  const run = engine || 'claude';
  for (const [id, t] of out) {
    if (t.model === undefined) continue;
    const m = byId.get(t.model.toLowerCase());
    if (m && !runsOn(m, run)) errors.push(OVERLAY_ERRORS.foreign(id, m, run));
    if (t.effort === undefined) t.effort = '';
  }
  return { nodes: Object.fromEntries(out), errors };
}
