import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { iconSvg, Lightbulb, Loader, AlertTriangle, RefreshCw, ClipboardCopy, Zap } from '../utils/icons.js';
import { formatDuration, elapsed, formatTimestamp } from '../utils/duration.js';

/**
 * Map importance level to sl-badge variant.
 */
export function importanceBadge(importance) {
  switch (importance) {
    case 'critical': return 'danger';
    case 'high': return 'warning';
    case 'medium': return 'primary';
    case 'low': return 'neutral';
    default: return 'neutral';
  }
}

function timingStripView(startedAt, completedAt) {
  const dur = startedAt ? formatDuration(elapsed(startedAt, completedAt || null)) : '';
  return html`
    <div class="timing-strip">
      ${startedAt ? html`<span class="timing-strip-item"><span class="meta-label">Started:</span> <span class="meta-value">${formatTimestamp(startedAt)}</span></span>` : nothing}
      ${completedAt ? html`<span class="timing-strip-item"><span class="meta-label">Finished:</span> <span class="meta-value">${formatTimestamp(completedAt)}</span></span>` : nothing}
      ${dur ? html`<span class="timing-strip-item"><span class="meta-label">Duration:</span> <span class="meta-value">${dur}</span></span>` : nothing}
    </div>
  `;
}

export function observationPrompt(obs) {
  return `Investigate the following observation from a pipeline learning analysis and suggest concrete fixes.

## Observation
- **Category**: ${obs.category}
- **Importance**: ${obs.importance}
- **Description**: ${obs.description}
- **Evidence**: ${obs.evidence}
- **Occurrences**: ${obs.occurrences || 1}

## Tasks
1. Identify the root cause of this observation in the codebase.
2. Find the specific files and code sections involved.
3. Propose concrete changes to prevent this from recurring.
4. If this relates to test failures or loops, identify what test coverage or prompt changes would help.
`;
}

export function suggestionPrompt(s) {
  return `Implement the following suggestion from a pipeline learning analysis.

## Suggestion
- **Target**: ${s.target}
- **Description**: ${s.description}
- **Rationale**: ${s.rationale}

## Tasks
1. Locate the target (${s.target}) in the codebase — this may be a prompt file, config, agent definition, or code module.
2. Understand the current behavior and why the suggestion was made.
3. Implement the suggested change with minimal disruption.
4. Verify the change doesn't break existing functionality.
`;
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const icon = btn.querySelector('.copy-icon');
    if (icon) {
      icon.classList.add('copy-success');
      setTimeout(() => icon.classList.remove('copy-success'), 1500);
    }
  });
}

function summaryStripView(summary) {
  if (!summary) return nothing;
  return html`
    <div class="learnings-summary-strip">
      <span><span class="meta-label">Termination:</span> <span class="meta-value">${summary.termination}</span></span>
      <span><span class="meta-label">Iterations:</span> <span class="meta-value">${summary.total_iterations}</span></span>
      ${summary.test_fix_loops != null ? html`<span><span class="meta-label">Test-fix loops:</span> <span class="meta-value">${summary.test_fix_loops}</span></span>` : nothing}
      ${summary.review_fix_loops != null ? html`<span><span class="meta-label">Review-fix loops:</span> <span class="meta-value">${summary.review_fix_loops}</span></span>` : nothing}
    </div>
  `;
}

const IMPORTANCE_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function sortByImportance(observations) {
  return [...observations].sort((a, b) =>
    (IMPORTANCE_ORDER[a.importance] ?? 4) - (IMPORTANCE_ORDER[b.importance] ?? 4)
  );
}

function observationsTableView(observations) {
  const sorted = sortByImportance(observations);
  return html`
    <h4 class="learnings-table-title">Observations</h4>
    <div class="learnings-table">
      <div class="learnings-table-header">
        <span class="col-center">Importance</span>
        <span>Category</span>
        <span>Description</span>
        <span>Evidence</span>
        <span class="col-center">Count</span>
        <span class="col-center">${unsafeHTML(iconSvg(Zap, 12))}</span>
      </div>
      ${sorted.map(obs => html`
        <div class="learnings-table-row">
          <span class="col-center">
            <sl-badge variant="${importanceBadge(obs.importance)}" pill>
              ${obs.importance}
            </sl-badge>
          </span>
          <span class="learnings-category">${obs.category}</span>
          <span>${obs.description}</span>
          <span class="learnings-evidence">${obs.evidence}</span>
          <span class="col-center">${obs.occurrences || 1}</span>
          <sl-tooltip content="Copy investigation prompt">
            <button class="learnings-copy-btn" @click=${(e) => copyToClipboard(observationPrompt(obs), e.currentTarget)}>
              <span class="copy-icon">${unsafeHTML(iconSvg(ClipboardCopy, 14))}</span>
            </button>
          </sl-tooltip>
        </div>
      `)}
    </div>
  `;
}

