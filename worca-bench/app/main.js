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

import { outcomeIcon, profileOutcome, variantFor } from './utils/badge.js';
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
};

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

// Profile names checked for comparison on the dashboard (persists across renders).
const selected = new Set();
function toggleSelect(name) {
  if (selected.has(name)) {
    selected.delete(name);
  } else {
    selected.add(name);
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
    const outcome = agg ? profileOutcome(agg) : null;
    return {
      showBack: true,
      onBack: backToDashboard,
      title: agg
        ? html`<span class="content-header-status">${unsafeHTML(outcomeIcon(outcome, 18))}</span>${agg.name}`
        : 'Profile',
      badge: outcome
        ? html`<sl-badge variant="${variantFor(outcome)}" pill>${outcome}</sl-badge>`
        : null,
      action: agg
        ? html`<button class="action-btn action-btn--primary" @click=${() => runProfile(agg.name)}>Run profile</button>`
        : null,
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
        const names = profiles.map((p) => p.name).join(',');
        navigate(`#/compare?profiles=${encodeURIComponent(names)}`);
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
      ${sidebarView(activeKey, { onNavigate })}
      <main class="main-content">
        ${header}
        ${body}
      </main>
      ${toastView()}
    </div>
  `;
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
        onOpen: (name) =>
          navigate(`#/profile?name=${encodeURIComponent(name)}`),
        onRun: (name) => runProfile(name),
        selected,
        onToggleSelect: toggleSelect,
      });
    case 'detail':
      return profileDetailView(view.data, {
        onRun: (name, opts) => runProfile(name, opts),
      });
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
        onRemoveDir: removeDir,
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
    const data = await getJSON(`/api/profiles/${encodeURIComponent(name)}`);
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

async function route() {
  const { path, params } = parseHash(location.hash);
  state.loading = true;
  state.error = null;
  rerender();
  try {
    const view = await loadView(path, params);
    if (view) state.view = view;
    else state.error = `No such route: ${path}`;
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
    if (!document.hidden) refreshCurrent();
  }, POLL_MS);
}

async function runProfile(name, opts = {}) {
  try {
    const body = { profile: name };
    if (Number.isInteger(opts.reps)) body.reps = opts.reps;
    if (Number.isInteger(opts.maxInstances))
      body.maxInstances = opts.maxInstances;
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
          ? `${opts.maxInstances} instances`
          : null,
      ].filter(Boolean);
      const suffix = extra.length ? ` (${extra.join(', ')})` : '';
      showToast('success', `Launched ${name}${suffix} — pid ${data.pid}`);
      // Nudge a refresh so the run's first results surface without waiting a
      // full poll tick (results land in seconds under mock).
      setTimeout(refreshCurrent, 1500);
    } else {
      showToast('danger', `Launch failed: ${data.error || res.statusText}`);
    }
  } catch (err) {
    showToast('danger', `Launch failed: ${err.message}`);
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

window.addEventListener('hashchange', route);
route();
startPolling();
