// test/stillhet-live-adapter.test.mjs — the live adapter's I/O (ui/public/stillhet/live/live-adapter.mjs) with a fake fetch,
// WebSocket and timers, and an in-memory world that counts its writes the way shell/world.js fires them (D8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLive, SOURCES as URLS } from '../ui/public/stillhet/live/live-adapter.mjs';
import { SOURCES, NOW } from './helpers/stillhet-live-fixture.mjs';
const ANSWER = { [URLS.history]: SOURCES.history, [URLS.threads]: SOURCES.threads, [URLS.groups]: SOURCES.groups, [URLS.schedules]: SOURCES.schedules, [URLS.projects]: SOURCES.projects, [URLS.sync]: SOURCES.sync, [URLS.budget]: SOURCES.budget, [URLS.actions]: SOURCES.actions, [URLS.notifications]: SOURCES.notifications, [URLS.away]: SOURCES.away, [URLS.settings]: SOURCES.settings, [URLS.runLinks]: SOURCES.runLinks };

function rig({ status = () => 200, answer = (u) => ANSWER[u] ?? {}, hold = () => null, random, parts = null, onLoad = () => {} } = {}) {
  const calls = [], sockets = [], timers = [];
  const fetch = async (u, o = {}) => { calls.push({ u, method: o.method || 'GET', ...(o.body ? { body: JSON.parse(o.body) } : {}) }); const h = hold(u); if (h) await h; const s = status(u); const a = answer(u); return { ok: s < 300, status: s, json: async () => a }; };
  class FakeSocket { constructor(url) { this.url = url; sockets.push(this); } close() { this.closed = true; } send() {} }
  const tick = async (ms = 0) => { for (const t of timers.filter((x) => !x.done && x.ms <= ms)) { t.done = true; t.fn(); } for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const st = { list: 'loading', conn: '' }, log = [], rows = new Map();
  const world = {
    load: (parts, state) => { onLoad(parts); log.push(['load', Object.keys(parts).sort(), state]); if (parts.runs) { rows.clear(); for (const r of parts.runs) rows.set(r.id, { ...r }); } if (state) Object.assign(st, state); log.push(['onChange']); },
    setState: (s) => { Object.assign(st, s); log.push(['setState', { ...s }]); log.push(['onChange']); },
    find: (id) => rows.get(id), add: (r) => { rows.set(r.id, { ...r }); log.push(['onMove', r.id]); return r; },
    move: (id, kase, detail, o = {}) => { const r = rows.get(id); if (!r) return; Object.assign(r, { case: kase, detail }, o); log.push(['onMove', id]); },
    ...(parts ? { part: (n) => parts[n] } : {}),   // the store's mapped parts, when a test needs them
  };
  const host = { flags: [], flagsChanged: (f) => host.flags.push(f) };
  const location = { protocol: 'http:', host: 'localhost:4931', reload: () => calls.push('reload') };
  const live = startLive({ fetch, WebSocket: FakeSocket, location, world, host, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (i) => { if (timers[i - 1]) timers[i - 1].done = true; }, now: () => NOW, ...(random ? { random } : {}) });
  const frame = (sock, f) => sock.onmessage({ data: JSON.stringify(f) });
  return { live, calls, sockets, tick, st, log, rows, host, frame };
}
const changes = (log) => log.filter((x) => x[0] === 'onChange').length;
const hello = { type: 'hello', bootId: 'b', runs: SOURCES.hello.runs };

const gets = (calls) => calls.filter((c) => c.method === 'GET').map((c) => c.u);
test('first load: the D10 GETs only, then the socket; hello gives 1 load and 1 onChange (data and list together)', async () => {
  const r = rig();
  await r.tick();
  assert.deepEqual(r.calls.map((c) => c.u).sort(), Object.values(URLS).sort());
  assert.ok(r.calls.every((c) => c.method === 'GET'), 'the PR lookup waits for the socket: its answer comes as frames');
  assert.equal(r.sockets.length, 1);
  assert.equal(r.sockets[0].url, 'ws://localhost:4931/ws');
  assert.equal(changes(r.log), 0, 'nothing drawn before the snapshot');
  r.sockets[0].onopen?.();
  r.frame(r.sockets[0], hello);
  await r.tick();
  assert.deepEqual(r.log.filter((x) => x[0] === 'load').map((x) => x[2]), [{ list: '', conn: '' }]);
  assert.equal(changes(r.log), 1);
  assert.equal(r.st.list, '');
  assert.ok(r.rows.get('run-a'));
});

test('a state frame moves one task: 1 onMove, 0 onChange; a frame before hello applies after it, in seq order', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], { type: 'title', runId: 'run-b', seq: 3, title: 'Third' });
  r.frame(r.sockets[0], { type: 'title', runId: 'run-b', seq: 2, title: 'Second' });
  r.frame(r.sockets[0], hello);
  await r.tick();
  assert.equal(r.rows.get('run-b').title, 'Third', 'seq 2 then seq 3');
  const before = changes(r.log);
  r.frame(r.sockets[0], { type: 'state', runId: 'run-b', seq: 4, status: 'paused', pauseReason: 'cost cap' });
  assert.equal(changes(r.log), before);
  assert.equal(r.log.at(-1)[0], 'onMove');
  assert.equal(r.rows.get('run-b').case, 'capped');
  r.frame(r.sockets[0], { type: 'done', runId: 'run-b', seq: 5, status: 'error' });
  assert.equal(r.rows.get('run-b').case, 'failed', 'failed while watched: unread, so it needs you');
  r.frame(r.sockets[0], { type: 'run-created', runId: 'run-z', title: 'New', status: 'starting', projectDir: '/src/web', startedAt: new Date(NOW).toISOString() });
  assert.equal(r.rows.get('run-z').case, 'starting');
});

