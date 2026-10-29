// test/session-host-queue.test.mjs — one turn at a time per host; a cancelled waiter leaves no trace and no held slot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionHosts, defaultTransport, SESSION_TRANSPORT } from '../src/core/session-host.mjs';
import { isTerminal } from '../src/core/failure-policy.mjs';
import { SID, spec, decisions, fakePort, memberOpts, member, gatedTransport } from './helpers/session-host-fakes.mjs';

const make = (over = {}) => {
  const g = gatedTransport(); const port = fakePort();
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: g.transport, ...over });
  return { g, port, hosts, host: hosts.hostFor('n_a') };
};
const tick = () => new Promise((r) => setImmediate(r));

test('creation writes open + mode; hostFor rules', () => {
  const { port, hosts } = make();
  assert.deepEqual(port.records.map((r) => r.kind), ['open', 'mode']);
  assert.ok(hosts.hostFor('n_a'));
  assert.equal(hosts.hostFor('n_a', { slice: { id: 't1' } }), null);
  assert.equal(hosts.hostFor('n_a', { role: 'security' }), null);
  assert.equal(hosts.hostFor('n_zz'), null);
  assert.equal(hosts.sidOf('n_b'), SID);
  const sep = createSessionHosts({ specs: [spec()], decisions: decisions('separate'), port: fakePort(), transport: gatedTransport().transport });
  assert.equal(sep.hostFor('n_a'), null);
  assert.equal(sep.sidOf('n_a'), SID);
  assert.equal(sep.modeOf('n_a'), 'separate');
});

test('FIFO: the second dispatch starts only when the first resolves; attempts count per execution', async () => {
  const { g, host } = make();
  const p1 = host.run(memberOpts({ executionId: 'x:n_a:1' }), member('n_a'));
  const p2 = host.run(memberOpts({ executionId: 'x:n_b:1' }), member('n_b'));
  await tick();
  assert.equal(g.calls.length, 1);
  g.ok(0); await p1; await tick();
  assert.equal(g.calls.length, 2);
  g.ok(1); await p2;
  const p3 = host.run(memberOpts({ executionId: 'x:n_a:1' }), member('n_a')); await tick();
  assert.match(g.calls[2].hostOpts.prompt, /worca-x-n_a-1-a2/);
  g.ok(2); await p3;
});

test('REVIEW FOCUS 5 — a diamond: two members ready at once, then Stop while one waits', async () => {
  const { g, port, host } = make();
  const a = new AbortController(); const b = new AbortController();
  const p1 = host.run(memberOpts({ executionId: 'x:n_a:1', signal: a.signal }), member('n_a'));
  const p2 = host.run(memberOpts({ executionId: 'x:n_b:1', signal: b.signal }), member('n_b'));
  await tick();
  b.abort();
  await assert.rejects(p2, (e) => e.name === 'AbortError');
  assert.equal(g.calls.length, 1, 'the waiter never spawned');
  assert.equal(port.records.filter((r) => r.kind === 'dispatch').length, 1, 'no ghost dispatch record');
  g.ok(0); await p1;
  assert.deepEqual(port.queued, [['x:n_b:1', true], ['x:n_b:1', false]], 'C39: the row said "queued", then stopped saying it');
  await assert.rejects(host.run(memberOpts({ executionId: 'x:n_b:1', signal: b.signal }), member('n_b')), (e) => e.name === 'AbortError');
  const p3 = host.run(memberOpts({ executionId: 'x:n_b:1' }), member('n_b')); await tick();
  assert.match(g.calls[1].hostOpts.prompt, /worca-x-n_b-1-a1/, 'the cancelled waiter consumed no attempt');
  g.ok(1); await p3;
});

test('Stop mid-turn: the host process gets the abort; the run rejects as an abort, never as a watchdog error', async () => {
  const { g, port, host } = make();
  const a = new AbortController();
  const p = host.run(memberOpts({ executionId: 'x:n_a:1', signal: a.signal }), member('n_a'));
  await tick();
  a.abort();
  assert.equal(g.calls[0].hostOpts.signal.aborted, true);
  g.fail(0, Object.assign(new Error('aborted'), { name: 'AbortError' }));
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.equal(port.records.at(-1).kind, 'turn_end');
  assert.equal(port.records.at(-1).exit, 'aborted');
});

