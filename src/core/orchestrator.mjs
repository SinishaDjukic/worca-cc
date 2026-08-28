// src/core/orchestrator.mjs
// The deterministic state machine that sequences the whole pipeline:
//
//   preflight
//     -> ensure git repo + checkpoint
//     -> planner clarify       (single round; ask up to four questions, or none)
//     -> planner plan
//     -> refine loop           (refiner; stop when no blocking; gate past max)
//     -> implementer (implement)
//     -> review loop           (reviewer; fix; stop when no blocking; gate past max)
//     -> done
//
// It is an EventEmitter. Consumers (CLI, UI) subscribe to events and drive
// interaction via answer()/stop(). Pending questions are modeled as promises
// that resolve when answer(id, payload) is called (or immediately when auto).

import { join, resolve, dirname, basename } from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';

import {
  appendAudit, planPath, today, writeReview, reviewKindOf,
  writeDecomposition, updateTaskStatus, updatePhaseStatus,
  writeStepQuestions, readStepQuestions,
} from './artifacts.mjs';
import { hasBlocking, blockingIssues, readQuestionsFile } from './protocol.mjs';
import { runClarify } from './phases.mjs';
import { runners as defaultRunners } from './runners.mjs';
import { classifyError } from './recoverable-error.mjs';
import { resolveWorkflow, buildStepperManifest, rewriteStepperForDecomposition, LEGACY_DEFAULT_ID } from './workflows.mjs';
import { allocate, bindInputs, publish, legacyFields, entrySeedChannels, renderPromptArtifact } from './channels.mjs';
import { collectChannelDefs } from './agent-registry.mjs';
import { validateWorkflow } from './workflow-validator.mjs';
import {
  RunHarness, ERR_STREAM, errStreamAttr, isAbort, isPause, pauseErr, sumStepActive, firstLine,
  numOr, jsonClone, clipMiddle, normalizeClarifyAnswer, SKILLS_MAX, skillLabel, mergeSkills,
} from './run-harness.mjs';

export { isAbort, errStreamAttr }; // public surface kept (test/abort-classify, test/log-provenance)

/** The distinct agent keys of a resolved v1 plan, in first-seen order — the
 *  shape the harness's preflight and skills gates take. */
function planAgentKeys(plan) {
  const keys = new Set();
  for (const group of plan?.steps || []) for (const node of group) keys.add(node?.key);
  return keys;
}

/**
 * Node keys that fan out across member projects on a workspace run (§5.6 / C4).
 * The orchestrator forces `node.fanOut=true` on these when isWorkspace, unlocking
 * the Task/Agent tool via effectiveAllowedTools. NOTE the set lists
 * `workspaceReviewer`, NOT `reviewer`: on a workspace run the review node is
 * substituted to `workspaceReviewer` (the synthesizer) at resolve time
 * (workflows.mjs, gated on isWorkspace), so it IS in this set and gets
 * fanOut=true here. `reviewer` never appears in a workspace plan — it is the
 * single-project review node only.
 */
const FANOUT_ELIGIBLE = new Set([
  'planner', 'refiner', 'implementer', 'planReviewer', 'workspaceReviewer',
]);

/** Max ask-then-resume question rounds per node run (spec 2026-07-11 §5). */
const MAX_QUESTION_ROUNDS = 3;

/**
 * Build the synthetic implementer node for one decomposed task. Pure (exported for
 * tests). `siblings` carries the OTHER tasks of the same phase so the implementer
 * prompt can warn about the shared working tree (see implementerBody).
 * @param {{model?:string,effort?:string,tools?:string[],fanOut?:boolean}} implNode the original implementer node
 * @param {{id:string,nodeId:string,title?:string,file?:string}} task
 * @param {Array<{id:string,title?:string,file?:string}>} phaseTasks all tasks of the task's phase
 * @param {string} pipelineDir
 */
export function decomposedTaskNode(implNode, task, phaseTasks, pipelineDir) {
  return {
    nodeId: task.nodeId,
    key: 'implementer',
    uiPhase: 'implement',
    runnerType: 'producer',
    decomposedTask: true,
    model: implNode.model,
    effort: implNode.effort,
    tools: implNode.tools,
    fanOut: implNode.fanOut, // inherit so each per-task implementer fans out when the run does
    askQuestions: false,     // parallel task shards never gate the user (spec §5)
    taskPath: join(pipelineDir, task.file || ''),
    siblings: (Array.isArray(phaseTasks) ? phaseTasks : [])
      .filter((t) => t && t !== task)
      .map((t) => ({ id: t.id, title: t.title, file: t.file })),
    produces: ['code'],
    consumes: ['plan'],
  };
}

/**
 * Create an orchestrator instance.
 *
 * @param {object} opts
 * @param {string} opts.projectDir
 * @param {string} [opts.prompt]
 * @param {string} [opts.promptFile]
 * @param {object} [opts.source]  task-source descriptor (sources.mjs#resolveTaskInput):
 *                                { type:'prompt', prompt } | { type:'markdown', promptText?, promptFile? }
 *                                | { type:'plugin', plugin, sourceId, taskId }. Absent => legacy prompt/promptFile.
 * @param {string[]} [opts.extras]
 * @param {string} [opts.title]
 * @param {object} [opts.claude]  { bin?, permissionMode="acceptEdits", model?, mock? }
 * @param {string} [opts.agentsDir]
 * @param {string} [opts.pipelineId]
 * @param {boolean} [opts.auto]   non-interactive: clarify->first option, gate->continue
 * @returns {Orchestrator}
 */
export function createOrchestrator(opts = {}) {
  return new Orchestrator(opts);
}

class Orchestrator extends RunHarness {
  // The v1 engine's default template. `wf_default` is the GRAPH after the v2
  // break, so the retired v1 topology is reachable only under its reserved id
  // (the graph orchestrator carries the mirror of this line).
  constructor(opts = {}) {
    super(opts);
    if (!opts.workflowId) this.workflowId = LEGACY_DEFAULT_ID;
  }

  // ── public control ─────────────────────────────────────────────────────────

  // ── main run ─────────────────────────────────────────────────────────────────

  // ── run-root / worktree setup ────────────────────────────────────────────────

  // ── phase helpers ─────────────────────────────────────────────────────────────

  // ── data-driven dispatcher ─────────────────────────────────────────────────

