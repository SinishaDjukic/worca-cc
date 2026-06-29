import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { elapsed, formatDuration, formatTimestamp } from '../utils/duration.js';
import { effortLevelBadge } from '../utils/effort-badge.js';
import { helpFor } from '../utils/help-links.js';
import {
  AlertTriangle,
  BarChart3,
  CircleCheck,
  ClipboardCopy,
  Clock,
  Coins,
  ExternalLink,
  FileText,
  FolderTree,
  GitBranch,
  GitPullRequest,
  iconSvg,
  List,
  RefreshCw,
  RotateCcw,
  Timer,
  X,
} from '../utils/icons.js';
import { renderMarkdown } from '../utils/markdown.js';
import { scrollOnExpand } from '../utils/scroll.js';
import { sortByStageOrder } from '../utils/stage-order.js';
import {
  resolveStatus,
  statusClass,
  statusIcon,
} from '../utils/status-badge.js';
import {
  beadsDependencyGraph,
  beadTooltipContent,
  priorityVariant,
  statusVariant,
} from './beads-panel.js';
import { prCommentsView } from './run-detail-pr-comments.js';
import { resolveIterationTab } from './stage-tab-memory.js';
import { stageTimelineView } from './stage-timeline.js';

// ── deferred PR creation: client-side in-flight tracking ─────────────────
export const _prCreationState = new Map(); // run.id -> { inFlight, error, created?, createdPrUrl? }

// ── plan artifact: lazy fetch + dialog state ─────────────────────────────
// The PLAN stage's plan_file (or {worktree}/MASTER_PLAN.md) is fetched from
// GET /api/projects/:project/runs/:run_id/plan on first dialog open and
// cached per-run. Same UX shape as the workspace-detail plan dialog: marked
// renders the markdown, .markdown-dialog widens the panel, Copy footer
// hands the raw source back to the user.
// W-061: plans are append-only numbered revisions (plan-001.md, …). The dialog
// lists them and lets the user view any revision; the latest is the current
// plan. Content is cached per (run, revision); the iteration list per run.
const _runPlanText = new Map(); // `${runId}#${n|'latest'}` -> markdown string
const _runPlanTextFetching = new Set();
export const _runPlanTextNotFound = new Set();
const _runPlanIters = new Map(); // run_id -> [{n, file}]  (empty for legacy runs)
const _runPlanItersFetching = new Set();
let _planDialogRunId = null; // null when closed; run_id when open
let _planDialogIter = null; // selected revision number, or null = latest/current
let _issuesDialogRunId = null; // null when closed; run_id when open
let _issuesDialogIter = null; // iteration whose issues are shown

// The run's project name is needed because the endpoint is mounted under
// /api/projects/:projectId. Run objects carry it as `project` or `_project`;
// fall back to the legacy /api/runs base for single-project mode.
function _runApiBase(run) {
  const runId = encodeURIComponent(run.id);
  const project = run.project || run._project || null;
  return project
    ? `/api/projects/${encodeURIComponent(project)}/runs/${runId}`
    : `/api/runs/${runId}`;
}

function _planTextKey(runId, n) {
  return `${runId}#${n == null ? 'latest' : n}`;
}

export function _ensurePlanItersFetched(run, rerender) {
  const runId = run?.id;
  if (!runId) return;
  if (_runPlanIters.has(runId) || _runPlanItersFetching.has(runId)) return;
  _runPlanItersFetching.add(runId);
  fetch(`${_runApiBase(run)}/plan-iterations`, {
    headers: { Accept: 'application/json' },
  })
    .then(async (r) => {
      _runPlanItersFetching.delete(runId);
      if (!r.ok) {
        rerender?.();
        return;
      }
      let list = [];
      try {
        const j = await r.json();
        if (Array.isArray(j?.iterations)) list = j.iterations;
      } catch {
        list = [];
      }
      _runPlanIters.set(runId, list);
      rerender?.();
    })
    .catch(() => {
      _runPlanItersFetching.delete(runId);
      rerender?.();
    });
}

// n === null fetches the current (latest) plan via /plan; a number fetches a
// specific revision via /plan?iteration=N.
export function _ensureRunPlanFetched(run, n, rerender) {
  const runId = run?.id;
  if (!runId) return;
  const key = _planTextKey(runId, n);
  if (_runPlanText.has(key) || _runPlanTextFetching.has(key)) return;
  const base = _runApiBase(run);
  const url =
    n == null
      ? `${base}/plan`
      : `${base}/plan?iteration=${encodeURIComponent(n)}`;
  _runPlanTextFetching.add(key);
  fetch(url, { headers: { Accept: 'text/markdown' } })
    .then(async (r) => {
      _runPlanTextFetching.delete(key);
      if (r.ok) {
        _runPlanText.set(key, await r.text());
        _runPlanTextNotFound.delete(key);
      } else {
        _runPlanTextNotFound.add(key);
      }
      rerender?.();
    })
    .catch(() => {
      _runPlanTextFetching.delete(key);
      rerender?.();
    });
}

function _copyToClipboardSimple(text) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {});
}

// W-061 Part A: per-iteration "View plan" button, rendered inside each plan /
// plan_review iteration's content (a tab panel when the stage looped, inline
// otherwise) so the button matches the iteration it sits under.
//
// Revision mapping: a plan_review iteration K reviewed revision K (reviews run
// in ascending order, one per loopback cycle), so its button opens revision K.
// The plan stage produces the plan, so its button opens the current (latest)
// revision (null). Either way it opens the shared top-level dialog, which
// carries the full revision selector for free navigation.
function _planIterationButton(key, iter, run, rerender) {
  if ((key !== 'plan' && key !== 'plan_review') || !run?.id) return nothing;
  // Label each button with the exact plan filename it opens — no version
  // shorthand. PLAN stage iter K wrote plan-K.md (review-mode loopback
  // produces successive numbers). plan_review iter N reviewed plan-N.md and,
  // in edit mode, produced plan-(N+1).md when the editor actually rewrote
  // it; in that case surface the editor's output here. Review-mode revisions
  // are produced by the NEXT planner iter, so plan_review iter N still ends
  // at plan-N.
  if (iter?.status !== 'completed') return nothing;
  const iterNum = iter?.number || 1;
  const isEditOutput =
    key === 'plan_review' && iter?.outcome === 'approve_with_edits';
  const rev = isEditOutput ? iterNum + 1 : iterNum;
  const filename = `plan-${String(rev).padStart(3, '0')}.md`;
  const label = `View plan · ${filename}`;
  return html`
    <div class="plan-artifact-strip">
      <sl-button
        size="small"
        class="btn-view-run-plan btn-view-plan-iter"
        @click=${
          rerender
            ? () => {
                _planDialogRunId = run.id;
                _planDialogIter = rev;
                _ensurePlanItersFetched(run, rerender);
                _ensureRunPlanFetched(run, rev, rerender);
                rerender();
              }
            : null
        }
      >${label}</sl-button>
      ${key === 'plan_review' ? _planReviewIssuesButton(iter, run, rerender) : nothing}
    </div>
  `;
}

function _planReviewIssuesButton(iter, run, rerender) {
  // The issues list used to render inline under the stage section and grew
  // unreadably tall for runs with many findings. Surface it as a button next
  // to "View plan" instead — the dialog mounted near the run-detail root
  // shows the full list. Identical UX for review and review_and_edit modes.
  const count = iter?.output?.issues?.length || 0;
  if (!run?.id || !iter || count === 0) return nothing;
  return html`
    <sl-button
      size="small"
      class="btn-view-plan-issues"
      @click=${
        rerender
          ? () => {
              _issuesDialogRunId = run.id;
              _issuesDialogIter = iter.number || null;
              rerender();
            }
          : null
      }
    >View issues · ${count}</sl-button>
  `;
}

function _planArtifactDialog(run, rerender) {
  if (!run?.id) return nothing;
  const isOpen = _planDialogRunId === run.id;
  const iters = _runPlanIters.get(run.id) || [];
  const latestN = iters.length ? iters[iters.length - 1].n : null;
  const selectedN = _planDialogIter; // null = latest/current
  const textKey = _planTextKey(run.id, selectedN);
  const planText = _runPlanText.get(textKey); // undefined=loading, null=404, str=content

  // Revision selector — only when there is more than one plan revision.
  // v1 is the original input; the highest number is the current plan.
  const iterSelector =
    iters.length > 1
      ? html`
        <div class="plan-iter-selector" role="group" aria-label="Plan revisions">
          ${helpFor('plans-guides')}
          ${iters.map((it) => {
            const isLatest = it.n === latestN;
            const active =
              (selectedN == null && isLatest) || selectedN === it.n;
            const label =
              it.n === 1
                ? 'v1 · original'
                : isLatest
                  ? `v${it.n} · current`
                  : `v${it.n}`;
            return html`<sl-button
              size="small"
              pill
              class="plan-iter-btn${active ? ' plan-iter-btn--active' : ''}"
              variant=${active ? 'primary' : 'default'}
              aria-pressed=${active ? 'true' : 'false'}
              @click=${
                rerender
                  ? () => {
                      _planDialogIter = isLatest ? null : it.n;
                      _ensureRunPlanFetched(run, _planDialogIter, rerender);
                      rerender();
                    }
                  : null
              }
            >${label}</sl-button>`;
          })}
        </div>
      `
      : nothing;

  const body = (() => {
    if (planText !== undefined) {
      return html`<div class="markdown-body">${unsafeHTML(renderMarkdown(planText || ''))}</div>`;
    }
    if (_runPlanTextFetching.has(textKey)) {
      return html`<div class="plan-loading"><sl-spinner></sl-spinner> Loading plan…</div>`;
    }
    if (_runPlanTextNotFound.has(textKey)) {
      const planInProgress =
        run?.stages?.plan?.status === 'in_progress' ||
        run?.stages?.plan_review?.status === 'in_progress';
      if (planInProgress) {
        return html`<div class="plan-loading">Planner is still writing this revision.</div>`;
      }
      return html`<div class="plan-error">No plan file found for this run.</div>`;
    }
    return html`<div class="plan-loading"><sl-spinner></sl-spinner> Loading plan…</div>`;
  })();
  return html`
    <sl-dialog
      label="Plan"
      class="run-plan-dialog markdown-dialog"
      ?open=${isOpen}
      @sl-after-hide=${
        rerender
          ? () => {
              _planDialogRunId = null;
              _planDialogIter = null;
              rerender();
            }
          : null
      }
    >
      ${iterSelector}
      ${body}
      <div slot="footer">
        ${
          planText
            ? html`
              <sl-button
                class="btn-copy-run-plan"
                @click=${() => _copyToClipboardSimple(planText)}
              >
                <span slot="prefix">${unsafeHTML(iconSvg(ClipboardCopy, 14))}</span>
                Copy
              </sl-button>
            `
            : nothing
        }
        <sl-button
          variant="primary"
          class="btn-close-run-plan"
          @click=${
            rerender
              ? () => {
                  _planDialogRunId = null;
                  _planDialogIter = null;
                  rerender();
                }
              : null
          }
        >Close</sl-button>
      </div>
    </sl-dialog>
  `;
}

function _sortedEntries(stages) {
  return sortByStageOrder(Object.entries(stages));
}

/**
 * Format a pipeline_template value for display.
 *
 * Maps the legacy "worca:<id>" prefix produced by older worca-cc
 * versions to "builtin:<id>" so historical runs render with the same
 * tier vocabulary the rest of the UI uses (page header, dialogs,
 * API, URLs). Current worca-cc emits "builtin:<id>" directly; this
 * translation only fires on run records written before the rename.
 *
 * Returns null for empty/null/undefined input.
 */
export function formatPipelineTemplate(value) {
  if (!value) return null;
  if (value.startsWith('worca:'))
    return `builtin:${value.slice('worca:'.length)}`;
  return value;
}

