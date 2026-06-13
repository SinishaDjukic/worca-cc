import { html } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { helpFor } from '../utils/help-links.js';
import {
  Activity,
  Archive,
  Boxes,
  ChevronDown,
  Coins,
  Cpu,
  FileText,
  GitBranch,
  iconSvg,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  SlidersHorizontal,
  Workflow,
  Zap,
} from '../utils/icons.js';
import { statusDotClass } from '../utils/status-badge.js';

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
    ? runList.filter((r) => {
        const tagged = r.project || r._project;
        if (tagged) return tagged === projectId;
        // Untagged runs belong to the current project (server only sends
        // runs for the selected project, so all untagged runs are its).
        return !currentProjectId || currentProjectId === projectId;
      })
    : runList;

  let hasRunning = false;
  let hasError = false;
  let hasPaused = false;

  for (const r of projectRuns) {
    const ps = r.pipeline_status || (r.active ? 'running' : 'completed');
    if (ps === 'running' || ps === 'planning' || ps === 'integration_testing')
      hasRunning = true;
    else if (ps === 'failed' || ps === 'error' || ps === 'integration_failed')
      hasError = true;
    else if (ps === 'paused' || ps === 'approval_needed' || ps === 'blocked')
      hasPaused = true;
  }

  if (hasRunning) return 'running';
  if (hasError) return 'error';
  if (hasPaused) return 'paused';
  return 'idle';
}

