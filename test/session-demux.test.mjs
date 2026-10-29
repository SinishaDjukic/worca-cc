// test/session-demux.test.mjs — every host frame has one home; every deviation of the main agent is named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurnDemux, watchdogVerdict, SUBAGENT_CAP_RE } from '../src/core/engines/session-demux.mjs';

const TYPE = 'worca-x-n_impl-2-a1';
const env = (raw) => ({ type: raw.type, raw });
const okTurn = (T = 'T1') => [
  { type: 'system', subtype: 'init', session_id: 'H1', model: 'claude-haiku-4-5' },
  { type: 'assistant', message: { id: 'h1', usage: { input_tokens: 900, output_tokens: 30, cache_read_input_tokens: 100 }, content: [{ type: 'tool_use', id: T, name: 'Agent', input: { subagent_type: TYPE, description: 'Implement', prompt: 'Begin your step.' } }] } },
  { type: 'assistant', parent_tool_use_id: T, message: { id: 'c1', content: [{ type: 'text', text: 'member at work' }], usage: { input_tokens: 5000, output_tokens: 700 } } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: T, content: [{ type: 'text', text: 'REPORT' }] }] },
    tool_use_result: { usage: { input_tokens: 5000, output_tokens: 700 }, resolvedModel: 'claude-opus-5-5', totalDurationMs: 61000, totalTokens: 5700, agentId: 'ag-1' } },
  { type: 'assistant', message: { id: 'h2', usage: { input_tokens: 950, output_tokens: 2 }, content: [{ type: 'text', text: 'DONE' }] } },
  { type: 'result', session_id: 'H1', total_cost_usd: 0.42, num_turns: 3, usage: { input_tokens: 1850 } },
];
function run(frames) {
  const seen = { member: [], host: [], viol: [], warn: [], bind: null, done: null, hook: null, init: null };
  const d = createTurnDemux({ agentType: TYPE, onMember: (e) => seen.member.push(e), onHostText: (t) => seen.host.push(t), onInit: (i) => { seen.init = i; },
    onBind: (id) => { seen.bind = id; }, onMemberDone: (x) => { seen.done = x; }, onHookCost: (u) => { seen.hook = u; }, onViolation: (v) => seen.viol.push(v), onWarn: (w) => seen.warn.push(w) });
  for (const f of frames) d.feed(f.type === 'hook-event' || f.type === 'log' ? f : env(f));
  return { d, seen, facts: d.facts() };
}

test('a clean turn: init, bind, member stream re-rooted, report, host usage per message, result; no verdict', () => {
  const { seen, facts } = run(okTurn());
  assert.deepEqual(seen.init, { hostSessionId: 'H1', model: 'claude-haiku-4-5' });
  assert.equal(facts.hostInitModel, 'claude-haiku-4-5');
  assert.equal(seen.bind, 'T1');
  assert.deepEqual(seen.member.filter((e) => e.type === 'text').map((e) => [e.text, e.parentId]), [['member at work', null]]);
  assert.equal(seen.member[0].type, 'session');
  assert.equal(seen.member[0].sessionId, 'H1');
  assert.deepEqual(seen.host, ['DONE']);
  assert.equal(seen.done.report, 'REPORT');
  assert.equal(seen.done.resolvedModel, 'claude-opus-5-5');
  assert.equal(seen.done.agentId, 'ag-1');
  assert.deepEqual(facts.hostUsage, { in: 1850, out: 32, cr: 100, cw: 0 });
  assert.deepEqual(facts.lastHostUsage, { in: 950, out: 2, cr: 0, cw: 0 }, 'minor 4: the gauge is the last message, not the sum');
  assert.equal(facts.result.cumulativeUsd, 0.42);
  assert.equal(watchdogVerdict(facts), null);
});

