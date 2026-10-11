// test/server-event-names.test.mjs — wireRun must forward the new 'stepskills'
// event through the pass-through broadcast (tagged with the run UUID), exactly as
// it forwards 'subagent'. EVENT_NAMES is not exported, so assert BEHAVIORALLY via
// the buffered events on the run entry (mirrors ui-runs-live-id.test.mjs).
// §7.3 adds 'stepgraphify' to the same list: the orchestrator emitted it and the
// client handled it, but the server never forwarded it, so the badge only ever
// appeared after a reload (via the persisted column), never live.
//
// This file also holds the other pure-_testing server suites (one process and one
// ui/server.mjs import for all of them): title forwarding, the cost/error pause
// reason, the WS replay seq + heartbeat, and the workspace source-branch helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runs, _testing, buildWorkspaceMembers, firstInjectionSource } from '../ui/server.mjs';
import { alreadyApplied, noteBoot } from '../ui/public/ws-seq.mjs';
import { checkRows } from './helpers/rows.mjs';

function makeEntry(overrides = {}) {
  return {
    id: 'uuid-SK1',
    orch: new EventEmitter(),
    projectDir: '/tmp/x',
    title: 't',
    status: 'running',
    startedAt: new Date().toISOString(),
    events: [],
    pendingQuestion: null,
    ...overrides,
  };
}

// The three-part MCP labels and the overflow sentinel are opaque strings to the
// transport — pinned so a future "validate the payload" change cannot drop them.
test("wireRun forwards 'stepskills' and 'stepgraphify' verbatim (MCP labels + overflow sentinel), tagged with the run UUID, status unchanged", async () => {
  await checkRows([
    { name: "wireRun: 'stepskills' events are forwarded, tagged with the run UUID", run: () => {
      const entry = makeEntry({ id: 'uuid-SK1' });
      runs.set(entry.id, entry);
      try {
        _testing.wireRun(entry);
        entry.orch.emit('stepskills', { nodeId: 'n1', cycle: 1, skills: ['skill:graphify'] });
        const buffered = entry.events.filter((e) => e.type === 'stepskills');
        assert.equal(buffered.length, 1, 'stepskills event is buffered/forwarded');
        assert.equal(buffered[0].runId, 'uuid-SK1', 'tagged with the run UUID');
        assert.deepEqual(buffered[0].skills, ['skill:graphify']);
        assert.equal(buffered[0].nodeId, 'n1');
        assert.equal(buffered[0].cycle, 1);
        assert.equal(entry.status, 'running', 'a stepskills event must not change run status');
      } finally {
        runs.delete(entry.id);
      }
    } },
    { name: "§7.3 wireRun: 'stepgraphify' events are forwarded, tagged with the run UUID", run: () => {
      const entry = makeEntry({ id: 'uuid-GR1' });
      runs.set(entry.id, entry);
      try {
        _testing.wireRun(entry);
        entry.orch.emit('stepgraphify', { nodeId: 'n1', cycle: 1, graphifyCount: 3 });
        const buffered = entry.events.filter((e) => e.type === 'stepgraphify');
        assert.equal(buffered.length, 1, 'stepgraphify event is buffered/forwarded');
        assert.equal(buffered[0].runId, 'uuid-GR1', 'tagged with the run UUID');
        assert.equal(buffered[0].graphifyCount, 3);
        assert.equal(buffered[0].nodeId, 'n1');
        assert.equal(buffered[0].cycle, 1);
        assert.equal(entry.status, 'running', 'a stepgraphify event must not change run status');
      } finally {
        runs.delete(entry.id);
      }
    } },
    { name: '§7.1/§7.3 stepskills carries three-part MCP labels and the overflow sentinel verbatim', run: () => {
      const entry = makeEntry({ id: 'uuid-SK2' });
      runs.set(entry.id, entry);
      try {
        _testing.wireRun(entry);
        const skills = ['skill:graphify', 'mcp:playwright:browser_navigate', 'overflow:6'];
        entry.orch.emit('stepskills', { nodeId: 'n1', cycle: 1, skills });
        assert.deepEqual(entry.events.filter((e) => e.type === 'stepskills')[0].skills, skills);
      } finally {
        runs.delete(entry.id);
      }
    } },
  ]);
});

