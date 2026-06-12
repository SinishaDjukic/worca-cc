import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { formatDuration } from '../utils/duration.js';
import { iconSvg, Trash2 } from '../utils/icons.js';
import { sortByStartDesc } from '../utils/sort-runs.js';
import { statusClass, statusIcon } from '../utils/status-badge.js';
import { groupByFleet } from './group-rendering.js';

function _formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

function _formatAge(ageSeconds) {
  return formatDuration((ageSeconds || 0) * 1000);
}

function _groupLabel(wt) {
  // Returns { kind, id } so consumers can pick separate labels ("Fleet:" /
  // "Workspace:") and route to the right detail page. The previous
  // "fleet:<id>" / "workspace:<id>" prefix-string form is kept by callers
  // that still want a single token for filtering.
  if (wt.group_type === 'fleet' && wt.fleet_id)
    return { kind: 'fleet', id: wt.fleet_id };
  if (wt.group_type === 'workspace' && wt.workspace_id)
    return { kind: 'workspace', id: wt.workspace_id };
  return null;
}

function _matchesFilter(wt, filter) {
  const q = filter.toLowerCase();
  const g = _groupLabel(wt);
  const groupHaystack = g ? `${g.kind} ${g.id}` : '';
  return (
    (wt.title || '').toLowerCase().includes(q) ||
    (wt.branch || '').toLowerCase().includes(q) ||
    groupHaystack.toLowerCase().includes(q) ||
    (wt.worktree_path || '').toLowerCase().includes(q)
  );
}

const STATUS_BADGE_VARIANT = {
  running: 'primary',
  completed: 'success',
  failed: 'danger',
  paused: 'warning',
  cancelled: 'neutral',
};

function _statusBadgeVariant(status) {
  return STATUS_BADGE_VARIANT[status] || 'neutral';
}

function _diskSummaryView(worktrees, diskWarningBytes = 2_000_000_000) {
  const total = worktrees.reduce((s, w) => s + (w.disk_bytes || 0), 0);
  const cleanable = worktrees
    .filter((w) => w.status === 'completed')
    .reduce((s, w) => s + (w.disk_bytes || 0), 0);
  const resumable = worktrees.filter((w) => w.resumable);
  const resumableBytes = resumable.reduce((s, w) => s + (w.disk_bytes || 0), 0);
  const over2gb = total > diskWarningBytes;

  // Documents the server-side WALK_SKIP_DIRS exclusion so users aren't
  // surprised when `du -sh` reports a larger number.
  const caveat = html`<div class="worktrees-disk-caveat">Excludes node_modules, .git, and build/cache dirs</div>`;

  // Warning banner only when over the threshold; otherwise a quiet meta line.
  if (over2gb) {
    return html`
      <sl-alert variant="warning" open class="worktrees-disk-alert">
        <strong>Worktree disk usage is high:</strong>
        ${_formatBytes(total)} across ${worktrees.length} worktrees
        (${_formatBytes(cleanable)} cleanable
        ${
          resumable.length > 0
            ? html` · ${_formatBytes(resumableBytes)} held by resumable runs`
            : nothing
        }).
      </sl-alert>
      ${caveat}
    `;
  }

  return html`
    <div class="worktrees-summary">
      <span class="meta-label">Total disk:</span>
      <span class="meta-value">${_formatBytes(total)}</span>
      <span class="meta-sep">·</span>
      <span class="meta-label">Cleanable:</span>
      <span class="meta-value">${_formatBytes(cleanable)}</span>
      ${
        resumable.length > 0
          ? html`
              <span class="meta-sep">·</span>
              <span class="meta-label">Held by resumable:</span>
              <span class="meta-value">${_formatBytes(resumableBytes)}</span>
            `
          : nothing
      }
      <span class="meta-sep">·</span>
      <span class="meta-label">Note:</span>
      <span class="meta-value">Excludes node_modules, .git, and build/cache dirs</span>
    </div>
  `;
}