test('watchdog rows before the step finished', () => {
  const zero = run([okTurn()[0], { type: 'assistant', message: { content: [{ type: 'text', text: 'already done' }] } }, okTurn()[5]]);
  assert.deepEqual(watchdogVerdict(zero.facts), { code: 'SESSION_HOST_NO_DISPATCH', detail: { agentCalls: 0 } });
  const two = okTurn(); two.splice(3, 0, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'T2', name: 'Agent', input: { subagent_type: TYPE } }] } });
  const t = run(two.slice(0, 4));                                  // the kill lands before the tool_result
  assert.deepEqual(t.seen.viol.map((v) => v.code), ['SESSION_HOST_MULTI_DISPATCH']);
  assert.equal(watchdogVerdict(t.facts).code, 'SESSION_HOST_MULTI_DISPATCH');
  const stray = okTurn(); stray.splice(1, 0, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'B1', name: 'Bash', input: { command: 'rm -rf x' } }] } });
  const s = run(stray.slice(0, 2));
  assert.deepEqual(watchdogVerdict(s.facts), { code: 'SESSION_HOST_STRAY_TOOL', detail: { strayTools: ['Bash'] } });
  assert.ok(!JSON.stringify(s.facts).includes('rm -rf'), 'tool names only, never tool input');
  const wrong = okTurn(); wrong[1] = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'T9', name: 'Agent', input: { subagent_type: 'general-purpose' } }] } };
  assert.deepEqual(run(wrong).seen.viol[0], { code: 'SESSION_HOST_NO_DISPATCH', detail: { wrongType: 'general-purpose' } });
  const bg = okTurn(); bg[3] = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'T1', content: 'launched' }] }, tool_use_result: { isAsync: true, status: 'async_launched' } };
  assert.deepEqual(run(bg).seen.viol[0], { code: 'SESSION_HOST_NO_DISPATCH', detail: { background: true } });
  const ov = okTurn(); ov[1].message.content[0].input.model = 'opus';
  assert.deepEqual(run(ov.slice(0, 2)).seen.viol[0], { code: 'SESSION_HOST_NO_DISPATCH', detail: { override: ['model'] } }, 'C11: the main agent may not pick the member\'s model');
});

test('C11/M-3 — a violation AFTER a clean tool_result is reported, never a reason to re-run the step', () => {
  const after = okTurn(); after.splice(4, 0, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'W1', name: 'TodoWrite', input: {} }] } });
  const r = run(after.slice(0, 5));
  assert.deepEqual(r.seen.viol, [{ code: 'SESSION_HOST_STRAY_TOOL', detail: { strayTools: ['TodoWrite'], afterDone: true } }]);
  assert.equal(r.facts.violation, null);
  assert.equal(r.facts.afterDone.length, 1);
  assert.equal(watchdogVerdict(r.facts), null);
});

test('member error and the per-session cap refusal', () => {
  const err = okTurn(); err[3] = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'T1', is_error: true, content: 'Subagent limit reached for this session' }] } };
  const r = run(err);
  assert.equal(r.seen.done.isError, true);
  assert.equal(r.facts.capRefused, true);
  assert.equal(watchdogVerdict(r.facts), null, 'a member error is the member\'s failure, classified by the host (C41)');
});

test('verify major 2 — the CLI refusing the host\'s Agent call (missing description) is a host failure, not a member error', () => {
  const bad = okTurn(); bad[3] = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'T1', is_error: true,
    content: 'InputValidationError: Agent failed due to the following issue: The required parameter `description` is missing' }] } };
  const r = run(bad.slice(0, 4));
  assert.equal(r.seen.done, null, 'no child ran, so nothing is done');
  assert.deepEqual(r.seen.viol[0], { code: 'SESSION_HOST_NO_DISPATCH', detail: { invalidInput: true } });
  assert.equal(watchdogVerdict(r.facts).code, 'SESSION_HOST_NO_DISPATCH', 'retried under session_host (Task 27), never failure-policy \'*\'');
});

test('hooks: the member\'s PostToolUse feeds reconcile; an investigator\'s goes to the member stream (consult R2)', () => {
  const hook = (id, usd) => ({ type: 'hook-event', raw: { type: 'system', subtype: 'hook_response', hook_event: 'PostToolUse',
    stdout: JSON.stringify({ tool_use_id: id, tool_response: { usage: { cost_usd: usd } } }) } });
  const r = run([...okTurn().slice(0, 4), hook('T1', 0.4), hook('I7', 0.05), ...okTurn().slice(4)]);
  assert.equal(r.seen.hook, 0.4);
  assert.equal(r.seen.member.filter((e) => e.type === 'hook').length, 1);
});

