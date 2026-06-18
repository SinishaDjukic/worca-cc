// app/main.js — worca-bench dashboard entry point.
//
// Hash-router dispatch (#/, #/profile?name=X, #/compare, #/leaderboard),
// data fetch, and lit-html render. Mirrors worca-ui's app shell: a left
// `.sidebar` for section nav + a `.main-content` area whose every view is
// rendered under a shared `.content-header` (title, optional back button,
// optional per-page actions). Views are pure functions of data; main.js
// owns fetch, routing, and the header/shell composition.

import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
import { html, render } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';

import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';
import '@shoelace-style/shoelace/dist/components/radio-button/radio-button.js';
import '@shoelace-style/shoelace/dist/components/radio/radio.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

import { outcomeIcon, profileOutcome } from './utils/badge.js';
import { confirmDialogTemplate, showConfirm } from './utils/confirm-dialog.js';
import {
  folderPickerTemplate,
  openFolderPicker,
} from './utils/folder-picker.js';
import { notesDialogTemplate, showNotesDialog } from './utils/notes-dialog.js';
import {
  regradeDialogTemplate,
  showRegradeDialog,
} from './utils/regrade-dialog.js';
import { clearSecret, launchSecrets, saveSecrets } from './utils/secrets.js';
import { activityDock } from './views/activity-dock.js';
import { compareView } from './views/compare.js';
import { leaderboardView } from './views/leaderboard.js';
import { profileDetailView } from './views/profile-detail.js';
import { dashboardView } from './views/profile-list.js';
import { settingsView } from './views/settings.js';
import { sidebarView } from './views/sidebar.js';

// Shoelace ships its icon assets relative to a base path; point it at the
// bundled copy location (we don't use sl-icon, but the lib still resolves it).
setBasePath('/vendor');

const root = document.getElementById('app');

// Lucide ArrowLeft — the content-header back button (parity with worca-ui's
// `iconSvg(ArrowLeft)`). Inlined to keep worca-bench dependency-light.
const BACK_ARROW =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>';

// ─── Routing ────────────────────────────────────────────────────────────

/** Parse `#/path?query` into { path, params }. */
function parseHash(hash) {
  const raw = (hash || '').replace(/^#/, '') || '/';
  const [path, queryStr] = raw.split('?');
  const params = new URLSearchParams(queryStr || '');
  return { path: path || '/', params };
}

function navigate(hash) {
  if (location.hash === hash) {
    rerender();
  } else {
    location.hash = hash;
  }
}

/** Sidebar nav callback: section key → hash route. */
function onNavigate(key) {
  if (key === 'compare') navigate('#/compare');
  else if (key === 'leaderboard') navigate('#/leaderboard');
  else if (key === 'settings') navigate('#/settings');
  else navigate('#/');
}

/**
 * Which sidebar item is highlighted for a given route path. Profile detail
 * is reached from the dashboard, so it highlights Dashboard (parity with
 * worca-ui, where detail views light up their parent section).
 */
function activeKeyForPath(path) {
  if (path === '/compare') return 'compare';
  if (path === '/leaderboard') return 'leaderboard';
  if (path === '/settings') return 'settings';
  return 'dashboard';
}

// ─── Fetch helpers ──────────────────────────────────────────────────────

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

// ─── App state ──────────────────────────────────────────────────────────

const state = {
  loading: false,
  error: null,
  view: null, // { kind, data }
  toast: null, // { variant: 'success'|'danger', message }
  connection: 'connecting', // 'connected' | 'connecting' | 'disconnected'
  // Activity dock: the actions ledger (Run/Regrade launches), refreshed from
  // /api/actions so it's visible on every page and survives a reload.
  actions: [],
  actionsCollapsed: localStorage.getItem('wb.activity.collapsed') !== 'false', // default collapsed
  actionsDismissed: new Set(
    JSON.parse(localStorage.getItem('wb.activity.dismissed') || '[]'),
  ),
};

// Backend connection indicator (sidebar footer). worca-bench has no WS, so we
// poll /api/health; the dot reflects reachability.
function setConnection(next) {
  if (state.connection !== next) {
    state.connection = next;
    rerender();
  }
}
async function heartbeat() {
  try {
    const r = await fetch('/api/health');
    setConnection(r.ok ? 'connected' : 'disconnected');
  } catch {
    setConnection('disconnected');
  }
}

// Transient launch feedback. Auto-dismisses; a new toast replaces the old.
let toastTimer = null;
function showToast(variant, message) {
  state.toast = { variant, message };
  rerender();
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = null;
    toastTimer = null;
    rerender();
  }, 6000);
}

