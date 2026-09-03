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
import { join, isAbsolute } from 'node:path';
import { rm } from 'node:fs/promises';

import {
  RunHarness, isAbort, isPause, pauseErr, firstLine, jsonClone,
  clipMiddle, sumStepActive, normalizeClarifyAnswer,
} from './run-harness.mjs';
import { resolveGraph, loadAgentFile, GRAPH_DEFAULT_WORKFLOW } from './workflows.mjs';
import { classifyLoops } from '../shared/graph/loops.mjs';
import { buildGraphManifest, manifestTemplate, manifestPortsFn } from '../shared/graph/manifest.mjs';
import { DEFAULT_MAX_CYCLES } from '../shared/graph/constants.mjs';
import { registryPortsFn } from './graph/registry-ports.mjs';
import { createScheduler, sliceExecutionId, QUIESCENCE_WARNING } from './graph/scheduler.mjs';
import { runExecution, allocateOutputs, allocateVerdict, readDecomposition } from './graph/executor.mjs';
import { renderPromptArtifact } from './phases.mjs';
import { modelHasBaseUrlRouting } from './config.mjs';
import {
  appendAudit, writeReview, reviewKindOf, writeDecomposition, updateTaskStatus,
  updatePhaseStatus, writeStepQuestions, readStepQuestions,
} from './artifacts.mjs';
import { readQuestionsFile } from './protocol.mjs';
import { classifyError } from './recoverable-error.mjs';
import { resolveFailure, markTerminal, isTerminal } from './failure-policy.mjs';

/** Max ask-then-resume question rounds per execution (mirrors v1's constant). */
const MAX_QUESTION_ROUNDS = 3;

function abortError(msg = 'aborted') {
  const e = new Error(msg);
  e.name = 'AbortError';
  return e;
}

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
    this._scheduler = null;
    this._graphSnapshot = null;  // last CLEAN scheduler snapshot
    this._resumeSnapshot = null; // the snapshot a resume restores from
    this._resumeSessions = null; // Map executionId -> sessionId (one-shot)
    this._graphError = null;     // first genuine execution error (identity preserved)
    this._planVersion = 0;       // {vsuffix} ticks, carried across a resume
    this._taskArtifact = null;   // the pre-rendered task document
    this.extrasFiles = [];
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
    const resolved = await resolveGraph(this.projectDir, this.workflowId, registry, this.agentsDir, {
      isWorkspace: this.isWorkspace,
    });
    this._adoptResolvedGraph(resolved);
    // The manifest is built from the RESOLVED template, the resolver's registry
    // slice and its EFFECTIVE per-node/per-wire values (P2 contract): the run
    // monitor shows exactly what the engine will run.
    const manifest = buildGraphManifest(this.resolved.template, this.resolved.agentsByKey, {
      overlays: { nodes: this.resolved.nodeCtx, wires: this.resolved.wires },
    });
    return {
      manifest,
      agentKeys: new Set(this.resolved.agentKeys),
      workflow: { id: this.workflowId, name: this.resolved.template.name || this.workflowId },
    };
  }

  /**
   * Adopt a resolveGraph result (P2 contract: { template, ports, loops, nodes,
   * wires, agentsByKey, agentKeys }). The resolver has ALREADY applied the
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
    if (resume) await this._restoreFromResumePoint(resume);   // Task 6 (hook-4 companion)
    const { ports, loops } = this.resolved;
    this.extrasFiles = await this._collectExtras();
    // The task document is pre-rendered ONCE: the Task card publishes it and
    // every entry agent binds that same file. Byte-identical to v1's seeded task
    // file (the same renderer), so the Task card's document matches what v1
    // handed its entry node.
    this._taskArtifact = { text: renderPromptArtifact(this.pipeline.promptText, this.extrasFiles) };

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
      guardrailsId: this.guardrailsId,
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
    this._emit('exec', { ...payload, costUsd: step ? (step.costUsd || 0) : 0 });
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
      if (node.kind !== 'agent') return await this._runFlow(ctx);
      this._checkCostLimits();                  // budget gate at EVERY agent launch (throws pauseErr)
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
      model: nc.model || this.claude.model,
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
        endpointRouted: modelHasBaseUrlRouting(nc.model || this.claude.model),
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
        agentKey: ctx.node?.key ?? null,
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
      const { questions, malformed } = await readQuestionsFile(qPath);
      if (!questions.length) {
        if (malformed) {
          await appendAudit(this.pipeline.dir, `${agentLabel}: questions file was malformed — proceeding without asking (round ${round}).`).catch(() => {});
        }
        break;
      }
      this._checkAbort();
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
    this._adoptResolvedGraph(resolvedFromManifest(manifest, this.registry));
    // §9.4, unchanged messages: the providing plugin may have been disabled or
    // uninstalled while this run sat paused. (Same place v1 re-preflights.)
    this._preflightAgentKeys(this.resolved.agentKeys);
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
 * @returns {{template:object, ports:Function, loops:object, nodes:Record<string,object>, wires:Record<string,{maxCycles:number}>, agentsByKey:Record<string,object>, agentKeys:Set<string>}}
 */
export function resolvedFromManifest(manifest, registry) {
  const reg = registry && typeof registry === 'object' ? registry : {};
  const template = manifestTemplate(manifest);   // restores node.config + loop wire config.maxCycles verbatim
  const manPorts = manifestPortsFn(manifest);
  const regPorts = registryPortsFn(reg);
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
    if (nc.kind === 'agent') nc.duplicateKey = (keyCounts.get(nc.key) || 0) > 1;
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
  return { template, ports, loops: classifyLoops(template, ports), nodes: nodeCtx, wires, agentsByKey, agentKeys };
}