test('plain log lines reach the member stream and said (sideload refusal); host api_retry becomes a member retry event', () => {
  const r = run([{ type: 'log', text: 'Error: --plugin-dir refused by managed settings' },
    { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: 529, error: 'overloaded' }]);
  assert.deepEqual(r.facts.said, ['Error: --plugin-dir refused by managed settings']);
  assert.ok(r.seen.member.some((e) => e.type === 'log'));
  assert.deepEqual(r.seen.member.filter((e) => e.type === 'retry').map((e) => [e.attempt, e.httpStatus]), [[1, 529]]);
});

test('minor 11 — a member dispatching a worca-x type, or refused by the cap, is a warning; investigators are collected (C33)', () => {
  const f = okTurn();
  f.splice(3, 0,
    { type: 'assistant', parent_tool_use_id: 'T1', message: { content: [{ type: 'tool_use', id: 'S1', name: 'Agent', input: { subagent_type: 'worca-x-n_impl-2-a1' } }] } },
    { type: 'assistant', parent_tool_use_id: 'T1', message: { content: [{ type: 'tool_use', id: 'I1', name: 'Agent', input: { subagent_type: 'worca-investigator' } }] } },
    { type: 'user', parent_tool_use_id: 'T1', message: { content: [{ type: 'tool_result', tool_use_id: 'I1', content: 'found' }] }, tool_use_result: { usage: { input_tokens: 300, output_tokens: 40 }, resolvedModel: 'claude-haiku-4-5' } });
  const r = run(f);
  assert.deepEqual(r.seen.warn.map((w) => w.code), ['member-self-dispatch']);
  assert.deepEqual(r.facts.investigators, [{ toolUseId: 'I1', usage: { input_tokens: 300, output_tokens: 40 }, resolvedModel: 'claude-haiku-4-5' }]);
});

test('child frames before the bind are buffered and replayed', () => {
  const f = okTurn(); const early = f.splice(2, 1)[0]; f.splice(1, 0, early);
  assert.deepEqual(run(f).seen.member.filter((e) => e.type === 'text').map((e) => e.text), ['member at work']);
});

test('v2 — the cap default never matches the concurrency limit (Task 6, Task 53)', () => {
  assert.match('Subagent limit reached for this session', SUBAGENT_CAP_RE);
  assert.doesNotMatch('Concurrent subagent limit reached. You can run 20 subagents at once.', SUBAGENT_CAP_RE);
  assert.doesNotMatch('Concurrent sub-agent limit reached', SUBAGENT_CAP_RE, 'v3: \\b also matches between - and agent');
  for (const t of ['Sub-agent limit reached', 'Agents per session limit reached', 'agent cap exceeded']) assert.match(t, SUBAGENT_CAP_RE, t);
  const conc = okTurn(); conc[3] = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'T1', is_error: true, content: 'Concurrent subagent limit reached. You can run 20 subagents at once.' }] } };
  assert.equal(run(conc).facts.capRefused, false);
});

test('v2 — the report is the child\'s own text, not the CLI\'s hand-back frame around it', () => {
  const f = okTurn();
  f[3] = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'T1', content: [{ type: 'text',
    text: '[Subagent hand-back] The text below is the final report of a subagent. The report follows:\n  REPORT\nagentId: ag-1 (use SendMessage)\n<usage>subagent_tokens: 5700</usage>' }] }] },
    tool_use_result: { status: 'completed', agentId: 'ag-1', content: [{ type: 'text', text: 'REPORT' }], usage: { input_tokens: 5000, output_tokens: 700 }, resolvedModel: 'claude-opus-5-5' } };
  assert.equal(run(f).seen.done.report, 'REPORT');
});

