// ui/public/stillhet/live/live-map.mjs — the live adapter's pure half (D4): dev's API answers and socket frames into the
// demo model's shapes (model-shape.mjs). No DOM, no fetch, no clock of its own: `now` (epoch ms) is passed in. It keeps
// only the fields the shapes list (D12): a thread's context and session, a History row's folder, every setting but
// keepAwake never reach the store. live-adapter.mjs does the I/O and applies what this returns.
import { needsYou, needsYouItems, prNeedsOf, FAILED, roundMarkerOf } from '../../../../src/shared/needs-you.mjs';
import { dayBucket } from '../../../../src/shared/day-buckets.mjs';
import { pick } from './model-shape.mjs';
import { repeatOf, atOf } from './schedule-rule.mjs';

const lc = (v) => String(v || '').toLowerCase();
const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ms = (v) => (typeof v === 'number' ? v : Date.parse(String(v || '')));
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY = 86400000;
// a local midnight `n` days from `t`'s, stepped with setDate as dayBucket steps, so a DST day is still one day
const midnight = (t, n = 0) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d.getTime(); };
const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dateWord = (t) => { const d = new Date(t); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };

/** The list's day section of a past moment: dev's own (src/shared/day-buckets.mjs dayBucket), so both lists agree. */
export const dayOf = (at, now) => dayBucket(ms(at), now);
/** A row's time, as the seeds write it: 14:32 today, Yesterday, Mon this week, else Oct 20. */
export function timeOf(at, now) {
  const t = ms(at);
  if (!Number.isFinite(t)) return '';
  const day = dayOf(t, now);
  return day === 'today' ? clock(t) : day === 'yesterday' ? 'Yesterday' : day === 'week' ? WEEKDAYS[new Date(t).getDay()] : dateWord(t);
}
// what is still to come: Pulse's Scheduled groups (pulse-model.js SCHED)
const whenOf = (at, now) => { const t = ms(at); if (!Number.isFinite(t)) return 'later'; return t < midnight(now, 1) ? 'today' : t < midnight(now, 2) ? 'tomorrow' : t < midnight(now, 7) ? 'week' : 'later'; };
const nextWord = (at, now) => { const t = ms(at); if (!Number.isFinite(t)) return ''; const w = whenOf(t, now); return w === 'today' ? clock(t) : w === 'tomorrow' ? `Tomorrow ${clock(t)}` : w === 'week' ? `${WEEKDAYS[new Date(t).getDay()]} ${clock(t)}` : dateWord(t); };
const baseName = (dir) => str(dir).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
const projectName = (dir, projects = []) => (dir ? (projects.find((p) => p && p.path === dir)?.name || baseName(dir)) : '');

// ---- tasks ----
// A case of the run page (runs/run-page-model.js) per raw status. Needs you picks from the first table, anything else from
// the second, so a task's section is 'needs' exactly when dev's needsYouItems lists it (D7).
const NEEDS_CASE = { paused: 'paused-restart', ask: 'question', failed: 'failed', done: 'failing' };
const CALM_CASE = { created: 'starting', starting: 'starting', running: 'working', pausing: 'working', paused: 'paused-you', interrupted: 'paused-you', stopped: 'stopped', aborted: 'stopped', error: 'failed', failed: 'failed', done: 'finished-nogit', complete: 'finished-nogit', completed: 'finished-nogit' };

/** A task's run-page case (D7). `item`: { kind: 'live'|'hist', status, ask, unread, prNeeds, limitEngine, pauseReason,
 *  merged }; `needs` (from needsYouItems) wins over the item's own rule when given. */
// a PR that still stands (open or merged): a closed-unmerged one is gone, its run reads Ready again (Create PR)
const prUrlOf = (pr) => (pr?.url && lc(pr.state) !== 'closed' ? str(pr.url) : '');
// a saved row whose PR is still open: the rows the checks cache is read for (D5)
const openPrOf = (row) => !!prUrlOf(row?.pr) && lc(row.pr.state || 'open') === 'open';
// D5: an open PR's case from its checks entry (task-live.mjs owns the cache; rows, cards and pages pass the same entry):
// approved once the checks pass and it merges cleanly, conflicts, failing, else checks (still running). null = no entry.
export function prCaseOf(checks) {
  if (!checks || typeof checks !== 'object') return null;
  if (checks.mergeable === 'CONFLICTING') return 'conflicts';
  const st = lc(checks.checks?.state);
  if (st === 'failing') return 'failing';
  if ((st === 'passing' || st === 'none') && checks.mergeable === 'MERGEABLE') return 'approved';
  return 'checks';
}
export function caseOf(item = {}, { checks = null } = {}) {
  const s = lc(item.status), needs = 'needs' in item ? !!item.needs : needsYou(item);
  // A question names its own case: Worca's plan waiting for approval, or a step that failed and asks how to go on.
  if (item.askKind === 'plan' && !FAILED.has(s) && s !== 'paused') return 'plan';
  if (item.askKind === 'recovery' && !FAILED.has(s) && s !== 'paused') return 'recovery';
  const open = s === 'done' && !item.merged && prUrlOf(item.pr) && lc(item.pr?.state) !== 'merged';
  if (open && checks) return prCaseOf(checks);
  if (needs) {
    if (s === 'paused') return item.limitEngine ? 'paused-limit' : /cost|cap|budget/.test(lc(item.pauseReason)) ? 'capped' : /error|fail/.test(lc(item.pauseReason)) ? NEEDS_CASE.failed : NEEDS_CASE.paused;
    if (FAILED.has(s)) return NEEDS_CASE.failed;
    // no checks entry yet: the PR's own verdict (prNeeds) — merge conflicts, else failing checks
    if (s === 'done') return item.pr?.mergeable === 'CONFLICTING' ? 'conflicts' : NEEDS_CASE.done;
    return NEEDS_CASE.ask;
  }
  if (s === 'done' && item.merged) return 'merged';
  // a finished run whose PR is open: In review (View PR), never Create PR again
  if (open) return 'checks';
  // a finished run whose branch is still there and not in its base yet: Ready, its PR still to make (Create PR)
  if (s === 'done' && item.branch && item.survived) return 'ready';
  return CALM_CASE[s] || (item.kind === 'live' ? 'working' : 'finished-nogit');
}
/** A calm task whose state word would sort it into Needs you (Failed, Ready) is `over`: it sorts into Recent, as the
 *  demo's over runs (world.js sectionRaw), so its section stays dev's needsYouItems (D7). */
