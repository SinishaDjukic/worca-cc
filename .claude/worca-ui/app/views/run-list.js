import { html } from 'lit-html';
import { runCardView } from './run-card.js';
import { sortByStartDesc } from '../utils/sort-runs.js';

export function runListView(runs, filter, { onSelectRun, onPause, onResume } = {}) {
  const filtered = sortByStartDesc(runs.filter(r => filter === 'active' ? r.active : !r.active));

  if (filtered.length === 0) {
    return html`<div class="empty-state">
      ${filter === 'active' ? 'No running pipelines' : 'No completed runs yet'}
    </div>`;
  }

  return html`
    <div class="run-list">
      ${filtered.map(run => runCardView(run, { onClick: onSelectRun, onPause, onResume }))}
    </div>
  `;
}
