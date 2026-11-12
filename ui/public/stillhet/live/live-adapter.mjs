// ui/public/stillhet/live/live-adapter.mjs — the live kind's only I/O (D4): dev's existing GET routes (D10) and the socket's
// frames, applied to the one store (shell/world.js) through its writers (D8): `load` for a snapshot or one refetched
// source, `move` / `add` for a run frame, `setState` for the list and the connection. It adds no route and keeps no field
// the shapes do not list (live-map.mjs). Every check stays on the server.
import { snapshotOf, partOf, taskOfLive, unreadOf, inPlay } from './live-map.mjs';

export const SOURCES = Object.freeze({
  history: '/api/history', threads: '/api/ask/threads?show=all', groups: '/api/ask/groups', schedules: '/api/schedules',
  projects: '/api/projects', sync: '/api/sync/projects', budget: '/api/budget', actions: '/api/actions/running',
  notifications: '/api/notifications', away: '/api/away-mode', settings: '/api/settings',
});
// A `*-changed` frame re-fetches only its own sources (D11); a chat's turn re-reads the threads.
const CHANGED = {
  'pipelines-changed': ['history'], 'schedules-changed': ['schedules'], 'notifications-changed': ['notifications'], 'projects-changed': ['projects'],
  'project-sync-changed': ['sync'], 'budget-changed': ['budget'], 'actions-changed': ['actions'], 'settings-changed': ['settings', 'away'], 'ask-groups-changed': ['groups'],
  'ask-start': ['threads'], 'ask-done': ['threads'], 'ask-error': ['threads'], 'ask-title': ['threads'], 'ask-message': ['threads'],
};
const RUN_FRAMES = new Set(['run-created', 'state', 'question', 'question-resolved', 'done', 'error', 'title']);
const DEBOUNCE_MS = 250, BACKOFF_MS = 1000, BACKOFF_MAX_MS = 30000, TOKEN_EXPIRED = 4001;

