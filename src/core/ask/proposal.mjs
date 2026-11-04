// validateProposal — the ONE validator behind mcp__worca__propose_run
// (ask-worca-design.md §9.2). The MCP child runs it so the model can self-correct;
// the server re-runs it on the intercepted card (authoritative). Error strings
// mirror POST /api/run wherever a counterpart exists. Readers injected.
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { listProjects as realListProjects } from '../projects.mjs';
import { readWorkspace as realReadWorkspace, isGitRepo as realIsGitRepo, memberWorkMode as realMemberWorkMode, WORKSPACE_KEY_RE } from '../workspaces.mjs';
import { readWorkflow as realReadWorkflow, assertRunnableWorkflow as realAssertRunnableWorkflow, GRAPH_MEMORY_DEFRAG_WORKFLOW } from '../workflows.mjs';
import { readGuardrailSet as realReadGuardrailSet } from '../guardrail-store.mjs';
import { validateMemoryScope } from '../memory-sync.mjs';
import { isWorkspaceScanWorkflow, GRAPH_SHAPE_WORKFLOW, GRAPH_SHAPE_UX_WORKFLOW, AUTO_WORKFLOW_ID, SHAPE_UX_WORKFLOW_ID } from '../graph/builtin-workflows.mjs';
import { sanitizeBranchName } from '../worktree.mjs';
import { deriveBranchName } from '../naming.mjs';
import { flagEnabled } from '../flags.mjs';
import { sanitizeTitle } from '../title.mjs';
import { ASK_LIMITS } from './limits.mjs';
import { resolveScheduleSpec } from './schedule-spec.mjs';
import { validateRunSource, checkTask } from './source-spec.mjs';
import { listTaskSources as realListTaskSources } from '../sources.mjs';
import { afterRefOf as realAfterRefOf } from '../scheduler.mjs';
import { resolveProfile as realResolveProfile } from '../source-bindings.mjs';
import { listProfileIds as realListProfileIds } from '../plugin-config.mjs';
import { resolveSourceRef as resolveGitSourceRef } from '../git-sync.mjs';
import { effectiveSyncSettings } from '../project-sync.mjs';
import { gitAvailable } from '../git-available.mjs';
import { ENGINE_NAMES, MODEL_ENGINE_NAMES, engineLabel } from '../../shared/engine-switch.mjs';
import { runsOn } from '../../shared/connections.mjs';
import { normaliseTags } from '../../shared/run-tags.mjs';
import { listModels as realListModels, modelCostConfig, modelHasBaseUrlRouting } from '../config.mjs';
import { resolveRunEngine } from '../settings-cascade.mjs';
import { cachedPolicyFor } from '../policy/cache.mjs';
import { fieldsForRun, deviationsFor } from '../policy/effective.mjs';
import { autoModelsFor } from '../auto/runnable.mjs';
import { probeClaudeAuth } from '../preflight.mjs';
import { parseOverlayNodes, checkRunOverlay } from '../run-overlay.mjs';
import { modelFacts, factsLine } from '../model-tiers.mjs';
import { listPriceFor } from '../list-prices.mjs';

// What a premium-tier pick is priced against on the card: Opus 5.5, the top tier's flagship (output USD per Mtok).
const OPUS_LIST_OUTPUT = (listPriceFor('claude-opus-5-5') || {}).output || 20;
import { resolveShapeRequest, isShapeWorkflowId } from '../shape/run.mjs';
import { nudgeFor } from '../shape/nudge.mjs';
import { estimateChoices } from '../shape/estimate.mjs';
import { DEFAULT_PERSPECTIVES, withProjectFit } from '../../shared/shape/perspectives.mjs';
import { NO_PROJECT_ERRORS } from '../../shared/no-project.mjs';
import { ensureHouseBrief } from '../house-brief.mjs';
import { presetProposalInput, PRESET_PROPOSAL_ERRORS } from './proposal-preset.mjs';
import { readPreset as readPresetRow } from '../run-presets-store.mjs';