  /**
   * Walk the resolved plan's steps in order. A single-node step runs directly; a
   * multi-node step runs concurrently (Promise.all). After each step completes,
   * check active feedback loops whose `from` step just ran: if the loop's `from`
   * node returned blocking issues and the loop's cycle < maxCycles, rewind the
   * pointer to the loop's `to` step (incrementing the loop cycle) and re-run
   * forward. When a loop's cycles are exhausted, gate the user (continue/stop)
   * exactly as the legacy _reviewLoop did.
   *
   * Per-loop state lives in `loopState[fb.id] = { cycle }`; the per-step run cycle
   * passed to nodes is bumped while a loop is replaying through that step (so a
   * node's artifacts/keys are unique per re-run), defaulting to 1.
   * @param {object} plan ExecutablePlan
   * @param {{answers?:Array}} runArgs
   */
  async _dispatch(plan, runArgs = {}) {
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    const feedbacks = Array.isArray(plan?.feedbacks) ? plan.feedbacks : [];
    const resume = runArgs.resume || null;

    // D4: surface channel-reachability / governance warnings where they matter — a
    // saved-then-illegalized pipeline runs anyway, but the operator sees why a (e.g.)
    // reviewer with no upstream code reviewed an empty diff. Non-fatal. The resolved
    // node carries .nodeId; reconstruct the {id,key} template the validator expects.
    try {
      const tpl = { steps: steps.map((g) => g.map((n) => ({ id: n.nodeId, key: n.key }))), feedbacks };
      const v = validateWorkflow(tpl, this.registry || {});
      for (const w of v.warnings || []) await appendAudit(this.pipeline.dir, `Workflow warning: ${w}`);
    } catch { /* validation is best-effort at run time */ }

    // Map: source step index -> feedbacks originating there. `from` resolves to the
    // index of the step containing the from-node; `to` is a step index (tolerate a
    // node id or a numeric index).
    const nodeStepIndex = new Map();
    steps.forEach((group, i) => group.forEach((n) => nodeStepIndex.set(n.nodeId, i)));
    const toIndex = (ref) =>
      typeof ref === 'number' ? ref : (nodeStepIndex.has(ref) ? nodeStepIndex.get(ref) : Number(ref) || 0);
    const fbByFrom = new Map();
    for (const fb of feedbacks) {
      const fromIdx = toIndex(fb.from);
      if (!fbByFrom.has(fromIdx)) fbByFrom.set(fromIdx, []);
      fbByFrom.get(fromIdx).push({ ...fb, fromIdx, toIdx: toIndex(fb.to), maxCycles: numOr(fb.maxCycles, 1) });
    }
    const loopState = resume?.loopState ? JSON.parse(JSON.stringify(resume.loopState)) : {}; // fb.id -> { cycle }
    // The active run cycle per step index while a loop is replaying through it.
    const stepCycle = resume?.stepCycle?.length === steps.length
      ? [...resume.stepCycle]
      : new Array(steps.length).fill(1);

    // Typed channel bus (replaces the old `io` bag). plan/checklist are pre-seeded
    // with their default destinations (as today); code is the standing worktree
    // channel; review starts empty; userPrompt carries the prompt + clarify answers.
    // NOTE (V3-F): userPrompt.text and code.dir/baseRef are informational — no
    // legacyFields arm reads them (the planner reads only .answers; the reviewer
    // diffs ctx.checkpointRef, not code.baseRef). Tolerate undefined gracefully.
    const bus = {
      userPrompt: { kind: 'value', text: this.pipeline.promptText, answers: [] },
      clarify: null,
      decomposition: null,
      // planPath routes to the workspace store when workspaceKey is set (byte-
      // identical to today's path otherwise).
      plan: { kind: 'artifact', path: planPath(this.projectDir, this.baseName, 1, this.planDatePrefix, this.workspaceKey || undefined) },
      review: null,
      checklist: { kind: 'artifact', path: join(this.pipeline.dir, 'manual-tests-checklist.md') },
      // A detached WORKSPACE run has no single code dir: cwd is the run root and
      // every member's checkout is a `repos/<key>` subtree, so the channel carries
      // the roster instead of a meaningless scalar. Under `legacy` (and for single
      // runs in either mode) the channel keeps today's exact shape — this.runRoot is
      // null there, so the `runroot` kind can never be emitted.
      code: (this.runRootMode === 'detached' && this.isWorkspace)
        ? { kind: 'runroot', dir: this.runRoot, repos: this._reposCtx() }
        : { kind: 'worktree', dir: this.runCwd || this.workDir, baseRef: this.checkpointRef },
      // Read-only metadata channel: the frozen workspace description + member set
      // (worktree dir, checkpoint ref, per-project graph instruction). Seeded ONCE
      // here, never re-published (CONV-6). null on a single-project run.
      workspace: this.isWorkspace ? this._workspaceChannel() : null,
    };
    if (resume?.bus) {
      // Restore the paused run's channel state verbatim (paths/text/answers/dirs
      // are plain JSON). The fresh literal above only provides defaults for any
      // channel a future schema adds after the pause.
      for (const [k, v] of Object.entries(resume.bus)) bus[k] = jsonClone(v);
    }

    // Prompt-as-entry-artifact: fill any materializable channel the topology requires
    // before any step produces it (a pipeline that starts mid-stream — implementer or
    // refiner first). The user prompt + attached files stand in for the missing
    // artifact, written to the channel's seeded path so EVERY consumer (the first
    // agent AND any downstream one, e.g. a later reviewer) binds it via the normal bus.
    // Disk-only: we write the file at bus[c].path; the handle (and its path) is
    // unchanged, so the frozen per-step snapshots already point at the now-existing
    // file. A real producer later overwrites the file (latest-writer-wins), as today.
    this.extrasFiles = await this._collectExtras();
    if (!resume) {
      for (const c of entrySeedChannels(steps)) {
        const handle = bus[c];
        if (!handle?.path) continue;
        await mkdir(dirname(handle.path), { recursive: true }); // plans/ dir is lazy
        await writeFile(handle.path, renderPromptArtifact(this.pipeline.promptText, this.extrasFiles), 'utf8');
        await appendAudit(this.pipeline.dir, `Seeded "${c}" from the user prompt (no upstream producer).`);
      }
    }

    let i = resume ? Math.min(Math.max(0, resume.stepIndex | 0), steps.length) : 0;
    // One-shot session re-attach map: only the interrupted step's nodes resume their
    // captured claude sessions; every later step starts fresh.
    this._resumeNodeSessions = resume?.kind === 'node'
      ? new Map((resume.nodes || []).filter((n) => n.sessionId).map((n) => [n.nodeId, n.sessionId]))
      : null;
    let pendingGate = resume?.kind === 'gate' && resume.gate ? { ...resume.gate } : null;
    try {
      while (i < steps.length) {
        if (pendingGate) {
          // Re-enter exactly at the interrupted gate: no step re-run.
          const fb = (fbByFrom.get(i) || []).find((f) => f.id === pendingGate.fbId);
          const g = pendingGate;
          pendingGate = null;
          if (fb) {
            const st = (loopState[fb.id] ||= { cycle: g.cycle || 1 });
            this._pauseGate = { ...g };
            const decision = await this._gate(fb.id, g.cycle, g.issues || []);
            this._pauseGate = null;
            this._checkAbort();
            if (decision === 'another') {
              st.cycle = (g.cycle || 1) + 1;
              for (let k = fb.toIdx; k <= i; k++) stepCycle[k] = st.cycle;
              await appendAudit(this.pipeline.dir, `Loop ${fb.id} gate at cycle ${g.cycle}: user approved another cycle.`);
              i = fb.toIdx;
              continue;
            }
            await appendAudit(this.pipeline.dir, `Loop ${fb.id} gate at cycle ${g.cycle}: user chose to continue with open issue(s).`);
          }
          i += 1;
          continue;
        }
        this._checkAbort();
        this._checkPause();
        this._checkCostLimits();   // step-boundary budget gate (spec §6.5)
        const cycle = stepCycle[i];
        const results = await this._runStep(steps[i], i, cycle, bus);
        this._resumeNodeSessions = null; // one-shot: only the interrupted step re-attaches

        // Did any feedback originating in THIS step fire?
        const loops = fbByFrom.get(i) || [];
        let rewound = false;
        for (const fb of loops) {
          const fired = this._loopFired(fb, results); // CONV-3: gate off the loop's `from` node
          if (!fired) continue;
          const st = (loopState[fb.id] ||= { cycle: 1 });
          if (st.cycle < fb.maxCycles) {
            st.cycle += 1;
            for (let k = fb.toIdx; k <= i; k++) stepCycle[k] = st.cycle; // re-runs bump cycle
            await appendAudit(
              this.pipeline.dir,
              `Loop ${fb.id}: blocking issues at step ${i}; rewind to step ${fb.toIdx} (cycle ${st.cycle}).`,
            );
            i = fb.toIdx;
            rewound = true;
            break;
          }
          // Cycles exhausted -> gate the user exactly like the old review loop.
          // Snapshot the gate context so a pause that lands while _gate awaits the
          // user can serialize kind:'gate'.
          const gateIssues = blockingIssues(this._reviewOf(results, fb.from));
          this._pauseGate = { fbId: fb.id, toIdx: fb.toIdx, cycle: st.cycle, issues: gateIssues };
          const decision = await this._gate(fb.id, st.cycle, gateIssues);
          this._pauseGate = null;
          this._checkAbort();
          if (decision === 'another') {
            st.cycle += 1;
            for (let k = fb.toIdx; k <= i; k++) stepCycle[k] = st.cycle;
            await appendAudit(this.pipeline.dir, `Loop ${fb.id} gate at cycle ${st.cycle - 1}: user approved another cycle.`);
            i = fb.toIdx;
            rewound = true;
            break;
          }
          await appendAudit(this.pipeline.dir, `Loop ${fb.id} gate at cycle ${st.cycle}: user chose to continue with open issue(s).`);
        }
        if (!rewound) i += 1;
        // Crash-recovery trail: every completed step boundary persists a boundary resume
        // point for the NEXT step. A hard stop now leaves a valid recovery position.
        this.state.resumePoint = this._buildResumePoint({ plan, stepIndex: i, stepCycle, loopState, bus });
        await this._persist();
      }
    } catch (err) {
      if (isPause(err)) {
        this.state.resumePoint = this._buildResumePoint({ plan, stepIndex: i, stepCycle, loopState, bus });
        return 'paused';
      }
      throw err;
    }
    return 'done';
  }