test('F-7a-03: run-created draws the started task at once (one load with runs, an onChange), and its later frames keep it one row', async () => {
  let saved = false;
  const FRESH = { id: 'pn', title: 'Fresh', status: 'running', projectName: 'web', startedAt: new Date(NOW).toISOString(), mtime: NOW };
  const r = rig({ answer: (u) => (u === URLS.history && saved ? { ...SOURCES.history, pipelines: [FRESH, ...SOURCES.history.pipelines] } : ANSWER[u] ?? {}) });
  await r.tick();
  r.frame(r.sockets[0], hello);
  await r.tick();
  r.frame(r.sockets[0], { type: 'run-created', runId: 'run-n', title: 'Fresh', status: 'starting', projectDir: '/src/web', startedAt: new Date(NOW).toISOString() });
  const [load, change] = r.log.slice(-2);
  assert.equal(load[0], 'load');
  assert.ok(load[1].includes('runs'), 'the runs part is drawn');
  assert.deepEqual(change, ['onChange'], 'the Tasks list repaints');
  assert.equal(r.rows.get('run-n').case, 'starting');
  saved = true;
  r.frame(r.sockets[0], { type: 'run-pipeline', runId: 'run-n', pipelineId: 'pn' });
  r.frame(r.sockets[0], { type: 'state', runId: 'run-n', id: 'pn', status: 'running' });
  r.frame(r.sockets[0], { type: 'pipelines-changed', action: 'updated', pipelineId: 'pn' });
  await r.tick(250); await r.tick(250);
  const fresh = [...r.rows.values()].filter((x) => x.title === 'Fresh');
  assert.deepEqual(fresh.map((x) => x.id), ['run-n'], 'one row, the live run');
});

const arch = (id, over = {}) => ({ id, title: `Arch ${id}`, status: 'done', archived: true, projectName: 'web', startedAt: new Date(NOW - 7200000).toISOString(), mtime: NOW - 3600000, ...over });
test('F-a4-07: the first load reads /api/history?archived=1 and the store holds its rows archived (count = the API\'s)', async () => {
  const N = 3;
  const r = rig({ answer: (u) => (u === URLS.archived ? { pipelines: Array.from({ length: N }, (_, i) => arch(`x${i}`)) } : ANSWER[u] ?? {}) });
  await r.tick();
  assert.equal(URLS.archived, '/api/history?archived=1');
  assert.equal(gets(r.calls).filter((u) => u === URLS.archived).length, 1);
  r.frame(r.sockets[0], hello);
  await r.tick();
  assert.equal([...r.rows.values()].filter((x) => x.archived === true).length, N);
});

test('F-a4-07: an archive, restore or Undo (pipelines-changed bulk-archive / bulk-restore / bulk-delete / deleted / restored) reads the archived feed again, debounced once; updated / labels / stopped do not; refresh(\'archived\') reads it once', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], hello);
  await r.tick();
  const count = (n) => gets(r.calls.slice(n)).filter((u) => u === URLS.archived).length;
  for (const action of ['bulk-archive', 'bulk-restore', 'bulk-delete', 'deleted', 'restored']) {
    const n = r.calls.length;
    r.frame(r.sockets[0], { type: 'pipelines-changed', action, ...(action === 'deleted' || action === 'restored' ? { pipelineId: 'h1' } : {}) });
    r.frame(r.sockets[0], { type: 'pipelines-changed', action });
    await r.tick(250);
    assert.equal(count(n), 1, action);
  }
  for (const action of ['updated', 'labels', 'stopped', 'tags']) {
    const n = r.calls.length;
    r.frame(r.sockets[0], { type: 'pipelines-changed', action, ...(action === 'stopped' ? { pipelineId: 'h1' } : {}) });
    await r.tick(250);
    assert.equal(count(n), 0, action);
  }
  const n = r.calls.length;
  r.live.refresh('archived'); r.live.refresh('archived');
  await r.tick(250);
  assert.equal(count(n), 1, 'the Archived view opening');
});

test('F-a4-07: Undo after archiving a live run\'s row sends restore with its pipeline id and brings the row back, not archived', async () => {
  let phase = 'live';
  const PB = { id: 'pb', title: 'Busy', status: 'paused', projectName: 'web', startedAt: SOURCES.hello.runs[1].startedAt, mtime: NOW - 60000 };
  const answer = (u) => {
    if (u === '/api/runs/bulk') return { done: [{ pipelineId: 'pb' }] };
    if (u === URLS.archived) return { pipelines: phase === 'archived' ? [{ ...PB, archived: true }] : [] };
    if (u === URLS.history && phase === 'restored') return { ...SOURCES.history, pipelines: [PB, ...SOURCES.history.pipelines] };
    return ANSWER[u] ?? {};
  };
  const r = rig({ answer });
  await r.tick();
  r.frame(r.sockets[0], hello);
  await r.tick();
  r.frame(r.sockets[0], { type: 'state', runId: 'run-b', id: 'pb', status: 'paused', pauseReason: 'paused by you' });
  await r.live.task.list('archive', { ids: ['run-b'] });
  assert.deepEqual(r.calls.filter((c) => c.method === 'POST' && c.u === '/api/runs/bulk').at(-1).body.targets, [{ pipelineId: 'pb' }]);
  phase = 'archived';
  r.frame(r.sockets[0], { type: 'pipelines-changed', action: 'bulk-archive', removedRunIds: ['run-b'] });
  await r.tick(250);
  assert.equal(r.rows.get('run-b'), undefined);
  assert.equal(r.rows.get('pb')?.archived, true, 'the archived row is in the store');
  await r.live.task.list('restore', { ids: ['run-b'] });
  assert.deepEqual(r.calls.filter((c) => c.method === 'POST' && c.u === '/api/runs/bulk').at(-1).body, { action: 'restore', targets: [{ pipelineId: 'pb' }] });
  phase = 'restored';
  r.frame(r.sockets[0], { type: 'pipelines-changed', action: 'bulk-restore' });
  await r.tick(250);
  const rows = [...r.rows.values()].filter((x) => x.id === 'pb' || x.id === 'run-b');
  assert.deepEqual(rows.map((x) => [x.id, x.archived]), [['pb', false]]);
});

