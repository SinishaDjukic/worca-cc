// src/shared/run-model.mjs
// The one run model (runs redesign spec §2.1, §2.1a, §2.2, §3.3a). ONE pure function turns a run, or a group of
// runs, into what every surface draws: state, dot, symbol, pulse, status line, actions, PR state, count, progress.
// The list, the chat card, the run and group pages (ui/), the CLI (src/cli/runs.mjs) and Ask Worca
// (src/core/ask/tools.mjs via src/core/run-status.mjs) all call it, so the words are the same everywhere (§5a.7).
// Input: a run state as runProgress reads it (src/shared/run-progress.mjs header) plus `pauseReason`, `pr`
// ({url, number, state, draft? | isDraft?, mergeable?, reviewDecision?}), `ticket` ({status, runAt, after:{index, group, title}}) for a run that has not
// started, and `resumable`. Shared code: no imports from core/ or ui/.
// Optional: `round` ({n, request, by}) or the raw marker `branch.roundOf` ({round, request, by}), a round of the same
// run (spec §3.6); `watch` ({status, reason, fixRuns}), the run's Watch PR (§3.6a, statuses of src/core/pr-watch.mjs).
// `memberPrs` ([pr]), a workspace run's member PRs (#784): the PR chip rolls them up (memberPrState).
// Projects, any way: `workMode` ('folder' | 'none', else read off `branch.workMode`; anything else is a git run),
// `changes` ({state, counts}, a Folder run's; else `branch.changes`) and `gitChrome` (false: a git run while git is
// missing). A finished run of these ships nothing, so its `word` and line differ from RUN_STATES[state].word (finishedWords).
import { runProgress, groupProgress, askWhat } from './run-progress.mjs';
import { liveRoleRows } from './shape/role-review.mjs';
import { parseAzurePrUrl } from './azure-remote.mjs';

export const RUN_STATES = Object.freeze({
  starting: Object.freeze({ word: 'Starting', dot: 'peach', pulse: true, symbol: null }),
  working: Object.freeze({ word: 'Working', dot: 'peach', pulse: true, symbol: null }),
  'needs-you': Object.freeze({ word: 'Needs you', dot: 'amber', pulse: false, symbol: 'question' }),
  paused: Object.freeze({ word: 'Paused', dot: 'grey', pulse: false, symbol: null }),
  waiting: Object.freeze({ word: 'Waiting', dot: 'grey-ring', pulse: false, symbol: null }),
  failed: Object.freeze({ word: 'Failed', dot: 'red', pulse: false, symbol: 'alert' }),
  stopped: Object.freeze({ word: 'Stopped', dot: 'dark-grey', pulse: false, symbol: null }),
  ready: Object.freeze({ word: 'Ready', dot: 'green', pulse: false, symbol: null }),
  'in-review': Object.freeze({ word: 'In review', dot: 'green', pulse: false, symbol: null }),
  merged: Object.freeze({ word: 'Merged', dot: 'violet', pulse: false, symbol: null }),
});

export const ACTION_LABEL = Object.freeze({
  stop: 'Stop', pause: 'Pause', answer: 'Answer', resume: 'Resume', 'start-now': 'Start now', cancel: 'Cancel',
  retry: 'Retry', report: 'Report', archive: 'Archive', ship: 'Create PR', 'open-pr': 'View PR', 'ask-changes': 'Ask for changes',
});

const ACTIONS = Object.freeze({
  starting: ['stop'], working: ['pause', 'stop'], 'needs-you': ['answer', 'stop'], paused: ['resume', 'stop'],
  waiting: ['start-now', 'cancel'], failed: ['retry', 'report'], stopped: ['archive'], ready: ['ship'],
  'in-review': ['open-pr'], merged: ['archive'],
});

// The pause reasons (src/core/failure-policy.mjs REASON) that ui/public/runs-list.mjs PAUSE_WORDS names, lower-cased.
// Every other reason (error, recoverable, night_guardrail) and a person's own pause read plain "paused", as the list does.
const PAUSE_WORD = Object.freeze({
  usage_limit: 'usage limit', cost_pipeline: 'cost limit', cost_total: 'total budget', cost_pipeline_policy: 'team cap',
  cost_total_policy: 'team total', drain: 'restart',
});

