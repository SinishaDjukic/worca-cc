import { html, render } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { createNotificationManager } from './notifications.js';
import { navigate, onHashChange, parseHash } from './router.js';
import { createStore } from './state.js';
import {
  AlertTriangle,
  ArrowLeft,
  Database,
  iconSvg,
  Loader,
  Pause,
  Play,
  Square,
  Trash2,
} from './utils/icons.js';
import { statusIcon } from './utils/status-badge.js';
import { applyTheme } from './utils/theme.js';
import { formatTitle } from './utils/title.js';
import { beadsPanelView, beadsRunListView } from './views/beads-panel.js';
import { dashboardView } from './views/dashboard.js';
import { learningsSectionView } from './views/learnings-panel.js';
import {
  clearLiveTerminal,
  disposeLiveTerminal,
  getActiveStage,
  liveOutputView,
  mountLiveTerminal,
  updateActiveStage,
  writeLiveIterationSeparator,
  writeLiveLogLine,
} from './views/live-output.js';
import {
  clearTerminal,
  disposeTerminal,
  logViewerView,
  mountTerminal,
  searchTerminal,
  writeLogLine,
} from './views/log-viewer.js';
import {
  getNewRunSubmitState,
  newRunView,
  submitNewRun,
} from './views/new-run.js';
import { runBeadsSectionView, runDetailView } from './views/run-detail.js';
import { runListView } from './views/run-list.js';
import { loadSettings, settingsView } from './views/settings.js';
import { sidebarView } from './views/sidebar.js';
import { tokenCostsView } from './views/token-costs.js';
import { webhookInboxView } from './views/webhook-inbox.js';
import { createWsClient } from './ws.js';

// Register Shoelace components (tree-shaken — only imports what we use)
import '@shoelace-style/shoelace/dist/components/details/details.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/tab-group/tab-group.js';
import '@shoelace-style/shoelace/dist/components/tab/tab.js';
import '@shoelace-style/shoelace/dist/components/tab-panel/tab-panel.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

const store = createStore();
const ws = createWsClient();
const notificationManager = createNotificationManager({
  store,
  ws,
  getSettings: () => settings,
});
let route = parseHash(location.hash);
let connectionState = ws.getState();
let autoScroll = true;
let logFilter = '*';
let logSearch = '';
let settings = {};
let logIterationFilter = null; // null = all iterations, number = specific
let pipelineAction = null; // null | 'stopping' | 'resuming' | 'pausing'
let _controlPending = null; // null | { action: 'pause'|'resume'|'stop', runId: string }
let actionError = null; // null | string (error message, auto-clears)
let stopConfirmOpen = false;
let restartStageConfirmOpen = false;
let restartStageKey = null;
const promptCache = {}; // { [runId]: { [stage]: { agentInstructions, userPrompt, agent } } }
const promptCachePending = new Set(); // tracks in-flight fetches
let beadsStatusFilter = 'all';
let beadsPriorityFilter = 'all';
let beadsStarting = null; // null | issueId
let beadsStartError = null; // null | string
const runBeads = new Map(); // runId → issues[]
let beadsCounts = {}; // { runId: count }
let beadsRunIssues = []; // issues for the currently viewed run
let beadsRunLoading = false;
const stageIterationTab = new Map(); // stageKey → iterationNumber (user's last manual choice)
let costsTokenData = {}; // { runId: { stage: [ { inputTokens, outputTokens, ... } ] } }
let costsExpanded = null; // runId or null
let costsFetched = false;
let learnConfirmOpen = false;
let webhookSelectedId = null;
let webhookCategoryFilter = 'all';
let webhookRunFilter = null;
let webhookSearchTerm = '';

function handleStageTabChange(stageKey, iterationNumber) {
  stageIterationTab.set(stageKey, iterationNumber);
}

function fetchRunBeads(runId) {
  if (!runId) return;
  ws.send('list-beads-by-run', { runId })
    .then((payload) => {
      runBeads.set(runId, payload.issues || []);
      rerender();
    })
    .catch(() => {});
}

function fetchAgentPrompts(runId, stages) {
  if (!runId || !stages) return;
  if (!promptCache[runId]) promptCache[runId] = {};
  for (const [key, stage] of Object.entries(stages)) {
    if (stage.status === 'pending') continue;
    const cacheKey = `${runId}:${key}`;
    if (promptCache[runId][key] || promptCachePending.has(cacheKey)) continue;
    promptCachePending.add(cacheKey);
    ws.send('get-agent-prompt', { runId, stage: key })
      .then((data) => {
        promptCache[runId][key] = data;
        promptCachePending.delete(cacheKey);
        rerender();
      })
      .catch(() => {
        promptCachePending.delete(cacheKey);
      });
  }
}

// --- Auto-reset log filter on stage transition ---

