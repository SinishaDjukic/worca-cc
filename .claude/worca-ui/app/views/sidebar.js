import { html } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import {
  Activity,
  Archive,
  Coins,
  iconSvg,
  List,
  Plus,
  Settings,
  SlidersHorizontal,
  Zap,
} from '../utils/icons.js';

/**
 * Derive aggregate status for a project from its runs.
 * @param {string} projectId
 * @param {object} runs - { [runId]: run }
 * @returns {'idle'|'running'|'error'|'paused'}
 */
export function projectStatus(projectId, runs, currentProjectId) {
  const runList = Object.values(runs);
  // In multi-project mode, runs in state belong to currentProjectId.
  // For other projects we have no data — return idle.
  const projectRuns = projectId
    ? runList.filter((r) =>
        r.project === projectId ||
        (!r.project && (!currentProjectId || currentProjectId === projectId)),
      )
    : runList;

  let hasRunning = false;
  let hasError = false;
  let hasPaused = false;

  for (const r of projectRuns) {
    const ps = r.pipeline_status || (r.active ? 'running' : 'completed');
    if (ps === 'running') hasRunning = true;
    else if (ps === 'failed' || ps === 'error') hasError = true;
    else if (ps === 'paused' || ps === 'approval_needed') hasPaused = true;
  }

  if (hasRunning) return 'running';
  if (hasError) return 'error';
  if (hasPaused) return 'paused';
  return 'idle';
}

/**
 * Map project status to a CSS color class for the status dot.
 */
function statusDotClass(status) {
  switch (status) {
    case 'running':
      return 'project-status-running';
    case 'error':
      return 'project-status-error';
    case 'paused':
      return 'project-status-paused';
    default:
      return 'project-status-idle';
  }
}

export function sidebarView(
  state,
  route,
  connectionState,
  { onNavigate, onProjectChange, onAddProject },
) {
  const { runs, preferences, projects, currentProjectId } = state;
  const runList = Object.values(runs);
  const activeCount = runList.filter((r) => {
    const ps = r.pipeline_status || (r.active ? 'running' : 'completed');
    return ps === 'running' || ps === 'resuming';
  }).length;
  const historyCount = runList.length;

  const beadsIssues = state.beads?.issues || [];
  const beadsReady = beadsIssues.filter(
    (i) => i.status === 'ready' && (i.blocked_by?.length ?? 0) === 0,
  ).length;
  const beadsDbExists = state.beads?.dbExists ?? false;

  const connClass =
    connectionState === 'open'
      ? 'connected'
      : connectionState === 'reconnecting'
        ? 'reconnecting'
        : 'disconnected';
  const connLabel =
    connectionState === 'open'
      ? 'Connected'
      : connectionState === 'reconnecting'
        ? 'Reconnecting\u2026'
        : 'Disconnected';

  return html`
    <aside class="sidebar ${preferences.sidebarCollapsed ? 'collapsed' : ''}">
      <div class="sidebar-logo" @click=${() => onNavigate('dashboard')} style="cursor:pointer">
        <span class="logo-text">WORCA</span>
      </div>

      ${
        projects && projects.length > 1
          ? html`
        <div class="sidebar-section sidebar-project-section">
          <div class="sidebar-section-header">Project</div>
          <div class="sidebar-project-selector-row">
            <div class="sidebar-project-selector">
              <sl-select
                size="small"
                value=${currentProjectId || ''}
                @sl-change=${(e) => onProjectChange?.(e.target.value)}
              >
                <sl-option value="">All Projects</sl-option>
                <sl-divider></sl-divider>
                ${projects.map((p) => {
                  const pStatus = projectStatus(p.name, runs, currentProjectId);
                  const dotClass = statusDotClass(pStatus);
                  return html`
                    <sl-option value=${p.name}>
                      <span class="project-option-label">
                        <span class="project-status-dot ${dotClass}"></span>
                        ${p.name}
                      </span>
                    </sl-option>
                  `;
                })}
              </sl-select>
            </div>
            <button class="sidebar-add-project-btn" aria-label="Add project" @click=${() => onAddProject?.()}>
              ${unsafeHTML(iconSvg(Plus, 16))}
            </button>
          </div>
        </div>
      `
          : ''
      }

      ${(currentProjectId || (projects || []).length <= 1) ? html`
      <div class="sidebar-new-run">
        <button class="sidebar-new-run-btn" @click=${() => onNavigate('new-run')}>
          ${unsafeHTML(iconSvg(Plus, 16))}
          <span>New Pipeline</span>
        </button>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Pipeline</div>
        <div class="sidebar-item ${route.section === 'active' ? 'active' : ''}"
             @click=${() => onNavigate('active')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(Activity, 16))}
            <span>Running</span>
          </span>
          ${activeCount > 0 ? html`<sl-badge variant="primary" pill>${activeCount}</sl-badge>` : ''}
        </div>
        <div class="sidebar-item ${route.section === 'history' ? 'active' : ''}"
             @click=${() => onNavigate('history')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(Archive, 16))}
            <span>History</span>
          </span>
          ${historyCount > 0 ? html`<sl-badge variant="neutral" pill>${historyCount}</sl-badge>` : ''}
        </div>
      </div>

      ${
        beadsDbExists
          ? html`
        <div class="sidebar-section">
          <div class="sidebar-section-header">Work</div>
          <div class="sidebar-item ${route.section === 'beads' ? 'active' : ''}"
               @click=${() => onNavigate('beads')}>
            <span class="sidebar-item-left">
              ${unsafeHTML(iconSvg(List, 16))}
              <span>Beads</span>
            </span>
            ${beadsReady > 0 ? html`<sl-badge variant="success" pill>${beadsReady}</sl-badge>` : ''}
          </div>
        </div>
      `
          : ''
      }

      <div class="sidebar-section">
        <div class="sidebar-section-header">Analytics</div>
        <div class="sidebar-item ${route.section === 'costs' ? 'active' : ''}"
             @click=${() => onNavigate('costs')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(Coins, 16))}
            <span>Costs</span>
          </span>
        </div>
        <div class="sidebar-item ${route.section === 'webhooks' ? 'active' : ''}"
             @click=${() => onNavigate('webhooks')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(Zap, 16))}
            <span>Webhooks</span>
          </span>
          ${(state.webhookInbox?.events?.length || 0) > 0 ? html`<sl-badge variant="warning" pill>${state.webhookInbox.events.length}</sl-badge>` : ''}
        </div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Configuration</div>
        <div class="sidebar-item ${route.section === 'project-settings' ? 'active' : ''}"
             @click=${() => onNavigate('project-settings')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(SlidersHorizontal, 16))}
            <span>Project Settings</span>
          </span>
        </div>
      </div>
      ` : ''}

      <div class="sidebar-footer">
        <div class="connection-indicator ${connClass}">
          <span class="conn-dot"></span>
          <span class="conn-label">${connLabel}</span>
        </div>
        <button
          class="theme-toggle-btn ${route.section === 'settings' ? 'active' : ''}"
          aria-label="Settings"
          @click=${() => onNavigate('settings')}
        >${unsafeHTML(iconSvg(Settings, 18))}</button>
      </div>
    </aside>
  `;
}
