// test/session-host-turn.test.mjs — one host turn end to end on the offline host.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionHosts, HOST_CUT_COST_RESTORED, HOST_BUDGET_SUBTYPE, VANISHED_RE } from '../src/core/session-host.mjs';
import { runMockSession, _testing as mockT, MOCK_HOST_USAGE, MOCK_MEMBER_USAGE } from '../src/core/engines/mock-session.mjs';
import { priceUsage, usageTokens } from '../src/core/session-cost.mjs';
import { SID, spec, decisions, fakePort, member, mockMember as mkMember, okFrames, framesTransport } from './helpers/session-host-fakes.mjs';

beforeEach(() => { mockT.resetSessions(); mockT.behave = null; mockT.costFor = () => 0.25; mockT.resolvedModel = null; mockT.onMemberStart = null; });
const build = (port = fakePort()) => {
  const hosts = createSessionHosts({ specs: [spec(['n_a', 'n_b'], { hostModel: 'claude-haiku-4-5' })], decisions: decisions(), port, transport: runMockSession });
  return { port, hosts, host: hosts.hostFor('n_a') };
};

test('a clean turn: records in order, booking at the resolved host model, row stamp, member events, report', async () => {
  const { port, host } = build(); const ev = [];
  const out = await host.run(mkMember('x:n_a:1', ev), member('n_a'));
  assert.equal(out.exitCode, 0);
  assert.deepEqual(port.records.map((r) => r.kind), ['open', 'mode', 'turn_start', 'dispatch', 'member_bound', 'member_done', 'turn_end', 'cost', 'reconcile']);
  assert.equal(port.booked[0].stepKey, 'x:n_a:1');
  assert.equal(port.booked[0].hostModel, 'claude-haiku-4-5', 'C35: the init model');
  assert.ok(Math.abs(port.booked[0].cumulativeUsd - 0.2511) < 1e-12);
  assert.equal(port.records.find((r) => r.kind === 'turn_end').deltaUsd, port.booked[0].cumulativeUsd, 'minor 2: Δ is known before turn_end is written');
  assert.deepEqual(port.stamped.map((s) => s.ref.costSource ?? null), [null, 'harness'], 'a partial ref at bind, the full one after booking');
  const ref = port.stamped.at(-1).ref;
  assert.equal(ref.dispatchId, 'd:x:n_a:1:a1');
  assert.match(ref.hostSessionId, /^mock-host-/);
  assert.match(ref.memberTranscriptId, /^mock-agent-/);
  assert.equal(ev.find((e) => e.type === 'session' && !e.init).sessionId, ref.hostSessionId);
  assert.ok(ev.some((e) => e.type === 'subagent' && e.event === 'spawn' && e.memberOf === SID && e.subagentType === 'worca-x-n_a-1-a1'));
  assert.ok(ev.some((e) => e.type === 'text' && /\[mock\] starting role=generic-producer/.test(e.text) && e.parentId === null));
  assert.equal(ev.at(-1).sessionBooked, true);
});

test('REVIEW FOCUS 2 — a replay-aware main agent: error, then "already done", then a clean re-dispatch', async () => {
  const { port, host } = build();
  mockT.behave = ({ turn }) => ({ 1: 'member-error', 2: 'no-dispatch' })[turn] || null;
  await assert.rejects(host.run(mkMember('x:n_a:1', []), member('n_a')), /boom/);
  await assert.rejects(host.run(mkMember('x:n_a:1', []), member('n_a')), (e) => e.code === 'SESSION_HOST_NO_DISPATCH');
  await host.run(mkMember('x:n_a:1', []), member('n_a'));
  assert.deepEqual(port.records.filter((r) => r.kind === 'dispatch').map((r) => r.agentType), ['worca-x-n_a-1-a1', 'worca-x-n_a-1-a2', 'worca-x-n_a-1-a3']);
  assert.equal(port.booked.length, 3, 'every turn that spent is booked once');
  assert.equal(port.records.filter((r) => r.kind === 'watchdog' && r.level === 'error').length, 1);
});

test('a second Agent call kills the host at once; the child never runs twice', async () => {
  const { port, host } = build();
  mockT.behave = () => 'two-dispatch';
  await assert.rejects(host.run(mkMember('x:n_a:1', []), member('n_a')), (e) => e.code === 'SESSION_HOST_MULTI_DISPATCH');
  assert.equal(port.records.filter((r) => r.kind === 'member_done').length, 0, 'no child finished');
  const w = port.records.filter((r) => r.kind === 'watchdog');
  assert.deepEqual(w.map((x) => [x.code, x.level, x.detail.afterDone ?? false]), [['SESSION_HOST_MULTI_DISPATCH', 'error', false]], 'killed before any result');
  assert.equal(rec(port, 'turn_end').exit, 'violation');
});

test('a stray Bash call is STRAY_TOOL; an Agent call carrying `model` is an override (C11)', async () => {
  const { port, host } = build();
  mockT.behave = () => 'stray-bash';
  await assert.rejects(host.run(mkMember('x:n_a:1', []), member('n_a')), (e) => e.code === 'SESSION_HOST_STRAY_TOOL');
  assert.deepEqual(port.records.find((r) => r.kind === 'watchdog').detail, { strayTools: ['Bash'] });
  mockT.behave = () => 'model-override';
  await assert.rejects(host.run(mkMember('x:n_a:1', []), member('n_a')), (e) => e.code === 'SESSION_HOST_NO_DISPATCH' && e.detail.override[0] === 'model');
});

test('REVIEW FOCUS 2 / M-3 — a stray tool AFTER the step finished keeps the step; nothing re-runs', async () => {
  const { port, host } = build();
  let starts = 0; mockT.behave = () => 'stray-after-done'; mockT.onMemberStart = () => { starts += 1; };
  const out = await host.run(mkMember('x:n_a:1', []), member('n_a'));
  assert.equal(out.exitCode, 0);
  assert.equal(starts, 1);
  const w = port.records.find((r) => r.kind === 'watchdog');
  assert.deepEqual([w.level, w.detail.afterDone, w.detail.strayTools], ['warn', true, ['TodoWrite']]);
  assert.equal(port.records.find((r) => r.kind === 'turn_end').exit, 'violation');
});

test('C12: the step finished, then the main agent failed — the step is kept, nothing re-runs', async () => {
  const { port, host } = build();
  mockT.behave = () => 'host-error-after-member';
  const out = await host.run(mkMember('x:n_a:1', []), member('n_a'));
  assert.equal(out.exitCode, 0);
  assert.equal(port.records.find((r) => r.kind === 'turn_end').exit, 'error');
  assert.ok(port.logs.some((l) => l.level === 'warn' && /the step is kept/.test(l.text)));
});

