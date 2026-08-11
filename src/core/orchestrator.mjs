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

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, basename, resolve, sep, relative, isAbsolute } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile, readdir, mkdir, realpath, rm } from 'node:fs/promises';

import { generateTitle } from './title.mjs';
import {
  createPipeline,
  updatePipelineTitle,
  appendAudit,
  writeState,
  slugify,
  today,
  recordArtifact,
  upsertSubAgent,
  writeReview,
  readPipelineExtras,
  claimPipelineOwnership,
  touchHeartbeat,
  clearPipelineOwnership,
  HEARTBEAT_INTERVAL_MS,
  writeStepQuestions,
  readStepQuestions,
  writeDecomposition,
  updatePhaseStatus,
  updateTaskStatus,
} from './artifacts.mjs';
import { diffNameStatus, diffNumstat, diffPatch } from './git-info.mjs';
import { assembleResults, persistResults, persistDiffPatch, buildPerProject, rollupSummary } from './results.mjs';
import { resolveTaskInput, retryWriteback } from './sources.mjs';
import { projectKey, projectStorePath, workspaceStorePath } from './store.mjs';
import { worcaHome } from './projects.mjs';
import {
  runRootMode, getProjectsRoot,
  pipelineCostLimitUsd, totalCostLimitUsd, costLimitResetPeriod,
} from './settings.mjs';
import {
  recordCostDelta, readCostCapOverride, windowedSpendUsd, costWindowStart,
} from './cost-budget.mjs';
import {
  writeRunManifest, readRunManifest, updateRunManifest, rmGuarded, rescueModifiedMounts,
  scanStrayEntries, copyRunManifestTo, removeInjectedPaths, stripClaudeMdFence,
} from './run-manifest.mjs';
import { assembleRunContext, renderContextAudit, MCP_GRANT_MODE } from './run-context.mjs';
import { createRunLogWriter, RUN_LOG_FILE, RUN_LOG_KIND } from './run-log.mjs';
import {
  detectTools, detectToolsPerProject, runGraphifyUpdate, worktreeGraphInstruction,
  probeClaudeCapabilities,
} from './preflight.mjs';
import { fanoutCap, mapWithCap } from './fanout.mjs';
import { resolveStepModels } from './config.mjs';
import { readGuardrailSet } from './guardrail-store.mjs';
import { unionGuardrails, guardrailsToPermissionRules, mergePermissionRules } from './guardrails.mjs';
import { readQuestionsFile } from './protocol.mjs';
import { classifyError } from './recoverable-error.mjs';
import { resolveGraph, buildGraphManifest } from './workflows.mjs';
import { createScheduler, sliceExecutionId } from './graph/scheduler.mjs';
import { validateGraph } from './graph/validate.mjs';
import {
  allocateOutputs, allocateVerdict, readDecomposition,
  runAgentExecution, runClarifierExecution,
  runTaskExecution, runEndExecution, runAndExecution, runOrExecution, runCombineExecution,
} from './graph/executor.mjs';
import { loadAgentRegistry } from './agent-registry.mjs';
import { collectRequiredSkills, validateSkills, injectSkills, pluginSkillDirs } from './skills.mjs';
import {
  createWorktree, removeWorktree, suggestBranchName, sanitizeBranchName, resolveDefaultBranch,
  isValidSourceRef,
} from './worktree.mjs';
import { readPluginsLock, pluginCurrentDir } from './plugins-lock.mjs'; // §9.4 disabled-plugin hint

/**
 * Default location of the agent prompt markdown files, relative to this module.
 */
const DEFAULT_AGENTS_DIR = new URL('../../agents/', import.meta.url).pathname;
const REPO_ROOT = new URL('../../', import.meta.url).pathname; // worca-cc repo root; holds skills/

/**
 * §9.4 message enrichment: does a DISABLED plugin ship this agent key? Scans
 * lock entries with enabled === false, reading key fields from each plugin's
 * current/agents/*.meta.json. Returns the plugin name or null. try/catch
 * throughout: no resolvable home / no lock / broken current => null (callers
 * fall back to the generic "not installed" message).
 * @param {string} key
 * @returns {string|null}
 */
function findDisabledPluginFor(key) {
  try {
    const lock = readPluginsLock();
    for (const name of Object.keys(lock).sort()) {
      if (!lock[name] || lock[name].enabled !== false) continue;
      const dir = join(pluginCurrentDir(name), 'agents');
      let files;
      try { files = readdirSync(dir); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.meta.json')) continue;
        try {
          if (JSON.parse(readFileSync(join(dir, f), 'utf8'))?.key === key) return name;
        } catch { /* malformed sidecar: skip */ }
      }
    }
  } catch { /* no home / unreadable lock */ }
  return null;
}

/**
 * The executor table (spec §3). Selection is `node.kind` first, then — for agent
 * nodes — `meta.runnerType`. There is NO agent-key branch anywhere in this file:
 * the v1 key-shaped fan-out set, review-kind map and per-role runner registry all
 * died with the dispatcher, and re-introducing one here would re-couple the
 * engine to the built-in agents.
 */
const FLOW_EXECUTORS = {
  task: runTaskExecution,
  end: runEndExecution,
  and: runAndExecution,
  or: runOrExecution,
  combine: runCombineExecution,
};

/** Agent executors by runnerType; anything unlisted is the ONE generic executor. */
const AGENT_EXECUTORS = {
  clarifier: runClarifierExecution,
};

/** The scheduler's parallelism cap (spec §3). This binding is its only reader. */
const MAX_PARALLEL = (() => {
  const n = Number(process.env.WORCA_MAX_PARALLEL);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4;
})();

/** The run-level warning a run that drains without binding End must carry. */
const QUIESCENCE_WARNING = 'finished at quiescence — End not reached';

/**
 * The generic verdict kind: a node's verdict filename template with the shared
 * `-review-cycle{cycle}.json` tail stripped. That yields exactly today's five
 * kinds (impl / refine / plan / ws / webui) from the shipped sidecars without a
 * key table; anything else falls back to the agent key, keeping the `reviews`
 * kind column a lossless open set.
 */
function verdictKindOf(meta, key) {
  const filename = String(meta?.verdict?.filename || '');
  const stem = filename.replace(/-review-cycle\{cycle\}\.json$/, '');
  return stem && stem !== filename ? stem : (key || 'review');
}

