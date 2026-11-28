// src/core/orchestrator.mjs
//
// The graph engine's orchestrator. It is NOT a second harness: everything that
// is engine-agnostic (run/resume shells, worktrees, guardrails, results, cost,
// clocks, questions plumbing, sub-agent telemetry, heartbeat) lives in
// RunHarness. This class supplies the hooks plus ONE adapter, `_execute`,
// which the scheduler calls per execution.
//
// Vocabulary: an EXECUTION (not a step) is the unit. `x:<nodeId>:<ordinal>` for
// an ordinary execution, `x:<nodeId>:<ordinal>:<taskId>` for a composite slice.
// state.steps[] IS the execution ledger: one row per execution, key ===
// executionId. There is no separate executions[] array.
import { join, isAbsolute, extname, dirname, basename, sep } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { worktreeTree, treeChanges, idsAt, workLost, earlierContents } from './slice-worktree.mjs';
import { runScratchDir } from './run-manifest.mjs';
import { rm, readFile, readdir, access, stat, writeFile, mkdir, realpath } from 'node:fs/promises';
import { readDirections, pendingDirections } from './directions.mjs';
import { runsOn } from '../shared/connections.mjs';

import {
  RunHarness, isAbort, isPause, pauseErr, firstLine, jsonClone,
  clipMiddle, sumStepActive, normalizeClarifyAnswer, findDisabledPluginFor,
} from './run-harness.mjs';
import { resolveGraph, loadAgentFile, GRAPH_DEFAULT_WORKFLOW, writeGraphWorkflow, readWorkflow, isReservedWorkflowId } from './workflows.mjs';
import { loadScriptRegistry } from './script-registry.mjs';
import { loadAgentRegistry } from './agent-registry.mjs';
import { AUTO_WORKFLOW_ID, AUTO_WORKFLOW_NAME, SHAPE_WORKFLOW_ID, SHAPE_UX_WORKFLOW_ID, SHAPE_SLICE_REQ_WORKFLOW_IDS, withoutRequirementsInput } from './graph/builtin-workflows.mjs';
import { careRunGraph } from './shape/care-run.mjs';
import { classifyLoops } from '../shared/graph/loops.mjs';
import { buildGraphManifest, manifestTemplate, manifestPortsFn } from '../shared/graph/manifest.mjs';
import { DEFAULT_MAX_CYCLES, KEYED_KINDS } from '../shared/graph/constants.mjs';
import { pickDropWarnings } from '../shared/graph/role-slots.mjs';
import { factoryFallbackLines } from './factory-models.mjs';
import { scriptNodeCtx, pythonMissingSentence } from '../shared/graph/script-meta.mjs';
import { probePython } from './graph/python-probe.mjs';
import { mediaToolProblems } from './graph/media-preflight.mjs';
import { mockEnabled, runClaude } from './claude-runner.mjs';
import { createSessionHosts } from './session-host.mjs';
import { registryPortsFn } from './graph/registry-ports.mjs';
import { applyAgreement, pendingAgreement, validateAgreement } from './requirements/attached-gate.mjs';
import { checkPlan } from './shape/check.mjs';
import { clarifyCounts, shapeScoreOf } from './shape/stats.mjs';
import { PLAN_ASK_KIND, validatePlanAnswer, validateOutlineAnswer, renderPlanFeedback, SHAPING_FEEDBACK_PREVIEW } from './shape/run.mjs';
import { createSliceFeature, retireFeaturesOf, earlierSliceChanges, featureClarify, featureNotes, featureView, carriedRequirements } from './shape/features.mjs';
import { changeCaseOf } from '../shared/shape/req-change.mjs';
import { fileSha, planOutputOf } from './shape/outline-file.mjs';
import { splitRules, smallRunsOfFeature, careOfFeature, prototypeOfFeature, originPipelineOfFeature } from './shape/small-runs.mjs';
import { runPrototypeStep, validatePrototypeAnswer, PROTOTYPE_ASK_KIND } from './shape/prototype-step.mjs';
import { createPrototypeDesign, startPrototypeBuild, awaitBuild as awaitPrototypeBuild, freezePrototype, stagePrototypeForRun,
  registryOf, prototypeBrief } from './shape/prototype-design.mjs';
import { normalizePrototype, normalizeReview, prototypeRemarkBlock, prototypeReviewBlock, remarkTarget, rewriteRequirement,
  screenRequirements, validRemarkProposal, piecesOf } from '../shared/shape/prototype.mjs';
import { flagEnabled } from './flags.mjs';
import { distDir as designDistDir, designWorkDir } from './design/paths.mjs';
import { splitChallengePlan, normalizeChallenge, challengeBlock, runSplitChallenge, skipsPlanAfterSplit, splitRevisable, splitApproveError, keptObjections, splitAskFields, planReviewNode, CHALLENGER_LABEL, CHALLENGE_FILE_MAX_BYTES } from './shape/split-step.mjs';
import { careStartAsk, careAnswerValidator } from './shape/care-start.mjs';
import { careAuditLine } from './run-harness.mjs';
import { careFactsOf, careModelRoles, careRunPlan, confirmedKindsOf, CARE_LABELS } from '../shared/shape/feature-record.mjs';
import { readRunPrAuto } from './pr-auto.mjs';
import { checkSlices, applyOutlineEdits, normalizeOutline, keepConfirmed, settleLeftOut, sliceRequirementIds, OUTLINE_FILE, OUTLINE_CHANGE_FILE } from '../shared/shape/slices.mjs';
import { onlyCriteria } from '../shared/review/requirements-coverage.mjs';
import { DEFAULT_PERSPECTIVES, perspectiveByKey, roleLabelOf } from '../shared/shape/perspectives.mjs';
import { criterionPerspective, runRolesOf } from '../shared/shape/requirements.mjs';
import { normalizePlanConcern, planConcernFileName, concernFeedbackSection, requirementConcernOf, requirementConcernFeedbackSection } from '../shared/review/plan-concern.mjs';
import { ensureHouseBrief } from './house-brief.mjs';
import { extractChecklist } from '../shared/shape/checklist.mjs';
import { applyChecklist, checklistFindingsMarkdown, mergeReportedChecklists, normalizeReviewChecklist } from '../shared/shape/review-checklist.mjs';
import { REFINER_SINK, roleReviewOf, roleChecklistOf, runningRoles, rolesForRound, roleTaskId, roleRecord, findingsMarkdown, refinerVerdict, roleTargetOf, roleRoutingVerdict } from '../shared/graph/role-review-step.mjs';
import { DISPOSITIONS_MAX_BYTES, applyDispositions, withCounts, normalizeConflicts, dispositionsPathFor, conflictClarifications, withClarifications } from '../shared/review/findings.mjs';
import { currentPass } from '../shared/shape/role-review.mjs';
import { gateStop, planStop, concernStop, stopDoneText, stopOptionOf, settledLine, SETTLED_CONCERN_FEEDBACK } from '../shared/shape/run-stops.mjs';
import { verifyResult, verifyRoundPlan, verifyStop, verifyGateAnswer, gapAnswerSummary, awayGapSplit, mergeGapDecision,
  answeredByOf, ANSWERED_BY_WORDS } from '../shared/shape/verifier.mjs';
import { VERIFY_RESULT_FILE } from './shape/verifier.mjs';
import { criteriaCheck, criteriaList, criterionIds, coverageOf, criteriaExamples } from '../shared/review/coverage.mjs';
import { normalizeDecisions, conflictDecisions, validateDecisionPicks, decisionClarifications } from '../shared/review/decisions.mjs';
import { createScheduler, sliceExecutionId, QUIESCENCE_WARNING } from './graph/scheduler.mjs';
import { sigkillGraceMs } from './engines/spawn.mjs';
import { runExecution, allocateOutputs, allocateVerdict, readDecomposition, decompositionProblems, CHECKLIST_REVIEWER_KEY, SLICE_PLANNER_KEY, SLICE_SCOPE_AGENT_KEYS, TEST_WRITER_AGENT_KEY, _testing as executorTesting } from './graph/executor.mjs';
import { serialQueue, measureCodeCursor, collectStepEvidence, withoutMembers } from './graph/human-evidence.mjs';
import { estimateStepHours, resolveConstants, sumStepHours } from '../shared/human-estimate.mjs';
import { diffNumstat } from './git-info.mjs';
import { humanEstimateOverrides } from './settings.mjs';
import { renderPromptArtifact, mockMarkers } from './phases.mjs';
import { listModels, modelHasBaseUrlRouting, resolveRunConfig, stepSlotDefaults, slotSourceLines, modelCostConfig, bridgedModelInfo } from './config.mjs';
import { isPremiumModel } from './model-tiers.mjs';
import { noModelLines } from './role-defaults.mjs';
import { defragSlotPair, utilityModelFor } from './settings-cascade.mjs';
import { resolveDefragModel, agentPairText } from './memory-defrag-model.mjs';
import { withRole, roleOf } from './model-roles.mjs';
import { describeScanModels } from './workspace-scan-run.mjs';
import { assembleShape, normalizeShape, ShapeError } from '../shared/graph/assemble.mjs';
import { blockingIssues } from '../shared/graph/verdict.mjs';
import { RECIPE_SHAPES } from './auto/recipes.mjs';
import { fingerprintProject, fingerprintWorkspace } from './auto/fingerprint.mjs';
import { classifyTask, ClassifierError } from './auto/classify.mjs';
import { autoCandidates, findEquivalentWorkflow } from './auto/match.mjs';
import { buildProposal, sanitizeProposalAnswer, remapTunables, mintAutoWorkflowId } from './auto/proposal.mjs';
import { resolveAutoModel } from './auto/model.mjs';
import { autoModelsFor } from './auto/runnable.mjs';
import { probeClaudeAuth, isClaudeSignedOutError, CLAUDE_SIGNED_OUT_MESSAGE } from './preflight.mjs';
import { configuredClaudeBin } from './cli-resolve.mjs';
import { helperEngineFor } from './model-env.mjs';
import {
  appendAudit, writeReview, reviewKindOf, writeDecomposition, updateTaskStatus,
  updatePhaseStatus, writeStepQuestions, readStepQuestions, forgetMissingArtifacts,
  indexedNamesUnder, forgetOtherKinds,
} from './artifacts.mjs';
import { readAskFile } from './protocol.mjs';
import { prepareFormAsk, formAnswerValidator, downgradeQuestion, redactSecrets } from './ask-forms.mjs';
import { classifyError } from './recoverable-error.mjs';
import { withRecoveryRetry, RETRYABLE_CLASSES, HELPER_RETRY_ATTEMPTS } from './recovery-backoff.mjs';
import { resolveFailure, markTerminal, isTerminal } from './failure-policy.mjs';
import { byActor, actorLabel } from './identity.mjs';
import { NIGHT_ACTOR } from './night/config.mjs';
import { isExecEnvFatal } from './exec-env/index.mjs';

/** Max ask-then-resume question rounds per execution (mirrors v1's constant). */
const MAX_QUESTION_ROUNDS = 3;

/** A gate answer: exactly `{decision: 'another' | 'continue'}`, else null (the question stays open). */
export const gateAnswer = (raw) => (raw && (raw.decision === 'another' || raw.decision === 'continue') ? { decision: raw.decision } : null);

/** #990 s5: the plan concern ask of one implementer execution. */
const planConcernAskId = (ctx) => `plan-concern-${ctx.nodeId}-c${ctx.ordinal}`;

function abortError(msg = 'aborted') {
  const e = new Error(msg);
  e.name = 'AbortError';
  return e;
}

/** Token usage summed over the classifier's attempts (a retry is billed to the same round). */
const sumUsage = (a, b) => ({
  input_tokens: (Number(a?.input_tokens) || 0) + (Number(b?.input_tokens) || 0),
  output_tokens: (Number(a?.output_tokens) || 0) + (Number(b?.output_tokens) || 0),
});

export function createOrchestrator(opts = {}) {
  return new GraphOrchestrator(opts);
}

export class GraphOrchestrator extends RunHarness {
  constructor(opts) {
    super(opts);
    // The graph default. createOrchestratorFor always passes an explicit id.
    if (!this.opts.workflowId) this.workflowId = GRAPH_DEFAULT_WORKFLOW.id;
    // (this._runners is assigned by the _initRunners hook the base constructor calls.)
    this.resolved = null;        // resolveGraph's { template, ports, loops, nodes→nodeCtx, wires, agentsByKey, agentKeys }
    this.scriptRegistry = null;   // loadScriptRegistry() for this run (D16-filtered); tests override the built-in dir with opts.scriptsDir
    this._scheduler = null;
    this._graphSnapshot = null;  // last CLEAN scheduler snapshot
    this._resumeSnapshot = null; // the snapshot a resume restores from
    this._resumeSessions = null; // Map executionId -> sessionId (one-shot)
    this._graphError = null;     // first genuine execution error (identity preserved)
    this._planVersion = 0;       // {vsuffix} ticks, carried across a resume
    this._planRevise = null;     // {id, path}: a revise answered just before a pause (F19), carried across a resume
    this._protoAnswer = null;    // C1 (D16): {key, payload} of the last Prototype answer, until the step persisted it
    this._protoSeq = 0;          // C1: prototype asks raised by this orchestrator
    this._protoAskId = null;     // C1: the open (or last) prototype ask's id, for who answered a stop
    this._protoCtx = undefined;  // C1 (D14): this run's staged prototype context, once read
    this._protoShown = null;     // C1: the last announced moment|round|build of the Prototype step
    this._planConcernAnswer = null; // {id, payload}: a plan concern answered just before a pause (#990 s5), carried across a resume
    this._planAwayApproved = null;  // {id}: a plan ask Away mode approved just before a pause, carried across a resume
    this._planConcernSeen = {};     // {[id]: 'raised' | 'decided'}: audited once per concern across resumes (#990 s5)
    this._smallRunsMarked = null;   // Small runs C3 (D7): fixed before the scheduler starts, carried on the resume point
    this._stopAnswer = null;        // C3 (D14): {id, payload} of a stop answered just before a pause, replayed once
    this._stopSettled = new Set();  // C3 (D3): gate ids the agents settled (the gate's audit line names them)
    this._planConcernHeld = null;   // {id, concern}: the parsed concern, carried across a resume (the agent need not rewrite it)
    this._slicingDone = false;   // L2: the Planner's slicing offer is over (no outline, or one decided); carried across a resume
    this._outlineRevise = null;  // the feedback of an outline revise answered before a pause, carried across a resume
    this._sliceScopeCache = null;
    this._secretEnv = {};        // typed `secret` form fields, MEMORY ONLY: never persisted, so a resume after a restart falls back to the environment
    this._humanCursor = null;          // cumulative worktree numstat at the last agent/script terminal (money-saved §3.1)
    this._humanCursorReady = false;    // baseline measured at the first agent/script start, or restored from the resume point
    this._humanRun = serialQueue();    // measure-then-credit is atomic per execution: slices that end together split, never double
    this._taskArtifact = null;   // the pre-rendered task document
    this.extrasFiles = [];
    // Auto workflow (spec §5): the decision loop's state. `feedback`/`round`/`prior`
    // ride the resume point while the run is undecided; `costUsd` is the running
    // classifier spend shown in the proposal. `pending` = the proposal that is OPEN
    // (or the round a cost cap parked), replayed on resume without a classifier call.
    // `classify` is the test seam.
    this._auto = { feedback: [], round: 0, prior: null, costUsd: 0, pending: null };
    this._classify = typeof opts?.classify === 'function' ? opts.classify : null;
    // Whether Claude Code is signed in decides which models Auto may design with
    // (auto/runnable.mjs). `claudeAuth` is the test seam.
    // The run's `bin` only on a Claude run: on any other run it is another CLI's (cursor-agent on a Cursor run), and the
    // probe reads Claude's own sign-in. With no run `bin`, the binary a spawn would use (WORCA_CLAUDE_BIN).
    this._claudeAuthInjected = typeof opts?.claudeAuth === 'function';
    this._claudeAuth = this._claudeAuthInjected ? opts.claudeAuth
      : () => probeClaudeAuth({ bin: ((this.claude.engine || 'claude') === 'claude' && this.claude.bin) || configuredClaudeBin() });
    Object.assign(this.state, {
      engine: 2,
      active: [],                // [{nodeId, executionId}]
      endReached: false,
      openIssues: [],
      result: null,              // {type, path?, value?} | null
      warnings: [],
      scopeNotices: [],          // E9: [{nodeId, executionId, count, expectedCount, cross, notable:[{path, tool, cross?}]}]
      wireDeliveries: {},        // {[wireId]: n}
      tokens: {},                // {'<node>.<port>': {seq,type,path,firedAt}}
      gate: null,                // {wireId, fromNode, toNode, askId} | null
      progressFacts: { tasks: {}, reviews: {} },   // run progress (P2): {tasks:{[nodeId]: total}, reviews:{[nodeId]: {pass, blocking}}}
    });
  }

  // ── hook 6: the runner registry (constructor seam, P1) ─────────────────────
  /** The test seam (§5.4). NO defaultRunners and NO bound clarifier: selection
   *  is P3's runExecution (node.kind, then meta.runnerType), never an agent key. */
  _initRunners(opts) {
    this._runners = { ...((opts && opts.runners) || {}) };
  }

  // ── hook 1: topology ───────────────────────────────────────────────────────
  /**
   * Resolve the workflow row into a runnable graph and build the manifest. The
   * base validates the returned bag, calls _preflightAgentKeys(agentKeys), then
   * stamps state.stepper BEFORE the first `state` emit (run-harness.mjs:475-482),
   * and later collectRequiredSkills(registry, agentKeys).
   * @param {Record<string,object>} registry loadAgentRegistry() output
   * @returns {Promise<{manifest:object, agentKeys:Set<string>, workflow:{id:string,name:string}}>}
   */
  async _resolveTopology(registry) {
    this.scriptRegistry = loadScriptRegistry({ scriptsDir: this.opts.scriptsDir, agentKeys: Object.keys(registry || {}) });
    if (this.workflowId === AUTO_WORKFLOW_ID) return this._autoBootstrapTopology();
    // Settings › Memory: a defragment run (memoryScope ⇔ wf_memory_defrag, checked in the
    // constructor) resolves its model/effort pair HERE — the one place every entry point reaches
    // (the Memory view's button, New pipeline, an Ask card, a schedule and the CLI all construct
    // this class). resume() never calls this hook: the manifest froze the pair on the node.
    const defrag = this.memoryScope ? await this._defragAgentPair() : null;
    const scan = this._scanModelPins();
    // A per-run overlay (POST /api/run `overlay`, checked by the route: the Ask run card's per-agent picks) merges PER
    // NODE over the project layer for THIS run only — never with `ignoreProjectOverrides`, which is Auto's own tuning.
    // A model always names its effort ('' = the model's default) so a stored effort never rides under it (resolveGraph
    // merges per key): the route's check names it, but a firing schedule ticket's re-parse drops the '' — Auto's
    // proposal uses the same form (auto/proposal.mjs).
    // Loop budgets ride the same overlay (`wires: { wireId: { maxCycles } }`, a run preset's loops).
    const rawOver = this.opts && this.opts.overlay && typeof this.opts.overlay === 'object' ? this.opts.overlay : {};
    const rawNodes = rawOver.nodes;
    const overlayNodes = rawNodes && typeof rawNodes === 'object' && !Array.isArray(rawNodes)
      ? Object.fromEntries(Object.entries(rawNodes).filter(([, e]) => e && typeof e === 'object' && !Array.isArray(e))
        .map(([id, e]) => [id, typeof e.model === 'string' && e.model && e.effort === undefined ? { ...e, effort: '' } : { ...e }]))
      : {};
    const overlayWires = {};
    for (const [id, w] of Object.entries(rawOver.wires && typeof rawOver.wires === 'object' ? rawOver.wires : {})) {
      if (w && Number.isInteger(w.maxCycles) && w.maxCycles >= 1) overlayWires[id] = { maxCycles: w.maxCycles };
    }
    const hasNodes = Object.keys(overlayNodes).length > 0;
    const hasWires = Object.keys(overlayWires).length > 0;
    const overlay = hasNodes || hasWires ? { ...(hasNodes ? { nodes: overlayNodes } : {}), ...(hasWires ? { wires: overlayWires } : {}) } : null;
    // Shaper small runs B2 (D13): a later run of a marked feature fills its Default agents' models from the feature's Care.
    const featureId = this.runShape?.slice?.feature || null;
    const care = featureId && smallRunsOfFeature(featureId) ? careOfFeature(featureId) : null;
    // Small runs C2 (D7): a slice run of a marked feature with owned requirement ids also takes its Care plan's graph
    // (Test writer, fix cycles, second opinion), fixed here at start in `manifest.careRun`.
    const ownedIds = this.runShape?.slice ? sliceRequirementIds(this.runShape.slice) : [];
    const careRun = care?.position && SHAPE_SLICE_REQ_WORKFLOW_IDS.includes(this.workflowId) && ownedIds.length
      ? careRunPlan(care.position, { runRoles: runRolesOf(ownedIds), lead: this.runShape?.lead || null }) : null;
    const resolved = await resolveGraph(this.projectDir, this.workflowId, registry, this.agentsDir, {
      ...this._graphResolveOptions({ overlay, defrag, scan }),
      ...(care ? { roleFill: { source: 'care', roles: careModelRoles(care.position) } } : {}),
      ...(careRun ? { transform: (t) => this._careRunGraph(t, careRun) } : {}),
    });
    this._adoptResolvedGraph(resolved);
    if (care) this._logCareFill(care.position, resolved);
    if (careRun) {
      const line = this._careRunLine(careRun, overlay);
      this._log('orchestrator', 'info', line);
      this._pendingAudits.push(`${line}.`);
    }
    // A model a person set that needs the Claude Code sign-in while it is signed out: the engine gate refuses the start
    // (RunHarness#_engineGate). Fresh starts only: resume never resolves, so this stays null there.
    this._signInBlocked = resolved.signInBlocked
      ? resolved.signInBlocked.map((b) => (b.source === 'pair' ? { ...b, pair: this.memoryScope ? 'defrag' : 'scan' } : b)) : null;
    this._signInLabels = this._signInBlocked ? await this._modelLabels() : null;
    // Cascading settings §7: name each node model that came from a step slot, and where it was set
    // (run log + audit), so a model the engine rejects is traceable to its setting.
    const engineNow = this.claude.engine || 'claude';
    for (const line of slotSourceLines(engineNow, this.resolved.nodeCtx, stepSlotDefaults(engineNow, { projectDir: this.projectDir, workspace: this.isWorkspace }))) {
      this._log('orchestrator', 'info', line);
      this._pendingAudits.push(`${line}.`);
    }
    // #1450: say which steps run on a Worca default, which ones the tool picks for ("Let Claude Code decide"), and warn
    // where Worca cannot know the model at all (another harness, or Claude Code signed out: no default was given).
    const agentNodes = Object.values(this.resolved.nodeCtx || {}).filter((nc) => nc.kind === 'agent');
    const signedOut = engineNow === 'claude' && resolved.claudeAuth === 'signed-out' && agentNodes.some((nc) => !nc.model && nc.modelSource === null);
    const noModel = noModelLines(engineNow, this.resolved.nodeCtx, {
      claudeAuth: signedOut ? 'signed-out' : 'unknown', labelOf: ((labels) => (id) => labels?.[id] || id)(await this._modelLabels()),
      roleOf: (nc) => roleOf(`steps.${nc.authoredKey || nc.key}`, { name: nc.meta?.displayName || '' }),
    });
    // Only warnings reach the audit: the per-step "runs on X (Worca's default)" lines stay in the run log (the Agents
    // tab shows the resolved model), so the audit, and the feature log keyed by its positions, keep dev's shape.
    const noModelWarns = signedOut || !['claude', 'codex'].includes(engineNow);
    for (const line of noModel) {
      this._log('orchestrator', noModelWarns ? 'warn' : 'info', line);
      if (noModelWarns) this._pendingAudits.push(line);
    }
    // No silent fallbacks: name each pick the engine dropped (run log + audit, once, at start).
    for (const line of this._notePickDrops()) {
      this._log('orchestrator', 'warn', line);
      this._pendingAudits.push(`${line}.`);
    }
    await this._noteFactoryFallbacks(resolved.factoryNotes);
    // A setting that failed the catalog check degrades — and says what the run uses INSTEAD, read
    // off the resolved graph (a project's own pick, a team default or the template's model): a run
    // log line, and an audit line queued until the pipeline dir exists (RunHarness._pendingAudits).
    if (defrag && defrag.warning) {
      const text = `${defrag.warning} — the run uses ${agentPairText(this.resolved.nodeCtx)}`;
      this._log('orchestrator', 'warn', text);
      this._pendingAudits.push(`${text}.`);
    }
    this._preflightScriptKeys(this.resolved.scriptKeys);
    await this._preflightScriptRuntimes();
    await this._preflightMediaTools();
    // The manifest is built from the RESOLVED template, the resolver's registry
    // slice and its EFFECTIVE per-node/per-wire values (P2 contract): the run
    // monitor shows exactly what the engine will run.
    const manifest = buildGraphManifest(this.resolved.template, this.resolved.agentsByKey, {
      overlays: { nodes: this.resolved.nodeCtx, wires: this.resolved.wires }, scripts: this.resolved.scriptsByKey,
    });
    // What THIS run was told to use over the project's settings, beside the cells it resolved to (the run page marks
    // those pills "this run only"; resume reads the cells, never this).
    if (overlay) manifest.runOverlay = structuredClone(overlay);
    if (careRun) manifest.careRun = structuredClone(careRun);
    // D8: the named version this run used (plans/workflow-tests-plan.md); absent = the workflow's row.
    if (Number.isInteger(resolved.versionNo)) manifest.workflowVersion = { no: resolved.versionNo };
    return {
      manifest,
      agentKeys: new Set(this.resolved.agentKeys),
      workflow: { id: this.workflowId, name: this.resolved.template.name || this.workflowId },
    };
  }

  /** Small runs C2 (D6): the Care graph of a slice run (a seam the tests stub with a refused transform). */
  _careRunGraph(template, plan) {
    return careRunGraph(template, plan);
  }

  /** Small runs C2 (run 1): the origin planning run builds slice 1 itself. Its Care graph (Test writer, fix cycles, second
   *  opinion) was applied at the Start step (`_careOriginGraph`); once its Split is approved and slice 1's ids are known,
   *  it stamps slice 1's Care plan on the live manifest, so the plan review runs Care's reviewers (`_careRoles`).
   *  Idempotent; a run without Care, owned ids or a manifest is left as dev's. */
  async _careOriginRun() {
    const rec = this._shapeRec;
    const manifest = this.state.stepper;
    const sl = this.runShape?.slice;
    if (!rec?.smallRuns || !rec.care?.position || !manifest?.graph || manifest.careRun || sl?.index !== 1) return;
    const ownedIds = sliceRequirementIds(sl);
    if (!ownedIds.length) return;
    const plan = careRunPlan(rec.care.position, { runRoles: runRolesOf(ownedIds), lead: this.runShape?.lead || null });
    // What the run actually builds with: a graph the Care transform could not shape keeps the Implementer writing tests.
    plan.testWriter = plan.testWriter && manifest.graph.nodes.some((n) => n.key === TEST_WRITER_AGENT_KEY);
    manifest.careRun = structuredClone(plan);
    const line = this._careRunLine(plan, manifest.runOverlay || null);
    this._log('orchestrator', 'info', line);
    if (this.pipeline) await appendAudit(this.pipeline.dir, `${line}.`).catch(() => {});
    await this._persist();
  }

  /** Small runs C2: the run's one Care line, its fix-cycle limit read from the resolved code review loop (a project or
   *  run budget wins over Care's, and the line says so). */
  _careRunLine(plan, overlay) {
    const limit = this.resolved?.wires?.w9?.maxCycles ?? plan.fixCycles;
    const by = overlay?.wires?.w9 ? 'this run' : 'the project';
    const cycles = limit === plan.fixCycles ? `fix cycles ${limit}` : `fix cycles ${limit}, set by ${by}`;
    const tests = plan.testWriter ? 'tests first, by a separate Test writer' : 'tests first, by the Implementer';
    const reviewers = plan.planReviewers.length === 1 ? `${roleLabelOf(plan.planReviewers[0])} only, the run owns no other role`
      : plan.planReviewers.map(roleLabelOf).join(', ');
    return `Care ${CARE_LABELS[plan.position]}: ${tests}, ${cycles}, plan reviewers ${reviewers}`;
  }

  /** The options every resolveGraph of this run shares: its engine, run model, workspace, scripts and sign-in probe, plus
   *  the run overlay and the pinned pairs `_resolveTopology` computed (B2: the Care probe and adopt reuse them). */
  _graphResolveOptions({ overlay = null, defrag = null, scan = null } = {}) {
    return {
      use: this.opts && this.opts.workflowUse !== undefined ? this.opts.workflowUse : 'live',
      engine: this.claude.engine || 'claude', runModel: this.claude.model || null, isWorkspace: this.isWorkspace, scripts: this.scriptRegistry, ...(overlay ? { overlay } : {}), ...(defrag && defrag.pair ? { agentPair: defrag.pair } : {}),
      ...(scan ? { agentPair: scan.agentPair, subagentPin: scan.subagentPin } : {}), claudeAuth: this._resolveClaudeAuth(),
    };
  }

  /** B2: one run-log line per node Care filled (beside the step-slot lines). */
  _logCareFill(position, resolved) {
    for (const id of resolved?.fillNotes?.filled || []) {
      const nc = resolved.nodes?.[id];
      this._log('orchestrator', 'info', `Care ${CARE_LABELS[position] || position}: ${nc?.meta?.displayName || nc?.key || id} runs on ${nc?.model || 'the default model'}`);
    }
  }

  /**
   * Settings › Memory: the pair every agent node of this Memory defragment run uses
   * (memory-defrag-model.mjs) — the one named at start (`claude.model` / `claude.effort`: the
   * CLI's --model, a CLI-made schedule) wins, else the stored setting, validated against THIS
   * project's catalog. A setting that fails the check comes back as `warning` (the caller logs it
   * once the graph says what the run uses instead) — never a refused run. `pair: null` ⇒ the node
   * layers resolve exactly as before.
   * @returns {Promise<{pair: ({model:string, effort:(string|null)}|null), warning: (string|null)}>}
   */
  async _defragAgentPair() {
    const engine = this.claude.engine || 'claude';
    const explicit = { model: this.claude.model, effort: this.claude.effort };
    // Model roles (D3): an unset defragment slot takes the quick role. Not Worca's role default (#1450): the factory
    // default (resolveGraph) fills the node instead, and its sign-in drop rule applies.
    const stored = withRole(defragSlotPair(engine, this._settingsScope()), engine, 'memoryDefrag', { floor: false });
    // The catalog read only when the setting is the one that decides.
    const models = !(typeof explicit.model === 'string' && explicit.model.trim()) && stored.model
      ? (await listModels(this.projectDir)).filter((m) => runsOn(m, engine)) : [];
    const r = resolveDefragModel({ explicit, stored, models });
    if (!r.model) return { pair: null, warning: r.warning };
    this._log('orchestrator', 'info', `Memory defragment model: ${r.model}${r.effort ? ` · ${r.effort}` : ''} (${r.source === 'explicit' ? 'named at start' : (engine === 'claude' ? 'Settings › Memory' : 'Models › Jobs › Helper jobs')})`);
    return { pair: { model: r.model, effort: r.effort }, warning: r.warning };
  }

  /**
   * Workspace scan (D19): the four picks the scan started with — POST /api/workspaces/scan resolved
   * them (the Create workspace column, else Settings › Runs › Workspaces, else Sonnet · medium) —
   * become the pair of every scan agent node (survey, usage, synthesis) and the pin of the fan-out
   * stages' investigators. Start only: resume() rebuilds from the manifest, which froze them on the
   * node. No picks (a hand-built run) ⇒ the template's defaults.
   * @returns {{agentPair:{model:string, effort:(string|null)}, subagentPin:{model:string, effort:string}}|null}
   */
  _scanModelPins() {
    if (!this._isWorkspaceScan()) return null;
    if ((this.claude.engine || 'claude') !== 'claude') {
      const slot = utilityModelFor(this.claude.engine, 'workspaceScan', { workspace: true });
      if (!slot.model) return null;
      return { agentPair: { model: slot.model, effort: slot.effort }, subagentPin: null };
    }
    const m = this.opts.scanModels;
    if (!m || typeof m !== 'object' || !m.scanModel) return null;
    this._log('orchestrator', 'info', `Workspace scan models: ${describeScanModels(m)} (${m.source || 'explicit'})`);
    if (m.warning) {
      this._log('orchestrator', 'warn', m.warning);
      this._pendingAudits.push(`${m.warning}.`);
    }
    return {
      agentPair: { model: m.scanModel, effort: m.scanEffort || null },
      subagentPin: { model: m.agentModel, effort: m.agentEffort },
    };
  }

  /** The Auto entry before the decision: an EMPTY graph tagged `deciding`, so
   *  the run row, the Running page and a pre-decision resume point all have a
   *  manifest to carry (spec §5.2). */
  _autoBootstrapTopology() {
    const manifest = buildGraphManifest({ id: AUTO_WORKFLOW_ID, name: AUTO_WORKFLOW_NAME, version: 2, domain: 'coding', nodes: [], wires: [] }, {});
    manifest.auto = { status: 'deciding', humanInLoop: this.humanInLoop };
    return { manifest, agentKeys: new Set(), workflow: { id: AUTO_WORKFLOW_ID, name: AUTO_WORKFLOW_NAME } };
  }

  // ── Auto workflow: the decision loop (spec §5.3) ──────────────────────────
  /**
   * Classify → assemble → match → propose → (accept | revise | cancel) → adopt.
   * run() calls it (no argument) AFTER createPipeline + the run root (the hook site
   * in run-harness.mjs); resume() calls it with `{ resume: rp }` BEFORE the setup
   * replay for a run that paused undecided. Returns the topology bag that replaces
   * the bootstrap manifest, or null when there is nothing to decide.
   */
  async _decideTopology({ resume = null } = {}) {
    if (this.workflowId !== AUTO_WORKFLOW_ID) return null;
    if (resume) {
      if (resume.manifest?.auto?.status !== 'deciding') return null;   // decided before the pause: the normal resume path
      const saved = resume.auto || {};
      this._auto = {
        ...this._auto,
        feedback: Array.isArray(saved.feedback) ? [...saved.feedback] : [],
        round: Number(saved.round) || 0,
        prior: saved.prior || null,
        costUsd: Number.isFinite(Number(saved.costUsd)) ? Number(saved.costUsd) : 0,   // B5: the spend before the pause
        // B4/B6: the proposal that was OPEN (or the round a cost cap parked) — replayed below without a classifier call
        pending: saved.pending && saved.pending.shape && typeof saved.pending.shape === 'object' ? jsonClone(saved.pending) : null,
      };
      // resume() stamps titleProvisional only AFTER this hook (run-harness.mjs:1420); a point
      // re-stamped while the replayed proposal is open must not lose the flag.
      if (resume.titleProvisional === true) this.state.titleProvisional = true;
      this.humanInLoop = typeof saved.humanInLoop === 'boolean' ? saved.humanInLoop : (resume.manifest.auto.humanInLoop ?? this.humanInLoop);
    }
    this._setupStage('Choosing a workflow');
    try {
      return await this._decideTopologyInner();
    } catch (err) {
      // Whatever unwinds the decision (a cost cap, a classifier failure, the user's
      // pause, a stop) leaves the CURRENT decision state on the row: both shells keep
      // state.resumePoint when it is already set (run-harness.mjs :1150 / :1475 — a
      // resume would otherwise re-arm the point it consumed, with a stale
      // round/feedback), _pauseForFailure prefers it and restamps reason/detail, and
      // the stop branch nulls it.
      if (this.pipeline && this.workflowId === AUTO_WORKFLOW_ID) this.state.resumePoint = this._buildResumePoint(null);
      throw err;
    }
  }

