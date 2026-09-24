// src/shared/team-metrics/timeline.mjs
// Delivery timeline (Team metrics → Timeline). PURE: no I/O, no node: imports — the browser
// builds work items from the same records the Overview aggregates, joined with the PR states
// the server resolves (src/core/metrics/prs.mjs). A work item is every run on one ticket, or
// on one branch when the runs carry no ticket; "shipped" means its pull request merged.

const DAY = 86_400_000;
/** An open pull request older than this needs attention (someone has to review it). */
export const REVIEW_WAIT_DAYS = 2;
export const ITEM_STATUSES = Object.freeze(['shipped', 'review', 'attention', 'stopped', 'closed', 'done']);
const PR_RANK = { OPEN: 0, CLOSED: 1, MERGED: 2 };

const ms = (iso) => { const v = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(v) ? v : null; };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Where a record's pull requests live: its project, or the workspace members it touched. */
export function recordRepos(r) {
  const t = r?.target;
  if (t?.kind === 'workspace') {
    const list = Array.isArray(t.touched) && t.touched.length ? t.touched : Array.isArray(t.projects) ? t.projects : [];
    return list.filter((x) => typeof x === 'string' && x);
  }
  return typeof t?.project === 'string' && t.project ? [t.project] : [];
}

/** The project a work item is filed under: the project, or the workspace's name. */
export function recordProjectLabel(r) {
  const t = r?.target;
  if (t?.kind === 'workspace') return t.workspace || 'Workspace';
  return t?.project || 'Unknown project';
}

/**
 * Runs on the same ticket form one work item; without a ticket, runs on the same branch do
 * (a resume or a follow-up on the branch); otherwise the run stands alone.
 */
export function workItemKey(r) {
  const src = r?.source;
  if (src && (src.url || src.ref)) return src.url ? `src:${src.url}` : `src:${recordProjectLabel(r)}:${src.type || ''}:${src.ref}`;
  const branch = r?.git?.branch;
  if (typeof branch === 'string' && branch) return `br:${recordRepos(r).join(',').toLowerCase()}:${branch}`;
  return `run:${r?.id}`;
}

/** The lookups the server needs to resolve a record's pull requests. */
export function prLookupFor(r) {
  const pr = r?.pr && (r.pr.url || Number.isInteger(r.pr.number)) ? { url: typeof r.pr.url === 'string' ? r.pr.url : null, number: Number.isInteger(r.pr.number) ? r.pr.number : null } : null;
  return { id: r.id, repos: recordRepos(r), branch: typeof r?.git?.branch === 'string' && r.git.branch ? r.git.branch : null, pr, endedAt: typeof r?.endedAt === 'string' ? r.endedAt : null };
}

function normPr(p) {
  if (!p || typeof p !== 'object') return null;
  const state = typeof p.state === 'string' ? p.state.toUpperCase() : null;
  if (!(state in PR_RANK)) return null;
  return {
    repo: typeof p.repo === 'string' ? p.repo : null,
    number: Number.isInteger(p.number) ? p.number : null,
    url: typeof p.url === 'string' ? p.url : null,
    title: typeof p.title === 'string' ? p.title : null,
    state,
    createdAt: ms(p.createdAt),
    mergedAt: ms(p.mergedAt),
    closedAt: ms(p.closedAt),
    via: typeof p.via === 'string' ? p.via : null,
    author: typeof p.author === 'string' && p.author ? p.author : null,
  };
}

const RUN_RESULTS = new Set(['done', 'failed', 'stopped']);

/**
 * @param {object[]} records  RunRecord v1 rows (already scoped).
 * @param {object} [opts]
 * @param {Object<string, object[]|null>} [opts.prs]  run id → its pull requests; `[]` = looked up,
 *   none; null/absent = unknown (not looked up, or no way to look it up).
 * @param {object[]} [opts.outside]  PR events of the scope (GET /api/team-metrics/pr-events); the
 *   ones no run points at become work items of their own (`kind: 'pr'`, no runs).
 * @param {number} [opts.now]
 */