  /** Serialize the dispatch position into a JSON-safe resume point. */
  _buildResumePoint({ plan, stepIndex, stepCycle, loopState, bus }) {
    const cyc = Array.isArray(stepCycle) ? [...stepCycle] : [];
    const curCycle = cyc[stepIndex] || 1;
    const cur = (this.state.steps || []).filter(
      (s) => s.stepIndex === stepIndex && (s.cycle || 1) === curCycle && s.nodeId,
    );
    const kind = this._pauseGate ? 'gate' : (cur.some((s) => s.status === 'paused') ? 'node' : 'boundary');
    return {
      version: 1,
      kind,
      stepIndex,
      stepCycle: cyc,
      loopState: JSON.parse(JSON.stringify(loopState || {})),
      bus: jsonClone(bus),
      stepModels: this.stepModels,
      workflowId: this.workflowId,
      guardrailsId: this.guardrailsId,
      plan: jsonClone({ id: plan.id, name: plan.name, steps: plan.steps, feedbacks: plan.feedbacks }),
      nodes: cur.map((s) => ({
        nodeId: s.nodeId, key: s.phase, sessionId: s.sessionId || null, completed: s.status === 'done',
      })),
      gate: this._pauseGate ? { ...this._pauseGate } : null,
      pauseReason: this.pauseReason || null,
      // The EFFECTIVE instruction at dispatch time (post in-worktree graph build),
      // not the detect-time tools.instruction — resume() restores it verbatim.
      toolInstruction: this.toolInstruction ?? '',
      pipelineDir: this.pipeline.dir,
      pausedAt: new Date().toISOString(),
    };
  }

  /**
   * Run one step. Single node -> direct; >1 node -> Promise.all (PARALLEL).
   * Returns an array of { node, result } in node order.
   */
  async _runStep(group, stepIndex, cycle, bus) {
    // Decomposed implement: a single implementer step (and not an already-synthetic
    // task node) + a decomposition on the bus + NOT a fix cycle => fan out one
    // implementer per task, phases sequential, tasks parallel. A fix-cycle rewind
    // (bus.review present) runs the normal single implementer on the combined diff.
    if (
      group.length === 1 && group[0].key === 'implementer' && !group[0].decomposedTask &&
      bus.decomposition && Array.isArray(bus.decomposition.phases) && bus.decomposition.phases.length &&
      !bus.review
    ) {
      return this._runDecomposedImplement(group[0], stepIndex, cycle, bus);
    }
    // CONV-6: each node reads a FROZEN snapshot of the inbound bus; nodes never
    // mutate shared state concurrently. Results merge back in node order after all
    // nodes settle, so the outcome is independent of completion timing.
    const snapshot = Object.freeze({ ...bus });
    const results = group.length === 1
      ? [await this._runNode(group[0], stepIndex, cycle, snapshot)]
      : await Promise.all(group.map((node) => this._runNode(node, stepIndex, cycle, snapshot)));
    let stageNeeded = false;
    for (const { node, result, ctx } of results) {
      this._publishNodeIo(node, result, ctx.outputs, bus); // deterministic, node order
      // M1: the reviews table is the AUTHORITATIVE per-cycle verdict store. Persist
      // synchronously (awaited) before the step returns so the History UI and any
      // post-run reader see every cycle's verdict. writeReview keeps an inner catch, so
      // it stays best-effort under WAL contention (a transient lock must not abort a long
      // pipeline) — the await is for ordering/visibility, NOT error propagation. The live
      // refine/review->fix loop still gates on result.review in-memory (_loopFired),
      // which the runner parsed from the agent's scratch json — the FS json stays a
      // transient subprocess artifact swept with the run dir.
      if (this.pipeline && ctx.outputs?.review?.reviewKind && result?.review) {
        await writeReview(this.pipeline.id, reviewKindOf(ctx.outputs.review.reviewKind), cycle, result.review);
      }
      // Decomposer node: persist the phases + tasks (stamped with the deterministic
      // implementer node ids) so the records exist even if the implement stage aborts.
      if (this.pipeline && node.key === 'decomposer' && Array.isArray(result?.decomposition?.phases)) {
        await this._persistDecomposition(result.decomposition.phases);
      }
      if ((node.produces || []).includes('code')) stageNeeded = true;
    }
    // CONV-6: stage ONCE, AWAITED, after the step's producers — so a following
    // reviewer's `git diff` sees newly-written files (legacy _reviewLoop staged
    // after every implement pass).
    if (stageNeeded) await this._stageWorkingTree();
    return results;
  }