function findActiveStage(run) {
  if (!run || !run.stages) return null;
  for (const [key, stage] of Object.entries(run.stages)) {
    if (stage.status === 'in_progress') return key;
  }
  return null;
}

function autoResetLogFilterOnStageChange(prevRun, newRun) {
  const prevStage = findActiveStage(prevRun);
  const newStage = findActiveStage(newRun);
  if (newStage && prevStage !== newStage) {
    logFilter = '*';
    logIterationFilter = null;
    clearTerminal();
    store.clearLog();
    ws.send('unsubscribe-log').catch(() => {});
    ws.send('subscribe-log', { stage: null, runId: newRun.id }).catch(() => {});
  }
}

// --- Wire WS events to state ---

ws.on('runs-list', (payload) => {
  const runs = {};
  for (const run of payload.runs || []) {
    runs[run.id] = run;
  }
  if (payload.settings) settings = payload.settings;
  store.setState({ runs });
});

ws.on('run-snapshot', (payload) => {
  if (payload?.id) {
    const prevRun = store.getState().runs[payload.id] ?? null;
    notificationManager.handleRunUpdate(payload.id, payload, prevRun);
    // Invalidate prompt cache for stages whose iteration count changed
    if (prevRun && promptCache[payload.id]) {
      for (const [key, stage] of Object.entries(payload.stages || {})) {
        const prevCount = prevRun.stages?.[key]?.iterations?.length || 0;
        const newCount = stage.iterations?.length || 0;
        if (newCount > prevCount) {
          delete promptCache[payload.id][key];
        }
      }
    }
    store.setRun(payload.id, payload);
    if (route.runId === payload.id) {
      autoResetLogFilterOnStageChange(prevRun, payload);
      updateActiveStage(payload);
    }
    if (pipelineAction) {
      pipelineAction = null;
      rerender();
    }
  }
});

ws.on('run-update', (payload) => {
  if (payload?.id) {
    const prevRun = store.getState().runs[payload.id] ?? null;
    notificationManager.handleRunUpdate(payload.id, payload, prevRun);
    store.setRun(payload.id, payload);
    if (route.runId === payload.id) {
      autoResetLogFilterOnStageChange(prevRun, payload);
      updateActiveStage(payload);
    }
    if (pipelineAction) {
      pipelineAction = null;
      rerender();
    }
  }
});

// Wiring contract: log-line → Live Output only (not Log History).
// Log History is populated exclusively by log-bulk backfill on subscribe.
// See main-log-line-handler.test.js — changes here may break contract tests.
ws.on('log-line', (payload) => {
  if (payload) {
    store.appendLog(payload);
    // Show iteration separator when iteration changes
    if (payload.iteration && payload.iteration > 1 && payload._iterStart) {
      writeLiveIterationSeparator(payload.iteration);
    }
    writeLiveLogLine(payload);
  }
});

ws.on('log-bulk', (payload) => {
  if (payload && Array.isArray(payload.lines)) {
    for (const line of payload.lines) {
      // NB: timestamp is receive-time, not original write-time (log files lack per-line timestamps)
      const entry = {
        stage: payload.stage,
        iteration: payload.iteration,
        line,
        timestamp: new Date().toISOString(),
      };
      store.appendLog(entry);
      // Log History: only write to the history terminal when a specific stage is selected
      if (logFilter !== '*') writeLogLine(entry);
      writeLiveLogLine(entry);
    }
  }
});

ws.on('preferences', (payload) => {
  if (payload) {
    store.setState({ preferences: payload });
    applyTheme(payload.theme || 'light');
  }
});

ws.on('beads-update', (payload) => {
  if (payload) {
    store.setState({
      beads: {
        issues: payload.issues || [],
        dbExists: payload.dbExists ?? false,
        dbPath: payload.dbPath || null,
        loading: false,
      },
    });
    // Re-fetch run-specific beads if viewing a run detail
    if (route.runId && route.section !== 'beads') fetchRunBeads(route.runId);
    // Re-fetch bead counts for run list
    fetchBeadsCounts();

    // Re-fetch beads for currently viewed run in beads section
    if (route.section === 'beads' && route.runId)
      fetchBeadsRunIssues(route.runId);
  }
});

/** Fetch runs list from server and update store. Returns a promise. */
function fetchAndUpdateRuns() {
  return ws.send('list-runs').then((payload) => {
    const runs = {};
    for (const run of payload.runs || []) runs[run.id] = run;
    store.setState({ runs });
    if (payload.settings) settings = payload.settings;
  });
}

ws.on('run-started', () => {
  fetchAndUpdateRuns().catch(() => {});
});

ws.on('run-stopped', () => {
  pipelineAction = null;
  ws.send('list-runs')
    .then((payload) => {
      const runs = {};
      for (const run of payload.runs || []) runs[run.id] = run;
      store.setState({ runs });
      if (payload.settings) settings = payload.settings;
    })
    .catch(() => {});
});

