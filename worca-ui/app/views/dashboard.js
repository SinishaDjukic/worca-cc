import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { helpFor } from '../utils/help-links.js';
import {
  Activity,
  CircleAlert,
  CircleCheck,
  Coins,
  iconSvg,
  Zap,
} from '../utils/icons.js';
import { sortByStartDesc } from '../utils/sort-runs.js';
import { statusClass, statusIcon } from '../utils/status-badge.js';
import { fleetCardView } from './fleet-card.js';
import { fleetStatusVariant } from './group-rendering.js';
import { runCardView } from './run-card.js';

// Bucket fleets by their canonical (server-derived) status so the
// dashboard's sections — Active / Paused / Failures / Completed — pull
// from the same single source of truth that the /fleet-runs list view
// and the fleet detail page consume.
//
// `halted` is intentionally NOT here: a halted fleet has no live work, so
// "Active" would mislead. Instead we route it by `halt_reason` —
// user-halted reads as "paused" (you stopped it, you can resume) and
// circuit-breaker / threshold halts read as "failed" (auto-stopped because
// too many children failed). See `_FLEET_PAUSED_HALT_REASONS` and
// `_FLEET_FAILED_HALT_REASONS` below.
const _FLEET_ACTIVE_STATUSES = new Set(['running', 'resuming', 'paused']);
const _FLEET_PAUSED_HALT_REASONS = new Set(['user']);

function _isFleetPaused(fleet) {
  if (fleet.status === 'paused') return true;
  if (fleet.status !== 'halted') return false;
  return _FLEET_PAUSED_HALT_REASONS.has(fleet.halt_reason);
}

function _isFleetFailed(fleet) {
  if (fleet.status === 'failed') return true;
  if (fleet.status !== 'halted') return false;
  // Any halt that isn't a user-initiated pause is treated as a failure
  // surface (circuit_breaker, targets_not_ready, plan_first_failed, …).
  return !_FLEET_PAUSED_HALT_REASONS.has(fleet.halt_reason);
}

function _filterFleets(fleets, predicate) {
  return (fleets || []).filter(predicate);
}

function _sortFleetsByActivityDesc(fleets) {
  return [...fleets].sort((a, b) => {
    const ta = a.last_activity_at || a.updated_at || a.created_at || '';
    const tb = b.last_activity_at || b.updated_at || b.created_at || '';
    return tb.localeCompare(ta);
  });
}

function _renderFleetCard(
  fleet,
  { onSelectRun, onNavigate, onArchiveFleet, onUnarchiveFleet } = {},
) {
  return fleetCardView(fleet, fleet.children || [], {
    onClick: onNavigate ? (fid) => onNavigate('fleet-runs', fid) : undefined,
    onChildClick: onSelectRun,
    onArchive: onArchiveFleet,
    onUnarchive: onUnarchiveFleet,
  });
}

function _renderRunCard(run, opts = {}) {
  return runCardView(run, {
    onClick: opts.onSelectRun,
    onPause: opts.onPause,
    onResume: opts.onResume,
    onStop: opts.onStop,
    onCancel: opts.onCancel,
    onArchive: opts.onArchive,
  });
}

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

// Returns true for Runs that should render as standalone pipeline cards on
// the dashboard. Anything that belongs to a known fleet is represented by
// the fleet's card (with the children-strip) — don't double-list those.
// Similarly, workspace children are represented by the workspace card.
function _isStandaloneRun(run, fleetIdSet, wsChildRunIds) {
  if (wsChildRunIds.has(run.id)) return false;
  if (!run.fleet_id) return true;
  return !fleetIdSet.has(run.fleet_id);
}

// ─── Workspace bucketing ─────────────────────────────────────────────────────

const _WS_ACTIVE_STATUSES = new Set([
  'running',
  'resuming',
  'planning',
  'integration_testing',
]);
const _WS_PAUSED_HALT_REASONS = new Set(['user']);

const _WS_FAILED_STATUSES = new Set(['failed', 'integration_failed']);

function _isWsPaused(ws) {
  if (ws.status === 'paused') return true;
  if (ws.status !== 'halted') return false;
  return _WS_PAUSED_HALT_REASONS.has(ws.halt_reason);
}

