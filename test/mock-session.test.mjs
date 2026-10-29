// test/mock-session.test.mjs — the offline host plays a real session: one Agent call per turn, members through runMock.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMockSession, _testing } from '../src/core/engines/mock-session.mjs';
import { BRIEF_DIVIDER, dispatchMessage } from '../src/core/engines/session-dispatch.mjs';

after(() => _testing.resetSessions());
function turn({ resume = null, behave = null, model = 'claude-haiku-4-5', pluginDirs } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mock-sess-'));
  const out = join(dir, 'plan.md');
  const agentType = 'worca-x-n_plan-1-a1';
  const agents = { [agentType]: { description: 'Plan', prompt: `SYS\nMOCK_ROLE: generic-producer${BRIEF_DIVIDER}TASK\nMOCK_OUT: ${out}`, tools: ['Read'] } };
  const frames = [];
  _testing.behave = behave;
  return runMockSession({ cwd: dir, agents, agentsViaFile: true, prompt: dispatchMessage({ agentType, label: 'Plan' }), resumeSessionId: resume, model, pluginDirs, onEvent: (e) => frames.push(e) })
    .then((r) => ({ r, frames, out }), (err) => ({ err, frames, out }));
}

test('one turn: init, Agent call, member frames with parent ids, tool_result, DONE, cumulative result; the member wrote its file', async () => {
  const { r, frames, out } = await turn();
  const raws = frames.map((f) => f.raw).filter(Boolean);
  assert.equal(raws[0].type, 'system');
  assert.equal(raws[0].model, 'claude-haiku-4-5');
  const call = raws.find((x) => x.type === 'assistant' && x.message?.content?.some((c) => c.name === 'Agent')).message.content[0];
  assert.equal(call.input.subagent_type, 'worca-x-n_plan-1-a1');
  assert.ok(raws.filter((x) => x.parent_tool_use_id === call.id).length > 0);
  assert.ok(raws.every((x) => x.type !== 'result' || !x.parent_tool_use_id), 'the member result is dropped');
  assert.ok(existsSync(out));
  assert.equal(r.exitCode, 0);
  const res = raws.at(-1);
  assert.equal(res.type, 'result');
  assert.ok(Math.abs(res.total_cost_usd - (0.0011 + 0.0085)) < 1e-12, 'costFor unset: one Haiku host message + the member\'s 5000/700 tokens at Haiku');
});

test('--resume continues the cumulative total of the same host session', async () => {
  _testing.costFor = () => 0.25;
  const a = await turn();
  const sid = a.frames.find((f) => f.raw?.type === 'system').raw.session_id;
  const b = await turn({ resume: sid });
  assert.equal(b.frames.find((f) => f.raw?.type === 'system').raw.session_id, sid);
  assert.ok(Math.abs(b.frames.at(-1).raw.total_cost_usd - 2 * 0.2511) < 1e-12);
  _testing.costFor = null;
});

test('failure shapes follow the CLI: vanished, budget exits 1 after its result, sideload refusal before init', async () => {
  assert.match((await turn({ resume: 'mock-host-gone', behave: () => 'vanished' })).err.message, /No conversation found/);
  const b = await turn({ behave: () => 'budget' });
  assert.match(b.err.message, /exited with code 1/);
  assert.equal(b.frames.map((f) => f.raw).filter(Boolean).find((x) => x.type === 'result').subtype, 'error_max_budget_usd');
  const s = await turn({ behave: () => 'sideload-refused', pluginDirs: ['/p'] });
  assert.ok(s.err);
  assert.ok(s.frames.some((f) => f.type === 'log' && /--plugin-dir/.test(f.text)));
  assert.equal(s.frames.some((f) => f.raw?.type === 'system'), false, 'no init');
});

test('v4 — onTurn runs once per turn the CLI ran, never for a turn it refused before any model call (vanished, sideload)', async () => {
  const turns = [];
  _testing.onTurn = (t) => turns.push(t.agentType);
  try {
    await turn({ resume: 'mock-host-gone', behave: () => 'vanished' });
    await turn({ behave: () => 'sideload-refused', pluginDirs: ['/p'] });
    assert.deepEqual(turns, []);
    await turn();
    assert.deepEqual(turns, ['worca-x-n_plan-1-a1']);
  } finally { _testing.onTurn = null; _testing.behave = null; }
});

test('a behaviour that waits for the kill rejects as an abort when the signal fires', async () => {
  const ac = new AbortController();
  const dir = mkdtempSync(join(tmpdir(), 'mock-sess-'));
  const agentType = 'worca-x-n_plan-1-a1';
  _testing.behave = () => 'two-dispatch';
  const frames = [];
  const p = runMockSession({ cwd: dir, agents: { [agentType]: { prompt: `SYS${BRIEF_DIVIDER}TASK` } }, agentsViaFile: true,
    prompt: dispatchMessage({ agentType, label: 'Plan' }), signal: ac.signal, onEvent: (e) => frames.push(e) });
  await new Promise((r) => setImmediate(r));
  assert.equal(frames.filter((f) => f.raw?.type === 'assistant' && !f.raw.parent_tool_use_id && f.raw.message?.content?.some((c) => c.name === 'Agent')).length, 2);
  ac.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
  _testing.behave = null;
});

// ── v2: every behaviour through the REAL demux (Task 32), so the mock and production agree on each verdict; the seams ──
import { createTurnDemux, watchdogVerdict } from '../src/core/engines/session-demux.mjs';
import { MOCK_HOST_USAGE, MOCK_MEMBER_USAGE } from '../src/core/engines/mock-session.mjs';
import { checkRows } from './helpers/rows.mjs';