ws.on('stage-restarted', () => {
  ws.send('list-runs')
    .then((payload) => {
      const runs = {};
      for (const run of payload.runs || []) runs[run.id] = run;
      store.setState({ runs });
      if (payload.settings) settings = payload.settings;
    })
    .catch(() => {});
});

ws.on('learn-started', (payload) => {
  if (payload?.runId && payload.runId === route.runId) {
    ws.send('subscribe-run', { runId: payload.runId }).catch(() => {});
  }
});

// --- Webhook inbox events ---

ws.on('webhook-inbox-event', (payload) => {
  if (payload) {
    const inbox = store.getState().webhookInbox;
    store.setState({
      webhookInbox: { ...inbox, events: [...inbox.events, payload] },
    });
  }
});

ws.on('webhook-control-changed', (payload) => {
  if (payload) {
    const inbox = store.getState().webhookInbox;
    store.setState({
      webhookInbox: { ...inbox, controlAction: payload.action },
    });
  }
});

ws.on('webhook-inbox-cleared', () => {
  const inbox = store.getState().webhookInbox;
  store.setState({ webhookInbox: { ...inbox, events: [] } });
  webhookSelectedId = null;
});

// --- Connection handling ---

ws.onConnection((state) => {
  connectionState = state;
  if (state === 'open') {
    ws.send('list-runs')
      .then((payload) => {
        const runs = {};
        for (const run of payload.runs || []) {
          runs[run.id] = run;
        }
        store.setState({ runs });
        if (payload.settings) settings = payload.settings;
      })
      .catch(() => {});

    ws.send('get-preferences')
      .then((prefs) => {
        store.setState({ preferences: prefs });
        applyTheme(prefs.theme || 'light');
      })
      .catch(() => {});

    ws.send('list-beads-issues')
      .then((payload) => {
        store.setState({
          beads: {
            issues: payload.issues || [],
            dbExists: payload.dbExists ?? false,
            dbPath: payload.dbPath || null,
            loading: false,
          },
        });
      })
      .catch(() => {});

    ws.send('get-webhook-inbox')
      .then((payload) => {
        store.setState({
          webhookInbox: {
            events: payload.events || [],
            controlAction: payload.controlAction || 'continue',
          },
        });
      })
      .catch(() => {});

    fetchBeadsCounts();

    fetchProjectInfo();

    // Subscribe to active run if selected
    if (route.runId) {
      if (route.section !== 'beads') {
        ws.send('subscribe-run', { runId: route.runId }).catch(() => {});
        ws.send('subscribe-log', {
          stage: logFilter === '*' ? null : logFilter,
          runId: route.runId,
        }).catch(() => {});
      }
      fetchRunBeads(route.runId);
      if (route.section === 'beads') fetchBeadsRunIssues(route.runId);
    }
  }
  rerender();
});

// --- Routing ---

onHashChange((newRoute) => {
  const prevRunId = route.runId;
  route = newRoute;

  if (prevRunId && prevRunId !== route.runId) {
    stageIterationTab.clear();
    ws.send('unsubscribe-run').catch(() => {});
    ws.send('unsubscribe-log').catch(() => {});
    store.clearLog();
    clearTerminal();
    clearLiveTerminal();
  }

  if (route.runId && route.runId !== prevRunId) {
    if (route.section === 'beads') {
      // Beads section: fetch run's issues, no log/run subscriptions
      fetchBeadsRunIssues(route.runId);
    } else {
      logFilter = '*';
      logIterationFilter = null;
      ws.send('subscribe-run', { runId: route.runId }).catch(() => {});
      ws.send('subscribe-log', { stage: null, runId: route.runId }).catch(
        () => {},
      );
      fetchRunBeads(route.runId);
    }
  }

  if (route.section === 'settings') {
    loadSettings().then(() => rerender());
  }

  if (route.section === 'costs') {
    costsFetched = false;
    fetchCostsData();
  }

  if (!route.runId && prevRunId) {
    disposeTerminal();
    disposeLiveTerminal();
  }

  rerender();
});

// --- Actions ---

function handleNavigate(section) {
  navigate(section, null);
}

function handleSelectRun(runId) {
  navigate(route.section, runId);
}

function handleThemeToggle() {
  const current = store.getState().preferences.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  ws.send('set-preferences', { theme: next }).catch(() => {});
  store.setState({ preferences: { theme: next } });
  applyTheme(next);
}

function handleSaveNotifications(notifPrefs) {
  ws.send('set-preferences', { notifications: notifPrefs }).catch(() => {});
  store.setState({ preferences: { notifications: notifPrefs } });
}