// ── v2: what the Interfaces block pins beyond the master's four tests ──

test('v2 — an already-aborted signal rejects at once: nothing queued, nothing written, no attempt; a member without a signal still runs', async () => {
  const { g, port, host } = make();
  const ac = new AbortController(); ac.abort();
  await assert.rejects(host.run(memberOpts({ signal: ac.signal }), member('n_a')), (e) => e.name === 'AbortError');
  assert.deepEqual([port.records.length, port.queued.length, g.calls.length], [2, 0, 0]);
  const p = host.run({ ...memberOpts(), signal: undefined }, member('n_a')); await tick();
  assert.match(g.calls[0].hostOpts.prompt, /worca-x-n_a-1-a1/);
  assert.equal(g.calls[0].hostOpts.signal.aborted, false, 'the turn has its own signal even when the member has none');
  g.ok(0); assert.equal((await p).exitCode, 0);
});

test('v2 — four waiters: FIFO in call order (two live waiters keep theirs); a cancelled one is skipped; each waiter that started says so (C39)', async () => {
  const { g, port, host } = make();
  const b = new AbortController();
  const p1 = host.run(memberOpts(), member('n_a'));
  const p2 = host.run(memberOpts({ signal: b.signal }), member('n_b'));
  const p3 = host.run(memberOpts(), member('n_a', 2));
  const p4 = host.run(memberOpts(), member('n_b', 2));
  await tick();
  b.abort(); await assert.rejects(p2, (e) => e.name === 'AbortError');
  g.ok(0); await p1; await tick();
  assert.equal(g.calls.length, 2);
  assert.match(g.calls[1].hostOpts.prompt, /worca-x-n_a-2-a1/, 'the older of two live waiters goes first');
  g.ok(1); await p3; await tick();
  assert.match(g.calls[2].hostOpts.prompt, /worca-x-n_b-2-a1/);
  g.ok(2); await p4;
  assert.deepEqual(port.queued, [['x:n_b:1', true], ['x:n_a:2', true], ['x:n_b:2', true], ['x:n_b:1', false], ['x:n_a:2', false], ['x:n_b:2', false]]);
  const q = port.records.filter((r) => r.kind === 'dispatch').map((r) => r.queueMs);
  assert.equal(q[0] >= 0 && q[1] >= 0, true, 'queueMs on every dispatch');
});

test('v2 — the turn and dispatch records: ids, attempt, agentType, cold, the host spawn built from the member', async () => {
  const { g, port, host } = make();
  const p = host.run(memberOpts(), member('n_a')); await tick();
  g.ok(0); await p;
  const p2 = host.run({ ...memberOpts(), resumeSessionId: 'old' }, member('n_a')); await tick();
  g.ok(1); await p2;
  const ts = port.records.filter((r) => r.kind === 'turn_start');
  assert.deepEqual(ts.map((r) => [r.turnId, r.maxTurns, r.hostModel, r.hostEffort]), [[`t:${SID}:1`, 4, null, null], [`t:${SID}:2`, 4, null, null]]);
  const d = port.records.filter((r) => r.kind === 'dispatch');
  assert.deepEqual(d.map((r) => [r.turnId, r.dispatchId, r.executionId, r.nodeId, r.attempt, r.agentType, r.cold]), [
    [`t:${SID}:1`, 'd:x:n_a:1:a1', 'x:n_a:1', 'n_a', 1, 'worca-x-n_a-1-a1', false],
    [`t:${SID}:2`, 'd:x:n_a:1:a2', 'x:n_a:1', 'n_a', 2, 'worca-x-n_a-1-a2', true]]);
  const h = g.calls[0].hostOpts;
  assert.equal(h.agentsViaFile, true);
  assert.deepEqual(Object.keys(h.agents), ['worca-x-n_a-1-a1']);
  assert.equal(h.agents['worca-x-n_a-1-a1'].prompt.startsWith('SYS'), true);
  assert.match(h.prompt, /^Dispatch sub-agent worca-x-n_a-1-a1 \(n_a · cycle 1\) now/);
  assert.equal(port.records.filter((r) => r.kind === 'turn_end').every((r) => r.exit === 'ok'), true);
});