/** Max auto-mode retries for a recoverable error before falling back to status error. */
const RECOVERY_MAX_AUTO_ATTEMPTS = (() => {
  const n = Number(process.env.WORCA_RECOVERY_MAX_ATTEMPTS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
})();

/** Max ask-then-resume question rounds per node run (spec 2026-07-11 §5). */
const MAX_QUESTION_ROUNDS = 3;

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

class Orchestrator extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts || {};

    // ── Workspace mode (opt-in; absent => single-project, every path unchanged) ──
    // A workspace run targets 2+ member projects (sorted by projectKey). The scalar
    // projectDir/workDir below point at the PRIMARY (members[0]) so every existing
    // call site that reads them keeps working; per-project data lives in the maps.
    this.workspace = this.opts.workspace || null;
    this.isWorkspace = !!this.workspace;
    this.workspaceKey = this.workspace?.key || null;
    // Single-project runs synthesize a ONE-element member array so every
    // downstream map (workDirs / branchInfos / checkpointRefs / state.branches) has
    // exactly one shape in both modes. projectKey is worktree-location-independent
    // and falls back to the resolved path for a non-git dir (store.mjs), so it is
    // the same value the first _persist already derives — no new identity. The
    // synthesized projectName is pinned to basename(resolve(projectDir)) so it can
    // never leak `undefined` into a branch slug.
    this.members = Array.isArray(this.workspace?.projects)
      ? this.workspace.projects
          .slice()
          .sort((a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0))
      : (() => {
          const dir = resolve(this.opts.projectDir || process.cwd());
          return [{ projectKey: projectKey(dir), projectName: basename(dir), projectDir: dir }];
        })();
    this.memberByKey = new Map(this.members.map((m) => [m.projectKey, m]));
    this.workDirs = new Map();         // projectKey -> worktree checkout dir
    this.checkpointRefs = {};          // projectKey -> pre-run commit
    this.branchInfos = new Map();      // projectKey -> createWorktree() result
    this.toolInstructions = new Map(); // projectKey -> per-project graph instruction
    this.workspaceDescription = '';    // frozen at run start (after createPipeline)

    // primaryCwd: the lowest-projectKey member in workspace mode, else the scalar
    // projectDir. resolve() keeps the single-project behavior byte-identical.
    this.projectDir = this.isWorkspace
      ? resolve(this.members[0].projectDir)
      : resolve(this.opts.projectDir || process.cwd());
    this.claude = {
      bin: this.opts.claude?.bin,
      permissionMode: this.opts.claude?.permissionMode || 'acceptEdits',
      model: this.opts.claude?.model,
      mock: !!this.opts.claude?.mock,
    };
    this.agentsDir = this.opts.agentsDir || DEFAULT_AGENTS_DIR;
    this.auto = !!this.opts.auto;
    this.stepModels = null; // { planner:{model,effort}, refiner:{...}, ... } | null until run()
    // Guardrails: resolved by _resolveGuardrails() from run() AND resume(); null
    // until then, so dispatcher tests that bypass run() get claudeOpts without
    // the fields (legacy parity).
    this.guardrails = null;
    this.guardrailPermissionRules = null;
    this.guardrailHonorByKey = null;
    // Which saved workflow topology to run (default reproduces today's pipeline) and
    // the runner registry the dispatcher consults (overridable for tests).
    this.workflowId = this.opts.workflowId || 'wf_default';
    // Which guardrail set governs this run (guardrails are selected PER RUN;
    // there is no per-project guardrails dimension). 'permissive' = the empty
    // policy = byte-identical legacy spawn, so callers that never pass the
    // option (CLI, tests, pre-picker API bodies) keep today's behavior exactly.
    this.guardrailsId = this.opts.guardrailsId || 'permissive';
    // Optional per-runnerType executor overrides (tests inject fakes here). An
    // absent entry falls through to the built-in executor table.
    this._runners = { ...(this.opts.runners || {}) };

    // Worktree isolation: workDir is the per-pipeline checkout. Until
    // _setupRunRoot() runs, it mirrors projectDir so the existing tests/paths
    // (dispatcher tests that bypass run()) behave identically.
    this.workDir = this.projectDir;
    this.branchOpts = {
      source: (this.opts.branch && this.opts.branch.source) || null,
      feature: (this.opts.branch && this.opts.branch.feature) || null,
    };
    this.branchInfo = null;
    // ── Run root (§5.2). All three are assigned in _setupRunRoot() (or rehydrated
    // by resume() from the RECORDED mode, never the live flag). Under `legacy`
    // runRoot stays null and runCwd is the worktree, so every legacy path is
    // byte-identical to today. workDir keeps its name but is now only "the single
    // project's worktree, or the primary's, for back-compat readers".
    this.runRoot = null;
    this.runCwd = null;
    this.runRootMode = null;
    // §8.8 exclusion set: { <projectKey>|'runRoot': [{ path, source, kind }] }.
    // Permanently {} under legacy; on a detached run Phase 3 fills it from
    // assembleRunContext and rehydrates it from run.json on resume.
    this.injectedPaths = {};
    // §5.4-§5.6 generated context. All three stay null/[] under legacy, which is
    // what keeps every legacy spawn argv byte-identical (§10 rollback contract).
    this.runContext = null;
    this.mcpConfigPath = null;      // <runRoot>/mcp.json -> --mcp-config
    this.mcpServerGrants = [];      // `mcp__<server>` per merged server (V1 branch (a))

    this.abort = new AbortController();
    this.pauseRequested = false;
    this.pauseAbort = new AbortController(); // aborts ONLY node children on pause
    this.pauseReason = null;                 // set when a session/usage limit forces the pause
    // ── graph engine state ───────────────────────────────────────────────────
    this.resolved = null;        // { template, ports, nodeCtx } from resolveGraph
    this._scheduler = null;      // the live scheduler handle (pause/abort/getState)
    this._graphSnapshot = null;  // the LAST pre-pause scheduler snapshot (resume-v2)
    this._graphError = null;     // the first genuine execution error, preserved verbatim
    this._planVersion = 0;       // run-global {vsuffix} counter, ticked by allocation
    this._resumeSessions = null; // executionId -> sessionId, one-shot on resume
    this.resumeOpts = this.opts.resume || null; // { row, resumePoint, steps } from readPipelineForResume
    this.pendingQuestion = null; // { id, resolve, reject, kind }
    this._recovery = null;      // class -> in-flight Promise<'retry'|'abort'> (same-class dedupe)
    this._askTail = null;       // serializes _ask: ONE prompt open at a time (recovery + step questions)
    this._recoverySeq = 0;      // monotonic id source for recovery prompts (determinism-safe)
    this.agentPrompts = null;
    this.toolInstruction = '';
    // Cap for the in-worktree graphify build (macOS has no timeout(1)).
    // Resolution order: constructor option → WORCA_GRAPH_TIMEOUT_MS env → 120s.
    const _gt = Number(this.opts.graphBuildTimeoutMs ?? process.env.WORCA_GRAPH_TIMEOUT_MS);
    this.graphBuildTimeoutMs = Number.isFinite(_gt) && _gt > 0 ? _gt : 120000;
    this.checkpointRef = null;
    this.registry = null; // set in run(); the agent registry the graph resolves against
    this.extrasFiles = []; // attached files copied into <pipeline>/extras (set in _runGraph)
    this.pipeline = null; // { id, dir, promptText }
    this.logWriter = createRunLogWriter(); // buffered NDJSON persistence of the `log` stream
    this.baseName = null;
    this.planDatePrefix = null; // DD-MM-YY captured once so -vN versions share it

    // Sub-agent live-log labels: parent_tool_use_id -> label shown after "▸".
    // Tool-use ids are unique per claude process, so entries never collide across
    // runs/cycles; bounded by the number of sub-agents in a pipeline, so no reset.
    this._subAgentLabels = new Map();
    // Monotonic ordinal for sub-agents whose Task description was never captured,
    // so their fallback tag (sub-agent-N) is an honest "Nth undescribed sub-agent",
    // independent of how many described sub-agents share the map.
    this._subAgentFallbackSeq = 0;

    this.state = {
      id: this.opts.pipelineId || null,
      title: this.opts.title || null,
      projectDir: this.projectDir,
      status: 'idle',
      phase: 'idle',
      cycle: 0,
      startedAt: null,
      updatedAt: null,
      steps: [],
      stepper: null, // v2 graph manifest, snapshotted at run start (buildGraphManifest)
      // The resolved RUNTIME graph, carried on the very first state event so a
      // client that connects mid-preflight can draw the run before any exec.
      graph: null,
      active: [],       // [{ nodeId, executionId }] — the scheduler's in-flight set
      result: null,     // End's bound { type, path?, value? }; null until it binds
      endReached: false, // whether the run resolved through the End card
      warnings: [],     // run-level warnings surfaced to the run monitor
      tools: null,
      checkpointRef: null,
      pipelineDir: null,
      totalCostUsd: 0,  // cumulative actual spend (sum of steps[].costUsd)
      totalActiveMs: 0, // cumulative active processing time (sum of steps[].activeMs)
      branch: null,     // { source, feature, worktreeDir, reusedExisting } after _setupRunRoot
      // Per-member maps, initialized HERE (not lazily) so getState()'s snapshot
      // shape is stable across modes and targets. Without this a single-project
      // detached run throws TypeError on the first this.state.branches[key] = … .
      branches: {},
      checkpointRefs: {},
      // Sub-agent lifecycle records (rides the existing `state` snapshot; mirrored to
      // the sub_agents table). Each: { id, label, nodeId, stepIndex, cycle, stepKey,
      // status, startedAt, finishedAt, durationMs?, tokens?, costUsd? };
      // status ∈ 'running'|'finished'|'error'|'stopped'.
      subAgents: [],
    };
  }

  /** @returns {object} a deep-ish snapshot of current state. */
  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  // ── public control ─────────────────────────────────────────────────────────

  /**
   * Resolve a pending question.
   * @param {string} id
   * @param {object} payload clarify: {answers:[{id,choice}]} ; gate: {decision}
   */
  answer(id, payload) {
    const pq = this.pendingQuestion;
    if (!pq || pq.id !== id) {
      this._log('orchestrator', 'warn', `answer() ignored: no pending question with id ${id}`);
      return false;
    }
    this.pendingQuestion = null;
    pq.resolve(payload);
    return true;
  }

  /** Abort the run; marks state stopped and kills any child via the signal. */
  stop() {
    if (this.state.status === 'done' || this.state.status === 'stopped') return;
    this._setStatus('stopped');
    try {
      this.abort.abort();
    } catch {
      /* ignore */
    }
    try { this._scheduler?.abort(); } catch { /* ignore */ }
    // Unblock any awaiting question.
    if (this.pendingQuestion) {
      const pq = this.pendingQuestion;
      this.pendingQuestion = null;
      const err = new Error('stopped');
      err.name = 'AbortError';
      pq.reject(err);
    }
  }

  /**
   * Gracefully pause the run: kill in-flight node children (SIGTERM via the
   * pause-only signal), unwind the scheduler, persist a resume point. The worktree is
   * kept. Returns false unless the run is currently 'running'.
   */
  pause() {
    if (this.state.status !== 'running') return false;
    // Set BEFORE anything unwinds: `onSnapshot` uses it to freeze the resume-v2
    // snapshot at the last clean completion, so the executions this pause kills
    // stay non-terminal there and are re-invoked by the scheduler on resume.
    this.pauseRequested = true;
    this._setStatus('pausing');
    try { this._scheduler?.pause(); } catch { /* ignore */ }
    try {
      this.pauseAbort.abort();
    } catch {
      /* ignore */
    }
    // Unblock any awaiting clarify/gate question with the pause sentinel.
    if (this.pendingQuestion) {
      const pq = this.pendingQuestion;
      this.pendingQuestion = null;
      pq.reject(pauseErr());
    }
    return true;
  }

  _checkPause() {
    if (this.pauseRequested) throw pauseErr();
  }

  // ── main run ─────────────────────────────────────────────────────────────────

  /**
   * Execute the full pipeline. Resolves with { status, pipelineDir } on success
   * or stop; rejects only on unexpected internal errors (it emits 'error' too).
   */
  async run() {
    try {
      this.state.startedAt = new Date().toISOString();
      this._setStatus('running');

      // Resolve the workflow topology + per-node run-config and snapshot the UI
      // stepper manifest BEFORE any blocking work (preflight/clarify). It depends
      // only on workflowId + run-config + registry — none of clarify's output — so
      // Running/History render the right nodes (and per-node model·effort) at once
      // instead of the legacy default until clarify ends. resolveWorkflow reads
      // projectDir (NOT the pipeline dir, which doesn't exist yet), so this is safe
      // here. pipelineDir is null in this first event; it is persisted + re-emitted
      // after createPipeline below.
      const registry = loadAgentRegistry(this.agentsDir);
      this.registry = registry;
      // [C5/M4] On a workspace run, resolveGraph substitutes any agent key that a
      // registry entry declares itself the workspace variant of. Single-project runs
      // pass isWorkspace:false, so the resolved graph is the stored template.
      const resolved = await resolveGraph(this.projectDir, this.workflowId, registry, undefined, {
        isWorkspace: this.isWorkspace,
      });
      this._adoptResolvedGraph(resolved);
      // §9.4: hard-fail BEFORE the manifest / createPipeline / worktree — a missing
      // agent key must never reach the scheduler as an empty-prompt node.
      this._preflightAgentKeys(resolved);
      this._assertRunnableGraph(resolved);
      this.state.stepper = buildGraphManifest(resolved);
      this.state.graph = { nodes: resolved.template.nodes, wires: resolved.template.wires };
      this._emit('state', this.getState());

      // 1) Load agent prompts + preflight tool detection (parallel; both safe).
      this._phase('preflight', 0, 'start');
      const [agentPrompts, tools, stepModels] = await Promise.all([
        this._loadAgentPrompts(),
        detectTools(this.projectDir),
        resolveStepModels(this.projectDir, this.claude.model), // never throws
      ]);
      this.agentPrompts = agentPrompts;
      this.toolInstruction = tools.instruction || '';
      this.state.tools = tools;
      this.stepModels = stepModels;
      await this._resolveGuardrails();
      this._log(
        'preflight',
        'info',
        tools.tool
          ? `Detected tool: ${tools.tool}${tools.kind ? ` (${tools.kind})` : ''}`
          : 'No knowledge-graph tooling detected',
      );

      // 2) Resolve the task input through the source seam (sources.mjs) and create
      // the pipeline directory + audit. Absent opts.source the legacy prompt/
      // promptFile opts are wrapped into the equivalent descriptor — same text
      // precedence as createPipeline's old inline resolution (non-empty inline
      // prompt wins, else file), so feature-off prompt.md bytes and row values are
      // identical. On a workspace run the pipeline is written to the WORKSPACE
      // store (artifactPaths routes by workspaceKey) — all owned by createPipeline.
      const source = this.opts.source
        || (typeof this.opts.prompt === 'string' && this.opts.prompt
          ? { type: 'prompt', prompt: this.opts.prompt }
          : this.opts.promptFile
            ? { type: 'markdown', promptFile: this.opts.promptFile }
            : { type: 'prompt', prompt: '' });
      const input = await resolveTaskInput(source, { projectDir: this.projectDir });
      this.pipeline = await createPipeline(this.projectDir, {
        promptText: input.promptText,
        // ?? keeps the legacy both-set corner byte-identical: inline prompt wins the
        // text, but a passed promptFile is STILL copied verbatim into prompt.md.
        promptFile: input.promptFile ?? this.opts.promptFile,
        sourceType: source.type,
        sourceMeta: input.sourceMeta || null,
        extras: this.opts.extras,
        title: this.opts.title,
        guardrailsId: this.guardrailsId,
        ...(this.isWorkspace ? {
          workspaceKey: this.workspaceKey,
          workspaceId: this.workspace.id,
          workspaceName: this.workspace.name,
          workspaceDescription: this.workspace.description || '',
          projects: this.members.map((m) => ({
            projectKey: m.projectKey,
            projectDir: m.projectDir,
            projectName: m.projectName,
          })),
        } : {}),
      });
      this.state.id = this.pipeline.id;
      this.state.pipelineDir = this.pipeline.dir;
      this.logWriter.bind(this.pipeline.dir);                  // start persisting (flushes buffered preflight lines)
      recordArtifact(this.pipeline.id, RUN_LOG_KIND, RUN_LOG_FILE); // index like prompt.md (sync; INSERT OR IGNORE)
      // A11(b): carry the resolved prompt on the in-memory state too (createPipeline
      // already INSERTs prompt and the curated UPSERT excludes it, so persistence is
      // safe — this keeps the live state object self-consistent for any reader).
      this.state.prompt = this.pipeline.promptText;
      // Same reasoning for the run's guardrail selection: createPipeline INSERTed
      // guardrails_id and the curated UPSERT excludes it (creation-immutable), so
      // mirroring it onto the live state only keeps rowToState round-trips honest.
      this.state.guardrailsId = this.guardrailsId;
      // Workspace: mirror the §5.2 superset onto the live state and FREEZE the
      // description now (read from the pipeline's frozen state.json snapshot, never
      // re-read from workspaces.json), so later registry edits never alter this run.
      if (this.isWorkspace) {
        // Freeze from the on-disk snapshot createPipeline wrote (the capped,
        // point-in-time copy) — never re-read from workspaces.json mid-run.
        this.workspaceDescription = await readFile(
          join(this.pipeline.dir, 'workspace-description.md'), 'utf8',
        ).catch(() => this.workspace.description || '');
        this.state.target = 'workspace';
        this.state.workspaceId = this.workspace.id;
        this.state.workspaceKey = this.workspaceKey;
        this.state.workspaceName = this.workspace.name;
        this.state.workspaceDescription = this.workspaceDescription;
        this.state.projectKeys = this.members.map((m) => m.projectKey);
        this.state.projects = this.members.map((m) => ({
          projectKey: m.projectKey,
          projectDir: resolve(m.projectDir),
          projectName: m.projectName,
        }));
        this.state.checkpointRefs = {};
        this.state.branches = {};
      }
      if (!this.state.title) this.state.title = basename(this.pipeline.dir);
      // The title set above (firstMeaningfulLine(prompt) or the dir basename) is
      // PROVISIONAL: shown instantly. Kick off the real LLM title without blocking
      // run start. Skip on a resumed run — it already carries the previously-generated
      // row.title (loaded by resume()). this.resumeOpts (= this.opts.resume) is the
      // resume signal; resume() never reaches this run() site anyway (belt-and-suspenders).
      // The kickoff itself fires AFTER _setupRunRoot() below, so generateTitle's cwd
      // can be this.runCwd (§2.1 row 3) — at this point runCwd is still null.
      this.state.titleProvisional = true;
      this.baseName = this._deriveBaseName(this.pipeline.promptText, this.state.title);
      // Capture the date prefix ONCE so every plan -vN and the review file share
      // the v1 date even if the run crosses midnight.
      this.planDatePrefix = today();
      // Persist the plan/review name linkage so a later delete can find the shared
      // markdown exactly (state.artifacts is not persisted; names are the only link).
      this.state.baseName = this.baseName;
      this.state.datePrefix = this.planDatePrefix;
      await this._persist();
      this._startHeartbeat(); // claim ownership + begin liveness heartbeat (crash detection)
      this._artifact('pipeline', this.pipeline.dir);
      await appendAudit(this.pipeline.dir, `Pipeline created (id ${this.pipeline.id}).`);
      if (tools.tool) {
        await appendAudit(
          this.pipeline.dir,
          `Preflight: using **${tools.tool}**${tools.kind ? ` (${tools.kind})` : ''}.`,
        );
      }

      // 3) Ensure a git repo + checkpoint commit (per member on a workspace run).
      if (this.isWorkspace) await this._ensureGitCheckpointAll();
      else await this._ensureGitCheckpoint();
      this._phase('preflight', 0, 'done');
      this._checkAbort();

      // 3b) Set up the run root + the per-pipeline worktree(s). All subsequent
      // claude spawns cwd into this.runCwd (the run root on a detached workspace
      // run, else the primary's worktree); per-member fan-out sub-agents work in
      // this.workDirs. Artifacts route via the workspace store.
      await this._setupRunRoot();
      // The provisional title (firstMeaningfulLine(prompt) or the dir basename) is
      // shown instantly; kick off the real LLM title without blocking run start, now
      // that runCwd exists so no worca-cc process is started inside the user's live
      // checkout (§2.1 row 3). Skip on a resumed run — it already carries the
      // previously-generated row.title (loaded by resume()). this.resumeOpts (=
      // this.opts.resume) is the resume signal; resume() never reaches this run()
      // site anyway (belt-and-suspenders).
      if (!this.resumeOpts) this._kickoffTitleGeneration();
      this._checkAbort();

      // 3c) Build the knowledge graph INSIDE each worktree so agents can query it.
      if (this.isWorkspace) await this._buildWorktreeGraphAll();
      else await this._buildWorktreeGraph();
      this._checkAbort();

      // 3d) Resolve + validate declared agent skills (hard gate, UNCHANGED in
      //     semantics), then assemble the run context for EVERY detached run —
      //     including the zero-declared-skills case, which is every shipped
      //     workflow today (`grep requiresSkills agents/` → zero hits).
      const requiredSkills = collectRequiredSkills(this.registry, this._skillPlan(resolved));
      let resolvedSkills = new Map();          // ← HOISTED; empty Map on the default workflow
      if (requiredSkills.length) {
        const skillCtx = { repoRoot: REPO_ROOT, projectDir: this.projectDir, pluginDirs: pluginSkillDirs() };
        resolvedSkills = validateSkills(requiredSkills, skillCtx); // throws => caught => run ends 'error'
        if (this.runRootMode !== 'detached') {
          // LEGACY delivery, byte-identical to today: inject ONLY into real isolated
          // worktrees, never the main projectDir, so a copy can never pollute the
          // user's working tree.
          const candidates = this.isWorkspace ? [...this.workDirs.values()] : [this.workDir];
          const worktrees = candidates.filter((d) => d && d !== this.projectDir);
          const injected = await injectSkills(resolvedSkills, { targets: worktrees });
          if (injected.length) {
            await appendAudit(
              this.pipeline.dir,
              `Skills: injected ${injected.join(', ')} into ${worktrees.length} worktree(s).`,
            );
          }
        }
      }
      this._checkAbort();

      // 3e) Context assembly — UNCONDITIONAL on detached runs. Gated ONLY on the
      // recorded mode, NEVER on requiredSkills.length (nesting it back under that
      // guard would silently void R1(a)-(d) and R2 on every default pipeline while
      // leaving npm test and both mock smokes green), and NOT gated on mock either:
      // it is pure fs work whose outputs the smokes assert. Under detached,
      // bundle/plugin delivery happens inside assembleRunContext's mount (§5.6
      // entry class 3), so the legacy injectSkills branch above is correctly skipped.
      // The assembly also emits §8.21's per-member "project sub-agents are not
      // discoverable at a run-root cwd" warning (run log + run.json.warnings) and the
      // matching roster note in the generated CLAUDE.md — derived there, from each
      // member's worktree, so resume's re-assembly reproduces all three carriers
      // instead of dropping them when it rewrites `warnings`.
      if (this.runRootMode === 'detached') {
        await this._assembleContext(resolvedSkills);
      }
      this._checkAbort();

      // 4) (Clarify now runs as the first graph node — see _runClarifyNode.)

      // 5) Dispatch the resolved workflow (already snapshotted into state.stepper
      //    at run start). Persist now that this.pipeline exists, and re-emit the
      //    full state (with pipelineDir) for any client that connected mid-preflight.
      await this._persist();
      this._emit('state', this.getState());
      await appendAudit(this.pipeline.dir, `Workflow: **${resolved.template.name}** (${resolved.template.id}).`);
      const dispatched = await this._runGraph();
      this._checkAbort();
      if (dispatched === 'paused') return await this._completePaused();

      // 9) Done.
      this._setStatus('done');
      this.state.resumePoint = null; // finished rows are not resumable (clears the boundary trail)
      this._phase('done', 0, 'done');
      await this._persist();
      await appendAudit(this.pipeline.dir, `Pipeline finished with status **done**.`);
      await this._buildResults();          // refs + worktree still live here
      await this._reportToSource();        // task-source write-back (never throws, spec §7.5)
      const done = {
        status: 'done',
        pipelineDir: this.pipeline.dir,
        endReached: this.state.endReached,
        result: this.state.result,
      };
      this._emit('done', done);
      return done;
    } catch (err) {
      if ((isPause(err) || this.state.status === 'pausing') && this.state.status !== 'stopped') {
        if (this.pipeline) {
          // Paused before (or outside) the scheduler: an empty-snapshot point, which
          // restarts the graph from its task card on resume.
          if (!this.state.resumePoint) this.state.resumePoint = this._buildResumePoint(null);
          return await this._completePaused();
        }
        // No pipeline yet: nothing to resume; treat as stopped.
        this._setStatus('stopped');
        this._emit('done', { status: 'stopped', pipelineDir: null });
        return { status: 'stopped', pipelineDir: null };
      }
      if (isAbort(err) || this.state.status === 'stopped') {
        this._setStatus('stopped');
        // Stopped runs are not resumable: never persist a resume point (e.g. one
        // _runGraph assigned before stop won the race) alongside a torn-down worktree.
        this.state.resumePoint = null;
        if (this.pipeline) {
          await this._persist().catch(() => {});
          await appendAudit(this.pipeline.dir, `Pipeline **stopped**.`).catch(() => {});
        }
        this._emit('done', {
          status: 'stopped',
          pipelineDir: this.pipeline?.dir || null,
        });
        return { status: 'stopped', pipelineDir: this.pipeline?.dir || null };
      }
      this._setStatus('error');
      const message = err?.message || String(err);
      this._emit('error', { message });
      if (this.pipeline) {
        await this._persist().catch(() => {});
        await appendAudit(this.pipeline.dir, `Pipeline **error**: ${message}`).catch(() => {});
      }
      this._emit('done', {
        status: 'error',
        pipelineDir: this.pipeline?.dir || null,
      });
      return { status: 'error', pipelineDir: this.pipeline?.dir || null, error: message };
    } finally {
      this._stopHeartbeat(); // clear timer + NULL owner columns (done/stopped/error/paused)
      // C1: tear the run root + worktree(s) down on done/stopped/error — the branch is
      // always kept (every member's, on a workspace run), only the disposable checkout
      // is removed. But NEVER on a pause: the checkout (with any uncommitted agent
      // work) and the run root are the things we resume into (§8.13).
      if (this.state.status !== 'paused' && this.state.status !== 'pausing') {
        await this._teardownRunRoot().catch(() => {});
      }
      await this.logWriter.close().catch(() => {}); // flush + stop timer (last, to capture teardown logs)
    }
  }

  /**
   * Continue a paused pipeline from its persisted resume point. Mirrors run()'s
   * shell but skips createPipeline / checkpoint / worktree / graph setup — those
   * artifacts exist from the original run. Resolves like run().
   */
  async resume() {
    const saved = this.resumeOpts;
    if (!saved?.row || !saved?.resumePoint) throw new Error('resume(): no saved pipeline provided');
    const { row, resumePoint: rp, steps } = saved;
    if (row.status !== 'paused' && row.status !== 'interrupted') {
      throw new Error(`resume(): pipeline is "${row.status}", not resumable`);
    }
    // Defense in depth: an archived run's worktree/run root were reclaimed, so
    // resuming it would rebuild nothing and write into a reaped tree.
    if (row.archived_at) throw new Error('resume(): pipeline is archived');
    // v2-ONLY: a v1 point describes a step-array position the graph engine cannot
    // re-enter. The V17 startup sweep already marks such rows interrupted with the
    // reason; this is the belt-and-braces refusal for one that slipped through.
    if (rp.version !== 2) throw new Error(`resume(): unsupported resume point version ${rp.version}`);
    try {
      // ── rehydrate identity + state ──
      this.state.id = row.id;
      this.state.title = row.title;
      this.state.startedAt = row.started_at;
      this.state.prompt = row.prompt;
      this.state.stepper = safeParse(row.stepper);
      this.state.tools = safeParse(row.tools);
      this.state.branch = safeParse(row.branch);
      this.state.steps = (steps || []).map((s) => ({ ...s, runningSince: null }));
      this.baseName = row.base_name;
      this.planDatePrefix = row.date_prefix;
      this.pipeline = { id: row.id, dir: rp.pipelineDir, promptText: row.prompt || '' };
      this.state.pipelineDir = rp.pipelineDir;
      this.logWriter.bind(rp.pipelineDir);
      recordArtifact(row.id, RUN_LOG_KIND, RUN_LOG_FILE);
      this.stepModels = rp.stepModels || null;
      this.workflowId = rp.workflowId || this.workflowId;
      // The run-global plan-version counter, so a resumed refiner keeps versioning
      // up instead of re-minting a suffix the paused run already used.
      this._planVersion = Number(rp.planVersion) || 0;
      // One-shot session re-attach: only the executions that were still in flight
      // when the run paused resume their captured claude session.
      this._resumeSessions = new Map(
        (this.state.steps || [])
          .filter((s) => s.sessionId && s.status !== 'done')
          .map((s) => [s.key, s.sessionId]),
      );
      // Rehydrate the run's selection BEFORE re-resolving so resume enforces the
      // LATEST saved set definition (missing set -> warn + Permissive, inside
      // _resolveGuardrails). Legacy resume points without the field fall back to
      // the constructor default ('permissive'). Keep state in sync for re-persist.
      this.guardrailsId = rp.guardrailsId || this.guardrailsId;
      this.state.guardrailsId = this.guardrailsId;
      await this._resolveGuardrails();
      // Restore the EFFECTIVE instruction from the resume point — by dispatch time
      // run() has replaced the detect-time tools.instruction with the in-worktree
      // graph-build outcome (worktreeGraphInstruction() or ''). Falling back to
      // tools.instruction would tell resumed agents a graph exists that the original
      // run suppressed. (Fallback keeps old-shape resume points working.)
      this.toolInstruction = typeof rp.toolInstruction === 'string' ? rp.toolInstruction : (this.state.tools?.instruction || '');

      // ── run-root mode: read the RECORDED value, never the live flag (§10) ──
      // Single-project rides state.branch.runRootMode (the pipelines.branch JSON
      // column); workspace rides workspace_meta.runRootMode (real only because of the
      // artifacts.mjs whitelist fold). Absent ⇒ 'legacy', correct for every
      // pre-change row. A run can therefore never be resumed into a mode it was not
      // started in, no matter when the default flips or rolls back.
      const meta = safeParse(row.workspace_meta);
      const recordedMode = this.isWorkspace
        ? (meta?.runRootMode || 'legacy')
        : (this.state.branch?.runRootMode || 'legacy');
      this.runRootMode = recordedMode === 'detached' ? 'detached' : 'legacy';
      // Re-stamp BEFORE the first persist so a resumed workspace run re-persists the
      // pin rather than dropping it (toPipelineRow reads it off state every persist).
      this.state.runRootMode = this.runRootMode;
      /** The persisted manifest, read once on a detached resume (re-assembly below). */
      let resumeManifest = null;
      if (this.runRootMode === 'detached') {
        this.runRoot = join(worcaHome(), 'runs', row.id);
        // Rehydrate the §8.8 injected set from the manifest FIRST, so teardown still
        // excludes/rescues/cleans even if re-assembly is skipped or degrades; the
        // re-assembly result then overwrites it.
        resumeManifest = await readRunManifest(this.runRoot);
        if (resumeManifest?.injectedPaths && typeof resumeManifest.injectedPaths === 'object') {
          this.injectedPaths = resumeManifest.injectedPaths;
        }
      }

      // ── worktree re-attach (single-project; workspace below) ──
      const wt = this.state.branch?.worktreeDir;
      if (wt && !existsSync(wt)) throw new Error(`worktree missing: ${wt} — cannot resume`);
      if (wt) {
        this.workDir = wt;
        this.branchInfo = {
          worktreeDir: wt,
          branch: this.state.branch.feature,
          sourceBranch: this.state.branch.source,
          reusedExisting: true,
        };
        if (!this.isWorkspace) {
          // Unified shapes must hold on resume too: one workDirs entry + one
          // checkpointRefs entry, so _buildResults / _reposCtx / _teardownRunRoot
          // read the same shape they do on a fresh run.
          const onlyKey = this.members[0]?.projectKey;
          if (onlyKey) {
            this.workDirs.set(onlyKey, wt);
            this.branchInfos.set(onlyKey, this.branchInfo);
            this.checkpointRefs[onlyKey] = rp.checkpointRefs?.[onlyKey] || null;
            this.state.branches = { ...(this.state.branches || {}), [onlyKey]: { ...this.state.branch } };
            this.state.checkpointRefs = { ...this.checkpointRefs };
          }
        }
      }
      this.checkpointRef = rp.checkpointRef || null;
      // §5.3: cwd for every spawn. Detached workspace runs start at the neutral run
      // root; everything else at the recorded worktree — identical to a legacy run
      // that never paused.
      this.runCwd = (this.runRootMode === 'detached' && this.isWorkspace)
        ? this.runRoot
        : (wt || null);

      // ── workspace rehydration (no-op on single-project) ──
      if (this.isWorkspace && meta) {
        this.workspaceDescription = meta.workspaceDescription || '';
        this.checkpointRefs = meta.checkpointRefs || {};
        for (const p of rp.workspace?.projects || []) {
          if (p.projectKey && p.worktreeDir) {
            if (!existsSync(p.worktreeDir)) throw new Error(`worktree missing: ${p.worktreeDir} — cannot resume`);
            this.workDirs.set(p.projectKey, p.worktreeDir);
            this.toolInstructions.set(p.projectKey, p.graphInstruction || '');
            // Re-arm teardown: _teardownWorktreeAll returns immediately on an empty
            // branchInfos map, so without this a resumed workspace run reaching
            // done/stopped/error would leak every member worktree and never run
            // _commitWork (resumed work silently absent from the feature branches).
            // Shape mirrors createWorktree()'s result as registered by _setupRunRoot.
            this.branchInfos.set(p.projectKey, {
              worktreeDir: p.worktreeDir,
              branch: meta.branches?.[p.projectKey]?.feature,
              sourceBranch: meta.branches?.[p.projectKey]?.source,
              reusedExisting: true,
            });
          }
        }
        Object.assign(this.state, {
          target: 'workspace', workspaceId: meta.workspaceId, workspaceKey: this.workspaceKey,
          workspaceName: meta.workspaceName, workspaceDescription: this.workspaceDescription,
          projectKeys: meta.projectKeys || [], projects: meta.projects || [],
          checkpointRefs: this.checkpointRefs, branches: meta.branches || {},
        });
      }

      // ── prompts/registry (cheap, local) ──
      this.registry = loadAgentRegistry(this.agentsDir);
      this.agentPrompts = await this._loadAgentPrompts();

      this.state.resumePoint = null; // consumed; cleared on the next persist
      this._setStatus('running');
      await this._persist();
      this._startHeartbeat();
      await appendAudit(this.pipeline.dir, `Pipeline **resumed** (${(rp.snapshot?.execs || []).length} recorded execution(s)).`);
      this._emit('state', this.getState());

      // ── §5.2 detached resume: idempotent re-assembly (self-healing) ──
      // Only when the RECORDED mode is 'detached', and NEVER with a resolvedSkills
      // variable — that path does not exist here: resume never runs
      // collectRequiredSkills/validateSkills (it loads the registry +
      // agentPrompts only, and a mid-run resume carries a frozen rp.plan). The
      // `name -> {source, path, requiredBy}` map persisted at first assembly is the
      // substitute. Assembly is a pure function of members + settings + graph
      // outcomes + that map, so a missing CLAUDE.md / mcp.json / skill mount
      // self-heals byte-identically. Workspace graph instructions were rehydrated
      // from the bus channel above; single-project runs leave the map empty exactly
      // as on a fresh run, and the generator tolerates a missing instruction per
      // member. A member real dir deleted while paused degrades per §8.20 — a
      // missing SOURCE never throws (a missing worktree still hard-fails, above).
      if (this.runRootMode === 'detached') {
        await this._assembleContext(resumeManifest?.skillResolutions ?? new Map());
        // AFTER the assembly: it rewrites run.json.warnings wholesale, so recording
        // this first would drop it from the durable ledger.
        if (!resumeManifest) {
          await this._recordRunWarning(
            'run.json was missing or unparseable, so the bundle/plugin skills this run mounted ' +
            'could not be restored to the skill mount; real-dir and root skills were re-mounted ' +
            'normally. An agent that declares `requiresSkills` may not find its skill.',
          );
        }
      }

      // ── graph: re-resolved, then re-validated. The snapshot is the position;
      // the TOPOLOGY is re-read so an agent whose ports changed while the run sat
      // paused aborts cleanly instead of binding a port that no longer exists.
      const resolved = await resolveGraph(this.projectDir, this.workflowId, this.registry, undefined, {
        isWorkspace: this.isWorkspace,
      });
      this._adoptResolvedGraph(resolved);
      // §9.4: the re-resolved graph must still resolve every agent key — the
      // providing plugin may have been disabled or uninstalled while this run sat
      // paused. Same gate, same messages as run().
      this._preflightAgentKeys(resolved);
      this._assertRunnableGraph(resolved);
      this.state.graph = { nodes: resolved.template.nodes, wires: resolved.template.wires };

      const dispatched = await this._runGraph(rp.snapshot || null);
      this._checkAbort();
      if (dispatched === 'paused') return await this._completePaused();

      this._setStatus('done');
      this.state.resumePoint = null; // finished rows are not resumable (clears the boundary trail)
      this._phase('done', 0, 'done');
      await this._persist();
      await appendAudit(this.pipeline.dir, `Pipeline finished with status **done**.`);
      await this._buildResults();          // refs + worktree still live here
      await this._reportToSource();        // task-source write-back (never throws, spec §7.5)
      const done = {
        status: 'done',
        pipelineDir: this.pipeline.dir,
        endReached: this.state.endReached,
        result: this.state.result,
      };
      this._emit('done', done);
      return done;
    } catch (err) {
      if ((isPause(err) || this.state.status === 'pausing') && this.state.status !== 'stopped') {
        if (this.pipeline) {
          if (!this.state.resumePoint) this.state.resumePoint = rp; // re-arm the consumed point: a paused row must stay resumable
          return await this._completePaused();
        }
      }
      if (isAbort(err) || this.state.status === 'stopped') {
        this._setStatus('stopped');
        // Stopped runs are not resumable: never persist a resume point alongside
        // a torn-down worktree (mirrors run()'s stopped branch).
        this.state.resumePoint = null;
        if (this.pipeline) {
          await this._persist().catch(() => {});
          await appendAudit(this.pipeline.dir, `Pipeline **stopped**.`).catch(() => {});
        }
        this._emit('done', { status: 'stopped', pipelineDir: this.pipeline?.dir || null });
        return { status: 'stopped', pipelineDir: this.pipeline?.dir || null };
      }
      this._setStatus('error');
      const message = err?.message || String(err);
      this._emit('error', { message });
      if (this.pipeline) {
        await this._persist().catch(() => {});
        await appendAudit(this.pipeline.dir, `Pipeline **error**: ${message}`).catch(() => {});
      }
      this._emit('done', { status: 'error', pipelineDir: this.pipeline?.dir || null });
      return { status: 'error', pipelineDir: this.pipeline?.dir || null, error: message };
    } finally {
      this._stopHeartbeat(); // clear timer + NULL owner columns (done/stopped/error/paused)
      // Same teardown as run()'s finally — wiring only run()'s would keep legacy
      // teardown on every detached run that finishes after a resume (including every
      // crash-interrupted run, §8.12's primary scenario): run root leaked until the
      // next boot, no stray scan, no injected-path cleanup.
      if (this.state.status !== 'paused' && this.state.status !== 'pausing') {
        await this._teardownRunRoot().catch(() => {});
      }
      await this.logWriter.close().catch(() => {}); // flush + stop timer (last, to capture teardown logs)
    }
  }

  // ── run-root / worktree setup ────────────────────────────────────────────────

  /** Single-project branch resolution — VERBATIM _setupWorktree semantics.
   *  Deliberately NOT _resolveMemberBranches, which would (a) suffix an explicit
   *  feature with `-<projectName slug>` (breaking test/orchestrator-worktree.test.mjs,
   *  'explicit featureBranch is honored verbatim'), (b) derive suggested names from
   *  `opts.title + projectName` (suggestBranchName is title-first, so derived names
   *  would come from the project name instead of the prompt), and (c) silently swap
   *  an invalid --source for the default branch, where createWorktree's M1 gate must
   *  keep failing loudly. */
  async _resolveSingleBranches() {
    const source = this.branchOpts.source || (await resolveDefaultBranch(this.projectDir));
    const featureRaw = this.branchOpts.feature
      ? sanitizeBranchName(this.branchOpts.feature)
      : suggestBranchName({ prompt: this.pipeline.promptText,
                            title: this.opts.title || null,
                            pipelineId: this.pipeline.id });
    return { source, featureRaw };
  }

  /**
   * Set up the run root + every member worktree (§5.2 step 5). Replaces
   * _setupWorktree / _setupWorktreeAll with ONE path for both targets.
   *
   * Detached-only in this step: run-root/`repos/` creation, the baseDir/checkoutName
   * inputs to createWorktree, and the manifest write. EVERYTHING else — branch
   * resolution, workDirs/branchInfos/state.branches registration, the scalar
   * mirrors, the mode stamp, the persist + emit — runs identically in both modes.
   */
  async _setupRunRoot() {
    this.state.branches = this.state.branches || {};      // belt-and-braces for resumed/legacy shapes
    this.runRootMode = runRootMode();                     // §10 flag, read ONCE, here, per pipeline
    this.state.runRootMode = this.runRootMode;            // top-level pin → workspace_meta (artifacts.mjs)
    const detached = this.runRootMode === 'detached';
    this.runRoot = detached ? join(worcaHome(), 'runs', this.pipeline.id) : null;
    const reposBase = detached ? join(this.runRoot, 'repos') : null;
    if (detached) await mkdir(reposBase, { recursive: true });

    this._log('worktree', 'info', `Resolving source/feature branches for ${this.members.length} member(s)…`);
    // Settle EVERY member before propagating any failure — carried VERBATIM from
    // _setupWorktreeAll. mapWithCap is Promise.all: it rejects the instant one
    // member throws and would abandon an in-flight sibling whose worktree
    // materializes AFTER run()'s finally has snapshotted branchInfos — an orphaned
    // checkout on disk. Under legacy that orphan sits INSIDE the user's repo with
    // the legacy sweep disabled, i.e. permanent. The partial-setup test
    // (test/orchestrator-workspace.test.mjs) guards exactly this.
    const setupFailures = [];
    await mapWithCap(this.members, fanoutCap(), async (m) => {
      try {
        const { source, featureRaw } = this.isWorkspace
          ? await this._resolveMemberBranches(m)          // unchanged (member-suffixed names)
          : await this._resolveSingleBranches();          // single: today's exact semantics
        const info = await createWorktree({
          projectDir: resolve(m.projectDir),              // the REAL dir: git runs here
          pipelineId: this.pipeline.id,
          // detached ⇒ <runRoot>/repos/<projectKey>, uniqueness from the run root.
          // legacy   ⇒ both omitted, so worktree.mjs falls back to its retained
          //            default <projectDir>/.worca-cc/worktrees/<pipelineId> (§10).
          ...(detached ? { baseDir: reposBase, checkoutName: m.projectKey } : {}),
          sourceBranch: source,
          featureBranch: featureRaw,
          signal: this.abort.signal,
        });
        // Register EAGERLY (Map.set is synchronous) so teardown always sees it.
        this.workDirs.set(m.projectKey, info.worktreeDir);
        this.branchInfos.set(m.projectKey, info);
        this.state.branches[m.projectKey] = { source: info.sourceBranch, feature: info.branch,
                                              worktreeDir: info.worktreeDir,
                                              reusedExisting: info.reusedExisting };
        const reuseNote = info.reusedExisting ? ' (resumed existing branch)' : '';
        await appendAudit(this.pipeline.dir,
          `Worktree \`${m.projectKey}\`: \`${info.branch}\` (off \`${info.sourceBranch}\`)${reuseNote} at \`${info.worktreeDir}\`.`,
        ).catch(() => {});                                // per-member audit
      } catch (err) {
        setupFailures.push(err);
      }
    });
    if (setupFailures.length) {
      throw setupFailures[0] instanceof Error ? setupFailures[0] : new Error(String(setupFailures[0]));
    }

    const primary = this.members[0];                      // members sorted by projectKey; single: the only one
    this.workDir = this.workDirs.get(primary.projectKey); // back-compat scalar (display, PR route)
    this.branchInfo = this.branchInfos.get(primary.projectKey);
    this.runCwd = (detached && this.isWorkspace)
      ? this.runRoot                                      // neutral cwd (§5.8)
      : this.workDirs.get(primary.projectKey);            // single-project detached, or either mode under legacy
    if (!this.isWorkspace) {
      // Single: the mode pin rides state.branch (pipelines.branch column).
      this.state.branch = { ...this.state.branches[primary.projectKey], runRootMode: this.runRootMode };
    } else {
      // Workspace: the scalar mirror is KEPT for display/back-compat readers. NOTE
      // the precise consumer set: workspace pipeline-delete iterates state.branches
      // per member; it is the SINGLE-project delete path that reads state.branch.
      // The pin rides workspace_meta.runRootMode via this.state.runRootMode + the
      // artifacts.mjs whitelist delta.
      this.state.branch = { ...this.state.branches[primary.projectKey] };
    }
    // Minimal manifest, written HERE: the boot sweep and pipeline-delete need member
    // real dirs + worktree paths from the very first detached run, before any context
    // field exists. Legacy runs have no run root and therefore no manifest — the
    // sweeps fall back to the DB columns.
    if (detached) await writeRunManifest(this.runRoot, {
      pipelineId: this.pipeline.id,
      runRootMode: this.runRootMode,
      isWorkspace: this.isWorkspace,
      members: this.members.map((m) => ({
        projectKey: m.projectKey, projectName: m.projectName,
        projectDir: resolve(m.projectDir),               // the REAL repo — what `git worktree remove` needs
        worktreeDir: this.workDirs.get(m.projectKey),
      })),
    });
    await this._persist();
    this._emit('state', this.getState());
  }

  /**
   * Resolve THE run's guardrails: the per-run selected set (this.guardrailsId,
   * default 'permissive') IS the policy — member project configs are NOT read
   * (per-project guardrails were removed; one set applies uniformly to every
   * member). Built-ins resolve from GUARDRAIL_PRESETS at read time; user sets
   * from the store at read time. Called from run() AND resume() — resume
   * re-reads the set by id, so a set edited while paused is enforced at its
   * LATEST definition. A missing/deleted set fails OPEN to the Permissive
   * (empty) policy with a loud warn — never an abort.
   */
  async _resolveGuardrails() {
    let set = await readGuardrailSet(this.guardrailsId || 'permissive');
    if (!set) {
      this._log('guardrails', 'warn',
        `guardrail set "${this.guardrailsId}" not found; running with the Permissive (empty) policy`);
      set = await readGuardrailSet('permissive'); // virtual built-in: always resolves
    }
    // One UNIFORM honor value for every member: the run set's honorProjectSettings
    // gates the per-member repo-settings deny lift. The map SHAPE is unchanged
    // (run-context.mjs's honorByKey consumer is untouched); only its values are
    // uniform now — there is no per-member saved preference anymore.
    const honor = set.settings.honorProjectSettings !== false;
    this.guardrailHonorByKey = new Map(this.members.map((m) => [m.projectKey, honor]));
    // unionGuardrails over the ONE-element list keeps the tested normalization
    // path (fresh arrays, de-dupe, a non-scrubbing set's dormant allowlist
    // drops — enforcement gates allowlist on envScrub anyway): the run's set is
    // the whole union. Its envAllowlist is NOT stripped — it IS the policy;
    // there is no member policy to relax against.
    this.guardrails = unionGuardrails([set.settings]);
    this.guardrailPermissionRules = guardrailsToPermissionRules(this.guardrails);
  }

  /**
   * §5.2 step 7 / §6 Phase 3: assemble the run context at the run root and wire its
   * outputs into every consumer. Called from run() (after the skills gate, with the
   * HOISTED resolutions) and from resume() (with the resolutions persisted in
   * run.json, since resume never re-runs collectRequiredSkills/validateSkills).
   *
   * Detached-only: every caller is already gated on the RECORDED mode. It is
   * deliberately NOT gated on requiredSkills.length or on mock mode — assembly is
   * pure fs work whose outputs the mock smokes assert, and nesting it under the
   * skills gate would silently void R1(a)-(d) and R2 on every default pipeline.
   * @param {Map<string,object>|object} resolvedSkills possibly EMPTY (the default workflow)
   */
  async _assembleContext(resolvedSkills) {
    // Warnings this run root ALREADY reported (from the pre-pause segment of a
    // resumed run). Assembly is idempotent, so it re-derives the same lines every
    // time; re-logging them would double every context warning — including §8.21's —
    // in the run log at each resume. run.json is the cross-instance record, so it is
    // what "already reported" means (a resumed run is a NEW orchestrator object, so an
    // in-memory Set could not see the earlier segment). Read BEFORE the assembly,
    // which rewrites `warnings` wholesale.
    const alreadyReported = new Set(
      this.runRoot ? ((await readRunManifest(this.runRoot))?.warnings ?? []) : [],
    );
    const rc = await assembleRunContext({
      runRoot: this.runRoot,
      members: this.members.map((m) => ({
        ...m,
        worktreeDir: this.workDirs.get(m.projectKey),
        // §5.4 requires the roster to carry each member's branch + checkpoint ref;
        // the generator omits either cell when it is absent (e.g. a resume whose
        // branchInfos were rehydrated without one).
        branch: this.branchInfos.get(m.projectKey)?.branch || null,
        checkpointRef: this.checkpointRefs?.[m.projectKey] || null,
      })),
      projectsRoot: getProjectsRoot(),
      isWorkspace: this.isWorkspace,
      requiredSkillResolutions: resolvedSkills,           // possibly empty — a valid, common input
      graphInstructions: this.toolInstructions,
      homeDir: homedir(),
      honorByKey: this.guardrailHonorByKey,
    });
    this.runContext = rc;
    if (rc?.projectPermissions) {
      this.guardrailPermissionRules = mergePermissionRules(this.guardrailPermissionRules, rc.projectPermissions);
    }
    // Audit (spec bullet): the resolved effective policy, compact, into run.json.
    // Written HERE because runRoot exists only on detached runs and this is the
    // one site where this.guardrails and the FINAL (post-lift) rule set are both
    // in scope on run() AND resume(). updateRunManifest merges the patch
    // (run-manifest.mjs:79-82), and a resume re-writes the same values
    // idempotently. denyCount includes the lifted repo deny rules, whose exact
    // list Task 6 already persisted as run.json.projectPermissions. Legacy runs
    // have no run.json, so no audit record — run.json is a detached-run artifact.
    // guardrailsId names the selected set (id only — sets are mutable and resolve
    // by reference, so this is not a content snapshot).
    await updateRunManifest(this.runRoot, {
      guardrails: {
        envScrub: !!this.guardrails?.envScrub,
        denyCount: this.guardrailPermissionRules?.deny?.length || 0,
        protectedCount: this.guardrails?.protectedPaths?.length || 0,
        guardrailsId: this.guardrailsId,
      },
    });
    this.injectedPaths = rc.injectedPaths;                // feeds _excludePathspecs / teardown / rescue (§8.8)
    this.mcpConfigPath = rc.mcpConfigPath;
    // V1-gated (§4.1 outcome table). Branch (a) PASSED on this CLI (server wildcard),
    // so one grant per merged server; the 'per-tool' / 'none' branches would leave
    // this empty and rely on the frontmatter union alone.
    this.mcpServerGrants = MCP_GRANT_MODE === 'server'
      ? rc.mcpServerNames.map((s) => `mcp__${s}`)
      : [];
    // Durable per §5.2's ledger rules: the run log survives teardown, and the
    // warnings are already inside run.json (written by the assembly — which is also
    // what makes them survive a resume, since it rewrites the array from scratch).
    // Record-once semantics across a pause boundary: a line this run root already
    // reported is not repeated in the log.
    for (const w of rc.warnings) {
      if (alreadyReported.has(w)) continue;
      this._log('context', 'warn', w);
    }
    await appendAudit(this.pipeline.dir, renderContextAudit(rc)).catch(() => {});
    await this._recordCapabilities();
    return rc;
  }

  /**
   * §8.18 / gate V5: parse `claude --help` ONCE per run and assert `--mcp-config`.
   * On absence, degrade gracefully — skip the flag, warn loudly naming the required
   * version — rather than failing the run: R1(a)/(c) still hold via the cwd and
   * ancestor mechanisms, but R1(b) is degraded and is REPORTED as degraded. V5
   * passed on the development machine; this stays shipped as version-drift
   * insurance for other machines.
   *
   * Mock runs never spawn `claude`, so the probe is skipped there (it would add a
   * subprocess to every test for an answer no mock run can act on) and recorded as
   * unprobed.
   */
  async _recordCapabilities() {
    if (!this.runRoot) return;
    if (this.claude.mock) {
      await updateRunManifest(this.runRoot, {
        capabilities: { mcpGrants: MCP_GRANT_MODE, mcpConfig: null, version: null, probed: false },
      });
      return;
    }
    const caps = await probeClaudeCapabilities(this.claude.bin);
    if (!caps.mcpConfig && this.mcpConfigPath) {
      await this._recordRunWarning(
        `this \`claude\` build does not advertise --mcp-config (version ${caps.version || 'unknown'}); ` +
        'worca-cc needs >= 2.1.220 to deliver project/root MCP servers. Skipping the flag — ' +
        "R1(b) is DEGRADED for this run: the merged servers in mcp.json are NOT available to any agent.",
      );
      this.mcpConfigPath = null;
      this.mcpServerGrants = [];
    }
    await updateRunManifest(this.runRoot, {
      capabilities: { mcpGrants: MCP_GRANT_MODE, ...caps, probed: true },
    });
  }

  /**
   * Resolve the worktree source/feature branch pair for ONE member (D2). The named
   * source (run-level or per-member) is used only when it resolves to a real commit
   * IN THAT member's repo; otherwise the member's own default branch. The feature is
   * the run-level featureBranch suffixed with the project slug (so members never
   * collide on one branch name), or a suggested name when none was given.
   * @param {{projectDir,projectKey,projectName,branch?:{source?,feature?}}} m
   * @returns {Promise<{source:string, featureRaw:string}>}
   */
  async _resolveMemberBranches(m) {
    const dir = resolve(m.projectDir);
    const named = (m.branch && m.branch.source) || this.branchOpts.source || null;
    const source = (named && (await isValidSourceRef(dir, named)))
      ? named
      : await resolveDefaultBranch(dir);
    const feature = (m.branch && m.branch.feature) || this.branchOpts.feature || null;
    const featureRaw = feature
      ? sanitizeBranchName(`${feature}-${slugify(m.projectName)}`)
      : suggestBranchName({
          prompt: this.pipeline.promptText,
          title: `${this.opts.title || ''} ${m.projectName}`.trim() || null,
          pipelineId: this.pipeline.id,
        });
    return { source, featureRaw };
  }

  /**
   * Build a graphify AST graph INSIDE the worktree so agents (which run with
   * cwd=workDir) can query it. graphify-out/ is gitignored, so it never reaches
   * the reviewer diff, the kept-branch commit, or survives teardown.
   *
   * Fail-safe — never throws. Skipped when: mock mode (keeps `npm run smoke`
   * offline); no worktree was created; or the graphify binary is not on PATH.
   * On build failure/timeout the run proceeds with no graph instruction.
   */
  async _buildWorktreeGraph() {
    if (this.claude.mock) return; // mock runs never use the graph (intentionally silent)
    if (this.workDir === this.projectDir) {
      this._log('graph', 'debug', 'No worktree (workDir===projectDir); skipping in-worktree graph build.');
      return; // building "in the worktree" would write into main
    }
    if (this.state.tools?.kind !== 'cli') {
      this.toolInstruction = '';
      this._log('graph', 'info', 'graphify CLI not on PATH; skipping in-worktree graph build');
      return;
    }
    this._log('graph', 'info', 'Building graphify graph in worktree (AST-only, no LLM)…');
    const res = await runGraphifyUpdate({
      dir: this.workDir,
      cwd: this.workDir,
      timeoutMs: this.graphBuildTimeoutMs,
    });
    if (res.ok) {
      this.toolInstruction = worktreeGraphInstruction();
      this._log('graph', 'info', 'graphify graph built in worktree.');
      await appendAudit(this.pipeline.dir, 'Preflight: built graphify graph in worktree (AST-only).').catch(() => {});
    } else {
      this.toolInstruction = '';
      this._log(
        'graph',
        'warn',
        `graphify build ${res.timedOut ? 'timed out' : 'failed'}; proceeding without graph grounding`,
      );
    }
  }

  /**
   * Workspace graph builds (D4): build a graphify graph inside EACH member worktree
   * in parallel (cap 4), storing this.toolInstructions[projectKey]. Fail-safe per
   * §5.8: a member whose detectTools.kind !== 'cli' or whose build fails/times out
   * degrades to '' (source-reading) WITHOUT aborting the others. Skipped wholesale
   * in mock mode (keeps `npm run smoke` offline + deterministic), matching the
   * single-project _buildWorktreeGraph mock guard.
   */
  async _buildWorktreeGraphAll() {
    if (this.claude.mock) return; // mock runs never use the graph (intentionally silent)
    const dirs = this.members.map((m) => resolve(m.projectDir));
    const toolsByDir = await detectToolsPerProject(dirs); // never throws
    await mapWithCap(this.members, 4, async (m) => {
      const workDir = this.workDirs.get(m.projectKey);
      const info = toolsByDir.get(resolve(m.projectDir));
      if (!workDir || workDir === resolve(m.projectDir)) {
        this.toolInstructions.set(m.projectKey, '');
        return;
      }
      if (info?.kind !== 'cli') {
        this.toolInstructions.set(m.projectKey, '');
        this._log('graph', 'info', `graphify CLI not on PATH for ${m.projectKey}; skipping graph build`);
        return;
      }
      const res = await runGraphifyUpdate({ dir: workDir, cwd: workDir, timeoutMs: this.graphBuildTimeoutMs });
      if (res.ok) {
        this.toolInstructions.set(m.projectKey, worktreeGraphInstruction());
        this._log('graph', 'info', `graphify graph built in ${m.projectKey} worktree.`);
        await appendAudit(this.pipeline.dir, `Preflight: built graphify graph for ${m.projectKey} (AST-only).`).catch(() => {});
      } else {
        this.toolInstructions.set(m.projectKey, '');
        this._log('graph', 'warn', `graphify build for ${m.projectKey} ${res.timedOut ? 'timed out' : 'failed'}; degrading to source-reading`);
      }
    });
  }

  /**
   * Tear down the per-pipeline worktree (C1). Retention policy:
   *   - ALWAYS remove the checkout dir and KEEP the feature branch — done, error,
   *     or stopped alike. The branch carries every change made up to the stop/error
   *     point so the user can recover or merge the agent's work; the worktree is
   *     just the disposable checkout.
   * Always force:true — agents have edited files, so the non-force path would
   * refuse and leak. Idempotent; safe to call when setup never ran.
   */
  async _teardownWorktree() {
    const info = this.branchInfo;
    if (!info || !info.worktreeDir) return;
    this.branchInfo = null; // guard against a double teardown
    // Commit the agent's work onto the feature branch BEFORE removal. Without
    // this, removeWorktree(force:true) discards the working tree and the kept
    // branch carries no changes (the staging in _stageWorkingTree is intent-to-add
    // for the reviewer's diff only — it never creates a commit). On error/stop this
    // is what captures the partial work made up to that point.
    await this._commitWork(info).catch(() => {});
    // branch:null — the branch is always kept (done/error/stopped alike); only the
    // disposable checkout is removed.
    const res = await removeWorktree({
      projectDir: this.projectDir,
      worktreeDir: info.worktreeDir,
      branch: null,
      force: true,
    });
    for (const s of res.steps.filter((x) => !x.ok)) {
      this._log('worktree', 'warn', `teardown ${s.step} failed: ${s.stderr || 'unknown error'}`);
    }
    if (this.pipeline) {
      await appendAudit(
        this.pipeline.dir,
        `Worktree removed at \`${info.worktreeDir}\` (kept branch \`${info.branch}\`).`,
      ).catch(() => {});
    }
    // Reflect the post-teardown reality in state for any late observer.
    if (this.state.branch) {
      this.state.branch.worktreeRemoved = true;
      this.state.branch.branchKept = true;
    }
    this.workDir = this.projectDir;
  }

  /**
   * Workspace teardown (C1, N times): per member, commit its work onto its feature
   * branch (in its own repo), remove its checkout, and KEEP the branch — done,
   * error, or stopped alike. Each member's SHA + survival flags are recorded on
   * state.branches[projectKey]. Idempotent (guards against a double teardown by
   * clearing branchInfos); best-effort (never throws). Iterated serially so the
   * teardown commits don't contend on interleaved git index locks across repos.
   */
  async _teardownWorktreeAll() {
    if (this.branchInfos.size === 0) return;
    const entries = [...this.branchInfos.entries()]; // [projectKey, info]
    this.branchInfos = new Map(); // guard against a double teardown
    for (const [projectKey_, info] of entries) {
      if (!info || !info.worktreeDir) continue;
      const branchRecord = (this.state.branches && this.state.branches[projectKey_]) || null;
      await this._commitWork(info, branchRecord).catch(() => {});
      const res = await removeWorktree({
        projectDir: resolve(this.memberByKey.get(projectKey_)?.projectDir || this.projectDir),
        worktreeDir: info.worktreeDir,
        branch: null, // always keep the branch
        force: true,
      });
      for (const s of res.steps.filter((x) => !x.ok)) {
        this._log('worktree', 'warn', `teardown ${projectKey_} ${s.step} failed: ${s.stderr || 'unknown error'}`);
      }
      if (this.pipeline) {
        await appendAudit(
          this.pipeline.dir,
          `Worktree \`${projectKey_}\` removed at \`${info.worktreeDir}\` (kept branch \`${info.branch}\`).`,
        ).catch(() => {});
      }
      if (branchRecord) {
        branchRecord.worktreeRemoved = true;
        branchRecord.branchKept = true;
      }
      this.workDirs.delete(projectKey_);
    }
    // Keep the scalar mirror coherent for late observers.
    if (this.state.branch) {
      this.state.branch.worktreeRemoved = true;
      this.state.branch.branchKept = true;
    }
    this.branchInfo = null;
    this.workDir = this.projectDir;
    await this._persist().catch(() => {});
  }

  /**
   * The ONLY owner of normal-path teardown, wired into BOTH terminal `finally`
   * blocks (run()'s and resume()'s — the latter is an identical bare per-member
   * teardown today, so wiring only run()'s would keep legacy teardown on every
   * detached run finishing after a resume, i.e. every crash-interrupted run).
   * Still skipped entirely when the run paused (§8.13) — the caller guards.
   *
   * Under `legacy` this delegates to today's _teardownWorktree / _teardownWorktreeAll
   * verbatim and does nothing else. Under `detached`, per member, in NORMATIVE order:
   *   1. modified-mount rescue (§8.20) — read-only, so it survives any later failure
   *   2. strip every claudeMdSection fenced block (must precede the commit — that
   *      file is deliberately NOT in the exclusion pathspecs)
   *   3. _commitWork with the §8.8 exclusion set (+ status recheck, hook retry)
   *   4. remove this worktree's remaining injected paths
   *   5. removeWorktree(force:true) — the branch is ALWAYS kept
   * then, at the run-root level: (6) the same rescue for run-root mounts, (7) the
   * §8.11 stray scan, (8) the run.json durability copy, (9) guarded rm -rf (§8.13).
   */
  async _teardownRunRoot() {
    if (this.runRootMode !== 'detached') {
      if (this.isWorkspace) await this._teardownWorktreeAll();
      else await this._teardownWorktree();
      return;
    }
    const pipelineDir = this.pipeline?.dir || null;
    const entries = [...this.branchInfos.entries()];   // [projectKey, info]
    this.branchInfos = new Map();                      // guard against a double teardown
    for (const [key, info] of entries) {
      if (!info || !info.worktreeDir) continue;
      const wt = info.worktreeDir;
      const injected = this.injectedPaths?.[key] ?? [];
      // (1) rescue FIRST — read-only, so a later step failing cannot lose the edit.
      const rescued = await rescueModifiedMounts({
        baseDir: wt, entries: injected, pipelineDir, scope: key, pipelineId: this.pipeline?.id,
      });
      for (const w of rescued) await this._recordRunWarning(w);
      // (2) strip the worca-cc-managed CLAUDE.md fence BEFORE the commit.
      for (const e of injected) {
        if (e?.kind !== 'claudeMdSection' || !e.path) continue;
        try {
          const file = join(wt, e.path);
          const before = await readFile(file, 'utf8');
          const after = stripClaudeMdFence(before, this.pipeline?.id);
          if (after !== before) await writeFile(file, after, 'utf8');
        } catch { /* best-effort: a missing file needs no strip */ }
      }
      // (3) commit onto the kept branch, excluding every injected path.
      const branchRecord = (this.state.branches && this.state.branches[key]) || null;
      await this._commitWork(info, branchRecord, { excludePathspecs: this._excludePathspecs(key) })
        .catch(() => {});
      // (4) remove what worca-cc injected, so nothing can be committed dangling or
      // outlive the run root.
      await removeInjectedPaths(wt, injected);
      // (5) remove the checkout; the branch is always kept.
      const res = await removeWorktree({
        projectDir: resolve(this.memberByKey.get(key)?.projectDir || this.projectDir),
        worktreeDir: wt,
        branch: null,
        force: true,
      });
      for (const s of res.steps.filter((x) => !x.ok)) {
        this._log('worktree', 'warn', `teardown ${key} ${s.step} failed: ${s.stderr || 'unknown error'}`);
      }
      if (this.pipeline) {
        await appendAudit(
          this.pipeline.dir,
          `Worktree \`${key}\` removed at \`${wt}\` (kept branch \`${info.branch}\`).`,
        ).catch(() => {});
      }
      if (branchRecord) {
        branchRecord.worktreeRemoved = true;
        branchRecord.branchKept = true;
      }
      this.workDirs.delete(key);
    }
    // Keep the scalar mirror coherent for late observers.
    if (this.state.branch) {
      this.state.branch.worktreeRemoved = true;
      this.state.branch.branchKept = true;
    }
    this.branchInfo = null;
    this.workDir = this.projectDir;

    if (this.runRoot) {
      // (6) run-root mounts (the workspace skill mount) — `.claude/` is whitelisted
      // by the §8.11 known set, so only this rescue can catch edits inside it.
      const rootRescued = await rescueModifiedMounts({
        baseDir: this.runRoot, entries: this.injectedPaths?.runRoot ?? [], pipelineDir,
        scope: 'runRoot', pipelineId: this.pipeline?.id,
      });
      for (const w of rootRescued) await this._recordRunWarning(w);
      // (7) §8.11 stray scan — nothing outside the known set is silently lost.
      const strays = await scanStrayEntries({ runRoot: this.runRoot, pipelineDir });
      for (const w of strays) await this._recordRunWarning(w);
      // (8) §5.2 durable ledger: the run root is about to disappear.
      await copyRunManifestTo(this.runRoot, pipelineDir);
      // (9) guarded removal (§8.13).
      const removal = await rmGuarded(this.runRoot, {
        worcaHome: worcaHome(), pipelineId: this.pipeline?.id,
      });
      if (removal.removed) {
        this._log('worktree', 'info', `Run root removed at ${this.runRoot}.`);
      } else {
        this._log('worktree', 'warn', `run root NOT removed: ${removal.reason}`);
      }
    }
    await this._persist().catch(() => {});
  }

  /**
   * Append a warning to BOTH durable sinks (§5.2's ledger rules): the run log (which
   * survives teardown inside the pipeline artifact dir) and `run.json.warnings` (the
   * live manifest, copied out before removal). Never throws.
   */
  async _recordRunWarning(text) {
    this._log('worktree', 'warn', text);
    // Also surface it in state: the run monitor reads warnings off the snapshot,
    // and a legacy run (no run root) has no run.json to fall back on.
    if (!Array.isArray(this.state.warnings)) this.state.warnings = [];
    if (!this.state.warnings.includes(text)) this.state.warnings.push(text);
    if (!this.runRoot) return;
    try {
      const cur = (await readRunManifest(this.runRoot)) || {};
      const warnings = Array.isArray(cur.warnings) ? cur.warnings : [];
      await updateRunManifest(this.runRoot, { warnings: [...warnings, text] });
    } catch { /* best-effort */ }
  }

  /**
   * Commit every change in the worktree onto the feature branch so the kept
   * branch actually carries the agent's work after the worktree is removed.
   * Best-effort: never throws; logs and returns null on any failure. Skips
   * cleanly when the working tree is clean (no diff from the checkpoint), which
   * is the truthful "no change needed" outcome. Records the SHA on state.branch.
   * @param {{worktreeDir:string, branch:string}} info the branch being kept
   * @param {object} [branchRecord] the state branch object to stamp .commit onto
   *   (defaults to the scalar this.state.branch; a workspace member passes its own
   *   state.branches[projectKey] so per-member SHAs are recorded distinctly).
   * @param {{excludePathspecs?:string[]}} [opts] §8.8 exclusion set for this
   *   worktree. With the DEFAULT empty array — every legacy run — the method keeps
   *   today's bare `git add -A` byte-identically (§10 rollback contract).
   * @returns {Promise<string|null>} the new commit SHA, or null when nothing committed.
   */
  async _commitWork(info, branchRecord = this.state.branch, { excludePathspecs = [] } = {}) {
    const cwd = info?.worktreeDir;
    if (!cwd) return null;
    // ignoreAbort on every call: teardown runs after stop/error has aborted the
    // signal, so binding it would no-op these commands and lose the partial work.
    const gitOpts = { cwd, ignoreAbort: true };
    const status = await this._git(['status', '--porcelain'], gitOpts);
    if (!status.ok) {
      this._log('git', 'warn', `commit skipped: git status failed: ${status.stderr.trim()}`);
      return null;
    }
    if (!status.stdout.trim()) {
      this._log('git', 'info', 'No changes to commit (working tree clean).');
      return null;
    }
    const add = excludePathspecs.length
      ? await this._git(['add', '-A', '--', '.', ...excludePathspecs], gitOpts)
      : await this._git(['add', '-A'], gitOpts);
    if (!add.ok) {
      this._log('git', 'warn', `commit skipped: git add failed: ${add.stderr.trim()}`);
      return null;
    }
    // §8.8 status recheck: with mounts present the porcelain gate above is never
    // clean, so a run whose agent changed nothing would attempt a commit that fails
    // with "nothing to commit". Re-check what actually got staged.
    if (excludePathspecs.length) {
      const staged = await this._git(['diff', '--cached', '--quiet'], gitOpts);
      if (staged.ok) {   // exit 0 => nothing staged
        this._log('git', 'info', 'No changes to commit (working tree clean).');
        return null;
      }
    }
    const title = this.state.title || this.baseName || 'changes';
    const msg = `worca: ${title}${this.pipeline ? `\n\nPipeline ${this.pipeline.id}` : ''}`;
    // Plain commit first (uses the repo's configured identity); fall back to a
    // local identity so a repo with no user.name/email still commits — mirrors
    // _ensureGitCheckpoint's belt-and-braces.
    let commit = await this._git(['commit', '-m', msg], gitOpts);
    if (!commit.ok) {
      commit = await this._git(
        ['-c', 'user.email=orchestrator@local', '-c', 'user.name=orchestrator', 'commit', '-m', msg],
        gitOpts,
      );
    }
    if (!commit.ok && excludePathspecs.length) {
      // §8.8 (detached runs — the same scope as the exclusion set): a failing hook
      // must never silently delete an agent's work. Teardown removeWorktree(force:true)s
      // the checkout right after this returns, and on the error path _buildResults is
      // skipped, so not even a diff artifact survives. Detached worktrees make hook
      // failure MORE likely (§8.1: husky/lint-staged resolve through an ancestor
      // node_modules today and do not detached). Retry ONCE with hooks disabled for
      // that invocation only, logging both facts.
      const hookErr = commit.stderr.trim() || `exit ${commit.code}`;
      this._log('git', 'warn', `commit failed with hooks enabled: ${hookErr}`);
      const retry = await this._git(
        ['-c', 'core.hooksPath=', '-c', 'user.email=orchestrator@local', '-c', 'user.name=orchestrator',
         'commit', '-m', msg],
        gitOpts,
      );
      if (retry.ok) {
        this._log('git', 'warn', 'retried the commit with hooks BYPASSED (core.hooksPath=) so the agent work is not lost');
        await this._recordRunWarning(
          `commit hooks failed (${hookErr}); retried with hooks bypassed so the work was not lost.`,
        );
        commit = retry;
      }
    }
    if (!commit.ok) {
      this._log('git', 'warn', `commit failed: ${commit.stderr.trim() || `exit ${commit.code}`}`);
      return null;
    }
    const ref = await this._git(['rev-parse', 'HEAD'], gitOpts);
    const sha = ref.ok ? ref.stdout.trim() : null;
    if (branchRecord) branchRecord.commit = sha;
    if (sha && this.pipeline) {
      await appendAudit(
        this.pipeline.dir,
        `Committed agent work to \`${info.branch}\` at \`${sha.slice(0, 10)}\`.`,
      ).catch(() => {});
    }
    return sha;
  }

  // ── phase helpers ─────────────────────────────────────────────────────────────

  // ── data-driven dispatcher ─────────────────────────────────────────────────

  /**
   * §9.4 preflight gate: every workflow node key must resolve in the MERGED
   * registry (builtin+user+plugin) BEFORE any node executes. This deliberately
   * supersedes the silent empty-prompt degradation for ALL origins (it was a
   * bug, not a feature) — resolveWorkflow keeps `reg[key] || {}` for library
   * callers; runs are gated HERE, covering run() and resume(). The thrown plain
   * Error lands in the caller's catch => status 'error' + message; the
   * recoverable-error gate surfaces it cleanly.
   * @param {object} plan resolveWorkflow() output (or a frozen resume plan)
   */
  _preflightAgentKeys(resolved) {
    const reg = this.registry || {};
    const missing = [];
    const seen = new Set();
    for (const node of resolved?.template?.nodes || []) {
      if (node?.kind !== 'agent') continue;
      const key = node.key;
      if (!key || seen.has(key) || Object.hasOwn(reg, key)) continue;
      seen.add(key);
      const plugin = findDisabledPluginFor(key);
      missing.push(plugin
        ? `agent "${key}" comes from disabled plugin "${plugin}" — enable it`
        : `agent "${key}" is not installed (removed plugin?)`);
    }
    if (missing.length) {
      throw new Error(
        `Preflight failed: ${missing.length} workflow agent key(s) do not resolve:\n` +
        missing.map((m) => `  - ${m}`).join('\n'),
      );
    }
  }
  // ── the graph engine ───────────────────────────────────────────────────────

  /**
   * Adopt a resolveGraph result. Workspace fan-out forcing lives HERE and is the
   * ONLY in-orchestrator topology change a workspace run makes: an agent whose
   * sidecar declares `workspaceFanOut` gets `fanOut = true`, which unlocks the
   * Task/Agent tool downstream. It is a META flag, not a key set — the v1
   * FANOUT_ELIGIBLE list died with the dispatcher.
   */
  _adoptResolvedGraph(resolved) {
    this.resolved = resolved;
    if (!this.isWorkspace) return;
    for (const node of resolved.template.nodes || []) {
      const ctx = resolved.nodeCtx[node.id];
      if (ctx?.kind === 'agent' && ctx.meta?.workspaceFanOut) {
        ctx.fanOut = true;
        node.fanOut = true;      // ctxFanOut reads the node first
      }
    }
  }

  /**
   * Hard run-time gate on the resolved graph, applied BEFORE any spawn:
   * validateGraph's E-rules. A saved template goes invalid the moment an agent's
   * ports change under it (a renamed port, a deleted End), and the scheduler
   * would otherwise bind nothing and go quiet. Aborting names the rule so the
   * composer can be pointed straight at it.
   *
   * (The temporary wired-`expands` refusal that used to live here is gone: the
   * scheduler's composite driver runs the fan-out, so the three seeds that wire a
   * decomposer are ordinary runnable graphs again.)
   */
  _assertRunnableGraph(resolved) {
    const { template, ports } = resolved;
    const { errors } = validateGraph(template, ports);
    if (errors.length) {
      const detail = errors.map((e) => `  - [${e.code}] ${e.msg}`).join('\n');
      throw new Error(
        `workflow "${template.id}" is not runnable — ${errors.length} validation error(s):\n${detail}`,
      );
    }
  }

  /** The shape collectRequiredSkills expects, projected off the resolved graph. */
  _skillPlan(resolved) {
    return {
      steps: [(resolved.template.nodes || [])
        .filter((n) => n.kind === 'agent')
        .map((n) => ({ key: n.key }))],
    };
  }

  /**
   * Run the resolved graph to completion.
   *
   * The scheduler owns readiness, loop budgets, gates and End; this method owns
   * the process side: the pre-rendered task document, the executor binding, the
   * event fan-out and the resume-v2 snapshot. Returns 'done' | 'paused'; a genuine
   * execution failure is re-thrown VERBATIM (AbortError/pause identity intact) so
   * run()'s catch classifies it exactly as it did under the dispatcher.
   *
   * @param {object|null} snapshot a resume-v2 scheduler snapshot to restore from
   * @returns {Promise<'done'|'paused'>}
   */
  async _runGraph(snapshot = null) {
    const { template, ports } = this.resolved;
    this.extrasFiles = await this._collectExtras();
    // The task document is pre-rendered ONCE, here: the task card publishes it and
    // every entry agent binds that same file.
    const taskArtifact = {
      path: null,
      promptText: this.pipeline.promptText,
      extras: this.extrasFiles,
    };

    const sched = createScheduler({
      template,
      portsFn: ports,
      execute: (args) => this._execute(args),
      taskArtifact,
      onEvent: (name, payload) => this._onSchedulerEvent(name, payload),
      ask: (q) => this._gateAsk(q),
      onSnapshot: (s) => {
        // Freeze at the last CLEAN completion once a pause is requested: the
        // executions this pause kills must stay non-terminal in the persisted
        // point so the scheduler re-invokes them on resume.
        if (!this.pauseRequested) this._graphSnapshot = s;
      },
      maxParallel: MAX_PARALLEL,
      snapshot,
    });
    this._scheduler = sched;
    if (snapshot) this._graphSnapshot = snapshot;

    let outcome;
    try {
      outcome = await sched.run();
    } finally {
      this.state.active = [];
    }

    const final = sched.getState();
    this.state.result = final.ended ? final.ended.result : null;
    this.state.endReached = !!final.ended;

    if (outcome === 'error') {
      throw this._graphError || new Error('a graph execution failed');
    }
    if (outcome === 'paused' || this.pauseRequested) {
      this.state.resumePoint = this._buildResumePoint(this._graphSnapshot);
      return 'paused';
    }
    // Amendment f (1): 'done' with no End means the graph drained and went quiet.
    // That is a legitimate completion, but the run monitor has to say so.
    if (!final.ended) {
      await this._recordRunWarning(QUIESCENCE_WARNING);
    }
    return 'done';
  }

  /**
   * Serialize the run position into a JSON-safe resume-v2 point. The scheduler
   * snapshot IS the position; everything else here is the run identity the fresh
   * instance cannot rebuild from the row alone.
   */
  _buildResumePoint(snapshot) {
    return {
      version: 2,
      snapshot: snapshot ? jsonClone(snapshot) : null,
      // Observability + the resume audit line; the authoritative session map is
      // rebuilt from the persisted step rows.
      nodes: (snapshot?.execs || []).map((e) => ({
        nodeId: e.nodeId,
        executionId: e.executionId,
        sessionId: e.sessionId || null,
        completed: e.status === 'done',
      })),
      planVersion: this._planVersion,
      stepModels: this.stepModels,
      workflowId: this.workflowId,
      guardrailsId: this.guardrailsId,
      checkpointRef: this.checkpointRef || null,
      checkpointRefs: { ...this.checkpointRefs },
      workspace: this.isWorkspace ? this._workspaceCtx() : null,
      pauseReason: this.pauseReason || null,
      // The EFFECTIVE instruction at dispatch time (post in-worktree graph build),
      // not the detect-time tools.instruction — resume() restores it verbatim.
      toolInstruction: this.toolInstruction ?? '',
      pipelineDir: this.pipeline.dir,
      pausedAt: new Date().toISOString(),
    };
  }

  /**
   * Fan the scheduler's three events out onto the orchestrator's event surface.
   * `exec` replaces v1's `phase` (an execution, not a step) and `token` is new;
   * `gate` is folded into the audit trail — the human-facing half is the
   * `question` the ask plumbing already emits.
   */
  _onSchedulerEvent(name, payload) {
    if (name === 'token') {
      this._emit('token', payload);
      return;
    }
    if (name === 'gate') {
      if (payload.status !== 'held' && this.pipeline) {
        appendAudit(
          this.pipeline.dir,
          `Loop gate on wire ${payload.wireId} (${payload.nodeId}): user chose **${payload.status}**.`,
        ).catch(() => {});
      }
      return;
    }
    if (name !== 'exec') return;
    const step = this.state.steps.find((s) => s.key === payload.executionId);
    this.state.active = this._scheduler ? this._scheduler.getState().active : [];
    // The bound End payload is exec-only, and the step row IS the durable exec
    // ledger — without this, History has no result to anchor the End card on.
    if (step && payload.result !== undefined) step.result = payload.result;
    // End arrival withdraws every pending gate in the scheduler; the QUEUED
    // question is the orchestrator's to dismiss, or the run would block on an
    // answer nobody can give any more.
    if (payload.status === 'done' && payload.result !== undefined) {
      this.state.result = payload.result;
      this.state.endReached = true;
      this._dismissPendingAsk();
    }
    this._emit('exec', { ...payload, costUsd: step ? (step.costUsd || 0) : 0 });
  }

  /**
   * The scheduler's loop-budget gate. Returns the scheduler's own vocabulary
   * ('another' | 'continue') and rides the SAME serialized ask queue as recovery
   * prompts and node questions, so only one prompt is ever open.
   */
  async _gateAsk({ wireId, issues }) {
    const payload = await this._enqueueAsk(() => this._ask({
      id: `gate-${wireId}`,
      kind: 'gate',
      wireId,
      issues,
    }));
    return payload?.decision === 'another' ? 'another' : 'continue';
  }

  /**
   * Resolve the queued question, if any, without an answer. Used on End arrival:
   * a gate ask resolves to `continue` (a no-op — the scheduler already withdrew
   * it), and a clarify/questions ask resolves to EMPTY answers, which the
   * clarifier's existing malformed/empty tolerance turns into a normal publish.
   */
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
   * The scheduler's `execute`. Selection is `node.kind`, then `meta.runnerType`
   * for agents — never an agent key. Flow cards are instant, $0 and spawn nothing;
   * agent cards go through the full attempt/recovery/questions machinery, all of
   * it re-keyed by executionId.
   */
  async _execute(args) {
    const node = args.node;
    const nc = (this.resolved.nodeCtx || {})[node.id] || { kind: node.kind, key: null };
    // The composite protocol (scheduler.mjs header). These three modes are the
    // process side of a fan-out — they spawn nothing, record no step row and
    // allocate nothing, so a composite shell never burns a plan version.
    if (args.composite === 'expand') return await this._expandDecomposition(node, args);
    if (args.composite === 'phase') return this._compositePhase(args);
    if (args.composite === 'finish') return await this._finishComposite(nc, args);
    const ctx = this._execCtx(node, nc, args);
    this._execStep(ctx, 'start');
    if (ctx.slice) updateTaskStatus(this.pipeline.id, ctx.slice.id, 'running', new Date().toISOString());
    let endMark = 'done';
    try {
      if (node.kind !== 'agent') return await this._runFlow(node, ctx, args);
      this._checkCostLimits();                   // budget gate at every agent launch
      this._primeQuestions(nc, ctx);
      let result = await this._runNodeAttempts(nc, ctx);
      result = await this._questionsLoop(nc, ctx, result);
      await this._afterExecution(nc, ctx, result);
      return result;
    } catch (err) {
      if (isPause(err) || (this.pauseRequested && (isAbort(err) || this.pauseAbort.signal.aborted))) {
        // Settle QUIETLY: the persisted snapshot was frozen the moment pause() was
        // requested, so nothing this publishes can reach it, and the scheduler is
        // already halted — no downstream node can fire off it either.
        endMark = 'paused';
        return { outputs: {} };
      }
      endMark = 'error';
      this._graphError ||= err;                  // preserve identity for run()'s catch
      throw err;
    } finally {
      this._execStep(ctx, endMark);
      // A PAUSED slice stays 'running': the resume re-runs the whole composite,
      // and a task that never finished must not read as done.
      if (ctx.slice && endMark !== 'paused') {
        updateTaskStatus(this.pipeline.id, ctx.slice.id, endMark, new Date().toISOString());
      }
    }
  }

  /**
   * Composite mode `expand`: read the decomposition the bound token points at,
   * through the tolerant parse, and persist the phases + tasks BEFORE any slice
   * runs — so the records exist even if the fan-out aborts mid-phase (v1
   * `_persistDecomposition`, recreated generically). Each task row is stamped
   * with the sub-EXECUTION id that will run it; the v1 synthetic `s_impl_p*_t*`
   * node ids do not return.
   *
   * An empty or malformed document is not an error: it warns and hands back zero
   * phases, which the scheduler turns into one ordinary unexpanded execution.
   */
  async _expandDecomposition(node, args) {
    const token = (args.bindings || {})[args.expandsPort];
    const { phases } = await readDecomposition(token?.path);
    const label = node.id;
    if (!phases.length) {
      this._log(label, 'warn',
        `no runnable phases in the decomposition bound to "${args.expandsPort}"`
        + `${token?.path ? ` (${token.path})` : ''} — running one normal execution instead`);
      await appendAudit(this.pipeline.dir,
        `${label}: the decomposition on \`${args.expandsPort}\` carried no runnable phases — `
        + 'running one normal execution with that input unbound.').catch(() => {});
      return { phases: [] };
    }
    const resolved = phases.map((ph) => ({
      ordinal: ph.ordinal,
      tasks: ph.tasks.map((t) => ({
        ...t,
        nodeId: sliceExecutionId(args.executionId, t.id),
        path: isAbsolute(t.file) ? t.file : join(this.pipeline.dir, t.file),
      })),
    }));
    writeDecomposition(this.pipeline.id, resolved);
    const count = resolved.reduce((n, ph) => n + ph.tasks.length, 0);
    await appendAudit(this.pipeline.dir,
      `${label}: expanded into ${resolved.length} phase(s), ${count} task(s).`).catch(() => {});
    return { phases: resolved };
  }

  /** Composite mode `phase`: the per-phase status plumbing, plus its audit line. */
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
   * artifact (each slice wrote its own, under its own slice-prefixed paths), so
   * the node's ports fire as pure sequencing tokens. For a void output — the live
   * case, `implementer.done` — that is byte-identical to an ordinary execution.
   */
  async _finishComposite(nc, args) {
    if (nc.meta?.sideEffect === 'code') await this._stageWorkingTree();
    const label = nc.meta?.displayName || nc.key || args.node.id;
    return {
      summary: `${label}: composite execution complete (${args.phases.length} phase(s)).`,
      outputs: {},
      verdict: null,
    };
  }

  /** The five flow cards. Engine-owned: instant, $0, no semaphore slot, no spawn. */
  async _runFlow(node, ctx, args) {
    const exec = FLOW_EXECUTORS[node.kind];
    if (typeof exec !== 'function') throw new Error(`no executor for node kind "${node.kind}"`);
    return await exec({
      ...args,
      runCtx: ctx.runCtx,
      allocatedPath: ctx.outputs?.out?.path,
      names: this._flowNames(node),
    });
  }

  /** Port id -> the source node's display name, for the combine card's headings. */
  _flowNames(node) {
    const names = {};
    for (const wire of this.resolved.template.wires || []) {
      if (wire?.to?.node !== node.id) continue;
      const src = (this.resolved.nodeCtx || {})[wire.from.node] || {};
      const label = src.meta?.displayName || src.key || wire.from.node;
      names[wire.to.port] = label;
    }
    return names;
  }

  /**
   * The per-execution context. This is the ONE ctx: it carries the phases.mjs
   * prompt fields (cwd, workspace, toolInstruction, agentPrompts, claudeOpts) AND
   * the graph fields the executors read (ports, meta, bindings, trigger, the
   * allocated outputs/verdict). Allocation happens HERE, once per execution, so a
   * questions resume or a recovery retry never burns a second plan version.
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
      // and verdict are additionally slice-prefixed (executor's dupPrefix).
      slice: slice ? slice.id : undefined,
      planVersion: () => (this._planVersion += 1),
    };
    const outputs = allocateOutputs({ node, ports, executionId, ordinal, runCtx });
    const verdict = allocateVerdict({ node, ports, ordinal, runCtx });
    const attr = {
      nodeId: node.id,
      executionId,
      stepKey: executionId,
      cycle: ordinal,
      uiPhase: nc.key || node.kind,
    };
    return {
      // The field name is kept to bound blast radius — it is consumed as `cwd`
      // at phases.mjs. runCwd is the run root on a detached workspace run, the
      // member worktree on a detached single run, and today's workDir under legacy.
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
      workspace: this.isWorkspace ? this._workspaceCtx() : undefined,
      // A composite slice ALSO honors the scheduler's signal, which folds in its
      // phase-local controller: a sibling's failure cancels it (v1's third
      // signal). Only slices do — an ordinary execution keeps today's two, so the
      // fail-fast blast radius is unchanged.
      signal: slice && args.signal
        ? AbortSignal.any([this.abort.signal, this.pauseAbort.signal, args.signal])
        : AbortSignal.any([this.abort.signal, this.pauseAbort.signal]),
      extras: this.extrasFiles || [],
      // ── graph ──
      node: { ...node, fanOut: nc.fanOut, agentPrompt: nc.agentPrompt },
      nodeId: node.id,
      executionId,
      ordinal,
      cycle: ordinal,
      slice,
      uiPhase: attr.uiPhase,
      bindings: args.bindings || {},
      trigger: args.trigger || {},
      template: this.resolved.template,
      portsFn: this.resolved.ports,
      ports,
      meta: nc.meta || ports,
      outputs,
      verdict,
      runCtx,
      resumeSessionId: this._resumeSessions?.get(executionId),
      ask: (q) => this._enqueueAsk(() => this._ask(q)),
      onEvent: (e) => this._onAgentEvent(nc.key || node.kind, e, attr),
      claudeOpts: {
        bin: this.claude.bin,
        permissionMode: this.claude.permissionMode,
        model: nc.model || this.claude.model, // per-node, falling back to global
        effort: nc.effort,                    // per-node effort (undefined when unset)
        permissionRules: this.guardrailPermissionRules || undefined,
        envScrub: this.guardrails?.envScrub || undefined,
        envAllowlist: this.guardrails?.envScrub ? this.guardrails.envAllowlist : undefined,
        mock: this.claude.mock,
      },
    };
  }

  /**
   * Everything that must happen between an agent returning and the scheduler
   * publishing its tokens:
   *  - the verdict lands in the AUTHORITATIVE reviews table, keyed by the generic
   *    filename-derived kind;
   *  - one `artifact` per DISTINCT allocated output path (the refiner's plan and
   *    revise ports resolve to the same file, and that is one artifact, not two);
   *  - a `sideEffect: 'code'` node stages its working tree, so the next node's
   *    `git diff` sees newly created files. A composite SLICE skips that: its
   *    phase-mates are editing the same tree in parallel, and the composite
   *    stages once after the last phase (`_finishComposite`).
   */
  async _afterExecution(nc, ctx, result) {
    if (this.pipeline && ctx.verdict?.path && result?.verdict) {
      await writeReview(
        this.pipeline.id, verdictKindOf(nc.meta, nc.key), ctx.ordinal, result.verdict,
      );
    }
    const seen = new Set();
    for (const port of ctx.ports?.outputs || []) {
      const path = ctx.outputs?.[port?.id]?.path;
      if (!path || seen.has(path)) continue;
      seen.add(path);
      this._artifact(port.artifactKind || port.id, path, {
        nodeId: ctx.nodeId, executionId: ctx.executionId, port: port.id,
      });
    }
    if (nc.meta?.sideEffect === 'code' && !ctx.slice) await this._stageWorkingTree();
  }

  /** The recoverable-error retry loop around one execution. The pause paths throw
   *  pauseErr() with pauseRequested already set (_pauseForLimit calls this.pause()),
   *  so _execute's catch reproduces the 'paused' mark. */
  async _runNodeAttempts(nc, ctx) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this._runOnce(nc, ctx);
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
          // pauseErr() unwinds this execution as a pause.
          this._pauseForLimit(nc, err);
          throw pauseErr();
        }
        const decision = await this._recover({ nc, cls, err, attempt });
        if (decision === 'abort') throw err;    // user/auto gave up -> fail as today
        this._execStep(ctx, 'start');           // back to running for the retry
      }
    }
  }

  /** One invocation of this node's executor, with the session-resume fallback. */
  async _runOnce(nc, ctx) {
    const runner = this._executorFor(nc, ctx.node);
    try {
      return await runner(ctx);
    } catch (err) {
      if (ctx.resumeSessionId && !isAbort(err) && !isPause(err) && !this.pauseRequested) {
        this._log(nc.key || ctx.nodeId, 'warn', `session resume failed (${err?.message || err}); re-running fresh`);
        await appendAudit(this.pipeline.dir, `Resume fallback: ${ctx.executionId} re-ran fresh (session resume failed).`).catch(() => {});
        ctx.resumeSessionId = undefined;
        return await runner(ctx);
      }
      throw err;
    }
  }

  /** Executor selection: `node.kind` then `meta.runnerType`. An injected
   *  `opts.runners[runnerType]` wins, which is the tests' only seam. */
  _executorFor(nc, node) {
    if (node.kind !== 'agent') return FLOW_EXECUTORS[node.kind];
    const type = nc.runnerType || 'producer';
    return this._runners[type] || AGENT_EXECUTORS[type] || runAgentExecution;
  }

  /**
   * Prime the ask-then-resume state for this execution. The prior-answer filter
   * stays NODE-scoped: keying it by executionId would re-ask every answered
   * question on the next fix cycle, because that cycle is a new execution.
   *
   * Composite slices never gate the user (the v1 per-task node forced askQuestions:
   * false`): several of them run at once, so a question from one would block its
   * phase-mates behind a prompt nobody can attribute.
   */
  _primeQuestions(nc, ctx) {
    const enabled = !!nc.askQuestions && nc.runnerType !== 'clarifier' && !this.auto && !ctx.slice;
    ctx.questionsEnabled = enabled;
    if (!enabled) return;
    ctx.questionsAnswered = readStepQuestions(this.pipeline.id)
      .filter((r) => r.nodeId === ctx.nodeId)
      .flatMap((r) => r.answers);
    ctx.questionsFile = this._questionsPath(ctx.executionId, 1);
  }

  /** This round's questions file, named by the execution that asks. */
  _questionsPath(executionId, round) {
    const safe = String(executionId).replace(/[^A-Za-z0-9_-]/g, '_');
    return join(this.pipeline.dir, `questions-${safe}-r${round}.json`);
  }

  /** The ask-then-resume loop: read the questions file, gate the user, re-run. */
  async _questionsLoop(nc, ctx, firstResult) {
    let result = firstResult;
    if (!ctx.questionsEnabled) return result;
    const stepKey = ctx.executionId;
    const agentLabel = nc.meta?.displayName || nc.key || ctx.nodeId;
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
      this._artifact('questions', qPath, { nodeId: ctx.nodeId, executionId: ctx.executionId, port: null });
      await appendAudit(this.pipeline.dir, `${agentLabel} asked ${questions.length} question(s) (round ${round}).`).catch(() => {});
      const payload = await this._enqueueAsk(() => this._ask({
        id: `questions-${stepKey}-r${round}`,
        kind: 'questions',
        questions,
        agent: agentLabel,
        nodeId: ctx.nodeId,
      }));
      this._checkAbort();
      const answers = normalizeClarifyAnswer(payload, questions);
      const byId = new Map(questions.map((q) => [q.id, q]));
      const enriched = answers.map((a) => ({ id: a.id, question: byId.get(a.id)?.question || '', choice: a.choice }));
      await writeStepQuestions(this.pipeline.id, stepKey, round, {
        agentKey: nc.key, nodeId: ctx.nodeId, answers: { answers: enriched },
      });
      await appendAudit(this.pipeline.dir, `${agentLabel}: ${enriched.length} answer(s) received (round ${round}).`).catch(() => {});
      await rm(qPath, { force: true }).catch(() => {});
      const step = this.state.steps.find((s) => s.key === stepKey);
      if (step?.sessionId) ctx.resumeSessionId = step.sessionId;
      ctx.questionsAnswered = [...(ctx.questionsAnswered || []), ...enriched];
      ctx.questionsFile = round < MAX_QUESTION_ROUNDS
        ? this._questionsPath(ctx.executionId, round + 1)
        : null;
      result = await this._runNodeAttempts(nc, ctx);
    }
    return result;
  }

  /** A session/usage cap that only clears after a multi-hour reset: pause the run. */
  _pauseForLimit(nc, err) {
    const label = nc.key || 'agent';
    const reason = firstLine(err?.message || String(err));
    if (!this.pauseReason) this.pauseReason = reason;
    this._log(label, 'warn', `session/usage limit reached — pausing for manual resume: ${reason}`);
    appendAudit(this.pipeline.dir, `Pipeline **paused**: session/usage limit on ${label} — ${reason}. Resume after the reset.`).catch(() => {});
    this.pause();
  }

  /** Budget gate (spec §6.5), evaluated before every agent launch. */
  _checkCostLimits() {
    if (!this.pipeline?.id) return;                    // pre-createPipeline: nothing to meter
    const pipeLimit = pipelineCostLimitUsd();
    const spentHere = Math.max(this.state.totalCostUsd || 0, sumStepCosts(this.state.steps));
    if (pipeLimit != null && spentHere >= pipeLimit
        && !readCostCapOverride(this.pipeline.id)) {
      this._pauseForCost('cost_pipeline',
        `pipeline cost limit reached ($${spentHere.toFixed(2)} >= $${pipeLimit.toFixed(2)})`);
    }
    const totalLimit = totalCostLimitUsd();
    if (totalLimit != null) {
      const period = costLimitResetPeriod();
      const spent = windowedSpendUsd(costWindowStart(new Date(), period).getTime());
      if (spent >= totalLimit) {
        this._pauseForCost('cost_total',
          `total cost limit reached ($${spent.toFixed(2)} >= $${totalLimit.toFixed(2)} this ${period === 'weekly' ? 'week' : 'month'})`);
      }
    }
  }

  _pauseForCost(code, detail) {
    if (!this.pauseReason) this.pauseReason = code;
    this._log('orchestrator', 'warn', `${detail} — pausing for manual resume`);
    appendAudit(this.pipeline.dir, `Pipeline **paused**: ${detail}.`).catch(() => {});
    this.pause();
    throw pauseErr();
  }

  /** Recoverable-error policy: bounded auto retry, or ONE shared user prompt per
   *  error class. Returns 'retry' | 'abort'. */
  async _recover({ nc, cls, err, attempt }) {
    const label = nc.key || 'agent';
    this._log(label, 'warn', `recoverable ${cls} error: ${err.message}`);
    await appendAudit(this.pipeline.dir, `Recoverable **${cls}** error on ${label}: ${firstLine(err.message)}`).catch(() => {});

    if (this.auto) {
      if (attempt > RECOVERY_MAX_AUTO_ATTEMPTS) return 'abort';
      await this._backoff(attempt, this.pauseAbort.signal);
      if (this.pauseRequested || this.pauseAbort.signal.aborted) return 'abort';
      return 'retry';
    }

    this._recovery ||= new Map();
    if (!this._recovery.has(cls)) {
      const p = this._enqueueRecoveryPrompt(cls, firstLine(err.message))
        .finally(() => { if (this._recovery) this._recovery.delete(cls); });
      this._recovery.set(cls, p);
    }
    return this._recovery.get(cls);
  }

  _enqueueRecoveryPrompt(cls, message) {
    const run = () =>
      this._ask({
        id: `recovery-${cls}-${this._recoveryNonce()}`,
        kind: 'recovery',
        recovery: { cls, message },
      }).then((ans) => (ans && ans.decision === 'abort' ? 'abort' : 'retry'));
    return this._enqueueAsk(run);
  }

  /** Serialize asks: ONE prompt open at a time (recovery + questions + gates). */
  _enqueueAsk(run) {
    const prev = this._askTail || Promise.resolve();
    const next = prev.then(run, run);
    this._askTail = next.catch(() => {}); // tail must never reject the chain
    return next;
  }

  _backoff(attempt, signal) {
    const base = (() => {
      const n = Number(process.env.WORCA_RECOVERY_BACKOFF_MS);
      return Number.isFinite(n) && n >= 0 ? n : 1000;
    })();
    const ms = base * Math.pow(2, Math.max(0, attempt - 1));
    if (!ms) return Promise.resolve();
    return new Promise((res) => {
      const t = setTimeout(res, ms);
      t.unref?.();
      if (signal) {
        if (signal.aborted) { clearTimeout(t); res(); }
        else signal.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
      }
    });
  }

  _recoveryNonce() {
    return ++this._recoverySeq;
  }

  /**
   * The read-only workspace metadata every execution ctx carries (§5.8): the
   * frozen description + the member set with each member's worktree dir,
   * checkpoint ref and per-project graph instruction. It is no longer a channel —
   * it is derived fresh from the member maps on every read, in sorted-projectKey
   * order — but the SHAPE is the one phases.mjs renders from.
   */
  _workspaceCtx() {
    return {
      kind: 'metadata',
      workspaceDescription: this.workspaceDescription,
      projects: this.members.map((m) => ({
        projectKey: m.projectKey,
        projectName: m.projectName,
        worktreeDir: this.workDirs.get(m.projectKey),
        checkpointRef: this.checkpointRefs[m.projectKey],
        graphInstruction: this.toolInstructions.get(m.projectKey) || '',
      })),
    };
  }

  /**
   * The per-member roster every node ctx carries (§5.8). Absolute `dir` always;
   * `relDir` is a RENDER-ONLY token, emitted on detached runs only. `checkpointRef`
   * is populated in BOTH modes (the _ensureGitCheckpoint mirror). Single mode's
   * toolInstructions map is empty in both modes, so graphInstruction degrades to ''
   * — every renderer must tolerate that.
   */
  _reposCtx() {
    return this.members.map((m) => ({
      projectKey: m.projectKey,
      projectName: m.projectName,
      dir: this.workDirs.get(m.projectKey) || null,
      relDir: this.runRootMode === 'detached' ? `repos/${m.projectKey}` : null,  // render-only token
      checkpointRef: this.checkpointRefs[m.projectKey] || null,
      graphInstruction: this.toolInstructions.get(m.projectKey) || '',
    }));
  }

  // ── question / gate plumbing ───────────────────────────────────────────────

  /**
   * Emit a question and await its resolution. Honors auto-mode.
   * Freezes the active-time clock while blocked on the user (active-time-only).
   * @returns {Promise<any>} the answer payload
   */
  async _ask({ id, kind, questions, issues, recovery, agent, nodeId, wireId }) {
    this._checkAbort();
    // No interactive prompt may OPEN on a pausing run. pause() rejects only the
    // prompt that is currently open; a queued ask (a parallel sibling's questions
    // or a recovery prompt behind the _askTail chain) would otherwise still fire
    // and emit a fresh 'question' on a pausing/paused run (stale gate in the UI,
    // readline prompt while the CLI exits). Unwind it as a pause instead — the
    // owning node marks 'paused', exactly like every other pause path.
    this._checkPause();

    // Freeze the active-time clock while we wait on the user (active-time-only).
    const frozenKey = this._runningStepKey();
    if (frozenKey) {
      this._clockPause(frozenKey);
      this.state.totalActiveMs = sumStepActive(this.state.steps);
      this._emit('state', this.getState()); // UI freezes the live timer
      this._persist().catch(() => {});
    }

    this._emit('question', { id, kind, questions, issues, recovery, agent, nodeId, ...(wireId ? { wireId } : null) });

    try {
      if (this.auto) {
        if (kind === 'recovery') {
          // Auto mode handles recovery in _recover before ever calling _ask;
          // this is a defensive fallback so an auto run can never hang.
          return { decision: 'abort' };
        }
        if (kind === 'clarify' || kind === 'questions') {
          this._log('orchestrator', 'info', `auto-answering ${kind} ${id}`);
          return {
            answers: (questions || []).map((q) => ({
              id: q.id,
              choice: (q.options && q.options.find((o) => o && o.trim())) || 'auto',
            })),
          };
        }
        this._log('orchestrator', 'info', `auto-answering gate ${id} -> continue`);
        return { decision: 'continue' };
      }
      return await new Promise((resolveP, rejectP) => {
        this.pendingQuestion = { id, kind, resolve: resolveP, reject: rejectP };
      });
    } finally {
      // Resume only if that step is still the active phase AND the run hasn't
      // gone terminal. stop() sets status before rejecting the pending promise,
      // so on a stop-while-blocked we must NOT resume (the terminal _setStatus
      // already folded every clock). Gates fire after a phase's 'done', so
      // frozenKey is null there and nothing resumes anyway.
      if (frozenKey && !['stopped', 'error', 'pausing', 'paused'].includes(this.state.status)) {
        this._clockResume(frozenKey);
        this._emit('state', this.getState());
        this._persist().catch(() => {});
      }
    }
  }

  /** List the user's attached files copied into <pipeline>/extras/ (basename + abs
   *  path), sorted for deterministic seeded-file content. Empty when none were
   *  attached or the dir is absent. */
  async _collectExtras() {
    try {
      const dir = join(this.pipeline.dir, 'extras');
      const names = (await readdir(dir)).sort();
      return names.map((name) => ({ name, path: join(dir, name) }));
    } catch {
      return [];
    }
  }

  /**
   * Record/transition ONE execution's step row. The key IS the executionId
   * (`x:<nodeId>:<ordinal>`), which is what makes concurrent executions of
   * different nodes — and loop re-executions of the SAME node — collide-free
   * without a step index. On 'start' it does NOT pause sibling clocks (parallel
   * executions run simultaneously); on a terminal marker it folds just this
   * execution's clock.
   */
  _execStep(ctx, status) {
    const key = ctx.executionId;
    const now = new Date().toISOString();
    let step = this.state.steps.find((s) => s.key === key);
    if (!step) {
      step = {
        key,
        executionId: key,
        phase: ctx.uiPhase,
        nodeId: ctx.nodeId,
        stepIndex: null,          // a graph has executions, not step indexes
        cycle: ctx.ordinal,
        status,
        startedAt: now,
        updatedAt: now,
        activeMs: 0,
        runningSince: null,
        // The firing trigger, taken from the execute args rather than the exec
        // 'start' event: the scheduler emits that event BEFORE it invokes, so the
        // row does not exist yet when the event lands. History labels a loop
        // re-fire `cycle 2 · fix` off this.
        trigger: ctx.trigger || {},
      };
      this.state.steps.push(step);
    } else {
      step.status = status;
      step.updatedAt = now;
    }
    if (status === 'start') this._clockResume(key);
    else this._clockPause(key);
    this.state.totalActiveMs = sumStepActive(this.state.steps);
    this.state.phase = ctx.uiPhase;
    this.state.cycle = ctx.ordinal;
    this.state.updatedAt = now;
    // Backstop (§5.2): when an execution reaches its terminal marker, force-close
    // any sub-agent still 'running' for THIS execution so the UI never shows a
    // stuck-active square if a tool_result finish was missed. 'start' never closes
    // anything; the close status is 'stopped' when the run was stopped or is
    // pausing (pause SIGTERMs in-flight children too), else 'finished'.
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

  /** Translate a low-level claude/mock event into a pipeline 'log' event. */
  _onAgentEvent(role, e, attr = null) {
    if (!e) return;
    // Sub-agent telemetry (feature-detected, gated by WORCA_SUBAGENT_HOOKS). A
    // surfaced PostToolUse:Agent hook-event carries the parent tool_use_id +
    // tool_response telemetry; enrich the matching record's columns, keyed by
    // tool_use_id (the canonical key — never agent_id). Returns early: a hook
    // event has no human text and no cost to attribute.
    if (e.type === 'hook-event') {
      this._recordSubAgentTelemetry(e.raw);
      return;
    }
    // Pause/Resume: stamp the claude session id on the step that spawned it, and
    // persist eagerly — a later pause (or even a crash) must find it in the DB.
    if (e.type === 'session' && typeof e.sessionId === 'string') {
      const key = attr?.stepKey;
      const step = key ? this.state.steps.find((s) => s.key === key) : null;
      if (step && step.sessionId !== e.sessionId) {
        step.sessionId = e.sessionId;
        this._persist().catch(() => {});
      }
      return;
    }
    // Capture actual spend before anything returns early. The runner tags the
    // terminal stream-json `result` with costUsd (Claude's total_cost_usd; 0 in
    // mock). Fall back to raw.total_cost_usd defensively. e.raw may be a string
    // (non-JSON line) — `.type` on it is just undefined, so this never throws.
    // `e.costUsd != null` keeps a genuine 0 (which `!= null` is true for).
    const cost = e.costUsd != null
      ? Number(e.costUsd)
      : (e.raw && e.raw.type === 'result' ? Number(e.raw.total_cost_usd ?? e.raw.cost_usd) : NaN);
    if (Number.isFinite(cost)) this._recordCost(cost, attr?.stepKey);
    else if (e.raw && e.raw.type === 'result' && !this.claude.mock) {
      this._log('orchestrator', 'warn', 'result event carried no cost estimate (total_cost_usd absent)', attr);
    }

    // Sub-agent attribution. A child (Task/Agent) event carries parent_tool_use_id
    // = the id of the parent's Task tool_use block; main-agent events carry null/
    // absent. parent_tool_use_id is a TOP-LEVEL stream-json field; the message-
    // nested read is defensive. On a string `raw`, both reads yield undefined.
    const subId = e.raw?.parent_tool_use_id ?? e.raw?.message?.parent_tool_use_id ?? null;

    // Learn Task/Agent descriptions from MAIN-agent events (subId == null) so the
    // child events below can be labeled by what their sub-agent was asked to do.
    if (subId == null) {
      registerSubAgents(e.raw, this._subAgentLabels);
      // Lifecycle: a NEW Task/Agent tool_use on the MAIN stream = a sub-agent spawn.
      // Needs `attr` to pin nodeId/stepIndex/cycle/stepKey; the clarify pre-step
      // (attr === null) carries no node, so it is logged but not lifecycle-tracked.
      if (attr) this._recordSubAgentSpawns(e.raw, attr);
      // Finish: a tool_result on the MAIN stream whose tool_use_id is a tracked
      // sub-agent → finished/error. These `user` envelopes were previously dropped.
      this._recordSubAgentFinishes(e.raw);
    }

    // Capture named-skill / MCP-tool usage for the Sub-agents dropdown pills
    // (main agent -> its step; sub-agent -> its record). Independent of the
    // text/tool log branches below (it runs BEFORE the `if (text) return`), so a
    // mixed text+tool_use turn is still caught.
    this._recordSkills(e.raw, subId, attr);
    // Count graphify CLI invocations (Bash only) per agent / sub-agent. Bash-only
    // by design: the graphify skill runs the CLI itself, so counting the Skill tool
    // too would double-count; the bash invocation is the ground truth and also
    // catches direct CLI use with no skill.
    this._recordGraphify(e.raw, subId, attr);

    // Display source: parent role for main events; "role ▸ label" for sub-agent
    // events. `sub` drives the indented/dimmed web styling.
    let source = role;
    let sub = false;
    if (subId != null) {
      let label = this._subAgentLabels.get(subId);
      if (!label) {
        label = `sub-agent-${++this._subAgentFallbackSeq}`;
        this._subAgentLabels.set(subId, label); // stamp so the ordinal stays stable for this id
      }
      source = `${role} ▸ ${label}`;
      sub = true;
    }
    // Preserve the step attribution (nodeId/stepIndex/cycle) carried by attr so a
    // sub-agent line stays pinned to the right pipeline step/cycle in the UI; just
    // add `sub`. {...null} === {}, so attr === null (the clarify pre-step) is safe.
    const logAttr = sub ? { ...attr, sub: true } : attr;

    // Human-readable assistant text (if any). NO early return: a single
    // assistant turn can carry BOTH a text block and tool_use blocks — fall
    // through so each tool call is logged too. A text-only turn has no
    // tool_use/tool_result blocks, so the loops below are empty and its output
    // is identical to the pre-change path.
    const text = (e.text || '').trim();
    if (text) this._log(source, 'info', text, logAttr);

    // The `system`/init event has no text and no tool blocks — surface the
    // model (parity with worca's `[init] model=<model>`) instead of dropping it.
    if (e.raw && e.raw.type === 'system' && e.raw.subtype === 'init') {
      this._log(source, 'debug', `[init] model=${e.raw.model || '?'}`, logAttr);
    }

    // Concrete tool calls the agent made this turn (assistant.tool_use blocks).
    for (const call of describeToolUses(e.raw, this.projectDir)) {
      this._log(source, 'debug', `→ ${call}`, logAttr);
    }

    // Tool-result outcomes (`user`-envelope + child tool_result blocks).
    // ADDITIVE ONLY — _recordSubAgentFinishes (above) still owns sub-agent
    // lifecycle state; this loop never mutates state, it only logs.
    for (const line of describeToolResults(e.raw)) {
      this._log(source, 'debug', `← ${line}`, logAttr);
    }
  }

  /**
   * Lifecycle spawn reducer: for every NEW Task/Agent tool_use block in a
   * MAIN-stream event, push a `running` sub-agent record (attributed to the
   * step via `attr`), mirror it to the sub_agents table, and emit a `spawn`
   * delta. Idempotent per tool_use id (re-seen ids are skipped). `attr` is
   * required (the caller only invokes this when a node is in scope).
   */
  _recordSubAgentSpawns(raw, attr) {
    const content = raw?.message?.content;
    if (!Array.isArray(content)) return;
    for (const c of content) {
      if (c?.type !== 'tool_use' || (c.name !== 'Task' && c.name !== 'Agent') || !c.id) continue;
      if (this.state.subAgents.some((s) => s.id === c.id)) continue; // idempotent
      const label = this._subAgentLabels.get(c.id) || clip(c.input?.description || c.input?.prompt, SUBAGENT_LABEL_MAX);
      const rec = {
        id: c.id,
        label: label || null,
        nodeId: attr.nodeId ?? null,
        executionId: attr.executionId ?? null,
        uiPhase: attr.uiPhase ?? null,
        stepIndex: attr.stepIndex ?? null,
        cycle: attr.cycle ?? null,
        stepKey: attr.stepKey ?? null,
        status: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        subagentType: c.input?.subagent_type ?? null,
      };
      this.state.subAgents.push(rec);
      this._upsertSubAgent(rec);
      this._subAgentTransition('spawn', rec);
    }
  }

  /**
   * Lifecycle finish reducer: scan a MAIN-stream event's content for a
   * tool_result whose tool_use_id is a tracked sub-agent. Set status =
   * is_error ? 'error' : 'finished' and stamp finishedAt, but ONLY while the
   * record is still 'running' (a late/duplicate tool_result must not flip a
   * terminal record back or re-emit). Mirrors to the table + emits a `finish`
   * delta. The finish envelope is `{type:'user', message:{content:[{type:
   * 'tool_result', tool_use_id, is_error?:true}]}}` — previously dropped.
   */
  _recordSubAgentFinishes(raw) {
    const content = raw?.message?.content;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (b?.type !== 'tool_result' || !b.tool_use_id) continue;
      const rec = this.state.subAgents.find((s) => s.id === b.tool_use_id);
      if (!rec || rec.status !== 'running') continue; // unknown id or already terminal
      rec.status = b.is_error ? 'error' : 'finished';
      rec.finishedAt = new Date().toISOString();
      this._upsertSubAgent(rec);
      this._subAgentTransition('finish', rec);
    }
  }

  /**
   * Record skills / MCP-tools used in one agent event. Routes by parent_tool_use_id:
   * a MAIN-agent turn (subId == null) attributes to its pipeline step (by stepKey);
   * a sub-agent turn (subId != null) attributes to the spawned record (id === subId).
   * Grows a deduped, capped `skills` array and emits a delta + persists ONLY when the
   * set actually changed. No-op when there is nothing to attribute to (e.g. the
   * clarify pre-step has no step; a child event seen before its spawn).
   */
  _recordSkills(raw, subId, attr) {
    const labels = extractSkillLabels(raw);
    if (!labels.length) return;
    if (subId == null) {
      const key = attr?.stepKey;
      const step = key ? this.state.steps.find((s) => s.key === key) : null;
      if (!step) return;
      const merged = mergeSkills(step.skills, labels);
      if (!merged) return;
      step.skills = merged;
      this._emit('stepskills', {
        stepKey: step.key,
        nodeId: step.nodeId ?? null,
        executionId: step.executionId ?? step.key,
        cycle: step.cycle ?? null,
        skills: merged,
        ts: new Date().toISOString(),
      });
      this._persist().catch(() => {}); // mirrors _recordCost: per-step skills survive a reload
    } else {
      const rec = this.state.subAgents.find((s) => s.id === subId);
      if (!rec) return;
      const merged = mergeSkills(rec.skills, labels);
      if (!merged) return;
      rec.skills = merged;
      this._upsertSubAgent(rec);
      this._subAgentTransition('update', rec);
    }
  }

  /**
   * Count graphify CLI invocations (Bash only) in one agent event and add them to
   * the running total. Routes exactly like _recordSkills: a MAIN-agent turn
   * (subId == null) accrues onto its pipeline step (by stepKey) and emits a
   * `stepgraphify` delta; a sub-agent turn accrues onto the spawned record and
   * emits a `subagent` update. No-op when the event invoked graphify zero times or
   * there is nothing to attribute to (clarify pre-step; child seen before spawn).
   */
  _recordGraphify(raw, subId, attr) {
    const n = countGraphifyBashCalls(raw);
    if (!n) return;
    if (subId == null) {
      const key = attr?.stepKey;
      const step = key ? this.state.steps.find((s) => s.key === key) : null;
      if (!step) return;
      step.graphifyCount = (step.graphifyCount ?? 0) + n;
      this._emit('stepgraphify', {
        stepKey: step.key,
        nodeId: step.nodeId ?? null,
        executionId: step.executionId ?? step.key,
        cycle: step.cycle ?? null,
        graphifyCount: step.graphifyCount,
        ts: new Date().toISOString(),
      });
      this._persist().catch(() => {}); // mirrors _recordSkills: survives a reload
    } else {
      const rec = this.state.subAgents.find((s) => s.id === subId);
      if (!rec) return;
      rec.graphifyCount = (rec.graphifyCount ?? 0) + n;
      this._upsertSubAgent(rec);
      this._subAgentTransition('update', rec);
    }
  }

  /** Best-effort mirror of a sub-agent record to the sub_agents table. Guarded
   *  exactly like _persist/_artifact: no pipeline → in-memory only (unit ctx). */
  _upsertSubAgent(rec) {
    if (!this.pipeline) return;
    try { upsertSubAgent(this.pipeline.id, rec); } catch { /* best-effort */ }
  }

  /** Emit a hybrid `subagent` delta. The full `state` snapshot remains the
   *  reconcile/late-join source of truth (it carries subAgents). */
  _subAgentTransition(transition, rec) {
    this._emit('subagent', {
      transition,
      id: rec.id,
      label: rec.label ?? null,
      nodeId: rec.nodeId ?? null,
      executionId: rec.executionId ?? rec.stepKey ?? null,
      uiPhase: rec.uiPhase ?? null,
      stepKey: rec.stepKey ?? null,
      stepIndex: rec.stepIndex ?? null,
      cycle: rec.cycle ?? null,
      status: rec.status,
      ...(rec.durationMs != null ? { durationMs: rec.durationMs } : {}),
      ...(rec.tokens != null ? { tokens: rec.tokens } : {}),
      ...(rec.costUsd != null ? { costUsd: rec.costUsd } : {}),
      ...(Array.isArray(rec.skills) ? { skills: rec.skills } : {}),
      ...(rec.subagentType != null ? { subagentType: rec.subagentType } : {}),
      ...(rec.graphifyCount != null ? { graphifyCount: rec.graphifyCount } : {}),
      ts: new Date().toISOString(),
    });
  }

  /**
   * Telemetry enrichment from a surfaced PostToolUse:Agent hook-event. Reads the
   * parent tool_use_id + tool_response.{totalDurationMs,totalTokens,usage} and
   * fills the matching sub-agent record's durationMs/tokens/costUsd (only those
   * present), mirrors to the table, and emits an `update` delta. No-op for an
   * unknown id or a non-Agent hook. Strictly additive — the baseline lifecycle
   * needs none of this.
   */
  _recordSubAgentTelemetry(raw) {
    const id = raw?.tool_use_id ?? raw?.tool_response?.tool_use_id ?? null;
    if (!id) return;
    const rec = this.state.subAgents.find((s) => s.id === id);
    if (!rec) return;
    const tr = raw?.tool_response || {};
    if (Number.isFinite(Number(tr.totalDurationMs))) rec.durationMs = Number(tr.totalDurationMs);
    if (Number.isFinite(Number(tr.totalTokens))) rec.tokens = Number(tr.totalTokens);
    const cost = tr.usage?.cost_usd ?? tr.usage?.total_cost_usd ?? tr.cost_usd;
    if (Number.isFinite(Number(cost))) rec.costUsd = Number(cost);
    this._upsertSubAgent(rec);
    this._subAgentTransition('update', rec);
  }

  // ── git checkpoint ─────────────────────────────────────────────────────────

  /**
   * Ensure `dir` is its OWN git repo with at least one commit, and return its
   * checkpoint ref (HEAD), or null when none could be established. Pure of state
   * writes — the caller wires checkpointRef(s)/state. Single-project and each
   * workspace member call this with their own dir (D3: never an enclosing repo).
   * @param {string} dir
   * @returns {Promise<string|null>}
   */
  async _ensureGitCheckpointFor(dir) {
    // C2: `--is-inside-work-tree` is true even when dir merely sits *inside* an
    // enclosing repo (no .git of its own). Acting on that parent repo would
    // silently create worca-cc/* branches + checkpoint commits in the developer's
    // real repo. Require dir to BE the repo toplevel; if it isn't (no repo, or
    // only a parent repo), `git init` a dedicated repo here.
    const projReal = await realpath(dir).catch(() => resolve(dir));
    const top = await this._git(['rev-parse', '--show-toplevel'], { cwd: dir });
    let topReal = null;
    if (top.ok && top.stdout.trim()) {
      topReal = await realpath(top.stdout.trim()).catch(() => top.stdout.trim());
    }
    const isOwnRepo = topReal === projReal;
    if (!isOwnRepo) {
      if (topReal) {
        this._log(
          'git',
          'info',
          `${dir} is nested in repo ${topReal}; initializing a dedicated repo to isolate worktrees.`,
        );
      }
      await this._git(['init'], { cwd: dir });
      // Ensure an identity exists for the commit (local, non-destructive).
      await this._git(['config', 'user.email', 'orchestrator@local'], { cwd: dir });
      await this._git(['config', 'user.name', 'orchestrator'], { cwd: dir });
    }
    // Is there any commit yet?
    const head = await this._git(['rev-parse', 'HEAD'], { cwd: dir });
    if (!head.ok) {
      await this._git(['add', '-A'], { cwd: dir });
      const commit = await this._git([
        '-c',
        'user.email=orchestrator@local',
        '-c',
        'user.name=orchestrator',
        'commit',
        '--allow-empty',
        '-m',
        'orchestrator: initial checkpoint',
      ], { cwd: dir });
      if (!commit.ok) {
        this._log('git', 'warn', `initial commit failed: ${commit.stderr.trim()}`);
      }
    }
    const ref = await this._git(['rev-parse', 'HEAD'], { cwd: dir });
    return ref.ok ? ref.stdout.trim() : null;
  }

  /**
   * Layer 1: build + persist the deterministic results view while the worktree(s)
   * and checkpoint refs are still live. Best-effort: never throws into run().
   */
  async _buildResults() {
    if (!this.pipeline) return;
    try {
      const reviews = readPipelineExtras(this.pipeline.id).reviews || [];
      // Unified iteration over workDirs + checkpointRefs — the ref map is filled in
      // BOTH modes (the _ensureGitCheckpoint mirror), so a single-project run reads
      // the same shape. The single-project OUTPUT shape stays byte-identical (one
      // results.json, one un-prefixed patch) via the members.length === 1 special case.
      const members = [];
      const patches = [];
      for (const [key, dir] of this.workDirs.entries()) {
        const base = this.checkpointRefs[key];
        if (!base) continue;
        // §8.8: the same exclusion set the commit uses, so results.json and
        // diff.patch agree with what _commitWork actually committed.
        const ex = this._excludePathspecs(key);
        const [ns, num, patch] = await Promise.all([
          diffNameStatus(dir, base, undefined, ex),
          diffNumstat(dir, base, undefined, ex),
          diffPatch(dir, base, undefined, ex),
        ]);
        const results = assembleResults({ nameStatus: ns, numstat: num, reviews });
        members.push({ projectKey: key, results });
        patches.push({ key, patch });
      }
      if (!members.length) return;
      if (members.length === 1 && !this.isWorkspace) {
        await persistResults(this.pipeline.dir, members[0].results);
        await persistDiffPatch(this.pipeline.dir, patches[0].patch);
      } else {
        const perProject = buildPerProject(members);
        const results = { summary: rollupSummary(perProject), perProject };
        await persistResults(this.pipeline.dir, results);
        await persistDiffPatch(this.pipeline.dir, patches.map((p) => `# ${p.key}\n${p.patch}`).join('\n\n'));
      }
    } catch (err) {
      this._log('results', 'warn', `results build failed: ${err.message}`);
    }
  }

  /**
   * Task-source write-back (spec §7.5): report the finished run to the plugin
   * source that produced it. Runs right after _buildResults() on BOTH terminal
   * done paths so results.json exists for the summary, and the row status is
   * already persisted 'done' (statusToResult -> 'completed'). NEVER throws and
   * never fails the run: a failure emits a warn `log` event and the results view
   * offers a manual retry via the same retryWriteback (Task 15 endpoint, Task 21
   * button). Prompt/markdown
   * runs skip inside retryWriteback before any work — feature-off runs pay
   * nothing here. Bounded by the shim's per-op timeout.
   */
  async _reportToSource() {
    if (!this.pipeline) return;
    try {
      const outcome = await retryWriteback(this.pipeline.id);
      if (outcome?.ok === false) {
        this._log('writeback', 'warn', `task-source write-back failed: ${outcome.error} — use "Report result" in the results view to retry`);
      } else if (outcome?.ok && !outcome.skipped) {
        await appendAudit(this.pipeline.dir, 'Result reported back to the task source.').catch(() => {});
      }
    } catch (err) {
      this._log('writeback', 'warn', `task-source write-back failed: ${err?.message || err}`);
    }
  }

  /** Single-project checkpoint: own repo + commit, record the scalar ref + state. */
  async _ensureGitCheckpoint() {
    this.checkpointRef = await this._ensureGitCheckpointFor(this.projectDir);
    this.state.checkpointRef = this.checkpointRef;
    // Mirror into the per-member map so the unified _buildResults / _reposCtx
    // iteration reads ONE shape in both modes. Without this the unified iteration
    // hits `if (!base) continue` and silently writes empty results/diff on every
    // single-project run (§5.2 step 4).
    const onlyKey = this.members[0]?.projectKey;
    if (onlyKey) {
      this.checkpointRefs[onlyKey] = this.checkpointRef;
      this.state.checkpointRefs = { ...this.checkpointRefs };
    }
    if (this.checkpointRef) {
      await appendAudit(
        this.pipeline.dir,
        `Git checkpoint at \`${this.checkpointRef.slice(0, 10)}\`.`,
      );
    } else {
      this._log('git', 'warn', 'No git checkpoint ref could be established (continuing).');
    }
  }

  /**
   * Workspace checkpoint: run _ensureGitCheckpointFor once per member (serial —
   * git is cheap and serial avoids interleaved index locks), record
   * this.checkpointRefs[projectKey], mirror the scalar this.checkpointRef to the
   * primary, and write state.checkpointRefs (+ scalar). Members are iterated in
   * sorted-projectKey order so the primary is members[0].
   */
  async _ensureGitCheckpointAll() {
    for (const m of this.members) {
      const ref = await this._ensureGitCheckpointFor(resolve(m.projectDir));
      this.checkpointRefs[m.projectKey] = ref;
      if (ref) {
        await appendAudit(
          this.pipeline.dir,
          `Git checkpoint for \`${m.projectKey}\` at \`${ref.slice(0, 10)}\`.`,
        ).catch(() => {});
      } else {
        this._log('git', 'warn', `No git checkpoint ref for ${m.projectKey} (continuing).`);
      }
    }
    const primaryKey = this.members[0]?.projectKey;
    this.checkpointRef = primaryKey ? this.checkpointRefs[primaryKey] : null;
    this.state.checkpointRef = this.checkpointRef;
    this.state.checkpointRefs = { ...this.checkpointRefs };
    await this._persist();
  }

  /**
   * Stage every change in the working tree with intent-to-add so that newly
   * created (untracked) files show up in a plain `git diff` for the reviewer.
   * Uses `git add -A -N`: it records intent-to-add for new paths (making their
   * content visible to `git diff`) without actually creating a commit, so the
   * checkpoint commit remains the single diff base. Best-effort; never throws.
   */
  async _stageWorkingTree() {
    // Stage EVERY member worktree (keyed — the pathspec lookup needs the projectKey)
    // so each per-project reviewer's `git diff` sees that project's agent edits.
    // Single-project runs have exactly one entry (populated in both modes). The
    // isWorkspace branch is gone: workDirs is the single shape. An empty map means
    // setup never ran, in which case staging must be a NO-OP — the old single arm
    // fell back to this.workDir, which pre-setup is the user's LIVE checkout.
    for (const [key, dir] of this.workDirs.entries()) {
      // §8.8: an empty exclusion set (every legacy run) reproduces today's argv
      // byte-identically — `--` with no trailing pathspec is a no-op for git add.
      const ex = this._excludePathspecs(key);
      const args = ex.length ? ['add', '-A', '-N', '--', '.', ...ex] : ['add', '-A', '-N'];
      const res = await this._git(args, { cwd: dir });
      if (!res.ok && res.stderr && res.stderr.trim()) {
        this._log('git', 'debug', `git add -A -N (${dir}): ${res.stderr.trim()}`);
      }
    }
  }

  /**
   * §8.8: the ONE pathspec set that keeps worca-cc's injected paths out of the
   * commit, the reviewer's intent-to-add staging, and all three result diffs.
   * `kind:'claudeMdSection'` entries are deliberately EXCLUDED from the set — their
   * file is the user's tracked CLAUDE.md, and a blanket `:(exclude)CLAUDE.md` would
   * silently strip the agent's legitimate edits (teardown strips the fence instead).
   * Returns [] under legacy and through Phase 2 (this.injectedPaths is always {}),
   * which is what makes every legacy argv byte-identical.
   * @param {string} projectKey
   * @returns {string[]}
   */
  _excludePathspecs(projectKey) {
    const entries = this.injectedPaths?.[projectKey] ?? [];
    if (!Array.isArray(entries) || !entries.length) return [];
    return entries
      .filter((e) => e && e.path && e.kind !== 'claudeMdSection')
      .map((e) => `:(exclude)${e.path}`);
  }

  /**
   * Run a git command in the project dir. Never throws; returns
   * { ok, code, stdout, stderr }. Honors the abort signal.
   */
  _git(args, { cwd, ignoreAbort = false } = {}) {
    return new Promise((resolveP) => {
      let child;
      try {
        child = spawn('git', args, {
          cwd: cwd || this.projectDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          // ignoreAbort: teardown commits run AFTER the run is aborted (stop/error);
          // binding the aborted signal here would kill them instantly and leave the
          // kept branch empty. Cleanup git must outlive the abort.
          signal: ignoreAbort ? undefined : this.abort.signal,
        });
      } catch (err) {
        resolveP({ ok: false, code: -1, stdout: '', stderr: err.message });
        return;
      }
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err) =>
        resolveP({ ok: false, code: -1, stdout, stderr: stderr || err.message }),
      );
      child.on('close', (code) => resolveP({ ok: code === 0, code: code ?? -1, stdout, stderr }));
    });
  }

  // ── agent prompt loading ───────────────────────────────────────────────────

  /** Bulk-load every registry agent's .md body keyed by agent key (the fallback
   *  layer behind a node's own resolved `agentPrompt`; phases.resolveAgentBody
   *  prefers the node). Registry-driven: built-in AND user agents load from their
   *  own layer via meta.agentPath. */
  async _loadAgentPrompts() {
    const prompts = {};
    const registry = this.registry || loadAgentRegistry(this.agentsDir);
    for (const meta of Object.values(registry)) {
      if (!meta.agentPath) { prompts[meta.key] = ''; continue; }
      try {
        prompts[meta.key] = await readFile(meta.agentPath, 'utf8');
      } catch {
        prompts[meta.key] = ''; // missing agent file => empty body (fails safe)
        this._log('orchestrator', 'warn', `Agent prompt missing: ${rel(this.projectDir, meta.agentPath)}`);
      }
    }
    return prompts;
  }

  // ── small utilities ─────────────────────────────────────────────────────────

  _deriveBaseName(promptText, title) {
    const fromTitle = title && title !== basename(this.pipeline?.dir || '') ? title : '';
    const source = fromTitle || firstLine(promptText) || 'feature';
    return slugify(source).slice(0, 40) || 'feature';
  }

  _checkAbort() {
    if (this.abort.signal.aborted || this.state.status === 'stopped') {
      const err = new Error('stopped');
      err.name = 'AbortError';
      throw err;
    }
  }

  _phase(phase, cycle, status, nodeId = null) {
    this.state.phase = phase;
    this.state.cycle = cycle;
    this._recordStep(phase, cycle, status, nodeId);
    this.state.updatedAt = new Date().toISOString();
    this._emit('phase', { phase, cycle, status });
    this._emit('state', this.getState());
    // Persist on phase boundaries so history/audit stay fresh.
    this._persist().catch(() => {});
  }

  _recordStep(phase, cycle, status, nodeId = null) {
    const key = cycle ? `${phase}#${cycle}` : phase;
    const now = new Date().toISOString();
    let step = this.state.steps.find((s) => s.key === key);
    if (!step) {
      step = { key, phase, cycle, status, startedAt: now, updatedAt: now, activeMs: 0, runningSince: null };
      // Attribute this phase's figures to a stepper node (clarify -> the plan
      // node) so the UI buckets it onto that cell. Totals are derived as Σ steps,
      // so labelling a step changes attribution only — it adds no ms/cost.
      if (nodeId) step.nodeId = nodeId;
      this.state.steps.push(step);
    } else {
      step.status = status;
      step.updatedAt = now;
      // Idempotent: a later marker (e.g. 'done') passes no nodeId and must not
      // clear the tag set at 'start'; never clobber an existing tag.
      if (nodeId && !step.nodeId) step.nodeId = nodeId;
    }
    if (status === 'start') {
      this._clockPauseAll();   // close out any prior running step
      this._clockResume(key);  // start this phase's active clock
    } else {
      this._clockPause(key);   // 'done' (or any terminal marker): finalize
    }
    // Keep the derived total in lockstep with the per-step figures (mirrors cost).
    this.state.totalActiveMs = sumStepActive(this.state.steps);
  }

  /**
   * Attribute a dollar cost to the step currently executing and roll it into
   * the pipeline total. The active step is identified by the live (phase,cycle)
   * — the SAME key _recordStep uses — because a `result` event always arrives
   * between that phase's 'start' and 'done' markers. Records the figure even when
   * it is 0 (so mock runs DISPLAY a truthful $0.00 rather than a blank); only
   * NaN/negative are ignored. Multiple results on one step accumulate. Emits a
   * 'state' snapshot so a live UI updates, and persists so history (state.json)
   * carries the figure.
   * @param {number} costUsd
   */
  _recordCost(costUsd, stepKey = null) {
    if (!Number.isFinite(costUsd) || costUsd < 0) return;
    const key = stepKey
      || (this.state.cycle ? `${this.state.phase}#${this.state.cycle}` : this.state.phase);
    const step = this.state.steps.find((s) => s.key === key);
    if (step) step.costUsd = roundUsd((step.costUsd || 0) + costUsd);
    // Derive the pipeline total from the per-step figures so it ALWAYS equals
    // their sum. Keeping a separate running total and rounding it on every add
    // drifts from Σ steps (e.g. 0.00005 + 0.00015 gave total 0.0003 vs Σ 0.0002).
    this.state.totalCostUsd = sumStepCosts(this.state.steps);
    // Append-only spend ledger (windowed budget accounting). Best-effort:
    // accounting must never kill a run; ledger and state share the same DB,
    // so failures co-occur with the _persist catch below anyway.
    if (costUsd > 0 && this.pipeline?.id) {
      try { recordCostDelta({ pipelineId: this.pipeline.id, stepKey: key, amountUsd: costUsd }); }
      catch (err) { this._log('orchestrator', 'warn', `cost ledger write failed: ${err?.message || err}`); }
    }
    this.state.updatedAt = new Date().toISOString();
    this._emit('state', this.getState());
    this._persist().catch(() => {});
  }

  /** Start (resume) the active-time clock for a step key, idempotently. */
  _clockResume(key) {
    const step = this.state.steps.find((s) => s.key === key);
    if (step && step.runningSince == null) step.runningSince = Date.now();
  }

  /** Pause a step's clock, folding the elapsed run into activeMs. No-op if idle. */
  _clockPause(key) {
    const step = this.state.steps.find((s) => s.key === key);
    if (!step || step.runningSince == null) return;
    step.activeMs = (step.activeMs || 0) + Math.max(0, Date.now() - step.runningSince);
    step.runningSince = null;
  }

  /** Pause every running step (defensive: only one runs at a time normally). */
  _clockPauseAll() {
    for (const s of this.state.steps) {
      if (s.runningSince != null) this._clockPause(s.key);
    }
  }

  /** Key of the step whose clock is currently running, or null. */
  _runningStepKey() {
    const s = this.state.steps.find((x) => x.runningSince != null);
    return s ? s.key : null;
  }

  /** Live total = finalized activeMs (sumStepActive) + the running tail. Test/diagnostic. */
  liveActiveMs() {
    const now = Date.now();
    let sum = 0;
    for (const s of this.state.steps) {
      sum += (s.activeMs || 0) + (s.runningSince != null ? Math.max(0, now - s.runningSince) : 0);
    }
    return sum;
  }

  _setStatus(status) {
    this.state.status = status;
    if (status === 'done' || status === 'stopped' || status === 'error' || status === 'paused') {
      this._clockPauseAll();
      this.state.totalActiveMs = sumStepActive(this.state.steps);
    }
    this.state.updatedAt = new Date().toISOString();
    this._emit('state', this.getState());
  }

  _log(source, level, text, attr = null) {
    const evt = { source, level, text, ts: new Date().toISOString() };
    if (attr) {
      if (attr.nodeId != null) evt.nodeId = attr.nodeId;
      // The graph engine's attribution pair: a line is pinned to the EXECUTION
      // that produced it, not just to its node (a loop re-fires the same node).
      if (attr.executionId != null) evt.executionId = attr.executionId;
      if (attr.stepIndex != null) evt.stepIndex = attr.stepIndex;
      if (attr.cycle != null) evt.cycle = attr.cycle;
      if (attr.sub) evt.sub = true;        // drives sub-agent web styling
    }
    this._emit('log', evt);
    this.logWriter.push(evt); // persist the full stream (buffered; flushed on a timer)
  }

  /**
   * Emit + index one artifact. `attr` carries the graph provenance
   * ({ nodeId, executionId, port }); `kind` is the output port's `artifactKind`
   * (defaulted to the port id by the registry), which is what keeps the persisted
   * kinds byte-identical to the v1 channel names.
   */
  _artifact(kind, path, attr = null) {
    this._emit('artifact', { kind, path, ...(attr || {}) });
    // Phase 3.9: ALSO index FS markdown/extra paths so pipeline-delete (Task 3.13)
    // can unlink the EXACT files later (best-effort; never blocks a run). Skip the
    // synthetic 'pipeline'/'clarify' kinds (clarify lives in the clarify table;
    // 'pipeline' is the dir itself). plan/review markdown live under
    // <store>/<key>/{plans,reviews} (store-root-relative); checklist/webui live in
    // the pipeline dir (dir-relative).
    if (!this.pipeline || !path || kind === 'pipeline' || kind === 'clarify' || kind === 'questions') return;
    let relPath = null;
    const pdir = this.pipeline.dir;
    if (path.startsWith(pdir + sep)) {
      relPath = relative(pdir, path);                 // dir-relative (checklist, webui)
    } else {
      const root = this.isWorkspace
        ? workspaceStorePath(this.workspaceKey)
        : projectStorePath(projectKey(this.projectDir));
      if (path.startsWith(root + sep)) relPath = relative(root, path); // store-rel (plan/review)
    }
    if (relPath) recordArtifact(this.pipeline.id, kind, relPath);
  }

  _emit(event, payload) {
    try {
      this.emit(event, payload);
    } catch {
      /* never let a listener crash the state machine */
    }
  }

  /**
   * Fire-and-forget: generate a concise LLM title and, when ready, persist + broadcast it.
   * The promise is stored on this._titlePromise for test determinism but is NEVER awaited
   * by run() (must not delay the run). Aborts with the run via this.abort.signal.
   */
  _kickoffTitleGeneration() {
    const prompt = this.pipeline?.promptText || this.opts.prompt || '';
    const id = this.pipeline?.id;
    if (!prompt || !id) { this._titlePromise = Promise.resolve(); return; }
    this._titlePromise = Promise.resolve()
      .then(() => generateTitle(prompt, {
        // §2.1 row 3: fire-and-forget title generation was the one remaining worca-cc
        // process started inside the user's LIVE checkout. Once a run root exists
        // there is no reason for it. The kickoff site moved to just after
        // _setupRunRoot() so runCwd is populated here.
        cwd: this.runCwd ?? this.projectDir,
        signal: this.abort.signal,
        // Title generation is the one claude process a RUN spawns outside runOpts,
        // so it honors the same env policy as the pipeline nodes. Both undefined
        // on an unconfigured project ⇒ byte-identical spawn env (legacy parity).
        envScrub: this.guardrails?.envScrub || undefined,
        envAllowlist: this.guardrails?.envScrub ? this.guardrails.envAllowlist : undefined,
      }))
      .then((real) => {
        if (!real || real === this.state.title) return;     // empty / unchanged → keep provisional
        if (this.abort.signal.aborted) return;
        this.state.title = real;
        this.state.titleProvisional = false;
        this.state.updatedAt = new Date().toISOString();
        updatePipelineTitle(id, real);                      // persist (dedicated UPDATE)
        // Carry pipelineId: the client run model has no pipeline id; History patch needs it.
        this._emit('title', { title: real, provisional: false, pipelineId: id }); // live broadcast
      })
      .catch(() => { /* generateTitle already swallows; this is a final backstop */ });
  }

  async _persist() {
    if (!this.pipeline) return;
    try {
      await writeState(this.pipeline.dir, this.state);
    } catch {
      /* persistence is best-effort */
    }
  }

  /** Begin owning this run's row: stamp pid/host + start the heartbeat timer. Idempotent. */
  _startHeartbeat() {
    if (!this.pipeline?.id) return;
    claimPipelineOwnership(this.pipeline.id);
    if (this._heartbeatTimer) return;
    this._heartbeatTimer = setInterval(() => {
      try { touchHeartbeat(this.pipeline.id); } catch { /* best-effort */ }
    }, HEARTBEAT_INTERVAL_MS);
    this._heartbeatTimer.unref?.(); // never hold the process open
  }

  /** Stop heartbeating and drop ownership (terminal/paused). Safe to call repeatedly. */
  _stopHeartbeat() {
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    if (this.pipeline?.id) clearPipelineOwnership(this.pipeline.id);
  }

  /** Terminal bookkeeping for a pause: persist the resume point + paused status. */
  async _completePaused() {
    this._setStatus('paused');
    await this._persist();
    // A plain manual pause has no reason; only a limit-pause records one (audited
    // already at the pause site, so don't double-log it here).
    if (!this.pauseReason) await appendAudit(this.pipeline.dir, `Pipeline **paused**.`).catch(() => {});
    this._emit('done', { status: 'paused', pipelineDir: this.pipeline.dir, reason: this.pauseReason || null });
    return { status: 'paused', pipelineDir: this.pipeline.dir, reason: this.pauseReason || null };
  }
}

