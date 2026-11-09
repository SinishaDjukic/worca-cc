// Agent readiness in the UI: the project-row chip (words plus an open-problem count), the level labels of the
// popover and the settings card, and readinessMenuModel, the pure view model the popover paints. Every string
// from a report is set with textContent.

/** Chip words per project level. 'unknown' has no chip. */
export const CHIP_WORDS = Object.freeze({ ready: 'Agent-ready', partial: 'Partly ready', 'not-ready': 'Not agent-ready' });
/** Label words per tool level (popover rows, settings card). */
export const LEVEL_WORDS = Object.freeze({ ready: 'Ready', partial: 'Partly ready', 'not-ready': 'Not ready', unused: 'Not used' });

/** "1 must fix, 1 should fix. 5 of 9 checks pass." Zero counts are left out. */
export function chipTooltip(s) {
  const parts = [s.mustFix && `${s.mustFix} must fix`, s.shouldFix && `${s.shouldFix} should fix`].filter(Boolean);
  return `${parts.length ? `${parts.join(', ')}. ` : ''}${s.passed} of ${s.applicable} checks pass.`;
}

/** The row chip: words, then a count disc of open problems (must fix + should fix) unless ready. null for no summary or unknown. */
export function renderReadinessChip(summary, { doc = globalThis.document } = {}) {
  if (!summary || !CHIP_WORDS[summary.level]) return null;
  const span = doc.createElement('span');
  span.className = `pl-rd rd-${summary.level}`;
  span.append(doc.createTextNode(CHIP_WORDS[summary.level]));
  const n = summary.level === 'ready' ? 0 : summary.failingCount;
  if (n > 0) span.append(Object.assign(doc.createElement('span'), { className: 'rd-n', textContent: String(n) }));
  const tip = chipTooltip(summary);
  span.title = tip;
  span.setAttribute('aria-label', `${CHIP_WORDS[summary.level]}${n ? `, ${n} open problem${n > 1 ? 's' : ''}` : ''}. ${tip}`);
  return span;
}

/** A level label: words on a tinted pill. */
export function renderLevelLabel(level, { doc = globalThis.document } = {}) {
  return Object.assign(doc.createElement('span'), { className: `rd-lbl rd-${level}`, textContent: LEVEL_WORDS[level] || '' });
}

/** Everything the popover paints, from a final report: the used tools (run engine first), the tools not judged,
 *  repository failures by severity, what passed and what is ignored. Pure. */
export function readinessMenuModel(report, { engineLabel }) {
  const engines = Object.entries(report.engines || {});
  const usedNames = engines.filter(([, e]) => e.used).map(([n]) => n);
  const runs = (e) => (e.reasons || []).some((r) => r.kind === 'run-engine');
  const ordered = [...usedNames].sort((a, b) => Number(runs(report.engines[b])) - Number(runs(report.engines[a])));
  const checks = report.checks || [];
  const tools = ordered.map((n) => {
    const e = report.engines[n];
    const fail = checks.find((c) => c.scope === 'tool' && c.engine === n && c.status === 'fail');
    return { name: n, label: engineLabel(n), reason: e.reasons?.[0]?.text || '', level: e.level,
      detail: fail ? fail.detail || null : null, fix: fail ? fail.fix : null, runs: runs(e) };
  });
  const repo = checks.filter((c) => c.scope === 'repository');
  const failing = { blocker: [], warn: [], info: [] };
  for (const c of repo) if (c.status === 'fail') failing[c.severity].push(c);
  const passed = [
    ...repo.filter((c) => c.status === 'pass').map((c) => ({ title: c.title, detail: c.detail || '' })),
    ...checks.filter((c) => c.scope === 'tool' && usedNames.includes(c.engine) && c.status === 'pass')
      .map((c) => ({ title: `${c.title} (${engineLabel(c.engine)})`, detail: c.detail || '' })),
  ];
  const seen = new Set();
  const ignored = checks.filter((c) => c.status === 'ignored' && !seen.has(c.id) && seen.add(c.id)).map((c) => ({ id: c.id, title: c.title }));
  return {
    level: report.level,
    countLine: `${report.counts.passed} of ${report.counts.applicable} checks pass`,
    tools,
    notJudged: engines.filter(([, e]) => !e.used && e.level !== 'locked').map(([n]) => engineLabel(n)),
    failing, passed, ignored,
  };
}

// The one-time "missing agent instructions" toast for a freshly added project (a `readiness-added` frame).
// `storage` keeps the once-per-project guard; returns notify() options, or null when there is nothing to
// say or it was said already. A storage that throws only costs the guard.
export function readinessAddedToast(msg, { storage = globalThis.localStorage, run } = {}) {
  const key = msg && msg.projectKey;
  if (!key) return null;
  const seenKey = `readiness-toast-seen:${key}`;
  try {
    if (storage && storage.getItem(seenKey)) return null;
    if (storage) storage.setItem(seenKey, '1');
  } catch { /* no guard without storage */ }
  return {
    tone: 'warn',
    title: `${msg.name || key} is missing agent instructions for ${msg.engine}`,
    action: { label: 'See what to add', run },
    key: `readiness-${key}`,
  };
}