  async _decideTopologyInner() {
    const registry = this.registry;
    // Node models stay on the run engine; the classifier call runs on the helper engine (Claude on a Cursor run).
    const engine = this.claude.engine || 'claude';
    const helper = helperEngineFor(engine);
    let helperAuth = 'unknown';
    if (helper === 'claude') {
      // On a Claude run: the run's own sign-in. On a Cursor run: the helper's Claude (the seam probes with no bin).
      try { helperAuth = (await this._claudeAuth())?.state || 'unknown'; } catch { /* unknown narrows nothing */ }
      // #1450: Auto's resolve reads the sign-in for the Worca-default floor; on a Claude run it reuses this probe.
      if (engine === 'claude') this._autoAuthState = helperAuth;
    }
    const catalog = (await listModels(this.projectDir)).filter((m) => runsOn(m, engine));
    const runnable = autoModelsFor(catalog, { auth: engine === 'claude' ? helperAuth : 'unknown', routed: modelHasBaseUrlRouting });
    const models = runnable.models;
    const requireModel = runnable.requireModel;
    if (runnable.note) this._log('orchestrator', requireModel ? 'info' : 'warn', `auto: ${runnable.note}`);
    const slot = this._utilitySlot('classifier');
    // The classifier's own call runs on the helper engine: on a Cursor run that is Claude, picking from Claude's catalog.
    let callPool = models;
    if (helper !== engine) {
      const pool = autoModelsFor((await listModels(this.projectDir)).filter((m) => runsOn(m, helper)), { auth: helperAuth, routed: modelHasBaseUrlRouting });
      if (pool.note) this._log('orchestrator', 'warn', `auto: ${pool.note}`);   // e.g. Claude signed out on a Cursor run
      callPool = pool.models;
    }
    const model = resolveAutoModel(callPool, { engine: helper, ...(helper !== 'claude' || slot.source === 'project' ? { setting: slot.model || '' } : {}) });
    const fingerprint = this.isWorkspace
      ? await fingerprintWorkspace(this.members, {
        name: this.workspace.name,
        description: this.workspaceDescription || this.workspace.description || '',
      })
      : await fingerprintProject(this.projectDir);
    this._log('orchestrator', 'info', `auto: fingerprint ${Buffer.byteLength(fingerprint, 'utf8')} B`);
    const extras = await this._autoExtras();
    const taskText = this.pipeline?.promptText || this.opts.prompt || '';
    const classify = this._classify || ((input) => classifyTask(input));
    for (;;) {
      this._checkAbort();
      this._checkPause();
      // B4/B6: a pending proposal (a pause with the question open, a cost cap inside the round, a
      // server restart) is re-proposed AS-IS: the assembler and the matcher are deterministic and
      // free, so the user sees the SAME proposal and pays no second classifier bill. Not a new round.
      const pending = this._auto.pending;
      let round;
      let classifyFor;
      if (pending) {
        round = Number(pending.round) || this._auto.round || 1;
        this._auto.round = round;
        classifyFor = async (input) => ({
          shape: jsonClone(pending.shape), warnings: Array.isArray(pending.warnings) ? [...pending.warnings] : [],
          attempts: 0, costUsd: 0, usage: { input_tokens: 0, output_tokens: 0 }, raw: '', model: input.model || null, replayed: true,
        });
        this._log('orchestrator', 'info', `auto: re-proposing round ${round} from the saved point (no classifier call)`);
      } else {
        this._auto.round += 1;
        round = this._auto.round;
        classifyFor = (input) => this._classifyWithRetry(classify, input);
      }
      let outcome;
      try {
        outcome = await this._autoRound({ registry, models, requireModel, model, fingerprint, extras, taskText, classify: classifyFor, round });
      } catch (err) {
        if (isAbort(err) || isPause(err)) throw err;
        if (pending && err instanceof ShapeError) {
          // The saved shape no longer assembles (the registry changed while the run was parked):
          // drop it and classify afresh in THIS resume instead of parking the run a second time.
          this._log('orchestrator', 'warn', `auto: the saved proposal no longer assembles (${firstLine(err.message)}); classifying afresh`);
          this._auto.pending = null;
          continue;
        }
        if (err instanceof ClassifierError && !pending && RETRYABLE_CLASSES.includes(classifyError(err))) {
          // A provider 429 / dropped connection that outlasted _classifyWithRetry says
          // nothing about the task: run the default workflow rather than park a run
          // that has not started. Only a transient cause falls back — an unusable reply
          // or a timeout keeps the D17 pause below.
          return await this._autoFallbackDefault({ err, registry, round, nodeModel: requireModel ? model : null });
        }
        if (err instanceof ClassifierError || err instanceof ShapeError) {
          // spec D17 / §5.6: the shell's failure policy parks the run (setup site ⇒
          // pause, reason 'error', detail = the message) and the resume point keeps
          // auto.status 'deciding' + this loop's state, so resume() re-decides.
          this._log('orchestrator', 'warn', `auto: classifier failed: ${firstLine(err.detail || err.message)}`);
          // The pause shows this message: signed out mid-run reads as what to do, not as a failed helper.
          if (isClaudeSignedOutError(err.detail || err.message)) err.message = CLAUDE_SIGNED_OUT_MESSAGE;
        }
        throw err;
      }
      const { proposal, template, match, tunables, shape } = outcome;
      this._checkPause();   // a pause requested while the classifier was out parks the run BEFORE any row is written
      if (this.humanInLoop) {
        // B6: the proposal may stay open for hours. Stamp the current decision state on the row
        // NOW, so a server restart in this window reconciles to a RESUMABLE row that resumes
        // into this very proposal. _autoAdopt nulls the point once decided; every throw below
        // it goes through _decideTopology's catch, which rebuilds the point (pending included).
        await this._stampDecisionPoint();
      }
      const answer = this.humanInLoop
        ? await this._autoAsk(proposal, models, registry)
        : { decision: 'accept', name: proposal.name, nodes: {} };
      if (answer.decision === 'cancel') {
        this._log('orchestrator', 'info', 'auto: cancelled by the user');
        await appendAudit(this.pipeline.dir, 'Auto workflow **cancelled** by the user.').catch(() => {});
        this.stop();
        throw abortError('cancelled');
      }
      if (answer.decision === 'revise') {
        this._auto.pending = null;                       // answered: the next round classifies afresh
        this._auto.feedback.push(answer.text);
        this._auto.prior = shape;
        this._log('orchestrator', 'info', `auto: revise — ${clipMiddle(answer.text, 200)}`);
        // PR #434 review, finding 2: until the NEXT round's own stamp the feedback lives only in
        // memory, and that round opens with a 60–120 s classifier call. A hard kill in that
        // window (ui/server.mjs shutdown() never pauses runs; the boot reconcile keeps the row's
        // point) would resume into the stamp above and re-show the ORIGINAL proposal with the
        // revise text gone. Persist the decision state now.
        await this._stampDecisionPoint();
        continue;
      }
      return await this._autoAdopt({ template, match, tunables, shape, answer, registry, round });
    }
  }

  /** One round: classifier call (one assembler-driven retry), match, proposal. */
  async _autoRound({ registry, models, requireModel = false, model, fingerprint, extras, taskText, classify, round }) {
    const runEngine = this.claude.engine || 'claude';
    const helper = helperEngineFor(runEngine);
    const input = {
      taskText, extras, fingerprint, models, requireModel, registry,
      engine: helper,                                  // the classifier's own spawn: Claude on a Cursor run
      domain: 'coding',                                // the domain the assembler stamps: coding + shared + general agents are offered
      humanInLoop: this.humanInLoop, feedback: [...this._auto.feedback], priorShape: this._auto.prior,
      // D6 amendment (2026-09-07): the classifier may Grep/Glob/Read the RUN'S OWN checkout to
      // size the change — this.runCwd is set by _setupRunRoot before the run() hook
      // and rehydrated by _reattachCheckouts before the resume() hook. It is never the
      // user's live checkout. With no worktree (not a case a project run reaches today) it
      // falls back to the scratch dir, text-only, exactly as before. (A workspace run adds
      // `workspace` (members + each checkout, ./repos/<key> under a detached run root) and,
      // under legacy mode, the non-primary worktrees as `addDirs`.)
      model, cwd: this.runCwd || this.pipeline.dir, repoLook: !!this.runCwd, mock: this.claude.mock,
      ...(helper === runEngine && this.claude.bin ? { bin: this.claude.bin } : {}),   // the run's bin is the run engine's
      ...this._autoWorkspaceInput(),
      // Stop OR pause ends the call (the same composition every node spawn uses).
      signal: AbortSignal.any([this.abort.signal, this.pauseAbort.signal]),
      envScrub: this.guardrails?.envScrub || undefined,
      envAllowlist: this.guardrails?.envScrub ? this.guardrails.envAllowlist : undefined,
      // A bridged Auto model: the upstream's own cost comes back under this tag (classify.mjs).
      bridgeTag: `auto-classify:${this.pipeline?.id || 'run'}:${round}`,
    };
    const startedAt = new Date().toISOString();
    let classified = null;
    let assembled;
    try {
      classified = await classify(input);
      try {
        assembled = assembleShape(classified.shape, { registry, humanInLoop: this.humanInLoop });
      } catch (err) {
        // A REPLAYED shape (B4/B6 resume) gets no second round here: `classify` is then the replay
        // stub, which would only hand the same stale shape back. Let the ShapeError escape to
        // _decideTopologyInner, which drops the pending proposal and classifies afresh.
        if (!(err instanceof ShapeError) || classified.replayed) throw err;
        // ONE more classifier round with the assembler's issues as feedback (spec §5.3);
        // a second ShapeError propagates and pauses the run.
        const note = `The previous shape could not be assembled: ${err.issues.map((i) => i.message).join('; ')}. Fix it and reply with the full shape.`;
        const again = await classify({ ...input, feedback: [...input.feedback, note], priorShape: classified.shape });
        again.costUsd = (Number(again.costUsd) || 0) + (Number(classified.costUsd) || 0);
        again.usage = sumUsage(classified.usage, again.usage);
        classified = again;
        assembled = assembleShape(classified.shape, { registry, humanInLoop: this.humanInLoop });
      }
    } catch (err) {
      // A FAILED round still spent money (two billed replies behind CLASSIFIER_FAILED, a
      // partial reply behind a timeout, the first shape behind a failed assembler retry):
      // book it before the shell parks the run, or the caps never see it (D14). No cap
      // check here — the error pause is happening anyway; the next round checks.
      const spent = (Number(classified?.costUsd) || 0) + (Number(err?.costUsd) || 0);
      // A round a pause or stop cut short is booked as `stopped`, never as a finished call.
      if (spent > 0 || err?.usage) this._recordAutoCost(round, { costUsd: spent, usage: sumUsage(classified?.usage, err?.usage) }, startedAt, model,
        // A pause during the 429 backoff rethrows the earlier attempt's ClassifierError: the signal says it was cut.
        { checkCaps: false, status: err?.name === 'AbortError' || input.signal?.aborted ? 'stopped' : 'finished' });
      throw err;
    }
    // B4: keep this round's shape (and the classifier's warnings) from here on — a cost cap raised
    // by _recordAutoCost below, or a pause while the proposal is open, resumes into it instead of
    // paying for a new classification. Set BEFORE the cost row: the cap check lives inside it.
    this._auto.pending = { round, shape: jsonClone(assembled.shape), warnings: [...(classified.warnings || [])] };
    if (!classified.replayed) this._recordAutoCost(round, classified, startedAt, model);
    const match = findEquivalentWorkflow(assembled.template, await autoCandidates());
    let template = assembled.template;
    let tunables = assembled.tunables;
    let ignoredProjectOverrides = false;
    if (match) {
      tunables = remapTunables(tunables, match.nodeMap);
      template = match.candidate;
      // D7: Auto owns the tuning — a reused row's per-project node/wire overrides are
      // NOT applied; the proposal says so, so the user is not surprised.
      const rc = await resolveRunConfig(this.projectDir, match.candidate.id);
      ignoredProjectOverrides = Object.keys(rc?.nodes || {}).length > 0 || Object.keys(rc?.wires || {}).length > 0;
      // With human-in-the-loop OFF there is no proposal to say it (PR #434 review, finding 5):
      // the run log is then the only place the user can learn why the run used models they
      // never picked, so say it here regardless of the switch.
      if (ignoredProjectOverrides) {
        this._log('orchestrator', 'warn', `auto: this project's saved per-node/wire settings for "${match.candidate.name}" (${match.candidate.id}) are not applied — Auto owns the tuning`);
      }
    }
    const proposal = buildProposal({
      round, shape: assembled.shape, template,
      match: match ? { id: match.candidate.id, name: match.candidate.name } : null,
      tunables, registry, models,
      warnings: [...(classified.warnings || []), ...assembled.warnings],
      costUsd: this._auto.costUsd, fingerprint, ignoredProjectOverrides,
      isWorkspace: this.isWorkspace, members: this.isWorkspace ? this.members.map((m) => m.projectName || m.projectKey) : [],
    });
    this._log('orchestrator', 'info',
      `auto: round ${round} proposed "${proposal.name}" (${Object.keys(proposal.nodes).length} agents) — ${match ? `same shape as saved workflow "${match.candidate.name}" (${match.candidate.id})` : 'no saved workflow has this shape; Accept saves a new one'}`);
    return { proposal, template, match, tunables, shape: assembled.shape };
  }

  /** The classifier's view of a workspace run: members + where each checkout is readable (A5).
   *  A resume decides BEFORE _replaySetup re-creates missing checkouts, so a member may have none
   *  yet (checkout null). The detached layout is fixed (./repos/<dir name>, as _setupRunRoot creates
   *  it: the projectKey, shortened when it would overflow, #411) — never derived from runCwd, whose
   *  path is not realpath'd like the checkouts are. */
  _autoWorkspaceInput() {
    if (!this.isWorkspace) return { workspace: null, addDirs: [] };
    const primaryKey = this.members[0].projectKey;
    const detached = this.runRootMode === 'detached';
    const workDirs = this.workDirs || new Map();
    const addDirs = [];
    const members = this.members.map((m) => {
      const dir = workDirs.get(m.projectKey) || null;
      let checkout = null;
      if (this.runCwd && dir) {
        if (detached) checkout = `./repos/${basename(dir)}`;
        else if (m.projectKey === primaryKey) checkout = '.';             // legacy: runCwd IS the primary's worktree
        else { checkout = dir; addDirs.push(dir); }                       // legacy: --add-dir per other member
      }
      return { projectKey: m.projectKey, projectName: m.projectName, checkout };
    });
    return { workspace: { name: this.workspace.name, members }, addDirs };
  }

  /** Ask the proposal ONCE; the validator keeps the question OPEN on a malformed
   *  answer (spec §5.4) and the awaiting code receives the sanitised payload. */
  async _autoAsk(proposal, models, registry) {
    const validate = (raw) => sanitizeProposalAnswer(raw, { proposal, models, registry });
    const raw = await this._ask({ id: `auto-${proposal.round}`, kind: 'workflow', workflow: proposal, validate });
    return raw && raw.decision ? raw : validate(raw);   // auto mode answers { decision: 'accept' } without the validator
  }

  /** Reuse the twin or save a new row, resolve it with the accepted tunables as the ONLY overlay, re-stamp the manifest.
   *  `fallback` = the classifier failure a default-workflow fallback adopts in place of a proposal (_autoFallbackDefault). */
  async _autoAdopt({ template, match, tunables, shape, answer, registry, round, fallback = null }) {
    const name = answer.name || shape.name;
    if (!match) {
      // B3: the twin search ran at proposal time; another Auto run, the composer or the chat may
      // have saved this exact topology while the proposal was open. Reuse it now rather than
      // write a duplicate — remapping the classifier's tunables AND the user's table edits
      // (both keyed by the assembled node ids) onto the twin's node ids.
      const late = findEquivalentWorkflow(template, await autoCandidates());
      if (late) {
        this._log('orchestrator', 'info', `auto: saved workflow "${late.candidate.name}" (${late.candidate.id}) appeared while the proposal was open — reusing it`);
        match = late;
        tunables = remapTunables(tunables, late.nodeMap);
        answer = { ...answer, nodes: remapTunables(answer.nodes || {}, late.nodeMap) };
        template = late.candidate;
      }
    }
    let workflowId;
    let via;
    if (match) {
      workflowId = match.candidate.id;
      via = 'reused';
    } else {
      workflowId = await mintAutoWorkflowId(name, async (id) => !!(await readWorkflow(id, { includeArchived: true })));
      await writeGraphWorkflow({ ...template, id: workflowId, name, domain: 'coding', origin: 'auto' });
      via = 'created';
    }
    const overlayNodes = {};
    for (const [nodeId, sel] of Object.entries(tunables || {})) overlayNodes[nodeId] = { ...sel };
    for (const [nodeId, sel] of Object.entries(answer.nodes || {})) overlayNodes[nodeId] = { ...(overlayNodes[nodeId] || {}), ...sel };
    // I2: run exactly the graph the twin was matched on. autoCandidates offers a versioned row as its version in use
    // (runnableOf); pinning that number keeps the node ids the tunables were remapped onto, even if Use moved meanwhile.
    const use = match && Number.isInteger(match.candidate.versionNo) ? match.candidate.versionNo : 'live';
    const resolved = await resolveGraph(this.projectDir, workflowId, registry, this.agentsDir, {
      use, engine: this.claude.engine || 'claude', runModel: this.claude.model || null, isWorkspace: this.isWorkspace, overlay: { nodes: overlayNodes }, ignoreProjectOverrides: true, scripts: this.scriptRegistry,
      claudeAuth: this._autoAuthState && this._resolveClaudeAuth() ? async () => ({ state: this._autoAuthState }) : this._resolveClaudeAuth(),
    });
    if (!this.humanInLoop) {
      // spec D3: no agent may stop the run to ask (generic — every agent node).
      for (const nc of Object.values(resolved.nodes)) if (nc.kind === 'agent') nc.askQuestions = false;
    }
    this.workflowId = workflowId;
    this._adoptResolvedGraph(resolved);
    // Auto picks runnable models itself and skips the user slots, so it has no user-set model to refuse
    // (signInBlocked is ignored); a dropped factory default is still said once.
    await this._noteFactoryFallbacks(resolved.factoryNotes);
    const manifest = buildGraphManifest(this.resolved.template, this.resolved.agentsByKey, {
      overlays: { nodes: this.resolved.nodeCtx, wires: this.resolved.wires }, scripts: this.resolved.scriptsByKey,
    });
    // A fallback records what it saved (`saved`) and why (`reason`) beside via 'fallback'.
    manifest.auto = fallback
      ? { status: 'decided', via: 'fallback', saved: via, reason: fallback, rounds: round, humanInLoop: this.humanInLoop, workflowId }
      : { status: 'decided', via, rounds: round, humanInLoop: this.humanInLoop, workflowId };
    // D8: the named version this run used, as the non-Auto path records it (_buildManifest).
    if (Number.isInteger(resolved.versionNo)) manifest.workflowVersion = { no: resolved.versionNo };
    this._preflightAgentKeys(this.resolved.agentKeys);
    this._preflightScriptKeys(this.resolved.scriptKeys);
    await this._preflightScriptRuntimes();
    await this._preflightMediaTools();
    this.state.stepper = manifest;
    // PR #434 review, finding 3: the pending proposal is kept until HERE. A throw before the
    // workflowId swap above (mintAutoWorkflowId, writeGraphWorkflow, resolveGraph) unwinds
    // through _decideTopology's catch, which rebuilds the point WITH it, so the resume replays
    // the same proposal for free instead of paying a second classifier round. (The answer
    // itself is not persisted: with a proposal open the user answers the replay again. That
    // catch is gated on workflowId === AUTO_WORKFLOW_ID: a throw after the swap leaves the
    // point as it was — the B6 stamp when a proposal was open, none otherwise — and the steps
    // between are bookkeeping over the graph resolveGraph just resolved.)
    this._auto.pending = null;
    this.state.resumePoint = null;                  // decided: the engine's onSnapshot owns the point from here
    this._emit('state', this.getState());
    await this._persist();
    if (fallback) {
      await appendAudit(this.pipeline.dir, `Auto workflow: the classifier was unreachable (${fallback}) — running the default workflow **${name}** (${via === 'reused' ? `saved workflow ${workflowId}` : `saved as ${workflowId}`}).`).catch(() => {});
    } else {
      this._log('orchestrator', 'info', `auto: accepted → "${name}" (${workflowId}, ${via})`);
      await appendAudit(this.pipeline.dir, `Auto workflow: **${name}** — ${via === 'reused' ? `reusing saved workflow ${workflowId}` : `saved as ${workflowId}`}.`).catch(() => {});
    }
    return { manifest, agentKeys: new Set(this.resolved.agentKeys), workflow: { id: workflowId, name: this.resolved.template.name || name } };
  }

  /**
   * The Auto classifier call with the shared recovery backoff (recovery-backoff.mjs):
   * a rate_limit / network failure — a provider 429 the CLI already retried, a dropped
   * connection — is retried before the round gives up. What the failed attempts spent
   * rides the result (or the final error), so the round books it once (D14).
   */
  async _classifyWithRetry(classify, input) {
    let spent = 0;
    try {
      const res = await withRecoveryRetry(() => classify(input), {
        signal: input.signal,
        onRetry: ({ attempt, cls, delayMs, err }) => {
          spent += Number(err?.costUsd) || 0;
          this._log('orchestrator', 'warn',
            `auto: classifier ${cls} — retrying in ${Math.round(delayMs / 100) / 10}s (retry ${attempt}/${HELPER_RETRY_ATTEMPTS}): ${firstLine(err?.detail || err?.message)}`);
        },
      });
      if (spent) res.costUsd = (Number(res.costUsd) || 0) + spent;
      return res;
    } catch (err) {
      if (spent && err && typeof err === 'object') err.costUsd = (Number(err.costUsd) || 0) + spent;
      throw err;
    }
  }

  /** The classifier stayed unreachable (a transient class after its retries): run the
   *  default workflow — adopted like an accepted proposal, so it is saying why in the run
   *  log, the audit and the manifest (auto.via 'fallback') — instead of parking a run
   *  that has not started. With a human in the loop that is the standard recipe, whose
   *  exact twin is the built-in Default (wf_default); with nobody in the loop it is the
   *  same recipe without Clarify, because spec D3 forbids stopping the run to ask. */
  async _autoFallbackDefault({ err, registry, round, nodeModel = null }) {
    const cause = firstLine(err?.detail || err?.message);
    const cls = classifyError(err);
    const recipe = RECIPE_SHAPES.find((r) => r.id === (this.humanInLoop ? 'prompt' : 'plan-partial'));
    const assembled = assembleShape(normalizeShape(jsonClone(recipe.shape)), { registry, humanInLoop: this.humanInLoop });
    // Signed out (auto/runnable.mjs), the recipe's nodes have no model to fall back to: run
    // every one on the model Auto itself runs on — routed by construction.
    if (nodeModel) {
      for (const n of assembled.template.nodes || []) {
        if (n.kind === 'agent') assembled.tunables[n.id] = { ...(assembled.tunables[n.id] || {}), model: nodeModel, effort: '' };
      }
    }
    const match = findEquivalentWorkflow(assembled.template, await autoCandidates());
    this._log('orchestrator', 'warn',
      `auto: the workflow classifier failed (${cls}) after ${HELPER_RETRY_ATTEMPTS} retries — running the default workflow "${match ? match.candidate.name : assembled.shape.name}" instead: ${cause}`);
    return this._autoAdopt({
      template: match ? match.candidate : assembled.template, match,
      tunables: match ? remapTunables(assembled.tunables, match.nodeMap) : assembled.tunables,
      shape: assembled.shape, answer: { decision: 'accept', name: assembled.shape.name, nodes: {} },
      registry, round, fallback: `${cls}: ${cause}`,
    });
  }

  /** Attached files as the classifier sees them: names, plus the first 2 KB of text files. */
  async _autoExtras() {
    const out = [];
    for (const f of await this._collectExtras()) {
      const ext = extname(f.name).toLowerCase();
      let text;
      if (['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.toml'].includes(ext)) {
        text = await readFile(f.path, 'utf8').then((t) => t.slice(0, 2048)).catch(() => undefined);
      }
      out.push(text !== undefined ? { name: f.name, text } : { name: f.name });
    }
    return out;
  }

  /** Cost of one classifier round: a sub-agent row (state list + table + delta) + the preflight ledger + the caps (spec §5.7).
   *  `checkCaps: false` books the spend of a round that FAILED without raising a cost pause on top of the error pause. */
  _recordAutoCost(round, classified, startedAt, model, { checkCaps = true, status = 'finished' } = {}) {
    const costUsd = Number.isFinite(Number(classified?.costUsd)) ? Number(classified.costUsd) : 0;
    const usage = classified?.usage || {};
    this._auto.costUsd = Math.round((this._auto.costUsd + costUsd) * 1e6) / 1e6;
    const rec = {
      id: `auto-classify-${round}`, label: `Auto workflow (round ${round})`, status,
      startedAt, finishedAt: new Date().toISOString(), costUsd,
      tokens: (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0),
      subagentType: 'auto-classify', uiPhase: 'preflight', nodeId: 'preflight', stepKey: 'x:preflight:1',
      runModel: model || null,
    };
    // The pattern every sub-agent record follows (run-harness.mjs:3392-3394): the state
    // list + the table + a delta, so the Running view and the CLI pill see the row
    // without a reload; History reads the table. _subAgentTransition is a pure
    // emitter (its first argument is the transition: 'spawn' | 'finish' | 'update');
    // the row is born finished, so both deltas go out back to back and any consumer
    // that balances spawns against finishes stays balanced.
    if (!this.state.subAgents.some((s) => s.id === rec.id)) this.state.subAgents.push(rec);
    this._upsertSubAgent(rec);
    this._subAgentTransition('spawn', rec);
    this._subAgentTransition('finish', rec);
    // The preflight ledger row exists because _bookend('preflight','start') ran in
    // run() (and resume() rehydrates state.steps before the hook). _recordCost only
    // attributes a cost whose stepKey names a ledger row (state.steps + totalCostUsd —
    // no else branch; the DB spend ledger is written regardless), and
    // _checkCostLimits reads that total: without the row the pipeline cap could never trip.
    this._recordCost(costUsd, 'x:preflight:1', { aux: 'auto' });
    if (checkCaps) this._checkCostLimits();   // a cost cap pauses here (_capReached → pauseErr()); the resume re-enters the decision
  }

  /**
   * Adopt a resolveGraph result (P2 contract: { template, ports, loops, nodes,
   * wires, agentsByKey, agentKeys, scriptsByKey, scriptKeys }). The resolver has ALREADY applied the
   * workspace substitution AND the workspaceFanOut forcing (spec §5.10 — a META
   * flag, never a key set) and classified the loops ONCE. This class names the
   * per-node table `nodeCtx`; nothing is re-derived and no template node is
   * mutated here.
   */
  _adoptResolvedGraph(resolved) {
    this.resolved = { ...resolved, nodeCtx: resolved.nodes };
  }

  /** The sign-in seam resolveGraph probes with: an injected `claudeAuth` always; the real probe only off mock, so a mock
   *  run (tools/test.mjs never sets WORCA_MOCK) never spawns `claude auth status`. */
  _resolveClaudeAuth() {
    return this._claudeAuthInjected || !this.claude.mock ? this._claudeAuth : undefined;
  }

  /** Model id → catalog label, for the factory warnings and the sign-in refusal. */
  async _modelLabels() {
    return Object.fromEntries((await listModels(this.projectDir)).map((m) => [m.id, m.label || m.id]));
  }

  /** One warning per factory default resolveGraph dropped (factory-models.mjs), logged and audited once and kept with
   *  the pick-drop warnings, so the resume point carries them and a resume never logs them again. */
  async _noteFactoryFallbacks(notes) {
    if (!notes?.length) return;
    const lines = factoryFallbackLines(notes, await this._modelLabels());
    this._pickWarnings = [...(this._pickWarnings || []), ...lines];
    this.state.warnings = [...new Set([...lines, ...(this.state.warnings || [])])];
    for (const line of lines) {
      this._log('orchestrator', 'warn', line);
      this._pendingAudits.push(`${line}.`);
    }
  }

  /** The run warnings for the picks this run's engine dropped (role-slots pickDropWarnings), kept in `_pickWarnings`
   *  and put in front of `state.warnings`. A built-in workflow's own template defaults are recorded, never warned.
   *  A resume passes the lines its point saved: the drops were judged on the engine the run started on, and a resume
   *  may switch engine, so they are never reformatted for the new one.
   *  @param {string[]} [saved] the resume point's lines
   *  @returns {string[]} the lines */
  _notePickDrops(saved) {
    this._pickWarnings = saved ?? pickDropWarnings(this.resolved.nodeCtx, {
      engine: this.claude.engine || 'claude', quietTemplate: isReservedWorkflowId(this.workflowId), roleLabel: declaredRoleLabel,
    });
    this.state.warnings = [...new Set([...this._pickWarnings, ...(this.state.warnings || [])])];
    return this._pickWarnings;
  }

  /**
   * The template the SCHEDULER runs: the resolved template with every loop wire's
   * EFFECTIVE budget folded into `wire.config.maxCycles`. The scheduler reads
   * budgets from the template's wire config only (scheduler.mjs:148-152), so an
   * overlay from config_workflow_wires would be silently ignored without this.
   * The manifest (above) carries the same effective values, so Running, the
   * resume point and the engine agree.
   */
  _schedulerTemplate() {
    const tpl = this.resolved.template;
    const budgets = this.resolved.wires || {};
    return {
      ...tpl,
      wires: (tpl.wires || []).map((w) => (budgets[w.id]
        ? { ...w, config: { ...(w.config || {}), maxCycles: budgets[w.id].maxCycles } }
        : w)),
    };
  }

  // ── hook 3: the pre-dispatch pause point ───────────────────────────────────
  /** Paused before the scheduler ever ran (preflight/worktree setup): a v2 point
   *  with a null snapshot, which resume() replays as "start from scratch". */
  _enginePrePausePoint() {
    return this._buildResumePoint(null);
  }

  /** hook: the last clean point (see run-harness.mjs). _graphSnapshot is never cleared
   *  (onSnapshot, the resume restore), and the scheduler's finish() takes one final
   *  snapshot, so after a clean 'done' this IS the all-terminal point. */
  _engineLastPoint() {
    return this._graphSnapshot ? this._buildResumePoint(this._graphSnapshot) : null;
  }

  /** hook: agent keys for a setup replay — from the frozen manifest, never the workflow row. */
  _engineAgentKeys() {
    if (this.resolved?.agentKeys) return new Set(this.resolved.agentKeys);
    const manifest = this.state.stepper;
    return manifest ? new Set(resolvedFromManifest(manifest, this.registry).agentKeys) : new Set();
  }

  /** §8.3: every script key must resolve in this run's script registry BEFORE any
   *  node executes — the mirror of the base's _preflightAgentKeys, with the same
   *  disabled-plugin hint. resolveGraph already refuses an unknown key on a fresh
   *  run; this is what catches a plugin withdrawn while the run sat paused. */
  _preflightScriptKeys(scriptKeys) {
    const reg = this.scriptRegistry || {};
    const missing = [];
    for (const key of new Set(scriptKeys || [])) {
      if (!key || Object.hasOwn(reg, key)) continue;
      const plugin = findDisabledPluginFor(key, 'scripts');
      missing.push(plugin
        ? `script "${key}" comes from disabled plugin "${plugin}" — enable it`
        : `script "${key}" is not installed (removed plugin?)`);
    }
    if (missing.length) {
      throw new Error(`Preflight failed: ${missing.length} workflow script key(s) do not resolve:\n` + missing.map((m) => `  - ${m}`).join('\n'));
    }
  }

  /**
   * Workbench spec §7: a `python` card needs an interpreter on THIS host. That is
   * a run-time fact — the probe is async and the registry loader is not — so it is
   * checked HERE, beside the key preflight, before the pipeline dir exists and
   * long before the first execution, and is never baked into a registry snapshot.
   * The message is the §7 sentence itself (one line per distinct key, first-seen
   * order): for the usual single python card it is EXACTLY that sentence, which
   * the bench, the composer's V4 and the CLI all repeat word for word.
   */
  async _preflightScriptRuntimes() {
    // D13: in a mock run a card with a DECLARED mock spawns nothing (runScriptExecution returns before it
    // probes), so it needs no interpreter — the same condition, read the same way.
    const mocked = mockEnabled({ mock: this.claude?.mock });
    const keys = [];
    for (const nc of Object.values(this.resolved?.nodeCtx || {})) {
      if (nc?.kind !== 'script' || nc.runtime !== 'python' || !nc.key || keys.includes(nc.key)) continue;
      if (mocked && nc.mock && typeof nc.mock === 'object') continue;
      keys.push(nc.key);
    }
    if (!keys.length) return;
    const probe = await probePython();
    if (probe.ok) return;
    throw new Error(keys.map((key) => pythonMissingSentence(key)).join('\n'));
  }

  /**
   * Promo video spec §Preflight: a card that drives a browser or encodes video (promoCapture,
   * promoRender) needs Chrome and ffmpeg on THIS host — checked here, beside the Python preflight and
   * by the same mock rule, so a host without them is refused with one line per missing tool and its
   * install hint instead of failing an hour into the run. `opts.mediaTools` injects the lookups (tests).
   */
  async _preflightMediaTools() {
    const lines = await mediaToolProblems(this.resolved?.nodeCtx, {
      mocked: mockEnabled({ mock: this.claude?.mock }),
      tools: this.opts?.mediaTools || null,
    });
    if (lines.length) throw new Error(lines.join('\n'));
  }

