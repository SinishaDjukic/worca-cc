// test/ask-chat-actions-turn.test.mjs — worca Chat P2 Task 5: a chat-action tool's RESULT reaches the parent (reducer
// hook → AskTurn._onChatAction → deps.chatAction) and the card or notice it hands back lands in the reply.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createTurnReducer } from '../src/core/ask/events.mjs';
import { createAskTurn } from '../src/core/ask/turn.mjs';
import { createThread, appendMessage, getMessage } from '../src/core/ask/store.mjs';
import { receiptCard } from '../src/core/ask/receipt.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);

// ── reducer frames: the runner envelope {type, raw} (the builders of test/ask-events.test.mjs) ──
const SID = 'sess-0001';
const USAGE_START = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 };
const ev = (raw) => ({ type: raw.type, raw });
const session = () => ({ type: 'session', sessionId: SID });
const init = () => ev({ type: 'system', subtype: 'init', session_id: SID, tools: ['Task'], mcp_servers: [{ name: 'worca', status: 'connected' }] });
const mstart = (id) => ev({ type: 'stream_event', event: { type: 'message_start', message: { id, model: 'claude-haiku-4-5', role: 'assistant', content: [], usage: USAGE_START } }, parent_tool_use_id: null, session_id: SID });
const atool = (id, toolId, name, input, ptu = null) => ev({ type: 'assistant', message: { id, model: 'claude-haiku-4-5', role: 'assistant', content: [{ type: 'tool_use', id: toolId, name, input, caller: { type: 'direct' } }], usage: USAGE_START }, parent_tool_use_id: ptu, session_id: SID });
const uresult = (toolId, content, { isError = false, ptu = null } = {}) => ev({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content, ...(isError ? { is_error: true } : {}) }] }, parent_tool_use_id: ptu, session_id: SID });
function reducer(opts) {
  const r = createTurnReducer({ onFrame: () => {}, now: () => 1000, setTimeout: () => 1, clearTimeout: () => {}, ...opts });
  return { push: (...evs) => { for (const e of evs) r.push(e); } };
}

test('onChatAction: each chat-action tool reaches the hook with its short name; a sub-agent\'s ok result arrives marked sub:true (the turn says "not applied"); the schedule poke still fires', () => {
  const calls = []; const pokes = [];
  const h = reducer({ onChatAction: (e) => { calls.push(e); return Promise.resolve(); }, onScheduleMutation: (e) => pokes.push(e) });
  h.push(session(), init(), mstart('msg_1'));
  const TOOLS = ['change_setting', 'pause_run', 'resume_run', 'propose_stop_run', 'send_direction', 'propose_pull_request', 'pause_schedule', 'resume_schedule'];
  TOOLS.forEach((t, i) => {
    h.push(atool('msg_1', `toolu_${i}`, `mcp__worca__${t}`, { runId: 'aaaa0001' }));
    h.push(uresult(`toolu_${i}`, '{"ok":true}'));
  });
  assert.deepEqual(calls.map((c) => c.name), TOOLS);
  assert.deepEqual(calls[0], { toolUseId: 'toolu_0', name: 'change_setting', input: { runId: 'aaaa0001' }, text: '{"ok":true}', isError: false });
  assert.deepEqual(pokes, [{ tool: 'pause_schedule' }, { tool: 'resume_schedule' }]);
  h.push(atool('msg_1', 'toolu_task', 'Agent', { description: 'helper', subagent_type: 'general-purpose', prompt: 'x' }));
  h.push(atool('msg_c', 'toolu_sub', 'mcp__worca__pause_run', { runId: 'aaaa0001' }, 'toolu_task'));
  h.push(uresult('toolu_sub', '{"ok":true}', { ptu: 'toolu_task' }));
  assert.equal(calls.length, TOOLS.length + 1);
  assert.deepEqual(calls.at(-1), { toolUseId: 'toolu_sub', name: 'pause_run', input: { runId: 'aaaa0001' }, text: '{"ok":true}', isError: false, sub: true },
    'a sub-agent\'s call reaches the hook marked sub — the turn reports it, never applies it (review P2-1)');
  h.push(atool('msg_c', 'toolu_sub2', 'mcp__worca__pause_run', { runId: 'aaaa0001' }, 'toolu_task'));
  h.push(uresult('toolu_sub2', 'error: pause_run: run not found', { isError: true, ptu: 'toolu_task' }));
  assert.equal(calls.length, TOOLS.length + 1, 'a sub-agent\'s error result is not passed on');
  h.push(atool('msg_1', 'toolu_l', 'mcp__worca__list_settings', {}));
  h.push(uresult('toolu_l', '{"settings":[]}'));
  assert.equal(calls.length, TOOLS.length + 1, 'a read is not an action');
});