function handleStageFilter(stage) {
  logFilter = stage;
  // Auto-select last iteration when a stage is chosen
  if (stage !== '*') {
    const run = store.getState().runs[route.runId];
    const stageData = run?.stages?.[stage];
    const iterCount = stageData?.iterations?.length || 0;
    logIterationFilter = iterCount > 0 ? iterCount : null;
  } else {
    logIterationFilter = null;
  }
  clearTerminal();
  store.clearLog();
  ws.send('unsubscribe-log').catch(() => {});
  ws.send('subscribe-log', {
    stage: stage === '*' ? null : stage,
    runId: route.runId,
    iteration: logIterationFilter,
  }).catch(() => {});
  rerender();
}

function handleIterationFilter(iteration) {
  logIterationFilter = iteration;
  clearTerminal();
  store.clearLog();
  ws.send('unsubscribe-log').catch(() => {});
  ws.send('subscribe-log', {
    stage: logFilter === '*' ? null : logFilter,
    runId: route.runId,
    iteration: iteration,
  }).catch(() => {});
  rerender();
}

function handleSearch(term) {
  logSearch = term;
  searchTerminal(term);
}

function handleToggleAutoScroll() {
  autoScroll = !autoScroll;
  rerender();
}

function showActionError(msg) {
  actionError = msg;
  rerender();
  // Open the dialog after render
  requestAnimationFrame(() => {
    const dialog = document.getElementById('action-error-dialog');
    if (dialog) dialog.show();
  });
}

function dismissActionError() {
  actionError = null;
  rerender();
}

function handleStopPipeline() {
  stopConfirmOpen = true;
  rerender();
  requestAnimationFrame(() => {
    const dialog = document.getElementById('stop-confirm-dialog');
    if (dialog) dialog.show();
  });
}

function handleCancelStop() {
  stopConfirmOpen = false;
  rerender();
}

async function handleConfirmStop() {
  stopConfirmOpen = false;
  pipelineAction = 'stopping';
  actionError = null;
  rerender();

  try {
    const activeRun = Object.values(store.getState().runs).find(
      (r) => r.active,
    );
    const runId = activeRun?.id || 'current';
    const res = await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) {
      pipelineAction = null;
      showActionError(data.error || 'Failed to stop pipeline');
    }
    // Status update via file watcher / WS broadcast will clear pipelineAction
  } catch (err) {
    pipelineAction = null;
    showActionError(err?.message || 'Failed to stop pipeline');
  }
}

function handleResumePipeline() {
  pipelineAction = 'resuming';
  actionError = null;
  rerender();
  ws.send('resume-run', { runId: route.runId })
    .then(() => {
      // Status update via file watcher will clear pipelineAction
    })
    .catch((err) => {
      pipelineAction = null;
      showActionError(err?.message || 'Failed to resume pipeline');
    });
}

async function handlePausePipeline() {
  const activeRun = Object.values(store.getState().runs).find((r) => r.active);
  const runId = activeRun?.id || 'current';
  pipelineAction = 'pausing';
  actionError = null;
  rerender();
  try {
    const res = await fetch(`/api/runs/${runId}/pause`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      pipelineAction = null;
      showActionError(data.error || 'Failed to pause pipeline');
    }
    // Status update via file watcher / WS broadcast will clear pipelineAction
  } catch (err) {
    pipelineAction = null;
    showActionError(err?.message || 'Failed to pause pipeline');
  }
}

async function handlePauseRun(runId) {
  _controlPending = { action: 'pause', runId };
  rerender();
  try {
    const res = await fetch(`/api/runs/${runId}/pause`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) showActionError(data.error || 'Failed to pause run');
  } catch (err) {
    showActionError(err?.message || 'Failed to pause run');
  } finally {
    _controlPending = null;
    rerender();
  }
}

async function handleResumeRun(runId) {
  _controlPending = { action: 'resume', runId };
  rerender();
  try {
    const res = await fetch(`/api/runs/${runId}/resume`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) showActionError(data.error || 'Failed to resume run');
  } catch (err) {
    showActionError(err?.message || 'Failed to resume run');
  } finally {
    _controlPending = null;
    rerender();
  }
}

function handleRestartStage(stageKey) {
  restartStageKey = stageKey;
  restartStageConfirmOpen = true;
  rerender();
  requestAnimationFrame(() => {
    const dialog = document.getElementById('restart-stage-confirm-dialog');
    if (dialog) dialog.show();
  });
}

function handleCancelRestartStage() {
  restartStageConfirmOpen = false;
  restartStageKey = null;
  rerender();
}

async function handleConfirmRestartStage() {
  restartStageConfirmOpen = false;
  const stage = restartStageKey;
  restartStageKey = null;
  rerender();

  try {
    const activeRun = Object.values(store.getState().runs).find(
      (r) => !r.active,
    );
    const runId = activeRun?.id || 'current';
    const res = await fetch(`/api/runs/${runId}/stages/${stage}/restart`, {
      method: 'POST',
    });
    const data = await res.json();
    if (data.ok) {
      navigate('active', null);
    } else {
      showActionError(data.error || 'Failed to restart stage');
    }
  } catch (err) {
    showActionError(err?.message || 'Failed to restart stage');
  }
}

