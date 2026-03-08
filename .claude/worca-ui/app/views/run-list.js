import { html } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { statusClass, statusIcon } from '../utils/status-badge.js';
import { formatDuration, elapsed } from '../utils/duration.js';

export function runListView(runs, filter, { onSelectRun }) {
  const filtered = runs.filter(r => filter === 'active' ? r.active : !r.active);

  if (filtered.length === 0) {
    return html`<div class="empty-state">
      ${filter === 'active' ? 'No active pipeline runs' : 'No completed runs yet'}
    </div>`;
  }

  return html`
    <div class="run-list">
      ${filtered.map(run => {
        const title = run.work_request?.title || 'Untitled';
        const status = run.active ? 'in_progress' : (run.stage === 'error' ? 'error' : 'completed');
        const duration = run.started_at
          ? formatDuration(elapsed(run.started_at, run.completed_at || null))
          : '';

        return html`
          <div class="run-list-item" @click=${() => onSelectRun(run.id)}>
            <span class="run-list-status ${statusClass(status)}">${unsafeHTML(statusIcon(status))}</span>
            <div class="run-list-info">
              <span class="run-list-title">${title}</span>
              <span class="run-list-meta">${run.stage || 'pending'} \u00B7 ${duration}</span>
            </div>
          </div>
        `;
      })}
    </div>
  `;
}
