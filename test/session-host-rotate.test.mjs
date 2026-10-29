// test/session-host-rotate.test.mjs — long sessions rotate, a refused child moves to a fresh host, the budget stops a turn,
// and a main agent that keeps misbehaving degrades its session instead of parking the run.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionHosts, HOST_ROTATE_DISPATCHES, HOST_ROTATE_CONTEXT_TOKENS, HOST_BUDGET_IS_CUMULATIVE, HOST_MAIN_THREAD_GUARD,
  HOST_GUARD_CONTEXT_FIELD, HOST_DEGRADE_AFTER } from '../src/core/session-host.mjs';
import { runMockSession, _testing as mockT } from '../src/core/engines/mock-session.mjs';
import { SID, spec, decisions, fakePort, member, mockMember, okFrames, framesTransport } from './helpers/session-host-fakes.mjs';
import { HOST_MAX_TURNS } from '../src/core/engines/session-dispatch.mjs';
import { RECOVERY_MAX_AUTO_ATTEMPTS } from '../src/core/failure-policy.mjs';
import { sessionHostGuardSettings } from '../src/core/session-host-guard.mjs';
import { isTerminal } from '../src/core/failure-policy.mjs';

beforeEach(() => { mockT.resetSessions(); mockT.behave = null; mockT.costFor = () => 0.25; });
const seen = [];
const spy = (o) => { seen.push(o); return runMockSession(o); };
const build = (portOver = {}, limits = {}, extra = {}) => {
  const port = fakePort(portOver);
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: spy, limits, ...extra });
  return { port, hosts, host: hosts.hostFor('n_a') };
};

test('every host turn carries --max-turns 4 and the remaining budget plus the cumulative baseline', async () => {
  seen.length = 0;
  const { host, hosts } = build({ remainingBudgetUsd: () => 2.5 });
  await host.run(mockMember('x:n_a:1'), member('n_a'));
  await host.run(mockMember('x:n_b:1'), member('n_b'));
  assert.equal(seen[0].maxTurns, HOST_MAX_TURNS);
  assert.equal(seen[0].maxBudgetUsd, 2.5);
  assert.ok(Math.abs(seen[1].maxBudgetUsd - (2.5 + (HOST_BUDGET_IS_CUMULATIVE ? 0.25 : 0))) < 1e-9, 'S4: the flag counts the session total (Task 53 may record that it does not)');
  assert.ok(Math.abs(hosts.snapshot()[SID].lastCumulativeUsd - 0.5) < 1e-9, 'M-1: the snapshot carries it across a restart');
});

test('rotation after N dispatches: a fresh session, epoch 2, a rotate record with its epoch check', async () => {
  seen.length = 0;
  const { port, host } = build({}, { rotateDispatches: 2 });
  for (const n of [1, 2, 3]) await host.run(mockMember(`x:n_a:${n}`), member('n_a', n));
  assert.ok(seen[1].resumeSessionId);
  assert.equal(seen[2].resumeSessionId, undefined);
  const rot = port.records.find((r) => r.kind === 'rotate');
  assert.equal(rot.reason, 'dispatches');
  assert.equal(rot.epochCheck.ok, true);
  assert.ok(Math.abs(rot.epochCheck.harnessTotalUsd - 0.5) < 1e-9);
  assert.equal(port.records.at(-1).hostEpoch, 2);
});

test('rotation on host context (the last host message 1000 > limit 500)', async () => {
  const { port, host } = build({}, { rotateContextTokens: 500 });
  await host.run(mockMember('x:n_a:1'), member('n_a'));
  await host.run(mockMember('x:n_b:1'), member('n_b'));
  assert.equal(port.records.find((r) => r.kind === 'rotate').reason, 'context');
});

test('the per-session cap: one rotation and a retry on a fresh host with a FRESH attempt (C31); a second cap fails', async () => {
  const { port, host } = build();
  mockT.behave = ({ turn }) => (turn === 1 ? 'cap' : null);
  const out = await host.run(mockMember('x:n_a:1'), member('n_a'));
  assert.equal(out.exitCode, 0);
  assert.equal(port.records.find((r) => r.kind === 'rotate').reason, 'cap');
  const d = port.records.filter((r) => r.kind === 'dispatch');
  assert.deepEqual(d.map((r) => r.attempt), [1, 2]);
  assert.equal(d[1].queueMs, 0, 'v4: the retry waits for nothing');
  assert.equal(new Set(d.map((r) => r.dispatchId)).size, 2, 'M-5: per-turn rows never collide');
  mockT.behave = () => 'cap';
  await assert.rejects(host.run(mockMember('x:n_b:1'), member('n_b')), (e) => e.code === 'SESSION_HOST_CAP');
});