  // ── hook 2: run the graph ──────────────────────────────────────────────────
  /**
   * The scheduler owns readiness, loop budgets, gates and End; this method owns
   * the process side: the resume-time restoration (Task 6), the pre-rendered
   * task document, the executor binding, the event fan-out and the resume-v2
   * snapshot. Returns 'done' | 'paused'; only the user's STOP is re-thrown (its
   * AbortError/plain-error identity intact) so the base run()/resume() catch
   * classifies it exactly as v1 does. Every other failure pauses inside _execute
   * (errors never end a run), and a pause that lands after the End card fired
   * returns 'paused', never 'done'.
   * @param {{resume?:object|null, rehydrated?:object|null}} [o] the base passes
   *   `{ resume: rp, rehydrated }` on a resume and `{ resume: null }` on a fresh run.
   * @returns {Promise<'done'|'paused'>}
   */
  async _engineRun({ resume = null } = {}) {
    // An Auto run that paused BEFORE deciding was re-decided by resume() (before the
    // setup replay, so the skills gate saw the adopted agents); its point holds the
    // bootstrap manifest and no snapshot, so it starts from scratch like a fresh run.
    const resuming = resume != null;
    if (resume?.manifest?.auto?.status === 'deciding') resume = null;
    if (resume) await this._restoreFromResumePoint(resume);   // Task 6 (hook-4 companion)
    // Session groups (C19): a resumed run resolves its sessions here, once its graph is back (the resume site's engine
    // gate runs before the restore); a fresh run did it beside the engine gate. Either way, once.
    if (resuming) for (const line of await this._sessionGate()) await appendAudit(this.pipeline.dir, line);
    // Shaper small runs B2 (D5, D9): the Start step, before any node runs (a fresh run, or a resume at S0).
    if (!resume || !this._resumeSnapshot) await this._careStart();
    const { ports, loops } = this.resolved;
    this.extrasFiles = await this._collectExtras();
    // The task document is pre-rendered ONCE: the Task card publishes it and
    // every entry agent binds that same file. Byte-identical to v1's seeded task
    // file (the same renderer), so the Task card's document matches what v1
    // handed its entry node.
    // A Memory defragment run appends the scope's health (run-harness.mjs _defragBrief — '' on
    // every other run, so their document stays byte-identical).
    this._taskArtifact = { text: renderPromptArtifact(this.pipeline.promptText, this.extrasFiles) + await this._defragBrief() };
    // Requirements features attached at start: nothing runs until the person agrees to every one that is not Ready.
    await this._attachedAgreementGate();
    // Session groups (Task 45): one SessionHost per session the gate resolved; the kill switch builds nothing (C36).
    this._sessions = !this._sessionsDisabled && this._sessionSpecs?.length
      ? createSessionHosts({ specs: this._sessionSpecs, decisions: this._sessionDecisions, port: this._sessionPort(),
        plainRun: (o) => (executorTesting.runClaude || runClaude)(o), restore: this._sessionRestore ?? null })
      : null;

    if (this._smallRunsMarked == null) this._smallRunsMarked = this._smallRunsMarkedNow();
    const sched = createScheduler({
      template: this._schedulerTemplate(),
      portsFn: ports,
      loops,
      execute: this._execute.bind(this),
      onEvent: (name, payload) => this._onSchedulerEvent(name, payload),
      onSnapshot: (snap) => {
        // Freeze at the last CLEAN completion once a pause is requested: the
        // executions this pause kills must stay NON-TERMINAL in the persisted
        // point so the scheduler re-invokes them on resume. A decomposition task that
        // still FINISHES while the run pauses is kept, though: its row moves into the
        // frozen point so the resume skips it (scheduler runSlice) instead of re-running it.
        if (this.pauseRequested) {
          const merged = withFinishedSlices(this._graphSnapshot, snap);
          if (merged === this._graphSnapshot) return;
          this._graphSnapshot = merged;
          this.state.resumePoint = this._buildResumePoint(merged);
          void this._persist();
          return;
        }
        this._graphSnapshot = snap;
        // Keep a resumable point on the row at all times: a crash-reconciled
        // ('interrupted') v2 run is then resumable from its last clean snapshot.
        // The base clears it on done and on stop. Persisted HERE (3.2): the step row
        // already says `done`, and waiting for the next _execStep left the point one
        // completion behind — a crash in between re-ran a finished node, and nothing
        // starts next while a gate is held.
        this.state.resumePoint = this._buildResumePoint(snap);
        void this._persist();
      },
      // P3 contract: onGate is the state.gate NOTIFIER ({wireId, fromNode, toNode,
      // askId} | null); onAsk is the ONE ask channel (gates today).
      onGate: (g) => { this.state.gate = g ? { ...g } : null; this._emit('state', this.getState()); },
      onAsk: (q) => this._schedulerAsk(q),
      // The scheduler's log is ONE-ARG (`log(QUIESCENCE_WARNING)`, scheduler.mjs:936).
      log: (line, attrs = null) => this._log('orchestrator', 'warn', String(line), attrs),
      onSliceSkip: ({ nodeId, taskId, title, executionId }) => {
        const line = `${nodeId}: task "${title || taskId}" already finished in the earlier attempt — not run again.`;
        this._log('orchestrator', 'info', line, { nodeId, executionId });
        void appendAudit(this.pipeline.dir, line).catch(() => {});
      },
      sliceWorkKept: (row) => this._sliceWorkKept(row),
      // Shape it first (spec D2/D12): node approval stops are armed only for a run that carries `shape`.
      // Small runs C5 (D15): the Verifier's run has no plan to approve.
      approvalStops: Boolean(this.runShape) && !this.runShape.verify,
      // 4.1: a failure or stop waits for siblings to take their SIGTERM→SIGKILL before teardown.
      settleGraceMs: sigkillGraceMs() + 2000,
    });
    this._scheduler = sched;
    if (resume && this._resumeSnapshot) {
      this._graphSnapshot = this._resumeSnapshot;
      sched.reattach(this._resumeSnapshot);
    }

    let outcome;
    let runErr = null;
    try {
      outcome = await sched.run();
    } catch (err) {
      runErr = err;
      throw err;
    } finally {
      this._scheduler = null;
      this.state.active = [];
      this._syncSchedulerState(sched);
      // After the scheduler returned (on Stop or a failure it does not wait for running steps; close() lets a turn in
      // flight settle first) and before a pause builds its resume point, so the snapshot already says 'paused'.
      if (this._sessions) await this._closeSessions(outcome, runErr);
      // C36 + C9 (Task 47): the kill switch's counterpart of close(): the held cuts ride on in this run's points, and only a
      // run that ends un-paused books them.
      else if (this._sessionsDisabled && this._sessionRestore && this._sessionOutcome(outcome, runErr) !== 'paused') this._bookHeldCuts();
    }

    if (outcome === 'error') {
      // The first genuine failure keeps its identity (AbortError on stop, the
      // agent's error otherwise). A scheduler abort with nothing recorded yet is a stop.
      throw this._graphError || (this.abort.signal.aborted ? abortError('stopped') : new Error('a graph execution failed'));
    }
    if (outcome === 'done' && this.pauseRequested) {
      // D17: the scheduler resolves `ended` BEFORE it looks at pauseRequested
      // (scheduler.mjs:1033-1034), so a pause that landed on a straggler after the
      // End card fired — an error-pause, or the user's — came back as 'done'. It is
      // a pause: the point was frozen by onSnapshot the moment pause() ran (the
      // straggler's row is still non-terminal in it), reattach() re-invokes that
      // row on resume and the restored `ended` then quiesces the run to done.
      this.state.resumePoint = this._buildResumePoint(this._graphSnapshot);
      return 'paused';
    }
    if (outcome === 'paused') {
      this.state.resumePoint = this._buildResumePoint(this._graphSnapshot);
      return 'paused';
    }
    if (!this.state.endReached && this.pipeline) {
      // state.warnings + the run log already carry the scheduler's text (log +
      // _syncSchedulerState); this is the audit trail for it.
      await appendAudit(this.pipeline.dir, `Run **${QUIESCENCE_WARNING}**.`).catch(() => {});
    }
    return 'done';
  }

  /** Session groups (Task 47; C36, C9): under the kill switch no host carries a held cut, so a run that ends un-paused books
   *  each one as an estimate on its own row (on the engine it was spent on). A paused run keeps them in its points instead: a
   *  later resume with sessions on resumes the host whose cumulative holds them, and its next Δ carries them. The snapshots
   *  without the cuts reach the point before the bookings persist the rows, so the two never disagree (the crash seam).
   *  Writes no trace and builds no host; never throws (it runs in _engineRun's `finally`). */
  _bookHeldCuts() {
    const held = [];
    const out = {};
    for (const [sid, S] of Object.entries(this._sessionRestore)) {
      const c = S && typeof S === 'object' && S.openCut && typeof S.openCut === 'object' ? S.openCut : null;
      for (const p of c ? (Array.isArray(c.parts) ? c.parts : [c]) : []) {
        if (!p || typeof p !== 'object' || !Number.isFinite(p.cutUsd)) continue;
        held.push({ sid, hostEpoch: S.hostEpoch ?? null, hostSessionId: S.hostSessionId ?? null, turnId: p.turnId ?? null,
          dispatchId: p.dispatchId ?? null, stepKey: p.executionId, nodeId: p.nodeId ?? null, cutEstimateUsd: p.cutUsd, cutEngine: S.engine ?? null });
      }
      out[sid] = c ? { ...S, openCut: null } : S;
    }
    this._sessionRestore = out;
    if (this.state.resumePoint) this.state.resumePoint = { ...this.state.resumePoint, sessionHosts: out };
    for (const b of held) {
      try { this._bookSessionTurn(b); } catch (err) {
        this._log('orchestrator', 'warn', `session ${b.sid}: booking ${b.turnId} failed: ${err?.message || err}`, { session: b.sid });
      }
    }
  }

  /** Session groups (Task 45): close every SessionHost once, with how the run ended. */
  async _closeSessions(outcome, err = null) {
    await this._sessions.close(this._sessionOutcome(outcome, err));
    // _pauseForFailure reuses the last snapshot point: it must carry the hosts as they closed (Task 46).
    if (this.state.resumePoint) this.state.resumePoint = { ...this.state.resumePoint, sessionHosts: this._sessions.snapshot() };
  }

  /** How the run ended, for its SessionHosts' close (Task 45). A requested pause is 'paused' even when the scheduler said
   *  'done' (D17); Stop is 'stopped'; only a terminal failure is 'error': any other failure is 'paused' too, because the
   *  base catch ends that run paused (_pauseForFailure), and its held cut must wait for the resumed turn (C9). */
  _sessionOutcome(outcome, err = null) {
    if (this.abort.signal.aborted) return 'stopped';
    if (outcome === 'paused' || this.pauseRequested) return 'paused';
    if (outcome === 'done') return 'done';
    return isTerminal(err || this._graphError) ? 'error' : 'paused';
  }

  /** Stamp the CURRENT decision state on the row as the setup-incomplete point every Auto
   *  pause produces (run-harness.mjs _completePaused): a hard kill after this persist
   *  reconciles to a RESUMABLE row that resumes into exactly this state. Used while a
   *  proposal is open (B6) and right after a revise answer (PR #434 review, finding 2). */
  async _stampDecisionPoint() {
    const rp = this._buildResumePoint(null);
    rp.setupIncomplete = true;
    rp.titleProvisional = this.state.titleProvisional === true;
    this.state.resumePoint = rp;
    await this._persist();
  }

  /**
   * The agreement gate for attached Requirements features (any workflow): while any is neither Ready nor agreed, ask
   * once, before the scheduler exists, and wait. The open ask rides the resume point, so a restart raises it again; an
   * approve stores the agreements and re-stamps the point. A run without attached features returns at once.
   */
  async _attachedAgreementGate() {
    if (!pendingAgreement(this.attachedRequirements).length) return;
    const stamp = async () => {
      this.state.resumePoint = this._buildResumePoint(this._graphSnapshot ?? null);
      await this._persist();
    };
    await stamp();
    const id = 'plan-attached-agreement';
    const features = this.attachedRequirements.map((f) => ({
      seq: f.seq, id: f.id, title: f.title, criteriaCount: f.criteriaCount ?? null,
      markdown: typeof f.markdown === 'string' ? f.markdown : '', agreed: f.ready === true || f.agreed === true,
    }));
    const payload = await this._enqueueAsk(() => this._ask({
      id, kind: PLAN_ASK_KIND,
      plan: { attached: { features }, revisable: false },
      validate: (raw) => {
        const out = validateAgreement(this.attachedRequirements, raw);
        if (!out.ok) return out;
        return { ok: true, payload: raw.decision === 'stop' ? { decision: 'stop' } : { decision: 'approve', agreedSeqs: [...raw.agreedSeqs] } };
      },
    }));
    this._checkAbort();
    const d = payload?.decision;
    if (d === 'stop') { this.stop(this.answeredBy(id)); this._checkAbort(); return; }
    if (d === 'approve') this.attachedRequirements = applyAgreement(this.attachedRequirements, payload.agreedSeqs);
    // Fail closed: the scheduler never starts while a feature is still unagreed, whatever the answer was.
    if (pendingAgreement(this.attachedRequirements).length) throw new Error('attached requirements were not agreed');
    await stamp();
  }

  /**
   * Serialize the run position into a JSON-safe resume-v2 point. The scheduler
   * snapshot IS the position; the manifest freezes the topology (resume never
   * re-reads the workflow row); everything else is the run identity a fresh
   * instance cannot rebuild from the pipelines row alone.
   */
  _buildResumePoint(snapshot) {
    return {
      version: 2,
      snapshot: snapshot ? jsonClone(snapshot) : null,
      manifest: this.state.stepper ? jsonClone(this.state.stepper) : null,
      // Observability + the resume audit line; the AUTHORITATIVE session map is
      // rebuilt from the persisted step rows (readPipelineForResume). The LEDGER
      // is the source here too, not the snapshot: the frozen snapshot is the last
      // CLEAN one, taken at a completion, so an execution the pause killed may not
      // be in it at all (it started after that completion), and the scheduler's
      // paused rows carry no sessionId (a paused execute returns { paused: true })
      // while the row does (_onAgentEvent stamps it).
      nodes: this.state.steps.filter((s) => s.executionId).map((s) => ({
        nodeId: s.nodeId,
        executionId: s.executionId,
        sessionId: s.sessionId ?? null,
        completed: s.status === 'done',
      })),
      planVersion: this._planVersion,
      ...(this._planRevise ? { planRevise: { ...this._planRevise } } : {}),
      ...(this._smallRunsMarked ? { smallRunsMarked: true } : {}),
      ...(this._stopAnswer ? { stopAnswer: jsonClone(this._stopAnswer) } : {}),
      ...(this._protoAnswer ? { protoAnswer: jsonClone(this._protoAnswer) } : {}),
      ...(this._planConcernAnswer ? { planConcernAnswer: { ...this._planConcernAnswer } } : {}),
      ...(this._planAwayApproved ? { planAwayApproved: { ...this._planAwayApproved } } : {}),
      ...(Object.keys(this._planConcernSeen).length ? { planConcernSeen: { ...this._planConcernSeen } } : {}),
      ...(this._planConcernHeld ? { planConcernHeld: jsonClone(this._planConcernHeld) } : {}),
      ...(this.state.roleReviews ? { roleReviews: jsonClone(this.state.roleReviews) } : {}),
      ...(this._slicingDone ? { slicingDone: true } : {}),
      ...(this._outlineRevise ? { outlineRevise: this._outlineRevise } : {}),
      ...(this._pickWarnings?.length ? { pickWarnings: [...this._pickWarnings] } : {}),
      // money-saved §3.1: the cursor at the last completed terminal (paused executions never
      // advance it), so a resume credits the paused execution's pre-pause work at its terminal.
      humanCursor: this._humanCursorReady ? (this._humanCursor ?? { files: 0, insertions: 0, deletions: 0 }) : null,
      stepModels: this.stepModels,
      // The run-level choices the harness constructor restores: the model the run was
      // started with, and an engine other than Claude with the consent to run it
      // unguarded. Only the fields that are set and differ from the default, so a
      // Claude run's point is unchanged and an older reader sees none.
      ...this._resumePointClaude(),
      // A run started as mock (a per-request `mock: true`) resumes as mock (the harness constructor).
      ...(this.claude.mock ? { mock: true } : {}),
      // Where the run executes (e2b only; a local point gains no key). Before the sandbox exists (a pause in
      // setup or in the capacity queue) the kind alone, so the run never resumes as local. A resumed run that
      // pauses again before it reconnected keeps the saved record (its parked sandbox).
      ...(this.execEnv ? { execEnv: this.execEnv.resumeRecord() }
        : this._savedExecEnv ? { execEnv: this._savedExecEnv }
        : this.execEnvKind && this.execEnvKind !== 'local' ? { execEnv: { kind: this.execEnvKind } } : {}),
      workflowId: this.workflowId,
      // Auto workflow: the decision state while UNDECIDED (spec §5.6); null once
      // the graph is adopted (workflowId is then the real id) and on saved workflows.
      auto: this.workflowId === AUTO_WORKFLOW_ID
        ? {
          humanInLoop: this.humanInLoop, feedback: [...this._auto.feedback], round: this._auto.round,
          prior: this._auto.prior ? jsonClone(this._auto.prior) : null,
          costUsd: this._auto.costUsd,                                                   // B5
          pending: this._auto.pending ? jsonClone(this._auto.pending) : null,            // B4/B6
        }
        : null,
      // Night mode: the run's own switches (the start opt-in and the run-view override),
      // read back by the harness constructor. `auto` above is the Auto-workflow state.
      night: { optIn: this._night.optIn, override: this._night.override, ...(this._night.since != null ? { since: this._night.since } : {}), ...(this._night.owner ? { owner: this._night.owner } : {}) },
      guardrailsId: this.guardrailsId,
      ...(this.mcpOptOut?.length ? { mcpOptOut: [...this.mcpOptOut] } : {}),   // MCP registry §6.2: resume re-resolves minus it
      memoryScope: this.memoryScope || null,   // agent memory §7.3: a paused defrag resumes with ONE scope (B10)
      ...(this.memoryOff ? { noMemory: true } : {}),   // #943: a run started without memory resumes without it
      ...(this.runShape ? { shape: this.runShape } : {}),
      ...(this.attachedRequirements.length ? { attachedRequirements: this.attachedRequirements.map((f) => ({ ...f })) } : {}),
      ...(this.state.shaping ? { shaping: jsonClone(this.state.shaping) } : {}),
      checkpointRef: this.checkpointRef || null,
      checkpointRefs: { ...this.checkpointRefs },
      workspace: this.isWorkspace ? { projects: this._workspaceProjects() } : null,
      pauseReason: this.pauseReason || null,
      pauseDetail: this.pauseDetail || null,
      // Written only when set (smoke DB identity): the class behind a recoverable pause,
      // the current network outage, and --yes — the server's network watch reads all three.
      ...(this.pauseClass ? { pauseClass: this.pauseClass } : {}),
      ...(this._net ? { network: { ...this._net } } : {}),
      ...(this.auto ? { runAuto: true } : {}),
      ...(this.limitEngine ? { limitEngine: this.limitEngine } : {}),
      // #1450: the model a 'model_confirm' pause waits on, a usage limit's model and scope, and the run's confirmations.
      ...(this.modelConfirm ? { modelConfirm: { ...this.modelConfirm } } : {}),
      ...(this.limitModel ? { limitModel: this.limitModel } : {}),
      ...(this.limitScope ? { limitScope: this.limitScope } : {}),
      ...(this._confirmedModels?.length ? { confirmedModels: [...this._confirmedModels] } : {}),
      // The EFFECTIVE instruction at dispatch time (post in-worktree graph
      // build), not the detect-time tools.instruction.
      toolInstruction: this.toolInstruction ?? '',
      pipelineDir: this.pipeline.dir,
      pausedAt: new Date().toISOString(),
      // Session groups (C2, C28): each host's snapshot, which the resumed run's SessionHost restores (Task 47). A resumed run
      // that built no host (the kill switch) keeps the snapshots it restored, so a later run with sessions continues them.
      ...(this._sessions ? { sessionHosts: this._sessions.snapshot() } : this._sessionRestore ? { sessionHosts: this._sessionRestore } : {}),
    };
  }

  /** The resume point's `claude` blob, or nothing when every field is the default. */
  _resumePointClaude() {
    const engine = this.claude.engine && this.claude.engine !== 'claude' ? this.claude.engine : null;
    const c = {
      ...(this.claude.model ? { model: this.claude.model } : {}),
      ...(this.claude.effort ? { effort: this.claude.effort } : {}),
      ...(engine ? { engine } : {}),
      ...(engine && this._allowUnguardedEngine ? { allowUnguardedEngine: true } : {}),
      ...(this._modelForAll && this.claude.model ? { modelForAll: true } : {}),
    };
    return Object.keys(c).length ? { claude: c } : {};
  }

  /** Per-member worktree facts the v1 point kept under rp.bus.workspace. */
  _workspaceProjects() {
    return this.members.map((m) => ({
      projectKey: m.projectKey,
      projectDir: m.projectDir,
      projectName: m.projectName,
      // P5: a Folder member's copy rides copyDir — never worktreeDir (resume re-attaches it from its branches record)
      ...(this._memberWorkMode(m.projectKey) === 'folder'
        ? { copyDir: this.workDirs.get(m.projectKey) || null }
        : { worktreeDir: this.workDirs.get(m.projectKey) || null }),
      graphInstruction: this.toolInstructions.get(m.projectKey) || '',
    }));
  }

  /** Who answered a gate, for its audit line (6.3): Away mode, a named person, the --yes run, or the user. */
  _gateChooser(askId) {
    if (askId && this._stopSettled.has(askId)) return 'the agents';
    const by = askId ? this.answeredBy(askId) : null;
    if (by === NIGHT_ACTOR) return 'Away mode';
    if (by) return actorLabel(by) || 'the user';
    return this.auto ? 'the unattended run (--yes)' : 'the user';
  }

  /** Mirror the scheduler's derived counters onto state (the scheduler is the
   *  authority for deliveries/latches/gate; state is the transport). Defensive:
   *  a partially-built scheduler state degrades to the previous values. */
  _syncSchedulerState(sched = this._scheduler) {
    const s = sched ? sched.getState() : null;
    if (!s) return;
    // P3's getState(): { active, executions, tokens, wireDeliveries, ended,
    // endReached, result, warnings, gate, settled }.
    if (Array.isArray(s.active)) this.state.active = s.active.map((a) => ({ nodeId: a.nodeId, executionId: a.executionId }));
    if (s.wireDeliveries && typeof s.wireDeliveries === 'object') this.state.wireDeliveries = { ...s.wireDeliveries };
    if (Array.isArray(s.warnings)) this.state.warnings = [...new Set([...(this._pickWarnings || []), ...s.warnings])];
    if (Array.isArray(s.openIssues)) this.state.openIssues = s.openIssues.map((o) => ({ ...o }));
    if (Array.isArray(s.scopeNotices)) this.state.scopeNotices = s.scopeNotices.map((n) => ({ ...n, notable: Array.isArray(n.notable) ? n.notable.map((p) => ({ ...p })) : [] }));
    if (s.endReached === true) { this.state.endReached = true; if (s.result) this.state.result = { ...s.result }; }
    if (s.tokens) {
      const t = {};
      for (const [slot, tok] of Object.entries(s.tokens)) {
        if (!tok) continue;
        t[slot] = { seq: tok.seq, type: tok.type, path: tok.path ?? null, firedAt: tok.firedAt ?? null };
      }
      this.state.tokens = t;
    }
    // s.gate is already the §5.7 shape ({wireId, fromNode, toNode, askId} | null).
    this.state.gate = s.gate ? { ...s.gate } : null;
  }

  /**
   * Fan the scheduler's events onto the orchestrator's event surface.
   * `exec` replaces v1's `phase` (an execution, not a step) and `token` is new;
   * `gate` is audit-only — the human-facing half is the `question` the ask
   * plumbing already emits (§5.7). (Task 5 appends the derived `phase` shim.)
   */
  _onSchedulerEvent(name, payload) {
    if (name === 'token') {
      this._syncSchedulerState();
      this._emit('token', payload);
      return;
    }
    if (name === 'gate') {
      this._syncSchedulerState();
      if (payload.status === 'exhausted' && this.pipeline) {
        const n = (payload.issues || []).length;
        appendAudit(
          this.pipeline.dir,
          `Loop on wire ${payload.wireId} (${payload.nodeId}) spent after its last round: sent to approval with ${n} open issue(s).`,
        ).catch(() => {});
      } else if (payload.status !== 'held' && this.pipeline) {
        appendAudit(
          this.pipeline.dir,
          `Loop gate on wire ${payload.wireId} (${payload.nodeId}): ${this._gateChooser(payload.askId)} chose **${payload.status}**.`,
        ).catch(() => {});
      }
      return;
    }
    if (name !== 'exec') return;
    // NOTE: the `start` event lands BEFORE _execute creates the row, so `step` is
    // undefined for it (costUsd 0); every later marker finds the row.
    const step = this.state.steps.find((s) => s.key === payload.executionId);
    this._syncSchedulerState();
    // The bound End payload is exec-only, and the step row IS the durable ledger
    // — without this History has no result to anchor the End card on.
    if (step && payload.result !== undefined) step.result = payload.result;
    if (payload.status === 'done' && payload.result !== undefined) {
      this.state.result = payload.result;
      this.state.endReached = true;
      // End arrival withdraws every pending gate in the scheduler; the QUEUED
      // question is the orchestrator's to dismiss, or the run blocks on an
      // answer nobody can give any more.
      this._dismissPendingAsk();
      // The End-bound path is a first-class artifact (the History artifact route
      // in P6 serves exactly what listArtifacts() carries).
      if (payload.result?.path) {
        this._artifact('result', payload.result.path, {
          nodeId: payload.nodeId, executionId: payload.executionId, port: null, cycle: null,
        });
      }
    }
    // Session groups (Task 45): a member's events name its session; a ×N slice (kind 'task') runs outside it (D2).
    const sid = this._sessions && payload.kind !== 'task' ? this._sessions.sidOf(payload.nodeId) : null;
    this._emit('exec', {
      ...payload, costUsd: step ? (step.costUsd || 0) : 0,
      ...(step && step.runtime != null ? { runtime: step.runtime } : {}),
      ...(step && step.exitCode != null ? { exitCode: step.exitCode } : {}),
      ...(sid ? { sid, sessionMode: this._sessions.modeOf(payload.nodeId) } : {}),
    });
  }

  /**
   * The scheduler's ask channel (P3 `onAsk`). A gate ask arrives as
   * `{ id:'gate-<wireId>-<deliveryNo>[-h<holdNo>]', kind:'gate', wireId, nodeId, executionId, issues, deliveryNo, holdNo }`
   * and is answered 'another' | 'continue'. It rides the SAME serialized ask
   * queue as recovery prompts and step questions, so only ONE prompt is ever
   * open, and answers arrive through the unchanged POST /api/answer {id} path
   * (the harness's _ask resolves a gate with `{decision}`).
   *
   * A pause() or stop() while the prompt is open REJECTS the pending question
   * (run-harness.mjs:416-421, 440-444). The scheduler treats a rejected onAsk as
   * 'continue' (scheduler.mjs:676) — which would force-clean the loop and lose
   * the hold. So on pause the scheduler is halted and the promise is left
   * PENDING: run() then resolves 'paused' with the hold still in the snapshot,
   * and reattach() re-asks it on resume. On stop the scheduler is aborted.
   */
  _schedulerAsk(q) {
    if (q.kind === PLAN_ASK_KIND) return this._planAsk(q);
    // Small runs C3 (D3): a marked run's exhausted review loop is settled by the agents or becomes an objection stop.
    if (q.kind === 'gate' && this._smallRunsMarked && !this.auto) return this._gateStopAsk(q);
    // A gate takes exactly "another" or "continue" (2.1): anything else leaves the question open
    // (answer() refuses it), so a typo or a wrapper object can never continue past open issues.
    const ask = q.kind === 'gate' ? { ...q, validate: gateAnswer } : q;
    return this._enqueueAsk(() => this._ask(ask)).then(
      (payload) => {
        if (q.kind === 'gate') return gateAnswer(payload)?.decision ?? null;   // null: the scheduler fails the run
        return payload;
      },
      (err) => {
        if (isPause(err) || this.pauseRequested) this._scheduler?.pause();
        else {
          // Keep the real cause (an Away mode refusal, a lost sandbox): without it the run rethrows the generic
          // 'a graph execution failed'. A stop keeps its own path (the abort signal names it).
          if (!isAbort(err)) this._graphError ||= markTerminal(err);
          this._scheduler?.abort();
        }
        return new Promise(() => {});   // never settles: the hold survives (see above)
      },
    );
  }

  /** Small runs C3 (D7): whether this run belongs to a marked feature. Run 1 reads its own record, runs 2..N the
   *  feature's origin (never the live flag). Read once, before the scheduler starts. */
  _smallRunsMarkedNow() {
    if (!this.runShape) return false;
    const fid = this.runShape.slice?.feature;
    try { return fid ? !!smallRunsOfFeature(fid) : this._shapeRec?.smallRuns === true; } catch { return false; }
  }

  /** The run's number in its feature (run 1 = the origin run). */
  _stopRun() {
    return Number.isInteger(this.runShape?.slice?.index) ? this.runShape.slice.index : 1;
  }

  /** C3 (D3): a marked run's exhausted review loop. Minor issues only: the agents accept it (dev's `continue`) and say
   *  so; a critical, major or severity-less issue is an objection stop on dev's gate ask. */
  _gateStopAsk(q) {
    if (this._stopAnswer?.id === q.id) return Promise.resolve(gateAnswer(this._stopAnswer.payload)?.decision ?? null);
    this._stopAnswer = null;
    const stop = gateStop({ run: this._stopRun(), issues: q.issues, roleReviews: currentPass(this.state.roleReviews, { node: q.nodeId }),
      fixCycles: q.deliveryNo, nodeId: q.nodeId });
    if (!stop) {
      this._stopSettled.add(q.id);
      const line = settledLine('gate', (q.issues || []).length);
      this._log('orchestrator', 'info', `gate ${q.id}: ${line}`);
      return (this.pipeline ? appendAudit(this.pipeline.dir, line).catch(() => {}) : Promise.resolve()).then(() => 'continue');
    }
    return this._enqueueAsk(() => this._ask({ ...q, stop, validate: gateAnswer })).then(
      async (payload) => {
        await this._afterStopAnswer(q.id, stop, payload);
        return gateAnswer(payload)?.decision ?? null;
      },
      (err) => {
        if (isPause(err) || this.pauseRequested) this._scheduler?.pause();
        else this._scheduler?.abort();
        return new Promise(() => {});
      },
    );
  }

  /** C3 (D10, D14): a person answered a stop. Stash it before any await (the pause window), write the one answered
   *  line, then, unless the run stops (Change) or the answer already took in the finished work (slice 3), take
   *  in the feature's latest finished work before it goes on. */
  async _afterStopAnswer(id, stop, payload) {
    if (this.answeredBy(id) === NIGHT_ACTOR) return;
    this._stopAnswer = { id, payload };
    if (this.pipeline) await appendAudit(this.pipeline.dir, stopDoneText(stop, payload), { actor: this.answeredBy(id) }).catch(() => {});
    if (stopOptionOf(stop, payload)?.value === 'change' || this._takesInBeforeAnswerNow()) return;
    await this._takeInLatestFinished({ smallRuns: this._smallRunsMarked, onAnswer: true });
  }

  /**
   * Small runs C5 (D9, D14): after n_verify, read the Verifier's file (bounded), judge it against the owned ids, and
   * (slice 8) on any round with an open gap ask the gap stop (reason `check`, `form: 'gaps'`) on this run. Writes verify-result.json {result, headSha, decision} into the
   * run dir for the settle hook (src/core/shape/verifier.mjs). An unparseable, mis-shaped or oversized file fails the run
   * (an absent one never gets here: the executor's missing-output path pauses it first).
   */
  async _afterVerify(ctx) {
    const v = this.runShape.verify;
    const out = ctx.outputs?.verify?.path || null;
    let raw = null;
    try { if (out && (await stat(out)).size <= CHALLENGE_FILE_MAX_BYTES) raw = JSON.parse(await readFile(out, 'utf8')); } catch { raw = null; }
    let result;
    try { result = verifyResult(raw, { owned: v.owned }); }
    catch (err) {
      if (err?.code !== 'VERIFY_RESULT_MISSING') throw err;
      throw markTerminal(Object.assign(new Error('The Verifier wrote no result'), { code: 'VERIFY_RESULT_MISSING', errorClass: null }));
    }
    const ref = await this._git(['rev-parse', 'HEAD'], { cwd: ctx.projectDir });
    const headSha = ref.ok ? ref.stdout.trim() : null;
    // Slice 8 (D5): any round with an open gap asks, from round 1 on. A gap shipped earlier in the series is carried as
    // answered and never asked again; with none open the decision is written without asking.
    const shippedIds = new Set((Array.isArray(v.shipped) ? v.shipped : []).map((g) => g && g.id).filter(Boolean));
    const open = result.gaps.filter((g) => !shippedIds.has(g.id));
    let decision = null;
    if (verifyRoundPlan({ round: v.round, fixCycles: v.fixCycles, extra: v.extra, gaps: open }) === 'clean') {
      if (result.gaps.length) decision = { decision: 'answer', answers: [] };
    } else {
      const id = `verify-${v.round}-${ctx.executionId}`;
      const full = verifyStop({ gaps: open, round: v.round, fixCycles: v.fixCycles, texts: v.texts });
      const fullChecked = (raw) => { const r = verifyGateAnswer(full, raw); return r.ok ? r.answer : null; };
      // A replay after a pause passes the full stop's validator, keeping who answered each gap: a stash from before the
      // gate (another / continue) is asked again.
      const stash = this._stopAnswer?.id === id ? this._stopAnswer : null;
      const replayed = stash?.payload ? fullChecked(stash.payload) : null;
      if (replayed) {
        const by = answeredByOf(stash.payload, open);
        decision = { ...replayed, ...(Object.keys(by).length ? { answeredBy: by } : {}) };
      } else {
        // Slice 10 (D4, D10): with Away mode active when the gate opens, each plain gap is answered fix at once (no grace
        // timer); the rest are held for the person. A resumed gate reuses its stashed Away answers.
        let away = Array.isArray(stash?.away) ? stash.away : null;
        if (!away) {
          this._stopAnswer = null;
          away = this.nightMayDecideNow({ id, kind: 'gate', stop: full }) ? awayGapSplit(open).away : [];
          if (away.length) {
            this._stopAnswer = { id, away };   // before any await: the pause window
            this._nightRecord({ id, kind: 'gate' }, { choice: `fix ${away.map((a) => a.id).join(', ')}`, strategy: 'rule',
              flagged: false, rationale: 'plain gaps: one more run closes each', reversible: false });
            if (this.pipeline) {
              for (const a of away) {
                await appendAudit(this.pipeline.dir, `Verifier: Gap ${a.id} → fix · ${ANSWERED_BY_WORDS.away}`, { actor: NIGHT_ACTOR }).catch(() => {});
              }
            }
          }
        }
        const awayIds = new Set(away.map((a) => a.id));
        const held = open.filter((g) => !awayIds.has(g.id));
        if (!held.length) decision = mergeGapDecision(open, away, []);
        else {
          const stop = verifyStop({ gaps: held, round: v.round, fixCycles: v.fixCycles, texts: v.texts, decided: away });
          const checked = (raw) => { const r = verifyGateAnswer(stop, raw); return r.ok ? r.answer : null; };
          const payload = await this._enqueueAsk(() => this._ask({ id, kind: 'gate', nodeId: ctx.nodeId, executionId: ctx.executionId,
            issues: [], stop, validate: checked }));
          // Checked again: the --yes path returns {decision:'continue'} without calling validate. A refusal writes null.
          const mine = checked(payload);
          if (mine) {
            decision = mergeGapDecision(open, away, mine.answers);
            this._stopAnswer = { id, payload: decision };
            if (this.pipeline) await appendAudit(this.pipeline.dir, `Verifier: ${gapAnswerSummary(mine.answers)} · decided by you`, { actor: this.answeredBy(id) }).catch(() => {});
          }
        }
      }
    }
    await writeFile(join(this.pipeline.dir, VERIFY_RESULT_FILE), `${JSON.stringify({ result, headSha, decision }, null, 2)}\n`, 'utf8');
  }

