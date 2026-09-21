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
import { join, isAbsolute, extname } from 'node:path';
import { rm, readFile } from 'node:fs/promises';

import {
  RunHarness, isAbort, isPause, pauseErr, firstLine, jsonClone,
  clipMiddle, sumStepActive, normalizeClarifyAnswer, findDisabledPluginFor,
} from './run-harness.mjs';
import { resolveGraph, loadAgentFile, GRAPH_DEFAULT_WORKFLOW, writeGraphWorkflow, readWorkflow } from './workflows.mjs';
import { loadScriptRegistry } from './script-registry.mjs';
import { AUTO_WORKFLOW_ID, AUTO_WORKFLOW_NAME } from './graph/builtin-workflows.mjs';
import { classifyLoops } from '../shared/graph/loops.mjs';
import { buildGraphManifest, manifestTemplate, manifestPortsFn } from '../shared/graph/manifest.mjs';
import { DEFAULT_MAX_CYCLES, KEYED_KINDS } from '../shared/graph/constants.mjs';
import { scriptNodeCtx, pythonMissingSentence } from '../shared/graph/script-meta.mjs';
import { probePython } from './graph/python-probe.mjs';
import { mockEnabled } from './claude-runner.mjs';
import { registryPortsFn } from './graph/registry-ports.mjs';
import { createScheduler, sliceExecutionId, QUIESCENCE_WARNING } from './graph/scheduler.mjs';
import { runExecution, allocateOutputs, allocateVerdict, readDecomposition } from './graph/executor.mjs';
import { renderPromptArtifact } from './phases.mjs';
import { listModels, modelHasBaseUrlRouting, resolveRunConfig } from './config.mjs';
import { assembleShape, ShapeError } from '../shared/graph/assemble.mjs';
import { fingerprintProject } from './auto/fingerprint.mjs';
import { classifyTask, ClassifierError } from './auto/classify.mjs';
import { autoCandidates, findEquivalentWorkflow } from './auto/match.mjs';
import { buildProposal, sanitizeProposalAnswer, remapTunables, mintAutoWorkflowId } from './auto/proposal.mjs';
import { resolveAutoModel } from './auto/model.mjs';
import {
  appendAudit, writeReview, reviewKindOf, writeDecomposition, updateTaskStatus,
  updatePhaseStatus, writeStepQuestions, readStepQuestions,
} from './artifacts.mjs';
import { readAskFile } from './protocol.mjs';
import { prepareFormAsk, formAnswerValidator, downgradeQuestion } from './ask-forms.mjs';
import { classifyError } from './recoverable-error.mjs';
import { resolveFailure, markTerminal, isTerminal } from './failure-policy.mjs';