/**
 * Render a stacked horizontal timing bar at the pipeline level.
 * Segments: Thinking (Agent) | Tools (Agent) | Rest of Pipeline
 * 100% = pipeline wall time (started_at → last stage end).
 */
export function _pipelineTimingBar(allIters, pipelineWallMs) {
  if (!pipelineWallMs || pipelineWallMs <= 0) return nothing;

  const thinkingMs = allIters.reduce(
    (sum, it) => sum + (it.duration_api_ms || 0),
    0,
  );
  // duration_session_ms = CLI session time. Only fall back to duration_ms for legacy runs
  // where duration_session_ms is undefined. When explicitly 0 (e.g. preflight), don't fall back.
  const sessionMs = allIters.reduce((sum, it) => {
    if (it.duration_session_ms != null) return sum + it.duration_session_ms;
    return sum + (it.duration_ms || 0); // legacy fallback
  }, 0);
  // Precise measured backoff-window span (W-074). The CLI's 429/529 backoff
  // sleeps inside the session but outside duration_api_ms, so before this fix it
  // was silently mis-bucketed into Tools — carve it out into its own segment.
  const retryWaitMs = allIters.reduce(
    (sum, it) => sum + (it.api_retry_wait_ms || 0),
    0,
  );
  const toolsMs = Math.max(0, sessionMs - thinkingMs - retryWaitMs);
  const restMs = Math.max(0, pipelineWallMs - sessionMs);

  if (thinkingMs <= 0 && toolsMs <= 0) return nothing;

  const thinkingPct = Math.round((thinkingMs / pipelineWallMs) * 100);
  const toolsPct = Math.round((toolsMs / pipelineWallMs) * 100);
  const retryPct = Math.round((retryWaitMs / pipelineWallMs) * 100);
  const restPct = Math.max(0, 100 - thinkingPct - toolsPct - retryPct);

  const segments = [
    {
      key: 'thinking',
      pct: thinkingPct,
      ms: thinkingMs,
      label: 'Thinking (Agent)',
      desc: 'Time spent on model inference (API round-trips)',
      cls: 'timing-bar-thinking',
    },
    {
      key: 'tools',
      pct: toolsPct,
      ms: toolsMs,
      label: 'Tools (Agent)',
      desc: 'Time spent executing tools (bash, file I/O, subprocesses)',
      cls: 'timing-bar-tools',
    },
    {
      key: 'retry',
      pct: retryPct,
      ms: retryWaitMs,
      label: 'API Retry/Wait',
      desc: 'Time stalled in CLI backoff after 429/529 throttling',
      cls: 'timing-bar-retry',
    },
    {
      key: 'rest',
      pct: restPct,
      ms: restMs,
      label: 'Rest of Pipeline',
      desc: 'Orchestration, status writes, stage transitions, retry delays',
      cls: 'timing-bar-rest',
    },
  ].filter((s) => s.pct > 0);

  return html`
    <div class="pipeline-timing-bar-container">
      <div class="pipeline-timing-bar">
        ${segments.map(
          (s) => html`
          <sl-tooltip>
            <div slot="content">
              <strong>${s.label}</strong><br>
              ${formatDuration(s.ms)} of ${formatDuration(pipelineWallMs)}<br>
              <span style="opacity:0.7">${s.desc}</span>
            </div>
            <div class="timing-bar-segment ${s.cls}" style="width:${s.pct}%">
              ${
                s.pct >= 15
                  ? html`<span class="timing-bar-segment-text">${s.label} ${s.pct}%</span>`
                  : s.pct >= 8
                    ? html`<span class="timing-bar-segment-text">${s.pct}%</span>`
                    : nothing
              }
            </div>
          </sl-tooltip>
        `,
        )}
      </div>
      <div class="pipeline-timing-bar-legend">
        ${segments.map(
          (s) => html`
          <span class="timing-bar-legend-item">
            <span class="timing-bar-legend-swatch ${s.cls}"></span>
            <span class="timing-bar-legend-label">${s.label}</span>
            <span class="timing-bar-legend-value">${formatDuration(s.ms)} (${s.pct}%)</span>
          </span>
        `,
        )}
      </div>
    </div>
  `;
}

function _lastStageEnd(stages) {
  if (!stages) return null;
  let latest = null;
  for (const s of Object.values(stages)) {
    if (s.completed_at && (!latest || s.completed_at > latest))
      latest = s.completed_at;
  }
  return latest;
}

function _badgeVariant(status) {
  if (status === 'completed') return 'success';
  if (status === 'error') return 'danger';
  if (status === 'in_progress') return 'primary';
  if (status === 'interrupted') return 'warning';
  if (status === 'cancelled') return 'neutral';
  return 'neutral';
}

function _iterStatusIcon(iter) {
  const s = iter.status || 'pending';
  if (s === 'completed' && iter.outcome === 'success')
    return html`<span class="iter-status-icon success">${unsafeHTML(statusIcon('completed', 12))}</span>`;
  if (s === 'completed')
    return html`<span class="iter-status-icon">${unsafeHTML(statusIcon('completed', 12))}</span>`;
  if (s === 'error')
    return html`<span class="iter-status-icon failure">${unsafeHTML(statusIcon('error', 12))}</span>`;
  if (s === 'in_progress')
    return html`<span class="iter-status-icon in-progress">${unsafeHTML(statusIcon('in_progress', 12))}</span>`;
  return nothing;
}

function _triggerBadge(trigger) {
  if (!trigger) return nothing;
  const labels = {
    initial: 'Initial run',
    test_failure: 'Test failure',
    review_changes: 'Review changes',
    restart_planning: 'Restart planning',
    plan_review_revise: 'Plan revision',
    next_bead: 'Next bead',
  };
  return html`<sl-badge variant="neutral" pill>${labels[trigger] || trigger.replace(/_/g, ' ')}</sl-badge>`;
}

function _outcomeVariant(outcome) {
  if (
    outcome === 'success' ||
    outcome === 'approve' ||
    outcome === 'approve_with_edits'
  )
    return 'success';
  if (outcome === 'revise' || outcome === 'request_changes') return 'warning';
  if (outcome === 'rejected' || outcome === 'restart_planning') return 'danger';
  return 'neutral';
}

function _outcomeBadge(outcome) {
  if (!outcome) return nothing;
  const badge = html`<sl-badge variant="${_outcomeVariant(outcome)}" pill>${outcome.replace(/_/g, ' ')}</sl-badge>`;
  if (outcome === 'approve_with_edits') {
    return html`${badge} <sl-badge class="plan-review-edited-chip" variant="neutral" pill>edited</sl-badge>`;
  }
  return badge;
}

function _effortSourceLabel(source) {
  if (source === 'adaptive:llm') return 'adaptive';
  if (source === 'model_default') return 'model default';
  return source || '';
}

function _effortTooltip(effort) {
  const parts = [];
  if (effort.source === 'explicit') {
    parts.push('template value');
  } else if (effort.source === 'model_default') {
    parts.push('Claude Code default for this model');
  } else if (effort.source === 'adaptive:llm') {
    const beadLevel = effort.bead_classified?.level;
    parts.push(`coordinator label: ${beadLevel || effort.base}`);
  } else if (
    (effort.source === 'reactive' || effort.source === 'disabled') &&
    effort.bead_classified &&
    !effort.bead_classified.applied &&
    effort.bead_classified.level
  ) {
    parts.push(
      `coordinator labeled ${effort.bead_classified.level}; not applied under ${effort.source}`,
    );
  }
  if (effort.capped_from) {
    parts.push(`capped from ${effort.capped_from}`);
  }
  if (effort.escalations?.length && effort.base) {
    parts.push(`escalated from ${effort.base}`);
  }
  return parts.join(' · ');
}

// Per-iteration read-only graphify query count, shown on the effort row.
// Only agent iterations carry `graphify_invocations` (preflight never does).
// When graphify is off for the project, show a plain "(disabled)" value
// matching the skills/subagents empty style — not a badge. When enabled, an
// integer badge: blue (primary) when the agent actually queried, grey for 0.
function _graphifyBadge(iter, graphifyEnabled) {
  if (iter.graphify_invocations == null) return nothing;
  if (graphifyEnabled !== true) {
    return html`<span class="meta-label">Graphify:</span> <span class="dispatch-events-empty">(disabled)</span>`;
  }
  const count = iter.graphify_invocations;
  const variant = count > 0 ? 'primary' : 'neutral';
  return html`<span class="meta-label">Graphify:</span> <sl-badge class="graphify-invocations-badge" variant="${variant}" pill>${count}</sl-badge>`;
}

// Sorted "name ×N" lines (busiest tool first) for the CRG badge tooltip.
function _crgToolBreakdown(counts) {
  if (!counts || typeof counts !== 'object') return [];
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => `${name} ×${n}`);
}

function _crgBadge(iter, crgEnabled) {
  if (iter.crg_invocations == null) return nothing;
  if (crgEnabled !== true) {
    return html`<span class="meta-label">Code Review Graph:</span> <span class="dispatch-events-empty">(disabled)</span>`;
  }
  const count = iter.crg_invocations;
  const variant = count > 0 ? 'primary' : 'neutral';
  const badge = html`<sl-badge class="crg-invocations-badge" variant="${variant}" pill>${count}</sl-badge>`;
  // When the agent queried CRG, hovering the badge shows a per-tool breakdown.
  // Render one <div> per tool into sl-tooltip's HTML content slot rather than
  // \n + white-space:pre-line — Shoelace's body template has a leading newline
  // that pre-line would render as an empty first line.
  const lines = count > 0 ? _crgToolBreakdown(iter.crg_tool_counts) : [];
  const wrapped = lines.length
    ? html`<sl-tooltip class="crg-tool-tooltip"><div slot="content">${lines.map((l) => html`<div>${l}</div>`)}</div>${badge}</sl-tooltip>`
    : badge;
  return html`<span class="meta-label">Code Review Graph:</span> ${wrapped}`;
}

function _planReviewSeverityVariant(severity) {
  if (severity === 'critical') return 'danger';
  if (severity === 'major') return 'warning';
  return 'neutral';
}

function _planReviewIssuesDialog(run, rerender) {
  // Per-run modal that surfaces the issues list for a chosen plan_review
  // iteration. Mirrors the plan-artifact dialog's chrome (scroll/copy/close)
  // for visual + behavioural parity. No-op'd to empty when no iteration has
  // issues so the parent template stays lean. Unlike the plan-artifact dialog
  // this one needs no network round trip — the issues live in
  // stage.iterations[].output — so it tolerates a missing run.id (matters
  // for unit tests).
  const stage = run?.stages?.plan_review;
  const iterations = stage?.iterations || [];
  const anyIssues = iterations.some(
    (it) => (it.output?.issues?.length || 0) > 0,
  );
  if (!anyIssues) return nothing;

  const isOpen = run?.id != null && _issuesDialogRunId === run.id;
  const iter =
    iterations.find((it) => it.number === _issuesDialogIter) ||
    iterations.find((it) => (it.output?.issues?.length || 0) > 0);
  const issues = iter?.output?.issues || [];
  const stageMode = stage?.mode;
  const baseHeading =
    stageMode === 'review_and_edit'
      ? 'Plan review findings'
      : 'Feedback to planner';
  const label = iter?.number ? `${baseHeading} · v${iter.number}` : baseHeading;
  const groups = _groupIssuesByResolution(issues, stageMode);
  const markdown = _issuesToMarkdown(
    issues,
    stageMode,
    baseHeading,
    iter?.number,
  );

  return html`
    <sl-dialog
      label=${label}
      class="plan-review-issues-dialog markdown-dialog"
      ?open=${isOpen}
      @sl-after-hide=${
        rerender
          ? () => {
              _issuesDialogRunId = null;
              _issuesDialogIter = null;
              rerender();
            }
          : null
      }
    >
      <div class="plan-review-issues">
        ${
          stageMode === 'review_and_edit'
            ? html`
              ${_planReviewIssuesSection('Resolved (edited in plan)', groups.edited)}
              ${_planReviewIssuesSection('Noted for implementer', groups.deferred)}
              ${_planReviewIssuesSection('Dismissed', groups.dismissed)}
            `
            : _planReviewIssuesRows(issues)
        }
      </div>
      <div slot="footer">
        ${
          issues.length
            ? html`
              <sl-button
                class="btn-copy-plan-review-issues"
                @click=${() => _copyToClipboardSimple(markdown)}
              >
                <span slot="prefix">${unsafeHTML(iconSvg(ClipboardCopy, 14))}</span>
                Copy
              </sl-button>
            `
            : nothing
        }
        <sl-button
          variant="primary"
          class="btn-close-plan-review-issues"
          @click=${
            rerender
              ? () => {
                  _issuesDialogRunId = null;
                  _issuesDialogIter = null;
                  rerender();
                }
              : null
          }
        >Close</sl-button>
      </div>
    </sl-dialog>
  `;
}

