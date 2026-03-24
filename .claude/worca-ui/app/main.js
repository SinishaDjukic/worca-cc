import { html, render } from 'lit-html';
import { createStore } from './state.js';
import { createWsClient } from './ws.js';
import { parseHash, onHashChange, navigate } from './router.js';
import { applyTheme } from './utils/theme.js';
import { sidebarView } from './views/sidebar.js';
import { runDetailView, runBeadsSectionView } from './views/run-detail.js';
import { runListView } from './views/run-list.js';
import { dashboardView } from './views/dashboard.js';
import { settingsView, loadSettings } from './views/settings.js';
import { newRunView, submitNewRun, getNewRunSubmitState } from './views/new-run.js';
import { logViewerView, writeLogLine, writeIterationSeparator, clearTerminal, mountTerminal, disposeTerminal, searchTerminal } from './views/log-viewer.js';
import { liveOutputView, writeLiveLogLine, writeLiveIterationSeparator, clearLiveTerminal, mountLiveTerminal, disposeLiveTerminal, updateActiveStage, getActiveStage } from './views/live-output.js';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { iconSvg, ArrowLeft, Square, Play, Loader, AlertTriangle, Database } from './utils/icons.js';
import { statusIcon } from './utils/status-badge.js';
import { createNotificationManager } from './notifications.js';
import { beadsPanelView, beadsRunListView } from './views/beads-panel.js';
import { tokenCostsView } from './views/token-costs.js';
import {
  newMultiRunView, multiRunDetailView, multiRunListView,
  submitMultiRun, getMultiRunSubmitState, fetchMultiRuns,
  fetchMultiRunDetail, startPolling, stopPolling, stopMultiRun, multiRuns,
} from './views/multi-project.js';

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
const notificationManager = createNotificationManager({ store, ws, getSettings: () => settings });
let route = parseHash(location.hash);
let connectionState = ws.getState();
let autoScroll = true;
let logFilter = '*';
let logSearch = '';
let settings = {};
let logIterationFilter = null; // null = all iterations, number = specific
let pipelineAction = null; // null | 'stopping' | 'resuming'
let actionError = null; // null | string (error message, auto-clears)
let stopConfirmOpen = false;
let restartStageConfirmOpen = false;
let restartStageKey = null;
const promptCache = {}; // { [runId]: { [stage]: { agentInstructions, userPrompt, agent } } }
let promptCachePending = new Set(); // tracks in-flight fetches
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

function handleStageTabChange(stageKey, iterationNumber) {
  stageIterationTab.set(stageKey, iterationNumber);
}

function fetchRunBeads(runId) {
  if (!runId) return;
  ws.send('list-beads-by-run', { runId }).then(payload => {
    runBeads.set(runId, payload.issues || []);
    rerender();
  }).catch(() => {});
}

