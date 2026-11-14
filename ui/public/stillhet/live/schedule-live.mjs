// ui/public/stillhet/live/schedule-live.mjs — every live Schedules request (D4), as task-live.mjs is for Tasks: one frozen
// table of actions, `act` that posts and answers {ok, …} and never writes the store (the server's frame does, D5),
// `detail` for a schedule page's runs, and `deferDelete` for Delete's Undo window (D8). No other Stillhet file names
// /api/schedules (outside this folder).
import { ruleOf, retimed, endOf } from './schedule-rule.mjs';
import { runsOf } from './live-map.mjs';

const enc = encodeURIComponent;
const str = (v) => (typeof v === 'string' ? v : '');
const one = (a) => `/api/schedules/${enc(a.id)}`;
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
/** A draft's fields as dev's PATCH body: a series' rule and Expert facts, a one-off ticket's time or run-after (D6, D11).
 *  The new rule keeps the saved rule's end (`draft.rule`); a time-only change (`onlyAt`) moves the saved rule's time and
 *  keeps the rest, so a rule no picker word reads (every 2 days) can still change its time. */
export function patchOf(a) {
  const d = a.draft || {};
  if (a.kind === 'once') return d.after ? { after: d.after } : d.scheduledFor ? { scheduledFor: d.scheduledFor } : {};
  const out = {}, saved = obj(d.rule);
  if (d.every !== undefined || d.at !== undefined) {
    if (d.onlyAt && saved?.time) out.rule = retimed(saved, d.at);
    else { const r = ruleOf({ every: d.every, at: d.at, tz: d.tz }); out.rule = r.error || !saved?.end ? r : { ...r, end: saved.end }; }
  }
  if (d.overlap !== undefined) out.overlap = d.overlap;
  if (d.maxFailures !== undefined) out.maxFailures = d.maxFailures;
  if (d.ifMissed !== undefined) out.ifMissed = d.ifMissed;
  if (d.graceMin !== undefined) out.graceMin = d.graceMin;
  return out;
}
/** New schedule's body for dev's POST /api/run (D9): the project (or noProject, only when asked for), the run's own fields
 *  (workflowId, engine, sourceBranch, sync, PR), what to do, and the repeat: its rule with its end, overlap and failures. */
export function newBodyOf(a) {
  const r = ruleOf({ every: a.every, at: a.at, tz: a.tz }), end = obj(a.end);
  return { ...(a.noProject ? { noProject: true } : a.projectDir ? { projectDir: a.projectDir } : {}), ...(obj(a.run) || {}),
    prompt: str(a.prompt), title: str(a.title) || undefined,
    repeat: { rule: r.error || !end ? r : { ...r, end }, ...(a.overlap ? { overlap: a.overlap } : {}), ...(Number.isInteger(a.maxFailures) ? { maxFailures: a.maxFailures } : {}) } };
}
// id → [words for "Could not …", args → [method, url, body]]: the repaint table of the plan, one row per action
export const SCHEDULE_ACTIONS = Object.freeze({
  run: ['run it now', (a) => ['POST', `${one(a)}/run-now`, {}]],
  stop: ['stop its task', (a) => ['POST', '/api/stop', { pipelineId: a.pipelineId }]],
  pause: ['pause it', (a) => ['POST', `${one(a)}/pause`, {}]],
  resume: ['resume it', (a) => ['POST', `${one(a)}/resume`, {}]],
  skip: ['skip next time', (a) => ['POST', `${one(a)}/skip-next`, {}]],
  keep: ['keep next time', (a) => ['POST', `${one(a)}/keep-next`, {}]],
  delete: ['delete it', (a) => ['DELETE', one(a), undefined]],
  save: ['save the changes', (a) => ['PATCH', one(a), patchOf(a)]],
  new: ['create the schedule', (a) => ['POST', '/api/run', newBodyOf(a)]],
});
export const wordsOf = (id) => SCHEDULE_ACTIONS[id]?.[0] || id;
const NOT_ANSWERING = 'Worca is not answering';
const ruleError = (body) => (body?.rule?.error || body?.repeat?.rule?.error || '');

