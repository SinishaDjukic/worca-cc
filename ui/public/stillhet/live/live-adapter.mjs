// ui/public/stillhet/live/live-adapter.mjs — the live kind's only I/O (D4): dev's existing GET routes (D10) and the socket's
// frames, applied to the one store (shell/world.js) through its writers (D8): `load` for a snapshot or one refetched
// source, `move` / `add` for a run frame, `setState` for the list and the connection. It adds no route and keeps no field
// the shapes do not list (live-map.mjs). Every check stays on the server.
import { snapshotOf, partOf, taskOfLive, unreadOf } from './live-map.mjs';

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
  let sources = {}, loaded = false, stopped = false, sock = null, backoff = BACKOFF_MS, reopened = false, stale = false, queue = [], unread = [];
  const live = new Map(), timers = {};
  const projects = () => sources.projects?.projects || [];

  async function get(url) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return r.json();
  }
  async function fetchAll() {
    const names = Object.keys(SOURCES), answers = await Promise.all(names.map((n) => get(SOURCES[n])));
    const next = { ...sources };
    names.forEach((n, i) => { next[n] = answers[i]; });
    sources = next;
  }
  const snapshot = () => snapshotOf({ ...sources, hello: { runs: [...live.values()] } }, { now: now(), unread });

  // The first load: every source, then the socket; the snapshot is drawn on hello, with the live runs.
  async function begin() {
    try { await fetchAll(); }
    catch (e) {
      world.setState(e.status === 401 ? { conn: 'session', list: 'failed' } : { list: 'failed' });
      return;
    }
    if (!sock) open(); else if (loaded) world.load(snapshot(), { list: '', conn: '' });
  }
  function open() {
    if (stopped) return;
    sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    sock.onopen = () => { backoff = BACKOFF_MS; };
    sock.onmessage = (ev) => { let f; try { f = JSON.parse(ev.data); } catch { return; } onFrame(f); };
    sock.onclose = (ev) => {
      sock = null;
      if (stopped) return;
      if (ev && ev.code === TOKEN_EXPIRED) { world.setState({ conn: 'session' }); return; }
      world.setState({ conn: 'offline' });
      reopened = true;
      const wait = backoff; backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
      setTimeout(open, wait);
    };
  }

  function onFrame(f) {
    if (!f || typeof f !== 'object') return;
    if (f.type === 'hello') { hello(f); return; }
    if (!loaded) { queue.push(f); return; }
    apply(f);
  }
  function hello(f) {
    live.clear();
    for (const r of Array.isArray(f.runs) ? f.runs : []) if (r && r.runId) live.set(r.runId, { ...r });
    if (!reopened) {
      world.load(snapshot(), { list: '', conn: '' });
      loaded = true;
      const q = queue.map((x, i) => [x, i]).sort((a, b) => ((a[0].seq ?? 0) - (b[0].seq ?? 0)) || a[1] - b[1]).map(([x]) => x);
      queue = [];
      q.forEach(apply);
      return;
    }
    // back after a drop: offline clears only once every source is read again
    reopened = false;
    fetchAll().then(() => { stale = false; world.load(snapshot(), { list: '', conn: '' }); }, () => { stale = true; world.setState({ conn: '', list: 'refresh' }); });
  }

  function moveTask(raw) {
    const t = taskOfLive(raw, { now: now(), projects: projects() });
    if (world.find(t.id)) world.move(t.id, t.case, t.detail, { title: t.title, cost: t.cost, unread: t.unread });
    else world.add(t);
  }
  function apply(f) {
    if (RUN_FRAMES.has(f.type) && f.runId) {
      let raw = live.get(f.runId);
      if (f.type === 'run-created') { raw = { ...f, type: undefined }; live.set(f.runId, raw); moveTask(raw); return; }
      if (!raw) return;
      if (f.type === 'state') Object.assign(raw, { status: f.status ?? raw.status, title: f.title || raw.title, totalCostUsd: f.totalCostUsd ?? raw.totalCostUsd, pauseReason: f.pauseReason ?? null, pauseDetail: f.pauseDetail ?? null, limitEngine: f.limitEngine ?? null, limitResetAt: f.limitResetAt ?? null, pipelineId: f.id || raw.pipelineId });
      else if (f.type === 'question') raw.pendingQuestion = { ...f, type: undefined };
      else if (f.type === 'question-resolved') raw.pendingQuestion = null;
      else if (f.type === 'title') raw.title = f.title || raw.title;
      else if (f.type === 'done' || f.type === 'error') {
        raw.status = f.type === 'error' ? 'error' : f.status || 'done';
        raw.pendingQuestion = null;
        if (raw.status === 'paused') Object.assign(raw, { pauseReason: f.reason ?? raw.pauseReason, pauseDetail: f.detail ?? raw.pauseDetail, limitEngine: f.limitEngine ?? raw.limitEngine, limitResetAt: f.limitResetAt ?? raw.limitResetAt });
        if (raw.status === 'error' || raw.status === 'failed') raw.unread = true;   // dev's lingering rule: failed while watched, until opened
      }
      moveTask(raw);
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
      try {
        const a = await get(SOURCES[source]);
        sources = { ...sources, [source]: a };
        world.load(partOf(source, a, { ...sources, hello: { runs: [...live.values()] } }, { now: now(), unread }), stale ? { list: '' } : undefined);
        stale = false;
      } catch { stale = true; world.setState({ list: 'refresh' }); }
    }, DEBOUNCE_MS);
  }

  begin();
  return {
    stop: () => { stopped = true; for (const k of Object.keys(timers)) clearTimeout(timers[k]); sock?.close(); },
    refresh,
    retry: () => { world.setState({ list: 'loading' }); return begin(); },
    // opening a chat clears its dot (D14)
    seen: () => { const was = unread.length; unread = unreadOf(unread, null, { openChat: openChat(), hidden: hidden() }); if (unread.length !== was && loaded) world.load({ chats: snapshot().chats }); },
  };
}