// ── module-level pure helpers ──────────────────────────────────────────────────

/** Round a USD amount to 4 decimals (tenth-of-a-cent) to avoid float drift. */
function roundUsd(n) {
  return Math.round((Number(n) || 0) * 1e4) / 1e4;
}

/**
 * Sum per-step costUsd into the pipeline total, rounded ONCE so the total is
 * exactly Σ steps (avoids the drift of independently rounding a separate running
 * total on every add). Absent/NaN step costs are ignored.
 * @param {Array<{costUsd?:number}>} steps
 * @returns {number}
 */
function sumStepCosts(steps) {
  let sum = 0;
  for (const s of Array.isArray(steps) ? steps : []) {
    if (Number.isFinite(s?.costUsd)) sum += s.costUsd;
  }
  return roundUsd(sum);
}

/**
 * Sum per-step active processing time (ms) into the pipeline total. Only the
 * FINALIZED activeMs is summed here; a still-running step's tail is added live
 * by consumers (liveActiveMs / the UI). Absent/NaN values are ignored. No
 * rounding (durations are integer ms).
 * @param {Array<{activeMs?:number}>} steps
 * @returns {number}
 */
function sumStepActive(steps) {
  let sum = 0;
  for (const s of Array.isArray(steps) ? steps : []) {
    if (Number.isFinite(s?.activeMs)) sum += s.activeMs;
  }
  return sum;
}