/** Max ask-then-resume question rounds per execution (mirrors v1's constant). */
const MAX_QUESTION_ROUNDS = 3;

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
    this._taskArtifact = null;   // the pre-rendered task document
    this.extrasFiles = [];
    // Auto workflow (spec §5): the decision loop's state. `feedback`/`round`/`prior`
    // ride the resume point while the run is undecided; `costUsd` is the running
    // classifier spend shown in the proposal. `pending` = the proposal that is OPEN
    // (or the round a cost cap parked), replayed on resume without a classifier call.
    // `classify` is the test seam.
    this._auto = { feedback: [], round: 0, prior: null, costUsd: 0, pending: null };
    this._classify = typeof opts?.classify === 'function' ? opts.classify : null;
    Object.assign(this.state, {
      engine: 2,
      active: [],                // [{nodeId, executionId}]
      endReached: false,
      result: null,              // {type, path?, value?} | null
      warnings: [],
      wireDeliveries: {},        // {[wireId]: n}
      tokens: {},                // {'<node>.<port>': {seq,type,path,firedAt}}
      gate: null,                // {wireId, fromNode, toNode, askId} | null
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
    const resolved = await resolveGraph(this.projectDir, this.workflowId, registry, this.agentsDir, {
      isWorkspace: this.isWorkspace, scripts: this.scriptRegistry,
    });
    this._adoptResolvedGraph(resolved);
    this._preflightScriptKeys(this.resolved.scriptKeys);
    await this._preflightScriptRuntimes();
    // The manifest is built from the RESOLVED template, the resolver's registry
    // slice and its EFFECTIVE per-node/per-wire values (P2 contract): the run
    // monitor shows exactly what the engine will run.
    const manifest = buildGraphManifest(this.resolved.template, this.resolved.agentsByKey, {
      overlays: { nodes: this.resolved.nodeCtx, wires: this.resolved.wires }, scripts: this.resolved.scriptsByKey,
    });
    return {
      manifest,
      agentKeys: new Set(this.resolved.agentKeys),
      workflow: { id: this.workflowId, name: this.resolved.template.name || this.workflowId },
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
    const models = await listModels(this.projectDir);
    const model = resolveAutoModel(models);
    const fingerprint = await fingerprintProject(this.projectDir);
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
        classifyFor = classify;
      }
      let outcome;
      try {
        outcome = await this._autoRound({ registry, models, model, fingerprint, extras, taskText, classify: classifyFor, round });
      } catch (err) {
        if (isAbort(err) || isPause(err)) throw err;
        if (pending && err instanceof ShapeError) {
          // The saved shape no longer assembles (the registry changed while the run was parked):
          // drop it and classify afresh in THIS resume instead of parking the run a second time.
          this._log('orchestrator', 'warn', `auto: the saved proposal no longer assembles (${firstLine(err.message)}); classifying afresh`);
          this._auto.pending = null;
          continue;
        }
        if (err instanceof ClassifierError || err instanceof ShapeError) {
          // spec D17 / §5.6: the shell's failure policy parks the run (setup site ⇒
          // pause, reason 'error', detail = the message) and the resume point keeps
          // auto.status 'deciding' + this loop's state, so resume() re-decides.
          this._log('orchestrator', 'warn', `auto: classifier failed: ${firstLine(err.detail || err.message)}`);
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
  async _autoRound({ registry, models, model, fingerprint, extras, taskText, classify, round }) {
    const input = {
      taskText, extras, fingerprint, models, registry,
      domain: 'coding',                                // the domain the assembler stamps: coding + shared + general agents are offered
      humanInLoop: this.humanInLoop, feedback: [...this._auto.feedback], priorShape: this._auto.prior,
      // D6 amendment (2026-09-07): the classifier may Grep/Glob/Read the RUN'S OWN checkout to
      // size the change — this.runCwd is set by _setupRunRoot before the run() hook
      // (run-harness.mjs:1641) and rehydrated before the resume() hook (:1360). It is never the
      // user's live checkout. With no worktree (not a case a project run reaches today) it
      // falls back to the scratch dir, text-only, exactly as before. (A detached WORKSPACE run's
      // runCwd is the neutral run root whose repos/<key>/ checkouts sit below it — still readable.)
      model, cwd: this.runCwd || this.pipeline.dir, repoLook: !!this.runCwd, bin: this.claude.bin, mock: this.claude.mock,
      // Stop OR pause ends the call (the same composition every node spawn uses).
      signal: AbortSignal.any([this.abort.signal, this.pauseAbort.signal]),
      envScrub: this.guardrails?.envScrub || undefined,
      envAllowlist: this.guardrails?.envScrub ? this.guardrails.envAllowlist : undefined,
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
      if (spent > 0 || err?.usage) this._recordAutoCost(round, { costUsd: spent, usage: sumUsage(classified?.usage, err?.usage) }, startedAt, model, { checkCaps: false });
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
    });
    this._log('orchestrator', 'info',
      `auto: round ${round} proposed "${proposal.name}" (${Object.keys(proposal.nodes).length} agents) — ${match ? `same shape as saved workflow "${match.candidate.name}" (${match.candidate.id})` : 'no saved workflow has this shape; Accept saves a new one'}`);
    return { proposal, template, match, tunables, shape: assembled.shape };
  }

  /** Ask the proposal ONCE; the validator keeps the question OPEN on a malformed
   *  answer (spec §5.4) and the awaiting code receives the sanitised payload. */
  async _autoAsk(proposal, models, registry) {
    const validate = (raw) => sanitizeProposalAnswer(raw, { proposal, models, registry });
    const raw = await this._ask({ id: `auto-${proposal.round}`, kind: 'workflow', workflow: proposal, validate });
    return raw && raw.decision ? raw : validate(raw);   // auto mode answers { decision: 'accept' } without the validator
  }

  /** Reuse the twin or save a new row, resolve it with the accepted tunables as the ONLY overlay, re-stamp the manifest. */
  async _autoAdopt({ template, match, tunables, shape, answer, registry, round }) {
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
    const resolved = await resolveGraph(this.projectDir, workflowId, registry, this.agentsDir, {
      isWorkspace: false, overlay: { nodes: overlayNodes }, ignoreProjectOverrides: true, scripts: this.scriptRegistry,
    });
    if (!this.humanInLoop) {
      // spec D3: no agent may stop the run to ask (generic — every agent node).
      for (const nc of Object.values(resolved.nodes)) if (nc.kind === 'agent') nc.askQuestions = false;
    }
    this.workflowId = workflowId;
    this._adoptResolvedGraph(resolved);
    const manifest = buildGraphManifest(this.resolved.template, this.resolved.agentsByKey, {
      overlays: { nodes: this.resolved.nodeCtx, wires: this.resolved.wires }, scripts: this.resolved.scriptsByKey,
    });
    manifest.auto = { status: 'decided', via, rounds: round, humanInLoop: this.humanInLoop, workflowId };
    this._preflightAgentKeys(this.resolved.agentKeys);
    this._preflightScriptKeys(this.resolved.scriptKeys);
    await this._preflightScriptRuntimes();
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
    this._log('orchestrator', 'info', `auto: accepted → "${name}" (${workflowId}, ${via})`);
    await appendAudit(this.pipeline.dir, `Auto workflow: **${name}** — ${via === 'reused' ? `reusing saved workflow ${workflowId}` : `saved as ${workflowId}`}.`).catch(() => {});
    return { manifest, agentKeys: new Set(this.resolved.agentKeys), workflow: { id: workflowId, name: this.resolved.template.name || name } };
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
  _recordAutoCost(round, classified, startedAt, model, { checkCaps = true } = {}) {
    const costUsd = Number.isFinite(Number(classified?.costUsd)) ? Number(classified.costUsd) : 0;
    const usage = classified?.usage || {};
    this._auto.costUsd = Math.round((this._auto.costUsd + costUsd) * 1e6) / 1e6;
    const rec = {
      id: `auto-classify-${round}`, label: `Auto workflow (round ${round})`, status: 'finished',
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
    this._recordCost(costUsd, 'x:preflight:1');
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
    if (resume?.manifest?.auto?.status === 'deciding') resume = null;
    if (resume) await this._restoreFromResumePoint(resume);   // Task 6 (hook-4 companion)
    const { ports, loops } = this.resolved;
    this.extrasFiles = await this._collectExtras();
    // The task document is pre-rendered ONCE: the Task card publishes it and
    // every entry agent binds that same file. Byte-identical to v1's seeded task
    // file (the same renderer), so the Task card's document matches what v1
    // handed its entry node.
    // A Memory defragment run appends the scope's health (run-harness.mjs _defragBrief — '' on
    // every other run, so their document stays byte-identical).
    this._taskArtifact = { text: renderPromptArtifact(this.pipeline.promptText, this.extrasFiles) + await this._defragBrief() };

    const sched = createScheduler({
      template: this._schedulerTemplate(),
      portsFn: ports,
      loops,
      execute: this._execute.bind(this),
      onEvent: (name, payload) => this._onSchedulerEvent(name, payload),
      onSnapshot: (snap) => {
        // Freeze at the last CLEAN completion once a pause is requested: the
        // executions this pause kills must stay NON-TERMINAL in the persisted
        // point so the scheduler re-invokes them on resume.
        if (this.pauseRequested) return;
        this._graphSnapshot = snap;
        // Keep a resumable point on the row at all times: a crash-reconciled
        // ('interrupted') v2 run is then resumable from its last clean snapshot.
        // The base clears it on done and on stop. (No extra _persist — the next
        // _execStep writes it.)
        this.state.resumePoint = this._buildResumePoint(snap);
      },
      // P3 contract: onGate is the state.gate NOTIFIER ({wireId, fromNode, toNode,
      // askId} | null); onAsk is the ONE ask channel (gates today).
      onGate: (g) => { this.state.gate = g ? { ...g } : null; this._emit('state', this.getState()); },
      onAsk: (q) => this._schedulerAsk(q),
      // The scheduler's log is ONE-ARG (`log(QUIESCENCE_WARNING)`, scheduler.mjs:936).
      log: (line, attrs = null) => this._log('orchestrator', 'warn', String(line), attrs),
    });
    this._scheduler = sched;
    if (resume && this._resumeSnapshot) {
      this._graphSnapshot = this._resumeSnapshot;
      sched.reattach(this._resumeSnapshot);
    }

    let outcome;
    try {
      outcome = await sched.run();
    } finally {
      this._scheduler = null;
      this.state.active = [];
      this._syncSchedulerState(sched);
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
      stepModels: this.stepModels,
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
      guardrailsId: this.guardrailsId,
      memoryScope: this.memoryScope || null,   // agent memory §7.3: a paused defrag resumes with ONE scope (B10)
      checkpointRef: this.checkpointRef || null,
      checkpointRefs: { ...this.checkpointRefs },
      workspace: this.isWorkspace ? { projects: this._workspaceProjects() } : null,
      pauseReason: this.pauseReason || null,
      pauseDetail: this.pauseDetail || null,
      // The EFFECTIVE instruction at dispatch time (post in-worktree graph
      // build), not the detect-time tools.instruction.
      toolInstruction: this.toolInstruction ?? '',
      pipelineDir: this.pipeline.dir,
      pausedAt: new Date().toISOString(),
    };
  }

  /** Per-member worktree facts the v1 point kept under rp.bus.workspace. */
  _workspaceProjects() {
    return this.members.map((m) => ({
      projectKey: m.projectKey,
      projectDir: m.projectDir,
      projectName: m.projectName,
      worktreeDir: this.workDirs.get(m.projectKey) || null,
      graphInstruction: this.toolInstructions.get(m.projectKey) || '',
    }));
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
    if (Array.isArray(s.warnings)) this.state.warnings = [...s.warnings];
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
      if (payload.status !== 'held' && this.pipeline) {
        appendAudit(
          this.pipeline.dir,
          `Loop gate on wire ${payload.wireId} (${payload.nodeId}): the user chose **${payload.status}**.`,
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
    this._emit('exec', {
      ...payload, costUsd: step ? (step.costUsd || 0) : 0,
      ...(step && step.runtime != null ? { runtime: step.runtime } : {}),
      ...(step && step.exitCode != null ? { exitCode: step.exitCode } : {}),
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
    return this._enqueueAsk(() => this._ask(q)).then(
      (payload) => {
        if (q.kind === 'gate') return payload?.decision === 'another' ? 'another' : 'continue';
        return payload;
      },
      (err) => {
        if (isPause(err) || this.pauseRequested) this._scheduler?.pause();
        else this._scheduler?.abort();
        return new Promise(() => {});   // never settles: the hold survives (see above)
      },
    );
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
    pq.resolve(pq.kind === 'gate' ? { decision: 'continue' } : { answers: [] });
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
    // row ends 'paused' either way and the whole fan-out re-runs on resume.
    if (args.composite) {
      try {
        if (args.composite === 'expand') return await this._expandDecomposition(node, args);
        if (args.composite === 'phase') return this._compositePhase(args);
        return await this._finishComposite(nc, args);
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
    this._execStep(ctx, 'start');
    let endMark = 'done';
    try {
      // A real DB write — inside the try: a throw here pauses like anything
      // else, and the finally skips updateTaskStatus for a 'paused' mark.
      if (ctx.slice) updateTaskStatus(this.pipeline.id, ctx.slice.id, 'running', new Date().toISOString());
      // Exactly what v1's dispatcher loop does at every step boundary
      // (orchestrator.mjs:259-261): a stop or pause requested while nothing was
      // in flight (e.g. between executions, or during a flow card) must land
      // here, not on the next spawn.
      this._checkAbort();
      this._checkPause();
      if (!KEYED_KINDS.includes(node.kind)) return await this._runFlow(ctx);
      this._checkCostLimits();                  // budget gate at EVERY spawn (throws pauseErr)
      if (node.kind === 'script') {
        // A child process through the NODE site: every runner error carries
        // errorClass:null (D9), so _recover lands on the '*' row — pause as
        // REASON.ERROR, resumable, never a "network" retry. No questions, no session.
        const result = await this._runNodeAttempts(nc, ctx);
        await this._afterExecution(nc, ctx, result);
        return result;
      }
      this._primeQuestions(nc, ctx);
      let result = await this._runNodeAttempts(nc, ctx);
      result = await this._questionsLoop(nc, ctx, result);
      await this._afterExecution(nc, ctx, result);
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
      this._execStep(ctx, endMark);
      // A PAUSED slice stays 'running': the resume re-runs the whole composite,
      // and a task that never finished must not read as done.
      if (ctx.slice && endMark !== 'paused') {
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
    const runCtx = {
      pipelineDir: this.pipeline.dir,
      projectDir: this.projectDir,
      baseName: this.baseName,
      datePrefix: this.planDatePrefix,
      workspaceKey: this.workspaceKey || undefined,
      duplicateKey: !!nc.duplicateKey,
      // Composite slices share their parent's ordinal, so their run-store outputs
      // and verdict are additionally slice-prefixed (the executor's dupPrefix
      // reads runCtx.slice as a STRING).
      slice: slice ? slice.id : undefined,
      planVersion: () => (this._planVersion += 1),
    };
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
      model: nc.kind === 'script' ? null : (nc.model || this.claude.model),
    };
    return {
      // Consumed as `cwd` by phases.mjs (runOpts). runCwd is the run root on a
      // detached workspace run, the member worktree on a detached single run,
      // today's workDir under legacy.
      projectDir: this.runCwd || this.workDir,
      runRoot: this.runRoot,
      mcpConfigPath: this.mcpConfigPath,
      mcpServerGrants: this.mcpServerGrants,
      repos: this._reposCtx(),
      pipelineDir: this.pipeline.dir,
      pipelineId: this.pipeline.id,
      taskPrompt: this.pipeline.promptText,
      toolInstruction: this.toolInstruction,
      memoryBlock: this.memoryBlock || '',              // §4.3: the pointer block, rendered once per mount (names the WRITABLE dirs)
      memoryMount: this.memory?.mount || null,          // the WRITABLE copy: <pipeline.dir>/memory (agents, the defrag mock and tests write here; runOpts passes it as --add-dir)
      memoryRules: this.memory?.rules || null,          // the read-only rules copy inside the cwd (tests read it; agents never write it)
      agentPrompts: this.agentPrompts,
      checkpointRef: this.checkpointRef,
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
        fanOut: !!nc.fanOut,
        subagentModel: nc.subagentModel || '',
        // Same fallback as claudeOpts.model below: the flag must describe the
        // model the spawn will actually use, global default included. Live
        // catalog on purpose — a resume re-resolves the env the same way. One
        // settings + plugins-lock read per dispatch; never call this per entry.
        endpointRouted: nc.kind === 'agent' ? modelHasBaseUrlRouting(nc.model || this.claude.model) : false,
        agentPrompt: nc.agentPrompt,
        tools: nc.tools,               // frontmatter grants MUST be stamped
        promptHints: nc.promptHints || '',
      },
      nodeId: node.id,
      executionId,
      ordinal,
      cycle: ordinal,
      slice,
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
      resumeSessionId: this._takeResumeSession(executionId),
      ask: (q) => this._enqueueAsk(() => this._ask(q)),
      onEvent: (e) => this._onAgentEvent(nc.key || node.kind, e, attr),
      claudeOpts: {
        bin: this.claude.bin,
        permissionMode: this.claude.permissionMode,
        model: nc.model || this.claude.model,  // per-node, falling back to global
        effort: nc.effort,                     // per-node effort (undefined when unset)
        permissionRules: this.guardrailPermissionRules || undefined,
        envScrub: this.guardrails?.envScrub || undefined,
        envAllowlist: this.guardrails?.envScrub ? this.guardrails.envAllowlist : undefined,
        mock: this.claude.mock,
      },
    };
  }

  /** ONE-SHOT session re-attach: an executionId is consumed the first time it is
   *  asked for, so a recovery retry or a fix cycle never re-attaches a stale
   *  session. Composite slices re-run whole and are never in the map. */
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
    }
    this._emit('state', this.getState());
    this._persist().catch(() => {});
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
        return await this._runOnce(nc, ctx);
      } catch (err) {
        if (this.pauseRequested && (isAbort(err) || isPause(err) || this.pauseAbort.signal.aborted)) throw pauseErr();
        if (isAbort(err) || isPause(err)) throw err;
        if (this.abort.signal.aborted || this.state.status === 'stopped') throw err;  // a stop is in flight: _execute marks it 'stopped'
        const cls = classifyError(err);
        const verdict = await this._recover({ node: { key: nc.key || ctx.nodeId }, cls, err, attempt });
        if (this.pauseRequested) throw pauseErr();          // a pause landed during backoff/prompt: its reason stands
        if (verdict.outcome === 'retry') { this._execStep(ctx, 'start'); continue; }   // back to running for the retry
        if (verdict.outcome === 'pause') { this._pauseFor(verdict.reason, err, { nc, ctx, cls }); throw pauseErr(); }
        throw markTerminal(err);                           // terminal: _execute's catch ends the run
      }
    }
  }

  /** One invocation of this execution's executor (P3's runExecution, with the
   *  injected runners as the seam), plus the vanished-session fresh re-run
   *  fallback (a dead `--resume` session must not fail the run). */
  async _runOnce(nc, ctx) {
    try {
      return await runExecution(ctx, { runners: this._runners });
    } catch (err) {
      if (ctx.resumeSessionId && !isAbort(err) && !isPause(err) && !this.pauseRequested) {
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
    // `missing` = the verifier never wrote its verdict (MAJ-10). Persisting that as
    // a zero-issue row makes History render a genuine-looking clean review of work
    // nobody reviewed, so the row is SKIPPED; the run log + state.warnings carry it.
    if (this.pipeline && ctx.verdict?.path && result?.verdict && !result.verdict.missing) {
      await writeReview(this.pipeline.id, this._verdictKind(nc, ctx), ctx.ordinal, result.verdict);
    }
    const seen = new Set();
    for (const port of ctx.ports?.outputs || []) {
      const path = ctx.outputs?.[port?.id]?.path;
      if (!path || seen.has(path)) continue;
      seen.add(path);
      this._artifact(port.artifactKind || port.id, path, {
        nodeId: ctx.nodeId, executionId: ctx.executionId, port: port.id, cycle: ctx.ordinal,
      });
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
    if (nc.meta?.sideEffect === 'code' && !ctx.slice) await this._stageWorkingTree();
  }

  /** reviews.kind, derived from the verdict FILENAME minus `-cycle{cycle}.json`
   *  and mapped through artifacts.reviewKindOf (a table: `impl-review`→`impl`,
   *  `plan-review`→`plan`, `refine-review`→`refine`, `ws-review`→`ws`,
   *  `webui-review`→`webui`; an unknown stem passes through unchanged). Zero
   *  agent-key coupling. */
  _verdictKind(nc, ctx) {
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
    const enabled = !!nc.askQuestions && nc.runnerType !== 'clarifier' && !this.auto && !ctx.slice;
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
      if (prepared.ok) return { ask: prepared.ask, autoValues: prepared.autoValues, questions: [], result };

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
      if (read.kind === 'form') {
        // Gate 2 (spec §5). It may spawn ONE repair round of its own, whose
        // result becomes this round's result; it never consumes a round.
        const gate = await this._prepareFormAsk(nc, ctx, read, qPath, round, agentLabel);
        if (gate.result !== undefined) result = gate.result;
        formAsk = gate.ask;
        autoValues = gate.autoValues;
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
        const values = (answered && typeof answered === 'object' && answered.values) || {};
        await writeStepQuestions(this.pipeline.id, stepKey, round, {
          agentKey: nc.key, nodeId: ctx.nodeId,
          answers: { kind: 'form', form: formAsk.form, version: formAsk.version, values },
        });
        await appendAudit(this.pipeline.dir, `${agentLabel}: form "${formAsk.form}" answered (round ${round}).`).catch(() => {});
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
      await writeStepQuestions(this.pipeline.id, stepKey, round, {
        agentKey: nc.key, nodeId: ctx.nodeId, answers: { answers: enriched },
      });
      await appendAudit(this.pipeline.dir, `${agentLabel}: ${enriched.length} answer(s) received (round ${round}).`).catch(() => {});
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
    const { phases } = await readDecomposition(token?.path);
    const attr = { nodeId: node.id, executionId: args.executionId, cycle: args.ordinal || 1 };
    if (!phases.length) {
      this._log(node.id, 'warn',
        `no runnable phases in the decomposition bound to "${args.expandsPort}"`
        + `${token?.path ? ` (${token.path})` : ''} — running one normal execution instead`, attr);
      await appendAudit(this.pipeline.dir,
        `${node.id}: the decomposition on \`${args.expandsPort}\` carried no runnable phases — `
        + 'running one normal execution with that input unbound.').catch(() => {});
      return { phases: [] };
    }
    const resolved = phases.map((ph) => ({
      ordinal: ph.ordinal,
      tasks: ph.tasks.map((t) => ({
        ...t,
        nodeId: sliceExecutionId(args.executionId, t.id),
        path: isAbsolute(t.file || '') ? t.file : join(this.pipeline.dir, t.file || ''),
      })),
    }));
    writeDecomposition(this.pipeline.id, resolved);
    const count = resolved.reduce((n, ph) => n + ph.tasks.length, 0);
    await appendAudit(this.pipeline.dir,
      `${node.id}: expanded into ${resolved.length} phase(s), ${count} task(s).`).catch(() => {});
    return { phases: resolved };
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
    if (nc.meta?.sideEffect === 'code') await this._stageWorkingTree();
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
    this._planVersion = Number.isFinite(rp.planVersion) ? rp.planVersion : 0;
    this._clearPauseReason();
    const manifest = rp.manifest || this.state.stepper;
    this.state.stepper = manifest;
    this.scriptRegistry = loadScriptRegistry({ scriptsDir: this.opts.scriptsDir, agentKeys: Object.keys(this.registry || {}) });
    this._adoptResolvedGraph(resolvedFromManifest(manifest, this.registry, this.scriptRegistry));
    // §9.4, unchanged messages: the providing plugin may have been disabled or
    // uninstalled while this run sat paused. (Same place v1 re-preflights.)
    this._preflightAgentKeys(this.resolved.agentKeys);
    this._preflightScriptKeys(this.resolved.scriptKeys);
    await this._preflightScriptRuntimes();
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
    // never re-attaches, and a composite slice re-runs whole.
    this._resumeSessions = new Map(
      (this.resumeOpts?.steps || [])
        .filter((s) => s.status === 'paused' && s.sessionId)
        .map((s) => [s.key, s.sessionId]),
    );
  }
}

/**
 * Rebuild a resolveGraph-shaped result from a PERSISTED manifest + the live
 * registry. The manifest is authoritative for topology, port identity (ids/
 * types/loop/expands/when), per-node model/effort/askQuestions/awaitAll/fanOut/subagentModel/
 * config and per-wire maxCycles; the registry supplies only what a manifest
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
      askQuestions: !!mn.askQuestions,
      awaitAll: !!mn.awaitAll,
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