test('F-a4-07 (review minor): a failing /api/history?archived=1 fails only the Archived view, at load and on reconnect; the rest of the list draws, and a refresh that answers clears it', async () => {
  let fail = true;
  const r = rig({ status: (u) => (fail && u === URLS.archived ? 500 : 200) });
  await r.tick();
  assert.equal(r.st.archived, 'failed', 'the Archived view reads failed');
  assert.notEqual(r.st.list, 'failed', 'the list does not');
  assert.equal(r.sockets.length, 1, 'the socket opens');
  r.frame(r.sockets[0], hello);
  await r.tick();
  assert.equal(r.st.list, '');
  assert.ok(r.rows.size > 0, 'the rest of the list draws');
  // a reconnect whose archived read fails again: the list is not out of date, and the state is not set again
  const sets = r.log.filter((x) => x[0] === 'setState').length;
  r.sockets[0].onclose({}); await r.tick(1000);
  r.frame(r.sockets[1], hello);
  await r.tick();
  assert.equal(r.st.list, '', 'the reconnect draws the list');
  assert.equal(r.st.archived, 'failed');
  assert.deepEqual(r.log.filter((x) => x[0] === 'setState').slice(sets).map((x) => x[1]), [{ conn: 'offline' }], 'no list or archived state on a reconnect that only repeats the failure');
  // Try again: the archived read alone answers and the view clears
  fail = false;
  const n = r.calls.length;
  r.live.refresh('archived'); await r.tick(250);
  assert.deepEqual(gets(r.calls.slice(n)), [URLS.archived]);
  assert.equal(r.st.archived, '');
  // it fails again on its own: only the Archived view, never the list's out-of-date look
  fail = true;
  r.live.refresh('archived'); await r.tick(250);
  assert.equal(r.st.archived, 'failed');
  assert.equal(r.st.list, '');
});

test('F-a4-07 (review minor): an Undo sent right after archiving a live run (before its archived row is read) restores by its pipeline id', async () => {
  const r = rig({ answer: (u) => (u === '/api/runs/bulk' ? { done: [{ pipelineId: 'pb' }] } : ANSWER[u] ?? {}) });
  await r.tick();
  r.frame(r.sockets[0], hello);
  await r.tick();
  r.frame(r.sockets[0], { type: 'state', runId: 'run-b', id: 'pb', status: 'paused', pauseReason: 'paused by you' });
  await r.live.task.list('archive', { ids: ['run-b'] });
  r.frame(r.sockets[0], { type: 'pipelines-changed', action: 'bulk-archive', removedRunIds: ['run-b'] });
  await r.live.task.list('restore', { ids: ['run-b'] });   // no tick: the archived feed is not read yet
  assert.deepEqual(r.calls.filter((c) => c.method === 'POST' && c.u === '/api/runs/bulk').at(-1).body, { action: 'restore', targets: [{ pipelineId: 'pb' }] });
});

test('failed on a 500 (a task page too); retry() says loading, fetches again and loads', async () => {
  let fail = true;
  const r = rig({ status: (u) => (fail && u === URLS.budget ? 500 : 200) });
  await r.tick();
  assert.equal(r.st.list, 'failed');
  assert.equal(r.sockets.length, 0);
  assert.equal(r.live.task.state('run-a'), 'failed', 'a cold task page waiting on the list reads failed, not loading for ever');
  fail = false;
  const n = r.calls.length;
  const p = r.live.retry();
  assert.equal(r.live.task.state('run-a'), 'loading', 'Try again: loading again');
  assert.deepEqual(r.log.filter((x) => x[0] === 'setState').at(-1)[1], { list: 'loading' });
  await p; await r.tick();
  assert.ok(r.calls.length > n);
  r.frame(r.sockets[0], hello);
  assert.equal(r.st.list, '');
});

test('a 401 on the first load: session expired, failed, no socket', async () => {
  const r = rig({ status: (u) => (u === URLS.settings ? 401 : 200) });
  await r.tick();
  assert.equal(r.st.conn, 'session');
  assert.equal(r.st.list, 'failed');
  assert.equal(r.sockets.length, 0);
});

test('pipelines-changed refetches /api/history and the run links only, once each for 5 frames within 250 ms, as 1 load of each one\'s parts', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], hello);
  const n = r.calls.length, loads = r.log.filter((x) => x[0] === 'load').length;
  for (let i = 0; i < 5; i++) r.frame(r.sockets[0], { type: 'pipelines-changed', action: 'updated' });
  await r.tick(250);
  assert.deepEqual(gets(r.calls.slice(n)), [URLS.history, URLS.runLinks]);
  const l = r.log.filter((x) => x[0] === 'load');
  assert.equal(l.length, loads + 2);
  assert.deepEqual(l.slice(-2).map((x) => x[1]), [['chats', 'groups', 'runs', 'updates'], ['chats']]);
});

test('pipelines-changed with removedRunIds: an archived or deleted paused run leaves the list at once and stays gone after the refetch (code review r9)', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], hello);
  r.frame(r.sockets[0], { type: 'state', runId: 'run-b', seq: 4, status: 'paused', pauseReason: 'paused by you' });
  assert.ok(r.rows.get('run-b'), 'the paused run is a row');
  r.frame(r.sockets[0], { type: 'pipelines-changed', action: 'bulk-archive', removedRunIds: ['run-b'] });
  assert.equal(r.rows.get('run-b'), undefined, 'gone before the refetch answers');
  await r.tick(250);
  assert.equal(r.rows.get('run-b'), undefined, 'and stays gone: it left the live runs');
  assert.ok(r.rows.get('run-a'), 'the other rows stay');
});

test('the run links (Stillhet Chat, D7) refetch on ask-run-status and on a thread frame, and fill each chat\'s tasks', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], hello);
  await r.tick();
  for (const type of ['ask-run-status', 'ask-done']) {
    const n = r.calls.length;
    r.frame(r.sockets[0], { type, threadId: 'ask_1' });
    await r.tick(250);
    assert.ok(r.calls.slice(n).some((c) => c.u === URLS.runLinks), type);
  }
});

test('close: offline; reopen clears it only after the re-fetch; a failed re-fetch: conn cleared, list refresh; 4001: session, no reconnect', async () => {
  let down = false;
  const r = rig({ status: () => (down ? 503 : 200) });
  await r.tick();
  r.frame(r.sockets[0], hello);
  r.sockets[0].onclose({ code: 1006 });
  assert.equal(r.st.conn, 'offline');
  await r.tick(1000);
  assert.equal(r.sockets.length, 2, 'reconnects after 1 s');
  r.frame(r.sockets[1], hello);
  assert.equal(r.st.conn, 'offline', 'still offline while the re-fetch is out');
  await r.tick();
  assert.equal(r.st.conn, '');
  assert.equal(r.st.list, '');
  r.sockets[1].onclose({ code: 1006 });
  await r.tick(2000);
  down = true;
  r.frame(r.sockets[2], hello);
  await r.tick();
  assert.equal(r.st.conn, '');
  assert.equal(r.st.list, 'refresh');
  down = false;
  r.frame(r.sockets[2], { type: 'pipelines-changed' });
  await r.tick(250);
  assert.equal(r.st.list, 'refresh', 'one good refetch does not clear the look while the other sources are still out of date');
  r.sockets[2].onclose({ code: 4001 });
  assert.equal(r.st.conn, 'session');
  await r.tick(60000);
  assert.equal(r.sockets.length, 3, 'no reconnect after 4001');
});

