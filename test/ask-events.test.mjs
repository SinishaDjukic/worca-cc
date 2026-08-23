// P1/T15: the reducer (ask-worca-design.md §6.6) over HAND-WRITTEN frames in the
// probed shapes. Exact arithmetic lives here; the captured-fixture replay test
// (Task 17) only asserts structure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurnReducer, normalizeUsage, estimateAgentCosts, matchModelKey, labelForTool } from '../src/core/ask/events.mjs';

// ── frame builders (the runner envelope: {type, raw}) ───────────────────────
const SID = 'sess-0001';
const USAGE_START = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 };
const ev = (raw) => ({ type: raw.type, raw });
const session = () => ({ type: 'session', sessionId: SID });
const init = (extra = {}) => ev({ type: 'system', subtype: 'init', session_id: SID, tools: ['Task', 'mcp__worca__list_runs'], mcp_servers: [{ name: 'worca', status: 'connected' }], ...extra });
const mstart = (id, ptu = null) => ev({ type: 'stream_event', event: { type: 'message_start', message: { id, model: 'claude-haiku-4-5', role: 'assistant', content: [], usage: USAGE_START } }, parent_tool_use_id: ptu, session_id: SID });
const delta = (text, ptu = null) => ev({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, parent_tool_use_id: ptu, session_id: SID });
const thinking = () => ev({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }, parent_tool_use_id: null, session_id: SID });
const mdelta = (usage, ptu = null) => ev({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage }, parent_tool_use_id: ptu, session_id: SID });
const atext = (id, text, usage = USAGE_START) => ev({ type: 'assistant', message: { id, model: 'claude-haiku-4-5', role: 'assistant', content: [{ type: 'text', text }], usage }, parent_tool_use_id: null, session_id: SID });
const atool = (id, toolId, name, input, ptu = null) => ev({ type: 'assistant', message: { id, model: 'claude-haiku-4-5', role: 'assistant', content: [{ type: 'tool_use', id: toolId, name, input, caller: { type: 'direct' } }], usage: USAGE_START }, parent_tool_use_id: ptu, session_id: SID });
const uresult = (toolId, content, { isError = false, ptu = null, tur } = {}) => ev({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content, ...(isError ? { is_error: true } : {}) }] }, parent_tool_use_id: ptu, session_id: SID, ...(tur !== undefined ? { tool_use_result: tur } : {}) });
const RESULT_USAGE = { input_tokens: 12, cache_creation_input_tokens: 6542, cache_read_input_tokens: 9542, output_tokens: 301 };
const result = (over = {}) => ev({ type: 'result', subtype: 'success', is_error: false, duration_ms: 2001, duration_api_ms: 1800, num_turns: 2, session_id: SID, total_cost_usd: 0.0234, usage: RESULT_USAGE, modelUsage: {}, permission_denials: [], terminal_reason: 'completed', ...over });

function harness(opts = {}) {
  const frames = [];
  const timers = [];
  let t = 1000;
  const r = createTurnReducer({
    onFrame: (f) => frames.push(f),
    now: () => t,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: (id) => { timers[id - 1] = null; },
    ...opts,
  });
  const fire = () => { const fns = timers.splice(0).filter(Boolean); for (const fn of fns) fn(); };
  const tick = (ms) => { t += ms; };
  const types = () => frames.map((f) => f.type);
  return { r, frames, fire, tick, types, push: (...evs) => { for (const e of evs) r.push(e); } };
}