export function startScheduleLive({ fetch, setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout, on = () => {}, tasksOf = () => [], now = Date.now } = {}) {
  const busy = new Set(), cache = new Map(), got = new Map(), listeners = new Set();
  let held = null;   // the one Delete waiting out its Undo window
  const notify = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } };

  async function request(method, url, body, extra = {}) {
    let r;
    try { r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...extra }); }
    catch { return { ok: false, status: 0, error: NOT_ANSWERING }; }
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    if (!r.ok) return { ok: false, status: r.status, error: str(data?.error) || `HTTP ${r.status}`, ...(data?.code ? { code: data.code } : {}) };
    return { ok: true, body: data };
  }

  /** One Schedules action. One request per action and schedule at a time; never retried. → {ok, body} | {ok:false, status, error} */
  async function act(id, args = {}) {
    const def = SCHEDULE_ACTIONS[id];
    if (!def) return { ok: false, status: 0, error: 'this action is unknown' };
    const key = `${id}:${str(args.id) || str(args.pipelineId) || ''}`;
    if (busy.has(key)) return { ok: false, status: 0, error: 'busy' };
    const [method, url, body] = def[1](args);
    const bad = ruleError(body);
    if (bad) return { ok: false, status: 0, error: bad };
    if (id === 'stop' && !args.pipelineId) return { ok: false, status: 0, error: 'its task is not running' };
    busy.add(key);
    try {
      const r = await request(method, url, body);
      // run-now answers 200 for a fire that could not start (its ticket failed at once): that is a refusal, not "Started"
      if (id === 'run' && r.ok && r.body?.status === 'failed') return { ok: false, status: 200, error: str(r.body.failReason) || 'it could not start' };
      return r;
    } finally { busy.delete(key); }
  }

  /** A schedule's own answer (its runs are `history`), read once until the next schedules-changed. → {item, history, notifications} | null */
  function detail(id) {
    if (!cache.has(id)) {
      const p = request('GET', one({ id })).then((x) => (x.ok ? x.body : null));
      cache.set(id, p);
      // a failed read stays failed until the next schedules-changed: the page shows no runs, and is never asked in a loop
      p.then((v) => { if (cache.get(id) === p) { got.set(id, v); notify(); } });
    }
    return cache.get(id);
  }

  /** Delete after the Undo window (D8): the DELETE is sent once, at expiry, when the next notice replaces this one
   *  (flush), or on pagehide; undo() before that sends nothing. `done` answers the act's result, or {undone: true}. */
  function deferDelete(id, { ms = 5000 } = {}) {
    if (held) held.flush();
    let settle, timer = 0, state = 'held';
    const done = new Promise((r) => { settle = r; });
    const h = {
      id, done,
      undo() { if (state !== 'held') return false; state = 'undone'; clearTimeout(timer); if (held === h) held = null; settle({ undone: true }); return true; },
      flush(extra) {
        if (state !== 'held') return; state = 'sent'; clearTimeout(timer); if (held === h) held = null;
        const [method, url] = SCHEDULE_ACTIONS.delete[1]({ id });
        request(method, url, undefined, extra).then(settle);
      },
    };
    held = h;
    timer = setTimeout(() => h.flush(), ms);
    return h;
  }
  on('pagehide', () => { if (held) held.flush({ keepalive: true }); });

  /** A schedule's runs for its page, its card and its row (runsOf over the store's tasks); null until its detail is read. */
  function runs(id) {
    if (!cache.has(id)) detail(id);
    const v = got.get(id);
    return v ? runsOf(v.history, tasksOf(), { now: now() }) : null;
  }

  return {
    act, detail, deferDelete, runs, words: wordsOf, endOf,   // endOf: the New schedule form's end words (centers.js is a classic script)
    pending: () => held,
    frame(f) { if (f && f.type === 'schedules-changed') { cache.clear(); notify(); } },   // `got` stays: the runs drawn until the new read lands
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