export const PROPOSAL_ERRORS = Object.freeze({
  bothTargets: 'provide workspaceId OR projectKey, not both',
  noTarget: 'workspaceId or projectKey is required',
  // P3 (CONTRACT §3): noProject: true is a third target, never together with another one.
  tooManyTargets: NO_PROJECT_ERRORS.proposalTarget,
  noProjectType: 'noProject must be true',
  noProjectSchedule: NO_PROJECT_ERRORS.schedule,
  noProjectMemory: NO_PROJECT_ERRORS.memory,
  noProjectSlices: NO_PROJECT_ERRORS.slices,
  unknownProject: (key) => `unknown projectKey "${key}"`,
  projectPathMissing: (path) => `project path is missing: ${path}`,
  workspaceNotFound: 'workspace not found',
  memberPathMissing: 'workspace member path is missing',
  memberNotGit: (dir) => `workspace member is not a git repository: ${dir}`,
  unknownWorkflow: (id) => `unknown workflowId "${id}"`,
  memoryScopeType: 'memoryScope must be "global" or "project"',
  guardrailsType: 'guardrailsId must be a string',
  unknownEngine: (e) => `unknown engine "${e}" — one of ${ENGINE_NAMES.join(', ')}, or omit it for the user's default`,
  unknownGuardrails: (id) => `unknown guardrailsId "${id}"`,
  permissive: 'guardrailsId "permissive" is not allowed for proposed runs — use "normal" or a stricter set',
  briefRequired: 'brief is required',
  briefAndSource: 'give brief OR source, not both — with a task source the run reads the task itself; put what you learned in the note',
  scanWorkflow: 'the Workspace scan starts from Workspaces (Create workspace, or a workspace\'s Re-scan) — never from a card',
  briefTooLong: `brief exceeds ${ASK_LIMITS.briefMaxChars} characters`,
  badSource: (v) => `unknown or invalid sourceBranch: ${v}`,
  byKeyUnknown: (k) => `sourceBranchByKey has an unknown project key: ${k}`,
  byKeyFolder: (k) => `sourceBranchByKey: ${k} is a Folder project and has no branches`,
  byKeyProjectOnly: 'sourceBranchByKey is only valid for a workspace',
  missingSource: (v, remote) => `sourceBranch "${v}" exists neither locally nor on ${remote}`,
  shapeSlices: 'shape.slices must be "auto" or "off"',
  shapeScheduled: 'Shaper starts now and waits for the user to approve its plan: drop when / every / after',
  nodesAuto: 'nodes needs a saved workflow — Auto (wf_auto) picks its agents and their models when the run starts',
  nodesDefrag: 'the Memory defragment workflow takes its model from Settings › Memory — omit nodes',
  // An engine that owns no catalog models runs its own: no pick can ever run on it (every engine has some today).
  nodesEngine: (engine) => `nodes: the ${engineLabel(engine)} engine runs its own models — omit nodes for a run on it`,
  nodeNoModel: (id) => `node ${JSON.stringify(String(id).slice(0, 64))}: a pick needs a model`,
  signedOutPick: (id, model) => `node ${JSON.stringify(String(id).slice(0, 64))}: ${model} needs the Claude Code sign-in, which this install lacks — pick a model routed through an endpoint or provider`,
  // Not an error: a WARNING on the card for a pick in the premium tier (model-tiers.mjs TIERS). It names the model id
  // as a word of its own — the card keeps a warning only while a pick carries a model it names (ask-panel.mjs).
  premiumPick: (role, f) => `The ${role}'s model ${f.id}${f.label && f.label !== f.id ? ` (${f.label})` : ''} is a premium model (~${Math.round((f.price.output / OPUS_LIST_OUTPUT) * 10) / 10}× Opus 5.5 list price): keep it only if the user asked for it.`,
  // Not an error: a NOTE on an accepted plain proposal (the project's own settings may already route every agent).
  signedOutPlain: 'Claude Code is not signed in on this install: unless this project\'s own agent settings already name models routed through an endpoint or provider, a run of this card on Claude Code fails at its first agent. Say so, then propose again with nodes naming such a model for every agent node (rule 18) and tell the user the new card replaces this one.',
});

// The keys a propose_run `nodes` entry may carry (run-overlay.mjs checks model, effort and subagentModel).
const PROPOSAL_NODE_KEYS = Object.freeze(['model', 'effort', 'subagentModel', 'reason']);
/** The three answers of preflight.mjs probeClaudeAuth. */
const AUTH_STATES = new Set(['signed-in', 'signed-out', 'unknown']);

/**
 * Claude Code's sign-in as propose_run's per-agent picks need it (auto/runnable.mjs autoModelsFor): signed out, every
 * agent node must name a model routed through an endpoint or provider — so only a catalog holding a Claude-run routed
 * model can turn the answer into a verdict. Without one no `claude auth status` is spawned ('unknown' narrows nothing);
 * with one the configured binary answers (preflight's 60 s cache; 'unknown' in mock mode). The Ask turn asks this once
 * per turn and hands the answer to its MCP child and its own re-validation. Never throws.
 */
export async function proposalClaudeAuth({ listModels = realListModels, routed = modelHasBaseUrlRouting, probe = probeClaudeAuth, env = process.env } = {}) {
  try {
    const all = await listModels('');
    if (!(Array.isArray(all) ? all : []).some((m) => m && typeof m.id === 'string' && runsOn(m, 'claude') && routed(m.id))) return 'unknown';
    const r = await probe({ bin: env.WORCA_CLAUDE_BIN || env.ORCH_CLAUDE_BIN || 'claude' });
    return r && AUTH_STATES.has(r.state) ? r.state : 'unknown';
  } catch { return 'unknown'; }
}

const CARD_HEX_RE = /^card_([0-9a-f]{8})$/;
// Characters git refuses inside a ref name: ASCII control chars, space, DEL and ~ ^ : ? * [ \
const REF_BAD_CHARS = /[\x00-\x20\x7f~^:?*[\\]/;

/**
 * Pure git ref-format check (the rules of `git check-ref-format`), no shell-out.
 * The REAL "does this ref exist" check stays in POST /api/run (isValidSourceRef).
 */
export function isSyntacticRef(s) {
  if (typeof s !== 'string' || !s || s.length > 255) return false;
  if (s.startsWith('-')) return false;                        // would parse as a git option
  if (REF_BAD_CHARS.test(s)) return false;
  if (s.includes('..') || s.includes('@{') || s.includes('//')) return false;
  if (s.endsWith('/') || s.endsWith('.') || s.endsWith('.lock')) return false;
  return s.split('/').every((c) => c !== '' && !c.startsWith('.') && !c.endsWith('.lock'));
}

// The run card's attachment pills. `ids` is the model's attachmentIds, `rows` the
// thread's attachment ledger (store.listAttachments — 8 keys; only four ride on
// the card). Unknown ids are dropped silently (the user may have deleted one
// since — like commentIds), duplicates collapse, the model's order is kept.
export function pickCardAttachments(ids, rows) {
  if (!Array.isArray(ids) || !Array.isArray(rows)) return [];
  const byId = new Map(rows.filter((r) => r && typeof r.id === 'string').map((r) => [r.id, r]));
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    const r = byId.get(id);
    if (!r) continue;
    seen.add(id);
    out.push({ id: r.id, name: String(r.name ?? ''), bytes: Number.isFinite(r.bytes) ? r.bytes : 0, kind: r.kind ?? 'text' });
  }
  return out;
}