test('plain text turn: label, batched deltas, usage frames, the assistant block is authoritative, summary fields', () => {
  const h = harness();
  h.push(session(), init(), mstart('msg_1'), delta('Hel'), thinking(), delta('lo'));
  assert.deepEqual(h.types(), ['ask-label'], 'deltas are batched (timer pending), thinking ignored');
  assert.equal(h.frames[0].label, 'Thinking');
  h.fire();
  assert.deepEqual(h.frames.at(-1), { type: 'ask-delta', text: 'Hello' });
  h.push(atext('msg_1', 'Hello!'), mdelta({ output_tokens: 301, input_tokens: 12 }), result());
  const usageFrames = h.frames.filter((f) => f.type === 'ask-usage');
  assert.equal(usageFrames.length, 2);
  assert.deepEqual(usageFrames[0], { type: 'ask-usage', usage: { input: 12, output: 301, cacheRead: 0, cacheCreation: 0, ctx: 313 }, costUsd: null }, 'message_delta wins over the message-start usage');
  assert.deepEqual(usageFrames[1], { type: 'ask-usage', usage: { ...normalizeUsage(RESULT_USAGE), ctx: 313 }, costUsd: 0.0234 }, 'result usage + cost; ctx stays the last per-call figure');
  const s = h.r.finish();
  assert.equal(s.text, 'Hello!', 'the assistant text block replaces the deltas');
  assert.deepEqual(s.blocks, []);
  assert.deepEqual(s.usage, { input: 12, output: 301, cacheRead: 9542, cacheCreation: 6542, ctx: 313 });
  assert.equal(s.costUsd, 0.0234);
  assert.equal(s.sessionId, SID);
  assert.equal(s.status, 'done');
  assert.equal(s.reason, null);
  assert.equal(s.resultSubtype, 'success');
  assert.equal(s.isError, false);
  assert.deepEqual(s.errors, []);
  assert.equal(s.numTurns, 2);
  assert.equal(s.durationMs, 2001);
  assert.equal(s.sawInit, true); assert.equal(s.sawAssistant, true); assert.equal(s.sawResult, true);
  assert.equal(s.agents, 0);
  assert.deepEqual(s.labels, ['Thinking']);
  assert.equal(s.reducerErrors, 0);
  assert.equal(h.r.finish(), s, 'idempotent');
});

test('delta batching: 256 chars flush immediately, flush() forces, redaction per batch, messages join with a blank line', () => {
  const h = harness();
  h.push(mstart('msg_1'));
  h.push(delta('x'.repeat(255)));
  assert.equal(h.frames.filter((f) => f.type === 'ask-delta').length, 0);
  h.push(delta('y'));
  assert.equal(h.frames.at(-1).text.length, 256, 'size threshold flushes without the timer');
  h.push(delta('key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 end'));
  h.r.flush();
  assert.equal(h.frames.at(-1).text, 'key sk-ant-<redacted> end');
  h.push(atext('msg_1', 'first'), mstart('msg_2'), delta('second'));
  h.r.flush();
  const deltas = h.frames.filter((f) => f.type === 'ask-delta').map((f) => f.text);
  assert.equal(deltas.at(-1), '\n\nsecond', 'a later message announces itself with a blank line (same batch)');
  assert.equal(h.r.finish().text, 'first\n\nsecond');
  const out = [];
  const sync = createTurnReducer({ onFrame: (f) => out.push(f), now: () => 0, setTimeout: (fn) => { fn(); return 1; }, clearTimeout: () => {} });
  sync.push(mstart('m')); sync.push(delta('a')); sync.push(delta('b'));
  assert.deepEqual(out.filter((f) => f.type === 'ask-delta').map((f) => f.text), ['a', 'b'], 'a synchronous timer stub flushes every delta (no stale timer id)');
});

test('text comes from the main stream only; result.result is a fallback when no assistant text arrived', () => {
  const h = harness();
  h.push(mstart('msg_c', 'toolu_agent'), delta('child text', 'toolu_agent'), atext('msg_1', 'parent'));
  h.r.flush();
  assert.ok(!h.frames.some((f) => f.type === 'ask-delta' && f.text.includes('child')));
  assert.equal(h.r.finish().text, 'parent');
  const h2 = harness();
  h2.push(result({ result: 'from result' }));
  assert.equal(h2.r.finish().text, 'from result');
});

