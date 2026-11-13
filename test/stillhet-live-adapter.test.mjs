// test/stillhet-live-adapter.test.mjs — the live adapter's I/O (ui/public/stillhet/live/live-adapter.mjs) with a fake fetch,
// WebSocket and timers, and an in-memory world that counts its writes the way shell/world.js fires them (D8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLive, SOURCES as URLS } from '../ui/public/stillhet/live/live-adapter.mjs';
import { SOURCES, NOW } from './helpers/stillhet-live-fixture.mjs';
const ANSWER = { [URLS.history]: SOURCES.history, [URLS.threads]: SOURCES.threads, [URLS.groups]: SOURCES.groups, [URLS.schedules]: SOURCES.schedules, [URLS.projects]: SOURCES.projects, [URLS.sync]: SOURCES.sync, [URLS.budget]: SOURCES.budget, [URLS.actions]: SOURCES.actions, [URLS.notifications]: SOURCES.notifications, [URLS.away]: SOURCES.away, [URLS.settings]: SOURCES.settings, [URLS.runLinks]: SOURCES.runLinks };

function rig({ status = () => 200, answer = (u) => ANSWER[u] ?? {}, hold = () => null } = {}) {
  const calls = [], sockets = [], timers = [];
  const fetch = async (u, o = {}) => { calls.push({ u, method: o.method || 'GET', ...(o.body ? { body: JSON.parse(o.body) } : {}) }); const h = hold(u); if (h) await h; const s = status(u); const a = answer(u); return { ok: s < 300, status: s, json: async () => a }; };
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
  assert.deepEqual(l.slice(-2).map((x) => x[1]), [['chats', 'runs', 'updates'], ['chats']]);
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
  assert.deepEqual(r.calls.slice(n).map((c) => c.u), [URLS.threads, URLS.runLinks]);
  assert.deepEqual(r.log.filter((x) => x[0] === 'load').slice(-2).map((x) => x[1]), [['chats', 'chatsNeeds'], ['chats']]);
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
  const done = { id: 'hpr', title: 'Shipped', status: 'done', branch: 'feat/x', survived: true, projectKey: 'web', projectName: 'web', mtime: new Date(NOW).toISOString() };
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
