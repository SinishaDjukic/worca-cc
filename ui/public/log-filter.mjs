// ui/public/log-filter.mjs

// Pure, DOM-free log-filtering rules shared by the run-card live log and the
// History "Live logs" panel. Extracted so the narrowing semantics are
// unit-testable without booting app.js (mirrors log-line.mjs).
//
// A filter is { source, level, step } where '' / undefined means "all".
// - level: exact match; a record with no level counts as 'info' (the same
//   default logLineClass applies when rendering).
// - source: matches the role itself AND its fanned-out sub-agents — a child
//   line's source is "role ▸ label", so filtering by "planner" keeps
//   "planner ▸ research auth" but not "plannerX".
// - step: matches String(rec.stepIndex). Lines with no step attribution
//   (preflight, orchestrator, ui notices) only show when no step is chosen.

const SUB_SEP = ' ▸ ';

export function logLineVisible(rec, filter) {
  if (!filter) return true;
  if (filter.level && (rec.level || 'info') !== filter.level) return false;
  if (filter.source) {
    const src = rec.source || '';
    if (src !== filter.source && !src.startsWith(filter.source + SUB_SEP)) return false;
  }
  if (filter.step !== undefined && filter.step !== '') {
    if (rec.stepIndex == null || String(rec.stepIndex) !== String(filter.step)) return false;
  }
  return true;
}

// Distinct facet values the filter dropdowns offer, from the lines seen so far:
// sources collapsed to their parent role (sub-agents fold into the role they
// belong to), levels defaulted to 'info', steps = the stepIndex values present.
// All sorted (steps numerically) for stable dropdowns.
export function logFacets(lines) {
  const sources = new Set();
  const levels = new Set();
  const steps = new Set();
  for (const rec of lines || []) {
    if (!rec) continue;
    const src = rec.source || '';
    if (src) {
      const sep = src.indexOf(SUB_SEP);
      sources.add(sep === -1 ? src : src.slice(0, sep));
    }
    levels.add(rec.level || 'info');
    if (rec.stepIndex != null) steps.add(rec.stepIndex);
  }
  return {
    sources: [...sources].sort(),
    levels: [...levels].sort(),
    steps: [...steps].sort((a, b) => a - b),
  };
}