test('a flags frame goes to host.flagsChanged and never reloads', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], hello);
  r.frame(r.sockets[0], { type: 'flags', flags: { rail: false } });
  assert.deepEqual(r.host.flags, [{ rail: false }]);
  assert.ok(!r.calls.includes('reload'));
});

test('ask-done for a chat that is not open lights its dot through a threads refetch', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], hello);
  const n = r.calls.length;
  r.frame(r.sockets[0], { type: 'ask-done', threadId: 'ask_2', messageId: 'm', seq: 1 });
  await r.tick(250);
  assert.deepEqual(r.calls.slice(n).map((c) => c.u), [URLS.threads, URLS.runLinks, URLS.budget], 'a chat turn may have moved the spend');
  // two independent refetches (threads, runLinks): each patches its own parts, in whichever order they land (SX-10 pages threads)
  assert.deepEqual(r.log.filter((x) => x[0] === 'load' && !x[1].includes('costs')).slice(-2).map((x) => x[1].join()).sort(), ['chats', 'chats,chatsNeeds']);
});

test('a socket that closes before its hello: the reconnect hello is the first load; frames apply and *-changed refetches', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], { type: 'title', runId: 'run-b', seq: 1, title: 'Queued' });
  r.sockets[0].onclose({ code: 1006 });
  await r.tick(1000);
  assert.equal(r.sockets.length, 2);
  r.frame(r.sockets[1], hello);
  await r.tick();
  assert.equal(r.st.list, '');
  assert.equal(r.rows.get('run-b').title, 'Queued', 'the queue is applied');
  r.frame(r.sockets[1], { type: 'title', runId: 'run-b', seq: 2, title: 'Live' });
  assert.equal(r.rows.get('run-b').title, 'Live');
  const n = r.calls.length;
  r.frame(r.sockets[1], { type: 'pipelines-changed' });
  await r.tick(250);
  assert.deepEqual(gets(r.calls.slice(n)), [URLS.history, URLS.runLinks]);
});

test('a finished run with an open PR: each history load asks dev\'s PR lookup, its frames turn Ready into In review (View PR), and a refetch keeps it', async () => {
  const done = { id: 'hpr', title: 'Shipped', status: 'done', branch: 'feat/x', sourceBranch: 'main', survived: true, projectKey: 'web', projectName: 'web', mtime: new Date(NOW).toISOString() };
  const r = rig({ answer: (u) => (u === URLS.history ? { pipelines: [...SOURCES.history.pipelines, done] } : ANSWER[u] ?? {}) });
  await r.tick();
  r.frame(r.sockets[0], hello);
  await r.tick();
  assert.equal(r.rows.get('hpr').case, 'ready', 'the skeleton has no PR yet');
  const posts = () => r.calls.filter((c) => c.method === 'POST');
  assert.deepEqual(posts().map((c) => c.u), ['/api/history/pr'], 'asked once the socket is up');
  const token = posts()[0].body.token;
  r.frame(r.sockets[0], { type: 'history-pr', token: token + 1, done: true, items: [{ projectKey: 'web', id: 'hpr', pr: { url: 'https://x/pull/1', state: 'open' } }] });
  assert.equal(r.rows.get('hpr').case, 'ready', 'a batch for an older lookup is dropped');
  r.frame(r.sockets[0], { type: 'history-pr', token, done: true, items: [{ projectKey: 'web', id: 'hpr', pr: { url: 'https://x/pull/1', state: 'open' } }] });
  assert.equal(r.rows.get('hpr').case, 'checks');
  assert.equal(r.rows.get('hpr').pr, 'https://x/pull/1');
  r.frame(r.sockets[0], { type: 'pipelines-changed' });
  await r.tick(250);
  assert.equal(r.rows.get('hpr').case, 'checks', 'the new skeleton carries the PR until the next lookup answers');
  assert.equal(posts().length, 2, 'the refetch asks again');
});

test('history-pr: a row the server omits or marks stale keeps its PR (F-3-01, F-7a-01)', async () => {
  const done = { id: 'hpr', title: 'Shipped', status: 'done', branch: 'feat/x', sourceBranch: 'dev', survived: true, projectKey: 'web', projectName: 'web', mtime: new Date(NOW).toISOString() };
  const r = rig({ answer: (u) => (u === URLS.history ? { pipelines: [...SOURCES.history.pipelines, done] } : ANSWER[u] ?? {}) });
  await r.tick();
  r.frame(r.sockets[0], hello);
  await r.tick();
  const token = () => r.calls.filter((c) => c.method === 'POST').at(-1).body.token;
  const merged = { url: 'https://x/pull/1', number: 1, state: 'MERGED' };
  r.frame(r.sockets[0], { type: 'history-pr', token: token(), done: false, items: [{ projectKey: 'web', id: 'hpr', pr: merged }] });
  const mergedCase = r.rows.get('hpr').case;
  assert.notEqual(mergedCase, 'ready', 'a merged PR is drawn');
  assert.equal(r.rows.get('hpr').pr, 'https://x/pull/1');
  r.frame(r.sockets[0], { type: 'history-pr', token: token(), done: true, items: [] });
  r.frame(r.sockets[0], { type: 'pipelines-changed' });
  await r.tick(250);
  assert.equal(r.rows.get('hpr').case, mergedCase, 'a row the server left out keeps its PR, across a refetch');
  r.frame(r.sockets[0], { type: 'history-pr', token: token(), done: true, items: [{ projectKey: 'web', id: 'hpr', pr: { ...merged, stale: true } }] });
  assert.equal(r.rows.get('hpr').case, mergedCase, 'a stale resend keeps it');
  assert.equal(r.rows.get('hpr').pr, 'https://x/pull/1');
  r.frame(r.sockets[0], { type: 'history-pr', token: token(), done: true, items: [{ projectKey: 'web', id: 'hpr', pr: null }] });
  assert.equal(r.rows.get('hpr').case, 'ready', 'a genuine no PR still clears');
});

