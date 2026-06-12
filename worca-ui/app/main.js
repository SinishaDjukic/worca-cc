import { html, nothing, render } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { createNotificationManager } from './notifications.js';
import { navigate, onHashChange, parseHash } from './router.js';
import { createStore, isArchivedRunExpired } from './state.js';
import { createArchiveActions } from './utils/archive-actions.js';
import { confirmDialogTemplate, showConfirm } from './utils/confirm-dialog.js';
import { bindKeyboard as bindHelpKeyboard } from './utils/help-mode.js';
import {
  AlertTriangle,
  ArrowLeft,
  CircleSlash,
  Copy,
  Database,
  Download,
  iconSvg,
  Loader,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Square,
  Star,
  Trash2,
  Upload,
} from './utils/icons.js';
import {
  mapProjectRunsResponse,
  mapWorktreesResponse,
} from './utils/run-mappers.js';
import { sortByStartDesc } from './utils/sort-runs.js';
import { actionAllowed } from './utils/state-actions.js';
import { statusIcon } from './utils/status-badge.js';
import { applyTheme } from './utils/theme.js';
import { formatTitle } from './utils/title.js';
import {
  addProjectDialogView,
  batchWorcaSetupDialogTemplate,
} from './views/add-project-dialog.js';
import { beadsPanelView, beadsRunListView } from './views/beads-panel.js';
import { dashboardView } from './views/dashboard.js';
import { fleetCardView } from './views/fleet-card.js';
import { fleetDetailView } from './views/fleet-detail.js';
import {
  fleetLauncherView,
  getFleetLauncherSubmitState,
  resetLauncherState,
  submitFleetLauncher,
} from './views/fleet-launcher.js';
import { gistExportDialogView } from './views/gist-export-dialog.js';
import { mountHelpEdgeTab } from './views/help-edge-tab.js';
import { buildRunMeta, learningsSectionView } from './views/learnings-panel.js';
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
  loadModelForEdit,
  modelEditorState,
  modelEditorView,
  resetModelEditor,
  saveModel,
} from './views/model-editor.js';
import { fetchModels, modelsView, setupModelsPolling } from './views/models.js';
import {
  getEffectiveProjectId,
  getNewRunSubmitState,
  invalidateTemplateCache,
  isAtCapacity,
  newRunView,
  submitNewRun,
} from './views/new-run.js';
import {
  createGist,
  exportTemplate,
  fetchTemplates,
  pipelinesView,
  setupTemplatePolling,
} from './views/pipelines.js';
import { pipelinesEditorView } from './views/pipelines-editor.js';
import { runCardView } from './views/run-card.js';
import {
  prApprovalPanelView,
  runBeadsSectionView,
  runDetailView,
} from './views/run-detail.js';
import { runFileAccessView } from './views/run-file-access.js';
import { runListView } from './views/run-list.js';
import { runTimelineView } from './views/run-timeline.js';
import {
  loadSettings,
  projectSettingsView,
  settingsView,
} from './views/settings.js';
import { sidebarView } from './views/sidebar.js';
import { tokenCostsView } from './views/token-costs.js';
import { webhookInboxView } from './views/webhook-inbox.js';
import { workspaceCardView } from './views/workspace-card.js';
import {
  getWorkspaceCreateSubmitState,
  resetWorkspaceCreateState,
  submitWorkspaceCreate,
  workspaceCreateView,
} from './views/workspace-create.js';
import { workspaceDetailView } from './views/workspace-detail.js';
import {
  getWorkspaceEditSubmitState,
  loadWorkspace,
  submitWorkspaceEdit,
  workspaceEditView,
} from './views/workspace-edit.js';
import { workspacesConfigView } from './views/workspaces-config.js';
import { worktreesView } from './views/worktrees.js';
import { createWsClient } from './ws.js';

// Register Shoelace components (tree-shaken — only imports what we use)
import '@shoelace-style/shoelace/dist/components/details/details.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/copy-button/copy-button.js';

import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/drawer/drawer.js';
import '@shoelace-style/shoelace/dist/components/tab-group/tab-group.js';
import '@shoelace-style/shoelace/dist/components/tab/tab.js';
import '@shoelace-style/shoelace/dist/components/tab-panel/tab-panel.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';
import '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';
import '@shoelace-style/shoelace/dist/components/radio/radio.js';
import '@shoelace-style/shoelace/dist/components/radio-button/radio-button.js';
import '@shoelace-style/shoelace/dist/components/checkbox/checkbox.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
// Dropdown + menu power the sidebar's "+ New" picker. Without these the
// custom elements stay unregistered and the <sl-menu-item> children bleed
// inline as plain text (observed: "New Fleet" rendering below the trigger).
import '@shoelace-style/shoelace/dist/components/dropdown/dropdown.js';
import '@shoelace-style/shoelace/dist/components/menu/menu.js';
import '@shoelace-style/shoelace/dist/components/menu-item/menu-item.js';
// sl-icon / sl-icon-button: status indicators and toggle controls used in
// fleet detail, group-rendering, settings, run-card.
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
// sl-card: PR approval panel in run-detail.
import '@shoelace-style/shoelace/dist/components/card/card.js';
// sl-progress-bar / sl-range / sl-tag: fleet header progress bar, fleet
// launcher circuit-breaker threshold slider, fleet-detail guide filenames.
import '@shoelace-style/shoelace/dist/components/progress-bar/progress-bar.js';
import '@shoelace-style/shoelace/dist/components/range/range.js';
import '@shoelace-style/shoelace/dist/components/tag/tag.js';

// Sidebar collapsed state is client-local — persisted in localStorage,
// not server-side preferences. Different browsers/tabs may want different
// widths. Hydrate before createStore so the first render is correct.
const SIDEBAR_COLLAPSED_KEY = 'worca.sidebar-collapsed';
function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}
function writeSidebarCollapsed(value) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? '1' : '0');
  } catch {
    /* localStorage unavailable */
  }
}

const store = createStore({
  preferences: { sidebarCollapsed: readSidebarCollapsed() },
});

function toggleSidebarCollapsed() {
  const next = !store.getState().preferences.sidebarCollapsed;
  writeSidebarCollapsed(next);
  store.setState({ preferences: { sidebarCollapsed: next } });
}

function projectUrl(path) {
  const pid = store.getState().currentProjectId;
  return pid ? `/api/projects/${pid}${path}` : `/api${path}`;
}

// Resolve the projectId for a runId by looking up the run in state.
// Required for run-scoped WS messages in global mode: the WS connection
// itself is bound to `currentProjectId` (often null in global mode), but
// the server's `resolveProject()` honours `payload.projectId` first. Without
// this, fetches like `get-agent-prompt` and `subscribe-log` for a run that
// lives in a non-default project return NOT_FOUND and silently fail (the
// JS catches the error, the cache stays empty, the UI shows nothing).
function _runProjectId(runId) {
  if (!runId) return null;
  const state = store.getState();
  const run = state.runs?.[runId] || state.archivedRuns?.[runId] || null;
  return run?.project || run?._project || state.currentProjectId || null;
}

// Build a project-scoped URL for a run-scoped REST endpoint. Resolves the
// run's owning project via `_runProjectId` so global mode (no currentProjectId)
// still hits `/api/projects/<project>/...` instead of falling back to the
// legacy `/api/...` mount — which has no `worcaDir` configured and returns
// 501 "worcaDir not configured" for any project-scoped action.
function runUrl(runId, path) {
  const pid = _runProjectId(runId);
  return pid ? `/api/projects/${pid}${path}` : `/api${path}`;
}

// Build a project-scoped URL for a worktree-scoped REST endpoint. Worktrees
// in state carry a `project` field stamped by fetchWorktrees; using that
// keeps cleanup working in global mode when no project is selected. Falls
// back to legacy `/api/...` only when the worktree isn't in state (e.g. a
// race with a fresh page navigation).
function worktreeUrl(runId, path) {
  const wt = (store.getState().worktrees || []).find((w) => w.run_id === runId);
  const pid = wt?.project || store.getState().currentProjectId;
  return pid ? `/api/projects/${pid}${path}` : `/api${path}`;
}

const ws = createWsClient();
const notificationManager = createNotificationManager({
  store,
  ws,
  getSettings: () => settings,
});
// ─── Session-level state (not reset on project switch) ────────────────
let route = parseHash(location.hash);

const TEMPLATE_TIERS = ['project', 'user', 'builtin'];

/**
 * Migrate legacy template URLs to the new (tier, id) shape:
 *   - `#/pipelines/...` (pre-rename): redirect to the templates list.
 *   - `#/templates/<id>/<action>` (pre tier-in-URL redesign): the tier
 *     slot holds what was once the id; we can't safely guess the
 *     intended tier, so redirect to the list as well.
 *
 * Mutates and returns the route object. Returns the same object back if
 * no redirect was needed.
 */
function _migrateLegacyTemplatesRoute(r) {
  if (r.section === 'pipelines') {
    navigate('templates', null, r.projectId);
    return parseHash(location.hash);
  }
  if (r.section === 'templates' && r.tier && !TEMPLATE_TIERS.includes(r.tier)) {
    navigate('templates', null, r.projectId);
    return parseHash(location.hash);
  }
  return r;
}
route = _migrateLegacyTemplatesRoute(route);
let connectionState = ws.getState();
let autoScroll = true;

// ─── Project-scoped mutable state ─────────────────────────────────────
// All variables below are reset by resetProjectState() during project
// switch. When adding a new project-scoped variable, add its default to
// resetProjectState() to avoid stale state bugs.

// -- Settings & pipeline control --
let settings = {};
let _controlPending = null; // null | { action: 'pause'|'resume'|'stop', runId: string }
let actionError = null; // null | string (error message, auto-clears)
let _templateGuard = null; // null | { tid, scope, action: 'delete'|'edit', count: number }

/**
 * Open-dialog state for the New / Duplicate / Rename / Import flows.
 * null when no dialog is open. Each dialog renders conditionally from
 * this single source of truth so we never end up with two stacked.
 *
 *   { mode: 'create',    id: '',         scope: 'project', baseTid: '' }
 *   { mode: 'duplicate', srcId, srcScope, id: srcId, scope: 'project' }
 *   { mode: 'rename',    srcId, srcScope, id: srcId, scope: srcScope }
 *   { mode: 'import',    file: null, parsed: null, scope: 'project', error: null }
 */
let _templateActionDialog = null;
let _templateActionBusy = false;
let restartStageKey = null;

// -- Fleet views --
const _fleetDetailCache = {}; // { fleetId: manifest }
let _fleetDetailFetching = null; // currently-fetching fleet id (single in-flight)
// Set of fleet ids the API has confirmed missing (404 / !data.ok). Symmetric
// to _fleetDetailCache for the negative case — without it the detail view
// stays at "Loading fleet…" forever when the manifest has been cleaned up
// (common path: user navigates to a fleet link from a history entry, but
// `worca cleanup --fleet-id` already removed the manifest). In-memory only
// — a page refresh re-fetches and re-marks. Persisting would create a
// staleness hazard (manifest re-created with same id during testing) for
// no real-world benefit since fleet ids embed a timestamp + random suffix.
const _fleetDetailMissing = new Set();
let _fleetStatusFilter = 'all'; // /#/fleet-runs filter chip selection
let _fleetTextFilter = ''; // /#/fleet-runs free-text filter

// -- Workspace views -- (mirror fleet detail-cache pattern)
const _wsDetailCache = {}; // { workspaceId: manifest }
let _wsDetailFetching = null;
const _wsDetailMissing = new Set();

// Tracks which section last entered the launcher's "new" route so we only
// reset launcherMode on transitions between fleet-runs and workspace-runs.
// Without this, every rerender would clobber user edits inside the form.
let _lastLauncherSection = null;
// Same idea for the workspace-create form — reset on first entry, persist
// across in-route rerenders so user input survives keystrokes.
let _lastCreateSection = null;
// Track the workspace name currently loaded into the edit form so we only
// re-fetch when navigating to a different workspace, not on every rerender.
let _lastEditWorkspace = null;
// When the user clicks "Launch" in the workspaces-config list, we stash the
// chosen workspace name here. The launcher consumes it on mount, presetting
// the dropdown so the user lands ready to submit instead of re-selecting.
let _pendingLaunchWorkspace = null;

// Free-text match for a fleet — title, fleet id, and member project
// names. Mirrors `_runMatchesText` (run-list) and `_matchesFilter`
// (worktrees) so all three list pages search consistently.
function _fleetMatchesText(fleet, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  const title = fleet.work_request?.title || fleet.title || '';
  const projectNames = (fleet.children || [])
    .map((c) => (c.project_path || c.project || '').split('/').pop() || '')
    .join(' ');
  return (
    title.toLowerCase().includes(needle) ||
    (fleet.fleet_id || '').toLowerCase().includes(needle) ||
    projectNames.toLowerCase().includes(needle)
  );
}

// Status chips for the /#/fleet-runs list — mirrors the History page's
// `.filter-chips`. "halted" replaces pipeline's "paused"/"error" since
// that's the fleet-level non-terminal-but-stopped state; "archived" pulls
// from the archived flag rather than a status value.
const _FLEET_FILTER_STATUSES = [
  'all',
  'running',
  'completed',
  'failed',
  'halted',
  'archived',
];

function _fleetListView() {
  // state.fleets is the single source of truth: populated on bootstrap and
  // refreshed by the fleet-update WS handler. Reading the module-level
  // cache used to drop refreshed entries on the floor (the list never
  // updated after halt / cleanup events). Switch to a state-driven read so
  // the list view stays consistent with the sidebar Fleets count.
  const fleets = store.getState().fleets;
  if (fleets === undefined) {
    // Bootstrap hasn't completed yet (no /api/fleet-runs fetch returned).
    return html`<div class="fleet-list-loading"><sl-spinner></sl-spinner> Loading fleets…</div>`;
  }
  if (fleets.length === 0) {
    return html`
      <div class="fleet-list-empty">
        <p>No fleet runs yet.</p>
        <sl-button variant="primary" @click=${() => navigate('fleet-runs', 'new', null)}>
          + Run Fleet
        </sl-button>
      </div>
    `;
  }

  // Per-chip counts. `all` and every status count is over *non-archived*
  // fleets; `archived` is its own bucket — same split as History (where
  // archived runs live in a separate `archivedRuns` array).
  const live = fleets.filter((f) => !f.archived);
  const counts = { all: live.length, archived: fleets.length - live.length };
  for (const f of live) {
    counts[f.status] = (counts[f.status] || 0) + 1;
  }

  const cardOptions = {
    onClick: (id) => navigate('fleet-runs', id, null),
    onChildClick: (runId) => navigate('active', runId, null),
    onArchive: archiveFleet,
    onUnarchive: unarchiveFleet,
  };

  let displayed =
    _fleetStatusFilter === 'archived'
      ? fleets.filter((f) => f.archived)
      : _fleetStatusFilter === 'all'
        ? live
        : live.filter((f) => f.status === _fleetStatusFilter);

  // Text filter runs after the chip filter — same ordering as History.
  const textQ = (_fleetTextFilter || '').trim();
  if (textQ) {
    displayed = displayed.filter((f) => _fleetMatchesText(f, textQ));
  }

  return html`
    <div class="filter-chips">
      ${_FLEET_FILTER_STATUSES
        .filter((s) => s === 'all' || counts[s])
        .map(
          (s) => html`
          <button
            class="filter-chip ${(_fleetStatusFilter || 'all') === s ? 'active' : ''} filter-chip-${s}"
            @click=${() => {
              _fleetStatusFilter = s;
              rerender();
            }}
          >
            ${s === 'all' ? 'All' : s}
            <span class="chip-count">${counts[s] || 0}</span>
          </button>
        `,
        )}
    </div>
    <div class="list-filter-row">
      <sl-input
        size="small"
        class="list-text-filter"
        type="text"
        placeholder="Filter by title, fleet id, or project…"
        value="${_fleetTextFilter || ''}"
        @sl-input=${(e) => {
          _fleetTextFilter = e.target.value;
          rerender();
        }}
      ></sl-input>
    </div>
    ${
      displayed.length === 0
        ? html`<div class="empty-state">No ${_fleetStatusFilter} fleets</div>`
        : html`<div class="fleet-list">
            ${displayed.map((f) =>
              fleetCardView(f, f.children || [], cardOptions),
            )}
          </div>`
    }
  `;
}

// Workspace-list filters — mirror _fleetStatusFilter / _fleetTextFilter so
// both list pages have the same filter UX (chips + text input).
let _wsStatusFilter = 'all';
let _wsTextFilter = '';

// Free-text match for a workspace run — name, workspace id, and prompt.
// Same shape as _fleetMatchesText so the two filters behave identically.
function _wsMatchesText(ws, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  const name = ws.workspace_name || '';
  const prompt = ws.work_request?.title || ws.work_request?.description || '';
  return (
    name.toLowerCase().includes(needle) ||
    (ws.workspace_id || '').toLowerCase().includes(needle) ||
    prompt.toLowerCase().includes(needle)
  );
}

// Status chips for /#/workspace-runs. `halted` and `integration_failed` are
// included because they're the workspace-specific terminal-but-stopped
// states (vs fleet's just `halted`). `planning`/`integration_testing` roll
// up into the `running` bucket so the chip set stays compact.
const _WS_FILTER_STATUSES = [
  'all',
  'running',
  'completed',
  'failed',
  'halted',
  'integration_failed',
];

const _WS_ACTIVE_STATUSES = new Set([
  'running',
  'planning',
  'integration_testing',
]);

function _wsBucket(status, bucket) {
  if (bucket === 'running') return _WS_ACTIVE_STATUSES.has(status);
  return status === bucket;
}

function _workspaceListView() {
  const workspaces = store.getState().workspaceRuns;
  if (workspaces === undefined) {
    return html`<div class="fleet-list-loading"><sl-spinner></sl-spinner> Loading workspace runs…</div>`;
  }
  if (workspaces.length === 0) {
    return html`
      <div class="fleet-list-empty">
        <p>No workspace runs yet.</p>
        <sl-button variant="primary" @click=${() => navigate('workspace-runs', 'new', null)}>
          + Run Workspace
        </sl-button>
      </div>
    `;
  }

  // Per-chip counts. Every workspace is live (no archive concept yet, so
  // skip the archived bucket — when archive lands the shape becomes
  // identical to fleets and this loop just gains an extra arm).
  const counts = { all: workspaces.length };
  for (const s of _WS_FILTER_STATUSES.slice(1)) {
    counts[s] = workspaces.filter((w) => _wsBucket(w.status, s)).length;
  }

  let displayed =
    _wsStatusFilter === 'all'
      ? workspaces
      : workspaces.filter((w) => _wsBucket(w.status, _wsStatusFilter));

  const textQ = (_wsTextFilter || '').trim();
  if (textQ) {
    displayed = displayed.filter((w) => _wsMatchesText(w, textQ));
  }

  const cardOptions = {
    onClick: (id) => navigate('workspace-runs', id, null),
    // Re-run / cleanup wiring is intentionally deferred — the per-row
    // actions render only when these callbacks are supplied. Re-run needs a
    // POST /api/workspace-runs/:id/relaunch flow + UI confirm; cleanup
    // needs the worca-cleanup-by-workspace-id story finished. Both can land
    // independently once their backend contracts settle.
  };

  return html`
    <div class="filter-chips">
      ${_WS_FILTER_STATUSES
        .filter((s) => s === 'all' || counts[s])
        .map(
          (s) => html`
            <button
              class="filter-chip ${(_wsStatusFilter || 'all') === s ? 'active' : ''} filter-chip-${s}"
              @click=${() => {
                _wsStatusFilter = s;
                rerender();
              }}
            >
              ${s === 'all' ? 'All' : s.replace(/_/g, ' ')}
              <span class="chip-count">${counts[s] || 0}</span>
            </button>
          `,
        )}
    </div>
    <div class="list-filter-row">
      <sl-input
        size="small"
        class="list-text-filter"
        type="text"
        placeholder="Filter by name, workspace id, or prompt…"
        value="${_wsTextFilter || ''}"
        @sl-input=${(e) => {
          _wsTextFilter = e.target.value;
          rerender();
        }}
      ></sl-input>
    </div>
    ${
      displayed.length === 0
        ? html`<div class="empty-state">No ${_wsStatusFilter.replace(/_/g, ' ')} workspace runs</div>`
        : html`<div class="fleet-list">
            ${displayed.map((w) => workspaceCardView(w, cardOptions))}
          </div>`
    }
  `;
}

// -- Worktrees view --
let worktreesFilter = '';
let worktreesStatusFilter = 'all'; // worktrees filter-chip selection
let worktreesDialogItem = null; // null | worktree (single-row cleanup)
let worktreesDialogBulk = false; // true when "Cleanup all completed" dialog open
let worktreesDialogCheckbox = false; // resumable/grouped confirmation checkbox

// -- Log viewer --
let logFilter = '*';
let logSearch = '';
let logIterationFilter = null; // null = all iterations, number = specific

// -- Prompt cache --
const promptCache = {}; // { [runId]: { [stage]: { agentInstructions, userPrompt, agent } } }
const promptCachePending = new Set(); // tracks in-flight fetches

// -- Beads --
let beadsStatusFilter = 'all';
let beadsPriorityFilter = 'all';
let beadsStarting = null; // null | issueId
let beadsStartError = null; // null | string
const runBeads = new Map(); // runId → issues[] | null (null = load failed)
const runAccessModels = new Map(); // runId → access model | null (null = load failed)
const beadsSpinner = new Set(); // runId → show the 150ms-gated loading spinner
const beadsSpinnerTimers = new Map(); // runId → setTimeout handle
let beadsCounts = {}; // { runId: count }
let lastBeadsPayload = null;
let beadsRunIssues = []; // issues for the currently viewed run
let beadsRunLoading = false;