const AT = 'worca-x-n_plan-1-a1';
async function viaDemux(behave, { resume = null, pluginDirs, role = 'generic-producer', model = 'claude-haiku-4-5' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mock-sess-'));
  const ac = new AbortController();
  const member = []; const warns = []; const frames = [];
  const demux = createTurnDemux({ agentType: AT, onMember: (e) => member.push(e), onViolation: () => ac.abort(), onWarn: (w) => warns.push(w) });
  _testing.behave = behave ? () => behave : null;
  let err = null; let r = null;
  try {
    r = await runMockSession({ cwd: dir, agents: { [AT]: { prompt: `SYS\nMOCK_ROLE: ${role}${BRIEF_DIVIDER}TASK\nMOCK_OUT: ${join(dir, 'o.md')}` } }, agentsViaFile: true,
      prompt: dispatchMessage({ agentType: AT, label: 'Plan' }), resumeSessionId: resume, model, pluginDirs, signal: ac.signal, onEvent: (e) => { frames.push(e); demux.feed(e); } });
  } catch (e) { err = e; }
  _testing.behave = null;
  const facts = demux.facts();
  return { r, err, facts, verdict: watchdogVerdict(facts), member, warns, frames };
}

test('v2 — every behaviour gives the demux the facts production would see', async () => {
  _testing.costFor = null;
  await checkRows([
    { name: 'clean', run: async () => {
      const starts = [];
      _testing.onMemberStart = (a) => starts.push(a);
      const x = await viaDemux(null);
      _testing.onMemberStart = null;
      assert.deepEqual(starts.map((a) => a.agentType), [AT]);
      assert.equal(x.verdict, null); assert.equal(x.facts.done.isError, false); assert.equal(x.facts.done.resolvedModel, 'claude-haiku-4-5');
      assert.deepEqual(x.facts.done.usage, MOCK_MEMBER_USAGE); assert.equal(x.facts.done.tokens, 5700); assert.equal(x.facts.done.durationMs, 1);
      assert.match(x.facts.done.agentId, /^mock-agent-\d+$/); assert.match(x.facts.done.report, /generic artifact written/);
      assert.deepEqual(x.facts.hostUsage, { in: 1000, out: 20, cr: 0, cw: 0 }); assert.equal(x.facts.result.subtype, 'success');
      assert.equal(x.facts.hostInitModel, 'claude-haiku-4-5'); assert.equal(x.facts.agentCalls, 1); assert.equal(x.r.exitCode, 0);
    } },
    { name: 'no-dispatch', run: async () => { const x = await viaDemux('no-dispatch'); assert.deepEqual(x.verdict, { code: 'SESSION_HOST_NO_DISPATCH', detail: { agentCalls: 0 } }); assert.equal(x.r.exitCode, 0); } },
    { name: 'two-dispatch', run: async () => { const x = await viaDemux('two-dispatch'); assert.equal(x.verdict.code, 'SESSION_HOST_MULTI_DISPATCH'); assert.equal(x.err.name, 'AbortError'); } },
    { name: 'stray-bash', run: async () => { const x = await viaDemux('stray-bash'); assert.deepEqual(x.verdict, { code: 'SESSION_HOST_STRAY_TOOL', detail: { strayTools: ['Bash'] } }); assert.equal(x.err.name, 'AbortError'); } },
    { name: 'model-override', run: async () => { const x = await viaDemux('model-override'); assert.deepEqual(x.verdict, { code: 'SESSION_HOST_NO_DISPATCH', detail: { override: ['model'] } }); } },
    { name: 'background', run: async () => { const x = await viaDemux('background'); assert.deepEqual(x.verdict, { code: 'SESSION_HOST_NO_DISPATCH', detail: { background: true } }); assert.equal(x.facts.done, null); } },
    { name: 'wrong-type', run: async () => { const x = await viaDemux('wrong-type'); assert.deepEqual(x.verdict, { code: 'SESSION_HOST_NO_DISPATCH', detail: { wrongType: 'general-purpose' } }); } },
    { name: 'stray-after-done: accepted, the violation is after done', run: async () => {
      const x = await viaDemux('stray-after-done');
      assert.equal(x.verdict, null); assert.equal(x.facts.afterDone[0].code, 'SESSION_HOST_STRAY_TOOL'); assert.equal(x.facts.result, null); assert.equal(x.err.name, 'AbortError');
    } },
    { name: 'cap: a member error the demux flags as the cap; the child never ran', run: async () => {
      let starts = 0;
      _testing.onMemberStart = () => { starts += 1; };
      const x = await viaDemux('cap');
      _testing.onMemberStart = null;
      assert.equal(starts, 0);
      assert.ok(Math.abs(_testing.spent.get(x.facts.hostSessionId) - 0.0011) < 1e-12, 'only the host message spent');
      assert.equal(x.verdict, null); assert.equal(x.facts.done.isError, true); assert.equal(x.facts.capRefused, true); assert.equal(x.facts.result.subtype, 'success');
    } },
    { name: 'member-error and child-overloaded carry their text', run: async () => {
      const e = await viaDemux('member-error');
      assert.equal(e.facts.done.errorText, 'boom');
      assert.ok(Math.abs(_testing.spent.get(e.facts.hostSessionId) - 0.0011) < 1e-12, 'the child spent nothing');
      const o = await viaDemux('child-overloaded');
      assert.equal(o.facts.done.errorText, 'API Error: 529 {"type":"overloaded_error"}'); assert.equal(o.facts.capRefused, false);
    } },
    { name: 'usage-limit: the member spends, then the host rejects with the adapter\'s class and no result', run: async () => {
      _testing.resetSessions();
      _testing.costFor = () => 0.3;
      const x = await viaDemux('usage-limit');
      _testing.costFor = null;
      assert.ok(Math.abs(_testing.spent.get('mock-host-1') - 0.3011) < 1e-12);
      assert.equal(x.err.errorClass, 'usage_limit'); assert.match(x.err.message, /hit your session limit/); assert.equal(x.facts.result, null); assert.equal(x.facts.done.isError, true);
    } },
    { name: 'host-error-after-member: a clean done, no result', run: async () => {
      const x = await viaDemux('host-error-after-member');
      assert.match(x.err.message, /exited with code 1/); assert.equal(x.facts.done.isError, false); assert.equal(x.facts.result, null); assert.equal(x.verdict, null);
    } },
    { name: 'hooks: the bound call\'s cost is the hook figure; an investigator\'s reaches the member', run: async () => {
      _testing.hookUsd = { member: 0.2489, investigator: 0.03 };
      const x = await viaDemux('hooks');
      _testing.hookUsd = null;
      assert.equal(x.facts.hookUsd, 0.2489); assert.equal(x.member.filter((e) => e.type === 'hook').length, 1);
    } },
    { name: 'no-cost: a result without a cost', run: async () => { const x = await viaDemux('no-cost'); assert.equal(x.facts.result.cumulativeUsd, null); assert.equal(x.verdict, null); } },
    { name: 'budget and max-turns: the subtype, then exit 1, no Agent call', run: async () => {
      for (const [b, sub] of [['budget', 'error_max_budget_usd'], ['max-turns', 'error_max_turns']]) {
        const x = await viaDemux(b);
        assert.equal(x.facts.result.subtype, sub); assert.equal(x.facts.result.isError, true); assert.equal(x.facts.result.cumulativeUsd, 0); assert.equal(x.facts.agentCalls, 0); assert.match(x.err.message, /exited with code 1/);
      }
    } },
    { name: 'vanished only on a resume; sideload only with plugin dirs', run: async () => {
      assert.equal((await viaDemux('vanished')).verdict, null);
      assert.equal((await viaDemux('sideload-refused')).verdict, null);
      const s = await viaDemux('sideload-refused', { pluginDirs: ['/p'] });
      assert.equal(s.facts.sawInit, false); assert.equal(s.facts.said[0], 'Error: --plugin-dir is disabled by managed settings (disableSideloadFlags)');
    } },
    { name: 'hang: the member starts, then the kill', run: async () => {
      const ac = new AbortController();
      const dir = mkdtempSync(join(tmpdir(), 'mock-sess-'));
      const frames = [];
      _testing.behave = () => 'hang';
      const p = runMockSession({ cwd: dir, agents: { [AT]: { prompt: `SYS${BRIEF_DIVIDER}TASK` } }, prompt: dispatchMessage({ agentType: AT, label: 'Plan' }),
        model: 'claude-haiku-4-5', signal: ac.signal, onEvent: (e) => frames.push(e) });
      await new Promise((r) => setImmediate(r));
      _testing.behave = null;
      const call = frames.find((f) => f.raw?.message?.content?.some((c) => c.name === 'Agent')).raw.message.content[0];
      assert.ok(frames.some((f) => f.raw?.parent_tool_use_id === call.id), 'the member\'s first frame');
      const n = frames.length;
      ac.abort();
      await assert.rejects(p, (e) => e.name === 'AbortError');
      assert.equal(frames.length, n, 'nothing after the kill');
    } },
  ]);
});

test('v2 — seen, the turn counter, behave\'s and costFor\'s arguments; resetSessions clears the session state', async () => {
  _testing.resetSessions();
  const calls = [];
  _testing.costFor = (a) => { calls.push(a); return 0.1; };
  const dir = mkdtempSync(join(tmpdir(), 'mock-sess-'));
  const agents = { [AT]: { prompt: `SYS\nMOCK_ROLE: generic-producer${BRIEF_DIVIDER}BRIEF\nMOCK_OUT: ${join(dir, 'o.md')}`, model: 'claude-opus-5-5' } };
  const prompt = dispatchMessage({ agentType: AT, label: 'Plan' });
  const behaves = [];
  _testing.behave = (a) => { behaves.push(a); return null; };
  const frames = [];
  await runMockSession({ cwd: dir, agents, prompt, effort: 'low', maxBudgetUsd: 2, pluginDirs: ['/p'], onEvent: (e) => frames.push(e) });
  await runMockSession({ cwd: dir, agents, prompt, resumeSessionId: 'mock-host-1', onEvent: () => {} });
  _testing.behave = null; _testing.costFor = null;
  assert.deepEqual(_testing.seen.map((s) => [s.agentType, s.resumeSessionId, s.hostSessionId, s.model, s.effort, s.maxBudgetUsd, s.pluginDirs]),
    [[AT, null, 'mock-host-1', null, 'low', 2, ['/p']], [AT, 'mock-host-1', 'mock-host-1', null, null, null, null]]);
  assert.equal(_testing.seen[0].briefPrompt, `BRIEF\nMOCK_OUT: ${join(dir, 'o.md')}`);
  assert.equal(_testing.seen[0].prompt, prompt);
  assert.deepEqual(behaves.map((b) => [b.agentType, b.turn, b.resume]), [[AT, 1, false], [AT, 2, true]]);
  assert.equal(behaves[0].hostOpts.effort, 'low');
  assert.deepEqual(calls, [{ agentType: AT, turn: 1 }, { agentType: AT, turn: 2 }]);
  const raws = frames.map((f) => f.raw).filter(Boolean);
  assert.equal(raws[0].model, 'mock-default', 'no --model: the init says the CLI default');
  assert.equal(raws.find((x) => x.tool_use_result).tool_use_result.resolvedModel, 'claude-opus-5-5', 'the definition\'s model wins');
  assert.equal(raws.filter((x) => x.type === 'assistant' && !x.parent_tool_use_id && x.message?.usage).length, 1, 'only the first host message has usage');
  assert.ok(Math.abs(_testing.spent.get('mock-host-1') - 0.2) < 1e-12, 'an unpriced host model spends 0; costFor twice');
  _testing.resetSessions();
  assert.deepEqual([_testing.seen.length, _testing.spent.size], [0, 0]);
  _testing.behave = (a) => { behaves.push(a); return null; };
  await runMockSession({ cwd: dir, agents, prompt, onEvent: () => {} });
  _testing.behave = null;
  assert.equal(behaves.at(-1).turn, 1, 'the counter restarts');
  assert.equal(_testing.seen[0].hostSessionId, 'mock-host-1', 'so do the host ids');
});

test('v2 — a cut turn reaches the next cumulative only when the CLI restores it; spendBeforeHang is spent', async () => {
  for (const restore of [true, false, null]) {                     // v4: only a literal false loses the spend (null: the default)
    _testing.resetSessions();
    _testing.restoreCutCost = restore;
    _testing.spendBeforeHang = 0.07;
    const ac = new AbortController();
    const dir = mkdtempSync(join(tmpdir(), 'mock-sess-'));
    const agents = { [AT]: { prompt: `SYS\nMOCK_ROLE: generic-producer${BRIEF_DIVIDER}TASK\nMOCK_OUT: ${join(dir, 'o.md')}` } };
    const prompt = dispatchMessage({ agentType: AT, label: 'Plan' });
    _testing.behave = () => 'hang';
    const p = runMockSession({ cwd: dir, agents, prompt, model: 'claude-haiku-4-5', signal: ac.signal, onEvent: () => {} });
    await new Promise((r) => setImmediate(r));
    ac.abort();
    await assert.rejects(p);
    _testing.behave = null;
    assert.ok(Math.abs(_testing.spent.get('mock-host-1') - (0.0011 + 0.07)) < 1e-12);
    const frames = [];
    await runMockSession({ cwd: dir, agents, prompt, model: 'claude-haiku-4-5', resumeSessionId: 'mock-host-1', onEvent: (e) => frames.push(e) });
    const total = frames.at(-1).raw.total_cost_usd;
    const turn2 = 0.0011 + 0.0085;
    assert.ok(Math.abs(total - (restore !== false ? 0.0711 + turn2 : turn2)) < 1e-12, `restore=${restore}: ${total}`);
    const third = [];
    await runMockSession({ cwd: dir, agents, prompt, model: 'claude-haiku-4-5', resumeSessionId: 'mock-host-1', onEvent: (e) => third.push(e) });
    assert.ok(Math.abs(third.at(-1).raw.total_cost_usd - total - turn2) < 1e-12, 'a turn with a result is never lost');
  }
  _testing.restoreCutCost = true;
});

test('v2 — a member frame that has a parent keeps it (investigators); the rest get the bound call; the member\'s session and result never pass', async () => {
  const x = await viaDemux(null, { role: 'implementer' });
  assert.equal(x.verdict, null);
  assert.equal(x.facts.investigators.length, 2, 'the member\'s two Agent calls finished');
  assert.deepEqual(x.facts.strayTools, [], 'the member\'s Skill and MCP calls are not the host\'s');
  assert.ok(x.facts.hostSessionId.startsWith('mock-host-'), 'runMock\'s own session id never reached the host');
  assert.ok(x.frames.some((f) => f.raw?.parent_tool_use_id === 'mock_implementer_1'), 'an investigator\'s frame keeps its own parent');
  assert.ok(x.frames.filter((f) => f.raw && f.raw.type !== 'result' && !f.raw.mock && f.raw.parent_tool_use_id === null && f.raw.type === 'assistant')
    .every((f) => !f.raw.message.content.some((c) => c.name === 'Skill')), 'no member Skill call reaches the host level');
  assert.ok(x.member.some((e) => e.type === 'subagent' || e.type === 'tool_use' || e.type === 'text'));
});

test('v2 — nothing reaches the stream after the kill, even while runMock is still running', async () => {
  const ac = new AbortController();
  const dir = mkdtempSync(join(tmpdir(), 'mock-sess-'));
  const frames = []; let n = -1;
  const p = runMockSession({ cwd: dir, agents: { [AT]: { prompt: `SYS\nMOCK_ROLE: implementer${BRIEF_DIVIDER}TASK` } }, prompt: dispatchMessage({ agentType: AT, label: 'Plan' }),
    model: 'claude-haiku-4-5', signal: ac.signal,
    onEvent: (e) => { frames.push(e); if (n < 0 && e.raw?.parent_tool_use_id && e.raw.parent_tool_use_id.startsWith('mock_t')) { ac.abort(); n = frames.length; } } });
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.ok(n > 0);
  assert.equal(frames.length, n, 'the member frames runMock emits before its next abort check are dropped');
});

// ── v3: what each behaviour spends, a budget stop's cumulative, a lost host error, the ack, the hooks gate, the prompt split, resetSessions ──
test('v3 — spend per behaviour, the budget cumulative, a lost host error, the ack, the hooks gate, the prompt split and resetSessions', async () => {
  _testing.costFor = null;
  const spentOn = (x) => _testing.spent.get(x.facts.hostSessionId);
  await checkRows([
    { name: 'host spend only: no-dispatch and every behaviour that waits for the kill', run: async () => {
      for (const b of ['no-dispatch', 'two-dispatch', 'stray-bash', 'model-override', 'background', 'wrong-type']) {
        const x = await viaDemux(b);
        assert.ok(Math.abs(spentOn(x) - 0.0011) < 1e-12, `${b}: ${spentOn(x)}`);
      }
    } },
    { name: 'stray-after-done: the member ran and spent', run: async () => {
      const x = await viaDemux('stray-after-done');
      assert.ok(Math.abs(spentOn(x) - (0.0011 + 0.0085)) < 1e-12);
    } },
    { name: 'usage-limit never starts the member', run: async () => {
      let starts = 0;
      _testing.onMemberStart = () => { starts += 1; };
      await viaDemux('usage-limit');
      _testing.onMemberStart = null;
      assert.equal(starts, 0);
    } },
    { name: 'budget reports the host session\'s cumulative so far', run: async () => {
      const a = await viaDemux(null);
      const before = a.facts.result.cumulativeUsd;
      const b = await viaDemux('budget', { resume: a.facts.hostSessionId });
      assert.ok(before > 0);
      assert.equal(b.facts.result.cumulativeUsd, before);
    } },
    { name: 'a host error after the member is lost when the CLI does not restore it', run: async () => {
      _testing.resetSessions();
      _testing.restoreCutCost = false;
      const e = await viaDemux('host-error-after-member');
      const c = await viaDemux(null, { resume: e.facts.hostSessionId });
      _testing.restoreCutCost = true;
      assert.ok(Math.abs(c.facts.result.cumulativeUsd - (0.0011 + 0.0085)) < 1e-12, `${c.facts.result.cumulativeUsd}`);
    } },
    { name: 'the background ack names an agent', run: async () => {
      const x = await viaDemux('background');
      const ack = x.frames.find((f) => f.raw?.tool_use_result?.isAsync).raw.tool_use_result;
      assert.equal(ack.status, 'async_launched');
      assert.match(ack.agentId, /^mock-agent-\d+$/);
    } },
    { name: 'hooks: a figure that is not finite sends no envelope', run: async () => {
      _testing.hookUsd = { investigator: 0.03 };
      const x = await viaDemux('hooks');
      _testing.hookUsd = null;
      assert.equal(x.frames.filter((f) => f.type === 'hook-event').length, 1);
      assert.equal(x.facts.hookUsd, null);
    } },
    { name: 'a definition without the divider is all system prompt', run: async () => {
      _testing.resetSessions();
      const dir = mkdtempSync(join(tmpdir(), 'mock-sess-'));
      const out = join(dir, 'p.md');
      await runMockSession({ cwd: dir, agents: { [AT]: { prompt: `SYS\nMOCK_ROLE: generic-producer\nMOCK_OUT: ${out}` } }, prompt: dispatchMessage({ agentType: AT, label: 'Plan' }),
        model: 'claude-haiku-4-5', onEvent: () => {} });
      assert.equal(_testing.seen[0].briefPrompt, '');
      assert.ok(existsSync(out), 'the member read its markers from the system prompt');
    } },
    { name: 'resetSessions keeps the test configuration', run: () => {
      const cfg = { costFor: () => 1, behave: () => null, onMemberStart: () => {}, hookUsd: { member: 1 }, restoreCutCost: false };
      Object.assign(_testing, cfg);
      _testing.resetSessions();
      const kept = { costFor: _testing.costFor, behave: _testing.behave, onMemberStart: _testing.onMemberStart, hookUsd: _testing.hookUsd, restoreCutCost: _testing.restoreCutCost };
      Object.assign(_testing, { costFor: null, behave: null, onMemberStart: null, hookUsd: null, restoreCutCost: true });
      assert.deepEqual(kept, cfg);
    } },
  ]);
});

// ── v4: the clean turn field by field, refused turns mint nothing, each result's cumulative, a zero costFor, the member's own model, no signal, frozen usages ──
import { priceUsage } from '../src/core/session-cost.mjs';

test('v4 — the clean turn field by field, refused turns mint no host id, every result reports the cumulative, costFor 0, the member\'s own model, a wait with no signal', async () => {
  _testing.costFor = null;
  const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-12, `${m ?? ''} ${a} vs ${b}`);
  await checkRows([
    { name: 'clean: the member start, the tool_result meta, the result, the host messages\' model', run: async () => {
      _testing.resetSessions();
      const starts = [];
      _testing.onMemberStart = (a) => starts.push(a);
      const x = await viaDemux(null);
      _testing.onMemberStart = null;
      assert.deepEqual(starts, [{ agentType: AT, turn: 1 }]);
      assert.deepEqual(x.frames.find((f) => f.raw?.tool_use_result).raw.tool_use_result,
        { usage: MOCK_MEMBER_USAGE, resolvedModel: 'claude-haiku-4-5', totalDurationMs: 1, totalTokens: 5700, agentType: AT, agentId: 'mock-agent-1' });
      assert.equal(x.facts.result.isError, false);
      assert.equal(x.frames.at(-1).raw.session_id, x.facts.hostSessionId, 'the result names the host session the harness books against');
      assert.deepEqual(x.r, { text: 'DONE', exitCode: 0 });
      const host = x.frames.filter((f) => f.raw?.type === 'assistant' && f.raw.parent_tool_use_id === null);
      assert.equal(host.length, 2, 'the Agent call and DONE');
      assert.ok(host.every((f) => f.raw.message.model === 'claude-haiku-4-5'), 'every host message names the init model');
    } },
    { name: 'refused turns mint no host id: sideload has none, vanished keeps its resume id', run: async () => {
      _testing.resetSessions();
      await viaDemux('sideload-refused', { pluginDirs: ['/p'] });
      await viaDemux('vanished', { resume: 'mock-host-gone' });
      const x = await viaDemux(null);
      assert.deepEqual(_testing.seen.map((s) => s.hostSessionId), [null, 'mock-host-gone', 'mock-host-1']);
      assert.equal(x.facts.hostSessionId, 'mock-host-1', 'the host counter did not move');
    } },
    { name: 'no-dispatch and the member errors: the result reports the host spend, DONE, exit 0', run: async () => {
      const n = await viaDemux('no-dispatch');
      near(n.facts.result.cumulativeUsd, 0.0011, 'no-dispatch');
      for (const b of ['cap', 'member-error', 'child-overloaded']) {
        const x = await viaDemux(b);
        near(x.facts.result.cumulativeUsd, 0.0011, b);
        assert.deepEqual(x.r, { text: 'DONE', exitCode: 0 }, b);
      }
    } },
    { name: 'costFor 0 is a $0 member, not the priced fallback', run: async () => {
      _testing.costFor = () => 0;
      const x = await viaDemux(null);
      _testing.costFor = null;
      near(_testing.spent.get(x.facts.hostSessionId), 0.0011);
    } },
    { name: 'the member is priced at its own resolved model, not the host\'s', run: async () => {
      _testing.resetSessions();
      const dir = mkdtempSync(join(tmpdir(), 'mock-sess-'));
      await runMockSession({ cwd: dir, agents: { [AT]: { prompt: `SYS\nMOCK_ROLE: generic-producer${BRIEF_DIVIDER}TASK\nMOCK_OUT: ${join(dir, 'o.md')}`, model: 'claude-opus-5-5' } },
        prompt: dispatchMessage({ agentType: AT, label: 'Plan' }), model: 'claude-haiku-4-5', onEvent: () => {} });
      const opus = priceUsage('claude-opus-5-5', MOCK_MEMBER_USAGE);
      assert.ok(Number.isFinite(opus) && Math.abs(opus - 0.0085) > 1e-6, 'the two models price differently');
      near(_testing.spent.get('mock-host-1'), 0.0011 + opus);
    } },
    { name: 'a behaviour that waits for the kill, run with no signal, rejects at once with a plain Error', run: async () => {
      _testing.behave = () => 'two-dispatch';
      const dir = mkdtempSync(join(tmpdir(), 'mock-sess-'));
      const p = runMockSession({ cwd: dir, agents: { [AT]: { prompt: `SYS${BRIEF_DIVIDER}TASK` } }, prompt: dispatchMessage({ agentType: AT, label: 'Plan' }), onEvent: () => {} });
      _testing.behave = null;
      let timer;
      const hung = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('the turn hung')), 2000); });
      try {
        await Promise.race([assert.rejects(p, (e) => e.name !== 'AbortError' && /no signal/.test(e.message)), hung]);
      } finally { clearTimeout(timer); }
    } },
    { name: 'the two usages are frozen', run: () => assert.ok(Object.isFrozen(MOCK_HOST_USAGE) && Object.isFrozen(MOCK_MEMBER_USAGE)) },
  ]);
});