// F-a1-02, F-a1-10: a history-pr batch draws only when a row's PR really changed
async function prRig(opts = {}) {
  const done = { id: 'hpr', title: 'Shipped', status: 'done', branch: 'feat/x', sourceBranch: 'dev', survived: true, projectKey: 'web', projectName: 'web', mtime: new Date(NOW).toISOString() };
  const r = rig({ ...opts, answer: (u) => (u === URLS.history ? { pipelines: [...SOURCES.history.pipelines, done] } : ANSWER[u] ?? {}) });
  await r.tick();
  r.frame(r.sockets[0], hello);
  await r.tick();
  const token = () => r.calls.filter((c) => c.method === 'POST').at(-1).body.token;
  const send = (items, done = false) => r.frame(r.sockets[0], { type: 'history-pr', token: token(), done, items });
  return { ...r, token, send };
}
const loads = (log) => log.filter((x) => x[0] === 'load').length;

test('history-pr (F-a1-02, F-a1-10): a frame that repeats the PR on screen makes 0 world changes', async () => {
  const r = await prRig();
  const pr = { url: 'https://x/pull/1', number: 1, state: 'OPEN', mergeable: 'MERGEABLE', checks: { state: 'pending', total: 2, pending: 2 } };
  r.send([{ projectKey: 'web', id: 'hpr', pr }]);
  assert.equal(r.rows.get('hpr').pr, 'https://x/pull/1', 'drawn once');
  const reordered = { checks: { pending: 2, total: 2, state: 'pending' }, mergeable: 'MERGEABLE', state: 'OPEN', number: 1, url: 'https://x/pull/1' };
  const cases = [
    ['the identical item again', [{ projectKey: 'web', id: 'hpr', pr: { ...pr } }]],
    ['the same PR, its keys in another order', [{ projectKey: 'web', id: 'hpr', pr: reordered }]],
    ['pr: null for a row that has no PR', [{ projectKey: 'api', id: 'h2', pr: null }]],
    ['an item for an id not in history', [{ projectKey: 'web', id: 'nope', pr }]],
    ['a stale resend', [{ projectKey: 'web', id: 'hpr', pr: { ...pr, stale: true } }]],
  ];
  for (const [what, items] of cases) {
    const c = changes(r.log), l = loads(r.log);
    r.send(items);
    assert.equal(changes(r.log) - c, 0, `${what}: 0 world changes`);
    assert.equal(loads(r.log) - l, 0, `${what}: 0 loads`);
  }
  assert.equal(r.rows.get('hpr').pr, 'https://x/pull/1', 'the PR stays drawn');
});

test('history-pr (F-a1-02, F-a1-10): a real change draws once', async () => {
  const r = await prRig();
  const open = { url: 'https://x/pull/1', number: 1, state: 'OPEN' };
  r.send([{ projectKey: 'web', id: 'hpr', pr: open }]);
  const openCase = r.rows.get('hpr').case;
  let c = changes(r.log);
  r.send([{ projectKey: 'web', id: 'hpr', pr: { ...open, state: 'MERGED' } }]);
  assert.equal(changes(r.log) - c, 1, 'MERGED: 1 world change');
  assert.notEqual(r.rows.get('hpr').case, openCase, 'the merged PR is drawn');
  r.send([{ projectKey: 'web', id: 'hpr', pr: open }]);
  assert.equal(r.rows.get('hpr').case, openCase);
  c = changes(r.log);
  r.send([{ projectKey: 'web', id: 'hpr', pr: { ...open, checks: { state: 'failing', total: 2, failed: 1 } } }]);
  assert.equal(changes(r.log) - c, 1, 'checks failing: 1 world change');
  assert.notEqual(r.rows.get('hpr').case, openCase, 'the failing checks are drawn');
  c = changes(r.log);
  r.send([{ projectKey: 'web', id: 'hpr', pr: null }, { projectKey: 'api', id: 'h2', pr: null }]);
  assert.equal(changes(r.log) - c, 1, 'null: 1 world change, once for the whole batch');
  assert.equal(r.rows.get('hpr').case, 'ready', 'a genuine no PR clears');
});

// F-3-01 (#1362): dev broadcasts every history-pr frame to every socket, so each page load starts its own random token
const openPr = { url: 'https://x/pull/1', state: 'open' };
const prFrame = (token) => ({ type: 'history-pr', token, done: true, items: [{ projectKey: 'web', id: 'hpr', pr: openPr }] });

test('F-3-01: two adapters (two tabs) send different PR lookup tokens, and neither takes the other\'s history-pr frames', async () => {
  const a = await prRig({ random: () => 0.25 }), b = await prRig({ random: () => 0.5 });
  const ta = a.token(), tb = b.token();
  for (const t of [ta, tb]) assert.ok(Number.isSafeInteger(t) && t >= 1, `a positive safe integer: ${t}`);
  assert.notEqual(ta, tb, 'two tabs never share a token');
  for (const [mine, theirs, tMine, tTheirs] of [[a, b, ta, tb], [b, a, tb, ta]]) {
    const c = changes(mine.log);
    mine.frame(mine.sockets[0], prFrame(tTheirs));
    assert.equal(mine.rows.get('hpr').case, 'ready', 'the other tab\'s batch draws nothing here');
    assert.equal(changes(mine.log) - c, 0, '0 world changes');
    assert.equal(mine.live.task.prLookup().ended, false, 'the other tab\'s done frame does not end this lookup');
    mine.frame(mine.sockets[0], prFrame(tMine));
    assert.equal(mine.rows.get('hpr').case, 'checks', 'its own token draws the PR');
    assert.equal(mine.rows.get('hpr').pr, openPr.url);
    assert.equal(mine.live.task.prLookup().ended, true);
    assert.equal(theirs.rows.get('hpr').case, theirs === b ? 'ready' : 'checks', 'the other tab is untouched');
  }
});

test('F-3-01: a page\'s second lookup is its first token + 1, and the first lookup\'s late batch is dropped', async () => {
  const r = await prRig({ random: () => 0.75 });
  const t1 = r.token();
  r.frame(r.sockets[0], { type: 'pipelines-changed' });
  await r.tick(250);
  const t2 = r.token();
  assert.ok(t1 > 1, 'a random start, not 1');
  assert.equal(t2, t1 + 1);
  const c = changes(r.log);
  r.frame(r.sockets[0], prFrame(t1));
  assert.equal(r.rows.get('hpr').case, 'ready', 'the first lookup\'s late batch is dropped');
  assert.equal(changes(r.log) - c, 0);
  r.frame(r.sockets[0], prFrame(t2));
  assert.equal(r.rows.get('hpr').case, 'checks');
});