// -- Stage iteration tabs --
const stageIterationTab = new Map(); // stageKey → iterationNumber

// -- Costs --
let costsTokenData = {}; // { runId: { stage: [ { inputTokens, outputTokens, ... } ] } }
let costsExpanded = null; // runId or null
let costsFetched = false;

// -- Pipelines / Templates --
let _templatesPollCleanup = null;
let _modelsPollCleanup = null;
let _editorModelsFetching = false; // single in-flight models fetch for inline collision check
let _worcaCliStatusFetching = false; // single in-flight probe guard
let _editorTemplatesFetching = false; // single in-flight templates fetch for inline collision check
// Editor state and cleanup from pipelines-editor module
let _editorModule = null;
let getEditorState = null;

/**
 * If the user is currently viewing one of the just-imported templates in the
 * editor, the cached `editorState.template` is stale (the on-disk file changed
 * but the editor only reloads on (tier,id) change). Force a fresh
 * `loadTemplate` so the editor reflects the imported contents without needing
 * a browser refresh.
 *
 * @param {Array<{id: string, tier: string}>} imported
 */
function _invalidateEditorCacheIfImported(imported) {
  if (!Array.isArray(imported) || imported.length === 0) return;
  if (!_editorModule || typeof getEditorState !== 'function') return;
  let st;
  try {
    st = getEditorState();
  } catch {
    return;
  }
  if (!st?.templateId || !st?.tier) return;
  const hit = imported.find(
    (e) => e && e.id === st.templateId && e.tier === st.tier,
  );
  if (!hit) return;
  const route = store.getState().currentRoute || {};
  _editorModule
    .loadTemplate(st.tier, st.templateId, route.projectId || null)
    .then(() => rerender())
    .catch(() => {
      /* best-effort */
    });
}

/**
 * Refresh the cached models list after a successful template-bundle
 * import. Bundles can carry `worca.models` + `worca.pricing.models`
 * entries that land in settings.json / settings.local.json; without
 * this refresh the Models page (which reads from `state.models`)
 * doesn't show the new aliases until the user reloads the page or
 * the 30s polling interval next fires.
 */
function _refreshModelsAfterImport(projectId) {
  fetchModels(projectId)
    .then((models) => {
      store.setState({ models, modelsLoaded: true, modelsError: null });
      rerender();
    })
    .catch(() => {
      /* best-effort — next poll will catch up */
    });
}

// ── Integrations state ──────────────────────────────────────────────────
let integrationsStatus = null;
let integrationsConfig = null;
let integrationsEditingAdapter = null;
const integrationsForms = {};

const DEFAULT_EVENTS = [
  'pipeline.run.started',
  'pipeline.run.completed',
  'pipeline.run.failed',
  'pipeline.run.interrupted',
  'pipeline.run.paused',
  'pipeline.run.cancelled',
  'pipeline.run.resumed',
  'pipeline.run.resumed_from_pause',
  'pipeline.git.pr_created',
  'pipeline.circuit_breaker.tripped',
  'pipeline.cost.budget_warning',
];

function fetchIntegrationsData() {
  Promise.all([
    fetch('/api/integrations/status').then((r) => r.json()),
    fetch('/api/integrations/config').then((r) => r.json()),
  ])
    .then(([status, config]) => {
      integrationsStatus = status;
      integrationsConfig = config;
      rerender();
    })
    .catch(() => {
      integrationsStatus = { enabled: false };
      integrationsConfig = {};
      rerender();
    });
}

// Poll integrations status while settings tab is visible (updates connection badges)
let _igPollTimer = null;
function startIntegrationsPoll() {
  stopIntegrationsPoll();
  _igPollTimer = setInterval(() => {
    fetch('/api/integrations/status')
      .then((r) => r.json())
      .then((status) => {
        integrationsStatus = status;
        rerender();
      })
      .catch(() => {});
  }, 10_000);
}
function stopIntegrationsPoll() {
  if (_igPollTimer) {
    clearInterval(_igPollTimer);
    _igPollTimer = null;
  }
}

function getIntegrationsForm(adapter) {
  if (!integrationsForms[adapter]) {
    // Pre-fill from existing config if available
    const cfg = integrationsConfig?.[adapter];
    integrationsForms[adapter] = {
      token: cfg?.bot_token || cfg?.webhook_url || '',
      chatId: String(cfg?.chat_id || cfg?.channel_id || ''),
      events: cfg?.events ? [...cfg.events] : [...DEFAULT_EVENTS],
      saving: false,
      error: null,
      saved: false,
    };
  }
  return integrationsForms[adapter];
}

function handleIgStartEdit(adapter) {
  integrationsEditingAdapter = adapter;
  // Reset form from config
  delete integrationsForms[adapter];
  getIntegrationsForm(adapter);
  rerender();
}

function handleIgCancelEdit() {
  if (integrationsEditingAdapter) {
    delete integrationsForms[integrationsEditingAdapter];
  }
  integrationsEditingAdapter = null;
  rerender();
}

function handleIgFieldChange(adapter, field, value) {
  const form = getIntegrationsForm(adapter);
  form[field] = value;
  form.saved = false;
  form.error = null;
  rerender();
}

function handleIgEventToggle(adapter, evt) {
  const form = getIntegrationsForm(adapter);
  const idx = form.events.indexOf(evt);
  if (idx >= 0) form.events.splice(idx, 1);
  else form.events.push(evt);
  form.saved = false;
  rerender();
}

function handleIgSave(adapter) {
  const form = getIntegrationsForm(adapter);
  form.saving = true;
  form.error = null;
  form.saved = false;
  rerender();

  fetch('/api/integrations/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      adapter,
      token: form.token,
      chatId: form.chatId,
      events: form.events,
    }),
  })
    .then((r) => {
      if (!r.ok)
        return r
          .json()
          .then((d) => Promise.reject(new Error(d.error || 'Save failed')));
      return r.json();
    })
    .then(() => {
      form.saving = false;
      form.saved = true;
      integrationsEditingAdapter = null;
      fetchIntegrationsData();
    })
    .catch((err) => {
      form.saving = false;
      form.error = err.message;
      rerender();
    });
}

function handleIgRemove(adapter) {
  fetch(`/api/integrations/config/${adapter}`, { method: 'DELETE' })
    .then((r) => r.json())
    .then(() => {
      delete integrationsForms[adapter];
      integrationsEditingAdapter = null;
      fetchIntegrationsData();
    })
    .catch(() => rerender());
}

function handleIgToggleEnabled(adapter, enabled) {
  fetch(`/api/integrations/config/${adapter}/enabled`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
    .then((r) => r.json())
    .then(() => fetchIntegrationsData())
    .catch(() => rerender());
}

function handleIgDetect(adapter) {
  if (adapter !== 'telegram') return;
  const form = getIntegrationsForm(adapter);
  form.detecting = true;
  form.detectHint = null;
  rerender();

  fetch('/api/integrations/telegram/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: form.token }),
  })
    .then((r) => r.json())
    .then((data) => {
      form.detecting = false;
      if (!data.ok) {
        form.detectHint = data.error || 'Detection failed';
      } else if (data.chats.length === 0) {
        const bot = data.botUsername ? `@${data.botUsername}` : 'the bot';
        form.detectHint = `No chats found. Send /start to ${bot} in Telegram, then click Detect again.`;
      } else {
        form.chatId = String(data.chats[0].id);
        form.detectHint = `Found: ${data.chats[0].title} (${data.chats[0].id})`;
      }
      rerender();
    })
    .catch(() => {
      form.detecting = false;
      form.detectHint = 'Detection failed — check server logs.';
      rerender();
    });
}

// -- Webhook UI --
let webhookSelectedId = null;
let webhookCategoryFilter = 'all';
let webhookRunFilter = null;
let webhookSearchTerm = '';

// -- Run history --
let historyStatusFilter = 'all';
let historyTextFilter = ''; // free-text filter on the History list

/**
 * Reset all project-scoped state to defaults.
 * Called on project switch to prevent stale state leaking between projects.
 * When adding a new project-scoped variable above, add its reset here.
 */
function resetProjectState() {
  // Settings & pipeline control
  settings = {};
  _controlPending = null;
  actionError = null;
  restartStageKey = null;
  // Log viewer
  logFilter = '*';
  logSearch = '';
  logIterationFilter = null;
  // Prompt cache
  for (const key of Object.keys(promptCache)) delete promptCache[key];
  promptCachePending.clear();
  // Beads
  beadsStatusFilter = 'all';
  beadsPriorityFilter = 'all';
  beadsStarting = null;
  beadsStartError = null;
  runBeads.clear();
  beadsSpinner.clear();
  for (const t of beadsSpinnerTimers.values()) clearTimeout(t);
  beadsSpinnerTimers.clear();
  beadsCounts = {};
  lastBeadsPayload = null;
  beadsRunIssues = [];
  beadsRunLoading = false;
  // Stage iteration tabs
  stageIterationTab.clear();
  // Costs
  costsTokenData = {};
  costsExpanded = null;
  costsFetched = false;
  // Pipelines / Templates
  if (_templatesPollCleanup) {
    _templatesPollCleanup();
    _templatesPollCleanup = null;
  }
  // Models
  if (_modelsPollCleanup) {
    _modelsPollCleanup();
    _modelsPollCleanup = null;
  }
  resetModelEditor();
  // Webhook UI
  webhookSelectedId = null;
  webhookCategoryFilter = 'all';
  webhookRunFilter = null;
  webhookSearchTerm = '';
  // Run history
  historyStatusFilter = 'all';
  historyTextFilter = '';
}

function handleStageTabChange(stageKey, iterationNumber) {
  stageIterationTab.set(stageKey, iterationNumber);
}

function fetchRunBeads(runId) {
  if (!runId) return;
  // 150ms-gated spinner: only surface a spinner if the fetch is still pending
  // after 150ms, so a fast load (warm path) never flashes one. Arm the timer
  // only when there's no loaded value yet (a refetch over existing data keeps
  // showing that data, not a spinner).
  if (!runBeads.has(runId) && !beadsSpinnerTimers.has(runId)) {
    const timer = setTimeout(() => {
      beadsSpinnerTimers.delete(runId);
      if (!runBeads.has(runId)) {
        beadsSpinner.add(runId);
        rerender();
      }
    }, 150);
    beadsSpinnerTimers.set(runId, timer);
  }
  const settle = () => {
    const t = beadsSpinnerTimers.get(runId);
    if (t) {
      clearTimeout(t);
      beadsSpinnerTimers.delete(runId);
    }
    beadsSpinner.delete(runId);
  };
  ws.send('list-beads-by-run', { runId, projectId: _runProjectId(runId) })
    .then((payload) => {
      settle();
      runBeads.set(runId, payload.issues || []);
      rerender();
    })
    .catch(() => {
      settle();
      // null = load failed — distinct from [] ("no linked beads") so the panel
      // doesn't falsely claim the run has no beads when the query errored.
      runBeads.set(runId, null);
      rerender();
    });
}

function fetchRunAccessModel(runId, force = false) {
  if (!runId) return;
  // Cached one-shot for completed runs; `force` (the live poll) refetches so the
  // server's live fragment folding reaches the page during an active run.
  if (!force && runAccessModels.has(runId)) return;
  ws.send('get-file-access', { runId, projectId: _runProjectId(runId) })
    .then((payload) => {
      runAccessModels.set(runId, payload);
      rerender();
    })
    .catch(() => {
      if (!runAccessModels.has(runId)) {
        runAccessModels.set(runId, { enabled: false });
        rerender();
      }
    });
}

// Live Access Map: while the access view of an active run is open, re-fetch the
// model every few seconds so the in-progress iteration's fragment (folded live
// server-side) keeps updating. Self-terminates when the run reaches a terminal
// state, and is cleared on navigation away (route-change handler).
let _accessPollTimer = null;
let _accessPollRunId = null;
const _ACCESS_POLL_MS = 3000;
const _TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function _isRunPollable(runId) {
  const r = store.getRunById(runId);
  if (!r) return true; // status not known yet — poll until we learn otherwise
  const ps = r.pipeline_status || (r.active ? 'running' : 'completed');
  return !_TERMINAL_RUN_STATUSES.has(ps);
}

function startAccessPoll(runId) {
  if (_accessPollRunId === runId && _accessPollTimer) return; // already polling
  stopAccessPoll();
  _accessPollRunId = runId;
  _accessPollTimer = setInterval(() => {
    fetchRunAccessModel(runId, true);
    if (!_isRunPollable(runId)) stopAccessPoll(); // final fetch issued above
  }, _ACCESS_POLL_MS);
}

function stopAccessPoll() {
  if (_accessPollTimer) {
    clearInterval(_accessPollTimer);
    _accessPollTimer = null;
  }
  _accessPollRunId = null;
}

function fetchAgentPrompts(runId, stages) {
  if (!runId || !stages) return;
  if (!promptCache[runId]) promptCache[runId] = {};
  const projectId = _runProjectId(runId);
  for (const [key, stage] of Object.entries(stages)) {
    if (stage.status === 'pending') continue;
    const cacheKey = `${runId}:${key}`;
    if (promptCache[runId][key] || promptCachePending.has(cacheKey)) continue;
    promptCachePending.add(cacheKey);
    ws.send('get-agent-prompt', { runId, stage: key, projectId })
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
    ws.send('subscribe-log', {
      stage: null,
      runId: newRun.id,
      projectId: _runProjectId(newRun.id),
    }).catch(() => {});
  }
}

// --- Wire WS events to state ---

ws.on('runs-list', (payload, msg) => {
  const isMultiProject = (store.getState().projects || []).length > 1;
  // In multi-project mode, always merge so all projects keep their runs
  if (isMultiProject) {
    const existing = { ...store.getState().runs };
    const freshIds = new Set((payload.runs || []).map((r) => r.id));
    const sourceProject = msg?.project || null;
    if (sourceProject) {
      for (const [id, run] of Object.entries(existing)) {
        if (run._project === sourceProject && !freshIds.has(id)) {
          delete existing[id];
        }
      }
    }
    const archivedUpdates = { ...store.getState().archivedRuns };
    // Prune stale archived runs from source project
    if (sourceProject) {
      for (const [id, run] of Object.entries(archivedUpdates)) {
        if (run._project === sourceProject && !freshIds.has(id)) {
          delete archivedUpdates[id];
        }
      }
    }
    const now = Date.now();
    for (const run of payload.runs || []) {
      const prev = existing[run.id] || archivedUpdates[run.id];
      run._project =
        sourceProject ||
        run.project ||
        run._project ||
        prev?._project ||
        prev?.project ||
        null;
      if (run.archived) {
        if (isArchivedRunExpired(run, now)) continue;
        archivedUpdates[run.id] = run;
        delete existing[run.id];
      } else {
        existing[run.id] = run;
        delete archivedUpdates[run.id];
      }
    }
    if (payload.settings) settings = payload.settings;
    store.setState({
      runs: existing,
      archivedRuns: archivedUpdates,
      runsLoaded: true,
    });
    return;
  }
  if (payload.settings) settings = payload.settings;
  store.setRunsBulk(payload.runs || []);
});

// Pipeline lifecycle changes (start/finish) move worktrees in/out of the
// active set. Refresh worktrees on each runs-list bulk push so the sidebar
// count badge and worktrees view stay in sync without a manual reload.
ws.on('runs-list', () => {
  fetchWorktrees();
  const runs = store.getState().runs;
  let totalRunning = 0;
  for (const r of Object.values(runs)) {
    const ps = r.pipeline_status || (r.active ? 'running' : 'completed');
    if (ps === 'running' || ps === 'paused') totalRunning++;
  }
  store.setState({ totalRunning });
});

ws.on('run-snapshot', (payload) => {
  if (payload?.id) {
    const prevRun = store.getRunById(payload.id) ?? null;
    // Suppress notifications for archived runs
    const isArchived =
      payload.archived === true || !!store.getState().archivedRuns[payload.id];
    if (!isArchived) {
      notificationManager.handleRunUpdate(payload.id, payload, prevRun);
    }
    // Invalidate prompt cache for stages whose iteration count or prompt changed
    if (prevRun && promptCache[payload.id]) {
      for (const [key, stage] of Object.entries(payload.stages || {})) {
        const prevStage = prevRun.stages?.[key];
        const prevCount = prevStage?.iterations?.length || 0;
        const newCount = stage.iterations?.length || 0;
        if (newCount > prevCount) {
          delete promptCache[payload.id][key];
        } else if (stage.prompt && stage.prompt !== prevStage?.prompt) {
          delete promptCache[payload.id][key];
        }
      }
    }
    store.setRun(payload.id, payload);
    if (route.runId === payload.id) {
      autoResetLogFilterOnStageChange(prevRun, payload);
      updateActiveStage(payload);
    }
  }
});