test('v4 — nothing reaches the stream after the kill: inside runMock\'s own steps, between investigators, and before DONE', async () => {
  const cases = [
    ['a member log line (runMock emits its file write next, with no abort check)', 'generic-producer', (e) => /writing output artifact/.test(e.text ?? '')],
    ['an investigator\'s tool_result (the next one follows with no abort check)', 'implementer', (e) => e.raw?.type === 'user' && e.raw.message?.content?.some?.((c) => c.tool_use_id === 'mock_implementer_1')],
    ['the member\'s tool_result on the host (DONE would follow)', 'generic-producer', (e) => !!e.raw?.tool_use_result && e.raw.parent_tool_use_id === null],
  ];
  for (const [name, role, at] of cases) {
    const ac = new AbortController();
    const dir = mkdtempSync(join(tmpdir(), 'mock-sess-'));
    const frames = []; let n = -1;
    const p = runMockSession({ cwd: dir, agents: { [AT]: { prompt: `SYS\nMOCK_ROLE: ${role}${BRIEF_DIVIDER}TASK\nMOCK_OUT: ${join(dir, 'o.md')}` } },
      prompt: dispatchMessage({ agentType: AT, label: 'Plan' }), model: 'claude-haiku-4-5', signal: ac.signal,
      onEvent: (e) => { frames.push(e); if (n < 0 && at(e)) { ac.abort(); n = frames.length; } } });
    await assert.rejects(p, (e) => e.name === 'AbortError', name);
    assert.ok(n > 0, `${name}: the kill point was reached`);
    assert.equal(frames.length, n, `${name}: nothing after the kill`);
  }
});

