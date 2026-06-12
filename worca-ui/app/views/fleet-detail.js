import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { elapsed, formatDuration, formatTimestamp } from '../utils/duration.js';
import { renderMarkdown } from '../utils/markdown.js';
import { statusClass, statusIcon } from '../utils/status-badge.js';
import { projectBadgesView } from './fleet-card.js';
import { runCardView } from './run-card.js';

// ─── module-level state ───────────────────────────────────────────────────────

let guideDialogOpen = false;
let guideContent = null;
let guideLoading = false;
let guideError = null;
let guideErrorHint = null;

export function resetFleetDetailState(overrides = {}) {
  guideDialogOpen = overrides.guideDialogOpen ?? false;
  guideContent = overrides.guideContent ?? null;
  guideLoading = overrides.guideLoading ?? false;
  guideError = overrides.guideError ?? null;
  guideErrorHint = overrides.guideErrorHint ?? null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function _projectName(projectPath) {
  if (!projectPath) return '(unknown)';
  return projectPath.split('/').pop() || projectPath;
}

function _computeChildCost(child) {
  let total = 0;
  for (const stage of Object.values(child.stages || {})) {
    for (const iter of stage.iterations || []) {
      total += iter.cost_usd || 0;
    }
  }
  return total;
}

function _computeFleetCost(children) {
  return children.reduce((sum, c) => sum + _computeChildCost(c), 0);
}

function _formatCost(usd) {
  if (usd == null || usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function _formatBytes(b) {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function _formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso.slice(0, 16);
  }
}

function _childStatusVariant(status) {
  const map = {
    completed: 'success',
    running: 'primary',
    failed: 'danger',
    setup_failed: 'danger',
    pending: 'neutral',
    halted: 'warning',
    unrecoverable: 'danger',
  };
  return map[status] || 'neutral';
}

// ─── sub-views ────────────────────────────────────────────────────────────────

// Aggregate per-project cost. The fleet manifest's enriched children
// don't carry stage iterations (only status), so per-child stage cost has
// to come from the live registry — we look each project's run_id up in
// state.runs (passed in as `runsById`). Falls back to the manifest entry
// when the run hasn't been pushed over the WS yet (early dispatch race).
function _aggregateChildCost(children, runsById = {}) {
  let total = 0;
  for (const c of children || []) {
    const live = c.run_id ? runsById[c.run_id] : null;
    total += _computeChildCost(live || c);
  }
  return total;
}

// Pick the wall-clock "finished" timestamp. For a finished fleet we use
// halted_at (when present) or updated_at. For an in-flight fleet, null —
// timing strip shows "running for" instead.
function _wallEndedAt(fleet) {
  if (fleet.status === 'running' || fleet.status === 'resuming') return null;
  return fleet.halted_at || fleet.updated_at || null;
}

// Pipeline-style overview strip. Replaces the previous hero card so the
// fleet detail page reads with the same vocabulary as the pipeline run
// page (flat meta rows over a single panel, status + id chip). Action
// buttons live in the page header (see `contentHeaderView` in main.js)
// — same placement as Pause/Stop/Resume on the pipeline run page.
//
// `runsById` is needed for accurate cost aggregation: the manifest's
// enriched children carry status only, so per-stage iteration costs come
// from the WS-pushed state.runs entry.
function _fleetOverviewSection(fleet, { runsById } = {}) {
  const children = fleet.children || [];
  const failedCount = children.filter(
    (c) => c.status === 'failed' || c.status === 'setup_failed',
  ).length;

  const baseBranch = fleet.base_branch || 'each repo default';
  const planMode = fleet.plan?.mode || 'none';
  const startedAt = fleet.created_at || null;
  const endedAt = _wallEndedAt(fleet);
  const isActive = fleet.status === 'running' || fleet.status === 'resuming';
  const duration = startedAt
    ? formatDuration(elapsed(startedAt, isActive ? null : endedAt))
    : 'N/A';
  const cost = _aggregateChildCost(children, runsById);

  return html`
    <div
      class="run-detail-overview fleet-detail-overview"
      data-fleet-id="${fleet.fleet_id}"
    >
      <div class="run-info-section fleet-info-section">
        <div class="fleet-overview-status-row">
          <span class="meta-label">Fleet ID:</span>
          <code class="fleet-id-chip">${fleet.fleet_id}</code>
        </div>

        <div class="fleet-meta-line fleet-meta-line-projects">
          <span class="meta-label">Projects:</span>
          ${
            children.length > 0
              ? projectBadgesView(children)
              : html`<span class="meta-value">—</span>`
          }
          ${
            failedCount > 0
              ? html`<span class="fleet-card-failed-count">${failedCount} failed</span>`
              : nothing
          }
        </div>

        <div class="fleet-meta-line">
          <span class="fleet-meta-item"><span class="meta-label">Base:</span> <span class="meta-value">${baseBranch}</span></span>
          <span class="fleet-meta-item"><span class="meta-label">Plan:</span> <span class="meta-value">${planMode}</span></span>
        </div>

        <div class="fleet-meta-line">
          <span class="fleet-meta-item"><span class="meta-label">Started:</span> <span class="meta-value">${formatTimestamp(startedAt)}</span></span>
          ${
            endedAt
              ? html`<span class="fleet-meta-item"><span class="meta-label">Finished:</span> <span class="meta-value">${formatTimestamp(endedAt)}</span></span>`
              : nothing
          }
          <span class="fleet-meta-item"><span class="meta-label">Duration:</span> <span class="meta-value">${duration}</span></span>
        </div>

        <div class="pipeline-cost-strip fleet-cost-strip">
          <span class="pipeline-cost-item"><span class="meta-label">Cost:</span> <span class="meta-value">${_formatCost(cost)}</span></span>
        </div>
      </div>
    </div>
  `;
}

function _workRequestSection(fleet) {
  const wr = fleet.work_request || {};
  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Work Request</h3>
      <div class="settings-field">
        <label class="settings-label">Title</label>
        <strong class="fleet-wr-title">${wr.title || '—'}</strong>
      </div>
      ${
        wr.description
          ? html`
            <div class="settings-field">
              <label class="settings-label">Description</label>
              <p class="fleet-wr-description">${wr.description}</p>
            </div>
          `
          : nothing
      }
      ${
        wr.source
          ? html`
            <div class="settings-field">
              <label class="settings-label">Source</label>
              <code class="fleet-meta-mono">${wr.source}</code>
            </div>
          `
          : nothing
      }
    </div>
  `;
}

function _guideSection(fleet, { rerender } = {}) {
  const guide = fleet.guide;
  if (!guide) {
    return html`
      <div class="new-run-section">
        <h3 class="new-run-section-title">Reference Guide</h3>
        <div class="settings-field">
          <span class="settings-field-hint">No guide attached to this fleet.</span>
        </div>
      </div>
    `;
  }

  const guideBody = (() => {
    if (guideLoading) {
      return html`<div class="guide-loading"><sl-spinner></sl-spinner> Loading…</div>`;
    }
    if (guideError === 'guide_not_retrievable') {
      return html`
        <div class="guide-not-retrievable">
          ${guideErrorHint || 'Guide content is not retrievable from this server.'}
        </div>
      `;
    }
    if (guideError) {
      return html`<div class="guide-error">${guideError}</div>`;
    }
    if (guideContent) {
      return html`<div class="markdown-body guide-content">${unsafeHTML(renderMarkdown(guideContent))}</div>`;
    }
    return nothing;
  })();

  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Reference Guide</h3>
      <div class="settings-field">
        <label class="settings-label">Attached files</label>
        <div class="fleet-guide-files">
          ${(guide.filenames || []).map(
            (n) =>
              html`<sl-tag pill size="small" class="fleet-guide-tag">${n}</sl-tag>`,
          )}
        </div>
        <span class="settings-field-hint">Total size: ${_formatBytes(guide.bytes)}.</span>
      </div>
      <div class="settings-tab-actions fleet-guide-actions">
        <sl-button
          size="small"
          class="btn-view-guide"
          @click=${
            rerender
              ? () => {
                  guideDialogOpen = true;
                  rerender();
                }
              : null
          }
        >View guide content</sl-button>
      </div>
      <sl-dialog
        label="Guide Content"
        class="guide-dialog"
        ?open=${guideDialogOpen}
        @sl-after-hide=${
          rerender
            ? () => {
                guideDialogOpen = false;
                rerender();
              }
            : null
        }
      >
        ${guideBody}
      </sl-dialog>
    </div>
  `;
}

// Renders a placeholder for a project whose run hasn't yet appeared in
// state.runs (race during early dispatch, or stale registry). Mirrors the
// structural shape of `runCardView` so the surrounding grid stays aligned.
function _missingRunPlaceholder(child) {
  const status = child.status || 'pending';
  const variant = _childStatusVariant(status);
  return html`
    <div class="run-card ${statusClass(status)} fleet-child-card-placeholder">
      <div class="run-card-top">
        <span class="run-card-status">${unsafeHTML(statusIcon(status, 16))}</span>
        <span class="run-card-title">${_projectName(child.project_path)}</span>
        <sl-badge variant="${variant}" pill class="status-badge-${status}">${status}</sl-badge>
      </div>
      <div class="run-card-meta">
        <span class="run-card-meta-item">
          <span class="meta-label">Project:</span>
          <span class="meta-value">${_projectName(child.project_path)}</span>
        </span>
      </div>
      <div class="run-card-meta">
        <span class="settings-field-hint">Pipeline registry entry not loaded yet.</span>
      </div>
    </div>
  `;
}

function _childrenSection(fleet, { runsById, onSelectRun } = {}) {
  const children = fleet.children || [];

  if (children.length === 0) {
    return html`
      <div class="new-run-section">
        <h3 class="new-run-section-title">Projects</h3>
        <div class="settings-field">
          <span class="settings-field-hint">No projects dispatched yet — fleet orchestrator may still be provisioning targets.</span>
        </div>
      </div>
    `;
  }

  const allHavePr = children.length > 0 && children.every((c) => c.pr_url);
  const headerCount = `${children.length} ${children.length === 1 ? 'project' : 'projects'}`;
  const runs = runsById || {};

  return html`
    <div class="new-run-section fleet-children-section">
      <div class="fleet-children-header">
        <h3 class="new-run-section-title">Projects · ${headerCount}</h3>
        ${
          allHavePr
            ? html`
              <sl-button size="small" class="btn-copy-all-pr-urls">Copy all PR URLs</sl-button>
            `
            : nothing
        }
      </div>
      <div class="run-list fleet-children-list">
        ${children.map((child) => {
          const run = child.run_id ? runs[child.run_id] : null;
          // Anchor id lets the overview's projects strip scroll to the card.
          const anchorId = child.run_id ? `project-${child.run_id}` : null;
          const card = run
            ? runCardView(run, { onClick: onSelectRun })
            : _missingRunPlaceholder(child);
          return anchorId
            ? html`<div id="${anchorId}" class="fleet-project-anchor">${card}</div>`
            : card;
        })}
      </div>
    </div>
  `;
}

function _aggregateCostSection(fleet, { runsById } = {}) {
  const total = _aggregateChildCost(fleet.children || [], runsById);
  return html`
    <div class="new-run-section fleet-aggregate-cost-section">
      <h3 class="new-run-section-title">Aggregate Cost</h3>
      <div class="settings-field">
        <label class="settings-label">Total USD spent</label>
        <span class="fleet-total-cost">${_formatCost(total)}</span>
        <span class="settings-field-hint">Summed across every child's stage iterations.</span>
      </div>
    </div>
  `;
}

function _circuitBreakerAlertView(fleet) {
  // Only show the orange alert when the breaker actually tripped. A
  // user-initiated halt is informational and should not look like an
  // error condition (W-040 §13.7).
  if (fleet.status !== 'halted' || fleet.halt_reason !== 'circuit_breaker') {
    return nothing;
  }
  const cb = fleet.circuit_breaker || {};
  return html`
    <sl-alert variant="warning" open class="fleet-circuit-breaker-alert">
      <sl-icon slot="icon" name="exclamation-triangle"></sl-icon>
      <strong>Circuit breaker tripped.</strong>
      Unstarted children were cancelled; in-flight children finished naturally.
      ${
        cb.unstarted_count != null
          ? html`<span class="cb-unstarted-count">${cb.unstarted_count} children halted before launch.</span>`
          : nothing
      }
      ${cb.trip_reason ? html`<div class="cb-trip-reason">${cb.trip_reason}</div>` : nothing}
    </sl-alert>
  `;
}

function _userHaltAlertView(fleet) {
  if (fleet.status !== 'halted' || fleet.halt_reason === 'circuit_breaker') {
    return nothing;
  }
  return html`
    <sl-alert variant="neutral" open class="fleet-user-halt-alert">
      <sl-icon slot="icon" name="pause-circle"></sl-icon>
      <strong>Halted by operator.</strong>
      In-flight children finished naturally. Resume to re-launch failed or pending children.
    </sl-alert>
  `;
}

// ─── main view ────────────────────────────────────────────────────────────────

/**
 * Renders the fleet detail page.
 *
 * Three states:
 *   - `fleet` present                    → full detail page
 *   - `fleet === null && missing`        → cleaned-up empty state
 *   - `fleet === null && !missing`       → loading spinner
 *
 * @param {object|null} fleet     Full fleet manifest from GET /api/fleet-runs/:id (null while loading or missing)
 * @param {{ rerender?: function, runsById?: object, onSelectRun?: function, missing?: boolean, fleetId?: string }} options
 */
export function fleetDetailView(
  fleet,
  { rerender, runsById, onSelectRun, missing, fleetId } = {},
) {
  if (!fleet) {
    if (missing) {
      return html`
        <div class="fleet-detail-empty">
          <sl-icon name="archive" library="default"></sl-icon>
          <h2>Fleet not found</h2>
          <p>
            ${
              fleetId
                ? html`The fleet manifest for
                  <code>${fleetId}</code> is no longer available.`
                : html`The fleet manifest is no longer available.`
            }
            It has been cleaned up or was never created.
          </p>
          <p class="fleet-detail-empty-hint">
            Per-project run history is still accessible from the
            <a href="#/history">History</a> view.
          </p>
        </div>
      `;
    }
    return html`<div class="fleet-detail-loading"><sl-spinner></sl-spinner> Loading fleet…</div>`;
  }

  return html`
    <div class="new-run-page fleet-detail-page">
      ${_fleetOverviewSection(fleet, { runsById })}
      ${_circuitBreakerAlertView(fleet)}
      ${_userHaltAlertView(fleet)}
      <div class="new-run-form fleet-detail-body">
        ${_workRequestSection(fleet)}
        ${_guideSection(fleet, { rerender })}
        ${_childrenSection(fleet, { runsById, onSelectRun })}
        ${_aggregateCostSection(fleet, { runsById })}
      </div>
    </div>
  `;
}