ws.on('run-update', (payload) => {
  if (payload?.id) {
    const prevRun = store.getRunById(payload.id) ?? null;
    // Suppress notifications for archived runs
    const isArchivedUpdate =
      payload.archived === true || !!store.getState().archivedRuns[payload.id];
    if (!isArchivedUpdate) {
      notificationManager.handleRunUpdate(payload.id, payload, prevRun);
    }
    store.setRun(payload.id, payload);
    if (route.runId === payload.id) {
      autoResetLogFilterOnStageChange(prevRun, payload);
      updateActiveStage(payload);
      fetchRunBeads(payload.id);
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
    // appendLog no longer emits; coalesced rerender keeps the Log History
    // stage-dropdown fallback current as new stages produce output.
    scheduleRerender();
  }
});

ws.on('log-bulk', (payload) => {
  if (payload && Array.isArray(payload.lines)) {
    const entries = [];
    for (const line of payload.lines) {
      // NB: timestamp is receive-time, not original write-time (log files lack per-line timestamps)
      const entry = {
        stage: payload.stage,
        iteration: payload.iteration,
        line,
        timestamp: new Date().toISOString(),
      };
      entries.push(entry);
      // Log History: only write to the history terminal when a specific stage is selected
      if (logFilter !== '*') writeLogLine(entry);
      writeLiveLogLine(entry);
    }
    // Single buffered append + one coalesced rerender for the whole backfill,
    // instead of one full app render per line.
    store.appendLogs(entries);
    scheduleRerender();
  }
});

ws.on('preferences', (payload) => {
  if (payload) {
    store.setState({ preferences: payload });
    applyTheme(payload.theme || 'light');
  }
});

// Fleet manifest watcher pushes fleet-update events when ~/.worca/fleet-runs/<id>.json
// changes. Refresh the list so the sidebar count badge and any open fleet
// detail view stay current.
ws.on('fleet-update', () => {
  fetch('/api/fleet-runs')
    .then((r) => r.json())
    .then((data) => {
      store.setState({ fleets: data?.fleets || [], fleetsLoaded: true });
      // Invalidate cached detail manifests so the next view fetch is fresh.
      // Drop missing markers in the same step — a fleet-list refresh implies
      // any negative caches may be stale (manifest could have been restored).
      for (const k of Object.keys(_fleetDetailCache)) {
        delete _fleetDetailCache[k];
      }
      _fleetDetailMissing.clear();
    })
    .catch(() => {});
});

ws.on('beads-update', (payload, msg) => {
  const currentProject = store.getState().currentProjectId;
  if (msg?.project && currentProject && msg.project !== currentProject) return;
  if (payload) {
    const serialized = JSON.stringify(payload);
    if (serialized === lastBeadsPayload) return;
    lastBeadsPayload = serialized;
    store.setState({
      beads: {
        issues: payload.issues || [],
        dbExists: payload.dbExists ?? false,
        dbPath: payload.dbPath || null,
        loading: false,
      },
    });
    beadsCounts = payload.counts || {};
    // Refetch the viewed run on every beads update so non-count edits
    // (title, description, notes, priority) still render live. The N+1
    // we eliminated was the server-side per-run-label cost; one
    // viewed-run refetch per WAL tick is a single bd call and bounded.
    if (route.runId && route.section !== 'beads') fetchRunBeads(route.runId);
    if (route.runId && route.section === 'beads')
      fetchBeadsRunIssues(route.runId);
    scheduleRerender();
  }
});

/** Fetch runs list from server and update store. Returns a promise. */
function fetchAndUpdateRuns() {
  return ws.send('list-runs').then((payload) => {
    if (payload.settings) settings = payload.settings;
    store.setRunsBulk(payload.runs || []);
  });
}

ws.on('run-started', () => {
  fetchAndUpdateRuns().catch(() => {});
  rerender();
});

ws.on('run-archived', (payload) => {
  if (payload?.runId) {
    const existingRun =
      store.getState().runs[payload.runId] ??
      store.getState().archivedRuns[payload.runId];
    if (existingRun) {
      store.setRun(payload.runId, {
        ...existingRun,
        archived: true,
        archived_at: payload.archived_at || new Date().toISOString(),
      });
    } else {
      fetchAndUpdateRuns().catch(() => {});
    }
  }
});

ws.on('run-unarchived', (payload) => {
  if (payload?.runId) {
    const existingRun =
      store.getState().runs[payload.runId] ??
      store.getState().archivedRuns[payload.runId];
    if (existingRun) {
      const { archived: _a, archived_at: _b, ...rest } = existingRun;
      store.setRun(payload.runId, rest);
    } else {
      fetchAndUpdateRuns().catch(() => {});
    }
  }
});

ws.on('run-stopped', () => {
  rerender();
});

ws.on('run-cancelled', (payload) => {
  if (payload?.runId) {
    const run = store.getRunById(payload.runId);
    if (run) {
      store.setRun(payload.runId, {
        ...run,
        pipeline_status: 'cancelled',
        active: false,
      });
    }
  }
});

ws.on('stage-restarted', () => {
  // Status watcher's runs-list push handles the update
});

ws.on('learn-started', (payload) => {
  if (payload?.runId && payload.runId === route.runId) {
    ws.send('subscribe-run', {
      runId: payload.runId,
      projectId: _runProjectId(payload.runId),
    }).catch(() => {});
  }
});

// --- Webhook inbox events ---

ws.on('webhook-inbox-event', (payload) => {
  if (payload) {
    const currentProject = store.getState().currentProjectId;
    if (
      !payload.projectId ||
      !currentProject ||
      payload.projectId === currentProject
    ) {
      const inbox = store.getState().webhookInbox;
      store.setState({
        webhookInbox: { ...inbox, events: [...inbox.events, payload] },
      });
    }
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

// --- Protocol negotiation ---

function handleHello(_payload) {
  const capabilities = _payload?.capabilities || [];
  const isMultiProject = capabilities.includes('multi-project');

  if (!isMultiProject) {
    // Single-project mode: no /api/projects endpoint, just ack and fetch data
    ws.sendRaw({
      type: 'hello-ack',
      payload: { protocol: 2, projectId: null },
    });
    fetchProjectScopedData();
    return;
  }

  // Fetch fleets list (used by sidebar's Fleets entry + count badge). Best-effort.
  // Flip fleetsLoaded on success AND failure so the sidebar spinner stops
  // even when the endpoint is missing in older clones — same UX contract
  // worktreesLoaded / runsLoaded follow.
  fetch('/api/fleet-runs')
    .then((r) => r.json())
    .then((data) => {
      store.setState({ fleets: data?.fleets || [], fleetsLoaded: true });
    })
    .catch(() => {
      store.setState({ fleetsLoaded: true });
    });

  // Fetch workspace runs list (used by sidebar's Workspaces entry + count badge).
  // Best-effort — server may not be wired in older clones.
  fetch('/api/workspace-runs')
    .then((r) => r.json())
    .then((data) => {
      store.setState({
        workspaceRuns: data?.workspace_runs || [],
        workspaceRunsLoaded: true,
      });
    })
    .catch(() => {
      store.setState({ workspaceRunsLoaded: true });
    });

  // Fetch workspace definitions (used by the launcher's "Select workspace"
  // dropdown). Distinct from workspace runs — see state.js comment.
  fetch('/api/workspaces')
    .then((r) => r.json())
    .then((data) => {
      store.setState({ workspaces: data?.workspaces || [] });
    })
    .catch(() => {});

  // Multi-project mode: fetch projects and send hello-ack
  fetch('/api/projects')
    .then((r) => r.json())
    .then((data) => {
      const projects = data.projects || [];
      store.setState({ projects });

      // Determine currentProjectId from URL; only auto-select when single project
      const currentProjectId =
        route.projectId || (projects.length === 1 ? projects[0].name : null);
      store.setState({ currentProjectId });

      // Send hello-ack — sets project context on server before any requests
      ws.sendRaw({
        type: 'hello-ack',
        payload: { protocol: 2, projectId: currentProjectId },
      });

      // Now that project context is set, fetch project-scoped data
      fetchProjectScopedData();
    })
    .catch(() => {});
}

/** Fetch runs from all projects via REST and merge into state. */
function fetchAllProjectRuns() {
  const projects = store.getState().projects || [];
  return Promise.all(
    projects.map((p) =>
      fetch(`/api/projects/${p.name}/runs`)
        .then((r) => r.json())
        .then((data) => mapProjectRunsResponse(data, p.name))
        .catch(() => ({ runs: [], settings: null, projectName: p.name })),
    ),
  ).then((results) => {
    const runs = {};
    const archivedRuns = {};
    const now = Date.now();
    for (const { runs: projectRuns, settings: projSettings } of results) {
      // Use settings from any project that provides them (last write wins;
      // in practice loop limits are uniform across projects).
      if (projSettings) settings = projSettings;
      for (const run of projectRuns) {
        if (run.archived) {
          if (isArchivedRunExpired(run, now)) continue;
          archivedRuns[run.id] = run;
        } else {
          runs[run.id] = run;
        }
      }
    }
    store.setState({ runs, archivedRuns, runsLoaded: true });
    rerender();
  });
}

/** Fetch worktrees for the current project (or all projects when none selected). */
function fetchWorktrees() {
  const projects = store.getState().projects || [];
  const currentProjectId = store.getState().currentProjectId;
  // Worktrees are exposed only via /api/projects/<id>/worktrees. In single-
  // project mode without a registered project, leave worktrees empty.
  const targets = currentProjectId
    ? [currentProjectId]
    : projects.length > 1
      ? projects.map((p) => p.name)
      : [];

  if (targets.length === 0) {
    store.setState({ worktrees: [], worktreesLoaded: true });
    return;
  }

  const requests = targets.map((name) =>
    fetch(`/api/projects/${name}/worktrees`)
      .then((r) => r.json())
      .then((data) => mapWorktreesResponse(data, name))
      .catch(() => []),
  );

  Promise.all(requests).then((lists) => {
    store.setState({ worktrees: lists.flat(), worktreesLoaded: true });
    // Reload during cleanup or a freshly-stamped pending — keep polling
    // until the server confirms everything has settled.
    if (anyCleanupInFlight()) startCleanupPolling();
  });
}

/** Fetch all project-scoped data after hello-ack sets the project context. */
function fetchProjectScopedData() {
  // Multi-project mode: always fetch runs from every project so the sidebar
  // dots reflect the real status of all projects, not just the selected one.
  // We capture the runs-load promise so the run-scoped subscriptions below
  // can wait for it — without that, `_runProjectId(route.runId)` resolves
  // to null because state.runs is empty, the WS request hits the wrong
  // project, and the artifact panels (logs, beads, agent prompts) end up
  // empty on initial page load.
  const runsLoadedPromise =
    (store.getState().projects || []).length > 1
      ? fetchAllProjectRuns()
      : ws
          .send('list-runs')
          .then((payload) => {
            if (payload.settings) settings = payload.settings;
            store.setRunsBulk(payload.runs || []);
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
  fetchWorktrees();

  // Subscribe to active run if selected. Wait for runs to load so that
  // `_runProjectId(route.runId)` can resolve to the correct project — the
  // server falls back to its default project when no projectId is supplied,
  // which is the wrong one in global mode and causes the artifact panels
  // to come up empty.
  if (route.runId) {
    runsLoadedPromise.then(() => {
      if (route.section !== 'beads') {
        const projectId = _runProjectId(route.runId);
        ws.send('subscribe-run', {
          runId: route.runId,
          projectId,
        }).catch(() => {});
        ws.send('subscribe-log', {
          stage: logFilter === '*' ? null : logFilter,
          runId: route.runId,
          projectId,
        }).catch(() => {});
      }
      fetchRunBeads(route.runId);
      if (route.section === 'beads') fetchBeadsRunIssues(route.runId);
    });
  }
}

ws.on('hello', handleHello);

ws.on('projects-updated', (payload) => {
  if (payload?.projects) {
    store.setState({ projects: payload.projects });
  }
});

// --- Project switching ---

function handleProjectSwitch(newProjectId) {
  // Unsubscribe from any run/log/event subscriptions tied to the old project
  // before switching context — otherwise the server keeps pushing updates
  // for the old project's runs to this client.
  ws.send('unsubscribe-run').catch(() => {});
  ws.send('unsubscribe-log').catch(() => {});
  ws.send('unsubscribe-events').catch(() => {});
  store.clearLog();

  store.setState({
    currentProjectId: newProjectId,
    runs: {},
    archivedRuns: {},
    logLines: [],
    activeRunId: null,
    runsLoaded: false,
    worktrees: [],
    worktreesLoaded: false,
  });
  worktreesFilter = '';
  worktreesStatusFilter = 'all';
  worktreesDialogItem = null;
  worktreesDialogBulk = false;
  worktreesDialogCheckbox = false;

  resetProjectState();

  // Send updated hello-ack
  ws.sendRaw({
    type: 'hello-ack',
    payload: { protocol: 2, projectId: newProjectId },
  });

  // Re-fetch data for new project — always fetch all projects so sidebar
  // dots stay accurate for unselected projects too.
  if ((store.getState().projects || []).length > 1) {
    fetchAllProjectRuns();
  } else {
    ws.send('list-runs')
      .then((payload) => {
        if (payload.settings) settings = payload.settings;
        store.setRunsBulk(payload.runs || []);
      })
      .catch(() => {});
  }

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

  // Clear and re-fetch webhook inbox for new project
  store.setState({
    webhookInbox: {
      events: [],
      controlAction: store.getState().webhookInbox?.controlAction || 'continue',
    },
  });
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
  fetchWorktrees();
}

// --- Connection handling ---

ws.onConnection((state) => {
  connectionState = state;
  if (state === 'open') {
    // Only fetch global (non-project-scoped) data here.
    // Project-scoped data is fetched in handleHello after hello-ack sets
    // the project context on the server.
    ws.send('get-preferences')
      .then((prefs) => {
        store.setState({ preferences: prefs });
        applyTheme(prefs.theme || 'light');
      })
      .catch(() => {});
  }
  rerender();
});

// --- Routing ---

onHashChange((newRoute) => {
  // Same legacy-templates migration as bootstrap — covers mid-session
  // navigation (clicking a stale link with the old hash shape). The
  // redirect re-enters this handler with the canonical hash, so we
  // bail this pass when it fires.
  if (
    newRoute.section === 'pipelines' ||
    (newRoute.section === 'templates' &&
      newRoute.tier &&
      !TEMPLATE_TIERS.includes(newRoute.tier))
  ) {
    navigate('templates', null, newRoute.projectId);
    return;
  }
  const prevRunId = route.runId;
  const prevProjectId = route.projectId;
  route = newRoute;

  // Detect project switch via URL
  if (newRoute.projectId !== prevProjectId) {
    handleProjectSwitch(newRoute.projectId);
  }

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
      const projectId = _runProjectId(route.runId);
      ws.send('subscribe-run', {
        runId: route.runId,
        projectId,
      }).catch(() => {});
      ws.send('subscribe-log', {
        stage: null,
        runId: route.runId,
        projectId,
      }).catch(() => {});
      fetchRunBeads(route.runId);
    }
  }

  if (route.section === 'settings') {
    loadSettings(null).then(() => rerender());
    startIntegrationsPoll();
  } else {
    stopIntegrationsPoll();
  }

  // Access Map data load. Force a fresh fetch on every navigation into the
  // access tab: the per-runId model cache is render-repaint state, not a
  // freshness signal. Without this, a model cached mid-run (empty/partial) is
  // served verbatim when the tab is reopened after the run completes — the live
  // poll has stopped for the now-terminal run and the render path's fetch is a
  // cache hit — so the final Access Map only appeared after a full page reload.
  // For non-terminal runs the poll keeps refetching; for terminal runs this one
  // forced fetch on open delivers the final folded model.
  if (route.action === 'access' && route.runId) {
    fetchRunAccessModel(route.runId, true);
    if (_isRunPollable(route.runId)) {
      startAccessPoll(route.runId);
    } else {
      stopAccessPoll();
    }
  } else {
    stopAccessPoll();
  }

  if (route.section === 'project-settings') {
    // In single-project mode the server has worcaDir, so loadSettings(null)
    // works. In All-Projects mode (multi-project + no selection) it hits
    // the un-scoped endpoint with no real project — skip the fetch; the
    // view renders a CTA empty state instead.
    const s = store.getState();
    const isAllProjects = (s.projects || []).length > 1 && !s.currentProjectId;
    if (!isAllProjects) {
      loadSettings(s.currentProjectId || null).then(() => rerender());
    }
  }

  if (route.section === 'new-run') {
    invalidateTemplateCache();
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

function handleNavigate(section, runId) {
  // runId is forwarded so callers can deep-link (e.g. fleet header → fleet
  // detail at /fleet-runs/<id>). Most invocations pass only `section`, which
  // leaves runId === undefined and navigates to the section root.
  navigate(section, runId ?? null, route.projectId);
}

function handleSelectRun(runId) {
  navigate(route.section, runId, route.projectId);
}

function handleProjectChange(projectId) {
  if (!projectId) {
    navigate('dashboard', null, null);
  } else {
    navigate(route.section, null, projectId);
  }
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

function handleSaveSourceRepo(sourceRepo) {
  ws.send('set-preferences', { source_repo: sourceRepo }).catch(() => {});
  store.setState({ preferences: { source_repo: sourceRepo } });
}

// --- Pipelines / Templates handlers ---

async function handleSetDefaultTemplate(tid, tier) {
  // Set Default is a project-level setting exposed for project-tier
  // and builtin-tier templates. tier defaults to 'project' when the
  // caller doesn't supply one. Passing `tid: null` clears the
  // pointer (Unset Default).
  const clearing = tid == null;
  const useTier = clearing ? null : tier || 'project';
  try {
    const res = await fetch(projectUrl('/default-template'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        clearing ? { tier: null, id: null } : { tier: useTier, id: tid },
      ),
    });
    const data = await res.json();
    if (!data.ok) {
      _showToast(data.error || 'Failed to set default template', 'danger');
      return;
    }
    const nextDefault = clearing ? null : { tier: useTier, id: tid };
    settings = {
      ...settings,
      worca: {
        ...settings.worca,
        default_template: nextDefault,
      },
    };
    // Keep state.defaultTemplate (the bundled-with-templates pointer
    // used by the list view + editor header toggle) in sync — without
    // this, the editor header would still read the stale value until
    // the next /templates fetch.
    store.setState({ defaultTemplate: nextDefault });
    _showToast(
      clearing
        ? 'Default template cleared'
        : `Default template set to "${tid}" (${useTier})`,
      'success',
    );
    rerender();
  } catch (err) {
    _showToast(`Failed to set default template: ${err.message}`, 'danger');
  }
}

function _countInflightRunsForTemplate(tid) {
  const runs = store.getState().runs || {};
  return Object.values(runs).filter(
    (r) =>
      r.pipeline_template === tid &&
      (r.pipeline_status === 'running' || r.pipeline_status === 'paused'),
  ).length;
}

async function handleDeleteTemplate(tid, tier) {
  // In-flight runs get their own richer confirmation (count + edit-vs-delete
  // copy) via the template-guard dialog — keep that path.
  const count = _countInflightRunsForTemplate(tid);
  if (count > 0) {
    _templateGuard = { tid, tier, action: 'delete', count };
    rerender();
    requestAnimationFrame(() => {
      document.querySelector('.template-guard-dialog')?.show();
    });
    return;
  }
  showConfirm(
    {
      label: 'Delete template',
      message: html`
        Are you sure you want to delete
        <code>${tid}</code> from the <strong>${tier}</strong> scope?
        <br /><br />
        This removes the template directory on disk; running pipelines are
        unaffected but new runs will no longer be able to launch with this id.
      `,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
      onConfirm: () => _executeDeleteTemplate(tid, tier),
    },
    rerender,
  );
}

async function _executeDeleteTemplate(tid, tier) {
  try {
    const res = await fetch(projectUrl(`/templates/${tier}/${tid}`), {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!data.ok) {
      showActionError(data.error || 'Failed to delete template');
      return;
    }
    const templates = await fetchTemplates(
      store.getState().currentProjectId || null,
    );
    store.setState({ templates, defaultTemplate: templates.defaultTemplate });
    rerender();
  } catch (err) {
    showActionError(`Failed to delete template: ${err.message}`);
  }
}

// ─── Models handlers ─────────────────────────────────────────────────────
//
// Symmetric to the template handlers: edit navigates to the editor; create
// navigates to the editor with a fresh slot at project tier (the editor's
// own tier selector lets the user retarget User before saving); duplicate
// and delete prompt via the shared confirm-dialog and refresh the cached
// list on success.

function handleEditModel(tier, alias) {
  navigate('models', alias, store.getState().currentProjectId, 'edit', tier);
}

function handleCreateModel() {
  // Default tier = project, matching the templates create flow. The editor
  // surfaces a tier picker when isNew=true so the user can flip to User
  // before saving — see model-editor.js.
  navigate(
    'models',
    'new',
    store.getState().currentProjectId,
    'edit',
    'project',
  );
}

function handleDuplicateModel(tier, alias) {
  _modelActionDialog = {
    mode: 'duplicate',
    srcTier: tier,
    srcAlias: alias,
    dstTier: tier === 'builtin' ? 'project' : tier,
    dstAlias: `${alias}-copy`,
    error: null,
  };
  rerender();
  requestAnimationFrame(() => {
    document.querySelector('.model-action-dialog')?.show();
  });
}

async function handleDeleteModel(tier, alias) {
  if (tier === 'builtin') {
    showActionError('Built-in models are read-only — cannot delete.');
    return;
  }
  showConfirm(
    {
      label: 'Delete model',
      message: html`
        Are you sure you want to delete
        <code>${alias}</code> from the <strong>${tier}</strong> tier?
        <br /><br />
        This removes both the id (settings.json) and the env block
        (settings.local.json). Templates that reference this alias will
        fall through to a lower tier or fail to resolve.
      `,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
      onConfirm: () => _executeDeleteModel(tier, alias),
    },
    rerender,
  );
}

async function _executeDeleteModel(tier, alias) {
  try {
    const res = await fetch(
      projectUrl(`/models/${tier}/${encodeURIComponent(alias)}`),
      { method: 'DELETE' },
    );
    const data = await res.json();
    if (!data.ok) {
      showActionError(data.error || 'Failed to delete model');
      return;
    }
    const models = await fetchModels(store.getState().currentProjectId || null);
    store.setState({ models, modelsLoaded: true });
    rerender();
  } catch (err) {
    showActionError(`Failed to delete model: ${err.message}`);
  }
}

let _modelActionDialog = null;

function _dismissModelActionDialog() {
  _modelActionDialog = null;
  rerender();
}

async function _executeDuplicateModel() {
  if (!_modelActionDialog) return;
  const { srcTier, srcAlias, dstTier, dstAlias } = _modelActionDialog;
  if (!dstAlias || !/^[a-zA-Z0-9_-]{1,64}$/.test(dstAlias)) {
    _modelActionDialog = {
      ..._modelActionDialog,
      error: 'Alias must match [a-zA-Z0-9_-], 1-64 chars.',
    };
    rerender();
    return;
  }
  try {
    const res = await fetch(
      projectUrl(
        `/models/${srcTier}/${encodeURIComponent(srcAlias)}/duplicate`,
      ),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dst_tier: dstTier, dst_alias: dstAlias }),
      },
    );
    const data = await res.json();
    if (!data.ok) {
      _modelActionDialog = {
        ..._modelActionDialog,
        error: data.error || 'Duplicate failed',
      };
      rerender();
      return;
    }
    const models = await fetchModels(store.getState().currentProjectId || null);
    store.setState({ models, modelsLoaded: true });
    _dismissModelActionDialog();
    // Drop the user straight into the new entry so they can adjust env /
    // pricing immediately, mirroring how Pipeline Templates routes after
    // a duplicate succeeds.
    navigate(
      'models',
      dstAlias,
      store.getState().currentProjectId,
      'edit',
      dstTier,
    );
  } catch (err) {
    _modelActionDialog = {
      ..._modelActionDialog,
      error: `Duplicate failed: ${err.message}`,
    };
    rerender();
  }
}

function _modelDuplicateDialogTemplate() {
  const dlg = _modelActionDialog;
  if (!dlg || dlg.mode !== 'duplicate') return '';
  const { srcTier, srcAlias, dstTier, dstAlias, error } = dlg;
  return html`
    <sl-dialog
      label="Duplicate model"
      class="model-action-dialog"
      open
      @sl-after-hide=${() => _dismissModelActionDialog()}
    >
      <div class="model-duplicate-form">
        <p>
          Duplicate <code>${srcAlias}</code> (from
          <strong>${srcTier}</strong>) to a new tier + alias.
        </p>
        <sl-radio-group
          label="Destination tier"
          name="dst-tier"
          value=${dstTier}
          @sl-change=${(e) => {
            _modelActionDialog = {
              ..._modelActionDialog,
              dstTier: e.target.value,
            };
            rerender();
          }}
        >
          <sl-radio value="project">Project</sl-radio>
          <sl-radio value="user">User</sl-radio>
        </sl-radio-group>
        <sl-input
          label="Destination alias"
          .value=${dstAlias}
          @sl-input=${(e) => {
            _modelActionDialog = {
              ..._modelActionDialog,
              dstAlias: e.target.value,
            };
            rerender();
          }}
        ></sl-input>
        ${
          error ? html`<sl-alert variant="danger" open>${error}</sl-alert>` : ''
        }
      </div>
      <sl-button slot="footer" variant="default" @click=${() => _dismissModelActionDialog()}>
        Cancel
      </sl-button>
      <sl-button slot="footer" variant="primary" @click=${() => _executeDuplicateModel()}>
        Duplicate
      </sl-button>
    </sl-dialog>
  `;
}

function handleEditTemplate(tid, tier) {
  const count = _countInflightRunsForTemplate(tid);
  if (count > 0) {
    _templateGuard = { tid, tier, action: 'edit', count };
    rerender();
    requestAnimationFrame(() => {
      document.querySelector('.template-guard-dialog')?.show();
    });
    return;
  }
  navigate('templates', tid, route.projectId, 'edit', tier);
}

function _confirmTemplateGuard() {
  const guard = _templateGuard;
  _templateGuard = null;
  document.querySelector('.template-guard-dialog')?.hide();
  if (!guard) return;
  if (guard.action === 'delete') {
    _executeDeleteTemplate(guard.tid, guard.tier);
  } else {
    navigate('templates', guard.tid, route.projectId, 'edit', guard.tier);
  }
}

function _dismissTemplateGuard() {
  _templateGuard = null;
  rerender();
}

/**
 * Defer focus to the first input of the action dialog after the next
 * paint. The sl-after-show event doesn't fire reliably when the dialog
 * is mounted via lit-html's declarative `open` attribute (vs the
 * imperative show() flow), so we schedule the focus shift ourselves
 * once the DOM has settled. Two RAFs let Shoelace finish hooking up
 * its shadow DOM before we reach for the field.
 */
function _focusActionDialogInput() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const dialog = document.querySelector('sl-dialog.template-action-dialog');
      if (!dialog) return;
      const target =
        dialog.querySelector('sl-input') ||
        dialog.querySelector('input[type="file"]') ||
        dialog.querySelector('sl-select');
      if (target && typeof target.focus === 'function') {
        target.focus();
      }
    });
  });
}