const PR_STATES = Object.freeze({
  draft: { word: 'Draft', tone: 'ink-2' },
  ready: { word: 'Ready', tone: 'green-ink' },
  changes: { word: 'Changes requested', tone: 'amber-ink' },
  conflicts: { word: 'Conflicts', tone: 'red-ink' },
  failing: { word: 'Checks failing', tone: 'red-ink' },
  running: { word: 'Checks running', tone: 'ink-2' },
  fixing: { word: 'Fixing', tone: 'ink-2' },
  merged: { word: 'Merged', tone: 'violet-ink' },
  closed: { word: 'Closed', tone: 'red-ink' },
});
// QA 5: the icon is the PR's git state (draft / open / merged / closed or abandoned), never its problem word.
const gitIcon = (s, pr) => (s === 'MERGED' ? 'merge' : s === 'CLOSED' ? 'pull-request-closed'
  : pr.draft || pr.isDraft ? 'pull-request-draft' : 'pull-request');

const ENDED = new Set(['done', 'stopped', 'error']);
const PARKED = new Set(['paused', 'pausing', 'interrupted']);
const LIVE = new Set(['starting', 'working', 'needs-you', 'paused']);
const FINISHED = new Set(['ready', 'in-review', 'merged']);
const TICKET_STATE = Object.freeze({ scheduled: 'waiting', missed: 'waiting', firing: 'starting', fired: 'starting',
  failed: 'failed', canceled: 'stopped', skipped: 'stopped' });

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const join = (...parts) => cap(parts.filter(Boolean).join(' · '));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The PR state as icon + one word (spec §2.1a). null without a PR. `pr` may carry the refresh's verdict (D31):
 *  `draft`, `reviewDecision`, `mergeable` (MERGEABLE | CONFLICTING | UNKNOWN), `checks` (rollupChecks: {state, total,
 *  failed, pending}) and `fixing` (a Watch PR fix run is live). `needsYou`: Conflicts or Checks failing, no fix run. */
export function prState(pr) {
  if (!pr || (!pr.url && pr.number == null)) return null;
  const s = String(pr.state || '').toUpperCase();
  const checks = pr.checks && typeof pr.checks === 'object' ? pr.checks : null;
  const conflicts = String(pr.mergeable || '').toUpperCase() === 'CONFLICTING';
  const failing = !!checks && checks.state === 'failing';
  const id = s === 'MERGED' ? 'merged' : s === 'CLOSED' ? 'closed'
    : (conflicts || failing) && pr.fixing ? 'fixing'
    : conflicts ? 'conflicts' : failing ? 'failing'
    : String(pr.reviewDecision || '').toUpperCase() === 'CHANGES_REQUESTED' ? 'changes'
    : checks && checks.state === 'pending' ? 'running'
    : pr.fixing ? 'fixing' : pr.draft || pr.isDraft ? 'draft' : 'ready';
  const number = pr.number ?? null;
  const url = pr.url || null;
  const ref = number == null ? 'Pull request' : `PR #${number}`;
  const title = id === 'failing' ? `${checks.failed} of ${checks.total} checks failed · ${ref}`
    : id === 'running' ? `${checks.pending} of ${checks.total} checks running · ${ref}`
    : id === 'conflicts' ? `Conflicts with the base branch · ${ref}`
    : number == null ? 'Pull request' : /github\.com\//.test(url || '') ? `PR #${number} · open on GitHub` : `PR #${number}`;
  // #784: Azure DevOps calls a closed-without-merging PR abandoned; the id, icon and colour stay `closed`.
  const word = id === 'closed' && parseAzurePrUrl(url) ? 'Abandoned' : PR_STATES[id].word;
  return { id, ...PR_STATES[id], icon: gitIcon(s, pr), word, number, url, title, needsYou: id === 'conflicts' || id === 'failing',
    ...(pr.pending ? { pending: true } : {}) };
}

// #784's order for a workspace run's member PRs (what needs a person first), on the chip's ids.
const PR_URGENCY = ['conflicts', 'failing', 'changes', 'running', 'fixing', 'ready', 'draft', 'merged', 'closed'];

/** A workspace run's member PRs as one chip (#784): the most urgent member's state; with two or more PRs the word
 *  and the title carry the count ("Conflicts · 3 PRs"). null when no member names a PR. */
export function memberPrState(prs) {
  const states = (Array.isArray(prs) ? prs : []).map(prState).filter(Boolean);
  if (!states.length) return null;
  const top = PR_URGENCY.map((id) => states.find((s) => s.id === id)).find(Boolean);
  if (states.length === 1) return top;
  return { ...top, count: states.length, word: `${top.word} · ${plural(states.length, 'PR')}`, title: `${states.length} pull requests · ${top.title}` };
}

