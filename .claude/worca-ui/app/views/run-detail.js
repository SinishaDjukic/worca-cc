import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { stageTimelineView } from './stage-timeline.js';
import { statusClass, statusIcon, resolveStatus } from '../utils/status-badge.js';
import { formatDuration, elapsed, formatTimestamp } from '../utils/duration.js';

function _lastStageEnd(stages) {
  if (!stages) return null;
  let latest = null;
  for (const s of Object.values(stages)) {
    if (s.completed_at && (!latest || s.completed_at > latest)) latest = s.completed_at;
  }
  return latest;
}

function _badgeVariant(status) {
  if (status === 'completed') return 'success';
  if (status === 'error') return 'danger';
  if (status === 'in_progress' || status === 'interrupted') return 'warning';
  return 'neutral';
}

function _iterStatusIcon(iter) {
  const s = iter.status || 'pending';
  if (s === 'completed' && iter.outcome === 'success') return html`<span class="iter-status-icon success">${unsafeHTML(statusIcon('completed', 12))}</span>`;
  if (s === 'completed') return html`<span class="iter-status-icon">${unsafeHTML(statusIcon('completed', 12))}</span>`;
  if (s === 'error') return html`<span class="iter-status-icon failure">${unsafeHTML(statusIcon('error', 12))}</span>`;
  if (s === 'in_progress') return html`<span class="iter-status-icon in-progress">${unsafeHTML(statusIcon('in_progress', 12))}</span>`;
  return nothing;
}

function _triggerLabel(trigger) {
  if (!trigger) return nothing;
  const labels = {
    initial: 'Initial run',
    test_failure: 'Test failure',
    review_changes: 'Review changes',
    restart_planning: 'Restart planning',
  };
  return html`<span class="iteration-trigger">${labels[trigger] || trigger}</span>`;
}

function _outcomeLabel(outcome) {
  if (!outcome) return nothing;
  const cls = outcome === 'success' ? 'success' : 'failure';
  return html`<span class="iteration-outcome ${cls}">${outcome.replace(/_/g, ' ')}</span>`;
}

function _iterationDetailView(iter, agents, stageKey) {
  const agent = agents[stageKey] || null;
  const dur = iter.started_at
    ? formatDuration(elapsed(iter.started_at, iter.completed_at || null))
    : '';
  return html`
    <div class="iteration-detail">
      ${iter.trigger ? html`<div class="detail-row"><span class="detail-label">Trigger:</span> ${_triggerLabel(iter.trigger)}</div>` : nothing}
      ${iter.started_at ? html`<div class="detail-row"><span class="detail-label">Started:</span> ${formatTimestamp(iter.started_at)}</div>` : nothing}
      ${iter.completed_at ? html`<div class="detail-row"><span class="detail-label">Completed:</span> ${formatTimestamp(iter.completed_at)}</div>` : nothing}
      ${dur ? html`<div class="detail-row"><span class="detail-label">Duration:</span> ${dur}</div>` : nothing}
      ${agent ? html`<div class="detail-row"><span class="detail-label">Agent:</span> ${stageKey} (${iter.model || agent.model})</div>` : nothing}
      ${iter.turns ? html`<div class="detail-row"><span class="detail-label">Turns:</span> ${iter.turns}</div>` : nothing}
      ${iter.cost_usd != null ? html`<div class="detail-row"><span class="detail-label">Cost:</span> $${Number(iter.cost_usd).toFixed(2)}</div>` : nothing}
      ${iter.outcome ? html`<div class="detail-row"><span class="detail-label">Outcome:</span> ${_outcomeLabel(iter.outcome)}</div>` : nothing}
    </div>
  `;
}