/**
 * Open the Duplicate dialog. The destination id defaults to the source
 * id (the canonical "shadow & edit" flow); the user can override both
 * the id and the target scope before confirming.
 */
function handleDuplicateTemplate(tid, tier) {
  // Tier is passed directly from the card so we never have to guess
  // by re-resolving the id against the list. Default destination tier
  // for built-ins is 'project' (the canonical shadow flow);
  // duplicating within project/user defaults to the same tier (so the
  // dialog at least surfaces the no-op slot the server will reject).
  const srcTier = tier || 'builtin';
  _templateActionDialog = {
    mode: 'duplicate',
    srcId: tid,
    srcTier,
    id: tid,
    tier: srcTier === 'builtin' ? 'project' : srcTier,
    name: '',
    nameDirty: false,
    error: null,
  };
  rerender();
  _focusActionDialogInput();
}

/**
 * Open the New dialog — empty form, user picks an id + tier and
 * optionally a base template to clone from. On confirm we POST a new
 * minimal template (or call duplicate when a base is selected), then
 * navigate into the editor on the new (tier, id).
 */
function handleCreateTemplate(_projectId) {
  _templateActionDialog = {
    mode: 'create',
    id: '',
    name: '',
    tier: 'project',
    // baseTid holds "<tier>:<id>" so the user can pick the exact copy
    // they want to clone from (project vs built-in for the same id).
    baseRef: '',
    // Auto-slug id from name until the user touches the id field.
    idDirty: false,
    error: null,
  };
  rerender();
  _focusActionDialogInput();
}

/**
 * Open the Import dialog. The user picks a `.json` bundle exported via
 * Export, plus a target tier. We parse client-side so the dialog can
 * preview which template ids are about to land.
 */
function handleImportTemplate(_projectId) {
  _templateActionDialog = {
    mode: 'import',
    file: null,
    parsed: null,
    tier: 'project',
    error: null,
  };
  rerender();
  _focusActionDialogInput();
}

function _dismissTemplateActionDialog() {
  _templateActionDialog = null;
  _templateActionBusy = false;
  rerender();
}

function _onCollisionActionChange(alias, action, suggested) {
  if (!_templateActionDialog) return;
  const prev = _templateActionDialog.resolutions?.[alias] || {};
  const next = { action };
  if (action === 'rename') {
    next.new_name = prev.new_name || suggested || `${alias}-01`;
  }
  _templateActionDialog = {
    ..._templateActionDialog,
    resolutions: {
      ...(_templateActionDialog.resolutions || {}),
      [alias]: next,
    },
  };
  rerender();
}

function _onCollisionRenameInput(alias, newName) {
  if (!_templateActionDialog) return;
  const prev = _templateActionDialog.resolutions?.[alias] || {
    action: 'rename',
  };
  _templateActionDialog = {
    ..._templateActionDialog,
    resolutions: {
      ...(_templateActionDialog.resolutions || {}),
      [alias]: { ...prev, action: 'rename', new_name: newName },
    },
  };
  rerender();
}

function _onTemplateCollisionChange(tid, action) {
  if (!_templateActionDialog) return;
  _templateActionDialog = {
    ..._templateActionDialog,
    templateResolutions: {
      ...(_templateActionDialog.templateResolutions || {}),
      [tid]: { action },
    },
  };
  rerender();
}

const _TEMPLATE_ID_RE = /^[a-z0-9_-]{1,64}$/;

/**
 * Produce a template id from a human-friendly name. Mirrors what
 * worca-cc accepts: lowercase letters / digits / hyphens / underscores,
 * 1–64 chars. Used by the Create dialog and the editor's Name field
 * to auto-fill the Id field until the user manually edits it.
 *
 * Strategy: lowercase, replace any run of non-alnum-underscore with a
 * single hyphen, trim leading/trailing hyphens, cap at 64 chars.
 */
function _slugifyId(name) {
  if (!name) return '';
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug;
}
export { _slugifyId as slugifyId };

function _validateActionDialog(dlg, state) {
  if (!dlg) return null;
  // Export only chooses a mode; nothing to validate.
  if (dlg.mode === 'export') return null;
  if (dlg.mode === 'import') {
    if (dlg.importResult) return null;
    if (!dlg.parsed) return 'Choose a bundle file to import.';
    return null;
  }
  if (!dlg.id || !_TEMPLATE_ID_RE.test(dlg.id)) {
    return 'Id must match [a-z0-9_-], 1–64 chars.';
  }
  // Inline collision check — faster feedback than waiting for the
  // server. Compares against `(tier, id)` now that the API treats
  // both as the primary key.
  if (
    dlg.mode === 'rename' ||
    dlg.mode === 'duplicate' ||
    dlg.mode === 'create'
  ) {
    if (
      dlg.mode === 'rename' &&
      dlg.id === dlg.srcId &&
      dlg.tier === dlg.srcTier
    ) {
      return 'Pick a new id or tier (no change selected).';
    }
    const templates = state.templates || [];
    const conflict = templates.find(
      (t) => t.id === dlg.id && t.tier === dlg.tier,
    );
    if (conflict) {
      return `An id "${dlg.id}" already exists in the ${dlg.tier} scope.`;
    }
  }
  return null;
}

function _updateActionDialog(patch) {
  if (!_templateActionDialog) return;
  _templateActionDialog = { ..._templateActionDialog, ...patch };
  rerender();
}

async function _onImportFileChange(e) {
  const file = e.target.files?.[0];
  if (!file) {
    _updateActionDialog({ file: null, parsed: null, error: null });
    return;
  }

  // Sniff first 4 bytes for ZIP magic (PK\x03\x04, PK\x05\x06, PK\x07\x08).
  const headBytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZipMagic =
    headBytes[0] === 0x50 &&
    headBytes[1] === 0x4b &&
    (headBytes[2] === 0x03 || headBytes[2] === 0x05 || headBytes[2] === 0x07);
  const isZipExt = /\.zip$/i.test(file.name);

  if (isZipMagic || isZipExt) {
    _updateActionDialog({
      file,
      parsed: { _kind: 'zip', name: file.name, size: file.size },
      error: null,
    });
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.templates)) {
      _updateActionDialog({
        file,
        parsed: null,
        error: 'Bundle must contain a "templates" array.',
      });
      return;
    }
    _updateActionDialog({ file, parsed, error: null });
  } catch (err) {
    _updateActionDialog({
      file,
      parsed: null,
      error: `Failed to parse bundle: ${err.message}`,
    });
  }
}

function _templateActionDialogTemplate(state) {
  const dlg = _templateActionDialog;
  if (!dlg) return nothing;
  const labels = {
    create: 'New template',
    duplicate: 'Duplicate template',
    rename: 'Rename or move template',
    import: 'Import template bundle',
    export: 'Export template bundle',
  };
  const confirmLabel = {
    create: 'Create',
    duplicate: 'Duplicate',
    rename: 'Apply',
    import: dlg.importResult ? 'Done' : 'Import',
    export: 'Export',
  };
  const confirmIcon = {
    create: Plus,
    duplicate: Copy,
    rename: Pencil,
    import: Upload,
    export: Download,
  };
  const validationError = _validateActionDialog(dlg, state);
  const disabled = _templateActionBusy || !!validationError;

  const idTierFields = html`
    <div class="settings-field">
      <label class="settings-label" for="dlg-id">Template ID</label>
      <sl-input
        id="dlg-id"
        size="small"
        autocomplete="off"
        .value=${dlg.id || ''}
        placeholder="e.g. feature-fast"
        @sl-input=${(e) =>
          _updateActionDialog({
            id: e.target.value.trim(),
            // Touching the id field stops the Create auto-slug behavior.
            idDirty: dlg.mode === 'create' ? true : undefined,
          })}
      ></sl-input>
      <span class="settings-field-hint">Lowercase letters, digits, hyphens, underscores. 1–64 chars.</span>
    </div>
    <div class="settings-field">
      <label class="settings-label" for="dlg-tier">Storage</label>
      <sl-select
        id="dlg-tier"
        size="small"
        hoist
        .value=${dlg.tier || 'project'}
        @sl-change=${(e) => _updateActionDialog({ tier: e.target.value })}
      >
        <sl-option value="project">Project (.claude/templates/)</sl-option>
        <sl-option value="user">User (~/.worca/templates/)</sl-option>
      </sl-select>
      <span class="settings-field-hint">Project templates are versioned with the repo; user templates are shared across all your projects.</span>
    </div>
  `;

  let body;
  if (dlg.mode === 'duplicate') {
    body = html`
      <p class="dialog-lead">
        Copy <code>${dlg.srcId}</code> (${dlg.srcTier}) into a new template.
      </p>
      ${idTierFields}
    `;
  } else if (dlg.mode === 'rename') {
    body = html`
      <p class="dialog-lead">
        Renames or moves <code>${dlg.srcId}</code> (${dlg.srcTier}). The
        original is removed after the new copy lands.
      </p>
      ${idTierFields}
    `;
  } else if (dlg.mode === 'create') {
    const templates = state.templates || [];
    body = html`
      <p class="dialog-lead">
        Create a new template from scratch, or pick an existing one to base it on.
      </p>
      <div class="settings-field">
        <label class="settings-label" for="dlg-base">Base template (optional)</label>
        <sl-select
          id="dlg-base"
          size="small"
          hoist
          .value=${dlg.baseRef || ''}
          @sl-change=${(e) => _updateActionDialog({ baseRef: e.target.value })}
        >
          <sl-option value="">(start blank)</sl-option>
          ${(() => {
            // Group by tier (USER → PROJECT → BUILT-IN) and show the
            // human-readable name on the first line with `ID: <id>`
            // as the description, mirroring the New Pipeline launcher.
            // `worca` is a legacy alias for `builtin` from earlier
            // resolver names — coerce it here so old caches don't
            // create a phantom group.
            const buckets = { user: [], project: [], builtin: [] };
            for (const t of templates) {
              const tier = t.tier === 'worca' ? 'builtin' : t.tier;
              if (buckets[tier]) buckets[tier].push(t);
            }
            const groups = [
              { tier: 'user', label: 'USER' },
              { tier: 'project', label: 'PROJECT' },
              { tier: 'builtin', label: 'BUILT-IN' },
            ];
            return groups
              .filter(({ tier }) => buckets[tier].length > 0)
              .map(
                ({ tier, label }) => html`
                  <sl-divider></sl-divider>
                  <small class="template-group-label">${label}</small>
                  ${buckets[tier].map(
                    (t) => html`<sl-option
                      class="template-grouped"
                      value=${`${tier}:${t.id}`}
                    >
                      ${t.name || t.id}
                      <span slot="suffix">ID: ${t.id}</span>
                    </sl-option>`,
                  )}
                `,
              );
          })()}
        </sl-select>
        <span class="settings-field-hint">When set, the new template is a copy of the chosen one — exact (tier, id) source.</span>
      </div>
      <div class="settings-field">
        <label class="settings-label" for="dlg-name">Display name</label>
        <sl-input
          id="dlg-name"
          size="small"
          autocomplete="off"
          .value=${dlg.name || ''}
          placeholder="e.g. Feature (fast)"
          @sl-input=${(e) => {
            const newName = e.target.value;
            const patch = { name: newName };
            // Auto-slug name → id until the user manually edits id.
            if (!dlg.idDirty) {
              patch.id = _slugifyId(newName);
            }
            _updateActionDialog(patch);
          }}
        ></sl-input>
      </div>
      ${idTierFields}
    `;
  } else if (dlg.mode === 'import') {
    const isZip = dlg.parsed?._kind === 'zip';
    const bundleModelCount =
      !isZip && dlg.parsed?.models ? Object.keys(dlg.parsed.models).length : 0;
    const bundlePricingCount =
      !isZip && dlg.parsed?.pricing?.models
        ? Object.keys(dlg.parsed.pricing.models).length
        : 0;
    const dstTierLabel =
      (dlg.tier || 'project') === 'project' ? 'Project' : 'User';
    body = html`
      <p class="dialog-lead">
        Choose a bundle file exported via the Export button on any
        template card. Templates, model aliases, and per-model pricing
        in the bundle all land in the same selected scope.
      </p>
      <div class="settings-field">
        <label class="settings-label" for="dlg-import-file">Bundle file</label>
        <input
          id="dlg-import-file"
          type="file"
          accept="application/json,.json,application/zip,.zip"
          @change=${_onImportFileChange}
        />
      </div>
      ${
        isZip
          ? html`
            <div class="settings-field dialog-zip-hint">
              <sl-badge variant="neutral">Bundle contains prompt overlays</sl-badge>
              <span class="settings-field-hint">
                This zip bundle may include agent prompt overlays for one or more stages.
                They will be written to the template's <code>agents/</code> directory on import.
              </span>
            </div>
          `
          : dlg.parsed
            ? html`
              <div class="settings-field">
                <label class="settings-label">Bundle contents</label>
                <ul class="dialog-bundle-summary">
                  <li>
                    <strong>${dlg.parsed.templates.length}</strong>
                    template${dlg.parsed.templates.length === 1 ? '' : 's'}
                    → <em>${dstTierLabel}</em>
                  </li>
                  ${
                    bundleModelCount > 0
                      ? html`<li>
                          <strong>${bundleModelCount}</strong>
                          model alias${bundleModelCount === 1 ? '' : 'es'}
                          → <em>${dstTierLabel}</em>
                        </li>`
                      : ''
                  }
                  ${
                    bundlePricingCount > 0
                      ? html`<li>
                          <strong>${bundlePricingCount}</strong>
                          pricing entr${bundlePricingCount === 1 ? 'y' : 'ies'}
                          → <em>${dstTierLabel}</em>
                        </li>`
                      : ''
                  }
                </ul>
                <label class="settings-label" style="margin-top:0.75rem">Templates</label>
                <ul class="dialog-bundle-list">
                  ${dlg.parsed.templates.map(
                    (t) =>
                      html`<li><code>${t.id}</code> — ${t.name || ''}</li>`,
                  )}
                </ul>
              </div>
            `
            : ''
      }
      ${
        dlg.importResult
          ? html`
            <div class="settings-field dialog-import-result">
              <sl-badge variant="success">Import complete</sl-badge>
              ${
                dlg.importResult.overlaysByTemplate &&
                Object.keys(dlg.importResult.overlaysByTemplate).length > 0
                  ? html`
                    <ul class="dialog-bundle-list">
                      ${Object.entries(dlg.importResult.overlaysByTemplate).map(
                        ([id, files]) =>
                          html`<li>
                            <code>${id}</code> — overlays:
                            ${files.map((f) => html`<code>${f}</code> `)}
                          </li>`,
                      )}
                    </ul>
                  `
                  : ''
              }
            </div>
          `
          : ''
      }
      ${
        Array.isArray(dlg.templateCollisions) &&
        dlg.templateCollisions.length > 0
          ? html`
            <div class="settings-field dialog-collisions">
              <div class="dialog-collisions-header">
                <sl-badge variant="warning">Template collisions</sl-badge>
              </div>
              <p class="settings-field-hint">
                The bundle contains template ids that already exist in the
                selected target storage. Pick whether to replace the existing
                template or keep it.
              </p>
              <ul class="dialog-collision-list">
                ${dlg.templateCollisions.map((t) => {
                  const r = dlg.templateResolutions?.[t.id] || {
                    action: 'replace',
                  };
                  return html`
                    <li class="dialog-collision-row" data-rename="false">
                      <div class="dialog-collision-alias">
                        <code>${t.id}</code>
                      </div>
                      <sl-select
                        size="small"
                        hoist
                        class="collision-action-select"
                        data-template=${t.id}
                        .value=${r.action}
                        @sl-change=${(e) => _onTemplateCollisionChange(t.id, e.target.value)}
                      >
                        <sl-option value="skip">Skip (keep existing)</sl-option>
                        <sl-option value="replace">Replace</sl-option>
                      </sl-select>
                    </li>
                  `;
                })}
            </ul>
            </div>
          `
          : ''
      }
      ${
        Array.isArray(dlg.collisions) && dlg.collisions.length > 0
          ? html`
            <div class="settings-field dialog-collisions">
              <div class="dialog-collisions-header">
                <sl-badge variant="warning">Model alias collisions</sl-badge>
              </div>
              <p class="settings-field-hint">
                The bundle includes model aliases that already exist in your
                user-global settings (<code>~/.worca/settings.json</code>). Pick
                a resolution per alias. Renames rewrite the template's
                <code>config.agents.*.model</code> references so the imported
                template keeps working.
              </p>
              <ul class="dialog-collision-list">
                ${dlg.collisions.map((c) => {
                  const r = dlg.resolutions?.[c.alias] || {
                    action: 'rename',
                    new_name: c.suggested_rename,
                  };
                  const isRename = r.action === 'rename';
                  return html`
                    <li class="dialog-collision-row" data-rename=${isRename ? 'true' : 'false'}>
                      <div class="dialog-collision-alias">
                        <code>${c.alias}</code>
                      </div>
                      <sl-select
                        size="small"
                        hoist
                        class="collision-action-select"
                        data-alias=${c.alias}
                        .value=${r.action}
                        @sl-change=${(e) => _onCollisionActionChange(c.alias, e.target.value, c.suggested_rename)}
                      >
                        <sl-option value="skip">Skip</sl-option>
                        <sl-option value="overwrite">Overwrite</sl-option>
                        <sl-option value="rename">Rename</sl-option>
                      </sl-select>
                      ${
                        isRename
                          ? html`
                            <sl-input
                              size="small"
                              class="collision-rename-input"
                              data-alias=${c.alias}
                              placeholder="new alias name"
                              .value=${r.new_name || c.suggested_rename || ''}
                              @sl-input=${(e) => _onCollisionRenameInput(c.alias, e.target.value)}
                            ></sl-input>
                          `
                          : ''
                      }
                    </li>
                  `;
                })}
              </ul>
              ${
                dlg.newAliases && dlg.newAliases.length > 0
                  ? html`
                    <p class="settings-field-hint dialog-new-aliases-hint">
                      ${dlg.newAliases.length} new alias${dlg.newAliases.length === 1 ? '' : 'es'}
                      will land cleanly:
                      ${dlg.newAliases.map((a) => html`<code>${a}</code> `)}
                    </p>
                  `
                  : ''
              }
            </div>
          `
          : ''
      }
      <div class="settings-field">
        <label class="settings-label" for="dlg-tier">Target storage</label>
        <sl-select
          id="dlg-tier"
          size="small"
          hoist
          .value=${dlg.tier || 'project'}
          @sl-change=${(e) => _updateActionDialog({ tier: e.target.value })}
        >
          <sl-option value="project">Project (.claude/templates/)</sl-option>
          <sl-option value="user">User (~/.worca/templates/)</sl-option>
        </sl-select>
      </div>
    `;
  } else if (dlg.mode === 'export') {
    const exportMode = dlg.exportMode || 'standalone';
    body = html`
      <p class="dialog-lead">
        Export <code>${dlg.srcId}</code> (${dlg.srcTier}) as a bundle you can
        import into another project.
      </p>
      <div class="settings-field">
        <label class="settings-label" for="dlg-export-mode">Bundle contents</label>
        <sl-radio-group
          id="dlg-export-mode"
          class="export-mode-group"
          .value=${exportMode}
          @sl-change=${(e) => _updateActionDialog({ exportMode: e.target.value })}
        >
          <sl-radio value="standalone">
            <span class="export-mode-option">
              <span class="export-mode-title">Standalone (self-contained)</span>
              <span class="export-mode-hint">
                Config materialised over the built-in defaults and prompts
                resolved into a complete set. Behaves identically wherever it's
                imported.
              </span>
            </span>
          </sl-radio>
          <sl-radio value="delta">
            <span class="export-mode-option">
              <span class="export-mode-title">Delta (overrides only)</span>
              <span class="export-mode-hint">
                Just this template's changes. Re-merges over the destination's
                defaults at run launch — smaller, but version-dependent.
              </span>
            </span>
          </sl-radio>
        </sl-radio-group>
      </div>
    `;
  }

  return html`
    <sl-dialog
      class="template-action-dialog"
      label=${labels[dlg.mode]}
      open
      @sl-initial-focus=${(e) => {
        // sl-dialog's default focus lands on the close button. Pre-empt
        // it so initial focus goes to the first form field instead —
        // less keyboard friction (start typing immediately). Only
        // intercept the dialog's own initial-focus event; bubbled
        // events from children (e.g. sl-select) reach this listener
        // too and must be ignored.
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
      }}
      @sl-after-show=${(e) => {
        // Same bubbling guard: sl-select / sl-tab-group inside the
        // dialog fire their own sl-after-show events. Only the
        // dialog's own settle matters for our focus shift.
        if (e.target !== e.currentTarget) return;
        const dialog = e.target;
        const target =
          dialog.querySelector('sl-input') ||
          dialog.querySelector('input[type="file"]') ||
          dialog.querySelector('sl-select');
        if (target && typeof target.focus === 'function') {
          target.focus();
        }
      }}
      @sl-after-hide=${(e) => {
        // Critical: sl-select's dropdown close fires sl-after-hide too,
        // and the event bubbles up to this listener. Without this
        // guard, changing the Storage dropdown would close the
        // entire dialog as if the user had clicked Cancel.
        if (e.target !== e.currentTarget) return;
        _dismissTemplateActionDialog();
      }}
    >
      ${body}
      ${
        dlg.error
          ? html`<sl-alert variant="danger" open class="dialog-error">${dlg.error}</sl-alert>`
          : ''
      }
      ${
        validationError
          ? html`<sl-alert variant="warning" open class="dialog-error">${validationError}</sl-alert>`
          : ''
      }
      <sl-button
        slot="footer"
        variant="default"
        ?disabled=${_templateActionBusy}
        @click=${_dismissTemplateActionDialog}
      >Cancel</sl-button>
      <sl-button
        slot="footer"
        variant="primary"
        ?disabled=${disabled}
        @click=${_confirmTemplateActionDialog}
      >${
        _templateActionBusy
          ? html`<sl-spinner></sl-spinner>`
          : html`<span slot="prefix">${unsafeHTML(iconSvg(confirmIcon[dlg.mode], 14))}</span>${confirmLabel[dlg.mode]}`
      }</sl-button>
    </sl-dialog>
  `;
}

