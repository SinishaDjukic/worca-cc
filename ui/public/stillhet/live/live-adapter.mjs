// ui/public/stillhet/live/live-adapter.mjs — the live kind's only I/O (D4): dev's existing GET routes (D10) and the socket's
// frames, applied to the one store (shell/world.js) through its writers (D8): `load` for a snapshot or one refetched
// source, `move` / `add` for a run frame, `setState` for the list and the connection. It adds no route and keeps no field
// the shapes do not list (live-map.mjs). Every check stays on the server.
import { snapshotOf, partOf, taskOfLive, unreadOf, inPlay, chatOfRun } from './live-map.mjs';
import { startChatLive } from './chat-live.mjs';
import { startTaskLive } from './task-live.mjs';
import { startWorkflowLive } from './workflow-live.mjs';
import { startScheduleLive } from './schedule-live.mjs';
import { progressOfState } from './chat-turns.mjs';
import { workModeOf } from '../../../../src/shared/ask-run-snapshot.mjs';

export const SOURCES = Object.freeze({
  history: '/api/history', threads: '/api/ask/threads?show=all', groups: '/api/ask/groups', schedules: '/api/schedules',
  projects: '/api/projects', sync: '/api/sync/projects', budget: '/api/budget', actions: '/api/actions/running',
  notifications: '/api/notifications', away: '/api/away-mode', settings: '/api/settings', runLinks: '/api/ask/run-links',
  runGroups: '/api/run-groups',   // Tasks: a group's tasks fold under it in the bar; its page is #run/group:GID
  usageLimits: '/api/usage-limits',   // the profile's usage rings: the harness CLIs' own plan-limit readings (D7)
  workspaces: '/api/workspaces',   // the bell's and the workspace page's questions; each map is read after the list (D10)
});
// A `*-changed` frame re-fetches only its own sources (D11); a chat's turn re-reads the threads.
const CHANGED = {
  'pipelines-changed': ['history', 'runLinks'], 'ask-run-status': ['runLinks'], 'schedules-changed': ['schedules'], 'notifications-changed': ['notifications'], 'projects-changed': ['projects'],
  'project-sync-changed': ['sync'], 'budget-changed': ['budget'], 'actions-changed': ['actions'], 'settings-changed': ['settings', 'away'], 'ask-groups-changed': ['groups'], 'run-groups-changed': ['runGroups'], 'usage-limits-changed': ['usageLimits'], 'workspaces-changed': ['workspaces'], 'ask-labels-changed': ['threads'],
  'workflows-changed': ['workflows'], 'scripts-changed': ['scripts'],   // Workflows (slice 7 D20): workflow-live.mjs reads its own lists again
  'ask-start': ['threads', 'runLinks'], 'ask-done': ['threads', 'runLinks'], 'ask-error': ['threads'], 'ask-title': ['threads'], 'ask-message': ['threads', 'runLinks'],
};
const WORKFLOW_SOURCES = new Set(['workflows', 'scripts']);
const RUN_FRAMES = new Set(['run-created', 'state', 'question', 'question-resolved', 'done', 'error', 'title']);
const DEBOUNCE_MS = 250, BACKOFF_MS = 1000, BACKOFF_MAX_MS = 30000, TOKEN_EXPIRED = 4001;