function toastView() {
  if (!state.toast) return '';
  const { variant, message } = state.toast;
  return html`<div
    class="launch-toast launch-toast--${variant}"
    role="status"
    aria-live="polite"
  >
    <span class="launch-toast-msg">${message}</span>
    <button
      class="launch-toast-close"
      aria-label="Dismiss"
      @click=${() => {
        state.toast = null;
        if (toastTimer) clearTimeout(toastTimer);
        rerender();
      }}
    >×</button>
  </div>`;
}

// Profiles checked for comparison (keyed `name@src` so same-named profiles from
// different result dirs are tracked separately). Persists across renders.
const selected = new Set();
const profileKey = (agg) => `${agg.name}@${agg.src}`;
function toggleSelect(agg) {
  const key = profileKey(agg);
  if (selected.has(key)) {
    selected.delete(key);
  } else {
    selected.add(key);
  }
  rerender();
}

function loadingView() {
  return html`<section class="page loading-state"><sl-spinner></sl-spinner> <span>Loading…</span></section>`;
}

function errorView(message) {
  return html`<section class="page"><p class="error-state">Error: ${message}</p></section>`;
}

// ─── Content header ─────────────────────────────────────────────────────

/** Top-right actions for the profile header (mutually exclusive states). */
function _profileActions(agg, isActive, view) {
  if (isActive) {
    return html`<button
      class="action-btn action-btn--danger"
      @click=${() => stopRuns(agg.name)}
    >Stop Runs</button>`;
  }
  const rg = view?.data?.regrade;
  if (rg?.active) {
    return html`<button
        class="action-btn"
        disabled
        title="Regrade in progress"
      >Regrading ${rg.done ?? 0}/${rg.total ?? 0}…</button
      ><button
        class="action-btn action-btn--danger"
        @click=${() => stopRegradeSweep(agg.name)}
      >Stop Regrade</button>`;
  }
  const hasReps = (view?.data?.reps || []).length > 0;
  return html`<button
      class="action-btn"
      @click=${() => clearResults(agg.name)}
    >Clear Results</button>${
      hasReps
        ? html`<button
            class="action-btn"
            @click=${() => regradeAll(agg.name)}
          >Regrade All</button>`
        : ''
    }`;
}

/**
 * Build the content-header spec for a route. Data-dependent bits (the
 * profile name/badge/Run button, the dashboard "Compare all" action) read
 * from `view` and are omitted while a fetch is in flight.
 *
 * @returns {{ showBack:boolean, onBack?:Function, title:any, badge?:any, action?:any }}
 */
