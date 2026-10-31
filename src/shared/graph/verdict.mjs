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

/** Words agents and other engines write for the four severities. */
const SEVERITY_ALIASES = Object.freeze({
  blocker: 'critical', p0: 'critical', severe: 'critical', fatal: 'critical',
  high: 'major', p1: 'major', important: 'major',
  low: 'minor', p3: 'minor', nit: 'minor', nitpick: 'minor', trivial: 'minor',
  info: 'suggestion', suggest: 'suggestion', optional: 'suggestion',
});

const severityOf = (value) => {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return SEVERITIES.includes(v) ? v : (SEVERITY_ALIASES[v] || null);
};

/** True for one of SEVERITIES or a known alias (case and spacing ignored). */
export function isKnownSeverity(value) {
  return severityOf(value) !== null;
}

/**
 * Normalize an arbitrary value to one of SEVERITIES. Anything unrecognised —
 * a misspelling, a new word, a missing severity — is "major", i.e. blocking:
 * silence is not approval, and a wrong guess costs one bounded fix cycle.
 */
export function normalizeSeverity(value) {
  return severityOf(value) || 'major';
}

/**
 * True if a review contains any critical or major issue.
 * @param {{issues: Array}} review
 * @returns {boolean}
 */
export function hasBlocking(review) {
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