  _planAsk(q) {
    // A revise answered just before a pause (F19): its snapshot was frozen out, so the resume re-raises the same ask.
    // Replay the saved answer before any shape check or ask. Any other id means the stash is stale.
    if (this._planRevise && this._planRevise.id === q.id) {
      const { path } = this._planRevise;
      this._planRevise = null;
      // The point can be persisted before the feedback write lands (a parallel sibling lets run() finish 'paused'
      // first, F19). If that write then failed, the file is missing: ask again instead of binding a dead path.
      return access(path).then(
        () => {
          this._log('orchestrator', 'info', `plan approval ${q.id}: revise replayed after a pause (${path})`);
          return { decision: 'revise', path };
        },
        () => this._planAsk(q),
      );
    }
    this._planRevise = null;
    // Away's approve, answered just before a pause, the same way: deciding again would store a second record, spend a
    // second answer, and could hit the limit and lose it. Kept until another id: a replay can be paused too.
    if (this._planAwayApproved?.id === q.id) {
      this._answeredBy.set(q.id, NIGHT_ACTOR);
      this._log('orchestrator', 'info', `plan approval ${q.id}: Away mode's approve replayed after a pause`);
      return Promise.resolve({ decision: 'approve' });
    }
    this._planAwayApproved = null;
    // C3 (D14): a stop answered just before a pause is replayed once, with no second answered line.
    const replay = this._stopAnswer?.id === q.id ? this._stopAnswer.payload : null;
    if (!replay) this._stopAnswer = null;
    let stop = null;
    const spec = this._approveSpec(q.nodeId);
    if (spec?.check === 'criteria') return this._criteriaAsk(q, spec);
    let check = null;
    // #990 slice 3: the last round's conflicts; the person's picks for them ride any decision, and are never required.
    const conflicts = currentPass(this.state.roleReviews)?.rounds.at(-1)?.conflicts || [];
    // Shaper requirements s3 (D4): findings naming an agreed requirement ride this ask as one concern, never a loop.
    // Derived from the saved role reviews, so a resume re-raises the same concern.
    const concern = this._changeFrom(requirementConcernOf(currentPass(this.state.roleReviews)?.rounds));
    const asked = (async () => {
      check = await this._planCheck(q.plan?.file);
      const coverage = spec?.coverage ? await this._planCoverage(q, spec.coverage) : null;
      this._shapingRound(q, check, coverage);
      const sl = this.runShape?.slice;
      const outlineChange = await this._outlineChangeText();
      // Shaper s5 (D12): notes from the chat force the stop, like outlineChange.
      const notes = (await this._shapeSliceScope())?.notes || [];
      // B4 (D1): a marked run's slice 1 follows the slice-k rule once its Split was approved.
      if (sl && (sl.index > 1 || skipsPlanAfterSplit({ smallRuns: this._shapeRec?.smallRuns === true, slice: sl,
        outlineDecided: this.state.shaping?.outline?.decided }))) {
        // Small runs C3 (D5): a marked run stops only for a requirement or a failing check; chat notes alone are settled.
        stop = this._smallRunsMarked ? planStop({ run: this._stopRun(), check, concern, outlineChange, node: q.nodeId }) : null;
        if (this._smallRunsMarked && !stop) {
          await appendAudit(this.pipeline.dir, 'Plan approval **approve** (the plan passed its checks).').catch(() => {});
          if (notes.length) await appendAudit(this.pipeline.dir, settledLine('notes')).catch(() => {});
          return { decision: 'approve' };
        }
        if (replay) return replay;
        // D19: plan once, confirm later: the plan stops only when its check fails or the planner says the slice
        // cannot be built as outlined. A missing check (null: it errored) stops too.
        if (check?.ok === true && !outlineChange && !notes.length && !concern) {
          this._log('orchestrator', 'info', `plan approval ${q.id}: approved (the plan passed its checks)`);
          await appendAudit(this.pipeline.dir, 'Plan approval **approve** (the plan passed its checks).').catch(() => {});
          return { decision: 'approve' };
        }
        const why = outlineChange ? 'the planner says this slice cannot be built as outlined'
          : notes.length ? 'the chat added notes to this run'
          : concern ? 'a reviewer raised a requirement concern' : 'the shape check did not pass';
        await appendAudit(this.pipeline.dir, `Plan approval held: ${why}.`).catch(() => {});
      }
      const perspectives = this._shapePerspectives();
      return this._enqueueAsk(() => this._ask({
        id: q.id, kind: PLAN_ASK_KIND, nodeId: q.nodeId, executionId: q.executionId, ...(concern ? { concern } : {}), ...(stop ? { stop } : {}),
        // coverage: null = it could not be read, which is not "no coverage configured"; Away sends it back (planRule).
        plan: { ...q.plan, nodeId: q.nodeId, check, perspectives, ...(spec?.coverage ? { coverage } : {}), ...(outlineChange ? { outlineChange } : {}), ...(notes.length ? { notes } : {}),
          ...(conflicts.length ? { openConflicts: conflicts.length } : {}), ...(this._shapeRec?.smallRuns === true ? { smallRuns: true } : {}) },
        validate: (raw) => validatePlanAnswer(raw, { revisable: q.plan?.revisable === true, perspectives, conflicts, smallRuns: this._shapeRec?.smallRuns === true }),
      }));
    })();
    return asked.then(
      async (payload) => {
        if (payload?.decision === 'approve' && this.answeredBy(q.id) === NIGHT_ACTOR) this._planAwayApproved = { id: q.id };   // before any await: the pause window
        if (stop && !replay) await this._afterStopAnswer(q.id, stop, payload);
        this._shapingDecision(q, payload);
        if (payload?.decision === 'stop') {
          this._log('orchestrator', 'info', `plan approval ${q.id}: stop`);
          this.stop(this.answeredBy(q.id));
          this._scheduler?.abort();
          return new Promise(() => {});
        }
        if (payload?.decision === 'revise') {
          if (Array.isArray(payload.perspectives)) this._setShapePerspectives(payload.perspectives);
          // Small runs C4 (D11): Change it with a proposal; the server wrote the new text before the answer came in.
          if (payload.source === 'requirement' && stop?.change) this._takeRequirementChange(stop.change);
          const path = join(this.pipeline.dir, `plan-feedback-${q.plan.round}.md`);
          // Stash BEFORE the write (F19): a pause-time resume point built while the write is pending must carry it.
          // Persisted with the resume point; replayed only if a pause re-raises this same ask.
          this._planRevise = { id: q.id, path };
          // Keep the real cause: the run rethrows _graphError, else a generic 'a graph execution failed'.
          const picked = conflictClarifications(conflicts, payload.conflicts);
          const answered = picked.length ? `${payload.feedback}\n\nDecisions made so far:\n\n${picked.join('\n')}` : payload.feedback;
          const feedback = concern ? answered + requirementConcernFeedbackSection(concern) : answered;
          try { await writeFile(path, renderPlanFeedback(feedback, q.plan.file), 'utf8'); }
          catch (err) { this._planRevise = null; this._graphError ||= err; throw err; }
          this._shapeRec?.revises.push({ round: q.plan.round, by: payload.source === 'check' ? 'check' : 'person' });
          this._log('orchestrator', 'info', `plan approval ${q.id}: revise (${path})`);
          return { decision: 'revise', path };
        }
        // D28: the approved round's shape score
        if (payload?.decision === 'approve' && this._shapeRec) this._shapeRec.shapeScore = shapeScoreOf(check);
        if (payload?.decision === 'approve') await this._recordConflictPicks(q, conflicts, payload.conflicts);
        if (payload?.decision === 'approve' && concern) {
          await appendAudit(this.pipeline.dir, `Requirement concern overridden: ${concern.requirements.join(', ')} kept as agreed.`).catch(() => {});
        }
        return payload;                              // { decision:'approve' } | { decision:'withdrawn' }
      },
      (err) => {
        if (isPause(err) || this.pauseRequested) this._scheduler?.pause();
        else this._scheduler?.abort();
        return new Promise(() => {});
      },
    );
  }

  /** The node's `config.approve`, or null. */
  _approveSpec(nodeId) {
    const node = (this.resolved?.template?.nodes || []).find((n) => n.id === nodeId);
    return (this._unslicedReplan() ? withoutRequirementsInput(node) : node)?.config?.approve || null;
  }

  /** The file bound to an input of a held node: its execution's binding, else the token latched on the input. */
  _heldInputPath(q, port) {
    const snap = this._graphSnapshot;
    const exec = (snap?.execs || []).find((e) => e.executionId === q.executionId);
    return exec?.bindings?.[port]?.path || snap?.tokens?.[`${q.nodeId}.${port}`]?.path || null;
  }

  /** Which criteria of the held node's `port` input the held plan covers (coverage.mjs); null when either is unreadable. */
  async _planCoverage(q, port) {
    const path = this._heldInputPath(q, port);
    if (!path || !q.plan?.file) return null;
    try {
      const list = criteriaList(this._sliceCriteria(await readFile(path, 'utf8')));
      return coverageOf(list.map((c) => c.id), await readFile(q.plan.file, 'utf8'), { texts: Object.fromEntries(list.map((c) => [c.id, c.text])) });
    } catch { return null; }
  }

  /** Small runs C4 (D9): a requirement concern's proposals carry the agreed text they change (`from`, read from the
   *  run's own outline), so the change path can compare it; a proposal for an id the outline lacks is dropped. */
  _changeFrom(concern) {
    if (!concern || !Array.isArray(concern.proposals)) return concern;
    const sl = this.runShape?.slice;
    const agreed = sl?.outline?.agreed || [];
    // The fold's mark: where the run that owns the requirement is (this run: it re-plans, `waiting`).
    let slices = [];
    try { slices = (sl?.feature && featureView(sl.feature)?.slices) || []; } catch { slices = []; }
    const landsAs = (id) => {
      const owner = slices.find((s) => (s.requirements?.ids || []).includes(id));
      return !owner ? 'none' : owner.index === sl.index ? 'waiting' : changeCaseOf(owner.state);
    };
    const proposals = concern.proposals.map((p) => ({ ...p, from: agreed.find((a) => a.id === p.id)?.text, landsAs: landsAs(p.id) }))
      .filter((p) => typeof p.from === 'string');
    const rest = { ...concern };
    delete rest.proposals;
    return proposals.length ? { ...rest, proposals } : rest;
  }

  /** Small runs C4 (D11): after Change it, this run plans from the changed text: its slice outline's agreed texts are
   *  replaced and the cached slice scope is read again. */
  _takeRequirementChange(change) {
    const sl = this.runShape?.slice;
    if (!sl?.outline || !Array.isArray(change)) return;
    const to = new Map(change.map((c) => [c.id, c.to]));
    const agreed = (sl.outline.agreed || []).map((a) => (to.has(a.id) ? { ...a, text: to.get(a.id) } : a));
    this.runShape = { ...this.runShape, slice: { ...sl, outline: { ...sl.outline, agreed } } };
    this._sliceScopeCache = null;
  }

  /** Shaper: a sliced feature's run checks only its own slice's agreed criteria. The planning run (slice 1) is bound
   *  to the file of every agreed id, so the text is narrowed to the slice's ids; identity without agreed requirements. */
  _sliceCriteria(text) {
    const sl = this.runShape?.slice;
    // s3 (D13): a requirements-first Changes run reworks every agreed requirement, so its text is not narrowed.
    // Small runs C2 (D11): a run with a Care plan keeps the requirements' Example lines for its reviewers.
    const examples = !!this.state.stepper?.careRun;
    return sl?.outline?.agreed?.length && this.runShape.requirementsFirst !== true
      ? onlyCriteria(text, sliceRequirementIds(sl), examples ? { examples: true } : undefined) : text;
  }

  /** Small runs C2 (run 1): rebind the Test writer's `requirements` input to a copy narrowed to the slice's own ids, with
   *  their Example lines (`_sliceCriteria`). The execution's own bindings stay as the scheduler gave them. */
  async _sliceTestRequirements(ctx) {
    const token = ctx.bindings.requirements;
    try {
      const text = await readFile(token.path, 'utf8');
      const narrowed = this._sliceCriteria(text);
      if (narrowed === text) return;
      const path = join(this.pipeline.dir, `slice-requirements-${String(ctx.executionId).replace(/[^\w.-]+/g, '_')}.md`);
      await writeFile(path, narrowed, 'utf8');
      ctx.bindings = { ...ctx.bindings, requirements: { ...token, path } };
    } catch (err) {
      this._log('orchestrator', 'warn', `Test writer: cannot narrow the requirements to this slice: ${err?.message || err}`);
    }
  }

  /** The held criteria document and its decisions: the criteria check (agreed ids must survive), the sink's decisions
   *  plus the feeding role pass's conflicts (the lead's side recommended). `{ error }` when a file cannot be read. */
  async _criteriaLoad(q, spec, conflicts, lead) {
    try {
      const held = await readFile(q.plan.file, 'utf8');
      const agreedPath = spec.agreed ? this._heldInputPath(q, spec.agreed) : null;
      const agreed = agreedPath ? criterionIds(await readFile(agreedPath, 'utf8')) : [];
      let decisions = [];
      if (spec.decisions) {
        const path = this._graphSnapshot?.outputs?.[`${q.nodeId}.${spec.decisions}`]?.path;
        if (!path) throw new Error('the decisions file was not written');
        const text = await readFile(path, 'utf8');
        let raw;
        try { raw = text.trim() ? JSON.parse(text) : { decisions: [] }; } catch { throw new Error('the decisions file is not valid JSON'); }
        const norm = normalizeDecisions(raw);
        if (!norm.decisions.length && norm.errors.length) throw new Error(norm.errors[0]);   // every entry rejected
        decisions = norm.decisions;
      }
      // Small runs B3 (D12, D14): every requirement needs an example; one disagreement between two roles is one question.
      const smallRuns = this._shapeRec?.smallRuns === true;
      decisions = [...decisions, ...conflictDecisions(conflicts, { lead, after: decisions.length, onePerPair: smallRuns })];
      return { criteria: criteriaCheck(held, { agreed, requireExamples: smallRuns }), decisions, agreed };
    } catch (err) {
      return { error: { message: String(err?.code === 'ENOENT' ? 'a file is missing' : err?.message || err) } };
    }
  }

  /** An approval hold with `approve.check: 'criteria'`: the held document's criteria and decisions instead of the
   *  plan's shape check. Approve writes the picks into its Clarifications first; revise carries them in the feedback;
   *  `retry` (on an error ask only) reads the files again under a new ask id. Approve checks the document again (it
   *  may have been edited during the hold) and asks again if that fails; a failed write asks again with an error, so
   *  the picks are never lost silently. No shaping round is recorded. */
  _criteriaAsk(q, spec) {
    const roleNode = this._roleFindingsWire(q.nodeId)?.node;
    const conflicts = (roleNode ? currentPass(this.state.roleReviews, { node: roleNode }) : null)?.rounds.at(-1)?.conflicts || [];
    const lead = this.runShape?.lead || null;
    const perspectives = this._shapePerspectives();
    const smallRuns = this._shapeRec?.smallRuns === true;
    // C1: a resumed marked run whose requirements were agreed (the Prototype step has a record) goes on with the step.
    if (smallRuns && this._shapeRec?.prototype) return this._afterRequirements(q);
    const ask = async (attempt, failed = null) => {
      const got = failed ? { error: failed } : await this._criteriaLoad(q, spec, conflicts, lead);
      const id = attempt ? `${q.id}-retry${attempt}` : q.id;
      // Small runs B3 (D15): the card reads the requirements review node's pass (attachRoleReviews, `plan.roleNode`).
      const plan = { ...q.plan, nodeId: q.nodeId, ...(got.error ? { error: got.error } : { criteria: got.criteria, decisions: got.decisions }),
        ...(lead ? { lead } : {}), ...(smallRuns ? { smallRuns: true, ...(roleNode ? { roleNode } : {}) } : {}) };
      const payload = await this._enqueueAsk(() => this._ask({
        id, kind: PLAN_ASK_KIND, nodeId: q.nodeId, executionId: q.executionId, plan,
        validate: (raw) => validatePlanAnswer(raw, { revisable: q.plan?.revisable === true, perspectives, smallRuns,
          ...(got.error ? { error: true } : { decisions: got.decisions, criteria: got.criteria }) }),
      }));
      if (payload?.decision === 'retry') return ask(attempt + 1);
      const decisions = got.decisions || [];
      const picks = payload?.decisions || validateDecisionPicks(undefined, decisions).picks;
      if (payload?.decision === 'approve') {
        // Before the approval resolves: the next node never reads the document without the picks.
        let stale = false;
        try {
          const text = await readFile(q.plan.file, 'utf8');
          stale = !criteriaCheck(text, { agreed: got.agreed, requireExamples: smallRuns }).ok;
          if (!stale && decisions.length) await writeFile(q.plan.file, withClarifications(text, decisionClarifications(decisions, picks)), 'utf8');
        } catch (err) {
          await appendAudit(this.pipeline.dir, `Approval ${id}: the decisions could not be written (${err.message}); nothing approved.`).catch(() => {});
          return ask(attempt + 1, { message: 'Could not save your picks. Nothing changed.' });
        }
        if (stale) {
          await appendAudit(this.pipeline.dir, `Approval ${id}: the requirements changed during the hold and their check fails; asking again.`).catch(() => {});
          return ask(attempt + 1);
        }
        if (decisions.length) await appendAudit(this.pipeline.dir, `Approval ${id}: ${decisions.length} decision(s) recorded.`).catch(() => {});
      }
      return { payload, decisions, picks, id };
    };
    return ask(0).then(
      async ({ payload, decisions, picks, id }) => {
        if (payload?.decision === 'stop') {
          this._log('orchestrator', 'info', `approval ${q.id}: stop`);
          this.stop(this.answeredBy(id));
          this._scheduler?.abort();
          return new Promise(() => {});
        }
        if (payload?.decision === 'revise') {
          if (Array.isArray(payload.perspectives)) this._setShapePerspectives(payload.perspectives);
          const path = join(this.pipeline.dir, `${q.nodeId}-feedback-${q.plan.round}.md`);
          this._planRevise = { id: q.id, path };
          const made = decisionClarifications(decisions, picks);
          const feedback = made.length ? `${payload.feedback}\n\nDecisions made so far:\n\n${made.join('\n')}` : payload.feedback;
          try { await writeFile(path, renderPlanFeedback(feedback, q.plan.file), 'utf8'); }
          catch (err) { this._planRevise = null; this._graphError ||= err; throw err; }
          this._log('orchestrator', 'info', `approval ${q.id}: revise (${path})`);
          return { decision: 'revise', path };
        }
        // C1 (D1): a marked run's approval resolves only once the Prototype step ended, so the Split fires after it.
        if (payload?.decision === 'approve' && smallRuns) return this._afterRequirements(q);
        return payload?.decision === 'approve' ? { decision: 'approve' } : payload;
      },
      (err) => {
        if (isPause(err) || this.pauseRequested) this._scheduler?.pause();
        else this._scheduler?.abort();
        return new Promise(() => {});
      },
    );
  }

  /** C1 (D1): the Prototype step after agreed requirements; resolves the approval, or stops or pauses like the ask. */
  async _afterRequirements(q) {
    let r;
    try {
      r = await this._prototypeStep(q);
    } catch (err) {
      if (isPause(err) || this.pauseRequested) this._scheduler?.pause();
      else {
        // A stop ends the round Design is building too (a pause leaves it: the resume awaits it).
        const p = this._shapeRec?.prototype;
        if (this.abort.signal.aborted && p?.state === 'building' && p.buildId) {
          await Promise.resolve(registryOf({ designBuilds: this.opts.designBuilds || null })?.stopBuild(p.buildId)).catch(() => {});
        }
        this._graphError ||= err;
        this._scheduler?.abort();
      }
      return new Promise(() => {});
    }
    if (r.state === 'stopped') {
      this._log('orchestrator', 'info', `prototype ${q.id}: stop`);
      this.stop(this.answeredBy(this._protoAskId));
      this._scheduler?.abort();
      return new Promise(() => {});
    }
    return { decision: 'approve' };
  }

  /** C1: the Prototype step's effects (src/core/shape/prototype-step.mjs). Design through the injected registry or the
   *  server's (D7); the review and the remark match through the plan review node's agent (D8). */
  async _prototypeStep(q) {
    const rec = this._shapeRec;
    const readReqs = async () => { try { return await readFile(q.plan.file, 'utf8'); } catch { return ''; } };
    const agreed = criteriaList(await readReqs());
    const deps = { designBuilds: this.opts.designBuilds || null };
    const by = this._runStarter();
    const node = planReviewNode(this.resolved?.template);
    // Each effect first checks for a pause or a stop, so a paused or stopped run never drives the step on.
    const live = (fn) => async (...a) => { this._protoCheck(); return fn(...a); };
    return runPrototypeStep({
      rec, position: rec.care?.position, agreed, designOn: flagEnabled('design') === true, registry: !!registryOf(deps),
      ask: (moment, view) => this._prototypeAsk(q, moment, view),
      build: live(async ({ keep }) => {
        // The design is saved (keep) before the round starts, so a replayed Build never makes a second one.
        let designId = rec.prototype?.designId;
        if (!designId) {
          designId = createPrototypeDesign({ projectKey: this.state.projectKey || null, title: this.state.title || 'Feature', by,
            models: this.claude?.model ? { model: this.claude.model, effort: this.claude.effort } : null });
          await keep(designId);
        }
        const text = await readReqs();
        const brief = prototypeBrief({ title: this.state.title, requirements: screenRequirements(criteriaList(text)), examples: criteriaExamples(text),
          fail: this.claude?.mock === true && process.env.WORCA_MOCK_PROTO_FAIL === '1' });
        const s = await startPrototypeBuild({ designId, brief, by, deps });
        return s.refused ? s : { ...s, designId };
      }),
      change: live((a) => startPrototypeBuild({ designId: rec.prototype?.designId, instruction: a.instruction, sections: a.sections, needsLead: a.needsLead, by, deps })),
      // The wait gives way to a pause or a stop at once: the build itself goes on in Design, and a resume awaits it.
      awaitBuild: live((id) => this._untilPauseOrStop(awaitPrototypeBuild(id, deps))),
      review: live((r, prior) => this._prototypeReview(node, q, r, prior)),
      matchRemark: live((said) => this._prototypeRemark(node, q, said)),
      rewrite: live(async (id, p) => {
        const out = rewriteRequirement(await readReqs(), id, p);
        if (!out) return false;
        await writeFile(q.plan.file, out, 'utf8');
        return true;
      }),
      freeze: live(async (a) => freezePrototype({ designId: rec.prototype?.designId, shownVersion: a.shownVersion, screens: a.screens, pipelineDir: this.pipeline.dir })),
      // D16: the stashed answer is spent once the step saved what it did with it. A new moment (or review round) is
      // announced, so the one card re-reads the saved state and draws the working moments live (R-ux-2).
      persist: async () => {
        this._protoAnswer = null;
        const out = await this._persist();
        const p = rec.prototype || {};
        const key = `${p.state}|${p.reviewRounds}|${p.buildId || ''}`;
        if (key !== this._protoShown) { this._protoShown = key; this._emit('shape-prototype', { pipelineId: this.state.id, state: p.state }); }
        return out;
      },
      audit: (text) => appendAudit(this.pipeline.dir, text).catch(() => {}),
    });
  }

  /** C1: throws the stop or the pause that landed, so the Prototype step goes no further. */
  _protoCheck() {
    if (this.abort.signal.aborted) throw abortError('stopped');
    if (this.pauseRequested) throw pauseErr();
  }

  /** C1: `work`, or the stop or the pause, whichever lands first. */
  _untilPauseOrStop(work) {
    const sigs = [this.abort.signal, this.pauseAbort.signal];
    let off = () => {};
    const halted = new Promise((_, reject) => {
      const on = () => { try { this._protoCheck(); } catch (err) { reject(err); } };
      for (const sg of sigs) sg.addEventListener('abort', on, { once: true });
      off = () => { for (const sg of sigs) sg.removeEventListener('abort', on); };
    });
    return Promise.race([work, halted]).finally(off);
  }

  /** C1 (D15, D16): one `prototype` ask. An answer is stashed before the first await, keyed by the moment, the saved
   *  record's time and the version shown, so a pause right after it replays it instead of losing it. */
  async _prototypeAsk(q, moment, view) {
    const key = `${moment}|${this._shapeRec?.prototype?.at || ''}|${view.version ?? ''}`;
    if (this._protoAnswer?.key === key) return this._protoAnswer.payload;
    this._protoAnswer = null;
    this._protoSeq += 1;
    // The round and the saved record's time keep the id unique across a resume, which counts from 1 again.
    const at = String(this._shapeRec?.prototype?.at || '').replace(/\D/g, '');
    const id = `proto-${q.nodeId}-${this._shapeRec?.prototype?.round ?? 0}-${at}-${this._protoSeq}`;
    this._protoAskId = id;
    // D17: each screen's pieces, read here as plain words, so the card never needs the agent's HTML.
    const screens = await Promise.all((view.screens || []).map(async (sc) => {
      let html = '';
      if (view.designId && /^[a-z][a-z0-9-]{0,31}$/.test(sc.section)) { try { html = await readFile(join(designWorkDir(view.designId), 'sections', sc.section, 'index.html'), 'utf8'); } catch { html = ''; } }
      return { ...sc, pieces: piecesOf(html) };
    }));
    const payload = await this._enqueueAsk(() => this._ask({ id, kind: PROTOTYPE_ASK_KIND, nodeId: q.nodeId, executionId: q.executionId,
      prototype: { moment, ...view, screens }, validate: (raw) => validatePrototypeAnswer(raw, moment) }));
    this._protoAnswer = { key, payload };
    return payload;
  }

  /** The next free ordinal of a slice spawn kind under the run (its execution ids stay unique across a resume). */
  _nextSliceOrdinal(prefix) {
    return this.state.steps.filter((s) => typeof s.key === 'string' && s.key.includes(`:${prefix}-`)).length + 1;
  }

  /** C1 (D8, D9): one Thorough review round of the built prototype by Design and Product. */
  async _prototypeReview(node, q, r, prior) {
    if (!node) {
      await appendAudit(this.pipeline.dir, 'Prototype not reviewed: this workflow has no plan review step.').catch(() => {});
      return [];
    }
    const n = this._nextSliceOrdinal('prototype-review');
    const out = join(this.pipeline.dir, `prototype-review-${n}.json`);
    const p = this._shapeRec.prototype || {};
    const brief = prototypeReviewBlock({ dir: designDistDir(p.designId), requirements: q.plan.file, screens: p.screens || [], out, round: r, prior })
      + mockMarkers({ MOCK_PROTO_REVIEW: out, MOCK_PROTO_ROUND: r }) + '\n\n';
    const raw = await this._spawnSliceAgent({ roleNode: node, parentExecutionId: q.executionId, ordinal: n, taskId: `prototype-review-${n}`,
      brief, out, auditLine: (model) => `Prototype review round ${r}: Design and Product on ${model}.` });
    return normalizeReview(raw);
  }

  /** C1 (D10): the one requirement a remark changes, with its proposed text and example, or null. */
  async _prototypeRemark(node, q, said) {
    let list = [];
    try { list = criteriaList(await readFile(q.plan.file, 'utf8')); } catch { list = []; }
    const ids = list.map((c) => c.id);
    const target = remarkTarget(said, ids);
    if (!node || !ids.length) return null;
    const n = this._nextSliceOrdinal('prototype-remark');
    const out = join(this.pipeline.dir, `prototype-remark-${n}.json`);
    const screenIds = this._shapeRec.prototype?.screenIds || [];
    const brief = prototypeRemarkBlock({ remark: said, requirements: q.plan.file, ids, target, out })
      + mockMarkers({ MOCK_PROTO_REMARK: out, MOCK_PROTO_IDS: target || [...screenIds, ...ids].join(',') }) + '\n\n';
    const raw = await this._spawnSliceAgent({ roleNode: node, parentExecutionId: q.executionId, ordinal: n, taskId: `prototype-remark-${n}`,
      brief, out, auditLine: (model) => `Prototype remark matched on ${model}.` });
    const p = validRemarkProposal(raw, target ? [target] : ids);
    return p ? { ...p, was: list.find((c) => c.id === p.id)?.text || '' } : null;
  }

  /** C1 (D14): the confirmed prototype of a run whose slice owns a screen requirement, staged once into its own folder. */
  async _shapePrototypeCtx() {
    if (this._protoCtx !== undefined) return this._protoCtx;
    const sl = this.runShape?.slice;
    let out = null;
    const own = sl?.index === 1 && !!this._shapeRec?.prototype;
    const rec = own ? normalizePrototype(this._shapeRec.prototype) : prototypeOfFeature(sl?.feature);
    if (rec?.state === 'confirmed' && rec.ref) {
      const ids = sliceRequirementIds(sl).filter((id) => rec.screenIds.includes(id));
      if (ids.length) {
        // security: the frozen folder must be unchanged since the confirm (its digest) and, for a feature's record, sit in
        // the feature's origin run.
        const origin = own ? null : originPipelineOfFeature(sl?.feature);
        const dir = stagePrototypeForRun({ ref: rec.ref, pipelineDir: this.pipeline.dir, originPipelineId: origin });
        if (dir) out = { dir, ids };
        else await appendAudit(this.pipeline.dir, 'The confirmed prototype is gone: this run goes on without it.').catch(() => {});
      }
    }
    this._protoCtx = out;
    return out;
  }

  /** #990 slice 3 (D9): the approved plan keeps the person's conflict picks in its Clarifications (idempotent across a
   *  re-asked approval), one audit line per conflict. A failed write is audited and never blocks the approval. */
  async _recordConflictPicks(q, conflicts, picks = []) {
    if (!conflicts.length) return;
    const lines = conflictClarifications(conflicts, picks);
    if (lines.length && q.plan?.file) {
      try { await writeFile(q.plan.file, withClarifications(await readFile(q.plan.file, 'utf8'), lines), 'utf8'); } catch (err) {
        await appendAudit(this.pipeline.dir, `Plan approval: the decisions could not be written to the plan (${err.message}).`).catch(() => {});
      }
    }
    for (const c of conflicts) {
      const p = (picks || []).find((x) => x.id === c.id);
      await appendAudit(this.pipeline.dir, p ? `Plan approval: ${c.id} decided: ${p.choice}.` : `${c.id} left undecided at approval`).catch(() => {});
    }
  }

  _shapePerspectives() {
    return Array.isArray(this.runShape?.perspectives) ? [...this.runShape.perspectives] : [...DEFAULT_PERSPECTIVES];
  }

  /** Slice 3: the primary project's house brief for the Project fit reviewer, rebuilt only when a source hash changed.
   *  '' when there is none or the build fails: a broken source never stops a review. */
  async _fitHouseBrief() {
    const m = this.members?.[0];
    if (!m?.projectKey || !m.projectDir) return '';
    try { return (await ensureHouseBrief({ projectKey: m.projectKey, projectDir: m.projectDir })).brief || ''; } catch { return ''; }
  }

  /** Update plan (S5): the next Planner/Refine prompt and shape check use the new list; the resume point keeps it. */
  _setShapePerspectives(perspectives) {
    this.runShape = { ...(this.runShape || {}), perspectives: [...perspectives] };
    if (this.state.shaping) this.state.shaping.perspectives = [...perspectives];
  }

  /** One version row per plan ask; a resume re-raises the same round, which replaces its row. */
  _shapingRound(q, check, coverage = null) {
    const s = this.state.shaping;
    if (!s) return;
    const row = { round: q.plan?.round ?? 0, file: q.plan?.file ?? null,
      passed: Number.isFinite(check?.passed) ? check.passed : null, total: Number.isFinite(check?.total) ? check.total : null,
      decision: null, ...(coverage ? { coverage: { ok: coverage.ok, passed: coverage.passed, total: coverage.total } } : {}) };
    const i = s.rounds.findIndex((r) => r.round === row.round);
    if (i >= 0) s.rounds[i] = row; else s.rounds.push(row);
    // A person's approve answered just before a pause is not replayed: the resume re-asks the same round. Drop the stale
    // `approved`, or the run card would show "while shaping" over an open plan ask.
    if (s.approved && s.approved.round === row.round) s.approved = null;
    this._emit('state', this.getState());
  }

  _shapingDecision(q, payload) {
    const s = this.state.shaping;
    const d = payload?.decision;
    if (!s || (d !== 'approve' && d !== 'revise' && d !== 'stop')) return;   // 'withdrawn' (End) records nothing
    const row = s.rounds.find((r) => r.round === q.plan?.round);
    if (row) {
      row.decision = d;
      if (d === 'revise') row.feedback = String(payload.feedback || '').slice(0, SHAPING_FEEDBACK_PREVIEW);
    }
    if (d === 'approve') s.approved = { round: q.plan?.round ?? null, file: q.plan?.file ?? null };
    this._emit('state', this.getState());
  }

  /** L2: the Planner may write an outline only on its first execution in a shaped, single-project, unsliced run. */
  _slicingOffered() {
    const s = this.runShape;
    return Boolean(s) && s.slices !== 'off' && !s.slice && !this.isWorkspace && !this._slicingDone
      && !this.state.shaping?.outline?.decided;
  }

  /** Small runs: a re-plan that carried requirements but ended unsliced (Don't slice, or a one-slice, unreadable or flat
   *  outline). There is no feature to carry them into, so from here on no node has the list: the run is the plain Shaper's. */
  _unslicedReplan() {
    const s = this.runShape;
    return Boolean(s?.replaces) && !s.slice && SHAPE_SLICE_REQ_WORKFLOW_IDS.includes(this.workflowId) && !this._slicingOffered();
  }

  async _shapeSliceCtx(nc, ctx) {
    const out = {};
    const scope = await this._shapeSliceScope();
    if (scope) out.shapeSliceScope = scope;
    // D19: a stale outline-change.md from an earlier spawn is not this Planner's. state.shaping.rounds are the PLAN
    // rounds: once a person was shown a plan in this run, the file is kept, so a revised plan still stops and says why.
    if (nc.key === SLICE_PLANNER_KEY && this.runShape?.slice?.index > 1 && !ctx.resumeSessionId
      && !(this.state.shaping?.rounds?.length)) {
      await rm(join(this.pipeline.dir, OUTLINE_CHANGE_FILE), { force: true });
    }
    if (nc.key !== SLICE_PLANNER_KEY) return out;
    // F25: ctx is rebuilt after a pause, so the Don't slice note comes from the saved shaping state, not from ctx.
    if (this.state.shaping?.outline?.decided === 'flat') out.shapeOutlineNote = { decision: 'flat' };
    if (this._slicingOffered()) {
      const file = join(this.pipeline.dir, OUTLINE_FILE);
      const rounds = this.state.shaping?.outline?.rounds || [];
      // _execCtx already took this execution's paused session (ctx.resumeSessionId, orchestrator.mjs:1600): the
      // outline it wrote before the pause, if any, is this Planner's own and must be kept.
      const resuming = Boolean(ctx.resumeSessionId);
      // A file left from an earlier spawn must not be read as this Planner's outline. Keep it once a round was
      // asked (the loop re-asks that outline after a pause, F25) or when the paused session resumes.
      // B4: an outline the Split's challenge already looked at is kept too.
      const challenged = Boolean(this.state.shaping?.outline?.challenge?.rounds?.length);
      if (!rounds.length && !resuming && !challenged) await rm(file, { force: true });
      out.shapeSlicing = { file, size: this.runShape?.size || null, ...(ctx.bindings?.requirements?.path ? { requirements: true } : {}),
        ...splitRules(this._shapeRec) };
      // B4 (D9): a pause during an internal refine: this spawn is that refine, with the objections as its revise note.
      const refining = this.state.shaping?.outline?.challenge?.refining;
      if (refining && !rounds.length) {
        out.shapeOutlineNote = { decision: 'revise', feedback: refining };
        out.splitRefineRestored = true;
      }
      // A pause during a revise spawn: put the person's feedback back, and the asked round's baseline (D11).
      const last = rounds[rounds.length - 1];
      if (last?.decision === 'revise') out.shapeSlicing.baseline = this._outlineBaseline();
      if (last?.decision === 'revise' && this._outlineRevise) out.shapeOutlineNote = { decision: 'revise', feedback: this._outlineRevise };
    }
    return out;
  }

  /** D19: the feature's Clarify answers for a later slice; empty when they cannot be read (Clarify is skipped anyway). */
  _featureClarify() {
    try { return featureClarify(this.runShape.slice.feature) || { questions: null, answers: null }; }
    catch (err) { this._log('orchestrator', 'warn', `slice clarify: cannot read the feature's answers: ${err?.message || err}`); return { questions: null, answers: null }; }
  }

  /** L6: slice k's scope: the outline and what the earlier slices changed, read once per run (D14). */
  async _shapeSliceScope() {
    const sl = this.runShape?.slice;
    if (!sl?.outline) return null;
    if (this._sliceScopeCache) return this._sliceScopeCache;
    let earlier = [];
    if (sl.index > 1) {
      try { earlier = await earlierSliceChanges(sl.feature, sl.index); }
      catch (err) { this._log('orchestrator', 'warn', `slice scope: cannot read the earlier slices: ${err?.message || err}`); }
    }
    let notes = [];
    if (sl.index > 1) {
      try { notes = featureNotes(sl.feature, sl.index); }
      catch (err) { this._log('orchestrator', 'warn', `slice scope: cannot read the feature's notes: ${err?.message || err}`); }
    }
    this._sliceScopeCache = { index: sl.index, total: sl.total, outline: sl.outline, earlier, notes,
      ...(sl.index > 1 ? { outlineChangeFile: join(this.pipeline.dir, OUTLINE_CHANGE_FILE) } : {}) };
    return this._sliceScopeCache;
  }

  /** D19: the Planner's note that this slice cannot be built as outlined, or null. */
  async _outlineChangeText() {
    if (!(this.runShape?.slice?.index > 1)) return null;
    try { const t = (await readFile(join(this.pipeline.dir, OUTLINE_CHANGE_FILE), 'utf8')).trim(); return t ? t.slice(0, 4000) : null; }
    catch { return null; }
  }