export const overOf = (item = {}, c = caseOf(item)) => c === 'failed' || c === 'ready' ? !('needs' in item ? !!item.needs : needsYou(item)) : false;
const DETAIL = { created: 'Starting', starting: 'Starting', running: 'Working', pausing: 'Pausing', paused: 'Paused', interrupted: 'Worca was stopped', stopped: 'Stopped', aborted: 'Stopped', error: 'Failed', failed: 'Failed', done: 'Finished' };
const questionOf = (q) => str(q?.questions?.[0]?.question) || str(q?.title) || 'Asks you something';
const detailOf = (r, ask) => (ask ? questionOf(r.pendingQuestion) : lc(r.status) === 'paused' ? str(r.pauseDetail) || str(r.pauseReason) || DETAIL.paused : DETAIL[lc(r.status)] || '');
const labelsOf = (r) => (Array.isArray(r.labels) ? r.labels : []).map((l) => (typeof l === 'string' ? l : str(l?.name))).filter(Boolean);
const kindOf = (r) => (r.kind === 'workspace-run' || r.target === 'workspace' ? 'Workspace' : r.workMode === 'folder' ? 'Folder' : 'Git');
const byOf = (r) => str(r.startedBy) || str(r.startedBy?.name);
const liveItem = (run) => ({ kind: 'live', status: run.status, ask: !!run.pendingQuestion, askKind: str(run.pendingQuestion?.kind), unread: !!run.unread, limitEngine: run.limitEngine, pauseReason: run.pauseReason, pipelineId: run.pipelineId || null });
// a workspace row's own `survived` is its primary project's; each project's is in `members[]` (src/core/artifacts.mjs workspaceMemberFacts)
const savedItem = (row) => ({ kind: 'hist', id: row.id, status: row.status, prNeeds: prNeedsOf(row), limitEngine: row.limitEngine, pauseReason: row.pauseReason, merged: lc(row.pr?.state) === 'merged' || row.mergeBack?.merged === true || !!row.inBase, branch: str(row.branch), survived: !!row.survived || (Array.isArray(row.members) && row.members.some((m) => m && m.survived)), pr: row.pr, mtime: row.mtime, startedAt: row.startedAt, roundOf: row.roundOf });

/** A live run: a `hello.runs` entry or a `run-created` frame, patched by its frames (live-adapter.mjs). */
export function taskOfLive(run = {}, { now = 0, projects = [], needs, checks = null } = {}) {
  const item = liveItem(run), it = needs === undefined ? item : { ...item, needs }, c = caseOf(it, { checks });
  return pick('task', { id: str(run.runId), case: c, ...(overOf(it, c) ? { over: true } : {}), ...(lc(run.status) === 'interrupted' ? { interrupted: true } : {}), title: str(run.title) || 'Untitled task', project: str(run.projectName) || projectName(run.projectDir, projects), detail: detailOf(run, item.ask), time: timeOf(run.startedAt, now), day: dayOf(run.startedAt, now), labels: labelsOf(run), cost: num(run.totalCostUsd), archived: false, unread: !!run.unread, pr: '', group: '', kind: kindOf(run), by: byOf(run), workflow: '' });
}
/** A saved run: a `GET /api/history` row. */
export function taskOfSaved(row = {}, { now = 0, needs, checks = null } = {}) {
  const item = savedItem(row), at = Number.isFinite(ms(row.mtime)) ? row.mtime : row.startedAt, it = needs === undefined ? item : { ...item, needs }, c = caseOf(it, { checks });
  return pick('task', { id: str(row.id), case: c, ...(overOf(it, c) ? { over: true } : {}), ...(lc(row.status) === 'interrupted' ? { interrupted: true } : {}), title: str(row.title) || 'Untitled task', project: str(row.projectName), detail: lc(row.status) === 'paused' ? str(row.pauseDetail) || str(row.pauseReason) || DETAIL.paused : DETAIL[lc(row.status)] || '', time: timeOf(at, now), day: dayOf(at, now), labels: labelsOf(row), cost: num(row.totalCostUsd), archived: !!row.archived, unread: false, pr: prUrlOf(row.pr), group: '', kind: kindOf(row), by: byOf(row), workflow: '' });
}

// ---- chats ----
/** A chat: a `GET /api/ask/threads?show=all` row. Its tasks come from `GET /api/ask/run-links` (`links`) and the store's
 *  tasks (`tasks`): a run it started is a task, a run it only follows a task with `followed: true` (D8). A link whose run
 *  the store does not hold is left out: a task's figures have one source. */