export function sidebarView(
  state,
  route,
  connectionState,
  { onNavigate, onProjectChange, onAddProject, onToggleSidebar },
) {
  // Settings use nested shape only — read pre-resolved scalars from state, never flat-dot bracket keys.
  const {
    runs,
    preferences,
    projects,
    currentProjectId,
    worktrees = [],
    fleets = [],
    fleetsLoaded = false,
    // Sidebar counts pipeline executions (workspaceRuns), not definitions.
    // state.workspaces is reserved for the launcher's dropdown.
    workspaceRuns = [],
    workspaceRunsLoaded = false,
    worktreeDiskWarningBytes = 2_000_000_000,
    totalRunning = 0,
    maxConcurrentPipelines = 10,
    runsLoaded = false,
    worktreesLoaded = false,
  } = state;
  const atCapacity = totalRunning >= maxConcurrentPipelines;
  const allRunList = Object.values(runs);
  // Filter to selected project for counters (sidebar dots use allRunList via projectStatus)
  const runList =
    currentProjectId && (projects || []).length > 1
      ? allRunList.filter((r) => {
          const rp = r.project || r._project;
          return rp === currentProjectId;
        })
      : allRunList;
  const activeCount = runList.filter((r) => {
    const ps = r.pipeline_status || (r.active ? 'running' : 'completed');
    return ps === 'running';
  }).length;
  const historyCount = runList.length;

  const beadsIssues = state.beads?.issues || [];
  const beadsReady = beadsIssues.filter(
    (i) => i.status === 'ready' && (i.blocked_by?.length ?? 0) === 0,
  ).length;

  const worktreeCount = worktrees.length;
  const diskWarningThreshold = worktreeDiskWarningBytes;
  const totalWorktreeDisk = worktrees.reduce(
    (s, w) => s + (w.disk_bytes || 0),
    0,
  );
  const worktreeDiskWarning = totalWorktreeDisk > diskWarningThreshold;

  // Archived fleets never contribute to the badge — they're explicitly
  // out-of-sight (parity with archived pipeline runs).
  const liveFleets = fleets.filter((f) => !f.archived);
  const haltedFleetCount = liveFleets.filter(
    (f) => f.status === 'halted',
  ).length;
  const activeFleetCount = liveFleets.filter(
    (f) => f.status === 'running' || f.status === 'resuming',
  ).length;
  // Three-tier variant matching the badge-color-language guide:
  //   warning (orange) > primary (blue) > neutral (grey)
  // — attention beats in-flight beats idle. Aligns with the Running
  // sidebar row, which uses `primary` for any active count.
  const fleetBadgeCount = liveFleets.length;
  const showFleetBadge = fleetBadgeCount > 0;
  const fleetBadgeVariant =
    haltedFleetCount > 0
      ? 'warning'
      : activeFleetCount > 0
        ? 'primary'
        : 'neutral';

  const liveWorkspaces = workspaceRuns.filter((w) => !w.archived);
  const WORKSPACE_ATTENTION = { halted: 1, integration_failed: 1, failed: 1 };
  // planning / running / integration_testing are all orchestrator-driven
  // in-flight phases; resuming is included for parity with fleets.
  const WORKSPACE_ACTIVE = {
    planning: 1,
    running: 1,
    integration_testing: 1,
    resuming: 1,
  };
  const attentionWorkspaceCount = liveWorkspaces.filter(
    (w) => WORKSPACE_ATTENTION[w.status],
  ).length;
  const activeWorkspaceCount = liveWorkspaces.filter(
    (w) => WORKSPACE_ACTIVE[w.status],
  ).length;
  const workspaceBadgeCount = liveWorkspaces.length;
  const showWorkspaceBadge = workspaceBadgeCount > 0;
  const workspaceBadgeVariant =
    attentionWorkspaceCount > 0
      ? 'warning'
      : activeWorkspaceCount > 0
        ? 'primary'
        : 'neutral';

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

  const collapsed = !!preferences.sidebarCollapsed;
  const toggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return html`
    <aside class="sidebar ${collapsed ? 'collapsed' : ''}">
      <div class="sidebar-logo">
        <span
          class="logo-text"
          @click=${() => onNavigate('dashboard')}
          style="cursor:pointer"
        >WORCA</span>
        <button
          type="button"
          class="sidebar-toggle-btn"
          aria-label=${toggleLabel}
          aria-expanded=${String(!collapsed)}
          title="${toggleLabel} (⌘B)"
          @click=${() => onToggleSidebar?.()}
        >
          ${unsafeHTML(iconSvg(toggleIcon, 16))}
        </button>
      </div>

      ${
        projects && projects.length >= 1
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

      ${(() => {
        // Split-button "+ New" affordance. Left half is the primary
        // action (single-project pipeline) — what most users want most
        // of the time. Right half is a chevron that opens a menu of
        // multi-project alternatives (Fleet now, Workspace once W-047
        // lands). Pattern A from the W-040 UX discussion.
        //
        // The primary half is gated only by the global capacity cap; the
        // launcher itself handles the "no project selected" case (in
        // global mode it surfaces a project picker before submit).
        const primaryTitle = atCapacity ? 'Pipeline capacity reached' : '';
        return html`
          <div class="sidebar-new-run">
            <div class="sidebar-new-run-split">
              <button
                type="button"
                class="sidebar-new-run-btn-primary"
                ?disabled=${atCapacity}
                title=${primaryTitle}
                @click=${atCapacity ? null : () => onNavigate('new-run')}
              >
                ${unsafeHTML(iconSvg(Plus, 14))}
                <span>Run Pipeline</span>
              </button>
              <sl-dropdown
                class="sidebar-new-run-chevron-dropdown"
                placement="bottom-end"
                hoist
              >
                <button
                  slot="trigger"
                  type="button"
                  class="sidebar-new-run-btn-chevron"
                  ?disabled=${atCapacity}
                  title="More creation options"
                  aria-label="More creation options"
                >
                  ${unsafeHTML(iconSvg(ChevronDown, 14))}
                </button>
                <sl-menu>
                  <sl-menu-item
                    class="menu-item-new-fleet"
                    @click=${() => onNavigate('fleet-runs/new')}
                  >
                    ${unsafeHTML(iconSvg(Workflow, 14))}
                    Run Fleet
                  </sl-menu-item>
                  <sl-menu-item
                    class="menu-item-new-workspace"
                    @click=${() => onNavigate('workspace-runs/new')}
                  >
                    ${unsafeHTML(iconSvg(Boxes, 14))}
                    Run Workspace
                  </sl-menu-item>
                </sl-menu>
              </sl-dropdown>
            </div>
          </div>
        `;
      })()}

      <div class="sidebar-section">
        <div class="sidebar-section-header">Pipeline</div>
        <div class="sidebar-item ${route.section === 'active' ? 'active' : ''}"
             title=${collapsed ? 'Running' : ''}
             @click=${() => onNavigate('active')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(Activity, 16))}
            <span>Running</span>
          </span>
          ${
            !runsLoaded
              ? html`<sl-spinner class="sidebar-loading-spinner" data-testid="sidebar-running-loading"></sl-spinner>`
              : activeCount > 0
                ? html`<sl-badge variant="primary" pill>${activeCount}</sl-badge>`
                : ''
          }
          ${helpFor('monitoring')}
        </div>
        <div class="sidebar-item ${route.section === 'history' ? 'active' : ''}"
             title=${collapsed ? 'History' : ''}
             @click=${() => onNavigate('history')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(Archive, 16))}
            <span>History</span>
          </span>
          ${
            !runsLoaded
              ? html`<sl-spinner class="sidebar-loading-spinner" data-testid="sidebar-history-loading"></sl-spinner>`
              : historyCount > 0
                ? html`<sl-badge variant="neutral" pill>${historyCount}</sl-badge>`
                : ''
          }
          ${helpFor('reviewing')}
        </div>
        <div class="sidebar-item ${route.section === 'worktrees' ? 'active' : ''}"
             title=${collapsed ? 'Worktrees' : ''}
             @click=${() => onNavigate('worktrees')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(GitBranch, 16))}
            <span>Worktrees</span>
          </span>
          ${
            !worktreesLoaded
              ? html`<sl-spinner class="sidebar-loading-spinner" data-testid="sidebar-worktrees-loading"></sl-spinner>`
              : worktreeCount > 0
                ? html`<sl-badge variant="${worktreeDiskWarning ? 'warning' : 'neutral'}" pill class="worktrees-count-badge">${worktreeCount}</sl-badge>`
                : ''
          }
          ${helpFor('worktrees')}
        </div>
        <div class="sidebar-item ${route.section === 'fleet-runs' ? 'active' : ''}"
             title=${collapsed ? 'Fleets' : ''}
             @click=${() => onNavigate('fleet-runs')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(Workflow, 16))}
            <span>Fleets</span>
          </span>
          ${
            !fleetsLoaded
              ? html`<sl-spinner class="sidebar-loading-spinner" data-testid="sidebar-fleets-loading"></sl-spinner>`
              : showFleetBadge
                ? html`<sl-badge variant="${fleetBadgeVariant}" pill class="fleets-count-badge">${fleetBadgeCount}</sl-badge>`
                : ''
          }
          ${helpFor('fleet-runs')}
        </div>
        <div class="sidebar-item ${route.section === 'workspace-runs' ? 'active' : ''}"
             title=${collapsed ? 'Workspaces' : ''}
             @click=${() => onNavigate('workspace-runs')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(Boxes, 16))}
            <span>Workspaces</span>
          </span>
          ${
            !workspaceRunsLoaded
              ? html`<sl-spinner class="sidebar-loading-spinner" data-testid="sidebar-workspaces-loading"></sl-spinner>`
              : showWorkspaceBadge
                ? html`<sl-badge variant="${workspaceBadgeVariant}" pill class="workspaces-count-badge">${workspaceBadgeCount}</sl-badge>`
                : ''
          }
          ${helpFor('workspace-runs')}
        </div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Work</div>
        <div class="sidebar-item ${route.section === 'beads' ? 'active' : ''}"
             title=${collapsed ? 'Beads' : ''}
             @click=${() => onNavigate('beads')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(List, 16))}
            <span>Beads</span>
          </span>
          ${beadsReady > 0 ? html`<sl-badge variant="success" pill>${beadsReady}</sl-badge>` : ''}
          ${helpFor('pipeline-stages')}
        </div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Analytics</div>
        <div class="sidebar-item ${route.section === 'costs' ? 'active' : ''}"
             title=${collapsed ? 'Costs' : ''}
             @click=${() => onNavigate('costs')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(Coins, 16))}
            <span>Costs</span>
          </span>
          ${helpFor('costs-budgets')}
        </div>
        <div class="sidebar-item ${route.section === 'webhooks' ? 'active' : ''}"
             title=${collapsed ? 'Webhooks' : ''}
             @click=${() => onNavigate('webhooks')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(Zap, 16))}
            <span>Webhooks</span>
          </span>
          ${(state.webhookInbox?.events?.length || 0) > 0 ? html`<sl-badge variant="warning" pill>${state.webhookInbox.events.length}</sl-badge>` : ''}
          ${helpFor('events')}
        </div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Configuration</div>
        ${
          // Hide project-scoped entries in true All-Projects mode (multi-project
          // with no selection). In single-project mode (projects empty, server
          // has worcaDir), the un-scoped endpoints work fine.
          (projects || []).length > 1 && !currentProjectId
            ? ''
            : html`
        <div class="sidebar-item ${route.section === 'project-settings' ? 'active' : ''}"
             title=${collapsed ? 'Project Settings' : ''}
             @click=${() => onNavigate('project-settings')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(SlidersHorizontal, 16))}
            <span>Project Settings</span>
          </span>
          ${helpFor('settings-overview')}
        </div>
        <div class="sidebar-item ${route.section === 'templates' ? 'active' : ''}"
             title=${collapsed ? 'Pipeline Templates' : ''}
             @click=${() => onNavigate('templates')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(FileText, 16))}
            <span>Pipeline Templates</span>
          </span>
          ${helpFor('templates')}
        </div>
        <div class="sidebar-item ${route.section === 'models' ? 'active' : ''}"
             title=${collapsed ? 'Models' : ''}
             @click=${() => onNavigate('models')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(Cpu, 16))}
            <span>Models</span>
          </span>
          ${helpFor('models')}
        </div>
        `
        }
        <div class="sidebar-item ${route.section === 'workspaces' ? 'active' : ''}"
             title=${collapsed ? 'Workspaces' : ''}
             @click=${() => onNavigate('workspaces')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(Boxes, 16))}
            <span>Workspaces</span>
          </span>
          ${helpFor('workspace-runs')}
        </div>
      </div>

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