// QA 3: a run in Needs you through its PR names the chip's reason: "Checks failing · PR #803"; several PRs "Conflicts · 3 PRs".
const prReasonLine = (pr) => (pr.count > 1 || pr.number == null ? pr.word : `${pr.word} · PR #${pr.number}`);

function stateOf(run, pr) {
  const s = String(run.status || '');
  if (!s && run.ticket) return TICKET_STATE[run.ticket.status] || 'waiting';
  if (run.pendingQuestion != null && !ENDED.has(s)) return 'needs-you';
  if (s === 'created' || s === 'starting') return 'starting';
  if (PARKED.has(s)) return 'paused';
  if (s === 'error') return 'failed';
  if (s === 'done') return pr && pr.id === 'merged' ? 'merged' : pr && pr.needsYou ? 'needs-you'
    : pr && pr.id !== 'closed' ? 'in-review' : 'ready';
  if (s === 'running') {
    const rows = (run.steps || []).filter((r) => r && r.nodeId != null);
    return !rows.length && !(run.active || []).length ? 'starting' : 'working';
  }
  return 'stopped';
}

/** "21:00" today, "Mon 03:00" on another day, in `timeZone` (the caller's local zone by default). */
function clock(iso, { now = Date.now(), timeZone } = {}) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const day = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
  return day(t) === day(now) ? hm : `${new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }).format(t)} ${hm}`;
}

function labelOfNode(run, nodeId) {
  const nodes = (run.stepper && run.stepper.graph && run.stepper.graph.nodes) || [];
  const n = nodes.find((x) => x && x.id === nodeId);
  return n ? String(n.label || n.key || n.id) : '';
}

function failedStep(run, where) {
  const err = [...(run.steps || [])].reverse().find((r) => r && r.status === 'error');
  const label = err ? labelOfNode(run, err.nodeId) : '';
  return label && label.toLowerCase() !== String(where).toLowerCase() ? label : '';
}

/** The single-run status line (spec §2.1 "Status line (single)"). */
function singleLine(state, run, prog, pr, opts) {
  const where = prog && prog.mode === 'stages' ? prog.label : '';
  switch (state) {
    case 'starting': return 'Starting';
    case 'working': return (prog && prog.step ? join(where, 'step', prog.step) : join(where, prog ? prog.what : '')) || 'Working';
    case 'needs-you': return join(where, 'needs you', askWhat(run.pendingQuestion).replace(/^answer /, ''));
    case 'paused': {
      const s = String(run.status);
      if (s === 'pausing') return join(where, 'pausing');
      return join(where, 'paused', s === 'interrupted' ? 'interrupted' : PAUSE_WORD[run.pauseReason] || '');
    }
    case 'waiting': {
      const at = run.ticket && run.ticket.runAt ? clock(run.ticket.runAt, opts) : '';
      // D11: what it waits for. A slice of a group names the group and the run; a member names its run; a plain
      // after-ticket names the run before it.
      const a = (run.ticket && run.ticket.after) || null;
      const after = !a ? '' : a.group && a.index ? `starts after ${a.group} · run ${a.index}`
        : a.index ? `starts after run ${a.index}` : a.title ? `starts after ${a.title}` : '';
      return join('Waiting', at ? `starts ${at}` : after);
    }
    case 'failed': return join(where, 'failed', failedStep(run, where));
    case 'stopped': return where ? `Stopped at ${where}` : 'Stopped';
    case 'ready': return 'Ready to ship';
    case 'in-review': return pr && pr.number != null ? `In review · PR #${pr.number}` : 'In review';
    default: return pr && pr.inBase ? pr.word : 'Merged';
  }
}

// Watch PR (src/core/pr-watch.mjs): a fix round owns the PR's branch while starting, fixing or publishing (watchActive);
// it stopped for a person at needs-person, its reason saying why (`cap`: MAX_FIX_RUNS fix runs, checks still failing).
const WATCH_LIVE = new Set(['starting', 'fixing', 'publishing']);
const WATCH_WHY = Object.freeze({
  cap: 'checks still failing', 'fix-failed': 'the last fix run failed', 'fix-interrupted': 'the last fix run was interrupted',
  'no-change': 'the last fix changed nothing', 'conflict-markers': 'conflicts remain', 'base-not-merged': 'conflicts remain',
  'push-refused': 'the push was refused', 'remote-moved': 'the branch moved',
});

