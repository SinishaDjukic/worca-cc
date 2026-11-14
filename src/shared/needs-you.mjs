// src/shared/needs-you.mjs — dev's Needs-you rule (moved verbatim from ui/public/runs-list.mjs, which re-exports it). Pure: no
// DOM, no fetch. The Runs badge, Activity and Stillhet's bell (ui/public/stillhet/live/live-map.mjs) count with it, so they
// never differ.
import { finishedNeedsYou } from './run-model.mjs';

export const FAILED = new Set(['error', 'failed']);

/** A workspace run's member PRs (#784): a run's `memberPrs`, else a History row's members[].pr (the history-pr
 *  batch fills them through app.js applyWsMemberPrs). Objects only; [] for any other run. */
export function memberPrsOf(x) {
  if (x && Array.isArray(x.memberPrs)) return x.memberPrs;
  const ms = x && Array.isArray(x.members) ? x.members : [];
  return ms.map((m) => m && m.pr).filter((p) => p && typeof p === 'object');
}

/** A run (History row, a row's raw run, a member's run) that a finished run's PR or Watch PR raises to Needs you
 *  (run-model.mjs finishedNeedsYou, D31 / D23); a workspace run's member PRs count too (#784). A glance string
 *  ('MERGED') carries no verdict. */
export const prNeedsOf = (x) => !!(x && typeof x === 'object')
  && finishedNeedsYou({ pr: x.pr && typeof x.pr === 'object' ? x.pr : null, watch: x.watch || null, memberPrs: memberPrsOf(x),
    prDeduped: !!x.prDeduped,
    // D8: a round never needs you through its PR (a raw History row names its marker `roundOf`, a model run `round`).
    round: x.round || x.roundOf || (x.branch && typeof x.branch === 'object' ? x.branch.roundOf : null) || null });

/** A round's marker (D1) on an item, a row or a raw History row: { pipelineId, round ≥ 2, … }, else null. */
export function roundMarkerOf(x) {
  const m = x && x.roundOf;
  return m && typeof m === 'object' && m.pipelineId && Number.isInteger(m.round) && m.round >= 2 ? m : null;
}
// D5: a round in one of these statuses is live; its run stands for the stack.
export const LIVE_ROUND = new Set(['created', 'starting', 'running', 'paused', 'pausing']);
export const FIXING_ROUND = new Set(['created', 'starting', 'running']);

export const normPrUrl = (u) => String(u || '').trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
/** A run's PR urls, normalized: its own PR's, else each workspace member PR's (D8). */
export function prUrlsOf(x) {
  if (!x || typeof x !== 'object') return [];
  const own = x.pr && typeof x.pr === 'object' && x.pr.url ? [x.pr.url] : [];
  return [...new Set((own.length ? own : memberPrsOf(x).map((p) => p && p.url)).filter(Boolean).map(normPrUrl))];
}
// An epoch for "newest" with no clock: epoch ms, or an ISO stamp.
export const stampMs = (v) => (typeof v === 'number' ? (Number.isFinite(v) && v > 0 ? v : NaN) : Date.parse(String(v || '')));

/** D8: one open PR raises one Needs-you item. Among `rows` that need you ONLY through their PR (`prOnly`), the newest
 *  (`at`) per normalized PR url (`urls`) counts; a row stays while any of its urls is still unclaimed. → { kept,
 *  dropped: Set }, `kept` in the input order. */
export function dedupeByPr(rows, { prOnly = () => true, urls = prUrlsOf, at = () => 0 } = {}) {
  const ms = (r) => { const t = at(r); return Number.isFinite(t) ? t : 0; };
  const cands = rows.filter((r) => prOnly(r) && urls(r).length).sort((a, b) => ms(b) - ms(a));
  const claimed = new Set();
  const dropped = new Set();
  for (const r of cands) {
    const us = urls(r);
    if (us.every((u) => claimed.has(u))) dropped.add(r);
    else for (const u of us) claimed.add(u);
  }
  return { kept: rows.filter((r) => !dropped.has(r)), dropped };
}

/** Needs you: a question or gate, a pause (cost caps included), a failed run nobody opened yet, and a finished run
 *  whose PR has failing checks or conflicts with no fix run on it (`prNeeds`, D31). */
export function needsYou({ kind = 'live', status = '', ask = false, unread = false, prNeeds = false } = {}) {
  if (kind === 'sched') return false;
  const s = String(status || '').toLowerCase();
  if (s === 'paused') return true;
  if (prNeeds && s === 'done') return true;
  if (kind !== 'live') return false;
  if (ask && s !== 'pausing' && s !== 'interrupted') return true;
  return !!unread && FAILED.has(s);
}

/** The items Needs you holds: live items that need you, and History rows that do whose run is not
 *  listed live. countNeedsYou counts exactly these; the top bar's Activity lists them. */
export function needsYouItems({ live = [], history = [] } = {}) {
  const pids = new Set(live.map((r) => r && r.pipelineId).filter(Boolean));
  // D5: while a round of a run is working, that run is Working, never Needs you through its PR. A paused round is not
  // fixing anything: it counts for its pause, and its run for its PR (plan Task 3: 1 + 1).
  const fixing = new Set([...live, ...history].map((x) => {
    const m = roundMarkerOf(x);
    return m && FIXING_ROUND.has(String(x.status || '').toLowerCase()) ? String(m.pipelineId) : '';
  }).filter(Boolean));
  const hist = history.filter((p) => p && !pids.has(p.id)
    && needsYou({ kind: 'hist', status: p.status, prNeeds: prNeedsOf(p) && !fixing.has(String(p.id)) }));
  return {
    live: live.filter((r) => r && needsYou({ kind: 'live', status: r.status, ask: !!r.ask, unread: !!r.unread })),
    // D8: a History row needs you through its PR only when done (a paused one for its pause); one item per open PR.
    history: dedupeByPr(hist, { prOnly: (p) => String(p.status || '').toLowerCase() === 'done',
      at: (p) => (Number.isFinite(stampMs(p.mtime)) ? stampMs(p.mtime) : stampMs(p.startedAt)) }).kept,
  };
}

/** The Runs badge: the Needs you count without building the list (runs on every WS frame). */
export function countNeedsYou(src = {}) {
  const { live, history } = needsYouItems(src);
  return live.length + history.length;
}
