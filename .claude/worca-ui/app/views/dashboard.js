import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { iconSvg, Activity, CircleCheck, CircleAlert, Zap, Plus, Coins } from '../utils/icons.js';
import { runCardView } from './run-card.js';
import { sortByStartDesc } from '../utils/sort-runs.js';

function _computeTotalCost(runs) {
  let total = 0;
  for (const run of runs) {
    for (const stage of Object.values(run.stages || {})) {
      for (const iter of stage.iterations || []) {
        total += iter.cost_usd || 0;
      }
    }
  }
  return total;
}

function _formatCost(usd) {
  if (usd == null || usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function _activeGroup(runs, statuses) {
  return runs.filter(r => statuses.includes(r.pipeline_status));
}

export function dashboardView(state, { onSelectRun, onNavigate, onPause, onResume } = {}) {
  const runs = Object.values(state.runs);
  const active = runs.filter(r => r.active);
  const completed = runs.filter(r => !r.active);
  const errored = runs.filter(r => {
    const stages = r.stages ? Object.values(r.stages) : [];
    return stages.some(s => s.status === 'error');
  });
  const total = runs.length;
  const totalCost = _computeTotalCost(runs);

  const runningGroup = sortByStartDesc(_activeGroup(runs, ['running', 'resuming']));
  const pausedGroup = sortByStartDesc(_activeGroup(runs, ['paused']));
  const failedGroup = sortByStartDesc(_activeGroup(runs, ['failed']));

  return html`
    <div class="dashboard">
      <div class="dashboard-stats">
        <div class="stat-card stat-total">
          <div class="stat-icon-ring">${unsafeHTML(iconSvg(Zap, 20))}</div>
          <div class="stat-body">
            <span class="stat-number">${total}</span>
            <span class="stat-label">Total Runs</span>
          </div>
        </div>
        <div class="stat-card stat-active">
          <div class="stat-icon-ring">${unsafeHTML(iconSvg(Activity, 20))}</div>
          <div class="stat-body">
            <span class="stat-number">${active.length}</span>
            <span class="stat-label">Active</span>
          </div>
        </div>
        <div class="stat-card stat-completed">
          <div class="stat-icon-ring">${unsafeHTML(iconSvg(CircleCheck, 20))}</div>
          <div class="stat-body">
            <span class="stat-number">${completed.length}</span>
            <span class="stat-label">Completed</span>
          </div>
        </div>
        <div class="stat-card stat-errors">
          <div class="stat-icon-ring">${unsafeHTML(iconSvg(CircleAlert, 20))}</div>
          <div class="stat-body">
            <span class="stat-number">${errored.length}</span>
            <span class="stat-label">Errors</span>
          </div>
        </div>
        <div class="stat-card stat-cost-total" style="cursor:pointer" @click=${() => onNavigate && onNavigate('costs')}>
          <div class="stat-icon-ring">${unsafeHTML(iconSvg(Coins, 20))}</div>
          <div class="stat-body">
            <span class="stat-number">${_formatCost(totalCost)}</span>
            <span class="stat-label">Total Cost</span>
          </div>
        </div>
      </div>

      <div class="dashboard-actions">
        <sl-button variant="primary" @click=${() => onNavigate && onNavigate('new-run')}>
          ${unsafeHTML(iconSvg(Plus, 16))}
          New Pipeline
        </sl-button>
      </div>

      <h3 class="dashboard-section-title">Active Runs</h3>
      ${runningGroup.length > 0 ? html`
        <div class="active-group active-group-running">
          <div class="active-group-header">
            <span class="active-group-count">${runningGroup.length} running</span>
          </div>
          <div class="run-list">
            ${runningGroup.map(run => runCardView(run, { onClick: onSelectRun, onPause }))}
          </div>
        </div>
      ` : nothing}
      ${pausedGroup.length > 0 ? html`
        <div class="active-group active-group-paused">
          <div class="active-group-header">
            <span class="active-group-count">${pausedGroup.length} paused</span>
          </div>
          <div class="run-list">
            ${pausedGroup.map(run => runCardView(run, { onClick: onSelectRun, onResume }))}
          </div>
        </div>
      ` : nothing}
      ${failedGroup.length > 0 ? html`
        <div class="active-group active-group-failed">
          <div class="active-group-header">
            <span class="active-group-count">${failedGroup.length} failed</span>
          </div>
          <div class="run-list">
            ${failedGroup.map(run => runCardView(run, { onClick: onSelectRun, onResume }))}
          </div>
        </div>
      ` : nothing}
      ${runningGroup.length === 0 && pausedGroup.length === 0 && failedGroup.length === 0 ? html`
        <div class="empty-state">No running pipelines</div>
      ` : nothing}
    </div>
  `;
}
