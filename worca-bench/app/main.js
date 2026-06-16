// app/main.js — worca-bench dashboard entry point.
//
// Hash-router dispatch (#/, #/profile?name=X, #/compare, #/leaderboard),
// data fetch, and lit-html render. Mirrors worca-ui's functional-template
// approach: views are pure functions of data; main.js owns fetch + routing.

import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
import { html, render } from 'lit-html';

import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

import { compareView } from './views/compare.js';
import { leaderboardView } from './views/leaderboard.js';
import { profileDetailView } from './views/profile-detail.js';
import { dashboardView } from './views/profile-list.js';

// Shoelace ships its icon assets relative to a base path; point it at the
// bundled copy location (we don't use sl-icon, but the lib still resolves it).
setBasePath('/vendor');

const root = document.getElementById('app');

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
};

function loadingView() {
  return html`<section class="page loading-state"><sl-spinner></sl-spinner> <span>Loading…</span></section>`;
}

function errorView(message) {
  return html`<section class="page"><p class="error-state">Error: ${message}</p></section>`;
}

function headerView(activePath) {
  const link = (hash, label, key) => html`<a
    class="nav-link ${activePath === key ? 'nav-link--active' : ''}"
    href=${hash}
  >${label}</a>`;
  return html`
    <header class="app-header">
      <div class="app-brand"><span class="app-logo">⬡</span> worca-bench</div>
      <nav class="app-nav">
        ${link('#/', 'Dashboard', '/')}
        ${link('#/compare', 'Compare', '/compare')}
        ${link('#/leaderboard', 'Leaderboard', '/leaderboard')}
      </nav>
    </header>
  `;
}

function shell(activePath, body) {
  return html`${headerView(activePath)}<main class="app-main">${body}</main>`;
}

// ─── Render ─────────────────────────────────────────────────────────────

function rerender() {
  const { path } = parseHash(location.hash);
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
  render(shell(path, body), root);
}

function renderView(view) {
  switch (view.kind) {
    case 'dashboard':
      return dashboardView(view.data, {
        onOpen: (name) =>
          navigate(`#/profile?name=${encodeURIComponent(name)}`),
        onRun: (name) => runProfile(name),
        onCompare: () => {
          const names = view.data.map((p) => p.name).join(',');
          navigate(`#/compare?profiles=${encodeURIComponent(names)}`);
        },
      });
    case 'detail':
      return profileDetailView(view.data, {
        onBack: () => navigate('#/'),
        onRun: (name) => runProfile(name),
      });
    case 'compare':
      return compareView(view.data, { onBack: () => navigate('#/') });
    case 'leaderboard':
      return leaderboardView(view.data, {
        onBack: () => navigate('#/'),
        onSelectBenchmark: (b) =>
          navigate(`#/leaderboard?benchmark=${encodeURIComponent(b)}`),
      });
    default:
      return errorView('Unknown view');
  }
}

// ─── Route handlers ─────────────────────────────────────────────────────

async function route() {
  const { path, params } = parseHash(location.hash);
  state.loading = true;
  state.error = null;
  rerender();
  try {
    if (path === '/' || path === '') {
      const { profiles } = await getJSON('/api/profiles');
      state.view = { kind: 'dashboard', data: profiles };
    } else if (path === '/profile') {
      const name = params.get('name');
      const data = await getJSON(`/api/profiles/${encodeURIComponent(name)}`);
      state.view = { kind: 'detail', data };
    } else if (path === '/compare') {
      const profiles = params.get('profiles') || '';
      const { compare } = await getJSON(
        `/api/compare?profiles=${encodeURIComponent(profiles)}`,
      );
      state.view = { kind: 'compare', data: compare };
    } else if (path === '/leaderboard') {
      const benchmark = params.get('benchmark') || 'swe-bench-verified';
      const data = await getJSON(
        `/api/leaderboard?benchmark=${encodeURIComponent(benchmark)}`,
      );
      state.view = { kind: 'leaderboard', data };
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

async function runProfile(name) {
  try {
    await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: name }),
    });
  } catch {
    // Fire-and-forget; surface nothing beyond console for now.
  }
}

window.addEventListener('hashchange', route);
route();