test('F-3-01: with no injected random, two adapters start at different positive tokens, and lookup ended reads true before the first ask', async () => {
  const [a, b] = [rig(), rig()];
  await a.tick(); await b.tick();
  for (const r of [a, b]) {
    const l = r.live.task.prLookup();
    assert.equal(l.ended, true, 'no lookup yet: nothing to wait for');
    assert.ok(Number.isSafeInteger(l.token) && l.token >= 1, `a positive integer: ${l.token}`);
    r.frame(r.sockets[0], hello);
  }
  await a.tick(); await b.tick();
  const post = (r) => r.calls.filter((c) => c.method === 'POST').at(-1).body.token;
  assert.notEqual(post(a), post(b));
});

test('history-pr (F-a1-02): a done frame that changes nothing still ends the task page\'s wait', async () => {
  const r = await prRig();
  const pr = { url: 'https://x/pull/1', number: 1, state: 'OPEN' };
  r.send([{ projectKey: 'web', id: 'hpr', pr }]);
  assert.equal(r.live.task.prLookup().ended, false);
  const c = changes(r.log);
  r.send([{ projectKey: 'web', id: 'hpr', pr: { ...pr } }], true);
  assert.equal(r.live.task.prLookup().ended, true, 'the lookup ended');
  assert.equal(changes(r.log) - c, 0, '0 world changes');
});

test('a failed PR lookup is asked again by the task page\'s Try again (open force), and only while it is failed', async () => {
  let prStatus = 500;
  const r = rig({ status: (u) => (u === '/api/history/pr' ? prStatus : 200) });
  await r.tick();
  r.frame(r.sockets[0], hello);
  await r.tick();
  const posts = () => r.calls.filter((c) => c.method === 'POST' && c.u === '/api/history/pr').length;
  assert.equal(posts(), 1, 'asked once the socket is up, and it failed');
  prStatus = 200;
  await r.live.task.open('h3', { force: true }); await r.tick();
  assert.equal(posts(), 2, 'Try again asks for the PRs again');
  await r.live.task.open('h3', { force: true }); await r.tick();
  assert.equal(posts(), 2, 'an answered lookup is not asked again by every forced read');
});

test('a Restart Build round on its live frames: its stages follow the workflow the frames carry (no Plan), and its end re-reads the page', async () => {
  let saved = false;   // the round's saved run is there once it ended
  const r = rig({ status: (u) => (/^\/api\/history\/web\/rb1/.test(u) && !saved ? 404 : 200),
    answer: (u) => (u === '/api/history/web/rb1' ? { state: { status: 'done', totalCostUsd: 0.12, totalActiveMs: 4000, steps: [] } } : ANSWER[u] ?? {}) });
  await r.tick();
  r.frame(r.sockets[0], hello);
  await r.tick();
  r.frame(r.sockets[0], { type: 'run-created', runId: 'run-r', pipelineId: 'rb1', projectKey: 'web', projectDir: '/src/web', title: 'Restart Build: x', status: 'running', startedAt: new Date(NOW).toISOString() });
  const nodes = [{ id: 'n_task', kind: 'task' }, { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementation' }, { id: 'n_review', kind: 'agent', key: 'reviewer', label: 'Review' }, { id: 'n_end', kind: 'end' }];
  r.frame(r.sockets[0], { type: 'state', runId: 'run-r', id: 'rb1', status: 'running', stepper: { version: 2, graph: { nodes } }, steps: [{ nodeId: 'n_impl', agentKey: 'implementer', status: 'start' }], totalCostUsd: 0, totalActiveMs: 0 });
  await r.live.task.open('run-r'); await r.tick();
  assert.equal(r.live.task.state('run-r'), 'ready');
  assert.deepEqual(r.live.task.detail('run-r').stages.map((s) => s.label), ['Build', 'Review'], 'no Plan stage: the round\'s workflow has no planner');
  const n = r.calls.length;
  saved = true;
  r.frame(r.sockets[0], { type: 'done', runId: 'run-r', status: 'done' });
  await r.tick();
  const after = gets(r.calls.slice(n));
  assert.ok(after.includes('/api/history/web/rb1'), 'the ended round\'s saved run is read again');
  assert.ok(after.includes('/api/history/web/rb1/diff'), 'and its Changes, from the saved diff');
  const page = r.live.task.detail('run-r');
  assert.equal(page.cost, 0.12, 'the frames\' $0 never hides the saved cost');
  assert.equal(page.mins, 0, 'nor its time'); assert.equal(r.live.task.input('run-r').state.totalActiveMs, 4000);
});

test('Try again during a reconnect wait opens one socket, and the wait opens no second', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], hello);
  r.sockets[0].onclose({ code: 1006 });
  await r.live.retry(); await r.tick();
  assert.equal(r.sockets.length, 2, 'retry opens it now');
  await r.tick(60000);
  assert.equal(r.sockets.length, 2, 'the pending reconnect was dropped');
  await r.live.retry(); await r.tick(60000);
  assert.equal(r.sockets.length, 2, 'retry with a socket open opens none');
});

test('a full fetch that lands after a newer single-source answer does not overwrite it', async () => {
  let release, held = false;
  const gate = new Promise((res) => { release = res; });
  let fresh = false;
  const newer = { pipelines: [...SOURCES.history.pipelines, { id: 'h9', title: 'Newer', status: 'paused', projectName: 'api', startedAt: SOURCES.history.pipelines[1].startedAt }] };
  const r = rig({ hold: (u) => (held && u === URLS.history ? gate : null), answer: (u) => (u === URLS.history && fresh ? newer : ANSWER[u] ?? {}) });
  await r.tick();
  r.frame(r.sockets[0], hello);
  r.sockets[0].onclose({ code: 1006 });
  await r.tick(1000);
  held = true;
  r.frame(r.sockets[1], hello);          // the reconnect's full fetch: its history answer (the older one) is held
  await r.tick();
  held = false; fresh = true;
  r.frame(r.sockets[1], { type: 'pipelines-changed' });
  await r.tick(250);
  assert.ok(r.rows.get('h9'), 'the newer answer is drawn');
  fresh = false; release(); await r.tick();
  assert.ok(r.rows.get('h9'), 'the older full-fetch answer did not replace it');
});

