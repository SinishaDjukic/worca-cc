// worca-cc UI client. Vanilla ESM, no framework, no build step.

const $ = (sel, root = document) => (root || document).querySelector(sel);
const $$ = (sel, root = document) => [...(root || document).querySelectorAll(sel)];

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const state = {
  ws: null,
  wsReady: false,
  selectedRunId: '',   // focused pipeline for #running/<runId>; '' === Overview (transient, not persisted)
  helloSubscribed: new Set(), // runIds we've already sent a backfill subscribe for this socket
  projectDir: '',
  projects: [], // saved {name, path, exists} registry, loaded from /api/projects
  config: { steps: {}, customModels: [] }, // per-project model/effort selections
  models: [], // predefined + custom, from /api/config
  efforts: [], // effort levels, from /api/config
  workflowId: 'wf_default', // currently selected workflow in New Pipeline
  guardrailsId: 'permissive', // the guardrail set the next run applies ('permissive' = unrestricted default)
  guardrailSets: [], // GET /api/guardrails cache for the picker + hint
  agents: {}, // registry { [key]: AgentMeta }, lazily loaded from /api/agents
  workflowCache: {}, // { [id]: WorkflowTemplate } from GET /api/workflows/:id
  stepDefaults: {}, // { [key]: { fanOut } } sidecar defaults from /api/config steps
  agentsList: [], // GET /api/agents?all=1 list for the Agents management view
  channelIds: [], // known channel ids from /api/agents (drives the agent editor)
  historyAll: [],    // full /api/history dataset; client-side filter cache
  historyFilter: '', // active projectKey filter for History; '' === All Projects
  ghAvailable: false,// gh CLI availability, from the last /api/history load

  // --- Workspaces ---
  workspaces: [],            // GET /api/workspaces read-model
  selectedWorkspaceId: '',   // '' === none; set ONLY in workspace target mode
  runTarget: 'project',      // 'project' | 'workspace' — New Pipeline target toggle
  // --- Creation wizard (ephemeral; reset on wizard close) ---
  wizard: {
    step: 1, name: '', selectedPaths: [], scanId: '', description: '',
    graphifyUsed: null, abort: null, editingId: '',
  },
  // --- Agent creation wizard (ephemeral; reset on wizard close) ---
  agentWizard: { step: 1, genId: '', abort: null, draft: null, ownMd: false },
  // --- Pluggable task sources (New Pipeline) ---
  pluginSources: [],        // GET /api/sources entries with type:'plugin'
  activePluginSource: null, // selected plugin source | null (legacy prompt/markdown)
};

import {
  topology,
  metaLine,
  distinctAgents,
  defaultTopologyFromTemplate,
  mergePalette,
  canConnect,
  EMBEDDED_AGENTS,
  groupPaletteByDomain,
} from './composer-core.mjs';
import { logLineClass, logLineTime, serializeLog, cycleSeparatorBefore, projectLogRecord } from './log-line.mjs';
import { logLineVisible, logFacets, compileLogFilter } from './log-filter.mjs';
// Import list only — `statusChip`/`diffBadges`/`mergeFindings`/`reportResultControl`
// lost their last app.js caller with the retired card accordion. They stay EXPORTED
// from results-view.mjs (test/results-view-helpers.test.mjs imports four of them).
import { sourceBadge, workflowPickerLabel } from './results-view.mjs';
import { splitPatchSections, parseFileSection, patchIndex, sectionKey } from './diff-view.mjs';
import {
  renderPluginList, renderInstallConsent, renderUpdatePreview,
  renderConfigForm, collectConfigForm, renderDoctorReport, renderReferences409,
  renderOrphanList, channelBadge, renderAvailableList, renderMarketplaceList,
} from './plugins-view.mjs';
import { renderChatSettings, collectChatSettings } from './chat-settings-view.mjs';
import {
  guardrailSummary, renderGuardrailList, renderGuardrailEditor, collectGuardrailEditor,
  renderStartStep, collectStartStep, renderGuardrailReferences409,
} from './guardrails-view.mjs';
import {
  renderModelsList, renderModelEditor, collectModelEditor, makeEnvRow, deleteRefsSummary,
  renderExportWizard, collectExportWizard,
} from './models-view.mjs';
import { renderSourcePane, collectSourcePane } from './source-pane.mjs';
import { renderStatsBody, renderBudgetIndicator, renderBudgetReadout, renderCostPauseBanner, BUDGET_WARN_AT } from './stats-view.mjs';

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------
const el = {
  form: $('#run-form'),
  projectSelect: $('#projectSelect'),
  projectHint: $('#projectHint'),
  addProject: $('#add-project'),
  newProjectName: $('#newProjectName'),
  newProjectPath: $('#newProjectPath'),
  addProjectSave: $('#addProjectSave'),
  addProjectCancel: $('#addProjectCancel'),
  addProjectMsg: $('#addProjectMsg'),
  newProjectBrowse: $('#newProjectBrowse'),
  folderBrowser: $('#folder-browser'),
  folderBrowserClose: $('#folderBrowserClose'),
  folderUp: $('#folderUp'),
  folderHome: $('#folderHome'),
  folderCurrent: $('#folderCurrent'),
  folderList: $('#folderList'),
  folderSelect: $('#folderSelect'),
  folderMsg: $('#folderMsg'),
  title: $('#title'),
  sourceBranch: $('#sourceBranch'),
  featureBranch: $('#featureBranch'),
  sourceRadios: $$('input[name="source"]'),
  promptPane: $('#prompt-pane'),
  markdownPane: $('#markdown-pane'),
  sourceSeg: $('#source-seg'),
  pluginSourcePane: $('#plugin-source-pane'),
  prompt: $('#prompt'),
  promptMarkdown: $('#promptMarkdown'),
  mdFile: $('#mdFile'),
  mdFileName: $('#mdFileName'),
  extras: $('#extras'),
  extrasNote: $('#extrasNote'),
  mock: $('#mock'),
  startBtn: $('#start-btn'),
  formMsg: $('#form-msg'),

  pipelineConfig: $('#pipeline-config'),
  configError: $('#config-error'),
  workflowSelect: $('#workflowSelect'),
  guardrailsSelect: $('#guardrailsSelect'),
  guardrailsHint: $('#guardrailsHint'),
  agentsConfig: $('#agents-config'),
  agentRows: $('#agents-rows'),
  agentsWorkflow: $('#agentsWorkflow'),
  agentsSummary: $('#agentsSummary'),
  agentsPromote: $('#agentsPromote'),
  agentsReset: $('#agentsReset'),
  wfFeedbackConfig: $('#wf-feedback-config'),
  advancedConfig: $('#advanced-config'),

  history: $('#history'),
  historyFilter: $('#historyFilter'),
  refreshHistory: $('#refresh-history'),
  histShell: $('#hist-shell'),
  histDetail: $('#hist-detail'),
  navHistoryCount: $('#nav-history-count'),
  navWorkspacesCount: $('#nav-workspaces-count'),

  // Target selector (New Pipeline)
  targetSeg: $('#target-seg'),
  targetRadios: $$('input[name="target"]'),
  targetProjectPane: $('#target-project-pane'),
  targetWorkspacePane: $('#target-workspace-pane'),
  workspaceSelect: $('#workspaceSelect'),
  wsMembers: $('#ws-members'),
  sourceBranchHint: $('#sourceBranchHint'),
  sourceBranchWrap: $('#sourceBranchWrap'),
  wsSourceBranches: $('#ws-source-branches'),

  // Workspaces management view
  wsCreateBtn: $('#ws-create-btn'),
  wsMsg: $('#ws-msg'),
  wsList: $('#ws-list'),

  // Wizard
  wizName: $('#wiz-name'),
  wizProjects: $('#wiz-projects'),
  wizStep1Hint: $('#wiz-step1-hint'),
  wizStartScan: $('#wiz-start-scan'),
  wizStatus: $('#wiz-status'),
  wizProgress: $('#wiz-progress'),
  wizPhases: $('#wiz-phases'),
  wizAbort: $('#wiz-abort'),
  wizDesc: $('#wiz-desc'),
  wizGraphifyNote: $('#wiz-graphify-note'),
  wizMsg: $('#wiz-msg'),
  wizRescan: $('#wiz-rescan'),
  wizSave: $('#wiz-save'),
  wizClose: $('#wiz-close'),
  wizTitle: $('#wiz-title'),

  viewerCard: $('#viewer-card'),
  viewerTitle: $('#viewer-title'),
  viewer: $('#viewer'),
  viewerClose: $('#viewer-close'),

  settingsRoot: $('#settingsRoot'),
  settingsProjectsRoot: $('#settingsProjectsRoot'),
  settingsProjectsRootBrowse: $('#settingsProjectsRootBrowse'),
  settingsSave: $('#settingsSave'),
  settingsReset: $('#settingsReset'),
  settingsMsg: $('#settingsMsg'),

  // Settings: budget & cost limits card
  budgetReadout: $('#budgetReadout'),
  budgetPerPipeline: $('#budgetPerPipeline'),
  budgetTotal: $('#budgetTotal'),
  budgetResetPeriod: $('#budgetResetPeriod'),
  budgetSave: $('#budgetSave'),
  budgetReset: $('#budgetReset'),
  budgetMsg: $('#budgetMsg'),

  // Agents management view
  agentsList: $('#agents-list'),
  agentsMsg: $('#agents-msg'),
  agentCreateBtn: $('#agent-create-btn'),

  // Projects management view
  projectsList: $('#projects-list'),
  projectsMsg: $('#projects-msg'),
  projectAddBtn: $('#project-add-btn'),
  navProjectsCount: $('#nav-projects-count'),

  // Reusable confirm modal
  confirmModal: $('#confirm-modal'),
  confirmTitle: $('#confirm-title'),
  confirmMessage: $('#confirm-message'),
  confirmOk: $('#confirm-ok'),
  confirmCancel: $('#confirm-cancel'),
  confirmCheckboxWrap: $('#confirm-checkbox-wrap'),
  confirmCheckbox: $('#confirm-checkbox'),
  confirmCheckboxLabel: $('#confirm-checkbox-label'),

  // Add-project modal
  projectAddModal: $('#project-add-modal'),
  projAddName: $('#proj-add-name'),
  projAddPath: $('#proj-add-path'),
  projAddBrowse: $('#proj-add-browse'),
  projAddSave: $('#proj-add-save'),
  projAddCancel: $('#proj-add-cancel'),
  projAddMsg: $('#proj-add-msg'),

  // Agent creation wizard
  agwName: $('#agw-name'),
  agwPurpose: $('#agw-purpose'),
  agwDetails: $('#agw-details'),
  agwBefore: $('#agw-before'),
  agwAfter: $('#agw-after'),
  agwOwnToggle: $('#agw-own-md-toggle'),
  agwOwnPane: $('#agw-own-md-pane'),
  agwOwnMd: $('#agw-own-md'),
  agwStart: $('#agw-start'),
  agwStatus: $('#agw-status'),
  agwAbort: $('#agw-abort'),
  agwStep1Hint: $('#agw-step1-hint'),
  agwMsg: $('#agw-msg'),
  agwSave: $('#agw-save'),
  agwRegen: $('#agw-regen'),
  agwClose: $('#agw-close'),

  // Plugins view
  pluginsList: $('#plugins-list'),
  pluginsMsg: $('#plugins-msg'),
  pluginsAvailable: $('#plugins-available'),
  marketplacesList: $('#marketplaces-list'),
  pluginAddBtn: $('#plugin-add-btn'),
  marketplaceAddRow: $('#marketplace-add-row'),
  marketplaceUrl: $('#marketplace-url'),
  marketplaceAdd: $('#marketplace-add'),
  pluginModal: $('#plugin-modal'),
  pluginModalTitle: $('#plugin-modal-title'),
  pluginModalBody: $('#plugin-modal-body'),
  pluginModalActions: $('#plugin-modal-actions'),
  pluginModalClose: $('#plugin-modal-close'),

  // Chat notifications (Settings card)
  chatSettingsHost: $('#chat-settings-host'),
  chatSettingsSave: $('#chatSettingsSave'),
  chatSettingsMsg: $('#chatSettingsMsg'),

  // Guardrails view
  guardrailsList: $('#guardrails-list'),
  guardrailsMsg: $('#guardrails-msg'),
  guardrailCreateBtn: $('#guardrail-create-btn'),

  // Models view
  modelsList: $('#models-list'),
  modelsMsg: $('#models-msg'),
  modelCreateBtn: $('#model-create-btn'),
  modelShareBtn: $('#model-share-btn'),

  // Statistics view
  statsBody: $('#stats-body'),
  statsRange: $('#stats-range'),
};

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws`;
  let ws;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  state.ws = ws;

  ws.addEventListener('open', () => {
    state.wsReady = true;
    // A reconnect yields a fresh `hello`; backfill subscribes are driven from
    // there (handleServerMessage), not re-sent here. Reset the per-socket
    // dedupe set so the new socket re-subscribes to still-live runs.
    state.helloSubscribed = new Set();
  });

  ws.addEventListener('message', (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    handleServerMessage(msg);
  });

  ws.addEventListener('close', () => {
    state.wsReady = false;
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
}

let reconnectTimer = null;
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWS();
  }, 1500);
}

// ---------------------------------------------------------------------------
// Spend indicator. One /api/budget snapshot drives the sidebar block, the
// compact topnav amount, and the New-view creation gate. Refreshed at boot, on
// every `hello`, on `budget-changed`/`pipelines-changed`, and on a slow tick.
// ---------------------------------------------------------------------------
const budgetState = { budget: null, timer: null, fetching: false };

// True between "Start clicked" and the POST /api/run settling. Any budget repaint
// landing inside that window — a `budget-changed` broadcast, an archive's
// `pipelines-changed`, another run's `done`, the slow tick — runs
// applyBudgetToNewView, which writes start.disabled unconditionally; without this
// flag such a repaint re-enables Start mid-submit and a fast second click starts
// the same run twice.
let startSubmitInFlight = false;

async function refreshBudget() {
  if (budgetState.fetching) return;
  budgetState.fetching = true;
  try {
    const res = await fetch('/api/budget');
    const data = await safeJson(res);
    if (res.ok) { budgetState.budget = data; paintBudget(); }
  } catch { /* transient */ } finally { budgetState.fetching = false; }
}

function paintBudget() {
  const b = budgetState.budget;
  const mount = document.getElementById('side-spend');
  const topAmt = document.getElementById('topnav-spend');
  if (!b) { if (topAmt) topAmt.hidden = true; return; }
  if (mount) {
    mount.replaceChildren(renderBudgetIndicator(b,
      { fmt: { usd: fmtUsd, usd4: fmtUsd4, duration: fmtDuration, estTitle } }));
  }
  if (topAmt) {
    topAmt.hidden = false;
    topAmt.textContent = fmtUsd(b.windowSpendUsd);
    topAmt.classList.toggle('warn', !b.blocked && b.totalLimitUsd != null
      && b.windowSpendUsd / b.totalLimitUsd >= BUDGET_WARN_AT);
    topAmt.classList.toggle('over', !!b.blocked);
  }
  applyBudgetToNewView();
  if (currentView() === 'settings') paintBudgetReadout();
  repaintCostBanners();
}

function applyBudgetToNewView() {
  const b = budgetState.budget;
  const note = document.getElementById('newBlockedNote');
  const start = document.getElementById('start-btn');
  if (!note || !start) return;
  const blocked = !!(b && b.blocked);
  start.disabled = blocked || startSubmitInFlight;
  note.hidden = !blocked;
  if (blocked) {
    const w = b.resetPeriod === 'weekly' ? 'week' : 'month';
    const msg = `Total budget reached — ${fmtUsd(b.windowSpendUsd)} of ${fmtUsd(b.totalLimitUsd)} ` +
      `spent this ${w}. New pipelines are blocked until ${fmtResetAtLocal(b.windowEndMs)}, ` +
      `or a higher total limit in Settings.`;
    note.textContent = msg;
    start.title = msg;
  } else {
    start.title = '';
  }
}

function fmtResetAtLocal(ms) {
  const d = new Date(ms);
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (x) => String(x).padStart(2, '0');
  return `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function startBudgetTick() {
  if (budgetState.timer) return;
  const interval = typeof window.__budgetTickMs === 'number' ? window.__budgetTickMs : 60000;
  budgetState.timer = setInterval(() => {
    const b = budgetState.budget;
    if (!b) return;
    // Refetch when spend can actually move (live runs) or the window has rolled
    // over (spend resets to $0 and blocked must clear server-side — repainting
    // the pre-reset snapshot would keep the UI "blocked" forever while idle).
    if (liveRuns().length || Date.now() >= b.windowEndMs) { refreshBudget(); return; }
    // Idle countdown: windowEndMs is the fixed anchor; the fetched msUntilReset
    // is stale by definition. Recompute the remainder, then repaint — no fetch.
    b.msUntilReset = Math.max(0, b.windowEndMs - Date.now());
    paintBudget();
  }, interval);
  budgetState.timer.unref?.();                 // no-op in browsers/jsdom (number)
}

// The indicator is re-rendered on every paint, and .side-foot sits OUTSIDE the
// <nav> that navLinks snapshots at boot — so route it from a container listener
// rather than the [data-nav] delegation.
document.getElementById('side-spend').addEventListener('click', (e) => {
  if (e.target.closest('.spend-ind')) location.hash = 'stats';
});

// ---------------------------------------------------------------------------
// Server message router. Multi-run: every run's events arrive here (the server
// broadcasts every run to every socket). Each event carries its own runId; we
// fan it out to the matching per-run model.
// ---------------------------------------------------------------------------
function handleServerMessage(msg) {
  if (!msg || !msg.type) return;

  if (msg.type === 'hello') {
    onHello(msg);
    return;
  }

  if (msg.type === 'channel-status') {
    onChannelStatus(msg);
    return;
  }

  // Scan events are tagged by scanId (not runId) and ride the same broadcast
  // socket. Handle them BEFORE the !msg.runId early-return below.
  if (msg.type === 'scan-progress' || msg.type === 'scan-done' || msg.type === 'scan-error') {
    onScanEvent(msg);
    return;
  }

  // Agent-generation events are tagged by genId (not runId) and ride the same
  // broadcast socket. Handle them BEFORE the !msg.runId early-return below.
  if (msg.type === 'agentgen-progress' || msg.type === 'agentgen-done' || msg.type === 'agentgen-error') {
    onAgentGenEvent(msg);
    return;
  }

  // History PR-enrichment batches are token-tagged (not runId-tagged) and ride the
  // same broadcast socket. Handle them BEFORE the !msg.runId early-return below.
  if (msg.type === 'history-pr') {
    onHistoryPr(msg);
    return;
  }

  // Sidebar-count mutations (pipeline delete, project/workspace create+delete) are
  // broadcast globally with NO runId. Re-read the authoritative counts; if the affected
  // view is open, also reload it so its rows reflect the change. Handle BEFORE the
  // !msg.runId early-return below.
  if (msg.type === 'pipelines-changed') {
    refreshAllCounts();
    refreshBudget();
    if (currentView() === 'history') loadHistoryView({ force: true });
    if (currentView() === 'stats') loadStatsView();
    return;
  }
  // A cost pause or a budget-key settings save moves spend/limits; the indicator
  // is global, so repaint it regardless of the open view.
  if (msg.type === 'budget-changed') {
    refreshBudget();
    return;
  }
  if (msg.type === 'projects-changed') {
    refreshAllCounts();
    if (currentView() === 'projects') loadProjectsView();
    return;
  }
  if (msg.type === 'workspaces-changed') {
    refreshAllCounts();
    if (currentView() === 'workspaces') loadWorkspacesView();
    return;
  }

  // Tagged per-run event. Ignore anything without a runId.
  if (!msg.runId) return;
  // Run birth announcement: carries the metadata hello would have sent (projectDir,
  // kind, workspace attribution, member names) so a run started by ANOTHER tab or
  // the CLI doesn't render "(no project)" until the next reload.
  if (msg.type === 'run-created') {
    upsertRun({
      runId: msg.runId,
      title: msg.title,
      projectDir: msg.projectDir,
      status: msg.status || 'starting',
      startedAt: msg.startedAt,
      kind: msg.kind || 'run',
      workspaceId: msg.workspaceId || undefined,
      projectNames: Array.isArray(msg.projectNames) && msg.projectNames.length ? msg.projectNames : undefined,
    });
    updateNavCounts();
    renderPipelineTabs();
    renderRunningView();
    return;
  }
  // A 'subagent' delta attaches to an existing run; it must never MATERIALIZE one.
  // A sub-agent with no parent run is meaningless, and auto-creating a card here is
  // exactly what produced the phantom "(untitled)" pipeline. Other event types may
  // legitimately create a card for a run this tab didn't start (CLI / another tab),
  // and `state` snapshots reconcile r.subAgents anyway, so nothing is lost.
  // Neither a sub-agent delta, a skills update, nor a question resolution may
  // MATERIALIZE a run: each only attaches to one this tab already knows. (A
  // resolution for an unknown run is meaningless, and auto-creating a card would
  // resurrect the phantom.)
  if ((msg.type === 'subagent' || msg.type === 'stepskills' || msg.type === 'stepgraphify' || msg.type === 'question-resolved') && !runs.has(msg.runId)) return;
  const r = upsertRun({ runId: msg.runId });

  switch (msg.type) {
    case 'phase':
      onPhase(r, msg);
      break;
    case 'log':
      onLog(r, msg);
      break;
    case 'question':
      onQuestion(r, msg);
      break;
    case 'question-resolved':
      onQuestionResolved(r, msg);
      break;
    case 'artifact':
      onArtifact(r, msg);
      break;
    case 'state':
      onState(r, msg);
      break;
    case 'title':
      onTitle(r, msg);
      break;
    case 'subagent':
      onSubagent(r, msg);
      break;
    case 'stepskills':
      onStepSkills(r, msg);
      break;
    case 'stepgraphify':
      onStepGraphify(r, msg);
      break;
    case 'done':
      onDone(r, msg);
      break;
    case 'error':
      onError(r, msg);
      break;
    default:
      break;
  }

  updateNavCounts();
  // If the user is already on the Running view, build/repaint cards now.
  // Without this, a run this tab didn't start (begun in another tab or via the
  // /worca CLI — the server sends `hello` only once per socket and broadcasts
  // later runs purely as tagged events) would bump the nav badge but never
  // render a card until the user navigated away and back. renderRunningView
  // diffs by data-run-id and reuses r.el, so this is cheap + idempotent.
  renderPipelineTabs();            // keep sidebar child rows + roll-up live from ANY view
  if (currentView() === 'running') renderRunningView();
}

// hello greeting carries the server's authoritative run list. We upsert each
// into our map, backfill-subscribe to non-terminal runs whose buffer we don't
// yet have, and refresh whatever view is showing.
function onHello(msg) {
  const ws = state.ws;
  const list = Array.isArray(msg.runs) ? msg.runs : [];

  if (!helloSeeded) {
    helloSeeded = true;
    for (const r0 of list) {
      if (!r0 || !r0.runId) continue;
      const terminal = isTerminalStatus(r0.status) && !r0.pendingQuestion;
      if (terminal && !lingering.has(r0.runId)) acknowledged.add(r0.runId);
    }
    persistIdSet(ACK_RUNS_KEY, acknowledged);
  }

  for (const r0 of list) {
    if (!r0 || !r0.runId) continue;
    const rr = upsertRun({
      runId: r0.runId,
      title: r0.title,
      projectDir: r0.projectDir,
      status: r0.status,
      startedAt: r0.startedAt,
      pendingQuestion: r0.pendingQuestion || null,
      kind: r0.kind || 'run',
      pipelineId: r0.pipelineId || null,
      pauseReason: r0.pauseReason || null,
      workspaceId: r0.workspaceId || undefined,
      projectNames: Array.isArray(r0.projectNames) && r0.projectNames.length ? r0.projectNames : undefined,
    });
    // Seed the run's stepper from the hello summary so the live card resolves
    // sub-agents to their real (s0_0-keyed) nodes BEFORE any subagent delta paints
    // — closing the window where r.stepper is null and the graph falls back to the
    // legacy default (mismatched ids → no squares + a raw "s0_0" dropdown group).
    if (r0.stepper && rr.stepper == null) {
      rr.stepper = r0.stepper;
      if (rr.el) rebuildStepperDom(rr);
    }

    const nonTerminal =
      r0.status === 'starting' || r0.status === 'running' || r0.status === 'pausing' ||
      r0.status === 'paused' || (r0.pendingQuestion != null);
    // Backfill that run's buffered events exactly once per socket. (A paused run
    // is included so a reload replays its buffered log + last state snapshot —
    // otherwise its card shows no logs, no branch, and no frontier until resume.)
    // (Runs started
    // by THIS tab already stream live via broadcast and were not in any prior
    // hello, so they get subscribed here only if a reconnect re-lists them.)
    if (nonTerminal && ws && state.wsReady && !state.helloSubscribed.has(r0.runId)) {
      state.helloSubscribed.add(r0.runId);
      try {
        ws.send(JSON.stringify({ type: 'subscribe', runId: r0.runId }));
      } catch {
        /* ignore */
      }
    }
    // Terminal runs (done|error|stopped) are simply excluded from liveRuns().
  }

  refreshAllCounts();
  refreshBudget();
  const cur = currentView();
  if (cur === 'running') renderRunningView();
  // Background-load history on the first connect so the sidebar count + PR states
  // populate even when boot lands on another view (e.g. New pipeline). Reconnects
  // skip this; an open History view still re-loads to refresh its data.
  if (cur === 'history' || !historyBooted) loadHistoryView();
  historyBooted = true;
}

function parseHash() {
  const raw = location.hash.slice(1);
  const i = raw.indexOf('/');
  return i === -1 ? [raw, ''] : [raw.slice(0, i), raw.slice(i + 1)];
}
function currentView() {
  const [view] = parseHash();
  return VIEW_NAMES.includes(view) ? view : 'new';
}

// ---------------------------------------------------------------------------
// Steps tracker
// ---------------------------------------------------------------------------

// Normalize a core phase name to one of our tracker step keys.
// Order matters: more specific phases ("refine", "review", "implement") are
// matched before the generic "plan"/"clarify" fallback, because names like
// "plan-refine" contain the substring "plan".
function normalizePhase(phase) {
  if (!phase) return null;
  const p = String(phase).toLowerCase();
  if (p.includes('preflight')) return 'preflight';
  if (p.includes('manual-web')) return 'manual-web';
  if (p.includes('manual-checklist') || p.includes('manual-test')) return 'manual-checklist';
  if (p.includes('refine')) return 'refine';
  if (p.includes('review')) return 'review';
  if (p.includes('implement')) return 'implement';
  if (p.includes('done') || p.includes('complete') || p.includes('finish')) return 'done';
  if (p.includes('clarify')) return 'clarify';
  if (p.includes('plan')) return 'plan';
  return null;
}

// Legacy default stepper, used when a run predates state.stepper (old history)
// or before the first 'state' event arrives. Node ids = uiPhase keys so old
// per-step costs/durations (bucketed by phase) still attribute correctly.
const CLIENT_DEFAULT_STEPPER = {
  version: 1,
  steps: [
    { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
    { kind: 'agents', nodes: [{ id: 'clarify',   uiPhase: 'clarify',   label: 'Clarify',   color: 'red',    cycles: false }] },
    { kind: 'agents', nodes: [{ id: 'plan',      uiPhase: 'plan',      label: 'Plan',      color: 'violet', cycles: false }] },
    { kind: 'agents', nodes: [{ id: 'refine',    uiPhase: 'refine',    label: 'Refine',    color: 'green',  cycles: true  }] },
    { kind: 'agents', nodes: [{ id: 'implement', uiPhase: 'implement', label: 'Implement', color: 'amber',  cycles: false }] },
    { kind: 'agents', nodes: [{ id: 'review',    uiPhase: 'review',    label: 'Review',    color: 'blue',   cycles: true  }] },
    { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
  ],
  feedbacks: [],
};

// Pick the manifest to render: prefer a persisted/emitted one, else the legacy
// default. Defensive against malformed shapes.
function manifestFor(stepper) {
  if (stepper && Array.isArray(stepper.steps) && stepper.steps.length) return stepper;
  return CLIENT_DEFAULT_STEPPER;
}

// Stable node-id signature of a manifest. Used to detect a manifest REPLACEMENT
// (e.g. a decomposed run rewrites the implementer node into per-phase/per-task
// nodes) so the live view can re-swap + rebuild mid-run.
function manifestSig(stepper) {
  const m = manifestFor(stepper);
  return (Array.isArray(m.steps) ? m.steps : [])
    .map((cell) => (Array.isArray(cell.nodes) ? cell.nodes.map((n) => n.id).join(',') : ''))
    .join('|');
}

// Resolve an incoming phase/state event to a cell index + node id within a run's
// manifest. nodeId (node phase events) pins the exact node; bookend/legacy events
// match by phase: preflight/done by kind, everything else by uiPhase.
function locateInManifest(manifest, msg) {
  const m = manifestFor(manifest);
  if (msg.nodeId) {
    for (let i = 0; i < m.steps.length; i++) {
      if (m.steps[i].nodes.some((n) => n.id === msg.nodeId)) return { cellIdx: i, nodeId: msg.nodeId };
    }
  }
  const key = normalizePhase(msg.phase);
  if (key === 'preflight') return { cellIdx: 0, nodeId: 'preflight' };
  if (key === 'done') return { cellIdx: m.steps.length - 1, nodeId: 'done' };
  for (let i = 0; i < m.steps.length; i++) {
    const hit = m.steps[i].nodes.find((n) => n.uiPhase === key);
    if (hit) return { cellIdx: i, nodeId: hit.id };
  }
  return { cellIdx: -1, nodeId: null };
}

// Map a phase status string + run status to a stepper node kind.
function nodeKindFor(r, status) {
  if (r.pendingQuestion != null) return 'pause';
  if (r.status === 'stopped') return 'stop';
  if (['done', 'complete', 'passed', 'finish'].includes(status)) return 'done';
  // A gracefully paused/pausing run leaves its frontier node mid-flight: mark it
  // paused so the stepper shows WHERE it stopped instead of a phantom "running…".
  if (r.status === 'paused' || r.status === 'pausing') return 'pause';
  return 'now';
}

// Apply one phase/state transition to the run's live node-status map.
// The scalar trackers (phaseKey/cycle/phaseStatus) drive the foot chip + status
// pill and are kept in sync even when the phase isn't locatable in this run's
// manifest (e.g. a manual-web phase on the legacy default manifest) — only the
// cell-level node-status map needs a resolved cell + node id.
function advanceRun(r, msg) {
  r.phaseKey = normalizePhase(msg.phase) || r.phaseKey;
  if (msg.cycle) r.cycle = msg.cycle;
  r.phaseStatus = msg.status || '';
  const { cellIdx, nodeId } = locateInManifest(r.stepper, msg);
  if (cellIdx < 0 || !nodeId) return;
  if (cellIdx > r.maxCellIdx) r.maxCellIdx = cellIdx;
  if (msg.cycle) r.nodeCycle[nodeId] = Math.max(r.nodeCycle[nodeId] || 0, Number(msg.cycle) || 0);
  r.nodeStatus[nodeId] = nodeKindFor(r, msg.status || '');
}

// Replace a live card's stepper DOM when the manifest first arrives/changes.
function rebuildStepperDom(r) {
  const host = r.el && r.el.querySelector('.run-flow');
  if (host) buildRunGraph(host, r.stepper);
}

// ---------------------------------------------------------------------------
// Run/history node-graph (composer-style). buildRunGraph builds the static
// .run-flow skeleton; paintRunGraph tints it + repaints wires via the shared
// composerPaintWires. Walks the stepper manifest and emits composer .node markup.
// ---------------------------------------------------------------------------

// Resolve a manifest node to its agent meta (icon/displayName/description/color).
// Manifest nodes carry .key (set by buildStepperManifest); bookends (preflight/
// done) have no key -> a neutral cog so they still render an icon.
//
// IMPORTANT: read composer.agents[key] RAW (not composerAgent(key)). composerAgent
// returns a non-undefined default {displayName:key,...} that would shadow the
// EMBEDDED_AGENTS fallback. Raw access yields undefined when the live registry
// isn't loaded yet, so the `|| EMBEDDED_AGENTS[key]` fallback fires. Do not simplify.
const RUN_BOOKEND_ICON = '<circle cx="12" cy="12" r="3.2"/><path d="M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2M6.6 6.6l1.4 1.4M16 16l1.4 1.4M17.4 6.6L16 8M8 16l-1.4 1.4" stroke-linecap="round"/>';
function runNodeAgent(node) {
  const key = node && node.key;
  const live = key && composer.agents && composer.agents[key];
  const embedded = key && EMBEDDED_AGENTS[key];
  const meta = live || embedded || {};
  return {
    icon: safeAgentIcon(meta) || RUN_BOOKEND_ICON,
    color: node.color || meta.color || 'blue',
    label: node.label || meta.displayName || node.id,
    sub: node.sub || meta.description || '',
  };
}

// Visible status caption under the node label. pending -> the node's description.
const STAT_TEXT = { done: 'completed', active: 'running…', paused: 'awaiting input', stopped: 'stopped here', pending: '' };

// Settled-status badge markup (check / two-bar / X). active+pending have none.
const STAT_BADGE = {
  done: '<div class="nstat done"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg></div>',
  paused: '<div class="nstat paused"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="7" y="5" width="3.4" height="14" rx="1"/><rect x="13.6" y="5" width="3.4" height="14" rx="1"/></svg></div>',
  stopped: '<div class="nstat stopped"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></div>',
};

// Visible "model · effort" sub-line for a run-graph node, mirroring the New-
// pipeline config caption (.step-current): friendly model label + raw effort.
// Bookend cells (Preflight/Done) have no uiPhase and run no model -> no line.
// A step with neither model nor effort inherits the global default -> "default"
// (per-field "default" when only one is set). The "·" is U+00B7, matching the
// composer separator. NOTE: the blank wording is "default" (clarification Q1),
// which intentionally differs from the composer's "default model"/"default effort".
function nodeModelLine(node) {
  if (!node || !node.uiPhase) return '';
  const model = node.model || '';
  const effort = node.effort || '';
  if (!model && !effort) return 'default';
  const m = modelById(model);
  // ⚠ = the model has an OBSERVED cost-unreliable flag (§4.6): its endpoint
  // reported no cost while consuming tokens, so this node's cost readout may
  // under-report.
  const modelLabel = model ? (m ? m.label : model) + (m && m.costUnreliable ? ' ⚠' : '') : 'default';
  return `${modelLabel} · ${effort || 'default'}`;
}

// Sub-agent square strip for a run-graph node. One <span.sq> per sub-agent
// (.on iff that sub is still `running`), plus an exact ×N count. Squares are
// render-capped (the count text stays exact); no subs -> empty string so a
// node without sub-agents gets no border row. Pulse is CSS-only (.sq.on).
const SUB_SQUARE_CAP = 24;
function subFanHtml(subs) {
  const list = Array.isArray(subs) ? subs : [];
  if (list.length === 0) return '';
  const squares = list
    .slice(0, SUB_SQUARE_CAP)
    .map((s) => `<span class="sq${s && s.status === 'running' ? ' on' : ''}"></span>`)
    .join('');
  return `<div class="fan">${squares}<span class="fl">×${list.length}</span></div>`;
}

// Build one run-graph node element. status ∈ done|active|paused|stopped|pending.
// isSelf => the node is its own self-cycle target (gets the .iterates ring).
function runNode(node, status, isSelf) {
  const ag = runNodeAgent(node);
  const d = document.createElement('div');
  d.className = `node run-node is-${status}` + (isSelf ? ' iterates' : '');
  d.dataset.id = node.id;
  d.style.setProperty('--c', COMPOSER_COLORS[ag.color] || '#ccc');
  const statusText = STAT_TEXT[status] != null ? STAT_TEXT[status] : '';
  // model · effort is now a VISIBLE sub-line under cost/time (was a hover tooltip).
  // A node with NO configured model carries data-nomodel (+ its effort), so
  // paintRunGraph can resolve the opaque "default" to the session's ACTUAL
  // model once the CLI's init event reports it (design §4.7). Display-only.
  const meLine = nodeModelLine(node);
  d.innerHTML =
    `<div class="nic" style="background:${COMPOSER_TINTS[ag.color] || '#eee'};color:${COMPOSER_COLORS[ag.color] || '#888'}">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">${ag.icon}</svg></div>` +
    `<div class="nmeta"><b>${escapeHtml(ag.label)}</b>` +
      `<small class="nstatus">${escapeHtml(statusText || (status === 'pending' ? (node.sub || ag.sub || '') : ''))}</small>` +
      `<div class="nrun"><span class="dur"></span><span class="cost"></span></div>` +
      (meLine ? `<small class="nmodel">${escapeHtml(meLine)}</small>` : '') +
    `</div>` +
    (STAT_BADGE[status] || '');
  if (meLine && !node.model) {
    // dataset assignment, not attribute interpolation — node.effort is
    // enum-validated server-side, but never trust it into an HTML string.
    const modelEl = d.querySelector('.nmodel');
    modelEl.dataset.nomodel = '1';
    modelEl.dataset.effort = node.effort || '';
  }
  return d;
}

// The set of node ids in a manifest, in column order, as a stable signature.
function runGraphNodeIds(manifest) {
  const ids = [];
  manifest.steps.forEach((cell) => cell.nodes.forEach((n) => ids.push(n.id)));
  return ids;
}

// Build (or rebuild) the .run-flow skeleton into `host`. Idempotent: if the
// host already holds a graph for the SAME ordered node-id set, leave the DOM
// (and its running CSS animations) intact. Trailing <svg class="wires"> is the
// shared renderer's target.
function buildRunGraph(host, manifest) {
  const m = manifestFor(manifest);
  const ids = runGraphNodeIds(m);
  if (host.dataset.graphSig === ids.join('|') && host.querySelector('svg.wires')) return;

  // Preserve horizontal scroll across a structural rebuild: emptying .run-flow
  // collapses it to 0 width, which clamps the .run-flow-wrap scroller back to the
  // far left. Capture before the wipe, restore after the columns are re-appended,
  // so a new stage/node never yanks the pipeline back to the start. No-op off-DOM
  // (a freshly-cloned card has scrollLeft 0 and nothing to keep). Works for both
  // the live card and the history-detail card (both nest .run-flow in .run-flow-wrap).
  const scroller = host.closest('.run-flow-wrap');
  const savedLeft = scroller ? scroller.scrollLeft : 0;

  host.dataset.graphSig = ids.join('|');
  host.dataset.wiresSig = ''; // force a wire repaint after a structural rebuild
  host.innerHTML = '';

  const selfTargets = new Set(
    (Array.isArray(m.feedbacks) ? m.feedbacks : [])
      .filter((fb) => fb && fb.from === fb.to)
      .map((fb) => fb.from),
  );

  host.appendChild(Object.assign(document.createElement('div'), { className: 'strip' }));
  m.steps.forEach((cell, i) => {
    const col = document.createElement('div');
    col.className = 'col';
    col.dataset.cellIdx = String(i);
    const tag = document.createElement('div');
    tag.className = 'col-tag';
    tag.innerHTML = (cell.label ? escapeHtml(cell.label) : `Step ${i + 1}`) + (cell.nodes.length > 1 ? ' · <em>parallel</em>' : '');
    col.appendChild(tag);
    for (const node of cell.nodes) col.appendChild(runNode(node, 'pending', selfTargets.has(node.id)));
    host.appendChild(col);
  });
  host.appendChild(Object.assign(document.createElement('div'), { className: 'strip' }));

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'wires');
  host.appendChild(svg);

  // Restore the pre-rebuild horizontal scroll (the browser clamps automatically if
  // the graph is now narrower). Only when there was a position to keep.
  if (scroller && savedLeft) scroller.scrollLeft = savedLeft;
}

// Final per-node loop count the renderer consumes directly: a node that ran k
// cycles fired its loop k-1 times. nodeCycle[id] = max cycle observed (default 1).
function loopCounts(manifest, nodeCycle) {
  const nc = nodeCycle || {};
  const out = {};
  runGraphNodeIds(manifestFor(manifest)).forEach((id) => {
    out[id] = Math.max(0, (nc[id] || 1) - 1);
  });
  return out;
}

// manifest.steps (cells with .nodes) -> the [[{id}…]…] shape composerPaintWires
// walks for sequential + feedback wires.
function manifestStepsForWires(manifest) {
  return manifestFor(manifest).steps.map((cell) => cell.nodes.map((n) => ({ id: n.id })));
}

// Tint the run-graph from a view-adapter and (signature-gated) repaint wires.
// view = { statusOf(id)->status, activeId|null, cycles:{id:count(FINAL)},
//          live:boolean, durText(id)->str, costText(id)->str,
//          subsOf?(id)->Array<{status}> (optional; sub-agent squares) }.
const RUN_STATUSES = ['is-pending', 'is-done', 'is-active', 'is-paused', 'is-stopped'];
function paintRunGraph(host, manifest, view) {
  const m = manifestFor(manifest);
  const doneSet = new Set();
  runGraphNodeIds(m).forEach((id) => {
    const status = view.statusOf(id) || 'pending';
    if (status === 'done') doneSet.add(id);
    const el = host.querySelector(`.run-node[data-id="${id}"]`);
    if (!el) return;

    el.classList.remove(...RUN_STATUSES);
    el.classList.add('is-' + status);

    const statusEl = el.querySelector('.nstatus');
    if (statusEl) {
      const txt = STAT_TEXT[status];
      statusEl.textContent = (txt != null && txt !== '') ? txt : (status === 'pending' ? (statusEl.dataset.sub || statusEl.textContent || '') : '');
    }

    // Swap the settled-status badge (.nstat). Remove any existing, then re-add.
    const old = el.querySelector('.nstat');
    if (old) old.remove();
    if (STAT_BADGE[status]) el.insertAdjacentHTML('beforeend', STAT_BADGE[status]);

    const durEl = el.querySelector('.dur');
    if (durEl) durEl.textContent = view.durText(id) || '';
    const costEl = el.querySelector('.cost');
    if (costEl) costEl.textContent = view.costText(id) || '';

    // Resolve the "default" model caption to the session's actual model once
    // the init event reported it (design §4.7). Only nodes with NO configured
    // model carry data-nomodel; explicit selections never change.
    const modelEl = el.querySelector('.nmodel[data-nomodel]');
    if (modelEl && view.modelUsedOf) {
      const used = view.modelUsedOf(id);
      if (used) {
        const eff = modelEl.dataset.effort || '';
        modelEl.textContent = `default (${used})` + (eff ? ` · ${eff}` : '');
      }
    }

    // Sub-agent square strip (graph view only; optional adapter). Idempotent:
    // drop the old strip, inject the current one. Empty -> no strip / no row.
    const oldFan = el.querySelector('.fan');
    if (oldFan) oldFan.remove();
    const fanHtml = view.subsOf ? subFanHtml(view.subsOf(id)) : '';
    if (fanHtml) el.insertAdjacentHTML('beforeend', fanHtml);
  });

  // Signature-gated wire repaint: avoid restarting CSS glow / marching-ants
  // every tick. Repaint only when activeId, the done-set, the loop counts, or
  // the topology change since the last paint.
  const cycles = view.cycles || {};
  const sig = JSON.stringify([
    view.live ? (view.activeId || null) : null,
    [...doneSet].sort(),
    Object.keys(cycles).sort().map((k) => `${k}:${cycles[k]}`),
    host.dataset.graphSig || '',
  ]);
  if (host.dataset.wiresSig === sig) return;
  host.dataset.wiresSig = sig;

  const svg = host.querySelector('svg.wires');
  if (!svg) return;
  const steps = manifestStepsForWires(m);
  const feedbacks = Array.isArray(m.feedbacks) ? m.feedbacks : [];
  const paint = (window.__np && window.__np.composerPaintWires) || composerPaintWires;
  const ns = (host.dataset.ns ||= 'rg-' + Math.random().toString(36).slice(2, 8));
  paint(host, svg, steps, feedbacks, {
    ns,
    runMode: true,
    activeId: view.live ? (view.activeId || null) : null,
    doneSet,
    cycles,
  });
}

// ---------------------------------------------------------------------------
// Multi-run engine: per-run model + Map. Each run renders into one card in the
// Running view; events are fanned out by handleServerMessage.
// ---------------------------------------------------------------------------
const runs = new Map();
let runOrderSeq = 0;   // monotonic per-tab creation order; drives stable card/tab ordering
// runId -> orderKey, kept even after the run leaves the runs map (resume drops
// the superseded paused run). A trailing tagged frame for a dropped runId
// re-materializes it through upsertRun -> makeRun; without this memo it would
// mint a FRESH (highest) key and outrank the run that just superseded it.
const runOrderKeys = new Map();

function orderKeyFor(runId) {
  let key = runOrderKeys.get(runId);
  if (key === undefined) { key = ++runOrderSeq; runOrderKeys.set(runId, key); }
  return key;
}

function nowHMS() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function makeRun({
  runId, title, projectDir, status = 'running', startedAt, local = false,
  pendingQuestion = null, kind = 'run', pipelineId = null, pauseReason = null,
  workspaceId = undefined, workspaceName = undefined, projectNames = null,
}) {
  return {
    runId,
    title: title || '(untitled)',
    projectDir: projectDir || '',
    projectNames,         // string[] for workspace runs (all member names); null otherwise
    status,
    startedAt: startedAt || nowHMS(),
    local,
    kind,                 // 'run' | 'workspace-run' | 'scan' | 'agentgen' (only first two get tabs)
    pipelineId,           // matches a History row id once persisted; used to hide lingerers from History
    pauseReason,          // why it paused, or null — ANY orchestrator pause code rides here
                          // (e.g. 'usage_limit'); only the cost pair renders a cost banner
    workspaceId,
    workspaceName,
    // Stable ordering key: assigned once per runId, never bumped by activity
    // and never re-minted if the run is dropped and re-materialized.
    // hello seeds runs in server registration order, so this tracks true
    // creation order across reloads too (newest = highest).
    orderKey: orderKeyFor(runId),
    stepper: null,        // run's own stepper manifest (from 'state'); null => legacy default
    nodeStatus: {},       // { nodeId|bookendId: 'done'|'now'|'pause'|'stop' } live cell state
    nodeCycle: {},        // { nodeId: max cycle observed } -> drives loop badges
    maxCellIdx: -1,       // highest reached cell index (drives "earlier cells = done")
    phaseKey: 'preflight',
    cycle: 0,
    phaseStatus: '',
    costByNode: {},       // { nodeId|uiPhase: usd } for the live stepper
    totalCostUsd: 0,   // pipeline total for the card meta line
    steps: [],         // raw steps[] from the latest state snapshot (for live timers)
    pendingQuestion,
    logLines: [],
    logFilter: { source: '', level: '', step: '', cycle: '', search: '' }, // '' === all; render-time only (logLines keeps everything)
    autoscroll: true,   // Auto-scroll toggle state (source of truth; template default is ON)
    subAgents: [],     // Array<record> — sub-agent lifecycle for this run (see onSubagent/onState)
    stepSkills: {},   // {`${nodeId}|${cycle}`: string[]} — MAIN-agent skills per dropdown group
    stepGraphify: {}, // {`${nodeId}|${cycle}`: number} — MAIN-agent graphify-use count per group
    el: null,
    _finished: false,
  };
}

// Upsert a run model. Only assigns DEFINED keys from the partial, and callers
// must never pass logLines/el in a partial — those heavy/DOM
// fields are owned locally and must not be clobbered by a hello/tagged event.
function upsertRun(partial) {
  let r = runs.get(partial.runId);
  if (!r) {
    r = makeRun(partial);
    runs.set(partial.runId, r);
  } else {
    for (const k of Object.keys(partial)) {
      if (partial[k] !== undefined) r[k] = partial[k];
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Per-run event handlers
// ---------------------------------------------------------------------------
function onPhase(r, msg) {
  advanceRun(r, msg);
  if (normalizePhase(msg.phase) === 'done') {
    r.maxCellIdx = manifestFor(r.stepper).steps.length - 1;
    r.phaseKey = 'done';
  }
  const cyc = msg.cycle ? ` #${msg.cycle}` : '';
  const st = msg.status ? ` (${msg.status})` : '';
  onLog(r, { source: 'phase', level: 'phase', text: `${msg.phase}${cyc}${st}`, ts: Date.now() });
  maybeResume(r);
  paintRunCard(r);
}

// A submitted answer is only confirmed resumed when the next phase/state event
// for this run arrives (the server returns 200 even for a stale id, so HTTP
// success is not proof). Clear the pending question + panel here.
function maybeResume(r) {
  if (!r._answering) return;
  dropPendingQuestion(r);
}

// Clear a run's pending question and un-freeze any frontier node left at 'pause'
// solely because of it: nodeKindFor marks 'pause' iff pendingQuestion != null, so
// once the question is gone every such mark is stale and would otherwise hold the
// stepper on a false "awaiting input" until the next phase event. Shared by the
// local post-answer resume (maybeResume) and the server-broadcast resolution
// (onQuestionResolved). Caller repaints.
function dropPendingQuestion(r) {
  r._answering = false;
  r.pendingQuestion = null;
  for (const k of Object.keys(r.nodeStatus)) {
    if (r.nodeStatus[k] === 'pause') r.nodeStatus[k] = 'now';
  }
  clearQpanel(r);
}

// The server resolved this run's pending question — answered in THIS or ANOTHER
// tab, or the run was paused/stopped/finished while it was open. Drop the card in
// every client, independent of the _answering flag that gates maybeResume(), then
// repaint so the foot chip + stepper leave the false "paused" state. Id-aware so a
// late or duplicate resolution cannot wipe a NEWER pending question.
function onQuestionResolved(r, msg) {
  if (!r.pendingQuestion) return;
  if (msg && msg.id && r.pendingQuestion.id !== msg.id) return;
  dropPendingQuestion(r);
  paintRunCard(r);
}

// Minimal HTML escape for text interpolated into node innerHTML.
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Built-in icons are repo-shipped SVG fragments (trusted, injected raw). User
// agents' metadata is user-writable (POST /api/agents, wizard Mode B), so their
// icon could carry arbitrary markup — they get a fixed glyph instead.
const USER_AGENT_ICON = '<circle cx="12" cy="12" r="3.4"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"></path>';
function safeAgentIcon(meta) {
  return meta && meta.origin === 'user' ? USER_AGENT_ICON : String((meta && meta.icon) || '');
}

// Format a USD amount. null/NaN -> '' (caller decides the default). A positive
// sub-cent value -> '<$0.01' so genuine spend is never hidden as a flat $0.00.
// 0 -> '$0.00' (a truthful mock zero, never blanked).
function fmtUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  if (v > 0 && v < 0.01) return '<$0.01';
  return '$' + v.toFixed(2);
}

// Exact tenth-of-a-cent dollar string for tooltips (the backend tracks 4 dp,
// the visible chip is rounded to 2). '' for non-finite input.
function fmtUsd4(n) {
  const v = Number(n);
  return Number.isFinite(v) ? '$' + v.toFixed(4) : '';
}

// Tooltip text for any cost figure: marks it as Claude Code's client-side
// estimate (not a bill) and reveals the exact value. '' when there's no number.
function estTitle(n) {
  const exact = fmtUsd4(n);
  return exact
    ? `Estimated cost ${exact} — Claude Code client-side estimate (total_cost_usd), not authoritative billing`
    : '';
}

// Format a duration in ms as a compact human string. Twin of fmtUsd: non-finite
// or negative -> ''. <60s -> 'Ns'; <1h -> 'Mm Ss'; else 'Hh Mm'. Math.round
// is half-up (500ms -> '1s').
function fmtDuration(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v < 0) return '';
  const s = Math.round(v / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// Live ms for one step: finalized activeMs plus the running tail when live.
// History passes live=false so a dangling runningSince never contributes.
function liveStepMs(step, now, live = true) {
  const base = Number(step?.activeMs) || 0;
  return live && step?.runningSince != null ? base + Math.max(0, now - step.runningSince) : base;
}

// Live total = sum of all steps' live ms (finalized + running tails). Running only.
function liveTotalMs(steps, now = Date.now()) {
  let sum = 0;
  for (const s of Array.isArray(steps) ? steps : []) {
    if (s && s.activeMs != null) sum += liveStepMs(s, now, true);
  }
  return sum;
}

// A step's stepper bucket key: its node id when present (new runs), else the
// normalized phase (legacy runs, whose default-manifest node ids ARE uiPhases).
function stepBucketKey(s) {
  return (s && typeof s.nodeId === 'string' && s.nodeId) ? s.nodeId : normalizePhase(s && s.phase);
}

// Per-node active-ms bucket, keyed by stepBucketKey.
function durByNode(steps, now = Date.now(), live = true) {
  const out = {};
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || s.activeMs == null || !Number.isFinite(Number(s.activeMs))) continue;
    const key = stepBucketKey(s);
    if (key) out[key] = (out[key] || 0) + liveStepMs(s, now, live);
  }
  return out;
}

// Per-node cost bucket, keyed by stepBucketKey.
function costByNode(steps) {
  const out = {};
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || s.costUsd == null) continue;
    const c = Number(s.costUsd);
    if (!Number.isFinite(c) || c < 0) continue;
    const key = stepBucketKey(s);
    if (key) out[key] = (out[key] || 0) + c;
  }
  return out;
}

// nodeId -> the session's ACTUAL model, stamped on the step by the orchestrator
// from the CLI's init event (design §4.7). Last cycle wins — later attempts of
// a looping node may run a different resolved model.
function modelUsedByNode(steps) {
  const out = {};
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || !s.modelUsed) continue;
    const key = stepBucketKey(s);
    if (key) out[key] = s.modelUsed;
  }
  return out;
}

// A single node's sub-agents (for its graph card), preserving insertion order.
// Pure view-adapter consumed by the render layer; r.subAgents is maintained by
// onSubagent (deltas) + onState (authoritative snapshot).
function subAgentsOf(r, nodeId) {
  const list = r && Array.isArray(r.subAgents) ? r.subAgents : [];
  return list.filter((s) => s && s.nodeId === nodeId);
}

// Find the manifest node with this id across all cells (null if absent).
function findManifestNode(stepper, nodeId) {
  const m = manifestFor(stepper);
  for (const cell of m.steps) for (const n of cell.nodes) if (n.id === nodeId) return n;
  return null;
}

// Sub-agents to render on a graph node. Exact nodeId match first; if none, fall
// back to the node's uiPhase — covers the window before the real s0_0-keyed stepper
// arrives, when the graph is built from the legacy uiPhase-keyed default (its node
// ids ARE uiPhases, and the sub-agents carry uiPhase). `src` = live run r or
// history state st (both expose .subAgents + .stepper).
function subAgentsForNode(src, nodeId) {
  const exact = subAgentsOf(src, nodeId);
  if (exact.length) return exact;
  const node = findManifestNode(src && src.stepper, nodeId);
  if (node && node.uiPhase) {
    const list = src && Array.isArray(src.subAgents) ? src.subAgents : [];
    return list.filter((s) => s && s.uiPhase === node.uiPhase);
  }
  return exact;
}

// Group sub-agents by nodeId for display (the DB keys by step_key, but the UI
// groups by node — §7). Map<nodeId, {subs, spawned, active}>; active = running.
// Records with no nodeId are skipped (cannot be placed on a card).
function subsByNode(subAgents) {
  const out = new Map();
  for (const s of Array.isArray(subAgents) ? subAgents : []) {
    if (!s || s.nodeId == null) continue;
    let g = out.get(s.nodeId);
    if (!g) { g = { subs: [], spawned: 0, active: 0 }; out.set(s.nodeId, g); }
    g.subs.push(s);
    g.spawned += 1;
    if (s.status === 'running') g.active += 1;
  }
  return out;
}

// {nodeId: Array<sub>} — the .subs arrays from subsByNode, the shape the pill/tree
// helpers (paintSubsBar/subsPillText/renderSubsTree) consume. Bridges the C-layer
// Map grouping to the D-layer object-of-arrays consumers.
function subsByNodeArrays(subAgents) {
  return Object.fromEntries([...subsByNode(subAgents)].map(([k, g]) => [k, g.subs]));
}

// Group key separator for (nodeId, cycle) dropdown groups. | never occurs
// in a nodeId (alphanumerics + underscore) or an integer, so split is unambiguous.
const CYCLE_KEY_SEP = '|';

// {`${nodeId}|${cycle}`: Array<sub>} — like subsByNodeArrays but split per
// cycle so refine/review loops show one dropdown group per cycle (records carry
// `cycle`). Insertion order = encounter order (already (started_at,id)-sorted from
// the DB / push order live). Skips records with no nodeId.
function subsByNodeCycleArrays(subAgents) {
  const out = {};
  for (const s of Array.isArray(subAgents) ? subAgents : []) {
    if (!s || s.nodeId == null) continue;
    const key = `${s.nodeId}${CYCLE_KEY_SEP}${s.cycle ?? 0}`;
    (out[key] ||= []).push(s);
  }
  return out;
}

// Set of manifest node ids that are real agents (cell kind 'agents') — EXCLUDES the
// preflight/done bookends so they never appear as Agents-dropdown groups. Driven by
// the run's stepper (manifestFor falls back to CLIENT_DEFAULT_STEPPER when absent).
function agentNodeIdSet(stepper) {
  const m = manifestFor(stepper);
  const set = new Set();
  m.steps.forEach((cell) => {
    if (cell && cell.kind === 'agents') (cell.nodes || []).forEach((n) => set.add(n.id));
  });
  return set;
}

// Ordered {`${nodeId}|${cycle}`: Array<sub>} for the Agents dropdown: ONE group per
// MAIN agent that RAN — derived from state.steps[] filtered to manifest 'agents' nodes,
// in step order — each carrying its sub-agent rows (subsByNodeCycleArrays) or [] when it
// spawned none. This is what makes the dropdown list every main agent (incl. graphify/
// skill-only ones), not just spawners. Any sub-agent group with no matching step row is
// appended last (defensive) so existing sub rows are never dropped.
function subsGroupsForRender(subAgents, steps, stepper) {
  const subsByKey = subsByNodeCycleArrays(subAgents);
  const agentIds = agentNodeIdSet(stepper);
  const out = {};
  for (const st of Array.isArray(steps) ? steps : []) {
    if (!st || st.nodeId == null || !agentIds.has(st.nodeId)) continue;
    const key = `${st.nodeId}${CYCLE_KEY_SEP}${st.cycle ?? 0}`;
    if (!(key in out)) out[key] = subsByKey[key] || [];
  }
  for (const key of Object.keys(subsByKey)) {
    if (!(key in out)) out[key] = subsByKey[key];
  }
  return out;
}

// Main-agent step status -> group header status ('run' | 'done' | 'stop'). A step written by
// _nodeStep (src/core/orchestrator.mjs:1738) carries 'start' | 'done' | 'error' | 'stopped' |
// 'paused'. Map 'done' -> done, the halts 'stopped'/'error' -> stop, and treat 'start' and the
// transient 'paused' as in-flight 'run'.
function stepGroupStatus(status) {
  if (status === 'done') return 'done';
  if (status === 'stopped' || status === 'error') return 'stop';
  return 'run'; // 'start' (running) and 'paused' both read as in-flight
}

// {`${nodeId}|${cycle}`: 'run'|'done'|'stop'} for MAIN-agent steps (filtered to 'agents'
// nodes). Used to colour a group header when that agent spawned NO sub-agents (an empty
// group has no rows for subGroupStatus to roll up).
function stepStatusByKey(steps, stepper) {
  const agentIds = agentNodeIdSet(stepper);
  const out = {};
  for (const st of Array.isArray(steps) ? steps : []) {
    if (!st || st.nodeId == null || !agentIds.has(st.nodeId)) continue;
    out[`${st.nodeId}${CYCLE_KEY_SEP}${st.cycle ?? 0}`] = stepGroupStatus(st.status);
  }
  return out;
}

// {`${nodeId}|${cycle}`: string[]} of MAIN-agent skills, from state.steps[]. Keys
// by the SAME nodeId|cycle composite as subsByNodeCycleArrays (cycle ?? 0) so
// renderSubsTree looks up a group's header skills by its group key. NOTE: this is
// NOT costByNode's keying — costByNode buckets by stepBucketKey (nodeId alone),
// which would NOT match the dropdown group key. Use the composite below.
function stepSkillsFromSteps(steps) {
  const out = {};
  for (const st of Array.isArray(steps) ? steps : []) {
    if (!st || st.nodeId == null || !Array.isArray(st.skills) || !st.skills.length) continue;
    out[`${st.nodeId}${CYCLE_KEY_SEP}${st.cycle ?? 0}`] = st.skills;
  }
  return out;
}

// {`${nodeId}|${cycle}`: number} of MAIN-agent graphify-use counts, from state.steps[].
// Same composite keying as stepSkillsFromSteps so renderSubsTree looks up a group's
// header badge by its group key. Steps with no graphify use are omitted (no badge).
function stepGraphifyFromSteps(steps) {
  const out = {};
  for (const st of Array.isArray(steps) ? steps : []) {
    if (!st || st.nodeId == null || !(st.graphifyCount > 0)) continue;
    out[`${st.nodeId}${CYCLE_KEY_SEP}${st.cycle ?? 0}`] = st.graphifyCount;
  }
  return out;
}

// Map<nodeId, Set<cycle>> — distinct cycles each node spawned sub-agents in.
// Drives whether a group header gets a "· cycle N" suffix. Record-driven: the
// suffix appears when a node actually has sub-agents across >1 cycle, independent
// of any manifest `cycles` flag.
function cyclesPerNode(subAgents) {
  const m = new Map();
  for (const s of Array.isArray(subAgents) ? subAgents : []) {
    if (!s || s.nodeId == null) continue;
    let set = m.get(s.nodeId);
    if (!set) { set = new Set(); m.set(s.nodeId, set); }
    set.add(s.cycle ?? 0);
  }
  return m;
}

// Composite-key (nodeId|cycle) -> display label. Resolves the node label by
// nodeId, then by uiPhase (id-agnostic fallback when the real stepper is absent),
// then the raw id. Appends "· cycle N" only when that node spans >1 cycle (so
// single-cycle steps like Plan render exactly as before).
// Map<nodeId, Set<cycle>> from composite `nodeId|cycle` keys (the rendered group set).
function cyclesFromKeys(keys) {
  const m = new Map();
  for (const key of Array.isArray(keys) ? keys : []) {
    const i = String(key).indexOf(CYCLE_KEY_SEP);
    const nodeId = i >= 0 ? String(key).slice(0, i) : String(key);
    const cycle = i >= 0 ? (Number(String(key).slice(i + 1)) || 0) : 0;
    let set = m.get(nodeId);
    if (!set) { set = new Set(); m.set(nodeId, set); }
    set.add(cycle);
  }
  return m;
}

function cycleAwareLabel(stepper, subAgents, groupKeys) {
  const byId = nodeLabelLookup(stepper);              // nodeId -> label (raw id fallback)
  const m = manifestFor(stepper);
  const phaseToLabel = {};                            // uiPhase -> label
  m.steps.forEach((cell) => cell.nodes.forEach((n) => { if (n.uiPhase) phaseToLabel[n.uiPhase] = n.label || n.uiPhase; }));
  const idToPhase = {};                               // nodeId -> uiPhase (from records)
  for (const s of Array.isArray(subAgents) ? subAgents : []) {
    if (s && s.nodeId != null && s.uiPhase != null) idToPhase[s.nodeId] = s.uiPhase;
  }
  // Cycle-suffix multiplicity over the RENDERED group set when provided (so a node shown
  // across >1 cycle gets "· cycle N" even on cycles that spawned no sub-agents); falls
  // back to sub-agent-derived cycles for legacy 2-arg callers.
  const multi = Array.isArray(groupKeys) && groupKeys.length
    ? cyclesFromKeys(groupKeys)
    : cyclesPerNode(subAgents);
  return (key) => {
    const i = String(key).indexOf(CYCLE_KEY_SEP);
    const nodeId = i >= 0 ? String(key).slice(0, i) : String(key);
    const cycle = i >= 0 ? (Number(String(key).slice(i + 1)) || 0) : 0;
    let label = byId(nodeId);
    if (label === nodeId && idToPhase[nodeId] && phaseToLabel[idToPhase[nodeId]]) {
      label = phaseToLabel[idToPhase[nodeId]];
    }
    const set = multi.get(nodeId);
    if (set && set.size > 1) label += ` · cycle ${cycle}`;
    return label;
  };
}

function onState(r, msg) {
  if (msg.status) r.status = msg.status;
  if (msg.startedAt) r.startedAt = msg.startedAt;
  // Mirror the on-disk pipeline short id the orchestrator stamps onto state.id
  // after createPipeline. The server captures the same field (ui/server.mjs
  // wireRun); without this the run model only ever gets a pipelineId from the
  // hello snapshot, i.e. after a page reload — and /api/resume keys on it.
  // Guard: id-less pre-createPipeline snapshots must not clobber a captured id.
  if (typeof msg.id === 'string' && msg.id) r.pipelineId = msg.id;
  if (msg && msg.branch && msg.branch.feature) {
    r.branchFeature = msg.branch.feature;
  }
  // Swap the manifest when it FIRST arrives OR when its node-id signature changes
  // (a decomposed run rewrites the implementer node into per-phase/per-task nodes
  // mid-run). Rebuild the stepper DOM so subsequent paints address the right nodes.
  if (msg.stepper && (r.stepper == null || manifestSig(msg.stepper) !== manifestSig(r.stepper))) {
    r.stepper = msg.stepper;
    if (r.el) rebuildStepperDom(r);
  }
  if (Array.isArray(msg.steps)) {
    r.steps = msg.steps;
    r.costByNode = costByNode(msg.steps);
    r.stepSkills = stepSkillsFromSteps(msg.steps);
    r.stepGraphify = stepGraphifyFromSteps(msg.steps);
  }
  if (typeof msg.totalCostUsd === 'number') r.totalCostUsd = msg.totalCostUsd;
  // Sub-agents: the state snapshot is authoritative (covers late-join/replay and
  // any missed `subagent` delta). Replace wholesale when present; a snapshot that
  // omits the field (older runs / partial snapshots) leaves the delta-built array.
  r.subAgents = msg.subAgents || r.subAgents;
  if (msg.title && msg.title !== r.title) r.title = msg.title;
  if (msg.phase) advanceRun(r, msg);
  maybeResume(r);
  paintRunCard(r);
}

// Live title replacement: the LLM title landed, replacing the instant provisional.
// Update the in-memory run model first (source of truth for re-renders), then patch
// only the .run-title node of the open card in place (mirrors patchHistoryPr — never
// full-repaint, never lose stepper/expand state).
function onTitle(r, msg) {
  if (!msg || typeof msg.title !== 'string' || !msg.title) return;
  r.title = msg.title;                          // model is source of truth for re-renders
  r.titleProvisional = !!msg.provisional;       // false once the real title lands
  // Patch the live Running card in place (no rebuild), keyed by runId.
  const card = document.querySelector(`.run-card[data-run-id="${cssEscape(r.runId)}"]`);
  const titleEl = card && card.querySelector('.run-title');
  if (titleEl) {
    titleEl.textContent = r.title;
    titleEl.classList.remove('title-provisional');
  }
  // If this pipeline is also shown in History (e.g. it finished before the title
  // settled), patch it too. The pipeline id comes from the MESSAGE — the run model
  // has none.
  patchHistoryTitle(msg.pipelineId, r.title);
}

// Patch an already-rendered History card's title without a full paintHistory().
// Pipeline ids are globally unique, so id-only selection is sufficient.
function patchHistoryTitle(pipelineId, title) {
  if (!pipelineId || !title) return;
  const el = document.querySelector(`.hist-card[data-pipeline-id="${cssEscape(pipelineId)}"]`);
  const b = el && el.querySelector('.h-meta b');
  if (b) b.textContent = title;
  const row = (state.historyAll || []).find((p) => p && p.id === pipelineId);
  if (row) row.title = title;                   // keep the model so a later paintHistory() keeps it
}

// Per-run sub-agent lifecycle delta. Upsert into r.subAgents by `id`: a spawn
// inserts/updates the record; a finish updates status + finishedAt + telemetry.
// Then repaint via the same path onState/onPhase use (paintRunCard -> paintStepper),
// so the graph card the render layer builds reflects the change immediately. The
// authoritative full set still arrives on the `state` snapshot (see onState).
function onSubagent(r, msg) {
  if (!msg || !msg.id) return;
  let rec = r.subAgents.find((s) => s.id === msg.id);
  if (!rec) {
    rec = { id: msg.id };
    r.subAgents.push(rec);
  }
  // Merge only DEFINED fields (a finish frame may omit spawn-time fields like
  // label/nodeId/stepKey; never overwrite a known value with undefined).
  for (const k of ['label', 'nodeId', 'uiPhase', 'stepIndex', 'cycle', 'stepKey', 'status', 'startedAt', 'durationMs', 'tokens', 'costUsd', 'skills', 'subagentType', 'graphifyCount']) {
    if (msg[k] !== undefined) rec[k] = msg[k];
  }
  if (msg.transition === 'finish') {
    if (msg.status === undefined) rec.status = rec.status === 'running' || rec.status == null ? 'finished' : rec.status;
    rec.finishedAt = msg.finishedAt !== undefined ? msg.finishedAt
      : (msg.ts != null ? new Date(msg.ts).toISOString() : new Date().toISOString());
  }
  paintRunCard(r);
}

// Per-step MAIN-agent skill delta, keyed by the same nodeId|cycle composite the
// dropdown groups by. The `state` snapshot stays authoritative (rebuilds the map).
// The delta carries the full cumulative superset, so a plain replace is correct.
function onStepSkills(r, msg) {
  if (!msg || msg.nodeId == null) return;
  if (!r.stepSkills) r.stepSkills = {};
  r.stepSkills[`${msg.nodeId}${CYCLE_KEY_SEP}${msg.cycle ?? 0}`] = Array.isArray(msg.skills) ? msg.skills : [];
  paintRunCard(r);
}

// Per-step MAIN-agent graphify-count delta, keyed by the same nodeId|cycle composite
// the dropdown groups by. The delta carries the cumulative running total, so a plain
// replace is correct; the `state` snapshot stays authoritative (rebuilds the map).
function onStepGraphify(r, msg) {
  if (!msg || msg.nodeId == null) return;
  if (!r.stepGraphify) r.stepGraphify = {};
  r.stepGraphify[`${msg.nodeId}${CYCLE_KEY_SEP}${msg.cycle ?? 0}`] = Number(msg.graphifyCount) || 0;
  paintRunCard(r);
}

// ---------------------------------------------------------------------------
// Per-step model + effort config
// ---------------------------------------------------------------------------

// Rows currently expanded in the agents accordion, by node id. Ephemeral (§4.2):
// kept across a re-render so saving a value does not slam the row shut under the
// user, dropped when the workflow changes.
const openAgentRows = new Set();

/** Accordion key for the feedback-loops row (never a real node id). */
const FEEDBACK_ROW_ID = '__feedbacks__';

// The row data behind the currently painted accordion, keyed by node id. Rebuilt
// on every render; the change handlers read it so they never have to re-derive
// the default layers from the DOM.
let agentRowsById = {};

// Paint (or clear) the config-panel error hint (#config-error), the visible
// counterpart of appendLog for config-load failures (mirrors the inline
// "Could not load this workflow." hint in renderWorkflowConfig).
function setConfigError(text) {
  if (!el.configError) return;
  el.configError.textContent = text || '';
  el.configError.hidden = !text;
}

async function loadConfig(projectDir) {
  try {
    // No project => omit projectDir; the server replies with the built-in models
    // so the picker always shows Opus/Sonnet/Haiku, even on a fresh clone.
    const qs = projectDir ? `?projectDir=${encodeURIComponent(projectDir)}` : '';
    const res = await fetch(`/api/config${qs}`);
    const data = await safeJson(res);
    if (res.ok) {
      state.config = data.config || { steps: {}, customModels: [] };
      state.models = Array.isArray(data.models) ? data.models : [];
      state.efforts = Array.isArray(data.efforts) ? data.efforts : [];
      state.stepDefaults = {};
      if (Array.isArray(data.steps)) {
        for (const s of data.steps) if (s && s.key) state.stepDefaults[s.key] = {
          fanOut: !!s.fanOut,
          asksQuestions: !!s.asksQuestions,
          questionsLocked: !!s.questionsLocked,
          questionsDefault: !!s.questionsDefault,
        };
      }
      setConfigError('');
    } else {
      // Surface the failure but DO fall through to loadWorkflowsInto below: an
      // early return here left the whole form dead (static Default-only dropdown,
      // empty pickers) when /api/config 500ed. Reset the per-project layers so a
      // previous project's config is never painted — or echoed back by a later
      // save — and render defaults with a visible explanation.
      state.config = { steps: {}, customModels: [] };
      state.stepDefaults = {};
      appendLog({ source: 'ui', level: 'error', text: `config: ${data.error || res.status}`, ts: Date.now() });
      setConfigError(`Could not load saved config (${data.error || `HTTP ${res.status}`}) — showing defaults.`);
    }
  } catch {
    // Network-level failure: same reset as the non-ok branch (a previous
    // project's config must not linger), but keep last-known models/efforts.
    state.config = { steps: {}, customModels: [] };
    state.stepDefaults = {};
    setConfigError('Could not load saved config (network error) — showing defaults.');
  }
  // Seed the active workflow from per-project run-config (activeWorkflowId),
  // then populate the dropdown + render the chosen workflow's accordion. The
  // Default workflow goes through the SAME renderer as a saved one; only its
  // storage differs (legacy per-role steps, resolved in buildNodeConfigRows).
  if (state.config.activeWorkflowId) state.workflowId = state.config.activeWorkflowId;
  await loadWorkflowsInto(state.workflowId);
  await loadGuardrailsInto(state.guardrailsId);
}

// ---------------------------------------------------------------------------
// Pipeline Composer — /api/workflows + /api/agents client wrappers
// ---------------------------------------------------------------------------
async function fetchAgents() {
  try {
    const res = await fetch('/api/agents');
    if (!res.ok) return null;
    return await safeJson(res);
  } catch {
    return null; // composer falls back to the embedded registry
  }
}

async function listWorkflows() {
  try {
    const res = await fetch('/api/workflows');
    const data = await safeJson(res);
    if (!res.ok) return [];
    return Array.isArray(data.workflows) ? data.workflows : [];
  } catch {
    return [];
  }
}

async function getWorkflow(id) {
  try {
    const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return await safeJson(res);
  } catch {
    return null;
  }
}

async function saveWorkflow({ name, domain, steps, feedbacks }) {
  const res = await fetch('/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, domain, steps, feedbacks }),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error || `save failed (${res.status})`);
  return { workflow: data.workflow, warnings: Array.isArray(data.warnings) ? data.warnings : [] };
}

async function deleteWorkflow(id) {
  const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error || `delete failed (${res.status})`);
  return true;
}

// ---------------------------------------------------------------------------
// Pipeline Composer module (ported from docs/pipeline-composer/mockups).
// Pure serialization lives in composer-core.mjs; this is DOM wiring only.
// Manual-only behaviors (no jsdom layout / no HTML5 DnD): paintWires geometry,
// drag pills onto strips/cols, hover-loop link mode, read-only preview paint.
// SELF-LOOP NOTE: a SAME-NODE self-loop (fb.from===fb.to, e.g. the default's
// fb_refine s1_0->s1_0) is created/removed via the node's top-left self-cycle
// toggle (.selfloop), NOT the bottom-right link button — that one only draws edges
// to DISTINCT nodes (composerAddFeedback still rejects from===to). paintWires
// special-cases from===to to draw a small violet lobe beneath the node with NO
// delete-X (the toggle owns removal; cross-node amber loops keep their X). Manual
// checklist: Reset shows the Refine node with its self-cycle toggle lit (violet ring)
// and a violet self-loop arc beneath it; clicking the toggle removes both, clicking
// again restores them.
// ---------------------------------------------------------------------------
const COMPOSER_COLORS = { green: '#5BAE5B', peach: '#EFA63C', red: '#E76A5A', blue: '#5BA6CC', violet: '#8C7FD6', amber: '#E6962A' };
const COMPOSER_TINTS = { green: '#E2F3DF', peach: '#FCEEDA', red: '#FBE3E0', blue: '#DEEFF7', violet: '#EAE6F8', amber: '#FCE8C8' };
const COMPOSER_SEQ = '#B7B7BC';

let _composerReady = false;
const composer = {
  agents: {},          // key -> {key,displayName,description,color,icon,origin}
  steps: [],           // Array<Array<{id,key}>> (local ids)
  feedbacks: [],       // Array<{from,to}> (local ids)
  saved: [],           // WorkflowTemplate[] from the server
  linkFrom: null,
  dragKey: null,
  uid: 1,
  els: {},
};
const composerMk = (key) => ({ id: 'n' + composer.uid++, key });
const composerAgent = (key) => composer.agents[key] || { displayName: key, description: '', color: 'blue', icon: '' };

// Test hook: expose the composer state + the mutators the jsdom tests drive
// directly (mirrors the window.__np convention). composerRefresh/composerAddFeedback
// are hoisted function declarations, so they are bound by reference here.
if (typeof window !== 'undefined') {
  window.__composer = composer;
  window.__composerRefresh = composerRefresh;
  window.__composerAddFeedback = composerAddFeedback;
}

// Set by agent CRUD (create/edit/duplicate/delete); the palette is refetched on
// the next composer entry so in-session agent mutations show without a reload.
let _composerPaletteDirty = false;

/** Refetch the registry and rebuild the composer palette in place. */
async function refreshComposerPalette() {
  _composerPaletteDirty = false;
  const agentsRes = await fetchAgents();
  const pal = mergePalette(agentsRes);
  composer.agents = {};
  pal.forEach((a) => { composer.agents[a.key] = a; });
  composerBuildPalette(pal);
}

async function initComposer() {
  if (_composerReady) {
    if (_composerPaletteDirty) await refreshComposerPalette();
    composerDrawWires();
    return;
  }
  _composerReady = true;
  composer.els = {
    flow: document.getElementById('composer-flow'),
    wires: document.getElementById('composer-wires'),
    palette: document.getElementById('composer-palette'),
    banner: document.getElementById('composer-link-banner'),
    linkText: document.getElementById('composer-link-text'),
    list: document.getElementById('composer-saved-list'),
    count: document.getElementById('composer-saved-count'),
  };
  if (!composer.els.flow) return;

  // toolbar + global listeners (bound once)
  document.getElementById('composer-reset').addEventListener('click', () => { composerExitLink(); composerReset(); });
  document.getElementById('composer-clear').addEventListener('click', () => { composerExitLink(); composer.steps = []; composer.feedbacks = []; composerRefresh(); });
  document.getElementById('composer-save').addEventListener('click', composerSave);
  document.getElementById('composer-link-cancel').addEventListener('click', composerExitLink);
  const agentFilter = document.getElementById('composer-agent-filter');
  if (agentFilter) agentFilter.addEventListener('input', composerApplyFilter);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') composerExitLink(); });
  composer.els.wires.addEventListener('click', (e) => {
    const g = e.target.closest('.fb-del'); if (!g) return;
    composer.feedbacks.splice(+g.dataset.fb, 1); composerRefresh();
  });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(composerDrawWires, 80); });
  if (window.ResizeObserver) new window.ResizeObserver(() => composerDrawWires()).observe(composer.els.flow);

  // palette from the registry (or embedded fallback)
  await refreshComposerPalette();

  // initial canvas = the saved default workflow (4-step)
  await composerReset();
  await composerLoadSaved();
}

/* ---- palette ---- */
// Ordered header list derived from the already-order-sorted palette, mirroring
// collectDomains (general last, shared excluded) — no extra API round-trip.
function paletteDomains(pal) {
  const seen = [];
  pal.forEach((a) => { if (a.domain && a.domain !== 'shared' && a.domain !== 'general' && !seen.includes(a.domain)) seen.push(a.domain); });
  seen.push('general');
  return seen;
}

const composerCollapsed = new Set();   // domains the user has collapsed via chips

function composerBuildPalette(pal) {
  const palette = composer.els.palette;
  const ro = pillNameRO();
  if (ro) ro.disconnect();   // old pills are about to be thrown away
  palette.innerHTML = '';
  const domains = paletteDomains(pal);
  const groups = groupPaletteByDomain(pal, domains);

  // Filter chips: one per domain, toggles section visibility.
  const chips = document.createElement('div');
  chips.className = 'pal-chips';
  domains.forEach((d) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'pal-chip' + (composerCollapsed.has(d) ? ' off' : '');
    chip.textContent = d;
    chip.addEventListener('click', () => {
      if (composerCollapsed.has(d)) composerCollapsed.delete(d); else composerCollapsed.add(d);
      composerBuildPalette(pal);                 // cheap re-render
    });
    chips.appendChild(chip);
  });
  palette.appendChild(chips);

  groups.forEach((g) => {
    const sec = document.createElement('div');
    sec.className = 'pal-section';
    if (composerCollapsed.has(g.domain)) sec.classList.add('collapsed');
    const head = document.createElement('div');
    head.className = 'pal-head';
    head.textContent = g.domain;
    sec.appendChild(head);
    g.agents.forEach((ag) => sec.appendChild(composerPalettedPill(ag)));
    palette.appendChild(sec);
  });
  composerApplyFilter();
}

// Live palette filter (spec 2026-08-09 §Decisions 7): toggles .hidden only —
// cards stay in the DOM so drag handlers and collapse state survive filtering.
// The haystack covers everything the card itself can show: key, name and
// description always; channel names ONLY when the card's visible blurb IS the
// derived "in: … · out: …" line. A card that paints a real description never
// shows its channels, so matching them there is a hit with no visible reason.
function composerApplyFilter() {
  const input = document.getElementById('composer-agent-filter');
  const q = ((input && input.value) || '').trim().toLowerCase();
  document.querySelectorAll('#composer-palette .pal-section').forEach((sec) => {
    let visible = 0;
    sec.querySelectorAll('.agent-pill').forEach((p) => {
      const ag = composer.agents[p.dataset.key] || {};
      const chans = paletteDesc(ag).derived
        ? ` ${(ag.consumes || []).join(' ')} ${(ag.produces || []).join(' ')}`
        : '';
      const hay = `${p.dataset.key} ${ag.displayName || ''} ${ag.description || ''}${chans}`.toLowerCase();
      const hit = !q || hay.includes(q);
      p.classList.toggle('hidden', !hit);
      if (hit) visible += 1;
    });
    sec.classList.toggle('hidden', !!q && visible === 0);
  });
}

// Palette blurb: the resolved sidecar/frontmatter description when present,
// else a derived in/out line from the agent's channels (derived:true renders
// italic and reads as a fallback, never as authored copy).
function paletteDesc(ag) {
  const d = typeof ag.description === 'string' ? ag.description.trim() : '';
  if (d) return { text: d, derived: false };
  const io = [];
  if (Array.isArray(ag.consumes) && ag.consumes.length) io.push('in: ' + ag.consumes.join(', '));
  if (Array.isArray(ag.produces) && ag.produces.length) io.push('out: ' + ag.produces.join(', '));
  return { text: io.length ? io.join(' · ') : 'No description yet', derived: true };
}

// Name-aware description clamp: the palette card budgets 3 text lines — a name
// that wraps to 2 lines (.name-2l) leaves 1 for the description, a 1-line name
// leaves 2. Measured with a ResizeObserver, not guessed: wrapping depends on
// the rendered width, and a palette built while hidden reports height 0 until
// the composer first shows — the observer fires again on that resize.
let pillNameROInst;
function pillNameRO() {
  if (pillNameROInst === undefined) {
    pillNameROInst = window.ResizeObserver
      ? new window.ResizeObserver((entries) => { entries.forEach((en) => pillApplyNameClamp(en.target)); })
      : null;
  }
  return pillNameROInst;
}
function pillApplyNameClamp(pname) {
  const pill = pname.closest('.agent-pill');
  const h = pname.getBoundingClientRect().height;
  if (!pill || !h) return;   // h=0 → not laid out yet; keep the current class
  const lh = parseFloat(window.getComputedStyle(pname).lineHeight) || 16;
  pill.classList.toggle('name-2l', h > lh * 1.5);
}

// Extracted from the old composerBuildPalette loop body so the pill markup + drag
// handlers live in one place.
function composerPalettedPill(ag) {
  const p = document.createElement('div');
  p.className = 'agent-pill';
  p.draggable = true;
  p.tabIndex = 0;
  p.dataset.key = ag.key;
  const desc = paletteDesc(ag);
  const consumesList = Array.isArray(ag.consumes) ? ag.consumes : [];
  const producesList = Array.isArray(ag.produces) ? ag.produces : [];
  // Bubble content (three states): tip-desc is the real description or the bare
  // fallback — never the derived in/out text (the IO line below already shows
  // the channels; stating them twice in two formats reads as a bug). The IO
  // line renders only when at least one side has channels ('—' fills the other).
  const tipDesc = (typeof ag.description === 'string' && ag.description.trim())
    ? ag.description.trim()
    : 'No description yet';
  const tipIo = (consumesList.length || producesList.length)
    ? `<span class="tip-line">${escapeHtml(consumesList.join(', ') || '—')} → ${escapeHtml(producesList.join(', ') || '—')}</span>`
    : '';
  p.innerHTML =
    `<span class="phead"><span class="pdotc" style="background:${COMPOSER_COLORS[ag.color] || '#ccc'}"></span><span class="pname">${escapeHtml(ag.displayName)}</span></span>` +
    `<small class="pdesc${desc.derived ? ' derived' : ''}">${escapeHtml(desc.text)}</small>` +
    `<span class="tip-content hidden">` +
      `<span class="tip-desc">${escapeHtml(tipDesc)}</span>` +
      `<span class="tip-line">${escapeHtml(ag.domain || 'general')} · ${escapeHtml(ag.origin || 'builtin')}</span>` +
      tipIo +
    `</span>`;
  p.addEventListener('dragstart', (e) => {
    composer.dragKey = ag.key; p.classList.add('dragging');
    clearTimeout(pillTipTimer); hideInfoTip();   // never tooltip mid-drag
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', ag.key); }
  });
  p.addEventListener('dragend', () => {
    composer.dragKey = null; p.classList.remove('dragging');
    document.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
  });
  const ro = pillNameRO();
  if (ro) ro.observe(p.querySelector('.pname'));
  return p;
}

/* ---- node ---- */
function composerNodeEl(a) {
  const ag = composerAgent(a.key);
  const selfOn = composer.feedbacks.some((f) => f.from === a.id && f.to === a.id);
  const d = document.createElement('div');
  d.className = 'node'; d.dataset.id = a.id; d.style.setProperty('--c', COMPOSER_COLORS[ag.color] || '#ccc');
  d.innerHTML =
    `<div class="selfloop${selfOn ? ' on' : ''}" title="${selfOn ? 'Remove self-cycle' : 'Self-cycle — re-run this step on blocking issues'}" aria-pressed="${selfOn}">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3v5h5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 21v-5h-5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>` +
    `<div class="nic" style="background:${COMPOSER_TINTS[ag.color] || '#eee'};color:${COMPOSER_COLORS[ag.color] || '#888'}">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">${safeAgentIcon(ag)}</svg></div>` +
    `<div class="nmeta"><b>${escapeHtml(ag.displayName)}</b><small>${escapeHtml(ag.description)}</small></div>` +
    `<div class="nx" title="Remove agent">✕</div>` +
    `<div class="loop" title="Draw a feedback loop from this agent">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 9a5 5 0 0 1 5-5h9" stroke-linecap="round"/><path d="M14 1l3 3-3 3" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 15a5 5 0 0 1-5 5H7" stroke-linecap="round"/><path d="M10 23l-3-3 3-3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
  d.querySelector('.selfloop').addEventListener('click', (e) => { e.stopPropagation(); composerToggleSelf(a.id); });
  d.querySelector('.nx').addEventListener('click', (e) => { e.stopPropagation(); composerRemoveNode(a.id); });
  d.querySelector('.loop').addEventListener('click', (e) => { e.stopPropagation(); composerToggleLink(a.id); });
  // Exit link mode BEFORE adding the edge: composerExitLink hides the banner and
  // would swallow the toast composerAddFeedback raises for a block reason or warn.
  d.addEventListener('click', () => { if (composer.linkFrom && composer.linkFrom !== a.id) { const from = composer.linkFrom; composerExitLink(); composerAddFeedback(from, a.id); } });
  return d;
}

/* ---- drop helpers ---- */
function composerAllow(e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }
// Transient governance message: reuse the link-banner els (link mode is mutually
// exclusive with dragging). Falls back to console when no banner is mounted (jsdom).
function composerToast(msg) {
  const banner = composer.els.banner, text = composer.els.linkText;
  if (banner && text) { text.textContent = msg; banner.hidden = false; setTimeout(() => { banner.hidden = true; }, 2200); }
  else if (typeof console !== 'undefined') console.warn('[composer]', msg); // jsdom/no-banner fallback
}
function composerMakeStrip(index, full) {
  const s = document.createElement('div');
  s.className = 'strip' + (full ? ' full' : '');
  s.addEventListener('dragover', (e) => { composerAllow(e); s.classList.add('over'); });
  s.addEventListener('dragleave', () => s.classList.remove('over'));
  s.addEventListener('drop', (e) => {
    e.preventDefault(); s.classList.remove('over');
    if (!composer.dragKey) return;
    const key = composer.dragKey;
    const prev = composer.steps[index - 1] || [];
    const next = composer.steps[index] || [];
    const badPrev = prev.find((n) => !canConnect(n.key, key, composer.agents).ok);
    const badNext = next.find((n) => !canConnect(key, n.key, composer.agents).ok);
    if (badPrev) { composerToast(canConnect(badPrev.key, key, composer.agents).reason); composer.dragKey = null; return; }
    if (badNext) { composerToast(canConnect(key, badNext.key, composer.agents).reason); composer.dragKey = null; return; }
    const wp = prev.map((n) => canConnect(n.key, key, composer.agents).warn).find(Boolean)
      || next.map((n) => canConnect(key, n.key, composer.agents).warn).find(Boolean);
    if (wp) composerToast(wp);
    composer.steps.splice(index, 0, [composerMk(key)]); composer.dragKey = null; composerRefresh();
  });
  return s;
}
function composerMakeCol(stepIdx) {
  const col = document.createElement('div');
  col.className = 'col';
  const tag = document.createElement('div'); tag.className = 'col-tag';
  tag.innerHTML = `Step ${stepIdx + 1}` + (composer.steps[stepIdx].length > 1 ? ' · <em>parallel</em>' : '');
  col.appendChild(tag);
  composer.steps[stepIdx].forEach((a) => col.appendChild(composerNodeEl(a)));
  const hint = document.createElement('div'); hint.className = 'par-hint'; hint.textContent = '+ run in parallel';
  col.appendChild(hint);
  col.addEventListener('dragover', (e) => { composerAllow(e); col.classList.add('over'); });
  col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
  col.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); col.classList.remove('over');
    if (!composer.dragKey) return;
    const key = composer.dragKey;
    const prev = composer.steps[stepIdx - 1] || [];
    const next = composer.steps[stepIdx + 1] || [];
    const badPrev = prev.find((n) => !canConnect(n.key, key, composer.agents).ok);
    const badNext = next.find((n) => !canConnect(key, n.key, composer.agents).ok);
    if (badPrev || badNext) {
      const v = badPrev ? canConnect(badPrev.key, key, composer.agents) : canConnect(key, badNext.key, composer.agents);
      composerToast(v.reason); composer.dragKey = null; return;
    }
    const wp = prev.map((n) => canConnect(n.key, key, composer.agents).warn).find(Boolean)
      || next.map((n) => canConnect(key, n.key, composer.agents).warn).find(Boolean);
    if (wp) composerToast(wp);
    composer.steps[stepIdx].push(composerMk(key)); composer.dragKey = null; composerRefresh();
  });
  return col;
}

/* ---- render ---- */
function composerRefresh() {
  const flow = composer.els.flow;
  [...flow.querySelectorAll(':scope > .strip, :scope > .col, :scope > .empty-flow')].forEach((e) => e.remove());
  if (composer.steps.length === 0) {
    flow.appendChild(composerMakeStrip(0, true));
    const empty = document.createElement('div'); empty.className = 'empty-flow';
    empty.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 12h14M12 5v14" stroke-linecap="round"/></svg>' +
      'Drag an agent here to begin<small>Place agents left-to-right for sequence · stack them for parallel steps</small>';
    flow.appendChild(empty);
  } else {
    for (let i = 0; i < composer.steps.length; i++) { flow.appendChild(composerMakeStrip(i)); flow.appendChild(composerMakeCol(i)); }
    flow.appendChild(composerMakeStrip(composer.steps.length));
  }
  const hint = document.getElementById('composer-decomposer-hint');
  if (hint) {
    const hasDecomposer = composer.steps.some((col) => col.some((n) => n.key === 'decomposer'));
    hint.hidden = !hasDecomposer;
  }
  requestAnimationFrame(composerDrawWires);
}

/* ---- mutations ---- */
function composerRemoveNode(id) {
  for (let i = 0; i < composer.steps.length; i++) {
    const j = composer.steps[i].findIndex((a) => a.id === id);
    if (j >= 0) { composer.steps[i].splice(j, 1); if (composer.steps[i].length === 0) composer.steps.splice(i, 1); break; }
  }
  composer.feedbacks = composer.feedbacks.filter((f) => f.from !== id && f.to !== id);
  if (composer.linkFrom === id) composerExitLink();
  composerRefresh();
}
function composerAddFeedback(from, to) {
  if (from === to) return;
  const flat = composer.steps.flat();
  const fromKey = flat.find((n) => n.id === from)?.key;
  const toKey = flat.find((n) => n.id === to)?.key;
  const verdict = canConnect(fromKey, toKey, composer.agents);
  if (!verdict.ok) { composerToast(verdict.reason); return; }
  if (verdict.warn) composerToast(verdict.warn);
  if (!composer.feedbacks.some((f) => f.from === from && f.to === to)) composer.feedbacks.push({ from, to });
  composerRefresh();
}
// Self-cycle toggle: add/remove a SAME-NODE feedback (from===to). The composer's
// link button rejects from===to, so this is the only way to set a self-loop. It
// re-runs the step on its own blocking issues (the default's fb_refine).
function composerToggleSelf(id) {
  const node = composer.steps.flat().find((n) => n.id === id);
  const key = node?.key;
  const verdict = canConnect(key, key, composer.agents);
  if (!verdict.ok) { composerToast(`${(composer.agents[key]?.displayName) || key} can’t loop to itself`); return; }
  const i = composer.feedbacks.findIndex((f) => f.from === id && f.to === id);
  if (i >= 0) composer.feedbacks.splice(i, 1);
  else composer.feedbacks.push({ from: id, to: id });
  composerRefresh();
}

/* ---- feedback linking mode ---- */
function composerToggleLink(id) { if (composer.linkFrom === id) composerExitLink(); else composerEnterLink(id); }
function composerEnterLink(id) {
  composer.linkFrom = id;
  composer.els.banner.hidden = false;
  const a = composer.steps.flat().find((n) => n.id === id);
  composer.els.linkText.textContent = `Loop from "${composerAgent(a.key).displayName}" → click a target agent`;
  composer.els.flow.querySelectorAll('.node').forEach((n) => {
    n.classList.toggle('linking', n.dataset.id === id);
    n.classList.toggle('link-target', n.dataset.id !== id);
  });
}
function composerExitLink() {
  composer.linkFrom = null;
  if (composer.els.banner) composer.els.banner.hidden = true;
  if (composer.els.flow) composer.els.flow.querySelectorAll('.node').forEach((n) => n.classList.remove('linking', 'link-target'));
}

/* ---- wires (shared renderer; ns-namespaced markers) ---- */
function composerPaintWires(flowEl, wiresEl, steps, feedbacks, opts) {
  opts = opts || {};
  const ns = opts.ns || 'main';
  if (flowEl.offsetParent === null) return; // view hidden — skip
  // Canonical loop-count rule (Phase D applies this when BUILDING opts.cycles;
  // the renderer itself reads the finished count from opts.cycles[fb.from]).
  const loopCount = (fb, nodeCycle) => Math.max(0, (nodeCycle[fb.from] || 1) - 1);
  const loopBadge = (cx, cy, color, n) =>
    `<g class="loop-badge"><title>${n} cycle${n === 1 ? '' : 's'}</title>` +
    `<circle cx="${cx}" cy="${cy}" r="11.5" fill="${color}" stroke="${color}" stroke-width="1.6"/>` +
    `<text x="${cx}" y="${cy + 0.5}" text-anchor="middle" dominant-baseline="central" ` +
    `font-size="11.5" font-weight="700" fill="#fff">${n}×</text></g>`;
  const rect = (id) => {
    const el = flowEl.querySelector(`.node[data-id="${id}"]`); if (!el) return null;
    const fr = flowEl.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left - fr.left, y: r.top - fr.top, w: r.width, h: r.height };
  };
  const W = flowEl.scrollWidth, H = flowEl.scrollHeight;
  wiresEl.setAttribute('width', W); wiresEl.setAttribute('height', H);
  wiresEl.style.width = W + 'px'; wiresEl.style.height = H + 'px';
  let s = `<defs>` +
    `<marker id="arrSeq-${ns}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0L9 4.5L0 9z" fill="${COMPOSER_SEQ}"/></marker>` +
    `<marker id="arrSeqDone-${ns}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0L9 4.5L0 9z" fill="${COMPOSER_COLORS.green}"/></marker>` +
    `<marker id="arrFb-${ns}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0L9 4.5L0 9z" fill="${COMPOSER_COLORS.amber}"/></marker>` +
    `<marker id="arrSelf-${ns}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0L9 4.5L0 9z" fill="${COMPOSER_COLORS.violet}"/></marker></defs>`;
  for (let i = 0; i < steps.length - 1; i++) {
    steps[i].forEach((a) => {
      steps[i + 1].forEach((b) => {
        const ra = rect(a.id), rb = rect(b.id); if (!ra || !rb) return;
        const x1 = ra.x + ra.w, y1 = ra.y + ra.h / 2, x2 = rb.x, y2 = rb.y + rb.h / 2;
        const dx = Math.max(36, (x2 - x1) * 0.5);
        const bothDone = opts.doneSet && opts.doneSet.has(a.id) && opts.doneSet.has(b.id);
        const seqStroke = bothDone ? COMPOSER_COLORS.green : COMPOSER_SEQ;
        const seqMk = bothDone ? `arrSeqDone-${ns}` : `arrSeq-${ns}`;
        s += `<path d="M${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" fill="none" stroke="${seqStroke}" stroke-width="2" stroke-dasharray="6 7" marker-end="url(#${seqMk})"/>`;
      });
    });
  }
  const posOf = (id) => { for (const st of steps) { const i = st.findIndex((a) => a.id === id); if (i >= 0) return { len: st.length, i }; } return { len: 1, i: 0 }; };
  let maxBottom = 0;
  steps.flat().forEach((a) => { const r = rect(a.id); if (r) maxBottom = Math.max(maxBottom, r.y + r.h); });
  feedbacks.forEach((fb, idx) => {
    const ra = rect(fb.from), rb = rect(fb.to); if (!ra || !rb) return;
    if (fb.from === fb.to) {
      // same-node self-cycle: a BIG violet lobe hanging beneath the node so the
      // cycle badge reads clearly. No delete-X — the node's top-left self-cycle
      // toggle owns add/remove (composer); run/history pass cycles for the badge.
      const cx = ra.x + ra.w / 2, by = ra.y + ra.h, b = 40;
      const fbCls = opts.runMode ? (fb.from === opts.activeId ? ' class="wire-live"' : ' class="wire-dim"') : '';
      s += `<path d="M${cx - 26} ${by} C ${cx - 40} ${by + b}, ${cx + 40} ${by + b}, ${cx + 26} ${by}"${fbCls} fill="none" stroke="${COMPOSER_COLORS.violet}" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round" marker-end="url(#arrSelf-${ns})"/>`;
      if (opts.cycles && !opts.del) {
        const n = opts.cycles[fb.from] || 0;
        if (n >= 1) s += loopBadge(cx, by + b * 0.82, COMPOSER_COLORS.violet, n);
      }
      return;
    }
    const p = posOf(fb.from);
    const below = p.len > 1 && p.i === p.len - 1;
    let sx, sy, tx, ty, rail, mx, my;
    if (below) {
      sx = ra.x + ra.w / 2; sy = ra.y + ra.h; tx = rb.x + rb.w / 2; ty = rb.y + rb.h;
      rail = maxBottom + Math.max(46, Math.abs(sx - tx) * 0.12);
      my = rail - (rail - Math.max(sy, ty)) * 0.18;
    } else {
      sx = ra.x + ra.w / 2; sy = ra.y; tx = rb.x + rb.w / 2; ty = rb.y;
      rail = Math.min(sy, ty) - Math.max(46, Math.abs(sx - tx) * 0.16);
      my = rail + (Math.min(sy, ty) - rail) * 0.18;
    }
    mx = (sx + tx) / 2;
    const fbCls = opts.runMode ? (fb.from === opts.activeId ? ' class="wire-live"' : ' class="wire-dim"') : '';
    s += `<path d="M${sx} ${sy} C ${sx} ${rail}, ${tx} ${rail}, ${tx} ${ty}"${fbCls} fill="none" stroke="${COMPOSER_COLORS.amber}" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round" marker-end="url(#arrFb-${ns})"/>`;
    if (opts.del) {
      s += `<g class="fb-del" data-fb="${idx}" style="cursor:pointer;pointer-events:auto">` +
        `<circle cx="${mx}" cy="${my}" r="9.5" fill="#fff" stroke="${COMPOSER_COLORS.amber}" stroke-width="1.5"/>` +
        `<path d="M${mx - 3.2} ${my - 3.2}L${mx + 3.2} ${my + 3.2}M${mx + 3.2} ${my - 3.2}L${mx - 3.2} ${my + 3.2}" stroke="${COMPOSER_COLORS.amber}" stroke-width="1.7" stroke-linecap="round"/></g>`;
    } else if (opts.cycles) {
      const n = opts.cycles[fb.from] || 0;
      if (n >= 1) s += loopBadge(mx, my, COMPOSER_COLORS.amber, n);
    }
  });
  wiresEl.innerHTML = s;
}
function composerDrawWires() {
  if (!composer.els.flow) return;
  composerPaintWires(composer.els.flow, composer.els.wires, composer.steps, composer.feedbacks, { ns: 'main', del: true });
}

/* ---- toolbar actions (server-wired) ---- */
async function composerReset() {
  const tpl = await getWorkflow('wf_default');
  const model = defaultTopologyFromTemplate(tpl, composerMk);
  composer.steps = model.steps;
  composer.feedbacks = model.feedbacks;
  composerRefresh();
}
// Auto-suggest the workflow domain = the dominant non-`shared` domain among member
// agents, else 'general'. The user can override in the second save prompt.
function suggestWorkflowDomain(steps) {
  const counts = new Map();
  distinctAgents(steps).forEach((k) => {
    const d = (composerAgent(k)?.domain) || 'general';   // composerAgent fallback lacks domain → 'general'
    if (d === 'shared') return;               // shared never dominates
    counts.set(d, (counts.get(d) || 0) + 1);
  });
  let best = 'general', bestN = 0;
  for (const [d, n] of counts) if (n > bestN) { best = d; bestN = n; }
  return best;                                 // 'general' when only shared / none
}

async function composerSave() {
  if (!composer.steps.length) return;
  composerExitLink();
  const name = (window.prompt('Name this pipeline:', '') || '').trim();
  if (!name) return;
  const suggested = suggestWorkflowDomain(composer.steps);
  const domain = (window.prompt('Domain (organizes the picker — e.g. coding, marketing):', suggested) || '').trim() || suggested;
  const body = topology(composer.steps, composer.feedbacks); // {steps,feedbacks} with contract ids
  const saveBtn = document.getElementById('composer-save');
  let saved, warnings;
  try {
    ({ workflow: saved, warnings } = await saveWorkflow({ name, domain, steps: body.steps, feedbacks: body.feedbacks }));
  } catch (e) {
    appendLog({ source: 'ui', level: 'error', text: `save pipeline: ${e.message}`, ts: Date.now() });
    return;
  }
  // Soft validator warnings (reachability/governance): the save succeeded, but
  // tell the user the topology is questionable. Toast the first, count the rest.
  if (warnings && warnings.length) {
    composerToast(warnings[0] + (warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ''));
  }
  await composerLoadSaved();
  // The server list is [Default, ...saved] — Default is ALWAYS first, so do NOT blindly
  // expand the first .pl-item (v1 bug: it auto-expanded Default, not the new pipeline).
  // Expand the row we just saved — match by returned id, then by name; if neither
  // matches, expand nothing rather than the wrong Default preview.
  const items = [...composer.els.list.querySelectorAll('.pl-item')];
  const row = (saved && saved.id && items.find((el) => el.dataset.id === saved.id))
    || items.find((el) => (el.querySelector('.pl-name')?.textContent || '').trim() === name);
  if (row) row.querySelector('.pl-row').click();
  const html = saveBtn.innerHTML;
  saveBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg> Saved';
  saveBtn.style.background = 'var(--green-ink)';
  setTimeout(() => { saveBtn.innerHTML = html; saveBtn.style.background = ''; }, 1400);
}

async function composerLoadSaved() {
  await loadEnabledPluginNames();
  composer.saved = await listWorkflows();
  composerRenderList();
}

function composerRoNode(a) {
  const ag = composerAgent(a.key);
  const d = document.createElement('div');
  d.className = 'node'; d.dataset.id = a.id; d.style.setProperty('--c', COMPOSER_COLORS[ag.color] || '#ccc');
  d.innerHTML =
    `<div class="nic" style="background:${COMPOSER_TINTS[ag.color] || '#eee'};color:${COMPOSER_COLORS[ag.color] || '#888'}">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">${safeAgentIcon(ag)}</svg></div>` +
    `<div class="nmeta"><b>${escapeHtml(ag.displayName)}</b><small>${escapeHtml(ag.description)}</small></div>`;
  return d;
}

function composerRenderRO(host, item) {
  const tag = document.createElement('div'); tag.className = 'pl-readonly-tag';
  tag.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke-linecap="round"/></svg> Read-only preview';
  host.appendChild(tag);
  const scroll = document.createElement('div'); scroll.className = 'ro-scroll';
  const f = document.createElement('div'); f.className = 'flow ro-flow';
  const w = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); w.setAttribute('class', 'wires');
  f.appendChild(w);
  for (let i = 0; i < item.steps.length; i++) {
    f.appendChild(Object.assign(document.createElement('div'), { className: 'strip' }));
    const col = document.createElement('div'); col.className = 'col';
    const ct = document.createElement('div'); ct.className = 'col-tag';
    ct.innerHTML = `Step ${i + 1}` + (item.steps[i].length > 1 ? ' · <em>parallel</em>' : '');
    col.appendChild(ct);
    item.steps[i].forEach((a) => col.appendChild(composerRoNode(a)));
    f.appendChild(col);
  }
  f.appendChild(Object.assign(document.createElement('div'), { className: 'strip' }));
  scroll.appendChild(f); host.appendChild(scroll);
  const paint = () => composerPaintWires(f, w, item.steps, item.feedbacks, { ns: item.id });
  requestAnimationFrame(() => requestAnimationFrame(paint));
  setTimeout(paint, 60);
}

let composerWfDomain = 'all';   // current filter

// Dynamic filter set (clarify Q4): distinct domains present among saved workflows,
// plus 'general', led by an 'all' option. wf_default (coding) participates like any row.
function composerWfDomains() {
  const seen = [];
  composer.saved.forEach((w) => { const d = w.domain || 'general';
    if (d !== 'general' && !seen.includes(d)) seen.push(d); });
  seen.push('general');
  return ['all', ...seen];
}

function composerRenderList() {
  const listEl = composer.els.list, cntEl = composer.els.count;
  listEl.innerHTML = '';
  cntEl.textContent = composer.saved.length + (composer.saved.length === 1 ? ' pipeline' : ' pipelines');
  // The first-run empty state keys off the UNFILTERED list, so a filtered-to-empty
  // domain shows an empty list under the chips, not the "no pipelines yet" copy.
  if (!composer.saved.length) {
    listEl.innerHTML = '<div class="pl-empty">No saved pipelines yet — build one above and hit "Save pipeline".</div>';
    return;
  }
  // Domain filter chip row, inserted just before the list (reused across renders).
  const filterDomains = composerWfDomains();
  const filterEl = listEl.previousElementSibling?.classList?.contains('wf-filter')
    ? listEl.previousElementSibling
    : (() => { const el = document.createElement('div'); el.className = 'wf-filter';
               listEl.parentNode.insertBefore(el, listEl); return el; })();
  filterEl.innerHTML = '';
  filterDomains.forEach((d) => {
    const c = document.createElement('button'); c.type = 'button';
    c.className = 'pal-chip' + (composerWfDomain === d ? '' : ' off');
    c.textContent = d; c.addEventListener('click', () => { composerWfDomain = d; composerRenderList(); });
    filterEl.appendChild(c);
  });
  const rows = composerWfDomain === 'all'
    ? composer.saved
    : composer.saved.filter((w) => (w.domain || 'general') === composerWfDomain);
  rows.forEach((item) => {
    const used = distinctAgents(item.steps);
    const chips = used.map((k) => {
      const ag = composerAgent(k);
      return `<span class="pl-chip"><span class="d" style="background:${COMPOSER_COLORS[ag.color] || '#ccc'}"></span>${escapeHtml(ag.displayName)}</span>`;
    }).join('');
    const meta = metaLine(item.steps, item.feedbacks).replace(
      / · (\d+ feedback loops?)$/, ' · <em>$1</em>',
    );
    const wrap = document.createElement('div'); wrap.className = 'pl-item'; wrap.dataset.id = item.id;
    const isDefault = item.id === 'wf_default';
    wrap.innerHTML =
      `<div class="pl-row">` +
        `<svg class="pl-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
        `<div class="pl-main">` +
          `<div class="pl-name">${escapeHtml(workflowPickerLabel(item, enabledPluginNames) || item.name)} <span class="pl-domain">${escapeHtml(item.domain || 'general')}</span></div>` +
          `<div class="pl-meta">${meta}</div>` +
          `<div class="pl-chips">${chips}</div>` +
        `</div>` +
        (isDefault ? '' : `<button type="button" class="pl-del" title="Delete pipeline"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`) +
      `</div>` +
      `<div class="pl-body"></div>`;
    listEl.appendChild(wrap);
    const row = wrap.querySelector('.pl-row');
    const del = wrap.querySelector('.pl-del');
    const body = wrap.querySelector('.pl-body');
    if (del) del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
      try { await deleteWorkflow(item.id); } catch (err) {
        appendLog({ source: 'ui', level: 'error', text: `delete pipeline: ${err.message}`, ts: Date.now() }); return;
      }
      await composerLoadSaved();
    });
    row.addEventListener('click', () => {
      const open = wrap.classList.toggle('open');
      if (open) {
        if (!body.dataset.rendered) { composerRenderRO(body, item); body.dataset.rendered = '1'; }
        else {
          const f = body.querySelector('.ro-flow'), w = body.querySelector('.wires');
          if (f && w) requestAnimationFrame(() => composerPaintWires(f, w, item.steps, item.feedbacks, { ns: item.id }));
        }
      }
    });
  });
}

function modelById(id) {
  return state.models.find((m) => m.id === id) || null;
}

function option(value, text) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

// ---------------------------------------------------------------------------
// New-Pipeline workflow config: PURE helpers (no DOM, no fetch). These flatten a
// workflow's topology + the per-project run-config into row data the renderers
// paint. Exposed on window.__np so jsdom unit tests can exercise them directly.
// ---------------------------------------------------------------------------

// Flatten workflow.steps[][] into an ordered list of node rows, joining each
// node's role `key` to its registry metadata (label/color) and resolving every
// setting through the four layers (newpipeline-ux-design.md §4.3):
//   1. the per-project override — run-config nodes[nodeId], or, for the built-in
//      Default workflow, the legacy per-role opts.legacySteps[key];
//   2. the workflow's own node.defaults;
//   3. the agent-registry sidecar (fanOut / questionsDefault);
//   4. nothing configured — the CLI default.
// Order = outer (sequential) then inner (parallel) — exactly the dispatch order.
//
// model/effort/fanOut/askQuestions on the returned row are the EFFECTIVE values
// (what the run will use). `def` carries the same four resolved WITHOUT layer 1,
// so the renderer can mark deviation and the writer can prune a redundant save
// back to "inherit". `override` is layer 1 verbatim.
function buildNodeConfigRows(workflow, registry, runConfig, opts = {}) {
  const steps = Array.isArray(workflow && workflow.steps) ? workflow.steps : [];
  const reg = registry || {};
  const nodes = (runConfig && runConfig.nodes) || {};
  const legacySteps = opts.legacySteps || null; // wf_default only: per-ROLE storage
  const rows = [];
  steps.forEach((group, stepIndex) => {
    const members = Array.isArray(group) ? group : [];
    members.forEach((node) => {
      if (!node || !node.id) return;
      const meta = reg[node.key] || null;
      // The Default workflow's overrides live under the role key; a saved
      // workflow's under the node-instance id. Both can exist for wf_default
      // (a node write wins, mirroring resolveWorkflow's firstDefined order).
      const role = legacySteps ? node.key : null;
      const saved = { ...(role ? legacySteps[role] : null), ...nodes[node.id] };
      const wfDef = (node.defaults && typeof node.defaults === 'object') ? node.defaults : {};
      const metaFan = meta && typeof meta.fanOut === 'boolean' ? meta.fanOut : false;
      const metaAsks = !!(meta && meta.asksQuestions);
      const metaLocked = !!(meta && meta.questionsLocked);
      const metaQDefault = !!(meta && meta.questionsDefault);

      const override = {};
      if (typeof saved.model === 'string' && saved.model) override.model = saved.model;
      if (typeof saved.effort === 'string' && saved.effort) override.effort = saved.effort;
      if (typeof saved.fanOut === 'boolean') override.fanOut = saved.fanOut;
      if (typeof saved.askQuestions === 'boolean') override.askQuestions = saved.askQuestions;

      // Layers 2-4 alone: what this row falls back to once its override is gone.
      const def = {
        model: typeof wfDef.model === 'string' ? wfDef.model : '',
        effort: typeof wfDef.model === 'string' && typeof wfDef.effort === 'string' ? wfDef.effort : '',
        fanOut: typeof wfDef.fanOut === 'boolean' ? wfDef.fanOut : metaFan,
        askQuestions: typeof wfDef.askQuestions === 'boolean' ? wfDef.askQuestions : metaQDefault,
      };

      // An effort is only meaningful for the model that advertises it, so an
      // override naming its own model does not inherit the default's effort.
      const model = override.model !== undefined ? override.model : def.model;
      const effort = override.effort !== undefined
        ? override.effort
        : (override.model !== undefined ? '' : def.effort);
      const fanOut = override.fanOut !== undefined ? override.fanOut : def.fanOut;
      const askQuestions = override.askQuestions !== undefined ? override.askQuestions : def.askQuestions;

      rows.push({
        nodeId: node.id,
        key: node.key,
        role, // non-null => persist via the legacy per-role path (saveStep)
        label: (meta && meta.displayName) || node.key || node.id,
        color: (meta && meta.color) || '',
        description: (meta && meta.description) || '',
        stepIndex,
        parallel: members.length > 1,
        model,
        effort,
        fanOut,
        // null => the agent has no questions capability (no checkbox rendered).
        askQuestions: !metaAsks ? null : (metaLocked ? metaQDefault : askQuestions),
        questionsLocked: metaAsks && metaLocked,
        def,
        override,
        // A locked questions toggle is never the user's doing, so it never counts
        // as a modification (it cannot be reset either).
        modified: modifiedFieldsOf({ model, effort, fanOut, askQuestions }, def,
          { asksQuestions: metaAsks, questionsLocked: metaLocked }).length > 0,
      });
    });
  });
  return rows;
}

// Which of the four settings deviate from the row's resolved default. Pure; the
// single definition of "modified" for both the row dot and the header count.
function modifiedFieldsOf(effective, def, caps = {}) {
  const out = [];
  if ((effective.model || '') !== (def.model || '')) out.push('model');
  if ((effective.effort || '') !== (def.effort || '')) out.push('effort');
  if (!!effective.fanOut !== !!def.fanOut) out.push('fanOut');
  if (caps.asksQuestions && !caps.questionsLocked && !!effective.askQuestions !== !!def.askQuestions) {
    out.push('askQuestions');
  }
  return out;
}

// One row's collapsed caption: the effective config in one line. "default" when
// nothing deviates from the CLI/registry baseline; otherwise model · effort and
// any active flag. Mirrors nodeModelLine's vocabulary so the New-Pipeline row and
// the run-graph node read the same.
function agentSummaryText(row) {
  const parts = [];
  if (row.model) {
    const m = modelById(row.model);
    parts.push(m ? m.label : row.model, row.effort || 'default effort');
  }
  if (row.fanOut) parts.push('fan-out');
  if (row.askQuestions) parts.push('questions');
  if (!parts.length) return 'default';
  if (!row.model) parts.unshift('default');
  return parts.join(' · ');
}

// The accordion header's one-line state: how many rows carry an override.
function agentsHeaderText(rows) {
  const n = rows.filter((r) => r.modified).length;
  if (!rows.length) return '';
  return n === 0 ? 'all defaults' : `${n} modified`;
}

// Prune a row's would-be selection against its resolved default (§4.5): a value
// equal to the default is stored as "inherit" instead — '' clears a model/effort,
// null clears a boolean toggle (config.mjs#inheritOr). Returns the patch to send.
// `next` carries only the fields the caller is changing; the rest ride along at
// their current effective value so the setters' replace semantics cannot wipe them.
function pruneNodeSelection(row, next = {}) {
  const eff = {
    model: next.model !== undefined ? next.model : row.model,
    effort: next.effort !== undefined ? next.effort : row.effort,
    fanOut: next.fanOut !== undefined ? next.fanOut : row.fanOut,
    askQuestions: next.askQuestions !== undefined ? next.askQuestions : row.askQuestions,
  };
  // model+effort prune as a PAIR: an effort is only interpretable against the
  // model that advertises it, so storing one without the other is rejected by
  // the setters ("select a model before choosing an effort").
  const inheritPair = (eff.model || '') === (row.def.model || '')
    && (eff.effort || '') === (row.def.effort || '');
  return {
    model: inheritPair ? '' : (eff.model || ''),
    effort: inheritPair || !eff.model ? '' : eff.effort,
    fanOut: !!eff.fanOut === !!row.def.fanOut ? null : !!eff.fanOut,
    askQuestions: row.askQuestions === null || row.questionsLocked
      ? undefined // no capability / locked: never persist a value for it
      : (!!eff.askQuestions === !!row.def.askQuestions ? null : !!eff.askQuestions),
  };
}

// Flatten workflow.feedbacks into row data for the per-loop cycle-count inputs,
// overlaying the run-config's saved maxCycles (default 3 when unset). Resolves each
// loop's endpoints (node ids like "s2_0") to human agent names via the registry +
// workflow.steps, and precomputes the directional `label`:
//   - normal loop:  "<toName> ← <fromName>"   (feedback points to <- from)
//   - self loop:    "<name> ↺ (self loop)"    (from === to)
// A "(step N)" suffix (1-based) disambiguates an endpoint whose display name is shared
// by more than one node in the workflow. Unknown ids fall back to the raw id.
function buildFeedbackRows(workflow, registry, runConfig) {
  const steps = Array.isArray(workflow && workflow.steps) ? workflow.steps : [];
  const fbs = Array.isArray(workflow && workflow.feedbacks) ? workflow.feedbacks : [];
  const reg = registry || {};
  const saved = (runConfig && runConfig.feedbacks) || {};

  // node id -> { name, step } (1-based) + a display-name frequency map so the
  // "(step N)" suffix is added only when a name is non-unique.
  const byId = new Map();
  const nameCount = new Map();
  steps.forEach((group, stepIndex) => {
    (Array.isArray(group) ? group : []).forEach((node) => {
      if (!node || !node.id) return;
      const meta = reg[node.key] || null;
      const name = (meta && meta.displayName) || node.key || node.id; // mirror buildNodeConfigRows
      byId.set(node.id, { name, step: stepIndex + 1 });
      nameCount.set(name, (nameCount.get(name) || 0) + 1);
    });
  });

  // Endpoint label: display name, disambiguated with "(step N)" when that name is
  // shared by >1 node. Ids absent from steps fall back to the raw id (never blank).
  const labelFor = (nodeId) => {
    const info = byId.get(nodeId);
    if (!info) return nodeId;
    return (nameCount.get(info.name) || 0) > 1 ? `${info.name} (step ${info.step})` : info.name;
  };

  return fbs.map((fb) => {
    const rc = saved[fb.id] || {};
    const n = Number(rc.maxCycles);
    const fromLabel = labelFor(fb.from);
    const toLabel = labelFor(fb.to);
    const selfLoop = fb.from === fb.to;
    const label = selfLoop ? `${toLabel} ↺ (self loop)` : `${toLabel} ← ${fromLabel}`;
    return {
      fbId: fb.id,
      from: fb.from,
      to: fb.to,
      fromLabel,
      toLabel,
      selfLoop,
      label,
      maxCycles: Number.isFinite(n) && n >= 1 ? n : 3,
    };
  });
}

// First effort a model supports (used to seed a node's effort caption when none
// is saved). '' when the model is unknown or advertises no efforts.
function defaultEffortFor(modelId) {
  const m = modelById(modelId);
  return m && Array.isArray(m.efforts) && m.efforts.length ? m.efforts[0] : '';
}

// Test hook: expose the pure helpers (and a couple of collaborators the tests
// reuse) without leaking them into the app's runtime contract.
if (typeof window !== 'undefined') {
  window.__np = Object.assign(window.__np || {}, {
    composer, composerRefresh,
    buildNodeConfigRows,
    buildFeedbackRows,
    defaultEffortFor,
    renderModelEffortPair,
    renderAgentRows,
    renderFeedbackRows,
    renderWorkflowConfig,
    modifiedFieldsOf,
    agentSummaryText,
    agentsHeaderText,
    pruneNodeSelection,
    saveAgentRow,
    setAgentRowsEnabled,
    effectiveDefaultsOf,
    openAgentRows,
    _setModels: (m) => { state.models = Array.isArray(m) ? m : []; },
    manifestFor,
    manifestSig,
    makeRun,
    onLog,
    maybeAutoscrollLog,
    setAutoscroll,
    onSubagent,
    onState,
    getRun: (id) => runs.get(id),
    durByNode,
    costByNode,
    subsByNode,
    subsByNodeArrays,
    subsByNodeCycleArrays,
    subsGroupsForRender,
    agentNodeIdSet,
    stepStatusByKey,
    cyclesPerNode,
    cycleAwareLabel,
    subAgentsOf,
    findManifestNode,
    subAgentsForNode,
    composerPaintWires,
    buildRunGraph,
    runNode,
    nodeModelLine,
    loopCounts,
    paintRunGraph,
    histNodeCycle,
    subFanHtml,
    subsPillText,
    paintSubsBar,
    subGroupStatus,
    renderSubsTree,
    skillPillsHtml,
    agentTypePillHtml,
    graphifyCountPillHtml,
    onStepSkills,
    onStepGraphify,
    stepSkillsFromSteps,
    stepGraphifyFromSteps,
    nodeLabelLookup,
    statusPill,
    buildHistCard,
    histStatusMeta,
    histPrEligible,
    pauseRun,
    nodeKindFor,
    upsertRun,
    buildRunCard,
    paintRunCard,
    onHello,
    isPaused,
    resumeRunFromCard,
    seedResumedLog,
  });
}

// Paint one model+effort select pair (and its caption) from a saved selection
// {model,effort}. Shared by the legacy default-stage rows and the dynamic
// per-node rows so the dropdown contents + effort filtering live in one place.
function renderModelEffortPair(modelSel, effortSel, caption, sel = {}) {
  // Model dropdown: "(default model)", then the models grouped — user-defined
  // (global + legacy project) first, plugin-provided second, built-ins third,
  // each group sorted alphabetically by label — then "+ Add model…".
  // Provenance is carried by the optgroup label, not a per-option suffix; only
  // when the same LABEL appears more than once does a plugin option get its
  // plugin name appended (design §9.6, collision-only), and the observed §4.6
  // "cost not verified" flag still marks an option.
  modelSel.innerHTML = '';
  modelSel.appendChild(option('', '(default model)'));
  const byLabel = (a, b) => (a.label || a.id).localeCompare(b.label || b.id, undefined, { sensitivity: 'base' });
  const labelCounts = new Map();
  for (const m of state.models) {
    const lc = (m.label || m.id).toLowerCase();
    labelCounts.set(lc, (labelCounts.get(lc) || 0) + 1);
  }
  const optgroup = (label, models) => {
    if (!models.length) return;
    const og = document.createElement('optgroup');
    og.label = label;
    for (const m of models) {
      const ambiguous = m.custom === 'plugin' && labelCounts.get((m.label || m.id).toLowerCase()) > 1;
      og.appendChild(option(m.id,
        m.label + (ambiguous ? ` (${m.plugin})` : '') + (m.costUnreliable ? ' ⚠cost' : '')));
    }
    modelSel.appendChild(og);
  };
  optgroup('Your models', state.models.filter((m) => m.custom && m.custom !== 'plugin').sort(byLabel));
  optgroup('Plugins', state.models.filter((m) => m.custom === 'plugin').sort(byLabel));
  optgroup('Built-in', state.models.filter((m) => !m.custom).sort(byLabel));
  modelSel.appendChild(option('__add__', '+ Add model…'));
  modelSel.value = sel.model || '';

  // Effort dropdown: filtered to the selected model's supported efforts. With no
  // model there is no list to offer — which efforts are valid is a property of
  // the model — so the control is disabled. It SAYS so rather than just greying
  // out, because a dead dropdown next to a live one reads as a broken UI.
  const model = modelById(modelSel.value);
  effortSel.innerHTML = '';
  effortSel.appendChild(option('', model ? '(default effort)' : '(pick a model first)'));
  (model ? model.efforts : []).forEach((e) => effortSel.appendChild(option(e, e)));
  effortSel.value = sel.effort && model && model.efforts.includes(sel.effort) ? sel.effort : '';

  modelSel.disabled = false;
  effortSel.disabled = !model;
  effortSel.title = model ? '' : 'Pick a model first — the effort levels on offer are that model’s own.';

  if (caption) {
    const mLabel = model ? model.label : 'default model';
    caption.textContent = `${mLabel} · ${effortSel.value || 'default effort'}`;
  }
}

// The built-in Default workflow, client-side. Two jobs: (1) it is the topology
// the accordion paints when GET /api/workflows/wf_default cannot be reached, so a
// server hiccup never leaves the page without agent rows; (2) its labels/colors/
// descriptions are the fallback registry for those five keys when /api/agents
// fails — this is the markup the static #wf-default-stages block used to hold.
const DEFAULT_WF_TOPOLOGY = Object.freeze({
  id: 'wf_default',
  name: 'Default',
  steps: [
    [{ id: 's_clarify', key: 'clarify' }],
    [{ id: 's0_0', key: 'planner' }],
    [{ id: 's1_0', key: 'refiner' }],
    [{ id: 's2_0', key: 'implementer' }],
    [{ id: 's3_0', key: 'reviewer' }],
  ],
  feedbacks: [
    { id: 'fb_refine', from: 's1_0', to: 's1_0' },
    { id: 'fb_review', from: 's3_0', to: 's2_0' },
  ],
});

const DEFAULT_STAGE_META = Object.freeze({
  clarify: { displayName: 'Clarify', color: 'red', description: 'Turns hidden decisions into questions before planning' },
  planner: { displayName: 'Plan', color: 'violet', description: 'Explores the codebase and writes the implementation plan' },
  refiner: { displayName: 'Refine', color: 'green', description: 'Rewrites the latest plan into a tighter version' },
  implementer: { displayName: 'Implement', color: 'peach', description: 'Writes the code from the approved plan, strict TDD' },
  reviewer: { displayName: 'Review', color: 'blue', description: 'Reviews the implementation diff against the plan' },
});

// Registry for the Default workflow's rows, layered weakest-first: the static
// label/color map, then the per-step sidecar flags /api/config already delivered
// (fanOut / questions capability), then the live /api/agents entry. Any one layer
// can be missing and the rows still paint with real names and real capabilities.
function defaultWorkflowRegistry(fetched) {
  const out = {};
  for (const [key, base] of Object.entries(DEFAULT_STAGE_META)) {
    out[key] = { key, ...base, ...(state.stepDefaults[key] || {}), ...((fetched || {})[key] || {}) };
  }
  return { ...(fetched || {}), ...out };
}

// ---------------------------------------------------------------------------
// New-Pipeline workflow selector. Populates #workflowSelect from
// GET /api/workflows; on change, renders per-node model/effort pickers + per-
// feedback cycle inputs for the chosen workflow (or the legacy default stages).
// ---------------------------------------------------------------------------

// --- API wrappers (existing fetch()/safeJson style) ---
// Returns the workflow list, or null on failure — callers must distinguish
// "the server has no saved workflows" ([]) from "the list could not be
// fetched" (null), or a transient failure silently rebuilds the dropdown to
// Default-only and reroutes the next run to wf_default.
async function listWorkflowsApi() {
  try {
    const res = await fetch('/api/workflows');
    const data = await safeJson(res);
    return res.ok && Array.isArray(data.workflows) ? data.workflows : null;
  } catch { return null; }
}

async function getWorkflowApi(id) {
  if (state.workflowCache[id]) return state.workflowCache[id];
  try {
    const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`);
    const data = await safeJson(res);
    if (!res.ok || !data || !Array.isArray(data.steps)) return null;
    state.workflowCache[id] = data;
    return data;
  } catch { return null; }
}

async function getAgentsApi() {
  if (Object.keys(state.agents).length) return state.agents;
  try {
    const res = await fetch('/api/agents');
    const data = await safeJson(res);
    const list = res.ok && Array.isArray(data.agents) ? data.agents : [];
    state.agents = Object.fromEntries(list.map((a) => [a.key, a]));
    return state.agents;
  } catch { return state.agents; }
}

// Enabled-plugin names for workflow-picker labels (§9.3/§6.5). null = plugin
// list not known yet (fetch pending/failed) — workflowPickerLabel then skips
// the conservative "— disabled" flag. Refreshed once per view-open.
let enabledPluginNames = null;
async function loadEnabledPluginNames() {
  try {
    const res = await fetch('/api/plugins');
    const data = await safeJson(res);
    if (res.ok && Array.isArray(data.plugins)) {
      enabledPluginNames = data.plugins.filter((p) => p.enabled).map((p) => p.name);
      return;
    }
  } catch { /* endpoint absent/down -> suffix-free labels */ }
  enabledPluginNames = null;
}

// Fill #workflowSelect with Default + saved names, preserving/falling back to
// the active selection (state.workflowId), then render that workflow's config.
async function loadWorkflowsInto(selectId) {
  const sel = el.workflowSelect;
  if (!sel) return;
  await loadEnabledPluginNames();
  const workflows = await listWorkflowsApi();
  if (workflows === null) {
    // List fetch failed: keep whatever the dropdown already shows (do NOT
    // rebuild to Default-only — that would silently reroute the next run) and
    // still render the current selection's config.
    appendLog({ source: 'ui', level: 'error', text: 'workflows: list failed', ts: Date.now() });
    await renderWorkflowConfig(state.workflowId);
    return;
  }
  const list = workflows.length ? workflows : [{ id: 'wf_default', name: 'Default' }];
  const want = selectId || state.workflowId || 'wf_default';
  sel.innerHTML = '';
  list.forEach((wf) => sel.appendChild(option(wf.id, workflowPickerLabel(wf, enabledPluginNames) || wf.id)));
  // Fall back to default if the wanted id is gone (e.g. a deleted workflow).
  state.workflowId = list.some((wf) => wf.id === want) ? want : 'wf_default';
  sel.value = state.workflowId;
  await renderWorkflowConfig(state.workflowId);
}

// Returns the guardrail-set list, or null on failure — callers must distinguish
// "server answered" (built-ins are always present) from "the list could not be
// fetched" (null), or a transient failure silently rebuilds the dropdown to
// Permissive-only and reroutes the next run's policy.
async function listGuardrailsApi() {
  try {
    const res = await fetch('/api/guardrails');
    const data = await safeJson(res);
    return res.ok && Array.isArray(data.guardrails) ? data.guardrails : null;
  } catch { return null; }
}

// Hint: the SELECTED set's summary (raw 5-key counts via guardrailSummary — the
// run.json audit's denyCount additionally includes the Read/Edit expansion +
// lifted repo rules, so the hint speaks in list counts, not audit numbers).
function updateGuardrailsHint() {
  if (!el.guardrailsHint) return;
  const sel = state.guardrailSets.find((g) => g.id === state.guardrailsId) || null;
  if (!sel || sel.id === 'permissive') {
    el.guardrailsHint.textContent = 'Applies to every agent this run spawns. Permissive = no restrictions (the legacy default).';
    return;
  }
  const members = state.runTarget === 'workspace' ? ' across every workspace member' : '';
  el.guardrailsHint.textContent = `This run: ${guardrailSummary(sel.settings)} — applied uniformly${members}.`;
}

// Fill #guardrailsSelect with every named set (built-ins first — server order),
// preserving the active selection (state.guardrailsId). Mirrors loadWorkflowsInto.
async function loadGuardrailsInto(selectId) {
  const sel = el.guardrailsSelect;
  if (!sel) return;
  const sets = await listGuardrailsApi();
  if (sets === null) {
    // List fetch failed: keep whatever the dropdown already shows (do NOT
    // rebuild to Permissive-only — that would silently reroute the next run's
    // policy) and note it non-blockingly in the log pane.
    appendLog({ source: 'ui', level: 'error', text: 'guardrails: list failed', ts: Date.now() });
    updateGuardrailsHint();
    return;
  }
  const list = sets.length ? sets : [{ id: 'permissive', name: 'Permissive', settings: null }];
  state.guardrailSets = list;
  const want = selectId || state.guardrailsId || 'permissive';
  sel.innerHTML = '';
  list.forEach((g) => sel.appendChild(option(g.id, g.id === 'permissive' ? 'Permissive (default)' : g.name)));
  // Fall back to the Permissive default if the wanted id is gone (deleted set) —
  // and SAY so via the form's message line: a vanished selection must never
  // silently revert while the user believes it is still selected.
  state.guardrailsId = list.some((g) => g.id === want) ? want : 'permissive';
  if (want !== 'permissive' && state.guardrailsId === 'permissive') {
    setFormMsg(`Guardrail set "${want}" no longer exists — this run will use Permissive (no restrictions).`, 'err');
  }
  sel.value = state.guardrailsId;
  updateGuardrailsHint();
  // A restored non-Permissive set is active state, so Advanced must not hide it.
}

// Render the config UI for one workflow. Default -> show the legacy 4 stage rows
// and hide the dynamic containers. Saved -> fetch topology + registry, render a
// node row per node and a cycle input per feedback.
async function renderWorkflowConfig(workflowId) {
  const isDefault = !workflowId || workflowId === 'wf_default';
  const [fetchedWf, fetchedReg] = await Promise.all([getWorkflowApi(workflowId), getAgentsApi()]);
  // The Default workflow has offline fallbacks for both halves (topology + the
  // five stage metas), so it always paints. A saved workflow has neither: an
  // empty registry is a failed /api/agents fetch, not a real state, and painting
  // rows against it would silently strip capability (labels degrade to raw keys,
  // every questions toggle vanishes), so it is treated like a failed fetch.
  const wf = isDefault ? (fetchedWf || DEFAULT_WF_TOPOLOGY) : fetchedWf;
  const registry = isDefault ? defaultWorkflowRegistry(fetchedReg) : fetchedReg;
  if (!wf || !Object.keys(registry).length) {
    if (el.agentRows) el.agentRows.innerHTML = '<div class="hint">Could not load this workflow.</div>';
    if (el.wfFeedbackConfig) { el.wfFeedbackConfig.innerHTML = ''; el.wfFeedbackConfig.hidden = true; }
    setAgentsHeader(null, '');
    return;
  }
  const runConfig = (state.config.workflows && state.config.workflows[workflowId]) || { nodes: {}, feedbacks: {} };
  // wf_default stores its overrides per ROLE (the legacy `steps` blob the CLI and
  // every older install write); saved workflows store them per node id.
  const rows = buildNodeConfigRows(wf, registry, runConfig,
    isDefault ? { legacySteps: state.config.steps || {} } : {});
  renderAgentRows(rows);
  renderFeedbackRows(buildFeedbackRows(wf, registry, runConfig));
  setAgentsHeader(rows, wf.name || workflowId);
  setAgentRowsEnabled(agentsEditable());
}

// Per-agent config is stored PER PROJECT, so with no project selected there is
// nowhere to write it. Rows still render (seeing what a workflow will do is
// useful on its own) but every control is disabled and the header says why —
// previously an edit was accepted, silently dropped by the save, and then
// reverted by the re-render, which read as "the control doesn't work".
function agentsEditable() {
  return !!selectedProjectPath();
}

/** Disable (or re-enable) every control in the accordion. */
function setAgentRowsEnabled(enabled) {
  const host = el.agentRows;
  if (!host) return;
  for (const c of host.querySelectorAll('.step-model,.step-fanout,.step-questions')) {
    c.disabled = !enabled || (c.classList.contains('step-questions') && c.dataset.locked === '1');
  }
  for (const e of host.querySelectorAll('.step-effort')) {
    // Keep the model-dependency rule: effort stays disabled without a model.
    if (!enabled) e.disabled = true;
  }
  if (el.wfFeedbackConfig) {
    for (const i of el.wfFeedbackConfig.querySelectorAll('input[data-fb-id]')) i.disabled = !enabled;
  }
}

// Paint the accordion header: the "all defaults / N modified" summary plus the
// two actions, which only appear when they would do something.
function setAgentsHeader(rows, workflowName) {
  const editable = agentsEditable();
  // The picker sits up with the task now, so the header has to say which
  // workflow these rows belong to.
  if (el.agentsWorkflow) el.agentsWorkflow.textContent = workflowName || '';
  if (el.agentsSummary) {
    el.agentsSummary.textContent = !rows ? ''
      : (editable ? agentsHeaderText(rows) : 'select a project to change these');
    el.agentsSummary.classList.toggle('muted', !editable);
  }
  const anyModified = editable && !!rows && rows.some((r) => r.modified);
  if (el.agentsReset) el.agentsReset.hidden = !anyModified;
  if (el.agentsPromote) {
    // The built-in Default is frozen and never persisted, so it has no row to
    // carry defaults (design D6) — offering the button there would only fail.
    const canPromote = anyModified && state.workflowId && state.workflowId !== 'wf_default';
    el.agentsPromote.hidden = !canPromote;
  }
}

// Build the agents accordion into #agents-rows: one collapsed .agent-row per node
// (accent + name + effective-config caption + modified dot), whose body holds the
// same model/effort/fan-out/questions controls the old always-open .stage-cfg card
// did — same classes and data-node-id, so the delegated change handler and
// renderModelEffortPair are unchanged (newpipeline-ux-design.md §4.2).
function renderAgentRows(rows) {
  const host = el.agentRows;
  if (!host) return;
  host.innerHTML = '';
  agentRowsById = Object.fromEntries(rows.map((r) => [r.nodeId, r]));
  // Rows that vanished (workflow switched) must not keep the accordion open.
  const ids = new Set(rows.map((r) => r.nodeId));
  for (const id of [...openAgentRows]) if (!ids.has(id)) openAgentRows.delete(id);

  rows.forEach((row) => {
    const open = openAgentRows.has(row.nodeId);
    const bodyId = `agent-body-${row.nodeId}`;

    const card = document.createElement('div');
    card.className = 'agent-row' + (open ? ' open' : '');
    card.dataset.nodeId = row.nodeId;

    // --- collapsed head (the whole row is one button: click or Enter/Space) ---
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'agent-row-head';
    head.dataset.nodeId = row.nodeId;
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    head.setAttribute('aria-controls', bodyId);

    const chev = document.createElement('span');
    chev.className = 'agent-chev';
    chev.setAttribute('aria-hidden', 'true');

    const acc = document.createElement('span');
    acc.className = 'acc' + (row.color ? ' ' + row.color : '');

    const name = document.createElement('span');
    name.className = 'agent-name';
    name.textContent = row.label;
    name.title = row.description || row.label;

    const step = document.createElement('span');
    step.className = 'agent-step';
    step.textContent = row.parallel ? `step ${row.stepIndex + 1} · parallel` : `step ${row.stepIndex + 1}`;

    const sum = document.createElement('span');
    sum.className = 'agent-sum';
    sum.dataset.nodeId = row.nodeId;
    sum.textContent = agentSummaryText(row);

    head.append(chev, acc, name, step, sum);
    if (row.modified) {
      const dot = document.createElement('span');
      dot.className = 'agent-mod';
      dot.title = 'Overrides this workflow’s default';
      dot.textContent = '●';
      head.appendChild(dot);
    }
    card.appendChild(head);

    // --- expanded body: the controls, unchanged in class + data contract ---
    const body = document.createElement('div');
    body.className = 'agent-row-body';
    body.id = bodyId;
    body.hidden = !open;

    // What this agent does, in full. The collapsed head has no room for it, so
    // the blurb lives here where it can wrap instead of being ellipsized away.
    if (row.description) {
      const desc = document.createElement('small');
      desc.className = 'agent-desc';
      desc.textContent = row.description;
      body.appendChild(desc);
    }

    const picks = document.createElement('div');
    picks.className = 'picks';
    const mWrap = document.createElement('div');
    mWrap.className = 'select-wrap';
    const modelSel = document.createElement('select');
    modelSel.className = 'step-model select';
    modelSel.dataset.nodeId = row.nodeId;
    if (row.role) modelSel.dataset.role = row.role;
    modelSel.setAttribute('aria-label', `${row.label} model`);
    mWrap.appendChild(modelSel);
    const eWrap = document.createElement('div');
    eWrap.className = 'select-wrap';
    const effortSel = document.createElement('select');
    effortSel.className = 'step-effort select';
    effortSel.dataset.nodeId = row.nodeId;
    if (row.role) effortSel.dataset.role = row.role;
    effortSel.setAttribute('aria-label', `${row.label} effort`);
    eWrap.appendChild(effortSel);
    const fanWrap = document.createElement('label');
    fanWrap.className = 'fanout-toggle';
    const fanCb = document.createElement('input');
    fanCb.type = 'checkbox';
    fanCb.className = 'step-fanout';
    fanCb.dataset.nodeId = row.nodeId;
    if (row.role) fanCb.dataset.role = row.role;
    fanCb.setAttribute('aria-label', `${row.label} fan-out`);
    fanCb.checked = !!row.fanOut;
    const fanTxt = document.createElement('span');
    fanTxt.textContent = 'Fan-out';
    fanWrap.append(fanCb, fanTxt);
    picks.append(mWrap, eWrap, fanWrap);
    if (row.askQuestions !== null && row.askQuestions !== undefined) {
      const qWrap = document.createElement('label');
      qWrap.className = 'fanout-toggle questions-toggle';
      if (row.questionsLocked) {
        qWrap.title = row.askQuestions ? 'Always on for this agent' : 'Always off for this agent';
      }
      const qCb = document.createElement('input');
      qCb.type = 'checkbox';
      qCb.className = 'step-questions';
      qCb.dataset.nodeId = row.nodeId;
      if (row.role) qCb.dataset.role = row.role;
      qCb.setAttribute('aria-label', `${row.label} questions`);
      qCb.checked = !!row.askQuestions;
      qCb.disabled = !!row.questionsLocked;
      // Marked so re-enabling the accordion (project selected) cannot un-lock an
      // agent whose questions setting is fixed by its manifest.
      if (row.questionsLocked) qCb.dataset.locked = '1';
      const qTxt = document.createElement('span');
      qTxt.textContent = 'Questions';
      qWrap.append(qCb, qTxt);
      picks.appendChild(qWrap);
    }
    body.appendChild(picks);

    // Where this row's values come from when nothing is overridden — the answer
    // to "what does 'default' actually mean here", without opening a doc.
    const origin = document.createElement('small');
    origin.className = 'agent-origin';
    origin.textContent = defaultOriginText(row);
    body.appendChild(origin);

    card.appendChild(body);
    // The collapsed head IS this row's caption (`sum` above), so the controls get
    // no second one — renderModelEffortPair's caption slot stays empty and
    // paintRowSummary keeps the head in step with the live selects.
    renderModelEffortPair(modelSel, effortSel, null, { model: row.model, effort: row.effort });
    host.appendChild(card);
  });
}

// Repaint one row's collapsed caption from what its controls currently show, so
// the head never lags the selects between a change and the save's re-render.
function paintRowSummary(row, body) {
  const head = el.agentRows && el.agentRows.querySelector(`.agent-sum[data-node-id="${row.nodeId}"]`);
  if (!head) return;
  head.textContent = agentSummaryText({ ...row, ...liveRowValues(row, body) });
}

// One line naming what this row falls back to once its override is gone — the
// answer to "what does 'default' actually mean here", without opening a doc.
function defaultOriginText(row) {
  if (!row.def.model) return 'No model set for this workflow — falls back to the CLI’s own default.';
  const m = modelById(row.def.model);
  const label = m ? m.label : row.def.model;
  return `This workflow’s default: ${label}${row.def.effort ? ` · ${row.def.effort}` : ''}.`;
}

// Build the feedback-loop cycle counts as the accordion's LAST row (§4.2, D4):
// one number input per loop, keyed by data-fb-id, collapsed by default because 3
// cycles is the sensible default nobody needs to see. A workflow with no loops
// renders no row at all.
function renderFeedbackRows(rows) {
  const host = el.wfFeedbackConfig;
  if (!host) return;
  host.innerHTML = '';
  host.hidden = !rows.length;
  if (!rows.length) return;

  const open = openAgentRows.has(FEEDBACK_ROW_ID);
  const card = document.createElement('div');
  card.className = 'agent-row' + (open ? ' open' : '');
  card.dataset.nodeId = FEEDBACK_ROW_ID;

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'agent-row-head';
  head.dataset.nodeId = FEEDBACK_ROW_ID;
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  head.setAttribute('aria-controls', 'agent-body-feedbacks');

  const chev = document.createElement('span');
  chev.className = 'agent-chev';
  chev.setAttribute('aria-hidden', 'true');
  const acc = document.createElement('span');
  acc.className = 'acc neutral'; // not an agent: no registry colour to carry
  const name = document.createElement('span');
  name.className = 'agent-name';
  name.textContent = 'Feedback loops';
  const sum = document.createElement('span');
  sum.className = 'agent-sum';
  sum.textContent = rows.map((r) => `${r.label} ×${r.maxCycles}`).join(' · ');
  head.append(chev, acc, name, sum);
  card.appendChild(head);

  const body = document.createElement('div');
  body.className = 'agent-row-body';
  body.id = 'agent-body-feedbacks';
  body.hidden = !open;

  const h = document.createElement('div');
  h.className = 'hint';
  h.style.margin = '0 0 8px';
  h.textContent = 'Max cycles before the loop gates to you.';
  body.appendChild(h);

  rows.forEach((row) => {
    const field = document.createElement('div');
    field.className = 'field fb-field';

    const label = document.createElement('label');
    label.textContent = `${row.label} — max cycles`;
    label.setAttribute('for', `fb-${row.fbId}`);
    field.appendChild(label);

    const input = document.createElement('input');
    input.id = `fb-${row.fbId}`;
    input.className = 'input';
    input.type = 'number';
    input.min = '1';
    input.value = String(row.maxCycles);
    input.dataset.fbId = row.fbId;
    field.appendChild(input);

    body.appendChild(field);
  });

  card.appendChild(body);
  host.appendChild(card);
}

// Workflow change: remember the selection and re-render its config.
if (el.workflowSelect) {
  el.workflowSelect.addEventListener('change', async () => {
    state.workflowId = el.workflowSelect.value || 'wf_default';
    saveActiveWorkflow(state.workflowId);
    await renderWorkflowConfig(state.workflowId);
  });
}

// Guardrails change: remember the run's set and refresh the summary hint.
if (el.guardrailsSelect) {
  el.guardrailsSelect.addEventListener('change', () => {
    state.guardrailsId = el.guardrailsSelect.value || 'permissive';
    updateGuardrailsHint();
  });
}

async function saveStep(role, model, effort, fanOut, askQuestions) {
  const projectDir = selectedProjectPath();
  if (!projectDir) return;
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir, step: role, model, effort, fanOut, askQuestions }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      appendLog({ source: 'ui', level: 'error', text: `config: ${data.error || res.status}`, ts: Date.now() });
      await renderWorkflowConfig(state.workflowId); // revert UI to the last persisted state
      return;
    }
    state.config = data.config || state.config;
  } catch (e) {
    appendLog({ source: 'ui', level: 'error', text: `config error: ${e.message}`, ts: Date.now() });
  }
}

// What a row's controls CURRENTLY show. The visible state is the truth: reading
// it back (rather than the last-rendered row data, or state.config, which lags an
// in-flight save) is what keeps a toggle from reverting a model picked a moment
// earlier. A disabled questions box is the agent's locked value, never the user's.
function liveRowValues(row, body) {
  const host = body || (el.agentRows
    && el.agentRows.querySelector(`.agent-row[data-node-id="${row.nodeId}"] .agent-row-body`));
  if (!host) return {};
  const out = {};
  const m = host.querySelector('.step-model');
  const e = host.querySelector('.step-effort');
  const f = host.querySelector('.step-fanout');
  const q = host.querySelector('.step-questions');
  if (m) out.model = m.value === '__add__' ? row.model : m.value;
  if (e) out.effort = e.value;
  if (f) out.fanOut = f.checked;
  if (q && !q.disabled) out.askQuestions = q.checked;
  return out;
}

// Persist one accordion row, pruning any value that matches its resolved default
// back to "inherit" (§4.5) so the stored run-config stays sparse and the row
// stops showing as modified. Routes to the per-ROLE writer for the built-in
// Default workflow and the per-NODE writer for a saved one. `next` carries only
// what the user just changed; everything else rides along at what the row's
// controls currently show.
async function saveAgentRow(row, next, body) {
  if (!row) return;
  // Defence in depth: the controls are disabled without a project, but if one
  // is ever reached anyway, say so rather than letting the save no-op and the
  // re-render quietly undo the edit. Same wording as the submit guard.
  if (!agentsEditable()) {
    setFormMsg('Select a project first (or add one).', 'err');
    await renderWorkflowConfig(state.workflowId);
    return;
  }
  const patch = pruneNodeSelection(row, { ...liveRowValues(row, body), ...next });
  if (row.role) {
    await saveStep(row.role, patch.model, patch.effort, patch.fanOut, patch.askQuestions);
  } else {
    await saveNode(state.workflowId, row.nodeId, patch.model, patch.effort, patch.fanOut, patch.askQuestions);
  }
  await renderWorkflowConfig(state.workflowId); // repaint captions, dots + header
}

// Persist one node's model/effort to the per-project run-config for the active
// workflow (CONV-2): PATCH /api/config { projectDir, workflowId, nodes:{ [nodeId]:{model,effort} } }.
async function saveNode(workflowId, nodeId, model, effort, fanOut, askQuestions) {
  const projectDir = selectedProjectPath();
  if (!projectDir) return;
  try {
    const res = await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir, workflowId, nodes: { [nodeId]: { model, effort, fanOut, askQuestions } } }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      appendLog({ source: 'ui', level: 'error', text: `config: ${data.error || res.status}`, ts: Date.now() });
      return;
    }
    if (data.config) state.config = data.config;
  } catch (e) {
    appendLog({ source: 'ui', level: 'error', text: `config error: ${e.message}`, ts: Date.now() });
  }
}

// Persist one feedback loop's cycle count (CONV-2): PATCH /api/config
// { projectDir, workflowId, feedbacks:{ [fbId]:{maxCycles} } }.
async function saveFeedback(workflowId, fbId, maxCycles) {
  const projectDir = selectedProjectPath();
  if (!projectDir) return;
  try {
    const res = await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir, workflowId, feedbacks: { [fbId]: { maxCycles } } }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      appendLog({ source: 'ui', level: 'error', text: `config: ${data.error || res.status}`, ts: Date.now() });
      return;
    }
    if (data.config) state.config = data.config;
  } catch (e) {
    appendLog({ source: 'ui', level: 'error', text: `config error: ${e.message}`, ts: Date.now() });
  }
}

// Persist the active workflow selection (CONV-2): PATCH /api/config { projectDir, activeWorkflowId }.
async function saveActiveWorkflow(workflowId) {
  const projectDir = selectedProjectPath();
  if (!projectDir) return;
  try {
    const res = await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir, activeWorkflowId: workflowId }),
    });
    const data = await safeJson(res);
    if (res.ok && data.config) state.config = data.config;
  } catch {
    /* selection is best-effort; ignore transient errors */
  }
}

// "+ Add model…" in any model dropdown: restore the selection and jump to the
// global Models view with the create editor open (models are added GLOBALLY —
// configurable-models-design.md §4.9; the old per-project window.prompt flow
// is gone).
function goAddModel(restore) {
  if (typeof restore === 'function') restore();
  mvState.editing = null;
  mvState.openCreate = true;
  mvState.openShare = false;
  mvState.prefill = null;
  showView('models'); // loadModelsView renders the open editor
}

// Delegated change handler for every config control inside #pipeline-config.
// Each control carries the node id of its accordion row; agentRowsById supplies
// that row's resolved defaults, so saveAgentRow can prune a redundant selection
// back to "inherit" and route to the right writer (per-role for wf_default, per
// node id for a saved workflow). Feedback cycle inputs carry data-fb-id instead.
el.pipelineConfig.addEventListener('change', (e) => {
  const t = e.target;

  // Feedback cycle inputs (number inputs, not selects).
  if (t instanceof HTMLInputElement && t.dataset.fbId) {
    const n = Math.max(1, Math.round(Number(t.value) || 1));
    t.value = String(n); // normalize the field
    saveFeedback(state.workflowId, t.dataset.fbId, n).then(() => renderWorkflowConfig(state.workflowId));
    return;
  }

  const row = agentRowsById[t.dataset ? t.dataset.nodeId : ''];
  if (!row) return;

  const body = t.closest ? t.closest('.agent-row-body') : null;

  if (t instanceof HTMLInputElement && t.type === 'checkbox') {
    if (!t.classList.contains('step-fanout') && !t.classList.contains('step-questions')) return;
    paintRowSummary(row, body);
    return void saveAgentRow(row, t.classList.contains('step-fanout')
      ? { fanOut: !!t.checked }
      : { askQuestions: !!t.checked }, body);
  }

  if (!(t instanceof HTMLSelectElement)) return;

  if (t.classList.contains('step-model')) {
    if (t.value === '__add__') return goAddModel(() => renderWorkflowConfig(state.workflowId));
    // A new model invalidates the old effort (the dropdown is filtered by it), so
    // the effort resets and the row's options are repainted immediately — the
    // save's own re-render lands a moment later.
    saveAgentRow(row, { model: t.value, effort: '' }, body);
    const effortSel = body && body.querySelector('.step-effort');
    if (effortSel) renderModelEffortPair(t, effortSel, null, { model: t.value, effort: '' });
    paintRowSummary(row, body);
  } else if (t.classList.contains('step-effort')) {
    saveAgentRow(row, { effort: t.value }, body);
    paintRowSummary(row, body);
  }
});

// Expand/collapse one accordion row. The whole head is a <button>, so keyboard
// activation (Enter/Space) arrives here as a click for free.
if (el.agentsConfig) {
  el.agentsConfig.addEventListener('click', (e) => {
    const head = e.target.closest ? e.target.closest('.agent-row-head') : null;
    if (!head || !el.agentsConfig.contains(head)) return;
    const card = head.closest('.agent-row');
    const body = card && card.querySelector('.agent-row-body');
    if (!body) return;
    const open = body.hidden; // about to open
    body.hidden = !open;
    card.classList.toggle('open', open);
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) openAgentRows.add(head.dataset.nodeId);
    else openAgentRows.delete(head.dataset.nodeId);
  });
}

// "Reset": drop every per-project override for this workflow, so each row falls
// back to the workflow's defaults and then the agent registry (§4.5).
if (el.agentsReset) {
  el.agentsReset.addEventListener('click', async () => {
    const projectDir = selectedProjectPath();
    if (!projectDir) return;
    const workflowId = state.workflowId || 'wf_default';
    try {
      const res = await fetch(
        `/api/config/workflow?projectDir=${encodeURIComponent(projectDir)}&workflowId=${encodeURIComponent(workflowId)}`,
        { method: 'DELETE' },
      );
      const data = await safeJson(res);
      if (!res.ok) {
        appendLog({ source: 'ui', level: 'error', text: `config: ${data.error || res.status}`, ts: Date.now() });
        return;
      }
      if (data.config) state.config = data.config;
      await renderWorkflowConfig(workflowId);
    } catch (err) {
      appendLog({ source: 'ui', level: 'error', text: `config error: ${err.message}`, ts: Date.now() });
    }
  });
}

// "Save as workflow defaults": promote this project's overrides into the
// workflow itself (§4.4/§4.8), then clear them — the effective config is
// unchanged, but it now travels with the workflow to every other project and
// through export/share. Disabled for wf_default, which cannot store defaults.
if (el.agentsPromote) {
  el.agentsPromote.addEventListener('click', async () => {
    const projectDir = selectedProjectPath();
    const workflowId = state.workflowId;
    if (!projectDir || !workflowId || workflowId === 'wf_default') return;
    const rows = Object.values(agentRowsById);
    if (!rows.length) return;
    const defaults = Object.fromEntries(rows.map((r) => [r.nodeId, effectiveDefaultsOf(r)]));
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}/defaults`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaults }),
      });
      const data = await safeJson(res);
      if (!res.ok) {
        appendLog({ source: 'ui', level: 'error', text: `workflow defaults: ${data.error || res.status}`, ts: Date.now() });
        return;
      }
      // The cached template still carries the OLD defaults; drop it so the
      // reset below repaints against what was just persisted.
      delete state.workflowCache[workflowId];
      el.agentsReset.click(); // clearing the now-redundant overrides is the second half
    } catch (err) {
      appendLog({ source: 'ui', level: 'error', text: `workflow defaults error: ${err.message}`, ts: Date.now() });
    }
  });
}

// One row's effective settings as a workflow-defaults block: only what deviates
// from the agent registry is worth storing, and a locked/absent questions toggle
// is never the user's to promote.
function effectiveDefaultsOf(row) {
  const out = {};
  if (row.model) {
    out.model = row.model;
    if (row.effort) out.effort = row.effort;
  }
  out.fanOut = !!row.fanOut;
  if (row.askQuestions !== null && !row.questionsLocked) out.askQuestions = !!row.askQuestions;
  return out;
}

// ---------------------------------------------------------------------------
// Log window
// ---------------------------------------------------------------------------
const MAX_LOG_LINES = 4000;

// Build one .log-line node from a normalized log record. (Same DOM shape the
// old global appendLog produced: ts/src/msg spans + lvl class.)
function buildLogLine({ source, level, text, ts, sub }) {
  const line = document.createElement('div');
  line.className = logLineClass(level, sub);

  const t = document.createElement('span');
  t.className = 'log-ts';
  t.textContent = logLineTime(ts);

  const s = document.createElement('span');
  s.className = 'log-src';
  s.textContent = source ? `[${source}]` : '';

  const m = document.createElement('span');
  m.className = 'log-msg';
  m.textContent = String(text);

  line.append(t, s, m);
  return line;
}

// Keystroke-to-repaint delay for the log search box.
const LOG_SEARCH_DEBOUNCE_MS = 120;

// Copy already-filtered log records to the clipboard and flash the button.
//
// Serializes from the MODEL, never from the DOM: a log line spaces its
// ts/src/msg spans with a flex `gap` rather than whitespace, so a native
// selection-copy would run them together ("12:34:56[planner]text").
// navigator.clipboard needs a secure context — localhost qualifies — but a
// hidden-textarea fallback keeps the button working anywhere.
async function copyLogToClipboard(btn, recs) {
  const text = serializeLog(recs);
  if (!text) {
    // A filtered-empty pane: silence looks like a dead button, and the STALE
    // clipboard content would pass for the filtered log on the next paste.
    flashCopyBtn(btn, 'nothing to copy');
    return;
  }
  let ok = true;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else ok = legacyCopy(text);
  } catch {
    ok = legacyCopy(text);
  }
  flashCopyBtn(btn, ok ? 'copied' : 'copy failed');
}

// Save/flash/restore a copy button's label. `dataset.label` survives repeated
// clicks so a flash can never become the button's permanent label.
function flashCopyBtn(btn, msg) {
  const prev = btn.dataset.label || btn.textContent;
  btn.dataset.label = prev;
  btn.textContent = msg;
  clearTimeout(btn._copyTimer);
  btn._copyTimer = setTimeout(() => { btn.textContent = btn.dataset.label || 'copy'; }, 1200);
}

// Copy a branch name from a history-card head. The button is icon-only, so
// feedback is a brief copy→check icon swap (class-driven) instead of the text
// flash flashCopyBtn does; the title mirrors it for hover/AT users.
async function copyBranchToClipboard(btn, branch) {
  let ok = true;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(branch);
    else ok = legacyCopy(branch);
  } catch {
    ok = legacyCopy(branch);
  }
  btn.classList.toggle('copied', ok);
  btn.title = ok ? 'Copied' : 'Copy failed';
  clearTimeout(btn._copyTimer);
  btn._copyTimer = setTimeout(() => {
    btn.classList.remove('copied');
    btn.title = 'Copy branch name';
  }, 1200);
}

function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// A "── Cycle N ──" rule marking where a feedback loop rewound and re-ran the
// same steps. Without it a re-run is indistinguishable from its first pass,
// since a re-run keeps its stepIndex and only bumps its cycle.
function buildLogSeparator(label) {
  const el = document.createElement('div');
  el.className = 'log-sep';
  el.textContent = label;
  return el;
}

// ONE DOM cap for the streaming append and the filter repaint. Counts RECORD
// lines only (the model cap counts records too — counting separators made the
// two caps diverge and over-evict), evicts oldest-first, and drops a separator
// left leading the pane: a rule above the first line labels nothing.
function trimLogDom(logEl) {
  const lines = logEl.getElementsByClassName('log-line'); // live collection
  while (lines.length > MAX_LOG_LINES) logEl.removeChild(logEl.firstElementChild);
  while (logEl.firstElementChild && logEl.firstElementChild.classList.contains('log-sep')) {
    logEl.removeChild(logEl.firstElementChild);
  }
}

// Append `rec` to a log pane, preceded by a cycle separator when it opens a new
// cycle. `prevCycle` is the last RENDERED cycle value (see cycleSeparatorBefore);
// returns the value the NEXT append must pass.
function appendLogRec(logEl, rec, prevCycle) {
  const sep = cycleSeparatorBefore(prevCycle, rec);
  if (sep) logEl.appendChild(buildLogSeparator(sep));
  logEl.appendChild(buildLogLine(rec));
  return rec.cycle != null ? rec.cycle : prevCycle;
}

// Pin a card's log to the bottom when its auto-scroll is on. Source of truth is
// r.autoscroll (the DOM switch only mirrors it); undefined counts as ON so a run
// that predates the field still follows. Called by the live stream (onLog) AND on
// (re)mount from paintRunList — a detached node reports scrollHeight≈0, so the pin
// set on build/stream is re-applied once the node is in the document.
function maybeAutoscrollLog(r) {
  if (!r || !r.el || r.autoscroll === false) return;
  const logEl = r.el.querySelector('.log');
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
}

// Mirror r.autoscroll onto a card's switch (class + aria). One-way: model → DOM.
// `el` lets a caller target a card whose r.el isn't assigned yet (buildRunCard's
// freshly-cloned node); defaults to r.el for the live-card path.
function syncAutoscrollSwitch(r, el) {
  const host = el || (r && r.el);
  if (!r || !host) return;
  const sw = host.querySelector('.switch.autoscroll');
  if (!sw) return;
  const on = r.autoscroll !== false;
  sw.classList.toggle('on', on);
  sw.setAttribute('aria-checked', String(on));
}

// Toggle a run's auto-scroll. Enabling does NOT jump to the bottom: per the product
// decision, re-enabling holds the current position and only the NEXT arriving line
// follows (that pin happens in onLog → maybeAutoscrollLog). Disabling freezes the log.
function setAutoscroll(r, on) {
  if (!r) return;
  r.autoscroll = !!on;
  syncAutoscrollSwitch(r);
}

// Per-run log: push to the model and, if the card is mounted, append the line.
// Filtering is render-time only: the model keeps every line, so changing a
// filter never loses history; a hidden line is simply not appended.
function onLog(r, msg) {
  const text = msg.text;
  if (text === undefined || text === null) return;
  const rec = {
    ts: msg.ts != null ? msg.ts : Date.now(), source: msg.source, level: msg.level, text, sub: !!msg.sub,
    ...(msg.nodeId != null ? { nodeId: msg.nodeId } : {}),
    ...(msg.stepIndex != null ? { stepIndex: msg.stepIndex } : {}),
    ...(msg.cycle != null ? { cycle: msg.cycle } : {}),
    ...(msg.stream ? { stream: msg.stream } : {}),
  };
  r.logLines.push(rec);
  if (r.logLines.length > MAX_LOG_LINES) r.logLines.shift();

  if (r.el) {
    // A repaint (true) already rendered rec from the model — appending again
    // would duplicate the line.
    const repainted = maybePaintLogFilters(r, rec);
    const logEl = r.el.querySelector('.log');
    if (logEl && !repainted && logLineVisible(rec, r.logFilter)) {
      clearLogPlaceholder(logEl);
      r._lastRenderedCycle = appendLogRec(logEl, rec, r._lastRenderedCycle ?? null);
      trimLogDom(logEl);
      maybeAutoscrollLog(r);
    }
  }
}

// ── Log filtering (source / level / step) ───────────────────────────────────

// Fill one filter <select> with an "all" option + the facet values, preserving
// the current selection (a value that vanished from the facets falls back to all).
function fillFilterSelect(sel, allLabel, values, current, labelOf) {
  if (!sel) return;
  sel.innerHTML = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = allLabel;
  sel.appendChild(all);
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = String(v);
    opt.textContent = labelOf ? labelOf(v) : String(v);
    sel.appendChild(opt);
  }
  sel.value = values.some((v) => String(v) === String(current)) ? String(current) : '';
}

// (Re)populate a run card's three filter dropdowns from the lines seen so far.
// `root` lets buildRunCard target the freshly-cloned node before r.el is assigned.
// Returns true when the pane was fully repainted (see below), false otherwise.
function paintLogFilters(r, root = r.el) {
  if (!root) return false;
  const facets = logFacets(r.logLines);
  const selSource = root.querySelector('.log-f-source');
  const selLevel = root.querySelector('.log-f-level');
  const selStep = root.querySelector('.log-f-step');
  const selCycle = root.querySelector('.log-f-cycle');
  fillFilterSelect(selSource, 'all sources', facets.sources, r.logFilter.source);
  fillFilterSelect(selLevel, 'all levels', facets.levels, r.logFilter.level);
  fillFilterSelect(selStep, 'all steps', facets.steps, r.logFilter.step, (i) => `step ${i + 1}`);
  // Cycles are the loop's own 1-based counter, so unlike steps they are NOT
  // shifted for display.
  fillFilterSelect(selCycle, 'all cycles', facets.cycles, r.logFilter.cycle, (c) => `cycle ${c}`);
  r._logFacetKeys = facetKeys(facets);
  // A selection whose value vanished from the facets (log rotation, rebuild)
  // fell back to "all" in the DOM; mirror that into the model and repaint so
  // the pane never stays filtered by a value the dropdowns no longer show.
  // Search is free text — no facet can vanish from it, so reconciliation must
  // never touch it. The DOM box may be a fresh empty clone (rebuild) or
  // mid-keystroke ahead of the debounce; the model owns the term here.
  const effective = { ...readLogFilterFrom(root), search: r.logFilter.search };
  if (effective.source !== r.logFilter.source
    || effective.level !== r.logFilter.level
    || String(effective.step) !== String(r.logFilter.step)
    || String(effective.cycle) !== String(r.logFilter.cycle)) {
    r.logFilter = effective;
    repaintFilteredLog(r, root);
    return true;
  }
  return false;
}

// Cheap incremental check for onLog: only rebuild the dropdowns when `rec`
// introduces a facet value they don't offer yet.
function facetKeys(facets) {
  return new Set([
    ...facets.sources.map((s) => `s:${s}`),
    ...facets.levels.map((l) => `l:${l}`),
    ...facets.steps.map((i) => `t:${i}`),
    ...facets.cycles.map((c) => `c:${c}`),
  ]);
}
// Returns paintLogFilters' repaint flag (true when the pane was fully
// repainted) so onLog can skip its own incremental append.
function maybePaintLogFilters(r, rec) {
  const seen = r._logFacetKeys;
  if (!seen) return paintLogFilters(r);
  const f = logFacets([rec]);
  for (const k of facetKeys(f)) {
    if (!seen.has(k)) return paintLogFilters(r);
  }
  return false;
}

// The live-card empty-state note ('(no lines match the filter)') is plain text
// stamped with data-empty; incremental appends must clear it first.
function clearLogPlaceholder(logEl) {
  if (logEl.dataset.empty) { logEl.textContent = ''; delete logEl.dataset.empty; }
}

// Re-render a card's log pane from the model through the current filter (called
// on a filter change and by buildRunCard's hydration; live appends stay
// incremental via onLog). `root` lets buildRunCard target the freshly-cloned
// node before r.el is assigned.
function repaintFilteredLog(r, root = r.el) {
  if (!r || !root) return;
  const logEl = root.querySelector('.log');
  if (!logEl) return;
  // Auto-scroll OFF freezes the viewport: carry the position across the
  // wipe+rebuild (the browser clamps if the filtered content is shorter).
  // ON keeps its pin-to-bottom via maybeAutoscrollLog below.
  const savedTop = logEl.scrollTop;
  logEl.innerHTML = '';
  delete logEl.dataset.empty;
  const visible = compileLogFilter(r.logFilter);
  // One fragment, one reflow — appending 4000 nodes into the live document
  // per debounce tick is where search jank came from.
  const frag = document.createDocumentFragment();
  let shown = 0;
  let prevCycle = null;
  for (const rec of r.logLines) {
    if (!visible(rec)) continue;
    prevCycle = appendLogRec(frag, rec, prevCycle);
    shown++;
  }
  logEl.appendChild(frag);
  // Hand the streaming path in onLog the cycle the next separator must compare
  // against, so a live append after a repaint agrees with the repaint.
  r._lastRenderedCycle = prevCycle;
  trimLogDom(logEl);
  if (shown === 0 && r.logLines.length) {
    logEl.textContent = '(no lines match the filter)';
    logEl.dataset.empty = '1';
  }
  maybeAutoscrollLog(r);
  if (r.autoscroll === false && savedTop) logEl.scrollTop = savedTop;
}

function onArtifact(r, msg) {
  onLog(r, {
    source: 'artifact',
    level: 'artifact',
    text: `${msg.kind || 'file'}: ${msg.path || ''}`,
    ts: Date.now(),
  });
}

// Non-run-scoped UI notices (config/answer/install errors). There is no global
// log surface anymore, so route these to the console; keep the {source,level,
// text,ts} shape for call-site compatibility.
function appendLog({ source, level, text }) {
  if (text === undefined || text === null) return;
  const tag = source ? `[${source}]` : '';
  if (level === 'error') console.error(`worca ${tag} ${text}`);
  else console.log(`worca ${tag} ${text}`);
}

// (fmtTime moved to log-line.mjs as logLineTime: the rendered line and the
// clipboard serializer must format a timestamp identically, and log-line.mjs is
// the pure module both go through.)

// ---------------------------------------------------------------------------
// Questions (clarify) and gates. The full question/gate UI is built INLINE into
// each run card's .qpanel slot (no global question card). onQuestion stores the
// pending question, builds the panel, and repaints (paintRunCard toggles
// .attention + paints the paused stepper).
// ---------------------------------------------------------------------------
function onQuestion(r, msg) {
  r.pendingQuestion = msg;
  // A new question supersedes any half-finished answer attempt.
  r._answering = false;
  if (r.el) renderQpanel(r);
  paintRunCard(r);
}

// The `?` glyph used in the panel head. Built fresh each call (a node can only
// live in one place in the DOM).
function questionIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '17');
  svg.setAttribute('height', '17');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M9.1 9a3 3 0 1 1 4.6 2.5c-.9.6-1.7 1.2-1.7 2.3');
  path.setAttribute('stroke-linecap', 'round');
  const circle = document.createElementNS(NS, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '17.5');
  circle.setAttribute('r', '.5');
  circle.setAttribute('fill', 'currentColor');
  circle.setAttribute('stroke-width', '1.4');
  svg.append(path, circle);
  return svg;
}

// Filter a clarify question's options down to the real ones (the contract pads
// to 3 slots with '' — drop empty/whitespace).
function realOptions(q) {
  const opts = Array.isArray(q && q.options) ? q.options : [];
  return opts.filter((o) => typeof o === 'string' && o.trim() !== '');
}

// Build the inline question/gate panel into r.el's .qpanel from r.pendingQuestion,
// un-hide it, and wire its inputs. Idempotent: re-building replaces the content.
function renderQpanel(r) {
  if (!r.el) return;
  const panel = r.el.querySelector('.qpanel');
  if (!panel) return;
  const pq = r.pendingQuestion;
  panel.innerHTML = '';
  if (!pq) {
    panel.classList.add('hidden');
    return;
  }

  const isRecovery = pq.kind === 'recovery';
  const isGate = !isRecovery && (pq.kind === 'gate' || Array.isArray(pq.issues));

  // ----- head -----
  const head = document.createElement('div');
  head.className = 'qpanel-head';
  head.appendChild(questionIcon());
  const title = document.createElement('b');
  if (isRecovery) {
    const cls = (pq.recovery && pq.recovery.cls) || 'recoverable';
    title.textContent = `${cls.replace('_', ' ')} error — action needed`;
  } else if (isGate) {
    title.textContent = 'Cycle gate';
  } else if (pq.kind === 'questions') {
    title.textContent = `${pq.agent || 'Agent'} has questions`;
  } else {
    const phaseLabel = PHASE_LABEL[r.phaseKey] || 'Pipeline';
    title.textContent = `${phaseLabel} needs your input`;
  }
  head.appendChild(title);
  if (!isGate && !isRecovery) {
    const n = realQuestions(pq).length;
    const count = document.createElement('span');
    count.className = 'qcount';
    count.textContent = `${n} question${n === 1 ? '' : 's'}`;
    head.appendChild(count);
  }
  panel.appendChild(head);

  if (isRecovery) renderRecoveryBody(r, panel, pq);
  else if (isGate) renderGateBody(r, panel, pq);
  else renderClarifyBody(r, panel, pq);

  panel.classList.remove('hidden');
}

// Clarify questions with at least a question string. (questions may be [] when
// the planner had nothing to ask — handled separately with a note.)
function realQuestions(pq) {
  return (Array.isArray(pq && pq.questions) ? pq.questions : []).filter(
    (q) => q && typeof q.question === 'string' && q.question.trim() !== ''
  );
}

function renderClarifyBody(r, panel, pq) {
  const questions = realQuestions(pq);

  // r._answers maps a stable per-question key -> chosen value (option text or
  // free-text or ''). Rebuilt each render so it tracks the current markup.
  r._answers = [];

  if (questions.length === 0) {
    const note = document.createElement('div');
    note.className = 'gate-intro';
    note.textContent =
      'No specific questions — you can submit an empty answer to let the pipeline proceed.';
    panel.appendChild(note);
  }

  questions.forEach((q, i) => {
    const block = document.createElement('div');
    block.className = 'qblock';

    const text = document.createElement('div');
    text.className = 'qtext';
    const qn = document.createElement('span');
    qn.className = 'qn';
    qn.textContent = String(i + 1);
    text.appendChild(qn);
    text.appendChild(document.createTextNode(q.question));
    block.appendChild(text);

    const opts = realOptions(q);
    const slot = { id: q.id, question: q.question, choice: '' };
    r._answers.push(slot);

    // allowFreeText === false => options-only (no free-text input). Absent or
    // true keeps the input. When suppressed, slot.choice can only be set by an
    // option click; if none is picked it stays '' (submit yields '' gracefully).
    const showFree = q.allowFreeText !== false;

    const optsWrap = document.createElement('div');
    optsWrap.className = 'qopts';

    let free = null;
    if (showFree) {
      free = document.createElement('input');
      free.className = 'qfree';
      free.type = 'text';
      free.placeholder = 'Or type your own answer…';
    }

    opts.forEach((optText) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qopt';
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = optText;
      btn.addEventListener('click', () => {
        // Select this option, clear siblings + the free-text field (if present).
        optsWrap.querySelectorAll('.qopt').forEach((b) => {
          const on = b === btn;
          b.classList.toggle('sel', on);
          b.setAttribute('aria-pressed', String(on));
        });
        if (free) {
          free.value = '';
          free.classList.remove('has');
        }
        slot.choice = optText;
      });
      optsWrap.appendChild(btn);
    });
    if (opts.length) block.appendChild(optsWrap);

    // Free-text input: typing clears any option selection and becomes the choice.
    if (free) {
      free.addEventListener('input', () => {
        const v = free.value;
        free.classList.toggle('has', v.trim() !== '');
        if (v.trim() !== '') {
          optsWrap.querySelectorAll('.qopt').forEach((b) => {
            b.classList.remove('sel');
            b.setAttribute('aria-pressed', 'false');
          });
        }
        slot.choice = v;
      });
      block.appendChild(free);
    }

    panel.appendChild(block);
  });

  // ----- foot: submit -----
  const foot = document.createElement('div');
  foot.className = 'qpanel-foot';
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'btn-go';
  const NS = 'http://www.w3.org/2000/svg';
  const play = document.createElementNS(NS, 'svg');
  play.setAttribute('width', '14');
  play.setAttribute('height', '14');
  play.setAttribute('viewBox', '0 0 24 24');
  play.setAttribute('fill', 'currentColor');
  const tri = document.createElementNS(NS, 'path');
  tri.setAttribute('d', 'M6 4l14 8-14 8V4Z');
  play.appendChild(tri);
  submit.appendChild(play);
  submit.appendChild(document.createTextNode('Submit answers & resume'));
  foot.appendChild(submit);
  panel.appendChild(foot);
}

function renderGateBody(r, panel, pq) {
  const issues = Array.isArray(pq.issues) ? pq.issues : [];

  const intro = document.createElement('div');
  intro.className = 'gate-intro';
  intro.textContent = issues.length
    ? 'This cycle reached its limit with open issues. Approve another cycle to keep iterating, or continue with what you have.'
    : 'This cycle reached its limit. Approve another cycle to keep iterating, or continue with what you have.';
  panel.appendChild(intro);

  if (issues.length) {
    const list = document.createElement('ul');
    list.className = 'issues';
    issues.forEach((iss) => {
      const sev = String((iss && iss.severity) || 'suggestion').toLowerCase();
      const li = document.createElement('li');
      li.className = `issue sev-${sev}`;

      const ihead = document.createElement('div');
      ihead.className = 'issue-head';
      const sevEl = document.createElement('span');
      sevEl.className = 'issue-sev';
      sevEl.textContent = sev;
      const titleEl = document.createElement('span');
      titleEl.className = 'issue-title';
      titleEl.textContent = (iss && iss.title) || '(untitled issue)';
      ihead.append(sevEl, titleEl);
      li.appendChild(ihead);

      if (iss && iss.detail) {
        const det = document.createElement('div');
        det.className = 'issue-detail';
        det.textContent = iss.detail;
        li.appendChild(det);
      }
      if (iss && iss.location) {
        const loc = document.createElement('div');
        loc.className = 'issue-loc';
        loc.textContent = iss.location;
        li.appendChild(loc);
      }
      list.appendChild(li);
    });
    panel.appendChild(list);
  }

  const foot = document.createElement('div');
  foot.className = 'qpanel-foot gate-actions';
  const cont = document.createElement('button');
  cont.type = 'button';
  cont.className = 'btn gate-continue';
  cont.textContent = "Don't approve another cycle and continue";
  const another = document.createElement('button');
  another.type = 'button';
  another.className = 'btn btn-primary gate-another';
  another.textContent = 'I approve another cycle';
  foot.append(cont, another);
  panel.appendChild(foot);
}

// Recovery prompt: a node hit a recoverable error (auth / rate-limit / quota /
// network). Show the cause and let the user fix it then Retry, or Abort the run.
function renderRecoveryBody(r, panel, pq) {
  const rec = pq.recovery || {};
  const intro = document.createElement('div');
  intro.className = 'gate-intro';
  const hint = rec.cls === 'auth'
    ? 'Re-authenticate (e.g. run `claude setup-token` or `/login`), then Retry.'
    : 'Fix the problem (wait out a limit, restore connectivity, top up credit), then Retry.';
  intro.textContent = `This step could not reach the model. ${hint}`;
  panel.appendChild(intro);

  if (rec.message) {
    const msg = document.createElement('div');
    msg.className = 'issue-detail';
    msg.textContent = rec.message;
    panel.appendChild(msg);
  }

  const foot = document.createElement('div');
  foot.className = 'qpanel-foot gate-actions';
  const abort = document.createElement('button');
  abort.type = 'button';
  abort.className = 'btn recovery-abort';
  abort.textContent = 'Abort run';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn btn-primary recovery-retry';
  retry.textContent = 'Retry';
  foot.append(abort, retry);
  panel.appendChild(foot);
}

// Gather the clarify answers from the live model slots and POST them.
function submitAnswer(r) {
  const answers = (r._answers || []).map((s) => ({
    id: s.id,
    question: s.question,
    choice: typeof s.choice === 'string' ? s.choice.trim() : '',
  }));
  postAnswer(r, { answers });
}

// POST /api/answer for a run's pending question. On a transport/HTTP error we
// log to the card and re-enable the panel; on 200 we DON'T assume the run
// resumed (the server returns 200 even for a stale id) — we disable the panel,
// show a "Resuming…" affordance, set r._answering, and KEEP r.pendingQuestion.
// The panel is cleared only when the next phase/state event confirms resume.
async function postAnswer(r, payload) {
  if (!r || !r.pendingQuestion) return;
  // Re-entrancy guard: an answer is already in flight for this run. Without
  // this a synthetic/double click (or a re-triggered handler) could fire a
  // second POST before maybeResume clears _answering.
  if (r._answering) return;
  // Never post for a dead run.
  if (r._finished || isTerminalStatus(r.status)) return;
  const id = r.pendingQuestion.id;
  const runId = r.runId;

  setPanelBusy(r, true);
  r._answering = true;

  try {
    const res = await fetch('/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, id, payload }),
    });
    if (!res.ok) {
      const err = await safeJson(res);
      r._answering = false;
      setPanelBusy(r, false);
      onLog(r, { source: 'ui', level: 'error', text: `answer failed: ${err.error || res.status}`, ts: Date.now() });
      return;
    }
    // 200: keep pendingQuestion; wait for the next phase/state to confirm resume.
  } catch (e) {
    r._answering = false;
    setPanelBusy(r, false);
    onLog(r, { source: 'ui', level: 'error', text: `answer error: ${e.message}`, ts: Date.now() });
  }
}

// Single source of truth for "this run is over". The server's terminal statuses
// are done|error|stopped; the remaining synonyms are accepted defensively. Used
// by liveRuns (to exclude finished runs) and postAnswer (to refuse a late POST).
function isTerminalStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'done' || s === 'error' || s === 'stopped' || s === 'aborted' || s === 'failed' || s === 'complete' || s === 'completed' || s === 'interrupted';
}

// Disable/enable the panel's interactive controls and reflect a "Resuming…"
// state on the primary button while an answer is in flight / awaiting resume.
function setPanelBusy(r, busy) {
  if (!r.el) return;
  const panel = r.el.querySelector('.qpanel');
  if (!panel) return;
  panel.querySelectorAll('button, input').forEach((node) => {
    node.disabled = busy;
  });
  const primary = panel.querySelector('.btn-go, .gate-another');
  if (primary && busy && !primary.dataset.label) {
    primary.dataset.label = primary.textContent;
    primary.textContent = 'Resuming…';
  } else if (primary && !busy && primary.dataset.label) {
    primary.textContent = primary.dataset.label;
    delete primary.dataset.label;
  }
}

// Empty + hide a run's qpanel and drop its attention ring. Used on resume and
// from finishRun's terminal path.
function clearQpanel(r) {
  if (!r.el) return;
  const panel = r.el.querySelector('.qpanel');
  if (panel) {
    panel.innerHTML = '';
    panel.classList.add('hidden');
  }
  r.el.classList.remove('attention');
}

// ---------------------------------------------------------------------------
// Done / error — converge to a single idempotent terminal path.
//
// The server fires BOTH `error` and `done` on an error, and a stop emits
// state(stopped) -> done. finishRun is guarded by r._finished so the second
// call no-ops. On finish we paint the terminal stepper, drop the card from the
// live view, refresh History for that project, then client-evict the heavy
// fields (logLines/el) while keeping the model in the map so a duplicate
// hello/event won't recreate it fresh.
// ---------------------------------------------------------------------------
function finishRun(r, status) {
  if (r._finished) return;
  r._finished = true;
  r.status = status;
  r.pendingQuestion = null;
  r._answering = false;

  // Clear the card's qpanel + attention before it drops out.
  if (r.el) {
    clearQpanel(r);
    // Paint the terminal stepper one last time while the card still exists.
    paintStepper(r);
  }

  // A paused run is parked in Running (resumable), NOT a finished result: it does
  // NOT linger (no green/red "seen me" marker, never acknowledged-to-drop), keeps
  // its card + log for an in-place Resume, and keeps the user on its focus tab.
  const paused = status === 'paused';

  // Orchestration pipeline finishing LIVE → it lingers (greyed) until opened once.
  const willLinger = !paused && isPipelineRun(r);
  if (willLinger) markLingering(r.runId);  // no-op if already acknowledged

  // Q&A #5: if the user is staring at THIS run's focus tab, drop them to Overview.
  // A paused run keeps its focus tab (its card stays, now showing Resume).
  if (!paused && state.selectedRunId === r.runId) {
    state.selectedRunId = '';
    if (location.hash.slice(1) !== 'running') location.hash = 'running'; // → hashchange → Overview
  }

  // Card drops out of the live view (liveRuns excludes terminal statuses).
  renderRunningView();   // Overview keeps the greyed lingerer / paused card; reconcile rebuilds if needed
  updateNavCounts();
  renderPipelineTabs();
  // History is machine-wide + decoupled from the project picker now; if the user
  // is looking at it, force-refetch so the just-finished pipeline surfaces with no
  // stale-cache flash (and re-triggers Phase-2 PR enrichment). A paused run is
  // suppressed from History (it lives in Running), so refreshing is still correct.
  if (currentView() === 'history') loadHistoryView({ force: true });

  // Evict heavy fields ONLY for non-lingerers AND non-paused; lingerers + paused
  // keep el/logLines so the card persists without a duplicate (paintRunList
  // tolerates either case) and Resume has the log context.
  if (!willLinger && !paused) { r.logLines = []; r.el = null; }
}

function onDone(r, msg) {
  // A cost pause carries the reason code ('cost_pipeline' | 'cost_total') that
  // drives the card banner, the status pill, and the resume gating. Assigned
  // unconditionally so a later reasonless done clears it, matching the server's
  // own entry.pauseReason reset in wireRun.
  r.pauseReason = msg.reason || null;
  finishRun(r, msg.status || 'done');
  // Nothing else picks up the FINAL spend delta: a non-cost `done` broadcasts no
  // budget-changed, and startBudgetTick refetches only while runs are live. Without
  // this the delta — and the `blocked` flip it can cause — waited for a reload, so
  // Start stayed enabled and the click hit the raw 403 instead of the creation gate.
  refreshBudget();
}

function onError(r) {
  finishRun(r, 'error');
}

// ---------------------------------------------------------------------------
// Form: source toggle, file loading
// ---------------------------------------------------------------------------
function syncSourceToggle() {
  const val = (el.sourceRadios.find((r) => r.checked) || {}).value || 'prompt';
  const plugin = !!state.activePluginSource;
  el.promptPane.classList.toggle('hidden', plugin || val !== 'prompt');
  el.markdownPane.classList.toggle('hidden', plugin || val !== 'markdown');
  if (el.pluginSourcePane) el.pluginSourcePane.classList.toggle('hidden', !plugin);
}
el.sourceRadios.forEach((r) => r.addEventListener('change', syncSourceToggle));

// Segmented Task-source toggle. The .seg buttons are the visible control; the
// hidden radios (input[name="source"]) remain the source of truth read at submit.
$$('#source-seg button[data-src]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const src = btn.dataset.src;
    state.activePluginSource = null;
    $$('#source-seg button[data-plugin-src]').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); });
    $$('#source-seg button[data-src]').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const radio = el.sourceRadios.find((r) => r.value === src);
    if (radio) radio.checked = true;
    syncSourceToggle();
  });
});

// --- Pluggable task sources (plugins). /api/sources is fetched on every
// New-Pipeline open (self-heals after install/enable — no cache invalidation
// seam needed); plugin sources append segment buttons after Prompt/Markdown.
// FEATURE-OFF: with zero plugins the endpoint lists only prompt+markdown, this
// renders NOTHING, and the segment + submit body are byte-identical to today.
async function loadTaskSources() {
  let sources = [];
  try {
    const res = await fetch('/api/sources');
    const data = await safeJson(res);
    if (res.ok && Array.isArray(data.sources)) sources = data.sources;
  } catch { /* endpoint absent/down -> legacy-only */ }
  state.pluginSources = sources.filter((s) => s && s.type === 'plugin');
  $$('#source-seg button[data-plugin-src]').forEach((b) => b.remove());   // idempotent rebuild
  for (const src of state.pluginSources) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.pluginSrc = `${src.plugin}/${src.sourceId}`;
    b.setAttribute('aria-pressed', 'false');
    b.textContent = src.displayName || src.sourceId;
    b.addEventListener('click', () => selectPluginSource(src, b));
    el.sourceSeg.appendChild(b);
  }
  // Active source vanished (uninstalled/disabled)? Fall back to the radios.
  if (state.activePluginSource && !state.pluginSources.some((s) =>
      s.plugin === state.activePluginSource.plugin && s.sourceId === state.activePluginSource.sourceId)) {
    state.activePluginSource = null;
    el.pluginSourcePane.replaceChildren();
    syncSourceToggle();
  }
}

// The pane's injected `call`: one connector op via POST /api/sources/call.
function sourceCall(src) {
  return async (op, args) => {
    const res = await fetch('/api/sources/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plugin: src.plugin, sourceId: src.sourceId, op, args: args || {} }),
    });
    const data = await safeJson(res);
    if (!res.ok || data.ok === false) {
      throw new Error((data.error && data.error.message) || data.error || `HTTP ${res.status}`);
    }
    return data.result;
  };
}

function selectPluginSource(src, btn) {
  state.activePluginSource = src;
  $$('#source-seg button').forEach((b) => {
    const on = b === btn;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  syncSourceToggle();
  mountPluginSourcePane(src);
}

// validateConfig gate first (= "Test connection"); then the declarative pane.
async function mountPluginSourcePane(src) {
  const host = el.pluginSourcePane;
  const call = sourceCall(src);
  host.replaceChildren(Object.assign(document.createElement('small'),
    { className: 'hint', textContent: `Checking ${src.displayName} configuration…` }));
  let v;
  try { v = await call('validateConfig', {}); }
  catch (e) { v = { ok: false, errors: [{ message: e.message }] }; }
  if (state.activePluginSource !== src) return;   // user switched away meanwhile
  host.replaceChildren();
  if (!v || v.ok === false) {
    const box = document.createElement('div');
    box.className = 'sp-config-missing';
    const msg = document.createElement('p');
    msg.className = 'hint err';
    msg.textContent = `${src.displayName} is not configured: ${((v && v.errors) || [])
      .map((x) => x.message).join('; ') || 'connection check failed'}`;
    const link = document.createElement('a');
    link.href = '#plugins';
    link.textContent = 'Open Plugins settings';
    link.addEventListener('click', (e) => { e.preventDefault(); location.hash = 'plugins'; });
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-ghost btn-mini';
    retry.textContent = 'Test connection';
    retry.addEventListener('click', () => mountPluginSourcePane(src));
    box.append(msg, link, retry);
    host.appendChild(box);
    return;
  }
  host.appendChild(renderSourcePane(src, { call }));
}

// ---------------------------------------------------------------------------
// Advanced disclosure (§4.6): the agents accordion, guardrails and mock mode.
// It is ALWAYS collapsed on arrival — it never opens itself and carries no
// summary line. Nothing in it is lost by being closed: an agent override is
// stated by the accordion the moment you open it, and the config-load error
// hint lives in the main column precisely because this section stays shut.
// ---------------------------------------------------------------------------

// Mock switch. The visible .switch mirrors the hidden #mock checkbox, which is
// what the submit handler reads (el.mock.checked).
const mockSwitch = $('#mock-switch');
function toggleMock() {
  const on = !el.mock.checked;
  el.mock.checked = on;
  mockSwitch.classList.toggle('on', on);
  mockSwitch.setAttribute('aria-checked', String(on));
}
if (mockSwitch) {
  mockSwitch.addEventListener('click', toggleMock);
  mockSwitch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      toggleMock();
    }
  });
}

// File-picker buttons trigger their (hidden) <input type=file>.
$$('.pick[data-pick]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.pick === 'md') el.mdFile.click();
    else if (btn.dataset.pick === 'extras') el.extras.click();
  });
});

el.mdFile.addEventListener('change', async () => {
  const f = el.mdFile.files && el.mdFile.files[0];
  if (!f) return;
  el.mdFileName.textContent = f.name;
  try {
    const text = await f.text();
    el.promptMarkdown.value = text;
  } catch (e) {
    el.mdFileName.textContent = `failed to read: ${e.message}`;
  }
});

el.extras.addEventListener('change', () => {
  const files = el.extras.files;
  if (files && files.length) {
    const names = [...files].map((f) => f.name).join(', ');
    el.extrasNote.textContent = `${files.length} file(s) will be uploaded and copied into the pipeline's extras/ folder: ${names}`;
  } else {
    el.extrasNote.textContent = 'Leave empty and the run gets no extra files.'; // must match index.html's initial state
  }
});

// Read a File as base64 (without the data: URL prefix).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

// Collect the selected extra files as [{ name, dataBase64 }] for upload.
async function collectExtras() {
  const files = el.extras.files ? [...el.extras.files] : [];
  const out = [];
  for (const f of files) {
    try {
      const dataBase64 = await fileToBase64(f);
      out.push({ name: f.name, dataBase64 });
    } catch {
      /* skip unreadable file */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Project registry: dropdown + inline add-form + delete.
// ---------------------------------------------------------------------------
const LAST_PROJECT_KEY = 'worca-cc.lastProject';

// --- Pipeline-tab lifecycle state (client-only; see plan §2 fact 2) ---
const ACK_RUNS_KEY = 'worca-cc.ackRuns';        // runIds the user has seen post-finish
const LINGER_RUNS_KEY = 'worca-cc.lingerRuns';  // runIds that finished LIVE and are not yet acknowledged

function loadIdSet(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch { return new Set(); }
}
const acknowledged = loadIdSet(ACK_RUNS_KEY);
const lingering = loadIdSet(LINGER_RUNS_KEY);

function persistIdSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* private mode */ }
}

// First `hello` of THIS session guard (Step 7). Not reset on reconnect.
let helloSeeded = false;

function markLingering(runId) {
  if (!runId || acknowledged.has(runId) || lingering.has(runId)) return;
  lingering.add(runId);
  persistIdSet(LINGER_RUNS_KEY, lingering);
}

function acknowledgeRun(runId) {
  if (!runId || acknowledged.has(runId)) return;
  acknowledged.add(runId);
  persistIdSet(ACK_RUNS_KEY, acknowledged);
  if (lingering.delete(runId)) persistIdSet(LINGER_RUNS_KEY, lingering);
  // Drop the now-acknowledged row from tabs + Overview; History will now surface it.
  renderPipelineTabs();
  if (currentView() === 'running' && !state.selectedRunId) renderRunningView();
  if (currentView() === 'history') renderHistory();
}

function selectedProjectPath() {
  const v = el.projectSelect.value;
  return !v || v === '__add__' ? '' : v;
}

function selectedProjectName() {
  const opt = el.projectSelect.selectedOptions && el.projectSelect.selectedOptions[0];
  return opt && opt.dataset ? opt.dataset.name || '' : '';
}

async function loadProjects(selectName) {
  try {
    const res = await fetch('/api/projects');
    const data = await safeJson(res);
    state.projects = data && Array.isArray(data.projects) ? data.projects : [];
  } catch {
    state.projects = [];
  }
  renderProjectOptions(selectName);
  updateProjectsCount();
}

function renderProjectOptions(selectName) {
  const want = selectName || localStorage.getItem(LAST_PROJECT_KEY) || '';
  el.projectSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.textContent = state.projects.length ? 'Select a project…' : 'No projects yet';
  el.projectSelect.appendChild(placeholder);

  state.projects.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.path;
    opt.dataset.name = p.name;
    opt.textContent = p.exists ? p.name : `${p.name} (missing)`;
    el.projectSelect.appendChild(opt);
  });

  const add = document.createElement('option');
  add.value = '__add__';
  add.textContent = '+ Add project…';
  el.projectSelect.appendChild(add);

  // Restore by index (not value) so duplicate paths can't pick the wrong name.
  const idx = state.projects.findIndex((p) => p.name === want);
  if (idx >= 0) el.projectSelect.selectedIndex = idx + 1; // +1 past the placeholder
  else placeholder.selected = true;

  onProjectChanged();
}

function onProjectChanged() {
  const path = selectedProjectPath();
  if (path) {
    state.projectDir = path;
    localStorage.setItem(LAST_PROJECT_KEY, selectedProjectName());
    loadConfig(path);        // (per-project history load removed — History is independent now)
    refreshBranches(path);
  } else {
    state.projectDir = '';
    // No project yet: still load the built-in models so the picker isn't empty.
    loadConfig('');
    refreshBranches('');
  }
}

// Seed any branch <select> with a single placeholder option. Empty value === "let
// the server default to current HEAD". Returns the option for in-place updates.
// We always seed one so the select is never blank (m3) and always communicates
// state — loading, the auto default, or an error (m2).
function seedBranchPlaceholder(select, text) {
  if (!select) return null;
  select.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = '';
  opt.textContent = text;
  select.appendChild(opt);
  return opt;
}

// Populate any branch <select> from /api/branches for `projectDir`, pre-selecting
// the repo's current branch (HEAD). Empty value still falls back to HEAD on submit.
async function populateBranchSelect(select, projectDir) {
  if (!select) return;
  if (!projectDir) { seedBranchPlaceholder(select, 'current branch (auto)'); return; }
  const placeholder = seedBranchPlaceholder(select, 'Loading branches…');
  try {
    const r = await fetch(`/api/branches?projectDir=${encodeURIComponent(projectDir)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const branches = Array.isArray(data.branches) ? data.branches : [];
    if (!branches.length) { placeholder.textContent = 'current branch (auto)'; return; }
    // Rebuild: explicit "auto" first, then every branch (current pre-selected).
    seedBranchPlaceholder(select, 'current branch (auto)');
    for (const b of branches) {
      const opt = document.createElement('option');
      opt.value = b; opt.textContent = b;
      if (b === data.current) opt.selected = true;
      select.appendChild(opt);
    }
  } catch {
    // m2: surface the failure instead of leaving a silently-empty select. The
    // empty value still makes the server fall back to HEAD on submit.
    placeholder.textContent = 'current branch (auto — branch list unavailable)';
  }
}

// Back-compat shim for the single #sourceBranch (existing call sites in
// onProjectChanged are unchanged). setBranchPlaceholder is no longer needed
// (its callers move to seedBranchPlaceholder / are removed in setRunTarget).
function refreshBranches(projectDir) {
  // In workspace mode the single select is the disabled "current branch (auto)"
  // stand-in; filling it with ONE project's branches would claim a source the
  // run will not use (each member branches off its own HEAD).
  if (state.runTarget === 'workspace') return showWorkspaceBranchPlaceholder();
  return populateBranchSelect(el.sourceBranch, projectDir);
}

el.projectSelect.addEventListener('change', () => {
  if (el.projectSelect.value === '__add__') {
    openAddProject();
    return;
  }
  hideAddProject();
  onProjectChanged();
});

function openAddProject() {
  el.addProject.classList.remove('hidden');
  el.newProjectName.value = '';
  el.newProjectPath.value = '';
  setAddMsg('');
  el.newProjectName.focus();
}

function hideAddProject() {
  el.addProject.classList.add('hidden');
}

function setAddMsg(text, kind) {
  el.addProjectMsg.textContent = text || '';
  el.addProjectMsg.className = 'hint' + (kind ? ' ' + kind : '');
}

el.addProjectCancel.addEventListener('click', () => {
  hideAddProject();
  renderProjectOptions(localStorage.getItem(LAST_PROJECT_KEY) || '');
});

el.addProjectSave.addEventListener('click', async () => {
  const name = el.newProjectName.value.trim();
  const projPath = el.newProjectPath.value.trim();
  if (!name) return setAddMsg('Name is required.', 'err');
  if (!projPath) return setAddMsg('Path is required.', 'err');
  el.addProjectSave.disabled = true;
  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path: projPath }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setAddMsg(data.error || `HTTP ${res.status}`, 'err');
      return;
    }
    state.projects = Array.isArray(data.projects) ? data.projects : state.projects;
    hideAddProject();
    renderProjectOptions(name); // auto-select the newly added project
  } catch (e) {
    setAddMsg(e.message, 'err');
  } finally {
    el.addProjectSave.disabled = false;
  }
});

// --- Folder selector (Browse…): native OS dialog, in-app modal fallback ----
let folderState = { path: '', parent: null, home: '' };

el.newProjectBrowse.addEventListener('click', async () => {
  el.newProjectBrowse.disabled = true;
  setAddMsg('');
  try {
    const res = await fetch('/api/fs/pick-folder', { method: 'POST' });
    const data = await safeJson(res);
    if (res.ok && data.status === 'picked' && data.path) applyPickedFolder(data.path);
    else if (res.ok && data.status === 'canceled') { /* user dismissed the dialog */ }
    else if (res.ok && data.status === 'busy') setAddMsg('A folder dialog is already open — finish or cancel it first.', 'err');
    else await openFolderBrowser(el.newProjectPath.value.trim()); // unsupported / error -> in-app fallback
  } catch {
    await openFolderBrowser(el.newProjectPath.value.trim());
  } finally {
    el.newProjectBrowse.disabled = false;
  }
});

// Fill the path field; prefill an EMPTY name with the folder's basename.
function applyPickedFolder(path) {
  el.newProjectPath.value = path;
  if (!el.newProjectName.value.trim()) {
    const base = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    if (base) el.newProjectName.value = base;
  }
}

// The in-app browser is shared by every Browse… button, so each opener names
// where "Select this folder" lands. Default sink = the add-project fields.
let folderSink = applyPickedFolder;

async function openFolderBrowser(seedPath, onSelect) {
  folderSink = onSelect || applyPickedFolder;
  el.folderBrowser.classList.remove('hidden');
  // A stale or mistyped seed path from the text field 400s; fall back to home.
  // Only the SEED gets this retry — navigation failures keep the current
  // listing (loadFolders shows the error) instead of yanking the user home.
  if (!(await loadFolders(seedPath)) && seedPath) await loadFolders('');
}

function closeFolderBrowser() {
  el.folderBrowser.classList.add('hidden');
}

/** Load a listing into the modal. Returns true on success. */
async function loadFolders(path) {
  setFolderMsg('');
  try {
    const res = await fetch(`/api/fs/dirs?path=${encodeURIComponent(path || '')}`);
    const data = await safeJson(res);
    if (!res.ok) {
      setFolderMsg(data.error || `HTTP ${res.status}`, 'err');
      return false;
    }
    folderState = data;
    renderFolders(data);
    return true;
  } catch (e) {
    setFolderMsg(e.message, 'err');
    return false;
  }
}

function renderFolders(data) {
  el.folderCurrent.textContent = data.path;
  el.folderCurrent.title = data.path;
  el.folderUp.disabled = !data.parent;
  el.folderList.textContent = '';
  if (!data.dirs.length) {
    const li = document.createElement('li');
    li.className = 'folder-empty hint';
    li.textContent = 'No subfolders.';
    el.folderList.appendChild(li);
    return;
  }
  for (const d of data.dirs) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'folder-item';
    btn.textContent = d.name;
    btn.addEventListener('click', () => loadFolders(d.path));
    li.appendChild(btn);
    el.folderList.appendChild(li);
  }
}

function setFolderMsg(text, kind) {
  el.folderMsg.textContent = text || '';
  el.folderMsg.className = 'hint' + (kind ? ' ' + kind : '');
}

el.folderUp.addEventListener('click', () => { if (folderState.parent) loadFolders(folderState.parent); });
el.folderHome.addEventListener('click', () => loadFolders(''));
el.folderSelect.addEventListener('click', () => {
  if (folderState.path) folderSink(folderState.path);
  closeFolderBrowser();
});
el.folderBrowserClose.addEventListener('click', closeFolderBrowser);
// Backdrop click (the overlay itself, not the inner card) and Escape close it,
// matching the viewer modal's behavior.
el.folderBrowser.addEventListener('click', (e) => {
  if (e.target === el.folderBrowser) closeFolderBrowser();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el.folderBrowser.classList.contains('hidden')) closeFolderBrowser();
});

// NOTE: New Pipeline has no inline project-delete. Removing a project is rare
// and destructive, so it lives in the Projects view (deleteProject, with the
// app's confirmModal) — mirroring workspaces, whose removal has always lived in
// the Workspaces view. The picker's hint links there.

// ===========================================================================
// WORKSPACES — target selector, management view, creation wizard, scan WS.
// All workspace paths are opt-in; project-mode behavior is byte-identical.
// ===========================================================================
const LAST_TARGET_KEY = 'worca-cc.runTarget';
const LAST_WORKSPACE_KEY = 'worca-cc.lastWorkspace';

const wsBasename = (p) => {
  if (!p) return '';
  const parts = String(p).replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || String(p);
};

// ---- Target selector (New Pipeline) ----------------------------------------

// Toggle Project vs Workspace target. Persists the choice; in workspace mode
// lazy-loads options and re-points the config panel at the built-in models.
function setRunTarget(target) {
  const t = target === 'workspace' ? 'workspace' : 'project';
  state.runTarget = t;
  localStorage.setItem(LAST_TARGET_KEY, t);

  // Segmented buttons + hidden radios (source of truth read at submit).
  $$('#target-seg button[data-target]').forEach((b) => {
    const on = b.dataset.target === t;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const radio = (el.targetRadios || []).find((r) => r.value === t);
  if (radio) radio.checked = true;

  // Panes are mutually exclusive; only the visible pane's value is read at submit.
  if (el.targetProjectPane) el.targetProjectPane.classList.toggle('hidden', t !== 'project');
  if (el.targetWorkspacePane) el.targetWorkspacePane.classList.toggle('hidden', t !== 'workspace');

  // Source-branch field: in workspace mode swap the single dropdown for one
  // per-project dropdown each defaulting to that project's current branch (HEAD).
  if (t === 'workspace') {
    // The single dropdown STAYS, disabled, stating what will happen ("current
    // branch (auto)") until a workspace with members replaces it with one
    // picker each — an empty column reads as a broken control, and the field
    // vanishing entirely made the row jump.
    showWorkspaceBranchPlaceholder();
    if (el.sourceBranchHint) el.sourceBranchHint.textContent = "One per project; each defaults to its current branch.";
    // Config panel: no projectDir → built-in models/efforts; workflow picker still works.
    loadConfig('');
    ensureWorkspaceOptions();
  } else {
    // Restore the single project-driven dropdown; clear the per-project list.
    if (el.sourceBranchWrap) el.sourceBranchWrap.classList.remove('hidden');
    if (el.sourceBranch) el.sourceBranch.disabled = false;
    if (el.wsSourceBranches) { el.wsSourceBranches.classList.add('hidden'); el.wsSourceBranches.innerHTML = ''; }
    if (el.sourceBranchHint) el.sourceBranchHint.textContent = "The worktree branches off this. Defaults to the current branch.";
    // Restore the project-driven branch list + config for the selected project.
    onProjectChanged();
  }
}

// Workspace mode with nothing to pick per member yet: keep the field occupied by
// a disabled dropdown that says what the run will do. Its value is never read —
// the submit handler deletes sourceBranch in workspace mode.
function showWorkspaceBranchPlaceholder() {
  if (el.sourceBranchWrap) el.sourceBranchWrap.classList.remove('hidden');
  if (!el.sourceBranch) return;
  seedBranchPlaceholder(el.sourceBranch, 'current branch (auto)');
  el.sourceBranch.disabled = true;
  el.sourceBranch.title = "Set per project once a workspace is chosen; each defaults to its current branch.";
}

// Render the member chips for the currently-selected workspace.
function renderWorkspaceMembers() {
  const host = el.wsMembers;
  if (!host) return;
  host.innerHTML = '';
  const ws = state.workspaces.find((w) => w && w.id === state.selectedWorkspaceId);
  if (!ws || !Array.isArray(ws.projectPaths)) return;
  ws.projectPaths.forEach((p, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const missing = Array.isArray(ws.exists) && ws.exists[i] === false;
    if (missing) chip.classList.add('missing');
    chip.textContent = wsBasename(p) + (missing ? ' (missing)' : '');
    host.appendChild(chip);
  });
}

// Render one source-branch dropdown per member of the selected workspace, each
// keyed by projectKey and defaulted to that project's current branch (HEAD).
function renderWorkspaceSourceBranches() {
  const host = el.wsSourceBranches;
  if (!host) return;
  host.innerHTML = '';
  const ws = state.workspaces.find((w) => w && w.id === state.selectedWorkspaceId);
  if (!ws || !Array.isArray(ws.projectPaths) || !ws.projectPaths.length) {
    host.classList.add('hidden');
    showWorkspaceBranchPlaceholder(); // nothing per-member to show: keep the field occupied
    return;
  }
  host.classList.remove('hidden');
  // Real per-member pickers now exist, so the disabled stand-in would only be a
  // dead control sitting above live ones.
  if (el.sourceBranchWrap) el.sourceBranchWrap.classList.add('hidden');
  ws.projectPaths.forEach((p, i) => {
    const key = (Array.isArray(ws.projectKeys) && ws.projectKeys[i]) || '';
    const missing = Array.isArray(ws.exists) && ws.exists[i] === false;

    const row = document.createElement('div');
    row.className = 'ws-src-row';

    const name = document.createElement('span');
    name.className = 'ws-src-name';
    name.textContent = wsBasename(p) + (missing ? ' (missing)' : '');

    const wrap = document.createElement('div');
    wrap.className = 'select-wrap';
    const sel = document.createElement('select');
    sel.className = 'select ws-src-select';
    sel.dataset.projectKey = key;
    wrap.appendChild(sel);

    row.appendChild(name);
    row.appendChild(wrap);
    host.appendChild(row);

    if (missing) {
      sel.disabled = true;
      seedBranchPlaceholder(sel, 'current branch (auto)');
    } else {
      populateBranchSelect(sel, p); // async; defaults to HEAD per the clarification
    }
  });
}

// Populate #workspaceSelect from state.workspaces (loading them if empty).
// Workspaces with any missing member are rendered disabled "+ (incomplete)".
// Restores LAST_WORKSPACE_KEY when valid.
async function ensureWorkspaceOptions() {
  const sel = el.workspaceSelect;
  if (!sel) return;
  if (!state.workspaces.length) await loadWorkspaces();

  sel.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.textContent = state.workspaces.length ? 'Select a workspace…' : 'No workspaces yet';
  sel.appendChild(placeholder);

  const want = state.selectedWorkspaceId || localStorage.getItem(LAST_WORKSPACE_KEY) || '';
  let restored = false;
  for (const w of state.workspaces) {
    if (!w || !w.id) continue;
    const incomplete = Array.isArray(w.exists) && w.exists.some((e) => !e);
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.dataset.name = w.name || '';
    opt.textContent = (w.name || w.id) + (incomplete ? ' (incomplete)' : '');
    if (incomplete) opt.disabled = true;
    sel.appendChild(opt);
    if (!incomplete && w.id === want) { opt.selected = true; restored = true; }
  }
  if (restored) {
    state.selectedWorkspaceId = want;
    localStorage.setItem(LAST_WORKSPACE_KEY, want);
  } else {
    state.selectedWorkspaceId = '';
    placeholder.selected = true;
  }
  renderWorkspaceMembers();
  renderWorkspaceSourceBranches();
}

if (el.targetSeg) {
  $$('#target-seg button[data-target]').forEach((btn) => {
    btn.addEventListener('click', () => setRunTarget(btn.dataset.target));
  });
}
if (el.workspaceSelect) {
  el.workspaceSelect.addEventListener('change', () => {
    state.selectedWorkspaceId = el.workspaceSelect.value || '';
    if (state.selectedWorkspaceId) localStorage.setItem(LAST_WORKSPACE_KEY, state.selectedWorkspaceId);
    renderWorkspaceMembers();
    renderWorkspaceSourceBranches();
  });
}

// ---- Workspaces data load --------------------------------------------------

// Fetch /api/workspaces into state.workspaces. Clears a stale remembered
// selection (and falls back to project target) when its id is gone. Degrades
// gracefully to [] when the route 404s / errors.
async function loadWorkspaces() {
  try {
    const res = await fetch('/api/workspaces');
    const data = await safeJson(res);
    state.workspaces = res.ok && Array.isArray(data.workspaces) ? data.workspaces : [];
  } catch {
    state.workspaces = [];
  }
  // Stale selection guard: a remembered workspace id not in the fetched list is
  // cleared, and we fall back to project target.
  const remembered = localStorage.getItem(LAST_WORKSPACE_KEY) || '';
  if (remembered && !state.workspaces.some((w) => w && w.id === remembered)) {
    localStorage.removeItem(LAST_WORKSPACE_KEY);
    if (state.selectedWorkspaceId === remembered) state.selectedWorkspaceId = '';
    if (state.runTarget === 'workspace') setRunTarget('project');
  }
  return state.workspaces;
}

function updateWorkspacesCount() {
  if (el.navWorkspacesCount) el.navWorkspacesCount.textContent = String(state.workspaces.length);
}

// ---- Workspaces management view --------------------------------------------

async function loadWorkspacesView() {
  await loadWorkspaces();
  renderWorkspaces();
  updateWorkspacesCount();
}

function setWsMsg(text, kind) {
  if (!el.wsMsg) return;
  el.wsMsg.textContent = text || '';
  el.wsMsg.className = 'form-msg' + (kind ? ' ' + kind : '');
}

function renderWorkspaces() {
  const host = el.wsList;
  if (!host) return;
  host.innerHTML = '';
  if (!state.workspaces.length) {
    host.appendChild(histEmpty('No workspaces yet — create one to scan a set of projects.'));
    return;
  }
  for (const w of state.workspaces) host.appendChild(buildWorkspaceCard(w));
}

// Build one workspace card from the template. The description is markdown shown
// VERBATIM in a <pre> (no renderer — matches the #viewer pattern; .textContent
// only, never innerHTML).
function buildWorkspaceCard(w) {
  const tpl = $('#ws-card-tpl');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.workspaceId = w.id || '';

  const nameEl = node.querySelector('.ws-name');
  if (nameEl) nameEl.textContent = w.name || w.id || '(unnamed)';

  const projEl = node.querySelector('.ws-projects');
  if (projEl) projEl.textContent = (Array.isArray(w.projectPaths) ? w.projectPaths.map(wsBasename) : []).join(' · ');

  const stale = node.querySelector('.ws-stale');
  if (stale) stale.hidden = !(Array.isArray(w.exists) && w.exists.some((e) => !e));

  const descView = node.querySelector('.ws-desc-view');
  if (descView) descView.textContent = w.description || '(no description yet — re-scan to generate one)';

  return node;
}

// Delegated actions on the workspaces list.
if (el.wsList) {
  el.wsList.addEventListener('click', (e) => {
    const card = e.target.closest && e.target.closest('.ws-card');
    if (!card) return;
    const id = card.dataset.workspaceId;
    const w = state.workspaces.find((x) => x && x.id === id);

    if (e.target.closest('.ws-edit')) { e.stopPropagation(); openWsEdit(card, w); return; }
    if (e.target.closest('.ws-desc-cancel')) { e.stopPropagation(); closeWsEdit(card, w); return; }
    if (e.target.closest('.ws-desc-save')) { e.stopPropagation(); saveWsDescription(card, w); return; }
    if (e.target.closest('.ws-rescan')) { e.stopPropagation(); rescanWorkspace(w); return; }
    if (e.target.closest('.ws-delete')) { e.stopPropagation(); deleteWorkspaceCard(card, w); return; }

    // Header click toggles the detail pane.
    if (e.target.closest('.ws-head')) toggleWsDetail(card);
  });
  el.wsList.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const head = e.target.closest && e.target.closest('.ws-head');
    if (!head) return;
    e.preventDefault();
    toggleWsDetail(head.closest('.ws-card'));
  });
}

function toggleWsDetail(card) {
  if (!card) return;
  const head = card.querySelector('.ws-head');
  const detail = card.querySelector('.ws-detail');
  if (!head || !detail) return;
  const open = head.getAttribute('aria-expanded') === 'true';
  head.setAttribute('aria-expanded', String(!open));
  detail.hidden = open;
}

function openWsEdit(card, w) {
  if (!card || !w) return;
  const detail = card.querySelector('.ws-detail');
  const head = card.querySelector('.ws-head');
  if (detail && head && detail.hidden) { detail.hidden = false; head.setAttribute('aria-expanded', 'true'); }
  const pane = card.querySelector('.ws-desc-edit');
  const input = card.querySelector('.ws-desc-input');
  if (input) input.value = w.description || '';
  if (pane) pane.hidden = false;
  if (input) input.focus();
}

function closeWsEdit(card) {
  const pane = card && card.querySelector('.ws-desc-edit');
  if (pane) pane.hidden = true;
}

// Save an edited description: PATCH /api/workspaces/:id { description }. JSON-safe
// (JSON.stringify); the textarea value is read via .value, written via .textContent.
async function saveWsDescription(card, w) {
  if (!card || !w) return;
  const input = card.querySelector('.ws-desc-input');
  const description = input ? input.value : '';
  const saveBtn = card.querySelector('.ws-desc-save');
  if (saveBtn) saveBtn.disabled = true;
  try {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(w.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    const data = await safeJson(res);
    if (!res.ok) { setWsMsg(data.error || `HTTP ${res.status}`, 'err'); return; }
    const updated = data.workspace || { ...w, description };
    const i = state.workspaces.findIndex((x) => x && x.id === w.id);
    if (i >= 0) state.workspaces[i] = updated;
    setWsMsg('Description saved.', 'ok');
    renderWorkspaces();
  } catch (err) {
    setWsMsg(err.message, 'err');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// Re-scan: POST /api/workspaces/:id/scan and jump into the wizard at Step 2 with
// editingId set, so Step 3 Save issues a PATCH (not a POST).
async function rescanWorkspace(w) {
  if (!w) return;
  state.wizard.editingId = w.id;
  state.wizard.name = w.name || '';
  state.wizard.selectedPaths = Array.isArray(w.projectPaths) ? [...w.projectPaths] : [];
  location.hash = 'workspace-create';
  // showView('workspace-create') runs enterWizard(); kick off the scan after.
  await startWizardScan();
}

// Delete: confirm, then DELETE. 200 removes the card + surfaces warnings; 409
// (live run/scan) keeps the card + surfaces data.error.
async function deleteWorkspaceCard(card, w) {
  if (!card || !w) return;
  if (!window.confirm(`Delete workspace "${w.name || w.id}"?\n\nThis removes its history store and best-effort branch cleanup. This cannot be undone.`)) return;
  const btn = card.querySelector('.ws-delete');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(w.id)}`, { method: 'DELETE' });
    const data = await safeJson(res);
    if (res.status === 409) { setWsMsg(data.error || 'Workspace has a live run or scan.', 'err'); if (btn) btn.disabled = false; return; }
    if (!res.ok) { setWsMsg(data.error || `HTTP ${res.status}`, 'err'); if (btn) btn.disabled = false; return; }
    state.workspaces = state.workspaces.filter((x) => !(x && x.id === w.id));
    if (state.selectedWorkspaceId === w.id) state.selectedWorkspaceId = '';
    if (localStorage.getItem(LAST_WORKSPACE_KEY) === w.id) localStorage.removeItem(LAST_WORKSPACE_KEY);
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    setWsMsg(warnings.length ? `Deleted. Warnings: ${warnings.join('; ')}` : 'Workspace deleted.', warnings.length ? '' : 'ok');
    renderWorkspaces();
    updateWorkspacesCount();
  } catch (err) {
    setWsMsg(err.message, 'err');
    if (btn) btn.disabled = false;
  }
}

if (el.wsCreateBtn) el.wsCreateBtn.addEventListener('click', () => { location.hash = 'workspace-create'; });

// ---- Creation wizard -------------------------------------------------------

// Reset the ephemeral wizard state to defaults, preserving a re-scan's editingId
// + selectedPaths so Step 2/3 still know what they're scanning.
function resetWizard(preserveEditing = false) {
  const keepId = preserveEditing ? state.wizard.editingId : '';
  const keepPaths = preserveEditing ? state.wizard.selectedPaths : [];
  state.wizard = {
    step: 1, name: preserveEditing ? state.wizard.name : '', selectedPaths: keepPaths,
    scanId: '', description: '', graphifyUsed: null, abort: null, editingId: keepId,
  };
}

// enterWizard is idempotent: it does NOT reset if a scan is already live;
// otherwise it resets (preserving a re-scan's editingId/selectedPaths), loads the
// project list, and shows the current step.
async function enterWizard() {
  const liveScan = !!state.wizard.scanId || !!state.wizard.abort;
  if (!liveScan) {
    const editing = !!state.wizard.editingId;
    if (!editing) resetWizard(false);
  }
  if (el.wizTitle) el.wizTitle.textContent = state.wizard.editingId ? 'Re-scan workspace' : 'Create workspace';
  if (el.wizName) {
    el.wizName.value = state.wizard.name || '';
    el.wizName.disabled = !!state.wizard.editingId; // name immutable on re-scan
  }
  if (!state.projects.length) await loadProjects();
  renderWizardProjects();
  showWizardStep(state.wizard.step || 1);
}

// Toggle the three wizard step panes.
function showWizardStep(step) {
  state.wizard.step = step;
  for (let i = 1; i <= 3; i++) {
    const pane = document.getElementById(`wiz-step-${i}`);
    if (pane) pane.classList.toggle('hidden', i !== step);
  }
}

// Render one checkbox per onboarded project (disabled for !exists). Pre-checks
// anything already in selectedPaths (re-scan). Enables Start only at 2+.
function renderWizardProjects() {
  const host = el.wizProjects;
  if (!host) return;
  host.innerHTML = '';
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const usable = projects.filter((p) => p && p.exists);

  if (el.wizStep1Hint) {
    el.wizStep1Hint.textContent = usable.length < 2
      ? 'Onboard at least two projects (in New Pipeline) to create a workspace.'
      : 'Select two or more projects to scan their interconnections.';
  }

  projects.forEach((p) => {
    if (!p || !p.path) return;
    const row = document.createElement('label');
    row.className = 'wiz-proj' + (p.exists ? '' : ' missing');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'wiz-proj-cb';
    cb.value = p.path;
    cb.disabled = !p.exists;
    cb.checked = state.wizard.selectedPaths.includes(p.path);
    cb.addEventListener('change', () => {
      const set = new Set(state.wizard.selectedPaths);
      if (cb.checked) set.add(p.path); else set.delete(p.path);
      state.wizard.selectedPaths = [...set];
      syncWizardStartEnabled();
    });
    const txt = document.createElement('span');
    txt.textContent = p.exists ? p.name : `${p.name} (missing)`;
    row.append(cb, txt);
    host.appendChild(row);
  });
  syncWizardStartEnabled();
}

function syncWizardStartEnabled() {
  if (el.wizStartScan) el.wizStartScan.disabled = state.wizard.selectedPaths.length < 2;
}

// Start (or restart) the scan. Validates name + 2+ projects, shows Step 2,
// creates an AbortController, POSTs (pre-persist for new / :id/scan for re-scan),
// stores scanId, and subscribes. The scan runs BEFORE the workspace is persisted.
async function startWizardScan() {
  const editing = !!state.wizard.editingId;
  const name = el.wizName ? el.wizName.value.trim() : state.wizard.name;
  state.wizard.name = name;
  if (!editing && !name) { showWizardStep(1); setStatusText(''); if (el.wizName) el.wizName.focus(); return; }
  if (state.wizard.selectedPaths.length < 2) { showWizardStep(1); return; }

  // Clear any prior scanId BEFORE the POST resolves, so a buffered/duplicate
  // scan-* for the OLD scan can never match (onScanEvent gates on scanId).
  state.wizard.scanId = '';

  // Reset Step 2 surface.
  setStatusText('Starting scan…');
  if (el.wizProgress) el.wizProgress.textContent = '';
  markScanPhase('');
  if (el.wizMsg) el.wizMsg.textContent = '';
  showWizardStep(2);

  const abort = new AbortController();
  state.wizard.abort = abort;

  const url = editing
    ? `/api/workspaces/${encodeURIComponent(state.wizard.editingId)}/scan`
    : '/api/workspaces/scan';
  const body = editing ? {} : { projectPaths: state.wizard.selectedPaths, name };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    const data = await safeJson(res);
    if (!res.ok || !data.scanId) {
      state.wizard.abort = null;
      setStatusText('');
      showWizardStep(1);
      setWizStep1Error(data.error || `Scan failed (${res.status})`);
      return;
    }
    state.wizard.scanId = data.scanId;
    subscribeScan(data.scanId);
  } catch (err) {
    if (err && err.name === 'AbortError') return; // user aborted; leave-guard handled state
    state.wizard.abort = null;
    setStatusText('');
    showWizardStep(1);
    setWizStep1Error(err.message);
  }
}

function setWizStep1Error(message) {
  if (el.wizStep1Hint) el.wizStep1Hint.textContent = `Scan error: ${message}`;
}

// Persist at Step 3 Save: new → POST /api/workspaces; re-scan → PATCH :id.
// On 200 reset + navigate to #workspaces. On 409 (dup name OR dup set) surface
// data.error verbatim and KEEP the user on Step 3 with their edited text intact.
async function saveWorkspace() {
  const description = el.wizDesc ? el.wizDesc.value : '';
  state.wizard.description = description;
  const editing = !!state.wizard.editingId;
  if (el.wizMsg) el.wizMsg.textContent = '';
  if (el.wizSave) el.wizSave.disabled = true;

  const url = editing
    ? `/api/workspaces/${encodeURIComponent(state.wizard.editingId)}`
    : '/api/workspaces';
  const method = editing ? 'PATCH' : 'POST';
  const body = editing
    ? { description }
    : { name: state.wizard.name, projectPaths: state.wizard.selectedPaths, description };

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await safeJson(res);
    if (res.status === 409) { setWizMsg(data.error || 'Duplicate workspace.', 'err'); return; }
    if (!res.ok) { setWizMsg(data.error || `HTTP ${res.status}`, 'err'); return; }
    resetWizard(false);
    await loadWorkspaces();
    updateWorkspacesCount();
    location.hash = 'workspaces';
  } catch (err) {
    setWizMsg(err.message, 'err');
  } finally {
    if (el.wizSave) el.wizSave.disabled = false;
  }
}

function setWizMsg(text, kind) {
  if (!el.wizMsg) return;
  el.wizMsg.textContent = text || '';
  el.wizMsg.className = 'form-msg' + (kind ? ' ' + kind : '');
}

// Abort a live scan: abort the fetch, unsubscribe, clear wizard scan state.
// Invoked by the leave-guard, #wiz-abort, and Cancel.
function abortWizardScan() {
  const scanId = state.wizard.scanId;
  if (state.wizard.abort) { try { state.wizard.abort.abort(); } catch { /* ignore */ } }
  if (scanId) {
    const ws = state.ws;
    if (ws && state.wsReady) { try { ws.send(JSON.stringify({ type: 'unsubscribe', scanId })); } catch { /* ignore */ } }
  }
  state.wizard.abort = null;
  state.wizard.scanId = '';
}

if (el.wizStartScan) el.wizStartScan.addEventListener('click', () => startWizardScan());
if (el.wizAbort) el.wizAbort.addEventListener('click', () => { abortWizardScan(); showWizardStep(1); });
if (el.wizRescan) el.wizRescan.addEventListener('click', () => startWizardScan());
if (el.wizSave) el.wizSave.addEventListener('click', () => saveWorkspace());
if (el.wizClose) el.wizClose.addEventListener('click', () => { location.hash = state.wizard.editingId ? 'workspaces' : 'new'; });
if (el.wizName) el.wizName.addEventListener('input', () => { state.wizard.name = el.wizName.value; });

// A11y: Escape in the wizard view triggers #wiz-close (which navigates away;
// the showView leave-guard aborts any live scan). Scoped to the wizard view so
// it never collides with the viewer-modal Escape handler.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (currentView() !== 'workspace-create') return;
  if (el.viewerCard && !el.viewerCard.classList.contains('hidden')) return; // modal owns Escape
  if (el.folderBrowser && !el.folderBrowser.classList.contains('hidden')) return; // modal owns Escape
  if (el.wizClose) el.wizClose.click();
});

// ---- Scan WebSocket wiring -------------------------------------------------

// Bind the live, CHANGING status text. .ws-loader carries role="status"
// aria-live="polite", so each update is announced.
function setStatusText(text) {
  if (el.wizStatus) el.wizStatus.textContent = text || '';
}

// Light up the phase track; phases progress graph → investigate → synthesize.
function markScanPhase(phase) {
  if (!el.wizPhases) return;
  el.wizPhases.querySelectorAll('[data-phase]').forEach((n) => {
    n.classList.toggle('active', !!phase && n.dataset.phase === phase);
  });
}

// Subscribe to a scan's buffered events on the shared socket.
function subscribeScan(scanId) {
  const ws = state.ws;
  if (ws && state.wsReady) { try { ws.send(JSON.stringify({ type: 'subscribe', scanId })); } catch { /* ignore */ } }
}

// Route a scan-* event. Ignores events for a different/aborted scan.
function onScanEvent(msg) {
  if (!msg || !msg.scanId || msg.scanId !== state.wizard.scanId) return; // stale/aborted scan
  if (msg.type === 'scan-progress') {
    setStatusText(msg.message || '');
    if (el.wizProgress && (msg.projectsTotal != null)) {
      el.wizProgress.textContent = `${msg.projectsDone || 0} / ${msg.projectsTotal} projects`;
    }
    markScanPhase(msg.phase || '');
    return;
  }
  if (msg.type === 'scan-done') {
    state.wizard.abort = null;
    state.wizard.description = typeof msg.description === 'string' ? msg.description : '';
    state.wizard.graphifyUsed = !!(msg.graphify && msg.graphify.used);
    if (el.wizDesc) el.wizDesc.value = state.wizard.description; // .value only — never innerHTML
    if (el.wizGraphifyNote) {
      el.wizGraphifyNote.textContent = state.wizard.graphifyUsed
        ? 'Generated with graphify-assisted analysis.'
        : 'Generated from source reading (graphify not available).';
    }
    showWizardStep(3);
    return;
  }
  if (msg.type === 'scan-error') {
    state.wizard.abort = null;
    state.wizard.scanId = '';
    showWizardStep(1);
    setWizStep1Error(msg.message || 'scan failed');
  }
}

// Test hook: expose the wizard helpers + workspace renderers for jsdom tests.
if (typeof window !== 'undefined') {
  window.__ws = {
    setRunTarget, ensureWorkspaceOptions, loadWorkspaces, loadWorkspacesView,
    renderWorkspaces, buildWorkspaceCard, enterWizard, showWizardStep,
    renderWizardProjects, startWizardScan, saveWorkspace, abortWizardScan,
    onScanEvent, subscribeScan, setStatusText, resetWizard,
    renderWorkspaceSourceBranches,
  };
}

// ---- Agents management view -------------------------------------------------

// After any agent mutation: drop the new-pipeline config registry memo
// (getAgentsApi) and mark the composer palette for a refetch on next entry.
function invalidateAgentCaches() {
  state.agents = {};
  _composerPaletteDirty = true;
}

async function loadAgentsList() {
  try {
    const res = await fetch('/api/agents?all=1');
    const data = await safeJson(res);
    state.agentsList = res.ok && Array.isArray(data.agents) ? data.agents : [];
    if (res.ok && Array.isArray(data.channels)) state.channelIds = data.channels;
  } catch { state.agentsList = []; }
  return state.agentsList;
}

async function loadAgentsView() {
  await loadAgentsList();
  renderAgentsList();
}

function setAgentsMsg(text, kind) {
  if (!el.agentsMsg) return;
  el.agentsMsg.textContent = text || '';
  el.agentsMsg.className = 'form-msg' + (kind ? ' ' + kind : '');
}

function agentChip(text, cls) {
  const s = document.createElement('span');
  s.className = 'agent-chip ' + cls;
  s.textContent = text;
  return s;
}

function fillChannelRow(container, ids, cls) {
  const list = Array.isArray(ids) ? ids : [];
  if (list.length === 0) {
    const none = document.createElement('span');
    none.className = 'agent-io-none';
    none.textContent = '—';
    container.appendChild(none);
    return;
  }
  list.forEach((c) => container.appendChild(agentChip(c, cls)));
}

function buildAgentCard(a) {
  const tpl = $('#agent-card-tpl');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.agentKey = a.key || '';
  node.querySelector('.agent-name').textContent = a.displayName || a.key;
  node.querySelector('.agent-origin').textContent = a.origin || 'builtin';
  node.querySelector('.agent-origin').classList.add(a.origin === 'user' ? 'origin-user' : 'origin-builtin');
  node.querySelector('.agent-sub').textContent = `${a.key} · ${a.runnerType || 'producer'} — ${a.description || ''}`;
  fillChannelRow(node.querySelector('.agent-chips-in'), a.consumes, 'cons');   // INPUT row
  fillChannelRow(node.querySelector('.agent-chips-out'), a.produces, 'prod');  // OUTPUT row
  const isUser = a.origin === 'user';
  node.querySelector('.agent-edit').hidden = !isUser;
  node.querySelector('.agent-delete').hidden = !isUser;
  node.querySelector('.agent-duplicate').hidden = isUser;
  return node;
}

function renderAgentsList() {
  const host = el.agentsList;
  if (!host) return;
  host.innerHTML = '';
  if (!state.agentsList.length) {
    host.appendChild(histEmpty('No agents found — is the server running?'));
    return;
  }
  const groups = [
    ['Built-in agents', state.agentsList.filter((a) => a.origin !== 'user')],
    ['Your agents', state.agentsList.filter((a) => a.origin === 'user')],
  ];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    const h = document.createElement('div');
    h.className = 'agents-group-label';
    h.textContent = label;
    host.appendChild(h);
    for (const a of list) host.appendChild(buildAgentCard(a));
  }
}

function toggleAgentDetail(card) {
  const head = card.querySelector('.agent-head');
  const detail = card.querySelector('.agent-detail');
  const open = head.getAttribute('aria-expanded') === 'true';
  head.setAttribute('aria-expanded', String(!open));
  detail.hidden = open;
  if (!open && !detail.dataset.loaded) {
    detail.dataset.loaded = '1';
    fetchAgentFull(card.dataset.agentKey).then((data) => {
      const pre = card.querySelector('.agent-md-view');
      if (pre) pre.textContent = (data && data.markdown) || '(no markdown body)';
    });
  }
}

async function fetchAgentFull(key) {
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(key)}`);
    const data = await safeJson(res);
    return res.ok ? data : null;
  } catch { return null; }
}

async function deleteAgentCard(card, a) {
  if (!window.confirm(`Delete agent "${a.displayName || a.key}"?\n\nThis removes its markdown + metadata pair. This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(a.key)}`, { method: 'DELETE' });
    const data = await safeJson(res);
    if (!res.ok) { setAgentsMsg(data.error || `HTTP ${res.status}`, 'err'); return; }
    state.agentsList = state.agentsList.filter((x) => x.key !== a.key);
    invalidateAgentCaches();
    setAgentsMsg('Agent deleted.', 'ok');
    renderAgentsList();
  } catch (err) { setAgentsMsg(err.message, 'err'); }
}

async function duplicateAgentCard(a) {
  const full = await fetchAgentFull(a.key);
  if (!full) { setAgentsMsg('Could not load the agent to duplicate.', 'err'); return; }
  // Drop the computed fields (this path never goes through the form): the copy
  // gets its own key/agentFile, and a description derived from the source .md
  // frontmatter must not be copied in as authored sidecar text.
  const { key, origin, agentFile, agentPath, descriptionDerived, ...rest } = full.meta || {};
  const meta = { ...rest, displayName: `${full.meta.displayName || a.key} (copy)` };
  if (descriptionDerived) meta.description = '';
  try {
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta, markdown: full.markdown }),
    });
    const data = await safeJson(res);
    if (!res.ok) { setAgentsMsg(data.error || `HTTP ${res.status}`, 'err'); return; }
    invalidateAgentCaches();
    setAgentsMsg(`Duplicated as "${data.meta.key}".`, 'ok');
    await loadAgentsView();
  } catch (err) { setAgentsMsg(err.message, 'err'); }
}

// ---- Shared agent metadata form (used by the card editor AND wizard Step 3) ---

// One checkbox per option into host; values bound via .checked (never innerHTML).
function buildChipChecks(host, options, selected) {
  host.innerHTML = '';
  const sel = new Set(Array.isArray(selected) ? selected : []);
  for (const opt of options) {
    const row = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = opt;
    cb.checked = sel.has(opt);
    const txt = document.createElement('span');
    txt.textContent = opt;
    row.append(cb, txt);
    host.appendChild(row);
  }
}
const chipValues = (host) => [...host.querySelectorAll('input:checked')].map((c) => c.value);

// The two questions sub-flags are meaningless (and normalizeMeta force-clears
// them) when the agent cannot ask; mirror that in the form.
function syncQuestionFlags(root) {
  const asks = root.querySelector('.agent-f-questions');
  const locked = root.querySelector('.agent-f-questions-locked');
  const def = root.querySelector('.agent-f-questions-default');
  if (!asks || !locked || !def) return;
  locked.disabled = !asks.checked;
  def.disabled = !asks.checked;
  if (!asks.checked) { locked.checked = false; def.checked = false; }
}

// Fill every .agent-f-* field under `root` from meta (+ optional markdown).
function agentFormFill(root, meta, markdown) {
  const known = state.channelIds.length ? state.channelIds : ['userPrompt', 'plan', 'review', 'checklist', 'code', 'workspace', 'clarify', 'decomposition'];
  // Channels are an open vocabulary: union the server list with the meta's own
  // ids (known first, then its extra customs) so a stale/closed list can never
  // drop a custom channel on the edit round-trip.
  const channels = [...known];
  const own = [meta.consumes, meta.optionalConsumes, meta.produces];
  for (const list of own) {
    for (const id of Array.isArray(list) ? list : []) {
      if (typeof id === 'string' && id && !channels.includes(id)) channels.push(id);
    }
  }
  const agentKeys = state.agentsList.map((a) => a.key).filter((k) => k !== meta.key);
  root.querySelector('.agent-f-name').value = meta.displayName || '';
  // A description resolved from the .md frontmatter is computed, not authored:
  // show it as a placeholder so the user knows where the blurb comes from, but
  // never as a value — pre-filling it would PUT it straight back and freeze the
  // fallback into the sidecar (and make an empty description unreachable).
  const descInput = root.querySelector('.agent-f-desc');
  descInput.value = meta.descriptionDerived ? '' : (meta.description || '');
  descInput.placeholder = meta.descriptionDerived ? meta.description : '';
  root.querySelector('.agent-f-color').value = meta.color || 'amber';
  root.querySelector('.agent-f-runner').value = meta.runnerType || 'producer';
  buildChipChecks(root.querySelector('.agent-f-consumes'), channels, meta.consumes);
  buildChipChecks(root.querySelector('.agent-f-optional'), channels, meta.optionalConsumes);
  buildChipChecks(root.querySelector('.agent-f-produces'), channels, meta.produces);
  const any = meta.connectsTo === '*' || meta.connectsTo === undefined;
  root.querySelector('.agent-f-connect-any').checked = any;
  buildChipChecks(root.querySelector('.agent-f-connects'), agentKeys, any ? [] : meta.connectsTo);
  root.querySelector('.agent-f-connects').hidden = any;
  root.querySelector('.agent-f-order').value = meta.order != null ? String(meta.order) : '99';
  root.querySelector('.agent-f-fanout').checked = !!meta.fanOut;
  root.querySelector('.agent-f-loopsource').checked = !!meta.loopSource;
  root.querySelector('.agent-f-questions').checked = !!meta.asksQuestions;
  root.querySelector('.agent-f-questions-locked').checked = !!meta.questionsLocked;
  root.querySelector('.agent-f-questions-default').checked = !!meta.questionsDefault;
  syncQuestionFlags(root);
  root.querySelector('.agent-f-questions').onchange = () => syncQuestionFlags(root);
  if (typeof markdown === 'string') root.querySelector('.agent-f-md').value = markdown; // .value only — never innerHTML
}

// Read the form back into { meta, markdown }.
function agentFormRead(root) {
  const any = root.querySelector('.agent-f-connect-any').checked;
  return {
    meta: {
      displayName: root.querySelector('.agent-f-name').value.trim(),
      description: root.querySelector('.agent-f-desc').value.trim(),
      color: root.querySelector('.agent-f-color').value,
      runnerType: root.querySelector('.agent-f-runner').value,
      consumes: chipValues(root.querySelector('.agent-f-consumes')),
      optionalConsumes: chipValues(root.querySelector('.agent-f-optional')),
      produces: chipValues(root.querySelector('.agent-f-produces')),
      connectsTo: any ? '*' : chipValues(root.querySelector('.agent-f-connects')),
      order: Number(root.querySelector('.agent-f-order').value),
      fanOut: root.querySelector('.agent-f-fanout').checked,
      loopSource: root.querySelector('.agent-f-loopsource').checked,
      asksQuestions: root.querySelector('.agent-f-questions').checked,
      questionsLocked: root.querySelector('.agent-f-questions-locked').checked,
      questionsDefault: root.querySelector('.agent-f-questions-default').checked,
    },
    markdown: root.querySelector('.agent-f-md').value,
  };
}

async function openAgentEdit(card, a) {
  const detail = card.querySelector('.agent-detail');
  const head = card.querySelector('.agent-head');
  if (detail.hidden) { detail.hidden = false; head.setAttribute('aria-expanded', 'true'); }
  const full = await fetchAgentFull(a.key);
  if (!full) { setAgentsMsg('Could not load the agent.', 'err'); return; }
  const pane = card.querySelector('.agent-edit-pane');
  agentFormFill(pane, full.meta, full.markdown);
  pane.hidden = false;
  const anyCb = pane.querySelector('.agent-f-connect-any');
  anyCb.onchange = () => { pane.querySelector('.agent-f-connects').hidden = anyCb.checked; };
  pane.querySelector('.agent-edit-cancel').onclick = () => { pane.hidden = true; };
  pane.querySelector('.agent-edit-save').onclick = () => saveAgentEdit(card, a, pane);
}

async function saveAgentEdit(card, a, pane) {
  const msg = pane.querySelector('.agent-edit-msg');
  msg.textContent = '';
  msg.className = 'agent-edit-msg form-msg';
  const body = agentFormRead(pane);
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(a.key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await safeJson(res);
    if (!res.ok) { msg.textContent = data.error || `HTTP ${res.status}`; msg.className = 'agent-edit-msg form-msg err'; return; }
    pane.hidden = true;
    invalidateAgentCaches();
    setAgentsMsg('Agent saved.', 'ok');
    await loadAgentsView();
  } catch (err) { msg.textContent = err.message; msg.className = 'agent-edit-msg form-msg err'; }
}

if (el.agentsList) {
  el.agentsList.addEventListener('click', (e) => {
    const card = e.target.closest && e.target.closest('.agent-card');
    if (!card) return;
    const a = state.agentsList.find((x) => x.key === card.dataset.agentKey);
    if (e.target.closest('.agent-delete')) { e.stopPropagation(); if (a) deleteAgentCard(card, a); return; }
    if (e.target.closest('.agent-duplicate')) { e.stopPropagation(); if (a) duplicateAgentCard(a); return; }
    if (e.target.closest('.agent-edit')) { e.stopPropagation(); if (a) openAgentEdit(card, a); return; }
    if (e.target.closest('.agent-head')) toggleAgentDetail(card);
  });
  // Keyboard access for the role=button header (mirrors the ws-head pattern).
  el.agentsList.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const head = e.target.closest && e.target.closest('.agent-head');
    if (!head) return;
    e.preventDefault();
    toggleAgentDetail(head.closest('.agent-card'));
  });
}
if (el.agentCreateBtn) el.agentCreateBtn.addEventListener('click', () => { location.hash = 'agent-create'; });

// Test hook (mirrors window.__ws).
if (typeof window !== 'undefined') {
  window.__agents = { loadAgentsList, loadAgentsView, renderAgentsList, buildAgentCard, deleteAgentCard, duplicateAgentCard, agentFormFill, agentFormRead, openAgentEdit };
}

// ---------------------------------------------------------------------------
// Projects management view (sidebar peer of Workspaces / Agents).
// Read-only list of {name, path, exists}; add via native picker, delete via a
// custom confirm modal. Shares state.projects with the New-pipeline dropdown.
// ---------------------------------------------------------------------------

// The one bin/trash icon used across the UI (mirrors app.js:1775). Static markup
// -> safe to assign via innerHTML.
const TRASH_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function setProjectsMsg(text, kind) {
  if (!el.projectsMsg) return;
  el.projectsMsg.textContent = text || '';
  el.projectsMsg.className = 'form-msg' + (kind ? ' ' + kind : '');
}

function updateProjectsCount() {
  if (el.navProjectsCount) el.navProjectsCount.textContent = String(state.projects.length);
}

// Folder basename, tolerant of trailing slashes and either separator.
function basenameOf(p) {
  return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
}

// Thin wrapper over the native picker endpoint; never throws.
async function pickFolder() {
  try {
    const res = await fetch('/api/fs/pick-folder', { method: 'POST' });
    return await safeJson(res); // {status:'picked',path} | {status:'canceled'} | {status:'unsupported'} | {status:'busy'}
  } catch {
    return { status: 'unsupported' };
  }
}

async function loadProjectsView() {
  await loadProjects();      // refresh shared state.projects from /api/projects
  renderProjectsList();
}

function buildProjectRow(p) {
  const item = document.createElement('div');
  item.className = 'pl-item';
  item.dataset.name = p.name;

  const row = document.createElement('div');
  row.className = 'pl-row';

  const main = document.createElement('div');
  main.className = 'pl-main';

  const name = document.createElement('div');
  name.className = 'pl-name';
  name.textContent = p.name;
  if (!p.exists) {
    const miss = document.createElement('span');
    miss.className = 'proj-missing';
    miss.textContent = 'missing';
    name.append(' ', miss);
  }

  const path = document.createElement('div');
  path.className = 'proj-path';
  path.textContent = p.path;
  path.title = p.path;

  main.append(name, path);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'proj-del';
  del.title = `Delete ${p.name}`;
  del.setAttribute('aria-label', `Delete ${p.name}`);
  del.innerHTML = TRASH_SVG;

  row.append(main, del);
  item.append(row);
  return item;
}

function renderProjectsList() {
  const host = el.projectsList;
  if (!host) return;
  host.innerHTML = '';
  updateProjectsCount();
  if (!state.projects.length) {
    host.appendChild(histEmpty('No projects yet — click “Add project” to register one.'));
    return;
  }
  const card = document.createElement('section');
  card.className = 'card saved-card';

  const head = document.createElement('div');
  head.className = 'saved-head';
  const b = document.createElement('b');
  b.textContent = 'Projects';
  const cnt = document.createElement('span');
  cnt.className = 'cnt';
  cnt.textContent = String(state.projects.length);
  head.append(b, cnt);

  const list = document.createElement('div');
  list.className = 'saved-list';   // real, styled class (style.css:671)
  for (const p of state.projects) list.appendChild(buildProjectRow(p));

  card.append(head, list);
  host.appendChild(card);
}

// ---- Reusable confirmation modal -> Promise<boolean> ------------------------
// With opts.checkbox: { label } it resolves { ok, checked } instead.
// opts.danger tints the OK button red for a destructive action (opt-in, so no
// existing caller changes). `done` always removes it again — the modal is shared,
// and the tint must never leak into the next, harmless confirmation.
function confirmModal({ title = 'Confirm', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', checkbox = null, danger = false } = {}) {
  return new Promise((resolve) => {
    el.confirmTitle.textContent = title;
    el.confirmMessage.textContent = message;
    el.confirmOk.textContent = confirmLabel;
    el.confirmCancel.textContent = cancelLabel;
    el.confirmOk.classList.toggle('danger', !!danger);
    // opt-in checkbox: shown only when requested, always reset to unchecked
    el.confirmCheckboxWrap.classList.toggle('hidden', !checkbox);
    el.confirmCheckbox.checked = false;
    el.confirmCheckboxLabel.textContent = checkbox ? checkbox.label : '';
    el.confirmModal.classList.remove('hidden');
    el.confirmOk.focus();

    const done = (val) => {
      const checked = el.confirmCheckbox.checked;
      el.confirmOk.classList.remove('danger');   // never leak the tint to the next caller
      el.confirmModal.classList.add('hidden');
      el.confirmCheckboxWrap.classList.add('hidden');
      el.confirmOk.removeEventListener('click', onOk);
      el.confirmCancel.removeEventListener('click', onCancel);
      el.confirmModal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(checkbox ? { ok: val, checked } : val);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onBackdrop = (e) => { if (e.target === el.confirmModal) done(false); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };

    el.confirmOk.addEventListener('click', onOk);
    el.confirmCancel.addEventListener('click', onCancel);
    el.confirmModal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}

async function deleteProject(p) {
  const ok = await confirmModal({
    title: 'Remove project',
    message: `Remove “${p.name}” from the list?\nThe folder on disk and its run history are left untouched.`,
    confirmLabel: 'Remove project',
  });
  if (!ok) return;
  setProjectsMsg('');
  try {
    const res = await fetch(`/api/projects?name=${encodeURIComponent(p.name)}`, { method: 'DELETE' });
    const data = await safeJson(res);
    if (!res.ok) { setProjectsMsg(data.error || `HTTP ${res.status}`, 'err'); return; }
    state.projects = Array.isArray(data.projects) ? data.projects : [];
    if (localStorage.getItem(LAST_PROJECT_KEY) === p.name) localStorage.removeItem(LAST_PROJECT_KEY);
    renderProjectsList();
    renderProjectOptions(localStorage.getItem(LAST_PROJECT_KEY) || ''); // keep New-pipeline dropdown in sync
  } catch (e) {
    setProjectsMsg(e.message, 'err');
  }
}

// ---- Add project (native picker first, manual fallback in the modal) --------
// NOTE: kind may be 'err' (maps to the existing .hint.err rule) or omitted.
// There is no .hint.warn rule, so informational hints pass NO kind (default
// neutral .hint styling) — do not pass 'warn'.
function setProjAddMsg(text, kind) {
  if (!el.projAddMsg) return;
  el.projAddMsg.textContent = text || '';
  el.projAddMsg.className = 'hint' + (kind ? ' ' + kind : '');
}

function openProjectAddModal(path) {
  el.projAddPath.value = path || '';
  el.projAddName.value = path ? basenameOf(path) : '';
  // Informational hint only when there is no path (manual-entry fallback);
  // neutral default .hint styling (no .hint.warn class exists).
  setProjAddMsg(path ? '' : 'Native folder picker unavailable — enter the project folder path manually.');
  el.projectAddModal.classList.remove('hidden');
  el.projAddName.focus();
  el.projAddName.select();
}

function closeProjectAddModal() {
  el.projectAddModal.classList.add('hidden');
}

async function addProjectFlow() {
  setProjectsMsg('');
  const data = await pickFolder();
  if (data && data.status === 'picked' && data.path) { openProjectAddModal(data.path); return; }
  if (data && data.status === 'canceled') return;                 // respect the cancel
  if (data && data.status === 'busy') { setProjectsMsg('A folder dialog is already open — finish or cancel it first.', 'err'); return; }
  openProjectAddModal('');                                        // unsupported / error -> manual entry
}

async function saveProjectAdd() {
  const name = el.projAddName.value.trim();
  const path = el.projAddPath.value.trim();
  if (!name) return setProjAddMsg('Name is required.', 'err');
  if (!path) return setProjAddMsg('Folder is required.', 'err');
  el.projAddSave.disabled = true;
  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path }),
    });
    const data = await safeJson(res);
    if (!res.ok) { setProjAddMsg(data.error || `HTTP ${res.status}`, 'err'); return; }
    state.projects = Array.isArray(data.projects) ? data.projects : state.projects;
    closeProjectAddModal();
    renderProjectsList();
    renderProjectOptions(localStorage.getItem(LAST_PROJECT_KEY) || ''); // keep New-pipeline dropdown in sync
  } catch (e) {
    setProjAddMsg(e.message, 'err');
  } finally {
    el.projAddSave.disabled = false;
  }
}

// ---- Event wiring (guarded so non-UI test imports don't throw) --------------
if (el.projectsList) {
  el.projectsList.addEventListener('click', (e) => {
    const del = e.target.closest && e.target.closest('.proj-del');
    if (!del) return;
    const item = del.closest('.pl-item');
    if (!item) return;
    const p = state.projects.find((x) => x.name === item.dataset.name);
    if (p) deleteProject(p);
  });
}
if (el.projectAddBtn) el.projectAddBtn.addEventListener('click', addProjectFlow);
if (el.projAddSave) {
  el.projAddSave.addEventListener('click', saveProjectAdd);
  el.projAddCancel.addEventListener('click', closeProjectAddModal);
  el.projAddBrowse.addEventListener('click', async () => {
    el.projAddBrowse.disabled = true;
    try {
      const data = await pickFolder();
      if (data && data.status === 'picked' && data.path) {
        el.projAddPath.value = data.path;
        if (!el.projAddName.value.trim()) el.projAddName.value = basenameOf(data.path);
        setProjAddMsg('');
      } else if (data && data.status === 'busy') {
        setProjAddMsg('A folder dialog is already open — finish or cancel it first.', 'err');
      }
      // canceled / unsupported: leave the manual fields as-is
    } finally {
      el.projAddBrowse.disabled = false;
    }
  });
  el.projectAddModal.addEventListener('click', (e) => { if (e.target === el.projectAddModal) closeProjectAddModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.projectAddModal && !el.projectAddModal.classList.contains('hidden')) closeProjectAddModal();
  });
}

// Test hook (mirrors window.__agents at app.js:4219).
if (typeof window !== 'undefined') {
  window.__projects = {
    loadProjectsView, renderProjectsList, buildProjectRow, deleteProject,
    confirmModal, addProjectFlow, openProjectAddModal, saveProjectAdd, updateProjectsCount,
  };
}

// ---- Agent creation wizard ---------------------------------------------------

function resetAgentWizard() {
  state.agentWizard = { step: 1, genId: '', abort: null, draft: null, ownMd: false };
}

async function enterAgentWizard() {
  if (!state.agentWizard.genId && !state.agentWizard.abort) resetAgentWizard();
  if (!state.agentsList.length) await loadAgentsList();
  const keys = state.agentsList.filter((a) => a.scope !== 'workspace-only').map((a) => a.key);
  buildChipChecks(el.agwBefore, keys, []);
  buildChipChecks(el.agwAfter, keys, []);
  showAgentWizardStep(state.agentWizard.step || 1);
  syncAgwStartEnabled();
}

function showAgentWizardStep(step) {
  state.agentWizard.step = step;
  for (let i = 1; i <= 3; i++) {
    const pane = document.getElementById(`agw-step-${i}`);
    if (pane) pane.classList.toggle('hidden', i !== step);
  }
}

function syncAgwStartEnabled() {
  const name = el.agwName ? el.agwName.value.trim() : '';
  const purpose = el.agwPurpose ? el.agwPurpose.value.trim() : '';
  const own = state.agentWizard.ownMd;
  const md = el.agwOwnMd ? el.agwOwnMd.value.trim() : '';
  if (el.agwStart) el.agwStart.disabled = !(name && (own ? md : purpose));
}

async function startAgentGenerate() {
  state.agentWizard.genId = ''; // gate stale events before the POST resolves
  if (el.agwStatus) el.agwStatus.textContent = 'Starting…';
  if (el.agwMsg) el.agwMsg.textContent = '';
  showAgentWizardStep(2);
  const abort = new AbortController();
  state.agentWizard.abort = abort;
  const body = {
    name: el.agwName.value.trim(),
    purpose: el.agwPurpose.value.trim(),
    details: el.agwDetails.value,
    expectedBefore: chipValues(el.agwBefore),
    expectedAfter: chipValues(el.agwAfter),
  };
  if (state.agentWizard.ownMd && el.agwOwnMd.value.trim()) body.userMarkdown = el.agwOwnMd.value;
  try {
    const res = await fetch('/api/agents/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: abort.signal,
    });
    const data = await safeJson(res);
    if (!res.ok || !data.genId) {
      state.agentWizard.abort = null;
      showAgentWizardStep(1);
      if (el.agwStep1Hint) el.agwStep1Hint.textContent = `Generation error: ${data.error || res.status}`;
      return;
    }
    state.agentWizard.genId = data.genId;
    const ws = state.ws;
    if (ws && state.wsReady) { try { ws.send(JSON.stringify({ type: 'subscribe', genId: data.genId })); } catch { /* ignore */ } }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    state.agentWizard.abort = null;
    showAgentWizardStep(1);
    if (el.agwStep1Hint) el.agwStep1Hint.textContent = `Generation error: ${err.message}`;
  }
}

function onAgentGenEvent(msg) {
  if (!msg || !msg.genId || msg.genId !== state.agentWizard.genId) return; // stale/aborted gen
  if (msg.type === 'agentgen-progress') {
    if (el.agwStatus) el.agwStatus.textContent = msg.message || '';
    return;
  }
  if (msg.type === 'agentgen-done') {
    state.agentWizard.abort = null;
    state.agentWizard.draft = msg.draft || null;
    const root = document.getElementById('agw-step-3');
    if (root && msg.draft) agentFormFill(root, msg.draft.meta || {}, msg.draft.markdown || '');
    const anyCb = root && root.querySelector('.agent-f-connect-any');
    if (anyCb) anyCb.onchange = () => { root.querySelector('.agent-f-connects').hidden = anyCb.checked; };
    showAgentWizardStep(3);
    return;
  }
  if (msg.type === 'agentgen-error') {
    state.agentWizard.abort = null;
    state.agentWizard.genId = '';
    showAgentWizardStep(1);
    if (el.agwStep1Hint) el.agwStep1Hint.textContent = `Generation error: ${msg.message || 'failed'}`;
  }
}

async function saveGeneratedAgent() {
  const root = document.getElementById('agw-step-3');
  const { meta, markdown } = agentFormRead(root);
  if (el.agwMsg) { el.agwMsg.textContent = ''; el.agwMsg.className = 'form-msg'; }
  if (el.agwSave) el.agwSave.disabled = true;
  try {
    const res = await fetch('/api/agents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta, markdown }),
    });
    const data = await safeJson(res);
    if (!res.ok) { // 400/409 keep the user on Step 3 with the error verbatim
      if (el.agwMsg) { el.agwMsg.textContent = data.error || `HTTP ${res.status}`; el.agwMsg.className = 'form-msg err'; }
      return;
    }
    invalidateAgentCaches();
    resetAgentWizard();
    setAgentsMsg(`Agent "${data.meta.key}" created.`, 'ok');
    location.hash = 'agents';
  } catch (err) {
    if (el.agwMsg) { el.agwMsg.textContent = err.message; el.agwMsg.className = 'form-msg err'; }
  } finally {
    if (el.agwSave) el.agwSave.disabled = false;
  }
}

function abortAgentGen() {
  const genId = state.agentWizard.genId;
  if (state.agentWizard.abort) { try { state.agentWizard.abort.abort(); } catch { /* ignore */ } }
  if (genId) {
    fetch('/api/agents/generate/stop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ genId }),
    }).catch(() => {});
    const ws = state.ws;
    if (ws && state.wsReady) { try { ws.send(JSON.stringify({ type: 'unsubscribe', genId })); } catch { /* ignore */ } }
  }
  state.agentWizard.abort = null;
  state.agentWizard.genId = '';
}

if (el.agwStart) el.agwStart.addEventListener('click', () => startAgentGenerate());
if (el.agwAbort) el.agwAbort.addEventListener('click', () => { abortAgentGen(); showAgentWizardStep(1); });
if (el.agwRegen) el.agwRegen.addEventListener('click', () => startAgentGenerate());
if (el.agwSave) el.agwSave.addEventListener('click', () => saveGeneratedAgent());
if (el.agwClose) el.agwClose.addEventListener('click', () => { location.hash = 'agents'; });
for (const input of [el.agwName, el.agwPurpose, el.agwOwnMd]) {
  if (input) input.addEventListener('input', syncAgwStartEnabled);
}
if (el.agwOwnToggle) el.agwOwnToggle.addEventListener('click', () => {
  state.agentWizard.ownMd = !state.agentWizard.ownMd;
  el.agwOwnToggle.classList.toggle('on', state.agentWizard.ownMd);
  el.agwOwnToggle.setAttribute('aria-checked', String(state.agentWizard.ownMd));
  if (el.agwOwnPane) el.agwOwnPane.classList.toggle('hidden', !state.agentWizard.ownMd);
  syncAgwStartEnabled();
});
// role=switch needs Space/Enter (mirrors the mock + autoscroll switches).
if (el.agwOwnToggle) el.agwOwnToggle.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  e.preventDefault();
  el.agwOwnToggle.click();
});

if (typeof window !== 'undefined') {
  window.__agw = { enterAgentWizard, showAgentWizardStep, startAgentGenerate, onAgentGenEvent, saveGeneratedAgent, abortAgentGen, resetAgentWizard };
}

// ---------------------------------------------------------------------------
// Start a run
// ---------------------------------------------------------------------------
el.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  // Enter in any field submits the form directly, bypassing the disabled Start
  // button — so the in-flight window has to be closed here too, not only via
  // start.disabled, or a second Enter starts the same run twice.
  if (startSubmitInFlight) return;
  setFormMsg('', '');

  // Target branch (§5.4 mutual exclusivity): workspace mode sends {workspaceId}
  // and NO projectDir; project mode sends {projectDir} and NO workspaceId.
  const target = state.runTarget === 'workspace' ? 'workspace' : 'project';
  let projectDir = '';
  let workspaceId = '';
  let workspaceName = '';
  let workspaceProjectNames = null;
  if (target === 'workspace') {
    workspaceId = (el.workspaceSelect && el.workspaceSelect.value) || '';
    if (!workspaceId) return setFormMsg('Select a workspace first (or create one).', 'err');
    const ws = state.workspaces.find((w) => w && w.id === workspaceId);
    workspaceName = (ws && ws.name) || '';
    workspaceProjectNames = ws && Array.isArray(ws.projectPaths)
      ? ws.projectPaths.map(projectName) : null;
  } else {
    projectDir = selectedProjectPath();
    if (!projectDir) return setFormMsg('Select a project first (or add one).', 'err');
  }

  const source = (el.sourceRadios.find((r) => r.checked) || {}).value || 'prompt';
  const promptText = el.prompt.value.trim();
  const mdText = el.promptMarkdown.value.trim();
  const title = el.title.value.trim();

  const body = {
    title: title || undefined,
    workflowId: state.workflowId || 'wf_default',
    // Omit-when-default: 'permissive' IS the server default, so the key is
    // absent on default runs — byte-identical legacy request bodies. (The
    // server normalizes omitted/''/null to 'permissive'; always-sending would
    // be equivalent but would change every legacy-shaped request for no gain.)
    guardrailsId: state.guardrailsId !== 'permissive' ? state.guardrailsId : undefined,
    mock: el.mock.checked,
    sourceBranch: (el.sourceBranch && el.sourceBranch.value) || undefined,
    featureBranch: (el.featureBranch && el.featureBranch.value.trim()) || undefined,
  };
  if (target === 'workspace') {
    body.workspaceId = workspaceId;
    // Per-project source branches: { [projectKey]: branch }. Omit empties (the
    // "auto" placeholder) so the server falls back to each project's default.
    const byKey = {};
    if (el.wsSourceBranches) {
      el.wsSourceBranches.querySelectorAll('select.ws-src-select').forEach((s) => {
        const key = s.dataset.projectKey;
        const val = (s.value || '').trim();
        if (key && val) byKey[key] = val;
      });
    }
    if (Object.keys(byKey).length) body.sourceBranchByKey = byKey;
    // The single #sourceBranch is hidden in workspace mode — don't send it. (The
    // body literal sets `sourceBranch: ... || undefined`, so the key still EXISTS
    // with value undefined; delete it so `'sourceBranch' in body` is false.)
    delete body.sourceBranch;
  } else {
    body.projectDir = projectDir;
  }

  const psrc = state.activePluginSource;
  if (psrc) {
    const picked = collectSourcePane(el.pluginSourcePane);
    if (picked.error) return setFormMsg(picked.error, 'err');
    body.source = { type: 'plugin', plugin: psrc.plugin, sourceId: psrc.sourceId, taskId: picked.taskId, inputs: picked.inputs };
  } else if (source === 'markdown') {
    if (!mdText) return setFormMsg('Provide markdown text or load a .md file.', 'err');
    body.promptMarkdown = mdText;
  } else {
    if (!promptText) return setFormMsg('Provide a prompt describing the task.', 'err');
    body.prompt = promptText;
  }

  // Guard the whole in-flight window: applyBudgetToNewView also drives
  // start.disabled, and this run's own creation event repaints it.
  startSubmitInFlight = true;
  el.startBtn.disabled = true;
  setFormMsg('Starting run...', '');

  // Upload the selected extra files' bytes; the server writes them to a temp
  // dir and the orchestrator copies them into the pipeline's extras/ folder.
  let extras = [];
  try {
    extras = await collectExtras();
  } catch {
    extras = [];
  }
  if (extras.length) body.extras = extras;

  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await safeJson(res);
    if (!res.ok || !data.runId) {
      startSubmitInFlight = false;
      el.startBtn.disabled = false;
      return setFormMsg(`Failed to start: ${data.error || res.status}`, 'err');
    }

    // begin tracking the new run (creates a local model + switches to Running)
    beginRun(data.runId, projectDir, title,
      target === 'workspace' ? { workspaceId, workspaceName, projectNames: workspaceProjectNames } : {});
    // Re-enable the form so more runs can be started concurrently — unless the
    // budget just went over, in which case the gate keeps Start disabled.
    startSubmitInFlight = false;
    el.startBtn.disabled = !!budgetState.budget?.blocked;
    setFormMsg('Run started.', 'ok');
    if (extras.length) {
      appendLog({
        source: 'ui',
        level: 'system',
        text: `uploaded ${extras.length} extra file(s): ${extras.map((e) => e.name).join(', ')}`,
        ts: Date.now(),
      });
    }
  } catch (err) {
    startSubmitInFlight = false;
    el.startBtn.disabled = false;
    setFormMsg(`Error: ${err.message}`, 'err');
  }
});

// Create the local run model for a run THIS tab just started and switch to the
// Running view. We do NOT send a subscribe here: live events arrive via the
// server's broadcast, and a subscribe would double-replay this run's buffer on
// the next hello.
// [v2/C2] beginRun is POSITIONAL. opts is an optional 4th arg carrying workspace
// attribution ({workspaceId, workspaceName}); in workspace mode the card label
// prefers the workspace name. Project mode passes {} and is byte-identical.
function beginRun(runId, projectDir, title, opts = {}) {
  const label = title || opts.workspaceName || '(untitled)';
  const r = upsertRun({
    runId,
    title: label,
    projectDir: projectDir || '',
    status: 'starting',
    local: true,
    kind: opts.workspaceId ? 'workspace-run' : 'run',
    workspaceId: opts.workspaceId || undefined,
    workspaceName: opts.workspaceName || undefined,
    projectNames: Array.isArray(opts.projectNames) && opts.projectNames.length ? opts.projectNames : undefined,
  });
  hideViewer();
  updateNavCounts();
  showView('running');
  renderRunningView();
}

function setFormMsg(text, kind) {
  el.formMsg.textContent = text;
  el.formMsg.className = 'form-msg' + (kind ? ' ' + kind : '');
}

// ---------------------------------------------------------------------------
// Settings view: the machine-wide Worca CC root folder + the projects root
// (§5.1) whose CLAUDE.md / .claude/skills / .mcp.json every pipeline agent sees.
// ---------------------------------------------------------------------------
function setSettingsMsg(text, kind) {
  if (!el.settingsMsg) return;
  el.settingsMsg.textContent = text || '';
  el.settingsMsg.className = 'hint' + (kind ? ' ' + kind : '');
}

// One contract for both fields: value = the RAW setting (blank when unset),
// placeholder = what applies while it IS blank. `projectsRootDefault` is that
// fallback for the projects root — the WORCA_PROJECTS_ROOT override when it is
// exported, else the home folder — so a blank field really means "use the
// default", and Save round-trips a blank as a blank instead of persisting a path
// the user never typed.
function paintSettings(data) {
  el.settingsRoot.value = data.root || '';
  el.settingsRoot.placeholder = data.default || '';
  if (el.settingsProjectsRoot) {
    el.settingsProjectsRoot.value = data.projectsRoot || '';
    el.settingsProjectsRoot.placeholder = projectsRootFallback(data);
  }
}

// `default` is the pre-projectsRoot payload's only default; keep it as the
// fallback so an older/partial response still fills the placeholder.
const projectsRootFallback = (data) => data.projectsRootDefault || data.default || '';

async function loadSettings() {
  if (!el.settingsRoot) return;
  try {
    const res = await fetch('/api/settings');
    const data = await safeJson(res);
    if (!res.ok) { setSettingsMsg(data.error || `HTTP ${res.status}`, 'err'); return; }
    paintSettings(data);
    paintBudgetSettings(data);
    paintBudgetReadout();
    refreshBudget();
    paintChatSettings(data.chat);
    setSettingsMsg('');
  } catch (e) { setSettingsMsg(e.message, 'err'); }
}

// ── Chat notifications card (chat-connectivity-design.md §4.8) ────────────────

function setChatSettingsMsg(text, cls) {
  if (!el.chatSettingsMsg) return;
  el.chatSettingsMsg.textContent = text || '';
  el.chatSettingsMsg.className = `hint${cls ? ` ${cls}` : ''}`;
}

async function paintChatSettings(prefs) {
  if (!el.chatSettingsHost) return;
  let channels = [];
  try {
    const cs = await safeJson(await fetch('/api/chat/status'));
    channels = cs.channels || [];
  } catch { /* render prefs-only */ }
  el.chatSettingsHost.replaceChildren(renderChatSettings({ prefs, channels }));
}

if (el.chatSettingsSave) el.chatSettingsSave.addEventListener('click', async () => {
  el.chatSettingsSave.disabled = true;
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: collectChatSettings(el.chatSettingsHost) }),
    });
    const data = await safeJson(res);
    if (!res.ok) return setChatSettingsMsg(data.error || `HTTP ${res.status}`, 'err');
    setChatSettingsMsg('Saved.');
  } catch (e) { setChatSettingsMsg(e.message, 'err');
  } finally { el.chatSettingsSave.disabled = false; }
});

// Delegated Test buttons: explicit user action -> POST /api/chat/test.
if (el.chatSettingsHost) el.chatSettingsHost.addEventListener('click', async (e) => {
  const t = e.target;
  if (!t || !t.classList || !t.classList.contains('chat-test')) return;
  t.disabled = true;
  setChatSettingsMsg('Sending test message…');
  try {
    const res = await fetch('/api/chat/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plugin: t.dataset.plugin, channelId: t.dataset.channelId }),
    });
    const data = await safeJson(res);
    if (!res.ok) return setChatSettingsMsg(data.error || `HTTP ${res.status}`, 'err');
    const failed = (data.results || []).filter((r) => !r.ok);
    setChatSettingsMsg(failed.length
      ? `Delivery failed for ${failed.map((f) => f.chatId).join(', ')}: ${failed[0].error?.message || failed[0].error?.kind}`
      : 'Test message delivered.', failed.length ? 'err' : '');
  } catch (err) { setChatSettingsMsg(err.message, 'err');
  } finally { t.disabled = false; }
});

// Live channel-status events patch every visible badge in place (plugins view
// cards + the settings card) without a refetch.
function onChannelStatus(msg) {
  const key = `${msg.plugin}/${msg.channelId}`;
  for (const b of document.querySelectorAll(`.pl-channel[data-channel-key="${CSS.escape(key)}"]`)) {
    b.replaceWith(channelBadge(document, { ...msg, displayName: b.textContent.split(' · ')[0] }));
  }
  for (const b of document.querySelectorAll(`.chat-state[data-channel-key="${CSS.escape(key)}"]`)) {
    const stateCls = { connected: 'green', degraded: 'waiting', connecting: 'waiting', unconfigured: 'waiting' }[msg.state] || 'red';
    b.className = `badge ${stateCls} chat-state`;
    b.textContent = msg.state;
    if (msg.detail) b.title = msg.detail;
  }
}

// POSTs both keys; the route writes only the keys present in the body, and an
// explicitly empty one resets that key to its default (ui/server.mjs:1656).
async function saveSettings(root, projectsRoot) {
  if (!el.settingsSave) return;
  el.settingsSave.disabled = true;
  if (el.settingsReset) el.settingsReset.disabled = true;
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, projectsRoot }),
    });
    const data = await safeJson(res);
    if (!res.ok) { setSettingsMsg(data.error || `HTTP ${res.status}`, 'err'); return; }
    paintSettings(data);
    setSettingsMsg('Saved. New runs use these folders.');
    // The root relocates the project registry + workflows; reload projects so
    // the UI reflects what's available under the new root.
    loadProjects();
  } catch (e) { setSettingsMsg(e.message, 'err'); }
  finally {
    el.settingsSave.disabled = false;
    if (el.settingsReset) el.settingsReset.disabled = false;
  }
}

const settingsFieldValue = (node) => (node && node.value ? node.value.trim() : '');

if (el.settingsSave) {
  el.settingsSave.addEventListener('click', () => saveSettings(
    settingsFieldValue(el.settingsRoot), settingsFieldValue(el.settingsProjectsRoot),
  ));
}
if (el.settingsReset) el.settingsReset.addEventListener('click', () => saveSettings('', ''));

// ---------------------------------------------------------------------------
// ⓘ info tooltips (settings). Content lives in each icon's hidden .tip-content
// span; ONE shared fixed-position bubble is created lazily and repositioned per
// icon — same layering as the stats chart tip (z-index 70). Delegated so icons
// added by future markup need no extra wiring. pointer-events:none on the
// bubble keeps mouseout from flickering when the tip overlaps the icon.
// aria-describedby ties the active icon to the bubble's stable #info-bubble id
// so its text — otherwise display:none and shadowed by the icon's own
// aria-label — reaches screen readers; infoTipIcon tracks which icon currently
// holds that attribute so hideInfoTip can clear it with no event target to read
// (e.g. when the router hides the tip on view switch).
let infoBubble = null;
let infoTipIcon = null;
function showInfoTip(icon) {
  const content = icon.querySelector('.tip-content');
  if (!content) return;
  if (!infoBubble) {
    infoBubble = document.createElement('div');
    infoBubble.className = 'info-bubble';
    infoBubble.id = 'info-bubble';
    infoBubble.setAttribute('role', 'tooltip');
    document.body.appendChild(infoBubble);
  }
  infoBubble.innerHTML = content.innerHTML;
  infoBubble.classList.remove('hidden');
  if (infoTipIcon && infoTipIcon !== icon) infoTipIcon.removeAttribute('aria-describedby');
  infoTipIcon = icon;
  icon.setAttribute('aria-describedby', 'info-bubble');
  // Below the icon, left-aligned; clamp into the viewport, flip above if the
  // bottom would overflow. (Zero-size rects under jsdom fall through safely.)
  // Reset any inline position left over from the previous icon first: a stale
  // `left` parked near the right edge shrinks the shrink-to-fit width the
  // getBoundingClientRect() below measures, squeezing the clamp math for
  // whichever icon shows next on a narrower window.
  infoBubble.style.left = '0px';
  infoBubble.style.top = '0px';
  const r = icon.getBoundingClientRect();
  const b = infoBubble.getBoundingClientRect();
  let left = r.left;
  let top = r.bottom + 8;
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  if (left + b.width > vw - 12) left = Math.max(12, vw - b.width - 12);
  if (top + b.height > vh - 12 && r.top - b.height - 8 > 0) top = r.top - b.height - 8;
  infoBubble.style.left = `${left}px`;
  infoBubble.style.top = `${top}px`;
}
const hideInfoTip = () => {
  if (infoBubble) infoBubble.classList.add('hidden');
  if (infoTipIcon) { infoTipIcon.removeAttribute('aria-describedby'); infoTipIcon = null; }
};

// Palette cards share the settings bubble. Hover uses a ~250ms intent delay so
// dragging across the palette doesn't strobe tooltips; keyboard focus is instant.
// relatedTarget guards: mouseover/mouseout bubble through child elements (.phead,
// .pdesc), so a cursor move BETWEEN children of the same trigger must be a no-op
// — without the guard the bubble hides and re-arms on every crossing (strobe).
// contains(null/undefined) is false, so events with no relatedTarget still work.
const TIP_SELECTOR = '.info-tip, #composer-palette .agent-pill';
let pillTipTimer = null;
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest?.(TIP_SELECTOR);
  if (!t) return;
  if (t.contains(e.relatedTarget)) return; // moved between children of the same trigger
  if (t.classList.contains('agent-pill')) {
    clearTimeout(pillTipTimer);
    pillTipTimer = setTimeout(() => showInfoTip(t), 250);
  } else {
    clearTimeout(pillTipTimer);
    showInfoTip(t);
  }
});
document.addEventListener('mouseout', (e) => {
  const t = e.target.closest?.(TIP_SELECTOR);
  if (!t) return;
  if (t.contains(e.relatedTarget)) return; // still inside the same trigger
  clearTimeout(pillTipTimer);
  hideInfoTip();
});
document.addEventListener('focusin', (e) => {
  const t = e.target.closest?.(TIP_SELECTOR);
  if (t) { clearTimeout(pillTipTimer); showInfoTip(t); }
});
document.addEventListener('focusout', (e) => {
  if (e.target.closest?.(TIP_SELECTOR)) { clearTimeout(pillTipTimer); hideInfoTip(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { clearTimeout(pillTipTimer); hideInfoTip(); } });

// ---------------------------------------------------------------------------
// Settings: budget & cost limits card. Reads the three limit keys off the same
// /api/settings payload the root card uses, and renders the live spend readout
// from the /api/budget snapshot paintBudget() already keeps fresh.
// ---------------------------------------------------------------------------
function setBudgetMsg(text, kind) {
  el.budgetMsg.textContent = text || '';
  el.budgetMsg.className = 'hint' + (kind ? ` ${kind}` : '');
}

function paintBudgetSettings(data) {
  el.budgetPerPipeline.value = data.pipelineCostLimitUsd ?? '';
  el.budgetTotal.value = data.totalCostLimitUsd ?? '';
  el.budgetResetPeriod.value = data.costLimitResetPeriod || 'monthly';
}

function paintBudgetReadout() {
  const b = budgetState.budget;
  if (!b || !el.budgetReadout) return;
  el.budgetReadout.replaceChildren(renderBudgetReadout(b,
    { fmt: { usd: fmtUsd, usd4: fmtUsd4, duration: fmtDuration, estTitle } }));
}

// '' -> null (no limit). NaN is the validation-failure marker: anything that is
// not a finite number of at least one cent.
function readBudgetField(input) {
  const v = input.value.trim();
  if (v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0.01) return NaN;
  return n;
}

async function saveBudgetSettings(payload) {
  el.budgetSave.disabled = true;
  el.budgetReset.disabled = true;
  setBudgetMsg('Saving…');
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await safeJson(res);
    if (!res.ok) { setBudgetMsg(data.error || `HTTP ${res.status}`, 'err'); return; }
    paintBudgetSettings(data);
    setBudgetMsg('Saved.');
    refreshBudget();                        // sidebar + readout repaint immediately
  } catch (e) { setBudgetMsg(e.message, 'err'); }
  finally {
    el.budgetSave.disabled = false;
    el.budgetReset.disabled = false;
  }
}

if (el.budgetSave) {
  el.budgetSave.addEventListener('click', () => {
    const per = readBudgetField(el.budgetPerPipeline);
    const total = readBudgetField(el.budgetTotal);
    if (Number.isNaN(per) || Number.isNaN(total)) {
      setBudgetMsg('Limits must be at least $0.01, or blank for no limit.', 'err');
      return;
    }
    saveBudgetSettings({
      pipelineCostLimitUsd: per, totalCostLimitUsd: total,
      costLimitResetPeriod: el.budgetResetPeriod.value,
    });
  });
}
// Clears both limits and leaves the reset period alone: POSTing `null` deletes
// the key server-side (the REST arm passes `body.x ?? ''` to the setter).
if (el.budgetReset) {
  el.budgetReset.addEventListener('click', () => {
    el.budgetPerPipeline.value = '';
    el.budgetTotal.value = '';
    saveBudgetSettings({ pipelineCostLimitUsd: null, totalCostLimitUsd: null });
  });
}

// Browse… for the projects root: native OS dialog, in-app modal fallback —
// the same two endpoints the add-project Browse button uses (app.js:3793).
if (el.settingsProjectsRootBrowse) {
  el.settingsProjectsRootBrowse.addEventListener('click', async () => {
    el.settingsProjectsRootBrowse.disabled = true;
    setSettingsMsg('');
    try {
      const data = await pickFolder();
      if (data && data.status === 'picked' && data.path) el.settingsProjectsRoot.value = data.path;
      else if (data && data.status === 'canceled') { /* user dismissed the dialog */ }
      else if (data && data.status === 'busy') setSettingsMsg('A folder dialog is already open — finish or cancel it first.', 'err');
      else await openFolderBrowser(settingsFieldValue(el.settingsProjectsRoot), (p) => { el.settingsProjectsRoot.value = p; });
    } finally {
      el.settingsProjectsRootBrowse.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Plugins view. Pure rendering lives in plugins-view.mjs; this block owns the
// endpoint calls, the modal shell, and ONE delegated click handler on the list.
// ---------------------------------------------------------------------------
function setPluginsMsg(text, kind) {
  if (!el.pluginsMsg) return;
  el.pluginsMsg.textContent = text || '';
  el.pluginsMsg.className = 'form-msg' + (kind ? ' ' + kind : '');
}

// Tiny modal shell around #plugin-modal: swap in a body element + action buttons.
function pluginModal(title, bodyEl, actions = []) {
  el.pluginModalTitle.textContent = title;
  el.pluginModalBody.replaceChildren(bodyEl);
  el.pluginModalActions.replaceChildren(...actions.map(([label, cls, fn]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }));
  el.pluginModal.classList.remove('hidden');
}
function closePluginModal() { el.pluginModal.classList.add('hidden'); }

// JSON fetch helper: { ok, status, data } — body omitted when undefined.
async function pluginApi(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await safeJson(res) };
}

// Snapshot of the last GET /api/marketplaces payload — the delegated install
// listener resolves the consent inventory from here (no re-fetch, no network).
let pluginsViewMarketplaces = [];

function renderMarketplaceSections(list, { fromBackground = false } = {}) {
  if (fromBackground && el.pluginModal && !el.pluginModal.classList.contains('hidden')) {
    pluginsViewMarketplaces = list || []; // keep the data; skip the DOM swap under an open modal
    return;
  }
  pluginsViewMarketplaces = list || [];
  el.pluginsAvailable.replaceChildren(renderAvailableList(pluginsViewMarketplaces));
  el.marketplacesList.replaceChildren(renderMarketplaceList(pluginsViewMarketplaces));
}

async function loadPluginsView({ refresh = false } = {}) {
  setPluginsMsg('');
  try {
    const [pRes, mRes] = await Promise.all([fetch('/api/plugins'), fetch('/api/marketplaces')]);
    const data = await safeJson(pRes);
    if (!pRes.ok) { renderMarketplaceSections([]); return setPluginsMsg(data.error || `HTTP ${pRes.status}`, 'err'); }
    let channelStatus = [];
    try {
      const cs = await safeJson(await fetch('/api/chat/status'));
      channelStatus = cs.channels || [];
    } catch { /* chat host unavailable: cards render without badges */ }
    const parts = [renderPluginList(data.plugins || [], { channelStatus })];
    if (Array.isArray(data.orphans) && data.orphans.length) parts.push(renderOrphanList(data.orphans));
    el.pluginsList.replaceChildren(...parts);
    const mData = await safeJson(mRes);
    renderMarketplaceSections(mRes.ok ? mData.marketplaces || [] : []);
  } catch (e) { setPluginsMsg(e.message, 'err'); }
  if (refresh) refreshMarketplacesInBackground(); // C3: only the view-open path kicks the background refresh
}

// Stale-while-revalidate (spec §4.6): render cached snapshots instantly, then
// one background refresh-all; re-render on completion. Failures keep the stale
// snapshot (per-marketplace warnings arrive in the payload).
let marketplaceRefreshInFlight = false;
async function refreshMarketplacesInBackground() {
  if (marketplaceRefreshInFlight) return;
  marketplaceRefreshInFlight = true;
  setPluginsMsg('Refreshing marketplaces…');
  try {
    const { ok, data } = await pluginApi('POST', '/api/marketplaces/refresh');
    if (ok) renderMarketplaceSections(data.marketplaces || [], { fromBackground: true });
  } catch { /* keep stale */ } finally {
    marketplaceRefreshInFlight = false;
    // Clear only OUR status line — an install/remove error posted while the
    // background refresh was in flight must survive it.
    if (el.pluginsMsg && el.pluginsMsg.textContent === 'Refreshing marketplaces…') setPluginsMsg('');
  }
}

async function addMarketplaceFromInput() {
  const url = (el.marketplaceUrl.value || '').trim();
  if (!url) return setPluginsMsg('Enter a marketplace repo (https://github.com/owner/repo, owner/repo, or a local path).', 'err');
  el.marketplaceAdd.disabled = true;
  setPluginsMsg('Adding marketplace…');
  let res;
  try {
    res = await pluginApi('POST', '/api/marketplaces', { url });
  } catch (e) {
    return setPluginsMsg(e.message || 'add failed', 'err'); // fetch-level failure must not strand the button
  } finally {
    el.marketplaceAdd.disabled = false;
  }
  const { ok, data } = res;
  if (!ok) return setPluginsMsg(data.error || 'add failed', 'err');
  el.marketplaceUrl.value = '';
  el.marketplaceAddRow.classList.add('hidden');
  setPluginsMsg(`Added ${data.marketplace.name} (${data.marketplace.plugins.length} plugins).`, 'ok');
  loadPluginsView();
}

function openInstallConsent(entry) {
  pluginModal(`Will install: ${entry.name}`, renderInstallConsent(entry, entry.inventory || {}), [
    ['Cancel', 'btn btn-ghost btn-mini', closePluginModal],
    ['Install', 'btn btn-primary btn-mini', async () => {
      closePluginModal();
      setPluginsMsg(`Installing ${entry.name}…`);
      const { ok, data } = await pluginApi('POST', '/api/plugins/install',
        { repoUrl: entry.repoUrl, subdir: entry.subdir, name: entry.name, sha: entry.sha,
          ...(entry.marketplace ? { marketplace: entry.marketplace } : {}) });
      if (!ok) {
        // A cached snapshot can point at a sha the remote no longer has (force-push,
        // rebase): git's raw complaint is unreadable, so map it to the real fix (C3).
        if (/not a valid object name|does not exist/.test(data.error || '')) {
          return setPluginsMsg('This plugin snapshot is stale — Refresh the marketplace and try again.', 'err');
        }
        return setPluginsMsg(data.error || 'install failed', 'err');
      }
      setPluginsMsg(`Installed ${entry.name}.`, 'ok');
      invalidateAgentCaches();                 // plugin agents join the registry
      loadPluginsView();
    }],
  ]);
}

async function openPluginSettings(name) {
  const { ok, data } = await pluginApi('GET', `/api/plugins/${encodeURIComponent(name)}/config`);
  if (!ok) return setPluginsMsg(data.error || 'config load failed', 'err');
  // Multi-source { sources:[{id,schema,values}] }, single-source { schema, values } tolerated.
  const sources = Array.isArray(data.sources) ? data.sources
    : [{ id: data.sourceId || '', schema: data.schema || [], values: data.values || {} }];
  const body = renderConfigForm({ sources, channels: data.channels || [] });
  // Model secrets (design §9.7): one extra form, marked with data-target so the
  // save loop routes it through the { target: 'modelSecrets' } write.
  if (data.models && Array.isArray(data.models.schema) && data.models.schema.length) {
    const head = document.createElement('h4');
    head.className = 'pl-config-h';
    head.textContent = 'Model secrets';
    body.appendChild(head);
    const msForm = renderConfigForm([{ id: '', schema: data.models.schema, values: data.models.values }])
      .querySelector('.pl-config-form');
    msForm.dataset.target = 'modelSecrets';
    body.appendChild(msForm);
  }
  pluginModal(`Settings: ${name}`, body, [
    ['Cancel', 'btn btn-ghost btn-mini', closePluginModal],
    ['Save', 'btn btn-primary btn-mini', async () => {
      // One PUT per source form, each with ITS OWN sourceId — merging every form
      // into a single sourceId-less PUT would 400 for multi-source plugins (the
      // server only infers sourceId when the plugin has exactly one source).
      let failed = null;
      for (const f of body.querySelectorAll('.pl-config-form')) {
        const collected = collectConfigForm(f); // { sourceId | channelId, values }
        const payload = f.dataset.target === 'modelSecrets'
          ? { target: 'modelSecrets', values: collected.values }
          : collected;
        const r = await pluginApi('PUT', `/api/plugins/${encodeURIComponent(name)}/config`, payload);
        if (!r.ok) { failed = r.data.error || 'save failed'; break; }
      }
      closePluginModal();
      setPluginsMsg(failed || 'Settings saved.', failed ? 'err' : 'ok');
    }],
  ]);
}

// One delegated listener: enable toggle + Settings/Doctor/Update/Remove + orphan Purge.
if (el.pluginsList) el.pluginsList.addEventListener('click', async (e) => {
  const t = e.target;
  const name = t && t.dataset ? t.dataset.name : '';
  if (!name) return;
  if (t.classList.contains('pl-toggle')) {
    const { ok, data } = await pluginApi('POST', `/api/plugins/${encodeURIComponent(name)}/enable`, { enabled: t.checked });
    if (!ok) { setPluginsMsg(data.error || 'toggle failed', 'err'); t.checked = !t.checked; return; }
    invalidateAgentCaches();                   // disabled plugin's agents leave the registry
    loadPluginsView();
  } else if (t.classList.contains('pl-settings')) {
    openPluginSettings(name);
  } else if (t.classList.contains('pl-doctor')) {
    setPluginsMsg(`Running doctor on ${name}…`);
    const { ok, data } = await pluginApi('POST', `/api/plugins/${encodeURIComponent(name)}/doctor`);
    setPluginsMsg('');
    // No footer actions — the modal header already has a Close button.
    pluginModal(`Doctor: ${name}`,
      renderDoctorReport(ok ? data : { ok: false, checks: [{ id: 'request', ok: false, detail: data.error || 'doctor failed' }] }));
  } else if (t.classList.contains('pl-update')) {
    const { ok, data } = await pluginApi('POST', `/api/plugins/${encodeURIComponent(name)}/update`, {});
    if (!ok) return setPluginsMsg(data.error || 'update preview failed', 'err');
    const body = renderUpdatePreview(data);
    pluginModal(`Update ${name}`, body);  // header Close only
    const confirmBtn = body.querySelector('.pl-confirm-update');
    if (confirmBtn) confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      const r2 = await pluginApi('POST', `/api/plugins/${encodeURIComponent(name)}/update`, { confirm: true });
      closePluginModal();
      if (!r2.ok) return setPluginsMsg(r2.data.error || 'update failed', 'err');
      setPluginsMsg(`Updated ${name}.`, 'ok');
      invalidateAgentCaches();
      loadPluginsView();
    });
  } else if (t.classList.contains('pl-remove')) {
    const res = await confirmModal({
      title: 'Uninstall plugin',
      message: `Uninstall "${name}"?`,
      confirmLabel: 'Uninstall',
      checkbox: { label: 'Also delete config, secrets and state (purge — cannot be undone)' },
    });
    if (!res.ok) return;
    const purge = res.checked;
    const { ok, status, data } = await pluginApi(
      'DELETE', `/api/plugins/${encodeURIComponent(name)}${purge ? '?purge=1' : ''}`,
    );
    if (status === 409) {
      pluginModal(`Cannot uninstall ${name}`, renderReferences409(data.references || []));
      return;
    }
    if (!ok) return setPluginsMsg(data.error || 'uninstall failed', 'err');
    setPluginsMsg(
      purge
        ? `Uninstalled ${name} and purged its data.`
        : `Uninstalled ${name}. Leftover data kept under ~/.worca-cc/plugins/${name}/data.`,
      'ok',
    );
    invalidateAgentCaches();
    loadPluginsView();
  } else if (t.classList.contains('pl-purge-orphan')) {
    const sure = await confirmModal({
      title: 'Purge plugin data',
      message: `Delete config, secrets and state for "${name}"? This cannot be undone.`,
      confirmLabel: 'Purge',
    });
    if (!sure) return;
    const { ok, data } = await pluginApi('DELETE', `/api/plugins/${encodeURIComponent(name)}/data`);
    if (!ok) return setPluginsMsg(data.error || 'purge failed', 'err');
    setPluginsMsg(`Purged leftover data for ${name}.`, 'ok');
    loadPluginsView();
  }
});

// Available section: Install… resolves the snapshot entry from the last
// /api/marketplaces payload and opens the same consent modal as before.
if (el.pluginsAvailable) el.pluginsAvailable.addEventListener('click', (e) => {
  const t = e.target instanceof Element ? e.target.closest('.pl-install-avail') : null;
  if (!t) return;
  const m = pluginsViewMarketplaces.find((x) => x.id === t.dataset.marketplace);
  const p = m && (m.plugins || []).find((x) => x.name === t.dataset.name);
  if (!m || !p || !m.lastSync) return;
  openInstallConsent({
    name: p.name, subdir: p.subdir, repoUrl: m.url, sha: m.lastSync.sha,
    inventory: p.inventory || {}, marketplace: m.id,
  });
});

// Marketplaces section: Refresh / Remove.
if (el.marketplacesList) el.marketplacesList.addEventListener('click', async (e) => {
  const t = e.target instanceof Element ? e.target.closest('.pl-mkt-refresh,.pl-mkt-remove') : null;
  const id = t && t.dataset ? t.dataset.id : '';
  if (!id) return;
  if (t.classList.contains('pl-mkt-refresh')) {
    setPluginsMsg('Refreshing marketplace…');
    const { ok, data } = await pluginApi('POST', `/api/marketplaces/${encodeURIComponent(id)}/refresh`, {});
    setPluginsMsg(ok ? '' : (data.error || 'refresh failed'), ok ? undefined : 'err');
    if (ok) loadPluginsView();
  } else if (t.classList.contains('pl-mkt-remove')) {
    const sure = await confirmModal({
      title: 'Remove marketplace',
      message: 'Removes plugin discovery from this marketplace. Installed plugins are not affected.',
      confirmLabel: 'Remove',
    });
    if (!sure) return;
    const { ok, data } = await pluginApi('DELETE', `/api/marketplaces/${encodeURIComponent(id)}`);
    if (!ok) return setPluginsMsg(data.error || 'remove failed', 'err');
    setPluginsMsg('Marketplace removed. Installed plugins remain.', 'ok');
    loadPluginsView();
  }
});

if (el.pluginAddBtn) el.pluginAddBtn.addEventListener('click', () => {
  el.marketplaceAddRow.classList.toggle('hidden');
  if (!el.marketplaceAddRow.classList.contains('hidden')) el.marketplaceUrl.focus();
});
if (el.marketplaceAdd) el.marketplaceAdd.addEventListener('click', addMarketplaceFromInput);
if (el.pluginModalClose) el.pluginModalClose.addEventListener('click', () => {
  if (grvState.wizard) return grvCloseWizard();
  closePluginModal();
});

// ---- Guardrails view (named sets: list + two-step wizard popup) ----
// All view state lives here; loadGuardrailsView rebuilds the list, and the wizard
// (Step 1 start-picker -> Step 2 editor) renders into the #plugin-modal body.
const grvState = { sets: [], editing: null, saved: null, wizard: null };
const grvClone = (o) => JSON.parse(JSON.stringify(o));
const emptyGuardrails = () => ({ honorProjectSettings: true, envScrub: false, envAllowlist: [], protectedPaths: [], deny: [] });

function setGuardrailsMsg(text, kind) {
  if (!el.guardrailsMsg) return;
  el.guardrailsMsg.textContent = text || '';
  el.guardrailsMsg.className = 'form-msg' + (kind ? ' ' + kind : '');
}

const GRV_LIST_FIELDS = { 'gr-allow': 'envAllowlist', 'gr-paths': 'protectedPaths', 'gr-deny': 'deny' };

// Re-render the Step-2 editor into the modal body (was an inline #guardrails-list swap).
function grvRenderEditor(settings, opts) {
  el.pluginModalBody.replaceChildren(renderGuardrailEditor(
    { ...grvState.editing, settings }, { mode: grvState.wizard.mode, ...opts },
  ));
}

function grvRenderStep1() {
  const sources = grvState.sets.map((s) => ({ id: s.id, name: s.name, origin: s.origin }));
  el.pluginModalBody.replaceChildren(renderStartStep(sources, { selectedId: grvState.wizard.sourceId || '' }));
  (el.pluginModalBody.querySelector('.grv-source:checked') || el.pluginModalBody.querySelector('.grv-next'))?.focus();
}

// Open the wizard. mode 'create' starts at Step 1; 'edit'/'view' open Step 2 for `set`.
function openGuardrailWizard(mode, set) {
  if (mode === 'create') {
    grvState.wizard = { mode, step: 1, sourceId: '' };
    grvState.editing = { id: null, name: '', origin: null };
    grvState.saved = { name: '', settings: emptyGuardrails() };
    const sources = grvState.sets.map((s) => ({ id: s.id, name: s.name, origin: s.origin }));
    pluginModal('Create guardrails', renderStartStep(sources, { selectedId: '' }), []);
    (el.pluginModalBody.querySelector('.grv-source:checked') || el.pluginModalBody.querySelector('.grv-next'))?.focus();
  } else {
    grvState.wizard = { mode, step: 2, sourceId: '' };
    grvState.editing = { id: set.id, name: set.name, origin: set.origin || null };
    grvState.saved = { name: set.name, settings: grvClone(set.settings) };
    pluginModal(mode === 'view' ? 'View guardrail set' : 'Edit guardrail set',
      renderGuardrailEditor({ ...grvState.editing, settings: grvClone(set.settings) },
        { mode, dirty: false, msg: '', msgErr: false }), []);
    el.pluginModalBody.querySelector(mode === 'view' ? '.grv-save' : '.grv-name-input')?.focus();
  }
}

// Close the wizard + refresh the list. Normalizes a deep-link hash back to bare
// #guardrails (router reloads); a bare hash refreshes in place.
function grvExitWizard() {
  grvState.wizard = null;
  grvState.editing = null;
  closePluginModal();
  if (location.hash.slice(1).startsWith('guardrails/')) location.hash = 'guardrails';
  else loadGuardrailsView();
}

// Close with a dirty-guard: confirm discard only when the Step-2 editor has unsaved
// changes; Step 1 (no editor) always closes freely.
async function grvCloseWizard() {
  const root = el.pluginModalBody.querySelector('.grv-editor');
  if (root && grvDirty(root)) {
    const ok = await confirmModal({
      title: 'Discard changes?',
      message: 'This guardrail set has unsaved changes. Discard them?',
      confirmLabel: 'Discard',
    });
    if (!ok) return;
  }
  grvExitWizard();
}

function grvDirty(rootEl) {
  return JSON.stringify(collectGuardrailEditor(rootEl)) !== JSON.stringify(grvState.saved);
}

// collect -> mutate -> full re-render of the Step-2 editor.
function grvMutate(rootEl, fn) {
  const cur = collectGuardrailEditor(rootEl);
  fn(cur.settings);
  grvState.editing.name = cur.name;
  const dirty = JSON.stringify(cur) !== JSON.stringify(grvState.saved);
  grvRenderEditor(cur.settings, { dirty, msg: '', msgErr: false });
}

async function grvSave(rootEl) {
  const cur = collectGuardrailEditor(rootEl);
  const mode = grvState.wizard.mode;
  if (mode === 'view') {
    // "Save as new set": flip the read-only built-in view into a create, prefilled.
    grvState.wizard = { mode: 'create', step: 2, sourceId: grvState.editing.id };
    const settings = cur.settings;
    grvState.editing = { id: null, name: '', origin: null };
    grvState.saved = { name: '', settings: grvClone(settings) };
    el.pluginModalTitle.textContent = 'Create guardrails'; // header was 'View guardrail set'
    grvRenderEditor(settings, { dirty: false, msg: '', msgErr: false });
    el.pluginModalBody.querySelector('.grv-name-input')?.focus();
    return;
  }
  if (!cur.name) return grvRenderEditor(cur.settings, { dirty: true, msg: 'name is required', msgErr: true });
  grvState.editing.name = cur.name;
  const isCreate = mode === 'create';
  const url = isCreate ? '/api/guardrails' : `/api/guardrails/${encodeURIComponent(grvState.editing.id)}`;
  try {
    const res = await fetch(url, {
      method: isCreate ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: cur.name, settings: cur.settings }),
    });
    const data = await safeJson(res);
    if (!grvState.wizard) return; // user discarded/closed while the request was in flight
    if (!res.ok) {
      const msg = (data.errors ? data.errors.join('; ') : data.error) || `HTTP ${res.status}`;
      return grvRenderEditor(cur.settings, { dirty: true, msg, msgErr: true });
    }
    grvExitWizard();
  } catch (e) {
    grvRenderEditor(cur.settings, { dirty: true, msg: e.message, msgErr: true });
  }
}

// Final routing: render the list and, when `param` names a set, open the wizard in
// 'edit' (user) or 'view' (built-in). Resets a stale wizard on any path that does not
// open a fresh one (browser Back to the bare list, or a bad deep-link).
async function loadGuardrailsView(param = '') {
  if (!el.guardrailsList) return;
  setGuardrailsMsg('');
  try {
    const res = await fetch('/api/guardrails');
    const data = await safeJson(res);
    if (!res.ok) return setGuardrailsMsg(data.error || `HTTP ${res.status}`, 'err');
    grvState.sets = Array.isArray(data.guardrails) ? data.guardrails : [];
    el.guardrailsList.replaceChildren(renderGuardrailList(grvState.sets));
    if (param) {
      const set = grvState.sets.find((s) => s.id === param);
      if (set) { openGuardrailWizard(set.origin === 'builtin' ? 'view' : 'edit', set); return; }
      setGuardrailsMsg(`guardrail set "${param}" not found`, 'err');
    }
    if (grvState.wizard) { // no fresh wizard opened above: close any stale one (browser Back / bad id)
      grvState.wizard = null; grvState.editing = null; closePluginModal();
    }
  } catch (e) {
    setGuardrailsMsg(e.message, 'err');
  }
}

// ---------------------------------------------------------------------------
// Models view (configurable-models-design.md §4.10). Global catalog CRUD over
// /api/models; the selected project's legacy custom models are listed with a
// Promote action. The editor renders inline at the top of the list; env values
// arrive MASKED and are write-only (unchanged masked echoes mean "keep").
// ---------------------------------------------------------------------------
const mvState = { data: null, editing: null, openCreate: false, openShare: false, prefill: null };

function setModelsMsg(text, kind) {
  if (!el.modelsMsg) return;
  el.modelsMsg.textContent = text || '';
  el.modelsMsg.className = 'form-msg' + (kind ? ' ' + kind : '');
}

function renderModelsViewBody() {
  if (!el.modelsList) return;
  const d = mvState.data || { models: [], predefined: [], efforts: [] };
  const pp = selectedProjectPath();
  const legacy = pp && state.config && Array.isArray(state.config.customModels) ? state.config.customModels : [];
  const frag = document.createDocumentFragment();
  if (mvState.openShare) {
    frag.appendChild(renderExportWizard(d.models || []));
  } else if (mvState.editing || mvState.openCreate) {
    const editor = renderModelEditor(mvState.editing, d.efforts || []);
    if (!mvState.editing && mvState.prefill) prefillModelEditor(editor, mvState.prefill);
    frag.appendChild(editor);
  }
  frag.appendChild(renderModelsList({
    globals: d.models || [],
    legacy,
    plugins: d.plugin || [],
    predefined: d.predefined || [],
    efforts: d.efforts || [],
    projectName: pp ? pp.split('/').pop() : '',
  }));
  el.modelsList.replaceChildren(frag);
}

// "Edit a copy" prefill (design §9.6): create-mode editor seeded from a plugin
// model — id/label/efforts plus its literal/${VAR} env values; each {secret}
// key becomes an EMPTY row the user must fill (the plugin's secret is never
// copied). Saving POSTs a global entry that shadows the plugin one.
function prefillModelEditor(editor, pre) {
  const idInput = editor.querySelector('.mv-id');
  if (idInput) idInput.value = pre.id;
  const labelInput = editor.querySelector('.mv-label');
  if (labelInput) labelInput.value = pre.label && pre.label !== pre.id ? pre.label : '';
  const efforts = new Set(pre.efforts || []);
  if (efforts.size) {
    for (const cb of editor.querySelectorAll('.mv-effort-cb')) cb.checked = efforts.has(cb.value);
  }
  const wrap = editor.querySelector('.mv-env');
  if (!wrap) return;
  for (const [k, v] of Object.entries(pre.env || {})) {
    const row = makeEnvRow();
    row.querySelector('.mv-env-key').value = k;
    row.querySelector('.mv-env-val').value = v;
    wrap.appendChild(row);
  }
  for (const k of pre.secretKeys || []) {
    const row = makeEnvRow();
    row.querySelector('.mv-env-key').value = k;
    row.querySelector('.mv-env-val').placeholder = 'value required — the plugin secret is not copied';
    wrap.appendChild(row);
  }
  const msg = editor.querySelector('.mv-editor-msg');
  if (msg && (pre.secretKeys || []).length) {
    msg.textContent = `Fill in ${pre.secretKeys.join(', ')} — secret values never leave the plugin.`;
  }
}

async function editPluginCopyFlow(plugin, id) {
  try {
    const res = await fetch(`/api/plugins/${encodeURIComponent(plugin)}/model-env?id=${encodeURIComponent(id)}`);
    const data = await safeJson(res);
    if (!res.ok) return setModelsMsg(data.error || `HTTP ${res.status}`, 'err');
    mvState.editing = null;
    mvState.openCreate = true;
    mvState.openShare = false;
    mvState.prefill = data;
    renderModelsViewBody();
  } catch (e) {
    setModelsMsg(e.message, 'err');
  }
}

async function exportPluginFlow() {
  const wiz = el.modelsList && el.modelsList.querySelector('.mvx');
  if (!wiz) return;
  const msg = wiz.querySelector('.mvx-msg');
  const say = (text) => { if (msg) { msg.textContent = text; msg.className = 'form-msg mvx-msg err'; } };
  const body = collectExportWizard(wiz);
  if (!body.models.length) return say('pick at least one model');
  if (!body.name) return say('plugin name is required');
  if (!body.dest) return say('destination folder is required');
  try {
    const res = await fetch('/api/models/export-plugin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await safeJson(res);
    if (!res.ok) return say(data.error || `HTTP ${res.status}`);
    mvState.openShare = false;
    setModelsMsg(`Plugin scaffold written to ${data.dir} — git init + push it, then teammates install it from the Plugins view.`, 'ok');
    renderModelsViewBody();
  } catch (e) {
    say(e.message);
  }
}

async function loadModelsView() {
  if (!el.modelsList) return;
  setModelsMsg('');
  try {
    const res = await fetch('/api/models');
    const data = await safeJson(res);
    if (!res.ok) return setModelsMsg(data.error || `HTTP ${res.status}`, 'err');
    mvState.data = data;
    renderModelsViewBody();
  } catch (e) {
    setModelsMsg(e.message, 'err');
  }
}

// Any catalog mutation must repaint BOTH surfaces: this view and the composer's
// model dropdowns (state.models comes from /api/config).
async function refreshModelsEverywhere() {
  await loadModelsView();
  try { await loadConfig(selectedProjectPath() || ''); } catch { /* dropdowns refresh best-effort */ }
}

// Copy a stored env value to the clipboard — the REAL value, not the mask.
// The user already owns it on disk (~/.worca-cc/settings.json); the reveal is
// a deliberate single-value GET, keyed by the row's STORED key (dataset.key,
// frozen at render), so it works even after the key input was edited.
async function copyModelEnvValue(btn) {
  const row = btn.closest('.mv-env-row');
  const editor = btn.closest('.mv-editor');
  const id = editor && editor.dataset.id;
  const key = row && row.dataset.key;
  if (!id || !key) return;
  const flash = (text) => {
    const prev = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = prev; }, 1200);
  };
  try {
    const res = await fetch(`/api/models/${encodeURIComponent(id)}/env-value?key=${encodeURIComponent(key)}`);
    const data = await safeJson(res);
    if (!res.ok) return flash('!');
    await navigator.clipboard.writeText(data.value);
    flash('✓');
  } catch {
    flash('!');
  }
}

// "Show values" toggle: swap every UNTOUCHED masked input to the real stored
// value (fetched raw), and back. User-edited inputs are never clobbered in
// either direction. dataset.original tracks what "untouched" means so the
// write-only PATCH semantics keep working: a revealed raw value echoed on
// save just rewrites the same value.
async function toggleModelEnvReveal(btn) {
  const editor = btn.closest('.mv-editor');
  const id = editor && editor.dataset.id;
  if (!id) return;
  const rows = editor.querySelectorAll('.mv-env-row[data-key]');
  if (btn.dataset.on) {
    for (const row of rows) {
      const v = row.querySelector('.mv-env-val');
      if (v && v.dataset.masked !== undefined && v.value === v.dataset.original) {
        v.value = v.dataset.masked;
        v.dataset.original = v.dataset.masked;
        delete v.dataset.masked;
      }
    }
    delete btn.dataset.on;
    btn.textContent = 'Show values';
    return;
  }
  try {
    const res = await fetch(`/api/models/${encodeURIComponent(id)}/env-value`);
    const data = await safeJson(res);
    if (!res.ok || !data.env) return;
    for (const row of rows) {
      const v = row.querySelector('.mv-env-val');
      const key = row.dataset.key;
      if (!v || !(key in data.env)) continue;
      if (v.value !== v.dataset.original) continue; // user edited — keep their text
      v.dataset.masked = v.dataset.original;
      v.value = data.env[key];
      v.dataset.original = data.env[key];
    }
    btn.dataset.on = '1';
    btn.textContent = 'Hide values';
  } catch { /* reveal is best-effort */ }
}

async function saveModelEditorFlow() {
  const rootEl = el.modelsList && el.modelsList.querySelector('.mv-editor');
  if (!rootEl) return;
  const msg = rootEl.querySelector('.mv-editor-msg');
  const say = (text) => { if (msg) { msg.textContent = text; msg.className = 'form-msg mv-editor-msg err'; } };
  const { id, body } = collectModelEditor(rootEl);
  if (!id && !body.id) return say('model id is required');
  try {
    const res = await fetch(id ? `/api/models/${encodeURIComponent(id)}` : '/api/models', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await safeJson(res);
    if (!res.ok) return say(data.error || `HTTP ${res.status}`);
    mvState.editing = null;
    mvState.openCreate = false;
    mvState.prefill = null;
    setModelsMsg(id ? 'Saved.' : 'Model added.', 'ok');
    await refreshModelsEverywhere();
  } catch (e) {
    say(e.message);
  }
}

async function deleteModelFlow(id) {
  let refs = null;
  try {
    const r = await fetch(`/api/models/${encodeURIComponent(id)}/refs`);
    refs = await safeJson(r);
  } catch { /* preview is best-effort; the confirm still names the model */ }
  const ok = await confirmModal({
    title: refs && refs.predefinedShadow ? 'Remove override' : 'Delete model',
    message: deleteRefsSummary(id, refs),
    confirmLabel: refs && refs.predefinedShadow ? 'Remove override' : 'Delete',
  });
  if (!ok) return;
  try {
    const res = await fetch(`/api/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await safeJson(res);
    if (!res.ok) return setModelsMsg(data.error || `HTTP ${res.status}`, 'err');
    setModelsMsg('Deleted.', 'ok');
    await refreshModelsEverywhere();
  } catch (e) {
    setModelsMsg(e.message, 'err');
  }
}

async function promoteModelFlow(id) {
  const projectDir = selectedProjectPath();
  if (!projectDir) return;
  try {
    const res = await fetch('/api/models/promote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir, id }),
    });
    const data = await safeJson(res);
    if (!res.ok) return setModelsMsg(data.error || `HTTP ${res.status}`, 'err');
    setModelsMsg(`"${id}" is now global.`, 'ok');
    await refreshModelsEverywhere();
  } catch (e) {
    setModelsMsg(e.message, 'err');
  }
}

if (el.modelsList) {
  el.modelsList.addEventListener('click', (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.classList.contains('mv-edit')) {
      mvState.editing = (mvState.data && mvState.data.models || []).find((m) => m.id === t.dataset.id) || null;
      mvState.openCreate = false;
      mvState.openShare = false;
      mvState.prefill = null;
      renderModelsViewBody();
    } else if (t.classList.contains('mv-delete')) {
      deleteModelFlow(t.dataset.id);
    } else if (t.classList.contains('mv-promote')) {
      promoteModelFlow(t.dataset.id);
    } else if (t.classList.contains('mv-copy')) {
      editPluginCopyFlow(t.dataset.plugin, t.dataset.id);
    } else if (t.classList.contains('mvx-export')) {
      exportPluginFlow();
    } else if (t.classList.contains('mvx-cancel')) {
      mvState.openShare = false;
      renderModelsViewBody();
    } else if (t.classList.contains('mv-cancel')) {
      mvState.editing = null; mvState.openCreate = false; mvState.prefill = null;
      renderModelsViewBody();
    } else if (t.classList.contains('mv-env-add')) {
      const wrap = el.modelsList.querySelector('.mv-editor .mv-env');
      if (wrap) wrap.appendChild(makeEnvRow());
    } else if (t.classList.contains('mv-env-rm')) {
      const row = t.closest('.mv-env-row');
      if (row) row.remove();
    } else if (t.classList.contains('mv-env-copy')) {
      copyModelEnvValue(t);
    } else if (t.classList.contains('mv-env-reveal')) {
      toggleModelEnvReveal(t);
    } else if (t.classList.contains('mv-save')) {
      saveModelEditorFlow();
    }
  });
}
if (el.modelCreateBtn) {
  el.modelCreateBtn.addEventListener('click', () => {
    mvState.editing = null;
    mvState.openCreate = true;
    mvState.openShare = false;
    mvState.prefill = null;
    renderModelsViewBody();
  });
}
if (el.modelShareBtn) {
  el.modelShareBtn.addEventListener('click', () => {
    mvState.editing = null;
    mvState.openCreate = false;
    mvState.prefill = null;
    mvState.openShare = true;
    renderModelsViewBody();
  });
}

// ---------------------------------------------------------------------------
// Statistics view
// ---------------------------------------------------------------------------
const statsState = { range: null };

function defaultStatsRange() {
  const period = budgetState.budget?.resetPeriod;
  return period === 'weekly' ? 'week' : 'month';
}

async function loadStatsView() {
  if (!statsState.range) statsState.range = defaultStatsRange();
  // seg highlight
  for (const b of el.statsRange.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.range === statsState.range);
  }
  const body = el.statsBody;
  if (body.childElementCount) body.classList.add('is-loading');
  // A network-level rejection is not an !res.ok — without this catch it escapes
  // as an unhandled rejection and leaves the body stuck in .is-loading.
  let res, data;
  try {
    res = await fetch(`/api/stats?range=${encodeURIComponent(statsState.range)}`);
    data = await safeJson(res);
  } catch (err) {
    body.classList.remove('is-loading');
    body.replaceChildren(Object.assign(document.createElement('small'),
      { className: 'hint err', textContent: `Could not load statistics: ${err.message}` }));
    return;
  }
  body.classList.remove('is-loading');
  if (!res.ok) {
    body.replaceChildren(Object.assign(document.createElement('small'),
      { className: 'hint err', textContent: data.error || `HTTP ${res.status}` }));
    return;
  }
  body.replaceChildren(renderStatsBody(data, {
    fmt: { usd: fmtUsd, usd4: fmtUsd4, duration: fmtDuration, estTitle } }));
}

async function deleteGuardrailSetFlow(id) {
  const set = grvState.sets.find((s) => s.id === id);
  const ok = await confirmModal({
    title: 'Delete guardrail set',
    message: `Delete "${(set && set.name) || id}"? Runs that already recorded it keep their record; paused runs that pinned it block deletion until they finish.`,
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  try {
    const res = await fetch(`/api/guardrails/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await safeJson(res);
    if (res.status === 409) {
      pluginModal('Cannot delete guardrail set', renderGuardrailReferences409(data.references || []));
      return;
    }
    if (!res.ok) return setGuardrailsMsg(data.error || `HTTP ${res.status}`, 'err');
    setGuardrailsMsg('Deleted.', 'ok');
    loadGuardrailsView();
  } catch (e) {
    setGuardrailsMsg(e.message, 'err');
  }
}

// List surface: open the wizard (deep-link via hash) or delete. Editor events now
// live on the modal body (the editor renders inside #plugin-modal).
if (el.guardrailsList) {
  el.guardrailsList.addEventListener('click', (e) => {
    const t = e.target;
    const edit = t.closest && t.closest('.grv-edit');
    if (edit) { location.hash = `guardrails/${edit.dataset.id}`; return; }
    const del = t.closest && t.closest('.grv-delete');
    if (del) { deleteGuardrailSetFlow(del.dataset.id); return; }
  });
}

// Wizard surface: Step-1 (source/next/cancel) + Step-2 editor events. Gated on an
// open wizard so other #plugin-modal consumers are untouched.
if (el.pluginModalBody) {
  el.pluginModalBody.addEventListener('click', (e) => {
    if (!grvState.wizard) return;
    const t = e.target;
    if (t.closest('.grv-cancel')) { grvExitWizard(); return; }
    if (t.closest('.grv-next')) {
      const srcId = collectStartStep(el.pluginModalBody);
      const w = grvState.wizard;
      const src = srcId ? (grvState.sets.find((s) => s.id === srcId) || {}) : null;
      const seed = (src && src.settings) ? grvClone(src.settings) : emptyGuardrails();
      // Returning via Back and re-picking the SAME source restores the in-progress
      // Step-2 edits instead of silently re-seeding (no data loss on Back -> Next).
      const restore = w.work && srcId === w.sourceId;
      const settings = restore ? w.work.settings : seed;
      const name = restore ? w.work.name : '';
      grvState.wizard = { mode: 'create', step: 2, sourceId: srcId }; // drops w.work
      grvState.editing = { id: null, name, origin: null };
      grvState.saved = { name: '', settings: seed };
      grvRenderEditor(settings, {
        dirty: JSON.stringify({ name, settings }) !== JSON.stringify(grvState.saved),
        msg: '', msgErr: false,
      });
      el.pluginModalBody.querySelector('.grv-name-input')?.focus();
      return;
    }
    if (t.closest('.grv-back')) {
      const editorEl = el.pluginModalBody.querySelector('.grv-editor');
      grvState.wizard.work = editorEl ? collectGuardrailEditor(editorEl) : null; // stash edits for same-source return
      grvState.wizard.step = 1;
      grvRenderStep1();
      return;
    }
    const root = t.closest('.grv-editor');
    if (!root) return;
    const sw = t.closest('.switch');
    if (sw && !sw.classList.contains('disabled')) {
      const fld = sw.classList.contains('gr-honor') ? 'honorProjectSettings' : 'envScrub';
      return grvMutate(root, (s) => { s[fld] = !s[fld]; });
    }
    const rm = t.closest('.gr-rm');
    if (rm) {
      const listEl = rm.closest('.gr-list');
      const fld = listEl && GRV_LIST_FIELDS[[...listEl.classList].find((c) => GRV_LIST_FIELDS[c])];
      if (fld) grvMutate(root, (s) => { s[fld] = s[fld].filter((x) => x !== rm.dataset.value); });
      return;
    }
    const addBtn = t.closest('.gr-add-btn');
    if (addBtn) {
      const addRow = addBtn.closest('.gr-add');
      const fld = GRV_LIST_FIELDS[addRow && addRow.dataset.list];
      const input = addRow && addRow.querySelector('input');
      const v = ((input && input.value) || '').trim();
      if (!fld || !v) return;
      grvMutate(root, (s) => { if (!s[fld].includes(v)) s[fld] = [...s[fld], v]; });
      el.pluginModalBody.querySelector(`.gr-add[data-list="${addRow.dataset.list}"] input`)?.focus();
      return;
    }
    if (t.closest('.grv-discard')) {
      grvState.editing.name = grvState.saved.name;
      grvRenderEditor(grvClone(grvState.saved.settings), { dirty: false, msg: '', msgErr: false });
      return;
    }
    if (t.closest('.grv-save')) { grvSave(root); return; }
  });
  el.pluginModalBody.addEventListener('input', (e) => {
    if (!grvState.wizard || !e.target.classList || !e.target.classList.contains('grv-name-input')) return;
    const root = e.target.closest('.grv-editor');
    if (!root) return;
    const dirty = grvDirty(root);
    const save = root.querySelector('.grv-save');
    if (save) save.disabled = !dirty;
    const disc = root.querySelector('.grv-discard');
    if (disc) disc.disabled = !dirty;
  });
  el.pluginModalBody.addEventListener('keydown', (e) => {
    if (!grvState.wizard) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const root = e.target.closest && e.target.closest('.grv-editor');
    if (!root) return;
    if (e.target.classList?.contains('switch') && !e.target.classList.contains('disabled')) {
      e.preventDefault();
      const fld = e.target.classList.contains('gr-honor') ? 'honorProjectSettings' : 'envScrub';
      return grvMutate(root, (s) => { s[fld] = !s[fld]; });
    }
    if (e.key === 'Enter' && e.target.matches?.('.gr-add input')) {
      e.preventDefault();
      const addRow = e.target.closest('.gr-add');
      const fld = GRV_LIST_FIELDS[addRow && addRow.dataset.list];
      const v = (e.target.value || '').trim();
      if (!fld || !v) return;
      grvMutate(root, (s) => { if (!s[fld].includes(v)) s[fld] = [...s[fld], v]; });
      el.pluginModalBody.querySelector(`.gr-add[data-list="${addRow.dataset.list}"] input`)?.focus();
    }
  });
}

// Dismiss the wizard via Esc / backdrop click, routed through grvCloseWizard (dirty-guard).
// Gated on grvState.wizard so other #plugin-modal consumers (plugin install/settings/doctor/409)
// are untouched. Esc yields when the confirm dialog is on top so it doesn't close both at once.
if (el.pluginModal) {
  el.pluginModal.addEventListener('click', (e) => {
    if (grvState.wizard && e.target === el.pluginModal) grvCloseWizard();
  });
  document.addEventListener('keydown', (e) => {
    if (grvState.wizard && e.key === 'Escape'
      && (!el.confirmModal || el.confirmModal.classList.contains('hidden'))) grvCloseWizard();
  });
}

if (el.guardrailCreateBtn) el.guardrailCreateBtn.addEventListener('click', () => openGuardrailWizard('create'));

if (typeof window !== 'undefined') {
  window.__guardrails = { loadGuardrailsView, openGuardrailWizard, deleteGuardrailSetFlow, grvState, grvSave, grvMutate };
}

// ---------------------------------------------------------------------------
// Per-card Stop. POST /api/stop; on success the server emits state(stopped) +
// done, which finishRun handles (card drops out + History refresh). On failure
// re-enable the button and log to that card.
// ---------------------------------------------------------------------------
async function stopRun(runId, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
    if (!res.ok) {
      const err = await safeJson(res);
      if (btn) btn.disabled = false;
      const r = runs.get(runId);
      if (r) onLog(r, { source: 'ui', level: 'error', text: `stop failed: ${err.error || res.status}`, ts: Date.now() });
    }
  } catch (e) {
    if (btn) btn.disabled = false;
    const r = runs.get(runId);
    if (r) onLog(r, { source: 'ui', level: 'error', text: `stop error: ${e.message}`, ts: Date.now() });
  }
}

// Per-card Pause. POST /api/pause; on success the server flips the run to
// 'pausing' (state event keeps the card visible via liveRuns) and the eventual
// done(paused) routes through finishRun — the record resurfaces in History
// with a Resume button. On failure re-enable the button and log to that card.
async function pauseRun(runId, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
    if (!res.ok) {
      const err = await safeJson(res);
      if (btn) btn.disabled = false;
      const r = runs.get(runId);
      if (r) onLog(r, { source: 'ui', level: 'error', text: `pause failed: ${err.error || res.status}`, ts: Date.now() });
    }
  } catch (e) {
    if (btn) btn.disabled = false;
    const r = runs.get(runId);
    if (r) onLog(r, { source: 'ui', level: 'error', text: `pause error: ${e.message}`, ts: Date.now() });
  }
}

// Per-card Resume for a PAUSED run parked in Running. POST /api/resume with the
// run's pipelineId; the server starts a fresh live run (new runId) that announces
// itself over the WS. Drop the old paused run object so the pipeline doesn't
// double-show (paused card + new live card share a pipelineId), then land on the
// live Overview. Mirrors the detail screen's Resume path.
// Carry the paused run's log into the resumed run so the live card shows ALL
// logs continuously. Resume mints a NEW runId with a fresh buffer, so without
// this the pre-pause lines (on the old run object, or only on disk) would be
// split off from the post-resume stream — the symptom was "only the logs before
// pause are visible". `prevLines` is the in-memory pre-pause log when available;
// otherwise pass null + a `logUrl` and the persisted NDJSON is fetched (by the
// shared pipelineId) so resume from History / after a reload still seeds.
// Lines already streamed onto the new run are kept AFTER the seed (prepend), so
// nothing in-flight is lost.
async function seedResumedLog(newRunId, prevLines, logUrl) {
  const nr = runs.get(newRunId);
  if (!nr) return;
  let head = Array.isArray(prevLines) ? prevLines.slice() : [];
  if (!head.length && logUrl) {
    try {
      const res = await fetch(logUrl);
      if (res.ok) {
        for (const raw of (await res.text()).split('\n')) {
          const t = raw.trim(); if (!t) continue;
          try {
            const rec = JSON.parse(t);
            head.push(projectLogRecord(rec));
          } catch { /* torn line */ }
        }
      }
    } catch { /* best-effort seed */ }
  }
  if (!head.length) return;
  const sep = { ts: Date.now(), source: 'ui', level: 'info', text: '── resumed — continuing below ──' };
  const tail = Array.isArray(nr.logLines) ? nr.logLines : [];
  nr.logLines = [...head, sep, ...tail];
  if (nr.logLines.length > MAX_LOG_LINES) nr.logLines = nr.logLines.slice(-MAX_LOG_LINES);
  nr.el = null;            // force paintRunList to rebuild the card from the seeded log
  renderRunningView();
}

// Shared copy for the "continue without cap" confirmation, so the Running card
// and the History card ask the exact same question.
const COST_OVERRIDE_CONFIRM = {
  title: 'Continue without cap?',
  message: 'This pipeline will ignore the per-pipeline cost limit from now on, ' +
    'including future resumes. The total budget limit still applies.',
  confirmLabel: 'Continue without cap',
};

/** cb-override click: confirm, then resume with the persistent cap override. */
async function confirmCostOverride(runId, btn) {
  const ok = await confirmModal({ ...COST_OVERRIDE_CONFIRM });
  if (ok) resumeRunFromCard(runId, btn, { ignoreCostCap: true });
}

async function resumeRunFromCard(runId, btn, { ignoreCostCap = false } = {}) {
  const r = runs.get(runId);
  if (!r || !isPaused(r)) return;
  const pipelineId = r.pipelineId;
  if (!pipelineId) {
    onLog(r, { source: 'ui', level: 'error', text: 'resume failed: run has no pipelineId', ts: Date.now() });
    return;
  }
  // Snapshot the pre-pause log BEFORE the old run is dropped, to seed the resumed
  // run for a continuous log.
  const prevLines = Array.isArray(r.logLines) ? r.logLines.slice() : [];
  const prevBtnHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = ' Resuming…'; }
  try {
    const res = await fetch('/api/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelineId, ...(ignoreCostCap ? { ignoreCostCap: true } : {}) }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    upsertRun({
      runId: data.runId,
      title: r.title || pipelineId,
      projectDir: r.projectDir || '',
      status: 'starting',
      kind: r.kind || 'run',
      pipelineId,
      branchFeature: r.branchFeature,   // carry branch so the resumed card keeps its label
      local: true,
    });
    await seedResumedLog(data.runId, prevLines, null);  // in-memory pre-pause log → continuous
    // Old paused run is superseded by the resumed live run — drop it so Running
    // shows only the new card (same pipelineId would otherwise render twice).
    runs.delete(runId);
    if (state.selectedRunId === runId) state.selectedRunId = '';
    updateNavCounts();
    location.hash = `running/${data.runId}`;   // land on the continuous live card
    renderRunningView();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.innerHTML = prevBtnHtml; }
    const rr = runs.get(runId);
    if (rr) onLog(rr, { source: 'ui', level: 'error', text: `resume failed: ${err.message}`, ts: Date.now() });
  }
}

// Delegated controls on the dynamic run-card list: per-card Stop/Pause + per-card
// auto-scroll switch. Scoped to each card via closest('.run-card').
const runListEl = $('#run-list');
if (runListEl) {
  runListEl.addEventListener('click', (e) => {
    const stopBtn = e.target.closest && e.target.closest('.btn-stop');
    if (stopBtn) {
      const card = stopBtn.closest('.run-card');
      const runId = card && card.dataset.runId;
      if (runId) stopRun(runId, stopBtn);
      return;
    }
    const pauseBtn = e.target.closest && e.target.closest('.btn-pause');
    if (pauseBtn) {
      const card = pauseBtn.closest('.run-card');
      const runId = card && card.dataset.runId;
      if (runId) pauseRun(runId, pauseBtn);
      return;
    }
    const resumeBtn = e.target.closest && e.target.closest('.btn-resume');
    if (resumeBtn) {
      const card = resumeBtn.closest('.run-card');
      const runId = card && card.dataset.runId;
      if (runId) resumeRunFromCard(runId, resumeBtn);
      return;
    }
    // Cost-banner actions. This handler is a plain sync arrow — the override
    // confirm is async, so fire-and-forget it exactly like .btn-resume above.
    const overrideBtn = e.target.closest && e.target.closest('.cb-override');
    if (overrideBtn) {
      const runId = overrideBtn.closest('.run-card')?.dataset.runId;
      if (runId) confirmCostOverride(runId, overrideBtn);
      return;
    }
    if (e.target.closest && e.target.closest('.cb-settings')) { location.hash = 'settings'; return; }
    const sw = e.target.closest && e.target.closest('.switch.autoscroll');
    if (sw) {
      const card = sw.closest('.run-card');
      const r = card && runs.get(card.dataset.runId);
      if (r) setAutoscroll(r, r.autoscroll === false);   // flip effective state
      return;
    }

    // qpanel actions. Resolve the run per-card via the enclosing .run-card so
    // delegation works for any dynamically-built card.
    const qbtn = e.target.closest && e.target.closest('.qpanel .btn-go, .qpanel .gate-continue, .qpanel .gate-another, .qpanel .recovery-retry, .qpanel .recovery-abort');
    if (qbtn) {
      const card = qbtn.closest('.run-card');
      const runId = card && card.dataset.runId;
      const r = runId && runs.get(runId);
      if (!r) return;
      if (qbtn.classList.contains('gate-continue')) postAnswer(r, { decision: 'continue' });
      else if (qbtn.classList.contains('gate-another')) postAnswer(r, { decision: 'another' });
      else if (qbtn.classList.contains('recovery-retry')) postAnswer(r, { decision: 'retry' });
      else if (qbtn.classList.contains('recovery-abort')) postAnswer(r, { decision: 'abort' });
      else submitAnswer(r);
    }
  });

  // a11y: the autoscroll .switch has role="switch" + tabindex="0" but only the
  // click path toggled it. Mirror that toggle for Space/Enter via a delegated
  // keydown (scoped through closest('.run-card') so it can't fire elsewhere).
  runListEl.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    const sw = e.target.closest && e.target.closest('.switch.autoscroll');
    if (!sw || !sw.closest('.run-card')) return;
    e.preventDefault();
    const card = sw.closest('.run-card');
    const r = card && runs.get(card.dataset.runId);
    if (r) setAutoscroll(r, r.autoscroll === false);
  });

  // Log filter dropdowns (source/level/step/cycle). Delegated like the switch
  // above; read them all so one change event leaves the whole filter consistent.
  runListEl.addEventListener('change', (e) => {
    const sel = e.target.closest && e.target.closest('select.log-f');
    if (!sel) return;
    const card = sel.closest('.run-card');
    const r = card && runs.get(card.dataset.runId);
    if (!r) return;
    r.logFilter = readCardLogFilter(card, r);
    repaintFilteredLog(r);
  });

  // Log search. Debounced: `input` fires per keystroke and each repaint rebuilds
  // every visible line, so filtering on the raw event would rebuild the pane
  // mid-word. The model keeps every line, so narrowing never loses history.
  runListEl.addEventListener('input', (e) => {
    const box = e.target.closest && e.target.closest('.log-search');
    if (!box) return;
    const card = box.closest('.run-card');
    const r = card && runs.get(card.dataset.runId);
    if (!r) return;
    scheduleLogSearch(r, () => {
      r.logFilter = readCardLogFilter(card, r);
      repaintFilteredLog(r);
    });
  });

  // Copy the VISIBLE log lines (what the filters and search left on screen).
  runListEl.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.log-copy');
    if (!btn) return;
    const card = btn.closest('.run-card');
    const r = card && runs.get(card.dataset.runId);
    if (!r) return;
    copyLogToClipboard(btn, r.logLines.filter(compileLogFilter(r.logFilter)));
  });
}

// The ONE source of the filter bar's markup is the run-card template; History
// clones it so the two bars can never drift (control order, classes, a11y).
function buildLogFilterBar() {
  return document.getElementById('run-card-tpl').content.querySelector('.log-filters').cloneNode(true);
}

// The ONE filter reader for both bars. The search box is read by PRESENCE, not
// truthiness: an empty box means the user cleared the term, which must win over
// the stored value; `prevSearch` only applies when the box is absent.
function readLogFilterFrom(root, prevSearch = '') {
  const searchEl = root.querySelector('.log-search');
  return {
    source: root.querySelector('.log-f-source')?.value || '',
    level: root.querySelector('.log-f-level')?.value || '',
    step: root.querySelector('.log-f-step')?.value || '',
    cycle: root.querySelector('.log-f-cycle')?.value || '',
    search: searchEl ? searchEl.value : prevSearch,
  };
}

// The ONE search debounce: state rides on `holder` so the delegated live-card
// path (per-run timer) and History's closure share the implementation.
function scheduleLogSearch(holder, fn) {
  clearTimeout(holder._logSearchTimer);
  holder._logSearchTimer = setTimeout(fn, LOG_SEARCH_DEBOUNCE_MS);
}

// Read a run card's whole log filter out of the DOM, carrying the run's stored
// search term as the fallback.
function readCardLogFilter(card, r) {
  return readLogFilterFrom(card, r.logFilter.search || '');
}

// Statistics: range segmented control + chart tooltip. Both are delegated, so
// they survive every replaceChildren() the loader does on #stats-body.
el.statsRange.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-range]');
  if (!btn) return;
  statsState.range = btn.dataset.range;
  loadStatsView();
});

const statsSection = document.querySelector('section[data-view="stats"]');
const statsTip = document.getElementById('stats-tip');
function showChartTip(target) {
  const tipText = target.dataset.tip || '';
  if (!tipText) return;
  statsTip.replaceChildren(...tipText.split('\n').map((line, i) =>
    Object.assign(document.createElement('div'),
      { className: i === 0 ? 'tip-head' : 'tip-val', textContent: line })));
  const r = target.getBoundingClientRect();
  statsTip.style.left = `${Math.round(r.left + r.width / 2)}px`;
  statsTip.style.top = `${Math.round(r.top - 8)}px`;
  statsTip.style.transform = 'translate(-50%, -100%)';
  statsTip.hidden = false;
}
statsSection.addEventListener('pointerover', (e) => {
  const hit = e.target.closest('.ch-hit');
  if (hit) showChartTip(hit);
});
statsSection.addEventListener('pointerout', (e) => {
  if (e.target.closest('.ch-hit')) statsTip.hidden = true;
});
statsSection.addEventListener('focusin', (e) => {
  const hit = e.target.closest('.ch-hit');
  if (hit) showChartTip(hit);
});
statsSection.addEventListener('focusout', (e) => {
  if (e.target.closest('.ch-hit')) statsTip.hidden = true;
});

// ---------------------------------------------------------------------------
// History
//
// The tab is driven entirely by GET /api/history (every project with pipelines
// on disk, onboarded or not). The project pills and per-project sticky sections
// are derived client-side from that single dataset; selecting a pill is a pure
// in-memory filter (no refetch). The chosen project is remembered for the
// History filter only — independent of the New-Pipeline project picker.
// ---------------------------------------------------------------------------
const HISTORY_FILTER_KEY = 'worca-cc.history.project'; // stores a projectKey; '' === All Projects

// Versioned localStorage cache for instant (stale-while-revalidate) first paint.
// Only stable FS + local-git skeleton fields are persisted — never the live `pr`
// (a gh fact that goes stale); Phase-2 fills PR state over the WS. Bump the .vN
// suffix on any shape change (there is no migration helper).
const HISTORY_CACHE_KEY = 'worca-cc.history.cache.v1';
const HISTORY_CACHE_VER = 1;
const HISTORY_CACHE_MAX = 500;   // cap persisted rows (rows are newest-first)

function readHistoryCache() {
  try {
    const raw = localStorage.getItem(HISTORY_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);                              // try/catch mirrors the ws parse guard
    if (!c || c.v !== HISTORY_CACHE_VER || !Array.isArray(c.pipelines)) {
      localStorage.removeItem(HISTORY_CACHE_KEY);           // version/shape bust -> forget the bad blob
      return null;
    }
    return c;
  } catch { localStorage.removeItem(HISTORY_CACHE_KEY); return null; }  // parse bust
}

function writeHistoryCache(pipelines, ghAvailable) {
  try {
    const slim = pipelines.slice(0, HISTORY_CACHE_MAX)
      .map(({ pr, retainedWork, ...rest }) => rest); // never persist live PR or retention facts
    localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(
      { v: HISTORY_CACHE_VER, ts: Date.now(), ghAvailable: !!ghAvailable, pipelines: slim }));
  } catch { /* quota / serialization: skip cache, never throw */ }
}

// Refresh re-fetches /api/history with force:true (bypass the cache, always show
// the spinner + re-trigger Phase 2). Other callers (showView/onHello) stay
// cache-first. The active filter is preserved (it lives in localStorage).
el.refreshHistory.addEventListener('click', () => loadHistoryView({ force: true }));

let historyLoadToken = 0;                 // monotonically increasing; newest wins (per-tab)
let historyInFlight = null;               // AbortController for the current skeleton fetch
let historyBooted = false;                // first-connect guard: background-load history once

async function loadHistoryView({ force = false } = {}) {
  const token = ++historyLoadToken;       // any earlier resolved fetch/push is now stale
  if (historyInFlight) { try { historyInFlight.abort(); } catch {} }
  const ac = new AbortController();
  historyInFlight = ac;

  // (A1) Instant paint from cache — UNLESS this is a force-refresh.
  if (!force) {
    const cached = readHistoryCache();
    if (cached) {
      state.historyAll = cached.pipelines;
      state.ghAvailable = cached.ghAvailable;
      restoreHistoryFilter();
      paintHistory();                     // instant; cards show Create-PR in its neutral state
    }
  }
  setHistoryLoading(true);                // spinner + disable Refresh

  let res, data;
  try {
    res = await fetch('/api/history', { signal: ac.signal });
    data = await safeJson(res);
  } catch (e) {
    if (e.name === 'AbortError') return;                 // superseded; newer load owns the spinner
    if (token !== historyLoadToken) return;
    if (!state.historyAll.length) renderHistoryError(e.message);  // else keep the stale paint
    setHistoryLoading(false);
    return;
  }
  if (token !== historyLoadToken) return;                // a newer load won the race -> drop
  if (!res.ok) {
    if (!state.historyAll.length) renderHistoryError((data && data.error) || `HTTP ${res.status}`);
    setHistoryLoading(false);
    return;
  }
  const pipelines = Array.isArray(data.pipelines) ? data.pipelines : [];
  state.historyAll = pipelines;
  state.ghAvailable = !!data.ghAvailable;
  restoreHistoryFilter();
  paintHistory();                                        // fresh skeleton repaint
  if (pipelines.length) writeHistoryCache(pipelines, data.ghAvailable);  // never cache empty/error
  requestHistoryPr(token);                               // Phase 2: ask server to push gh enrichment
  // NOTE: the spinner intentionally stays ON here; onHistoryPr (or the watchdog) clears it.
}

// Restore the remembered filter, but only if that project still has history;
// otherwise fall back to All Projects (the default).
function restoreHistoryFilter() {
  const saved = localStorage.getItem(HISTORY_FILTER_KEY) || '';
  state.historyFilter = saved && state.historyAll.some((p) => p && p.projectKey === saved) ? saved : '';
}

// Loading affordance for Refresh: disable + spin the button and mark the list
// aria-busy. Mirrors the per-button busy idiom in setupPrButton/setupHdActions.
function setHistoryLoading(on) {
  const btn = el.refreshHistory;                         // #refresh-history
  if (btn) { btn.disabled = !!on; btn.classList.toggle('busy', !!on); }
  if (el.history) el.history.setAttribute('aria-busy', on ? 'true' : 'false');
}

// Phase-2 trigger + WS handler. The spinner stays on through PR enrichment and is
// cleared by the final batch, a failed/!ok POST, or the per-token watchdog — so it
// provably always clears even if the WS `done` batch is never delivered.
const HISTORY_PR_TIMEOUT_MS = 15000;
let historyPrWatchdog = null;

function clearHistoryPrWatchdog() {
  if (historyPrWatchdog) { clearTimeout(historyPrWatchdog); historyPrWatchdog = null; }
}

function requestHistoryPr(token) {
  clearHistoryPrWatchdog();
  historyPrWatchdog = setTimeout(() => {                       // terminal fallback
    if (token === historyLoadToken) { finalizeHistoryPr(); setHistoryLoading(false); }
    historyPrWatchdog = null;
  }, HISTORY_PR_TIMEOUT_MS);
  // In Node-backed test runners the timer would keep the event loop alive; unref it
  // there. In a real browser setTimeout returns a number, so this is a no-op.
  if (historyPrWatchdog && typeof historyPrWatchdog.unref === 'function') historyPrWatchdog.unref();

  fetch('/api/history/pr', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  })
    .then((r) => { if (!r || !r.ok) throw new Error(`history-pr ${r ? r.status : 'failed'}`); })
    .catch(() => {                                             // network error OR !res.ok
      if (token === historyLoadToken) { finalizeHistoryPr(); setHistoryLoading(false); clearHistoryPrWatchdog(); }
    });
}

// Dispatched from handleServerMessage for {type:'history-pr'} frames.
function onHistoryPr(msg) {
  if (!msg || msg.token !== historyLoadToken) return;        // stale batch from a superseded load -> drop
  const items = Array.isArray(msg.items) ? msg.items : [];
  for (const it of items) patchHistoryPr(it);                // model + DOM, in place
  if (msg.done) { finalizeHistoryPr(); setHistoryLoading(false); clearHistoryPrWatchdog(); }  // final batch clears the spinner
}

// Escape a value for use inside a quoted attribute selector. Prefers CSS.escape;
// the fallback escapes the chars that would break `[attr="..."]`.
function cssEscape(s) {
  s = String(s == null ? '' : s);
  return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\\]]/g, '\\$&');
}

// Rebuild the .hist-pr node from the template so a re-patch (e.g. a Refresh after a
// link was already rendered) starts from the Create-PR BUTTON again: setupPrButton
// early-returns if it cannot find `.hist-pr` (a prior button->link swap did
// btn.replaceWith(link)), so that swap must be undone first. Cloning a fresh node
// also drops any click listener a prior setupPrButton attached.
// No merge half any more — the v2 card template has no `.hist-merge` (the pill is
// detail-only), so cloning one would throw on every PR patch. The fresh button is
// inserted BEFORE `.hist-open` so the chevron stays last in the aside.
function resetPrCluster(card) {
  const aside = card.querySelector('.hist-aside');
  if (!aside) return;
  const freshPr = $('#hist-card-tpl').content.querySelector('.hist-pr').cloneNode(true);
  const curPr = aside.querySelector('.hist-pr, .hist-pr-link');         // button OR the swapped-in link
  if (curPr) curPr.replaceWith(freshPr);
  else aside.insertBefore(freshPr, aside.querySelector('.hist-open'));
}

function patchHistoryPr({ projectKey, id, pr }) {
  // 1) Update the in-memory model (by id AND projectKey) so a later paintHistory()
  //    (e.g. a filter click) does NOT revert the card to its pr-less state.
  const row = state.historyAll.find((r) => r && r.id === id && r.projectKey === projectKey);
  if (row) row.pr = pr || null;

  // 1b) Keep an OPEN detail screen for this run in step. BEFORE the `!card`
  //     early-out below: the deep-link case this hook exists for is exactly the
  //     one where the matching list card is filtered off-screen.
  hdSyncPr(projectKey, id, row);

  // 2) Patch ONLY the matching live card in place. NEVER call paintHistory() here —
  //    a full repaint blows away expand state + the lazily-fetched stepper.
  const sel = `.hist-card[data-pipeline-id="${cssEscape(id)}"][data-project-key="${cssEscape(projectKey)}"]`;
  const card = el.history.querySelector(sel);
  if (!card) return;                                         // off-screen (filtered out) — model is enough
  resetPrCluster(card);
  setupPrButton(card, row?.projectDir || null, row || { id, projectKey, pr }, state.ghAvailable);
  // A MERGED enrichment retires the diff pill — merged work is already in the base
  // branch, so its line counts stop being the story.
  renderHistDiffPill(card.querySelector('.hist-diff-pill'), row || { id, projectKey, pr });
  // No setMergePill: clarification B — merged-or-not is shown by the link swap inside
  // setupPrButton (OPEN->"View PR", MERGED->"Merged"); the pill is detail-only now.
}

// Enrichment terminated (final WS batch, failed POST, or the watchdog): any entry
// still unresolved (pr === undefined) is treated as "no PR" so its control is
// revealed. Without this an eligible entry the server never sent a batch for — or a
// load where enrichment failed entirely — would stay hidden forever. Patches the
// visible card in place; off-screen rows get the model update and resolve on the
// next paint (e.g. a filter click). Callers already gate on the load token.
function finalizeHistoryPr() {
  for (const row of state.historyAll) {
    if (!row || row.pr !== undefined) continue;        // already resolved (object or null)
    row.pr = null;                                      // resolved: no open/merged PR
    // Same reason as in patchHistoryPr: before the `!card` continue, or a
    // deep-linked eligible run keeps `pr === undefined` and never offers Create PR.
    hdSyncPr(row.projectKey, row.id, row);
    const sel = `.hist-card[data-pipeline-id="${cssEscape(row.id)}"][data-project-key="${cssEscape(row.projectKey)}"]`;
    const card = el.history.querySelector(sel);
    if (!card) continue;                                // off-screen — model update is enough
    resetPrCluster(card);
    setupPrButton(card, row.projectDir || null, row, state.ghAvailable);
    renderHistDiffPill(card.querySelector('.hist-diff-pill'), row);
  }
}

// Distinct projects present in the dataset, in most-recent-activity order
// (listAllPipelines is newest-first, so first encounter === most recent pipeline).
function historyProjects() {
  const seen = new Map(); // projectKey -> { key, name, count, workspace }
  for (const p of state.historyAll) {
    if (!p || !p.projectKey) continue;
    const cur = seen.get(p.projectKey);
    if (cur) cur.count += 1;
    else {
      const isWs = p.target === 'workspace';
      // Workspace rows (projectKey="workspaces/<key>") prefer the workspace name.
      const name = isWs ? (p.workspaceName || p.projectName || p.projectKey) : (p.projectName || p.projectKey);
      seen.set(p.projectKey, { key: p.projectKey, name, count: 1, workspace: isWs });
    }
  }
  return [...seen.values()];
}

// The pinned pills toolbar has a dynamic height (pills wrap on narrow widths),
// so measure it and expose it as --hist-toolbar-h on the History view. The
// per-project sticky header reads it (top:var(--hist-toolbar-h)) to sit exactly
// below the toolbar instead of behind it.
let histToolbarRO = null;
function syncHistToolbarHeight() {
  const tb = el.historyFilter;
  if (!tb) return;
  const view = tb.closest('.view');
  if (view) view.style.setProperty('--hist-toolbar-h', tb.offsetHeight + 'px');
}
function ensureHistToolbarObserver() {
  // window.ResizeObserver matches the existing usage at app.js:766; absent under
  // jsdom, where the typeof guard makes this a no-op (offsetHeight is 0 there).
  if (histToolbarRO || !el.historyFilter || typeof ResizeObserver === 'undefined') return;
  histToolbarRO = new window.ResizeObserver(() => syncHistToolbarHeight());
  histToolbarRO.observe(el.historyFilter);
}

// Build the pill row: "All Projects" + one pill per project. Clicking sets the
// filter, persists it, and repaints.
function renderHistoryPills() {
  const host = el.historyFilter;
  if (!host) return;
  host.innerHTML = '';

  const mkPill = (key, label, count, isWs = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    const active = state.historyFilter === key;
    b.className = 'hist-pill' + (isWs ? ' ws' : '') + (active ? ' active' : '');
    b.dataset.projectKey = key;
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
    const txt = document.createElement('span');
    txt.textContent = label;
    b.appendChild(txt);
    b.appendChild(document.createTextNode(' ')); // keep label/count separable in textContent
    const c = document.createElement('span');
    c.className = 'pill-count';
    c.textContent = String(count);
    b.appendChild(c);
    b.addEventListener('click', () => setHistoryFilter(key));
    return b;
  };

  host.appendChild(mkPill('', 'All Projects', state.historyAll.length));
  for (const pr of historyProjects()) host.appendChild(mkPill(pr.key, pr.name, pr.count, pr.workspace));

  // Keep the sticky project header offset in sync with the toolbar's height
  // (also re-measures on resize, when pills wrap to more/fewer rows).
  ensureHistToolbarObserver();
  syncHistToolbarHeight();
}

// Switch the active project filter, persist it (so it survives reloads), repaint.
// Selecting All Projects clears the memory (the default needs no stored value).
function setHistoryFilter(key) {
  state.historyFilter = key || '';
  if (state.historyFilter) localStorage.setItem(HISTORY_FILTER_KEY, state.historyFilter);
  else localStorage.removeItem(HISTORY_FILTER_KEY);
  paintHistory();
}

// Repaint pills + the list from the in-memory dataset (no refetch).
function paintHistory() {
  // If the active filter's project is gone (e.g. its last pipeline was just
  // deleted in this session), fall back to All Projects so the view never
  // strands on an empty, unselectable filter.
  if (state.historyFilter && !state.historyAll.some((p) => p && p.projectKey === state.historyFilter)) {
    state.historyFilter = '';
    localStorage.removeItem(HISTORY_FILTER_KEY);
  }
  renderHistoryPills();
  renderHistory();
  // An open detail screen re-reads its (possibly late-arriving, possibly mutated)
  // list row from the same dataset. No-op when no detail is open.
  refreshHdFromRow();
}

// Render #history from state.historyAll filtered by state.historyFilter.
//   All Projects ('')  -> per-project sections, each with a sticky header.
//   A specific project -> flat list (the active pill already names the project).
function renderHistory() {
  const host = el.history;
  host.innerHTML = '';
  const all = Array.isArray(state.historyAll) ? state.historyAll : [];

  // A finished-but-unacknowledged pipeline (lingerer) AND a paused pipeline both
  // live ONLY in the Running list — suppress them from History by pipelineId so
  // they don't double-show. A lingerer reappears in History once acknowledged; a
  // paused run reappears (as the resumed/finished record) once resumed or stopped.
  const hiddenPids = new Set(
    [...runs.values()]
      .filter((r) => (isLingering(r) || isPaused(r)) && r.pipelineId)
      .map((r) => r.pipelineId)
  );
  const visible = hiddenPids.size ? all.filter((p) => !hiddenPids.has(p.id)) : all;

  const filter = state.historyFilter;
  const records = filter ? visible.filter((p) => p && p.projectKey === filter) : visible;

  // Sidebar count is the TOTAL across all projects, independent of the in-view project
  // filter (product decision): a filter pill changes the list, not the badge. `all` is
  // state.historyAll (raw /api/history = listAllPipelines, all statuses) so all.length
  // === COUNT(*) FROM pipelines === /api/counts.pipelines.
  if (el.navHistoryCount) el.navHistoryCount.textContent = String(all.length);

  if (!records.length) {
    host.appendChild(histEmpty(filter ? 'No saved pipelines for this project yet.' : 'No saved pipelines yet.'));
    return;
  }

  if (filter) {
    for (const p of records) host.appendChild(buildHistCard(p.projectDir || null, p, state.ghAvailable));
    return;
  }

  // All Projects: bucket by projectKey, preserving the newest-first group order.
  const groups = new Map(); // key -> { name, items: [] }
  for (const p of records) {
    const key = p && p.projectKey ? p.projectKey : '';
    let g = groups.get(key);
    if (!g) {
      // Workspace rows prefer the workspace name for the section header.
      const name = (p && p.target === 'workspace' && p.workspaceName)
        || (p && p.projectName) || key || '(unknown project)';
      g = { name, items: [] };
      groups.set(key, g);
    }
    g.items.push(p);
  }
  for (const g of groups.values()) host.appendChild(buildHistGroup(g));
}

// One per-project section: a sticky, non-collapsible header + that project's cards.
function buildHistGroup(group) {
  const wrap = document.createElement('section');
  wrap.className = 'hist-group';

  const head = document.createElement('div');
  head.className = 'hist-group-head';
  const name = document.createElement('span');
  name.textContent = group.name;
  const count = document.createElement('span');
  count.className = 'pill-count';
  count.textContent = String(group.items.length);
  head.append(name, ' ', count); // space keeps name/count separable in textContent
  wrap.appendChild(head);

  for (const p of group.items) wrap.appendChild(buildHistCard(p.projectDir || null, p, state.ghAvailable));
  return wrap;
}

// One row of the history empty/error state — a DIV (never an <li>).
function histEmpty(text) {
  const div = document.createElement('div');
  div.className = 'hist-empty';
  div.textContent = text;
  return div;
}

// Wire the list card's Create-PR button. Eligibility is `histPrEligible` (shared
// with the detail screen); a click navigates to the detail page and arms the
// "Ship it?" modal rather than POSTing from here. No `.hist-merge` lookup — the
// mergeability pill is detail-only now.
function setupPrButton(node, projectDir, p, ghAvailable) {
  const btn = node.querySelector('.hist-pr');
  if (!btn) return;

  // A PR already open or merged for this branch -> never offer "Create PR";
  // replace the button with a link to that existing PR (reusing gh's URL). This
  // runs BEFORE the `survived` eligibility check, so a merged PR whose branch was
  // deleted (survived === false) still shows a "Merged" link.
  const pr = p.pr && typeof p.pr === 'object' ? p.pr : null;
  const prState = pr ? String(pr.state || '').toUpperCase() : '';
  if (pr && (prState === 'OPEN' || prState === 'MERGED') && pr.url) {
    const link = document.createElement('a');
    link.className = prState === 'MERGED' ? 'hist-pr-link merged' : 'hist-pr-link';
    link.href = pr.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = prState === 'MERGED' ? 'Merged' : 'View PR';
    // Clicking the link must not toggle the surrounding history card.
    link.addEventListener('click', (e) => e.stopPropagation());
    btn.replaceWith(link);
    return;
  }

  // ONE shared predicate with paintHdPr and the pendingShipIt consumer. It adds the
  // workspace clause the open-coded gate was missing: POST /api/pr has no workspace
  // arm and its key regex rejects a `workspaces/…` composite with a 404, so offering
  // "Create PR" there could only ever end in a failed ship. `ghAvailable` stays a
  // parameter (the three call sites keep passing it) — the GATE reads state itself.
  if (!histPrEligible(p)) { btn.hidden = true; return; }

  // PR state not yet resolved for this entry (Phase-2 enrichment still in flight).
  // Keep the button hidden instead of flashing "Create PR" on an entry that may
  // already have an OPEN/MERGED PR. patchHistoryPr (per-entry result) or
  // finalizeHistoryPr (terminal) re-runs this with a resolved pr — object or null —
  // and reveals the correct control. Tri-state on entry.pr:
  //   undefined = pending, null = looked/none, object = found.
  if (p.pr === undefined) { btn.hidden = true; return; }

  btn.hidden = false;
  // The list card never fires the PR call itself: it hands the intent to the detail
  // screen, which owns the "Ship it?" confirm modal and every PR control from here on.
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); // never let the whole-card navigation double-fire
    pendingShipIt = { id: p.id, projectKey: p.projectKey };
    location.hash = `history/${histDetailParam(p)}`;
  });
}

// A history entry is deletable only when finished (never while live/running/
// created/pausing — the server 409s a pausing delete; this hides the button).
function isDeletableEntry(p) {
  if (!p || p.live) return false;
  const s = String(p.status || '').toLowerCase();
  return !['running', 'starting', 'created', 'pausing'].includes(s);
}

function runActionQuery(projectDir, p) {
  const qs = new URLSearchParams();
  if (p.target === 'workspace' && typeof p.projectKey === 'string') {
    qs.set('workspaceId', p.projectKey.replace(/^workspaces\//, ''));
  } else if (p.projectKey) {
    qs.set('projectKey', p.projectKey);
  } else {
    qs.set('projectDir', p.projectDir || projectDir);
  }
  return qs;
}

function shellSingleQuote(value) {
  return `'${String(value == null ? '' : value).replaceAll("'", "'\"'\"'")}'`;
}

// Paint both the collapsed warning badge and the expanded manual-recovery
// instructions. Every value is assigned through textContent: git stderr and
// repository paths are data, never markup.
function renderRetainedWork(node, p) {
  const retained = p && p.retainedWork;
  const members = Array.isArray(retained?.members) ? retained.members : [];
  const badge = node.querySelector('.hist-retained-badge');
  if (badge) badge.hidden = !members.length;
  const banner = node.querySelector('.retained-banner');
  if (!banner || !members.length) {
    if (banner) banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.innerHTML = '';
  const title = document.createElement('h4');
  title.textContent = 'Commit failed — uncommitted work retained';
  const intro = document.createElement('p');
  intro.textContent = 'The pipeline result is unchanged, but this work is not safely stored on the branch yet. Commit it manually, or save a recovery patch and discard the worktree below.';
  const list = document.createElement('ul');
  for (const member of members) {
    const li = document.createElement('li');
    const label = document.createElement('strong');
    label.textContent = member.projectKey || member.branch || 'Project';
    li.appendChild(label);
    const detail = document.createElement('span');
    detail.textContent = ` — git ${member.step || 'commit'}: ${member.message || 'failed'}`;
    li.appendChild(detail);
    const path = document.createElement('div');
    path.textContent = `Worktree: ${member.worktreeDir || '(unknown)'}`;
    li.appendChild(path);
    if (member.branch) {
      const branch = document.createElement('div');
      branch.textContent = `Branch: ${member.branch} (the uncommitted work is not on it yet)`;
      li.appendChild(branch);
    }
    const command = document.createElement('code');
    command.textContent = `git -C ${shellSingleQuote(member.worktreeDir)} status\ngit -C ${shellSingleQuote(member.worktreeDir)} add -A\ngit -C ${shellSingleQuote(member.worktreeDir)} commit`;
    li.appendChild(command);
    list.appendChild(li);
  }
  const archiveNote = document.createElement('p');
  archiveNote.textContent = 'Archive is disabled until the retained worktree has been recovered or discarded.';
  const clearNote = document.createElement('p');
  clearNote.textContent = 'After committing manually, use "Discard worktree" to remove the now-redundant checkout and clear this warning (a patch of anything still uncommitted is saved first). Your changes are already staged in that checkout, so git status will list them under "Changes to be committed".';
  banner.append(title, intro, list, archiveNote, clearNote);
}

function addRecoveryPatchLink(node, projectDir, p, artifacts) {
  const banner = node.querySelector('.retained-banner');
  if (!banner || banner.hidden || !Array.isArray(artifacts)) return;
  const retained = artifacts.some((a) => a && a.kind === 'retained-work-patch');
  const diff = artifacts.some((a) => a && a.kind === 'diff-patch');
  if (!retained && !diff) return;
  if (banner.querySelector('.retained-patch-link')) return;
  const line = document.createElement('p');
  line.className = 'retained-patch-link';
  line.appendChild(document.createTextNode('Alternate recovery: '));
  const link = document.createElement('a');
  link.href = `/api/runs/${encodeURIComponent(p.id)}/recovery-patch?${runActionQuery(projectDir, p)}`;
  link.download = retained ? `retained-work-${p.id}.patch` : `diff-patch-${p.id}.patch`;
  link.textContent = retained
    ? 'download the recovery patch (snapshot taken when the work was retained)'
    : 'download the pipeline diff patch';
  link.addEventListener('click', (e) => e.stopPropagation());
  line.appendChild(link);
  banner.appendChild(line);
}

function setupDiscardWorktreeButton(node, projectDir, p) {
  const btn = node.querySelector('.hist-discard');
  if (!btn) return;
  const retained = p && p.retainedWork;
  const members = Array.isArray(retained?.members) ? retained.members : [];
  btn.hidden = !members.length;
  if (!members.length) return;
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const msg = 'Discard the retained worktree?\n\nAny work NOT yet committed exists only in the retained worktree; a recovery patch of uncommitted changes will be saved in the pipeline directory before anything is removed. If you already committed the work manually, discarding just removes the now-redundant checkout and clears the warning. The pipeline history and feature branch are kept.\n\nContinue?';
    if (!window.confirm(msg)) return;
    btn.disabled = true;
    const previous = btn.textContent;
    btn.textContent = 'Saving patch…';
    try {
      const qs = runActionQuery(projectDir, p);
      const res = await fetch(`/api/runs/${encodeURIComponent(p.id)}/discard-worktree?${qs}`, { method: 'POST' });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      if (data.remaining > 0) {
        // Partial failure: the checkout is still on disk, so the retained state
        // is still true — repaint nothing away, tell the user what happened.
        btn.disabled = false;
        btn.textContent = previous;
        showViewer('Discard incomplete',
          'The retained worktree could not be fully removed:\n\n' +
          `${Array.isArray(data.warnings) && data.warnings.length ? data.warnings.join('\n') : 'unknown error'}\n\n` +
          'The retained-work warning stays until the checkout is gone.');
        return;
      }
      p.retainedWork = null;
      writeHistoryCache(state.historyAll, state.ghAvailable);
      paintHistory();
      const paths = Array.isArray(data.patches) ? data.patches : [];
      showViewer('Retained worktree discarded', paths.length
        ? `Recovery patch${paths.length === 1 ? '' : 'es'} saved before removal:\n\n${paths.join('\n')}`
        : 'No recovery patch was needed (nothing uncommitted remained to save); the retained checkout is gone.');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = previous;
      btn.title = `Could not discard retained worktree: ${err.message}`;
    }
  });
}

// Resume a paused pipeline from its history card. POST /api/resume returns the
// new live runId; the run announces itself over the WS — mirror beginRun's
// post-launch block so the user lands on the live card immediately.
// Statuses that count as "parked, resumable" for the cost-pause note.
const PAUSED_STATUSES = ['paused', 'pausing', 'interrupted'];

// Disable a history Resume button while a total-budget pause is still blocked by
// the current window. Shared by setupHdActions (first paint) and
// refreshHistResumeGating (every later budget change).
function applyHistResumeGate(btn, pauseReason, budget) {
  const totalBlocked = pauseReason === 'cost_total' && !!(budget && budget.blocked);
  btn.disabled = totalBlocked;
  btn.title = totalBlocked
    ? `Total budget reached — blocked until ${fmtResetAtLocal(budget.windowEndMs)} or a higher total limit`
    : '';
}

// Re-gate the mounted history Resume button from the dataset.pauseReason stamp
// paintHdBanners left behind, so a budget change unblocks it without a refetch.
// Detail-screen roots ONLY: Resume left the list card with the accordion.
function refreshHistResumeGating() {
  const roots = el.histDetail ? [...el.histDetail.querySelectorAll('.hd')] : [];
  for (const root of roots) {
    const btn = root.querySelector('.hd-resume');
    if (!btn || btn.hidden) continue;
    // An IN-FLIGHT resume owns its button outright: applyHistResumeGate would
    // re-enable it mid-POST (second click = second POST /api/resume).
    if (btn.dataset.resumeState === 'busy') continue;
    // A FAILED one does not get to opt out of budget gating for the life of the
    // screen (the detail screen is never rebuilt, and nothing clears the flag) —
    // otherwise a `cost_total` block that lands later leaves the button enabled and
    // the user clicks into a guaranteed 403. Re-gate, then restore the D3 error
    // title when gating did not take the button away.
    applyHistResumeGate(btn, root.dataset.pauseReason || '', budgetState.budget);
    if (btn.dataset.resumeState === 'error' && btn.dataset.resumeError && !btn.disabled) {
      btn.title = btn.dataset.resumeError;
    }
  }
}

// cb-override from the History detail screen: same confirmation as the Running
// card, then resumePipeline's POST -> upsert -> land-on-the-live-card recipe
// with the persistent per-pipeline cap override.
async function histCostOverride(projectDir, id, record, btn) {
  const ok = await confirmModal({ ...COST_OVERRIDE_CONFIRM });
  if (!ok) return;
  // `id` is spread ON TOP of the record, not used as a fallback: resumePipeline
  // POSTs `p.id`, so `resumePipeline(record || { id }, …)` would silently ignore
  // the explicit parameter whenever `record` is truthy and make the signature lie.
  await resumePipeline({ ...(record || {}), id }, projectDir, btn, { ignoreCostCap: true });
}

// Paint the post-PR mergeability pill. MERGEABLE -> green, CONFLICTING -> red,
// UNKNOWN -> amber "checking…" (GitHub computes mergeability asynchronously).
function setMergePill(el, mergeable) {
  const m = String(mergeable || 'UNKNOWN').toUpperCase();
  el.hidden = false;
  if (m === 'MERGEABLE') { el.className = 'hist-merge ok'; el.textContent = 'can merge'; }
  else if (m === 'CONFLICTING') { el.className = 'hist-merge bad'; el.textContent = 'conflicts'; }
  else { el.className = 'hist-merge unknown'; el.textContent = 'merge: checking…'; }
}

// GitHub computes PR mergeability asynchronously, so a freshly-opened PR comes back
// UNKNOWN ("merge: checking…"). Re-check ONCE after a short pause and either update
// the pill (MERGEABLE/CONFLICTING) or hide it (still unknown) — never leave it stuck.
const PR_MERGE_RECHECK_MS = 4000;
// Test seam: jsdom specs set window.__prMergeRecheckMs = 0 to fire on the next tick
// (mirrors the window.__ws / window.__np hooks; this repo uses no fake timers).
function prMergeRecheckMs() {
  const o = Number(window.__prMergeRecheckMs);
  return Number.isFinite(o) && o >= 0 ? o : PR_MERGE_RECHECK_MS;
}

function scheduleMergeRecheck(mergeEl, body) {
  const t = setTimeout(async () => {
    if (!mergeEl || !mergeEl.isConnected) return;   // a Refresh rebuilt the card — stale timer no-ops
    let mergeable = 'UNKNOWN';
    try {
      const res = await fetch('/api/pr/mergeable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await safeJson(res);               // safeJson -> {} on non-JSON, never null
      if (res.ok && data) mergeable = data.mergeable;
    } catch { /* network error -> treat as still unknown -> hide below */ }
    if (!mergeEl.isConnected) return;                 // a Refresh during the await -> no-op
    const m = String(mergeable || 'UNKNOWN').toUpperCase();
    if (m === 'MERGEABLE' || m === 'CONFLICTING') setMergePill(mergeEl, m);
    else mergeEl.hidden = true;                        // still checking -> drop the stuck pill
  }, prMergeRecheckMs());
  // Node test runner: the timer keeps the loop alive; unref it where supported.
  // Real browser setTimeout returns a number (no .unref) -> the guard makes this a no-op.
  if (t && typeof t.unref === 'function') t.unref();
}

// Build one history card from a (disk or live) record. The card is a LINK: the
// whole head navigates to the detail screen (#history/<projectKey>/<id>); it never
// expands in place. Interactive descendants (title, copy, Create PR) opt out.
function buildHistCard(projectDir, p, ghAvailable = false) {
  const tpl = $('#hist-card-tpl');
  const node = tpl.content.firstElementChild.cloneNode(true);
  const id = p.id || '';
  // patchHistoryPr / finalizeHistoryPr locate cards by BOTH stamps.
  node.dataset.pipelineId = id;
  node.dataset.projectKey = p.projectKey || '';

  paintHistStatusIcon(node.querySelector('.hist-sic'), p);
  const { word, family } = histStatusMeta(p);
  const wordEl = node.querySelector('.hist-status-word');
  wordEl.textContent = word;
  wordEl.className = `hist-status-word st-${family}`;

  const titleEl = node.querySelector('.h-meta b');
  titleEl.textContent = p.title || id || '(untitled)'; // project shown by the pill / section header
  titleEl.addEventListener('click', (e) => { e.stopPropagation(); viewPipeline(projectDir, id, p.title, p); });
  const src = sourceBadge(p);   // provenance sits in the META line (null for prompt/markdown rows)
  if (src) node.querySelector('.hist-meta-line').appendChild(src);

  const { day, clock } = splitDateStamp(p.startedAt || p.mtime);
  const seg = (name, text) => {
    const wrapEl = node.querySelector(`.hist-${name}-seg`);
    if (!text) { wrapEl.hidden = true; return; }
    node.querySelector(`.hist-${name}`).textContent = text;
  };
  seg('day', day);
  seg('clock', clock);
  seg('time', typeof p.totalActiveMs === 'number' ? fmtDuration(p.totalActiveMs) : '');
  seg('total', typeof p.totalCostUsd === 'number' ? fmtUsd(p.totalCostUsd) : '');
  if (typeof p.totalCostUsd === 'number') node.querySelector('.hist-total').title = estTitle(p.totalCostUsd);

  renderHistDiffPill(node.querySelector('.hist-diff-pill'), p);

  // Branch line: "source → destination" plus a copy button for the destination.
  // Legacy rows may lack sourceBranch — then the source half (and arrow) stays
  // hidden; no destination hides the whole row.
  const branchEl = node.querySelector('.hist-branch');
  const feature = p.branch || '';
  const source = p.sourceBranch || '';
  branchEl.hidden = !feature;
  branchEl.querySelector('.hist-branch-dst').textContent = feature;
  const srcEl = branchEl.querySelector('.hist-branch-src');
  srcEl.textContent = source;
  srcEl.hidden = !source;
  // SVG elements have no `hidden` IDL property (HTMLElement-only) — assigning
  // `.hidden` would set a dead expando and leave the attribute in place.
  branchEl.querySelector('.hist-branch-arrow').toggleAttribute('hidden', !source);
  const copyBtn = branchEl.querySelector('.hist-branch-copy');
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // copy must not navigate to the detail screen
    copyBranchToClipboard(copyBtn, feature);
  });

  // Pause note. Resume + its budget gating live on the detail page now; the
  // dataset stamp survives for parity/debugging.
  const pauseReason = typeof p.pauseReason === 'string' ? p.pauseReason : '';
  if (pauseReason) node.dataset.pauseReason = pauseReason;
  const noteEl = node.querySelector('.hist-pausenote');
  const costPaused = PAUSED_STATUSES.includes(String(p.status || '').toLowerCase())
    && pauseReason.startsWith('cost_');
  noteEl.hidden = !costPaused;
  noteEl.textContent = costPaused
    ? (pauseReason === 'cost_total' ? 'paused · total budget' : 'paused · cost limit') : '';
  noteEl.classList.toggle('total', costPaused && pauseReason === 'cost_total');

  renderRetainedWork(node, p);           // badge only — the card has no banner node
  setupPrButton(node, projectDir, p, ghAvailable);

  // Whole-card click -> detail page. Interactive descendants opt out.
  const go = () => {
    histReturnFocus = { id: p.id, projectKey: p.projectKey };   // Esc/Back come home here
    location.hash = `history/${histDetailParam(p)}`;
  };
  const head = node.querySelector('.hist-head');
  head.addEventListener('click', (e) => {
    if (e.target.closest('button, a')) return;
    go();
  });
  head.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') && !e.target.closest('button, a')) {
      e.preventDefault();
      go();
    }
  });
  node.querySelector('.hist-open').addEventListener('click', (e) => { e.stopPropagation(); go(); });
  return node;
}

// Diff pill: merged PR -> hidden ("the diff is no longer the story"); survived
// with changes -> +A −R; survived with none -> "no diff"; branch gone -> hidden.
// NOTE: the minus glyph is U+2212 (−), not an ASCII hyphen; the jsdom test
// asserts it byte-for-byte, so keep this exact character.
function renderHistDiffPill(pill, p) {
  if (!pill) return;
  const merged = p && p.pr && typeof p.pr === 'object' && String(p.pr.state || '').toUpperCase() === 'MERGED';
  if (!p || !p.survived || merged) { pill.hidden = true; return; }
  pill.hidden = false;
  const added = Number.isFinite(+p.added) ? +p.added : 0;
  const removed = Number.isFinite(+p.removed) ? +p.removed : 0;
  const diffEl = pill.querySelector('.hist-diff');
  const noneEl = pill.querySelector('.hist-nodiff');
  const has = added > 0 || removed > 0;
  noneEl.hidden = has;
  diffEl.hidden = !has;
  diffEl.textContent = '';
  if (has) {
    const add = document.createElement('span'); add.className = 'diff-add'; add.textContent = `+${added}`;
    const del = document.createElement('span'); del.className = 'diff-del'; del.textContent = `−${removed}`; // U+2212
    diffEl.append(add, ' ', del);
    pill.title = `${added} added, ${removed} removed vs ${p.sourceBranch || 'source'}`;
  }
}

// Resolve the saved-pipeline detail URL ({state, auditMarkdown}) for a history
// record. A workspace run (target==='workspace', projectKey="workspaces/<wkey>")
// MUST use the workspace-aware route — the /api/history/:key/:id key regex
// forbids the slashed key (would 404). The two routes share readPipelineFromDir,
// so the response shape is identical. Single-project rows are byte-identical.
function historyDetailUrl(projectDir, id, record) {
  if (record && record.target === 'workspace' && typeof record.projectKey === 'string') {
    const wksId = record.projectKey.replace(/^workspaces\//, '');
    return `/api/workspaces/${encodeURIComponent(wksId)}/runs/${encodeURIComponent(id)}`;
  }
  if (record && record.projectKey) {
    return `/api/history/${encodeURIComponent(record.projectKey)}/${encodeURIComponent(id)}`;
  }
  return `/api/runs/${encodeURIComponent(id)}?projectDir=${encodeURIComponent(projectDir)}`;
}

function historyLogUrl(id, record) {
  if (record && record.target === 'workspace' && typeof record.projectKey === 'string') {
    const wksId = record.projectKey.replace(/^workspaces\//, '');
    return `/api/workspaces/${encodeURIComponent(wksId)}/runs/${encodeURIComponent(id)}/log`;
  }
  // History cards always carry projectKey; the Live-logs bar only renders when a
  // `live-log` artifact is present in the (already-fetched) detail payload, which
  // implies a valid project/workspace key path. No /api/runs/:id/log fallback exists.
  const key = record && record.projectKey ? record.projectKey : '';
  return `/api/history/${encodeURIComponent(key)}/${encodeURIComponent(id)}/log`;
}

// Twin of historyLogUrl with /diff instead of /log. There is deliberately NO
// /api/runs/:id?projectDir= fallback — parity with logs (spec §7).
function historyDiffUrl(id, record) {
  if (record && record.target === 'workspace' && typeof record.projectKey === 'string') {
    const wksId = record.projectKey.replace(/^workspaces\//, '');
    return `/api/workspaces/${encodeURIComponent(wksId)}/runs/${encodeURIComponent(id)}/diff`;
  }
  const key = record && record.projectKey ? record.projectKey : '';
  return `/api/history/${encodeURIComponent(key)}/${encodeURIComponent(id)}/diff`;
}

// Build a <ul class="issues"> from merged check/finding rows (mirrors renderGateBody).
function issueList(rows) {
  const ul = document.createElement('ul'); ul.className = 'issues';
  rows.forEach((c) => {
    const li = document.createElement('li'); li.className = `issue sev-${c.severity}`;
    const head = document.createElement('div'); head.className = 'issue-head';
    const sev = document.createElement('span'); sev.className = 'issue-sev'; sev.textContent = c.severity;
    head.appendChild(sev);
    if (c.origin) {
      const tag = document.createElement('span'); tag.className = `issue-origin origin-${c.origin}`;
      tag.textContent = c.origin === 'agent' ? (c.isNew ? 'agent · new' : 'agent') : 'review';
      head.appendChild(tag);
    }
    const ttl = document.createElement('span'); ttl.className = 'issue-title'; ttl.textContent = c.title;
    head.appendChild(ttl); li.appendChild(head);
    if (c.detail) { const d = document.createElement('div'); d.className = 'issue-detail'; d.textContent = c.detail; li.appendChild(d); }
    if (c.location) { const l = document.createElement('div'); l.className = 'issue-loc'; l.textContent = c.location; li.appendChild(l); }
    ul.appendChild(li);
  });
  return ul;
}

// Fetch the persisted NDJSON and render each line with the SAME buildLogLine() the
// live panel uses, so persisted logs look identical to live ones — including the
// same source/level/step filter bar as the live card.
async function loadLiveLogs(panel, logUrl) {
  const bar = buildLogFilterBar();
  const box = document.createElement('div');
  box.className = 'log';
  panel.innerHTML = '';
  panel.append(bar, box);
  try {
    const res = await fetch(logUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const recs = [];
    for (const raw of text.split('\n')) {
      const t = raw.trim();
      if (!t) continue;
      let rec;
      try { rec = JSON.parse(t); } catch { continue; } // skip a torn final line
      recs.push(projectLogRecord(rec));
    }
    const filter = { source: '', level: '', step: '', cycle: '', search: '' };
    const paint = () => {
      box.innerHTML = '';
      const visible = compileLogFilter(filter);
      const matches = recs.filter(visible);
      // Tail-render: the History NDJSON is uncapped and every debounce tick
      // repaints — bound the DOM like the live card. Copy keeps ALL matches.
      const shown = matches.length > MAX_LOG_LINES ? matches.slice(-MAX_LOG_LINES) : matches;
      const frag = document.createDocumentFragment();
      if (shown.length < matches.length) {
        const note = document.createElement('div');
        note.className = 'hint';
        note.textContent = `(showing the last ${shown.length} of ${matches.length} matching lines — copy takes all ${matches.length})`;
        frag.appendChild(note);
      }
      let prevCycle = null;
      for (const rec of shown) prevCycle = appendLogRec(frag, rec, prevCycle);
      box.appendChild(frag);
      if (matches.length === 0) box.textContent = recs.length ? '(no lines match the filter)' : '(no log lines)';
    };
    const facets = logFacets(recs);
    fillFilterSelect(bar.querySelector('.log-f-source'), 'all sources', facets.sources, '');
    fillFilterSelect(bar.querySelector('.log-f-level'), 'all levels', facets.levels, '');
    fillFilterSelect(bar.querySelector('.log-f-step'), 'all steps', facets.steps, '', (i) => `step ${i + 1}`);
    fillFilterSelect(bar.querySelector('.log-f-cycle'), 'all cycles', facets.cycles, '', (c) => `cycle ${c}`);
    // The search box also carries `log-f`, so the guard is select-only: a
    // keystroke must not take the change path's undebounced repaint.
    bar.addEventListener('change', (e) => {
      if (!(e.target.closest && e.target.closest('select.log-f'))) return;
      Object.assign(filter, readLogFilterFrom(bar, filter.search));
      paint();
    });
    const searchHolder = {};
    bar.querySelector('.log-search').addEventListener('input', () => {
      scheduleLogSearch(searchHolder, () => { Object.assign(filter, readLogFilterFrom(bar, filter.search)); paint(); });
    });
    bar.querySelector('.log-copy').addEventListener('click', (e) => {
      copyLogToClipboard(e.target.closest('.log-copy'), recs.filter(compileLogFilter(filter)));
    });

    paint();
  } catch (e) {
    box.textContent = `Could not load logs: ${e.message}`;
    panel.dataset.loaded = ''; // allow a retry on the next open
  }
}

// Per-node max cycle from a saved run's steps[] (history's loop-count source).
function histNodeCycle(st) {
  const out = {};
  for (const s of Array.isArray(st && st.steps) ? st.steps : []) {
    if (!s) continue;
    const key = stepBucketKey(s);
    const c = Number(s.cycle);
    if (key && Number.isFinite(c)) out[key] = Math.max(out[key] || 0, c);
  }
  return out;
}

// Tint a history card's graph from saved state. Reached cell drives coloring
// (no live events). activeId=null, live=false -> no glow/marching-ants.
function paintHistStepper(detail, st) {
  const host = detail.querySelector('.run-flow');
  if (!host) return;
  const manifest = manifestFor(st.stepper);
  const status = String(st.status || '').toLowerCase();
  const halted = status === 'stopped' || status === 'error' || status === 'aborted' || status === 'failed' || status === 'interrupted';
  const isDone = status === 'done' || status === 'complete' || status === 'completed';
  const reached = histReachedCell(manifest, st);
  const durs = durByNode(st.steps, 0, false);
  const costs = costByNode(st.steps);
  const modelsUsed = modelUsedByNode(st.steps);

  const cellOf = {};
  manifest.steps.forEach((cell, i) => cell.nodes.forEach((n) => { cellOf[n.id] = i; }));

  paintRunGraph(host, manifest, {
    statusOf: (id) => {
      const cellIdx = cellOf[id] != null ? cellOf[id] : -1;
      if (isDone) return 'done';
      if (cellIdx < reached) return 'done';
      if (cellIdx === reached) return halted ? 'stopped' : 'done';
      return 'pending';
    },
    activeId: null,
    cycles: loopCounts(manifest, histNodeCycle(st)),
    live: false,
    durText: (id) => { const d = durs[id]; return d != null ? fmtDuration(d) : ''; },
    costText: (id) => { const c = costs[id]; return c != null ? fmtUsd(c) : ''; },
    subsOf: (id) => subAgentsForNode(st, id),
    modelUsedOf: (id) => modelsUsed[id],
  });
}

// Highest cell index the saved run reached. Uses steps[].nodeId when present
// (new runs), else the scalar phase mapped through the manifest (old runs).
function histReachedCell(manifest, st) {
  let reached = -1;
  const steps = Array.isArray(st.steps) ? st.steps : [];
  for (const s of steps) {
    const loc = locateInManifest(manifest, { nodeId: s.nodeId, phase: s.phase });
    if (loc.cellIdx > reached) reached = loc.cellIdx;
  }
  if (reached < 0 && st.phase) {
    reached = locateInManifest(manifest, { phase: st.phase }).cellIdx;
  }
  return reached;
}

function renderHistoryError(message) {
  el.history.innerHTML = '';
  el.history.appendChild(histEmpty(`Could not load history: ${message}`));
}

// ---------------------------------------------------------------------------
// History detail screen (#history/<projectKey>/<id>)
// ---------------------------------------------------------------------------
// The param after "history/" is "<projectKey>/<id>". projectKey contains a slash
// ONLY as the fixed "workspaces/<wk>" prefix, and ids never contain "/", so
// splitting at the LAST slash is unambiguous.
function histDetailParam(p) { return `${p.projectKey}/${p.id}`; }

function parseHistDetailParam(param) {
  const s = String(param || '');
  const i = s.lastIndexOf('/');
  if (i <= 0 || i === s.length - 1) return null;
  const projectKey = s.slice(0, i);
  const id = s.slice(i + 1);
  return { projectKey, id, workspace: projectKey.startsWith('workspaces/') };
}

let histDetailState = null; // { key, id, record, data, screen } while open
// One-shot "the user pressed Create PR on the list card" intent, consumed by
// openHistDetail unconditionally so it can never strand across visits.
let pendingShipIt = null;   // { id, projectKey } | null
// Spec §11. The card that opened the detail, by DATA STAMPS rather than by node:
// a repaint between open and close replaces the element, so closeHistDetail
// re-queries. A deep link leaves this null and the restore is simply skipped.
let histReturnFocus = null; // { id, projectKey } | null

function routeHistoryDetail(param, { instant = false } = {}) {
  const parsed = parseHistDetailParam(param);
  if (!parsed) { closeHistDetail({ instant }); return; }
  // Re-routing to the already-open run is a no-op (hashchange echo). Drop any
  // pending ship-it intent on that path: openHistDetail is the only consumer, so
  // leaving it set here would strand a one-shot flag that auto-opens the modal on
  // some later, unrelated visit to the same run.
  if (histDetailState && histDetailState.key === parsed.projectKey && histDetailState.id === parsed.id) {
    pendingShipIt = null;
    return;
  }
  openHistDetail(parsed, { instant });
}

function histRecordFor(parsed) {
  const hit = (state.historyAll || []).find((r) => r && r.id === parsed.id && r.projectKey === parsed.projectKey);
  if (hit) return hit;
  // Deep link before the list loaded: a minimal record is enough for the keyed
  // detail/log/diff URL builders (they only read projectKey/target). It has NO
  // pauseReason and NO retainedWork — neither lives in the detail payload — so
  // the row is re-resolved once the list lands.
  return parsed.workspace
    ? { id: parsed.id, projectKey: parsed.projectKey, target: 'workspace' }
    : { id: parsed.id, projectKey: parsed.projectKey };
}

function openHistDetail(parsed, { instant = false } = {}) {
  const host = el.histDetail;
  const shell = el.histShell;
  if (!host || !shell) return;
  // A detail->detail hop never passes through closeHistDetail, so without this the
  // screen is swapped underneath an open ship-it modal whose confirm handler still
  // closes over the PREVIOUS record — one click would open a PR for the run the
  // user just navigated away from. No-op when nothing is open.
  closeShipItModal();
  const record = histRecordFor(parsed);
  histDetailState = { key: parsed.projectKey, id: parsed.id, record, data: null, screen: null };

  host.innerHTML = '';
  host.scrollTop = 0;                       // a prior visit's scroll must not carry over
  const screen = $('#hist-detail-tpl').content.firstElementChild.cloneNode(true);
  host.appendChild(screen);
  histDetailState.screen = screen;

  screen.querySelector('.hd-back').addEventListener('click', () => { location.hash = 'history'; });
  screen.querySelector('.hd-title').textContent = record.title || parsed.id;
  paintHistStatusIcon(screen.querySelector('.hd-sic'), record);

  if (instant) shell.classList.add('no-anim');
  shell.classList.add('detail-open');
  host.setAttribute('aria-hidden', 'false');
  host.removeAttribute('inert');   // the previous close left it inert for the slide;
                                   // focus() below is a no-op inside an inert subtree
  // The off-screen list must not stay tabbable behind the detail. `aria-hidden`
  // alone does NOT remove focusability — only `inert` does — so set BOTH.
  const list = shell.querySelector('.hist-screen-list');
  if (list) { list.setAttribute('aria-hidden', 'true'); list.setAttribute('inert', ''); }
  // AFTER the mount and AFTER the list went inert (spec §11): leaving
  // document.activeElement inside a subtree as it becomes inert is invalid, and
  // `.hd-back` is the one control that is always present on this screen.
  screen.querySelector('.hd-back').focus({ preventScroll: true });
  if (instant) rafSafe(() => shell.classList.remove('no-anim'));

  // Consume the one-shot ship-it intent HERE, not inside the async loader, so a
  // failed detail fetch cannot strand it for a later, unrelated visit.
  const ship = pendingShipIt;
  pendingShipIt = null;
  loadHistDetailScreen(screen, record, parsed, ship);
}

// Double rAF: one frame is not always enough for the browser to commit the
// pre-transition style, and jsdom has no requestAnimationFrame unless
// pretendToBeVisual — fall back to a macrotask there.
function rafSafe(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(fn));
  else setTimeout(fn, 0);
}

function closeHistDetail({ instant = false } = {}) {
  closeShipItModal();   // no-op when nothing is open; the modal is a TOP-LEVEL
                        // overlay, so emptying #hist-detail would not dismiss it
  const shell = el.histShell;
  const host = el.histDetail;
  if (!shell || !host) return;
  if (!shell.classList.contains('detail-open')) { histDetailState = null; return; }
  histDetailState = null;
  host.setAttribute('aria-hidden', 'true');
  // Un-inert the list FIRST — focus() is a no-op inside an inert subtree.
  const list = shell.querySelector('.hist-screen-list');
  if (list) { list.removeAttribute('aria-hidden'); list.removeAttribute('inert'); }
  // Hand focus back to the card the detail was opened from, re-queried by the
  // same stamped selector patchHistoryPr uses — the node itself may have been
  // replaced by a repaint while the detail was up. One-shot: a subsequent deep
  // link must not inherit it.
  const back = histReturnFocus;
  histReturnFocus = null;
  // NOT on the instant path: that one runs from showView, which hides this whole
  // section a few lines later — focusing a card inside a `display:none` subtree
  // just drops focus to <body>. The restore is for list<->detail hops.
  if (back && el.history && !instant) {
    const sel = `.hist-card[data-pipeline-id="${cssEscape(back.id)}"]`
      + `[data-project-key="${cssEscape(back.projectKey)}"] .hist-head`;
    const node = el.history.querySelector(sel);
    if (node) node.focus({ preventScroll: true });   // absent (archived/filtered) -> skip
  }
  // AFTER the focus hand-off (leaving activeElement inside a freshly-inert subtree
  // is invalid): the screen stays MOUNTED until transitionend, so `aria-hidden`
  // alone would leave .hd-back, the tab pills and .hd-archive tabbable behind the
  // list for the whole slide. openHistDetail clears it.
  host.setAttribute('inert', '');
  if (instant) {
    shell.classList.add('no-anim');
    shell.classList.remove('detail-open');
    host.innerHTML = '';
    rafSafe(() => shell.classList.remove('no-anim'));
    return;
  }
  shell.classList.remove('detail-open');
  // Empty the screen after the slide (or via the timeout under reduced motion /
  // jsdom, where transitionend never fires natively). transitionend BUBBLES, so
  // a descendant's hover transition would otherwise clear the DOM mid-slide —
  // hence the target + propertyName guard.
  const clear = () => { if (!histDetailState) host.innerHTML = ''; };
  const onEnd = (e) => {
    if (e.target !== host || e.propertyName !== 'transform') return;
    host.removeEventListener('transitionend', onEnd);
    clear();
  };
  host.addEventListener('transitionend', onEnd);
  const t = setTimeout(() => { host.removeEventListener('transitionend', onEnd); clear(); }, 600);
  if (t && typeof t.unref === 'function') t.unref();
}

// `ship` (4th param) is the consumed pendingShipIt token: the list card's
// Create-PR click, honored once the screen has its data.
async function loadHistDetailScreen(screen, record, parsed, ship = null) {
  let data;
  // (1) FETCH — this try owns network/shape failures only.
  try {
    const url = historyDetailUrl(record.projectDir || null, parsed.id, record);
    const res = await fetch(url);
    data = await safeJson(res);
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    if (!data || !data.state) throw new Error('no saved details for this pipeline yet');
  } catch (e) {
    if (!histDetailState || histDetailState.screen !== screen) return; // navigated away mid-fetch
    const err = screen.querySelector('.hd-error');
    if (err) { err.hidden = false; err.textContent = `Could not load run: ${e.message}`; }
    return;
  }
  if (!histDetailState || histDetailState.screen !== screen) return;   // navigated away mid-fetch
  histDetailState.data = data;

  // (2) RE-RESOLVE THE RECORD. This is not belt-and-braces — without it the
  // deep-link upgrade is lost on the real boot path. showView's history branch
  // calls loadHistoryView() BEFORE routeHistoryDetail(), so on a cache-COLD deep
  // link the list fetch is issued first and (at equal await depth) its
  // continuation runs first — the list paint happens while this screen's `data`
  // is still null, and nothing else would re-resolve the record afterwards. The
  // minimal {id, projectKey} stub would then stick for the life of the screen.
  const row = (state.historyAll || []).find(
    (r) => r && r.id === parsed.id && r.projectKey === parsed.projectKey);
  if (row) histDetailState.record = row;
  const rec = histDetailState.record;

  // (3) PAINT — deliberately OUTSIDE the fetch try. A painter bug must not be
  // reported as `Could not load run: …` with the header actions silently unbound.
  screen.querySelector('.hd-title').textContent = data.state.title || rec.title || parsed.id;
  paintHistStatusIcon(screen.querySelector('.hd-sic'), { ...rec, status: data.state.status });

  const flow = screen.querySelector('.run-flow');
  if (flow) buildRunGraph(flow, data.state.stepper); // null stepper -> legacy default
  paintHistStepper(screen, data.state);

  paintHdHeaderMeta(screen, rec, data);
  setupHdActions(screen, rec, data);
  initHdTabs(screen, rec, data);

  if (ship && ship.id === parsed.id && ship.projectKey === parsed.projectKey) {
    // The list button's click already proved "no PR" — but the history CACHE strips
    // `pr` from persisted rows, so after the hop the matched record may read
    // pr === undefined again. Honor the click-time fact instead of re-deriving
    // (else the intent is dropped on essentially every cache-warm navigation).
    if (rec.pr === undefined) rec.pr = null;
    paintHdPr(screen, rec, data);
    // Two belts, both load-bearing:
    //  - `!rec.pr` — the stale-button -> double-POST race is fixed at the source
    //    (the ship path calls patchHistoryPr); this is the backstop.
    //  - `histPrEligible(rec)` — MANDATORY. Without it the modal opens for a run
    //    whose own detail button paintHdPr just deliberately hid (workspace runs,
    //    gh gone, branch deleted between paint and click), and confirming fires a
    //    POST /api/pr that 404s.
    if (!rec.pr && histPrEligible(rec)) openShipItModal(rec, data);
  }
}

// Status icon + family. Table-driven so the list card and the detail header can
// share one source of truth.
//
// This does NOT mirror the retired status badge — three mappings diverge
// DELIBERATELY:
//   interrupted / pausing / live|running|starting all land in the amber 'paused'
// family, because the icon column answers "can this be resumed?" (interrupted IS
// resumable), not "did it fail?".
const HIST_STATUS_FAMILY = {
  done: 'done', complete: 'done', completed: 'done',
  stopped: 'stopped', aborted: 'stopped',
  error: 'error', failed: 'error',
  paused: 'paused', pausing: 'paused', interrupted: 'paused',
};
function histStatusMeta(p) {
  const s = String((p && p.status) || '').toLowerCase();
  const family = HIST_STATUS_FAMILY[s]
    || ((p && p.live) || s === 'running' || s === 'starting' ? 'paused' : '');
  const word = s === 'pausing' ? 'Pausing…'
    : s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown';
  return { family: family || 'paused', word };
}
function paintHistStatusIcon(host, p) {
  if (!host) return;
  const { family, word } = histStatusMeta(p);
  host.className = host.className.replace(/\bst-\w+\b/g, '').replace(/\s+/g, ' ').trim() + ` st-${family}`;
  host.title = word;
  host.setAttribute('aria-label', word);
  for (const svg of host.querySelectorAll('.sic')) {
    svg.toggleAttribute('hidden', !svg.classList.contains(`sic-${family}`));
  }
}

// --- "Ship it?" confirm modal + the detail header's PR control ---------------
// `pendingShipIt` is declared with histDetailState above — the list card's
// Create-PR path is its only writer, openHistDetail its only consumer.

// Teardown handle for the OPEN ship-it modal (null when closed). closeHistDetail
// calls through it: the modal is a top-level overlay, not a child of the detail
// screen, so emptying #hist-detail would otherwise leave a full-screen overlay
// (and a live document keydown listener) over the LIST — after which the
// double-open guard below makes Create PR permanently dead.
let shipItClose = null;
function closeShipItModal() { if (shipItClose) shipItClose(); }

function openShipItModal(record, data) {
  const modal = document.getElementById('shipit-modal');
  if (!modal) return;
  if (!modal.classList.contains('hidden')) return;  // double-open guard: a second open
                                                    // would stack a second onOk -> two POSTs
  const q = (sel) => modal.querySelector(sel);
  q('.shipit-sub').textContent =
    `This opens a pull request for ${record.title || record.id} and puts it up for review.`;
  const sums = data && data.results && data.results.summary;
  // 'D' rows already count inside filesChanged — do not add filesDeleted.
  const nFiles = sums ? (sums.filesNew || 0) + (sums.filesChanged || 0) : null;
  const added = sums ? sums.linesAdded : (record.survived ? record.added : null);
  const removed = sums ? sums.linesRemoved : (record.survived ? record.removed : null);
  q('.shipit-files').textContent = nFiles != null ? `${nFiles} file${nFiles === 1 ? '' : 's'}` : '';
  q('.shipit-add').textContent = added != null ? `+${added}` : '';
  q('.shipit-del').textContent = removed != null ? `−${removed}` : '';   // U+2212 — a COUNT
  q('.shipit-branch').textContent = record.branch || '';
  q('.shipit-base').textContent = record.sourceBranch || '';
  // Spec §5.10: omit the whole summary line when there is nothing to summarize.
  // (No `&& !record.branch` term: histPrEligible gates BOTH doors into this modal
  // and requires `branch`, so that clause could never be false.)
  q('.shipit-summary').hidden = nFiles == null && added == null;
  const err = q('.shipit-err');
  err.hidden = true; err.textContent = '';
  const okBtn = q('.shipit-ok');
  okBtn.disabled = false; okBtn.textContent = 'Open pull request';
  modal.classList.remove('hidden');
  okBtn.focus();

  // `closed` is load-bearing, not defensive noise. Cancel is NOT disabled while the
  // POST is in flight, so this sequence is reachable: confirm -> cancel mid-flight
  // -> `.hd-pr` is still visible (record.pr is not set yet) -> click it -> the
  // `!hidden` guard above passes -> a SECOND generation of listeners attaches. When
  // the first fetch finally settles, a non-idempotent `done()` would hide the
  // freshly-opened modal, null out the NEW generation's `shipItClose` handle (so
  // closeHistDetail can no longer tear it down) and leave its document keydown
  // listener attached — after which every further open stacks another `onOk`, i.e.
  // one click = N POSTs. That is exactly the double-POST these guards prevent.
  let closed = false;
  const done = () => {
    if (closed) return;                              // idempotent: only the first call acts
    closed = true;
    modal.classList.add('hidden');
    if (shipItClose === done) shipItClose = null;    // never clobber a newer generation's handle
    okBtn.removeEventListener('click', onOk);
    q('.shipit-cancel').removeEventListener('click', onCancel);
    modal.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onKey);
  };
  shipItClose = done;
  const onCancel = () => done();
  const onBackdrop = (e) => { if (e.target === modal) done(); };
  const onKey = (e) => { if (e.key === 'Escape') done(); };
  const onOk = async () => {
    okBtn.disabled = true;
    okBtn.textContent = 'Opening…';
    try {
      const res = await fetch('/api/pr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: record.projectDir || null, projectKey: record.projectKey, id: record.id }),
      });
      const dd = await safeJson(res);
      if (!res.ok) throw new Error((dd && dd.error) || `HTTP ${res.status}`);
      const pr = { state: 'OPEN', url: dd.url || '#', number: null };
      record.pr = pr;
      done();
      // Keep the LIST card in step. Without this the card behind the detail keeps
      // its stale "Create PR" button — list<->detail hops deliberately do NOT
      // reload — so pressing Back and clicking it again sets pendingShipIt and
      // re-opens this modal for a run that already has an OPEN PR, firing a second
      // POST /api/pr. patchHistoryPr updates the model row, calls resetPrCluster +
      // setupPrButton on the live card, and — through hdSyncPr — repaints the
      // detail control too. It no-ops safely for an off-screen/filtered card, so
      // the explicit detail paint below stays.
      patchHistoryPr({ projectKey: record.projectKey, id: record.id, pr });
      const screen = histDetailState && histDetailState.screen;
      if (screen) {
        paintHdPr(screen, record, histDetailState.data);
        const mergeEl = screen.querySelector('.hist-merge');
        if (mergeEl) {
          setMergePill(mergeEl, dd.mergeable);
          // GitHub computes mergeability asynchronously; re-check once so the
          // "checking…" pill never sticks.
          if (String(dd.mergeable || 'UNKNOWN').toUpperCase() === 'UNKNOWN') {
            scheduleMergeRecheck(mergeEl, { projectDir: record.projectDir || null, projectKey: record.projectKey, id: record.id });
          }
        }
      }
    } catch (e2) {
      // The user cancelled (or navigated) while this POST was in flight and a new
      // generation may already own the modal — do not re-enable its button or
      // stamp a stale error onto it.
      if (closed) return;
      okBtn.disabled = false;
      okBtn.textContent = 'Open pull request';
      err.hidden = false;
      err.textContent = `Could not open PR: ${e2.message}`;
    }
  };
  okBtn.addEventListener('click', onOk);
  q('.shipit-cancel').addEventListener('click', onCancel);
  modal.addEventListener('click', onBackdrop);
  document.addEventListener('keydown', onKey);
}

// THE single PR-eligibility predicate. Every caller uses it: paintHdPr (below),
// setupPrButton (the list card) and the pendingShipIt consumer.
//
// `target !== 'workspace'` is MANDATORY and is the ONE clause the existing list
// gate (app.js:8571) is missing. POST /api/pr has NO workspace arm and its key
// regex (ui/server.mjs:1637) rejects a `workspaces/...` composite with a 404 — yet
// workspace rows DO satisfy the other three clauses, because listAllPipelines hands
// rowToHistoryEntry the workspace's primary member dir as repoDir
// (artifacts.mjs:1549-1556), so `survived`/`branch`/`sourceBranch` are all really
// computed for them.
function histPrEligible(p) {
  return !!(state.ghAvailable && p && p.survived && p.branch && p.sourceBranch
    && p.target !== 'workspace');
}

// Keep the OPEN detail's PR control in step with the two PR-resolution paths
// (patchHistoryPr per-entry, finalizeHistoryPr terminal). Called from inside both,
// BEFORE their `if (!card)` early-outs — otherwise a deep-linked run whose list
// card is filtered off-screen never gets its control resolved.
function hdSyncPr(projectKey, id, row) {
  if (!histDetailState || !histDetailState.screen || !histDetailState.data) return;
  if (histDetailState.id !== id || histDetailState.key !== projectKey) return;
  if (row) histDetailState.record = row;   // a deep link's minimal record upgrades to the real row
  paintHdPr(histDetailState.screen, histDetailState.record, histDetailState.data);
}

// Detail-header PR control from the record's tri-state (undefined = enrichment
// pending -> hidden; null = resolved/none -> Create when eligible; object = link).
// Link-first, matching setupPrButton's order (app.js:8552-8569): a merged-but-
// branch-gone run still shows "Merged".
function paintHdPr(screen, record, data) {
  const btn = screen.querySelector('.hd-pr');
  const link = screen.querySelector('.hd-pr-link');
  if (!btn || !link) return;
  btn.hidden = true;
  link.hidden = true;
  const pr = record.pr && typeof record.pr === 'object' ? record.pr : null;
  const prState = pr ? String(pr.state || '').toUpperCase() : '';
  if (pr && (prState === 'OPEN' || prState === 'MERGED') && pr.url) {
    link.hidden = false;
    link.href = pr.url;
    link.textContent = prState === 'MERGED' ? 'Merged' : 'View PR';
    link.classList.toggle('merged', prState === 'MERGED');
    return;
  }
  if (!histPrEligible(record) || record.pr === undefined) return;
  btn.hidden = false;
  // Property assignment, NOT addEventListener: paintHdPr re-runs (the patchHistoryPr
  // / finalizeHistoryPr hooks, refreshHdFromRow, post-ship) and refreshHdFromRow
  // REPLACES histDetailState.record — a one-time bound listener would keep the stale
  // first record in its closure; reassigning onclick always captures the current one.
  btn.onclick = () => openShipItModal(record, data);
}

// --- detail header: meta line, branch copy, Resume, Archive, banners --------

// "8/17/2026, 8:54:42 PM" -> { day, clock } (locale-driven; no comma -> clock '').
// fmtDate returns '' for a falsy value, so a record with no timestamp yields two
// empty segments and the painter skips both — never "Invalid Date".
function splitDateStamp(iso) {
  const s = fmtDate(iso);
  const i = s.indexOf(', ');
  return i === -1 ? { day: s, clock: '' } : { day: s.slice(0, i), clock: s.slice(i + 2) };
}

function hdDot() {
  const d = document.createElement('span');
  d.className = 'hd-dot';
  d.textContent = '·';
  return d;
}

function paintHdHeaderMeta(screen, record, data) {
  const st = data.state;
  const meta = screen.querySelector('.hd-meta');
  meta.innerHTML = '';
  const { family, word } = histStatusMeta({ status: st.status });
  const w = document.createElement('span');
  w.className = `hd-status-word st-${family}`;
  w.textContent = word;
  meta.appendChild(w);
  const { day, clock } = splitDateStamp(st.startedAt || record.startedAt || record.mtime);
  for (const [cls, text, strong] of [
    ['hd-day', day, false],
    ['hd-clock', clock, false],
    ['hd-dur', typeof st.totalActiveMs === 'number' ? fmtDuration(st.totalActiveMs) : '', true],
    ['hd-cost', typeof st.totalCostUsd === 'number' ? fmtUsd(st.totalCostUsd) : '', true],
  ]) {
    if (!text) continue;
    meta.appendChild(hdDot());
    const seg = document.createElement('span');
    seg.className = cls + (strong ? ' strong' : '');
    seg.textContent = text;
    if (cls === 'hd-cost') seg.title = estTitle(st.totalCostUsd);
    meta.appendChild(seg);
  }
  // +A −R: persisted results first (done runs), else the live list counts.
  const sums = data.results && data.results.summary;
  const added = sums ? sums.linesAdded : (record.survived ? record.added : null);
  const removed = sums ? sums.linesRemoved : (record.survived ? record.removed : null);
  if (added != null && removed != null) {
    meta.appendChild(hdDot());
    // One wrapper, NOT `meta.append(a, ' ', r)`: a bare text node inside a
    // `display:flex;gap:8px` container becomes its own anonymous flex item and
    // buys an extra 8px gap between the two counts.
    const counts = document.createElement('span');
    counts.className = 'hd-diffcounts';
    const a = document.createElement('span'); a.className = 'diff-add'; a.textContent = `+${added}`;
    const r = document.createElement('span'); r.className = 'diff-del'; r.textContent = `−${removed}`; // U+2212
    counts.append(a, r);
    meta.appendChild(counts);
  }
  // Branch row.
  const base = screen.querySelector('.hd-base');
  const copyBtn = screen.querySelector('.hd-branch-copy');
  const br = st.branch && typeof st.branch === 'object' ? st.branch : {};
  const feature = br.feature || (typeof st.branch === 'string' ? st.branch : '') || record.branch || '';
  const source = br.source || record.sourceBranch || '';
  base.textContent = source ? `${source} →` : '';
  base.hidden = !source;
  copyBtn.hidden = !feature;
  if (feature) {
    screen.querySelector('.hd-branch-name').textContent = feature;
    if (copyBtn.dataset.bound !== '1') {              // paintHdHeaderMeta re-runs (refreshHdFromRow)
      copyBtn.dataset.bound = '1';
      // Read the CURRENTLY PAINTED name at click time, never the load-time
      // `feature` string. This binder is bound once while paintHdHeaderMeta
      // re-runs and rewrites `.hd-branch-name` (deep link: the first paint takes
      // st.branch.feature, the later row supplies record.branch) — closing over
      // `feature` is the same stale-capture class hdCurrentRecord exists to kill,
      // applied to a string instead of a record.
      copyBtn.addEventListener('click', () => {
        const name = screen.querySelector('.hd-branch-name').textContent || '';
        if (name) copyBranchToClipboard(copyBtn, name);
      });
    }
  }
}

// Busy-label target. Both DETAIL buttons carry an inline SVG, so a bare
// `btn.textContent = 'Resuming…'` DELETES the icon, and the error path restores
// text only — the icon never comes back. Prefer the `.hd-btn-label` span the
// detail template ships; fall back to the button itself for any caller that
// passes a plain, icon-less button.
function btnLabelEl(btn) { return btn.querySelector('.hd-btn-label') || btn; }

// The POST /api/resume -> upsert -> seed-log -> land-on-running recipe, shared by
// the detail header and the cost-override path.
async function resumePipeline(p, projectDir, btn, { ignoreCostCap = false } = {}) {
  const labelEl = btnLabelEl(btn);
  btn.disabled = true;
  // Claim the button for the duration of the round-trip (and keep the failure
  // message afterwards). `applyHistResumeGate` writes `btn.disabled` and
  // `btn.title = ''` UNCONDITIONALLY, and refreshHistResumeGating now runs from
  // every paintHistory() while a detail screen with data is open — including the
  // `pipelines-changed` force-reload this very resume triggers. Without the claim
  // that broadcast re-enables `.hd-resume` mid-POST (a second click = a second
  // POST /api/resume) and wipes the `Could not resume: …` title D3 relies on. The
  // detail screen is never rebuilt, so the dataset flag really does survive there.
  // It does NOT protect the LIST button, and the claim is not what makes that
  // safe: renderHistory() rebuilds every card, destroying flag, label and title
  // alike — the status quo, unchanged here. Precedent: startSubmitInFlight.
  btn.dataset.resumeState = 'busy';
  const label = labelEl.textContent;
  labelEl.textContent = 'Resuming…';
  try {
    const res = await fetch('/api/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ignoreCostCap ? { pipelineId: p.id, ignoreCostCap: true } : { pipelineId: p.id }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    upsertRun({
      runId: data.runId, title: p.title || p.id, projectDir: p.projectDir || projectDir || '',
      status: 'starting', pipelineId: p.id, local: true,
    });
    // Seed the resumed run with the pre-pause log so the live card is continuous.
    // Prefer an in-memory paused run sharing this pipelineId (exact, no fetch);
    // otherwise fall back to the persisted NDJSON (resume from History / reload).
    const prior = [...runs.values()].find(
      (x) => x.runId !== data.runId && x.pipelineId === p.id && Array.isArray(x.logLines) && x.logLines.length
    );
    await seedResumedLog(data.runId, prior ? prior.logLines : null, prior ? null : historyLogUrl(p.id, p));
    // Carry the branch label onto the resumed card so it doesn't blank until the
    // first state event lands. History LIST entries carry `branch` as a STRING,
    // which the old object-only read missed.
    const nr = runs.get(data.runId);
    if (nr) {
      const feat = (prior && prior.branchFeature)
        || (p.branch && typeof p.branch === 'object' ? p.branch.feature : null)
        || (typeof p.branch === 'string' ? p.branch : null);
      if (feat) { nr.branchFeature = feat; paintRunCard(nr); }
    }
    if (prior) runs.delete(prior.runId);   // drop the superseded paused run (no split/dup)
    hideViewer();
    updateNavCounts();
    location.hash = `running/${data.runId}`;   // land on the continuous live card
    renderRunningView();
  } catch (err) {
    // Survives later repaints ON THE DETAIL SCREEN (it is never rebuilt). A LIST
    // card is rebuilt wholesale by renderHistory(), which drops flag, label and
    // title together — status quo, unchanged here.
    btn.dataset.resumeState = 'error';
    btn.dataset.resumeError = `Could not resume: ${err.message}`;
    btn.disabled = false;
    labelEl.textContent = label;
    btn.title = btn.dataset.resumeError;             // D3: the server's 400 surfaces here
  }
}

const HD_RESUMABLE = new Set(['paused', 'interrupted']);

// { screen, record } the Discard-worktree listener is currently bound to, so
// paintHdBanners can re-bind when either changes (see the comment inside it).
let hdDiscardBound = null;

// Retained work is a LIST-row field (and the server gates it on existsSync of the
// worktree). A deep-linked or cache-warm detail has no authoritative value, so
// derive a PROVISIONAL one from the state.branch.commitFailed stamp and let the
// real row correct it in BOTH directions once it lands. Idempotent.
//
// AUTHORITATIVE vs PROVISIONAL is the whole contract: rowToHistoryEntry ALWAYS
// emits the `pauseReason` and `retainedWork` keys, so hasOwnProperty is a valid
// "this record came from the server" test; writeHistoryCache STRIPS retainedWork,
// so a cache-warm row genuinely lacks the key — as does the deep-link stub.
//
// The derived value is deliberately NOT written back onto `record`: that object
// lives in state.historyAll, so materializing a derived retention would grow a
// "Work retained" badge on the LIST card, computed from a commitFailed stamp the
// server would have suppressed via its existsSync gate. Instead a provisional
// retention paints the banner from a throwaway carrier and binds NO Discard — the
// button appears one fetch later, when the authoritative row arrives.
//
// LIMIT: the provisional derivation is single-project only. A workspace run's
// retention comes from workspace_meta.branches, and the detail payload carries no
// equivalent — so a deep-linked workspace run shows no banner and an ENABLED
// Archive until its list row lands. The server's 409 is the real guard.
function hdRetainedFor(record, st) {
  if (record && Object.prototype.hasOwnProperty.call(record, 'retainedWork')) {
    return { retained: record.retainedWork || null, provisional: false };
  }
  if (record && record.target === 'workspace') return { retained: null, provisional: true };
  const br = st && st.branch && typeof st.branch === 'object' ? st.branch : {};
  const derived = (!br.commitFailed || !br.worktreeDir || br.worktreeRemoved === true) ? null : {
    reason: br.commitFailed.code || 'unknown',
    members: [{
      projectKey: record.projectKey || null, worktreeDir: br.worktreeDir,
      branch: br.feature || null, code: br.commitFailed.code || null,
      step: br.commitFailed.step || null, message: br.commitFailed.message || '',
      at: br.commitFailed.at || null,
    }],
  };
  return { retained: derived, provisional: true };
}

function paintHdBanners(screen, record, data) {
  const st = data.state;
  const banners = screen.querySelector('.hd-banners');

  // Cost-pause banner. pauseReason lives on LIST rows only (rowToState has none),
  // so a deep link gets it late — rebuild idempotently instead of once.
  const pauseReason = typeof record.pauseReason === 'string' ? record.pauseReason : '';
  if (pauseReason) screen.dataset.pauseReason = pauseReason; else delete screen.dataset.pauseReason;
  // Rebuild the cost banner ONLY when the reason actually changed. An
  // unconditional remove+rebuild detaches the `.cb-override` button mid-flight:
  // that click awaits confirmModal then resumePipeline, and ANY paintHistory()
  // inside that window (a `pipelines-changed` broadcast, a WS reconnect's
  // onHello -> loadHistoryView) would replace the node — after which
  // resumePipeline writes disabled / 'Resuming…' / the D3 title to a DETACHED
  // button while the user faces a fresh, enabled one. `.hd-resume` is protected by
  // dataset.resumeState; this path needs NODE STABILITY instead, because its host
  // is what gets replaced.
  const oldBanner = banners.querySelector('.cost-banner');
  const wantCost = pauseReason.startsWith('cost_');
  if (oldBanner && (!wantCost || oldBanner.dataset.pauseReason !== pauseReason)) oldBanner.remove();
  if (wantCost && !banners.querySelector('.cost-banner')) {
    const banner = renderCostPauseBanner(
      { pauseReason, pipelineId: record.id, totalCostUsd: st.totalCostUsd },
      { budget: budgetState.budget || {}, fmt: { usd: fmtUsd, usd4: fmtUsd4, duration: fmtDuration, estTitle } });
    const settingsBtn = banner.querySelector('.cb-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', () => { location.hash = 'settings'; });
    const overrideBtn = banner.querySelector('.cb-override');
    if (overrideBtn) {
      overrideBtn.addEventListener('click', () => {
        const r = hdCurrentRecord(record);   // never the load-time object
        histCostOverride(r.projectDir || null, r.id, r, overrideBtn); // fire-and-forget
      });
    }
    banner.dataset.pauseReason = pauseReason;   // what the conditional rebuild keys on
    banners.prepend(banner);
  }

  // Retained work. renderRetainedWork rebuilds the banner from scratch each call
  // (and tolerates a missing node), so it is safe to re-run;
  // `setupDiscardWorktreeButton` is NOT idempotent (it adds a listener on every
  // call), so it must be bound at most once PER RECORD OBJECT.
  //
  // "Per record object", not "per screen". The bound handler closes over the
  // record it was handed and mutates THAT object on success
  // (`p.retainedWork = null`) before calling paintHistory(). On the deep-link path
  // refreshHdFromRow REPLACES histDetailState.record with the real list row, so a
  // bind-once-per-screen guard would leave the handler mutating the orphaned
  // minimal record: the POST succeeds and the worktree really is discarded, but
  // the repaint reads the still-retained ROW — the banner stays and Archive stays
  // disabled until a full reload. Re-bind whenever the record identity changes,
  // dropping the stale listener by replacing the button node first
  // (addEventListener leaves no removal handle).
  const { retained, provisional } = hdRetainedFor(record, st);
  // renderRetainedWork only READS `p.retainedWork`, so a provisional paint may use
  // a throwaway carrier; every MUTATING helper below is handed `record` itself.
  renderRetainedWork(screen, provisional ? { ...record, retainedWork: retained } : record);
  let dbtn = screen.querySelector('.hist-discard');
  if (retained && !provisional) {
    // Keyed on BOTH screen and record: a new visit builds a fresh screen from the
    // template (unbound button) while `record` may be the very same list-row
    // object, so a record-only key would skip the bind on the new screen.
    if (!hdDiscardBound || hdDiscardBound.screen !== screen || hdDiscardBound.record !== record) {
      if (dbtn) { const fresh = dbtn.cloneNode(true); dbtn.replaceWith(fresh); dbtn = fresh; }
      hdDiscardBound = { screen, record };
      setupDiscardWorktreeButton(screen, record.projectDir || null, record);
    }
  } else {
    // Provisional retention shows the banner but NOT the action: discarding must
    // act on the authoritative row (which arrives one fetch later and re-runs this
    // painter), never on a stub or a cache-warm row whose retention we inferred.
    hdDiscardBound = null;
    if (dbtn) dbtn.hidden = true;   // renderRetainedWork does not touch this button
  }
  // Must run AFTER renderRetainedWork unhides the banner: addRecoveryPatchLink
  // bails on a hidden banner and self-guards against duplicates.
  addRecoveryPatchLink(screen, record.projectDir || null, record, data.artifacts);
  return retained;
}

// THE record accessor for detail-screen click handlers. `setupHdActions` binds
// Resume and Archive exactly once and is deliberately NEVER re-run (re-running it
// would double-bind), while `refreshHdFromRow` REPLACES histDetailState.record —
// with the authoritative list row on the deep-link path, and with a freshly-minted
// row object after any forced reload. Closing over the load-time `record`
// therefore means acting on a superseded object: on a deep link that object is the
// minimal {id, projectKey} stub, so Resume would land a running card titled with
// the raw run id and projectDir '' (blank project name, branch label lost) and
// Archive would put the raw id where D2's spec-verbatim copy wants the run title.
// Resolve at CLICK time instead; `record` stays only as the fallback for the
// (impossible-in-practice) case of a click after the state was cleared.
function hdCurrentRecord(fallback) {
  return (histDetailState && histDetailState.record) || fallback;
}

function hdSetArchiveGate(btn, retained) {
  if (!btn) return;
  // An IN-FLIGHT archive owns its button outright — the mirror of
  // refreshHistResumeGating's `resumeState === 'busy'` guard. The DELETE removes a
  // worktree and a branch (seconds, not milliseconds), and any repaint inside that
  // window — a `pipelines-changed` broadcast for ANOTHER pipeline reaches here
  // through refreshHdFromRow — would otherwise re-enable a button still reading
  // "Archiving…" (second click = second DELETE, whose 404 stamps an error for an
  // archive that in fact succeeded).
  if (btn.dataset.archiveState === 'busy') return;
  btn.disabled = !!retained;
  btn.title = retained ? 'Recover or discard the retained uncommitted work before archiving.' : '';
}

function setupHdActions(screen, record, data) {
  const st = data.state;
  const status = String(st.status || '').toLowerCase();
  const retained = paintHdBanners(screen, record, data);

  // Resume: paused + interrupted only (D3).
  const resumeBtn = screen.querySelector('.hd-resume');
  if (HD_RESUMABLE.has(status)) {
    resumeBtn.hidden = false;
    applyHistResumeGate(resumeBtn, screen.dataset.pauseReason || '', budgetState.budget);
    resumeBtn.addEventListener('click', () => {
      const r = hdCurrentRecord(record);              // never the load-time object
      resumePipeline(r, r.projectDir || null, resumeBtn);
    });
  }

  // Archive: honest copy (D2), confirmModal (not window.confirm). Deletability is
  // judged on the AUTHORITATIVE detail status (a deep link's minimal record has none).
  const archiveBtn = screen.querySelector('.hd-archive');
  if (isDeletableEntry({ ...record, status: st.status })) {
    archiveBtn.hidden = false;
    hdSetArchiveGate(archiveBtn, retained);
    archiveBtn.addEventListener('click', async () => {
      if (archiveBtn.disabled) return;
      const r = hdCurrentRecord(record);              // never the load-time object
      // Spec §5.2/D2 fixes this copy VERBATIM — do not paraphrase (only the
      // run-title context line above it is ours). `.confirm-message` already
      // declares white-space:pre-line, so the blank line renders as a paragraph.
      const ok = await confirmModal({
        title: 'Archive this pipeline?',
        message: `${r.title || r.id}\n\nIt moves out of History. The local branch, worktree, and run artifacts (logs, results, diff) are removed. The remote branch and any open PR stay untouched.`,
        confirmLabel: 'Archive',
        danger: true,
      });
      if (!ok) return;
      const label = btnLabelEl(archiveBtn);
      archiveBtn.dataset.archiveState = 'busy';   // read by hdSetArchiveGate
      archiveBtn.disabled = true;
      label.textContent = 'Archiving…';
      try {
        const qs = runActionQuery(r.projectDir || null, r);
        const res = await fetch(`/api/runs/${encodeURIComponent(r.id)}?${qs.toString()}`, { method: 'DELETE' });
        const dd = await safeJson(res);
        if (!res.ok) throw new Error((dd && dd.error) || `HTTP ${res.status}`);
        state.historyAll = state.historyAll.filter((x) => !(x && x.id === r.id && x.projectKey === r.projectKey));
        // The same guard loadHistoryView uses ("never cache empty/error"):
        // archiving the LAST pipeline would otherwise persist `{pipelines: []}`
        // and the next boot would paint an empty History from cache before the
        // network answers.
        if (state.historyAll.length) writeHistoryCache(state.historyAll, state.ghAvailable);
        paintHistory();
        location.hash = 'history';
      } catch (err) {
        // Cleared only on failure: the success path navigates back to the list and
        // the screen (button included) is discarded.
        delete archiveBtn.dataset.archiveState;
        archiveBtn.disabled = false;
        label.textContent = 'Archive';
        const errEl = screen.querySelector('.hd-error');   // spec §5.2: inline error
        if (errEl) { errEl.hidden = false; errEl.textContent = `Could not archive: ${err.message}`; }
      }
    });
  }

  paintHdPr(screen, record, data);
}

// Re-run only the IDEMPOTENT painters after the open detail's real list row
// arrives (deep-link case) or changes. NEVER re-runs setupHdActions — that would
// double-bind the Resume/Archive listeners.
//
// There is deliberately NO `row === histDetailState.record` early-out. The row and
// the detail's record are usually the SAME object (histRecordFor returns it), and
// the flows that matter mutate it in place before calling paintHistory():
// setupDiscardWorktreeButton sets `p.retainedWork = null`, and the ship-it path
// sets `record.pr`. An identity guard would skip exactly those repaints and strand
// a cleared worktree behind a live banner + a disabled Archive. The painters are
// cheap and idempotent, and paintHistory() is not a hot path.
//
// Because this function REPLACES histDetailState.record, the bind-once handlers
// setupHdActions installed must resolve the record through hdCurrentRecord() at
// click time — do NOT "fix" a stale-record symptom by calling setupHdActions from
// here; that double-binds both buttons.
function refreshHdFromRow() {
  if (!histDetailState || !histDetailState.screen || !histDetailState.data) return;
  const row = (state.historyAll || []).find(
    (r) => r && r.id === histDetailState.id && r.projectKey === histDetailState.key);
  if (!row) return;                       // archived / filtered out of the model entirely
  histDetailState.record = row;
  const { screen, data } = histDetailState;
  paintHdHeaderMeta(screen, row, data);
  const retained = paintHdBanners(screen, row, data);   // corrects in BOTH directions
  hdSetArchiveGate(screen.querySelector('.hd-archive'), retained);
  refreshHistResumeGating();
  paintHdPr(screen, row, data);                         // idempotent; re-binds btn.onclick
  refreshHdOverviewTab();   // the one tab body that reads mutable record fields
}

// --- section tabs: pill row + lazily-built section bodies -------------------

const HD_TAB_ICONS = {
  diff: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 3h8l4 4v14H6z" stroke-linejoin="round"/><path d="M14 3v4h4" stroke-linejoin="round"/></svg>',
  overview: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8"/><path d="M12 8h.01M11 12h1v4h1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  agents: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="12" r="2.4"/><path d="M8 6h5a3 3 0 0 1 3 3v0M8 18h5a3 3 0 0 0 3-3v0" stroke-linecap="round"/></svg>',
  clarify: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.9.4-1.5 1-1.5 2.2M12 17h.01" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  logs: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 6h16M4 12h16M4 18h10" stroke-linecap="round"/></svg>',
};

function hdClarifyCount(data) {
  const q = (data.clarify && Array.isArray(data.clarify.questions)) ? data.clarify.questions.length : 0;
  const stepQ = Array.isArray(data.stepQuestions)
    ? data.stepQuestions.reduce((n, r) => n + ((r && r.questions) || []).length, 0) : 0;
  return q + stepQ;
}

const HD_TABS = [
  // File count = filesNew + filesChanged ONLY: deleted files carry status 'D'
  // INSIDE changedFiles (results.mjs:22-53; NEW_STATUS is {A,C}) and are ALSO
  // counted in filesDeleted, so adding filesDeleted double-counts every deletion
  // against the rendered file list.
  { key: 'diff', label: 'Diff',
    badge: (d) => (d.results && d.results.summary
      ? String((d.results.summary.filesNew || 0) + (d.results.summary.filesChanged || 0)) : null),
    visible: () => true, build: (...a) => buildHdDiff(...a) },
  { key: 'overview', label: 'Overview', badge: () => null, visible: () => true, build: (...a) => buildHdOverview(...a) },
  { key: 'agents', label: 'Agents',
    badge: (d) => ((Array.isArray(d.state.subAgents) && d.state.subAgents.length) ? String(d.state.subAgents.length) : null),
    visible: () => true, build: (...a) => buildHdAgents(...a) },
  { key: 'clarify', label: 'Clarify',
    badge: (d) => String(hdClarifyCount(d)),
    visible: (d) => hdClarifyCount(d) > 0, build: (...a) => buildHdClarify(...a) },
  { key: 'logs', label: 'Logs', badge: () => null,
    visible: (d) => Array.isArray(d.artifacts) && d.artifacts.some((a) => a && a.kind === 'live-log'),
    build: (...a) => buildHdLogs(...a) },
];

// The live tab cells of the OPEN detail, so refreshHdFromRow can repaint the one
// body that reads mutable record fields (Overview). Reset on every initHdTabs.
let hdTabCells = null;

function initHdTabs(screen, record, data) {
  const bar = screen.querySelector('.hd-tabs');
  const secs = screen.querySelector('.hd-sections');
  bar.innerHTML = '';
  secs.innerHTML = '';
  const tabs = HD_TABS.filter((t) => t.visible(data));
  const cells = new Map();
  hdTabCells = cells;
  for (const t of tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hd-tab';
    btn.dataset.sec = t.key;
    btn.id = `hd-tab-${t.key}`;
    btn.setAttribute('role', 'tab');
    btn.innerHTML = HD_TAB_ICONS[t.key];          // static markup, no interpolation
    btn.appendChild(document.createTextNode(' ' + t.label));
    const badge = t.badge(data);
    if (badge != null) {
      const b = document.createElement('span');
      b.className = 'hd-tab-badge';
      b.textContent = badge;
      btn.appendChild(b);
    }
    bar.appendChild(btn);
    const sec = document.createElement('div');
    sec.className = 'hd-sec';
    sec.dataset.sec = t.key;
    sec.id = `hd-sec-${t.key}`;
    sec.setAttribute('role', 'tabpanel');
    sec.setAttribute('aria-labelledby', btn.id);
    btn.setAttribute('aria-controls', sec.id);
    // Two panels scroll internally (.hd-diff-rows, .hd-sec-logs .log) and neither
    // is reliably reachable by keyboard otherwise; tabindex=0 on the panel is the
    // standard tabs remedy and costs nothing on the other three.
    sec.tabIndex = 0;
    sec.hidden = true;
    secs.appendChild(sec);
    cells.set(t.key, { tab: t, btn, sec });
    btn.addEventListener('click', () => activate(t.key));
  }
  function activate(key) {
    // TWO PHASES on purpose. Building inside the toggle loop means a throwing
    // builder aborts the loop mid-iteration: every cell after the active one keeps
    // its previous `.active`/`hidden` state, so the user is left with two lit pills
    // and/or two visible sections — and later tasks explicitly design for builders
    // that may throw (the retry contract below). Toggle everything first, then
    // build exactly the newly-activated section.
    let pending = null;
    for (const [k, { tab, btn, sec }] of cells) {
      const on = k === key;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      sec.hidden = !on;
      if (on && sec.dataset.loaded !== '1') pending = { tab, sec };
    }
    if (pending) {
      // Stamp AFTER the builder returns: a builder that throws leaves the tab
      // un-stamped and retries on the next activation instead of being stuck
      // permanently empty. The Logs builder kicks off an async loadLiveLogs and
      // returns immediately, so its own `dataset.loaded = ''` error reset still
      // lands after this stamp — the retry contract holds.
      //
      // hdCurrentRecord(), NOT the captured `record`: activate() runs at CLICK
      // time, and refreshHdFromRow REPLACES histDetailState.record (deep link, and
      // every pipelines-changed forced reload). Closing over the load-time object
      // is exactly what the record-identity rule forbids — a tab first opened
      // after the real row landed would otherwise still render the minimal stub.
      pending.tab.build(pending.sec, hdCurrentRecord(record), data);
      pending.sec.dataset.loaded = '1';
    }
  }
  activate(data.results ? 'diff' : 'overview');
}

// Overview is the ONLY tab body that reads mutable record fields
// (record.retainedWork -> the WORKTREE card, record.projectName / sourceBranch ->
// the chips). Diff and Logs touch the record only for URL building (id /
// projectKey / target, all stable across row instances), and Agents / Clarify read
// `data` alone. So when the authoritative row lands (deep link) or a forced reload
// mints a new row, repaint just that one body — cheap, and it avoids tearing down
// the Diff selection or the Logs filter/scroll state that a blanket rebuild would.
// Only if it was already built; an unbuilt tab picks the current record up anyway
// via hdCurrentRecord() in activate().
function refreshHdOverviewTab() {
  if (!hdTabCells || !histDetailState || !histDetailState.screen || !histDetailState.data) return;
  const cell = hdTabCells.get('overview');
  if (!cell || cell.sec.dataset.loaded !== '1') return;
  if (!histDetailState.screen.contains(cell.sec)) return;   // cells belong to a superseded screen
  buildHdOverview(cell.sec, hdCurrentRecord(), histDetailState.data);   // the accessor, like every other consumer
}

// --- Diff tab: file list + patch viewer -------------------------------------

// File rows for the Diff tab. Single-project: results.newFiles + changedFiles.
// Workspace: one group per results.perProject[<key>] (a workspace results object
// has NO top-level file arrays), with the project key carried so patch sections
// resolve per project.
function hdDiffFileRows(results) {
  const rows = [];
  const push = (project, r) => {
    for (const f of r.newFiles || []) rows.push({ project, f, isNew: true });
    for (const f of r.changedFiles || []) rows.push({ project, f, isNew: false });
  };
  if (results.perProject && typeof results.perProject === 'object') {
    for (const [key, r] of Object.entries(results.perProject)) push(key, r || {});
  } else {
    push(null, results);
  }
  return rows;
}

// Per-file count chip. A file entry carries EITHER {added,removed} OR
// {binary:true} — never both (results.mjs:22-53).
function hdFileCountsHtml(f) {
  if (f.binary) return '<span class="hint">binary</span>';
  if (f.added == null) return '';
  return `<span class="diff-add">+${f.added}</span> <span class="diff-del">−${f.removed}</span>`; // U+2212
}

function buildHdDiff(sec, record, data) {
  sec.innerHTML = '';
  const results = data.results;
  if (!results) {
    const empty = document.createElement('div');
    empty.className = 'hd-diff-empty';
    const line = document.createElement('div');
    line.textContent = 'No diff captured for this run.';
    empty.appendChild(line);
    if (String(data.state.status || '').toLowerCase() !== 'done') {
      const sub = document.createElement('div');
      sub.className = 'hint';
      sub.textContent = 'Diffs are captured when a run completes.';
      empty.appendChild(sub);
    }
    sec.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'hd-diff';
  const listCard = document.createElement('div');
  listCard.className = 'hd-diff-list';
  const pane = document.createElement('div');
  pane.className = 'hd-diff-pane';
  grid.append(listCard, pane);
  sec.appendChild(grid);

  const sums = results.summary || {};
  const head = document.createElement('div');
  head.className = 'hd-diff-list-head';
  // NOT + filesDeleted: 'D' rows already count in filesChanged (see HD_TABS).
  const nFiles = (sums.filesNew || 0) + (sums.filesChanged || 0);
  head.innerHTML = `<b>${nFiles} file${nFiles === 1 ? '' : 's'} changed</b>` +
    `<span class="mono"><span class="diff-add">+${sums.linesAdded || 0}</span> ` +
    `<span class="diff-del">−${sums.linesRemoved || 0}</span></span>`; // U+2212
  listCard.appendChild(head);

  const rowsHost = document.createElement('div');
  rowsHost.className = 'hd-diff-rows';
  listCard.appendChild(rowsHost);

  const rows = hdDiffFileRows(results);
  // patchPromise memoizes the ONE fetch (concurrent selects await the same
  // promise — a bare boolean flag would let a second click read a null index
  // mid-flight); selEpoch drops the stale continuation when the user picks
  // another file while the patch is still downloading (without it both selects
  // resume after the await and append two bodies to the same pane).
  const pstate = { index: null, patchPromise: null, error: null, selEpoch: 0 };

  function ensurePatch() {
    if (!pstate.patchPromise) {
      pstate.patchPromise = (async () => {
        pstate.error = null;
        try {
          const res = await fetch(historyDiffUrl(record.id, record));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          pstate.index = patchIndex(splitPatchSections(await res.text()));
        } catch (e) {
          pstate.error = e.message;
          // Drop the memo, exactly as the Logs tab re-arms itself: keeping a SETTLED
          // rejection here would show "Could not load the patch: …" for every file
          // for the life of the screen, recoverable only through Back + reopen.
          // Concurrent awaiters already hold this promise, so they still settle.
          pstate.patchPromise = null;
        }
      })();
    }
    return pstate.patchPromise;
  }

  async function select(rowEl, entry) {
    const epoch = ++pstate.selEpoch;
    for (const r of rowsHost.querySelectorAll('.hd-diff-file')) r.classList.toggle('active', r === rowEl);
    pane.innerHTML = '';
    const ph = document.createElement('div');
    ph.className = 'hd-diff-pane-head mono';
    ph.innerHTML = `<span class="hd-diff-path">${escapeHtml(entry.f.path)}</span>`
      + `<span>${hdFileCountsHtml(entry.f)}</span>`;
    pane.appendChild(ph);

    await ensurePatch();
    if (epoch !== pstate.selEpoch) return; // a newer selection took the pane

    const body = document.createElement('div');
    body.className = 'hd-diff-body mono';
    const section = pstate.index && pstate.index.get(sectionKey(entry.project, entry.f.path));
    if (!section) {
      body.classList.add('hint');
      body.textContent = pstate.error
        ? `Could not load the patch: ${pstate.error}`
        : '(no textual diff for this file)';
      pane.appendChild(body);
      return;
    }
    const parsed = parseFileSection(section.raw);
    if (parsed.binary || !parsed.hunks.length) {
      body.classList.add('hint');
      body.textContent = '(no textual diff for this file)';
      pane.appendChild(body);
      return;
    }
    for (const hunk of parsed.hunks) {
      const hh = document.createElement('div');
      hh.className = 'hd-dl hd-dl-hunk';
      hh.textContent = hunk.header;
      body.appendChild(hh);
      for (const line of hunk.lines) {
        const dl = document.createElement('div');
        dl.className = `hd-dl hd-dl-${line.kind}`;
        // ASCII prefixes on purpose: this is a verbatim patch a user may copy —
        // a U+2212 here yields something `git apply` rejects. U+2212 stays in the
        // COUNT chips above.
        dl.textContent = (line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ') + line.text;
        body.appendChild(dl);
      }
    }
    if (parsed.truncated) {
      const t = document.createElement('div');
      t.className = 'hint hd-diff-trunc';
      t.textContent = '(large file — diff truncated at 500 KB)';
      body.appendChild(t);
    }
    pane.appendChild(body);
  }

  let lastProject = null;
  let first = null;
  for (const entry of rows) {
    if (entry.project && entry.project !== lastProject) {
      lastProject = entry.project;
      const gh = document.createElement('div');
      gh.className = 'hd-diff-proj mono';
      gh.textContent = entry.project;
      rowsHost.appendChild(gh);
    }
    const rowEl = document.createElement('div');
    rowEl.className = 'hd-diff-file' + (entry.f.status === 'D' ? ' deleted' : '') + (entry.isNew ? ' new' : '');
    rowEl.setAttribute('role', 'button');
    rowEl.tabIndex = 0;
    const path = document.createElement('span');
    path.className = 'hd-diff-path mono';
    path.textContent = entry.f.path;
    path.title = entry.f.from ? `${entry.f.from} → ${entry.f.path}` : entry.f.path;
    const counts = document.createElement('span');
    counts.className = 'mono hd-diff-counts';
    counts.innerHTML = hdFileCountsHtml(entry.f);
    rowEl.append(path, counts);
    // `select` is async and fire-and-forget from all three call sites, so it needs
    // an explicit sink: node --test fails the WHOLE file on an unhandled rejection
    // and pins it on whichever test happens to be in flight.
    const pick = () => { select(rowEl, entry).catch(() => {}); };
    rowEl.addEventListener('click', pick);
    rowEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
    rowsHost.appendChild(rowEl);
    if (!first) first = { rowEl, entry };
  }
  if (first) select(first.rowEl, first.entry).catch(() => {});
  else {
    const none = document.createElement('div');
    none.className = 'hint hd-diff-none';
    none.textContent = '(no files changed)';
    pane.appendChild(none);
  }
}

// --- Overview tab: verdict, stat cards, task card ---------------------------

function hdStatCard(kind, label, value, sub) {
  const card = document.createElement('div');
  card.className = `hd-ov-card hd-ov-card-${kind}`;
  const l = document.createElement('div'); l.className = 'hd-ov-label'; l.textContent = label;
  const v = document.createElement('div'); v.className = 'hd-ov-value mono'; v.textContent = value;
  card.append(l, v);
  if (sub) { const s = document.createElement('div'); s.className = 'hd-ov-sub mono'; s.textContent = sub; card.appendChild(s); }
  return card;
}

// Workspace results have NO top-level keyThingsToCheck — findings live under
// perProject[<key>].keyThingsToCheck (the rollup summary only counts them), so a
// workspace run would otherwise always read "Clean".
function hdChecks(r) {
  if (!r) return [];
  if (r.perProject && typeof r.perProject === 'object') {
    return Object.entries(r.perProject).flatMap(([k, pr]) =>
      ((pr && pr.keyThingsToCheck) || []).map((c) => ({ ...c, location: c.location ? `${k}: ${c.location}` : k })));
  }
  return r.keyThingsToCheck || [];
}

function buildHdOverview(sec, record, data) {
  sec.innerHTML = '';
  const st = data.state;
  const results = data.results;
  const wrap = document.createElement('div');
  wrap.className = 'hd-ov';
  sec.appendChild(wrap);

  // 1) Verdict banner (+ findings list).
  const verdict = document.createElement('div');
  verdict.className = 'hd-ov-verdict';
  const chip = document.createElement('span');
  chip.className = 'hd-ov-chip';
  const checks = hdChecks(results);
  if (results && !checks.length) {
    verdict.classList.add('clean');
    chip.classList.add('clean');
    chip.textContent = 'Clean';
    verdict.append(chip, document.createTextNode(' Clean — no blocking issues flagged.'));
  } else if (results) {
    verdict.classList.add('warn');
    chip.classList.add('warn');
    chip.textContent = String(checks.length);
    verdict.append(chip, document.createTextNode(
      ` ${checks.length} thing${checks.length === 1 ? '' : 's'} to check`));
  } else {
    const { family, word } = histStatusMeta({ status: st.status });
    verdict.classList.add('none');
    chip.classList.add(`st-${family}`);
    chip.textContent = word;
    verdict.append(chip, document.createTextNode(' No review results captured — the run did not complete.'));
  }
  wrap.appendChild(verdict);
  if (checks.length) wrap.appendChild(issueList(checks.map((c) => ({ ...c, origin: 'review' }))));

  // 2) Stat cards.
  const grid = document.createElement('div');
  grid.className = 'hd-ov-grid';
  const steps = Array.isArray(st.steps) ? st.steps : [];
  const maxCycle = steps.reduce((m, s) => Math.max(m, Number(s && s.cycle) || 0), 0) || 1;
  grid.appendChild(hdStatCard('duration', 'DURATION',
    typeof st.totalActiveMs === 'number' ? fmtDuration(st.totalActiveMs) : '—',
    `${steps.length} step${steps.length === 1 ? '' : 's'} · ${maxCycle} cycle${maxCycle === 1 ? '' : 's'}`));
  const costCard = hdStatCard('cost', 'COST',
    typeof st.totalCostUsd === 'number' ? fmtUsd(st.totalCostUsd) : '—',
    `across ${steps.length} step${steps.length === 1 ? '' : 's'}`);
  if (typeof st.totalCostUsd === 'number') costCard.querySelector('.hd-ov-value').title = estTitle(st.totalCostUsd);
  grid.appendChild(costCard);
  const wt = st.branch && typeof st.branch === 'object' ? st.branch : {};
  // `worktreeRemoved` is ABSENT on a paused run, `true` after teardown
  // (orchestrator.mjs:1443/1489/1498/1597/1604) and explicitly `false` on the
  // commit-failure path (:1721, asserted by test/run-root-teardown.test.mjs:145).
  // So it is tri-state, and `!== true` is the correct test for all three — do NOT
  // "simplify" it to `=== false`, which would read `released` for every paused run.
  // Running rows are in History too (listAllPipelines filters only
  // `archived_at IS NULL`), and a live run's worktree is very much still on disk —
  // gating on PAUSED_STATUSES alone printed the live path under "released".
  const wtStatus = String(st.status || '').toLowerCase();
  const wtLive = PAUSED_STATUSES.includes(wtStatus) || ['running', 'starting'].includes(wtStatus);
  const retained = !!record.retainedWork || (wtLive && !!wt.worktreeDir && wt.worktreeRemoved !== true);
  // NOTE: `record.retainedWork` is stripped from the localStorage cache
  // (app.js:8161) and absent from a deep link's stub, so this card can read
  // `released` for a commit-failed run until the authoritative row lands. That
  // window closes ONLY because refreshHdOverviewTab() repaints this body from
  // refreshHdFromRow — nothing else ever rebuilds a tab. (Do not "simplify" that
  // call away: the header painters run on every row arrival, but the tab bodies do
  // not, so without it the card would read `released` for the life of the screen.)
  grid.appendChild(hdStatCard('worktree', 'WORKTREE', retained ? 'retained' : 'released', wt.worktreeDir || ''));
  wrap.appendChild(grid);

  // 3) Task card.
  const task = document.createElement('div');
  task.className = 'hd-ov-task';
  const th = document.createElement('div'); th.className = 'hd-ov-task-h'; th.textContent = 'Task';
  task.appendChild(th);
  const prompt = String(st.prompt || '').trim();
  const p = document.createElement('p');
  const LIMIT = 600;
  if (prompt.length > LIMIT) {
    p.textContent = prompt.slice(0, LIMIT) + '…';
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'hd-ov-more';
    more.textContent = 'Show more';
    more.addEventListener('click', () => { p.textContent = prompt; more.remove(); });
    task.append(p, more);
  } else {
    p.textContent = prompt || '(no prompt recorded)';
    task.appendChild(p);
  }
  const chips = document.createElement('div');
  chips.className = 'hd-ov-chips';
  const subCount = Array.isArray(st.subAgents) ? st.subAgents.length : 0;
  for (const text of [
    record.projectName || record.projectKey || '',
    (st.branch && typeof st.branch === 'object' ? st.branch.source : '') || record.sourceBranch || '',
    subCount ? `${subCount} sub-agent${subCount === 1 ? '' : 's'}` : '',
  ]) {
    if (!text) continue;
    const c = document.createElement('span');
    c.className = 'hd-ov-tag mono';
    c.textContent = text;
    chips.appendChild(c);
  }
  task.appendChild(chips);
  wrap.appendChild(task);
}

// One sub-agent's wall time. `durationMs` is authoritative when the orchestrator
// recorded it; everything else on a sub-agent row except id/status/skills may be
// null (listSubAgents, artifacts.mjs:387-411), so fall back to the timestamp pair
// and give up rather than render a negative or NaN span.
function hdSubDuration(s) {
  if (s && s.durationMs != null && Number.isFinite(Number(s.durationMs))) return Number(s.durationMs);
  const a = s && s.startedAt ? Date.parse(s.startedAt) : NaN;
  const b = s && s.finishedAt ? Date.parse(s.finishedAt) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
}

// Agents tab: one card per MAIN agent that ran (subsGroupsForRender derives the
// groups from state.steps[], so skill-only / graphify-only agents get a card too),
// each carrying its sub-agent rows. Same grouping + pill helpers as the Running
// view's renderSubsTree, laid out as rows rather than a tree.
function buildHdAgents(sec, record, data) {
  sec.innerHTML = '';
  const st = data.state;
  const groups = subsGroupsForRender(st.subAgents, st.steps, st.stepper);
  const keys = Object.keys(groups);
  if (!keys.length) {
    const empty = document.createElement('div');
    empty.className = 'hint hd-ag-empty';
    empty.textContent = '(no sub-agents recorded)';
    sec.appendChild(empty);
    return;
  }
  const labelOf = cycleAwareLabel(st.stepper, st.subAgents, keys);
  const skillsByGroup = stepSkillsFromSteps(st.steps);
  const graphifyByGroup = stepGraphifyFromSteps(st.steps);
  const statusOf = stepStatusByKey(st.steps, st.stepper);

  for (const key of keys) {
    const list = Array.isArray(groups[key]) ? groups[key] : [];
    const card = document.createElement('div');
    card.className = 'hd-ag-group';
    // Non-empty: roll up from the rows. Empty: the main agent's own step status —
    // subGroupStatus would report a bare 'done' for an agent that is still running.
    const gstat = list.length ? subGroupStatus(list) : (statusOf[key] || 'done');
    const durSum = list.reduce((n, s) => n + (hdSubDuration(s) || 0), 0);
    const costSum = list.reduce((n, s) => n + (Number(s && s.costUsd) || 0), 0);
    const metaBits = [
      `${list.length} sub-agent${list.length === 1 ? '' : 's'}`,
      durSum ? fmtDuration(durSum) : '',
      costSum ? fmtUsd4(costSum) : '',
    ].filter(Boolean).join(' · ');
    const head = document.createElement('div');
    head.className = 'hd-ag-head';
    head.innerHTML =
      `<b>${escapeHtml(labelOf(key))}</b>` +
      `<span class="subs-stat ${gstat}">${SUBS_STAT_TEXT[gstat] || gstat}</span>` +
      graphifyCountPillHtml(graphifyByGroup[key]) +
      `<span class="hd-ag-meta mono">${escapeHtml(metaBits)}</span>` +
      skillPillsHtml(skillsByGroup[key]);
    card.appendChild(head);
    if (!list.length) {
      const note = document.createElement('div');
      note.className = 'hint hd-ag-none';
      note.textContent = 'No sub-agents spawned';
      card.appendChild(note);
    }
    for (const s of list) {
      const rstat = subRowStatus(s && s.status);
      const dur = hdSubDuration(s);
      const row = document.createElement('div');
      row.className = 'hd-ag-row';
      // skillPillsHtml goes LAST, exactly as renderSubsTree emits it
      // (the `.subs-tree li .subs-skills` rule below is extended to `.hd-ag-row`,
      // giving the pill block `flex:0 0 100%`), so a mid-row pill block would
      // force-wrap the line: the status chip, duration and cost would drop onto a
      // second row with the chip floated alone at the far right by
      // `margin-left:auto`. Last = the pills get their own row under a complete
      // first line, which is the intended design.
      row.innerHTML =
        `<span class="hd-ag-name">${escapeHtml((s && s.label) || (s && s.id) || '')}</span>` +
        agentTypePillHtml(s && s.subagentType) +
        graphifyCountPillHtml(s && s.graphifyCount) +
        `<span class="st ${rstat}">${SUBS_STAT_TEXT[rstat] || rstat}</span>` +
        `<span class="hd-ag-dur mono">${dur != null ? escapeHtml(fmtDuration(dur)) : ''}</span>` +
        `<span class="hd-ag-cost mono">${s && s.costUsd != null ? escapeHtml(fmtUsd4(s.costUsd)) : ''}</span>` +
        skillPillsHtml(s && s.skills);
      card.appendChild(row);
    }
    sec.appendChild(card);
  }
}

// Clarify tab: the run's own clarification round first, then one captioned block
// per mid-run step round. Every question is a card with its ASK line and its ANS
// line, so an unanswered question still reads as a question that was asked.
function buildHdClarify(sec, record, data) {
  sec.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'hd-cl';
  sec.appendChild(wrap);
  // readPipelineExtras already UNWRAPS clarify to {questions:[…], answers:[…]};
  // answers are {id, question, choice}.
  const questions = (data.clarify && data.clarify.questions) || [];
  const answers = (data.clarify && data.clarify.answers) || [];
  const byId = new Map(answers.map((a) => [a.id, a]));
  const addCard = (q, ans) => {
    const card = document.createElement('div');
    card.className = 'hd-cl-card';
    const qRow = document.createElement('div');
    qRow.className = 'hd-cl-q';
    const qChip = document.createElement('span');
    qChip.className = 'hd-cl-chip ask mono';
    qChip.textContent = 'ASK';
    const qText = document.createElement('span');
    qText.textContent = typeof q.question === 'string' ? q.question : '';
    qRow.append(qChip, qText);
    const aRow = document.createElement('div');
    aRow.className = 'hd-cl-a';
    const aChip = document.createElement('span');
    aChip.className = 'hd-cl-chip ans mono';
    aChip.textContent = 'ANS';
    const aText = document.createElement('span');
    const chosen = ans && typeof ans.choice === 'string' ? ans.choice.trim() : '';
    aText.textContent = chosen || '(none)';
    aRow.append(aChip, aText);
    card.append(qRow, aRow);
    wrap.appendChild(card);
  };
  for (const q of questions) addCard(q, byId.get(q.id));
  for (const r of Array.isArray(data.stepQuestions) ? data.stepQuestions : []) {
    if (!((r && r.questions) || []).length) continue;
    const caption = document.createElement('div');
    caption.className = 'hint hd-cl-caption';
    const cyc = String(r.stepKey || '').split('#')[1];
    caption.textContent = `${r.agentKey || r.nodeId || 'agent'} — round ${r.round}${cyc ? ` · cycle ${cyc}` : ''}`;
    wrap.appendChild(caption);
    const rById = new Map((r.answers || []).map((a) => [a.id, a]));
    for (const q of r.questions) addCard(q, rById.get(q.id));
  }
}

// Logs tab: no fork of the log stack. loadLiveLogs owns the markup (the filter bar
// cloned from #run-card-tpl + the .log box), the fetch, the facets, the filter and
// the cycle separators, so the detail gets exactly the Running view's behavior.
function buildHdLogs(sec, record, _data) {
  sec.classList.add('hd-sec-logs');
  // Safe to call on a section initHdTabs has already stamped: loadLiveLogs has no
  // dataset.loaded guard of its own (its callers own that), and its error
  // path clears panel.dataset.loaded — the SAME flag the tab uses — so a failed
  // fetch re-arms the tab to retry on the next activation.
  //
  // `.catch` is not decoration: loadLiveLogs is async and called fire-and-forget,
  // and its first statements (buildLogFilterBar(), panel.innerHTML = '') sit OUTSIDE
  // its own try. An unhandled rejection fails the entire node --test file and
  // misattributes it to another test.
  loadLiveLogs(sec, historyLogUrl(record.id, record)).catch(() => {});
}

// Escape on the History detail screen navigates back to the list — but never
// while an overlay modal is open (those own Escape). Capture-phase so the guard
// reads each modal's PRE-close state; the viewer's own handler and confirmModal's
// per-invocation handler run in bubble phase after.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (currentView() !== 'history') return;
  if (!el.histShell || !el.histShell.classList.contains('detail-open')) return;
  if (el.viewerCard && !el.viewerCard.classList.contains('hidden')) return;
  if (el.confirmModal && !el.confirmModal.classList.contains('hidden')) return;
  if (el.pluginModal && !el.pluginModal.classList.contains('hidden')) return;
  const ship = document.getElementById('shipit-modal');
  if (ship && !ship.classList.contains('hidden')) return;
  location.hash = 'history';
}, true);

async function viewPipeline(projectDir, id, title, record) {
  if (!id) return;
  try {
    const url = historyDetailUrl(projectDir, id, record);
    const res = await fetch(url);
    const data = await safeJson(res);
    if (!res.ok) {
      showViewer(title || id, `Could not load pipeline: ${data.error || res.status}`);
      return;
    }
    const md = data.auditMarkdown || '(no saved markdown)';
    showViewer(title || id, md);
  } catch (e) {
    showViewer(title || id, `Error: ${e.message}`);
  }
}

function showViewer(title, text) {
  el.viewerTitle.textContent = title ? `Saved: ${title}` : 'Saved pipeline';
  el.viewer.textContent = text;
  el.viewerCard.classList.remove('hidden');
  el.viewerCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideViewer() {
  el.viewerCard.classList.add('hidden');
}
el.viewerClose.addEventListener('click', hideViewer);
// Close the modal on backdrop click (overlay itself, not its inner card)...
el.viewerCard.addEventListener('click', (e) => {
  if (e.target === el.viewerCard) hideViewer();
});
// ...and on Escape, when it's open.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el.viewerCard.classList.contains('hidden')) hideViewer();
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function fmtDate(v) {
  if (!v) return '';
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

// ---------------------------------------------------------------------------
// Multi-run rendering: one card per live run in the Running view.
// ---------------------------------------------------------------------------

// A run is "live" while it is starting/running/pausing OR has a pending
// question. 'pausing' keeps the card visible through the graceful shutdown;
// 'paused' is NOT live — the done(paused) event routes through finishRun and
// the run's home becomes History. Terminal statuses (done|error|stopped) are
// never live; on finish we also clear pendingQuestion, so a lingering question
// can't keep it live.
// The `!r._finished` guard ensures a run that has been through finishRun can
// never re-enter the live list — even if an out-of-order event or a future
// hello upserts it with a live `status` again. The terminal exclusion routes
// through isTerminalStatus so the done|error|stopped definition lives in one
// place (shared with postAnswer's guard).
function liveRuns() {
  return [...runs.values()].filter(
    (r) =>
      !r._finished &&
      !isTerminalStatus(r.status) &&
      (r.status === 'starting' || r.status === 'running' || r.status === 'pausing' || r.pendingQuestion != null)
  );
}

// Orchestration pipelines only (Q&A #1). 'run' covers a missing kind (server default).
function isPipelineRun(r) {
  return r.kind === 'run' || r.kind === 'workspace-run' || r.kind == null;
}

// Single source of truth for "is this run live". liveRuns() keeps its own inline
// copy for the badge; keep the two predicates identical if either changes.
function isLive(r) {
  return !r._finished && !isTerminalStatus(r.status) &&
    (r.status === 'starting' || r.status === 'running' || r.status === 'pausing' || r.pendingQuestion != null);
}

// A finished PIPELINE lingers iff it finished live (in `lingering`) and is unacknowledged.
function isLingering(r) {
  return isPipelineRun(r) && !isLive(r) && lingering.has(r.runId) && !acknowledged.has(r.runId);
}

// A PAUSED run is parked in Running (resumable), NOT a finished result. It stays
// in the Running list until resumed or stopped — never acknowledged, never moved
// to History (suppressed there by pipelineId). Distinct from a lingerer: a
// lingerer is a finished run awaiting a glance; a paused run is mid-flight work.
function isPaused(r) {
  return r.status === 'paused';
}

// Drives child tabs + the roll-up dot (pipeline-only, Q&A #1).
function pipelineTabRuns() {
  return [...runs.values()]
    .filter((r) => isPipelineRun(r) && (isLive(r) || isLingering(r) || isPaused(r)))
    .sort(cmpTabRuns);
}

// Drives the Overview #run-list. KIND-AGNOSTIC for live runs (preserves today's
// behavior: live scans/agentgen/workspace-runs still render as cards — Q&A #3),
// PLUS lingering pipelines (the linger feature) and PAUSED runs (parked, resumable).
// Deduped via the Map values being unique objects; sorted by the same group ordering.
function overviewRuns() {
  return [...runs.values()]
    .filter((r) => isLive(r) || isLingering(r) || isPaused(r))
    .sort(cmpTabRuns);
}

// Ordering (spec): needs-attention → running/starting → finished-unread;
// newest-created first within a group. STABLE while running: log activity
// never reorders (orderKey is assigned once in makeRun, never bumped).
function tabGroupRank(r) {
  if (r.pendingQuestion != null) return 0;
  if (isLive(r)) return 1;
  return 2; // lingering finished
}
function cmpTabRuns(a, b) {
  const g = tabGroupRank(a) - tabGroupRank(b);
  if (g) return g;
  return (b.orderKey || 0) - (a.orderKey || 0);
}

// Status dot family for a child row (left edge). Reuses existing color tokens.
// For a LIVE run the dot matches the color of the current agent/phase (same
// mapping as the status pill), so the dot reads as "who's running now". The
// awaiting-input state is surfaced separately by the pulsing '?' end marker, so
// it no longer hijacks the dot color.
function runDotClass(r) {
  if (r.status === 'starting' || r.status === 'pausing') return 'grey-pulse';
  // Paused: parked + resumable. Static amber (NOT the red "did-not-complete" dot,
  // and NOT a pulse — nothing is running). Checked before the terminal branch
  // because a paused run is _finished.
  if (r.status === 'paused') return 'paused';
  if (r._finished || isTerminalStatus(r.status)) return r.status === 'done' ? 'green' : 'red';
  // running → color by current phase/agent (mirrors statusPill families)
  switch (r.phaseKey) {
    case 'plan': return 'violet';
    case 'refine': return 'peach';
    case 'implement': return 'blue';
    case 'review': return 'peach';
    case 'clarify': return 'red';
    default: return 'peach';
  }
}

// Project basename for display (e.g. "/a/b/proj" -> "proj").
function projectName(dir) {
  if (!dir) return '(no project)';
  const parts = String(dir).replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || dir;
}

// Derive an HH:MM:SS label from an ISO timestamp; pass through anything that
// already looks like a bare time string.
function startedLabel(startedAt) {
  if (!startedAt) return '';
  const d = new Date(startedAt);
  if (!isNaN(d.getTime())) return d.toTimeString().slice(0, 8);
  return String(startedAt);
}

const PHASE_LABEL = { preflight: 'Preflight', clarify: 'Clarify', plan: 'Plan', refine: 'Refine', implement: 'Implement', review: 'Review', 'manual-checklist': 'Manual tests', 'manual-web': 'Manual web UI', done: 'Done' };

// Status-pill copy map (committed — no '?'). Returns { family, text }.
// pausing/paused are checked BEFORE the pendingQuestion state so an in-flight
// pause is never mislabeled "awaiting answers".
function statusPill(r) {
  if (r.status === 'pausing') return { family: 'amber', text: 'Pausing…' };
  if (r.status === 'paused') {
    // A cost pause names its cause so the pill alone explains why the run parked.
    if (r.pauseReason === 'cost_pipeline') return { family: 'amber', text: 'Paused · cost limit' };
    if (r.pauseReason === 'cost_total') return { family: 'amber', text: 'Paused · total budget' };
    return { family: 'amber', text: 'Paused' };
  }
  if (r.pendingQuestion != null) return { family: 'amber', text: 'Paused · awaiting answers' };
  if (r.status === 'starting') return { family: 'peach', text: 'Starting' };
  if (r.status === 'done') return { family: 'green', text: 'Done' };
  if (r.status === 'stopped') return { family: 'red', text: 'Stopped' };
  if (r.status === 'error') return { family: 'red', text: 'Error' };
  // running
  switch (r.phaseKey) {
    case 'plan': return { family: 'violet', text: 'Planning' };
    case 'refine': return { family: 'peach', text: 'Refining' };
    case 'implement': return { family: 'blue', text: 'Implementing' };
    case 'review': return { family: 'peach', text: 'Reviewing' };
    case 'plan-review': return { family: 'violet', text: 'Plan Review' };
    default: return { family: 'peach', text: 'Running' };
  }
}

// Render the run-card meta line (project · started · branch). Called from
// buildRunCard (with the freshly built node, before r.el is assigned) AND from
// paintRunCard on every repaint, so a branch that arrives on a later `state`
// event (or a resume) refreshes the line instead of leaving it stale.
function renderRunMeta(r, root = r.el) {
  if (!root) return;
  const metaEl = root.querySelector('.rm-text');
  if (!metaEl) return;
  const branchTxt = r.branchFeature ? ` · ${r.branchFeature}` : '';
  metaEl.textContent = `${projectName(r.projectDir)} · started ${startedLabel(r.startedAt)}${branchTxt}`;
}

function buildRunCard(r) {
  const tpl = $('#run-card-tpl');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.runId = r.runId;

  // Build the graph from the run's manifest. r.stepper may be null -> legacy default.
  const stepHost = node.querySelector('.run-flow');
  if (stepHost) buildRunGraph(stepHost, r.stepper);

  const titleEl = node.querySelector('.run-title');
  if (titleEl) {
    titleEl.textContent = r.title;
    if (r.titleProvisional) titleEl.classList.add('title-provisional');
  }
  renderRunMeta(r, node);

  // Hydrate the log from any events that arrived before the card existed,
  // through the run's current filter, and offer the facets seen so far.
  // paintLogFilters may repaint once more if a stale selection fell back to
  // "all" — cheap, and it keeps the pane and the dropdowns consistent.
  // The clone's search box is born empty; mirror the run's stored term so the
  // visible bar matches the filter the repaint below actually applies.
  const searchBox = node.querySelector('.log-search');
  if (searchBox) searchBox.value = r.logFilter.search || '';
  repaintFilteredLog(r, node);
  paintLogFilters(r, node);

  // The switch is cloned ON from the template; mirror the run's persisted choice so
  // a rebuild (finish/resume/reconcile) never silently re-enables auto-scroll.
  // Operate on `node` — in the normal path r.el is assigned by the caller
  // (paintRunList:7744), not here.
  syncAutoscrollSwitch(r, node);

  // A2: a card built from a hello-seeded pending question (mid-pause reload, the
  // original `question` event may be past the replay buffer) must render the
  // panel immediately from r.pendingQuestion — independent of any replayed
  // event. r.el must be set before renderQpanel reads it.
  if (r.pendingQuestion != null) {
    r.el = node;
    renderQpanel(r);
  }

  return node;
}

// Running -> graph status per node. done if its cell is behind the frontier or
// nodeStatus says done; at the frontier: stop->stopped, pause->paused, now->active;
// else pending. terminalDone (run status 'done') forces all-done.
function runStatusOf(r, nodeId, cellIdx, terminalDone, halted) {
  if (terminalDone) return 'done';
  if (cellIdx < r.maxCellIdx) return 'done';
  if (cellIdx > r.maxCellIdx) return 'pending';
  // Frontier cell.
  const k = r.nodeStatus[nodeId];
  if (k === 'done') return 'done';
  // A halted run (stopped/error/aborted/failed) shows its frontier node as
  // stopped even if the last live phase left it 'now' — the halt arrives as a
  // bare state event with no node-level phase to mark the cell.
  if (halted) return 'stopped';
  if (k === 'stop') return 'stopped';
  if (k === 'pause') return 'paused';
  if (k === 'now') return 'active';
  return 'pending';
}

// Pill text + colour from a {nodeId: Array<{status}>} grouping. "active" =
// subs still running; a finished/historical run has none -> grey "N sub-agents".
function subsPillText(byNode) {
  const groups = byNode && typeof byNode === 'object' ? Object.values(byNode) : [];
  let spawned = 0;
  let active = 0;
  for (const list of groups) {
    if (!Array.isArray(list)) continue;
    spawned += list.length;
    for (const s of list) if (s && s.status === 'running') active += 1;
  }
  return active > 0
    ? { text: `${spawned} spawned · ${active} active`, active: true }
    : { text: `${spawned} sub-agents`, active: false };
}

// Paint the "Sub-agents" pill + (lazily) its tree panel from a by-node grouping.
// Hidden entirely when there are no sub-agents. The disclosure (aria-expanded +
// [hidden] + chevron rotate) is the shared bar idiom. Idempotent: the click
// handler is bound once (dataset guard), the count/text repaint every call.
function paintSubsBar(barEl, byNode, labelOf, stepSkills, stepGraphify, statusByKey) {
  if (!barEl) return;
  const groups = byNode && typeof byNode === 'object' ? byNode : {};
  // Show whenever at least one main agent ran (>=1 group), not just when sub-agents
  // exist — so graphify/skill-only agents are visible. Hidden only when nothing ran.
  if (Object.keys(groups).length === 0) { barEl.hidden = true; return; }
  barEl.hidden = false;

  const btn = barEl.querySelector('.btn-subs');
  const panel = barEl.querySelector('.subs-panel');
  const count = barEl.querySelector('.sb-count');
  const labelFn = typeof labelOf === 'function' ? labelOf : (id) => id;
  // Per-CARD state on the element (NOT a module-level function static) — the app
  // paints multiple concurrent run cards; a function static would bleed the most
  // recently painted card's grouping/labels into another card's open panel.
  barEl._subsGroups = groups;
  barEl._subsLabelOf = labelFn;
  barEl._subsStepSkills = stepSkills && typeof stepSkills === 'object' ? stepSkills : {};
  barEl._subsStepGraphify = stepGraphify && typeof stepGraphify === 'object' ? stepGraphify : {};
  barEl._subsStatusByKey = statusByKey && typeof statusByKey === 'object' ? statusByKey : {};

  const { text, active } = subsPillText(groups);
  if (count) {
    count.textContent = text;
    count.classList.toggle('grey', !active);
  }

  // Re-render an already-open panel in place so live spawns/finishes reflect immediately.
  if (panel && btn && btn.getAttribute('aria-expanded') === 'true') {
    renderSubsTree(panel, groups, labelFn, barEl._subsStepSkills, barEl._subsStepGraphify, barEl._subsStatusByKey);
  }

  if (btn && btn.dataset.bound !== '1') {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (panel) {
        panel.hidden = open;
        if (!open) renderSubsTree(panel, barEl._subsGroups || {}, barEl._subsLabelOf, barEl._subsStepSkills || {}, barEl._subsStepGraphify || {}, barEl._subsStatusByKey || {});
      }
    });
  }
}

// Group rollup for a step's sub-agents: anyStop (stop|error) -> 'stop',
// else anyRun -> 'run', else 'done'. Drives the .subs-stat / .dot colour.
function subGroupStatus(list) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.some((s) => s && (s.status === 'stopped' || s.status === 'error'))) return 'stop';
  if (arr.some((s) => s && s.status === 'running')) return 'run';
  return 'done';
}

// Per-sub-agent row status -> the mono badge / .led class. running -> run (lit),
// stopped|error -> stop, else done.
function subRowStatus(status) {
  if (status === 'running') return 'run';
  if (status === 'stopped' || status === 'error') return 'stop';
  return 'done';
}

// .dot colour per group status (matches the .subs-stat palette).
const SUBS_DOT_COLOR = { run: 'var(--blue)', done: 'var(--green)', stop: 'var(--red)' };
const SUBS_STAT_TEXT = { run: 'running', done: 'done', stop: 'stopped' };

// Build the tree panel body from a {nodeId: Array<{id,label,status}>} grouping.
// legend + one .subs-step per node (dot+name+status pill+count) + a .subs-tree
// <li> per sub-agent (led + name + mono status). nodeLabel(id)->display name
// (defaults to the id). Idempotent: the panel is fully rebuilt each call.
// NOTE: squares here are .sq/.led and are NEVER placed under .fan, so the
// graph-only sqPulse animation can never reach them.
// Flex-wrap pill row for kind-tagged labels; '' when empty. The .subs-skills
// container wraps (CSS) so pills reflow as the window shrinks. THREE label kinds
// (§7.4), all of them opaque strings from the orchestrator's capture:
//   skill:<slug>                 -> blue label pill
//   mcp:<server>:<tool>          -> green tool pill, "<server> · <tool>"
//   mcp:<server>                 -> green server pill (the legacy two-part shape)
//   overflow:<n>                 -> §7.1's muted "+N more" pill, ALWAYS last
// The sentinel's position is guaranteed by mergeSkills, so the renderer never
// re-sorts. The cap in its tooltip is DERIVED from the labels actually rendered
// (that count IS the cap when the sentinel is present), so it cannot drift out of
// sync with the orchestrator's SKILLS_MAX.
function skillPillsHtml(skills) {
  const arr = Array.isArray(skills) ? skills : [];
  if (!arr.length) return '';
  const shown = arr.filter((t) => !/^overflow:/.test(String(t))).length;
  const pills = arr.map((raw) => {
    const tag = String(raw);
    const i = tag.indexOf(':');
    const kind = i >= 0 ? tag.slice(0, i) : 'skill';
    const rest = i >= 0 ? tag.slice(i + 1) : tag;
    if (kind === 'overflow') {
      const n = Number(rest);
      if (!Number.isFinite(n) || n <= 0) return '';   // a malformed sentinel renders nothing
      const title = `Pill cap reached (${shown} shown) — ${n} more skill${n === 1 ? '' : 's'}/tools were used`;
      return `<span class="skill-pill is-overflow" title="${escapeHtml(title)}">+${n} more</span>`;
    }
    if (kind === 'mcp') {
      const j = rest.indexOf(':');
      const [server, tool] = j >= 0 ? [rest.slice(0, j), rest.slice(j + 1)] : [rest, ''];
      const cls = tool ? 'skill-pill is-mcp is-mcp-tool' : 'skill-pill is-mcp';
      const text = tool ? `${server} · ${tool}` : server;
      return `<span class="${cls}" title="${escapeHtml(rest)}">${escapeHtml(text)}</span>`;
    }
    return `<span class="skill-pill is-skill">${escapeHtml(rest)}</span>`;
  }).join('');
  if (!pills) return '';                              // no renderable pill -> no empty row
  return `<div class="subs-skills">${pills}</div>`;
}

// Single neutral pill showing a sub-agent's raw subagent_type (e.g. 'general-purpose',
// 'Explore', 'worca-cc-planner'); '' when absent so untyped rows render no pill.
function agentTypePillHtml(type) {
  const t = type == null ? '' : String(type).trim();
  if (!t) return '';
  return `<span class="agent-type-pill">${escapeHtml(t)}</span>`;
}

// Neutral count badge for how many times an agent / sub-agent invoked the graphify
// CLI; '' when the count is absent or 0 so only real users render a badge. The count
// is a number (not user text), so no escaping is needed.
function graphifyCountPillHtml(n) {
  const c = Number(n);
  if (!Number.isFinite(c) || c <= 0) return '';
  return `<span class="graphify-pill">graphify ×${c}</span>`;
}

function renderSubsTree(panelEl, byNode, nodeLabel, stepSkills, stepGraphify, statusByKey) {
  if (!panelEl) return;
  const labelOf = typeof nodeLabel === 'function' ? nodeLabel : (id) => id;
  const groups = byNode && typeof byNode === 'object' ? byNode : {};
  const skillsByGroup = stepSkills && typeof stepSkills === 'object' ? stepSkills : {};
  const graphifyByGroup = stepGraphify && typeof stepGraphify === 'object' ? stepGraphify : {};
  const statusOf = statusByKey && typeof statusByKey === 'object' ? statusByKey : {};
  panelEl.innerHTML =
    '<div class="subs-legend">' +
      '<span class="lk"><span class="sq on"></span>active</span>' +
      '<span class="lk"><span class="sq off"></span>finished</span>' +
    '</div>';

  for (const nodeId of Object.keys(groups)) {            // nodeId === the "nodeId|cycle" group key
    const list = Array.isArray(groups[nodeId]) ? groups[nodeId] : [];
    const empty = list.length === 0;
    // Non-empty: roll up from the sub rows (unchanged). Empty: take the MAIN agent's own
    // step status so a running-but-sub-less agent shows 'running', a finished one 'done'.
    const gstat = empty ? (statusOf[nodeId] || 'done') : subGroupStatus(list);
    const step = document.createElement('div');
    step.className = 'subs-step';
    step.innerHTML =
      '<div class="subs-step-head">' +
        `<span class="dot" style="background:${SUBS_DOT_COLOR[gstat]}"></span>` +
        `<b>${escapeHtml(labelOf(nodeId))}</b>` +
        `<span class="subs-stat ${gstat}">${SUBS_STAT_TEXT[gstat]}</span>` +
        graphifyCountPillHtml(graphifyByGroup[nodeId]) +    // MAIN-agent badge: inline in the header, next to status
        (empty ? '' : `<span class="subs-n">${list.length} sub-agents</span>`) +
      '</div>' +
      skillPillsHtml(skillsByGroup[nodeId]);                // MAIN-agent skill pills keep their own row under the header
    if (empty) {
      const note = document.createElement('div');
      note.className = 'subs-empty';
      note.textContent = 'No sub-agents spawned';
      step.appendChild(note);
    } else {
      const ul = document.createElement('ul');
      ul.className = 'subs-tree';
      for (const s of list) {
        const rstat = subRowStatus(s && s.status);
        const li = document.createElement('li');
        li.innerHTML =
          `<span class="led${rstat === 'run' ? ' on' : ''}"></span>` +
          `<span class="ag-name">${escapeHtml((s && s.label) || (s && s.id) || '')}</span>` +
          agentTypePillHtml(s && s.subagentType) +          // raw subagent_type, inline next to the name
          graphifyCountPillHtml(s && s.graphifyCount) +     // graphify badge: inline, right after the type pill
          `<span class="st ${rstat}">${rstat === 'run' ? 'running' : rstat === 'stop' ? 'stopped' : 'done'}</span>` +
          skillPillsHtml(s && s.skills);                    // per-sub-agent skill pills keep their own wrapped row
        ul.appendChild(li);
      }
      step.appendChild(ul);
    }
    panelEl.appendChild(step);
  }
}

// nodeId -> display label for the tree step headers. Takes a raw stepper and
// normalizes via manifestFor ONCE (callers pass r.stepper / data.state.stepper,
// not a pre-normalized manifest — avoids a redundant double manifestFor). Falls
// back to the raw id for unknown nodes.
function nodeLabelLookup(stepper) {
  const m = manifestFor(stepper);
  const map = {};
  m.steps.forEach((cell) => cell.nodes.forEach((n) => { map[n.id] = n.label || n.id; }));
  return (id) => map[id] || id;
}

function paintStepper(r) {
  if (!r.el) return;
  const host = r.el.querySelector('.run-flow');
  if (!host) return;
  const manifest = manifestFor(r.stepper);
  const terminalDone = r.status === 'done';
  const halted = ['stopped', 'error', 'aborted', 'failed'].includes(r.status);
  const now = Date.now();
  const durs = durByNode(r.steps, now, true);
  const costs = r.costByNode || {};
  const modelsUsed = modelUsedByNode(r.steps);

  // cellIdx per node id (for the frontier comparison).
  const cellOf = {};
  manifest.steps.forEach((cell, i) => cell.nodes.forEach((n) => { cellOf[n.id] = i; }));

  // The active node = the frontier node currently now/pause (drives the live loop).
  let activeId = null;
  const frontier = manifest.steps[r.maxCellIdx];
  if (frontier && !terminalDone) {
    for (const n of frontier.nodes) {
      const k = r.nodeStatus[n.id];
      if (k === 'now' || k === 'pause') { activeId = n.id; break; }
    }
  }

  paintRunGraph(host, manifest, {
    statusOf: (id) => runStatusOf(r, id, cellOf[id] != null ? cellOf[id] : -1, terminalDone, halted),
    activeId,
    cycles: loopCounts(manifest, r.nodeCycle),
    live: true,
    durText: (id) => { const d = durs[id]; return d != null ? fmtDuration(d) : ''; },
    costText: (id) => { const c = costs[id]; return c != null ? fmtUsd(c) : ''; },
    subsOf: (id) => subAgentsForNode(r, id),
    modelUsedOf: (id) => modelsUsed[id],
  });
}

// Does the run's current frontier cell contain a cycling node?
function currentNodeCycles(r) {
  const m = manifestFor(r.stepper);
  const cell = m.steps[r.maxCellIdx];
  return !!(cell && cell.nodes.some((n) => n.cycles));
}

// The run-card template's stock Resume tooltip. Read from the template rather
// than duplicated as a literal so the two cannot drift; painting restores it
// whenever a card is not total-budget blocked, instead of blanking the button.
let _stockResumeTitle = null;
function stockResumeTitle() {
  if (_stockResumeTitle === null) {
    _stockResumeTitle = document.getElementById('run-card-tpl')
      ?.content?.querySelector('.btn-resume')?.title || '';
  }
  return _stockResumeTitle;
}

function paintRunCard(r) {
  if (!r.el) return;

  // Meta line (project · started · branch) — refresh so a branch that lands on a
  // later state/resume event appears without a full card rebuild.
  renderRunMeta(r);

  // Status pill: family class + text, preserving the leading .pdot.
  const pill = r.el.querySelector('.pill-run');
  if (pill) {
    const { family, text } = statusPill(r);
    pill.className = `pill-run ${family}`;
    const txt = pill.querySelector('.pill-text');
    if (txt) txt.textContent = text;
    else pill.textContent = text;
  }

  // Foot chip.
  const chip = r.el.querySelector('.chip');
  if (chip) {
    const phaseLabel = PHASE_LABEL[r.phaseKey] || 'Running';
    if (r.pendingQuestion != null) {
      const n = questionCount(r.pendingQuestion);
      chip.textContent = `${phaseLabel} paused · ${n} question${n === 1 ? '' : 's'}`;
    } else if (currentNodeCycles(r) && r.cycle) {
      chip.textContent = `${phaseLabel} cycle ${r.cycle}`;
    } else {
      chip.textContent = phaseLabel;
    }
  }

  paintStepper(r);
  // subsByNode returns Map<nodeId,{subs,spawned,active}>; paintSubsBar (and the
  // pill/tree helpers) consume a plain {nodeId: Array<{status}>} grouping, which
  // subsByNodeArrays projects from the Map's .subs arrays. (Plan wrote
  // subsByNode(...) directly, but that Map yields Object.values()===[] -> the bar
  // would never show; see report.)
  const subsBar = r.el.querySelector('.subs-bar');
  if (subsBar) {
    const groups = subsGroupsForRender(r.subAgents, r.steps, r.stepper);
    paintSubsBar(
      subsBar, groups,
      cycleAwareLabel(r.stepper, r.subAgents, Object.keys(groups)),
      r.stepSkills || {}, r.stepGraphify || {},
      stepStatusByKey(r.steps, r.stepper),
    );
  }
  const titleEl = r.el.querySelector('.run-title');
  if (titleEl && r.title && titleEl.textContent !== r.title) titleEl.textContent = r.title;
  const timeEl = r.el.querySelector('.run-time');
  if (timeEl) timeEl.textContent = fmtDuration(liveTotalMs(r.steps, Date.now()));
  const totalEl = r.el.querySelector('.run-cost');
  if (totalEl) {
    totalEl.textContent = fmtUsd(r.totalCostUsd || 0); // always shows (mock => $0.00)
    totalEl.title = estTitle(r.totalCostUsd || 0);
  }
  r.el.classList.toggle('attention', r.pendingQuestion != null);

  // Cost-pause banner: rebuilt from the current budget snapshot on every paint so
  // a raised limit / window reset is reflected without a card rebuild.
  const bannerEl = r.el.querySelector('.cost-banner');
  if (bannerEl) {
    const costPaused = isPaused(r) && typeof r.pauseReason === 'string'
      && r.pauseReason.startsWith('cost_');
    if (costPaused) {
      const fresh = renderCostPauseBanner(
        { pauseReason: r.pauseReason, pipelineId: r.pipelineId, totalCostUsd: r.totalCostUsd },
        { budget: budgetState.budget || {},
          fmt: { usd: fmtUsd, usd4: fmtUsd4, duration: fmtDuration, estTitle } });
      bannerEl.replaceChildren(...fresh.childNodes);
      bannerEl.className = fresh.className;
      bannerEl.hidden = false;
    } else {
      bannerEl.hidden = true;
      bannerEl.className = 'cost-banner';
      bannerEl.replaceChildren();
    }
  }

  // Paused → swap Pause for Resume (Stop stays, to discard the paused run).
  const paused = isPaused(r);
  const pauseBtn = r.el.querySelector('.btn-pause');
  const resumeBtn = r.el.querySelector('.btn-resume');
  if (pauseBtn) pauseBtn.hidden = paused;
  if (resumeBtn) resumeBtn.hidden = !paused;
  // A total-budget pause cannot be resumed at all until the window resets or the
  // limit is raised — the server 403s it, so the button says so up front.
  const totalBlocked = r.pauseReason === 'cost_total' && budgetState.budget?.blocked;
  if (resumeBtn) {
    resumeBtn.disabled = !!totalBlocked;
    resumeBtn.title = totalBlocked
      ? `Total budget reached — blocked until ${fmtResetAtLocal(budgetState.budget.windowEndMs)} or a higher total limit`
      : stockResumeTitle();
  }
}

// Repaint every cost-paused card against the current budget snapshot. Iterates
// ALL runs, not liveRuns(): a paused run is _finished and excluded there.
function repaintCostBanners() {
  for (const r of runs.values()) {
    if (isPaused(r) && typeof r.pauseReason === 'string' && r.pauseReason.startsWith('cost_')) {
      paintRunCard(r);
    }
  }
  if (currentView() === 'history') refreshHistResumeGating();
}

function questionCount(pq) {
  if (!pq) return 0;
  if (Array.isArray(pq.questions)) return pq.questions.length;
  if (Array.isArray(pq.issues)) return pq.issues.length;
  return 1;
}

function renderRunningView() {
  if (state.selectedRunId) return renderFocusView(state.selectedRunId);
  renderOverview();
}

// Attach/move one card without losing user scroll state. Re-inserting an
// attached node is spec'd as remove+insert, which zeroes every scrollable
// descendant (.log scrollTop, .run-flow-wrap scrollLeft). Save → insert →
// write back synchronously (before paint), same technique as buildRunGraph's
// scrollLeft preservation across its structural rebuild.
function insertCardPreservingScroll(list, el, before) {
  const logEl = el.querySelector('.log');
  const flowWrap = el.querySelector('.run-flow-wrap');
  const savedTop = logEl ? logEl.scrollTop : 0;
  const savedLeft = flowWrap ? flowWrap.scrollLeft : 0;
  list.insertBefore(el, before || null);
  if (logEl && savedTop) logEl.scrollTop = savedTop;
  if (flowWrap && savedLeft) flowWrap.scrollLeft = savedLeft;
}

// Shared #run-list reconcile. Builds/reuses one card per run, orders to match,
// removes stale cards. Tolerates r.el === null (finishRun evicts non-lingerers).
// buildRunCard RETURNS the node — assign its return to r.el (it self-assigns
// only on the pendingQuestion hydration path, app.js:8405–8407).
// A card already in its correct slot is NOT touched — reattaching an attached
// node resets descendant scroll (log pane, stepper row) and breaks the .main
// scroller's anchoring, which is exactly the scroll-reset-on-every-log bug.
function paintRunList(list, rlist, emptyMsg) {
  if (rlist.length) {
    const empty = list.querySelector('.run-empty');
    if (empty) empty.remove();
  }
  const seen = new Set();
  let prev = null;   // last correctly-placed card
  for (const r of rlist) {
    seen.add(r.runId);
    if (!r.el || r.el.dataset.runId !== r.runId) r.el = buildRunCard(r);
    const inPlace = r.el.parentNode === list && r.el.previousElementSibling === prev;
    if (!inPlace) {
      insertCardPreservingScroll(list, r.el, prev ? prev.nextSibling : list.firstChild);
    }
    paintRunCard(r);
    // Pin to bottom when auto-scroll is ON (no-op when OFF). Idempotent for
    // in-place cards; covers fresh hydration + real moves, where a detached-node
    // scrollTop set earlier was lost (scrollHeight≈0 off-DOM).
    maybeAutoscrollLog(r);
    prev = r.el;
  }
  [...list.children].forEach((c) => {
    if (c.dataset && c.dataset.runId && !seen.has(c.dataset.runId)) c.remove();
  });
  if (!rlist.length) list.innerHTML = `<div class="run-empty">${emptyMsg}</div>`;
}

function renderOverview() {
  const list = $('#run-list');
  if (!list) return;
  const rows = overviewRuns();
  // Overview is kind-agnostic (live scans/agentgen included), so the empty copy
  // must not claim "pipelines" specifically.
  paintRunList(list, rows, 'No active runs — start one from New.');

  // "N pipelines executing" counts LIVE PIPELINES (the sub-text is pipeline-framed);
  // "needs input" counts live runs with a pending question.
  const live = rows.filter(isLive);
  const livePipes = live.filter(isPipelineRun);
  const needs = live.filter((r) => r.pendingQuestion).length;
  const sub = $('#running-sub');
  if (sub) sub.textContent =
    `${livePipes.length} pipeline${livePipes.length === 1 ? '' : 's'} executing · ${needs} need${needs === 1 ? 's' : ''} your input`;
  const pill = $('#running-status-pill');
  if (pill) {
    pill.classList.toggle('hidden', needs === 0);
    const label = `${needs} need${needs === 1 ? 's' : ''} input`;
    const txt = pill.querySelector('.pill-text');
    if (txt) { txt.textContent = label; }
    else {
      // Preserve a leading .pdot if present; replace only the trailing text.
      const dot = pill.querySelector('.pdot');
      pill.textContent = '';
      if (dot) pill.appendChild(dot);
      pill.append(document.createTextNode(' ' + label));
    }
  }
}

function renderFocusView(runId) {
  const list = $('#run-list');
  if (!list) return;
  const r = runs.get(runId);
  // Unknown run (bad deep-link / never existed) → bounce to Overview.
  if (!r) { location.hash = 'running'; return; }
  paintRunList(list, [r], 'Run not found.');   // others hidden — the core "separate visually" fix
}

let runningCollapsed = false; // in-memory only; auto-expanded whenever ≥1 child exists

function renderPipelineTabs() {
  const rows = pipelineTabRuns();

  // Roll-up amber dot = ANY child needs input. Visible from every view.
  const needs = rows.some((r) => r.pendingQuestion != null);
  for (const id of ['#nav-running-rollup', '#topnav-running-rollup']) {
    const dot = $(id); if (dot) dot.hidden = !needs;
  }

  const host = $('#nav-running-children');
  if (!host) return;
  if (rows.length === 0) {
    host.innerHTML = ''; host.dataset.tabsSig = ''; host.classList.add('hidden');
    return;
  }

  // Rebuild gate: every tagged event (incl. every log line) lands here, but a
  // log frame changes nothing a row renders. Skip identical rebuilds so the
  // sidebar DOM (and its scroll position) stays put; any rendered datum
  // changing — order, dot, title, project, end marker, active, lingering,
  // collapsed — changes the signature and repaints as before. JSON.stringify
  // is the encoding: titles/labels are free text, so a hand-joined concat
  // could alias two different states; JSON escaping is unambiguous.
  const sig = JSON.stringify([runningCollapsed, rows.map((r) => [
    r.runId,
    runDotClass(r),
    r.title,
    Array.isArray(r.projectNames) && r.projectNames.length
      ? r.projectNames.join(' · ') : projectName(r.projectDir),
    r.pendingQuestion != null ? 'q'
      : isPaused(r) ? 'p'
      : (r._finished || isTerminalStatus(r.status)) ? (r.status === 'done' ? 'ok' : 'bad')
      : '',
    r.runId === state.selectedRunId,
    isLingering(r),
  ])]);
  if (host.dataset.tabsSig === sig) return;
  host.dataset.tabsSig = sig;

  host.classList.remove('hidden');
  host.classList.toggle('collapsed', runningCollapsed);  // auto-expanded: default false
  host.innerHTML = '';
  for (const r of rows) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'nav-child';
    // NB: a distinct dataset key (NOT data-run-id) — `data-run-id` is the run-card's
    // unique identifier queried unscoped across the suite; reusing it here would make
    // a child row shadow its card in document-order lookups.
    row.dataset.childRunId = r.runId;
    row.classList.toggle('active', r.runId === state.selectedRunId);
    if (isLingering(r)) row.classList.add('lingering'); // greyed

    const dot = document.createElement('span');
    dot.className = `child-dot ${runDotClass(r)}`;

    const body = document.createElement('span');
    body.className = 'child-body';

    const title = document.createElement('span');
    title.className = 'child-title';
    title.textContent = r.title;

    const hint = document.createElement('span');
    hint.className = 'child-proj';
    // Workspace runs list every member project (CSS clamps at three lines);
    // single-project runs keep the lone basename.
    const projLabel = Array.isArray(r.projectNames) && r.projectNames.length
      ? r.projectNames.join(' · ')
      : projectName(r.projectDir);
    hint.textContent = projLabel;
    hint.title = projLabel;

    body.append(title, hint);
    row.append(dot, body);

    // End-of-row marker (same slot, three mutually exclusive states):
    //  - pending input  → pulsing amber "?"   (needs your answer)
    //  - finished done   → static green "●"    (completed, unseen)
    //  - finished failed → static red "●"      (error/stopped, unseen)
    // The green/red marker persists until the run is acknowledged (opened), at
    // which point isLingering() goes false and the row leaves the list entirely.
    if (r.pendingQuestion != null) {
      const q = document.createElement('span');
      q.className = 'child-q';
      q.textContent = '?';
      q.title = 'Waiting for your input';
      row.appendChild(q);
    } else if (isPaused(r)) {
      // Paused: no end marker — it's parked (amber leading dot), not a result.
    } else if (r._finished || isTerminalStatus(r.status)) {
      const ok = r.status === 'done';
      const m = document.createElement('span');
      m.className = `child-q ${ok ? 'ok' : 'bad'}`;
      m.textContent = '●';
      m.title = ok ? 'Completed' : 'Did not complete';
      row.appendChild(m);
    }
    row.addEventListener('click', () => { location.hash = `running/${r.runId}`; });
    host.appendChild(row);
  }
}

function updateNavCounts() {
  const live = liveRuns().length;
  const c = $('#nav-running-count');
  if (c) {
    c.textContent = String(live);
    // Green means "work in flight", so it is only spent when it carries that
    // signal: at zero the badge drops to the sidebar's inert-inventory grey,
    // the same treatment History/Projects/Workspaces get. A permanently green
    // pill reads as active and dilutes the green that should catch the eye.
    c.classList.toggle('n-run', live > 0);
    c.classList.toggle('n-grey', live === 0);
  }
  // Paused pipelines get their own amber badge (hidden at zero); liveRuns()
  // excludes status 'paused', so the two counts never overlap.
  const paused = [...runs.values()].filter((r) => isPipelineRun(r) && isPaused(r)).length;
  const pc = $('#nav-paused-count');
  if (pc) pc.textContent = String(paused);
  const pb = $('#nav-paused-badge');
  if (pb) pb.hidden = paused === 0;
}

// Single authoritative refresh for all four sidebar counts. Running is derived from
// the in-memory runs map (synchronous, always live); the three persistent counts come
// from one cheap /api/counts snapshot — NOT the full list endpoints — so a navigation
// never pulls the whole machine-wide history just for a badge. Counts are SET to
// absolute values, so this is safe to call redundantly (boot, every view switch, hello,
// each *-changed broadcast) without drift. Never throws.
async function refreshAllCounts() {
  updateNavCounts();                                     // Running (in-memory, synchronous)
  renderPipelineTabs();   // sidebar tabs + roll-up update on every view switch / hello / broadcast
  let data;
  try {
    const res = await fetch('/api/counts');
    data = await safeJson(res);                          // safeJson(res) -> await res.json(); {} on failure
    if (!res.ok || !data) return;                        // keep last-known badges
  } catch {
    return;
  }
  if (el.navHistoryCount && Number.isFinite(data.pipelines)) el.navHistoryCount.textContent = String(data.pipelines);
  if (el.navProjectsCount && Number.isFinite(data.projects)) el.navProjectsCount.textContent = String(data.projects);
  if (el.navWorkspacesCount && Number.isFinite(data.workspaces)) el.navWorkspacesCount.textContent = String(data.workspaces);
}

// ---------------------------------------------------------------------------
// Router: sidebar nav (+ responsive top-nav) toggle between the views.
// ---------------------------------------------------------------------------
const views = $$('.view');
const navLinks = $$('.nav button[data-nav], .topnav button[data-nav]');
// [v2/C1] composer is PRESERVED; workspaces + workspace-create are appended.
// workspace-create is in the array (so deep-links resolve) but has no nav link.
const VIEW_NAMES = ['new', 'running', 'history', 'stats', 'composer', 'workspaces', 'workspace-create', 'agents', 'agent-create', 'projects', 'plugins', 'guardrails', 'models', 'settings'];

function showView(name, param = '') {
  // Leave-guard: navigating away from the wizard while a scan is live aborts the
  // scan + resets wizard state (addresses orphaned-background-request risk).
  if (currentShownView === 'workspace-create' && name !== 'workspace-create') {
    if (state.wizard.scanId || state.wizard.abort) abortWizardScan();
    resetWizard();
  }
  // Same guard for the agent wizard: stop a live generation on the way out.
  if (currentShownView === 'agent-create' && name !== 'agent-create') {
    if (state.agentWizard.genId || state.agentWizard.abort) abortAgentGen();
    resetAgentWizard();
  }
  // Close the guardrail wizard when leaving Guardrails (its modal is a top-level
  // overlay, not a [data-view], so it isn't auto-hidden; a stale wizard would also
  // capture other #plugin-modal consumers' Esc/backdrop/Close).
  if (currentShownView === 'guardrails' && name !== 'guardrails' && grvState.wizard) {
    grvState.wizard = null; grvState.editing = null; closePluginModal();
  }
  // Same idea for the settings info-tip bubble: it also lives on document.body,
  // not inside the [data-view] section, so leaving Settings with the pointer or
  // focus parked on an icon would otherwise leave it floating over the next view.
  if (currentShownView === 'settings' && name !== 'settings') hideInfoTip();
  // Leaving History resets the two-screen track, so the next visit lands on the
  // list instead of a stale detail screen sliding in behind the new view.
  if (currentShownView === 'history' && name !== 'history') closeHistDetail({ instant: true });
  const prevView = currentShownView;
  currentShownView = name;

  // Focus selection lives only while on the Running view.
  state.selectedRunId = (name === 'running') ? (param || '') : '';

  // Sync hash so direct callers (beginRun, resume, boot) don't leave hash stale.
  // Reconstruct the full hash (view + optional param) so a focused Running deep
  // link (running/<id>) is preserved rather than collapsed to a bare view.
  const targetHash = param ? `${name}/${param}` : name;
  if (location.hash.slice(1) !== targetHash) {
    syncingHash = true;
    location.hash = targetHash;
  }
  refreshAllCounts();        // every view switch re-reads the authoritative counts

  views.forEach((v) => v.classList.toggle('hidden', v.dataset.view !== name));
  navLinks.forEach((b) => {
    const on = b.dataset.nav === name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  // Toggle a body flag so CSS can drop .main's top padding for the History view,
  // letting the sticky pills toolbar + project headers pin flush to the top.
  document.body.classList.toggle('view-history', name === 'history');
  if (name === 'running') {
    renderRunningView();
    // Opening a run's focus view acknowledges it (linger → drops on next render).
    // ONLY a finished run: opening a still-live run must NOT pre-acknowledge, or
    // its later linger is suppressed (markLingering no-ops on acknowledged) and it
    // skips Running straight into History. The acknowledge happens when the user
    // opens the lingering row AFTER it finishes.
    if (state.selectedRunId) {
      const sr = runs.get(state.selectedRunId);
      // A paused run is _finished but NOT a result to acknowledge — opening it to
      // Resume must not drop it from Running.
      if (sr && !isPaused(sr) && (sr._finished || isTerminalStatus(sr.status))) acknowledgeRun(state.selectedRunId);
    }
  }
  if (name === 'history') {
    // List<->detail hops stay in-view: do NOT refetch /api/history on every hop —
    // a reload re-triggers PR enrichment and the cache branch strips `pr` from
    // every row, blanking resolved PR pills mid-navigation. Refresh is the
    // refresh affordance; pipelines-changed broadcasts still force-reload.
    if (prevView !== 'history') loadHistoryView();
    routeHistoryDetail(param, { instant: prevView !== 'history' });
  }
  if (name === 'stats') loadStatsView();
  if (name === 'workspaces') loadWorkspacesView();
  if (name === 'workspace-create') enterWizard();
  if (name === 'agents') loadAgentsView();
  if (name === 'plugins') loadPluginsView({ refresh: true });
  if (name === 'guardrails') loadGuardrailsView(param);
  if (name === 'models') loadModelsView();
  if (name === 'agent-create') enterAgentWizard();
  if (name === 'projects') loadProjectsView();
  if (name === 'composer') initComposer();
  if (name === 'settings') loadSettings();
  if (name === 'new') { loadTaskSources(); applyBudgetToNewView(); }
}
// Tracks the currently shown view so the leave-guard can fire on transition.
let currentShownView = null;
// True only while showView() is writing location.hash itself, to prevent re-entry.
let syncingHash = false;

// Nav clicks only update the hash; the single hashchange listener drives
// showView so each navigation runs it exactly once (no double /api/runs fetch).
navLinks.forEach((b) =>
  b.addEventListener('click', () => {
    const name = b.dataset.nav;
    // If hash already equals target, no hashchange fires — call showView directly.
    if (location.hash.slice(1) === name) showView(name);
    else location.hash = name;
  })
);

// Overview card → focus (spec: "Click a card → that run's focus view"). Delegated,
// restricted to the card header so existing buttons / the question panel keep working;
// only active in Overview.
$('#run-list')?.addEventListener('click', (e) => {
  if (state.selectedRunId) return;                 // already in focus
  if (e.target.closest('button, a, input, textarea, .qpanel, .subs-bar')) return;
  const top = e.target.closest('.run-top');
  if (!top) return;
  const card = top.closest('.run-card');
  const id = card && card.dataset.runId;
  if (id) location.hash = `running/${id}`;
});

window.addEventListener('hashchange', () => {
  // Swallow the hashchange that showView() itself produced (syncingHash) to keep
  // the single-render guarantee; genuine user-driven hash changes still route normally.
  if (syncingHash) { syncingHash = false; return; }
  const [view, param] = parseHash();
  if (VIEW_NAMES.includes(view)) showView(view, param);
});

// ---------------------------------------------------------------------------
// Live timer: tick running cards once a second so timers advance without events.
// ---------------------------------------------------------------------------
const _timerTick = setInterval(() => {
  for (const r of runs.values()) {
    const active = r.status === 'running' || r.status === 'starting';
    const paused = r.pendingQuestion != null;
    if (!active || paused || !r.el) continue;
    const now = Date.now();
    const timeEl = r.el.querySelector('.run-time');
    if (timeEl) timeEl.textContent = fmtDuration(liveTotalMs(r.steps, now));
    const durs = durByNode(r.steps, now, true);
    for (const el of r.el.querySelectorAll('.run-node[data-id]')) {
      const durEl = el.querySelector('.dur');
      if (!durEl) continue;
      const d = durs[el.dataset.id];
      durEl.textContent = d != null ? fmtDuration(d) : '';
    }
  }
}, 1000);
// In a real browser, setInterval returns a numeric id and this timer simply runs
// for the page's lifetime. Under node:test the jsdom harness imports THIS module,
// where bare `setInterval` resolves to Node's global and returns a Timeout that
// would keep the event loop open and hang the test process. unref() — guarded
// because the browser's numeric id has no such method — lets the test subprocess
// exit cleanly with zero effect on browser behaviour.
if (_timerTick && typeof _timerTick.unref === 'function') _timerTick.unref();

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
syncSourceToggle();
loadProjects();
connectWS();
// Restore the New-Pipeline target (project | workspace). 'workspace' lazy-loads
// the workspace options + re-points the config panel; 'project' is the default.
const bootTarget = localStorage.getItem(LAST_TARGET_KEY) === 'workspace' ? 'workspace' : 'project';
if (bootTarget === 'workspace') setRunTarget('workspace');
// Boot: parse view + optional param so a reload on a deep link (#running/<id>)
// restores the Running view instead of silently resetting to New.
const [bootView, bootParam] = parseHash();
showView(VIEW_NAMES.includes(bootView) ? bootView : 'new', VIEW_NAMES.includes(bootView) ? bootParam : '');
refreshAllCounts();
refreshBudget();
startBudgetTick();