/** The project a chat works in: dev keeps it in the thread's `context` (PATCH {scope}, src/core/ask/scope.mjs
 *  chatScopeOf); '' when it is not pinned to one. */
export function projectKeyOf(thread = {}) {
  const c = thread && typeof thread.context === 'object' ? thread.context : null;
  return c && c.pinned !== false ? str(c.projectKey) : '';
}
export function chatOf(thread = {}, { now = 0, unread = [], links = [], tasks = [], projects = [], livePids = new Map(), schedules = [] } = {}) {
  const key = projectKeyOf(thread), project = key ? str(arr(projects).find((p) => p && p.key === key)?.name) || key : '';
  const state = thread.waiting ? 'needs-you' : thread.inFlight ? 'replying' : 'idle';
  const o = thread.origin && typeof thread.origin === 'object' ? { platform: str(thread.origin.platform) || str(thread.origin.plugin), label: str(thread.origin.label) } : null;
  return pick('chat', { id: str(thread.id), title: str(thread.title) || 'New chat', state, kind: (thread.startedRuns || 0) > 0 ? 'started' : (thread.runLinks || 0) > 0 ? 'tracks' : 'chat', project, time: timeOf(thread.updatedAt, now), day: dayOf(thread.updatedAt, now), cost: num(thread.totals?.costUsd), pinned: !!thread.pinnedAt, archived: !!thread.archivedAt, unread: unread.includes(thread.id), group: str(thread.groupId), origin: o, rank: 0, labels: arr(thread.labels).filter((l) => typeof l === 'string'), tasks: [...chatTasks(str(thread.id), links, tasks, livePids), ...chatSchedules(str(thread.id), schedules)] });
}
// A chat's task: the store's task (its id is the run id live, the pipeline id saved), as chats-model.js's chat tasks read.
// Resume gives a run a new run id while its link keeps the first one: the live run holding the link's pipeline id
// (`livePids`, pipeline id → run id) is that task.
const taskOfLink = (l, tasks, livePids) => {
  const now = l.pipelineId ? livePids.get(l.pipelineId) : '';
  return (now && tasks.find((t) => t.id === now)) || tasks.find((t) => t.id === l.runId || (l.pipelineId && t.id === l.pipelineId));
};
function chatTasks(threadId, links, tasks, livePids = new Map()) {
  const out = [];
  for (const l of arr(links)) {
    if (!l || l.threadId !== threadId) continue;
    const t = taskOfLink(l, tasks, livePids);
    if (!t || out.some((x) => x.run === t.id)) continue;
    // an open PR offers Watch (chats-column.js); whether it is watched is dev's GET /api/pr/watch, read when it is toggled
    out.push({ id: t.id, run: t.id, pid: str(l.pipelineId) || t.id, title: t.title, case: t.case, detail: t.detail, project: t.project, ...(t.pr && t.case !== 'merged' ? { git: 'open' } : {}), ...(l.started ? {} : { followed: true }) });
  }
  return out;
}
// A schedule made from the chat (its `askThreadId`, scheduleOf's `chat`) is the chat's schedule task, as chats-model.js's
// are; its card reads its word and why from RailSchedules
const chatSchedules = (threadId, schedules) => arr(schedules).filter((s) => s && s.chat && s.chat === threadId).map((s) => ({ id: s.id, kind: 'schedule', title: s.title, time: s.time, detail: s.every }));
/** The chat that started a run, by its run id or pipeline id: the first started link (the route answers oldest first);
 *  '' for a run a chat only follows or no chat linked. */
export function chatOfRun(links = [], id = '') {
  if (!id) return '';
  return arr(links).find((l) => l && l.started && (l.runId === id || l.pipelineId === id))?.threadId || '';
}
/** D14, dev's ask-panel rule copied: an `ask-done` (or `ask-error`) for a chat that is not open, or while the page is hidden,
 *  lights its dot; the chat that is open, while shown, has none. Session only. → the unread chat ids. */
export function unreadOf(prev = [], frame = null, { openChat = '', hidden = false } = {}) {
  let out = [...prev];
  const t = frame && (frame.type === 'ask-done' || frame.type === 'ask-error') ? str(frame.threadId) : '';
  if (t && (hidden || t !== openChat) && !out.includes(t)) out.push(t);
  if (openChat && !hidden) out = out.filter((x) => x !== openChat);
  return out;
}

