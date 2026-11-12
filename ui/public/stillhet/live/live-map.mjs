// ui/public/stillhet/live/live-map.mjs — the live adapter's pure half (D4): dev's API answers and socket frames into the
// demo model's shapes (model-shape.mjs). No DOM, no fetch, no clock of its own: `now` (epoch ms) is passed in. It keeps
// only the fields the shapes list (D12): a thread's context and session, a History row's folder, every setting but
// keepAwake never reach the store. live-adapter.mjs does the I/O and applies what this returns.
import { needsYou, needsYouItems, prNeedsOf, FAILED } from '../../../../src/shared/needs-you.mjs';
import { pick } from './model-shape.mjs';

const lc = (v) => String(v || '').toLowerCase();
const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ms = (v) => (typeof v === 'number' ? v : Date.parse(String(v || '')));
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY = 86400000;
const midnight = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dateWord = (t) => { const d = new Date(t); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };

/** The list's day section (DAY_SECTIONS) of a past moment. */
export function dayOf(at, now) {
  const t = ms(at);
  if (!Number.isFinite(t)) return 'older';
  const days = Math.floor((midnight(now) - midnight(t)) / DAY);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? 'week' : days < 31 ? 'month' : 'older';
}
/** A row's time, as the seeds write it: 14:32 today, Yesterday, Mon this week, else Oct 20. */
export function timeOf(at, now) {
  const t = ms(at);
  if (!Number.isFinite(t)) return '';
  const day = dayOf(t, now);
  return day === 'today' ? clock(t) : day === 'yesterday' ? 'Yesterday' : day === 'week' ? WEEKDAYS[new Date(t).getDay()] : dateWord(t);
}
// what is still to come: Pulse's Scheduled groups (pulse-model.js SCHED)
const whenOf = (at, now) => { const t = ms(at); if (!Number.isFinite(t)) return 'later'; const days = Math.floor((midnight(t) - midnight(now)) / DAY); return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? 'week' : 'later'; };
const nextWord = (at, now) => { const t = ms(at); if (!Number.isFinite(t)) return ''; const w = whenOf(t, now); return w === 'today' ? clock(t) : w === 'tomorrow' ? `Tomorrow ${clock(t)}` : w === 'week' ? `${WEEKDAYS[new Date(t).getDay()]} ${clock(t)}` : dateWord(t); };
const baseName = (dir) => str(dir).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
const projectName = (dir, projects = []) => (dir ? (projects.find((p) => p && p.path === dir)?.name || baseName(dir)) : '');

// ---- tasks ----
// A case of the run page (runs/run-page-model.js) per raw status. Needs you picks from the first table, anything else from
// the second, so a task's section is 'needs' exactly when dev's needsYouItems lists it (D7).
const NEEDS_CASE = { paused: 'paused-restart', ask: 'question', failed: 'failed', done: 'failing' };
const CALM_CASE = { created: 'starting', starting: 'starting', running: 'working', pausing: 'working', paused: 'paused-you', interrupted: 'paused-you', stopped: 'stopped', aborted: 'stopped', error: 'stopped', failed: 'stopped', done: 'finished-nogit', complete: 'finished-nogit', completed: 'finished-nogit' };

/** A task's run-page case (D7). `item`: { kind: 'live'|'hist', status, ask, unread, prNeeds, limitEngine, pauseReason,
 *  merged }; `needs` (from needsYouItems) wins over the item's own rule when given. */