  /**
   * Persist the decomposer's phases/tasks, stamping each task with the deterministic
   * implementer node id `s_impl_p<ordinal>_t<index+1>` used by the manifest rewrite +
   * runtime fan-out. Best-effort (writeDecomposition swallows WAL errors).
   */
  async _persistDecomposition(phases) {
    for (const ph of phases) {
      const tasks = Array.isArray(ph?.tasks) ? ph.tasks : [];
      tasks.forEach((t, i) => { t.nodeId = `s_impl_p${ph.ordinal}_t${i + 1}`; });
    }
    writeDecomposition(this.pipeline.id, phases);
    await appendAudit(this.pipeline.dir, `Decomposed plan into ${phases.length} phase(s).`);
  }

  /**
   * Run the decomposed implement stage. Rewrite + persist the UI stepper into per-phase
   * / per-task cells, then run each phase IN ORDER (tasks within a phase in PARALLEL,
   * shared working tree). The FIRST genuine task failure aborts the phase IMMEDIATELY:
   * a per-task rejection observer fires the phase-local AbortController while siblings
   * are still running (allSettled alone reports failures only after every sibling has
   * finished), and the thrown phase error is that first failure — never a cancelled
   * sibling's AbortError. Stages the combined tree itself (the guard returns early from
   * _runStep, skipping its tail stage). Returns the dispatcher's [{node,result,ctx}]
   * shape with ONE synthetic implementer result so the reviewer step sees a settled
   * 'code' producer.
   */
  async _runDecomposedImplement(implNode, stepIndex, cycle, bus) {
    const phases = bus.decomposition.phases;
    // 1) Rewrite + persist the UI manifest so the live/history view stacks per task.
    this.state.stepper = rewriteStepperForDecomposition(this.state.stepper, phases);
    await this._persist();
    this._emit('state', this.getState());

    const snapshot = Object.freeze({ ...bus });

    // 2) Run each phase in order.
    for (const ph of phases) {
      const tasks = Array.isArray(ph.tasks) ? ph.tasks : [];
      updatePhaseStatus(this.pipeline.id, ph.ordinal, 'running', new Date().toISOString());
      await appendAudit(this.pipeline.dir, `Phase ${ph.ordinal}: ${tasks.length} task(s) starting.`);

      // Abort-immediately on the FIRST genuine (non-abort, non-pause) failure.
      // The per-task rejection observer below fires phaseAbort WHILE siblings are
      // still running — before Promise.allSettled resolves — so one failed task
      // cancels its in-flight siblings (SIGTERM via ctx.signal) instead of letting
      // them burn their full runtime under a doomed phase. AbortErrors (this very
      // cancel cascade, or stop()) and PauseErrors never trigger it: the first
      // cancellation must not mask the real cause, and pause keeps its own unwind
      // below. A sibling parked on an interactive recovery prompt is not
      // signal-reachable (_ask settles only via answer()/pause()/stop()), so the
      // trigger also rejects an open recovery prompt exactly the way pause() does —
      // the phase is failing and must not wait on a now-meaningless human answer.
      const phaseAbort = new AbortController();
      let firstError = null;
      const noteFailure = (task, reason) => {
        if (firstError || isAbort(reason) || isPause(reason)) return;
        firstError = { task, reason };
        phaseAbort.abort();
        if (this.pendingQuestion?.kind === 'recovery') {
          const pq = this.pendingQuestion;
          this.pendingQuestion = null;
          const e = new Error('aborted');
          e.name = 'AbortError';
          pq.reject(e);
        }
      };
      const settled = await Promise.allSettled(tasks.map((task) => {
        const taskNode = decomposedTaskNode(implNode, task, tasks, this.pipeline.dir);
        const p = this._runDecomposedTask(taskNode, task, stepIndex, cycle, snapshot, phaseAbort);
        // Side observer only: the raw promise still flows into allSettled (which
        // attaches its own handlers, so no unhandled-rejection either way), and
        // the .catch derivative resolves after noteFailure swallows the reason.
        p.catch((reason) => noteFailure(task, reason));
        return p;
      }));

      // Pause lands between decomposed phases (coarse but safe): aborted tasks of
      // this phase re-run on resume as part of the whole decomposed step. Pause
      // outranks a recorded failure, exactly as before the observer existed.
      if (this.pauseRequested) throw pauseErr();

      // Selection: noteFailure recorded the FIRST genuine failure in settle order
      // (its handler runs before allSettled's own for the same promise), so a
      // cancelled sibling's AbortError can never become the phase error. The scan
      // is a pure backstop preserving the old task-order selection if the observer
      // somehow saw nothing genuine.
      if (!firstError) {
        settled.forEach((r, k) => {
          if (r.status === 'rejected' && !isAbort(r.reason) && !isPause(r.reason) && !firstError) {
            firstError = { task: tasks[k], reason: r.reason };
          }
        });
      }
      if (firstError) {
        updatePhaseStatus(this.pipeline.id, ph.ordinal, 'error', new Date().toISOString());
        await appendAudit(this.pipeline.dir,
          `Phase ${ph.ordinal}: task "${firstError.task.title || firstError.task.id}" failed — aborting run.`);
        throw new Error(`Decomposed implement failed in phase ${ph.ordinal}: task "${firstError.task.title || firstError.task.id}": ${firstError.reason?.message || firstError.reason}`);
      }
      updatePhaseStatus(this.pipeline.id, ph.ordinal, 'done', new Date().toISOString());
    }

    // 3) Stage the combined tree so the reviewer's diff sees every task's files.
    await this._stageWorkingTree();

    // 4) Synthetic dispatcher result (one settled 'code' producer). NOT published via
    //    _publishNodeIo (the guard returned early); bus.code is the standing worktree
    //    channel the reviewer already binds, so the staged tree is all it needs.
    return [{
      node: { ...implNode, produces: ['code'], consumes: ['plan'] },
      result: { status: 'ok', summary: `Decomposed implementation complete (${phases.length} phase(s)).` },
      ctx: { outputs: {} },
    }];
  }

  /**
   * Run one decomposed task through the standard node machinery: _nodeStep records its
   * own pipeline step (distinct nodeId), _nodeCtx wires its own onEvent (so sub-agents
   * are attributed to this task), and the standard attempt loop (`_runNodeAttempts`:
   * recovery + usage-limit pause) runs the implementer with the self-contained TASK
   * file authoritative (ctx.node.taskPath). The phase-local abort is folded with the
   * run-wide signals into ctx.signal; _runDecomposedImplement's rejection observer
   * fires it on the first genuine sibling failure, killing this task's runner
   * mid-flight (it then settles as an AbortError — recorded 'error', logged silently,
   * same as stop()). updateTaskStatus tracks running/done/error/paused. Errors propagate.
   */
  async _runDecomposedTask(taskNode, task, stepIndex, cycle, snapshot, phaseAbort) {
    this._nodeStep(taskNode, stepIndex, cycle, 'start');
    updateTaskStatus(this.pipeline.id, task.id, 'running', new Date().toISOString());
    const ctx = this._nodeCtx(taskNode, { stepIndex, cycle });
    Object.assign(ctx, this._bindNodeIo(taskNode, cycle, snapshot));
    ctx.signal = AbortSignal.any([this.abort.signal, this.pauseAbort.signal, phaseAbort.signal]); // sibling-failure/pause cancel
    let status = 'done';
    try {
      // Through _runNodeAttempts, not a bare runner call: a decomposed task gets
      // the SAME recovery/usage-limit treatment as a normal node (the bare call
      // also bypassed the terminal error line entirely — a failed decomposed run
      // used to produce zero error-level lines).
      await this._runNodeAttempts(taskNode, stepIndex, cycle, ctx);
    } catch (err) {
      // Same conversion _runNode applies (2317-2319): a usage-limit/user pause
      // unwinds through _runNodeAttempts as a pause, and a pause is NOT this
      // task's failure — without it the finally stamps the task row and the
      // stepper cell 'error' on a merely paused, resumable run, and
      // _buildResumePoint sees no 'paused' step.
      if (this.pauseRequested && (isAbort(err) || isPause(err) || this.pauseAbort.signal.aborted)) {
        status = 'paused';
        throw pauseErr();
      }
      status = 'error';
      this._logStepFailure(taskNode, stepIndex, cycle, err);
      throw err;
    } finally {
      updateTaskStatus(this.pipeline.id, task.id, status, new Date().toISOString());
      this._nodeStep(taskNode, stepIndex, cycle, status);
    }
  }