test('usage dedupe: repeated per-block assistant usage is never summed; message ids are summed; result wins', () => {
  const h = harness();
  h.push(atext('msg_1', 'a', { input_tokens: 100, output_tokens: 5 }), atext('msg_1', 'b', { input_tokens: 100, output_tokens: 5 }));
  assert.deepEqual(h.r.snapshot().usage, { input: 100, output: 5, cacheRead: 0, cacheCreation: 0, ctx: 105 });
  h.push(mstart('msg_2'), mdelta({ input_tokens: 7, output_tokens: 70, cache_read_input_tokens: 3 }));
  assert.deepEqual(h.r.snapshot().usage, { input: 107, output: 75, cacheRead: 3, cacheCreation: 0, ctx: 80 });
  h.push(atext('msg_2', 'c', { input_tokens: 7, output_tokens: 1 }));
  assert.deepEqual(h.r.snapshot().usage, { input: 107, output: 75, cacheRead: 3, cacheCreation: 0, ctx: 80 }, 'a final message_delta is not downgraded by a later per-block usage');
  h.push(result({ usage: { input_tokens: 1, output_tokens: 2 } }));
  assert.deepEqual(h.r.finish().usage, { input: 1, output: 2, cacheRead: 0, cacheCreation: 0, ctx: 80 });
});

test('tool lifecycle: labels, running → done/error blocks, durations, input clipping, label dedupe', () => {
  const names = { att_00000001: 'notes.md' };
  const h = harness({ attachmentNames: names });
  h.push(init(), atool('msg_1', 'toolu_1', 'mcp__worca__list_runs', { limit: 5 }));
  assert.deepEqual(h.frames.slice(-2), [
    { type: 'ask-label', label: 'Finding runs' },
    { type: 'ask-block', block: { kind: 'tool', id: 'toolu_1', name: 'mcp__worca__list_runs', input: { limit: 5 }, status: 'running', durationMs: null } },
  ]);
  h.tick(800);
  h.push(uresult('toolu_1', [{ type: 'text', text: '[]' }], { tur: [{ type: 'text', text: '[]' }] }));
  assert.deepEqual(h.frames.at(-1).block, { kind: 'tool', id: 'toolu_1', name: 'mcp__worca__list_runs', input: { limit: 5 }, status: 'done', durationMs: 800 });
  h.push(atool('msg_1', 'toolu_2', 'mcp__worca__get_run_diff', { id: '4e1f2a9b', projectKey: 'p-00000001' }));
  assert.equal(h.frames.at(-2).label, 'Reading run 4e1f2a9b');
  h.push(uresult('toolu_2', 'error: get_run_diff: run not found ghp_abcdefghijklmnopqrstuvwxyz0123456789', { isError: true, tur: 'Error: …' }));
  assert.equal(h.frames.at(-1).block.status, 'error');
  assert.equal(h.frames.at(-1).block.error, 'error: get_run_diff: run not found ghp_<redacted>');
  h.push(atool('msg_1', 'toolu_3', 'mcp__worca__read_attachment', { id: 'att_00000001' }));
  assert.equal(h.frames.at(-2).label, 'Reading notes.md');
  h.push(atool('msg_1', 'toolu_4', 'mcp__worca__read_attachment', { id: 'att_unknown' }));
  assert.equal(h.frames.at(-2).label, 'Reading attachment');
  h.push(atool('msg_1', 'toolu_5', 'mcp__other__thing', {}));
  assert.equal(h.frames.at(-2).label, 'Using mcp__other__thing');
  const before = h.frames.length;
  h.push(atool('msg_1', 'toolu_6', 'mcp__worca__list_runs', {}), atool('msg_1', 'toolu_7', 'mcp__worca__list_runs', {}));
  assert.deepEqual(h.frames.slice(before).map((f) => f.type), ['ask-label', 'ask-block', 'ask-block'], 'the same label is never repeated back to back');
  const big = { text: 'z'.repeat(5000) };
  h.push(atool('msg_1', 'toolu_8', 'mcp__worca__propose_run', big));
  const clipped = h.frames.at(-1).block.input;
  assert.equal(clipped._truncated, true);
  assert.equal(clipped.preview.length, 2048);
  h.push(mstart('msg_2'), delta('done'));
  assert.equal(h.frames.at(-1).label, 'Writing', 'first text delta after a tool');
  h.push(uresult('toolu_999', 'orphan'));
  const s = h.r.finish();
  assert.equal(s.blocks.filter((b) => b.status === 'running').length, 0, 'finish() closes running tools');
  assert.ok(s.blocks.filter((b) => b.id === 'toolu_3')[0].error === 'interrupted');
  assert.equal(s.reducerErrors, 0);
});

