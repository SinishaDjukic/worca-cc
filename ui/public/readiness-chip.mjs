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

/** A workspace's readiness from its members' summaries (null for a member with none): the lowest member level (as the
 *  ai-readiness plugin does), how many members are ready, and how many there are. 'unknown' when any member has no summary (known = how many have one). */
export function workspaceReadinessAggregate(summaries) {
  const order = ['not-ready', 'partial', 'ready'];
  const list = Array.isArray(summaries) ? summaries : [];
  const known = list.filter((s) => s && order.includes(s.level));
  // The lowest-member rule holds only when every member has a summary; with any unknown the level stays 'unknown'.
  return {
    level: known.length && known.length === list.length ? order[Math.min(...known.map((s) => order.indexOf(s.level)))] : 'unknown',
    ready: known.filter((s) => s.level === 'ready').length,
    total: list.length,
    known: known.length,
  };
}

/** A level label: words on a tinted pill. */
export function renderLevelLabel(level, { doc = globalThis.document } = {}) {
  return Object.assign(doc.createElement('span'), { className: `rd-lbl rd-${level}`, textContent: LEVEL_WORDS[level] || '' });
}

// A readiness run that is over (as the server's isLiveReadinessStatus): anything else (starting, running, paused) is live.
const RUN_OVER = ['done', 'error', 'failed', 'stopped', 'interrupted', 'completed'];
const RUN_WORDS = { done: 'ready to ship', completed: 'ready to ship', error: 'failed', failed: 'failed', stopped: 'stopped', interrupted: 'stopped' };
const isLive = (r) => !!r && !RUN_OVER.includes(String(r.status || ''));
/** The ai-readiness plugin's two workflow ids (as the server's READINESS_*_WORKFLOW_ID). */
export const READINESS_CHECK_WORKFLOW_ID = 'wfp_ai-readiness_check';
export const READINESS_SETUP_WORKFLOW_ID = 'wfp_ai-readiness_setup';
const isCheck = (r) => !!r && r.workflowId === READINESS_CHECK_WORKFLOW_ID;

/** One run's line: its words, link and full text. A live run opens its run page (#running/<runId>, the live run this
 *  server drives); a finished one, or one live elsewhere, its History page (#history/<projectKey>/<pipelineId>; a
 *  workspace run's lives under workspaces/<id>). The check line reads "Evaluated: <score>/100" when a score exists;
 *  a live workspace run names its workspace. */
function runLine(r, kind, projectKey, workspaceName) {
  const status = String(r.status || '');
  const live = isLive(r);
  const histKey = r.workspaceId ? `workspaces/${r.workspaceId}` : projectKey;
  const href = live && r.runId ? `#running/${r.runId}`
    : r.pipelineId && histKey ? `#history/${histKey}/${r.pipelineId}`
      : r.runId ? `#running/${r.runId}` : null;
  const words = live ? 'running' : RUN_WORDS[status] || status;
  const label = kind === 'check' ? 'Evaluation' : 'Setup run';
  let text;
  if (live && r.workspaceId) text = `${label} (workspace ${(workspaceName && workspaceName(r.workspaceId)) || r.workspaceId}): ${words}`;
  else if (kind === 'check' && !live && typeof r.score === 'number') text = `Evaluated: ${r.score}/100`;
  else text = `${label}: ${words}`;
  return { ...r, words, href, text };
}

/** Everything the popover paints, from a final report: the used tools (run engine first), the tools not judged,
 *  repository failures by severity, what passed and what is ignored. Pure. */
export function readinessMenuModel(report, { engineLabel, run = null, projectKey = '', workspaceName = null }) {
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
  // "Evaluate in depth": offered for every project with code once the plugin is there, ready ones included. "Set up with
  // AI": also needs a judged tool to fail, or one of the two checks the setup run fixes (heavy dirs ignored, test
  // command); never for the out-of-scope rows alone (git.repo, deps.lockfile, secrets.tracked-names). Both hide while
  // a readiness run is live, and the live run's line shows instead of the two last-run lines it would repeat.
  const fixable = checks.some((c) => c.status === 'fail'
    && ((c.scope === 'tool' && usedNames.includes(c.engine)) || c.id === 'ignore.heavy-dirs' || c.id === 'commands.test'));
  const ri = run || {};
  const avail = ri.available || {};
  const withCode = !!ri.hasCode;
  const live = isLive(ri.live) ? ri.live : null;
  const same = (a, b) => !!a && !!b && ((a.runId && a.runId === b.runId) || (a.pipelineId && a.pipelineId === b.pipelineId));
  const last = (r, kind) => (r && !same(r, live) ? runLine(r, kind, projectKey, workspaceName) : null);
  return {
    level: report.level,
    run: {
      evaluate: { show: !!avail.check && withCode && !live },
      setup: { show: !!avail.setup && withCode && fixable && !live },
      lastCheck: last(ri.lastCheck, 'check'),
      lastSetup: last(ri.lastSetup, 'setup'),
      live: live ? runLine(live, isCheck(live) ? 'check' : 'setup', projectKey, workspaceName) : null,
    },
    countLine: `${report.counts.passed} of ${report.counts.applicable} checks pass`,
    tools,
    notJudged: engines.filter(([, e]) => !e.used && e.level !== 'locked').map(([n]) => engineLabel(n)),
    failing, passed, ignored,
  };
}

// The one-time "missing agent instructions" toast for a freshly added project (a `readiness-added` frame).
// `storage` keeps the once-per-project guard; returns notify() options, or null when there is nothing to
// say or it was said already. A storage that throws only costs the guard.
export function readinessAddedToast(msg, { storage = globalThis.localStorage, run, setup = null, check = null } = {}) {
  const key = msg && msg.projectKey;
  if (!key) return null;
  const seenKey = `readiness-toast-seen:${key}`;
  try {
    if (storage && storage.getItem(seenKey)) return null;
    if (storage) storage.setItem(seenKey, '1');
  } catch { /* no guard without storage */ }
  const can = (x) => x && x.available && typeof x.run === 'function';
  const offer = can(setup) ? { label: 'Set up with AI', run: setup.run } : can(check) ? { label: 'Evaluate in depth', run: check.run } : null;
  return {
    tone: 'warn',
    title: `${msg.name || key} is missing agent instructions for ${msg.engine}`,
    action: { label: 'See what to add', run },
    // Offered, never started on its own: Set up with AI when the plugin's setup workflow is there, else Evaluate in depth.
    ...(offer ? { extraAction: offer } : {}),
    key: `readiness-${key}`,
  };
}
