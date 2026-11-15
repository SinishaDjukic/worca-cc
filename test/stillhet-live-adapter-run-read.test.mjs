// test/stillhet-live-adapter-run-read.test.mjs — a single run's settle reads its one row (GET /api/history/K/ID?row=1), never
// the whole history; id-less frames share one in-flight full read; a run's own state/done frame writes its status onto its
// saved row at once; spend (GET /api/budget) follows a run's or a chat turn's cost, and a 60 s tick while a run runs.
// Same fakes as test/stillhet-live-adapter.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLive, SOURCES as URLS } from '../ui/public/stillhet/live/live-adapter.mjs';
import { SOURCES, NOW } from './helpers/stillhet-live-fixture.mjs';

const withKeys = (h) => ({ ...h, pipelines: h.pipelines.map((p) => ({ ...p, projectKey: p.projectName === 'web' ? 'web-00000001' : 'api-00000002' })) });
const HISTORY = withKeys(SOURCES.history);
const ANSWER = { ...Object.fromEntries(Object.entries(URLS).map(([k, u]) => [u, SOURCES[k] ?? {}])), [URLS.history]: HISTORY };

function rig({ status = () => 200, answer = (u) => ANSWER[u] ?? {}, hold = () => null } = {}) {
  const calls = [], sockets = [], timers = [];
  const fetch = async (u, o = {}) => {
    calls.push({ u, method: o.method || 'GET' });
    const h = hold(u); if (h) await h;
    const s = status(u); if (s === 0) throw new TypeError('Failed to fetch');
    const a = answer(u);
    return { ok: s < 300, status: s, json: async () => structuredClone(a) };
  };
  class FakeSocket { constructor(url) { this.url = url; this.readyState = 1; sockets.push(this); } close() { this.closed = true; } send() {} }
  const tick = async (ms = 0) => { for (const t of timers.filter((x) => !x.done && x.ms <= ms)) { t.done = true; t.fn(); } for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const st = { list: 'loading', conn: '' }, log = [], rows = new Map();
  const world = {
    load: (parts, state) => { log.push(['load', Object.keys(parts).sort(), state]); if (parts.runs) { rows.clear(); for (const r of parts.runs) rows.set(r.id, { ...r }); } if (state) Object.assign(st, state); },
    setState: (s) => { Object.assign(st, s); },
    find: (id) => rows.get(id), add: (r) => { rows.set(r.id, { ...r }); return r; },
    move: (id, kase, detail, o = {}) => { const r = rows.get(id); if (r) Object.assign(r, { case: kase, detail }, o); },
  };
  const location = { protocol: 'http:', host: 'localhost:4931', reload: () => {} };
  const live = startLive({ fetch, WebSocket: FakeSocket, location, world, host: {}, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (i) => { if (timers[i - 1]) timers[i - 1].done = true; }, now: () => NOW });
  const frame = (f) => sockets.at(-1).onmessage({ data: JSON.stringify(f) });
  return { live, calls, sockets, tick, st, log, rows, frame };
}
const hello = { type: 'hello', bootId: 'b', runs: SOURCES.hello.runs };
const gets = (calls) => calls.filter((c) => c.method === 'GET').map((c) => c.u);
const ROW_A = `/api/history/web-00000001/pa?row=1`;
async function ready(o) { const r = rig(o); await r.tick(); r.frame(hello); await r.tick(); return r; }
const deferred = () => { let open; const p = new Promise((res) => { open = res; }); return { p, open }; };

test('a settle frame with pipelineId and key GETs its one row once and /api/history 0 times', async () => {
  const r = await ready();
  const n = r.calls.length;
  r.frame({ type: 'pipelines-changed', action: 'updated', runId: 'run-a', pipelineId: 'pa', key: 'web-00000001' });
  r.frame({ type: 'pipelines-changed', action: 'updated', pipelineId: 'pa' });
  await r.tick(250);
  const g = gets(r.calls.slice(n));
  assert.equal(g.filter((u) => u === ROW_A).length, 1);
  assert.equal(g.filter((u) => u === URLS.history).length, 0);
  assert.ok(g.includes(URLS.runLinks), 'the run links are read as today');
});

test('without f.key the key comes from the saved row; an unknown run with no key does a full read', async () => {
  const r = await ready();
  let n = r.calls.length;
  r.frame({ type: 'pipelines-changed', action: 'stopped', pipelineId: 'h1' });
  await r.tick(250);
  assert.deepEqual(gets(r.calls.slice(n)).filter((u) => u.startsWith('/api/history')), ['/api/history/api-00000002/h1?row=1']);
  n = r.calls.length;
  r.frame({ type: 'pipelines-changed', action: 'updated', pipelineId: 'nope' });
  await r.tick(250);
  assert.deepEqual(gets(r.calls.slice(n)).filter((u) => u.startsWith('/api/history')), [URLS.history]);
});

test('a 404, a 500 and a network failure of the row read each fall back to one full read', async () => {
  for (const s of [404, 500, 0]) {
    const r = await ready({ status: (u) => (u === ROW_A ? s : 200) });
    const n = r.calls.length;
    r.frame({ type: 'pipelines-changed', action: 'updated', pipelineId: 'pa', key: 'web-00000001' });
    await r.tick(250); await r.tick(250);
    const g = gets(r.calls.slice(n)).filter((u) => u.startsWith('/api/history'));
    assert.deepEqual(g, [ROW_A, URLS.history], `status ${s}`);
  }
});

test('3 id-less frames during an in-flight full read give 2 GETs of /api/history in total', async () => {
  let gate = null;
  const r = await ready({ hold: (u) => (u === URLS.history && gate ? gate.p : null) });
  gate = deferred();
  const n = r.calls.length;
  r.frame({ type: 'pipelines-changed', action: 'updated' });
  await r.tick(250);   // the first full read is out
  for (let i = 0; i < 3; i++) { r.frame({ type: 'pipelines-changed', action: 'labels' }); await r.tick(250); }
  const first = gate; gate = null; first.open();
  await r.tick(); await r.tick(250); await r.tick(250);
  assert.equal(gets(r.calls.slice(n)).filter((u) => u === URLS.history).length, 2);
});

test('a settle asked while a full read is out is not lost: one more full read follows the one out', async () => {
  let gate = null;
  const r = await ready({ hold: (u) => (u === URLS.history && gate ? gate.p : null) });
  gate = deferred();
  const n = r.calls.length;
  r.frame({ type: 'pipelines-changed', action: 'updated' });
  await r.tick(250);   // the full read is out
  r.frame({ type: 'pipelines-changed', action: 'updated', pipelineId: 'pa', key: 'web-00000001' });
  await r.tick(250);
  const first = gate; gate = null; first.open();
  await r.tick(); await r.tick(250); await r.tick(250);
  const g = gets(r.calls.slice(n)).filter((u) => u.startsWith('/api/history'));
  assert.deepEqual(g, [URLS.history, URLS.history]);
});

test('a row read that lands while a reconnect\'s full read is out does not make that newer list be dropped', async () => {
  let gate = null, fresh = false;
  const NEWCOMER = { id: 'pn', title: 'Newcomer', status: 'done', projectKey: 'web-00000001', projectName: 'web', startedAt: new Date(NOW).toISOString(), mtime: NOW };
  const answer = (u) => (u === ROW_A ? { pipeline: { ...HISTORY.pipelines[0], status: 'done' } } : u === URLS.history && fresh ? { ...HISTORY, pipelines: [...HISTORY.pipelines, NEWCOMER] } : ANSWER[u] ?? {});
  const r = await ready({ answer, hold: (u) => (u === URLS.history && gate ? gate.p : null) });
  gate = deferred(); fresh = true;
  r.frame(hello);   // back after a drop: every source is read again, history held
  await r.tick();
  r.frame({ type: 'pipelines-changed', action: 'updated', pipelineId: 'pa', key: 'web-00000001' });
  await r.tick(250);   // the row read lands first
  const first = gate; gate = null; first.open();
  await r.tick(); await r.tick();
  assert.equal(r.live.chat.runOf('pn').projectKey, 'web-00000001', 'the reconnect list landed');
});

test('a settle while a reconnect\'s full read is out reads no row: one more full read follows the held list', async () => {
  let gate = null;
  const r = await ready({ hold: (u) => (u === URLS.history && gate ? gate.p : null) });
  gate = deferred();
  const n = r.calls.length;
  r.frame(hello);   // back after a drop: the reconnect's list is out, and may predate the settle below
  await r.tick();
  r.frame({ type: 'done', runId: 'run-a', status: 'done' });
  r.frame({ type: 'pipelines-changed', action: 'updated', runId: 'run-a', pipelineId: 'pa', key: 'web-00000001' });
  await r.tick(250);
  assert.ok(!gets(r.calls.slice(n)).includes(ROW_A), 'no row read while the reconnect list is out');
  const first = gate; gate = null; first.open();
  await r.tick(); await r.tick(250); await r.tick(250);
  // the reconnect's full re-read reads the archived feed too (F-a4-07); this counts the active list's reads
  assert.deepEqual(gets(r.calls.slice(n)).filter((u) => u.startsWith('/api/history') && u !== URLS.archived), [URLS.history, URLS.history]);
});

test('two held reconnect reads: a settle after the first lands waits for the second, and its status is not reverted', async () => {
  const held = [];
  let settled = false;
  const answer = (u) => (u === URLS.history && settled ? { ...HISTORY, pipelines: HISTORY.pipelines.map((p) => (p.id === 'pa' ? { ...p, status: 'done' } : p)) } : u === ROW_A ? { pipeline: { ...HISTORY.pipelines.find((p) => p.id === 'pa'), status: 'done' } } : ANSWER[u] ?? {});
  let holding = false;
  const r = await ready({ answer, hold: (u) => { if (u !== URLS.history || !holding) return null; const d = deferred(); held.push(d); return d.p; } });
  holding = true;
  r.frame(hello); await r.tick();   // the first reconnect read is out
  r.frame(hello); await r.tick();   // a second one, beside it
  holding = false;
  assert.equal(held.length, 2);
  const n = r.calls.length;
  held[0].open(); await r.tick(); await r.tick();   // the first lands; the second is still out
  r.frame({ type: 'done', runId: 'run-a', status: 'done' });
  settled = true;
  r.frame({ type: 'pipelines-changed', action: 'updated', runId: 'run-a', pipelineId: 'pa', key: 'web-00000001' });
  await r.tick(250);
  assert.ok(!gets(r.calls.slice(n)).includes(ROW_A), 'no row read while a reconnect list is still out');
  held[1].open(); await r.tick(); await r.tick(250); await r.tick(250);
  assert.deepEqual(gets(r.calls.slice(n)).filter((u) => u.startsWith('/api/history')), [URLS.history], 'one more full read after the last one out');
  const t = r.rows.get('pa') || r.rows.get('run-a');
  assert.equal(t.case, r.rows.get('h2').case, `the saved row reads done like h2 (case ${t.case})`);
});

test('a per-run read asked while a full read is pending is dropped', async () => {
  const r = await ready();
  const n = r.calls.length;
  r.frame({ type: 'pipelines-changed', action: 'updated' });
  r.frame({ type: 'pipelines-changed', action: 'updated', pipelineId: 'pa', key: 'web-00000001' });
  await r.tick(250); await r.tick(250);
  const g = gets(r.calls.slice(n)).filter((u) => u.startsWith('/api/history'));
  assert.deepEqual(g, [URLS.history]);
});

test('a row read older than a landed list is dropped', async () => {
  let gate = null;
  const answer = (u) => (u === ROW_A ? { pipeline: { ...HISTORY.pipelines[0], title: 'Old row' } } : u === URLS.history ? withKeys({ pipelines: [{ ...SOURCES.history.pipelines[0], title: 'New list' }] }) : ANSWER[u] ?? {});
  const r = await ready({ answer, hold: (u) => (u === ROW_A && gate ? gate.p : null) });
  gate = deferred();
  r.frame({ type: 'pipelines-changed', action: 'updated', pipelineId: 'pa', key: 'web-00000001' });
  await r.tick(250);   // the row read is out
  r.frame({ type: 'pipelines-changed', action: 'updated' });
  await r.tick(250);   // a full list lands after it
  const before = r.log.length;
  gate.open(); await r.tick();
  assert.equal(r.log.length, before, 'nothing drawn from the older row');
  assert.equal(r.live.chat.runOf('h1').pipelineId, 'h1', 'h1 is not in the new list: runOf falls back to the id it was given');
  assert.equal(r.live.chat.runOf('h1').projectKey, '', 'the older row read did not bring the old list back');
});

test('a row read merges its row: it replaces the element with its id, or puts a new one first (newest first)', async () => {
  const answer = (u) => (u === ROW_A ? { pipeline: { ...HISTORY.pipelines[0], status: 'done', title: 'Read back' } } : u === '/api/history/web-00000001/pn?row=1' ? { pipeline: { id: 'pn', title: 'Newcomer', status: 'done', projectKey: 'web-00000001', projectName: 'web', startedAt: new Date(NOW).toISOString(), mtime: NOW } } : ANSWER[u] ?? {});
  const r = await ready({ answer });
  r.frame({ type: 'pipelines-changed', action: 'updated', pipelineId: 'pa', key: 'web-00000001' });
  r.frame({ type: 'pipelines-changed', action: 'updated', pipelineId: 'pn', key: 'web-00000001' });
  await r.tick(250);
  const loads = r.log.filter((x) => x[0] === 'load');
  assert.ok(loads.length >= 2, 'drawn through the history part');
  assert.equal(r.live.chat.runOf('pn').pipelineId, 'pn', 'the newcomer is in the saved rows');
  assert.equal(r.live.chat.runOf('pn').projectKey, 'web-00000001');
});

test('a done frame for a saved pipeline writes the status onto its row before any GET resolves, and a later snapshot draw keeps it', async () => {
  let block = false;
  const r = await ready({ hold: () => (block ? new Promise(() => {}) : null) });
  block = true;
  r.frame({ type: 'state', runId: 'run-b', id: 'pb', status: 'running' });
  r.frame({ type: 'done', runId: 'run-a', seq: 9, status: 'done' });
  r.frame({ type: 'pipelines-changed', action: 'updated', removedRunIds: ['run-zz'] });   // nothing removed: no draw
  r.frame({ type: 'run-created', runId: 'run-q', pipelineId: 'pb', title: 'Again', status: 'starting' });   // supersedes run-b: a snapshot draw
  const t = r.rows.get('pa') || r.rows.get('run-a');
  assert.ok(t, 'the run keeps a row');
  assert.equal(t.case, r.rows.get('h2').case, `the saved row reads done like h2, not paused (case ${t.case})`);
});

test('with no saved row the done frame moves the task at once', async () => {
  let block = false;
  const r = await ready({ hold: () => (block ? new Promise(() => {}) : null) });
  block = true;
  r.frame({ type: 'state', runId: 'run-b', status: 'running' });
  r.frame({ type: 'done', runId: 'run-b', seq: 9, status: 'error' });
  assert.equal(r.rows.get('run-b').case, 'failed');
});

test('a fresh run with no saved row that ends done or stopped keeps its row, settled, until its row read lands', async () => {
  let block = false;
  const r = await ready({ hold: () => (block ? new Promise(() => {}) : null) });
  block = true;
  for (const [id, pid, status, kase] of [['run-n', 'pn', 'done', /^finished/], ['run-s', 'ps', 'stopped', /^stopped$/]]) {
    r.frame({ type: 'run-created', runId: id, title: 'Fresh', status: 'starting' });
    r.frame({ type: 'state', runId: id, id: pid, status: 'running' });
    r.frame({ type: 'state', runId: id, id: pid, status });
    r.frame({ type: 'done', runId: id, seq: 9, status });
    const t = r.rows.get(id) || r.rows.get(pid);
    assert.ok(t, `${status}: the run keeps its row while its read is out`);
    assert.match(t.case, kase, `${status}: its settled case (case ${t.case})`);
  }
});

test('a pipelines-changed with pipelineId and an ask-done each re-read /api/budget; an id-less one does not', async () => {
  const r = await ready();
  const count = (n) => gets(r.calls.slice(n)).filter((u) => u === URLS.budget).length;
  let n = r.calls.length;
  r.frame({ type: 'pipelines-changed', action: 'labels' });
  await r.tick(250);
  assert.equal(count(n), 0);
  n = r.calls.length;
  r.frame({ type: 'pipelines-changed', action: 'updated', pipelineId: 'pa', key: 'web-00000001' });
  await r.tick(250);
  assert.equal(count(n), 1);
  n = r.calls.length;
  r.frame({ type: 'ask-done', threadId: 'ask_2', messageId: 'm', seq: 1 });
  await r.tick(250);
  assert.equal(count(n), 1);
});

test('the live tick re-reads the budget every 60 s only while a run is running, and not while the socket is closed', async () => {
  const r = await ready();
  const count = (n) => gets(r.calls.slice(n)).filter((u) => u === URLS.budget).length;
  let n = r.calls.length;
  await r.tick(60000); await r.tick(250);
  assert.equal(count(n), 1, 'run-a and run-b are running');
  n = r.calls.length;
  r.sockets.at(-1).readyState = 3;
  await r.tick(60000); await r.tick(250);
  assert.equal(count(n), 0, 'the socket is closed');
  r.sockets.at(-1).readyState = 1;
  r.frame({ type: 'done', runId: 'run-a', status: 'done' });
  r.frame({ type: 'done', runId: 'run-b', status: 'done' });
  n = r.calls.length;
  await r.tick(60000); await r.tick(250);
  assert.equal(count(n), 0, 'no run is running');
});

test('F-a4-03: a state frame that first names a run\'s pipeline id hands it to task-live; a reconnect hello that names it does too', async () => {
  const run = (pipelineId) => ({ runId: 'run-x', pipelineId, projectDir: '/src/web', title: 'New', status: 'running', pendingQuestion: null, startedAt: SOURCES.hello.runs[1].startedAt });
  const r = rig(); await r.tick(); r.frame({ ...hello, runs: [...hello.runs, run(null)] }); await r.tick();
  await r.live.task.open('run-x'); await r.tick();
  assert.ok(!gets(r.calls).some((u) => /\/(runs|pipelines)\/run-x\/(?!live-diff)/.test(u)), 'nothing keyed by the run id in place of the pipeline id');
  assert.equal(r.live.task.detail('run-x').liveRunning, false);
  r.frame({ type: 'state', runId: 'run-x', id: 'px', status: 'running', steps: [] }); await r.tick();
  assert.equal(r.live.task.resolve('run-x').pipelineId, 'px');
  for (const u of ['/api/runs/px/artifacts', '/api/pipelines/px/setup', '/api/runs/px/sessions']) assert.ok(gets(r.calls).includes(u), u);
  assert.equal(r.live.task.detail('run-x').liveRunning, true, 'Pause and Stop once the pipeline is known');
  // the reconnect: the frame was lost, the next hello names the pipeline
  const y = rig(); await y.tick(); y.frame({ ...hello, runs: [...hello.runs, run(null)] }); await y.tick();
  await y.live.task.open('run-x'); await y.tick();
  y.frame({ ...hello, runs: [...hello.runs, run('py')] }); await y.tick();
  assert.ok(gets(y.calls).includes('/api/runs/py/artifacts'), 'read with the pipeline id after the hello');
});

test('F-7a-02: a run-pipeline that repeats the known pipeline draws and reads nothing', async () => {
  const r = await ready();
  r.frame({ type: 'run-created', runId: 'run-n', title: 'Fresh', status: 'starting', projectDir: '/src/web', startedAt: new Date(NOW).toISOString() });
  r.frame({ type: 'state', runId: 'run-n', id: 'pn', status: 'running' });
  await r.tick(250); await r.tick(250);
  const before = { draws: r.log.length, calls: r.calls.length, rows: structuredClone([...r.rows]), run: structuredClone(r.live.chat.runOf('run-n')) };
  assert.ok(before.run, 'the run is known before the frame');
  r.frame({ type: 'run-pipeline', runId: 'run-n', pipelineId: 'pn' });
  await r.tick(250); await r.tick(250);
  assert.equal(r.log.length, before.draws, 'no draw');
  assert.deepEqual(r.calls.slice(before.calls), [], 'nothing read (task.learned asks nothing again)');
  assert.deepEqual([...r.rows], before.rows, 'the rows are unchanged');
  assert.deepEqual(r.live.chat.runOf('run-n'), before.run, 'the live run record is unchanged');
  r.frame({ type: 'run-pipeline', runId: 'run-unknown', pipelineId: 'pu' });
  await r.tick(250);
  assert.equal(r.log.length, before.draws, 'a run-pipeline for an unknown run draws nothing');
  assert.deepEqual(r.calls.slice(before.calls), [], 'and reads nothing');
});

const at = new Date(NOW).toISOString();
const created = (runId, title) => ({ type: 'run-created', runId, title, status: 'starting', projectDir: '/src/web', startedAt: at });
test('F-7a-02: Resume in the server\'s order (run-created without pipelineId, then run-pipeline) replaces the paused run: one row, never Paused', async () => {
  const r = rig(); await r.tick();
  r.frame({ ...hello, runs: [...hello.runs, { runId: 'run-p', pipelineId: 'pp', projectDir: '/src/web', title: 'Resumed', status: 'paused', pauseReason: 'paused by you', startedAt: at }] });
  await r.tick();
  assert.ok(r.rows.get('run-p'), 'the paused run is a row');
  r.frame(created('run-q', 'Resumed'));
  r.frame({ type: 'run-pipeline', runId: 'run-q', pipelineId: 'pp' });
  assert.equal(r.rows.get('run-p'), undefined, 'the old run is gone');
  assert.equal(r.rows.get('run-q').case, 'starting');
  assert.ok(![...r.rows.values()].some((x) => x.title === 'Resumed' && x.case.startsWith('paused')), 'no row reads Paused');
  assert.deepEqual([...r.rows.values()].filter((x) => x.title === 'Resumed').map((x) => x.id), ['run-q']);
  assert.equal(r.live.chat.runOf('pp').pipelineId, 'pp', 'task-live learned the pipeline');
});

test('F-7a-02: run-pipeline naming a saved paused row keeps the pipeline once, live', async () => {
  const r = await ready();
  assert.ok(r.rows.get('h1'), 'the saved paused row is a row');
  r.frame(created('run-r', 'Old pause'));
  r.frame({ type: 'run-pipeline', runId: 'run-r', pipelineId: 'h1' });
  assert.equal(r.rows.get('h1'), undefined, 'the saved row is kept once');
  assert.ok(r.rows.get('run-r'), 'live');
});

test('F-7a-02: Stop of a paused run settles at once: its done(stopped) moves its row at once (no Paused, out of Needs you) and reads its saved row (GET /api/history/KEY/ID?row=1)', async () => {
  const r = rig(); await r.tick();
  r.frame({ ...hello, runs: hello.runs.map((x) => (x.runId === 'run-a' ? { ...x, status: 'paused', pauseReason: 'paused by you', pendingQuestion: null } : x)) });
  await r.tick();
  assert.ok(r.rows.get('run-a').case.startsWith('paused'), 'paused before the stop');
  const n = r.calls.length, loads = r.log.filter((x) => x[0] === 'load').length;
  r.frame({ type: 'state', runId: 'run-a', id: 'pa', status: 'stopped' });
  r.frame({ type: 'done', runId: 'run-a', status: 'stopped' });
  assert.equal(r.log.filter((x) => x[0] === 'load').length, loads, 'moved, not drawn: no runs draw swaps its row id under a chat card on run-a before the read');
  assert.ok(r.rows.get('run-a'), 'the row keeps its run id until its saved row is read');
  const held = ['run-a', 'pa'].filter((id) => r.rows.get(id));
  assert.equal(held.length, 1, 'one row for the pipeline');
  const row = r.rows.get(held[0]);
  assert.equal(row.case, 'stopped', `reads Stopped, out of Needs you (case ${row.case})`);
  r.frame({ type: 'pipelines-changed', action: 'stopped', pipelineId: 'pa' });
  await r.tick(250);
  assert.equal(gets(r.calls.slice(n)).filter((u) => u === ROW_A).length, 1, 'one row read for the settle and the server\'s frame');
  assert.equal(gets(r.calls.slice(n)).filter((u) => u === URLS.history).length, 0);
});

test('F-7a-02: a settled run with no known project key reads the whole history once', async () => {
  const r = rig(); await r.tick();
  r.frame({ ...hello, runs: [...hello.runs, { runId: 'run-w', pipelineId: 'pw', projectDir: '/elsewhere', title: 'Workspace', status: 'running', startedAt: at }] });
  await r.tick();
  const n = r.calls.length;
  r.frame({ type: 'done', runId: 'run-w', status: 'done' });
  await r.tick(250);
  assert.deepEqual(gets(r.calls.slice(n)).filter((u) => u.startsWith('/api/history')), [URLS.history]);
});