test('v2 — a failed transport ends the turn as an error and rethrows the adapter error unchanged', async () => {
  const { g, port, host } = make();
  const p = host.run(memberOpts(), member('n_a')); await tick();
  const err = Object.assign(new Error('claude exited with code 1: boom'), { errorClass: 'network', stream: 'err' });
  g.fail(0, err);
  await assert.rejects(p, (e) => e === err);
  assert.equal(port.records.at(-1).exit, 'error');
});

test('v2 — noteVerdict joins the execution\'s latest dispatch (C5); an execution no host ran writes nothing', async () => {
  const { g, port, hosts, host } = make();
  for (let i = 0; i < 2; i += 1) { const p = host.run(memberOpts(), member('n_a')); await tick(); g.ok(i); await p; }
  hosts.noteVerdict('x:n_a:1', { verdict: 'blocking', issues: 3 });
  hosts.noteVerdict('x:n_zz:1', { verdict: 'clean', issues: 0 });
  const v = port.records.filter((r) => r.kind === 'verdict');
  assert.equal(v.length, 1);
  assert.deepEqual([v[0].dispatchId, v[0].executionId, v[0].nodeId, v[0].verdict, v[0].issues], ['d:x:n_a:1:a2', 'x:n_a:1', 'n_a', 'blocking', 3]);
  hosts.noteVerdict('x:n_a:1', { verdict: 'clean' });
  hosts.noteVerdict('x:n_a:1', { verdict: 'none', issues: 'many' });
  assert.deepEqual(port.records.filter((r) => r.kind === 'verdict').slice(1).map((r) => r.issues), [0, 0], 'v4: no count, or not a number: 0');
});

test('v2 — snapshot() is the HostSnapshot; close: pause on paused, close on the rest, once; a separate session writes the short trace (C27)', async () => {
  const { g, port, hosts, host } = make();
  const p = host.run(memberOpts(), member('n_a')); await tick(); g.ok(0); await p;
  const s = hosts.snapshot()[SID];
  assert.deepEqual(Object.keys(s), ['sid', 'mode', 'degradeReason', 'engine', 'hostEpoch', 'hostSessionId', 'hostResolvedModel', 'turns', 'dispatches',
    'epochDispatches', 'rotations', 'restarts', 'attempts', 'consecutiveWatchdog', 'lastContextTokens', 'lastCumulativeUsd', 'epochOpeningUsd', 'openCut', 'status']);
  assert.deepEqual([s.sid, s.mode, s.degradeReason, s.engine, s.hostEpoch, s.turns, s.dispatches, s.epochDispatches, s.attempts, s.openCut, s.status],
    [SID, 'subagents', null, 'claude', 1, 1, 1, 1, { 'x:n_a:1': 1 }, null, 'idle']);
  await hosts.close('done');
  await hosts.close('done');
  const c = port.records.filter((r) => r.kind === 'close');
  assert.equal(c.length, 1, 'once');
  assert.deepEqual([c[0].status, c[0].turns, c[0].dispatches, c[0].rotations, c[0].restarts], ['done', 1, 1, 0, 0]);
  assert.equal(port.summary.status, 'done');
  const paused = make();
  await paused.hosts.close('paused');
  assert.deepEqual(paused.port.records.map((r) => r.kind), ['open', 'mode', 'pause']);
  assert.equal(paused.hosts.snapshot()[SID].status, 'paused');
  const sepPort = fakePort();
  const sep = createSessionHosts({ specs: [spec()], decisions: decisions('separate'), port: sepPort, transport: gatedTransport().transport });
  await sep.close('stopped');
  assert.deepEqual(sepPort.records.map((r) => r.kind), ['open', 'mode', 'degrade', 'close']);
  const deg = sepPort.records[2];
  assert.deepEqual([deg.from, deg.to, deg.reason], ['subagents', 'separate', 'the Labs flag sessionGroups is off']);
  assert.deepEqual([sepPort.records[0].mode, sepPort.records[0].transport, sepPort.records[0].label, sepPort.records[0].members],
    ['separate', SESSION_TRANSPORT, 'One session', ['n_a', 'n_b']]);
  assert.equal(sep.snapshot()[SID].degradeReason, 'the Labs flag sessionGroups is off');
  assert.equal(sep.modeOf('n_zz'), null);
  assert.equal(sep.sidOf('n_zz'), null);
});