test('labelForTool table', () => {
  assert.equal(labelForTool('mcp__worca__list_runs', {}), 'Finding runs');
  assert.equal(labelForTool('mcp__worca__get_run', { id: 'abcdefghijklmnop' }), 'Reading run abcdefghijkl');
  assert.equal(labelForTool('mcp__worca__get_run', {}), 'Reading run');
  assert.equal(labelForTool('mcp__worca__list_workflows', {}), 'Looking at workflows');
  assert.equal(labelForTool('mcp__worca__list_projects', {}), 'Looking at projects');
  assert.equal(labelForTool('mcp__worca__propose_run', {}), 'Preparing a run');
  assert.equal(labelForTool('mcp__worca__read_attachment', { id: 'a' }, { a: 'x.md' }), 'Reading x.md');
  assert.equal(labelForTool('Task', {}), null);
  assert.equal(labelForTool('Agent', {}), null);
  assert.equal(labelForTool('Read', {}), 'Using Read');
});

const AGENT_TUR = { status: 'completed', prompt: 'SECRET PROMPT TEXT', agentId: 'a61fb0ef9162947fb', agentType: 'general-purpose',
  content: [{ type: 'text', text: 'count: 1' }], resolvedModel: 'claude-haiku-4-5', totalDurationMs: 3557, totalTokens: 4139, totalToolUseCount: 1,
  usage: { input_tokens: 4016, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 123 } };

test('foreground sub-agent (F3): Agent block, child log lines, finishing tool_use_result, cost estimate, prompt never stored', () => {
  const h = harness();
  h.push(init(), atool('msg_1', 'toolu_agent', 'Agent', { subagent_type: 'general-purpose', description: 'count runs', prompt: 'SECRET PROMPT TEXT' }));
  assert.equal(h.frames.at(-2).label, 'Running 1 sub-agent');
  const spawned = h.frames.at(-1).block;
  assert.deepEqual(spawned, { kind: 'agent', id: 'toolu_agent', label: 'count runs', type: 'general-purpose', model: null, tokens: null, ctx: null, usage: null, costUsd: null, estimated: true, status: 'running', durationMs: null, log: [] });
  h.push(ev({ type: 'system', subtype: 'task_started', task_id: 't1', tool_use_id: 'toolu_agent', description: 'count runs', subagent_type: 'general-purpose', is_backgrounded: false, prompt: 'SECRET PROMPT TEXT' }));
  h.push(ev({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'SECRET PROMPT TEXT' }] }, parent_tool_use_id: 'toolu_agent', subagent_type: 'general-purpose', task_description: 'count runs' }));
  h.tick(100);
  h.push(atool('msg_c1', 'toolu_c1', 'mcp__worca__list_runs', { limit: 2 }, 'toolu_agent'));
  assert.deepEqual(h.frames.at(-1).block.log, [{ t: 100, text: '→ list_runs {"limit":2}' }]);
  h.tick(500);
  h.push(uresult('toolu_c1', [{ type: 'text', text: '[]' }], { ptu: 'toolu_agent' }));
  assert.deepEqual(h.frames.at(-1).block.log.at(-1), { t: 600, text: '← ok 0.5s' });
  h.push(atool('msg_c1', 'toolu_c2', 'mcp__worca__get_run', { id: 'x' }, 'toolu_agent'), uresult('toolu_c2', 'error: get_run: run not found', { isError: true, ptu: 'toolu_agent' }));
  assert.equal(h.frames.at(-1).block.log.at(-1).text, '← error: error: get_run: run not found');
  h.push(ev({ type: 'system', subtype: 'task_progress', task_id: 't1', usage: { total_tokens: 3471, tool_uses: 2, duration_ms: 1600 }, last_tool_name: 'mcp__worca__get_run' }));
  h.push(ev({ type: 'system', subtype: 'task_notification', task_id: 't1', tool_use_id: 'toolu_agent', status: 'completed', summary: 'done', usage: {} }));
  h.tick(2957);
  h.push(uresult('toolu_agent', [{ type: 'text', text: 'count: 1' }, { type: 'text', text: 'agentId: a61fb0ef9162947fb\n<usage>subagent_tokens: 4139</usage>' }], { tur: AGENT_TUR }));
  assert.equal(h.frames.at(-2).label, 'Thinking', 'label first (back to Thinking when no agent runs)…');
  const done = h.frames.at(-1).block;                                    // …then the finished block
  assert.equal(done.status, 'done');
  assert.equal(done.model, 'claude-haiku-4-5');
  assert.deepEqual(done.usage, { input: 4016, output: 123, cacheRead: 0, cacheCreation: 0 });
  assert.equal(done.tokens, 4139);
  assert.equal(done.durationMs, 3557);
  h.push(result({ modelUsage: {
    'claude-haiku-4-5-20251001': { inputTokens: 905, outputTokens: 11, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.00096, canonicalModel: 'claude-haiku-4-5' },
    'claude-haiku-4-5': { inputTokens: 8032, outputTokens: 246, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.02, canonicalModel: 'claude-haiku-4-5' },
  } }));
  const s = h.r.finish();
  const agent = s.blocks.find((b) => b.kind === 'agent');
  // w(agent) = 4016 + 5·123 = 4631 ; w(total) = 8032 + 5·246 = 9262 ; share = 0.02 × 0.5 = 0.01
  assert.equal(agent.costUsd, 0.01);
  assert.equal(agent.estimated, true);
  assert.equal(s.agents, 1);
  assert.ok(!JSON.stringify(s.blocks).includes('SECRET PROMPT TEXT'), 'Task prompts are never persisted');
  assert.equal(s.text, '', 'child text never becomes the answer');
  assert.deepEqual(s.labels, ['Thinking', 'Running 1 sub-agent', 'Thinking']);
});