  /**
   * Spec §3.8, L1: in slicing mode the Planner either writes its plan (no outline: it chose not to slice) or writes
   * slices.json and stops. Ask a person, then resume the SAME session (as _questionsLoop does): slice 1's plan, the
   * whole task (flat), or a rewritten outline (revise, at most OUTLINE_ROUNDS_MAX rounds). --yes never answers it (F3);
   * Away mode answers it (planRule).
   */
  async _outlineLoop(nc, ctx, firstResult) {
    let result = firstResult;
    if (!ctx.shapeSlicing) return result;
    const file = ctx.shapeSlicing.file;
    const label = nc.meta?.displayName || nc.key || ctx.nodeId;
    let error = null;
    let carried = null;                                     // the edits of an approval whose feature creation failed
    let carriedEach = null;                                 // and its Ask me before each run choice
    let retry = 0;
    const agreed = await this._outlineAgreed(ctx);
    // A3: the split rules the Planner's prompt named (read once per spawn, into ctx.shapeSlicing), so they never disagree.
    const rules = ctx.shapeSlicing.smallRuns ? { smallRuns: true, care: ctx.shapeSlicing.care } : {};
    const keptRoles = this._keptConfirmed(agreed);
    let classified = null;                                  // the spawn result whose outlineState was acted on
    // B4 (D9): this execution's first spawn re-ran an internal refine a pause cut short: that refine is done.
    if (ctx.splitRefineRestored && this.state.shaping?.outline?.challenge) {
      this.state.shaping.outline.challenge.refining = null;
      ctx.splitRefineRestored = false;
      await this._persist();
    }
    for (;;) {
      this._checkAbort();
      // D10: the executor classified the outline file after the spawn (outline-file.mjs); a feature-creation retry
      // re-asks without a spawn, so a result is acted on once.
      const state = result !== classified ? result?.outlineState : null;
      classified = result;
      if (state === 'flat') {                               // the Planner wrote its plan instead (also after a revise)
        this._slicingDone = true;
        this._retireOrphanFeature();
        if (this.state.shaping?.outline?.rounds?.length) this._shapingOutlineDecision(null, { decision: 'flat' });
        return result;
      }
      if (state === 'unchanged') await appendAudit(this.pipeline.dir, `${label}: The planner left the outline unchanged.`).catch(() => {});
      let raw = null;
      try { raw = JSON.parse(await readFile(file, 'utf8')); } catch (err) {
        if (err?.code === 'ENOENT') {                       // defensive: the executor's outlineState says flat first
          this._slicingDone = true;
          this._retireOrphanFeature();
          if (this.state.shaping?.outline?.rounds?.length) this._shapingOutlineDecision(null, { decision: 'flat' });
          return result;
        }
        raw = { error: err?.message || String(err) };
      }
      const read = normalizeOutline(keepConfirmed(raw, keptRoles), { agreed, ...rules });
      if (!read.ok || read.outline.slices.length < 2) {
        await appendAudit(this.pipeline.dir, `${label}: ${read.ok ? 'a one-slice outline' : `an unreadable outline (${read.error})`} — planning the whole task.`).catch(() => {});
        this._retireOrphanFeature();
        this._shapingOutlineDecision(null, { decision: 'flat' });
        return this._resumeOutline(nc, ctx, { decision: 'flat' });
      }
      const outline = read.outline;
      // An undecided last round is re-asked under its own number: after a pause (F25), or after a failed
      // feature creation (then with the -e<retry> suffix). Only a decided round moves the count on.
      const rounds = this.state.shaping?.outline?.rounds || [];
      // B4 (D10): the roles challenge the split once per run, before the first Split ask. A refine may change the
      // outline or plan it as one: the loop classifies its result again.
      if (rules.smallRuns && !rounds.length && this.state.shaping && !this.state.shaping.outline?.challenge?.done) {
        const ch = await this._splitChallenge(nc, ctx, file);
        if (ch.result) result = ch.result;
        continue;
      }
      const last = rounds[rounds.length - 1];
      const reasked = Boolean(last && last.decision == null);
      const round = reasked ? last.round : rounds.length + 1;
      const check = checkSlices(outline, rules);
      const revisable = splitRevisable(round, outline, rules);       // B4 (D19): a refused split stays revisable longer
      const split = rules.smallRuns ? await this._splitAskFields(ctx) : null;
      const id = `plan-outline-${ctx.nodeId}-${round}${retry ? `-e${retry}` : ''}`;
      // D9: what was asked, so a revise spawn can tell an edited outline from an untouched one and a fresh plan from a stale one.
      this._shapingOutlineRound({ round, outline, check, sha: await fileSha(file), planSha: await fileSha(planOutputOf(ctx.outputs)) });
      if (!reasked) await appendAudit(this.pipeline.dir, `${label} proposed ${outline.slices.length} slices (outline round ${round}).`).catch(() => {});
      const payload = await this._enqueueAsk(() => this._ask({
        id, kind: PLAN_ASK_KIND, nodeId: ctx.nodeId, executionId: ctx.executionId,
        plan: { nodeId: ctx.nodeId, port: 'outline', file, round, revisable, check,
          perspectives: this._shapePerspectives(), outline, ...(error ? { error } : {}), ...(carried ? { edits: carried } : {}),
          ...(carriedEach === true ? { approveEach: true } : {}),          // the card's switch as it was (D19: off by default)
          ...(split || {}) },
        validate: (r) => validateOutlineAnswer(r, { outline, revisable, rules, open: split?.challenge.open || 0 }),
      }));
      this._checkAbort();
      const by = this.answeredBy(id);
      const d = payload?.decision;
      if (d === 'withdrawn' || !d) return result;          // End arrived (_dismissPendingAsk): never respawn the Planner
      // The decision's audit line is _auditDecision's (answer(), F32): no second line here.
      if (d === 'stop') { this._retireOrphanFeature(); this._shapingOutlineDecision(round, payload); this.stop(by); this._checkAbort(); return result; }
      if (d === 'revise') {
        this._shapingOutlineDecision(round, payload);
        this._outlineRevise = payload.feedback;             // rides the resume point: a pause mid-revise keeps it
        error = null; carried = null; carriedEach = null; retry = 0;
        result = await this._resumeOutline(nc, ctx, payload);
        continue;
      }
      if (d !== 'approve') {
        this._retireOrphanFeature();
        this._shapingOutlineDecision(round, { decision: 'flat' });
        return this._resumeOutline(nc, ctx, { decision: 'flat' });
      }
      const applied = applyOutlineEdits(outline, payload.edits || []);      // validated already: ok
      applied.outline = settleLeftOut(applied.outline);                     // an id no slice placed is left out
      if (applied.outline.slices.length < 2) {
        this._retireOrphanFeature();
        this._shapingOutlineDecision(round, { decision: 'flat' });
        return this._resumeOutline(nc, ctx, { decision: 'flat' });
      }
      // B4 (D12): defence in depth: the validator already refused a split that fails a non-waivable rule.
      const refusal = splitApproveError(outline, payload.edits, rules);
      if (refusal) { error = refusal; carried = payload.edits?.length ? payload.edits : null; retry += 1; continue; }
      let feature;
      try {
        feature = createSliceFeature({
          pipelineId: this.pipeline.id, projectDir: this.projectDir, title: this.state.title || 'Feature',
          outline: applied.outline, proposed: outline.slices.length, merges: applied.merges, removals: applied.removals,
          approveEach: payload.approveEach === true, perspectives: this._shapePerspectives(),
          workflowId: this._shapePerspectives().includes('ux') ? SHAPE_UX_WORKFLOW_ID : SHAPE_WORKFLOW_ID,
          base: this._sliceRequestBase(), replaces: this.runShape?.replaces || null, startedBy: this._runStarter(), pr: this._featurePr(),
          // B2 (D10, d-3): the marker, not the live flag, decides whether the feature records its Care.
          care: this._shapeRec?.care || null, smallRuns: this._shapeRec?.smallRuns === true,
          // From the outline with the person's edits (a `confirm` edit changes the role). Always an object for a marked run:
          // null would keep the replaced feature's roles.
          requirementKinds: this._shapeRec?.smallRuns === true ? confirmedKindsOf(applied.outline) : null,
        });
      } catch (err) {
        this._log('orchestrator', 'warn', `slices: cannot create the feature: ${err?.message || err}`);
        error = `Could not set up the later slices: ${err?.message || err}. Try again, or choose Don't slice.`;
        carried = payload.edits?.length ? payload.edits : null;   // the card starts from them again (plan.edits)
        carriedEach = payload.approveEach === true;               // and from the switch as it was (plan.approveEach)
        retry += 1;
        continue;
      }
      this._outlineRevise = null;
      // The file becomes the approved outline only once the feature exists: a failed creation re-asks the outline
      // the person saw, and plan.edits puts their merges and removals back on the card.
      await writeFile(file, JSON.stringify(applied.outline, null, 2) + '\n', 'utf8')
        .catch((err) => this._log('orchestrator', 'warn', `slices: cannot write the approved outline: ${err?.message || err}`));
      this._shapingOutlineDecision(round, payload);
      const kept = keptObjections(payload, split);                    // B4 (D20): the decision round's kept count
      if (kept) { const row = this.state.shaping?.outline?.rounds?.find((r) => r.round === round); if (row) row.openObjections = kept; }
      this.runShape = { ...this.runShape, slice: { feature: feature.id, index: 1, total: feature.total, outline: applied.outline } };
      if (this.state.shaping) this.state.shaping.feature = { id: feature.id, index: 1, total: feature.total };
      this._sliceScopeCache = null;
      await this._careOriginRun();
      this._emit('state', this.getState());
      this._emit('shape-feature', { id: feature.id });
      // F47: hosts still pointed at the re-planned feature now follow replaced_by to this one: repaint them too.
      if (this.runShape?.replaces) this._emit('shape-feature', { id: this.runShape.replaces });
      return this._resumeOutline(nc, ctx, payload);
    }
  }

  /** Small runs: the requirements a person confirms that a marked re-plan carried over, with the replaced feature's role:
   *  the outline keeps them whatever the Planner wrote (a person's `confirm` edit still wins). [] for any other run. */
  _keptConfirmed(agreed) {
    const replaces = this.runShape?.replaces;
    if (!replaces || this._shapeRec?.smallRuns !== true || !SHAPE_SLICE_REQ_WORKFLOW_IDS.includes(this.workflowId)) return [];
    const ids = new Set(agreed.map((a) => a.id));
    try { return carriedRequirements(replaces).confirmed.filter((c) => ids.has(c.id)); }
    catch (err) { this._log('orchestrator', 'warn', `slices: cannot read the replaced feature's requirements: ${err?.message || err}`); return []; }
  }

  /** D14: every agreed requirement id of the feature, for the planner's and refiner's numbering and `Covers:` lines: a slice
   *  run's outline (all slices', not only its own), else the bound requirements file. [] when there are none. */
  async _shapeAgreedIds(ctx) {
    const agreed = this.runShape?.slice?.outline?.agreed;
    if (Array.isArray(agreed) && agreed.length) return agreed.map((a) => a.id).filter(Boolean);
    return (await this._outlineAgreed(ctx)).map((c) => c.id);
  }

  /** The agreed criteria the Planner's `requirements` input holds, for the outline; [] without one or when unreadable. */
  async _outlineAgreed(ctx) {
    const path = ctx.bindings?.requirements?.path;
    if (!path) return [];
    try {
      const text = await readFile(path, 'utf8');
      const list = criteriaList(text);
      // Small runs C2 (D11): a marked run's outline keeps each requirement's example, so its slice briefs carry it.
      if (!this._shapeRec?.smallRuns) return list;
      const examples = criteriaExamples(text);
      return list.map((c) => (examples.get(c.id) ? { ...c, example: examples.get(c.id) } : c));
    } catch (err) {
      this._log('orchestrator', 'warn', `slices: cannot read the agreed requirements: ${err?.message || err}`);
      return [];
    }
  }

  /** #990 s5 (D1): an implementer below a plan approval stop — a code side-effect node whose `plan` input is wired from a
   *  node with an `approve` plan config, in a run whose approval stops are armed. Slices, role slices and fix-mode
   *  executions never raise one. */
  _planConcernCtx(nc, ctx) {
    if (!this.runShape || nc.meta?.sideEffect !== 'code' || ctx.slice || ctx.role || ctx.bindings?.fix) return null;
    const tpl = this.resolved?.template || {};
    const wire = (tpl.wires || []).find((w) => w.to?.node === ctx.nodeId && w.to?.port === 'plan');
    const src = wire && (tpl.nodes || []).find((n) => n.id === wire.from.node);
    if (src?.config?.approve?.kind !== PLAN_ASK_KIND) return null;
    return { file: join(this.pipeline.dir, planConcernFileName(ctx.nodeId, ctx.ordinal)), approvalNodeId: src.id };
  }

  /** True when concern `id` was already decided as Approve (by a person, Away mode or --yes): its execution is the override re-run. */
  _planConcernOverridden(id) {
    return this._planConcernSeen[id] === 'decided' && this._planConcernHeld?.id === id
      && (this.auto || (this._planConcernAnswer?.id === id && this._planConcernAnswer.payload?.decision === 'approve'));
  }

  /** D8: { none, stale? } | { concern } | { error }. Containment first (a symlink is resolved before anything is
   *  trusted), then freshness of the REAL file, then the contract. */
  async _readPlanConcern(file, sinceMs) {
    const real = await realpath(file).catch(() => null);
    if (!real) return { none: true };                           // not written (or a dangling link)
    const root = await realpath(this.pipeline.dir).catch(() => null);
    if (!root || !real.startsWith(root + sep)) return { error: 'outside the pipeline dir' };
    const st = await stat(real).catch(() => null);
    if (!st || (Number.isFinite(sinceMs) && st.mtimeMs < sinceMs)) return { none: true, stale: Boolean(st) };
    let raw;
    try { raw = JSON.parse(await readFile(real, 'utf8')); } catch (err) { return { error: `unreadable: ${err?.message || err}` }; }
    const n = normalizePlanConcern(raw);
    return n.ok ? { concern: n.concern } : { error: n.error };
  }

  /** #990 s5: the implementer said the plan's design is wrong. Re-raise the plan approval (kind 'plan', a `concern`
   *  field): Ask for changes (revise) rewinds to the Planner (D4); Approve builds as written (D5). A concern always
   *  stops (D7); --yes overrides it without an ask (D6), and Away mode approves the ask and flags it (planRule). */
  async _planConcernLoop(nc, ctx, result) {
    const pc = ctx.planConcern;
    if (!pc || result?.paused || result?.error) return result;
    const label = nc.meta?.displayName || nc.key || ctx.nodeId;
    const id = planConcernAskId(ctx);
    const read = await this._readPlanConcern(pc.file, ctx.startedMs);
    // A resumed execution gets a new startedMs and its resumed session need not write the file again: the concern
    // read before the pause is carried in the resume point (D9).
    const held = read.none && this._planConcernHeld?.id === id ? this._planConcernHeld.concern : null;
    if (read.none && !held) {
      if (read.stale) this._log('orchestrator', 'info', `${label}: ${pc.file} predates this execution — not read`);
      return result;
    }
    if (!held && !read.concern) {
      await appendAudit(this.pipeline.dir, `${label}: plan-concern.json ignored (${read.error}).`).catch(() => {});
      return result;
    }
    const concern = held || read.concern;
    this._planConcernHeld = { id, concern };         // before any await: the pause window (graph-ask-kind-traps)
    const planFile = ctx.bindings?.plan?.path ?? null;
    const round = this._graphSnapshot?.approvalRounds?.[pc.approvalNodeId] || 1;
    if (!this._planConcernSeen[id]) {                // a resumed execution raises the same id again: audit it once
      this._planConcernSeen[id] = 'raised';
      await appendAudit(this.pipeline.dir, `${label} raised a plan concern: "${concern.title}".`).catch(() => {});
    }
    const decided = this._planConcernSeen[id] === 'decided';
    // Small runs C3 (D4): a marked run settles a first plain concern (the Planner re-plans with it); a second one from
    // this node after an earlier was decided, or a requirement concern, is a stop.
    const marked = this._smallRunsMarked && !this.auto;
    const prefix = `plan-concern-${ctx.nodeId}-`;
    const decidedBefore = Object.entries(this._planConcernSeen).some(([k, v]) => k !== id && k.startsWith(prefix) && v === 'decided');
    const stop = marked ? concernStop({ run: this._stopRun(), concern, nodeId: ctx.nodeId, decidedBefore }) : null;
    let payload;
    if (this.auto) {
      payload = { decision: 'approve' };
      if (!decided) await appendAudit(this.pipeline.dir,
        `Plan concern overridden automatically (--yes): "${concern.title}". ${label} builds the plan as written.`).catch(() => {});
    } else if (this._planConcernAnswer?.id === id) {
      payload = this._planConcernAnswer.payload;     // answered just before a pause (D9): replay, never re-ask
      this._log('orchestrator', 'info', `plan concern ${id}: ${payload?.decision} replayed after a pause`);
    } else if (marked && !stop) {
      payload = { decision: 'revise', feedback: SETTLED_CONCERN_FEEDBACK };
      this._planConcernAnswer = { id, payload };     // before any await: a resume replays it without a second line
      await appendAudit(this.pipeline.dir, settledLine('concern')).catch(() => {});
    } else {
      this._planConcernAnswer = null;               // a different id: the stash is stale
      const perspectives = this._shapePerspectives();
      payload = await this._enqueueAsk(() => this._ask({
        id, kind: PLAN_ASK_KIND, nodeId: ctx.nodeId, executionId: ctx.executionId, concern, ...(stop ? { stop } : {}),
        plan: { nodeId: pc.approvalNodeId, port: 'plan', file: planFile, round, revisable: true, perspectives },
        validate: (raw) => validatePlanAnswer(raw, { revisable: true, perspectives, smallRuns: this._shapeRec?.smallRuns === true }),
      }));
      this._planConcernAnswer = { id, payload };     // before any await: the pause window (graph-ask-kind-traps)
      if (stop) await this._afterStopAnswer(id, stop, payload);
    }
    this._checkAbort();
    const d = payload?.decision;
    if (d === 'withdrawn' || !d) return result;
    if (d === 'stop') { this.stop(this.answeredBy(id)); this._checkAbort(); return result; }
    this._planConcernSeen[id] = 'decided';
    if (d === 'revise' && payload.source === 'requirement' && stop?.change) this._takeRequirementChange(stop.change);
    if (d === 'revise') {
      const path = join(this.pipeline.dir, `plan-concern-feedback-c${ctx.ordinal}.md`);
      // A stop's Re-plan already carries the concern's section (run-stops.mjs): it is written once.
      const section = concernFeedbackSection(concern);
      await writeFile(path, renderPlanFeedback(payload.feedback, planFile) + (payload.feedback.includes(section.trim()) ? '' : section), 'utf8');
      return { ...result, reviseApproval: { path } };
    }
    ctx.planConcern = null;                          // the re-run cannot raise a second concern (D5)
    ctx.planConcernOverride = concern;
    const step = this.state.steps.find((s) => s.key === ctx.executionId);
    if (step?.sessionId) ctx.resumeSessionId = step.sessionId;
    return this._runNodeAttempts(nc, ctx);
  }

  /** L5: a feature created before a crash, for an outline that was then offered again and not approved. */
  _retireOrphanFeature() {
    try {
      if (retireFeaturesOf(this.pipeline.id, { by: this._runStarter() }) > 0) this._emit('state', this.getState());
    } catch (err) { this._log('orchestrator', 'warn', `slices: cannot retire an earlier feature: ${err?.message || err}`); }
  }

  /** The run's saved PR-when-done decision as the feature keeps it. Read from the row, so a resume and the carried-edits retry see it too. */
  _featurePr() {
    const pa = readRunPrAuto(this.pipeline.id);
    return pa ? { open: pa.open, slices: pa.slices ?? 'each', source: pa.source } : null;
  }

  /** F37: who started this run. A resumed orchestrator has no opts.startedBy (ui/server.mjs:4333-4340); the harness
   *  reads the pipelines row first, the same way it does at run-harness.mjs:1711, 2169. */
  _runStarter() {
    return this.resumeOpts?.row?.started_by ?? this.opts.startedBy ?? null;
  }

  /** Resume the Planner's session with the decision (F2: the prompt is rebuilt from ctx on every spawn). */
  async _resumeOutline(nc, ctx, payload, { baseline } = {}) {
    const d = payload?.decision;
    // D9: the outline file stays for the Planner to edit; the asked round's shas tell an edit from an untouched file.
    // B4: an internal refine (no person round yet) passes the shas it was asked about.
    if (d === 'revise') ctx.shapeSlicing.baseline = baseline !== undefined ? baseline : this._outlineBaseline();
    else { ctx.shapeSlicing = null; this._slicingDone = true; this._outlineRevise = null; }
    if (this._unslicedReplan()) {                           // this execution was bound before the decision
      const { requirements, ...bindings } = ctx.bindings || {};
      Object.assign(ctx, { bindings, shapeAgreedIds: [] });
    }
    ctx.shapeOutlineNote = d === 'flat' ? { decision: 'flat' } : d === 'revise' ? { decision: 'revise', feedback: payload.feedback } : null;
    if (d === 'approve') ctx.shapeSliceScope = await this._shapeSliceScope();
    const step = this.state.steps.find((s) => s.key === ctx.executionId);
    if (step?.sessionId) ctx.resumeSessionId = step.sessionId;
    return this._runNodeAttempts(nc, ctx);
  }

  /** B4 (D10): the Split's challenge loop, its state in `state.shaping.outline.challenge`, persisted after each step.
   *  No plan role-review node in the workflow: the loop is skipped and audited. Returns the last refine's result. */
  async _splitChallenge(nc, ctx, file) {
    const o = this.state.shaping.outline || (this.state.shaping.outline = { rounds: [], decided: null });
    const challenge = o.challenge || (o.challenge = { rounds: [], refining: null, done: false });
    const node = planReviewNode(this.resolved?.template);
    if (!node) {
      challenge.done = true;
      await appendAudit(this.pipeline.dir, 'Split not challenged: this workflow has no plan review step.').catch(() => {});
      await this._persist();
      return { flat: false, result: null };
    }
    const plan = splitChallengePlan(this._shapeRec?.care?.position, { picked: this._runPickedRoles() || [], lead: this.runShape?.lead || null });
    return runSplitChallenge({
      plan, challenge,
      spawn: (r, prior) => this._challengeSplit(node, ctx, r, plan, prior),
      resume: async (feedback) => {
        const baseline = { sha: await fileSha(file), planSha: await fileSha(planOutputOf(ctx.outputs)) };
        const result = await this._resumeOutline(nc, ctx, { decision: 'revise', feedback }, { baseline });
        return { flat: result?.outlineState === 'flat', result };
      },
      persist: () => this._persist(),
      audit: (text) => appendAudit(this.pipeline.dir, text).catch(() => {}),
    });
  }

  /** B4 (D8): one challenge round: ONE spawn of the plan role-review node's agent and model, as a non-task slice under
   *  the Planner's execution. Its config loses `roleReview` (no verdict brief) and gains the challenge block as
   *  promptHints; `nc.meta` is never written. The one output is split-challenge-r.json in the pipeline dir. */
  async _challengeSplit(roleNode, ctx, r, plan, prior) {
    const out = join(this.pipeline.dir, `split-challenge-${r}.json`);
    const brief = challengeBlock({ file: ctx.shapeSlicing?.file || join(this.pipeline.dir, OUTLINE_FILE), out,
      requirements: ctx.bindings?.requirements?.path || null, round: r, roles: plan.roles, challenger: plan.challenger, prior });
    const labels = [...plan.roles.map((k) => perspectiveByKey(k)?.label || k), ...(plan.challenger ? [CHALLENGER_LABEL] : [])];
    const raw = await this._spawnSliceAgent({ roleNode, parentExecutionId: ctx.executionId, ordinal: r, taskId: `split-challenge-${r}`,
      brief, out, auditLine: (model) => `Split challenge round ${r}: ${labels.join(', ')} on ${model}.` });
    return normalizeChallenge(raw, { roles: plan.roles, challenger: plan.challenger });
  }

  /** B4 (D8), C1 (D8): ONE spawn of `roleNode`'s agent and model as a non-task slice `taskId` under the execution
   *  `parentExecutionId`, with `brief` as its promptHints and no verdict (its config loses `roleReview`; `nc.meta` is
   *  never written), so it routes no wire. Its one output is the JSON file `out`, read back (null when missing, too
   *  big or not JSON). */
  async _spawnSliceAgent({ roleNode, parentExecutionId, ordinal, taskId, brief, out, auditLine }) {
    const nc = (this.resolved.nodeCtx || {})[roleNode.id] || { nodeId: roleNode.id, kind: roleNode.kind, key: roleNode.key };
    await rm(out, { force: true });
    const { roleReview: _drop, ...rest } = roleNode.config || {};
    const node = { ...roleNode, config: { ...rest, promptHints: brief } };
    const c = this._execCtx(node, nc, { executionId: sliceExecutionId(parentExecutionId, taskId), ordinal,
      slice: { id: taskId }, parentExecutionId, bindings: {} });
    c.ports = { ...(c.ports || {}), inputs: [], outputs: [] };
    c.outputs = {};
    c.verdict = null;
    await appendAudit(this.pipeline.dir, auditLine(c.claudeOpts?.model || 'the default model')).catch(() => {});
    const result = await this._runNodeAttempts(nc, c);
    await this._afterExecution(nc, c, result);
    let raw = null;
    try { if ((await stat(out)).size <= CHALLENGE_FILE_MAX_BYTES) raw = JSON.parse(await readFile(out, 'utf8')); } catch { raw = null; }
    return raw;
  }

  /** B4: what the Split ask adds under the marker (split-step.mjs splitAskFields); the agreed list is the requirements
   *  input's. */
  async _splitAskFields(ctx) {
    const path = ctx.bindings?.requirements?.path;
    const text = path ? await readFile(path, 'utf8').catch(() => '') : '';
    return splitAskFields({ position: this._shapeRec?.care?.position, picked: this._runPickedRoles() || [], lead: this.runShape?.lead || null,
      agreed: criteriaList(text), examples: criteriaExamples(text), challenge: this.state.shaping?.outline?.challenge,
      roleOf: (id) => perspectiveByKey(criterionPerspective(id, { smallRuns: true }))?.label || null });
  }

  /** L6: what a slice ticket's request copies from this run (F11). `sliceRequest` moves `model` into
   *  `request.internal`, where a fired ticket's model is read (F24). Effort has no /api/run field. */
  _sliceRequestBase() {
    const engine = this.claude.engine;
    return {
      ...(this.guardrailsId ? { guardrailsId: this.guardrailsId } : {}),
      ...(this.claude.model ? { model: this.claude.model } : {}),
      ...(engine && engine !== 'claude' ? { engine } : {}),
      ...(this.claude.mock ? { mock: true } : {}),
      ...(this._night.optIn ? { nightMode: true } : {}),      // the run's mark; "Never on this run" stays on its one run
    };
  }

  _shapingOutlineRound({ round, outline, check, sha = null, planSha = null }) {
    const s = this.state.shaping;
    if (!s) return;
    const o = s.outline || (s.outline = { rounds: [], decided: null });
    const row = { round, count: outline.slices.length, passed: check.passed, total: check.total, decision: null, sha, planSha };
    const i = o.rounds.findIndex((r) => r.round === round);
    if (i >= 0) o.rounds[i] = row; else o.rounds.push(row);
    this._emit('state', this.getState());
  }

  /** D9: the last asked round's outline and plan shas (the revise baseline), or null before any round. */
  _outlineBaseline() {
    const last = this.state.shaping?.outline?.rounds?.at(-1);
    return last ? { sha: last.sha ?? null, planSha: last.planSha ?? null } : null;
  }

  _shapingOutlineDecision(round, payload) {
    const s = this.state.shaping;
    if (!s) return;
    const o = s.outline || (s.outline = { rounds: [], decided: null });
    const row = round == null ? null : o.rounds.find((r) => r.round === round);
    const d = payload?.decision;
    if (row) {
      row.decision = d;
      if (d === 'revise') row.feedback = String(payload.feedback || '').slice(0, SHAPING_FEEDBACK_PREVIEW);
    }
    if (d === 'approve' || d === 'flat') o.decided = d;
    this._emit('state', this.getState());
  }

  /** Spec D7: the approved plan's checklist items for a shaped run's reviewer. Cached per plan file; a resume
   *  reads it again. A read failure is logged and gives [] (nothing to check), and is not cached. */
  async _reviewChecklistItems(ctx) {
    const file = this.state.shaping?.approved?.file || ctx.bindings?.plan?.path || null;
    if (!file) return [];
    if (this._checklistCache?.file === file) return this._checklistCache.items;
    try {
      const items = extractChecklist(await readFile(file, 'utf8'));
      this._checklistCache = { file, items };
      return items;
    } catch (err) {
      this._log('orchestrator', 'warn', `checklist: cannot read the approved plan ${file}: ${err?.message || err}`);
      return [];
    }
  }

  /** Spec D7: merge the plan's items into the verdict before it is routed, gated and stored. Without items, a
   *  reviewer-sent `checklist` is dropped, so runs without one store exactly what they did. */
  async _applyReviewChecklist(ctx, result) {
    const v = result?.verdict;
    if (!v) return result;
    const items = Array.isArray(ctx.checklistItems) ? ctx.checklistItems : [];
    if (!items.length) {
      if (!Object.hasOwn(v, 'checklist')) return result;
      const { checklist, ...rest } = v;   // eslint-disable-line no-unused-vars
      return { ...result, verdict: rest };
    }
    // A verifier that wrote no verdict omitted the checklist too: one major, and the row is stored.
    const base = v.missing ? { issues: [], summary: v.summary || '' } : v;
    const verdict = applyChecklist(base, items);
    const added = verdict.issues.slice(base.issues.length);
    if (added.length) await this._writeChecklistFindings(ctx, added);
    return { ...result, verdict };
  }