async function _confirmTemplateActionDialog() {
  const dlg = _templateActionDialog;
  if (!dlg || _templateActionBusy) return;
  _templateActionBusy = true;
  rerender();

  try {
    if (dlg.mode === 'duplicate') {
      const res = await fetch(
        projectUrl(`/templates/${dlg.srcTier}/${dlg.srcId}/duplicate`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dst_tier: dlg.tier, dst_id: dlg.id }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        _templateActionDialog = {
          ...dlg,
          error: data.error || 'Failed to duplicate',
        };
        _templateActionBusy = false;
        rerender();
        return;
      }
      _templateActionDialog = null;
      _templateActionBusy = false;
      const templates = await fetchTemplates(route.projectId || null);
      store.setState({ templates, defaultTemplate: templates.defaultTemplate });
      navigate('templates', dlg.id, route.projectId, 'edit', dlg.tier);
      return;
    }

    if (dlg.mode === 'rename') {
      // Server composes duplicate + delete; see templates-routes.js for
      // the partial_rename failure mode.
      const res = await fetch(
        projectUrl(`/templates/${dlg.srcTier}/${dlg.srcId}/rename`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dst_tier: dlg.tier, dst_id: dlg.id }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        _templateActionDialog = {
          ...dlg,
          error: data.error || 'Failed to rename',
        };
        _templateActionBusy = false;
        rerender();
        return;
      }
      _templateActionDialog = null;
      _templateActionBusy = false;
      const templates = await fetchTemplates(route.projectId || null);
      store.setState({ templates, defaultTemplate: templates.defaultTemplate });
      return;
    }

    if (dlg.mode === 'create') {
      // With a base: clone the exact (tier, id) source. Without: POST
      // a minimal new template into the chosen tier.
      let res;
      if (dlg.baseRef) {
        const [baseTier, baseId] = dlg.baseRef.split(':');
        res = await fetch(
          projectUrl(`/templates/${baseTier}/${baseId}/duplicate`),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dst_tier: dlg.tier, dst_id: dlg.id }),
          },
        );
      } else {
        res = await fetch(projectUrl(`/templates/${dlg.tier}`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: dlg.id,
            name: dlg.name || dlg.id,
            description: '',
            config: {},
            params: {},
            tags: [],
          }),
        });
      }
      const data = await res.json();
      if (!res.ok || !data.ok) {
        _templateActionDialog = {
          ...dlg,
          error: data.error || 'Failed to create',
        };
        _templateActionBusy = false;
        rerender();
        return;
      }
      _templateActionDialog = null;
      _templateActionBusy = false;
      const templates = await fetchTemplates(route.projectId || null);
      store.setState({ templates, defaultTemplate: templates.defaultTemplate });
      navigate('templates', dlg.id, route.projectId, 'edit', dlg.tier);
      return;
    }

    if (dlg.mode === 'import') {
      // "Done" button after a successful import result — just close.
      if (dlg.importResult) {
        _templateActionDialog = null;
        _templateActionBusy = false;
        rerender();
        return;
      }

      if (!dlg.parsed) {
        _templateActionDialog = { ...dlg, error: 'No bundle loaded' };
        _templateActionBusy = false;
        rerender();
        return;
      }

      const tier = dlg.tier || 'project';
      const isZip = dlg.parsed._kind === 'zip';

      // Phase 1: preview surfaces alias collisions BEFORE any write. If
      // collisions exist and the user hasn't resolved them yet, swap the
      // dialog body to the collision resolver. On the next click (with
      // resolutions in hand) we drop through to the commit POST.
      if (!dlg.previewSeen) {
        const previewUrl = `${projectUrl('/templates/import/preview')}?dst_tier=${encodeURIComponent(tier)}`;
        const previewInit = isZip
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/zip' },
              body: dlg.file,
            }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bundle: dlg.parsed }),
            };
        const previewRes = await fetch(previewUrl, previewInit);
        const previewData = await previewRes.json();
        if (!previewRes.ok || !previewData.ok) {
          _templateActionDialog = {
            ...dlg,
            error: previewData.error || 'Failed to preview import',
          };
          _templateActionBusy = false;
          rerender();
          return;
        }
        const collisions = previewData.collisions || [];
        const templateCollisions = previewData.template_collisions || [];
        if (collisions.length > 0 || templateCollisions.length > 0) {
          const initialModels = {};
          for (const c of collisions) {
            initialModels[c.alias] = {
              action: 'rename',
              new_name: c.suggested_rename || `${c.alias}-01`,
            };
          }
          const initialTemplates = {};
          for (const t of templateCollisions) {
            initialTemplates[t.id] = { action: 'replace' };
          }
          _templateActionDialog = {
            ...dlg,
            previewSeen: true,
            collisions,
            templateCollisions,
            newAliases: previewData.new_aliases || [],
            modelsScope: previewData.models_scope || 'user',
            resolutions: initialModels,
            templateResolutions: initialTemplates,
          };
          _templateActionBusy = false;
          rerender();
          return;
        }
      }

      const bodyResolutions = {
        models: dlg.resolutions || {},
        templates: dlg.templateResolutions || {},
      };
      // Forward the user-facing filename so the CLI can stamp it as
      // `_imported_from` on each imported model entry — otherwise the
      // CLI sees only the server-side temp file (`bundle.zip`) and the
      // Models page badge ends up generic. Server sanitizes the header.
      const bundleLabel = dlg.file?.name || null;
      const bundleLabelHeader = bundleLabel
        ? { 'x-bundle-filename': bundleLabel }
        : {};
      let res;
      if (isZip) {
        const importUrl = `${projectUrl('/templates/import')}?dst_tier=${encodeURIComponent(tier)}`;
        res = await fetch(importUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/zip',
            'x-resolutions': JSON.stringify(bodyResolutions),
            ...bundleLabelHeader,
          },
          body: dlg.file,
        });
      } else {
        res = await fetch(projectUrl('/templates/import'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...bundleLabelHeader,
          },
          body: JSON.stringify({
            bundle: dlg.parsed,
            dst_tier: tier,
            resolutions: bodyResolutions,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok || !data.ok) {
        _templateActionDialog = {
          ...dlg,
          error: data.error || 'Failed to import',
        };
        _templateActionBusy = false;
        rerender();
        return;
      }

      if (isZip) {
        const overlaysByTemplate = {};
        for (const { id, tier: t } of data.imported || []) {
          try {
            const oRes = await fetch(
              projectUrl(`/templates/${t}/${id}/overlays`),
            );
            const oData = await oRes.json();
            if (oData.ok && oData.overlays) {
              overlaysByTemplate[id] = Object.keys(oData.overlays);
            }
          } catch {
            /* best-effort */
          }
        }
        const templates = await fetchTemplates(route.projectId || null);
        store.setState({
          templates,
          defaultTemplate: templates.defaultTemplate,
        });
        // Bundles can carry models + pricing too — refresh the Models
        // list cache so the new alias shows up immediately when the
        // user navigates to /#/models (otherwise the user has to
        // refresh the page to see what just got imported).
        _refreshModelsAfterImport(route.projectId || null);
        _invalidateEditorCacheIfImported(data.imported || []);
        _templateActionDialog = {
          ...dlg,
          importResult: { imported: data.imported || [], overlaysByTemplate },
        };
        _templateActionBusy = false;
        rerender();
        return;
      }

      _templateActionDialog = null;
      _templateActionBusy = false;
      const templates = await fetchTemplates(route.projectId || null);
      store.setState({ templates, defaultTemplate: templates.defaultTemplate });
      _refreshModelsAfterImport(route.projectId || null);
      _invalidateEditorCacheIfImported(data.imported || []);
      return;
    }

    if (dlg.mode === 'export') {
      // exportTemplate triggers a browser download and raises its own
      // toast on success/failure; close the dialog once it returns.
      const projectId = store.getState().currentProjectId || null;
      await exportTemplate(
        projectId,
        dlg.srcId,
        dlg.srcTier,
        dlg.name,
        dlg.exportMode || 'standalone',
      );
      _templateActionDialog = null;
      _templateActionBusy = false;
      rerender();
      return;
    }
  } catch (err) {
    _templateActionDialog = {
      ...dlg,
      error: `Request failed: ${err.message}`,
    };
    _templateActionBusy = false;
    rerender();
  }
}

function handleExportTemplate(tid, tier) {
  // Open the export dialog so the user picks standalone (default) vs delta.
  // The actual download happens on confirm via exportTemplate().
  const template = (store.getState().templates || []).find(
    (t) => t.id === tid && (!tier || t.tier === tier),
  );
  _templateActionDialog = {
    mode: 'export',
    srcId: tid,
    srcTier: tier || template?.tier || 'project',
    name: template?.name || tid,
    exportMode: 'standalone',
  };
  _templateActionBusy = false;
  rerender();
}

let _gistCopiedTimer = null;

async function handleCopyGistUrl(tid, tier) {
  const projectId = store.getState().currentProjectId || null;
  const template = (store.getState().templates || []).find(
    (t) => t.id === tid && (!tier || t.tier === tier),
  );
  const templateName = template?.name || tid;
  const resolvedTier = tier || template?.tier;

  // Open the dialog immediately in its loading state, before the network
  // request resolves — no toast in this flow.
  if (_gistCopiedTimer) {
    clearTimeout(_gistCopiedTimer);
    _gistCopiedTimer = null;
  }
  store.setState({
    gistDialog: {
      open: true,
      status: 'loading',
      url: null,
      error: null,
      templateName,
      copied: false,
    },
  });

  const result = await createGist(projectId, tid, resolvedTier);

  // Bail if the dialog was dismissed while the request was in flight.
  if (!store.getState().gistDialog?.open) return;

  store.setState({
    gistDialog: {
      open: true,
      status: result.ok ? 'done' : 'error',
      url: result.ok ? result.gistUrl : null,
      error: result.ok ? null : result.error,
      templateName,
      copied: false,
    },
  });
}

function handleGistDialogClose() {
  if (_gistCopiedTimer) {
    clearTimeout(_gistCopiedTimer);
    _gistCopiedTimer = null;
  }
  const dlg = store.getState().gistDialog || {};
  store.setState({ gistDialog: { ...dlg, open: false, copied: false } });
}

function handleGistDialogCopy(url) {
  if (!url) return;
  Promise.resolve(navigator.clipboard?.writeText(url)).catch(() => {});
  const dlg = store.getState().gistDialog || {};
  store.setState({ gistDialog: { ...dlg, copied: true } });
  if (_gistCopiedTimer) clearTimeout(_gistCopiedTimer);
  _gistCopiedTimer = setTimeout(() => {
    _gistCopiedTimer = null;
    const cur = store.getState().gistDialog || {};
    if (cur.open) store.setState({ gistDialog: { ...cur, copied: false } });
  }, 1500);
}

function handleStageFilter(stage) {
  logFilter = stage;
  // Auto-select last iteration when a stage is chosen
  if (stage !== '*') {
    const run = store.getRunById(route.runId);
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
    projectId: _runProjectId(route.runId),
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
    projectId: _runProjectId(route.runId),
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

function _showToast(message, variant = 'success') {
  const alert = Object.assign(document.createElement('sl-alert'), {
    variant,
    closable: true,
    duration: 4000,
  });
  alert.textContent = String(message);
  document.body.append(alert);
  requestAnimationFrame(() => alert.toast());
}

// Single listener on `document` handles every `worca:toast` event —
// because the dispatched CustomEvent has `bubbles: true`, both
// document-target and document.dispatchEvent forms reach this. The
// previous code also registered a `window` listener, which fired a
// second time for any bubbled event (every Save = two toasts).
document.addEventListener('worca:toast', (e) => {
  const { message, variant } = e.detail || {};
  if (message) _showToast(message, variant || 'success');
});

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

async function handlePauseRun(runId) {
  _controlPending = { action: 'pause', runId };
  rerender();
  try {
    const res = await fetch(runUrl(runId, `/runs/${runId}/pause`), {
      method: 'POST',
    });
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
    await ws.send('resume-run', { runId });
  } catch (err) {
    showActionError(err?.message || 'Failed to resume run');
  } finally {
    _controlPending = null;
    rerender();
  }
}

async function handleResumeFleet(fleetId) {
  try {
    const res = await fetch(`/api/fleet-runs/${fleetId}/resume`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!data.ok) {
      showActionError(data.error || 'Failed to resume fleet');
    } else {
      // Force a re-fetch of the fleet manifest so the badge / actions
      // update without needing a manual reload.
      delete _fleetDetailCache[fleetId];
      rerender();
    }
  } catch (err) {
    showActionError(err?.message || 'Failed to resume fleet');
  }
}

function handleHaltFleet(fleetId) {
  showConfirm(
    {
      label: 'Halt Fleet Run',
      message:
        'Unstarted children are cancelled. In-flight children keep running until they finish naturally — they are never killed. A halted fleet can be resumed later.',
      confirmLabel: 'Halt',
      confirmVariant: 'warning',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/fleet-runs/${fleetId}`, {
            method: 'DELETE',
          });
          const data = await res.json();
          if (!data.ok) {
            showActionError(data.error || 'Failed to halt fleet');
            return;
          }
          delete _fleetDetailCache[fleetId];
          await _refreshFleets();
          rerender();
        } catch (err) {
          showActionError(err?.message || 'Failed to halt fleet');
        }
      },
    },
    rerender,
  );
}

function handlePauseFleet(fleetId) {
  showConfirm(
    {
      label: 'Pause Fleet Run',
      message:
        'Every in-flight child pauses at its next checkpoint; no new children are launched. A paused fleet can be continued in place with Resume.',
      confirmLabel: 'Pause',
      confirmVariant: 'warning',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/fleet-runs/${fleetId}/pause`, {
            method: 'POST',
          });
          const data = await res.json();
          if (!data.ok) {
            showActionError(data.error || 'Failed to pause fleet');
            return;
          }
          delete _fleetDetailCache[fleetId];
          await _refreshFleets();
          rerender();
        } catch (err) {
          showActionError(err?.message || 'Failed to pause fleet');
        }
      },
    },
    rerender,
  );
}

function handleStopFleet(fleetId) {
  showConfirm(
    {
      label: 'Stop Fleet Run',
      message:
        'Every in-flight child is interrupted immediately (SIGTERM) and no new children are launched. Stopped children can still be continued with Resume.',
      confirmLabel: 'Stop',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/fleet-runs/${fleetId}/stop`, {
            method: 'POST',
          });
          const data = await res.json();
          if (!data.ok) {
            showActionError(data.error || 'Failed to stop fleet');
            return;
          }
          delete _fleetDetailCache[fleetId];
          await _refreshFleets();
          rerender();
        } catch (err) {
          showActionError(err?.message || 'Failed to stop fleet');
        }
      },
    },
    rerender,
  );
}

function handleCleanupFleet(fleetId) {
  showConfirm(
    {
      label: 'Cleanup Fleet Run',
      message:
        'Removes every child worktree and the fleet manifest. This is irreversible — a halted or failed fleet can no longer be resumed once cleaned up.',
      confirmLabel: 'Cleanup',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          // force=1: the confirm dialog is itself the resume-loss
          // acknowledgement, so we proceed past the server's 412 gate.
          const res = await fetch(
            `/api/fleet-runs/${fleetId}?cleanup=1&force=1`,
            { method: 'DELETE' },
          );
          const data = await res.json();
          if (!data.ok) {
            showActionError(data.error || 'Failed to clean up fleet');
            return;
          }
          delete _fleetDetailCache[fleetId];
          await _refreshFleets();
          navigate('fleet-runs', null, null);
        } catch (err) {
          showActionError(err?.message || 'Failed to clean up fleet');
        }
      },
    },
    rerender,
  );
}

// ── Workspace-run actions (mirror the fleet handlers above) ────────────
async function handleResumeWorkspace(workspaceId) {
  try {
    const res = await fetch(
      `/api/workspace-runs/${encodeURIComponent(workspaceId)}/resume`,
      { method: 'POST' },
    );
    const data = await res.json();
    if (!data.ok) {
      showActionError(data.error || 'Failed to resume workspace');
      return;
    }
    delete _wsDetailCache[workspaceId];
    await _refreshWorkspaces();
    rerender();
  } catch (err) {
    showActionError(err?.message || 'Failed to resume workspace');
  }
}

function handleCleanupWorkspaceRun(workspaceId) {
  showConfirm(
    {
      label: 'Cleanup Workspace Run',
      message:
        'Removes the workspace run manifest, pointer file, and any on-disk child worktree state. Per-repo PRs are NOT touched. Irreversible.',
      confirmLabel: 'Cleanup',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          const res = await fetch(
            `/api/workspace-runs/${encodeURIComponent(workspaceId)}`,
            { method: 'DELETE' },
          );
          const data = await res.json();
          if (!data.ok) {
            showActionError(data.error || 'Failed to clean up workspace');
            return;
          }
          delete _wsDetailCache[workspaceId];
          await _refreshWorkspaces();
          navigate('workspace-runs', null, null);
        } catch (err) {
          showActionError(err?.message || 'Failed to clean up workspace');
        }
      },
    },
    rerender,
  );
}

async function handleRerunWorkspace(workspaceId) {
  try {
    const res = await fetch(
      `/api/workspace-runs/${encodeURIComponent(workspaceId)}/relaunch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    const data = await res.json();
    if (!data.ok || !data.workspace_id) {
      showActionError(data.error || 'Failed to re-run workspace');
      return;
    }
    await _refreshWorkspaces();
    navigate('workspace-runs', data.workspace_id, null);
  } catch (err) {
    showActionError(err?.message || 'Failed to re-run workspace');
  }
}

// Re-fetch /api/fleet-runs and replace state.fleets. Used after a fleet
// archive / unarchive so the list + sidebar count update immediately —
// the WS `fleet-update` watcher also fires, but an explicit refetch gives
// instant feedback rather than waiting on the fs-watch debounce.
async function _refreshFleets() {
  try {
    const res = await fetch('/api/fleet-runs');
    const data = await res.json();
    store.setState({ fleets: data?.fleets || [], fleetsLoaded: true });
  } catch {
    // Non-fatal — the WS fleet-update handler will reconcile shortly.
  }
}

async function _refreshWorkspaces() {
  try {
    const res = await fetch('/api/workspace-runs');
    const data = await res.json();
    store.setState({
      workspaceRuns: data?.workspace_runs || [],
      workspaceRunsLoaded: true,
    });
  } catch {
    // Non-fatal — bootstrap and next user navigation will reconcile.
  }
}

async function _refreshWorkspaceDefinitions() {
  try {
    const res = await fetch('/api/workspaces');
    const data = await res.json();
    store.setState({ workspaces: data?.workspaces || [] });
  } catch {
    // Non-fatal.
  }
}

function handleLaunchWorkspace(name) {
  // Stash for the launcher to consume on its first render in workspace mode.
  _pendingLaunchWorkspace = name;
  navigate('workspace-runs', 'new', null);
}

function handleDeleteWorkspace(name) {
  showConfirm(
    {
      label: 'Delete Workspace',
      message: `This removes the registration AND the workspace.json topology file. The repos themselves are untouched. Cannot be undone.`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          const res = await fetch(
            `/api/workspaces/${encodeURIComponent(name)}`,
            { method: 'DELETE' },
          );
          const data = await res.json();
          if (!data.ok) {
            showActionError(data.error || 'Failed to delete workspace');
            return;
          }
          await _refreshWorkspaceDefinitions();
        } catch (err) {
          showActionError(err?.message || 'Failed to delete workspace');
        }
      },
    },
    rerender,
  );
}