function suggestionsTableView(suggestions) {
  return html`
    <h4 class="learnings-table-title">Suggestions</h4>
    <div class="learnings-table">
      <div class="learnings-table-header learnings-table-header--suggestions">
        <span>Target</span>
        <span>Suggestion</span>
        <span>Rationale</span>
        <span class="col-center">${unsafeHTML(iconSvg(Zap, 12))}</span>
      </div>
      ${suggestions.map(s => html`
        <div class="learnings-table-row learnings-table-row--suggestions">
          <span class="learnings-target">${s.target}</span>
          <span>${s.description}</span>
          <span class="learnings-rationale">${s.rationale}</span>
          <sl-tooltip content="Copy implementation prompt">
            <button class="learnings-copy-btn" @click=${(e) => copyToClipboard(suggestionPrompt(s), e.currentTarget)}>
              <span class="copy-icon">${unsafeHTML(iconSvg(ClipboardCopy, 14))}</span>
            </button>
          </sl-tooltip>
        </div>
      `)}
    </div>
  `;
}

function recurringPatternsView(patterns) {
  if (!patterns) return nothing;
  const crossBead = patterns.cross_bead || [];
  const testFix = patterns.test_fix_loops || [];
  const reviewFix = patterns.review_fix_loops || [];
  if (crossBead.length === 0 && testFix.length === 0 && reviewFix.length === 0) return nothing;

  return html`
    <h4 class="learnings-table-title">Recurring Patterns</h4>
    ${crossBead.length > 0 ? html`
      <h5 class="learnings-subtable-title">Cross-Bead</h5>
      <div class="learnings-table">
        <div class="learnings-table-header learnings-table-header--patterns">
          <span>Pattern</span>
          <span>Affected Beads</span>
          <span class="col-center">Count</span>
        </div>
        ${crossBead.map(p => html`
          <div class="learnings-table-row learnings-table-row--patterns">
            <span>${p.pattern}</span>
            <span>${(p.affected_beads || []).join(', ')}</span>
            <span class="col-center">${p.frequency}</span>
          </div>
        `)}
      </div>
    ` : nothing}
    ${testFix.length > 0 ? html`
      <h5 class="learnings-subtable-title">Test-Fix Loops</h5>
      <div class="learnings-table">
        <div class="learnings-table-header learnings-table-header--patterns">
          <span>Pattern</span>
          <span class="col-center">Iterations</span>
          <span class="col-center">Resolved</span>
        </div>
        ${testFix.map(p => html`
          <div class="learnings-table-row learnings-table-row--patterns">
            <span>${p.pattern}</span>
            <span class="col-center">${p.loop_iterations}</span>
            <span class="col-center">
              <sl-badge variant="${p.resolved ? 'success' : 'warning'}" pill>${p.resolved ? 'Yes' : 'No'}</sl-badge>
            </span>
          </div>
        `)}
      </div>
    ` : nothing}
    ${reviewFix.length > 0 ? html`
      <h5 class="learnings-subtable-title">Review-Fix Loops</h5>
      <div class="learnings-table">
        <div class="learnings-table-header learnings-table-header--patterns">
          <span>Pattern</span>
          <span class="col-center">Iterations</span>
          <span class="col-center">Resolved</span>
        </div>
        ${reviewFix.map(p => html`
          <div class="learnings-table-row learnings-table-row--patterns">
            <span>${p.pattern}</span>
            <span class="col-center">${p.loop_iterations}</span>
            <span class="col-center">
              <sl-badge variant="${p.resolved ? 'success' : 'warning'}" pill>${p.resolved ? 'Yes' : 'No'}</sl-badge>
            </span>
          </div>
        `)}
      </div>
    ` : nothing}
  `;
}

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Render the learnings section panel.
 * @param {object|null|undefined} learnStage - The full learn stage object from status.stages.learn
 * @param {object} options - { onRunLearn: Function }
 */