export function caseOf(item = {}) {
  const s = lc(item.status), needs = 'needs' in item ? !!item.needs : needsYou(item);
  if (needs) {
    if (s === 'paused') return item.limitEngine ? 'paused-limit' : /cost|cap|budget/.test(lc(item.pauseReason)) ? 'capped' : NEEDS_CASE.paused;
    if (FAILED.has(s)) return NEEDS_CASE.failed;
    if (s === 'done') return NEEDS_CASE.done;
    return NEEDS_CASE.ask;
  }
  if (s === 'done' && item.merged) return 'merged';
  return CALM_CASE[s] || (item.kind === 'live' ? 'working' : 'finished-nogit');
}
const DETAIL = { created: 'Starting', starting: 'Starting', running: 'Working', pausing: 'Pausing', paused: 'Paused', interrupted: 'Worca was stopped', stopped: 'Stopped', aborted: 'Stopped', error: 'Failed', failed: 'Failed', done: 'Finished' };
const questionOf = (q) => str(q?.questions?.[0]?.question) || str(q?.title) || 'Asks you something';
const detailOf = (r, ask) => (ask ? questionOf(r.pendingQuestion) : lc(r.status) === 'paused' ? str(r.pauseDetail) || str(r.pauseReason) || DETAIL.paused : DETAIL[lc(r.status)] || '');
const labelsOf = (r) => (Array.isArray(r.labels) ? r.labels : []).map((l) => (typeof l === 'string' ? l : str(l?.name))).filter(Boolean);
const kindOf = (r) => (r.kind === 'workspace-run' || r.target === 'workspace' ? 'Workspace' : r.workMode === 'folder' ? 'Folder' : 'Git');
const byOf = (r) => str(r.startedBy) || str(r.startedBy?.name);
const liveItem = (run) => ({ kind: 'live', status: run.status, ask: !!run.pendingQuestion, unread: !!run.unread, limitEngine: run.limitEngine, pauseReason: run.pauseReason, pipelineId: run.pipelineId || null });
const savedItem = (row) => ({ kind: 'hist', id: row.id, status: row.status, prNeeds: prNeedsOf(row), limitEngine: row.limitEngine, pauseReason: row.pauseReason, merged: lc(row.pr?.state) === 'merged', pr: row.pr, mtime: row.mtime, startedAt: row.startedAt, roundOf: row.roundOf });

/** A live run: a `hello.runs` entry or a `run-created` frame, patched by its frames (live-adapter.mjs). */
export function taskOfLive(run = {}, { now = 0, projects = [], needs } = {}) {
  const item = liveItem(run);
  return pick('task', { id: str(run.runId), case: caseOf(needs === undefined ? item : { ...item, needs }), title: str(run.title) || 'Untitled task', project: str(run.projectName) || projectName(run.projectDir, projects), detail: detailOf(run, item.ask), time: timeOf(run.startedAt, now), day: dayOf(run.startedAt, now), labels: labelsOf(run), cost: num(run.totalCostUsd), archived: false, unread: !!run.unread, pr: '', group: '', kind: kindOf(run), by: byOf(run), workflow: '' });
}
/** A saved run: a `GET /api/history` row. */
export function taskOfSaved(row = {}, { now = 0, needs } = {}) {
  const item = savedItem(row), at = Number.isFinite(ms(row.mtime)) ? row.mtime : row.startedAt;
  return pick('task', { id: str(row.id), case: caseOf(needs === undefined ? item : { ...item, needs }), title: str(row.title) || 'Untitled task', project: str(row.projectName), detail: lc(row.status) === 'paused' ? str(row.pauseDetail) || str(row.pauseReason) || DETAIL.paused : DETAIL[lc(row.status)] || '', time: timeOf(at, now), day: dayOf(at, now), labels: labelsOf(row), cost: num(row.totalCostUsd), archived: !!row.archived, unread: false, pr: str(row.pr?.url), group: '', kind: kindOf(row), by: byOf(row), workflow: '' });
}