test('v2 — a spec the gate decided nothing for runs separate', () => {
  const port = fakePort();
  const hosts = createSessionHosts({ specs: [spec()], decisions: new Map(), port, transport: gatedTransport().transport });
  assert.equal(hosts.hostFor('n_a'), null);
  assert.equal(hosts.modeOf('n_a'), 'separate');
  assert.equal(port.records.at(-1).kind, 'degrade');
});

test('v2 — defaultTransport plays a mock host turn offline, with the raw frames the demux routes', async () => {
  const frames = [];
  const out = await defaultTransport({ mock: true, cwd: mkdtempSync(join(tmpdir(), 'sess-dt-')), prompt: 'Dispatch with subagent_type "worca-x-n_a-1-a1".',
    agents: { 'worca-x-n_a-1-a1': { prompt: 'SYS' } }, onEvent: (e) => frames.push(e) });
  assert.equal(frames.find((f) => f.raw?.type === 'system')?.raw.subtype, 'init', 'a raw system/init envelope, not a normalized event');
  assert.equal(out.exitCode, 0);
});

test('v2 — cold: any earlier attempt, a resumed row or a cold re-dispatch; the label falls back to the node, then the execution', async () => {
  const { g, port, host } = make();
  const runs = [[{ resumeSessionId: 'S' }, member('n_a')], [{ coldRedispatch: true }, member('n_b')], [{}, { nodeId: 'n_a', executionId: 'x:n_a:2' }],
    [{}, { executionId: 'x:n_c:1' }]];
  for (const [i, [over, m]] of runs.entries()) { const p = host.run({ ...memberOpts(), ...over }, m); await tick(); g.ok(i); await p; }
  assert.deepEqual(port.records.filter((r) => r.kind === 'dispatch').map((r) => r.cold), [true, true, false, false]);
  assert.match(g.calls[2].hostOpts.prompt, /\(n_a\) now/);
  assert.match(g.calls[3].hostOpts.prompt, /\(x:n_c:1\) now/);
});

// ── v3: close against a turn in flight; an abort between leaving the queue and starting ──

test('v3 — close waits for the turn in flight and refuses the waiters; a run after close is refused', async () => {
  const { g, port, hosts, host } = make();
  const p1 = host.run(memberOpts(), member('n_a'));
  const p2 = host.run(memberOpts(), member('n_b'));
  await tick();
  let closed = false;
  const c = hosts.close('stopped').then(() => { closed = true; });
  await assert.rejects(p2, (e) => e.name === 'AbortError');
  await tick();
  assert.equal(closed, false, 'the turn in flight has not settled yet');
  assert.equal(port.records.some((r) => r.kind === 'close'), false);
  g.ok(0); await p1; await c;
  const kinds = port.records.map((r) => r.kind);
  assert.equal(kinds.at(-1), 'close');
  assert.ok(kinds.includes('turn_end') && kinds.indexOf('turn_end') < kinds.indexOf('close'), 'the turn\'s records come before close');
  assert.equal(g.calls.length, 1, 'the refused waiter never spawned');
  assert.deepEqual(port.queued, [['x:n_b:1', true], ['x:n_b:1', false]]);
  await assert.rejects(host.run(memberOpts(), member('n_a')), (e) => e.name === 'AbortError');
  assert.equal(g.calls.length, 1, 'nothing runs after close');
});

