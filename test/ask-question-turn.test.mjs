import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAskTurn } from '../src/core/ask/turn.mjs';
import { createThread, appendMessage, getMessage } from '../src/core/ask/store.mjs';

useTempHome(after);
const push = (onEvent, raw) => onEvent({ type: raw.type, raw });
const toolUse = (onEvent, msgId, toolId, name, input) => push(onEvent, { type: 'assistant', message: { id: msgId, content: [{ type: 'tool_use', id: toolId, name, input }] }, parent_tool_use_id: null });
const toolResult = (onEvent, toolId, text) => push(onEvent, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: [{ type: 'text', text }] }] }, parent_tool_use_id: null });
const RESULT = { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: {}, duration_ms: 1, num_turns: 1, session_id: 'sess-q', permission_denials: [] };
const Q = (question) => ({ answer: 'choice', question, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });

test('_onQuestion: the parent re-validates the input (child ok is not enough) and keeps one open question per turn', async () => {
  const thread = createThread();
  const user = appendMessage(thread.id, { role: 'user', text: 'hi' });
  const asst = appendMessage(thread.id, { role: 'assistant', text: '', status: 'streaming' });
  const turn = createAskTurn({ threadId: thread.id, assistantMessageId: asst.id, userMessageId: user.id, prompt: 'P', systemPrompt: 'S', restoredPrompt: 'R',
    model: 'claude-opus-5-5', effort: 'high', resumeSessionId: null, firstTurn: false, firstText: 'hi', deterministicTitle: null, mock: null, attachmentNames: {},
    deps: { onFrame: () => {}, onOutOfTurn: () => {}, generateTitle: async () => '', failedBecauseSignedOut: async () => false, claudeAuthState: async () => 'unknown',
      runClaudeImpl: async (opts) => {
        const ok = '{"ok":true,"card":{}}';
        toolUse(opts.onEvent, 'msg_1', 'toolu_q3', 'mcp__worca__ask_question', Q('Refused?'));
        toolResult(opts.onEvent, 'toolu_q3', '{"ok":false,"errors":["x"]}');
        toolUse(opts.onEvent, 'msg_1', 'toolu_q0', 'mcp__worca__ask_question', { answer: 'choice', question: 'bad', options: [{ id: 'a', label: 'A' }] });
        toolResult(opts.onEvent, 'toolu_q0', ok);
        toolUse(opts.onEvent, 'msg_1', 'toolu_q1', 'mcp__worca__ask_question', Q('First?'));
        toolResult(opts.onEvent, 'toolu_q1', ok);
        toolUse(opts.onEvent, 'msg_1', 'toolu_q2', 'mcp__worca__ask_question', Q('Second?'));
        toolResult(opts.onEvent, 'toolu_q2', ok);
        push(opts.onEvent, RESULT);
        return { text: '', exitCode: 0 };
      } },
  });
  await turn.run();
  const cards = getMessage(asst.id).blocks.filter((b) => b.kind === 'card');
  assert.deepEqual(cards.map((c) => [c.state, c.card.type, c.card.question]), [['proposed', 'question', 'First?']]);
});