function _planReviewIssuesRows(rows) {
  return rows.map(
    (issue) => html`
      <div class="plan-review-issue-row">
        <sl-badge variant=${_planReviewSeverityVariant(issue.severity)} pill>${issue.severity}</sl-badge>
        <sl-badge class="plan-review-issue-category-badge" variant="neutral" pill>${issue.category}</sl-badge>
        <span class="plan-review-issue-desc">${issue.description}</span>
      </div>
    `,
  );
}

function _planReviewIssuesSection(heading, rows) {
  if (!rows.length) return nothing;
  return html`
    <div class="plan-review-issues-section">
      <h4 class="plan-review-issues-section-heading">${heading} (${rows.length})</h4>
      ${_planReviewIssuesRows(rows)}
    </div>
  `;
}

function _groupIssuesByResolution(issues, stageMode) {
  // Review mode has no per-issue resolution (the reviewer doesn't edit), so
  // surface a single ungrouped section by parking everything in deferred.
  if (stageMode !== 'review_and_edit') {
    return { edited: [], deferred: [...issues], dismissed: [] };
  }
  const out = { edited: [], deferred: [], dismissed: [] };
  for (const i of issues) {
    if (i.resolution === 'edited') out.edited.push(i);
    else if (i.resolution === 'dismissed') out.dismissed.push(i);
    else out.deferred.push(i); // explicit 'deferred' OR missing (old runs)
  }
  return out;
}

function _issuesToMarkdown(issues, stageMode, baseHeading, iterNum) {
  const head = iterNum
    ? `# ${baseHeading} · v${iterNum}\n\n`
    : `# ${baseHeading}\n\n`;
  const row = (i) =>
    `- **[${i.severity}][${i.category}]** ${i.description}${
      i.suggestion ? `\n  - _Suggestion:_ ${i.suggestion}` : ''
    }`;
  if (stageMode !== 'review_and_edit') {
    return `${head}${issues.map(row).join('\n')}\n`;
  }
  const groups = _groupIssuesByResolution(issues, stageMode);
  const fmt = (h, rows) =>
    rows.length ? `## ${h}\n${rows.map(row).join('\n')}\n\n` : '';
  return (
    head +
    fmt('Resolved (edited in plan)', groups.edited) +
    fmt('Noted for implementer', groups.deferred) +
    fmt('Dismissed', groups.dismissed)
  );
}

function _effortRowView(iter, graphifyEnabled, crgEnabled) {
  const gfx = _graphifyBadge(iter, graphifyEnabled);
  const crg = _crgBadge(iter, crgEnabled);
  const e = iter.effort;
  if (!e) {
    const hasBadge = gfx !== nothing || crg !== nothing;
    return hasBadge
      ? html`<div class="iteration-tags-row">${gfx}${crg}</div>`
      : nothing;
  }
  const sourceLabel = _effortSourceLabel(e.source);
  const tooltip = _effortTooltip(e);

  const escalationChips = e.escalations?.length
    ? e.escalations.map(
        (esc) =>
          html`<sl-badge class="effort-source-chip" variant="neutral" pill>+${esc}</sl-badge>`,
      )
    : nothing;

  const cappedChip = e.capped_from
    ? html`<sl-badge class="effort-source-chip" variant="neutral" pill>capped</sl-badge>`
    : nothing;

  // Bead chip — only surface when it conveys real divergence info.
  // Suppress when the coordinator's bead label matches the resolved
  // effort level (no divergence) or when the run is in
  // `mode_disabled` (the label was never going to be consulted, so
  // showing "ignored" is noise). The chip also stays suppressed
  // when bead_classified.applied is true (level already matches and
  // is implied by the source chip).
  const bc = e.bead_classified;
  const showBeadChip =
    bc &&
    bc.level != null &&
    bc.applied === false &&
    bc.level !== e.level &&
    bc.skip_reason !== 'mode_disabled';
  const divergenceLabel =
    bc?.skip_reason === 'explicit_override' ? 'overridden' : 'ignored';

  return html`
    <div class="iteration-tags-row" title="${tooltip}">
      <span class="meta-label">Effort:</span>
      ${unsafeHTML(effortLevelBadge(e.level))}
      <sl-badge class="effort-source-chip" variant="neutral" pill>${sourceLabel}</sl-badge>
      ${escalationChips}
      ${cappedChip}
      ${
        showBeadChip
          ? html`
        <span class="iteration-tags-sep">·</span>
        <span class="meta-label">Bead:</span>
        ${unsafeHTML(effortLevelBadge(bc.level))}
        <sl-badge class="effort-divergence-chip" variant="warning" pill>${divergenceLabel}</sl-badge>
      `
          : nothing
      }
      ${gfx}
      ${crg}
    </div>
  `;
}

function _classificationVariant(category) {
  if (category === 'infra_transient') return 'warning';
  if (
    category === 'infra_permanent' ||
    category === 'logic_stuck' ||
    category === 'env_missing'
  )
    return 'danger';
  return 'neutral';
}

function _classificationRowView(iter) {
  const c = iter.classification;
  if (!c) return nothing;
  return html`
    <div class="iteration-tags-row">
      <span class="meta-label">Fail Category:</span>
      <span class="meta-value">${c.category}</span>
      <span class="iteration-tags-sep">·</span>
      <span class="meta-label">Severity:</span>
      <span class="meta-value">${c.retriable ? 'retriable' : 'non-retriable'}</span>
      ${
        c.similar_to_previous
          ? html`
        <span class="iteration-tags-sep">·</span>
        <span class="meta-label">Similar:</span>
        <span class="meta-value">yes</span>
      `
          : nothing
      }
    </div>
  `;
}

function _dispatchEventCandidate(ev) {
  // Back-compat: accept the legacy `subagent_type` payload key during the
  // event-shape rollout. Tests fed status snapshots written before W-054 PR D
  // landed still use the old field name.
  return ev.candidate || ev.subagent_type || '';
}

// PR D / B / follow-up: each iteration shows one row per dispatch section
// ("Subagents:" + "Skills:") rather than a single mixed-bag "Dispatch:" line.
// This restores the original per-section label semantics that PR D's unified
// event family had blurred — and replaces the redundant hero-level
// "Dispatch activity" counter that previously sat above the stage timeline.
const _DISPATCH_VISIBLE_LIMIT = 6;
const _DISPATCH_SECTIONS = [
  { section: 'subagents', label: 'Subagents:' },
  { section: 'skills', label: 'Skills:' },
];

function _dispatchBadgeView(ev) {
  const isAllowed = ev.type === 'pipeline.hook.dispatch_allowed';
  const isWildcard = isAllowed && ev.via === 'wildcard';
  // Dispatched → green (success); blocked → red (danger). Wildcard still
  // counts as dispatched — the via/section is conveyed via tooltip, not
  // via a separate variant.
  const variant = isAllowed ? 'success' : 'danger';
  const count = Number.isInteger(ev.count) && ev.count > 1 ? ev.count : 0;
  const suffix = count ? ` (×${count})` : '';
  const candidate = _dispatchEventCandidate(ev);
  // Drop the "blocked" suffix — the colour + icon now carry that signal.
  const label = `${candidate}${suffix}`;
  // Tooltip leads with a plain-language verdict so a reader hovering
  // a single chip understands instantly why it's red or green, even
  // without reading the section/via/reason details after the dash.
  const lede = isAllowed
    ? 'Allowed by project dispatch policy'
    : 'Blocked by project dispatch policy';
  const detailParts = [];
  if (ev.section) detailParts.push(`section: ${ev.section}`);
  if (ev.via) detailParts.push(`via: ${ev.via}`);
  if (ev.reason) detailParts.push(`reason: ${ev.reason}`);
  const tooltip = detailParts.length
    ? `${lede} — ${detailParts.join(' · ')}`
    : lede;
  const cls = isWildcard
    ? 'dispatch-badge dispatch-badge-wildcard'
    : 'dispatch-badge';
  const iconSvgString = iconSvg(isAllowed ? CircleCheck : X, 12);
  // Wrap in <sl-tooltip> so hovers show a styled, fast-appearing tooltip
  // (Shoelace default show-delay is ~150ms) rather than the browser-native
  // `title` (500ms+). The badge itself stays on one line — the existing
  // renderToString test helper matches against /Explore<\/sl-badge>/.
  return html`<sl-tooltip content="${tooltip}"><sl-badge class="${cls}" variant="${variant}" pill><span class="dispatch-badge-icon">${unsafeHTML(iconSvgString)}</span>${label}</sl-badge></sl-tooltip>`;
}

function _dispatchSectionInlineView(label, sectionKey, events) {
  const overflow = events.length > _DISPATCH_VISIBLE_LIMIT;
  const inline = overflow ? events.slice(0, _DISPATCH_VISIBLE_LIMIT) : events;
  const hidden = overflow ? events.slice(_DISPATCH_VISIBLE_LIMIT) : [];
  // Empty-section placeholder so the row keeps its shape even when one
  // dispatch family produced nothing this iteration — the user complaint
  // was that the previous "Dispatch: No subagent or skill activity"
  // collapse made the layout flicker between iterations.
  const body =
    events.length === 0
      ? html`<span class="dispatch-events-empty">(none)</span>`
      : html`${inline.map(_dispatchBadgeView)}${
          overflow
            ? html`<sl-details class="dispatch-events-overflow">
              <span slot="summary" class="dispatch-events-overflow-summary"
                >${`+${hidden.length} more`}</span
              >
              <div class="dispatch-events-overflow-content">
                ${hidden.map(_dispatchBadgeView)}
              </div>
            </sl-details>`
            : nothing
        }`;
  return html`<span
    class="dispatch-events-section"
    data-dispatch-section="${sectionKey}"
    ><span class="meta-label">${label}</span>${body}${helpFor('dispatch')}</span
  >`;
}

function _dispatchEventsRowsView(iter) {
  const events = iter.dispatch_events || [];
  const buckets = { subagents: [], skills: [] };
  for (const ev of events) {
    // Back-compat: pre-PR-D events carry no `section`. Treat them as subagents
    // since that was the only emitter before the unification.
    const s = ev.section || 'subagents';
    if (buckets[s]) buckets[s].push(ev);
  }
  // Skip the row entirely on in-progress iterations with no events yet
  // so empty placeholders don't flicker into view before the first hook
  // fires. Once the iteration completes (or any dispatch lands), the
  // row is always shown with both sections present — empty sections
  // render a muted "(none)" inline rather than disappearing.
  const anyEvents = buckets.subagents.length > 0 || buckets.skills.length > 0;
  const iterDone = iter.status === 'completed' || iter.completed_at;
  if (!anyEvents && !iterDone) return nothing;
  return html`
    <div class="iteration-tags-row dispatch-events-row">
      ${_DISPATCH_SECTIONS.map(({ section, label }) =>
        _dispatchSectionInlineView(label, section, buckets[section]),
      )}
    </div>
  `;
}