export function runDetailView(run, settings = {}) {
  if (!run) {
    return html`<div class="empty-state">Select a run to view details</div>`;
  }

  const branch = run.branch || run.work_request?.branch || '';
  const pr = run.pr_url || null;
  // Use completed_at if set; for non-active runs without it, freeze at last stage completion
  const endTime = run.completed_at
    || (!run.active ? _lastStageEnd(run.stages) : null);
  const duration = run.started_at
    ? formatDuration(elapsed(run.started_at, endTime))
    : 'N/A';
  const stages = run.stages || {};
  const stageUi = settings.stageUi || {};
  const agents = settings.agents || {};

  return html`
    <div class="run-detail">
      <div class="run-header">
        <div class="run-header-left">
          <sl-badge variant="${run.active ? 'warning' : 'success'}" pill>
            ${unsafeHTML(statusIcon(run.active ? 'in_progress' : 'completed', 12))}
            ${run.active ? 'Running' : 'Completed'}
          </sl-badge>
          ${pr ? html`<a class="run-meta run-pr-link" href="${pr}" target="_blank">View PR</a>` : nothing}
        </div>
      </div>
      <div class="run-meta-grid">
        <span class="run-meta-item"><span class="meta-label">Branch:</span> ${branch || 'N/A'}</span>
        <span class="run-meta-item"><span class="meta-label">Started:</span> ${formatTimestamp(run.started_at)}</span>
        <span class="run-meta-item"><span class="meta-label">Finished:</span> ${formatTimestamp(run.completed_at)}</span>
        <span class="run-meta-item"><span class="meta-label">Duration:</span> ${duration}</span>
      </div>

      ${stageTimelineView(stages, stageUi, run.active)}

      <div class="stage-panels">
        ${Object.entries(stages).map(([key, stage]) => {
          const label = stageUi[key]?.label || key.replace(/_/g, ' ').toUpperCase();
          const stageStatus = resolveStatus(stage.status || 'pending', run.active);
          const agentKey = Object.keys(agents).find(a => a === key) || null;
          const agent = agentKey ? agents[agentKey] : null;
          const stageDuration = stage.started_at
            ? formatDuration(elapsed(stage.started_at, stage.completed_at || null))
            : '';
          const iterations = stage.iterations || [];
          const hasMultipleIterations = iterations.length > 1;

          return html`
            <sl-details ?open=${stageStatus === 'in_progress'} class="stage-panel">
              <div slot="summary" class="stage-panel-header">
                <span class="stage-panel-icon ${statusClass(stageStatus)}">${unsafeHTML(statusIcon(stageStatus))}</span>
                <span class="stage-panel-label">${label}</span>
                <sl-badge variant="${_badgeVariant(stageStatus)}" pill>
                  ${stageStatus.replace(/_/g, ' ')}
                </sl-badge>
                ${hasMultipleIterations ? html`
                  <span class="stage-panel-meta">
                    <span class="stage-meta-item stage-meta-iteration">${iterations.length} iterations</span>
                    ${stageDuration ? html`<span class="stage-meta-item">${stageDuration}</span>` : nothing}
                  </span>
                ` : nothing}
              </div>
              ${hasMultipleIterations ? html`
                <sl-tab-group>
                  ${iterations.map(iter => html`
                    <sl-tab slot="nav" panel="iter-${iter.number}">
                      Iter ${iter.number} ${_iterStatusIcon(iter)}
                    </sl-tab>
                  `)}
                  ${iterations.map(iter => html`
                    <sl-tab-panel name="iter-${iter.number}">
                      ${_iterationDetailView(iter, agents, key)}
                    </sl-tab-panel>
                  `)}
                </sl-tab-group>
              ` : html`
                <div class="stage-detail">
                  ${stage.started_at ? html`<div class="detail-row"><span class="detail-label">Started:</span> ${formatTimestamp(stage.started_at)}</div>` : nothing}
                  ${stage.completed_at ? html`<div class="detail-row"><span class="detail-label">Completed:</span> ${formatTimestamp(stage.completed_at)}</div>` : nothing}
                  ${stageDuration ? html`<div class="detail-row"><span class="detail-label">Duration:</span> ${stageDuration}</div>` : nothing}
                  ${agent ? html`<div class="detail-row"><span class="detail-label">Agent:</span> ${agentKey} (${agent.model})</div>` : nothing}
                  ${iterations.length === 1 && iterations[0].trigger ? html`<div class="detail-row"><span class="detail-label">Trigger:</span> ${_triggerLabel(iterations[0].trigger)}</div>` : nothing}
                  ${iterations.length === 1 && iterations[0].turns ? html`<div class="detail-row"><span class="detail-label">Turns:</span> ${iterations[0].turns}</div>` : nothing}
                  ${iterations.length === 1 && iterations[0].cost_usd != null ? html`<div class="detail-row"><span class="detail-label">Cost:</span> $${Number(iterations[0].cost_usd).toFixed(2)}</div>` : nothing}
                  ${iterations.length === 1 && iterations[0].outcome ? html`<div class="detail-row"><span class="detail-label">Outcome:</span> ${_outcomeLabel(iterations[0].outcome)}</div>` : nothing}
                  ${stage.task_progress ? html`<div class="detail-row"><span class="detail-label">Progress:</span> ${stage.task_progress}</div>` : nothing}
                  ${stage.error ? html`<div class="detail-row detail-error"><span class="detail-label">Error:</span> ${stage.error}</div>` : nothing}
                </div>
              `}
            </sl-details>
          `;
        })}
      </div>
    </div>
  `;
}