function _cardView(wt, { onSelectRun, onCleanup } = {}) {
  const isRunning = wt.status === 'running';
  const cleanupState = wt.cleanup_state || null; // 'pending' | 'cleaning' | null
  const isCleaning = !!cleanupState;
  const cleanupError = wt.cleanup_error || null;
  const groupLabel = _groupLabel(wt);
  const status = wt.status || 'unknown';
  // Whole card is the click target — matches run-card behaviour. The
  // Cleanup button stops propagation so it doesn't trigger navigation.
  const cardClick = onSelectRun ? () => onSelectRun(wt.run_id) : null;
  const cleanupDisabled = isRunning || isCleaning;

  return html`
    <div
      class="run-card worktree-card ${statusClass(status)}${isCleaning ? ' worktree-card-cleaning' : ''}"
      @click=${cardClick}
    >
      <div class="run-card-top">
        <span class="run-card-status">
          ${unsafeHTML(statusIcon(status, 16))}
        </span>
        <span class="run-card-title">${wt.title || wt.run_id}</span>
        ${
          isCleaning
            ? html`<sl-badge variant="warning" pill class="status-badge-cleaning"><sl-spinner class="badge-spinner"></sl-spinner> ${cleanupState}</sl-badge>`
            : html`<sl-badge
                variant="${_statusBadgeVariant(status)}"
                pill
                class="status-badge-${status}"
              >
                ${status}
              </sl-badge>`
        }
      </div>
      ${
        wt.project || groupLabel
          ? html`
              <div class="run-card-meta">
                ${
                  wt.project
                    ? html`<span class="run-card-meta-item">
                        <span class="meta-label">Project:</span>
                        <span class="meta-value run-card-project">${wt.project}</span>
                      </span>`
                    : nothing
                }
                ${
                  groupLabel
                    ? html`<span class="run-card-meta-item">
                        <span class="meta-label">${groupLabel.kind === 'fleet' ? 'Fleet:' : 'Workspace:'}</span>
                        <a
                          class="meta-value run-card-group-link"
                          href="#/${groupLabel.kind === 'fleet' ? 'fleet-runs' : 'workspace-runs'}/${groupLabel.id}"
                          @click=${(e) => e.stopPropagation()}
                        >${groupLabel.id}</a>
                      </span>`
                    : nothing
                }
              </div>
            `
          : nothing
      }
      ${(() => {
        const defaultBranch = wt._default_branch || '';
        const targetBranch = wt.target_branch || '';
        return html`<div class="run-card-meta">
          <span class="run-card-meta-item">
            <span class="meta-label">Source Branch:</span>
            <span class="meta-value">${wt.branch || '—'}</span>
          </span>
          ${targetBranch && targetBranch !== defaultBranch ? html`<span class="run-card-meta-item"><span class="meta-label">Target Branch:</span> <span class="meta-value">${targetBranch}</span></span>` : nothing}
          <span class="run-card-meta-item">
            <span class="meta-label">Disk:</span>
            <span class="meta-value">${wt.truncated ? html`≥ ${_formatBytes(wt.disk_bytes)}` : _formatBytes(wt.disk_bytes)}</span>
          </span>
          <span class="run-card-meta-item">
            <span class="meta-label">Age:</span>
            <span class="meta-value">${_formatAge(wt.age_seconds)}</span>
          </span>
        </div>`;
      })()}
      <div class="run-card-meta worktree-card-path">
        <span class="meta-label">Path:</span>
        <code class="worktree-path-mono">${wt.worktree_path}</code>
      </div>
      ${
        cleanupError
          ? html`<div class="worktree-card-cleanup-error">
              <strong>Cleanup failed:</strong> ${cleanupError}
            </div>`
          : nothing
      }
      <div class="run-card-actions">
        <sl-button
          size="small"
          variant="danger"
          outline
          class="btn-cleanup${cleanupDisabled ? ' btn-cleanup-disabled' : ''}"
          ?disabled=${cleanupDisabled}
          title=${
            isRunning
              ? 'Cannot cleanup a running worktree'
              : isCleaning
                ? 'Cleanup already in progress'
                : nothing
          }
          @click=${(e) => {
            e.stopPropagation();
            if (!cleanupDisabled && onCleanup) onCleanup(wt);
          }}
        >
          ${
            isCleaning
              ? html`<sl-spinner class="btn-cleanup-spinner"></sl-spinner> ${cleanupState}`
              : html`${unsafeHTML(iconSvg(Trash2, 12))} Cleanup`
          }
        </sl-button>
      </div>
    </div>
  `;
}

