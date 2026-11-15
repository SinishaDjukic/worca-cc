// A person's work on By person (#1310): dev's Timeline work items (buildWorkItems, prLookupFor in
// src/shared/team-metrics/timeline.mjs), the items they have a run in, mapped to the design's words, counts, head, card
// and read-only view. Pure and deterministic given `now`; it reads nothing. Times are epoch ms; days and clock times are UTC, as teamQuery's.
import { buildWorkItems, prLookupFor } from '../../../../src/shared/team-metrics/timeline.mjs';
import { safeHttpUrl } from '../../../../src/shared/team-metrics/aggregate.mjs';

const DAY = 86_400_000, LOOKBACK_MS = 60 * DAY;   // dev's TL_PR_LOOKBACK (ui/public/app.js): a PR may open long after its run
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The design's state words (D11), from dev's ITEM_STATUSES: `attention` splits by whether a pull request is open. */
export const WORDS = Object.freeze({ merged: 'Merged', review: 'Open for review', waiting: 'Waiting for review', closed: 'Closed', failed: 'Failed', stopped: 'Stopped', done: 'Done' });
const TONE = { merged: 'merged', review: 'wait', waiting: 'wait', closed: 'closed', failed: 'fail', stopped: 'stop', done: 'done' };   // KindMark
const DOT = { merged: 'is-green', review: 'is-green', waiting: 'is-grey', closed: 'is-grey', failed: 'is-red', stopped: 'is-grey', done: 'is-green' };   // StatusLine
const COUNT_OF = { merged: 'merged', review: 'review', waiting: 'review', closed: 'closed', failed: 'failed', stopped: 'stopped', done: 'done' };
const COUNTS = [['merged', 'merged'], ['review', 'open for review'], ['closed', 'closed'], ['failed', 'failed'], ['stopped', 'stopped'], ['done', 'done']];
const RESULT = { done: 'Finished', failed: 'Failed', stopped: 'Stopped' };
const zeros = () => ({ merged: 0, review: 0, closed: 0, failed: 0, stopped: 0, done: 0 });