/** D22: the round of the same run, from `run.round` or the raw marker `run.branch.roundOf`. null for round 1 (the
 *  run itself) and without one. */
function roundOf(run) {
  const x = run.round || (run.branch && typeof run.branch === 'object' ? run.branch.roundOf : null);
  const n = x ? Number(x.n ?? x.round) : NaN;
  return n >= 2 ? { n, request: String(x.request || ''), by: x.by || null } : null;
}

/** D23: the Watch PR fact. `{ live }` while a fix round runs, `{ stopped, line }` once it stopped for a person. */
function watchOf(w) {
  if (!w || typeof w !== 'object') return null;
  const s = String(w.status || '');
  if (WATCH_LIVE.has(s)) return { live: true, stopped: false, line: '' };
  if (s !== 'needs-person') return null;
  const n = Number(w.fixRuns) || 0;
  return { live: false, stopped: true, line: join('Needs you', 'Watch stopped', `${plural(n, 'fix run')}, ${WATCH_WHY[w.reason] || 'needs a person'}`) };
}
/** D8: a run with no PR of its own whose work is already in its base (History `inBase`, local refs): the merged chip,
 *  with no url, so nothing offers to open a PR. */
const inBaseChip = (r) => (r.inBase && r.inBase.base ? { id: 'merged', ...PR_STATES.merged, icon: 'merge', word: `Merged · in ${r.inBase.base}`,
  number: null, url: null, title: `Already in ${r.inBase.base} through another branch · no pull request of its own`, needsYou: false, inBase: true } : null);
/** The PR as prState reads it: a workspace run's member PRs first (#784), else its own PR, else the in-base chip (D8).
 *  A live fix round marks the run's own PR `fixing` (among the members, the one with the same url), which prState
 *  ranks above Conflicts / Checks failing. */
const prOf = (r, watch) => {
  const own = watch && watch.live && r.pr && typeof r.pr === 'object' ? r.pr : null;
  const members = own && Array.isArray(r.memberPrs)
    ? r.memberPrs.map((p) => (p && p.url && p.url === own.url ? { ...p, fixing: true } : p)) : r.memberPrs;
  return memberPrState(members) || prState(own ? { ...own, fixing: true } : r.pr) || inBaseChip(r);
};

/** A finished run that needs a person without a question: its PR fails checks or conflicts with no fix round on it
 *  (D31), or its Watch PR stopped for a person (D23). runs-list.mjs prNeedsOf reads this for the Needs you section.
 *  It does not read `status`: its callers (runs-list.mjs needsYou's `prNeeds && s === 'done'`) gate on a done run,
 *  as runModel's own watchNeeds does. */
export function finishedNeedsYou(run) {
  const r = run || {};
  const watch = watchOf(r.watch);
  const pr = prOf(r, watch);
  if (pr && (pr.id === 'merged' || pr.id === 'closed')) return false;
  return !!(watch && watch.stopped) || !!(pr && pr.needsYou);
}

/** D22: a round names itself. Working reads "Running · Round 2 · STAGE" (or the request, for a Watch PR round), which
 *  states the state ("Running" for Working); other live states and Failed lead with "Round 2"; a finished run keeps
 *  its line. */
function roundLine(state, round, base, prog, finished) {
  if (!round) return { line: base, lineSaysState: false };
  if (state === 'working') {
    const what = round.by === 'watch' && round.request ? round.request : (prog && prog.mode === 'stages' && prog.label) || 'working';
    return { line: join('Running', `Round ${round.n}`, what), lineSaysState: true };
  }
  if ((LIVE.has(state) && !finished) || state === 'failed') return { line: join(`Round ${round.n}`, base), lineSaysState: false };
  return { line: base, lineSaysState: false };
}

// Projects, any way: how a run worked. A live run, a History row or a saved state names it on `workMode` or on its
// branch record; anything else is a git run.
const RUN_MODES = new Set(['folder', 'none']);
function workModeOf(r) {
  for (const x of [r.workMode, r.branch && typeof r.branch === 'object' ? r.branch.workMode : null]) if (RUN_MODES.has(x)) return x;
  return 'git';
}
/** A finished run with nothing to ship (Projects, any way): a Folder run lands its changes through its Apply bar
 *  ("Applied · 14 files changed"), a run without a project leaves only its files, and a git run where git is missing
 *  (`gitChrome: false`) shows no git chrome. null for a run that ships by pull request. */
