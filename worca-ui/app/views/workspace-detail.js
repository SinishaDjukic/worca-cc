import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { elapsed, formatDuration, formatTimestamp } from '../utils/duration.js';
import { ClipboardCopy, iconSvg } from '../utils/icons.js';
import { renderMarkdown } from '../utils/markdown.js';
import { statusClass, statusIcon } from '../utils/status-badge.js';
import { WORKSPACE_TERMINAL } from '../utils/status-constants.js';
import { dagGraphView } from './dag-graph.js';
import { runCardView } from './run-card.js';

function _copyToClipboard(text, label) {
  if (!text) return;
  navigator.clipboard
    ?.writeText(text)
    .then(() => {
      const evt = new CustomEvent('worca:toast', {
        bubbles: true,
        detail: { message: `${label} copied to clipboard` },
      });
      document.dispatchEvent(evt);
    })
    .catch(() => {});
}

// ─── module-level state ───────────────────────────────────────────────────────

let planDialogOpen = false;
let planEditMode = false;
let planEditContent = '';
let haltConfirmDialogOpen = false;
let cleanupDialogOpen = false;
let cleanupResumeAcked = false;

// Reference Guide state — mirror fleet-detail so the two pages share the
// same fetch-on-open + dialog UX. Each workspace's guide is loaded
// lazily on first dialog open and cached in module state.
let guideDialogOpen = false;
let guideContent = null;
let guideLoading = false;
let guideError = null;
let guideLoadedFor = null; // workspace_id the cached guide belongs to