const two = (n) => String(n).padStart(2, '0');
const dayWord = (t) => { const d = new Date(t); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const timeWord = (t) => { const d = new Date(t); return `${dayWord(t)}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; };
export const durWord = (ms) => { const m = Math.max(0, Math.round(ms / 60_000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60; return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`; };
const usd = (n) => `$${(n || 0).toFixed(2)}`;
const ms = (iso) => { const v = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(v) ? v : null; };

/** The PR lookups dev's Timeline sends for a window: every record started at or after `start` minus 60 days. */
export function lookupsFor(records, { start }) {
  const from = start - LOOKBACK_MS;
  return (records || []).filter((r) => { const s = ms(r?.startedAt); return s != null && s >= from; }).map(prLookupFor);
}

function stateOf(it) {
  if (it.status === 'shipped') return 'merged';
  if (it.status === 'review') return 'review';
  if (it.status === 'attention') return it.prs.some((p) => p.state === 'OPEN') ? 'waiting' : 'failed';
  return it.status;   // closed, stopped, done
}
const PR_OF = { merged: 'MERGED', review: 'OPEN', waiting: 'OPEN', closed: 'CLOSED' };
const MARK_OF = { MERGED: 'merged', OPEN: 'open', CLOSED: 'closed' };

function itemOf(it, byId, now) {
  const state = stateOf(it), want = PR_OF[state];
  const p = want ? [...it.prs].reverse().find((x) => x.state === want) || it.prs[it.prs.length - 1] : null;
  const runs = it.runs.map((r) => ({ id: r.id, s: r.s, e: r.e, result: r.result, costUsd: r.costUsd, activeMs: r.activeMs }));
  const recs = it.runs.map((r) => byId.get(r.id)).filter(Boolean);
  const sumOf = (k) => recs.reduce((a, r) => (typeof r?.git?.[k] === 'number' ? (a ?? 0) + r.git[k] : a), null);
  const ins = sumOf('insertions'), del = sumOf('deletions');
  const at = p ? (p.state === 'MERGED' ? it.mergedAt ?? p.mergedAt : p.state === 'CLOSED' ? it.closedAt ?? p.closedAt : now) : null;
  const work = runs.length ? [it.first, it.lastEnd] : [it.first, it.first];
  return {
    key: it.key, runId: runs.length ? runs[runs.length - 1].id : null, title: it.title, project: it.project,
    prNumber: p?.number ?? null, prUrl: safeHttpUrl(p?.url) || '', state, word: WORDS[state], tone: TONE[state], reason: it.reason || '',
    work, wait: p && it.prOpenAt != null && at != null ? [it.prOpenAt, at] : null, end: p && at != null ? { status: MARK_OF[p.state], at } : null,
    own: false, runs, costUsd: it.costUsd, activeMs: it.activeMs, reviewCycles: it.reviewCycles, actor: it.actor, branch: it.branch,
    ticket: it.ticket?.ref || '', workflow: recs[recs.length - 1]?.workflow?.name || '', diff: ins == null && del == null ? '' : `+${ins || 0} −${del || 0}`,
    last: it.end ?? it.lastEnd,
  };
}

/**
 * One person's work in [start, end], newest first by last activity, with its counts (D11) over those items only.
 * @param {object[]} records  the scope's RunRecords
 * @param {{person:string, start:number, end:number, prs?:object, outside?:object[], now:number}} o
 */
export function personWork(records, { person, start, end, prs = {}, outside = [], now }) {
  const all = buildWorkItems(records, { prs, outside, now });
  // The items they have a run in (an outside PR: its author), by the By person row's exact actor. No group: dev's
  // grouping merges people through a shared item's fallback key.
  const counts = zeros(), byId = new Map((records || []).map((r) => [r.id, r]));
  const items = all.filter((it) => (it.actors || []).includes(person) && it.first <= end && (it.end ?? it.lastEnd) >= start).map((it) => itemOf(it, byId, now))
    .sort((a, b) => b.last - a.last || b.work[0] - a.work[0]);
  for (const it of items) counts[COUNT_OF[it.state]] += 1;
  return { items, counts, axis: { start, end } };
}

/** #1310 D2: the work item that holds run `runId`, over every item of the records (whoever it is grouped under); null when none. */
export function workItemOf(records, { runId, prs = {}, outside = [], now }) {
  const it = buildWorkItems(records, { prs, outside, now }).find((x) => x.runs.some((r) => r.id === runId));
  return it ? itemOf(it, new Map((records || []).map((r) => [r.id, r])), now) : null;
}

/** D3: an item is yours when this Worca knows one of its runs. */
export const isOwn = (item, knows) => item.runs.some((r) => !!knows(r.id));

/** The open row's head: "Maya's work, this month" and "newest first · 7 merged, 1 open for review …" with the PR state's suffix. */
export function workHead(name, when, counts, pr = {}) {
  const title = `${name}'s work, ${when}`;
  const parts = COUNTS.filter(([k]) => counts[k]).map(([k, w]) => `${counts[k]} ${w}`);
  if (!parts.length) return { title, line: '' };
  const suffix = pr.state === 'pending' ? ' · looking up pull requests' : pr.state === 'failed' ? ` · pull requests could not be read: ${pr.why}` : pr.state === 'unknown' ? ' · pull request states are not known here' : '';
  return { title, line: `newest first · ${parts.join(', ')}${suffix}` };
}

/** The PR mark's TimelineCard: "#1418 merged Nov 8, 11:00 · 1d 1h from first run · opens the pull request". */
export function cardOf(item) {
  const e = item.end, n = item.prNumber != null ? `#${item.prNumber}` : 'The pull request';
  const what = e.status === 'open' ? `${n} open since ${timeWord(item.wait ? item.wait[0] : e.at)}` : `${n} ${e.status} ${timeWord(e.at)} · ${durWord(e.at - item.work[0])} from first run`;
  return { title: item.title, line: `${what} · opens the pull request` };
}

/** The read-only view's model (TaskView, minus its back link and mark): `tone` is its KindMark's. */
export function taskViewOf(item) {
  return {
    tone: item.tone, title: item.title,
    meta: [item.actor, item.project, item.workflow, item.ticket, item.branch, item.diff].filter(Boolean),
    state: { tone: DOT[item.state], word: item.word, detail: item.reason },
    figures: [{ k: 'Cost', v: usd(item.costUsd) }, { k: 'Time working', v: durWord(item.activeMs) }, { k: 'Runs', v: String(item.runs.length) }, { k: 'Review rounds', v: String(item.reviewCycles) }],
    pr: item.end ? { status: item.end.status, label: `${item.prNumber != null ? `#${item.prNumber}` : 'Pull request'} ${item.end.status === 'open' ? 'open' : `${item.end.status} ${dayWord(item.end.at)}`}`, url: item.prUrl } : null,
    runs: { columns: [{ id: 'started', label: 'Started' }, { id: 'result', label: 'Result' }, { id: 'cost', label: 'Cost', num: true }, { id: 'time', label: 'Time working', num: true }],
      rows: item.runs.map((r) => ({ started: timeWord(r.s), result: RESULT[r.result] || 'Finished', cost: usd(r.costUsd), time: durWord(r.activeMs) })) },
  };
}