function finishedWords(r, mode) {
  if (mode === 'folder') {
    // An own `changes` (even null) wins over the branch record: a workspace run's branch mirrors its FIRST member only.
    const c = (Object.hasOwn(r, 'changes') ? r.changes : r.branch && typeof r.branch === 'object' ? r.branch.changes : null) || null;
    const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const total = c && c.counts && typeof c.counts === 'object' ? n(c.counts.added) + n(c.counts.modified) + n(c.counts.deleted) : null;
    // A run that changed nothing settles as discarded (P1b S7), yet nobody discarded anything.
    const word = total === 0 ? 'Finished' : c && c.state === 'applied' ? 'Applied' : c && c.state === 'discarded' ? 'Discarded' : 'Finished';
    return { word, line: join(word, total == null ? '' : total === 0 ? 'no files changed' : `${plural(total, 'file')} changed`) };
  }
  return mode === 'none' || r.gitChrome === false ? { word: 'Finished', line: 'Finished' } : null;
}

/**
 * One run's model.
 * @param {object} run   see the header
 * @param {{memo?:object, now?:number, timeZone?:string}} [opts]  `memo` is runProgress's monotonic memo (MUTATED)
 */
export function runModel(run, opts = {}) {
  const r = run || {};
  const watch = watchOf(r.watch);
  const pr = prOf(r, watch);
  // D23: a Watch PR that stopped for a person raises a finished run to Needs you; a merged or closed PR has ended it.
  const watchNeeds = !!(watch && watch.stopped) && String(r.status || '') === 'done' && r.pendingQuestion == null
    && !(pr && (pr.id === 'merged' || pr.id === 'closed'));
  const state = watchNeeds ? 'needs-you' : stateOf(r, pr);
  const mode = workModeOf(r);
  const fin = state === 'ready' ? finishedWords(r, mode) : null;
  const prog = r.status ? runProgress(r, opts.memo || null) : null;
  const meta = RUN_STATES[state];
  // A PR-driven Needs you has no question to answer; its line is the chip's reason (QA 3) and its action View PR (D31).
  const prNeeds = state === 'needs-you' && r.pendingQuestion == null && (watchNeeds || !!(pr && pr.needsYou));
  const actions = fin ? [] : watchNeeds ? ['open-pr', 'ask-changes'] : prNeeds ? ['open-pr']
    : state === 'stopped' && r.resumable === true ? ['resume', 'archive']
    // An interrupted run is never stopped: it archives, and resumes too unless it never can (no resume point, its project gone).
    : r.status === 'interrupted' ? (r.resumable === false ? ['archive'] : ['resume', 'archive']) : ACTIONS[state];
  const base = fin ? fin.line : state === 'starting' && mode === 'folder' ? 'Copying the folder'
    : watchNeeds ? watch.line : prNeeds ? prReasonLine(pr) : singleLine(state, r, prog, pr, opts);
  const round = roundOf(r);
  const { line, lineSaysState } = roundLine(state, round, base, prog, prNeeds);
  // Review A12: the live role-review rows (or the Refine line) under the status line; null when there are none.
  // QA 6: "?" means Worca is asking. A run in Needs you through its PR (or a stopped Watch PR) is a plain amber dot.
  return { state, ...meta, ...(fin ? { word: fin.word } : {}), symbol: prNeeds ? null : meta.symbol, line, lineSaysState, actions: [...actions], pr, prNeeds,
    round, progress: prog, roles: liveRoleRows(r, { stage: prog ? prog.stage : null }) };
}

// A run raised to Needs you by its PR (D31) is still a finished run for count and bar.
const doneLike = (m) => FINISHED.has(m.state) || !!m.prNeeds;
/** A member as groupProgress reads it. */
const asPart = (m) => ({ state: doneLike(m) ? 'done' : m.state === 'failed' ? 'failed'
  : LIVE.has(m.state) ? 'current' : 'waiting', progress: m.progress });

/**
 * A group's model (a Shaper feature or a Run-after chain, spec §2.1 "Status line (group)", §2.2, §2.3).
 * @param {{kind:'feature'|'chain', title?:string, planning?:object, members:object[], pr?:object, memo?:object}} group
 *   `planning`: the feature's planning run, counted in the bar, listed as "Planning", never in the count.
 *   `pr`: the group's own PR when it shipped as one.
 */