function handleBack() {
  if (route.runId) {
    // If active section has only one run, going back to list would auto-redirect here again
    // So go to dashboard instead
    const runs = Object.values(store.getState().runs);
    const activeRuns = runs.filter((r) => r.active);
    if (route.section === 'active' && activeRuns.length <= 1) {
      navigate('dashboard', null);
    } else {
      navigate(route.section, null);
    }
  } else if (route.section && route.section !== 'dashboard') {
    navigate('dashboard', null);
  }
}

// --- Beads actions ---

function handleBeadsStatusFilter(value) {
  beadsStatusFilter = value;
  rerender();
}

function handleBeadsPriorityFilter(value) {
  beadsPriorityFilter = value;
  rerender();
}

async function handleStartBeadsIssue(issueId) {
  beadsStarting = issueId;
  beadsStartError = null;
  rerender();
  try {
    await ws.send('start-beads-issue', { issueId });
    beadsStarting = null;
    navigate('active', null);
  } catch (err) {
    beadsStarting = null;
    beadsStartError = err?.message || 'Failed to start pipeline';
    rerender();
  }
}

function handleDismissBeadsError() {
  beadsStartError = null;
  rerender();
}

function fetchBeadsCounts() {
  ws.send('list-beads-counts')
    .then((payload) => {
      beadsCounts = payload.counts || {};
      rerender();
    })
    .catch(() => {});
}

function fetchBeadsRunIssues(runId) {
  beadsRunLoading = true;
  rerender();
  ws.send('list-beads-by-run', { runId })
    .then((payload) => {
      beadsRunIssues = payload.issues || [];
      beadsRunLoading = false;
      rerender();
    })
    .catch(() => {
      beadsRunLoading = false;
      rerender();
    });
}

// --- Costs actions ---

function fetchCostsData() {
  fetch('/api/costs')
    .then((r) => r.json())
    .then((data) => {
      if (data.ok) {
        costsTokenData = data.tokenData || {};
        costsFetched = true;
        rerender();
      }
    })
    .catch(() => {});
}

function fetchProjectInfo() {
  fetch('/api/project-info')
    .then((r) => r.json())
    .then((data) => {
      if (data.name !== undefined) {
        store.setState({ projectName: data.name });
        document.title = formatTitle(data.name);
      }
    })
    .catch(() => {});
}

function handleToggleCostRun(runId) {
  costsExpanded = costsExpanded === runId ? null : runId;
  rerender();
}

// --- Webhook inbox actions ---

function handleWebhookSelectEvent(id) {
  webhookSelectedId = webhookSelectedId === id ? null : id;
  rerender();
}

function handleWebhookCategoryFilter(cat) {
  webhookCategoryFilter = cat;
  rerender();
}

function handleWebhookRunFilter(runId) {
  webhookRunFilter = runId;
  rerender();
}

function handleWebhookSearch(term) {
  webhookSearchTerm = term;
  rerender();
}

function handleWebhookSetControl(action) {
  ws.send('set-webhook-control', { action }).catch(() => {});
}

function handleWebhookClear() {
  ws.send('clear-webhook-inbox').catch(() => {});
  webhookSelectedId = null;
}

function handleWebhookCopyJson(event) {
  try {
    navigator.clipboard.writeText(JSON.stringify(event.envelope, null, 2));
  } catch {
    /* ignore */
  }
}

function handleWebhookDismissDetail() {
  webhookSelectedId = null;
  rerender();
}

// --- Learn actions ---

function handleRunLearn() {
  const run = store.getState().runs[route.runId];
  const learnStatus = run?.stages?.learn?.status;
  if (learnStatus === 'completed' || learnStatus === 'error') {
    learnConfirmOpen = true;
    rerender();
    requestAnimationFrame(() => {
      document.getElementById('learn-confirm-dialog')?.show();
    });
    return;
  }
  doRunLearn();
}

function handleCancelLearn() {
  learnConfirmOpen = false;
  rerender();
}

async function doRunLearn() {
  learnConfirmOpen = false;
  rerender();
  try {
    const runId = route.runId;
    const res = await fetch(`/api/runs/${runId}/learn`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      showActionError(data.error || 'Failed to run learning analysis');
    } else {
      // Optimistic update — show spinner immediately instead of waiting for WS
      const run = store.getState().runs[runId];
      if (run) {
        if (!run.stages) run.stages = {};
        run.stages.learn = {
          status: 'in_progress',
          pid: data.pid,
          started_at: new Date().toISOString(),
          iterations: [
            {
              number: 1,
              status: 'in_progress',
              started_at: new Date().toISOString(),
              trigger: 'manual',
            },
          ],
        };
        rerender();
      }
    }
  } catch (err) {
    showActionError(err?.message || 'Failed to run learning analysis');
  }
}