  /** The Implementer reads the review Markdown, not the JSON: append the checklist findings, or write a fresh
   *  file when the reviewer wrote none this execution (it judged the diff clean). */
  async _writeChecklistFindings(ctx, issues) {
    const path = ctx.outputs?.review?.path;
    if (!path) return;
    let prev = '';
    try {
      const st = await stat(path);
      if (st.mtimeMs >= (ctx.startedMs || 0)) prev = await readFile(path, 'utf8');
    } catch { /* not written: start a fresh file */ }
    const head = prev ? prev.trimEnd() + '\n\n'
      : `# Implementation Review (cycle ${ctx.ordinal})\n\nThe review found no blocking issue in the diff itself.\n\n`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, head + checklistFindingsMarkdown(issues), 'utf8');
    } catch (err) {
      this._log('orchestrator', 'warn', `checklist: cannot write the findings to ${path}: ${err?.message || err}`);
    }
  }

  /** checkPlan for this run: grounded in the run's checkout; a workspace run skips grounding (paths are per member). */
  async _planCheck(file) {
    try {
      return await checkPlan(file, {
        projectDir: this.isWorkspace ? null : (this.runCwd || this.projectDir),
        // checkShape alone defaults to ['product'], which fails every R-arch/R-qa item.
        perspectives: this.runShape?.perspectives || [...DEFAULT_PERSPECTIVES],
      });
    } catch (err) {
      this._log('orchestrator', 'warn', `shape check failed for ${file}: ${err?.message || err}`);
      return null;
    }
  }

  /** Resolve the queued question, if any, without an answer. Used on End arrival:
   *  a gate ask resolves to `continue` (a no-op — the scheduler already withdrew
   *  it), and a clarify/questions ask resolves to EMPTY answers, which the
   *  clarifier's malformed/empty tolerance turns into a normal publish. */
  _dismissPendingAsk() {
    const pq = this.pendingQuestion;
    if (!pq) return false;
    this.pendingQuestion = null;
    this._log('orchestrator', 'info', `End reached — withdrawing pending ${pq.kind} "${pq.id}"`);
    pq.resolve(pq.kind === 'gate' ? { decision: 'continue' } : pq.kind === PLAN_ASK_KIND ? { decision: 'withdrawn' } : { answers: [] });
    return true;
  }

  // ── execution ──────────────────────────────────────────────────────────────
  /**
   * The scheduler's `execute`. Selection is P3's runExecution: node.kind, then
   * meta.runnerType for agents — never an agent key. Flow cards are instant, $0
   * and spawn nothing; agent cards go through the full attempt/recovery/questions
   * machinery, all of it keyed by executionId.
   */
  async _execute(args) {
    if (this._unslicedReplan() && args.node) {
      const { requirements, ...bindings } = args.bindings || {};
      args = { ...args, node: withoutRequirementsInput(args.node), bindings };
    }
    const node = args.node;
    const nc = (this.resolved.nodeCtx || {})[node.id] || { nodeId: node.id, kind: node.kind, key: null };
    // The composite protocol: these three modes are the process side of a
    // fan-out — they spawn nothing, record no ledger row and allocate nothing,
    // so a composite shell never burns a plan version. Same policy as below: a
    // throw pauses the run. Only the `finish` answer is read as a settlement
    // (settle -> pausedExecution); runComposite ignores an `expand` answer
    // without `phases` (it falls to runUnexpanded) and runPhase ignores the
    // `phase` answers (scheduler.mjs:447/:469), so for those two the pause lands
    // one call later, at the next ordinary execute's _checkPause() — the shell
    // row ends 'paused' either way and the fan-out re-runs on resume (finished tasks skipped).
    if (args.composite) {
      try {
        const role = roleReviewOf(node.config) !== null;
        if (args.composite === 'expand') return await (role ? this._expandRoleReview(node, args) : this._expandDecomposition(node, args));
        if (args.composite === 'phase') return role ? {} : this._compositePhase(args);   // no decomposition phase rows
        return await (role ? this._finishRoleReview(nc, node, args) : this._finishComposite(nc, args));
      } catch (err) {
        return this._settleUnstarted(nc, node, args, err);
      }
    }

    let ctx;
    try {
      ctx = this._execCtx(node, nc, args);
    } catch (err) {
      return this._settleUnstarted(nc, node, args, err);   // allocation failed: no row to mark
    }
    // E10: the CLI version the execution manifest records (Claude's probe, already run at start; null elsewhere).
    if (nc.kind === 'agent' && this._capsProbe) ctx.cliVersion = (await Promise.resolve(this._capsProbe).catch(() => null))?.version ?? null;
    // Small runs C2 (run 1): the Test writer is bound to every agreed requirement; it writes tests for this slice's only.
    if (nc.key === TEST_WRITER_AGENT_KEY && this.runShape && ctx.bindings?.requirements?.path) await this._sliceTestRequirements(ctx);
    // A role slice's brief lists the plan's own items for its role: read the plan this round reviews.
    if (ctx.role) {
      ctx.roleSpec = roleReviewOf(node.config);
      const plan = this._rolePlanBinding(args, ctx.roleSpec);
      ctx.rolePlanText = plan?.path ? await readFile(plan.path, 'utf8').catch(() => '') : '';
      const req = args.bindings?.requirements;
      ctx.roleRequirementsText = req?.path ? await readFile(req.path, 'utf8').catch(() => '') : '';
      if (this.runShape) ctx.roleRequirementsText = this._sliceCriteria(ctx.roleRequirementsText);
      ctx.roleShape = this.runShape || null;
      // Small runs C4 (D9): a marked slice run's reviewers may propose a requirement's new text.
      if (this._smallRunsMarked === true && this.runShape?.slice) ctx.roleProposals = true;
      if (roleChecklistOf(ctx.roleSpec)?.wantsHouseBrief(ctx.role)) ctx.houseBrief = await this._fitHouseBrief();
    }
    await this._humanCursorInit(ctx);
    this._execStep(ctx, 'start');
    let endMark = 'done';
    try {
      // A real DB write — inside the try: a throw here pauses like anything
      // else, and the finally skips updateTaskStatus for a 'paused' mark.
      if (ctx.slice && !ctx.role) updateTaskStatus(this.pipeline.id, ctx.slice.id, 'running', new Date().toISOString());
      // Exactly what v1's dispatcher loop does at every step boundary
      // (orchestrator.mjs:259-261): a stop or pause requested while nothing was
      // in flight (e.g. between executions, or during a flow card) must land
      // here, not on the next spawn.
      this._checkAbort();
      this._checkPause();
      if (!KEYED_KINDS.includes(node.kind)) return await this._runFlow(ctx);
      // A decomposition task records what it changes in the working tree, so a resume can tell whether that work survived the pause.
      const sliceBefore = ctx.slice && !ctx.role ? await this._sliceTrees() : null;
      // P1: a Folder run's cwd is still the run's own copy — a link the agent swapped in would take the engine's
      // per-spawn files (Cursor's .cursor/) and every later node. A throw here pauses the run.
      // P5: a mixed workspace (a git run) checks its Folder members' copies too — fan-out agents work in them.
      if ((this.workMode === 'folder' || this.isWorkspace) && !(await this._folderCopyIntact())) throw new Error(`the run's copy is not the run's own folder: ${(this.isWorkspace && this._badFolderCopy) || this.runCwd}`);
      this._checkCostLimits();                  // budget gate at EVERY spawn (throws pauseErr)
      this._premiumGate(nc, ctx);               // #1450: a premium model nobody chose pauses before the spawn
      if (node.kind === 'script') {
        // A child process through the NODE site: every runner error carries
        // errorClass:null (D9), so _recover lands on the '*' row — pause as
        // REASON.ERROR, resumable, never a "network" retry. No questions, no session.
        let result = await this._runNodeAttempts(nc, ctx);
        result = await this._applyReviewChecklist(ctx, result);   // spec D7: drops a script verdict's `checklist`
        await this._afterExecution(nc, ctx, result);
        return result;
      }
      this._primeQuestions(nc, ctx);
      await this._primeDirections(ctx);
      if (this.runShape && nc.key === CHECKLIST_REVIEWER_KEY) ctx.checklistItems = await this._reviewChecklistItems(ctx);
      if (this.runShape && SLICE_SCOPE_AGENT_KEYS.has(nc.key)) Object.assign(ctx, await this._shapeSliceCtx(nc, ctx));
      if (this.runShape && SLICE_SCOPE_AGENT_KEYS.has(nc.key)) ctx.shapeAgreedIds = await this._shapeAgreedIds(ctx);
      // C1 (D14): every agent node of a run whose slice owns a screen requirement reads the confirmed prototype.
      if (this.runShape?.slice?.outline) { const sp = await this._shapePrototypeCtx(); if (sp) ctx.shapePrototype = sp; }
      ctx.planConcern = this._planConcernCtx(nc, ctx);
      if (ctx.planConcern && this._planConcernOverridden(planConcernAskId(ctx))) {
        ctx.planConcernOverride = this._planConcernHeld.concern;   // paused during the override re-run (D9): resume as it
        ctx.planConcern = null;
      }
      if (this.runShape?.slice?.index > 1 && nc.runnerType === 'clarifier') {
        // D19: slices 2…N plan once: Clarify publishes the feature's answers instead of asking again.
        ctx.carriedClarify = this._featureClarify();
      }
      let result = await this._runNodeAttempts(nc, ctx);
      result = await this._questionsLoop(nc, ctx, result);
      result = await this._outlineLoop(nc, ctx, result);
      // A role slice reports the plan's items too, but they are judged once, on the merged verdict (_finishRoleReview).
      if (!ctx.role) result = await this._applyReviewChecklist(ctx, result);
      result = await this._applyRoleReviewVerdict(ctx, result);
      result = await this._planConcernLoop(nc, ctx, result);
      // Small runs C5 (D9, D14): the Verifier's result, its bound stop and verify-result.json, before the node settles.
      if (this.runShape?.verify && nc.nodeId === 'n_verify') await this._afterVerify(ctx);
      // C5: the verdict the routing reads, as counts, on the execution's latest host dispatch (none when it ran plain).
      this._sessions?.noteVerdict(ctx.executionId, verdictSummary(result?.verdict));
      await this._afterExecution(nc, ctx, result);
      await this._reconcileDirections(ctx);
      if (sliceBefore) result = { ...result, worktree: await this._sliceWorktree(sliceBefore) };
      return result;
    } catch (err) {
      if (isPause(err) || (this.pauseRequested && (isAbort(err) || this.pauseAbort.signal.aborted))) {
        // Settle QUIETLY: the persisted snapshot was frozen the moment pause()
        // was requested, so nothing this publishes can reach it, and the
        // scheduler is already halted — no downstream node can fire off it.
        // P3 protocol: a paused execution answers { paused: true } — the scheduler
        // keeps its row NON-TERMINAL (nothing publishes) and reattach() re-invokes
        // it on resume. `{ outputs: {} }` would COMPLETE it and strand the resume.
        endMark = 'paused';
        return { paused: true };
      }
      if (this.abort.signal.aborted || this.state.status === 'stopped') {
        // The user's stop — the ONLY path that still lets the scheduler see a
        // failure. Its identity is kept for _engineRun's rethrow; the shell's catch
        // classifies the run 'stopped' (status/isAbort), never 'error'. This also
        // covers a child that died with a PLAIN error after the stop landed — that
        // error still gets today's one error-level line (_logStepFailure skips
        // AbortErrors itself).
        endMark = 'stopped';
        this._graphError ||= err;               // preserve identity for the base catch
        this._logStepFailure(nc, ctx, err);
        throw err;
      }
      // The FLOW site (failure-policy.mjs): anything that escaped _runNodeAttempts'
      // own verdict — a flow card, the questions loop, _afterExecution, an
      // unexpected throw — is decided here. A verdict the node site already issued
      // (a terminal error) is enacted, never re-decided.
      const verdict = isTerminal(err) ? { outcome: 'error' }
        : resolveFailure({ site: 'flow', cls: classifyError(err), auto: this.auto });
      if (verdict.outcome === 'pause') {
        // pause() rejects a sibling parked on a recovery prompt with the pause
        // sentinel, so that slice unwinds as paused too.
        this._pauseFor(verdict.reason, err, { nc, ctx });
        endMark = 'paused';
        return { paused: true };
      }
      // Terminal: the scheduler sees the failure (its row ends 'error', in-flight
      // siblings 'skipped') and _engineRun rethrows it for the shell's error path.
      endMark = 'error';
      this._graphError ||= markTerminal(err);   // preserve identity for the base catch
      this._logStepFailure(nc, ctx, err);
      // A sibling slice parked on an interactive recovery prompt is not
      // signal-reachable (_ask settles only via answer()/pause()/stop()), so a
      // genuine slice failure rejects that prompt — the phase is failing and must
      // not wait on a now-meaningless answer.
      if (ctx.slice && this.pendingQuestion?.kind === 'recovery') {
        const pq = this.pendingQuestion;
        this.pendingQuestion = null;
        // Stamped terminal: the released sibling's catch must ENACT this verdict
        // (its row ends 'error' with the phase), never re-decide it at the flow site
        // as a pause with the detail 'aborted'.
        pq.reject(markTerminal(abortError()));
      }
      throw err;
    } finally {
      if (endMark !== 'paused') await this._humanEstimate(ctx);
      this._execStep(ctx, endMark);
      // A PAUSED slice stays 'running': the resume runs it again (only finished
      // tasks are skipped), and a task that never finished must not read as done.
      if (ctx.slice && !ctx.role && endMark !== 'paused') {
        updateTaskStatus(this.pipeline.id, ctx.slice.id, endMark === 'stopped' ? 'error' : endMark, new Date().toISOString());
      }
    }
  }

  /** A throw before the execution had a ledger row (the composite shell modes, or
   *  _execCtx's allocation): the SAME outcomes as _execute's catch, in the same
   *  order and with the same conditions — the FLOW site — just without a row to
   *  mark. args.executionId / args.ordinal exist on every composite call (argsFor,
   *  scheduler.mjs:333-342, is spread into each of them). */
  _settleUnstarted(nc, node, args, err) {
    if (isPause(err) || (this.pauseRequested && (isAbort(err) || this.pauseAbort.signal.aborted))) return { paused: true };
    const ctx = { nodeId: node.id, executionId: args.executionId, ordinal: args.ordinal || 1 };
    if (this.abort.signal.aborted || this.state.status === 'stopped') {
      this._graphError ||= err;                 // the stop keeps its identity for _engineRun's rethrow
      this._logStepFailure(nc, ctx, err);
      throw err;
    }
    const verdict = isTerminal(err) ? { outcome: 'error' }
      : resolveFailure({ site: 'flow', cls: classifyError(err), auto: this.auto });
    if (verdict.outcome === 'pause') {
      this._pauseFor(verdict.reason, err, { nc, ctx });
      return { paused: true };
    }
    this._graphError ||= markTerminal(err);
    this._logStepFailure(nc, ctx, err);
    throw err;
  }

  /** The five flow cards through P3's dispatcher. Engine-owned: instant, $0, no
   *  semaphore slot, no spawn. runExecution reads ctx.taskArtifact (Task card),
   *  ctx.allocatedPath (Combine) and derives Combine's headings from ctx.template. */
  async _runFlow(ctx) {
    return await runExecution({
      ...ctx,
      taskArtifact: this._taskArtifact,
      allocatedPath: ctx.outputs?.out?.path,
    });
  }

  /**
   * The per-execution context. This is the ONE ctx: it carries the phases.mjs
   * prompt fields (projectDir-as-cwd, workspace, toolInstruction, agentPrompts,
   * claudeOpts) AND the graph fields the executors read (ports, meta, bindings,
   * trigger, the allocated outputs/verdict). Allocation happens HERE, once per
   * execution, so a questions resume or a recovery retry never burns a second
   * plan version. It mirrors test/helpers/graph-run.mjs (P3's offline runner).
   */
  _execCtx(node, nc, args) {
    const executionId = args.executionId;
    const ordinal = args.ordinal || 1;
    const slice = args.slice || null;
    const ports = this.resolved.ports(node) || {};
    const runCtx = this._runCtx(nc, slice?.id);
    // A role-review slice runs on its role's pick (role-slots.mjs), else the node's pair.
    const modelPair = slice?.role ? this._rolePair(nc, slice.role) : null;
    const outputs = allocateOutputs({ node, ports, executionId, ordinal, runCtx });
    const verdict = allocateVerdict({ node, ports, ordinal, runCtx });
    // attr.stepKey IS the executionId: that single substitution is what re-keys
    // the whole inherited telemetry block (sub_agents.step_key, step skills,
    // graphify counts, cost) onto executions. stepIndex is null — a graph has
    // executions, not step indexes.
    const attr = {
      nodeId: node.id,
      executionId,
      stepKey: executionId,
      stepIndex: null,
      cycle: ordinal,
      uiPhase: this._uiPhaseOf(node.id),
      // A script has no model: no per-model cost override, no cost-reliability observation.
      // The model the spawn gets (_engineModel drops a Claude model on another engine), so
      // a Claude model's cost override never prices another engine's tokens.
      model: nc.kind === 'script' ? null : (modelPair || this._nodeModelPair(nc)).model,
    };
    const engineOpts = this._engineNodeOpts(nc);
    // P1 (v3, defence in depth): a Folder run's nodes never start on the REAL folder, whatever reattach path left runCwd unset.
    if (this.workMode === 'folder' && !this.runCwd) throw new Error('a Folder run has no copy to work on');
    const { resumeSessionId, coldRedispatch } = this._reattachFor(executionId, node.id);
    // The agent's TMPDIR points here, and a TMPDIR that does not exist fails every tool that reads it.
    const scratch = runScratchDir(this.runRoot);
    if (scratch) mkdirSync(scratch, { recursive: true });
    return {
      // When this execution began. _indexExtraFiles compares it against each
      // candidate's mtime to tell the files this execution WROTE from the ones it
      // merely globbed — the deck ports declare identical globs, so without it
      // whichever node swept last stole every row's attribution.
      startedMs: Date.now(),
      // Consumed as `cwd` by phases.mjs (runOpts). runCwd is the run root on a
      // detached workspace run, the member worktree on a detached single run,
      // today's workDir under legacy.
      projectDir: this.runCwd || this.workDir,
      // The user's own project folder, whose approvals decide the run checkout's committed `.mcp.json` servers on
      // Claude (claude-runner.mjs). A workspace run's cwd is the run root, which has no `.mcp.json` of a member.
      mcpjsonProjectDir: this.isWorkspace ? undefined : this.projectDir,
      runRoot: this.runRoot,
      mcpConfigPath: this.mcpConfigPath,
      // The run's E2B execution environment (script nodes read it here); undefined on local runs.
      execEnv: this.execEnv || undefined,
      mcpServerGrants: this.mcpServerGrants,
      mcpConfigServers: this.mcpConfigServers,
      // MCP registry (design §6.1): the copies' secret env, the values to redact and the tools
      // withheld for the run's tool-name limit. Never persisted anywhere.
      mcpEnv: this.mcpLayer?.env,
      mcpRedact: this.mcpLayer?.redact,
      mcpDisallowed: this.mcpLayer?.disallowed,
      // Workflow tests (D35): a pretend try loads only its mcp.json; a script step learns it runs in a test. 3b (D70): a pretend
      // try's spawns load no user settings either (runOpts: the run's sources minus user, D70a; the sign-in is carried over).
      ...(this._testConnectors() ? { testConnectors: this._testConnectors(), mcpStrict: this._testConnectors() === 'pretend',
        ...(this._testConnectors() === 'pretend' ? { pluginsOff: true } : {}) } : {}),
      // Workflow tests 3a (D56): nothing leaves a try: its spawns carry the hook and the guard env, its script steps the env.
      ...(this._tryGuard() ? { tryGuard: this._tryGuard() } : {}),
      // Skills registry (design §4.3): one --plugin-dir per set plugin of the run; undefined without
      // set skills, [] once the layer is blocked — runOpts emits nothing for either.
      skillPluginDirs: this.skillLayer?.pluginDirs,
      onSkillSideloadRefused: () => this.onSkillSideloadRefused(),
      repos: this._reposCtx(),
      pipelineDir: this.pipeline.dir,
      pipelineId: this.pipeline.id,
      taskPrompt: this.pipeline.promptText,
      toolInstruction: this.toolInstruction,
      shape: this.runShape,
      claudeSettingSources: this._claudeSettingSources(),   // #943 C3: ['project'], or null = every source (opt-in / sign-in)
      // #943: the memory this step loads, for the per-execution manifest: 'frozen' | 'off' | null (a defragment run, a
      // failed mount), and the frozen set ({ set, files }: memory-sync.mjs frozenManifest; role notes carry `roles`).
      memoryMode: this.memoryOff ? 'off' : (this.memory?.manifest ? 'frozen' : null),
      memoryManifest: this.memory?.manifest || null,
      memoryBlock: this._memoryBlockFor(nc.key),        // §4.3: the pointer block, rendered once per mount (names the WRITABLE dirs), + this role's notes (#943)
      memoryMount: this.memory?.mount || null,          // the WRITABLE copy: <pipeline.dir>/memory (agents, the defrag mock and tests write here; runOpts passes it as --add-dir)
      memoryRules: this.memory?.rules || null,          // the read-only rules copy inside the cwd (tests read it; agents never write it)
      memoryLoadLog: this._memoryLoadLogFor(executionId),   // memory usage: this execution's InstructionsLoaded hook file, or null
      agentPrompts: this.agentPrompts,
      checkpointRef: this.checkpointRef,
      workMode: this.workMode,
      workspace: this.isWorkspace ? this._workspaceChannel() : undefined,
      // A composite slice ALSO honors the scheduler's signal, which folds in its
      // phase-local controller: a sibling's failure cancels it (v1's third
      // signal). An ordinary execution keeps today's two, so the fail-fast blast
      // radius is unchanged.
      signal: slice && args.signal
        ? AbortSignal.any([this.abort.signal, this.pauseAbort.signal, args.signal])
        : AbortSignal.any([this.abort.signal, this.pauseAbort.signal]),
      extras: this.extrasFiles || [],
      // ── graph ──
      node: {
        ...node,
        key: nc.key,
        fanOut: engineOpts.fanOut,
        engine: engineOpts.engine,
        // The workspace directive's per-project dispatch names Claude's Task tool and agent types: on another
        // engine (and on one with no sub-agent tool at all) the agent does that work itself, one unit at a
        // time (executor.mjs#buildAgentPrompt). Research fan-out still runs on Codex (fanOutDirective).
        ...(engineOpts.subagents && engineOpts.engine === 'claude' ? {} : { noSubagents: true }),
        subagentModel: nc.subagentModel || '',
        subagentEffort: nc.subagentEffort || '',
        // Same fallback as claudeOpts.model below: the flag must describe the
        // model the spawn will actually use, global default included. Live
        // catalog on purpose — a resume re-resolves the env the same way. One
        // settings + plugins-lock read per dispatch; never call this per entry.
        endpointRouted: nc.kind === 'agent' ? modelHasBaseUrlRouting((modelPair ? modelPair.model : nc.model) || this.claude.model) : false,
        agentPrompt: nc.agentPrompt,
        tools: nc.tools,               // frontmatter grants MUST be stamped
        promptHints: nc.promptHints || '',
      },
      nodeId: node.id,
      executionId,
      ordinal,
      cycle: ordinal,
      slice,
      role: slice?.role ?? null,            // a role-review slice (spec §3): the perspective it reviews as
      parentExecutionId: args.parentExecutionId ?? null,
      taskIndex: args.taskIndex ?? null,
      taskTotal: args.taskTotal ?? null,
      uiPhase: attr.uiPhase,
      bindings: args.bindings || {},
      trigger: args.trigger || { wireIds: [], freshPorts: [] },
      template: this.resolved.template,   // runExecution derives expandsPort + Combine names from these two
      portsFn: this.resolved.ports,
      ports,
      meta: nc.meta || {},
      outputs,
      verdict,
      runCtx,
      // The script contract (spec §6.1): what script-runner.mjs spawns. Absent on every other kind.
      script: nc.kind === 'script'
        ? { meta: nc.meta, runtime: nc.runtime, file: nc.file, command: nc.command, params: nc.params, paramsPort: nc.paramsPort === true, timeoutMs: nc.timeoutMs, mock: nc.mock }
        : undefined,
      runners: this._runners,             // P3's injection seam (runExecution reads ctx.runners)
      resumeSessionId,
      ...(coldRedispatch ? { coldRedispatch: true } : {}),
      ...this._sessionCtx(node.id, slice),
      ask: (q) => this._enqueueAsk(() => this._ask(q)).then((payload) => {
        // D28: the legacy Clarify questions ask (the one maxQuestions caps); a form ask has no question list
        if (this._shapeRec && q?.kind === 'clarify') {
          const c = clarifyCounts(q.questions, payload);
          this._shapeRec.questions.asked += c.asked;
          this._shapeRec.questions.skipped += c.skipped;
        }
        return payload;
      }),
      // Who answered question `id` (identity.mjs actor; answer() records it) — the clarifier
      // stores it with the answer and audits it.
      answeredBy: (id) => this.answeredBy(id),
      // The night mode decision behind question `id`, or null — stored beside the answer.
      nightDecision: (id) => this.nightDecision(id),
      onEvent: (e) => this._onAgentEvent(nc.key || node.kind, e, attr),
      claudeOpts: {
        bin: this.claude.bin,
        engine: this.claude.engine,
        permissionMode: this.claude.permissionMode,
        ...(modelPair || this._nodeModelPair(nc)),
        ...this._modelGuardOpts(nc, node, executionId, modelPair, slice),
        permissionRules: this._spawnPermissionRules(),
        envScrub: this.guardrails?.envScrub || undefined,
        // §5.5.1: a scrubbed spawn with a registry stdio copy keeps the launcher's keep-list.
        envAllowlist: this.guardrails?.envScrub
          ? (this.mcpLayer?.allowlist?.length ? [...this.guardrails.envAllowlist, ...this.mcpLayer.allowlist] : this.guardrails.envAllowlist)
          : undefined,
        mock: this.claude.mock,
        execEnv: this.execEnv || undefined,
      },
    };
  }

  /** #1450 D-m: the [init] model guard (graph/executor.mjs) for a Claude agent node that does not run on a session host
   *  (a member's synthetic init carries its definition's model and would false-pause). `confirmed` is the run's live list. */
  _modelGuardOpts(nc, node, executionId, modelPair, slice = null) {
    if (nc.kind !== 'agent' || (this.claude.engine || 'claude') !== 'claude') return {};
    if (this._sessions?.hostFor(node.id, { slice, role: slice?.role ?? null })) return {};
    const pair = modelPair || this._nodeModelPair(nc);
    return { modelGuard: {
      requested: pair.model || undefined,
      source: pair.source || nc.modelSource,
      step: nc.meta?.displayName || nc.key || node.id, nodeId: node.id, stepKey: executionId,
      confirmed: this._confirmedModels,
      premium: (id) => isPremiumModel(id, { costOf: (m) => modelCostConfig(m) }),
      routed: (id) => modelHasBaseUrlRouting(id) || !!bridgedModelInfo(id),
    } };
  }

  /** Session groups (Task 45): a member's host and its mode for `_execCtx`, on a run that has sessions only (an ungrouped
   *  ctx is unchanged). A ×N slice and a role-review slice never go through a host (D2). */
  _sessionCtx(nodeId, slice) {
    if (!this._sessions) return {};
    const sessionHost = this._sessions.hostFor(nodeId, { slice, role: slice?.role ?? null }) ?? null;
    return { sessionHost, sessionMode: sessionHost?.mode ?? null };
  }

  /** The allocation context of one execution. `_execCtx` and `_finishRoleReview` share it, so a role reviewer's
   *  verdict is read back from exactly the path its slice was handed. */
  _runCtx(nc, sliceId) {
    return {
      pipelineDir: this.pipeline.dir,
      projectDir: this.projectDir,
      baseName: this.baseName,
      datePrefix: this.planDatePrefix,
      workspaceKey: this.workspaceKey || undefined,
      duplicateKey: !!nc.duplicateKey,
      // Composite slices share their parent's ordinal, so their run-store outputs
      // and verdict are additionally slice-prefixed (the executor's dupPrefix
      // reads runCtx.slice as a STRING).
      slice: sliceId || undefined,
      planVersion: () => (this._planVersion += 1),
      // ONE object for the whole run, shared by every execution's runCtx: where the clarifier
      // parks a typed `secret` form field (memory only) and the script runner reads it back.
      secretEnv: this._secretEnv,
      // S52: a non-git run's plans and reviews live under its stored key (members[0].projectKey), which can differ
      // from projectKey(projectDir) (a key registered while git worked, P3's NO_PROJECT_KEY). Git runs: unchanged.
      ...(this.workMode !== 'git' && !this.isWorkspace ? { storeKey: this.members[0].projectKey } : {}),
    };
  }

  /**
   * C42 (critique M-13): the one-shot re-attach for `_execCtx`, aware of session hosts. A paused row whose session id is a
   * host transcript (its `step.session.hostSessionId`, or a host id the restored snapshots name: read even under the
   * kill switch) re-attaches only when its session's host is live in a session mode on this run. Otherwise it starts
   * fresh and cold (`coldRedispatch` → COLD_REDISPATCH_HEADER), never `--resume <host>` as a plain spawn. A degraded
   * member's own plain session stays its own (C30: its plain run may resume it). Every other row re-attaches as today.
   * @returns {{ resumeSessionId: string|undefined, coldRedispatch: boolean }}
   */
  _reattachFor(executionId, nodeId) {
    const resumeSessionId = this._takeResumeSession(executionId);
    if (!resumeSessionId) return { resumeSessionId, coldRedispatch: false };
    const row = (this.resumeOpts?.steps || []).find((s) => s.key === executionId) || null;
    const hostIds = new Set(Object.values(this._sessionRestore || {}).map((h) => h?.hostSessionId).filter(Boolean));
    const host = this._sessions?.hostFor(nodeId) ?? null;
    if (row?.session?.hostSessionId !== resumeSessionId && !hostIds.has(resumeSessionId)) {
      if (host?.mode === 'separate') host.keepPlainSession(resumeSessionId);   // a member that only ran plain has no step.session
      return { resumeSessionId, coldRedispatch: false };
    }
    if (host && (host.mode === 'subagents' || host.mode === 'shared')) return { resumeSessionId, coldRedispatch: false };
    return { resumeSessionId: undefined, coldRedispatch: true };
  }

  /** Per git member work tree, the tree `git add -A` would stage right now (null where git failed). */
  async _sliceTrees() {
    const trees = {};
    for (const [key, dir] of this.workDirs.entries()) {
      if (this._memberWorkMode(key) !== 'git') continue;
      const ex = await this._addableExcludes(this._excludePathspecs(key), { cwd: dir });
      trees[key] = await worktreeTree((a, o = {}) => this._git(a, { ...o, cwd: dir }), dir, ex);
    }
    return trees;
  }

  /** What a decomposition task changed since `before` (_sliceTrees), per member key: the slice row's `worktree`.
   *  null when a tree could not be read, which makes a resume run the task again. */
  async _sliceWorktree(before) {
    const after = await this._sliceTrees();
    const changes = {};
    for (const [key, from] of Object.entries(before)) {
      const dir = this.workDirs.get(key);
      if (!from || !after[key] || !dir) return null;
      changes[key] = await treeChanges((a, o = {}) => this._git(a, { ...o, cwd: dir }), from, after[key]);
      if (!changes[key]) return null;
    }
    return changes;
  }

  /** Scheduler `sliceWorkKept`: a finished task the resume would skip runs again when its work left the working
   *  tree during the pause (slice-worktree.mjs workLost), or when it has no record of that work. The working tree
   *  is read ONCE, before any task of this attempt runs, so a task re-run here cannot hide a later task's loss. */
  async _sliceWorkKept(row) {
    if (!row?.worktree) return false;
    this._sliceWorkNow ??= this._sliceWorkCheck();
    const check = await this._sliceWorkNow;
    return Boolean(check) && !workLost(row.worktree, check.earlier, check.current);
  }

  async _sliceWorkCheck() {
    const rows = (this._resumeSnapshot?.execs || []).filter((e) => e?.kind === 'task' && e.status === 'done' && e.worktree);
    const earlier = earlierContents(rows);
    const current = new Map();
    for (const [key, paths] of earlier) {
      const dir = this.workDirs.get(key);
      if (!dir) return null;
      const git = (a, o = {}) => this._git(a, { ...o, cwd: dir });
      const tree = await worktreeTree(git, dir, await this._addableExcludes(this._excludePathspecs(key), { cwd: dir }));
      const ids = tree ? await idsAt(git, tree, [...paths.keys()]) : null;
      if (!ids) return null;
      current.set(key, ids);
    }
    return { earlier, current };
  }

  /** ONE-SHOT session re-attach: an executionId is consumed the first time it is
   *  asked for, so a recovery retry or a fix cycle never re-attaches a stale
   *  session. Composite slices are never in the map: one that runs again starts cold. */
  _takeResumeSession(executionId) {
    if (!this._resumeSessions?.has(executionId)) return undefined;
    const id = this._resumeSessions.get(executionId);
    this._resumeSessions.delete(executionId);
    return id;
  }

  /** The manifest node's uiPhase (the shim's phase vocabulary, and the label the
   *  sub-agent records carry). Flow cards report their kind. */
  _uiPhaseOf(nodeId) {
    const n = (this.state.stepper?.graph?.nodes || []).find((x) => x.id === nodeId);
    if (n?.uiPhase) return n.uiPhase;
    const nc = (this.resolved?.nodeCtx || {})[nodeId];
    return nc?.key || nc?.kind || nodeId;
  }

  /**
   * Record/transition ONE execution's ledger row. state.steps[] IS the ledger:
   * key === executionId, phase = agentKey (the legacy column), cycle = ordinal.
   * On 'start' it does NOT pause sibling clocks (concurrent executions are
   * normal); on a terminal marker it folds just this execution's clock.
   */
  _execStep(ctx, status) {
    const key = ctx.executionId;
    const now = new Date().toISOString();
    const terminal = status === 'done' || status === 'error' || status === 'stopped' || status === 'paused';
    let step = this.state.steps.find((s) => s.key === key);
    const reentry = !!step;                 // a retry or a resume re-enters its own row
    if (!step) {
      step = {
        key,
        executionId: key,
        nodeId: ctx.nodeId,
        kind: ctx.slice ? 'task' : 'cycle',
        ordinal: ctx.ordinal,
        cycle: ctx.ordinal,                 // legacy alias the whole UI reads
        agentKey: ctx.node?.kind === 'agent' ? (ctx.node.key ?? null) : null,   // agents only (D17: it must not lie)
        nodeKey: ctx.node?.key ?? null,                                          // every keyed kind
        // #943: the memory this step loaded (the run's frozen set, by sha256), on agent steps only.
        ...(ctx.node?.kind === 'agent' && this._memoryStepRecord(ctx.node.key) ? { memory: this._memoryStepRecord(ctx.node.key) } : {}),
        phase: ctx.node?.key ?? ctx.uiPhase, // legacy column
        stepIndex: null,                    // a graph has executions, not step indexes
        status,
        startedAt: now,
        updatedAt: now,
        endedAt: null,
        activeMs: 0,
        runningSince: null,
        // The firing trigger, taken from the execute args rather than the exec
        // 'start' event: the scheduler emits that event BEFORE it invokes, so the
        // row does not exist yet when the event lands. History labels a loop
        // re-fire `cycle 2 · fix` off this.
        trigger: ctx.trigger || { wireIds: [], freshPorts: [] },
        ...(ctx.slice
          ? { taskId: ctx.slice.id, parentExecutionId: ctx.parentExecutionId ?? null, title: ctx.slice.title ?? null,
              phaseOrdinal: ctx.slice.phase ?? null, taskIndex: ctx.taskIndex ?? null, taskTotal: ctx.taskTotal ?? null }
          : {}),
      };
      this.state.steps.push(step);
    } else {
      // A resumed (re-invoked) or retried execution re-enters its own row.
      step.status = status;
      step.updatedAt = now;
      if (status === 'start') step.endedAt = null;
    }
    if (terminal) step.endedAt = now;
    if (this.telemetry) this.telemetry.stepStatus(key, ctx.nodeId, status);
    // Turns this execution's spawn never closed with a `result` (a pause, a stop, a crash, a retried
    // attempt): counted apart on the row (run-harness _closeOpenTurns). A result already cleared them.
    // At 'start' only on RE-entry (a retry, a resume): a fresh execution has nothing of its own to
    // close, and its bridge tag (a bare execution id) may hold another live run's in-flight spend.
    if (terminal || (status === 'start' && reentry)) this._closeOpenTurns(key);
    if (terminal && ctx.human) {
      step.humanHours = ctx.human.hours;
      step.humanSignals = ctx.human.signals;
    }
    if (terminal) this.state.humanHours = sumStepHours(this.state.steps);
    if (status === 'start') this._clockResume(key);
    else this._clockPause(key);
    this.state.totalActiveMs = sumStepActive(this.state.steps);
    // The harness-local scalars mirror the LAST-STARTED execution: _recordCost
    // falls back to them when an event carries no stepKey.
    if (status === 'start') {
      this.state.phase = ctx.uiPhase;
      this.state.cycle = ctx.ordinal;
    }
    this.state.updatedAt = now;
    // Backstop: on a terminal marker force-close any sub-agent still 'running'
    // for THIS execution so the UI never shows a stuck-active square.
    if (terminal) {
      const closeTo = (this.state.status === 'stopped' || this.state.status === 'pausing') ? 'stopped' : 'finished';
      for (const rec of this.state.subAgents) {
        if (rec.stepKey !== key || rec.status !== 'running') continue;
        rec.status = closeTo;
        rec.finishedAt = new Date().toISOString();
        this._upsertSubAgent(rec);
        this._subAgentTransition('finish', rec);
      }
      // Its stream has ended: drop the normalizer its legacy envelopes went through.
      this._legacyNormalizers.delete(key);
    }
    this._emit('state', this.getState());
    this._persist().catch(() => {});
  }

  /** Intent-to-add every member worktree, then measure. A NEW file is invisible to
   *  `git diff <checkpoint>` until `git add -N` has seen it (the harness stages the same
   *  way before a review); ignoreAbort so the stopped path still measures. A diff base may move to git's own merge or
   *  rebase first (_refreshMergeBases), so the cursor, results.json and the live diff share one base. Never throws. */
  async _humanMeasure() {
    try {
      await this._refreshMergeBases();
      return await measureCodeCursor({
        workDirs: this.workDirs, checkpointRefs: this.checkpointRefs,
        excludeFor: (k) => this._excludePathspecs(k),
        // Workflow tests 3a (final review I2): a try's measure runs no fsmonitor of the copy, under the guard.
        numstat: (d, b, h, p) => diffNumstat(d, b, h, p, this._tryGitEnv() ? { env: this._tryGitEnv() } : {}),
        stage: () => this._stageWorkingTree({ ignoreAbort: true, refreshFolders: false }),
      });
    } catch { return null; }
  }

  /** The baseline at the FIRST agent/script start of a run: under legacy run-root mode the
   *  checkout may already be dirty, and that dirt is not the run's work. A resume restores
   *  the cursor from the resume point instead, so the paused execution's pre-pause work
   *  is credited at its real terminal. Queued, so it lands before any estimate. */
  _humanCursorInit(ctx) {
    const kind = ctx?.node?.kind;
    if (this._humanCursorReady || (kind !== 'agent' && kind !== 'script')) return Promise.resolve();
    this._humanCursorReady = true;
    return this._humanRun(async () => {
      this._humanCursor = await this._humanMeasure();
      this._baseMovedSinceCursor = null;                 // the baseline is measured against the current base
    }).catch(() => {});
  }

  /** Evidence → hours for ONE terminal execution, serialized with every other measurement of
   *  this run. Never rejects. Flow cards and scripts leave ctx.human null (their row stays
   *  NULL: "not estimated" is not 0); a script still advances the baseline so its own file
   *  changes are never credited to the next agent. */
  _humanEstimate(ctx) {
    ctx.human = null;
    const kind = ctx?.node?.kind;
    if (kind !== 'agent' && kind !== 'script') return Promise.resolve();
    return this._humanRun(async () => {
      const cursorPrev = this._humanCursor;
      const measured = await this._humanMeasure();
      if (measured) this._humanCursor = measured;
      // D9: a member whose diff base moved since the previous cursor (a base-branch merge or rebase) has a previous
      // count against another base: credit that member from zero, every other member from its previous count.
      const moved = this._baseMovedSinceCursor;
      this._baseMovedSinceCursor = null;
      if (kind !== 'agent') return;
      const evidence = await collectStepEvidence({ ctx, cursorPrev: withoutMembers(cursorPrev, moved),
        cursorNow: measured || cursorPrev });
      const est = estimateStepHours(evidence, resolveConstants(humanEstimateOverrides()));
      ctx.human = { hours: est.hours, signals: { ...est.signals, method: est.method } };
    }).catch(() => { ctx.human = null; });
  }

  /**
   * Engine hook (stopPaused): the executions a pause parked end for good at the stop. A pause
   * skips their estimate (_execute's finally) because the resume credits it at their real
   * terminal, from the cursor the resume point carries, and a stop is that terminal. Credit the
   * pre-pause work as _execute's finally would have: the code delta since that cursor (the
   * checkouts are re-attached and still live) under the agent's estimate overrides. Their md/json
   * outputs are not read: the process that paused allocated their paths. Never throws.
   * @param {object} rp the resume point
   * @param {Set<string>} keys the ledger keys (execution ids) of the parked executions
   */
  async _engineCreditParked(rp, keys) {
    if (!rp?.humanCursor) return;   // no agent or script ever started: nothing was parked mid-work
    let nodes;
    try { nodes = resolvedFromManifest(rp.manifest || this.state.stepper, this.registry || loadAgentRegistry(this.agentsDir)).nodes; } catch { return; }
    this._humanCursor = rp.humanCursor;
    for (const step of this.state.steps || []) {
      const nc = keys.has(step.key) ? nodes[step.nodeId] : null;
      // Agents only: nothing runs after a stop, so a parked script advancing the cursor would only hand the
      // agents' code to an execution that earns no hours (a live stop unwinds the agent first).
      if (!nc || nc.kind !== 'agent') continue;
      // _execute's finally for an agent execution that ends here.
      const ctx = { node: { id: step.nodeId, kind: nc.kind, key: nc.key }, meta: nc.meta || {} };
      await this._humanEstimate(ctx);
      if (ctx.human) { step.humanHours = ctx.human.hours; step.humanSignals = ctx.human.signals; }
    }
    this.state.humanHours = sumStepHours(this.state.steps);
  }

  /** The retry loop around ONE execution — the NODE site of failure-policy.mjs.
   *  _recover() resolves the verdict (running the backoff or the recovery prompt
   *  on the way); this loop enacts it. A pause throws pauseErr() with
   *  pauseRequested already set (_pauseFor calls pause()), so _execute's catch
   *  reproduces the 'paused' mark; a terminal error is stamped so _execute's
   *  catch enacts it instead of re-deciding at the flow site. */
  async _runNodeAttempts(nc, ctx) {
    for (let attempt = 1; ; attempt++) {
      try {
        const out = await this._runOnce(nc, ctx);
        this._networkSettled();
        return out;
      } catch (err) {
        if (this.pauseRequested && (isAbort(err) || isPause(err) || this.pauseAbort.signal.aborted)) throw pauseErr();
        if (isAbort(err) || isPause(err)) throw err;
        if (this.abort.signal.aborted || this.state.status === 'stopped') throw err;  // a stop is in flight: _execute marks it 'stopped'
        // A lost E2B sandbox or a sandbox change that cannot reach the host: no retry, recovery prompt or pause
        // can fix it, and the Q&A wants a clean failure (plans/e2b-execution-design.md §10). Never on a local run.
        if (isExecEnvFatal(err)) throw markTerminal(err);
        const cls = classifyError(err);
        const verdict = await this._recover({ node: { key: nc.key || ctx.nodeId }, cls, err, attempt,
          model: nc.kind === 'agent' ? (ctx.claudeOpts?.model ?? null) : null });
        if (this.pauseRequested) throw pauseErr();          // a pause landed during backoff/prompt: its reason stands
        if (this.abort.signal.aborted || this.state.status === 'stopped') throw err;   // a stop landed during the network wait
        // Back to running for the retry; the network came back → a fresh retry budget.
        if (verdict.outcome === 'retry') { if (verdict.reset) attempt = 0; this._execStep(ctx, 'start'); continue; }
        if (verdict.outcome === 'pause') { this._pauseFor(verdict.reason, err, { nc, ctx, cls }); throw pauseErr(); }
        throw markTerminal(err);                           // terminal: _execute's catch ends the run
      }
    }
  }

  /** One invocation of this execution's executor. In e2b mode the sync itself runs inside each spawn
   *  (RemoteChild / runInProcess); here the node's bound inputs are registered with the sandbox, and a
   *  fatal exec-env failure replaces whatever the executor threw (spawnFailure rebuilds the error). */
  async _runOnce(nc, ctx) {
    const ee = this.execEnv;
    if (!ee) return this._runOnceLocal(nc, ctx);
    ee.addInputs(Object.values(ctx.bindings || {}).map((t) => t?.path));   // scheduler tokens (scheduler.mjs)
    let result;
    try { result = await this._runOnceLocal(nc, ctx); }
    catch (err) { const fatal = ee.fatalError(); throw fatal ? markTerminal(fatal) : err; }
    const fatal = ee.fatalError();
    if (fatal) throw markTerminal(fatal);
    return result;
  }

  /** One invocation of this execution's executor (P3's runExecution, with the
   *  injected runners as the seam), plus the vanished-session fresh re-run
   *  fallback (a dead `--resume` session must not fail the run) — never after a
   *  fatal exec-env failure, which no fresh run can fix. */
  async _runOnceLocal(nc, ctx) {
    // C29: the fallback re-runs fresh an attempt that --resumed a session that is gone, decided BEFORE it runs: never a hosted
    // one (a host that degrades during the attempt still owned it), and a degraded session's plain run only when it resumes the
    // member's own plain session (C30): a host id it was handed is dropped by the plain run, so nothing was resumed.
    const h = ctx.sessionHost;
    const resumes = !h || (h.mode === 'separate' && h.resumesPlain?.(ctx.resumeSessionId) === true);
    try {
      return await runExecution(ctx, { runners: this._runners });
    } catch (err) {
      // C29 (critique C-1): never for a hosted execution. The SessionHost owns a vanished host (C20); any other failure of
      // a re-dispatch goes to _recover like any failure, keeping resumeSessionId (and so the cold header) for its retry.
      if (ctx.resumeSessionId && resumes && !this.execEnv?.fatalError() && !isAbort(err) && !isPause(err) && !this.pauseRequested) {
        this._log(nc.key || ctx.nodeId, 'warn',
          `session resume failed (${err?.message || err}); re-running the execution fresh`,
          { nodeId: ctx.nodeId, executionId: ctx.executionId, cycle: ctx.ordinal, ...(err?.stream ? { stream: err.stream } : {}) });
        await appendAudit(this.pipeline.dir, `Resume fallback: ${ctx.executionId} re-ran fresh (session resume failed).`).catch(() => {});
        ctx.resumeSessionId = undefined;
        return await runExecution(ctx, { runners: this._runners });
      }
      throw err;
    }
  }

  /** The ONE `error`-level line for a terminally failed execution. A pause/abort
   *  is not a failure, and a recoverable error that retried logged its own warn. */
  _logStepFailure(nc, ctx, err) {
    if (isAbort(err) || isPause(err)) return;
    this._log(nc.key || ctx.nodeId, 'error', `execution failed: ${clipMiddle(err?.message || err, 500)}`, {
      nodeId: ctx.nodeId, executionId: ctx.executionId, cycle: ctx.ordinal,
      ...(err?.stream ? { stream: err.stream } : {}),
    });
  }

  /**
   * Everything between an agent returning and the scheduler publishing its tokens:
   *  - the verdict lands in the AUTHORITATIVE reviews table, keyed by the generic
   *    filename-derived kind;
   *  - ONE `artifact` per DISTINCT allocated output path (the refiner's plan and
   *    revise ports resolve to the same file — that is one artifact, not two);
   *  - a `sideEffect: 'code'` node stages its working tree so the next node's
   *    `git diff` sees newly created files. A composite SLICE skips that: its
   *    phase-mates edit the same tree in parallel and the composite stages once
   *    after the last phase (_finishComposite).
   */
  async _afterExecution(nc, ctx, result) {
    this._autoLimitResumes = 0;   // D7: real progress ends an automatic-resume streak
    // `missing` = the verifier never wrote its verdict (MAJ-10). Persisting that as
    // a zero-issue row makes History render a genuine-looking clean review of work
    // nobody reviewed, so the row is SKIPPED; the run log + state.warnings carry it.
    if (this.pipeline && ctx.verdict?.path && result?.verdict && !result.verdict.missing) {
      await this._recordReview(nc, { id: ctx.nodeId }, ctx.ordinal, result.verdict, this._verdictKind(nc, ctx));
    }
    const seen = new Set();
    for (const port of ctx.ports?.outputs || []) {
      const path = ctx.outputs?.[port?.id]?.path;
      if (!path || seen.has(path)) continue;
      seen.add(path);
      // A path was ALLOCATED for every port carrying a `filename` — including the
      // `when: "blocking"` ones (deckAudit.findings, deckExport.findings, every
      // reviewer.review) — and a clean verdict leaves those unwritten. Indexing
      // on allocation alone put rows in the Artifacts tab that render `0 B` and
      // 404 when clicked, and that list_run_artifacts hands the model for
      // read_run_artifact to fail on. Index what the agent actually wrote.
      try { await access(path); } catch { continue; }
      this._artifact(port.artifactKind || port.id, path, {
        nodeId: ctx.nodeId, executionId: ctx.executionId, port: port.id, cycle: ctx.ordinal,
      });
    }
    // Before the script early-return: `extraFiles` is declared on an output PORT and
    // readOutputs is shared by both sidecars, so a script card that ships files beside
    // its output (the deck bundler's single-file deliverable) gets them indexed like
    // an agent's.
    for (const port of ctx.ports?.outputs || []) {
      if (Array.isArray(port?.extraFiles) && port.extraFiles.length) await this._indexExtraFiles(ctx, port);
    }
    if (nc.kind === 'script') {
      // The envelope audit copy is an artifact under scripts/ (§6.5); the row gets the runtime facts (D17).
      if (result?.envelopePath) {
        this._artifact('envelope', result.envelopePath, { nodeId: ctx.nodeId, executionId: ctx.executionId, port: null, cycle: ctx.ordinal });
      }
      const step = this.state.steps.find((s) => s.key === ctx.executionId);
      if (step) {
        step.runtime = result?.runtime ?? nc.runtime ?? null;
        step.exitCode = result?.exitCode ?? null;
      }
      return;                                    // no memory sync, no worktree staging
    }
    // Agent memory (§5): sync the mount back after EVERY execution, slices included.
    await this._syncMemory(nc, ctx);
    if (nc.meta?.sideEffect === 'code' && !ctx.slice) {
      await this._stageWorkingTree();
      // The sandbox's own index in step (same pathspecs): the next node's `git diff` there sees new files.
      if (this.execEnv) await this.execEnv.stageAll(this._excludePathspecs(this.members[0].projectKey));
    }
  }

  /** Deterministic delivery: read the inbox at step start and hang the pending
   *  list on ctx (phases.directionsPromptBlock renders it). Slices see them too —
   *  a slice is a real agent that can act on a direction. */
  async _primeDirections(ctx) {
    ctx.directionsPending = [];
    if (!this.pipeline?.dir) return;
    try {
      const parsed = await readDirections(this.pipeline.dir);
      // pendingDirections() is BY DEFINITION the ids with no consumption record,
      // so a `seen` set built from parsed.consumed.keys() is disjoint from it by
      // construction and the de-dup it fed could never fire. Removed rather than
      // left in place reading like a guard that does something.
      ctx.directionsPending = pendingDirections(parsed);
    } catch { /* an unreadable inbox never blocks a step */ }
  }

  /** After the step: log every direction the agent consumed during it. The agent
   *  writes the consumption record (it alone knows which directions were in its
   *  job); the engine makes the delivery deterministic and the ledger visible. */
  async _reconcileDirections(ctx) {
    if (!this.pipeline?.dir || !ctx.directionsPending?.length) return;
    try {
      const parsed = await readDirections(this.pipeline.dir);
      for (const d of ctx.directionsPending) {
        const by = parsed.consumed.get(d.id);
        if (by) {
          this._log('directions', 'info', `direction:applied ${d.id} by ${by[by.length - 1]}`, { nodeId: ctx.nodeId, executionId: ctx.executionId, cycle: ctx.ordinal });
        }
      }
    } catch { /* best effort */ }
  }

  /** Index the files an output port declared as `extraFiles` (agent-meta.mjs):
   *  one-level globs under the pipeline dir, matched by basename, sorted, each
   *  recorded with the entry's `kind`. Best-effort: a missing dir indexes nothing;
   *  a declared-but-unwritten file is not an error (mirrors declared ports).
   *
   *  Entries are FIRST-MATCH-WINS: a file claimed by an earlier entry is skipped
   *  by every later one, so a port can name its deliverables precisely and end
   *  with a catch-all for the rest. That is how the deck ports separate the two
   *  files a human opens from the kit scripts, webfonts and proof copy the deck
   *  merely LOADS — which still have to be indexed, because the raw-bytes route
   *  resolves `rel` only among indexed rows. Without the rule the catch-all would
   *  re-index the deliverables under a second kind and double every row. */
  /** Did THIS execution write the file? mtime at or after the moment the context
   *  was built (immediately before the agent was dispatched). A file the previous
   *  node wrote keeps that node's attribution.
   *
   *  KNOWN LIMIT — coarse mtime granularity. `startedMs` is a wall clock and the
   *  mtime comes from the filesystem, so on a 1-second-granularity volume (HFS+,
   *  FAT, some network mounts) a file this execution genuinely wrote can report an
   *  mtime just BELOW it, and the re-attribution is then skipped: the row keeps the
   *  previous step's stamp. That is the safe direction of the two — the row still
   *  exists and still resolves, it is only labelled with an earlier step — whereas
   *  a tolerance wide enough to cover a second would let a node claim files the
   *  PREVIOUS node wrote, which is the bug this comparison was added to fix
   *  (deckBuilder and deckExport declare identical globs). A same-filesystem marker
   *  written per execution would remove the clock mismatch but not the granularity,
   *  so it trades a silent under-attribution for a silent over-attribution at the
   *  same cost. Left conservative, deliberately. */
  async _writtenDuring(abs, ctx) {
    if (!Number.isFinite(ctx?.startedMs)) return true;     // no stamp: behave as before
    try {
      return (await stat(abs)).mtimeMs >= ctx.startedMs;
    } catch (err) {
      // The name came from a readdir a moment ago, so ENOENT means the file was
      // unlinked in between — and answering "yes, written" would index a row for a
      // file that is gone: the 0-byte row that 404s on click, which
      // forgetMissingArtifacts exists to remove. Any OTHER error is unknown, and
      // there the permissive answer is still the safe one (a missed row breaks the
      // raw-bytes route, which resolves `rel` only among indexed rows).
      if (err && err.code === 'ENOENT') return false;
      return true;
    }
  }

  async _indexExtraFiles(ctx, port) {
    const pdir = this.pipeline?.dir;
    if (!pdir) return;
    const claimed = new Set();
    const known = new Map();                               // dir -> already-indexed basenames
    for (const { kind, glob } of port.extraFiles) {
      const [dir, pattern] = glob.split('/');
      const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      let names = [];
      try { names = (await readdir(join(pdir, dir), { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name); } catch { continue; }
      // Drop rows for files this directory no longer holds. The audit deletes and
      // recreates shots/ every cycle, so a fix cycle that cuts a slide otherwise
      // leaves the dropped slide's screenshot indexed forever — a 0 B row that
      // 404s. Keyed on the listing, so a second port sweeping the same directory
      // computes the same answer.
      // Tell an open browser what went. The client artifact list only ever grew,
      // so a pruned shot kept rendering and 404d when clicked — the very failure
      // this prune exists to prevent. Absolute paths, the same shape `artifact`
      // events carry, so the client matches them the same way.
      const gone = forgetMissingArtifacts(this.pipeline.id, dir, new Set(names), pdir);
      if (gone.length) this._emit('artifact-gone', { paths: gone.map((rel) => join(pdir, rel)) });
      // Which of these are already indexed — read ONCE per directory, and only for
      // directories this port actually sweeps.
      if (!known.has(dir)) known.set(dir, indexedNamesUnder(this.pipeline.id, dir));
      const alreadyIndexed = known.get(dir);
      for (const name of names.filter((n) => re.test(n)).sort()) {
        if (claimed.has(`${dir}/${name}`)) continue;
        claimed.add(`${dir}/${name}`);
        // A glob matches whatever is ON DISK, not what this execution produced —
        // and deckBuilder and deckExport declare IDENTICAL globs, so the export
        // sweep re-stamped the builder's deck.html and every kit script onto the
        // export node. Re-attribute only a file this execution actually wrote.
        // An unindexed file is always recorded: nobody else has claimed it, and
        // skipping it on a coarse-grained mtime would lose the row entirely —
        // which the raw-bytes route resolves `rel` against, so it would 404.
        // Per KIND. `alreadyIndexed` maps name -> kinds, because a row is keyed by
        // (kind, rel_path): a file settled under kind A is not settled for kind B,
        // and treating it as such kept the A row forever on a re-kind (a sidecar
        // edit, or a run spanning the V32 deck/deck-asset split).
        const kinds = alreadyIndexed.get(name);
        if (kinds && kinds.has(kind) && !(await this._writtenDuring(join(pdir, dir, name), ctx))) continue;
        // `cycle` matters as much here as on the port's own output: without it
        // every extra file is recorded with cycle null, and artifactsByNodeCycle
        // (`cycle ?? 0`) files them all under a phantom "cycle 0" beside the same
        // node's real cycles in both Artifacts tabs.
        // One kind per file: retire whatever it was indexed as before, or the
        // Artifacts tab and list_run_artifacts show the same file twice.
        if (kinds && [...kinds].some((k) => k !== kind)) {
          // Tell the browser too, exactly as the prune above does: the client's
          // dedupe is kind-scoped, so without this it keeps the superseded row and
          // lists the same file twice. Emitted BEFORE the artifact event below, so
          // the row is dropped and then re-added under its current kind.
          if (forgetOtherKinds(this.pipeline.id, `${dir}/${name}`, kind).length) {
            this._emit('artifact-gone', { paths: [join(pdir, dir, name)] });
          }
        }
        this._artifact(kind, join(pdir, dir, name), {
          nodeId: ctx.nodeId, executionId: ctx.executionId, port: port.id, cycle: ctx.ordinal,
        });
      }
    }
  }

  /** The verdict's `reviews` row and the run progress (P5): the latest pass's blocking count — "Review · 2nd pass,
   *  fixing 2 issues" — and the blockers a refiner fixed in that pass (its `fixed` list), so a pass that fixed them never
   *  reads as zero findings. `kind` defaults to the one a plain execution of the node records. */
  async _recordReview(nc, node, ordinal, verdict, kind = this._plainVerdictKind(nc, node, ordinal)) {
    await writeReview(this.pipeline.id, kind, ordinal, verdict);
    this.state.progressFacts ||= { tasks: {}, reviews: {} };
    const fixed = blockingIssues({ issues: verdict.fixed }).length;
    this.state.progressFacts.reviews[node.id] = { pass: ordinal || 1, blocking: blockingIssues(verdict).length, ...(fixed ? { fixed } : {}) };
  }

  /** The `reviews` kind of the node's own (not a slice's) verdict file. */
  _plainVerdictKind(nc, node, ordinal) {
    const verdict = allocateVerdict({ node, ports: this.resolved.ports(node) || {}, ordinal, runCtx: this._runCtx(nc) });
    return this._verdictKind(nc, { verdict, ordinal });
  }

  /** reviews.kind, derived from the verdict FILENAME minus `-cycle{cycle}.json`
   *  and mapped through artifacts.reviewKindOf (a table: `impl-review`→`impl`,
   *  `plan-review`→`plan`, `refine-review`→`refine`, `ws-review`→`ws`,
   *  `webui-review`→`webui`; an unknown stem passes through unchanged). Zero
   *  agent-key coupling. */
  _verdictKind(nc, ctx) {
    if (ctx.role) return `role-${ctx.role}`;
    const file = String(ctx.verdict?.path || '').split(/[\\/]/).pop() || '';
    const stem = file.replace(`-cycle${ctx.ordinal}.json`, '').replace(/\.json$/, '');
    return (stem && reviewKindOf(stem)) || nc.key || ctx.nodeId;
  }

  /**
   * Prime the ask-then-resume state for ONE execution. The prior-answer filter
   * stays NODE-scoped: keying it by executionId would re-ask every answered
   * question on the next fix cycle, because that cycle is a new execution.
   * Composite slices never gate the user (several run at once, so a question
   * from one would block its phase-mates behind a prompt nobody can attribute);
   * clarifier nodes have their own gate; auto mode would answer noise.
   */
  _primeQuestions(nc, ctx) {
    // --yes blocks agent questions unless night mode owns this run's answers.
    const autoBlocks = this.auto && !this._nightOwnsAuto('questions');
    const enabled = !!nc.askQuestions && nc.runnerType !== 'clarifier' && !autoBlocks && !ctx.slice;
    ctx.questionsEnabled = enabled;
    if (!enabled) return;
    ctx.questionsAnswered = readStepQuestions(this.pipeline.id)
      .filter((r) => r.nodeId === ctx.nodeId)
      .flatMap((r) => r.answers);
    // Spec §4: the forms this agent may ask with (absent for every agent that
    // declares none, which keeps questionsPromptBlock byte-identical), and the
    // form answers already given for this NODE — same node-scoped filter as the
    // legacy answers above, for the same reason (a fix cycle is a new execution).
    ctx.askForms = nc.meta?.ask?.forms || null;
    ctx.formAnswers = readStepQuestions(this.pipeline.id)
      .filter((r) => r.nodeId === ctx.nodeId && r.formAnswer)
      .map((r) => r.formAnswer);
    ctx.questionsFile = this._questionsPath(ctx.nodeId, ctx.ordinal, 1);
  }

  /**
   * Absolute per-round questions file inside the pipeline dir:
   *   questions-x-<nodeIdSafe>-c<ordinal>-r<round>.json
   * `nodeIdSafe` = the node id with every character outside [A-Za-z0-9_-]
   * replaced by `_`, so a hand-authored template id can never escape the dir.
   * (v1's name is questions-<stepIndex>-<nodeIdSafe>-c<cycle>-r<round>.json;
   * test/orchestrator-questions.test.mjs reads the path off ctx.questionsFile
   * and pins the basename this builds.)
   */
  _questionsPath(nodeId, ordinal, round) {
    const nodeIdSafe = String(nodeId).replace(/[^A-Za-z0-9_-]/g, '_');
    return join(this.pipeline.dir, `questions-x-${nodeIdSafe}-c${ordinal}-r${round}.json`);
  }

  /**
   * Gate 2 for a `{form,data}` ask (spec §5). Prepares the ask; on a refusal the
   * agent is resumed ONCE with the exact error list plus the data schema and the
   * SAME round file, and its retry is re-read. A second refusal downgrades to one
   * generic free-text question built from the form's title, and the run log says
   * why. Never throws, and never consumes a question round — MAX_QUESTION_ROUNDS
   * still bounds what the USER sees.
   * @returns {Promise<{ask:object|null, autoValues:object|null, questions:Array, result:object|undefined}>}
   */
  async _prepareFormAsk(nc, ctx, first, qPath, round, agentLabel) {
    const attr = { nodeId: ctx.nodeId, executionId: ctx.executionId, cycle: ctx.ordinal };
    let payload = first;
    let result;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const prepared = await prepareFormAsk({
        agentMeta: nc.meta,
        payload: { form: payload.form, data: payload.data },
        cwd: ctx.projectDir,
        pipelineDir: this.pipeline.dir,
        askId: `questions-${ctx.executionId}-r${round}`,
      });
      if (prepared.ok) return { ask: prepared.ask, autoValues: prepared.autoValues, secrets: prepared.secrets || {}, questions: [], result };

      const why = prepared.errors.map((e) => `${e.path ? `${e.path}: ` : ''}${e.message}`).join('; ');
      this._log(agentLabel, 'warn', `form "${payload.form}" was refused: ${why}`, attr);
      await appendAudit(this.pipeline.dir,
        `${agentLabel}: form "${payload.form}" was refused — ${why}`).catch(() => {});
      if (attempt === 2) break;

      // ONE repair round: the errors + the schema, and the SAME file to rewrite.
      ctx.formRepair = {
        form: payload.form,
        errors: prepared.errors,
        schema: nc.meta?.ask?.forms?.[payload.form]?.data || null,
        file: qPath,
      };
      await rm(qPath, { force: true }).catch(() => {});
      const step = this.state.steps.find((s) => s.key === ctx.executionId);
      if (step?.sessionId) ctx.resumeSessionId = step.sessionId;
      try {
        result = await this._runNodeAttempts(nc, ctx);
      } finally {
        ctx.formRepair = null;
      }
      this._checkAbort();
      const retry = await readAskFile(qPath);
      // The agent may give up on the form and write plain questions instead (or
      // write nothing): take whatever it DID write, exactly as a legacy round would.
      if (retry.kind !== 'form') {
        return { ask: null, autoValues: null, questions: retry.kind === 'questions' ? retry.questions : [], result };
      }
      payload = retry;
    }
    const title = nc.meta?.ask?.forms?.[payload.form]?.title || '';
    this._log(agentLabel, 'warn', `form "${payload.form}" downgraded to a free-text question`, attr);
    await appendAudit(this.pipeline.dir,
      `${agentLabel}: form "${payload.form}" downgraded to a free-text question after two refusals.`).catch(() => {});
    return { ask: null, autoValues: null, questions: [downgradeQuestion({ form: payload.form, title })], result };
  }

  /**
   * Ask-then-resume rounds. After a successful execution: if the agent wrote this
   * round's questions file, persist the questions, gate the user (serialized —
   * single pendingQuestion slot), persist the answers BEFORE the resume spawns
   * (crash-safe), then resume the SAME session with the answers injected. The
   * resume goes through _runNodeAttempts, so recovery + the vanished-session
   * fresh re-run apply unchanged. Caps at MAX_QUESTION_ROUNDS; the final resume
   * carries no next-round file so the agent proceeds on assumptions.
   */
  async _questionsLoop(nc, ctx, firstResult) {
    let result = firstResult;
    if (!ctx.questionsEnabled) return result;
    const stepKey = ctx.executionId;           // step_questions.step_key = executionId
    const agentLabel = nc.meta?.displayName || nc.key || ctx.nodeId;
    const attr = { nodeId: ctx.nodeId, executionId: ctx.executionId, cycle: ctx.ordinal };
    for (let round = 1; round <= MAX_QUESTION_ROUNDS; round++) {
      const qPath = ctx.questionsFile;
      if (!qPath) break;
      // `read`, not `payload`: the legacy body below still declares `const payload` for the answer.
      const read = await readAskFile(qPath);
      if (read.kind === 'none') {
        if (read.malformed) {
          await appendAudit(this.pipeline.dir, `${agentLabel}: questions file was malformed — proceeding without asking (round ${round}).`).catch(() => {});
        }
        break;
      }
      this._checkAbort();
      let questions = read.kind === 'questions' ? read.questions : [];
      let formAsk = null;
      let autoValues = null;
      let formSecrets = {};
      if (read.kind === 'form') {
        // Gate 2 (spec §5). It may spawn ONE repair round of its own, whose
        // result becomes this round's result; it never consumes a round.
        const gate = await this._prepareFormAsk(nc, ctx, read, qPath, round, agentLabel);
        if (gate.result !== undefined) result = gate.result;
        formAsk = gate.ask;
        autoValues = gate.autoValues;
        formSecrets = gate.secrets || {};
        questions = gate.questions;
      }
      if (!formAsk && !questions.length) break;
      if (formAsk) {
        // §9: the persisted ask is the FULL resolved snapshot — History renders
        // it after the agent's sidecar changed or its plugin was removed. The
        // column is schemaless JSON TEXT, so nothing migrates.
        await writeStepQuestions(this.pipeline.id, stepKey, round, {
          agentKey: nc.key, nodeId: ctx.nodeId, questions: formAsk,
        });
        this._artifact('questions', qPath, { nodeId: ctx.nodeId, executionId: ctx.executionId, port: null, cycle: ctx.ordinal });
        await appendAudit(this.pipeline.dir, `${agentLabel} asked with form "${formAsk.form}" (round ${round}).`).catch(() => {});
        const answered = await this._enqueueAsk(() => this._ask({
          id: `questions-${stepKey}-r${round}`,
          kind: 'form',
          origin: 'questions',               // night mode: neverDecide 'questions' covers it
          agent: agentLabel,
          nodeId: ctx.nodeId,
          executionId: ctx.executionId,
          askId: formAsk.askId,             // ruling X1: the ROUTE token, not `id`
          form: formAsk.form,
          version: formAsk.version,
          title: formAsk.title,
          surface: formAsk.surface,
          data: formAsk.data,
          layout: formAsk.layout,
          answerSchema: formAsk.answerSchema,
          fileRefs: formAsk.fileRefs,
          files: formAsk.files,
          autoValues,                              // D10, auto mode only
          validate: formAnswerValidator(formAsk),  // gate 3
        }));
        this._checkAbort();
        // A producer's resumed prompt carries `values` (ctx.formAnswers below), so a `secret` field must
        // be swapped for its marker BEFORE anything reads them; the real value is held in memory only.
        const { values, held } = redactSecrets((answered && typeof answered === 'object' && answered.values) || {}, formSecrets);
        Object.assign(this._secretEnv, held);
        const formBy = this.answeredBy(`questions-${stepKey}-r${round}`);
        const formNight = this.nightDecision(`questions-${stepKey}-r${round}`);
        await writeStepQuestions(this.pipeline.id, stepKey, round, {
          agentKey: nc.key, nodeId: ctx.nodeId,
          answers: { kind: 'form', form: formAsk.form, version: formAsk.version, values, ...(formBy ? { answeredBy: formBy } : {}), ...(formNight ? { night: formNight } : {}) },
        });
        await appendAudit(this.pipeline.dir, `${agentLabel}: form "${formAsk.form}" answered${byActor(formBy)} (round ${round}).`, { actor: formBy }).catch(() => {});
        await rm(qPath, { force: true }).catch(() => {});
        const step = this.state.steps.find((s) => s.key === stepKey);
        if (step?.sessionId) ctx.resumeSessionId = step.sessionId;
        ctx.formAnswers = [...(ctx.formAnswers || []), { form: formAsk.form, version: formAsk.version, values }];
        ctx.questionsFile = round < MAX_QUESTION_ROUNDS
          ? this._questionsPath(ctx.nodeId, ctx.ordinal, round + 1)
          : null;
        this._log(agentLabel, 'debug', `resuming with form "${formAsk.form}" answers (round ${round})`, attr);
        result = await this._runNodeAttempts(nc, ctx);
        continue;
      }
      await writeStepQuestions(this.pipeline.id, stepKey, round, {
        agentKey: nc.key, nodeId: ctx.nodeId, questions: { questions },
      });
      this._artifact('questions', qPath, { nodeId: ctx.nodeId, executionId: ctx.executionId, port: null, cycle: ctx.ordinal });
      await appendAudit(this.pipeline.dir, `${agentLabel} asked ${questions.length} question(s) (round ${round}).`).catch(() => {});
      const payload = await this._enqueueAsk(() => this._ask({
        id: `questions-${stepKey}-r${round}`,
        kind: 'questions',
        questions,
        agent: agentLabel,
        nodeId: ctx.nodeId,
        executionId: ctx.executionId,
      }));
      this._checkAbort();
      const answers = normalizeClarifyAnswer(payload, questions);
      const byId = new Map(questions.map((q) => [q.id, q]));
      const enriched = answers.map((a) => ({ id: a.id, question: byId.get(a.id)?.question || '', choice: a.choice }));
      const answerBy = this.answeredBy(`questions-${stepKey}-r${round}`);
      const answerNight = this.nightDecision(`questions-${stepKey}-r${round}`);
      await writeStepQuestions(this.pipeline.id, stepKey, round, {
        agentKey: nc.key, nodeId: ctx.nodeId, answers: { answers: enriched, ...(answerBy ? { answeredBy: answerBy } : {}), ...(answerNight ? { night: answerNight } : {}) },
      });
      await appendAudit(this.pipeline.dir, `${agentLabel}: ${enriched.length} answer(s) received${byActor(answerBy)} (round ${round}).`, { actor: answerBy }).catch(() => {});
      // Consume the processed round file: the DB row is authoritative, and a
      // surviving file would re-gate the user on a crash/pause-resumed re-run.
      await rm(qPath, { force: true }).catch(() => {});
      const step = this.state.steps.find((s) => s.key === stepKey);
      if (step?.sessionId) ctx.resumeSessionId = step.sessionId;
      ctx.questionsAnswered = [...(ctx.questionsAnswered || []), ...enriched];
      ctx.questionsFile = round < MAX_QUESTION_ROUNDS
        ? this._questionsPath(ctx.nodeId, ctx.ordinal, round + 1)
        : null;
      this._log(agentLabel, 'debug', `resuming with ${enriched.length} answer(s) (round ${round})`, attr);
      result = await this._runNodeAttempts(nc, ctx);
    }
    return result;
  }

  /**
   * Composite mode `expand`: read the decomposition the bound token points at,
   * through the tolerant parse, and persist phases + tasks BEFORE any slice runs
   * — so the records exist even if the fan-out aborts mid-phase. Each task row is
   * stamped with the sub-EXECUTION id that will run it.
   *
   * readDecomposition emits tasks as { id, title, file } (pipelineDir-relative);
   * the scheduler binds each slice to `task.path`, so the absolute path is added
   * HERE (P3 contract gap the adapter owns). An empty or malformed document is
   * not an error: it warns and hands back zero phases, which the scheduler turns
   * into one ordinary unexpanded execution.
   */
  async _expandDecomposition(node, args) {
    const token = (args.bindings || {})[args.expandsPort];
    const doc = await readDecomposition(token?.path);
    const { phases } = doc;
    const attr = { nodeId: node.id, executionId: args.executionId, cycle: args.ordinal || 1 };
    // Ids collide, escape the pipeline dir or fan out without bound: refuse, never run it half-right.
    const problems = decompositionProblems(doc.raw, this.pipeline.dir);
    if (problems.length) {
      throw Object.assign(new Error(`${node.id}: the decomposition on "${args.expandsPort}" cannot be fanned out — ${problems.join('; ')}`),
        { code: 'BAD_DECOMPOSITION', errorClass: null });
    }
    if (!phases.length) {
      this._log(node.id, 'warn',
        `no runnable phases in the decomposition bound to "${args.expandsPort}"`
        + `${token?.path ? ` (${token.path})` : ''} — running one normal execution instead`, attr);
      await appendAudit(this.pipeline.dir,
        `${node.id}: the decomposition on \`${args.expandsPort}\` carried no runnable phases — `
        + 'running one normal execution with that input unbound.').catch(() => {});
      return { phases: [] };
    }
    // Each task carries its file's content digest: a resume skips a slice that finished before the
    // pause only while its task file is unchanged (scheduler runSlice). An unreadable file gets none.
    const resolved = await Promise.all(phases.map(async (ph) => ({
      ordinal: ph.ordinal,
      tasks: await Promise.all(ph.tasks.map(async (t) => {
        const path = isAbsolute(t.file || '') ? t.file : join(this.pipeline.dir, t.file || '');
        const text = t.file ? await readFile(path).catch(() => null) : null;
        return {
          ...t,
          nodeId: sliceExecutionId(args.executionId, t.id),
          path,
          digest: text ? createHash('sha256').update(text).digest('hex') : null,
        };
      })),
    })));
    writeDecomposition(this.pipeline.id, resolved);
    const count = resolved.reduce((n, ph) => n + ph.tasks.length, 0);
    // Run progress (P2): the decomposition's whole size. A slice row's taskTotal is its phase's only.
    this.state.progressFacts ||= { tasks: {}, reviews: {} };
    this.state.progressFacts.tasks[node.id] = count;
    await appendAudit(this.pipeline.dir,
      `${node.id}: expanded into ${resolved.length} phase(s), ${count} task(s).`).catch(() => {});
    return { phases: resolved };
  }

  /** This role node's rounds. A round saved before rounds named their node reads as the plan target's. */
  _nodeRounds(node, spec) {
    const target = roleTargetOf(spec);
    return (this.state.roleReviews?.rounds || []).filter((r) => (r.node === undefined ? roleTargetOf(r) === target : r.node === node.id));
  }

  /** Spec §3 round and pass, from the role node's trigger (decision 15). A fresh continue port (the plan's `revise`, the
   *  diff's `done`) is the next round of the node's current pass; any other firing (first run, the person's "Ask for
   *  changes") opens a new pass at round 1. So does a continue port after a round that left no role to re-review: that
   *  round ended its pass, and the firing comes from someone else's fix (another review's, through an `or`). */
  _roleRound(node, args) {
    const spec = roleReviewOf(node.config);
    const last = this._nodeRounds(node, spec).at(-1) || null;
    const open = !!last && rolesForRound(last.roles, last.round + 1, last).some((r) => !r.skip);
    const next = (args.trigger?.freshPorts || []).includes(roleTargetOf(spec).continuePort) && open;
    return next
      ? { pass: last.pass, round: last.round + 1, last }
      : { pass: (last?.pass || 0) + 1, round: 1, last: null };
  }

  /** The file this round reviews: the fresh revise (round 2+), else the target's reviewed input. */
  _rolePlanBinding(args, spec) {
    const viaRevise = (args.trigger?.freshPorts || []).includes('revise');
    return (viaRevise && args.bindings?.revise) || args.bindings?.[roleTargetOf(spec).reviewedPort] || null;
  }

  /** The run's picked role list (a `picked` role review's source): Shaper's perspectives are today's only producer. */
  _runPickedRoles() {
    return Array.isArray(this.runShape?.perspectives) ? [...this.runShape.perspectives] : null;
  }

  /** The roles a role-review node runs this run, from its spec. A picked list that names none of a provider-less
   *  spec's roles falls back to its first declared role, and the audit says so. */
  async _runningRoles(node) {
    const spec = roleReviewOf(node.config);
    const picked = this._runPickedRoles();
    const roles = runningRoles(spec, picked);
    if (spec.source === 'picked' && !roleChecklistOf(spec) && !spec.roles.some((r) => (picked || []).includes(r.key))) {
      await appendAudit(this.pipeline.dir, `${node.id}: no picked role matches its roles; reviewing as ${roles[0]?.label}.`).catch(() => {});
    }
    return this._careRoles(spec, roles);
  }

  /** Small runs B3 (D10): the requirements review of a marked run runs only the roles its Care plan names (Lean: the
   *  lead and Product). Every other node, and every unmarked run, keeps `roles`. */
  _careRoles(spec, roles) {
    // Small runs C2 (D8): a slice run's plan review runs the Care plan's reviewers, read from the roles the node declares
    // (so the Challenger joins under Thorough even when nobody picked it). The code review keeps its declared roles.
    const careRun = this.state.stepper?.careRun;
    if (careRun && Array.isArray(careRun.planReviewers) && spec?.target && roleTargetOf(spec).reviewsPlan) {
      // A planned role the node does not declare (Compliance) joins as the provider names it, as runningRoles does.
      const declared = Array.isArray(spec.roles) ? spec.roles : [];
      const keep = declared.filter((r) => careRun.planReviewers.includes(r.key));
      const missing = [];
      for (const k of careRun.planReviewers) {
        if (declared.some((r) => r.key === k)) continue;
        const role = roleChecklistOf(spec)?.pickedRole?.(k);
        if (role) keep.push(role); else missing.push(k);
      }
      if (missing.length && !this._careRolesMissingNoted && this.pipeline) {
        this._careRolesMissingNoted = true;
        appendAudit(this.pipeline.dir, `Care ${CARE_LABELS[careRun.position] || careRun.position}: the plan review has no ${missing.map(roleLabelOf).join(', ')} role; reviewing without it.`).catch(() => {});
      }
      return keep.length ? keep : roles;
    }
    const plan = this._requirementRoundPlan(spec);
    if (!plan) return roles;
    const keep = roles.filter((r) => plan.roles.includes(r.key));
    return keep.length ? keep : roles.slice(0, 1);
  }

  /** Small runs B3 (D8): the round plan of a role review whose checklist provider takes a Care plan (`roundPlan`), in a
   *  marked planning run with Care; else null. */
  _requirementRoundPlan(spec) {
    const roundPlan = roleChecklistOf(spec)?.roundPlan;
    const rec = this._shapeRec;
    if (!roundPlan || !rec?.smallRuns || !rec.care?.position || this.runShape?.slice) return null;
    return roundPlan(rec.care.position, { picked: this._runPickedRoles() || [], lead: this.runShape?.lead || null });
  }

  /** Small runs B3 (D9): Care bounds the requirement review loop through the engine's own per-run wire budget, the
   *  `maxCycles` of the loop wire that feeds the requirements review node, written to the live wires and the frozen
   *  manifest (a resume rebuilds the live wires from it). A budget the run overlay or the project's per-workflow layer
   *  names wins. Idempotent; persists only when it changed the manifest. */
  async _careRequirementBudget() {
    const manifest = this.state.stepper;
    if (!manifest?.graph) return;
    const node = (this.resolved?.template?.nodes || []).find((n) => roleChecklistOf(roleReviewOf(n.config))?.roundPlan);
    const plan = node ? this._requirementRoundPlan(roleReviewOf(node.config)) : null;
    const wire = plan ? (manifest.graph.wires || []).find((w) => w.loop && w.to?.node === node.id) : null;
    if (!wire) return;
    if (manifest.runOverlay?.wires?.[wire.id]) return;
    try {
      if ((await resolveRunConfig(this.projectDir, this.workflowId)).wires?.[wire.id]?.maxCycles !== undefined) return;
    } catch { /* unreadable project layer: Care decides */ }
    if (this.resolved?.wires) this.resolved.wires[wire.id] = { maxCycles: plan.rounds };
    if (wire.maxCycles === plan.rounds) return;
    wire.maxCycles = plan.rounds;
    if (this.pipeline) await appendAudit(this.pipeline.dir, `Care ${CARE_LABELS[this._shapeRec.care.position]}: requirements reviewed in at most ${plan.rounds} round${plan.rounds === 1 ? '' : 's'}.`).catch(() => {});
    await this._persist();
  }

  /** One phase, one task per running role; round 2+ drops the clean roles (no agent call). */
  async _expandRoleReview(node, args) {
    this.state.roleReviews ||= { rounds: [] };
    const { pass, round, last } = this._roleRound(node, args);
    const roles = rolesForRound(await this._runningRoles(node), round, last);
    const tasks = roles.filter((r) => !r.skip).map((r) => ({
      id: roleTaskId(r.key), role: r.key, title: r.label, file: null, path: null,
      nodeId: sliceExecutionId(args.executionId, roleTaskId(r.key)),
    }));
    this.state.progressFacts = { ...(this.state.progressFacts || {}), roleReview: { nodeId: node.id, round } };
    const skipped = roles.filter((r) => r.skip).map((r) => r.key);
    await appendAudit(this.pipeline.dir, `${node.id}: role reviews, pass ${pass} round ${round}: `
      + `${tasks.map((t) => t.title).join(', ') || 'none'}${skipped.length ? ` (skipped: ${skipped.join(', ')})` : ''}.`).catch(() => {});
    return { phases: tasks.length ? [{ ordinal: 1, tasks }] : [] };
  }

  /** The ONE publish: read each reviewer's raw verdict, record the round (each record names the model and effort its
   *  slice ran on), write the merged findings file on the target's findings port, and pass the reviewed plan on when the
   *  port set has one. A port set that routes (blocking/clean outputs) gets the blocking findings as its verdict, recorded
   *  like a plain review's. A missing or malformed verdict is an empty review, logged; it never pauses the run. */
  async _finishRoleReview(nc, node, args) {
    const ordinal = args.ordinal || 1;
    const { pass, round, last } = this._roleRound(node, args);
    const ports = this.resolved.ports(node) || {};
    const spec = roleReviewOf(node.config);
    const planPath = this._rolePlanBinding(args, spec)?.path || '';
    const planText = planPath ? await readFile(planPath, 'utf8').catch(() => '') : '';
    const reqPath = args.bindings?.requirements?.path;
    const boundText = reqPath ? await readFile(reqPath, 'utf8').catch(() => '') : '';
    const requirementsText = this.runShape ? this._sliceCriteria(boundText) : boundText;
    const { findingsPort, reviewedPort, requirementConcerns } = roleTargetOf(spec);
    // Shaper requirements s3 (D1): only a plan review raises requirement concerns; a diff or requirements review blocks.
    const requirementIds = requirementConcerns ? criterionIds(requirementsText) : [];
    const provider = roleChecklistOf(spec);
    const outs = ports.outputs || [];
    const routes = outs.some((p) => p.when === 'blocking' || p.when === 'clean');
    // Spec D7: the plan's items belong to the Review step as a whole, as they did for one reviewer.
    const items = routes && this.runShape && nc.key === CHECKLIST_REVIEWER_KEY ? await this._reviewChecklistItems({ bindings: args.bindings }) : [];
    const reported = [];
    const running = this._careRoles(spec, runningRoles(spec, this._runPickedRoles()));
    // Only a step with a role kept out of the merge records each role's own plan report: a round that re-runs only
    // that role then still has the others' reports. Other steps skip and merge as before.
    const ownReports = items.length > 0 && running.some((r) => provider?.feedsPlanChecklist?.(r.key) === false);
    const roles = await Promise.all(rolesForRound(running, round, last).map(async (r) => {
      if (r.skip) {
        // A role skipped as clean still reported the plan's items last round; its report stands in the merge.
        const prev = last.roles.find((x) => x.key === r.key);
        if (prev?.planChecklist) reported.push(prev.planChecklist);
        return { ...prev, skipped: true };
      }
      const v = allocateVerdict({ node, ports, ordinal, runCtx: this._runCtx(nc, roleTaskId(r.key)) });
      let raw = null;
      try { raw = v?.path ? JSON.parse(await readFile(v.path, 'utf8')) : null; } catch (err) {
        await appendAudit(this.pipeline.dir, `${node.id}: ${r.key} review unreadable (${err.message}); counted as empty.`).catch(() => {});
      }
      // A provider's role whose ids are not the plan's (D12) keeps its verdicts out of the plan-checklist merge.
      const feeds = provider?.feedsPlanChecklist?.(r.key) !== false;
      if (feeds) reported.push(raw?.checklist);
      // The role's own report on the plan's items, each one it left out unmet, so only a full clean report earns a skip.
      const own = feeds && ownReports ? normalizeReviewChecklist(raw?.checklist) || [] : null;
      const planChecklist = own && items.map((it) => own.find((c) => c.id === it.id) || { id: it.id, status: 'unmet', evidence: 'no verdict given' });
      return { ...roleRecord(r, round, raw, provider ? provider.items(r.key, planText, requirementsText) : [], { requirementIds }),
        ...(planChecklist ? { planChecklist } : {}), ...this._roleRecordPair(nc, r.key) };
    }));
    const out = allocateOutputs({ node, ports, executionId: args.executionId, ordinal, runCtx: this._runCtx(nc) });
    const findings = out[findingsPort];
    // The sink answers each finding in this file (#990 slice 3); every round is born with counts (all open).
    const dispositions = dispositionsPathFor(findings.path);
    this.state.roleReviews ||= { rounds: [] };
    this.state.roleReviews.rounds.push(withCounts({ pass, round, node: node.id, target: spec.target, plan: planPath, roles, dispositions }));
    let verdict = routes ? roleRoutingVerdict(roles) : null;
    let checklistMd = '';
    if (verdict && items.length) {
      const merged = applyChecklist({ ...verdict, checklist: mergeReportedChecklists(reported) }, items);
      const added = merged.issues.slice(verdict.issues.length);
      if (added.length) checklistMd = '\n' + checklistFindingsMarkdown(added);
      verdict = merged;
    }
    await writeFile(findings.path, findingsMarkdown(round, planPath, roles, { dispositionsPath: dispositions, target: spec.target }) + checklistMd);
    const reviewed = roles.filter((r) => !r.skipped).length;
    if (verdict && this.pipeline) await this._recordReview(nc, node, ordinal, verdict);
    return {
      summary: `Role reviews, round ${round}: ${reviewed} role(s) reviewed.`,
      outputs: { [findingsPort]: findings, ...(outs.some((p) => p.id === reviewedPort) ? { [reviewedPort]: { path: planPath || null } } : {}) },
      verdict,
    };
  }

  /** What a role record says ran: the pair its slice was dispatched on, plus the requested pick the engine dropped. */
  _roleRecordPair(nc, key) {
    const { model, effort } = this._rolePair(nc, key);
    const wanted = nc.roles?.[key]?.wanted;
    return { ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(wanted ? { wanted } : {}) };
  }

  /** The wire that brings a role review's findings port into this node (read off the wire topology, onto any input
   *  port, back through `or` cards), with that review's sink and node; null for a node no role review feeds. */
  _roleFindingsWire(nodeId) {
    const tpl = this.resolved?.template;
    const wires = tpl?.wires || [];
    const byId = new Map((tpl?.nodes || []).map((n) => [n.id, n]));
    const seen = new Set();
    const roleSource = (w) => {
      const from = byId.get(w?.from?.node);
      if (from?.kind === 'or') {
        if (seen.has(from.id)) return null;
        seen.add(from.id);
        for (const inner of wires) if (inner?.to?.node === from.id) { const hit = roleSource(inner); if (hit) return hit; }
        return null;
      }
      const spec = roleReviewOf(from?.config);
      return spec && w.from.port === roleTargetOf(spec).findingsPort ? { sink: spec.sink, node: from.id } : null;
    };
    for (const w of wires) {
      if (w?.to?.node !== nodeId) continue;
      const hit = roleSource(w);
      if (hit) return { port: w.to.port, ...hit };
    }
    return null;
  }

  /** The sink's answer in the round's dispositions file; {} when it is missing, too big or unparseable (audited). */
  async _readDispositions(round) {
    const at = `Role findings, round ${round.round}: the dispositions file ${round.dispositions}`;
    const absent = async (why) => { await appendAudit(this.pipeline.dir, `${at} ${why}; its unanswered findings count as open.`).catch(() => {}); return {}; };
    if (!round.dispositions) return {};
    try {
      if ((await stat(round.dispositions)).size > DISPOSITIONS_MAX_BYTES) return absent(`is over ${DISPOSITIONS_MAX_BYTES} bytes`);
      const raw = JSON.parse(await readFile(round.dispositions, 'utf8'));
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : absent('is not an object');
    } catch (err) {
      return absent(err.code === 'ENOENT' ? 'was not written' : `is unreadable (${err.message})`);
    }
  }

  /** Spec §3 "Loop", for ANY sink fed role findings: its dispositions file (and a refiner's `addressed` list, raw file —
   *  normalizeReview drops it) mark each finding fixed, disputed or open, and the round gets its counts and conflicts.
   *  A refiner sink then routes on THIS round's critical/major reviewer findings, never on its own self-review. */
  async _applyRoleReviewVerdict(ctx, result) {
    const wire = this._roleFindingsWire(ctx.nodeId);
    const bound = wire && ctx.bindings?.[wire.port]?.path;
    if (!bound || !result || result.paused || result.error) return result;
    // Only the role node's last round, and only when ITS findings file fed this execution (an `or` may carry another review).
    const roleNode = (this.resolved.template.nodes || []).find((n) => n.id === wire.node);
    const round = this._nodeRounds(roleNode, roleReviewOf(roleNode.config)).at(-1);
    if (!round || dispositionsPathFor(bound) !== round.dispositions) return result;
    const answer = await this._readDispositions(round);
    let own = null;
    try { own = ctx.verdict?.path ? JSON.parse(await readFile(ctx.verdict.path, 'utf8')) : null; } catch { own = null; }
    const raw = { addressed: own?.addressed, dispositions: answer.dispositions, conflicts: answer.conflicts };
    applyDispositions(round, raw, wire.sink === REFINER_SINK ? this._planVersion : null);
    const conflicts = normalizeConflicts(raw, round);
    if (conflicts.length) round.conflicts = conflicts; else delete round.conflicts;
    const c = round.counts;
    await appendAudit(this.pipeline.dir, `Role findings, round ${round.round}: ${c.raised} raised, ${c.fixed} fixed, `
      + `${c.disputed} disputed, ${c.open} open; ${conflicts.length} conflict(s) for the person.`).catch(() => {});
    if (wire.sink !== REFINER_SINK) return result;
    const { verdict, refinerIssues } = refinerVerdict(round, result.verdict);
    if (refinerIssues.length) round.refinerIssues = refinerIssues;
    // Keep `missing` (no verdict file): `_afterExecution` then skips the `reviews` row, as today.
    return { ...result, verdict: result.verdict?.missing ? { ...verdict, missing: true } : verdict };
  }

  /** Composite mode `phase`: the per-phase status plumbing plus its audit line. */
  _compositePhase(args) {
    updatePhaseStatus(this.pipeline.id, args.phase, args.phaseStatus, new Date().toISOString());
    if (args.phaseStatus === 'running') {
      appendAudit(this.pipeline.dir, `Phase ${args.phase}: task(s) starting.`).catch(() => {});
    } else if (args.phaseStatus === 'error') {
      appendAudit(this.pipeline.dir, `Phase ${args.phase}: a task failed — aborting the run.`).catch(() => {});
    }
    return {};
  }

  /**
   * Composite mode `finish`: the ONE publish. A `sideEffect: 'code'` consumer
   * stages its worktree HERE — after the last phase, never per slice — so the
   * next node's `git diff` sees every task's files at once and no two parallel
   * slices race for the git index lock.
   *
   * The returned outputs are deliberately EMPTY: a composite wrote no node-level
   * artifact (each slice wrote its own under slice-prefixed paths), so the node's
   * ports fire as pure sequencing tokens (the scheduler fires every `always`
   * output with a null payload when `outputs` lacks it). For a void output — the
   * live case, `implementer.done` — that is byte-identical to an ordinary execution.
   */
  async _finishComposite(nc, args) {
    if (nc.meta?.sideEffect === 'code') {
      await this._stageWorkingTree();
      if (this.execEnv) await this.execEnv.stageAll(this._excludePathspecs(this.members[0].projectKey));
    }
    const label = nc.meta?.displayName || nc.key || args.node.id;
    const n = Array.isArray(args.phases) ? args.phases.length : 0;
    return { summary: `${label}: composite execution complete (${n} phase(s)).`, outputs: {}, verdict: null };
  }
  // ── hook 4: rehydrate (PURE — runs before the shell restores anything) ────
  /**
   * Decide whether this resume point is ours and hand the shell the fields it
   * rehydrates from. NOTHING else: this.registry / state.steps / pipeline are
   * not restored yet (run-harness.mjs:784-790). The engine-side restoration is
   * _restoreFromResumePoint, which _engineRun({resume}) awaits first.
   * @param {object} rp the parsed resume_point
   * @returns {{checkpointRef:string|null, memberWorktrees:Array, plan:null, audit:string}}
   */
  _engineRehydrate(rp) {
    if (!rp || rp.version !== 2) throw new Error(`resume(): unsupported resume point version ${rp?.version}`);
    if (!rp.manifest || rp.manifest.version !== 2) throw new Error('resume(): the v2 resume point carries no manifest');
    return {
      checkpointRef: rp.checkpointRef ?? null,
      memberWorktrees: (rp.workspace?.projects || []).map((p) => ({
        projectKey: p.projectKey,
        worktreeDir: p.worktreeDir,
        graphInstruction: p.graphInstruction || '',
      })),
      plan: null,   // v2 has no frozen ExecutablePlan; the manifest is the topology
      // The base writes this line (P1 hook-4 contract); v1's is "from <kind> at step <n>".
      audit: `Pipeline **resumed** (graph snapshot at seq ${rp.snapshot?.seq ?? 0}).`,
    };
  }

  /** Engine hook (run-harness.mjs#_engineResumeGate): the agent nodes of the frozen
   *  manifest, with the model the manifest froze and the tools their agent file grants
   *  (the manifest never carries tools), for the engine gate before the graph is restored. */
  async _engineGateNodes(rp) {
    const registry = loadAgentRegistry(this.agentsDir);
    const nodes = [];
    for (const mn of rp?.manifest?.graph?.nodes || []) {
      if (mn.kind !== 'agent') continue;
      const meta = registry[mn.key] || {};
      const { tools } = await loadAgentFile(this.agentsDir, meta.agentFile ?? null, meta.agentPath ?? null);
      nodes.push({ nodeId: mn.id, key: mn.key, model: mn.model || undefined, tools });
    }
    return nodes;
  }

  /**
   * Shaper small runs B2: the Start step of a marked planning run (not a slice, not a re-plan) — the Care ask, asked once
   * (d-2). A re-plan copies the replaced feature's Care and asks nothing. Care saved but its models not yet adopted (a
   * stop between the answer and the manifest patch) re-adopts once. Every other run: nothing.
   */
  async _careStart() {
    const rec = this._shapeRec;
    if (!rec?.smallRuns || this.runShape?.slice) return;
    const careFill = this.state.stepper?.careFill;
    if (!rec.care && this.runShape?.replaces) {
      const kept = careOfFeature(this.runShape.replaces);
      if (kept) {
        rec.care = { ...kept, reason: '', facts: careFactsOf({ prompt: this.pipeline?.promptText, size: this.runShape.size }), at: new Date().toISOString() };
        if (this.pipeline) await appendAudit(this.pipeline.dir, `${careAuditLine(rec.care)}.`).catch(() => {});
      }
    }
    if (!rec.care) await this._careAsk();
    else if (!careFill?.position) {
      if (!careFill) await this._careProbe();
      await this._adoptCareFill(rec.care.position);
      await this._persist();
    }
    await this._careOriginGraph(rec.care.position);
    await this._careRequirementBudget();
  }

  /** Small runs C2 (run 1): the origin run builds slice 1, so it takes Care's run graph like runs 2..N (careRunGraph: the
   *  Test writer under Balanced and Thorough, the fix-cycle budgets, the second opinion). Applied here, before the
   *  scheduler is created, so the scheduler builds its wire budgets from it. Re-resolves with the run overlay (a run or
   *  project budget still wins) and replaces the frozen manifest's topology; every node the start graph had keeps the
   *  model and effort it started with (Care's fill included). Once per run (`careGraph`); a failing resolve keeps the
   *  start graph. */
  async _careOriginGraph(position) {
    const manifest = this.state.stepper;
    if (!manifest?.graph || manifest.careGraph || !this.resolved) return;
    const plan = careRunPlan(position);
    try {
      const fresh = await resolveGraph(this.projectDir, this.workflowId, this.registry, this.agentsDir, {
        ...this._graphResolveOptions({ overlay: manifest.runOverlay || null }), roleFill: { source: 'care', roles: careModelRoles(position) },
        transform: (t) => this._careRunGraph(t, plan),
      });
      const nodes = { ...fresh.nodes };
      for (const [id, old] of Object.entries(this.resolved.nodeCtx || {})) {
        if (!nodes[id] || old.kind !== 'agent') continue;
        nodes[id] = { ...nodes[id], model: old.model, effort: old.effort, modelSource: old.modelSource };
      }
      const next = buildGraphManifest(fresh.template, fresh.agentsByKey, { overlays: { nodes, wires: fresh.wires }, scripts: fresh.scriptsByKey });
      Object.assign(manifest, next);
      this._adoptResolvedGraph({ ...fresh, nodes });
    } catch (err) {
      this._log('orchestrator', 'warn', `Care: cannot shape the run's graph, it keeps its start graph: ${err?.message || err}`);
    }
    manifest.careGraph = plan.position;
    await this._persist();
    this._emit('state', this.getState());
  }

  /** B2 (D13): the Care probe — a resolve with the run's own options plus a Lean fill — stamps on the frozen manifest
   *  which nodes Care may fill and which keep a person's model, so a pause at S0 carries it. Returns the fill notes. */
  async _careProbe() {
    const manifest = this.state.stepper;
    let notes = null;
    try {
      const probe = await resolveGraph(this.projectDir, this.workflowId, this.registry, this.agentsDir, {
        ...this._graphResolveOptions({ overlay: manifest?.runOverlay || null }), roleFill: { source: 'care', roles: careModelRoles('lean') },
      });
      notes = probe.fillNotes || null;
    } catch (err) {
      this._log('orchestrator', 'warn', `Care: cannot read the models Care may fill: ${err?.message || err}`);
    }
    if (manifest) manifest.careFill = { fillable: [...(notes?.filled || [])], kept: { run: [...(notes?.kept.run || [])], project: [...(notes?.kept.project || [])], slot: [...(notes?.kept.slot || [])] } };
    return notes;
  }

  /** B2 (D5, D7, D9, D19): raise the Care ask and save the answer. Only `position` is read from any answer; the rest of
   *  the record is the ask's. Care is set on the line after the ask resolves, before any await, so a pause right after
   *  the answer persists it. */
  async _careAsk() {
    const fillNotes = await this._careProbe();
    const start = await careStartAsk({
      prompt: this.pipeline?.promptText, size: this.runShape?.size, projectDir: this.projectDir, engine: this.claude.engine || 'claude',
      fillNotes, deps: { warn: (m) => this._log('orchestrator', 'warn', m) },
    });
    const validate = careAnswerValidator(start);
    const raw = await this._enqueueAsk(() => this._ask({ id: 'care-1', kind: 'care', care: start, validate }));
    // answer() hands back the validated record; --yes hands back the raw payload, which passes the validator here.
    const answered = raw && typeof raw === 'object' && typeof raw.position === 'string';
    const out = answered ? { ok: true, payload: raw } : validate(raw);
    if (!out.ok) throw Object.assign(new Error('invalid Care answer'), { code: 'INVALID_ANSWER', errors: out.errors });
    this._shapeRec.care = out.payload;
    if (!answered && this.pipeline) await appendAudit(this.pipeline.dir, `${careAuditLine(out.payload)}.`).catch(() => {});
    await this._adoptCareFill(out.payload.position);
    await this._persist();
    this._checkAbort();
    this._checkPause();
  }

  /** B2 (D13): fill the planning run's Default agents for the chosen Care. Re-resolves with the run overlay and patches
   *  into the frozen manifest (and the live graph) only the model and effort of the nodes the probe stamped fillable;
   *  every other cell stays as it started. No node has run, so nothing re-runs. A failing resolve keeps the start graph. */
  async _adoptCareFill(position) {
    const manifest = this.state.stepper;
    if (!manifest) return;
    const careFill = manifest.careFill || { fillable: [], kept: { run: [], project: [], slot: [] } };
    try {
      const fresh = await resolveGraph(this.projectDir, this.workflowId, this.registry, this.agentsDir, {
        ...this._graphResolveOptions({ overlay: manifest.runOverlay || null }), roleFill: { source: 'care', roles: careModelRoles(position) },
      });
      const cells = new Map((manifest.graph?.nodes || []).map((c) => [c.id, c]));
      for (const id of careFill.fillable) {
        const nc = fresh.nodes?.[id];
        const cell = cells.get(id);
        if (!nc || nc.kind !== 'agent' || !cell) continue;
        cell.model = nc.model ?? '';
        cell.effort = nc.effort ?? '';
        // Who chose the model travels with it: a stale start source would misread the fill at the guard and the spawn backstop.
        if (nc.modelSource !== undefined) cell.modelSource = nc.modelSource;
        const live = this.resolved?.nodeCtx?.[id];
        if (live) { live.model = nc.model; live.effort = nc.effort; live.modelSource = nc.modelSource; }
      }
      this._logCareFill(position, { ...fresh, fillNotes: { filled: careFill.fillable.filter((id) => fresh.fillNotes?.filled.includes(id)) } });
    } catch (err) {
      this._log('orchestrator', 'warn', `Care: cannot fill the models, the run keeps its start models: ${err?.message || err}`);
    }
    manifest.careFill = { ...careFill, position };
    this._emit('state', this.getState());
  }

  /**
   * Restore the v2 run position — called by _engineRun({resume}) INSIDE the
   * shell's try, after state.*, pipeline, registry and agentPrompts are back.
   * The snapshot is authoritative and the workflow ROW is never read: the frozen
   * manifest supplies the topology, ports and effective budgets, the live
   * registry only the executor-side meta. Overlays are NOT refreshed — re-reading
   * them would let a config edit made while the run sat paused change the model
   * of an execution that is mid-flight in the snapshot.
   */
  async _restoreFromResumePoint(rp) {
    this._resumeSnapshot = rp.snapshot || null;
    this._graphSnapshot = rp.snapshot || null;
    // Session groups (Task 46): the hosts' snapshots for createSessionHosts' restore (Task 47) and the re-attach rule (C42).
    // Before any preflight: a re-preflight that pauses again builds its point from these fields (_engineLastPoint).
    this._sessionRestore = rp.sessionHosts && typeof rp.sessionHosts === 'object' ? rp.sessionHosts : null;
    this._planVersion = Number.isFinite(rp.planVersion) ? rp.planVersion : 0;
    const pr = rp.planRevise;
    this._planRevise = pr && typeof pr.id === 'string' && typeof pr.path === 'string' ? { id: pr.id, path: pr.path } : null;
    this._smallRunsMarked = rp.smallRunsMarked === true;
    const sa = rp.stopAnswer;
    this._stopAnswer = sa && typeof sa.id === 'string' && sa.payload && typeof sa.payload === 'object' ? { id: sa.id, payload: { ...sa.payload } }
      : sa && typeof sa.id === 'string' && Array.isArray(sa.away) ? { id: sa.id, away: sa.away.map((a) => ({ ...a })) } : null;   // slice 10 (D10)
    const pa = rp.protoAnswer;
    this._protoAnswer = pa && typeof pa.key === 'string' && pa.payload && typeof pa.payload === 'object' ? { key: pa.key, payload: { ...pa.payload } } : null;
    const pca = rp.planConcernAnswer;
    this._planConcernAnswer = pca && typeof pca.id === 'string' && pca.payload && typeof pca.payload === 'object'
      ? { id: pca.id, payload: { ...pca.payload } } : null;
    this._planAwayApproved = typeof rp.planAwayApproved?.id === 'string' ? { id: rp.planAwayApproved.id } : null;
    const seen = rp.planConcernSeen;
    this._planConcernSeen = Object.fromEntries(Object.entries(seen && typeof seen === 'object' ? seen : {})
      .filter(([, v]) => v === 'raised' || v === 'decided'));
    const held = rp.planConcernHeld;
    const heldConcern = held && typeof held.id === 'string' ? normalizePlanConcern(held.concern) : null;
    this._planConcernHeld = heldConcern?.ok ? { id: held.id, concern: heldConcern.concern } : null;
    this.state.roleReviews = rp.roleReviews && Array.isArray(rp.roleReviews.rounds) ? rp.roleReviews : undefined;
    this._slicingDone = rp.slicingDone === true;
    this._outlineRevise = typeof rp.outlineRevise === 'string' ? rp.outlineRevise : null;
    if (rp.humanCursor && typeof rp.humanCursor === 'object') { this._humanCursor = rp.humanCursor; this._humanCursorReady = true; }
    // The saved point's reason is spent; a pause THIS resume already took (a SIGTERM or a drain while it set up) keeps its own.
    if (!this.pauseRequested) this._clearPauseReason();
    const manifest = rp.manifest || this.state.stepper;
    this.state.stepper = manifest;
    this.scriptRegistry = loadScriptRegistry({ scriptsDir: this.opts.scriptsDir, agentKeys: Object.keys(this.registry || {}) });
    this._adoptResolvedGraph(resolvedFromManifest(manifest, this.registry, this.scriptRegistry));
    // Silently: the start already logged and audited them. A point without lines had no drop.
    this._notePickDrops(Array.isArray(rp.pickWarnings) ? rp.pickWarnings.filter((w) => typeof w === 'string') : []);
    // §9.4, unchanged messages: the providing plugin may have been disabled or
    // uninstalled while this run sat paused. (Same place v1 re-preflights.)
    this._preflightAgentKeys(this.resolved.agentKeys);
    this._preflightScriptKeys(this.resolved.scriptKeys);
    await this._preflightScriptRuntimes();
    await this._preflightMediaTools();
    // Prompt bodies + frontmatter tools: the one thing the manifest never carries.
    const cache = new Map();
    for (const nc of Object.values(this.resolved.nodeCtx)) {
      if (nc.kind !== 'agent') continue;
      const meta = nc.meta || {};
      const ck = meta.agentPath || meta.agentFile || nc.key;
      if (!cache.has(ck)) cache.set(ck, await loadAgentFile(this.agentsDir, meta.agentFile ?? null, meta.agentPath ?? null));
      const { prompt, tools } = cache.get(ck);
      nc.agentPrompt = prompt;
      nc.tools = tools;
    }
    // One-shot session re-attach: only executions the pause left PAUSED. The map
    // is consumed entry-by-entry in _execCtx, so a fix cycle (a NEW executionId)
    // never re-attaches, and a composite slice that runs again starts cold.
    this._resumeSessions = new Map(
      (this.resumeOpts?.steps || [])
        .filter((s) => s.status === 'paused' && s.sessionId)
        .map((s) => [s.key, s.sessionId]),
    );
  }
}