// ---- chats ----
/** A chat: a `GET /api/ask/threads?show=all` row. Its task links are counts on a list row, so `tasks` stays empty. */
export function chatOf(thread = {}, { now = 0, unread = [] } = {}) {
  const state = thread.waiting ? 'needs-you' : thread.inFlight ? 'replying' : 'idle';
  const o = thread.origin && typeof thread.origin === 'object' ? { platform: str(thread.origin.platform) || str(thread.origin.plugin), label: str(thread.origin.label) } : null;
  return pick('chat', { id: str(thread.id), title: str(thread.title) || 'New chat', state, kind: (thread.startedRuns || 0) > 0 ? 'started' : (thread.runLinks || 0) > 0 ? 'tracks' : 'chat', project: '', time: timeOf(thread.updatedAt, now), day: dayOf(thread.updatedAt, now), cost: num(thread.totals?.costUsd), pinned: !!thread.pinnedAt, archived: !!thread.archivedAt, unread: unread.includes(thread.id), group: str(thread.groupId), origin: o, rank: 0, labels: [], tasks: [] });
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
/** A schedule: a ticket (once) or a series (recurring) of `GET /api/schedules`. */
export function scheduleOf(item = {}, { now = 0, projects = [] } = {}) {
  const once = item.kind === 'once', missed = once && item.status === 'missed', paused = !once && item.status === 'paused';
  const at = once ? item.runAt || item.scheduledFor : item.nextRunAt;
  const name = projects.find((p) => p && (p.key === item.projectKey || p.path === item.projectDir))?.name || baseName(item.projectDir);
  return pick('schedule', { id: str(item.id), title: str(item.title) || 'A schedule', project: name, chat: str(item.askThreadId), every: once ? 'Once' : str(item.sentence), at: Number.isFinite(ms(at)) ? clock(ms(at)) : '', next: missed ? `Missed ${timeOf(at, now)}` : paused ? 'Paused' : at ? `Next ${nextWord(at, now)}` : '', ...(missed || paused ? {} : { day: whenOf(at, now) }), state: missed ? 'diverged' : paused ? 'paused' : 'scheduled', time: missed ? timeOf(at, now) : nextWord(at, now), section: missed ? 'needs' : paused ? 'paused' : 'next', labels: [], what: str(item.summary), cost: null, started: Number.isFinite(ms(item.createdAt)) ? dateWord(ms(item.createdAt)) : '', runs: [], ...(missed ? { missed: dateWord(ms(at)), missedWhy: str(item.failReason) || 'Worca was not running' } : {}) });
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
  return pick('project', { id: str(project.key), kind: git ? 'Git' : 'Folder', path: str(project.displayPath) || str(project.path), ...(s?.base ? { branch: str(s.base), base: `${str(s.remote) || 'origin'}/${str(s.base)}` } : {}), origin, ...(s ? { ahead: num(s.ahead), behind: num(s.behind) } : {}), ...(s?.fetchedAt ? { checked: timeOf(s.fetchedAt, Date.parse(s.fetchedAt)) } : {}), needs: project.exists === false || state === 'behind' || state === 'diverged' });
}

// ---- costs ----
const HARNESS = ['claude', 'codex', 'gemini', 'copilot', 'openrouter'];
/** Spend and budget from `GET /api/budget`; usage only as dev reports it: a limit pause draws its harness's ring full (D15). */
export function costsOf(budget = null, runs = [], { now = 0 } = {}) {
  const b = budget && typeof budget === 'object' ? budget : null;
  const resets = b && Number.isFinite(b.windowEndMs) && b.windowEndMs > 0 ? dateWord(b.windowEndMs) : '';
  const usage = [];
  for (const r of runs) {
    const p = lc(r?.limitEngine);
    if (lc(r?.status) !== 'paused' || !HARNESS.includes(p) || usage.some((u) => u.p === p)) continue;
    usage.push({ p, plan: '', asOf: clock(now), win: [{ k: 'session', pct: 100, resets: Number.isFinite(ms(r.limitResetAt)) ? nextWord(r.limitResetAt, now) : '' }] });
  }
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
/** Every source's answer into the store's parts. Archived rows go; a pipeline both live and saved is kept once, live. */
export function snapshotOf(src = {}, { now = 0, unread = [] } = {}) {
  const projectsRaw = arr(src.projects?.projects), syncs = src.sync?.projects || {};
  const liveRuns = arr(src.hello?.runs).filter((r) => r && r.kind !== 'scriptbench');
  const saved = arr(src.history?.pipelines).filter((r) => r && !r.archived);
  const livePids = new Set(liveRuns.map((r) => r.pipelineId).filter(Boolean));
  const savedOnly = saved.filter((r) => !livePids.has(r.id));
  // Needs you is dev's rule over the same inputs the Runs badge counts (D6, D7)
  const ny = needsYouItems({ live: liveRuns.map(liveItem).map((x, i) => ({ ...x, runId: liveRuns[i].runId })), history: savedOnly.map(savedItem) });
  const needLive = new Set(ny.live.map((x) => x.runId)), needSaved = new Set(ny.history.map((x) => x.id));
  const sched = src.schedules || {}, items = [...arr(sched.tickets), ...arr(sched.schedules)];
  const runs = [
    ...liveRuns.map((r) => taskOfLive(r, { now, projects: projectsRaw, needs: needLive.has(r.runId) })),
    ...savedOnly.map((r) => taskOfSaved(r, { now, needs: needSaved.has(r.id) })),
    ...arr(sched.tickets).filter((t) => ['missed', 'scheduled', 'firing'].includes(t.status)).map((t) => waitingTask(t, now, projectsRaw)),
    ...arr(sched.schedules).filter((x) => x.status === 'active' && x.nextRunAt).map((x) => waitingTask(x, now, projectsRaw)),
  ];
  const outcomes = saved.filter((r) => now - ms(Number.isFinite(ms(r.mtime)) ? r.mtime : r.startedAt) < OUTCOME_DAYS * DAY).slice(0, OUTCOMES_MAX).map((r) => updateOfOutcome(r, { now })).filter(Boolean);
  const notes = arr(src.notifications?.notifications).map((n) => updateOf(n, { now })).filter(Boolean);
  const away = src.away || {};
  return {
    runs, groups: [], userGroups: [],
    chats: arr(src.threads?.threads).filter((t) => t && !t.archivedAt && !t.archived).map((t) => chatOf(t, { now, unread })),
    chatGroups: arr(src.groups?.groups).map((g) => ({ id: str(g.id), name: str(g.name), total: num(g.count) ?? 0 })),
    schedules: items.filter((x) => x.kind === 'recurring' ? x.status !== 'ended' : ['missed', 'scheduled', 'firing'].includes(x.status)).map((x) => scheduleOf(x, { now, projects: projectsRaw })),
    projects: projectsRaw.map((p) => projectOf(p, syncs[p.key] || null)),
    costs: costsOf(src.budget, liveRuns, { now }),
    updates: [...notes, ...outcomes],
    actions: arr(src.actions).filter((a) => ['starting', 'running', 'ready'].includes(a?.status)).map((a) => ({ id: str(a.instanceId), runId: str(a.runId), run: str(a.runTitle) || 'A removed run', label: str(a.label), go: a.runId ? 'run' : '' })),
    away: awayOf(away),
    keep: src.settings?.keepAwake === true,
  };
}

// What each source feeds: a refetch of one source replaces only these parts (D11).
export const SOURCE_PARTS = Object.freeze({
  hello: ['runs', 'costs'], history: ['runs', 'updates'], threads: ['chats'], groups: ['chatGroups'], schedules: ['schedules', 'runs'],
  projects: ['projects', 'runs'], sync: ['projects'], budget: ['costs'], actions: ['actions'], notifications: ['updates'], away: ['away'], settings: ['keep'],
});
/** The parts a single-source refetch replaces: `answer` stands for `source` among the last answers `sources`. */
export function partOf(source, answer, sources = {}, { now = 0, unread = [] } = {}) {
  const snap = snapshotOf({ ...sources, [source]: answer }, { now, unread });
  return Object.fromEntries((SOURCE_PARTS[source] || []).map((k) => [k, snap[k]]));
}