test('two agents: plural label, Task name accepted, log cap at 50 with an omission marker', () => {
  const h = harness();
  h.push(atool('msg_1', 'toolu_a', 'Task', { description: 'A', subagent_type: 'Explore' }), atool('msg_1', 'toolu_b', 'Agent', { description: 'B' }));
  assert.equal(h.frames.filter((f) => f.type === 'ask-label').at(-1).label, 'Running 2 sub-agents');
  for (let i = 0; i < 60; i++) h.push(atool('m', `c${i}`, 'mcp__worca__list_runs', { i }, 'toolu_a'));
  const a = h.r.snapshot().blocks.find((b) => b.id === 'toolu_a');
  assert.equal(a.log.length, 50);
  assert.equal(a.log[49].text, '… more lines omitted');
  assert.equal(a.log[48].text, '→ list_runs {"i":48}');
  h.push(uresult('toolu_a', 'x', { tur: { ...AGENT_TUR, agentId: 'aa' } }));
  assert.equal(h.frames.filter((f) => f.type === 'ask-label').at(-1).label, 'Running 1 sub-agent');
  assert.equal(h.r.snapshot().runningAgents, 1);
});

test('background sub-agent shape (F1 without the env var): async launch keeps the agent running; second init and second result tolerated', () => {
  const h = harness();
  h.push(init(), atool('msg_1', 'toolu_agent', 'Agent', { description: 'bg' }));
  h.push(uresult('toolu_agent', 'Async agent launched successfully.', { tur: { isAsync: true, status: 'async_launched', agentId: 'af21', description: 'bg', resolvedModel: 'claude-haiku-4-5', prompt: 'P', outputFile: '/x', canReadOutputFile: false } }));
  assert.equal(h.r.snapshot().blocks[0].status, 'running');
  h.push(init(), result({ total_cost_usd: 0.01, num_turns: 2 }), result({ total_cost_usd: 0.03, num_turns: 1, origin: { kind: 'task-notification' } }));
  const s = h.r.finish();
  assert.equal(s.costUsd, 0.03, 'the LAST result wins; costs are never summed');
  assert.equal(s.blocks[0].status, 'error');
  assert.equal(s.blocks[0].error, 'interrupted');
  assert.equal(s.sessionId, SID);
});