function _isWsFailed(ws) {
  if (_WS_FAILED_STATUSES.has(ws.status)) return true;
  if (ws.status !== 'halted') return false;
  return !_WS_PAUSED_HALT_REASONS.has(ws.halt_reason);
}

function _sortByActivityDesc(items) {
  return [...items].sort((a, b) => {
    const ta = a.last_activity_at || a.updated_at || a.created_at || '';
    const tb = b.last_activity_at || b.updated_at || b.created_at || '';
    return tb.localeCompare(ta);
  });
}

function _wsChildRunIdSet(workspaces) {
  const ids = new Set();
  for (const ws of workspaces) {
    for (const child of ws.children || []) {
      if (child.run_id) ids.add(child.run_id);
    }
  }
  return ids;
}

// Build a blocked-child tooltip: find failed repos in prior tiers that this
// child's tier depends on (any tier with index < child.tier).
function _blockedTooltip(child, ws) {
  if (child.status !== 'blocked') return null;
  const failedProjects = [];
  for (const c of ws.children || []) {
    if (
      c.tier < child.tier &&
      (c.status === 'failed' || c.status === 'setup_failed')
    ) {
      failedProjects.push(c.project);
    }
  }
  if (failedProjects.length === 0) return 'Blocked by upstream dependency';
  return `Blocked: depends on ${failedProjects.join(', ')}`;
}

