import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { statusIcon, resolveStatus } from '../utils/status-badge.js';
import { formatDuration, elapsed, formatTimestamp } from '../utils/duration.js';

const BADGE_VARIANT = {
  completed: 'success',
  in_progress: 'warning',
  error: 'danger',
  interrupted: 'warning',
  pending: 'neutral'
};

function _lastStageEnd(stages) {
  if (!stages) return null;
  let latest = null;
  for (const s of Object.values(stages)) {
    if (s.completed_at && (!latest || s.completed_at > latest)) latest = s.completed_at;
  }
  return latest;
}

/**
 * Shared run card component used in both run-list and dashboard active list.
 * Shows title, overall status icon, duration, and stage badges.
 */
export function runCardView(run, { onClick, beadsCount } = {}) {
  const title = run.work_request?.title || 'Untitled';
  const isActive = run.active;
  const overallStatus = isActive ? 'in_progress' : (run.stage === 'error' ? 'error' : 'completed');
  const endTime = run.completed_at || _lastStageEnd(run.stages);
  const duration = run.started_at && endTime
    ? formatDuration(elapsed(run.started_at, endTime))
    : run.started_at && isActive
      ? formatDuration(elapsed(run.started_at, null))
      : 'N/A';
  const branch = run.branch || run.work_request?.branch || '';
  const stages = run.stages ? Object.entries(run.stages) : [];

  return html`
    <div class="run-card" @click=${onClick ? () => onClick(run.id) : null}>
      <div class="run-card-top">
        <span class="run-card-status">${unsafeHTML(statusIcon(overallStatus, 16))}</span>
        <span class="run-card-title">${title}</span>
      </div>
      ${branch ? html`<div class="run-card-meta"><span class="run-card-meta-item"><span class="meta-label">Branch:</span> ${branch}</span></div>` : nothing}
      <div class="run-card-meta">
        <span class="run-card-meta-item"><span class="meta-label">Started:</span> ${formatTimestamp(run.started_at)}</span>
        <span class="run-card-meta-item"><span class="meta-label">Finished:</span> ${formatTimestamp(endTime)}</span>
        <span class="run-card-meta-item"><span class="meta-label">Duration:</span> ${duration}</span>
      </div>
      ${stages.length > 0 ? html`
        <div class="run-card-stages">
          ${stages.map(([key, stage]) => {
            const status = resolveStatus(stage.status || 'pending', isActive);
            const variant = BADGE_VARIANT[status] || 'neutral';
            const label = key.replace(/_/g, ' ').toUpperCase();
            return html`<sl-badge variant="${variant}" pill class="run-card-stage-badge">${label}</sl-badge>`;
          })}
          ${beadsCount > 0 ? html`<sl-badge variant="primary" pill class="run-card-stage-badge">${beadsCount} bead${beadsCount !== 1 ? 's' : ''}</sl-badge>` : nothing}
        </div>
      ` : beadsCount > 0 ? html`
        <div class="run-card-stages">
          <sl-badge variant="primary" pill class="run-card-stage-badge">${beadsCount} bead${beadsCount !== 1 ? 's' : ''}</sl-badge>
        </div>
      ` : nothing}
    </div>
  `;
}
