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
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, basename, dirname, resolve, sep, relative } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile, copyFile, readdir, mkdir, realpath, rename, stat, rm } from 'node:fs/promises';

import { generateTitle } from './title.mjs';
import {
  createPipeline, updatePipelineTitle, appendAudit, writeState, artifactPaths, slugify, today,
  recordArtifact, writeClarify, readPipelineExtras, claimPipelineOwnership, touchHeartbeat,
  clearPipelineOwnership, HEARTBEAT_INTERVAL_MS, upsertSubAgent, listRunArtifacts, pipelineRowStamp,
  claimPausedForStop, claimForResume, findPipelineRowById, readPipelineForResume,
} from './artifacts.mjs';
import { diffNameStatus, diffNumstat, diffPatch, untrackedFiles, untrackedPatch } from './git-info.mjs';
import { clearStaleGitLocks, staleGitLockNote } from './git-lock.mjs';
import { claimPipelineCommand, discardPendingPipelineCommands, controlCheckIntervalMs } from './pipeline-commands.mjs';
import {
  assembleResults, persistResults, persistDiffPatch, buildPerProject, rollupSummary,
  retainedWorkPatchName, sizeOfChange,
} from './results.mjs';
import { resolveTaskInput, retryWriteback, sourcePlaceholderTitle, ticketRunTitle } from './sources.mjs';
import { projectKey, projectStorePath, workspaceStorePath, noProjectWorkDir, isNoProjectWorkDir } from './store.mjs';
import { NO_PROJECT_KEY, NO_PROJECT_NAME, NO_PROJECT_ERRORS, WORK_DIR_NAME, isNoProjectKey } from '../shared/no-project.mjs';
import { harvestWork, ownWorkDir, WORK_ARTIFACT_KIND } from './no-project-work.mjs';
import { appendDirection, readDirections, pendingDirections, DIRECTIONS_FILE, DIRECTIONS_KIND, DIRECTIONS_CLOSED } from './directions.mjs';
import { worcaHome, getProjectByPath, enclosingRepoOf, nestedInRepoMessage, worcaNestedRepoOf, worcaNestedRepoHint } from './projects.mjs';
import { normalizeWorkMode, workModeOfRow, folderFiles, CHANGES_FILE, CHANGES_PATCH_FILE } from './project-kind.mjs';
import { folderMemberFiles } from './folder-members.mjs';
import {
  copyFolder, writeFolderManifest, readFolderManifest, manifestHas, scanChanges, buildChangesPatch,
  writeChangesFiles, readChangesFile, sizeLabel, folderCopyRoot,
} from './folder-copy.mjs';
import {
  runRootMode, getProjectsRoot, projectsRootSource,
  pipelineCostLimitUsd, totalCostLimitUsd, costLimitResetPeriod,
  memoryCaps,
} from './settings.mjs';
import { hasProjectSetting, utilityModelFor, resolveSetting } from './settings-cascade.mjs';
import { withRole, roleModelFor, jobSlot } from './model-roles.mjs';
import { secretPathsFor } from './secret-paths.mjs';
import { mountDirs, mountMemory, refreshMount, syncBack, memoryTotals, validateMemoryScope, withStoreLock, memoryRulesPath, memoryWorkPath, MEMORY_RULES_REL, MEMORY_INJECTED_ENTRY } from './memory-sync.mjs';
import { createUsageTally, drainMemoryLoads, memoryLoadLogPath, noteOfMemoryRel, recordMemoryUsage, rulesHaveScopedNote } from './memory-usage.mjs';
import { memoryRoot, listMemory, renderMemoryBlock, bumpScopeState, readScopeState, memoryScopeReport, renderDefragBrief, SANDBOX_SOURCE_PREFIX, isHeldSource } from './memory-store.mjs';
import { isTeamMemoryOn, refreshTeamLayerWithin, mountTeamLayer, queueTeamChanges, teamChangesFromSync, teamClientText, memoryLoadPlans, loadFilteredDirs } from './memory-team.mjs';
import { readCostCapOverride, totalWindowSpendUsd, costWindowStart, recordCostDelta } from './cost-budget.mjs';
import {
  writeRunManifest, readRunManifest, updateRunManifest, rmGuarded, rescueModifiedMounts,
  scanStrayEntries, copyRunManifestTo, removeInjectedPaths, stripClaudeMdFence,
  RETAIN_REASONS, removeRunMcpConfig,
} from './run-manifest.mjs';
import { assembleRunContext, renderContextAudit, renderSkillAudit, MCP_GRANT_MODE, discoverProjectSettings, skillsRelFor, realDirsBelow } from './run-context.mjs';
import { createRunLogWriter, RUN_LOG_FILE, RUN_LOG_KIND } from './run-log.mjs';
import { createTelemetryRecorder, TELEMETRY_FILE } from './telemetry/recorder.mjs';
import { dbPath } from './db.mjs';
import {
  detectTools, detectToolsPerProject, runGraphifyUpdate, worktreeGraphInstruction,
  probeClaudeCapabilities, explainUnspawnableClaude,
} from './preflight.mjs';
import { fanoutCap, mapWithCap } from './fanout.mjs';
import { modelPricedOn, costCapRefusal } from './pricing.mjs';
import { resolveStepModels, observeModelCost, resolveModelCost, modelCostConfig, readTeamMetricsPrefs, modelHasBaseUrlRouting, bridgedModelInfo, catalogHasModel, engineOfModel, enginesOfModel, modelRunsOn, modelConnection, foreignRunModel, modelForEngine, listModels, liveCostRates, estimateCost } from './config.mjs';
import { getEngine, selectRunEngine, CAPABILITY_FALLBACKS, describeUnattachableMcp, ruleSupport, subagentPolicy } from './engines/index.mjs';
import { bridgeCallsFor, bridgeCostFor, forgetBridgeTag } from './bridge/telemetry.mjs';
import { readGuardrailSet, defaultGuardrailSetId } from './guardrail-store.mjs';
import { unionGuardrails, guardrailsToPermissionRules, mergePermissionRules } from './guardrails.mjs';
import { collectRequiredSkills, validateSkills, injectSkills, pluginSkillDirs, pluginAssetDirs } from './skills.mjs';
import { isBrowsableKind, BULK_ARTIFACT_THRESHOLD } from '../shared/artifact-kinds.mjs';
import { RUN_SWITCH_OPTIONS, awayAnswerCounts } from '../shared/away-mode/labels.mjs';
import { collectRequiredAssets, stageAssets } from './run-assets.mjs';
import { loadAgentRegistry, DEFAULT_AGENTS_DIR } from './agent-registry.mjs';
import {
  createWorktree, removeWorktree, suggestBranchName, sanitizeBranchName, resolveDefaultBranch,
  isValidSourceRef, snapshotWorktreePatch, listLocalBranches, worktreeHead, deleteBranchIfAt,
  reusedBranchBase, isAncestor,
} from './worktree.mjs';
import { deriveBranchName, uniqueBranch } from './naming.mjs';
import { flagEnabled } from './flags.mjs';
import { syncBaseForRun, ensureLocalBranch, fetchRemote, fastForwardTo, isSafeBranchName, runSyncOptions, INTERACTIVE_TIMEOUT_MS, mergeBaseBeforeRun, baseMovedAudit } from './git-sync.mjs';
import { featureBase } from './shape/features.mjs';
import { cleanOutcome } from './shape/rounds.mjs';
import { SYNC_EXECUTION_ID } from '../shared/graph/constants.mjs';
import { readPluginsLock, pluginCurrentDir } from './plugins-lock.mjs'; // §9.4 disabled-plugin hint
import { classifyError, rateLimitHint, brokerHint, freeDailyHint, limitResetAt, untilText } from './recoverable-error.mjs';
import { CODEX_DEFAULT_MODEL, CODEX_COMMAND_RULE_REACH } from './engines/codex.mjs';
import { ENGINE_PROJECT_FILES, ALL_PROJECT_FILES, worcaOwnsProjectFile, excludeLine } from './engines/project-files.mjs';
import { helperEngineFor } from './model-env.mjs';
import { hasCodexEndpoint } from './engines/codex-endpoint.mjs';
import { resolveModelRoute } from './exec-env/credentials.mjs';
import { hostGuardEnabled } from './host-guard.mjs';
import { isNormalized } from './engines/events.mjs';
import { createClaudeNormalizer } from './engines/claude-events.mjs';
import { cachedFreeDailyCounts } from './openrouter-free.mjs';
import { withBillTo, currentBillTo } from './billing.mjs';
import { claimRunDir } from './agent-pool.mjs';
import { brokerEnabled, brokerEngineRefusal, brokerInfo, personSlots } from './broker-client.mjs';
import { mockEnabled } from './claude-runner.mjs';
import { selectExecEnv, getExecBackend, ExecEnvLostError, ExecEnvSyncError, LOST_HINT } from './exec-env/index.mjs';
import { instanceTag, remotePreflight } from './exec-env/policy.mjs';
import { RemoteExecEnv, SCRIPT_SUPPORT_FILES } from './exec-env/remote-env.mjs';
import { acquireSandboxSlot } from './exec-env/slots.mjs';
import { priceRelayUsage, relayUsageTotal } from './exec-env/relay-usage.mjs';
import { resolveRunEnvironment } from './exec-env/project-env.mjs';
import { execEnvLimit } from './settings.mjs';
import { modelSlot, manifestModels, manifestNeedsModel, missingCredentials, describeMissing } from './broker-routing.mjs';
import { syncPluginSlots } from './plugin-broker-slots.mjs';
import { recoveryDelayMs, sleepAbortable } from './recovery-backoff.mjs';
import {
  resolveFailure, isTerminal, markTerminal, answerFromDecision,
  REASON, pauseConsequences, describePauseReason, RECOVERY_MAX_AUTO_ATTEMPTS,
} from './failure-policy.mjs';
import { recordRunMetrics } from './metrics/record.mjs';
// Team policy (team-policy design §6–§7): the document a run's cost gates fold in, its
// per-run state, and the off-policy findings the run log names at start.
import { resolveProjectPolicy, resolveWorkspacePolicy } from './policy/sync.mjs';
import { teamRunDiscover } from './git-free/team-repo.mjs';
import { fieldsForRun, effectiveCap, deviationsFor, mcpDeviations } from './policy/effective.mjs';
import { overlayStepModels } from './run-overlay.mjs';
import { writePolicyState, hasPipelineOverride, readTotalAck } from './policy/state.mjs';
import { installedPluginsMap, WORCA_VERSION as POLICY_WORCA_VERSION } from './policy/local.mjs';
import { readSettings as readRawSettings, userTagDimensions } from './settings.mjs';
import { readRunTags } from './run-tags-store.mjs';
import { missingRequired } from '../shared/tag-dimensions.mjs';
import { byActor } from './identity.mjs';
import { isWorkspaceScanWorkflow, WORKSPACE_RESYNTH_WORKFLOW_ID, MEMORY_DEFRAG_WORKFLOW_ID, AUTO_WORKFLOW_ID } from './graph/builtin-workflows.mjs';
import { agentIdentity } from './agent-user.mjs';
import { resolveRegistry, requiredOf, toolNameLimitFor, skipReasonText, cachedTeamFor } from './mcp/registry.mjs';
import { loadCatalog } from './mcp/catalog.mjs';
import { MCP_STARTUP_MS } from './mcp/timeouts.mjs';
import { keepListNames } from './mcp/keep-list.mjs';
import { expandMcpDenyRules } from './mcp/deny.mjs';
import { resolveSkillRegistry, requiredSkillsOf, SKILL_CAP } from './skills-registry/resolve.mjs';
import { materializeSkillMount } from './skills-registry/mount.mjs';
import { skillHostFacts } from './skills-registry/host.mjs';
import { SKILL_PROBLEM_REASONS, skillSkipMessage, skillSkipReasonText, skillLayerText, skillHooksIgnoredText } from './skills-registry/texts.mjs';
import { skillMdFields } from './skills-registry/inspect.mjs';
// Skills registry P5 adds `skillDeviations` (policy/effective.mjs); read through the namespace so this module loads
// without it (no Team-skill deviations until P5 lands).
import * as policyEffective from './policy/effective.mjs';
import { createRedactor } from './redact.mjs';
import { finalizeWorkspaceScan, WORKSPACE_GRAPH_FILE } from './workspace-scan-run.mjs';
import { readWorkspaceMap, resynthBlocker } from './workspaces.mjs';
import { STORED_MAP_FILE } from './workspace-map/join.mjs';
import { redactSecrets } from '../shared/workspace-map/redact.mjs';
// Night mode (src/core/night/*): a decider answers the open question while the user is away.
import { effectiveNightConfig } from './night/effective.mjs';
import { nightState, decideDelayMs, nightAnchorMs, runAllowed } from './night/activation.mjs';
import { decideAsk } from './night/decider.mjs';
import { PLAN_ASK_KIND, initialShaping } from './shape/run.mjs';
import { runNightAnalysis, readMemoryText } from './night/analysis.mjs';
import { resolveDeciderPair } from './night/decider-model.mjs';
import { writeNightDecision, countNightDecisions, nightCounts, nightGateCycles, nightSpendSinceUsd } from './night/store.mjs';
import { NIGHT_ACTOR, NIGHT_TOGGLES, nightNeverDecides } from './night/config.mjs';
import { nightModeToggleFor, nightModeHereSinceFor, personAwayStatus, awayPerPerson, awayPersonKey, effectiveNetworkWait } from './settings.mjs';
import { probeTargetForModel, probeReachable, hostOf } from './upstream-probe.mjs';
import { waitForNetwork, NETWORK_ACTOR } from './network-wait.mjs';
import { MCP_TOOL_NAME_400_RE, MCP_TOOL_NAME_TOO_LONG } from '../shared/mcp-tool-name.mjs';
import { usageLimitSwitches, engineList, engineLabel, engineEntry, NATIVE_NOTICE, DEFAULT_ENGINE } from '../shared/engine-switch.mjs';
import { childEnv, formatDropped } from './spawn.mjs';
import { detectDeployment } from './deployment.mjs';
import { effortOn, runsOn, connectionLabel } from '../shared/connections.mjs';
import { readyEnginesCached } from './engines/ready-cache.mjs';
import { shapeRecordFrom, buildShapeStats } from './shape/stats.mjs';
import { gitAvailable, gitMissingResult } from './git-available.mjs';
import { guardedGitEnv } from './git-guard.mjs';
import { stripHostCredentials } from './host-credentials.mjs';

// worca-cc repo root; holds skills/. fileURLToPath, never URL.pathname: the
// latter is `/C:/…` on Windows and %-encoded everywhere (see DEFAULT_AGENTS_DIR
// in agent-registry.mjs, which is the single source for the built-in agents dir).
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** "14:05" in local time, for log and prompt text. */
const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);

/** The disabled plugin that ships `<subdir>/<key>.meta.json`, or null. Shared by the
 *  agent preflight (`agents`) and the orchestrator's script preflight (`scripts`). */
export function findDisabledPluginFor(key, subdir = 'agents') {
  try {
    const lock = readPluginsLock();
    for (const name of Object.keys(lock).sort()) {
      if (!lock[name] || lock[name].enabled !== false) continue;
      const dir = join(pluginCurrentDir(name), subdir);
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

/** The engine gate's refusal (RunHarness#_engineGate): a plain error, no recovery class.
 *  `engineRefused` lets engineStartRefusal tell a preflight refusal from any other error. */
function engineRefusal(name, why) {
  return Object.assign(new Error(`engine ${name}: ${why}`), { errorClass: null, engineRefused: true });
}

/** A rule list for a log line: the first three rules, then how many more. */
function ruleList(rules) {
  const all = Object.values(rules || {}).flat().filter((r) => typeof r === 'string');
  return all.slice(0, 3).join(', ') + (all.length > 3 ? ` (+${all.length - 3} more)` : '');
}

/** A list of rules for a log line: the first three, then how many more. */
function ruleNames(list) {
  return list.slice(0, 3).join(', ') + (list.length > 3 ? ` (+${list.length - 3} more)` : '');
}

/** Whether a permission-rules object carries any rule at all. */
function hasPermissionRules(rules) {
  return !!rules && Object.values(rules).some((a) => Array.isArray(a) && a.length);
}

/** #620: the `branch.resolves` marker of a Resolve-in-a-pipeline run, or null. */
const validResolves = (r) => (r && typeof r === 'object' && typeof r.runId === 'string' && r.runId
  ? { runId: r.runId, member: typeof r.member === 'string' && r.member ? r.member : null } : null);

/** Shaper s5 (D4, D21): the `branch.roundOf` marker of a round, or null. Server-only (req._roundOf), never from HTTP.
 *  A Watch PR fix round also keeps `by: 'watch'`, its trigger `kinds` and its `outcome`, so a resume keeps them. */
const ROUND_KINDS = new Set(['checks', 'comments', 'changes', 'conflict', 'behind']);
const validRoundOf = (r) => {
  if (!(r && typeof r === 'object' && typeof r.pipelineId === 'string' && r.pipelineId && Number.isInteger(r.round) && r.round >= 2)) return null;
  const out = { pipelineId: r.pipelineId, round: r.round, request: typeof r.request === 'string' ? r.request.slice(0, 200) : '' };
  if (r.by === 'watch') { out.by = 'watch'; out.kinds = (Array.isArray(r.kinds) ? r.kinds : []).filter((k) => ROUND_KINDS.has(k)); }
  const o = cleanOutcome(r.outcome);
  if (o) out.outcome = o;
  return out;
};

/** The parenthetical of a workspace member's teardown audit line. Scan + kept wording is
 *  unchanged; an unchanged member's dropped branch says why. */
function memberBranchNote(branch, { readOnly, dropped, merged = false }) {
  if (merged) return `deleted branch \`${branch}\` — merged back into its source`;
  if (readOnly) return `deleted branch \`${branch}\``;
  if (dropped) return `deleted branch \`${branch}\` — no changes`;
  return `kept branch \`${branch}\``;
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
export function safeParse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Shaper s5 (D14): a feature's run k ≥ 2 merges the moved base first — single project, fresh branch only. A run with
 *  no slice, a workspace run, or a reused checkout never does. */
export function mergesFeatureBase({ slice, freshStart, isWorkspace }) {
  return !!(slice && slice.index >= 2 && freshStart && !isWorkspace);
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
  // Native separator: resolve() yields backslashes on Windows, where a '/'
  // comparison never matched and every tool-call log line carried the full path.
  return full.startsWith(b + sep) ? full.slice(b.length + 1) : full;
}

/** Collapse whitespace and truncate to n chars with an ellipsis. */
export function clip(text, n) {
  if (!text) return '';
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ── shared pure helpers (agent-event/telemetry block) ─────────────────────────

export function numOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

/** JSON round-trip clone; drops functions/undefined. Bus channels and resolved
 *  plan nodes are plain data, so this is lossless for them. */
export function jsonClone(v) {
  return v == null ? null : JSON.parse(JSON.stringify(v));
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
 * Which model id prices a sub-agent. The child runs inside the parent node's CLI
 * invocation — same endpoint, same price — so the parent's dispatched model is the
 * default. A Task input MAY name its own model; that only changes the price when
 * the named model carries an explicit cost override of its own (a bare alias like
 * 'haiku' resolves to nothing and must not drop the parent's override).
 * @param {unknown} inputModel  the Task/Agent tool_use input's `model`, if any
 * @param {string|undefined} parentModel  the parent node's dispatched model
 * @returns {string|null}
 */
function subAgentCostModel(inputModel, parentModel) {
  const own = typeof inputModel === 'string' && inputModel.trim() ? inputModel.trim() : null;
  try { if (own && modelCostConfig(own)) return own; } catch { /* catalog read is best-effort */ }
  return parentModel ?? null;
}

// Max chars for a Bash call's own `description` (#911 slice 3, flag commandSummaries): the run log's
// Summaries mode shows it in place of the command. One line in the Logs pane; the command keeps its 80.
const BASH_DESC_MAX = 120;

/** One `→ Tool target` line per call of a normalized `tool` event, plus the Bash call's own
 *  description as `desc` when the agent gave one (Claude Code does; Codex and Cursor never do). */
function describeToolUses(calls, projectDir) {
  return calls.filter((c) => typeof c.name === 'string').map((c) => {
    const target = toolTarget(c.name, c.input, projectDir);
    const text = target ? `${c.name} ${target}` : c.name;
    const d = c.name === 'Bash' && typeof c.input?.description === 'string' ? clip(c.input.description, BASH_DESC_MAX) : '';
    return d ? { text, desc: d } : { text };
  });
}

/**
 * Describe the results of a normalized `toolResult` event as short outcome
 * one-liners (`result ok <id8>` / `result error <id8>`). The 8-char tool_use_id
 * prefix matches worca's contract and is enough to correlate a result with its
 * call within one turn. Mirrors describeToolUses: the `← ` arrow prefix is added
 * by the caller.
 */
function describeToolResults(results) {
  return results.map((r) => `result ${r.isError ? 'error' : 'ok'} ${typeof r.toolUseId === 'string' ? r.toolUseId.slice(0, 8) : '?'}`);
}

/**
 * Describe a normalized `retry` event: the CLI retried a failed API call on its own
 * (for Claude, the `system`/`api_retry` frame, its ONLY report of it: no text, nothing
 * on stderr). `reason` is the CLI's category ('overloaded', 'rate_limit', …, or
 * 'unknown'); the error message itself is not carried. A status-less 'unknown' is a
 * request that never got an HTTP response — a timeout or a dropped connection.
 */
function describeApiRetry(e) {
  const secs = (ms) => `${(Number(ms) / 1000).toFixed(1)}s`;
  const category = typeof e.reason === 'string' && e.reason ? e.reason : 'unknown';
  let reason = e.httpStatus != null
    ? `${category} (HTTP ${e.httpStatus})`
    : category === 'unknown' ? 'no HTTP response (timeout or connection error)' : category;
  if (Number.isFinite(e.waitedMs)) reason += ` after ${secs(e.waitedMs)}`;
  const of = Number.isFinite(e.maxRetries) ? `/${e.maxRetries}` : '';
  const wait = Number.isFinite(e.delayMs) ? ` in ${secs(e.delayMs)}` : '';
  return `API call failed: ${reason}; retry ${e.attempt ?? '?'}${of}${wait}`;
}

/** The tools whose `file_path` can be a memory write. */
const MEMORY_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
// Memory usage (memory-usage.mjs): a Read of a note file is a `read`. Cursor and Copilot reads normalise to `Read` too.
const MEMORY_READ_TOOLS = new Set(['Read']);

/** The human text of a tool result: a string, or the FIRST text block; `<tool_use_error>`
 *  tags stripped (the CLI wraps some errors in them). '' when there is none. */
function toolResultText(result) {
  const c = result?.content;
  const raw = typeof c === 'string' ? c
    : Array.isArray(c) ? (c.find((x) => x?.type === 'text' && typeof x.text === 'string')?.text || '') : '';
  return raw.replace(/<\/?tool_use_error>/g, '').trim();
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
export const SKILLS_MAX = 64;

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
export function skillLabel(name, input) {
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

/** All kind-tagged skill labels in ONE `tool` event's calls (deduped within the
 *  turn, order-preserving). */
function extractSkillLabels(calls) {
  const out = [];
  const seen = new Set();
  for (const c of calls) {
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

/** How many graphify CLI invocations the Bash calls of ONE `tool` event
 *  contain (0 when none). Pure + module-scoped. */
function countGraphifyBashCalls(calls) {
  let n = 0;
  for (const c of calls) {
    if (c.name !== 'Bash') continue;
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
export function mergeSkills(existing, incoming) {
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

/** clip(), but keeping HEAD and TAIL with an ellipsis between when over budget.
 *  For runner exit details the frame ("claude exited with code N") leads and
 *  the terminal cause sits at the END — the runner tail-caps for that reason —
 *  so a head-only clip discards exactly the cause. Tail gets the larger share. */
export function clipMiddle(text, n) {
  if (!text) return '';
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const head = Math.floor((n - 1) / 3);
  return s.slice(0, head) + '…' + s.slice(-(n - 1 - head));
}

/** Longest pause detail we persist/broadcast (the run log keeps the full text). */
export const PAUSE_DETAIL_MAX = 400;

/** The human detail a converted failure pauses with: the WHOLE message, whitespace-
 *  collapsed and middle-clipped — the runner frames failures as "claude exited with
 *  code N: <cause>" with the cause at the END, so a head-only clip would drop it.
 *  Never empty: every consumer prints it verbatim. */
export function errorDetail(err, max = PAUSE_DETAIL_MAX) {
  const message = err == null ? '' : (err.message ?? String(err));
  return clipMiddle(message, max) || 'unknown error';
}

/** A snapshot row the scheduler marked 'error' is TERMINAL to reattach() — the node
 *  would never re-fire and a resumed run would quiesce to a false done. Under the
 *  errors-pause policy such a row can only come from a failure that bypassed the
 *  adapter's conversion. failExecution's fail-fast abort also settles every
 *  in-flight sibling as 'skipped' (TERMINAL too), so when an error row is present the
 *  skipped rows are its collateral and are re-armed with it; a snapshot WITHOUT an
 *  error row is returned by identity (its skipped rows are legitimate). */
export function scrubErrorRows(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.execs)) return snapshot ?? null;
  if (!snapshot.execs.some((e) => e && e.status === 'error')) return snapshot;
  const execs = snapshot.execs.map((e) => {
    if (!e || (e.status !== 'error' && e.status !== 'skipped')) return e;
    const { error: _dropped, ...rest } = e;
    return { ...rest, status: 'paused' };
  });
  return { ...snapshot, execs };
}

/**
 * Normalize an answer payload from answer()/auto into [{id, choice}].
 * Accepts { answers:[{id,choice}] } or a bare array. Fills any missing
 * questions with their first option so downstream never sees gaps.
 */
export function normalizeClarifyAnswer(payload, questions) {
  // A form answer is `{form, version, values}` and is NEVER flattened here: the
  // "fill with the first option" fallback below is legacy-kind only (spec §5).
  if (payload && typeof payload === 'object' && typeof payload.form === 'string' && payload.values) return [];
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

/** The --yes pick: the agent's recommendation when it is a real option, else the first non-blank option. */
export function autoChoice(q) {
  const opts = (q && Array.isArray(q.options) ? q.options : []).filter((o) => typeof o === 'string' && o.trim());
  if (typeof q?.recommended === 'string' && opts.includes(q.recommended)) return q.recommended;
  return opts[0] || 'auto';
}

/**
 * The answer `--yes` would give an ask, as an `answer()`-valid payload. Night mode uses it
 * as the last-resort fallback in a night-owned `--yes` run, which must never hang. Mirrors
 * the `_ask` auto branch except `workflow`, which uses the shape `sanitizeProposalAnswer`
 * accepts through `answer()`.
 */
export function autoAnswerPayload(q) {
  switch (q?.kind) {
    case 'clarify': case 'questions': return { answers: (q.questions || []).map((x) => ({ id: x.id, choice: autoChoice(x) })) };
    case 'form': return { form: q.form, version: q.version, values: q.autoValues || {} };
    case 'recovery': return { decision: 'pause' };
    case 'workflow': return { decision: 'accept', name: q.workflow?.name, nodes: {} };
    default: return { decision: 'continue' };
  }
}

// Upper bound for one RunHarness._git call. Matches worktree.mjs's slow-git
// budget (SLOW_GIT_TIMEOUT_MS): `diff --cached` on a large agent change is the
// slowest command issued here, and it legitimately takes seconds, never minutes.
const HARNESS_GIT_TIMEOUT_MS = 120_000;

// MCP registry §10: a result error the first-party API gives a tool name over the limit, and the
// run warning it maps to (put back after a resume re-assembly, like the mcpStatus lines). Bounded
// quantifiers and clipped text: it runs in the server process on every error result's text. One
// definition with Ask's muted line (ask/turn.mjs): src/shared/mcp-tool-name.mjs.
const MCP_NAME_400_RE = MCP_TOOL_NAME_400_RE;
const MCP_NAME_WARNING = MCP_TOOL_NAME_TOO_LONG;
// P1: the folder copy's own run warnings, re-added after _assembleContext rewrites run.json.warnings.
const FOLDER_COPY_WARNING_RE = /^(left \d+ (unreadable item\(s\)|symbolic link\(s\)) out of the copy|some paths in the copy are longer than 260 characters)/;

/** §10: the run warning for a registry copy's `system/init` status; null when it is not a problem. */
function mcpStatusWarning(name, status, setName) {
  const set = setName ? ` (set ${setName})` : '';
  if (status === 'failed' || status === 'needs-auth') return `${name}: failed to connect (token, URL or command) — run Test ${setName ? `in Connectors › ${setName}` : 'on the Connectors page'}`;
  if (status === 'disabled') return `${name}: disabled by your Claude Code settings${set}`;
  if (status === 'absent') return `${name}: blocked by managed MCP policy${set}`;
  return null;
}

/** What stopPaused() must NOT take from a paused row's saved state (readPipelineForResume().state).
 *  Everything else goes back onto this.state, so every column writeState's upsert rewrites
 *  survives the stop — a denylist on purpose: an allowlist would silently reset a column added
 *  later (a $0 total, an empty step ledger). Skipped: the status and pause bookkeeping the stop
 *  replaces, the identity the constructor owns, and read-side extras that are not run state. */
const PAUSED_STATE_SKIP = new Set([
  'id', 'status', 'updatedAt', 'resumePoint', 'pauseReason', 'pauseDetail', 'lastAction',
  'projectDir', 'projectKey', 'resumable', 'scheduledFor', 'scheduleId', 'active', 'gate', 'changes',
]);

/** P1a's A/M/D mapping of a folder scan's files into git name-status rows (assembleResults input). */
function folderNameStatus(files) {
  return files.map((f) => ({ path: f.path, status: f.change === 'added' ? 'A' : f.change === 'deleted' ? 'D' : 'M' }));
}

export class RunHarness extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts || {};
    // P3: a run without a project works only in its own <worcaHome>/runs/<id>/work — never process.cwd().
    this._noProject = this.opts.resume?.row ? isNoProjectKey(this.opts.resume.row.project_key) : this.opts.workMode === 'none';   // a resume: the row decides, never the caller
    if (this._noProject) {
      const pid = this.opts.pipelineId || this.opts.resume?.row?.id || '';
      if (!pid) throw new Error('a run without a project needs its pipeline id');
      if (this.opts.workspace) throw new Error('a run without a project cannot be a workspace run');
      if (this.opts.projectDir && !(isNoProjectWorkDir(this.opts.projectDir) && basename(dirname(resolve(this.opts.projectDir))) === pid)) throw new Error('a run without a project works only in its own work folder');
      this.opts = { ...this.opts, projectDir: noProjectWorkDir(pid), workMode: 'none', projectKey: NO_PROJECT_KEY };
    } else if (!this.opts.resume && !this.opts.workspace && isNoProjectWorkDir(this.opts.projectDir || process.cwd())) {
      // P3-D11 backstop for every caller (CLI --project, the cwd, a script): a run's work folder is never a git or
      // folder project — it would take the reserved key and `git init` inside another run's work/.
      throw new Error(NO_PROJECT_ERRORS.register);
    }

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
          .map(({ workMode, ...m }) => ({ ...m, ...(workMode === 'folder' ? { workMode: 'folder' } : {}) }))   // P5: absent = git
          .sort((a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0))
      : (() => {
          const dir = resolve(this.opts.projectDir || process.cwd());
          return [{ projectKey: this.opts.projectKey ?? (this.opts.resume?.row && workModeOfRow(this.opts.resume.row) !== 'git' ? this.opts.resume.row.project_key : undefined) ?? projectKey(dir), projectName: basename(dir), projectDir: dir }];
        })();
    if (this._noProject) this.members[0].projectName = NO_PROJECT_NAME;
    this.memberByKey = new Map(this.members.map((m) => [m.projectKey, m]));
    // P1 (CONTRACT §2): 'git' (a worktree) | 'folder' (a copy, then Apply) | 'none' (P3). A resume or a stop reads the
    // RECORDED mode (state.branch / workspace_meta) — never its caller's; a fresh start takes opts.workMode (decided by
    // the server / CLI); absent → 'git', so every existing caller is unchanged. P5 widens the workspace arm.
    // P5: a fresh workspace is 'folder' only when every member is a Folder member (else a git run with Folder members).
    this.workMode = this.opts.resume?.row ? workModeOfRow(this.opts.resume.row)
      : this.isWorkspace ? (this.members.some((m) => m.workMode !== 'folder') ? 'git' : 'folder')
      : normalizeWorkMode(this.opts.workMode);
    if (this._noProject) this.workMode = 'none';
    this.workDirs = new Map();         // projectKey -> worktree checkout dir
    this.checkpointRefs = {};          // projectKey -> pre-run commit
    this.branchInfos = new Map();      // projectKey -> createWorktree() result
    this.toolInstructions = new Map(); // projectKey -> per-project graph instruction
    this.workspaceDescription = '';    // frozen at run start (after createPipeline)
    this.workspaceOverrides = null;    // wsmap M15: a re-scan's stored overrides, read at run start / resume

    // primaryCwd: the lowest-projectKey member in workspace mode, else the scalar
    // projectDir. resolve() keeps the single-project behavior byte-identical.
    this.projectDir = this.isWorkspace
      ? resolve(this.members[0].projectDir)
      : resolve(this.opts.projectDir || process.cwd());
    // A resumed run keeps the engine it was started on and the consent to run it unguarded,
    // like its model below: both ride the resume point's `claude` blob, which
    // _buildResumePoint writes only when they differ from the default (a missing engine is
    // Claude). An engine the resume names itself wins; the saved consent then applies only
    // if it is the engine the consent was given for.
    const savedClaude = this.opts.resume?.resumePoint?.claude;
    const savedEngine = typeof savedClaude?.engine === 'string' && savedClaude.engine ? savedClaude.engine : 'claude';
    this.claude = {
      bin: this.opts.claude?.bin,
      permissionMode: this.opts.claude?.permissionMode || 'acceptEdits',
      model: this.opts.claude?.model,
      effort: this.opts.claude?.effort,
      mock: !!this.opts.claude?.mock,
      // The harness that runs this pipeline's agent nodes (engines/index.mjs).
      // Validated here: an unknown name, or the mock (only --mock reaches it), fails
      // before anything is created.
      engine: selectRunEngine(this.opts.claude?.engine || savedEngine),
    };
    // Where the run's agent and script steps execute (src/core/exec-env/). Kept off this.claude, which
    // is spread into spawn options. A resume takes the kind from its point.
    const savedExec = this.opts.resume?.resumePoint?.execEnv;
    this.execEnvKind = selectExecEnv(this.opts.execEnv || savedExec?.kind || 'local');
    this._savedExecEnv = savedExec || null;
    this.execEnv = null;              // the live RemoteExecEnv (remote runs only)
    this._execEnvRelease = null;
    // Resume with another model: every remaining step runs on this.claude.model (a usage limit spent on the provider
    // the run's steps were on). Rides the resume point while the model does. Kept off this.claude (spawn options).
    this._modelForAll = this.opts.claude?.modelForAll === true
      || (savedClaude?.modelForAll === true && !this.opts.claude?.model && this.claude.engine === savedEngine);
    // Kept off this.claude, which is spread into spawn options.
    this._allowUnguardedEngine = !!this.opts.claude?.allowUnguardedEngine
      || (savedClaude?.allowUnguardedEngine === true && this.claude.engine === savedEngine);
    this._resumeEngineSwitch = this.opts.resume && this.claude.engine !== savedEngine
      ? { from: savedEngine, to: this.claude.engine }
      : null;
    // A resumed run keeps the model it was started with (`worca --model`, the UI's
    // start pair): the resume sites pass none, so it rides the resume point — which
    // _buildResumePoint rewrites at every pause from this.claude — like memoryScope
    // below. A resume that names its own model wins. A model is kept only for the
    // engine that owns it (cascading-settings-design.md §4.2): a Claude id never
    // reaches codex and a codex catalog id never reaches Claude. On Claude it must
    // still be a Claude catalog entry (one that left the catalog is dropped, the run
    // falls back to the default, as before). An id no catalog knows is kept while the
    // run stays on the non-Claude engine it was saved on: that engine checks its own
    // ids, as it did at run start. resume() says what was dropped once the log is bound.
    this._staleResumeModel = null;
    this._staleResumeOwner = null;
    if (savedClaude && !this.claude.model && typeof savedClaude.model === 'string' && savedClaude.model) {
      const saved = savedClaude.model;
      const engine = this.claude.engine;
      // A switch keeps a model the target harness reaches too (an endpoint model on Claude Code and Codex).
      const runs = modelRunsOn(saved, engine);
      const owner = runs === false ? engineOfModel(saved) : runs ? engine : null;
      // Copilot keeps a catalog model it runs, and an id of its own naming (_engineModel) while the run stays on it.
      const keep = engine === 'copilot'
        ? (!!this._engineModel(saved) && (runs === true || savedEngine === 'copilot'))
        : runs === true
          ? (engine !== 'claude' || catalogHasModel(saved, { engine: 'claude' }))
          : (runs === null && engine !== 'claude' && engine === savedEngine);
      if (keep) {
        this.claude.model = saved;
        if (!this.claude.effort && typeof savedClaude.effort === 'string' && savedClaude.effort) this.claude.effort = savedClaude.effort;
      } else {
        this._staleResumeModel = saved;
        this._staleResumeOwner = owner && owner !== engine ? owner : null;
      }
    }
    // A mock run stays mock across every resume (a restart's auto-resume, Resume, Away lifting):
    // the flag rides the resume point, and a resume can only add it, never drop it.
    if (this.opts.resume?.resumePoint?.mock === true) this.claude.mock = true;
    // The mock runner routes EVERY dontAsk spawn to the Ask Worca mock (claude-runner.mjs
    // runMock, rule R-F), so a mock pipeline role under dontAsk writes no artifact and
    // the run dies at its first artifact read with no hint why. Fail at construction
    // instead (review of PR #376). WORCA_MOCK counts: the runner honours the env too.
    if (this.claude.permissionMode === 'dontAsk'
      && (this.claude.mock || /^(1|true|yes|on)$/i.test(String(process.env.WORCA_MOCK ?? process.env.ORCH_MOCK ?? '')))) {
      throw new Error('permissionMode "dontAsk" is reserved for the Chat runner in mock mode — a mock pipeline role spawned with it would take the ask mock and write no artifact');
    }
    this.agentsDir = this.opts.agentsDir || DEFAULT_AGENTS_DIR;
    this.auto = !!this.opts.auto;
    // Auto workflow (spec D3/D15): the human-in-the-loop switch. `--yes` (auto
    // mode) implies it is off. It changes nothing on a saved workflow — only an
    // Auto run reads it (proposal question, clarifier stage, agent questions).
    this.humanInLoop = !this.auto && this.opts.humanInLoop !== false;
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
    // The Workspace scan reads, compares and saves a WORKSPACE: refuse it on any other target
    // (the CLI's --workflow, an Ask card) before a pipeline exists.
    if (isWorkspaceScanWorkflow(this.workflowId) && !this.isWorkspace) {
      throw new Error('a Workspace scan workflow runs over a workspace only — start it from Workspaces › Create workspace');
    }
    // Which guardrail set governs this run (guardrails are selected PER RUN;
    // there is no per-project guardrails dimension). Callers that never pass the
    // option (the CLI, API bodies without one) get the install's default: Normal
    // on a fresh install, Permissive (the empty policy) on one from before v81.
    this.guardrailsId = this.opts.guardrailsId || defaultGuardrailSetId();
    // MCP registry (design §6.2, D16): the run's per-membership opt-out ('<setId>|<serverId>'),
    // validated by POST /api/run; rides the resume point, restored beside guardrailsId.
    this.mcpOptOut = Array.isArray(this.opts.mcpOptOut) ? this.opts.mcpOptOut : [];
    // Engine hook: the v1 runner registry (see Orchestrator._initRunners).
    this._initRunners(this.opts);

    // Worktree isolation: workDir is the per-pipeline checkout. Until
    // _setupRunRoot() runs, it mirrors projectDir so the existing tests/paths
    // (dispatcher tests that bypass run()) behave identically.
    this.workDir = this.projectDir;
    this.branchOpts = {
      source: (this.opts.branch && this.opts.branch.source) || null,
      feature: (this.opts.branch && this.opts.branch.feature) || null,
      // #620: a "Resolve in a pipeline" run names the run it resolves (server-only, never from HTTP).
      resolves: validResolves(this.opts.branch && this.opts.branch.resolves),
      // Shaper s5 (D4): a round of an earlier run (Ask for changes, a Watch PR fix run). Server-only, never from HTTP.
      roundOf: validRoundOf(this.opts.branch && this.opts.branch.roundOf),
      // Smart run naming (flag smartRunNaming): `suggested` = the name came from the form's suggestion, so it is made
      // unique like a derived one; `legacy` = the model was unavailable, so today's exact name applies. Server-set only.
      suggested: !!(this.opts.branch && this.opts.branch.suggested === true),
      legacy: !!(this.opts.branch && this.opts.branch.legacy === true),
    };
    // Run on the source branch (branch.sameAsSource, explicit — never inferred from feature === source):
    // the run still works on a hidden, auto-named branch (a typed feature name is ignored) and
    // fast-forwards `source` onto it at teardown (_mergeBack).
    if (this.opts.branch && this.opts.branch.sameAsSource === true) {
      this.branchOpts = { ...this.branchOpts, feature: null, sameAsSource: true };
    }
    // Sync before run (#527): absent → disabled, so the CLI, resume and every existing caller
    // keep today's behaviour; the UI server passes per-member options on a fresh start.
    this.syncOpts = runSyncOptions(this.opts.sync);
    this._syncStageOpen = false;
    this._syncStageFailed = false;
    this._syncing = 0;                  // members whose sync is in flight (setupStage restore)
    this._stageBeforeSync = null;
    this._createdSources = new Map();   // projectKey -> sha of a local source created from the remote
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
    // MCP registry layer (design §6.1): { env, redact, disallowed, allowlist, copies } for every
    // dispatch, or null. Holds secret values: never written to run.json, events, journals or the
    // resume point.
    this.mcpLayer = null;
    // Skills registry layer (design §4.3): { base, pluginDirs, plugins, mounted, skipped, blocked }
    // for every dispatch, or null when the run's target brings no set skill (_resolveSkills).
    this.skillLayer = null;

    this.abort = new AbortController();
    this._answeredBy = new Map();            // question id -> who answered it (identity.mjs actor)
    this.pauseRequested = false;
    this.pauseAbort = new AbortController(); // aborts ONLY node children on pause
    this._signalPause = null;                // a signal (SIGTERM) that came while a resume set up: pause once running
    this.pauseReason = null;                 // WHY the run paused: 'cost_pipeline'|'cost_total'|'error'|<usage-limit line>|null
    this.pauseDetail = null;                 // the human detail behind pauseReason ('error': the clipped message)
    this.pauseClass = null;                  // the class behind a 'recoverable' pause (resume point `pauseClass`)
    // The current network outage: { since, origin, reachable, waiting } or null. `since` is the
    // FIRST network failure; the max wait counts from it, across resumes (resume point `network`).
    this._net = null;
    this._netWaiters = 0;                    // nodes waiting right now (the banner stays while any waits)
    // Seams: a probe and a clock (tests). A mock run reaches no endpoint, so it never probes
    // unless a probe is injected.
    this._netProbe = this.opts.networkProbe || null;
    this._netClock = this.opts.networkClock || { now: () => Date.now(), sleep: sleepAbortable };
    this.limitEngine = null;                 // 'usage_limit' only: the engine whose own limit it is (_pauseFor)
    this.limitResetAt = null;                // ISO: when the usage limit behind this pause resets (D3)
    this._autoLimitResumes = 0;              // D7: automatic limit resumes in a row (reset by a manual resume or a finished step)
    // Team metrics (§4.4 interventions). Resume runs on a NEW instance, so the counters are
    // stamped into the persisted resume point at every pause and re-seeded in resume().
    // pausedMs: time the run spent parked (paused, or dead between a crash and its resume);
    // pausedAt: the pause stamp resume() measures from (null while running).
    this._metricsIv = { questions: 0, pauses: 0, resumes: 0, pausedMs: 0, pausedAt: null, lastPauseReason: null, lastPauseDetail: null };
    this._metricsRecorded = false;
    this._setupDone = false;                 // run()/resume() flip this right before _engineRun (setup replay)
    this._rehydrated = true;                 // resume() clears this until the paused run is rehydrated (the 'resume' site)
    this._modeRecorded = false;              // resume(): the row recorded a run-root mode (a setup-incomplete point may not)
    this._pauseGate = null;                  // gate context snapshot when paused at a gate
    this._resumeNodeSessions = null;         // nodeId -> sessionId map, set by resume() (Task 5)
    this.resumeOpts = this.opts.resume || null; // { row, resumePoint, steps } from readPipelineForResume
    // Agent memory (agent-memory-design.md §7.3): the defragment run option. A resumed run reads
    // it back from its resume point — the resume sites pass no run options (B10). The API and the
    // CLI validated already; this throw is the programming-error backstop (never a 400).
    this.memoryScope = this.opts.memoryScope || this.resumeOpts?.resumePoint?.memoryScope || null;
    // Shape it first (spec D5): { perspectives } for a shaped run, null otherwise. NOT `this.shape` — the
    // orchestrator's Auto path already uses "shape" for the classifier's shape.
    this.runShape = this.opts.shape || this.resumeOpts?.resumePoint?.shape || null;
    // Shaper D28: the recorded half of shapeStats (questions, revises, score); null on an unshaped run.
    // A resumed run reads it back from its row (shape_stats).
    this._shapeRec = this.runShape ? shapeRecordFrom(safeParse(this.resumeOpts?.row?.shape_stats)) : null;
    {
      const wf = this.resumeOpts?.resumePoint?.workflowId || this.workflowId;
      const reason = validateMemoryScope({ workflowId: wf, memoryScope: this.memoryScope, isWorkspace: this.isWorkspace });
      if (reason) throw new Error(reason);
    }
    this.pendingQuestion = null; // { id, resolve, reject, kind }
    this._recovery = null;      // class -> in-flight Promise<'retry'|'pause'> (same-class dedupe)
    this._askTail = null;       // serializes _ask: ONE prompt open at a time (recovery + step questions)
    this._recoverySeq = 0;      // monotonic id source for recovery prompts (determinism-safe)
    this.agentPrompts = null;
    this.memory = null;          // { root, mount, rules, dirs, baseline } after _mountMemory — mount = the WRITABLE copy (<pipeline.dir>/memory), rules = the read-only copy (<runCwd>/.claude/rules/worca)
    this.memoryBlock = '';       // the ## Worca memory pointer block, rendered once per mount (files load natively — no per-spawn re-render)
    this.memoryChanges = [];     // Change[] — the durable ledger's `changes`
    this._memoryWarned = new Set();
    this._memoryTail = null;     // per-run sync chain: one syncBack at a time (F1)
    // Failed-write bookkeeping (memory-write-split design §4): executionId -> { calls: Map<toolUseId, key>,
    // last: Map<key.id, { ...key, ok, reason }> }. Filled by _trackMemoryCalls/_trackMemoryResults from every tool event,
    // drained by _takeFailedMemoryWrites at sync time.
    this._memoryWrites = new Map();
    // Memory usage (memory-usage.mjs): Map<executionId, tally> of the note reads seen in tool events — a Set.add per
    // event, no I/O; merged into <worcaHome>/memory-usage at that execution's sync-back.
    this._memoryUsage = new Map();
    this._ledgerSeq = 0;         // monotonic: two ledger writes must never share a temp name
    this._pendingAudits = [];    // audit lines an engine hook queued before the pipeline dir existed (_resolveTopology runs first); run() appends them right after "Pipeline created"
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
    this.telemetry = null; // Run telemetry recorder (Labs), set by _bindTelemetry while the flag is on
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
    // Legacy runner envelopes (tests, tools, a script node's result) are normalized on the way in, one
    // Claude normalizer per execution (it remembers that stream's Task/Agent ids),
    // dropped at the execution's terminal marker (orchestrator.mjs `_execStep`).
    this._legacyNormalizers = new Map();

    this.state = {
      id: this.opts.pipelineId || null,
      title: this.opts.title || null,
      projectDir: this.projectDir,
      runEngine: this.claude.engine,
      ...(this.execEnvKind !== 'local' ? { execEnv: this.execEnvKind } : {}),
      ...(this._projectPipelineCap() !== undefined ? { pipelineCapUsd: this._projectPipelineCap() } : {}),
      status: 'idle',
      phase: 'idle',
      cycle: 0,
      startedAt: null,
      updatedAt: null,
      steps: [],
      stepper: null, // UI stepper manifest, snapshotted at run start (Task 2)
      setupStage: null, // what the open preflight is doing (_setupStage); null outside it
      tools: null,
      checkpointRef: null,
      pipelineDir: null,
      totalCostUsd: 0,  // cumulative actual spend (sum of steps[].costUsd)
      totalActiveMs: 0, // cumulative active processing time (sum of steps[].activeMs)
      branch: this.workMode !== 'git' ? { workMode: this.workMode, runRootMode: 'detached' } : null,     // { source, feature, worktreeDir, reusedExisting } after _setupRunRoot
      // Per-member maps, initialized HERE (not lazily) so getState()'s snapshot
      // shape is stable across modes and targets. Without this a single-project
      // detached run throws TypeError on the first this.state.branches[key] = … .
      branches: {},
      checkpointRefs: {},
      memoryMount: null, // <pipeline.dir>/memory after _mountMemory — the WRITABLE copy agents edit (--add-dir on every spawn)
      memoryRules: null, // <runCwd>/.claude/rules/worca — the read-only copy the CLI loads natively
      pauseReason: null,   // mirrors this.pauseReason so getState() (a deep clone of state) carries it live
      pauseDetail: null,   // mirrors this.pauseDetail
      limitEngine: null,   // mirrors this.limitEngine: the engine whose usage limit paused the run
      limitResetAt: null,  // mirrors this.limitResetAt: when that usage limit resets (ISO)
      ...(this.runShape ? { shaping: initialShaping(this.runShape, this.resumeOpts?.resumePoint?.shaping) } : {}),
      // Sub-agent lifecycle records (rides the existing `state` snapshot; mirrored to
      // the sub_agents table). Each: { id, label, nodeId, stepIndex, cycle, stepKey,
      // status, startedAt, finishedAt, durationMs?, tokens?, costUsd? };
      // status ∈ 'running'|'finished'|'error'|'stopped'.
      subAgents: [],
      directions: null,   // { posted, applied, pending: [{id,text}] } — set at done from directions.ndjson
    };
    if (this.workMode !== 'git') this.state.workMode = this.workMode;
    if (this.opts.projectKey) this.state.projectKey = this.opts.projectKey;
    if (this._noProject) this.state.projectName = NO_PROJECT_NAME;

    // Night mode (src/core/night/*): the run's own switches. `optIn` comes from the start
    // request (or the resume point); `override` is the run-view switch. Both live in the
    // resume point (`resumePoint.night`) because a UI resume passes only `resume: saved`.
    const savedNight = this.resumeOpts?.resumePoint?.night || null;
    this._night = {
      // A resume with --night opts in a run that was not; it never drops a saved opt-in.
      optIn: savedNight?.optIn === true || this.opts.nightMode === true,
      override: NIGHT_TOGGLES.includes(savedNight?.override) ? savedNight.override : 'auto',
      q: null, timer: null, openedAt: null, deciding: false,
      since: Number.isFinite(savedNight?.since) ? savedNight.since : null,   // start of the unattended stretch (spend-cap anchor); a human answer ends it
      decisions: new Map(),                // question id -> decision record (for the answer writers)
      count: 0, flagged: 0,
      answers: 0, checks: 0,               // what the answers list shows: one per answered question
      // B4 (WORCA_AWAY_PER_PERSON): who last resumed the run, when that is not its starter. Saved in
      // the resume point so the owner survives a pause and a restart.
      owner: typeof savedNight?.owner === 'string' ? savedNight.owner : null,
    };
    this._nightClock = this.opts.nightClock || { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) };
    this.state.night = this._nightSnapshot();
    this.state.networkWait = null;           // the run page's "waiting for network…" banner (_publishNetworkWait)
  }

  /** @returns {object} a deep-ish snapshot of current state. */
  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  /** Save to plans/ (server): the saved checkout path rides state.shaping so the run card can show it. */
  recordPlanSaved(rel) {
    if (!this.state.shaping || typeof rel !== 'string') return false;
    this.state.shaping.savedTo = rel;
    this._emit('state', this.getState());
    return true;
  }

  /**
   * Resolve a pending question.
   * @param {string} id
   * @param {object} payload clarify: {answers:[{id,choice}]} ; gate: {decision}
   */
  answer(id, payload, by = null) {
    const pq = this.pendingQuestion;
    // Who answered (identity.mjs actor): kept per question id for the writers that store
    // the answer (answeredBy on the row) and audited for decisions below.
    const settle = (value) => {
      if (typeof by === 'string' && by) this._answeredBy.set(id, by);
      if (this._night && by !== NIGHT_ACTOR && by !== NETWORK_ACTOR) this._night.since = null;   // someone is back: the unattended stretch ends
      this._auditDecision(pq, value, typeof by === 'string' && by ? by : null);
    };
    if (!pq || pq.id !== id) {
      this._log('orchestrator', 'warn', `answer() ignored: no pending question with id ${id}`);
      return false;
    }
    if (pq.validate) {
      const out = pq.validate(payload);
      // Two validator flavours, deliberately: the Auto proposal's returns the
      // CLEAN value or null (§5.4 — the question stays open, silently), while a
      // form's gate 3 returns a RESULT OBJECT carrying the field errors that
      // POST /api/answer owes the client as 422. Only the latter throws.
      if (out && typeof out === 'object' && typeof out.ok === 'boolean') {
        if (!out.ok) {
          this._log('orchestrator', 'warn', `answer() rejected: invalid answer for ${id} — the question stays open`);
          const err = new Error('invalid answer');
          err.code = 'INVALID_ANSWER';
          err.errors = Array.isArray(out.errors) ? out.errors : [];
          throw err;
        }
        this.pendingQuestion = null;
        settle(out.payload);
        pq.resolve(out.payload);
        return true;
      }
      if (out == null) {
        this._log('orchestrator', 'warn', `answer() ignored: malformed payload for ${id} — the question stays open`);
        return false;
      }
      this.pendingQuestion = null;
      settle(out);
      pq.resolve(out);
      return true;
    }
    this.pendingQuestion = null;
    settle(payload);
    pq.resolve(payload);
    return true;
  }

  /** Abort the run; marks state stopped and kills any child via the signal. `by` = who
   *  asked (identity.mjs actor), recorded as state.lastAction before the status event. */
  stop(by = null) {
    if (this.state.status === 'done' || this.state.status === 'stopped') return;
    this._recordAction('stop', by);
    this._setStatus('stopped');
    // No inbox summary here: stop() only REQUESTS the abort. The run loop then
    // unwinds into the async stopped path below, which reports it.
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
  pause(by = null) {
    if (this.state.status !== 'running') return false;
    this._recordAction('pause', by);
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

  /**
   * Pause because the server is stopping (B2: SIGTERM, POST /api/drain): pause() with the
   * distinct reason 'drain', so the resume point says why and WORCA_AUTO_RESUME can pick the run
   * up on the next start. Who last started or resumed the run stays on state.lastAction. Returns
   * false unless the run is currently 'running' (a run already pausing keeps its own reason).
   */
  pauseForDrain() {
    if (this.state.status !== 'running') return false;
    const la = this.state.lastAction;
    this._drainResumeAs = la && la.kind === 'resume' && typeof la.by === 'string' && la.by ? la.by : null;
    this._setPauseReason(REASON.DRAIN, 'Paused while worca was stopping');
    this._log('orchestrator', 'info', 'worca is stopping — pausing the run; resume continues from here');
    if (this.pipeline?.dir) appendAudit(this.pipeline.dir, 'Pipeline **paused**: worca was stopping.').catch(() => {});
    return this.pause();
  }

  /**
   * Pause because the CLI process got `signal` (SIGTERM from a supervisor: docker stop, a pod eviction, a CI
   * cancel): pause() with the reason 'terminated', so the resume point says why and the task source hears
   * needs-human (nothing resumes a CLI run by itself). A resume still setting up ('idle': it claims its row
   * long before it runs) is held the same way, as soon as it is running. Returns false for any other status.
   */
  pauseForSignal(signal) {
    if (this.state.status === 'idle') { this._signalPause = signal; return true; }
    if (this.state.status !== 'running') return false;
    this._setPauseReason(REASON.TERMINATED, `the process received ${signal}`);
    this._log('orchestrator', 'info', `${signal} received — pausing the run; worca resume continues from here`);
    if (this.pipeline?.dir) appendAudit(this.pipeline.dir, `Pipeline **paused**: worca received ${signal}.`).catch(() => {});
    return this.pause();
  }

  /** Who stopped / paused / resumed the run (identity.mjs actor): { kind, by, at } on the
   *  state, so every `state` event, getState() and the resume point carry it. */
  _recordAction(kind, by) {
    if (typeof by !== 'string' || !by) return;
    this.state.lastAction = { kind, by, at: new Date().toISOString() };
  }

  /** The audit line of a human action (`kind` = stop | pause | resume): "<text> by <name>."
   *  when state.lastAction names who did it (actor stored always), "<text>." otherwise. */
  async _auditAction(kind, text) {
    const la = this.state.lastAction;
    const actor = la && la.kind === kind && typeof la.by === 'string' ? la.by : null;
    await appendAudit(this.pipeline.dir, `${text}${byActor(actor)}.`, { actor });
  }

  /** Who answered question `id` (identity.mjs actor), recorded by answer(). */
  answeredBy(id) {
    return this._answeredBy.get(id) ?? null;
  }

  /** Audit a human decision on a gate / recovery / workflow proposal (answer()). Question
   *  and form answers are audited where they are written (with " by <name>"). */
  _auditDecision(pq, value, by) {
    if (!this.pipeline || !pq) return;
    const d = value && typeof value === 'object' && typeof value.decision === 'string' ? value.decision : null;
    let line = null;
    if (pq.kind === 'workflow') line = `Workflow proposal **${d === 'decline' ? 'declined' : d || 'answered'}**`;
    else if (pq.kind === 'gate') line = `Gate **${d || 'answered'}**`;
    else if (pq.kind === 'recovery') line = `Recovery decision **${d || 'answered'}**`;
    else if (pq.kind === PLAN_ASK_KIND && pq.plan?.outline) line = `Slice outline **${d || 'answered'}** (round ${pq.plan.round || 1})`;
    else if (pq.kind === PLAN_ASK_KIND) line = `Plan approval **${d || 'answered'}**`;
    if (!line) return;
    appendAudit(this.pipeline.dir, `${line}${byActor(by)}.`, { actor: by }).catch(() => {});
  }

  _checkPause() {
    if (this.pauseRequested) throw pauseErr();
  }

  /**
   * Record WHY the run is pausing: a machine-readable reason (the cost codes, 'error',
   * or the usage-limit first line) plus an optional human detail. FIRST WRITER WINS —
   * a pause kills its siblings and their unwinds must not overwrite the cause (the
   * rule every _pauseFor site follows). Mirrored onto state so every
   * `state` event and getState() carry it. @returns {boolean} true when recorded
   */
  _setPauseReason(reason, detail = null, limitEngine = null, limitResetAt = null) {
    if (this.pauseReason) return false;
    this.pauseReason = String(reason);
    this.pauseDetail = detail == null || detail === '' ? null : String(detail);
    this.limitEngine = limitEngine || null;
    this.limitResetAt = limitResetAt || null;
    this.state.pauseReason = this.pauseReason;
    this.state.pauseDetail = this.pauseDetail;
    this.state.limitEngine = this.limitEngine;
    this.state.limitResetAt = this.limitResetAt;
    return true;
  }

  _clearPauseReason() {
    this.pauseReason = null;
    this.pauseDetail = null;
    this.pauseClass = null;
    this.limitEngine = null;
    this.limitResetAt = null;
    this.state.pauseReason = null;
    this.state.pauseDetail = null;
    this.state.limitEngine = null;
    this.state.limitResetAt = null;
  }

  /**
   * Enact a 'pause' verdict (failure-policy.mjs) at ANY site — the one mechanism
   * behind every forced pause: the ONE log line, the reason + detail (first writer
   * wins), the audit line, then pause(). pause() sets pauseRequested BEFORE anything
   * reaches the scheduler, so onSnapshot stays frozen at the last clean point, the
   * failing row settles 'paused' (non-terminal) and reattach() re-invokes it on
   * resume. Returns false — recording nothing — when a pause is already unwinding
   * (the user's, or a sibling's: its reason stands) or a stop is in flight (never
   * re-labelled: pause() would be a no-op on 'stopped' and the scheduler must keep
   * seeing the stop). The caller throws pauseErr() itself where a throw is due.
   * @param {string} reason a REASON code
   * @param {Error|null} err the failure; null for a cap (`detail` carries the text)
   * @param {{nc?:object|null, ctx?:object|null, label?:string, detail?:string|null, cls?:string|null}} [o]
   *   nc/ctx: the execution (orchestrator sites); label: the log source otherwise;
   *   cls: the error class behind a RECOVERABLE pause (kept in the log, audit and detail)
   */
  _pauseFor(reason, err, { nc = null, ctx = null, label = null, detail = null, cls = null } = {}) {
    const where = label || nc?.key || ctx?.nodeId || 'orchestrator';
    const meta = ctx ? { nodeId: ctx.nodeId, executionId: ctx.executionId, cycle: ctx.ordinal } : {};
    const line = firstLine(err?.message || (err == null ? '' : String(err))) || 'unknown error';
    // A shared-pool 429 (OpenRouter `:free`) names its real cause and fixes —
    // otherwise "rate limited" reads as worca's own max-concurrent setting.
    // A credential-broker refusal (a missing key, a spent cap) says where to fix it.
    const hint = reason !== REASON.RECOVERABLE ? ''
      : cls === 'rate_limit' ? rateLimitHint(err) : brokerHint(err, cls);
    // OpenRouter's spent daily free requests: say what ran out and when it comes back,
    // not the raw 429 line (freeDailyHint is '' for any other usage limit).
    const freeDaily = reason === REASON.USAGE_LIMIT ? freeDailyHint(err, cachedFreeDailyCounts(currentBillTo())) : '';
    const text = detail ?? (reason === REASON.ERROR ? errorDetail(err)
      : reason === REASON.RECOVERABLE ? `${cls || 'recoverable'}: ${line}${hint ? ` — ${hint}` : ''}` : (freeDaily || line));
    if (reason === REASON.ERROR) {
      // The ONE error-level line, written BEFORE the pause sentinel the caller
      // throws next (a pause/abort is never logged as a failure).
      this._log(where, 'error', `${ctx ? 'execution' : 'run'} failed: ${clipMiddle(err?.message || err, 500)}`,
        { ...meta, ...(err?.stream ? { stream: err.stream } : {}) });
    }
    if (this.pauseRequested || this.state.status === 'stopped' || this.abort.signal.aborted) return false;
    // Whose limit this is follows from the step's connection (src/shared/connections.mjs). On the harness's own
    // sign-in it is the subscription's — another harness has its own allowance, so every pause surface offers to
    // continue there (engine-switch.mjs). On a provider or a custom endpoint it is that provider's (a spent
    // OpenRouter free allowance, a gateway's quota): another harness on the same provider would hit it too, so
    // none is offered; the pause names the provider, and a resume can pick another model.
    const conn = reason === REASON.USAGE_LIMIT && ctx && !freeDaily ? this._limitConnection(nc) : null;
    const limitEngine = conn?.kind === 'signin' ? (this.claude.engine || 'claude') : null;
    const limitText = conn && conn.kind !== 'signin' && !detail ? `${connectionLabel({ connection: conn })} limit — ${text}` : text;
    // D3/D11: when the limit comes back, read from the RAW message (`text` may be the OpenRouter
    // hint or carry a connection label). Independent of limitEngine: a shell/setup-site limit has none.
    const resetMs = reason === REASON.USAGE_LIMIT ? limitResetAt(err) : null;
    const recorded = this._setPauseReason(reason, limitText, limitEngine,
      resetMs != null ? new Date(resetMs).toISOString() : null);
    if (recorded && reason === REASON.RECOVERABLE && cls) this.pauseClass = cls;
    // First writer wins: a sibling's unwind that lost the race logs nothing.
    if (recorded && reason === REASON.USAGE_LIMIT && resetMs == null) {
      this._log(where, 'info', 'usage-limit reset time not recognised', meta);
    }
    let audit;
    if (reason === REASON.ERROR) {
      audit = ctx
        ? `Pipeline **paused**: execution failed on ${where} — ${line}. Fix the cause, then resume.`
        : `Pipeline **paused**: ${line}. Fix the cause, then resume.`;
    } else if (reason === REASON.USAGE_LIMIT) {
      this._log(where, 'warn', `${describePauseReason(reason)} — pausing for manual resume: ${text}`, meta);
      const others = usageLimitSwitches({ reason, limitEngine }, readyEnginesCached());
      audit = `Pipeline **paused**: session/usage limit on ${where} — ${limitText}. Resume after the reset${others.length ? `, or continue now on ${engineList(others)}` : ''}, or resume with another model.`;
    } else if (reason === REASON.RECOVERABLE) {
      this._log(where, 'warn', `recoverable ${cls || 'error'} error — pausing for manual resume: ${line}${hint ? ` — ${hint}` : ''}`,
        { ...meta, ...(err?.stream ? { stream: err.stream } : {}) });
      audit = `Pipeline **paused**: recoverable ${cls || 'error'} error on ${where} — ${line}.${hint ? ` ${hint[0].toUpperCase()}${hint.slice(1)}.` : ''} Resume to retry.`;
    } else {
      this._log(where, 'warn', `${text} — pausing for manual resume`, meta);
      audit = `Pipeline **paused**: ${text.replace(/^Paused:\s*/, '').replace(/\.$/, '')}.`;
    }
    if (this.pipeline?.dir) appendAudit(this.pipeline.dir, audit).catch(() => {});
    this.pause();
    return true;
  }

  /**
   * Execute the full pipeline. Resolves with { status, pipelineDir } on success
   * or stop; rejects only on unexpected internal errors (it emits 'error' too).
   *
   * Every spawn of the run is billed to the person who started it (billing.mjs,
   * credential broker): the whole loop runs inside that async context.
   */
  run() {
    return withBillTo(this.opts.startedBy || currentBillTo(), () => this._run());
  }

  async _run() {
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
      let topology = await this._resolveTopology(registry);
      if (!topology?.manifest || !topology.agentKeys || !topology.workflow?.id) throw new Error('engine hook contract: _resolveTopology must return { manifest, agentKeys, workflow:{id,name} }');
      // §9.4: hard-fail BEFORE the stepper is STAMPED / createPipeline / worktree
      // (the manifest is built inside the hook, which tolerates unknown keys) —
      // a missing agent key must never reach dispatch as an empty-prompt node.
      this._preflightAgentKeys(topology.agentKeys);
      this.state.stepper = topology.manifest;
      this._emit('state', this.getState());

      // 1) Load agent prompts + preflight tool detection (parallel; both safe).
      //    The preflight bookend stays open (its clock running) through ALL of the
      //    setup below, up to the first node: it is the only ledger row that can
      //    run before then, and the run page's clock and status line read it.
      this.state.setupStage = 'Checking the setup';   // the bookend's own state emit carries it
      this._bookend('preflight', 'start');
      const [agentPrompts, tools, stepModels] = await Promise.all([
        this._loadAgentPrompts(),
        detectTools(this.projectDir),
        resolveStepModels(this.projectDir, this.claude.model, this.claude.engine || 'claude'), // never throws
      ]);
      this.agentPrompts = agentPrompts;
      this.toolInstruction = tools.instruction || '';
      this.state.tools = tools;
      this.stepModels = stepModels;
      // Credential broker: every model this run will spawn needs its person's key; refuse
      // NOW, naming what's missing, instead of pausing mid-run at the first node that needs it.
      await this._brokerPreflight(topology.manifest, stepModels);
      await this._resolveGuardrails();
      await this._resolvePolicy();
      this._noteLocalTagDimensions();
      // The engine's own run-start check (binary, sign-in) and the project deny rules
      // it could not enforce, then the gate's refusals and audit lines.
      this._engineProjectRules = await this._engineChecks((m) => this.guardrailHonorByKey?.get(m.projectKey) !== false, { guardrails: this.guardrails });
      await this._engineMcpGate();
      this._pendingAudits.push(...this._engineGate());
      // Who serves the run's model calls (resolveModelRoute's provider): recorded once; a resume keeps the row's.
      this.state.provider = this._stepFacts(this._engineModel(this.claude.model) ?? null).provider ?? null;
      // The remote preflight: before any worktree exists, so a refusal is a launch error.
      { const r = this.execEnvStartRefusal(); if (r) throw markTerminal(new Error(r)); }
      // A saved remote default this run cannot take (resolveRunExecEnv's fallback, from the server or the CLI): it
      // runs locally, and its log says why (the reason names the backend).
      if (this.opts.execEnvFallback) this._log('exec-env', 'warn', this.opts.execEnvFallback);
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
      // A tracker task titles its run "[TECH-104] <task title>": known now, it needs no AI title call (which a usage
      // limit would fail, leaving the "<plugin>: <id>" placeholder). A title someone gave the run is kept.
      const ticketTitle = source.type === 'plugin' && !this.opts.titleLocked
        && (!this.opts.title || this.opts.title === sourcePlaceholderTitle(source))
        ? ticketRunTitle(input.sourceMeta) : null;
      if (ticketTitle) {
        this.opts.title = ticketTitle;
        this.opts.titleLocked = true;
        this.state.title = ticketTitle;
      }
      // A6 D15 (Report back): a run started from an exported feature carries its ticket. Its task stays the spec; only the
      // row says plugin, with the same source_ref a run started from that ticket would have, so write-back reports to it.
      const reportTo = source.type !== 'plugin' && this.opts.reportTo && typeof this.opts.reportTo === 'object' ? this.opts.reportTo : null;
      const reportMeta = reportTo ? { plugin: reportTo.plugin, sourceId: reportTo.sourceId, taskId: reportTo.taskId, profile: reportTo.profile || null,
        inputs: reportTo.inputs && typeof reportTo.inputs === 'object' ? reportTo.inputs : null, url: reportTo.url ?? null, title: reportTo.title ?? null } : null;
      this.pipeline = await createPipeline(this.projectDir, {
        promptText: input.promptText,
        // ?? keeps the legacy both-set corner byte-identical: inline prompt wins the
        // text, but a passed promptFile is STILL copied verbatim into prompt.md.
        promptFile: input.promptFile ?? this.opts.promptFile,
        sourceType: reportMeta ? 'plugin' : source.type,
        sourceMeta: input.sourceMeta || reportMeta,
        extras: this.opts.extras,
        title: this.opts.title,
        guardrailsId: this.guardrailsId,
        startedBy: this.opts.startedBy || null,
        prWatchRunId: this.opts.prWatchRunId || null,
        tags: this.opts.tags || [],
        labels: this.opts.labels || [],
        runSetup: typeof this.opts.runSetup === 'string' ? this.opts.runSetup : null,
        ...(this.workMode === 'none' ? { id: this.opts.pipelineId } : {}),
        ...(this.isWorkspace ? {} : { projectKey: this.members[0].projectKey, ...(this.workMode !== 'git' ? { workMode: this.workMode } : {}) }),
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
      // Replace the placeholder the client was shown at start with the task's title.
      if (ticketTitle) this._emit('title', { title: ticketTitle, provisional: false, pipelineId: this.pipeline.id });
      this.logWriter.bind(this.pipeline.dir);                  // start persisting (flushes buffered preflight lines)
      this._bindTelemetry(this.pipeline.dir);
      recordArtifact(this.pipeline.id, RUN_LOG_KIND, RUN_LOG_FILE); // index like prompt.md (sync; INSERT OR IGNORE)
      // A11(b): carry the resolved prompt on the in-memory state too (createPipeline
      // already INSERTs prompt and the curated UPSERT excludes it, so persistence is
      // safe — this keeps the live state object self-consistent for any reader).
      this.state.prompt = this.pipeline.promptText;
      // Same reasoning for the run's guardrail selection: createPipeline INSERTed
      // guardrails_id and the curated UPSERT excludes it (creation-immutable), so
      // mirroring it onto the live state only keeps rowToState round-trips honest.
      this.state.guardrailsId = this.guardrailsId;
      // Who started it (identity.mjs): creation-immutable too, mirrored for the same reason.
      this.state.startedBy = this.opts.startedBy || null;
      // Workspace: mirror the §5.2 superset onto the live state and FREEZE the
      // description now (read from the pipeline's frozen state.json snapshot, never
      // re-read from workspaces.json), so later registry edits never alter this run.
      if (this.isWorkspace) {
        // Freeze from the on-disk snapshot createPipeline wrote (the capped,
        // point-in-time copy) — never re-read from workspaces.json mid-run.
        this.workspaceDescription = await readFile(
          join(this.pipeline.dir, 'workspace-description.md'), 'utf8',
        ).catch(() => this.workspace.description || '');
        this.workspaceOverrides = await this._scanOverrides();
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
          ...(m.workMode === 'folder' ? { workMode: 'folder' } : {}),   // P5: absent = git (the recorded mode, R5)
        }));
        this.state.checkpointRefs = {};
        this.state.branches = {};
        // wf_workspace_resynth: freeze the stored map now — AFTER the workspace fields above, so a terminal
        // refusal persists a row that still names its workspace (toPipelineRow writes workspace_meta only
        // when state.target === 'workspace', and the upsert overwrites it).
        await this._freezeStoredMap();
      }
      if (!this.state.title) this.state.title = basename(this.pipeline.dir);
      // The title set above (firstMeaningfulLine(prompt) or the dir basename) is
      // PROVISIONAL: shown instantly. Kick off the real LLM title without blocking
      // run start. Skip on a resumed run — it already carries the previously-generated
      // row.title (loaded by resume()). this.resumeOpts (= this.opts.resume) is the
      // resume signal; resume() never reaches this run() site anyway (belt-and-suspenders).
      // The kickoff itself fires AFTER _setupRunRoot() below, so generateTitle's cwd
      // can be this.runCwd (§2.1 row 3) — at this point runCwd is still null.
      this.state.titleProvisional = !this.opts.titleLocked;
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
      for (const line of this._pendingAudits.splice(0)) await appendAudit(this.pipeline.dir, line);

      // 3) Ensure a git repo + checkpoint commit (per member on a workspace run).
      if (this.isWorkspace) await this._ensureGitCheckpointAll();
      else await this._ensureGitCheckpoint();
      this._checkAbort();

      // 3b) Set up the run root + the per-pipeline worktree(s). All subsequent
      // claude spawns cwd into this.runCwd (the run root on a detached workspace
      // run, else the primary's worktree); per-member fan-out sub-agents work in
      // this.workDirs. Artifacts route via the workspace store.
      if (this.workMode === 'git') this._setupStage('Creating the worktree');
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

      // 3b') Auto workflow (spec §5.3): the run row and the run root exist, so the
      // engine may now DECIDE the graph (classifier call, proposal question, reuse
      // or create) and re-stamp the manifest. Returns null for a saved workflow.
      // `topology` is consumed AFTER this point (collectRequiredSkills, the workflow
      // audit line), so the adopted graph is what they see.
      const decided = await this._decideTopology();
      if (decided) topology = decided;
      this._checkAbort();

      // 3c) Build the knowledge graph INSIDE each worktree so agents can query it.
      this._setupStage('Building the knowledge graph');
      if (this.isWorkspace) await this._buildWorktreeGraphAll();
      else await this._buildWorktreeGraph();
      this._checkAbort();

      this._setupStage('Preparing the agents');
      // 3d) Resolve + validate declared agent skills (hard gate, UNCHANGED in
      //     semantics), then assemble the run context for EVERY detached run —
      //     including the zero-declared-skills case, which is every shipped
      //     workflow today (`grep requiresSkills agents/` → zero hits).
      const requiredSkills = collectRequiredSkills(this.registry, topology.agentKeys);
      let resolvedSkills = new Map();          // ← HOISTED; empty Map on the default workflow
      if (requiredSkills.length) {
        const skillCtx = { repoRoot: REPO_ROOT, projectDir: this.projectDir, pluginDirs: pluginSkillDirs() };
        resolvedSkills = validateSkills(requiredSkills, skillCtx); // throws => caught => the run PAUSES (D6); the setup replay re-gates on resume
        if (this.runRootMode !== 'detached') {
          // LEGACY delivery, byte-identical to today: inject ONLY into real isolated
          // worktrees, never the main projectDir, so a copy can never pollute the
          // user's working tree.
          const candidates = this.isWorkspace ? [...this.workDirs.values()] : [this.workDir];
          const worktrees = candidates.filter((d) => d && d !== this.projectDir);
          const injected = await injectSkills(resolvedSkills, { targets: worktrees, rel: skillsRelFor(this.claude.engine) });
          if (injected.length) {
            await appendAudit(
              this.pipeline.dir,
              `Skills: injected ${injected.join(', ')} into ${worktrees.length} worktree(s).`,
            );
          }
        }
      }
      this._checkAbort();

      // 3d') Stage declared agent assets into the RUN FOLDER. Unlike a skill —
      //      which must land on a `claude -p` scan path inside a worktree — an
      //      asset is plain files the agent reads or copies, and the run folder
      //      is the one directory every agent reaches under both run-root modes.
      //      Staging removes path guessing entirely: before this, the deck kit
      //      shipped inside worca while the builder prompt said "cp from the
      //      project checkout", and a run whose project was an unrelated repo
      //      only found the kit by globbing the filesystem.
      const requiredAssets = collectRequiredAssets(this.registry, topology.agentKeys);
      if (requiredAssets.length) {
        const staged = await stageAssets(requiredAssets, { root: REPO_ROOT, target: this.pipeline.dir, pluginDirs: pluginAssetDirs() });
        await appendAudit(this.pipeline.dir, `Assets: staged ${staged.join(', ')} into the run folder.`);
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
      } else {
        await this._resolveSkillsLegacy();     // skills registry §4.3: the mount needs only pipeline.dir
      }
      this._checkAbort();
      // 3f) Agent memory: mount the store twice — the read-only rules copy into
      // <runCwd>/.claude/rules/worca (the CLI loads it natively) and the writable copy into
      // <pipeline.dir>/memory (every spawn's --add-dir; the sync-back reads it) — and render the
      // pointer block every spawn carries, naming the writable copy. Pure fs work, both modes,
      // mock included. AFTER 3e: the assembly rewrites injectedPaths and the mount registers
      // itself into that map.
      await this._mountMemory();
      await this._registerEngineConfig();   // an engine's checkout config files (Cursor, Gemini CLI) join the §8.8 set (both modes)
      await this._startExecEnv();           // remote only: the run's sandbox, once the §8.8 set is complete
      this._checkAbort();
      // D7: every setup step above is done — a pause from here on has nothing to
      // replay, so _completePaused strips any `setupIncomplete` stamp instead.
      this._setupDone = true;
      this._endPreflight();

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
      await this._finalizeWorkspaceScan();   // Workspace scan workflows only (wf_workspace_scan, wf_workspace_resynth): create/update the workspace (D6)

      // 9) Done.
      this._setStatus('done');
      this.state.resumePoint = null; // finished rows are not resumable (clears the boundary trail)
      this._bookend('done', 'done');
      await this._finalizeDirections();
      await this._persist();
      await appendAudit(this.pipeline.dir, `Pipeline finished with status **done**.`);
      await this._buildResults();          // refs + worktree still live here
      await this._stampDefrag();           // AFTER the final sync inside _buildResults counted the defragmenter's writes
      await this._reportToSource();        // task-source write-back (never throws, spec §7.5)
      await this._recordRunMetrics('done');
      this._emit('done', { status: 'done', pipelineDir: this.pipeline.dir });
      return { status: 'done', pipelineDir: this.pipeline.dir };
    } catch (err) {
      if ((isPause(err) || this.state.status === 'pausing') && this.state.status !== 'stopped') {
        // A plain error that landed while a user pause was unwinding (a setup step that
        // failed under the pause): the user's pause keeps the reason, the run log keeps
        // the failure. _completePaused stamps setupIncomplete when setup never finished.
        if (!isPause(err) && !isAbort(err)) {
          this._log('orchestrator', 'error', `failed while pausing: ${clipMiddle(err?.message || err, 500)}`, err?.stream ? ERR_STREAM : null);
        }
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
        await this._finalizeDirections();   // report an unread inbox on every terminal outcome
        this._emit('done', { status: 'stopped', pipelineDir: null });
        return { status: 'stopped', pipelineDir: null };
      }
      if (isAbort(err) || this.state.status === 'stopped') return await this._settleStopped();
      if (this.pipeline) {
        // The SETUP / SHELL site (failure-policy.mjs): a failure once the row exists.
        try {
          const paused = await this._pauseForFailure(err);
          if (paused) return paused;
        } catch (err2) {
          // Last resort: the pause bookkeeping itself failed. Fall through to today's
          // error shape (persist/audit/results/write-back) rather than reject run().
          // The finally tears the checkout down on 'error' — never leave a
          // point that names it (today's error branch does not clear it; the stop branch does).
          this._log('orchestrator', 'error', `pause bookkeeping failed: ${err2?.message || err2} — ending the run as a launch error`);
          this.state.resumePoint = null;
        }
      }
      // No row yet (topology, preflight, tool detection): the LAUNCH site. Its only
      // enactable verdict is a terminal error — there is nothing to resume into.
      else this._launchVerdict(err);
      this._setStatus('error');
      await this._finalizeDirections();   // report an unread inbox on every terminal outcome
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
      await this._recordRunMetrics('error', err);
      this._emit('done', {
        status: 'error',
        pipelineDir: this.pipeline?.dir || null,
      });
      return { status: 'error', pipelineDir: this.pipeline?.dir || null, error: message };
    } finally {
      this._stopHeartbeat(); // clear timer + NULL owner columns (done/stopped/launch-error/paused)
      // C1: tear the run root + worktree(s) down on done/stopped/launch-error — the branch is
      // kept (except a workspace member's branch this run never changed, and every branch of
      // a read-only scan), only the disposable checkout is removed. But NEVER on a pause: the checkout (with any uncommitted agent
      // work) and the run root are the things we resume into (§8.13).
      if (this.state.status !== 'paused' && this.state.status !== 'pausing') {
        await this._finishExecEnv();   // remote: the last sync, then the sandbox goes (before the teardown commit)
        await this._teardownRunRoot().catch(() => {});
        await this._keepCheckoutByPolicy().catch((e) => this._log('worktree', 'warn', `keep policy: ${e?.message || e}`));
        await this._checkBaseAfterRun().catch((e) => this._log('git', 'warn', `base check: ${e?.message || e}`));
      }
      await this._closeTelemetry();
      await this.logWriter.close().catch(() => {}); // flush + stop timer (last, to capture teardown logs)
    }
  }

  /**
   * Continue a paused pipeline from its persisted resume point. Mirrors run()'s
   * shell but skips createPipeline / checkpoint / worktree / graph setup — those
   * artifacts exist from the original run, unless the point is stamped
   * `setupIncomplete` (D7 replay), which re-runs whatever setup never finished.
   * Resolves like run().
   *
   * Billed to whoever resumed it (the request's person, billing.mjs); a resume with
   * no person behind it (a restart's auto-resume) stays with the run's starter.
   */
  resume() {
    const who = currentBillTo();
    const starter = this.resumeOpts?.row?.started_by ?? this.opts.startedBy ?? null;
    // B4: the person who resumed it owns it for Away mode from now on (only with per-person Away).
    if (this._night && awayPerPerson() && awayPersonKey(who)) this._night.owner = who;
    // Pays: whoever resumed. Runs as: the starter's agent user, whose HOME holds the sessions.
    return withBillTo(who && who !== 'local' ? who : (starter || who), () => this._resume(), { owner: starter || who });
  }

  async _resume() {
    this._pausedHandoff = false; this._handedOff = false; this._pauseToken = null;   // this harness owns its row again
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
    // Engine gate refusals (§10.3) reject resume() here too, outside the try: inside it
    // the 'resume' site below would end the paused run. The row stays paused, so the
    // user can resume again with the missing flag.
    const engineGateNodes = await this._engineResumeGate(rp);
    // The remote preflight, likewise before the claim: a refused resume keeps the row paused.
    { const r = this.execEnvStartRefusal(); if (r) throw markTerminal(new Error(r)); }
    // The snapshot can be stale: a stop (claimPausedForStop, in this process or another) may have
    // claimed the row since it was read. Take the row over ATOMICALLY, here: after the engine hooks,
    // so a rejected point or gate leaves the row alone, and before the rehydration awaits anything.
    if (!claimForResume(row.id)) {
      const now = findPipelineRowById(row.id)?.status ?? 'gone';
      throw new Error(`resume(): pipeline is "${now}", not resumable`);
    }
    // D7: the point tells us whether run() ever finished its setup. Until the replay
    // below re-runs it, a pause here must re-stamp the flag (_completePaused reads it).
    this._setupDone = rp.setupIncomplete !== true;
    // The 'resume' site (failure-policy.mjs): until the paused run is rehydrated —
    // identity, worktrees, guardrails, prompts — a failure cannot be parked again
    // (the point on disk is all there is) and ends the run.
    this._rehydrated = false;
    try {
      // ── rehydrate identity + state ──
      this.state.id = row.id;
      this.state.title = row.title;
      this.state.startedAt = row.started_at;
      this.state.prompt = row.prompt;
      this.state.stepper = safeParse(row.stepper);
      this.state.tools = safeParse(row.tools);
      this.state.branch = safeParse(row.branch);
      // Parked time (autonomy = active ÷ (wall − paused)). A paused row is measured from the
      // stamp _completePaused wrote into the point; an interrupted row from the last heartbeat
      // (the last time the dead process was seen alive — reconcileStaleRunning keeps it for
      // this). A point written before the stamp existed falls back to the row's updated_at.
      // The same anchor closes every step clock a crash left running: the tail up to the
      // anchor is real work that the crash never folded, the rest of the gap is parked.
      const iv = rp.interventions && typeof rp.interventions === 'object' ? rp.interventions : {};
      const anchor = Date.parse(row.status === 'interrupted' ? (row.heartbeat_at || row.updated_at) : (iv.pausedAt || row.updated_at));
      const now = Date.now();
      const parkedMs = Number.isFinite(anchor) ? Math.max(0, now - anchor) : 0;
      this.state.steps = (steps || []).map((s) => {
        if (s.runningSince == null || !Number.isFinite(anchor)) return { ...s, runningSince: null };
        return { ...s, activeMs: (s.activeMs || 0) + Math.max(0, Math.min(anchor, now) - s.runningSince), runningSince: null };
      });
      this.state.totalActiveMs = sumStepActive(this.state.steps);
      // The total is Σ steps (I2): rehydrate it with them, or the first persist of a resumed run writes
      // $0 and a resumed run that books nothing new finishes at $0 while its ledger keeps the spend.
      this.state.totalCostUsd = sumStepCosts(this.state.steps);
      this.baseName = row.base_name;
      this.planDatePrefix = row.date_prefix;
      this.pipeline = { id: row.id, dir: rp.pipelineDir, promptText: row.prompt || '' };
      this.state.pipelineDir = rp.pipelineDir;
      // Ownership starts at the claim (claimForResume above; nothing awaited since): beat from here,
      // so no liveness sweep reads the rehydrating row as dead, and drop the store commands aimed at
      // the run's earlier incarnation NOW. A command mailed from here on is meant for this run: the
      // control poller holds it until the run is rehydrated (_checkControlSlot), then executes it.
      this._startHeartbeat();
      this._nightSyncCounts();              // night counters continue from the DB, not from 0
      this.logWriter.bind(rp.pipelineDir);
      this._bindTelemetry(rp.pipelineDir);
      recordArtifact(row.id, RUN_LOG_KIND, RUN_LOG_FILE);
      if (this._staleResumeModel) {
        this._log('orchestrator', 'warn', this._staleResumeOwner
          ? `model ${JSON.stringify(this._staleResumeModel)} the run was started with is a ${this._staleResumeOwner} model — resuming on ${this.claude.engine}'s default model`
          : `model ${JSON.stringify(this._staleResumeModel)} the run was started with is no longer in the catalog — resuming on the default model`);
      }
      if (this._resumeEngineSwitch) {
        const { from, to } = this._resumeEngineSwitch;
        this._log('orchestrator', 'warn', `the run's saved engine is ${from} — resuming on ${to} as asked; a paused step starts a fresh session`);
      }
      this.stepModels = rp.stepModels || null;
      this.workflowId = rp.workflowId || this.workflowId;
      // Pauses are counted only in _completePaused, so a crash-resume of an `interrupted`
      // run adds a resume but no pause (§4.4 decision 6). The stamp is consumed here.
      this._metricsIv = {
        questions: iv.questions | 0, pauses: iv.pauses | 0, resumes: (iv.resumes | 0) + 1,
        pausedMs: (Number.isFinite(iv.pausedMs) ? iv.pausedMs : 0) + parkedMs, pausedAt: null,
        lastPauseReason: iv.lastPauseReason ?? null, lastPauseDetail: iv.lastPauseDetail ?? null,
      };
      // The saved point carries the pause that produced it; a resumed run is running.
      this._clearPauseReason();
      // A network outage keeps its first-failure time across a resume: the max wait counts from it (D6).
      this._net = rp.network && typeof rp.network.since === 'string'
        ? { since: rp.network.since, origin: rp.network.origin ?? null, reachable: null, waiting: false } : null;
      // D7: only a resume the server made for a usage limit continues the streak.
      const prevAuto = Number.isSafeInteger(rp.autoLimitResumes) ? rp.autoLimitResumes : 0;
      this._autoLimitResumes = this.opts.autoLimitResume ? prevAuto + 1 : 0;
      this.state.lastAction = null;
      this._recordAction('resume', this.opts.resumedBy || null);
      // Rehydrate the run's selection BEFORE re-resolving so resume enforces the
      // LATEST saved set definition (missing set -> warn + Permissive, inside
      // _resolveGuardrails). Legacy resume points without the field were written
      // before the per-run picker, when every run was Permissive: they stay so,
      // whatever the install default is now. Keep state in sync for re-persist.
      this.guardrailsId = rp.guardrailsId || 'permissive';
      this.state.guardrailsId = this.guardrailsId;
      this.mcpOptOut = Array.isArray(rp.mcpOptOut) ? rp.mcpOptOut : [];
      await this._resolveGuardrails();
      await this._resolvePolicy();
      this._noteLocalTagDimensions();
      for (const line of this._engineGate(engineGateNodes)) await appendAudit(this.pipeline.dir, line);
      // Restore the EFFECTIVE instruction from the resume point — by dispatch time
      // run() has replaced the detect-time tools.instruction with the in-worktree
      // graph-build outcome (worktreeGraphInstruction() or ''). Falling back to
      // tools.instruction would tell resumed agents a graph exists that the original
      // run suppressed. (Fallback keeps old-shape resume points working.)
      this.toolInstruction = typeof rp.toolInstruction === 'string' ? rp.toolInstruction : (this.state.tools?.instruction || '');

      /** The persisted manifest, read once on a detached resume (re-assembly below). */
      let resumeManifest = await this._reattachCheckouts(row, rehydrated);
      // wf_workspace_resynth paused BEFORE its start-time freeze (a user pause during setup keeps even a
      // terminal setup error as a pause — run()'s catch): freeze now, or end the run (terminal). A no-op
      // once stored-map.json exists, so an ordinary resume reuses the frozen copy.
      await this._freezeStoredMap();

      // ── prompts/registry (cheap, local) ──
      this.registry = loadAgentRegistry(this.agentsDir);
      this.agentPrompts = await this._loadAgentPrompts();

      this.state.resumePoint = null; // consumed; cleared on the next persist
      this._setStatus('running');
      await this._persist();
      this._startHeartbeat();
      await this._auditAction('resume', String(rehydrated.audit || '').replace(/\.\s*$/, ''));
      if (this.opts.resumeCause === 'network') this._log('orchestrator', 'info', 'network back — resumed');
      this._emit('state', this.getState());
      this._rehydrated = true;
      // The pause that parked this run is over; it must not colour a later failure
      // or stop (§4.4 decision 2).
      this._metricsIv.lastPauseReason = null;
      this._metricsIv.lastPauseDetail = null;
      if (this._signalPause) this.pauseForSignal(this._signalPause);

      // 3a') Auto workflow (spec §5.6): a run that paused BEFORE its graph was
      // decided re-enters the decision HERE — before the setup replay, so the
      // skills gate and the context assembly below see the ADOPTED agent keys, not
      // the bootstrap's empty set. null for a saved workflow and for an Auto run
      // that already adopted (rp.workflowId is then the real id).
      // A run that paused mid-setup resumes INSIDE its preflight: the bookend's clock
      // runs through the re-decision and the replay below (_endPreflight closes it).
      if (rp.setupIncomplete === true) {
        this.state.setupStage = 'Checking the setup';
        this._bookend('preflight', 'start');
      }
      await this._decideTopology({ resume: rp });
      this._checkAbort();

      // ── setup replay (D7): a converted setup failure paused this run before its
      //    checkout / graph / skills gate existed. Re-run exactly what run() never
      //    finished. Placed HERE: _setupRunRoot persists, and the row must already
      //    read 'running' (above), never the constructor's 'idle'.
      let replayedSkills = null;
      if (rp.setupIncomplete === true) {
        this.state.titleProvisional = rp.titleProvisional === true;
        replayedSkills = await this._replaySetup();
        // The replay (re)wrote the run manifest; the re-assembly below reads it.
        if (this.runRootMode === 'detached') resumeManifest = await readRunManifest(this.runRoot);
      }
      this._setupDone = true;
      this._endPreflight();

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
        await this._assembleContext(replayedSkills ?? (resumeManifest?.skillResolutions ?? new Map()));
        // AFTER the assembly: it rewrites run.json.warnings wholesale, so recording
        // this first would drop it from the durable ledger.
        if (!resumeManifest && !replayedSkills) {
          await this._recordRunWarning(
            'run.json was missing or unparseable, so the bundle/plugin skills this run mounted ' +
            'could not be restored to the skill mount; real-dir and root skills were re-mounted ' +
            'normally. An agent that declares `requiresSkills` may not find its skill.',
          );
        }
      } else {
        // Skills registry §4.3: a legacy run has no assembly, so its set skills are re-resolved and
        // the mount rebuilt here (the detached re-assembly above does both inside _assembleContext).
        await this._resolveSkillsLegacy({ resume: true });
      }

      // Agent memory on resume (§5): capture what the interrupted execution wrote,
      // then remount fresh from the store.
      await this._mountMemory({ resume: true });
      await this._registerEngineConfig();
      await this._resumeExecEnv();   // remote only: reconnect to the parked sandbox (or create it)

      const dispatched = await this._engineRun({ resume: rp, rehydrated });
      this._checkAbort();
      if (dispatched === 'paused') return await this._completePaused();
      await this._finalizeWorkspaceScan();   // Workspace scan workflows only (wf_workspace_scan, wf_workspace_resynth): create/update the workspace (D6)

      this._setStatus('done');
      this.state.resumePoint = null; // finished rows are not resumable (clears the boundary trail)
      this._bookend('done', 'done');
      await this._finalizeDirections();
      await this._persist();
      await appendAudit(this.pipeline.dir, `Pipeline finished with status **done**.`);
      await this._buildResults();          // refs + worktree still live here
      await this._stampDefrag();           // AFTER the final sync inside _buildResults counted the defragmenter's writes
      await this._reportToSource();        // task-source write-back (never throws, spec §7.5)
      await this._recordRunMetrics('done');
      this._emit('done', { status: 'done', pipelineDir: this.pipeline.dir });
      return { status: 'done', pipelineDir: this.pipeline.dir };
    } catch (err) {
      if ((isPause(err) || this.state.status === 'pausing') && this.state.status !== 'stopped') {
        // A plain error that landed while a user pause was unwinding (a replayed setup
        // step that failed under the pause): the user's pause keeps the reason, the run
        // log keeps the failure. _completePaused re-stamps setupIncomplete from _setupDone.
        if (!isPause(err) && !isAbort(err)) {
          this._log('orchestrator', 'error', `failed while pausing: ${clipMiddle(err?.message || err, 500)}`, err?.stream ? ERR_STREAM : null);
        }
        if (this.pipeline) {
          if (!this.state.resumePoint) this.state.resumePoint = rp; // re-arm the consumed point: a paused row must stay resumable
          return await this._completePaused();
        }
      }
      if (isAbort(err) || this.state.status === 'stopped') return await this._settleStopped();
      if (this.pipeline) {
        // The SETUP / SHELL site (failure-policy.mjs). `rp` is the point this resume
        // consumed — the fallback when the engine holds none.
        try {
          const paused = await this._pauseForFailure(err, rp);
          if (paused) return paused;
        } catch (err2) {
          // Last resort: the pause bookkeeping itself failed. Fall through to today's
          // error shape (persist/audit/results/write-back) rather than reject resume().
          // The finally tears the checkout down on 'error' — never leave a
          // point that names it (today's error branch does not clear it; the stop branch does).
          this._log('orchestrator', 'error', `pause bookkeeping failed: ${err2?.message || err2} — ending the run as a launch error`);
          this.state.resumePoint = null;
        }
      }
      this._setStatus('error');
      await this._finalizeDirections();   // report an unread inbox on every terminal outcome
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
      await this._recordRunMetrics('error', err);
      this._emit('done', { status: 'error', pipelineDir: this.pipeline?.dir || null });
      return { status: 'error', pipelineDir: this.pipeline?.dir || null, error: message };
    } finally {
      this._stopHeartbeat(); // clear timer + NULL owner columns (done/stopped/launch-error/paused)
      // Same teardown as run()'s finally — wiring only run()'s would keep legacy
      // teardown on every detached run that finishes after a resume (including every
      // crash-interrupted run, §8.12's primary scenario): run root leaked until the
      // next boot, no stray scan, no injected-path cleanup.
      if (this.state.status !== 'paused' && this.state.status !== 'pausing') {
        await this._finishExecEnv();
        await this._teardownRunRoot().catch(() => {});
        await this._keepCheckoutByPolicy().catch((e) => this._log('worktree', 'warn', `keep policy: ${e?.message || e}`));
        await this._checkBaseAfterRun().catch((e) => this._log('git', 'warn', `base check: ${e?.message || e}`));
      }
      await this._closeTelemetry();
      await this.logWriter.close().catch(() => {}); // flush + stop timer (last, to capture teardown logs)
    }
  }

  /**
   * Re-attach a parked run's checkouts from its saved row — the run-root mode it RECORDED,
   * the single-project worktree and every workspace member's — so the teardown (and, on a
   * resume, the agents) read the same shapes a fresh run builds. Shared by resume() and
   * stopPaused(). `strict` (resume): a missing worktree throws — the run cannot continue
   * without it. Not strict (a stop): it is logged and skipped — there is nothing to commit
   * from a checkout that is gone, and the stop must still land.
   * @param {object} row the pipelines row
   * @param {{checkpointRef:string|null, memberWorktrees:Array}} rehydrated _engineRehydrate's result
   * @param {{strict?:boolean}} [opts]
   * @returns {Promise<object|null>} the run manifest read on a detached run (resume re-assembles from it)
   */
  async _reattachCheckouts(row, rehydrated, { strict = true } = {}) {
    // ── run-root mode: read the RECORDED value, never the live flag (§10) ──
    // Single-project rides state.branch.runRootMode (the pipelines.branch JSON
    // column); workspace rides workspace_meta.runRootMode (real only because of the
    // artifacts.mjs whitelist fold). Absent ⇒ 'legacy', correct for every
    // pre-change row. A run can therefore never be resumed into a mode it was not
    // started in, no matter when the default flips or rolls back.
    const meta = safeParse(row.workspace_meta);
    const recordedRaw = this.isWorkspace ? meta?.runRootMode : this.state.branch?.runRootMode;
    this._modeRecorded = !!recordedRaw;                       // a setup-incomplete point may carry none
    // (A setup paused in createWorktree now persists a pending member record in `branch`,
    // so its replay pins the first attempt's mode too — the more correct behaviour.)
    const recordedMode = recordedRaw || 'legacy';
    this.runRootMode = recordedMode === 'detached' ? 'detached' : 'legacy';
    // Re-stamp BEFORE the first persist so a resumed workspace run re-persists the
    // pin rather than dropping it (toPipelineRow reads it off state every persist).
    this.state.runRootMode = this.runRootMode;
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

    if (this.workMode === 'folder' && !this.isWorkspace) {   // P5: an all-Folder workspace takes the rehydration loop
      const key = this.members[0]?.projectKey;
      let copy = this.state.branch?.copyDir || null;
      // a copy that is not the run's own folder (a link the agent swapped in) is no copy: mounts and scans never follow it
      if (copy && !(await folderCopyRoot(copy, { pipelineId: row.id, key }))) {
        if (strict) throw new Error(`copy missing: ${copy} — cannot resume`);
        this._log('worktree', 'warn', `copy missing: ${copy} — nothing to keep`);
        copy = null;
      }
      if (copy && key) { this.workDirs.set(key, copy); this.workDir = copy; this._setFolderRecord(key, {}); }
      this.checkpointRef = null;
      this.runCwd = copy;
      return resumeManifest;
    }

    if (this.workMode === 'none') {
      // P3: a run without a project re-attaches its own work/ folder — always detached, no worktree, no checkpoint, no git.
      if (this.runRootMode !== 'detached') {
        this.runRootMode = 'detached'; this.state.runRootMode = 'detached';
        this.runRoot = join(worcaHome(), 'runs', row.id);
        resumeManifest = await readRunManifest(this.runRoot);
        if (resumeManifest?.injectedPaths && typeof resumeManifest.injectedPaths === 'object') this.injectedPaths = resumeManifest.injectedPaths;
      }
      let work = join(this.runRoot, WORK_DIR_NAME);
      if (!existsSync(work)) {
        // A run paused before its setup made work/ (setupIncomplete: _setupDone is false) — the setup replay creates it.
        if (strict && this._setupDone) throw new Error(`work folder missing: ${work} — cannot resume`);
        if (!strict) this._log('worktree', 'warn', `work folder missing: ${work} — nothing to keep`);
        work = null;
      }
      if (work && !(await ownWorkDir(work))) {
        // P3-D19: work/ was the agents' cwd — one swapped for a link is never worked in, mounted into or harvested.
        if (strict) throw new Error(`work folder is not the run's own: ${work} — cannot resume`);
        this._log('worktree', 'warn', `work folder is not the run's own: ${work} — nothing to keep`);
        work = null;
      }
      if (work) { this.workDirs.set(NO_PROJECT_KEY, work); this.workDir = work; }
      this.checkpointRef = null;
      this.runCwd = work;
      return resumeManifest;
    }

    // ── worktree re-attach (single-project; workspace below) ──
    let wt = this.state.branch?.worktreeDir;
    if (wt && !existsSync(wt)) {
      if (strict) throw new Error(`worktree missing: ${wt} — cannot resume`);
      // A workspace's `branch` mirrors a member, and the member loop below warns for it.
      if (!this.isWorkspace) this._log('worktree', 'warn', `worktree missing: ${wt} — nothing to commit or remove`);
      wt = null;
    }
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
      this.workspaceOverrides = await this._scanOverrides();
      this.checkpointRefs = meta.checkpointRefs || {};
      // P5: a Folder member re-attaches its copy from its record (the recorded mode: members come from
      // workspace_meta.projects) — never branchInfos, never a diff base.
      for (const m of this.members) {
        if (this._memberWorkMode(m.projectKey) !== 'folder') continue;
        let copy = meta.branches?.[m.projectKey]?.copyDir || null;
        if (copy && !(await folderCopyRoot(copy, { pipelineId: row.id, key: m.projectKey }))) {
          if (strict) throw new Error(`copy missing: ${copy} — cannot resume`);
          this._log('worktree', 'warn', `copy missing: ${copy} — nothing to keep`);
          copy = null;
        }
        if (copy) this.workDirs.set(m.projectKey, copy);
      }
      for (const p of rehydrated.memberWorktrees) {
        if (p.projectKey && p.worktreeDir) {
          if (!existsSync(p.worktreeDir)) {
            if (strict) throw new Error(`worktree missing: ${p.worktreeDir} — cannot resume`);
            this._log('worktree', 'warn', `worktree missing: ${p.worktreeDir} — nothing to commit or remove`);
            continue;
          }
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
    // A run paused before the diff-base fix persisted the project checkout's HEAD as its base.
    // Correct it from the recorded worktree start before anything diffs, persists or renders it.
    await this._reconcileDiffBases();
    return resumeManifest;
  }

  /**
   * Re-attached members only (`workDirs`): adopt the RECORDED start of each checkout as its diff
   * base — `diffBase` (a reused branch's fork point) or `baseSha` (a fresh start) — when it differs
   * from the persisted base and is in the checkout's history, with one audit line per change.
   * A pending (setup-incomplete) member is not attached; the setup replay sets its base. A record
   * with neither field keeps its base. A member with NO persisted base is left alone: its diff is
   * skipped today, and a legacy empty dir inside the project repo would let the ancestor check pass
   * against the user's own checkout. Shared by resume and stop-of-paused. Runs before `_rehydrated`
   * (the 'resume' failure site), so it NEVER throws.
   */
  async _reconcileDiffBases() {
    const short = (s) => (s ? String(s).slice(0, 10) : 'none');
    try {
      let changed = false;
      for (const [key, dir] of this.workDirs.entries()) {
        const rec = this.state.branches?.[key];
        const want = rec && rec.worktreeDir ? (rec.diffBase || rec.baseSha || null) : null;
        const had = this.checkpointRefs[key] || null;
        if (!want || !had || want === had) continue;
        if (!(await isAncestor(dir, want, 'HEAD'))) {
          this._log('worktree', 'warn', `${key}: recorded start ${short(want)} is not in the checkout's history — keeping diff base ${short(had)}`);
          continue;
        }
        this.checkpointRefs[key] = want;
        changed = true;
        if (this.pipeline?.dir) {
          await appendAudit(this.pipeline.dir, `Diff base for \`${key}\` corrected to the worktree's start: \`${short(had)}\` → \`${short(want)}\`.`).catch(() => {});
        }
      }
      if (!changed) return;                               // nothing corrected: state stays exactly as re-attached
      const primaryKey = this.members?.[0]?.projectKey;
      if (primaryKey && this.checkpointRefs[primaryKey]) this.checkpointRef = this.checkpointRefs[primaryKey];
      this.state.checkpointRef = this.checkpointRef;
      this.state.checkpointRefs = { ...this.checkpointRefs };
    } catch (err) {
      this._log('worktree', 'warn', `diff base check on resume failed: ${err?.message || err}`);
    }
  }

  /**
   * Stop a PAUSED run for good — stop()'s twin for a run no process drives. A paused run's
   * loop has already unwound, so stop() would only flip the status in memory (no `done`,
   * no persist, no teardown). This claims the row (claimPausedForStop: paused -> stopped,
   * atomic), rehydrates what the stopped path and the teardown read, settles it through
   * _settleStopped and tears the checkout down as resume()'s finally does: the work so far
   * is committed onto the kept branch and the worktree is removed. Input: opts.resume, the
   * readPipelineForResume shape. `by` = who asked (identity.mjs actor).
   * @returns {Promise<{status:'stopped', pipelineDir:string|null}>}
   * @throws {Error} code 'NOT_PAUSED' when the row is no longer paused — nothing was touched
   */
  stopPaused(by = null) {
    const who = currentBillTo();
    const starter = this.resumeOpts?.row?.started_by ?? this.opts.startedBy ?? null;
    // resume()'s identities: billed to whoever asked, else the starter. A stop spawns no agent, so
    // the owner never picks an OS user here: the teardown's git runs as this process.
    return withBillTo(who && who !== 'local' ? who : (starter || who), () => this._stopPaused(by), { owner: starter || who });
  }

  async _stopPaused(by) {
    const saved = this.resumeOpts;
    if (!saved?.row || !saved?.resumePoint) throw new Error('stopPaused(): no saved pipeline provided');
    const { row, resumePoint: rp } = saved;
    // FIRST, before any await: the claim is what makes a racing resume or a second stop
    // lose, and stopPausedRun's beforeStop hook relies on nothing running in between.
    if (!claimPausedForStop(row.id)) {
      throw Object.assign(new Error(`pipeline ${row.id} is no longer paused`), { code: 'NOT_PAUSED' });
    }
    // Set once the checkouts are re-attached: only then does the teardown know every checkout it
    // removes. A run-root teardown on a half re-attached run would remove the run root with an
    // uncommitted worktree inside it.
    let reattached = false;
    try {
      try {
        // The snapshot was read before the awaits that led here (stopPausedRun): re-read the row now
        // that it is ours, so a booking that landed on it meanwhile (a title call outlives a pause) is
        // written back too. The claim dropped the resume point: the snapshot's stays.
        this._rehydratePausedState({ ...saved, state: readPipelineForResume(row.id)?.state || saved.state });
        this._recordAction('stop', by);
        const rehydrated = await this._engineRehydrate(rp);
        await this._reattachCheckouts(row, rehydrated, { strict: false });
        reattached = true;
        // The parked executions end here: credit their pre-pause work while the checkouts are live.
        await this._engineCreditParked(rp, this._parkedKeys);
        await this._reattachMemoryForStop();
        // Not inside _reattachMemoryForStop: it returns early when memory never mounted. A stop never fails on it.
        try { await this._registerEngineConfig(); }
        catch (err) { this._log('orchestrator', 'warn', `stop: the engine's checkout config was not registered for removal (${err.message})`); }
      } catch (err) {
        // The stop stands — the row is already claimed. Settle with what is known (identity and
        // the pipeline dir at least), so the stopped path still persists, audits and emits done.
        // Only what failed is lost: e.g. a checkout that was not re-attached stays where it is
        // (Archive reclaims it).
        this.state.id = row.id;
        if (!this.pipeline) this.pipeline = { id: row.id, dir: rp.pipelineDir, promptText: row.prompt || '' };
        if (this.state.lastAction?.kind !== 'stop') this._recordAction('stop', by);
        this._log('orchestrator', 'warn', `stop: the run could not be fully restored (${err?.message || err}) — settling it as stopped anyway`);
      }
      return await this._settleStopped();
    } finally {
      this._stopHeartbeat();
      // remote: the parked sandbox goes whatever else failed (its changes were synced at park time).
      await this._dropSavedSandbox();
      // resume()'s teardown on a stop: commit the work onto the kept branch, remove the checkout.
      if (reattached) {
        await this._teardownRunRoot().catch(() => {});
        await this._checkBaseAfterRun().catch((e) => this._log('git', 'warn', `base check: ${e?.message || e}`));   // #620
      }
      await this._closeTelemetry();
      await this.logWriter.close().catch(() => {}); // last, to capture the teardown's log lines
    }
  }

  /** The saved row back into this harness, for a stop: identity, the pipeline dir and log,
   *  every field _persist() writes back (all but PAUSED_STATE_SKIP), and the pause bookkeeping
   *  the team metrics record (parked time up to now; why it parked stays on the record). */
  _rehydratePausedState({ row, resumePoint: rp, state: snap }) {
    for (const [k, v] of Object.entries(snap || {})) if (!PAUSED_STATE_SKIP.has(k) && v !== undefined) this.state[k] = v;
    // The execution the pause parked never runs again: it ends `stopped`, as a live stop leaves it,
    // and its pre-pause work is credited at this stop (_engineCreditParked, once re-attached).
    this._parkedKeys = new Set((this.state.steps || []).filter((s) => s.status === 'paused').map((s) => s.key));
    this.state.steps = (this.state.steps || []).map((s) => (s.status === 'paused' ? { ...s, status: 'stopped' } : s));
    // I2: the total is the sum of the step costs — rehydrated from them, exactly as resume() does.
    this.state.totalCostUsd = sumStepCosts(this.state.steps);
    this.state.id = row.id;
    this.state.status = row.status;            // 'paused' until _settleStopped flips it (no event here)
    this.state.lastAction = null;
    this._clearPauseReason();                  // a stopped run shows no pause banner
    this.baseName = row.base_name;
    this.planDatePrefix = row.date_prefix;
    this.workflowId = rp.workflowId || this.workflowId;
    this.pipeline = { id: row.id, dir: rp.pipelineDir, promptText: row.prompt || '' };
    this.state.pipelineDir = rp.pipelineDir;
    this._nightSyncCounts();                   // the Away mode counters the stopped frame reports
    this.logWriter.bind(rp.pipelineDir);
    this._bindTelemetry(rp.pipelineDir);
    recordArtifact(row.id, RUN_LOG_KIND, RUN_LOG_FILE);
    const iv = rp.interventions && typeof rp.interventions === 'object' ? rp.interventions : {};
    const pausedAt = Date.parse(iv.pausedAt || row.updated_at);
    this._metricsIv = {
      questions: iv.questions | 0, pauses: iv.pauses | 0, resumes: iv.resumes | 0,
      pausedMs: (Number.isFinite(iv.pausedMs) ? iv.pausedMs : 0) + (Number.isFinite(pausedAt) ? Math.max(0, Date.now() - pausedAt) : 0),
      pausedAt: null,
      lastPauseReason: iv.lastPauseReason ?? null, lastPauseDetail: iv.lastPauseDetail ?? null,
    };
  }

  /** The interrupted execution's memory writes, back to the store. A pause does not sync the
   *  execution it killed — resume()'s _mountMemory does, first thing. A stop never remounts:
   *  it adopts the ledger's mount as this run's memory instead, so _settleStopped's
   *  _buildResults runs the run-end sync (exactly as a live stop's does), the teardown excludes
   *  and removes the §8.8 entry, and the server's done hook pokes the open Memory views. */
  async _reattachMemoryForStop() {
    if (!this.pipeline?.dir) return;
    let ledger = null;
    try { ledger = JSON.parse(await readFile(this._memoryLedgerPath(), 'utf8')); } catch { return; }   // never mounted
    if (!ledger || !ledger.baseline || !Array.isArray(ledger.dirs)) return;
    const cwd = this.runCwd || null;
    const scope = (this.runRoot && cwd === this.runRoot) ? 'runRoot'
      : ([...this.workDirs.entries()].find(([, d]) => d === cwd)?.[0] ?? null);
    if (scope) await this._registerMemoryMount(scope);
    // The ledger's mount: the writable copy since the write split, or the in-checkout rules dir
    // of a run paused before it (a pause keeps the checkout) — whichever still exists.
    const mount = (typeof ledger.mount === 'string' && existsSync(ledger.mount)) ? ledger.mount : memoryWorkPath(this.pipeline.dir);
    this.memoryChanges = Array.isArray(ledger.changes) ? ledger.changes : [];
    this.memory = { root: memoryRoot(), mount, rules: null, dirs: ledger.dirs, baseline: ledger.baseline };
  }

  /** Single-project branch resolution — VERBATIM _setupWorktree semantics.
   *  Deliberately NOT _resolveMemberBranches, which would (a) suffix an explicit
   *  feature with `-<projectName slug>` (breaking test/orchestrator-worktree.test.mjs,
   *  'explicit featureBranch is honored verbatim'), (b) derive suggested names from
   *  `opts.title + projectName` (suggestBranchName is title-first, so derived names
   *  would come from the project name instead of the prompt), and (c) silently swap
   *  an invalid --source for the default branch, where createWorktree's M1 gate must
   *  keep failing loudly. */
  async _resolveSingleBranches({ replay = false } = {}) {
    const source = this.branchOpts.source || (await resolveDefaultBranch(this.projectDir));
    const legacy = this.branchOpts.legacy === true;
    const derived = !this.branchOpts.feature || this.branchOpts.suggested === true;
    const args = { prompt: this.pipeline.promptText, title: this.opts.title || null, pipelineId: this.pipeline.id };
    let featureRaw = legacy ? suggestBranchName(args)
      : this.branchOpts.feature
        ? sanitizeBranchName(this.branchOpts.feature)
        : deriveBranchName({ ...args, ticket: this.opts.source?.taskId || '', projectDir: this.projectDir });
    // replay: the branch already exists because WE made it; re-checking would rename it.
    if (derived && !legacy && !replay && flagEnabled('smartRunNaming')) {
      featureRaw = await uniqueBranch(this.projectDir, featureRaw, this.pipeline.id);
    }
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
  async _setupRunRoot({ replay = false } = {}) {
    if (this.workMode === 'folder') return this._setupFolderRunRoot({ replay });
    if (this.workMode === 'none') return this._setupNoProjectRoot();
    this.state.branches = this.state.branches || {};      // belt-and-braces for resumed/legacy shapes
    // ONE flag per run. A resume passes no opts.branch: a replay reads it back from any persisted
    // member record (pending or final), so every member — and the resolvers below — agree.
    if (!this.branchOpts.sameAsSource
        && [this.state.branch, ...Object.values(this.state.branches)].some((b) => b && b.sameAsSource === true)) {
      this.branchOpts = { ...this.branchOpts, feature: null, sameAsSource: true };
    }
    // Never for a read-only Workspace scan or a memory defragment: neither lands work anywhere.
    const sameAsSource = this.branchOpts.sameAsSource === true && !this._isWorkspaceScan() && !this.memoryScope;
    // A resume REPLAY keeps the mode the row recorded — never the live flag — unless
    // the paused run never got far enough to record one (then this IS run()'s read).
    if (!replay || !this._modeRecorded) this.runRootMode = runRootMode(); // §10 flag, read ONCE, here, per pipeline
    // P5: a Folder member's copy lives in the run root — never inside the folder it copies.
    if (this.members.some((m) => this._memberWorkMode(m.projectKey) === 'folder') && this.runRootMode !== 'detached') {
      this._log('worktree', 'info', 'folder run: the copy lives in the run root (run-root mode legacy ignored)');
      this.runRootMode = 'detached';
    }
    this.state.runRootMode = this.runRootMode;            // top-level pin → workspace_meta (artifacts.mjs)
    const detached = this.runRootMode === 'detached';
    this.runRoot = detached ? join(worcaHome(), 'runs', this.pipeline.id) : null;
    const reposBase = detached ? join(this.runRoot, 'repos') : null;
    if (detached) {
      await mkdir(this.runRoot, { recursive: true });
      claimRunDir(this.runRoot);                          // G19: this run's owner's agent only
      await mkdir(reposBase, { recursive: true });
    }

    this._log('worktree', 'info', `Resolving source/feature branches for ${this.members.length} member(s)…`);
    // Settle EVERY member before propagating any failure — carried VERBATIM from
    // _setupWorktreeAll. mapWithCap is Promise.all: it rejects the instant one
    // member throws and would abandon an in-flight sibling whose worktree
    // materializes AFTER run()'s finally has snapshotted branchInfos — an orphaned
    // checkout on disk. Under legacy that orphan sits INSIDE the user's repo with
    // the legacy sweep disabled, i.e. permanent. The partial-setup test
    // (test/orchestrator-workspace.test.mjs) guards exactly this.
    const setupFailures = [];
    const folderWarns = [];
    try {
      await mapWithCap(this.members, fanoutCap(), async (m) => {
        // Replay: a member whose checkout survived the pause is already re-attached by
        // resume() (workDirs/branchInfos/state.branches); `git worktree add` onto the
        // live dir would fail. (This skips the per-member "Worktree `<key>`" audit line
        // for kept members — say so in the run log instead.)
        const kept = replay ? this.workDirs.get(m.projectKey) : null;
        if (kept && existsSync(kept)) {
          this._log('orchestrator', 'info', `setup replay: ${m.projectKey} keeps its checkout ${kept}`);
          return;
        }
        if (this._memberWorkMode(m.projectKey) === 'folder') {
          // P5: a Folder member of a mixed workspace — its own copy; never a branch, sync, worktree or any git.
          try {
            const rec = await this._setupFolderMember(m, { copyDir: join(reposBase, m.projectKey), files: this._folderFilesFor(m.projectKey), replay, onWarn: (w) => folderWarns.push(w) });
            this.workDirs.set(m.projectKey, rec.copyDir);
            this._setFolderRecord(m.projectKey, rec);
          } catch (err) {
            setupFailures.push(err);
          }
          return;
        }
        try {
          // The project checkout's HEAD (_ensureGitCheckpointFor), or a replay's persisted base. Only
          // used to say in the audit whether the diff base differs from it — never as the base itself.
          const checkoutHead = this.checkpointRefs[m.projectKey] || null;
          // Replay (resume after a pausable setup failure): the first attempt persisted its planned
          // start below. Resume passes no `branch`, so without it a replay would re-resolve
          // resolveDefaultBranch and could start from — and record — another branch.
          const pending = replay ? this._pendingStart(m.projectKey) : null;
          const resolved = this.isWorkspace
            ? await this._resolveMemberBranches(m, { replay })   // member-suffixed names; creates a remote-only source itself
            : await this._resolveSingleBranches({ replay });   // single: today's exact semantics
          const source = (pending && pending.source) || resolved.source;
          // Resume also passes no `title`, so a replay re-derives ANOTHER feature name. Take the
          // first attempt's planned name, so `pending.reuse` below describes the branch this
          // replay really uses.
          const featureRaw = (pending && pending.plannedFeature) || resolved.featureRaw;
          const { fellBack = false } = resolved;
          // Single mode never validated the source (workspace mode does it in _resolveMemberBranches):
          // only a name that resolves to nothing may be created from the remote. A tag or SHA source
          // resolves already and must not trigger a fetch or a same-named local branch.
          if (!this.isWorkspace && !(await isValidSourceRef(resolve(m.projectDir), source))) {
            await this._ensureLocalSource(m, source, { replay });
          }
          // Refuse feature == source BEFORE the sync, so a doomed start never fast-forwards the shared
          // base first. Only when this member syncs: with sync off, createWorktree's own check
          // keeps today's outcome.
          if (this.syncOpts.memberFor(m.projectKey).enabled && !replay
              && sanitizeBranchName(featureRaw) === sanitizeBranchName(source)) {
            throw markTerminal(new Error(`featureBranch and sourceBranch both resolve to "${sanitizeBranchName(source)}" — they must differ`));
          }
          const synced = await this._syncMemberBase(m, source, { replay, fellBack, sameAsSource });
          // Run on the source branch: the work is fast-forwarded into `source` at teardown, so it must
          // be a real local branch — never a workspace member's silent fallback, a tag or a SHA.
          // isSafeBranchName: the merge back's syncStatus refuses any other name (bad-base), after all the work.
          if (sameAsSource && (fellBack || !isSafeBranchName(source)
              || !(await listLocalBranches(resolve(m.projectDir))).includes(source))) {
            throw markTerminal(new Error(fellBack
              ? `Run on the source branch: ${m.projectName || m.projectKey} has no branch "${(m.branch && m.branch.source) || this.branchOpts.source}" to commit onto`
              : `Run on the source branch needs a local branch to commit onto; "${source}" is not one (a tag, a commit, a missing branch, or a name with characters worca will not fast-forward)`));
          }
          const startRef = synced.startRef || (pending && pending.startRef) || null;
          // createWorktree's feature == source guard compares NAMES; a startRef SHA slips past it,
          // and feature `dev` off source `dev` would reuse the shared `dev` itself.
          if (startRef && sanitizeBranchName(featureRaw) === sanitizeBranchName(source)) {
            // Terminal, not a pause (setup failures pause by default): resuming cannot change
            // the names, so every resume would replay into the same pause.
            throw markTerminal(new Error(`featureBranch and sourceBranch both resolve to "${sanitizeBranchName(source)}" — they must differ`));
          }
          // Will createWorktree REUSE an existing feature branch? A reused branch ignores
          // sourceBranch and sits on its old tip, so diffing it against a freshly synced base would
          // count every upstream commit as a deletion by this run. Decide it BEFORE moving the diff
          // base, so a paused setup can never persist a moved base for a reused branch. On a replay
          // the first attempt's answer wins: its own `worktree add -b` usually created the branch
          // (at the start point) before failing, which is not a reuse. The recorded answer is
          // trusted only for the SAME planned name; anything else is decided again.
          const willReuse = pending && typeof pending.reuse === 'boolean'
              && pending.plannedFeature === sanitizeBranchName(featureRaw)
            ? pending.reuse
            : (await listLocalBranches(resolve(m.projectDir))).includes(sanitizeBranchName(featureRaw));
          // D17 / C3: when this run moved its start (fast-forward, remote start, a source created from
          // the remote), move the member's diff base NOW — before createWorktree — so a paused setup
          // persists it. The final base is set after createWorktree from the worktree itself (below).
          const moved = synced.record && ['fast-forwarded', 'remote-start', 'created'].includes(synced.record.result)
            ? synced.record.to : (this._createdSources.get(m.projectKey) || null);
          const baseMoved = !willReuse && (!!moved || !!(pending && pending.baseMoved));
          if (baseMoved && moved && this.checkpointRefs[m.projectKey] !== moved) this.checkpointRefs[m.projectKey] = moved;
          const syncRecord = synced.record || (pending && pending.sync) || null;
          // A REUSED branch ignores sourceBranch and sits on its old tip: its diff is every change on it
          // that <remote>/<source> has not merged (plus uncommitted work). Decided before createWorktree,
          // like the move above, so a paused setup persists it. NEVER stored as baseSha: that field is
          // the "this run created the branch" proof _dropUnchangedMemberBranch deletes by.
          const reuseBase = willReuse ? await this._reusedBranchBase(m, source, featureRaw, pending, syncRecord) : null;
          if (reuseBase && this.checkpointRefs[m.projectKey] !== reuseBase.sha) this.checkpointRefs[m.projectKey] = reuseBase.sha;
          // Pending record, persisted with the checkpoint if createWorktree fails pausably (mirrored
          // into state.branch before the throw, below). It has no worktreeDir: that marks it pending.
          // `plannedFeature`, not `feature`: readers treat `feature` as "a branch this run owns".
          this.state.branches[m.projectKey] = { source, plannedFeature: sanitizeBranchName(featureRaw), reuse: willReuse,
            ...(startRef ? { startRef } : {}),
            ...(baseMoved ? { baseMoved: true } : {}),
            ...(reuseBase ? { diffBase: reuseBase.sha, diffBaseFrom: reuseBase.against } : {}),
            ...(syncRecord ? { sync: syncRecord } : {}),
            ...(sameAsSource ? { sameAsSource: true } : {}) };
          const info = await createWorktree({
            projectDir: resolve(m.projectDir),              // the REAL dir: git runs here
            pipelineId: this.pipeline.id,
            // detached ⇒ <runRoot>/repos/<projectKey>, uniqueness from the run root.
            // legacy   ⇒ both omitted, so worktree.mjs falls back to its retained
            //            default <projectDir>/.worca-cc/worktrees/<pipelineId> (§10).
            ...(detached ? { baseDir: reposBase, checkoutName: m.projectKey } : {}),
            // startRef (a SHA) only when the shared base must not move (diverged/dirty/in-use):
            // a SHA never auto-tracks, unlike `origin/<base>` (branch.autoSetupMerge).
            sourceBranch: startRef || source,
            featureBranch: featureRaw,
            signal: this.abort.signal,
          });
          // Register EAGERLY (Map.set is synchronous) so teardown always sees it.
          this.workDirs.set(m.projectKey, info.worktreeDir);
          this.branchInfos.set(m.projectKey, info);
          // `source` stays the LOCAL branch name (PR base, chains, metrics read it — C4);
          // info.sourceBranch would echo the startRef SHA on a remote start, so don't use it.
          // A fresh start: a new branch, or (replay) the branch the first attempt created at the
          // start point, which createWorktree now reports as reusedExisting. Only a branch that
          // existed BEFORE this run (willReuse) ignored sourceBranch.
          const freshStart = !willReuse;
          const baseSha = freshStart ? await worktreeHead(info.worktreeDir) : null;
          // A replayed reuse whose branch vanished while paused: createWorktree just re-created it
          // from the source, so its real start is the worktree HEAD, not the recorded fork point.
          const recreated = !freshStart && !info.reusedExisting;
          // THE diff base: where this worktree started — never the project checkout's HEAD, which can
          // sit on any other branch (sync off, up-to-date, no-upstream, a tag/SHA source, a workspace
          // fallback). A reused branch diffs from its fork point (above); with no common history, from
          // its tip, so upstream commits can never read as this run's changes.
          const diffBase = freshStart ? baseSha
            : recreated ? await worktreeHead(info.worktreeDir)
            : (reuseBase?.sha || await worktreeHead(info.worktreeDir));
          if (diffBase && this.checkpointRefs[m.projectKey] !== diffBase) this.checkpointRefs[m.projectKey] = diffBase;
          const keptStart = startRef && freshStart ? startRef : null;   // a reused branch ignored it
          this.state.branches[m.projectKey] = { source, feature: info.branch,
                                                worktreeDir: info.worktreeDir,
                                                reusedExisting: info.reusedExisting,
                                                ...(baseSha ? { baseSha } : {}),
                                                ...(!freshStart && diffBase ? { diffBase, diffBaseFrom: recreated ? null : (reuseBase?.against || null) } : {}),
                                                ...(keptStart ? { startRef: keptStart } : {}),
                                                ...(syncRecord ? { sync: syncRecord } : {}),
                                                ...(this.branchOpts.resolves ? { resolves: this.branchOpts.resolves } : {}),
                                                ...(this.branchOpts.roundOf ? { roundOf: this.branchOpts.roundOf } : {}),
                                                ...(sameAsSource ? { sameAsSource: true } : {}) };
          // Shaper s5 (D14): a feature's next run starts from the moved base. Slice k ≥ 2, single project, fresh branch only.
          const sl = this.runShape && this.runShape.slice;
          if (mergesFeatureBase({ slice: sl, freshStart, isWorkspace: this.isWorkspace })) await this._mergeFeatureBase(m, info, sl);
          const short = (s) => String(s).slice(0, 10);
          if ((freshStart || recreated) && diffBase && (baseMoved || (checkoutHead && diffBase !== checkoutHead))) {
            await appendAudit(this.pipeline.dir, `Diff base for \`${m.projectKey}\` moved to the run's start \`${short(diffBase)}\`.`).catch(() => {});
          } else if (!freshStart && !recreated && diffBase) {
            await appendAudit(this.pipeline.dir, reuseBase
              ? `Diff base for \`${m.projectKey}\` is \`${short(diffBase)}\`, where \`${info.branch}\` forks from \`${reuseBase.against}\` (reused branch).`
              : `Diff base for \`${m.projectKey}\` is the reused branch's tip \`${short(diffBase)}\` (no common commit with \`${source}\`).`).catch(() => {});
          }
          const reuseNote = info.reusedExisting ? ' (resumed existing branch)' : '';
          await appendAudit(this.pipeline.dir,
            `Worktree \`${m.projectKey}\`: \`${info.branch}\` (off \`${keptStart ? `${source} @ ${keptStart.slice(0, 10)}` : source}\`)${reuseNote} at \`${info.worktreeDir}\`.`,
          ).catch(() => {});                                // per-member audit
        } catch (err) {
          setupFailures.push(err);
        }
      });
    } finally {
      this._closeSyncStage();                              // workspace, or a single member that threw
    }
    // Mirror the (possibly moved) diff bases BEFORE the failure throw: a paused setup writes its
    // resume point (single: rp.checkpointRef) / workspace_meta.checkpointRefs from these.
    const primaryKey = this.members[0]?.projectKey;
    if (primaryKey && this.checkpointRefs[primaryKey]) this.checkpointRef = this.checkpointRefs[primaryKey];
    this.state.checkpointRef = this.checkpointRef;
    this.state.checkpointRefs = { ...this.checkpointRefs };
    // Single project: the pending member record rides the persisted `branch` column, so a replay
    // can read it (_pendingStart). The success path below overwrites it with the same object plus
    // the pin, exactly as today. Workspace members persist through workspace_meta.branches.
    if (!this.isWorkspace && primaryKey && this.state.branches[primaryKey]) {
      this.state.branch = { ...this.state.branches[primaryKey], runRootMode: this.runRootMode };
    }
    if (setupFailures.length) {
      for (const w of folderWarns) await this._recordRunWarning(w);
      // A terminal failure (a diverged member under onDiverged 'fail', the feature == source guard)
      // must win over another member's pausable one: pausing would let a resume — which never
      // syncs — start that member from its local diverged base and bypass 'fail'.
      const first = setupFailures.find((e) => isTerminal(e)) || setupFailures[0];
      throw first instanceof Error ? first : new Error(String(first));
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
      this.state.branch = this._primaryMirror(this.state.branches[primary.projectKey]);
    }
    // Minimal manifest, written HERE: the boot sweep and pipeline-delete need member
    // real dirs + worktree paths from the very first detached run, before any context
    // field exists. Legacy runs have no run root and therefore no manifest — the
    // sweeps fall back to the DB columns.
    if (detached) await writeRunManifest(this.runRoot, {
      pipelineId: this.pipeline.id,
      runRootMode: this.runRootMode,
      isWorkspace: this.isWorkspace,
      members: this.members.map((m) => (this._memberWorkMode(m.projectKey) === 'folder'
        ? { projectKey: m.projectKey, projectName: m.projectName, projectDir: resolve(m.projectDir), copyDir: this.workDirs.get(m.projectKey), workMode: 'folder' }
        : {
          projectKey: m.projectKey, projectName: m.projectName,
          projectDir: resolve(m.projectDir),               // the REAL repo — what `git worktree remove` needs
          worktreeDir: this.workDirs.get(m.projectKey),
        })),
    });
    // P5: a Folder member's copy warnings land AFTER the minimal manifest, which replaces run.json (P1's order).
    for (const w of folderWarns) await this._recordRunWarning(w);
    await this._persist();
    this._emit('state', this.getState());
  }

  // ── Folder runs (P1, CONTRACT §2), keyed by member (S23). Single project: the member record is state.branch. ──
  _memberWorkMode(key) {
    if (!this.isWorkspace) return this.workMode;
    return this.memberByKey.get(key)?.workMode === 'folder' ? 'folder' : 'git';   // P5: the recorded per-member mode
  }
  _folderFilesFor(key) { return this.isWorkspace ? folderMemberFiles(this.pipeline.dir, key) : folderFiles(this.pipeline.dir); }
  _folderRecord(key) { return this.isWorkspace ? (this.state.branches?.[key] ?? null) : this.state.branch; }
  /** The member's real folder: its record's realDir, else its projectDir. */
  _folderRealDir(key) {
    const m = this.members.find((x) => x.projectKey === key);
    return this._folderRecord(key)?.realDir || (m?.projectDir ? resolve(m.projectDir) : null);
  }
  /** A Folder run's cwd is still the run's own copy (folderCopyRoot): never a link the agent swapped in at its path. */
  async _folderCopyIntact() {
    if (this.isWorkspace) {
      // P5: a workspace works at the run root; each Folder member's copy must still be the run's own folder. The first
      // copy that is not is kept on `_badFolderCopy`, so the pause names it (the run root names no member).
      this._badFolderCopy = null;
      for (const m of this.members) {
        if (this._memberWorkMode(m.projectKey) !== 'folder') continue;
        const dir = this.workDirs.get(m.projectKey);
        if (dir && !(await folderCopyRoot(dir, { pipelineId: this.pipeline?.id, key: m.projectKey }))) { this._badFolderCopy = dir; return false; }
      }
      return true;
    }
    const key = this.members[0]?.projectKey;
    return !!(this.runCwd && key && (await folderCopyRoot(this.runCwd, { pipelineId: this.pipeline?.id, key })));
  }
  /** P5: the workspace scalar mirror of the primary's record. On a git run (any Git member) a Folder primary's mirror
   *  drops `workMode`: readers that fall back to `state.branch.workMode` (run-kind.mjs workModeOf) must read the RUN's
   *  mode, never the primary member's. An all-Folder workspace keeps it (state.workMode says folder too). */
  _primaryMirror(rec) {
    const { workMode, ...rest } = rec || {};
    return this.workMode === 'git' ? rest : { ...(rec || {}) };
  }
  _setFolderRecord(key, patch) {
    if (this.isWorkspace) {
      const branches = this.state.branches || {};
      this.state.branches = { ...branches, [key]: { ...(branches[key] || {}), ...patch } };
      if (key === this.members[0]?.projectKey) this.state.branch = this._primaryMirror(this.state.branches[key]);   // the scalar mirror
      return;
    }
    this.state.branch = { ...(this.state.branch || {}), ...patch };
    this.state.branches = { ...(this.state.branches || {}), [key]: this.state.branch };
  }

  /** P3: the 'none' arm of _setupRunRoot — the run works in <runRoot>/work; no git, no copy. */
  async _setupNoProjectRoot() {
    this.runRootMode = 'detached';
    this.state.runRootMode = 'detached';
    this.runRoot = join(worcaHome(), 'runs', this.pipeline.id);
    const work = join(this.runRoot, WORK_DIR_NAME);
    await mkdir(this.runRoot, { recursive: true });
    claimRunDir(this.runRoot);                            // G19: this run's owner's agent only
    await mkdir(work, { recursive: true });
    this.workDirs.set(NO_PROJECT_KEY, work);
    this.workDir = work;
    this.runCwd = work;
    this.branchInfo = null;
    this.state.branch = { workMode: 'none', runRootMode: 'detached' };
    await writeRunManifest(this.runRoot, { pipelineId: this.pipeline.id, runRootMode: 'detached', isWorkspace: false, workMode: 'none', members: [] });
    await appendAudit(this.pipeline.dir, `Working folder: \`${work}\` (no project).`).catch(() => {});
    await this._persist();
    this._emit('state', this.getState());
  }

  /** The folder arm of _setupRunRoot: copy each folder member into <runRoot>/repos/<key>. */
  async _setupFolderRunRoot({ replay = false } = {}) {
    this._setupStage('Copying the folder');
    const warns = [];
    this.state.branches = this.state.branches || {};
    if (runRootMode() === 'legacy') this._log('worktree', 'info', 'folder run: the copy lives in the run root (run-root mode legacy ignored)');
    this.runRootMode = 'detached';
    this.state.runRootMode = 'detached';
    this.runRoot = join(worcaHome(), 'runs', this.pipeline.id);
    await mkdir(this.runRoot, { recursive: true });
    claimRunDir(this.runRoot);                            // G19: this run's owner's agent only
    for (const m of this.members) {
      if (this._memberWorkMode(m.projectKey) !== 'folder') continue;
      const copyDir = join(this.runRoot, 'repos', m.projectKey);
      const record = await this._setupFolderMember(m, { copyDir, files: this._folderFilesFor(m.projectKey), replay, onWarn: (w) => warns.push(w) });
      this.workDirs.set(m.projectKey, copyDir);
      this._setFolderRecord(m.projectKey, record);
    }
    const primary = this.members[0];
    const copyDir = this.workDirs.get(primary.projectKey);
    this.workDir = copyDir;
    this.runCwd = this.isWorkspace ? this.runRoot : copyDir;   // P5: a workspace works at the neutral run root
    this.branchInfo = null;
    await writeRunManifest(this.runRoot, {
      pipelineId: this.pipeline.id,
      runRootMode: 'detached',
      workMode: 'folder',
      isWorkspace: this.isWorkspace,
      members: this.members.map((m) => ({ projectKey: m.projectKey, projectName: m.projectName, projectDir: resolve(m.projectDir), copyDir: this.workDirs.get(m.projectKey), workMode: 'folder' })),
    });
    for (const w of warns) await this._recordRunWarning(w);
    await this._persist();
    this._emit('state', this.getState());
  }

  /** Copy one folder member (or keep a replayed copy). A throw is a setup failure (pauses like createWorktree). */
  async _setupFolderMember(m, { copyDir, files, replay = false, onWarn = () => {} } = {}) {
    const realDir = resolve(m.projectDir);
    if (replay && existsSync(copyDir) && existsSync(files.manifest)) {
      this._log('orchestrator', 'info', `setup replay: ${m.projectKey} keeps its copy ${copyDir}`);
      const prev = this._folderRecord(m.projectKey) || {};
      return { workMode: 'folder', runRootMode: 'detached', copyDir, realDir, ...(prev.copied ? { copied: prev.copied } : {}) };
    }
    await rm(copyDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    const { manifest, files: n, bytes } = await copyFolder(realDir, copyDir, { signal: this.abort.signal, onWarn });
    await writeFolderManifest(files.manifest, manifest);
    await appendAudit(this.pipeline.dir, `Folder copied: \`${realDir}\` → \`${copyDir}\` (${n} files, ${sizeLabel(bytes)}).`).catch(() => {});
    return { workMode: 'folder', runRootMode: 'detached', copyDir, realDir, copied: { files: n, bytes } };
  }

  /** Scan the copy, write changes.json + changes.patch, index them. Serialized; never throws. */
  _refreshFolderChanges(key, files) {
    if (this._isWorkspaceScan()) return Promise.resolve(null);   // P5 (S51): a read-only scan writes no Changes
    const run = async () => {
      try {
        const copyDir = this.workDirs.get(key) || null;            // only an attached copy (setup / _reattachCheckouts)
        const manifest = await readFolderManifest(files.manifest);
        // The real folder comes from the member record (DB-backed), never from the manifest's `root`: the pipeline dir is
        // agent-writable under hosted isolation, and later agents read changes.patch.
        const realDir = this._folderRealDir(key);
        if (!manifest || !copyDir || !realDir || !existsSync(copyDir)) return null;
        // The copy root from trusted parts (worca home + run id + key), never its own realpath: an agent that swapped its
        // cwd for a link would otherwise make the link's target the root, and its files would land in changes.patch.
        const copyRoot = await folderCopyRoot(copyDir, { pipelineId: this.pipeline.id, key });
        if (!copyRoot) throw new Error(`the copy is not the run's own folder: ${copyDir}`);
        // An absent engineConfig path counts as worca's (cursorOwns), so it is excluded only when the folder never shipped
        // it: an agent's delete of the folder's own .cursor file stays a change.
        const exclude = this._injectedFor(key, copyDir)
          .filter((e) => e?.kind !== 'engineConfig' || existsSync(join(copyDir, e.path)) || !manifestHas(manifest, String(e.path).split(sep).join('/')))
          .map((e) => String(e.path).split(sep).join('/'));
        const scan = await scanChanges(copyDir, manifest, { realRoot: realDir, exclude, copyRoot });
        const { patch, numstat, truncated } = await buildChangesPatch({ realRoot: realDir, copyDir, manifest, files: scan.files, copyRoot });
        await writeChangesFiles(files, { version: 1, root: realDir, state: 'pending', files: scan.files, counts: scan.counts, patchTruncated: truncated, exclude }, patch);
        this._folderIndexed ??= new Set();
        if (!this._folderIndexed.has(files.changes)) {
          recordArtifact(this.pipeline.id, 'changes', relative(this.pipeline.dir, files.changes).split(sep).join('/'));
          recordArtifact(this.pipeline.id, 'changes-patch', relative(this.pipeline.dir, files.patch).split(sep).join('/'));
          this._folderIndexed.add(files.changes);
        }
        this._setFolderRecord(key, { changes: { state: 'pending', counts: scan.counts } });
        return { files: scan.files, counts: scan.counts, numstat };
      } catch (err) {
        this._log('worktree', 'warn', `changes scan failed: ${err?.message || err}`);
        return null;
      }
    };
    const p = (this._folderTail || Promise.resolve()).then(run, run);
    this._folderTail = p.catch(() => {});
    return p;
  }

  /** The refresh, then the settle rule (P1b S7): a settled run that changed nothing releases its copy. */
  async _finalizeFolderMember(key, files, { stage = false } = {}) {
    if (this._isWorkspaceScan()) return null;                    // P5 (S51): a read-only scan writes no Changes
    void stage;
    const r = await this._refreshFolderChanges(key, files);
    if (!r) return null;
    const settled = ['done', 'stopped', 'error'].includes(this.state.status);
    const state = !settled || r.files.length ? 'pending' : 'discarded';
    if (state !== 'pending') await this._settleFolderState(key, files, state);
    return r;
  }

  /** Write a settled state into the member record and changes.json. */
  async _settleFolderState(key, files, state) {
    const rec = this._folderRecord(key) || {};
    this._setFolderRecord(key, { changes: { ...(rec.changes || {}), state } });
    const cur = await readChangesFile(files.changes);
    if (cur) {
      // a random name created exclusively: a link planted at a fixed `.tmp` in the agent-writable pipeline dir is never followed
      const tmp = `${files.changes}.${randomUUID().slice(0, 8)}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify({ ...cur, state }, null, 2) + '\n', { flag: 'wx' });
        await rename(tmp, files.changes);
      } catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
    }
  }

  /** The folder arm of _buildResults (single project): results.json from the copy's changes. */
  async _buildFolderResults({ stage = false } = {}) {
    if (this.isWorkspace) return this._buildFolderWorkspaceResults({ stage });
    const key = this.members[0].projectKey;
    const files = this._folderFilesFor(key);
    const reviews = readPipelineExtras(this.pipeline.id).reviews || [];
    const r = await this._finalizeFolderMember(key, files, { stage });
    if (!r) return;
    let summary = null;
    if (r.files.length || !stage) {
      const results = assembleResults({ nameStatus: folderNameStatus(r.files), numstat: r.numstat, reviews });
      const memory = this.memorySummary();
      if (memory) results.memory = memory;
      await persistResults(this.pipeline.dir, results);
      summary = results.summary;
    }
    this.state.runSize = sizeOfChange(summary);
    await this._persist();
  }

  /** P5: every Folder member's finalized changes as results entries ({ projectKey, results }), in member order. */
  async _folderMemberResults({ stage = false, reviews = [] } = {}) {
    const out = [];
    for (const m of this.members) {
      if (this._memberWorkMode(m.projectKey) !== 'folder') continue;
      const r = await this._finalizeFolderMember(m.projectKey, this._folderFilesFor(m.projectKey), { stage });
      if (!r) continue;
      out.push({ projectKey: m.projectKey, listed: r.files.length > 0, results: assembleResults({ nameStatus: folderNameStatus(r.files), numstat: r.numstat, reviews }) });
    }
    return out;
  }

  /** P5: the all-Folder workspace arm of _buildFolderResults — the workspace results shape (perProject + rollup). */
  async _buildFolderWorkspaceResults({ stage = false } = {}) {
    const reviews = readPipelineExtras(this.pipeline.id).reviews || [];
    const members = await this._folderMemberResults({ stage, reviews });
    if (!members.length) return;
    let summary = null;
    if (members.some((x) => x.listed) || !stage) {
      const perProject = buildPerProject(members.map(({ projectKey: k, results }) => ({ projectKey: k, results })));
      const memory = this.memorySummary();
      const results = { summary: rollupSummary(perProject), perProject, ...(memory ? { memory } : {}) };
      await persistResults(this.pipeline.dir, results);
      summary = results.summary;
    }
    this.state.runSize = sizeOfChange(summary);
    await this._persist();
  }

  /** The folder arm of _teardownRunRoot: rescue + remove worca's mounts, keep a pending copy. */
  async _teardownFolderMember(key) {
    const files = this._folderFilesFor(key);
    const rec = this._folderRecord(key) || {};
    const copyDir = rec.copyDir || this.workDirs.get(key) || null;
    const pipelineDir = this.pipeline?.dir || null;
    // Only the run's own folder counts as the copy: a link swapped in at its path (or above) is never rescued from,
    // cleaned, scanned or kept — the run ends as if the copy were gone.
    const exists = !!copyDir && !!(await folderCopyRoot(copyDir, { pipelineId: this.pipeline?.id, key }));
    if (!exists && copyDir && existsSync(copyDir)) await this._recordRunWarning(`the copy at ${copyDir} is not the run's own folder — its changes were not kept`);
    if (exists) {
      const rescued = await rescueModifiedMounts({
        baseDir: copyDir, entries: this.injectedPaths?.[key] ?? [], pipelineDir, scope: key, pipelineId: this.pipeline?.id,
      });
      for (const w of rescued) await this._recordRunWarning(w);
      await removeInjectedPaths(copyDir, this._injectedFor(key, copyDir));
      if (!this._folderRecord(key)?.changes) await this._finalizeFolderMember(key, files, { stage: true });
    }
    const now = this._folderRecord(key) || {};
    // Kept unless settled: a copy whose changes were never listed (every scan failed, or a teardown before the copy
    // was re-attached) stays under folder-apply; only discarded / applied, or no manifest (setup never finished), lets go.
    // P5 (S51): a read-only scan writes no Changes and keeps no copy — never pending, so the run root goes with rmGuarded.
    const pending = !this._isWorkspaceScan() && exists && existsSync(files.manifest) && now.changes?.state !== 'discarded' && now.changes?.state !== 'applied';
    if (pending && !now.changes) await this._recordRunWarning(`changes could not be listed — the copy is kept at ${copyDir}`);
    if (!exists && now.changes?.state === 'pending') await this._settleFolderState(key, files, 'discarded');
    if (pending && now.changes && pipelineDir) {
      const c = now.changes.counts || {};
      const n = (c.added | 0) + (c.modified | 0) + (c.deleted | 0);
      await appendAudit(pipelineDir, `${n} changed file(s) kept on the copy until Apply to folder or Discard.`).catch(() => {});
    }
    this.workDirs.delete(key);
    return { pending, copyDir };
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
  /**
   * Team policy (design §6, §9): the document that governs this run, folded for its kind
   * (workspaceRuns for a workspace target), plus the off-policy findings the run log names
   * once. Cache-first: only a project with no cache at all pays one bounded fetch. A missing,
   * unreadable or unsupported policy means local settings apply — loudly, never an abort.
   * Sets `this.policyRun` = { home, sha, fields, deviations, unattended } or null.
   */
  async _resolvePolicy() {
    this.policyRun = null;
    this._policyPersisted = false;
    this._policyWarned = new Set();
    if (this.workMode === 'none') return;   // P3-D4: no project, no team policy
    let r;
    try {
      r = this.isWorkspace
        ? await resolveWorkspacePolicy(this.workspace?.id, { discover: 'if-missing' })
        : await resolveProjectPolicy(this.projectDir, { discover: teamRunDiscover(this.workMode, this.projectDir) });
    } catch (err) {
      this._log('policy', 'warn', `team policy could not be read (${err?.message || err}); your local settings apply`);
      return;
    }
    if (!r.ok) {
      if (r.reason === 'delegate-invalid' || r.reason === 'home-stale' || r.reason === 'unsupported' || r.code === 'DOC_UNKNOWN') {
        this._log('policy', 'warn', `team policy not applied — ${r.detail || r.reason}; your local settings apply`);
      }
      return;
    }
    const fields = fieldsForRun(r.doc, { workspaceRun: this.isWorkspace });
    let installed = {};
    try { installed = installedPluginsMap(); } catch { /* no plugins root yet */ }
    let metricsRecord = null;
    try { const tm = readTeamMetricsPrefs(projectKey(this.projectDir)); metricsRecord = tm ? tm.record !== false : null; } catch { /* optional */ }
    const stepModels = Object.entries(this.stepModels || {}).map(([role, sel]) => ({ role, model: sel?.model }));
    // A per-run overlay's picks (the Ask run card) run on their nodes: an off-policy one is recorded like a role's
    // (the manifest is in state before this runs, and restored on resume; deviationsFor counts a model once).
    stepModels.push(...overlayStepModels(this.state && this.state.stepper));
    const deviations = deviationsFor(fields, {
      guardrailsId: this.guardrailsId, guardrailSet: this.guardrails ? { settings: this.guardrails } : null,
      stepModels, installed, worcaVersion: POLICY_WORCA_VERSION, metricsRecord,
      tags: this._policyTags(),
    });
    this.policyRun = { home: r.home, homeDir: r.homeDir, sha: r.sha, fields, deviations: deviations.map((d) => d.code), unattended: !!this.auto };
    for (const w of r.warnings || []) this._log('policy', 'warn', `team policy ${r.home}: ${w}`);
    const cap = fields['cost.pipelineLimitUsd'];
    const tot = fields['cost.totalLimitUsd'];
    const caps = [cap ? `pipeline cap $${Number(cap.value).toFixed(2)} (${cap.kind}${cap.kind === 'soft' ? `, ${cap.onBreach || 'pause'}` : ''})` : null,
      tot ? `total cap $${Number(tot.value).toFixed(2)} (${tot.kind})` : null].filter(Boolean).join(' · ');
    this._log('policy', 'info', `team policy ${r.home}${r.sha ? ` @ ${String(r.sha).slice(0, 7)}` : ''}${r.delegated ? ` (followed by ${r.from})` : ''}${this.isWorkspace && Object.keys(r.doc.workspaceRuns || {}).length ? ' · workspace-run values' : ''}${caps ? ` · ${caps}` : ''}`);
    for (const d of deviations) this._log('policy', d.level === 'warn' ? 'warn' : 'info', `off-policy: ${d.text}`);
    if (this.auto && ((cap?.kind === 'soft' && (cap.onBreach || 'pause') === 'pause') || (tot?.kind === 'soft' && (tot.onBreach || 'pause') === 'pause'))) {
      this._log('policy', 'info', 'unattended run: a team soft cap warns instead of pausing (nobody can click "continue past")');
    }
    // Workspace runs never union member policies (design §6): say so once when a member is tighter.
    if (this.isWorkspace && cap) {
      for (const m of this.members || []) {
        try {
          const mr = await resolveProjectPolicy(m.projectDir, { discover: false });
          if (!mr.ok || mr.home === r.home) continue;
          const mc = fieldsForRun(mr.doc)['cost.pipelineLimitUsd'];
          if (mc && mc.value < cap.value) this._log('policy', 'info', `member ${mr.from} carries a tighter pipeline cap ($${Number(mc.value).toFixed(2)}, ${mr.home}); the workspace policy applies to this run`);
        } catch { /* informational only */ }
      }
    }
  }

  /** The tags policy checks read (D5): a resumed harness gets no opts.tags, so read the stored ones. */
  _policyTags() {
    if (this.resumeOpts && this.pipeline?.id) { try { return readRunTags(this.pipeline.id); } catch { return []; } }
    return Array.isArray(this.opts.tags) ? this.opts.tags : [];
  }

  /** Settings tag dimensions (D8): the policy sets none for this run, so a missing required key is a run-log warning only. */
  _noteLocalTagDimensions() {
    if (this.policyRun?.fields?.['runs.tagDimensions']) return;          // deviationsFor recorded it
    let dims = [];
    try { dims = userTagDimensions(); } catch { return; }
    for (const d of missingRequired(dims, this._policyTags())) {
      this._log('policy', 'warn', `${d.label} (${d.key}) is a required tag in your Settings and was not set. The run proceeds.`);
    }
  }

  /** First persist of the run's policy state (needs the pipeline row); later writes merge. */
  _persistPolicyState(patch = {}) {
    if (!this.pipeline?.id || !this.policyRun) return;
    const base = this._policyPersisted ? {} : { home: this.policyRun.home, sha: this.policyRun.sha, deviations: this.policyRun.deviations, unattended: this.policyRun.unattended };
    this._policyPersisted = true;
    try { writePolicyState(this.pipeline.id, { ...base, ...patch }); } catch (err) { this._log('policy', 'warn', `could not record policy state: ${err?.message || err}`); }
  }

  /**
   * Engine gate. A non-Claude engine runs
   * only what it can govern, and says what it cannot. Refused before any spawn
   * (_engineRefusal): guardrail permission rules it cannot enforce (unless this run
   * passed allowUnguardedEngine), a node that needs MCP tools, and a model routed to
   * a custom endpoint or through the model bridge (both speak the Anthropic API to
   * Claude Code). Every capability the engine lacks becomes one warn log line, and so
   * does every Claude model the run names (the engine runs its own default model
   * instead, see _engineModel); the returned lines are the audit trail's copy.
   * @param {object[]} [nodes] the run's node ctxs; a resume passes the ones
   *   _engineResumeGate read off its point, since its graph is not restored yet
   * @returns {string[]}
   */
  _engineGate(nodes = Object.values(this.resolved?.nodeCtx || {})) {
    const name = this.claude.engine || 'claude';
    // Product, not security: the run's own model (--model / the start body) naming another engine's model is refused,
    // never dropped — dropping it would run every node on the CLI default model, often the most expensive one. Another
    // engine drops a Claude model per node instead (the model lines below).
    if (name === 'claude') {
      const foreign = foreignRunModel(this.claude.model, name, this.projectDir);
      if (foreign) throw engineRefusal(name, foreign);
    }
    const projectRules = this._engineProjectRules ?? null;
    const why = this._engineRefusal({ rules: this.guardrailPermissionRules, guardrailsId: this.guardrailsId, projectRules, nodes });
    if (why) throw engineRefusal(name, why);
    // Decision 11: the sub-agent tool is switched off on every spawn unless the catalog proves sub-agents keep the rules.
    this._subagentsOff = subagentPolicy(name) === 'deny';
    const caps = getEngine(name).capabilities;
    const lines = Object.entries(caps).filter(([, v]) => v === false)
      .map(([k]) => `engine ${name}: no ${k} — ${CAPABILITY_FALLBACKS[k] || 'not available'}`);
    // With a cost cap a run worca cannot price was refused above (_costCapRefusal); without one, a node model with no
    // price is named once (its spend is booked as cost unknown, never $0).
    if (caps.cost !== false) {
      for (const m of new Set(nodes.filter((n) => !n?.kind || n.kind === 'agent').map((nc) => this._nodeModelPair(nc).model).filter(Boolean))) {
        if (!modelPricedOn(name, m)) lines.push(`engine ${name}: model "${m}" has no price — its spend is booked as cost unknown`);
      }
    }
    if (caps.permissionRules === false && hasPermissionRules(this.guardrailPermissionRules)) {
      lines.push(`engine ${name}: guardrail set "${this.guardrailsId}": permission rules NOT enforced on ${name} (--allow-unguarded-engine)`);
    }
    if (caps.permissionRules === false && hasPermissionRules(projectRules)) {
      lines.push(`engine ${name}: the project's .claude/settings.json deny rules NOT enforced on ${name} (--allow-unguarded-engine): ${ruleList(projectRules)}`);
    }
    if (caps.permissionRules !== false) {
      // An engine that holds part of the rules: say which it holds, which it holds only in part and which it does
      // not (those two passed the gate only with --allow-unguarded-engine). One that holds them all says nothing.
      const both = (f) => [...new Set([...f(this.guardrailPermissionRules), ...f(projectRules)])];
      const partial = both((r) => this._enginePartial(r));
      const gSkip = this._engineUnenforced(this.guardrailPermissionRules);
      const pSkip = this._engineUnenforced(projectRules);
      const enforced = both((r) => (Array.isArray(r?.deny) ? r.deny : []).filter((x) => !this._engineUnenforced(r).includes(x) && !this._enginePartial(r).includes(x)));
      if (enforced.length && (partial.length || gSkip.length || pSkip.length)) lines.push(`engine ${name}: deny rules enforced on ${name}: ${ruleNames(enforced)}`);
      if (partial.length) lines.push(`engine ${name}: deny rules held on ${name} only in part, as ${this._enginePartialKind()} — ${this._engineRuleReach()} (--allow-unguarded-engine): ${ruleNames(partial)}`);
      if (gSkip.length) lines.push(`engine ${name}: guardrail set "${this.guardrailsId}": rules NOT enforced on ${name} (--allow-unguarded-engine): ${ruleNames(gSkip)}`);
      if (pSkip.length) lines.push(`engine ${name}: the project's .claude/settings.json deny rules NOT enforced on ${name} (--allow-unguarded-engine): ${ruleNames(pSkip)}`);
      // Decision 10, one baseline for every shell engine: path rules bind the engine's own tools, never its shell.
      const shellPaths = both((r) => ruleSupport(name, r).shellPaths);
      if (shellPaths.length) lines.push(`engine ${name}: path rules (${ruleNames(shellPaths)}) bind ${name}'s own tools; its shell can still reach those paths`);
    }
    // The host guard is a Claude Code hook (hookTelemetry): every engine without hooks is told so, rules or not.
    if (caps.hookTelemetry === false && hostGuardEnabled()) lines.push(`engine ${name}: the host-guard hook does not run on ${name} (its preamble still does)`);
    if (this._subagentsOff) {
      const tool = engineEntry(name)?.subagents?.tool;
      lines.push(`engine ${name}: its sub-agent tool (${tool}) is off: its sub-agents are not proven to keep this run's rules`);
    } else if (subagentPolicy(name) === 'refuse') {
      lines.push(`engine ${name}: its sub-agents (${engineEntry(name)?.subagents?.tool}) may not keep this run's rules and cannot be switched off (--allow-unguarded-engine)`);
    }
    // How a local run signs its model calls (credentials.mjs resolveModelRoute): a credential from worca's own env is
    // named once per run (a resume gate does not repeat it). A remote run's decision has no warning (the relay signs).
    const signIn = !this._execBackend && !this.claude.mock
      ? resolveModelRoute({ engine: name, serverEnv: process.env, broker: { on: brokerEnabled() }, checkModel: false }) : null;
    if (signIn?.warning && !this._signInWarned) { this._signInWarned = true; this._log('orchestrator', 'warn', signIn.warning); }
    // Decision 3: what the allowlist keeps from this engine, named once (never a value).
    if (!this.claude.mock) {
      const dropped = formatDropped(name, childEnv({ engine: name, signInMode: signIn?.signInMode ?? null, allowlist: this.guardrails?.envAllowlist || [] }).dropped);
      if (dropped) lines.push(dropped);
    }
    // Decision 4: a local run on this machine is no sandbox, and says so.
    if (!this.claude.mock && !this._execBackend && detectDeployment() === 'local') lines.push(NATIVE_NOTICE);
    // A node model this harness cannot run (its connection reaches other harnesses only) is dropped, and said so.
    for (const m of this._engineGateModels(nodes)) {
      const harnesses = enginesOfModel(m, { projectDir: this.projectDir });
      if (!harnesses || harnesses.includes(name)) continue;
      if (this._engineModel(m)) continue;   // copilot runs a Claude id the catalog does not hold (its own naming) as named
      const what = `model "${m}" runs on ${harnesses.map(engineLabel).join(' or ')}`;
      lines.push(name === 'codex'
        ? `engine ${name}: ${what} — the nodes that name it run on ${name}'s default model, ${CODEX_DEFAULT_MODEL}`
        : harnesses.includes('claude')
          ? `engine ${name}: ${what} — the nodes that name it run on ${name}'s default model, so their cost stays unknown`
          : `engine ${name}: ${what} — the nodes that name it run on ${name}'s default model`);
    }
    // A remote run's model relay checks each call's model only where the catalog says it can (relay.modelCheck 'body').
    const relay = engineEntry(name)?.relay;
    if (this._execBackend && relay && relay.modelCheck !== 'body') {
      lines.push(`engine ${name}: the model relay does not check which model each call names (${relay.protocol === 'connect' ? 'the model is inside protobuf' : 'its side calls are not pinned yet'})`);
    }
    for (const l of lines) this._log('orchestrator', 'warn', l);
    return lines;
  }

  /** With a pipeline or total cost cap set (local settings, or the team policy once resolved), refuse a run whose cost
   *  worca cannot count: its engine reports none, or a model it will run has no price. Without a cap, null (the gate
   *  warns). `models`: the run's effective model and every agent node's effective spawn model (null: the CLI's default). */
  _costCapRefusal(name, models) {
    const teamFields = this.policyRun?.fields || {};
    const pipe = effectiveCap({ local: pipelineCostLimitUsd(this._settingsScope()), team: teamFields['cost.pipelineLimitUsd'] || null });
    const tot = effectiveCap({ local: totalCostLimitUsd(), team: teamFields['cost.totalLimitUsd'] || null });
    if (pipe.cap == null && tot.cap == null) return null;
    // The one rule and wording a chat's per-turn cap uses too (pricing.mjs).
    return costCapRefusal(name, models, pipe.cap != null ? 'pipeline' : 'total');
  }

  /**
   * Why this run's engine refuses the run, or null. PURE over its arguments and the
   * run's options. `rules` are the guardrail set's permission rules; `projectRules` the
   * deny rules of the members' own `.claude/settings.json` (Claude Code reads that file
   * itself, another engine does not), from _engineChecks.
   */
  _engineRefusal({ rules, guardrailsId, projectRules = null, nodes, allowed = this._allowUnguardedEngine }) {
    const name = this._engineName();
    const caps = getEngine(name).capabilities;
    // The credential broker's promise is that worca holds no model credential; this engine
    // signs in with its own, which the broker can neither bill nor revoke.
    const brokerRefusal = brokerEngineRefusal(name);
    if (brokerRefusal) return brokerRefusal;
    // A step with no model (decision: plans/core-protection-layer-design.md §4.2): an engine that needs one is refused
    // at start, before anything spawns. Not overridable (allowUnguardedEngine has no say over a missing model).
    const entry = engineEntry(name);
    const remoteRun = !!this._execBackend;
    const agentNodes = (nodes || []).filter((n) => !n?.kind || n.kind === 'agent');
    for (const nc of agentNodes) {
      if (this._nodeModelPair(nc).model || entry?.defaultModel) continue;
      if (entry?.requiresExplicitModel) return `${entry.label} needs a model; pick one for this step.`;
      if (entry?.relay?.needsModel && remoteRun) return `${entry.label} in a sandbox needs a model; pick one for this step.`;
      if (entry?.relay?.needsModel && brokerEnabled() && !brokerEngineRefusal(name)) return `${entry.label} under the credential broker needs a model; pick one for this step.`;
    }
    // A cost cap that cannot count what this run spends (plans/core-protection-layer-design.md §4.3): refused at start.
    const capWhy = this._costCapRefusal(name, [this._engineModel(this.claude.model) ?? null, ...agentNodes.map((nc) => this._nodeModelPair(nc).model ?? null)]);
    if (capWhy) return capWhy;
    // The CLI's wording, like "pass --allow-unguarded-engine" (engineRefusalFor rewords both for the UI and chat). A resume
    // keeps the set its run pinned (`worca resume` takes no --guardrails), so only a new run can pick Permissive.
    const permissive = this.resumeOpts ? 'start a new run with --guardrails permissive' : 'run it with --guardrails permissive';
    if (caps.permissionRules === false && hasPermissionRules(rules) && !allowed) {
      return `guardrail set "${guardrailsId}" has permission rules this engine cannot enforce — ${permissive}, or pass --allow-unguarded-engine to run it without them`;
    }
    if (caps.permissionRules === false && hasPermissionRules(projectRules) && !allowed) {
      return `the project's .claude/settings.json denies ${ruleList(projectRules)}, which this engine cannot enforce — pass --allow-unguarded-engine to run it without them`;
    }
    const gSkip = caps.permissionRules === false ? [] : this._engineUnenforced(rules);
    if (gSkip.length && !allowed) {
      return `guardrail set "${guardrailsId}" has permission rules this engine cannot enforce (${ruleNames(gSkip)}) — ${permissive}, or pass --allow-unguarded-engine to run it without them`;
    }
    const pSkip = caps.permissionRules === false ? [] : this._engineUnenforced(projectRules);
    if (pSkip.length && !allowed) {
      return `the project's .claude/settings.json denies ${ruleNames(pSkip)}, which this engine cannot enforce — pass --allow-unguarded-engine to run it without them`;
    }
    // Some rules hold only in part (the adapter's ruleKind/ruleReach; codex: CODEX_COMMAND_RULE_REACH): running on them is
    // a choice, like running without a rule.
    const gPart = caps.permissionRules === false ? [] : this._enginePartial(rules);
    if (gPart.length && !allowed) {
      return `guardrail set "${guardrailsId}" has ${this._enginePartialKind()} this engine holds only in part (${ruleNames(gPart)}): ${this._engineRuleReach()} — ${permissive}, or pass --allow-unguarded-engine to run it with them as a partial guard`;
    }
    const pPart = caps.permissionRules === false ? [] : this._enginePartial(projectRules);
    if (pPart.length && !allowed) {
      return `the project's .claude/settings.json denies ${ruleNames(pPart)}, which this engine holds only in part: ${this._engineRuleReach()} — pass --allow-unguarded-engine to run it with them as a partial guard`;
    }
    // Decision 11: sub-agents not proven to keep the rules, on an engine that cannot switch its sub-agent tool off.
    if (subagentPolicy(name) === 'refuse' && !allowed) {
      return `this engine's sub-agents (its ${engineEntry(name)?.subagents?.tool} tool) are not proven to keep the run's rules, and it cannot switch that tool off — pass --allow-unguarded-engine to run it anyway`;
    }
    if (caps.mcpTools === false) {
      const n = nodes.find((nc) => Array.isArray(nc?.tools) && nc.tools.some((t) => String(t).startsWith('mcp__')));
      if (n) return `node "${n.key || n.nodeId}" needs MCP tools, which this engine cannot attach`;
    }
    // A model routed to a custom endpoint or through the model bridge speaks the Anthropic API for Claude Code.
    // A Claude model never runs on another engine anyway (_engineModel drops it, and the audit says so), so
    // only a routed model this engine itself owns is refused — except a Codex model on its own
    // OpenAI-compatible endpoint, which codex connects to itself (engines/codex-endpoint.mjs).
    for (const m of this._engineGateModels(nodes)) {
      if (modelRunsOn(m, name, { projectDir: this.projectDir }) !== false) continue;   // its connection reaches this harness
      if ((modelHasBaseUrlRouting(m) || bridgedModelInfo(m)) && engineOfModel(m, { projectDir: this.projectDir }) === name) {
        return `model "${m}" is routed to a custom endpoint for Claude Code and cannot run on ${name}`;
      }
    }
    return null;
  }

  /** The deny rules of `rules` this run's engine cannot hold (engines/index.mjs ruleSupport `refused`: the catalog's
   *  unenforced, unverified and unlisted kinds and what the adapter cannot translate; every rule on an engine without
   *  permission rules). */
  _engineUnenforced(rules) {
    if (!hasPermissionRules(rules)) return [];
    if (getEngine(this._engineName()).capabilities.permissionRules === false) return Object.values(rules).flat().filter((r) => typeof r === 'string');
    return ruleSupport(this._engineName(), rules).refused;
  }

  /** The deny rules of `rules` this run's engine holds only in part (ruleSupport `partial`; codex: command rules). */
  _enginePartial(rules) {
    if (!hasPermissionRules(rules)) return [];
    return getEngine(this._engineName()).capabilities.permissionRules === false ? [] : ruleSupport(this._engineName(), rules).partial;
  }

  /** This run's engine (the catalog's default when none is named). */
  _engineName() { return this.claude.engine || DEFAULT_ENGINE; }

  /** In words, how far this run's engine holds the rules it holds only in part (the adapter's `ruleReach`). */
  _engineRuleReach() {
    return getEngine(this.claude.engine || 'claude').ruleReach || CODEX_COMMAND_RULE_REACH;
  }

  /** What this run's engine turns partly-held deny rules into (the adapter's `ruleKind`): codex's are command rules;
   *  copilot also holds Edit/Write path rules in part (its write rules skip the shell); cursor's are permission-file rules. */
  _enginePartialKind() {
    return getEngine(this.claude.engine || 'claude').ruleKind || 'command rules';
  }

  /** The distinct models a run names: the run's own, then each node's. */
  _engineGateModels(nodes) {
    return [...new Set([this.claude.model, ...nodes.map((nc) => nc?.model)].filter(Boolean))];
  }

  /**
   * The engine gate's refusals for a resume, checked BEFORE resume()'s try (like
   * _engineRehydrate): a refusal rejects resume() and leaves the paused row, its
   * resume point and its checkout as they were, so the user can resume again with
   * the missing flag. Reads the guardrail set the point names without logging, and
   * the nodes through _engineGateNodes. Returns those nodes for the gate's audit lines.
   * @returns {Promise<object[]>}
   */
  async _engineResumeGate(rp) {
    const name = this._engineName();
    const { id, rules, projectRules } = await this._engineSetRules(rp.guardrailsId || 'permissive');
    const nodes = await this._engineGateNodes(rp);
    const why = this._engineRefusal({ rules, guardrailsId: id, projectRules, nodes });
    if (why) throw engineRefusal(name, why);
    this.mcpOptOut = Array.isArray(rp.mcpOptOut) ? rp.mcpOptOut : [];
    await this._engineMcpGate();
    return nodes;
  }

  /**
   * The rules the gate weighs, read the way _resolveGuardrails reads them (the set, else
   * Permissive; one honorProjectSettings for every member) but without logging the
   * fallback: the set's permission rules, and through _engineChecks the engine's
   * preflight and the deny rules of each honoring member's own .claude/settings.json.
   */
  async _engineSetRules(guardrailsId, { quiet = false } = {}) {
    const id = guardrailsId || 'permissive';
    const set = (await readGuardrailSet(id)) || (await readGuardrailSet('permissive'));
    const rules = guardrailsToPermissionRules(unionGuardrails([set.settings]));
    const honor = set.settings.honorProjectSettings !== false;
    this._engineProjectRules = await this._engineChecks(() => honor, { quiet, guardrails: unionGuardrails([set.settings]) });
    return { id, rules, projectRules: this._engineProjectRules };
  }

  /**
   * The engine gate's run-start refusals that need no resolved graph — the credential
   * broker, the engine's own preflight (codex missing or signed out), the guardrail set's
   * and the project's rules, the MCP registry layer — checked before the run exists, so
   * the UI server can answer at once instead of through the run's error event. run()
   * checks them all again, with the node-level ones and the team policy's MCP copies.
   * Null when the gate lets the run through, or when the check itself failed for another
   * reason (run() then reports that on the run); else the refusal and whether
   * allowUnguardedEngine would lift it.
   * @returns {Promise<{error:string, overridable:boolean}|null>}
   */
  async engineStartRefusal() {
    return this._engineEarlyRefusal(this.guardrailsId, async () => []);
  }

  /**
   * engineStartRefusal for a resume: the same refusals _engineResumeGate makes, read off
   * the resume point (its guardrail set, its frozen agent nodes, its MCP opt-outs), so the
   * UI server can answer a refused resume — a switch to another engine, say — before it
   * replies, instead of through the run's error event. Null on Claude, or when the gate
   * lets the resume through.
   * @returns {Promise<{error:string, overridable:boolean}|null>}
   */
  async engineResumeRefusal() {
    const rp = this.resumeOpts?.resumePoint;
    if (!rp) return null;
    this.mcpOptOut = Array.isArray(rp.mcpOptOut) ? rp.mcpOptOut : [];
    return this._engineEarlyRefusal(rp.guardrailsId || 'permissive', () => this._engineGateNodes(rp));
  }

  /** This run target's Team set input from the policy cache (mcp/registry.mjs cachedTeamFor); null when none or unreadable. */
  async _cachedTeam() {
    try {
      const t = await cachedTeamFor(this.isWorkspace ? { workspaceId: this.workspace?.id } : { projectKey: this.members[0]?.projectKey });
      return t?.required?.length ? { home: t.home, required: t.required } : null;
    } catch { return null; }
  }

  /** The shared body of engineStartRefusal / engineResumeRefusal. */
  async _engineEarlyRefusal(guardrailsId, gateNodes) {
    const name = this._engineName();
    let args, mcp;
    try {
      const { id, rules, projectRules } = await this._engineSetRules(guardrailsId, { quiet: true });
      args = { rules, guardrailsId: id, projectRules, nodes: await gateNodes() };
      // The run's team policy is resolved only once it runs: before that, the copies its Team set
      // attaches come from the policy cache, as the previews read them.
      const team = this.policyRun ? undefined : await this._cachedTeam();
      mcp = this._engineMcpRefusal((await this._resolveMcp(new Set(), { team }))?.result);
    } catch (err) {
      // The preflight's refusal (codex missing or signed out): the consent cannot lift it.
      if (err?.engineRefused) return { error: err.message, overridable: false };
      return null;
    }
    const strict = this._engineRefusal(args) || mcp;
    if (!strict) return null;
    const lenient = this._engineRefusal({ ...args, allowed: true }) || mcp;
    return lenient
      ? { error: `engine ${name}: ${lenient}`, overridable: false }
      : { error: `engine ${name}: ${strict}`, overridable: true };
  }

  /**
   * MCP registry layer on an engine that cannot attach MCP servers (§10.3): the copies a
   * project or the team policy attaches would silently go missing, so the run is refused
   * before any spawn. The layer is resolved here only to look (a store read, no network);
   * _assembleContext resolves it for the run, and refuses too if this early look missed a
   * copy (a resume, whose team policy is resolved later).
   */
  async _engineMcpGate() {
    const why = this._engineMcpRefusal((await this._resolveMcp(new Set()))?.result);
    if (why) throw engineRefusal(this.claude.engine, why);
  }

  /** What a non-Claude run's agents will not get of the merged MCP servers: a granted server that is not in mcp.json
   *  (Claude Code would load it on its own), and the servers in mcp.json the engine cannot attach, by the adapter's
   *  reason (a registry copy among them is refused instead, _engineMcpRefusal). The checkout's committed
   *  .mcp.json servers Claude Code has approved are in mcp.json on every such engine, so they meet the same checks;
   *  the others are named by the run context (run-context.mjs attachCommittedMcp). Never throws. */
  _engineMcpWarnings(rc) {
    const name = this._engineName();
    if (!rc) return [];
    let written = {};
    try { if (rc.mcpConfigPath) written = JSON.parse(readFileSync(rc.mcpConfigPath, 'utf8'))?.mcpServers || {}; } catch { /* unreadable: nothing to say */ }
    const out = [];
    // An engine that loads Claude Code's own servers itself (catalog `loadsClaudeMcp`) misses none of them.
    const native = engineEntry(name)?.loadsClaudeMcp ? [] : (rc.mcpServerNames || []).filter((n) => !Object.hasOwn(written, n));
    if (native.length) out.push(`engine ${name}: MCP servers Claude Code loads on its own are not attached on ${name}: ${native.join(', ')}`);
    const unattachable = getEngine(name).unattachableMcp;
    const problems = typeof unattachable === 'function' ? unattachable(written) : [];
    if (problems.length) out.push(`engine ${name}: MCP servers not attached on ${name} — ${describeUnattachableMcp(name, problems)}`);
    return out;
  }

  /** Why this run's engine refuses these MCP registry copies ({copies, servers}: a registry result), or null:
   *  the copies the adapter cannot attach, grouped by its reason (Codex attaches stdio servers only, for one). */
  _engineMcpRefusal(layer) {
    const name = this._engineName();
    const copies = layer?.copies;
    if (!copies?.length) return null;
    if (getEngine(name).capabilities.mcpTools === false) {
      return `this run attaches MCP servers (${copies.map((c) => c.name).join(', ')}), which this engine cannot attach`;
    }
    const unattachable = getEngine(name).unattachableMcp;
    if (typeof unattachable !== 'function') return null;
    const servers = layer.servers || {};
    const problems = unattachable(Object.fromEntries(copies.map((c) => [c.name, servers[c.name]])));
    if (!problems.length) return null;
    return `this run attaches MCP servers ${name} cannot attach — ${describeUnattachableMcp(name, problems)}`;
  }

  /**
   * Whether this Codex run needs codex's own sign-in (codexPreflight `signIn`). It does not when every
   * Codex model its spawns can name runs on its own endpoint (engines/codex-endpoint.mjs): the run's
   * model, each step's and workflow node's, the helper jobs' Codex models (title, overview, PR
   * description, memory defragment) and the Away-mode decider's. A helper with no model set, like a
   * run with none, runs codex's default model, which needs the sign-in; so does an Auto run, whose
   * classifier may pick any Codex model. Never throws: anything unreadable counts as "needs it".
   */
  async _codexNeedsSignIn() {
    try {
      if (this.workflowId === AUTO_WORKFLOW_ID) return true;
      return ![...await this._engineSpawnModels('codex', CODEX_DEFAULT_MODEL)].every((m) => hasCodexEndpoint(m));
    } catch {
      return true;
    }
  }

  /**
   * Whether some spawn of this OpenCode run names no model (opencodePreflight `defaultModel`), so OpenCode would pick
   * its own default, possibly a free OpenCode Zen model. Never throws: anything unreadable counts as "some spawn does".
   */
  async _opencodeOnDefaultModel() {
    try {
      return (await this._engineSpawnModels('opencode', null)).has(null);
    } catch {
      return true;
    }
  }

  /** The models this run's spawns on `engine` name, each in the engine's own id: the run's model, each step's and
   *  workflow node's (one not on the engine runs the run's), the helper jobs' when they run on this engine, and the
   *  Away-mode decider's. `fallback` stands for a spawn that names none. */
  async _engineSpawnModels(engine, fallback) {
    const own = (m) => modelForEngine(m || undefined, engine, { projectDir: this.projectDir }) || null;
    const runModel = own(this.claude.model) || fallback;
    const steps = this.stepModels || await resolveStepModels(this.projectDir, this.claude.model, engine);
    const named = [
      ...Object.values(steps || {}).map((s) => s?.model),
      ...manifestModels(this.state?.stepper || []),
      ...(this._helperEngine() === engine ? ['title', 'overview', 'prDescription', 'memoryDefrag'].map((job) => this._utilitySlot(job).model || fallback) : []),
      effectiveNightConfig(this.projectDir).config?.deciderModel,
    ];
    return new Set([runModel, ...named.filter(Boolean).map((m) => own(m) || runModel)]);
  }

  /**
   * The engine gate's async half, before its refusals: the engine's own run-start check
   * (adapter `preflight`; codex: the binary runs and is signed in), skipped by a mock run,
   * which spawns nothing; then the DENY rules of each honoring member's own
   * `.claude/settings.json` (run-context.mjs#discoverProjectSettings, the file Claude
   * Code reads itself). A preflight refusal throws. Returns the merged deny rules, or null.
   * A codex run also keeps whether it needs codex's sign-in (`_codexSignIn`), which the sync
   * remote preflight (_execEnvPreflight) reads.
   * @param {(member:object)=>boolean} honors whether a member's project settings are honored
   * @param {{quiet?:boolean, guardrails?:object}} [opts] quiet: skip the preflight's warning line (a
   *   check made before the run exists; run() checks again and warns then); guardrails: the run's set, whose env
   *   allowlist the check runs under (the run's own when omitted)
   * @returns {Promise<{deny:string[]}|null>}
   */
  async _engineChecks(honors, { quiet = false, guardrails = null } = {}) {
    const name = this._engineName();
    const adapter = getEngine(name);
    const extra = this.claude.mock ? {} : await this._enginePreflightOptions();
    // A remote run's agents run the sandbox template's own pinned CLI, whose model calls worca's relay signs with the
    // server's credential: the backend's preflight checks that credential (e2bPreflight → engineCredential). Its helper jobs still run this machine's CLI when
    // they stay on the run engine (helperEngineFor: codex, copilot), so that CLI is checked too, and its failure warns,
    // naming those jobs: the agents do not need it.
    const remote = this._execBackend;
    if (!this.claude.mock && (!remote || helperEngineFor(name) === name) && typeof adapter.preflight === 'function') {
      // The check runs under the run's own env (src/core/spawn.mjs execCheck): the catalog allowlist plus the set's
      // (`guardrails`: the set a check made before the run exists passes; else the run's).
      const set = guardrails || this.guardrails;
      const r = await adapter.preflight({ ...(this.claude.bin ? { bin: this.claude.bin } : {}), ...extra, envAllowlist: set?.envAllowlist || [] });
      if (r?.refusal && !remote) throw engineRefusal(name, r.refusal);
      const why = r?.refusal || r?.warning;
      if (why && !quiet) {
        this._log('orchestrator', 'warn', `engine ${name}: ${why}${remote ? `. The agents run the ${remote.label}'s own ${name}, but the title, overview, PR description, Auto classifier and Away decider jobs run on this machine's ${name}: they fail until it works here.` : ''}`);
      }
    }
    let rules = null;
    for (const m of this.members) {
      if (!honors(m)) continue;
      const s = await discoverProjectSettings(m.projectDir);
      if (s?.permissions) rules = mergePermissionRules(rules, s.permissions);
    }
    return rules;
  }

  /** Product, not security: the options this run's engine preflight takes beyond the binary. Codex skips its own
   *  sign-in check when every Codex model the run can name runs on its own endpoint (_codexNeedsSignIn, kept on
   *  `_codexSignIn` for the sync remote preflight). */
  async _enginePreflightOptions() {
    const name = this.claude.engine || 'claude';
    // OpenCode refuses a step that names no model unless the user opted in (opencodePreflight `defaultModel`).
    if (name === 'opencode') return { defaultModel: await this._opencodeOnDefaultModel() };
    if (name !== 'codex') return {};
    this._codexSignIn = await this._codexNeedsSignIn();
    return { signIn: this._codexSignIn };
  }

  /** Engine hook: the agent nodes a resume point will run, as `{nodeId, key, model, tools}`
   *  (the gate's view of a node ctx). The base has no graph: []. */
  async _engineGateNodes(_rp) {
    return [];
  }

  /** The model a node's spawn gets on this run's engine. A Claude model means nothing to
   *  another engine, so it is dropped there and that engine runs its own default model
   *  (the gate says so at run start). */
  _engineModel(model) {
    const engine = this.claude.engine || 'claude';
    // Copilot names its models its own way (gpt-5.4, claude-sonnet-4.6, auto): a catalog model is kept when it runs on
    // Copilot (its copilot/<id> built-ins, the user's Copilot rows); an id the catalog does not hold is handed to copilot
    // as named, except a Claude Code id or alias (opus, claude-opus-4-8: copilot versions its Claude ids with a dot).
    if (engine === 'copilot') {
      if (typeof model !== 'string' || !model.trim()) return undefined;
      if (catalogHasModel(model, { projectDir: this.projectDir })) return modelForEngine(model, engine, { projectDir: this.projectDir });
      return engineOfModel(model, { projectDir: this.projectDir }) === 'claude' && !/\d\.\d/.test(model) ? undefined : model;
    }
    return modelForEngine(model, engine, { projectDir: this.projectDir });
  }

  /** The permission rules a node's spawn carries. Claude Code reads each checkout's .claude/settings.json itself;
   *  another engine does not, so there the members' own deny rules (_engineChecks) join the guardrail set's — on a
   *  workspace run the run context has merged them already, on a single-project or legacy run nothing else does. */
  _spawnPermissionRules() {
    const rules = (this.claude.engine || 'claude') === 'claude'
      ? this.guardrailPermissionRules
      : mergePermissionRules(this.guardrailPermissionRules, this._engineProjectRules);
    return rules || undefined;
  }

  /** The connection of the model a node's step ran on (its own, else the run's; a step with neither is on the
   *  harness's own sign-in). Never throws. */
  _limitConnection(nc) {
    const engine = this.claude.engine || 'claude';
    let model = null;
    try { model = nc ? this._nodeModelPair(nc).model : this._engineModel(this.claude.model); } catch { model = null; }
    return (model && modelConnection(model, { projectDir: this.projectDir })) || { kind: 'signin', engine };
  }

  /** Facts for a new agent step row: who serves its model calls (resolveModelRoute's provider) and whether its cost
   *  can be counted at all (a cost:false engine with no operator price on the model: never, D13). `model`: the step's
   *  effective spawn model (ctx.claudeOpts.model; null: the engine's own default). Never throws. */
  _stepFacts(model) {
    const out = {};
    try {
      const name = this._engineName();
      const entry = engineEntry(name);
      const m = model || entry?.defaultModel || null;
      const d = resolveModelRoute({ engine: name, remote: !!this._execBackend, serverEnv: process.env, model: m,
        endpoint: !!(m && hasCodexEndpoint(m)), broker: { on: brokerEnabled() }, checkModel: false });
      const conn = m ? modelConnection(m, { projectDir: this.projectDir }) : null;
      // A codex endpoint entry always has a provider connection too: the endpoint is named first.
      const provider = d.source === 'endpoint' ? 'endpoint'
        : d.source === 'broker' ? d.provider
          : conn?.kind === 'provider' ? conn.provider
            : (d.provider ?? entry?.relay?.upstream ?? null);   // a refused remote decision (mock e2b runs) has none
      if (provider) out.provider = provider;
      if (entry?.cost === false && !this.claude.mock) {
        const cfg = m ? modelCostConfig(m) : null;
        if (!(cfg?.free || cfg?.perMtok)) out.costKnown = false;
      }
    } catch { /* settings unreadable: the row goes without them */ }
    return out;
  }

  _nodeModelPair(nc) {
    if (this._modelForAll) {
      const all = this._engineModel(this.claude.model);
      if (all) return { model: all, effort: this.claude.effort ? (effortOn(this.claude.effort, this.claude.engine || 'claude') || undefined) : undefined };
    }
    const own = this._engineModel(nc?.model);
    // A model on two harnesses keeps its own engine's efforts; this harness takes the nearest one (effortOn).
    if (own) return { model: own, effort: nc.effort ? (effortOn(nc.effort, this.claude.engine || 'claude') || undefined) : nc.effort };
    return { model: this._engineModel(this.claude.model), effort: nc?.model ? undefined : nc?.effort };
  }

  _settingsScope() { return this.isWorkspace ? null : this.projectDir; }

  _projectPipelineCap() {
    const scope = this._settingsScope();
    return scope && hasProjectSetting('pipelineCostLimitUsd', scope) ? pipelineCostLimitUsd(scope) : undefined;
  }

  _utilitySlot(job) {
    const scope = this._settingsScope();
    const engine = this._helperEngine();
    const slot = utilityModelFor(engine, job, scope ? { projectDir: scope } : { workspace: true });
    // Model roles (D3): an unset helper slot takes its role (Claude's classifier → everyday, every other job → quick).
    return withRole(slot, engine, jobSlot(engine, job));
  }

  /** The engine worca's helper jobs run on (model-env.mjs helperEngineFor): Claude on a Cursor run. */
  _helperEngine() { return helperEngineFor(this.claude.engine || 'claude'); }
  /** The helper spawn's engine, plus the run's `bin` only when the helper runs on the run engine: the bin belongs
   *  to the run engine, and a "Claude" helper handed cursor-agent's bin would launch cursor-agent. */
  _helperSpawn() {
    const engine = this._helperEngine();
    return { engine, ...(engine === (this.claude.engine || 'claude') && this.claude.bin ? { bin: this.claude.bin } : {}) };
  }

  _titleSlotOpts() {
    const slot = this._utilitySlot('title');
    if (this._helperEngine() === 'claude') return slot.source === 'project' && slot.model ? { storedTitle: slot.model } : {};
    return slot.model ? { model: slot.model, ...(slot.effort ? { effort: slot.effort } : {}) } : {};
  }

  /** The run's model for a call on Claude (the run title on a Claude run). Another engine's model means nothing to Claude,
   *  so it is dropped there and Claude runs its default. */
  _claudeCallModel() {
    return modelForEngine(this.claude.model || null, 'claude', { projectDir: this.projectDir }) || null;
  }

  /** What a node's dispatch ctx carries for the run's engine: its name, whether it
   *  has a grantable sub-agent tool, and no fan-out when it has none. */
  _engineNodeOpts(nc) {
    const engine = this.claude.engine || 'claude';
    const subagents = getEngine(engine).capabilities.subagents !== false;
    return { engine, subagents, fanOut: !!nc?.fanOut && subagents };
  }

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
    const prior = this.runRoot ? await readRunManifest(this.runRoot) : null;
    const alreadyReported = new Set(prior?.warnings ?? []);
    let reg = null;                                        // the MCP registry layer's { result, catalog }
    // Skills registry: another engine reads set skills from `.agents/skills`, so they are planned BEFORE the
    // assembly and mounted by it with every other skill (one owner: renames, records, orphan pruning, teardown).
    // On Claude they load through --plugin-dir and are planned after it, in _resolveSkills.
    const skillPlan = (this.claude.engine || 'claude') !== 'claude' ? await this._planSkills() : null;
    // P1 (S31): a folder member's own skills come from its copy-time manifest — a copy has no index to ask.
    const shippedFiles = new Map();
    for (const m of this.members) {
      if (this._memberWorkMode(m.projectKey) !== 'folder') continue;
      shippedFiles.set(m.projectKey, Object.keys((await readFolderManifest(this._folderFilesFor(m.projectKey).manifest))?.files || {}));
    }
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
        workMode: this._memberWorkMode(m.projectKey),
        ...(shippedFiles.has(m.projectKey) ? { shippedFiles: shippedFiles.get(m.projectKey) } : {}),
      })),
      projectsRoot: getProjectsRoot(), projectsRootIsDefault: projectsRootSource() === 'default',
      isWorkspace: this.isWorkspace,
      requiredSkillResolutions: resolvedSkills,           // possibly empty — a valid, common input
      graphInstructions: this.toolInstructions,
      homeDir: homedir(),
      honorByKey: this.guardrailHonorByKey,
      agentIsolated: !!agentIdentity(),
      settingsScope: this._settingsScope(),
      engine: this.claude.engine || 'claude',
      setSkills: this._setSkillSources(skillPlan),
      registry: async (taken) => (reg = await this._resolveMcp(taken)),
    });
    this.runContext = rc;
    if (rc?.projectPermissions) {
      this.guardrailPermissionRules = mergePermissionRules(this.guardrailPermissionRules, rc.projectPermissions);
    }
    // MCP registry (§6.4): a deny rule on a server reaches every copy of it in this run — BEFORE
    // the audit below, so denyCount includes the added rules. Resume re-runs it on the rebuilt rules.
    if (reg && this.guardrailPermissionRules?.deny?.length) {
      this.guardrailPermissionRules = {
        ...this.guardrailPermissionRules,
        deny: expandMcpDenyRules(this.guardrailPermissionRules.deny, { catalog: reg.catalog, copies: reg.result.copies }),
      };
    }
    this.mcpLayer = reg && {
      env: reg.result.env,
      redact: reg.result.secretValues,
      disallowed: reg.result.disallowedTools,
      // §5.5.1: a scrubbed spawn keeps the launcher's keep-list when a stdio copy runs.
      allowlist: Object.values(reg.result.servers).some((s) => typeof s.command === 'string') ? keepListNames() : [],
      copies: reg.result.copies,
      servers: reg.result.servers,
    };
    const mcpWhy = this._engineMcpRefusal(this.mcpLayer);
    if (mcpWhy) throw engineRefusal(this.claude.engine, mcpWhy);
    // §11.4: MCP deviations need the resolution, so they land here, after _resolvePolicy (which
    // resets the list on resume). Persisted now, with the WHOLE list: when this is the run's first
    // _persistPolicyState (a saved workflow; an Auto run's classifier spawn persists earlier), the
    // patch replaces the policy's own codes, because writePolicyState unions only with what is stored.
    if (reg && this.policyRun) {
      const found = mcpDeviations(this.policyRun.fields, reg.result, (s) => skipReasonText(s, reg.catalog));
      for (const d of found) {
        this.policyRun.deviations.push(d.code);
        this._log('policy', 'warn', `off-policy: ${d.text}`);
      }
      if (found.length) this._persistPolicyState({ deviations: [...this.policyRun.deviations] });
    }
    // §10: the assembly rewrote run.json.warnings; a resumed run's recorded connection problems
    // (run.json.mcpStatus, which the assembly never rewrites) and its tool-name warning are put
    // back, and the resumed harness does not warn the tool name again.
    const lost = Object.entries(prior?.mcpStatus || {})
      .map(([name, status]) => mcpStatusWarning(name, status, this.mcpLayer?.copies.find((c) => c.name === name)?.setName))
      .filter(Boolean);
    const named = (prior?.warnings || []).filter((w) => w.startsWith(`${MCP_NAME_WARNING} — `));
    if (named.length) this._mcpNameWarned = true;
    lost.push(...named);
    lost.push(...(prior?.warnings || []).filter((w) => FOLDER_COPY_WARNING_RE.test(w)));
    if (lost.length) await updateRunManifest(this.runRoot, { warnings: [...rc.warnings, ...lost] });
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
    for (const w of this._engineMcpWarnings(rc)) if (!alreadyReported.has(w)) await this._recordRunWarning(w);
    await this._recordCapabilities();
    // Skills registry (§4.3): after the capability probe and after the assembly rewrote
    // run.json.warnings; before the audit line, which closes with the layer's clause.
    await this._resolveSkills({ reported: alreadyReported, plan: skillPlan, mountedAs: rc.skillMountDir ? rc.setSkillNames : null });
    await appendAudit(this.pipeline.dir, renderContextAudit(rc, this.skillLayer)).catch(() => {});
    return rc;
  }

  /**
   * The MCP registry layer for this run (design §6.1): the resolver over the run's target, its
   * Team set from the resolved policy, the opt-out and the tool-name limit of every model the run
   * may dispatch. Workspace scans and memory-defrag runs get none (designer default 3).
   * @param {string[]} taken  names the spawn already loads (run-context.mjs)
   * @param {{team?: object|null}} [o]  the Team set input when the policy is not resolved yet (the engine gate's
   *        early look reads it from the policy cache); omitted, it comes from this.policyRun
   * @returns {Promise<{result:object, catalog:object[]}|null>}
   */
  async _resolveMcp(taken, { team } = {}) {
    if (this._isWorkspaceScan() || this.workflowId === MEMORY_DEFRAG_WORKFLOW_ID) return null;
    const { target, teamKey } = this._registryTarget();
    const required = requiredOf(this.policyRun);
    const [result, catalog] = await Promise.all([
      resolveRegistry({
        surface: 'pipeline', targets: [target],
        teams: { [teamKey]: team !== undefined ? team : required.length ? { home: this.policyRun.home, required } : null },
        optOut: this.mcpOptOut, toolNameLimit: toolNameLimitFor([...this._mcpModels()]), copyCap: 24, taken,
        mcpTimeoutMs: MCP_STARTUP_MS.pipeline,
      }),
      loadCatalog(),
    ]);
    return { result, catalog };
  }

  /** The run's resolver target and its Team-set key (MCP §5.1, skills §4.3): the project, or the
   *  workspace with its member projects (each brings its own sets, F7). */
  _registryTarget() {
    const m = this.members[0];
    return this.isWorkspace
      ? { teamKey: `ws:${this.workspace.id}`, target: { kind: 'workspace', id: this.workspace.id, name: this.workspace.name, members: this.members.map((x) => ({ key: x.projectKey, name: x.projectName })), rank: 0 } }
      : { teamKey: m.projectKey, target: { kind: 'project', key: m.projectKey, name: m.projectName, rank: 0 } };
  }

  /** Skills registry: the resolver IO shell (test seam). */
  _skillRegistry(opts) { return resolveSkillRegistry(opts); }

  /** Skills registry §2b-13: off-policy findings for required Team skills — P5's `skillDeviations`, [] without it (test seam). */
  _skillDeviations(fields, result, describe) {
    return typeof policyEffective.skillDeviations === 'function' ? policyEffective.skillDeviations(fields, result, describe) : [];
  }

  /** Skills registry §4.1: this host's facts (test seam); unreadable ⇒ nothing installed, sideloading allowed. */
  _skillHostFacts() {
    try { return skillHostFacts(); } catch { return { installedPluginNames: [], sideloadDisabled: false }; }
  }

  /** `claude --help` / `--version`, parsed once per run (§8.18 V5; skills §4.1 reads `pluginDir`). */
  _claudeCaps() { return (this._capsProbe ||= probeClaudeCapabilities(this.claude.bin)); }

  /** Skills registry §4.1: does this run's `claude` advertise --plugin-dir? A mock run spawns none: yes. Asked on
   *  Claude runs only: another engine mounts set skills in `.agents/skills` (_planSkills). */
  async _pluginDirSupported() {
    if (this.claude.mock) return true;
    return (await this._claudeCaps()).pluginDir === true;
  }

  /**
   * Skills registry (design §4.3), the first half of _resolveSkills: the set skills this run's target brings,
   * each set's copied as one generated plugin under `<pipeline.dir>/skills` (outside every checkout; survives a
   * pause; goes with the pipeline dir). Writes nothing but that folder, so another engine plans BEFORE the
   * assembly and hands the copies to it (_setSkillSources), and _resolveSkills records the plan after it.
   * Never throws: a fault is a plan with no layer and the line that says why.
   * @returns {Promise<{none:true, warning:string|null}|{result:object, mounted:object[], skipped:object[], blocked:string|null, mount:object}>}
   */
  async _planSkills() {
    if (!this.pipeline?.dir || this._isWorkspaceScan() || this.workflowId === MEMORY_DEFRAG_WORKFLOW_ID) return { none: true, warning: null, quiet: true };
    const base = join(this.pipeline.dir, 'skills');
    const firstLine = (err) => String(err?.message || err).split('\n')[0];
    let result;
    try {
      const { target, teamKey } = this._registryTarget();
      const required = requiredSkillsOf(this.policyRun);
      result = await this._skillRegistry({
        surface: 'pipeline', targets: [target],
        teams: { [teamKey]: required.length ? { home: this.policyRun.home, required } : null },
        optOut: this.mcpOptOut, skillCap: SKILL_CAP.pipeline,
      });
    } catch (err) {
      return { none: true, warning: `skills from sets not loaded: ${firstLine(err)}` };
    }
    // §2b-13 off-policy findings for required Team skills — after _resolvePolicy (it resets the list
    // on resume); the whole list is persisted, as the MCP deviations are.
    if (this.policyRun) {
      try {
        const found = this._skillDeviations(this.policyRun.fields, result, (s) => skillSkipReasonText(s));
        for (const d of found) {
          this.policyRun.deviations.push(d.code);
          this._log('policy', 'warn', `off-policy: ${d.text}`);
        }
        if (found.length) this._persistPolicyState({ deviations: [...this.policyRun.deviations] });
      } catch (err) {
        // A broken rule never stops the run (this method never throws): the layer still loads.
        this._log('policy', 'warn', `skill deviations not checked: ${firstLine(err)}`);
      }
    }
    const mounted = Array.isArray(result?.mounted) ? result.mounted : [];
    const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
    if (!mounted.length && !skipped.length) return { none: true, warning: null };   // and a mount an earlier segment left is removed
    // §4.1 host gates, only when something would load on Claude: managed `disableSideloadFlags`, or a CLI
    // without --plugin-dir. Either skips the whole layer with one warning — never a dead spawn. Another engine
    // reads the copies from `.agents/skills`, never through --plugin-dir (this.claude.bin is its binary).
    const blocked = !mounted.length || (this.claude.engine || 'claude') !== 'claude' ? null
      : this._skillHostFacts().sideloadDisabled ? 'sideload-disabled'
      : (await this._pluginDirSupported()) ? null : 'cli-no-plugin-dir';
    let mount = { base: null, pluginDirs: [], plugins: [], failed: [] };
    try {
      if (mounted.length && !blocked) {
        mount = await materializeSkillMount({ result, base });
        // P3 leaves out a skill it could not copy (`failed`); nothing copied at all is a mount fault.
        if (!mount.pluginDirs.length) throw new Error(mount.failed?.[0]?.error || 'no skill could be copied');
      } else await rm(base, { recursive: true, force: true });
    } catch (err) {
      return { none: true, warning: `skills from sets not loaded: could not prepare ${base}: ${firstLine(err)}` };
    }
    return { result, mounted, skipped, blocked, mount };
  }

  /**
   * Another engine's set skills as assembleSkills candidates (run-context.mjs): each copied skill's folder under
   * `<pipeline.dir>/skills/<plugin>/skills/<name>`, renamed `<set slug>-<name>` on a clash in `.agents/skills`.
   * [] on Claude (set skills load through --plugin-dir there) and for a plan with nothing to mount.
   */
  _setSkillSources(plan) {
    if ((this.claude.engine || 'claude') === 'claude' || !plan || plan.none || plan.blocked) return [];
    return (plan.mount.plugins || []).flatMap((p) => p.skills.map((name) => {
      const m = plan.mounted.find((x) => x.pluginName === p.pluginName && x.name === name);
      return { key: `${p.pluginName}:${name}`, name, source: join(p.dir, 'skills', name), prefix: `${m?.setSlug || p.pluginName}-`, origin: `set ${m?.setName ?? p.pluginName}` };
    }));
  }

  /**
   * Skills registry (design §4.3): the set-skill layer of this run, recorded. On Claude each set's copy is spawned
   * with one `--plugin-dir` (_execCtx → runOpts); on another engine the assembly mounted the copies in
   * `.agents/skills`, and `mountedAs` maps each `<plugin>:<skill>` to the name it got there (null: the run has no
   * such mount, a legacy run or a member without a checkout). Re-run on every resume: the mount is rebuilt from the
   * live sets minus the stored opt-out, BEFORE the first spawn (the CLI silently ignores a missing --plugin-dir
   * path). Workspace scans and memory-defrag runs get none. Never throws: a fault leaves the run without set
   * skills and says so.
   * @param {{reported?: Set<string>, plan?: object|null, mountedAs?: Record<string,string>|null}} [o]
   *        warnings this run root already reported (a resumed run); the plan made before the assembly
   * @returns {Promise<object|null>} the layer, or null when the target brings no set skill
   */
  async _resolveSkills({ reported = new Set(), plan = null, mountedAs = null } = {}) {
    this.skillLayer = null;
    plan ??= await this._planSkills();
    if (plan.none && plan.quiet) return null;
    const base = join(this.pipeline.dir, 'skills');
    // No layer this segment: no mount and no record — not even one an earlier segment left in the state or in
    // run.json (History reads its durable copy). A fault's line is warned once and kept with the run's warnings.
    if (plan.none) {
      const warning = plan.warning;
      await rm(base, { recursive: true, force: true }).catch(() => {});
      delete this.state.skillMount;
      if (warning && !reported.has(warning)) this._log('skills', 'warn', warning);
      if (this.runRoot) {
        try {
          const cur = (await readRunManifest(this.runRoot)) || {};
          const warnings = Array.isArray(cur.warnings) ? cur.warnings : [];
          const add = warning && !warnings.includes(warning) ? [warning] : [];
          // A run that never had a layer writes nothing (byte-identical run.json); undefined drops the key.
          if ('skillMount' in cur || add.length) await updateRunManifest(this.runRoot, { skillMount: undefined, warnings: [...warnings, ...add] });
        } catch { /* best-effort: the run log has the line */ }
      }
      return null;
    }
    const { result, mounted, skipped, mount } = plan;
    const engine = this.claude.engine || 'claude';
    const onEngine = engine !== 'claude';
    // Another engine with no `.agents/skills` mount for this run cannot see the copies at all.
    const blocked = plan.blocked || (onEngine && mounted.length && !mountedAs ? 'engine-no-skill-mount' : null);
    const firstLine = (err) => String(err?.message || err).split('\n')[0];
    // A skill P3 could not copy is not delivered: it leaves the layer and the plugin list and becomes a skipped
    // row (`mount-failed`, its error as the reason) — never told to agents, the run card or the audit as loaded.
    // On another engine so is a copy the assembly did not mount (a name the checkout tracks, a copy error).
    const setNameOf = (id) => (result.plugins || []).find((p) => p.setId === id)?.setName ?? id;
    const notCopied = (Array.isArray(mount.failed) ? mount.failed : []).map((f) => ({
      setId: f.setId, setName: setNameOf(f.setId), pluginName: f.pluginName, name: f.name ?? '?',
      skillId: mounted.find((m) => m.pluginName === f.pluginName && m.name === f.name)?.id ?? null,
      qualifiedName: `${f.pluginName}:${f.name ?? '?'}`, reason: 'mount-failed', why: firstLine(f.error),
    }));
    if (onEngine && !blocked) {
      for (const p of mount.plugins || []) {
        for (const name of p.skills) {
          if (Object.hasOwn(mountedAs, `${p.pluginName}:${name}`)) continue;
          const m = mounted.find((x) => x.pluginName === p.pluginName && x.name === name);
          notCopied.push({ setId: p.setId, setName: setNameOf(p.setId), pluginName: p.pluginName, name, skillId: m?.id ?? null,
            qualifiedName: `${p.pluginName}:${name}`, reason: 'mount-failed', why: 'not mounted in .agents/skills (see the run warnings)' });
        }
      }
    }
    const lost = new Set(notCopied.map((f) => f.qualifiedName));
    const kept = lost.size ? mounted.filter((m) => !lost.has(`${m.pluginName}:${m.name}`)) : mounted;
    const copied = new Map((mount.plugins || []).map((p) => [p.pluginName, p.skills.filter((s) => !lost.has(`${p.pluginName}:${s}`))]));
    const plugins = (result.plugins || []).filter((p) => blocked || copied.get(p.pluginName)?.length).map((p) => ({
      setId: p.setId, setName: p.setName, pluginName: p.pluginName, renamedPlugin: !!p.renamedPlugin, skills: [...(copied.get(p.pluginName) || p.skills)],
    }));
    const allSkipped = [...skipped, ...notCopied];
    // The names agents call on another engine: the folders in `.agents/skills`.
    const agentNames = onEngine && !blocked ? kept.map((m) => mountedAs[`${m.pluginName}:${m.name}`]) : null;
    this.skillLayer = {
      base: mount.base, pluginDirs: blocked || onEngine ? [] : mount.pluginDirs, plugins, mounted: kept, skipped: allSkipped, blocked,
      ...(agentNames ? { rel: skillsRelFor(engine), names: agentNames } : {}),
    };
    const record = {
      base: mount.base, plugins,
      skipped: allSkipped.map((s) => ({
        setId: s.setId, setName: s.setName, skillId: s.skillId, name: s.name,
        qualifiedName: s.qualifiedName ?? (s.pluginName ? `${s.pluginName}:${s.name}` : s.name), reason: s.reason, why: s.why ?? skillSkipReasonText(s),
      })),
      layer: { blocked, text: blocked ? skillLayerText(blocked, engine) : null },
      ...(agentNames ? { rel: this.skillLayer.rel, names: agentNames } : {}),
    };
    this.state.skillMount = record;
    // One run-log warning per renamed plugin and per problem skip (choices — off, opted out, never
    // consented — say nothing); a resumed run does not repeat what this run root already reported.
    const lines = blocked ? [`skills from sets not loaded: ${skillLayerText(blocked, engine)}`] : [];
    for (const p of plugins) {
      if (blocked || onEngine || !p.renamedPlugin) continue;
      const slug = mounted.find((m) => m.setId === p.setId)?.setSlug || 'general';
      lines.push(`set ${p.setName} loads as \`${p.pluginName}:\` here — a Claude Code plugin named ${slug} is installed`);
    }
    for (const s of skipped) if (SKILL_PROBLEM_REASONS.includes(s.reason)) lines.push(skillSkipMessage(s));
    for (const s of notCopied) lines.push(`${s.qualifiedName} in ${s.setName} not loaded: ${s.why}`);
    // A skill's `hooks:` are Claude Code's: mounted on another engine, the skill loads and its hooks never run.
    if (agentNames) {
      const hooked = kept.filter((m) => this._skillDeclaresHooks(join(mount.base, m.pluginName, 'skills', m.name)))
        .map((m) => mountedAs[`${m.pluginName}:${m.name}`]);
      if (hooked.length) lines.push(skillHooksIgnoredText(engine, hooked));
    }
    for (const w of lines) if (!reported.has(w)) this._log('skills', 'warn', w);
    if (this.runRoot) {
      try {
        const cur = (await readRunManifest(this.runRoot)) || {};
        const warnings = Array.isArray(cur.warnings) ? cur.warnings : [];
        await updateRunManifest(this.runRoot, { skillMount: record, warnings: [...warnings, ...lines.filter((w) => !warnings.includes(w))] });
      } catch { /* best-effort: the run log has the lines */ }
    }
    return this.skillLayer;
  }

  /** Whether the SKILL.md in a copied set skill's folder declares `hooks:` (skills registry §2a U1); unreadable: no. */
  _skillDeclaresHooks(dir) {
    try { return !!skillMdFields(readFileSync(join(dir, 'SKILL.md'), 'utf8'))?.hooks; } catch { return false; }
  }

  /**
   * Skills registry safety net (design §4.1, §4.3), called by the executor: an agent's spawn was
   * refused for --plugin-dir (a managed `disableSideloadFlags` Worca could not read). Every later
   * spawn of this run goes without set skills — the executor dispatches the refused one again — and
   * the run says so once (fan-out siblings may be refused at the same moment).
   */
  onSkillSideloadRefused() {
    if (!this.skillLayer || this.skillLayer.blocked) return;
    this.skillLayer = { ...this.skillLayer, pluginDirs: [], blocked: 'sideload-disabled' };
    const record = this.state.skillMount
      ? { ...this.state.skillMount, layer: { blocked: 'sideload-disabled', text: skillLayerText('sideload-disabled') } } : null;
    if (record) this.state.skillMount = record;
    const line = "skills from sets not loaded: this machine's Claude Code refuses --plugin-dir";
    this._log('skills', 'warn', line);
    // The durable timeline too: the assembly's audit line said what the run would load.
    if (this.pipeline?.dir) appendAudit(this.pipeline.dir, "Set skills dropped: this machine's Claude Code refuses --plugin-dir; later agents run without them.").catch(() => {});
    this._emit('state', this.getState());   // the run page's card turns blocked now, not at the next state frame
    // run.json writes during dispatch share the §10 chain (an unlocked read-modify-write).
    this._mcpChain(async () => {
      if (!this.runRoot) return;
      try {
        const cur = (await readRunManifest(this.runRoot)) || {};
        const warnings = Array.isArray(cur.warnings) ? cur.warnings : [];
        await updateRunManifest(this.runRoot, { ...(record ? { skillMount: record } : {}), warnings: warnings.includes(line) ? warnings : [...warnings, line] });
      } catch { /* best-effort: the run log has the line */ }
    });
  }

  /**
   * A legacy run (no run root, no assembly): the layer, and its own audit line. A resumed segment reads the
   * skills warnings the run already gave from its run log (a legacy run has no run.json), so none repeats.
   */
  async _resolveSkillsLegacy({ resume = false } = {}) {
    const reported = new Set();
    if (resume) {
      const log = await readFile(join(this.pipeline.dir, RUN_LOG_FILE), 'utf8').catch(() => '');
      for (const l of log.split('\n')) {
        try { const e = JSON.parse(l); if (e?.source === 'skills' && e.level === 'warn') reported.add(e.text); } catch { /* a blank or torn line */ }
      }
    }
    const layer = await this._resolveSkills({ reported });
    if (layer) await appendAudit(this.pipeline.dir, `Skills: ${renderSkillAudit(layer)}.`).catch(() => {});
  }

  /** §5.6: every model this run may dispatch — the manifest's, the step models' and the run's own. */
  _mcpModels() {
    const models = manifestModels(this.state.stepper);
    for (const s of Object.values(this.stepModels || {})) if (typeof s?.model === 'string' && s.model.trim()) models.add(s.model.trim());
    if (this.claude.model) models.add(this.claude.model);
    return models;
  }

  /** Absolute `<pipeline.dir>/memory.json` — the durable memory ledger (amendment A2). */
  _memoryLedgerPath() { return join(this.pipeline.dir, 'memory.json'); }

  /** Mount the memory store into this run — best-effort. Memory is additive (spec §4.3):
   *  a store/mount fs failure degrades the run to "no memory" (no pointer block, no sync) and is
   *  logged + audited; it never pauses the run at 'setup', where the replay would hit the
   *  same error again. EXCEPTION (amendment B8): a DEFRAGMENT run (`this.memoryScope` set) IS
   *  its mount — the error is rethrown and run()'s setup failure policy parks the run
   *  paused/error with setupIncomplete, so a retryable mount failure can resume. */
  async _mountMemory({ resume = false } = {}) {
    if (!this.pipeline?.dir) return;
    try { await this._mountMemoryUnguarded({ resume }); }
    catch (err) {
      this.memory = null; this.memoryBlock = ''; this.state.memoryMount = null; this.state.memoryRules = null;
      if (existsSync(this._memoryLedgerPath())) await this._writeMemoryLedger({ neutralised: true });
      const why = String(err?.message || err).split('\n')[0];
      // A defragment run IS its mount (B8): rethrow, and run()'s setup failure policy parks the run
      // as paused/error with setupIncomplete — a retryable mount failure resumes, a persistent one
      // stays visible. An ordinary run degrades to "no memory" as in P1.
      if (this.memoryScope) {
        await appendAudit(this.pipeline.dir, `Memory: not mounted (${why}) — a defragment run cannot continue.`).catch(() => {});
        throw new Error(`memory not mounted: ${why}`);
      }
      this._log('memory', 'warn', `memory not mounted: ${why} — this run's agents see no memory and their memory writes are not captured`);
      await appendAudit(this.pipeline.dir, `Memory: not mounted (${why}).`).catch(() => {});
    }
  }

  /**
   * Mount the memory store into this run twice: the read-only rules copy at
   * `<runCwd>/.claude/rules/worca` (where Claude Code discovers rules natively — run root on a
   * detached workspace run, the primary worktree otherwise) and the writable copy at
   * `<pipeline.dir>/memory` (the sync-back mount, outside every checkout). Always recomputed,
   * never the ledger's absolute paths.
   * On resume, the previous segment's ledger is read first and its mount is synced back BEFORE
   * anything else (§5 "resume of a paused run"): the sync is pure fs and needs neither git nor
   * the tracked guard, so a guard that fails only NOW (git broken, the previous segment's agent
   * staged the mount) can never lose the interrupted segment's writes.
   */
  async _mountMemoryUnguarded({ resume }) {
    const root = memoryRoot();
    // Pre-setup there is no run cwd, and the LIVE checkout must never take a rules copy.
    const cwd = this.runCwd || null;
    if (!cwd || (cwd === this.projectDir && this.workMode !== 'none')) throw new Error('no run cwd to mount into');
    if (!this.pipeline?.dir) throw new Error('no pipeline dir for the writable memory copy');
    // Two copies (memory-write-split design D1): the READ-ONLY rules copy inside the cwd, where Claude
    // Code loads it and refuses every write (`.claude` is a protected path); the WRITABLE copy — the
    // sync-back mount — under the pipeline dir, outside every checkout, reached by --add-dir.
    const rules = memoryRulesPath(cwd);
    // P3-D19: a run without a project's work/ was the agents' cwd — never mount (the mount removes first) through a
    // `.claude` an agent swapped for a link.
    if (this.workMode === 'none' && !(await realDirsBelow(cwd, MEMORY_RULES_REL))) throw new Error(`${MEMORY_RULES_REL} in work/ is not the run's own folder`);
    const mount = memoryWorkPath(this.pipeline.dir);
    // §8.8 scope of the record: 'runRoot' when the cwd IS the run root, else the member whose
    // checkout is the cwd (the primary member on single and legacy-workspace runs).
    const scope = (this.runRoot && cwd === this.runRoot) ? 'runRoot'
      : ([...this.workDirs.entries()].find(([, d]) => d === cwd)?.[0] ?? null);
    if (!scope) throw new Error(`run cwd ${cwd} is neither the run root nor a member checkout`);
    const dirs = mountDirs({ members: this.members, isWorkspace: this.isWorkspace, memoryScope: this.memoryScope });
    const onError = (p, err) => this._memoryReadWarn(p, err);
    if (resume) {
      let ledger = null;
      try { ledger = JSON.parse(await readFile(this._memoryLedgerPath(), 'utf8')); } catch { ledger = null; }
      if (ledger && ledger.baseline && Array.isArray(ledger.dirs)) {
        this.memoryChanges = Array.isArray(ledger.changes) ? ledger.changes : [];
        // The interrupted segment's writes live at the LEDGER's mount: this dir since the write
        // split, the in-checkout `.claude/rules/worca` for a run paused before it (a pause keeps the
        // checkout, so that dir is still there). Sync whichever exists; the recomputed paths are used from here on.
        const prev = (typeof ledger.mount === 'string' && ledger.mount !== mount && existsSync(ledger.mount)) ? ledger.mount : mount;
        try {
          await this._syncMemoryWith({ mount: prev, dirs: ledger.dirs, baseline: ledger.baseline, nodeId: 'resume', executionId: null, agentKey: null, label: 'the interrupted execution' });
        } catch (err) {
          // Defensive — syncBack does not reject today (every fs error is per-file or routed
          // through onError). If it ever does: do NOT remount over unsynced writes; keep the
          // PREVIOUS mount + baseline so the next execution's sync retries them.
          this._log('memory', 'warn', `memory: the interrupted execution's writes could not be synced (${err?.message || err}); keeping the previous mount`);
          this.memory = { root, mount: prev, rules: null, dirs: ledger.dirs, baseline: ledger.baseline };
          this.state.memoryMount = prev; this.state.memoryRules = null;
          // Register in every case: the rules copy of the interrupted segment (if any) is still inside
          // the checkout and must stay excluded from the commit and removed at teardown. Idempotent.
          await this._registerMemoryMount(scope);
          this._refreshMemoryBlock();
          return;
        }
      }
    }
    // A checkout that TRACKS the mount path would have its committed files overwritten, excluded
    // from the commit and deleted at teardown — refuse, like the skill mount's trackedNames guard.
    // `:(icase)`: on a case-insensitive file system a repo tracking `.Claude/rules/worca` would
    // otherwise pass the guard and have those files rm'd through the case-folded path. The
    // detached workspace run root has no git and no check.
    if (scope !== 'runRoot' && this._memberWorkMode(scope) !== 'git') {
      // No index to ask: the copy-time manifest says whether the FOLDER itself holds the mount path ('none' has none).
      const manifest = this._memberWorkMode(scope) === 'folder' ? await readFolderManifest(this._folderFilesFor(scope).manifest) : null;
      if (manifest && manifestHas(manifest, MEMORY_RULES_REL)) throw new Error(`the folder has its own ${MEMORY_RULES_REL} — rename it`);
    } else if (scope !== 'runRoot') {
      const tracked = await this._git(['ls-files', '--', `:(icase)${MEMORY_RULES_REL}`], { cwd });
      if (!tracked.ok) throw new Error(`cannot tell whether the checkout tracks ${MEMORY_RULES_REL} (git ls-files: ${tracked.stderr.trim() || `exit ${tracked.code}`})`);
      // The way out differs: an ordinary run has nowhere else to go (its checkout IS the project's),
      // a defragment targets a scope and can be started from any other project's checkout.
      if (tracked.stdout.trim()) throw new Error(`the checkout tracks ${MEMORY_RULES_REL} — untrack it${this.memoryScope ? ' (or start the defragment from another project)' : ''}`);
    }
    // Register BEFORE anything touches the disk: a mount that fails half-way (EACCES, a Windows
    // EBUSY past the retries) leaves files under the cwd, and only the §8.8 entry keeps them out
    // of the commit and gets them removed at teardown. Idempotent, harmless on failure.
    await this._registerMemoryMount(scope);
    // Team memory (phase 1a): bring each opted-in project's team layer up to date FIRST — following the team rewrites
    // this machine's unedited tracked copies, and the two copies below must already carry that. Bounded; never throws.
    await this._refreshTeamMemory(dirs);
    // What each project loads (team-memory-load-choice.md): a project whose team memory loads team notes only mounts
    // just its local notes that are team notes, in BOTH copies (an engine without rules, and an Explore or Plan
    // sub-agent, read the writable copy). A defragment run works on every local note.
    const plans = this.memoryScope ? new Map() : await memoryLoadPlans(dirs);
    const loadDirs = loadFilteredDirs(dirs, plans);
    // The WRITABLE copy: a copy of the mounted scopes (agents edit existing files in place;
    // syncBack diffs it against this baseline). Outside git — no sentinel.
    const ownSource = this._memorySource();   // a sandbox run reads back its own held writes (memory-store isHeldSource)
    const m = await mountMemory({ root, mount, dirs: loadDirs, onError, ownSource });
    // The READ-ONLY rules copy: the same files where the CLI discovers them. Its baseline is
    // irrelevant (nothing syncs back from it). `<rules>/.gitignore` = `*` keeps it out of an agent's
    // own `git add -A`, a staging pre-commit hook, snapshotWorktreePatch's bare `git add -A` and the
    // reviewer's `git status`; the §8.8 `:(exclude)` pathspec stays as defence in depth.
    await mountMemory({ root, mount: rules, dirs: loadDirs, onError, gitIgnore: true, ownSource });
    // …then the team folder(s) of the READ-ONLY copy only (decision D2): an agent changes a team note by writing a
    // same-named local note, which shadows it here and is shared on sync. A defragment run works on local notes only.
    const team = this.memoryScope ? [] : (await this._mountTeamDirs(rules, dirs, plans)) ?? [];
    this.memory = { root, mount, rules, dirs, baseline: m.baseline, team, scoped: await this._memoryScoped(rules) };
    for (const d of loadDirs) if (d.only) {
      const hidden = (await listMemory(root, d.scope).catch(() => [])).length - d.only.size;
      if (hidden > 0) this._log('memory', 'info', `team memory: ${d.label} loads team notes only — ${hidden} local note(s) not loaded`);
    }
    this.state.memoryMount = mount;
    this.state.memoryRules = rules;
    this._refreshMemoryBlock();
    await this._writeMemoryLedger();
    this._log('memory', 'info', `Memory mounted: ${m.files} file(s) across ${dirs.length} scope(s) — loaded from ${rules}, written to ${mount}`);
  }

  /**
   * §8.8: the mount rides `injectedPaths[<scope>]` as a `kind:'memory'` entry — excluded from the
   * commit, the intent-to-add staging and the three result diffs (_excludePathspecs), removed at
   * teardown (removeInjectedPaths), never rescued (sync-back is its rescue). Idempotent: a resume
   * re-assembly rewrites the map without it, so it is re-added here; persisted into run.json on
   * detached runs so the boot sweep and pipeline-delete see the same set. Under legacy the map was
   * always {} — the memory entry is the ONE legacy pathspec, and the legacy `git add -A` becomes
   * `git add -A -- . :(exclude).claude/rules/worca` (§10's byte-identical contract, amended: memory
   * has been mounted in both modes since P1, and an unexcluded mount would be committed).
   */
  async _registerMemoryMount(scope) {
    const map = { ...(this.injectedPaths || {}) };
    map[scope] = [...(map[scope] || []).filter((e) => e?.kind !== 'memory'), { ...MEMORY_INJECTED_ENTRY }];
    this.injectedPaths = map;
    if (this.runRoot) await updateRunManifest(this.runRoot, { injectedPaths: map }).catch(() => {});
  }

  /**
   * Cursor reads its deny rules and MCP servers from `<cwd>/.cursor/`, Gemini CLI its MCP servers from
   * `<cwd>/.gemini/settings.json` (engines/project-files.mjs writes them per spawn).
   * They join the §8.8 set like the memory mount, in BOTH run-root modes: removed at teardown, never rescued (the
   * commit and the diffs keep them out through worca's info/exclude line and _engineConfigState, not a pathspec).
   * Scope rule as the memory mount (_mountMemoryUnguarded). Idempotent.
   * Which file is worca's is decided where it matters, by _injectedFor (the adapter's ownership ledger): a tracked
   * file or an agent's own .cursor/mcp.json is never worca's, so registering the path costs nothing and needs no git.
   * Not only on the run's engine: a resume that switched AWAY from Cursor (this.claude.engine is the resume target) still
   * has the earlier segment's files in the checkout, and both modes rebuild injectedPaths on resume.
   */
  async _registerEngineConfig() {
    const cwd = this.runCwd || null;
    if (!cwd || (cwd === this.projectDir && this.workMode !== 'none')) return;   // P3: a no-project run's cwd IS its projectDir (work/)
    const own = ENGINE_PROJECT_FILES[this.claude.engine || 'claude'] || [];
    const paths = [...own, ...ALL_PROJECT_FILES.filter((p) => !own.includes(p) && existsSync(join(cwd, p)) && worcaOwnsProjectFile(cwd, p))];
    if (!paths.length) return;
    const scope = (this.runRoot && cwd === this.runRoot) ? 'runRoot'
      : ([...this.workDirs.entries()].find(([, d]) => d === cwd)?.[0] ?? null);
    if (!scope) return;
    const map = { ...(this.injectedPaths || {}) };
    map[scope] = [...(map[scope] || []).filter((e) => e?.kind !== 'engineConfig'), ...paths.map((path) => ({ path, kind: 'engineConfig', source: null }))];
    this.injectedPaths = map;
    if (this.runRoot) await updateRunManifest(this.runRoot, { injectedPaths: map }).catch(() => {});
  }

  /**
   * The §8.8 entries of `key` (a member's projectKey, or 'runRoot'), minus any `engineConfig` path whose file exists
   * and is not worca's (engines/project-files.mjs worcaOwnsProjectFile): an agent may write .cursor/mcp.json as part of the task, and
   * that file must survive teardown. Every reader of the set for REMOVAL uses this; the commit and the diffs never
   * see an engineConfig pathspec (_excludePathspecs) and use _engineConfigState instead.
   */
  _injectedFor(key, dir = null) {
    const entries = this.injectedPaths?.[key] ?? [];
    if (!Array.isArray(entries)) return [];
    const base = dir || (key === 'runRoot' ? this.runRoot : this.workDirs?.get(key)) || null;
    return entries.filter((e) => e?.kind !== 'engineConfig' || !base || worcaOwnsProjectFile(base, e.path));
  }

  /**
   * The engine project files (engines/project-files.mjs ALL_PROJECT_FILES) present in checkout `dir`, split for the
   * commit and the diffs. owned: worca wrote them (worcaOwnsProjectFile) — kept out (info/exclude hides them; callers also unstage
   * them). forced: worca did not write them, the index does not hold them, and ONLY worca's own info/exclude line
   * ignores them — an agent's deliverable, force-staged. Looks at the checkout, not at injectedPaths: the exclude line
   * sits in the shared common-dir file and outlives the run that wrote it, so a later run on any engine needs this
   * too. No such file: no git command at all.
   * @returns {Promise<{owned:string[], forced:string[]}>}
   */
  async _engineConfigState(dir, { ignoreAbort = false } = {}) {
    const state = { owned: [], forced: [] };
    if (!dir) return state;
    const present = ALL_PROJECT_FILES.filter((p) => existsSync(join(dir, p)));
    for (const p of present) if (worcaOwnsProjectFile(dir, p)) state.owned.push(p);
    let foreign = present.filter((p) => !state.owned.includes(p));
    if (!foreign.length) return state;
    const opts = { cwd: dir, ignoreAbort };
    const pre = await this._git(['rev-parse', '--show-prefix'], opts);
    const ex = await this._git(['rev-parse', '--git-path', 'info/exclude'], opts);
    if (!pre.ok || !ex.ok || !ex.stdout.trim()) return state;          // not a work tree (a workspace run root)
    // An index entry (tracked, or intent-to-add from an earlier _stageWorkingTree) is never hidden by an ignore rule:
    // add -A stages its changes. Forcing it would make liveDiff list an unchanged tracked file as added.
    const indexed = await this._git(['ls-files', '-z', '--', ...foreign], opts);
    if (!indexed.ok) return state;
    const inIndex = new Set(indexed.stdout.split('\0').filter(Boolean));
    foreign = foreign.filter((p) => !inIndex.has(p));
    const prefix = pre.stdout.trim();
    const exclude = resolve(dir, ex.stdout.trim());                    // --git-path is relative to the cwd
    // check-ignore prints a relative source against the top of the work tree: `dir` with one `..` per prefix segment
    // (never --show-toplevel, a realpath on macOS).
    const top = resolve(dir, ...prefix.split('/').filter(Boolean).map(() => '..'));
    for (const path of foreign) {
      const r = await this._git(['-c', 'core.quotePath=false', 'check-ignore', '-v', '--no-index', '--', path], opts);
      if (r.code !== 0) continue;                                       // 1: not ignored (add -A stages it); else an error
      const left = r.stdout.trimEnd().split('\t')[0];                  // <source>:<line no>:<pattern>
      const line = excludeLine(prefix, path);
      if (!left.endsWith(`:${line}`)) continue;                        // another pattern decides: the user's
      const source = left.slice(0, -(line.length + 1)).replace(/:\d+$/, '').replace(/^"(.*)"$/, '$1');
      if (resolve(top, source) === exclude) state.forced.push(path);   // worca's file, not a global excludesFile
    }
    return state;
  }

  /** The `## Worca memory` pointer block: heading, one-line intro, one `Label — /abs/dir:` line per
   *  mounted scope. Depends on dirs + mount only (never on file contents), so one render per mount. */
  _refreshMemoryBlock() {
    if (!this.memory) { this.memoryBlock = ''; return; }
    const teamDir = this.memory.rules && (this.memory.team || []).some((t) => t.count > 0) ? join(this.memory.rules, 'team') : null;
    this.memoryBlock = renderMemoryBlock(this.memory.dirs.map((d) => ({ label: d.label, dir: join(this.memory.mount, d.rel) })), { engine: this.claude.engine, teamDir });
  }

  /** The `onError` every memory listing gets. A junk NAME is not an I/O failure — phrasing it
   *  as "cannot read" sends the user hunting a broken disk instead of renaming a file. */
  _memoryReadWarn(p, err) {
    if (err?.code === 'ENAME') this._memoryWarn(`memory: ignored ${p} (invalid name — not a memory file)`);
    else this._memoryWarn(`memory: cannot read ${p}: ${err?.code || err?.message || err}`);
  }

  /** Record-once warnings: the pointer block is rendered once per mount. */
  _memoryWarn(text) {
    if (this._memoryWarned.has(text)) return;
    this._memoryWarned.add(text);
    this._log('memory', 'warn', text);
  }

  /** After ONE execution (orchestrator._afterExecution) — never rejects, and serialised per
   *  run: the job reads `this.memory` when the PREVIOUS sync has published its baseline.
   *  (Composite slices and parallel branches finish together; two syncs diffing against one
   *  baseline would both write and both report the same files.) */
  _syncMemory(nc, ctx) {
    if (!this.memory) return Promise.resolve(null);
    const job = async () => {
      if (!this.memory) return null;
      // Every frame of the execution has arrived (the runner resolved before _afterExecution); a
      // null executionId is the run-end sync and drains what unfinished executions left behind.
      const failed = this._takeFailedMemoryWrites(ctx.executionId ?? null);
      try {
        return await this._syncMemoryWith({ ...this.memory, nodeId: ctx.nodeId, executionId: ctx.executionId, agentKey: nc?.key ?? null, label: nc?.key || ctx.label || ctx.nodeId, failed });
      } catch (err) {
        this._log('memory', 'warn', `memory sync failed after ${ctx.executionId}: ${err?.message || err}`);
        return null;
      }
    };
    this._memoryTail = (this._memoryTail || Promise.resolve()).then(job, job);
    return this._memoryTail;
  }

  /** Team memory (phase 1a): fetch + follow for every opted-in project of this run, bounded (TEAM_MOUNT_WAIT_MS) — a
   *  slow or offline remote never holds the run start; the mount then loads the last fetched team notes. Never throws. */
  async _refreshTeamMemory(dirs) {
    if (this.memoryScope) return;
    const on = dirs.filter((d) => d.scope?.kind === 'project' && isTeamMemoryOn(d.scope.projectKey));
    // In parallel: a workspace run waits TEAM_MOUNT_WAIT_MS at most in all, never once per member.
    await Promise.all(on.map(async (d) => {
      const key = d.scope.projectKey;
      try {
        const r = await refreshTeamLayerWithin(key, { projectDir: this.memberByKey.get(key)?.projectDir || null });
        if (r?.timedOut) this._log('memory', 'warn', `team memory: ${d.label} is still fetching — this run loads the last fetched team notes`);
        else if (r?.error) this._log('memory', 'warn', `team memory: ${d.label} could not be fetched (${r.error}) — this run loads the last fetched team notes`);
        if (r?.followed?.length) this._log('memory', 'info', `team memory: ${d.label} followed the team for ${r.followed.map((n) => `${n}.md`).join(', ')}`);
        // A follow that DELETED a local note says so: the user finds the note gone from the Memory page.
        if (r?.removed?.length) this._log('memory', 'info', `team memory: ${d.label} — removed ${r.removed.map((n) => `${n}.md`).join(', ')} here too: a teammate deleted ${r.removed.length === 1 ? 'it' : 'them'} from the team`);
        if (r?.untracked?.length) this._log('memory', 'info', `team memory: ${d.label} — ${r.untracked.map((n) => `${n}.md`).join(', ')} no longer on the team branch (it was started again): kept as local notes`);
      } catch (err) {
        this._log('memory', 'warn', `team memory: ${d.label} could not be refreshed: ${err?.message || err}`);
      }
    }));
  }

  /** The rules copy's team folder(s) — [] when nothing is opted in; null when the write failed (warned, never thrown):
   *  the caller keeps what it had, so one failed re-mount does not stop every later one. */
  async _mountTeamDirs(rules, dirs, plans) {
    try { return await mountTeamLayer({ rules, dirs, plans }); }
    catch (err) { this._log('memory', 'warn', `team memory: team notes not mounted: ${err?.message || err}`); return null; }
  }

  /** Queue what one sync changed in an opted-in project's scope (decision D1: never a global note); a blocked note is
   *  a warn line naming the reason, so the run log says why it stayed local. */
  async _queueTeamMemory(res, dirs) {
    for (const [key, names] of teamChangesFromSync(res, dirs)) {
      try {
        const q = await queueTeamChanges(key, names, { source: `run:${this.pipeline.id}` });
        if (q.skipped) continue;
        // A note this sync DELETED is queued as a removal from the team — every teammate's unedited copy follows it (D3):
        // the run log must never call that "sharing".
        const gone = new Set(teamChangesFromSync({ deleted: res?.deleted }, dirs).get(key) || []);
        const shared = q.queued.filter((n) => !gone.has(n));
        const removing = q.queued.filter((n) => gone.has(n));
        if (shared.length) this._log('memory', 'info', `team memory: sharing ${shared.map((n) => `${n}.md`).join(', ')}`);
        if (removing.length) this._log('memory', 'info', `team memory: removing ${removing.map((n) => `${n}.md`).join(', ')} from the team`);
        for (const b of q.blocked) this._log('memory', 'warn', `team memory: ${b.name}.md stays on this machine — ${b.reason}; edit it to share it`);
      } catch (err) {
        this._log('memory', 'warn', `team memory: could not queue ${names.join(', ')}: ${err?.message || err}`);
      }
    }
  }

  /** The provenance this run's memory writes carry. A remote run's agents ran in a sandbox, so what they wrote is
   *  held for review (`sandbox:`, memory-store isHeldSource; security evaluation 2026-10-21, E5). */
  _memorySource() {
    if (this.execEnvKind !== 'local') return `${SANDBOX_SOURCE_PREFIX}${this.pipeline.id}`;
    return `${this.memoryScope ? 'defrag' : 'run'}:${this.pipeline.id}`;
  }

  async _syncMemoryWith({ mount, dirs, baseline, nodeId, executionId, agentKey, label, failed = [] }) {
    const now = new Date().toISOString();
    const source = this._memorySource();
    const res = await syncBack({
      root: memoryRoot(), mount, dirs, baseline, source, now,
      caps: memoryCaps(this._settingsScope()), onWarn: (w) => this._log('memory', 'warn', w),
      onError: (p, err) => this._memoryReadWarn(p, err),
      // Team memory (phase 1a): a note's `team:` marker is worca's, never the writable copy's line from mount time (D10).
      prepare: teamClientText,
    });
    // `mount` equals this.memory.mount for every in-run sync and for a same-process resume;
    // an OLD instance can never race a resumed one because the scheduler drains in-flight
    // executions before the run reports 'paused' (scheduler.mjs, the pause drain).
    if (this.memory && this.memory.mount === mount) this.memory.baseline = res.baseline;
    if (res.total || res.rejected.length || failed.length) {
      this.memoryChanges.push({
        executionId, nodeId, agentKey, at: now,
        added: res.added, modified: res.modified, deleted: res.deleted, rejected: res.rejected, failed,
      });
      const head = `Memory: +${res.added.length} ~${res.modified.length} -${res.deleted.length}` +
        `${res.rejected.length ? ` (${res.rejected.length} rejected)` : ''}${failed.length ? ` (${failed.length} failed)` : ''} by ${label}`;
      const held = isHeldSource(source) && (res.added.length || res.modified.length)
        ? ' — held for review: written in a sandbox, so no other run or chat loads it until you approve it in Memory' : '';
      const name = (r) => `${r.scope ? `${r.scope}/` : ''}${r.name}.md`;
      const details = [
        ...res.added.map((r) => `added ${name(r)}`), ...res.modified.map((r) => `updated ${name(r)}`),
        ...res.deleted.map((r) => `deleted ${name(r)}`), ...res.rejected.map((r) => `rejected ${name(r)} — ${r.reason}`),
        ...failed.map((r) => `failed ${name(r)} — ${r.reason}`),
      ];
      this._log('memory', 'info', `${head}: ${details.join('; ')}${held}`, { nodeId, executionId });
      // A failed write is the one memory outcome nobody asked for: warn, per file, so it is visible in
      // the run log without opening the 300 KB transcript.
      for (const r of failed) this._log('memory', 'warn', `memory: ${name(r)} written by ${label} never reached the store — ${r.reason}`, { nodeId, executionId });
      await appendAudit(this.pipeline.dir, `${head}: ${details.join('; ')}${held}`).catch(() => {});
      await this._recordFailedWrites(failed, now);
    }
    // Never a defragment run's result (D15). Queued FIRST: a note on its way to the team loads in a project whose team
    // memory loads team notes only (memoryLoadPlan), so the refresh below must see its intent.
    if (res.total && !this.memoryScope) await this._queueTeamMemory(res, dirs);
    // The rules copy the NEXT execution loads must carry what this sync stored (the store is the
    // authority: it also holds Ask/UI writes made mid-run). Non-destructive and per-file atomic, so
    // a Task sub-agent spawning right now never reads a torn file; never touches the sentinel.
    // What each project loads is read again (a note now pending starts loading, a blocked one stops); the writable copy
    // keeps what it was mounted with — its baseline must stay valid.
    if (res.total && this.memory && this.memory.mount === mount && this.memory.rules) {
      const plans = this.memoryScope ? new Map() : await memoryLoadPlans(dirs);
      try {
        // the rules copy lives in the cwd: a Folder copy swapped for a link is never written through
        if (this.workMode === 'folder' && !(await this._folderCopyIntact())) throw new Error(`the run's copy is not the run's own folder: ${this.runCwd}`);
        const { failed: stale } = await withStoreLock(memoryRoot(), () => refreshMount({ root: memoryRoot(), mount: this.memory.rules, dirs: loadFilteredDirs(dirs, plans), ownSource: source, onError: (p, err) => this._memoryReadWarn(p, err) }));
        if (stale.length) this._log('memory', 'warn', `memory: the rules copy could not be refreshed for ${stale.join(', ')} — the next agent loads the previous text`);
      } catch (err) {
        this._log('memory', 'warn', `memory: the rules copy could not be refreshed: ${err?.message || err}`);
      }
      // A note stored now may shadow a team note (or a deletion un-shadow one).
      if (!this.memoryScope && this.memory.team?.length) {
        const team = await this._mountTeamDirs(this.memory.rules, dirs, plans);
        if (team) { this.memory.team = team; this._refreshMemoryBlock(); }   // the team sentence follows the new counts
      }
    }
    if (res.total && this.memory && this.memory.mount === mount && this.memory.rules) this.memory.scoped = await this._memoryScoped(this.memory.rules);
    await this._recordMemoryUsage({ res, dirs, executionId });
    if (this.memory && this.memory.mount === mount) await this._writeMemoryLedger();
    return res;
  }

  /** Whether this run's spawns carry the InstructionsLoaded counting hook (U3): a rules copy with a note that has
   *  `paths:`, never on a defragment run. Read at mount and after a sync that changed notes — never per spawn. */
  async _memoryScoped(rules) {
    if (this.memoryScope || !rules) return false;
    try { return await rulesHaveScopedNote(rules); } catch { return false; }
  }

  /** The InstructionsLoaded hook file of one execution, or null (no scoped note mounted, or a defragment run). */
  _memoryLoadLogFor(executionId) {
    return this.memory?.scoped && !this.memoryScope && executionId && this.pipeline?.dir ? memoryLoadLogPath(this.pipeline.dir, executionId) : null;
  }

  /** Memory usage (memory-usage.mjs, U6): ONE merge per sync-back of what this execution did — its hook file's
   *  `path_glob_match` loads (hit), the note Reads seen in its tool events (read) and the notes this sync stored (edit),
   *  each at most once per note. `executionId` null drains every execution (the run-end and resume syncs). A defragment
   *  run records nothing, and its bookkeeping is dropped. Best-effort: a failure is one debug line, the tally is lost. */
  async _recordMemoryUsage({ res, dirs, executionId }) {
    const pending = executionId == null ? [...this._memoryUsage.values()] : [this._memoryUsage.get(executionId)].filter(Boolean);
    if (executionId == null) this._memoryUsage.clear(); else this._memoryUsage.delete(executionId);
    const tally = createUsageTally();
    try {
      await drainMemoryLoads(this.pipeline?.dir, executionId, dirs, tally);   // always: the file goes either way
      if (this.memoryScope) return;
      for (const t of pending) for (const e of t.events()) tally.add(e, e.signal);
      for (const r of [...(res?.added || []), ...(res?.modified || [])]) tally.add(noteOfMemoryRel(`${r.scope}/${r.name}.md`, dirs), 'edit');
      if (tally.size) await recordMemoryUsage(tally.events());
    } catch (err) {
      this._log('memory', 'debug', `memory usage not recorded: ${err?.message || err}`);
    }
  }

  /** Bump the `.state` counters of every scope a failed write named (memory-write-split design D9).
   *  A write beside the scope dirs (`scope: ''`, or a rel that is not mounted) is reported but counted
   *  against no scope. Best-effort: a counter that cannot be written is a warn line, never a throw. */
  async _recordFailedWrites(failed, now) {
    if (!failed.length || !this.memory) return;
    const byRel = new Map();
    for (const f of failed) if (f.scope) byRel.set(f.scope, (byRel.get(f.scope) || 0) + 1);
    for (const [rel, n] of byRel) {
      const d = this.memory.dirs.find((x) => x.rel === rel);
      if (!d) continue;
      try {
        await withStoreLock(memoryRoot(), async () => {
          const st = await readScopeState(memoryRoot(), d.scope);
          await bumpScopeState(memoryRoot(), d.scope, { failedWrites: (Number(st.failedWrites) || 0) + n, lastFailedAt: now, lastFailedRunId: this.pipeline.id });
        });
      } catch (err) {
        this._log('memory', 'warn', `memory: failed-write counter not updated for ${rel}: ${err?.message || err}`);
      }
    }
  }

  /** Classify a tool call's target: `{ id, where, scope, name }` when it sits under the writable copy
   *  (`where: 'memory'`) or the read-only rules copy (`where: 'rules'`), else null. `scope` is the
   *  mounted rel the path starts with, else its dirname inside the copy ('' at the copy's root) — a
   *  write beside the scope dirs is still reported. Relative paths resolve against the run cwd, which
   *  is every spawn's cwd. */
  _memoryWriteKey(p) {
    if (typeof p !== 'string' || !p || !this.memory) return null;
    const abs = resolve(this.runCwd || this.workDir || this.projectDir, p);
    for (const [where, base] of [['memory', this.memory.mount], ['rules', this.memory.rules]]) {
      if (!base || !(abs === base || abs.startsWith(base + sep))) continue;
      const rel = relative(base, abs).split(sep).join('/');
      const d = this.memory.dirs.find((x) => rel === x.rel || rel.startsWith(`${x.rel}/`));
      const dn = dirname(rel);
      return { id: `${where}:${rel}`, where, rel, scope: d ? d.rel : (dn === '.' ? '' : dn), name: basename(rel).replace(/\.md$/i, '') };
    }
    return null;
  }

  _trackMemoryCalls(calls, attr) {
    if (!this.memory) return;
    const exec = attr?.executionId ?? '(no execution)';
    for (const c of calls) {
      if (MEMORY_READ_TOOLS.has(c.name) && !this.memoryScope) {
        const key = this._memoryWriteKey(c.input?.file_path || c.input?.path);
        const ref = key && noteOfMemoryRel(key.rel, this.memory.dirs);
        if (ref) {
          if (!this._memoryUsage.has(exec)) this._memoryUsage.set(exec, createUsageTally());
          this._memoryUsage.get(exec).add(ref, 'read');
        }
        continue;
      }
      if (!MEMORY_WRITE_TOOLS.has(c.name) || typeof c.toolUseId !== 'string') continue;
      const key = this._memoryWriteKey(c.input?.file_path || c.input?.path || c.input?.notebook_path);
      if (!key) continue;
      const rec = this._memoryWrites.get(exec) || { calls: new Map(), last: new Map() };
      rec.calls.set(c.toolUseId, key);
      this._memoryWrites.set(exec, rec);
    }
  }

  _trackMemoryResults(results, attr) {
    if (!this.memory) return;
    const exec = attr?.executionId ?? '(no execution)';
    for (const r of results) {
      if (typeof r.toolUseId !== 'string') continue;
      const rec = this._memoryWrites.get(exec);
      const key = rec?.calls.get(r.toolUseId);
      if (!key) continue;
      // 400: the CLI's refusal quotes the absolute path and ends with the cause ("… which is a
      // sensitive file.") — a deep run-root path must not clip the cause away.
      rec.last.set(key.id, { ...key, ok: !r.isError, reason: r.isError ? clip(toolResultText(r), 400) : '' });
    }
  }

  /** The keys whose LAST write outcome in `executionId` was an error, as `[{ scope, name, reason }]`
   *  (a retry that succeeded clears the failure); that execution's bookkeeping is dropped. `null`
   *  drains EVERY pending execution — the run-end sync, so an execution the run never finished
   *  (stop, error) still reports (design D13). A rules-copy write names its own cause first. */
  _takeFailedMemoryWrites(executionId) {
    const recs = executionId == null ? [...this._memoryWrites.values()] : [this._memoryWrites.get(executionId)].filter(Boolean);
    if (executionId == null) this._memoryWrites.clear(); else this._memoryWrites.delete(executionId);
    const out = [];
    for (const rec of recs) for (const v of rec.last.values()) {
      if (v.ok) continue;
      out.push({ scope: v.scope, name: v.name, reason: v.where === 'rules' ? `written into the read-only rules copy — ${v.reason}` : v.reason });
    }
    return out;
  }

  /** `{ mount, rules, dirs, baseline, changes }` — best-effort, atomic via temp + rename. */
  async _writeMemoryLedger({ neutralised = false } = {}) {
    if (!this.pipeline?.dir || (!this.memory && !neutralised)) return;
    const file = this._memoryLedgerPath();
    // `neutralised` (after a mount failure) keeps the change history but writes no dirs and
    // no baseline, so a later resume has nothing stale to diff against (a missing mount dir
    // must never read as "the run deleted every file").
    const payload = neutralised
      ? { mount: null, rules: null, dirs: [], baseline: {}, changes: this.memoryChanges }
      : { mount: this.memory.mount, rules: this.memory.rules, dirs: this.memory.dirs, baseline: this.memory.baseline, changes: this.memoryChanges };
    const tmp = `${file}.tmp-${process.pid}-${++this._ledgerSeq}`;
    try { await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8'); await rename(tmp, file); }
    catch (err) { this._log('memory', 'warn', `memory ledger not written: ${err?.message || err}`); }
  }

  /** The `## Memory health` section a defragment run appends to its task document: the reasons the
   *  scope is flagged and the budgets a finished defragment must meet — read from the STORE (what
   *  Settings → Memory shows), which the mount mirrors at this point. '' on every other run.
   *  Best-effort: a store read failure costs the agent its brief, never the run. */
  async _defragBrief() {
    if (!this.memoryScope || !this.memory?.dirs?.length) return '';
    try {
      const caps = memoryCaps(this._settingsScope());
      const { health } = await memoryScopeReport(memoryRoot(), this.memory.dirs[0].scope, caps, { onError: (p, err) => this._memoryReadWarn(p, err) });
      return renderDefragBrief(health, caps);
    } catch (err) {
      this._log('memory', 'warn', `memory: the defragment brief could not be built: ${err?.message || err}`);
      return '';
    }
  }

  /** A finished defragment run resets the scope's counters (spec §5, §7): called on the `done`
   *  arms only, after _buildResults' final sync. `this.memory.dirs[0]` is the one mounted scope.
   *  Amendment B31: a run whose ledger holds ANY rejected write did not produce the scope the
   *  agent intended — leave the counters alone (health stays `due`) and say so, loudly.
   *  `withStoreLock` is a per-process promise chain: it serialises this stamp against this
   *  process's own syncs only, not against another worca process. */
  async _stampDefrag() {
    if (!this.memoryScope || !this.memory?.dirs?.length) return;
    const d = this.memory.dirs[0];
    const { rejected } = memoryTotals(this.memoryChanges);
    if (rejected) {
      this._log('memory', 'warn', `Memory: ${d.label} — ${rejected} write(s) were rejected during this defragment; counters NOT reset (see the rejections above)`);
      await appendAudit(this.pipeline.dir, `Memory: ${d.label} defragment finished with ${rejected} rejected write(s) — counters not reset.`).catch(() => {});
      return;
    }
    const now = new Date().toISOString();
    try {
      await withStoreLock(memoryRoot(), () => bumpScopeState(memoryRoot(), d.scope, { lastDefragAt: now, lastDefragRunId: this.pipeline.id, writesSinceDefrag: 0, failedWrites: 0, lastFailedAt: null, lastFailedRunId: null }));
      this._log('memory', 'info', `Memory: ${d.label} defragmented — write counter reset`);
      await appendAudit(this.pipeline.dir, `Memory: ${d.label} defragmented by this run.`).catch(() => {});
    } catch (err) {
      this._log('memory', 'warn', `memory: defrag stamp failed: ${err?.message || err}`);
    }
  }

  /** The run-summary shape (§6). null when nothing changed, so results.json is unchanged for such runs. */
  memorySummary() {
    if (!this.memoryChanges.length) return null;
    return { changes: this.memoryChanges, totals: memoryTotals(this.memoryChanges) };
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
    // The probe asks the `claude` binary: a run on another engine spawns no claude (and this.claude.bin is that
    // engine's binary), so its MCP config is never dropped on what claude says.
    if ((this.claude.engine || 'claude') !== 'claude') {
      await updateRunManifest(this.runRoot, {
        capabilities: { mcpGrants: MCP_GRANT_MODE, mcpConfig: null, version: null, probed: false, engine: this.claude.engine },
      });
      return;
    }
    const caps = await this._claudeCaps();
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
      this.mcpLayer = null;
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
   * @returns {Promise<{source:string, featureRaw:string, fellBack:boolean}>}
   */
  async _resolveMemberBranches(m, { replay = false } = {}) {
    const dir = resolve(m.projectDir);
    const named = (m.branch && m.branch.source) || this.branchOpts.source || null;
    // A remote-only source becomes a local tracking branch first (C14), so the silent
    // fallback below applies only when the branch exists nowhere.
    if (named && !(await isValidSourceRef(dir, named))) await this._ensureLocalSource(m, named, { replay });
    const namedOk = !!named && (await isValidSourceRef(dir, named));
    const source = namedOk ? named : await resolveDefaultBranch(dir);
    const fellBack = !!named && !namedOk;          // _syncMemberBase never syncs a fallback (D9)
    const feature = this.branchOpts.sameAsSource ? null
      : ((m.branch && m.branch.feature) || this.branchOpts.feature || null);
    const nameArgs = {
      prompt: this.pipeline.promptText,
      title: `${this.opts.title || ''} ${m.projectName}`.trim() || null,
      pipelineId: this.pipeline.id,
    };
    const legacy = this.branchOpts.legacy === true;
    let featureRaw = feature
      ? sanitizeBranchName(`${feature}-${slugify(m.projectName)}`)
      : legacy ? suggestBranchName(nameArgs)
        : deriveBranchName({ ...nameArgs, ticket: this.opts.source?.taskId || '', projectDir: m.projectDir });
    if (!feature && !legacy && !replay && flagEnabled('smartRunNaming')) {
      featureRaw = await uniqueBranch(dir, featureRaw, this.pipeline.id);
    }
    return { source, featureRaw, fellBack };
  }

  /**
   * Build a graphify AST graph INSIDE the worktree so agents (which run with
   * cwd=workDir) can query it. graphify-out/ ignores itself (runGraphifyUpdate's
   * .gitignore sentinel), so it never reaches the reviewer diff or the kept-branch
   * commit, and it does not survive teardown.
   *
   * Fail-safe — never throws. Skipped when: mock mode (keeps `npm run smoke`
   * offline); the workflow opts out (codeGraph: false); no worktree was created; or
   * the graphify binary is not on PATH. On build failure/timeout the run proceeds
   * with no graph instruction.
   */
  async _buildWorktreeGraph() {
    if (this.workMode !== 'git') { this.toolInstruction = ''; return; }
    if (this.claude.mock) return; // mock runs never use the graph (intentionally silent)
    if (this._skipCodeGraph()) { this.toolInstruction = ''; return; }
    if (this.workDir === this.projectDir) {
      this._log('graph', 'debug', 'No worktree (workDir===projectDir); skipping in-worktree graph build.');
      return; // building "in the worktree" would write into main
    }
    if (this._execBackend) {
      // A remote run's agents work in the sandbox's clone: _buildSandboxGraph builds the graph there, once it starts.
      this.toolInstruction = '';
      this._log('graph', 'info', 'the graphify graph is built in the sandbox once it starts');
      return;
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
   * A remote run's graph (docs/e2b.md "How a run works"): built in its sandbox after the code is in, so the host
   * builds nothing and uploads no graphify-out/. Same guards and fail-safe as _buildWorktreeGraph; a reconnected
   * sandbox keeps its graph and the resume point's instruction, so only a fresh sandbox calls this.
   */
  async _buildSandboxGraph() {
    if (this.claude.mock || !this.execEnv?.buildCodeGraph) return;
    if (this._skipCodeGraph()) { this.toolInstruction = ''; return; }
    if (this.workDir === this.projectDir) return;
    const res = await this.execEnv.buildCodeGraph({ timeoutMs: this.graphBuildTimeoutMs });
    if (res.ok) {
      this.toolInstruction = worktreeGraphInstruction();
      this._log('graph', 'info', `graphify graph built in the sandbox in ${(res.ms / 1000).toFixed(1)} s.`);
      await appendAudit(this.pipeline.dir, 'Preflight: built graphify graph in the sandbox worktree (AST-only).').catch(() => {});
    } else {
      this.toolInstruction = '';
      this._log('graph', 'warn', `graphify build in the sandbox failed (${res.error}); proceeding without graph grounding`);
    }
  }

  /** The run's workflow opted out of the code graph (`codeGraph: false` on the template, frozen
   *  into the manifest, so a resume decides the same). Logs once per build site. */
  _skipCodeGraph() {
    if (this.state.stepper?.codeGraph !== false) return false;
    this._log('graph', 'info', 'The workflow does not use a code graph; skipping the graphify build.');
    return true;
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
    if (this._skipCodeGraph()) { for (const m of this.members) this.toolInstructions.set(m.projectKey, ''); return; }
    const dirs = this.members.map((m) => resolve(m.projectDir));
    const toolsByDir = await detectToolsPerProject(dirs); // never throws
    await mapWithCap(this.members, 4, async (m) => {
      if (this._memberWorkMode(m.projectKey) !== 'git') {
        this.toolInstructions.set(m.projectKey, '');
        this._log('graph', 'info', `graphify skipped for ${m.projectKey} (Folder project).`);
        return;
      }
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
    const key = this.members[0]?.projectKey ?? null;
    const injected = key ? this._injectedFor(key, info.worktreeDir) : [];
    const ec = await this._engineConfigState(info.worktreeDir, { ignoreAbort: true });
    const commit = await this._commitWork(info, this.state.branch,
      { excludePathspecs: this._excludePathspecs(key), forcePaths: ec.forced, unstagePaths: ec.owned });
    // The memory mount (the one legacy injected path) was synced at _buildResults; remove it now
    // so it rides neither the retained-work snapshot nor an outlived checkout.
    await removeInjectedPaths(info.worktreeDir, injected);
    const retained = await this._recordCommitFailure(commit, { info, branchRecord: this.state.branch });
    const merged = await this._mergeBack(key, info, this.state.branch, { retained });
    if (retained) {
      await this._snapshotRetained(info);
      this.workDir = this.projectDir;
      await this._persist().catch(() => {});
      return;
    }
    // branch:null — the branch is kept (done/error/stopped alike), except after a merge back:
    // the source then holds the same commit and the hidden branch is redundant.
    const res = await removeWorktree({
      projectDir: this.projectDir,
      worktreeDir: info.worktreeDir,
      branch: merged ? info.branch : null,
      force: true,
    });
    for (const s of res.steps.filter((x) => !x.ok)) {
      this._log('worktree', 'warn', `teardown ${s.step} failed: ${s.stderr || 'unknown error'}`, errStreamAttr(s.stderr));
    }
    if (this.pipeline) {
      await appendAudit(
        this.pipeline.dir,
        `Worktree removed at \`${info.worktreeDir}\` (${merged ? 'deleted' : 'kept'} branch \`${info.branch}\`).`,
      ).catch(() => {});
    }
    // Reflect the post-teardown reality in state for any late observer.
    if (this.state.branch) {
      this.state.branch.worktreeRemoved = true;
      this.state.branch.branchKept = !merged;
    }
    this.workDir = this.projectDir;
    await this._persist().catch(() => {});
  }

  /**
   * Workspace teardown (C1, N times): per member, commit its work onto its feature
   * branch (in its own repo), remove its checkout, and KEEP the branch — except a member
   * this run never changed (its branch is dropped) and a read-only Workspace scan (deletes
   * every branch, D5) — done, error, or stopped alike. Each member's SHA + survival flags are recorded on
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
      const ec = await this._engineConfigState(info.worktreeDir, { ignoreAbort: true });
      const commit = await this._commitWork(info, branchRecord,
        { excludePathspecs: this._excludePathspecs(projectKey_), forcePaths: ec.forced, unstagePaths: ec.owned });
      await removeInjectedPaths(info.worktreeDir, this._injectedFor(projectKey_, info.worktreeDir));
      const retained = await this._recordCommitFailure(commit, { key: projectKey_, info, branchRecord });
      const merged = await this._mergeBack(projectKey_, info, branchRecord, { retained });
      if (retained) {
        anyRetained = true;
        await this._snapshotRetained(info, projectKey_);
        this.workDirs.delete(projectKey_);
        continue;
      }
      const readOnly = this._isWorkspaceScan();   // D5: a scan leaves no branch behind
      const dropBranch = readOnly || merged;
      const res = await removeWorktree({
        projectDir: resolve(this.memberByKey.get(projectKey_)?.projectDir || this.projectDir),
        worktreeDir: info.worktreeDir,
        branch: dropBranch ? info.branch : null,
        force: true,
      });
      for (const s of res.steps.filter((x) => !x.ok)) {
        this._log('worktree', 'warn', `teardown ${projectKey_} ${s.step} failed: ${s.stderr || 'unknown error'}`, errStreamAttr(s.stderr));
      }
      const dropped = !dropBranch && await this._dropUnchangedMemberBranch(projectKey_, info, branchRecord);
      if (this.pipeline) {
        await appendAudit(
          this.pipeline.dir,
          `Worktree \`${projectKey_}\` removed at \`${info.worktreeDir}\` (${memberBranchNote(info.branch, { readOnly, dropped, merged })}).`,
        ).catch(() => {});
      }
      if (branchRecord) {
        branchRecord.worktreeRemoved = true;
        branchRecord.branchKept = !dropBranch && !dropped;
      }
      this.workDirs.delete(projectKey_);
    }
    // Keep the scalar mirror coherent for late observers — but never claim a
    // retained checkout was removed (the detached twin guards the same way,
    // via !retainedMembers.length).
    if (!anyRetained) this._mirrorPrimaryBranchTeardown();
    this.branchInfo = null;
    this.workDir = this.projectDir;
    await this._persist().catch(() => {});
  }

  /**
   * Run on the source branch (branch.sameAsSource): fast-forward the member's source to the hidden
   * branch this run committed on — only for a `done` run whose work committed (D4). Records
   * branchRecord.mergeBack ({ merged:true, sha, commits, at } | { merged:false, kind, reason, at }) and
   * returns true when the source now holds the work (the caller then deletes the hidden branch).
   * false, recording nothing, for every other run. Never throws: a throw in the teardown loop would
   * skip its final _persist.
   */
  async _mergeBack(key, info, branchRecord, { retained = false } = {}) {
    if (!branchRecord || branchRecord.sameAsSource !== true || this._isWorkspaceScan()) return false;
    const source = branchRecord.source;
    const at = new Date().toISOString();
    const notMerged = async (kind, reason, paths = null) => {
      // paths: the worktree(s) holding the source checked out (kind in-use): the banner's commands run there.
      branchRecord.mergeBack = { merged: false, kind, reason, at, ...(Array.isArray(paths) && paths.length ? { paths } : {}) };
      this._log('worktree', 'warn', `${key}: not merged back into ${source} (${kind}): ${reason}`);
      if (this.pipeline) {
        await appendAudit(this.pipeline.dir, `Not merged back into \`${source}\` (\`${key}\`): ${reason}. The work stays on \`${info.branch}\`.`).catch(() => {});
      }
      return false;
    };
    try {
      if (retained) return await notMerged('commit-failed', 'the run\'s last changes could not be committed');
      // The PROJECT dir (the user's checkout), never the run worktree: syncStatus's "checked out here"
      // is that dir's own HEAD.
      const dir = resolve(this.memberByKey.get(key)?.projectDir || this.projectDir);
      const tip = await this._git(['rev-parse', '--verify', '--quiet', `refs/heads/${info.branch}^{commit}`], { cwd: dir, ignoreAbort: true });
      const to = tip.ok ? tip.stdout.trim() : '';
      if (this.state.status !== 'done') {
        // A run that ended before committing anything left nothing behind: the source already holds all of it
        // (merged, 0 commits), so no "not merged back" warning and the caller drops the empty hidden branch.
        const ahead = to ? await this._git(['rev-list', '--count', `refs/heads/${source}..${to}`], { cwd: dir, ignoreAbort: true }) : null;
        if (ahead && ahead.ok && ahead.stdout.trim() === '0') {
          branchRecord.mergeBack = { merged: true, sha: to, commits: 0, at };
          this._log('worktree', 'info', `${key}: nothing to merge back into ${source} (the run ended ${this.state.status || 'early'} with no commits)`);
          if (this.pipeline) {
            await appendAudit(this.pipeline.dir, `Nothing to merge back into \`${source}\` (\`${key}\`): the run made no commits.`).catch(() => {});
          }
          return true;
        }
        return await notMerged('not-done', `the run ended ${this.state.status || 'early'}`);
      }
      if (!to) return await notMerged('failed', `could not read ${info.branch}`);
      const r = await fastForwardTo(dir, { base: source, to, message: `worca: fast-forward ${source} to run ${this.pipeline?.id || ''}` });
      if (!r.ok) return await notMerged(r.kind, r.error, r.paths);
      branchRecord.mergeBack = { merged: true, sha: r.to, commits: r.commits, at };
      this._log('worktree', 'info', `${key}: merged back into ${source} (${r.commits} commit(s), now ${r.to.slice(0, 10)})`);
      if (this.pipeline) {
        await appendAudit(this.pipeline.dir, `Merged back: \`${source}\` fast-forwarded to \`${r.to.slice(0, 10)}\` (${r.commits} commit(s), \`${key}\`).`).catch(() => {});
      }
      return true;
    } catch (err) {
      return notMerged('failed', (err && err.message) || String(err));
    }
  }

  /**
   * The ONLY owner of normal-path teardown, wired into BOTH terminal `finally`
   * blocks (run()'s and resume()'s — the latter is an identical bare per-member
   * teardown today, so wiring only run()'s would keep legacy teardown on every
   * detached run finishing after a resume, i.e. every crash-interrupted run).
   * Still skipped entirely when the run paused (§8.13) — the caller guards.
   *
   * Under `legacy` this delegates to today's _teardownWorktree / _teardownWorktreeAll
   * verbatim, except that both now commit with the §8.8 exclusion set (the memory mount)
   * and remove the mount after the commit attempt. Under `detached`, per member, in NORMATIVE order:
   *   1. modified-mount rescue (§8.20) — read-only, so it survives any later failure
   *   2. strip every claudeMdSection fenced block (must precede the commit — that
   *      file is deliberately NOT in the exclusion pathspecs)
   *   3. _commitWork with the §8.8 exclusion set (+ status recheck, hook retry)
   *   4. remove this worktree's remaining injected paths
   *   5. removeWorktree(force:true) — the branch is kept, except on a read-only Workspace scan
   *      (deleted, D5) and a workspace member this run never changed (dropped)
   * then, at the run-root level: (6) the same rescue for run-root mounts, (7) the
   * §8.11 stray scan, (8) the run.json durability copy, (9) guarded rm -rf (§8.13).
   */
  async _teardownRunRoot() {
    // §10: run.json writes still queued on the MCP chain land before the manifest is copied and
    // the run root removed, and the chain closes: an agent event that arrives later (a sibling
    // still streaming after a failure) must not recreate the removed root.
    this._mcpClosed = true;
    await this._mcpTail;
    // G22: first, so no later step that fails or keeps the run root leaves the MCP config's secrets behind.
    if (this.runRoot) await removeRunMcpConfig(this.runRoot).catch(() => {});
    if (this.runRootMode !== 'detached') {
      if (this.isWorkspace) await this._teardownWorktreeAll();
      else await this._teardownWorktree();
      return;
    }
    const pipelineDir = this.pipeline?.dir || null;
    const entries = [...this.branchInfos.entries()];   // [projectKey, info]
    this.branchInfos = new Map();                      // guard against a double teardown
    const retainedMembers = [];
    const at = new Date().toISOString();
    for (const m of this.members) {                              // the folder arm, per member (S23)
      if (this._memberWorkMode(m.projectKey) !== 'folder') continue;
      const t = await this._teardownFolderMember(m.projectKey);
      if (t.pending) retainedMembers.push({ projectKey: m.projectKey, copyDir: t.copyDir, reason: RETAIN_REASONS.FOLDER_APPLY, at });
    }
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
      const ec = await this._engineConfigState(wt, { ignoreAbort: true });
      const commit = await this._commitWork(
        info, branchRecord, { excludePathspecs: this._excludePathspecs(key), forcePaths: ec.forced, unstagePaths: ec.owned },
      );
      const retained = await this._recordCommitFailure(commit, { key, info, branchRecord });
      // (4) remove what worca-cc injected, so nothing can be committed dangling or
      // outlive the run root. An engine config file worca did not write stays (_injectedFor).
      await removeInjectedPaths(wt, this._injectedFor(key, wt));
      const merged = await this._mergeBack(key, info, branchRecord, { retained });
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
      // (5) remove the checkout. The branch is kept — except on a read-only Workspace scan
      // (D5), a workspace member this run never changed ("affected only"), and after a merge
      // back (the source now holds the same commit).
      const readOnly = this._isWorkspaceScan();   // D5: a scan leaves no branch behind
      const dropBranch = readOnly || merged;
      const res = await removeWorktree({
        projectDir: resolve(this.memberByKey.get(key)?.projectDir || this.projectDir),
        worktreeDir: wt,
        branch: dropBranch ? info.branch : null,
        force: true,
      });
      for (const s of res.steps.filter((x) => !x.ok)) {
        this._log('worktree', 'warn', `teardown ${key} ${s.step} failed: ${s.stderr || 'unknown error'}`, errStreamAttr(s.stderr));
      }
      const dropped = !dropBranch && await this._dropUnchangedMemberBranch(key, info, branchRecord);
      if (this.pipeline) {
        await appendAudit(
          this.pipeline.dir,
          `Worktree \`${key}\` removed at \`${wt}\` (${memberBranchNote(info.branch, { readOnly, dropped, merged })}).`,
        ).catch(() => {});
      }
      if (branchRecord) {
        branchRecord.worktreeRemoved = true;
        branchRecord.branchKept = !dropBranch && !dropped;
      }
      this.workDirs.delete(key);
    }
    // Keep the scalar mirror coherent for late observers (never on a retained member).
    // P5: a pending Folder member (folder-apply) is no reason to leave a Git primary's mirror unstamped; a Folder primary has none.
    const commitRetained = retainedMembers.some((r) => (r.reason ?? RETAIN_REASONS.COMMIT_FAILED) === RETAIN_REASONS.COMMIT_FAILED);
    if (!commitRetained && this.workMode === 'git' && this._memberWorkMode(this.members[0]?.projectKey) === 'git') this._mirrorPrimaryBranchTeardown();
    this.branchInfo = null;
    this.workDir = this.projectDir;

    if (this.runRoot && this.workMode === 'none') {
      const work = join(this.runRoot, WORK_DIR_NAME);
      // P3-D19: rescue and remove only inside the run's own work/ — never through one an agent swapped for a link (the
      // harvest below refuses that one and keeps the root)
      if (await ownWorkDir(work)) {
        // rescue FIRST (read-only), as the git and folder arms do: an agent's edit to a mounted skill is never lost
        const rescued = await rescueModifiedMounts({
          baseDir: work, entries: this.injectedPaths?.[NO_PROJECT_KEY] ?? [], pipelineDir, scope: NO_PROJECT_KEY, pipelineId: this.pipeline?.id, strict: true,
        });
        for (const w of rescued) await this._recordRunWarning(w);
        await removeInjectedPaths(work, this._injectedFor(NO_PROJECT_KEY, work), { strict: true });
      }
      const h = await harvestWork({ workDir: work, pipelineDir });
      if (h.ok) {
        for (const f of h.files) this._artifact(WORK_ARTIFACT_KIND, join(pipelineDir, ...f.split('/')));
        if (h.files.length) await appendAudit(pipelineDir, `Kept ${h.files.length} file${h.files.length === 1 ? '' : 's'} from work/ as artifacts.`).catch(() => {});
        await updateRunManifest(this.runRoot, { workHarvested: { files: h.files.length, bytes: h.bytes, unindexed: h.unindexed, at } });
      } else {
        retainedMembers.push({ projectKey: NO_PROJECT_KEY, copyDir: work, workMode: 'none', reason: RETAIN_REASONS.WORK_COPY_FAILED, at });
        this._log('worktree', 'warn', `work/ could not be copied (${h.error}); the run root is kept at ${this.runRoot}.`);
      }
      this.workDirs.delete(NO_PROJECT_KEY);
    }
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
        retain: retainedMembers.length ? { reason: retainedMembers.some((r) => (r.reason ?? RETAIN_REASONS.COMMIT_FAILED) === RETAIN_REASONS.COMMIT_FAILED) ? RETAIN_REASONS.COMMIT_FAILED : retainedMembers[0].reason, at: retainedMembers[0].at, members: retainedMembers } : null,
      });
      // (8) §5.2 durable ledger: the run root is about to disappear.
      await copyRunManifestTo(this.runRoot, pipelineDir);
      // (9) guarded removal (§8.13).
      if (retainedMembers.length && retainedMembers.some((r) => (r.reason ?? RETAIN_REASONS.COMMIT_FAILED) === RETAIN_REASONS.COMMIT_FAILED)) {
        this._log('worktree', 'warn',
          `Run root retained at ${this.runRoot} because ${retainedMembers.length} worktree commit(s) failed.`);
      } else if (retainedMembers.length && retainedMembers.every((r) => r.reason === RETAIN_REASONS.WORK_COPY_FAILED)) {
        // P3: a no-project run whose work/ could not be copied — logged at the harvest, the root stays
      } else if (retainedMembers.length) {
        this._log('worktree', 'info',
          `Run root retained at ${this.runRoot} until ${retainedMembers.length} Folder project(s) are applied or discarded.`);
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
    if (this.mcpLayer?.redact.length) text = createRedactor(this.mcpLayer.redact).text(text);   // MCP registry §5.5.3
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
    for (const lock of snap.clearedLocks || []) await this._recordRunWarning(staleGitLockNote(lock));
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
      if (this.telemetry) {
        const t0 = performance.now();
        await writeState(this.pipeline?.dir ?? null, this.state);
        this.telemetry.persisted(performance.now() - t0, this.state.steps?.length || 0);
      } else {
        await writeState(this.pipeline?.dir ?? null, this.state);
      }
    } catch (e) {
      this._log('git', 'error',
        `retention stamp could not be persisted (${e?.message || e}); ` +
        'the run.json retain record is the only durable copy');
    }
    return true;
  }

  /** Keep policy (issue #529, D10): re-create the checkout the teardown just removed. */
  async _keepCheckoutByPolicy() {
    if (this.workMode !== 'git') return;
    if (this._isWorkspaceScan() || this.state.status !== 'done' || !this.state.id) return;
    const { keepAfterRun } = await import('./checkout.mjs');   // lazy: no import cycle, no cost when unused
    const kept = await keepAfterRun({ pipelineId: this.state.id, log: (m) => this._log('worktree', 'info', m) });
    if (!kept) return;
    // _teardownRunRoot already _persist()ed the pre-checkout branch record. keepAfterRun stamped the
    // checkout with a targeted UPDATE, so mirror it into memory: a later _persist() must not erase it.
    await this._mirrorBranchRecords();
  }

  /** A targeted UPDATE (checkout.mjs updateBranchRecords) wrote branch records: copy them into memory so a later
   *  _persist() (writeState re-serializes branch / workspace_meta) never erases them. */
  async _mirrorBranchRecords() {
    const { findPipelineRowById } = await import('./artifacts.mjs');
    const row = findPipelineRowById(this.state.id);
    const parse = (t) => { try { return typeof t === 'string' ? JSON.parse(t) : t; } catch { return null; } };
    if (row?.target === 'workspace') {
      const branches = parse(row.workspace_meta)?.branches || {};
      for (const [k, v] of Object.entries(branches)) if (this.state.branches?.[k]) this.state.branches[k] = v;
    } else if (row?.branch) {
      const br = parse(row.branch);
      if (br) this.state.branch = br;
    }
  }

  /** #620 (D9): after teardown the branch holds the run's final commit; check it against its fetched base. */
  async _checkBaseAfterRun() {
    if (this.workMode !== 'git') return;
    if (this._isWorkspaceScan() || !this.state.id || !['done', 'stopped', 'error'].includes(this.state.status)) return;
    const { afterRunBaseCheck } = await import('./base-conflicts.mjs');   // lazy, like checkout.mjs
    await afterRunBaseCheck(this.state.id, { log: (m) => this._log('git', 'info', m) });
    await this._mirrorBranchRecords();
  }

  /** A Workspace scan run (wf_workspace_scan on a workspace target) is READ-ONLY: nothing is
   *  committed and every member's run branch is deleted at teardown. Read live, never cached:
   *  resume() restores this.workflowId from the resume point AFTER construction. */
  _isWorkspaceScan() {
    return this.isWorkspace && isWorkspaceScanWorkflow(this.workflowId);
  }

  /** wf_workspace_resynth (a partial re-scan after a member removal): freeze the stored, already
   *  pruned map — and a copy of its merged graph, under the bare name finalize's adoptGraphFile
   *  adopts — into the run folder ONCE. The seed card reads it from there (a script child never
   *  opens the worca DB). Called at start (_run, after the overrides freeze) and at resume (_resume,
   *  after _reattachCheckouts): a run a user pause parked during setup, before its first freeze,
   *  freezes on resume. Once the frozen copy exists every later call is a no-op.
   *  No stored map, or one of another member set: TERMINAL, not a pause (setup failures pause by
   *  default) — a resume would read the same map and replay into the same pause, and a paused
   *  re-synthesis owns the workspace (server ownsWorkspaceTarget), which would refuse Re-scan. The
   *  server checks the same before launching (afterMembersChanged); this is the race-proof re-check. */
  async _freezeStoredMap() {
    if (!this.isWorkspace || this.workflowId !== WORKSPACE_RESYNTH_WORKFLOW_ID || !this.pipeline?.dir) return;
    const dest = join(this.pipeline.dir, STORED_MAP_FILE);
    if (existsSync(dest)) return;
    const wsId = this.workspace.id || this.workspaceKey;
    const stored = await readWorkspaceMap(wsId);
    const why = resynthBlocker(stored && stored.map, this.members.map((m) => m.projectKey));
    if (why) throw markTerminal(new Error(`partial re-scan: ${why} — use Re-scan for a full one`));
    let map = stored.map;
    if (map.graph && map.graph.file) {
      const copied = await copyFile(join(workspaceStorePath(wsId), WORKSPACE_GRAPH_FILE), join(this.pipeline.dir, WORKSPACE_GRAPH_FILE)).then(() => true, () => false);
      map = { ...map, graph: copied ? { ...map.graph, file: WORKSPACE_GRAPH_FILE } : { mode: 'none', file: null, nodes: 0, bridges: 0 } };
    }
    await writeFile(dest, JSON.stringify({ map }), 'utf8');
  }

  /**
   * "Affected projects only" (workspace runs): at TERMINAL teardown — after the commit
   * step, on the non-retained path, once the checkout is gone — a member branch this run
   * CREATED and never moved carries no change, so it is deleted instead of left behind.
   * `baseSha` is the "this run created it" proof: it is stamped only on a fresh start
   * (_setupRunRoot), never on a pre-existing/reused branch, and survives resume via
   * workspace_meta. (`reusedExisting` is NOT usable: a setup replay re-attaches the
   * branch its own first attempt created and reports true.) The primary is treated like
   * any other member. A scan run keeps its own unconditional delete. Returns true when the
   * branch was deleted; any doubt keeps it. Never throws.
   */
  async _dropUnchangedMemberBranch(key, info, branchRecord) {
    if (!this.isWorkspace || this._isWorkspaceScan()) return false;
    const sha = branchRecord?.baseSha;
    if (!sha || !info?.branch) return false;
    const projectDir = resolve(this.memberByKey.get(key)?.projectDir || this.projectDir);
    let res;
    try {
      res = await deleteBranchIfAt({ projectDir, branch: info.branch, sha });
    } catch (e) {
      res = { deleted: false, reason: e?.message || String(e) };
    }
    if (!res.deleted) {
      // 'moved' is the ordinary "this project changed" outcome — nothing to say.
      if (res.reason !== 'moved') {
        this._log('worktree', 'info', `${key}: kept branch ${info.branch} (${res.reason}${res.stderr ? `: ${res.stderr}` : ''})`);
      }
      return false;
    }
    branchRecord.branchDeleted = { reason: 'unchanged', at: new Date().toISOString() };
    this._log('worktree', 'info', `${key}: no changes — deleted branch ${info.branch}`);
    return true;
  }

  /** Keep the scalar `state.branch` (the `pipelines.branch` column) coherent after a
   *  non-retaining teardown. On a workspace run it mirrors the PRIMARY member's real
   *  outcome — kept, or dropped as unchanged; a single-project run keeps today's stamp. */
  _mirrorPrimaryBranchTeardown() {
    if (!this.state.branch) return;
    this.state.branch.worktreeRemoved = true;
    const primary = this.isWorkspace ? this.state.branches?.[this.members[0]?.projectKey] : null;
    this.state.branch.branchKept = primary && typeof primary.branchKept === 'boolean'
      ? primary.branchKept
      : !this._isWorkspaceScan() && this.state.branch.mergeBack?.merged !== true;   // merged back: the hidden branch is gone
    if (primary?.branchDeleted) this.state.branch.branchDeleted = primary.branchDeleted;
  }

  /** Workspace scan: save the scan's map + description as the workspace's (workspace-scan-run.mjs
   *  finalizeWorkspaceScan) — create it on a first scan, update it on a re-scan. The `done` path
   *  of run() and resume() only, BEFORE the status flips, so the run log carries the outcome. A
   *  failure is a warning on a done run (the outputs stay in the run folder), never an error. */
  async _finalizeWorkspaceScan() {
    if (!this._isWorkspaceScan() || !this.pipeline) return;
    const res = await finalizeWorkspaceScan({
      // The target's id (server: the future workspaceKey on a first scan, the EXISTING id on a
      // re-scan — never recomputed, a renamed workspace keeps its id). key === id for workspaces.
      workspaceId: this.workspace.id || this.workspaceKey,
      name: this.workspace.name,
      projectPaths: this.members.map((m) => resolve(m.projectDir)),
      pipelineDir: this.pipeline.dir,
      models: this.opts.scanModels ?? null,
    });
    this.state.workspaceScan = { ...res, at: new Date().toISOString() };
    if (res.outcome === 'failed') {
      this._log('orchestrator', 'warn', `Workspace not saved: ${res.error}`);
      await appendAudit(this.pipeline.dir, `Workspace **not saved**: ${res.error}`).catch(() => {});
    } else {
      this._log('orchestrator', 'info', `Workspace ${res.outcome}: ${this.workspace.name} (${res.workspaceId})`);
      await appendAudit(this.pipeline.dir, `Workspace **${res.outcome}**: \`${res.workspaceId}\`.`).catch(() => {});
    }
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
   *   worktree. Since the native-rules revision every run passes one (the memory mount),
   *   so the argv is `git add -A -- . :(exclude).claude/rules/worca`, preceded by a
   *   `git rm -r --cached --ignore-unmatch -- .claude/rules/worca` that unstages anything an
   *   agent force-staged there (`git add -A` with an exclude never unstages); the DEFAULT empty
   *   array (a refused mount) still reproduces the bare `git add -A`. The detached
   *   `_teardownRunRoot` path commits through this same method, so it is covered too.
   * @returns {Promise<{ok:true,committed:boolean,sha:string|null}|
   *                   {ok:false,step:'status'|'add'|'commit',message:string,fromStderr:boolean}>}
   *   `fromStderr` records whether `message` embeds real stderr bytes (vs. the
   *   `exit N` fallback), so the caller's warn can tag its provenance truthfully.
   */
  async _commitWork(info, branchRecord = this.state.branch, { excludePathspecs = [], forcePaths = [], unstagePaths = [] } = {}) {
    const cwd = info?.worktreeDir;
    if (!cwd) return { ok: true, committed: false, sha: null };
    if (this._isWorkspaceScan()) {
      this._log('git', 'info', 'Read-only workspace scan: nothing is committed.');
      return { ok: true, committed: false, sha: null };
    }
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
    if (!status.stdout.trim() && !forcePaths.length) {   // porcelain never lists an ignored deliverable (forcePaths)
      this._log('git', 'info', 'No changes to commit (working tree clean).');
      return { ok: true, committed: false, sha: null };
    }
    // `git add -A -- . :(exclude)X` does not UNSTAGE what is already in the index: an agent that
    // ran `git add -f .claude/rules/worca` (the one way past the mount's `.gitignore` sentinel)
    // would otherwise put memory files on the kept branch, and on a resume the tracked guard would
    // then refuse the mount for the rest of the run. Drop the exclusion set from the index first —
    // a no-op (exit 0) when nothing under it is staged, thanks to --ignore-unmatch.
    if (excludePathspecs.length) {
      await this._gitIndexWrite(['rm', '-r', '--cached', '-q', '--ignore-unmatch', '--',
        ...excludePathspecs.map((s) => s.replace(/^:\(exclude\)/, ''))], gitOpts);
    }
    const add = excludePathspecs.length
      ? await this._gitIndexWrite(['add', '-A', '--', '.', ...excludePathspecs], gitOpts)
      : await this._gitIndexWrite(['add', '-A'], gitOpts);
    if (!add.ok) {
      const message = add.stderr.trim() || `exit ${add.code}`;
      this._log('git', 'warn', `commit skipped: git add failed: ${message}`, errStreamAttr(add.stderr));
      return { ok: false, step: 'add', message, fromStderr: !!add.stderr.trim() };
    }
    // An agent's own engine config file (.cursor, .gemini) that only worca's info/exclude line hides (_engineConfigState): force-staged.
    if (forcePaths.length) {
      const f = await this._gitIndexWrite(['add', '-f', '--', ...forcePaths], gitOpts);
      if (!f.ok) this._log('git', 'warn', `git add -f ${forcePaths.join(' ')}: ${f.stderr.trim() || `exit ${f.code}`}`, errStreamAttr(f.stderr));
    }
    // worca's own engine config files, whatever staged them (a user rule un-ignoring them, an agent's `git add -f`).
    if (unstagePaths.length) {
      await this._gitIndexWrite(['rm', '--cached', '-q', '--ignore-unmatch', '--', ...unstagePaths], gitOpts);
    }
    // §8.8 status recheck: with mounts present the porcelain gate above is never
    // clean, so a run whose agent changed nothing would attempt a commit that fails
    // with "nothing to commit". Re-check what actually got staged.
    if (excludePathspecs.length || forcePaths.length || unstagePaths.length) {
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
    // The one place worca runs the project's own commit hooks (git-guard.mjs: never under agent isolation). A sandbox
    // run's code came from an untrusted machine: no repo hook runs on this one for it, with the server's keys in its
    // environment (the sync also refuses hook changes, remote-env.mjs). Local runs keep their hooks.
    const hooks = !this._execBackend;
    if (!hooks) this._log('git', 'info', `committing without git hooks: this run's code came from the ${this._execBackend.label}`);
    let commit = await this._gitIndexWrite(['commit', '-m', msg], { ...gitOpts, hooks });
    if (!commit.ok) {
      commit = await this._git(
        ['-c', 'user.email=orchestrator@local', '-c', 'user.name=orchestrator', 'commit', '-m', msg],
        { ...gitOpts, hooks },
      );
    }
    if (!commit.ok && this.runRootMode === 'detached') {
      // §8.8 (detached runs only — legacy keeps its verbatim commit even now that it carries an
      // exclusion set): a failing hook
      // must never silently delete an agent's work. Teardown removeWorktree(force:true)s
      // the checkout right after a successful commit, so this commit is the ONLY thing
      // that carries the work onto the kept branch. A diff artifact does now survive
      // every terminal path (run()/resume() build results on stopped and error too),
      // but that is a read-only snapshot in the store — not a branch to check out,
      // rebase or push. Detached worktrees make hook failure MORE likely (§8.1:
      // husky/lint-staged resolve through an ancestor node_modules today and do not
      // detached). Retry ONCE with hooks disabled for that invocation only, logging
      // both facts. The gate is the MODE, not the exclusion set: before the native-rules
      // revision a detached default-workflow run recorded no injected path at all and was
      // silently excluded from the retry — exactly the runs §8.1 is about.
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
  /**
   * Credential-broker preflight (docs/credential-broker.md): the models in the manifest
   * (plus the step defaults and the run's own model, which an empty node model falls back
   * to) mapped to broker slots, checked against the paying person's keys. Throws a
   * Preflight error naming every missing key; a broker it can't ask never blocks here
   * (the first spawn reports that instead).
   */
  async _brokerPreflight(manifest, stepModels) {
    if (!brokerEnabled() || mockEnabled({ mock: this.claude.mock })) return;
    // Script and flow cards only: nothing spawns a model, so no key is needed.
    if (!manifestNeedsModel(manifest)) return;
    let info;
    try { info = await brokerInfo(); } catch { return; }
    const person = info.mode === 'multi' ? currentBillTo() : 'local';
    if (info.mode === 'multi' && (!person || person === 'local') && !process.env.WORCA_BROKER_SYSTEM_BILL_TO) {
      throw Object.assign(new Error('Preflight failed: this run has no signed-in person to charge. Start it from the web UI, or set WORCA_BROKER_SYSTEM_BILL_TO.'), { errorClass: 'auth' });
    }
    const models = manifestModels(manifest);
    for (const m of Object.values(stepModels || {})) if (typeof m === 'string' && m.trim()) models.add(m.trim());
    if (this.claude?.model) models.add(this.claude.model);
    if (!models.size) models.add('claude-sonnet-5');   // nothing named: the CLI's own default is a Claude model
    try { await syncPluginSlots(); } catch { /* the spawn says why */ }
    let status;
    try { status = (await personSlots(person === 'local' || !person ? (process.env.WORCA_BROKER_SYSTEM_BILL_TO || 'local') : person)).slots || []; } catch { return; }
    const r = missingCredentials([...models], modelSlot, status);
    if (r.missing.length || r.errors.length) {
      throw Object.assign(new Error(`Preflight failed: ${describeMissing(r, info.publicUrl)}`), { errorClass: 'auth' });
    }
  }

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
    this._persistPolicyState();                        // first boundary with a row: home/sha/deviations land
    const teamFields = this.policyRun?.fields || {};
    const home = this.policyRun?.home || null;
    // resume() rehydrates state.steps but not state.totalCostUsd, so the row
    // total reads $0 until the first cost event of the resumed run. Take the
    // larger of the two so a resumed over-cap pipeline cannot run one free step.
    const spentHere = Math.max(this.state.totalCostUsd || 0, sumStepCosts(this.state.steps));
    // Team policy (design §7): the tighter of the developer's cap and a soft team cap applies;
    // a team default only starts the developer off. `binding` says whose number tripped.
    const teamPipe = teamFields['cost.pipelineLimitUsd'] || null;
    const pipe = effectiveCap({ local: pipelineCostLimitUsd(this._settingsScope()), team: teamPipe });
    // The developer's own cap (or a team DEFAULT, which is the same thing): the existing
    // pause + the existing per-pipeline override. A team-bound fold has no "own" cap here.
    const ownCap = pipe.binding === 'team' ? null : pipe.cap;
    if (ownCap != null && spentHere >= ownCap && !readCostCapOverride(this.pipeline.id)) {
      this._capReached(REASON.COST_PIPELINE,
        `pipeline cost limit reached ($${spentHere.toFixed(2)} >= $${ownCap.toFixed(2)})`);
    }
    // The team SOFT cap, whether or not it is the tighter number: the local override never
    // bypasses it — only the team override ("continue past team cap") does.
    if (teamPipe && teamPipe.kind === 'soft' && spentHere >= teamPipe.value && !hasPipelineOverride(this.pipeline.id)) {
      const detail = `team cost cap reached ($${spentHere.toFixed(2)} >= $${Number(teamPipe.value).toFixed(2)}, ${home})`;
      this._teamCapBreach('pipeline', teamPipe, detail, REASON.COST_PIPELINE_POLICY);
    }
    const period = this._effectiveResetPeriod();
    const tot = effectiveCap({ local: totalCostLimitUsd(), team: teamFields['cost.totalLimitUsd'] || null });
    if (tot.cap != null) {
      const windowStartMs = costWindowStart(new Date(), period).getTime();
      const spent = totalWindowSpendUsd(windowStartMs);
      if (spent >= tot.cap) {
        const w = period === 'weekly' ? 'week' : 'month';
        if (tot.binding === 'team') {
          const ack = readTotalAck(projectKey(this.policyRun.homeDir || this.projectDir), home, windowStartMs);
          if (ack) {
            // Acknowledged once for this window (design §7): the run proceeds and the record says so.
            if (!this._policyWarned.has('total-ack')) { this._policyWarned.add('total-ack'); this._persistPolicyState({ overrides: ['total'], ...(ack.reason ? { reason: ack.reason } : {}) }); }
          } else {
            const detail = `team total cap reached ($${spent.toFixed(2)} >= $${tot.cap.toFixed(2)} this ${w}, ${home})`;
            this._teamCapBreach('total', tot.team, detail, REASON.COST_TOTAL_POLICY);
          }
        } else {
          this._capReached(REASON.COST_TOTAL,
            `total cost limit reached ($${spent.toFixed(2)} >= $${tot.cap.toFixed(2)} this ${w})`);
        }
      }
    }
    // A step whose cost could not be counted (design §4.3): the caps cannot see it. Once per transition (in memory: a
    // resumed run is not paused again for the same step).
    const unknown = this._costUnknownPending;
    if (unknown) {
      this._costUnknownPending = null;
      const detail = `this run's cost can no longer be counted (${unknown.why}, step ${unknown.stepKey})`;
      if (ownCap != null && !readCostCapOverride(this.pipeline.id)) {
        this._capReached(REASON.COST_PIPELINE, `${detail}; the pipeline cost limit cannot see it`);
      } else if (teamPipe && teamPipe.kind === 'soft' && !hasPipelineOverride(this.pipeline.id)) {
        this._teamCapBreach('pipeline', teamPipe, `${detail}; the team cost cap cannot see it (${home})`, REASON.COST_PIPELINE_POLICY);
      } else if (tot.cap != null && tot.binding !== 'team') {
        this._capReached(REASON.COST_TOTAL, `${detail}; the total cost limit cannot see it`);
      } else if (tot.cap != null) {
        this._teamCapBreach('total', tot.team, `${detail}; the team total cap cannot see it (${home})`, REASON.COST_TOTAL_POLICY);
      }
    }
  }

  /** The reset period: the developer's when stored, else a team default, else monthly. */
  _effectiveResetPeriod() {
    const stored = readRawSettings().costLimitResetPeriod;
    if (stored === 'weekly' || stored === 'monthly') return stored;
    const team = this.policyRun?.fields?.['cost.resetPeriod'];
    return team && (team.value === 'weekly' || team.value === 'monthly') ? team.value : costLimitResetPeriod();
  }

  /**
   * A soft team cap was hit and nobody has continued past it. `onBreach: warn`, and any
   * unattended (--yes) run, log ONE line and go on with `exceeded` recorded; otherwise the
   * run pauses on the policy reason so the resume flow can offer "continue past".
   */
  _teamCapBreach(which, team, detail, reason) {
    const breach = team?.onBreach || 'pause';
    // Night mode may continue past a TEAM soft cap when allowed (never a developer's own caps):
    // the unattended run then behaves like --yes here, and the override is a flagged decision.
    const nightOverride = !this.auto && breach !== 'warn' && this._nightActiveNow()
      && effectiveNightConfig(this.projectDir).config.allowCostCapOverride === true;
    if (breach === 'warn' || this.auto || nightOverride) {
      if (this._policyWarned.has(which)) return;
      this._policyWarned.add(which);
      const why = breach === 'warn' ? 'the policy says warn'
        : nightOverride ? 'Away mode may continue past the team\'s cost cap (allowCostCapOverride)'
          : 'unattended run, nobody can continue past a pause';
      this._log('policy', 'warn', `${detail} — continuing: ${why}`);
      this._persistPolicyState({ exceeded: [which] });
      if (nightOverride) {
        const q = { id: `cost-cap-${which}`, kind: 'cost-cap' };
        const rec = this._nightRecord(q, { choice: 'continue', strategy: 'rule', flagged: true, rationale: detail, reversible: false });
        this._emit('night-decision', { id: q.id, kind: q.kind, record: rec });   // no pending question has this id
      }
      return;
    }
    this._capReached(reason, detail);
  }

  /** The BUDGET site (failure-policy.mjs): a cost cap was reached at a step
   *  boundary. Unlike the catch-block sites this throws itself — its caller is
   *  the boundary gate. The audit line is required: _completePaused suppresses
   *  its generic audit whenever pauseReason is set. */
  _capReached(code, detail) {
    const verdict = resolveFailure({ site: 'budget', cls: code, auto: this.auto });
    if (verdict.outcome === 'pause') {
      this._pauseFor(verdict.reason, null, { detail });
      throw pauseErr();
    }
    throw markTerminal(new Error(detail));
  }

  /**
   * Resolve the NODE-site verdict for a failed execution (failure-policy.mjs),
   * running the recovery round it calls for on the way: auto mode backs off before
   * a 'retry' (a pause fired DURING backoff still returns 'retry' — the caller
   * checks pauseRequested first and unwinds as THAT pause, so a user pause is never
   * followed by a wasted retry); interactive mode opens ONE shared prompt per error
   * class (same-class siblings await the same answer), serialized so only one
   * recovery prompt is open at a time (the gate holds a single pendingQuestion),
   * and re-resolves with the answer. The per-class dedupe map shares ONE answer
   * across siblings; a sibling that receives a pause verdict second finds
   * pauseRequested already set and unwinds as that same pause.
   * A network-class failure first probes the step's endpoint (network-wait.mjs): when it
   * does not answer, an auto run waits for it and then retries with a fresh budget, and
   * an interactive run opens the prompt at once and answers Retry itself when it answers.
   * @returns {Promise<{outcome:'retry'|'pause'|'error', reason?:string, reset?:boolean}>}
   */
  async _recover({ node, cls, err, attempt, model = null }) {
    const verdict = resolveFailure({ site: 'node', cls, auto: this.auto, attempt });
    // A network-class failure first asks whether the step's endpoint answers at all.
    // Reachable (or not probeable) → today's verdict, unchanged. Unreachable → wait for it.
    const net = cls === 'network' ? await this._networkCheck(model) : null;
    const waitNow = !!(net && !net.reachable);
    if (!waitNow && verdict.outcome !== 'retry' && verdict.outcome !== 'prompt') return verdict;   // no recovery round
    this._log(node.key, 'warn', `recoverable ${cls} error: ${err.message}`, err?.stream ? ERR_STREAM : null);
    await appendAudit(this.pipeline.dir, `Recoverable **${cls}** error on ${node.key}: ${firstLine(err.message)}`).catch(() => {});

    if (waitNow && this.auto) {
      const out = await this._networkWait(node.key, net);
      if (out === 'back') {
        this._log(node.key, 'info', `network back — retrying ${node.key}`);
        await appendAudit(this.pipeline.dir, `Network back: ${net.host} answers again — retrying ${node.key}${byActor(NETWORK_ACTOR)}.`, { actor: NETWORK_ACTOR }).catch(() => {});
        return { outcome: 'retry', reset: true };                          // a fresh retry budget (D7)
      }
      if (out === 'aborted') return { outcome: 'retry' };                  // the caller unwinds as the pause / stop
      if (out === 'timeout') {
        this._log(node.key, 'warn', `network still down after ${untilText(net.maxWaitMs)} — pausing (the max wait is reached)`);
        return resolveFailure({ site: 'node', cls, auto: true, attempt: Number.MAX_SAFE_INTEGER });   // today's final verdict
      }
      // 'disabled': switched off mid-wait — today's path from here.
    }
    if (waitNow && !this.auto) return this._networkPrompt({ node, cls, err, attempt, verdict, net });

    if (verdict.outcome === 'retry') {
      const delayMs = recoveryDelayMs({ cls, attempt, err });
      this._log(node.key, 'warn', `${cls}: retrying in ${Math.round(delayMs / 100) / 10}s (retry ${attempt}/${RECOVERY_MAX_AUTO_ATTEMPTS})`);
      await this._backoff(attempt, this.pauseAbort.signal, { cls, err, delayMs });
      return verdict;
    }
    if (verdict.outcome !== 'prompt') return verdict;   // a spent auto budget whose network wait ended 'disabled'
    return this._promptRecovery({ cls, err, attempt, verdict });
  }

  /** Today's interactive round: ONE shared prompt per class, re-resolved with the answer. */
  async _promptRecovery({ cls, err, attempt, verdict, network = null }) {
    this._recovery ||= new Map();
    if (!this._recovery.has(cls)) {
      const p = this._enqueueRecoveryPrompt(cls, firstLine(err.message), verdict.options, attempt, network)
        .finally(() => { if (this._recovery) this._recovery.delete(cls); });
      this._recovery.set(cls, p);
    }
    const answer = await this._recovery.get(cls);
    return resolveFailure({ site: 'node', cls, auto: this.auto, attempt, answer });
  }

  /** Interactive + unreachable: the prompt opens now with the wait note; a probe loop answers Retry when it passes. */
  _networkPrompt({ node, cls, err, attempt, verdict, net }) {
    const until = Date.parse(this._net.since) + net.maxWaitMs;
    this._log(node.key, 'warn', `waiting for network… ${net.host} is unreachable; worca retries by itself when it answers (until ${hhmm(until)}), or pick Retry / Pause`);
    return this._promptRecovery({ cls, err, attempt, verdict,
      network: { nodeKey: node.key, origin: net.origin, host: net.host, since: this._net.since, until: new Date(until).toISOString(), maxWaitMs: net.maxWaitMs } });
  }

  /** Open a recovery prompt for one class, serialized behind any in-flight
   *  recovery prompt (the question gate has a single pendingQuestion slot, so
   *  distinct classes must queue — see the clarify answer). The prompt carries the
   *  row's options (what the give-up choice does); resolves the policy answer
   *  'retry' | 'giveup' (the legacy `{ decision: 'abort' }` wire value is a give-up).
   *  With `network` (the endpoint is down) the prompt carries the wait note and a
   *  probe loop answers Retry by itself once the endpoint answers. */
  _enqueueRecoveryPrompt(cls, message, options, attempt = 1, network = null) {
    const run = () => {
      const id = `recovery-${cls}-${this._recoveryNonce()}`;
      const asked = this._ask({
        id, kind: 'recovery',
        recovery: { cls, message, options, attempt, ...(network ? { network: { host: network.host, since: network.since, until: network.until } } : {}) },
      });
      // _ask installs pendingQuestion synchronously (no await before its Promise executor),
      // and the arm awaits a probe before it ever answers — no extra tick needed.
      const disarm = network ? this._armNetworkAnswer(id, network) : null;
      return asked.finally(() => disarm?.()).then((ans) => answerFromDecision(ans && ans.decision));
    };
    return this._enqueueAsk(run);
  }

  /** Stop and pause both end a network wait (a bare pauseAbort would leave a stop waiting). */
  _runSignal(extra = null) {
    return AbortSignal.any([this.abort.signal, this.pauseAbort.signal, ...(extra ? [extra] : [])]);
  }

  /**
   * Probe the step's endpoint once. null = do not wait (switched off, a mock run with no
   * injected probe, no probeable target, or a pause/stop landed mid-probe).
   * @returns {Promise<{origin:string, host:string, reachable:boolean, maxWaitMs:number}|null>}
   */
  async _networkCheck(model) {
    const cfg = effectiveNetworkWait();
    if (!cfg.enabled) return null;
    if (this.claude.mock && !this._netProbe) return null;
    const target = probeTargetForModel(model);
    if (!target) return null;
    this._net ||= { since: new Date(this._netClock.now()).toISOString(), origin: target.origin, reachable: null, waiting: false };
    let reachable;
    try { reachable = await this._probeOnce(target.origin, this._runSignal()); }
    catch { return null; }                                   // our own abort: a pause or stop is unwinding
    this._net.origin = target.origin;
    this._net.reachable = reachable;
    return { origin: target.origin, host: hostOf(target.origin), reachable, maxWaitMs: cfg.maxWaitMs };
  }

  _probeOnce(origin, signal) {
    return this._netProbe ? this._netProbe(origin, { signal }) : probeReachable(origin, { signal });
  }

  /** Auto: wait until the endpoint answers, the window closes, the user pauses/stops, or the feature is switched off. */
  async _networkWait(nodeKey, net) {
    const until = Date.parse(this._net.since) + net.maxWaitMs;
    this._log(nodeKey, 'warn', `waiting for network… ${net.host} is unreachable; worca checks again with backoff and retries by itself (until ${hhmm(until)})`);
    this._publishNetworkWait(nodeKey, until, +1);
    let out;
    try {
      out = await waitForNetwork({
        probe: (signal) => this._probeOnce(net.origin, signal), until,
        now: () => this._netClock.now(), sleep: (ms, s) => this._netClock.sleep(ms, s),
        signal: this._runSignal(), isEnabled: () => effectiveNetworkWait().enabled,
      });
    } catch (e) {
      // A --yes run must never hang: any failure of the wait falls back to today's retries.
      this._log(nodeKey, 'warn', `network wait failed (${e?.message || e}) — falling back to the usual retries`);
      out = 'disabled';
    } finally {
      this._publishNetworkWait(nodeKey, until, -1);
    }
    if (this._net) this._net.reachable = out === 'back' ? true : out === 'timeout' ? false : this._net.reachable;
    return out;
  }

  /** Interactive: answer the open recovery prompt with Retry once the endpoint answers. Returns a disarm(). */
  _armNetworkAnswer(id, network) {
    const ctrl = new AbortController();
    const signal = this._runSignal(ctrl.signal);
    const until = Date.parse(network.until);
    this._publishNetworkWait(network.nodeKey, until, +1);
    (async () => {
      const out = await waitForNetwork({
        probe: (s) => this._probeOnce(network.origin, s), until,
        now: () => this._netClock.now(), sleep: (ms, s) => this._netClock.sleep(ms, s),
        signal, isEnabled: () => effectiveNetworkWait().enabled,
      });
      if (out === 'timeout') this._log(network.nodeKey, 'warn', `network still down after ${untilText(network.maxWaitMs)} — the recovery prompt waits for your answer`);
      if (out !== 'back' || signal.aborted) return;
      // Re-check after the await: the user may have answered, paused, or switched the feature off.
      if (this.pendingQuestion?.id !== id || !effectiveNetworkWait().enabled) return;
      if (this._net) this._net.reachable = true;
      this._log(network.nodeKey, 'info', `network back — ${network.host} answers again; retrying for you`);
      if (this.answer(id, { decision: 'retry' }, NETWORK_ACTOR)) this._emit('recovery-auto', { id, kind: 'recovery', decision: 'retry' });
    })()
      .catch((e) => this._log('orchestrator', 'warn', `network watch on the recovery prompt failed: ${e?.message || e}`))
      .finally(() => this._publishNetworkWait(network.nodeKey, until, -1));
    return () => ctrl.abort();
  }

  /**
   * The run page's "waiting for network…" banner (state.networkWait) and the crash stamp:
   * while any node waits, the resume point carries network.waiting=true so the server's
   * network watch can resume a run that died mid-wait (a restart). Persisted at each edge.
   */
  _publishNetworkWait(nodeKey, until, delta) {
    this._netWaiters = Math.max(0, this._netWaiters + delta);
    const waiting = this._netWaiters > 0 && !!this._net;
    if (this._net) this._net.waiting = waiting;
    this.state.networkWait = waiting
      ? { node: nodeKey, host: hostOf(this._net.origin), since: this._net.since, until: new Date(until).toISOString() }
      : null;
    // Never null the point here (a crash before the next completion would leave the row unresumable).
    if (this.state.resumePoint) this.state.resumePoint = { ...this.state.resumePoint, network: this._net ? { ...this._net } : undefined };
    this._emit('state', this.getState());
    this._persist().catch(() => {});
  }

  /** An execution succeeded: the outage is over unless a sibling still waits (D6). */
  _networkSettled() {
    if (this._net && this._netWaiters === 0) this._net = null;
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

  /** Abort-aware backoff (recovery-backoff.mjs: base·2^(attempt-1), longer for a
   *  rate limit, at least a retry-after hint, capped per wait), resolving early
   *  (and still 'retry') if the pause-only signal fires so a pause is not delayed. */
  _backoff(attempt, signal, { cls = null, err = null, delayMs } = {}) {
    return sleepAbortable(delayMs ?? recoveryDelayMs({ cls, attempt, err }), signal);
  }

  /** Monotonic id source for recovery prompts (no Date.now/random — replay-safe). */
  _recoveryNonce() {
    return ++this._recoverySeq;
  }

  /** wsmap M15: the overrides a Workspace scan's join and render cards apply (its stored change order,
   *  its synth brief and its run-folder description follow the edges a review left standing) — the
   *  stored overrides of the workspace finalize will write (the same id: `workspace.id`, else
   *  `workspaceKey`), read ONCE when the run starts and again when it resumes. null off a scan, and on a
   *  first scan (the workspace does not exist yet). A manual edge's display and detail are a person's text,
   *  stored as typed: this doc reaches every script card's envelope file (a run artifact), so it carries
   *  them redacted, as the description shows them (D21). The join and render cards read no manual text. */
  async _scanOverrides() {
    if (!this._isWorkspaceScan()) return null;
    const ov = (await readWorkspaceMap(this.workspace.id || this.workspaceKey))?.overrides ?? null;
    return ov && { ...ov, manual: ov.manual.map((m) => ({ ...m, display: redactSecrets(m.display).slice(0, 300), detail: redactSecrets(m.detail).slice(0, 200) })) };
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
      // wsmap M15: a re-scan's frozen overrides (null otherwise) — the envelope's ctx.workspace.overrides.
      overrides: this.workspaceOverrides ?? null,
      // wsmap P2: what the script envelope's ctx.workspace is built from (script-runner.mjs
      // workspaceEnvelope) — the target's id (a first scan's is the future workspaceKey) and name,
      // and each member's LIVE project dir beside its checkout.
      workspaceId: this.workspace?.id || this.workspaceKey || null,
      workspaceName: this.workspace?.name || null,
      projects: this.members.map((m) => ({
        projectKey: m.projectKey,
        projectName: m.projectName,
        projectDir: m.projectDir ? resolve(m.projectDir) : null,
        worktreeDir: this.workDirs.get(m.projectKey),
        checkpointRef: this.checkpointRefs[m.projectKey],
        graphInstruction: this.toolInstructions.get(m.projectKey) || '',
        // P5: the member record's own mode (fake-this callers carry members only); absent = git.
        // A read-only scan writes no Changes (S51): its agents are never pointed at a changes file.
        ...(m.workMode === 'folder'
          ? { workMode: 'folder', ...(this._isWorkspaceScan?.() ? {} : { changesPatch: folderMemberFiles(this.pipeline.dir, m.projectKey).patch }) } : {}),
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
      // render-only token: the dir on disk, a shortened projectKey when the key would overflow (#411)
      relDir: this.runRootMode === 'detached' ? `repos/${basename(this.workDirs.get(m.projectKey) || m.projectKey)}` : null,
      checkpointRef: this.checkpointRefs[m.projectKey] || null,
      graphInstruction: this.toolInstructions.get(m.projectKey) || '',
      // P5: no changes file on a read-only scan (S51) — it writes none.
      ...(this.isWorkspace && this._memberWorkMode(m.projectKey) === 'folder'
        ? { workMode: 'folder', ...(this._isWorkspaceScan() ? {} : { changesPatch: this._folderFilesFor(m.projectKey).patch }) } : {}),
    }));
  }

  /**
   * Emit a question and await its resolution. Honors auto-mode.
   * Freezes the active-time clock while blocked on the user (active-time-only).
   * @returns {Promise<any>} the answer payload
   */
  async _ask({ id, kind, questions, issues, recovery, agent, nodeId, wireId, executionId, deliveryNo, holdNo, workflow, plan,
    askId, form, version, title, surface, data, layout, answerSchema, fileRefs, files, autoValues, validate, origin }) {
    this._checkAbort();
    // No interactive prompt may OPEN on a pausing run. pause() rejects only the
    // prompt that is currently open; a queued ask (a parallel sibling's questions
    // or a recovery prompt behind the _askTail chain) would otherwise still fire
    // and emit a fresh 'question' on a pausing/paused run (stale gate in the UI,
    // readline prompt while the CLI exits). Unwind it as a pause instead — the
    // owning node marks 'paused', exactly like every other pause path.
    this._checkPause();

    // Freeze the active-time clock(s) while we wait on the user (active-time-only).
    // EVERY running row, not just the first one found: concurrent executions are
    // normal on both engines, and a single-row freeze left the asking execution
    // counting the user's think time as active.
    const frozen = this._runningStepKeys();
    if (frozen.length) {
      for (const key of frozen) this._clockPause(key);
      this.state.totalActiveMs = sumStepActive(this.state.steps);
      this._emit('state', this.getState()); // UI freezes the live timer
      this._persist().catch(() => {});
    }

    this._emit('question', {
      id, kind, questions, issues, recovery, agent, nodeId,
      ...(wireId != null ? { wireId } : {}),           // v2 gates name their wire
      ...(executionId != null ? { executionId } : {}), // v2 asks name their execution
      // A gate's CYCLE and hold ordinal. The id is opaque (a re-hold suffixes
      // `-h<holdNo>`), so every consumer — the CLI header, the monitor, the audit
      // trail — reads these fields instead of parsing the id (MAJ-11).
      ...(deliveryNo != null ? { deliveryNo } : {}),
      ...(holdNo != null ? { holdNo } : {}),
      ...(workflow !== undefined ? { workflow } : {}),
      ...(plan !== undefined ? { plan } : {}),
      // The ask-form envelope (spec §4, ruling X1) rides the EXISTING 'question'
      // frame — no new transport, no new slot. `id` (already emitted above) is the
      // ANSWER token; `askId` is the route-safe file token and they are never
      // interchangeable. `validate` and `autoValues` are arguments only and must
      // never reach a socket.
      ...(kind === 'form'
        ? { askId, form, version, title, surface: surface || 'any', data, layout, answerSchema,
            fileRefs: fileRefs || [], files: files || [] }
        : {}),
    });
    this._metricsIv.questions += 1;

    let execWaiting = null;   // the remote env this ask parked (remote mode), paired in the finally
    try {
      // A night-eligible --yes run hands the ask to night mode: it is answered through the
      // same pendingQuestion + answer() path below (delay 0), so it is attributed and audited.
      // A plan approval needs a person (spec D2): --yes never answers it and Away mode never decides it.
      if (this.auto && kind !== PLAN_ASK_KIND && !this._nightOwnsAuto({ kind, origin })) {
        if (kind === 'recovery') {
          // Auto mode handles recovery in _recover before ever calling _ask;
          // this is a defensive fallback so an auto run can never hang. Giving up
          // pauses the run (errors never end one), so 'pause' is the answer.
          return { decision: 'pause' };
        }
        if (kind === 'workflow') {
          // Auto workflow under --yes: the proposal is accepted as proposed (spec D3).
          this._log('orchestrator', 'info', `auto-accepting workflow proposal ${id}`);
          return { decision: 'accept' };
        }
        if (kind === 'form') {
          // D10: a form ask is auto-answered with the form's AUTO ANSWER, which
          // gate 1 proved passes gate 3 — so an unattended run neither hangs nor
          // produces an invalid answer. No pending question is installed.
          this._log('orchestrator', 'info', `auto-answering form ${id} (${form})`);
          return { form, version, values: autoValues && typeof autoValues === 'object' ? autoValues : {} };
        }
        if (kind === 'clarify' || kind === 'questions') {
          this._log('orchestrator', 'info', `auto-answering ${kind} ${id}`);
          return { answers: (questions || []).map((q) => ({ id: q.id, choice: autoChoice(q) })) };
        }
        this._log('orchestrator', 'info', `auto-answering gate ${id} -> continue`);
        return { decision: 'continue' };
      }
      return await new Promise((resolveP, rejectP) => {
        // An outline ask keeps its marker and round, so _auditDecision can word its answer (F38).
        this.pendingQuestion = { id, kind, resolve: resolveP, reject: rejectP, validate: typeof validate === 'function' ? validate : null,
          ...(plan && plan.outline ? { plan: { outline: true, round: plan.round } } : {}) };
        // A throw inside a Promise executor REJECTS the ask (and fails the node): night mode
        // must never break a question the user could still answer.
        const nq = { id, kind, questions, issues, recovery, wireId, executionId, deliveryNo, holdNo, workflow, plan, form, version, answerSchema, autoValues, nodeId, agent, origin };
        if (kind !== PLAN_ASK_KIND) {
          try { this._nightArm(nq); } catch (err) { this._nightFailed(nq, `Away mode could not get ready for ${kind} ${id}: ${err?.message || err}`); }
        }
        // remote: an idle sandbox parks while the ask waits. Counted, so the `false` below pairs with this
        // `true` on the same env (the --yes branch above never gets here).
        execWaiting = this.execEnv;
        execWaiting?.setWaiting(true, this._execEnvMaxWaitMs());
      });
    } finally {
      execWaiting?.setWaiting(false);
      this._nightDisarm();
      this._nightCancel(id);
      this._nightPublish();
      // Resume only the rows that are STILL running AND only while the run has not
      // gone terminal. stop() sets status before rejecting the pending promise, so
      // on a stop-while-blocked we must NOT resume (the terminal _setStatus already
      // folded every clock). Gates fire after a step's 'done', so `frozen` is
      // usually empty there and nothing resumes anyway.
      //
      // The `status === 'start'` guard is load-bearing: a row that reached its
      // terminal marker WHILE the prompt was open was already clock-paused by that
      // marker, and resuming it would set runningSince on a finished step that
      // nothing will ever pause again.
      const stillRunning = ['stopped', 'error', 'pausing', 'paused'].includes(this.state.status)
        ? []
        : frozen.filter((key) => this.state.steps.find((s) => s.key === key)?.status === 'start');
      if (stillRunning.length) {
        for (const key of stillRunning) this._clockResume(key);
        this._emit('state', this.getState());
        this._persist().catch(() => {});
      }
    }
  }

  // ── Night mode (src/core/night/*) ──────────────────────────────────────────
  // While the user is away, a decider answers the open question in their place through
  // answer(id, payload, NIGHT_ACTOR), so validation, answeredBy and every audit/persist
  // path run unchanged. The user can still answer first; _ask's finally disarms the timer.

  /** A --yes run hands an ask to Away mode when the run is allowed (settings / mark / its switch) and the ask is decidable. */
  _nightOwnsAuto(q) {
    try {
      const { config } = effectiveNightConfig(this.projectDir);
      return runAllowed({ config, optIn: this._night.optIn, override: this._night.override }) && !nightNeverDecides(config, q);
    } catch { return false; }            // never let Away mode break today's --yes behaviour
  }

  _nightStateNow(config) {
    const owner = this.awayOwner();
    return nightState({ config, toggle: nightModeToggleFor(owner), hereSince: nightModeHereSinceFor(owner), optIn: this._night.optIn, override: this._night.override, now: this._nightClock.now() });
  }

  /** True when night mode may currently decide (used by the team soft-cap override). */
  _nightActiveNow() {
    try {
      const { config } = effectiveNightConfig(this.projectDir);
      return this._nightStateNow(config).active;
    } catch { return false; }
  }

  /** Schedule (or re-schedule) the decision for the open question. `q` = a newly opened ask. */
  _nightArm(q) {
    if (!this._night) return;            // a harness built without the constructor (unit seams)
    this._nightDisarm();
    if (q) { this._night.q = q; this._night.openedAt = this._nightClock.now(); }
    q = this._night.q;
    if (!q || this.pendingQuestion?.id !== q.id) return;
    try {
      const { config } = effectiveNightConfig(this.projectDir);
      this._night.decidable = !nightNeverDecides(config, q);
      if (!this._night.decidable) {
        // The kind joined neverDecide after a --yes run handed the ask to night mode: nobody else
        // will answer, so give today's --yes answer rather than hang.
        if (this.auto) this._nightAutoFallback(q, `${q.kind} is on the never-decide list`);
        return;
      }
      const st = this.auto ? { eligible: true, active: true, graceOn: false, wakeOn: false } : this._nightStateNow(config);
      const delay = decideDelayMs({ state: st, config, openedAt: this._night.openedAt, now: this._nightClock.now() });
      if (delay == null) return;
      this._night.timer = this._nightClock.setTimeout(() => {
        this._night.timer = null;
        this._nightFire(q.id).catch((err) => this._nightFailed(q, `night decision failed: ${err?.message || err}`));
      }, delay);
    } finally { this._nightPublish(); }
  }

  /** Republish state.night when the open question's openedAt changed (the run page pill reads it). */
  _nightPublish() {
    if (!this._night) return;
    const snap = this._nightSnapshot();
    if (snap.openedAt === (this.state.night?.openedAt ?? null)) return;
    this.state.night = snap;
    this._emit('state', this.getState());
  }

  /** Night mode broke on `q`: log it, and in a night-owned --yes run give today's auto answer
   *  (nobody else will answer — an unattended run must never hang). */
  _nightFailed(q, why) {
    if (this.pendingQuestion?.id !== q.id) return;   // superseded (answered, paused, stopped): nothing failed
    this._log('night', 'warn', why);
    if (this.auto && this.pendingQuestion?.id === q.id) this._nightAutoFallback(q, why);
  }

  /** May night mode decide the open question now? A night-owned --yes run always may. */
  _nightDue(config) {
    if (this.auto) return true;
    const st = this._nightStateNow(config);
    const graceDue = st.graceOn && config.graceMinutes != null && this._nightClock.now() - this._night.openedAt >= config.graceMinutes * 60_000;
    return st.eligible && (st.active || graceDue);
  }

  /** Stop kills this.abort, pause kills this.pauseAbort: night work started from a timer must honour both. */
  _nightSignal() {
    const sigs = [this.abort.signal, this.pauseAbort.signal];
    if (this._night?.decideAbort) sigs.push(this._night.decideAbort.signal);
    return AbortSignal.any(sigs);
  }

  /** The ask `id` closed (answered by someone else, paused, stopped): kill its in-flight decision
   *  (a running nightDecider child keeps billing, and `deciding` would hold up the next question). */
  _nightCancel(id) {
    if (this._night?.decideAbort && this._night.decidingId === id) this._night.decideAbort.abort();
  }

  _nightDisarm() {
    if (!this._night) return;
    if (this._night.timer != null) this._nightClock.clearTimeout(this._night.timer);
    this._night.timer = null;
  }

  /** Timer fired: re-check activation (the window/grace may not be reached yet), then decide. */
  async _nightFire(id) {
    if (this.pendingQuestion?.id !== id || this._night.deciding) return;
    const { config } = effectiveNightConfig(this.projectDir);
    if (!this._nightDue(config)) { this._nightArm(); return; }
    this._night.deciding = true;
    this._night.decidingId = id;
    this._night.decideAbort = new AbortController();
    let outcome;
    try { outcome = await this._nightDecide(this._night.q, config); }
    finally {
      this._night.deciding = false;
      this._night.decidingId = null;
      this._night.decideAbort = null;
      // A NEW question may have been armed (and its timer fired and returned early above)
      // while this decision was running — e.g. the user answered during a slow analysis.
      // Re-arm it, or it would never be decided. A dropped decision re-arms its own question.
      if (this.pendingQuestion && (outcome === 'rearm' || this.pendingQuestion.id !== id) && this._night.q?.id === this.pendingQuestion.id) this._nightArm();
    }
  }

  /** Decisions that spend the per-run maxDecisions budget (from the DB, so they survive a resume). */
  _nightCount() { return this.pipeline?.id ? countNightDecisions(this.pipeline.id) : this._night.count; }

  async _nightDecide(q, config) {
    // The user was already away when this question opened: the stretch the spend cap counts starts there.
    this._night.since ??= this._night.openedAt;
    // Guardrails: pause with a flagged reason.
    const guard = this._nightGuardrail(config);
    if (guard) {
      // Night mode is done for this run: a resumed run must wait for the user rather than
      // re-pause on its next question (the counters are read from the DB and still exceed
      // the limit). The run-view switch turns it back on. Set BEFORE the pause so the
      // resume point carries it.
      this._night.override = 'off';
      this.state.night = this._nightSnapshot();
      // pause() acts only on a RUNNING run; otherwise (already pausing, stopped, not started)
      // the question simply stays open. _pauseFor would record the reason even when pause()
      // then refuses, so only a running run is asked to pause.
      const paused = this.state.status === 'running' && this._pauseFor(REASON.NIGHT_GUARDRAIL, null, { label: 'night', detail: guard.detail });
      const rec = this._nightRecord(q, { choice: null, strategy: 'guardrail', flagged: true, guardrail: guard.code, rationale: guard.detail });
      this._emit('night-decision', { id: q.id, kind: q.kind, record: rec });
      if (!paused) {
        // A --yes run has nobody to wait for: give today's auto answer instead of hanging.
        if (this.auto) return this._nightAutoFallback(q, `guardrail ${guard.code} and the run could not pause`);
        this._log('night', 'warn', `Away mode limit ${guard.code}: the run could not pause; ${q.id} waits for the user`);
      }
      return;
    }
    const analysis = {};                        // the review's peak context, when one ran for this ask
    const result = await decideAsk(q, {
      config,
      analyze: (qs) => this._nightAnalyze(qs, q, analysis),
      gateCyclesUsed: (wireId) => (this.pipeline?.id ? nightGateCycles(this.pipeline.id, wireId) : 0),
      budget: config.spendCapUsd != null ? { spent: this._nightSpentUsd(config), cap: config.spendCapUsd } : null,
      // sleepAbortable RESOLVES early on a pause; pause() has then nulled pendingQuestion, so
      // the check below drops the decision.
      sleep: (ms) => sleepAbortable(ms, this._nightSignal()),
    });
    if (!result || this.pendingQuestion?.id !== q.id) return;   // neverDecide, or the user answered while we thought
    // The user may have switched night mode off while we thought (a slow analysis, a backoff):
    // re-resolve the switches and drop the decision unless night mode may still decide.
    const { config: nowConfig } = effectiveNightConfig(this.projectDir);
    if (nightNeverDecides(nowConfig, q) || !this._nightDue(nowConfig)) {
      this._log('night', 'info', `Away mode was switched off while answering ${q.kind} ${q.id}; it waits for the user`);
      return 'rearm';
    }
    let record = result.record;
    if (Number.isFinite(analysis.peakContextTokens)) record = { ...record, meta: { ...(record.meta || {}), reviewPeakContextTokens: analysis.peakContextTokens } };
    // The review ran for this ask: the record names its model (null = the CLI default) and effort.
    if (analysis.model !== undefined) record = { ...record, model: analysis.model, effort: analysis.effort };
    // The review's identity and spend, per ASK (one review answers every question of it). A review
    // stopped before its result has no cost (null) — only its list-price LOWER BOUND (I4).
    if (analysis.reviewId) {
      record = { ...record, reviewId: analysis.reviewId, reviewStatus: analysis.reviewStatus, costUsd: analysis.costUsd ?? null,
        tokens: analysis.tokens ?? null, ...(analysis.reviewStatus === 'stopped' ? { floorUsd: analysis.floorUsd ?? null } : {}) };
    }
    const askExec = this._nightAskExecution(q);
    if (askExec) record = { ...record, executionId: askExec };
    // The record must be readable by nightDecision(id) BEFORE answer() resolves the ask (the
    // answer writers run right after), so stage it first; it is written/emitted only once an
    // answer landed.
    this._night.decisions.set(q.id, { ...record, kind: q.kind, questionId: q.id });
    let ok;
    try {
      ok = this.answer(q.id, result.payload, NIGHT_ACTOR);
    } catch (err) {
      if (err?.code !== 'INVALID_ANSWER' || q.kind !== 'form') { this._night.decisions.delete(q.id); throw err; }
      // A decided form value failed gate 3: fall back to the proven auto answer, flagged.
      record = { ...record, flagged: true, rationale: `${record.rationale}\nthe answer did not fit the form, so its default values were used` };
      this._night.decisions.set(q.id, { ...record, kind: q.kind, questionId: q.id });
      try { ok = this.answer(q.id, { form: q.form, version: q.version, values: q.autoValues || {} }, NIGHT_ACTOR); } catch { ok = false; }
    }
    if (!ok) {
      // Stale id (the user won the race) or a validator that refused the payload: nothing was answered.
      this._night.decisions.delete(q.id);
      if (this.auto && this.pendingQuestion?.id === q.id) return this._nightAutoFallback(q, 'the answer was refused');
      this._log('night', 'warn', `Away mode could not answer ${q.kind} ${q.id}; it waits for the user`);
      return;
    }
    const rec = this._nightRecord(q, record);
    this._emit('night-decision', { id: q.id, kind: q.kind, record: rec });
  }

  /** Night-owned --yes run only: answer with what --yes would have answered, flagged. If even
   *  that is refused, reject the ask so the run fails loudly instead of hanging unattended. */
  _nightAutoFallback(q, why) {
    if (this.pendingQuestion?.id !== q.id) return;
    const payload = autoAnswerPayload(q);
    const record = { choice: JSON.stringify(payload).slice(0, 500), strategy: 'auto', confidence: null, flagged: true, rationale: `gave the --yes answer instead: ${why}`, reversible: null };
    this._night.decisions.set(q.id, { ...record, kind: q.kind, questionId: q.id });
    let ok = false;
    try { ok = this.answer(q.id, payload, NIGHT_ACTOR); } catch { ok = false; }
    if (!ok) {
      this._night.decisions.delete(q.id);
      const pq = this.pendingQuestion;
      if (pq?.id === q.id) { this.pendingQuestion = null; pq.reject(new Error(`Away mode could not answer ${q.kind} ${q.id} in an unattended run`)); }
      return;
    }
    const rec = this._nightRecord(q, record);
    this._emit('night-decision', { id: q.id, kind: q.kind, record: rec });
  }

  /** Spend across all runs since the night anchor (the window start and/or this run's unattended stretch). */
  _nightSpentUsd(config) {
    return nightSpendSinceUsd(nightAnchorMs(config, this._nightClock.now(), this._night.since));
  }

  /** @returns {{code:'maxDecisions'|'spendCap', detail:string}|null} */
  _nightGuardrail(config) {
    const n = this._nightCount();
    if (n >= config.maxDecisions) return { code: 'maxDecisions', detail: `Paused: worca answered ${n} times on this run, the limit you set. Resume to continue, or raise the limit in Settings › Away mode › Limits.` };
    if (config.spendCapUsd != null) {
      const spent = this._nightSpentUsd(config);
      if (spent >= config.spendCapUsd) return { code: 'spendCap', detail: `Paused: spending while away reached $${config.spendCapUsd.toFixed(2)}. Resume to continue, or raise the cap.` };
    }
    return null;
  }

  /** Persist a decision that HAPPENED (table row, counters, log, state, policy run state).
   *  The caller emits `night-decision` — only once the answer landed (or the guardrail paused).
   *  @returns {object} the stored record */
  _nightRecord(q, record) {
    const rec = { ...record, kind: q.kind, questionId: q.id, at: new Date(this._nightClock.now()).toISOString() };
    // Guardrail rows and cost-cap overrides are not "decisions" for the maxDecisions budget.
    if (record.guardrail == null) this._night.decisions.set(q.id, rec);
    try { writeNightDecision(this.pipeline?.id, { questionId: q.id, kind: q.kind, ...record }); }
    catch (err) { this._log('night', 'warn', `could not record the Away mode answer: ${err?.message || err}`); }
    if (this.pipeline?.id) this._nightSyncCounts();
    else {
      if (record.guardrail == null && q.kind !== 'cost-cap') this._night.count += 1;
      if (rec.flagged) this._night.flagged += 1;
      const c = awayAnswerCounts([rec]);
      this._night.answers += c.answers; this._night.checks += c.checks;
    }
    this._log('night', rec.flagged ? 'warn' : 'info', `Away mode ${record.guardrail ? `limit ${record.guardrail}` : `answered ${q.kind} ${q.id} → ${String(record.choice).slice(0, 120)}`}${rec.flagged ? ' (please check)' : ''}`);
    this.state.night = this._nightSnapshot();
    this._emit('state', this.getState());
    if (this.policyRun) this._persistPolicyState({ unattended: true, night: { decisions: this._night.count, flagged: this._night.flagged, answers: this._night.answers, checks: this._night.checks } });
    return rec;
  }

  /** The night decision record for question `id`, or null (read by the answer writers). */
  nightDecision(id) { return this._night.decisions.get(id) ?? null; }

  /** Reload the counters from night_decisions, so a resumed run continues its totals instead
   *  of overwriting the stored ones with numbers restarted at 0. Never throws. */
  _nightSyncCounts() {
    if (!this.pipeline?.id) return;
    try {
      const c = nightCounts(this.pipeline.id);
      this._night.count = c.decisions; this._night.flagged = c.flagged;
      this._night.answers = c.answers; this._night.checks = c.checks;
      this.state.night = this._nightSnapshot();
    } catch (err) { this._log('night', 'warn', `could not read the Away mode answers: ${err?.message || err}`); }
  }

  _nightSnapshot() {
    const n = this._night;
    const open = n.q && this.pendingQuestion?.id === n.q.id && n.decidable !== false && n.openedAt != null;
    const snap = { optIn: n.optIn, override: n.override, decisions: n.count, flagged: n.flagged, answers: n.answers, checks: n.checks, openedAt: open ? new Date(n.openedAt).toISOString() : null };
    // B4: whose "I'm here / I'm away" this run follows, and that person's switch (read-only for others).
    if (awayPerPerson()) {
      const owner = this.awayOwner();
      const own = personAwayStatus(owner);
      snap.owner = awayPersonKey(owner);
      snap.ownerToggle = own ? own.toggle : null;   // null = the owner follows the instance default
      snap.ownerHereSince = own?.hereSince ?? null;
    }
    return snap;
  }

  /** B4: the person whose Away mode this run follows: who last resumed it, else who started it
   *  (a scheduled run's starter is the schedule's creator). Null = nobody in particular. */
  awayOwner() {
    return this._night?.owner || this.resumeOpts?.row?.started_by || this.opts.startedBy || null;
  }

  /** Run-view switch. @param {'auto'|'on'|'off'} mode */
  setNightOverride(mode, by = 'local') {
    if (!NIGHT_TOGGLES.includes(mode)) throw Object.assign(new Error('mode must be auto | on | off'), { code: 'BAD_NIGHT_MODE' });
    const status = this.state.status;
    if (status === 'done' || status === 'stopped' || status === 'error') {
      throw Object.assign(new Error(`the run is ${status}: its Away mode switch can no longer change`), { code: 'NIGHT_NOT_LIVE' });
    }
    this._night.override = mode;
    // A paused run resumes from its saved point, which captured the switch at pause time.
    if (status === 'paused' && this.state.resumePoint?.night) {
      this.state.resumePoint.night.override = mode;
      this._persist().catch(() => {});
    }
    // No _recordAction: lastAction is "who stopped / paused / resumed" (the Paused-by banner and
    // _auditAction read it). The audit line below names who flipped the switch.
    const label = RUN_SWITCH_OPTIONS.find((o) => o.value === mode)?.label ?? mode;
    if (this.pipeline?.dir) appendAudit(this.pipeline.dir, `- Away mode on this run set to **${label}**${byActor(by)}.`, { actor: by }).catch(() => {});
    this.state.night = this._nightSnapshot();
    this._emit('state', this.getState());
    this._nightArm();
    return true;
  }

  /** Settings / project prefs changed: re-evaluate the open question. */
  nightConfigChanged() {
    // B4: an owner's switch changed: republish it for the run page's read-only line.
    if (this._night && awayPerPerson()) { try { this.state.night = this._nightSnapshot(); } catch { /* never break re-arming */ } }
    this._nightArm();
  }

  /** Plan/task artifacts of this run for the nightDecider to read. Never throws. */
  /** What the Away mode review reads: the run's task.md and its NEWEST plan. Plans live in the
   *  store's plans/ folder (indexed as kind 'plan', store-root-relative), not the run folder, and
   *  superseded versions would only contradict the current one. Never throws. */
  async _nightPlanPaths() {
    if (!this.pipeline?.dir) return [];
    const isFile = async (f) => { try { return (await stat(f)).isFile(); } catch { return false; } };
    const out = [];
    const task = join(this.pipeline.dir, 'task.md');
    if (await isFile(task)) out.push(task);
    try {
      const root = this.isWorkspace ? workspaceStorePath(this.workspaceKey) : projectStorePath(this.workMode !== 'git' ? this.members[0].projectKey : projectKey(this.projectDir));
      // Newest first: by time, then by the -vN suffix (two writes in one millisecond share a time,
      // and the index's tie-break, the file name, sorts "x-v2.md" before "x.md").
      const ver = (rel) => Number(/-v(\d+)\.md$/.exec(rel)?.[1] || 1);
      const plans = (await listRunArtifacts(this.pipeline.id, { kind: 'plan' }))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || ver(b.relPath) - ver(a.relPath));
      for (const a of plans) {
        const f = join(root, a.relPath);
        if (await isFile(f)) { out.push(f); break; }
      }
    } catch { /* no index yet: the task alone */ }
    return out;
  }

  /** One nightDecider call for an ask; books cost like the Auto classifier (_recordAutoCost).
   *  Deliberately no _checkCostLimits(): a cap pause raised from a timer callback would not
   *  unwind the pending _ask; the next step's cap check catches it. */
  async _nightAnalyze(questions, q, into = {}) {
    const startedAt = new Date().toISOString();
    // Pin the asker while its row is still open: the user's answer ends the ask at once, so a clarifier
    // can finish (and the next node start) before the cut review settles and books.
    const asker = this._nightAskExecution(q);
    if (asker && !q.executionId) q = { ...q, executionId: asker };
    // Random, not a per-instance counter: a resumed run is a NEW harness whose counter restarted at 1,
    // so `night-decider-1` was upserted over the first review's row (sub_agents ON CONFLICT, artifacts.mjs).
    const id = `night-decider-${randomUUID().slice(0, 8)}`;
    const { config } = effectiveNightConfig(this.projectDir);
    const pair = await this._nightDeciderPair(config);
    // The decision record names the pair the review ran with, even when the call then fails.
    into.model = pair.model; into.effort = pair.effort;
    const tokensOf = (u) => (Number(u?.input_tokens) || 0) + (Number(u?.output_tokens) || 0);
    let res;
    try {
      res = await runNightAnalysis({
        questions, cwd: this.runCwd || this.workDir || this.projectDir,
        task: this.pipeline?.promptText ?? this.opts.prompt ?? '', planPaths: await this._nightPlanPaths(),
        memory: await readMemoryText(projectKey(this.projectDir)), criteria: config.criteria,
        context: q.kind === 'questions' ? `Asked by ${q.agent || 'an agent'} mid-step.` : '', model: pair.model, effort: pair.effort,
        ...this._helperSpawn(), mock: !!this.claude.mock, envScrub: this.guardrails?.envScrub, signal: this._nightSignal(),
        run: this.opts.nightRunClaude,          // test seam; undefined → runClaude
        bridgeTag: id,                          // a bridged decider model: its upstream cost comes back under this tag
      });
    } catch (err) {
      if (Number.isFinite(err?.peakContextTokens)) into.peakContextTokens = err.peakContextTokens;
      if (err?.notStarted) throw err;                       // aborted before the spawn: nothing ran, nothing to book
      into.reviewId = id;
      if (err?.priced) {
        // A failed call that still reported its cost: book it, then let the strategy fall back (flagged).
        this._nightBookAnalysis(id, q, startedAt, { costUsd: err.costUsd, usage: err.usage || {} }, 'error', pair);
        Object.assign(into, { reviewStatus: 'error', costUsd: err.costUsd, tokens: tokensOf(err.usage) });
      } else {
        const floorUsd = this._nightBookStopped(id, q, startedAt, err?.turnUsage || {}, pair, err?.turnModel);
        Object.assign(into, { reviewStatus: 'stopped', costUsd: null, tokens: tokensOf(err?.turnUsage), floorUsd });
      }
      throw err;
    }
    if (Number.isFinite(res.peakContextTokens)) into.peakContextTokens = res.peakContextTokens;
    into.reviewId = id;
    if (res.priced) {
      this._nightBookAnalysis(id, q, startedAt, res, 'finished', pair);
      Object.assign(into, { reviewStatus: 'finished', costUsd: res.costUsd, tokens: tokensOf(res.usage) });
    } else {
      // A reply with no priced `result` frame: its cost is unknown, never a silent $0.
      const floorUsd = this._nightBookStopped(id, q, startedAt, res.turnUsage || {}, pair, res.turnModel);
      Object.assign(into, { reviewStatus: 'stopped', costUsd: null, tokens: tokensOf(res.turnUsage), floorUsd });
    }
    return res.byId;
  }

  /** The nightDecider's model + effort for this call (night/decider-model.mjs). A configured model
   *  that cannot run here never fails or pauses the run: the review falls back to the run's model,
   *  and the run log says so ONCE per run (per distinct line). Never throws. */
  async _nightDeciderPair(config) {
    let models = [];
    try { models = await listModels(''); } catch { /* unreadable catalog: a configured id reads as not in it */ }
    // The decider runs on the helper engine (helperEngineFor: the run's engine, or Claude on a Cursor run), like every
    // other run-scoped helper job: only that engine's catalog rows can be picked, the run's model counts only when the
    // decider runs on the run's engine and that engine owns it (a Cursor model means nothing to Claude), and on Codex
    // an unnamed model is codex's own default, named so the decision record and the cost say which model weighed the options.
    const runEngine = this.claude.engine || 'claude';
    const engine = this._helperEngine();
    const runModel = engine !== runEngine ? null
      : (engine === 'copilot' ? this._engineModel(this.claude.model || undefined)
        : modelForEngine(this.claude.model || null, engine, { projectDir: this.projectDir })) || null;
    // Named before the effort is checked, so an effort codex's default model does not offer (max, xhigh) drops to medium.
    const fallback = !runModel && engine === 'codex' ? CODEX_DEFAULT_MODEL : null;
    // Model roles (D3): an unset decider takes the deep role.
    const role = config.deciderModel ? null : roleModelFor(engine, 'nightMode.deciderModel');
    const pair = resolveDeciderPair({
      deciderModel: config.deciderModel || role?.model,
      deciderEffort: config.deciderModel ? config.deciderEffort : (role?.effort ?? config.deciderEffort),
      runModel: runModel || fallback,
    }, { models: models.filter((m) => m && runsOn(m, engine)) });
    if (fallback && pair.model === fallback && pair.source === 'run') pair.source = 'default';
    const warn = (text) => {
      if ((this._nightWarned ||= new Set()).has(text)) return;
      this._nightWarned.add(text);
      this._log('night', 'warn', text);
    };
    const used = pair.model ? JSON.stringify(pair.model) : 'the default model';
    if (pair.stale) warn(`Away mode: the model set to weigh the options, ${JSON.stringify(pair.stale)}, ${pair.staleWhy === 'sign-in' ? 'needs its provider set up' : 'is not in the model catalog'} — the review uses ${used} instead`);
    if (pair.effortDropped) warn(`Away mode: ${used} does not offer effort "${pair.effortDropped}" — the review runs at ${pair.effort} effort`);
    return pair;
  }

  /** One nightDecider call as a sub-agent row plus its cost on the run (like _recordAutoCost).
   *  `runModel` is what the row's model pill and sub_agents.run_model show: the model the review
   *  ACTUALLY ran on (the decider's), not the run's. */
  _nightBookAnalysis(id, q, startedAt, res, status, pair) {
    const stepKey = this._nightStepKey(q);
    const rec = { id, label: `Away mode review (${q.kind})`, status, startedAt, finishedAt: new Date().toISOString(),
      costUsd: res.costUsd, tokens: (res.usage.input_tokens || 0) + (res.usage.output_tokens || 0), subagentType: 'night-decider',
      nodeId: q.nodeId || null, stepKey, runModel: pair.model || null, effort: pair.effort || null };
    // A review settling after a resumed run took the row over: its sub_agents row (a random id) and its
    // ledger line (_recordCost) are kept, but this harness no longer speaks for the run (no state, no frames).
    const handedOff = this._rowHandedOff();
    if (!handedOff && !this.state.subAgents.some((s) => s.id === rec.id)) this.state.subAgents.push(rec);
    this._upsertSubAgent(rec);
    if (!handedOff) {
      this._subAgentTransition('spawn', rec);
      this._subAgentTransition('finish', rec);
    }
    this._bookUsage({ source: 'engine', costUsd: res.costUsd, aux: 'away' }, { stepKey });
  }

  /** The step an Away mode review books on: the asking execution, else a running step, else the last row. */
  _nightStepKey(q) {
    return this._nightAskExecution(q) || this._runningStepKeys()[0] || this.state.steps.at(-1)?.key || 'x:preflight:1';
  }

  /** The execution an ask came from: the one it names, else its node's open row. A clarifier's asks name
   *  only their node (graph/executor.mjs), and _ask froze every running clock before the decision, so
   *  neither `_runningStepKeys()` nor the last row is the asker in a parallel graph. Null when unknown. */
  _nightAskExecution(q) {
    return q.executionId || (q.nodeId && this.state.steps.findLast((s) => s.nodeId === q.nodeId && s.status === 'start')?.key) || null;
  }

  /** A review that ended with no priced `result` (the user answered, a pause or stop, the 5-min
   *  timeout, a reply with no cost): a `stopped` row with its tokens and NO cost, and its list-price
   *  LOWER BOUND kept apart (I4: input/cache tokens are exact at message start, output is a placeholder
   *  ≤ the final count). The floor is priced at the decider pair's model; with none configured (the
   *  CLI's default model) at `turnModel`, the model the review's own messages named. Returns the floor:
   *  a number (0 for a {free} model or nothing streamed), or null when no model is known or it has no
   *  list price. */
  _nightBookStopped(id, q, startedAt, turnUsage, pair, turnModel = null) {
    const stepKey = this._nightStepKey(q);
    const tokens = (Number(turnUsage.input_tokens) || 0) + (Number(turnUsage.output_tokens) || 0);
    const rec = { id, label: `Away mode review (${q.kind})`, status: 'stopped', startedAt, finishedAt: new Date().toISOString(),
      costUsd: null, tokens, subagentType: 'night-decider', nodeId: q.nodeId || null, stepKey, runModel: pair.model || null, effort: pair.effort || null };
    // As _nightBookAnalysis: a harness a resumed run replaced keeps the row, never the state or a frame.
    const handedOff = this._rowHandedOff();
    if (!handedOff && !this.state.subAgents.some((s) => s.id === rec.id)) this.state.subAgents.push(rec);
    this._upsertSubAgent(rec);
    if (!handedOff) {
      this._subAgentTransition('spawn', rec);
      this._subAgentTransition('finish', rec);
    }
    let floorUsd = null;
    try { const rates = liveCostRates(pair.model || turnModel); floorUsd = rates ? estimateCost(turnUsage, rates) : null; } catch { floorUsd = null; }
    if (!Number.isFinite(floorUsd)) floorUsd = null;
    this._recordAuxStopped(stepKey, 'away', floorUsd);
    return floorUsd;
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
    // C2 / #693: `--is-inside-work-tree` is true even when dir merely sits *inside* an enclosing repo (no .git of its
    // own). Acting on that parent repo would create worca-cc/* branches + checkpoint commits in the developer's real
    // repo, and `git init` here (what ≤ 1.10.0 did) made an inner repo that lacks every branch of the real one, so the
    // worktree failed with "sourceBranch is not a valid ref". Require dir to BE the repo toplevel; a dir inside a repo
    // is refused (terminal: a resume would replay into the same refusal); only a dir in NO repo is `git init`ed.
    const projReal = await realpath(dir).catch(() => resolve(dir));
    const top = await this._git(['rev-parse', '--show-toplevel'], { cwd: dir });
    let topReal = null;
    if (top.ok && top.stdout.trim()) {
      topReal = await realpath(top.stdout.trim()).catch(() => top.stdout.trim());
    }
    const isOwnRepo = topReal === projReal;
    // A read-only Workspace scan (scan D5) never `git init`s or commits a member. Both scan routes
    // refuse such a member up front (workspaces.mjs scanMemberProblems); this refuses one that
    // changed since, on the first run and on the setup replay alike.
    if (this._isWorkspaceScan()) {
      const why = !isOwnRepo ? 'is not its own git repository'
        : (await this._git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: dir })).ok ? null : 'has no commit';
      if (why) throw new Error(`read-only workspace scan: ${dir} ${why}`);
    }
    if (!isOwnRepo) {
      // git could not answer (e.g. a "dubious ownership" parent): the stat-only walk still finds an enclosing .git.
      const enc = topReal ? { repoRoot: topReal, partOf: getProjectByPath(topReal)?.name ?? null }
        : enclosingRepoOf(dir, { gitOn: false });
      if (enc) {
        const err = markTerminal(new Error(nestedInRepoMessage(dir, enc)));
        err.code = 'NESTED_IN_REPO';
        throw err;
      }
      await this._git(['init'], { cwd: dir });
      // Ensure an identity exists for the commit (local, non-destructive).
      await this._git(['config', 'user.email', 'orchestrator@local'], { cwd: dir });
      await this._git(['config', 'user.name', 'orchestrator'], { cwd: dir });
    } else {
      // #693: a repo an older worca git-inited inside the user's repo. Warn with the fix; change nothing on disk.
      const made = worcaNestedRepoOf(dir);
      if (made) {
        const hint = worcaNestedRepoHint(dir, made);
        this._log('git', 'warn', hint);
        if (this.pipeline) await appendAudit(this.pipeline.dir, `Warning: ${hint}`).catch(() => {});
      }
    }
    // Is there any commit yet?
    const head = await this._git(['rev-parse', 'HEAD'], { cwd: dir });
    if (!head.ok) {
      await this._gitIndexWrite(['add', '-A'], { cwd: dir });
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
   * The diff of a run IN FLIGHT: every member worktree against its checkpoint, plus the
   * files an agent created that nothing has staged yet. Read-only (no `add -N`, so it can
   * never race an agent's own git use), persists nothing, and uses the same exclusion set
   * as _buildResults. Resolves null before setup has created a worktree.
   * Shape: { results, patch, untrackedCapped } — `results` is the results.json shape
   * (per-project under `perProject` for a workspace run), `patch` a unified diff.
   * @param {{maxUntracked?:number}} [opts]
   */
  async liveDiff({ maxUntracked = 50 } = {}) {
    const members = [];
    const patches = [];
    let untrackedCapped = false;
    for (const [key, dir] of this.workDirs.entries()) {
      const base = this.checkpointRefs[key];
      if (!base) continue;
      const ex = this._excludePathspecs(key);
      const [ns, num, patch, untracked] = await Promise.all([
        diffNameStatus(dir, base, undefined, ex),
        diffNumstat(dir, base, undefined, ex),
        diffPatch(dir, base, undefined, ex),
        untrackedFiles(dir, ex),
      ]);
      const listed = new Set(ns.map((r) => r.path));
      // An agent's own engine config file that only worca's info/exclude line hides is listed; worca's own never is.
      const ec = await this._engineConfigState(dir);
      const fresh = [...new Set([...untracked, ...ec.forced])].filter((p) => !listed.has(p) && !ec.owned.includes(p));
      if (fresh.length > maxUntracked) untrackedCapped = true;
      const extra = [];
      for (const p of fresh.slice(0, maxUntracked)) {
        const u = await untrackedPatch(dir, p);
        ns.push({ status: 'A', path: p });
        num.set(p, { added: u.added, removed: 0, binary: u.binary });
        if (u.patch) extra.push(u.patch);
      }
      members.push({ projectKey: key, results: assembleResults({ nameStatus: ns, numstat: num, reviews: [] }) });
      patches.push({ key, patch: [patch, ...extra].filter(Boolean).join('') });
    }
    if (!members.length) return null;
    if (members.length === 1 && !this.isWorkspace) {
      return { results: members[0].results, patch: patches[0].patch, untrackedCapped };
    }
    const perProject = buildPerProject(members);
    return {
      results: { summary: rollupSummary(perProject), perProject },
      patch: patches.filter((p) => p.patch).map((p) => `# ${p.key}\n${p.patch}`).join('\n\n'),
      untrackedCapped,
    };
  }

  /**
   * Layer 1: build + persist the deterministic results view while the worktree(s)
   * and checkpoint refs are still live. Best-effort: never throws into run().
   */
  async _buildResults({ stage = false } = {}) {
    if (!this.pipeline) return;
    // remote: the final sync, so the diff, results.json and the memory sync see the last changes (every finished
    // spawn already synced; this catches a spawn the stop interrupted mid-sync).
    if (this.execEnv && !this.execEnv.fatalError()) {
      await this.execEnv.syncBack().catch((err) => this._execLog('error', `final sync failed: ${err?.message || err}`));
    }
    try {
      // stage: the non-done terminal paths never reached the review loop's staging
      // (:2204, :2311), so `git add -A -N` has not run and the `git diff <checkpoint>`
      // below cannot see a file the agent CREATED — the kept branch would carry it
      // while the persisted patch showed nothing. ignoreAbort for the same reason
      // _commitWork pins it (:1804): stop() has already tripped this.abort, and a
      // bound signal kills the staging before git can touch the index.
      // INSIDE the try: the stopped path calls _buildResults from run()'s catch, so
      // anything that escaped here would reject run() itself.
      // The final sync runs BEFORE the two early returns below (`!members.length`,
      // `noPatch && stage && !listed`), so results.json.memory is absent on those paths;
      // the ledger (memory.json) is the durable carrier and History reads it.
      if (this.memory) await this._syncMemory(null, { nodeId: 'final', executionId: null, label: 'the run end' }).catch(() => {});
      if (this.workMode === 'folder') return await this._buildFolderResults({ stage });
      if (this.workMode === 'none') return;   // P3: no results.json — the files are the result
      if (stage) await this._stageWorkingTree({ ignoreAbort: true });
      const reviews = readPipelineExtras(this.pipeline.id).reviews || [];
      // Unified iteration over workDirs + checkpointRefs — the ref map is filled in
      // BOTH modes (the _ensureGitCheckpoint mirror), so a single-project run reads
      // the same shape. The single-project OUTPUT shape stays byte-identical (one
      // results.json, one un-prefixed patch) via the members.length === 1 special case.
      const members = [];
      const patches = [];
      // P5: a mixed workspace's Folder members — their own changes (members/<key>/changes.patch), no diff patch entry.
      const folderMembers = this.isWorkspace ? await this._folderMemberResults({ stage, reviews }) : [];
      for (const x of folderMembers) members.push({ projectKey: x.projectKey, results: x.results });
      for (const [key, dir] of this.workDirs.entries()) {
        if (this._memberWorkMode(key) !== 'git') continue;
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
      const listed = patches.some((p) => p.listed) || folderMembers.some((x) => x.listed);
      if (noPatch && patches.some((p) => p.listed)) this._log('results', 'warn', 'diff patch is empty although name-status lists changes — git diff failed; results.json is persisted without a patch');
      // Stopped/error paths (`stage`) with nothing changed write nothing — absent IS
      // the truth (above). The DONE path always persists results.json: it carries
      // the review-derived keyThingsToCheck/blockingIssues that the task-source
      // write-back (sources.mjs) and History read, so a review-only / plan-only /
      // no-op run must not lose them (review of PR #376). The 0-byte
      // diff-patch.patch is still never written on any path.
      if (noPatch && stage && !listed) return;
      const memory = this.memorySummary();
      let summary;
      if (members.length === 1 && !this.isWorkspace) {
        if (memory) members[0].results.memory = memory;
        await persistResults(this.pipeline.dir, members[0].results);
        if (!noPatch) await persistDiffPatch(this.pipeline.dir, patches[0].patch);
        summary = members[0].results.summary;
      } else {
        const perProject = buildPerProject(members);
        const results = { summary: rollupSummary(perProject), perProject, ...(memory ? { memory } : {}) };
        await persistResults(this.pipeline.dir, results);
        if (!noPatch) await persistDiffPatch(this.pipeline.dir, patches.map((p) => `# ${p.key}\n${p.patch}`).join('\n\n'));
        summary = results.summary;
      }
      // D28: the run's size for Statistics; _buildResults runs after the terminal persist, so write it again
      this.state.runSize = sizeOfChange(summary);
      await this._persist();
    } catch (err) {
      this._log('results', 'warn', `results build failed: ${err.message}`);
    }
  }

  /**
   * Task-source write-back (spec §7.5): report the finished run to the plugin
   * source that produced it. Runs on EVERY terminal path and ALWAYS after
   * _buildResults() — done (statusToResult -> 'completed'), stopped/launch-error
   * (-> 'failed'; chat-connectivity design PR12 closed the old success-only gap),
   * and error-pauses (-> 'needs-human', from _completePaused).
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

  /**
   * The stopped terminal path — ONE body for run(), resume() and stopPaused(): the row
   * reads stopped with no resume point, the audit says who, the work so far becomes the
   * diff artifact (the caller's finally then commits it onto the kept branch and removes
   * the checkout), the task source and team metrics hear about it, then `done`.
   * @returns {Promise<{status:'stopped', pipelineDir:string|null}>}
   */
  async _settleStopped() {
    this._setStatus('stopped');
    await this._finalizeDirections();   // report an unread inbox on every terminal outcome
    // Stopped runs are not resumable: never persist a resume point (e.g. one _dispatch
    // assigned before stop won the race) alongside a torn-down worktree.
    this.state.resumePoint = null;
    if (this.pipeline) {
      await this._persist().catch(() => {});
      await this._auditAction('stop', 'Pipeline **stopped**').catch(() => {});
      // The diff artifact must survive a non-done terminal path too: the work done
      // up to this point IS committed onto the kept feature branch by the teardown
      // in the caller's finally, so History has to be able to show it. Safe HERE and
      // only here — the checkpoint refs and the worktree are still live until that
      // teardown runs. Best-effort by construction (its own try/catch logs a warn
      // and never rethrows), and a no-op when the run stopped before any checkpoint
      // existed. The terminal `done` event is emitted AFTER it so the History row never
      // paints as "no diff captured" for the tick before the artifact lands.
      await this._buildResults({ stage: true });
      await this._reportToSource(); // statusToResult('stopped') -> 'failed' (design PR12: no longer success-only)
    }
    await this._recordRunMetrics('stopped');
    this._emit('done', { status: 'stopped', pipelineDir: this.pipeline?.dir || null });
    return { status: 'stopped', pipelineDir: this.pipeline?.dir || null };
  }

  /** Team metrics (team-metrics-design.md §4.5): one record per terminal run. Idempotent per
   *  instance and fail-soft — a metrics failure is a log line, never a run failure. */
  async _recordRunMetrics(status, error = null) {
    if (this._metricsRecorded) return null;
    this._metricsRecorded = true;
    try {
      return await recordRunMetrics(this, { status, error });
    } catch (err) {
      try { this._log('metrics', 'warn', `team metrics: ${err?.message || err}`); } catch { /* never */ }
      return null;
    }
  }

  /** Single-project checkpoint: own repo + commit, record the scalar ref + state. */
  async _ensureGitCheckpoint() {
    if (this.workMode !== 'git') return;
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
      if (this._memberWorkMode(m.projectKey) !== 'git') continue;
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
  async _stageWorkingTree({ ignoreAbort = false, refreshFolders = true } = {}) {
    // Stage EVERY member worktree (keyed — the pathspec lookup needs the projectKey)
    // so each per-project reviewer's `git diff` sees that project's agent edits.
    // Single-project runs have exactly one entry (populated in both modes). The
    // isWorkspace branch is gone: workDirs is the single shape. An empty map means
    // setup never ran, in which case staging must be a NO-OP — the old single arm
    // fell back to this.workDir, which pre-setup is the user's LIVE checkout.
    for (const [key, dir] of this.workDirs.entries()) {
      const mode = this._memberWorkMode(key);
      if (mode === 'folder') { if (refreshFolders) await this._refreshFolderChanges(key, this._folderFilesFor(key)); continue; }
      if (mode !== 'git') continue;                       // P3 'none': nothing to stage
      // §8.8: the exclusion set is the memory mount in both modes (and the skill mount under
      // detached); an empty set (a refused mount) reproduces the bare argv.
      const ex = this._excludePathspecs(key);
      const args = ex.length ? ['add', '-A', '-N', '--', '.', ...ex] : ['add', '-A', '-N'];
      const res = await this._gitIndexWrite(args, { cwd: dir, ignoreAbort });
      if (!res.ok && res.stderr && res.stderr.trim()) {
        // warn, not debug: a failed staging hides the agent's new files from the reviewer's diff.
        this._log('git', 'warn', `git add -A -N (${dir}): ${res.stderr.trim()}`, ERR_STREAM);
      }
      // Engine config files (.cursor, .gemini): an agent's own file only worca's exclude line hides joins the diff; worca's stay out.
      const ec = await this._engineConfigState(dir, { ignoreAbort });
      if (ec.forced.length) await this._gitIndexWrite(['add', '-N', '-f', '--', ...ec.forced], { cwd: dir, ignoreAbort });
      if (ec.owned.length) await this._gitIndexWrite(['rm', '--cached', '-q', '--ignore-unmatch', '--', ...ec.owned], { cwd: dir, ignoreAbort });
    }
  }

  /**
   * §8.8: the ONE pathspec set that keeps worca-cc's injected paths out of the
   * commit, the reviewer's intent-to-add staging, and all three result diffs.
   * `kind:'claudeMdSection'` entries are deliberately EXCLUDED from the set — their
   * file is the user's tracked CLAUDE.md, and a blanket `:(exclude)CLAUDE.md` would
   * silently strip the agent's legitimate edits (teardown strips the fence instead).
   * Under legacy the set holds exactly the memory mount (`_registerMemoryMount`), so
   * `git add -A -- . :(exclude).claude/rules/worca` is the legacy argv since the
   * native-rules revision.
   * `kind:'engineConfig'` entries (Cursor's `.cursor/*.json`, Gemini CLI's `.gemini/settings.json`) are excluded too: git exits 1 on an exclude pathspec
   * that names a path an ignore rule already matches ("paths are ignored … use -f"), which would fail every commit.
   * worca's own info/exclude line keeps them out (engines/project-files.mjs writes one for every file it writes inside a
   * work tree), and the callers take them back out of the index (_engineConfigState `owned`).
   * @param {string} projectKey
   * @returns {string[]}
   */
  _excludePathspecs(projectKey) {
    const entries = this.injectedPaths?.[projectKey] ?? [];
    if (!Array.isArray(entries) || !entries.length) return [];
    return entries
      .filter((e) => e && e.path && e.kind !== 'claudeMdSection' && e.kind !== 'engineConfig')
      .map((e) => `:(exclude)${e.path}`);
  }

  /**
   * `_git` for a command that writes the index (add / rm --cached / commit). When git refuses
   * because a lock exists (`index.lock`, or `HEAD.lock` / the branch ref lock a commit takes) and
   * the lock is stale — a leftover from a killed git, not a live one — remove every stale lock,
   * record one run warning per lock, and retry once. Without this one leftover lock fails every
   * later staging and then the teardown commit, retaining the whole run.
   */
  async _gitIndexWrite(args, opts) {
    const res = await this._git(args, opts);
    if (res.ok) return res;
    const cleared = await clearStaleGitLocks(opts?.cwd || this.projectDir);
    if (!cleared.length) return res;
    for (const lock of cleared) await this._recordRunWarning(staleGitLockNote(lock));
    return this._git(args, opts);
  }

  /**
   * Run a git command in the project dir. Never throws; returns
   * { ok, code, stdout, stderr }. Honors the abort signal. Bounded by
   * `timeoutMs` (default HARNESS_GIT_TIMEOUT_MS): the commands issued here are
   * local (init/add/status/rev-parse/commit/diff --cached), and a git that does
   * not come back in that time is stuck, not working — it is SIGKILLed and
   * reported as `{ ok: false, stderr: 'git timed out' }`, which every caller
   * already handles as a failed git step. Without this bound a wedged git on
   * the stop/teardown path (which deliberately ignores the abort signal) held
   * the whole process, and under `npm test` the runner, until the CI job's
   * 30-minute limit killed it.
   * Repository-local hooks and config commands never run (git-guard.mjs, security G2), except the
   * project's hooks for `hooks: true` (the end-of-run commit), with every host credential stripped.
   */
  async _git(args, { cwd, ignoreAbort = false, timeoutMs = HARNESS_GIT_TIMEOUT_MS, hooks = false } = {}) {
    if (!gitAvailable()) return gitMissingResult();
    let env;
    try {
      env = await guardedGitEnv(cwd || this.projectDir, hooks ? { hooks, env: stripHostCredentials(process.env) } : {});
    } catch (err) { return { ok: false, code: -1, stdout: '', stderr: err.message }; }
    return new Promise((resolveP) => {
      let child;
      try {
        child = spawn('git', args, {
          cwd: cwd || this.projectDir,
          env,
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
      let settled = false;
      const done = (val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveP(val);
      };
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
          // A grandchild (hook, alias, pager) that inherited the pipes would keep
          // them — and this process's event loop — open after git itself is dead.
          try { child.stdout?.destroy(); child.stderr?.destroy(); } catch { /* best effort */ }
          done({ ok: false, code: -1, stdout, stderr: stderr ? `git timed out: ${stderr}` : 'git timed out' });
        }, timeoutMs)
        : null;
      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err) => done({ ok: false, code: -1, stdout, stderr: stderr || err.message }));
      child.on('close', (code) => done({ ok: code === 0, code: code ?? -1, stdout, stderr }));
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

  /** The most recent answerer (single-prompt flows that do not know the question id). */
  _lastAnsweredBy() {
    const all = [...this._answeredBy.values()];
    return all.length ? all[all.length - 1] : null;
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
    const by = this._lastAnsweredBy();
    await writeClarify(this.pipeline.id, { answers: { answers: enriched, ...(by ? { answeredBy: by } : {}) } });
    return enriched;
  }

  _deriveBaseName(promptText, title) {
    const fromTitle = title && title !== basename(this.pipeline?.dir || '') ? title : '';
    const source = fromTitle || firstLine(promptText) || 'feature';
    const base = slugify(source).slice(0, 40) || 'feature';
    // P3: every run without a project shares one store, so its plan and review names carry its own id
    return this.workMode === 'none' && this.pipeline?.id ? `${base.slice(0, 31)}-${this.pipeline.id}` : base;
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
    // No `phase` event: the v1 event vocabulary died with the v1 engine. The
    // state.phase/state.cycle SCALARS stay — they are harness-local (state
    // initialises phase:'idle', _recordCost falls back to them, and
    // test/run-harness-hooks pins the contract).
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

  /** Keys of every step whose clock is currently running. v1's sequential path has
   *  at most one; a parallel step group and every v2 run have one per in-flight
   *  execution. */
  _runningStepKeys() {
    return this.state.steps.filter((s) => s.runningSince != null).map((s) => s.key);
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

  /** Public, non-blocking: append a user direction to the pipeline dir, index
   *  the inbox, and log `direction:posted`. Never touches pendingQuestion/_askTail —
   *  a question blocks the run and freezes clocks; a direction must not. */
  async direct(text, source = 'ui') {
    if (!this.pipeline?.dir) throw new Error('direct(): the run has no pipeline dir yet');
    // THE SETTLE WINDOW. postDirection gates on the DB row, but a terminal run
    // sets its in-memory status first and only persists after _finalizeDirections
    // has already run: for that whole window the row still reads `running`, the
    // route said 201, and the record landed in directions.ndjson where nothing
    // would ever read it — the done summary was computed before it arrived, so
    // `pending` came back empty and chat, CLI and the audit all reported nothing.
    // A write nobody reads and nobody is told about is worse than a refusal, and
    // the caller already knows how to render this error (RUN_FINISHED).
    if (DIRECTIONS_CLOSED.has(String(this.state?.status || ''))) {
      const e = new Error('run is finished; a direction would never be read');
      e.code = 'RUN_FINISHED';
      throw e;
    }
    const rec = await appendDirection(this.pipeline.dir, { text, source });
    recordArtifact(this.pipeline.id, DIRECTIONS_KIND, DIRECTIONS_FILE);
    this._log('directions', 'info', `direction:posted ${rec.id} (${rec.source}): ${rec.text}`);
    // On a PAUSED run the orchestrator's finally has already closed the log writer,
    // and push() is a documented no-op after close — so that line went nowhere and
    // History showed the direction being APPLIED after the resume with no record of
    // it ever having been posted. The audit is the ledger that still accepts one.
    // (The `_log` above is kept regardless: it also EMITS, which is what a watching
    // UI sees.)
    if (this.logWriter?.isClosed?.()) {
      await appendAudit(this.pipeline.dir, `Direction **${rec.id}** posted (${rec.source}): ${rec.text}`).catch(() => {});
    }
    return rec;
  }

  /** The done-summary numbers, computed from the file (the file is the ledger). */
  /** Summarise the direction inbox at the END of a run, for every terminal
   *  outcome — not just `done`.
   *
   *  A direction is accepted for a PAUSED run because resume replays the inbox;
   *  if that run is then stopped, or errors, or is simply never resumed, nobody
   *  reads it. Computing this only on the done paths meant renderDone (chat),
   *  formatRunSummary (CLI) and the audit line all reported nothing, so the one
   *  user who needs telling — the one who posted the direction — was not told.
   *  Best-effort: a summary must never be what fails a finished run. */
  async _finalizeDirections() {
    try {
      this.state.directions = await this._directionsSummary();
      const pending = this.state.directions?.pending || [];
      if (pending.length) {
        await appendAudit(this.pipeline.dir, `Pipeline finished with **${pending.length}** direction(s) never applied: `
          + pending.map((d) => `${d.id} "${d.text}"`).join('; ') + '.');
      }
    } catch { /* never block a terminal transition on the inbox */ }
  }

  async _directionsSummary() {
    const parsed = await readDirections(this.pipeline.dir);
    const pending = pendingDirections(parsed);
    return { posted: parsed.directions.length, applied: parsed.directions.length - pending.length, pending: pending.map((d) => ({ id: d.id, text: d.text })) };
  }

  _log(source, level, text, attr = null) {
    const evt = { source, level, text, ts: new Date().toISOString() };
    if (attr) {
      if (attr.nodeId != null) evt.nodeId = attr.nodeId;
      if (attr.executionId != null) evt.executionId = attr.executionId;   // v2 (§5.7 / §8 log filter)
      if (attr.stepIndex != null) evt.stepIndex = attr.stepIndex;
      if (attr.cycle != null) evt.cycle = attr.cycle;
      if (attr.sub) evt.sub = true;        // drives sub-agent web styling
      // Origin channel of the text: 'err' when it came from a subprocess's
      // stderr (agent CLI, git, graphify). Provenance, not severity — the level
      // says how bad it is, this says where it came from.
      if (attr.stream) evt.stream = attr.stream;
      // A Bash call's own description (#911 slice 3): the web log's Summaries mode shows it; `text` keeps the command.
      if (typeof attr.desc === 'string' && attr.desc) evt.desc = attr.desc;
    }
    this._emit('log', evt);
    this.logWriter.push(evt); // persist the full stream (buffered; flushed on a timer)
  }

  /**
   * @param {string} kind
   * @param {string} path
   * @param {{nodeId?:string, executionId?:string, port?:string|null, cycle?:number|null}|null} [attr]
   *   v2 attribution (§5.7). Omitted keys are omitted from the event, so every
   *   2-arg v1 call emits the byte-identical `{kind, path}` payload it always did.
   */
  _artifact(kind, path, attr = null) {
    const evt = { kind, path };
    if (attr) {
      if (attr.nodeId != null) evt.nodeId = attr.nodeId;
      if (attr.executionId != null) evt.executionId = attr.executionId;
      if (attr.port != null) evt.port = attr.port;
      if (attr.cycle != null) evt.cycle = attr.cycle;
    }
    this._emit('artifact', evt);
    // PERSIST one log record too, so History — and any live run reloaded in the
    // browser — shows the same clickable artifact links the live view does.
    // Only `_log` pushes to the logWriter, so live-log.ndjson carried no artifact
    // records at all and those panes rebuilt from records with no path/kind.
    //
    // Capped per (kind, execution, node) burst on the SAME threshold the
    // Artifacts tab collapses on: a folder sweep indexes one file per slide, and
    // persisting 43 lines would put back into History exactly the flood the live
    // view suppresses. Kinds nobody can open are skipped — a link to the run DIR
    // or to the deleted questions scratch file only ever 404s.
    if (isBrowsableKind(kind) && path && this.logWriter) {
      // ONE slot keyed by the burst reset its count whenever the key changed, so
      // two executions sweeping folders CONCURRENTLY (a workspace fan-out of an
      // extraFiles-declaring agent; _indexExtraFiles awaits between files, so they
      // interleave) flipped the key on every event and nothing was ever suppressed.
      // A Map counts each burst on its own. Bounded by the run's distinct
      // (kind, execution, node) triples, which is what a burst IS.
      const burst = `${kind}\u0000${attr?.executionId ?? ''}\u0000${attr?.nodeId ?? ''}`;
      if (!this._artifactLogRuns) this._artifactLogRuns = new Map();
      const n = (this._artifactLogRuns.get(burst) || 0) + 1;
      this._artifactLogRuns.set(burst, n);
      if (n <= BULK_ARTIFACT_THRESHOLD) {
        this.logWriter.push({
          source: 'artifact', level: 'artifact', text: `${kind}: ${path}`,
          ts: new Date().toISOString(), path, kind,
          ...(attr?.nodeId != null ? { nodeId: attr.nodeId } : {}),
          ...(attr?.executionId != null ? { executionId: attr.executionId } : {}),
          ...(attr?.cycle != null ? { cycle: attr.cycle } : {}),
        });
      }
    }
    // ALSO index FS markdown/extra paths so pipeline-delete can unlink the EXACT
    // files later, per-step attribution rides along (best-effort; never blocks a
    // run). Every kind with a durable on-disk relPath is recorded. Skipped:
    // 'pipeline' (the run DIR itself, no single file), 'clarify' (the Q&A lives in
    // the clarify table, not in a file this row could resolve) and 'questions' (a
    // scratch file the orchestrator deletes once the round is answered — the Q&A
    // lives in the step_questions table, so an index row would only ever 404).
    // The WS event above still carries all three kinds for the live view. plan/
    // review markdown live under <store>/<key>/{plans,reviews} (store-root-
    // relative); prompt/checklist/webui live in the pipeline dir (dir-relative).
    if (!this.pipeline || !path || kind === 'pipeline' || kind === 'clarify' || kind === 'questions') return;
    let relPath = null;
    const pdir = this.pipeline.dir;
    if (path.startsWith(pdir + sep)) {
      relPath = relative(pdir, path);                 // dir-relative (checklist, webui)
    } else {
      const root = this.isWorkspace
        ? workspaceStorePath(this.workspaceKey)
        : projectStorePath(this.workMode !== 'git' ? this.members[0].projectKey : projectKey(this.projectDir));
      if (path.startsWith(root + sep)) relPath = relative(root, path); // store-rel (plan/review)
    }
    // Indexed with '/' on every OS: the row is a store-layout key, not a native
    // path (pipeline-delete re-roots 'plans/…' / 'reviews/…' under the store),
    // so a Windows-native 'reviews\\x.md' would silently miss that re-rooting.
    if (relPath) {
      recordArtifact(this.pipeline.id, kind, relPath.split(sep).join('/'), {
        stepKey: attr?.executionId ?? null,
        nodeId: attr?.nodeId ?? null,
        cycle: attr?.cycle ?? null,
      });
    }
  }

  /**
   * Translate one agent event into pipeline state and 'log' events. Real spawns
   * deliver the normalized vocabulary (src/core/engines/events.mjs); a legacy
   * runner envelope (tests, tools) goes through the Claude normalizer first.
   */
  _onAgentEvent(role, e, attr = null) {
    if (!e) return;
    if (!isNormalized(e)) {
      const key = attr?.executionId ?? '(no execution)';
      let normalize = this._legacyNormalizers.get(key);
      if (!normalize) { normalize = createClaudeNormalizer(); this._legacyNormalizers.set(key, normalize); }
      for (const n of normalize(e)) this._onAgentEvent(role, n, attr);
      return;
    }
    if (this.telemetry) this.telemetry.observe(e, attr);
    switch (e.type) {
      // Sub-agent telemetry (feature-detected, gated by WORCA_SUBAGENT_HOOKS). A
      // surfaced PostToolUse:Agent hook_response carries, as the hook's echoed stdout,
      // the parent tool_use_id + tool_response telemetry; enrich the matching record's
      // columns, keyed by tool_use_id (the canonical key — never agent_id). A hook has
      // no human text and no cost.
      case 'hook': this._recordSubAgentTelemetry(e.raw); return;
      case 'session': this._onSessionEvent(role, e, attr); return;
      case 'stderr': this._onStderrEvent(role, e, attr); return;
      case 'log': this._onTextEvent(role, { parentId: null, text: e.text }, attr); return;
      case 'result': this._onResultEvent(role, e, attr); return;
      case 'subagent': this._onSubAgentEvent(e, attr); return;
      case 'text': this._onTextEvent(role, e, attr); return;
      case 'tool': this._onToolEvent(role, e, attr); return;
      case 'toolResult': this._onToolResultEvent(role, e, attr); return;
      case 'retry': this._onRetryEvent(role, e, attr); return;
      case 'usage': this._onUsageEvent(e, attr); return;
      // Spend outside a result (a route's close, an engine's figure on a way out): the usage ledger books it.
      case 'spend': this._bookUsage(e, attr); return;
      default: return;
    }
  }

    // Sub-agent attribution. A child (Task/Agent) event carries parent_tool_use_id
    // = the id of the parent's Task tool_use block; main-agent events carry null/
    // absent. parent_tool_use_id is a TOP-LEVEL stream-json field; the message-
    // nested read is defensive. On a string `raw`, both reads yield undefined.
  _sourceFor(role, parentId, attr) {
    if (parentId == null) return { source: role, logAttr: attr };
    let label = this._subAgentLabels.get(parentId);
    if (!label) {
      label = `sub-agent-${++this._subAgentFallbackSeq}`;
      this._subAgentLabels.set(parentId, label); // stamp so the ordinal stays stable for this id
    }
    // Preserve the step attribution (nodeId/stepIndex/cycle) carried by attr so a
    // sub-agent line stays pinned to the right pipeline step/cycle in the UI; just
    // add `sub`. {...null} === {}, so attr === null (the clarify pre-step) is safe.
    return { source: `${role} ▸ ${label}`, logAttr: { ...attr, sub: true } };
  }

  // Pause/Resume: stamp the claude session id on the step that spawned it, and
  // persist eagerly — a later pause (or even a crash) must find it in the DB.
  // The session's init also surfaces the model (parity with worca's
  // `[init] model=<model>`).
  _onSessionEvent(role, e, attr) {
    const key = attr?.stepKey;
    const step = key ? this.state.steps.find((s) => s.key === key) : null;
    // The runner reports the session id on its own `session` event; the init
    // event's copy is for Ask Worca, which reads raw captures that lack it.
    if (!e.init && typeof e.sessionId === 'string' && step && step.sessionId !== e.sessionId) {
      step.sessionId = e.sessionId;
      this._persist().catch(() => {});
    }
    if (!e.init) return;
    this._log(role, 'debug', `[init] model=${e.model || '?'}`, attr);
    // §4.7: stamp the session's ACTUAL model on the step (mirrors the
    // sessionId stamp above) so the UI can resolve the "default" caption to
    // a concrete name. Display-only; sub-agent events never carry init.
    if (step && e.model && step.modelUsed !== e.model) {
      step.modelUsed = e.model;
      this._persist().catch(() => {});
    }
    // §10: an init without an `mcpServers` list says nothing about the copies (never "absent").
    if (Array.isArray(e.mcpServers) && this.mcpLayer?.copies.length) this._recordMcpInit(e.mcpServers);
  }

  // I1: a turn the CLI never closes with a `result` (pause, stop, a crash, a retried attempt) was
  // still billed. Keep the latest usage per top-level message id (the CLI repeats it on every content
  // block) until the step's `result` books the real figure; _execStep closes what is left.
  _onUsageEvent(e, attr) {
    if (e.phase !== 'message' || (e.parentId ?? null) !== null || !e.usage || !attr?.stepKey) return;
    this._noteOpenTurn(attr.stepKey, attr.model, { id: e.messageId ?? undefined, usage: e.usage, model: e.model });
  }

  // Agent stderr (`stream:'err'`), one framed line per event. Handled HERE,
  // beside the other envelope guards, because a stderr event carries no `raw`:
  // routing it through the cost block and the five lifecycle reducers below
  // only to have each no-op is noise. It is always main-stream (stderr has no
  // parent_tool_use_id), so the source is the plain role and `sub` is never set.
  //
  // Level is `warn`, not `error`: what actually lands here is mostly 429/529
  // retry text and subprocess chatter. Genuine failures arrive as a `result`
  // event with is_error on STDOUT — see the non-zero-exit path in
  // claude-runner.mjs — and are logged at `error` by the node failure handler.
  _onStderrEvent(role, e, attr) {
    const text = (e.text || '').trim();
    if (text) this._log(role, 'warn', text, { ...attr, stream: 'err' });
  }

  // Capture actual spend before anything returns early. The runner tags the
  // terminal stream-json `result` with costUsd (Claude's total_cost_usd; 0 in
  // mock), a session total that _sessionCostDelta turns into this result's share
  // before any override sees it. Fall back to raw.total_cost_usd defensively. e.raw may be a string
  // (non-JSON line) — `.type` on it is just undefined, so this never throws.
  // `e.costUsd != null` keeps a genuine 0 (which `!= null` is true for).
  // A per-model cost override (config.mjs) wins over the CLI's own figure — so a
  // CLI that prices an on-prem/proxied model by name can't inflate the ledger.
  // With no override this is `rawCost` unchanged (default behavior preserved).
  //
  // Gated on `isResult` — NOT merely on attr.model. Every stream frame reaches
  // here, and only the terminal `result` carries cost; on the others rawCost is
  // NaN and falls through untouched today. A {free} override answers 0 for any
  // input, so resolving unconditionally would turn each of those into a real $0
  // and fire _recordCost — a full writeState + 'state' broadcast — per FRAME
  // instead of once per node. Looked up ONCE and shared with observeModelCost
  // below: modelCostConfig re-reads settings.json on every call.
  // §4.6 cost-reliability observation: only terminal result events of REAL
  // runs, only for the dispatched model (attr.model — the legacy role path
  // carries no attr and is skipped), and only env-routed models inside
  // observeModelCost. One warning per model per run; the observation itself
  // is derived state and must never fail the run.
  _onResultEvent(role, e, attr) {
    const rawCost = this._sessionCostDelta(e, attr?.stepKey);
    const costCfg = attr?.model ? modelCostConfig(attr.model) : null;
    // A bridged node whose upstream reported what its calls cost (OpenRouter's
    // usage.cost, booked per execution id) records that figure: the CLI prices an
    // id it does not know at $0, and a pinned price is only an estimate of it.
    // Read before _recordBridgeCalls forgets the tag.
    const upstreamCost = attr?.executionId ? bridgeCostFor(attr.executionId) : null;
    const cliCost = costCfg ? resolveModelCost(attr.model, rawCost, e.usage, costCfg) : rawCost;
    // The usage ledger (_bookUsage): the bridge's upstream figure, else what the relay measured (a remote result: the
    // sandbox's figure is a claim, compared and never booked), else the engine's own figure.
    const booked = upstreamCost
      ? this._bookUsage({ source: 'bridge', costUsd: upstreamCost.costUsd, usage: e.usage, costCfg }, attr)
      : e.relay
        ? this._bookUsage({ source: 'relay', ...e.relay, claimedCostUsd: cliCost, costCfg }, attr)
        : this._bookUsage({ source: 'engine', result: true, costUsd: cliCost, usage: e.usage, costCfg }, attr);
    this._openTurns?.delete(attr?.stepKey);        // the result prices every turn it closes
    this._recordBridgeCalls(attr?.stepKey, attr?.executionId);
    // Booked here, so never again at _closeOpenTurns' flush: _recordBridgeCalls keeps a tag under which
    // no call was counted, and the call and cost maps evict apart (bridge/telemetry.mjs MAX_TAGS).
    if (upstreamCost) forgetBridgeTag(attr.executionId);
    if (!this.claude.mock && attr?.model) {
      try {
        const verdict = observeModelCost(attr.model, booked, e.relay ? relayUsageTotal(e.relay) : e.usage, costCfg);
        if (verdict === 'flagged') {
          if (!(this._costUnreliableWarned ||= new Set()).has(attr.model)) {
            this._costUnreliableWarned.add(attr.model);
            this._log('orchestrator', 'warn',
              `model "${attr.model}" reported no cost despite token usage (custom endpoint) — USD budget enforcement cannot see this spend`, attr);
          }
          this._noteCostUnknown(attr?.stepKey ? this._costStep(attr.stepKey) : null, 'the model reported no cost despite token usage (custom endpoint)', attr, true);
        }
      } catch { /* derived state — never fail the run over it */ }
    }
    const text = (e.text || '').trim();
    if (text) this._log(role, 'info', text, attr);
    // §10: a first-party 400 on an over-long MCP tool name fails the whole turn; name the
    // registry copies whose tools were never checked (no current Test), once per run.
    if (e.isError && !this._mcpNameWarned && this.mcpLayer?.copies.length) {
      const errText = [e.text, ...(Array.isArray(e.errors) ? e.errors : [])].filter((t) => typeof t === 'string').map((t) => t.slice(0, 4096)).join(' ');
      const untested = this.mcpLayer.copies.filter((c) => c.untested);
      if (untested.length && MCP_NAME_400_RE.test(errText)) {
        this._mcpNameWarned = true;
        const sets = [...new Set(untested.map((c) => c.setName))].join(', ');
        this._mcpChain(() => this._recordRunWarning(`${MCP_NAME_WARNING} — Test the servers in ${sets} (${untested.map((c) => c.name).join(', ')})`));
      }
    }
  }

  /** What a result's CLI cost adds to the step. A `cumulativeCost` figure (Claude Code) is the
   *  session's running total: a re-woken process repeats the earlier turns, and `--resume` (a question
   *  round, a pause) restores the session's cost into its first result. So the step keeps the last
   *  figure per session id (`sessionCosts`, in exec_meta so a resumed run starts from it) and books
   *  the difference. A figure below the kept one means the CLI restored less (a process killed before
   *  it saved its cost): nothing is booked and it becomes the baseline. Any other cost is the
   *  result's own, as is a cumulative one with no session id or no step row. */
  _sessionCostDelta(e, stepKey) {
    const cost = e.costUsd != null ? Number(e.costUsd) : NaN;
    if (!e.cumulativeCost || !e.sessionId || !Number.isFinite(cost)) return cost;
    const key = stepKey
      || (this.state.cycle ? `${this.state.phase}#${this.state.cycle}` : this.state.phase);
    const step = this.state.steps.find((s) => s.key === key);
    if (!step) return cost;
    const seen = Number(step.sessionCosts?.[e.sessionId]) || 0;
    (step.sessionCosts ||= {})[e.sessionId] = cost;
    return Math.max(0, cost - seen);
  }

  /** Sub-agent lifecycle: a spawn learns its label (for the child lines' "▸"
   *  tag) and, with a node in scope, records it; an ack, a finish or an error
   *  moves the record. The clarify pre-step (attr === null) carries no node, so
   *  its sub-agents are logged but not lifecycle-tracked. */
  _onSubAgentEvent(e, attr) {
    if (e.event === 'spawn') {
      if (!this._subAgentLabels.has(e.toolUseId)) {
        const desc = clip(e.label, SUBAGENT_LABEL_MAX);
        if (desc) this._subAgentLabels.set(e.toolUseId, desc); // empty desc left unset → fallback assigns sub-agent-N
      }
      if (attr) this._recordSubAgentSpawn(e, attr);
      return;
    }
    if (e.event === 'ack') { this._recordSubAgentAck(e); return; }
    this._recordSubAgentClose(e);
  }

  // Human-readable assistant text (if any). NO early return: a single
  // assistant turn can carry BOTH a text block and tool_use blocks — fall
  // through so each tool call is logged too. A text-only turn has no
  // tool_use/tool_result blocks, so the loops below are empty and its output
  // is identical to the pre-change path.
  _onTextEvent(role, e, attr) {
    if (e.delta) return; // the pipeline never asks for partial messages
    const { source, logAttr } = this._sourceFor(role, e.parentId, attr);
    const text = (e.text || '').trim();
    if (text) this._log(source, 'info', text, logAttr);
  }

  // Agent memory (memory-write-split design §4): pair every Write/Edit aimed at a memory directory
  // with its tool_result, main stream and sub-agent frames alike (same cwd, same dirs), so a write
  // the CLI refused — or that failed for any other reason — is reported at sync time instead of
  // vanishing. Never throws; never mutates run state.
  _onToolEvent(role, e, attr) {
    this._trackMemoryCalls(e.calls, attr);
    // Named-skill / MCP-tool usage for the Sub-agents dropdown pills (main agent
    // -> its step; sub-agent -> its record), and graphify CLI invocations (Bash
    // only: the graphify skill runs the CLI itself, so counting the Skill tool too
    // would double-count).
    this._recordSkills(e.calls, e.parentId, attr);
    this._recordGraphify(e.calls, e.parentId, attr);
    const { source, logAttr } = this._sourceFor(role, e.parentId, attr);
    for (const { text, desc } of describeToolUses(e.calls, this.projectDir)) {
      this._log(source, 'debug', `→ ${text}`, desc ? { ...(logAttr || {}), desc } : logAttr);
    }
  }

  // The CLI's silent API retries: without this line a call that keeps timing out
  // leaves the run log dead for as long as the retries last.
  _onRetryEvent(role, e, attr) {
    const { source, logAttr } = this._sourceFor(role, e.parentId, attr);
    this._log(source, 'warn', describeApiRetry(e), logAttr);
  }

  // Tool-result outcomes. Log-only: sub-agent lifecycle arrives as `subagent` events.
  _onToolResultEvent(role, e, attr) {
    this._trackMemoryResults(e.results, attr);
    const { source, logAttr } = this._sourceFor(role, e.parentId, attr);
    for (const line of describeToolResults(e.results)) {
      this._log(source, 'debug', `← ${line}`, logAttr);
    }
  }

  /** §10: run.json.mcpStatus and its warnings go through ONE chain — updateRunManifest is an
   *  unlocked read-modify-write and fan-out nodes emit `system/init` concurrently. A pause and the
   *  teardown drain and close it (a later event must not write behind a resume or recreate the
   *  removed run root). */
  _mcpChain(fn) {
    if (this._mcpClosed) return this._mcpTail || Promise.resolve();
    this._mcpTail = (this._mcpTail || Promise.resolve()).then(fn).catch(() => {});
    return this._mcpTail;
  }

  /** §10: one warning per registry copy and problem status per run; `pending` is a debug line. */
  _recordMcpInit(servers) {
    const status = new Map(servers.map((s) => [s?.name, s?.status]));
    const copies = this.mcpLayer.copies;
    this._mcpChain(async () => {
      const m = (await readRunManifest(this.runRoot)) || {};
      const cur = m.mcpStatus || {};
      const next = { ...cur };
      const warned = new Set(m.warnings || []);   // once per copy and status per run, flapping included
      const lines = [];
      for (const c of copies) {
        const st = status.get(c.name) ?? 'absent';
        if (st === 'pending') { this._log('mcp', 'debug', `${c.name}: MCP server still starting (pending)`); continue; }
        next[c.name] = st;
        const w = mcpStatusWarning(c.name, st, c.setName);
        if (w && !warned.has(w)) { warned.add(w); lines.push(w); }
      }
      await updateRunManifest(this.runRoot, { mcpStatus: next });
      for (const w of lines) await this._recordRunWarning(w);
    });
  }

  /**
   * Lifecycle spawn reducer: for a NEW main-stream Task/Agent spawn, push a
   * `running` sub-agent record (attributed to the step via `attr`), mirror it to
   * the sub_agents table, and emit a `spawn` delta. Idempotent per tool_use id
   * (a re-seen id is skipped). `attr` is required (the caller only invokes this
   * when a node is in scope).
   */
  _recordSubAgentSpawn(e, attr) {
    if (!e.toolUseId || this.state.subAgents.some((s) => s.id === e.toolUseId)) return; // idempotent
    const label = this._subAgentLabels.get(e.toolUseId) || clip(e.label, SUBAGENT_LABEL_MAX);
    const rec = {
      id: e.toolUseId,
      label: label || null,
      nodeId: attr.nodeId ?? null,
      uiPhase: attr.uiPhase ?? null,
      stepIndex: attr.stepIndex ?? null,
      cycle: attr.cycle ?? null,
      stepKey: attr.stepKey ?? null,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      subagentType: e.subagentType ?? null,
      // In-memory only (no column): lets _recordSubAgentTelemetry price this
      // child. A sub-agent runs on the PARENT node's endpoint, so the parent's
      // model is the right price — UNLESS the Task input names a model that
      // itself carries an explicit override, which then governs the child.
      // A bare alias ('haiku') with no catalog entry is not one, so it keeps
      // the parent's rather than silently reverting to the CLI's figure.
      model: subAgentCostModel(e.model, attr.model),
      // PERSISTED (sub_agents.run_model): the model this child actually ran on —
      // the alias its Task call named (the sub-agent model directive asks for an
      // explicit one on every call), else the parent node's model, which is what
      // a child with no `model` inherits. KNOWN GAP: an agent definition's own
      // `model:` frontmatter outranks an omitted param and is invisible in the
      // stream, so such a child records the parent's model. Deliberately NOT
      // `model` above: that one is the PRICING model, which can differ for an
      // explicit alias carrying its own catalog cost entry.
      runModel: (typeof e.model === 'string' && e.model.trim())
        ? e.model.trim()
        : (attr.model ?? null),
    };
    this.state.subAgents.push(rec);
    this._upsertSubAgent(rec);
    this._subAgentTransition('spawn', rec);
  }

  /**
   * A background sub-agent's launch ack (the `subagent` event `ack`: its
   * tool_result frame carries a top-level `tool_use_result` with
   * {isAsync:true, status:'async_launched'}). NOT a finish: the record stays
   * `running` until _recordSubAgentClose sees the task_notification.
   */
  _recordSubAgentAck(e) {
    const rec = this.state.subAgents.find((s) => s.id === e.toolUseId);
    if (!rec || rec.status !== 'running') return; // unknown id or already terminal
    // Launch ack — still running in the background; task_notification (or
    // the execution backstop) closes it. resolvedModel closes a spawn-time
    // gap: an agent definition's `model:` frontmatter is invisible in the
    // Task input, so a record with no runModel learns it here. Never
    // overwrites a spawn-set alias (the UI pill renders the value verbatim).
    if (rec.runModel == null && e.resolvedModel) {
      rec.runModel = e.resolvedModel;
      this._upsertSubAgent(rec);
      this._subAgentTransition('update', rec);
    }
  }

  /**
   * Lifecycle finish reducer, fed by `subagent` finish/error events. Two sources
   * produce them:
   * - a foreground sub-agent's tool_result (with the frame's tool_use_result
   *   telemetry: totalDurationMs, totalTokens, resolvedModel);
   * - a background sub-agent's system/task_notification, the one stop marker
   *   keyed by tool_use_id (probed on claude 2.1.251, 2026-08-31). Its
   *   usage.{duration_ms,total_tokens} is OPTIONAL: without it durationMs stays
   *   null and the UI's timestamp fallback is real wall time. A resumable agent
   *   may notify more than once; anything but status==='completed' closes as
   *   'error'.
   * Sets status and finishedAt ONLY while the record is still 'running' (a
   * late/duplicate result must not flip a terminal record back or re-emit),
   * mirrors to the table and emits a `finish` delta. No cost figure exists in
   * either source; costUsd stays hook-gated.
   */
  _recordSubAgentClose(e) {
    const rec = this.state.subAgents.find((s) => s.id === e.toolUseId);
    if (!rec || rec.status !== 'running') return; // unknown id or already terminal
    // Foreground completion telemetry — the same durationMs/tokens fields the
    // gated PostToolUse hook fills; tool_use_result carries no cost. With
    // WORCA_SUBAGENT_HOOKS on, _recordSubAgentTelemetry may re-write these
    // after the finish (it does not gate on status): last writer wins, and
    // both sources quote the same CLI figures — deliberate, not a race to fix.
    if (e.durationMs != null) rec.durationMs = e.durationMs;
    if (e.tokens != null) rec.tokens = e.tokens;
    if (rec.runModel == null && e.resolvedModel) rec.runModel = e.resolvedModel;
    rec.status = e.event === 'error' ? 'error' : 'finished';
    rec.finishedAt = new Date().toISOString();
    this._upsertSubAgent(rec);
    this._subAgentTransition('finish', rec);
  }

  /**
   * Record skills / MCP-tools used in one agent event. Routes by parent_tool_use_id:
   * a MAIN-agent turn (subId == null) attributes to its pipeline step (by stepKey);
   * a sub-agent turn (subId != null) attributes to the spawned record (id === subId).
   * Grows a deduped, capped `skills` array and emits a delta + persists ONLY when the
   * set actually changed. No-op when there is nothing to attribute to (e.g. the
   * clarify pre-step has no step; a child event seen before its spawn).
   */
  _recordSkills(calls, subId, attr) {
    const labels = extractSkillLabels(calls);
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
  _recordGraphify(calls, subId, attr) {
    const n = countGraphifyBashCalls(calls);
    if (!n) return;
    if (subId == null) {
      const key = attr?.stepKey;
      const step = key ? this.state.steps.find((s) => s.key === key) : null;
      if (!step) return;
      step.graphifyCount = (step.graphifyCount ?? 0) + n;
      this._emit('stepgraphify', {
        stepKey: step.key,
        nodeId: step.nodeId ?? null,
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
      // The model pill's live feed: without this the Running view paints no pill
      // until the next full state snapshot replaces r.subAgents.
      ...(rec.runModel != null ? { runModel: rec.runModel } : {}),
      ts: new Date().toISOString(),
    });
  }

  /**
   * Telemetry enrichment from a surfaced PostToolUse:Agent hook-event. The CLI's
   * hook line is `{type:'system', subtype:'hook_response', hook_name:
   * 'PostToolUse:Agent', hook_event:'PostToolUse', stdout, output, …}`; the
   * PostToolUse payload is NOT on that envelope, it is the hook command's echoed
   * stdout (buildHookSettings runs `cat`). Reads the payload's tool_use_id +
   * tool_response.{totalDurationMs,totalTokens,usage} and fills the matching
   * sub-agent record's durationMs/tokens/costUsd (only those present), mirrors to
   * the table, and emits an `update` delta. No-op for hook_started/hook_progress,
   * a non-PostToolUse hook, non-JSON output, an unknown id, or a background
   * launch ack (task_notification closes those). Strictly additive — the
   * baseline lifecycle needs none of this.
   */
  _recordSubAgentTelemetry(raw) {
    if (raw?.subtype !== 'hook_response' || raw.hook_event !== 'PostToolUse') return;
    const out = typeof raw.stdout === 'string' && raw.stdout.trim() ? raw.stdout : raw.output;
    let payload;
    try { payload = JSON.parse(out); } catch { return; } // a hook that printed non-JSON is not telemetry
    const id = payload?.tool_use_id ?? null;
    if (!id) return;
    const rec = this.state.subAgents.find((s) => s.id === id);
    if (!rec) return;
    const tr = payload.tool_response;
    if (!tr || typeof tr !== 'object' || tr.isAsync === true || tr.status === 'async_launched') return;
    if (Number.isFinite(Number(tr.totalDurationMs))) rec.durationMs = Number(tr.totalDurationMs);
    if (Number.isFinite(Number(tr.totalTokens))) rec.tokens = Number(tr.totalTokens);
    const cost = tr.usage?.cost_usd ?? tr.usage?.total_cost_usd ?? tr.cost_usd;
    if (Number.isFinite(Number(cost))) {
      // Apply the same per-model cost override as the node result path, so a
      // sub-agent of a free/priced model doesn't display the CLI's fabricated
      // figure. rec.model is set at spawn (see subAgentCostModel); absent (e.g.
      // after a resume, which rebuilds records from the table) → the CLI value
      // stands. A {perMtok} model with unpriceable usage yields NaN — leave the
      // row's cost UNSET rather than write a made-up figure into the display.
      const resolved = rec.model ? resolveModelCost(rec.model, Number(cost), tr.usage) : Number(cost);
      if (Number.isFinite(resolved)) rec.costUsd = resolved;
    }
    this._upsertSubAgent(rec);
    this._subAgentTransition('update', rec);
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
  /**
   * Model bridge (model-bridge-design.md §7.2/§8.6): the premium-request-
   * initiating calls a node made through the bridge, read off the bridge's
   * per-execution counter when the node's terminal `result` arrives and
   * stamped on the step (`bridgeCalls`; `bridgeContinued` the tool-loop
   * continuations). Nothing for a non-bridged node, so the step shape is
   * unchanged there. Persisted through exec_meta (artifacts.mjs).
   */
  _recordBridgeCalls(stepKey, executionId) {
    if (!executionId) return;
    const calls = bridgeCallsFor(executionId);
    if (!calls.initiated && !calls.continued) return;
    forgetBridgeTag(executionId);
    const key = stepKey
      || (this.state.cycle ? `${this.state.phase}#${this.state.cycle}` : this.state.phase);
    const step = this.state.steps.find((s) => s.key === key);
    if (!step) return;
    step.bridgeCalls = (step.bridgeCalls || 0) + calls.initiated;
    step.bridgeContinued = (step.bridgeContinued || 0) + calls.continued;
    // OpenRouter `:free` calls (continuations too): what the step spent of the day's allowance.
    if (calls.free) step.bridgeFreeCalls = (step.bridgeFreeCalls || 0) + calls.free;
    this.state.updatedAt = new Date().toISOString();
    this._emit('state', this.getState());
    this._persist().catch(() => {});
  }

  /**
   * The one place a step's spend changes (plans/core-protection-layer-design.md §4.3); every _recordCost goes through
   * here. `e`: { source:'relay', messages, byModel, claimedCostUsd? } — what the relay measured (on a result frame, or
   * at the route's close); { source:'engine', costUsd?, usage?, result?, aux? } — a figure the engine reported (already
   * session-delta'd and override-resolved; `result` marks a result frame, the only kind that warns about a missing
   * cost); { source:'bridge', costUsd, usage? } — the in-process bridge's upstream figure. `e.costCfg` passes the
   * caller's modelCostConfig lookup (it re-reads settings.json). Tokens are always counted; a cost worca cannot price
   * leaves `costKnown` false (sticky), never a known $0. Returns the booked cost, or null.
   */
  _bookUsage(e, attr = null) {
    const key = attr?.stepKey ?? null;
    const model = attr?.model || null;
    const costCfg = e.costCfg !== undefined ? e.costCfg : (model ? modelCostConfig(model) : null);
    const engine = this.claude.engine || DEFAULT_ENGINE;
    const entry = engineEntry(engine);
    // A cost:false engine is priced only by an operator price on the model (free / perMtok): else tokens only.
    const billable = !!e.aux || entry?.cost !== false || !!(costCfg?.free || costCfg?.perMtok);
    let cost = NaN; let known = true; let usage = e.usage || null; let why = null; let quiet = false;
    if (e.source === 'relay') {
      if (key) this._openTurns?.delete(key);
      if (!e.messages) {
        // Nothing measured: a claim is never booked, but a sandbox claiming real spend is named (as _relayedCost did).
        const cli = e.claimedCostUsd;
        if (Number.isFinite(cli) && cli > 0.01) {
          this._log('orchestrator', 'warn', `the sandbox reported $${cli.toFixed(4)} for this call, the model relay measured $0.0000 (0 model replies); worca books the relay's figure`, attr);
        }
        return null;
      }
      usage = relayUsageTotal(e);
      if (!billable) { known = false; quiet = true; why = `${entry?.label ?? engine} reports no cost`; }
      else {
        const cli = Number.isFinite(e.claimedCostUsd) ? e.claimedCostUsd : NaN;
        let m = null; try { m = priceRelayUsage(e, model); } catch { m = null; }
        if (!m) { known = false; why = 'the model relay could not price this call'; }
        else if (m.unpriced.length) {
          // Source plan Task 10: with an unpriced model the step holds max(cli, measured) — a forged $0 cannot hide the
          // priced part — and is marked unknown instead of reading as a full figure. `measured` already prices the
          // unpriced model at the highest list rate (priceRelayUsage, audit 2.8), so the sandbox's claim never lowers it.
          known = false; why = `no price for ${m.unpriced.join(', ')}`;
          cost = Number.isFinite(cli) ? Math.max(cli, m.costUsd) : m.costUsd;
        } else {
          if (Number.isFinite(cli)) {
            const gap = Math.abs(cli - m.costUsd);
            if (gap > Math.max(0.01, 0.25 * Math.max(cli, m.costUsd))) {
              this._log('orchestrator', 'warn', `the sandbox reported $${cli.toFixed(4)} for this call, the model relay measured $${m.costUsd.toFixed(4)}`
                + ` (${e.messages} model ${e.messages === 1 ? 'reply' : 'replies'}); worca books the relay's figure`, attr);
            }
          }
          cost = m.costUsd;
        }
      }
    } else {
      cost = Number.isFinite(e.costUsd) ? e.costUsd : NaN;
      if (!billable) { known = false; quiet = true; why = `${entry?.label ?? engine} reports no cost`; }
      else if (!Number.isFinite(cost) && e.result && !this.claude.mock) {
        // The texts the old _onResultEvent logged (test/engine-gate.test.mjs:760-776, model-cost-override-surfaces:117).
        known = false;
        why = costCfg?.perMtok
          ? `model "${model}" is priced per-Mtok but the result carried no token usage — this step's spend is unaccounted`
          : 'result event carried no cost estimate (total_cost_usd absent)';
      }
    }
    const opts = e.aux ? { aux: e.aux } : undefined;
    // A row handed off to a resumed run (_recordCost's own guard): never touch its step, log or persist from here.
    if (this._rowHandedOff()) { if (Number.isFinite(cost)) this._recordCost(cost, key, opts); return Number.isFinite(cost) ? cost : null; }
    const step = key || this.state.phase ? this._costStep(key || (this.state.cycle ? `${this.state.phase}#${this.state.cycle}` : this.state.phase)) : null;
    if (step && usage) {
      const t = (step.usage ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      t.input += Number(usage.input_tokens) || 0; t.output += Number(usage.output_tokens) || 0;
      t.cacheRead += Number(usage.cache_read_input_tokens) || 0; t.cacheWrite += Number(usage.cache_creation_input_tokens) || 0;
    }
    if (!known) this._noteCostUnknown(step, why, attr, quiet);
    if (Number.isFinite(cost)) this._recordCost(cost, key, opts);
    else if (step && (usage || !known)) { this.state.updatedAt = new Date().toISOString(); this._emit('state', this.getState()); this._persist().catch(() => {}); }
    return Number.isFinite(cost) ? cost : null;
  }

  /** Mark `step`'s cost unknown (sticky) and, the first time, remember it for the cap check at the next spawn
   *  (_checkCostLimits). Logs `why` once per step (and once with no step row, as the old result warning did), unless
   *  `quiet` (a cost:false engine: the run start already says so, `_engineGate`). */
  _noteCostUnknown(step, why, attr = null, quiet = false) {
    if (!quiet) {
      const tag = `${step?.key ?? attr?.stepKey ?? ''}|${why}`;
      if (!(this._costUnknownLogged ||= new Set()).has(tag)) { this._costUnknownLogged.add(tag); this._log('orchestrator', 'warn', why, attr); }
    }
    if (!step || step.costKnown === false) return;
    step.costKnown = false;
    this._costUnknownPending ||= { stepKey: step.key, why };
  }

  /** Book `costUsd` on step `stepKey` (and the run total + spend ledger). `aux` names a worca-owned
   *  AI call (Away mode review, Auto workflow, run title): its share is ALSO tallied in
   *  step.auxCosts[aux] — at the SAME roundUsd grain as step.costUsd, so Σ aux never exceeds the
   *  step (I3) — so every surface can show it apart from, never instead of, the step cost.
   *  A key that names no step falls back to the preflight bookend (logged once): dropping it would
   *  leave the ledger above the run total. */
  _recordCost(costUsd, stepKey = null, { aux = null } = {}) {
    if (!Number.isFinite(costUsd) || costUsd < 0) return;
    const key = stepKey
      || (this.state.cycle ? `${this.state.phase}#${this.state.cycle}` : this.state.phase);
    if (this._rowHandedOff()) {
      // A paused harness whose row a resumed run now owns (a late run title): the call was billed,
      // so the ledger keeps it, but this stale state is never written over that run, broadcast as
      // its state, or logged into its run log. The resumed run's total never saw this call.
      if (costUsd > 0 && this.pipeline?.id) {
        try { recordCostDelta({ pipelineId: this.pipeline.id, stepKey: key, amountUsd: costUsd }); } catch { /* best-effort */ }
      }
      return;
    }
    const step = this._costStep(key);
    if (step) {
      step.costUsd = roundUsd((step.costUsd || 0) + costUsd);
      if (aux) {
        const b = ((step.auxCosts ||= {})[aux] ||= { usd: 0, calls: 0 });
        b.usd = roundUsd(b.usd + costUsd); b.calls += 1;
      }
    } else if (costUsd > 0 && !this._costNoRowLogged) {
      // No step rows at all (before the preflight bookend): the ledger below still sees it, the total cannot.
      this._costNoRowLogged = true;
      this._log('orchestrator', 'warn', `cost for "${key}" has no step row yet; it is in the spend ledger but not in this run's total`);
    }
    // Derive the pipeline total from the per-step figures so it ALWAYS equals
    // their sum. Keeping a separate running total and rounding it on every add
    // drifts from Σ steps (e.g. 0.00005 + 0.00015 gave total 0.0003 vs Σ 0.0002).
    this.state.totalCostUsd = sumStepCosts(this.state.steps);
    // Append-only spend ledger (windowed budget accounting). Best-effort:
    // accounting must never kill a run; ledger and state share the same DB,
    // so failures co-occur with the _persist catch below anyway.
    if (costUsd > 0 && this.pipeline?.id) {
      try { recordCostDelta({ pipelineId: this.pipeline.id, stepKey: step?.key ?? key, amountUsd: costUsd }); }
      catch (err) { this._log('orchestrator', 'warn', `cost ledger write failed: ${err?.message || err}`); }
    }
    this.state.updatedAt = new Date().toISOString();
    this._emit('state', this.getState());
    this._persist().catch(() => {});
  }

  /** The step a cost books on: `key`, else the preflight bookend, else the first row (null when
   *  there are no rows yet). Logs the fallback once per harness. */
  _costStep(key) {
    const hit = this.state.steps.find((s) => s.key === key);
    if (hit) return hit;
    const fb = this.state.steps.find((s) => s.key === 'x:preflight:1') || this.state.steps[0] || null;
    if (fb && !this._costFallbackLogged) {
      this._costFallbackLogged = true;
      this._log('orchestrator', 'warn', `cost for "${key}" has no step row; booked on ${fb.key}`);
    }
    return fb;
  }

  /** A worca AI call that ended before a priced `result` frame: count it on its step and keep its
   *  LOWER BOUND apart — never costUsd, the total, the ledger or a cap (I4). `floorUsd` is the
   *  list-price floor of what it streamed (≥ 0; a {free} model gives 0), or null/undefined when the
   *  model has no list price (counted, not priced). */
  _recordAuxStopped(stepKey, kind, floorUsd) {
    if (this._rowHandedOff()) return;      // a lower bound is display-only: nothing to keep for a row this harness no longer owns
    const step = this._costStep(stepKey);
    if (!step) return;
    const b = ((step.auxCosts ||= {})[kind] ||= { usd: 0, calls: 0 });
    b.stopped = (b.stopped || 0) + 1;
    if (Number.isFinite(floorUsd) && floorUsd >= 0) b.floorUsd = (b.floorUsd || 0) + floorUsd;
    this.state.updatedAt = new Date().toISOString();
    this._emit('state', this.getState());
    this._persist().catch(() => {});
  }

  /** Remember one streamed top-level assistant message of step `stepKey` until a `result` prices it. */
  _noteOpenTurn(stepKey, model, message) {
    const open = (this._openTurns ||= new Map());
    let t = open.get(stepKey);
    if (!t) open.set(stepKey, (t = { model: model || null, msgModel: null, perMsg: new Map() }));
    t.perMsg.set(message.id ?? `n${t.perMsg.size}`, message.usage);
    // The model the CLI's own message names: the floor's price when the node has no configured model
    // (the CLI's default). The last non-empty one wins.
    if (typeof message.model === 'string' && message.model) t.msgModel = message.model;
  }

  /** Step `stepKey` ended (paused, stopped, failed, retried) with turns no `result` priced.
   *  A BRIDGED node first: the requests its upstream already answered were priced by the upstream
   *  itself (OpenRouter's usage.cost, booked by the bridge under the execution id — the step key of
   *  a v2 row). That figure is real spend, never a floor: it is booked exactly as the result path
   *  books it (_onAgentEvent: the upstream wins over the CLI and over a pin), the request counters
   *  are folded, and the tag is forgotten so a --resume'd spawn starts from zero. Turns the upstream
   *  priced are NOT counted again below. Every other node: count the turns on the step with their
   *  tokens and a list-price LOWER BOUND apart (I4) — never costUsd, the total, the ledger or a cap.
   *  Input/cache tokens are exact at message start, output is a placeholder ≤ the final count.
   *  `step.stoppedTurns = { turns, tokens, floorUsd }`; floorUsd stays null while no closed turn had
   *  a list price ({free} → 0). The caller (_execStep) emits and persists; the bridged branch books
   *  through _recordCost, which persists itself. */
  _closeOpenTurns(stepKey) {
    const t = this._openTurns?.get(stepKey);
    this._openTurns?.delete(stepKey);
    const step = this.state.steps.find((s) => s.key === stepKey);
    if (!step) return;
    const up = bridgeCostFor(stepKey);
    this._recordBridgeCalls(stepKey, stepKey);
    forgetBridgeTag(stepKey);
    if (up && Number.isFinite(up.costUsd)) { this._bookUsage({ source: 'bridge', costUsd: up.costUsd }, { stepKey }); return; }
    if (!t || !t.perMsg.size) return;
    const u = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    for (const m of t.perMsg.values()) for (const k of Object.keys(u)) u[k] += Number(m?.[k]) || 0;
    let floor = null;
    // The node's configured model wins; with none (the CLI's default), the model its messages named.
    try { const rates = liveCostRates(t.model || t.msgModel); floor = rates ? estimateCost(u, rates) : null; } catch { floor = null; }
    const b = (step.stoppedTurns ||= { turns: 0, tokens: 0, floorUsd: null });
    b.turns += t.perMsg.size;
    b.tokens += u.input_tokens + u.output_tokens;
    if (Number.isFinite(floor)) b.floorUsd = (b.floorUsd || 0) + floor;
    // The floor stays display-only (its output count is a placeholder below the real one), so the step's real cost is
    // not known: never a known figure.
    this._noteCostUnknown(step, 'a stopped turn reported no cost', { stepKey });
  }

  _emit(event, payload) {
    if (event === 'state' && this.telemetry) this.telemetry.stateEmitted(payload);
    try {
      this.emit(event, payload);
    } catch {
      /* never let a listener crash the state machine */
    }
  }

  /**
   * Options for the title-generation spawn. The title call is the one claude
   * process a RUN starts outside runOpts, so it must mirror the run's claude
   * policy (bin, mock, env scrub) rather than inherit runClaude's PATH/env
   * defaults — a run built with claude:{mock:true} spawned the developer's REAL
   * binary 157x per `npm test` until 2026-08-30. Exposed as a method so the
   * plumbing is unit-testable (ESM imports cannot be spied).
   */
  _titleGenOpts() {
    return {
      // §2.1 row 3: fire-and-forget title generation was the one remaining worca-cc
      // process started inside the user's LIVE checkout. Once a run root exists
      // there is no reason for it. The kickoff site moved to just after
      // _setupRunRoot() so runCwd is populated here.
      cwd: this.runCwd ?? this.projectDir,
      signal: this.abort.signal,
      mock: this.claude.mock,
      // The run's own model is the title default (#422, title.mjs#resolveTitleModel):
      // an install with no first-party model titles its runs with no setup. The title
      // runs on the helper engine (helperEngineFor): Claude, Codex, or Claude for a Cursor run.
      // Only a Claude run's own model is passed; another engine's model means nothing there.
      ...this._helperSpawn(),
      runModel: this._helperEngine() === 'claude' && (this.claude.engine || 'claude') === 'claude' ? this._claudeCallModel() : null,
      ...this._titleSlotOpts(),
      run: this.opts.titleRunClaude,            // test seam (like nightRunClaude); undefined → runClaude
      bridgeTag: `run-title:${this.pipeline?.id || 'run'}`,   // a bridged title model: its upstream cost comes back under this tag
      onCost: (c) => this._bookTitleCost(c),
      // A failed title used to vanish into a kept provisional title. Say so in
      // the run log — once per run, there is only ever one title call.
      onError: ({ model, error }) => this._log('orchestrator', 'warn',
        `title generation failed (${model ? `model ${model}` : 'the CLI default model'}): ${clipMiddle(error?.message || error, 300)} — keeping the provisional title`),
      // Same env policy as the pipeline nodes. Both undefined on an unconfigured
      // project ⇒ byte-identical spawn env (legacy parity).
      envScrub: this.guardrails?.envScrub || undefined,
      // The project's allowlist adds names to every engine's catalog allowlist (src/core/spawn.mjs childEnv), scrub or not.
      envAllowlist: this.guardrails?.envAllowlist?.length ? this.guardrails.envAllowlist : undefined,
    };
  }

  /** The run-title call is worca's own AI spend during the run: a row + an aux 'title' share on preflight. */
  _bookTitleCost({ costUsd, usage, model }) {
    const now = new Date().toISOString();
    const rec = { id: `run-title-${randomUUID().slice(0, 8)}`, label: 'Run title', status: 'finished', startedAt: now, finishedAt: now,
      costUsd, tokens: (Number(usage?.input_tokens) || 0) + (Number(usage?.output_tokens) || 0),
      subagentType: 'run-title', uiPhase: 'preflight', nodeId: 'preflight', stepKey: 'x:preflight:1', runModel: model || null };
    // A title landing after a resumed run took the row over: its sub_agents row (keyed) and its ledger
    // line (_recordCost) are kept, but this harness no longer speaks for the run (no state, no frames).
    const handedOff = this._rowHandedOff();
    if (!handedOff) this.state.subAgents.push(rec);
    this._upsertSubAgent(rec);
    if (!handedOff) {
      this._subAgentTransition('spawn', rec);
      this._subAgentTransition('finish', rec);
    }
    this._bookUsage({ source: 'engine', costUsd, aux: 'title' }, { stepKey: 'x:preflight:1' });
  }

  /**
   * Fire-and-forget: generate a concise LLM title and, when ready, persist + broadcast it.
   * The promise is stored on this._titlePromise for test determinism but is NEVER awaited
   * by run() (must not delay the run). Aborts with the run via this.abort.signal.
   */
  _kickoffTitleGeneration() {
    const prompt = this.pipeline?.promptText || this.opts.prompt || '';
    const id = this.pipeline?.id;
    // D18: a slice started from its ticket keeps the title the ticket set (sliceTitle); the UI shows the slice's own
    // name under its feature. Slice 1's own shaping run gets runShape.slice only at outline approval: it titles as usual.
    const sl = this.runShape?.slice;
    if (sl && (sl.index > 1 || this.opts.shape?.slice)) {
      this.state.titleProvisional = false; this._titlePromise = Promise.resolve(); return;
    }
    // Smart run naming: a given title (typed, or suggested on the form) is kept; only an empty one is generated.
    if (this.opts.titleLocked) { this.state.titleProvisional = false; this._titlePromise = Promise.resolve(); return; }
    if (!prompt || !id) { this._titlePromise = Promise.resolve(); return; }
    this._titlePromise = Promise.resolve()
      .then(() => generateTitle(prompt, this._titleGenOpts()))
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

  /** Run telemetry (Labs): one recorder per harness, decided when the run dir is first bound. */
  _bindTelemetry(dir) {
    if (this.telemetry || !dir || !flagEnabled('runTelemetry')) return;
    this.telemetry = createTelemetryRecorder();
    this.telemetry.bind(dir);
  }

  async _closeTelemetry() {
    const t = this.telemetry;
    if (!t || t.isClosed()) return;
    try {
      const size = (p) => stat(p).then((x) => x.size, () => null);
      const dir = this.pipeline?.dir || this.state.pipelineDir;
      const [dbBytes, telemetryBytes, logBytes] = await Promise.all([
        size(dbPath()), dir ? size(join(dir, TELEMETRY_FILE)) : null, dir ? size(join(dir, RUN_LOG_FILE)) : null,
      ]);
      await t.close({ dbBytes, telemetryBytes, logBytes });
    } catch {
      await t.close().catch(() => {});   /* telemetry never fails a run */
    }
  }

  /** @returns {Promise<boolean>} whether the state reached the row. */
  async _persist() {
    const rpNow = this.state.resumePoint;
    if (rpNow && typeof rpNow === 'object' && this._metricsIv) rpNow.interventions = { ...this._metricsIv };
    if (!this.pipeline) return false;
    if (this._rowHandedOff()) return false;
    if (this._shapeRec) this.state.shapeStats = buildShapeStats(this._shapeRec, this.state.steps);
    try {
      // A paused harness names itself in the saved point (`pausedBy`, written here only, never kept
      // in state): _rowHandedOff reads it back. A resumed run's new harness never writes this token.
      const st = this._pauseToken && rpNow && typeof rpNow === 'object'
        ? { ...this.state, resumePoint: { ...rpNow, pausedBy: this._pauseToken } } : this.state;
      if (this.telemetry) {
        const t0 = performance.now();
        await writeState(this.pipeline.dir, st);
        this.telemetry.persisted(performance.now() - t0, st.steps?.length || 0);
      } else {
        await writeState(this.pipeline.dir, st);
      }
      return true;
    } catch {
      /* persistence is best-effort */
      return false;
    }
  }

  /** True once a PAUSED harness no longer owns its pipeline row. A resume builds a NEW harness on
   *  the same row, and work started here can outlive the pause (the fire-and-forget run title gets
   *  only the stop signal). writeState replaces the row and every step row, so a late write from
   *  this harness would put its paused snapshot over the resumed run: a finished run read `paused`,
   *  with its later steps gone. Owned while the row is still `paused` with THIS pause's token in
   *  its resume point. A token only this harness writes, so its own late writes (a booking, the
   *  title's updatePipelineTitle, the Away mode switch) never read as a takeover; a resumed run
   *  (running, finished, or paused again under its own token) has taken the row over for good. */
  _rowHandedOff() {
    if (!this._pausedHandoff || !this.pipeline?.id) return false;
    if (this._handedOff) return true;
    let row = null;
    try { row = pipelineRowStamp(this.pipeline.id); } catch { return false; }
    this._handedOff = !row || row.status !== 'paused' || row.pausedBy !== this._pauseToken;
    return this._handedOff;
  }

  /**
   * Begin owning this run's row: stamp pid/host + start the heartbeat timer.
   * The CONTROL timer rides the same lifecycle (started with ownership, stopped
   * with it): while this process owns the run it polls the control mailbox for
   * `stop`/`pause` commands written by clients that do NOT hold this
   * orchestrator (#513 — the CLI, later chat/UI for foreign runs). Idempotent.
   */
  _startHeartbeat() {
    if (!this.pipeline?.id) return;
    claimPipelineOwnership(this.pipeline.id);
    if (this._heartbeatTimer) return;
    this._heartbeatTimer = setInterval(() => {
      try { touchHeartbeat(this.pipeline.id); } catch { /* best-effort */ }
    }, HEARTBEAT_INTERVAL_MS);
    this._heartbeatTimer.unref?.(); // never hold the process open
    if (!this._controlTimer) {
      // A command still pending at the moment this process takes ownership was
      // aimed at an earlier incarnation of the run (an unconfirmed `worca stop`
      // whose run was then paused or interrupted another way). Executing it now
      // would stop or pause the run the user just resumed — drop it instead.
      try {
        const stale = discardPendingPipelineCommands(this.pipeline.id);
        if (stale) this._log('orchestrator', 'info', `control: discarded ${stale} stale command(s) from before this run was (re)started`);
      } catch { /* best-effort */ }
      this._controlTimer = setInterval(() => {
        try { this._checkControlSlot(); } catch { /* best-effort: the next tick retries */ }
      }, controlCheckIntervalMs());
      this._controlTimer.unref?.();
    }
  }

  /** Stop heartbeating and drop ownership (terminal/paused). Safe to call repeatedly. */
  _stopHeartbeat() {
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    if (this._controlTimer) { clearInterval(this._controlTimer); this._controlTimer = null; }
    if (this.pipeline?.id) clearPipelineOwnership(this.pipeline.id);
  }

  /**
   * Claim and execute ONE command from the control mailbox. Claiming IS
   * consuming (the guarded UPDATE), so the row is gone whoever acts next; an
   * action whose moment has passed (a `pause` while the run is no longer
   * `running`) is therefore an honest no-op consumption — the issuing client
   * reads the run's status, not the command, for what actually happened. The
   * command's `by` (who issued it) rides into stop()/pause(), so
   * state.lastAction — and every audit that reads it — names the real actor.
   */
  _checkControlSlot() {
    if (!this.pipeline?.id) return;
    // A resume still rehydrating leaves the command pending: stop() and pause() act on a RUNNING
    // run, which this one is only once rehydrated. A later tick executes it.
    if (this._rehydrated === false) return;
    const cmd = claimPipelineCommand(this.pipeline.id);
    if (!cmd) return;
    const by = cmd.by || 'local';
    if (cmd.action === 'stop') {
      this._log('orchestrator', 'info', `control: stop requested by ${by} (via the run-control mailbox)`);
      this.stop(by);
      return;
    }
    if (cmd.action === 'pause') {
      this._log('orchestrator', 'info', `control: pause requested by ${by} (via the run-control mailbox)`);
      this.pause(by);
      return;
    }
    this._log('orchestrator', 'warn', `control: unknown command action "${cmd.action}" — consumed, ignored`);
  }

  // ── Execution environment (plans/e2b-execution-design.md §17–§18) ─────────────────
  // Local is the ABSENCE of all of this: `this.execEnv` stays null, and every method below returns
  // at once on a local run, so a local run's options, state, outcome and resume point gain no key.
  // A remote run asks the registry for its backend; nothing here names a provider.

  /** The backend of a remote run; null on local runs. */
  get _execBackend() { return this.execEnvKind === 'local' ? null : getExecBackend(this.execEnvKind); }
  _execLog(level, msg) { this._log(this.execEnvKind, level, msg); }

  /** Sync: the server's 409 path and the run-start gate. null on local runs. */
  execEnvStartRefusal() {
    const b = this._execBackend;
    if (!b) return null;
    const { errors } = this._execEnvPreflight();
    return errors.length ? `${b.title} execution cannot start: ${errors.join(' ')}` : null;
  }
  /** The generic remote-run checks (policy.mjs) + the backend's own, de-duplicated in order: for e2b, whose
   *  preflight also runs remotePreflight, the result is exactly today's list. */
  _execEnvPreflight() {
    const b = this._execBackend;
    const ctx = { engine: this.claude.engine, isWorkspace: this.isWorkspace, workMode: this.workMode,
      mock: mockEnabled({ mock: this.claude.mock }), brokerOn: brokerEnabled(),
      // this.runRootMode is set only at _setupRunRoot, after the gate; until then the setting decides.
      runRootMode: this.runRootMode || runRootMode(),
      // Set by the gate's async half (_engineChecks), which every start and resume path runs first; until then
      // (undefined) the backend asks for the sign-in.
      needsSignIn: this._codexSignIn };
    const own = b.preflight(ctx);
    return { errors: [...new Set([...remotePreflight({ title: b.title, ...ctx }), ...own.errors])], warnings: own.warnings };
  }
  /** maxConcurrent | maxWaitMin: the backend's user setting, else its capability default. 0 on a local run. */
  _execEnvLimit(which) { return this._execBackend ? execEnvLimit(this._execBackend, which) : 0; }
  _execEnvMaxWaitMs() { return this._execEnvLimit('maxWaitMin') * 60_000; }
  _openExecClient() { return this._execBackend.open({ mock: mockEnabled({ mock: this.claude.mock }) }); }

  /** After setup (worktree, context, memory, engine config): one sandbox for this run. */
  async _startExecEnv() {
    const b = this._execBackend;
    if (!b) return;
    for (const w of this._execEnvPreflight().warnings) this._execLog('warn', w);
    const maxWait = this._execEnvLimit('maxWaitMin');
    const grace = effectiveNightConfig(this.projectDir)?.config?.graceMinutes;
    if (Number.isFinite(grace) && grace >= maxWait) {
      this._execLog('warn', `Away mode answers after ${grace} min, but an ${b.label} waits at most ${maxWait} min for an answer; lower the Away grace or raise "Max wait for an answer".`);
    }
    const client = await this._openExecClient();
    // Which environment (template) the sandbox starts from, and whether its build is stale: never blocks.
    const target = resolveRunEnvironment(b, this.members[0].projectKey);
    for (const n of target.notes) this._execLog(n.level, n.text);
    const signal = AbortSignal.any([this.abort.signal, this.pauseAbort.signal]);
    try {
      this._execEnvRelease = await acquireSandboxSlot({
        pool: b.name, cap: this._execEnvLimit('maxConcurrent'), signal,
        countRunning: client.countRunning ? () => client.countRunning() : null,
        onWait: ({ cap }) => {
          this.state.execEnvWaiting = true;
          this._execLog('info', `waiting for an ${b.label} slot (${cap} of ${cap} in use)`);
          this._emit('state', this.getState());
        },
      });
    } finally {
      // Also on a stop/pause while queued: a stopped or paused run must not keep showing "waiting".
      if (this.state.execEnvWaiting) { delete this.state.execEnvWaiting; this._emit('state', this.getState()); }
    }
    const env = new RemoteExecEnv(this._execEnvOpts(client, target));
    try { await env.start(); }
    catch (err) {
      await env.close('start failed').catch(() => {});
      this._releaseExecEnvSlot();
      throw markTerminal(err instanceof ExecEnvLostError ? err : new Error(`${b.label} setup failed: ${err?.message || err}`, { cause: err }));
    }
    this.execEnv = env;
    this.state.execEnvSandbox = env.sandboxId;
    this._execLog('info', `agents and scripts run in ${b.label} ${env.sandboxId} (${b.environmentNoun} ${target.name} from ${target.from}${client.describe ? `, ${client.describe()}` : ''})`);
    await this._buildSandboxGraph();
    await this._persist(); this._emit('state', this.getState());
  }
  /** `target`: resolveRunEnvironment's { name, buildId, rebuild }; a reconnect starts nothing, so it has no name or build. */
  _execEnvOpts(client, target) {
    const m = this.members[0];
    const paths = artifactPaths(this.projectDir, this.workspaceKey);
    const entries = this.injectedPaths?.[m.projectKey] || [];
    return { backend: this._execBackend, client, environment: target?.name ?? null, environmentBuild: target?.buildId ?? null,
      rebuildHint: target?.rebuild,
      worktreeDir: this.workDirs.get(m.projectKey), pipelineDir: this.pipeline.dir,
      storeRoots: [paths.plans, paths.reviews], mcpConfigPath: this.mcpConfigPath,
      // §8.8 injected paths (memory mount, skills); the code graph is built in the sandbox instead. Engine config files
      // (Cursor's .cursor/*.json) are not overlaid at start: the adapter mirrors them per spawn (syncEngineFiles), which
      // also removes the ones it no longer writes and hides them from the sandbox clone's git.
      injected: entries.filter((e) => e.kind !== 'engineConfig').map((e) => e.path).filter(Boolean),
      // Re-uploaded when the host changes them mid-run: the memory rules mount (refreshMount), self-ignoring.
      refreshPaths: entries.filter((e) => e.kind === MEMORY_INJECTED_ENTRY.kind).map((e) => e.path),
      // Kept out of the sync tree: the same entries _excludePathspecs keeps out of the host's staging. Not Cursor's
      // engine files: syncEngineFiles' info/exclude line keeps worca's own out of the patch, and a .cursor file the
      // project tracks (registered on every Cursor run) must still bring the agent's edits home.
      syncExcludes: entries.filter((e) => e?.path && e.kind !== 'claudeMdSection' && e.kind !== 'engineConfig').map((e) => e.path),
      // The run-root CLAUDE.md sits above the worktree; Claude Code loads it from a parent dir.
      supportFiles: [...SCRIPT_SUPPORT_FILES, ...(this.runRoot ? [join(this.runRoot, 'CLAUDE.md')] : [])],
      metadata: { worca: '1', worcaInstance: instanceTag(worcaHome()), worcaRunId: this.pipeline.id, worcaProject: m.projectKey },
      // Untracked and changed files matching these stay on this machine (secret-paths.mjs); the project adds its own.
      secretPaths: secretPathsFor({ secretPaths: resolveSetting('secretPaths', { projectDir: this.projectDir, projectKey: m.projectKey }).value }),
      // The sandbox's outbound network: null (open) unless the project's E2B egress setting is `allow`.
      network: target?.network ?? null,
      scratchDir: this._execEnvScratchDir(),
      // The `.mcp.json` approvals a Claude spawn applies (orchestrator mcpjsonProjectDir); a workspace uses the worktree.
      mcpjsonProjectDir: this.isWorkspace ? null : this.projectDir,
      log: (level, msg) => this._execLog(level, msg),
      // Files from the sandbox that only a person runs later (npm scripts, VS Code tasks): the run page lists them.
      onReview: (items) => {
        const have = Array.isArray(this.state.execEnvReview) ? this.state.execEnvReview : [];
        const add = items.filter((i) => !have.some((h) => h.path === i.path)).map(({ path, why }) => ({ path, why }));
        if (!add.length) return;
        this.state.execEnvReview = [...have, ...add];
        this._emit('state', this.getState());
      },
      onMaxWait: () => this._execEnvMaxWaitReached(),
      // The run page's "answer by" line: when the parked sandbox is released if the question stays open.
      onPark: (until) => {
        if (until) this.state.execEnvWaitUntil = new Date(until).toISOString();
        else if (!Object.hasOwn(this.state, 'execEnvWaitUntil')) return;
        else delete this.state.execEnvWaitUntil;
        this._emit('state', this.getState());
      } };
  }
  _execEnvScratchDir() { return join(worcaHome(), 'tmp', this.execEnvKind, this.pipeline.id); }
  _releaseExecEnvSlot() { const r = this._execEnvRelease; this._execEnvRelease = null; r?.(); }

  /** done / stopped / error, from the finally: free the sandbox and the slot (the files and code
   *  came home after every spawn and in _buildResults). */
  async _finishExecEnv() {
    const ee = this.execEnv;
    // A resumed run that ended before (or while) reconnecting still owns its parked sandbox.
    if (!ee) { await this._dropSavedSandbox(); this._releaseExecEnvSlot(); return; }
    try { if (!ee.lost && !ee.syncFailure) await ee.syncBack(); }
    catch (err) { this._execLog('error', `final sync failed: ${err?.message || err}`); }
    finally { await ee.close('run ended').catch(() => {}); this._releaseExecEnvSlot(); }
  }

  /** The parked sandbox of a resume point this run never reconnected to (stop from paused, a resume
   *  that failed): killed, and its host scratch dir removed. */
  async _dropSavedSandbox() {
    const id = this._savedExecEnv?.sandboxId;
    if (!id || this.execEnv) return;
    // The saved record names its own backend.
    let b = null; try { b = getExecBackend(this._savedExecEnv.kind || this.execEnvKind); } catch { return; }
    const client = await Promise.resolve().then(() => b.open({ mock: mockEnabled({ mock: this.claude.mock }) })).catch(() => null);
    await client?.remove(id).catch(() => {});
    if (this.pipeline?.id) await rm(this._execEnvScratchDir(), { recursive: true, force: true }).catch(() => {});
  }

  /** paused / drain: sync, then let the provider keep it for the backend's max wait (clarify: long-wait-policy). */
  async _parkExecEnv() {
    const ee = this.execEnv;
    if (!ee || ee.lost) { this._releaseExecEnvSlot(); return; }
    if (this._execEnvReleaseOnPark) {
      // The max wait ran out (_execEnvMaxWaitReached): bring the last files home, release the sandbox, and leave a
      // resume point without a sandbox id, so the resume starts a fresh one.
      this._execEnvReleaseOnPark = false;
      try { await ee.syncBack(); }
      catch (err) { this._execLog('warn', `syncing the sandbox before releasing it failed: ${err?.message || err}`); }
      await ee.close('max wait reached').catch(() => {});
      if (this.state.resumePoint) this.state.resumePoint.execEnv = { kind: this.execEnvKind };
      this._releaseExecEnvSlot();
      return;
    }
    // Park whatever the sync did: an unparked sandbox's heartbeat would renew it for as long as the
    // server runs. A patch that did not apply is kept in the pipeline dir; the resume fails on it.
    try { await ee.syncBack(); }
    catch (err) { this._execLog('error', `syncing the sandbox before the pause failed: ${err?.message || err}`); }
    try { await ee.park(this._execEnvMaxWaitMs()); }
    catch (err) { this._execLog('warn', `parking the sandbox failed: ${err?.message || err}`); }
    if (this.state.resumePoint) this.state.resumePoint.execEnv = ee.resumeRecord();   // syncedTree moved
    this._releaseExecEnvSlot();        // the in-process count; the provider's running count still sees it
  }

  /** Resume: reconnect to the parked sandbox, or fail cleanly (clarify: sandbox-loss). The
   *  preflight refusal already ran before the row was claimed. */
  async _resumeExecEnv() {
    const b = this._execBackend;
    if (!b) return;
    const record = this._savedExecEnv;
    if (!record?.sandboxId) { await this._startExecEnv(); return; }   // paused before the sandbox existed
    const client = await this._openExecClient();
    this._execEnvRelease = await acquireSandboxSlot({ pool: b.name, cap: this._execEnvLimit('maxConcurrent'), force: true });
    const { rebuild } = resolveRunEnvironment(b, this.members[0].projectKey);
    try { this.execEnv = await RemoteExecEnv.reconnect(record, this._execEnvOpts(client, { name: null, rebuild })); }
    catch (err) {
      this._releaseExecEnvSlot();
      if (err?.sandboxGone) {
        // The parked sandbox ended (its max wait, a provider restart): every finished step is already home, so
        // continue in a fresh one. A step whose agent session lived in the old sandbox re-runs fresh.
        this._execLog('warn', `sandbox ${record.sandboxId} is gone (${firstLine(err.message)}); starting a fresh ${b.label} from the work so far`);
        await appendAudit(this.pipeline.dir, `Resume: the ${b.label} ${record.sandboxId} was gone; continued in a fresh one.`).catch(() => {});
        await this._startExecEnv();
        return;
      }
      throw markTerminal(err instanceof ExecEnvLostError || err instanceof ExecEnvSyncError ? err
        : new ExecEnvLostError(`The run's ${b.label} could not be resumed (${err?.message || err}); it may have outlived the ${this._execEnvLimit('maxWaitMin')}-minute wait. ${LOST_HINT}`, { cause: err }));
    }
    // The project's environment was built or changed while the run was paused: the reconnect brought the work
    // home, so continue in a fresh sandbox from the new one. A record without `environment` predates this check.
    const target = record.environment ? resolveRunEnvironment(b, this.members[0].projectKey) : null;
    const was = (name, build) => `${name}${build ? ` (build ${build})` : ''}`;
    if (target && (target.name !== record.environment || (target.buildId || null) !== (record.environmentBuild || null))) {
      const change = `${was(record.environment, record.environmentBuild)} → ${was(target.name, target.buildId)}`;
      this._execLog('info', `the run's ${b.environmentNoun} changed while it was paused (${change}); replacing sandbox ${record.sandboxId} with a fresh ${b.label}`);
      await appendAudit(this.pipeline.dir, `Resume: the ${b.environmentNoun} changed (${change}); continued in a fresh ${b.label}.`).catch(() => {});
      const old = this.execEnv; this.execEnv = null;
      await old.close('environment changed').catch(() => {});
      this._releaseExecEnvSlot();
      await this._startExecEnv();
      return;
    }
    this.state.execEnvSandbox = this.execEnv.sandboxId;
  }

  /** The ask outlived the backend's max wait while the sandbox was parked (the provider ends it at the same time).
   *  The run PAUSES instead of failing: a parked sandbox runs nothing, every finished step is already home, and a
   *  resume starts a fresh sandbox from that work (a step whose agent session was in the old sandbox re-runs fresh).
   *  The sandbox is released by _parkExecEnv once the pause has unwound, so no in-flight catch sees it lost. */
  _execEnvMaxWaitReached() {
    const ee = this.execEnv; const pq = this.pendingQuestion;
    const ms = this._execEnvMaxWaitMs();
    const label = this._execBackend.label;
    if (!pq) {
      // Nothing waits any more (answered as the timer fired): release it the old way.
      if (ee && !ee.lost) ee.lost = new ExecEnvLostError(`No answer within ${Math.round(ms / 60_000)} min: the run's ${label} was released. ${LOST_HINT}`);
      ee?.close('max wait reached').catch(() => {});
      return;
    }
    const detail = `No answer within ${Math.round(ms / 60_000)} min: the run's ${label} was released to free its slot. Resume continues in a fresh ${label} from the work so far.`;
    this._execEnvReleaseOnPark = true;
    this._pauseFor(REASON.ERROR, new Error(detail), { detail });
    this.pause();
  }

  /** Terminal bookkeeping for a pause: persist the resume point + paused status.
   *  An ERROR-pause additionally keeps what the retired error path produced — the
   *  diff artifact and the task-source write-back (statusToResult('paused') ->
   *  'needs-human'; retryWriteback re-reads the ROW, so this runs AFTER the persist).
   *  Safe here and only here: the checkout and the checkpoint refs are live, and the
   *  finally never tears a paused run down. Both helpers are no-ops with an empty
   *  workDirs (a setup-phase pause). */
  async _completePaused() {
    // §10: MCP run.json writes queued before the pause land first: the run log is still open, and
    // a resume reads run.json before its assembly rewrites it. The chain closes here too: an agent
    // still streaming after the pause must not write run.json behind a resume (a resume always
    // builds a new orchestrator, so this one never dispatches again).
    this._mcpClosed = true;
    await this._mcpTail;
    // D7: a pause that landed BEFORE run()'s setup finished (a converted setup failure,
    // or a user pause racing one — run()'s pause branch catches a plain error while
    // 'pausing') must replay that setup on resume; a completed setup never leaves a
    // stale stamp behind (resume() re-arms the consumed point, which may carry one).
    const rp = this.state.resumePoint;
    // ABOVE the `if (rp …)` — a pause counts whether or not the engine produced a resume point.
    this._metricsIv.pauses += 1;
    this._metricsIv.pausedAt = new Date().toISOString();   // resume() measures the parked time from here
    this._metricsIv.lastPauseReason = this.pauseReason || null;
    // _setPauseReason (run-harness.mjs:820) always stores a string or null.
    this._metricsIv.lastPauseDetail = this.pauseDetail == null ? null : String(this.pauseDetail).slice(0, 400);
    if (rp && typeof rp === 'object') {
      if (this._setupDone) { delete rp.setupIncomplete; delete rp.titleProvisional; }
      else {
        rp.setupIncomplete = true;
        // Whether run() ever kicked the LLM title off (it does so right after the run
        // root exists): the replay reads this to finish the job, since the flag is
        // not a row column.
        rp.titleProvisional = this.state.titleProvisional === true;
      }
      rp.interventions = { ...this._metricsIv };
      // Who paused it survives a restart (rowToState reads it back).
      if (this.state.lastAction && this.state.lastAction.kind === 'pause') rp.lastAction = { ...this.state.lastAction };
      else delete rp.lastAction;
      // B3: a drained run is resumed on the next start as whoever last resumed it (else its
      // starter, pipelines.started_by), so the billing and attribution stay theirs.
      if (this.pauseReason === REASON.DRAIN && this._drainResumeAs) rp.resumeAs = this._drainResumeAs;
      else delete rp.resumeAs;
      // D3/D7: only a usage-limit pause carries a reset time and the automatic-resume streak (like
      // resumeAs for drain). Any other pause deletes both, so a point rebuilt from the consumed one
      // (_pauseForFailure's ...source, the re-arm at :1903) never keeps a stale value.
      if (this.pauseReason === REASON.USAGE_LIMIT && this.limitResetAt) rp.limitResetAt = this.limitResetAt;
      else delete rp.limitResetAt;
      if (this.pauseReason === REASON.USAGE_LIMIT && this._autoLimitResumes > 0) rp.autoLimitResumes = this._autoLimitResumes;
      else delete rp.autoLimitResumes;
      // The token this pause is written with (_persist stamps it into the saved point as `pausedBy`).
      this._pauseToken ||= randomUUID();
    }
    this._setStatus('paused');
    await this._parkExecEnv();   // remote: sync, then the sandbox waits (held) for a resume
    const persisted = await this._persist();
    // From here a resume may build a new harness on this row: a late write from this one (the run
    // title outlives a pause) checks the row is still its own first (_rowHandedOff). Only once the
    // row carries this pause's token: a failed write left the row running, and a point-less pause
    // cannot be resumed by anyone else.
    if (persisted && this._pauseToken) this._pausedHandoff = true;
    // A plain manual pause has no reason; every reasoned pause audited at its site.
    if (!this.pauseReason) await this._auditAction('pause', 'Pipeline **paused**').catch(() => {});
    // A FORCED pause (pauseReason set: usage limit, cost cap, auto-mode
    // auth/quota, exhausted recoverable retries, an error) parks the run with
    // nobody attached, so the task source must hear it NOW — statusToResult
    // ('paused') -> 'needs-human' — or the external task stays claimed "in
    // progress" until a human stumbles on it. A manual pause skips this: the
    // user is present and resuming shortly, and the resumed run's terminal path
    // reports the real outcome. An ERROR-pause additionally keeps the diff
    // artifact the retired error path produced. Never throws (spec §7.5).
    const consequences = pauseConsequences(this.pauseReason);
    if (consequences.stagesResults) await this._buildResults({ stage: true });
    if (consequences.reportsToSource) await this._reportToSource();
    const payload = {
      status: 'paused',
      pipelineDir: this.pipeline.dir,
      reason: this.pauseReason || null,
      detail: this.pauseDetail || null,
      limitEngine: this.limitEngine || null,
      limitResetAt: this.limitResetAt || null,
    };
    this._emit('done', payload);
    return { ...payload };
  }

  /** Engine hook (optional): the LAST clean graph point the engine holds — the final
   *  all-terminal snapshot after a completed run, the last clean one mid-run. The
   *  failure fallback prefers it over the pre-dispatch point so a failure AFTER the
   *  engine finished never re-runs the graph (D14). Base engines: none. */
  _engineLastPoint() { return null; }

  /** Engine hook (optional, stopPaused): credit the executions a pause parked (`keys`, their ledger
   *  keys) at the stop that ends them for good, while the checkouts are still live. Base engines: none. */
  async _engineCreditParked(_rp, _keys) {}

  /** Engine hook (optional): the run's distinct agent keys from the frozen manifest —
   *  what the skills gate needs on a setup replay (D7). Base engines: none. */
  _engineAgentKeys() { return new Set(); }

  /**
   * The SETUP / SHELL / RESUME site (failure-policy.mjs): a failure the shell sees
   * once the pipeline row exists — before run()'s setup finished ('setup'), after it
   * ('shell'), or before resume() rehydrated the paused run ('resume', where the
   * only verdict that can be enacted is to end the run: the point on disk is
   * already the best the run can offer). A verdict already issued downstream (a terminal error from the node
   * or flow site) is enacted, never re-decided. Returns null when the verdict is a
   * terminal error — the caller then falls through to the error path — else records
   * the cause; kills anything still in flight (pause() is a no-op unless the run is
   * 'running', and the status write below is unconditional); picks the resume
   * point MOST-SPECIFIC FIRST — state.resumePoint (the engine's live point), the
   * engine's LAST clean point (the final all-terminal snapshot when the failure
   * came after the engine finished, D14), the consumed `fallbackPoint` (resume()'s
   * rp), else the engine's pre-dispatch point; scrubs any terminal error row (and
   * the fail-fast's skipped collateral) out of its snapshot; then completes as a
   * pause — _completePaused stamps/strips `setupIncomplete` from _setupDone (D7)
   * for EVERY pause path. Emits NO 'error' event: the `done` payload carries the
   * reason + detail, the run log the line.
   */
  async _pauseForFailure(err, fallbackPoint = null) {
    const site = !this._rehydrated ? 'resume' : this._setupDone ? 'shell' : 'setup';
    const verdict = isTerminal(err) ? { outcome: 'error' }
      : resolveFailure({ site, cls: classifyError(err), auto: this.auto });
    if (verdict.outcome !== 'pause') { markTerminal(err); return null; }
    this._pauseFor(verdict.reason, err);
    const source = this.state.resumePoint || this._engineLastPoint() || fallbackPoint || this._enginePrePausePoint();
    this.state.resumePoint = {
      ...source,
      snapshot: scrubErrorRows(source.snapshot ?? null),
      pauseReason: this.pauseReason,
      pauseDetail: this.pauseDetail,
      ...(this.limitEngine ? { limitEngine: this.limitEngine } : {}),
      pausedAt: new Date().toISOString(),
    };
    return await this._completePaused();
  }

  /** The LAUNCH site: no pipeline row yet, so a terminal error is the only verdict
   *  the shell can enact. Consulted for completeness — a row flipped to 'pause'
   *  cannot be honored here and says so in the run log. */
  _launchVerdict(err) {
    const verdict = resolveFailure({ site: 'launch', cls: classifyError(err), auto: this.auto });
    if (verdict.outcome !== 'error') {
      this._log('orchestrator', 'warn', `failure policy asks to ${verdict.outcome} a launch failure, but no pipeline row exists to resume into — ending the run as an error`);
    }
    markTerminal(err);
  }

  /**
   * resume() of a point whose run() never finished its setup (D7) — run()'s steps
   * 3..3e in order, abort-checked, each guarded so a step that DID complete is not
   * redone. Returns the resolved skill map for the detached assembly.
   * @returns {Promise<Map>} resolvedSkills
   */
  async _replaySetup() {
    // 3) checkpoint. P5: a workspace re-checkpoints only when its first GIT member lacks a ref (a Folder primary has
    // none, ever) — the primary's own ref on an all-git workspace, so all-git runs replay exactly as before.
    const firstGit = this.isWorkspace ? this.members.find((m) => this._memberWorkMode(m.projectKey) === 'git') : null;
    if (this.isWorkspace) {
      if (firstGit && !this.checkpointRefs[firstGit.projectKey]) await this._ensureGitCheckpointAll();
    } else if (!this.checkpointRef) {
      await this._ensureGitCheckpoint();
    } else {
      const onlyKey = this.members[0]?.projectKey;
      if (onlyKey && !this.checkpointRefs[onlyKey]) {
        this.checkpointRefs[onlyKey] = this.checkpointRef;
        this.state.checkpointRefs = { ...this.checkpointRefs };
      }
    }
    // The preflight bookend stays open through the replay: resume() reopened it
    // before the replay and closes it (_endPreflight) once the replay returns.
    this._checkAbort();
    // 3b) run root + worktrees — keyed on the per-member map, NEVER on this.workDir
    //     (it defaults to projectDir and is never falsy).
    const missing = this.members.some((m) => !this.workDirs.get(m.projectKey));
    if (missing) {
      if (this.workMode === 'git') this._setupStage('Creating the worktree');
      await this._setupRunRoot({ replay: true });
    }
    // run() kicks the LLM title off once runCwd exists; a run that paused before
    // that point still carries its provisional title, so kick it off now. A run
    // that got past it already holds the generated row.title (loaded by resume()).
    if (this.state.titleProvisional) this._kickoffTitleGeneration();
    this._checkAbort();
    // 3c) graph build (fail-safe, idempotent)
    this._setupStage('Building the knowledge graph');
    if (this.isWorkspace) await this._buildWorktreeGraphAll(); else await this._buildWorktreeGraph();
    this._checkAbort();
    this._setupStage('Preparing the agents');
    // 3d) the skills gate + legacy injection — run()'s block, agent keys from the frozen manifest
    const requiredSkills = collectRequiredSkills(this.registry, this._engineAgentKeys());
    let resolvedSkills = new Map();
    if (requiredSkills.length) {
      const skillCtx = { repoRoot: REPO_ROOT, projectDir: this.projectDir, pluginDirs: pluginSkillDirs() };
      resolvedSkills = validateSkills(requiredSkills, skillCtx);   // throws => caught => the run PAUSES again
      if (this.runRootMode !== 'detached') {
        const candidates = this.isWorkspace ? [...this.workDirs.values()] : [this.workDir];
        const worktrees = candidates.filter((d) => d && d !== this.projectDir);
        const injected = await injectSkills(resolvedSkills, { targets: worktrees });
        if (injected.length) {
          await appendAudit(this.pipeline.dir, `Skills: injected ${injected.join(', ')} into ${worktrees.length} worktree(s).`);
        }
      }
    }
    this._checkAbort();
    // 3d-bis) declared assets — run()'s block, same reason it exists there. The
    // skills gate alone is not enough: a run that paused during setup and is
    // resumed would reach an agent whose `requiresAssets` folder was never
    // staged, and the agent's "copy it from the run folder" instruction would
    // have nothing to copy. stageAssets overwrites by design, so replaying it is
    // both safe and the point (the shipped asset is canonical).
    const requiredAssets = collectRequiredAssets(this.registry, this._engineAgentKeys());
    if (requiredAssets.length) {
      const staged = await stageAssets(requiredAssets, { root: REPO_ROOT, target: this.pipeline.dir, pluginDirs: pluginAssetDirs() });
      await appendAudit(this.pipeline.dir, `Assets: staged ${staged.join(', ')} into the run folder.`);
    }
    this._checkAbort();
    await appendAudit(this.pipeline.dir, 'Setup replayed on resume (the paused run never finished it).').catch(() => {});
    return resolvedSkills;
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

  /** Decide the run's topology AFTER the run row + run root exist (the Auto
   *  workflow). run() calls it with no argument and REPLACES the bootstrap
   *  manifest with a non-null return (the same bag as _resolveTopology); resume()
   *  calls it with `{ resume: rp }` before the setup replay. null keeps what
   *  _resolveTopology produced (every saved workflow). */
  async _decideTopology(_o = {}) { return null; }

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

  /** Preflight/Done are ledger rows like any other execution: keyed
   *  `x:<name>:1`, agentKey null, excluded from progress and execution counts by
   *  the readers (run-decor's ledgerRows, cli/render's summary). */
  _bookend(name, status) {
    const executionId = `x:${name}:1`;
    // _recordStep keys on `cycle ? phase#cycle : phase`, so pass cycle 0 to get
    // the executionId VERBATIM as the ledger key, then stamp the exec columns.
    // `executionId` is NOT optional: artifacts.mjs persists execution_id from it,
    // and without it a REHYDRATED run stops filtering the bookends.
    this._recordStep(executionId, 0, status, name);
    const row = this.state.steps.find((s) => s.key === executionId);
    if (row) {
      Object.assign(row, {
        executionId, nodeId: name, phase: null, cycle: 1, kind: 'cycle', ordinal: 1,
        agentKey: null, stepIndex: null, trigger: { wireIds: [], freshPorts: [] },
      });
    }
    this.state.updatedAt = new Date().toISOString();
    this._emit('exec', {
      nodeId: name, executionId, kind: 'cycle', ordinal: 1, status,
      agentKey: null, trigger: { wireIds: [], freshPorts: [] },
    });
    this._emit('state', this.getState());
    this._persist().catch(() => {});
  }

  /** The Sync stage row (x:sync:1) opens lazily — an all-up-to-date run shows none (plan D6).
   *  It can only open once the fetch has answered, so charge the fetch to it: backdate the row
   *  to `startedAtMs` and take that time back off preflight, which _recordStep('start') just
   *  paused (it folds the elapsed time into preflight's activeMs). */
  _openSyncStage(startedAtMs) {
    if (this._syncStageOpen) return;
    this._syncStageOpen = true;
    this._bookend('sync', 'start');
    const row = this.state.steps.find((s) => s.key === SYNC_EXECUTION_ID);
    const pre = this.state.steps.find((s) => s.key === 'x:preflight:1');
    if (row && Number.isFinite(startedAtMs) && row.runningSince != null) {
      const spent = Math.max(0, row.runningSince - startedAtMs);
      row.startedAt = new Date(startedAtMs).toISOString();
      row.runningSince = startedAtMs;
      if (pre) pre.activeMs = Math.max(0, (pre.activeMs || 0) - spent);
      this.state.totalActiveMs = sumStepActive(this.state.steps);
    }
  }

  /** Close the Sync row and hand the active-time clock back to the still-open preflight —
   *  test/orchestrator-graph.test.mjs pins that preflight ticks through all of setup.
   *  Resume FIRST: _bookend emits `state` itself, and that emit must already show
   *  preflight running (_recordStep('done') pauses only the sync key). */
  _closeSyncStage() {
    if (!this._syncStageOpen) return;
    this._syncStageOpen = false;
    const pre = this.state.steps.find((s) => s.key === 'x:preflight:1');
    if (pre && pre.status === 'start') this._clockResume('x:preflight:1');
    this._bookend('sync', this._syncStageFailed ? 'error' : 'done');
  }

  /** The start a paused setup recorded for `key` before its createWorktree failed (replay only):
   *  a member record with no worktreeDir. Single-project runs read the persisted state.branch. */
  _pendingStart(key) {
    const b = (this.state.branches && this.state.branches[key]) || (!this.isWorkspace ? this.state.branch : null);
    return b && typeof b === 'object' && !b.worktreeDir && b.source ? b : null;
  }

  /** The diff base of a reused feature branch (see reusedBranchBase): measured against the remote the
   *  sync used (its record), else the member's configured sync remote (default origin) — even with
   *  sync off: the remote-tracking ref is read, never fetched. A replay keeps the first attempt's
   *  recorded answer: nothing was fetched since, and on a resume opts.sync is absent, so memberFor()
   *  would default the remote to origin. */
  async _reusedBranchBase(m, source, featureRaw, pending = null, syncRecord = null) {
    // Only for the SAME planned name — the rule willReuse already follows for pending.reuse.
    if (pending && pending.diffBase && pending.plannedFeature === sanitizeBranchName(featureRaw)) {
      return { sha: pending.diffBase, against: pending.diffBaseFrom || source };
    }
    return reusedBranchBase(resolve(m.projectDir), {
      feature: sanitizeBranchName(featureRaw), source,
      remote: syncRecord?.remote || this.syncOpts.memberFor(m.projectKey).remote,
    });
  }

  /** A remote-only source (picked from the Remote only group / proposed by Ask) becomes a local
   *  tracking branch before anything resolves or validates it (C14). Never on a read-only scan
   *  or a memory-defrag run. Records the created branch's sha for the diff-base move (D17). */
  async _ensureLocalSource(m, name, { replay = false } = {}) {
    if (!name || !isSafeBranchName(name) || this._isWorkspaceScan() || this.memoryScope) return;
    const cfg = this.syncOpts.memberFor(m.projectKey);
    const remote = cfg.remote;
    const dir = resolve(m.projectDir);
    let c = await ensureLocalBranch(dir, { base: name, remote });
    // A scheduled start skips the server's pre-check, so a source pushed after the last fetch
    // is not in the refs yet and a workspace member would silently fall back to its default
    // branch. With sync on for this member (never on a replay), fetch once and retry.
    // maxAgeMs 0: the TTL would skip exactly the fetch this exists for when the background
    // refresh or an Ask call fetched moments before the push. It runs only on a miss.
    if (!c.ok && c.kind === 'missing' && cfg.enabled && !replay) {
      await fetchRemote(dir, { remote, maxAgeMs: 0, timeoutMs: INTERACTIVE_TIMEOUT_MS });
      c = await ensureLocalBranch(dir, { base: name, remote });
    }
    if (!(c.ok && c.created)) return;
    this._createdSources.set(m.projectKey, c.to);
    this._log('sync', 'info', `${m.projectKey}: created local ${name} tracking ${remote}/${name}`);
    await appendAudit(this.pipeline.dir, `Created local \`${name}\` in \`${m.projectKey}\` from \`${remote}/${name}\` (\`${String(c.to).slice(0, 10)}\`).`).catch(() => {});
  }

  /** Shaper s5 (D14): merge the feature's base into this run's fresh branch when it moved; move the diff base to the
   *  merge commit, so the base's commits never count as this run's changes. */
  async _mergeFeatureBase(m, info, sl) {
    let base = null;
    try { base = featureBase(sl.feature); } catch { base = null; }
    if (!base || base === info.branch) return;
    const r = await mergeBaseBeforeRun(resolve(m.projectDir), { base, feature: info.branch })
      .catch((err) => ({ merged: false, status: 'error', behind: 0, files: [], error: err?.message }));
    const line = baseMovedAudit(base, info.branch, r);
    if (line) await appendAudit(this.pipeline.dir, line).catch(() => {});
    if (r.merged && r.to) {
      const rec = this.state.branches[m.projectKey];
      this.state.branches[m.projectKey] = { ...rec, baseSha: r.to, diffBase: r.to, baseMerged: { base, behind: r.behind } };
      this.checkpointRefs[m.projectKey] = r.to;     // dev's commits are never this run's changes
    }
  }

  /**
   * Bring member `m`'s base up to date before its worktree exists. Returns
   * { startRef?, record? }; throws a TERMINAL error only for a diverged base under
   * onDiverged 'fail' (never a pause: resuming cannot fix a divergence).
   * Never on a replay/resume, a read-only scan, or a memory-defrag run.
   */
  async _syncMemberBase(m, source, { replay = false, fellBack = false, sameAsSource = false } = {}) {
    const cfg = this.syncOpts.memberFor(m.projectKey);
    if (!cfg.enabled || replay || this._isWorkspaceScan() || this.memoryScope) return {};
    const attr = { nodeId: 'sync', executionId: SYNC_EXECUTION_ID };
    const prefix = this.isWorkspace ? `${m.projectKey}: ` : '';
    // Say why a member is not synced. A workspace member whose named source exists nowhere
    // falls back to its default branch (_resolveMemberBranches); the interactive pre-check looked
    // at the NAMED branch, so syncing the fallback could fail a run nobody was asked about.
    if (fellBack || !isSafeBranchName(source)) {
      this._log('sync', 'info', `${prefix}not syncing ${JSON.stringify(String(source))}: ${fellBack ? 'the named source branch does not exist, so this is a fallback' : 'not a plain branch name'}`, attr);
      return {};
    }
    // isSafeBranchName rejects only full SHAs. A tag or short SHA resolves without being a
    // local branch: never sync it (no fetch, no record, no audit line). A name that resolves
    // to NOTHING still goes on: the Sync fetch may create it ('created').
    const mdir = resolve(m.projectDir);
    if (!(await listLocalBranches(mdir)).includes(source) && (await isValidSourceRef(mdir, source))) {
      this._log('sync', 'info', `${prefix}not syncing ${JSON.stringify(String(source))}: a tag or commit, not a branch`, attr);
      return {};
    }
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    // Members sync concurrently (mapWithCap): restore the previous stage label only when the
    // LAST in-flight sync finishes, so the status line never sticks on "Syncing…".
    if (this._syncing === 0) this._stageBeforeSync = this.state.setupStage || null;
    this._syncing += 1;
    this._setupStage('Syncing the base branch');
    let r;
    try {
      r = await syncBaseForRun(mdir, {
        base: source, remote: cfg.remote, timeoutMs: this.syncOpts.timeoutMs, onDiverged: cfg.onDiverged });
    } finally {
      this._syncing -= 1;
      if (this._syncing === 0) this._setupStage(this._stageBeforeSync);
    }
    // A project with no such remote has nothing to sync (beforeRun defaults to true, so this is
    // every run of a local-only project): no record, no audit line, no Sync row.
    if (r.result === 'skipped' && (r.reason === 'no-remote' || r.reason === 'bad-remote')) return {};
    const quiet = r.result === 'skipped' || r.result === 'up-to-date' || r.result === 'no-upstream';
    if (!quiet) this._openSyncStage(startedAtMs);
    if (r.result === 'diverged') this._syncStageFailed = true;
    for (const line of r.log) this._log('sync', r.result === 'fetch-failed' || r.result === 'diverged' ? 'warn' : 'info', `${prefix}${line}`, attr);
    const record = {
      result: r.result, ...(r.reason ? { reason: r.reason } : {}), remote: cfg.remote,
      from: r.from || null, to: r.to || null, remoteSha: r.remoteSha || null,   // remote tip at start (resume / Ship-it measure from it)
      commits: r.commits || 0, ahead: r.ahead || 0, behind: r.behind || 0,
      stale: !!r.stale, fetchedAt: r.fetch?.fetchedAt || null, ...(r.fetch && !r.fetch.ok ? { fetchError: r.fetch.kind } : {}),
      policy: cfg.onDiverged, policySource: cfg.policySource,
      startedAt, endedAt: new Date().toISOString(), log: r.log.slice(0, 20),
    };
    await appendAudit(this.pipeline.dir, `Sync \`${m.projectKey}\`: ${source} ${r.result}${r.reason ? ` (${r.reason})` : ''}` +
      `${r.commits ? `, ${r.commits} commit(s)` : ''}${r.to ? ` → \`${String(r.to).slice(0, 10)}\`` : ''}` +
      ` (onDiverged ${cfg.onDiverged}, from ${cfg.policySource}).`).catch(() => {});
    // Run on the source branch: the run fast-forwards `source` onto its own work at the end, so it must
    // START from `source` itself, brought up to date. A diverged base (either policy) or a remote start
    // (dirty checkout, a checkout in another worktree, onDiverged 'origin') leaves `source` behind —
    // refuse now (terminal: resuming never syncs) instead of a merge back that cannot work. Before the
    // diverged block, so its "choose Start from origin" advice never reaches such a run.
    if (sameAsSource && (r.result === 'diverged' || r.startRef)) {
      this._syncStageFailed = true;
      const why = r.reason || r.result;
      // No worktreeDir: previousBranchesOf never waits on this record (D9).
      this.state.branches[m.projectKey] = { source, sync: record, sameAsSource: true };
      const fix = why === 'dirty' ? `commit or stash the uncommitted changes in ${mdir}`
        : why === 'diverged' ? `${source} has local commits ${cfg.remote}/${source} lacks: push or reconcile them`
        : why === 'in-use' ? `${source} is checked out in another worktree: switch that worktree to another branch`
        : 'see the Sync log';
      throw markTerminal(new Error(`Sync: could not fast-forward ${source} to ${cfg.remote}/${source} (${why}). ` +
        `A run on the source branch must start from an up-to-date ${source}; ${fix}, then start again.`));
    }
    if (r.result === 'diverged') {
      // Keep the refusal on the run (header Sync button, Ask get_run): the terminal run's persisted
      // state.branch is mirrored from this before the setup-failure throw. No worktreeDir, so
      // every pending-record reader skips it.
      this.state.branches[m.projectKey] = { source, sync: record };
      throw markTerminal(new Error(`Sync: ${source} has diverged from ${cfg.remote}/${source} (${r.ahead} ahead, ${r.behind} behind). ` +
        'Worca never merges or resets a shared checkout; start again and choose "Start from origin", or set sync.onDiverged to "origin".'));
    }
    // Single project: close the row now so its time is the sync, not the worktree creation.
    // Workspace members share the row; it closes after the member loop.
    if (!this.isWorkspace) this._closeSyncStage();
    return { ...(r.startRef ? { startRef: r.startRef } : {}), record };
  }

  /** Name what the open preflight is doing (`state.setupStage`): the run page's
   *  status line reads it while no workflow step runs yet. */
  _setupStage(label) {
    if (this.state.setupStage === label) return;
    this.state.setupStage = label;
    this._emit('state', this.getState());
  }

  /** Close the preflight bookend once the setup is over (run(), and resume() after a
   *  setup replay). A no-op on a row that is not open, so a resume with nothing to
   *  replay never re-stamps a finished preflight. */
  _endPreflight() {
    this.state.setupStage = null;
    const row = this.state.steps.find((s) => s.key === 'x:preflight:1');
    if (row && row.status === 'start') this._bookend('preflight', 'done');
  }

  /** Constructor seam for the v1 runner registry (v1 only; the graph engine
   *  injects its runners through the executor). Called from the constructor at
   *  the exact position the assignment had. */
  _initRunners(_opts) { /* base: no runner registry */ }
}

/** TEST-ONLY: the skill-label helpers `test/skill-capture.test.mjs` pins. They
 *  are harness code, so they outlive the v1 engine that used to re-export them. */
export const _testing = { SKILLS_MAX, skillLabel, mergeSkills };
