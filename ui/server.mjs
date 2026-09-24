// ui/server.mjs
// Express static server + REST API + WebSocket bridge that drives the
// deterministic orchestrator core. Only non-builtin deps: express + ws.
//
// Run:  node ui/server.mjs   (or `npm start`)
// Env:  PORT (default 4317), WORCA_MOCK (forwarded to runs when ?mock or body.mock)

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';

import { preflightNode } from '../src/core/preflight-node.mjs';
import { createOrchestratorFor } from '../src/core/engine-select.mjs';
import {
  listPipelines, readPipeline, listAllPipelines, readPipelineByKey,
  enrichPipelinesPr, reconcileStaleRunning, readPipelineForResume, persistPrState, readPrState,
  readRunLogText, readRunArtifactText, countPipelines, runRootSweepLookups, legacySweepLookups, slugify,
  listArtifacts, listRunArtifacts, lookupPipelineRow, findPipelineRowById, readPipelineStateById, resolveIndexedArtifact, resolveIndexedArtifactForRow,
  readPromptFile, runDirForRow,
} from '../src/core/artifacts.mjs';
import { DIFF_PATCH_FILE } from '../src/core/results.mjs';
import { readAskFileEntry, ASK_FILE_MIMES } from '../src/core/ask-files.mjs';
import { ASK_FILES_DIR } from '../src/core/ask-forms.mjs';
import { protectedSectionKeys } from '../src/core/diff-anchor.mjs';
import {
  addDiffComment, addDiffCommentReply, listDiffComments, getDiffComment, setDiffCommentResolved,
  deleteDiffComment, unresolvedCounts, onDiffCommentsChanged, stampSentRunId,
  peekPendingCardComments, clearPendingCardComments, DiffCommentError, DC_ID_RE,
} from '../src/core/diff-comments.mjs';
import { listProjects, addProject, removeProject, normalizeProjectPath, countProjects, worcaHome } from '../src/core/projects.mjs';
import { renderIndexHtml, INDEX_THEME_ANCHOR } from '../src/core/index-html.mjs';
import {
  getWorcaRoot, setWorcaRoot, setProjectsRoot, defaultRoot,
  rawProjectsRoot, defaultProjectsRoot, runRootMode, getProjectsRoot,
  pipelineCostLimitUsd, totalCostLimitUsd, costLimitResetPeriod,
  setPipelineCostLimitUsd, setTotalCostLimitUsd, setCostLimitResetPeriod, assertCostLimitInputs,
  humanRateUsdPerHour, setHumanRateUsdPerHour, assertHumanRateInput,
  askMaxTurns, askMaxBudgetUsd, setAskMaxTurns, setAskMaxBudgetUsd, assertAskLimitInputs,
  chatPrefs, setChatPrefs,
  debugSpawnEnabled as storedDebugSpawnEnabled, effectiveDebugSpawn, setDebugSpawnEnabled, assertDebugSpawnInput, SETTINGS_POST_KEYS,
  titleModel as storedTitleModel, setTitleModel, assertTitleModelInput,
  hideBuiltinModels, setHideBuiltinModels, assertHideBuiltinModelsInput,
  theme as storedTheme, setTheme, assertThemeInput,
  uiLevel as storedUiLevel, setUiLevel, assertUiLevelInput, defaultUiLevel,
  autoWorkflowModel as storedAutoWorkflowModel, setAutoWorkflowModel, assertAutoWorkflowModelInput,
  memoryDefragModel, setMemoryDefragModel, assertMemoryDefragModelInput,
  scheduleDefaults, setScheduleDefaults,
} from '../src/core/settings.mjs';
import { resolveDefragModel, defragDefaultModel, defragWorkflowView, checkStartPair } from '../src/core/memory-defrag-model.mjs';
import { describeTitleModel } from '../src/core/title.mjs';
import { effectiveHumanRateUsd } from '../src/core/human-rate.mjs';
import {
  ASK_ID_RE, createThread as askCreateThread, getThread as askGetThread,
  listThreads as askListThreads, updateThread as askUpdateThread,
  deleteThread as askDeleteThread, sweepEmptyThreads, sweepStreamingMessages, sweepCloningCards,
  countThreads as askCountThreads, listThreadIds as askListThreadIds,
  countWorktrees as askCountWorktrees, countAttachments as askCountAttachments,
  appendMessage as askAppendMessage, getMessage as askGetMessage,
  listMessages as askListMessages, setMessageBlocks as askSetMessageBlocks,
  findCard as askFindCard, updateCardBlock as askUpdateCardBlock,
  addAttachment as askAddAttachment, listAttachments as askListAttachments,
  getAttachment as askGetAttachment, attachmentPath as askAttachmentPath, threadAttachmentBytes as askThreadAttachmentBytes,
  linkRun as askLinkRun, updateRunLink as askUpdateRunLink, listRunLinks as askListRunLinks,
  findRunLinksByPipeline as askFindRunLinksByPipeline,
  finishMessage as askFinishMessage,
} from '../src/core/ask/store.mjs';
import { sanitizeTitle as askSanitizeTitle } from '../src/core/title.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { askCatalog, validateModelEffort } from '../src/core/ask/models.mjs';
import { buildCatalog as askBuildCatalog } from '../src/core/ask/catalog.mjs';
import {
  buildSystemPrompt as askBuildSystemPrompt, buildContextHeader as askBuildContextHeader,
  buildTurnPrompt as askBuildTurnPrompt, buildRestoredPrompt as askBuildRestoredPrompt,
  selectInlineAttachments as askSelectInlineAttachments, validateClientContext,
} from '../src/core/ask/prompt.mjs';
import { askScriptPromptInput } from '../src/core/ask/script-deps.mjs';
import {
  classifyExtension as askClassifyExtension, sniffMime as askSniffMime,
} from '../src/core/ask/attachment-kind.mjs';
import {
  listAskWorktrees as askListWorktrees,
  removeAskWorktree as askRemoveWorktree,
  removeThreadWorktrees as askRemoveThreadWorktrees,
  sweepAskWorktrees,
} from '../src/core/ask/worktrees.mjs';
import { createAskTurn } from '../src/core/ask/turn.mjs';
import { attachRunFollower } from '../src/core/ask/follow.mjs';
import { mockEnabled, MOCK_WRITER_ROLES } from '../src/core/claude-runner.mjs';
import { budgetStatus, readCostCapOverride, setCostCapOverride } from '../src/core/cost-budget.mjs';
import { getStats, budgetWindowSavings } from '../src/core/stats.mjs';
import {
  enableTeamMetrics, setRecordMyRuns, flushSlug, flushAll, flushProject, scheduleFlush, discoverProject,
  discoverAll, scanMembers, routeWorkspaceMembers, projectMetricsStatus, startTeamMetricsBackground,
  metricsEvents, slugDirName, autoMetricsHome,
} from '../src/core/metrics/sync.mjs';
import { readScope, listScopes, parseScopeParam, aggregate, resolveRange, GROUP_BYS, PROJECT_KEY_RE as TM_PROJECT_KEY_RE } from '../src/core/metrics/read.mjs';
// Team policy (team-policy design §9, §11): the worca-policy branch, its gates and its pages.
import {
  policyEvents, discoverPolicy, discoverAllPolicies, resolveProjectPolicy, resolveWorkspacePolicy, enableTeamPolicy, publishPolicy,
  projectPolicyStatus, listPolicyScopes, routeWorkspaceMembersPolicy, autoPolicyHome, startTeamPolicyBackground,
} from '../src/core/policy/sync.mjs';
import { deviationsFor, fieldsForRun, capSummary } from '../src/core/policy/effective.mjs';
import { installedPluginsMap, pluginRequirements, blockedPluginFindings, seedPolicyMarketplaces, WORCA_VERSION as POLICY_WORCA_VERSION } from '../src/core/policy/local.mjs';
import { normalizePolicyDoc } from '../src/core/policy/registry.mjs';
import { checkTeamTotalGate, checkTeamPipelineGate, teamCapsForTarget } from '../src/core/policy/gate.mjs';
import { readPolicyState } from '../src/core/policy/state.mjs';
import { policyForScope, policyPayload } from '../src/core/policy/scope.mjs';
import { policyCatalogModels } from '../src/core/policy/cache.mjs';
import { pickFolderNative } from '../src/core/folder-dialog.mjs';
import {
  readRemoteAccessConfig, checkRemoteAccessConfig, isRemoteMode, createHostGuard, createIdentityCheck, isInContainer,
} from '../src/core/remote-access.mjs';
import { detectDeployment, deploymentFacts } from '../src/core/deployment.mjs';
import { resolveIdentity, startedByOf, prAttributionFooter, actorOf, isSharedIdentity, byActor } from '../src/core/identity.mjs';
import { planClone, cloneProject, CloneError } from '../src/core/clone-project.mjs';
import { listFolders } from '../src/core/fs-browse.mjs';
import {
  readConfig, setStep, addCustomModel, removeCustomModel, listModels,
  PREDEFINED_MODELS, agentSteps, EFFORTS, catalogHasModel,
  readRunConfig, setNodeModel, setFeedbackCycles, setWireCycles, setActiveWorkflow, setHumanInLoop, resetWorkflowConfig,
  globalModelRefs, removeGlobalModelAndRefs, promoteCustomModel, costUnreliableModelIds,
  readPrRemotePrefs, setPrRemotePrefs,
} from '../src/core/config.mjs';
import { listGlobalModels, addGlobalModel, updateGlobalModel } from '../src/core/settings.mjs';
import { modelEnvRef, maskModelEnvValue, SUBAGENT_MODEL_VALUES, subagentModelIssue, UPSTREAM_PROVIDERS } from '../src/core/model-env.mjs';
import { providerReadiness } from '../src/core/bridge/registry.mjs';
import { startBridge } from '../src/core/bridge/server.mjs';
import {
  providersState, patchProvider, acknowledgeTerms, beginCopilotLogin, pollCopilotLogin, copilotLogout,
  copilotModelsForImport, importCopilotModels, testProviderConnection,
  endpointModelsForImport, importEndpointModels,
} from '../src/core/bridge/provider-ops.mjs';
import { listPluginModels, modelSecretsSchema, pluginModelSecretStatus } from '../src/core/plugin-models.mjs';
import { testModel } from '../src/core/model-test.mjs';
import {
  DEFAULT_UI_PORT, UI_HEALTH_NAME, newUiToken, writeUiInstance, removeUiInstance, uiUrl,
} from '../src/core/ui-instance.mjs';
import { validateGuardrails } from '../src/core/guardrails.mjs';
import {
  listBuiltinGuardrailSets, listGuardrailSets, readGuardrailSet, listPolicyGuardrailSets, isPolicyGuardrailSetId,
  writeGuardrailSet, deleteGuardrailSet, isBuiltinGuardrailSetId,
} from '../src/core/guardrail-store.mjs';
import {
  GRAPH_DEFAULT_WORKFLOW, AUTO_WORKFLOW_ID, GRAPH_MEMORY_DEFRAG_WORKFLOW, MEMORY_DEFRAG_WORKFLOW_ID, listWorkflows, deleteWorkflow, isSafeWorkflowId,
  setWorkflowNodeDefaults, workflowNodeDefaults, assertRunnableWorkflow, writeGraphWorkflow, readWorkflow,
} from '../src/core/workflows.mjs';
import { mintAutoWorkflowId, sanitizeProposalAnswer } from '../src/core/auto/proposal.mjs';
import {
  revalidateWorkflowProposal, applyTunables, workflowEventPrompt, workflowNoticeText,
} from '../src/core/ask/workflow-deps.mjs';
import { applyMetricsChange } from '../src/core/ask/metrics-deps.mjs';
import { metricsEventPrompt, metricsNoticeText } from '../src/core/ask/metrics-proposal.mjs';
import { applyPolicyChange } from '../src/core/ask/policy-deps.mjs';
import { policyEventPrompt, policyNoticeText } from '../src/core/ask/policy-proposal.mjs';
import { scheduleEventPrompt, scheduleNoticeText } from '../src/core/ask/schedule-spec.mjs';
import { applyModelChange } from '../src/core/ask/model-deps.mjs';
import { modelEventPrompt, modelNoticeText } from '../src/core/ask/model-proposal.mjs';
import { cloneEventPrompt, cloneNoticeText } from '../src/core/ask/clone-proposal.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { sweepV1Runs, V1_RUN_RETIRED, getDb } from '../src/core/db.mjs';
import { exportWorkflow, exportWorkflowPlugin, ON_CONFLICT_MODES, RESOLUTION_CHOICES } from '../src/core/workflow-export.mjs';
import {
  saveGraphWorkflow, importGraphWorkflow, exportGraphJson, workflowFileSlug, nodeDefaultsError,
} from '../src/core/workflow-share.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { loadScriptRegistry } from '../src/core/script-registry.mjs';
import { probePython, pythonRuntimeState } from '../src/core/graph/python-probe.mjs';
import {
  listLocalBranches, currentBranch, isValidSourceRef, sweepRunRoots, sweepLegacyWorktreesAll,
} from '../src/core/worktree.mjs';
import { hasGh, pushBranch, createPr, createIssue, prMergeable, listRemotes, listRemoteBranches, sameRepo } from '../src/core/git-info.mjs';
import { isSyntacticRef } from '../src/core/ask/proposal.mjs';
import { archivePipeline, discardRetainedWorktrees } from '../src/core/pipeline-delete.mjs';
import {
  listWorkspaces, readWorkspace, createWorkspace,
  updateWorkspace, deleteWorkspace, isGitRepo, WORKSPACE_KEY_RE, countWorkspaces,
} from '../src/core/workspaces.mjs';
import { listWorkspacePipelines, readWorkspacePipeline, appendAuditById } from '../src/core/artifacts.mjs';
import { generateOverview } from '../src/core/overview-agent.mjs';
import { projectKey, PROJECT_KEY_RE } from '../src/core/store.mjs';
import { validateMemoryScope, withStoreLock } from '../src/core/memory-sync.mjs';
import {
  memoryRoot, GLOBAL_SCOPE, projectScope, scopeKey, isValidMemoryName, MEMORY_NAME_HELP, memoryScopeReport,
  readMemory, writeMemory, removeMemory, listSnapshots, restoreSnapshot,
} from '../src/core/memory-store.mjs';
import { memoryCaps } from '../src/core/settings.mjs';
import { onboardingPrefs, setOnboardingPrefs } from '../src/core/settings.mjs';
import { onboardingStatus } from '../src/core/onboarding.mjs';   // a THIRD settings import line (the two blocks above are unrelated readers)
import { createWorkspaceScan } from '../src/core/workspace-scan.mjs';
import { createAgentGen } from '../src/core/agent-gen.mjs';
import { listAgents, readAgent, createAgent, updateAgent, deleteAgent, AGENT_KEY_RE } from '../src/core/agent-store.mjs';
import {
  listScripts, readScript, createScript, updateScript, deleteScript, duplicateScript, writeCases,
  SCRIPT_KEY_RE,
} from '../src/core/script-store.mjs';

import { createBench, sweepBenchDirs, benchRoot } from '../src/core/script-bench.mjs';
import { PORT_ID_RE } from '../src/shared/graph/constants.mjs';
import {
  listInstalledPlugins, installPlugin, updatePlugin, uninstallPlugin, pythonNoticeFor,
  setPluginEnabled, doctorPlugin, linkPlugin,
  listOrphanPluginData, purgePluginData,
} from '../src/core/plugin-store.mjs';
import { fetchCandidate } from '../src/core/plugin-repo.mjs';
import {
  addMarketplace, listMarketplaces, syncMarketplace, refreshAllMarketplaces,
  removeMarketplace, readMarketplaces, seedBuiltinMarketplace,
} from '../src/core/marketplaces.mjs';
import {
  redactedConfig, writePluginConfig, readPluginConfig, listProfiles, listProfileIds,
  createProfile, deleteProfile, isValidProfileId, DEFAULT_PROFILE,
} from '../src/core/plugin-config.mjs';
import {
  setBinding, clearBinding, listBindingsForScope,
  clearBindingsForProfile, resolveProfile,
} from '../src/core/source-bindings.mjs';
import { createChannelHost } from '../src/core/chat/channel-host.mjs';
import { createCommandRouter } from '../src/core/chat/command-router.mjs';
import { createChatContext } from '../src/core/chat/chat-context.mjs';
import { createNotifier } from '../src/core/chat/notifier.mjs';
import { TokenBucket } from '../src/core/chat/rate-limiter.mjs';
import { renderTest } from '../src/core/chat/renderers.mjs';
import { readPluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { normalizeManifest, validatePluginDir, PLUGIN_NAME_RE as MANIFEST_PLUGIN_NAME_RE } from '../src/core/plugin-manifest.mjs';
import { listTaskSources, retryWriteback, resolveTaskInput } from '../src/core/sources.mjs';
import {
  createTicket, getTicket, listTickets, updateTicket, cancelTicket, requestRunNow, setTicketPipeline,
  createSchedule, getSchedule, listSchedules, updateSchedule, pauseSchedule, resumeSchedule, skipNext,
  runScheduleNow, deleteSchedule, cancelForTarget, dependentsOfWorkflow, runDueTickets, recordOutcome,
  recoverScheduler, purgeScheduler, scheduleCounts, scheduleStageDir, scheduleSignature,
  resolveAfterRef, predecessorState, previousBranchesOf, dependentsOfRun, AFTER_POLICIES, afterRefOf,
  chainBaseBranchesOf,
} from '../src/core/scheduler.mjs';
import {
  onNotification, listNotifications, unreadCount, latestNotificationId, markRead, markAllRead, purgeNotifications,
} from '../src/core/notifications.mjs';
import {
  normalizeRule, nextOccurrence, previewOccurrences, describeRule, parseScheduledFor, localDate,
  isValidTimeZone, formatInstant, OVERLAP_POLICIES, MISSED_POLICIES,
} from '../src/shared/schedule/recurrence.mjs';
import { callSource, PluginOpError } from '../src/core/plugin-shim.mjs';
import { resolveAutoModel, AUTO_MODEL_ENV } from '../src/core/auto/model.mjs';
import {
  buildRunReport, buildIssueUrl, reportFilename, renderIssueBodyFull, issueTitle,
  repoSlugFromBugsUrl, BUGS_URL,
} from '../src/core/run-report.mjs';
import { REPORT_REASON_IDS } from '../src/shared/report-reasons.mjs';
import { HLJS_GRAMMAR_IDS } from './public/hljs-loader.mjs';

// ── node:sqlite runtime guard + warning filter ──────────────────────────────────
// Drop ONLY the one-time ExperimentalWarning emitted by node:sqlite (the module is
// stable enough for our use but still flagged experimental). Everything else (deprec-
// ations, etc.) is re-printed unchanged. Belt-and-suspenders with the npm scripts'
// --disable-warning=ExperimentalWarning (the primary suppressor): this filter is the
// direct-bin fallback. We removeAllListeners('warning') FIRST so Node's default
// printer no longer fires (a bare listener would NOT suppress the warning and would
// double-print every OTHER warning), then attach our single filtering listener.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w && w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  process.stderr.write(`${w?.stack || w?.message || w}\n`);
});
// Fail fast on an unsupported Node / missing node:sqlite BEFORE any DB is opened.
preflightNode();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const AGENTS_DIR = path.join(PROJECT_ROOT, 'agents');
const SKILLS_DIR = path.join(PROJECT_ROOT, 'skills');
const require = createRequire(import.meta.url);
const PKG = require('../package.json');
const PKG_VERSION = PKG.version;
// Settings ▸ About identity, fixed at module load. repository.url is normalised
// from npm's git forms (git+https, ssh://git@, git://, scp-style git@host:path)
// to a browsable https URL; releaseUrl points at the tag the release workflow
// publishes from (.github/workflows/release-npm-app.yml: worca-app-v<version>).
const repoWebUrl = (raw) => String(raw || '')
  .replace(/^git\+/, '')
  .replace(/^ssh:\/\/git@/, 'https://')
  .replace(/^git:\/\//, 'https://')
  .replace(/^git@([^:/]+):/, 'https://$1/')
  .replace(/\.git$/, '');
const APP_REPO_URL = repoWebUrl(PKG.repository && PKG.repository.url);
const APP_INFO = Object.freeze({
  version: PKG_VERSION || '',
  repoUrl: APP_REPO_URL,
  releaseUrl: APP_REPO_URL && PKG_VERSION ? `${APP_REPO_URL}/releases/tag/worca-app-v${PKG_VERSION}` : '',
  // package.json bugs.url, via run-report.mjs so the Settings links and the
  // prefilled issue URL can never disagree. Falls back to <repo>/issues.
  bugsUrl: BUGS_URL || (APP_REPO_URL ? `${APP_REPO_URL}/issues` : ''),
});
const HLJS_LANGUAGE_FILE_RE = /^[a-z0-9][a-z0-9-]{0,63}\.min\.js$/;
// Primaries plus the sub-language grammars their instances register
// (hljs-loader.mjs); a shipped but unmapped grammar stays a plain 404.
const HLJS_LANGUAGE_FILES = new Set(
  HLJS_GRAMMAR_IDS.map((id) => `${id}.min.js`),
);

function resolveHljsAssets(resolve = require.resolve, warn = (msg) => console.warn(msg)) {
  try {
    const core = resolve('@highlightjs/cdn-assets/es/core.min.js');
    return { core, languages: path.join(path.dirname(core), 'languages') };
  } catch (err) {
    warn(`[worca-ui] syntax-highlighter assets unavailable: ${err?.message || err}`);
    return null;
  }
}

const HLJS_ASSETS = resolveHljsAssets();

// Ask Worca §10.7: the chat's markdown pipeline is served from node_modules the
// same way the hljs assets are, but resolved with import.meta.resolve — the CJS
// require.resolve lands on marked's CJS build, and dompurify/package.json is not
// exported. Each package degrades independently: a missing one just leaves its
// route unregistered and the existing /vendor no-store 404 answers.
function resolveEsmAsset(spec, resolve = (s) => import.meta.resolve(s), warn = (msg) => console.warn(msg)) {
  try {
    return fileURLToPath(resolve(spec));
  } catch (err) {
    warn(`[worca-ui] ask markdown asset unavailable (${spec}): ${err?.message || err}`);
    return null;
  }
}

const ASK_VENDOR_ASSETS = {
  marked: resolveEsmAsset('marked'),
  dompurify: resolveEsmAsset('dompurify'),
};

const PORT = Number(process.env.PORT) || DEFAULT_UI_PORT;
// Bind to loopback by default (S1). Power users who knowingly want LAN exposure
// can set WORCA_HOST=0.0.0.0, but the localhost-only Host/Origin guard still
// applies unless they also front it with auth.
const HOST = process.env.WORCA_HOST || '127.0.0.1';

// Remote access behind an identity proxy (src/core/remote-access.mjs): opt-in
// via WORCA_ALLOWED_HOSTS + WORCA_CF_ACCESS_*. Unset = the localhost-only
// contract above, unchanged. A config error stops the server at boot (isMain)
// and, should the app be imported anyway, refuses every non-local request.
const REMOTE_ACCESS = readRemoteAccessConfig(process.env);
const REMOTE_ACCESS_CHECK = checkRemoteAccessConfig(REMOTE_ACCESS, { bindHost: HOST });
const REMOTE_MODE = isRemoteMode(REMOTE_ACCESS);
const isLocalRequest = createHostGuard(REMOTE_ACCESS.allowedHosts);
const identityCheck = REMOTE_ACCESS_CHECK.errors.length ? null : createIdentityCheck(REMOTE_ACCESS);
// local | container | hosted (src/core/deployment.mjs): what Ask Worca is told about where it runs.
const DEPLOYMENT = detectDeployment(process.env, { remoteMode: REMOTE_MODE });
const SEEN_SIGN_INS = new Set();
const HOST_FORBIDDEN = REMOTE_MODE
  ? 'forbidden: host not allowed (see WORCA_ALLOWED_HOSTS)'
  : 'forbidden: worca is a localhost-only tool';

/**
 * Who is asking: `{ local: true }` for an in-container caller or when no
 * identity check applies, `{ email, sub }` for a valid proxy token, null when
 * refused. Rejects when the identity provider cannot be reached (-> 503).
 */
async function requestIdentity(req) {
  if (isInContainer(req)) return { local: true };
  if (REMOTE_ACCESS_CHECK.errors.length) return null;
  if (!identityCheck) return { local: true };
  return identityCheck(req);
}

// ---------------------------------------------------------------------------
// Run registry. Each entry holds the live orchestrator + a ring buffer of the
// events emitted so far so that a WebSocket which connects late can replay.
// ---------------------------------------------------------------------------
/**
 * @type {Map<string, {
 *   id: string,                 // runs-Map key = randomUUID()
 *   pipelineId?: string,        // short id from src/core/artifacts.mjs#shortId, set after createPipeline
 *   orch: import('events').EventEmitter,
 *   projectDir: string,
 *   title: string,
 *   status: string,
 *   startedAt: string,
 *   events: any[],
 *   pendingQuestion: any
 * }>}
 */
const runs = new Map();

// Ids of runs genuinely live in THIS process (non-terminal entries in the runs Map).
// Passed to reconcileStaleRunning so a same-process run is never relabeled. Both the
// short pipelineId (matches pipelines.id) and the runs-Map UUID id are pushed; the UUID
// simply never matches a pipelines.id, so including it is harmless.
function liveRunIds() {
  const ids = [];
  for (const r of runs.values()) {
    const s = String(r.status || '').toLowerCase();
    if (s === 'running' || s === 'starting' || s === 'created' || s === 'pausing') {
      if (r.pipelineId) ids.push(r.pipelineId);
      if (r.id) ids.push(r.id);
    }
  }
  return ids;
}

// `stepgraphify` (§7.3) was emitted by the orchestrator and handled by the client
// but missing here, so the graphify badge only appeared after a reload (via the
// persisted column) and never live. It rides the same pass-through as `stepskills`.
// `exec` and `token` are the graph engine's (§5.7). `phase` stays for the v1
// engine AND for the v2 shim until the graph cut-over retires it.
const EVENT_NAMES = ['exec', 'token', 'log', 'question', 'artifact', 'state', 'done', 'error', 'subagent', 'stepskills', 'stepgraphify', 'title'];
// The scan-* WS family (Workspaces M5, §5.4). A NEW family in the SAME runs Map;
// the 7-event run plumbing above is untouched. createWorkspaceScan emits many
// scan-progress then exactly one terminal scan-done OR scan-error.
const SCAN_EVENT_NAMES = ['scan-progress', 'scan-done', 'scan-error'];
// The agentgen-* WS family (Agent Platform, Phase 2). Same pattern as scan-*:
// a NEW family in the SAME runs Map. createAgentGen emits many agentgen-progress
// then exactly one terminal agentgen-done OR agentgen-error.
const AGENTGEN_EVENT_NAMES = ['agentgen-progress', 'agentgen-done', 'agentgen-error'];
// The scriptbench-* family (Scripts workbench §4.1): one more family in the same
// runs Map. createBench emits many scriptbench-line then exactly one terminal
// scriptbench-done OR scriptbench-error. A bench is NOT a run: no DB row, no
// History entry, no ledger and no cost (W15) — only this buffer.
const SCRIPTBENCH_EVENT_NAMES = ['scriptbench-line', 'scriptbench-done', 'scriptbench-error'];
const MAX_BENCH_ENTRIES = 8;   // finished bench entries kept in the runs Map (startScriptBench evicts the rest)
const MAX_BUFFER = 5000;

// ---------------------------------------------------------------------------
// WebSocket plumbing
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
// Refuse during the upgrade (before any replay is sent): the Host/Origin guard
// first, then the identity check when remote access is on. The 'connection'
// handler below re-checks the host guard as a second line.
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: (info, done) => {
    if (!isLocalRequest(info.req)) return done(false, 403);
    requestIdentity(info.req).then(
      // Keep who this is on the upgrade request: the connection handler reads it to scope
      // per-thread Ask frames to their owner (askViewer).
      (who) => { if (who) info.req.worcaUser = who; return who ? done(true) : done(false, 401); },
      () => done(false, 503),
    );
  },
});
// ws re-emits the http server's 'error' on the WebSocketServer. With no listener
// here, an EADDRINUSE on listen() became an unhandled 'error' event and a full
// stack trace; the http server's own handler (isMain below) is the one that
// reports it, so this side of the pair only has to not throw.
wss.on('error', () => {});

/** All currently connected sockets. */
const sockets = new Set();

// server.close() only calls back once every connection is gone, and Node's
// closeAllConnections() skips UPGRADED sockets — a WebSocket whose close
// handshake has not completed (a client that vanished, or a test tearing down
// right after ws.close()) keeps the callback from ever firing; under load that
// is a hang. Terminate the lingering clients first so close() is deterministic
// on every OS; the per-socket 'close' handlers below drop them from `sockets`.
{
  const httpClose = server.close.bind(server);
  server.close = (cb) => {
    for (const ws of sockets) { try { ws.terminate(); } catch { /* already gone */ } }
    return httpClose(cb);
  };
}

wss.on('connection', (ws, req) => {
  // S1: WS upgrades bypass the express middleware chain, so re-apply the
  // loopback guard here (same DNS-rebinding protection as the HTTP routes).
  if (!isLocalRequest(req)) {
    try { ws.close(1008, 'forbidden'); } catch { /* already closing */ }
    return;
  }
  sockets.add(ws);
  // Whose Ask threads this socket may see (a shared sign-in's name, else null = all).
  ws.worcaViewer = askViewer(req);
  // Optional ?runId=... (or ?scanId=.../?genId=...) -> replay that entry's buffered
  // events so a reconnecting client immediately sees the full state. Scan + agentgen
  // entries live in the SAME runs Map keyed by scanId/genId, so a single id lookup
  // serves all families.
  let requestedRunId = null;
  let requestedScanId = null;
  let requestedGenId = null;
  let requestedBenchId = null;
  let requestedThreadId = null;
  try {
    const u = new URL(req.url, 'http://localhost');
    requestedRunId = u.searchParams.get('runId');
    requestedScanId = u.searchParams.get('scanId');
    requestedGenId = u.searchParams.get('genId');
    requestedBenchId = u.searchParams.get('benchId');
    requestedThreadId = u.searchParams.get('threadId');
  } catch {
    requestedRunId = null;
    requestedScanId = null;
    requestedGenId = null;
    requestedBenchId = null;
    requestedThreadId = null;
  }
  const id = requestedRunId || requestedScanId || requestedGenId || requestedBenchId;

  send(ws, { type: 'hello', runs: summarizeRuns(), ask: askHello(ws) });

  if (id && runs.has(id)) {
    replayEntry(ws, runs.get(id));
  }

  if (requestedThreadId && askJobs.has(requestedThreadId) && askSocketSees(ws, requestedThreadId)) {
    replayAskJob(ws, askJobs.get(requestedThreadId));
  }

  ws.on('close', () => sockets.delete(ws));
  ws.on('error', () => sockets.delete(ws));
  ws.on('message', (data) => {
    // Clients may ask to (re)subscribe / replay an entry's history. A scan's
    // {type:'subscribe', scanId} and an agent generation's {type:'subscribe',
    // genId} are accepted identically to a run's runId.
    let msg = null;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    const subId = msg && msg.type === 'subscribe' ? (msg.runId || msg.scanId || msg.genId || msg.benchId) : null;
    if (subId && runs.has(subId)) {
      replayEntry(ws, runs.get(subId));
    }
    const askThreadId = msg && msg.type === 'subscribe' && typeof msg.threadId === 'string' ? msg.threadId : null;
    if (askThreadId && askJobs.has(askThreadId) && askSocketSees(ws, askThreadId)) {
      replayAskJob(ws, askJobs.get(askThreadId));
    }
  });
});

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      /* ignore individual socket failures */
    }
  }
}

// After replaying an entry's buffered events, push a CURRENT state snapshot so a
// late-joining socket always has the latest stepper + subAgents even if the run's
// initial 'state' frame was evicted from the ring buffer (MAX_BUFFER = 5000). For a
// RUN this re-seeds the stepper, and is idempotent with any replayed 'state' frame
// (onState merges). SCAN entries DO expose getState() but have no `.state` property,
// so the `orch.state &&` guard below skips them on purpose: a scan has no stepper to
// seed, and its scanId/phase/... state is already delivered via scan-* events.
// getState() returns a clone with an `id` key (not `runId`) and no `type` key, so the
// explicit { runId, type } below are not clobbered by the spread.
function sendStateSnapshot(ws, entry) {
  const orch = entry && entry.orch;
  if (orch && orch.state && typeof orch.getState === 'function') {
    send(ws, { runId: entry.id, type: 'state', ...orch.getState() });
  }
}

// Replay a run/scan/gen entry's buffered events to a (re)connecting socket, then
// push a current state snapshot. A buffered `question` event lingers in the ring
// buffer forever, but is replayed ONLY while it is still the active pending
// question (entry.pendingQuestion, the single source of truth that also seeds
// hello). Once answered — or superseded by a newer question — replaying it would
// resurrect a clarify/gate card on refresh: a zombie that paints a false "paused"
// state over an already-running pipeline and routes its answer to a no-longer-
// pending id ("answer() ignored"). So a question whose id no longer matches the
// active pending question is skipped on replay; every other event passes through.
function replayEntry(ws, entry) {
  const pendingId = (entry.pendingQuestion && entry.pendingQuestion.id) || null;
  for (const ev of entry.events) {
    if (ev.type === 'question' && ev.id !== pendingId) continue;
    send(ws, ev);
  }
  sendStateSnapshot(ws, entry);
}

/** Broadcast an already-tagged event object to every open socket. */
function broadcast(obj) {
  const text = JSON.stringify(obj);
  const owner = askFrameOwner(obj);
  for (const ws of sockets) {
    if (owner && ws.worcaViewer && ws.worcaViewer !== owner) continue;   // someone else's Ask thread
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(text);
      } catch {
        /* ignore */
      }
    }
  }
}

// Per-person delivery of Ask frames (step 3): on a shared sign-in an ask-* frame that names a
// thread goes only to sockets of that thread's owner (and to non-shared sockets, e.g. an
// in-container tool), like the HTTP guard on /api/ask/threads/:id. Owners never change, so
// they are cached; nothing is looked up unless some socket is a shared viewer.
const ASK_OWNER_CACHE = new Map();   // threadId -> createdBy | null
function askFrameOwner(obj) {
  if (!obj || typeof obj.threadId !== 'string' || typeof obj.type !== 'string' || !obj.type.startsWith('ask-')) return null;
  let anyViewer = false;
  for (const ws of sockets) if (ws.worcaViewer) { anyViewer = true; break; }
  if (!anyViewer) return null;
  if (ASK_OWNER_CACHE.has(obj.threadId)) return ASK_OWNER_CACHE.get(obj.threadId);
  let owner = null;
  try { owner = askGetThread(obj.threadId)?.createdBy || null; } catch { return null; }
  if (ASK_OWNER_CACHE.size > 5000) ASK_OWNER_CACHE.clear();
  ASK_OWNER_CACHE.set(obj.threadId, owner);
  return owner;
}

// Fire-and-forget "this entity set changed — refetch your counts" signal. Bare +
// unbuffered + global, exactly like the history-pr broadcast: every connected tab
// (including the one that triggered the mutation) gets it and re-reads /api/counts.
// Because the client always SETS counts to an absolute value (never +1/-1), a tab
// receiving its own echo is idempotent. A tab disconnected at mutation time recovers
// on its next view switch / reload (the agreed product behavior).
function emitChanged(type, action) {
  broadcast({ type, action: action || null });
}

metricsEvents.on('changed', (e) => emitChanged('team-metrics-changed', e && e.action ? e.action : null));
policyEvents.on('changed', (e) => emitChanged('team-policy-changed', e && e.action ? e.action : null));

// Every comment mutation in THIS process (the REST routes below) pokes the open
// Diff tabs. A poke carries ids only — no payload, so it is idempotent and has no
// ordering concerns; the client refetches and repaints its CARDS, never the diff.
// MCP-side mutations happen in the stdio CHILD process and cannot reach this
// listener; they arrive through the turn's comment hook instead.
onDiffCommentsChanged(({ storeKey, pipelineId }) => {
  broadcast({ type: 'diff-comments-changed', storeKey, pipelineId });
});

/** Resolve an 8-hex pipeline id to its History store key and poke the open Diff
 *  tabs. Used for MCP-side writes, which happen in the stdio CHILD process and
 *  cannot reach the listener above. The frame is byte-identical to the REST one,
 *  so the client has ONE code path. findPipelineRowById is key-agnostic and
 *  includes archived rows. Exported through `_testing` — the wiring at the ask
 *  turn is a one-liner precisely so this function is the whole testable surface. */
function emitDiffCommentsChanged(runId) {
  try {
    const row = findPipelineRowById(runId);
    if (!row) return false;
    const storeKey = (row.target === 'workspace' || row.workspace_key)
      ? `workspaces/${row.workspace_key}` : row.project_key;
    broadcast({ type: 'diff-comments-changed', storeKey, pipelineId: row.id });
    return true;
  } catch { return false; }   // a poke is best effort
}

// Append a tagged event to an entry's ring buffer (runId LAST so the runs-Map key
// always wins over any id the orchestrator stamped). Shared by the live wire
// (record) and out-of-band resolutions (resolvePending) so both honor MAX_BUFFER.
function bufferEvent(entry, event) {
  const tagged = { ...event, runId: entry.id };
  entry.events.push(tagged);
  if (entry.events.length > MAX_BUFFER) entry.events.splice(0, entry.events.length - MAX_BUFFER);
  return tagged;
}

// Clear an entry's active pending question and tell EVERY connected client to drop
// its clarify/gate card — not just the tab that answered. A second tab's post-answer
// `phase` event is gated on its own _answering flag, so without this broadcast it
// keeps showing a stale card (and a false "paused" stepper) until the run ends.
// Buffered (so a later reconnect replays the resolution) AND broadcast live. The
// single chokepoint for clearing entry.pendingQuestion: answer, stop, pause, done,
// error all route here. Idempotent + id-aware: a no-op when nothing is pending, or
// when `id` is given and does not match the active question (a stale/dup ack).
function resolvePending(entry, { id = null, reason = 'resolved' } = {}) {
  const pq = entry && entry.pendingQuestion;
  if (!pq || (id && pq.id !== id)) return false;
  entry.pendingQuestion = null;
  broadcast(bufferEvent(entry, { type: 'question-resolved', id: pq.id, reason }));
  return true;
}

/** Statuses under which an entry no longer drives its pipeline (the resumeRun double-resume guard's list, :1713). */
const SETTLED_RUN = new Set(['done', 'stopped', 'error', 'paused', 'interrupted']);
/** A runs-Map PIPELINE entry by its UUID or by its 8-hex History id (scans / agentgens never match). */
function liveRunEntry(id) {
  if (typeof id !== 'string' || !id) return null;
  const isRun = (r) => r && r.orch && (r.kind === 'run' || r.kind === 'workspace-run' || r.kind == null);
  const direct = runs.get(id);
  if (isRun(direct)) return direct;
  // D23: resumeRun evicts only the paused/interrupted lineage; a same-pipeline entry left done/stopped/error sits
  // EARLIER in Map order — the entry still driving the pipeline wins, else the newest (last inserted).
  let best = null;
  for (const r of runs.values()) {
    if (!isRun(r) || r.pipelineId !== id) continue;
    if (!best || !SETTLED_RUN.has(String(r.status || '')) || SETTLED_RUN.has(String(best.status || ''))) best = r;
  }
  return best;
}

/** 'global' | 'projects/<key>' — the store scope key a defragment run works on (memory-store.mjs scopeKey). */
function memoryScopeKey(memoryScope, projectDir) {
  return memoryScope === 'global' ? 'global' : `projects/${projectKey(projectDir)}`;
}
/** The live (i.e. not SETTLED_RUN) defragment run on that scope key, or null. A paused defrag is
 *  NOT live — resumeRun refuses to resume it while another one runs.
 *  Amendment B20: "one live defragment run per scope" is enforced by THIS server process over ITS
 *  runs Map. A CLI-started defragment, or a second `worca ui` process on the same home, is not
 *  registered here; such a collision resolves like any two runs today — last sync wins and the
 *  loser's store copy is in `.history` (spec §5 concurrency). A DB-level check is impossible: the
 *  pipelines row carries no memoryScope. */
function liveDefragRun(scopeKeyStr) {
  for (const e of runs.values()) {
    if ((e.kind || 'run') !== 'run' || !e.orch?.memoryScope) continue;
    if (SETTLED_RUN.has(String(e.status || ''))) continue;
    if (memoryScopeKey(e.orch.memoryScope, e.projectDir) === scopeKeyStr) return e;
  }
  return null;
}

function summarizeRuns() {
  // W15: a bench is NOT a run. Its entry shares the runs Map for the WS replay
  // plumbing only — leaving it here puts "bench: <key>" in every hello and the
  // client's liveRuns() (which does NOT filter by kind) raises the rail's
  // Running badge over an empty Running list.
  return [...runs.values()].filter((r) => r.kind !== 'scriptbench').map((r) => ({
    runId: r.id,
    stepper: r.orch?.state?.stepper ?? null,
    pipelineId: r.pipelineId || null,
    projectDir: r.projectDir,
    title: r.title,
    status: r.status,
    // Why the run is paused, or null — ANY orchestrator pause code rides here
    // (e.g. 'usage_limit'), not just the cost pair. Carried in hello so a
    // reload/reconnect restores the cost banner (the client gates that render on
    // 'cost_pipeline'/'cost_total') instead of showing a plain "Paused" card
    // until the next event.
    pauseReason: r.pauseReason || null,
    // The clipped failure message behind reason 'error', or null — so a
    // reload/reconnect restores the "Paused · error" detail, not a bare card.
    pauseDetail: r.pauseDetail || null,
    startedAt: r.startedAt,
    startedBy: r.startedBy || null,
    // Who last stopped / paused / resumed it ({ kind, by, at }), or null.
    lastAction: r.lastAction || r.orch?.state?.lastAction || null,
    pendingQuestion: r.pendingQuestion || null,
    // kind discriminator so the client routes runs vs scans vs agent generations
    // vs workspace runs without guessing; scanId/genId/workspaceId are the
    // matching attribution fields.
    kind: r.kind || 'run',
    scanId: r.scanId || null,
    genId: r.genId || null,
    workspaceId: r.workspaceId || null,
    projectNames: r.projectNames || null,
  }));
}

// Birth announcement for a freshly-registered run: broadcasts the metadata that
// otherwise only travels in a hello snapshot (projectDir, kind, workspace
// attribution, member names), so tabs that did NOT start the run render its
// child row/card correctly without a reload. Not buffered: late joiners get the
// same fields from summarizeRuns().
function announceRun(entry) {
  broadcast({
    type: 'run-created',
    runId: entry.id,
    title: entry.title,
    projectDir: entry.projectDir,
    kind: entry.kind || 'run',
    workspaceId: entry.workspaceId || null,
    projectNames: entry.projectNames || null,
    status: entry.status,
    startedAt: entry.startedAt,
    startedBy: entry.startedBy || null,
    lastAction: entry.lastAction || null,
  });
}

// ---------------------------------------------------------------------------
// Wire a core orchestrator's events onto the WebSocket, tagged with runId.
// ---------------------------------------------------------------------------
function subscribe(orch, name, handler) {
  // Support a Node EventEmitter (`.on`), an `.addListener` alias, or an
  // EventTarget-style (`.addEventListener`) "EventEmitter-like" object.
  if (typeof orch.on === 'function') {
    orch.on(name, handler);
  } else if (typeof orch.addListener === 'function') {
    orch.addListener(name, handler);
  } else if (typeof orch.addEventListener === 'function') {
    orch.addEventListener(name, (ev) => handler(ev && ev.detail !== undefined ? ev.detail : ev));
  }
}

function wireRun(entry) {
  const { id, orch } = entry;

  // Chat notifications ride the same per-run subscription (design §4.5): every
  // creation site that wires a run gets chat fan-out for free. Scans/agent-gens
  // use their own wire* helpers and are deliberately not notified.
  if ((entry.kind || 'run') === 'run' || entry.kind === 'workspace-run') {
    try { chatNotifier.attach(orch, { runId: id, entry }); }
    catch (err) { console.error(`[worca-ui] chat notifier attach failed: ${err && err.message ? err.message : err}`); }
  }

  const record = (event) => {
    // bufferEvent tags runId LAST so the runs-Map key always wins. The
    // orchestrator's `subagent` delta historically carried its own runId
    // (state.id = pipeline SHORT id, NOT this UUID); tagging the UUID last stops
    // the client spawning a phantom run.
    const tagged = bufferEvent(entry, event);
    broadcast(tagged);
    return tagged;
  };

  for (const name of EVENT_NAMES) {
    subscribe(orch, name, (payload) => {
      const event = { type: name, ...(payload && typeof payload === 'object' ? payload : { value: payload }) };

      if (name === 'question') {
        entry.pendingQuestion = event;
      }
      if (name === 'done') {
        entry.status = (payload && payload.status) || 'done';
        // Remember the pause reason for summarizeRuns (hello). Reset on every
        // done so a later reasonless finish cannot leave a stale cost banner.
        entry.pauseReason = (payload && payload.reason) || null;
        // ...and WHAT went wrong for an error-pause, reset alongside it.
        entry.pauseDetail = (payload && payload.detail) || null;
        resolvePending(entry, { reason: entry.status });
        // B29: ANY run that mounted memory may have synced into its scopes (P1 syncs the mount back
        // at the run end on done, error, stopped and paused alike) — poke every mounted scope so open
        // Memory views refetch. Never gated on `entry.status`: it is mirrored from the earlier `state`
        // frame and already reads 'done' BEFORE _buildResults()/_stampDefrag() have run, while THIS
        // event fires after both (so a defragment frame always follows its stamp).
        if (orch.memory?.dirs?.length) {
          for (const d of orch.memory.dirs) emitMemoryChanged(scopeKey(d.scope));
        }
        if (payload?.reason === 'cost_pipeline' || payload?.reason === 'cost_total') {
          emitChanged('budget-changed');
        }
      }
      if (name === 'error') {
        // The launch-error channel (a failure BEFORE the pipeline row exists). A
        // converted in-run failure pauses and emits no 'error'; never let a stray
        // one demote a parked run.
        if (entry.status !== 'paused' && entry.status !== 'pausing') {
          entry.status = 'error';
          resolvePending(entry, { reason: 'error' });
        }
      }
      if (name === 'exec') {
        entry.status = 'running';
      }
      if (name === 'state' && payload && typeof payload === 'object') {
        // Mirror status from the snapshot when present. (Pending questions are
        // cleared explicitly on answer/done/error, not from state snapshots.)
        if (payload.status) entry.status = payload.status;
        // Capture the on-disk pipeline short id the orchestrator stamps onto
        // state.id after createPipeline. Guard so null in pre-createPipeline
        // snapshots cannot overwrite a previously-captured value.
        if (typeof payload.id === 'string' && payload.id) {
          const first = !entry.pipelineId;
          entry.pipelineId = payload.id;
          // Scheduled runs: the ticket learns the pipeline it became (provenance columns).
          if (first && entry.ticketId) {
            try { setTicketPipeline(entry.ticketId, payload.id); } catch (err) { console.error(`[worca-ui] ticket link failed: ${err && err.message ? err.message : err}`); }
          }
        }
      }
      if (entry.ticketId && (name === 'done' || name === 'error') && !entry._outcomeRecorded) {
        // Scheduled runs: report how the fired run ended (feed item, failure streak).
        // 'error' is the launch-error channel — a failure before the pipeline row exists.
        entry._outcomeRecorded = true;
        try {
          recordOutcome(entry.ticketId, {
            status: name === 'error' ? 'error' : ((payload && payload.status) || 'done'),
            pipelineId: entry.pipelineId || null,
            reason: (payload && payload.reason) || null,
            detail: (payload && (payload.detail || payload.message)) || null,
          });
          emitChanged('schedules-changed', 'outcome');
        } catch (err) { console.error(`[worca-ui] schedule outcome failed: ${err && err.message ? err.message : err}`); }
      }
      if ((name === 'done' || name === 'error') && !entry._chainNudged) {
        // Run chains: a dependent waits on this run — open its gate now rather than at the next 30 s tick.
        entry._chainNudged = true;
        try {
          const waiting = [...(entry.ticketId ? dependentsOfRun({ ticketId: entry.ticketId }) : []), ...(entry.pipelineId ? dependentsOfRun({ pipelineId: entry.pipelineId }) : [])];
          if (waiting.length) setTimeout(() => { void schedulerTick(); }, 0);
        } catch (err) { console.error(`[worca-ui] chain nudge failed: ${err && err.message ? err.message : err}`); }
      }
      if (name === 'title' && payload && typeof payload.title === 'string') {
        // Keep the in-memory run fresh so a late-joining client's hello
        // (summarizeRuns reads entry.title) sees the settled title.
        entry.title = payload.title;
      }

      record(event);
    });
  }
}

// ---------------------------------------------------------------------------
// Wire a WorkspaceScan's events onto the WebSocket, tagged with scanId. A NEW
// family in the SAME runs Map — the 7-event run plumbing (wireRun) is untouched.
// Maps scan-progress->running, scan-done->done, scan-error->error so the hello
// snapshot + DELETE-while-live guard see a live scan as "running" and a finished
// one as terminal. createWorkspaceScan emits many scan-progress then exactly one
// terminal scan-done OR scan-error (§5.4).
// ---------------------------------------------------------------------------
function wireScan(entry) {
  const { scanId, orch } = entry;

  const record = (event) => {
    // scanId LAST so the runs-Map key always wins (the engine already tags its
    // payload with the same id; this is a defensive override against any drift).
    const tagged = { ...event, scanId };
    entry.events.push(tagged);
    if (entry.events.length > MAX_BUFFER) entry.events.splice(0, entry.events.length - MAX_BUFFER);
    broadcast(tagged);
    return tagged;
  };

  for (const name of SCAN_EVENT_NAMES) {
    subscribe(orch, name, (payload) => {
      const event = { type: name, ...(payload && typeof payload === 'object' ? payload : { value: payload }) };
      if (name === 'scan-progress') entry.status = 'running';
      else if (name === 'scan-done') entry.status = 'done';
      else if (name === 'scan-error') entry.status = 'error';
      record(event);
    });
  }
}

// ---------------------------------------------------------------------------
// Wire an AgentGen's events onto the WebSocket, tagged with genId. The
// agentgen-* family: same runs Map, same ring-buffer/replay plumbing as
// wireScan; the 7-event run plumbing (wireRun) is untouched. createAgentGen
// emits many agentgen-progress then exactly one terminal agentgen-done OR
// agentgen-error (run() never throws).
// ---------------------------------------------------------------------------
function wireAgentGen(entry) {
  const { genId, orch } = entry;

  const record = (event) => {
    // genId LAST so the runs-Map key always wins (the engine already tags its
    // payload with the same id; this is a defensive override against drift).
    const tagged = { ...event, genId };
    entry.events.push(tagged);
    if (entry.events.length > MAX_BUFFER) entry.events.splice(0, entry.events.length - MAX_BUFFER);
    broadcast(tagged);
    return tagged;
  };

  for (const name of AGENTGEN_EVENT_NAMES) {
    subscribe(orch, name, (payload) => {
      const event = { type: name, ...(payload && typeof payload === 'object' ? payload : { value: payload }) };
      if (name === 'agentgen-progress') entry.status = 'running';
      else if (name === 'agentgen-done') entry.status = 'done';
      else if (name === 'agentgen-error') entry.status = 'error';
      record(event);
    });
  }
}

// ---------------------------------------------------------------------------
// Wire a Bench's events onto the WebSocket, tagged with benchId. The
// scriptbench-* family: same runs Map, same ring-buffer/replay plumbing as
// wireAgentGen. createBench emits many scriptbench-line then exactly one
// terminal scriptbench-done OR scriptbench-error (run() never throws). The
// terminal result is kept on the entry: the output route reads its PATHS from
// there, never from the URL, and a reconnecting tab replays the buffer.
// ---------------------------------------------------------------------------
function wireScriptBench(entry) {
  const { benchId, orch } = entry;

  // Every frame carries a per-bench sequence number. The page learns its benchId
  // from the POST answer and THEN subscribes, so for one round trip it receives a
  // frame both live (the broadcast) and replayed (the buffer): `seq` is what lets
  // it keep exactly one. It lives on the entry, not on events.length — the ring
  // buffer is spliced at MAX_BUFFER.
  const record = (event) => {
    entry.seq = (entry.seq || 0) + 1;
    const tagged = { ...event, benchId, seq: entry.seq };
    entry.events.push(tagged);
    if (entry.events.length > MAX_BUFFER) entry.events.splice(0, entry.events.length - MAX_BUFFER);
    broadcast(tagged);
    return tagged;
  };

  for (const name of SCRIPTBENCH_EVENT_NAMES) {
    subscribe(orch, name, (payload) => {
      const event = { type: name, ...(payload && typeof payload === 'object' ? payload : { value: payload }) };
      if (name === 'scriptbench-line') { if (entry.status === 'running' || entry.status === 'created') entry.status = 'running'; }
      else if (name === 'scriptbench-done') {
        // A stop still ends in `done` with a stopped RESULT; the stop route has
        // already marked the entry, so it is not overwritten here.
        if (entry.status !== 'stopped') entry.status = 'done';
        entry.result = (payload && payload.result) || null;
      } else if (name === 'scriptbench-error') entry.status = 'error';
      record(event);
    });
  }
}


// ---------------------------------------------------------------------------
// Teams ingress (chat-connectivity-design.md §4.7) — the ONE deliberate,
// auditable exemption from the loopback guard below: Bot Framework can only
// deliver inbound Teams activities to a public HTTPS endpoint (via a
// user-supplied tunnel), so this route is mounted BEFORE express.json and
// BEFORE the guard. Hardening: capability-URL token (per-channel ingressToken
// secret, timingSafeEqual, uniform 404 on ANY mismatch), 256 KB raw body cap,
// 60 req/min bucket, worker-down 503, 10 s forward timeout 504. The worker
// validates the Bot Framework JWT (issuer/audience/exp/serviceUrl) — bodies
// and Authorization headers are NEVER logged host-side. Everything outside
// /api/ingress stays loopback-guarded even through the tunnel.
// ---------------------------------------------------------------------------
const ingressBucket = new TokenBucket(60);
const INGRESS_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

app.post('/api/ingress/teams/:plugin/:channelId/:token',
  express.raw({ type: '*/*', limit: '256kb' }),
  async (req, res) => {
    const notFound = () => res.status(404).json({ error: 'not found' });
    if (!ingressBucket.tryConsume()) return res.status(429).json({ error: 'rate limited' });
    const { plugin, channelId, token } = req.params;
    if (!INGRESS_ID_RE.test(plugin) || !INGRESS_ID_RE.test(channelId) || typeof token !== 'string' || !token) {
      return notFound();
    }
    let entry;
    try {
      entry = channelHost.list().find((e) => e.plugin === plugin && e.channelId === channelId && e.ingress === 'webhook');
    } catch { entry = null; }
    if (!entry) return notFound();
    let expected = '';
    try { expected = String(readPluginConfig(plugin, entry.configSchema).ingressToken || ''); }
    catch { return notFound(); }
    const got = Buffer.from(token);
    const want = Buffer.from(expected);
    if (!expected || got.length !== want.length || !timingSafeEqual(got, want)) return notFound();

    try {
      const out = await channelHost.handleWebhook({
        plugin,
        channelId,
        method: req.method,
        path: req.path,
        headers: req.headers,
        bodyB64: Buffer.isBuffer(req.body) ? req.body.toString('base64') : '',
        timeoutMs: 10000,
      });
      res.status(out.statusCode || 200);
      for (const [k, v] of Object.entries(out.headers || {})) res.set(k, v);
      if (out.bodyB64) return res.send(Buffer.from(out.bodyB64, 'base64'));
      return res.end();
    } catch (err) {
      if (err?.kind === 'timeout') return res.status(504).json({ error: 'worker timeout' });
      return res.status(503).json({ error: 'channel worker unavailable' });
    }
  });

// ---------------------------------------------------------------------------
// Express middleware + static
// ---------------------------------------------------------------------------

// S1: worca-cc's UI/API has no auth and runs agents with permissionMode
// 'acceptEdits' — it is a single-user *localhost* tool. The server binds to
// loopback (see HOST below); this guard is the DNS-rebinding belt to that
// suspenders: reject any request whose Host (or browser Origin) is not a
// loopback name, so a malicious page resolving a name to 127.0.0.1 still can't
// drive the API. Override WORCA_HOST only if you understand the exposure.
// The one sanctioned exception is a deployment behind an identity proxy:
// WORCA_ALLOWED_HOSTS adds its hostname here, and the identity middleware
// right below then demands the proxy's token (src/core/remote-access.mjs).
//
// FIRST, ahead of the body parser (MIN-108): a refused request must be refused
// before a single byte of its body is parsed or buffered, and a malformed body
// from a non-loopback Host used to answer 400 (with a stack) where a valid one
// answered 403. The ingress webhook above is deliberately mounted EARLIER and
// stays exempt — it carries its own token check and 256 KB cap.
app.use((req, res, next) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: HOST_FORBIDDEN });
  }
  next();
});

// Remote access (src/core/remote-access.mjs): when an identity proxy fronts the
// server, every request must carry a valid token for it — the proxy stays the
// network layer, this is the identity layer, so a misconfigured proxy or an
// accidental public domain still exposes nothing. Also ahead of the body
// parser (MIN-108). /api/health stays open for the platform healthcheck and
// answers only name + version to a remote caller.
app.use((req, res, next) => {
  if (!identityCheck && !REMOTE_ACCESS_CHECK.errors.length) return next(); // local mode: no await
  if (req.method === 'GET' && req.path === '/api/health') return next();
  requestIdentity(req).then((who) => {
    if (!who) {
      return res.status(401).json({ error: 'unauthorized: sign in through the identity proxy (Cloudflare Access)' });
    }
    req.worcaUser = who;
    // One line per person per server lifetime (attribution, not an audit log): email only.
    if (who.email && !SEEN_SIGN_INS.has(who.email)) {
      SEEN_SIGN_INS.add(who.email);
      console.log(`[worca-ui] signed in: ${who.email} (first request since boot)`);
    }
    next();
  }, () => {
    res.status(503).json({ error: 'cannot verify the sign-in token right now' });
  });
});

// Ask threads have an owner (ask_threads.created_by). On a shared deployment (a real per-person
// sign-in, identity.mjs#isSharedIdentity) a person reaches only their own threads and ownerless
// legacy ones: every route under /api/ask/threads/:id answers 404 for someone else's. A local or
// operator deployment is one person, so nothing changes there.
function askViewer(req) {
  const who = resolveIdentity(req);
  return isSharedIdentity(who.source) ? who.name : null;
}
/** Whether a thread's owner is a shared sign-in, for turns with no request (event turns after a
 *  card click): the owner of a thread on a shared deployment is recorded from a verified identity,
 *  so it is shared exactly when this deployment verifies identities. */
function askSharedOwner(thread) {
  return !!(thread && thread.createdBy && thread.createdBy !== 'local' && (identityCheck || process.env.WORCA_IDENTITY_HEADER));
}
function askThreadVisible(thread, req) {
  const viewer = askViewer(req);
  return !viewer || !thread || !thread.createdBy || thread.createdBy === viewer;
}
app.use('/api/ask/threads/:id', (req, res, next) => {
  const viewer = askViewer(req);
  if (!viewer || typeof req.params.id !== 'string' || !ASK_ID_RE.test(req.params.id)) return next();
  let thread = null;
  try { thread = askGetThread(req.params.id); } catch { return next(); }
  if (thread && !askThreadVisible(thread, req)) return res.status(404).json({ error: 'thread not found' });
  next();
});

// Ask attachments ride base64 inside the message JSON (§7.3), and a binary
// attachment (#398) may legitimately be 5 MB — several of them blow the app-wide
// 8mb cap below. Registered BEFORE the global parser on the ONE route that
// carries uploads (a body parsed here is skipped there): every other ask route
// reads a string field or nothing and keeps the 8mb window. 64mb covers
// maxFiles × maxBytesPerBinaryFile at base64's 4/3 inflation, so every
// over-budget upload still reaches the route's OWN clear 400/413, not a raw
// parser error.
app.post('/api/ask/threads/:id/messages', express.json({ limit: '64mb' }));
// A script's saved cases are inline text: 32 cases x 256 KiB PER PORT is legal (workbench
// spec §3.2) and does not fit the global 8 MB, so the one route that saves them all gets room.
app.put('/api/scripts/:key/cases', express.json({ limit: '64mb' }));
app.use(express.json({ limit: '8mb' }));

if (HLJS_ASSETS) {
  const sendHljsModule = (file) => (_req, res, next) => {
    res.type('text/javascript');
    res.set('X-Content-Type-Options', 'nosniff');
    res.sendFile(file, (err) => {
      if (!err) return;
      if (res.headersSent) return next(err);
      next();
    });
  };
  app.get('/vendor/hljs/core.min.js', sendHljsModule(HLJS_ASSETS.core));
  app.get('/vendor/hljs/languages/:file', (req, res, next) => {
    const file = String(req.params.file || '');
    if (!HLJS_LANGUAGE_FILE_RE.test(file) || !HLJS_LANGUAGE_FILES.has(file)) return next();
    const candidate = path.join(HLJS_ASSETS.languages, file);
    try {
      if (!fs.statSync(candidate).isFile()) return next();
    } catch {
      return next();
    }
    return sendHljsModule(candidate)(req, res, next);
  });
}

// Ask Worca §10.7 vendor routes. sendHljsModule's shape, reused verbatim: the
// sendFile error path falls through to the /vendor no-store handlers below.
const sendEsmModule = (file) => (_req, res, next) => {
  res.type('text/javascript');
  res.set('X-Content-Type-Options', 'nosniff');
  res.sendFile(file, (err) => {
    if (!err) return;
    if (res.headersSent) return next(err);
    next();
  });
};
if (ASK_VENDOR_ASSETS.marked) {
  app.get('/vendor/marked/marked.esm.js', sendEsmModule(ASK_VENDOR_ASSETS.marked));
}
if (ASK_VENDOR_ASSETS.dompurify) {
  app.get('/vendor/dompurify/purify.es.mjs', sendEsmModule(ASK_VENDOR_ASSETS.dompurify));
}

app.use('/vendor', (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  res.set('Cache-Control', 'no-store');
  const status = err?.status === 400 ? 400 : 404;
  res.status(status).type('text/plain').send(status === 400 ? 'Bad request' : 'Not found');
});
app.use('/vendor', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(404).type('text/plain').send('Not found');
});

// src/shared/** is the ONE source of the graph model for server + browser
// (no build step). ui modules import it by relative path that walks above
// ui/public; the browser clamps that URL at '/', so it must be served here at
// exactly the repo-relative path. The 404 tail keeps a typo'd path from
// falling through to the SPA index.html (which Chrome reports as a MIME error).
const SHARED_DIR = path.join(PROJECT_ROOT, 'src', 'shared');
app.use('/src/shared', express.static(SHARED_DIR, {
  index: false,
  setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
}));
app.use('/src/shared', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(404).type('text/plain').send('Not found');
});

// The shell is rendered, not static: the stored theme mode goes into
// <html data-theme> so the first paint is already dark or light (dark-mode
// design §5.2). Read per request (100 KB, local) so an index.html edit is live
// without a restart, exactly like static serving was. no-store: a theme change
// must never be served from the browser cache.
// Interface mode (docs/ui-levels.md): the stored choice, else the install's default. "Fresh" =
// the welcome dialog was never dismissed and the store holds no project and no run; anything
// else is an install that predates the mode (or has outgrown it) and keeps the full UI.
function effectiveUiLevel() {
  const stored = storedUiLevel();
  if (stored) return stored;
  let fresh = false;
  try { fresh = !onboardingPrefs().welcomeSeen && countProjects() === 0 && countPipelines() === 0; }
  catch { fresh = false; }
  return defaultUiLevel({ fresh });
}
// "Fresh" is derived from state the user changes (welcomeSeen, the first project), so a new user's
// mode would jump from simple to expert the moment they act. Each of those writes pins the derived
// value first; a stored choice is never overwritten.
async function pinUiLevel() {
  if (!storedUiLevel()) await setUiLevel(effectiveUiLevel());
}
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');
if (!fs.readFileSync(INDEX_FILE, 'utf8').includes(INDEX_THEME_ANCHOR)) {
  throw new Error(`ui/public/index.html lost its theme anchor ${INDEX_THEME_ANCHOR}`);
}
function sendIndex(res) {
  let html;
  try { html = renderIndexHtml(fs.readFileSync(INDEX_FILE, 'utf8'), storedTheme(), effectiveUiLevel()); }
  catch (err) { return res.status(500).json({ error: err && err.message ? err.message : 'shell unavailable' }); }
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.send(html);
}
// `/index` (express.static's `extensions:['html']`) and `/Index.html` on a case-insensitive
// file system would otherwise reach the raw file: route every spelling here.
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path === '/' || /^\/index(\.html)?$/i.test(req.path)) return sendIndex(res);
  return next();
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

function badRequest(res, message) {
  res.status(400).json({ error: message });
}

// A workspace id/key is "wks-<nameSlug>-<sha1[:8]>". WORKSPACE_KEY_RE is imported
// from src/core/workspaces.mjs (one source of truth) and validated against any
// :id/workspaceId before a disk touch: a value failing it can never contain "/"
// or ".." so workspaceStorePath(id) cannot escape the namespace, and a stale
// bookmark reads as "not found" (404), not "bad request".

// Map a workspaces.mjs err.code to an HTTP status. BAD_REQUEST->400,
// DUPLICATE_NAME/DUPLICATE_SET->409, NOT_FOUND->404 (mirrors the thin-delegator
// pattern of /api/projects + /api/workflows). Anything else is a 500 caller bug.
function workspaceErrorStatus(code) {
  if (code === 'DUPLICATE_NAME' || code === 'DUPLICATE_SET') return 409;
  if (code === 'RETAINED_WORKTREE') return 409;   // retained uncommitted work blocks deletion
  if (code === 'NOT_FOUND') return 404;
  if (code === 'BAD_REQUEST') return 400;
  return 500;
}

// Single source of truth for path normalization lives in the core registry.
function resolveProjectDir(input) {
  return normalizeProjectPath(input);
}

// ── Per-project source branches (workspace runs) ──────────────────────────────
// A workspace run may carry a { [projectKey]: sourceBranch } override map. Each
// member's source is its override (when non-blank) else the shared run default;
// the feature branch is always shared (the orchestrator suffixes it per project).
export function buildWorkspaceMembers(projects, branch, sourceByKey = {}) {
  const byKey = sourceByKey && typeof sourceByKey === 'object' ? sourceByKey : {};
  return projects.map((p) => {
    const override = byKey[p.projectKey];
    const source = typeof override === 'string' && override.trim() ? override.trim() : branch.source;
    return { ...p, branch: { source, feature: branch.feature } };
  });
}

// Mirror the shared-source option-injection guard (D2) for every override entry.
// Returns the first leading-dash value found, or null when all entries are safe.
export function firstInjectionSource(sourceByKey = {}) {
  if (!sourceByKey || typeof sourceByKey !== 'object') return null;
  for (const v of Object.values(sourceByKey)) {
    if (typeof v === 'string' && v.trim().startsWith('-')) return v.trim();
  }
  return null;
}

// ── /api/run task-source dispatch (plugins §7.3) ────────────────────────────
// SHAPE-checks body.source only. Resolution (fetching the task, building the
// prompt text, stamping source_type/source_ref) happens inside the orchestrator
// via resolveTaskInput (src/core/sources.mjs) so the task is fetched exactly
// once — the server must never resolve it too.
// Returns null when absent, else { ok:true, source } | { ok:false, error }.
function normalizeRunSource(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'source must be an object' };
  const type = raw.type;
  if (type === 'prompt') {
    if (!(typeof raw.prompt === 'string' && raw.prompt.trim())) {
      return { ok: false, error: 'source.prompt is required for type "prompt"' };
    }
    return { ok: true, source: { type: 'prompt', prompt: raw.prompt } };
  }
  if (type === 'markdown') {
    const promptText = typeof raw.promptText === 'string' && raw.promptText.trim() ? raw.promptText : undefined;
    const promptFile = typeof raw.promptFile === 'string' && raw.promptFile.trim() ? raw.promptFile : undefined;
    if (!promptText && !promptFile) {
      return { ok: false, error: 'source.promptText or source.promptFile is required for type "markdown"' };
    }
    return { ok: true, source: { type: 'markdown', promptText, promptFile } };
  }
  if (type === 'plugin') {
    for (const k of ['plugin', 'sourceId', 'taskId']) {
      if (!(typeof raw[k] === 'string' && raw[k].trim())) {
        return { ok: false, error: `source.${k} is required for type "plugin"` };
      }
    }
    if (raw.profile !== undefined && !isValidProfileId(raw.profile)) {
      return { ok: false, error: 'source.profile is not a valid profile id' };
    }
    return {
      ok: true,
      source: {
        type: 'plugin',
        plugin: raw.plugin.trim(),
        sourceId: raw.sourceId.trim(),
        taskId: raw.taskId.trim(),
        inputs: raw.inputs && typeof raw.inputs === 'object' && !Array.isArray(raw.inputs) ? raw.inputs : undefined,
        // Which configuration of the source the task came from. Absent is legal
        // (single-profile sources); an id that is not path-safe is not.
        profile: typeof raw.profile === 'string' && raw.profile ? raw.profile : undefined,
      },
    };
  }
  return { ok: false, error: `unknown source.type "${type}"` };
}

/**
 * A markdown source that NAMES a promptFile must name one we can read. Resolution
 * happens inside the orchestrator, which this route launches fire-and-forget AFTER
 * it has already answered — so without this submit-time check a bad path surfaces
 * as an anonymous mid-run error event on a pipeline the client was told started.
 * Resolved against the same base the orchestrator uses (the project, or a
 * workspace's primary member).
 * @returns {Promise<string|null>} the error message, or null when there is nothing wrong
 */
async function promptFileProblem(source, projectDir) {
  if (!source || source.type !== 'markdown' || !source.promptFile) return null;
  try {
    await readPromptFile(projectDir, source.promptFile);
    return null;
  } catch (err) {
    return err && err.message ? err.message : String(err);
  }
}

// Fallback run title when the client sends none. The legacy path is unchanged
// (first 80 chars of the prompt — effectivePrompt is guaranteed set there); a
// plugin source starts as "<plugin>: <taskId>" until the orchestrator resolves
// the task and settles the real title via the title event.
function fallbackRunTitle(effectivePrompt, source) {
  if (effectivePrompt) return effectivePrompt.slice(0, 80);
  if (source && source.type === 'plugin') return `${source.plugin}: ${source.taskId}`;
  const text = (source && (source.prompt || source.promptText || source.promptFile)) || 'task';
  return String(text).slice(0, 80);
}

// Wire an Ask Worca follower for a card-linked run: the orchestrator's
// state/question/error/done events become thread notices, ask_run_links patches
// and ask-run-status frames. Used by POST /api/run at launch AND by resumeRun
// (a resumed pipeline is a NEW orchestrator; the paused lineage's follower
// detached on done{paused}, so the link must be re-followed — review of PR #376).
function attachAskFollower(orch, { threadId, runId, cardId }) {
  const follower = attachRunFollower(orch, {
    threadId,
    runId,
    cardId,
    post: ({ text, href }) => {
      try {
        const m = askAppendMessage(threadId, {
          role: 'system', text, blocks: [{ kind: 'notice', text, href }],
        });
        broadcast({ type: 'ask-message', threadId, message: m });
      } catch { /* thread deleted mid-run */ }
    },
    updateStatus: (patch) => {
      try {
        const linkPatch = {};
        if (patch.pipelineId) linkPatch.pipelineId = patch.pipelineId;
        if (patch.status) linkPatch.status = patch.status;
        if (patch.phase !== undefined) linkPatch.phase = patch.phase;
        const row = Object.keys(linkPatch).length
          ? askUpdateRunLink(threadId, runId, linkPatch) : null;
        // The 8-hex History id lands on the FIRST state event (follow.mjs guards
        // "first truthy sight only"), which is the first moment a
        // "sent to #<runId>" marker could point anywhere real. Never the
        // runs-Map UUID, never at launch, and never a resolve.
        if (linkPatch.pipelineId && row && row.commentIds.length) {
          try { stampSentRunId(row.commentIds, linkPatch.pipelineId); } catch { /* best effort */ }
        }
        if (patch.cardFailed && cardId) {
          flipCard(threadId, cardId, { state: 'failed', error: patch.cardFailed });
        }
        broadcast({
          type: 'ask-run-status', threadId, runId,
          pipelineId: (row && row.pipelineId) || patch.pipelineId || null,
          cardId,
          status: patch.status || (row && row.status) || null,
          phase: patch.phase !== undefined ? patch.phase : ((row && row.phase) || null),
        });
      } catch { /* thread deleted mid-run */ }
    },
    onDetached: () => {
      const set = askFollowers.get(threadId);
      if (set) {
        set.delete(follower);
        if (!set.size) askFollowers.delete(threadId);
      }
    },
  });
  let set = askFollowers.get(threadId);
  if (!set) {
    set = new Set();
    askFollowers.set(threadId, set);
  }
  set.add(follower);
}

/** An undetached follower for this (thread, runId) already exists — the proposal launch attached it, or an earlier track_run. */
function askFollowerAttached(threadId, runId) {
  const set = askFollowers.get(threadId);
  return !!set && [...set].some((f) => f.runId === runId && !f.detached);
}

/**
 * track_run's parent-side half (the MCP child only resolves — src/core/ask/tools.mjs is write-free by contract):
 * resolve the run (live entry by UUID or 8-hex, else the pipelines table — the user-pinned scope first, like
 * resolveRow), link it to the thread ONCE per pipeline (D5: a run with no live UUID keys the row by its pipeline
 * id until a live run takes it over; the dedupe is application-level — the PK is (thread, run_id) and linkRun
 * throws on a collision), attach a follower to a live run ONCE per runId (D6), and hand back the progress card's
 * identity. Never throws; a failure is a model-readable {ok:false, error}.
 */
function askTrackRun(threadId, input, pin) {
  const raw = input && typeof input.id === 'string' ? input.id.trim() : '';
  if (!raw) return { ok: false, error: 'id is required' };
  let entry = liveRunEntry(raw);
  let state = null;
  if (entry) {
    if (!entry.pipelineId) return { ok: false, error: 'the run has no pipeline id yet — try again in a moment' };
    state = readPipelineStateById(entry.pipelineId);
  } else {
    const scopeKey = typeof input.projectKey === 'string' && input.projectKey ? input.projectKey
      : typeof input.workspaceId === 'string' && input.workspaceId ? `workspaces/${input.workspaceId}`
        : pin && pin.projectKey ? pin.projectKey : pin && pin.workspaceId ? `workspaces/${pin.workspaceId}` : null;
    const row = (scopeKey ? lookupPipelineRow(scopeKey, raw) : null) || findPipelineRowById(raw);
    if (!row) return { ok: false, error: 'run not found' };
    // The row lookups canonicalise (lower case, the `…-<8hex>` dir-name form); the runs-Map scan compares verbatim.
    // Re-ask with the canonical id so an uppercase or dir-name id still finds the live lineage.
    entry = liveRunEntry(row.id) || null;
    state = readPipelineStateById(row.id);
  }
  if (!state) return { ok: false, error: 'run not found' };
  const pipelineId = state.id;
  const isWs = !!((entry && entry.workspaceId) || state.target === 'workspace');
  const workspaceId = isWs ? ((entry && entry.workspaceId) || state.workspaceId || null) : null;
  const projKey = isWs ? null : ((entry && entry.projectDir) ? projectKey(entry.projectDir) : (state.projectKey || null));
  const label = isWs
    ? (state.workspaceName || (Array.isArray(state.projects) ? state.projects.map((p) => p.projectName).filter(Boolean).join(' · ') : '') || '')
    : String((entry && entry.projectDir) || state.projectDir || '').split(/[\\/]/).filter(Boolean).pop() || (projKey || '');
  const title = (entry && entry.title) || state.title || pipelineId;
  const status = (entry && entry.status) || state.status || null;
  const liveRunId = entry ? entry.id : null;
  // ONE row per (thread, pipeline): by the live UUID first (a proposal launch whose block threw after askLinkRun leaves a
  // uuid row with pipeline_id NULL that no follower fills — adopt it), then by pipeline id. UUID-first also means the
  // patch below never moves a run_id onto a key that already exists (the (thread_id, run_id) PK would throw).
  const links = askListRunLinks(threadId);
  const existing = (liveRunId ? links.find((l) => l.runId === liveRunId) : null) || links.find((l) => l.pipelineId === pipelineId) || null;
  try {
    if (!existing) askLinkRun(threadId, { runId: liveRunId || pipelineId, pipelineId, status });
    else {
      const patch = { status };
      if (!existing.pipelineId) patch.pipelineId = pipelineId;
      if (liveRunId && existing.runId !== liveRunId) patch.runId = liveRunId;
      askUpdateRunLink(threadId, existing.runId, patch);
    }
  } catch (err) {
    return { ok: false, error: `could not link the run: ${err && err.message ? err.message : String(err)}` };
  }
  // Only a run that still drives its pipeline gets a follower: attachRunFollower subscribes unconditionally
  // (follow.mjs:111) and a settled orchestrator never emits again, so it would sit in askFollowers for the life
  // of the thread — and pin a paused lineage's dead orchestrator once resumeRun evicts the entry.
  if (entry && !SETTLED_RUN.has(String(entry.status || '')) && !askFollowerAttached(threadId, entry.id)) {
    attachAskFollower(entry.orch, { threadId, runId: entry.id, cardId: null });
  }
  return { ok: true, card: { type: 'progress', pipelineId, runId: liveRunId, projectKey: projKey, workspaceId, title, label, status } };
}

// ---------------------------------------------------------------------------
// POST /api/run  -> start a new orchestration run
// body (single-project): { projectDir, prompt?, promptMarkdown?, title?, mock? }
// body (workspace):      { workspaceId, prompt?, ... } — mutually exclusive with
//                        projectDir (§2.6). Single-project behavior is byte-identical.
// ---------------------------------------------------------------------------
const startRunHandler = async (req, res) => {
  try {
    const body = req.body || {};
    // Scheduled runs: `internal` is set ONLY by fireTicket() (never from HTTP) — the
    // due ticket being started through this same gate. It carries the ticket, whose id
    // IS the runId, plus the CLI-only options a stored request may hold.
    const internal = req._internal && typeof req._internal === 'object' ? req._internal : null;
    const stored = internal && body.internal && typeof body.internal === 'object' ? body.internal : {};
    // Who started it (identity.mjs): this request's resolved identity; a scheduled run keeps the
    // identity of whoever scheduled it (stored with the request, never taken from an HTTP body).
    // "Run now" credits whoever clicked it (internal.runNowBy, never from HTTP); a timer firing credits the scheduler.
    const startedBy = internal
      ? (typeof internal.runNowBy === 'string' && internal.runNowBy ? internal.runNowBy
        : typeof stored.startedBy === 'string' && stored.startedBy ? stored.startedBy : null)
      : startedByOf(req);

    // Mutual exclusion: exactly one of workspaceId / projectDir (§2.6).
    const hasWorkspace = typeof body.workspaceId === 'string' && body.workspaceId.trim();
    const hasProjectDir = typeof body.projectDir === 'string' && body.projectDir.trim();
    if (hasWorkspace && hasProjectDir) {
      return badRequest(res, 'provide workspaceId OR projectDir, not both');
    }
    if (!hasWorkspace && !hasProjectDir) {
      return badRequest(res, 'workspaceId or projectDir is required');
    }

    // Ask Worca card link (§8.1): both or neither; the thread must exist and
    // the card must still be `proposed` BEFORE any run state is created.
    const hasAskThread = body.askThreadId !== undefined && body.askThreadId !== null;
    const hasAskCard = body.askCardId !== undefined && body.askCardId !== null;
    let askLink = null;
    if (hasAskThread || hasAskCard) {
      if (!hasAskThread || !hasAskCard) {
        return badRequest(res, 'askThreadId and askCardId must be provided together');
      }
      if (typeof body.askThreadId !== 'string' || !ASK_ID_RE.test(body.askThreadId)
        || typeof body.askCardId !== 'string' || !ASK_ID_RE.test(body.askCardId)) {
        return badRequest(res, 'invalid askThreadId or askCardId');
      }
      if (!askGetThread(body.askThreadId)) return badRequest(res, 'unknown askThreadId');
      const found = askFindCard(body.askThreadId, body.askCardId);
      if (!found) return badRequest(res, 'unknown askCardId');
      const ownScheduledCard = internal && found.block.state === 'scheduled' && found.block.runId === internal.ticket.id;
      if (found.block.state !== 'proposed' && !ownScheduledCard) {
        return res.status(409).json({ error: `card is ${found.block.state}` });
      }
      askLink = { threadId: body.askThreadId, cardId: body.askCardId };
    }

    // Scheduled runs: `scheduledFor` (one-shot) and/or `repeat` (recurring) turn this
    // request into a TICKET instead of a run. Parsed here so a bad time is a clean 400
    // before anything else; everything below still validates the request, so a schedule
    // fails fast now and is validated AGAIN when it starts.
    let sched = null;
    if (!internal && (body.scheduledFor != null || body.repeat != null || body.after != null || (body.sourceFromPrevious != null && body.sourceFromPrevious !== false))) {
      const parsed = parseScheduleRequest(body);
      if (!parsed.ok) return badRequest(res, parsed.error);
      sched = parsed;
    }

    // ── Shared resolution (factored BEFORE the target branch, §2.6) ──────────
    // NEW (plugins §7.3): body.source is the task-source descriptor; shape-check
    // only and pass through — the orchestrator resolves it exactly once. Absent
    // -> the legacy branch below runs byte-identical.
    const sourceCheck = normalizeRunSource(body.source);
    if (sourceCheck && !sourceCheck.ok) return badRequest(res, sourceCheck.error);
    const source = sourceCheck ? sourceCheck.source : null;

    // A multiProfile source without a profile would run against the (empty)
    // default bucket and die mid-pipeline with a confusing connector error —
    // reject it here, at submit, where the client can still fix it. The same
    // goes for a profile that is no longer IN the roster (deleted in another
    // tab after the client resolved it) and for a profile supplied to a source
    // that does not use them (it would read a phantom bucket instead of the
    // real config). A broken or uninstalled plugin is left for
    // resolveTaskInput to report.
    if (source && source.type === 'plugin') {
      const m = readInstalledManifest(source.plugin);
      const ts = m && (m.taskSources || []).find((s) => s.id === source.sourceId);
      if (ts && ts.multiProfile) {
        if (!source.profile) {
          return badRequest(res, `source.profile is required — task source "${source.sourceId}" has per-profile configuration`);
        }
        if (!listProfileIds(source.plugin).includes(source.profile)) {
          return badRequest(res, `plugin "${source.plugin}" has no profile "${source.profile}" — it may have been deleted; re-select one`);
        }
      } else if (ts && source.profile) {
        return badRequest(res, `task source "${source.sourceId}" does not use profiles — omit source.profile`);
      }
    }

    // prompt OR promptMarkdown. promptMarkdown is treated as the prompt text.
    const prompt = typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt : undefined;
    const promptMarkdown =
      typeof body.promptMarkdown === 'string' && body.promptMarkdown.trim() ? body.promptMarkdown : undefined;
    const effectivePrompt = prompt || promptMarkdown;
    if (source && effectivePrompt) return badRequest(res, 'provide source OR prompt/promptMarkdown, not both');
    if (!source && !effectivePrompt) return badRequest(res, 'prompt or promptMarkdown is required');

    // UI Markdown runs carry provenance (spec §10): absent an explicit
    // body.source, a promptMarkdown-only body maps to the markdown source type.
    // prompt.md bytes and every legacy guard/message stay identical; only the
    // new source_type column differs ('markdown' instead of the default).
    const effectiveSource = source
      || (promptMarkdown && !prompt ? { type: 'markdown', promptText: promptMarkdown } : null);

    const mock = !!body.mock || isTruthy(process.env.WORCA_MOCK ?? process.env.ORCH_MOCK);

    // Optional workflowId selects a saved (or built-in default) topology. The
    // orchestrator resolves topology + per-project run-config into an executable
    // plan at run start; here we only normalize + reject an unknown id up front
    // so the client gets a clean 400 instead of a mid-run error event.
    const workflowId =
      typeof body.workflowId === 'string' && body.workflowId.trim() ? body.workflowId.trim() : 'wf_default';
    // ONE gate for every run entry point, ONE status: unknown (today's text) and
    // archived (the upgrade explanation the UI shows verbatim) answer 400 through
    // badRequest. A graph row runs on the graph engine — createOrchestratorFor
    // routes it off the row's version.
    let workflowRow;
    try {
      workflowRow = await assertRunnableWorkflow(workflowId);
    } catch (err) {
      return badRequest(res, err && err.message ? err.message : String(err));
    }

    // Auto workflow (spec D19): project targets only in v1. Before the workspace lookup,
    // so an Auto request for ANY workspace id answers 400, never 404.
    if (workflowId === AUTO_WORKFLOW_ID && hasWorkspace) {
      return badRequest(res, 'Auto workflow is not available for workspace targets yet');
    }
    // Agent memory (§7.3): the defragment run option — ONE gate for every entry point (the CLI
    // and Ask's proposal validator call the same helper). Before the target lookup, like Auto.
    if (body.memoryScope != null && typeof body.memoryScope !== 'string') return badRequest(res, 'memoryScope must be "global" or "project"');
    const memoryScope = typeof body.memoryScope === 'string' && body.memoryScope.trim() ? body.memoryScope.trim() : null;
    const scopeReason = validateMemoryScope({ workflowId, memoryScope, isWorkspace: !!hasWorkspace });
    if (scopeReason) return badRequest(res, scopeReason);
    // Settings › Memory: a defragment run may name its model/effort PAIR at start — tier 1, above
    // the setting (memory-defrag-model.mjs). Defragment runs only: every other workflow picks its
    // models per node, and a body model there stays ignored exactly as before. The shape here; the
    // catalog check needs the target project (below).
    let startPair = null;
    if (memoryScope) {
      const shape = checkStartPair(body, null);
      if (shape.error) return badRequest(res, shape.error);
      startPair = shape.pair;
    }
    // Human in the loop (spec D15): the body wins, else the project's stored
    // switch, else on. Resolved per target below (it needs the project dir).
    const bodyHumanInLoop = typeof body.humanInLoop === 'boolean' ? body.humanInLoop : null;

    // Optional guardrailsId selects the named guardrail set that IS this run's
    // policy (applied uniformly to every member — guardrails are per-run only).
    // Absent/blank/null normalizes to 'permissive' — the empty policy,
    // byte-identical legacy spawn — so pre-picker API/CLI callers keep today's
    // behavior. A NON-STRING value is a caller bug and 400s (normalizing it
    // away would silently drop the requested policy). Unknown ids 400 up
    // front, like workflowId.
    if (body.guardrailsId != null && typeof body.guardrailsId !== 'string') {
      return badRequest(res, 'guardrailsId must be a string');
    }
    const guardrailsId =
      typeof body.guardrailsId === 'string' && body.guardrailsId.trim() ? body.guardrailsId.trim() : 'permissive';
    if (!(await readGuardrailSet(guardrailsId))) {
      return badRequest(res, `unknown guardrailsId "${guardrailsId}"`);
    }

    // Budget gate: no new pipelines while the total window is spent (F6).
    const budget = budgetStatus();
    if (budget.blocked && !sched) {
      return res.status(403).json({ error: 'total cost limit reached', budget });
    }

    const runId = internal ? internal.ticket.id : randomUUID();
    const title = (typeof body.title === 'string' && body.title.trim()) || fallbackRunTitle(effectivePrompt, source);

    // Materialize any uploaded extra files to a temp dir; the orchestrator's
    // createPipeline copies them into <pipeline>/extras/.
    // A ticket's extras were staged durably when it was scheduled (the OS temp dir
    // does not survive a reboot); a schedule stages them below, once it is validated.
    const extras = internal
      ? (Array.isArray(stored.extrasPaths) ? stored.extrasPaths.filter((x) => typeof x === 'string' && fs.existsSync(x)) : [])
      : (sched ? [] : await writeExtras(runId, body.extras));

    const branch = {
      source: typeof body.sourceBranch === 'string' && body.sourceBranch.trim()
        ? body.sourceBranch.trim() : null,
      feature: typeof body.featureBranch === 'string' && body.featureBranch.trim()
        ? body.featureBranch.trim() : null,
    };

    let orch, entry;

    if (hasWorkspace) {
      // ── Workspace target (§2.6) ────────────────────────────────────────────
      const workspaceId = body.workspaceId.trim();
      // A stale bookmark / crafted id reads as "not found", not "bad request".
      if (!WORKSPACE_KEY_RE.test(workspaceId)) {
        return res.status(404).json({ error: 'workspace not found' });
      }
      const ws = await readWorkspace(workspaceId);
      if (!ws) return res.status(404).json({ error: 'workspace not found' });

      // Team total cap (design §7): soft — `pastTeamCap` acknowledges it once per window per home.
      {
        const gate = await checkTeamTotalGate({ workspaceId: ws.id }, { pastTeamCap: body.pastTeamCap === true, reason: typeof body.policyReason === 'string' ? body.policyReason : null, by: startedBy });
        if (gate.blocked) return res.status(gate.code === 'reason_required' ? 400 : 403).json({ error: gate.error, code: gate.code, policy: gate.policy, needsPolicyAck: gate.code === 'team_total' });
      }

      // Resolve member detail. Each member must be an existing git repo (D3:
      // per-project worktrees + checkpoints). A vanished member is a hard 400 —
      // skip-missing is NOT allowed; a workspace run is defined over its full set.
      // A member that exists but is no longer a git repo (its .git removed since
      // creation, where createWorkspace enforced isGitRepo) is rejected the same
      // way, so the client gets a clean 400 instead of a mid-run worktree error.
      const projects = [];
      for (const dir of ws.projectPaths) {
        if (!fs.existsSync(dir)) {
          return badRequest(res, 'workspace member path is missing');
        }
        if (!isGitRepo(dir)) {
          return badRequest(res, `workspace member is not a git repository: ${dir}`);
        }
        projects.push({ projectDir: dir, projectKey: projectKey(dir), projectName: path.basename(dir) });
      }
      // Sort by projectKey (the canonical member order used everywhere);
      // projects[0] is the primary (lowest projectKey).
      projects.sort((a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0));

      // D2: sourceBranch/featureBranch are per-project DEFAULTS; do NOT
      // pre-validate against any one repo (the orchestrator resolves each
      // project's default via resolveDefaultBranch). This is the single
      // intentional divergence from the single-project isValidSourceRef guard.
      // Still reject option-injection (a leading dash) on sourceBranch.
      if (branch.source && branch.source.startsWith('-')) {
        return badRequest(res, `unknown or invalid sourceBranch: ${branch.source}`);
      }
      // Per-project source overrides { [projectKey]: branch }. Same injection guard.
      const sourceByKey =
        body.sourceBranchByKey && typeof body.sourceBranchByKey === 'object' && !Array.isArray(body.sourceBranchByKey)
          ? body.sourceBranchByKey
          : {};
      const badOverride = firstInjectionSource(sourceByKey);
      if (badOverride) {
        return badRequest(res, `unknown or invalid sourceBranch: ${badOverride}`);
      }

      const wsFileProblem = await promptFileProblem(effectiveSource, projects[0].projectDir);
      if (wsFileProblem) return badRequest(res, wsFileProblem);

      if (sched && sched.after) {
        const r = resolveAfterRef(sched.after, { workspaceId: ws.id, policy: sched.afterPolicy, isLive: liveProbe });
        if (!r.ok) return badRequest(res, r.error);
        sched.afterRef = r.after;
      }
      if (sched) return res.status(202).json(await scheduleRequest({ body, sched, title, askLink, budget, workspaceId: ws.id, projectDir: projects[0].projectDir, startedBy }));

      orch = await createOrchestratorFor({
        workspace: {
          id: ws.id,
          key: ws.id, // ws.id === workspaceKey(ws); routes artifacts to its store
          name: ws.name,
          description: ws.description,
          projects: buildWorkspaceMembers(projects, branch, sourceByKey),
        },
        prompt: effectivePrompt,
        ...(effectiveSource ? { source: effectiveSource } : {}),
        title,
        extras,
        agentsDir: AGENTS_DIR,
        workflowId,
        template: workflowRow,
        guardrailsId,
        startedBy,
        branch,
        claude: { permissionMode: stored.permissionMode || 'acceptEdits', ...(stored.model ? { model: stored.model } : {}), mock },
        // A CLI-made ticket may carry `--yes`: the explicit non-interactive choice survives the wait.
        ...(stored.auto ? { auto: true } : {}),
      });

      entry = {
        id: runId,
        orch,
        projectDir: projects[0].projectDir, // primary, for back-compat readers
        workspaceId: ws.id,
        kind: 'workspace-run',
        projectNames: projects.map((p) => p.projectName),
        title,
        status: 'starting',
        startedAt: new Date().toISOString(),
        startedBy,
        events: [],
        pendingQuestion: null,
      };
    } else {
      // ── Single-project target (UNCHANGED) ──────────────────────────────────
      const projectDir = resolveProjectDir(body.projectDir);
      if (!projectDir) return badRequest(res, 'projectDir is required');

      if (!fs.existsSync(projectDir)) {
        try {
          await fsp.mkdir(projectDir, { recursive: true });
        } catch (err) {
          return badRequest(res, `cannot create projectDir: ${err.message}`);
        }
      }

      // M1: never hand an unvalidated sourceBranch to `git worktree add`. Reject a
      // leading-dash (option injection) or unknown ref here so the client gets a
      // clean 400 instead of a mid-run error event. featureBranch is sanitized
      // downstream by sanitizeBranchName, so it needs no ref check.
      if (branch.source && !(await isValidSourceRef(projectDir, branch.source))) {
        return badRequest(res, `unknown or invalid sourceBranch: ${branch.source}`);
      }

      const fileProblem = await promptFileProblem(effectiveSource, projectDir);
      if (fileProblem) return badRequest(res, fileProblem);
      // The pair against THIS project's catalog (a schedule is checked here too, before it is
      // stored). A ticket firing takes its already-checked pair verbatim, like a CLI --model.
      if (startPair && !internal) {
        const checked = checkStartPair(body, await listModels(projectDir));
        if (checked.error) return badRequest(res, checked.error);
        startPair = checked.pair;
      }
      // One live defragment run per scope (§7.3, amendment B20: this server process only).
      if (memoryScope) {
        const live = liveDefragRun(memoryScopeKey(memoryScope, projectDir));
        if (live) return res.status(409).json({ error: 'a defragment run for this memory scope is already live', runId: live.id });
      }

      // Team total cap (design §7): soft — `pastTeamCap` acknowledges it once per window per home.
      {
        const gate = await checkTeamTotalGate({ projectDir }, { pastTeamCap: body.pastTeamCap === true, reason: typeof body.policyReason === 'string' ? body.policyReason : null, by: startedBy });
        if (gate.blocked) return res.status(gate.code === 'reason_required' ? 400 : 403).json({ error: gate.error, code: gate.code, policy: gate.policy, needsPolicyAck: gate.code === 'team_total' });
      }
      const humanInLoop = bodyHumanInLoop ?? ((await readRunConfig(projectDir)).humanInLoop !== false);

      if (sched && sched.after) {
        const r = resolveAfterRef(sched.after, { projectDir, policy: sched.afterPolicy, isLive: liveProbe });
        if (!r.ok) return badRequest(res, r.error);
        sched.afterRef = r.after;
      }
      // A schedule stores the pair as checked (the catalog's casing, trimmed): its ticket takes it verbatim.
      const storedBody = startPair ? { ...body, model: startPair.model, effort: startPair.effort || undefined } : body;
      if (sched) return res.status(202).json(await scheduleRequest({ body: storedBody, sched, title, askLink, budget, projectDir, startedBy }));

      orch = await createOrchestratorFor({
        projectDir,
        prompt: effectivePrompt,
        ...(effectiveSource ? { source: effectiveSource } : {}),
        title,
        extras,
        agentsDir: AGENTS_DIR,
        workflowId,
        template: workflowRow,
        guardrailsId,
        startedBy,
        branch,
        humanInLoop,
        ...(memoryScope ? { memoryScope } : {}),
        claude: {
          permissionMode: stored.permissionMode || 'acceptEdits',
          ...(startPair ? { model: startPair.model, ...(startPair.effort ? { effort: startPair.effort } : {}) } : (stored.model ? { model: stored.model } : {})),
          mock,
        },
        // A CLI-made ticket may carry `--yes`: the explicit non-interactive choice survives the wait.
        ...(stored.auto ? { auto: true } : {}),
      });

      entry = {
        id: runId,
        orch,
        projectDir,
        kind: 'run',
        title,
        status: 'starting',
        startedAt: new Date().toISOString(),
        startedBy,
        events: [],
        pendingQuestion: null,
      };
    }

    if (internal) {
      entry.ticketId = internal.ticket.id;
      entry.scheduleId = internal.ticket.scheduleId || null;
      entry.scheduledFor = internal.ticket.runAt;
    }
    runs.set(runId, entry);
    wireRun(entry);
    if (askLink) {
      // Card-state TOCTOU: awaits (source-ref check, budget) sit between Hunk
      // B's `proposed` check and here — a concurrent Start may have flipped
      // the card already. That is a LOST RACE, not a detail to log: the loser
      // must not launch a second pipeline for the same card (review of PR #376).
      // Withdraw the run entry (nothing has run or been announced yet) and 409.
      const still = askFindCard(askLink.threadId, askLink.cardId);
      const stillOwn = internal && still && still.block.state === 'scheduled' && still.block.runId === runId;
      if (!still || (still.block.state !== 'proposed' && !stillOwn)) {
        runs.delete(runId);
        return res.status(409).json({ error: `card is no longer proposed (${still ? still.block.state : 'gone'})` });
      }
      try {
        askLinkRun(askLink.threadId, { runId, cardId: askLink.cardId, status: entry.status });
        flipCard(askLink.threadId, askLink.cardId, { state: 'started', runId });
        // The card's pending comment ids move onto the link row, keyed by the minted
        // UUID exactly as pipeline_id is before it exists. Consumed one-shot: a card
        // launches at most once. Own try/catch — comment bookkeeping must never
        // abort the card flip or the run.
        try {
          // Read, WRITE, then consume — not consume-then-write. A combined take()
          // deletes the rows it returns, so if askUpdateRunLink throws in between (its
          // catch here only logs) the ids are gone and the sent_run_id stamp is lost
          // with no way to recover them. peek/commit keeps the delete on the success
          // path only; a second launch of the same card cannot happen anyway (the
          // card must be in state 'proposed' above).
          const pendingComments = peekPendingCardComments(askLink.cardId);
          if (pendingComments.length) {
            askUpdateRunLink(askLink.threadId, runId, { commentIds: pendingComments });
            clearPendingCardComments(askLink.cardId);
          }
        } catch (e) { console.error('[diff-comments] pending-card handoff failed:', e && e.message ? e.message : e); }
        const startedMsg = askAppendMessage(askLink.threadId, {
          role: 'system',
          text: `Run started — "${title}"`,
          blocks: [{ kind: 'notice', text: `Run started — "${title}"`, href: `#running/${runId}` }],
        });
        broadcast({ type: 'ask-message', threadId: askLink.threadId, message: startedMsg });
        attachAskFollower(orch, { threadId: askLink.threadId, runId, cardId: askLink.cardId });
      } catch (err) {
        console.error(`[worca-ui] ask run link failed: ${err && err.message ? err.message : err}`);
      }
    }
    announceRun(entry);

    // Fire-and-forget; all progress is surfaced through events.
    Promise.resolve()
      .then(() => orch.run())
      .catch((err) => {
        const event = { runId, type: 'error', message: err && err.message ? err.message : String(err) };
        entry.status = 'error';
        entry.events.push(event);
        broadcast(event);
      });

    res.json({ runId });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
};
app.post('/api/run', startRunHandler);

// ---------------------------------------------------------------------------
// Scheduled runs (schema v31, src/core/scheduler.mjs). A schedule is a TICKET, not a
// pipeline: POST /api/run with `scheduledFor` and/or `repeat` validates the request
// exactly like a run, stores it, and answers 202. The tick below claims due tickets
// and pushes each one back through startRunHandler — so a scheduled run is validated
// twice and born through the one start path every run uses.
// ---------------------------------------------------------------------------
const TRANSIENT_SOURCE_KINDS = new Set(['network', 'rate-limit', 'timeout']);
const SCHEDULER_TICK_MS = 30_000;
const SCHEDULER_STAGGER_MS = 3_000;

/** Validate `scheduledFor` / `repeat` / `ifMissed` / `graceMin` on a run body. */
function parseScheduleRequest(body, { now = Date.now() } = {}) {
  const defaults = scheduleDefaults();
  const out = { ok: true, runAtMs: null, repeat: null, after: null, afterPolicy: 'done', sourceFromPrevious: false, ifMissed: defaults.ifMissed, graceMin: defaults.graceMin };
  const given = ['scheduledFor', 'repeat', 'after'].filter((k) => body[k] != null);
  if (given.length > 1) return { ok: false, error: 'provide scheduledFor, repeat OR after, not both' };
  if (body.sourceFromPrevious != null && typeof body.sourceFromPrevious !== 'boolean') return { ok: false, error: 'sourceFromPrevious must be true or false' };
  if (body.sourceFromPrevious === true && body.after == null) return { ok: false, error: 'sourceFromPrevious needs after' };
  if (body.after != null) {
    const a = body.after;
    if (!a || typeof a !== 'object' || Array.isArray(a) || !['ticket', 'pipeline'].includes(a.kind) || typeof a.id !== 'string' || !a.id.trim()) {
      return { ok: false, error: 'after must be { kind: ticket | pipeline, id }' };
    }
    if (body.ifMissed != null || body.graceMin != null) return { ok: false, error: 'ifMissed and graceMin do not apply to a run after another run' };
    if (body.afterPolicy != null && !AFTER_POLICIES.includes(body.afterPolicy)) return { ok: false, error: `afterPolicy must be one of ${AFTER_POLICIES.join(' | ')}` };
    if (body.sourceFromPrevious === true && (body.sourceBranch != null || body.sourceBranchByKey != null)) return { ok: false, error: 'sourceFromPrevious and sourceBranch / sourceBranchByKey cannot both be given' };
    out.after = { kind: a.kind, id: a.id.trim() };
    out.afterPolicy = body.afterPolicy || 'done';
    out.sourceFromPrevious = body.sourceFromPrevious === true;
    return out;
  }
  if (body.ifMissed != null) {
    if (!MISSED_POLICIES.includes(body.ifMissed)) return { ok: false, error: `ifMissed must be one of ${MISSED_POLICIES.join(' | ')}` };
    out.ifMissed = body.ifMissed;
  }
  if (body.graceMin != null) {
    if (!Number.isSafeInteger(body.graceMin) || body.graceMin < 0 || body.graceMin > 10080) return { ok: false, error: 'graceMin must be a whole number of minutes from 0 to 10080' };
    out.graceMin = body.graceMin;
  }
  if (body.repeat != null) {
    if (body.scheduledFor != null) return { ok: false, error: 'provide scheduledFor (run once) OR repeat (recurring), not both' };
    const rep = body.repeat;
    if (!rep || typeof rep !== 'object' || Array.isArray(rep)) return { ok: false, error: 'repeat must be an object: { rule, overlap?, maxFailures? }' };
    const tz = rep.rule && typeof rep.rule === 'object' ? rep.rule.tz : null;
    const norm = normalizeRule(rep.rule, { todayLocal: isValidTimeZone(tz) ? localDate(now, tz) : null });
    if (!norm.ok) return { ok: false, error: norm.error };
    if (rep.overlap != null && !OVERLAP_POLICIES.includes(rep.overlap)) return { ok: false, error: `repeat.overlap must be one of ${OVERLAP_POLICIES.join(' | ')}` };
    if (rep.maxFailures != null && (!Number.isSafeInteger(rep.maxFailures) || rep.maxFailures < 0 || rep.maxFailures > 100)) {
      return { ok: false, error: 'repeat.maxFailures must be a whole number from 0 to 100 (0 = never pause)' };
    }
    if (nextOccurrence(norm.rule, now) == null) return { ok: false, error: 'repeat.rule has no future occurrence' };
    out.repeat = { rule: norm.rule, overlap: rep.overlap || 'skip', maxFailures: rep.maxFailures ?? defaults.maxFailures };
    return out;
  }
  const at = parseScheduledFor(body.scheduledFor);
  if (!at.ok) return { ok: false, error: at.error };
  if (at.ms < now - 5_000) return { ok: false, error: 'scheduledFor is in the past' };
  out.runAtMs = at.ms;
  return out;
}

/** The request a ticket stores: the validated body minus schedule fields and uploads. */
async function storedRequestOf(body, stageId, projectDir, startedBy = null) {
  const request = { ...body };
  for (const k of ['scheduledFor', 'repeat', 'after', 'afterPolicy', 'sourceFromPrevious', 'ifMissed', 'graceMin', 'extras', 'internal']) delete request[k];
  // Text the user authored is part of the request: a prompt FILE is frozen now, so a
  // file deleted or half-edited overnight cannot fail an unattended run.
  if (request.source && request.source.type === 'markdown' && request.source.promptFile && !request.source.promptText) {
    const promptText = await readPromptFile(projectDir, request.source.promptFile);
    request.source = { type: 'markdown', promptText };
  }
  const extrasPaths = await writeExtras(stageId, body.extras, path.join(scheduleStageDir(stageId), 'extras'));
  request.internal = { extrasPaths, ...(startedBy ? { startedBy } : {}) };
  return request;
}

/** Turn a validated run request into a ticket (or a recurring schedule). 202 body. */
async function scheduleRequest({ body, sched, title, askLink, budget, projectDir, workspaceId = null, startedBy = null }) {
  const target = workspaceId ? { workspaceId } : { projectDir };
  let ticket, schedule = null;
  if (sched.repeat) {
    const id = `sch_${randomBytes(4).toString('hex')}`;
    const request = await storedRequestOf(body, id, projectDir, startedBy);
    ({ schedule, ticket } = createSchedule({
      id, title, ...target, request, rule: sched.repeat.rule, overlap: sched.repeat.overlap,
      maxFailures: sched.repeat.maxFailures, ifMissed: sched.ifMissed, graceMin: sched.graceMin,
      askThreadId: askLink ? askLink.threadId : null, askCardId: askLink ? askLink.cardId : null,
      createdBy: startedBy,
    }));
    // An Ask card that became a repeating schedule follows the SERIES, not one run of it.
    if (askLink) {
      try { flipCard(askLink.threadId, askLink.cardId, { state: 'scheduled', runId: null, scheduleId: schedule.id, sentence: schedule.sentence, scheduledFor: ticket ? ticket.runAt : null }); }
      catch (err) { console.error(`[worca-ui] ask card schedule flip failed: ${err && err.message ? err.message : err}`); }
    }
  } else {
    const id = randomUUID();
    const request = await storedRequestOf(body, id, projectDir, startedBy);
    // Both arms carry ifMissed / graceMin: parseScheduleRequest filled them with the Settings defaults
    // (an after body may not name them), and a chained ticket later moved to a time shows them.
    const chain = sched.after ? {
      after: { kind: sched.afterRef.kind, id: sched.afterRef.id }, afterPolicy: sched.afterPolicy, sourceFromPrevious: sched.sourceFromPrevious, ifMissed: sched.ifMissed, graceMin: sched.graceMin,
    } : { runAtMs: sched.runAtMs, ifMissed: sched.ifMissed, graceMin: sched.graceMin };
    ticket = createTicket({ id, title, ...target, request, ...chain, askThreadId: askLink ? askLink.threadId : null, askCardId: askLink ? askLink.cardId : null, createdBy: startedBy });
    if (askLink) {
      try { flipCard(askLink.threadId, askLink.cardId, { state: 'scheduled', runId: id, scheduledFor: sched.after ? null : ticket.runAt, after: sched.after ? { kind: sched.afterRef.kind, id: sched.afterRef.id, title: sched.afterRef.title } : null }); }
      catch (err) { console.error(`[worca-ui] ask card schedule flip failed: ${err && err.message ? err.message : err}`); }
    }
  }
  emitChanged('schedules-changed', 'created');
  return {
    runId: ticket ? ticket.id : null,
    status: 'scheduled',
    scheduledFor: ticket && !ticket.after ? ticket.runAt : null,
    ...(ticket && ticket.after ? { after: { kind: sched.afterRef.kind, id: sched.afterRef.id, title: sched.afterRef.title }, sourceFromPrevious: ticket.sourceFromPrevious } : {}),
    ...(schedule ? { scheduleId: schedule.id, sentence: schedule.sentence } : {}),
    ...(budget && budget.blocked ? { budgetWarning: 'The total cost limit is reached right now. The run will only start if the budget allows it at that time.' } : {}),
  };
}

/** An Ask card that was scheduled goes back to `proposed` when its ticket dies or its series is deleted. */
function releaseAskCard(item) {
  if (!item || !item.askThreadId || !item.askCardId) return;
  try {
    const found = askFindCard(item.askThreadId, item.askCardId);
    const b = found && found.block;
    if (b && b.state === 'scheduled' && (item.kind === 'recurring' ? b.scheduleId === item.id : b.runId === item.id)) {
      flipCard(item.askThreadId, item.askCardId, { state: 'proposed', runId: null, scheduledFor: null, scheduleId: null, sentence: null });
    }
  } catch (err) { console.error(`[worca-ui] ask card release failed: ${err && err.message ? err.message : err}`); }
}

/** Call startRunHandler without HTTP. Resolves { status, body }. */
async function invokeStartRun(body, internal) {
  let out = { status: 200, body: null };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { out = { status: this.statusCode, body: payload }; return this; },
  };
  await startRunHandler({ body, _internal: internal }, res);
  return out;
}

/** Ticket id -> who clicked "Run now" (identity.mjs actor), consumed by the firing it causes. */
const RUN_NOW_BY = new Map();

/** runDueTickets' `start`: probe an external task first (transient errors retry), then start. */
async function fireTicket(ticket) {
  const body = { ...(ticket.request || {}) };
  if (body.source && body.source.type === 'plugin') {
    try {
      await resolveTaskInput(body.source, { projectDir: ticket.projectDir || undefined });
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err), transient: TRANSIENT_SOURCE_KINDS.has(err && err.kind) };
    }
  }
  if (ticket.after) {
    const p = predecessorState(ticket.after, { policy: ticket.after.policy, isLive: liveProbe });
    if (p.state === 'waiting' && !ticket.forced) return { ok: false, error: 'the run before it is still going', transient: true };
    if (ticket.sourceFromPrevious) {
      const prev = p.pipelineId ? previousBranchesOf(p.pipelineId) : null;
      if (!prev) return { ok: false, error: 'the run before it left no branch to start from', transient: false };
      if (prev.sourceBranch) {
        if (!(await isValidSourceRef(ticket.projectDir, prev.sourceBranch))) return { ok: false, error: `branch ${prev.sourceBranch} no longer exists`, transient: false };
      } else {
        const ws = ticket.workspaceId ? await readWorkspace(ticket.workspaceId) : null;
        if (!ws) return { ok: false, error: 'workspace not found', transient: false };
        for (const dir of ws.projectPaths) {
          const key = projectKey(dir);
          const br = prev.sourceBranchByKey[key];
          if (!br) return { ok: false, error: `the run before it has no branch for ${path.basename(dir)}`, transient: false };
          if (!(await isValidSourceRef(dir, br))) return { ok: false, error: `branch ${br} no longer exists in ${path.basename(dir)}`, transient: false };
        }
      }
      delete body.sourceBranch; delete body.sourceBranchByKey;
      Object.assign(body, prev);
    }
  }
  // Every occurrence of a series needs its own feature branch.
  if (ticket.scheduleId && typeof body.featureBranch === 'string' && body.featureBranch.trim()) {
    const s = getSchedule(ticket.scheduleId);
    const day = (s && s.tz ? localDate(Date.parse(ticket.runAt), s.tz) : ticket.runAt.slice(0, 10)).replace(/-/g, '');
    body.featureBranch = `${body.featureBranch.trim()}-${day}`;
  }
  // A "Run now" click names its clicker for this one firing (scheduleVerb records it).
  const runNowBy = RUN_NOW_BY.get(ticket.id) || null;
  RUN_NOW_BY.delete(ticket.id);
  const out = await invokeStartRun(body, { ticket, ...(runNowBy ? { runNowBy } : {}) });
  if (out.status === 200 && out.body && out.body.runId) return { ok: true };
  const error = (out.body && out.body.error) || `the run could not be started (HTTP ${out.status})`;
  return { ok: false, error, transient: out.status >= 500 };
}

/** The host's in-memory view of a run: by run id, or by the pipeline id it became. liveRunEntry is the
 *  house lookup: it skips scans / agentgens / benches and, on a resumed lineage (D23), prefers the entry
 *  still driving the pipeline over a settled same-pipeline entry that sits earlier in Map order. */
function liveProbe({ id, pipelineId }) {
  const e = liveRunEntry(id) || (pipelineId ? liveRunEntry(pipelineId) : null);
  return !!e && !SETTLED_RUN.has(String(e.status || ''));
}

let _schedulerBusy = false;
let _lastNotificationId = -1;
let _lastScheduleSig = null;

/** One scheduler pass. Exported for tests; the server calls it on a 30 s timer. */
export async function schedulerTick({ now = Date.now() } = {}) {
  if (_schedulerBusy) return null;
  _schedulerBusy = true;
  try {
    const out = await runDueTickets({
      now,
      start: fireTicket,
      isLive: liveProbe,
      staggerMs: SCHEDULER_STAGGER_MS,
    });
    for (const id of [...out.failed, ...out.missed]) releaseAskCard(getTicket(id));
    if (out.fired.length || out.missed.length || out.skipped.length || out.failed.length || out.retried.length) {
      emitChanged('schedules-changed', 'tick');
    }
    // A `--wait` CLI writes notifications from ITS process: notice them here.
    const latest = latestNotificationId();
    if (_lastNotificationId !== -1 && latest !== _lastNotificationId) emitChanged('notifications-changed');
    _lastNotificationId = latest;
    // ...and the CLI writes tickets straight into the shared DB: notice those too.
    const sig = scheduleSignature();
    if (_lastScheduleSig !== null && sig !== _lastScheduleSig && !out.fired.length) emitChanged('schedules-changed', 'external');
    _lastScheduleSig = sig;
    return out;
  } catch (err) {
    console.error(`[worca-ui] scheduler tick failed: ${err && err.message ? err.message : err}`);
    return null;
  } finally {
    _schedulerBusy = false;
  }
}

let _schedulerTimer = null;
/** Start the scheduler: recover, run one pass now (boot catch-up), then tick. */
export function startScheduler() {
  if (_schedulerTimer) return () => {};
  try {
    const recovered = recoverScheduler();
    if (recovered) console.log(`[worca-ui] scheduler: returned ${recovered} interrupted ticket(s) to the queue`);
    const purged = purgeScheduler();
    purgeNotifications();
    if (purged.tickets || purged.schedules) console.log(`[worca-ui] scheduler: purged ${purged.tickets} old ticket(s), ${purged.schedules} ended schedule(s)`);
  } catch (err) { console.error(`[worca-ui] scheduler recovery failed: ${err && err.message ? err.message : err}`); }
  schedulerTick();
  _schedulerTimer = setInterval(() => { schedulerTick(); }, SCHEDULER_TICK_MS);
  _schedulerTimer.unref();
  return () => { clearInterval(_schedulerTimer); _schedulerTimer = null; };
}

// Notifications written in THIS process reach open tabs at once, and chat.
onNotification((n) => {
  broadcast({ type: 'notification', notification: n });
  try { chatNotifier.notifySchedule(n); } catch { /* never break the writer */ }
});

/** A schedule item (ticket or series) by id, for the unified /api/schedules routes. */
function findScheduleItem(id) {
  if (typeof id !== 'string' || !id) return null;
  if (id.startsWith('sch_')) { const s = getSchedule(id); return s ? { kind: 'recurring', item: s } : null; }
  const t = getTicket(id);
  return t ? { kind: 'once', item: t } : null;
}

/** A ticket for the wire: its predecessor resolved for display (title, live status, pipeline). */
function withAfter(t) {
  if (!t || !t.after) return t;
  const p = predecessorState(t.after, { policy: t.after.policy, isLive: liveProbe });
  return { ...t, after: { ...t.after, title: p.title || null, status: p.status || null, pipelineId: p.pipelineId || null } };
}

// GET /api/schedules[?projectDir=|workspaceId=][&all=1] -> { schedules, tickets, counts, defaults }
app.get('/api/schedules', (req, res) => {
  try {
    const projectDir = resolveProjectDir(req.query.projectDir) || null;
    const workspaceId = typeof req.query.workspaceId === 'string' && req.query.workspaceId.trim() ? req.query.workspaceId.trim() : null;
    const all = req.query.all === '1' || req.query.all === 'true';
    res.json({
      schedules: listSchedules({ projectDir, workspaceId }),
      tickets: listTickets({ projectDir, workspaceId, all }).map(withAfter),
      counts: { ...scheduleCounts(), unread: unreadCount('schedule', { reader: notifReader(req) }) },
      defaults: scheduleDefaults(),
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/schedules/preview { rule, count? } -> { sentence, next: [iso…] }
app.post('/api/schedules/preview', (req, res) => {
  const body = req.body || {};
  const tz = body.rule && typeof body.rule === 'object' ? body.rule.tz : null;
  const norm = normalizeRule(body.rule, { todayLocal: isValidTimeZone(tz) ? localDate(Date.now(), tz) : null });
  if (!norm.ok) return badRequest(res, norm.error);
  const n = Number.isSafeInteger(body.count) ? Math.max(1, Math.min(10, body.count)) : 3;
  res.json({ rule: norm.rule, sentence: describeRule(norm.rule), next: previewOccurrences(norm.rule, Date.now(), n).map((t) => new Date(t).toISOString()) });
});

// GET /api/schedules/dependents?workflowId=|projectDir=|workspaceId= -> what a removal
// would strand, so the confirmation can NAME it.
app.get('/api/schedules/dependents', (req, res) => {
  const q = req.query;
  const label = (x) => ({ id: x.id, kind: x.kind, title: x.title });
  if (typeof q.workflowId === 'string' && q.workflowId) return res.json({ dependents: dependentsOfWorkflow(q.workflowId) });
  if (typeof q.pipelineId === 'string' && q.pipelineId) return res.json({ dependents: dependentsOfRun({ pipelineId: q.pipelineId }) });
  if (typeof q.ticketId === 'string' && q.ticketId) return res.json({ dependents: dependentsOfRun({ ticketId: q.ticketId }) });
  const projectDir = resolveProjectDir(q.projectDir) || null;
  const workspaceId = typeof q.workspaceId === 'string' && q.workspaceId.trim() ? q.workspaceId.trim() : null;
  if (!projectDir && !workspaceId) return badRequest(res, 'workflowId, projectDir or workspaceId is required');
  res.json({
    dependents: [
      ...listSchedules({ projectDir, workspaceId, includeEnded: false }).map(label),
      ...listTickets({ projectDir, workspaceId, oneShotOnly: true }).map(label),
    ],
  });
});

// GET /api/schedules/after-candidates?projectDir=|workspaceId= -> what a new run may wait for:
// live runs of that target and its one-off tickets that have not ended.
app.get('/api/schedules/after-candidates', (req, res) => {
  try {
    const projectDir = resolveProjectDir(req.query.projectDir) || null;
    const workspaceId = typeof req.query.workspaceId === 'string' && req.query.workspaceId.trim() ? req.query.workspaceId.trim() : null;
    if (!projectDir && !workspaceId) return badRequest(res, 'projectDir or workspaceId is required');
    // The ROWS are the source of truth (spec §5): SETTLED_RUN contains 'paused', and another
    // process's run is not in this host's runs Map at all. The Map only adds live runIds.
    const where = workspaceId ? 'workspace_key = ?' : "project_key = ? AND target = 'project'";
    const rows = getDb().prepare(`SELECT id, title, status FROM pipelines WHERE ${where}
      AND status IN ('created', 'starting', 'running', 'pausing', 'paused') AND archived_at IS NULL ORDER BY started_at DESC LIMIT 50`)
      .all(workspaceId || projectKey(projectDir));
    const byPipeline = new Map(rows.map((r) => [r.id, { pipelineId: r.id, runId: null, title: r.title || null, status: r.status }]));
    for (const r of runs.values()) {
      if (!r.pipelineId || (r.kind && r.kind !== 'run' && r.kind !== 'workspace-run')) continue;
      if (workspaceId ? r.workspaceId !== workspaceId : (r.projectDir !== projectDir || r.workspaceId)) continue;
      const stillGoing = !SETTLED_RUN.has(String(r.status || '')) || r.status === 'paused';
      if (!stillGoing) continue;
      const cur = byPipeline.get(r.pipelineId) || { pipelineId: r.pipelineId, title: r.title || null, status: r.status };
      byPipeline.set(r.pipelineId, { ...cur, runId: r.id, status: r.status });
    }
    // listTickets({ oneShotOnly: true }) returns scheduled | firing | missed. A MISSED ticket is left
    // out: resolveAfterRef refuses it under either policy ("‘X’ was missed — nothing to wait for"),
    // so offering it would be a dead pick (spec §5 lists it; this is the one deliberate narrowing).
    const tickets = listTickets({ projectDir, workspaceId, oneShotOnly: true })
      .filter((t) => t.status !== 'missed')
      .map((t) => ({ id: t.id, title: t.title, status: t.status, after: t.after ? { kind: t.after.kind, id: t.after.id } : null }));
    res.json({ runs: [...byPipeline.values()], tickets });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// GET /api/schedules/after/:id -> one predecessor and its target (the #new/after/<id> deep link).
// async (listProjects is async) — and therefore wrapped: Express 4 does not catch a rejected
// handler, and the deep link's fetch would hang instead of showing an error line.
app.get('/api/schedules/after/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (id.startsWith('sch_')) return badRequest(res, 'after a repeating schedule is not supported — give the id of one of its runs');
    const ref = afterRefOf(id);
    if (!ref || ref.scheduleId) return res.status(404).json({ error: 'run not found' });
    let projectDir = null;
    if (ref.kind === 'ticket') projectDir = (getTicket(ref.id) || {}).projectDir || null;   // a purge between the two reads is a null, not a throw
    else if (!ref.workspaceId) {
      const projects = await listProjects();
      projectDir = (projects.find((p) => projectKey(p.path) === ref.projectKey) || {}).path || null;
    }
    res.json({ kind: ref.kind, id: ref.id, title: ref.title, status: ref.status, projectDir, workspaceId: ref.workspaceId || null });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/schedules/:id', (req, res) => {
  const found = findScheduleItem(req.params.id);
  if (!found) return res.status(404).json({ error: 'schedule not found' });
  const history = found.kind === 'recurring' ? listTickets({ scheduleId: found.item.id, all: true, limit: 50 }).reverse() : [];
  res.json({ ...found, item: found.kind === 'once' ? withAfter(found.item) : found.item, history, notifications: listNotifications({ scheduleId: found.kind === 'recurring' ? found.item.id : null, limit: 50, reader: notifReader(req) }).filter((n) => found.kind === 'recurring' || n.ticketId === found.item.id) });
});

// One schedule change, for the REST routes AND an applied Ask Worca schedule card — so the
// card does exactly what the button on the Schedules page does. Resolves { status, body }.
//   verb 'patch'     a ticket: { scheduledFor?, ifMissed?, graceMin? }
//                    a series: { title?, rule?, overlap?, maxFailures?, ifMissed?, graceMin? }
//   verb 'delete'    cancel a one-off ticket, or delete a series
//   verb 'run-now'   start a ticket now, or one extra occurrence of a series
//   verb 'pause' | 'resume' | 'skip-next'   a series only
async function scheduleVerb(verb, id, body = {}, { by = null } = {}) {
  const found = findScheduleItem(id);
  const out = (status, payload) => ({ status, body: payload });
  if (!found) return out(404, { error: 'schedule not found' });
  if (verb === 'patch') {
    try {
      if (found.kind === 'once') {
        const patch = {};
        if (body.scheduledFor != null) {
          const at = parseScheduledFor(body.scheduledFor);
          if (!at.ok) return out(400, { error: at.error });
          if (at.ms < Date.now() - 5_000) return out(400, { error: 'scheduledFor is in the past' });
          patch.runAtMs = at.ms;
        }
        if (body.ifMissed != null) {
          if (!MISSED_POLICIES.includes(body.ifMissed)) return out(400, { error: `ifMissed must be one of ${MISSED_POLICIES.join(' | ')}` });
          patch.ifMissed = body.ifMissed;
        }
        if (body.graceMin != null) patch.graceMin = body.graceMin;
        if (body.after != null) {
          if (body.scheduledFor != null) return out(400, { error: 'provide scheduledFor OR after, not both' });
          if (body.ifMissed != null || body.graceMin != null) return out(400, { error: 'ifMissed and graceMin do not apply to a run after another run' });
          const policy = body.afterPolicy != null ? body.afterPolicy : (found.item.after ? found.item.after.policy : 'done');
          if (!AFTER_POLICIES.includes(policy)) return out(400, { error: `afterPolicy must be one of ${AFTER_POLICIES.join(' | ')}` });
          const r = resolveAfterRef(body.after, { projectDir: found.item.projectDir, workspaceId: found.item.workspaceId, policy, selfId: found.item.id, isLive: liveProbe });
          if (!r.ok) return out(400, { error: r.error });
          patch.after = { kind: r.after.kind, id: r.after.id };
          patch.afterPolicy = policy;
        } else if (body.afterPolicy != null) {
          if (!AFTER_POLICIES.includes(body.afterPolicy)) return out(400, { error: `afterPolicy must be one of ${AFTER_POLICIES.join(' | ')}` });
          // A timed ticket has no policy (updateTicket drops one sent with runAtMs); say so rather than accept and
          // ignore — for a policy sent WITH a time, and for one sent ALONE to a ticket that has no predecessor
          // (that wrote after_policy onto a row with after_id NULL: harmless, but a lie in the row).
          if (patch.runAtMs != null || !found.item.after) return out(400, { error: 'afterPolicy does not apply to a run at a time' });
          patch.afterPolicy = body.afterPolicy;
        }
        if (body.sourceFromPrevious != null) {
          if (typeof body.sourceFromPrevious !== 'boolean') return out(400, { error: 'sourceFromPrevious must be true or false' });
          // Needs a predecessor AFTER this patch: none on the row and none coming, or a move back to a time
          // (which clears after_* — `source_from_previous = 1` with `after_id = NULL` must never be written).
          if (body.sourceFromPrevious && (patch.runAtMs != null || (!patch.after && !found.item.after))) return out(400, { error: 'sourceFromPrevious needs after' });
          patch.sourceFromPrevious = body.sourceFromPrevious;
        }
        if (found.item.scheduleId && (patch.runAtMs != null || patch.after)) return out(400, { error: 'an occurrence of a repeating schedule cannot be moved — edit the schedule, or skip this occurrence' });
        const t = updateTicket(found.item.id, patch, { by: by || undefined });
        if (!t) return out(409, { error: `this run is ${found.item.status} and can no longer be changed` });
        const item = withAfter(t);
        if (t.askThreadId && t.askCardId && (patch.runAtMs != null || patch.after)) {
          try { flipCard(t.askThreadId, t.askCardId, { scheduledFor: t.after ? null : t.runAt, after: t.after ? { kind: t.after.kind, id: t.after.id, title: item.after.title } : null }); } catch { /* display only */ }
        }
        emitChanged('schedules-changed', 'updated');
        emitChanged('notifications-changed');
        return out(200, { kind: 'once', item });
      }
      const patch = {};
      for (const k of ['title', 'rule', 'overlap', 'maxFailures', 'ifMissed', 'graceMin']) if (body[k] !== undefined) patch[k] = body[k];
      if (patch.rule && typeof patch.rule === 'object' && !isValidTimeZone(patch.rule.tz)) return out(400, { error: `rule.tz is not a known timezone: ${patch.rule.tz ?? '(missing)'}` });
      if (patch.maxFailures !== undefined && (!Number.isSafeInteger(patch.maxFailures) || patch.maxFailures < 0 || patch.maxFailures > 100)) {
        return out(400, { error: 'maxFailures must be a whole number from 0 to 100 (0 = never pause)' });
      }
      if (patch.graceMin !== undefined && (!Number.isSafeInteger(patch.graceMin) || patch.graceMin < 0 || patch.graceMin > 10080)) {
        return out(400, { error: 'graceMin must be a whole number of minutes from 0 to 10080' });
      }
      const s = updateSchedule(found.item.id, patch, { by: by || undefined });
      if (s && s.askThreadId && s.askCardId && patch.rule) {
        try { flipCard(s.askThreadId, s.askCardId, { sentence: s.sentence, scheduledFor: s.nextRunAt }); } catch { /* display only */ }
      }
      emitChanged('schedules-changed', 'updated');
      return out(200, { kind: 'recurring', item: s });
    } catch (err) {
      return out(400, { error: err && err.message ? err.message : String(err) });
    }
  }
  if (verb === 'delete') {
    if (found.kind === 'recurring') {
      deleteSchedule(found.item.id);
      releaseAskCard(found.item);
    } else {
      if (found.item.scheduleId) return out(400, { error: 'this is an occurrence of a repeating schedule — skip it instead' });
      const t = cancelTicket(found.item.id, { by: by || undefined });
      if (!t) return out(409, { error: `this run is ${found.item.status} and can no longer be canceled` });
      releaseAskCard(t);
    }
    emitChanged('schedules-changed', 'deleted');
    emitChanged('notifications-changed');
    return out(200, { ok: true });
  }
  if (verb === 'run-now') {
    if (found.kind === 'once' && found.item.after && found.item.sourceFromPrevious) {
      const p = predecessorState(found.item.after, { policy: found.item.after.policy, isLive: liveProbe });
      if (!p.pipelineId || !previousBranchesOf(p.pipelineId)) return out(409, { error: `Start ‘${p.title || 'the run before it'}’ first, or change its source branch` });
    }
    const ticket = found.kind === 'recurring' ? runScheduleNow(found.item.id, { by: by || undefined }) : requestRunNow(found.item.id, { by: by || undefined });
    if (!ticket) return out(409, { error: `this ${found.kind === 'recurring' ? 'schedule' : 'run'} is ${found.item.status} and cannot be started` });
    if (by) RUN_NOW_BY.set(ticket.id, by);
    emitChanged('schedules-changed', 'run-now');
    emitChanged('notifications-changed');
    await schedulerTick();
    const after = getTicket(ticket.id);
    // A ticket held by a waiting `--wait` terminal is started by that terminal within seconds.
    return out(200, { runId: ticket.id, status: after ? after.status : 'scheduled', failReason: after ? after.failReason : null, pipelineId: after ? after.pipelineId : null });
  }
  if (['pause', 'resume', 'skip-next'].includes(verb)) {
    if (found.kind !== 'recurring') return out(404, { error: 'repeating schedule not found' });
    const opt = { by: by || undefined };
    const s = verb === 'pause' ? pauseSchedule(found.item.id, opt) : verb === 'resume' ? resumeSchedule(found.item.id, opt) : skipNext(found.item.id, opt);
    if (!s) return out(409, { error: `this schedule is ${found.item.status}` });
    emitChanged('schedules-changed', verb);
    emitChanged('notifications-changed');
    return out(200, { kind: 'recurring', item: s });
  }
  return out(400, { error: `unknown schedule action ${verb}` });
}

/** Apply a CONFIRMED Ask Worca schedule card (schedule-spec.mjs shape) through scheduleVerb. */
async function applyScheduleCard(card, { by = null } = {}) {
  const map = { run_now: ['run-now', {}], move: ['patch', card.patch || {}], edit: ['patch', card.patch || {}], cancel: ['delete', {}], delete: ['delete', {}] };
  const m = map[card.action];
  if (!m) return { ok: false, error: `unknown schedule action "${card.action}"` };
  const r = await scheduleVerb(m[0], card.id, m[1], { by });
  if (r.status !== 200) return { ok: false, error: (r.body && r.body.error) || `failed (${r.status})` };
  const b = r.body || {};
  let detail = '';
  if (card.action === 'run_now') {
    detail = b.status === 'failed' ? `could not start: ${b.failReason || 'unknown error'}`
      : b.status === 'fired' ? `started${b.pipelineId ? ` as run ${b.pipelineId}` : ''}` : 'starting within seconds';
    if (b.status === 'failed') return { ok: false, error: `could not start: ${b.failReason || 'unknown error'}`, runId: b.runId };
  } else if (card.action === 'move') detail = card.after && card.after.when ? `now at ${card.after.when}` : card.after && card.after.afterRun ? `now after ‘${card.after.afterRun.title || card.after.afterRun.id}’` : 'moved';
  else if (card.action === 'edit') {
    const it = b.item;
    detail = !it ? 'changed'
      : it.nextRunAt ? `next run ${formatInstant(Date.parse(it.nextRunAt), it.tz || 'UTC')}`
        : it.status === 'paused' ? 'still paused — resume it to run again' : `the schedule is ${it.status}`;
  }
  else detail = card.action === 'cancel' ? 'canceled' : 'deleted';
  return { ok: true, detail, ...(b.runId ? { runId: b.runId } : {}), ...(b.pipelineId ? { pipelineId: b.pipelineId } : {}) };
}

// PATCH /api/schedules/:id — a ticket: { scheduledFor?, ifMissed?, graceMin? };
// a series: { title?, rule?, overlap?, maxFailures?, ifMissed?, graceMin? }.
app.patch('/api/schedules/:id', async (req, res) => {
  const r = await scheduleVerb('patch', req.params.id, req.body || {}, { by: actorOf(req) });
  res.status(r.status).json(r.body);
});

// DELETE /api/schedules/:id — cancel a one-shot ticket, or delete a series.
app.delete('/api/schedules/:id', async (req, res) => {
  const r = await scheduleVerb('delete', req.params.id, {}, { by: actorOf(req) });
  res.status(r.status).json(r.body);
});

// POST /api/schedules/:id/run-now — start a ticket now, or one extra occurrence of a series.
app.post('/api/schedules/:id/run-now', async (req, res) => {
  const r = await scheduleVerb('run-now', req.params.id, {}, { by: actorOf(req) });
  res.status(r.status).json(r.body);
});

for (const verb of ['pause', 'resume', 'skip-next']) {
  app.post(`/api/schedules/:id/${verb}`, async (req, res) => {
    const r = await scheduleVerb(verb, req.params.id, {}, { by: actorOf(req) });
    res.status(r.status).json(r.body);
  });
}

/** The reader whose read state applies: a person on a shared deployment, else null (the global column). */
function notifReader(req) {
  const who = resolveIdentity(req);
  return isSharedIdentity(who.source) ? who.name : null;
}

// GET /api/notifications?scope=schedule[&unread=1][&problems=1] -> { notifications, unread }
app.get('/api/notifications', (req, res) => {
  try {
    const scope = typeof req.query.scope === 'string' && req.query.scope ? req.query.scope : 'schedule';
    const flag = (v) => v === '1' || v === 'true';
    res.json({
      notifications: listNotifications({ scope, unread: flag(req.query.unread), problems: flag(req.query.problems), reader: notifReader(req) }),
      unread: unreadCount(scope, { reader: notifReader(req) }),
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/notifications/read-all', (req, res) => {
  const scope = req.body && typeof req.body.scope === 'string' && req.body.scope ? req.body.scope : 'schedule';
  markAllRead(scope, { reader: notifReader(req) });
  emitChanged('notifications-changed');
  res.json({ unread: unreadCount(scope, { reader: notifReader(req) }) });
});

app.post('/api/notifications/:id/read', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) return badRequest(res, 'invalid notification id');
  const read = !(req.body && req.body.read === false);
  if (!markRead(id, { read, reader: notifReader(req) })) return res.status(404).json({ error: 'notification not found' });
  emitChanged('notifications-changed');
  res.json({ unread: unreadCount('schedule', { reader: notifReader(req) }) });
});

// ---------------------------------------------------------------------------
// Chat connectivity (chat-connectivity-design.md): persistent channel workers
// + inbound command router. Workers are dumb transports; every command
// resolves here against the runs Map / DB through chatActions.
// ---------------------------------------------------------------------------
// Lazy: worcaHome() must not resolve at import time (tests import the app
// before their temp WORCA_HOME hook runs); the file loads on first chat use.
let _chatContext = null;
const chatCtx = () => (_chatContext ??= createChatContext());
const chatContext = {
  get: (k) => chatCtx().get(k),
  set: (k, patch) => chatCtx().set(k, patch),
  isMuted: (k) => chatCtx().isMuted(k),
  incrementMuted: (k) => chatCtx().incrementMuted(k),
};

const chatActions = {
  listRuns: () => summarizeRuns(),
  // Waiting + missed tickets, soonest first, with the time in this server's zone.
  listScheduled: () => listTickets().map((t) => ({
    id: t.id, title: t.title, runAt: t.runAt, status: t.status, projectDir: t.projectDir,
    when: formatInstant(Date.parse(t.runAt), Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
  })),
  runState: (runId) => { try { return runs.get(runId)?.orch?.getState() ?? null; } catch { return null; } },
  pendingQuestion: (runId) => runs.get(runId)?.pendingQuestion ?? null,
  // `by` = the chat actor ("ada via Slack", identity.mjs chatActor): attribution text only.
  answer: (runId, id, payload, by) => answerRun(runId, id, payload, by || 'local'),
  stop: (runId, by) => stopRun(runId, by || 'local'),
  pause: (runId, by) => pauseRun(runId, by || 'local'),
  // The long chain of budget/worktree/double-resume guards lives in resumeRun();
  // call it in-process. (It used to be reached by POSTing to 127.0.0.1:PORT — a
  // loopback self-fetch that breaks under WORCA_HOST and can hit another instance.)
  resume: async (pipelineId, by) => {
    try { return await resumeRun(pipelineId, { by: by || 'local' }); }
    catch (err) { return { ok: false, error: err?.body?.error || err?.message || String(err) }; }
  },
  // Chat reads only DB fields (id/title/status/cost/activeMs/pauseReason), so bound the
  // rows in SQL and skip git enrichment — /status no longer spawns 2 git procs per pipeline.
  history: async ({ limit = 50 } = {}) => (await listAllPipelines({ limit, lite: true })) || [],
  listProjects: async () => (await listProjects()).map((p) => ({ name: p.name || path.basename(p.path || ''), path: p.path })),
};

const chatRouter = createCommandRouter({
  actions: chatActions,
  chatContext,
  logger: (level, msg) => console.error(`[worca-ui] chat ${level}: ${msg}`),
});

// Same-chat commands must run strictly in order: a batched ['/use beta','/runs']
// from one getUpdates poll otherwise interleaves (stale reads, replies out of
// order). One promise chain per chatKey; depth-capped (there is NO host-side
// inbound bound — a Telegram poll can hand over 100 updates at once, and the
// allowlist is only applied inside the router, after enqueue); the catch is
// mandatory — nobody awaits this chain, so a rejected tail is an unhandled
// rejection that kills the process under Node's default flag.
const CHAT_QUEUE_MAX = 50;          // per chat; a flood past this is dropped, not buffered
const chatQueues = new Map();       // key -> { tail, depth }
function enqueueChatWork(key, fn) {
  const q = chatQueues.get(key) || { tail: Promise.resolve(), depth: 0 };
  if (q.depth >= CHAT_QUEUE_MAX) {
    console.error(`[worca-ui] chat queue for ${key} is full (${CHAT_QUEUE_MAX}) — dropping inbound work`);
    return q.tail;
  }
  q.depth += 1;
  // prev.then(fn, fn): run even after a prior failure (fn takes no arguments,
  // so the previous error is discarded — do not give fn a parameter).
  const tail = q.tail.then(fn, fn).catch((err) => {
    console.error(`[worca-ui] chat work failed: ${err && err.message ? err.message : err}`);
  }).finally(() => {
    q.depth -= 1;
    if (chatQueues.get(key) === q && q.depth === 0) chatQueues.delete(key);
  });
  q.tail = tail;
  chatQueues.set(key, q);
  return tail;
}

async function handleChatInbound({ plugin, channelId, platform, msg }) {
  const entry = channelHost.list().find((e) => e.plugin === plugin && e.channelId === channelId);
  if (!entry) return;
  let replyMsg;
  try {
    replyMsg = await chatRouter.handleIncoming({
      plugin, channelId, platform,
      channelConfig: readPluginConfig(plugin, entry.configSchema),
      msg,
    });
  } catch (err) {
    console.error(`[worca-ui] chat inbound failed: ${err && err.message ? err.message : err}`);
    return;
  }
  if (!replyMsg) return;
  try {
    await channelHost.sendMessage({ plugin, channelId, chatId: msg.chatId, message: replyMsg });
  } catch (err) {
    console.error(`[worca-ui] chat reply delivery failed: ${err && err.message ? err.message : err}`);
  }
}

const channelHost = createChannelHost({
  logger: (level, msg) => console.error(`[worca-ui] ${msg}`),
  onInbound: (ev) => { enqueueChatWork(`${ev.platform}:${ev.msg.chatId}`, () => handleChatInbound(ev)); },
  onStatus: (ev) => { try { broadcast({ type: 'channel-status', ...ev }); } catch { /* pre-listen */ } },
});

const chatNotifier = createNotifier({
  channelHost,
  getPrefs: chatPrefs,
  chatContext,
  logger: (level, msg) => console.error(`[worca-ui] chat ${level}: ${msg}`),
});

/** Best-effort worker restart after any plugin mutation (enable/disable,
 *  config save, install, update, uninstall). Never blocks the route. */
function reloadChatWorkers(name) {
  channelHost.reloadPlugin(name).catch((err) => {
    console.error(`[worca-ui] chat worker reload failed for ${name}: ${err && err.message ? err.message : err}`);
  });
}

// ---------------------------------------------------------------------------
// Run control actions — ONE implementation shared by the HTTP routes and the
// chat command router (chat-connectivity-design.md §4.6), so answering a gate
// from Discord clears the question card in every browser tab exactly like the
// UI button does (resolvePending is part of the action, not the route).
// ---------------------------------------------------------------------------
/**
 * Resolve a pending question. ONE implementation behind the HTTP route and the
 * chat command router (`chatActions.answer`), so answering from Discord clears the
 * card in every browser tab exactly like the UI button does.
 *
 * Ask forms, gate 3 (ruling X2): `orch.answer` THROWS `Error('invalid answer')`
 * with `code: 'INVALID_ANSWER'` and `errors: [{ path, code, message }]` when the
 * values are refused. That throw is RETHROWN unchanged and must never be caught
 * here — `resolvePending` below must not run, or the question would be cleared in
 * every tab while the run is still waiting on it. Callers (`POST /api/answer` →
 * 422, and P4's CLI + chat) branch on `err.code === 'INVALID_ANSWER'`.
 */
/** `by` = who answered (identity.mjs actorOf / chatActor); the harness stores and audits it. */
function answerRun(runId, id, payload, by = 'local') {
  const entry = runs.get(runId);
  if (!entry) throw new Error('unknown runId');
  entry.orch.answer(id, payload, by || 'local');
  resolvePending(entry, { id, reason: 'answered' });
}
/** `by` = who asked (identity.mjs actorOf / chatActor); recorded on the entry and the run state. */
function stopRun(runId, by = 'local') {
  const entry = runs.get(runId);
  if (!entry) throw new Error('unknown runId');
  entry.lastAction = { kind: 'stop', by: by || 'local', at: new Date().toISOString() };
  entry.orch.stop(entry.lastAction.by);
  entry.status = 'stopped';
  resolvePending(entry, { reason: 'stopped' });
}
function pauseRun(runId, by = 'local') {
  const entry = runs.get(runId);
  if (!entry) throw new Error('unknown runId');
  const ok = typeof entry.orch?.pause === 'function' && entry.orch.pause(by || 'local');
  if (!ok) throw Object.assign(new Error('cannot pause in the current state'), { code: 'CANNOT_PAUSE' });
  entry.lastAction = { kind: 'pause', by: by || 'local', at: new Date().toISOString() };
  entry.status = 'pausing';
  resolvePending(entry, { reason: 'paused' });
}

// ---------------------------------------------------------------------------
// POST /api/answer  -> resolve a pending question for a run
// body: { runId, id, payload }
// ---------------------------------------------------------------------------
app.post('/api/answer', (req, res) => {
  const { runId, id, payload } = req.body || {};
  if (!runId || !runs.has(runId)) return badRequest(res, 'unknown runId');
  if (!id) return badRequest(res, 'question id is required');
  try {
    answerRun(runId, id, payload, actorOf(req));
    res.json({ ok: true });
  } catch (err) {
    // Gate 3 (ask forms, spec §5): the answer was validated and refused, so the
    // question stays OPEN and the client gets the field errors to mark up. Every
    // other failure keeps its 500.
    if (err && err.code === 'INVALID_ANSWER') {
      return res.status(422).json({ error: 'invalid answer', errors: Array.isArray(err.errors) ? err.errors : [] });
    }
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stop  -> abort a run
// body: { runId }
// ---------------------------------------------------------------------------
app.post('/api/stop', (req, res) => {
  const { runId } = req.body || {};
  if (!runId || !runs.has(runId)) return badRequest(res, 'unknown runId');
  try {
    stopRun(runId, actorOf(req));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/pause { runId } — gracefully pause a LIVE run. The orchestrator kills
// in-flight node children, persists a resume point, and lands on status 'paused'
// (announced via the normal state/done events; wireRun mirrors entry.status).
// ---------------------------------------------------------------------------
app.post('/api/pause', (req, res) => {
  const { runId } = req.body || {};
  if (!runId || !runs.has(runId)) return badRequest(res, 'unknown runId');
  try {
    pauseRun(runId, actorOf(req));
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'CANNOT_PAUSE') return badRequest(res, err.message);
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// resumeRun(pipelineId, opts) — the resume guard chain + rehydration, callable
// in-process. Chat used to reuse it by POSTing http://127.0.0.1:PORT/api/resume
// over loopback, which breaks under WORCA_HOST (the server may not be bound on
// 127.0.0.1 at all) and, worse, can land on a DIFFERENT worca instance that
// happens to own the port. Both callers now share this one function; the route
// is a thin mapper from ResumeError -> (status, body).
// ---------------------------------------------------------------------------
class ResumeError extends Error {
  constructor(status, body) {
    super(body.error || 'resume failed');
    this.status = status;
    this.body = body;
  }
}

async function resumeRun(pipelineId, { ignoreCostCap = false, mock = false, pastTeamCap = false, policyReason = null, by = 'local' } = {}) {
  if (!pipelineId || typeof pipelineId !== 'string') throw new ResumeError(400, { error: 'pipelineId is required' });
  const saved = readPipelineForResume(pipelineId);
  if (!saved) throw new ResumeError(404, { error: 'pipeline not found' });
  if (saved.row.status !== 'paused' && saved.row.status !== 'interrupted') throw new ResumeError(400, { error: `pipeline is "${saved.row.status}", not resumable` });
  if (!saved.resumePoint) throw new ResumeError(400, { error: 'pipeline has no resume point' });
  if (saved.resumePoint.version !== 2) {
    throw new ResumeError(409, { code: 'ENGINE_RETIRED', error: V1_RUN_RETIRED });
  }

  if (saved.row.archived_at) {
    throw new ResumeError(409, { error: 'pipeline is archived' });
  }
  // No graph re-validation on RESUME, on purpose: _restoreFromResumePoint never
  // reads the workflow row — the frozen manifest supplies topology and port
  // identity (resolvedFromManifest: snapshot wins), so a template that drifted
  // while the run sat paused cannot strand it. A vanished agent KEY is the one
  // resume-time hazard, and _preflightAgentKeys already refuses it (§9.4).
  const budget = budgetStatus();
  if (budget.blocked) {
    throw new ResumeError(403, { error: 'total cost limit reached', budget });
  }
  // Override persists only once the (never-bypassable) total gate passes —
  // a total-refused request must not leave cost_cap_override armed.
  if (ignoreCostCap === true) {
    setCostCapOverride(pipelineId);            // persistent per-pipeline override (F7)
    appendAuditById(pipelineId, `Pipeline cost limit override set${byActor(by)}.`, { actor: by });
  }
  const pipeCap = budget.pipelineLimitUsd;
  const spentSoFar = Number(saved.row.total_cost_usd || 0);
  if (pipeCap != null && spentSoFar >= pipeCap && !readCostCapOverride(pipelineId)) {
    throw new ResumeError(403, {
      error: 'pipeline cost limit reached', budget, needsOverride: true,
    });
  }

  // Double-resume guard: any live entry already driving this pipeline id.
  for (const e of runs.values()) {
    if (e.pipelineId === pipelineId && !['done', 'stopped', 'error', 'paused', 'interrupted'].includes(String(e.status || ''))) {
      throw new ResumeError(400, { error: 'pipeline is already live' });
    }
  }

  // Worktree(s) must still exist (single-project; workspace members are checked
  // inside orchestrator.resume(), which fails fast with the same message).
  const branch = saved.row.branch ? JSON.parse(saved.row.branch) : null;
  if (branch?.worktreeDir && !fs.existsSync(branch.worktreeDir)) {
    throw new ResumeError(400, { error: `worktree missing: ${branch.worktreeDir}` });
  }

  // Resolve projectDir: workspace runs carry dirs in workspace_meta; single-project
  // runs map project_key back through the registry.
  let projectDir = null;
  let workspace;
  if (saved.row.target === 'workspace' && saved.row.workspace_meta) {
    const meta = JSON.parse(saved.row.workspace_meta);
    const projects = (meta.projects || []).map((p) => ({ ...p }));
    if (!projects.length) throw new ResumeError(400, { error: 'workspace metadata incomplete' });
    projectDir = projects[0].projectDir;
    workspace = {
      id: meta.workspaceId, key: saved.row.workspace_key, name: meta.workspaceName,
      description: meta.workspaceDescription || '', projects,
    };
  } else {
    for (const p of await listProjects()) {
      if (projectKey(p.path) === saved.row.project_key) { projectDir = p.path; break; }
    }
    if (!projectDir) throw new ResumeError(400, { error: 'project for this pipeline is not onboarded on this machine' });
  }

  // Team policy gates (design §7): the total cap once per window per home, the pipeline cap once
  // per run. Both soft — `pastTeamCap` (with an optional / required reason) records the choice
  // and lets the resume through; the local gates above stay never-bypassable.
  const teamTarget = workspace ? { workspaceId: workspace.id } : { projectDir };
  const totalGate = await checkTeamTotalGate(teamTarget, { pastTeamCap, reason: policyReason, by });
  if (totalGate.blocked) {
    throw new ResumeError(totalGate.code === 'reason_required' ? 400 : 403, { error: totalGate.error, code: totalGate.code, policy: totalGate.policy, needsPolicyAck: totalGate.code === 'team_total' });
  }
  const pipeGate = checkTeamPipelineGate(totalGate.caps, { pipelineId, spentSoFar, pastTeamCap, reason: policyReason, by });
  if (pipeGate.blocked) {
    throw new ResumeError(pipeGate.code === 'reason_required' ? 400 : 403, { error: pipeGate.error, code: pipeGate.code, policy: pipeGate.policy, needsPolicyOverride: pipeGate.code === 'team_pipeline' });
  }
  // Who continued past a team cap, and why (the audit timeline; policy_state keeps it too).
  const why = (r) => (r ? ` — reason: ${String(r).replace(/[\r\n]+/g, ' ').slice(0, 300)}` : '');
  if (totalGate.ack) appendAuditById(pipelineId, `Continued past the team total cap${byActor(by)}${why(totalGate.ack.reason)}.`, { actor: by });
  if (pipeGate.fresh) appendAuditById(pipelineId, `Continued past the team cost cap${byActor(by)}${why(pipeGate.reason)}.`, { actor: by });

  // A paused defragment run is not live; another one on the same scope may have started since.
  // Resuming the first would sync its stale mount over the second's work (spec §5 concurrency).
  const rpScope = saved.resumePoint?.memoryScope || null;
  if (rpScope && !workspace) {
    const live = liveDefragRun(memoryScopeKey(rpScope, projectDir));
    if (live) throw new ResumeError(409, { error: 'a defragment run for this memory scope is already live', runId: live.id });
  }

  const effMock = mock ||isTruthy(process.env.WORCA_MOCK ?? process.env.ORCH_MOCK);
  const runId = randomUUID();
  const orch = await createOrchestratorFor({
    projectDir,
    ...(workspace ? { workspace } : {}),
    agentsDir: AGENTS_DIR,
    claude: { permissionMode: 'acceptEdits', mock: effMock },
    resume: saved,
    resumedBy: by || 'local',
  });
  const entry = {
    id: runId,
    orch,
    projectDir,
    // The run keeps its starter across a resume; the resume itself is the last action.
    startedBy: saved.row.started_by || null,
    lastAction: { kind: 'resume', by: by || 'local', at: new Date().toISOString() },
    ...(workspace
      ? {
          workspaceId: workspace.id,
          kind: 'workspace-run',
          projectNames: workspace.projects.map((p) => p.projectName || path.basename(p.projectDir || '')),
        }
      : { kind: 'run' }),
    title: saved.row.title,
    status: 'starting',
    startedAt: new Date().toISOString(),
    events: [],
    pendingQuestion: null,
    pipelineId,
  };
  runs.set(runId, entry);
  wireRun(entry);
  announceRun(entry);

  // A card-linked run keeps reporting to its chat across the resume: the link
  // row moves to the new runId and a fresh follower takes over (the old one
  // detached on done{paused}). Best-effort per row — chat bookkeeping must never
  // block a resume.
  for (const link of askFindRunLinksByPipeline(pipelineId)) {
    try {
      if (!askUpdateRunLink(link.threadId, link.runId, { runId, status: 'running' })) continue;
      const text = `Run resumed — "${saved.row.title || 'run'}"`;
      const m = askAppendMessage(link.threadId, { role: 'system', text, blocks: [{ kind: 'notice', text, href: `#running/${runId}` }] });
      broadcast({ type: 'ask-message', threadId: link.threadId, message: m });
      attachAskFollower(orch, { threadId: link.threadId, runId, cardId: link.cardId });
    } catch (err) {
      console.error(`[worca-ui] ask follower re-attach failed: ${err && err.message ? err.message : err}`);
    }
  }

  // Evict the superseded paused/interrupted lineage for this pipeline. The old
  // entry is inert (paused), but summarizeRuns() broadcasts EVERY Map entry on
  // each hello — leaving it resurfaces the now-resumed (and possibly already
  // completed) pipeline as a phantom 'Paused' card in Running on reload/reconnect.
  for (const [id, e] of runs) {
    if (id !== runId && e.pipelineId === pipelineId &&
        (e.status === 'paused' || e.status === 'interrupted')) {
      runs.delete(id);
    }
  }

  // Fire-and-forget; all progress is surfaced through events (same idiom as /api/run).
  Promise.resolve()
    .then(() => orch.resume())
    .catch((err) => {
      const event = { runId, type: 'error', message: err && err.message ? err.message : String(err) };
      entry.status = 'error';
      entry.events.push(event);
      broadcast(event);
    });

  return { ok: true, runId, pipelineId };
}

// ---------------------------------------------------------------------------
// POST /api/resume { pipelineId } — rehydrate a paused pipeline from the DB (works
// across server restarts) and continue it as a NEW live run entry with the SAME
// pipeline id / history row.
// ---------------------------------------------------------------------------
app.post('/api/resume', async (req, res) => {
  try {
    const out = await resumeRun(req.body?.pipelineId, {
      ignoreCostCap: req.body?.ignoreCostCap === true,
      mock: !!(req.body && req.body.mock),
      pastTeamCap: req.body?.pastTeamCap === true,
      policyReason: typeof req.body?.policyReason === 'string' ? req.body.policyReason : null,
      by: actorOf(req),
    });
    res.json(out);
  } catch (err) {
    if (err instanceof ResumeError) return res.status(err.status).json(err.body);
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/runs?projectDir  -> history of saved pipelines
// GET /api/runs?workspaceId  -> workspace-store pipelines + live workspace runs
// ---------------------------------------------------------------------------
app.get('/api/runs', async (req, res) => {
  // Workspace arm: when workspaceId is present (and projectDir absent), list the
  // workspace store's pipelines + live workspace runs (§2.7). A bad/unknown id
  // reads as not-found (404), matching the run-target + detail routes.
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId.trim() : '';
  if (workspaceId && !resolveProjectDir(req.query.projectDir)) {
    if (!WORKSPACE_KEY_RE.test(workspaceId)) return res.status(404).json({ error: 'workspace not found' });
    try {
      const ws = await readWorkspace(workspaceId);
      if (!ws) return res.status(404).json({ error: 'workspace not found' });
      const primaryDir = ws.projectPaths[0] || null;
      const pipelines = (await listWorkspacePipelines(ws.id, primaryDir, { withPr: true })) || [];
      const live = [...runs.values()]
        .filter((r) => r.workspaceId === ws.id)
        .map((r) => ({ id: r.pipelineId || r.id, runId: r.id, title: r.title, status: r.status, live: true }));
      return res.json({ pipelines, live, scheduled: listTickets({ workspaceId: ws.id }), ghAvailable: await hasGh() });
    } catch (err) {
      return res.status(500).json({ error: err && err.message ? err.message : String(err) });
    }
  }

  const projectDir = resolveProjectDir(req.query.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  try {
    const pipelines = (await Promise.resolve(listPipelines(projectDir, { withPr: true }))) || [];
    // Also expose any live (in-memory) runs for this project that may not yet
    // be on disk, so the UI history reflects an active run too.
    const live = [...runs.values()]
      .filter((r) => r.projectDir === projectDir)
      .map((r) => ({
        // Surface the on-disk pipeline id as `id` once createPipeline has run, so
        // renderHistory's dedup-by-id merges this entry with its disk twin. The
        // UUID stays on `runId` because WS / answer / stop route by runs-Map key.
        id: r.pipelineId || r.id,
        runId: r.id,
        title: r.title,
        status: r.status,
        live: true,
      }));
    // Additive: runs that WAIT for their start time are tickets, not pipelines.
    res.json({ pipelines, live, scheduled: listTickets({ projectDir }), ghAvailable: await hasGh() });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/runs/:id?projectDir  -> saved pipeline markdown + state
// ---------------------------------------------------------------------------
app.get('/api/runs/:id', async (req, res) => {
  const projectDir = resolveProjectDir(req.query.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  const id = req.params.id;
  try {
    const data = await Promise.resolve(readPipeline(projectDir, id));
    if (!data) return res.status(404).json({ error: 'pipeline not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// GET /api/runs/:id/artifact?rel= -> the same payload, resolved by the pipeline
// id ALONE (findPipelineRowById): the Running page knows the run's pipelineId
// but no store key until History has been visited. Placed beside /api/runs/:id
// (`:id` matches one path segment, so the two never shadow each other).
app.get('/api/runs/:id/artifact', async (req, res) => {
  try {
    const row = findPipelineRowById(req.params.id);
    if (!row) return res.status(404).json({ error: 'pipeline not found' });
    const hit = await resolveIndexedArtifactForRow(row, req.query.rel);
    if (!hit) return res.status(404).json({ error: 'artifact not found' });
    res.json(hit);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/runs/:id/artifacts', async (req, res) => {
  try {
    const row = findPipelineRowById(req.params.id);
    if (!row) return res.status(404).json({ error: 'pipeline not found' });
    // Cap the row set (each row costs a synchronous statSync for its byte size, on
    // the event loop) at the same ceiling the ask tool uses.
    const artifacts = await listRunArtifacts(row.id, { limit: ASK_LIMITS.artifactsListMaxLimit });
    res.json({ runId: row.id, artifacts });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Ask-form preview files (spec §7, D8). Served by (run, askId, index) — there is
// NO path input on this surface: `:askId` is a token askIdToken() minted,
// `:index` is a small integer, and the only string joined onto a directory is the
// basename the snapshot's own manifest.json recorded. Posture copied from the Ask
// attachment route: streamed sendFile, dotfiles denied, the SNIFFED type, nosniff,
// inline, immutable private cache. Behind the loopback guard like every route.
// ---------------------------------------------------------------------------
const ASK_FILES_TOKEN_RE = /^[A-Za-z0-9_-]{1,96}$/;

async function serveAskFile(res, runDir, askId, index) {
  if (!runDir) return res.status(404).json({ error: 'pipeline not found' });
  if (typeof askId !== 'string' || !ASK_FILES_TOKEN_RE.test(askId)) {
    return res.status(400).json({ error: 'invalid ask id' });
  }
  if (typeof index !== 'string' || !/^\d{1,2}$/.test(index)) {
    return res.status(400).json({ error: 'invalid file index' });
  }
  const dir = path.join(runDir, ASK_FILES_DIR, askId);
  const entry = await readAskFileEntry(dir, Number(index));
  if (!entry) return res.status(404).json({ error: 'ask file not found' });
  // The text classes are PROVEN UTF-8 by the sniffer (a fatal decoder), so say so:
  // under nosniff a bare `text/plain` is decoded with the browser's legacy default
  // charset on a direct open, and non-ASCII prose garbles. Binary types stay bare.
  const type = ASK_FILE_MIMES[entry.mime].trust === 'text' ? `${entry.mime}; charset=utf-8` : entry.mime;
  const headers = {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
  // §7's "inline, inert only" row: an SVG is drawn through <img> in the panel,
  // and a direct hit on this URL is inert too — no script, no fetch, no anything.
  if (entry.mime === 'image/svg+xml') headers['Content-Security-Policy'] = "sandbox; default-src 'none'";
  res.sendFile(entry.stored, { root: dir, dotfiles: 'deny', cacheControl: false, headers }, (err) => {
    if (!err || res.headersSent) return;
    if (err.code === 'ENOENT' || err.status === 404) return res.status(404).json({ error: 'ask file not found' });
    res.status(500).json({ error: err.message || String(err) });
  });
}

/** The run dir behind a LIVE id: the pipeline id (what /api/runs/:id/artifact
 *  takes) or the WebSocket run UUID (what the browser holds). */
async function askFilesRunDir(id) {
  const live = liveRunEntry(id);
  const row = findPipelineRowById(live?.pipelineId || id);
  if (!row) return null;
  try { return await runDirForRow(row); } catch { return null; }
}

app.get('/api/runs/:id/ask-files/:askId/:index', async (req, res) => {
  try {
    await serveAskFile(res, await askFilesRunDir(req.params.id), req.params.askId, req.params.index);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

/** The run dir behind a STORE KEY + run id — the shape both the History and the
 *  workspace twin resolve through. Null (→ 404) when the row or its dir is gone. */
async function askFilesStoreDir(key, runId) {
  const row = lookupPipelineRow(key, runId);
  if (!row) return null;
  try { return await runDirForRow(row); } catch { return null; }
}

// Shared query-scope resolver for the retained-work routes (recovery-patch GET +
// discard POST). Returns null after writing the error response itself. The older
// DELETE /api/runs/:id route keeps its inline copy DELIBERATELY (it shadows the
// imported projectKey(), derives no store key, and maps RETAINED_WORKTREE).
function resolveRunScope(req, res) {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId.trim() : '';
  const projectKey_ = typeof req.query.projectKey === 'string' ? req.query.projectKey.trim() : '';
  const projectDir = resolveProjectDir(req.query.projectDir);
  if (workspaceId && !WORKSPACE_KEY_RE.test(workspaceId)) {
    res.status(404).json({ error: 'pipeline not found' });
    return null;
  }
  if (projectKey_ && !/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(projectKey_)) {
    res.status(404).json({ error: 'pipeline not found' });
    return null;
  }
  if (!workspaceId && !projectKey_ && !projectDir) {
    badRequest(res, 'workspaceId, projectKey or projectDir is required');
    return null;
  }
  const key = workspaceId ? `workspaces/${workspaceId}` : (projectKey_ || projectKey(projectDir));
  return { workspaceId, projectKey: projectKey_, projectDir, key };
}

// Download the durable done-path diff as an alternate recovery route for a
// retained worktree. The filename is fixed; callers cannot supply a path.
app.get('/api/runs/:id/recovery-patch', async (req, res) => {
  const id = req.params.id;
  const scope = resolveRunScope(req, res);
  if (!scope) return;
  const key = scope.key; // the body's readRunArtifactText(key, …) calls stay unchanged
  try {
    // Prefer a retained-work snapshot (any member's, incl. workspace-suffixed
    // names) over the done-path diff. Resolved through the artifacts INDEX, which
    // only gains a row on a SUCCESSFUL snapshot — a truncated or missing file can
    // never shadow the diff-patch fallback.
    const arts = await listArtifacts(id).catch(() => []);
    const retainedRel = arts.find((a) => a && a.kind === 'retained-work-patch')?.relPath || null;
    let filename = null;
    let patch = retainedRel == null ? null : await readRunArtifactText(key, id, retainedRel);
    if (patch != null && patch.length) {
      filename = `retained-work-${String(id).replace(/[^a-zA-Z0-9._-]/g, '-')}.patch`;
    } else {
      patch = await readRunArtifactText(key, id, DIFF_PATCH_FILE);
      filename = `diff-patch-${String(id).replace(/[^a-zA-Z0-9._-]/g, '-')}.patch`;
    }
    if (patch == null) return res.status(404).json({ error: 'recovery patch not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.type('text/x-diff').send(patch);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/runs/:id/overview  -> Layer-2 on-demand overview agent.
// Accepts ?key=<storeKey> (preferred; history detail uses it) or ?projectDir=...
// ?force=1 bypasses the cached overview.json. 200 { overview } | 404 | 500.
// ---------------------------------------------------------------------------
app.post('/api/runs/:id/overview', async (req, res) => {
  const id = req.params.id;
  let key = typeof req.query.key === 'string' ? req.query.key : null;
  if (!key) {
    const projectDir = resolveProjectDir(req.query.projectDir);
    if (!projectDir) return badRequest(res, 'key or projectDir is required');
    key = projectKey(projectDir);
  }
  const force = req.query.force === '1' || req.query.force === 'true';
  try {
    const overview = await generateOverview(key, id, { force });
    res.json({ overview });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const code = msg === 'pipeline not found' ? 404 : 500;
    res.status(code).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /api/history  -> machine-wide history across every onboarded project
// ---------------------------------------------------------------------------
app.get('/api/history', async (_req, res) => {
  try {
    // Self-heal records left 'running' by a dead process before listing, so History
    // never shows a phantom Running run and its Delete button appears (see
    // pipeline-delete ACTIVE / app.js isDeletableEntry — both allow 'interrupted').
    try { reconcileStaleRunning({ liveIds: liveRunIds() }); } catch { /* best-effort */ }
    // Phase 1: PR-light skeleton (no `gh pr list`). Live PR state is pushed
    // separately over the WS by POST /api/history/pr -> enrichPipelinesPr.
    res.json({ pipelines: (await listAllPipelines()) || [], ghAvailable: await hasGh() });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Lightweight sidebar-count snapshot. Three cheap COUNT(*) queries — deliberately NOT
// the full list endpoints, so a navigation/refresh never pulls the (potentially large)
// machine-wide history just to update a badge. Running is derived client-side from the
// in-memory runs map (live via WS), so it is not included here. Synchronous: the three
// helpers are sync getDb().prepare(...).get() calls.
// ---------------------------------------------------------------------------
// Getting started (docs/getting-started.md). GET is the derived checklist —
// eight ticks computed from the store + PATH, never stored — plus the two flags.
// POST writes ONLY those flags ({hidden?, welcomeSeen?}; booleans; unknown keys
// 400) and answers with the same full payload, so one round trip repaints.
// ---------------------------------------------------------------------------
app.get('/api/onboarding', async (_req, res) => {
  try { res.json(await onboardingStatus()); }
  catch (err) { res.status(500).json({ error: err && err.message ? err.message : String(err) }); }
});
app.post('/api/onboarding', async (req, res) => {
  try {
    await pinUiLevel();                        // before welcomeSeen flips and ends "fresh install"
    await setOnboardingPrefs(req.body || {});
  }
  catch (err) { return badRequest(res, err && err.message ? err.message : String(err)); }
  emitChanged('onboarding-changed');
  try { res.json(await onboardingStatus()); }
  catch (err) { res.status(500).json({ error: err && err.message ? err.message : String(err), ...onboardingPrefs() }); }
});

app.get('/api/counts', (req, res) => {
  try {
    res.json({
      pipelines: countPipelines(),
      projects: countProjects(),
      workspaces: countWorkspaces(),
      schedules: { ...scheduleCounts(), unread: unreadCount('schedule', { reader: notifReader(req) }) },
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stats?range=today|week|month|all  -> the Statistics view payload (§6.9).
// Pure DB reads; an unknown range is the caller's fault, so getStats' RangeError
// maps to 400 while anything else keeps bubbling to the error handler.
app.get('/api/stats', (req, res) => {
  try {
    const range = typeof req.query.range === 'string' && req.query.range ? req.query.range : 'month';
    res.json(getStats({ range }));
  } catch (err) {
    if (err instanceof RangeError) return badRequest(res, err.message);
    throw err;
  }
});

// ---- Team metrics (team-metrics-design.md §4.6–§4.10) ----------------------------------
function metricsErrorStatus(code) {
  switch (code) {
    case 'BAD_REQUEST': case 'NO_ORIGIN': return 400;
    case 'DELEGATE_INVALID': return 409;                 // a configuration state, not a malformed request
    case 'NOT_FOUND': case 'NOT_ENABLED': return 404;
    case 'PUSH_REJECTED': case 'FETCH_FAILED': case 'REMOTE_UNREACHABLE': case 'PUSH_RETRIES_EXHAUSTED': return 502;
    case 'LOCK_TIMEOUT': return 503;
    default: return 500;
  }
}
function sendMetricsError(res, err) {
  const code = (err && err.code) || 'INTERNAL';
  res.status(metricsErrorStatus(code)).json({
    error: err && err.message ? err.message : String(err), code,
    ...(err && err.stderr ? { stderr: err.stderr } : {}),
    ...(err && err.hint ? { hint: err.hint } : {}),
  });
}
async function tmProject(req, res) {
  if (!TM_PROJECT_KEY_RE.test(req.params.key)) { badRequest(res, 'invalid project key'); return null; }
  const p = (await listProjects()).find((x) => x.key === req.params.key);
  if (!p) { res.status(404).json({ error: 'project not found', code: 'NOT_FOUND' }); return null; }
  return p;
}

app.get('/api/team-metrics/scopes', async (req, res) => {
  try { res.json(await listScopes({ discover: req.query.discover === '1' })); }
  catch (err) { sendMetricsError(res, err); }
});

app.get('/api/team-metrics', async (req, res) => {
  const scope = parseScopeParam(req.query.scope);
  if (!scope) return badRequest(res, 'scope must be project:<projectKey> or workspace:<workspaceId>');
  const range = typeof req.query.range === 'string' && req.query.range ? req.query.range : 'this-month';
  const groupBy = typeof req.query.groupBy === 'string' && req.query.groupBy ? req.query.groupBy : 'workflow';
  const from = typeof req.query.from === 'string' ? req.query.from : null;
  const to = typeof req.query.to === 'string' ? req.query.to : null;
  try {
    resolveRange(range, { from, to });                       // 400 before touching git
    if (!GROUP_BYS.includes(groupBy)) throw new RangeError(`unknown groupBy "${groupBy}"`);
  } catch (err) { return badRequest(res, err.message); }
  try {
    // defer=1 (the page): serve the worktree now and run a due fetch afterwards; the fetch's
    // `changed` event tells the page to reload. Other clients (Ask tools, CLI, tests) keep the
    // inline fetch and get fresh data in one round trip.
    const read = await readScope(scope, { refresh: req.query.refresh === '1', defer: req.query.defer === '1' });
    const humanRateUsd = effectiveHumanRateUsd(read.rateProjectDir);
    // Flush trigger: page open (§4.5). reason:'page-open' backs off for 60 s after a failed flush,
    // so a failing push cannot loop through flush-failed → WS → page reload → GET → flush.
    for (const s of read.sync) if (s.pending > 0) scheduleFlush(s.slug, { reason: 'page-open' });
    res.json({
      scope: read.scope,
      records: read.records,
      humanRateUsd,                                     // the client re-aggregates with it (money-saved §9.2)
      // The page re-aggregates client-side (§4.9 "one fetch serves the session") and asks with
      // aggregate=0: at 12k records the unused aggregate added ~3.9 MB to a ~9.9 MB response.
      // Other clients (and the API tests) still get it by default.
      aggregate: req.query.aggregate === '0' ? null : aggregate(read.records, { range, from, to, groupBy, humanRateUsd }),
      stats: read.stats,
      sync: read.sync,
      refresh: read.refresh,
      fetchError: read.fetchError,
    });
  } catch (err) { sendMetricsError(res, err); }
});

// "Push now" / "Retry": body { slug } flushes one outbox, { scope } flushes that scope's sinks,
// an empty body flushes every outbox on this machine (same as `worca metrics push`).
app.post('/api/team-metrics/flush', async (req, res) => {
  const body = req.body || {};
  try {
    let results;
    if (typeof body.slug === 'string' && body.slug) {
      // slugDirName throws BAD_REQUEST inside flushSlug, which would answer 200 with ok:false.
      try { slugDirName(body.slug); } catch { return badRequest(res, 'invalid slug'); }
      results = [await flushSlug(body.slug)];
    }
    else if (typeof body.scope === 'string' && body.scope) {
      const scope = parseScopeParam(body.scope);
      if (!scope) return badRequest(res, 'invalid scope');
      if (scope.kind === 'project') {
        const p = (await listProjects()).find((x) => x.key === scope.id);
        if (!p) return res.status(404).json({ error: 'project not found', code: 'NOT_FOUND' });
        results = [await flushProject(p.path)];
      } else {
        const sinks = (await readScope(scope)).sinks;
        results = [];
        for (const slug of sinks) results.push(await flushSlug(slug));
      }
    } else results = await flushAll();
    res.json({ results });
  } catch (err) { sendMetricsError(res, err); }
});

// Empty state "Check now" (§4.10): force discovery everywhere.
app.post('/api/team-metrics/discover', async (_req, res) => {
  try { await discoverAll({ force: true }); res.json(await listScopes()); }
  catch (err) { sendMetricsError(res, err); }
});

app.get('/api/projects/:key/team-metrics', async (req, res) => {
  const p = await tmProject(req, res); if (!p) return;
  try { res.json({ status: await projectMetricsStatus(p, { discover: req.query.discover === '1' }) }); }
  catch (err) { sendMetricsError(res, err); }
});

app.patch('/api/projects/:key/team-metrics', async (req, res) => {
  const p = await tmProject(req, res); if (!p) return;
  const body = req.body || {};
  if (typeof body.record !== 'boolean') return badRequest(res, 'record must be a boolean');
  try { setRecordMyRuns(p.path, body.record); res.json({ status: await projectMetricsStatus(p) }); }
  catch (err) { sendMetricsError(res, err); }
});

app.post('/api/projects/:key/team-metrics/enable', async (req, res) => {
  const p = await tmProject(req, res); if (!p) return;
  const body = req.body || {};
  const mode = body.mode === 'delegate' ? 'delegate' : body.mode === 'here' || body.mode == null ? 'here' : null;
  if (!mode) return badRequest(res, 'mode must be "here" or "delegate"');
  if (mode === 'here' && body.attribution != null && body.attribution !== 'git-user' && body.attribution !== 'none') {
    return badRequest(res, 'attribution must be "git-user" or "none"');
  }
  try {
    const result = await enableTeamMetrics(p.path, { mode, attribution: body.attribution || 'git-user', delegateTo: body.delegateTo || null, change: body.change === true, by: actorOf(req) });
    res.json({ ...result, status: await projectMetricsStatus(p) });
  } catch (err) { sendMetricsError(res, err); }
});

// Wizard step (§4.8). No POST /api/workspaces/:id route exists, so nothing shadows this path.
app.post('/api/workspaces/metrics-scan', async (req, res) => {
  const paths = req.body && Array.isArray(req.body.projectPaths) ? req.body.projectPaths.filter((p) => typeof p === 'string' && p) : null;
  if (!paths || !paths.length) return badRequest(res, 'projectPaths must be a non-empty array of paths');
  if (paths.length > 50) return badRequest(res, 'at most 50 projectPaths');
  const normalized = paths.map((p) => resolveProjectDir(p)).filter(Boolean);
  // Same checks as POST /api/workspaces/scan (:~2948): never discover (and write a config row for) a junk path.
  for (const p of normalized) {
    if (!fs.existsSync(p)) return badRequest(res, `member path is missing: ${p}`);
    if (!isGitRepo(p)) return badRequest(res, `member is not a git repository: ${p}`);
  }
  try { res.json(await scanMembers(normalized)); }
  catch (err) { sendMetricsError(res, err); }
});

app.post('/api/workspaces/:id/metrics-route', async (req, res) => {
  if (!WORKSPACE_KEY_RE.test(req.params.id)) return res.status(404).json({ error: 'workspace not found', code: 'NOT_FOUND' });
  try { res.json(await routeWorkspaceMembers(req.params.id)); }
  catch (err) { sendMetricsError(res, err); }
});

// ---------------------------------------------------------------------------
// Team policy (team-policy design §11): scopes/statuses, the effective document for one
// scope, publish, notes for the New pipeline form, enable / follow, workspace routing.
// ---------------------------------------------------------------------------
const POLICY_ERROR_STATUS = {
  BAD_REQUEST: 400, NOT_FOUND: 404, NO_ORIGIN: 400, DELEGATE_INVALID: 400, NOT_HOME: 409, NOT_ENABLED: 409,
  REMOTE_UNREACHABLE: 502, FETCH_FAILED: 502, WORKTREE_FAILED: 500, COMMIT_FAILED: 500,
  PUSH_REJECTED: 409, PUSH_RETRIES_EXHAUSTED: 409,
};
function sendPolicyError(res, err) {
  const code = (err && err.code) || 'INTERNAL';
  res.status(POLICY_ERROR_STATUS[code] || 500).json({
    error: err && err.message ? err.message : String(err), code,
    ...(err && err.stderr ? { stderr: err.stderr } : {}),
    ...(err && err.hint ? { hint: err.hint } : {}),
    ...(err && Array.isArray(err.warnings) ? { warnings: err.warnings } : {}),
  });
}

app.get('/api/policy/scopes', async (req, res) => {
  try {
    const scopes = await listPolicyScopes({ discover: req.query.discover === '1' });
    // The Plugins page strip and the setup checklist: every home's requirements, folded.
    const docs = [];
    for (const s of scopes.projects) if (s.home && !docs.some((d) => d.slug === s.home)) {
      const r = await resolveProjectPolicy(s.path, { discover: false }).catch(() => null);
      if (r?.ok) docs.push({ slug: r.home, doc: r.doc });
    }
    res.json({ ...scopes, requirements: pluginRequirements(docs), blockedPlugins: blockedPluginFindings(docs) });
  } catch (err) { sendPolicyError(res, err); }
});

app.get('/api/policy', async (req, res) => {
  const scope = parseScopeParam(req.query.scope);
  if (!scope) return badRequest(res, 'scope must be project:<projectKey> or workspace:<workspaceId>');
  try {
    const { meta, r, workspaceRun, projectDir } = await policyForScope(scope);
    if (!r.ok) return res.status(404).json({ error: r.detail || `no team policy for this ${scope.kind}`, code: (r.code || r.reason || 'NOT_ENABLED').toString().toUpperCase().replace(/-/g, '_'), scope: meta });
    res.json(policyPayload(meta, r, { workspaceRun, projectDir }));
  } catch (err) { sendPolicyError(res, err); }
});

// New pipeline form (board 8): the notes for a selection — caps, off-policy picks, plugin gaps.
app.get('/api/policy/notes', async (req, res) => {
  const scope = parseScopeParam(req.query.scope);
  if (!scope) return badRequest(res, 'scope must be project:<projectKey> or workspace:<workspaceId>');
  try {
    const { meta, r, workspaceRun } = await policyForScope(scope);
    if (!r.ok) return res.json({ scope: meta, policy: null, notes: [] });
    const fields = fieldsForRun(r.doc, { workspaceRun });
    const guardrailsId = typeof req.query.guardrailsId === 'string' && req.query.guardrailsId ? req.query.guardrailsId : 'permissive';
    const set = await readGuardrailSet(guardrailsId);
    const models = typeof req.query.models === 'string' && req.query.models ? req.query.models.split(',').filter(Boolean).map((m) => ({ role: null, model: m })) : [];
    const dev = deviationsFor(fields, { guardrailsId, guardrailSet: set, stepModels: models, installed: installedPluginsMap(), worcaVersion: POLICY_WORCA_VERSION, metricsRecord: null });
    res.json({ scope: meta, policy: { home: r.home, sha: r.sha, delegated: r.delegated, from: r.from, caps: capSummary(r.doc, { workspaceRun }) }, notes: dev, guardrailsDefault: fields['guardrails.default']?.value ?? null });
  } catch (err) { sendPolicyError(res, err); }
});

// Publish (board 5): one commit to the home's worca-policy branch; a rejection comes back verbatim.
app.put('/api/policy', async (req, res) => {
  const scope = parseScopeParam(req.body?.scope);
  if (!scope) return badRequest(res, 'scope must be project:<projectKey> or workspace:<workspaceId>');
  if (!req.body || typeof req.body.doc !== 'object' || req.body.doc === null) return badRequest(res, 'doc must be the policy document');
  try {
    const { r } = await policyForScope(scope);
    if (!r.ok) return res.status(404).json({ error: r.detail || 'no team policy for this scope', code: 'NOT_ENABLED' });
    if (!r.homeDir || !fs.existsSync(r.homeDir)) return res.status(409).json({ error: `the policy home ${r.home} is not checked out on this machine`, code: 'NOT_HOME' });
    const out = await publishPolicy(r.homeDir, req.body.doc, { message: typeof req.body.message === 'string' ? req.body.message : null, by: actorOf(req) });
    res.json({ ok: true, slug: out.slug, sha: out.sha, unchanged: !!out.unchanged, doc: out.doc });
  } catch (err) { sendPolicyError(res, err); }
});

// Validate without publishing (the editor's live check): the normaliser's warnings, if any.
app.post('/api/policy/validate', (req, res) => {
  const { doc, warnings, unknownSchema } = normalizePolicyDoc(req.body?.doc);
  res.json({ ok: !!doc && !unknownSchema && warnings.length === 0, warnings, doc });
});

app.post('/api/policy/discover', async (_req, res) => {
  try { await discoverAllPolicies({ force: true }); res.json(await listPolicyScopes()); }
  catch (err) { sendPolicyError(res, err); }
});

app.get('/api/projects/:key/policy', async (req, res) => {
  const p = await tmProject(req, res); if (!p) return;
  try { res.json({ status: await projectPolicyStatus(p, { discover: req.query.discover === '1' }) }); }
  catch (err) { sendPolicyError(res, err); }
});

app.post('/api/projects/:key/policy/enable', async (req, res) => {
  const p = await tmProject(req, res); if (!p) return;
  const body = req.body || {};
  const mode = body.mode === 'follow' ? 'follow' : body.mode === 'here' || body.mode == null ? 'here' : null;
  if (!mode) return badRequest(res, 'mode must be "here" or "follow"');
  try {
    const result = await enableTeamPolicy(p.path, { mode, delegateTo: body.delegateTo || null, change: body.change === true, title: typeof body.title === 'string' ? body.title : '', by: actorOf(req) });
    res.json({ ...result, status: await projectPolicyStatus(p) });
  } catch (err) { sendPolicyError(res, err); }
});

app.post('/api/workspaces/:id/policy-route', async (req, res) => {
  if (!WORKSPACE_KEY_RE.test(req.params.id)) return res.status(404).json({ error: 'workspace not found', code: 'NOT_FOUND' });
  try { res.json(await routeWorkspaceMembersPolicy(req.params.id)); }
  catch (err) { sendPolicyError(res, err); }
});

// ---------------------------------------------------------------------------
// POST /api/history/pr  -> enrich the skeleton with live PR state, pushed back
// over the WS as batched `history-pr` events (reuses broadcast(), the same
// fire-to-every-socket primitive wireRun/wireScan use). The body's `token`
// echoes the client's load token so it can drop stale batches after a newer
// Refresh. Responds 200 immediately; results arrive asynchronously.
// ---------------------------------------------------------------------------
app.post('/api/history/pr', async (req, res) => {
  const token = Number(req.body && req.body.token) || 0;
  res.json({ ok: true }); // results arrive over WS
  try {
    await enrichPipelinesPr((items, done) =>
      broadcast({ type: 'history-pr', token, done, items }));
  } catch {
    broadcast({ type: 'history-pr', token, done: true, items: [] }); // always terminate the spinner
  }
});

// ---------------------------------------------------------------------------
// GET /api/history/:key/:id  -> saved pipeline markdown + state, by store key
// ---------------------------------------------------------------------------
app.get('/api/history/:key/:id', async (req, res) => {
  if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(req.params.key)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  try {
    const data = await readPipelineByKey(req.params.key, req.params.id);
    if (!data) return res.status(404).json({ error: 'pipeline not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/history/:key/:id/log  -> the run's persisted live-log NDJSON (text)
// ---------------------------------------------------------------------------
app.get('/api/history/:key/:id/log', async (req, res) => {
  if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(req.params.key)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  try {
    const text = await readRunLogText(req.params.key, req.params.id);
    if (text == null) return res.status(404).json({ error: 'no log' });
    res.type('application/x-ndjson').send(text);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Internal, line-anchored diff comments. Bound to BOTH route families below: the
// /api/history/:key/:id key regex forbids a slash, so a workspace run (store key
// "workspaces/<id>") can only be reached through /api/workspaces/:id/runs/:runId —
// the same split the /diff and /log routes already carry. One handler set, two
// registrations: the two can never diverge.
//
// Traversal posture matches the /diff route below: the run dir comes from a DB row
// via readRunArtifactText, and the relPath is the CONSTANT DIFF_PATCH_FILE. No
// route here ever passes user input as a path.
// ---------------------------------------------------------------------------

// The history key regex is an inline literal on every route in this family; this
// block keeps that convention rather than introducing a shared constant the rest
// of the file does not use.
const commentsHistoryKey = (res, key) => {
  if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(key)) {
    res.status(404).json({ error: 'pipeline not found' });
    return null;
  }
  return key;
};
const commentsWorkspaceKey = (res, id) => {
  if (!WORKSPACE_KEY_RE.test(id)) { res.status(404).json({ error: 'pipeline not found' }); return null; }
  return `workspaces/${id}`;
};
const commentIdParam = (res, value) => {
  if (typeof value !== 'string' || !DC_ID_RE.test(value)) {
    res.status(400).json({ error: 'invalid comment id' });
    return null;
  }
  return value;
};
const commentsFail = (res, err) => res.status(500).json({ error: err && err.message ? err.message : String(err) });

/** The run row for a store key + id, or null after answering 404. */
function commentRun(res, storeKey, id) {
  const row = lookupPipelineRow(storeKey, id);
  if (!row) { res.status(404).json({ error: 'pipeline not found' }); return null; }
  return row;
}

async function commentsList(res, storeKey, id) {
  try {
    const row = commentRun(res, storeKey, id);
    if (!row) return;
    // The UI needs to know whether the '+' affordance may appear at all; a run
    // whose patch is gone (archived, or never captured) can only read and delete.
    const patchText = await readRunArtifactText(storeKey, row.id, DIFF_PATCH_FILE);
    res.json({
      comments: listDiffComments(storeKey, row.id),
      patchAvailable: !!patchText,
      // Section keys the protected-path floor will refuse whatever the line, so the
      // browser can drop the '+' up front instead of surfacing a 400 on submit. The
      // preset itself never leaves the server.
      protectedPaths: protectedSectionKeys(patchText),
    });
  } catch (err) { commentsFail(res, err); }
}

async function commentsCreate(req, res, storeKey, id) {
  try {
    const row = commentRun(res, storeKey, id);
    if (!row) return;
    const body = req.body || {};
    const patchText = await readRunArtifactText(storeKey, row.id, DIFF_PATCH_FILE);
    // `!patchText` covers BOTH null (absent/unreadable) and '' (present but empty):
    // addDiffComment refuses the empty string too, and it must surface as 409, not
    // as the 400 an anchor failure would get.
    if (!patchText) {
      // 409, not 400: the request is well-formed, the RUN is no longer commentable.
      return res.status(409).json({ error: 'this run has no stored diff — comments cannot be created on it' });
    }
    const comment = addDiffComment({
      storeKey, pipelineId: row.id, patchText,
      project: body.project ?? null, path: body.path, side: body.side, line: body.line,
      body: body.body, author: 'user', authorName: actorOf(req),
    });
    res.status(201).json({ comment });
  } catch (err) {
    if (err instanceof DiffCommentError) return badRequest(res, err.message);
    commentsFail(res, err);
  }
}

/** A comment reached through a run URL must BELONG to that run — never id alone. */
function commentOfRun(res, storeKey, id, cid) {
  const row = commentRun(res, storeKey, id);
  if (!row) return null;
  const comment = getDiffComment(cid);
  if (!comment || comment.storeKey !== storeKey || comment.pipelineId !== row.id) {
    res.status(404).json({ error: 'comment not found' });
    return null;
  }
  return comment;
}

function commentsPatch(req, res, storeKey, id, cid) {
  try {
    // Existence BEFORE shape: an unknown run must 404 on every verb, including a
    // PATCH whose body happens to be malformed.
    if (!commentOfRun(res, storeKey, id, cid)) return;
    const raw = (req.body || {}).resolved;
    if (typeof raw !== 'boolean') return badRequest(res, 'resolved must be a boolean');
    res.json({ comment: setDiffCommentResolved(cid, raw) });
  } catch (err) {
    // A reply id: the store refuses (D2) and the browser shows the reason inline.
    if (err instanceof DiffCommentError) return badRequest(res, err.message);
    commentsFail(res, err);
  }
}

/** Reply inside a thread. The parent must belong to THIS run (commentOfRun); the
 *  store enforces one level, the body cap and the author. No patch gate: a reply
 *  anchors to nothing new, so there is no anchor to re-resolve and no patch to read
 *  it from. (Not an archived-run affordance — archiving deletes a run's comments,
 *  src/core/pipeline-delete.mjs.) */
function commentsReply(req, res, storeKey, id, cid) {
  try {
    if (!commentOfRun(res, storeKey, id, cid)) return;
    const comment = addDiffCommentReply({ parentId: cid, body: (req.body || {}).body, author: 'user', authorName: actorOf(req) });
    res.status(201).json({ comment });
  } catch (err) {
    if (err instanceof DiffCommentError) return badRequest(res, err.message);
    commentsFail(res, err);
  }
}

function commentsDelete(res, storeKey, id, cid) {
  try {
    if (!commentOfRun(res, storeKey, id, cid)) return;
    deleteDiffComment(cid);
    res.json({ ok: true });
  } catch (err) { commentsFail(res, err); }
}

app.get('/api/history/:key/:id/comments', async (req, res) => {
  const key = commentsHistoryKey(res, req.params.key); if (!key) return;
  await commentsList(res, key, req.params.id);
});
app.post('/api/history/:key/:id/comments', async (req, res) => {
  const key = commentsHistoryKey(res, req.params.key); if (!key) return;
  await commentsCreate(req, res, key, req.params.id);
});
app.patch('/api/history/:key/:id/comments/:cid', (req, res) => {
  const key = commentsHistoryKey(res, req.params.key); if (!key) return;
  const cid = commentIdParam(res, req.params.cid); if (!cid) return;
  commentsPatch(req, res, key, req.params.id, cid);
});
app.delete('/api/history/:key/:id/comments/:cid', (req, res) => {
  const key = commentsHistoryKey(res, req.params.key); if (!key) return;
  const cid = commentIdParam(res, req.params.cid); if (!cid) return;
  commentsDelete(res, key, req.params.id, cid);
});
app.post('/api/history/:key/:id/comments/:cid/replies', (req, res) => {
  const key = commentsHistoryKey(res, req.params.key); if (!key) return;
  const cid = commentIdParam(res, req.params.cid); if (!cid) return;
  commentsReply(req, res, key, req.params.id, cid);
});

app.get('/api/workspaces/:id/runs/:runId/comments', async (req, res) => {
  const key = commentsWorkspaceKey(res, req.params.id); if (!key) return;
  await commentsList(res, key, req.params.runId);
});
app.post('/api/workspaces/:id/runs/:runId/comments', async (req, res) => {
  const key = commentsWorkspaceKey(res, req.params.id); if (!key) return;
  await commentsCreate(req, res, key, req.params.runId);
});
app.patch('/api/workspaces/:id/runs/:runId/comments/:cid', (req, res) => {
  const key = commentsWorkspaceKey(res, req.params.id); if (!key) return;
  const cid = commentIdParam(res, req.params.cid); if (!cid) return;
  commentsPatch(req, res, key, req.params.runId, cid);
});
app.delete('/api/workspaces/:id/runs/:runId/comments/:cid', (req, res) => {
  const key = commentsWorkspaceKey(res, req.params.id); if (!key) return;
  const cid = commentIdParam(res, req.params.cid); if (!cid) return;
  commentsDelete(res, key, req.params.runId, cid);
});
app.post('/api/workspaces/:id/runs/:runId/comments/:cid/replies', (req, res) => {
  const key = commentsWorkspaceKey(res, req.params.id); if (!key) return;
  const cid = commentIdParam(res, req.params.cid); if (!cid) return;
  commentsReply(req, res, key, req.params.runId, cid);
});

// Unresolved counts for every run, for the History list pill. Its own endpoint
// rather than a field on /api/history: that response has a localStorage skeleton
// cache, so a cached paint would show a stale pill; and diff-comments-changed can
// repaint pills from here without forcing a whole History reload.
app.get('/api/diff-comments/counts', (_req, res) => {
  try { res.json({ counts: unresolvedCounts() }); } catch (err) { commentsFail(res, err); }
});

// ---------------------------------------------------------------------------
// GET /api/history/:key/:id/diff -> the run's persisted diff-patch.patch, inline
// (text/x-diff). The route is status-agnostic and always has been: the artifact
// exists for every run that reached a checkpoint AND changed something under it —
// the done path AND the stopped/error paths, which build results too (orchestrator
// run() and resume()). A run stopped before its checkpoint has none, nor does one
// that changed nothing (_buildResults writes neither artifact for an empty patch),
// and neither does an archived one; all of those 404 and the UI shows its empty state.
// Key validation mirrors the /log route (:1529); the artifact read follows the
// recovery-patch route's readRunArtifactText pattern (:1408) — the log routes
// themselves use the specialized readRunLogText. The relPath is the CONSTANT
// DIFF_PATCH_FILE: readRunArtifactText does not guard traversal, so no route may
// ever pass user input there.
// ---------------------------------------------------------------------------
app.get('/api/history/:key/:id/diff', async (req, res) => {
  if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(req.params.key)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  try {
    const text = await readRunArtifactText(req.params.key, req.params.id, DIFF_PATCH_FILE);
    if (text == null) return res.status(404).json({ error: 'no diff' });
    res.type('text/x-diff').send(text);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// GET /api/history/:key/:id/artifact?rel= -> { rel, text } for ONE artifact the
// run indexed (the End card's result chip). `rel` never reaches the FS: it only
// selects among the pipeline's own artifacts rows (exact rel_path, else a path
// suffix). Same key regex as /diff.
app.get('/api/history/:key/:id/artifact', async (req, res) => {
  if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(req.params.key)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  try {
    const hit = await resolveIndexedArtifact(req.params.key, req.params.id, req.query.rel);
    if (!hit) return res.status(404).json({ error: 'artifact not found' });
    res.json(hit);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// GET /api/history/:key/:id/ask-files/:askId/:index -> the same bytes, resolved
// through the store key. Same key regex as /diff and /artifact.
app.get('/api/history/:key/:id/ask-files/:askId/:index', async (req, res) => {
  if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(req.params.key)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  try {
    await serveAskFile(res, await askFilesStoreDir(req.params.key, req.params.id),
      req.params.askId, req.params.index);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/runs/:id?projectKey=...  (or ?projectDir=...)
// ARCHIVE a FINISHED pipeline: reclaims everything on disk — its store folder,
// its shared plan/review markdown, its artifacts index rows, and its local
// branch + worktree — then soft-deletes the row (`archived_at`) instead of
// dropping it, so its cost and outcome stay in Statistics forever. The row
// disappears from History and every list/count read. The remote branch is never
// touched. Refused (409) while the run is live in this process.
// ---------------------------------------------------------------------------
app.delete('/api/runs/:id', async (req, res) => {
  const id = req.params.id;
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId.trim() : '';
  const projectKey = typeof req.query.projectKey === 'string' ? req.query.projectKey.trim() : '';
  const projectDir = resolveProjectDir(req.query.projectDir);
  // A workspace pipeline routes to store/workspaces/<key>/; its id reads as
  // not-found when malformed (no path-traversal surface).
  if (workspaceId && !WORKSPACE_KEY_RE.test(workspaceId)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  if (projectKey && !/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(projectKey)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  if (!workspaceId && !projectKey && !projectDir) {
    return badRequest(res, 'workspaceId, projectKey or projectDir is required');
  }

  // Never tear down a pipeline that is still live in this server process.
  const liveActive = [...runs.values()].some((r) =>
    (r.pipelineId === id || r.id === id) &&
    ['running', 'starting', 'created', 'pausing'].includes(String(r.status || '').toLowerCase()));
  if (liveActive) return res.status(409).json({ error: 'cannot delete a running pipeline' });

  try {
    const report = await archivePipeline({
      workspaceKey: workspaceId || null,
      key: workspaceId ? null : (projectKey || null),
      projectDir: (workspaceId || projectKey) ? null : projectDir,
      id,
    });
    if (!report) return res.status(404).json({ error: 'pipeline not found' });
    if (report.archived) {
      const archBy = actorOf(req);
      appendAuditById(report.id, `Run archived${byActor(archBy)}.`, { actor: archBy });
    }
    emitChanged('pipelines-changed', 'deleted');
    res.json({ ok: true, ...report });
  } catch (e) {
    if (e && e.code === 'RUNNING') return res.status(409).json({ error: e.message });
    if (e && e.code === 'RETAINED_WORKTREE') return res.status(409).json({ error: e.message });
    if (e && e.code === 'BAD_REQUEST') return badRequest(res, e.message);
    res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

// Reclaim only worktrees retained after a teardown commit failure. Unlike
// Archive, this keeps the pipeline in History and saves recovery patches first.
app.post('/api/runs/:id/discard-worktree', async (req, res) => {
  const id = req.params.id;
  const scope = resolveRunScope(req, res);
  if (!scope) return;
  const liveActive = [...runs.values()].some((r) =>
    (r.pipelineId === id || r.id === id) &&
    ['running', 'starting', 'created', 'pausing'].includes(String(r.status || '').toLowerCase()));
  if (liveActive) return res.status(409).json({ error: 'cannot discard a running pipeline worktree' });

  try {
    const report = await discardRetainedWorktrees({
      workspaceKey: scope.workspaceId || null,
      key: scope.workspaceId ? null : (scope.projectKey || null),
      projectDir: (scope.workspaceId || scope.projectKey) ? null : scope.projectDir,
      id,
      by: actorOf(req),
    });
    if (!report) return res.status(404).json({ error: 'pipeline not found' });
    emitChanged('pipelines-changed', 'updated');
    res.json({ ok: true, ...report });
  } catch (e) {
    if (e && e.code === 'RUNNING') return res.status(409).json({ error: e.message });
    if (e && e.code === 'SNAPSHOT_FAILED') return res.status(409).json({ error: e.message });
    if (e && e.code === 'BAD_REQUEST') return badRequest(res, e.message);
    res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// PR remotes (fork support). The ship-it dialog picks (1) the remote the feature
// branch is pushed to and (2) the remote whose repo the PR is opened in — GitHub's
// "compare across forks". Names are user-defined, so nothing is special-cased
// beyond fallbacks: the project's remembered choice (when those remotes still
// exist) -> `upstream` for the base when one exists -> `origin` -> first remote.
// ---------------------------------------------------------------------------
function defaultPrRemotes(remotes, remembered) {
  const names = remotes.map((r) => r.name);
  const has = (n) => !!n && names.includes(n);
  const first = names[0] || null;
  const pushRemote = has(remembered?.pushRemote) ? remembered.pushRemote : (has('origin') ? 'origin' : first);
  const baseRemote = has(remembered?.baseRemote) ? remembered.baseRemote
    : (has('upstream') ? 'upstream' : (has('origin') ? 'origin' : first));
  return { pushRemote, baseRemote };
}

// Resolve a pipeline for the PR routes (store key first, else project dir) from a
// body or a query object. Writes the error response itself and returns null.
// (/api/pr/mergeable keeps its own copy: its bad-key/not-found cases answer 200
// UNKNOWN, not 404.)
async function resolvePrPipeline(src, res) {
  const id = typeof src.id === 'string' ? src.id.trim() : '';
  if (!id) { badRequest(res, 'id is required'); return null; }
  let state = null;
  try {
    if (typeof src.projectKey === 'string' && src.projectKey.trim()) {
      if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(src.projectKey)) {
        res.status(404).json({ error: 'pipeline not found' });
        return null;
      }
      const data = await readPipelineByKey(src.projectKey, id);
      state = data && data.state;
    } else {
      const projectDir = resolveProjectDir(src.projectDir);
      if (!projectDir) { badRequest(res, 'projectDir or projectKey is required'); return null; }
      const data = await readPipeline(projectDir, id);
      state = data && data.state;
    }
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
    return null;
  }
  if (!state) { res.status(404).json({ error: 'pipeline not found' }); return null; }
  return { id, state };
}

// ---------------------------------------------------------------------------
// GET /api/pr/remotes?id=&projectKey=|projectDir=  -> the project's git remotes for
// the ship-it dialog plus the defaults POST /api/pr applies when the body names
// none. Same pipeline resolution as POST /api/pr (the repo dir comes from the
// pipeline's store_meta, never from the query). gh is not required here.
// The base-branch choices ride along: `chain` is the run chain's base branches,
// root first (a run outside a chain: just its source), `defaultBase` its root, and
// `branches` each remote's branches from the LOCAL remote-tracking refs (no fetch),
// without HEAD and the run's own feature branch. A git remote failure still carries
// the chain so the dialog can offer it.
// -> { ok, remotes:[{name,fetchUrl,pushUrl,host,owner,repo,slug}],
//      defaults:{pushRemote,baseRemote}, remembered:{pushRemote,baseRemote}|null,
//      chain:[branch], defaultBase:branch|null, branches:{[remote]:[branch]} }
// ---------------------------------------------------------------------------
app.get('/api/pr/remotes', async (req, res) => {
  const resolved = await resolvePrPipeline(req.query || {}, res);
  if (!resolved) return;
  const repoDir = resolved.state.projectDir;          // null when store_meta is missing
  if (!repoDir) return badRequest(res, 'pipeline has no project directory');
  const feature = resolved.state.branch && resolved.state.branch.feature;
  const source = resolved.state.branch && resolved.state.branch.source;
  const walked = chainBaseBranchesOf(resolved.state.id || resolved.id);
  const chain = (walked.length ? walked : (source ? [source] : [])).filter((b) => b !== feature);
  const defaultBase = chain[0] || null;
  const rl = await listRemotes(repoDir);
  if (!rl.ok) return res.status(500).json({ error: `git remote failed: ${rl.error}`, chain, defaultBase });
  const remembered = readPrRemotePrefs(repoDir);
  const rb = await listRemoteBranches(repoDir, rl.remotes.map((r) => r.name));
  const branches = {};
  for (const [name, list] of Object.entries(rb.byRemote)) branches[name] = list.filter((b) => b !== feature);
  res.json({ ok: true, remotes: rl.remotes, defaults: defaultPrRemotes(rl.remotes, remembered), remembered,
    chain, defaultBase, branches });
});

// ---------------------------------------------------------------------------
// POST /api/pr  -> push the pipeline's feature branch (if needed) and open a PR
// against its source branch (or the dialog's `baseBranch`) via the GitHub CLI.
// Mergeability is read back only here (never during list rendering).
// body: { id, projectDir?, projectKey?, pushRemote?, baseRemote?, baseBranch? } —
// remote names are validated against the repo's real remote list (never trusted
// from the body); baseBranch must be a well-formed ref other than the feature
// branch (whether the base repo has it is gh's call, its error surfaces as usual).
// ---------------------------------------------------------------------------
app.post('/api/pr', async (req, res) => {
  const body = req.body || {};
  if (!(typeof body.id === 'string' && body.id.trim())) return badRequest(res, 'id is required');
  if (!(await hasGh())) {
    return res.status(409).json({ error: 'GitHub CLI (gh) is not available' });
  }
  const resolved = await resolvePrPipeline(body, res);
  if (!resolved) return;
  const { id, state } = resolved;

  const repoDir = state.projectDir;
  const feature = state.branch && state.branch.feature;
  const source = state.branch && state.branch.source;
  if (!repoDir || !feature || !source) {
    return badRequest(res, 'pipeline has no branch info to open a PR');
  }
  // The base branch: the dialog's pick (a run chain defaults to its root there),
  // else the run's own source. Per run — never remembered with the remotes.
  let base = source;
  if (body.baseBranch !== undefined && body.baseBranch !== null) {
    const b = typeof body.baseBranch === 'string' ? body.baseBranch.trim() : '';
    if (!isSyntacticRef(b)) return badRequest(res, `invalid base branch: ${String(body.baseBranch).slice(0, 80)}`);
    if (b === feature) return badRequest(res, 'the base branch cannot be the feature branch');
    base = b;
  }

  // Remote selection. A named remote must exist; unnamed ones take the dialog's
  // defaults. With no usable remote list (no remotes, unparseable URLs) the legacy
  // argv applies: push `origin`, no --repo, bare head. A git failure is only fatal
  // when the body actually names a remote (otherwise legacy argv, as before).
  const named = (v) => !(v === undefined || v === null || v === '');
  const rl = await listRemotes(repoDir);
  if (!rl.ok && (named(body.pushRemote) || named(body.baseRemote))) {
    return res.status(500).json({ error: `git remote failed: ${rl.error}` });
  }
  const remotes = rl.ok ? rl.remotes : [];
  const byName = new Map(remotes.map((r) => [r.name, r]));
  const pick = (field, label) => {
    const v = body[field];
    if (!named(v)) return { name: null };
    if (typeof v !== 'string' || !byName.has(v.trim())) {
      return { error: `unknown ${label} remote: ${String(v).slice(0, 80)}` };
    }
    return { name: v.trim() };
  };
  const pushPick = pick('pushRemote', 'push');
  if (pushPick.error) return badRequest(res, pushPick.error);
  const basePick = pick('baseRemote', 'base');
  if (basePick.error) return badRequest(res, basePick.error);
  const defaults = defaultPrRemotes(remotes, readPrRemotePrefs(repoDir));
  const pushRemote = pushPick.name || defaults.pushRemote || 'origin';
  const baseRemote = basePick.name || defaults.baseRemote || 'origin';
  const pushR = byName.get(pushRemote) || null;
  const baseR = byName.get(baseRemote) || null;
  // Always target the chosen base repo explicitly (gh's default-repo guess prefers
  // a remote named upstream over origin); use the owner:branch head only when the
  // branch lives in a different repository than the PR (gh matches by head label).
  const repo = baseR?.slug || null;
  const crossRepo = !!(pushR?.slug && baseR?.slug && !sameRepo(pushR, baseR));
  const headOwner = crossRepo ? pushR.owner : null;

  // Push (idempotent) -> create PR -> read mergeability. All args are passed as
  // an argv array (no shell), so branch/remote/source names cannot inject.
  const pushed = await pushBranch(repoDir, feature, pushRemote);
  if (!pushed.ok) return res.status(500).json({ error: `git push failed: ${pushed.stderr}` });

  // A PR opened by a shared bot still names the person behind it (identity.mjs); none for 'local'.
  const footer = prAttributionFooter(state.startedBy);
  const pr = await createPr({
    projectDir: repoDir, base, head: feature, title: state.title || feature, repo, headOwner,
    ...(footer ? { body: `${state.title || feature}${footer}` } : {}),
  });
  if (!pr.ok) return res.status(500).json({ error: `gh pr create failed: ${pr.error}` });

  // Persist the PR facts we just learned, so History/stats survive a gh outage.
  const parsePrNumber = (u) => Number((/\/pull\/(\d+)/.exec(u) || [])[1]) || null;
  const pipelineIdForPr = state?.id || id;   // prefer the canonical state id
  if (pipelineIdForPr) {
    persistPrState(pipelineIdForPr, { url: pr.url, number: parsePrNumber(pr.url), state: 'OPEN' });
    // Who clicked Create PR (the footer names who STARTED the run; this names who shipped it).
    const prBy = actorOf(req);
    appendAuditById(pipelineIdForPr, `Pull request ${pr.existed ? 'linked' : 'opened'}${byActor(prBy)}: ${pr.url}`, { actor: prBy });
  }
  // Remember the choice for this project (only once a PR was actually created).
  if (remotes.length) {
    try { await setPrRemotePrefs(repoDir, { pushRemote, baseRemote }); } catch { /* best-effort */ }
  }

  const mergeable = await prMergeable({ projectDir: repoDir, head: feature, repo, headOwner, prUrl: pr.url || null });
  res.json({ ok: true, url: pr.url, mergeable, existed: !!pr.existed });
});

// ---------------------------------------------------------------------------
// POST /api/pr/mergeable -> re-read mergeability for a pipeline's PR head so the
// History UI can refresh the "merge: checking…" pill after GitHub finishes its
// async computation. Read-only + best-effort: no push, no create — just
// `gh pr view`. Missing `id` is the ONLY hard error (400, like /api/pr); every
// other failure (gh missing, unresolvable pipeline, bad key, thrown error)
// resolves to UNKNOWN (200) so the client simply hides the pill.
// body: { id, projectKey? , projectDir? }
// ---------------------------------------------------------------------------
app.post('/api/pr/mergeable', async (req, res) => {
  const body = req.body || {};
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return badRequest(res, 'id is required');
  if (!(await hasGh())) return res.json({ ok: true, mergeable: 'UNKNOWN' });

  try {
    // Resolve the pipeline state (by store key, else by project dir) — mirrors /api/pr.
    let state = null;
    if (typeof body.projectKey === 'string' && body.projectKey.trim()) {
      if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(body.projectKey)) {
        return res.json({ ok: true, mergeable: 'UNKNOWN' });
      }
      const data = await readPipelineByKey(body.projectKey, id);
      state = data && data.state;
    } else {
      const projectDir = resolveProjectDir(body.projectDir);
      if (!projectDir) return badRequest(res, 'projectDir or projectKey is required');
      const data = await readPipeline(projectDir, id);
      state = data && data.state;
    }

    const repoDir = state && state.projectDir;
    const feature = state && state.branch && state.branch.feature;
    if (!repoDir || !feature) return res.json({ ok: true, mergeable: 'UNKNOWN' });

    // A persisted pr_url is repo-agnostic (a fork PR lives in the base repo, which
    // need not be gh's default for this checkout); the head selector is only the
    // fallback for rows that never recorded a PR.
    const prUrl = readPrState(state.id || id)?.url || null;
    const mergeable = await prMergeable({ projectDir: repoDir, head: feature, prUrl });
    res.json({ ok: true, mergeable });
  } catch {
    res.json({ ok: true, mergeable: 'UNKNOWN' });   // best-effort: never error the refresh
  }
});

// ---------------------------------------------------------------------------
// POST /api/install  -> copy agents + skill into <projectDir>/.claude
// body: { projectDir }
// ---------------------------------------------------------------------------
app.post('/api/install', async (req, res) => {
  const projectDir = resolveProjectDir((req.body || {}).projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  try {
    const result = await installAgents(projectDir);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Project registry: GET list / POST add / DELETE remove. Thin delegation to
// src/core/projects.mjs (which owns validation + persistence).
// ---------------------------------------------------------------------------
app.get('/api/branches', async (req, res) => {
  const projectDir = resolveProjectDir(req.query.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  try {
    const [branches, current] = await Promise.all([
      listLocalBranches(projectDir),
      currentBranch(projectDir),
    ]);
    // Run branches: this project's pipelines whose feature branch still exists (spec D7).
    // Throw-safe on purpose: test/branches-api.test.mjs calls this route for a temp directory
    // that is not a registered project (and has no temp home) — the DB read must never turn the
    // plain branch list into a 500.
    const have = new Set(branches);
    const runsOut = [];
    try {
      const rows = getDb().prepare(`SELECT id, title, status, updated_at, branch FROM pipelines
        WHERE project_key = ? AND target = 'project' AND archived_at IS NULL ORDER BY started_at DESC LIMIT 50`).all(projectKey(projectDir));
      for (const r of rows) {
        let b = null; try { b = JSON.parse(r.branch || 'null'); } catch { b = null; }
        if (b && typeof b.feature === 'string' && have.has(b.feature)) runsOut.push({ branch: b.feature, pipelineId: r.id, title: r.title || null, status: r.status, endedAt: r.updated_at || null });
      }
    } catch (err) {
      console.error(`[worca-ui] run branches lookup failed: ${err && err.message ? err.message : err}`);
    }
    res.json({ branches, current, runs: runsOut });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/projects', async (_req, res) => {
  try {
    res.json({ projects: await listProjects() });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/projects', async (req, res) => {
  const body = req.body || {};
  try {
    await pinUiLevel();                        // before the first project ends "fresh install"
    const projects = await addProject({ name: body.name, path: body.path });
    emitChanged('projects-changed', 'created');
    discoverProject(normalizeProjectPath(body.path), { force: true })
      .then(() => emitChanged('team-metrics-changed', 'discovered'))
      .catch(() => { /* offline or not a git repo: discovery retries hourly */ });
    res.json({ projects });
  } catch (err) {
    // addProject only throws on validation (empty/duplicate/not-a-directory), so
    // a thrown error here is a client error -> 400. (A rare write-time I/O error
    // would also surface as 400; acceptable for this single-user local tool.)
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// POST /api/projects/clone {url, branch?, name?} -> 202 {jobId}: clone a repository into the
// projects folder and register it (src/core/clone-project.mjs). A job, because a large clone
// outlives a proxied request (Cloudflare closes at 100 s). GET /api/projects/clone/:id polls it;
// 'clone-changed' broadcasts each transition. Refusals known up front answer at once (4xx).
const CLONE_JOBS = new Map();   // jobId -> { id, url, name, dir, state: running|done|error, code?, error?, project? }
const CLONE_STATUS = { invalid: 400, 'not-allowed': 403, exists: 409, 'not-found': 404, 'auth-failed': 502, timeout: 504, failed: 500 };
function publicCloneJob(j) {
  const { id, url, name, dir, state, code = null, error = null, project = null, startedAt, endedAt = null } = j;
  return { id, url, name, dir, state, code, error, project, startedAt, endedAt };
}
async function startCloneJob(req) {
  const plan = planClone(req, { projectsRoot: getProjectsRoot() });   // throws CloneError at once
  if ([...CLONE_JOBS.values()].some((j) => j.state === 'running' && j.dir === plan.dir)) {
    throw new CloneError('exists', `${plan.dir} is being cloned already`);
  }
  const job = { id: `cln_${randomBytes(4).toString('hex')}`, url: plan.url, name: plan.name, dir: plan.dir, state: 'running', startedAt: new Date().toISOString() };
  CLONE_JOBS.set(job.id, job);
  broadcast({ type: 'clone-changed', job: publicCloneJob(job) });
  (async () => {
    try {
      await pinUiLevel();
      const { project } = await cloneProject(req, { projectsRoot: getProjectsRoot(), listProjects, addProject });
      Object.assign(job, { state: 'done', project });
      emitChanged('projects-changed', 'created');
      discoverProject(project.path, { force: true })
        .then(() => emitChanged('team-metrics-changed', 'discovered'))
        .catch(() => { /* offline or not a git repo: discovery retries hourly */ });
    } catch (err) {
      Object.assign(job, { state: 'error', code: err instanceof CloneError ? err.code : 'failed', error: err && err.message ? err.message : String(err) });
    }
    job.endedAt = new Date().toISOString();
    broadcast({ type: 'clone-changed', job: publicCloneJob(job) });
    // Keep finished jobs for an hour so a reload can still read the outcome.
    setTimeout(() => CLONE_JOBS.delete(job.id), 3600_000).unref?.();
  })();
  return job;
}
app.post('/api/projects/clone', async (req, res) => {
  const body = req.body || {};
  try {
    const job = await startCloneJob({ url: body.url, branch: body.branch ?? null, name: body.name ?? null });
    res.status(202).json({ jobId: job.id, job: publicCloneJob(job) });
  } catch (err) {
    const code = err instanceof CloneError ? err.code : 'failed';
    res.status(CLONE_STATUS[code] || 500).json({ error: err && err.message ? err.message : String(err), code });
  }
});
app.get('/api/projects/clone/:id', (req, res) => {
  const job = CLONE_JOBS.get(String(req.params.id));
  if (!job) return res.status(404).json({ error: 'clone job not found' });
  res.json({ job: publicCloneJob(job) });
});

app.delete('/api/projects', async (req, res) => {
  const name = typeof req.query.name === 'string' ? req.query.name : '';
  if (!name.trim()) return badRequest(res, 'name is required');
  try {
    // Scheduled runs of a removed project can never start: cancel them with it.
    const before = (await listProjects()).find((p) => p && p.name === name.trim());
    const projects = await removeProject(name);
    if (before && before.path) {
      try { if (cancelForTarget({ projectDir: before.path })) emitChanged('schedules-changed', 'target-removed'); }
      catch (err) { console.error(`[worca-ui] schedule cleanup failed: ${err && err.message ? err.message : err}`); }
    }
    emitChanged('projects-changed', 'deleted');
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// /api/memory/* -> worca's agent memory store (agent-memory-design.md §11). Thin
// handlers over src/core/memory-store.mjs: names are validated BEFORE any fs call,
// MemoryError codes map to statuses, every write snapshots (the store does it) and
// broadcasts `memory-changed`. Two route families — `global` and `projects/:key` —
// share ONE handler set through resolveMemoryScope().
// ---------------------------------------------------------------------------
function memoryHttpStatus(err) {
  const code = err && err.code;
  if (code === 'ENAME') return 400;
  if (code === 'ECASE' || code === 'EFULL') return 409;
  if (code === 'ETOOBIG') return 413;
  if (code === 'ENOSCOPE') return 404;
  return 500;
}
function memoryError(res, err) {
  const status = memoryHttpStatus(err);
  const message = String(err && err.message ? err.message : err).replace(/^memory: /, '');
  if (status === 500) console.error(`[worca-ui] memory: ${err && err.stack ? err.stack : message}`);
  return res.status(status).json({ error: status === 500 ? 'memory store error' : message });
}

/** Thread-less, seq-less frame (B5): an Ask tool, a REST write or a run that mounted memory
 *  changed a scope; open Memory views refetch. Best effort. Exported through _testing. */
function emitMemoryChanged(scopeKeyStr) {
  try { broadcast({ type: 'memory-changed', scope: scopeKeyStr }); return true; } catch { return false; }
}

/** { scope, key, project } for the global family or a REGISTERED project key; null ⇒ 404.
 *  `family` is passed by registerMemoryRoutes rather than inferred (I2-#19): express populates
 *  `req.params.key` only for the `projects/:key` prefix, so `req.params.key === undefined` WOULD
 *  separate the two registrations — an implicit path-shape coincidence where one named argument
 *  reads as intent. The two prefixes never collide: every second segment is a literal. */
async function resolveMemoryScope(req, family) {
  if (family === 'global') return { scope: GLOBAL_SCOPE, key: 'global', project: null };
  const key = String(req.params.key || '');
  if (!PROJECT_KEY_RE.test(key)) return null;           // the shape store.mjs#projectKey produces
  const p = (await listProjects()).find((x) => x.key === key);
  if (!p) return null;
  return { scope: projectScope(key), key: `projects/${key}`, project: { key: p.key, name: p.name, path: p.path } };
}

/** Start a defragment run through the ONE run handler (§7.3): the wrapper only builds the body.
 *  startRunHandler reads `req.body` exactly once, at its top, so rewriting it here is sound. */
async function defragRequest(req, res, { memoryScope, projectKey: key }) {
  if (!PROJECT_KEY_RE.test(String(key || ''))) return res.status(404).json({ error: 'project not found' });
  const p = (await listProjects()).find((x) => x.key === key);
  if (!p) return res.status(404).json({ error: 'project not found' });
  if (!p.exists) return badRequest(res, `project path is missing: ${p.path}`);   // else startRunHandler would mkdir it
  req.body = {
    projectDir: p.path,
    prompt: memoryScope === 'global' ? 'Defragment global memory.' : `Defragment the memory of project ${p.name}.`,
    title: memoryScope === 'global' ? 'Memory defragment (global)' : `Memory defragment: ${p.name}`,
    workflowId: MEMORY_DEFRAG_WORKFLOW_ID,
    guardrailsId: 'normal',
    memoryScope,
    ...(req.body && req.body.mock === true ? { mock: true } : {}),
  };
  return startRunHandler(req, res);
}

/** Settings › Memory as the health card names it: `{ model, effort, label, stale }`, or null when
 *  unset. Checked the way a run checks it (memory-defrag-model.mjs), against this scope's catalog —
 *  the project's own for a project scope, the project-less one for global. `stale`: the model left
 *  the catalog, so a run degrades to the workflow default. */
async function defragModelState(catalogDir) {
  const stored = memoryDefragModel();
  if (!stored.model) return null;
  const models = await listModels(catalogDir);
  const r = resolveDefragModel({ stored, models });
  if (!r.model) return { model: stored.model, effort: stored.effort, label: stored.model, stale: true };
  const hit = models.find((m) => m.id === r.model);
  return { model: r.model, effort: r.effort, label: (hit && hit.label) || r.model, stale: false };
}

function registerMemoryRoutes(prefix, { family }) {
  const scoped = (handler) => async (req, res) => {
    try {
      const ctx = await resolveMemoryScope(req, family);
      if (!ctx) return res.status(404).json({ error: 'project not found' });
      return await handler(req, res, ctx);
    } catch (err) { return memoryError(res, err); }
  };
  const named = (req, res) => {
    const name = String(req.params.name || '');
    if (!isValidMemoryName(name)) { badRequest(res, `invalid memory name — ${MEMORY_NAME_HELP}`); return null; }
    return name;
  };
  /** B23: while a defragment run is live on this scope, that run's final sync would silently
   *  overwrite a REST write ("the run's version wins", memory-sync.mjs) — refuse instead. */
  const defragLocked = (res, key) => {
    const live = liveDefragRun(key);
    if (!live) return false;
    res.status(409).json({ error: 'a defragment run is live on this memory scope — wait for it to finish', runId: live.id });
    return true;
  };
  const onError = (p, err) => console.warn(`[worca-ui] memory: ${p}: ${err && err.message ? err.message : err}`);

  app.get(prefix, scoped(async (_req, res, { scope, key, project }) => {
    const report = await memoryScopeReport(memoryRoot(), scope, memoryCaps(), { onError });
    res.json({
      scope: key, project, files: report.entries, state: report.state, health: report.health, defragRunId: liveDefragRun(key)?.id || null,
      defragModel: await defragModelState(project ? project.path : ''),
    });
  }));
  app.get(`${prefix}/files/:name`, scoped(async (req, res, { scope }) => {
    const name = named(req, res); if (name === null) return;
    const f = await readMemory(memoryRoot(), scope, name);
    if (!f) return res.status(404).json({ error: 'memory file not found' });
    res.json({ name, text: f.text, meta: f.meta, body: f.body });
  }));
  app.put(`${prefix}/files/:name`, scoped(async (req, res, { scope, key }) => {
    const name = named(req, res); if (name === null) return;
    const text = req.body && typeof req.body.text === 'string' ? req.body.text : null;
    if (text === null) return badRequest(res, 'text (string) is required');
    if (defragLocked(res, key)) return;
    const r = await withStoreLock(memoryRoot(), () => writeMemory(memoryRoot(), scope, name, text, { source: 'user', caps: memoryCaps() }));
    emitMemoryChanged(key);
    res.json({ ok: true, name, created: r.created, bytes: r.bytes });
  }));
  app.delete(`${prefix}/files/:name`, scoped(async (req, res, { scope, key }) => {
    const name = named(req, res); if (name === null) return;
    if (defragLocked(res, key)) return;
    const removed = await withStoreLock(memoryRoot(), () => removeMemory(memoryRoot(), scope, name, { source: 'user' }));
    if (!removed) return res.status(404).json({ error: 'memory file not found' });
    emitMemoryChanged(key);
    res.json({ ok: true });
  }));
  app.get(`${prefix}/history`, scoped(async (_req, res, { scope }) => {
    const snapshots = (await listSnapshots(memoryRoot(), scope)).map((s) => ({ id: s.id, files: s.files }));
    res.json({ snapshots });
  }));
  app.post(`${prefix}/history/:id/restore`, scoped(async (req, res, { scope, key }) => {
    if (defragLocked(res, key)) return;
    await withStoreLock(memoryRoot(), () => restoreSnapshot(memoryRoot(), scope, String(req.params.id || ''), { source: 'user' }));   // ENAME -> 400, ENOSCOPE -> 404
    emitMemoryChanged(key);
    res.json({ ok: true });
  }));
  app.post(`${prefix}/defragment`, async (req, res) => {
    try {
      if (family === 'projects') return await defragRequest(req, res, { memoryScope: 'project', projectKey: String(req.params.key || '') });
      const key = req.body && typeof req.body.projectKey === 'string' ? req.body.projectKey.trim() : '';
      if (!key) return badRequest(res, 'projectKey is required — a global defragment run is hosted by a project');
      return await defragRequest(req, res, { memoryScope: 'global', projectKey: key });
    } catch (err) { return memoryError(res, err); }
  });
}

// Every scope's health in one read. Fetched ON DEMAND — when the Memory tab or a Projects
// expander opens, and on a `memory-changed` frame — never on a timer: each call reads and
// hashes every file of every registered project's scope (I2-#16).
app.get('/api/memory/health', async (_req, res) => {
  try {
    const caps = memoryCaps();
    const g = await memoryScopeReport(memoryRoot(), GLOBAL_SCOPE, caps);
    const projects = [];
    for (const p of await listProjects()) {
      const r = await memoryScopeReport(memoryRoot(), projectScope(p.key), caps);
      projects.push({ key: p.key, name: p.name, health: r.health, defragRunId: liveDefragRun(`projects/${p.key}`)?.id || null });
    }
    res.json({ global: { health: g.health, defragRunId: liveDefragRun('global')?.id || null }, projects });
  } catch (err) { return memoryError(res, err); }
});
registerMemoryRoutes('/api/memory/global', { family: 'global' });
registerMemoryRoutes('/api/memory/projects/:key', { family: 'projects' });

// ---------------------------------------------------------------------------
// Filesystem browsing for the add-project folder selector. Hybrid picker:
// POST /api/fs/pick-folder opens the native OS dialog (the server runs on the
// user's machine); when it reports `unsupported` the UI falls back to an
// in-app modal fed by GET /api/fs/dirs. Localhost-only like every route here
// (global isLocalRequest middleware).
app.post('/api/fs/pick-folder', async (req, res) => {
  try {
    // `purpose` only picks the dialog title from a closed set (folder-dialog.mjs).
    const purpose = typeof req.body?.purpose === 'string' ? req.body.purpose : undefined;
    res.json(await pickFolderNative({ purpose }));
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/fs/dirs', async (req, res) => {
  try {
    res.json(await listFolders(typeof req.query.path === 'string' ? req.query.path : ''));
  } catch (err) {
    if (err && err.code === 'BAD_REQUEST') return badRequest(res, err.message);
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Workspace registry: a named set of 2+ onboarded git repos with one editable
// interconnection description. Thin delegation to src/core/workspaces.mjs (which
// owns validation + persistence); the route maps err.code -> HTTP exactly like
// /api/projects + /api/workflows. The :id is the workspaceKey, validated against
// WORKSPACE_KEY_RE before any disk touch (a stale/crafted id reads as 404).
// ---------------------------------------------------------------------------
app.get('/api/workspaces', async (_req, res) => {
  try {
    res.json({ workspaces: await listWorkspaces() });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/workspaces/:id', async (req, res) => {
  const id = req.params.id;
  if (!WORKSPACE_KEY_RE.test(id)) return res.status(404).json({ error: 'workspace not found' });
  try {
    const workspace = await readWorkspace(id);
    if (!workspace) return res.status(404).json({ error: 'workspace not found' });
    res.json({ workspace });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/workspaces', async (req, res) => {
  const body = req.body || {};
  // Normalize member paths through the same single source of truth as /api/run;
  // createWorkspace re-normalizes + de-dupes by canonical root, but a fast <2
  // reject here matches the spec's defense-in-depth (§2.3).
  const projectPaths = Array.isArray(body.projectPaths)
    ? body.projectPaths.map((p) => resolveProjectDir(p)).filter(Boolean)
    : [];
  if (projectPaths.length < 2) return badRequest(res, 'a workspace needs at least 2 member projects');
  try {
    // No explicit home (the create wizard no longer asks): adopt the one member that already
    // records, if there is exactly one; every other case is "Choose…" on the workspace card.
    const explicit = typeof body.metricsProject === 'string' && body.metricsProject ? body.metricsProject : null;
    const metricsProject = explicit ?? await autoMetricsHome(projectPaths);
    // Team policy home (design §9): defaults to the metrics home when that member's policy
    // resolves, else the one member (or shared home) whose policy does; else unset.
    let policyProject = typeof body.policyProject === 'string' && body.policyProject ? body.policyProject : null;
    if (!policyProject) {
      const viaMetrics = metricsProject ? await resolveProjectPolicy(metricsProject, { discover: false }).catch(() => null) : null;
      policyProject = viaMetrics?.ok ? metricsProject : await autoPolicyHome({ projectPaths }).catch(() => null);
    }
    const workspace = await createWorkspace({ name: body.name, projectPaths, description: body.description, metricsProject, policyProject });
    emitChanged('workspaces-changed', 'created');
    res.status(201).json({ workspace, metricsHomeAuto: !explicit && !!metricsProject });
  } catch (err) {
    const status = workspaceErrorStatus(err && err.code);
    return res.status(status).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.patch('/api/workspaces/:id', async (req, res) => {
  const id = req.params.id;
  if (!WORKSPACE_KEY_RE.test(id)) return res.status(404).json({ error: 'workspace not found' });
  const body = req.body || {};
  // Immutability (defense-in-depth, §2.3): the project set never changes via PATCH.
  if ('projectPaths' in body || 'projectKeys' in body) {
    return badRequest(res, 'a workspace project set is immutable; PATCH accepts only name/description/metricsProject');
  }
  // Pass through only the editable fields.
  const patch = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (typeof body.description === 'string') patch.description = body.description;
  if ('metricsProject' in body) {
    if (body.metricsProject !== null && typeof body.metricsProject !== 'string') {
      return badRequest(res, 'metricsProject must be a member project path or null');
    }
    patch.metricsProject = body.metricsProject;
  }
  if ('policyProject' in body) {
    if (body.policyProject !== null && typeof body.policyProject !== 'string') {
      return badRequest(res, 'policyProject must be a member project path or null');
    }
    patch.policyProject = body.policyProject;
  }
  try {
    const workspace = await updateWorkspace(id, patch);
    if ('metricsProject' in patch) emitChanged('workspaces-changed', 'metrics-home');
    if ('policyProject' in patch) { emitChanged('workspaces-changed', 'policy-home'); emitChanged('team-policy-changed', 'policy-home'); }
    res.json({ workspace });
  } catch (err) {
    const status = workspaceErrorStatus(err && err.code);
    return res.status(status).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.delete('/api/workspaces/:id', async (req, res) => {
  const id = req.params.id;
  if (!WORKSPACE_KEY_RE.test(id)) return res.status(404).json({ error: 'workspace not found' });
  // 409 while a live workspace run OR live scan for this workspace exists. The
  // module-level deleteWorkspace has no runs map, so this guard lives here (§2.3).
  const live = [...runs.values()].some((r) =>
    r.workspaceId === id &&
    ['running', 'starting', 'created', 'scanning', 'pausing'].includes(String(r.status || '').toLowerCase()));
  if (live) return res.status(409).json({ error: 'cannot delete a workspace with a live run or scan' });
  try {
    const report = await deleteWorkspace(id);
    try { if (cancelForTarget({ workspaceId: id })) emitChanged('schedules-changed', 'target-removed'); }
    catch (err) { console.error(`[worca-ui] schedule cleanup failed: ${err && err.message ? err.message : err}`); }
    emitChanged('workspaces-changed', 'deleted');
    res.json({ ok: true, warnings: (report && report.warnings) || [] });
  } catch (err) {
    const status = workspaceErrorStatus(err && err.code);
    return res.status(status).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Scan endpoints (the wizard's backend, §2.4 / §5.4). Both fire-and-forget:
// mint scanId, register a kind:'scan' entry in the SAME runs Map, wire its
// scan-* events, start createWorkspaceScan(...).run() detached, return {scanId}.
// The scan NEVER persists workspaces.json — persistence is the wizard's explicit
// follow-up CRUD call (POST create / PATCH re-scan).
// ---------------------------------------------------------------------------

/**
 * Shared launcher for both scan routes (DRY, §2.4). Mints scanId, registers the
 * entry, wires events, starts the engine detached with a .catch backstop that
 * converts an unexpected throw into a broadcast scan-error (status 'error') so
 * the process never crashes on a fire-and-forget scan.
 * @param {{projectPaths:string[], name?:string, workspaceId?:string}} args
 * @returns {string} scanId
 */
function startScan({ projectPaths, name, workspaceId }) {
  const orch = createWorkspaceScan({
    projectPaths,
    name,
    agentsDir: AGENTS_DIR,
    claude: { permissionMode: 'acceptEdits', mock: isTruthy(process.env.WORCA_MOCK ?? process.env.ORCH_MOCK) },
  });
  // The engine mints its own scanId (scan_<uuid>) and tags every emitted event
  // with it; use THAT as the runs-Map key + the returned id so the entry, its
  // buffered events, and WS reconnect/replay (?scanId=) all agree on one id.
  const scanId = orch.getState().scanId;
  const entry = {
    id: scanId,
    scanId,
    orch,
    kind: 'scan',
    projectDir: (Array.isArray(projectPaths) && projectPaths[0]) || null,
    workspaceId: workspaceId || null,
    title: name || 'workspace scan',
    status: 'scanning',
    startedAt: new Date().toISOString(),
    events: [],
    pendingQuestion: null,
  };
  runs.set(scanId, entry);
  wireScan(entry);

  Promise.resolve()
    .then(() => orch.run())
    .catch((err) => {
      // run() should never throw (it emits scan-error), but a defensive backstop
      // mirrors POST /api/run: surface an unexpected throw as a tagged scan-error.
      const event = { scanId, type: 'scan-error', message: err && err.message ? err.message : String(err) };
      entry.status = 'error';
      entry.events.push(event);
      broadcast(event);
    });

  return scanId;
}

// POST /api/workspaces/scan (pre-persist, Step 2->3). Takes projectPaths directly:
// validate >=2 paths + fs.existsSync each + reject non-git-repos (400); the deep
// git work happens inside the engine.
app.post('/api/workspaces/scan', async (req, res) => {
  try {
    const body = req.body || {};
    const projectPaths = Array.isArray(body.projectPaths)
      ? body.projectPaths.map((p) => resolveProjectDir(p)).filter(Boolean)
      : [];
    if (projectPaths.length < 2) return badRequest(res, 'a workspace scan needs at least 2 member projects');
    for (const dir of projectPaths) {
      if (!fs.existsSync(dir)) return badRequest(res, `member path is missing: ${dir}`);
      if (!isGitRepo(dir)) return badRequest(res, `member is not a git repository: ${dir}`);
    }
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined;
    const scanId = startScan({ projectPaths, name });
    res.json({ scanId });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/workspaces/:id/scan (re-scan). Reads the workspace (404 if absent),
// scans ws.projectPaths, tags the entry with workspaceId. 409 if a live run for
// that workspace already exists (avoid graphify-build contention).
app.post('/api/workspaces/:id/scan', async (req, res) => {
  const id = req.params.id;
  if (!WORKSPACE_KEY_RE.test(id)) return res.status(404).json({ error: 'workspace not found' });
  try {
    const ws = await readWorkspace(id);
    if (!ws) return res.status(404).json({ error: 'workspace not found' });
    const liveRun = [...runs.values()].some((r) =>
      r.workspaceId === id && r.kind === 'workspace-run' &&
      ['running', 'starting', 'created'].includes(String(r.status || '').toLowerCase()));
    if (liveRun) return res.status(409).json({ error: 'a live run exists for this workspace' });
    const scanId = startScan({ projectPaths: ws.projectPaths, name: ws.name, workspaceId: ws.id });
    res.json({ scanId });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/scan/stop  body:{scanId} -> entry.orch.stop() (aborts in-flight
// investigators + best-effort scan-worktree/branch cleanup in the engine's
// finally, D4); marks the entry 'stopped'. Idempotent: an unknown/finished scan
// still returns ok.
app.post('/api/scan/stop', (req, res) => {
  const scanId = req.body && typeof req.body.scanId === 'string' ? req.body.scanId : '';
  const entry = scanId ? runs.get(scanId) : null;
  if (entry && entry.kind === 'scan' && entry.orch && typeof entry.orch.stop === 'function') {
    try { entry.orch.stop(); } catch { /* best-effort */ }
    entry.status = 'stopped';
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /api/workspaces/:id/runs/:runId  -> persisted state + markdown for a
// finished workspace run. The /api/history/:key/:id key regex forbids a slash,
// so a workspace run (store key "workspaces/<key>") needs this dedicated route.
// readWorkspacePipeline joins ONLY workspaceStorePath(validatedKey) -> no
// path-traversal surface; do NOT widen the history :key regex (§2.7).
// ---------------------------------------------------------------------------
app.get('/api/workspaces/:id/runs/:runId', async (req, res) => {
  const id = req.params.id;
  if (!WORKSPACE_KEY_RE.test(id)) return res.status(404).json({ error: 'pipeline not found' });
  try {
    const data = await readWorkspacePipeline(id, req.params.runId);
    if (!data) return res.status(404).json({ error: 'pipeline not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/workspaces/:id/runs/:runId/log', async (req, res) => {
  if (!WORKSPACE_KEY_RE.test(req.params.id)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  try {
    const text = await readRunLogText(`workspaces/${req.params.id}`, req.params.runId);
    if (text == null) return res.status(404).json({ error: 'no log' });
    res.type('application/x-ndjson').send(text);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// NOTE: the /comments twins for workspace runs are registered with their project
// siblings up at the diff-comments block — the pair must be read together.
app.get('/api/workspaces/:id/runs/:runId/diff', async (req, res) => {
  if (!WORKSPACE_KEY_RE.test(req.params.id)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  try {
    const text = await readRunArtifactText(`workspaces/${req.params.id}`, req.params.runId, DIFF_PATCH_FILE);
    if (text == null) return res.status(404).json({ error: 'no diff' });
    res.type('text/x-diff').send(text);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// The End-card result chip's workspace twin (see the project route above).
app.get('/api/workspaces/:id/runs/:runId/artifact', async (req, res) => {
  if (!WORKSPACE_KEY_RE.test(req.params.id)) return res.status(404).json({ error: 'pipeline not found' });
  try {
    const hit = await resolveIndexedArtifact(`workspaces/${req.params.id}`, req.params.runId, req.query.rel);
    if (!hit) return res.status(404).json({ error: 'artifact not found' });
    res.json(hit);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// The ask-form preview twin for a workspace run (see the project route above).
// WORKSPACE_KEY_RE is the only validation the id needs; the key is composed here
// and never taken from the client, so there is no path-traversal surface.
app.get('/api/workspaces/:wid/runs/:id/ask-files/:askId/:index', async (req, res) => {
  if (!WORKSPACE_KEY_RE.test(req.params.wid)) return res.status(404).json({ error: 'pipeline not found' });
  try {
    await serveAskFile(res, await askFilesStoreDir(`workspaces/${req.params.wid}`, req.params.id),
      req.params.askId, req.params.index);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings  -> { root, projectsRoot, projectsRootDefault, default }
//   root                : the configured Worca CC data-root base, '' when unset
//                         (the `default` field is what applies then).
//   projectsRoot        : the RAW persisted projectsRoot (§5.1), '' when unset —
//                         the same raw contract as `root`, NOT the effective
//                         value. Two reasons this is not getProjectsRoot():
//                         (a) an effective value is never '', so "unset" would be
//                         indistinguishable from "explicitly set" and the UI's
//                         "leave blank" affordance would be unreachable;
//                         (b) WORCA_PROJECTS_ROOT would be echoed as if stored,
//                         and the next Save would promote that env override into
//                         settings.json. Runs still resolve via getProjectsRoot().
//   projectsRootDefault : what applies when projectsRoot is blank — the env tier
//                         when exported, else defaultRoot(). The UI placeholder.
//                         Additive; `default` keeps its `root` meaning.
//   app                 : { version, repoUrl, releaseUrl } — static identity for
//                         the About card (APP_INFO, from package.json). GET-only:
//                         it is not a setting, so POST keeps echoing
//                         settingsState() + chat unchanged.
// POST /api/settings -> set either key and return the resulting full state.
//   Only keys PRESENT in the body are written, so a projectsRoot-only POST can
//   never reset `root` (and vice versa). An explicitly empty value still resets
//   that one key. A body with neither key keeps today's contract: it resets root.
//   The other settings keys (runRootMode, the two context caps, skillMount) are
//   settings-file-only in this change and deliberately not exposed here.
// Validation lives in src/core/settings.mjs; this is thin delegation mirroring
// /api/projects.
// ---------------------------------------------------------------------------
const settingsState = () => ({
  root: getWorcaRoot(), projectsRoot: rawProjectsRoot(),
  projectsRootDefault: defaultProjectsRoot(), default: defaultRoot(),
  pipelineCostLimitUsd: pipelineCostLimitUsd(),
  totalCostLimitUsd: totalCostLimitUsd(),
  costLimitResetPeriod: costLimitResetPeriod(),
  humanRateUsdPerHour: humanRateUsdPerHour(),
  askMaxTurns: askMaxTurns(),
  askMaxBudgetUsd: askMaxBudgetUsd(),
  debugSpawnEnabled: storedDebugSpawnEnabled(),          // what is STORED (the checkbox)
  debugSpawnEffective: effectiveDebugSpawn(),             // what the next spawn will DO, and why
  titleModel: storedTitleModel(),                         // the STORED id (the select), null = run's model
  titleModelEffective: describeTitleModel(),              // env override / stale id, for the hint line (#422)
  hideBuiltinModels: hideBuiltinModels(),
  theme: storedTheme(),                                   // system | light | dark (dark-mode design §6)
  schedule: scheduleDefaults(),                           // defaults a NEW schedule inherits
  uiLevel: effectiveUiLevel(),                            // simple | advanced | expert (docs/ui-levels.md)
  memoryDefrag: memoryDefragModel(),                      // Settings › Memory: the STORED { model, effort } (null = the workflow default)
  memoryDefragDefault: defragDefaultModel(),              // what "(default)" means there: the built-in's own model
});

/** Settings ▸ Auto workflow model: the stored id + what the classifier will actually use
 *  (env override > stored catalog id > the Sonnet-class default). Async because the
 *  catalog is. */
async function autoModelState() {
  const models = await listModels('');
  const stored = storedAutoWorkflowModel();
  const model = resolveAutoModel(models, { setting: stored });
  const source = process.env[AUTO_MODEL_ENV]?.trim() ? 'env'
    : (stored && model.toLowerCase() === stored.toLowerCase()) ? 'settings' : 'default';
  return { autoWorkflowModel: stored, autoWorkflowModelEffective: { model, source } };
}

// ---------------------------------------------------------------------------
// Instance lifecycle (`worca ui status|stop|restart`, src/core/ui-instance.mjs)
// ---------------------------------------------------------------------------
// `uiControl` is set by the boot block below when the server owns a port. Under
// test (app imported, no bind) it stays empty: /api/health still answers, and
// /api/shutdown refuses with 503 rather than exiting the test runner.
const uiControl = { token: null, onShutdown: null, startedAt: null };
const startedAtIso = () => uiControl.startedAt || null;

app.get('/api/health', (req, res) => {
  // Remote mode: it is the one unauthenticated route, so a caller from outside
  // the box learns only what it is, not the pid/bind/port/boot time.
  if (REMOTE_MODE && !isInContainer(req)) return res.json({ name: UI_HEALTH_NAME, version: PKG_VERSION });
  const addr = req.socket && req.socket.localPort;
  res.json({
    name: UI_HEALTH_NAME,
    version: PKG_VERSION,
    pid: process.pid,
    host: HOST,
    port: addr || PORT,
    startedAt: startedAtIso(),
  });
});

// Who this request is, for the header's "Signed in as" (identity.mjs). Attribution only.
// `shared`: a real per-person sign-in (Access or a trusted header), the one case where the UI
// shows people at all; a local install or a one-person WORCA_IDENTITY_NAME deployment shows none.
app.get('/api/whoami', (req, res) => {
  const who = resolveIdentity(req);
  res.json(who.source === 'local' ? { name: null, source: 'local', shared: false } : { ...who, shared: isSharedIdentity(who.source) });
});

/** Constant-time bearer check; `expected` is the boot-time token from ui.json. */
function bearerMatches(header, expected) {
  if (!expected || typeof header !== 'string') return false;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.post('/api/shutdown', (req, res) => {
  if (!uiControl.token || typeof uiControl.onShutdown !== 'function') {
    return res.status(503).json({ error: 'shutdown is only available on a server started with `worca ui`' });
  }
  if (!bearerMatches(req.headers.authorization, uiControl.token)) {
    return res.status(401).json({ error: 'shutdown requires the bearer token from the instance file' });
  }
  res.status(202).json({ ok: true, pid: process.pid });
  // Answer first, exit on the next tick so the 202 actually leaves the socket.
  setImmediate(() => uiControl.onShutdown('request'));
});

app.get('/api/settings', async (_req, res) => {
  res.json({ ...settingsState(), ...(await autoModelState()), chat: chatPrefs(), app: APP_INFO });
});

app.get('/api/budget', (_req, res) => {
  const budget = budgetStatus();
  // The sidebar's "Saved this month" figure rides on this snapshot (money-saved design §10).
  // Additive and best-effort: a failed savings read must never cost the gate figures the
  // New-view Start button and every cost banner key on, so it degrades to nulls instead.
  let savings = { windowHumanHours: null, windowSavedUsd: null };
  try { savings = budgetWindowSavings(budget); } catch { /* keep the nulls */ }
  res.json({ ...budget, ...savings });
});

app.post('/api/settings', async (req, res) => {
  const body = req.body || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const hasBudgetKey = has('pipelineCostLimitUsd') || has('totalCostLimitUsd') || has('costLimitResetPeriod');
  const hasHumanRateKey = has('humanRateUsdPerHour');
  const hasAskKey = has('askMaxTurns') || has('askMaxBudgetUsd');
  const hasDebugSpawnKey = has('debugSpawnEnabled');
  const hasTitleModelKey = has('titleModel');
  const hasHideBuiltinKey = has('hideBuiltinModels');
  const hasThemeKey = has('theme');
  const hasUiLevelKey = has('uiLevel');
  const hasAutoKey = has('autoWorkflowModel');
  const autoModels = hasAutoKey ? await listModels('') : null;
  // Settings › Memory: the defragment { model, effort } pair, checked against the same
  // project-less catalog the Settings pickers offer (a run re-checks it against its own).
  const hasMemoryDefragKey = has('memoryDefrag');
  const defragModels = hasMemoryDefragKey ? (autoModels || await listModels('')) : null;
  // #422: the title model is a SELECT over the catalog, so an id that is not a
  // catalog member is a client bug (or a stale option) — refuse it here rather
  // than store an id resolveModelEnv could never route.
  const titleModelInput = hasTitleModelKey ? (body.titleModel ?? '') : undefined;
  // Normalize the budget keys first, then validate them as a SET before ANY write.
  // Each setter persists on its own, so a two-key POST whose second key is invalid
  // used to answer 400 with the first key already on disk, no budget-changed
  // emitted, and a client (which early-returns on !res.ok) still painting its
  // pre-save values over a half-applied settings file.
  const budget = {};
  if (has('pipelineCostLimitUsd')) budget.pipelineCostLimitUsd = body.pipelineCostLimitUsd ?? '';
  if (has('totalCostLimitUsd')) budget.totalCostLimitUsd = body.totalCostLimitUsd ?? '';
  if (has('costLimitResetPeriod')) {
    budget.costLimitResetPeriod = typeof body.costLimitResetPeriod === 'string' ? body.costLimitResetPeriod : '';
  }
  // Ask Worca per-turn guards (ask-worca-design.md §6.9): same set-validation
  // discipline. `null` is a VALUE for askMaxBudgetUsd (no cap) and must survive
  // normalisation; only undefined becomes a clear.
  const ask = {};
  if (has('askMaxTurns')) ask.askMaxTurns = body.askMaxTurns ?? '';
  if (has('askMaxBudgetUsd')) ask.askMaxBudgetUsd = body.askMaxBudgetUsd === undefined ? '' : body.askMaxBudgetUsd;
  try {
    assertCostLimitInputs(budget);
    if (hasHumanRateKey) assertHumanRateInput(body.humanRateUsdPerHour ?? '');
    assertAskLimitInputs(ask);
    if (hasDebugSpawnKey) assertDebugSpawnInput(body.debugSpawnEnabled);
    if (hasTitleModelKey) {
      assertTitleModelInput(titleModelInput);
      if (titleModelInput !== '' && titleModelInput !== null && !catalogHasModel(titleModelInput)) {
        throw new Error(`unknown model ${JSON.stringify(String(titleModelInput))} — pick one from the catalog`);
      }
    }
    if (hasHideBuiltinKey) assertHideBuiltinModelsInput(body.hideBuiltinModels);
    if (hasThemeKey) assertThemeInput(body.theme);
    if (hasUiLevelKey) assertUiLevelInput(body.uiLevel);
    if (hasAutoKey) assertAutoWorkflowModelInput(body.autoWorkflowModel ?? '', autoModels);
    if (hasMemoryDefragKey) assertMemoryDefragModelInput(body.memoryDefrag, defragModels);
    // Root first: it is the one key whose setter can still fail AFTER the asserts
    // above (an unusable path), so every other key's write must come after it or
    // a mixed POST would answer 400 with those keys already applied on disk.
    // Legacy contract: a POST that names NO known key clears root; the known
    // keys live beside their setters (SETTINGS_POST_KEYS), not in a list here.
    if (has('root') || !SETTINGS_POST_KEYS.some(has)) {
      await setWorcaRoot(typeof body.root === 'string' ? body.root : '');
    }
    if (has('chat')) await setChatPrefs(body.chat);
    if (has('projectsRoot')) {
      await setProjectsRoot(typeof body.projectsRoot === 'string' ? body.projectsRoot : '');
    }
    if (has('pipelineCostLimitUsd')) await setPipelineCostLimitUsd(budget.pipelineCostLimitUsd);
    if (has('totalCostLimitUsd')) await setTotalCostLimitUsd(budget.totalCostLimitUsd);
    if (has('costLimitResetPeriod')) await setCostLimitResetPeriod(budget.costLimitResetPeriod);
    if (hasHumanRateKey) await setHumanRateUsdPerHour(body.humanRateUsdPerHour ?? '');
    if (has('askMaxTurns')) await setAskMaxTurns(ask.askMaxTurns);
    if (has('askMaxBudgetUsd')) await setAskMaxBudgetUsd(ask.askMaxBudgetUsd);
    if (hasDebugSpawnKey) await setDebugSpawnEnabled(body.debugSpawnEnabled);
    if (hasTitleModelKey) await setTitleModel(titleModelInput);
    if (hasHideBuiltinKey) await setHideBuiltinModels(body.hideBuiltinModels);
    if (hasThemeKey) await setTheme(body.theme);
    if (hasUiLevelKey) await setUiLevel(body.uiLevel);
    if (hasAutoKey) await setAutoWorkflowModel(body.autoWorkflowModel ?? '', { models: autoModels });
    if (hasMemoryDefragKey) await setMemoryDefragModel(body.memoryDefrag, { models: defragModels });
    if (has('schedule')) await setScheduleDefaults(body.schedule && typeof body.schedule === 'object' ? body.schedule : {});
    if (hasBudgetKey) emitChanged('budget-changed');
    // Other open tabs repaint their Settings cards (a stale tab could otherwise
    // "save" its old checkbox state over this one with no feedback to either).
    if (hasAskKey || hasDebugSpawnKey || hasTitleModelKey || hasHideBuiltinKey || hasThemeKey || hasUiLevelKey || hasAutoKey || hasHumanRateKey || hasMemoryDefragKey || has('schedule')) emitChanged('settings-changed');
    res.json({ ...settingsState(), ...(await autoModelState()), chat: chatPrefs() });
  } catch (err) {
    // The setters throw only on an unusable path -> client error (400).
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// ---------------------------------------------------------------------------
// Per-project model/effort config + custom-model registry. Validation lives in
// src/core/config.mjs; these routes are thin delegation (mirror /api/projects).
// ---------------------------------------------------------------------------
app.get('/api/config', async (req, res) => {
  const raw = req.query.projectDir;
  // No project selected yet (e.g. a fresh clone): still return the catalog so
  // the picker is never empty. The project-less catalog is predefined ⊕ GLOBAL
  // entries (the global catalog is project-independent by design §4.2); only
  // legacy per-project custom models need a projectDir.
  if (raw == null || raw === '') {
    return res.json({
      config: { steps: {}, customModels: [] },
      models: await listModels(''), steps: agentSteps(), efforts: EFFORTS,
      subagentModels: SUBAGENT_MODEL_VALUES,
    });
  }
  const projectDir = resolveProjectDir(raw);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  try {
    // readRunConfig returns the full per-project config: legacy steps/customModels
    // PLUS the run-config workflows{} (node model/effort, feedback cycles) and
    // activeWorkflowId. It is a superset of readConfig, so the client keeps using
    // config.steps unchanged while gaining config.workflows / config.activeWorkflowId.
    // NOTE: readRunConfig forwards unknown extra keys verbatim — a project
    // configured under the REMOVED per-project guardrails model may still show
    // its raw legacy blob under config.guardrails. It is inert: nothing
    // interprets it (guardrails are selected per run via /api/guardrails).
    const [config, models] = await Promise.all([
      readRunConfig(projectDir), listModels(projectDir),
    ]);
    res.json({
      config, models, steps: agentSteps(), efforts: EFFORTS,
      // The sub-agent model policy vocabulary is a FIXED alias enum (the CLI's Task
      // tool refuses catalog ids), so it ships beside `efforts` rather than being
      // derived from `models`.
      subagentModels: SUBAGENT_MODEL_VALUES,
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/config', async (req, res) => {
  const body = req.body || {};
  const projectDir = resolveProjectDir(body.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  try {
    await setStep(projectDir, body.step, {
      model: body.model, effort: body.effort, fanOut: body.fanOut, askQuestions: body.askQuestions,
      subagentModel: body.subagentModel,
    });
    // Respond with the FULL run-config (mirrors PATCH): setStep's return value is
    // the legacy {steps, customModels} view only, and clients assign the response
    // to their whole config state — echoing the narrow view dropped workflows/
    // activeWorkflowId and made saved node models paint as unconfigured.
    const config = await readRunConfig(projectDir);
    res.json({ config });
  } catch (err) {
    // setStep throws only on validation (unknown step/model/effort) -> client error.
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/config -> write run-config: per-node model/effort, per-feedback
// cycle counts, and the active workflow id. Keyed by workflowId + node/feedback
// instance ids (see RunConfig in the design). Legacy per-role `steps` are
// written via POST /api/config and are left untouched here. setNodeModel now
// validates model/effort against the effective catalog exactly like setStep
// (configurable-models-design.md §4.5) -> 400; setFeedbackCycles still COERCES
// maxCycles to >= 1 (it never throws).
// body: { projectDir, workflowId, nodes?:{[id]:{model,effort}}, feedbacks?:{[id]:{maxCycles}}, wires?:{[wireId]:{maxCycles}}, activeWorkflowId?, humanInLoop? }
// ---------------------------------------------------------------------------
app.patch('/api/config', async (req, res) => {
  const body = req.body || {};
  const projectDir = resolveProjectDir(body.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  const workflowId = typeof body.workflowId === 'string' ? body.workflowId.trim() : '';
  // MAJ-1: every arm below keys a normalized table by workflowId, and
  // readWorkflowsMap rebuilds a map from those keys — an id like '__proto__'
  // used to be persisted unchecked and then broke readRunConfig for the whole
  // project. isSafeWorkflowId is the store's own id rule, so the API can never
  // write an id the store would refuse. (The recovery route DELETE
  // /api/config/workflow stays deliberately ungated: an already-poisoned row
  // must still be clearable.)
  const workflowIdError = (what) => {
    if (!workflowId) return `workflowId is required to set ${what} config`;
    if (!isSafeWorkflowId(workflowId)) return 'invalid workflowId';
    return null;
  };
  try {
    if (body.nodes && typeof body.nodes === 'object') {
      const bad = workflowIdError('node');
      if (bad) return badRequest(res, bad);
      for (const [nodeId, sel] of Object.entries(body.nodes)) {
        await setNodeModel(projectDir, workflowId, nodeId, {
          model: sel && sel.model, effort: sel && sel.effort,
          fanOut: sel && sel.fanOut, askQuestions: sel && sel.askQuestions,
          subagentModel: sel && sel.subagentModel,
        });
      }
    }
    if (body.feedbacks && typeof body.feedbacks === 'object') {
      const bad = workflowIdError('feedback');
      if (bad) return badRequest(res, bad);
      for (const [fbId, sel] of Object.entries(body.feedbacks)) {
        await setFeedbackCycles(projectDir, workflowId, fbId, sel && sel.maxCycles);
      }
    }
    if (body.wires && typeof body.wires === 'object') {
      const bad = workflowIdError('wire');
      if (bad) return badRequest(res, bad);
      for (const [wireId, sel] of Object.entries(body.wires)) {
        await setWireCycles(projectDir, workflowId, wireId, sel && sel.maxCycles);
      }
    }
    if (typeof body.activeWorkflowId === 'string' && body.activeWorkflowId.trim()) {
      const active = body.activeWorkflowId.trim();
      if (!isSafeWorkflowId(active)) return badRequest(res, 'invalid workflowId');
      await setActiveWorkflow(projectDir, active);
    }
    if (typeof body.humanInLoop === 'boolean') await setHumanInLoop(projectDir, body.humanInLoop);
    const config = await readRunConfig(projectDir);
    res.json({ config });
  } catch (err) {
    // The config.mjs setters throw only on validation (unknown model/effort,
    // maxCycles < 1) -> client error, mirroring POST /api/config.
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/config/workflow -> "Reset to defaults" for one workflow in one
// project (newpipeline-ux-design.md §4.5). Drops every per-node/per-feedback
// override (and, for wf_default, the legacy per-role steps) so the accordion
// falls back to the workflow's defaults + the agent registry. Idempotent:
// resetting an already-clean project is a no-op 200.
// query: ?projectDir=&workflowId=
// ---------------------------------------------------------------------------
app.delete('/api/config/workflow', async (req, res) => {
  const projectDir = resolveProjectDir(req.query.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  const workflowId = typeof req.query.workflowId === 'string' ? req.query.workflowId.trim() : '';
  if (!workflowId) return badRequest(res, 'workflowId is required');
  try {
    await resetWorkflowConfig(projectDir, workflowId);
    res.json({ config: await readRunConfig(projectDir) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/config/models (the per-project ADD) is deliberately GONE: new
// models are added to the GLOBAL catalog via POST /api/models (design §4.9 —
// the add flow moves entirely to the global Models view). DELETE stays so
// legacy per-project entries can still be cleaned up.
app.delete('/api/config/models', async (req, res) => {
  const projectDir = resolveProjectDir(req.query.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id.trim()) return badRequest(res, 'id is required');
  try {
    const config = await removeCustomModel(projectDir, id);
    res.json({ config, models: await listModels(projectDir) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Global model catalog (configurable-models-design.md §4.10). Project-less by
// design — the catalog lives in ~/.worca-cc/settings.json (settings.mjs) and
// applies to every project. Env VALUES are secrets-adjacent: responses carry
// them MASKED (write-only editing; a whole-value ${VAR} ref is config, not a
// secret, and passes through readable), and a PATCH that echoes a masked value
// back means "keep" and is dropped from the write.
// ---------------------------------------------------------------------------

const maskEnvValue = (v) => (modelEnvRef(v) ? v : maskModelEnvValue(v));
// A bridged entry's `upstream.apiKey` is masked like an env secret; the rest of
// the block is routing config and passes through. `bridged`/`needsSignIn` are
// the picker/card facts (model-bridge-design.md §8.5), one readiness check
// per provider per response.
const bridgeFacts = (m, readiness) => {
  if (!m.upstream) return {};
  const p = m.upstream.provider;
  if (!readiness.has(p)) readiness.set(p, providerReadiness(m.upstream));
  const r = readiness.get(p);
  return { bridged: p, needsSignIn: !r.ok, ...(r.ok ? {} : { signInReason: r.reason, signInMessage: r.message }) };
};
const maskedGlobalModel = (m, readiness = new Map()) => ({
  ...m,
  ...(m.env ? { env: Object.fromEntries(Object.entries(m.env).map(([k, v]) => [k, maskEnvValue(v)])) } : {}),
  ...(m.upstream ? { upstream: { ...m.upstream, ...(m.upstream.apiKey ? { apiKey: maskEnvValue(m.upstream.apiKey) } : {}) } } : {}),
  ...bridgeFacts(m, readiness),
});
const isMaskedEcho = (v) => typeof v === 'string' && v.startsWith('••');
const maskedGlobalModels = () => {
  const flagged = costUnreliableModelIds(); // §4.6 observed flag, merged for the editor's badge
  const readiness = new Map();
  return listGlobalModels().map((m) => ({
    ...maskedGlobalModel(m, readiness),
    ...(flagged.has(m.id.toLowerCase()) ? { costUnreliable: true } : {}),
  }));
};
/** A POST/PATCH `upstream` body with a masked apiKey echo dropped ("keep"). */
const upstreamInput = (u, current) => {
  if (!u || typeof u !== 'object' || Array.isArray(u)) return u;
  if (isMaskedEcho(u.apiKey)) {
    const keep = current && current.upstream ? current.upstream.apiKey : undefined;
    const { apiKey, ...rest } = u;
    return keep ? { ...rest, apiKey: keep } : rest;
  }
  return u;
};

/** Read-only plugin model entries (design §9.7): literals masked with the
 *  standard masker, ${VAR} refs readable, {secret} placeholders surfaced as
 *  display markers with their set-ness. */
const pluginModelsPayload = () => {
  const flagged = costUnreliableModelIds();
  const statusByPlugin = new Map();
  const readiness = new Map();
  return listPluginModels().map((m) => {
    if (!statusByPlugin.has(m.plugin)) statusByPlugin.set(m.plugin, pluginModelSecretStatus(m.plugin));
    const status = statusByPlugin.get(m.plugin);
    return {
      id: m.id, label: m.label, efforts: m.efforts, plugin: m.plugin,
      env: Object.fromEntries(Object.entries(m.env ?? {}).map(([k, v]) => [
        k, typeof v === 'string' ? maskEnvValue(v) : `(secret: ${v.secret})`,
      ])),
      secrets: status.filter((s) => m.secrets.includes(s.key)),
      ...(m.cost ? { cost: m.cost } : {}),   // manifest-pinned pricing — config, never a credential
      ...(m.upstream ? { upstream: { ...m.upstream } } : {}),   // a plugin apiKey is a ${VAR} ref by validation — readable
      ...bridgeFacts(m, readiness),
      ...(flagged.has(m.id.toLowerCase()) ? { costUnreliable: true } : {}),
    };
  });
};

app.get('/api/models', (req, res) => {
  const readiness = new Map();
  res.json({
    models: maskedGlobalModels(), plugin: pluginModelsPayload(), predefined: PREDEFINED_MODELS, efforts: EFFORTS,
    hideBuiltinModels: hideBuiltinModels(),   // the Models-view checkbox (#422)
    // Team policy catalog entries (team-policy design §8): read-only, env masked like a global's.
    policy: policyCatalogModels().map((m) => maskedGlobalModel(m, readiness)),
    providers: UPSTREAM_PROVIDERS,
  });
});

app.post('/api/models', async (req, res) => {
  const b = req.body || {};
  try {
    const model = await addGlobalModel({ id: b.id, label: b.label, efforts: b.efforts, env: b.env, cost: b.cost, upstream: upstreamInput(b.upstream) });
    res.json({ model: maskedGlobalModel(model), models: maskedGlobalModels() });
  } catch (err) {
    // addGlobalModel throws only on validation (empty/dup id, unknown effort,
    // reserved env key, non-string env value, malformed upstream) -> client error.
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// ---------------------------------------------------------------------------
// Providers + the Copilot import (model-bridge-design.md §9). Never a token in
// a response; the sign-in is a device-flow session the client polls.
// ---------------------------------------------------------------------------
const providerError = (res, err) => {
  const msg = err && err.message ? err.message : String(err);
  if (err && (err.code === 'TERMS' || err.code === 'NOT_SIGNED_IN')) return res.status(409).json({ error: msg, code: err.code });
  return badRequest(res, msg);
};

app.get('/api/providers', async (req, res) => {
  try {
    res.json(await providersState({ quota: req.query.quota === '1' }));
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.patch('/api/providers/:name', async (req, res) => {
  try {
    await patchProvider(req.params.name, req.body || {});
    emitChanged('settings-changed');
    res.json(await providersState());
  } catch (err) {
    return providerError(res, err);
  }
});

app.post('/api/providers/copilot/acknowledge', async (req, res) => {
  try {
    await acknowledgeTerms();
    res.json(await providersState());
  } catch (err) {
    return providerError(res, err);
  }
});

app.post('/api/providers/copilot/login', async (req, res) => {
  try {
    res.json(await beginCopilotLogin());
  } catch (err) {
    return providerError(res, err);
  }
});

app.get('/api/providers/copilot/login/:deviceCode', async (req, res) => {
  try {
    const r = await pollCopilotLogin(String(req.params.deviceCode));
    if (r.ok) emitChanged('settings-changed');
    res.json(r);
  } catch (err) {
    return providerError(res, err);
  }
});

app.post('/api/providers/copilot/logout', async (req, res) => {
  try {
    await copilotLogout();
    emitChanged('settings-changed');
    res.json(await providersState());
  } catch (err) {
    return providerError(res, err);
  }
});

app.get('/api/providers/copilot/models', async (req, res) => {
  try {
    res.json({ models: await copilotModelsForImport() });
  } catch (err) {
    return providerError(res, err);
  }
});

// What an OpenAI-compatible endpoint serves (§8.4): llama.cpp, Ollama, LM Studio, vLLM or a
// gateway, asked on its own surface so the rows carry real context windows and tool support.
// ?baseUrl= overrides the provider's own, so a second local server can be browsed without
// saving it first. Same reach as Test connection: the UI is loopback-only.
app.get('/api/providers/openai/models', async (req, res) => {
  try {
    res.json(await endpointModelsForImport({ baseUrl: typeof req.query.baseUrl === 'string' ? req.query.baseUrl : '' }));
  } catch (err) {
    return providerError(res, err);
  }
});

app.post('/api/providers/openai/import-models', async (req, res) => {
  const b = req.body || {};
  try {
    const result = await importEndpointModels(b.ids, { baseUrl: typeof b.baseUrl === 'string' ? b.baseUrl : '' });
    emitChanged('settings-changed');
    res.json({ ...result, models: maskedGlobalModels() });
  } catch (err) {
    return providerError(res, err);
  }
});

app.post('/api/providers/:name/test', async (req, res) => {
  // The card tests what is ON SCREEN (§8.1): an unsaved base URL or key is sent with the request,
  // so "Test connection" answers for the endpoint the user is looking at, not the stored one.
  const b = req.body || {};
  res.json(await testProviderConnection(req.params.name, {
    baseUrl: typeof b.baseUrl === 'string' ? b.baseUrl : '',
    ...(typeof b.apiKey === 'string' ? { apiKey: b.apiKey } : {}),
  }));
});

app.post('/api/providers/copilot/import-models', async (req, res) => {
  const b = req.body || {};
  if (b.provider && b.provider !== 'copilot') return badRequest(res, 'only the copilot provider supports import');
  try {
    const result = await importCopilotModels(b.ids);
    res.json({ ...result, models: maskedGlobalModels() });
  } catch (err) {
    return providerError(res, err);
  }
});

// Promote a legacy per-project custom model to the global catalog (§4.9).
// Refs survive by construction — see promoteCustomModel. Registered before the
// :id routes only for readability; POST /api/models/promote shares no method
// with them, so there is no capture conflict.
app.post('/api/models/promote', async (req, res) => {
  const b = req.body || {};
  const projectDir = resolveProjectDir(b.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  try {
    const config = await promoteCustomModel(projectDir, b.id);
    res.json({ config, models: maskedGlobalModels() });
  } catch (err) {
    // Throws only on validation (unknown project model) -> client error.
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// Export selected global models as a plugin scaffold (design §9.5). Body:
// { name, description?, version?, dest, models: [{ id, env: {KEY: mode} }] }
// with mode 'include' (stored value verbatim — literal or ${VAR} ref text),
// 'secret' (strip the value; declare a modelSecrets placeholder the importer
// fills at install), or 'omit'. Reads RAW env values server-side — same trust
// boundary as GET /api/models/:id/env-value (the user's own settings.json,
// deliberate action). Distribution is git-only: the scaffold folder is what
// gets pushed; no zip.
app.post('/api/models/export-plugin', async (req, res) => {
  const b = req.body || {};
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!MANIFEST_PLUGIN_NAME_RE.test(name) || name.length > 64) {
    return badRequest(res, 'name must be kebab-case (e.g. "discretestack-models")');
  }
  const picks = Array.isArray(b.models) ? b.models : [];
  if (!picks.length) return badRequest(res, 'models must be a non-empty array');
  const destRaw = typeof b.dest === 'string' ? b.dest.trim() : '';
  if (!destRaw) return badRequest(res, 'dest is required');
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const dest = path.resolve(destRaw.startsWith('~') ? path.join(home, destRaw.slice(1)) : destRaw);
  try {
    if (fs.existsSync(dest)) {
      if (!fs.statSync(dest).isDirectory()) return badRequest(res, 'dest exists and is not a directory');
      if (fs.readdirSync(dest).length) return badRequest(res, 'dest folder is not empty');
    }
  } catch (err) {
    return badRequest(res, `dest is not usable: ${err.message}`);
  }

  const globals = listGlobalModels();
  const secretKeyFor = (envKey) => envKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const models = [];
  const modelSecrets = new Map(); // secret key -> { key, label }
  for (const pick of picks) {
    const id = pick && typeof pick.id === 'string' ? pick.id.trim() : '';
    const entry = globals.find((m) => m.id.toLowerCase() === id.toLowerCase());
    if (!entry) return badRequest(res, `unknown global model id ${JSON.stringify(id)}`);
    const modes = pick.env && typeof pick.env === 'object' && !Array.isArray(pick.env) ? pick.env : {};
    const env = {};
    for (const [k, mode] of Object.entries(modes)) {
      if (!entry.env || !(k in entry.env)) return badRequest(res, `model ${JSON.stringify(entry.id)} has no env key ${JSON.stringify(k)}`);
      if (mode === 'omit') continue;
      if (mode === 'include') { env[k] = entry.env[k]; continue; }
      if (mode === 'secret') {
        const skey = secretKeyFor(k);
        if (!skey) return badRequest(res, `cannot derive a secret key from ${JSON.stringify(k)}`);
        if (!modelSecrets.has(skey)) modelSecrets.set(skey, { key: skey, label: k });
        env[k] = { secret: skey };
        continue;
      }
      return badRequest(res, `env mode for ${JSON.stringify(k)} must be include | secret | omit`);
    }
    models.push({
      id: entry.id,
      ...(entry.label !== entry.id ? { label: entry.label } : {}),
      ...(entry.efforts.length && entry.efforts.length !== EFFORTS.length ? { efforts: entry.efforts } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      // Pricing travels with the model. It is configuration, not a credential —
      // and a shared on-prem model is precisely one the CLI would otherwise
      // price by NAME on every machine that installs the plugin.
      ...(entry.cost ? { cost: entry.cost } : {}),
    });
  }

  const manifest = {
    name,
    ...(typeof b.version === 'string' && b.version.trim() ? { version: b.version.trim() } : { version: '0.1.0' }),
    ...(typeof b.description === 'string' && b.description.trim() ? { description: b.description.trim() } : {}),
    models,
    ...(modelSecrets.size ? { modelSecrets: [...modelSecrets.values()] } : {}),
  };
  // Belt: the scaffold must install anywhere this host would — validate before writing.
  const norm = normalizeManifest(manifest);
  if (!norm.ok) return badRequest(res, `generated manifest is invalid: ${norm.errors.join('; ')}`);

  const readme = [
    `# ${name}`,
    '',
    manifest.description || 'Worca CC model plugin.',
    '',
    '## Models',
    '',
    ...models.map((m) => `- \`${m.id}\`${m.label ? ` — ${m.label}` : ''}`),
    ...(modelSecrets.size ? [
      '',
      '## Secrets requested at install',
      '',
      ...[...modelSecrets.values()].map((s) => `- \`${s.key}\` (${s.label})`),
      '',
      'Teammates set these under the plugin\'s **Model secrets** after installing;',
      'values live in their local `data/secrets.json` (0600) and never in this repo.',
    ] : []),
    '',
    '## Publish',
    '',
    '```sh',
    `cd ${dest}`,
    'git init -b main && git add -A && git commit -m "model plugin"',
    'git remote add origin <your-team-repo-url> && git push -u origin main',
    '```',
    '',
    '## Install (teammates)',
    '',
    'Worca CC → Plugins → Add repo → paste the repo URL → Install.',
    'Model secrets are prompted in the plugin\'s configuration panel.',
    '',
  ].join('\n');

  try {
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'worca-cc-plugin.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(dest, 'README.md'), readme, 'utf8');
  } catch (err) {
    return res.status(500).json({ error: `could not write the scaffold: ${err.message}` });
  }
  res.json({
    ok: true, dir: dest, files: ['worca-cc-plugin.json', 'README.md'],
    modelSecrets: [...modelSecrets.values()],
  });
});

app.patch('/api/models/:id', async (req, res) => {
  const b = req.body || {};
  // Write-only env: strip masked echoes (unchanged values a client sent back)
  // so they read as "keep", never as a literal '••…' secret. env: null still
  // means "clear the whole map" and passes through untouched.
  let env = b.env;
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    env = Object.fromEntries(Object.entries(env).filter(([, v]) => !isMaskedEcho(v)));
  }
  try {
    const current = b.upstream ? listGlobalModels().find((m) => m.id.toLowerCase() === String(req.params.id).toLowerCase()) : null;
    const model = await updateGlobalModel(req.params.id, { label: b.label, efforts: b.efforts, env, cost: b.cost, upstream: upstreamInput(b.upstream, current) });
    res.json({ model: maskedGlobalModel(model), models: maskedGlobalModels() });
  } catch (err) {
    // updateGlobalModel throws only on validation (unknown id, unknown effort,
    // reserved env key) -> client error.
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// Preview what deleting a global entry would clear (feeds the confirmation
// dialog; design §4.5). Unknown ids just report empty refs — preview never 400s.
app.get('/api/models/:id/refs', (req, res) => {
  res.json(globalModelRefs(req.params.id));
});

// Reveal raw env value(s) for the editor's copy button and Show-values toggle.
// The default GET surface stays masked (accidental exposure in screenshots/
// devtools); this is a deliberate read of what the user already owns on disk
// in ~/.worca-cc/settings.json — same trust boundary, explicit action.
// ?key=K -> { key, value }; no key -> { env } (the whole raw map).
app.get('/api/models/:id/env-value', (req, res) => {
  const entry = listGlobalModels().find((m) => m.id.toLowerCase() === String(req.params.id).toLowerCase());
  if (!entry) return badRequest(res, `unknown model id ${JSON.stringify(req.params.id)}`);
  const key = typeof req.query.key === 'string' ? req.query.key : '';
  if (!key) return res.json({ env: { ...(entry.env || {}) } });
  if (!entry.env || !(key in entry.env)) return badRequest(res, `model has no env key ${JSON.stringify(key)}`);
  res.json({ key, value: entry.env[key] });
});

app.delete('/api/models/:id', async (req, res) => {
  try {
    const result = await removeGlobalModelAndRefs(req.params.id);
    // Settings › Memory's defragment model went with the entry: open tabs repaint that card (as
    // the Ask remove_model path's settings-changed does).
    if (result.clearedMemoryDefrag) emitChanged('settings-changed');
    res.json({ ...result, models: maskedGlobalModels() });
  } catch (err) {
    // Throws only on an unknown id -> client error.
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// Live connectivity check for a catalog model — the Models-view Test button.
// Explicit user action only (one real, tiny API call against wherever the
// model routes). Caller mistakes get an HTTP status; the test OUTCOME rides a
// 200 envelope, same convention as POST /api/chat/test. Ids resolve global
// first, then plugin — resolveModelEnv's precedence.
const modelTestsInFlight = new Set();
app.post('/api/models/:id/test', async (req, res) => {
  const id = String(req.params.id);
  const lc = id.toLowerCase();
  const global = listGlobalModels().find((m) => m.id.toLowerCase() === lc);
  const plugin = global ? null : listPluginModels().find((m) => m.id.toLowerCase() === lc);
  // A built-in is testable too (#422): the Title-generation card offers it, and
  // a first-party id with no routing env is exactly the spawn a run would make.
  const builtin = !global && !plugin && PREDEFINED_MODELS.some((m) => m.id.toLowerCase() === lc);
  if (!global && !plugin && !builtin) return res.status(404).json({ error: `unknown model id ${JSON.stringify(id)}` });
  if (plugin && plugin.secrets.length) {
    // Don't burn a spawn guaranteed to fail — resolveModelEnv drops unset secrets.
    const unset = pluginModelSecretStatus(plugin.plugin)
      .filter((s) => plugin.secrets.includes(s.key) && !s.set).map((s) => s.key);
    if (unset.length) {
      return badRequest(res, `secret ${unset.join(', ')} is not set — configure it in the plugin's settings`);
    }
  }
  if (modelTestsInFlight.has(lc)) return badRequest(res, 'test already running for this model');
  modelTestsInFlight.add(lc);
  try {
    res.json(await testModel(id));
  } finally {
    modelTestsInFlight.delete(lc);
  }
});

// ---------------------------------------------------------------------------
// Workflow templates (global store at ~/.worca-cc/workflows). Topology only;
// model/effort/cycles live in per-project run-config. CRUD mirrors the
// /api/projects + /api/config delegation pattern: thin handlers, validation and
// atomic persistence owned by src/core/workflows.mjs + workflow-validator.mjs.
// ---------------------------------------------------------------------------
// nodeDefaultsError (one node-defaults block vs the project-less catalog) lives
// in src/core/workflow-share.mjs now, so `worca workflow import` applies the
// same gate as the routes below.

/** Error -> HTTP for the shared save/import/JSON path (workflow-share.mjs codes). */
function sendWorkflowShareError(res, err) {
  const code = err && err.code;
  const message = err && err.message ? err.message : String(err);
  if (code === 'BAD_REQUEST' || code === 'UNSUPPORTED') return badRequest(res, message);
  // The 422 body is the SHARED validator's issue list, by construction: the
  // composer renders exactly what it would have computed locally, so the server
  // and the client can never disagree about why a graph is illegal. `summary`
  // is the one-line V4 fold for surfaces with no issue list (the Import button).
  if (code === 'INVALID_GRAPH') {
    return res.status(422).json({
      error: message, errors: err.errors || [], warnings: err.warnings || [],
      ...(err.summary ? { summary: err.summary } : {}),
    });
  }
  // C-3: a name that slugs onto the reserved wf_default is a caller error, not
  // a server fault — 422, the same code the validator's refusal uses. MAJ-5: a
  // minted id already in use is a 409 carrying that id, so the dialog can offer
  // rename/overwrite. Both bodies carry NO issues/errors array on purpose:
  // app.js's saveWorkflow maps `error` straight into the save dialog's message
  // line, verbatim.
  if (code === 'RESERVED_NAME') return res.status(422).json({ error: message });
  if (code === 'ID_TAKEN') return res.status(409).json({ error: message, id: err.id });
  // P10: a script import the user has not confirmed is well-formed but conflicts
  // with a confirmation not yet given; `scriptNodes` are the commands to show first.
  if (code === 'SCRIPTS_UNCONFIRMED') return res.status(409).json({ error: message, code, scriptNodes: err.scriptNodes || [] });
  if (code === 'NOT_FOUND') return res.status(404).json({ error: message });
  return res.status(500).json({ error: message });
}

app.get('/api/workflows', async (req, res) => {
  try {
    if (isTruthy(req.query.archived)) {
      const all = await listWorkflows({ includeArchived: true });
      return res.json({ workflows: all.filter((w) => w.archivedAt) });
    }
    // CONTRACT: [ GRAPH_DEFAULT_WORKFLOW, GRAPH_MEMORY_DEFRAG_WORKFLOW, ...listWorkflows() ]. The
    // built-ins are never persisted rows (listWorkflows filters their ids), so none appears twice.
    res.json({ workflows: [GRAPH_DEFAULT_WORKFLOW, GRAPH_MEMORY_DEFRAG_WORKFLOW, ...(await listWorkflows())] });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/workflows/:id', async (req, res) => {
  try {
    // ONE gate, ONE message: an archived id explains itself instead of reading
    // as a plain 404 (assertRunnableWorkflow owns both texts). checkGraph:false —
    // this is a READ (the Composer's Open): a template stranded by an agent-port
    // edit must still load, or the user could never repair it. The RUN path keeps
    // the graph check.
    const wf = await assertRunnableWorkflow(req.params.id, { checkGraph: false });
    // Settings › Memory: the built-in reads with the pair every defragment run will use, so New
    // pipeline's agent rows and an Ask card's lane show — and lock — it (memory-defrag-model.mjs).
    if (wf && wf.id === MEMORY_DEFRAG_WORKFLOW_ID) {
      const stored = memoryDefragModel();
      const pair = stored.model ? resolveDefragModel({ stored, models: await listModels('') }) : null;
      return res.json(defragWorkflowView(wf, pair));
    }
    res.json(wf);
  } catch (err) {
    if (err && (err.code === 'NOT_FOUND' || err.code === 'ARCHIVED')) {
      return res.status(404).json({ error: err.message });
    }
    // The row exists but its plugin is disabled: a conflict with the plugin's
    // state, not a missing row — the message names the fix.
    if (err && err.code === 'PLUGIN_DISABLED') return res.status(409).json({ error: err.message });
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/workflows', async (req, res) => {
  // The v1 pipeline format is RETIRED: only graphs are accepted (spec §10.2).
  // The whole v1 arm (its steps-borne node defaults, validateWorkflow and
  // writeWorkflow) died with it — nothing reaches the v1 store through the API.
  // ── v2 graph save ──────────────────────────────────────────────────────────
  // Catalog check + shared validator + rejectCollision persistence live in
  // workflow-share.mjs (saveGraphWorkflow): the SAME path the JSON import
  // route and `worca workflow import` take, so they can never drift. A body
  // WITHOUT an id mints wf_<slug(name)> — a GUESS that must never silently
  // replace a pipeline the user can see (MAJ-5 -> 409).
  try {
    const { workflow, warnings } = await saveGraphWorkflow(req.body || {}, { agentsDir: AGENTS_DIR });
    return res.status(201).json({ workflow, warnings });
  } catch (err) {
    return sendWorkflowShareError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Share a workflow as JSON (issue #421). GET .../json is the unstamped v2 graph
// of the STORED row (no id/origin/timestamps; `canvas` kept), served as a
// download; POST /import-json feeds one back through the shared validator,
// minting an id and suffixing the name (`Name (2)`) on a collision — never
// overwrite. Registered BEFORE the /:id routes so the segment can never be read
// as an id. (Not `/import`: test/shared-graph-purity.test.mjs scans ui/public
// for `import '<spec>'` and a bare `import'` in app.js's fetch URL trips it.)
// ---------------------------------------------------------------------------
app.post('/api/workflows/import-json', async (req, res) => {
  const body = req.body || {};
  const src = body.workflow && typeof body.workflow === 'object' && !Array.isArray(body.workflow) ? body.workflow : null;
  if (!src) return badRequest(res, 'workflow (the exported JSON object) is required');
  try {
    // D18: a dry run validates and lists the script commands the Import dialog must show first.
    const dryRun = body.dryRun === true;
    const r = await importGraphWorkflow(src, {
      name: typeof body.name === 'string' ? body.name : undefined, agentsDir: AGENTS_DIR, dryRun,
      acceptScripts: body.acceptScripts === true,
    });
    if (dryRun) return res.json({ scriptNodes: r.scriptNodes, warnings: r.warnings, requestedName: r.requestedName });
    return res.status(201).json(r);
  } catch (err) {
    return sendWorkflowShareError(res, err);
  }
});

app.get('/api/workflows/:id/json', async (req, res) => {
  try {
    const payload = await exportGraphJson(req.params.id);
    res.setHeader('Content-Disposition', `attachment; filename="${workflowFileSlug(req.params.id)}.json"`);
    res.type('application/json').send(JSON.stringify(payload, null, 2) + '\n');
  } catch (err) {
    sendWorkflowShareError(res, err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/workflows/:id/defaults -> set the template's per-node defaults
// (newpipeline-ux-design.md §4.4). body: { defaults: { [nodeId]: {model?, effort?,
// fanOut?, askQuestions?, subagentModel?} | null } }; null (or an empty block) clears a node, an
// absent node keeps what it has. Model/effort validate against the PROJECT-LESS
// catalog (predefined ⊕ global ⊕ plugin) — defaults are global, so a legacy
// per-project custom model is deliberately not a valid default.
// ---------------------------------------------------------------------------
app.patch('/api/workflows/:id/defaults', async (req, res) => {
  const body = req.body || {};
  const map = body.defaults;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return badRequest(res, 'defaults must be an object keyed by node id');
  }
  try {
    const models = await listModels('');
    for (const [nodeId, raw] of Object.entries(map)) {
      const err = nodeDefaultsError(raw, models, `node "${nodeId}"`);
      if (err) return badRequest(res, err);
    }
    const workflow = await setWorkflowNodeDefaults(req.params.id, map);
    res.json({ workflow, defaults: workflowNodeDefaults(workflow) });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    // "workflow not found" is a 404; the frozen-default refusal and any shape
    // complaint are caller errors — nothing here is a server fault.
    if (/not found/i.test(message)) return res.status(404).json({ error: message });
    return badRequest(res, message);
  }
});

app.delete('/api/workflows/:id', async (req, res) => {
  const id = req.params.id;
  // The built-in default is not in the user store and must never be deleted.
  if (id === 'wf_default') return badRequest(res, 'the default workflow cannot be deleted');
  if (id === MEMORY_DEFRAG_WORKFLOW_ID) return badRequest(res, 'the Memory defragment workflow cannot be deleted');
  try {
    const removed = await deleteWorkflow(id); // CONV-1: await
    if (!removed) return res.status(404).json({ error: 'workflow not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

function workflowExportErrorStatus(code) {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'BAD_REQUEST' || code === 'UNSUPPORTED' || code === 'MISSING_SKILL') return 400;
  if (code === 'INVALID_GRAPH') return 422;
  if (code === 'CONFLICT' || code === 'CANCELLED') return 409;
  return 500;
}

app.post('/api/workflows/:id/export', async (req, res) => {
  const body = req.body || {};
  const destination = body.destination;
  if (destination !== 'global' && destination !== 'project' && destination !== 'plugin') {
    return badRequest(res, "destination must be 'global', 'project' or 'plugin'");
  }
  // ── destination 'plugin' (#421): a plugin folder the recipient links/reimports.
  //    Same Plan/Apply shape as the Claude Code export, so the modal renders both.
  if (destination === 'plugin') {
    const pluginDir = resolveProjectDir(body.pluginDir);
    if (!pluginDir) return badRequest(res, 'pluginDir is required for a plugin export');
    try {
      const result = await exportWorkflowPlugin({
        workflowId: req.params.id, targetDir: pluginDir,
        pluginName: typeof body.pluginName === 'string' ? body.pluginName : undefined,
        keepVersion: !!body.keepVersion, dryRun: !!body.dryRun,
      });
      return res.json(result);
    } catch (err) {
      return res.status(workflowExportErrorStatus(err && err.code)).json({
        error: err && err.message ? err.message : String(err),
        ...(Array.isArray(err?.errors) ? { errors: err.errors } : {}),
      });
    }
  }
  let projectDir;
  if (destination === 'project') {
    projectDir = resolveProjectDir(body.projectDir);
    if (!projectDir) return badRequest(res, 'projectDir is required for a project export');
  }
  // Validate conflict handling the same way the CLI does — the write loop only fails safe if
  // it never sees a bogus value. An unrecognized onConflict/resolution is a caller error, not
  // a silent overwrite.
  if (body.onConflict !== undefined && !ON_CONFLICT_MODES.includes(body.onConflict)) {
    return badRequest(res, `onConflict must be one of: ${ON_CONFLICT_MODES.join(', ')}`);
  }
  if (body.resolutions !== undefined) {
    if (!body.resolutions || typeof body.resolutions !== 'object' || Array.isArray(body.resolutions)) {
      return badRequest(res, 'resolutions must be an object keyed by path');
    }
    for (const [path, choice] of Object.entries(body.resolutions)) {
      if (!RESOLUTION_CHOICES.includes(choice)) {
        return badRequest(res, `invalid resolution ${JSON.stringify(choice)} for ${path} (allowed: ${RESOLUTION_CHOICES.join(', ')})`);
      }
    }
  }
  try {
    const result = await exportWorkflow({
      workflowId: req.params.id, destination, projectDir,
      slug: body.slug, includeAgents: body.includeAgents !== false,
      dryRun: !!body.dryRun, onConflict: body.onConflict, resolutions: body.resolutions,
    });
    res.json(result); // Plan {created,noop,updated,conflicts,warnings,orphans} OR Apply {written,skipped,...}
  } catch (err) {
    res.status(workflowExportErrorStatus(err && err.code)).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Guardrail sets (global store, table guardrail_sets). The built-ins
// Permissive / Normal / Strict are VIRTUAL (GUARDRAIL_PRESETS) — the server
// prepends them, they are never persisted (CONTRACT mirrors /api/workflows:
// GET -> { guardrails: [...listBuiltinGuardrailSets(), ...listGuardrailSets()] }).
// Thin handlers: persistence in guardrail-store.mjs, 400s from validateGuardrails.
// DELETE maps the store's ReferencedError -> 409 { error, references }
// (structural match — the sendPluginError pattern; references are paused runs
// whose resume_point pins the set).
// ---------------------------------------------------------------------------
function sendGuardrailError(res, err) {
  const message = err && err.message ? err.message : String(err);
  if (err && (err.name === 'ReferencedError' || err.code === 'REFERENCED')) {
    return res.status(409).json({ error: message, references: err.references || [] });
  }
  res.status(500).json({ error: message });
}

app.get('/api/guardrails', async (_req, res) => {
  try {
    const sets = await listGuardrailSets(); // CONV-1: await
    // Team policy sets (gp:<id>, origin policy:<home>) sit between the built-ins and the user's own.
    res.json({ guardrails: [...listBuiltinGuardrailSets(), ...listPolicyGuardrailSets(), ...sets] });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/guardrails/:id', async (req, res) => {
  try {
    const set = await readGuardrailSet(req.params.id); // CONV-1: await; built-ins resolve virtually
    if (!set) return res.status(404).json({ error: 'guardrail set not found' });
    res.json(set);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/guardrails', async (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return badRequest(res, 'name is required');
  if (name.length > 200) return badRequest(res, 'name too long (max 200 characters)');
  const v = validateGuardrails(body.settings ?? {});
  if (!v.ok) return res.status(400).json({ error: 'invalid guardrails', errors: v.errors });
  try {
    // POST is CREATE, not upsert: a minted id colliding with an existing set must
    // never silently REPLACE it (the existing set may be the policy other runs
    // select). Renames/edits go through PUT.
    const mintedId = `gr_${slugify(name)}`;
    if (await readGuardrailSet(mintedId)) {
      return res.status(409).json({ error: 'a guardrail set with this name already exists' });
    }
    const set = await writeGuardrailSet({ name, settings: body.settings || {} }); // CONV-1: await
    if (!set) return badRequest(res, 'invalid guardrail set id'); // defensive: minted gr_ ids never hit this
    res.status(201).json({ guardrails: set });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.put('/api/guardrails/:id', async (req, res) => {
  const id = req.params.id;
  if (isBuiltinGuardrailSetId(id)) return badRequest(res, 'built-in guardrail sets cannot be edited');
  const body = req.body || {};
  try {
    const existing = await readGuardrailSet(id);
    if (!existing) return res.status(404).json({ error: 'guardrail set not found' });
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name;
    if (name.length > 200) return badRequest(res, 'name too long (max 200 characters)');
    // `== null` on purpose: validateGuardrails(null) is early-ok (guardrails.mjs:132-134),
    // so a strict `=== undefined` check would let {settings: null} silently wipe a
    // selected set to the empty policy. null/absent both mean "keep stored".
    const settings = body.settings == null ? existing.settings : body.settings;
    const v = validateGuardrails(settings);
    if (!v.ok) return res.status(400).json({ error: 'invalid guardrails', errors: v.errors });
    const set = await writeGuardrailSet({ id, name, settings, createdAt: existing.createdAt }); // CONV-1: await
    if (!set) return badRequest(res, 'invalid guardrail set id');
    res.json({ guardrails: set });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.delete('/api/guardrails/:id', async (req, res) => {
  const id = req.params.id;
  // Built-ins are not in the user store and must never be deleted.
  if (isBuiltinGuardrailSetId(id)) return badRequest(res, 'built-in guardrail sets cannot be deleted');
  if (isPolicyGuardrailSetId(id)) return badRequest(res, 'team policy guardrail sets are edited on the Team policy page, not deleted here');
  try {
    const removed = await deleteGuardrailSet(id); // CONV-1: await; throws ReferencedError while pinned
    if (!removed) return res.status(404).json({ error: 'guardrail set not found' });
    res.json({ ok: true });
  } catch (err) {
    sendGuardrailError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Ask Worca (ask-worca-design.md §8). askJobs is SEPARATE from the runs Map —
// the client's Running badge counts runs entries, and a thread id is the
// subscription key (§8.3). No store/home access at import time (the chatCtx
// rule): the Maps are bare and every store call lives inside a handler or
// bootMaintenance.
// ---------------------------------------------------------------------------
const askJobs = new Map();      // threadId -> {turn, messageId, userMessageId, events, seq, status, startedAt, graceTimer}
// Threads whose DELETE is past its first await (worktree removal spawns git):
// POST /messages refuses them so no turn can start against rows that are
// about to cascade (review of PR #376 — a turn started in that window outlived
// the delete as a live job holding a global slot).
const askDeleting = new Set();
const askFollowers = new Map(); // threadId -> Set<{detach}>
const ASK_JOB_MAX_BUFFER = 5000; // same arithmetic as MAX_BUFFER: deltas dominate; eviction ⇒ client seq-gap re-sync
const askDeferred = new Map();  // threadId → Array<() => Promise>: workflow-card event turns that arrived while a turn was running (PD5/PD26), FIFO

/** A `role:'system'` notice row + its broadcast — the shape attachAskFollower posts. */
function postAskSystemNotice(threadId, text) {
  try {
    const m = askAppendMessage(threadId, { role: 'system', text, blocks: [{ kind: 'notice', text }] });
    broadcast({ type: 'ask-message', threadId, message: m });
  } catch { /* thread deleted */ }
}

/**
 * Start the oldest queued workflow-card event turn (PD26). A starter resolves {ok:false,status,error}
 * — it never throws — when the reservation fails at START time (403: the turn the user waited on spent
 * the last of the total cost window, `_complete` writes the ledger BEFORE `_emit('done')`; 429: the
 * global cap; 409: a typed message won the race). A failed starter posts a system notice and the NEXT
 * one is tried; a started turn's own settleJob drains the rest. The queue is re-read per iteration: a
 * starter pushed while `await next()` ran lives in a fresh array (the queue is re-created after the
 * delete below).
 */
async function drainAskDeferred(threadId) {
  for (;;) {
    const queue = askDeferred.get(threadId);
    if (!queue || !queue.length) return;
    const next = queue.shift();
    if (!queue.length) askDeferred.delete(threadId);
    let r = null;
    try { r = await next(); } catch (e) { r = { ok: false, error: e && e.message ? e.message : String(e) }; }
    if (r && r.ok) return;                                        // its settleJob continues the chain
    postAskSystemNotice(threadId, `Ask Worca could not reply to the workflow card: ${(r && r.error) || 'unknown error'}`);
  }
}

function askInFlight(threadId) {
  const job = askJobs.get(threadId);
  return job && job.status === 'running' ? job : null;
}

/** How many live runs this thread still follows: undetached followers (askFollowers is the truth, the way
 *  askInFlight reads askJobs — ask_run_links.status is written BY the follower and stays `running` across a
 *  restart that dropped every follower) whose runs-Map entry exists and has not settled. */
function askTrackingCount(threadId) {
  const set = askFollowers.get(threadId);
  if (!set) return 0;
  let n = 0;
  for (const f of set) {
    if (f.detached) continue;
    const entry = liveRunEntry(f.runId);
    if (entry && !SETTLED_RUN.has(String(entry.status || ''))) n += 1;
  }
  return n;
}

function askRunningCount() {
  let n = 0;
  for (const job of askJobs.values()) if (job.status === 'running') n += 1;
  return n;
}

/** hello payload: running turns only (§8.2). A job whose slot was just
 *  reserved (messageId still null — the message route's atomic reservation,
 *  Task 6) is skipped: it becomes visible once its assistant row exists. */
function askHello(ws = null) {
  const out = [];
  for (const [threadId, job] of askJobs.entries()) {
    if (job.status === 'running' && job.messageId && (!ws || askSocketSees(ws, threadId))) out.push({ threadId, messageId: job.messageId });
  }
  return out;
}

/** Whether this socket may receive thread `threadId`'s frames (its owner, or not a shared viewer). */
function askSocketSees(ws, threadId) {
  if (!ws || !ws.worcaViewer) return true;
  let owner = null;
  try { owner = askGetThread(threadId)?.createdBy || null; } catch { return true; }
  return !owner || owner === ws.worcaViewer;
}

/** Replay a job's stamped ring buffer to one socket. No state snapshot — the
 *  REST thread GET is the snapshot; the client dedupes by seq (§6.6). */
function replayAskJob(ws, job) {
  for (const ev of job.events) send(ws, ev);
}

/** The stamping closure (§17: reducer frames are BARE; the server stamps).
 *  Shared by the turn's own ask-start/ask-done/ask-error and every reducer
 *  frame, so ALL job frames are buffered, replayed and seq-ordered alike. */
function stampAskFrames(threadId, job) {
  return (bare) => {
    const frame = { ...bare, threadId, messageId: job.messageId, seq: ++job.seq };
    job.events.push(frame);
    if (job.events.length > ASK_JOB_MAX_BUFFER) job.events.splice(0, job.events.length - ASK_JOB_MAX_BUFFER);
    broadcast(frame);
  };
}

/** The narrow worktree envelope the snapshot GET and the `ask-worktrees` frame
 *  share (P4 §10): never the full row — threadId/projectDir/updatedAt stay
 *  server-side. Mirrors the list_worktrees MCP tool (src/core/ask/tools.mjs). */
function askWorktreesEnvelope(threadId) {
  return askListWorktrees(threadId).map((w) => ({
    worktreeId: w.worktreeId, projectKey: w.projectKey, ref: w.ref,
    commit: w.commit, path: w.path, createdAt: w.createdAt,
  }));
}

/** Broadcast the thread's CURRENT worktrees as an out-of-turn frame (seq-less,
 *  threadId-tagged, like ask-title). Fed by the turn's onWorktreeMutation hook —
 *  the MCP child opened/removed/navigated a checkout this process never saw —
 *  and by the manual DELETE route, so every tab's count and popover follow
 *  without a snapshot GET. Best effort; false when the thread is gone. */
function emitAskWorktrees(threadId) {
  try {
    if (!askGetThread(threadId)) return false;
    broadcast({ type: 'ask-worktrees', threadId, worktrees: askWorktreesEnvelope(threadId) });
    return true;
  } catch { return false; }   // a poke is best effort
}

/** 400 on shape (spec §8.1 — a DELIBERATE divergence from the house 404-on-
 *  malformed-param style), null-return contract like badRequest. */
function askIdParam(res, value, kind) {
  if (typeof value !== 'string' || !ASK_ID_RE.test(value)) {
    res.status(400).json({ error: `invalid ${kind} id` });
    return null;
  }
  return value;
}

app.get('/api/ask/threads', (req, res) => {
  try {
    const raw = Number.parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 200) : 50;
    const visibleTo = askViewer(req);
    const threads = askListThreads({ limit, visibleTo }).map((t) => {
      const trackingRuns = askTrackingCount(t.id);
      return { ...t, inFlight: !!askInFlight(t.id), tracking: trackingRuns > 0, trackingRuns };
    });
    // total = EVERY saved chat (the History popover's meter), not the capped page above.
    res.json({ threads, total: askCountThreads({ visibleTo }) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Settings → "Delete all chat history": the counts the confirm dialog quotes,
// read fresh right before it opens.
app.get('/api/ask/history', (req, res) => {
  try {
    res.json({
      threads: askCountThreads({ visibleTo: askViewer(req) }),
      worktrees: askCountWorktrees(),
      attachments: askCountAttachments(),
      inFlight: askRunningCount(),
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Bulk delete: every thread through deleteAskThreadFully, SEQUENTIALLY (each
// worktree removal spawns git — never in parallel), best-effort per thread. The
// ids come from listThreadIds (no cap), never from the LIMIT-ed listThreads.
// One JSON at the end; then a seq-less out-of-turn frame so every open tab
// drops its now-dead st.threadId (the panel would otherwise keep it until the
// next 404).
app.delete('/api/ask/threads', async (req, res) => {
  const removed = { threads: 0, worktrees: 0 };
  const failed = [];
  try {
    // A shared deployment's "delete all" deletes only the caller's own threads.
    const viewer = askViewer(req);
    const deleted = [];
    for (const id of askListThreadIds(viewer ? { ownedBy: viewer } : {})) {
      try {
        const r = await deleteAskThreadFully(id);
        if (r.deleted) {
          deleted.push(id);
          removed.threads += 1;
          removed.worktrees += r.worktrees;
        } else failed.push(id);
      } catch {
        failed.push(id);
      }
    }
    res.json({ ok: true, removed, failed });
    // Shared: name the deleted threads, so other people's tabs keep theirs open.
    broadcast({ type: 'ask-history-cleared', ...(viewer ? { threadIds: deleted } : {}) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/ask/threads', (req, res) => {
  try {
    const body = req.body || {};
    let title = null;
    if (body.title !== undefined && body.title !== null && body.title !== '') {
      if (typeof body.title !== 'string' || body.title.length > 120) {
        return badRequest(res, 'title must be a string of at most 120 characters');
      }
      title = body.title.trim() || null;
    }
    const thread = askCreateThread({ createdBy: actorOf(req) });
    if (title) askUpdateThread(thread.id, { title });
    res.status(201).json({ thread: askGetThread(thread.id) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/ask/threads/:id', (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  try {
    const thread = askGetThread(id);
    if (!thread) return res.status(404).json({ error: 'thread not found' });
    const job = askInFlight(id);
    res.json({
      thread,
      messages: askListMessages(id),
      attachments: askListAttachments(id),
      runLinks: askListRunLinks(id),
      // P4 §10: the SAME narrow envelope the list_worktrees MCP tool and the
      // ask-worktrees frame carry — never the full row.
      worktrees: askWorktreesEnvelope(id),
      inFlight: job && job.messageId ? { messageId: job.messageId } : null, // null while the slot is only reserved
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Ask Worca progress card hydration (plan D9): the run's detail state by pipeline id OR live run id, no store key.
const ASK_RUN_REF_RE = /^(?:[0-9a-f]{8}|[0-9a-zA-Z-]{9,64})$/;
app.get('/api/ask/runs/:id', (req, res) => {
  const id = String(req.params.id || '');
  if (!ASK_RUN_REF_RE.test(id)) return res.status(400).json({ error: 'invalid run id' });
  try {
    const entry = liveRunEntry(id);
    const state = readPipelineStateById(entry && entry.pipelineId ? entry.pipelineId : id);
    if (!state) return res.status(404).json({ error: 'run not found' });
    res.json({ state, live: entry ? { runId: entry.id, status: entry.status } : null });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.patch('/api/ask/threads/:id', (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  try {
    const body = req.body || {};
    const patch = {};
    // Title keeps its original contract exactly: a PATCH that names neither field
    // still earns the title error, so pre-#397 callers see identical behaviour.
    if (body.title !== undefined || body.scope === undefined) {
      const raw = body.title;
      if (typeof raw !== 'string' || !raw.trim() || raw.length > 120) {
        return badRequest(res, 'title must be a non-empty string of at most 120 characters');
      }
      patch.title = raw.trim();
    }
    if (body.scope !== undefined) {
      // #397: the Ask panel's scope selector. Merged per field into the stored
      // context — the pin replaces only the target keys, so the last page
      // context (view, run, diff file) survives a selector change.
      const sv = askValidateScope(body.scope);
      if (!sv.ok) return badRequest(res, sv.error);
      const cur = askGetThread(id);
      if (!cur) return res.status(404).json({ error: 'thread not found' });
      const base = cur.context && typeof cur.context === 'object' && !Array.isArray(cur.context) ? { ...cur.context } : {};
      delete base.projectDir;
      delete base.projectKey;
      delete base.workspaceId;
      patch.context = { ...base, ...sv.scope };
    }
    const thread = askUpdateThread(id, patch);
    if (!thread) return res.status(404).json({ error: 'thread not found' });
    res.json({ thread });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// §7.5 order: abort the in-flight turn -> detach followers -> remove the chat's
// worktrees git-properly -> delete the row (tx + cascades) + rm -rf inside
// deleteThread -> drop the job entry. Shared by the per-thread DELETE and the
// bulk DELETE; askDeleting brackets the whole thing per id (POST /messages
// refuses the thread while its delete is past the first await).
// Returns { deleted, worktrees } — worktrees = rows removeThreadWorktrees removed.
async function deleteAskThreadFully(id) {
  askDeleting.add(id);
  // Outside the `if (job)` block below: a thread deleted while it had a queued
  // event turn but no live job entry would otherwise keep its queue forever.
  askDeferred.delete(id);
  try {
    const stopJob = () => {
      const job = askJobs.get(id);
      if (job && job.turn && typeof job.turn.stop === 'function') {
        try { job.turn.stop(); } catch { /* best-effort */ }
      }
      return job;
    };
    stopJob();
    const followers = askFollowers.get(id);
    if (followers) {
      for (const f of [...followers]) {
        try { f.detach(); } catch { /* best-effort */ }
      }
      askFollowers.delete(id);
    }
    // P4 §5: git-proper removal of every worktree BEFORE the row cascade — the
    // rmSync inside askDeleteThread alone would leave stale `git worktree`
    // registrations in the source repos. Never throws (best-effort per row).
    const { removed } = await askRemoveThreadWorktrees(id);
    // Re-read the job AFTER the await: askDeleting blocks new turns, but a turn
    // that was already mid-start is stopped here rather than left running.
    const job = stopJob();
    const deleted = askDeleteThread(id);
    if (job) {
      if (job.graceTimer) clearTimeout(job.graceTimer);
      askJobs.delete(id);
    }
    return { deleted, worktrees: removed };
  } finally {
    askDeleting.delete(id);
  }
}

app.delete('/api/ask/threads/:id', async (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  try {
    if (!askGetThread(id)) return res.status(404).json({ error: 'thread not found' });
    await deleteAskThreadFully(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// P4 §10: manual worktree delete from the panel. Allowed while a turn is in
// flight — the model's next operation on it gets a clean tool error.
app.delete('/api/ask/threads/:id/worktrees/:wtId', async (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  const wtId = askIdParam(res, req.params.wtId, 'worktree');
  if (!wtId) return;
  try {
    if (!askGetThread(id)) return res.status(404).json({ error: 'thread not found' });
    const out = await askRemoveWorktree({ threadId: id, wtId });
    emitAskWorktrees(id);   // every open tab's count/popover follows the delete
    res.json(out);
  } catch (err) {
    if (err && err.name === 'AskWorktreeError') return res.status(404).json({ error: err.message });
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/ask/threads/:id/attachments/:attId', (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  const attId = askIdParam(res, req.params.attId, 'attachment');
  if (!attId) return;
  try {
    if (!askGetThread(id)) return res.status(404).json({ error: 'thread not found' });
    const att = askGetAttachment(id, attId);
    const file = att ? askAttachmentPath(id, attId) : null;
    if (!file) return res.status(404).json({ error: 'attachment not found' });
    // Text bodies serve as utf-8 text/plain (pre-#398, byte-for-byte: the body
    // was UTF-8-validated at upload and stored verbatim). Only sniff-verified
    // allowlisted mimes are ever stored (never scriptable markup like SVG/HTML),
    // so serving the real mime inline is safe — and it is what lets the
    // transcript render <img> thumbnails (#398).
    const type = att.kind === 'text' ? 'text/plain; charset=utf-8' : (att.mime || 'application/octet-stream');
    // Streamed, not readFileSync + send: a body is immutable under its
    // store-minted id, so a stat-based ETag/Last-Modified plus a year-long
    // private immutable cache replaces a 5 MB sync read and sha1 per request —
    // the transcript re-creates every <img> on each structural render.
    res.sendFile(path.basename(file), {
      root: path.dirname(file),
      dotfiles: 'deny',
      cacheControl: false,
      headers: {
        'Content-Type': type,
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    }, (err) => {
      if (!err || res.headersSent) return;
      if (err.code === 'ENOENT' || err.status === 404) return res.status(404).json({ error: 'attachment not found' });
      res.status(500).json({ error: err.message || String(err) });
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// D8/§8.1: the chat model catalog. Fresh per request (the /api/config
// precedent) — a cache would go stale against global-model edits.
app.get('/api/ask/models', async (_req, res) => {
  try {
    res.json(await askCatalog());
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

/** lookupPipelineRow/findPipelineRowById return the RAW `SELECT * FROM pipelines`
 *  row: snake_case columns, and `branch` is a JSON DOCUMENT
 *  ({source, feature, worktreeDir, …}), not a branch name. Reading
 *  row.startedAt/row.branch directly loses the date and pastes a JSON blob into
 *  the [worca context] line (dry-run-verified). */
function askRunFromPipelineRow(row) {
  let branchObj = null;
  if (typeof row.branch === 'string') {
    try { branchObj = JSON.parse(row.branch); } catch { branchObj = null; }
  } else if (row.branch && typeof row.branch === 'object') {
    branchObj = row.branch;
  }
  const branch = branchObj && typeof branchObj.feature === 'string'
    ? branchObj.feature
    : (typeof branchObj === 'string' ? branchObj : null);
  return {
    id: row.id,
    title: row.title || '',
    status: row.status || '',
    startedAt: row.started_at || row.updated_at || '',
    branch,
  };
}

/** #397: the user-pinned scope of an ask context — {projectKey} | {workspaceId} | null. */
function askPinnedScope(context) {
  if (!context || typeof context !== 'object' || context.pinned !== true) return null;
  if (typeof context.projectKey === 'string' && context.projectKey) return { projectKey: context.projectKey };
  if (typeof context.workspaceId === 'string' && context.workspaceId) return { workspaceId: context.workspaceId };
  return null;
}

/** #397 per-field merge: the pinned scope replaces the page context's TARGET keys
 *  (projectDir/projectKey/workspaceId); view, run, pipeline and diff-file context
 *  still follow the page. */
function askApplyPin(ctx, pin) {
  const out = { ...ctx, pinned: true };
  delete out.projectDir;
  delete out.projectKey;
  delete out.workspaceId;
  return { ...out, ...pin };
}

/** #397 selector PATCH body: {pinned:false} | {pinned:true, projectKey|workspaceId}. */
function askValidateScope(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'scope must be an object' };
  if (typeof raw.pinned !== 'boolean') return { ok: false, error: 'scope.pinned must be true or false' };
  if (!raw.pinned) return { ok: true, scope: { pinned: false } };
  const cv = validateClientContext({ projectKey: raw.projectKey, workspaceId: raw.workspaceId });
  if (!cv.ok) return { ok: false, error: cv.error.replace('context.', 'scope.') };
  const keys = ['projectKey', 'workspaceId'].filter((k) => cv.context[k]);
  if (keys.length !== 1) return { ok: false, error: 'scope needs exactly one of projectKey / workspaceId' };
  return { ok: true, scope: { pinned: true, [keys[0]]: cv.context[keys[0]] } };
}

/** The system prompt of ONE Ask turn: the rules, the catalog, and — only when the chat's
 *  "Create and run scripts" pref is on (W20) — the scripts section with the runtimes this host
 *  actually has (the python probe, cached 60 s). Memory is mounted, not rendered. */
async function askSystemPromptFor(catalog) {
  return askBuildSystemPrompt(catalog, { scripts: await askScriptPromptInput(), deployment: DEPLOYMENT });
}

/** "scheduled Sat Sep 19, 02:00 (run 1a2b…)" / "repeats: Every weekday at 02:00 (sch_…)" / "proposes: …" — or ''. */
function askCardScheduleLine(b, tz = null) {
  if (b.state === 'scheduled' && b.scheduleId) return `repeats: ${b.sentence || ''} (${b.scheduleId})`;
  if (b.state === 'scheduled' && b.after) return `after ‘${b.after.title || b.after.id}’ (run ${b.runId})`;
  if (b.state === 'scheduled' && b.runId) {
    const ms = Date.parse(b.scheduledFor || '');
    const when = Number.isFinite(ms) ? formatInstant(ms, isValidTimeZone(tz) ? tz : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') : '?';
    return `scheduled for ${when} (run ${b.runId})`;
  }
  const s = b.card && b.card.schedule;
  if (b.state === 'proposed' && s) return s.kind === 'repeat' ? `proposes: ${s.sentence}` : s.kind === 'after' ? `proposes: ${s.text}` : `proposes: once at ${s.when}`;
  return '';
}

/** Resolve the VALIDATED client context into the server-side shape
 *  buildContextHeader consumes (§6.5: server-resolved rows only — never
 *  client-supplied titles or paths). Every lookup is individually guarded:
 *  a vanished row degrades to an absent header line, never a 500. */
async function resolveAskContext(threadId, ctx = {}, listedAttachments = [], currentMessageId = null, { signedIn = null } = {}) {
  const out = { now: new Date().toISOString() };
  // Where worca runs (absent on a local install) and who the sign-in proxy verified for this request.
  try {
    const facts = deploymentFacts(process.env, { remoteMode: REMOTE_MODE, projectsRoot: getProjectsRoot() });
    if (facts) out.deployment = facts;
  } catch { /* absent line */ }
  if (typeof signedIn === 'string' && signedIn) out.signedIn = signedIn;
  if (ctx.pinned === true) out.pinned = true;   // #397: rendered as the [pinned by the user] marker
  if (ctx.timeZone) out.timeZone = ctx.timeZone;   // validated IANA name; the header adds the user's clock
  if (ctx.view) out.view = ctx.view;
  if (ctx.diffPath) out.diffPath = ctx.diffPath;   // client-supplied, already length-checked by validateClientContext
  try {
    if (ctx.projectKey || ctx.projectDir) {
      const projects = await listProjects();
      const p = projects.find((x) =>
        (ctx.projectKey && x.key === ctx.projectKey) || (ctx.projectDir && x.path === ctx.projectDir));
      if (p) out.project = { name: p.name, key: p.key };
    }
  } catch { /* absent line */ }
  try {
    if (ctx.workspaceId) {
      const ws = await readWorkspace(ctx.workspaceId);
      if (ws) {
        // readWorkspace returns {id, name, projectPaths, projectKeys, …} — there
        // is NO per-member name object (the {projectName} shape is a local
        // /api/run construction, ui/server.mjs:894). Member display names are
        // the path basenames, same as that precedent.
        out.workspace = {
          name: ws.name, id: ws.id,
          members: (ws.projectPaths || []).map((p) => path.basename(p)).filter(Boolean),
        };
      }
    }
  } catch { /* absent line */ }
  // The Team metrics page's selection (validated slugs); only the scope NAME is resolved here.
  try {
    if (ctx.tmScope) {
      const [kind, tmId] = ctx.tmScope.split(':');
      let name = null;
      if (kind === 'project') name = (await listProjects()).find((x) => x.key === tmId)?.name ?? null;
      else if (kind === 'workspace') name = (await readWorkspace(tmId))?.name ?? null;
      if (name != null) {
        out.teamMetrics = { kind, id: tmId, name, range: ctx.tmRange || 'this-month', groupBy: ctx.tmGroupBy || null, filter: ctx.tmFilter || null };
      }
    }
  } catch { /* absent line */ }
  // The Team policy page's scope (validated slug): its name and, from the local cache only (no git), its home.
  try {
    if (ctx.tpScope) {
      const [kind, tpId] = ctx.tpScope.split(':');
      if (kind === 'project') {
        const p = (await listProjects()).find((x) => x.key === tpId);
        if (p) {
          const r = await resolveProjectPolicy(p.path, { discover: false }).catch(() => null);
          out.teamPolicy = { kind, id: tpId, name: p.name, home: r && r.ok ? r.home : null };
        }
      } else if (kind === 'workspace') {
        const ws = await readWorkspace(tpId);
        if (ws) {
          const r = await resolveWorkspacePolicy(ws, { discover: false }).catch(() => null);
          out.teamPolicy = { kind, id: tpId, name: ws.name, home: r && r.ok ? r.home : null };
        }
      }
    }
  } catch { /* absent line */ }
  try {
    if (ctx.pipelineId) {
      const key = ctx.workspaceId ? `workspaces/${ctx.workspaceId}` : out.project?.key;
      const row = (key ? lookupPipelineRow(key, ctx.pipelineId) : null) || findPipelineRowById(ctx.pipelineId);
      if (row) out.run = askRunFromPipelineRow(row);
    } else if (ctx.runId && runs.has(ctx.runId)) {
      const entry = runs.get(ctx.runId);
      out.run = {
        id: entry.pipelineId || ctx.runId.slice(0, 8), title: entry.title || '',
        status: entry.status || '', startedAt: entry.startedAt || '', branch: null,
      };
    }
  } catch { /* absent line */ }
  // (the ctx.runId branch reads the LIVE runs-Map entry, which really is
  // camelCase — only the DB pipeline row needs askRunFromPipelineRow)
  try {
    const links = askListRunLinks(threadId).slice(0, ASK_LIMITS.headerRuns).map((l) => {
      const live = runs.get(l.runId);
      return {
        id: l.pipelineId || l.runId.slice(0, 8),
        title: (live && live.title) || '', status: l.status || (live && live.status) || '',
        phase: l.phase || '',
      };
    });
    if (links.length) out.linkedRuns = links;
    const cards = [];
    for (const m of askListMessages(threadId)) {
      if (!Array.isArray(m.blocks)) continue;
      for (const b of m.blocks) {
        if (!(b && b.kind === 'card')) continue;
        // P3 (PD25): a workflow card names the workflow it proposes and only owns a
        // workflowId once the user saved it; a run card keeps its pre-P3 line byte for byte.
        const wf = !!(b.card && b.card.type === 'workflow');
        if (wf && b.state === 'building') continue;   // transient (no name yet) — never worth a header line
        if (b.card && (b.card.type === 'metrics' || b.card.type === 'policy' || b.card.type === 'clone')) {
          cards.push({ id: b.id, type: b.card.type, state: b.state, summary: b.card.summary || '' });
          continue;
        }
        if (b.card && b.card.type === 'schedule') {
          cards.push({ id: b.id, type: 'schedule', state: b.state, summary: b.card.summary || '' });
          continue;
        }
        cards.push(wf
          ? {
            id: b.id, type: 'workflow', state: b.state, name: (b.card && b.card.name) || '',
            workflowId: b.workflowId || null, targetName: (b.card && b.card.projectName) || '',
          }
          : {
            id: b.id, state: b.state, workflowId: b.card && b.card.workflowId,
            targetName: (b.card && (b.card.projectName || b.card.workspaceName)) || '',
            // A scheduled (or schedule-proposing) run card says when, so the model never re-proposes it.
            ...(askCardScheduleLine(b, ctx.timeZone) ? { schedule: askCardScheduleLine(b, ctx.timeZone) } : {}),
            ...(b.card && b.card.source ? { task: `${b.card.source.plugin}/${b.card.source.sourceId} ${b.card.source.taskId}` } : {}),
          });
      }
    }
    if (cards.length) out.cards = cards.slice(-ASK_LIMITS.headerCards);
    // §6.5: the CURRENT message's non-inlined files, then EARLIER attachments
    // newest first — inlined current files must not be double-listed, so the
    // earlier set excludes the whole current message, not just `listed` ids.
    const earlier = askListAttachments(threadId)
      .filter((a) => !currentMessageId || a.messageId !== currentMessageId)
      .slice(-ASK_LIMITS.headerAttachments)
      .reverse()
      .map((a) => ({ id: a.id, name: a.name, bytes: a.bytes, kind: a.kind, mime: a.mime }));
    const atts = [...listedAttachments.map((a) => ({ id: a.id, name: a.name, bytes: a.bytes, kind: a.kind, mime: a.mime })), ...earlier];
    if (atts.length) out.attachments = atts.slice(0, ASK_LIMITS.headerAttachments);
  } catch { /* absent lines */ }
  return out;
}

/** R-F: whenever mock mode is on, EVERY ask spawn carries markers. The card is
 *  the mock propose_run INPUT, derived from page context so a seeded project/
 *  workspace validates and an empty context exercises the rejection notice. */
function mockAskCard(ctx = {}, text = '') {
  const target = ctx.workspaceId
    ? { workspaceId: ctx.workspaceId }
    : { projectKey: ctx.projectKey || 'mock-project-00000000' };
  return { ...target, workflowId: 'wf_default', guardrailsId: 'normal', brief: text.slice(0, 200) || 'Mock run',
    note: 'Mock proposal — a fixed shape so the offline card can be exercised.' };
}

/**
 * The ONE turn starter (spec §8.4): the typed-message route and the workflow-card event path both land here.
 * SYNCHRONOUS until the first write — the §6.2.2 guards + the slot reservation run before any await, so two callers
 * cannot interleave (the route's earlier checks are only the fast-path 4xx). Resolves {ok:false,status,error} for the
 * 403/409/429 cases the message route maps to HTTP; {ok:true,…} once the turn is running.
 * @param {{threadId:string, thread:object, ctx:object, model:string, effort:string, text:string,
 *          files?:Array, synthetic?:{notice:string}|null}} o
 *   text      what the MODEL gets as the user message: the typed text, or the `[worca event] …` line (synthetic)
 *   synthetic the user row renders as a notice (never a bubble) and never titles the thread (PD6)
 */
/** The identity Ask Worca's header shows: resolved like every other attribution, absent for 'local'. */
function askSignedIn(req) {
  const who = resolveIdentity(req);
  return who.source === 'local' ? null : who.name;
}

async function startAskTurn({ threadId: id, thread, ctx, model, effort, text, files = [], synthetic = null, signedIn = null, reader = null }) {
  // §6.2.2 ATOMIC re-check + slot reservation. Today every await between the
  // top 409/429 pair and here resolves in microtasks (validateModelEffort ->
  // composeCatalog; askBuildCatalog -> three synchronous better-sqlite3
  // reads), so the route is macrotask-atomic and two POSTs cannot interleave
  // (empirically instrumented). The reservation is what keeps that true if
  // any of those readers ever becomes genuinely async: it is synchronous —
  // check-and-set cannot interleave — and runs BEFORE the first write, so a
  // loser leaves no rows.
  if (askDeleting.has(id)) return { ok: false, status: 409, error: 'thread is being deleted' };
  if (askInFlight(id)) return { ok: false, status: 409, error: 'turn in flight' };
  const budget = budgetStatus();                                                    // P3: the event path needs the same gate the route head applies
  if (budget.blocked) return { ok: false, status: 403, error: 'total cost limit reached', budget };
  if (askRunningCount() >= ASK_LIMITS.turnsGlobal) {
    return { ok: false, status: 429, error: `at most ${ASK_LIMITS.turnsGlobal} turns may run at once` };
  }
  const prev = askJobs.get(id);
  if (prev && prev.graceTimer) clearTimeout(prev.graceTimer); // atomic replace of a grace entry (§8.3)
  const job = {
    turn: null, messageId: null, userMessageId: null, // ids filled once the rows exist;
    events: [], seq: 0, status: 'running',            // askHello()/GET inFlight skip a null messageId
    startedAt: new Date().toISOString(), graceTimer: null,
  };
  askJobs.set(id, job);

  let asstMsg = null;
  let turn;
  let echoAttachments = [];
  try {
    // Writes. Store the LAST context + model/effort on the thread (§6.5 tail, D8).
    // `ctx` (pin-merged) rather than cv.context: the stored row is what restores
    // the selector on reopen and what the MCP child reads for tool defaulting.
    askUpdateThread(id, { context: ctx, model, effort });
    // §7.4 — NOTHING is stamped on the row before the 202: the thread stays
    // untitled (the header reads "Ask Worca") until the D13 background title
    // announces itself. titleWasAuto gates that call: a title given at THREAD
    // CREATION is the user's, and the haiku call must never fire for it
    // (§17 Q&A 1). deterministicTitle is only the turn's fallback for an
    // empty haiku result (turn.mjs _kickoffTitle), never written here.
    const titleWasAuto = thread.title == null;
    const deterministicTitle = titleWasAuto && !synthetic ? (askSanitizeTitle(text.slice(0, 80)) || 'New chat') : thread.title;
    // P3: a synthetic row keeps the EVENT as its text (buildRestoredPrompt replays it truthfully) and carries the
    // human notice as a block the panel renders instead of a bubble.
    const userMsg = askAppendMessage(id, synthetic
      ? { role: 'user', text, blocks: [{ kind: 'notice', synthetic: true, text: synthetic.notice }] }
      : { role: 'user', text });
    job.userMessageId = userMsg.id;
    const attRows = files.map((f) => askAddAttachment(id, userMsg.id, { name: f.name, kind: f.kind, mime: f.mime, text: f.text, data: f.data }));
    // The decoded binary bodies are on disk now. `files` is captured by this
    // scope's closures (settleJob, the turn listeners, onOutOfTurn) for the whole
    // turn plus jobGraceMs, so up to 25 MB of dead Buffers would otherwise stay
    // reachable per running thread.
    for (const f of files) f.data = null;
    echoAttachments = attRows.map((a) => ({ id: a.id, name: a.name, bytes: a.bytes, kind: a.kind, mime: a.mime }));
    if (attRows.length) {
      // `kind` is the BLOCK kind, so the attachment's own kind rides as attKind
      // (the UI keys image thumbnails off it, #398).
      // P3: keep the synthetic notice in front of the attachment blocks (unreachable today — event turns pass no files — but
      // an unconditional overwrite would silently drop the notice for a future caller).
      askSetMessageBlocks(userMsg.id, [
        ...(synthetic ? [{ kind: 'notice', synthetic: true, text: synthetic.notice }] : []),
        ...attRows.map((a) => ({ kind: 'attachment', id: a.id, name: a.name, bytes: a.bytes, attKind: a.kind, mime: a.mime })),
      ]);
    }
    broadcast({ type: 'ask-message', threadId: id, message: askGetMessage(userMsg.id) }); // echo for other tabs
    asstMsg = askAppendMessage(id, { role: 'assistant', text: '', status: 'streaming', model, effort });
    job.messageId = asstMsg.id;

    // Prompt assembly (§6.5) — the route owns it; the turn only spawns. The header context
    // resolves the project FIRST so the turn can mount its memory (native rules).
    const catalog = await askBuildCatalog();
    const withText = attRows.map((a, i) => ({ id: a.id, name: a.name, bytes: a.bytes, kind: a.kind, mime: a.mime, text: files[i].text }));
    const { inline, listed } = askSelectInlineAttachments(withText);
    const headerCtx = await resolveAskContext(id, ctx, listed, userMsg.id, { signedIn });
    const systemPrompt = await askSystemPromptFor(catalog);
    const header = askBuildContextHeader(headerCtx);
    const prompt = askBuildTurnPrompt(header, text, inline);
    const prior = askListMessages(id).filter((m) => m.seq < userMsg.seq);
    const restoredPrompt = askBuildRestoredPrompt(prior, prompt);
    const attachmentNames = {};
    for (const a of askListAttachments(id)) attachmentNames[a.id] = a.name;

    turn = createAskTurn({
      threadId: id, assistantMessageId: asstMsg.id, userMessageId: userMsg.id,
      // A shared sign-in's name: the MCP child reads/marks notifications per person (step 3).
      reader: reader || (thread.createdBy && askSharedOwner(thread) ? thread.createdBy : null),
      prompt, systemPrompt, restoredPrompt,
      model, effort,
      resumeSessionId: thread.sessionId || null,
      firstTurn: !synthetic && userMsg.seq === 1 && titleWasAuto, // P3: an event never titles the thread (D13 guard kept)
      firstText: text,
      deterministicTitle,
      pinnedScope: askPinnedScope(ctx),             // #397: proposal defaulting + mismatch flag
      timeZone: ctx.timeZone || (thread.context && thread.context.timeZone) || null,   // scheduled runs: the user's clock
      memoryProject: headerCtx.project ? { key: headerCtx.project.key, name: headerCtx.project.name || '' } : null,   // native-rules revision: the turn mounts global + this project through --add-dir
      mock: mockEnabled({}) ? { card: mockAskCard(ctx, text) } : null, // R-F
      attachmentNames,
      deps: {
        onFrame: stampAskFrames(id, job),
        onOutOfTurn: (f) => broadcast({ ...f, threadId: id }),
        onCommentMutation: ({ runId }) => { emitDiffCommentsChanged(runId); },
        onWorktreeMutation: () => { emitAskWorktrees(id); },
        // A remember/forget in the MCP child is the same scope change a REST write makes (B29).
        // The key is parsed out of worca's OWN tool result, never written by the model; shape-check
        // it anyway before it rides a broadcast (I2-#22).
        onMemoryMutation: ({ scope }) => {
          if (scope === 'global' || (typeof scope === 'string' && scope.startsWith('projects/') && PROJECT_KEY_RE.test(scope.slice('projects/'.length)))) emitMemoryChanged(scope);
        },
        // A save_script in the MCP child is the same change a REST write makes (spec §3.3):
        // the open Scripts tabs drop their list and the composer marks its script list dirty.
        onScriptMutation: () => { emitChanged('scripts-changed', 'updated'); },
        trackRun: (input, { pin } = {}) => askTrackRun(id, input, pin ?? null),
        // pause / resume / skip / mark-read in the MCP child: the Schedules page and the badges repaint.
        onScheduleMutation: () => { emitChanged('schedules-changed', 'ask'); emitChanged('notifications-changed'); },
      },
    });
    job.turn = turn;
  } catch (err) {
    // A write/assembly failure must release the reserved slot and never leave
    // a `streaming` row for the boot sweep to find.
    if (askJobs.get(id) === job) askJobs.delete(id);
    if (asstMsg) {
      try {
        askFinishMessage(asstMsg.id, {
          text: '', blocks: [{ kind: 'notice', text: 'failed to start the turn' }],
          status: 'error', reason: null, usage: null, costUsd: null, durationMs: null,
        });
      } catch { /* thread gone */ }
    }
    return { ok: false, status: 500, error: err && err.message ? err.message : String(err) };
  }
  const settleJob = (status) => {
    if (askJobs.get(id) !== job) return;
    job.status = status;
    job.graceTimer = setTimeout(() => {
      if (askJobs.get(id) === job) askJobs.delete(id);
    }, ASK_LIMITS.jobGraceMs);
    job.graceTimer.unref?.();
    // P3 (PD5/PD26): the workflow-card events that arrived while this turn ran start now — status is already terminal,
    // so askInFlight() is null and the starter's own reservation succeeds; the started turn's settleJob continues the chain.
    Promise.resolve().then(() => drainAskDeferred(id)).catch((e) => console.error(`[worca-ui] deferred ask turn failed: ${e && e.message ? e.message : e}`));
  };
  turn.on('done', () => settleJob('done'));
  turn.on('error', () => settleJob('error'));
  // Fire-and-forget with a backstop (startAgentGen shape) — run() never throws.
  Promise.resolve()
    .then(() => turn.run())
    .catch((err) => {
      console.error(`[worca-ui] ask turn crashed: ${err && err.message ? err.message : err}`);
      settleJob('error');
    });
  return { ok: true, job, userMessageId: job.userMessageId, assistantMessageId: job.messageId, attachments: echoAttachments };
}

app.post('/api/ask/threads/:id/messages', async (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  try {
    const thread = askGetThread(id);
    if (!thread) return res.status(404).json({ error: 'thread not found' });
    if (askDeleting.has(id)) return res.status(409).json({ error: 'thread is being deleted' });
    if (askInFlight(id)) return res.status(409).json({ error: 'turn in flight' });
    // Budget gate (F6), same figure /api/run enforces: Ask spend is folded into the
    // total window (cost-budget.mjs totalWindowSpendUsd), so chat must stop at
    // the cap it helps fill instead of spending past it while pipelines are 403'd
    // (review of PR #376).
    const budget = budgetStatus();
    if (budget.blocked) return res.status(403).json({ error: 'total cost limit reached', budget });
    if (askRunningCount() >= ASK_LIMITS.turnsGlobal) {
      return res.status(429).json({ error: `at most ${ASK_LIMITS.turnsGlobal} turns may run at once` });
    }
    const body = req.body || {};
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) return badRequest(res, 'text is required');
    const mv = await validateModelEffort(body.model, body.effort);
    if (!mv.ok) return badRequest(res, mv.error);
    const cv = validateClientContext(body.context);
    if (!cv.ok) return badRequest(res, cv.error);
    // #397: explicit pin beats page context, per field. A context carrying its own
    // `pinned` verdict is authoritative — the selector-aware client already merged
    // (true) or explicitly chose Auto (false). A context WITHOUT one comes from a
    // pre-selector tab, and inherits the thread's stored pin so a stale tab can
    // never silently unpin (or re-scope) the conversation.
    let ctx = cv.context;
    if (ctx.pinned === undefined) {
      const inherited = askPinnedScope(thread.context);
      if (inherited) ctx = askApplyPin(ctx, inherited);
    }

    // §7.3 — validate EVERY attachment before ANY write (all-or-nothing).
    const files = [];
    if (body.attachments !== undefined) {
      if (!Array.isArray(body.attachments)) return badRequest(res, 'attachments must be an array');
      if (body.attachments.length > ASK_LIMITS.attachment.maxFiles) {
        return badRequest(res, `at most ${ASK_LIMITS.attachment.maxFiles} attachments per message`);
      }
      const dec = new TextDecoder('utf-8', { fatal: true });
      for (const a of body.attachments) {
        const name = a && typeof a.name === 'string' ? a.name : '';
        const dot = name.lastIndexOf('.');
        const ext = dot === -1 ? '' : name.slice(dot).toLowerCase();
        // #398: the extension CLAIMS a type; text kinds are then proven by UTF-8
        // decoding (as before), binary kinds by their magic number — a body that
        // does not match its claim is refused here, before any write.
        const cls = askClassifyExtension(ext);
        if (!cls) return badRequest(res, `attachment type not allowed: ${name || '(unnamed)'}`);
        const raw = typeof a.dataBase64 === 'string' ? a.dataBase64 : '';
        const buf = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
        if (!buf.length) return badRequest(res, `attachment is empty or not valid base64: ${name}`);
        const cap = cls.kind === 'text' ? ASK_LIMITS.attachment.maxBytesPerFile : ASK_LIMITS.attachment.maxBytesPerBinaryFile;
        if (buf.length > cap) {
          return res.status(413).json({ error: `attachment over ${cap} bytes: ${name}` });
        }
        if (cls.kind !== 'text') {
          const sniffed = askSniffMime(buf);
          if (sniffed !== cls.mime) {
            return badRequest(res, `attachment content does not match its extension: ${name}`);
          }
          files.push({ name, kind: cls.kind, mime: cls.mime, data: buf, bytes: buf.length });
          continue;
        }
        let bodyText;
        try { bodyText = dec.decode(buf); } catch { return badRequest(res, `attachment is not valid UTF-8: ${name}`); }
        if (bodyText.includes('\u0000')) return badRequest(res, `attachment contains NUL bytes: ${name}`);
        files.push({ name, kind: 'text', mime: cls.mime, text: bodyText, bytes: buf.length });
      }
      const total = askThreadAttachmentBytes(id) + files.reduce((s, f) => s + f.bytes, 0);
      if (total > ASK_LIMITS.attachment.maxBytesPerThread) {
        return res.status(413).json({ error: 'attachment budget for this thread exceeded' });
      }
    }

    const r = await startAskTurn({ threadId: id, thread, ctx, model: mv.model, effort: mv.effort, text, files, signedIn: askSignedIn(req), reader: askViewer(req) });
    if (!r.ok) return res.status(r.status).json({ error: r.error, ...(r.budget ? { budget: r.budget } : {}) });
    // `attachments` carries the store-minted ids so the sender's own echo can key
    // image thumbnails and the thread budget off them (the ask-message broadcast
    // may have raced ahead of this response, or been missed on a brand-new thread).
    res.status(202).json({ userMessageId: r.userMessageId, assistantMessageId: r.assistantMessageId, attachments: r.attachments });
  } catch (err) {
    // startAskTurn never throws (it returns {ok:false,…}); only the route's own
    // pre-checks can land here, so there is no slot to release.
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Idempotent stop (the /api/agents/generate/stop family): always {ok:true}
// after the shape check; the costUsd:null rule lives in the turn (R-C).
app.post('/api/ask/threads/:id/stop', (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  const job = askInFlight(id);
  if (job && job.turn && typeof job.turn.stop === 'function') {
    try { job.turn.stop(); } catch { /* best-effort */ }
  }
  res.json({ ok: true });
});

/** R-B dual update. Flip in the STORE and, when the owning thread's turn is
 *  still streaming, in the LIVE reducer (updateBlock re-emits the stamped
 *  ask-card job frame) — otherwise finishMessage at turn end reverts the flip
 *  with the reducer's stale copy. When no live reducer held the card (turn
 *  over, or the card sits on an earlier message), re-broadcast the whole
 *  message so tabs upsert the flipped block by message.id (§6.6 out-of-turn). */
function flipCard(threadId, cardId, patch) {
  const block = askUpdateCardBlock(threadId, cardId, patch);
  if (!block) return null;
  const job = askInFlight(threadId);
  // The store SHALLOW-merges `patch.card` on a workflow card; the reducer's
  // updateBlock replaces `card` wholesale — hand it the MERGED one (PD23),
  // else the live frame loses every key this patch did not name.
  const livePatch = patch && patch.card ? { ...patch, card: block.card } : patch;
  const live = job && job.turn && job.turn.reducer ? job.turn.reducer.updateBlock(cardId, livePatch) : null;
  if (!live) {
    const found = askFindCard(threadId, cardId);
    if (found) broadcast({ type: 'ask-message', threadId, message: found.message });
  }
  return block;
}

// Card ids with a Save in flight: the mint + the row write await, so the
// `state === 'proposed'` check alone would let two Saves both pass and write two rows.
const askCardBusy = new Set();

/** Save a PROPOSED workflow card: adopt the twin (nothing written) or write a new origin:'auto' row (spec §8.4, PD9). */
async function saveWorkflowCard(threadId, block, body = {}) {
  const card = block.card || {};
  const registry = loadAgentRegistry(AGENTS_DIR);
  const models = await listModels('');
  // A non-string `name` would be stringified by cleanText ("[object Object]" as the
  // workflow name) — only a string counts; anything else falls back to the card's own.
  const ans = sanitizeProposalAnswer(
    { decision: 'accept', name: typeof body.name === 'string' ? body.name : undefined, nodes: body.nodes },
    { proposal: card, models, registry },
  ) || { name: card.name, nodes: {} };
  let workflowId; let name; let matched = false; let nodes = card.nodes;
  // `card.match` is a snapshot from proposal time; a row archived or deleted since
  // (composer delete) must not be "adopted" as a dangling id — re-check it still
  // reads (readWorkflow returns null for archived/missing rows; wf_default always reads).
  if (card.match && card.match.id && (await readWorkflow(card.match.id))) {
    workflowId = card.match.id; name = card.match.name; matched = true;   // adopt: name/nodes ignored, row untouched
  } else {
    const r = await revalidateWorkflowProposal({
      shape: { ...card.shape, name: ans.name }, projectKey: card.projectKey, models, registry,
    });
    if (r.match) { workflowId = r.match.id; name = r.match.name; matched = true; }   // a twin appeared since the proposal
    else {
      name = ans.name;
      workflowId = await mintAutoWorkflowId(name, async (wid) => !!(await readWorkflow(wid, { includeArchived: true })));
      await writeGraphWorkflow({ ...applyTunables(r.template, ans.nodes), id: workflowId, name, domain: 'coding', origin: 'auto' });
      nodes = { ...(card.nodes || {}) };
      for (const [nid, sel] of Object.entries(ans.nodes)) nodes[nid] = { ...(nodes[nid] || {}), ...sel };
    }
  }
  // `adopted` tells the saved card which line to show ("Uses your saved workflow"
  // vs "Saved as a new workflow, tagged Auto") — card.match is set on BOTH paths.
  const flipped = flipCard(threadId, block.id, {
    state: 'saved', workflowId, card: { name, nodes, match: { id: workflowId, name }, adopted: matched },
  });
  return { block: flipped, workflowId, name, matched };
}

/**
 * The IMMEDIATE twin of drainAskDeferred's failure arm (PD29). The route answers the
 * flip and `turn:{error,status}` in one 200, but by then the flip frame has already
 * rebuilt the card element in every tab, so the panel's inline "Ask Worca could not
 * reply" lands on a detached node and the human sees a saved card and no reply at all.
 * The system notice row is the only channel that survives the rebuild; the response
 * keeps `turn.error` for API clients.
 */
function failedEventTurn(threadId, turn) {
  postAskSystemNotice(threadId, `Ask Worca could not reply to the workflow card: ${turn.error || 'unknown error'}`);
  return turn;
}

/** Store the synthetic user-row notice and start (or queue) the assistant turn whose prompt is the event (spec §8.4, PD5/PD6/PD26). */
async function startWorkflowEventTurn(threadId, block, { declined = false, thenRun = false } = {}) {
  const thread = askGetThread(threadId);
  if (!thread) return null;
  const card = block.card || {};
  const state = declined ? 'declined' : 'saved';
  const text = workflowEventPrompt({
    cardId: block.id, state, workflowId: block.workflowId, name: card.name, thenRun, projectKey: card.projectKey || '',
  });
  const notice = workflowNoticeText({ state, name: card.name, matched: !declined && card.adopted === true, thenRun });
  let mv = await validateModelEffort(thread.model, thread.effort);
  if (!mv.ok) {
    const d = (await askCatalog({ withSecrets: false })).default;
    if (!d) return failedEventTurn(threadId, { error: 'no model available', status: 503 });
    mv = { ok: true, ...d };
  }
  const start = () => startAskTurn({
    threadId, thread: askGetThread(threadId) || thread, ctx: thread.context || {},
    model: mv.model, effort: mv.effort, text, synthetic: { notice },
  });
  if (askInFlight(threadId)) {
    // PD5/PD26: the flip stands and the reply waits — settleJob drains the queue
    // when the running turn ends, and a starter that cannot reserve a slot then
    // posts a system notice rather than vanishing.
    if (!askDeferred.has(threadId)) askDeferred.set(threadId, []);
    askDeferred.get(threadId).push(start);
    return { deferred: true };
  }
  const r = await start();
  if (r.ok) return { assistantMessageId: r.assistantMessageId };
  return failedEventTurn(threadId, { error: r.error, status: r.status, ...(r.budget ? { budget: r.budget } : {}) });
}

/** The metrics / policy / schedule card's event turn: the synthetic notice row + the
 *  "[worca event] <type> card …" prompt (same queueing as workflow cards). */
async function startMetricsEventTurn(threadId, block) {
  const thread = askGetThread(threadId);
  if (!thread) return null;
  const card = block.card || {};
  const state = block.state === 'declined' ? 'declined' : block.state === 'failed' ? 'failed' : 'applied';
  const result = card.result || null;
  // One event turn for every non-workflow card; the type picks the wording. Metrics is the fallback.
  const kind = card.type === 'policy' || card.type === 'schedule' || card.type === 'model' || card.type === 'clone' ? card.type : 'metrics';
  const eventPrompt = { policy: policyEventPrompt, schedule: scheduleEventPrompt, model: modelEventPrompt, clone: cloneEventPrompt, metrics: metricsEventPrompt }[kind];
  const noticeText = { policy: policyNoticeText, schedule: scheduleNoticeText, model: modelNoticeText, clone: cloneNoticeText, metrics: metricsNoticeText }[kind];
  const text = eventPrompt({ cardId: block.id, state, card, result });
  const notice = noticeText({ state, card, result });
  let mv = await validateModelEffort(thread.model, thread.effort);
  if (!mv.ok) {
    const d = (await askCatalog({ withSecrets: false })).default;
    if (!d) return failedEventTurn(threadId, { error: 'no model available', status: 503 });
    mv = { ok: true, ...d };
  }
  const start = () => startAskTurn({
    threadId, thread: askGetThread(threadId) || thread, ctx: thread.context || {},
    model: mv.model, effort: mv.effort, text, synthetic: { notice },
  });
  if (askInFlight(threadId)) {
    if (!askDeferred.has(threadId)) askDeferred.set(threadId, []);
    askDeferred.get(threadId).push(start);
    return { deferred: true };
  }
  const r = await start();
  if (r.ok) return { assistantMessageId: r.assistantMessageId };
  return failedEventTurn(threadId, { error: r.error, status: r.status, ...(r.budget ? { budget: r.budget } : {}) });
}

/** Follow a clone card's job to its end: flip the card to applied | failed and start the event turn.
 *  Reads the job object startCloneJob returned (it is updated in place when the clone ends). */
function followCloneCard(threadId, cardId, job, { everyMs = 500 } = {}) {
  const timer = setInterval(async () => {
    if (!job || job.state === 'running') return;
    clearInterval(timer);
    const result = job.state === 'done'
      ? { ok: true, jobId: job.id, project: job.project ? { name: job.project.name, path: job.project.path } : null }
      : { ok: false, jobId: job.id, code: job.code || 'failed', error: job.error || 'the clone failed' };
    const block = flipCard(threadId, cardId, result.ok ? { state: 'applied', card: { result } } : { state: 'failed', error: result.error, card: { result } });
    if (!block) return;
    try { await startMetricsEventTurn(threadId, block); }
    catch (err) { console.error(`[worca-ui] clone card event turn failed: ${err && err.message ? err.message : err}`); }
  }, everyMs);
  timer.unref?.();
}

// D14 dismiss ("Not now" keeps a stub — the client renders state:'dismissed') for a RUN card;
// the workflow-card state machine (spec §8.4) for a workflow one. The card is looked up BEFORE
// the body is validated because the legal verb set depends on the card's type.
app.post('/api/ask/threads/:id/cards/:cardId', async (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  const cardId = askIdParam(res, req.params.cardId, 'card');
  if (!cardId) return;
  try {
    if (!askGetThread(id)) return res.status(404).json({ error: 'thread not found' });
    const body = req.body || {};
    const found = askFindCard(id, cardId);
    if (!found) return res.status(404).json({ error: 'card not found' });
    if (found.block.card && found.block.card.type === 'schedule') {
      // Schedule card (docs/scheduled-runs.md "Ask Worca"): proposed → applied | failed | declined. The change —
      // start now, move, edit, cancel, delete — happens HERE, behind the click, through the same scheduleVerb
      // the Schedules page uses; never in the model's tool.
      if (body.state !== 'applied' && body.state !== 'declined') return badRequest(res, 'state must be "applied" or "declined"');
      if (found.block.state !== 'proposed') return res.status(409).json({ error: `card is ${found.block.state}` });
      if (askCardBusy.has(cardId)) return res.status(409).json({ error: 'card is being applied' });
      if (body.state === 'declined') {
        const block = flipCard(id, cardId, { state: 'declined' });
        if (!block) return res.status(409).json({ error: 'card vanished' });
        const turn = await startMetricsEventTurn(id, block);
        return res.json({ block, turn });
      }
      askCardBusy.add(cardId);
      let block;
      try {
        let result;
        try { result = await applyScheduleCard(found.block.card, { by: actorOf(req) }); }
        catch (err) { result = { ok: false, error: err && err.message ? err.message : String(err) }; }
        block = flipCard(id, cardId, result.ok ? { state: 'applied', card: { result } } : { state: 'failed', error: result.error, card: { result } });
      } finally { askCardBusy.delete(cardId); }
      if (!block) return res.status(409).json({ error: 'card vanished' });
      const turn = await startMetricsEventTurn(id, block);
      return res.json({ block, turn });
    }
    if (found.block.card && found.block.card.type === 'model') {
      // Model card (docs/models.md "Ask Worca"): proposed → applied | failed | declined. The catalog / provider
      // write happens HERE, behind the click, through the same setters the Models view uses — each re-validates.
      if (body.state !== 'applied' && body.state !== 'declined') return badRequest(res, 'state must be "applied" or "declined"');
      if (found.block.state !== 'proposed') return res.status(409).json({ error: `card is ${found.block.state}` });
      if (askCardBusy.has(cardId)) return res.status(409).json({ error: 'card is being applied' });
      if (body.state === 'declined') {
        const block = flipCard(id, cardId, { state: 'declined' });
        if (!block) return res.status(409).json({ error: 'card vanished' });
        const turn = await startMetricsEventTurn(id, block);
        return res.json({ block, turn });
      }
      askCardBusy.add(cardId);
      let block;
      try {
        let result;
        try { result = await applyModelChange(found.block.card); emitChanged('settings-changed'); }
        catch (err) { result = { ok: false, error: err && err.message ? err.message : String(err) }; }
        block = flipCard(id, cardId, result.ok ? { state: 'applied', card: { result } } : { state: 'failed', error: result.error, card: { result } });
      } finally { askCardBusy.delete(cardId); }
      if (!block) return res.status(409).json({ error: 'card vanished' });
      const turn = await startMetricsEventTurn(id, block);
      return res.json({ block, turn });
    }
    if (found.block.card && found.block.card.type === 'clone') {
      // Clone card (docs/deploy-railway.md "First project"): proposed → cloning → applied | failed, or declined.
      // The clone happens HERE, behind the click, as the same job the Projects view starts (startCloneJob);
      // a refusal known up front fails the card at once, otherwise the card follows the job to its end.
      if (body.state !== 'applied' && body.state !== 'declined') return badRequest(res, 'state must be "applied" or "declined"');
      if (found.block.state !== 'proposed') return res.status(409).json({ error: `card is ${found.block.state}` });
      if (askCardBusy.has(cardId)) return res.status(409).json({ error: 'card is being applied' });
      if (body.state === 'declined') {
        const block = flipCard(id, cardId, { state: 'declined' });
        if (!block) return res.status(409).json({ error: 'card vanished' });
        const turn = await startMetricsEventTurn(id, block);
        return res.json({ block, turn });
      }
      askCardBusy.add(cardId);
      let block;
      let job = null;
      try {
        const ch = found.block.card.change || {};
        try {
          job = await startCloneJob({ url: ch.url, branch: ch.branch ?? null, name: ch.name ?? null });
          block = flipCard(id, cardId, { state: 'cloning', card: { result: { ok: null, jobId: job.id } } });
        } catch (err) {
          const result = { ok: false, code: (err && err.code) || 'failed', error: err && err.message ? err.message : String(err) };
          block = flipCard(id, cardId, { state: 'failed', error: result.error, card: { result } });
        }
      } finally { askCardBusy.delete(cardId); }
      if (!block) return res.status(409).json({ error: 'card vanished' });
      if (block.state === 'failed') return res.json({ block, turn: await startMetricsEventTurn(id, block) });
      followCloneCard(id, cardId, job);
      return res.json({ block });
    }
    if (found.block.card && (found.block.card.type === 'metrics' || found.block.card.type === 'policy')) {
      // Metrics / policy card (docs/team-metrics.md, docs/team-policy.md "Ask Worca"): proposed → applied | failed |
      // declined. The change is the outward-facing part — a branch on origin, a commit to the team's policy, a
      // marker on another repo, this machine's switch, the workspace's home — so it happens HERE, behind the
      // click, never in the model's tool.
      const apply = found.block.card.type === 'policy' ? applyPolicyChange : applyMetricsChange;
      if (body.state !== 'applied' && body.state !== 'declined') return badRequest(res, 'state must be "applied" or "declined"');
      if (found.block.state !== 'proposed') return res.status(409).json({ error: `card is ${found.block.state}` });
      if (askCardBusy.has(cardId)) return res.status(409).json({ error: 'card is being applied' });
      if (body.state === 'declined') {
        const block = flipCard(id, cardId, { state: 'declined' });
        if (!block) return res.status(409).json({ error: 'card vanished' });
        const turn = await startMetricsEventTurn(id, block);
        return res.json({ block, turn });
      }
      askCardBusy.add(cardId);
      let block;
      try {
        let result;
        try { result = await apply(found.block.card); }
        catch (err) {
          result = { ok: false, error: err && err.message ? err.message : String(err), code: (err && err.code) || 'ERROR', ...(err && err.hint ? { hint: err.hint } : {}), ...(err && err.stderr ? { stderr: String(err.stderr).slice(0, 2000) } : {}) };
        }
        block = flipCard(id, cardId, result.ok ? { state: 'applied', card: { result } } : { state: 'failed', error: result.error, card: { result } });
      } finally { askCardBusy.delete(cardId); }
      if (!block) return res.status(409).json({ error: 'card vanished' });
      const turn = await startMetricsEventTurn(id, block);
      return res.json({ block, turn });
    }
    if (!(found.block.card && found.block.card.type === 'workflow')) {
      if (body.state !== 'dismissed') return badRequest(res, 'state must be "dismissed"');
      if (found.block.state !== 'proposed') {
        return res.status(409).json({ error: `card is ${found.block.state}` });
      }
      const block = flipCard(id, cardId, { state: 'dismissed' });
      // Dismiss is terminal: the card's parked comment ids can never reach a run,
      // so drop them here exactly as the launch path does at its own success point
      // (:1155). Own try/catch — comment bookkeeping must never fail the dismiss.
      try { clearPendingCardComments(cardId); }
      catch (e) { console.error('[diff-comments] dismiss cleanup failed:', e && e.message ? e.message : e); }
      return res.json({ block });
    }
    // Workflow card state machine (spec §8.4): proposed → saved | declined. A saved card has no
    // verb — its event turn proposes the run itself (thenRun) or offers one in chat.
    if (body.state !== 'saved' && body.state !== 'declined') {
      return badRequest(res, 'state must be "saved" or "declined"');
    }
    if (found.block.state !== 'proposed') return res.status(409).json({ error: `card is ${found.block.state}` });
    if (askCardBusy.has(cardId)) return res.status(409).json({ error: 'card is being saved' });
    if (body.state === 'declined') {
      const block = flipCard(id, cardId, { state: 'declined' });
      if (!block) return res.status(409).json({ error: 'card vanished' });   // the thread was deleted between the lookup and the flip
      const turn = await startWorkflowEventTurn(id, block, { declined: true });
      return res.json({ block, turn });
    }
    askCardBusy.add(cardId);
    let saved;
    try { saved = await saveWorkflowCard(id, found.block, body); }
    finally { askCardBusy.delete(cardId); }
    // flipCard() null — the row (if written) stays, the card is gone with its thread.
    if (!saved.block) return res.status(409).json({ error: 'card vanished' });
    const turn = await startWorkflowEventTurn(id, saved.block, { thenRun: !!found.block.card.thenRun });
    res.json({ block: saved.block, turn });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// /api/agents* -> agent registry + user-agent CRUD, delegated to
// src/core/agent-store.mjs (layered builtin + ~/.worca-cc/agents user pairs).
// GET returns palette render order (.order ascending) with origin stamped; the
// client builds draggable pills (colored dot + displayName + icon) from this.
// ---------------------------------------------------------------------------

app.get('/api/agents', async (req, res) => {
  try {
    const all = await listAgents(); // merged builtin+user, origin stamped, .order ascending
    // §6.6: workspace-only agents stay out of the Composer palette by default;
    // the Agents management view passes ?all=1 to see them too.
    const agents = isTruthy(req.query.all) ? all : all.filter((m) => m.scope !== 'workspace-only');
    // mockWriterRoles drives ONE select in the agent form. It is a CLOSED list
    // (the mock switch in claude-runner.mjs), unlike the open channel vocabulary
    // it replaces in Task 12: an unknown mockRole is dropped by the registry
    // with a warning, never rejected.
    res.json({ agents, mockWriterRoles: [...MOCK_WRITER_ROLES] });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Map agent-store err.code -> HTTP (mirrors workspaceErrorStatus).
function agentErrorStatus(code) {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'BAD_REQUEST') return 400;
  if (code === 'PLUGIN') return 400;
  // A declared ask form that fails gate 1 is a well-formed request the server
  // understood and refused on content — the same 422 POST /api/answer uses for a
  // gate-3 failure (ask-forms spec §5, §11).
  if (code === 'ASK_FORM') return 422;
  if (code === 'BUILTIN' || code === 'DUPLICATE' || code === 'REFERENCED') return 409;
  return 500;
}

/** The error body: `{ error }` for every failure, plus the structured `errors`
 *  list when the store produced one (gate 1). Never adds an empty `errors`. */
function agentErrorBody(err) {
  const body = { error: err && err.message ? err.message : String(err) };
  if (Array.isArray(err?.errors) && err.errors.length) body.errors = err.errors;
  return body;
}

/**
 * Fire-and-forget agent generation (mirrors startScan). Mints genId, registers
 * a kind:'agentgen' entry in the SAME runs Map, wires its agentgen-* events,
 * starts createAgentGen(...).run() detached with a .catch backstop, returns
 * genId. The draft is NEVER saved — persistence is the wizard's explicit
 * follow-up POST /api/agents.
 * @returns {string} genId
 */
function startAgentGen(input) {
  const orch = createAgentGen({
    ...input,
    claude: { permissionMode: 'acceptEdits', mock: isTruthy(process.env.WORCA_MOCK ?? process.env.ORCH_MOCK) },
  });
  // The engine mints its own genId (agen_<uuid>) and tags every emitted event
  // with it; use THAT as the runs-Map key + the returned id so the entry, its
  // buffered events, and WS reconnect/replay (?genId=) all agree on one id.
  const genId = orch.getState().genId;
  const entry = {
    id: genId, genId, orch, kind: 'agentgen', projectDir: null,
    title: `agent: ${input.name}`, status: 'running',
    startedAt: new Date().toISOString(), events: [], pendingQuestion: null,
  };
  runs.set(genId, entry);
  wireAgentGen(entry);

  Promise.resolve()
    .then(() => orch.run())
    .catch((err) => {
      // run() should never throw (it emits agentgen-error), but a defensive
      // backstop mirrors startScan: surface an unexpected throw as a tagged
      // agentgen-error.
      const event = { genId, type: 'agentgen-error', message: err && err.message ? err.message : String(err) };
      entry.status = 'error';
      entry.events.push(event);
      broadcast(event);
    });

  return genId;
}

// POST /api/agents/generate. Registered BEFORE GET /api/agents/:key so the
// literal segment is never swallowed by the :key param. Mode A (purpose given):
// the LLM drafts both the .md body and the meta JSON. Mode B (userMarkdown
// given): the body is the user's verbatim; the LLM infers ONLY the meta.
app.post('/api/agents/generate', async (req, res) => {
  try {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return badRequest(res, 'name is required');
    const userMarkdown = typeof body.userMarkdown === 'string' && body.userMarkdown.trim() ? body.userMarkdown : '';
    if (!userMarkdown && !(typeof body.purpose === 'string' && body.purpose.trim())) {
      return badRequest(res, 'purpose is required (or paste your own markdown)');
    }
    // Resolve neighbor keys to full agent metas (produces/consumes feed the
    // prompt's neighbor block); unknown keys are silently dropped.
    const allAgents = await listAgents();
    const byKey = Object.fromEntries(allAgents.map((m) => [m.key, m]));
    const pick = (keys) => (Array.isArray(keys) ? keys : []).map((k) => byKey[k]).filter(Boolean);
    const genId = startAgentGen({
      name, purpose: String(body.purpose || ''), details: String(body.details || ''),
      expectedBefore: pick(body.expectedBefore), expectedAfter: pick(body.expectedAfter),
      userMarkdown,
    });
    res.json({ genId });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/agents/generate/stop  body:{genId} -> entry.orch.stop() (aborts the
// in-flight runClaude; the engine's finally reaps its scratch dir); marks the
// entry 'stopped'. Idempotent: an unknown/finished generation still returns ok
// (mirrors POST /api/scan/stop).
app.post('/api/agents/generate/stop', (req, res) => {
  const genId = req.body && typeof req.body.genId === 'string' ? req.body.genId : '';
  const entry = genId ? runs.get(genId) : null;
  if (entry && entry.kind === 'agentgen' && entry.orch && typeof entry.orch.stop === 'function') {
    try { entry.orch.stop(); } catch { /* best-effort */ }
    entry.status = 'stopped';
  }
  res.json({ ok: true });
});

app.get('/api/agents/:key', async (req, res) => {
  const key = req.params.key;
  if (!AGENT_KEY_RE.test(key)) return res.status(404).json({ error: 'agent not found' });
  try {
    const data = await readAgent(key);
    if (!data) return res.status(404).json({ error: 'agent not found' });
    res.json(data); // { meta (incl. origin), markdown }
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/agents', async (req, res) => {
  const body = req.body || {};
  try {
    const created = await createAgent({ meta: body.meta, markdown: body.markdown });
    res.status(201).json(created);
  } catch (err) {
    res.status(agentErrorStatus(err && err.code)).json(agentErrorBody(err));
  }
});

app.put('/api/agents/:key', async (req, res) => {
  const key = req.params.key;
  if (!AGENT_KEY_RE.test(key)) return res.status(404).json({ error: 'agent not found' });
  const body = req.body || {};
  try {
    res.json(await updateAgent(key, { meta: body.meta, markdown: body.markdown }));
  } catch (err) {
    res.status(agentErrorStatus(err && err.code)).json(agentErrorBody(err));
  }
});

app.delete('/api/agents/:key', async (req, res) => {
  const key = req.params.key;
  if (!AGENT_KEY_RE.test(key)) return res.status(404).json({ error: 'agent not found' });
  try {
    res.json(await deleteAgent(key));
  } catch (err) {
    res.status(agentErrorStatus(err && err.code)).json(agentErrorBody(err));
  }
});

// ---------------------------------------------------------------------------
// /api/scripts* -> the script registry (spec §8.4): built-in scripts/ + the user
// layer + enabled plugins, D16-filtered against the agent registry. The write half
// (CRUD, duplicate, cases) is below, delegated to src/core/script-store.mjs.
// ---------------------------------------------------------------------------
function scriptRegistryNow() {
  return loadScriptRegistry({ agentKeys: Object.keys(loadAgentRegistry(AGENTS_DIR)) });
}

/**
 * Workbench spec §7 / W17: a python card this host cannot run is flagged ON THE
 * WIRE, so the composer's V4 names it the moment the card is placed and the
 * Scripts list can chip it. The probe is 60 s-cached, so this costs at most one
 * spawn a minute. The REGISTRY is deliberately never stamped: it is loaded
 * synchronously and the probe is not, and a run must be gated by its own
 * preflight — with a fresh probe, at run time — not by a flag baked into a
 * snapshot taken when some browser last asked for a list.
 */
async function stampRuntimeMissing(list) {
  if (!list.some((m) => m.runtime === 'python')) return list;
  const probe = await probePython();
  if (probe.ok) return list;
  return list.map((m) => (m.runtime === 'python' ? { ...m, runtimeMissing: true } : m));
}

app.get('/api/scripts', async (req, res) => {
  try {
    // listScripts() IS the registry, in the same order, with caseCount stamped
    // (the list card's case chip). scriptRegistryNow() stays for the graph
    // routes, which need the raw index for registryPortsFn.
    res.json({ scripts: await stampRuntimeMissing(await listScripts()) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Literal segments are registered BEFORE /api/scripts/:key, so the param route
// can never swallow them (the POST /api/agents/generate rule).
app.get('/api/scripts/runtimes', async (req, res) => {
  // C8: the picker is wired once, against the real shape. The python arm is the
  // real probe (workbench spec §7; never rejects, 60 s-cached); node and shell are
  // guaranteed by the host itself.
  res.json({
    node: { ok: true, version: process.version },
    shell: { ok: true, path: process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh' },
    python: pythonRuntimeState(await probePython()),
  });
});

/**
 * Fire-and-forget bench run (mirrors startAgentGen). Mints nothing itself: the
 * engine owns the id and tags every event with it, so the runs-Map key, the
 * buffered events and the `?benchId=` replay all agree on one id.
 * @returns {string} benchId
 */
function startScriptBench(request) {
  const orch = createBench(request);
  const benchId = orch.id;
  const entry = {
    id: benchId, benchId, orch, kind: 'scriptbench', projectDir: null,
    title: `bench: ${request.key}`, status: 'running',
    startedAt: new Date().toISOString(), events: [], pendingQuestion: null, result: null, seq: 0,
  };
  runs.set(benchId, entry);
  // Nothing else ever deletes a bench entry (runs.delete fires for pipeline
  // lineages only), and Run is the page's main verb: keep the newest few so the
  // output route and a reconnect can still read them, drop the rest with their
  // <= 5000 buffered lines and 256 KiB-per-output results.
  const benches = [...runs.values()].filter((e) => e.kind === 'scriptbench');
  for (const old of benches.slice(0, Math.max(0, benches.length - MAX_BENCH_ENTRIES))) {
    if (old.status !== 'running') runs.delete(old.id);
  }
  wireScriptBench(entry);

  Promise.resolve()
    .then(() => orch.run())
    .catch((err) => {
      // run() never throws (it emits scriptbench-error); this is startScan's
      // defensive backstop, surfacing an unexpected throw as a tagged error.
      // It carries the entry's next `seq` like every other frame (C17), or a
      // subscribe replay would deliver this one twice.
      entry.seq = (entry.seq || 0) + 1;
      const event = { benchId, seq: entry.seq, type: 'scriptbench-error', message: err && err.message ? err.message : String(err), code: null };
      entry.status = 'error';
      entry.events.push(event);
      broadcast(event);
    });

  return benchId;
}

// The §4.2 request rides through untouched: the engine validates it and reports
// every refusal (unknown key, bad param, cap hit) as ONE scriptbench-error on
// the socket. Only the key shape is checked here, so a malformed :key-shaped
// value can never reach the store.
app.post('/api/scripts/bench', (req, res) => {
  const body = req.body || {};
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!SCRIPT_KEY_RE.test(key)) return res.status(404).json({ error: 'script not found' });
  try {
    res.json({ benchId: startScriptBench({ ...body, key }) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Idempotent stop (the /api/agents/generate/stop shape): an unknown or finished
// bench still answers ok.
app.post('/api/scripts/bench/stop', (req, res) => {
  const benchId = req.body && typeof req.body.benchId === 'string' ? req.body.benchId : '';
  const entry = benchId ? runs.get(benchId) : null;
  if (entry && entry.kind === 'scriptbench' && entry.orch && typeof entry.orch.stop === 'function') {
    try { entry.orch.stop(); } catch { /* best-effort */ }
    entry.status = 'stopped';
  }
  res.json({ ok: true });
});

// The full text of one output (the WS result carries at most 256 KiB). The file
// PATH comes from the entry's stored result — never from the URL — so this route
// cannot be walked; `:port` is only a lookup key into that result.
app.get('/api/scripts/bench/:benchId/output/:port', async (req, res) => {
  const entry = runs.get(req.params.benchId);
  if (!entry || entry.kind !== 'scriptbench' || !entry.result) return res.status(404).json({ error: 'bench not found' });
  if (!PORT_ID_RE.test(req.params.port)) return res.status(404).json({ error: 'output not found' });
  const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : '';
  // A Run-all result is a list of per-case results (§4.3), so it needs ?caseId=.
  const result = Array.isArray(entry.result.cases)
    ? (entry.result.cases.find((c) => c.caseId === caseId) || {}).result
    : entry.result;
  // hasOwn: PORT_ID_RE admits `constructor` / `toString`, which a plain lookup would find on Object.prototype.
  const out = result && result.outputs && Object.hasOwn(result.outputs, req.params.port) ? result.outputs[req.params.port] : null;
  if (!out || !out.path) return res.status(404).json({ error: 'output not found' });
  // STREAMED, not read into a string: a bench output is whatever the script
  // wrote. readFile() buffered the whole file (a 600 MB log spiked the server by
  // half a gigabyte) and past ~512 MiB threw "Invalid string length", which this
  // catch then reported as a missing output.
  let st;
  try { st = await fsp.stat(out.path); } catch { return res.status(404).json({ error: 'output not found' }); }
  if (!st.isFile()) return res.status(404).json({ error: 'output not found' });
  res.type('text/plain; charset=utf-8').set('Content-Length', String(st.size));
  const stream = fs.createReadStream(out.path);
  stream.on('error', () => { res.destroy(); });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});


app.get('/api/scripts/:key', async (req, res) => {
  const key = req.params.key;
  if (!SCRIPT_KEY_RE.test(key)) return res.status(404).json({ error: 'script not found' });
  try {
    const data = await readScript(key);
    if (!data) return res.status(404).json({ error: 'script not found' });
    // The meta is spread FLAT (the Scripts page and the composer read `key`,
    // `runtime`, `ports` off the top level); the store's reads ride beside it.
    res.json({
      ...data.meta,
      source: data.source,
      sourceWin32: data.sourceWin32,
      sourcePath: data.sourcePath,
      sourceTruncated: data.sourceTruncated,
      cases: data.cases,
      userCases: data.userCases,
      casesWritable: data.casesWritable,
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});


// ---------------------------------------------------------------------------
// The write half (spec §3.3–§3.4): user-layer CRUD, duplicate and cases,
// delegated to src/core/script-store.mjs. The store's err.code vocabulary IS
// the agent store's, so agentErrorStatus maps it unchanged. `by: 'ui'` stamps
// every save from this process (W19); the CLI and Ask Worca call core directly
// with their own stamp. Each mutation pokes every open tab with the bare
// `scripts-changed` broadcast, so a script saved elsewhere appears without a
// reload — the client drops its cached list and marks the palette dirty.
// ---------------------------------------------------------------------------
const STORE_ERROR_CODES = new Set(['NOT_FOUND', 'BAD_REQUEST', 'PLUGIN', 'BUILTIN', 'DUPLICATE', 'REFERENCED']);
// Only the store's OWN vocabulary is quoted back to the page. An fs failure
// (EACCES on the scripts dir, a full disk) carries the absolute home path in its
// message, which no banner may surface (agent-store.mjs#propagateToVariants).
const scriptError = (res, err) => {
  const code = err && err.code;
  return res
    .status(agentErrorStatus(code))
    .json({ error: STORE_ERROR_CODES.has(code) && err.message ? err.message : `the script store failed (${code || 'unknown error'})` });
};

app.post('/api/scripts', async (req, res) => {
  const body = req.body || {};
  try {
    const created = await createScript({ meta: body.meta, source: body.source, sourceWin32: body.sourceWin32, by: 'ui' });
    emitChanged('scripts-changed', 'created');
    res.status(201).json(created);
  } catch (err) {
    scriptError(res, err);
  }
});

app.put('/api/scripts/:key', async (req, res) => {
  const key = req.params.key;
  if (!SCRIPT_KEY_RE.test(key)) return res.status(404).json({ error: 'script not found' });
  const body = req.body || {};
  try {
    const updated = await updateScript(key, { meta: body.meta, source: body.source, sourceWin32: body.sourceWin32, by: 'ui' });
    emitChanged('scripts-changed', 'updated');
    res.json(updated);
  } catch (err) {
    scriptError(res, err);
  }
});

app.delete('/api/scripts/:key', async (req, res) => {
  const key = req.params.key;
  if (!SCRIPT_KEY_RE.test(key)) return res.status(404).json({ error: 'script not found' });
  try {
    const r = await deleteScript(key);
    emitChanged('scripts-changed', 'deleted');
    res.json(r);
  } catch (err) {
    scriptError(res, err);
  }
});

app.post('/api/scripts/:key/duplicate', async (req, res) => {
  const key = req.params.key;
  if (!SCRIPT_KEY_RE.test(key)) return res.status(404).json({ error: 'script not found' });
  const newKey = req.body && typeof req.body.newKey === 'string' ? req.body.newKey.trim() : '';
  if (!newKey) return badRequest(res, 'newKey is required');
  try {
    const copy = await duplicateScript(key, newKey, 'ui');
    emitChanged('scripts-changed', 'created');
    res.status(201).json(copy);
  } catch (err) {
    scriptError(res, err);
  }
});

app.put('/api/scripts/:key/cases', async (req, res) => {
  const key = req.params.key;
  if (!SCRIPT_KEY_RE.test(key)) return res.status(404).json({ error: 'script not found' });
  const cases = req.body && Array.isArray(req.body.cases) ? req.body.cases : null;
  if (!cases) return badRequest(res, 'cases must be an array');
  try {
    // W18: for a built-in or plugin key this lands in the user layer as an
    // overlay — a tests file with no meta beside it.
    const r = await writeCases(key, cases);
    emitChanged('scripts-changed', 'cases');
    res.json(r);
  } catch (err) {
    scriptError(res, err);
  }
});


// ---------------------------------------------------------------------------
// /api/plugins* -> plugin lifecycle, delegated to src/core/plugin-store.mjs /
// plugin-repo.mjs / plugin-config.mjs (spec §6). Thin wrappers: all policy
// (SHA pinning, symlink swap, uninstall guard, secret routing) lives in core.
// ---------------------------------------------------------------------------
// :name guard for every /api/plugins/:name route. Manifest names are kebab-case
// (normalizeManifest, plugin-manifest.mjs), so a value failing this regex can
// never contain '/' or '..' — pluginDir(name)/pluginCurrentDir(name) cannot
// escape the namespace — and it reads as "not found" (mirrors the AGENT_KEY_RE
// guard on /api/agents/:key). Existence = lockfile membership.
const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
function requirePlugin(req, res) {
  const name = req.params.name;
  if (!PLUGIN_NAME_RE.test(name) || !readPluginsLock()[name]) {
    res.status(404).json({ error: 'plugin not found' });
    return null;
  }
  return name;
}

// :id guard for every /api/marketplaces/:id route. Real ids come from repoSlug
// (`<readable [A-Za-z0-9._-]>-<8 hex>`), so this regex admits every legitimate
// id and nothing path-like. The null-prototype map from readMarketplaces already
// blocks `__proto__`/`constructor` lookups in add/sync/remove; Object.hasOwn
// here is belt-and-suspenders.
const MARKETPLACE_ID_RE = /^[A-Za-z0-9._-]{1,100}$/;
function requireMarketplace(req, res) {
  const id = req.params.id;
  if (!MARKETPLACE_ID_RE.test(id) || !Object.hasOwn(readMarketplaces().marketplaces, id)) {
    res.status(404).json({ error: 'marketplace not found' });
    return null;
  }
  return id;
}

// Map plugin-core err.code -> HTTP (mirrors agentErrorStatus). The uninstall
// guard's ReferencedError (plugin-workflows.mjs) is matched structurally so its
// payload (the referencing list) reaches the client; everything uncoded is a
// 500 with the verbatim message (spec §11: surface command output unchanged).
function pluginErrorStatus(code) {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'BAD_REQUEST') return 400;
  if (code === 'REFERENCED') return 409;
  if (code === 'EXISTS') return 409;
  return 500;
}
function sendPluginError(res, err) {
  const message = err && err.message ? err.message : String(err);
  if (err && (err.name === 'ReferencedError' || err.code === 'REFERENCED')) {
    return res.status(409).json({ error: message, references: err.references || [] });
  }
  res.status(pluginErrorStatus(err && err.code)).json({ error: message });
}

// Load the installed manifest through the current/ symlink. null = broken
// install (missing/unparseable) — routes answer 409 "run doctor", not a crash.
function readInstalledManifest(name) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(pluginCurrentDir(name), 'worca-cc-plugin.json'), 'utf8'));
    const norm = normalizeManifest(raw, { dir: pluginCurrentDir(name) });
    return norm.ok ? norm.manifest : null;
  } catch {
    return null;
  }
}

app.get('/api/plugins', async (req, res) => {
  try {
    const mkts = readMarketplaces().marketplaces;
    const rows = listInstalledPlugins();
    // The python notice (spec §8.1) is a fact about THIS host: resolved once per
    // request, and only when some plugin ships a python script (the probe caches 60 s).
    const anyPython = rows.some((p) => Number((p.scriptRuntimes || {}).python) > 0);
    const notice = anyPython ? await pythonNoticeFor([{ runtime: 'python' }]) : null;
    res.json({
      plugins: rows.map((p) => ({
        ...p,
        marketplaceName: p.marketplace && mkts[p.marketplace] ? mkts[p.marketplace].name : null,
        pythonMissing: !!(notice && Number((p.scriptRuntimes || {}).python) > 0),
      })),
      orphans: listOrphanPluginData(),
    });
  } catch (err) {
    sendPluginError(res, err);
  }
});

// Marketplaces (spec §4.7): the persisted repo registry behind the Plugins
// view's Available/Marketplaces sections. Snapshots are cached in
// marketplaces.json, so GET is zero-network; refresh routes do the git work.

// Merge lock membership onto each snapshot plugin. MUST wrap every response that
// returns marketplace snapshots — refresh routes return raw entries whose plugins
// have no `installed` key, and renderAvailableList would re-offer Install on them.
function withInstalled(list) {
  const lock = readPluginsLock();
  return (list || []).map((m) => ({
    ...m, plugins: (m.plugins || []).map((p) => ({ ...p, installed: !!lock[p.name] })),
  }));
}

app.get('/api/marketplaces', (req, res) => {
  try {
    res.json({ marketplaces: withInstalled(listMarketplaces()) });
  } catch (err) { sendPluginError(res, err); }
});

// Dev-mode link of a LOCAL plugin folder — the `worca plugin link <dir>` path
// (validate, symlink current/, import its workflow templates). Reached directly
// via POST /api/plugins/link, and by POST /api/marketplaces when the "marketplace"
// handed in turns out to be a single plugin folder (the natural thing to paste
// after `Export… → Worca plugin`, issue #421).
async function linkPluginDir(dir) {
  const abs = resolveProjectDir(dir);
  if (!abs) throw Object.assign(new Error('dir is required'), { code: 'BAD_REQUEST' });
  const v = validatePluginDir(abs);
  if (!v.ok || !v.manifest) {
    const lines = v.problems.filter((p) => p.level === 'error').map((p) => p.message);
    throw Object.assign(new Error(`cannot link ${abs}: ${lines.join('; ') || 'not a valid plugin folder'}`), { code: 'BAD_REQUEST' });
  }
  let out;
  try { out = await linkPlugin(v.manifest.name, abs); }
  catch (err) { throw Object.assign(err instanceof Error ? err : new Error(String(err)), { code: err?.code || 'BAD_REQUEST' }); }
  reloadChatWorkers(v.manifest.name);
  return out; // { ok, name, dir, workflows: { imported, skipped } }
}

app.post('/api/plugins/link', async (req, res) => {
  try {
    res.json(await linkPluginDir(req.body && typeof req.body.dir === 'string' ? req.body.dir : ''));
  } catch (err) { sendPluginError(res, err); }
});

app.post('/api/marketplaces', async (req, res) => {
  const url = req.body && typeof req.body.url === 'string' ? req.body.url.trim() : '';
  if (!url) return badRequest(res, 'url is required');
  try {
    res.json({ ok: true, marketplace: withInstalled([await addMarketplace(url)])[0] });
  } catch (err) {
    if (err && err.code === 'PLUGIN_FOLDER') {
      // Not a marketplace but a plugin folder: link it, and SAY that is what happened.
      try { return res.json({ ok: true, linked: true, plugin: await linkPluginDir(err.dir) }); }
      catch (e) { return sendPluginError(res, e); }
    }
    sendPluginError(res, err);
  }
});

// refresh-all (a distinct path from :id/refresh, so registration order is irrelevant).
app.post('/api/marketplaces/refresh', async (req, res) => {
  try {
    res.json({ ok: true, marketplaces: withInstalled(await refreshAllMarketplaces()) });
  } catch (err) { sendPluginError(res, err); }
});

app.post('/api/marketplaces/:id/refresh', async (req, res) => {
  const id = requireMarketplace(req, res);
  if (!id) return;
  try {
    res.json({ ok: true, marketplace: withInstalled([await syncMarketplace(id)])[0] });
  } catch (err) { sendPluginError(res, err); }
});

app.delete('/api/marketplaces/:id', (req, res) => {
  const id = requireMarketplace(req, res);
  if (!id) return;
  try {
    res.json(removeMarketplace(id));
  } catch (err) { sendPluginError(res, err); }
});

// POST /api/plugins/install { repoUrl, subdir, name, sha } — the consent point
// (§6.1). installPlugin does export -> setup -> doctor -> atomic swap -> lock,
// with cleanup on failure; the returned inventory is echoed as the UI receipt.
app.post('/api/plugins/install', async (req, res) => {
  const body = req.body || {};
  for (const k of ['repoUrl', 'name', 'sha']) {
    if (!(typeof body[k] === 'string' && body[k].trim())) return badRequest(res, `${k} is required`);
  }
  const subdir = typeof body.subdir === 'string' ? body.subdir : '';
  // A4: layer-3 option-injection guard on the install body. (?!-) rejects
  // dash-leading segments too, matching parseMarketplaceManifest exactly — no
  // defense layer may be laxer than the others.
  if (subdir && !/^(?!-)[A-Za-z0-9._-]+(\/(?!-)[A-Za-z0-9._-]+)*$/.test(subdir)) {
    return badRequest(res, 'invalid subdir');
  }
  const marketplace = typeof body.marketplace === 'string' && MARKETPLACE_ID_RE.test(body.marketplace)
    ? body.marketplace : undefined;
  try {
    const out = await installPlugin({
      repoUrl: body.repoUrl.trim(), subdir, name: body.name.trim(), sha: body.sha.trim(), marketplace,
    });
    reloadChatWorkers(body.name.trim());
    res.json(out); // { ok: true, inventory, warnings, ignored }
  } catch (err) {
    sendPluginError(res, err);
  }
});

// POST /api/plugins/:name/update — two-phase (§6.2): without { confirm: true }
// it ONLY previews (commit log + diffstat between pinned and candidate; nothing
// changes on disk); with it, updatePlugin performs export/setup/doctor/swap/lock.
app.post('/api/plugins/:name/update', async (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  try {
    if (!(req.body && req.body.confirm === true)) {
      return res.json({ preview: await fetchCandidate(name) });
    }
    const updated = await updatePlugin(name);
    reloadChatWorkers(name);
    res.json(updated);
  } catch (err) {
    sendPluginError(res, err);
  }
});

app.post('/api/plugins/:name/enable', (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  if (!req.body || typeof req.body.enabled !== 'boolean') {
    return badRequest(res, 'enabled must be a boolean');
  }
  try {
    setPluginEnabled(name, req.body.enabled);
    reloadChatWorkers(name);
    res.json({ ok: true, enabled: req.body.enabled });
  } catch (err) {
    sendPluginError(res, err);
  }
});

// DELETE /api/plugins/:name — uninstall; purge (body { purge: true } or
// ?purge=1) also removes data/ (config + secrets + state). The referenced-guard
// 409 carries the referencing list so the UI can show what blocks removal.
app.delete('/api/plugins/:name', async (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  const purge = isTruthy(req.query.purge) || !!(req.body && req.body.purge === true);
  try {
    // uninstallPlugin also drops the plugin's source bindings (core-side, so
    // the CLI's `worca plugin remove` clears them identically).
    await uninstallPlugin(name, { purge });
    reloadChatWorkers(name);
    res.json({ ok: true, purged: purge });
  } catch (err) {
    sendPluginError(res, err);
  }
});

// DELETE /api/plugins/:name/data — purge an ORPHAN's leftover data/ (config +
// secrets + state). requirePlugin is unusable here: orphans are by definition
// NOT in the lock. 409 while installed (purge flows through uninstall), 404
// when there is nothing to purge.
app.delete('/api/plugins/:name/data', (req, res) => {
  const name = req.params.name;
  if (!PLUGIN_NAME_RE.test(name)) return res.status(404).json({ error: 'plugin not found' });
  try {
    res.json(purgePluginData(name));
  } catch (err) {
    if (err && err.code === 'INSTALLED') return res.status(409).json({ error: err.message });
    if (err && /nothing to purge/.test(err.message || '')) return res.status(404).json({ error: err.message });
    sendPluginError(res, err);
  }
});

app.post('/api/plugins/:name/doctor', async (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  try {
    res.json(await doctorPlugin(name)); // { ok, checks: [{ id, ok, detail }] }
  } catch (err) {
    sendPluginError(res, err);
  }
});

// GET /api/plugins/:name/config -> per-source schema + redacted values. Secrets
// NEVER travel to the browser: redactedConfig replaces a stored secret with
// { set: true } (§7.6).
// ?profile=<id> selects which configuration to echo (multi-profile sources);
// absent = the default bucket, which is all a single-profile source ever uses.
app.get('/api/plugins/:name/config', (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  const manifest = readInstalledManifest(name);
  if (!manifest) return res.status(409).json({ error: 'plugin manifest unreadable — run doctor' });
  const wanted = typeof req.query.profile === 'string' && req.query.profile ? req.query.profile : null;
  if (wanted && !isValidProfileId(wanted)) return badRequest(res, 'invalid profile id');
  try {
    const profiles = listProfiles(name);
    const sources = (manifest.taskSources || []).map((s) => {
      // For a multi-profile source, "which profile" is a real choice: echo the
      // requested one, else the first in the roster. A source with no profiles
      // yet has nothing to show — the UI's move is "create one", not a form.
      // A requested profile that is not in the roster is a caller error (a
      // typo'd URL) — echoing an empty form for it would let a Save quietly
      // create the typo as a real profile. Checked inside the map so the guard
      // only fires for sources that use profiles at all.
      if (s.multiProfile && wanted && !profiles.some((p) => p.id === wanted)) {
        throw Object.assign(new Error(`plugin "${name}" has no profile "${wanted}"`), { code: 'BAD_REQUEST' });
      }
      const profile = s.multiProfile ? (wanted || profiles[0]?.id || null) : null;
      return {
        id: s.id,
        schema: s.configSchema,
        multiProfile: s.multiProfile === true,
        profile,
        profiles: s.multiProfile ? profiles : [],
        values: s.multiProfile && !profile ? {} : redactedConfig(name, s.configSchema, profile),
      };
    });
    const channels = (manifest.chatChannels || []).map((c) => ({
      id: c.id,
      displayName: c.displayName,
      platform: c.platform,
      schema: c.configSchema,
      values: redactedConfig(name, c.configSchema),
    }));
    // Model secrets (design §9.7): same redaction contract — { set: true|false }
    // markers only, never values.
    const msSchema = modelSecretsSchema(name);
    res.json({
      sources,
      channels,
      ...(msSchema.length ? { models: { schema: msSchema, values: redactedConfig(name, msSchema) } } : {}),
    });
  } catch (err) {
    sendPluginError(res, err);
  }
});

// POST /api/plugins/:name/profiles { sourceId, id, label } — create (or relabel)
// a profile of a multi-profile source. Creating a profile is deliberately
// separate from saving into it: the roster entry must exist BEFORE the config
// form has anything to write to.
app.post('/api/plugins/:name/profiles', (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  const body = req.body || {};
  const manifest = readInstalledManifest(name);
  if (!manifest) return res.status(409).json({ error: 'plugin manifest unreadable — run doctor' });
  const source = (manifest.taskSources || []).find((s) => s.id === body.sourceId);
  if (!source) return badRequest(res, 'sourceId does not match a task source of this plugin');
  if (!source.multiProfile) return badRequest(res, `task source "${source.id}" does not support profiles`);
  if (!isValidProfileId(body.id)) {
    return badRequest(res, 'profile id must be lowercase letters, digits and dashes');
  }
  // "default" is the implicit bucket every profile-less read/write shares
  // (chat channels, model secrets, migrated legacy config). Enrolled in the
  // roster it would become deletable like any member — and deleting it wipes
  // that shared bucket. createProfile throws too; 400 with the reason here.
  if (body.id === DEFAULT_PROFILE) {
    return badRequest(res, `profile id "${DEFAULT_PROFILE}" is reserved — pick another name`);
  }
  try {
    res.json({ ok: true, profile: createProfile(name, body.id, body.label) });
  } catch (err) {
    sendPluginError(res, err);
  }
});

// DELETE /api/plugins/:name/profiles/:id?sourceId=… — drop a profile, its stored
// config/secrets/state, and every project binding that named it (a binding
// pointing at a deleted profile would otherwise resolve to nothing at run time).
// Binding cleanup is PLUGIN-wide, not per-source: deleteProfile removes the
// profile's buckets for the whole plugin, so a sibling source's binding naming
// it would dangle just the same. sourceId is still required — it authorizes the
// call against a source that actually uses profiles.
app.delete('/api/plugins/:name/profiles/:id', (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  const manifest = readInstalledManifest(name);
  if (!manifest) return res.status(409).json({ error: 'plugin manifest unreadable — run doctor' });
  const sourceId = typeof req.query.sourceId === 'string' ? req.query.sourceId : '';
  const sources = manifest.taskSources || [];
  const source = sources.find((s) => s.id === sourceId) || (sources.length === 1 ? sources[0] : null);
  if (!source) return badRequest(res, 'sourceId does not match a task source of this plugin');
  // Mirror the POST guard: a single-profile source only has the implicit
  // 'default' bucket, and deleting THAT would wipe its entire config/secrets/
  // state. Same for ids not in the roster — deleteProfile would still drop
  // whatever buckets happen to share the id (e.g. migrated legacy data under
  // 'default'), so only roster members are deletable.
  if (!source.multiProfile) return badRequest(res, `task source "${source.id}" does not support profiles`);
  if (!isValidProfileId(req.params.id)) return badRequest(res, 'invalid profile id');
  // Reserved even if a pre-reservation roster enrolled it: deleting "default"
  // would strip the shared bucket (chat-channel config, model secrets,
  // migrated legacy data) out of all three files.
  if (req.params.id === DEFAULT_PROFILE) {
    return badRequest(res, `profile id "${DEFAULT_PROFILE}" is reserved — it cannot be deleted`);
  }
  if (!listProfiles(name).some((p) => p.id === req.params.id)) {
    return badRequest(res, `plugin "${name}" has no profile "${req.params.id}"`);
  }
  try {
    deleteProfile(name, req.params.id);
    const unbound = clearBindingsForProfile(name, req.params.id);
    res.json({ ok: true, unbound });
  } catch (err) {
    sendPluginError(res, err);
  }
});

// PUT /api/plugins/:name/config { sourceId | channelId, values, profile? } ->
// writePluginConfig routes secret:true keys to data/secrets.json (0600,
// atomic). Request values are NEVER logged and NEVER echoed back (the response
// is a bare receipt). A channelId save also hot-restarts the channel worker.
app.put('/api/plugins/:name/config', (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  const body = req.body || {};
  if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
    return badRequest(res, 'values must be an object');
  }
  const manifest = readInstalledManifest(name);
  if (!manifest) return res.status(409).json({ error: 'plugin manifest unreadable — run doctor' });
  // { target: 'modelSecrets', values } writes the plugin-level model secrets
  // (design §9.7) — same write-only semantics, routed by the synthesized schema.
  if (body.target === 'modelSecrets') {
    const schema = modelSecretsSchema(name);
    if (!schema.length) return badRequest(res, 'plugin declares no modelSecrets');
    try {
      writePluginConfig(name, schema, body.values);
      return res.json({ ok: true });
    } catch (err) {
      return sendPluginError(res, err);
    }
  }
  let schema;
  let source = null;
  let profile = null;
  if (typeof body.channelId === 'string' && body.channelId) {
    const channel = (manifest.chatChannels || []).find((c) => c.id === body.channelId);
    if (!channel) return badRequest(res, 'channelId does not match a chat channel of this plugin');
    schema = channel.configSchema;
  } else {
    const sources = manifest.taskSources || [];
    const sourceId = typeof body.sourceId === 'string' && body.sourceId
      ? body.sourceId
      : (sources.length === 1 ? sources[0].id : '');
    source = sources.find((s) => s.id === sourceId);
    if (!source) return badRequest(res, 'sourceId does not match a task source of this plugin');
    profile = typeof body.profile === 'string' && body.profile ? body.profile : null;
    if (profile && !isValidProfileId(profile)) return badRequest(res, 'invalid profile id');
    if (source.multiProfile && !profile) return badRequest(res, 'profile is required for this task source');
    // Saves go only into EXISTING roster members — mirroring the GET guard,
    // whose whole point is that a Save must not quietly mint a typo'd (or
    // just-deleted) id as a real profile with secrets stored under it.
    // Creation stays solely on POST /profiles.
    if (source.multiProfile && !listProfiles(name).some((p) => p.id === profile)) {
      return badRequest(res, `plugin "${name}" has no profile "${profile}" — create it first`);
    }
    schema = source.configSchema;
  }
  try {
    writePluginConfig(name, schema, body.values, profile);
    reloadChatWorkers(name);
    res.json({ ok: true });
  } catch (err) {
    sendPluginError(res, err);
  }
});

// GET /api/plugins/:name/model-env?id=<modelId> — the RAW manifest env of one
// plugin model, for the Models view "Edit a copy" prefill (design §9.6).
// Literals and ${VAR} ref text return verbatim (they came from a shared repo,
// not this user's secrets); {secret} placeholders are NEVER resolved — their
// env keys are listed in `secretKeys` so the editor renders empty rows.
app.get('/api/plugins/:name/model-env', (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  const model = listPluginModels().find((m) => m.plugin === name && m.id.toLowerCase() === id.toLowerCase());
  if (!model) return badRequest(res, `plugin "${name}" provides no model ${JSON.stringify(id)}`);
  const env = {};
  const secretKeys = [];
  for (const [k, v] of Object.entries(model.env ?? {})) {
    if (typeof v === 'string') env[k] = v;
    else secretKeys.push(k);
  }
  // `cost` rides along so "Edit a copy" starts from the plugin's pricing — a
  // copy that silently dropped it would repay the CLI's by-name figure.
  res.json({
    id: model.id, label: model.label, efforts: model.efforts, env, secretKeys,
    ...(model.cost ? { cost: model.cost } : {}),
  });
});

// ---------------------------------------------------------------------------
// /api/source-bindings -> which PROFILE of a task source a project/workspace
// pulls from. Set once per project; every run then resolves it silently, which
// is the point — a per-run dropdown is how you start a pipeline against the
// wrong tracker without noticing (see src/core/source-bindings.mjs).
// ---------------------------------------------------------------------------

/** Shared scope parsing for the two binding routes. Accepts a project by key or
 *  by path (the New Pipeline form knows the path, the Projects view the key). */
function bindingScope(q = {}) {
  const workspaceId = typeof q.workspaceId === 'string' && q.workspaceId.trim() ? q.workspaceId.trim() : '';
  if (workspaceId) return { scopeType: 'workspace', scopeKey: workspaceId };
  const key = typeof q.projectKey === 'string' && q.projectKey.trim() ? q.projectKey.trim() : '';
  if (key) return { scopeType: 'project', scopeKey: key };
  const dir = typeof q.projectDir === 'string' && q.projectDir.trim() ? q.projectDir.trim() : '';
  if (dir) return { scopeType: 'project', scopeKey: projectKey(path.resolve(dir)) };
  return null;
}

// GET /api/source-bindings?projectDir=…|projectKey=…|workspaceId=…
//   [&plugin=&sourceId=] -> { bindings: [...] } or, when a source is named,
//   the RESOLVED profile for it: { profile, via, candidates? }.
app.get('/api/source-bindings', async (req, res) => {
  const scope = bindingScope(req.query);
  if (!scope) return badRequest(res, 'projectDir, projectKey or workspaceId is required');
  const plugin = typeof req.query.plugin === 'string' ? req.query.plugin.trim() : '';
  const sourceId = typeof req.query.sourceId === 'string' ? req.query.sourceId.trim() : '';
  try {
    if (!plugin || !sourceId) return res.json({ ...scope, bindings: listBindingsForScope(scope.scopeType, scope.scopeKey) });
    // A workspace with no binding of its own inherits from its members when they
    // agree, so the member keys have to be resolved before asking.
    let memberKeys;
    if (scope.scopeType === 'workspace') {
      const ws = await readWorkspace(scope.scopeKey);
      memberKeys = ws ? ws.projectKeys : [];
    }
    res.json({
      ...scope,
      ...resolveProfile({ ...scope, plugin, sourceId, memberKeys, available: listProfileIds(plugin) }),
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// PUT /api/source-bindings { projectDir|projectKey|workspaceId, plugin,
//   sourceId, profile } — profile:null clears the binding.
app.put('/api/source-bindings', (req, res) => {
  const body = req.body || {};
  const scope = bindingScope(body);
  if (!scope) return badRequest(res, 'projectDir, projectKey or workspaceId is required');
  const plugin = typeof body.plugin === 'string' ? body.plugin.trim() : '';
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : '';
  if (!plugin || !sourceId) return badRequest(res, 'plugin and sourceId are required');
  const ref = { ...scope, plugin, sourceId };
  try {
    if (body.profile === null || body.profile === '') {
      clearBinding(ref);
      return res.json({ ok: true, ...scope, profile: null });
    }
    if (!isValidProfileId(body.profile)) return badRequest(res, 'invalid profile id');
    // Binding to a profile that does not exist would resolve to nothing at run
    // time — reject it here, where the user can still see why.
    if (!listProfileIds(plugin).includes(body.profile)) {
      return badRequest(res, `plugin "${plugin}" has no profile "${body.profile}"`);
    }
    res.json({ ok: true, ...scope, profile: setBinding(ref, body.profile) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// /api/sources* -> task-source discovery + browser-driven connector calls.
// ---------------------------------------------------------------------------
app.get('/api/sources', (req, res) => {
  try {
    res.json({ sources: listTaskSources() }); // builtins + enabled plugin sources
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/sources/call { plugin, sourceId, op, args } — the New Pipeline
// pane's data channel (task-browser search, remote-select options, Test
// connection). op is ALLOWLISTED: the three interface ops + the ops this
// source's manifest names in inputs[].optionsFrom. Anything else (reportResult,
// arbitrary strings) is a 400 — the browser must not drive unadvertised
// connector code paths.
// Error convention: HTTP status = caller correctness (400/404, route style);
// connector outcomes ride the 200 envelope { ok:false, error:{kind,message} }
// because an expired token is a RESULT the pane renders inline (kind-keyed
// message + retry) — matching the contract's { ok, result } shape.
app.post('/api/sources/call', async (req, res) => {
  const body = req.body || {};
  for (const k of ['plugin', 'sourceId', 'op']) {
    if (!(typeof body[k] === 'string' && body[k].trim())) return badRequest(res, `${k} is required`);
  }
  const { plugin, sourceId, op } = body;
  const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};
  if (!PLUGIN_NAME_RE.test(plugin) || !readPluginsLock()[plugin]) {
    return res.status(404).json({ error: 'plugin not found' });
  }
  const manifest = readInstalledManifest(plugin);
  const source = manifest && (manifest.taskSources || []).find((s) => s.id === sourceId);
  if (!source) return res.status(404).json({ error: 'task source not found' });
  const allowed = new Set(['listTasks', 'getTask', 'validateConfig']);
  for (const input of source.inputs || []) {
    if (input && typeof input.optionsFrom === 'string' && input.optionsFrom) allowed.add(input.optionsFrom);
  }
  if (!allowed.has(op)) return badRequest(res, `op "${op}" is not allowed for this source`);
  const profile = typeof body.profile === 'string' && body.profile ? body.profile : null;
  if (profile && !isValidProfileId(profile)) return badRequest(res, 'invalid profile id');
  if (source.multiProfile && !profile) return badRequest(res, 'profile is required for this task source');
  // Same submit-time guards as /api/run: a deleted profile must 400 here, not
  // fail deep in the connector against an empty bucket, and a profile on a
  // single-profile source would read (and persist state into) a phantom
  // bucket instead of the real config.
  if (source.multiProfile && !listProfileIds(plugin).includes(profile)) {
    return badRequest(res, `plugin "${plugin}" has no profile "${profile}"`);
  }
  if (!source.multiProfile && profile) {
    return badRequest(res, `task source "${sourceId}" does not use profiles — omit profile`);
  }
  try {
    const result = await callSource({ plugin, sourceId, op, args, profile });
    res.json({ ok: true, result });
  } catch (err) {
    if (err instanceof PluginOpError) {
      return res.json({ ok: false, error: { kind: err.kind, message: err.message } });
    }
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/pipelines/:id/report-result — manual write-back retry (§7.5). The
// automatic write-back never blocks 'done'; this is the results-view retry
// button. readPipelineForResume is a pure read-by-id (artifacts.mjs) -> clean
// 404 before delegating to retryWriteback (sources.mjs, Task 13), which itself
// never throws for connector failures.
app.post('/api/pipelines/:id/report-result', async (req, res) => {
  try {
    if (!readPipelineForResume(req.params.id)) {
      return res.status(404).json({ error: 'pipeline not found' });
    }
    res.json(await retryWriteback(req.params.id)); // { ok:true, skipped?:true } | { ok:false, error: string }
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/pipelines/:id/report — the metadata-only run report a user can paste
// into a GitHub issue. buildRunReport is a pure read-by-id (run-report.mjs) that
// resolves BOTH project and workspace runs, so this one route covers both families
// and needs no /api/workspaces twin. POST, not GET: the body carries the reporter's
// free text and the three opt-in flags, which do not belong in a logged URL.
// Worca makes NO network call here — it returns a URL the browser opens.
// Like its report-result neighbour above, a malformed id 404s rather than 400s: a
// stale bookmark must read as not-found (see resolveRunScope, :2006).

// The repo `gh issue create` targets, from the SAME bugs.url the prefilled link uses
// (APP_INFO.bugsUrl, which falls back to <repo>/issues). Empty for a non-github.com
// bugs.url, which makes /report-issue degrade to the browser link.
const BUGS_SLUG = repoSlugFromBugsUrl(APP_INFO.bugsUrl);

/**
 * The preamble both report routes share: validate the reason, build the payload.
 * Returns null after ALREADY answering `res` (400 or 404), so callers just bail.
 */
async function reportPayloadOr(res, req) {
  const body = req.body || {};
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!REPORT_REASON_IDS.includes(reason)) {
    badRequest(res, `reason must be one of: ${REPORT_REASON_IDS.join(', ')}`);
    return null;
  }
  const payload = await buildRunReport(req.params.id, {
    reason,
    expectation: typeof body.expectation === 'string' ? body.expectation : '',
    include: body.include,
  });
  if (!payload) {
    res.status(404).json({ error: 'pipeline not found' });
    return null;
  }
  return payload;
}

/** The browser fallback: a prefilled issues/new URL plus the download filename. */
function prefilledIssue(payload) {
  return { ...buildIssueUrl(payload, { bugsUrl: APP_INFO.bugsUrl }), filename: reportFilename(payload) };
}

app.post('/api/pipelines/:id/report', async (req, res) => {
  try {
    const payload = await reportPayloadOr(res, req);
    if (!payload) return;
    res.json({ payload, issue: prefilledIssue(payload) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/pipelines/:id/report-issue — the same report, but worca FILES it through
// `gh issue create` instead of handing the browser a prefilled link. That exists
// because the link cannot carry the report: a prefilled `body=` dies at ~8 KB encoded
// and half of all real runs serialize larger than that, so the browser path can only
// ever ask the reporter to paste the JSON in by hand. A --body-file has no such cap.
//
// The payload is REBUILT here from the run id; the client's copy is never accepted.
// The redaction contract (run-report.mjs) has exactly one enforcement point, and a
// route that trusted a posted payload would be a second, weaker one.
//
// A gh failure is a 200 with ok:false, not a 5xx: the response carries the prefilled
// link so the modal can degrade to today's copy-and-paste flow in one round trip.
app.post('/api/pipelines/:id/report-issue', async (req, res) => {
  try {
    const payload = await reportPayloadOr(res, req);
    if (!payload) return;
    const filed = await createIssue({
      repo: BUGS_SLUG,
      title: issueTitle(payload),
      body: renderIssueBodyFull(payload),
    });
    if (filed.ok) return res.json({ ok: true, url: filed.url, labeled: filed.labeled });
    res.json({ ok: false, kind: filed.kind, error: filed.error, issue: prefilledIssue(payload) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Install logic (mirrors tools/install.mjs): copy agents/*.md and
// skills/worca/** into <projectDir>/.claude/...
// ---------------------------------------------------------------------------
async function installAgents(projectDir) {
  const claudeDir = path.join(projectDir, '.claude');
  const agentsTarget = path.join(claudeDir, 'agents');
  const skillTarget = path.join(claudeDir, 'skills', 'worca');
  await fsp.mkdir(agentsTarget, { recursive: true });
  await fsp.mkdir(skillTarget, { recursive: true });

  const copied = [];

  // Copy agents/*.md
  if (fs.existsSync(AGENTS_DIR)) {
    const entries = await fsp.readdir(AGENTS_DIR);
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const from = path.join(AGENTS_DIR, name);
      const to = path.join(agentsTarget, name);
      await fsp.copyFile(from, to);
      copied.push(path.relative(projectDir, to));
    }
  }

  // Copy skills/worca/** recursively
  const skillSrc = path.join(SKILLS_DIR, 'worca');
  if (fs.existsSync(skillSrc)) {
    await copyDir(skillSrc, skillTarget, projectDir, copied);
    // Personalize the copied SKILL.md so /worca targets this repo's path.
    await rewriteSkillRepoPath(skillTarget, PROJECT_ROOT);
  }

  return {
    ok: true,
    target: claudeDir,
    copied,
    hint: 'Open Claude Code in this folder and run: /worca <prompt>',
  };
}

/**
 * Rewrite the `<WORCA_REPO>` placeholder in an installed SKILL.md to this repo's
 * absolute path. Best-effort; never throws.
 */
async function rewriteSkillRepoPath(skillTarget, repoRoot) {
  const skillMd = path.join(skillTarget, 'SKILL.md');
  try {
    const original = await fsp.readFile(skillMd, 'utf8');
    const rewritten = original.split('<WORCA_REPO>').join(repoRoot);
    if (rewritten !== original) await fsp.writeFile(skillMd, rewritten, 'utf8');
  } catch {
    /* no SKILL.md or unreadable — skip */
  }
}

async function copyDir(srcDir, destDir, baseForRel, copiedOut) {
  await fsp.mkdir(destDir, { recursive: true });
  const entries = await fsp.readdir(srcDir, { withFileTypes: true });
  for (const ent of entries) {
    const from = path.join(srcDir, ent.name);
    const to = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      await copyDir(from, to, baseForRel, copiedOut);
    } else if (ent.isFile()) {
      await fsp.copyFile(from, to);
      copiedOut.push(path.relative(baseForRel, to));
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
/**
 * Decode uploaded extra files ([{ name, dataBase64 }]) to a per-run temp dir and
 * return absolute paths. Filenames are reduced to their basename to prevent
 * path traversal. Returns [] when nothing usable was provided.
 * @param {string} runId
 * @param {Array<{name?:string, dataBase64?:string}>} list
 * @returns {Promise<string[]>}
 */
async function writeExtras(runId, list, dirOverride = null) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const dir = dirOverride || path.join(os.tmpdir(), `orchestrator-extras-${runId}`);
  await fsp.mkdir(dir, { recursive: true });
  const out = [];
  let i = 0;
  for (const item of list) {
    i += 1;
    if (!item || typeof item !== 'object') continue;
    const data = typeof item.dataBase64 === 'string' ? item.dataBase64 : '';
    if (!data) continue;
    // Sanitize to a bare filename; fall back to a generated name.
    let name = path.basename(String(item.name || '').trim());
    if (!name || name === '.' || name === '..') name = `extra-${i}`;
    const dest = path.join(dir, name);
    try {
      await fsp.writeFile(dest, Buffer.from(data, 'base64'));
      out.push(dest);
    } catch {
      /* skip a file we cannot decode/write */
    }
  }
  return out;
}

function isTruthy(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

// ---------------------------------------------------------------------------
// /api/chat* -> channel worker status + test delivery (design §4.8). Prefs ride
// GET/POST /api/settings; per-plugin channel CONFIG rides /api/plugins/:name/config.
// ---------------------------------------------------------------------------
app.get('/api/chat/status', (_req, res) => {
  try {
    res.json({ channels: channelHost.status() });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/chat/test', async (req, res) => {
  const { plugin, channelId } = req.body || {};
  if (!plugin || !channelId) return badRequest(res, 'plugin and channelId are required');
  try {
    res.json(await chatNotifier.sendTest(plugin, channelId, renderTest()));
  } catch (err) {
    // Connector-outcome convention: caller correctness -> HTTP status; delivery
    // outcomes ride a 200 envelope elsewhere, but a missing channel/config is
    // the caller's mistake here.
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// SPA fallback: any unmatched GET that is not an /api or /ws path serves
// index.html. Implemented as middleware (not a route pattern) so it does not
// depend on path-to-regexp wildcard syntax, which differs between Express 4
// and Express 5.
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) return next();
  if (req.path === '/vendor' || req.path.startsWith('/vendor/')) return next();
  sendIndex(res);
});

// ---------------------------------------------------------------------------
// The LAST middleware, and the only GLOBAL error handler (`/vendor` keeps its
// own path-scoped one): every failure answers { error } as JSON (MIN-108).
// Without it express's default handler renders an HTML page carrying the thrown
// stack — absolute node_modules paths included — for the two failures that happen
// BEFORE any route runs: a malformed JSON body and a body past the cap. The
// four-argument signature is what makes express treat this as an error handler,
// so `next` stays even though only the headers-sent path uses it.
// ---------------------------------------------------------------------------
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);            // let express abort the stream
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'malformed JSON body' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'request body too large' });
  // Anything else: honour a body-parser 4xx (charset.unsupported / encoding.unsupported
  // are 415, request.aborted is 400) — a client error logged as a 500 misleads. Ours or
  // not, it is one line, no stack, never HTML.
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  return res.status(status).json({ error: err && err.message ? err.message : 'internal error' });
});

/**
 * Boot maintenance, in the PINNED order (§8.12):
 *   1. reconcileStaleRunning — stamps every stale `running` row -> `interrupted`,
 *   2. sweepRunRoots        — reclaims <worcaHome>/runs/* of finished/crashed runs,
 *   3. sweepLegacyWorktrees — over every REGISTERED project, prunes the
 *      <projectDir>/.worca-cc/worktrees/* the flip to detached run roots left behind.
 *
 * The order is load-bearing, not cosmetic: `interrupted` is a KEEP status for BOTH
 * sweeps, so reconciling first is what stops the very boot that made a crashed run
 * resumable from deleting the checkout it would resume. Reversed, a stale `running`
 * row is still `running` — also KEEP — and the sweeps are merely no-ops: safe but
 * useless.
 *
 * Both sweeps' DB lookups (`runRootSweepLookups` / `legacySweepLookups`, artifacts.mjs)
 * THROW on a DB failure rather than reporting "no row", and each sweep turns that into
 * a SKIPPED candidate in `failed`. An unopenable sqlite file can therefore never be
 * read as "every run was deleted, reclaim them all".
 *
 * Exported (and returning its dispositions) so the order and the legacy sweep's
 * registry fan-out are testable without spawning a server. Fire-and-forget at boot:
 * everything up to the first `await` — including the reconcile — still runs before
 * `server.listen`, exactly as it did when this was an inline block.
 *
 * @param {{log?: (scope:'run-root'|'legacy'|'ask-worktrees', level:string, msg:string) => void}} [args]
 *        optional sink for the per-candidate lines both sweeps emit; omitted, each
 *        sweep keeps its own console default.
 */
export async function bootMaintenance({ log } = {}) {
  const summary = { reconciled: 0, sweptV1: 0, runRoots: null, legacy: null, ask: null, askWorktrees: null, bench: null };
  const sink = (scope) => (typeof log === 'function' ? (level, msg) => log(scope, level, msg) : undefined);

  // Runs left 'running' by a previous process that died before writing a terminal
  // status (crash/kill/restart). At boot this process owns no live runs.
  try {
    const { reconciled } = reconcileStaleRunning({ liveIds: [] });
    summary.reconciled = reconciled;
    if (reconciled) console.log(`[worca-ui] reconciled ${reconciled} stale running record(s) -> interrupted`);
  } catch (err) {
    console.error(`[worca-ui] stale-run reconcile failed: ${err && err.message ? err.message : err}`);
  }

  // A DB stamped past 24 by a divergent ladder can still hold v1 resume points
  // (crash-reconciled runs keep theirs). One idempotent sweep per boot.
  try {
    const swept = sweepV1Runs();
    summary.sweptV1 = swept.length;
    if (swept.length) console.log(`[worca-ui] retired ${swept.length} run(s) paused on the v1 engine`);
  } catch (err) {
    console.error(`[worca-ui] v1-run sweep failed: ${err && err.message ? err.message : err}`);
  }

  try {
    const r = await sweepRunRoots({
      worcaHome: worcaHome(), ...runRootSweepLookups(), log: sink('run-root'),
    });
    summary.runRoots = r;
    if (r.removed.length || r.quarantined.length) {
      console.log(`[worca-ui] run-root sweep: kept ${r.keep.length}, removed ${r.removed.length}, quarantined ${r.quarantined.length}`);
    }
    if (r.failed.length) {
      console.error(`[worca-ui] run-root sweep: ${r.failed.length} run root(s) SKIPPED — run-root lookup failed; nothing was removed`);
      for (const w of r.warnings) console.error(`[worca-ui]   ${w}`);
    }
  } catch (err) {
    console.error(`[worca-ui] run-root sweep failed: ${err && err.message ? err.message : err}`);
  }

  // The one-time legacy sweep (§6 Phase 7). A TOTAL no-op while the effective mode is
  // `legacy` — under legacy those paths hold every live and every paused run, so
  // sweeping them would make the documented §10 rollback self-destroying. The mode is
  // read ONCE, here, so the legacy default costs not even a DB read.
  try {
    const mode = runRootMode();
    if (mode !== 'detached') {
      summary.legacy = { skipped: true, projects: 0, keep: [], removed: [], quarantined: [], failed: [], warnings: [] };
    } else {
      const projects = await listProjects();
      const r = await sweepLegacyWorktreesAll(projects.map((p) => p.path), {
        mode, ...legacySweepLookups(), log: sink('legacy'),
      });
      summary.legacy = r;
      if (r.removed.length || r.quarantined.length) {
        console.log(`[worca-ui] legacy worktree sweep: kept ${r.keep.length}, removed ${r.removed.length}, quarantined ${r.quarantined.length} across ${r.projects} project(s)`);
      }
      if (r.failed.length) {
        console.error(`[worca-ui] legacy worktree sweep: ${r.failed.length} worktree(s) SKIPPED — pipelines-row lookup failed; nothing was removed`);
      }
      for (const w of r.warnings) console.warn(`[worca-ui]   ${w}`);
    }
  } catch (err) {
    console.error(`[worca-ui] legacy worktree sweep failed: ${err && err.message ? err.message : err} — nothing was removed`);
  }

  // Ask Worca (§6.2): mark turns orphaned by a restart, sweep stale empty threads.
  try {
    const interrupted = sweepStreamingMessages();
    const emptyThreads = sweepEmptyThreads();
    // A clone job lives in this process: a clone card still `cloning` from the last one can never finish.
    const clones = sweepCloningCards();
    if (clones) console.log(`[worca-ui] ask sweep: ${clones} clone card(s) interrupted by the restart`);
    summary.ask = { interrupted, emptyThreads };
    if (interrupted || emptyThreads) {
      console.log(`[worca-ui] ask sweep: ${interrupted} interrupted turn(s), ${emptyThreads} empty thread(s)`);
    }
  } catch (err) {
    summary.ask = { interrupted: 0, emptyThreads: 0 };
    console.error(`[worca-ui] ask sweep failed: ${err && err.message ? err.message : err}`);
  }

  // Ask worktrees (P4 §5): reconcile ask_worktrees rows vs on-disk checkouts
  // both ways. Three-state inside the sweep: a DB failure aborts with nothing
  // removed. `sink('ask-worktrees')` is undefined on a log-less boot, which is
  // exactly the sweep's own default — never call sink(...) directly.
  try {
    const r = await sweepAskWorktrees({ log: sink('ask-worktrees') });
    summary.askWorktrees = r;
    if (r.removedDirs || r.prunedRows) {
      console.log(`[worca-ui] ask-worktree sweep: removed ${r.removedDirs} orphan dir(s), dropped ${r.prunedRows} stale row(s)`);
    }
    if (r.failed) console.error(`[worca-ui] ask-worktree sweep: ${r.failed} candidate(s) skipped`);
  } catch (err) {
    console.error(`[worca-ui] ask-worktree sweep failed: ${err && err.message ? err.message : err}`);
  }

  // Script bench folders (workbench W11): the newest folder per script key
  // outlives its run so the output tabs can still read it; 24 h later it is
  // junk. os.tmpdir() would have been cleaned under us on macOS, hence
  // <worcaHome>/bench and this sweep.
  try {
    const removed = await sweepBenchDirs(benchRoot());
    summary.bench = { removed: removed.length };
    if (removed.length) console.log(`[worca-ui] bench sweep: removed ${removed.length} folder(s)`);
  } catch (err) {
    summary.bench = { removed: 0 };
    console.error(`[worca-ui] bench sweep failed: ${err && err.message ? err.message : err}`);
  }
  return summary;
}

// Only bind a port when run directly (`node ui/server.mjs`). When imported by a
// test, skip listening so the test can mount `app` on its own ephemeral port.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  // Remote access fails closed: an unsafe or broken config never starts serving.
  if (REMOTE_ACCESS_CHECK.errors.length) {
    for (const e of REMOTE_ACCESS_CHECK.errors) console.error(`[worca-ui] remote access: ${e}`);
    console.error('[worca-ui] not starting. See docs/remote-access.md.');
    process.exit(1);
  }
  for (const w of REMOTE_ACCESS_CHECK.warnings) console.warn(`[worca-ui] remote access: ${w}`);

  try {
    seedBuiltinMarketplace();
  } catch (err) {
    console.error(`[worca-ui] builtin marketplace seed skipped: ${err && err.message ? err.message : err}`);
  }

  bootMaintenance().catch((err) => {
    console.error(`[worca-ui] boot maintenance failed: ${err && err.message ? err.message : err}`);
  });

  // A port that is already taken is an EXPECTED state (the UI is usually already
  // up), not a crash: one line, no stack, exit 1. `worca ui` probes the port
  // before spawning this process and prints the friendlier "already running"
  // block itself; this branch is for `node ui/server.mjs` run by hand or a race.
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`[worca-ui] port ${PORT} is already in use — is the UI already running?`);
      console.error(`[worca-ui] check with \`worca ui status\`, restart with \`worca ui restart\`, or pick a port: \`worca ui --port <n>\``);
      process.exit(1);
    }
    console.error(`[worca-ui] server error: ${err && err.message ? err.message : err}`);
  });

  // Channel workers must die with the server (design §9: persistent-process
  // hygiene). Graceful shutdown frame -> 5s grace -> SIGKILL, then exit. The
  // same path serves POST /api/shutdown (`worca ui stop`), which exits 0.
  let shuttingDown = false;
  let wroteInstanceFile = false;
  const exitCodeFor = (signal) => (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 0);
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    channelHost.stop().finally(() => process.exit(exitCodeFor(signal)));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // 'exit' handlers must be synchronous; removeUiInstance is. `ifPid` keeps an
  // old server exiting late from deleting the file a newer one just wrote.
  process.on('exit', () => { if (wroteInstanceFile) removeUiInstance({ ifPid: process.pid }); });

  server.listen(PORT, HOST, () => {
    const port = server.address().port;
    const url = uiUrl({ host: HOST, port });
    console.log(`[worca-ui] listening on ${url} (bound to ${HOST})`);
    if (REMOTE_MODE) {
      const who = identityCheck ? `identity: ${REMOTE_ACCESS.identity.provider} (${REMOTE_ACCESS.identity.teamDomain})` : 'identity: NOT CHECKED';
      console.log(`[worca-ui] remote access on for ${REMOTE_ACCESS.allowedHosts.join(', ')}; ${who}`);
    }
    uiControl.token = newUiToken();
    uiControl.onShutdown = shutdown;
    uiControl.startedAt = new Date().toISOString();
    writeUiInstance({
      pid: process.pid, host: HOST, port, token: uiControl.token,
      version: PKG_VERSION, startedAt: uiControl.startedAt,
    }).then(() => { wroteInstanceFile = true; }, (err) => {
      console.error(`[worca-ui] could not write the instance file (\`worca ui stop\` will fall back to a signal): ${err && err.message ? err.message : err}`);
    });
    try { channelHost.start(); } catch (err) {
      console.error(`[worca-ui] chat channel host failed to start: ${err && err.message ? err.message : err}`);
    }
    try { startTeamMetricsBackground({ log: (m) => console.warn(m) }); }
    catch (err) { console.warn(`[worca-ui] team metrics background: ${err?.message || err}`); }
    // Model bridge (model-bridge-design.md §4.1): up before the first bridged
    // spawn so resolveModelEnv's synchronous start is the exception, not the rule.
    startBridge({ log: (m) => console.warn(m) }).catch((err) => console.warn(`[worca-ui] model bridge: ${err?.message || err}`));
    // Team policy discovery (design §9), then the marketplace seeding a policy asks for — metadata
    // only (a git archive), never an install; installs go through the setup checklist.
    try {
      startTeamPolicyBackground({
        log: (m) => console.warn(m),
        onTick: async () => {
          const scopes = await listPolicyScopes();
          const docs = [];
          for (const s of scopes.projects) if (s.home && !docs.some((d) => d.slug === s.home)) {
            const r = await resolveProjectPolicy(s.path, { discover: false }).catch(() => null);
            if (r?.ok) docs.push({ slug: r.home, doc: r.doc });
          }
          const seeded = await seedPolicyMarketplaces(docs);
          for (const s of seeded) if (s.added) { console.warn(`[worca-ui] team policy: added marketplace ${s.url} (asked for by ${s.homes.join(', ')})`); emitChanged('plugins-changed', 'marketplace-seeded'); }
        },
      });
    } catch (err) { console.warn(`[worca-ui] team policy background: ${err?.message || err}`); }
    // Scheduled runs: boot catch-up + the 30 s tick (the server IS the scheduler).
    try { startScheduler(); } catch (err) { console.warn(`[worca-ui] scheduler: ${err?.message || err}`); }
  });
}

export { app, server, runs };
export const _testing = {
  wireRun, wireScan, summarizeRuns, startScan, wireAgentGen, startAgentGen, wireScriptBench, startScriptBench,
  chatActions, chatRouter, channelHost, handleChatInbound, enqueueChatWork, answerRun,
  chatNotifier, resumeRun, resolveHljsAssets, resolveEsmAsset, askJobs, askFollowers, askDeleting, resolveAskContext, flipCard,
  startCloneJob, followCloneCard, CLONE_JOBS,
  emitDiffCommentsChanged, emitAskWorktrees, askWorktreesEnvelope, deleteAskThreadFully,
  askTrackRun, liveRunEntry, liveDefragRun, memoryScopeKey, startRunHandler, emitMemoryChanged, askSystemPromptFor,
  uiControl, bearerMatches,
  broadcast, askFilesRunDir,
};
