// ui/public/log-filter.mjs

// Pure, DOM-free log-filtering rules shared by the run-card live log and the
// History "Live logs" panel. Extracted so the narrowing semantics are
// unit-testable without booting app.js (mirrors log-line.mjs).
//
// A filter is { source, level, step, cycle, search } where '' / undefined means
// "all". Every axis composes with AND.
// - level: exact match; a record with no level counts as 'info' (the same
//   default logLineClass applies when rendering).
// - source: matches the role itself AND its fanned-out sub-agents — a child
//   line's source is "role ▸ label", so filtering by "planner" keeps
//   "planner ▸ research auth" but not "plannerX".
// - step: matches String(rec.stepIndex). Lines with no step attribution
//   (preflight, orchestrator, ui notices) only show when no step is chosen.
// - cycle: matches String(rec.cycle) — the feedback-loop rewind counter, which is
//   orthogonal to step (a re-run keeps its stepIndex and bumps its cycle). Same
//   attribution rule as step: cycle-less lines only show when no cycle is chosen.
// - search: case-insensitive substring of rec.text. Text only — the source column
//   is already a dropdown, so matching it here would make that filter ambiguous.

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
  if (filter.cycle !== undefined && filter.cycle !== '') {
    if (rec.cycle == null || String(rec.cycle) !== String(filter.cycle)) return false;
  }
  if (filter.search) {
    const term = String(filter.search).toLowerCase();
    if (!String(rec.text || '').toLowerCase().includes(term)) return false;
  }
  return true;
}

// Distinct facet values the filter dropdowns offer, from the lines seen so far:
// sources collapsed to their parent role (sub-agents fold into the role they
// belong to), levels defaulted to 'info', steps = the stepIndex values present,
// cycles = the cycle values present. All sorted (steps/cycles numerically) for
// stable dropdowns. `search` is free text and has no facet.
export function logFacets(lines) {
  const sources = new Set();
  const levels = new Set();
  const steps = new Set();
  const cycles = new Set();
  for (const rec of lines || []) {
    if (!rec) continue;
    const src = rec.source || '';
    if (src) {
      const sep = src.indexOf(SUB_SEP);
      sources.add(sep === -1 ? src : src.slice(0, sep));
    }
    levels.add(rec.level || 'info');
    if (rec.stepIndex != null) steps.add(rec.stepIndex);
    if (rec.cycle != null) cycles.add(rec.cycle);
  }
  return {
    sources: [...sources].sort(),
    levels: [...levels].sort(),
    steps: [...steps].sort((a, b) => a - b),
    cycles: [...cycles].sort((a, b) => a - b),
  };
}
