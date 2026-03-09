import { html, render } from 'lit-html';
import { createStore } from './state.js';
import { createWsClient } from './ws.js';
import { parseHash, onHashChange, navigate } from './router.js';
import { applyTheme } from './utils/theme.js';
import { sidebarView } from './views/sidebar.js';
import { runDetailView } from './views/run-detail.js';
import { runListView } from './views/run-list.js';
import { dashboardView } from './views/dashboard.js';
import { settingsView, loadSettings } from './views/settings.js';
import { logViewerView, writeLogLine, clearTerminal, mountTerminal, disposeTerminal, searchTerminal } from './views/log-viewer.js';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { iconSvg, ArrowLeft, Square, Play, Loader, AlertTriangle } from './utils/icons.js';
import { statusIcon } from './utils/status-badge.js';

// Register Shoelace components (tree-shaken — only imports what we use)
import '@shoelace-style/shoelace/dist/components/details/details.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/tab-group/tab-group.js';
import '@shoelace-style/shoelace/dist/components/tab/tab.js';
import '@shoelace-style/shoelace/dist/components/tab-panel/tab-panel.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';

const store = createStore();
const ws = createWsClient();
let route = parseHash(location.hash);
let connectionState = ws.getState();
let autoScroll = true;
let logFilter = '*';
let logSearch = '';
let settings = {};
let pipelineAction = null; // null | 'stopping' | 'resuming'
let actionError = null; // null | string (error message, auto-clears)

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
    store.setRun(payload.id, payload);
    if (pipelineAction) {
      pipelineAction = null;
      rerender();
    }
  }
});

ws.on('run-update', (payload) => {
  if (payload && payload.id) {
    store.setRun(payload.id, payload);
    if (pipelineAction) { pipelineAction = null; rerender(); }
  }
});

ws.on('log-line', (payload) => {
  if (payload) {
    store.appendLog(payload);
    writeLogLine(payload);
  }
});

ws.on('log-bulk', (payload) => {
  if (payload && Array.isArray(payload.lines)) {
    for (const line of payload.lines) {
      const entry = { stage: payload.stage, line };
      store.appendLog(entry);
      writeLogLine(entry);
    }
  }
});

ws.on('preferences', (payload) => {
  if (payload) {
    store.setState({ preferences: payload });
    applyTheme(payload.theme || 'light');
  }
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

    // Subscribe to active run if selected
    if (route.runId) {
      ws.send('subscribe-run', { runId: route.runId }).catch(() => {});
      ws.send('subscribe-log', { stage: logFilter === '*' ? null : logFilter, runId: route.runId }).catch(() => {});
    }
  }
  rerender();
});

// --- Routing ---

onHashChange((newRoute) => {
  const prevRunId = route.runId;
  route = newRoute;

  if (prevRunId && prevRunId !== route.runId) {
    ws.send('unsubscribe-run').catch(() => {});
    ws.send('unsubscribe-log').catch(() => {});
    store.clearLog();
    clearTerminal();
  }

  if (route.runId && route.runId !== prevRunId) {
    ws.send('subscribe-run', { runId: route.runId }).catch(() => {});
    ws.send('subscribe-log', { stage: null, runId: route.runId }).catch(() => {});
  }

  if (route.section === 'settings') {
    loadSettings().then(() => rerender());
  }

  if (!route.runId && prevRunId) {
    disposeTerminal();
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

function handleStageFilter(stage) {
  logFilter = stage;
  clearTerminal();
  store.clearLog();
  ws.send('unsubscribe-log').catch(() => {});
  ws.send('subscribe-log', { stage: stage === '*' ? null : stage, runId: route.runId }).catch(() => {});
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
  pipelineAction = 'stopping';
  actionError = null;
  rerender();
  ws.send('stop-run').then(() => {
    // Status update via file watcher will clear pipelineAction
  }).catch((err) => {
    pipelineAction = null;
    showActionError(err?.message || 'Failed to stop pipeline');
  });
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

// --- Render ---

function contentHeaderView() {
  const state = store.getState();
  let title = 'Dashboard';
  let showBack = false;
  let badge = null;

  let actionButton = null;

  if (route.runId) {
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

  if (route.runId) {
    const run = state.runs[route.runId];
    return html`
      ${runDetailView(run, settings)}
      ${logViewerView(filteredLogState(state), {
        onStageFilter: handleStageFilter,
        onSearch: handleSearch,
        onToggleAutoScroll: handleToggleAutoScroll,
        autoScroll,
        runStages: run?.stages ? Object.keys(run.stages) : []
      })}
    `;
  }

  if (route.section === 'settings') {
    return settingsView(state.preferences, { rerender, onThemeToggle: handleThemeToggle });
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

  return dashboardView(state, { onSelectRun: (runId) => navigate('active', runId) });
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
  `, appEl);

  // Mount xterm terminal after render if in run view
  if (route.runId) {
    mountTerminal(route.runId);
  }
}

// --- Bootstrap ---

store.subscribe(() => rerender());
applyTheme(store.getState().preferences.theme);
if (route.section === 'settings') {
  loadSettings().then(() => rerender());
}
rerender();