test('a vanished host session restarts once with a restart record and a fresh attempt', async () => {
  const { port, host } = build();
  await host.run(mockMember('x:n_a:1'), member('n_a'));
  mockT.behave = ({ resume }) => (resume ? 'vanished' : null);
  await host.run(mockMember('x:n_b:1'), member('n_b'));
  const r = port.records.find((x) => x.kind === 'restart');
  assert.deepEqual([r.reason, r.engine], ['vanished', 'claude']);
  assert.equal(port.records.at(-1).hostEpoch, 2);
  assert.deepEqual(port.records.filter((x) => x.kind === 'dispatch' && x.executionId === 'x:n_b:1').map((x) => x.attempt), [1, 2]);
});

test('M-2 — a turn cut by --max-budget-usd exits 1 after its result: booked, then the harness cost gate', async () => {
  const pause = Object.assign(new Error('paused'), { name: 'PauseError' });
  const { port, host } = build({ checkCostLimits: () => { throw pause; } });
  mockT.behave = () => 'budget';
  await assert.rejects(host.run(mockMember('x:n_a:1'), member('n_a')), (e) => e === pause);
  assert.equal(port.booked.length, 1, 'the cut turn\'s spend is booked before the gate');
  assert.equal(port.records.find((r) => r.kind === 'turn_end').exit, 'budget');
  const { host: h2 } = build({ checkCostLimits: () => {} });
  mockT.behave = () => 'budget';
  await assert.rejects(h2.run(mockMember('x:n_a:1'), member('n_a')), (e) => e.code === 'SESSION_HOST_BUDGET');
  mockT.behave = () => 'max-turns';
  await assert.rejects(h2.run(mockMember('x:n_a:1'), member('n_a')), (e) => e.code === 'SESSION_HOST_NO_DISPATCH' && e.detail.maxTurns === HOST_MAX_TURNS);
});

test('REVIEW FOCUS 2 / C30 — degrade after repeated watchdog failures: the next attempt runs as a plain spawn', async () => {
  const plain = [];
  const { port, hosts, host } = build({}, { degradeAfter: 3 }, { plainRun: async (o) => { plain.push(o); return { text: 'PLAIN', exitCode: 0 }; } });
  mockT.behave = () => 'no-dispatch';
  for (let i = 0; i < 3; i += 1) await assert.rejects(host.run(mockMember('x:n_a:1'), member('n_a')), (e) => e.code === 'SESSION_HOST_NO_DISPATCH');
  const deg = port.records.find((r) => r.kind === 'degrade');
  assert.deepEqual([deg.from, deg.to, deg.reason], ['subagents', 'separate', 'the main agent did not dispatch']);
  assert.ok(port.audits.some((l) => /runs as separate sessions — the main agent did not dispatch/.test(l)));
  const out = await host.run({ ...mockMember('x:n_a:1'), resumeSessionId: 'mock-host-1' }, member('n_a'));
  assert.equal(out.text, 'PLAIN');
  assert.equal(plain[0].resumeSessionId, undefined, 'never --resume the host transcript as a plain spawn');
  assert.equal(hosts.snapshot()[SID].mode, 'separate');
  assert.equal(port.records.filter((r) => r.kind === 'turn_start').length, 3, 'a degraded dispatch writes no turn');
});