/** A role-review role's label as the node declares it; the key when it declares none. */
function declaredRoleLabel(nc, key) {
  return roleReviewOf(nc.config)?.roles?.find((r) => r.key === key)?.label || key;
}

/**
 * The frozen pause point with the decomposition tasks `snap` has `done` copied in (added or
 * replaced by executionId). Only `kind:'task'` rows move: a slice publishes nothing and touches
 * no tokens, consumed counts or ordinals, so the rest of the frozen point stays exactly as the
 * pause left it. Returns `frozen` itself when nothing new finished (or there is no frozen point).
 */
function withFinishedSlices(frozen, snap) {
  if (!frozen || !Array.isArray(frozen.execs)) return frozen;
  const have = new Map(frozen.execs.map((e) => [e.executionId, e]));
  const done = (Array.isArray(snap?.execs) ? snap.execs : [])
    .filter((e) => e?.kind === 'task' && e.status === 'done' && have.get(e.executionId)?.status !== 'done');
  if (!done.length) return frozen;
  for (const e of done) have.set(e.executionId, { ...e });
  return { ...frozen, execs: [...have.values()] };
}

/** C5: a verdict as the session trace keeps it, counts only. A step without a verdict file reads 'none'. */
export function verdictSummary(v) {
  return { verdict: v ? (blockingIssues(v).length ? 'blocking' : 'clean') : 'none', issues: Array.isArray(v?.issues) ? v.issues.length : 0 };
}