test('opening a failed task the run left unread: it leaves Needs you, and stays out after a refetch', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], hello);
  r.frame(r.sockets[0], { type: 'done', runId: 'run-b', seq: 1, status: 'error' });
  assert.equal(r.rows.get('run-b').case, 'failed');
  r.live.seenRun('run-b');
  assert.equal(r.rows.get('run-b').case, 'failed', 'it still reads Failed');
  assert.equal(r.rows.get('run-b').over, true, 'calm: it sorts into Recent');
  assert.equal(r.log.at(-1)[0], 'onMove', 'through the store\'s move');
  r.frame(r.sockets[0], { type: 'pipelines-changed' });
  await r.tick(250);
  assert.equal(r.rows.get('run-b').over, true, 'still calm after the runs are read again');
});

test('a resumed run that names a saved pipeline keeps it once, live; an agent generation gets no task', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], hello);
  assert.ok(r.rows.get('h1'), 'the saved pause');
  r.frame(r.sockets[0], { type: 'run-created', runId: 'run-r', title: 'Old pause', status: 'starting', projectDir: '/src/api' });
  r.frame(r.sockets[0], { type: 'state', runId: 'run-r', id: 'h1', status: 'running' });
  assert.ok(!r.rows.get('h1'), 'its saved row goes');
  assert.equal(r.rows.get('run-r').case, 'working');
  r.frame(r.sockets[0], { type: 'run-created', runId: 'gen-1', kind: 'agentgen', status: 'running', title: 'An agent' });
  assert.ok(!r.rows.get('gen-1'));
});

test('a resume replaces the paused live run of its pipeline: once it finishes, no stale Paused stays', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], { ...hello, runs: [...SOURCES.hello.runs, { runId: 'run-p', pipelineId: 'pp', title: 'Paused one', status: 'paused', projectDir: '/src/api' }] });
  assert.match(r.rows.get('run-p').case, /^paused/);
  r.frame(r.sockets[0], { type: 'run-created', runId: 'run-q', pipelineId: 'pp', title: 'Paused one', status: 'starting', projectDir: '/src/api' });
  r.frame(r.sockets[0], { type: 'state', runId: 'run-q', id: 'pp', status: 'running' });
  assert.ok(!r.rows.get('run-p'), 'the old run id leaves with its pause');
  assert.equal(r.rows.get('run-q').case, 'working');
  r.frame(r.sockets[0], { type: 'done', runId: 'run-q', status: 'done' });
  assert.ok(![...r.rows.values()].some((t) => /^paused/.test(t.case) && t.title === 'Paused one'), 'no Paused after it finished');
});

test('a reconnect hello passes its flags to the host (rail turned off while offline)', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], hello);
  r.sockets[0].onclose({ code: 1006 });
  await r.tick(1000);
  r.frame(r.sockets[1], { ...hello, flags: { rail: false } });
  assert.deepEqual(r.host.flags, [{ rail: false }]);
});

test('the live chat (D5) starts with the adapter: ask-* frames reach it, subscribe goes out on the socket, a reconnect re-reads the open thread', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], hello);
  await r.tick();
  const chat = r.live.chat;
  assert.equal(typeof chat.open, 'function');
  const sent = []; r.sockets[0].send = (m) => sent.push(JSON.parse(m));
  r.sockets[0].readyState = 1;
  const p = chat.open('ask_1');
  assert.deepEqual(sent, [{ type: 'subscribe', threadId: 'ask_1' }]);
  await p;
  const reads = () => r.calls.filter((c) => c.u === '/api/ask/threads/ask_1').length;
  const before = reads();
  r.sockets[0].onclose({ code: 1006 });
  await r.tick(1000);
  r.frame(r.sockets[1], hello);
  await r.tick();
  assert.equal(reads(), before + 1, 'the open thread is read again after the drop');
});

test('chat.runOf gives a run\'s scope for dev\'s scoped routes (POST /api/pr, recovery-patch): the saved row\'s store key, a live run\'s folder, a folder copy marked', async () => {
  const rows = [...SOURCES.history.pipelines, { id: 'pk', title: 'Keyed', status: 'done', projectKey: 'web-1a2b3c4d', projectDir: '/src/web', startedAt: SOURCES.hello.runs[0].startedAt },
    { id: 'pf', title: 'Copy', status: 'done', projectKey: 'docs-0a0b0c0d', projectDir: '/src/docs', workMode: 'folder', startedAt: SOURCES.hello.runs[0].startedAt }];
  const r = rig({ answer: (u) => (u === URLS.history ? { pipelines: rows } : ANSWER[u] ?? {}) });
  await r.tick();
  r.frame(r.sockets[0], hello);
  await r.tick();
  const pick = (x) => [x.projectKey, x.projectDir, x.folder];
  assert.deepEqual(pick(r.live.chat.runOf('pk')), ['web-1a2b3c4d', '/src/web', false]);
  assert.deepEqual(pick(r.live.chat.runOf('pf')), ['docs-0a0b0c0d', '/src/docs', true]);
  assert.deepEqual(pick(r.live.chat.runOf('run-b')), ['', '/src/web', false], 'a live run not saved yet: its folder');
});

test('Workflows (slice 7): its lists load when the place asks; workflows-changed and scripts-changed read them again, no other frame does', async () => {
  const WF = { '/api/workflows': { workflows: [] }, '/api/agents': { agents: [] }, '/api/scripts': { scripts: [] }, '/api/workflow-usage': { usage: {} }, '/api/chat-home/pins': { pins: [] } };
  const r = rig({ answer: (u) => WF[u] ?? ANSWER[u] ?? {} });
  await r.tick();
  assert.ok(!gets(r.calls).some((u) => u in WF), 'nothing of Workflows on the first load');
  r.frame(r.sockets[0], hello); await r.tick();
  assert.equal(r.live.workflow.status(), 'loading');
  await r.tick();
  assert.equal(r.live.workflow.status(), 'ready');
  assert.deepEqual(gets(r.calls).filter((u) => u in WF).sort(), Object.keys(WF).sort());
  const wfGets = () => gets(r.calls).filter((u) => u in WF);
  let n = wfGets().length;
  for (const type of ['pipelines-changed', 'schedules-changed', 'settings-changed', 'ask-done', 'projects-changed']) r.frame(r.sockets[0], { type });
  await r.tick(300);
  assert.equal(wfGets().length, n, 'a frame of another kind reads no Workflows list (a dev-page write elsewhere shows after a reload)');
  r.frame(r.sockets[0], { type: 'workflows-changed', action: 'saved' }); await r.tick(300);
  assert.deepEqual(wfGets().slice(n), ['/api/workflows']);
  n = wfGets().length;
  r.frame(r.sockets[0], { type: 'scripts-changed', action: 'updated' }); await r.tick(300);
  assert.deepEqual(wfGets().slice(n), ['/api/scripts']);
});

