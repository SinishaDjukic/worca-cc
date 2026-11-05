// src/core/factory-models.mjs — Worca's factory model defaults: the models the built-in graphs used to pin in their
// templates, now a settings layer of their own. resolveGraph (workflows.mjs) applies them at the template's old
// position, so the precedence is unchanged, and the Models page shows them as "(default)".
// Pure data and pure helpers, with no import from src/core: config.mjs imports builtin-workflows.mjs, which
// re-exports WORKSPACE_SCAN_DEFAULT_MODELS from here, so importing config.mjs back would close a cycle. Callers pass
// the catalog functions in instead.
import { ROLE_LABELS } from '../shared/model-roles.mjs';

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return Object.freeze(o);
};

/** What a Workspace scan runs on when nothing else is named (D15/D16): the scan agent on Sonnet 5 at medium effort,
 *  its per-project investigators on the `sonnet` alias at medium effort. */
export const WORKSPACE_SCAN_DEFAULT_MODELS = deepFreeze({
  scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium',
});

/** The factory defaults. `steps` apply to role-review nodes only (a plain plan review keeps the user's own default). */
export const FACTORY_MODELS = deepFreeze({
  steps: {
    planReviewer: { model: 'claude-sonnet-5-5', effort: 'medium' },
    requirementsReviewer: { model: 'claude-sonnet-5-5', effort: 'medium' },
  },
  helpers: {
    secondOpinion: { model: 'claude-opus-5-5', effort: 'medium' },
    memoryDefrag: { model: 'claude-sonnet-5' },
    workspaceScan: WORKSPACE_SCAN_DEFAULT_MODELS,
  },
});

/** The setting names the fallback warnings and the sign-in refusals use. */
export const FACTORY_SETTING_LABELS = Object.freeze({
  'steps.planReviewer': 'Plan Review', 'steps.requirementsReviewer': 'Requirements Review',
  secondOpinion: 'Second-opinion reviewer', memoryDefrag: 'Memory defragment', workspaceScan: 'Workspace scan',
});

const SCAN_FANOUT_KEYS = new Set(['workspaceScanner', 'workspaceUsageMapper']);

/** A node's factory pick by its authored agent key. `spec` is the node's role review (roleReviewOf), or null.
 *  @returns {{setting:string, pick:{model?:string, effort?:string, subagentModel?:string, subagentEffort?:string}}|null} */
export function factoryNodePick(authoredKey, spec) {
  const scan = WORKSPACE_SCAN_DEFAULT_MODELS;
  if (authoredKey === 'memoryDefragmenter') return { setting: 'memoryDefrag', pick: { model: FACTORY_MODELS.helpers.memoryDefrag.model } };
  if (SCAN_FANOUT_KEYS.has(authoredKey)) {
    return { setting: 'workspaceScan', pick: { model: scan.scanModel, effort: scan.scanEffort, subagentModel: scan.agentModel, subagentEffort: scan.agentEffort } };
  }
  if (authoredKey === 'workspaceSynthesizer') return { setting: 'workspaceScan', pick: { model: scan.scanModel, effort: scan.scanEffort } };
  if (spec && Object.hasOwn(FACTORY_MODELS.steps, authoredKey)) return { setting: `steps.${authoredKey}`, pick: { ...FACTORY_MODELS.steps[authoredKey] } };
  return null;
}

/** The second-opinion role's factory pick: only when the role review names one of its own roles as `secondOpinion`.
 *  @returns {{roleKey:string, setting:'secondOpinion', pick:{model:string, effort:string}}|null} */
export function factoryRolePick(spec) {
  const key = spec && typeof spec.secondOpinion === 'string' ? spec.secondOpinion : null;
  if (!key || !Array.isArray(spec.roles) || !spec.roles.some((r) => r && r.key === key)) return null;
  return { roleKey: key, setting: 'secondOpinion', pick: { ...FACTORY_MODELS.helpers.secondOpinion } };
}

/** Whether a model needs the Claude Code sign-in: a sign-in connection that `routed` does not take elsewhere (workflows.mjs
 *  also counts a model whose own env signs the CLI in). Never throws. @param {{connection:(id:string)=>({kind:string}|null), routed:(id:string)=>boolean}} deps */