test('v2 — the runner\'s session pre-event plus the raw init give one member session event and the init model; a mock line is host text', () => {
  const seen = { member: [], host: [], inits: [] };
  const d = createTurnDemux({ agentType: TYPE, onMember: (e) => seen.member.push(e), onHostText: (t) => seen.host.push(t), onInit: (i) => seen.inits.push(i) });
  d.feed({ type: 'session', sessionId: 'H1' });                                   // claude.mjs:691-693, before the raw init
  d.feed(env(okTurn()[0]));
  d.feed({ type: 'assistant', text: 'mock host line', raw: { mock: true, text: 'mock host line' } });   // mock.mjs emitLog
  assert.deepEqual(seen.member.filter((e) => e.type === 'session').map((e) => e.sessionId), ['H1']);
  assert.deepEqual(seen.inits.at(-1), { hostSessionId: 'H1', model: 'claude-haiku-4-5' });
  assert.equal(d.facts().hostInitModel, 'claude-haiku-4-5');
  assert.deepEqual(seen.host, ['mock host line']);
});

test('v2 — a PostToolUse payload in `output` (CLI 2.1.282) is read like one in `stdout`', () => {
  const viaOutput = { type: 'hook-event', raw: { type: 'system', subtype: 'hook_response', hook_event: 'PostToolUse',
    output: JSON.stringify({ tool_use_id: 'T1', tool_response: { usage: { cost_usd: 0.3 } } }) } };
  const r = run([...okTurn().slice(0, 4), viaOutput]);
  assert.equal(r.seen.hook, 0.3);
  assert.equal(r.facts.hookUsd, 0.3);
});

test('v3 — the CLI\'s echo of the child prompt never reaches the member row (an ungrouped step has no such line)', () => {
  for (const content of [[{ type: 'text', text: 'Begin your step.' }], 'Begin your step.']) {
    const f = okTurn();
    f.splice(2, 0, { type: 'user', parent_tool_use_id: 'T1', message: { role: 'user', content } });
    const { seen } = run(f);
    assert.deepEqual(seen.member.filter((e) => e.type === 'text').map((e) => e.text), ['member at work'], typeof content);
  }
});

test('v4 — row 7a drops only the bare echo: a trailing newline still drops; a frame with a tool_result is never dropped', () => {
  const f = okTurn();
  f.splice(2, 0, { type: 'user', parent_tool_use_id: 'T1', message: { content: [{ type: 'text', text: 'Begin your step.\n' }] } });
  assert.deepEqual(run(f).seen.member.filter((e) => e.type === 'text').map((e) => e.text), ['member at work']);
  const g = okTurn();
  g.splice(2, 0,
    { type: 'assistant', parent_tool_use_id: 'T1', message: { content: [{ type: 'tool_use', id: 'I1', name: 'Agent', input: { subagent_type: 'worca-investigator' } }] } },
    { type: 'user', parent_tool_use_id: 'T1', message: { content: [{ type: 'tool_result', tool_use_id: 'I1', content: 'found' }, { type: 'text', text: 'Begin your step.' }] },
      tool_use_result: { resolvedModel: 'claude-haiku-4-5' } });
  const r = run(g);
  assert.deepEqual(r.facts.investigators.map((i) => i.toolUseId), ['I1']);
  assert.ok(r.seen.member.some((e) => e.type === 'subagent' && e.event === 'finish' && e.toolUseId === 'I1'));
});

test('v4 — init: the same id and model again call nothing', () => {
  const seen = { member: [], inits: [] };
  const d = createTurnDemux({ agentType: TYPE, onMember: (e) => seen.member.push(e), onInit: (i) => seen.inits.push(i) });
  d.feed({ type: 'session', sessionId: 'H1' });
  d.feed(env(okTurn()[0]));
  d.feed(env(okTurn()[0]));
  assert.equal(seen.inits.length, 2);
  assert.equal(seen.member.filter((e) => e.type === 'session').length, 1);
});

