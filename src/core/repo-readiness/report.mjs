// src/core/repo-readiness/report.mjs
// The final readiness report (spec 4.7, 4.9): a cached base report plus usage, combined on every
// read so a settings change or a new run needs no re-evaluation. Pure.
const RANK = { ready: 0, partial: 1, 'not-ready': 2 };

function worst(levels) {
  if (levels.includes('unknown')) return 'unknown';
  return levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'ready');
}

export function buildReport(base, usage) {
  const engines = {};
  for (const [name, e] of Object.entries(base.engines || {})) {
    const u = usage[name] || { used: false, setting: 'detect', detected: false, reasons: [] };
    const used = u.used && !e.locked;
    engines[name] = {
      ...u, used,
      detectedReason: u.signals?.[0]?.text ?? null,
      level: e.locked ? 'locked' : used ? e.level : 'unused',
      failing: used ? e.failing : [],
      ...(e.locked ? { locked: e.locked } : {}),
    };
  }
  const usedNames = Object.keys(engines).filter((n) => engines[n].used);
  const judged = (c) => c.scope === 'repository' || usedNames.includes(c.engine);
  const rows = (base.checks || []).filter(judged);
  const applicable = rows.filter((c) => c.status === 'pass' || c.status === 'fail');
  const failing = applicable.filter((c) => c.status === 'fail');
  return {
    catalogVersion: base.catalogVersion,
    level: worst([base.repository?.level ?? 'unknown', ...usedNames.map((n) => engines[n].level)]),
    repository: base.repository,
    engines,
    checks: base.checks || [],
    counts: {
      mustFix: failing.filter((c) => c.severity === 'blocker').length,
      shouldFix: failing.filter((c) => c.severity === 'warn').length,
      passed: applicable.length - failing.length,
      applicable: applicable.length,
    },
  };
}

export function summaryOf(report) {
  const { mustFix, shouldFix, passed, applicable } = report.counts;
  return { level: report.level, failingCount: mustFix + shouldFix, mustFix, shouldFix, passed, applicable };
}