function _circuitBreakerBannerView(run, settings) {
  const cb = run.circuit_breaker;
  if (!cb) return nothing;
  if (cb.tripped) {
    return html`
      <sl-alert class="circuit-breaker-banner" variant="danger" open>
        <strong>Circuit breaker tripped:</strong> ${cb.tripped_reason || 'Pipeline halted due to repeated errors.'}
        ${helpFor('loops')}
      </sl-alert>
    `;
  }
  const failures = cb.consecutive_failures || 0;
  if (failures > 0) {
    const threshold = settings.circuit_breaker?.max_consecutive_failures ?? 3;
    return html`
      <sl-alert class="circuit-breaker-banner" variant="warning" open>
        <strong>Circuit breaker warning:</strong> ${String(failures)}/${String(threshold)} consecutive failures.
        ${helpFor('loops')}
      </sl-alert>
    `;
  }
  return nothing;
}

export function prVerificationBannerView(run) {
  if (
    !(
      run?.milestones?.pr_verified === false &&
      run?.pipeline_status === 'failed'
    )
  ) {
    return nothing;
  }
  return html`
    <sl-alert class="pr-verification-banner" variant="danger" open>
      <strong>PR verification failed:</strong> Guardian reported success but no new commit or PR was detected.
    </sl-alert>
  `;
}

function _prVerifiedBadgeView(run) {
  const verified = run?.milestones?.pr_verified;
  if (verified === null || verified === undefined) return nothing;
  return html`
    <div class="pr-verified-row">
      <span class="meta-label">PR Verification:</span>
      <sl-badge class="pr-verified-badge" variant="${verified ? 'success' : 'danger'}" pill>
        ${verified ? 'Verified' : 'Not Verified'}
      </sl-badge>
    </div>
  `;
}

function _prReviewStatusVariant(status) {
  if (status === 'approved') return 'success';
  if (status === 'changes_requested') return 'warning';
  if (status === 'rejected') return 'danger';
  return 'neutral';
}

function _prInfoStripView(run, { isReviseInput = false } = {}) {
  const pr = run?.pr;
  const prUrl = pr?.url || run?.pr_url;
  if (!prUrl) return nothing;

  const number = pr?.number;
  const commitSha = pr?.commit_sha;
  const shortSha = commitSha ? commitSha.slice(0, 7) : null;
  const source = pr?.source_branch;
  const target = pr?.target_branch;
  const provider = pr?.provider;
  const reviewStatus = pr?.review_status;

  return html`
    <div class="pr-info-strip">
      <span class="pr-info-item">
        ${unsafeHTML(iconSvg(GitPullRequest, 14))}
        <a class="run-pr-link" href="${prUrl}" target="_blank" rel="noopener noreferrer">
          PR${number != null ? html` #${number}` : nothing} ${unsafeHTML(iconSvg(ExternalLink, 11))}
        </a>
      </span>
      ${
        provider
          ? html`<span class="pr-info-item">
        <span class="meta-label">Provider:</span>
        <span class="meta-value">${provider.replace(/_/g, ' ')}</span>
      </span>`
          : nothing
      }
      ${
        shortSha
          ? html`<span class="pr-info-item">
        <span class="meta-label">Commit:</span>
        <code class="pr-commit-sha">${shortSha}</code>
        <sl-copy-button value="${commitSha}"></sl-copy-button>
      </span>`
          : nothing
      }
      ${
        source && target
          ? html`<span class="pr-info-item">
        ${unsafeHTML(iconSvg(GitBranch, 13))}
        <span class="meta-value">${source} → ${target}</span>
      </span>`
          : nothing
      }
      ${
        reviewStatus
          ? html`<span class="pr-info-item">
        ${isReviseInput ? html`<span class="meta-label">Trigger:</span>` : nothing}
        <sl-badge class="pr-review-status-badge" variant="${_prReviewStatusVariant(reviewStatus)}" pill>${reviewStatus.replace(/_/g, ' ')}</sl-badge>
      </span>`
          : nothing
      }
    </div>
  `;
}

function _prTitleBadge(run) {
  const pr = run?.pr;
  const prUrl = pr?.url || run?.pr_url;
  if (!prUrl) return nothing;
  const number = pr?.number;
  const label = `PR #${number}`;
  return html`<sl-badge class="pr-title-badge" variant="success" pill>${label}</sl-badge>`;
}

function _preflightCheckBadgeVariant(status) {
  if (status === 'pass') return 'success';
  if (status === 'warn') return 'warning';
  if (status === 'fail') return 'danger';
  return 'neutral';
}

// One-line explanation of the graphify build mode, appended to the ready-state
// tooltips. structural = fully local; full = docs/diagrams sent to the provider.
function _graphifyModeHint(mode) {
  if (mode === 'structural')
    return 'structural mode: local AST + clustering, no LLM calls';
  if (mode === 'full')
    return 'full mode: docs/diagrams sent to the configured provider (source code never sent)';
  return '';
}

function _preflightGraphifyBadge(stage, run) {
  const enabled = run.graphify_enabled;
  const status = stage.graphify_status;
  const outcome = stage.graphify_outcome;
  const mode = stage.graphify_mode;
  const reason = stage.graphify_reason;

  // Returns the labeled "Graphify:" fragment (label + pill). The shared row
  // wrapper is added by _preflightGraphBadgesRow so Graphify and CRG sit on one
  // line. Reuses the "Graphify:" label established by _graphifyBadge.
  const row = (badge) =>
    html`<span class="meta-label">Graphify:</span> ${badge}`;
  // Every state carries a tooltip explaining what it means. Use <sl-tooltip>
  // (styled, ~150ms) for consistency with the dispatch badges, not native title.
  const badge = (variant, text, tip) =>
    html`<sl-tooltip content="${tip}"><sl-badge class="preflight-graphify-badge" variant="${variant}" pill>${text}</sl-badge></sl-tooltip>`;

  if (enabled === false) {
    return row(
      badge(
        'neutral',
        'off',
        'Graphify is disabled for this project — no code knowledge graph is built or queried.',
      ),
    );
  }
  if (enabled == null && status == null) return nothing;

  if (status === 'skipped') {
    return row(
      badge(
        'neutral',
        'skipped',
        'Graphify is enabled, but no graph was available this run (preflight build off and no cached graph for this commit).',
      ),
    );
  }
  if (status === 'degraded') {
    // Show the underlying reason only — the install/fix command lives centrally
    // in Project Settings → Graphify, not in this tooltip.
    const tip = reason
      ? `Graphify couldn't provide a graph: ${reason}. See Project Settings → Graphify.`
      : "Graphify couldn't provide a graph. See Project Settings → Graphify.";
    return row(badge('danger', 'unavailable', tip));
  }

  const hint = _graphifyModeHint(mode);
  const withHint = (base) => (hint ? `${base} · ${hint}.` : `${base}.`);
  if (outcome === 'cached') {
    return row(
      badge(
        'success',
        html`cached · ${mode}`,
        withHint(
          'Reused the knowledge graph already cached for this commit — no rebuild needed',
        ),
      ),
    );
  }
  if (outcome === 'built') {
    return row(
      badge(
        'success',
        html`rebuilt · ${mode}`,
        withHint(
          'No cached graph for this commit, so a fresh one was built during preflight and cached',
        ),
      ),
    );
  }
  if (outcome === 'throwaway') {
    return row(
      badge(
        'warning',
        html`built (uncommitted) · ${mode}`,
        withHint(
          'Working tree had uncommitted changes, so a throwaway graph was built for this run only (not cached)',
        ),
      ),
    );
  }
  return nothing;
}

function _preflightCrgBadge(stage, run) {
  const enabled = run.crg_enabled;
  const status = stage.crg_status;
  const outcome = stage.crg_outcome;
  const reason = stage.crg_reason;

  // Returns the labeled "Code Review Graph:" fragment; _preflightGraphBadgesRow
  // places it on the same row right after Graphify. Mirrors
  // _preflightGraphifyBadge (CRG is structural-only, so no mode suffix).
  const row = (badge) =>
    html`<span class="meta-label">Code Review Graph:</span> ${badge}`;
  const badge = (variant, text, tip) =>
    html`<sl-tooltip content="${tip}"><sl-badge class="preflight-crg-badge" variant="${variant}" pill>${text}</sl-badge></sl-tooltip>`;

  if (enabled === false) {
    return row(
      badge(
        'neutral',
        'off',
        'Code Review Graph is disabled for this project — no CRG graph is built and agents get no CRG tools.',
      ),
    );
  }
  if (enabled == null && status == null) return nothing;

  if (status === 'skipped') {
    return row(
      badge(
        'neutral',
        'skipped',
        'Code Review Graph is enabled, but no graph was available this run.',
      ),
    );
  }
  if (status === 'degraded') {
    // Show the underlying reason only — install/fix lives centrally in
    // Project Settings → Code Review Graph, not in this tooltip.
    const tip = reason
      ? `Code Review Graph couldn't provide a graph: ${reason}. See Project Settings → Code Review Graph.`
      : "Code Review Graph couldn't provide a graph. See Project Settings → Code Review Graph.";
    return row(badge('danger', 'unavailable', tip));
  }

  // Ready: distinguish cache outcomes like graphify (no mode — CRG is structural).
  if (outcome === 'cached') {
    return row(
      badge(
        'success',
        'cached',
        'Reused the CRG graph already cached for this commit — agents query it via per-stage MCP tools.',
      ),
    );
  }
  if (outcome === 'built') {
    return row(
      badge(
        'success',
        'rebuilt',
        'No cached CRG graph for this commit, so a fresh one was built during preflight and cached.',
      ),
    );
  }
  if (outcome === 'throwaway') {
    return row(
      badge(
        'warning',
        'built (uncommitted)',
        'Working tree had uncommitted changes, so a throwaway CRG graph was built for this run only (not cached).',
      ),
    );
  }
  if (status === 'ready') {
    // Older runs recorded `ready` without an outcome.
    return row(
      badge(
        'success',
        'ready',
        'Code Review Graph built for this commit — agents query it via per-stage MCP tools.',
      ),
    );
  }
  return nothing;
}

// Graphify + Code Review Graph preflight pills share one line — Graphify first,
// CRG immediately after — mirroring how the per-iteration invocation badges sit
// together on the Effort row.
function _preflightGraphBadgesRow(stage, run) {
  const gfx = _preflightGraphifyBadge(stage, run);
  const crg = _preflightCrgBadge(stage, run);
  if (gfx === nothing && crg === nothing) return nothing;
  return html`<div class="iteration-tags-row">${gfx}${crg}</div>`;
}