// wireRun's status arm is SHARED, not v1: P8 rewrote `name === 'phase' || name
// === 'exec'` down to `name === 'exec'`, and DELETING it instead would leave
// every run stuck at the status it was created with until the first `state`
// frame. Nothing pinned it before, so a mutation that removed it stayed green.
test("wireRun: an 'exec' event flips a queued run to running", () => {
  const entry = makeEntry({ id: 'uuid-EX1', status: 'queued' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('exec', { nodeId: 'n_plan', executionId: 'x:n_plan:1', status: 'start' });
    assert.equal(entry.status, 'running', 'the exec arm is what marks the run live');
    const buffered = entry.events.filter((e) => e.type === 'exec');
    assert.equal(buffered.length, 1, 'and the event itself is forwarded');
    assert.equal(buffered[0].runId, 'uuid-EX1');
  } finally {
    runs.delete(entry.id);
  }
});

// wireRun must forward the 'title' event through the pass-through broadcast
// (tagged with the run UUID, carrying the payload's pipelineId) AND refresh
// entry.title so a late-joining client's hello/summarizeRuns reports the settled
// title.
test("wireRun: 'title' events are forwarded with pipelineId and refresh entry.title; a title-less event does not clobber it", async () => {
  await checkRows([
    { name: "wireRun: 'title' events are forwarded with pipelineId and refresh entry.title", run: () => {
      const entry = makeEntry({ id: 'uuid-T1', title: 'Provisional title' });
      runs.set(entry.id, entry);
      try {
        _testing.wireRun(entry);
        entry.orch.emit('title', { title: 'Concise LLM Title', provisional: false, pipelineId: 'p1' });
        const buffered = entry.events.filter((e) => e.type === 'title');
        assert.equal(buffered.length, 1, 'title event is buffered/forwarded');
        assert.equal(buffered[0].runId, 'uuid-T1', 'tagged with the run UUID');
        assert.equal(buffered[0].title, 'Concise LLM Title');
        assert.equal(buffered[0].pipelineId, 'p1', 'pipelineId rides through to the client');
        assert.equal(buffered[0].provisional, false);
        assert.equal(entry.title, 'Concise LLM Title', 'entry.title refreshed for late-join hello');
        assert.equal(entry.status, 'running', 'a title event must not change run status');
      } finally {
        runs.delete(entry.id);
      }
    } },
    { name: "wireRun: a 'title' event with no title string does not clobber entry.title", run: () => {
      const entry = makeEntry({ id: 'uuid-T2', title: 'Keep me' });
      runs.set(entry.id, entry);
      try {
        _testing.wireRun(entry);
        entry.orch.emit('title', { provisional: false, pipelineId: 'p2' });
        assert.equal(entry.title, 'Keep me', 'entry.title preserved when payload omits title');
      } finally {
        runs.delete(entry.id);
      }
    } },
  ]);
});

// The SERVER half of cost-pause reload parity (plan Task 20, item 2). wireRun's
// done branch must remember the pause reason on the run entry, and summarizeRuns
// must carry it into every `hello` frame, so a reload or a WS reconnect restores
// the cost banner instead of a plain "Paused" card.
test('wireRun: a reasonless done clears pauseReason to null (never stale)', () => {
  const entry = makeEntry({ id: 'uuid-PR2', pauseReason: 'cost_total' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('done', { status: 'done' });
    assert.equal(entry.pauseReason, null);
  } finally {
    runs.delete(entry.id);
  }
});

test('summarizeRuns carries pauseReason (null when the run never cost-paused)', () => {
  const paused = makeEntry({ id: 'uuid-PR3', status: 'paused', pauseReason: 'cost_total' });
  const plain = makeEntry({ id: 'uuid-PR4' });
  runs.set(paused.id, paused);
  runs.set(plain.id, plain);
  try {
    const summary = _testing.summarizeRuns();
    const a = summary.find((r) => r.runId === 'uuid-PR3');
    const b = summary.find((r) => r.runId === 'uuid-PR4');
    assert.ok(a && b, 'both runs summarized');
    assert.equal(a.pauseReason, 'cost_total', 'hello run-summary carries the pause reason');
    assert.equal(b.pauseReason, null, 'absent reason summarizes as null, not undefined');
    assert.ok('pauseReason' in b, 'the key is always present on the wire');
  } finally {
    runs.delete(paused.id);
    runs.delete(plain.id);
  }
});

test("wireRun: a usage limit's engine and the run's engine reach the hello summary", () => {
  const orch = Object.assign(new EventEmitter(), { state: { runEngine: 'codex' } });
  const entry = makeEntry({ id: 'uuid-PR8', orch });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('done', { status: 'paused', reason: 'usage_limit', detail: "You've hit your usage limit", limitEngine: 'codex' });
    assert.equal(entry.limitEngine, 'codex');
    const sum = _testing.summarizeRuns().find((r) => r.runId === 'uuid-PR8');
    assert.equal(sum.limitEngine, 'codex');
    assert.equal(sum.runEngine, 'codex');
    entry.orch.emit('done', { status: 'done' });
    assert.equal(entry.limitEngine, null, 'a later finish clears it');
  } finally {
    runs.delete(entry.id);
  }
});

test('end to end: wireRun done -> summarizeRuns is what a reloading client sees', () => {
  const entry = makeEntry({ id: 'uuid-PR5', pipelineId: 'pl_9' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('done', { status: 'paused', reason: 'cost_pipeline' });
    const sum = _testing.summarizeRuns().find((r) => r.runId === 'uuid-PR5');
    assert.equal(sum.status, 'paused');
    assert.equal(sum.pauseReason, 'cost_pipeline');
    assert.equal(sum.pipelineId, 'pl_9');
  } finally {
    runs.delete(entry.id);
  }
});

test('wireRun: an error-pause stores reason AND detail; a later stray error event never demotes it', () => {
  const entry = makeEntry({ id: 'uuid-PR6' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('done', { status: 'paused', reason: 'error', detail: 'claude exited with code 1: disk full' });
    assert.equal(entry.status, 'paused');
    assert.equal(entry.pauseReason, 'error');
    assert.equal(entry.pauseDetail, 'claude exited with code 1: disk full');
    entry.orch.emit('error', { message: 'late' });
    assert.equal(entry.status, 'paused', "an 'error' event must not override a parked run");
    const sum = _testing.summarizeRuns().find((r) => r.runId === 'uuid-PR6');
    assert.equal(sum.pauseDetail, 'claude exited with code 1: disk full');
  } finally {
    runs.delete(entry.id);
  }
});

test("wireRun: 'error' still marks a RUNNING entry error (the launch-error channel)", () => {
  const entry = makeEntry({ id: 'uuid-PR7' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('error', { message: 'agent "ghost" is not installed' });
    assert.equal(entry.status, 'error');
  } finally {
    runs.delete(entry.id);
  }
});

// Behind Cloudflare Access (worca-01, 2026-09-26) an idle WebSocket is closed after ~100 s, so
// while an Auto proposal waited for Accept the socket dropped every ~2 minutes; each reconnect
// re-subscribed, the server replayed the run's whole buffer, and the Running log showed every
// earlier line again. Two halves: the server pings every socket so proxies never see it idle
// (and drops a dead one), and every buffered run event carries a per-run `seq` the client uses
// to skip what it already applied (ui/public/ws-seq.mjs).
test('buffered run events carry a per-run seq, 1, 2, 3 …', () => {
  const a = makeEntry({ id: 'uuid-SEQ-A' });
  const b = makeEntry({ id: 'uuid-SEQ-B' });
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

// The per-project source-branch mapping/validation helpers used by the workspace
// /api/run arm.
const PROJECTS = [
  { projectDir: '/a/svc-iam', projectKey: 'svc-iam-aaaa1111', projectName: 'svc-iam' },
  { projectDir: '/a/svc-ui', projectKey: 'svc-ui-bbbb2222', projectName: 'svc-ui' },
];

test('buildWorkspaceMembers: per-project override wins, others fall back to shared source; feature is always shared', async () => {
  await checkRows([
    { name: 'buildWorkspaceMembers: per-project override wins, others fall back to shared source', run: () => {
      const branch = { source: 'main', feature: 'add-x' };
      const members = buildWorkspaceMembers(PROJECTS, branch, { 'svc-iam-aaaa1111': 'develop' });
      // overridden member
      assert.deepEqual(members[0].branch, { source: 'develop', feature: 'add-x' });
      // un-overridden member falls back to the shared default source
      assert.deepEqual(members[1].branch, { source: 'main', feature: 'add-x' });
      // original descriptor fields are preserved
      assert.equal(members[0].projectDir, '/a/svc-iam');
      assert.equal(members[1].projectName, 'svc-ui');
    } },
    { name: 'buildWorkspaceMembers: feature branch is always the shared value for every member', run: () => {
      const members = buildWorkspaceMembers(PROJECTS, { source: 'main', feature: 'shared-feat' },
        { 'svc-iam-aaaa1111': 'develop', 'svc-ui-bbbb2222': 'release' });
      assert.equal(members[0].branch.feature, 'shared-feat');
      assert.equal(members[1].branch.feature, 'shared-feat');
    } },
  ]);
});

test('buildWorkspaceMembers: blank override, null/undefined map → shared default', async () => {
  await checkRows([
    { name: 'buildWorkspaceMembers: blank/whitespace override → shared default (null stays null)', run: () => {
      const members = buildWorkspaceMembers(PROJECTS, { source: null, feature: null }, { 'svc-iam-aaaa1111': '   ' });
      assert.equal(members[0].branch.source, null);
      assert.equal(members[1].branch.source, null);
      assert.equal(members[0].branch.feature, null);
    } },
    { name: 'buildWorkspaceMembers: tolerates a non-object / missing map (returns shared source for all)', run: () => {
      const branch = { source: 'main', feature: null };
      assert.equal(buildWorkspaceMembers(PROJECTS, branch, undefined)[0].branch.source, 'main');
      assert.equal(buildWorkspaceMembers(PROJECTS, branch, null)[1].branch.source, 'main');
    } },
  ]);
});

test('firstInjectionSource: flags a leading-dash value (option injection), else null', () => {
  assert.equal(firstInjectionSource({ k1: 'main', k2: '--upload-pack=x' }), '--upload-pack=x');
  assert.equal(firstInjectionSource({ k1: 'main', k2: 'develop' }), null);
  assert.equal(firstInjectionSource({}), null);
  assert.equal(firstInjectionSource(undefined), null);
});
