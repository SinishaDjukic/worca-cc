// src/core/run-harness.mjs
// The engine-agnostic run harness: everything a pipeline run needs regardless of
// which engine sequences the work — construction, the run()/resume() shells,
// run root + worktrees, guardrails, run context, cost limits, recovery, user
// asks, git checkpoints, results, the step ledger + clocks, logs, artifacts,
// events, persistence and the heartbeat.
//
// Engines subclass it and implement six hooks (bottom of the class):
// _resolveTopology, _engineRun, _enginePrePausePoint, _engineRehydrate,
// _bookend (implemented here), _initRunners (no-op here). The v1 engine is
// src/core/orchestrator.mjs (class Orchestrator extends RunHarness).
//
// It is an EventEmitter. Consumers (CLI, UI) subscribe to events and drive
// interaction via answer()/stop().

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, basename, resolve, sep, relative } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile, readdir, mkdir, realpath } from 'node:fs/promises';

import { generateTitle } from './title.mjs';
import {
  createPipeline, updatePipelineTitle, appendAudit, writeState, artifactPaths, slugify, today,
  recordArtifact, writeClarify, readPipelineExtras, claimPipelineOwnership, touchHeartbeat,
  clearPipelineOwnership, HEARTBEAT_INTERVAL_MS,
} from './artifacts.mjs';
import { diffNameStatus, diffNumstat, diffPatch } from './git-info.mjs';
import {
  assembleResults, persistResults, persistDiffPatch, buildPerProject, rollupSummary,
  retainedWorkPatchName,
} from './results.mjs';
import { resolveTaskInput, retryWriteback } from './sources.mjs';
import { projectKey, projectStorePath, workspaceStorePath } from './store.mjs';
import { worcaHome } from './projects.mjs';
import {
  runRootMode, getProjectsRoot,
  pipelineCostLimitUsd, totalCostLimitUsd, costLimitResetPeriod,
} from './settings.mjs';
import { readCostCapOverride, totalWindowSpendUsd, costWindowStart } from './cost-budget.mjs';
import {
  writeRunManifest, readRunManifest, updateRunManifest, rmGuarded, rescueModifiedMounts,
  scanStrayEntries, copyRunManifestTo, removeInjectedPaths, stripClaudeMdFence,
  RETAIN_REASONS,
} from './run-manifest.mjs';
import { assembleRunContext, renderContextAudit, MCP_GRANT_MODE } from './run-context.mjs';
import { createRunLogWriter, RUN_LOG_FILE, RUN_LOG_KIND } from './run-log.mjs';
import {
  detectTools, detectToolsPerProject, runGraphifyUpdate, worktreeGraphInstruction,
  probeClaudeCapabilities, explainUnspawnableClaude,
} from './preflight.mjs';
import { fanoutCap, mapWithCap } from './fanout.mjs';
import { resolveStepModels } from './config.mjs';
import { readGuardrailSet } from './guardrail-store.mjs';
import { unionGuardrails, guardrailsToPermissionRules, mergePermissionRules } from './guardrails.mjs';
import { collectRequiredSkills, validateSkills, injectSkills, pluginSkillDirs } from './skills.mjs';
import { loadAgentRegistry, DEFAULT_AGENTS_DIR } from './agent-registry.mjs';
import {
  createWorktree, removeWorktree, suggestBranchName, sanitizeBranchName, resolveDefaultBranch,
  isValidSourceRef, snapshotWorktreePatch,
} from './worktree.mjs';
import { readPluginsLock, pluginCurrentDir } from './plugins-lock.mjs'; // §9.4 disabled-plugin hint

// worca-cc repo root; holds skills/. fileURLToPath, never URL.pathname: the
// latter is `/C:/…` on Windows and %-encoded everywhere (see DEFAULT_AGENTS_DIR
// in agent-registry.mjs, which is the single source for the built-in agents dir).
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

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