// ── v5: a fourth sweep (refine cycle 4): the seams' defaults, the frame shape of every behaviour, a kill before the member ran ──
test('v5 — the test seams start as the Interfaces say; resetSessions clears spendBeforeHang', async () => {
  const fresh = await import(new URL('../src/core/engines/mock-session.mjs?v5-defaults', import.meta.url).href);
  const t = fresh._testing;
  assert.deepEqual([t.costFor, t.behave, t.onMemberStart, t.hookUsd, t.restoreCutCost, t.spendBeforeHang, t.spent.size, t.seen.length],
    [null, null, null, null, true, null, 0, 0], 'a fresh module');
  _testing.spendBeforeHang = 0.07;
  _testing.resetSessions();
  assert.equal(_testing.spendBeforeHang, null);
  _testing.behave = () => 'sideload-refused';
  await runMockSession({ cwd: tmpdir(), agents: { [AT]: { prompt: `${BRIEF_DIVIDER}TASK` } }, prompt: dispatchMessage({ agentType: AT, label: 'Plan' }),
    pluginDirs: ['/p'], maxBudgetUsd: 0, onEvent: () => {} }).catch(() => {});
  await runMockSession({ cwd: tmpdir(), agents: {}, prompt: 'no dispatch line', pluginDirs: ['/p'], onEvent: () => {} }).catch(() => {});
  _testing.behave = null;
  const [a, b] = _testing.seen.slice(-2);
  assert.deepEqual([a.hostSessionId, a.maxBudgetUsd, a.briefPrompt], [null, 0, 'TASK'], 'a fresh refused turn mints no host id; a $0 budget is 0; a divider at the start leaves all of the rest as the brief');
  assert.equal(b.agentType, null, 'no dispatch line: no type');
});