function isAbort(err) {
  return err && (err.name === 'AbortError' || /aborted|stopped/i.test(err.message || ''));
}

/** Pause sentinel: thrown to unwind an execution when pause() was requested. */
function pauseErr() {
  const e = new Error('paused');
  e.name = 'PauseError';
  return e;
}
function isPause(err) {
  return !!err && err.name === 'PauseError';
}

/** JSON round-trip clone; drops functions/undefined. Bus channels and resolved
 *  plan nodes are plain data, so this is lossless for them. */
function jsonClone(v) {
  return v == null ? null : JSON.parse(JSON.stringify(v));
}

/** Fail-safe JSON.parse for nullable DB text columns; null on absent/bad JSON. */
function safeParse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function firstLine(text) {
  if (!text) return '';
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.replace(/^#+\s*/, '').trim();
    if (t) return t;
  }
  return '';
}

function rel(base, p) {
  if (!p) return '';
  const b = resolve(base);
  const full = resolve(p);
  return full.startsWith(b + '/') ? full.slice(b.length + 1) : full;
}

/**
 * Describe the tool calls in a stream-json `assistant` event as readable
 * one-liners (e.g. `Read src/app.js`, `Bash npm test`). Returns [] for events
 * with no tool_use blocks — tool_result echoes, the system init event — so the
 * caller drops them instead of logging a contentless envelope type.
 */
