// test/server-ws-replay.test.mjs
// Behind Cloudflare Access (worca-01, 2026-09-26) an idle WebSocket is closed after ~100 s, so
// while an Auto proposal waited for Accept the socket dropped every ~2 minutes; each reconnect
// re-subscribed, the server replayed the run's whole buffer, and the Running log showed every
// earlier line again. Two halves: the server pings every socket so proxies never see it idle
// (and drops a dead one), and every buffered run event carries a per-run `seq` the client uses
// to skip what it already applied (ui/public/ws-seq.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runs, _testing } from '../ui/server.mjs';
import { alreadyApplied, noteBoot } from '../ui/public/ws-seq.mjs';

function makeEntry(id) {
  return { id, orch: new EventEmitter(), projectDir: '/tmp/x', title: 't', status: 'running', startedAt: new Date().toISOString(), events: [], pendingQuestion: null };
}

test('buffered run events carry a per-run seq, 1, 2, 3 …', () => {
  const a = makeEntry('uuid-SEQ-A');
  const b = makeEntry('uuid-SEQ-B');
  runs.set(a.id, a); runs.set(b.id, b);
  try {
    _testing.wireRun(a); _testing.wireRun(b);
    a.orch.emit('log', { source: 'x', level: 'info', text: 'one' });
    a.orch.emit('log', { source: 'x', level: 'info', text: 'two' });
    b.orch.emit('log', { source: 'x', level: 'info', text: 'other run' });
    a.orch.emit('artifact', { kind: 'pipeline', path: '/p' });
    assert.deepEqual(a.events.map((e) => e.seq), [1, 2, 3]);
    assert.deepEqual(b.events.map((e) => e.seq), [1], 'numbered per run');
  } finally { runs.delete(a.id); runs.delete(b.id); }
});

test('heartbeat: a socket that answered is pinged again; one that did not is terminated', () => {
  const mk = () => {
    const ws = new EventEmitter();
    ws.pings = 0; ws.terminated = false; ws.readyState = 1; ws.OPEN = 1;
    ws.ping = () => { ws.pings += 1; };
    ws.terminate = () => { ws.terminated = true; };
    return ws;
  };
  const alive = mk();
  const dead = mk();
  _testing.trackHeartbeat(alive);
  _testing.trackHeartbeat(dead);
  const set = new Set([alive, dead]);
  _testing.heartbeatTick(set);
  assert.equal(alive.pings, 1); assert.equal(dead.pings, 1);
  alive.emit('pong');                       // only the live one answers
  _testing.heartbeatTick(set);
  assert.equal(alive.pings, 2);
  assert.equal(alive.terminated, false);
  assert.equal(dead.terminated, true, 'no pong since the last tick: terminated');
});

test('hello carries the server boot id', () => {
  assert.match(_testing.BOOT_ID, /^[0-9a-f-]{36}$/);
});

test('client: a replayed event (seq already applied) is skipped; new ones and seq-less frames pass', () => {
  const r = {};
  assert.equal(alreadyApplied(r, { seq: 1 }), false);
  assert.equal(alreadyApplied(r, { seq: 2 }), false);
  assert.equal(alreadyApplied(r, { seq: 1 }), true, 'a reconnect replay of seq 1');
  assert.equal(alreadyApplied(r, { seq: 2 }), true);
  assert.equal(alreadyApplied(r, { seq: 3 }), false);
  assert.equal(alreadyApplied(r, { type: 'state' }), false, 'a state snapshot has no seq and always applies');
});

test('client: a new server boot resets what was applied (seq starts over after a restart)', () => {
  const st = { serverBootId: null };
  const runsMap = new Map([['r1', { lastSeq: 40 }]]);
  noteBoot(st, 'boot-a', runsMap);
  assert.equal(runsMap.get('r1').lastSeq, 40, 'the first hello keeps what this page applied');
  noteBoot(st, 'boot-a', runsMap);
  assert.equal(runsMap.get('r1').lastSeq, 40, 'a reconnect to the same server keeps it');
  noteBoot(st, 'boot-b', runsMap);
  assert.equal(runsMap.get('r1').lastSeq, 0, 'a restarted server numbers from 1 again');
  assert.equal(st.serverBootId, 'boot-b');
});