// ---- schedules ----
const PERIOD = { daily: 'today', weekly: 'this week', monthly: 'this month' };
/** A schedule: a ticket (once) or a series (recurring) of `GET /api/schedules`, with the D10 fields the page reads. */
export function scheduleOf(item = {}, { now = 0, projects = [] } = {}) {
  const once = item.kind === 'once', missed = once && item.status === 'missed', paused = !once && item.status === 'paused', ended = !once && item.status === 'ended';
  const afterTitle = once && item.after ? str(item.after.title) || 'the run before it' : '';
  const at = once ? (afterTitle ? null : item.runAt || item.scheduledFor) : item.nextRunAt;
  const skip = !once && !paused && !ended && Number.isFinite(ms(item.skippedRunAt)) ? str(item.skippedRunAt) || new Date(item.skippedRunAt).toISOString() : '';
  const name = projects.find((p) => p && (p.key === item.projectKey || p.path === item.projectDir))?.name || baseName(item.projectDir);
  const word = once ? 'Once' : repeatOf(item.rule) || str(item.sentence);
  // dev's own pause is 'user' (Paused by you); a series that paused itself says after how many failures
  const streak = num(item.failureStreak) || num(item.maxFailures) || 0;
  const why = !paused || !item.pauseReason || item.pauseReason === 'user' ? '' : item.pauseReason === 'failure_streak' ? `paused itself after ${streak} failure${streak === 1 ? '' : 's'} in a row` : str(item.pauseReason);
  const next = missed ? `Missed ${timeOf(at, now)}` : paused ? (why ? 'Paused' : 'Paused by you') : ended ? '' : afterTitle ? `after ${afterTitle}` : skip ? 'Skips next time, then as usual' : at ? `Next ${nextWord(at, now)}` : '';
  return pick('schedule', { id: str(item.id), title: str(item.title) || 'A schedule', project: name, chat: str(item.askThreadId), every: word, at: (!once && atOf(item.rule)) || (Number.isFinite(ms(at)) ? clock(ms(at)) : ''), next, ...(missed || paused || ended ? {} : { day: whenOf(at, now) }), state: missed ? 'diverged' : paused ? 'paused' : ended ? 'ended' : 'scheduled', time: missed ? timeOf(at, now) : afterTitle ? 'after' : nextWord(at, now), section: missed ? 'needs' : paused ? 'paused' : ended ? 'ended' : 'next', labels: [], what: str(item.summary), cost: null, started: Number.isFinite(ms(item.createdAt)) ? dateWord(ms(item.createdAt)) : '', runs: [], ...(missed ? { missed: dateWord(ms(at)), missedWhy: str(item.failReason) || 'Worca was not running' } : {}), nextAt: missed || ended || !Number.isFinite(ms(at)) ? null : ms(at),
    skip, overlap: str(item.overlap), fails: num(item.maxFailures), ifMissed: str(item.ifMissed), tz: str(item.tz || item.rule?.tz), pauseWhy: why,
    preset: item.presetId ? str(item.presetName) || 'preset deleted' : '', after: afterTitle, ended,
    rule: !once && item.rule && typeof item.rule === 'object' ? item.rule : null, grace: num(item.graceMin) ?? null,
    afterRef: once && item.after?.id ? { kind: str(item.after.kind), id: str(item.after.id), policy: str(item.after.policy) || 'done' } : null });
}
// a fire that never became a task reads as its ticket's case (run-page-model.js "A scheduled run before it is a run")
const TICKET_CASE = { firing: 'ticket-firing', failed: 'ticket-failed', missed: 'ticket-missed', skipped: 'ticket-skipped', canceled: 'ticket-canceled' };
/** A series' fires (the `history` of `GET /api/schedules/:id`, newest first) as the page's runs: a started fire is the
 *  store's task with its pipeline id (its case, its words); one that never started, its ticket's case. A pending ticket is no fire. */
export function runsOf(history = [], tasks = [], { now = 0 } = {}) {
  const byId = new Map(arr(tasks).filter(Boolean).map((t) => [t.id, t]));
  return arr(history).filter((t) => t && t.status !== 'scheduled').map((t) => {
    const task = t.status === 'fired' ? byId.get(t.pipelineId) || byId.get(t.id) : null, when = ms(t.runAt);
    const kase = task ? str(task.case) : t.status === 'fired' ? 'finished-nogit' : TICKET_CASE[t.status] || 'ticket-ended';
    return { day: Number.isFinite(when) ? dayOf(when, now) : 'older', date: Number.isFinite(when) ? dateWord(when) : '', time: timeOf(when, now), title: str(t.title) || 'A schedule', case: kase, stage: 0,
      git: kase === 'merged' ? 'merged' : /fail/.test(kase) ? 'fail' : 'branch', meta: task ? str(task.detail) : str(t.failReason), wid: task ? str(task.id) : str(t.id) };
  });
}
// A ticket or series still to come, and a missed one, are rows of the store too (world.js `when`, `missed`): Pulse's
// Scheduled and Needs you read them there, as the demo's waiting rows.
function waitingTask(item, now, projects) {
  const once = item.kind === 'once', missed = once && item.status === 'missed', at = once ? item.runAt || item.scheduledFor : item.nextRunAt;
  const s = scheduleOf(item, { now, projects });
  return pick('task', { id: `sched:${item.id}`, case: missed ? 'ticket-missed' : item.status === 'firing' ? 'ticket-firing' : 'scheduled', title: s.title, project: s.project, detail: missed ? 'Missed: it never started' : s.every, time: s.time, day: 'upcoming', labels: [], cost: null, archived: false, unread: false, pr: '', group: '', kind: 'Git', by: '', workflow: '', when: missed ? 'missed' : whenOf(at, now), ...(missed ? { missed: true } : {}) });
}

// ---- projects ----
const ORIGIN_OF = { 'up-to-date': 'ok', ahead: 'ok', behind: 'behind', diverged: 'diverged', 'no-upstream': 'local', missing: 'local', 'remote-only': 'ok', unknown: 'ok' };
/** A project: a `GET /api/projects` row and its `GET /api/sync/projects` block. Needs you when its folder is missing or it is
 *  out of sync (D22). */