// --- Render ---

function contentHeaderView() {
  const state = store.getState();
  let title = 'Dashboard';
  let showBack = false;
  let badge = null;

  let actionButton = null;

  if (route.section === 'beads' && route.runId) {
    // Beads kanban for a specific run
    const run = state.runs[route.runId];
    const raw = run?.work_request?.title || route.runId;
    const firstLine = raw.split('\n')[0];
    title =
      firstLine.length > 80 ? `${firstLine.slice(0, 80)}\u2026` : firstLine;
    showBack = true;
  } else if (route.section === 'beads' && !route.runId) {
    title = 'Beads Issues';
    showBack = true;
    const dbPath = state.beads?.dbPath;
    if (dbPath) {
      actionButton = html`<span class="beads-db-path">${unsafeHTML(iconSvg(Database, 12))} Beads DB<br><code>${dbPath}</code></span>`;
    }
  } else if (route.runId) {
    const run = state.runs[route.runId];
    const raw = run?.work_request?.title || 'Pipeline Details';
    const firstLine = raw.split('\n')[0];
    title =
      firstLine.length > 80 ? `${firstLine.slice(0, 80)}\u2026` : firstLine;
    showBack = true;
    if (run) {
      const ps = run.pipeline_status || (run.active ? 'running' : 'completed');
      const variantMap = {
        running: 'warning',
        resuming: 'warning',
        paused: 'warning',
        completed: 'success',
        failed: 'danger',
      };
      const variant = variantMap[ps] || 'neutral';
      const label = ps.charAt(0).toUpperCase() + ps.slice(1);
      badge = html`<sl-badge variant="${variant}" pill>
        ${unsafeHTML(statusIcon(ps, 12))}
        ${label}
      </sl-badge>`;

      if (pipelineAction === 'stopping') {
        actionButton = html`
          <button class="action-btn action-btn--danger" disabled>
            ${unsafeHTML(iconSvg(Loader, 14, 'icon-spin'))}
            Stopping\u2026
          </button>`;
      } else if (pipelineAction === 'pausing') {
        actionButton = html`
          <button class="action-btn action-btn--amber" disabled>
            ${unsafeHTML(iconSvg(Loader, 14, 'icon-spin'))}
            Pausing\u2026
          </button>`;
      } else if (pipelineAction === 'resuming') {
        actionButton = html`
          <button class="action-btn action-btn--primary" disabled>
            ${unsafeHTML(iconSvg(Loader, 14, 'icon-spin'))}
            Resuming\u2026
          </button>`;
      } else if (ps === 'running') {
        actionButton = html`
          <button class="action-btn action-btn--amber" @click=${handlePausePipeline}>
            ${unsafeHTML(iconSvg(Pause, 14))}
            Pause
          </button>
          <button class="action-btn action-btn--danger" @click=${handleStopPipeline}>
            ${unsafeHTML(iconSvg(Square, 14))}
            Stop
          </button>`;
      } else if (ps === 'paused' || ps === 'failed') {
        actionButton = html`
          <button class="action-btn action-btn--primary" @click=${handleResumePipeline}>
            ${unsafeHTML(iconSvg(Play, 14))}
            Resume
          </button>
          <button class="action-btn action-btn--danger" @click=${handleStopPipeline}>
            ${unsafeHTML(iconSvg(Square, 14))}
            Stop
          </button>`;
      }
    }
  } else if (route.section === 'active') {
    title = 'Running Pipelines';
    showBack = true;
  } else if (route.section === 'history') {
    title = 'History';
    showBack = true;
  } else if (route.section === 'new-run') {
    title = 'New Pipeline';
    showBack = true;
    const nrs = getNewRunSubmitState();
    const runs = Object.values(state.runs);
    const isRunning = runs.some((r) => r.active);
    actionButton = html`
      <button class="action-btn action-btn--primary" ?disabled=${nrs.isSubmitting || isRunning}
        @click=${() => submitNewRun({ rerender, onStarted: () => navigate('active'), refreshRuns: fetchAndUpdateRuns })}>
        ${unsafeHTML(iconSvg(Play, 14))}
        ${nrs.isSubmitting ? 'Starting\u2026' : 'Start'}
      </button>`;
  } else if (route.section === 'webhooks') {
    title = 'Webhook Inbox';
    showBack = true;
    const inboxEvents = state.webhookInbox?.events || [];
    if (inboxEvents.length > 0) {
      actionButton = html`
        <button class="action-btn action-btn--danger" @click=${handleWebhookClear}>
          ${unsafeHTML(iconSvg(Trash2, 14))}
          Clear
        </button>`;
    }
  } else if (route.section === 'costs') {
    title = 'Token & Cost Dashboard';
    showBack = true;
  } else if (route.section === 'settings') {
    title = 'Settings';
    showBack = true;
  }

  return html`
    <div class="content-header">
      ${
        showBack
          ? html`
        <button class="content-header-back" @click=${handleBack}>
          ${unsafeHTML(iconSvg(ArrowLeft, 18))}
        </button>
      `
          : ''
      }
      ${badge || ''}
      <h1 class="content-header-title">${title}</h1>
      ${
        actionButton
          ? html`<div class="content-header-actions">
        ${actionButton}
      </div>`
          : ''
      }
    </div>
  `;
}