export function learningsSectionView(learnStage, options = {}) {
  const status = learnStage?.status;
  const output = learnStage?.iterations?.[0]?.output;
  const hasData = output && output.observations;
  const error = learnStage?.error || learnStage?.iterations?.[0]?.error;
  const startedAt = learnStage?.started_at || learnStage?.iterations?.[0]?.started_at;
  const completedAt = learnStage?.completed_at || learnStage?.iterations?.[0]?.completed_at;

  let innerContent;

  if (status === 'in_progress' || status === 'pending') {
    const startTime = startedAt ? new Date(startedAt) : null;
    const elapsedMs = startTime ? Date.now() - startTime.getTime() : 0;
    const isStale = elapsedMs > STALE_THRESHOLD_MS;

    if (isStale) {
      innerContent = html`
        <div class="learnings-error">
          <div class="learnings-error-icon">
            ${unsafeHTML(iconSvg(AlertTriangle, 20))}
          </div>
          <div class="learnings-error-text">
            <p class="learnings-error-title">Learning analysis appears to have stalled</p>
            ${timingStripView(startedAt, null)}
          </div>
          <sl-button variant="warning" size="small" @click=${options.onRunLearn}>
            ${unsafeHTML(iconSvg(RefreshCw, 14))} Retry
          </sl-button>
        </div>
      `;
    } else {
      innerContent = html`
        <div class="learnings-in-progress">
          <div class="learnings-in-progress-spinner">
            ${unsafeHTML(iconSvg(Loader, 20, 'icon-spin'))}
          </div>
          <div class="learnings-in-progress-text">
            <p class="learnings-in-progress-title">Learning analysis in progress...</p>
            ${timingStripView(startedAt, null)}
          </div>
        </div>
      `;
    }
  } else if (status === 'error') {
    innerContent = html`
      <div class="learnings-error">
        <div class="learnings-error-icon">
          ${unsafeHTML(iconSvg(AlertTriangle, 20))}
        </div>
        <div class="learnings-error-text">
          <p class="learnings-error-title">Learning analysis failed</p>
          ${error ? html`<p class="learnings-error-detail">${error}</p>` : nothing}
          ${timingStripView(startedAt, completedAt)}
        </div>
        <sl-button variant="warning" size="small" @click=${options.onRunLearn}>
          ${unsafeHTML(iconSvg(RefreshCw, 14))} Retry Learning Analysis
        </sl-button>
      </div>
    `;
  } else if (hasData) {
    const iter = learnStage?.iterations?.[0];
    const turns = iter?.turns;
    const costUsd = iter?.cost_usd;
    const apiMs = iter?.duration_api_ms;
    const wallMs = startedAt && completedAt ? elapsed(startedAt, completedAt) : 0;

    innerContent = html`
      ${timingStripView(startedAt, completedAt)}
      <div class="stage-info-strip">
        ${turns ? html`<span class="stage-info-item"><span class="meta-label">Turns:</span> <span class="meta-value">${turns}</span></span>` : nothing}
        ${apiMs ? html`<span class="stage-info-item"><span class="meta-label">API Duration:</span> <span class="meta-value">${formatDuration(apiMs)}${wallMs > 0 ? ` (${Math.round(apiMs / wallMs * 100)}%)` : ''}</span></span>` : nothing}
        ${costUsd != null ? html`<span class="stage-info-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${Number(costUsd).toFixed(2)}</span></span>` : nothing}
      </div>
      ${summaryStripView(output.run_summary)}
      ${observationsTableView(output.observations)}
      ${suggestionsTableView(output.suggestions || [])}
      ${recurringPatternsView(output.recurring_patterns)}
      <div class="learnings-rerun">
        <sl-button variant="text" size="small" @click=${options.onRunLearn}>
          ${unsafeHTML(iconSvg(RefreshCw, 12))} Re-run Analysis
        </sl-button>
      </div>
    `;
  } else {
    innerContent = html`
      <div class="learnings-empty">
        <p>Learning analysis has not been run for this pipeline execution.</p>
        <sl-button variant="primary" size="small" @click=${options.onRunLearn}>
          Run Learning Analysis
        </sl-button>
      </div>
    `;
  }

  const observations = hasData ? output.observations : [];
  const countLabel = `${observations.length}`;
  const isInProgress = status === 'in_progress' || status === 'pending';

  return html`
    <div class="learnings-section">
      <sl-details class="learnings-panel" ?open=${isInProgress}>
        <div slot="summary" class="learnings-header">
          <span class="learnings-icon">${unsafeHTML(iconSvg(Lightbulb, 16))}</span>
          <span class="learnings-title">Learnings</span>
          ${isInProgress ? html`
            <sl-badge variant="warning" pill>
              ${unsafeHTML(iconSvg(Loader, 10, 'icon-spin'))} Analyzing
            </sl-badge>
          ` : nothing}
          ${hasData ? html`<span class="learnings-count">${countLabel}</span>` : nothing}
          ${status === 'error' ? html`<sl-badge variant="danger" pill>Error</sl-badge>` : nothing}
        </div>
        ${innerContent}
      </sl-details>
    </div>
  `;
}