test('v4 — hooks: the bound PostToolUse is swallowed even without a cost; the cost fallbacks; PreToolUse and raw hook frames go to the member', () => {
  const post = (payload) => ({ type: 'hook-event', raw: { type: 'system', subtype: 'hook_response', hook_event: 'PostToolUse', stdout: JSON.stringify(payload) } });
  const none = run([...okTurn().slice(0, 4), post({ tool_use_id: 'T1', tool_response: { usage: { input_tokens: 1 } } })]);
  assert.equal(none.facts.hookUsd, null);
  assert.equal(none.seen.hook, null);
  assert.equal(none.seen.member.filter((e) => e.type === 'hook').length, 0, 'the host\'s own Agent call is never a sub-agent of the row');
  assert.equal(run([...okTurn().slice(0, 4), post({ tool_use_id: 'T1', tool_response: { usage: { total_cost_usd: 0.2 } } })]).facts.hookUsd, 0.2);
  assert.equal(run([...okTurn().slice(0, 4), post({ tool_use_id: 'T1', tool_response: { cost_usd: 0.1 } })]).facts.hookUsd, 0.1);
  const pre = { type: 'hook-event', raw: { type: 'system', subtype: 'hook_response', hook_event: 'PreToolUse', stdout: JSON.stringify({ tool_use_id: 'T1', tool_response: { cost_usd: 9 } }) } };
  const p = run([...okTurn().slice(0, 4), pre]);
  assert.equal(p.facts.hookUsd, null);
  assert.equal(p.seen.member.filter((e) => e.type === 'hook').length, 1, 'only PostToolUse feeds reconcile');
  const raw = run([okTurn()[0], { type: 'system', subtype: 'hook_started', hook_name: 'PostToolUse:Agent', hook_id: 'k1' }]);
  assert.deepEqual(raw.seen.member.filter((e) => e.type === 'hook').map((e) => e.raw.hook_id), ['k1'], 'a raw hook frame (isHookEvent) is routed like the envelope');
});

test('v4 — the member\'s cap refusal is a warning Task 41 rotates on; only its own Agent calls, finished in the foreground, are investigators', () => {
  const f = okTurn();
  f.splice(3, 0,
    { type: 'assistant', parent_tool_use_id: 'T1', message: { content: [
      { type: 'tool_use', id: 'R1', name: 'Read', input: { file_path: '/x' } },
      { type: 'tool_use', id: 'I2', name: 'Agent', input: { subagent_type: 'worca-investigator' } },
      { type: 'tool_use', id: 'I3', name: 'Task', input: { subagent_type: 'worca-investigator' } }] } },
    { type: 'user', parent_tool_use_id: 'T1', message: { content: [{ type: 'tool_result', tool_use_id: 'R1', content: 'file text' }] } },
    { type: 'user', parent_tool_use_id: 'T1', message: { content: [{ type: 'tool_result', tool_use_id: 'I2', content: 'launched' }] }, tool_use_result: { isAsync: true, status: 'async_launched' } },
    { type: 'user', parent_tool_use_id: 'T1', message: { content: [{ type: 'tool_result', tool_use_id: 'I3', is_error: true, content: 'Subagent limit reached for this session' }] } });
  const r = run(f);
  assert.deepEqual(r.facts.investigators.map((i) => i.toolUseId), ['I3'], 'a Read result is no investigator; a background ack is no finish');
  assert.deepEqual(r.seen.warn.map((w) => w.code), ['member-cap-refused']);
  assert.deepEqual(r.facts.memberWarnings, [{ code: 'member-cap-refused', detail: {} }]);
  assert.equal(r.facts.capRefused, false, 'the member\'s refusal is not the host\'s');
  assert.equal(watchdogVerdict(r.facts), null, 'a member warning never fails the dispatch');
});

test('v4 — bounded memory: said keeps 20 lines of at most 500 chars; at most 500 child frames wait for the bind', () => {
  const r = run(Array.from({ length: 25 }, (_, i) => ({ type: 'log', text: String(i).padEnd(600, 'x') })));
  assert.equal(r.facts.said.length, 20);
  assert.ok(r.facts.said.every((l) => l.length === 500));
  const early = Array.from({ length: 501 }, (_, i) => ({ type: 'assistant', parent_tool_use_id: 'T1', message: { id: `c${i}`, content: [{ type: 'text', text: `t${i}` }] } }));
  assert.equal(run([okTurn()[0], ...early]).facts.buffered, 500);
});