test('v5 — every behaviour: one host message carries usage, each result says is_error false, an error tool_result still ends in DONE, the ack is no error', async () => {
  const ends = { clean: 'result', 'no-dispatch': 'result', cap: 'result', 'member-error': 'result', 'child-overloaded': 'result', 'no-cost': 'result',
    hooks: 'result', 'two-dispatch': 'wait', 'stray-bash': 'wait', 'model-override': 'wait', 'wrong-type': 'wait', background: 'wait', 'stray-after-done': 'wait' };
  for (const [name, end] of Object.entries(ends)) {
    _testing.resetSessions();
    const { frames } = await turn({ behave: () => (name === 'clean' ? null : name) });
    _testing.behave = null;
    const raws = frames.map((f) => f.raw).filter(Boolean);
    const host = raws.filter((x) => x.type === 'assistant' && !x.parent_tool_use_id);
    assert.equal(host.filter((x) => x.message?.usage).length, 1, `${name}: only the turn's first host message carries usage`);
    assert.ok(host[0].message.usage, `${name}: and that is the first`);
    const results = raws.filter((x) => x.type === 'result');
    if (end === 'result') assert.deepEqual(results.map((x) => [x.subtype, x.is_error]), [['success', false]], name);
    else assert.equal(results.length, 0, name);
  }
  for (const b of ['cap', 'member-error', 'child-overloaded']) {
    const raws = (await turn({ behave: () => b })).frames.map((f) => f.raw).filter(Boolean);
    _testing.behave = null;
    const i = raws.findIndex((x) => x.type === 'user');
    assert.equal(raws[i].message.content[0].is_error, true, b);
    assert.equal(raws[i + 1]?.message?.content?.[0]?.text, 'DONE', `${b}: the main agent still ends with DONE`);
  }
  const ack = (await turn({ behave: () => 'background' })).frames.map((f) => f.raw).filter(Boolean).find((x) => x.type === 'user');
  _testing.behave = null;
  assert.equal('is_error' in ack.message.content[0], false, 'the background ack is not an error');
});