export function projectOf(project = {}, sync = null) {
  const git = project.vcs ? project.vcs === 'git' : project.workMode !== 'folder';
  const s = sync && typeof sync === 'object' ? sync : null, state = lc(s?.state);
  const origin = project.exists === false ? 'missing' : !git ? 'folder' : s?.fetchError ? 'offline' : ORIGIN_OF[state] || 'ok';
  return pick('project', { id: str(project.key), name: str(project.name) || str(project.key), kind: git ? 'Git' : 'Folder', path: str(project.displayPath) || str(project.path), ...(s?.base ? { branch: str(s.base), base: `${str(s.remote) || 'origin'}/${str(s.base)}` } : {}), origin, ...(s ? { ahead: num(s.ahead), behind: num(s.behind) } : {}), ...(s?.fetchedAt ? { checked: timeOf(s.fetchedAt, Date.parse(s.fetchedAt)) } : {}), needs: project.exists === false || state === 'behind' || state === 'diverged' });
}

// ---- costs ----
const HARNESS = ['claude', 'codex', 'gemini', 'copilot', 'openrouter'];
/** Spend and budget from `GET /api/budget`; usage only as dev reports it: a limit pause draws its harness's ring full (D15). */
// The usage rings (D8): GET /api/usage-limits' readings, the harness CLI's own plan limits (a session and a week window);
// a window with no numeric percent, or whose reset has passed, draws nothing. A limit pause still fills its session ring.
const RING = ['session', 'week'];
export function costsOf(budget = null, runs = [], { now = 0, limits = null } = {}) {
  const b = budget && typeof budget === 'object' ? budget : null;
  const resets = b && Number.isFinite(b.windowEndMs) && b.windowEndMs > 0 ? dateWord(b.windowEndMs) : '';
  const usage = [];
  for (const h of Array.isArray(limits?.harnesses) ? limits.harnesses : []) {
    const p = lc(h?.engine);
    if (!HARNESS.includes(p) || usage.some((u) => u.p === p)) continue;
    const win = (Array.isArray(h.windows) ? h.windows : []).filter((w) => RING.includes(w?.kind) && Number.isFinite(w.pct) && !(Number.isFinite(w.resetsAt) && w.resetsAt <= now))
      .map((w) => ({ k: w.kind, pct: Math.min(100, Math.max(0, Math.round(w.pct))), resets: Number.isFinite(w.resetsAt) ? nextWord(w.resetsAt, now) : '' }));
    if (win.length) usage.push({ p, plan: '', asOf: clock(Number.isFinite(h.observedAt) ? h.observedAt : now), win });
  }
  for (const r of runs) {
    const p = lc(r?.limitEngine);
    if (lc(r?.status) !== 'paused' || !HARNESS.includes(p)) continue;
    const session = { k: 'session', pct: 100, resets: Number.isFinite(ms(r.limitResetAt)) ? nextWord(r.limitResetAt, now) : '' };
    const had = usage.find((u) => u.p === p);
    if (had) { if (!had.paused) { had.win = [session, ...had.win.filter((w) => w.k !== 'session')]; had.paused = true; } continue; }
    usage.push({ p, plan: '', asOf: clock(now), win: [session], paused: true });
  }
  for (const u of usage) delete u.paused;
  return { budget: b ? { period: PERIOD[b.resetPeriod] || 'all time', spent: num(b.windowSpendUsd) ?? 0, limit: num(b.totalLimitUsd), saved: num(b.windowSavedUsd), resets } : null, usage };
}

// ---- updates ----
// Pulse's catalogue (pulse-model.js GROUPS): the group and level of each event this adapter maps onto.
const EVENTS = {
  'schedule.missed': ['schedules', 'problem'], 'schedule.failed': ['schedules', 'problem'], 'schedule.run_error': ['schedules', 'problem'], 'schedule.run_paused': ['schedules', 'problem'],
  'schedule.self_paused': ['schedules', 'problem'], 'schedule.late': ['schedules', 'info'], 'schedule.retrying': ['schedules', 'info'], 'schedule.skipped': ['schedules', 'info'],
  'schedule.canceled': ['schedules', 'info'], 'schedule.ended': ['schedules', 'info'], 'schedule.completed': ['schedules', 'info'],
  'run.done': ['runs', 'info'], 'run.failed': ['runs', 'problem'], 'run.paused_limit': ['runs', 'problem'], 'run.paused_error': ['runs', 'problem'],
};
const NOTIF_EVENT = { missed: 'schedule.missed', failed: 'schedule.failed', run_error: 'schedule.run_error', run_paused: 'schedule.run_paused', paused: 'schedule.self_paused', late: 'schedule.late', retrying: 'schedule.retrying', skipped: 'schedule.skipped', canceled: 'schedule.canceled', ended: 'schedule.ended', completed: 'schedule.completed' };
const NAMES = { 'schedule.missed': 'Start missed', 'schedule.failed': 'Could not start', 'schedule.run_error': 'Scheduled run failed', 'schedule.run_paused': 'Run paused', 'schedule.self_paused': 'Series paused itself', 'schedule.late': 'Started late', 'schedule.retrying': 'Retrying a start', 'schedule.skipped': 'Start skipped', 'schedule.canceled': 'Start canceled', 'schedule.ended': 'Series ended', 'schedule.completed': 'Scheduled run finished', 'run.done': 'Run finished', 'run.failed': 'Task failed', 'run.paused_limit': 'Usage limit reached', 'run.paused_error': 'Paused on error' };
const updDay = (at, now) => { const d = dayOf(at, now); return d === 'today' ? 'Today' : d === 'yesterday' ? 'Yesterday' : 'Earlier'; };
const update = (id, e, title, meta, at, now, o = {}) => ({ id, e, g: EVENTS[e][0], sev: EVENTS[e][1], title, meta, time: timeOf(at, now) || '', day: updDay(at, now), unread: EVENTS[e][1] !== 'info' && !o.read, go: o.go || 'runs', to: o.to || 'Tasks', ...(o.run ? { run: o.run } : {}), ...(o.fix ? { fix: o.fix } : {}) });