function buildHeader(path, view) {
  const backToDashboard = () => navigate('#/');

  if (path === '/profile') {
    const agg = view?.kind === 'detail' ? view.data?.aggregate : null;
    const active = (view?.kind === 'detail' && view.data?.active) || [];
    const isActive = active.length > 0;
    const outcome = agg ? profileOutcome(agg) : null;
    return {
      showBack: true,
      onBack: backToDashboard,
      title: agg
        ? html`<span class="content-header-status">${
            isActive
              ? html`<span class="running-dot"></span>`
              : unsafeHTML(outcomeIcon(outcome, 18))
          }</span>${agg.name}`
        : 'Profile',
      // No single outcome badge: a multi-rep profile has reps in mixed states
      // (running / graded / skipped). State lives in the live block, the
      // resolved-rate stat, and the per-rep table instead.
      badge: null,
      // Run lives in Run options. Top-right: Stop Runs while a pipeline run is
      // active; a "Regrading X/N…" + Stop Regrade pair while a sweep runs;
      // otherwise Clear Results with Regrade All to its right (only when there
      // are reps to re-grade).
      action: !agg ? null : _profileActions(agg, isActive, view),
    };
  }

  // Compare / Leaderboard / Settings are top-level sidebar sections (peers of
  // the dashboard), so they carry no back button — only true drill-downs (the
  // profile detail above) do. Navigation back to the dashboard is the sidebar.
  if (path === '/compare') {
    return { showBack: false, title: 'Compare Profiles' };
  }

  if (path === '/leaderboard') {
    return { showBack: false, title: 'Leaderboard' };
  }

  if (path === '/settings') {
    return { showBack: false, title: 'Settings' };
  }

  // Dashboard (home) — no back button.
  const profiles = view?.kind === 'dashboard' ? view.data : null;
  const canCompare = Array.isArray(profiles) && profiles.length > 1;

  let action = null;
  if (selected.size > 0) {
    const names = [...selected].join(',');
    action = html`
      <button
        class="action-btn"
        @click=${() => {
          selected.clear();
          rerender();
        }}
      >Clear</button>
      <button
        class="action-btn action-btn--primary"
        @click=${() =>
          navigate(`#/compare?profiles=${encodeURIComponent(names)}`)}
      >Compare selected (${selected.size})</button>
    `;
  } else if (canCompare) {
    action = html`<button
      class="action-btn"
      @click=${() => {
        const refs = profiles.map((p) => `${p.name}@${p.src}`).join(',');
        navigate(`#/compare?profiles=${encodeURIComponent(refs)}`);
      }}
    >Compare all</button>`;
  }

  return { showBack: false, title: 'Benchmark Profiles', action };
}

function contentHeaderView({ showBack, onBack, title, badge, action }) {
  return html`
    <div class="content-header">
      ${
        showBack
          ? html`<button
              class="content-header-back"
              aria-label="Back to dashboard"
              @click=${onBack}
            >${unsafeHTML(BACK_ARROW)}</button>`
          : ''
      }
      <h1 class="content-header-title">${title}</h1>
      ${badge || ''}
      ${action ? html`<div class="content-header-actions">${action}</div>` : ''}
    </div>
  `;
}

// ─── Render ─────────────────────────────────────────────────────────────

function shell(activeKey, header, body) {
  return html`
    <div class="app-shell">
      ${sidebarView(activeKey, { onNavigate, connection: state.connection })}
      <main class="main-content">
        ${header}
        ${body}
      </main>
      ${activityDock(state.actions, {
        collapsed: state.actionsCollapsed,
        dismissed: state.actionsDismissed,
        onToggle: toggleActivity,
        onStop: stopAction,
        onView: viewAction,
        onDismiss: dismissAction,
      })}
      ${toastView()}
      ${confirmDialogTemplate()}
      ${folderPickerTemplate()}
      ${regradeDialogTemplate()}
      ${notesDialogTemplate()}
    </div>
  `;
}

// ─── Activity dock: refresh + controls ──────────────────────────────────────

async function refreshActions() {
  try {
    const data = await getJSON('/api/actions');
    const next = data.actions || [];
    if (JSON.stringify(next) !== JSON.stringify(state.actions)) {
      state.actions = next;
      rerender();
    }
  } catch {
    // Silent — the next poll tick retries.
  }
}

function toggleActivity() {
  state.actionsCollapsed = !state.actionsCollapsed;
  localStorage.setItem('wb.activity.collapsed', String(state.actionsCollapsed));
  rerender();
}

async function stopAction(a) {
  try {
    await fetch(`/api/actions/${encodeURIComponent(a.id)}/stop`, {
      method: 'POST',
    });
    showToast('success', `Stopping ${a.type} ${a.profile}…`);
    setTimeout(refreshActions, 800);
  } catch (err) {
    showToast('danger', `Stop failed: ${err.message}`);
  }
}

function viewAction(a) {
  const src = a.src ? `&src=${encodeURIComponent(a.src)}` : '';
  navigate(`#/profile?name=${encodeURIComponent(a.profile)}${src}`);
}

function dismissAction(a) {
  state.actionsDismissed.add(a.id);
  localStorage.setItem(
    'wb.activity.dismissed',
    JSON.stringify([...state.actionsDismissed]),
  );
  rerender();
}

function rerender() {
  const { path } = parseHash(location.hash);
  const activeKey = activeKeyForPath(path);

  let body;
  if (state.loading) {
    body = loadingView();
  } else if (state.error) {
    body = errorView(state.error);
  } else if (state.view) {
    body = renderView(state.view);
  } else {
    body = loadingView();
  }

  // Suppress data-dependent header bits while loading so a stale view's
  // title/actions don't flash during a fetch.
  const headerView = state.loading ? null : state.view;
  const header = contentHeaderView(buildHeader(path, headerView));
  render(shell(activeKey, header, body), root);
}

function renderView(view) {
  switch (view.kind) {
    case 'dashboard':
      return dashboardView(view.data, {
        onOpen: (agg) =>
          navigate(
            `#/profile?name=${encodeURIComponent(agg.name)}&src=${encodeURIComponent(agg.src)}`,
          ),
        onRun: (name) => runProfile(name),
        selected,
        onToggleSelect: toggleSelect,
      });
    case 'detail': {
      // Disable Run while this profile already has a live run action — the
      // anti-double-click guard (the dock shows the in-flight one).
      const runningRun = state.actions.some(
        (a) =>
          a.type === 'run' &&
          a.status === 'running' &&
          a.profile === view.data?.aggregate?.name,
      );
      return profileDetailView(view.data, {
        onRun: (name, opts) => runProfile(name, opts),
        onRegrade: (name, instanceId) => regradeInstance(name, instanceId),
        onNotes: (name) => openNotes(name),
        runDisabled: runningRun,
      });
    }
    case 'compare':
      return compareView(view.data);
    case 'leaderboard':
      return leaderboardView(view.data, {
        onSelectBenchmark: (b) =>
          navigate(`#/leaderboard?benchmark=${encodeURIComponent(b)}`),
      });
    case 'settings':
      return settingsView(view.data, {
        onAddDir: addDir,
        onRemoveDir: confirmRemoveDir,
        onSetCache: setCache,
        onBrowseAdd: browseAdd,
        onBrowseCache: browseCache,
        onSaveSecrets: saveGraderSecrets,
        onClearSecret: clearGraderSecret,
      });
    default:
      return errorView('Unknown view');
  }
}

// ─── Route handlers ─────────────────────────────────────────────────────

/** Fetch the view object for a route. Pure data — no state mutation. */
async function loadView(path, params) {
  if (path === '/' || path === '') {
    const { profiles } = await getJSON('/api/profiles');
    return { kind: 'dashboard', data: profiles };
  }
  if (path === '/profile') {
    const name = params.get('name');
    const src = params.get('src');
    const q = src ? `?src=${encodeURIComponent(src)}` : '';
    const data = await getJSON(`/api/profiles/${encodeURIComponent(name)}${q}`);
    return { kind: 'detail', data };
  }
  if (path === '/compare') {
    const profiles = params.get('profiles') || '';
    const { compare } = await getJSON(
      `/api/compare?profiles=${encodeURIComponent(profiles)}`,
    );
    return { kind: 'compare', data: compare };
  }
  if (path === '/leaderboard') {
    const benchmark = params.get('benchmark') || 'swe-bench-verified';
    const data = await getJSON(
      `/api/leaderboard?benchmark=${encodeURIComponent(benchmark)}`,
    );
    return { kind: 'leaderboard', data };
  }
  if (path === '/settings') {
    const data = await getJSON('/api/settings');
    return { kind: 'settings', data };
  }
  return null;
}

// Detect a regrade sweep finishing (active → not active for the same profile)
// across fetches and raise a one-shot completion toast with the verdict counts.
let _prevRegrade = { profile: null, active: false };
function _noteRegradeCompletion(view) {
  if (view?.kind !== 'detail') return;
  const name = view.data?.aggregate?.name || null;
  const rg = view.data?.regrade;
  const active = !!rg?.active;
  if (_prevRegrade.active && _prevRegrade.profile === name && !active) {
    const c = rg?.counts || {};
    showToast(
      'success',
      `Regrade complete for ${name}: ${c.resolved ?? 0} resolved · ${c.graded ?? 0} graded · ${c.error ?? 0} error`,
    );
  }
  _prevRegrade = { profile: name, active };
}

async function route() {
  const { path, params } = parseHash(location.hash);
  state.loading = true;
  state.error = null;
  rerender();
  try {
    const view = await loadView(path, params);
    if (view) {
      state.view = view;
      _noteRegradeCompletion(view);
    } else {
      state.error = `No such route: ${path}`;
    }
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
    rerender();
  }
}

// ─── Background auto-refresh ─────────────────────────────────────────────
//
// A live dashboard: the current route's data is re-fetched on an interval and
// re-rendered only when it actually changed (so a run launched here surfaces
// its results without a manual reload). No spinner — this is silent. Settings
// is excluded so a poll never clobbers the add-dir form/error state. The
// interval is overridable via `?poll=<ms>` (used by e2e to speed the tick up).

const POLL_MS = (() => {
  const raw = Number.parseInt(
    new URLSearchParams(location.search).get('poll') || '',
    10,
  );
  return Number.isInteger(raw) && raw >= 250 ? raw : 5000;
})();
let pollTimer = null;

async function refreshCurrent() {
  if (state.loading) return;
  const { path, params } = parseHash(location.hash);
  if (path === '/settings') return;
  try {
    const next = await loadView(path, params);
    if (next) _noteRegradeCompletion(next);
    if (next && JSON.stringify(next) !== JSON.stringify(state.view)) {
      state.view = next;
      rerender();
    }
  } catch {
    // Silent — the next tick retries.
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (!document.hidden) {
      refreshCurrent();
      refreshActions(); // keep the Activity dock live on every page
    }
  }, POLL_MS);
}