// ── AskTurn over the real store (test/ask-turn.test.mjs's shape) ──
const RESULT = (over = {}) => ({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.05,
  usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  modelUsage: {}, duration_ms: 40, num_turns: 1, session_id: 'sess-1', permission_denials: [], ...over });
const push = (onEvent, raw) => onEvent({ type: raw.type, raw });
const callTool = (onEvent, n, name, input, content, isError = false) => {
  push(onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: `msg_${n}`, content: [{ type: 'tool_use', id: `toolu_${n}`, name, input }] } });
  push(onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: `toolu_${n}`, content, ...(isError ? { is_error: true } : {}) }] } });
};
/** One turn whose model makes `calls` (main-stream [name, input, result, isError?] rows, or a function that pushes raw events
 *  itself); returns the reply's card and notice blocks as stored. */
async function runWith(deps, calls, over = {}) {
  const thread = createThread();
  const user = appendMessage(thread.id, { role: 'user', text: 'hello there' });
  const asst = appendMessage(thread.id, { role: 'assistant', text: '', status: 'streaming' });
  const turn = createAskTurn({
    threadId: thread.id, assistantMessageId: asst.id, userMessageId: user.id,
    prompt: 'P', systemPrompt: 'SYS', restoredPrompt: 'R', model: 'claude-opus-5-5', effort: 'high',
    resumeSessionId: null, firstTurn: false, firstText: 'hello there', deterministicTitle: null, mock: null, attachmentNames: {},
    ...over,
    deps: {
      onFrame: () => {}, onOutOfTurn: () => {}, generateTitle: async () => '', failedBecauseSignedOut: async () => false,
      ...deps,
      runClaudeImpl: async (opts) => {
        if (typeof calls === 'function') calls(opts.onEvent);
        else calls.forEach((c, i) => callTool(opts.onEvent, i + 1, ...c));
        for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
        push(opts.onEvent, RESULT());
        return { text: '', exitCode: 0 };
      },
    },
  });
  await turn.run();
  return (getMessage(asst.id).blocks || []).filter((b) => b.kind === 'card' || b.kind === 'notice');
}
const RECEIPT = receiptCard({ kind: 'pause', label: 'Run', target: { pipelineId: 'aaaa0001', title: 'Fix login' }, before: 'Running', after: 'Paused', raw: { before: 'running', after: 'paused' } });
const asked = (kind) => JSON.stringify({ ok: true, requested: { kind, runId: 'aaaa0001' } });