function archiveFleet(fleetId) {
  showConfirm(
    {
      label: 'Archive Fleet Run',
      message:
        "This fleet will be hidden from the Fleets list. You can find it later with the 'Show archived' toggle.",
      confirmLabel: 'Archive',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/fleet-runs/${fleetId}/archive`, {
            method: 'POST',
          });
          const data = await res.json();
          if (!data.ok) {
            showActionError(data.error || 'Failed to archive fleet');
            return;
          }
          delete _fleetDetailCache[fleetId];
          await _refreshFleets();
        } catch (err) {
          showActionError(err?.message || 'Failed to archive fleet');
        }
      },
    },
    rerender,
  );
}

async function unarchiveFleet(fleetId) {
  try {
    const res = await fetch(`/api/fleet-runs/${fleetId}/unarchive`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!data.ok) {
      showActionError(data.error || 'Failed to unarchive fleet');
      return;
    }
    delete _fleetDetailCache[fleetId];
    await _refreshFleets();
  } catch (err) {
    showActionError(err?.message || 'Failed to unarchive fleet');
  }
}

function handleStopRun(runId) {
  showConfirm(
    {
      label: 'Stop Pipeline?',
      message:
        'Are you sure? The current stage will be interrupted and marked as error.',
      confirmLabel: 'Stop',
      confirmVariant: 'danger',
      onConfirm: async () => {
        _controlPending = { action: 'stop', runId };
        rerender();
        try {
          const res = await fetch(runUrl(runId, `/runs/${runId}/stop`), {
            method: 'POST',
          });
          const data = await res.json();
          if (res.status === 409 && data.code === 'no_running_process') {
            showActionError(
              'Process is no longer running. Use Cancel to force the run into cancelled state.',
            );
          } else if (!data.ok) {
            showActionError(data.error || 'Failed to stop run');
          }
        } catch (err) {
          showActionError(err?.message || 'Failed to stop run');
        } finally {
          _controlPending = null;
          rerender();
        }
      },
    },
    rerender,
  );
}

function handleCancelRun(runId) {
  showConfirm(
    {
      label: 'Cancel Pipeline?',
      message:
        'This will permanently cancel the run. Any running process will be terminated and the pipeline cannot be resumed.',
      confirmLabel: 'Cancel Run',
      confirmVariant: 'danger',
      onConfirm: async () => {
        _controlPending = { action: 'cancel', runId };
        rerender();
        try {
          const res = await fetch(runUrl(runId, `/runs/${runId}/cancel`), {
            method: 'POST',
          });
          const data = await res.json();
          if (!data.ok) showActionError(data.error || 'Failed to cancel run');
        } catch (err) {
          showActionError(err?.message || 'Failed to cancel run');
        } finally {
          _controlPending = null;
          rerender();
        }
      },
    },
    rerender,
  );
}

// --- Shared run-page header helper ---

function runPageHeaderParts(runId) {
  const run = store.getRunById(runId);
  const raw = run?.work_request?.title || 'Pipeline Details';
  const firstLine = raw.split('\n')[0];
  const title =
    firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
  let badge = null;
  let actionButton = null;
  if (run) {
    const ps = run.pipeline_status || (run.active ? 'running' : 'completed');
    const variantMap = {
      running: 'primary',
      paused: 'warning',
      completed: 'success',
      failed: 'danger',
      cancelled: 'neutral',
      interrupted: 'warning',
    };
    const variant = variantMap[ps] || 'neutral';
    const label = ps.charAt(0).toUpperCase() + ps.slice(1);
    badge = html`<sl-badge variant="${variant}" pill>
      ${unsafeHTML(statusIcon(ps, 12))}
      ${label}
    </sl-badge>`;
    const pending =
      _controlPending?.runId === runId ? _controlPending.action : null;
    if (pending === 'stop') {
      actionButton = html`
        <button class="action-btn action-btn--danger" disabled>
          ${unsafeHTML(iconSvg(Loader, 14, 'icon-spin'))}
          Stopping…
        </button>`;
    } else if (pending === 'pause') {
      actionButton = html`
        <button class="action-btn action-btn--amber" disabled>
          ${unsafeHTML(iconSvg(Loader, 14, 'icon-spin'))}
          Pausing…
        </button>`;
    } else if (pending === 'resume') {
      actionButton = html`
        <button class="action-btn action-btn--primary" disabled>
          ${unsafeHTML(iconSvg(Loader, 14, 'icon-spin'))}
          Resuming…
        </button>`;
    } else {
      const pauseBtn = actionAllowed('pause', ps)
        ? html`<button class="action-btn action-btn--amber" @click=${() => handlePauseRun(runId)}>
            ${unsafeHTML(iconSvg(Pause, 14))} Pause
          </button>`
        : nothing;
      const stopBtn = actionAllowed('stop', ps)
        ? html`<button class="action-btn action-btn--danger" @click=${() => handleStopRun(runId)}>
            ${unsafeHTML(iconSvg(Square, 14))} Stop
          </button>`
        : nothing;
      const resumeBtn = actionAllowed('resume', ps)
        ? html`<button class="action-btn action-btn--primary" @click=${() => handleResumeRun(runId)}>
            ${unsafeHTML(iconSvg(Play, 14))} Resume
          </button>`
        : nothing;
      const cancelBtn =
        stopBtn === nothing && actionAllowed('cancel', ps)
          ? html`<button class="action-btn action-btn--danger" @click=${() => handleCancelRun(runId)}>
              ${unsafeHTML(iconSvg(Square, 14))} Cancel
            </button>`
          : nothing;
      const btns = [pauseBtn, stopBtn, resumeBtn, cancelBtn].filter(
        (b) => b !== nothing,
      );
      if (btns.length) actionButton = html`${btns}`;
    }
  }
  return { title, badge, actionButton };
}

// --- PR Approval ---

async function handleApprovePR(runId) {
  try {
    const res = await fetch(runUrl(runId, `/runs/${runId}/control`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', source: 'ui-pr-approval' }),
    });
    if (res.status === 404) {
      showActionError('This run has already finished. Refreshing...');
      return;
    }
    if (res.status === 409) {
      showActionError('This run is no longer awaiting approval.');
      return;
    }
    if (!res.ok) {
      showActionError('Could not deliver decision; try again.');
    }
  } catch {
    showActionError('Could not deliver decision; try again.');
  }
}

async function handleRejectPR(runId) {
  try {
    const res = await fetch(runUrl(runId, `/runs/${runId}/control`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', source: 'ui-pr-approval' }),
    });
    if (res.status === 404) {
      showActionError('This run has already finished. Refreshing...');
      return;
    }
    if (res.status === 409) {
      showActionError('This run is no longer awaiting approval.');
      return;
    }
    if (!res.ok) {
      showActionError('Could not deliver decision; try again.');
    }
  } catch {
    showActionError('Could not deliver decision; try again.');
  }
}

// --- Archive/Unarchive ---

const { archiveRun, unarchiveRun } = createArchiveActions({
  showConfirm,
  showActionError,
  runUrl,
  store,
  rerender,
});

// --- Worktrees: cleanup polling ---
//
// While any worktree carries cleanup_state ('pending' or 'cleaning'), poll
// GET /worktrees every 2s so the spinner cards reflect server-side progress
// across reloads and multiple tabs. Stops when no worktree is mid-cleanup.

let _cleanupPollTimer = null;
const CLEANUP_POLL_MS = 2000;

function anyCleanupInFlight() {
  return (store.getState().worktrees || []).some(
    (w) => w.cleanup_state === 'pending' || w.cleanup_state === 'cleaning',
  );
}

function startCleanupPolling() {
  if (_cleanupPollTimer) return;
  const tick = () => {
    _cleanupPollTimer = null;
    fetchWorktrees();
    // fetchWorktrees mutates state asynchronously; re-check on next tick.
    setTimeout(() => {
      if (anyCleanupInFlight()) {
        _cleanupPollTimer = setTimeout(tick, CLEANUP_POLL_MS);
      }
    }, 50);
  };
  _cleanupPollTimer = setTimeout(tick, CLEANUP_POLL_MS);
}

// --- Worktrees: cleanup actions ---

function openWorktreeCleanupDialog(wt) {
  worktreesDialogItem = wt;
  worktreesDialogBulk = false;
  worktreesDialogCheckbox = false;
  rerender();
}

function openWorktreeBulkCleanupDialog() {
  worktreesDialogItem = null;
  worktreesDialogBulk = true;
  worktreesDialogCheckbox = false;
  rerender();
}

function closeWorktreeCleanupDialog() {
  worktreesDialogItem = null;
  worktreesDialogBulk = false;
  worktreesDialogCheckbox = false;
  rerender();
}

async function deleteWorktree(runId, force) {
  const url = worktreeUrl(
    runId,
    `/worktrees/${encodeURIComponent(runId)}${force ? '?force=1' : ''}`,
  );
  const res = await fetch(url, { method: 'DELETE' });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Cleanup failed (HTTP ${res.status})`);
  }
}

async function confirmWorktreeCleanup(runId, force) {
  // Bulk path: runId is null — delete every completed worktree. In global
  // mode the completed set can span multiple projects, so we bucket runIds
  // by their owning project and fire one POST per project. Each /cleanup
  // endpoint is scoped to a single project's worcaDir/registry.
  // No optimistic removal — the server stamps `cleanup_state: 'pending'` on
  // each registry entry; we surface that via a spinner per card and poll
  // GET /worktrees until everything settles. A page reload during cleanup
  // sees the same intermediate state.
  if (runId === null) {
    const completed = (store.getState().worktrees || []).filter(
      (w) => w.status === 'completed',
    );
    closeWorktreeCleanupDialog();
    const currentProjectId = store.getState().currentProjectId;
    const byProject = new Map();
    for (const w of completed) {
      const pid = w.project || currentProjectId || null;
      if (!byProject.has(pid)) byProject.set(pid, []);
      byProject.get(pid).push(w.run_id);
    }
    const rejected = [];
    await Promise.all(
      [...byProject.entries()].map(async ([pid, run_ids]) => {
        const url = pid
          ? `/api/projects/${pid}/worktrees/cleanup`
          : '/api/worktrees/cleanup';
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ run_ids, force: true }),
          });
          try {
            const data = await res.json();
            if (Array.isArray(data?.rejected)) rejected.push(...data.rejected);
          } catch {
            /* ignore parse errors */
          }
        } catch {
          /* network error — startCleanupPolling will reconcile on next tick */
        }
      }),
    );
    fetchWorktrees();
    startCleanupPolling();
    if (rejected.length > 0) {
      showActionError(
        `Cleanup rejected ${rejected.length} item(s):\n${rejected
          .map((r) => `${r.run_id}: ${r.error || 'failed'}`)
          .join('\n')}`,
      );
    }
    return;
  }

  // Single-row path — server-side single-target DELETE is synchronous (it
  // does the actual filesystem rm + git worktree remove before responding),
  // and on macOS with nested node_modules it can take 10+ seconds. Stamp
  // `cleanup_state: 'pending'` on the local entry immediately so the card
  // renders the existing spinner UI while we wait; the bulk path stamps the
  // same field server-side, so the rendering logic is identical.
  closeWorktreeCleanupDialog();
  const state0 = store.getState();
  const optimisticWorktrees = (state0.worktrees || []).map((w) =>
    w.run_id === runId ? { ...w, cleanup_state: 'pending' } : w,
  );
  store.setState({ worktrees: optimisticWorktrees });
  try {
    await deleteWorktree(runId, !!force);
    fetchWorktrees();
  } catch (err) {
    // Roll back the optimistic stamp so the user can retry from a clean card.
    const stateNow = store.getState();
    const rolledBack = (stateNow.worktrees || []).map((w) => {
      if (w.run_id !== runId) return w;
      const { cleanup_state: _drop, ...rest } = w;
      return rest;
    });
    store.setState({ worktrees: rolledBack });
    showActionError(err?.message || 'Cleanup failed');
  }
}

function handleRestartStage(stageKey) {
  restartStageKey = stageKey;
  showConfirm(
    {
      label: 'Restart Stage?',
      message: `Restart the "${stageKey}" stage? The pipeline will resume from this point.`,
      confirmLabel: 'Restart',
      confirmVariant: 'warning',
      onConfirm: handleConfirmRestartStage,
      onCancel: () => {
        restartStageKey = null;
      },
    },
    rerender,
  );
}

async function handleConfirmRestartStage() {
  const stage = restartStageKey;
  restartStageKey = null;
  rerender();

  try {
    const runId = route.runId;
    const res = await fetch(
      runUrl(runId, `/runs/${runId}/stages/${stage}/restart`),
      {
        method: 'POST',
      },
    );
    const data = await res.json();
    if (data.ok) {
      navigate('active', null, route.projectId);
    } else {
      showActionError(data.error || 'Failed to restart stage');
    }
  } catch (err) {
    showActionError(err?.message || 'Failed to restart stage');
  }
}