// Launch-time pipeline params (set via the new-run UI) surfaced on the preflight
// row. Each is shown only when explicitly set; values render as neutral pills,
// matching the Graphify / Code Review Graph badges. Returns `nothing` when no
// param was set so the row collapses entirely.
function _preflightParamsRow(run) {
  if (!run) return nothing;
  const pill = (text, tip) =>
    html`<sl-tooltip content="${tip}"><sl-badge class="preflight-param-badge" variant="neutral" pill>${text}</sl-badge></sl-tooltip>`;
  const sourcePill = (text, tip) =>
    html`<sl-tooltip content="${tip}"><sl-badge class="preflight-param-badge preflight-param-source-badge" variant="neutral" pill>${text}</sl-badge></sl-tooltip>`;
  const items = [];
  const size = run.size_multiplier;
  const loops = run.loop_multiplier;
  if (typeof size === 'number' && size > 1) {
    items.push(
      html`<span class="meta-label">Size Multiplier:</span> ${pill(`${size}×`, 'Turn multiplier (msize) set at launch — multiplies each agent’s max_turns.')}`,
    );
  }
  if (typeof loops === 'number' && loops > 1) {
    items.push(
      html`<span class="meta-label">Loop Multiplier:</span> ${pill(`${loops}×`, 'Loop multiplier (mloops) set at launch — multiplies the test/review/plan retry-loop limits.')}`,
    );
  }

  // Max Beads is ALWAYS shown — the EFFECTIVE resolved cap plus a second pill
  // for where it came from. Resolution degrades gracefully on old runs:
  //   1. new fields present → effective value + its persisted source
  //   2. legacy max_beads_override only → that value, source "explicit"
  //   3. neither (legacy auto run) → 0 (Auto), source unknown (pill omitted)
  let beadValue;
  let beadSource;
  if (typeof run.max_beads_effective === 'number') {
    beadValue = run.max_beads_effective;
    beadSource = run.max_beads_source;
  } else if (typeof run.max_beads_override === 'number') {
    beadValue = run.max_beads_override;
    beadSource = 'explicit';
  } else {
    beadValue = 0;
    beadSource = undefined;
  }
  const beadText = beadValue > 0 ? String(beadValue) : '0 (Auto)';
  const beadPills = [
    pill(
      beadText,
      'Effective cap on the number of beads the coordinator may create (0 = Auto / no cap).',
    ),
  ];
  if (beadSource !== undefined) {
    beadPills.push(
      sourcePill(
        beadSource,
        beadSource === 'explicit'
          ? 'Cap set explicitly at launch via --max-beads.'
          : 'Cap came from the template / project config (or was suppressed for a PR-revision run).',
      ),
    );
  }
  items.push(html`<span class="meta-label">Max Beads:</span> ${beadPills}`);

  // CLAUDE.md mode — only shown when non-default (mode != 'all').
  // Stored in status.json only when not 'all' (see runner.py launch_param_status).
  const claudeMdMode = run.claude_md_mode;
  if (typeof claudeMdMode === 'string') {
    const claudePills = [
      pill(
        claudeMdMode,
        'CLAUDE.md loading mode set at launch via --claude-md-mode.',
      ),
    ];
    items.push(html`<span class="meta-label">CLAUDE.md:</span> ${claudePills}`);
  }

  return html`<div class="iteration-tags-row preflight-params-row">${items}</div>`;
}

function _preflightProvenanceRow(run) {
  if (!run?.provenance) return nothing;
  const p = run.provenance;
  const version = p.worca_version || 'unknown';
  const rs = p.runtime_source;
  const pill = (text, variant = 'neutral') =>
    html`<sl-badge class="preflight-param-badge" variant="${variant}" pill>${text}</sl-badge>`;

  const pills = [pill(`worca ${version}`)];

  if (rs?.source === 'git') {
    const short = rs.commit ? rs.commit.slice(0, 8) : '';
    const repo = rs.repo || '';
    pills.push(pill(`${repo}@${short}`));
    if (rs.branch) pills.push(pill(rs.branch));
    if (rs.dirty) pills.push(pill('dirty', 'warning'));
  } else if (rs?.source === 'pip') {
    pills.push(pill('pip'));
  }

  return html`<div class="iteration-tags-row preflight-params-row">
    <span class="meta-label">Runtime:</span> ${pills}
  </div>`;
}

function _preflightRunMetaRows(run) {
  // Run-level preflight metadata: launch params (Max Beads, CLAUDE.md mode)
  // and the flow fingerprint. These describe the RUN, not an iteration, so
  // they render once at stage level — never duplicated inside iter tabs.
  const paramsRow = _preflightParamsRow(run);
  const fpRow = run?.flow_fingerprint
    ? html`<div class="iteration-tags-row preflight-flow-row"><span class="meta-label">Flow fingerprint:</span> <span class="meta-value preflight-flow-fingerprint" title="sha256 of the compiled pipeline flow (W-070). Custom-flow runs refuse to resume if this changes.">${run.flow_fingerprint}</span></div>`
    : nothing;
  const provRow = _preflightProvenanceRow(run);
  if (paramsRow === nothing && fpRow === nothing && provRow === nothing)
    return nothing;
  return html`${paramsRow}${fpRow}${provRow}`;
}

function _preflightIterRows(stage, iter) {
  // Per-iteration preflight results: the status summary + checks table from
  // THIS iteration's output. Bare rows — callers add the
  // .preflight-checks-view wrapper. Rendered inside each iter tab on
  // multi-iteration runs (e.g. resumes re-running preflight) so every
  // iteration shows its own full results, identical to the
  // single-iteration layout.
  const isSkipped = stage.skipped || iter.outcome === 'skipped';
  if (isSkipped) {
    return html`<sl-badge variant="neutral" pill>Skipped</sl-badge>`;
  }
  const output = iter.output || {};
  const checks = output.checks || [];
  const summary = output.summary || '';
  if (!checks.length && !summary) return nothing;
  return html`
      ${
        summary
          ? html`<div class="iteration-tags-row preflight-status-row"><span class="meta-label">Status:</span> <span class="meta-value markdown-body markdown-inline">${unsafeHTML(renderMarkdown(summary))}</span></div>`
          : nothing
      }
      ${
        checks.length > 0
          ? html`
        <table class="preflight-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Check</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            ${checks.map(
              (check) => html`
              <tr>
                <td><sl-badge variant="${_preflightCheckBadgeVariant(check.status)}" pill>${check.status}</sl-badge></td>
                <td class="preflight-check-name">${check.name}</td>
                <td class="preflight-check-message markdown-body markdown-inline">${unsafeHTML(renderMarkdown(check.message || ''))}</td>
              </tr>
            `,
            )}
          </tbody>
        </table>
      `
          : nothing
      }
  `;
}

function _preflightIterChecksView(stage, iter) {
  // Wrapper for the multi-iteration tab panels.
  const rows = _preflightIterRows(stage, iter);
  if (rows === nothing) return nothing;
  return html`<div class="preflight-checks-view">${rows}</div>`;
}

function _preflightRunMetaView(run) {
  // Stage-level wrapper for the run-level meta rows — used above the iter
  // tabs on multi-iteration runs.
  const meta = _preflightRunMetaRows(run);
  if (meta === nothing) return nothing;
  return html`<div class="preflight-checks-view">${meta}</div>`;
}

function _preflightChecksView(stage, iter, run) {
  // Single-iteration composition: run-level meta rows + this iteration's
  // checks in one wrapper (original DOM shape).
  const isSkipped = stage.skipped || iter.outcome === 'skipped';
  if (isSkipped) {
    return html`<div class="preflight-checks-view"><sl-badge variant="neutral" pill>Skipped</sl-badge></div>`;
  }
  const meta = _preflightRunMetaRows(run);
  const rows = _preflightIterRows(stage, iter);
  if (meta === nothing && rows === nothing) return nothing;
  return html`<div class="preflight-checks-view">${meta}${rows}</div>`;
}

function _stageCost(iterations) {
  return iterations.reduce((sum, it) => sum + (it.cost_usd || 0), 0);
}

// Serialize a stage (and its iterations) to the JSON the "Copy" button hands
// the user. Keep this in sync with everything the stage section *renders* —
// effort, graphify invocations, dispatch (skills/subagents), classification,
// token usage, structured output, and the preflight graphify fields — so the
// copied data is the full stage record, not a stale subset.
export function _stageToJson(key, stage, stageAgent, stageModel, promptData) {
  const iterations = stage.iterations || [];
  const wallMs = _stageWallMs(stage);
  return {
    stage: key,
    status: stage.status,
    agent: stageAgent || undefined,
    model: stageModel || undefined,
    // model_alias preserves the user-typed alias (e.g. "glm-ds") next to the
    // resolved id ("opus"). Omitted on old runs and plain-model configs.
    model_alias: stage.model_alias || undefined,
    cost_usd: _stageCost(iterations),
    token_usage: stage.token_usage || undefined,
    duration: wallMs > 0 ? formatDuration(wallMs) : undefined,
    duration_ms: wallMs > 0 ? wallMs : undefined,
    started_at: stage.started_at || undefined,
    completed_at: stage.completed_at || undefined,
    skipped: stage.skipped || undefined,
    task_progress: stage.task_progress || undefined,
    error: stage.error || undefined,
    plan_file: stage.plan_file || undefined,
    mode: stage.mode || undefined,
    mode_reason: stage.mode_reason || undefined,
    graphify_status: stage.graphify_status || undefined,
    graphify_report_path: stage.graphify_report_path || undefined,
    graphify_outcome: stage.graphify_outcome || undefined,
    graphify_mode: stage.graphify_mode || undefined,
    graphify_reason: stage.graphify_reason || undefined,
    crg_status: stage.crg_status || undefined,
    crg_outcome: stage.crg_outcome || undefined,
    crg_reason: stage.crg_reason || undefined,
    iterations: iterations.map((it) => ({
      number: it.number,
      status: it.status,
      outcome: it.outcome || undefined,
      trigger: it.trigger || undefined,
      agent: it.agent || undefined,
      model: it.model || undefined,
      model_alias: it.model_alias || undefined,
      turns: it.turns || undefined,
      cost_usd: it.cost_usd || undefined,
      duration_ms: it.duration_ms || undefined,
      duration_session_ms: it.duration_session_ms || undefined,
      duration_api_ms: it.duration_api_ms || undefined,
      api_retries: it.api_retries || undefined,
      api_retry_wait_ms: it.api_retry_wait_ms || undefined,
      non_api_wait_ms: it.non_api_wait_ms || undefined,
      api_error_status:
        it.api_error_status != null ? it.api_error_status : undefined,
      started_at: it.started_at || undefined,
      completed_at: it.completed_at || undefined,
      effort: it.effort || undefined,
      graphify_invocations:
        it.graphify_invocations != null ? it.graphify_invocations : undefined,
      crg_invocations:
        it.crg_invocations != null ? it.crg_invocations : undefined,
      crg_tool_counts: it.crg_tool_counts || undefined,
      token_usage: it.token_usage || undefined,
      classification: it.classification || undefined,
      dispatch_events: it.dispatch_events?.length
        ? it.dispatch_events
        : undefined,
      output: it.output || undefined,
    })),
    prompts: promptData
      ? {
          agent_instructions: promptData.agentInstructions || undefined,
          user_prompt: promptData.userPrompt || undefined,
        }
      : undefined,
  };
}

/** Total ms the stage actually ran — sum of all iteration durations. */
function _stageWallMs(stage) {
  const iters = stage.iterations || [];
  if (iters.length === 0) {
    if (!stage.started_at || !stage.completed_at) return 0;
    return elapsed(stage.started_at, stage.completed_at);
  }
  let total = 0;
  for (const it of iters) {
    if (it.started_at && it.completed_at) {
      total += elapsed(it.started_at, it.completed_at);
    }
  }
  return total;
}

function timingStripView(startedAt, completedAt, extra = nothing) {
  const dur = startedAt ? formatDuration(elapsed(startedAt, completedAt)) : '';
  return html`
    <div class="timing-strip">
      ${startedAt ? html`<span class="timing-strip-item"><span class="meta-label">Started:</span> <span class="meta-value">${formatTimestamp(startedAt)}</span></span>` : nothing}
      ${completedAt ? html`<span class="timing-strip-item"><span class="meta-label">Finished:</span> <span class="meta-value">${formatTimestamp(completedAt)}</span></span>` : nothing}
      ${dur ? html`<span class="timing-strip-item"><span class="meta-label">Duration:</span> <span class="meta-value">${dur}</span></span>` : nothing}
      ${extra}
    </div>
  `;
}

// Timing row for an expanded stage panel. A pending stage has no started_at, so
// the normal timing strip would render empty — leaving the panel body nearly
// blank and letting the absolutely-positioned "Copy" button float up against
// the divider. Show a "not started" placeholder instead (keeping the
// .timing-strip border so the divider is intact); once the stage runs this is
// replaced by the real Started / Finished / Duration line.
export function _stageTimingRow(stage) {
  if (!stage.started_at) {
    return html`<div class="timing-strip timing-strip--pending">
      <span class="timing-strip-pending">This stage hasn't started yet.</span>
    </div>`;
  }
  return timingStripView(stage.started_at, stage.completed_at);
}

