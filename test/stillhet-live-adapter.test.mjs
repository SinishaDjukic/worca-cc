// test/stillhet-live-adapter.test.mjs — the live adapter's I/O (ui/public/stillhet/live/live-adapter.mjs) with a fake fetch,
// WebSocket and timers, and an in-memory world that counts its writes the way shell/world.js fires them (D8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLive, SOURCES as URLS } from '../ui/public/stillhet/live/live-adapter.mjs';
import { SOURCES, NOW } from './helpers/stillhet-live-fixture.mjs';
const ANSWER = { [URLS.history]: SOURCES.history, [URLS.threads]: SOURCES.threads, [URLS.groups]: SOURCES.groups, [URLS.schedules]: SOURCES.schedules, [URLS.projects]: SOURCES.projects, [URLS.sync]: SOURCES.sync, [URLS.budget]: SOURCES.budget, [URLS.actions]: SOURCES.actions, [URLS.notifications]: SOURCES.notifications, [URLS.away]: SOURCES.away, [URLS.settings]: SOURCES.settings };

function rig({ status = () => 200 } = {}) {
  const calls = [], sockets = [], timers = [];
  const fetch = async (u, o = {}) => { calls.push({ u, method: o.method || 'GET' }); const s = status(u); return { ok: s < 300, status: s, json: async () => ANSWER[u] ?? {} }; };
  class FakeSocket { constructor(url) { this.url = url; sockets.push(this); } close() { this.closed = true; } send() {} }
  const tick = async (ms = 0) => { for (const t of timers.filter((x) => !x.done && x.ms <= ms)) { t.done = true; t.fn(); } for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const st = { list: 'loading', conn: '' }, log = [], rows = new Map();
  const world = {
    load: (parts, state) => { log.push(['load', Object.keys(parts).sort(), state]); if (parts.runs) { rows.clear(); for (const r of parts.runs) rows.set(r.id, { ...r }); } if (state) Object.assign(st, state); log.push(['onChange']); },
    setState: (s) => { Object.assign(st, s); log.push(['setState', { ...s }]); log.push(['onChange']); },
    find: (id) => rows.get(id), add: (r) => { rows.set(r.id, { ...r }); log.push(['onMove', r.id]); return r; },
    move: (id, kase, detail, o = {}) => { const r = rows.get(id); if (!r) return; Object.assign(r, { case: kase, detail }, o); log.push(['onMove', id]); },
  };
  const host = { flags: [], flagsChanged: (f) => host.flags.push(f) };
  const location = { protocol: 'http:', host: 'localhost:4931', reload: () => calls.push('reload') };
  const live = startLive({ fetch, WebSocket: FakeSocket, location, world, host, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (i) => { if (timers[i - 1]) timers[i - 1].done = true; }, now: () => NOW });
  const frame = (sock, f) => sock.onmessage({ data: JSON.stringify(f) });
  return { live, calls, sockets, tick, st, log, rows, host, frame };
}
const changes = (log) => log.filter((x) => x[0] === 'onChange').length;
const hello = { type: 'hello', bootId: 'b', runs: SOURCES.hello.runs };

test('first load: the D10 GETs only, then the socket; hello gives 1 load and 1 onChange (data and list together)', async () => {
  const r = rig();
  await r.tick();
  assert.deepEqual(r.calls.map((c) => c.u).sort(), Object.values(URLS).sort());
  assert.ok(r.calls.every((c) => c.method === 'GET'));
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

test('failed on a 500; retry() says loading, fetches again and loads', async () => {
  let fail = true;
  const r = rig({ status: (u) => (fail && u === URLS.budget ? 500 : 200) });
  await r.tick();
  assert.equal(r.st.list, 'failed');
  assert.equal(r.sockets.length, 0);
  fail = false;
  const n = r.calls.length;
  const p = r.live.retry();
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

test('pipelines-changed refetches /api/history only, once for 5 frames within 250 ms, as 1 load of its parts', async () => {
  const r = rig();
  await r.tick();
  r.frame(r.sockets[0], hello);
  const n = r.calls.length, loads = r.log.filter((x) => x[0] === 'load').length;
  for (let i = 0; i < 5; i++) r.frame(r.sockets[0], { type: 'pipelines-changed', action: 'updated' });
  await r.tick(250);
  assert.deepEqual(r.calls.slice(n).map((c) => c.u), [URLS.history]);
  const l = r.log.filter((x) => x[0] === 'load');
  assert.equal(l.length, loads + 1);
  assert.deepEqual(l.at(-1)[1], ['runs', 'updates']);
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
  assert.deepEqual(r.calls.slice(n).map((c) => c.u), [URLS.threads]);
  assert.deepEqual(r.log.filter((x) => x[0] === 'load').at(-1)[1], ['chats']);
});