function mainContentView() {
  const state = store.getState();
  const runs = Object.values(state.runs);

  // Beads section: two-level routing (must be checked before generic runId)
  if (route.section === 'beads') {
    if (route.runId) {
      return beadsPanelView(beadsRunIssues, {
        statusFilter: beadsStatusFilter,
        priorityFilter: beadsPriorityFilter,
        starting: beadsStarting,
        startError: beadsStartError,
        onStatusFilter: handleBeadsStatusFilter,
        onPriorityFilter: handleBeadsPriorityFilter,
        onStartIssue: handleStartBeadsIssue,
        onDismissError: handleDismissBeadsError,
        loading: beadsRunLoading,
        run: state.runs[route.runId],
        runId: route.runId,
      });
    }
    return beadsRunListView(runs, {
      onSelectRun: handleSelectRun,
      beadsCounts,
    });
  }

  if (route.runId) {
    const run = state.runs[route.runId];
    // Compute iteration counts per stage from run status
    const stageIterations = {};
    if (run?.stages) {
      for (const [key, stage] of Object.entries(run.stages)) {
        const iters = stage.iterations || [];
        if (iters.length > 0) stageIterations[key] = iters.length;
      }
      fetchAgentPrompts(route.runId, run.stages);
    }
    const logState = filteredLogState(state);
    logState.currentLogStage = logFilter === '*' ? null : logFilter;
    logState.currentLogIteration = logIterationFilter;
    const isRunning = !!run?.active;
    const liveStage = getActiveStage();
    // Initialize active stage tracking on first render
    if (run && !liveStage) {
      updateActiveStage(run);
    }
    return html`
      <div class="run-detail-layout">
        <div class="run-detail-layout__stages">
          ${runDetailView(run, settings, { promptCache: promptCache[route.runId] || {}, onRestartStage: handleRestartStage, stageIterationTab, onStageTabChange: handleStageTabChange })}
        </div>
        <div class="run-detail-layout__logs">
          ${liveOutputView(getActiveStage(), isRunning)}
          ${logViewerView(logState, {
            onStageFilter: handleStageFilter,
            onIterationFilter: handleIterationFilter,
            onSearch: handleSearch,
            onToggleAutoScroll: handleToggleAutoScroll,
            autoScroll,
            stageIterations,
            runStages: run?.stages,
          })}
          ${runBeadsSectionView(runBeads.get(route.runId))}
          ${learningsSectionView(run?.stages?.learn, {
            onRunLearn: handleRunLearn,
          })}
        </div>
      </div>
    `;
  }

  if (route.section === 'webhooks') {
    return webhookInboxView(state, {
      selectedId: webhookSelectedId,
      categoryFilter: webhookCategoryFilter,
      runFilter: webhookRunFilter,
      searchTerm: webhookSearchTerm,
      onSelectEvent: handleWebhookSelectEvent,
      onCategoryFilter: handleWebhookCategoryFilter,
      onRunFilter: handleWebhookRunFilter,
      onSearch: handleWebhookSearch,
      onSetControl: handleWebhookSetControl,
      onClear: handleWebhookClear,
      onCopyJson: handleWebhookCopyJson,
      onDismissDetail: handleWebhookDismissDetail,
    });
  }

  if (route.section === 'costs') {
    if (!costsFetched) fetchCostsData();
    return tokenCostsView(state, {
      expandedRun: costsExpanded,
      tokenData: costsTokenData,
      onToggleRun: handleToggleCostRun,
    });
  }

  if (route.section === 'new-run') {
    return newRunView(state, { rerender });
  }

  if (route.section === 'settings') {
    return settingsView(state.preferences, {
      rerender,
      onThemeToggle: handleThemeToggle,
      onSaveNotifications: handleSaveNotifications,
    });
  }

  if (route.section === 'history') {
    return runListView(runs, 'history', {
      onSelectRun: handleSelectRun,
      onResume: handleResumeRun,
    });
  }

  if (route.section === 'active') {
    const activeRuns = runs.filter((r) => r.active);
    if (activeRuns.length === 1) {
      navigate('active', activeRuns[0].id);
      return html``;
    }
    return runListView(runs, 'active', {
      onSelectRun: handleSelectRun,
      onResume: handleResumeRun,
    });
  }

  return dashboardView(state, {
    onSelectRun: (runId) => navigate('active', runId),
    onNavigate: handleNavigate,
    onPause: handlePauseRun,
    onResume: handleResumeRun,
  });
}