test('v5 — a kill at the Agent call, or on runMock\'s last frame, rejects as an abort and spends nothing the stream did not show', async () => {
  const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-12, `${m} ${a} vs ${b}`);
  for (const [behaviour, killAt] of [['cap', 'Agent call'], ['usage-limit', 'Agent call'], [null, 'last member frame']]) {
    _testing.resetSessions();
    _testing.behave = () => behaviour;
    const ac = new AbortController();
    const dir = mkdtempSync(join(tmpdir(), 'mock-sess-'));
    const agents = { [AT]: { prompt: `SYS\nMOCK_ROLE: generic-producer${BRIEF_DIVIDER}TASK\nMOCK_OUT: ${join(dir, 'o.md')}` } };
    const frames = [];
    const onEvent = (e) => {
      frames.push(e);
      const call = e.raw?.type === 'assistant' && !e.raw.parent_tool_use_id && e.raw.message?.content?.some((c) => c.name === 'Agent');
      if ((killAt === 'Agent call' && call) || (killAt === 'last member frame' && /^\[mock\] done role=/.test(e.text ?? ''))) ac.abort();
    };
    const p = runMockSession({ cwd: dir, agents, prompt: dispatchMessage({ agentType: AT, label: 'Plan' }), model: 'claude-haiku-4-5', signal: ac.signal, onEvent });
    await assert.rejects(p, (e) => e.name === 'AbortError', `${behaviour} killed at the ${killAt}`);
    _testing.behave = null;
    near(_testing.spent.get('mock-host-1'), 0.0011, `${behaviour} killed at the ${killAt}: the host message only`);
    assert.equal(frames.some((f) => f.raw?.type === 'user' || f.raw?.type === 'result'), false, 'no tool_result, no result');
  }
});

