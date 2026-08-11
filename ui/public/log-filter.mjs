// ui/public/log-filter.mjs

// Pure, DOM-free log-filtering rules shared by the run-card live log and the
// History "Live logs" panel. Extracted so the narrowing semantics are
// unit-testable without booting app.js (mirrors log-line.mjs).
//
// A filter is { source, level, step, executionId, artifactKind } where '' /
// undefined means "all".
// - level: exact match; a record with no level counts as 'info' (the same
//   default logLineClass applies when rendering).
// - source: matches the role itself AND its fanned-out sub-agents — a child
//   line's source is "role ▸ label", so filtering by "planner" keeps
//   "planner ▸ research auth" but not "plannerX".
// - step: matches String(rec.stepIndex). Lines with no step attribution
//   (preflight, orchestrator, ui notices) only show when no step is chosen.
// - executionId: exact match on the graph engine's execution attribution
//   (`x:<nodeId>:<ordinal>`), which rides log/subagent/stepskills/stepgraphify.
//   This is what a run-monitor execution row narrows the log by. Orchestrator-
//   level lines carry none and hide when an execution is chosen, like `step`.
// - artifactKind: exact match on an artifact row's kind (the producing output
//   port's artifactKind). Plain log lines carry none and hide when one is chosen.

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
  if (filter.executionId) {
    if (rec.executionId == null || String(rec.executionId) !== String(filter.executionId)) return false;
  }
  if (filter.artifactKind) {
    if (rec.artifactKind == null || String(rec.artifactKind) !== String(filter.artifactKind)) return false;
  }
  return true;
}

// Distinct facet values the filter dropdowns offer, from the lines seen so far:
// sources collapsed to their parent role (sub-agents fold into the role they
// belong to), levels defaulted to 'info', steps = the stepIndex values present,
// executions = the executionIds present, artifactKinds = the artifact kinds
// present. Sorted (steps numerically) for stable dropdowns, EXCEPT executions:
// their ids are `x:<nodeId>:<ordinal>`, which sorts lexically into nonsense
// (cycle 10 before cycle 2), so they keep first-seen — i.e. run — order.
export function logFacets(lines) {
  const sources = new Set();
  const levels = new Set();
  const steps = new Set();
  const executions = new Set();
  const artifactKinds = new Set();
  for (const rec of lines || []) {
    if (!rec) continue;
    const src = rec.source || '';
    if (src) {
      const sep = src.indexOf(SUB_SEP);
      sources.add(sep === -1 ? src : src.slice(0, sep));
    }
    levels.add(rec.level || 'info');
    if (rec.stepIndex != null) steps.add(rec.stepIndex);
    if (rec.executionId != null) executions.add(String(rec.executionId));
    if (rec.artifactKind != null) artifactKinds.add(String(rec.artifactKind));
  }
  return {
    sources: [...sources].sort(),
    levels: [...levels].sort(),
    steps: [...steps].sort((a, b) => a - b),
    executions: [...executions],
    artifactKinds: [...artifactKinds].sort(),
  };
}