function _modelInfoView(model, modelAlias) {
  if (!model) return nothing;
  const hasAlias = !!modelAlias && modelAlias !== model;
  if (!hasAlias) {
    return html`<span class="stage-info-item"><span class="meta-label">Model ID:</span> <span class="meta-value">${model}</span></span>`;
  }
  return html`
    <span class="stage-info-item"><span class="meta-label">Model Alias:</span> <span class="meta-value">${modelAlias}</span></span>
    <span class="stage-info-item"><span class="meta-label">Model ID:</span> <span class="meta-value">${model}</span></span>
  `;
}

function _iterationDetailView(
  iter,
  stageKey,
  stageAgent,
  promptData,
  graphifyEnabled,
  crgEnabled,
) {
  const agentName = iter.agent || stageAgent || stageKey;
  const model = iter.model || '';
  const iterNum = iter.number ?? 0;
  // Find the prompt for this iteration
  const iterPrompts = promptData?.iterationPrompts || [];
  const iterPrompt = iterPrompts.find((ip) => ip.iteration === iterNum);
  const userPrompt = iterPrompt?.prompt || promptData?.userPrompt || null;
  const iterPromptData = userPrompt
    ? {
        agentInstructions: promptData?.agentInstructions,
        agentInstructionsIsRawTemplate:
          promptData?.agentInstructionsIsRawTemplate,
        userPrompt,
      }
    : promptData;
  const iterDur = iter.started_at
    ? formatDuration(elapsed(iter.started_at, iter.completed_at || null))
    : '';
  return html`
    <div class="iteration-detail">
      ${timingStripView(iter.started_at, iter.completed_at)}
      <div class="stage-info-strip">
        ${agentName ? html`<span class="stage-info-item"><span class="meta-label">Agent:</span> <span class="meta-value">${agentName}</span></span>` : nothing}
        ${_modelInfoView(model, iter.model_alias)}
        ${iter.turns ? html`<span class="stage-info-item"><span class="meta-label">Turns:</span> <span class="meta-value">${iter.turns}</span></span>` : nothing}
        ${iter.duration_api_ms ? html`<span class="stage-info-item"><span class="meta-label">API:</span> <span class="meta-value">${formatDuration(iter.duration_api_ms)}${iter.started_at && iter.completed_at ? ` (${Math.round((iter.duration_api_ms / elapsed(iter.started_at, iter.completed_at)) * 100)}%)` : ''}</span></span>` : nothing}
        ${
          iter.api_retries
            ? html`<span class="stage-info-item iter-retry-warn">${unsafeHTML(iconSvg(RefreshCw, 12))} <span class="meta-value">${iter.api_retries} ${iter.api_retries === 1 ? 'retry' : 'retries'}</span></span>`
            : nothing
        }
        ${
          iter.non_api_wait_ms
            ? html`<span class="stage-info-item"><sl-tooltip content="Wall time not generating tokens (tools + API retry/backoff)${iter.api_error_status ? ` · last API status ${iter.api_error_status}` : ''}"><span class="meta-label">Wait:</span> <span class="meta-value">${formatDuration(iter.non_api_wait_ms)}${iter.started_at && iter.completed_at ? ` (${Math.round((iter.non_api_wait_ms / elapsed(iter.started_at, iter.completed_at)) * 100)}%)` : ''}</span></sl-tooltip></span>`
            : nothing
        }
        ${iter.cost_usd != null ? html`<span class="stage-info-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${Number(iter.cost_usd).toFixed(2)}</span></span>` : nothing}
        ${iterDur ? html`<span class="stage-info-item"><span class="meta-label">Duration:</span> <span class="meta-value">${iterDur}</span></span>` : nothing}
        ${iter.context_final_pct != null ? html`<span class="stage-info-item"><sl-tooltip content="Context consumed at completion"><span class="meta-label">Context:</span> <span class="meta-value">${iter.context_final_pct}%</span></sl-tooltip></span>` : nothing}
      </div>
      ${
        iter.trigger || iter.outcome
          ? html`
        <div class="iteration-tags-row">
          ${iter.trigger ? html`<span class="meta-label">Iteration Trigger:</span> ${_triggerBadge(iter.trigger)}` : nothing}
          ${iter.outcome ? html`<span class="meta-label">Iteration Outcome:</span> ${_outcomeBadge(iter.outcome)}` : nothing}
        </div>
      `
          : nothing
      }
      ${_effortRowView(iter, graphifyEnabled, crgEnabled)}
      ${_classificationRowView(iter)}
      ${_dispatchEventsRowsView(iter)}
      ${_agentPromptSection(stageKey, iterPromptData)}
    </div>
  `;
}

function _copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.textContent = 'Copy';
    }, 1500);
  });
}

function _agentPromptSection(_stageKey, promptData) {
  if (!promptData) return nothing;
  const { agentInstructions, agentInstructionsIsRawTemplate, userPrompt } =
    promptData;
  if (!agentInstructions && !userPrompt) return nothing;
  const promptLabel = agentInstructionsIsRawTemplate
    ? 'Agent Prompt (unresolved template — not the delivered prompt)'
    : 'Agent Prompt (resolved)';
  return html`
    <sl-details class="agent-prompt-section" @sl-after-show=${scrollOnExpand}>
      <div slot="summary" class="agent-prompt-header">
        <span class="stage-meta-icon">${unsafeHTML(iconSvg(FileText, 12))}</span>
        Agent Instructions
        ${helpFor('agent-prompt')}
      </div>
      ${
        agentInstructions
          ? html`
        <div class="agent-prompt-block">
          <div class="agent-prompt-label-row">
            <span class="agent-prompt-label">${promptLabel}</span>
            <button class="copy-btn" @click=${(e) => _copyToClipboard(agentInstructions, e.currentTarget)}>
              ${unsafeHTML(iconSvg(ClipboardCopy, 11))} Copy
            </button>
          </div>
          <div class="markdown-body">${unsafeHTML(renderMarkdown(agentInstructions))}</div>
        </div>
      `
          : nothing
      }
      ${
        userPrompt
          ? html`
        <div class="agent-prompt-block">
          <div class="agent-prompt-label-row">
            <span class="agent-prompt-label">User Message (-p)</span>
            <button class="copy-btn" @click=${(e) => _copyToClipboard(userPrompt, e.currentTarget)}>
              ${unsafeHTML(iconSvg(ClipboardCopy, 11))} Copy
            </button>
          </div>
          <div class="markdown-body">${unsafeHTML(renderMarkdown(userPrompt))}</div>
        </div>
      `
          : nothing
      }
    </sl-details>
  `;
}

function _graphWithTooltips(beads) {
  const { svg, nodes } = beadsDependencyGraph(beads);
  return html`
    <div class="run-beads-graph">
      ${unsafeHTML(svg)}
      ${nodes.map(
        ({ issue, x, y, w, h }) => html`
        <sl-tooltip class="bead-tooltip" hoist placement="bottom" distance="4">
          <div slot="content">${beadTooltipContent(issue)}</div>
          <div class="graph-tooltip-trigger" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>
        </sl-tooltip>
      `,
      )}
    </div>
  `;
}

export function guideConflictsPanelView(conflicts, options = {}) {
  if (!conflicts || conflicts.length === 0) return nothing;
  return html`
    <sl-details open class="guide-conflicts-panel" @sl-after-show=${scrollOnExpand}>
      <div slot="summary" class="guide-conflicts-header">
        <span class="guide-conflicts-icon">${unsafeHTML(iconSvg(AlertTriangle, 16))}</span>
        <span class="guide-conflicts-title">Guide Conflicts</span>
        <sl-badge variant="warning" pill>${conflicts.length}</sl-badge>
      </div>
      <div class="guide-conflicts-list">
        ${conflicts.map(
          (c) => html`
          <div class="guide-conflict-row">
            <span class="guide-conflict-stage">${c.stage}</span>
            <span class="guide-conflict-message">${c.message}</span>
            <sl-badge variant="neutral" pill class="guide-conflict-source">${c.source}</sl-badge>
            <button class="guide-conflict-view-source" @click=${() => options.onViewSource?.(c.stage)}>View source</button>
          </div>
        `,
        )}
      </div>
    </sl-details>
  `;
}

export function _createPrClickHandler(run, rerender, options) {
  return async () => {
    _prCreationState.set(run.id, { inFlight: true, error: null });
    rerender?.();
    try {
      const r = await fetch(`${_runApiBase(run)}/pr`, { method: 'POST' });
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        // Mark created so the button can't reappear (and fire a duplicate PR)
        // while the local run object is still stale — the server-side pr_url
        // won't be on `run` until the next status refresh. Carry the parsed
        // pr_url so we can show "View PR" optimistically in the meantime.
        _prCreationState.set(run.id, {
          inFlight: false,
          error: null,
          created: true,
          createdPrUrl: data.pr_url || '',
        });
        options?.onCreatePr?.(run.id, data.pr_url);
      } else {
        const err = await r.json().catch(() => ({}));
        _prCreationState.set(run.id, {
          inFlight: false,
          error: err.error || `Server error ${r.status}`,
        });
      }
    } catch (err) {
      _prCreationState.set(run.id, {
        inFlight: false,
        error: err.message || 'Network error',
      });
    }
    rerender?.();
  };
}

export function prDeferredSectionView(run, rerender, options) {
  const prUrl = run?.pr?.url || run?.pr_url;
  if (prUrl) return nothing;
  if (!run?.pr_deferred) return nothing;

  const clientState = _prCreationState.get(run?.id);
  const serverState = run?.pr_creation?.state;

  const isInFlight = clientState?.inFlight || serverState === 'in_progress';
  const isFailed =
    !isInFlight && (clientState?.error || serverState === 'failed');
  const errorMsg = clientState?.error || run?.pr_creation?.error;

  if (isInFlight) {
    const startedAt = run?.pr_creation?.started_at;
    const elapsedStr = startedAt
      ? ` (${formatDuration(elapsed(startedAt, null))})`
      : '';
    return html`
      <div class="pr-deferred-section">
        <sl-badge class="pr-deferred-badge" variant="warning" pill>deferred</sl-badge>
        <button class="action-btn action-btn--primary" disabled>
          <sl-spinner style="--track-width: 2px; font-size: 0.75rem"></sl-spinner>
          Creating PR…${elapsedStr}
        </button>
      </div>
    `;
  }

  if (isFailed) {
    return html`
      <div class="pr-deferred-section">
        <sl-badge class="pr-deferred-badge" variant="warning" pill>deferred</sl-badge>
        ${errorMsg ? html`<div class="pr-deferred-error">${errorMsg}</div>` : nothing}
        <button
          class="action-btn action-btn--primary"
          @click=${_createPrClickHandler(run, rerender, options)}
        >Retry</button>
      </div>
    `;
  }

  // PR was just created client-side but the server-refreshed pr_url hasn't
  // reached this `run` yet. Show a success line (with the link if we parsed
  // one) INSTEAD of the create button, so a second click can't open a
  // duplicate PR. Once the status refresh lands run.pr_url, the early
  // `if (prUrl) return nothing` above takes over and the normal PR line shows.
  if (clientState?.created) {
    const createdUrl = clientState.createdPrUrl;
    return html`
      <div class="pr-deferred-section">
        <sl-badge class="pr-deferred-badge" variant="success" pill>PR created</sl-badge>
        ${
          createdUrl
            ? html`<a class="run-pr-link" href="${createdUrl}" target="_blank">View PR</a>`
            : nothing
        }
      </div>
    `;
  }

  return html`
    <div class="pr-deferred-section">
      <sl-badge class="pr-deferred-badge" variant="warning" pill>deferred</sl-badge>
      <button
        class="action-btn action-btn--primary"
        @click=${_createPrClickHandler(run, rerender, options)}
      >Create PR</button>
    </div>
  `;
}

export function prApprovalPanelView(run, options = {}) {
  if (
    !(
      run?.milestones?.pr_approved === false &&
      run?.pipeline_status === 'paused'
    )
  ) {
    return nothing;
  }
  const { onApprove, onReject } = options;
  return html`
    <sl-card class="approval-panel" data-testid="pr-approval-panel">
      <div slot="header">
        <strong>PR creation paused — approval required</strong>
        ${helpFor('reviewing')}
      </div>
      <p>The pipeline is ready to create a pull request for this run. Approve to proceed, or reject to stop the pipeline.</p>
      <div class="approval-actions">
        <sl-button variant="success" id="pr-approve-btn" @click=${() => onApprove?.(run.id)}>Approve &amp; create PR</sl-button>
        <sl-button variant="danger" outline id="pr-reject-btn" @click=${() => onReject?.(run.id)}>Reject</sl-button>
      </div>
    </sl-card>
  `;
}

export function runBeadsSectionView(beads, options = {}) {
  // `loaded` defaults to "a value was passed" so existing callers that pass just
  // the issues array keep rendering data; main.js passes it explicitly to drive
  // the not-loaded (spinner) state.
  const { loaded = beads !== undefined, showSpinner = false } = options;

  // Summary-right (badge / spinner / nothing) and body, resolved per state:
  //   not loaded            → panel appears immediately; spinner only after the
  //                           150ms gate (showSpinner), else an empty summary.
  //   loaded, beads === null → load failed (don't claim "no beads").
  //   loaded, []            → no linked beads.
  //   loaded, [...]         → count badge + list (+ graph).
  let summaryRight = nothing;
  let body = nothing;

  if (!loaded) {
    summaryRight = showSpinner
      ? html`<sl-spinner
          class="run-beads-loading"
          data-testid="run-beads-loading"
        ></sl-spinner>`
      : nothing;
    body = showSpinner
      ? html`<div class="run-beads-empty">Loading Beads…</div>`
      : nothing;
  } else if (beads === null) {
    summaryRight = html`<sl-badge variant="warning" pill>—</sl-badge>`;
    body = html`<div class="run-beads-empty">Couldn't load Beads issues</div>`;
  } else if (beads.length === 0) {
    body = html`<div class="run-beads-empty">No linked Beads issues</div>`;
  } else {
    const closed = beads.filter((b) => b.status === 'closed').length;
    const total = beads.length;
    const variant = closed === total ? 'success' : 'primary';
    summaryRight = html`<sl-badge variant="${variant}" pill>${closed}/${total}</sl-badge>`;
    body = html`
      <div class="run-beads-list">
        ${beads.map(
          (issue) => html`
          <sl-tooltip class="bead-tooltip" hoist placement="bottom" distance="4">
            <div slot="content">${beadTooltipContent(issue)}</div>
            <div class="run-bead-row">
              <sl-badge variant="${priorityVariant(issue.priority)}" pill>P${issue.priority}</sl-badge>
              ${
                issue.blocked_by?.length
                  ? html`<sl-badge variant="warning" pill>blocked</sl-badge>`
                  : html`<sl-badge variant="${statusVariant(issue.status, issue)}" pill>${issue.status}</sl-badge>`
              }
              <span class="run-bead-id">#${issue.id}</span>
              <span class="run-bead-title">${issue.title}</span>
            </div>
          </sl-tooltip>
        `,
        )}
      </div>
      ${beads.length > 1 ? _graphWithTooltips(beads) : nothing}
    `;
  }

  return html`
    <div class="run-beads-section">
      <sl-details class="run-beads-panel" @sl-after-show=${scrollOnExpand}>
        <div slot="summary" class="run-beads-header">
          <span class="run-beads-icon">${unsafeHTML(iconSvg(List, 16))}</span>
          <span class="run-beads-title">Beads</span>
          ${summaryRight}
        </div>
        ${body}
      </sl-details>
    </div>
  `;
}