test('v5 — a turn stopped before it starts, or killed before its result, rejects as an abort; that spend is lost unless the CLI restores it', async () => {
  const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-12, `${m} ${a} vs ${b}`);
  const dir = mkdtempSync(join(tmpdir(), 'mock-sess-'));
  const agents = { [AT]: { prompt: `SYS\nMOCK_ROLE: generic-producer${BRIEF_DIVIDER}TASK\nMOCK_OUT: ${join(dir, 'o.md')}` } };
  const prompt = dispatchMessage({ agentType: AT, label: 'Plan' });
  _testing.resetSessions();
  const stopped = new AbortController();
  stopped.abort();
  const frames = [];
  for (const b of [null, 'no-dispatch']) {
    _testing.behave = () => b;
    await assert.rejects(runMockSession({ cwd: dir, agents, prompt, model: 'claude-haiku-4-5', signal: stopped.signal, onEvent: (e) => frames.push(e) }),
      (e) => e.name === 'AbortError', `${b}: a stopped turn never starts`);
  }
  assert.deepEqual([frames.length, _testing.spent.size, _testing.seen.length, _testing.seen[1].hostSessionId], [0, 0, 2, null], 'no frame, no spend, no host id; seen still counts the call');
  const killOnInit = new AbortController();
  _testing.behave = () => null;
  await assert.rejects(runMockSession({ cwd: dir, agents, prompt, model: 'claude-haiku-4-5', signal: killOnInit.signal,
    onEvent: (e) => { if (e.raw?.subtype === 'init') killOnInit.abort(); } }), (e) => e.name === 'AbortError');
  assert.equal(_testing.spent.get('mock-host-1') ?? 0, 0, 'killed on init: the host message is never sent, so nothing is spent');
  for (const [b, killOn] of [['cap', 'user'], ['no-dispatch', 'assistant']]) {
    _testing.resetSessions();
    _testing.restoreCutCost = false;
    _testing.behave = () => b;
    const ac = new AbortController();
    await assert.rejects(runMockSession({ cwd: dir, agents, prompt, model: 'claude-haiku-4-5', signal: ac.signal,
      onEvent: (e) => { if (e.raw?.type === killOn && !e.raw.parent_tool_use_id) ac.abort(); } }), (e) => e.name === 'AbortError', `${b} killed on its ${killOn} frame`);
    _testing.behave = () => 'budget';
    const budget = [];
    await runMockSession({ cwd: dir, agents, prompt, model: 'claude-haiku-4-5', resumeSessionId: 'mock-host-1', onEvent: (e) => budget.push(e) }).catch(() => {});
    near(budget.find((f) => f.raw?.type === 'result').raw.total_cost_usd, 0, `${b}: the budget stop reports spent − lost`);
    _testing.behave = null;
    const next = [];
    await runMockSession({ cwd: dir, agents, prompt, model: 'claude-haiku-4-5', resumeSessionId: 'mock-host-1', onEvent: (e) => next.push(e) });
    near(next.at(-1).raw.total_cost_usd, 0.0011 + 0.0085, `${b}: the killed turn's host message is lost, as for any turn without a result`);
  }
  _testing.restoreCutCost = true;
  _testing.behave = null;
});