// Max chars for the sub-agent label inside the "[role ▸ label]" tag. Deliberately
// shorter than toolTarget's 60-char Task clip: that 60 governs the parent's own
// "→ Task <desc>" debug line, which has a whole row to itself; this 40 governs the
// label embedded inside "[role ▸ label]", which shares a single flex row (web) and
// sits inline in the terminal, so it must stay compact. The two clips are
// independent on purpose — a long description may render at ≤60 on the parent line
// and ≤40 inside the child tag.
const SUBAGENT_LABEL_MAX = 40;

/**
 * Record id -> short description for every Task/Agent tool_use block in a
 * MAIN-agent event, so a sub-agent's later events (which carry that id as
 * parent_tool_use_id) can be labeled by the job they were given. Safe when
 * `raw` is a string (non-JSON runner line): raw?.message?.content is undefined.
 */
function registerSubAgents(raw, labels) {
  const content = raw?.message?.content;
  if (!Array.isArray(content)) return;
  for (const c of content) {
    if (c?.type === 'tool_use' && (c.name === 'Task' || c.name === 'Agent') && c.id && !labels.has(c.id)) {
      const desc = clip(c.input?.description || c.input?.prompt, SUBAGENT_LABEL_MAX);
      if (desc) labels.set(c.id, desc); // empty desc left unset → fallback assigns sub-agent-N
    }
  }
}