function handleBack() {
  if (
    (route.action === 'timeline' || route.action === 'access') &&
    route.runId
  ) {
    navigate(route.section, route.runId, route.projectId, null);
  } else if (route.runId) {
    navigate(route.section, null, route.projectId);
  } else if (route.section && route.section !== 'dashboard') {
    navigate('dashboard', null, route.projectId);
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
    navigate('active', null, route.projectId);
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
  ws.send('list-beads-by-run', { runId, projectId: _runProjectId(runId) })
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
  fetch(projectUrl('/costs'))
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
  const currentProjectId = store.getState().currentProjectId;
  const url = currentProjectId
    ? `/api/projects/${currentProjectId}/info`
    : '/api/project-info';
  fetch(url)
    .then((r) => r.json())
    .then((data) => {
      const name = data.project?.name ?? data.name;
      if (name !== undefined) {
        store.setState({ projectName: name });
        document.title = formatTitle(name);
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
  const run = store.getRunById(route.runId);
  const learnStatus = run?.stages?.learn?.status;
  if (learnStatus === 'completed' || learnStatus === 'error') {
    showConfirm(
      {
        label: 'Re-run Learning Analysis?',
        message: 'This will replace existing learnings. Continue?',
        confirmLabel: 'Re-run',
        confirmVariant: 'warning',
        onConfirm: doRunLearn,
      },
      rerender,
    );
    return;
  }
  doRunLearn();
}

async function doRunLearn() {
  rerender();
  try {
    const runId = route.runId;
    const res = await fetch(runUrl(runId, `/runs/${runId}/learn`), {
      method: 'POST',
    });
    const data = await res.json();
    if (!data.ok) {
      showActionError(data.error || 'Failed to run learning analysis');
    } else {
      // Optimistic update — show spinner immediately instead of waiting for WS
      const run = store.getRunById(runId);
      if (run) {
        const now = new Date().toISOString();
        store.setRun(runId, {
          ...run,
          stages: {
            ...(run.stages || {}),
            learn: {
              status: 'in_progress',
              pid: data.pid,
              started_at: now,
              iterations: [
                {
                  number: 1,
                  status: 'in_progress',
                  started_at: now,
                  trigger: 'manual',
                },
              ],
            },
          },
        });
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
    const run = store.getRunById(route.runId);
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
  } else if (route.section === 'fleet-runs') {
    title =
      route.runId === 'new'
        ? 'Run Fleet'
        : route.runId
          ? `Fleet ${route.runId.split('_').pop() || route.runId}`
          : 'Fleets';
    showBack = true;
    if (route.runId === 'new') {
      const fls = getFleetLauncherSubmitState();
      const capReached = isAtCapacity(state);
      actionButton = html`
        <button class="action-btn action-btn--primary" ?disabled=${fls.isSubmitting || !fls.canLaunch || capReached}
          @click=${() =>
            submitFleetLauncher({
              rerender,
              onStarted: (fleetId) => navigate('fleet-runs', fleetId, null),
            })}>
          ${unsafeHTML(iconSvg(Play, 14))}
          ${fls.isSubmitting ? 'Launching…' : 'Launch'}
        </button>`;
    } else if (route.runId) {
      const fleet = _fleetDetailCache[route.runId];
      if (fleet) {
        const fs = fleet.status || 'running';
        const variantMap = {
          running: 'primary',
          resuming: 'primary',
          paused: 'warning',
          completed: 'success',
          failed: 'danger',
          halted: fleet.halt_reason === 'user' ? 'neutral' : 'warning',
        };
        // Badge text is the bare status word, Title-cased for the page header
        // (the run-detail header does the same). halt_reason informs the
        // variant only — never the badge text.
        badge = html`<sl-badge variant="${variantMap[fs] || 'neutral'}" pill>
          ${unsafeHTML(statusIcon(fs, 12))}
          ${fs.charAt(0).toUpperCase() + fs.slice(1)}
        </sl-badge>`;

        const isResumable =
          fs === 'halted' || fs === 'failed' || fs === 'paused';
        const isRunning = fs === 'running' || fs === 'resuming';
        const isTerminal = !isRunning;

        // In-flight fleet → three ways to wind it down, by how they treat
        // children already running:
        //   Pause — suspend in-flight children at their next checkpoint
        //   Halt  — stop launching new ones, let in-flight finish naturally
        //   Stop  — interrupt in-flight children immediately
        const pauseBtn = isRunning
          ? html`<button class="action-btn action-btn--amber" @click=${() => handlePauseFleet(route.runId)}>
              ${unsafeHTML(iconSvg(Pause, 14))} Pause
            </button>`
          : nothing;
        const haltBtn = isRunning
          ? html`<button class="action-btn action-btn--amber" @click=${() => handleHaltFleet(route.runId)}>
              ${unsafeHTML(iconSvg(CircleSlash, 14))} Halt
            </button>`
          : nothing;
        const stopBtn = isRunning
          ? html`<button class="action-btn action-btn--danger" @click=${() => handleStopFleet(route.runId)}>
              ${unsafeHTML(iconSvg(Square, 14))} Stop
            </button>`
          : nothing;
        const resumeBtn = isResumable
          ? html`<button class="action-btn action-btn--primary" @click=${() => handleResumeFleet(route.runId)}>
              ${unsafeHTML(iconSvg(Play, 14))} Resume
            </button>`
          : nothing;
        const cleanupBtn = isTerminal
          ? html`<button class="action-btn action-btn--danger" @click=${() => handleCleanupFleet(route.runId)}>
              ${unsafeHTML(iconSvg(Trash2, 14))} Cleanup
            </button>`
          : nothing;
        const rerunBtn = isTerminal
          ? html`<button class="action-btn action-btn--teal" @click=${() => navigate('fleet-runs', 'new', null)}>
              ${unsafeHTML(iconSvg(RotateCcw, 14))} Re-run
            </button>`
          : nothing;
        const btns = [
          pauseBtn,
          haltBtn,
          stopBtn,
          resumeBtn,
          cleanupBtn,
          rerunBtn,
        ].filter((b) => b !== nothing);
        if (btns.length) actionButton = html`${btns}`;
      }
    }
  } else if (route.section === 'workspaces' && route.runId === 'new') {
    title = 'New Workspace';
    showBack = true;
    const wcs = getWorkspaceCreateSubmitState();
    actionButton = html`
      <button class="action-btn action-btn--primary" ?disabled=${wcs.isSubmitting || !wcs.canSubmit}
        @click=${() =>
          submitWorkspaceCreate({
            rerender,
            onCreated: (name) => {
              _refreshWorkspaceDefinitions();
              resetWorkspaceCreateState();
              // After creating, drop the user back at the workspaces list so
              // they can see their new definition and decide what to do next
              // (launch it, edit it, create another). The launcher remains
              // one click away via the row's Launch action.
              navigate('workspaces', null, null);
              return name;
            },
          })}>
        ${unsafeHTML(iconSvg(Plus, 14))}
        ${wcs.isSubmitting ? 'Creating…' : 'Create'}
      </button>`;
  } else if (
    route.section === 'workspaces' &&
    route.runId &&
    route.action === 'edit'
  ) {
    title = `Edit Workspace: ${route.runId}`;
    showBack = true;
    const wes = getWorkspaceEditSubmitState();
    actionButton = html`
      <button class="action-btn action-btn--primary" ?disabled=${wes.isSubmitting || !wes.canSubmit}
        @click=${() =>
          submitWorkspaceEdit({
            rerender,
            onUpdated: () => {
              _refreshWorkspaceDefinitions();
              _lastEditWorkspace = null;
              navigate('workspaces', null, null);
            },
          })}>
        ${unsafeHTML(iconSvg(Save, 14))}
        ${wes.isSubmitting ? 'Saving…' : 'Save'}
      </button>`;
  } else if (route.section === 'workspaces') {
    title = 'Workspaces';
    actionButton = html`
      <button class="action-btn action-btn--primary"
        @click=${() => navigate('workspaces', 'new', null)}>
        ${unsafeHTML(iconSvg(Plus, 14))}
        New Workspace
      </button>`;
  } else if (route.section === 'workspace-runs') {
    showBack = true;
    if (route.runId === 'new') {
      title = 'Run Workspace';
      // Reuse fleet-launcher's submit state — it dispatches based on
      // launcherMode, so workspace mode hits POST /api/workspace-runs and
      // returns data.workspace_id on success.
      const fls = getFleetLauncherSubmitState();
      const capReached = isAtCapacity(state);
      actionButton = html`
        <button class="action-btn action-btn--primary" ?disabled=${fls.isSubmitting || !fls.canLaunch || capReached}
          @click=${() =>
            submitFleetLauncher({
              rerender,
              onStarted: (workspaceId) => {
                _refreshWorkspaces();
                navigate('workspace-runs', workspaceId, null);
              },
            })}>
          ${unsafeHTML(iconSvg(Play, 14))}
          ${fls.isSubmitting ? 'Launching…' : 'Launch'}
        </button>`;
    } else if (route.runId) {
      // Mirror the fleet-runs/:id header: badge LEFT of title (semantic
      // pill + spinner/glyph), action buttons RIGHT (Resume/Cleanup/Re-run
      // gated on terminal/halted/in-flight). Pull the cached manifest the
      // detail view already fetched.
      const ws = _wsDetailCache[route.runId];
      const shortId = route.runId.split('_').pop() || route.runId;
      // Mirror workspace-card / fleet-card: title is always
      // `Workspace <id_short>`. The workspace_name (e.g. "test-multi")
      // is surfaced inside the detail page body, not the header.
      title = `Workspace ${shortId}`;

      if (ws) {
        const wsStatus = ws.status || 'running';
        const variantMap = {
          planning: 'primary',
          running: 'primary',
          integration_testing: 'primary',
          completed: 'success',
          failed: 'danger',
          integration_failed: 'warning',
          halted: 'warning',
          blocked: 'neutral',
        };
        badge = html`<sl-badge variant="${variantMap[wsStatus] || 'neutral'}" pill>
          ${unsafeHTML(statusIcon(wsStatus, 12))}
          ${wsStatus.charAt(0).toUpperCase() + wsStatus.slice(1).replace(/_/g, ' ')}
        </sl-badge>`;

        const isResumable =
          wsStatus === 'halted' ||
          wsStatus === 'failed' ||
          wsStatus === 'integration_failed';
        const isRunning =
          wsStatus === 'running' ||
          wsStatus === 'planning' ||
          wsStatus === 'integration_testing';
        const isTerminal = !isRunning;

        // Workspaces don't yet have a halt/pause/stop endpoint — only
        // resume/cleanup/relaunch (W-047 §10.10). Re-run uses the
        // /relaunch endpoint which forks a fresh ws_id.
        const resumeBtn = isResumable
          ? html`<button class="action-btn action-btn--primary" @click=${() => handleResumeWorkspace(route.runId)}>
              ${unsafeHTML(iconSvg(Play, 14))} Resume
            </button>`
          : nothing;
        const cleanupBtn = isTerminal
          ? html`<button class="action-btn action-btn--danger" @click=${() => handleCleanupWorkspaceRun(route.runId)}>
              ${unsafeHTML(iconSvg(Trash2, 14))} Cleanup
            </button>`
          : nothing;
        const rerunBtn = isTerminal
          ? html`<button class="action-btn action-btn--teal" @click=${() => handleRerunWorkspace(route.runId)}>
              ${unsafeHTML(iconSvg(RotateCcw, 14))} Re-run
            </button>`
          : nothing;
        const btns = [resumeBtn, cleanupBtn, rerunBtn].filter(
          (b) => b !== nothing,
        );
        if (btns.length) actionButton = html`${btns}`;
      }
    } else {
      title = 'Workspaces';
    }
  } else if (
    (route.action === 'timeline' || route.action === 'access') &&
    route.runId
  ) {
    showBack = true;
    ({ title, badge, actionButton } = runPageHeaderParts(route.runId));
  } else if (
    route.runId &&
    route.section !== 'templates' &&
    route.section !== 'models'
  ) {
    // The templates / models sections also encode their primary key
    // in `route.runId` (e.g. `#/templates/feature-glm-ds/edit`,
    // `#/models/opus/edit/builtin`), so without the section guard
    // this generic "run detail" handler would overwrite the dedicated
    // "Edit Template" / "Edit Model" title below.
    showBack = true;
    ({ title, badge, actionButton } = runPageHeaderParts(route.runId));
  } else if (route.section === 'active') {
    title = 'Running Pipelines';
    showBack = true;
  } else if (route.section === 'worktrees') {
    title = 'Worktrees';
    showBack = true;
  } else if (route.section === 'history') {
    title = 'History';
    showBack = true;
    if (route.runId) {
      const historyRun = Object.values(state.runs).find(
        (r) => r.id === route.runId,
      );
      const hs = historyRun?.pipeline_status;
      const pending =
        _controlPending?.runId === route.runId ? _controlPending.action : null;
      if (pending === 'stop') {
        actionButton = html`
          <button class="action-btn action-btn--danger" disabled>
            ${unsafeHTML(iconSvg(Loader, 14, 'icon-spin'))}
            Stopping\u2026
          </button>`;
      } else if (pending === 'pause') {
        actionButton = html`
          <button class="action-btn action-btn--amber" disabled>
            ${unsafeHTML(iconSvg(Loader, 14, 'icon-spin'))}
            Pausing\u2026
          </button>`;
      } else if (pending === 'resume') {
        actionButton = html`
          <button class="action-btn action-btn--primary" disabled>
            ${unsafeHTML(iconSvg(Loader, 14, 'icon-spin'))}
            Resuming\u2026
          </button>`;
      } else {
        const pauseBtn = actionAllowed('pause', hs)
          ? html`<button class="action-btn action-btn--amber" @click=${() => handlePauseRun(route.runId)}>
              ${unsafeHTML(iconSvg(Pause, 14))} Pause
            </button>`
          : nothing;
        const stopBtn = actionAllowed('stop', hs)
          ? html`<button class="action-btn action-btn--danger" @click=${() => handleStopRun(route.runId)}>
              ${unsafeHTML(iconSvg(Square, 14))} Stop
            </button>`
          : nothing;
        const resumeBtn = actionAllowed('resume', hs)
          ? html`<button class="action-btn action-btn--primary" @click=${() => handleResumeRun(route.runId)}>
              ${unsafeHTML(iconSvg(Play, 14))} Resume
            </button>`
          : nothing;
        const cancelBtn =
          stopBtn === nothing && actionAllowed('cancel', hs)
            ? html`<button class="action-btn action-btn--danger" @click=${() => handleCancelRun(route.runId)}>
                ${unsafeHTML(iconSvg(Square, 14))} Cancel
              </button>`
            : nothing;
        const btns = [pauseBtn, stopBtn, resumeBtn, cancelBtn].filter(
          (b) => b !== nothing,
        );
        if (btns.length) actionButton = html`${btns}`;
      }
    }
  } else if (route.section === 'new-run') {
    title = 'Run Pipeline';
    showBack = true;
    const hasProjects = (state.projects?.length ?? 0) > 0;
    const nrs = getNewRunSubmitState({
      hasProjects,
      currentProjectId: state.currentProjectId,
    });
    const capReached = isAtCapacity(state);
    const btnDisabled = nrs.isSubmitting || capReached || nrs.noProject;
    const btnTitle = nrs.noProject ? 'Select a project to launch.' : '';
    actionButton = html`
      <button class="action-btn action-btn--primary" ?disabled=${btnDisabled} title=${btnTitle}
        @click=${() => submitNewRun({ rerender, onStarted: () => navigate('active', null, route.projectId), projectId: getEffectiveProjectId(store.getState()), hasProjects })}>

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
  } else if (route.section === 'templates') {
    if (route.action === 'edit' || route.action === 'duplicate') {
      // Built-ins open as a read-only inspector — title and badge
      // make that explicit in the page header (no Save in the
      // editor footer for these). Project/user templates stay as
      // a normal "Edit Template" surface.
      const builtinView = route.tier === 'builtin';
      title = builtinView ? 'View Template' : 'Edit Template';
      showBack = true;
      if (builtinView) {
        badge = html`<sl-badge
          variant="warning"
          pill
          title="Built-in templates can't be modified. Use Duplicate to fork into project or user scope."
          >Read-only</sl-badge
        >`;
      }
      // Top-right Set/Unset Default toggle. Replaces the per-card
      // "Set Default" button — one canonical surface, and the user
      // can see whether the template they're looking at is the
      // current default. Exposed for project-tier and builtin-tier
      // templates (both are portable and available to all
      // collaborators). User-tier is excluded because ~/.worca/
      // templates are not in the repo and would break anyone who
      // doesn't have that template installed locally.
      if (
        (route.tier === 'project' || route.tier === 'builtin') &&
        route.runId
      ) {
        const defaultRef = state.defaultTemplate;
        const defaultId =
          typeof defaultRef === 'string' ? defaultRef : defaultRef?.id || null;
        const defaultTier =
          typeof defaultRef === 'string' ? null : defaultRef?.tier || null;
        const isThisDefault =
          defaultId === route.runId &&
          (!defaultTier || defaultTier === route.tier);
        // When this template is the project default, show a "★
        // Default" badge inline next to the title so the user can
        // tell at a glance which template is pinned. Mirrors the
        // ★ Default badge that the list card carries.
        if (isThisDefault) {
          badge = html`<sl-badge
            variant="primary"
            pill
            class="template-default-badge"
            title="This template is the project's default"
            >★ Default</sl-badge
          >`;
        }
        const cliOk = state.worcaCliStatus?.ok !== false;
        actionButton = html`
          <button
            class="action-btn ${isThisDefault ? 'action-btn--secondary' : 'action-btn--primary'}"
            ?disabled=${!cliOk}
            title=${
              isThisDefault
                ? "Clear this project's default template"
                : 'Pin this template as the project default'
            }
            @click=${() =>
              isThisDefault
                ? handleSetDefaultTemplate(null, null)
                : handleSetDefaultTemplate(route.runId, route.tier)}
          >
            ${
              isThisDefault
                ? html`Unset Default`
                : html`${unsafeHTML(iconSvg(Star, 14))} Set Default`
            }
          </button>
        `;
      }
    } else {
      title = 'Pipeline Templates';
      showBack = false;
      // Header actions, top-right: Import (left) + New (right).
      // Disabled in degraded mode (banner already explains why).
      const cliOk = state.worcaCliStatus?.ok !== false;
      actionButton = html`
        <button
          class="action-btn action-btn--secondary"
          ?disabled=${!cliOk}
          title=${cliOk ? 'Import a template bundle (.json)' : 'Upgrade worca-cc to enable import'}
          @click=${() => handleImportTemplate(route.projectId)}
        >
          ${unsafeHTML(iconSvg(Upload, 14))}
          Import
        </button>
        <button
          class="action-btn action-btn--primary"
          ?disabled=${!cliOk}
          title=${cliOk ? 'Create a new template from scratch' : 'Upgrade worca-cc to enable create'}
          @click=${() => handleCreateTemplate(route.projectId)}
        >
          ${unsafeHTML(iconSvg(Plus, 14))}
          New
        </button>
      `;
    }
  } else if (route.section === 'models') {
    if (route.action === 'edit') {
      const isBuiltinView = route.tier === 'builtin';
      const isNew = route.runId === 'new';
      title = isBuiltinView ? 'View Model' : isNew ? 'New Model' : 'Edit Model';
      showBack = true;
      if (isBuiltinView) {
        badge = html`<sl-badge
          variant="warning"
          pill
          title="Built-in models can't be modified. Use Duplicate to fork into project or user scope."
          >Read-only</sl-badge
        >`;
      } else {
        const saving = modelEditorState.saving;
        actionButton = html`
          <button
            class="action-btn action-btn--secondary"
            @click=${() => navigate('models', null, route.projectId)}
            ?disabled=${saving}
            title="Cancel and return to the Models list"
          >
            Cancel
          </button>
          <button
            class="action-btn action-btn--primary"
            ?disabled=${saving}
            title="Save changes"
            @click=${() =>
              saveModel({
                projectId: route.projectId,
                allModels: state.models || [],
                onSaved: ({ tier, alias }) => {
                  // Refresh list, keep the user on the editor.
                  fetchModels(route.projectId || null).then((models) => {
                    store.setState({ models, modelsLoaded: true });
                  });
                  // For renames or new entries, update the URL in place
                  // so refresh / back-button works.
                  if (
                    route.runId !== alias ||
                    (route.tier && route.tier !== tier)
                  ) {
                    navigate(
                      'models',
                      alias,
                      route.projectId,
                      'edit',
                      tier || route.tier,
                    );
                  }
                },
              })}
          >
            ${saving ? html`<sl-spinner></sl-spinner>` : ''}
            Save
          </button>
        `;
      }
    } else {
      title = 'Models';
      showBack = false;
      const cliOk = state.worcaCliStatus?.ok !== false;
      actionButton = html`
        <button
          class="action-btn action-btn--primary"
          ?disabled=${!cliOk}
          title=${cliOk ? 'Create a new model alias' : 'Upgrade worca-cc to enable create'}
          @click=${() => handleCreateModel()}
        >
          ${unsafeHTML(iconSvg(Plus, 14))}
          New
        </button>
      `;
    }
  } else if (route.section === 'project-settings') {
    title = 'Project Settings';
    showBack = true;
  }

  // Dashboard gets a "Run Pipeline" button in the header
  if (!route.section && !route.runId) {
    actionButton = html`
      <button class="action-btn action-btn--primary" @click=${() => navigate('new-run', null, route.projectId)}>
        ${unsafeHTML(iconSvg(Plus, 14))}
        Run Pipeline
      </button>`;
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
      <h1 class="content-header-title">${title}</h1>
      ${badge || ''}
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
  const allRuns = Object.values(state.runs);
  // In multi-project mode, filter runs to the selected project so views
  // only show runs belonging to the current project — not all projects.
  const currentProjectId = state.currentProjectId;
  const runs =
    currentProjectId && (state.projects || []).length > 1
      ? allRuns.filter((r) => {
          const rp = r.project || r._project;
          return rp === currentProjectId;
        })
      : allRuns;
  // Build a derived state with only the filtered runs for views (like
  // dashboardView) that read state.runs internally.
  const filteredRunsMap = {};
  for (const r of runs) filteredRunsMap[r.id] = r;

  // Archived runs — same project filter as active runs
  const allArchivedRuns = Object.values(state.archivedRuns);
  const archivedRuns =
    currentProjectId && (state.projects || []).length > 1
      ? allArchivedRuns.filter((r) => {
          const rp = r.project || r._project;
          return rp === currentProjectId;
        })
      : allArchivedRuns;
  const filteredArchivedRunsMap = {};
  for (const r of archivedRuns) filteredArchivedRunsMap[r.id] = r;
  const viewState = {
    ...state,
    runs: filteredRunsMap,
    archivedRuns: filteredArchivedRunsMap,
  };

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
        run: store.getRunById(route.runId),
        runId: route.runId,
      });
    }
    return beadsRunListView(runs, {
      onSelectRun: handleSelectRun,
      beadsCounts,
    });
  }

  // Access sub-view for a run: short-circuit to runFileAccessView.
  if (route.action === 'access' && route.runId) {
    const run = store.getRunById(route.runId);
    if (!run) {
      if (
        state.runsLoaded &&
        currentProjectId &&
        (state.projects || []).length > 1
      ) {
        navigate(route.section, null, route.projectId);
        return html``;
      }
      if (state.runsLoaded) {
        return html`
          <div class="run-detail run-detail-layout">
            <div class="run-detail-layout__overview">
              <sl-alert variant="warning" open>
                <strong>Run not found.</strong>
                No <code>status.json</code> exists for
                <code>${route.runId}</code> — it may have been an orphan worktree
                whose pipeline died before writing run state. Clean it up from the
                <a href="#/worktrees" @click=${() => navigate('worktrees')}>Worktrees</a> view.
              </sl-alert>
            </div>
          </div>
        `;
      }
      return html``;
    }
    fetchRunAccessModel(route.runId);
    return runFileAccessView(run, settings, {
      section: route.section,
      runId: route.runId,
      projectId: route.projectId,
      model: runAccessModels.get(route.runId),
      onOpenTimeline: () =>
        navigate(route.section, route.runId, route.projectId, 'timeline'),
      onRerender: rerender,
    });
  }

  // Timeline sub-view for a run: short-circuit to runTimelineView.
  if (route.action === 'timeline' && route.runId) {
    const run = store.getRunById(route.runId);
    if (!run) {
      if (
        state.runsLoaded &&
        currentProjectId &&
        (state.projects || []).length > 1
      ) {
        navigate(route.section, null, route.projectId);
        return html``;
      }
      if (state.runsLoaded) {
        return html`
          <div class="run-detail run-detail-layout">
            <div class="run-detail-layout__overview">
              <sl-alert variant="warning" open>
                <strong>Run not found.</strong>
                No <code>status.json</code> exists for
                <code>${route.runId}</code> — it may have been an orphan worktree
                whose pipeline died before writing run state. Clean it up from the
                <a href="#/worktrees" @click=${() => navigate('worktrees')}>Worktrees</a> view.
              </sl-alert>
            </div>
          </div>
        `;
      }
      return html``;
    }
    return runTimelineView(run, settings, {
      section: route.section,
      runId: route.runId,
      projectId: route.projectId,
    });
  }

  // The runId catch-all renders the per-run pipeline detail view. Exclude
  // sections that own their own :id sub-route (fleet-runs, workspace-runs,
  // workspaces — the create-definition flow, pipelines for template editing).
  if (
    route.runId &&
    route.section !== 'fleet-runs' &&
    route.section !== 'workspace-runs' &&
    route.section !== 'workspaces' &&
    route.section !== 'templates' &&
    route.section !== 'models'
  ) {
    const run = store.getRunById(route.runId);
    // If the run doesn't belong to the current project (e.g. after a project
    // switch), redirect to the section root instead of showing a stale view.
    // Skip redirect if runs haven't loaded yet (cold page load race condition).
    if (
      !run &&
      state.runsLoaded &&
      currentProjectId &&
      (state.projects || []).length > 1
    ) {
      navigate(route.section, null, route.projectId);
      return html``;
    }
    // Orphan run (e.g. child that died before writing status.json): runs
    // are loaded but this id isn't there. Show an empty-state instead of
    // rendering run-detail with run=undefined (which silently breaks).
    if (!run && state.runsLoaded) {
      return html`
        <div class="run-detail run-detail-layout">
          <div class="run-detail-layout__overview">
            <sl-alert variant="warning" open>
              <strong>Run not found.</strong>
              No <code>status.json</code> exists for
              <code>${route.runId}</code> — it may have been an orphan worktree
              whose pipeline died before writing run state. Clean it up from the
              <a href="#/worktrees" @click=${() => navigate('worktrees')}>Worktrees</a> view.
            </sl-alert>
          </div>
        </div>
      `;
    }
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
    const fileAccessEnabled =
      settings?.worca?.telemetry?.file_access?.enabled !== false;
    const { overview, stages: stagePanelsHtml } = runDetailView(run, settings, {
      promptCache: promptCache[route.runId] || {},
      onRestartStage: handleRestartStage,
      stageIterationTab,
      onStageTabChange: handleStageTabChange,
      onOpenTimeline: () =>
        navigate(route.section, route.runId, route.projectId, 'timeline'),
      onOpenAccess: fileAccessEnabled
        ? () => navigate(route.section, route.runId, route.projectId, 'access')
        : undefined,
      // Plan-stage View plan dialog needs to redraw when the modal
      // toggles open/closed and when the lazy plan fetch resolves.
      rerender,
    });
    return html`
      <div class="run-detail run-detail-layout">
        <div class="run-detail-layout__overview">
          ${overview}
        </div>
        <div class="run-detail-layout__stages">
          <div class="run-detail-column-header">Stages</div>
          ${stagePanelsHtml}
        </div>
        <div class="run-detail-layout__logs">
          <div class="run-detail-column-header">Artifacts</div>
          ${prApprovalPanelView(run, { onApprove: handleApprovePR, onReject: handleRejectPR })}
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
          ${runBeadsSectionView(runBeads.get(route.runId), {
            loaded: runBeads.has(route.runId),
            showSpinner: beadsSpinner.has(route.runId),
          })}
          ${learningsSectionView(run?.stages?.learn, {
            onRunLearn: actionAllowed('learn', run?.pipeline_status)
              ? handleRunLearn
              : null,
            runMeta: buildRunMeta(run, route.runId),
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
    return tokenCostsView(viewState, {
      expandedRun: costsExpanded,
      tokenData: costsTokenData,
      onToggleRun: handleToggleCostRun,
    });
  }

  if (route.section === 'new-run') {
    return newRunView(viewState, { rerender });
  }

  if (route.section === 'templates') {
    // Pipelines are project-scoped (the underlying CLI writes to
    // `.claude/templates/` under the resolved project root). In true
    // All-Projects mode there's no project to scope to, so show the
    // same "select a project first" empty state used by Project Settings.
    const isAllProjects =
      (state.projects || []).length > 1 && !state.currentProjectId;
    if (isAllProjects) {
      return html`
        <div class="empty-state pipelines-empty">
          <p>Select a project from the sidebar to view its pipeline templates.</p>
          <sl-button variant="primary" @click=${() => navigate('dashboard', null, null)}>
            Back to Dashboard
          </sl-button>
        </div>
      `;
    }

    // Set up template polling on first entry
    if (!_templatesPollCleanup) {
      _templatesPollCleanup = setupTemplatePolling(
        { currentProjectId: route.projectId },
        store,
        rerender,
      );
    }

    // Fetch the worca-cc CLI compatibility status once per pipelines
    // entry. The server caches the probe so this is essentially free.
    // The Pipelines view degrades to read-only when ok=false; without
    // this probe, every CRUD click would hit a 500 instead.
    if (state.worcaCliStatus === undefined && !_worcaCliStatusFetching) {
      _worcaCliStatusFetching = true;
      fetch('/api/worca-cli')
        .then((r) => r.json())
        .then((status) => {
          store.setState({ worcaCliStatus: status || null });
        })
        .catch(() => {
          // Network/parse failure — treat as unknown rather than green.
          // ok:false guarantees the banner renders and writes stay disabled.
          store.setState({
            worcaCliStatus: {
              ok: false,
              installed: null,
              minimum: 'unknown',
              message: 'Failed to probe worca-cc CLI status',
            },
          });
        })
        .finally(() => {
          _worcaCliStatusFetching = false;
        });
    }

    // /templates/:tier/:id/edit → editor (load and edit template)
    if (route.runId && route.action === 'edit' && route.tier) {
      const tid = route.runId;
      const tier = route.tier;
      // Import editor module and get state functions (without await to keep function sync)
      if (!_editorModule) {
        import('./views/pipelines-editor.js').then((mod) => {
          _editorModule = mod;
          ({ getEditorState } = mod);
          rerender();
        });
        return html`<div class="editor-loading"><sl-spinner id="editor-spinner"></sl-spinner> Loading editor…</div>`;
      }
      const editorStateCurr = getEditorState();
      // Load template on first entry — reload when (tier, id) changes
      if (editorStateCurr.templateId !== tid || editorStateCurr.tier !== tier) {
        _editorModule
          .loadTemplate(tier, tid, route.projectId)
          .then(() => rerender());
        return html`<div class="editor-loading"><sl-spinner id="editor-spinner"></sl-spinner> Loading template…</div>`;
      }
      // Ensure the templates list is loaded too — the editor uses it
      // for the inline ID-collision check (same UX as the duplicate
      // dialog). On direct navigation to /templates/<tier>/<id>/edit
      // the templates list view never ran, so state.templates is
      // empty; fetch it once in the background.
      if (
        !state.templates &&
        !state.templatesLoaded &&
        !_editorTemplatesFetching
      ) {
        _editorTemplatesFetching = true;
        fetchTemplates(route.projectId || null)
          .then((templates) => {
            store.setState({
              templates,
              defaultTemplate: templates.defaultTemplate,
              templatesLoaded: true,
            });
          })
          .finally(() => {
            _editorTemplatesFetching = false;
          });
      }
      return pipelinesEditorView(state, {
        tid,
        tier,
        projectId: route.projectId,
        onSaved: ({ newId, newTier } = {}) => {
          // Stay on the editor page after Save — consistent with the
          // Project Settings tabs (toast + same page), and lets the
          // user keep editing without losing the tab they're on.
          // Just refresh the templates list in the background so the
          // ★ Default badge and other list-derived state stay fresh.
          fetchTemplates(route.projectId || null).then((templates) => {
            store.setState({
              templates,
              defaultTemplate: templates.defaultTemplate,
            });
          });
          // If the save renamed the template (id changed), update the
          // URL in place so the next reload / link works — without
          // this the editor would 404 on refresh.
          if (newId && (newId !== tid || newTier !== tier)) {
            navigate(
              'templates',
              newId,
              route.projectId,
              'edit',
              newTier || tier,
            );
          }
        },
        onCancel: () => navigate('templates', null, route.projectId),
        rerender,
      });
    }

    // The default_template pointer now ships in the same /templates
    // response as the list, so we read it from state.defaultTemplate
    // (set by fetchTemplates) instead of waiting for the separate
    // /settings round-trip. That way the ★ Default badge renders on
    // the first paint, with no flicker.
    const defaultTemplate =
      state.defaultTemplate !== undefined
        ? state.defaultTemplate
        : settings.worca?.default_template || null;
    return pipelinesView(viewState, {
      rerender,
      defaultTemplate,
      onCreate: () => handleCreateTemplate(route.projectId),
      onImport: () => handleImportTemplate(route.projectId),
      onEdit: handleEditTemplate,
      onDuplicate: handleDuplicateTemplate,
      onDelete: handleDeleteTemplate,
      onExport: handleExportTemplate,
      onGist: handleCopyGistUrl,
    });
  }

  if (route.section === 'models') {
    // Project-scoped — All-Projects mode has no project to bind to.
    const isAllProjects =
      (state.projects || []).length > 1 && !state.currentProjectId;
    if (isAllProjects) {
      return html`
        <div class="empty-state pipelines-empty">
          <p>Select a project from the sidebar to view its models.</p>
          <sl-button variant="primary" @click=${() => navigate('dashboard', null, null)}>
            Back to Dashboard
          </sl-button>
        </div>
      `;
    }

    // Initial list poll
    if (!_modelsPollCleanup) {
      _modelsPollCleanup = setupModelsPolling(
        { currentProjectId: route.projectId },
        store,
        rerender,
      );
    }

    // Probe worca-cc status once (shared with templates page).
    if (state.worcaCliStatus === undefined && !_worcaCliStatusFetching) {
      _worcaCliStatusFetching = true;
      fetch('/api/worca-cli')
        .then((r) => r.json())
        .then((status) => {
          store.setState({ worcaCliStatus: status || null });
        })
        .catch(() => {
          store.setState({
            worcaCliStatus: {
              ok: false,
              installed: null,
              minimum: 'unknown',
              message: 'Failed to probe worca-cc CLI status',
            },
          });
        })
        .finally(() => {
          _worcaCliStatusFetching = false;
        });
    }

    // Editor branch
    if (route.runId && route.action === 'edit') {
      const tier = route.tier || 'project';
      const alias = route.runId;
      // Trigger load when (tier, alias) changes — same pattern as the
      // template editor. modelEditorState.alias tracks the loaded entry;
      // for 'new' we clear via resetModelEditor inside loadModelForEdit.
      const loadedMatches =
        (alias === 'new' &&
          modelEditorState.isNew &&
          modelEditorState.tier === tier) ||
        (alias !== 'new' &&
          modelEditorState.alias === alias &&
          modelEditorState.tier === tier);
      if (!loadedMatches && !modelEditorState.loading) {
        loadModelForEdit({
          tier,
          alias,
          projectId: route.projectId,
          rerender,
        });
      }
      // Ensure the list is loaded for the inline alias-collision check.
      if (!state.modelsLoaded && !_editorModelsFetching) {
        _editorModelsFetching = true;
        fetchModels(route.projectId || null)
          .then((models) => store.setState({ models, modelsLoaded: true }))
          .finally(() => {
            _editorModelsFetching = false;
          });
      }
      return modelEditorView(state, {
        projectId: route.projectId,
        allModels: state.models || [],
        rerender,
        onTierChange: (nextTier) => {
          // Flipping the storage picker on a new entry just rewrites the
          // URL tier slot so refresh / back-button stay coherent. The
          // editor state's tier is already updated by the picker itself.
          navigate('models', alias, route.projectId, 'edit', nextTier);
        },
      });
    }

    return modelsView(state, {
      onEdit: handleEditModel,
      onDuplicate: handleDuplicateModel,
      onDelete: handleDeleteModel,
    });
  }

  if (route.section === 'fleet-runs') {
    // /fleet-runs/new → launcher (Launch button lives in the page header,
    // wired to submitFleetLauncher above).
    if (route.runId === 'new') {
      if (_lastLauncherSection !== 'fleet-runs') {
        resetLauncherState({ launcherMode: 'fleet' });
        _lastLauncherSection = 'fleet-runs';
      }
      return fleetLauncherView(viewState, { rerender });
    }
    // /fleet-runs/:id → detail (fetch on demand, cache result)
    if (route.runId) {
      const fleet = _fleetDetailCache[route.runId];
      const isMissing = _fleetDetailMissing.has(route.runId);
      if (!fleet && !isMissing) {
        // Trigger fetch — only re-render on success/error
        if (_fleetDetailFetching !== route.runId) {
          _fleetDetailFetching = route.runId;
          fetch(`/api/fleet-runs/${route.runId}`)
            .then(async (r) => ({ status: r.status, data: await r.json() }))
            .then(({ status, data }) => {
              _fleetDetailFetching = null;
              if (data?.ok && data.fleet) {
                _fleetDetailMissing.delete(route.runId);
                _fleetDetailCache[route.runId] = data.fleet;
                rerender();
              } else if (status === 404 || data?.ok === false) {
                // Manifest cleaned up (or never existed) — record the
                // negative result so the view leaves the loading state and
                // we don't refetch on every render tick.
                _fleetDetailMissing.add(route.runId);
                rerender();
              }
            })
            .catch(() => {
              _fleetDetailFetching = null;
            });
        }
      }
      return fleetDetailView(fleet || null, {
        rerender,
        runsById: state.runs,
        onSelectRun: (id) => navigate('history', id, null),
        missing: isMissing,
        fleetId: route.runId,
      });
    }
    // /fleet-runs → list of fleets
    return _fleetListView(rerender);
  }

  if (route.section === 'workspaces') {
    // /workspaces/new → create a workspace definition.
    if (route.runId === 'new') {
      if (_lastCreateSection !== 'workspaces') {
        resetWorkspaceCreateState();
        _lastCreateSection = 'workspaces';
      }
      return workspaceCreateView(viewState, { rerender });
    }
    // /workspaces/:name/edit → edit an existing definition. workspaceEditView
    // owns its own load state — kick off the fetch on first entry so the
    // form populates with the current workspace.json.
    if (route.runId && route.action === 'edit') {
      if (_lastEditWorkspace !== route.runId) {
        _lastEditWorkspace = route.runId;
        loadWorkspace({ name: route.runId, rerender });
      }
      return workspaceEditView(viewState, { rerender });
    }
    // Bare /workspaces → list view (CRUD surface for definitions).
    return workspacesConfigView(viewState, {
      onCreate: () => navigate('workspaces', 'new', null),
      onLaunch: handleLaunchWorkspace,
      onEdit: (name) => navigate('workspaces', name, null, 'edit'),
      onDelete: handleDeleteWorkspace,
      onOpenRuns: () => navigate('workspace-runs', null, null),
    });
  }

  if (route.section === 'workspace-runs') {
    // /workspace-runs/new → launcher in workspace mode. Fleet launcher is the
    // shared launch surface for both fleets and workspaces; preset the mode
    // once on entry, then defer to its own state on subsequent renders.
    if (route.runId === 'new') {
      // A pending launch from the Configuration → Workspaces list takes
      // priority over the normal mode-reset: we want to land with the
      // chosen workspace already selected and its DAG visible.
      if (_pendingLaunchWorkspace) {
        const ws = (store.getState().workspaces || []).find(
          (w) => w.name === _pendingLaunchWorkspace,
        );
        resetLauncherState({
          launcherMode: 'workspace',
          selectedWorkspace: _pendingLaunchWorkspace,
          workspaceData: ws || null,
        });
        _lastLauncherSection = 'workspace-runs';
        _pendingLaunchWorkspace = null;
      } else if (_lastLauncherSection !== 'workspace-runs') {
        resetLauncherState({ launcherMode: 'workspace' });
        _lastLauncherSection = 'workspace-runs';
      }
      return fleetLauncherView(viewState, { rerender });
    }
    // /workspace-runs/:id → detail (fetch on demand, mirror fleet pattern)
    if (route.runId) {
      const ws = _wsDetailCache[route.runId];
      const isMissing = _wsDetailMissing.has(route.runId);
      if (!ws && !isMissing) {
        if (_wsDetailFetching !== route.runId) {
          _wsDetailFetching = route.runId;
          fetch(`/api/workspace-runs/${route.runId}`)
            .then(async (r) => ({ status: r.status, data: await r.json() }))
            .then(({ status, data }) => {
              _wsDetailFetching = null;
              if (data?.ok && data.manifest) {
                _wsDetailMissing.delete(route.runId);
                // Pin the server-computed cost_usd onto the cached
                // manifest so _overviewSection can read it without an
                // extra fetch. Without this, the client falls back to a
                // walk over `child.stages` (always empty in the manifest)
                // and prints $0.00 for every workspace run.
                _wsDetailCache[route.runId] = {
                  ...data.manifest,
                  cost_usd: data.cost_usd,
                };
                rerender();
              } else if (status === 404 || data?.ok === false) {
                _wsDetailMissing.add(route.runId);
                rerender();
              }
            })
            .catch(() => {
              _wsDetailFetching = null;
            });
        }
      }
      return workspaceDetailView(ws || null, {
        rerender,
        missing: isMissing,
        workspaceId: route.runId,
        // Mirror /fleet-runs/:id call site so _childrenSection can render
        // rich runCardView's for each child instead of a sparse PR table.
        runsById: state.runs,
        onSelectRun: (id) => navigate('history', id, null),
      });
    }
    // /workspace-runs → list of workspace runs
    return _workspaceListView(rerender);
  }

  if (route.section === 'project-settings') {
    const isAllProjects =
      (state.projects || []).length > 1 && !state.currentProjectId;
    if (isAllProjects) {
      return html`
        <div class="empty-state project-settings-empty">
          <p>Select a project from the sidebar to view its settings.</p>
          <sl-button variant="primary" @click=${() => navigate('dashboard', null, null)}>
            Back to Dashboard
          </sl-button>
        </div>
      `;
    }
    return projectSettingsView(state.preferences, {
      rerender,
      currentProjectId: state.currentProjectId || null,
    });
  }

  if (route.section === 'settings') {
    if (integrationsStatus === null) fetchIntegrationsData();
    return settingsView(state.preferences, {
      rerender,
      onThemeToggle: handleThemeToggle,
      onSaveSourceRepo: handleSaveSourceRepo,
      onSaveNotifications: handleSaveNotifications,
      onRequestPermission: () => notificationManager.requestPermission(),
      globals: {
        worktreeDiskWarningBytes: state.worktreeDiskWarningBytes,
        classifierModel: state.classifierModel,
        cleanupPolicy: state.cleanupPolicy,
        maxConcurrentPipelines: state.maxConcurrentPipelines,
      },
      onSaveGlobals: (patch) => store.setState(patch),
      projects: state.projects || [],
      integrations: {
        status: integrationsStatus,
        config: integrationsConfig,
        editingAdapter: integrationsEditingAdapter,
        forms: Object.fromEntries(
          ['telegram', 'discord', 'slack'].map((k) => [
            k,
            getIntegrationsForm(k),
          ]),
        ),
      },
      onIgStartEdit: handleIgStartEdit,
      onIgCancelEdit: handleIgCancelEdit,
      onIgFieldChange: handleIgFieldChange,
      onIgEventToggle: handleIgEventToggle,
      onIgSave: handleIgSave,
      onIgRemove: handleIgRemove,
      onIgDetect: handleIgDetect,
      onIgToggleEnabled: handleIgToggleEnabled,
      onProjectAdd: (result) => {
        if (result?.openDialog) {
          store.setState({ addProjectDialogOpen: true });
          rerender();
        } else if (Array.isArray(result) || result?.name) {
          // New project(s) added — re-fetch projects
          fetch('/api/projects')
            .then((r) => r.json())
            .then((data) => {
              store.setState({ projects: data.projects || [] });
              rerender();
            })
            .catch(() => {});
        }
      },
      onProjectRemove: () => {
        fetch('/api/projects')
          .then((r) => r.json())
          .then((data) => {
            store.setState({ projects: data.projects || [] });
            rerender();
          })
          .catch(() => {});
      },
      onProjectsRefresh: () => {
        fetch('/api/projects')
          .then((r) => r.json())
          .then((data) => {
            store.setState({ projects: data.projects || [] });
            rerender();
          })
          .catch(() => {});
      },
    });
  }

  if (route.section === 'history') {
    return runListView(runs, 'history', {
      onSelectRun: handleSelectRun,
      onResume: handleResumeRun,
      onStop: handleStopRun,
      onCancel: handleCancelRun,
      onArchive: archiveRun,
      onUnarchive: unarchiveRun,
      archivedRuns,
      statusFilter: historyStatusFilter,
      runsLoaded: store.getState().runsLoaded,
      onStatusFilter: (s) => {
        historyStatusFilter = s;
        rerender();
      },
      textFilter: historyTextFilter,
      onTextFilter: (value) => {
        historyTextFilter = value;
        rerender();
      },
    });
  }

  if (route.section === 'worktrees') {
    return worktreesView(state.worktrees || [], {
      diskWarningBytes: state.worktreeDiskWarningBytes,
      filter: worktreesFilter,
      onFilter: (value) => {
        worktreesFilter = value;
        rerender();
      },
      statusFilter: worktreesStatusFilter,
      onStatusFilter: (s) => {
        worktreesStatusFilter = s;
        rerender();
      },
      onSelectRun: handleSelectRun,
      onCleanup: openWorktreeCleanupDialog,
      onBulkCleanup: openWorktreeBulkCleanupDialog,
      dialogItem: worktreesDialogItem,
      dialogBulk: worktreesDialogBulk,
      dialogCheckbox: worktreesDialogCheckbox,
      onDialogClose: closeWorktreeCleanupDialog,
      onDialogConfirm: confirmWorktreeCleanup,
      onDialogCheckboxChange: (checked) => {
        worktreesDialogCheckbox = checked;
        rerender();
      },
    });
  }

  if (route.section === 'active') {
    const activeRuns = sortByStartDesc(runs.filter((r) => r.active));
    // Always show the list view — let the user click into a run.
    return html`
      <h3 class="dashboard-section-title">Active Runs</h3>
      ${
        activeRuns.length > 0
          ? html`
        <div class="active-group">
          <div class="run-list">
            ${activeRuns.map((run) =>
              runCardView(run, {
                onClick: handleSelectRun,
                onPause: handlePauseRun,
                onResume: handleResumeRun,
                onStop: handleStopRun,
                onCancel: handleCancelRun,
                onArchive: archiveRun,
              }),
            )}
          </div>
        </div>
      `
          : html`<div class="empty-state">No running pipelines</div>`
      }
    `;
  }

  return html`
    ${dashboardView(viewState, {
      onSelectRun: (runId) => navigate('active', runId, route.projectId),
      onArchive: archiveRun,
      onArchiveFleet: archiveFleet,
      onUnarchiveFleet: unarchiveFleet,
      onNavigate: (section, secondArg, thirdArg) => {
        if (
          secondArg &&
          typeof secondArg === 'object' &&
          secondArg.statusFilter
        ) {
          historyStatusFilter = secondArg.statusFilter;
          navigate(section, null, route.projectId);
        } else {
          navigate(section, secondArg || null, thirdArg || route.projectId);
        }
      },
      onPause: handlePauseRun,
      onResume: handleResumeRun,
      onStop: handleStopRun,
      onCancel: handleCancelRun,
    })}
  `;
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
        onProjectChange: handleProjectChange,
        onAddProject: () => {
          store.setState({ addProjectDialogOpen: true });
          rerender();
        },
        onToggleSidebar: toggleSidebarCollapsed,
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
      _templateGuard
        ? html`
      <sl-dialog class="template-guard-dialog" label="Template In Use" @sl-after-hide=${_dismissTemplateGuard}>
        <p>${_templateGuard.count} ${_templateGuard.count === 1 ? 'run' : 'runs'} in flight ${_templateGuard.count === 1 ? 'is' : 'are'} currently using this template.</p>
        <p>${
          _templateGuard.action === 'delete'
            ? 'Deleting it will not affect running pipelines, but new runs will no longer find this template.'
            : 'Editing it will not affect running pipelines, but changes will apply to future runs.'
        }</p>
        <sl-button slot="footer" variant="default" @click=${() => {
          document.querySelector('.template-guard-dialog')?.hide();
        }}>Cancel</sl-button>
        <sl-button slot="footer" variant=${_templateGuard.action === 'delete' ? 'danger' : 'warning'} @click=${_confirmTemplateGuard}>${_templateGuard.action === 'delete' ? 'Delete Anyway' : 'Edit Anyway'}</sl-button>
      </sl-dialog>
    `
        : ''
    }
    ${_templateActionDialogTemplate(state)}
    ${_modelDuplicateDialogTemplate()}
    ${confirmDialogTemplate()}
    ${batchWorcaSetupDialogTemplate(rerender)}
    ${addProjectDialogView(state, {
      onProjectAdd: (_project) => {
        store.setState({ addProjectDialogOpen: false });
        fetch('/api/projects')
          .then((r) => r.json())
          .then((data) => {
            store.setState({ projects: data.projects || [] });
            rerender();
          })
          .catch(() => {});
      },
      onClose: () => {
        store.setState({ addProjectDialogOpen: false });
        rerender();
      },
      rerender,
    })}
    ${gistExportDialogView(state, {
      onClose: handleGistDialogClose,
      onCopy: handleGistDialogCopy,
    })}
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

// Coalesce re-renders: a burst of state changes (the log-bulk backfill on
// opening a run, beads-update WAL ticks, rapid status events) collapses into a
// single synchronous render on the next animation frame instead of one full
// app render per change. Direct rerender() calls from user actions stay
// synchronous for immediate feedback.
let _rerenderScheduled = false;
function scheduleRerender() {
  if (_rerenderScheduled) return;
  _rerenderScheduled = true;
  const flush = () => {
    _rerenderScheduled = false;
    rerender();
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(flush);
  } else {
    setTimeout(flush, 0);
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
store.subscribe(() => scheduleRerender());
applyTheme(store.getState().preferences.theme);

// Cmd/Ctrl+B toggles the sidebar (VS Code convention).
// Ignore the shortcut when the user is typing in an editable element so
// it doesn't fight with text-editing flows.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'b' && e.key !== 'B') return;
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.altKey || e.shiftKey) return;
  const target = e.target;
  if (target) {
    const tag = (target.tagName || '').toLowerCase();
    if (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'sl-input' ||
      tag === 'sl-textarea'
    )
      return;
    if (target.isContentEditable) return;
  }
  e.preventDefault();
  toggleSidebarCollapsed();
});

if (route.projectId) {
  store.setState({ currentProjectId: route.projectId });
}
fetchProjectInfo();
Promise.all([
  fetch('/api/preferences')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null),
  fetch('/api/status/runs-count')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null),
]).then(([prefsRes, countRes]) => {
  const patch = {};
  if (prefsRes?.ok) {
    const p = prefsRes.preferences?.worca ?? {};
    if (p.ui?.worktree_disk_warning_bytes != null)
      patch.worktreeDiskWarningBytes = p.ui.worktree_disk_warning_bytes;
    if (p.circuit_breaker?.classifier_model != null)
      patch.classifierModel = p.circuit_breaker.classifier_model;
    if (p.parallel?.cleanup_policy != null)
      patch.cleanupPolicy = p.parallel.cleanup_policy;
    if (p.parallel?.max_concurrent_pipelines != null)
      patch.maxConcurrentPipelines = p.parallel.max_concurrent_pipelines;
  }
  if (countRes?.ok && typeof countRes.totalRunning === 'number') {
    patch.totalRunning = countRes.totalRunning;
  }
  if (Object.keys(patch).length > 0) store.setState(patch);
});
if (route.section === 'settings') {
  loadSettings(null).then(() => rerender());
  startIntegrationsPoll();
}
if (route.section === 'project-settings') {
  const s = store.getState();
  const isAllProjects = (s.projects || []).length > 1 && !s.currentProjectId;
  if (!isAllProjects) {
    loadSettings(s.currentProjectId || null).then(() => rerender());
  }
}

// Single-project polling fallback: WS totalRunning derivation only covers
// the focused project's runs. Poll /api/status/runs-count every 5s so
// launch gating stays accurate across all projects.
setInterval(() => {
  fetch('/api/status/runs-count')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data?.ok && typeof data.totalRunning === 'number') {
        const patch = { totalRunning: data.totalRunning };
        if (typeof data.cap === 'number')
          patch.maxConcurrentPipelines = data.cap;
        store.setState(patch);
      }
    })
    .catch(() => {});
}, 5000);

rerender();
attachStickyHeaderListener();

// --- Help mode (W-061 prototype) -------------------------------------------
// Mount the right-edge "Help" tab into its own fixed-position root outside
// the lit-html app root so route changes don't unmount it. Bind the global
// `?` / Escape keybindings once at bootstrap.
(function initHelpMode() {
  let root = document.getElementById('help-edge-tab-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'help-edge-tab-root';
    root.className = 'help-edge-tab-root';
    document.body.appendChild(root);
  }
  mountHelpEdgeTab(root);
  bindHelpKeyboard();
})();
