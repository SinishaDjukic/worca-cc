/**
 * Canonical worca pipeline stage order + human labels.
 *
 * worca-bench is a separate npm package and cannot import from worca-ui, so this
 * MIRRORS worca-ui/app/utils/stage-order.js (which itself mirrors stages.py
 * STAGE_ORDER on the Python side). Keep all three in sync. The live stage row on
 * the profile page sorts the status.json stages by this order and labels them
 * with the same human names worca-ui uses, so the two dashboards read identically.
 */
export const STAGE_ORDER = [
  'preflight',
  'plan',
  'plan_review',
  'coordinate',
  'implement',
  'test',
  'review',
  'pr',
  'learn',
];

const _ORDER = new Map(STAGE_ORDER.map((s, i) => [s, i]));

/** Sort stage objects by canonical order (by `.name`); unknown stages last. */
export function sortStagesByOrder(stages) {
  return [...(stages || [])].sort(
    (a, b) =>
      (_ORDER.has(a.name) ? _ORDER.get(a.name) : 999) -
      (_ORDER.has(b.name) ? _ORDER.get(b.name) : 999),
  );
}

// "pr" → "PR" (acronym); "plan_review" → "Plan Review"; etc. Matches worca-ui's
// toDisplayLabel in timeline-layout.js.
const _ACRONYMS = new Set(['pr', 'crg']);
export function stageLabel(key) {
  if (!key) return '';
  if (_ACRONYMS.has(key)) return key.toUpperCase();
  return key
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ');
}