function _cleanupDialogView(
  dialogItem,
  dialogCheckbox,
  { onDialogClose, onDialogConfirm, onDialogCheckboxChange } = {},
) {
  if (!dialogItem) return nothing;

  const needsCheckbox = dialogItem.resumable || !!dialogItem.group_type;
  const isGrouped = !!dialogItem.group_type;
  const confirmDisabled = needsCheckbox && !dialogCheckbox;

  return html`
    <sl-dialog
      label="Cleanup worktree"
      class="worktrees-dialog-cleanup"
      open
      @sl-request-close=${onDialogClose}
    >
      <p>
        Remove worktree for
        <strong>${dialogItem.title || dialogItem.run_id}</strong>?
      </p>
      ${
        isGrouped
          ? (
              () => {
                const g = _groupLabel(dialogItem);
                const kindLabel = g?.kind === 'fleet' ? 'fleet' : 'workspace';
                return html`
                <sl-alert variant="warning" open class="group-warning">
                  This worktree belongs to ${kindLabel}
                  <strong>${g?.id ?? ''}</strong> — removing it will
                  block the ${kindLabel}'s <code>--resume</code> for this child.
                </sl-alert>
              `;
              }
            )()
          : nothing
      }
      ${
        needsCheckbox
          ? html`
              <sl-checkbox
                class="cleanup-resume-checkbox"
                ?checked=${dialogCheckbox}
                @sl-change=${
                  onDialogCheckboxChange
                    ? (e) => onDialogCheckboxChange(e.target.checked)
                    : null
                }
              >
                I understand resume will be unavailable
              </sl-checkbox>
            `
          : nothing
      }
      <div slot="footer" class="dialog-actions">
        <sl-button variant="default" @click=${onDialogClose}>Cancel</sl-button>
        <sl-button
          variant="danger"
          class="btn-cleanup-confirm${confirmDisabled ? ' btn-cleanup-confirm-disabled' : ''}"
          ?disabled=${confirmDisabled}
          @click=${
            !confirmDisabled && onDialogConfirm && dialogItem
              ? () => onDialogConfirm(dialogItem.run_id, needsCheckbox)
              : null
          }
        >
          ${unsafeHTML(iconSvg(Trash2, 12))} Cleanup
        </sl-button>
      </div>
    </sl-dialog>
  `;
}

function _bulkDialogView(
  worktrees,
  open,
  { onDialogClose, onDialogConfirm } = {},
) {
  const completed = worktrees.filter((w) => w.status === 'completed');
  // No completed → no bulk dialog markup at all (so the toolbar's
  // "Cleanup all completed" button class doesn't leak into the page
  // via the dialog footer).
  if (completed.length === 0) return nothing;
  const totalBytes = completed.reduce((s, w) => s + (w.disk_bytes || 0), 0);

  const { fleetGroups: byFleet, standalone: fleetStandalone } =
    groupByFleet(completed);
  const byWorkspace = {};
  for (const w of fleetStandalone) {
    if (w.group_type === 'workspace' && w.workspace_id) {
      if (!byWorkspace[w.workspace_id]) byWorkspace[w.workspace_id] = [];
      byWorkspace[w.workspace_id].push(w);
    }
  }
  const standalone = fleetStandalone.filter((w) => !w.group_type);

  const groupLines = [
    standalone.length > 0 ? `${standalone.length} standalone` : null,
    ...Object.entries(byFleet).map(
      ([id, ws]) => `${ws.length} from fleet ${id}`,
    ),
    ...Object.entries(byWorkspace).map(
      ([id, ws]) => `${ws.length} from workspace ${id}`,
    ),
  ].filter(Boolean);

  const groupedCount = completed.filter((w) => w.group_type).length;

  return html`
    <sl-dialog
      label="Cleanup all completed worktrees"
      class="worktrees-dialog-bulk"
      ?open=${open}
      @sl-request-close=${onDialogClose}
    >
      <p>
        Clean up ${completed.length} completed worktrees
        (${_formatBytes(totalBytes)} freed)?
      </p>
      ${
        groupLines.length > 0
          ? html`
              <ul class="worktrees-bulk-groups">
                ${groupLines.map((line) => html`<li>${line}</li>`)}
              </ul>
            `
          : nothing
      }
      ${
        groupedCount > 0
          ? html`<p class="bulk-grouped-caveat">Includes ${groupedCount} grouped — resume will be unavailable.</p>`
          : nothing
      }
      <div slot="footer" class="dialog-actions">
        <sl-button variant="default" @click=${onDialogClose}>Cancel</sl-button>
        <sl-button
          variant="danger"
          class="btn-bulk-cleanup-confirm"
          @click=${onDialogConfirm ? () => onDialogConfirm(null, true) : null}
        >
          ${unsafeHTML(iconSvg(Trash2, 12))} Cleanup All
        </sl-button>
      </div>
    </sl-dialog>
  `;
}