test('Marketplace (slice 8): its lists load when the place asks; plugins-changed reads plugins, markets, workflows and scripts again, no other frame does', async () => {
  const MK = { '/api/plugins': { plugins: [], orphans: [] }, '/api/marketplaces': { marketplaces: [] } };
  const WF = { '/api/workflows': { workflows: [] }, '/api/agents': { agents: [] }, '/api/scripts': { scripts: [] }, '/api/workflow-usage': { usage: {} }, '/api/chat-home/pins': { pins: [] } };
  const r = rig({ answer: (u) => MK[u] ?? WF[u] ?? ANSWER[u] ?? {} });
  await r.tick();
  assert.ok(!gets(r.calls).some((u) => u in MK), 'nothing of Marketplace on the first load');
  r.frame(r.sockets[0], hello); await r.tick();
  assert.equal(r.live.market.status(), 'loading');
  r.live.workflow.status();   // Workflows started too: its lists are read again on the same frame
  await r.tick();
  assert.equal(r.live.market.status(), 'ready');
  const mkGets = () => gets(r.calls).filter((u) => u in MK || u === '/api/workflows' || u === '/api/scripts');
  let n = mkGets().length;
  for (const type of ['pipelines-changed', 'schedules-changed', 'settings-changed', 'workflows-changed', 'marketplace-add-changed']) r.frame(r.sockets[0], { type });
  await r.tick(300);
  assert.deepEqual(gets(r.calls).filter((u) => u in MK).length, 2, 'a frame of another kind reads no Marketplace list');
  n = mkGets().length;
  r.frame(r.sockets[0], { type: 'plugins-changed', action: 'install' }); await r.tick(300);
  assert.deepEqual(mkGets().slice(n).sort(), ['/api/marketplaces', '/api/plugins', '/api/scripts', '/api/workflows']);
});

test('Projects (slice 9 D3): clone-changed, settings-changed, projects-changed and workspaces-changed reach projects.frame; other frames do not', async () => {
  const r = rig({ parts: { projects: [{ id: 'k-1111aaaa', name: 'k' }] } });   // F-6-18: only a project the store lists is read
  await r.tick();
  r.frame(r.sockets[0], hello); await r.tick();
  r.live.projects.detail('k-1111aaaa');   // an open page's detail: read again on settings-changed
  await r.tick();
  const reads = () => gets(r.calls).filter((u) => u.startsWith('/api/projects/k-1111aaaa/')).length;
  const n = reads();
  for (const type of ['pipelines-changed', 'schedules-changed', 'plugins-changed', 'marketplace-add-changed']) r.frame(r.sockets[0], { type });
  await r.tick(300);
  assert.equal(reads(), n, 'a frame of another kind reads no project detail');
  r.frame(r.sockets[0], { type: 'settings-changed' }); await r.tick(300);
  assert.equal(reads(), n + 2, 'settings-changed reads the open page\'s settings and defaults again');
});

test('Insights (slice 10 D8): pipelines-changed, ask-done, ask-error, budget-changed and team-metrics-changed reach insights.frame; other frames do not', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], hello); await r.tick();
  const got = [];
  r.live.insights.frame = (f) => got.push(f.type);
  for (const type of ['pipelines-changed', 'ask-done', 'ask-error', 'budget-changed', 'team-metrics-changed', 'schedules-changed', 'plugins-changed', 'projects-changed', 'ask-start']) r.frame(r.sockets[0], { type });
  await r.tick();
  assert.deepEqual(got, ['pipelines-changed', 'ask-done', 'ask-error', 'budget-changed', 'team-metrics-changed']);
  assert.ok(!gets(r.calls).some((u) => /^\/api\/(stats|team-metrics|tag-dimensions|policy)/.test(u)), 'no Insights read until a page asks');
});

test('F-3-09: a running task\'s workflow is set when its state frame brings the stepper', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], hello);
  await r.tick();
  r.frame(r.sockets[0], { type: 'run-created', runId: 'run-w', title: 'Lean one', status: 'starting', projectDir: '/src/web', startedAt: new Date(NOW).toISOString() });
  assert.equal(r.rows.get('run-w').workflow, '', 'run-created carries no stepper: Default for now');
  r.frame(r.sockets[0], { type: 'state', runId: 'run-w', status: 'running', stepper: { version: 2, template: { id: 'wf_lean', name: 'Lean' }, graph: { nodes: [], edges: [] } } });
  assert.equal(r.rows.get('run-w').workflow, 'Lean');
});

test('SX-10 F-a1-03: the chats source pages through the API\'s cursor: every chat in one load, never only the first page', async () => {
  const one = (i) => ({ id: `ask_p${i}`, title: `Chat ${i}`, archivedAt: null, updatedAt: SOURCES.threads.threads[0].updatedAt });
  const PAGE2 = `${URLS.threads}&cursor=c2`, PAGE3 = `${URLS.threads}&cursor=c3`;
  const pages = { [URLS.threads]: { threads: [one(1), one(2)], cursor: 'c2', total: 5, counts: { all: 5 } }, [PAGE2]: { threads: [one(3), one(4)], cursor: 'c3', total: 5 }, [PAGE3]: { threads: [one(5)], cursor: null, total: 5 } };
  let chats = null;
  const r = rig({ answer: (u) => pages[u] ?? ANSWER[u] ?? {}, onLoad: (p) => { if (p.chats) chats = p.chats; } });
  await r.tick();
  assert.deepEqual(gets(r.calls).filter((u) => u.startsWith('/api/ask/threads')), [URLS.threads, PAGE2, PAGE3], 'each page once, in order');
  r.sockets[0].onopen?.(); r.frame(r.sockets[0], hello); await r.tick();
  assert.equal(r.log.filter((x) => x[0] === 'load').length, 1, 'one load: the bar is drawn once, not page by page');
  assert.deepEqual(chats.map((c) => c.id).filter((id) => id.startsWith('ask_p')).sort(), ['ask_p1', 'ask_p2', 'ask_p3', 'ask_p4', 'ask_p5']);
});