test('v3 — a waiter aborted as it leaves the queue (before its turn starts) takes no attempt and writes nothing', async () => {
  const { g, port, hosts, host } = make();
  const b = new AbortController();
  port.onQueue = (x, q) => { port.queued.push([x, q]); if (x === 'x:n_b:1' && !q) b.abort(); };   // lands between dequeue and start
  const p1 = host.run(memberOpts(), member('n_a'));
  const refused = assert.rejects(host.run(memberOpts({ signal: b.signal }), member('n_b')), (e) => e.name === 'AbortError');
  await tick();
  g.ok(0); await p1; await tick();
  assert.equal(g.calls.length, 1, 'never spawned');
  await refused;
  assert.equal(port.records.filter((r) => r.kind === 'dispatch').length, 1, 'no turn for it');
  assert.deepEqual(hosts.snapshot()[SID].attempts, { 'x:n_a:1': 1 });
});

// ── v4: a closed host's refusal is terminal unless paused; close as a waiter leaves the queue; no "queued" flash; one close ──

test('v4 — close(\'error\') refuses a waiter with a TERMINAL AbortError (the flow site must not turn the failed run into a pause); run 7: close(\'paused\') with the pause sentinel', async () => {
  const { g, hosts, host } = make();
  const p1 = host.run(memberOpts(), member('n_a'));
  const p2 = host.run(memberOpts(), member('n_b'));
  await tick();
  const c = hosts.close('error');
  await assert.rejects(p2, (e) => e.name === 'AbortError' && isTerminal(e));
  g.ok(0); await p1; await c;
  await assert.rejects(host.run(memberOpts(), member('n_a')), (e) => e.name === 'AbortError' && isTerminal(e), 'a run after close(\'error\') too');
  const paused = make();
  const q1 = paused.host.run(memberOpts(), member('n_a'));
  const q2 = paused.host.run(memberOpts(), member('n_b'));
  await tick();
  const pc = paused.hosts.close('paused');
  // Run 7 (Task 45): a run that ends paused WITHOUT a pause request (a non-terminal failure) closes 'paused' with waiters
  // still queued; a terminal refusal would record a terminal error and end that run stopped, so they get the pause sentinel.
  await assert.rejects(q2, (e) => e.name === 'PauseError' && !isTerminal(e), 'a waiter a pause-close refuses settles as paused');
  // v4 (Task 45): the turn in flight is cut by that close at once (as the pause that follows cuts an ungrouped step), and
  // answers with the same sentinel; the run never waits for a turn nobody will keep.
  assert.equal(paused.g.calls[0].hostOpts.signal.aborted, true, 'the close killed the turn in flight');
  paused.g.fail(0, Object.assign(new Error('aborted'), { name: 'AbortError' }));   // the killed process exits
  await assert.rejects(q1, (e) => e.name === 'PauseError' && !isTerminal(e), 'the turn in flight is cut and settles as paused');
  await pc;
  assert.equal(paused.g.calls.length, 1, 'the waiter never spawned');
  assert.equal(paused.port.records.at(-1).kind, 'pause');
  await assert.rejects(paused.host.run(memberOpts(), member('n_a')), (e) => e.name === 'PauseError', 'a run after close(\'paused\') too');
});

test('v4 — close landing as a waiter leaves the queue: the waiter never starts and nothing is written after close', async () => {
  const { g, port, hosts, host } = make();
  let c = null;
  port.onQueue = (x, q) => { port.queued.push([x, q]); if (x === 'x:n_b:1' && !q) c = hosts.close('error'); };   // between dequeue and start
  const p1 = host.run(memberOpts(), member('n_a'));
  const refused = assert.rejects(host.run(memberOpts(), member('n_b')), (e) => e.name === 'AbortError' && isTerminal(e));
  await tick();
  g.ok(0); await p1; await refused; await c;
  assert.equal(g.calls.length, 1, 'never spawned');
  assert.equal(port.records.at(-1).kind, 'close', 'nothing after close');
  assert.equal(port.records.filter((r) => r.kind === 'dispatch').length, 1);
});

