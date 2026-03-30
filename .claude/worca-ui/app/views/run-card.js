import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { elapsed, formatDuration, formatTimestamp } from '../utils/duration.js';
import { iconSvg, Pause } from '../utils/icons.js';
import {
  resolveStatus,
  statusClass,
  statusIcon,
} from '../utils/status-badge.js';

/** Canonical pipeline stage order — stages not listed sort to the end. */
const STAGE_ORDER = [
  'preflight',
  'plan',
  'plan_review',
  'coordinate',
  'implement',
  'test',
  'review',
  'pr',
  'learn',
];

function _sortedEntries(stages) {
  const entries = Object.entries(stages);
  return entries.sort(([a], [b]) => {
    const ai = STAGE_ORDER.indexOf(a);
    const bi = STAGE_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

const BADGE_VARIANT = {
  completed: 'success',
  in_progress: 'warning',
  error: 'danger',
  interrupted: 'warning',
  pending: 'neutral',
};

function _statusTooltip(run, status) {
  const ref =
    run.status_changed_at ||
    (status === 'completed' || status === 'failed' ? run.completed_at : null) ||
    run.started_at;
  if (!ref) return null;
  const ms = elapsed(ref, null);
  const dur = formatDuration(ms);
  if (status === 'running' || status === 'resuming')
    return `Running for ${dur}`;
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return `${label} ${dur} ago`;
}

function _lastStageEnd(stages) {
  if (!stages) return null;
  let latest = null;
  for (const s of Object.values(stages)) {
    if (s.completed_at && (!latest || s.completed_at > latest))
      latest = s.completed_at;
  }
  return latest;
}

function _runCost(run) {
  let total = 0;
  for (const stage of Object.values(run.stages || {})) {
    for (const iter of stage.iterations || []) {
      total += iter.cost_usd || 0;
    }
  }
  return total;
}

function _formatCost(usd) {
  if (usd === 0) return null;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Shared run card component used in both run-list and dashboard active list.
 * Shows title, overall status icon, duration, and stage badges.
 */
export function runCardView(
  run,
  { onClick, beadsCount, onPause, onResume } = {},
) {
  const title = run.work_request?.title || 'Untitled';
  const isActive = run.active;
  const overallStatus =
    run.pipeline_status ||
    (isActive ? 'running' : run.stage === 'error' ? 'failed' : 'completed');
  const tooltip = _statusTooltip(run, overallStatus);
  const endTime = run.completed_at || _lastStageEnd(run.stages);
  const duration =
    run.started_at && endTime
      ? formatDuration(elapsed(run.started_at, endTime))
      : run.started_at && isActive
        ? formatDuration(elapsed(run.started_at, null))
        : 'N/A';
  const branch = run.branch || run.work_request?.branch || '';
  const stages = run.stages ? _sortedEntries(run.stages) : [];
  const cost = _runCost(run);

  const pauseBtn =
    onPause && (overallStatus === 'running' || overallStatus === 'resuming')
      ? html`
        <div class="run-card-actions">
          <sl-button size="small" variant="warning" outline class="btn-quick-pause" @click=${(
            e,
          ) => {
            e.stopPropagation();
            onPause(run.id);
          }}>
            ${unsafeHTML(iconSvg(Pause, 12))} Pause
          </sl-button>
        </div>
      `
      : nothing;

  const resumeBtn =
    onResume && (overallStatus === 'paused' || overallStatus === 'failed')
      ? html`
        <div class="run-card-actions">
          <button class="btn-quick-resume" @click=${(e) => {
            e.stopPropagation();
            onResume(run.id);
          }}>
            Resume
          </button>
        </div>
      `
      : nothing;

  return html`
    <div class="run-card ${statusClass(overallStatus)}" @click=${onClick ? () => onClick(run.id) : null}>
      <div class="run-card-top">
        ${
          tooltip
            ? html`<span class="run-card-status" title=${tooltip}>${unsafeHTML(statusIcon(overallStatus, 16))}</span>`
            : html`<span class="run-card-status">${unsafeHTML(statusIcon(overallStatus, 16))}</span>`
        }
        <span class="run-card-title">${title}</span>
      </div>
      ${branch ? html`<div class="run-card-meta"><span class="run-card-meta-item"><span class="meta-label">Branch:</span> <span class="meta-value">${branch}</span></span></div>` : nothing}
      <div class="run-card-meta">
        <span class="run-card-meta-item"><span class="meta-label">Started:</span> <span class="meta-value">${formatTimestamp(run.started_at)}</span></span>
        <span class="run-card-meta-item"><span class="meta-label">Finished:</span> <span class="meta-value">${formatTimestamp(endTime)}</span></span>
        <span class="run-card-meta-item"><span class="meta-label">Duration:</span> <span class="meta-value">${duration}</span></span>
        ${_formatCost(cost) ? html`<span class="run-card-meta-item"><span class="meta-label">Cost:</span> <span class="meta-value">${_formatCost(cost)}</span></span>` : nothing}
      </div>
      ${
        stages.length > 0
          ? html`
        <div class="run-card-stages">
          ${stages.map(([key, stage]) => {
            const status = resolveStatus(stage.status || 'pending', isActive);
            const variant = BADGE_VARIANT[status] || 'neutral';
            const label = key.replace(/_/g, ' ').toUpperCase();
            return html`<sl-badge variant="${variant}" pill class="run-card-stage-badge">${label}</sl-badge>`;
          })}
          ${beadsCount > 0 ? html`<sl-badge variant="primary" pill class="run-card-stage-badge">${beadsCount} bead${beadsCount !== 1 ? 's' : ''}</sl-badge>` : nothing}
        </div>
      `
          : beadsCount > 0
            ? html`
        <div class="run-card-stages">
          <sl-badge variant="primary" pill class="run-card-stage-badge">${beadsCount} bead${beadsCount !== 1 ? 's' : ''}</sl-badge>
        </div>
      `
            : nothing
      }
      ${pauseBtn}
      ${resumeBtn}
    </div>
  `;
}