function _integrationTestVariant(status) {
  if (status === 'passed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'running') return 'primary';
  return 'neutral';
}

function _renderWorkspaceCard(ws, { onNavigate } = {}) {
  const status = ws.status || 'running';
  const variant = fleetStatusVariant(status, ws.halt_reason);
  const children = ws.children || [];
  const tiers = ws.dag?.tiers || [];
  const completedCount = children.filter(
    (c) => c.status === 'completed',
  ).length;
  const title = ws.workspace_name || `Workspace ${ws.workspace_id || ''}`;

  const handleClick = onNavigate
    ? (e) => {
        if (e.target.closest('button, a, sl-button')) return;
        onNavigate('workspace-runs', ws.workspace_id);
      }
    : null;

  return html`
    <div
      class="run-card workspace-card ${statusClass(status)}"
      data-workspace-id="${ws.workspace_id || ''}"
      @click=${handleClick}
    >
      <div class="run-card-top">
        <span class="run-card-status">
          ${unsafeHTML(statusIcon(status, 16))}
        </span>
        <span class="run-card-title">${title}</span>
        <sl-badge
          variant="${variant}"
          pill
          class="workspace-card-status-badge"
        >${status}</sl-badge>
      </div>

      <div class="workspace-card-progress">
        <span class="meta-label">Progress:</span>
        <span class="meta-value">${completedCount}/${children.length} completed</span>
      </div>

      <div class="workspace-card-tiers">
        ${tiers.map((tier) => {
          const tierChildren = children.filter((c) => c.tier === tier.tier);
          return html`
            <div class="workspace-tier-row">
              <span class="tier-label">Tier ${tier.tier}</span>
              <span class="tier-status">${unsafeHTML(statusIcon(tier.status, 12))}</span>
              <div class="tier-children">
                ${tierChildren.map((c) => {
                  const tooltip = _blockedTooltip(c, ws);
                  return html`
                    <span
                      class="tier-child ${statusClass(c.status)}"
                      title="${tooltip || c.status}"
                    >${c.project}</span>
                  `;
                })}
              </div>
            </div>
          `;
        })}
      </div>

      ${
        ws.integration_test
          ? html`
            <div class="workspace-tier-row integration-test-row">
              <span class="tier-label">Integration test</span>
              <sl-badge
                variant="${_integrationTestVariant(ws.integration_test.status)}"
                pill
                class="integration-test-badge"
              >${ws.integration_test.status}</sl-badge>
            </div>
          `
          : nothing
      }
    </div>
  `;
}

// Project cards (per-project summary tiles) were removed: the sidebar's
// always-visible project dropdown is the single source of truth for project
// switching, and the cards' run-to-project attribution relied on a
// `run.projectId` field that isn't populated reliably across modes. The
// function and its CSS (.project-cards / .project-card-*) are gone with it.

export function dashboardView(
  state,
  {
    onSelectRun,
    onNavigate,
    onPause,
    onResume,
    onStop,
    onCancel,
    onArchive,
    onArchiveFleet,
    onUnarchiveFleet,
    onToggleFleet,
  } = {},
) {
  // _onToggleFleet is retained on the option signature for back-compat
  // with earlier callers (the previous design expanded fleet groups inline);
  // the new fleet-card always navigates rather than expanding, so the
  // option is unused here.
  void onToggleFleet;

  // Shared fleet-card option bag — `onSelectRun` / `onNavigate` vary per
  // section call below, the archive handlers don't.
  const fleetCardOpts = { onArchiveFleet, onUnarchiveFleet };

  const allRuns = Object.values(state.runs);
  // Archived fleets are excluded from every dashboard section — same as
  // archived pipeline runs. They remain reachable via the /#/fleet-runs
  // "Show archived" toggle.
  const fleets = (state.fleets || []).filter((f) => !f.archived);
  const fleetIdSet = new Set(fleets.map((f) => f.fleet_id));

  // Workspaces — bucketed by group_type === 'workspace' (W-048 §5 rule).
  const workspaces = (state.workspaces || []).filter((w) => !w.archived);
  const wsChildRunIds = _wsChildRunIdSet(workspaces);

  // Standalone runs = runs that aren't represented by a fleet or workspace card.
  const standaloneRuns = allRuns.filter((r) =>
    _isStandaloneRun(r, fleetIdSet, wsChildRunIds),
  );

  // Stats card totals still count *every* run (including fleet children).
  const active = allRuns.filter((r) => r.active);
  const completed = allRuns.filter((r) => !r.active);
  const errored = allRuns.filter((r) => {
    const stages = r.stages ? Object.values(r.stages) : [];
    return stages.some((s) => s.status === 'error');
  });
  const total = allRuns.length;
  const totalCost = _computeTotalCost(allRuns);

  // Section buckets — fleets bucketed by canonical fleet status, standalone
  // runs bucketed by `r.active` / `pipeline_status` as before. The card
  // mix in each section comes from `state.fleets` + standalone `state.runs`,
  // identical to what `/fleet-runs` and the run-list views show.
  const activeFleets = _sortFleetsByActivityDesc(
    _filterFleets(fleets, (f) => _FLEET_ACTIVE_STATUSES.has(f.status)),
  );
  const pausedFleets = _sortFleetsByActivityDesc(
    _filterFleets(fleets, _isFleetPaused),
  );
  const failedFleets = _sortFleetsByActivityDesc(
    _filterFleets(fleets, _isFleetFailed),
  );
  const completedFleets = _sortFleetsByActivityDesc(
    _filterFleets(fleets, (f) => f.status === 'completed'),
  );

  const activeWorkspaces = _sortByActivityDesc(
    workspaces.filter((w) => _WS_ACTIVE_STATUSES.has(w.status)),
  );
  const pausedWorkspaces = _sortByActivityDesc(workspaces.filter(_isWsPaused));
  const failedWorkspaces = _sortByActivityDesc(workspaces.filter(_isWsFailed));
  const completedWorkspaces = _sortByActivityDesc(
    workspaces.filter((w) => w.status === 'completed'),
  );

  const activeStandalone = sortByStartDesc(
    standaloneRuns.filter((r) => r.active),
  );
  const pausedStandalone = sortByStartDesc(
    _activeGroup(standaloneRuns, ['paused']),
  );

  const MAX_RECENT = 3;
  const allFailedStandalone = sortByStartDesc(
    _activeGroup(standaloneRuns, ['failed']),
  );
  const failedStandalonePreview = allFailedStandalone.slice(0, MAX_RECENT);
  const allCompletedStandalone = sortByStartDesc(
    _activeGroup(standaloneRuns, ['completed']),
  );
  const completedStandalonePreview = allCompletedStandalone.slice(
    0,
    MAX_RECENT,
  );

  const activeAny =
    activeFleets.length + activeWorkspaces.length + activeStandalone.length > 0;
  const pausedAny =
    pausedFleets.length + pausedWorkspaces.length + pausedStandalone.length > 0;
  const failedAny =
    failedFleets.length +
      failedWorkspaces.length +
      failedStandalonePreview.length >
    0;
  const completedAny =
    completedFleets.length +
      completedWorkspaces.length +
      completedStandalonePreview.length >
    0;
  const failedAllCount =
    failedFleets.length + failedWorkspaces.length + allFailedStandalone.length;
  const completedAllCount =
    completedFleets.length +
    completedWorkspaces.length +
    allCompletedStandalone.length;

  // Project cards used to appear here in global mode as a grid of
  // per-project summary tiles. Removed: the sidebar's project dropdown
  // already provides project switching, and the cards' "no runs"
  // attribution was unreliable when runs lacked a projectId field.
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
        <div class="stat-card stat-cost-total" style="cursor:pointer" @click=${() => onNavigate?.('costs')}>
          <div class="stat-icon-ring">${unsafeHTML(iconSvg(Coins, 20))}</div>
          <div class="stat-body">
            <span class="stat-number">${_formatCost(totalCost)}</span>
            <span class="stat-label">Total Cost</span>
          </div>
        </div>
      </div>

      <h3 class="dashboard-section-title">Active Runs</h3>
      ${
        activeAny
          ? html`
        <div class="active-group">
          <div class="run-list">
            ${activeFleets.map((f) => _renderFleetCard(f, { onSelectRun, onNavigate, ...fleetCardOpts }))}
            ${activeWorkspaces.map((w) => _renderWorkspaceCard(w, { onNavigate }))}
            ${activeStandalone.map((r) =>
              _renderRunCard(r, {
                onSelectRun,
                onPause,
                onResume,
                onStop,
                onCancel,
              }),
            )}
          </div>
        </div>
      `
          : html`<div class="empty-state">No active pipelines${helpFor('first-run')}</div>`
      }

      ${
        pausedAny
          ? html`
        <h3 class="dashboard-section-title">
          Paused
          <span class="dashboard-section-count">${pausedFleets.length + pausedWorkspaces.length + pausedStandalone.length}</span>
        </h3>
        <div class="active-group active-group-paused">
          <div class="run-list">
            ${pausedFleets.map((f) => _renderFleetCard(f, { onSelectRun, onNavigate, ...fleetCardOpts }))}
            ${pausedWorkspaces.map((w) => _renderWorkspaceCard(w, { onNavigate }))}
            ${pausedStandalone.map((r) =>
              _renderRunCard(r, { onSelectRun, onResume, onCancel }),
            )}
          </div>
        </div>
      `
          : nothing
      }

      ${
        failedAny
          ? html`
        <h3 class="dashboard-section-title">
          Recent Failures
          ${
            failedAllCount > MAX_RECENT
              ? html`
            <a class="dashboard-view-all" @click=${() => onNavigate?.('history', { statusFilter: 'failed' })}>View all ${failedAllCount}</a>
          `
              : nothing
          }
        </h3>
        <div class="active-group active-group-failed">
          <div class="run-list">
            ${failedFleets.map((f) => _renderFleetCard(f, { onSelectRun, onNavigate, ...fleetCardOpts }))}
            ${failedWorkspaces.map((w) => _renderWorkspaceCard(w, { onNavigate }))}
            ${failedStandalonePreview.map((r) =>
              _renderRunCard(r, {
                onSelectRun,
                onResume,
                onCancel,
                onArchive,
              }),
            )}
          </div>
        </div>
      `
          : nothing
      }

      ${
        completedAny
          ? html`
        <h3 class="dashboard-section-title">
          Recent Completed
          ${
            completedAllCount > MAX_RECENT
              ? html`
            <a class="dashboard-view-all" @click=${() => onNavigate?.('history', { statusFilter: 'completed' })}>View all ${completedAllCount}</a>
          `
              : nothing
          }
        </h3>
        <div class="active-group active-group-completed">
          <div class="run-list">
            ${completedFleets.map((f) => _renderFleetCard(f, { onSelectRun, onNavigate, ...fleetCardOpts }))}
            ${completedWorkspaces.map((w) => _renderWorkspaceCard(w, { onNavigate }))}
            ${completedStandalonePreview.map((r) =>
              _renderRunCard(r, { onSelectRun }),
            )}
          </div>
        </div>
      `
          : nothing
      }
    </div>
  `;
}