export function startLive({ fetch, WebSocket, location, world, host = {}, setTimeout, clearTimeout = () => {}, now = Date.now, openChat = () => '', hidden = () => false }) {
  let sources = {}, loaded = false, stopped = false, sock = null, backoff = BACKOFF_MS, reconnect = 0, queue = [], unread = [], asked = 0;
  const live = new Map(), timers = {}, stamp = {}, stale = new Set();
  const projects = () => sources.projects?.projects || [];

  async function get(url) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return r.json();
  }
  // Each request is numbered when it is sent; an answer never replaces one that was asked for later (a single-source
  // refetch that lands while a full fetch is out keeps its newer answer).
  function keep(name, answer, n) {
    if ((stamp[name] || 0) > n) return false;
    stamp[name] = n; sources = { ...sources, [name]: answer };
    return true;
  }
  async function fetchAll() {
    const n = ++asked, names = Object.keys(SOURCES), answers = await Promise.all(names.map((x) => get(SOURCES[x])));
    names.forEach((x, i) => keep(x, answers[i], n));
  }
  const snapshot = () => snapshotOf({ ...sources, hello: { runs: [...live.values()] } }, { now: now(), unread });
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
      return;
    }
    stale.clear();
    clearTimeout(reconnect); reconnect = 0;
    if (!sock) open();
    else if (loaded) draw(snapshot, { list: '', conn: '' }, { list: 'refresh' });
    else firstLoad();
  }
  // one socket at a time: a Try again during a reconnect wait opens it now, and the wait is dropped
  function open() {
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
      reconnect = setTimeout(() => { reconnect = 0; open(); }, wait);
    };
  }

  function onFrame(f) {
    if (!f || typeof f !== 'object') return;
    if (f.type === 'hello') { hello(f); return; }
    if (!loaded) { queue.push(f); return; }
    apply(f);
  }
  let helloSeen = false;
  function firstLoad() {
    if (!helloSeen || !draw(snapshot, { list: '', conn: '' }, { list: 'failed', conn: '' })) return;
    loaded = true;
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
    // the first hello draws the first snapshot, even after a drop before it (a socket that closed before its hello)
    if (!loaded) { firstLoad(); return; }
    // back after a drop: rail turned off meanwhile reaches the host; offline clears only once every source is read again
    if (f.flags && typeof f.flags === 'object') host.flagsChanged?.(f.flags);
    fetchAll().then(() => { stale.clear(); draw(snapshot, { list: '', conn: '' }, { conn: '', list: 'refresh' }); }, () => { for (const x of Object.keys(SOURCES)) stale.add(x); world.setState({ conn: '', list: 'refresh' }); });
  }

  function moveTask(raw) {
    const t = taskOfLive(raw, { now: now(), projects: projects() });
    if (world.find(t.id)) world.move(t.id, t.case, t.detail, { title: t.title, cost: t.cost, unread: t.unread });
    else world.add(t);
  }
  // A run frame moves its task; a run that is not one of dev's Needs-you inputs (an agent generation, a run already over)
  // gets no task of its own. When a live run names a pipeline the store holds as a saved row (a resumed run), the runs are
  // read again so that pipeline is kept once, live.
  function place(raw) {
    if (!inPlay(raw) && !world.find(raw.runId)) return;
    if (raw.pipelineId && raw.pipelineId !== raw.runId && world.find(raw.pipelineId)) { draw(() => ({ runs: snapshot().runs }), undefined, { list: 'refresh' }); return; }
    moveTask(raw);
  }
  function apply(f) {
    if (RUN_FRAMES.has(f.type) && f.runId) {
      let raw = live.get(f.runId);
      if (f.type === 'run-created') { raw = { ...f, type: undefined }; live.set(f.runId, raw); place(raw); return; }
      if (!raw) return;
      if (f.type === 'state') Object.assign(raw, { status: f.status ?? raw.status, title: f.title || raw.title, totalCostUsd: f.totalCostUsd ?? raw.totalCostUsd, pauseReason: f.pauseReason ?? null, pauseDetail: f.pauseDetail ?? null, limitEngine: f.limitEngine ?? null, limitResetAt: f.limitResetAt ?? null, pipelineId: f.id || raw.pipelineId });
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
    if (f.type === 'flags') { host.flagsChanged?.(f.flags || {}); return; }
    for (const s of CHANGED[f.type] || []) refresh(s);
  }

  function refresh(source) {
    if (!SOURCES[source]) return;
    clearTimeout(timers[source]);
    timers[source] = setTimeout(async () => {
      timers[source] = 0;
      const n = ++asked;
      let a;
      try { a = await get(SOURCES[source]); } catch { stale.add(source); world.setState({ list: 'refresh' }); return; }
      if (!keep(source, a, n)) return;
      // the out-of-date look clears only once every source that failed has been read again
      const was = stale.size; stale.delete(source);
      if (!draw(() => partOf(source, a, { ...sources, hello: { runs: [...live.values()] } }, { now: now(), unread }), was && !stale.size ? { list: '' } : undefined, { list: 'refresh' })) stale.add(source);   // a mapper throw: the look clears once it maps again
    }, DEBOUNCE_MS);
  }

  begin();
  return {
    stop: () => { stopped = true; clearTimeout(reconnect); for (const k of Object.keys(timers)) clearTimeout(timers[k]); sock?.close(); },
    refresh,
    retry: () => { world.setState({ list: 'loading' }); return begin(); },
    // opening a chat clears its dot (D14)
    seen: () => { const was = unread.length; unread = unreadOf(unread, null, { openChat: openChat(), hidden: hidden() }); if (unread.length !== was && loaded) world.load({ chats: snapshot().chats }); },
    // opening a task a failed run left unread (dev's acknowledge): it leaves Needs you, and stays out after any refetch
    seenRun: (id) => { const raw = live.get(id); if (!raw || !raw.unread) return; raw.unread = false; raw.opened = true; moveTask(raw); },
  };
}