test('verify major 1 — close() books an open cut (the LAST member died after its tool_result) before the close record', async () => {
  for (const outcome of ['done', 'stopped']) {
    mockT.resetSessions();
    const { port, hosts, host } = build();
    mockT.behave = () => 'host-error-after-member';
    await host.run(mkMember('x:n_b:1', []), member('n_b'));               // kept (C12), but the turn has no result: openCut
    assert.ok(hosts.snapshot()[SID].openCut, 'the cut waits for a later turn');
    await hosts.close(outcome);
    const kinds = port.records.map((r) => r.kind);
    const cut = port.records.find((r) => r.kind === 'cost' && r.cut);
    assert.ok(cut, `${outcome}: the cut is booked`);
    assert.equal(cut.costSource, 'estimate');
    assert.equal(cut.executionId, 'x:n_b:1');
    assert.ok(kinds.lastIndexOf('cost') < kinds.indexOf('close'), 'booked before close');
    assert.equal(hosts.snapshot()[SID].openCut, null);
  }
  mockT.resetSessions();
  const { port, hosts, host } = build();
  mockT.behave = () => 'host-error-after-member';
  await host.run(mkMember('x:n_b:1', []), member('n_b'));
  await hosts.close('paused');
  assert.equal(port.records.filter((r) => r.kind === 'cost' && r.cut).length, 0, 'paused: the resumed turn carries it');
  assert.ok(hosts.snapshot()[SID].openCut);
});

test('verify minor 7 — the member\'s synthetic finish event carries no tokens, usage or duration', async () => {
  const { host } = build(); const ev = [];
  await host.run(mkMember('x:n_a:1', ev), member('n_a'));
  const fin = ev.find((e) => e.type === 'subagent' && e.event === 'finish');
  assert.ok(fin);
  for (const k of ['tokens', 'usage', 'durationMs']) assert.equal(fin[k], undefined, k);
});

test('C41 — a child that hits 529 or the usage limit fails with the class an ungrouped step would get', async () => {
  const { host } = build();
  mockT.behave = () => 'child-overloaded';
  await assert.rejects(host.run(mkMember('x:n_a:1', []), member('n_a')), (e) => e.errorClass === 'rate_limit');
  mockT.behave = () => 'usage-limit';
  await assert.rejects(host.run(mkMember('x:n_a:1', []), member('n_a')), (e) => e.errorClass === 'usage_limit' && /resets 6pm/.test(e.message));
});

test('C20 — a plugin-dir refusal before init is the adapter\'s error, unchanged, and its log line reaches the member stream', async () => {
  const { host } = build();
  await host.run(mkMember('x:n_a:1', []), member('n_a'));                     // a host session exists: the next turn resumes
  mockT.behave = () => 'sideload-refused';
  const ev = [];
  await assert.rejects(host.run(mkMember('x:n_b:1', ev, { pluginDirs: ['/p'] }), member('n_b')),
    (e) => e.name !== 'SessionHostError' && /exited with code 1/.test(e.message));
  assert.ok(ev.some((e) => e.type === 'log' && /--plugin-dir/.test(e.text)), 'spawnAgent\'s `said` sees the refusal');
});

test('C43 — the host id is adopted at init: a pause during the first turn keeps it', async () => {
  const { hosts, host } = build();
  const ac = new AbortController();
  mockT.behave = () => 'hang';
  const p = host.run(mkMember('x:n_a:1', [], { signal: ac.signal }), member('n_a'));
  await new Promise((r) => setTimeout(r, 20));
  ac.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.match(hosts.snapshot()[SID].hostSessionId, /^mock-host-/);
});

test('C26 — a child resolved to another model than its definition: a warn record and a run-log warn', async () => {
  const { port, host } = build();
  mockT.resolvedModel = 'claude-sonnet-4-5';
  await host.run(mkMember('x:n_a:1', []), member('n_a'));
  const w = port.records.find((r) => r.kind === 'watchdog');
  assert.deepEqual([w.level, w.code, w.detail], ['warn', 'model-mismatch', { requested: 'claude-opus-5-5', resolved: 'claude-sonnet-4-5' }]);
  assert.ok(port.logs.some((l) => l.level === 'warn' && /claude-sonnet-4-5/.test(l.text)));
  mockT.resolvedModel = 'claude-opus-5-5-20260101';
  await host.run(mkMember('x:n_b:1', []), member('n_b'));
  assert.equal(port.records.filter((r) => r.kind === 'watchdog').length, 1, 'v4: a dated id of the requested model is no mismatch');
});