/** A `GET /api/notifications` row, or null when Pulse's catalogue has no event for its kind. */
export function updateOf(n = {}, { now = 0 } = {}) {
  const e = NOTIF_EVENT[n.kind];
  if (!e) return null;
  // a missed start can be run now from its row (the ticket's waiting row in the store, live-map's `sched:` id)
  const missed = e === 'schedule.missed' && n.ticketId ? { run: `sched:${n.ticketId}`, fix: 'Run now' } : {};
  return update(`n${n.id}`, e, str(n.title) ? `${NAMES[e]} · ${n.title}` : NAMES[e], str(n.message), n.createdAt, now, { read: !!n.readAt || n.unread === false, go: 'schedules', to: 'Schedules', ...missed });
}
/** A run's outcome, from its History row: finished, failed or paused. */
export function updateOfOutcome(row = {}, { now = 0 } = {}) {
  const s = lc(row.status), at = Number.isFinite(ms(row.mtime)) ? row.mtime : row.startedAt;
  const e = s === 'done' ? 'run.done' : FAILED.has(s) ? 'run.failed' : s === 'paused' ? (row.limitEngine ? 'run.paused_limit' : 'run.paused_error') : '';
  if (!e) return null;
  return update(`o${row.id}`, e, `${NAMES[e]} · ${str(row.title) || 'Untitled task'}`, [str(row.projectName), str(row.pauseDetail)].filter(Boolean).join(' · '), at, now, { go: 'run', to: 'the run page', run: str(row.id), fix: FAILED.has(s) ? 'Try again' : s === 'paused' ? 'Resume' : '' });
}

// Away, as the profile menu's row reads it (pulse-model.js awayRow): away now, or here with or without away hours
function awayOf(away = {}) {
  const hours = Array.isArray(away.config?.hours) && away.config.hours.length === 2 ? away.config.hours.map(str) : null;
  return { status: away.toggle === 'on' ? 'away-now' : hours ? 'here' : 'no-hours', hours };
}

// ---- the snapshot ----
const OUTCOME_DAYS = 7, OUTCOMES_MAX = 50;
const arr = (v) => (Array.isArray(v) ? v : []);
// Dev's Needs-you inputs (app.js overviewRuns): a pipeline run (isPipelineRun: no scriptbench, no agentgen) that is live
// (isLive: not over, and starting, running, pausing or asking), paused, or lingering (failed while watched, not yet opened:
// `unread`). A run opened here (`opened`) keeps its row, calm. Any other hello run is over: its History row stands for it.
const OVER = new Set(['done', 'error', 'stopped', 'aborted', 'failed', 'complete', 'completed', 'interrupted']);
const PIPELINE_KINDS = new Set(['run', 'workspace-run', undefined, null]);
export function inPlay(r) {
  if (!r || !PIPELINE_KINDS.has(r.kind)) return false;
  const s = lc(r.status);
  const live = !OVER.has(s) && (['starting', 'running', 'pausing'].includes(s) || r.pendingQuestion != null);
  return live || s === 'paused' || !!r.unread || !!r.opened;
}
// ---- rounds (dev's foldRounds, ui/public/runs-list.mjs): a PR-fix or Restart Build round is its origin's, not a task of its own ----
const ROUND_WORD = { done: 'done', error: 'failed', failed: 'failed', stopped: 'stopped', aborted: 'stopped', interrupted: 'interrupted', paused: 'paused', pausing: 'paused' };
const roundRequest = (m) => (m.by === 'restart' ? 'restart Build' : str(m.request));
/** Marks each round task `roundOf: ORIGIN_TASK_ID` (it stays in the store, so its own page opens) and gives its origin the
 *  design's `rounds: { line, list: [{ n, words, time, case }] }`, newest first. A round whose origin the store lacks stays a row.
 *  `needs`: the ids of the tasks that need you; an origin whose round is live or needs you takes that round's case (and need). */