test('v4 — host usage: the last value per message id (the CLI repeats a message per content block); messages without an id each count', () => {
  const f = okTurn();
  f.splice(2, 0,
    { type: 'assistant', message: { id: 'h1', usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 100 }, content: [{ type: 'text', text: 'more' }] } },
    { type: 'assistant', message: { usage: { input_tokens: 1 }, content: [{ type: 'text', text: 'a1' }] } },
    { type: 'assistant', message: { usage: { input_tokens: 1 }, content: [{ type: 'text', text: 'a2' }] } });
  const { facts } = run(f);
  assert.deepEqual(facts.hostUsage, { in: 1852, out: 42, cr: 100, cw: 0 });
  assert.deepEqual(facts.lastHostUsage, { in: 950, out: 2, cr: 0, cw: 0 });
});

test('v4 — facts name what the main agent did: every Agent call, wrong types, stray tools', () => {
  const two = okTurn(); two.splice(3, 0, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'T2', name: 'Agent', input: { subagent_type: TYPE } }] } });
  assert.equal(run(two.slice(0, 4)).facts.agentCalls, 2);
  const wrong = okTurn(); wrong[1] = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'T9', name: 'Agent', input: { subagent_type: 'general-purpose' } }] } };
  assert.deepEqual(run(wrong).facts.wrongTypes, ['general-purpose']);
  const stray = okTurn(); stray.splice(1, 0, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'B1', name: 'Bash', input: { command: 'ls' } }] } });
  assert.deepEqual(run(stray).facts.strayTools, ['Bash']);
});

test('v4 — the runner\'s costUsd is the cumulative figure; other normalized events reach the member unchanged; a member error keeps the CLI\'s text', () => {
  const d = createTurnDemux({ agentType: TYPE });
  d.feed({ type: 'result', raw: okTurn()[5], costUsd: 0.5 });
  assert.equal(d.facts().result.cumulativeUsd, 0.5);
  const seen = [];
  createTurnDemux({ agentType: TYPE, onMember: (e) => seen.push(e) }).feed({ type: 'usage', inputTokens: 3 });
  assert.deepEqual(seen, [{ type: 'usage', inputTokens: 3 }]);
  const err = okTurn();
  err[3] = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'T1', is_error: true, content: 'API Error: 529 overloaded' }] },
    tool_use_result: { content: [{ type: 'text', text: 'partial' }] } };
  const r = run(err);
  assert.equal(r.seen.done.report, 'API Error: 529 overloaded');
  assert.equal(r.seen.done.errorText, 'API Error: 529 overloaded', 'C41 classifies the CLI\'s error text');
});

test('v5 — done and result carry every field the SessionHost reads (Tasks 40, 41); sawInit only after an init', () => {
  const f = okTurn();
  f[1].message.usage = { input_tokens: 900, output_tokens: 30, cache_read_input_tokens: 100, cache_creation_input_tokens: 40 };
  f[5] = { type: 'result', subtype: 'error_max_budget_usd', is_error: true, session_id: 'H1', total_cost_usd: 0.42, num_turns: 3, duration_ms: 64000, usage: { input_tokens: 1850 } };
  const { seen, facts } = run(f);
  assert.equal(facts.sawInit, true);
  assert.deepEqual(seen.done.usage, { input_tokens: 5000, output_tokens: 700 });
  assert.equal(seen.done.durationMs, 61000);
  assert.equal(seen.done.tokens, 5700);
  assert.deepEqual(facts.hostUsage, { in: 1850, out: 32, cr: 100, cw: 40 });
  assert.deepEqual(facts.result, { cumulativeUsd: 0.42, usage: { input_tokens: 1850 }, numTurns: 3, durationMs: 64000,
    subtype: 'error_max_budget_usd', isError: true, sessionId: 'H1' }, 'C10: the SessionHost reads the subtype');
  assert.equal(run([okTurn()[1]]).facts.sawInit, false);
});