// ── v2: the Interfaces sentences and the run 4/5 seams the master's tests leave open ──
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m ?? ''} ${a} vs ${b}`);
const rec = (port, kind) => port.records.find((r) => r.kind === kind);

test('v2 — the turn\'s records carry every field: turn_start, dispatch, member_done, turn_end, cost, reconcile', async () => {
  const { port, host } = build(); const ev = [];
  const out = await host.run(mkMember('x:n_a:1', ev), member('n_a'));
  const ts = rec(port, 'turn_start');
  assert.deepEqual([ts.turnId, ts.resume, ts.maxTurns, ts.maxBudgetUsd, ts.hostModel, ts.hostEffort], [`t:${SID}:1`, false, 4, null, 'claude-haiku-4-5', null]);
  assert.equal(ts.hostEpoch, 1);
  const md = rec(port, 'member_done');
  assert.deepEqual(md.tokens, usageTokens(MOCK_MEMBER_USAGE), 'run 4 note: usageTokens(done.usage), not the CLI\'s totalTokens');
  assert.deepEqual([md.resolvedModel, md.durationMs, md.isError, 'errorClass' in md], ['claude-opus-5-5', 1, false, false]);
  assert.match(md.memberTranscriptId, /^mock-agent-/);
  assert.equal(md.memberAgentId, rec(port, 'member_bound').memberAgentId);
  const te = rec(port, 'turn_end');
  assert.deepEqual([te.exit, te.subtype, te.hostModel], ['ok', 'success', 'claude-haiku-4-5']);
  assert.deepEqual(te.hostUsage, { in: 1000, out: 20, cr: 0, cw: 0 });
  near(te.cumulativeUsd, 0.2511);
  const c = rec(port, 'cost');
  assert.deepEqual([c.executionId, c.nodeId, c.costSource, c.hostPriced, c.overridden, c.memberUsd, c.hostOverheadUsd], ['x:n_a:1', 'n_a', 'harness', true, false, 0.2511, 0]);
  const rc = rec(port, 'reconcile');
  assert.deepEqual([rc.turnId, rc.dispatchId, rc.ok, rc.checks], [`t:${SID}:1`, 'd:x:n_a:1:a1', true, []]);
  const sess = ev.filter((e) => e.type === 'session' && e.init);
  assert.deepEqual(sess.map((e) => [e.model, e.sessionId]), [['claude-opus-5-5', te.hostSessionId]]);
  const finish = ev.find((e) => e.type === 'subagent' && e.event === 'finish');
  assert.deepEqual([finish.toolUseId, finish.resolvedModel], [rec(port, 'member_bound').memberAgentId, 'claude-opus-5-5']);
  assert.deepEqual([ev.at(-1).type, ev.at(-1).text], ['result', out.text], 'the result event carries the report');
  assert.ok(out.text.length > 0);
});

test('v2 — the second turn resumes the adopted host; the bookings carry the ids, models, member usage and the run\'s hookUsd', async () => {
  const { port, host } = build();
  await host.run(mkMember('x:n_a:1', []), member('n_a'));
  await host.run(mkMember('x:n_b:1', []), member('n_b'));
  assert.equal(mockT.seen[1].resumeSessionId, mockT.seen[0].hostSessionId);
  assert.equal(port.records.filter((r) => r.kind === 'turn_start')[1].resume, true);
  const b = port.booked[1];
  assert.deepEqual([b.sid, b.hostEpoch, b.turnId, b.dispatchId, b.stepKey, b.nodeId, b.memberModel, b.carried], [SID, 1, `t:${SID}:2`, 'd:x:n_b:1:a1', 'x:n_b:1', 'n_b', 'claude-opus-5-5', null]);
  assert.equal(b.hostSessionId, mockT.seen[0].hostSessionId);
  assert.deepEqual(b.memberUsage, MOCK_MEMBER_USAGE);
  assert.deepEqual(b.hostUsage, { in: 1000, out: 20, cr: 0, cw: 0 }, 'no result usage on the mock: the demux\'s per-message sum');
  assert.deepEqual(b.investigators, []);
  near(port.records.filter((r) => r.kind === 'turn_end')[1].deltaUsd, 0.2511);
});

test('v2 — the host is priced from result.usage when the turn has one (its real output and 1-hour cache writes)', async () => {
  const usage = { input_tokens: 1850, output_tokens: 226, cache_creation: { ephemeral_1h_input_tokens: 4000 }, cache_creation_input_tokens: 4000 };
  const frames = (o) => okFrames({ agentType: /subagent_type "([^"]+)"/.exec(o.prompt)[1] }).map((f) => (f.type === 'result' ? { ...f, usage } : f));
  const t = framesTransport(frames);
  const port = fakePort();
  const host = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: t.transport }).hostFor('n_a');
  const out = await host.run(mkMember('x:n_a:1', []), member('n_a'));
  assert.deepEqual(out, { text: 'REPORT', exitCode: 0 }, 'the report is the child\'s own text');
  assert.deepEqual(port.booked[0].hostUsage, usage);
  assert.deepEqual(rec(port, 'turn_end').hostUsage, { in: 1850, out: 226, cr: 0, cw: 4000 });
  assert.equal(port.booked[0].hostModel, 'claude-haiku-4-5', 'the init model, with no hostModel set');
  assert.equal(rec(port, 'turn_start').hostModel, null, 'C26: a bare member sends no --model');
});

test('v2 — C9: a cut turn is priced from the member\'s tool_result usage plus the host\'s; the next turn carries it, written first', async () => {
  assert.equal(HOST_CUT_COST_RESTORED, true);
  const { port, hosts, host } = build();
  mockT.behave = ({ turn }) => (turn === 1 ? 'host-error-after-member' : null);
  await host.run(mkMember('x:n_a:1', []), member('n_a'));
  const cut = hosts.snapshot()[SID].openCut;
  near(cut.cutUsd, priceUsage('claude-opus-5-5', MOCK_MEMBER_USAGE) + priceUsage('claude-haiku-4-5', MOCK_HOST_USAGE));
  assert.deepEqual([cut.turnId, cut.dispatchId, cut.executionId, cut.nodeId], [`t:${SID}:1`, 'd:x:n_a:1:a1', 'x:n_a:1', 'n_a']);
  assert.deepEqual(cut.cutTokens, { in: 6000, out: 720, cr: 0, cw: 0 });
  assert.equal(rec(port, 'cost'), undefined, 'nothing booked at the cut');
  assert.equal(rec(port, 'turn_end').deltaUsd, null);
  await host.run(mkMember('x:n_b:1', []), member('n_b'));
  assert.deepEqual([port.booked.length, port.booked[0].carried], [1, cut], 'the next booking of the epoch carries it');
  const costs = port.records.filter((r) => r.kind === 'cost');
  assert.deepEqual(costs.map((c) => [c.turnId, c.executionId, c.carriedBy ?? null]), [[`t:${SID}:1`, 'x:n_a:1', `t:${SID}:2`], [`t:${SID}:2`, 'x:n_b:1', null]]);
  near(costs[0].memberUsd, cut.cutUsd, 'the cut turn gets its priced spend back');
  near(costs[0].memberUsd + costs[1].memberUsd, 0.5022, 'Σ booked = the restored cumulative');
  assert.equal(hosts.snapshot()[SID].openCut, null);
});

test('v2 — a second cut before any booking joins the first; v4: as its own part, so the next booking gives each cut turn its own carried record (C9)', async () => {
  const { port, hosts, host } = build();
  mockT.behave = ({ turn }) => (turn <= 2 ? 'host-error-after-member' : null);
  await host.run(mkMember('x:n_a:1', []), member('n_a'));
  const first = hosts.snapshot()[SID].openCut;
  await host.run(mkMember('x:n_b:1', []), member('n_b'));
  const both = hosts.snapshot()[SID].openCut;
  assert.equal(both.turnId, first.turnId);
  near(both.cutUsd, 2 * first.cutUsd);
  near(both.cutListUsd, both.cutUsd, 'no override: the list price is the operator\'s');
  assert.deepEqual(both.cutTokens, { in: 12000, out: 1440, cr: 0, cw: 0 });
  assert.deepEqual(both.parts.map((p) => [p.turnId, p.executionId, p.nodeId]), [[`t:${SID}:1`, 'x:n_a:1', 'n_a'], [`t:${SID}:2`, 'x:n_b:1', 'n_b']]);
  await host.run(mkMember('x:n_a:2', []), member('n_a', 2));
  const carried = port.records.filter((r) => r.kind === 'cost' && r.carriedBy);
  assert.deepEqual(carried.map((c) => [c.turnId, c.executionId, c.nodeId, c.carriedBy]),
    [[`t:${SID}:1`, 'x:n_a:1', 'n_a', `t:${SID}:3`], [`t:${SID}:2`, 'x:n_b:1', 'n_b', `t:${SID}:3`]], 'oldest first, each on its own row');
  near(carried[0].memberUsd, first.cutUsd);
  near(carried[1].memberUsd, first.cutUsd);
  assert.equal(hosts.snapshot()[SID].openCut, null);
  await hosts.close('done');
  near(port.records.at(-1).memberUsd.n_b, first.cutUsd, 'close: n_b\'s cut is n_b\'s');
});

test('v2 — a turn cut before its init spent nothing: no open cut', async () => {
  const t = framesTransport(() => [], { fail: () => Object.assign(new Error('claude exited with code 1: auth'), { errorClass: 'auth' }) });
  const port = fakePort();
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: t.transport });
  await assert.rejects(hosts.hostFor('n_a').run(mkMember('x:n_a:1', []), member('n_a')), (e) => e.errorClass === 'auth');
  assert.equal(hosts.snapshot()[SID].openCut, null);
  assert.equal(port.booked.length, 0);
});

test('v2 — C41: a violation after a member ERROR stays a warning; the member\'s error is thrown with its class', async () => {
  const frames = (o) => {
    const [init, call] = okFrames({ agentType: /subagent_type "([^"]+)"/.exec(o.prompt)[1] });
    return [init, call,
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'T1', is_error: true, content: [{ type: 'text', text: 'API Error: 529 overloaded' }] }] } },
      { type: 'assistant', message: { id: 'h9', content: [{ type: 'tool_use', id: 'T2', name: 'Agent', input: { subagent_type: 'x' } }] } }];
  };
  const t = framesTransport(frames);
  const port = fakePort();
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: t.transport });
  await assert.rejects(hosts.hostFor('n_a').run(mkMember('x:n_a:1', []), member('n_a')), (e) => e.errorClass === 'rate_limit' && e.name !== 'SessionHostError');
  const w = port.records.filter((r) => r.kind === 'watchdog');
  assert.deepEqual(w.map((x) => [x.level, x.code, x.detail.afterDone]), [['warn', 'SESSION_HOST_MULTI_DISPATCH', true]]);
  assert.equal(rec(port, 'member_done').errorClass, 'rate_limit');
  assert.equal(rec(port, 'turn_end').exit, 'error');
  assert.equal(hosts.snapshot()[SID].consecutiveWatchdog, 0, 'a member error is not the main agent\'s');
});

test('v2 — a violation that raced a clean result is kept as a warning on an accepted turn', async () => {
  const frames = (o) => {
    const f = okFrames({ agentType: /subagent_type "([^"]+)"/.exec(o.prompt)[1] });
    f.splice(2, 0, { type: 'assistant', message: { id: 'hx', content: [{ type: 'tool_use', id: 'B1', name: 'Bash', input: { command: 'ls' } }] } });
    return f;
  };
  const t = framesTransport(frames, { race: true });
  const port = fakePort();
  const out = await createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: t.transport }).hostFor('n_a').run(mkMember('x:n_a:1', []), member('n_a'));
  assert.equal(out.text, 'REPORT');
  const w = rec(port, 'watchdog');
  assert.deepEqual([w.level, w.code, w.detail], ['warn', 'SESSION_HOST_STRAY_TOOL', { strayTools: ['Bash'] }]);
  assert.ok(port.logs.some((l) => l.level === 'warn' && /SESSION_HOST_STRAY_TOOL after the step's own result/.test(l.text)), 'v4: and a warn line (C11)');
  assert.equal(rec(port, 'turn_end').exit, 'violation');
});

test('v2 — consecutive watchdog failures count; an accepted turn resets the count', async () => {
  const { port, hosts, host } = build();
  mockT.behave = ({ turn }) => (turn <= 2 ? 'no-dispatch' : null);
  for (let i = 0; i < 2; i += 1) await assert.rejects(host.run(mkMember('x:n_a:1', []), member('n_a')), (e) => e.code === 'SESSION_HOST_NO_DISPATCH' && e.errorClass === 'session_host');
  assert.equal(hosts.snapshot()[SID].consecutiveWatchdog, 2);
  assert.equal(port.records.find((r) => r.kind === 'turn_end').exit, 'ok', 'v4: a no-dispatch turn that ended by itself exits ok');
  await host.run(mkMember('x:n_a:1', []), member('n_a'));
  assert.equal(hosts.snapshot()[SID].consecutiveWatchdog, 0);
});

test('v2 — C20: only a RESUMED turn can vanish; the same text on a fresh host is the adapter\'s error (Task 41 restarts a vanished one)', async () => {
  assert.equal(VANISHED_RE.test('No conversation found with session ID: x'), true);
  const fresh = framesTransport(() => [], { fail: () => new Error('No conversation found with session ID: y') });
  const h2 = createSessionHosts({ specs: [spec()], decisions: decisions(), port: fakePort(), transport: fresh.transport }).hostFor('n_a');
  await assert.rejects(h2.run(mkMember('x:n_a:1', []), member('n_a')), (e) => e.name === 'Error' && !e.code);
});

test('v2 — an adapter error with no class takes the member error\'s class; one with a class keeps it (C20, C41)', async () => {
  const frames = (o) => okFrames({ agentType: /subagent_type "([^"]+)"/.exec(o.prompt)[1] }).slice(0, 2).concat([
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'T1', is_error: true, content: [{ type: 'text', text: 'API Error: 529 overloaded' }] }] } }]);
  for (const [cls, want] of [[null, 'rate_limit'], [undefined, 'rate_limit'], ['network', 'network']]) {
    const t = framesTransport(frames, { fail: () => Object.assign(new Error('claude exited with code 1'), cls === undefined ? {} : { errorClass: cls }) });
    const host = createSessionHosts({ specs: [spec()], decisions: decisions(), port: fakePort(), transport: t.transport }).hostFor('n_a');
    await assert.rejects(host.run(mkMember('x:n_a:1', []), member('n_a')), (e) => e.errorClass === want && /exited with code 1/.test(e.message));
  }
});

test('v2 — the host spawn: the dispatch line, the member\'s definition, background tasks forced off even over a modelEnv', async () => {
  const t = framesTransport((o) => okFrames({ agentType: /subagent_type "([^"]+)"/.exec(o.prompt)[1] }));
  const host = createSessionHosts({ specs: [spec()], decisions: decisions(), port: fakePort(), transport: t.transport }).hostFor('n_a');
  await host.run(mkMember('x:n_a:1', [], { modelEnv: { ANTHROPIC_BASE_URL: 'u', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '0' } }), member('n_a'));
  const h = t.calls[0];
  assert.equal(h.modelEnv.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, '1');
  assert.equal(h.modelEnv.ANTHROPIC_BASE_URL, 'u');
  assert.equal(h.spawnEnv.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, '1');
  assert.equal(h.agents['worca-x-n_a-1-a1'].model, 'claude-opus-5-5');
  assert.equal(h.resumeSessionId, undefined);
  await host.run(mkMember('x:n_b:1', []), member('n_b'));
  assert.equal(t.calls[1].resumeSessionId, 'H1', 'the adopted host id');
  assert.equal(t.calls[1].modelEnv, undefined, 'no modelEnv: none is invented');
});

test('v2 — host text is a session log line; a member-level warning is a warn record and a warn line', async () => {
  const frames = (o) => {
    const f = okFrames({ agentType: /subagent_type "([^"]+)"/.exec(o.prompt)[1] });
    f.splice(2, 0, { type: 'assistant', parent_tool_use_id: 'T1', message: { id: 'c0', content: [{ type: 'tool_use', id: 'S1', name: 'Agent', input: { subagent_type: 'worca-x-n_b-1-a1' } }] } });
    return f;
  };
  const t = framesTransport(frames);
  const port = fakePort();
  await createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: t.transport }).hostFor('n_a').run(mkMember('x:n_a:1', []), member('n_a'));
  assert.deepEqual(port.logs.find((l) => l.level === 'info'), { level: 'info', text: 'DONE', attr: { nodeId: 'n_a', executionId: 'x:n_a:1', session: SID } });
  const w = rec(port, 'watchdog');
  assert.deepEqual([w.level, w.code, w.detail], ['warn', 'member-self-dispatch', { subagentType: 'worca-x-n_b-1-a1' }]);
  assert.ok(port.logs.some((l) => l.level === 'warn' && /member-self-dispatch/.test(l.text)));
});

test('v2 — close("done") books the summary: totals, per-node member spend, tokens, the epoch check; a booking that throws is logged', async () => {
  const { port, hosts, host } = build();
  await host.run(mkMember('x:n_a:1', []), member('n_a'));
  await host.run(mkMember('x:n_b:1', []), member('n_b'));
  await hosts.close('done');
  const c = rec(port, 'close');
  near(c.costUsd, 0.5022);
  assert.deepEqual(c.memberUsd, { n_a: 0.2511, n_b: 0.2511 });
  assert.deepEqual([c.turns, c.dispatches, c.rotations, c.restarts, c.reconciled], [2, 2, 0, 0, true]);
  assert.deepEqual(c.tokens, { in: 12000, out: 1440, cr: 0, cw: 0 });
  assert.equal(c.activeMs >= 0 && c.wallMs >= c.activeMs, true);
  assert.deepEqual(c.epochChecks.map((x) => [x.epoch, x.ok]), [[1, true]]);
  near(c.epochChecks[0].harnessTotalUsd, 0.5022);
  assert.equal(HOST_BUDGET_SUBTYPE, 'error_max_budget_usd');
  const broken = fakePort({ bookTurn: () => { throw new Error('db down'); } });
  const h2 = createSessionHosts({ specs: [spec()], decisions: decisions(), port: broken, transport: runMockSession }).hostFor('n_a');
  assert.equal((await h2.run(mkMember('x:n_a:1', []), member('n_a'))).exitCode, 0);
  assert.ok(broken.logs.some((l) => l.level === 'warn' && /booking .* failed: db down/.test(l.text)));
  assert.equal(broken.records.some((r) => r.kind === 'cost'), false);
});

test('v2 — paused: the pause record names the cut turn and its tokens', async () => {
  const { port, hosts, host } = build();
  mockT.behave = () => 'host-error-after-member';
  await host.run(mkMember('x:n_b:1', []), member('n_b'));
  await hosts.close('paused');
  const p = rec(port, 'pause');
  assert.deepEqual([p.reason, p.turnId, p.dispatchId, p.cutTokens], ['pause', `t:${SID}:1`, 'd:x:n_b:1:a1', { in: 6000, out: 720, cr: 0, cw: 0 }]);
});

// ── v2 sweep: one assert per rule the mechanical mutation sweep showed unpinned (see the plan's "Mutation sweep") ──
import { readTraceSync, tracePath } from '../src/core/session-trace.mjs';
const typeOf = (o) => /subagent_type "([^"]+)"/.exec(o.prompt)[1];
const hostWith = (transport, { port = fakePort(), settings = {}, limits = {}, dec = decisions() } = {}) => {
  const hosts = createSessionHosts({ specs: [spec(['n_a', 'n_b'], settings)], decisions: dec, port, transport, limits });
  return { port, hosts, host: hosts.hostFor('n_a') };
};

test('sweep — a fresh host\'s snapshot is complete and null-filled; a junk spec is skipped; a bare decision and bare settings write nulls', () => {
  const { hosts } = hostWith(runMockSession);
  assert.deepEqual(hosts.snapshot()[SID], { sid: SID, mode: 'subagents', degradeReason: null, engine: 'claude', hostEpoch: 1, hostSessionId: null,
    hostResolvedModel: null, turns: 0, dispatches: 0, epochDispatches: 0, rotations: 0, restarts: 0, attempts: {}, consecutiveWatchdog: 0,
    lastContextTokens: 0, lastCumulativeUsd: 0, epochOpeningUsd: 0, openCut: null, status: 'cold', pendingRotate: null });
  const port = fakePort(); delete port.engine;
  const bare = { sid: SID, members: ['n_a'], settings: { label: 'Bare' } };
  const h = createSessionHosts({ specs: [null, { sid: 7 }, bare], decisions: new Map([[SID, { mode: 'separate' }]]), port, transport: runMockSession });
  assert.deepEqual([...h.hosts.keys()], [SID]);
  const [open, mode, deg] = port.records;
  assert.deepEqual([open.engine, open.hostModel, open.hostEffort, open.label, mode.requested, mode.reason, mode.engine, deg.from, deg.reason],
    [null, null, null, 'Bare', null, null, null, 'subagents', null]);
  assert.deepEqual([h.snapshot()[SID].degradeReason, h.snapshot()[SID].engine], [null, null]);
  const set = hostWith(runMockSession, { settings: { hostModel: 'claude-haiku-4-5', hostEffort: 'medium' } });
  assert.deepEqual([set.port.records[0].hostModel, set.port.records[0].hostEffort], ['claude-haiku-4-5', 'medium']);
});

test('sweep — a record the trace could not write reaches nobody', async () => {
  const { port, hosts, host } = hostWith(runMockSession);
  hosts.hosts.get(SID).trace.append = () => null;
  await host.run(mkMember('x:n_a:1', []), member('n_a'));
  assert.deepEqual(port.records.map((r) => r.kind), ['open', 'mode']);
});

test('sweep — the member\'s own usage events price a cut before its tool_result (latest per message; never an investigator\'s)', async () => {
  const frames = (o) => {
    const [init, call] = okFrames({ agentType: typeOf(o) });
    return [init, call,
      { type: 'assistant', parent_tool_use_id: 'T1', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 1 }, content: [{ type: 'tool_use', id: 'I1', name: 'Agent', input: { subagent_type: 'worca-investigator' } }] } },
      { type: 'assistant', parent_tool_use_id: 'T1', message: { id: 'm1', usage: { input_tokens: 2000, output_tokens: 300 }, content: [{ type: 'text', text: 'x' }] } },
      { type: 'assistant', parent_tool_use_id: 'I1', message: { id: 'i1', usage: { input_tokens: 99999, output_tokens: 9999 }, content: [{ type: 'text', text: 'y' }] } }];
  };
  const { hosts, host } = hostWith(framesTransport(frames, { fail: () => new Error('claude exited with code 1') }).transport);
  await assert.rejects(host.run(mkMember('x:n_a:1', []), member('n_a')), /exited with code 1/);
  const cut = hosts.snapshot()[SID].openCut;
  assert.deepEqual(cut.cutTokens, { in: 2000 + 900, out: 300 + 30, cr: 100, cw: 0 });
  near(cut.cutUsd, priceUsage('claude-opus-5-5', { input_tokens: 2000, output_tokens: 300 }) + priceUsage('claude-haiku-4-5', { in: 900, out: 30, cr: 100, cw: 0 }));
});

test('sweep — events: a member error is an `error` sub-agent event; a model mismatch re-announces the resolved model as an init', async () => {
  const { host } = hostWith(runMockSession); const ev = [];
  mockT.behave = () => 'member-error';
  await assert.rejects(host.run(mkMember('x:n_a:1', ev), member('n_a')), /boom/);
  assert.equal(ev.find((e) => e.type === 'subagent' && e.event !== 'spawn').event, 'error');
  mockT.behave = null; mockT.resolvedModel = 'claude-sonnet-4-5'; const ev2 = [];
  await host.run(mkMember('x:n_b:1', ev2), member('n_b'));
  assert.deepEqual(ev2.filter((e) => e.type === 'session' && e.init).map((e) => e.model), ['claude-opus-5-5', 'claude-sonnet-4-5']);
});

test('sweep — the models fall back: the host to its requested model without an init model, the member to its definition', async () => {
  const frames = (o) => okFrames({ agentType: typeOf(o) }).map((f) => {
    if (f.type === 'system') return { ...f, model: undefined };
    if (f.type === 'user') return { ...f, tool_use_result: { ...f.tool_use_result, resolvedModel: undefined } };
    return f;
  });
  const { port, host } = hostWith(framesTransport(frames).transport, { settings: { hostModel: 'claude-haiku-4-5' } });
  await host.run(mkMember('x:n_a:1', []), member('n_a'));
  assert.deepEqual([port.booked[0].hostModel, port.booked[0].memberModel], ['claude-haiku-4-5', 'claude-opus-5-5']);
  assert.equal(rec(port, 'turn_end').hostModel, null, 'turn_end names only the RESOLVED host model (C35)');
});

test('sweep — a $0 turn keeps its zeros; the result\'s own counts and duration win; no result: nulls', async () => {
  const frames = (o) => okFrames({ agentType: typeOf(o), cumulativeUsd: 0 }).map((f) => (f.type === 'result' ? { ...f, duration_ms: 0, num_turns: 0 } : f));
  const { port, host } = hostWith(framesTransport(frames).transport);
  await host.run(mkMember('x:n_a:1', []), member('n_a'));
  assert.equal(port.booked[0].cumulativeUsd, 0);
  const te = rec(port, 'turn_end');
  assert.deepEqual([te.cumulativeUsd, te.deltaUsd, te.numTurns, te.durationMs, te.subtype], [0, 0, 0, 0, 'success']);
  mockT.behave = () => 'host-error-after-member';
  const cut = hostWith(runMockSession);
  await cut.host.run(mkMember('x:n_a:1', []), member('n_a'));
  const ce = rec(cut.port, 'turn_end');
  assert.deepEqual([ce.cumulativeUsd, ce.deltaUsd, ce.numTurns, ce.subtype], [null, null, null, null]);
  const ref = cut.port.stamped.at(-1).ref;
  assert.deepEqual([ref.costSource, typeof ref.memberTranscriptId], [null, 'string'], 'a cut turn\'s row: no booking yet');
  const nd = hostWith(runMockSession);
  mockT.behave = () => 'no-dispatch';
  await assert.rejects(nd.host.run(mkMember('x:n_a:1', []), member('n_a')), (e) => e.message === 'the main agent did not dispatch the step');
  assert.deepEqual([nd.port.booked[0].memberUsage, nd.port.stamped.at(-1).ref.memberTranscriptId, nd.port.stamped.at(-1).ref.memberAgentId], [null, null, null]);
});

test('sweep — an engine without cost: a pending cut is never carried, no member spend is invented, close books its estimate as none', async () => {
  const port = fakePort({ engineCost: false });
  const { hosts, host } = hostWith(runMockSession, { port });
  mockT.behave = ({ turn }) => (turn === 1 ? 'host-error-after-member' : null);
  await host.run(mkMember('x:n_a:1', []), member('n_a'));
  await host.run(mkMember('x:n_b:1', []), member('n_b'));
  assert.equal(port.records.some((r) => r.kind === 'cost' && r.carriedBy), false);
  assert.ok(hosts.snapshot()[SID].openCut, 'still pending: nothing carried it');
  await hosts.close('done');
  assert.equal(rec(port, 'close').memberUsd, null);
});

test('sweep — close: per-node spend includes carried and cut-estimate dollars; reconciled reads the turn checks; the trace is flushed', async () => {
  const { port, hosts, host } = hostWith(runMockSession);
  mockT.behave = ({ turn }) => (turn === 1 ? 'host-error-after-member' : turn === 3 ? 'host-error-after-member' : null);
  await host.run(mkMember('x:n_a:1', []), member('n_a'));            // cut on n_a
  await host.run(mkMember('x:n_b:1', []), member('n_b'));            // carries it
  await host.run(mkMember('x:n_b:2', []), member('n_b', 2));         // cut on n_b, booked at close
  await hosts.close('done');
  const costs = port.records.filter((r) => r.kind === 'cost');
  const byNode = {};
  for (const c of costs) byNode[c.nodeId] = (byNode[c.nodeId] ?? 0) + c.memberUsd;
  const c = rec(port, 'close');
  near(c.memberUsd.n_a, byNode.n_a); near(c.memberUsd.n_b, byNode.n_b);
  assert.equal(c.reconciled, true);
  assert.equal(readTraceSync(tracePath(port.pipelineDir, SID)).records.at(-1).kind, 'close', 'close() resolves after the trace is written');
  const bad = fakePort({ bookTurn: (b) => ({ deltaUsd: 0.25, memberUsd: 0.25, hostOverheadUsd: 0, costSource: 'harness', hostPriced: true, overridden: false, carried: null,
    reconcile: { ok: false, checks: [{ method: 'estimate', harnessUsd: 0.25, otherUsd: 1, tolerance: 0.15, ok: false }] } }) });
  const b2 = hostWith(runMockSession, { port: bad });
  mockT.behave = null;
  await b2.host.run(mkMember('x:n_a:1', []), member('n_a'));
  assert.deepEqual([rec(bad, 'reconcile').ok, rec(bad, 'reconcile').checks.length], [false, 1]);
  await b2.hosts.close('done');
  assert.equal(rec(bad, 'close').reconciled, false);
  const plain = fakePort({ bookTurn: () => ({ deltaUsd: 0.25, memberUsd: 0.25, hostOverheadUsd: 0, costSource: 'harness', hostPriced: true, overridden: false, carried: null }) });
  await hostWith(runMockSession, { port: plain }).host.run(mkMember('x:n_a:1', []), member('n_a'));
  assert.deepEqual([rec(plain, 'reconcile').ok, rec(plain, 'reconcile').checks], [true, []], 'a booking without checks reconciles');
});

test('sweep — the epoch check: harness parts as booked; an overridden or bridge booking counts its Δ', async () => {
  const run = async (b) => {
    const port = fakePort({ bookTurn: () => ({ hostPriced: true, carried: null, reconcile: { ok: true, checks: [] }, ...b }) });
    const { hosts, host } = hostWith(runMockSession, { port });
    await host.run(mkMember('x:n_a:1', []), member('n_a'));
    await hosts.close('done');
    return rec(port, 'close').epochChecks[0];
  };
  mockT.costFor = () => 0.25;
  assert.equal((await run({ deltaUsd: 0.25, memberUsd: 0.2, hostOverheadUsd: 0, costSource: 'harness', overridden: false })).ok, false, 'a split that lost 5 cents');
  assert.equal((await run({ deltaUsd: 0.25, memberUsd: 0.4, hostOverheadUsd: 0, costSource: 'harness', overridden: true })).ok, true);
  assert.equal((await run({ deltaUsd: 0.25, memberUsd: 0.3, hostOverheadUsd: 0, costSource: 'bridge', overridden: false })).ok, true);
});

test('sweep — a cut estimate the port could not book keeps its record (estimate, nulls); a member error resets the watchdog count', async () => {
  let n = 0;
  const port = fakePort({ bookTurn: (b) => { n += 1; if (Number.isFinite(b.cutEstimateUsd)) throw new Error('down'); return { deltaUsd: 0, memberUsd: 0, hostOverheadUsd: 0, costSource: 'harness' }; } });
  const { hosts, host } = hostWith(runMockSession, { port });
  mockT.behave = () => 'host-error-after-member';
  await host.run(mkMember('x:n_a:1', []), member('n_a'));
  await hosts.close('stopped');
  const cut = port.records.find((r) => r.kind === 'cost' && r.cut);
  assert.deepEqual([cut.costSource, cut.memberUsd, cut.hostOverheadUsd, n], ['estimate', null, null, 1]);
  const w = hostWith(runMockSession);
  mockT.behave = ({ turn }) => (turn === 2 ? 'member-error' : 'no-dispatch');
  mockT.resetSessions();
  await assert.rejects(w.host.run(mkMember('x:n_a:1', []), member('n_a')));
  assert.equal(w.hosts.snapshot()[SID].consecutiveWatchdog, 1);
  await assert.rejects(w.host.run(mkMember('x:n_a:1', []), member('n_a')), /boom/);
  assert.equal(w.hosts.snapshot()[SID].consecutiveWatchdog, 0);
});

test('sweep — limits.cutCostRestored false: a cut is booked at once as an estimate, right after its turn_end; close has nothing left', async () => {
  const { port, hosts, host } = hostWith(runMockSession, { limits: { cutCostRestored: false }, settings: { hostModel: 'claude-haiku-4-5' } });
  mockT.behave = () => 'host-error-after-member';
  await host.run(mkMember('x:n_a:1', []), member('n_a'));
  assert.deepEqual(port.records.slice(-2).map((r) => [r.kind, r.cut ?? null]), [['turn_end', null], ['cost', true]]);
  assert.equal(hosts.snapshot()[SID].openCut, null);
  near(port.booked[0].cutEstimateUsd, priceUsage('claude-opus-5-5', MOCK_MEMBER_USAGE) + priceUsage('claude-haiku-4-5', MOCK_HOST_USAGE));
  await hosts.close('done');
  assert.equal(port.records.filter((r) => r.kind === 'cost' && r.cut).length, 1);
  near(rec(port, 'close').memberUsd.n_a, port.booked[0].cutEstimateUsd);
});

test('sweep — activeMs sums the turns\' wall time', async () => {
  const { port, hosts, host } = hostWith(runMockSession);
  const ac = new AbortController();
  mockT.behave = () => 'hang';
  const p = host.run(mkMember('x:n_a:1', [], { signal: ac.signal }), member('n_a'));
  await new Promise((r) => setTimeout(r, 25));
  ac.abort();
  await assert.rejects(p);
  await hosts.close('stopped');
  assert.ok(rec(port, 'close').activeMs >= 20);
});

// ── v3 ──

test('v3 — Stop ends the run before the killed host exits: close waits for the turn, books its cut, then writes close', async () => {
  const ac = new AbortController();
  const slowKill = async (o) => {
    const [init, call, work] = okFrames({ agentType: typeOf(o) });
    for (const raw of [init, call, work]) o.onEvent({ type: raw.type, raw });
    await new Promise((resolve) => o.signal.addEventListener('abort', resolve, { once: true }));
    await new Promise((r) => setTimeout(r, 30));                          // a real CLI takes a moment to die after the kill
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  };
  const { port, hosts, host } = hostWith(slowKill);
  const stopped = assert.rejects(host.run(mkMember('x:n_a:1', [], { signal: ac.signal }), member('n_a')), (e) => e.name === 'AbortError');
  await new Promise((r) => setImmediate(r));
  ac.abort();
  await hosts.close('stopped');                                           // graph/scheduler.mjs finish() does not wait for running steps
  await stopped;
  assert.deepEqual(port.records.slice(-3).map((r) => r.kind), ['turn_end', 'cost', 'close']);
  const cut = rec(port, 'cost');
  assert.deepEqual([cut.cut, cut.costSource, cut.executionId], [true, 'estimate', 'x:n_a:1']);
  assert.ok(rec(port, 'close').memberUsd.n_a > 0, 'the stopped member\'s dollars stay on its node');
  assert.deepEqual(rec(port, 'close').tokens, { in: 5900, out: 730, cr: 100, cw: 0 }, 'the cut member\'s messages count in the session\'s tokens');
  assert.equal(port.summary.status, 'stopped');
});

test('v3 — a cut turn\'s price counts its finished investigators; a member that pins no model is priced at the model its messages name', async () => {
  const frames = (o) => {
    const [init, call] = okFrames({ agentType: typeOf(o) });
    return [init, call,
      { type: 'assistant', parent_tool_use_id: 'T1', message: { id: 'm1', model: 'claude-sonnet-5-5', usage: { input_tokens: 2000, output_tokens: 300 },
        content: [{ type: 'tool_use', id: 'I1', name: 'Agent', input: { subagent_type: 'worca-investigator', prompt: 'look' } }] } },
      { type: 'user', parent_tool_use_id: 'T1', message: { content: [{ type: 'tool_result', tool_use_id: 'I1', content: [{ type: 'text', text: 'found' }] }] },
        tool_use_result: { usage: { input_tokens: 40000, output_tokens: 900 }, resolvedModel: 'claude-haiku-4-5', agentId: 'inv-1' } }];
  };
  const { port, hosts, host } = hostWith(framesTransport(frames, { fail: () => new Error('claude exited with code 1') }).transport);
  await assert.rejects(host.run(mkMember('x:n_a:1', [], { model: undefined }), member('n_a')), /exited with code 1/);
  const cut = hosts.snapshot()[SID].openCut;
  near(cut.cutUsd, priceUsage('claude-sonnet-5-5', { input_tokens: 2000, output_tokens: 300 }) + priceUsage('claude-haiku-4-5', { input_tokens: 40000, output_tokens: 900 })
    + priceUsage('claude-haiku-4-5', { in: 900, out: 30, cr: 100, cw: 0 }));
  assert.deepEqual(cut.cutTokens, { in: 2000 + 40000 + 900, out: 300 + 900 + 30, cr: 100, cw: 0 });
  await hosts.close('stopped');
  assert.deepEqual(hosts.snapshot()[SID].status === 'stopped' && rec(port, 'close').tokens, cut.cutTokens, 'v5: close.tokens counts the investigators too');
});

test('v3 — C26: a cut member that pins no model and whose messages name none is priced at the main agent\'s model', async () => {
  const frames = (o) => {
    const [init, call] = okFrames({ agentType: typeOf(o) });
    return [init, call, { type: 'assistant', parent_tool_use_id: 'T1', message: { id: 'm1', usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: 'text', text: 'x' }] } }];
  };
  const { hosts, host } = hostWith(framesTransport(frames, { fail: () => new Error('claude exited with code 1') }).transport);
  await assert.rejects(host.run(mkMember('x:n_a:1', [], { model: undefined }), member('n_a')), /exited with code 1/);
  near(hosts.snapshot()[SID].openCut.cutUsd, priceUsage('claude-haiku-4-5', { input_tokens: 1000, output_tokens: 100 }) + priceUsage('claude-haiku-4-5', { in: 900, out: 30, cr: 100, cw: 0 }));
});

test('v3 — a member that pins no model: its finish re-announces the model it ran on (the row\'s model), with no mismatch warning', async () => {
  const { port, host } = build();
  const ev = [];
  await host.run(mkMember('x:n_a:1', ev, { model: undefined }), member('n_a'));
  assert.deepEqual(ev.filter((e) => e.type === 'session' && e.init).map((e) => e.model), [null, 'claude-haiku-4-5']);
  assert.equal(port.records.some((r) => r.kind === 'watchdog'), false);
});

test('v3 — a turn with a result but no member result books the member\'s usage so far', async () => {
  const frames = (o) => { const f = okFrames({ agentType: typeOf(o), subtype: HOST_BUDGET_SUBTYPE }); return [f[0], f[1], f[2], f[5]]; };
  const { port, host } = hostWith(framesTransport(frames, { fail: () => new Error('claude exited with code 1') }).transport);
  await assert.rejects(host.run(mkMember('x:n_a:1', []), member('n_a')));
  assert.deepEqual(port.booked[0].memberUsage, { in: 5000, out: 700, cr: 0, cw: 0 });
});

// ── v4: the booking's hookUsd, the cut's unpriceable parts, the bind stamp ──

test('v4 — the booking carries the turn\'s hookUsd (the member\'s PostToolUse figure, Task 48)', async () => {
  const { port, host } = build();
  mockT.behave = () => 'hooks';
  mockT.hookUsd = { member: 0.123 };
  try { await host.run(mkMember('x:n_a:1', []), member('n_a')); } finally { mockT.hookUsd = null; }
  assert.equal(port.booked[0].hookUsd, 0.123);
});

test('v4 — a cut\'s unpriceable parts count $0: an unknown host model, then an unknown member model too', async () => {
  const frames = (o, i) => {
    const f = okFrames({ agentType: /subagent_type "([^"]+)"/.exec(o.prompt)[1], model: 'nope-host' }).slice(0, 5);
    if (i === 1) f[3] = { ...f[3], tool_use_result: { ...f[3].tool_use_result, resolvedModel: 'nope-member' } };
    return f;
  };
  const port = fakePort();
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: framesTransport(frames, { fail: () => new Error('claude exited with code 1') }).transport,
    limits: { cutCostRestored: false } });
  await hosts.hostFor('n_a').run(mkMember('x:n_a:1', []), member('n_a'));
  await hosts.hostFor('n_a').run(mkMember('x:n_b:1', [], { model: undefined }), member('n_b'));
  const cuts = port.booked.filter((b) => Number.isFinite(b.cutEstimateUsd)).map((b) => b.cutEstimateUsd);
  near(cuts[0], priceUsage('claude-opus-5-5', { input_tokens: 5000, output_tokens: 700 }), 'an unknown host model adds $0');
  assert.equal(cuts[1], 0, 'and an unknown member model too: $0, never NaN');
});

test('v4 — the bind-time row stamp already names the host session (C42 reads it on a row paused mid-turn)', async () => {
  const { port, host } = build();
  await host.run(mkMember('x:n_a:1', []), member('n_a'));
  assert.equal(port.stamped.length, 2);
  assert.match(port.stamped[0].ref.hostSessionId, /^mock-host-/);
  assert.equal('costSource' in port.stamped[0].ref, false, 'the partial ref');
});

// ── v5: carried records, a result with no cost, the closing tokens ──

test('v5 — a carried record is a harness figure (it comes out of the CLI\'s Δ) and carries its OWN override flag, whatever the carrying turn\'s (C9)', async () => {
  const run = async (shape) => {
    const port = fakePort();
    const book = port.bookTurn;
    port.bookTurn = (b) => { const r = book(b); return r.carried ? shape(r) : r; };
    const { hosts, host } = build(port);
    mockT.resetSessions();
    mockT.behave = ({ turn }) => (turn === 1 ? 'host-error-after-member' : null);
    await host.run(mkMember('x:n_a:1', []), member('n_a'));
    await host.run(mkMember('x:n_b:1', []), member('n_b'));
    await hosts.close('done');
    return port;
  };
  const bridged = await run((r) => ({ ...r, costSource: 'bridge', carried: { ...r.carried, parts: r.carried.parts.map((p) => ({ ...p, overridden: true })) } }));
  const [carried, own] = bridged.records.filter((r) => r.kind === 'cost');
  assert.deepEqual([carried.turnId, carried.carriedBy, carried.costSource, carried.overridden], [`t:${SID}:1`, `t:${SID}:2`, 'harness', true]);
  assert.deepEqual([own.costSource, own.overridden], ['bridge', false]);
  const plainCarry = await run((r) => r);
  assert.equal(plainCarry.records.find((r) => r.kind === 'cost' && r.carriedBy).overridden, false, 'no override on the cut: none on its record');
  const free = await run((r) => ({ ...r, carried: { usd: 0, parts: r.carried.parts.map((p) => ({ ...p, usd: 0, overridden: true })) } }));
  assert.equal(rec(free, 'close').epochChecks[0].ok, true, 'an overridden carry counts its Δ in the epoch check, as an overridden turn does');
});

test('v5 — a result with no cost on an engine that reports cost is held like a cut: the next result carries it, nothing is booked twice (C9, C24)', async () => {
  const { port, hosts, host } = build();
  mockT.behave = ({ turn }) => (turn === 1 ? 'no-cost' : null);
  assert.equal((await host.run(mkMember('x:n_a:1', []), member('n_a'))).exitCode, 0, 'the step itself is done');
  assert.equal(port.booked.length, 0, 'no estimate now: the next cumulative of this host holds this turn\'s spend');
  const held = hosts.snapshot()[SID].openCut;
  assert.deepEqual([held.turnId, held.executionId, held.parts.length], [`t:${SID}:1`, 'x:n_a:1', 1]);
  assert.ok(held.cutUsd > 0);
  assert.equal(rec(port, 'turn_end').deltaUsd, null);
  await host.run(mkMember('x:n_b:1', []), member('n_b'));
  const costs = port.records.filter((r) => r.kind === 'cost');
  assert.deepEqual(costs.map((c) => [c.executionId, c.carriedBy ?? null]), [['x:n_a:1', `t:${SID}:2`], ['x:n_b:1', null]]);
  near(costs[0].memberUsd + costs[1].memberUsd + costs[1].hostOverheadUsd, port.records.filter((r) => r.kind === 'turn_end').at(-1).cumulativeUsd, 'Σ booked = the CLI\'s total, once');
  const nr = hostWith(runMockSession, { limits: { cutCostRestored: false } });
  mockT.resetSessions();
  mockT.behave = ({ turn }) => (turn === 1 ? 'no-cost' : null);
  await nr.host.run(mkMember('x:n_a:1', []), member('n_a'));
  await nr.host.run(mkMember('x:n_b:1', []), member('n_b'));
  assert.deepEqual(nr.port.records.filter((r) => r.kind === 'cost').map((c) => [c.carriedBy ?? null, c.cut ?? null]), [[`t:${SID}:2`, null], [null, null]],
    'a FINISHED turn\'s spend is in the next cumulative even when a killed one\'s is not: carried, never an estimate');
  const last = hostWith(runMockSession);
  mockT.resetSessions();
  mockT.behave = () => 'no-cost';
  await last.host.run(mkMember('x:n_a:1', []), member('n_a'));
  await last.hosts.close('done');
  assert.deepEqual(last.port.records.filter((r) => r.kind === 'cost').map((c) => [c.cut, c.costSource]), [[true, 'estimate']], 'nothing carried it: C24\'s estimate, once');
  const fr = hostWith(framesTransport((o, i) => okFrames({ agentType: typeOf(o), callId: `T${i + 1}`, cumulativeUsd: i === 0 ? null : 0.42 })).transport);
  await fr.host.run(mkMember('x:n_a:1', []), member('n_a'));
  near(fr.hosts.snapshot()[SID].openCut.cutUsd, priceUsage('claude-opus-5-5', { input_tokens: 5000, output_tokens: 700 }) + priceUsage('claude-haiku-4-5', { input_tokens: 1850 }),
    'its main agent priced from the result\'s own usage, as a booked turn is');
  assert.deepEqual(fr.hosts.snapshot()[SID].openCut.cutTokens, { in: 5000 + 1850, out: 700, cr: 0, cw: 0 }, 'and counted from it');
  const copilot = hostWith(runMockSession, { port: fakePort({ engineCost: false, engine: 'copilot' }) });
  mockT.resetSessions();
  await copilot.host.run(mkMember('x:n_a:1', []), member('n_a'));
  assert.deepEqual([copilot.port.booked.length, copilot.hosts.snapshot()[SID].openCut], [1, null], 'an engine without cost: booked at once as none (blank)');
});