export function runDetailView(run, settings = {}, options = {}) {
  if (!run) {
    const empty = html`<div class="empty-state">Select a run to view details</div>`;
    return { overview: empty, stages: empty };
  }

  const sourceBranch =
    run.head_branch || run.branch || run.work_request?.branch || '';
  const targetBranch = run.target_branch || '';
  const defaultBranch = run._default_branch || '';
  const showTargetBranch = targetBranch && targetBranch !== defaultBranch;
  const pipelineTemplate = formatPipelineTemplate(run.pipeline_template);
  const pr = run.pr?.url || run.pr_url || null;
  const endTime =
    run.completed_at || (run.active ? null : _lastStageEnd(run.stages));
  const rawStages = run.stages || {};
  // Ensure preflight and learn exist (may be absent in old runs)
  let stages = rawStages;
  if (!rawStages.preflight)
    stages = { preflight: { status: 'skipped' }, ...stages };
  if (!rawStages.learn) stages = { ...stages, learn: { status: 'skipped' } };
  const stageUi = settings.stageUi || {};
  const agents = settings.agents || {};

  const overview = html`
    <div class="run-detail-overview">
      ${helpFor('lifecycle')}
      <div class="run-detail-stage-timeline-wrap">
        ${stageTimelineView(stages, stageUi, run.active)}
        ${helpFor('pipeline-stages')}
      </div>
      ${_circuitBreakerBannerView(run, settings)}
      ${prVerificationBannerView(run)}
      ${guideConflictsPanelView(run.guide_conflicts, options)}

      <div class="run-info-section">
        ${
          run.project || run._project
            ? html`
          <div class="run-project">
            <span class="meta-label">Project:</span>
            <span class="meta-value run-project-name">${run.project || run._project}</span>
          </div>
        `
            : nothing
        }
        ${
          run.fleet_id && run.group_type === 'fleet'
            ? html`
          <div class="run-group">
            <span class="meta-label">Fleet:</span>
            <a
              class="meta-value run-group-link"
              href="#/fleet-runs/${run.fleet_id}"
              title="Open fleet detail"
            >${run.fleet_id}</a>
          </div>
        `
            : nothing
        }
        ${
          run.workspace_id && run.group_type === 'workspace'
            ? html`
          <div class="run-group">
            <span class="meta-label">Workspace:</span>
            <a
              class="meta-value run-group-link"
              href="#/workspace-runs/${run.workspace_id}"
              title="Open workspace detail"
            >${run.workspace_id}</a>
          </div>
          <div class="run-plan-mode">
            <span class="meta-label">Planning:</span>
            <sl-badge class="plan-mode-badge" variant="neutral" pill>${run.manifest?.plan_mode || 'master'}</sl-badge>
          </div>
        `
            : nothing
        }
        ${
          sourceBranch
            ? html`
          <div class="run-branch">
            <span class="meta-label">Source Branch:</span>
            <span class="meta-value">${sourceBranch}</span>
            ${pr ? html`<a class="run-pr-link" href="${pr}" target="_blank">View PR</a>` : nothing}
          </div>
        `
            : nothing
        }
        ${
          showTargetBranch
            ? html`
          <div class="run-target-branch">
            <span class="meta-label">Target Branch:</span>
            <span class="meta-value">${targetBranch}</span>
          </div>
        `
            : nothing
        }
        ${
          run.source_type
            ? html`
          <div class="run-source">
            <span class="meta-label">Source:</span>
            <span class="meta-value run-source-type">${run.source_type}</span>
            ${run.source_ref ? html`<span class="meta-value run-source-ref">${run.source_ref}</span>` : nothing}
          </div>
        `
            : nothing
        }
        ${run.revises_pr ? _prInfoStripView(run, { isReviseInput: true }) : nothing}
        ${prCommentsView(run.review_feedback)}
        ${
          pipelineTemplate
            ? html`
          <div class="run-template">
            <span class="meta-label">Pipeline Template:</span>
            <span class="meta-value">${pipelineTemplate}</span>
          </div>
        `
            : nothing
        }
        ${
          run.is_worktree_run && run.worktree_path
            ? html`
          <div class="run-worktree">
            <span class="meta-label">Worktree:</span>
            <span class="meta-value run-worktree-path">${run.worktree_path}</span>
            <sl-copy-button value=${run.worktree_path}></sl-copy-button>
          </div>
        `
            : nothing
        }
        ${(() => {
          const effortCfg = settings.effort;
          if (!effortCfg?.auto_mode) return nothing;
          return html`
          <div class="run-effort-header">
            <sl-badge class="effort-header-chip" variant="neutral" pill>Effort: ${effortCfg.auto_mode} · cap ${effortCfg.auto_cap || 'xhigh'}</sl-badge>
          </div>
        `;
        })()}
        ${timingStripView(run.started_at, endTime)}
        ${(() => {
          const allIters = Object.values(stages).flatMap(
            (s) => s.iterations || [],
          );
          const pipelineCost = allIters.reduce(
            (sum, it) => sum + (it.cost_usd || 0),
            0,
          );
          const pipelineTurns = allIters.reduce(
            (sum, it) => sum + (it.turns || 0),
            0,
          );
          const pipelineWallMs = run.started_at
            ? elapsed(run.started_at, endTime || null)
            : 0;
          return html`
            ${
              pipelineCost > 0 || pipelineTurns > 0
                ? html`
              <div class="pipeline-cost-strip">
                ${pipelineCost > 0 ? html`<span class="pipeline-cost-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${pipelineCost.toFixed(2)}</span></span>` : nothing}
                ${pipelineTurns > 0 ? html`<span class="pipeline-cost-item"><span class="meta-label">Total Turns:</span> <span class="meta-value">${pipelineTurns}</span></span>` : nothing}
              </div>
            `
                : nothing
            }
            ${
              options.onOpenTimeline || options.onOpenAccess
                ? html`
              <div class="pipeline-timing-bar-actions">
                ${
                  options.onOpenAccess
                    ? html`<button
                  class="action-btn action-btn--primary"
                  @click=${options.onOpenAccess}
                ><span aria-hidden="true">${unsafeHTML(iconSvg(FolderTree, 14))}</span> Access</button>`
                    : nothing
                }
                ${
                  options.onOpenTimeline
                    ? html`<button
                  class="action-btn action-btn--primary"
                  @click=${options.onOpenTimeline}
                ><span aria-hidden="true">${unsafeHTML(iconSvg(BarChart3, 14))}</span> Timeline</button>`
                    : nothing
                }
              </div>
            `
                : nothing
            }
            ${_pipelineTimingBar(allIters, pipelineWallMs)}
          `;
        })()}
      </div>
    </div>
  `;

  const stagePanels = html`
      <div class="stage-panels">
        ${_sortedEntries(stages).map(([key, stage]) => {
          const label =
            stageUi[key]?.label || key.replace(/_/g, ' ').toUpperCase();
          const stageStatus = resolveStatus(
            stage.status || 'pending',
            run.active,
          );
          const stageAgent = stage.agent || agents[key]?.agent || key;
          const stageModel = stage.model || agents[key]?.model || '';
          const stageMs = _stageWallMs(stage);
          const stageDuration = stageMs > 0 ? formatDuration(stageMs) : '';
          const iterations = stage.iterations || [];
          const hasMultipleIterations = iterations.length > 1;
          const stageCost = _stageCost(iterations);
          // W-074 stage-level retry aggregates for the summary chip + Duration
          // tooltip. stageToolsMs mirrors the timing bar's bucketing so the
          // breakdown (Thinking/Tools/Retry-Wait) is traceable and adds up.
          const stageRetries = iterations.reduce(
            (s, it) => s + (it.api_retries || 0),
            0,
          );
          const stageSummaryApiMs = iterations.reduce(
            (s, it) => s + (it.duration_api_ms || 0),
            0,
          );
          const stageRetryWaitMs = iterations.reduce(
            (s, it) => s + (it.api_retry_wait_ms || 0),
            0,
          );
          const stageSummaryApiPct =
            stageMs > 0 && stageSummaryApiMs > 0
              ? Math.round((stageSummaryApiMs / stageMs) * 100)
              : 0;
          const stageToolsMs = Math.max(
            0,
            stageMs - stageSummaryApiMs - stageRetryWaitMs,
          );

          return html`
            <sl-details ?open=${stageStatus === 'in_progress'} class="stage-panel"
              @sl-after-show=${(e) => {
                scrollOnExpand(e);
                if (!hasMultipleIterations) return;
                const tabGroup = e.target.querySelector('sl-tab-group');
                if (!tabGroup) return;
                const targetIter = resolveIterationTab(
                  options.stageIterationTab,
                  key,
                  iterations,
                );
                const panelName = `iter-${key}-${targetIter}`;
                requestAnimationFrame(() => tabGroup.show(panelName));
              }}>
              <div slot="summary" class="stage-panel-header">
                <span class="stage-panel-icon ${statusClass(stageStatus)}">${unsafeHTML(statusIcon(stageStatus))}</span>
                <span class="stage-panel-label">${label}</span>
                <span class="stage-panel-meta">
                  ${
                    hasMultipleIterations
                      ? html`
                    <span class="stage-meta-item stage-meta-iteration">
                      <span class="stage-meta-icon">${unsafeHTML(iconSvg(RefreshCw, 11))}</span>
                      <span class="meta-value">${iterations.length} iterations</span>
                    </span>
                  `
                      : nothing
                  }
                  ${(() => {
                    const t = iterations.reduce(
                      (s, it) => s + (it.turns || 0),
                      0,
                    );
                    return t > 0
                      ? html`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${unsafeHTML(iconSvg(RefreshCw, 11))}</span>
                      <span class="meta-value">${t} turns</span>
                    </span>
                  `
                      : nothing;
                  })()}
                  ${
                    stageCost > 0
                      ? html`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${unsafeHTML(iconSvg(Coins, 11))}</span>
                      <span class="meta-value">$${stageCost.toFixed(2)}</span>
                    </span>
                  `
                      : nothing
                  }
                  ${
                    stage.completed_at
                      ? html`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${unsafeHTML(iconSvg(Clock, 11))}</span>
                      <span class="meta-value">${formatTimestamp(stage.completed_at)}</span>
                    </span>
                  `
                      : nothing
                  }
                  ${
                    stageRetries > 0
                      ? html`
                    <sl-tooltip content="API retries: ${stageRetries} (throttled / backing off after 429/529)">
                      <span class="stage-meta-item iter-retry-warn" aria-label="${stageRetries} API ${stageRetries === 1 ? 'retry' : 'retries'}">
                        <span class="stage-meta-icon">${unsafeHTML(iconSvg(RefreshCw, 11))}</span>
                        <span class="meta-value">${stageRetries}</span>
                      </span>
                    </sl-tooltip>
                  `
                      : nothing
                  }
                  ${
                    stageDuration
                      ? html`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${unsafeHTML(iconSvg(Timer, 11))}</span>
                      <sl-tooltip hoist placement="bottom" distance="4">
                        <div slot="content">
                          <strong>Duration ${stageDuration}</strong><br>
                          Thinking (API): ${formatDuration(stageSummaryApiMs)} (${stageSummaryApiPct}%)<br>
                          Tools: ${formatDuration(stageToolsMs)}<br>
                          API Retry/Wait: ${formatDuration(stageRetryWaitMs)}${stageRetries > 0 ? html` · ⟳ ${stageRetries} ${stageRetries === 1 ? 'retry' : 'retries'}` : nothing}
                        </div>
                        <span class="meta-value">${stageDuration}</span>
                      </sl-tooltip>
                    </span>
                  `
                      : nothing
                  }
                </span>
                ${key === 'pr' ? _prTitleBadge(run) : nothing}
                <sl-badge variant="${_badgeVariant(stageStatus)}" pill>
                  ${stageStatus.replace(/_/g, ' ')}
                </sl-badge>
              </div>
              ${(() => {
                const promptData =
                  stageStatus !== 'pending' ? options.promptCache?.[key] : null;
                const copyBtn = html`
                  <button class="stage-copy-btn" title="Copy stage data as JSON" @click=${(
                    e,
                  ) => {
                    const json = _stageToJson(
                      key,
                      stage,
                      stageAgent,
                      stageModel,
                      promptData,
                    );
                    _copyToClipboard(
                      JSON.stringify(json, null, 2),
                      e.currentTarget,
                    );
                  }}>
                    ${unsafeHTML(iconSvg(ClipboardCopy, 12))} Copy
                  </button>
                `;
                if (hasMultipleIterations) {
                  const stageTotalDur =
                    stageMs > 0 ? formatDuration(stageMs) : '';
                  return html`
                    <div class="stage-content-wrapper">
                      ${copyBtn}
                      ${(() => {
                        const stageApiMs = iterations.reduce(
                          (sum, it) => sum + (it.duration_api_ms || 0),
                          0,
                        );
                        const stageTurns = iterations.reduce(
                          (sum, it) => sum + (it.turns || 0),
                          0,
                        );
                        const stageApiPct =
                          stageMs > 0 && stageApiMs > 0
                            ? Math.round((stageApiMs / stageMs) * 100)
                            : 0;
                        return html`
                          <div class="stage-totals-strip">
                            <span class="stage-totals-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${stageCost.toFixed(2)}</span></span>
                            <span class="stage-totals-item"><span class="meta-label">Duration:</span> <span class="meta-value">${stageTotalDur}</span></span>
                            ${stageApiMs > 0 ? html`<span class="stage-totals-item"><span class="meta-label">API Duration:</span> <span class="meta-value">${formatDuration(stageApiMs)}${stageApiPct > 0 ? ` (${stageApiPct}%)` : ''}</span></span>` : nothing}
                            ${stageTurns > 0 ? html`<span class="stage-totals-item"><span class="meta-label">Turns:</span> <span class="meta-value">${stageTurns}</span></span>` : nothing}
                          </div>`;
                      })()}
                      ${key === 'pr' ? _prVerifiedBadgeView(run) : nothing}
                      ${key === 'pr' && !run?.revises_pr ? _prInfoStripView(run) : nothing}
                      ${key === 'pr' ? prDeferredSectionView(run, options.rerender, options) : nothing}
                      ${key === 'preflight' ? _preflightGraphBadgesRow(stage, run) : nothing}
                      ${key === 'preflight' ? _preflightRunMetaView(run) : nothing}
                      <sl-tab-group @sl-tab-show=${(e) => {
                        const panel = e.detail.name;
                        const num = parseInt(panel.split('-').pop(), 10);
                        if (!Number.isNaN(num))
                          options.onStageTabChange?.(key, num);
                      }}>
                        ${iterations.map(
                          (iter) => html`
                          <sl-tab slot="nav" panel="iter-${key}-${iter.number}">
                            Iter ${iter.number} ${_iterStatusIcon(iter)}
                          </sl-tab>
                        `,
                        )}
                        ${iterations.map(
                          (iter) => html`
                          <sl-tab-panel name="iter-${key}-${iter.number}">
                            ${_iterationDetailView(iter, key, stageAgent, promptData, run.graphify_enabled, run.crg_enabled)}
                            ${key === 'preflight' ? _preflightIterChecksView(stage, iter) : nothing}
                            ${_planIterationButton(key, iter, run, options.rerender)}
                          </sl-tab-panel>
                        `,
                        )}
                      </sl-tab-group>
                    </div>
                  `;
                }
                return html`
                  <div class="stage-content-wrapper">
                    ${copyBtn}
                    <div class="stage-detail">
                      ${_stageTimingRow(stage)}
                      <div class="stage-info-strip">
                        ${stageAgent ? html`<span class="stage-info-item"><span class="meta-label">Agent:</span> <span class="meta-value">${stageAgent}</span></span>` : nothing}
                        ${_modelInfoView(stageModel, stage.model_alias)}
                        ${iterations.length === 1 && iterations[0].turns ? html`<span class="stage-info-item"><span class="meta-label">Turns:</span> <span class="meta-value">${iterations[0].turns}</span></span>` : nothing}
                        ${iterations.length === 1 && iterations[0].duration_api_ms ? html`<span class="stage-info-item"><span class="meta-label">API:</span> <span class="meta-value">${formatDuration(iterations[0].duration_api_ms)}${stageMs > 0 ? ` (${Math.round((iterations[0].duration_api_ms / stageMs) * 100)}%)` : ''}</span></span>` : nothing}
                        ${iterations.length === 1 && iterations[0].api_retries ? html`<span class="stage-info-item iter-retry-warn">${unsafeHTML(iconSvg(RefreshCw, 12))} <span class="meta-value">${iterations[0].api_retries} ${iterations[0].api_retries === 1 ? 'retry' : 'retries'}</span></span>` : nothing}
                        ${iterations.length === 1 && iterations[0].non_api_wait_ms ? html`<span class="stage-info-item"><sl-tooltip content="Wall time not generating tokens (tools + API retry/backoff)${iterations[0].api_error_status ? ` · last API status ${iterations[0].api_error_status}` : ''}"><span class="meta-label">Wait:</span> <span class="meta-value">${formatDuration(iterations[0].non_api_wait_ms)}${stageMs > 0 ? ` (${Math.round((iterations[0].non_api_wait_ms / stageMs) * 100)}%)` : ''}</span></sl-tooltip></span>` : nothing}
                        ${iterations.length === 1 && iterations[0].cost_usd != null ? html`<span class="stage-info-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${Number(iterations[0].cost_usd).toFixed(2)}</span></span>` : nothing}
                        ${iterations.length === 1 && iterations[0].context_final_pct != null ? html`<span class="stage-info-item"><sl-tooltip content="Context consumed at completion"><span class="meta-label">Context:</span> <span class="meta-value">${iterations[0].context_final_pct}%</span></sl-tooltip></span>` : nothing}
                      </div>
                      ${
                        iterations.length === 1 &&
                        (iterations[0].trigger || iterations[0].outcome)
                          ? html`
                        <div class="iteration-tags-row">
                          ${iterations[0].trigger ? html`<span class="meta-label">Iteration Trigger:</span> ${_triggerBadge(iterations[0].trigger)}` : nothing}
                          ${iterations[0].outcome ? html`<span class="meta-label">Iteration Outcome:</span> ${_outcomeBadge(iterations[0].outcome)}` : nothing}
                        </div>
                      `
                          : nothing
                      }
                      ${stage.task_progress ? html`<div class="detail-row"><span class="detail-label">Progress:</span> ${stage.task_progress}</div>` : nothing}
                      ${stage.error ? html`<div class="detail-row detail-error"><span class="detail-label">Error:</span> ${stage.error}</div>` : nothing}
                      ${iterations.length === 1 ? _effortRowView(iterations[0], run.graphify_enabled, run.crg_enabled) : nothing}
                      ${iterations.length === 1 ? _classificationRowView(iterations[0]) : nothing}
                      ${iterations.length === 1 ? _dispatchEventsRowsView(iterations[0]) : nothing}
                      ${key === 'pr' ? _prVerifiedBadgeView(run) : nothing}
                      ${key === 'pr' && !run?.revises_pr ? _prInfoStripView(run) : nothing}
                      ${key === 'pr' ? prDeferredSectionView(run, options.rerender, options) : nothing}
                      ${key === 'preflight' ? _preflightGraphBadgesRow(stage, run) : nothing}
                      ${key === 'preflight' && iterations.length === 1 ? _preflightChecksView(stage, iterations[0], run) : nothing}
                      ${_planIterationButton(key, iterations[0], run, options.rerender)}
                      ${promptData ? _agentPromptSection(key, promptData) : nothing}
                    </div>
                  </div>
                `;
              })()}
              ${
                stageStatus === 'error' && !run.active && options.onRestartStage
                  ? html`
                <div class="stage-restart-btn">
                  <sl-button variant="warning" size="small" @click=${() => options.onRestartStage(key)}>
                    ${unsafeHTML(iconSvg(RotateCcw, 14))}
                    Restart Stage
                  </sl-button>
                </div>
              `
                  : nothing
              }
            </sl-details>
          `;
        })}
      </div>
      ${_planArtifactDialog(run, options.rerender)}
      ${_planReviewIssuesDialog(run, options.rerender)}
  `;

  return { overview, stages: stagePanels };
}
