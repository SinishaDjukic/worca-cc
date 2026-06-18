import { html, nothing } from 'lit-html';
import { profileCardView } from './profile-card.js';

/** Does a profile match the free-text search (name / benchmark / template / ref)? */
function _matchesSearch(p, q) {
  if (!q) return true;
  const hay =
    `${p.name} ${p.benchmark || ''} ${p.template || ''} ${p.worca_ref || ''}`.toLowerCase();
  return hay.includes(q);
}

/** Apply the visibility filter (all | active | archived) to a profile. */
function _matchesFilter(p, filter) {
  if (filter === 'archived') return !!p.archived;
  if (filter === 'all') return true;
  return !p.archived; // 'active' (default): non-archived only
}

/**
 * Filter toggle + search, mirroring worca-ui's history page: a row of
 * mutually-exclusive pills (with counts) over a free-text filter box.
 */
function _filterBarView(profiles, { filter, search, onFilter, onSearch }) {
  const counts = {
    all: profiles.length,
    active: profiles.filter((p) => !p.archived).length,
    archived: profiles.filter((p) => p.archived).length,
  };
  const pill = (key, label) => html`<button
    class="filter-pill ${filter === key ? 'filter-pill--active' : ''}"
    @click=${() => onFilter(key)}
  >${label} <span class="filter-pill-count">${counts[key]}</span></button>`;

  return html`
    <div class="profile-filter">
      <div class="filter-pills">
        ${pill('all', 'All')}
        ${pill('active', 'Active')}
        ${pill('archived', 'Archived')}
      </div>
      <input
        class="filter-search"
        type="search"
        placeholder="Filter by name, benchmark, or template…"
        .value=${search || ''}
        @input=${(e) => onSearch(e.target.value)}
      />
    </div>
  `;
}

/**
 * Dashboard landing view: a filter bar + a grid of profile cards.
 *
 * @param {object[]} profiles  aggregate summaries (each tagged `.archived`)
 * @param {object} [handlers]  forwarded to each profile card, plus the filter
 *   state/handlers: `{ filter, search, onFilter, onSearch }`.
 */
export function profileListView(profiles, handlers = {}) {
  const all = profiles || [];
  const { filter = 'active', search = '', onFilter, onSearch } = handlers;
  const q = (search || '').trim().toLowerCase();

  const bar =
    onFilter && onSearch
      ? _filterBarView(all, { filter, search, onFilter, onSearch })
      : nothing;

  if (all.length === 0) {
    return html`
      ${bar}
      <div class="empty-state">
        <p>No benchmark results yet.</p>
        <p class="empty-state-hint">Run a profile to populate <code>results.jsonl</code> in the target directory.</p>
      </div>
    `;
  }

  const shown = all.filter(
    (p) => _matchesFilter(p, filter) && _matchesSearch(p, q),
  );

  // Show the source dir only when a profile name appears in >1 result dir,
  // so the duplicates are distinguishable without cluttering the common case.
  const dupCounts = new Map();
  for (const p of all) dupCounts.set(p.name, (dupCounts.get(p.name) || 0) + 1);

  return html`
    ${bar}
    ${
      shown.length === 0
        ? html`<div class="empty-state"><p>No profiles match.</p>
            <p class="empty-state-hint">${
              filter === 'archived'
                ? 'No archived profiles.'
                : 'Try a different filter or search.'
            }</p></div>`
        : html`<div class="profile-grid">
            ${shown.map((p) =>
              profileCardView(p, {
                ...handlers,
                showSource: dupCounts.get(p.name) > 1,
              }),
            )}
          </div>`
    }
  `;
}

/**
 * The dashboard body — the filter bar + profile card grid. The page title and
 * the header actions (Compare / Archive) live in main.js's content header.
 *
 * @param {object[]} profiles
 * @param {object} [handlers]  forwarded to each profile card (onOpen, onRun) +
 *   filter state/handlers (filter, search, onFilter, onSearch).
 */
export function dashboardView(profiles, handlers = {}) {
  return html`<section class="page">${profileListView(profiles, handlers)}</section>`;
}