// ── v2: the Interfaces sentences the master's tests leave open ──
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m ?? ''} ${a} vs ${b}`);

test('v2 — the constants keep the safe defaults (the one pin of them: Task 53 updates it when it records S1/S3/S4/S6); HOST_DEGRADE_AFTER rides the recovery budget', () => {
  assert.deepEqual([HOST_ROTATE_DISPATCHES, HOST_ROTATE_CONTEXT_TOKENS, HOST_BUDGET_IS_CUMULATIVE, HOST_MAIN_THREAD_GUARD, HOST_GUARD_CONTEXT_FIELD],
    [24, 120000, true, false, null]);
  assert.equal(HOST_DEGRADE_AFTER, RECOVERY_MAX_AUTO_ATTEMPTS);
});

test('v2 — the budget: omitted with no cap, recorded on turn_start, floored at a cent', async () => {
  seen.length = 0;
  const { port, host } = build();
  await host.run(mockMember('x:n_a:1'), member('n_a'));
  assert.equal('maxBudgetUsd' in seen[0], false, 'no cap: no --max-budget-usd');
  assert.equal(port.records.find((r) => r.kind === 'turn_start').maxBudgetUsd, null);
  const low = build({ remainingBudgetUsd: () => -1 });
  seen.length = 0;
  await low.host.run(mockMember('x:n_a:1'), member('n_a'));
  assert.equal(seen[0].maxBudgetUsd, 0.01);
  assert.equal(low.port.records.find((r) => r.kind === 'turn_start').maxBudgetUsd, 0.01);
  const thrower = build({ remainingBudgetUsd: () => { throw new Error('x'); } });
  seen.length = 0;
  await thrower.host.run(mockMember('x:n_a:1'), member('n_a'));
  assert.equal('maxBudgetUsd' in seen[0], false, 'a failing budget read never fails the turn');
});

test('v2 — the rotate record: ids, counts, the epoch check; the new epoch starts clean', async () => {
  const { port, hosts, host } = build({}, { rotateDispatches: 2 });
  for (const n of [1, 2]) await host.run(mockMember(`x:n_a:${n}`), member('n_a', n));
  const before = hosts.snapshot()[SID];
  await host.run(mockMember('x:n_a:3'), member('n_a', 3));
  const rot = port.records.find((r) => r.kind === 'rotate');
  assert.deepEqual([rot.fromSessionId, rot.fromEpoch, rot.dispatches, rot.contextTokens, rot.hostEpoch, rot.hostSessionId],
    [before.hostSessionId, 1, 2, 1000, 1, before.hostSessionId]);
  assert.deepEqual([rot.epochCheck.epoch, rot.epochCheck.bookedUsd], [1, 0.5]);
  const after = hosts.snapshot()[SID];
  assert.deepEqual([after.hostEpoch, after.rotations, after.epochDispatches, after.dispatches], [2, 1, 1, 3]);
  assert.notEqual(after.hostSessionId, before.hostSessionId);
  near(after.lastCumulativeUsd, 0.25, 'the new host\'s own cumulative');
  assert.equal(port.audits.some((l) => /rotated to a fresh host session \(dispatches; epoch 2\)/.test(l)), true);
  await hosts.close('done');
  const c = port.records.at(-1);
  assert.deepEqual(c.epochChecks.map((x) => [x.epoch, x.ok]), [[1, true], [2, true]], 'close carries every epoch\'s check');
  assert.equal(c.rotations, 1);
});

test('v2 — a cut on the old epoch is booked as an estimate before the rotate (it can never be carried)', async () => {
  const { port, hosts, host } = build({}, { rotateDispatches: 1 });
  mockT.behave = ({ turn }) => (turn === 1 ? 'host-error-after-member' : null);
  await host.run(mockMember('x:n_a:1'), member('n_a'));
  assert.ok(hosts.snapshot()[SID].openCut);
  await host.run(mockMember('x:n_b:1'), member('n_b'));
  const kinds = port.records.map((r) => r.kind);
  const cut = port.records.find((r) => r.kind === 'cost' && r.cut);
  assert.deepEqual([cut.executionId, cut.costSource], ['x:n_a:1', 'estimate']);
  assert.ok(kinds.indexOf('cost') < kinds.indexOf('rotate'));
  assert.equal(port.booked.filter((b) => b.carried).length, 0, 'nothing carried across epochs');
});

test('v2 — a member-level cap refusal rotates before the NEXT dispatch, not mid-turn', async () => {
  const frames = (o, i) => {
    const f = okFrames({ agentType: /subagent_type "([^"]+)"/.exec(o.prompt)[1], hostSessionId: o.resumeSessionId || `H${i + 1}` });
    if (i === 0) {
      f.splice(2, 0, { type: 'assistant', parent_tool_use_id: 'T1', message: { id: 'c0', content: [{ type: 'tool_use', id: 'I1', name: 'Agent', input: { subagent_type: 'worca-investigator' } }] } },
        { type: 'user', parent_tool_use_id: 'T1', message: { content: [{ type: 'tool_result', tool_use_id: 'I1', is_error: true, content: [{ type: 'text', text: 'Subagent limit reached for this session' }] }] } });
    }
    return f;
  };
  const t = framesTransport(frames);
  const port = fakePort();
  const host = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: t.transport }).hostFor('n_a');
  await host.run(mockMember('x:n_a:1'), member('n_a'));
  assert.equal(port.records.some((r) => r.kind === 'rotate'), false, 'the turn itself finished');
  assert.equal(port.records.find((r) => r.kind === 'watchdog').code, 'member-cap-refused');
  await host.run(mockMember('x:n_b:1'), member('n_b'));
  assert.equal(port.records.find((r) => r.kind === 'rotate').reason, 'cap');
  assert.equal(t.calls[1].resumeSessionId, undefined, 'the next dispatch runs on a fresh host');
  await host.run(mockMember('x:n_b:2'), member('n_b', 2));
  assert.equal(port.records.filter((r) => r.kind === 'rotate').length, 1, 'once');
});

test('v2 — the cap: a warn on the refused child, an error when the retry is refused too; never counted toward degrade', async () => {
  const { port, hosts, host } = build({}, { degradeAfter: 1 });
  mockT.behave = () => 'cap';
  await assert.rejects(host.run(mockMember('x:n_a:1'), member('n_a')), (e) => e.code === 'SESSION_HOST_CAP' && e.errorClass === 'session_host');
  const w = port.records.filter((r) => r.kind === 'watchdog');
  assert.deepEqual(w.map((x) => [x.code, x.level]), [['SESSION_HOST_CAP', 'warn'], ['SESSION_HOST_CAP', 'error']]);
  assert.deepEqual(hosts.snapshot()[SID].attempts, { 'x:n_a:1': 2 });
  assert.equal(hosts.snapshot()[SID].mode, 'subagents');
  assert.equal(port.audits.filter((l) => /dispatch d:x:n_a:1:a2 failed — SESSION_HOST_CAP/.test(l)).length, 1);
});

test('v2 — the restart record: reason, old id, engine, transport, epoch check; a retry that fails again is the adapter\'s error', async () => {
  const { port, hosts, host } = build();
  await host.run(mockMember('x:n_a:1'), member('n_a'));
  const old = hosts.snapshot()[SID].hostSessionId;
  mockT.behave = ({ resume }) => (resume ? 'vanished' : 'sideload-refused');
  await assert.rejects(host.run(mockMember('x:n_b:1', [], { pluginDirs: ['/p'] }), member('n_b')), (e) => e.name !== 'SessionHostError' && /exited with code 1/.test(e.message));
  const r = port.records.find((x) => x.kind === 'restart');
  assert.deepEqual([r.fromSessionId, r.transport, r.epochCheck.epoch, r.epochCheck.ok, r.hostEpoch], [old, 'turns', 1, true, 1]);
  assert.equal(port.records.filter((x) => x.kind === 'restart').length, 1, 'exactly one restart per dispatch');
  assert.deepEqual([hosts.snapshot()[SID].restarts, hosts.snapshot()[SID].hostEpoch], [1, 2]);
  assert.ok(port.audits.some((l) => /restarted fresh \(vanished\)/.test(l)));
});

test('v2 — a Stop between the failure and the retry: no retry', async () => {
  const ac = new AbortController();
  const t = framesTransport(() => [], { fail: () => new Error('No conversation found with session ID: H1') });
  // v3: the Stop lands AFTER the turn's outcome is decided (its turn_end), so only the retry guard can refuse it.
  const port = fakePort({ onRecord(sid, r) { port.records.push(r); if (r.kind === 'turn_end') ac.abort(); } });
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: t.transport });
  hosts.hosts.get(SID).hostSessionId = 'H1';
  await assert.rejects(hosts.hostFor('n_a').run(mockMember('x:n_a:1', [], { signal: ac.signal }), member('n_a')), (e) => e.name === 'AbortError');
  assert.equal(t.calls.length, 1);
  assert.equal(port.records.some((r) => r.kind === 'restart'), false);
});

test('v2 — a clean member result wins over a budget or max-turns stop after it (C12): the step is kept, the next gate pauses', async () => {
  for (const subtype of ['error_max_budget_usd', 'error_max_turns']) {
    const frames = (o) => okFrames({ agentType: /subagent_type "([^"]+)"/.exec(o.prompt)[1], subtype });
    const t = framesTransport(frames, { fail: () => new Error('claude exited with code 1') });
    const port = fakePort({ checkCostLimits: () => { throw new Error('must not gate here'); } });
    const out = await createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: t.transport }).hostFor('n_a').run(mockMember('x:n_a:1'), member('n_a'));
    assert.equal(out.text, 'REPORT', subtype);
    assert.equal(port.records.find((r) => r.kind === 'turn_end').exit, 'error');
  }
});

test('v2 — a budget stop is not the main agent\'s fault (no degrade); a max-turns loop is (watchdog error, counted)', async () => {
  const { port, hosts, host } = build({}, { degradeAfter: 2 });
  mockT.behave = () => 'budget';
  for (let i = 0; i < 2; i += 1) await assert.rejects(host.run(mockMember('x:n_a:1'), member('n_a')), (e) => e.code === 'SESSION_HOST_BUDGET');
  assert.deepEqual([hosts.snapshot()[SID].consecutiveWatchdog, hosts.snapshot()[SID].mode], [0, 'subagents']);
  assert.equal(port.records.some((r) => r.kind === 'watchdog'), false);
  mockT.behave = () => 'max-turns';
  for (let i = 0; i < 2; i += 1) await assert.rejects(host.run(mockMember('x:n_a:1'), member('n_a')), (e) => e.code === 'SESSION_HOST_NO_DISPATCH');
  const w = port.records.filter((r) => r.kind === 'watchdog');
  assert.deepEqual(w.map((x) => [x.level, x.code, x.detail.maxTurns]), [['error', 'SESSION_HOST_NO_DISPATCH', 4], ['error', 'SESSION_HOST_NO_DISPATCH', 4]]);
  assert.deepEqual(port.records.filter((r) => r.kind === 'turn_end').map((r) => r.exit), ['budget', 'budget', 'max_turns', 'max_turns']);
  assert.equal(hosts.snapshot()[SID].mode, 'separate');
});

test('v2 — degrade: the default threshold, a waiter queued behind the failing turn runs plain, hostFor still answers, the reason sticks', async () => {
  const plain = [];
  const { port, hosts, host } = build({}, {}, { plainRun: async (o) => { plain.push(o); return { text: 'PLAIN', exitCode: 0 }; } });
  mockT.behave = () => 'no-dispatch';
  for (let i = 0; i < HOST_DEGRADE_AFTER - 1; i += 1) await assert.rejects(host.run(mockMember('x:n_a:1'), member('n_a')));
  assert.equal(port.records.some((r) => r.kind === 'degrade'), false, 'one short of the threshold');
  const failing = host.run(mockMember('x:n_a:1'), member('n_a'));
  const waiter = host.run(mockMember('x:n_b:1'), member('n_b'));
  await assert.rejects(failing, (e) => e.code === 'SESSION_HOST_NO_DISPATCH');
  assert.equal((await waiter).text, 'PLAIN');
  assert.equal(hosts.hostFor('n_a'), host, 'the executor still hands it the run; it runs plain');
  assert.deepEqual([hosts.modeOf('n_b'), hosts.snapshot()[SID].degradeReason, port.summary.mode, port.summary.status], ['separate', 'the main agent did not dispatch', 'separate', 'separate']);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(host.run(mockMember('x:n_a:1', [], { signal: ac.signal }), member('n_a')), (e) => e.name === 'AbortError');
  assert.equal(plain.length, 1, 'an aborted signal still rejects at once');
});

test('v2 — C40: with the guard on and a proven field, every union host spawn carries sessionHostGuardSettings; off (the default) or with no field, none', async () => {
  seen.length = 0;
  await build({}, { mainThreadGuard: false, guardField: 'agent_id' }).host.run(mockMember('x:n_a:1'), member('n_a'));
  assert.equal('mainThreadGuard' in seen[0], false, 'the guard off: none, whatever the field');
  seen.length = 0;
  await build({}, { mainThreadGuard: true, guardField: null }).host.run(mockMember('x:n_a:1'), member('n_a'));
  assert.equal('mainThreadGuard' in seen[0], false, 'v3: no proven field, no guard (it would allow everything)');
  seen.length = 0;
  await build({}, { mainThreadGuard: true, guardField: 'agent_id,agent_type' }).host.run(mockMember('x:n_a:1'), member('n_a'));
  assert.deepEqual(seen[0].mainThreadGuard, sessionHostGuardSettings({ field: 'agent_id,agent_type' }));
});

// ── v2 sweep: rules the mechanical mutation sweep showed unpinned ──
test('sweep — the context limit is inclusive; a rotation clears the epoch\'s gauge and cumulative before the next turn', async () => {
  const { port } = await (async () => {
    const b = build({}, { rotateContextTokens: 1000 });
    await b.host.run(mockMember('x:n_a:1'), member('n_a'));
    await b.host.run(mockMember('x:n_b:1'), member('n_b'));
    return b;
  })();
  assert.equal(port.records.find((r) => r.kind === 'rotate').reason, 'context', '1000 tokens at a 1000 limit rotates');
  seen.length = 0;
  const b2 = build({ remainingBudgetUsd: () => 2.5 }, { rotateDispatches: 2 });
  for (const n of [1, 2, 3]) await b2.host.run(mockMember(`x:n_a:${n}`), member('n_a', n));
  assert.equal(seen[2].maxBudgetUsd, 2.5, 'the new host\'s cumulative starts at 0');
  const frames = (o, i) => {
    const f = okFrames({ agentType: /subagent_type "([^"]+)"/.exec(o.prompt)[1], hostSessionId: o.resumeSessionId || `H${i + 1}` });
    return i === 0 ? f : f.map((x) => (x.type === 'assistant' && !x.parent_tool_use_id ? { ...x, message: { ...x.message, usage: undefined } } : x));
  };
  const t = framesTransport(frames);
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port: fakePort(), transport: t.transport, limits: { rotateDispatches: 1 } });
  await hosts.hostFor('n_a').run(mockMember('x:n_a:1'), member('n_a'));
  await hosts.hostFor('n_a').run(mockMember('x:n_b:1'), member('n_b'));
  assert.equal(hosts.snapshot()[SID].lastContextTokens, 0, 'the old epoch\'s gauge is gone (the new turn reported none)');
});

test('sweep — a remaining budget of exactly $0 still sends the floor', async () => {
  seen.length = 0;
  await build({ remainingBudgetUsd: () => 0 }).host.run(mockMember('x:n_a:1'), member('n_a'));
  assert.equal(seen[0].maxBudgetUsd, 0.01);
});

test('sweep — exits and details: the vanished turn ends in error; a refused child killed after its refusal is a cap with an error exit', async () => {
  const { port, host } = build();
  await host.run(mockMember('x:n_a:1'), member('n_a'));
  mockT.behave = ({ resume }) => (resume ? 'vanished' : null);
  await host.run(mockMember('x:n_b:1'), member('n_b'));
  assert.deepEqual(port.records.filter((r) => r.kind === 'turn_end').map((r) => r.exit), ['ok', 'error', 'ok']);
  const frames = (o) => {
    const [init, call] = okFrames({ agentType: /subagent_type "([^"]+)"/.exec(o.prompt)[1], hostSessionId: o.resumeSessionId || 'H1' });
    return [init, call,
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'T1', is_error: true, content: [{ type: 'text', text: 'Subagent limit reached for this session' }] }] } },
      { type: 'assistant', message: { id: 'h3', content: [{ type: 'tool_use', id: 'T2', name: 'Agent', input: { subagent_type: 'x' } }] } }];
  };
  const p2 = fakePort();
  const h2 = createSessionHosts({ specs: [spec()], decisions: decisions(), port: p2, transport: framesTransport(frames).transport }).hostFor('n_a');
  await assert.rejects(h2.run(mockMember('x:n_a:1'), member('n_a')), (e) => e.code === 'SESSION_HOST_CAP' && e.detail.capRefused === true);
  assert.deepEqual(p2.records.filter((r) => r.kind === 'turn_end').map((r) => r.exit), ['error', 'error']);
  assert.deepEqual(p2.records.filter((r) => r.kind === 'watchdog' && r.code === 'SESSION_HOST_CAP').map((r) => r.detail), [{ capRefused: true }, { capRefused: true }]);
});

test('sweep — reconciled is false when ONE epoch check of several fails', async () => {
  let k = 0;
  const port = fakePort({ bookTurn: (b) => { k += 1; return { deltaUsd: 0.25, memberUsd: k === 1 ? 0.25 : 0.1, hostOverheadUsd: 0, costSource: 'harness', hostPriced: true, overridden: false, carried: null, reconcile: { ok: true, checks: [] } }; } });
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: spy, limits: { rotateDispatches: 1 } });
  await hosts.hostFor('n_a').run(mockMember('x:n_a:1'), member('n_a'));
  await hosts.hostFor('n_a').run(mockMember('x:n_b:1'), member('n_b'));
  await hosts.close('done');
  const c = port.records.at(-1);
  assert.deepEqual(c.epochChecks.map((x) => x.ok), [true, false]);
  assert.equal(c.reconciled, false);
  assert.equal(port.summary.reconciled, false);
});

// ── v3 ──

test('v3 — the budget read names the turn\'s known models (the harness withholds it when one is priced apart from the CLI\'s meter)', async () => {
  const asked = [];
  const { host } = build({ remainingBudgetUsd: (q) => { asked.push(q); return null; } });
  await host.run(mockMember('x:n_a:1'), member('n_a'));
  await host.run(mockMember('x:n_b:1', [], { model: undefined }), member('n_b'));
  assert.deepEqual(asked, [{ models: ['claude-opus-5-5'] }], 'the member\'s own model; v4: a member on the CLI default is never asked (below)');
});

test('v3 — a cap or vanished retry passes the cost gate first (C37); a reached cap stops it before any rotate or spawn', async () => {
  const gate = [];
  const { host } = build({ checkCostLimits: () => { gate.push(1); } });
  mockT.behave = ({ turn }) => (turn === 1 ? 'cap' : null);
  await host.run(mockMember('x:n_a:1'), member('n_a'));
  assert.equal(gate.length, 1, 'once, before the retry');
  mockT.resetSessions();
  const pause = Object.assign(new Error('paused'), { name: 'PauseError' });
  const b = build({ checkCostLimits: () => { throw pause; } });
  mockT.behave = ({ turn }) => (turn === 1 ? 'cap' : null);
  seen.length = 0;
  await assert.rejects(b.host.run(mockMember('x:n_a:1'), member('n_a')), (e) => e === pause);
  assert.equal(seen.length, 1, 'no retry spawned');
  assert.equal(b.port.records.some((r) => r.kind === 'rotate'), false);
});

test('v3 — after a degrade, a verdict on the plain run is not written onto the failed host turn', async () => {
  const { port, hosts, host } = build({}, { degradeAfter: 1 }, { plainRun: async () => ({ text: 'PLAIN', exitCode: 0 }) });
  mockT.behave = () => 'no-dispatch';
  await assert.rejects(host.run(mockMember('x:n_a:1'), member('n_a')), (e) => e.code === 'SESSION_HOST_NO_DISPATCH');
  assert.equal((await host.run(mockMember('x:n_a:1'), member('n_a'))).text, 'PLAIN');
  hosts.noteVerdict('x:n_a:1', { verdict: 'clean', issues: 0 });
  assert.equal(port.records.some((r) => r.kind === 'verdict'), false);
});

// ── v4: the cap on any retry, a degrade's held cut, a closed host, vanished before init, the budget's model ──

test('v4 — a cap refusal on the vanished host\'s retry fails the dispatch: its record is an error (audited)', async () => {
  const { port, host } = build();
  await host.run(mockMember('x:n_a:1'), member('n_a'));
  mockT.behave = ({ resume }) => (resume ? 'vanished' : 'cap');
  await assert.rejects(host.run(mockMember('x:n_b:1'), member('n_b')), (e) => e.code === 'SESSION_HOST_CAP');
  assert.deepEqual(port.records.filter((r) => r.kind === 'watchdog' && r.code === 'SESSION_HOST_CAP').map((r) => r.level), ['error']);
  assert.ok(port.audits.some((l) => /SESSION_HOST_CAP/.test(l)), 'an error record is audited');
});

test('v4 — a degrade books the held cut at once, each cut turn on its own row (no host turn follows to carry it)', async () => {
  const { port, hosts, host } = build({}, { degradeAfter: 1 });
  mockT.behave = ({ turn }) => (turn === 1 ? 'host-error-after-member' : 'stray-bash');
  await host.run(mockMember('x:n_a:1'), member('n_a'));                   // kept (C12), but no result: a cut
  await assert.rejects(host.run(mockMember('x:n_b:1'), member('n_b')), (e) => e.code === 'SESSION_HOST_STRAY_TOOL');
  const kinds = port.records.map((r) => r.kind);
  assert.deepEqual(port.records.filter((r) => r.kind === 'cost' && r.cut).map((r) => r.executionId), ['x:n_a:1', 'x:n_b:1']);
  assert.ok(kinds.lastIndexOf('cost') < kinds.indexOf('degrade'), 'booked before the degrade');
  assert.equal(hosts.snapshot()[SID].openCut, null);
});

test('v4 — a host closed while its turn was in flight never retries: the vanished turn rejects with a terminal AbortError', async () => {
  let hosts = null;
  const t = framesTransport(() => [], { fail: () => new Error('No conversation found with session ID: H1') });
  const port = fakePort({ onRecord(sid, r) { port.records.push(r); if (r.kind === 'turn_end') hosts.close('stopped'); } });
  hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: t.transport });
  hosts.hosts.get(SID).hostSessionId = 'H1';
  await assert.rejects(hosts.hostFor('n_a').run(mockMember('x:n_a:1'), member('n_a')), (e) => e.name === 'AbortError' && isTerminal(e));
  await hosts.close('stopped');
  assert.equal(t.calls.length, 1);
  assert.equal(port.records.some((r) => r.kind === 'restart'), false);
  assert.equal(port.records.at(-1).kind, 'close');
});

test('v4 — C20: a resumed turn that failed AFTER its init did not vanish: the adapter\'s error, no restart', async () => {
  const t = framesTransport(() => [okFrames({ agentType: 'x', hostSessionId: 'H1' })[0]], { fail: () => new Error('No conversation found with session ID: H1') });
  const port = fakePort();
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: t.transport });
  hosts.hosts.get(SID).hostSessionId = 'H1';
  await assert.rejects(hosts.hostFor('n_a').run(mockMember('x:n_a:1'), member('n_a')), (e) => /No conversation found/.test(e.message) && !e.code);
  assert.equal(t.calls.length, 1);
  assert.equal(port.records.some((r) => r.kind === 'restart'), false);
});

test('v4 — a member on the CLI\'s default model (no model of its own, no host model) gets no --max-budget-usd: nothing can price it', async () => {
  const asked = [];
  const { port, host } = build({ remainingBudgetUsd: (q) => { asked.push(q); return 2; } });
  await host.run(mockMember('x:n_a:1', [], { model: undefined }), member('n_a'));
  assert.deepEqual([asked.length, port.records.find((r) => r.kind === 'turn_start').maxBudgetUsd], [0, null]);
  const pinned = build({ remainingBudgetUsd: (q) => { asked.push(q); return 2; } }, {}, { specs: [spec(['n_a', 'n_b'], { hostModel: 'claude-haiku-4-5' })] });
  await pinned.host.run(mockMember('x:n_a:1', [], { model: undefined }), member('n_a'));
  assert.deepEqual(asked, [{ models: ['claude-haiku-4-5'] }], 'a host model: the member inherits it, and it is known');
  assert.equal(pinned.port.records.find((r) => r.kind === 'turn_start').maxBudgetUsd, 2);
});

// ── v5: a degrade drains the queue; a degraded member resumes its own plain session; the budget and a held cut ──
const flush = () => new Promise((r) => setImmediate(r));

test('v5 — after a degrade, the waiters queued behind the failing turn start plain side by side, not one behind the other', async () => {
  const started = [];
  const release = [];
  const plainRun = (o) => new Promise((resolve) => { started.push(o); release.push(() => resolve({ text: 'PLAIN', exitCode: 0 })); });
  let gates = 0;
  const { port, host } = build({ checkCostLimits: () => { gates += 1; } }, { degradeAfter: 1 }, { plainRun });
  mockT.behave = () => 'no-dispatch';
  const failing = host.run(mockMember('x:n_a:1'), member('n_a'));
  const w1 = host.run(mockMember('x:n_b:1'), member('n_b'));
  const w2 = host.run(mockMember('x:n_a:2'), member('n_a', 2));
  await assert.rejects(failing, (e) => e.code === 'SESSION_HOST_NO_DISPATCH');
  await flush();
  assert.equal(started.length, 2, 'both waiters run at once, as ungrouped steps do');
  assert.deepEqual(port.queued.filter(([, q]) => !q).map(([x]) => x).sort(), ['x:n_a:2', 'x:n_b:1'], 'neither row still says "queued"');
  assert.equal(gates, 2, 'each waiter that queued passes the cost gate before it starts (C37)');
  release.forEach((f) => f());
  assert.deepEqual((await Promise.all([w1, w2])).map((o) => o.text), ['PLAIN', 'PLAIN']);
  assert.equal(port.records.filter((r) => r.kind === 'turn_start').length, 1, 'no host turn for them');
});

test('v5 — a drained waiter still hears its own abort or a close that lands as it leaves the queue: it never starts', async () => {
  const plain = [];
  const plainRun = async (o) => { plain.push(o); return { text: 'PLAIN', exitCode: 0 }; };
  const ac = new AbortController();
  const a = build({ onQueue: (x, q) => { if (!q && x === 'x:n_b:1') ac.abort(); } }, { degradeAfter: 1 }, { plainRun });
  mockT.behave = () => 'no-dispatch';
  const failing = a.host.run(mockMember('x:n_a:1'), member('n_a'));
  const aborted = a.host.run(mockMember('x:n_b:1', [], { signal: ac.signal }), member('n_b'));
  await assert.rejects(failing, (e) => e.code === 'SESSION_HOST_NO_DISPATCH');
  await assert.rejects(aborted, (e) => e.name === 'AbortError');
  let hosts = null;
  const c = build({ onQueue: (x, q) => { if (!q && x === 'x:n_b:1') hosts.close('error'); } }, { degradeAfter: 1 }, { plainRun });
  hosts = c.hosts;
  mockT.resetSessions();
  const failing2 = c.host.run(mockMember('x:n_a:1'), member('n_a'));
  const refused = c.host.run(mockMember('x:n_b:1'), member('n_b'));
  await assert.rejects(failing2, (e) => e.code === 'SESSION_HOST_NO_DISPATCH');
  await assert.rejects(refused, (e) => e.name === 'AbortError' && isTerminal(e));
  assert.equal(plain.length, 0, 'neither waiter ran');
});

test('v5 — a degraded member\'s follow-up round resumes ITS OWN plain session; a host id is still never resumed as a plain spawn (C30, C42)', async () => {
  const plain = [];
  const plainRun = async (o) => { plain.push(o); o.onEvent?.({ type: 'session', sessionId: `plain-${plain.length}` }); return { text: 'PLAIN', exitCode: 0 }; };
  const { host } = build({}, { degradeAfter: 1 }, { plainRun });
  mockT.behave = () => 'no-dispatch';
  await assert.rejects(host.run(mockMember('x:n_a:1'), member('n_a')));
  const ev = [];
  await host.run({ ...mockMember('x:n_a:1', ev), resumeSessionId: 'mock-host-1' }, member('n_a'));
  assert.equal(plain[0].resumeSessionId, undefined, 'the host transcript: never');
  assert.ok(ev.some((e) => e.type === 'session' && e.sessionId === 'plain-1'), 'the executor still hears the plain run\'s own events');
  await host.run({ ...mockMember('x:n_a:1'), resumeSessionId: 'plain-1' }, member('n_a'));
  assert.equal(plain[1].resumeSessionId, 'plain-1', 'a follow-up round (questions, form answers) resumes the session the plain run started, as ungrouped');
  await host.run({ ...mockMember('x:n_a:1'), resumeSessionId: 'someone-else' }, member('n_a'));
  assert.equal(plain[2].resumeSessionId, undefined, 'an id no plain run started here: dropped');
});

test('v5 — a held cut under a cost override: the budget gives back each part\'s list-minus-own gap (the CLI\'s cumulative holds the cut at list)', async () => {
  seen.length = 0;
  const { host } = build({ remainingBudgetUsd: () => 2 });
  const part = (n, cutUsd, cutListUsd) => ({ turnId: `t:0:${n}`, dispatchId: `d:${n}`, executionId: `x:n_a:${n}`, nodeId: 'n_a', cutUsd, cutListUsd,
    cutTokens: { in: 0, out: 0, cr: 0, cw: 0 } });
  const parts = [part(1, 0.1, 0.4), part(2, 0.2, 0.2)];
  host.openCut = { ...parts[0], cutUsd: 0.3, cutListUsd: 0.6, parts };   // as Task 47 restores it
  await host.run(mockMember('x:n_b:1'), member('n_b'));
  near(seen[0].maxBudgetUsd, 2 + (HOST_BUDGET_IS_CUMULATIVE ? 0.3 : 0), 'a {free}-ish cut part: the CLI already counts its 0.3 more than the books will');
});