async function runProfile(name, opts = {}) {
  try {
    const body = { profile: name };
    if (Number.isInteger(opts.reps)) body.reps = opts.reps;
    if (Number.isInteger(opts.maxInstances))
      body.maxInstances = opts.maxInstances;
    if (Number.isInteger(opts.maxParallel)) body.maxParallel = opts.maxParallel;
    // Canary is on by default — only send the flag when explicitly disabled.
    if (opts.canary === false) body.canary = false;
    if (opts.graphify) body.graphify = opts.graphify;
    if (opts.codeReviewGraph) body.codeReviewGraph = opts.codeReviewGraph;
    if (typeof opts.preflight === 'boolean') body.preflight = opts.preflight;
    if (opts.claudeMdMode) body.claudeMdMode = opts.claudeMdMode;
    if (opts.gradeMode) body.gradeMode = opts.gradeMode;
    // Forward browser-held grader credentials so the run can grade (sb-cli /
    // Modal). Omitted when none are stored.
    const secrets = launchSecrets();
    if (secrets) body.secrets = secrets;
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      const extra = [
        Number.isInteger(opts.reps) ? `${opts.reps} reps` : null,
        Number.isInteger(opts.maxInstances)
          ? `${opts.maxInstances} tests`
          : null,
        Number.isInteger(opts.maxParallel)
          ? `${opts.maxParallel}× parallel`
          : null,
        opts.canary === false ? 'no canary' : null,
      ].filter(Boolean);
      const suffix = extra.length ? ` (${extra.join(', ')})` : '';
      showToast('success', `Launched ${name}${suffix} — pid ${data.pid}`);
      // Surface the new action in the dock immediately (server recorded it on
      // launch), and nudge a results refresh for the run's first rows.
      refreshActions();
      setTimeout(refreshCurrent, 1500);
    } else {
      showToast('danger', `Launch failed: ${data.error || res.statusText}`);
    }
  } catch (err) {
    showToast('danger', `Launch failed: ${err.message}`);
  }
}