// Status chips for the worktrees list — mirrors the History / Fleets
// `.filter-chips`. "all" plus any status that actually occurs (counted
// dynamically, same as run-list).
const WORKTREE_FILTER_STATUSES = [
  'all',
  'running',
  'completed',
  'failed',
  'paused',
  'cancelled',
];

export function worktreesView(
  worktrees,
  {
    diskWarningBytes,
    filter = '',
    onFilter,
    statusFilter = 'all',
    onStatusFilter,
    onSelectRun,
    onCleanup,
    onBulkCleanup,
    dialogItem = null,
    dialogBulk = false,
    dialogCheckbox = false,
    onDialogClose,
    onDialogConfirm,
    onDialogCheckboxChange,
  } = {},
) {
  if (!worktrees || worktrees.length === 0) {
    return html`
      <div class="worktrees-view">
        <div class="empty-state">
          No worktrees yet. Start a run to create one.
        </div>
      </div>
    `;
  }

  // Per-chip counts over the full worktree set (before any filtering),
  // so the chip numbers stay stable as the text filter narrows the list.
  const statusCounts = { all: worktrees.length };
  for (const wt of worktrees) {
    const s = wt.status || 'unknown';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  // Status filter first, then text filter — same ordering as run-list.
  let narrowed =
    statusFilter && statusFilter !== 'all'
      ? worktrees.filter((wt) => (wt.status || 'unknown') === statusFilter)
      : worktrees;
  if (filter) {
    narrowed = narrowed.filter((wt) => _matchesFilter(wt, filter));
  }
  // Sort newest first to match run-list.js. sortByStartDesc keys on
  // started_at and tolerates missing values.
  const filtered = sortByStartDesc(narrowed);
  const completedCount = worktrees.filter(
    (w) => w.status === 'completed',
  ).length;

  return html`
    <div class="worktrees-view">
      ${_diskSummaryView(worktrees, diskWarningBytes)}
      ${
        onStatusFilter
          ? html`
        <div class="filter-chips">
          ${WORKTREE_FILTER_STATUSES.filter(
            (s) => s === 'all' || statusCounts[s],
          ).map(
            (s) => html`
            <button
              class="filter-chip ${(statusFilter || 'all') === s ? 'active' : ''} filter-chip-${s}"
              @click=${() => onStatusFilter(s)}
            >
              ${s === 'all' ? 'All' : s}
              <span class="chip-count">${statusCounts[s] || 0}</span>
            </button>
          `,
          )}
        </div>
      `
          : nothing
      }
      <div class="worktrees-toolbar">
        <sl-input
          size="small"
          class="worktrees-filter"
          type="text"
          placeholder="Filter by title, branch, path, or group…"
          value="${filter || ''}"
          @sl-input=${onFilter ? (e) => onFilter(e.target.value) : null}
        ></sl-input>
        ${
          completedCount > 0
            ? html`
                <sl-button
                  size="small"
                  variant="danger"
                  outline
                  class="btn-bulk-cleanup"
                  @click=${onBulkCleanup}
                >
                  ${unsafeHTML(iconSvg(Trash2, 12))} Cleanup all completed
                  (${completedCount})
                </sl-button>
              `
            : nothing
        }
      </div>
      ${
        filtered.length === 0
          ? html`<div class="empty-state">No worktrees match the filter.</div>`
          : html`
              <div class="run-list worktrees-list">
                ${filtered.map((wt) =>
                  _cardView(wt, { onSelectRun, onCleanup }),
                )}
              </div>
            `
      }
      ${_bulkDialogView(worktrees, dialogBulk, { onDialogClose, onDialogConfirm })}
      ${_cleanupDialogView(dialogItem, dialogCheckbox, {
        onDialogClose,
        onDialogConfirm,
        onDialogCheckboxChange,
      })}
    </div>
  `;
}