import { CHILD_PROMPT } from '../src/core/engines/session-dispatch.mjs';
import { existsSync as exists } from 'node:fs';

test('v5 — the frame details later runs pin: the Agent input, the texts and names, the error messages, the ids after a reset, the hang, the hooks gate, the signal and permission mode', async () => {
  _testing.resetSessions();
  const clean = (await turn()).frames.map((f) => f.raw).filter(Boolean);
  const call = clean.find((x) => x.type === 'assistant' && x.message?.content?.some((c) => c.name === 'Agent')).message.content[0];
  assert.deepEqual([call.id, call.input], ['mock_t1', { subagent_type: AT, prompt: CHILD_PROMPT }], 'the first call id after a reset, and exactly the dispatch input');
  const nd = await turn({ behave: () => 'no-dispatch' });
  assert.equal(nd.r.text, 'already done');
  assert.equal(nd.frames.map((f) => f.raw).find((x) => x?.type === 'assistant').message.content[0].text, 'already done');
  const sad = (await turn({ behave: () => 'stray-after-done' })).frames.map((f) => f.raw).filter(Boolean);
  assert.equal(sad.filter((x) => x.type === 'assistant' && !x.parent_tool_use_id).at(-1).message.content[0].name, 'TodoWrite');
  assert.equal((await turn({ behave: () => 'sideload-refused', pluginDirs: ['/p'] })).err.message, 'claude exited with code 1');
  assert.equal((await turn({ resume: 'mock-host-gone', behave: () => 'vanished' })).err.message, 'No conversation found with session ID: mock-host-gone');
  _testing.behave = null;
  const dir = mkdtempSync(join(tmpdir(), 'mock-sess-'));
  const out = join(dir, 'o.md');
  const plain = { [AT]: { prompt: `SYS\nMOCK_ROLE: generic-producer${BRIEF_DIVIDER}TASK\nMOCK_OUT: ${out}` } };
  const prompt = dispatchMessage({ agentType: AT, label: 'Plan' });
  const noModel = [];
  await runMockSession({ cwd: dir, agents: plain, prompt, onEvent: (e) => noModel.push(e) });
  assert.equal(noModel.map((f) => f.raw).find((x) => x?.tool_use_result).tool_use_result.resolvedModel, 'mock-default', 'no model anywhere: the CLI default');
  const started = [];
  _testing.onMemberStart = (a) => started.push(a);
  _testing.behave = () => 'hang';
  const hung = [];
  await runMockSession({ cwd: dir, agents: plain, prompt, model: 'claude-haiku-4-5', onEvent: (e) => hung.push(e) }).catch(() => {});
  _testing.onMemberStart = null;
  const member = hung.map((f) => f.raw).filter((x) => x?.parent_tool_use_id);
  assert.deepEqual([started.length, member.length, member[0].message.usage], [1, 1, undefined], 'hang: onMemberStart, then ONE member frame, with no usage');
  _testing.behave = () => 'hooks';
  _testing.hookUsd = { member: 0.1, investigator: NaN };
  const hooked = [];
  await runMockSession({ cwd: dir, agents: plain, prompt, model: 'claude-haiku-4-5', onEvent: (e) => hooked.push(e) });
  _testing.hookUsd = null;
  _testing.behave = null;
  assert.equal(hooked.filter((f) => f.type === 'hook-event').length, 1, 'a non-finite investigator figure sends no hook');
  const out2 = join(dir, 'killed.md');
  const ac = new AbortController();
  await assert.rejects(runMockSession({ cwd: dir, agents: { [AT]: { prompt: `SYS\nMOCK_ROLE: generic-producer${BRIEF_DIVIDER}TASK\nMOCK_OUT: ${out2}` } }, prompt,
    signal: ac.signal, onEvent: (e) => { if (/^\[mock\] starting role=/.test(e.text ?? '')) ac.abort(); } }), (e) => e.name === 'AbortError');
  assert.equal(exists(out2), false, 'runMock gets the signal: a member killed at its first line writes nothing');
  const asked = [];
  await runMockSession({ cwd: dir, agents: plain, prompt, permissionMode: 'dontAsk', onEvent: (e) => asked.push(e) });
  assert.notEqual(asked.map((f) => f.raw).find((x) => x?.tool_use_result).message.content[0].content[0].text,
    noModel.map((f) => f.raw).find((x) => x?.tool_use_result).message.content[0].content[0].text, 'runMock gets the permission mode (dontAsk takes the Ask arm)');
});