test('proposal hook: called with the FULL input after the propose_run tool_result; addBlock/updateBlock emit ask-card', () => {
  const seen = [];
  const h = harness({ onProposal: (p) => seen.push(p) });
  const input = { projectKey: 'p-00000001', brief: 'b'.repeat(3000), workflowId: 'wf_default' };
  h.push(atool('msg_1', 'toolu_p', 'mcp__worca__propose_run', input));
  assert.equal(h.frames.at(-1).block.input._truncated, true);
  h.push(uresult('toolu_p', [{ type: 'text', text: JSON.stringify({ ok: true, card: {} }) }]));
  assert.deepEqual(seen, [{ toolUseId: 'toolu_p', input, childOk: true }]);
  h.push(atool('msg_1', 'toolu_q', 'mcp__worca__propose_run', { brief: '' }), uresult('toolu_q', JSON.stringify({ ok: false, errors: ['brief is required'] })));
  assert.equal(seen[1].childOk, false);
  h.push(atool('msg_1', 'toolu_r', 'mcp__worca__propose_run', { brief: 'x' }), uresult('toolu_r', 'error: boom', { isError: true }));
  assert.equal(seen[2].childOk, null, 'unparseable result → null');
  const card = { kind: 'card', id: 'card_00000001', state: 'proposed', card: { target: 'project', projectKey: 'p-00000001' } };
  assert.deepEqual(h.r.addBlock(card), card);
  assert.deepEqual(h.frames.at(-1), { type: 'ask-card', block: card });
  const notice = h.r.addBlock({ kind: 'notice', text: 'Proposal rejected: brief is required' });
  assert.deepEqual(h.frames.at(-1), { type: 'ask-block', block: notice });
  assert.deepEqual(h.r.updateBlock('card_00000001', { state: 'started', runId: 'run-1' }), { ...card, state: 'started', runId: 'run-1' });
  assert.equal(h.frames.at(-1).type, 'ask-card');
  assert.equal(h.r.updateBlock('nope', {}), null);
  const s = h.r.finish();
  assert.deepEqual(s.blocks.map((b) => b.kind), ['tool', 'tool', 'tool', 'card', 'notice'], 'insertion order kept');
  const h2 = harness({ onProposal: () => { throw new Error('hook boom'); } });
  h2.push(atool('m', 't', 'mcp__worca__propose_run', {}), uresult('t', '{"ok":true}'));
  assert.equal(h2.r.finish().reducerErrors, 1, 'a throwing hook is counted, never propagated');
});

test('settle(): an async proposal hook that resolves after the result frame still lands its card before finish()', async () => {
  let resolveHook;
  const h = harness({ onProposal: () => new Promise((res) => { resolveHook = res; }) });
  h.push(atool('m', 'toolu_p', 'mcp__worca__propose_run', { brief: 'b' }), uresult('toolu_p', '{"ok":true}'), result());
  setTimeout(() => { h.r.addBlock({ kind: 'card', id: 'card_00000001', state: 'proposed', card: {} }); resolveHook(); }, 5);
  await h.r.settle();
  const s = h.r.finish();
  assert.deepEqual(s.blocks.map((b) => b.kind), ['tool', 'card'], 'the card made it into the persisted blocks');
  assert.equal(h.r.addBlock({ kind: 'notice', text: 'late' }), null, 'after finish(): refused');
  assert.equal(h.r.updateBlock('card_00000001', { state: 'started' }), null);
  assert.equal(h.r.snapshot().reducerErrors, 2, 'both late calls are counted (finish() is cached — read the live snapshot)');
  const rejecting = harness({ onProposal: () => Promise.reject(new Error('validation crashed')) });
  rejecting.push(atool('m', 't', 'mcp__worca__propose_run', {}), uresult('t', '{"ok":true}'));
  await rejecting.r.settle();
  assert.equal(rejecting.r.finish().reducerErrors, 1, 'a rejecting hook is counted, never propagated');
});