// Regrade flows through a dialog so the operator picks the backend (local Docker
// / SWE-bench cloud / Modal); the choice is remembered for next time.
function regradeInstance(name, instanceId) {
  showRegradeDialog(
    {
      title: `Re-grade ${instanceId}`,
      onConfirm: (mode) => doRegrade(name, { instance: instanceId, mode }),
    },
    rerender,
  );
}

// Whole-profile regrade (header "Regrade All"): same backend dialog, then a
// single sequential sweep over every saved diff for the profile.
function regradeAll(name) {
  showRegradeDialog(
    {
      title: `Re-grade all of ${name}`,
      onConfirm: (mode) => doRegrade(name, { mode, sequential: true }),
    },
    rerender,
  );
}

// Per-profile human notes: fetch current notes, open the editor, PUT on save.
async function openNotes(name) {
  let notes = '';
  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(name)}/notes`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) notes = data.notes || '';
  } catch {
    // Open the editor empty; saving will surface any write error.
  }
  showNotesDialog(
    { profile: name, notes, onSave: (text) => saveNotes(name, text) },
    rerender,
  );
}

async function saveNotes(name, text) {
  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(name)}/notes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: text }),
    });
    const data = await res.json().catch(() => ({}));
    showToast(
      res.ok && data.ok ? 'success' : 'danger',
      res.ok && data.ok
        ? 'Notes saved'
        : `Save failed: ${data.error || res.statusText}`,
    );
  } catch (err) {
    showToast('danger', `Save failed: ${err.message}`);
  }
}

// Stop an in-flight regrade sweep (kills the runner tree). Confirmed because it
// abandons in-progress (paid) Modal/Docker evals.
function stopRegradeSweep(name) {
  showConfirm(
    {
      label: 'Stop regrade',
      message: `Stop the in-flight regrade sweep for “${name}”? The instance currently grading is abandoned; rows already graded are kept.`,
      confirmLabel: 'Stop regrade',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          const res = await fetch(
            `/api/profiles/${encodeURIComponent(name)}/regrade/stop`,
            { method: 'POST' },
          );
          const data = await res.json();
          showToast(
            data.ok ? 'success' : 'danger',
            data.ok ? 'Regrade stopped' : `Stop failed: ${data.error}`,
          );
          setTimeout(refreshCurrent, 1200);
        } catch (err) {
          showToast('danger', `Stop failed: ${err.message}`);
        }
      },
    },
    rerender,
  );
}

async function doRegrade(name, { instance, mode, sequential } = {}) {
  try {
    const body = { profile: name, mode };
    if (instance) body.instance = instance;
    if (sequential) body.sequential = true;
    // Cloud (sb-cli) / Modal graders need credentials — forward from the browser.
    const secrets = launchSecrets();
    if (secrets) body.secrets = secrets;
    const res = await fetch('/api/regrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      const what = instance ? instance : `all of ${name}`;
      showToast('success', `Re-grading ${what} via ${mode} — pid ${data.pid}`);
      // Surface the regrade action in the dock now; results land after the eval.
      refreshActions();
      setTimeout(refreshCurrent, 2000);
    } else {
      showToast('danger', `Regrade failed: ${data.error || res.statusText}`);
    }
  } catch (err) {
    showToast('danger', `Regrade failed: ${err.message}`);
  }
}

async function mutateSettingsDir(method, dir) {
  try {
    const res = await fetch('/api/settings/dirs', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      state.view = {
        kind: 'settings',
        data: {
          ...(state.view?.data || {}),
          error: data.error || 'request failed',
        },
      };
    } else {
      state.view = { kind: 'settings', data };
    }
  } catch (err) {
    state.view = {
      kind: 'settings',
      data: { ...(state.view?.data || {}), error: err.message },
    };
  }
  rerender();
}

const addDir = (dir) => mutateSettingsDir('POST', dir);
const removeDir = (dir) => mutateSettingsDir('DELETE', dir);

// Destructive: removing a result dir requires explicit confirmation.
function confirmRemoveDir(dir) {
  showConfirm(
    {
      label: 'Remove directory',
      message: `Stop reading results from “${dir}”? This only removes it from the dashboard config — the files on disk are left untouched.`,
      confirmLabel: 'Remove',
      confirmVariant: 'danger',
      onConfirm: () => removeDir(dir),
    },
    rerender,
  );
}

const browseAdd = () => openFolderPicker({ onPick: addDir }, rerender);
const browseCache = () => openFolderPicker({ onPick: setCache }, rerender);

// Grader credentials live only in the browser; persist + re-render so the
// "Set"/"Not set" status updates. No server round-trip.
function saveGraderSecrets(patch) {
  saveSecrets(patch);
  showToast('success', 'Saved grader credentials (this browser only)');
  rerender();
}
function clearGraderSecret(name) {
  clearSecret(name);
  rerender();
}

// Destructive: stop a profile's active runs (kills the runner trees).
function stopRuns(name) {
  showConfirm(
    {
      label: 'Stop runs',
      message: `Stop all active runs for “${name}”? Running reps are killed immediately.`,
      confirmLabel: 'Stop runs',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          const res = await fetch(
            `/api/profiles/${encodeURIComponent(name)}/stop`,
            { method: 'POST' },
          );
          const data = await res.json();
          showToast(
            data.ok ? 'success' : 'danger',
            data.ok
              ? `Stopped ${data.stopped} run${data.stopped === 1 ? '' : 's'}`
              : `Stop failed: ${data.error}`,
          );
          setTimeout(refreshCurrent, 1200);
        } catch (err) {
          showToast('danger', `Stop failed: ${err.message}`);
        }
      },
    },
    rerender,
  );
}

// Destructive: clear a profile's recorded results + artifacts.
function clearResults(name) {
  showConfirm(
    {
      label: 'Clear results',
      message: `Delete all recorded results for “${name}” (rows + run artifacts)? This cannot be undone.`,
      confirmLabel: 'Clear results',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          const res = await fetch(
            `/api/profiles/${encodeURIComponent(name)}/clear`,
            { method: 'POST' },
          );
          const data = await res.json();
          if (data.ok) {
            showToast('success', `Cleared ${data.removed} result rows`);
            navigate('#/');
          } else {
            showToast('danger', `Clear failed: ${data.error}`);
          }
        } catch (err) {
          showToast('danger', `Clear failed: ${err.message}`);
        }
      },
    },
    rerender,
  );
}

async function setCache(dir) {
  try {
    const res = await fetch('/api/settings/cache-dir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      state.view = {
        kind: 'settings',
        data: {
          ...(state.view?.data || {}),
          error: data.error || 'request failed',
        },
      };
    } else {
      state.view = { kind: 'settings', data };
    }
  } catch (err) {
    state.view = {
      kind: 'settings',
      data: { ...(state.view?.data || {}), error: err.message },
    };
  }
  rerender();
}

window.addEventListener('hashchange', route);
route();
startPolling();
heartbeat();
refreshActions(); // populate the Activity dock on first paint (survives reload)
setInterval(() => {
  if (!document.hidden) heartbeat();
}, 5000);