export function startLive({ fetch, WebSocket, location, world, host = {}, prefs = null, setTimeout, clearTimeout = () => {}, now = Date.now, openChat = () => '', hidden = () => false, toast = () => {}, open = undefined, go = () => {}, download = () => {}, workflowsChanged = () => {}, on = () => {} }) {
  let sources = {}, loaded = false, listFailed = false, stopped = false, sock = null, backoff = BACKOFF_MS, reconnect = 0, queue = [], unread = [], asked = 0;
  const live = new Map(), timers = {}, stamp = {}, stale = new Set();
  const progress = new Map();   // R-ux-12: each live run's place among its stages, from its `state` frames (runProgress)
  const projects = () => sources.projects?.projects || [];
  // the live chat (D5): its threads are read and subscribed over this adapter's fetch and socket
  const chat = startChatLive({ fetch, now, toast, afterPr: () => askPrs(), send: (m) => { if (sock && sock.readyState === 1) sock.send(JSON.stringify(m)); }, tasksOf: (id) => (world.part?.('chats') || []).find((c) => c.id === id)?.tasks || [], progressOf: (id) => progress.get(id) || {}, askOf: (id) => (live.get(id) || [...live.values()].find((r) => r.pipelineId === id))?.pendingQuestion || null, ...(open ? { open } : {}), go });
  chat.chatOfRun = (id) => chatOfRun(sources.runLinks?.links || [], id);   // a task's starting chat, archived ones too (D7)
  // a run by its run or pipeline id: its pipeline id, when it started and ended (a live run has not ended), and its scope
  // (store key, project folder, whether it worked on a folder copy) for dev's routes that need one (POST /api/pr, recovery-patch)
  chat.runOf = (id) => {
    const l = live.get(id) || [...live.values()].find((r) => r.pipelineId === id), h = (sources.history?.pipelines || []).find((p) => p && (p.id === id || (l && p.id === l.pipelineId)));
    return { pipelineId: l?.pipelineId || h?.id || id, startedAt: l?.startedAt || h?.startedAt || '', endAt: l ? null : h?.mtime ?? null,
      projectKey: h?.projectKey || l?.projectKey || '', projectDir: h?.projectDir || l?.projectDir || '', folder: workModeOf(h || l) === 'folder' };
  };

  // Workflows (slice 7 D2): workflow-live owns every Workflows request; its lists are read when the place first asks
  const workflow = startWorkflowLive({ fetch, toast, go, download, setTimeout, clearTimeout, on: () => workflowsChanged() });

  // Tasks (D4): task-live owns every task fetch, the checks cache and the Tasks actions; this adapter only hands it the
  // runs, the store and the first-load signal, and passes its frames on. It keeps no cache of its own.
  const str0 = (v) => (typeof v === 'string' ? v : '');
  const liveRun = (id) => live.get(id) || [...live.values()].find((r) => r.pipelineId === id);
  // dev's server flags (the hello and `flags` frames) are the pages' Labs flags (D11): Bulk Label follows runLabels, the
  // task page reads telemetry only with runTelemetry on
  const copyFlags = (flags) => { if (!prefs || !flags || typeof flags !== 'object') return; for (const [k, v] of Object.entries(flags)) if (typeof v === 'boolean' && prefs.flag(k) !== v) prefs.setFlag(k, v); };
  const task = startTaskLive({ fetch, now, toast, chat, flag: (k) => !!prefs?.flag(k), ...(open ? { open } : {}), runOf: (id) => chat.runOf(id), rowOf: (id) => world.find?.(id) || null,
    listLoaded: () => loaded, listFailed: () => listFailed, retryList: () => retry(), retryPrs: () => { if (prsFailed) askPrs(); }, projectDirOf: (x) => str0(projects().find((p) => p && (p.key === x || p.name === x))?.path),
    liveOf: (id) => {
      const l = liveRun(id); if (!l) return null;
      return { runId: l.runId, pipelineId: l.pipelineId || '', status: l.status, projectKey: l.projectKey || '', projectDir: l.projectDir || '', pendingQuestion: l.pendingQuestion || null,
        state: { status: l.status, title: l.title, branch: l.branch || null, steps: l.steps || [], totalCostUsd: l.totalCostUsd, totalActiveMs: l.totalActiveMs, pipelineCapUsd: l.pipelineCapUsd,
          pauseReason: l.pauseReason, pauseDetail: l.pauseDetail, startedAt: l.startedAt, stepper: l.stepper, ...(l.pauseAfterStep ? { pauseAfterStep: true } : {}) } };
    } });

  // Schedules (D4): schedule-live owns every Schedules request; the store still moves only on the server's frames
  const schedule = startScheduleLive({ fetch, setTimeout, clearTimeout, on, now, tasksOf: () => world.part?.('runs') || [] });

  async function get(url) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return r.json();
  }
  // Each request is numbered when it is sent; an answer never replaces one that was asked for later (a single-source
  // refetch that lands while a full fetch is out keeps its newer answer).
  function keep(name, answer, n) {
    if ((stamp[name] || 0) > n) return false;
    stamp[name] = n; sources = { ...sources, [name]: name === 'history' ? withPrs(answer) : answer };
    return true;
  }
  // GET /api/history is a skeleton without PRs; dev's POST /api/history/pr pushes each row's PR as `history-pr` frames
  // (app.js requestHistoryPr). Asked once per history load, after the socket is up; a new skeleton carries the PRs
  // already known (app.js carryHistoryPr), so an open PR never reads Ready (Create PR) in between.
  const prs = new Map();
  let prToken = 0, prsFailed = false;   // a failed lookup is asked again by a task page's Try again (retryPrs)
  const prKey = (projectKey, id) => `${projectKey || ''}|${id}`;
  function withPrs(h) {
    if (!h || !Array.isArray(h.pipelines) || !prs.size) return h;
    return { ...h, pipelines: h.pipelines.map((p) => (p && !p.pr && prs.has(prKey(p.projectKey, p.id)) ? { ...p, pr: prs.get(prKey(p.projectKey, p.id)) } : p)) };
  }
  function askPrs() {
    if (!sock) return;   // its answer comes as frames: the next hello asks again
    const token = ++prToken;
    Promise.resolve(fetch('/api/history/pr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }))
      .then((r) => { if (token === prToken) prsFailed = !(r && r.ok); }, () => { if (token === prToken) prsFailed = true; });
  }
  function onPrs(f) {
    const items = f.token === prToken && Array.isArray(f.items) ? f.items : [];
    if (!items.length) return;
    for (const it of items) if (it && it.id) { if (it.pr) prs.set(prKey(it.projectKey, it.id), it.pr); else prs.delete(prKey(it.projectKey, it.id)); }
    const known = new Map(items.filter((it) => it && it.id).map((it) => [prKey(it.projectKey, it.id), it.pr || null]));
    const h = sources.history;
    if (!h || !Array.isArray(h.pipelines)) return;
    sources = { ...sources, history: { ...h, pipelines: h.pipelines.map((p) => (p && known.has(prKey(p.projectKey, p.id)) ? { ...p, pr: known.get(prKey(p.projectKey, p.id)) } : p)) } };
    draw(() => partOf('history', sources.history, { ...sources, hello: { runs: [...live.values()] } }, { now: now(), unread, checksOf: task.checks }), undefined, { list: 'refresh' });
  }
  // A source's read: the workspaces list, then every workspace's map in parallel (a failed map read leaves that
  // workspace without questions, never the list unread); any other source is its one GET.
  async function load(name) {
    if (name !== 'workspaces') return get(SOURCES[name]);
    const list = await get(SOURCES.workspaces), maps = {};
    await Promise.all((Array.isArray(list?.workspaces) ? list.workspaces : []).filter((x) => x && typeof x.id === 'string')
      .map((x) => get(`/api/workspaces/${encodeURIComponent(x.id)}/map`).then((m) => { maps[x.id] = m; }, () => {})));
    return { ...list, maps };
  }
  async function fetchAll() {
    const n = ++asked, names = Object.keys(SOURCES), answers = await Promise.all(names.map((x) => load(x)));
    names.forEach((x, i) => keep(x, answers[i], n));
  }
  const snapshot = () => snapshotOf({ ...sources, hello: { runs: [...live.values()] } }, { now: now(), unread, checksOf: task.checks });
  // A checks entry landed (D5): the rows read their case from it, so the runs part is drawn again (debounced). Only then:
  // a redraw on every task change would replace the store's parts under a flow that is still on its way.
  let checksDraw = 0;
  task.onChecks(() => {
    if (!loaded || stopped) return;
    clearTimeout(checksDraw);
    checksDraw = setTimeout(() => { checksDraw = 0; draw(() => { const x = snapshot(); return { runs: x.runs, groups: x.groups }; }, undefined, { list: 'refresh' }); }, DEBOUNCE_MS);
  });
  // A load the mapper cannot build fails the list's look (the first load) or marks it out of date (later), never spins.
  function draw(build, state, fail) {
    let parts;
    try { parts = build(); } catch (e) { console.error(e); world.setState(fail); return false; }
    world.load(parts, state);
    return true;
  }

  // The first load: every source, then the socket; the snapshot is drawn on hello, with the live runs.
  async function begin() {
    try { await fetchAll(); }
    catch (e) {
      world.setState(e.status === 401 ? { conn: 'session', list: 'failed' } : { list: 'failed' });
      if (!loaded) { listFailed = true; task.listChanged(); }   // a task page waiting on the first load reads failed (D15)
      return;
    }
    stale.clear();
    clearTimeout(reconnect); reconnect = 0;
    if (!sock) connect();
    else if (loaded) { draw(snapshot, { list: '', conn: '' }, { list: 'refresh' }); askPrs(); }
    else firstLoad();
  }
  // one socket at a time: a Try again during a reconnect wait opens it now, and the wait is dropped
  function connect() {
    if (stopped || sock) return;
    clearTimeout(reconnect); reconnect = 0;
    const ws = sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { backoff = BACKOFF_MS; };
    ws.onmessage = (ev) => { let f; try { f = JSON.parse(ev.data); } catch { return; } onFrame(f); };
    ws.onclose = (ev) => {
      if (sock === ws) sock = null;
      if (stopped) return;
      if (ev && ev.code === TOKEN_EXPIRED) { world.setState({ conn: 'session' }); return; }
      world.setState({ conn: 'offline' });
      const wait = backoff; backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
      clearTimeout(reconnect);
      reconnect = setTimeout(() => { reconnect = 0; connect(); }, wait);
    };
  }

  function onFrame(f) {
    if (!f || typeof f !== 'object') return;
    if (f.type === 'hello') { hello(f); return; }
    if (typeof f.type === 'string' && (f.type.startsWith('ask-') || f.type.startsWith('term-'))) chat.frame(f);
    if (typeof f.type === 'string' && f.type.startsWith('scriptbench-')) workflow.frame(f);   // a script bench's answer (D12)
    task.frame(f);
    schedule.frame(f);
    if (!loaded) { queue.push(f); return; }
    apply(f);
  }
  let helloSeen = false;
  function firstLoad() {
    if (!helloSeen) return;
    // loaded before the draw: the world's listeners (a cold #run/ID's route) then open the task on the real path
    loaded = true;
    if (!draw(snapshot, { list: '', conn: '' }, { list: 'failed', conn: '' })) { loaded = false; return; }
    askPrs();
    const q = queue.map((x, i) => [x, i]).sort((a, b) => ((a[0].seq ?? 0) - (b[0].seq ?? 0)) || a[1] - b[1]).map(([x]) => x);
    queue = [];
    q.forEach(apply);
  }
  function hello(f) {
    const was = live;
    const next = new Map();
    for (const r of Array.isArray(f.runs) ? f.runs : []) if (r && r.runId) next.set(r.runId, { ...r, ...(was.get(r.runId)?.opened ? { opened: true, unread: false } : {}) });
    live.clear(); for (const [k, v] of next) live.set(k, v);
    helloSeen = true;
    copyFlags(f.flags);
    // the first hello draws the first snapshot, even after a drop before it (a socket that closed before its hello)
    if (!loaded) { firstLoad(); return; }
    // back after a drop: rail turned off meanwhile reaches the host; offline clears only once every source is read again
    if (f.flags && typeof f.flags === 'object') host.flagsChanged?.(f.flags);
    chat.reconnect();
    workflow.reconnect();   // a Run all whose frames were lost while the socket was gone answers now (D12)
    fetchAll().then(() => { stale.clear(); draw(snapshot, { list: '', conn: '' }, { conn: '', list: 'refresh' }); askPrs(); }, () => { for (const x of Object.keys(SOURCES)) stale.add(x); world.setState({ conn: '', list: 'refresh' }); });
  }

  function moveTask(raw) {
    const t = taskOfLive(raw, { now: now(), projects: projects() });
    if (world.find(t.id)) world.move(t.id, t.case, t.detail, { title: t.title, cost: t.cost, unread: t.unread, over: !!t.over });   // a calm Failed sorts into Recent
    else world.add(t);
  }
  // A run frame moves its task; a run that is not one of dev's Needs-you inputs (an agent generation, a run already over)
  // gets no task of its own. When a live run names a pipeline the store holds as a saved row (a resumed run), the runs are
  // read again so that pipeline is kept once, live.
  // A resume starts its pipeline under a new run id; the run it resumed (paused, its old id) is over, so it leaves the
  // live runs: left there it would stand for the pipeline again once the new run ends, with its stale Paused.
  function supersede(raw) {
    if (!raw.pipelineId) return false;
    let gone = false;
    for (const [k, v] of live) if (k !== raw.runId && v.pipelineId === raw.pipelineId) { live.delete(k); progress.delete(k); gone = true; }
    return gone;
  }
  function place(raw) {
    if (supersede(raw)) { draw(() => { const x = snapshot(); return { runs: x.runs, groups: x.groups }; }, undefined, { list: 'refresh' }); return; }
    if (!inPlay(raw) && !world.find(raw.runId)) return;
    if (raw.pipelineId && raw.pipelineId !== raw.runId && world.find(raw.pipelineId)) { draw(() => { const x = snapshot(); return { runs: x.runs, groups: x.groups }; }, undefined, { list: 'refresh' }); return; }
    moveTask(raw);
  }
  function apply(f) {
    if (RUN_FRAMES.has(f.type) && f.runId) {
      let raw = live.get(f.runId);
      if (f.type === 'run-created') { raw = { ...f, type: undefined }; live.set(f.runId, raw); place(raw); return; }
      if (!raw) return;
      if (f.type === 'state') { const pg = progressOfState(f); if (pg.step) { progress.set(f.runId, pg); if (f.id) progress.set(f.id, pg); } }
      if (f.type === 'state') Object.assign(raw, { status: f.status ?? raw.status, title: f.title || raw.title, totalCostUsd: f.totalCostUsd ?? raw.totalCostUsd, pauseReason: f.pauseReason ?? null, pauseDetail: f.pauseDetail ?? null, limitEngine: f.limitEngine ?? null, limitResetAt: f.limitResetAt ?? null, pipelineId: f.id || raw.pipelineId,
        branch: f.branch ?? raw.branch, steps: Array.isArray(f.steps) ? f.steps : raw.steps, totalActiveMs: f.totalActiveMs ?? raw.totalActiveMs, pipelineCapUsd: f.pipelineCapUsd ?? raw.pipelineCapUsd, pauseAfterStep: f.pauseAfterStep === true,
        stepper: f.stepper ?? raw.stepper });   // its workflow's nodes: a round with no planner draws no Plan stage
      else if (f.type === 'question') raw.pendingQuestion = { ...f, type: undefined };
      else if (f.type === 'question-resolved') raw.pendingQuestion = null;
      else if (f.type === 'title') raw.title = f.title || raw.title;
      else if (f.type === 'done' || f.type === 'error') {
        raw.status = f.type === 'error' ? 'error' : f.status || 'done';
        raw.pendingQuestion = null;
        if (raw.status === 'paused') Object.assign(raw, { pauseReason: f.reason ?? raw.pauseReason, pauseDetail: f.detail ?? raw.pauseDetail, limitEngine: f.limitEngine ?? raw.limitEngine, limitResetAt: f.limitResetAt ?? raw.limitResetAt });
        if (raw.status === 'error' || raw.status === 'failed') { raw.unread = true; raw.opened = false; }   // dev's lingering rule: failed while watched, until opened
      }
      place(raw);
      return;
    }
    if (f.type === 'ask-done' || f.type === 'ask-error') unread = unreadOf(unread, f, { openChat: openChat(), hidden: hidden() });
    if (f.type === 'flags') { copyFlags(f.flags); host.flagsChanged?.(f.flags || {}); return; }
    if (f.type === 'history-pr') { onPrs(f); return; }
    // an archived or deleted paused run leaves the live runs (dev's app.js drops the same ids), so its row goes now
    if (f.type === 'pipelines-changed' && Array.isArray(f.removedRunIds) && f.removedRunIds.length) {
      let gone = false;
      for (const id of f.removedRunIds) if (live.delete(id)) { progress.delete(id); gone = true; }
      if (gone) draw(() => { const x = snapshot(); return { runs: x.runs, groups: x.groups }; }, undefined, { list: 'refresh' });
    }
    for (const s of CHANGED[f.type] || []) refresh(s);
  }

  function refresh(source) {
    if (WORKFLOW_SOURCES.has(source)) { workflow.refresh(source); return; }
    if (!SOURCES[source]) return;
    clearTimeout(timers[source]);
    timers[source] = setTimeout(async () => {
      timers[source] = 0;
      const n = ++asked;
      let a;
      try { a = await load(source); } catch { stale.add(source); world.setState({ list: 'refresh' }); return; }
      if (!keep(source, a, n)) return;
      if (source === 'history') askPrs();
      // the out-of-date look clears only once every source that failed has been read again
      const was = stale.size; stale.delete(source);
      if (!draw(() => partOf(source, sources[source], { ...sources, hello: { runs: [...live.values()] } }, { now: now(), unread, checksOf: task.checks }), was && !stale.size ? { list: '' } : undefined, { list: 'refresh' })) stale.add(source);   // a mapper throw: the look clears once it maps again
    }, DEBOUNCE_MS);
  }

  function retry() { listFailed = false; world.setState({ list: 'loading' }); return begin(); }
  begin();
  return {
    chat, task, workflow, schedule,
    stop: () => { stopped = true; clearTimeout(reconnect); for (const k of Object.keys(timers)) clearTimeout(timers[k]); sock?.close(); },
    refresh,
    retry,
    // opening a chat clears its dot (D14)
    seen: () => { const was = unread.length; unread = unreadOf(unread, null, { openChat: openChat(), hidden: hidden() }); if (unread.length !== was && loaded) world.load({ chats: snapshot().chats }); },
    // opening a task a failed run left unread (dev's acknowledge): it leaves Needs you, and stays out after any refetch
    seenRun: (id) => { const raw = live.get(id); if (!raw || !raw.unread) return; raw.unread = false; raw.opened = true; moveTask(raw); },
  };
}