test('terminal subtypes: max_turns / max_budget → stopped + reason; errors and is_error captured', () => {
  const h = harness();
  h.push(init(), atext('msg_1', 'partial'), result({ subtype: 'error_max_turns', is_error: true, errors: ['Reached maximum number of turns (1)'], terminal_reason: 'max_turns', stop_reason: 'tool_use' }));
  let s = h.r.finish();
  assert.equal(s.status, 'stopped'); assert.equal(s.reason, 'max_turns'); assert.equal(s.isError, true);
  assert.deepEqual(s.errors, ['Reached maximum number of turns (1)']);
  assert.equal(s.text, 'partial');
  const h2 = harness();
  h2.push(result({ subtype: 'error_max_budget_usd', is_error: true, errors: ['Reached maximum budget ($0.0001)'], terminal_reason: 'budget_exhausted' }));
  s = h2.r.finish();
  assert.equal(s.status, 'stopped'); assert.equal(s.reason, 'max_budget');
  const h3 = harness();
  h3.push(result({ subtype: 'error_during_execution', is_error: true, errors: ['No conversation found with session ID: 0000'], total_cost_usd: 0, num_turns: 0 }));
  s = h3.r.finish();
  assert.equal(s.status, 'done', 'not a limit → the turn layer classifies it from the rejection');
  assert.equal(s.sawAssistant, false, 'the §6.2.7 resume-fallback predicate');
  assert.equal(s.sawResult, true);
  assert.equal(s.costUsd, 0);
  assert.equal(s.resultSubtype, 'error_during_execution');
});

test('noise and robustness: ignored frames emit nothing; malformed input never throws; onFrame exceptions are swallowed', () => {
  const h = harness();
  h.push(
    ev({ type: 'system', subtype: 'status', status: 'requesting' }), ev({ type: 'system', subtype: 'thinking_tokens' }),
    ev({ type: 'system', subtype: 'background_tasks_changed', tasks: [] }), ev({ type: 'system', subtype: 'task_updated', patch: {} }), ev({ type: 'rate_limit_event', rate_limit_info: {} }),
    { type: 'stderr', stream: 'err', text: 'MCP chatter' }, { type: 'log', text: 'x', raw: 'x' }, { type: 'hook-event', raw: { hook_event_name: 'PostToolUse' } },
    null, undefined, 42, { type: 'assistant' }, ev({ type: 'assistant', message: { content: 'not an array' } }), ev({ type: 'user', message: {} }),
    ev({ type: 'stream_event', event: null }), ev({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 7 } } }),
  );
  assert.deepEqual(h.types(), ['ask-label']);
  assert.equal(h.r.finish().reducerErrors, 0);
  let calls = 0;
  const bad = createTurnReducer({ onFrame: () => { calls++; throw new Error('ui boom'); }, now: () => 0, setTimeout: () => 1, clearTimeout: () => {} });
  assert.doesNotThrow(() => bad.push(init()));
  assert.ok(calls >= 1);
  assert.doesNotThrow(() => bad.push(atool('m', 't', 'mcp__worca__list_runs', {})));
  assert.equal(bad.finish().blocks.length, 1);
});

