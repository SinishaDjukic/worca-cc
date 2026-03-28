import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import {
  Activity,
  CircleAlert,
  CircleCheck,
  Coins,
  iconSvg,
  Plus,
  Zap,
} from '../utils/icons.js';
import { sortByStartDesc } from '../utils/sort-runs.js';
import { runCardView } from './run-card.js';

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
  return runs.filter((r) => statuses.includes(r.pipeline_status));
}

function _projectCards(projects, runs, onNavigate) {
  // Count active runs per project (best-effort by projectId on run)
  const activeByProject = {};
  const latestByProject = {};
  for (const proj of projects) {
    activeByProject[proj.name] = 0;
    latestByProject[proj.name] = null;
  }
  for (const run of runs) {
    const pid = run.projectId || projects[0]?.name;
    if (pid && activeByProject[pid] !== undefined) {
      if (run.active) activeByProject[pid]++;
      if (
        !latestByProject[pid] ||
        (run.started_at || '') > (latestByProject[pid].started_at || '')
      ) {
        latestByProject[pid] = run;
      }
    }
  }

  return html`
    <div class="project-cards">
      ${projects.map((p) => {
        const activeCount = activeByProject[p.name] || 0;
        const latest = latestByProject[p.name];
        const statusText = latest
          ? latest.pipeline_status || 'unknown'
          : 'no runs';
        return html`
          <div class="project-card" @click=${() => onNavigate?.('active', null, p.name)}>
            <div class="project-card-name">${p.name}</div>
            <div class="project-card-stats">
              ${activeCount} active &middot; ${statusText}
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

export function dashboardView(
  state,
  { onSelectRun, onNavigate, onPause, onResume } = {},
) {
  const runs = Object.values(state.runs);
  const active = runs.filter((r) => r.active);
  const completed = runs.filter((r) => !r.active);
  const errored = runs.filter((r) => {
    const stages = r.stages ? Object.values(r.stages) : [];
    return stages.some((s) => s.status === 'error');
  });
  const total = runs.length;
  const totalCost = _computeTotalCost(runs);

  const runningGroup = sortByStartDesc(
    _activeGroup(active, ['running', 'resuming']),
  );
  const pausedGroup = sortByStartDesc(_activeGroup(runs, ['paused']));
  const failedGroup = sortByStartDesc(_activeGroup(runs, ['failed']));

  const projects = state.projects || [];
  const currentProjectId = state.currentProjectId;
  const showProjectCards = projects.length > 1 && !currentProjectId;

  return html`
    <div class="dashboard">
      ${showProjectCards ? _projectCards(projects, runs, onNavigate) : nothing}
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
        <div class="stat-card stat-cost-total" style="cursor:pointer" @click=${() => onNavigate?.('costs')}>
          <div class="stat-icon-ring">${unsafeHTML(iconSvg(Coins, 20))}</div>
          <div class="stat-body">
            <span class="stat-number">${_formatCost(totalCost)}</span>
            <span class="stat-label">Total Cost</span>
          </div>
        </div>
      </div>

      <div class="dashboard-actions">
        <sl-button variant="primary" @click=${() => onNavigate?.('new-run')}>
          ${unsafeHTML(iconSvg(Plus, 16))}
          New Pipeline
        </sl-button>
      </div>

      <h3 class="dashboard-section-title">Active Runs</h3>
      ${
        runningGroup.length > 0
          ? html`
        <div class="active-group active-group-running">
          <div class="active-group-header">
            <span class="active-group-count">${runningGroup.length} running</span>
          </div>
          <div class="run-list">
            ${runningGroup.map((run) => runCardView(run, { onClick: onSelectRun, onPause }))}
          </div>
        </div>
      `
          : nothing
      }
      ${
        pausedGroup.length > 0
          ? html`
        <div class="active-group active-group-paused">
          <div class="active-group-header">
            <span class="active-group-count">${pausedGroup.length} paused</span>
          </div>
          <div class="run-list">
            ${pausedGroup.map((run) => runCardView(run, { onClick: onSelectRun, onResume }))}
          </div>
        </div>
      `
          : nothing
      }
      ${
        failedGroup.length > 0
          ? html`
        <div class="active-group active-group-failed">
          <div class="active-group-header">
            <span class="active-group-count">${failedGroup.length} failed</span>
          </div>
          <div class="run-list">
            ${failedGroup.map((run) => runCardView(run, { onClick: onSelectRun, onResume }))}
          </div>
        </div>
      `
          : nothing
      }
      ${
        runningGroup.length === 0 &&
        pausedGroup.length === 0 &&
        failedGroup.length === 0
          ? html`
        <div class="empty-state">No running pipelines</div>
      `
          : nothing
      }
    </div>
  `;
}