function filteredLogState(state) {
  let lines = state.logLines;
  if (logFilter !== '*') {
    lines = lines.filter((l) => l.stage === logFilter);
  }
  if (logSearch) {
    const term = logSearch.toLowerCase();
    lines = lines.filter((l) => (l.line || '').toLowerCase().includes(term));
  }
  return { ...state, logLines: lines };
}

function rerender() {
  const state = store.getState();
  const appEl = document.getElementById('app');
  if (!appEl) return;

  render(
    html`
    <div class="app-shell">
      ${sidebarView(state, route, connectionState, {
        onNavigate: handleNavigate,
        onSelectRun: handleSelectRun,
      })}
      <main class="main-content">
        ${notificationManager.renderBanner()}
        ${contentHeaderView()}
        ${mainContentView()}
      </main>
    </div>
    ${
      actionError
        ? html`
      <sl-dialog id="action-error-dialog" label="Pipeline Error" @sl-after-hide=${dismissActionError}>
        <div class="error-dialog-body">
          ${unsafeHTML(iconSvg(AlertTriangle, 32, 'error-dialog-icon'))}
          <p>${actionError}</p>
        </div>
        <sl-button slot="footer" variant="primary" @click=${() => {
          document.getElementById('action-error-dialog')?.hide();
        }}>OK</sl-button>
      </sl-dialog>
    `
        : ''
    }
    ${
      stopConfirmOpen
        ? html`
      <sl-dialog id="stop-confirm-dialog" label="Stop Pipeline?" @sl-after-hide=${handleCancelStop}>
        <p>Are you sure? The current stage will be interrupted and marked as error.</p>
        <sl-button slot="footer" @click=${() => {
          document.getElementById('stop-confirm-dialog')?.hide();
        }}>Cancel</sl-button>
        <sl-button slot="footer" variant="danger" @click=${() => {
          document.getElementById('stop-confirm-dialog')?.hide();
          handleConfirmStop();
        }}>Stop</sl-button>
      </sl-dialog>
    `
        : ''
    }
    ${
      restartStageConfirmOpen
        ? html`
      <sl-dialog id="restart-stage-confirm-dialog" label="Restart Stage?" @sl-after-hide=${handleCancelRestartStage}>
        <p>Restart the "${restartStageKey}" stage? The pipeline will resume from this point.</p>
        <sl-button slot="footer" @click=${() => {
          document.getElementById('restart-stage-confirm-dialog')?.hide();
        }}>Cancel</sl-button>
        <sl-button slot="footer" variant="warning" @click=${() => {
          document.getElementById('restart-stage-confirm-dialog')?.hide();
          handleConfirmRestartStage();
        }}>Restart</sl-button>
      </sl-dialog>
    `
        : ''
    }
    ${
      learnConfirmOpen
        ? html`
      <sl-dialog id="learn-confirm-dialog" label="Re-run Learning Analysis?" @sl-after-hide=${handleCancelLearn}>
        <p>This will replace existing learnings. Continue?</p>
        <sl-button slot="footer" @click=${() => {
          document.getElementById('learn-confirm-dialog')?.hide();
        }}>Cancel</sl-button>
        <sl-button slot="footer" variant="warning" @click=${() => {
          document.getElementById('learn-confirm-dialog')?.hide();
          doRunLearn();
        }}>Re-run</sl-button>
      </sl-dialog>
    `
        : ''
    }
  `,
    appEl,
  );

  // Mount xterm terminals after render if in run view
  if (route.runId) {
    // Log History: only mount when a specific stage is selected (terminal div exists)
    if (logFilter !== '*') mountTerminal(route.runId);
    mountLiveTerminal(route.runId);
  }
}

// --- Sticky header scroll shadow ---
let scrollListenerAttached = false;

function attachStickyHeaderListener() {
  if (scrollListenerAttached) return;
  const mainEl = document.querySelector('.main-content');
  if (!mainEl) return;
  mainEl.addEventListener(
    'scroll',
    () => {
      const header = mainEl.querySelector('.content-header');
      if (header) {
        header.classList.toggle(
          'content-header--scrolled',
          mainEl.scrollTop > 10,
        );
      }
    },
    { passive: true },
  );
  scrollListenerAttached = true;
}

// --- Bootstrap ---

notificationManager.setRerender(rerender);
store.subscribe(() => rerender());
applyTheme(store.getState().preferences.theme);
fetchProjectInfo();
if (route.section === 'settings') {
  loadSettings().then(() => rerender());
}
rerender();
attachStickyHeaderListener();