test('normalizeUsage, matchModelKey, estimateAgentCosts', () => {
  assert.deepEqual(normalizeUsage(undefined), { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
  assert.deepEqual(normalizeUsage({ input_tokens: '3', output_tokens: null, cache_read_input_tokens: 2.5 }), { input: 3, output: 0, cacheRead: 2.5, cacheCreation: 0 });
  const mu = {
    'claude-haiku-4-5-20251001': { inputTokens: 905, outputTokens: 11, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.00096, canonicalModel: 'claude-haiku-4-5' },
    'claude-haiku-4-5': { inputTokens: 1000, outputTokens: 100, cacheReadInputTokens: 200, cacheCreationInputTokens: 400, costUSD: 0.05, canonicalModel: 'claude-haiku-4-5' },
  };
  assert.equal(matchModelKey('claude-haiku-4-5', mu), 'claude-haiku-4-5', 'exact wins over the dated twin');
  assert.equal(matchModelKey('CLAUDE-HAIKU-4-5-20251001', mu), 'claude-haiku-4-5-20251001');
  assert.equal(matchModelKey('claude-haiku-4-5-20260101', mu), 'claude-haiku-4-5', 'stripped date suffix');
  assert.equal(matchModelKey('other', mu), null);
  assert.equal(matchModelKey('anything', { only: { costUSD: 1 } }), 'only', 'a single key is used regardless');
  assert.equal(matchModelKey('x', {}), null);
  const agents = [
    { kind: 'agent', id: 'a', model: 'claude-haiku-4-5', usage: { input: 500, output: 50, cacheRead: 100, cacheCreation: 200 } },
    { kind: 'agent', id: 'b', model: 'claude-haiku-4-5', usage: { input: 100000, output: 100000, cacheRead: 0, cacheCreation: 0 } },
    { kind: 'agent', id: 'c', model: 'claude-haiku-4-5', usage: null },
    { kind: 'agent', id: 'd', model: 'ghost', usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 } },
    { kind: 'agent', id: 'e', model: 'claude-haiku-4-5-20251001', usage: { input: 500, output: 50, cacheRead: 100, cacheCreation: 200 } },
  ];
  const est = estimateAgentCosts(agents, { modelUsage: mu });
  // w(a) = 500 + 1.25·200 + 0.1·100 + 5·50 = 1010 ; w(total) = 1000 + 1.25·400 + 0.1·200 + 5·100 = 2020 ; share = 0.05 × 0.5
  assert.equal(est[0].costUsd, 0.025);
  assert.equal(est[1].costUsd, 0.05, 'clamped to the model total');
  assert.equal(est[2].costUsd, null);
  assert.equal(est[3].costUsd, null, 'unknown model with several keys → null');
  assert.equal(est[4].costUsd, 0.025, 'a dated model id bigger than the ai-title side call switches to the canonical twin');
  assert.ok(est.every((a) => a.estimated === true));
  assert.deepEqual(estimateAgentCosts(agents, {}).map((a) => a.costUsd), [null, null, null, null, null]);
});

test('context fill: usage.ctx is the LAST main call total; result swaps buckets but never ctx; no main call → null', () => {
  const h = harness();
  h.push(mstart('msg_1'), mdelta({ input_tokens: 5, output_tokens: 10 }));
  let u = h.frames.filter((f) => f.type === 'ask-usage').at(-1);
  assert.equal(u.usage.ctx, 15, 'first call: input+output');
  h.push(mstart('msg_2'), mdelta({ input_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50, output_tokens: 20 }));
  u = h.frames.filter((f) => f.type === 'ask-usage').at(-1);
  assert.equal(u.usage.ctx, 1170, 'a later call REPLACES ctx — never sums');
  assert.equal(h.r.snapshot().usage.ctx, 1170);
  h.push(result());
  const s = h.r.finish();
  assert.deepEqual(s.usage, { ...normalizeUsage(RESULT_USAGE), ctx: 1170 }, 'cumulative buckets come from the result; ctx stays per-call');
  const h2 = harness();
  h2.push(result());
  assert.equal(h2.r.finish().usage.ctx, null, 'a turn with no main call has no context figure');
});

test('context fill: a child message_delta sets the agent block ctx (last call wins) and re-emits the block', () => {
  const h = harness();
  h.push(atool('msg_1', 'toolu_agent', 'Agent', { description: 'count runs', subagent_type: 'general-purpose' }));
  h.push(mstart('msg_c1', 'toolu_agent'), mdelta({ input_tokens: 10, cache_read_input_tokens: 11343, output_tokens: 292 }, 'toolu_agent'));
  const agentFrames = () => h.frames.filter((f) => f.type === 'ask-block' && f.block && f.block.kind === 'agent');
  assert.equal(agentFrames().at(-1).block.ctx, 11645, 'child per-call total: input+cacheRead+output');
  h.push(mstart('msg_c2', 'toolu_agent'), mdelta({ input_tokens: 10, cache_read_input_tokens: 11343, cache_creation_input_tokens: 465, output_tokens: 51 }, 'toolu_agent'));
  assert.equal(agentFrames().at(-1).block.ctx, 11869, 'the last child call replaces');
  assert.equal(h.r.snapshot().usage.ctx, 11, 'main ctx comes from the main call (the spawn message), never the child');
});