const LIVE_CASES = new Set(['starting', 'working', 'question', 'plan', 'recovery']);
export function foldRounds(runs, liveRuns = [], saved = [], needs = new Set()) {
  const markers = new Map();   // pipelineId → { marker, status }
  for (const r of saved) { const m = roundMarkerOf(r); if (m) markers.set(str(r.id), { m, status: r.status }); }
  for (const r of liveRuns) { const m = roundMarkerOf(r.branch && typeof r.branch === 'object' ? r.branch : r) || markers.get(str(r.pipelineId))?.m; if (m && r.pipelineId) markers.set(str(r.pipelineId), { m, status: r.status }); }
  if (!markers.size) return runs;
  const pidOf = new Map([...saved.map((r) => [str(r.id), str(r.id)]), ...liveRuns.filter((r) => r.pipelineId).map((r) => [str(r.runId), str(r.pipelineId)])]);
  const byPid = new Map(runs.map((t) => [pidOf.get(t.id) || t.id, t]));
  const rounds = new Map();   // origin task id → [round]
  for (const t of runs) {
    const x = markers.get(pidOf.get(t.id) || t.id), origin = x && byPid.get(str(x.m.pipelineId));
    if (!origin || origin === t) continue;
    t.roundOf = origin.id;
    const words = [roundRequest(x.m), ROUND_WORD[lc(x.status)] || 'running'].filter(Boolean).join(' · ');
    (rounds.get(origin.id) || rounds.set(origin.id, []).get(origin.id)).push({ n: x.m.round, words, time: t.time, case: t.id, task: t });
  }
  for (const t of runs) {
    const list = rounds.get(t.id); if (!list) continue;
    list.sort((a, b) => b.n - a.n);
    // a round that is live or needs you keeps its origin's row lit: the row reads the newest such round's case
    const lit = list.find((x) => needs.has(x.task.id) || LIVE_CASES.has(x.task.case));
    // ...and opens that round, so the row's case and the page it opens are the same task's
    if (lit) { t.case = lit.task.case; t.opens = lit.task.id; if (lit.task.over) t.over = true; else delete t.over; } else delete t.opens;
    for (const x of list) delete x.task;
    t.rounds = { line: `Round ${list[0].n} · ${list[0].words}`, list };
  }
  return runs;
}

/** Every source's answer into the store's parts. Archived rows go; a pipeline both live and saved is kept once, live.
 *  `checksOf(pipelineId)`: task-live.mjs's checks entry (D5), asked only for a row whose PR is open, so a row reads the
 *  same case as its page and its card (R-arch-11). */
export function snapshotOf(src = {}, { now = 0, unread = [], checksOf = null } = {}) {
  const projectsRaw = arr(src.projects?.projects), syncs = src.sync?.projects || {};
  const liveRuns = arr(src.hello?.runs).filter(inPlay);
  const saved = arr(src.history?.pipelines).filter((r) => r && !r.archived);
  const livePids = new Set(liveRuns.map((r) => r.pipelineId).filter(Boolean));
  const savedOnly = saved.filter((r) => !livePids.has(r.id));
  // Needs you is dev's rule over the same inputs the Runs badge counts (D6, D7)
  const ny = needsYouItems({ live: liveRuns.map(liveItem).map((x, i) => ({ ...x, runId: liveRuns[i].runId })), history: savedOnly.map(savedItem) });
  const needLive = new Set(ny.live.map((x) => x.runId)), needSaved = new Set(ny.history.map((x) => x.id));
  const sched = src.schedules || {}, items = [...arr(sched.tickets), ...arr(sched.schedules)];
  const runs = [
    ...liveRuns.map((r) => taskOfLive(r, { now, projects: projectsRaw, needs: needLive.has(r.runId) })),
    ...savedOnly.map((r) => taskOfSaved(r, { now, needs: needSaved.has(r.id), checks: checksOf && openPrOf(r) ? checksOf(str(r.id), { pr: str(r.pr.url), projectKey: str(r.projectKey), projectDir: str(r.projectDir) }) || null : null })),
    ...arr(sched.tickets).filter((t) => ['missed', 'scheduled', 'firing'].includes(t.status)).map((t) => waitingTask(t, now, projectsRaw)),
    ...arr(sched.schedules).filter((x) => x.status === 'active' && x.nextRunAt).map((x) => waitingTask(x, now, projectsRaw)),
  ];
  const outcomes = saved.filter((r) => now - ms(Number.isFinite(ms(r.mtime)) ? r.mtime : r.startedAt) < OUTCOME_DAYS * DAY).slice(0, OUTCOMES_MAX).map((r) => updateOfOutcome(r, { now })).filter(Boolean);
  const notes = arr(src.notifications?.notifications).map((n) => updateOf(n, { now })).filter(Boolean);
  const away = src.away || {};
  foldRounds(runs, liveRuns, saved, new Set([...needLive, ...needSaved]));
  const rowIdOf = new Map([...savedOnly.map((r) => [str(r.id), str(r.id)]), ...liveRuns.filter((r) => r.pipelineId).map((r) => [str(r.pipelineId), str(r.runId)])]);
  const { groups, inGroup } = runGroupsOf(src.runGroups, runs, { now, rowIdOf });
  for (const r of runs) { const gid = inGroup.get(r.id); if (gid) r.group = gid; }
  const schedules = items.filter((x) => x.kind === 'recurring' || ['missed', 'scheduled', 'firing'].includes(x.status)).map((x) => scheduleOf(x, { now, projects: projectsRaw }));
  return {
    runs, groups, userGroups: [],
    // the Chats Needs-you number: the server's count over every thread, not the first page's rows
    chatsNeeds: num(src.threads?.counts?.needs),
    chats: arr(src.threads?.threads).filter((t) => t && !t.archivedAt && !t.archived).map((t) => chatOf(t, { now, unread, links: arr(src.runLinks?.links), tasks: runs, projects: projectsRaw, livePids: new Map(liveRuns.filter((r) => r.pipelineId).map((r) => [r.pipelineId, str(r.runId)])), schedules })),
    chatGroups: arr(src.groups?.groups).map((g) => ({ id: str(g.id), name: str(g.name), total: num(g.count) ?? 0 })),
    schedules,
    projects: projectsRaw.map((p) => projectOf(p, syncs[p.key] || null)),
    costs: costsOf(src.budget, liveRuns, { now, limits: src.usageLimits }),
    updates: [...notes, ...outcomes],
    actions: arr(src.actions).filter((a) => ['starting', 'running', 'ready'].includes(a?.status)).map((a) => ({ id: str(a.instanceId), runId: str(a.runId), run: str(a.runTitle) || 'A removed run', label: str(a.label), go: a.runId ? 'run' : '' })),
    away: awayOf(away),
    keep: src.settings?.keepAwake !== false,   // dev's rule: on unless turned off
    spaces: spacesOf(src.workspaces),
  };
}