test('v4 — a caller that runs again the moment its turn settles is never "queued" behind it (the executor\'s sideload retry)', async () => {
  const { g, port, host } = make();
  const p = host.run(memberOpts(), member('n_a')).then(() => host.run(memberOpts(), member('n_a')));
  await tick(); g.ok(0);
  while (g.calls.length < 2) await tick();
  g.ok(1); await p;
  assert.deepEqual(port.queued, [], 'C39: an idle host never says "queued"');
  assert.deepEqual(port.records.filter((r) => r.kind === 'dispatch').map((r) => r.attempt), [1, 2]);
});

test('v4 — a second close() waits for the first: one promise, one close record', async () => {
  const { g, port, hosts, host } = make();
  const p1 = host.run(memberOpts(), member('n_a')); await tick();
  const c1 = hosts.close('done'); const c2 = hosts.close('done');
  let second = false;
  c2.then(() => { second = true; });
  await tick();
  assert.equal(second, false, 'the turn in flight holds the second caller too');
  g.ok(0); await p1; await c1; await c2;
  assert.equal(port.records.filter((r) => r.kind === 'close').length, 1);
});

test('v4 — decisions as a plain object keyed by sid are read too (39-2)', () => {
  const hosts = createSessionHosts({ specs: [spec()], decisions: { [SID]: { mode: 'subagents', requested: 'subagents', reason: 'ok', firstMemberModel: null } },
    port: fakePort(), transport: gatedTransport().transport });
  assert.ok(hosts.hostFor('n_a'));
  assert.equal(hosts.modeOf('n_b'), 'subagents');
});

test('v4 — C37: a waiter that queued behind a turn passes the cost gate again before it starts (the spend moved while it waited)', async () => {
  const { g, port, host } = make();
  const pause = Object.assign(new Error('paused'), { name: 'PauseError' });
  let gate = 0;
  port.checkCostLimits = () => { gate += 1; throw pause; };
  const p1 = host.run(memberOpts(), member('n_a'));
  const refused = assert.rejects(host.run(memberOpts(), member('n_b')), (e) => e === pause);
  await tick();
  assert.equal(gate, 0, 'a dispatch that never waited: the executor\'s own gate stands');
  g.ok(0); await p1; await refused;
  assert.equal(gate, 1);
  assert.equal(g.calls.length, 1, 'never spawned');
  assert.equal(port.records.filter((r) => r.kind === 'dispatch').length, 1, 'no attempt, no record');
});

test('v4 — Stop mid-turn whose process then dies with a plain error still rejects as an abort', async () => {
  const { g, port, host } = make();
  const a = new AbortController();
  const p = host.run(memberOpts({ signal: a.signal }), member('n_a'));
  await tick();
  a.abort();
  g.fail(0, new Error('claude exited with code 143'));
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.equal(port.records.at(-1).exit, 'aborted');
});

// ── v5: the mock taken from the environment alone ──

test('v5 — defaultTransport takes the mock from WORCA_MOCK alone (no opts.mock, as a run started under WORCA_MOCK=1): the raw frames the demux routes', async () => {
  const prev = { WORCA_MOCK: process.env.WORCA_MOCK, ORCH_MOCK: process.env.ORCH_MOCK };
  process.env.WORCA_MOCK = '1';
  delete process.env.ORCH_MOCK;
  try {
    const frames = [];
    const out = await defaultTransport({ cwd: mkdtempSync(join(tmpdir(), 'sess-dt-')), prompt: 'Dispatch with subagent_type "worca-x-n_a-1-a1".',
      agents: { 'worca-x-n_a-1-a1': { prompt: 'SYS' } }, onEvent: (e) => frames.push(e) });
    assert.equal(frames.find((f) => f.raw?.type === 'system')?.raw.subtype, 'init', 'the offline host, never runClaude\'s normalized mock (no Agent call there)');
    assert.equal(out.exitCode, 0);
  } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