function fetchAgentPrompts(runId, stages) {
  if (!runId || !stages) return;
  if (!promptCache[runId]) promptCache[runId] = {};
  for (const [key, stage] of Object.entries(stages)) {
    if (stage.status === 'pending') continue;
    const cacheKey = `${runId}:${key}`;
    if (promptCache[runId][key] || promptCachePending.has(cacheKey)) continue;
    promptCachePending.add(cacheKey);
    ws.send('get-agent-prompt', { runId, stage: key }).then(data => {
      promptCache[runId][key] = data;
      promptCachePending.delete(cacheKey);
      rerender();
    }).catch(() => {
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
  for (const run of (payload.runs || [])) {
    runs[run.id] = run;
  }
  store.setState({ runs });
  if (payload.settings) settings = payload.settings;
});

ws.on('run-snapshot', (payload) => {
  if (payload && payload.id) {
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

ws.on('run-update', (payload) => {
  if (payload && payload.id) {
    const prevRun = store.getState().runs[payload.id] ?? null;
    notificationManager.handleRunUpdate(payload.id, payload, prevRun);
    store.setRun(payload.id, payload);
    if (route.runId === payload.id) {
      autoResetLogFilterOnStageChange(prevRun, payload);
      updateActiveStage(payload);
    }
    if (pipelineAction) { pipelineAction = null; rerender(); }
  }
});

ws.on('log-line', (payload) => {
  if (payload) {
    store.appendLog(payload);
    // Show iteration separator when iteration changes
    if (payload.iteration && payload.iteration > 1 && payload._iterStart) {
      // Log History: only write separators when a specific stage is selected
      if (logFilter !== '*') writeIterationSeparator(payload.iteration);
      writeLiveIterationSeparator(payload.iteration);
    }
    // Log History: only write to the history terminal when a specific stage is selected
    if (logFilter !== '*') writeLogLine(payload);
    writeLiveLogLine(payload);
  }
});

ws.on('log-bulk', (payload) => {
  if (payload && Array.isArray(payload.lines)) {
    for (const line of payload.lines) {
      const entry = { stage: payload.stage, line };
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
    store.setState({ beads: { issues: payload.issues || [], dbExists: payload.dbExists ?? false, dbPath: payload.dbPath || null, loading: false } });
    // Re-fetch run-specific beads if viewing a run detail
    if (route.runId && route.section !== 'beads') fetchRunBeads(route.runId);
    // Re-fetch bead counts for run list
    fetchBeadsCounts();
    // Re-fetch beads for currently viewed run in beads section
    if (route.section === 'beads' && route.runId) fetchBeadsRunIssues(route.runId);
  }
});

ws.on('run-started', () => {
  ws.send('list-runs').then(payload => {
    const runs = {};
    for (const run of (payload.runs || [])) runs[run.id] = run;
    store.setState({ runs });
    if (payload.settings) settings = payload.settings;
  }).catch(() => {});
});

ws.on('run-stopped', () => {
  pipelineAction = null;
  ws.send('list-runs').then(payload => {
    const runs = {};
    for (const run of (payload.runs || [])) runs[run.id] = run;
    store.setState({ runs });
    if (payload.settings) settings = payload.settings;
  }).catch(() => {});
});

ws.on('stage-restarted', () => {
  ws.send('list-runs').then(payload => {
    const runs = {};
    for (const run of (payload.runs || [])) runs[run.id] = run;
    store.setState({ runs });
    if (payload.settings) settings = payload.settings;
  }).catch(() => {});
});

// --- Connection handling ---

ws.onConnection((state) => {
  connectionState = state;
  if (state === 'open') {
    ws.send('list-runs').then(payload => {
      const runs = {};
      for (const run of (payload.runs || [])) {
        runs[run.id] = run;
      }
      store.setState({ runs });
      if (payload.settings) settings = payload.settings;
    }).catch(() => {});

    ws.send('get-preferences').then(prefs => {
      store.setState({ preferences: prefs });
      applyTheme(prefs.theme || 'light');
    }).catch(() => {});

    ws.send('list-beads-issues').then(payload => {
      store.setState({ beads: { issues: payload.issues || [], dbExists: payload.dbExists ?? false, dbPath: payload.dbPath || null, loading: false } });
    }).catch(() => {});

    fetchBeadsCounts();

    // Subscribe to active run if selected
    if (route.runId) {
      if (route.section !== 'beads') {
        ws.send('subscribe-run', { runId: route.runId }).catch(() => {});
        ws.send('subscribe-log', { stage: logFilter === '*' ? null : logFilter, runId: route.runId }).catch(() => {});
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
    stopPolling(); // Stop multi-project polling if active
  }

  if (route.runId && route.runId !== prevRunId) {
    if (route.section === 'beads') {
      // Beads section: fetch run's issues, no log/run subscriptions
      fetchBeadsRunIssues(route.runId);
    } else {
      logFilter = '*';
      logIterationFilter = null;
      ws.send('subscribe-run', { runId: route.runId }).catch(() => {});
      ws.send('subscribe-log', { stage: null, runId: route.runId }).catch(() => {});
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
    const activeRun = Object.values(store.getState().runs).find(r => r.active);
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
  ws.send('resume-run').then(() => {
    // Status update via file watcher will clear pipelineAction
  }).catch((err) => {
    pipelineAction = null;
    showActionError(err?.message || 'Failed to resume pipeline');
  });
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
    const activeRun = Object.values(store.getState().runs).find(r => !r.active);
    const runId = activeRun?.id || 'current';
    const res = await fetch(`/api/runs/${runId}/stages/${stage}/restart`, { method: 'POST' });
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
    const activeRuns = runs.filter(r => r.active);
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
  ws.send('list-beads-counts').then(payload => {
    beadsCounts = payload.counts || {};
    rerender();
  }).catch(() => {});
}

function fetchBeadsRunIssues(runId) {
  beadsRunLoading = true;
  rerender();
  ws.send('list-beads-by-run', { runId }).then(payload => {
    beadsRunIssues = payload.issues || [];
    beadsRunLoading = false;
    rerender();
  }).catch(() => { beadsRunLoading = false; rerender(); });
}

// --- Costs actions ---

function fetchCostsData() {
  fetch('/api/costs')
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        costsTokenData = data.tokenData || {};
        costsFetched = true;
        rerender();
      }
    })
    .catch(() => {});
}

function handleToggleCostRun(runId) {
  costsExpanded = costsExpanded === runId ? null : runId;
  rerender();
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
    title = firstLine.length > 80 ? firstLine.slice(0, 80) + '\u2026' : firstLine;
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
    title = firstLine.length > 80 ? firstLine.slice(0, 80) + '\u2026' : firstLine;
    showBack = true;
    if (run) {
      const rs = run.runState || (run.active ? 'running' : 'terminal');
      const variant = rs === 'running' ? 'warning' : rs === 'interrupted' ? 'neutral' : 'success';
      const status = rs === 'running' ? 'in_progress' : rs === 'interrupted' ? 'interrupted' : 'completed';
      const label = rs === 'running' ? 'Running' : rs === 'interrupted' ? 'Interrupted' : 'Completed';
      badge = html`<sl-badge variant="${variant}" pill>
        ${unsafeHTML(statusIcon(status, 12))}
        ${label}
      </sl-badge>`;

      if (pipelineAction === 'stopping') {
        actionButton = html`
          <button class="action-btn action-btn--danger" disabled>
            ${unsafeHTML(iconSvg(Loader, 14, 'icon-spin'))}
            Stopping\u2026
          </button>`;
      } else if (pipelineAction === 'resuming') {
        actionButton = html`
          <button class="action-btn action-btn--primary" disabled>
            ${unsafeHTML(iconSvg(Loader, 14, 'icon-spin'))}
            Resuming\u2026
          </button>`;
      } else if (rs === 'running') {
        actionButton = html`
          <button class="action-btn action-btn--danger" @click=${handleStopPipeline}>
            ${unsafeHTML(iconSvg(Square, 14))}
            Stop Pipeline
          </button>`;
      } else if (rs === 'interrupted') {
        actionButton = html`
          <button class="action-btn action-btn--primary" @click=${handleResumePipeline}>
            ${unsafeHTML(iconSvg(Play, 14))}
            Resume Pipeline
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
    const isRunning = runs.some(r => r.active);
    actionButton = html`
      <button class="action-btn action-btn--primary" ?disabled=${nrs.isSubmitting || isRunning}
        @click=${() => submitNewRun({ rerender, onStarted: () => navigate('active') })}>
        ${unsafeHTML(iconSvg(Play, 14))}
        ${nrs.isSubmitting ? 'Starting\u2026' : 'Start'}
      </button>`;
  } else if (route.section === 'multi-project' && !route.runId) {
    title = 'Multi-Project Pipeline';
    showBack = true;
    const mrs = getMultiRunSubmitState();
    actionButton = html`
      <button class="action-btn action-btn--primary" ?disabled=${mrs.isSubmitting}
        @click=${() => submitMultiRun({ rerender, onStarted: (id) => navigate('multi-project', id) })}>
        ${unsafeHTML(iconSvg(Play, 14))}
        ${mrs.isSubmitting ? 'Starting\u2026' : 'Start All'}
      </button>`;
  } else if (route.section === 'multi-project' && route.runId) {
    title = 'Multi-Project Run';
    showBack = true;
    const mr = multiRuns.find(r => r.id === route.runId);
    if (mr && !mr.completedAt) {
      actionButton = html`
        <button class="action-btn action-btn--danger"
          @click=${() => stopMultiRun(route.runId, rerender)}>
          ${unsafeHTML(iconSvg(Square, 14))}
          Stop All
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
      ${showBack ? html`
        <button class="content-header-back" @click=${handleBack}>
          ${unsafeHTML(iconSvg(ArrowLeft, 18))}
        </button>
      ` : ''}
      ${badge || ''}
      <h1 class="content-header-title">${title}</h1>
      ${actionButton ? html`<div class="content-header-actions">
        ${actionButton}
      </div>` : ''}
    </div>
  `;
}

function mainContentView() {
  const state = store.getState();
  const runs = Object.values(state.runs);

  // Multi-project section: must be checked before generic runId
  if (route.section === 'multi-project') {
    if (route.runId) {
      startPolling(route.runId, rerender);
      return multiRunDetailView(route.runId, { rerender });
    }
    fetchMultiRuns().then(() => rerender());
    return html`
      ${newMultiRunView(state, { rerender })}
      <sl-divider></sl-divider>
      ${multiRunListView({
        onSelectRun: (id) => navigate('multi-project', id),
        rerender,
      })}
    `;
  }

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
        </div>
      </div>
    `;
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
    return settingsView(state.preferences, { rerender, onThemeToggle: handleThemeToggle, onSaveNotifications: handleSaveNotifications });
  }

  if (route.section === 'history') {
    return runListView(runs, 'history', { onSelectRun: handleSelectRun });
  }

  if (route.section === 'active') {
    const activeRuns = runs.filter(r => r.active);
    if (activeRuns.length === 1) {
      navigate('active', activeRuns[0].id);
      return html``;
    }
    return runListView(runs, 'active', { onSelectRun: handleSelectRun });
  }

  return dashboardView(state, { onSelectRun: (runId) => navigate('active', runId), onNavigate: handleNavigate });
}

function filteredLogState(state) {
  let lines = state.logLines;
  if (logFilter !== '*') {
    lines = lines.filter(l => l.stage === logFilter);
  }
  if (logSearch) {
    const term = logSearch.toLowerCase();
    lines = lines.filter(l => (l.line || '').toLowerCase().includes(term));
  }
  return { ...state, logLines: lines };
}

function rerender() {
  const state = store.getState();
  const appEl = document.getElementById('app');
  if (!appEl) return;

  render(html`
    <div class="app-shell">
      ${sidebarView(state, route, connectionState, {
        onNavigate: handleNavigate
      })}
      <main class="main-content">
        ${notificationManager.renderBanner()}
        ${contentHeaderView()}
        ${mainContentView()}
      </main>
    </div>
    ${actionError ? html`
      <sl-dialog id="action-error-dialog" label="Pipeline Error" @sl-after-hide=${dismissActionError}>
        <div class="error-dialog-body">
          ${unsafeHTML(iconSvg(AlertTriangle, 32, 'error-dialog-icon'))}
          <p>${actionError}</p>
        </div>
        <sl-button slot="footer" variant="primary" @click=${() => {
          document.getElementById('action-error-dialog')?.hide();
        }}>OK</sl-button>
      </sl-dialog>
    ` : ''}
    ${stopConfirmOpen ? html`
      <sl-dialog id="stop-confirm-dialog" label="Stop Pipeline?" @sl-after-hide=${handleCancelStop}>
        <p>Are you sure? The current stage will be interrupted and marked as error.</p>
        <sl-button slot="footer" @click=${() => {
          document.getElementById('stop-confirm-dialog')?.hide();
        }}>Cancel</sl-button>
        <sl-button slot="footer" variant="danger" @click=${() => {
          document.getElementById('stop-confirm-dialog')?.hide();
          handleConfirmStop();
        }}>Stop Pipeline</sl-button>
      </sl-dialog>
    ` : ''}
    ${restartStageConfirmOpen ? html`
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
    ` : ''}
  `, appEl);

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
  mainEl.addEventListener('scroll', () => {
    const header = mainEl.querySelector('.content-header');
    if (header) {
      header.classList.toggle('content-header--scrolled', mainEl.scrollTop > 10);
    }
  }, { passive: true });
  scrollListenerAttached = true;
}

// --- Bootstrap ---

notificationManager.setRerender(rerender);
store.subscribe(() => rerender());
applyTheme(store.getState().preferences.theme);
if (route.section === 'settings') {
  loadSettings().then(() => rerender());
}
rerender();
attachStickyHeaderListener();