/**
 * Rebuild a resolveGraph-shaped result from a PERSISTED manifest + the live
 * registry. The manifest is authoritative for topology, port identity (ids/
 * types/loop/expands/when), per-node model/effort/askQuestions/awaitAll/fanOut/subagentModel/
 * subagentEffort/config and per-wire maxCycles; the registry supplies only what a manifest
 * deliberately omits (runnerType, prompt body, frontmatter tools, per-port
 * as/directive/filename/store/artifactKind, the verdict filename, sideEffect,
 * mockRole, displayName).
 * @param {object} manifest a manifest v2
 * @param {Record<string,object>} registry loadAgentRegistry() output
 * @param {Record<string,object>} [scripts] loadScriptRegistry() output (script nodes)
 * @returns {{template:object, ports:Function, loops:object, nodes:Record<string,object>, wires:Record<string,{maxCycles:number}>, agentsByKey:Record<string,object>, agentKeys:Set<string>, scriptsByKey:Record<string,object>, scriptKeys:Set<string>}}
 */
export function resolvedFromManifest(manifest, registry, scripts = {}) {
  const reg = registry && typeof registry === 'object' ? registry : {};
  const scr = scripts && typeof scripts === 'object' ? scripts : {};
  const template = manifestTemplate(manifest);   // restores node.config + loop wire config.maxCycles verbatim
  const manPorts = manifestPortsFn(manifest);
  const regPorts = registryPortsFn(reg, scr);
  const ports = (node) => {
    const snap = manPorts(node);
    const live = regPorts(node) || { inputs: [], outputs: [] };
    if (!snap) return live;                       // a node the manifest does not know (never, defensively)
    const merge = (side) => (snap[side] || []).map((p) => {
      const l = (live[side] || []).find((x) => x.id === p.id);
      return l ? { ...l, ...p } : p;              // snapshot identity wins; live rendering fields ride along
    });
    return {
      ...live, ...snap,
      inputs: merge('inputs'), outputs: merge('outputs'),
      // manifestPortsFn stubs `verdict: { filename: '' }`; the FILENAME is live-only.
      verdict: live.verdict ?? undefined,
    };
  };
  const nodeCtx = {};
  const keyCounts = new Map();
  for (const mn of manifest.graph?.nodes || []) {
    if (mn.kind === 'script') {
      keyCounts.set(mn.key, (keyCounts.get(mn.key) || 0) + 1);
      // v4 T5: the SAME builder resolveGraph uses, over the manifest cell's AUTHORED config (the manifest keeps
      // `config` verbatim) and the LIVE registry entry. No entry => a stub (`file: null`) the preflight refuses.
      nodeCtx[mn.id] = scriptNodeCtx({ id: mn.id, key: mn.key, config: mn.config }, scr[mn.key]);
      continue;
    }
    if (mn.kind !== 'agent') {
      nodeCtx[mn.id] = { nodeId: mn.id, kind: mn.kind, key: null, config: { ...(mn.config || {}) } };
      continue;
    }
    const meta = reg[mn.key] || {};
    keyCounts.set(mn.key, (keyCounts.get(mn.key) || 0) + 1);
    nodeCtx[mn.id] = {
      nodeId: mn.id, kind: 'agent', key: mn.key, authoredKey: mn.key, meta,
      runnerType: meta.runnerType || 'producer',
      agentFile: meta.agentFile ?? null,
      agentPrompt: '',        // filled by _restoreFromResumePoint
      promptHints: typeof meta.promptHints === 'string' ? meta.promptHints : '',
      tools: [],              // filled by _restoreFromResumePoint
      config: { ...(mn.config || {}) },
      model: mn.model || undefined,
      effort: mn.effort || undefined,
      fanOut: !!mn.fanOut,
      subagentModel: mn.subagentModel || '',
      subagentEffort: mn.subagentEffort || '',
      askQuestions: !!mn.askQuestions,
      awaitAll: !!mn.awaitAll,
      ...(mn.roles && typeof mn.roles === 'object' && Object.keys(mn.roles).length ? { roles: mn.roles } : {}),
      ...(mn.wanted && typeof mn.wanted === 'object' ? { wanted: mn.wanted } : {}),
      // #1450 D-i: only when the cell has it — a pre-change manifest leaves nc.modelSource undefined (the spawn backstop).
      ...('modelSource' in mn ? { modelSource: mn.modelSource } : {}),
      duplicateKey: false,
    };
  }
  for (const nc of Object.values(nodeCtx)) {
    if (KEYED_KINDS.includes(nc.kind)) nc.duplicateKey = (keyCounts.get(nc.key) || 0) > 1;
  }
  const wires = {};
  for (const w of manifest.graph?.wires || []) {
    if (w.loop) wires[w.id] = { maxCycles: Number.isInteger(w.maxCycles) && w.maxCycles >= 1 ? w.maxCycles : DEFAULT_MAX_CYCLES };
  }
  const agentsByKey = {};
  const agentKeys = new Set();
  for (const nc of Object.values(nodeCtx)) {
    if (nc.kind !== 'agent') continue;
    agentsByKey[nc.key] = nc.meta;
    agentKeys.add(nc.key);
  }
  const scriptsByKey = {};
  const scriptKeys = new Set();
  for (const nc of Object.values(nodeCtx)) {
    if (nc.kind !== 'script') continue;
    scriptsByKey[nc.key] = nc.meta;
    scriptKeys.add(nc.key);
  }
  return { template, ports, loops: classifyLoops(template, ports), nodes: nodeCtx, wires, agentsByKey, agentKeys, scriptsByKey, scriptKeys };
}
