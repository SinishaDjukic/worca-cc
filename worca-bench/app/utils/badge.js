// app/utils/badge.js
//
// Per-domain badge + status mapping for the benchmark dashboard. Mirrors the
// worca-ui `status-badge.js` contract: a single source of truth for status →
// CSS class (card left border) and status → Shoelace badge variant. NEVER
// inline `variant="success"` in a view — route through OUTCOME_VARIANT here.
//
// Badge color language (see worca-ui/docs/badge-color-language.md):
//   resolved / high-score  -> success (green)
//   partial                -> warning (orange)
//   unresolved / failed / error -> danger (red)
//   pending / skipped      -> neutral (grey)
//   running                -> primary (blue)

/** Canonical benchmark outcomes used across the dashboard. */
export const OUTCOME_VARIANT = Object.freeze({
  resolved: 'success',
  partial: 'warning',
  unresolved: 'danger',
  error: 'danger',
  pending: 'neutral',
  skipped: 'neutral',
  running: 'primary',
  unknown: 'neutral',
});

const OUTCOME_CLASS = Object.freeze({
  resolved: 'status-completed',
  partial: 'status-paused',
  unresolved: 'status-failed',
  error: 'status-failed',
  pending: 'status-pending',
  skipped: 'status-skipped',
  running: 'status-running',
  unknown: 'status-unknown',
});

const HIGH_SCORE = 0.999;

/**
 * Classify a single benchmark rep row into a canonical outcome string.
 *
 * @param {object} row
 * @returns {keyof typeof OUTCOME_VARIANT}
 */
export function outcomeOf(row) {
  if (!row) return 'unknown';
  const status = row.status;
  if (status === 'error') return 'error';
  if (status === 'skipped') return 'skipped';
  if (row.pipeline_status === 'running' || status === 'running') {
    return 'running';
  }
  if (status === 'ran') return 'pending'; // ran but not yet graded
  if (status === 'graded') {
    if (row.resolved === true) return 'resolved';
    if (typeof row.score === 'number') {
      if (row.score >= HIGH_SCORE) return 'resolved';
      if (row.score > 0) return 'partial';
    }
    return 'unresolved';
  }
  return 'unknown';
}

/**
 * Classify an aggregated profile (from results-store) into an overall outcome,
 * driven by its resolved_rate and grading progress.
 *
 * @param {object} agg  aggregate summary from aggregateProfile
 * @returns {keyof typeof OUTCOME_VARIANT}
 */
export function profileOutcome(agg) {
  if (!agg?.reps) return 'pending';
  if (agg.graded === 0) return 'pending';
  const rate = agg.resolved_rate ?? 0;
  if (rate >= HIGH_SCORE) return 'resolved';
  if (rate > 0) return 'partial';
  return 'unresolved';
}

/**
 * Shoelace badge variant for an outcome string.
 * @param {string} outcome
 * @returns {string}
 */
export function variantFor(outcome) {
  return OUTCOME_VARIANT[outcome] || 'neutral';
}

/**
 * CSS modifier class (status-colored left border) for an outcome string.
 * @param {string} outcome
 * @returns {string}
 */
export function outcomeClass(outcome) {
  return OUTCOME_CLASS[outcome] || 'status-unknown';
}

// Inline SVG status icons (Lucide-derived paths) rendered as the card status
// pip via unsafeHTML — keeps worca-bench dependency-light (no lucide package)
// while matching worca-ui's `statusIcon()` affordance.
const ICON_PATHS = Object.freeze({
  resolved: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  partial:
    '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  unresolved:
    '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  error:
    '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  pending: '<circle cx="12" cy="12" r="10"/>',
  skipped: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  running:
    '<path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/>',
  unknown: '<circle cx="12" cy="12" r="10"/><path d="M12 17h.01"/>',
});

/**
 * Render an outcome's status icon as an SVG string for use with unsafeHTML.
 * The `running` icon spins via the `.icon-spin` class.
 *
 * @param {string} outcome
 * @param {number} [size=16]
 * @returns {string}
 */
export function outcomeIcon(outcome, size = 16) {
  const path = ICON_PATHS[outcome] || ICON_PATHS.unknown;
  const cls = outcome === 'running' ? 'icon-spin' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${cls}">${path}</svg>`;
}