test('v5 — stderr lines reach said too (C20); host frames with no row of their own reach nobody (rows 2, 6b)', () => {
  const seen = { member: [], host: [] };
  const d = createTurnDemux({ agentType: TYPE, onMember: (e) => seen.member.push(e), onHostText: (t) => seen.host.push(t) });
  d.feed({ type: 'stderr', stream: 'err', text: 'No conversation found with session ID: H0' });
  for (const f of [okTurn()[0], { type: 'stream_event', event: { type: 'message_start' } }, { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } },
    { type: 'system', subtype: 'task_started', task_id: 'k1', tool_use_id: 'T1', description: 'Implement' },
    { type: 'system', subtype: 'task_notification', task_id: 'k1', tool_use_id: 'T1', status: 'completed', usage: { total_tokens: 5, duration_ms: 9 } },
    { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 9 } }]) d.feed(env(f));
  assert.deepEqual(d.facts().said, ['No conversation found with session ID: H0']);
  assert.deepEqual(seen.member.map((e) => e.type), ['stderr', 'session']);
  assert.deepEqual(seen.host, []);
});

test('v5 — only an ERROR result is a cap refusal or a refused call: a clean report may quote either text', () => {
  const f = okTurn();
  f[3] = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'T1', content: 'Checked: no required parameter is missing; "Subagent limit reached" is handled.' }] },
    tool_use_result: { content: [{ type: 'text', text: 'ok' }] } };
  f.splice(3, 0, { type: 'user', parent_tool_use_id: 'T1', message: { content: [{ type: 'tool_result', tool_use_id: 'R1', content: 'docs: Subagent limit reached for this session' }] } });
  const r = run(f);
  assert.equal(r.seen.done.report, 'ok');
  assert.equal(r.facts.capRefused, false);
  assert.deepEqual(r.facts.memberWarnings, []);
  assert.equal(r.facts.violation, null);
  assert.equal(watchdogVerdict(r.facts), null);
});

test('v5 — only the member\'s own frames are watched: an investigator\'s Agent calls, results and refusals are not (row 7)', () => {
  const f = okTurn();
  f.splice(3, 0,
    { type: 'assistant', parent_tool_use_id: 'T1', message: { content: [{ type: 'tool_use', id: 'I1', name: 'Agent', input: { subagent_type: 'worca-investigator' } }] } },
    { type: 'assistant', parent_tool_use_id: 'I1', message: { content: [{ type: 'tool_use', id: 'J1', name: 'Agent', input: { subagent_type: 'worca-x-n_other-1-a1' } }] } },
    { type: 'user', parent_tool_use_id: 'I1', message: { content: [{ type: 'tool_result', tool_use_id: 'J1', is_error: true, content: 'Subagent limit reached for this session' }] }, tool_use_result: { resolvedModel: 'claude-haiku-4-5' } },
    { type: 'user', parent_tool_use_id: 'T1', message: { content: [{ type: 'tool_result', tool_use_id: 'I1', content: 'found' }] }, tool_use_result: { resolvedModel: 'claude-haiku-4-5' } });
  const r = run(f);
  assert.deepEqual(r.facts.investigators.map((i) => i.toolUseId), ['I1']);
  assert.deepEqual(r.seen.warn, []);
  assert.deepEqual(r.facts.memberWarnings, []);
});