function describeToolUses(raw, projectDir) {
  const content = raw?.message?.content;
  if (!Array.isArray(content)) return [];
  const calls = [];
  for (const c of content) {
    if (c?.type === 'tool_use' && typeof c.name === 'string') {
      const target = toolTarget(c.name, c.input, projectDir);
      calls.push(target ? `${c.name} ${target}` : c.name);
    }
  }
  return calls;
}

/**
 * Describe tool_result blocks in a stream-json event as short outcome one-liners
 * (`result ok <id8>` / `result error <id8>`). Scans message.content for
 * {type:'tool_result', tool_use_id, is_error?}. Returns [] when `raw` is a string
 * (non-JSON runner line) or carries no tool_result blocks (assistant turns, the
 * init event), so the caller adds no line. The 8-char tool_use_id prefix matches
 * worca's contract and is enough to correlate a result with its call within one
 * turn. Mirrors describeToolUses: the `← ` arrow prefix is added by the caller.
 */
function describeToolResults(raw) {
  const content = raw?.message?.content;
  if (!Array.isArray(content)) return [];
  const lines = [];
  for (const b of content) {
    if (b?.type !== 'tool_result') continue;
    const id = typeof b.tool_use_id === 'string' ? b.tool_use_id.slice(0, 8) : '?';
    lines.push(`result ${b.is_error ? 'error' : 'ok'} ${id}`);
  }
  return lines;
}