test('_onChatAction: the child\'s request reaches deps.chatAction; its card or notice lands in the reply', async () => {
  await checkRows([
    { name: 'a receipt card', run: async () => {
      const seen = [];
      const blocks = await runWith({ chatAction: async (req, ctx) => { seen.push([req, typeof ctx.threadId]); return { ok: true, block: { state: 'applied', card: RECEIPT } }; } },
        [['mcp__worca__pause_run', { runId: 'aaaa0001' }, asked('pause')]]);
      assert.deepEqual(seen, [[{ kind: 'pause', runId: 'aaaa0001' }, 'string']]);
      const card = blocks.find((b) => b.kind === 'card');
      assert.match(card.id, /^card_[0-9a-f]{8}$/);
      assert.equal(card.state, 'applied');
      assert.deepEqual(card.card, RECEIPT);
    } },
    { name: 'a proposed card (stop) keeps its state', run: async () => {
      const blocks = await runWith({ chatAction: async () => ({ ok: true, block: { state: 'proposed', card: { type: 'run-stop', runId: null, pipelineId: 'aaaa0001', title: 'Fix login', branch: 'b', status: 'running' } } }) },
        [['mcp__worca__propose_stop_run', { runId: 'aaaa0001' }, asked('stop')]]);
      assert.deepEqual(blocks.filter((b) => b.kind === 'card').map((b) => [b.state, b.card.type]), [['proposed', 'run-stop']]);
    } },
    { name: 'Shaper propose_changes: the request and the turn\'s thread reach deps.chatAction; its card lands proposed', run: async () => {
      const seen = [];
      const req = { kind: 'changes', pipelineId: 'aaaa0001', request: 'make it blue' };
      const blocks = await runWith({ chatAction: async (r, ctx) => { seen.push([r, ctx]); return { ok: true, block: { state: 'proposed', card: { type: 'changes' } } }; } },
        [['mcp__worca__propose_changes', { pipelineId: 'aaaa0001', request: 'make it blue' }, JSON.stringify({ ok: true, requested: req })]]);
      assert.equal(seen.length, 1);
      assert.deepEqual(seen[0][0], req);
      assert.match(seen[0][1].threadId, /^ask_/);
      assert.deepEqual(blocks.filter((b) => b.kind === 'card').map((b) => [b.state, b.card.type]), [['proposed', 'changes']]);
    } },
    { name: 'Shaper propose_changes from a sub-agent is never applied: a notice says so', run: async () => {
      let n = 0;
      const blocks = await runWith({ chatAction: async () => { n += 1; return { ok: true, block: { state: 'proposed', card: { type: 'changes' } } }; } }, (onEvent) => {
        push(onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_task', name: 'Agent', input: { description: 'helper', subagent_type: 'general-purpose', prompt: 'x' } }] } });
        push(onEvent, { type: 'assistant', parent_tool_use_id: 'toolu_task', message: { id: 'msg_c', content: [{ type: 'tool_use', id: 'toolu_sub', name: 'mcp__worca__propose_changes', input: { pipelineId: 'aaaa0001', request: 'x' } }] } });
        push(onEvent, { type: 'user', parent_tool_use_id: 'toolu_task', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_sub', content: JSON.stringify({ ok: true, requested: { kind: 'changes', pipelineId: 'aaaa0001', request: 'x' } }) }] } });
      });
      assert.equal(n, 0, 'never applied');
      assert.deepEqual(blocks.map((b) => [b.kind, b.text]), [['notice', 'Not applied: a sub-agent asked to propose changes — ask again in this chat']]);
    } },
    { name: 'a refusal from the parent is a notice', run: async () => {
      const blocks = await runWith({ chatAction: async () => ({ ok: false, notice: 'Could not pause Fix login: it is paused' }) },
        [['mcp__worca__pause_run', { runId: 'aaaa0001' }, asked('pause')]]);
      assert.deepEqual(blocks.map((b) => b.text), ['Could not pause Fix login: it is paused']);
    } },
    { name: 'the two schedule verbs post their receipt from the child\'s own result', run: async () => {
      const seen = [];
      await runWith({ chatAction: async (req) => { seen.push(req); return { ok: true, block: { state: 'applied', card: RECEIPT } }; } },
        [['mcp__worca__pause_schedule', { id: 'sch_00000001' }, JSON.stringify({ ok: true, schedule: { id: 'sch_00000001', title: 'Nightly', status: 'paused' } })],
          ['mcp__worca__resume_schedule', { id: 'sch_00000001' }, JSON.stringify({ ok: true, schedule: { id: 'sch_00000001', title: 'Nightly', status: 'active' } })]]);
      assert.deepEqual(seen.map((r) => r.kind), ['schedule-pause', 'schedule-resume']);
      assert.equal(seen[0].schedule.title, 'Nightly');
    } },
    { name: 'a sub-agent\'s pause_run is never applied: a notice says so and the host is never called (review P2-1)', run: async () => {
      let n = 0;
      const blocks = await runWith({ chatAction: async () => { n += 1; return { ok: true, block: { state: 'applied', card: RECEIPT } }; } }, (onEvent) => {
        push(onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_task', name: 'Agent', input: { description: 'helper', subagent_type: 'general-purpose', prompt: 'x' } }] } });
        push(onEvent, { type: 'assistant', parent_tool_use_id: 'toolu_task', message: { id: 'msg_c', content: [{ type: 'tool_use', id: 'toolu_sub', name: 'mcp__worca__pause_run', input: { runId: 'aaaa0001' } }] } });
        push(onEvent, { type: 'user', parent_tool_use_id: 'toolu_task', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_sub', content: asked('pause') }] } });
      });
      assert.equal(n, 0, 'never applied');
      assert.deepEqual(blocks.map((b) => [b.kind, b.text]), [['notice', 'Not applied: a sub-agent asked to pause a run — ask again in this chat']]);
    } },
    { name: 'a sub-agent\'s pause_schedule already acted in the child: its receipt is posted like the main stream\'s', run: async () => {
      const seen = [];
      const blocks = await runWith({ chatAction: async (req) => { seen.push(req.kind); return { ok: true, block: { state: 'applied', card: RECEIPT } }; } }, (onEvent) => {
        push(onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_task', name: 'Agent', input: { description: 'helper', subagent_type: 'general-purpose', prompt: 'x' } }] } });
        push(onEvent, { type: 'assistant', parent_tool_use_id: 'toolu_task', message: { id: 'msg_c', content: [{ type: 'tool_use', id: 'toolu_sub', name: 'mcp__worca__pause_schedule', input: { id: 'sch_00000001' } }] } });
        push(onEvent, { type: 'user', parent_tool_use_id: 'toolu_task', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_sub', content: JSON.stringify({ ok: true, schedule: { id: 'sch_00000001', title: 'Nightly', status: 'paused' } }) }] } });
      });
      assert.deepEqual(seen, ['schedule-pause']);
      assert.deepEqual(blocks.map((b) => b.kind), ['card']);
    } },
    { name: 'a child refusal, an error result or a Workflows chat applies nothing', run: async () => {
      let n = 0;
      const chatAction = async () => { n += 1; return { ok: true, block: { state: 'applied', card: RECEIPT } }; };
      await runWith({ chatAction }, [
        ['mcp__worca__pause_run', { runId: 'aaaa0002' }, JSON.stringify({ ok: false, error: 'the run is paused' })],
        ['mcp__worca__pause_run', { runId: 'x' }, 'error: pause_run: run not found', true],
      ]);
      await runWith({ chatAction }, [['mcp__worca__pause_run', { runId: 'aaaa0001' }, asked('pause')]], { composer: { sessionId: 's1', docToken: 'd1' } });
      assert.equal(n, 0);
    } },
  ]);
});

test('_onAwaySwitch: the "Done — …" line, then the receipt the host hands back', async () => {
  const card = receiptCard({ kind: 'away-now', label: 'Away mode', before: 'Following away hours', after: "I'm away now", raw: { before: 'auto', after: 'on', person: null } });
  const blocks = await runWith({ awaySwitch: async () => ({ ok: true, line: 'Right now you count as away.', receipt: card }) },
    [['mcp__worca__set_away_now', { mode: 'away' }, JSON.stringify({ ok: true, requested: { kind: 'global', toggle: 'on' } })]]);
  assert.deepEqual(blocks.map((b) => b.kind), ['notice', 'card']);
  assert.equal(blocks[0].text, 'Done — Right now you count as away.');
  assert.equal(blocks[1].state, 'applied');
  assert.deepEqual(blocks[1].card, card);
});

test('_onChatAction applies only an ok, non-error result — a refusal carrying `requested` or an error result with ok JSON applies nothing (mutation killer)', async () => {
  let n = 0;
  const chatAction = async () => { n += 1; return { ok: true, block: { state: 'applied', card: RECEIPT } }; };
  await runWith({ chatAction }, [
    ['mcp__worca__pause_run', { runId: 'aaaa0002' }, JSON.stringify({ ok: false, error: 'the run is paused', requested: { kind: 'pause', runId: 'aaaa0002' } })],
    ['mcp__worca__pause_run', { runId: 'aaaa0001' }, asked('pause'), true],
  ]);
  assert.equal(n, 0);
});

test('_onChatAction persists the card at once: a reload mid-turn, or a turn that dies, keeps the Revert of a change already applied (refine cycle 2 mutation killer)', async () => {
  const { listMessages } = await import('../src/core/ask/store.mjs');
  let tid = null; let midTurn = null;
  await runWith({ chatAction: async (_req, ctx) => { tid = ctx.threadId; return { ok: true, block: { state: 'applied', card: RECEIPT } }; } }, async (onEvent) => {
    callTool(onEvent, 1, 'mcp__worca__pause_run', { runId: 'aaaa0001' }, asked('pause'));
    for (let i = 0; i < 2; i++) await new Promise((r) => setImmediate(r));   // the runner sends its result after 4 ticks
    midTurn = listMessages(tid).filter((m) => m.role === 'assistant').flatMap((m) => m.blocks || []).filter((b) => b.kind === 'card');
  });
  assert.deepEqual(midTurn.map((b) => b.card.kind), ['pause']);
});

test('a sub-agent\'s call of each chat action is named in its "Not applied" notice (refine cycle 2 mutation killer)', async () => {
  const WORDS = { change_setting: 'change a setting', pause_run: 'pause a run', resume_run: 'resume a run', propose_stop_run: 'stop a run', send_direction: 'send a direction to a run', propose_pull_request: 'create a PR' };
  const blocks = await runWith({ chatAction: async () => ({ ok: true, block: { state: 'applied', card: RECEIPT } }) }, (onEvent) => {
    push(onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_task', name: 'Agent', input: { description: 'helper', subagent_type: 'general-purpose', prompt: 'x' } }] } });
    Object.keys(WORDS).forEach((n, i) => {
      push(onEvent, { type: 'assistant', parent_tool_use_id: 'toolu_task', message: { id: `msg_c${i}`, content: [{ type: 'tool_use', id: `toolu_s${i}`, name: `mcp__worca__${n}`, input: {} }] } });
      push(onEvent, { type: 'user', parent_tool_use_id: 'toolu_task', message: { content: [{ type: 'tool_result', tool_use_id: `toolu_s${i}`, content: JSON.stringify({ ok: true, requested: { kind: 'pause', runId: 'aaaa0001' } }) }] } });
    });
  });
  assert.deepEqual(blocks.map((b) => b.text), Object.values(WORDS).map((w) => `Not applied: a sub-agent asked to ${w} — ask again in this chat`));
});