export function needsClaudeSignIn(modelId, { connection, routed }) {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  if (!id) return false;
  try {
    return connection(id)?.kind === 'signin' && !routed(id);
  } catch {
    return false;
  }
}

/** Another effort than the node's, for a second opinion that must run on the node's own model: the entry after
 *  `nodeEffort` in `efforts`, else the one before. A missing `nodeEffort` reads as 'medium' when listed, else the first.
 *  @returns {string|null} null with fewer than 2 efforts */
export function variedEffort(efforts, nodeEffort) {
  const list = Array.isArray(efforts) ? efforts.filter((e) => typeof e === 'string' && e) : [];
  if (list.length < 2) return null;
  const base = nodeEffort && list.includes(nodeEffort) ? nodeEffort : (list.includes('medium') ? 'medium' : list[0]);
  const at = list.indexOf(base);
  return at + 1 < list.length ? list[at + 1] : list[at - 1];
}

const labelOf = (labels, id) => (labels && typeof labels === 'object' && typeof labels[id] === 'string' && labels[id]) || id;

/** One run-log warning per setting whose factory default was dropped (resolveGraph `factoryNotes`), in note order.
 *  @param {Array<{setting:string, role?:string, wanted:{model:string}, used?:{model?:string, effort?:(string|null)}}>} notes
 *  @param {Record<string,string>} labels model id → catalog label */
export function factoryFallbackLines(notes, labels) {
  const out = [];
  const seen = new Set();
  for (const n of Array.isArray(notes) ? notes : []) {
    if (!n || seen.has(n.setting)) continue;
    seen.add(n.setting);
    const used = n.used || {};
    let usedLabel = used.model ? labelOf(labels, used.model) : "Claude's default model";
    if (n.role) usedLabel += used.effort ? ` · ${used.effort}` : ' (same model and effort as the step)';
    out.push(`${FACTORY_SETTING_LABELS[n.setting] || n.setting}: ${labelOf(labels, n.wanted?.model)} needs Claude Code sign-in; using ${usedLabel}`);
  }
  return out;
}

/** Where a refused model was set, as the refusal names it. */
function whereOf(b) {
  if (b.source === 'runModel') return "the run's model";
  if (b.role) {
    if (b.source === 'slot') return 'Models › Helper jobs › Second-opinion reviewer';
    if (b.source === 'run') return `this run's pick for ${b.node} · ${b.role}`;
    if (b.source === 'project') return `the project's pick for ${b.node} · ${b.role}`;
    return `the workflow's ${b.node} · ${b.role} step`;
  }
  switch (b.source) {
    case 'run': return `this run's pick for ${b.node}`;
    case 'project': return `the project's pick for ${b.node}`;
    case 'legacy': case 'slot': return `Models › Step models › ${b.node}`;
    case 'role': return `Models › Model roles › ${ROLE_LABELS[b.modelRole] || b.modelRole}`;
    case 'pair': return b.pair === 'scan' ? 'the workspace scan model' : 'Models › Helper jobs › Memory defragment';
    default: return `the workflow's ${b.node} step`;
  }
}

/** The engine gate's refusal for user/team-set models that need the Claude Code sign-in while it is signed out.
 *  @param {Array<{node?:string, role?:string, model:string, source:string, modelRole?:string, pair?:string}>} blocked
 *  @param {Record<string,string>} labels model id → catalog label */
export function signInRefusalText(blocked, labels) {
  const items = (Array.isArray(blocked) ? blocked : []).map((b) => `${whereOf(b)} names ${labelOf(labels, b.model)}`);
  return `Claude Code isn't signed in, and ${items.join('; ')}, which ${items.length > 1 ? 'need' : 'needs'} it — pick a model routed through a provider on the Models page, or sign in (run \`claude\`, then /login)`;
}

/** The factory defaults the Models page shows as "(default)" (the settings GET). */
export function factoryModelsPayload() {
  const { secondOpinion, memoryDefrag } = FACTORY_MODELS.helpers;
  return { claude: { steps: FACTORY_MODELS.steps, helpers: { secondOpinion, memoryDefrag } } };
}