/** A short, human-readable target for a tool call (file, command, pattern…). */
function toolTarget(name, input, projectDir) {
  if (!input || typeof input !== 'object') return '';
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return rel(projectDir, input.file_path || input.path || input.notebook_path || '');
    case 'Bash':
      return clip(input.command, 80);
    case 'Grep':
      return input.pattern
        ? `"${input.pattern}"${input.path ? ' ' + rel(projectDir, input.path) : ''}`
        : '';
    case 'Glob':
      return input.pattern || '';
    case 'Task':
    case 'Agent':
      return clip(input.description || input.prompt, 60);
    case 'WebFetch':
    case 'WebSearch':
      return clip(input.url || input.query, 60);
    default:
      return '';
  }
}

// ── Skill / MCP-tool capture (for the Sub-agents dropdown pills) ──────────────
// Pills surface ONLY named skills (the Skill tool) and MCP server tools
// (mcp__<server>__<tool>). Core file/bash/search/web tools and the sub-agent
// spawn tools (Task/Agent) are NOT skills. Labels are kind-tagged strings —
// "skill:<name>" / "mcp:<server>:<tool>" (or "mcp:<server>" when a name carries
// no tool token) — so the set dedups cleanly and the UI styles the kinds without
// a second field. Capped per agent, and the cap is SURFACED (see mergeSkills).
//
// §7.1: 64, raised from 24 because per-tool granularity multiplies distinct
// labels (one MCP server can contribute a dozen tools to one agent).
const SKILLS_MAX = 64;