export function buildWorkItems(records, { prs = {}, outside = [], now = Date.now() } = {}) {
  const groups = new Map();
  for (const r of records || []) {
    const s = ms(r?.startedAt);
    if (s == null) continue;
    const key = workItemKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const items = [];
  for (const [key, rs] of groups) {
    rs.sort((a, b) => ms(a.startedAt) - ms(b.startedAt));
    const runs = rs.map((r) => {
      const s = ms(r.startedAt);
      const e = Math.max(s, ms(r.endedAt) ?? (isNum(r.wallMs) ? s + r.wallMs : s));
      return {
        id: r.id, s, e,
        result: RUN_RESULTS.has(r.result) ? r.result : 'done',
        costUsd: isNum(r?.cost?.usd) ? r.cost.usd : 0,
        activeMs: isNum(r.activeMs) ? r.activeMs : e - s,
        actor: r.actor || null,
        reviewCycles: isNum(r?.cycles?.review) ? r.cycles.review : 0,
      };
    });
    const last = rs[rs.length - 1];
    const lastRun = runs[runs.length - 1];
    // Pull requests: one per repo#number across the runs, keeping the most final state seen.
    let prKnown = false;
    const byKey = new Map();
    for (const r of rs) {
      const list = prs?.[r.id];
      if (!Array.isArray(list)) continue;
      prKnown = true;
      for (const raw of list) {
        const p = normPr(raw);
        if (!p) continue;
        const k = `${(p.repo || '').toLowerCase()}#${p.number ?? p.url}`;
        const old = byKey.get(k);
        if (!old || PR_RANK[p.state] > PR_RANK[old.state] || (PR_RANK[p.state] === PR_RANK[old.state] && (p.mergedAt ?? p.closedAt ?? 0) > (old.mergedAt ?? old.closedAt ?? 0))) byKey.set(k, p);
      }
    }
    const pulls = [...byKey.values()].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const actorsCount = new Map();
    for (const run of runs) if (run.actor) actorsCount.set(run.actor, (actorsCount.get(run.actor) || 0) + 1);
    const actors = [...actorsCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([a]) => a);
    const src = [...rs].reverse().find((r) => r.source)?.source || null;
    const item = {
      key,
      title: src?.title || last.title || src?.ref || 'Untitled run',
      project: recordProjectLabel(last),
      ticket: src ? { type: src.type || null, ref: src.ref || null, url: src.url || null, title: src.title || null } : null,
      branch: last?.git?.branch || null,
      actor: actors[0] || null,
      actors,
      runs,
      first: runs[0].s,
      lastEnd: Math.max(...runs.map((x) => x.e)),
      costUsd: Math.round(runs.reduce((a, x) => a + x.costUsd, 0) * 100) / 100,
      activeMs: runs.reduce((a, x) => a + x.activeMs, 0),
      reviewCycles: Math.max(0, ...runs.map((x) => x.reviewCycles)),
      failed: runs.filter((x) => x.result === 'failed').length,
      prs: pulls,
      prKnown,
      prOpenAt: null, mergedAt: null, closedAt: null,
      status: 'done', reason: null, end: null,
    };
    if (!applyPrStatus(item, pulls, now)) {
      item.end = item.lastEnd;
      if (lastRun.result === 'failed') {
        item.status = 'attention';
        if (item.failed > 1 && item.failed === runs.length) item.reason = `All ${item.failed} attempts failed.`;
        else if (item.failed > 1) item.reason = `The last attempt failed (${item.failed} failed in total).`;
        else item.reason = 'The last attempt failed.';
      } else if (lastRun.result === 'stopped') item.status = 'stopped';
      else item.status = 'done';
    }
    items.push(item);
  }
  // Pull requests no recorded run points at (by number, or by the run's branch): work done
  // outside Worca, shown so the Timeline covers the whole team's delivery.
  const lower = (s) => String(s || '').toLowerCase();
  const runBranches = new Set();
  for (const r of records || []) {
    const b = r?.git?.branch;
    if (typeof b === 'string' && b) for (const repo of recordRepos(r)) runBranches.add(`${lower(repo)}#${b}`);
  }
  const attached = new Set(items.flatMap((it) => it.prs.map((p) => `${lower(p.repo)}#${p.number}`)));
  for (const ev of outside || []) {
    const p = normPr({ ...ev, via: ev?.via || 'action' });
    if (!p || p.number == null || p.createdAt == null) continue;
    const k = `${lower(p.repo)}#${p.number}`;
    if (attached.has(k) || runBranches.has(`${lower(p.repo)}#${ev.head}`)) continue;
    attached.add(k);
    const item = {
      key: `pr:${k}`,
      kind: 'pr',
      title: p.title || `Pull request #${p.number}`,
      project: lower(p.repo),
      ticket: null,
      branch: typeof ev.head === 'string' ? ev.head : null,
      actor: p.author,
      actors: p.author ? [p.author] : [],
      runs: [],
      first: p.createdAt,
      lastEnd: p.createdAt,
      costUsd: 0, activeMs: 0, reviewCycles: 0, failed: 0,
      prs: [p],
      prKnown: true,
      prOpenAt: null, mergedAt: null, closedAt: null,
      status: 'done', reason: null, end: null,
    };
    applyPrStatus(item, [p], now);
    items.push(item);
  }
  return items.sort((a, b) => a.first - b.first);
}

/** Status from the item's pull requests; false when it has none (the runs decide then). */
function applyPrStatus(item, pulls, now) {
  const open = pulls.filter((p) => p.state === 'OPEN');
  const merged = pulls.filter((p) => p.state === 'MERGED');
  const closed = pulls.filter((p) => p.state === 'CLOSED');
  const opens = pulls.map((p) => p.createdAt).filter(isNum);
  item.prOpenAt = opens.length ? Math.min(...opens) : null;
  if (open.length) {
    item.end = Math.max(now, item.lastEnd);
    const since = Math.min(...open.map((p) => p.createdAt ?? item.lastEnd));
    const waitedDays = (now - since) / DAY;
    if (waitedDays > REVIEW_WAIT_DAYS) {
      const d = Math.floor(waitedDays);
      item.status = 'attention';
      item.reason = `Pull request waiting for review for ${d} day${d === 1 ? '' : 's'}.`;
    } else item.status = 'review';
    return true;
  }
  if (merged.length) {
    const at = merged.map((p) => p.mergedAt).filter(isNum);
    item.mergedAt = at.length ? Math.max(...at) : null;
    item.status = 'shipped';
    item.end = Math.max(item.mergedAt ?? item.lastEnd, item.lastEnd);
    return true;
  }
  if (closed.length) {
    const at = closed.map((p) => p.closedAt).filter(isNum);
    item.closedAt = at.length ? Math.max(...at) : null;
    item.status = 'closed';
    item.end = Math.max(item.closedAt ?? item.lastEnd, item.lastEnd);
    return true;
  }
  return false;
}

function median(values) {
  const xs = values.filter(isNum).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

/**
 * The summary strip for one calendar window [startMs, endMs).
 * - shipped: merged inside the window; completed: finished `done` inside the window (the
 *   fallback when no merge data is available at all);
 * - inReview: a pull request open at the window's end (or now, for the current window);
 * - attention: visible items that need someone now.
 */
export function summarizeWindow(items, { startMs, endMs, now = Date.now() }) {
  const inWin = (t) => isNum(t) && t >= startMs && t < endMs;
  const visible = items.filter((it) => it.first < endMs && it.end >= startMs);
  const shipped = items.filter((it) => it.status === 'shipped' && inWin(it.mergedAt ?? it.lastEnd));
  const cut = Math.min(endMs, now);
  // A PR is "in review" from its creation until it merges or closes; one that merged or closed on
  // an unknown date is never counted (it would otherwise stay in review forever).
  const openUntil = (it) => (it.prs.some((p) => p.state === 'OPEN') ? Infinity : it.mergedAt ?? it.closedAt);
  const inReview = cut < startMs ? [] : items.filter((it) => it.prOpenAt != null && it.prOpenAt <= cut && openUntil(it) != null && openUntil(it) > cut);
  const attention = visible.filter((it) => it.status === 'attention');
  const completed = items.filter((it) => it.runs.length && it.runs[it.runs.length - 1].result === 'done' && inWin(it.lastEnd));
  const leads = shipped.filter((it) => it.mergedAt != null).map((it) => it.mergedAt - it.first);
  const spendUsd = Math.round(items.reduce((a, it) => a + it.runs.filter((r) => inWin(r.s)).reduce((b, r) => b + r.costUsd, 0), 0) * 100) / 100;
  return {
    visible, shipped, inReview, attention, completed,
    medianLeadMs: median(leads),
    spendUsd,
    prKnown: items.some((it) => it.prKnown),
  };
}