/** dev's run groups (GET /api/run-groups) → the store's groups, and which task each member is (by its pipeline id, or
 *  the live run of it). A group's case is its tasks' (below); its page is
 *  #run/group:GID (task-live.mjs). A group none of whose members the store holds is left out. */
const GROUP_WORKS = new Set(['starting', 'working']);
export function runGroupsOf(src, runs, { now = 0, rowIdOf = new Map() } = {}) {
  const inGroup = new Map(), groups = [];
  const byPid = new Map(runs.map((r) => [r.id, r]));
  for (const g of arr(src?.groups)) {
    const held = arr(g.members).map((m) => [m, rowIdOf.get(str(m.pipelineId)) || str(m.pipelineId)]).filter(([, id]) => byPid.has(id));
    if (!held.length) continue;
    for (const [, id] of held) inGroup.set(id, str(g.id));
    const ms = held.map(([, id]) => byPid.get(id));
    // a member put there by hand (dev's member `adhoc`): the list offers Remove from group (runs-list.js `adhoc`), at dev's position
    held.forEach(([src, id]) => { const m = byPid.get(id); m.adhoc = !!src.adhoc; m.pos = num(src.position) ?? 0; });
    const at = arr(g.members).map((m) => m.startedAt).find(Boolean) || '';
    // the group reads as its tasks: 'feature' (Working) while one starts or works, else its first unmerged one's case in
    // stack order (an approved task alone in a group is Ready to merge, never Working), 'merged' once all merged
    const next = held.slice().sort(([a], [b]) => (num(a.position) ?? 0) - (num(b.position) ?? 0)).map(([, id]) => byPid.get(id)).find((m) => m.case !== 'merged');
    const kase = !next ? 'merged' : ms.some((m) => GROUP_WORKS.has(m.case)) ? 'feature' : next.case;
    groups.push(pick('group', { id: str(g.id), kind: g.kind === 'feature' ? 'feature' : 'user', case: kase, title: str(g.title) || 'Untitled group',
      project: str(ms[0].project), time: ms[0].time || timeOf(at, now), day: ms[0].day || dayOf(at, now), cost: num(g.cost?.usd) }));
  }
  return { groups, inGroup };
}

/** dev's workspaces (GET /api/workspaces; `maps`: each one's GET /api/workspaces/:id/map, absent when its read failed) →
 *  the prototype's spaces (D10): its members by project key, and its map's effective edges as links. A link's `sure` is
 *  the scan's confidence; an `auto` heuristic or inferred link is a question (workspaces.js `unsure`). */
// dev's live edges (src/shared/workspace-map/overrides.mjs LIVE_STATES: auto, confirmed, manual) plus a rejected one, which the
// page keeps only to offer its Undo; stale and missing edges never draw, order or ask (dev's eval.mjs drops them too)
const LINK_STATES = new Set(['auto', 'confirmed', 'manual', 'rejected']);
export function spacesOf(src = null) {
  const maps = src?.maps && typeof src.maps === 'object' ? src.maps : {};
  return arr(src?.workspaces).filter((w) => w && str(w.id)).map((w) => {
    const exists = arr(w.exists), scannedAt = ms(w.mapSummary?.scannedAt);
    const links = arr(maps[w.id]?.edges).filter((e) => e && str(e.id) && str(e.from) && str(e.to) && LINK_STATES.has(str(e.state) || 'auto'))
      .map((e) => ({ id: str(e.id), from: str(e.from), to: str(e.to), kind: str(e.kind), how: 'connects to', sure: str(e.confidence), state: str(e.state) || 'auto' }));
    return pick('space', { id: str(w.id), title: str(w.name) || 'A workspace', home: '', runs: null, scanned: Number.isFinite(scannedAt) ? dateWord(scannedAt) : 'never', model: '', about: str(w.description),
      projects: arr(w.projectKeys).map((k, i) => [str(k), exists[i] === false ? 'missing' : 'ok']), links });
  });
}

// What each source feeds: a refetch of one source replaces only these parts (D11).
export const SOURCE_PARTS = Object.freeze({
  hello: ['runs', 'costs', 'chats', 'groups'], history: ['runs', 'updates', 'chats', 'groups'], threads: ['chats', 'chatsNeeds'], runLinks: ['chats'], groups: ['chatGroups'], runGroups: ['groups', 'runs'], schedules: ['schedules', 'runs'],
  projects: ['projects', 'runs'], sync: ['projects'], budget: ['costs'], usageLimits: ['costs'], workspaces: ['spaces'], actions: ['actions'], notifications: ['updates'], away: ['away'], settings: ['keep'],
});
/** The parts a single-source refetch replaces: `answer` stands for `source` among the last answers `sources`. */
export function partOf(source, answer, sources = {}, { now = 0, unread = [], checksOf = null } = {}) {
  const snap = snapshotOf({ ...sources, [source]: answer }, { now, unread, checksOf });
  return Object.fromEntries((SOURCE_PARTS[source] || []).map((k) => [k, snap[k]]));
}