test('v5 — the verdict: a bound call that never returned fails; the FIRST violation wins; a violation after a member ERROR leaves the member error (C41)', () => {
  assert.deepEqual(watchdogVerdict(run(okTurn().slice(0, 3)).facts), { code: 'SESSION_HOST_NO_DISPATCH', detail: { agentCalls: 1 } });
  const f = okTurn();
  f.splice(2, 0, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'B1', name: 'Bash', input: {} }, { type: 'tool_use', id: 'T2', name: 'Agent', input: { subagent_type: TYPE } }] } });
  const two = run(f.slice(0, 3));
  assert.deepEqual(two.seen.viol.map((v) => v.code), ['SESSION_HOST_STRAY_TOOL', 'SESSION_HOST_MULTI_DISPATCH']);
  assert.deepEqual(two.facts.violation, { code: 'SESSION_HOST_STRAY_TOOL', detail: { strayTools: ['Bash'] } });
  const ov = okTurn();
  ov.splice(2, 0, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'T3', name: 'Agent', input: { subagent_type: TYPE, run_in_background: true } }] } });
  assert.deepEqual(run(ov.slice(0, 3)).facts.violation, { code: 'SESSION_HOST_NO_DISPATCH', detail: { override: ['run_in_background'] } },
    'row 3: the override check comes first, bound or not');
  const err = okTurn();
  err[3] = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'T1', is_error: true, content: 'API Error: 529 overloaded' }] } };
  err.splice(4, 0, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'T2', name: 'Agent', input: { subagent_type: TYPE, description: 'again', prompt: 'Begin your step.' } }] } });
  const e = run(err);
  assert.deepEqual(e.seen.viol.map((v) => v.code), ['SESSION_HOST_MULTI_DISPATCH'], 'the SessionHost still kills the process (C11)');
  assert.equal(e.facts.violation, null, 'the main agent retrying a failed step is not a host failure');
  assert.deepEqual(e.facts.afterDone, [{ code: 'SESSION_HOST_MULTI_DISPATCH', detail: { afterDone: true } }]);
  assert.equal(watchdogVerdict(e.facts), null, 'C41: the member error is thrown with its own class (a 529, a usage limit)');
  const stray = okTurn();
  stray.splice(1, 0, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'B2', name: 'Bash', input: {} }] } });
  stray[4] = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'T1', is_error: true, content: 'API Error: 529 overloaded' }] } };
  assert.deepEqual(watchdogVerdict(run(stray).facts), { code: 'SESSION_HOST_STRAY_TOOL', detail: { strayTools: ['Bash'] } }, 'a violation BEFORE the member\'s result still fails the dispatch');
});

test('v5 — a host tool_result for another call, or one before the bind, is not the member\'s report', () => {
  const f = okTurn();
  f.splice(2, 0, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'B9', content: 'other' }] } });
  assert.equal(run(f.slice(0, 3)).facts.done, null);
  assert.equal(run(f).seen.done.report, 'REPORT');
  const early = run([okTurn()[0], { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'T1', content: 'early' }] } }, okTurn()[1]]);
  assert.equal(early.facts.done, null);
  assert.equal(early.seen.done, null);
});

test('v5 — a mock result is the turn\'s result (row 9 skips results); a blank hook stdout falls back to output (row 1)', () => {
  const d = createTurnDemux({ agentType: TYPE });
  d.feed({ type: 'result', costUsd: 0, raw: { mock: true, type: 'result', total_cost_usd: 0 } });   // mock.mjs:599
  assert.equal(d.facts().result?.cumulativeUsd, 0);
  const blank = { type: 'hook-event', raw: { type: 'system', subtype: 'hook_response', hook_event: 'PostToolUse', stdout: '  \n',
    output: JSON.stringify({ tool_use_id: 'T1', tool_response: { usage: { cost_usd: 0.3 } } }) } };
  assert.equal(run([...okTurn().slice(0, 4), blank]).facts.hookUsd, 0.3);
});

test('v5 — buffered child frames replay in order, after onBind (row 8); row 7a drops only the exact child prompt', () => {
  const order = [];
  const d = createTurnDemux({ agentType: TYPE, onBind: (id) => order.push(`bind:${id}`), onMember: (e) => { if (e.type === 'text') order.push(e.text); } });
  d.feed(env(okTurn()[0]));
  for (const t of ['one', 'two']) d.feed(env({ type: 'assistant', parent_tool_use_id: 'T1', message: { content: [{ type: 'text', text: t }] } }));
  d.feed(env(okTurn()[1]));
  assert.deepEqual(order, ['bind:T1', 'one', 'two']);
  const g = okTurn();
  g.splice(2, 0, { type: 'user', parent_tool_use_id: 'T1', message: { content: [{ type: 'text', text: 'Begin your step. Then also check X.' }] } });
  assert.ok(run(g).seen.member.some((e) => e.type === 'text' && e.text === 'Begin your step. Then also check X.'));
});