export function groupModel(group, opts = {}) {
  const g = group || {};
  const members = (g.members || []).map((m) => runModel(m, { ...opts, memo: m.memo || null }));
  const planning = g.planning ? runModel(g.planning, { ...opts, memo: g.planning.memo || null }) : null;
  const all = planning ? [planning, ...members] : members;
  const total = members.length;
  const done = members.filter(doneLike).length;
  const pr = prState(g.pr);
  const failed = all.find((m) => m.state === 'failed');
  const current = failed || all.find((m) => LIVE.has(m.state)) || all.find((m) => m.state === 'waiting')
    || (all.every(doneLike) ? null : all.find((m) => m.state === 'stopped')) || null;
  let state;
  if (current) state = current.state;
  else if (pr) state = pr.id === 'merged' ? 'merged' : pr.id === 'closed' ? 'ready' : 'in-review';
  else if (members.length && members.every((m) => m.state === 'merged')) state = 'merged';
  else state = members.some((m) => m.pr && ['ready', 'draft', 'changes', 'conflicts', 'failing', 'running', 'fixing'].includes(m.pr.id)) ? 'in-review' : 'ready';
  const idx = current ? members.indexOf(current) : -1;
  const where = current === planning && planning ? 'Planning' : `Run ${idx + 1} of ${total}`;
  const tail = () => {
    switch (state) {
      case 'starting': return `${where} · starting`;
      case 'working': {
        const rd = current.round;
        const what = rd && rd.by === 'watch' && rd.request ? rd.request : (current.progress && current.progress.label) || 'working';
        return rd ? `${where} · round ${rd.n} · ${what}` : `${where} · ${what}`;
      }
      case 'needs-you': return `${where} · needs you`;
      case 'paused': return `${where} · paused`;
      case 'failed': return `${where} · failed`;
      case 'waiting': return idx > 0 ? `${where} · waiting for run ${idx}` : join(where, current.line.replace(/^Waiting · /, '').replace(/^Waiting$/, 'waiting'));
      case 'stopped': return `Stopped at ${where === 'Planning' ? 'planning' : `run ${idx + 1} of ${total}`}`;
      case 'ready': return `${done} of ${total} done · ready to ship`;
      case 'in-review': { const n = pr ? 1 : members.filter((m) => m.pr && m.pr.id !== 'merged' && m.pr.id !== 'closed').length; return `In review · ${plural(n, 'PR')}`; }
      default: return 'Merged';
    }
  };
  const meta = RUN_STATES[state];
  const progress = groupProgress(members.map(asPart), { planning: planning ? asPart(planning) : null, memo: g.memo || null });
  // A group whose current member needs you only through its PR has no question to answer and nothing running there,
  // so it offers that PR, not Answer / Stop; `prNeeds` marks a group whose every member is finished. A PR- or
  // watch-driven current member offers its own actions (['open-pr'] or ['open-pr', 'ask-changes']).
  const prNeedsCurrent = !!(current && current.prNeeds);
  // QA 6: the group's "?" only while a member (or the planning run) waits on an answer.
  const asks = all.some((x) => x.state === 'needs-you' && !x.prNeeds);
  const symbol = state === 'needs-you' && !asks ? null : meta.symbol;
  // QA 7: how many distinct PRs the group has: its own, plus its members' that are not closed (a feature shipped as one
  // PR closes its slice drafts, and its chain-root member can carry the group PR itself). The one url when exactly one.
  const prList = [pr, ...members.map((m) => m.pr).filter((p) => p && p.id !== 'closed' && !p.inBase)].filter(Boolean);
  const seen = new Set();
  let prCount = 0;
  for (const p of prList) {
    if (p.count > 1) { prCount += p.count; continue; }     // a workspace member's several PRs (memberPrState)
    const k = p.url || `#${p.number}`;
    if (!seen.has(k)) { seen.add(k); prCount += 1; }
  }
  const prUrl = prCount === 1 ? prList[0].url || null : null;
  return { kind: g.kind || 'chain', title: g.title || '', state, ...meta, symbol, line: tail(), actions: prNeedsCurrent ? [...current.actions] : [...ACTIONS[state]],
    prNeeds: prNeedsCurrent && all.every(doneLike), pr, prCount, prUrl, count: { done, total, text: `${done}/${total}` }, progress, current, members, planning };
}
