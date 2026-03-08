import { html, nothing } from 'lit-html';
import { stageTimelineView } from './stage-timeline.js';
import { statusClass, statusIcon } from '../utils/status-badge.js';
import { formatDuration, elapsed } from '../utils/duration.js';

export function runDetailView(run, settings = {}) {
  if (!run) {
    return html`<div class="empty-state">Select a run to view details</div>`;
  }

  const title = run.work_request?.title || 'Untitled Run';
  const branch = run.work_request?.branch || '';
  const pr = run.pr_url || null;
  const duration = run.started_at
    ? formatDuration(elapsed(run.started_at, run.completed_at || null))
    : '';
  const stages = run.stages || {};
  const stageUi = settings.stageUi || {};
  const milestones = settings.milestones || {};
  const agents = settings.agents || {};

  return html`
    <div class="run-detail">
      <div class="run-header">
        <div class="run-header-left">
          <h2 class="run-title">${title}</h2>
          <span class="status-badge ${statusClass(run.active ? 'in_progress' : 'completed')}">
            ${statusIcon(run.active ? 'in_progress' : 'completed')}
            ${run.active ? 'Running' : 'Completed'}
          </span>
        </div>
        <div class="run-header-right">
          ${branch ? html`<span class="run-meta"><span class="meta-label">Branch:</span> ${branch}</span>` : nothing}
          ${duration ? html`<span class="run-meta"><span class="meta-label">Duration:</span> ${duration}</span>` : nothing}
          ${pr ? html`<a class="run-meta run-pr-link" href="${pr}" target="_blank">View PR</a>` : nothing}
        </div>
      </div>

      ${stageTimelineView(stages, stageUi, milestones)}

      <div class="stage-panels">
        ${Object.entries(stages).map(([key, stage]) => {
          const label = stageUi[key]?.label || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const stageStatus = stage.status || 'pending';
          const agentKey = Object.keys(agents).find(a => a === key) || null;
          const agent = agentKey ? agents[agentKey] : null;
          const stageDuration = stage.started_at
            ? formatDuration(elapsed(stage.started_at, stage.completed_at || null))
            : '';

          return html`
            <details class="stage-panel" ?open=${stageStatus === 'in_progress'}>
              <summary class="stage-panel-header">
                <span class="stage-panel-icon ${statusClass(stageStatus)}">${statusIcon(stageStatus)}</span>
                <span class="stage-panel-label">${label}</span>
                <span class="stage-panel-status">${stageStatus.replace(/_/g, ' ')}</span>
              </summary>
              <div class="stage-detail">
                ${stage.started_at ? html`<div class="detail-row"><span class="detail-label">Started:</span> ${new Date(stage.started_at).toLocaleTimeString()}</div>` : nothing}
                ${stage.completed_at ? html`<div class="detail-row"><span class="detail-label">Completed:</span> ${new Date(stage.completed_at).toLocaleTimeString()}</div>` : nothing}
                ${stageDuration ? html`<div class="detail-row"><span class="detail-label">Duration:</span> ${stageDuration}</div>` : nothing}
                ${agent ? html`<div class="detail-row"><span class="detail-label">Agent:</span> ${agentKey} (${agent.model})</div>` : nothing}
                ${stage.iteration > 1 ? html`<div class="detail-row"><span class="detail-label">Iteration:</span> ${stage.iteration}</div>` : nothing}
                ${stage.task_progress ? html`<div class="detail-row"><span class="detail-label">Progress:</span> ${stage.task_progress}</div>` : nothing}
                ${stage.error ? html`<div class="detail-row detail-error"><span class="detail-label">Error:</span> ${stage.error}</div>` : nothing}
              </div>
            </details>
          `;
        })}
      </div>
    </div>
  `;
}
