// src/shared/graph/verdict.mjs
// The verdict vocabulary: severities, what blocks, and the two readers the
// engine's conditional outputs (`when: blocking|clean`) and the UI both need.
// Moved verbatim out of src/core/protocol.mjs, which re-exports them: protocol
// imports node:fs/promises, so it can never be loaded in a browser, and the
// composer/run monitor need exactly these five symbols.

/**
 * Severity ranking used throughout the pipeline. Order is significant:
 * earlier entries are more severe. "critical" and "major" are *blocking*.
 */
export const SEVERITIES = ['critical', 'major', 'minor', 'suggestion'];

export const BLOCKING = new Set(['critical', 'major']);

/** Normalize an arbitrary value to one of SEVERITIES (default "minor"). */
export function normalizeSeverity(value) {
  if (typeof value !== 'string') return 'minor';
  const v = value.trim().toLowerCase();
  return SEVERITIES.includes(v) ? v : 'minor';
}

/**
 * True if a review contains any critical or major issue, or asks for a re-check (withRecheck).
 * @param {{issues: Array}} review
 * @returns {boolean}
 */
export function hasBlocking(review) {
  if (review?.recheck === true) return true;
  if (!review || !Array.isArray(review.issues)) return false;
  return review.issues.some((i) => BLOCKING.has(normalizeSeverity(i?.severity)));
}

/**
 * The subset of issues that are critical or major.
 * @param {{issues: Array}} review
 * @returns {Array}
 */
export function blockingIssues(review) {
  if (!review || !Array.isArray(review.issues)) return [];
  return review.issues.filter((i) => BLOCKING.has(normalizeSeverity(i?.severity)));
}

/**
 * A loop's first verdict that lists critical or major items under `fixed` (the plan refiner's, which judges the
 * plan it wrote itself) routes as blocking once, so a second cycle re-reads those fixes; later cycles gate on
 * `issues` alone. The added `recheck` flag is what hasBlocking reads; blockingIssues stays the open issues.
 * @param {{issues: Array, fixed?: Array}|null} review
 * @param {number} ordinal  the execution's 1-based ordinal on its node
 */
export function withRecheck(review, ordinal) {
  if (!review || ordinal !== 1 || !Array.isArray(review.fixed)) return review;
  return review.fixed.some((i) => BLOCKING.has(normalizeSeverity(i?.severity))) ? { ...review, recheck: true } : review;
}