  /**
   * The ONE `error`-level line for a terminally failed node or decomposed task.
   * A pause/abort is not a failure, and a recoverable error that retried logged
   * its own `warn` in _recover — both stay silent. `err.stream` is set by the
   * runner only when the detail actually came from the CLI's stderr. Clipped
   * head+tail: the runner's exit detail is already tail-capped (the cause sits
   * at the END), and every stderr line was streamed as its own warn — this line
   * is the verdict, not the transcript.
   */
  _logStepFailure(node, stepIndex, cycle, err) {
    if (isAbort(err) || isPause(err)) return;
    this._log(node.key, 'error', `step failed: ${clipMiddle(err?.message || err, 500)}`, {
      nodeId: node.nodeId, stepIndex, cycle, stepKey: this._stepKeyFor(node, stepIndex, cycle),
      ...(err?.stream ? { stream: err.stream } : {}),
    });
  }

  /**
   * Execute a single plan node through its runnerType, binding the frozen bus
   * snapshot into ctx and returning the node result + ctx (publish happens in
   * _runStep). Records the node step (parallel-safe) and tags all emits.
   */
  async _runNode(node, stepIndex, cycle, snapshot) {
    this._nodeStep(node, stepIndex, cycle, 'start');
    // Per-cycle artifact paths so loop re-runs never clobber prior outputs.
    const ctx = this._nodeCtx(node, { stepIndex, cycle });
    Object.assign(ctx, this._bindNodeIo(node, cycle, snapshot));
    if (this._resumeNodeSessions?.has(node.nodeId)) {
      ctx.resumeSessionId = this._resumeNodeSessions.get(node.nodeId);
    }
    this._primeQuestions(node, ctx);
    let result;
    let endMark = 'done';
    try {
      result = await this._runNodeAttempts(node, stepIndex, cycle, ctx);
      result = await this._questionsLoop(node, stepIndex, cycle, ctx, result);
    } catch (err) {
      if (this.pauseRequested && (isAbort(err) || isPause(err) || this.pauseAbort.signal.aborted)) {
        endMark = 'paused';
        throw pauseErr();
      }
      // Terminal node failure — see _logStepFailure.
      this._logStepFailure(node, stepIndex, cycle, err);
      throw err;
    } finally {
      this._nodeStep(node, stepIndex, cycle, endMark);
    }
    // CONV-6: no shared-bus mutation here — _runStep merges results in node order.
    return { node, result, ctx };
  }