// One line on the card (spec §6.1): C0/DEL/C1 + the Unicode line separators
// become spaces (NOT stripped — a note broken by a control char must still read
// as two words), runs of whitespace collapse, then the cap. Written with
// escapes — never a raw byte.
const NOTE_BREAK_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
function cleanNote(v, max = ASK_LIMITS.proposalNoteMaxChars) {
  if (typeof v !== 'string') return null;
  const s = v.replace(NOTE_BREAK_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
}

function safeIds(plugin) { try { return realListProfileIds(plugin); } catch { return []; } }

const given = (v) => v !== undefined && v !== null && v !== '';

/**
 * @param {{listProjects?:Function, readWorkspace?:Function, readWorkflow?:Function, assertRunnableWorkflow?:Function, readGuardrailSet?:Function, isGitRepo?:Function, pathExists?:Function, estimate?:Function|null}} [deps]
 */
export function createProposalValidator({
  listProjects = realListProjects,
  readWorkspace = realReadWorkspace,
  readWorkflow = realReadWorkflow,
  // The ONE runnable gate, injectable like every other reader on this seam.
  assertRunnableWorkflow = realAssertRunnableWorkflow,
  readGuardrailSet = realReadGuardrailSet,
  isGitRepo = realIsGitRepo,
  // P5 (U8): a member's mode now (registered Folder project, or any member while git is missing → 'folder')
  memberWorkMode = realMemberWorkMode,
  gitOn = gitAvailable,
  pathExists = existsSync,
  // Plugin task sources (source-spec.mjs): the installed sources with each one's profile roster.
  listTaskSources = () => realListTaskSources().map((s) => (s.type === 'plugin' && s.multiProfile ? { ...s, profiles: safeIds(s.plugin) } : s)),
  resolveProfile = realResolveProfile,
  // Run chains: the predecessor reader (core afterRefOf; tests inject a stub). The MCP child gets
  // the same default — tool-deps.mjs re-exports this module's default-bound validateProposal.
  afterRef = realAfterRefOf,
  // #527: (dir, name, {projectKey}) → git-sync resolveSourceRef's answer. Null by default, so a
  // validator built on fake dirs never asks git; the module singleton below binds the real one.
  resolveSourceRef = null,
  remoteName = () => 'origin',
  // Shape it first: the gate (spec D12), and the nudge's as-is / shaped estimates — null by default, so a
  // validator built on fake readers never reads run history; the module singleton below binds the real one.
  estimate = null,
  // Project fit (slice 3): ({projectKey, projectDir}) → true when the project has a house brief. False by default, so a
  // validator built on fake readers never scans a repo; the module singleton below binds the real one.
  hasHouseBrief = async () => false,
  // Per-agent picks (`nodes`, docs/models.md "Per-agent models for one run"): the catalog, the run's engine when the
  // proposal names none (the same cascade POST /api/run and the card's /api/run-defaults use), Claude Code's sign-in,
  // the team policy (cache only) and the entries' own cost. Read ONLY for a proposal that carries `nodes`.
  listModels = realListModels,
  resolveEngine = ({ projectDir = null, workspace = false } = {}) => { try { return resolveRunEngine({ projectDir, workspace }).engine; } catch { return 'claude'; } },
  routed = modelHasBaseUrlRouting,
  // The Ask MCP child runs inside the chat's env, where the chat model's routing (ANTHROPIC_BASE_URL …) reads as a
  // sign-in: the turn hands its own answer down (spawn.mjs WORCA_ASK_CLAUDE_AUTH) and passes it to its re-validation
  // (validateProposal's `claudeAuth`). Elsewhere (a relayed chat, any other caller) proposalClaudeAuth answers.
  claudeAuth = async () => {
    const handed = process.env.WORCA_ASK_CLAUDE_AUTH;
    return AUTH_STATES.has(handed) ? handed : proposalClaudeAuth({ listModels, routed });
  },
  policyFields = ({ projectDir = null, policyProject = null } = {}) => {
    try { const p = cachedPolicyFor(projectDir || policyProject); return p ? fieldsForRun(p.doc, { workspaceRun: !projectDir }) : {}; } catch { return {}; }
  },
  costOf = modelCostConfig,
  // Run presets (#712 slice 3): propose_run's presetId. Null by default, so a validator built on fake readers
  // never reads presets; the module singleton below binds the real one.
  readPreset = null,
} = {}) {
  /** propose_run `nodes` → { nodes, errors, warnings }: the run API's check (run-overlay.mjs) on the catalog the run's
   *  engine runs, plus Ask's own: signed out, every agent node needs a model the install can run (auto/runnable.mjs,
   *  the Auto classifier's rule); a pick outside the team policy's allowed models is a WARNING (deviationsFor), and so is a
   *  pick in the premium tier (MODEL_PICK_POLICY: only when the user names that model). */
  async function checkNodes(nodes, { wf, target, engine, policyHome, auth = null }) {
    const runEngine = engine || resolveEngine(target.target === 'workspace' ? { workspace: true } : { projectDir: target.projectDir });
    if (!MODEL_ENGINE_NAMES.includes(runEngine)) return { nodes: {}, errors: [PROPOSAL_ERRORS.nodesEngine(runEngine)], warnings: [] };
    let all = [];
    try { all = await listModels(target.projectDir || ''); } catch { all = []; }
    let usable = null;
    if (runEngine === 'claude') {
      // Readiness (needsSignIn) is left out: the MCP child's env lacks `${VAR}` provider keys, so it would read a
      // provider model "not ready" that the parent and the run can use — both processes must answer alike.
      const claudeModels = all.filter((m) => m && runsOn(m, 'claude')).map(({ needsSignIn: _ready, ...m }) => m);
      // The turn's answer when it passed one (validateProposal's claudeAuth), else the reader's.
      const runnable = autoModelsFor(claudeModels, { auth: AUTH_STATES.has(auth) ? auth : await claudeAuth(), routed });
      if (runnable.requireModel) usable = new Set(runnable.models.map((m) => String(m.id).toLowerCase()));
    }
    const checked = checkRunOverlay(nodes, { workflow: wf, models: all, engine: runEngine, requireModel: !!usable });
    const errors = [...checked.errors];
    // Only a model the claude engine runs can need its sign-in: another engine's model already has its own error.
    const known = new Set(all.filter((m) => m && typeof m.id === 'string' && runsOn(m, 'claude')).map((m) => m.id.toLowerCase()));
    for (const [id, t] of Object.entries(checked.nodes)) {
      if (!t.model && t.effort === undefined) errors.push(PROPOSAL_ERRORS.nodeNoModel(id));
      else if (usable && t.model && known.has(t.model.toLowerCase()) && !usable.has(t.model.toLowerCase())) errors.push(PROPOSAL_ERRORS.signedOutPick(id, t.model));
    }
    // Readiness stays out of the facts for the same reason it stays out of the rule above: the MCP child reads a
    // `${VAR}`-keyed provider model "not ready", the parent does not — the model's result and the card must agree
    // (the lane's model menu marks a pick that needs sign-in itself).
    const facts = new Map(modelFacts(all.filter((m) => m && typeof m === 'object').map(({ needsSignIn: _ready, ...m }) => m), { costOf })
      .map((f) => [f.id.toLowerCase(), f]));
    const out = {};
    for (const [id, t] of Object.entries(checked.nodes)) {
      const reason = cleanNote(nodes[id] && nodes[id].reason, ASK_LIMITS.proposalReasonMaxChars);
      const f = t.model ? facts.get(t.model.toLowerCase()) : null;
      out[id] = { ...t, ...(reason ? { reason } : {}), ...(f ? { facts: factsLine(f) } : {}) };
    }
    const keyOf = new Map((Array.isArray(wf.nodes) ? wf.nodes : []).filter((n) => n && n.kind === 'agent').map((n) => [n.id, n.key]));
    let warnings = [];
    try {
      const stepModels = Object.entries(out).filter(([, t]) => t.model).map(([id, t]) => ({ role: keyOf.get(id) || id, model: t.model }));
      warnings = deviationsFor(policyFields({ projectDir: target.projectDir, policyProject: policyHome }) || {}, { stepModels })
        // The run records a per-run pick as off-policy too (run-harness.mjs _resolvePolicy, run-overlay.mjs overlayStepModels).
        .filter((d) => d && typeof d.code === 'string' && d.code.startsWith('model:'))
        .map((d) => String(d.text));
    } catch { warnings = []; }
    // Outside the policy read: a policy that cannot be read drops its own word, never this one.
    for (const [id, t] of Object.entries(out)) {
      const f = t.model ? facts.get(t.model.toLowerCase()) : null;
      if (!f || f.tier !== 'premium') continue;
      const w = PROPOSAL_ERRORS.premiumPick(keyOf.get(id) || id, f);
      if (!warnings.includes(w)) warnings.push(w);
    }
    return { nodes: out, errors, warnings };
  }
  /**
   * @param {object} input  the propose_run tool input
   * @param {{cardId?:string|null, timeZone?:string|null, nowMs?:number, scheduleDefaults?:object}} [opts]  the server passes the
   *   minted card id (feature-branch uniqueness); timeZone is the user's (the schedule fields are read in it)
   * @returns {Promise<{ok:true, card:object}|{ok:false, errors:string[]}>}
   */
  // `claudeAuth`: the sign-in answer the Ask turn handed its MCP child (turn.mjs _onProposal), so the card is checked
  // with the answer the model's own call was checked with.
  async function validateProposal(input, { cardId = null, attachments = [], timeZone = null, nowMs = Date.now(), scheduleDefaults = {}, lookupTask = null, claudeAuth: authAnswer = null, owner = null } = {}) {
    let inp = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    // Run presets (D9): the preset's picks fill the input BEFORE every check below, so its broken items are named by them.
    // `owner`: the thread's reader on a shared deployment (null = the local install, which sees every preset).
    let cardPreset = null;
    if (given(inp.presetId)) {
      if (!readPreset) return { ok: false, errors: [PRESET_PROPOSAL_ERRORS.off] };
      if (typeof inp.presetId !== 'string') return { ok: false, errors: [PRESET_PROPOSAL_ERRORS.type] };
      const preset = await readPreset(inp.presetId.trim(), { owner });
      if (!preset) return { ok: false, errors: [PRESET_PROPOSAL_ERRORS.unknown(inp.presetId)] };
      const merged = presetProposalInput(preset, inp);
      if (merged.errors.length) return { ok: false, errors: merged.errors };
      inp = merged.input;
      cardPreset = merged.cardPreset;
    }
    const errors = [];
    const fail = () => ({ ok: false, errors });
    const str = (v) => (typeof v === 'string' ? v.trim() : '');

    // ── target: exactly one ────────────────────────────────────────────────
    const projectKeyIn = str(inp.projectKey);
    const workspaceIdIn = str(inp.workspaceId);
    // P3: `noProject: true` = a run in its own empty folder (no project, no git). false / absent = not given.
    if (inp.noProject !== undefined && inp.noProject !== null && typeof inp.noProject !== 'boolean') { errors.push(PROPOSAL_ERRORS.noProjectType); return fail(); }
    const none = inp.noProject === true;
    if (none && (projectKeyIn || workspaceIdIn)) { errors.push(PROPOSAL_ERRORS.tooManyTargets); return fail(); }
    if (projectKeyIn && workspaceIdIn) { errors.push(PROPOSAL_ERRORS.bothTargets); return fail(); }
    if (!none && !projectKeyIn && !workspaceIdIn) { errors.push(PROPOSAL_ERRORS.noTarget); return fail(); }
    let target;
    let policyHome = null;   // a workspace's policy home: the member whose team policy governs its runs
    if (none) {
      // P3-D9: the card key set is unchanged — every project / workspace field is null.
      target = { target: 'none', projectKey: null, projectName: null, projectDir: null,
        workspaceId: null, workspaceName: null, members: null };
    } else if (projectKeyIn) {
      const p = (await listProjects()).find((x) => x.key === projectKeyIn);
      if (!p) { errors.push(PROPOSAL_ERRORS.unknownProject(projectKeyIn)); return fail(); }
      if (!pathExists(p.path)) { errors.push(PROPOSAL_ERRORS.projectPathMissing(p.path)); return fail(); }
      target = { target: 'project', projectKey: p.key, projectName: p.name, projectDir: p.path,
        workspaceId: null, workspaceName: null, members: null };
    } else {
      if (!WORKSPACE_KEY_RE.test(workspaceIdIn)) { errors.push(PROPOSAL_ERRORS.workspaceNotFound); return fail(); }
      const ws = await readWorkspace(workspaceIdIn);
      if (!ws) { errors.push(PROPOSAL_ERRORS.workspaceNotFound); return fail(); }
      const members = [];
      const paths = Array.isArray(ws.projectPaths) ? ws.projectPaths : [];
      const keys = Array.isArray(ws.projectKeys) ? ws.projectKeys : [];
      for (let i = 0; i < paths.length; i++) {
        const dir = paths[i];
        if (!pathExists(dir)) { errors.push(PROPOSAL_ERRORS.memberPathMissing); return fail(); }
        const workMode = memberWorkMode(dir);
        if (workMode === 'git' && !isGitRepo(dir)) { errors.push(PROPOSAL_ERRORS.memberNotGit(dir)); return fail(); }
        members.push({ projectKey: keys[i], projectDir: dir, projectName: basename(dir), ...(workMode === 'folder' ? { workMode } : {}) });
      }
      members.sort((a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0)); // primary first (ui/server.mjs:897)
      policyHome = typeof ws.policyProject === 'string' && paths.includes(ws.policyProject) ? ws.policyProject : null;
      target = { target: 'workspace', projectKey: null, projectName: null, projectDir: null,
        workspaceId: ws.id, workspaceName: ws.name, members };
    }
    // Project fit is on by default only with a house brief; a failed check is "no brief", never an error.
    let briefMemo = null;
    const briefOn = () => (briefMemo ??= (async () => {
      if (target.target !== 'project') return false;
      try { return (await hasHouseBrief({ projectKey: target.projectKey, projectDir: target.projectDir })) === true; } catch { return false; }
    })());

    // ── Shape it first (spec D9): the card proposes wf_shape (wf_shape_ux with UX); the gate refuses it when off ──
    let shape = null;
    let shapedWorkflowId = null;
    if (inp.shape != null || isShapeWorkflowId(str(inp.workflowId))) {   // null = absent, as for the other optional fields
      let shapeIn = inp.shape;
      if (shapeIn && typeof shapeIn === 'object' && !Array.isArray(shapeIn)) {
        const { slices, ...rest } = shapeIn;
        if (slices !== undefined && slices !== 'auto' && slices !== 'off') errors.push(PROPOSAL_ERRORS.shapeSlices);
        shapeIn = slices === 'auto' || slices === 'off' ? { ...rest, slices } : rest;
      }
      // L14: on a shaped proposal the model's assess.size tells the Planner the task was judged large.
      const size = inp.assess && ['small', 'medium', 'large'].includes(inp.assess.size) ? inp.assess.size : undefined;
      if (size && shapeIn && typeof shapeIn === 'object' && !Array.isArray(shapeIn) && shapeIn.size === undefined) shapeIn = { ...shapeIn, size };
      // The UX variant named with no perspectives (no shape, or shape: {slices}): keep UX, or resolveShapeRequest's
      // defaults would quietly drop to wf_shape.
      if (str(inp.workflowId) === SHAPE_UX_WORKFLOW_ID
        && (shapeIn === undefined || (shapeIn && typeof shapeIn === 'object' && !Array.isArray(shapeIn) && !('perspectives' in shapeIn)))) {
        shapeIn = { ...(shapeIn || {}), perspectives: [...DEFAULT_PERSPECTIVES, 'ux'] };
      }
      const r = resolveShapeRequest({ shape: shapeIn, workflowId: inp.workflowId });
      if (!r.ok) errors.push(r.error);
      else { shape = { ...r.shape, perspectives: withProjectFit(r.shape.perspectives, await briefOn()) }; shapedWorkflowId = r.workflowId; }
      // L7: a run without a project is never planned in slices (POST /api/run refuses 'auto' the same); its shaped run
      // runs with slices off (U13: the Shaper itself still runs with No project).
      if (none && shape) {
        if (shape.slices === 'auto') errors.push(PROPOSAL_ERRORS.noProjectSlices);
        else shape = { ...shape, slices: 'off' };
      }
    }

    // ── workflow ───────────────────────────────────────────────────────────
    const workflowId = shapedWorkflowId || str(inp.workflowId) || 'wf_default';
    let wf = null;
    try { wf = await assertRunnableWorkflow(workflowId); }
    catch (err) { errors.push(err && err.message ? err.message : PROPOSAL_ERRORS.unknownWorkflow(workflowId)); }
    // The Workspace scan starts only through the Workspaces routes (D2): POST /api/run refuses it,
    // so a card for it could never start.
    if (wf && isWorkspaceScanWorkflow(wf.id)) { errors.push(PROPOSAL_ERRORS.scanWorkflow); wf = null; }

    // ── memoryScope (agent memory §7.3): the same gate as POST /api/run ──────
    let memoryScope = null;
    let scopeTypeBad = false;
    if (inp.memoryScope !== undefined && inp.memoryScope !== null && inp.memoryScope !== '') {
      if (typeof inp.memoryScope !== 'string') { errors.push(PROPOSAL_ERRORS.memoryScopeType); scopeTypeBad = true; }
      else memoryScope = inp.memoryScope.trim() || null;
    }
    // Only when the workflow resolved (I2-#8): an unknown id has already pushed its own error and
    // `wf` is null, so checking here would add a second, misleading one for a typo of the defrag id.
    if (!scopeTypeBad && wf) {
      const reason = validateMemoryScope({ workflowId: wf.id, memoryScope, isWorkspace: target.target === 'workspace' });
      if (reason) errors.push(reason);
      else if (none && memoryScope === 'project') errors.push(PROPOSAL_ERRORS.noProjectMemory);   // U13 + CONTRACT §3: global memory only, after the shared gate as in POST /api/run
    }

    // ── guardrails: default normal, permissive refused (D3) ────────────────
    let guardrailsId = 'normal';
    if (inp.guardrailsId !== undefined && inp.guardrailsId !== null && inp.guardrailsId !== '') {
      if (typeof inp.guardrailsId !== 'string') { errors.push(PROPOSAL_ERRORS.guardrailsType); guardrailsId = null; }
      else guardrailsId = inp.guardrailsId.trim() || 'normal';
    }
    if (guardrailsId === 'permissive') errors.push(PROPOSAL_ERRORS.permissive);
    else if (guardrailsId && !(await readGuardrailSet(guardrailsId))) errors.push(PROPOSAL_ERRORS.unknownGuardrails(guardrailsId));

    // ── engine: only when named; omitted, /api/run resolves the user's / project's default ──
    let engine = null;
    if (inp.engine !== undefined && inp.engine !== null && inp.engine !== '') {
      const e = typeof inp.engine === 'string' ? inp.engine.trim().toLowerCase() : '';
      if (ENGINE_NAMES.includes(e)) engine = e; else errors.push(PROPOSAL_ERRORS.unknownEngine(String(inp.engine)));
    }

    // ── per-agent picks (`nodes`): a per-run overlay over the project's agent settings ──
    // The SAME checks POST /api/run runs on the card's overlay (run-overlay.mjs over auto/classify.mjs checkShapeModels
    // and connections.mjs runsOn), plus Ask's own (checkNodes). Only a card with picks carries `nodes` / `warnings`.
    let cardNodes = null;
    let cardWarnings = [];
    if (inp.nodes !== undefined && inp.nodes !== null) {
      const parsed = parseOverlayNodes(inp.nodes, { what: 'nodes', keys: PROPOSAL_NODE_KEYS });
      if (parsed.error) errors.push(...parsed.errors);
      else if (parsed.nodes && wf) {
        if (wf.auto === true || wf.id === 'wf_auto') errors.push(PROPOSAL_ERRORS.nodesAuto);
        else if (wf.id === GRAPH_MEMORY_DEFRAG_WORKFLOW.id) errors.push(PROPOSAL_ERRORS.nodesDefrag);
        else {
          const r = await checkNodes(parsed.nodes, { wf, target, engine, policyHome, auth: authAnswer });
          errors.push(...r.errors);
          cardNodes = r.nodes;
          cardWarnings = r.warnings;
        }
      }
    }

    // ── task source (source-spec.mjs): a reference the run fetches at start ──
    const src = validateRunSource(inp.source, { target, listTaskSources, resolveProfile });
    if (!src.ok) errors.push(...src.errors);
    let runSource = src.ok ? src.source : null;
    let sourceWarning = null;
    if (runSource && !errors.length) {
      const chk = await checkTask(runSource, lookupTask);
      if (!chk.ok) errors.push(chk.error);
      else {
        if (chk.task) runSource = { ...runSource, ...(chk.task.title ? { title: chk.task.title } : {}), ...(chk.task.url ? { url: chk.task.url } : {}) };
        if (chk.warning) sourceWarning = chk.warning;
      }
    }

    // ── brief ──────────────────────────────────────────────────────────────
    const brief = String(inp.brief ?? '').trim();
    if (runSource || (inp.source !== undefined && inp.source !== null)) {
      if (brief) errors.push(PROPOSAL_ERRORS.briefAndSource);
    } else if (!brief) errors.push(PROPOSAL_ERRORS.briefRequired);
    else if (brief.length > ASK_LIMITS.briefMaxChars) errors.push(PROPOSAL_ERRORS.briefTooLong);

    // ── branches (syntactic only) ──────────────────────────────────────────
    // P3: a run without a project has no branch — its branch fields are ignored, as POST /api/run ignores them.
    let sourceBranch = null;
    const sourceIn = none || inp.sourceBranch === undefined || inp.sourceBranch === null ? '' : String(inp.sourceBranch).trim();
    if (sourceIn) {
      if (isSyntacticRef(sourceIn)) sourceBranch = sourceIn;
      else errors.push(PROPOSAL_ERRORS.badSource(sourceIn));
    }
    let sourceBranchByKey = null;
    if (inp.sourceBranchByKey !== undefined && inp.sourceBranchByKey !== null) {
      const raw = inp.sourceBranchByKey;
      if (target.target !== 'workspace') errors.push(PROPOSAL_ERRORS.byKeyProjectOnly);
      else if (typeof raw === 'object' && !Array.isArray(raw)) {       // non-objects ignored, like the route
        const memberKeys = new Set(target.members.map((m) => m.projectKey));
        const folderKeys = new Set(target.members.filter((m) => m.workMode === 'folder').map((m) => m.projectKey));
        const out = {};
        for (const [k, v] of Object.entries(raw)) {
          if (!memberKeys.has(k)) { errors.push(PROPOSAL_ERRORS.byKeyUnknown(k)); continue; }
          const val = typeof v === 'string' ? v.trim() : '';
          if (!val) continue;
          // git missing: a Git member runs on a copy too (U3) — its branch is ignored, as POST /api/run ignores it; never "a Folder project"
          if (folderKeys.has(k)) { if (gitOn()) errors.push(PROPOSAL_ERRORS.byKeyFolder(k)); continue; }
          if (!isSyntacticRef(val)) { errors.push(PROPOSAL_ERRORS.badSource(val)); continue; }
          out[k] = val;
        }
        sourceBranchByKey = Object.keys(out).length ? out : null;
      }
    }

    // ── title + feature branch ─────────────────────────────────────────────
    const title = sanitizeTitle(typeof inp.title === 'string' ? inp.title : '')
      || sanitizeTitle(brief.split(/\r?\n/)[0].slice(0, 80))
      || (runSource ? sanitizeTitle(runSource.title || `${runSource.taskId}`) : '')
      || 'Proposed run';
    let featureBranch = none ? null : typeof inp.featureBranch === 'string' ? sanitizeBranchName(inp.featureBranch) : '';
    // Smart run naming: a branch derived here (not given by the model or the person) is marked, so Start can tell the
    // server it is a suggestion that must stay unique. Only while the flag is on: a flag-off card keeps its shape.
    let featureBranchDerived = false;
    if (!none && !featureBranch) {
      const m = typeof cardId === 'string' ? CARD_HEX_RE.exec(cardId) : null;
      featureBranch = deriveBranchName({
        prompt: brief || title, title, pipelineId: m ? m[1] : '',
        ticket: runSource?.taskId || '', projectDir: target.projectDir || undefined,
      });
      featureBranchDerived = flagEnabled('smartRunNaming');
    }
    if (inp.sameAsSource !== undefined && inp.sameAsSource !== null && typeof inp.sameAsSource !== 'boolean') errors.push('sameAsSource must be true or false');
    const sameAsSource = !none && inp.sameAsSource === true;
    if (!sameAsSource && featureBranch && sourceBranch && featureBranch === sourceBranch) {
      errors.push(`featureBranch and sourceBranch are both "${sourceBranch}": to commit onto it, set sameAsSource: true (and drop featureBranch); otherwise name another feature branch`);
    }

    // ── schedule (docs/scheduled-runs.md "Chat"): when | every, read in the user's zone ──
    // L7: a run without a project cannot be scheduled or chained yet (resume tickets are the server's own).
    const scheduleAsked = ['when', 'every', 'after'].some((k) => str(inp[k])) || inp.sourceFromPrevious === true;
    const spec = none && scheduleAsked
      ? { ok: false, errors: [PROPOSAL_ERRORS.noProjectSchedule] }
      : resolveScheduleSpec({ ...inp, projectKey: target.projectKey || '', workspaceId: target.workspaceId || '' }, { nowMs, timeZone, defaults: scheduleDefaults, afterRef });
    if (!spec.ok) errors.push(...spec.errors);
    if (spec.ok && spec.schedule && spec.schedule.kind === 'after' && spec.schedule.sourceFromPrevious && (sourceBranch || (sourceBranchByKey && Object.keys(sourceBranchByKey).length))) {
      errors.push('sourceFromPrevious and sourceBranch / sourceBranchByKey cannot both be given');
    }

    // ── source branch vs the remote (#527): only for a card that is otherwise valid ──
    let sourceRef = null;
    if (!errors.length && sourceBranch && target.target === 'project' && typeof resolveSourceRef === 'function') {
      let r = null;
      try { r = await resolveSourceRef(target.projectDir, sourceBranch, { projectKey: target.projectKey }); } catch { r = null; }
      if (r && r.ok && (r.remoteOnly || r.behind > 0 || r.stale)) {
        sourceRef = { ref: r.ref, remoteOnly: !!r.remoteOnly, behind: r.behind || 0, ...(r.stale ? { stale: true } : {}) };
      } else if (r && !r.ok && r.kind === 'missing') {
        errors.push(PROPOSAL_ERRORS.missingSource(sourceBranch, remoteName(target.projectKey)));
      } else if (r && !r.ok && r.kind === 'stale') {
        sourceRef = { ref: sourceBranch, remoteOnly: false, behind: 0, stale: true };   // offline: never reject what may exist
      }
    }

    // Run tags (#718): the one normaliser; the card carries the clean list. A proposal writes tags: key:value only.
    const tagCheck = normaliseTags(inp.tags, { strict: true });
    for (const e of tagCheck.errors) errors.push(`tags: ${e}`);
    if (shape && spec.schedule) errors.push(PROPOSAL_ERRORS.shapeScheduled);
    // No nudge on a card without a project: Shape it first offers a plan in slices, which it cannot have yet (L7, P3-D17).
    const nudgeBase = !none && !shape && !spec.schedule ? nudgeFor(inp.assess) : null;
    let nudge = null;
    if (nudgeBase && !errors.length) {
      let estimates = { asIs: null, shaped: null };
      // The shaped run would be wf_shape_ux when the nudge picks UX (resolveShapeRequest); it has the manual-test agents.
      const shapedWf = nudgeBase.perspectives.includes('ux') ? GRAPH_SHAPE_UX_WORKFLOW : GRAPH_SHAPE_WORKFLOW;
      if (typeof estimate === 'function') {
        try { estimates = (await estimate({ asIs: wf, shaped: shapedWf })) || estimates; } catch { /* no history here (MCP child): no numbers */ }
      }
      nudge = { ...nudgeBase, perspectives: withProjectFit(nudgeBase.perspectives, await briefOn()), estimates, asIsAuto: wf?.id === AUTO_WORKFLOW_ID };
    }

    if (errors.length) return fail();
    // Signed out (only the answer the Ask turn already holds — its re-validation's `claudeAuth`, the MCP child's
    // WORCA_ASK_CLAUDE_AUTH; never a probe, so without that answer a plain proposal still reads nothing): a plain
    // proposal of a saved workflow whose run is on Claude Code is told so, beside the card — the chat cannot learn it any
    // other way before the run dies. The engine is the one the run would take (the same cascade as checkNodes).
    const handed = AUTH_STATES.has(authAnswer) ? authAnswer : process.env.WORCA_ASK_CLAUDE_AUTH;
    const plainSavedRun = handed === 'signed-out' && !cardNodes && wf.auto !== true && wf.id !== 'wf_auto' && wf.id !== GRAPH_MEMORY_DEFRAG_WORKFLOW.id;
    const signedOutNote = plainSavedRun
      && (engine || resolveEngine(target.target === 'workspace' ? { workspace: true } : { projectDir: target.projectDir })) === 'claude';
    return {
      ok: true,
      ...(signedOutNote ? { notes: [PROPOSAL_ERRORS.signedOutPlain] } : {}),
      card: { ...target, workflowId: wf.id, workflowName: wf.name, guardrailsId, memoryScope, brief, title, sourceBranch, featureBranch, sourceBranchByKey,
        ...(featureBranchDerived ? { featureBranchDerived: true } : {}),
        note: cleanNote(inp.note), attachments: pickCardAttachments(inp.attachmentIds, attachments),
        // Only a scheduled proposal carries the key: a plain run card keeps its shape byte for byte.
        ...(spec.schedule ? { schedule: spec.schedule } : {}),
        // Likewise a proposal that names run tags.
        ...(tagCheck.tags.length ? { tags: tagCheck.tags } : {}),
        // Likewise a proposal whose task is a plugin task (an issue), not a brief.
        ...(runSource ? { source: runSource } : {}),
        ...(sourceWarning ? { sourceWarning } : {}),
        // Only a proposal that names an engine: the card otherwise starts on the default, like New pipeline.
        ...(engine ? { engine } : {}),
        // Only when the source is remote-only, behind its remote or unverifiable (offline).
        ...(sourceRef ? { sourceRef } : {}),
        // Only a proposal with per-agent picks: { nodeId: { model, effort, subagentModel?, reason?, facts? } } and the
        // team policy's warnings about them (run cards are pinned).
        ...(cardNodes && Object.keys(cardNodes).length ? { nodes: cardNodes } : {}),
        ...(cardWarnings.length ? { warnings: cardWarnings } : {}),
        // Only a card proposing a run on its source branch carries the key (run cards are pinned).
        ...(sameAsSource ? { sameAsSource: true } : {}),
        // Only a shaped card / a nudged card carries these (run cards are pinned).
        ...(shape ? { shape } : {}),
        ...(nudge ? { nudge } : {}),
        // Only a card proposed from a run preset: what Start adds (applyPresetStart, src/shared/run-presets.mjs).
        ...(cardPreset ? { preset: cardPreset } : {}) },
    };
  }
  return { validateProposal };
}

/** Bound to the real readers — the server's authoritative re-validation and the MCP child both use it. */
export const validateProposal = createProposalValidator({
  resolveSourceRef: (dir, name, { projectKey } = {}) =>
    resolveGitSourceRef(dir, name, { remote: effectiveSyncSettings(projectKey).remote }),
  remoteName: (projectKey) => effectiveSyncSettings(projectKey).remote,
  estimate: (wfs) => estimateChoices(wfs),
  readPreset: async (id, opts) => readPresetRow(id, opts),
  hasHouseBrief: async ({ projectKey, projectDir }) => (await ensureHouseBrief({ projectKey, projectDir })).words > 0,
}).validateProposal;