/** The overflow SENTINEL that makes the cap visible instead of silent: an
 *  `overflow:<n>` entry rides inside the same V6 `skills` array (zero schema
 *  change; to storage it is one more opaque string) and the UI renders it as a
 *  muted `+N more` pill. Because it rides the array it re-enters mergeSkills as
 *  part of `existing` on every later merge, so the merge is sentinel-aware. */
const OVERFLOW_RE = /^overflow:(\d+)$/;

/** Display server token for an MCP tool name `mcp__<server>__<tool>`: strip a
 *  leading `plugin_`, then collapse consecutive duplicate words. */
function mcpServerLabel(name) {
  const parts = String(name).split('__');
  let server = (parts[1] || '').trim();
  if (!server) return '';
  server = server.replace(/^plugin_/, '');
  const words = server.split('_').filter(Boolean);
  const collapsed = words.filter((w, i) => w !== words[i - 1]); // playwright_playwright -> playwright
  return collapsed.join('_') || server;
}

/** Kind-tagged pill label for ONE tool_use block, or '' if it is not a skill /
 *  MCP tool. The Skill slug key is read defensively (the one stream-json detail
 *  not pinned by a fixture). */
function skillLabel(name, input) {
  if (typeof name !== 'string') return '';
  if (name === 'Skill') {
    const raw = input && typeof input === 'object'
      ? (input.skill ?? input.name ?? input.command ?? input.skill_name) : '';
    const slug = typeof raw === 'string' ? raw.trim() : '';
    return slug ? `skill:${slug}` : '';
  }
  if (name.startsWith('mcp__')) {
    // §7.1: keep the TOOL token — `mcp__<server>__<tool>` -> `mcp:<server>:<tool>`.
    // A tool token may itself contain `__`, so rejoin everything past the server
    // (`mcp__srv__deep__nested` -> tool `deep__nested`). §5.5's `__`-normalization
    // is what keeps the server segment unambiguous for every merged server.
    const server = mcpServerLabel(name);
    if (!server) return '';
    const tool = name.split('__').slice(2).join('__');
    return tool ? `mcp:${server}:${tool}` : `mcp:${server}`;  // legacy shape when no tool token
  }
  return ''; // Read/Write/Edit/Bash/Grep/Glob/Task/Agent/WebFetch/WebSearch/… excluded
}

/** All kind-tagged skill labels in ONE stream-json envelope (deduped within the
 *  turn, order-preserving). */
function extractSkillLabels(raw) {
  const content = raw?.message?.content;
  if (!Array.isArray(content)) return [];
  const out = [];
  const seen = new Set();
  for (const c of content) {
    if (c?.type !== 'tool_use') continue;
    const label = skillLabel(c.name, c.input);
    if (label && !seen.has(label)) { seen.add(label); out.push(label); }
  }
  return out;
}

// ── graphify CLI-invocation counter ──────────────────────────────────────────
// Counts how many times a Bash command INVOKES the `graphify` CLI, as opposed to
// merely mentioning the word (reading graphify-out/, grepping for "graphify", rm
// graphify-out). Match `graphify` only at a COMMAND position: string start, after a
// shell separator (; | & && || newline or subshell `(`), or after leading VAR=val
// env assignments — optionally path-prefixed (~/.local/bin/graphify) — and followed
// by whitespace or end-of-string, so `graphify-out` (next char `-`) never matches.
// Known gaps (rare; documented, not counted): `npx graphify`, `python -m graphify`,
// `sh -c "graphify …"` — graphify there is an argument, not the command word.
const GRAPHIFY_CMD_RE = /(?:^|[;&|\n(]|&&|\|\|)\s*(?:\w+=\S+\s+)*(?:[^\s;&|()]*\/)?graphify(?=\s|$)/g;

/** How many graphify CLI invocations the Bash tool_use blocks of ONE stream-json
 *  envelope contain (0 when none / not a tool turn). Pure + module-scoped. */
function countGraphifyBashCalls(raw) {
  const content = raw?.message?.content;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const c of content) {
    if (c?.type !== 'tool_use' || c.name !== 'Bash') continue;
    const cmd = c.input?.command;
    if (typeof cmd !== 'string') continue;
    const m = cmd.match(GRAPHIFY_CMD_RE);
    if (m) n += m.length;
  }
  return n;
}

/**
 * Union `incoming` into `existing` (order-preserving, deduped, capped) with the
 * §7.1 overflow-sentinel semantics, so the cap is a SURFACED truncation and not a
 * silent gap. Returns the NEW array when it grew, else null (caller skips
 * persist/emit — unchanged contract).
 *
 * 1. STRIP every `overflow:<n>` from `existing`, remembering the largest `n` as a
 *    monotonic floor. Sentinels arriving in `incoming` (a snapshot-rebuild merge
 *    of two persisted arrays) are likewise never labels: skipped in the union,
 *    their `n` folded into the same floor.
 * 2. UNION real labels, capping at SKILLS_MAX counting REAL labels only — the
 *    sentinel never consumes a cap slot. Count the DISTINCT incoming labels the
 *    cap rejected this merge.
 * 3. overflow = floor + rejected; when > 0 append EXACTLY ONE sentinel, LAST.
 * 4. "Grew" = more real labels than before, OR a larger overflow count.
 */
function mergeSkills(existing, incoming) {
  const inc = Array.isArray(incoming) ? incoming : [];
  if (!inc.length) return null;
  const base = Array.isArray(existing) ? existing : [];

  // (1) Strip `existing`'s sentinels; its largest n is the floor to carry forward.
  const real = [];
  let wasOverflow = 0;                       // what `existing` itself recorded (the growth baseline)
  for (const x of base) {
    const m = OVERFLOW_RE.exec(String(x));
    if (m) { wasOverflow = Math.max(wasOverflow, Number(m[1])); continue; }
    real.push(x);
  }
  let floor = wasOverflow;

  // (2) Union real labels; the cap counts real labels only.
  const seen = new Set(real);
  const rejected = new Set();
  const out = real.slice();
  for (const x of inc) {
    const m = OVERFLOW_RE.exec(String(x));
    if (m) { floor = Math.max(floor, Number(m[1])); continue; }   // a sentinel, never a label
    if (seen.has(x) || rejected.has(x)) continue;                 // dedup, incl. repeated rejects
    if (out.length >= SKILLS_MAX) { rejected.add(x); continue; }
    seen.add(x); out.push(x);
  }

  // (3) Exactly one sentinel, always last.
  const realAfter = out.length;
  const overflow = floor + rejected.size;
  if (overflow > 0) out.push(`overflow:${overflow}`);

  // (4) Growth is either a new real label or a risen overflow count.
  return (realAfter > real.length || overflow > wasOverflow) ? out : null;
}

/** Collapse whitespace and truncate to n chars with an ellipsis. */
function clip(text, n) {
  if (!text) return '';
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Normalize an answer payload from answer()/auto into [{id, choice}].
 * Accepts { answers:[{id,choice}] } or a bare array. Fills any missing
 * questions with their first option so downstream never sees gaps.
 */
function normalizeClarifyAnswer(payload, questions) {
  const arr = Array.isArray(payload?.answers)
    ? payload.answers
    : Array.isArray(payload)
      ? payload
      : [];
  const byId = new Map();
  for (const a of arr) {
    if (a && a.id != null) byId.set(String(a.id), String(a.choice ?? ''));
  }
  return (questions || []).map((q) => ({
    id: q.id,
    choice: byId.has(q.id)
      ? byId.get(q.id)
      : (q.options && q.options.find((o) => o && o.trim())) || '',
  }));
}

// ── Test-only surface ────────────────────────────────────────────────────────
// The R4 pill helpers are pure, module-private, and carry NORMATIVE semantics
// (§7.1's sentinel algebra). Most of it is reachable through _onAgentEvent, but
// the snapshot-rebuild shape — a sentinel arriving in `incoming` — has no live
// call site, so it is only assertable directly. Exported for tests ONLY; no
// production code imports this bag.
export const _testing = { SKILLS_MAX, skillLabel, mergeSkills };