  /** The recoverable-error retry loop around one node execution. Extracted from
   *  _runNode verbatim so the questions-resume runs (spec 2026-07-11) get the
   *  SAME usage-limit/recovery treatment as the initial attempt. The pause
   *  paths throw pauseErr() with pauseRequested already set (_pauseForLimit
   *  calls this.pause()), so _runNode's catch reproduces the 'paused' mark. */
  async _runNodeAttempts(node, stepIndex, cycle, ctx) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this._runOnce(node, ctx);
      } catch (err) {
        // Pause/stop always win over a recoverable error.
        if (this.pauseRequested && (isAbort(err) || isPause(err) || this.pauseAbort.signal.aborted)) {
          throw pauseErr();
        }
        if (isAbort(err) || isPause(err)) throw err;
        const cls = classifyError(err);
        if (!cls) throw err;                    // not recoverable -> today's path
        if (cls === 'usage_limit') {
          // A session/usage cap that only clears after a multi-hour reset.
          // _pauseForLimit pauses the whole run (sets pauseRequested); throwing
          // pauseErr() unwinds this node as a pause.
          this._pauseForLimit(node, err);
          throw pauseErr();
        }
        const decision = await this._recover({ node, cls, err, attempt });
        if (decision === 'abort') throw err;    // user/auto gave up -> fail as today
        this._nodeStep(node, stepIndex, cycle, 'start'); // node back to running for the retry
        // loop -> re-run the node fresh
      }
    }
  }

  /** Run a node's runner once, with the spec §7 vanished-session fresh re-run
   *  fallback (a dead `--resume` session must not fail the run). Extracted from
   *  _runNode verbatim so the recovery loop wraps a single clean call. */
  async _runOnce(node, ctx) {
    const runner = this._runners[node.runnerType];
    if (typeof runner !== 'function') throw new Error(`no runner for type "${node.runnerType}"`);
    try {
      return await runner(ctx);
    } catch (err) {
      if (ctx.resumeSessionId && !isAbort(err) && !isPause(err) && !this.pauseRequested) {
        this._log(node.key, 'warn', `session resume failed (${err?.message || err}); re-running the step fresh`,
          err?.stream ? ERR_STREAM : null);
        await appendAudit(this.pipeline.dir, `Resume fallback: node ${node.nodeId} re-ran fresh (session resume failed).`).catch(() => {});
        ctx.resumeSessionId = undefined;
        return await runner(ctx);
      }
      throw err;
    }
  }

  /** Seed the ask-then-resume ctx fields (spec 2026-07-11) for one node run.
   *  Disabled for clarifier nodes (they have their own gate), decomposed task
   *  shards, and auto mode (the directive would be auto-answered noise).
   *  Persisted answers from EVERY prior round/cycle of this node are re-injected
   *  so a fix-cycle or crash-resumed re-run never re-asks. */
  _primeQuestions(node, ctx) {
    const enabled = !!node.askQuestions && node.runnerType !== 'clarifier'
      && !node.decomposedTask && !this.auto;
    ctx.questionsEnabled = enabled;
    if (!enabled) return;
    ctx.questionsAnswered = readStepQuestions(this.pipeline.id)
      .filter((r) => r.nodeId === node.nodeId)
      .flatMap((r) => r.answers);
    ctx.questionsFile = this._questionsPath(node, ctx.stepIndex, ctx.cycle, 1);
  }

  /** Absolute per-round questions file path inside the pipeline dir. The node
   *  id is sanitized so a hand-authored workflow id can never escape the dir. */
  _questionsPath(node, stepIndex, cycle, round) {
    const safe = String(node.nodeId).replace(/[^A-Za-z0-9_-]/g, '_');
    return join(this.pipeline.dir, `questions-${stepIndex}-${safe}-c${cycle}-r${round}.json`);
  }

  /**
   * Ask-then-resume rounds (spec 2026-07-11 §5). After a successful run: if the
   * agent wrote this round's questions file, persist the questions, gate the
   * user (serialized — single pendingQuestion slot), persist the answers
   * (BEFORE the resume spawns — crash-safe), then resume the SAME session with
   * the answers injected via questionsPromptBlock. The resume goes through
   * _runNodeAttempts, so recovery + the vanished-session fresh re-run apply
   * unchanged. Caps at MAX_QUESTION_ROUNDS; the final resume carries no
   * next-round file so the agent proceeds on assumptions.
   */
  async _questionsLoop(node, stepIndex, cycle, ctx, firstResult) {
    let result = firstResult;
    if (!ctx.questionsEnabled) return result;
    const stepKey = this._stepKeyFor(node, stepIndex, cycle);
    const agentLabel = ((this.registry || {})[node.key] || {}).displayName || node.key;
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
        agentKey: node.key, nodeId: node.nodeId, questions: { questions },
      });
      this._artifact('questions', qPath);
      await appendAudit(this.pipeline.dir, `${agentLabel} asked ${questions.length} question(s) (round ${round}).`).catch(() => {});
      const payload = await this._enqueueAsk(() => this._ask({
        id: `questions-${stepKey}-r${round}`,
        kind: 'questions',
        questions,
        agent: agentLabel,
        nodeId: node.nodeId,
      }));
      this._checkAbort();
      const answers = normalizeClarifyAnswer(payload, questions);
      const byId = new Map(questions.map((q) => [q.id, q]));
      const enriched = answers.map((a) => ({ id: a.id, question: byId.get(a.id)?.question || '', choice: a.choice }));
      await writeStepQuestions(this.pipeline.id, stepKey, round, {
        agentKey: node.key, nodeId: node.nodeId, answers: { answers: enriched },
      });
      await appendAudit(this.pipeline.dir, `${agentLabel}: ${enriched.length} answer(s) received (round ${round}).`).catch(() => {});
      // Consume the processed round file: the DB row is authoritative, and a
      // surviving file would re-gate the user on a crash/pause-resumed re-run.
      await rm(qPath, { force: true }).catch(() => {});
      const step = this.state.steps.find((s) => s.key === stepKey);
      if (step?.sessionId) ctx.resumeSessionId = step.sessionId;
      ctx.questionsAnswered = [...(ctx.questionsAnswered || []), ...enriched];
      ctx.questionsFile = round < MAX_QUESTION_ROUNDS
        ? this._questionsPath(node, stepIndex, cycle, round + 1)
        : null;
      result = await this._runNodeAttempts(node, stepIndex, cycle, ctx);
    }
    return result;
  }

  /** Pause the whole run because a node hit a session/usage cap that only clears
   *  after a long reset. Records the cap message (surfaced on the paused row /
   *  audit) and signals a graceful pause; the caller throws pauseErr() to unwind
   *  this node, and pause() aborts the in-flight siblings. Idempotent: the first
   *  limit-hit among parallel siblings wins, the rest no-op. */
  _pauseForLimit(node, err) {
    const reason = firstLine(err?.message || String(err));
    if (!this.pauseReason) this.pauseReason = reason;
    this._log(node.key, 'warn', `session/usage limit reached — pausing for manual resume: ${reason}`);
    appendAudit(this.pipeline.dir, `Pipeline **paused**: session/usage limit on ${node.key} — ${reason}. Resume after the reset.`).catch(() => {});
    this.pause();
  }

  /**
   * Interactive clarify runner (runnerType 'clarifier'). Runs the clarify agent
   * (writes clarify.json + the DB clarify questions row), then pauses for the user's
   * answers via the same _ask the feedback-loop gate uses, persists them to the
   * clarify row, and returns { questions, answers } so _publishNodeIo folds them onto
   * the `clarify` channel (read by the planner as inputs.clarify.answers). With no
   * questions it skips the gate and returns empty sets. `ctx` is the node ctx built by
   * _runNode (carries node, cycle, agentPrompts.clarify, outputs.clarify, pipelineDir,
   * pipelineId).
   */
  async _runClarifyNode(ctx) {
    const cycle = ctx.cycle || 1;
    const clarifyPath = ctx.outputs?.clarify?.path || join(this.pipeline.dir, 'clarify.json');
    const { questions } = await runClarify(ctx, { round: cycle, priorAnswers: [] });
    this._checkAbort();
    if (!Array.isArray(questions) || questions.length === 0) {
      await appendAudit(this.pipeline.dir, `Clarify: no questions; proceeding to plan.`);
      return { questions: [], answers: [] };
    }
    this._artifact('clarify', clarifyPath);
    const answer = await this._ask({ id: `clarify-${cycle}`, kind: 'clarify', questions });
    this._checkAbort();
    const answers = normalizeClarifyAnswer(answer, questions);
    const enriched = await this._writeClarifyAnswers(questions, answers);
    await appendAudit(this.pipeline.dir, `Clarify: answered ${answers.length} question(s).`);
    return { questions, answers: enriched };
  }

  /** Bind a node's typed inputs from the (frozen) bus snapshot + allocate its
   *  outputs, then flatten to the runner ABI the phases.mjs runners read. Replaces
   *  the role switch. `node` carries consumes/produces/optionalConsumes from
   *  resolveWorkflow (Step 4). */
  _bindNodeIo(node, cycle, snapshot) {
    const consumes = node.consumes || [];
    const produces = node.produces || [];
    const optional = node.optionalConsumes || [];
    const ctx = {
      projectDir: this.projectDir, pipelineDir: this.pipeline.dir,
      baseName: this.baseName, datePrefix: this.planDatePrefix, cycle, key: node.key,
      // allocate() forwards workspaceKey into planPath/reviewPath so a workspace
      // run's unified plan/review route to the workspace store; null otherwise.
      workspaceKey: this.workspaceKey,
      // Registry-collected custom channel definitions (kind/filename) so allocate()'s
      // generic default branch can mint <pipelineDir>/<filename>[-cycleN].<ext>.
      channelDefs: this.channelDefs || {},
    };
    const inputs = bindInputs(consumes, optional, snapshot);
    const outputs = {};
    for (const c of produces) outputs[c] = allocate(c, ctx);
    return { inputs, outputs, ...legacyFields(node, inputs, outputs, cycle, this.baseName) };
  }

  /** Publish a node's produced channels back onto the bus (node order). Emits the
   *  same 'artifact' events as before for plan/checklist. Clearing `review` on code
   *  publish fixes the sticky fix-mode latent bug. */
  _publishNodeIo(node, result, outputs, bus) {
    if (!result) return;
    const beforePlan = bus.plan, beforeChecklist = bus.checklist;
    publish(node.produces || [], result, outputs || {}, bus);
    if (bus.plan && bus.plan !== beforePlan) this._artifact('plan', bus.plan.path);
    if (bus.checklist && bus.checklist !== beforeChecklist) this._artifact('checklist', bus.checklist.path);
    // A16(5): index a published review's md path so the Task-3.13 index-based deleter
    // can remove the shared reviews/<date>-<base>-(impl|plan|ws)-review.md. publish()
    // only folds reviews that carry an md (refiner's md-less verdict is private), so
    // the md is on result.reviewMdPath / outputs.review.mdPath. webui-review md is
    // pipeline-dir-local -> index it under kind 'webui'; all other review md is the
    // shared store-rooted file -> kind 'review'. (_artifact computes the rel_path.)
    const reviewMd = result.reviewMdPath ?? outputs?.review?.mdPath;
    if (reviewMd) {
      const reviewKind = outputs?.review?.reviewKind === 'webui-review' ? 'webui' : 'review';
      this._artifact(reviewKind, reviewMd);
    }
  }

  /** True if the loop's `from` node returned a blocking verdict (CONV-3). */
  _loopFired(fb, results) {
    const review = this._reviewOf(results, fb.from);
    return review ? hasBlocking(review) : false;
  }

  /**
   * CONV-3: the verdict of the loop's ORIGINATING node, resolved by `nodeId`,
   * REGARDLESS of runnerType — so a producer self-loop (the refiner `s1_0->s1_0`)
   * gates on its own review, reproducing the legacy `_refineLoop`. `loopSource` is
   * a validation/UI hint, not the runtime gate selector. Falls back to synthesizing
   * a review from a blocked status when the node exposed issues but no full review.
   */
  _reviewOf(results, fromNodeId) {
    const r = results.find((x) => x.node.nodeId === fromNodeId);
    if (!r) return null;
    return r.result?.review || (r.result?.status === 'blocked'
      ? { issues: (r.result.issues || []).map((i) => ({ severity: i.severity || 'major' })), summary: r.result.summary || '' }
      : null);
  }

  // ── question / gate plumbing ───────────────────────────────────────────────

  /**
   * Emit a gate question for a loop and resolve to "continue" | "another".
   */
  async _gate(loop, cycle, issues) {
    const id = `gate-${loop}-${cycle}`;
    const payload = await this._ask({ id, kind: 'gate', issues });
    const decision = payload?.decision === 'another' ? 'another' : 'continue';
    return decision;
  }

  // ── context passed to phase runners ────────────────────────────────────────

  _phaseCtx(role, { fanOut = false } = {}) {
    // resolveStepModels already folded in the global fallback, so step.model is
    // the effective model; the `|| this.claude.model` is a defensive belt-and-
    // braces for the (guarded) case where stepModels is null.
    const step = (this.stepModels && this.stepModels[role]) || {};
    return {
      // The field name is kept to bound blast radius — it is consumed as `cwd`.
      projectDir: this.runCwd || this.workDir,
      runRoot: this.runRoot,
      repos: this._reposCtx(),
      pipelineDir: this.pipeline.dir,
      pipelineId: this.pipeline.id,
      taskPrompt: this.pipeline.promptText,
      toolInstruction: this.toolInstruction,
      agentPrompts: this.agentPrompts,
      fanOut,
      checkpointRef: this.checkpointRef,
      // Workspace metadata for prompt injection (undefined on a single-project run,
      // so buildSystemPrompt/taskHeader emit the byte-identical single-project text).
      workspace: this.isWorkspace ? this._workspaceChannel() : undefined,
      onEvent: (e) => this._onAgentEvent(role, e),
      signal: AbortSignal.any([this.abort.signal, this.pauseAbort.signal]),
      claudeOpts: {
        bin: this.claude.bin,
        permissionMode: this.claude.permissionMode,
        model: step.model || this.claude.model, // per-role, falling back to global
        effort: step.effort,                     // per-role effort (undefined when unset)
        permissionRules: this.guardrailPermissionRules || undefined,
        envScrub: this.guardrails?.envScrub || undefined,
        envAllowlist: this.guardrails?.envScrub ? this.guardrails.envAllowlist : undefined,
        mock: this.claude.mock,
      },
    };
  }

  /**
   * Stable step key for a node occurrence. Parallel nodes in the same step share
   * stepIndex but differ by nodeId; loop re-runs differ by cycle. Format keeps the
   * legacy `phase#cycle` readability while staying unique per node:
   *   "<stepIndex>:<nodeId>#<cycle>"  (cycle omitted when 1 and not a loop re-run)
   */
  _stepKeyFor(node, stepIndex, cycle) {
    const c = Number(cycle) > 1 ? `#${cycle}` : '';
    return `${stepIndex}:${node.nodeId}${c}`;
  }

  /**
   * Node execution context. Extends the legacy _phaseCtx shape but is keyed by the
   * node (model/effort come from the resolved plan node, not a role lookup) and
   * tags every emit + cost with { nodeId, stepIndex, cycle } so parallel/looped
   * emits are attributable. `node.agentKeyForPrompt` lets a node reuse an existing
   * agent's prompt body (the default-workflow nodes set this to their role).
   * @param {object} node    plan Node { nodeId, key, runnerType, model, effort, ... }
   * @param {{stepIndex:number, cycle:number}} pos
   */
  _nodeCtx(node, pos = {}) {
    const stepIndex = Number(pos.stepIndex) || 0;
    const cycle = Number(pos.cycle) > 0 ? Number(pos.cycle) : 1;
    const stepKey = this._stepKeyFor(node, stepIndex, cycle);
    return {
      // The field name is kept to bound blast radius — it is consumed as `cwd`
      // at phases.mjs. runCwd is the run root on a detached workspace run, the
      // member worktree on a detached single run, and today's workDir under legacy.
      projectDir: this.runCwd || this.workDir,
      runRoot: this.runRoot,
      // §5.5/§5.3: the generated merged MCP config + one grant per merged server.
      // null/[] under legacy, so phases.mjs -> runClaude -> buildClaudeArgs adds
      // neither flag and every legacy argv stays byte-identical.
      mcpConfigPath: this.mcpConfigPath,
      mcpServerGrants: this.mcpServerGrants,
      repos: this._reposCtx(),
      pipelineDir: this.pipeline.dir,
      pipelineId: this.pipeline.id,
      taskPrompt: this.pipeline.promptText,
      toolInstruction: this.toolInstruction,
      agentPrompts: this.agentPrompts,
      checkpointRef: this.checkpointRef,
      // Workspace metadata for prompt injection — reaches EVERY dispatched runner
      // (it does not depend on a node declaring `workspace` in consumes). undefined
      // on a single-project run, preserving byte-identical prompts. _bindNodeIo's
      // legacyFields would surface the same handle if the node consumed the channel.
      workspace: this.isWorkspace ? this._workspaceChannel() : undefined,
      signal: AbortSignal.any([this.abort.signal, this.pauseAbort.signal]),
      node,
      nodeId: node.nodeId,
      stepIndex,
      cycle,
      isEntry: stepIndex === 0,
      extras: this.extrasFiles || [],
      // `model` rides along so the result-event handler can attribute cost
      // reliability (§4.6) to the DISPATCHED model without re-resolving it.
      onEvent: (e) => this._onAgentEvent(node.key, e, { nodeId: node.nodeId, stepIndex, cycle, stepKey, uiPhase: node.uiPhase || node.key, model: node.model || this.claude.model }),
      claudeOpts: {
        bin: this.claude.bin,
        permissionMode: this.claude.permissionMode,
        model: node.model || this.claude.model, // per-node, falling back to global
        effort: node.effort,                     // per-node effort (undefined when unset)
        permissionRules: this.guardrailPermissionRules || undefined,
        envScrub: this.guardrails?.envScrub || undefined,
        envAllowlist: this.guardrails?.envScrub ? this.guardrails.envAllowlist : undefined,
        mock: this.claude.mock,
      },
    };
  }

  /**
   * Record/transition a node's step (parallel-safe analogue of _recordStep). The
   * key is the node-derived stepKey so concurrent nodes never collide. On 'start'
   * it does NOT pause sibling clocks (parallel nodes run simultaneously); on a
   * terminal marker it folds just this node's clock.
   */
  _nodeStep(node, stepIndex, cycle, status) {
    const key = this._stepKeyFor(node, stepIndex, cycle);
    const now = new Date().toISOString();
    let step = this.state.steps.find((s) => s.key === key);
    if (!step) {
      step = {
        key, phase: node.key, nodeId: node.nodeId, stepIndex, cycle,
        status, startedAt: now, updatedAt: now, activeMs: 0, runningSince: null,
      };
      this.state.steps.push(step);
    } else {
      step.status = status;
      step.updatedAt = now;
    }
    if (status === 'start') this._clockResume(key);
    else this._clockPause(key);
    this.state.totalActiveMs = sumStepActive(this.state.steps);
    // CONV-4: drive the live-UI stepper. Mirror the legacy `_phase` emit
    // (orchestrator.mjs:710-719) but WITHOUT its `_recordStep` call (this method
    // already records the step). `node.uiPhase` is stamped by resolveWorkflow
    // (Phase 2 Task 6); on a parallel step the last-started node wins the scalar
    // phase (per-node attribution lives in state.steps[]). Confirm the 'phase'
    // payload against app.js `onPhase` (:308) before landing.
    this.state.phase = node.uiPhase || node.key;
    this.state.cycle = cycle;
    this.state.updatedAt = now;
    this._emit('phase', { phase: this.state.phase, cycle, status, nodeId: node.nodeId });
    // Backstop (§5.2): when a step reaches its terminal marker, force-close any
    // sub-agent still 'running' for THIS step so the UI never shows a stuck-active
    // square if a tool_result finish was missed. 'start' never closes anything;
    // the close status is 'stopped' when the run was stopped or is pausing (pause
    // SIGTERMs in-flight children too), else 'finished'.
    if (status === 'done' || status === 'error' || status === 'stopped' || status === 'paused') {
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


  // ── engine hooks (v1) ────────────────────────────────────────────────────────

  _initRunners(opts) {
    // Clarify needs orchestrator state (this._ask / this._writeClarifyAnswers), so it is a
    // bound runner rather than a pure runners.mjs entry. Put it first so opts.runners may
    // still override it in tests.
    this._runners = { clarifier: (ctx) => this._runClarifyNode(ctx), ...(opts.runners || defaultRunners) };
  }

  async _resolveTopology(registry) {
    this.channelDefs = collectChannelDefs(registry); // custom-channel kind/filename for allocate()
    // [C5/M4] On a workspace run, resolveWorkflow substitutes the review node's key
    // reviewer -> workspaceReviewer (the fan-out synthesizer). Single-project runs
    // pass isWorkspace:false, so the resolved plan is byte-identical to today.
    const plan = await resolveWorkflow(this.projectDir, this.workflowId, registry, undefined, {
      isWorkspace: this.isWorkspace,
    });
    // Workspace fan-out forcing (§5.5, C4): the ONLY in-orchestrator topology change a
    // workspace run makes — force fanOut=true on the eligible nodes so they fan out
    // across member projects. Applied right after resolveWorkflow; absent isWorkspace
    // the plan is untouched. workspaceReviewer is now the resolved review node key
    // (substituted in workflows.mjs above), so the review fan-out is forced here.
    if (this.isWorkspace) {
      for (const group of plan.steps) {
        for (const node of group) {
          if (FANOUT_ELIGIBLE.has(node.key)) node.fanOut = true;
        }
      }
    }
    this._plan = plan; // v1-only: the dispatcher's input, handed back by _engineRun
    return {
      manifest: buildStepperManifest(plan, registry),
      agentKeys: planAgentKeys(plan),
      workflow: { id: plan.id, name: plan.name },
    };
  }

  async _engineRun({ resume = null, rehydrated = null } = {}) {
    if (!resume) return await this._dispatch(this._plan);
    // The v1 bus (channels.mjs) is v1-only state; on a fresh run _resolveTopology
    // fills it, on a resume it is rebuilt here. Nothing between the old site and
    // dispatch reads this.channelDefs — the only reader is _bindNodeIo, inside
    // _dispatch.
    this.channelDefs = collectChannelDefs(this.registry);
    // plan: frozen at pause time; a pre-dispatch boundary pause re-resolves.
    let plan = rehydrated?.plan ?? null;
    if (!plan) {
      plan = await resolveWorkflow(this.projectDir, this.workflowId, this.registry, undefined, {
        isWorkspace: this.isWorkspace,
      });
    }
    // §9.4: the frozen (or re-resolved) plan must still resolve every agent
    // key — the providing plugin may have been disabled or uninstalled while
    // this run sat paused. Same gate, same messages as run().
    this._preflightAgentKeys(planAgentKeys(plan));
    return await this._dispatch(plan, { resume });
  }

  _enginePrePausePoint() {
    // Paused outside _dispatch (preflight/worktree): boundary point at step 0.
    return {
      version: 1, kind: 'boundary', stepIndex: 0, stepCycle: [], loopState: {},
      bus: null, stepModels: this.stepModels, workflowId: this.workflowId,
      guardrailsId: this.guardrailsId, plan: null,
      nodes: [], gate: null, pauseReason: this.pauseReason || null,
      toolInstruction: this.toolInstruction ?? '',
      pipelineDir: this.pipeline.dir, pausedAt: new Date().toISOString(),
    };
  }

  _engineRehydrate(rp) {
    if (rp.version !== 1) throw new Error(`resume(): unsupported resume point version ${rp.version}`);
    return {
      checkpointRef: rp.bus?.code?.baseRef || null,
      memberWorktrees: (rp.bus?.workspace?.projects || []).map((p) => ({
        projectKey: p?.projectKey, worktreeDir: p?.worktreeDir, graphInstruction: p?.graphInstruction || '',
      })),
      plan: rp.plan || null,
      audit: `Pipeline **resumed** (from ${rp.kind} at step ${rp.stepIndex}).`,
    };
  }
}


// ── Test-only surface ────────────────────────────────────────────────────────
// The R4 pill helpers are pure, module-private, and carry NORMATIVE semantics
// (§7.1's sentinel algebra). Most of it is reachable through _onAgentEvent, but
// the snapshot-rebuild shape — a sentinel arriving in `incoming` — has no live
// call site, so it is only assertable directly. Exported for tests ONLY; no
// production code imports this bag.
export const _testing = { SKILLS_MAX, skillLabel, mergeSkills };