/** Max auto-mode retries for a recoverable error before falling back to status error. */
const RECOVERY_MAX_AUTO_ATTEMPTS = (() => {
  const n = Number(process.env.WORCA_RECOVERY_MAX_ATTEMPTS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
})();

/**
 * `attr` marking a log line whose text came from a subprocess's stderr.
 *
 * ONE convention for every subprocess worca spawns — the agent CLI (framed
 * line-by-line by claude-runner), git (`_git`), and graphify. It records the
 * origin CHANNEL, never the severity: each call site keeps the level it already
 * had, because these git/graphify lines are worca's own summaries of a failure,
 * not raw stderr echoes. Frozen and shared: `_log` only reads from `attr`.
 */
export const ERR_STREAM = Object.freeze({ stream: 'err' });

/** The `: <stderr>` suffix for a failed subprocess result, or '' when it said
 *  nothing. runGraphifyUpdate already returns its child's stderr and the log
 *  line used to drop it — tagging a line as stderr-derived while discarding the
 *  stderr would make the tag a lie. Clipped: a build failure can be verbose. */
function errDetail(res, max = 200) {
  const text = (res?.stderr || '').trim().replace(/\s+/g, ' ');
  return text ? `: ${clip(text, max)}` : '';
}

/** attr for a log line whose text embeds subprocess output: ERR_STREAM only
 *  when the subprocess actually said something on stderr. A `|| 'exit N'`
 *  fallback carries no stderr bytes — tagging it would make the tag a lie
 *  (the same rule errDetail documents for the text itself). */
export function errStreamAttr(stderrText, extra = null) {
  if (!(stderrText && String(stderrText).trim())) return extra;
  return extra ? { ...extra, ...ERR_STREAM } : ERR_STREAM;
}

/** Round a USD amount to 4 decimals (tenth-of-a-cent) to avoid float drift. */
export function roundUsd(n) {
  return Math.round((Number(n) || 0) * 1e4) / 1e4;
}

/**
 * Sum per-step costUsd into the pipeline total, rounded ONCE so the total is
 * exactly Σ steps (avoids the drift of independently rounding a separate running
 * total on every add). Absent/NaN step costs are ignored.
 * @param {Array<{costUsd?:number}>} steps
 * @returns {number}
 */
export function sumStepCosts(steps) {
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
export function sumStepActive(steps) {
  let sum = 0;
  for (const s of Array.isArray(steps) ? steps : []) {
    if (Number.isFinite(s?.activeMs)) sum += s.activeMs;
  }
  return sum;
}

export function isAbort(err) {
  // NAME only. Every abort/stop throw in this codebase stamps name='AbortError'
  // (see stop()/_checkAbort/claude-runner); sniffing the message here also
  // matched real CLI failures containing "aborted"/"stopped" and swallowed
  // their terminal error line, recovery, and decomposed failure detection.
  return !!err && err.name === 'AbortError';
}

/** Pause sentinel: thrown to unwind _dispatch when pause() was requested. */
export function pauseErr() {
  const e = new Error('paused');
  e.name = 'PauseError';
  return e;
}

export function isPause(err) {
  return !!err && err.name === 'PauseError';
}

/** Fail-safe JSON.parse for nullable DB text columns; null on absent/bad JSON. */
function safeParse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function firstLine(text) {
  if (!text) return '';
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.replace(/^#+\s*/, '').trim();
    if (t) return t;
  }
  return '';
}

export function rel(base, p) {
  if (!p) return '';
  const b = resolve(base);
  const full = resolve(p);
  return full.startsWith(b + '/') ? full.slice(b.length + 1) : full;
}

/** Collapse whitespace and truncate to n chars with an ellipsis. */
export function clip(text, n) {
  if (!text) return '';
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export class RunHarness extends EventEmitter {
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
    // The mock runner routes EVERY dontAsk spawn to the Ask Worca mock (claude-runner.mjs
    // runMock, rule R-F), so a mock pipeline role under dontAsk writes no artifact and
    // the run dies at its first artifact read with no hint why. Fail at construction
    // instead (review of PR #376). WORCA_MOCK counts: the runner honours the env too.
    if (this.claude.permissionMode === 'dontAsk'
      && (this.claude.mock || /^(1|true|yes|on)$/i.test(String(process.env.WORCA_MOCK ?? process.env.ORCH_MOCK ?? '')))) {
      throw new Error('permissionMode "dontAsk" is reserved for the Ask Worca runner in mock mode — a mock pipeline role spawned with it would take the ask mock and write no artifact');
    }
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
    // Engine hook: the v1 runner registry (see Orchestrator._initRunners).
    this._initRunners(this.opts);

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
    this._pauseGate = null;                  // gate context snapshot when paused at a gate
    this._resumeNodeSessions = null;         // nodeId -> sessionId map, set by resume() (Task 5)
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
    this.registry = null; // ▲ v3: set in run(); used by _dispatch's D4 validation
    this.extrasFiles = []; // attached files copied into <pipeline>/extras (set in _dispatch)
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
      stepper: null, // UI stepper manifest, snapshotted at run start (Task 2)
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
   * pause-only signal), unwind _dispatch, persist a resume point. The worktree is
   * kept. Returns false unless the run is currently 'running'.
   */
  pause() {
    if (this.state.status !== 'running') return false;
    this.pauseRequested = true;
    this._setStatus('pausing');
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
      this.registry = registry; // ▲ v3: expose for run-start workflow validation (D4)
      // Engine hook: resolve the run topology. v1 = resolveWorkflow + workspace
      // fan-out forcing + the v1 stepper manifest; v2 = resolveGraph +
      // buildGraphManifest. It yields the manifest the UI renders, the agent-key
      // set the preflight and skills gates walk, and the workflow's id/name.
      const topology = await this._resolveTopology(registry);
      if (!topology?.manifest || !topology.agentKeys || !topology.workflow?.id) throw new Error('engine hook contract: _resolveTopology must return { manifest, agentKeys, workflow:{id,name} }');
      // §9.4: hard-fail BEFORE the stepper is STAMPED / createPipeline / worktree
      // (the manifest is built inside the hook, which tolerates unknown keys) —
      // a missing agent key must never reach dispatch as an empty-prompt node.
      this._preflightAgentKeys(topology.agentKeys);
      this.state.stepper = topology.manifest;
      this._emit('state', this.getState());

      // 1) Load agent prompts + preflight tool detection (parallel; both safe).
      this._bookend('preflight', 'start');
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
      this._bookend('preflight', 'done');
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
      const requiredSkills = collectRequiredSkills(this.registry, topology.agentKeys);
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
      await appendAudit(this.pipeline.dir, `Workflow: **${topology.workflow.name}** (${topology.workflow.id}).`);
      const dispatched = await this._engineRun({ resume: null });
      this._checkAbort();
      if (dispatched === 'paused') return await this._completePaused();

      // 9) Done.
      this._setStatus('done');
      this.state.resumePoint = null; // finished rows are not resumable (clears the boundary trail)
      this._bookend('done', 'done');
      await this._persist();
      await appendAudit(this.pipeline.dir, `Pipeline finished with status **done**.`);
      await this._buildResults();          // refs + worktree still live here
      await this._reportToSource();        // task-source write-back (never throws, spec §7.5)
      this._emit('done', { status: 'done', pipelineDir: this.pipeline.dir });
      return { status: 'done', pipelineDir: this.pipeline.dir };
    } catch (err) {
      if ((isPause(err) || this.state.status === 'pausing') && this.state.status !== 'stopped') {
        if (this.pipeline) {
          if (!this.state.resumePoint) {
            // Paused before the engine started (preflight/worktree): the engine
            // decides what a pre-dispatch resume point looks like.
            this.state.resumePoint = this._enginePrePausePoint();
          }
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
        // _dispatch assigned before stop won the race) alongside a torn-down worktree.
        this.state.resumePoint = null;
        if (this.pipeline) {
          await this._persist().catch(() => {});
          await appendAudit(this.pipeline.dir, `Pipeline **stopped**.`).catch(() => {});
          // The diff artifact must survive a non-done terminal path too: the work done
          // up to this point IS committed onto the kept feature branch by the teardown
          // in the finally below, so History has to be able to show it. Safe HERE and
          // only here — the checkpoint refs and the worktree are still live until that
          // teardown runs. Best-effort by construction (its own try/catch logs a warn
          // and never rethrows), and a no-op when the run stopped before any checkpoint
          // existed. The terminal `done` event is emitted AFTER it so the History row never
          // paints as "no diff captured" for the tick before the artifact lands.
          await this._buildResults({ stage: true });
          await this._reportToSource(); // statusToResult('stopped') -> 'failed' (design PR12: no longer success-only)
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
        // The diff artifact must survive a non-done terminal path too: the work done
        // up to this point IS committed onto the kept feature branch by the teardown
        // in the finally below, so History has to be able to show it. Safe HERE and
        // only here — the checkpoint refs and the worktree are still live until that
        // teardown runs. Best-effort by construction (its own try/catch logs a warn
        // and never rethrows), and a no-op when the run stopped before any checkpoint
        // existed. The terminal `done` event is emitted AFTER it so the History row never
        // paints as "no diff captured" for the tick before the artifact lands.
        await this._buildResults({ stage: true });
        await this._reportToSource(); // statusToResult('error') -> 'failed' (design PR12: no longer success-only)
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
    // Engine hook: rejects a resume point that is not this engine's, and yields
    // the engine-specific fields the shell below rehydrates from. It runs at dev's
    // version-gate position: before any state is rehydrated and OUTSIDE the try,
    // so a throw rejects resume() without touching the row. Awaited so an engine
    // may be async; v1's synchronous return is awaited unchanged.
    const rehydrated = await this._engineRehydrate(rp);
    if (!rehydrated || typeof rehydrated.audit !== 'string' || !Array.isArray(rehydrated.memberWorktrees)) throw new Error('engine hook contract: _engineRehydrate must return { checkpointRef, memberWorktrees:[], audit }');
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
            this.checkpointRefs[onlyKey] = rehydrated.checkpointRef;
            this.state.branches = { ...(this.state.branches || {}), [onlyKey]: { ...this.state.branch } };
            this.state.checkpointRefs = { ...this.checkpointRefs };
          }
        }
      }
      this.checkpointRef = rehydrated.checkpointRef;
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
        for (const p of rehydrated.memberWorktrees) {
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
      await appendAudit(this.pipeline.dir, rehydrated.audit);
      this._emit('state', this.getState());

      // ── §5.2 detached resume: idempotent re-assembly (self-healing) ──
      // Only when the RECORDED mode is 'detached', and NEVER with a resolvedSkills
      // variable — that path does not exist here: resume never runs
      // collectRequiredSkills/validateSkills (it loads registry + channelDefs +
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

      const dispatched = await this._engineRun({ resume: rp, rehydrated });
      this._checkAbort();
      if (dispatched === 'paused') return await this._completePaused();

      this._setStatus('done');
      this.state.resumePoint = null; // finished rows are not resumable (clears the boundary trail)
      this._bookend('done', 'done');
      await this._persist();
      await appendAudit(this.pipeline.dir, `Pipeline finished with status **done**.`);
      await this._buildResults();          // refs + worktree still live here
      await this._reportToSource();        // task-source write-back (never throws, spec §7.5)
      this._emit('done', { status: 'done', pipelineDir: this.pipeline.dir });
      return { status: 'done', pipelineDir: this.pipeline.dir };
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
          // The diff artifact must survive a non-done terminal path too: the work done
          // up to this point IS committed onto the kept feature branch by the teardown
          // in the finally below, so History has to be able to show it. Safe HERE and
          // only here — the checkpoint refs and the worktree are still live until that
          // teardown runs. Best-effort by construction (its own try/catch logs a warn
          // and never rethrows), and a no-op when the run stopped before any checkpoint
          // existed. The terminal `done` event is emitted AFTER it so the History row never
          // paints as "no diff captured" for the tick before the artifact lands.
          await this._buildResults({ stage: true });
          await this._reportToSource(); // statusToResult('stopped') -> 'failed' (design PR12: no longer success-only)
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
        // The diff artifact must survive a non-done terminal path too: the work done
        // up to this point IS committed onto the kept feature branch by the teardown
        // in the finally below, so History has to be able to show it. Safe HERE and
        // only here — the checkpoint refs and the worktree are still live until that
        // teardown runs. Best-effort by construction (its own try/catch logs a warn
        // and never rethrows), and a no-op when the run stopped before any checkpoint
        // existed. The terminal `done` event is emitted AFTER it so the History row never
        // paints as "no diff captured" for the tick before the artifact lands.
        await this._buildResults({ stage: true });
        await this._reportToSource(); // statusToResult('error') -> 'failed' (design PR12: no longer success-only)
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
    if (caps.version === null) {
      // No `claude --version` at all. The first node fails loudly anyway; when the
      // cause is the Windows npm shim, record the actionable reason NOW so the
      // run's warnings carry it instead of only a spawn ENOENT at the first node.
      const hint = explainUnspawnableClaude(this.claude.bin);
      if (hint) await this._recordRunWarning(hint);
    }
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
        `graphify build ${res.timedOut ? 'timed out' : 'failed'}; proceeding without graph grounding`
          + errDetail(res),
        errStreamAttr(res?.stderr),
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
        this._log('graph', 'warn',
          `graphify build for ${m.projectKey} ${res.timedOut ? 'timed out' : 'failed'}; degrading to source-reading`
            + errDetail(res),
          errStreamAttr(res?.stderr));
      }
    });
  }

  /**
   * Tear down the per-pipeline worktree (C1). Retention policy:
   *   - Remove the checkout and keep the feature branch after a successful (or
   *     unnecessary) commit. If git status/add/commit fails, retain the checkout
   *     so its uncommitted work remains recoverable.
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
    const commit = await this._commitWork(info);
    const retained = await this._recordCommitFailure(commit, { info, branchRecord: this.state.branch });
    if (retained) {
      await this._snapshotRetained(info);
      this.workDir = this.projectDir;
      await this._persist().catch(() => {});
      return;
    }
    // branch:null — the branch is always kept (done/error/stopped alike); only the
    // disposable checkout is removed.
    const res = await removeWorktree({
      projectDir: this.projectDir,
      worktreeDir: info.worktreeDir,
      branch: null,
      force: true,
    });
    for (const s of res.steps.filter((x) => !x.ok)) {
      this._log('worktree', 'warn', `teardown ${s.step} failed: ${s.stderr || 'unknown error'}`, errStreamAttr(s.stderr));
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
    await this._persist().catch(() => {});
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
    let anyRetained = false;
    for (const [projectKey_, info] of entries) {
      if (!info || !info.worktreeDir) continue;
      const branchRecord = (this.state.branches && this.state.branches[projectKey_]) || null;
      const commit = await this._commitWork(info, branchRecord);
      if (await this._recordCommitFailure(commit, { key: projectKey_, info, branchRecord })) {
        anyRetained = true;
        await this._snapshotRetained(info, projectKey_);
        this.workDirs.delete(projectKey_);
        continue;
      }
      const res = await removeWorktree({
        projectDir: resolve(this.memberByKey.get(projectKey_)?.projectDir || this.projectDir),
        worktreeDir: info.worktreeDir,
        branch: null, // always keep the branch
        force: true,
      });
      for (const s of res.steps.filter((x) => !x.ok)) {
        this._log('worktree', 'warn', `teardown ${projectKey_} ${s.step} failed: ${s.stderr || 'unknown error'}`, errStreamAttr(s.stderr));
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
    // Keep the scalar mirror coherent for late observers — but never claim a
    // retained checkout was removed (the detached twin guards the same way,
    // via !retainedMembers.length).
    if (this.state.branch && !anyRetained) {
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
    const retainedMembers = [];
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
      // Single-project rows persist state.branch; workspace rows persist the
      // per-member map inside workspace_meta. Updating state.branches for a
      // single run would be in-memory-only on the DB round trip.
      const branchRecord = this.isWorkspace
        ? ((this.state.branches && this.state.branches[key]) || null)
        : this.state.branch;
      const commit = await this._commitWork(
        info, branchRecord, { excludePathspecs: this._excludePathspecs(key) },
      );
      const retained = await this._recordCommitFailure(commit, { key, info, branchRecord });
      // (4) remove what worca-cc injected, so nothing can be committed dangling or
      // outlive the run root.
      await removeInjectedPaths(wt, injected);
      if (retained) {
        await this._snapshotRetained(info, key);
        retainedMembers.push({
          projectKey: key,
          worktreeDir: wt,
          branch: info.branch,
          step: commit.step,
          message: commit.message,
          at: branchRecord?.commitFailed?.at || new Date().toISOString(),
        });
        this.workDirs.delete(key);
        continue;
      }
      // (5) remove the checkout; the branch is always kept.
      const res = await removeWorktree({
        projectDir: resolve(this.memberByKey.get(key)?.projectDir || this.projectDir),
        worktreeDir: wt,
        branch: null,
        force: true,
      });
      for (const s of res.steps.filter((x) => !x.ok)) {
        this._log('worktree', 'warn', `teardown ${key} ${s.step} failed: ${s.stderr || 'unknown error'}`, errStreamAttr(s.stderr));
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
    if (this.state.branch && !retainedMembers.length) {
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
      // Persist the retention decision before copying the manifest. The copy is
      // the durable explanation after a normal teardown removes the run root.
      await updateRunManifest(this.runRoot, {
        retain: retainedMembers.length ? {
          reason: RETAIN_REASONS.COMMIT_FAILED,
          at: retainedMembers[0].at,
          members: retainedMembers,
        } : null,
      });
      // (8) §5.2 durable ledger: the run root is about to disappear.
      await copyRunManifestTo(this.runRoot, pipelineDir);
      // (9) guarded removal (§8.13).
      if (retainedMembers.length) {
        this._log('worktree', 'warn',
          `Run root retained at ${this.runRoot} because ${retainedMembers.length} worktree commit(s) failed.`);
      } else {
        const removal = await rmGuarded(this.runRoot, {
          worcaHome: worcaHome(), pipelineId: this.pipeline?.id,
        });
        if (removal.removed) {
          this._log('worktree', 'info', `Run root removed at ${this.runRoot}.`);
        } else {
          this._log('worktree', 'warn', `run root NOT removed: ${removal.reason}`);
        }
      }
    }
    await this._persist().catch(() => {});
  }

  /**
   * Append a warning to BOTH durable sinks (§5.2's ledger rules): the run log (which
   * survives teardown inside the pipeline artifact dir) and `run.json.warnings` (the
   * live manifest, copied out before removal). Never throws.
   */
  async _recordRunWarning(text, attr = null) {
    this._log('worktree', 'warn', text, attr);
    if (!this.runRoot) return;
    try {
      const cur = (await readRunManifest(this.runRoot)) || {};
      const warnings = Array.isArray(cur.warnings) ? cur.warnings : [];
      await updateRunManifest(this.runRoot, { warnings: [...warnings, text] });
    } catch { /* best-effort */ }
  }

  /**
   * Best-effort durable copy of the retained work, written the moment retention
   * is decided — a crash or manual deletion before an explicit discard must not
   * leave the checkout as the only copy. Failure (or a clean tree) keeps the
   * worktree as the source of truth (same failure class as the commit itself).
   */
  async _snapshotRetained(info, key = null) {
    const pipelineDir = this.pipeline?.dir;
    if (!pipelineDir || !info?.worktreeDir) return;
    const name = retainedWorkPatchName(this.isWorkspace ? key : null);
    const snap = await snapshotWorktreePatch(info.worktreeDir, join(pipelineDir, name));
    if (snap.ok && snap.file) {
      recordArtifact(this.pipeline.id, 'retained-work-patch', name);
      this._log('git', 'info', `Retained-work recovery patch saved: ${name}`);
    } else if (snap.ok) {
      this._log('git', 'info', 'Retained-work snapshot skipped: nothing uncommitted to save.');
    } else {
      this._log('git', 'warn',
        `retained-work patch not saved (git ${snap.step}: ${snap.message}); the worktree is the only copy`,
        snap.fromStderr ? ERR_STREAM : null);
    }
  }

  /**
   * Stamp a failed teardown commit on its persisted branch record and emit both
   * human-readable durable traces. Returns true when the caller must keep the
   * checkout containing the uncommitted work.
   */
  async _recordCommitFailure(result, { key = null, info, branchRecord } = {}) {
    if (result?.ok !== false) return false;
    const message = result.message || `git ${result.step || 'commit'} failed`;
    const record = {
      code: RETAIN_REASONS.COMMIT_FAILED,
      step: result.step,
      message,
      at: new Date().toISOString(),
    };
    let target = branchRecord;
    if (!target) {
      // Synthesize the record: retention must ALWAYS be visible to
      // retainedWorkFor/archive/discard, not only to a human reading warnings.
      // branchRecord came FROM state.branches[key] / state.branch, so a null one
      // means that slot is empty — this never overwrites a non-null record.
      target = { feature: info?.branch || null, worktreeDir: info?.worktreeDir || null };
      if (this.isWorkspace && key != null) {
        this.state.branches[key] = target;
      } else {
        this.state.branch = target;
      }
      await this._recordRunWarning(
        `${key ? `${key}: ` : ''}commit failed at git ${result.step} (${message}) with no branch record; ` +
        `synthesized one for the retained worktree at ${info?.worktreeDir || '(unknown)'}`,
        result.fromStderr ? ERR_STREAM : null,
      );
    }
    target.commitFailed = record;
    target.worktreeRemoved = false;
    target.branchKept = true;
    const prefix = key ? `${key}: ` : '';
    this._log('git', 'warn',
      `${prefix}commit failed at git ${result.step} (${message}) — KEEPING the worktree at ${info?.worktreeDir}`,
      result.fromStderr ? ERR_STREAM : null);
    if (this.pipeline) {
      await appendAudit(this.pipeline.dir,
        `Commit FAILED for \`${info?.branch || '(unknown)'}\` at git ${result.step}: ${message}. ` +
        `Worktree RETAINED at \`${info?.worktreeDir || '(unknown)'}\`.`).catch(() => {});
    }
    // Persist NOW. The callers' later _persist() is best-effort/swallowed; the
    // retention stamp must not ride on it (F2's crash window). _persist() also
    // swallows internally, so call the writer directly to observe a real failure.
    try {
      await writeState(this.pipeline?.dir ?? null, this.state);
    } catch (e) {
      this._log('git', 'error',
        `retention stamp could not be persisted (${e?.message || e}); ` +
        'the run.json retain record is the only durable copy');
    }
    return true;
  }

  /**
   * Commit every change in the worktree onto the feature branch so the kept
   * branch actually carries the agent's work after the worktree is removed.
   * Best-effort: never throws; returns a discriminated result. Skips
   * cleanly when the working tree is clean (no diff from the checkpoint), which
   * is the truthful "no change needed" outcome. Records the SHA on state.branch.
   * @param {{worktreeDir:string, branch:string}} info the branch being kept
   * @param {object} [branchRecord] the state branch object to stamp .commit onto
   *   (defaults to the scalar this.state.branch; a workspace member passes its own
   *   state.branches[projectKey] so per-member SHAs are recorded distinctly).
   * @param {{excludePathspecs?:string[]}} [opts] §8.8 exclusion set for this
   *   worktree. With the DEFAULT empty array — every legacy run — the method keeps
   *   today's bare `git add -A` byte-identically (§10 rollback contract).
   * @returns {Promise<{ok:true,committed:boolean,sha:string|null}|
   *                   {ok:false,step:'status'|'add'|'commit',message:string,fromStderr:boolean}>}
   *   `fromStderr` records whether `message` embeds real stderr bytes (vs. the
   *   `exit N` fallback), so the caller's warn can tag its provenance truthfully.
   */
  async _commitWork(info, branchRecord = this.state.branch, { excludePathspecs = [] } = {}) {
    const cwd = info?.worktreeDir;
    if (!cwd) return { ok: true, committed: false, sha: null };
    // ignoreAbort on every call: teardown runs after stop/error has aborted the
    // signal, so binding it would no-op these commands and lose the partial work.
    const gitOpts = { cwd, ignoreAbort: true };
    const status = await this._git(['status', '--porcelain'], gitOpts);
    if (!status.ok) {
      if (!existsSync(cwd)) {
        // The checkout is gone: there is no work to retain, and stamping
        // commitFailed would create an unclearable phantom retention (F15).
        this._log('git', 'warn', `commit skipped: worktree missing at ${cwd}`);
        return { ok: true, committed: false, sha: null };
      }
      const message = status.stderr.trim() || `exit ${status.code}`;
      this._log('git', 'warn', `commit skipped: git status failed: ${message}`, errStreamAttr(status.stderr));
      return { ok: false, step: 'status', message, fromStderr: !!status.stderr.trim() };
    }
    if (!status.stdout.trim()) {
      this._log('git', 'info', 'No changes to commit (working tree clean).');
      return { ok: true, committed: false, sha: null };
    }
    const add = excludePathspecs.length
      ? await this._git(['add', '-A', '--', '.', ...excludePathspecs], gitOpts)
      : await this._git(['add', '-A'], gitOpts);
    if (!add.ok) {
      const message = add.stderr.trim() || `exit ${add.code}`;
      this._log('git', 'warn', `commit skipped: git add failed: ${message}`, errStreamAttr(add.stderr));
      return { ok: false, step: 'add', message, fromStderr: !!add.stderr.trim() };
    }
    // §8.8 status recheck: with mounts present the porcelain gate above is never
    // clean, so a run whose agent changed nothing would attempt a commit that fails
    // with "nothing to commit". Re-check what actually got staged.
    if (excludePathspecs.length) {
      const staged = await this._git(['diff', '--cached', '--quiet'], gitOpts);
      if (staged.ok) {   // exit 0 => nothing staged
        this._log('git', 'info', 'No changes to commit (working tree clean).');
        return { ok: true, committed: false, sha: null };
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
      // the checkout right after a successful commit, so this commit is the ONLY thing
      // that carries the work onto the kept branch. A diff artifact does now survive
      // every terminal path (run()/resume() build results on stopped and error too),
      // but that is a read-only snapshot in the store — not a branch to check out,
      // rebase or push. Detached worktrees make hook failure MORE likely (§8.1:
      // husky/lint-staged resolve through an ancestor node_modules today and do not
      // detached). Retry ONCE with hooks disabled for that invocation only, logging
      // both facts.
      const hookErr = commit.stderr.trim() || `exit ${commit.code}`;
      this._log('git', 'warn', `commit failed with hooks enabled: ${hookErr}`, errStreamAttr(commit.stderr));
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
      const message = commit.stderr.trim() || `exit ${commit.code}`;
      this._log('git', 'warn', `commit failed: ${message}`, errStreamAttr(commit.stderr));
      return { ok: false, step: 'commit', message, fromStderr: !!commit.stderr.trim() };
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
    return { ok: true, committed: true, sha };
  }

  /**
   * §9.4 preflight gate: every workflow node key must resolve in the MERGED
   * registry (builtin+user+plugin) BEFORE any node executes. This deliberately
   * supersedes the silent empty-prompt degradation for ALL origins (it was a
   * bug, not a feature) — resolveWorkflow keeps `reg[key] || {}` for library
   * callers; runs are gated HERE, covering run() and resume(). The thrown plain
   * Error lands in the caller's catch => status 'error' + message; the
   * recoverable-error gate surfaces it cleanly.
   * @param {Iterable<string>} agentKeys the run's distinct agent keys, in launch order
   */
  _preflightAgentKeys(agentKeys) {
    const reg = this.registry || {};
    const missing = [];
    const seen = new Set();
    for (const key of agentKeys || []) {
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

  /** Step-boundary budget gate. Reads settings + DB FRESH each boundary so a
   *  raised limit or a window reset takes effect at the next step (F9). */
  _checkCostLimits() {
    if (!this.pipeline?.id) return;                    // pre-createPipeline: nothing to meter
    const pipeLimit = pipelineCostLimitUsd();
    // resume() rehydrates state.steps but not state.totalCostUsd, so the row
    // total reads $0 until the first cost event of the resumed run. Take the
    // larger of the two so a resumed over-cap pipeline cannot run one free step.
    const spentHere = Math.max(this.state.totalCostUsd || 0, sumStepCosts(this.state.steps));
    if (pipeLimit != null && spentHere >= pipeLimit
        && !readCostCapOverride(this.pipeline.id)) {
      this._pauseForCost('cost_pipeline',
        `pipeline cost limit reached ($${spentHere.toFixed(2)} >= $${pipeLimit.toFixed(2)})`);
    }
    const totalLimit = totalCostLimitUsd();
    if (totalLimit != null) {
      const period = costLimitResetPeriod();
      const spent = totalWindowSpendUsd(costWindowStart(new Date(), period).getTime());
      if (spent >= totalLimit) {
        this._pauseForCost('cost_total',
          `total cost limit reached ($${spent.toFixed(2)} >= $${totalLimit.toFixed(2)} this ${period === 'weekly' ? 'week' : 'month'})`);
      }
    }
  }

  /** Mirror of _pauseForLimit, but with a MACHINE-READABLE reason code
   *  ('cost_pipeline' | 'cost_total') the UI switches on. Unlike _pauseForLimit
   *  (whose caller throws), this throws itself — its caller is the boundary
   *  gate, not a catch block. The audit line here is required: _completePaused
   *  suppresses its generic audit whenever pauseReason is set. */
  _pauseForCost(code, detail) {
    if (!this.pauseReason) this.pauseReason = code;
    this._log('orchestrator', 'warn', `${detail} — pausing for manual resume`);
    appendAudit(this.pipeline.dir, `Pipeline **paused**: ${detail}.`).catch(() => {});
    this.pause();
    throw pauseErr();
  }

  /** Decide how to recover from a classified error. Auto mode: bounded backoff
   *  then give up (and abort immediately if a pause fired during backoff, so a
   *  pause is never followed by a wasted retry). Interactive: ONE shared prompt
   *  per error class (same-class siblings await the same answer), and distinct
   *  classes are serialized so only one recovery prompt is open at a time (the
   *  gate holds a single pendingQuestion). Returns 'retry' | 'abort'. */
  async _recover({ node, cls, err, attempt }) {
    this._log(node.key, 'warn', `recoverable ${cls} error: ${err.message}`, err?.stream ? ERR_STREAM : null);
    await appendAudit(this.pipeline.dir, `Recoverable **${cls}** error on ${node.key}: ${firstLine(err.message)}`).catch(() => {});

    if (this.auto) {
      if (attempt > RECOVERY_MAX_AUTO_ATTEMPTS) return 'abort';
      await this._backoff(attempt, this.pauseAbort.signal);
      // A pause during backoff must win: abort instead of retrying. The loop's
      // outer catch then re-classifies the thrown error under pauseRequested and
      // unwinds as a pause (the pauseAbort signal is aborted).
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

  /** Open a recovery prompt for one class, serialized behind any in-flight
   *  recovery prompt (the question gate has a single pendingQuestion slot, so
   *  distinct classes must queue — see the clarify answer). Returns 'retry'|'abort'. */
  _enqueueRecoveryPrompt(cls, message) {
    const run = () =>
      this._ask({
        id: `recovery-${cls}-${this._recoveryNonce()}`,
        kind: 'recovery',
        recovery: { cls, message },
      }).then((ans) => (ans && ans.decision === 'abort' ? 'abort' : 'retry'));
    return this._enqueueAsk(run);
  }

  /** Serialize an _ask-producing thunk behind any in-flight prompt (the gate
   *  holds a single pendingQuestion slot; recovery AND step questions share
   *  this tail so parallel nodes can never clobber each other's prompt). */
  _enqueueAsk(run) {
    const prev = this._askTail || Promise.resolve();
    const next = prev.then(run, run);
    this._askTail = next.catch(() => {}); // tail must never reject the chain
    return next;
  }

  /** Abort-aware backoff: base * 2^(attempt-1) ms, resolving early (and still
   *  'retry') if the pause-only signal fires so a pause is not delayed. */
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

  /** Monotonic id source for recovery prompts (no Date.now/random — replay-safe). */
  _recoveryNonce() {
    return ++this._recoverySeq;
  }

  /**
   * Build the read-only `workspace` metadata channel handle (the bus value for the
   * workspace channel): the frozen description + the member set with each member's
   * worktree dir, checkpoint ref, and per-project graph instruction. Seeded once by
   * _dispatch and never re-published (CONV-6). Members are in sorted-projectKey order.
   */
  _workspaceChannel() {
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

  /**
   * Emit a question and await its resolution. Honors auto-mode.
   * Freezes the active-time clock while blocked on the user (active-time-only).
   * @returns {Promise<any>} the answer payload
   */
  async _ask({ id, kind, questions, issues, recovery, agent, nodeId }) {
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

    this._emit('question', { id, kind, questions, issues, recovery, agent, nodeId });

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
        this._log('git', 'warn', `initial commit failed: ${commit.stderr.trim()}`, errStreamAttr(commit.stderr));
      }
    }
    const ref = await this._git(['rev-parse', 'HEAD'], { cwd: dir });
    return ref.ok ? ref.stdout.trim() : null;
  }

  /**
   * Layer 1: build + persist the deterministic results view while the worktree(s)
   * and checkpoint refs are still live. Best-effort: never throws into run().
   */
  async _buildResults({ stage = false } = {}) {
    if (!this.pipeline) return;
    try {
      // stage: the non-done terminal paths never reached the review loop's staging
      // (:2204, :2311), so `git add -A -N` has not run and the `git diff <checkpoint>`
      // below cannot see a file the agent CREATED — the kept branch would carry it
      // while the persisted patch showed nothing. ignoreAbort for the same reason
      // _commitWork pins it (:1804): stop() has already tripped this.abort, and a
      // bound signal kills the staging before git can touch the index.
      // INSIDE the try: the stopped path calls _buildResults from run()'s catch, so
      // anything that escaped here would reject run() itself.
      if (stage) await this._stageWorkingTree({ ignoreAbort: true });
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
        patches.push({ key, patch, listed: ns.length > 0 });
      }
      if (!members.length) return;
      // Nothing changed under the checkpoint. Persisting here would index a 0-byte
      // diff-patch.patch plus an all-zero results.json, and every downstream
      // "does this run have a diff?" test is an EXISTENCE test, not an emptiness
      // one: /diff answers 200-empty instead of 404 (ui/server.mjs:1994 tests
      // `text == null`), /recovery-patch serves an empty attachment (:1690), the
      // comments routes report patchAvailable:false and then 409 every create (:1882),
      // and History detail opens on the Diff tab to render "(no files changed)"
      // (app.js:11110 tests `d.results`). Write nothing — absent IS the truth, and
      // it is the state the UI's empty state already describes.
      const noPatch = patches.every((p) => !p.patch);
      // An EMPTY patch while name-status lists changes is a failed `git diff`
      // spawn (diffPatch returns '' on error), not a clean tree — say so, and
      // still persist the results the other two diffs produced.
      const listed = patches.some((p) => p.listed);
      if (noPatch && listed) this._log('results', 'warn', 'diff patch is empty although name-status lists changes — git diff failed; results.json is persisted without a patch');
      // Stopped/error paths (`stage`) with nothing changed write nothing — absent IS
      // the truth (above). The DONE path always persists results.json: it carries
      // the review-derived keyThingsToCheck/blockingIssues that the task-source
      // write-back (sources.mjs) and History read, so a review-only / plan-only /
      // no-op run must not lose them (review of PR #376). The 0-byte
      // diff-patch.patch is still never written on any path.
      if (noPatch && stage && !listed) return;
      if (members.length === 1 && !this.isWorkspace) {
        await persistResults(this.pipeline.dir, members[0].results);
        if (!noPatch) await persistDiffPatch(this.pipeline.dir, patches[0].patch);
      } else {
        const perProject = buildPerProject(members);
        const results = { summary: rollupSummary(perProject), perProject };
        await persistResults(this.pipeline.dir, results);
        if (!noPatch) await persistDiffPatch(this.pipeline.dir, patches.map((p) => `# ${p.key}\n${p.patch}`).join('\n\n'));
      }
    } catch (err) {
      this._log('results', 'warn', `results build failed: ${err.message}`);
    }
  }

  /**
   * Task-source write-back (spec §7.5): report the finished run to the plugin
   * source that produced it. Runs on EVERY terminal path and ALWAYS after
   * _buildResults() — done (statusToResult -> 'completed') and stopped/error alike
   * (-> 'failed'; chat-connectivity design PR12 closed the old success-only gap).
   * So the payload is the same SHAPE on all three: retryWriteback reads
   * results.json (sources.mjs:215), and a stopped/error run that persisted one now
   * carries the diffstat and "Key things to check" lines too. Only a run with
   * nothing to persist — no checkpoint, or an empty diff under it — falls back to
   * the thin status-only summary. NEVER throws and
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
   * `ignoreAbort` is for the terminal-path callers only (_buildResults on stop /
   * error): every in-run caller must stay killable by stop().
   * @param {{ignoreAbort?:boolean}} [opts]
   */
  async _stageWorkingTree({ ignoreAbort = false } = {}) {
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
      const res = await this._git(args, { cwd: dir, ignoreAbort });
      if (!res.ok && res.stderr && res.stderr.trim()) {
        this._log('git', 'debug', `git add -A -N (${dir}): ${res.stderr.trim()}`, ERR_STREAM);
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

  /** Bulk-load every registry agent's .md body keyed by agent key (fallback layer
   *  for runners whose ctx has no node, e.g. the clarify pre-step; dispatched nodes
   *  prefer node.agentPrompt via phases.resolveAgentBody). Registry-driven: built-in
   *  AND user agents load from their own layer via meta.agentPath. */
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

  async _writeClarifyAnswers(questions, answers) {
    // M1: clarify answers live ONLY in the clarify DB row (the authoritative store).
    // The dead FS clarify-answers.json (never read back; the single-round loop passes
    // prior answers in-memory) is gone. Enrich each answer with its question text so
    // the row + History UI render the full Q&A without a join.
    const byId = new Map(questions.map((q) => [q.id, q]));
    const enriched = answers.map((a) => ({
      id: a.id,
      question: byId.get(a.id)?.question || '',
      choice: a.choice,
    }));
    await writeClarify(this.pipeline.id, { answers: { answers: enriched } });
    return enriched;
  }

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
      if (attr.stepIndex != null) evt.stepIndex = attr.stepIndex;
      if (attr.cycle != null) evt.cycle = attr.cycle;
      if (attr.sub) evt.sub = true;        // drives sub-agent web styling
      // Origin channel of the text: 'err' when it came from a subprocess's
      // stderr (agent CLI, git, graphify). Provenance, not severity — the level
      // says how bad it is, this says where it came from.
      if (attr.stream) evt.stream = attr.stream;
    }
    this._emit('log', evt);
    this.logWriter.push(evt); // persist the full stream (buffered; flushed on a timer)
  }

  _artifact(kind, path) {
    this._emit('artifact', { kind, path });
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

  // ── engine hooks ─────────────────────────────────────────────────────────────
  // The harness is engine-agnostic; everything an engine decides sits behind
  // these six seams. The base throws so a half-built engine fails loudly at the
  // seam instead of running a half-configured pipeline.

  /** Resolve the run's topology from the merged registry.
   *  @param {Record<string,object>} _registry loadAgentRegistry() output
   *  @returns {Promise<{manifest:object, agentKeys:Set<string>, workflow:{id:string,name:string}}>}
   *  All three fields are REQUIRED; the shell throws a named 'engine hook
   *  contract' error when one is missing. manifest -> state.stepper (the UI
   *  snapshot); agentKeys -> the §9.4 preflight gate + the skills gate;
   *  workflow -> the run's audit line. */
  async _resolveTopology(_registry) { throw new Error('engine hook not implemented: _resolveTopology'); }

  /** Run the pipeline to completion or to a pause.
   *  @param {{resume?:object|null, rehydrated?:object|null}} _args resume point + _engineRehydrate's bag
   *  @returns {Promise<'done'|'paused'>} */
  async _engineRun(_args) { throw new Error('engine hook not implemented: _engineRun'); }

  /** The resume point recorded when a pause unwinds BEFORE the engine started
   *  (preflight/worktree). @returns {object} */
  _enginePrePausePoint() { throw new Error('engine hook not implemented: _enginePrePausePoint'); }

  /** Read the engine-specific parts of a resume point; throws when the point is
   *  not this engine's. Called at the position of dev's version gate: BEFORE the
   *  shell has rehydrated any state (state.*, pipeline, logWriter, stepModels,
   *  workflowId, guardrails are NOT restored yet) and OUTSIDE the shell's try —
   *  a throw here rejects resume() without touching the row. Keep it pure: read
   *  rp, decide whether the point is yours, return the bag. Engine restoration
   *  that needs state/registry/pipeline (manifest adoption, prompt hydration,
   *  the §9.4 re-preflight) belongs in _engineRun({resume, rehydrated}), which
   *  runs inside the try after everything is restored — exactly where v1 does
   *  its re-preflight. May be async: the shell awaits this call.
   *  @param {object} _rp
   *  @returns {{checkpointRef:string|null,
   *             memberWorktrees:Array<{projectKey:string, worktreeDir:string, graphInstruction:string}>,
   *             plan?:object|null, audit:string}} audit is REQUIRED — the shell
   *  writes it verbatim as the resume audit line. */
  _engineRehydrate(_rp) { throw new Error('engine hook not implemented: _engineRehydrate'); }

  /** Framework bookend markers ('preflight' | 'done'). Emitted by the base for
   *  EVERY engine, so both engines bracket their runs identically. P8 turns
   *  these into `exec` rows. */
  _bookend(name, status) {
    this._phase(name, 0, status);
  }

  /** Constructor seam for the v1 runner registry (v1 only; the graph engine
   *  injects its runners through the executor). Called from the constructor at
   *  the exact position the assignment had. */
  _initRunners(_opts) { /* base: no runner registry */ }
}
