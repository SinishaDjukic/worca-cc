import { html } from 'lit-html';
import { sortByStartDesc } from '../utils/sort-runs.js';
import { runCardView } from './run-card.js';

const HISTORY_STATUSES = ['all', 'running', 'completed', 'failed', 'paused', 'error'];

export function runListView(
  runs,
  filter,
  { onSelectRun, onPause, onResume, statusFilter, onStatusFilter } = {},
) {
  const baseFiltered = filter === 'active'
    ? runs.filter((r) => r.active)
    : runs;

  const showStatusChips = filter === 'history' && onStatusFilter;

  // Compute counts per status for chips
  let statusCounts = {};
  if (showStatusChips) {
    statusCounts = { all: baseFiltered.length };
    for (const r of baseFiltered) {
      const ps = r.pipeline_status || 'completed';
      statusCounts[ps] = (statusCounts[ps] || 0) + 1;
    }
  }

  // Apply status filter
  let displayed = baseFiltered;
  if (showStatusChips && statusFilter && statusFilter !== 'all') {
    displayed = displayed.filter(
      (r) => (r.pipeline_status || 'completed') === statusFilter,
    );
  }
  displayed = sortByStartDesc(displayed);

  if (baseFiltered.length === 0) {
    return html`<div class="empty-state">
      ${filter === 'active' ? 'No running pipelines' : 'No completed runs yet'}
    </div>`;
  }

  return html`
    ${showStatusChips ? html`
      <div class="filter-chips">
        ${HISTORY_STATUSES.filter((s) => s === 'all' || statusCounts[s]).map(
          (s) => html`
          <button
            class="filter-chip ${(statusFilter || 'all') === s ? 'active' : ''} filter-chip-${s}"
            @click=${() => onStatusFilter(s)}
          >
            ${s === 'all' ? 'All' : s}
            <span class="chip-count">${statusCounts[s] || 0}</span>
          </button>
        `)}
      </div>
    ` : ''}
    ${displayed.length === 0 ? html`
      <div class="empty-state">No ${statusFilter} runs</div>
    ` : html`
      <div class="run-list">
        ${displayed.map((run) => runCardView(run, { onClick: onSelectRun, onPause, onResume }))}
      </div>
    `}
  `;
}