export function resetWorkspaceDetailState(overrides = {}) {
  planDialogOpen = overrides.planDialogOpen ?? false;
  planEditMode = overrides.planEditMode ?? false;
  planEditContent = overrides.planEditContent ?? '';
  haltConfirmDialogOpen = overrides.haltConfirmDialogOpen ?? false;
  cleanupDialogOpen = overrides.cleanupDialogOpen ?? false;
  cleanupResumeAcked = overrides.cleanupResumeAcked ?? false;
  guideDialogOpen = overrides.guideDialogOpen ?? false;
  guideContent = overrides.guideContent ?? null;
  guideLoading = overrides.guideLoading ?? false;
  guideError = overrides.guideError ?? null;
  guideLoadedFor = overrides.guideLoadedFor ?? null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function _computeChildCost(child) {
  let total = 0;
  for (const stage of Object.values(child.stages || {})) {
    for (const iter of stage.iterations || []) {
      total += iter.cost_usd || 0;
    }
  }
  return total;
}

function _computeTotalCost(children, masterPlannerCost) {
  let total = (children || []).reduce(
    (sum, c) => sum + _computeChildCost(c),
    0,
  );
  if (masterPlannerCost?.cost_usd) {
    total += masterPlannerCost.cost_usd;
  }
  return total;
}

function _formatCost(usd) {
  if (usd == null || usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function _tierProgress(tiers) {
  if (!tiers || tiers.length === 0) return '0 / 0';
  const completed = tiers.filter((t) => t.status === 'completed').length;
  return `${completed} / ${tiers.length}`;
}

function _wallEndedAt(ws) {
  if (
    ws.status === 'running' ||
    ws.status === 'planning' ||
    ws.status === 'integration_testing'
  ) {
    return null;
  }
  // finished_at is preferred — the server synthesizes it from the maximum
  // child status.json updated_at when the manifest doesn't write one
  // explicitly. halted_at / updated_at are kept as additional fallbacks
  // for older manifests and for the user-halt path.
  return ws.finished_at || ws.halted_at || ws.updated_at || null;
}

function _guideConflictsAggregate(children) {
  const byRepo = [];
  for (const child of children || []) {
    const conflicts = child.guide_conflicts;
    if (!conflicts || conflicts.length === 0) continue;
    const project =
      child.project || child.project_path?.split('/').pop() || '—';
    byRepo.push({ project, conflicts });
  }
  if (byRepo.length === 0) return nothing;
  const total = byRepo.reduce((sum, r) => sum + r.conflicts.length, 0);
  const label =
    total === 1
      ? '1 guide conflict across children'
      : `${total} guide conflicts across children`;
  return html`
    <sl-details class="guide-conflicts-aggregate">
      <div slot="summary" class="guide-conflicts-aggregate-header">
        <sl-icon name="exclamation-triangle" class="conflict-icon"></sl-icon>
        <span>${label}</span>
      </div>
      <div class="guide-conflicts-aggregate-list">
        ${byRepo.map(
          ({ project, conflicts }) => html`
          <div class="guide-conflicts-aggregate-group">
            <strong class="guide-conflicts-repo">${project}</strong>
            ${conflicts.map(
              (c) => html`
              <div class="guide-conflict-row">
                <span class="guide-conflict-stage">${c.stage}</span>
                <span class="guide-conflict-message">${c.message}</span>
                <sl-badge variant="neutral" pill class="guide-conflict-source">${c.source}</sl-badge>
              </div>
            `,
            )}
          </div>
        `,
        )}
      </div>
    </sl-details>
  `;
}

const HALTABLE = new Set(['running', 'planning', 'integration_testing']);
const RESUMABLE = new Set(['halted', 'failed', 'integration_failed']);
const TERMINAL = WORKSPACE_TERMINAL;
const PLAN_EDITABLE = new Set(['halted', 'failed', 'integration_failed']);
const RERUN_INTEGRATION = new Set(['integration_failed', 'completed']);

function _depAnnotationLabel(ann) {
  if (ann.type === 'blocks') return `Blocks: ${ann.target}`;
  if (ann.type === 'depends_on') return `Depends on: ${ann.target}`;
  return ann.target;
}

// ─── sub-views ────────────────────────────────────────────────────────────────

function _overviewSection(ws) {
  const startedAt = ws.created_at || null;
  const endedAt = _wallEndedAt(ws);
  const isActive = HALTABLE.has(ws.status);
  const duration = startedAt
    ? formatDuration(elapsed(startedAt, isActive ? null : endedAt))
    : 'N/A';
  // Cost source-of-truth: the server's GET /api/workspace-runs/:id response
  // includes a top-level `cost_usd` aggregated by reading each child's
  // status.json. Prefer that. Fall back to the (always-zero in practice)
  // client-side walk only if it isn't surfaced — keeps tests + offline
  // renders working.
  const cost =
    typeof ws.cost_usd === 'number'
      ? ws.cost_usd
      : _computeTotalCost(ws.children, ws.master_planner_cost);
  const editHref = ws.workspace_json_name
    ? `#/workspaces/${ws.workspace_json_name}/edit`
    : null;

  // Reuse `.fleet-meta-line` / `.fleet-meta-item` classes so the workspace
  // hero meta strip lays out identically to the fleet hero — horizontal
  // wrap, 4px row gap × 20px column gap, label-then-value pairs. The hero
  // breadcrumb and the body's `_actionsRow` were removed: the page-header
  // bar now carries the status badge and Resume/Cleanup/Re-run buttons
  // (mirrors fleet-runs/:id), so showing them twice is just noise.
  return html`
    <div
      class="run-detail-overview workspace-detail-overview"
      data-workspace-id="${ws.workspace_id}"
    >
      <div class="run-info-section fleet-info-section">
        <div class="fleet-overview-status-row">
          <span class="meta-label">Workspace ID:</span>
          <code class="fleet-id-chip">${ws.workspace_id}</code>
          ${
            editHref
              ? html`<a href="${editHref}" class="edit-workspace-json">Edit workspace.json</a>`
              : nothing
          }
        </div>

        <div class="fleet-meta-line">
          <span class="fleet-meta-item">
            <span class="meta-label">Name:</span>
            <span class="meta-value">${ws.workspace_name || ws.name || '—'}</span>
          </span>
          <span class="fleet-meta-item">
            <span class="meta-label">Tiers:</span>
            <span class="meta-value">${_tierProgress(ws.dag?.tiers ?? ws.tiers)}</span>
          </span>
        </div>

        <div class="fleet-meta-line">
          <span class="fleet-meta-item">
            <span class="meta-label">Started:</span>
            <span class="meta-value">${formatTimestamp(startedAt)}</span>
          </span>
          ${
            endedAt
              ? html`<span class="fleet-meta-item">
                  <span class="meta-label">Finished:</span>
                  <span class="meta-value">${formatTimestamp(endedAt)}</span>
                </span>`
              : nothing
          }
          <span class="fleet-meta-item">
            <span class="meta-label">Duration:</span>
            <span class="meta-value">${duration}</span>
          </span>
          <span class="fleet-meta-item">
            <span class="meta-label">Cost:</span>
            <span class="meta-value">${_formatCost(cost)}</span>
          </span>
        </div>

        ${_guideConflictsAggregate(ws.children)}
      </div>
    </div>
  `;
}

function _dagPanel(ws) {
  if (!ws.dag) return nothing;
  // The manifest's `dag` has shape `{tiers, dependency_graph}`. dagGraphView
  // wants a flat list of `{name, depends_on, status}` — synthesize it from
  // the dependency graph (authoritative for edges) and look up live status
  // from the children list.
  const childStatusByName = new Map();
  for (const c of ws.children || []) {
    if (c.project) childStatusByName.set(c.project, c.status);
  }
  const depGraph = ws.dag.dependency_graph || {};
  const dagProjects = Object.keys(depGraph)
    .sort()
    .map((name) => ({
      name,
      depends_on: depGraph[name] || [],
      status: childStatusByName.get(name) || 'pending',
    }));
  if (dagProjects.length === 0) return nothing;
  const { svg } = dagGraphView({ projects: dagProjects }, { mode: 'navigate' });
  if (!svg) return nothing;
  return html`
    <div class="new-run-section workspace-dag-panel">
      <h3 class="new-run-section-title">Dependency Graph</h3>
      <div class="workspace-dag-svg">${unsafeHTML(svg)}</div>
    </div>
  `;
}

function _workRequestSection(ws) {
  const wr = ws.work_request || {};
  // Most workspace launches don't carry a separate title — the prompt is
  // the description. Showing a `Title — —` row in that case is just
  // visual clutter, so omit it entirely when empty.
  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Work Request</h3>
      ${
        wr.title
          ? html`
            <div class="settings-field">
              <label class="settings-label">Title</label>
              <strong class="workspace-wr-title">${wr.title}</strong>
            </div>
          `
          : nothing
      }
      ${
        wr.description
          ? html`
            <div class="settings-field">
              <label class="settings-label">Description</label>
              <p class="workspace-wr-description">${wr.description}</p>
            </div>
          `
          : nothing
      }
    </div>
  `;
}

// Cache of fetched plan content keyed by workspace id. The manifest only
// carries a path (`ws.plan.workspace_plan_path`) — the markdown lives at
// GET /api/workspace-runs/:id/plan, which the panel pulls on demand.
const _planContentCache = new Map();
const _planFetchInFlight = new Set();

export function resetWorkspacePlanCache() {
  _planContentCache.clear();
  _planFetchInFlight.clear();
}

function _ensurePlanFetched(ws, rerender) {
  const id = ws.workspace_id;
  if (!id) return;
  if (_planContentCache.has(id)) return;
  if (_planFetchInFlight.has(id)) return;
  _planFetchInFlight.add(id);
  fetch(`/api/workspace-runs/${encodeURIComponent(id)}/plan`, {
    headers: { Accept: 'text/markdown' },
  })
    .then(async (r) => {
      _planFetchInFlight.delete(id);
      if (!r.ok) {
        _planContentCache.set(id, null);
        return;
      }
      _planContentCache.set(id, await r.text());
      rerender?.();
    })
    .catch(() => {
      _planFetchInFlight.delete(id);
      _planContentCache.set(id, null);
    });
}

function _planPanel(ws, { rerender, onSavePlan } = {}) {
  const canEdit = PLAN_EDITABLE.has(ws.status);
  // Plan content comes from one of three sources, in priority order:
  //   1. ws.workspace_plan — populated by tests and any caller that
  //      inlines the plan text on the manifest object.
  //   2. _planContentCache — populated by the on-demand fetch below.
  //   3. ws.plan.workspace_plan_path — manifest path that triggers the
  //      fetch the first time the dialog opens.
  if (
    (ws.workspace_plan == null || ws.workspace_plan === '') &&
    ws.plan?.workspace_plan_path
  ) {
    _ensurePlanFetched(ws, rerender);
  }
  const cached = _planContentCache.get(ws.workspace_id);
  const planText =
    ws.workspace_plan != null && ws.workspace_plan !== ''
      ? ws.workspace_plan
      : cached || '';
  const hasPlan = planText !== '';

  // Match fleet's REFERENCE GUIDE panel: a compact summary + a "View plan"
  // button that opens the full content in a modal. Keeps the body
  // scannable instead of letting a multi-page <pre> dominate it.
  const summary = hasPlan
    ? html`<span class="settings-field-hint">Generated workspace plan with per-project breakdown.</span>`
    : html`<span class="settings-field-hint">No workspace plan available.</span>`;

  const planBody = planEditMode
    ? html`
        <sl-textarea
          rows="30"
          class="plan-edit-textarea code"
          value="${planEditContent}"
          @sl-input=${
            rerender
              ? (e) => {
                  planEditContent = e.target.value;
                }
              : null
          }
        ></sl-textarea>
      `
    : html`<div class="workspace-plan-content markdown-body">${unsafeHTML(renderMarkdown(planText))}</div>`;

  return html`
    <div class="new-run-section workspace-plan-panel">
      <h3 class="new-run-section-title">Workspace Plan</h3>
      <div class="settings-field">${summary}</div>
      ${
        hasPlan
          ? html`
            <div class="settings-tab-actions">
              <sl-button
                size="small"
                class="btn-view-plan"
                @click=${
                  rerender
                    ? () => {
                        planDialogOpen = true;
                        planEditMode = false;
                        planEditContent = planText;
                        rerender();
                      }
                    : null
                }
              >View plan</sl-button>
            </div>
          `
          : nothing
      }
      <sl-dialog
        label="Workspace Plan"
        class="plan-edit-dialog markdown-dialog"
        ?open=${planDialogOpen}
        @sl-after-hide=${
          rerender
            ? () => {
                planDialogOpen = false;
                planEditMode = false;
                rerender();
              }
            : null
        }
      >
        ${planBody}
        <div slot="footer">
          ${
            canEdit && !planEditMode
              ? html`
                <sl-button
                  class="btn-edit-plan"
                  @click=${
                    rerender
                      ? () => {
                          planEditMode = true;
                          rerender();
                        }
                      : null
                  }
                >Edit plan</sl-button>
              `
              : nothing
          }
          ${
            canEdit && planEditMode
              ? html`
                <sl-button
                  variant="primary"
                  class="btn-save-plan"
                  @click=${
                    onSavePlan
                      ? () => {
                          onSavePlan(planEditContent);
                          planDialogOpen = false;
                          planEditMode = false;
                          if (rerender) rerender();
                        }
                      : null
                  }
                >Save</sl-button>
              `
              : nothing
          }
          ${
            !planEditMode
              ? html`
                <sl-button
                  class="btn-copy-plan"
                  @click=${() => _copyToClipboard(planText, 'Workspace plan')}
                >
                  <span slot="prefix">${unsafeHTML(iconSvg(ClipboardCopy, 14))}</span>
                  Copy
                </sl-button>
              `
              : nothing
          }
          <sl-button
            variant="primary"
            class="btn-close-plan"
            @click=${
              rerender
                ? () => {
                    planDialogOpen = false;
                    planEditMode = false;
                    rerender();
                  }
                : null
            }
          >Close</sl-button>
        </div>
      </sl-dialog>
    </div>
  `;
}

function _contextArtifactsPanel(ws) {
  const artifacts = ws.context_artifacts;
  if (!artifacts || Object.keys(artifacts).length === 0) return nothing;

  const entries = Object.entries(artifacts);
  return html`
    <div class="new-run-section context-artifacts-panel">
      <h3 class="new-run-section-title">Context Artifacts</h3>
      <sl-tab-group>
        ${entries.map(
          ([edge, content], i) => html`
            <sl-tab slot="nav" panel="artifact-${i}">${edge}</sl-tab>
            <sl-tab-panel name="artifact-${i}">
              <div class="markdown-body context-artifact-content">${unsafeHTML(renderMarkdown(content))}</div>
            </sl-tab-panel>
          `,
        )}
      </sl-tab-group>
    </div>
  `;
}

function _aggregateCostSection(ws) {
  // Same source-of-truth as the hero meta strip: the server-aggregated
  // `cost_usd` (walks each child's real status.json). The legacy
  // `_computeTotalCost` walks `child.stages` which the manifest's child
  // entries don't carry — it always returns 0. Keep the legacy path as
  // a test-only fallback when ws.cost_usd is undefined.
  const total =
    typeof ws.cost_usd === 'number'
      ? ws.cost_usd
      : _computeTotalCost(ws.children, ws.master_planner_cost);
  return html`
    <div class="new-run-section workspace-aggregate-cost">
      <h3 class="new-run-section-title">Aggregate Cost</h3>
      <div class="settings-field">
        <label class="settings-label">Total USD spent</label>
        <span class="workspace-total-cost">${_formatCost(total)}</span>
        <span class="settings-field-hint">Summed across all child runs and master planner.</span>
      </div>
    </div>
  `;
}

function _integrationTestPanel(ws) {
  // Accept both shapes the manifest has carried at various times:
  //   - `ws.integration` (legacy) with `{enabled, command, cwd, status}`
  //   - `ws.integration_test` (current) with `{status, exit_code, log_path,
  //     command?, cwd?}` — command/cwd may live on the workspace.json
  //     `integration_test` definition the manifest doesn't necessarily
  //     persist, so we fall back to the run-level fields when present.
  // Render only when an actual command exists somewhere (no point showing
  // a "skipped" badge if the workspace was never configured with one).
  const legacy = ws.integration;
  const current = ws.integration_test;
  const integ = legacy ?? current ?? {};
  const command = integ.command || legacy?.command || null;
  if (!command) return nothing;

  const showRerun = RERUN_INTEGRATION.has(ws.status);

  return html`
    <div class="new-run-section integration-test-panel">
      <h3 class="new-run-section-title">Integration Test</h3>
      <div class="settings-field">
        <label class="settings-label">Command</label>
        <code class="integration-command">${command}</code>
      </div>
      ${
        integ.cwd
          ? html`
            <div class="settings-field">
              <label class="settings-label">Working directory</label>
              <code>${integ.cwd}</code>
            </div>
          `
          : nothing
      }
      ${
        integ.status
          ? html`
            <div class="settings-field">
              <label class="settings-label">Status</label>
              <sl-badge variant="${integ.status === 'passed' ? 'success' : 'danger'}">${integ.status}</sl-badge>
            </div>
          `
          : nothing
      }
      ${
        showRerun
          ? html`
            <div class="settings-tab-actions">
              <sl-button size="small" class="btn-rerun-integration">Re-run integration test</sl-button>
            </div>
          `
          : nothing
      }
    </div>
  `;
}

// ─── reference guide (mirrors fleet-detail._guideSection) ───────────────────

function _ensureGuideFetched(ws, rerender) {
  if (guideLoading) return;
  if (guideLoadedFor === ws.workspace_id) return;
  if (!ws.guide || !(ws.guide.paths || ws.guide.filenames || []).length) return;
  guideLoading = true;
  guideError = null;
  fetch(`/api/workspace-runs/${encodeURIComponent(ws.workspace_id)}/guide`, {
    headers: { Accept: 'text/markdown' },
  })
    .then(async (r) => {
      guideLoading = false;
      guideLoadedFor = ws.workspace_id;
      if (!r.ok) {
        guideError =
          'Guide content is not retrievable from this server (older manifest or pruned files).';
        rerender?.();
        return;
      }
      guideContent = await r.text();
      rerender?.();
    })
    .catch((err) => {
      guideLoading = false;
      guideLoadedFor = ws.workspace_id;
      guideError = err?.message || 'Failed to load guide';
      rerender?.();
    });
}

function _formatBytes(b) {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function _guideSection(ws, { rerender } = {}) {
  const guide = ws.guide;
  const filenames = guide?.filenames || [];
  if (!guide || filenames.length === 0) {
    return html`
      <div class="new-run-section">
        <h3 class="new-run-section-title">Reference Guide</h3>
        <div class="settings-field">
          <span class="settings-field-hint">No guide attached to this workspace run.</span>
        </div>
      </div>
    `;
  }

  const guideBody = (() => {
    if (guideLoading) {
      return html`<div class="guide-loading"><sl-spinner></sl-spinner> Loading…</div>`;
    }
    if (guideError) {
      return html`<div class="guide-error">${guideError}</div>`;
    }
    if (guideContent) {
      return html`<div class="guide-content markdown-body">${unsafeHTML(renderMarkdown(guideContent))}</div>`;
    }
    return nothing;
  })();

  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Reference Guide</h3>
      <div class="settings-field">
        <label class="settings-label">Attached files</label>
        <div class="fleet-guide-files">
          ${filenames.map(
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
                  _ensureGuideFetched(ws, rerender);
                  rerender();
                }
              : null
          }
        >View guide content</sl-button>
      </div>
      <sl-dialog
        label="Guide Content"
        class="guide-dialog markdown-dialog"
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
        <div slot="footer">
          ${
            guideContent
              ? html`
                <sl-button
                  class="btn-copy-guide"
                  @click=${() =>
                    _copyToClipboard(guideContent, 'Guide content')}
                >
                  <span slot="prefix">${unsafeHTML(iconSvg(ClipboardCopy, 14))}</span>
                  Copy
                </sl-button>
              `
              : nothing
          }
          <sl-button
            variant="primary"
            class="btn-close-guide"
            @click=${
              rerender
                ? () => {
                    guideDialogOpen = false;
                    rerender();
                  }
                : null
            }
          >Close</sl-button>
        </div>
      </sl-dialog>
    </div>
  `;
}

// ─── repos / children (mirrors fleet-detail._childrenSection) ───────────────

function _childStatusVariant(status) {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'unrecoverable') return 'danger';
  if (status === 'running' || status === 'in_progress') return 'primary';
  if (status === 'halted' || status === 'paused') return 'warning';
  return 'neutral';
}

function _missingRunPlaceholder(child) {
  const status = child.status || 'pending';
  const variant = _childStatusVariant(status);
  const projectName =
    child.project || child.project_path?.split('/').pop() || '—';
  return html`
    <div class="run-card ${statusClass(status)} fleet-child-card-placeholder">
      <div class="run-card-top">
        <span class="run-card-status">${unsafeHTML(statusIcon(status, 16))}</span>
        <span class="run-card-title">${projectName}</span>
        <sl-badge variant="${variant}" pill class="status-badge-${status}">${status}</sl-badge>
      </div>
      <div class="run-card-meta">
        <span class="run-card-meta-item">
          <span class="meta-label">Project:</span>
          <span class="meta-value">${projectName}</span>
        </span>
        ${
          child.tier != null
            ? html`<span class="run-card-meta-item">
                <span class="meta-label">Tier:</span>
                <span class="meta-value">${child.tier}</span>
              </span>`
            : nothing
        }
      </div>
      <div class="run-card-meta">
        <span class="settings-field-hint">Pipeline registry entry not loaded yet.</span>
      </div>
    </div>
  `;
}

function _childrenSection(ws, { runsById, onSelectRun } = {}) {
  const children = ws.children || [];

  if (children.length === 0) {
    return html`
      <div class="new-run-section">
        <h3 class="new-run-section-title">Projects</h3>
        <div class="settings-field">
          <span class="settings-field-hint">No projects dispatched yet — workspace orchestrator may still be planning or provisioning.</span>
        </div>
      </div>
    `;
  }

  const headerCount = `${children.length} ${children.length === 1 ? 'project' : 'projects'}`;
  const anyHavePr = children.some((c) => c.pr_url);
  const runs = runsById || {};

  return html`
    <div class="new-run-section fleet-children-section workspace-children-section">
      <div class="fleet-children-header">
        <h3 class="new-run-section-title">Projects · ${headerCount}</h3>
        ${
          anyHavePr
            ? html`<sl-button size="small" class="btn-copy-all-pr-urls">Copy all PR URLs</sl-button>`
            : nothing
        }
      </div>
      ${
        ws.umbrella_issue_url
          ? html`
            <div class="settings-field">
              <a href="${ws.umbrella_issue_url}" target="_blank" class="umbrella-issue-link">View umbrella issue</a>
            </div>
          `
          : nothing
      }
      <div class="run-list fleet-children-list">
        ${children.map((child) => {
          const run = child.run_id ? runs[child.run_id] : null;
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

function _actionsRow(
  ws,
  { rerender, onHalt, onResume, onCleanup, onRerun } = {},
) {
  const showHalt = HALTABLE.has(ws.status);
  const showResume = RESUMABLE.has(ws.status);
  const showCleanup = TERMINAL.has(ws.status);
  const showRerun = TERMINAL.has(ws.status);
  const isNonCompleted = ws.status !== 'completed';

  return html`
    <div class="workspace-actions">
      ${
        showHalt
          ? html`
            <sl-button
              variant="danger"
              outline
              class="btn-halt"
              @click=${
                rerender
                  ? () => {
                      haltConfirmDialogOpen = true;
                      rerender();
                    }
                  : null
              }
            >Halt workspace</sl-button>
          `
          : nothing
      }
      ${
        showResume
          ? html`
            <sl-button
              variant="success"
              class="btn-resume"
              @click=${onResume || null}
            >Resume workspace</sl-button>
          `
          : nothing
      }
      ${
        showCleanup
          ? html`
            <sl-button
              variant="warning"
              outline
              class="btn-cleanup"
              @click=${
                rerender
                  ? () => {
                      cleanupDialogOpen = true;
                      cleanupResumeAcked = false;
                      rerender();
                    }
                  : null
              }
            >Cleanup workspace</sl-button>
          `
          : nothing
      }
      ${
        showRerun
          ? html`
            <sl-button
              variant="neutral"
              class="btn-rerun"
              @click=${onRerun || null}
            >Re-run workspace</sl-button>
          `
          : nothing
      }

      <sl-dialog
        label="Halt Workspace"
        class="halt-confirm-dialog"
        ?open=${haltConfirmDialogOpen}
        @sl-after-hide=${
          rerender
            ? () => {
                haltConfirmDialogOpen = false;
                rerender();
              }
            : null
        }
      >
        <p>In-flight tier children will finish. Unstarted tiers will not be launched.</p>
        <div slot="footer">
          <sl-button variant="danger" class="btn-confirm-halt" @click=${onHalt || null}>Halt</sl-button>
        </div>
      </sl-dialog>

      <sl-dialog
        label="Cleanup Workspace"
        class="cleanup-confirm-dialog"
        ?open=${cleanupDialogOpen}
        @sl-after-hide=${
          rerender
            ? () => {
                cleanupDialogOpen = false;
                rerender();
              }
            : null
        }
      >
        <p>This will remove all child worktrees and the workspace run directory.</p>
        ${
          isNonCompleted
            ? html`
              <div class="resume-loss-warning">
                <sl-checkbox
                  class="cleanup-resume-ack"
                  ?checked=${cleanupResumeAcked}
                  @sl-change=${
                    rerender
                      ? (e) => {
                          cleanupResumeAcked = e.target.checked;
                          rerender();
                        }
                      : null
                  }
                >I understand this workspace cannot be resumed after cleanup.</sl-checkbox>
              </div>
            `
            : nothing
        }
        <div slot="footer">
          <sl-button variant="danger" class="btn-confirm-cleanup" @click=${onCleanup || null}>Cleanup</sl-button>
        </div>
      </sl-dialog>
    </div>
  `;
}

function _circuitBreakerAlertView(ws) {
  if (ws.status !== 'halted' || ws.halt_reason !== 'circuit_breaker') {
    return nothing;
  }
  const cb = ws.circuit_breaker || {};
  return html`
    <sl-alert variant="warning" open class="workspace-circuit-breaker-alert">
      <sl-icon slot="icon" name="exclamation-triangle"></sl-icon>
      <strong>Circuit breaker tripped.</strong>
      Unstarted tiers were cancelled; in-flight children finished naturally.
      ${
        cb.unstarted_count != null
          ? html`<span class="cb-unstarted-count">${cb.unstarted_count} children halted before launch.</span>`
          : nothing
      }
      ${cb.trip_reason ? html`<div class="cb-trip-reason">${cb.trip_reason}</div>` : nothing}
    </sl-alert>
  `;
}

function _userHaltAlertView(ws) {
  if (ws.status !== 'halted' || ws.halt_reason === 'circuit_breaker') {
    return nothing;
  }
  return html`
    <sl-alert variant="neutral" open class="workspace-user-halt-alert">
      <sl-icon slot="icon" name="pause-circle"></sl-icon>
      <strong>Halted by operator.</strong>
      In-flight tier children finished naturally. Resume to continue from the halted tier.
    </sl-alert>
  `;
}

// ─── main view ────────────────────────────────────────────────────────────────

export function workspaceDetailView(
  workspace,
  {
    rerender,
    missing,
    workspaceId,
    // onHalt / onResume / onCleanup / onRerun were consumed by the
    // bottom-of-body `_actionsRow`. Those buttons live in the page-header
    // bar now (driven by main.js' contentHeaderView for workspace-runs/:id),
    // so the callbacks are accepted-but-unused here for API compatibility.
    onHalt: _onHalt,
    onResume: _onResume,
    onCleanup: _onCleanup,
    onRerun: _onRerun,
    onSavePlan,
    // Mirror fleet-detail's signature: runsById is the map of `state.runs`
    // keyed by run_id so _childrenSection can render the rich runCardView
    // for each child instead of a sparse table. onSelectRun is plumbed
    // through to the cards so clicking jumps to /history/:run_id.
    runsById,
    onSelectRun,
  } = {},
) {
  if (!workspace) {
    if (missing) {
      return html`
        <div class="workspace-detail-empty">
          <sl-icon name="archive" library="default"></sl-icon>
          <h2>Workspace not found</h2>
          <p>
            ${
              workspaceId
                ? html`The workspace manifest for
                  <code>${workspaceId}</code> is no longer available.`
                : html`The workspace manifest is no longer available.`
            }
            It has been cleaned up or was never created.
          </p>
          <p class="workspace-detail-empty-hint">
            Per-project run history is still accessible from the
            <a href="#/history">History</a> view.
          </p>
        </div>
      `;
    }
    return html`<div class="workspace-detail-loading"><sl-spinner></sl-spinner> Loading workspace…</div>`;
  }

  // Body order mirrors fleet-detail wherever a concept exists, with the
  // workspace-only additions slotted into the most natural positions:
  //
  //   1. WORK REQUEST       (aligned with fleet)
  //   2. REFERENCE GUIDE    (aligned with fleet — guide loaded on demand)
  //   3. DEPENDENCY GRAPH   (workspace-only structural info)
  //   4. REPOS · N repos    (aligned with fleet's PROJECTS — runCardView per child)
  //   5. WORKSPACE PLAN     (workspace-only, folded behind a View plan modal)
  //   6. INTEGRATION TEST   (workspace-only, only when configured)
  //   7. CONTEXT ARTIFACTS  (workspace-only, only when populated)
  //   8. AGGREGATE COST     (aligned with fleet)
  //
  // Header actions (Resume / Cleanup / Re-run) live in the page-header
  // bar — see main.js' contentHeaderView for workspace-runs/:id.
  // onHalt/onResume/onCleanup/onRerun stay in the signature for API
  // compatibility but the body doesn't render its own action row.
  return html`
    <div class="new-run-page workspace-detail-page">
      ${_overviewSection(workspace)}
      ${_circuitBreakerAlertView(workspace)}
      ${_userHaltAlertView(workspace)}
      <div class="new-run-form workspace-detail-body">
        ${_workRequestSection(workspace)}
        ${_guideSection(workspace, { rerender })}
        ${_dagPanel(workspace)}
        ${_childrenSection(workspace, { runsById, onSelectRun })}
        ${_planPanel(workspace, { rerender, onSavePlan })}
        ${_integrationTestPanel(workspace)}
        ${_contextArtifactsPanel(workspace)}
        ${_aggregateCostSection(workspace)}
      </div>
    </div>
  `;
}
