// test/claude-events-reroot.test.mjs — a member's frames become its row's main stream; its investigators stay sub-agents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createClaudeNormalizer } from '../src/core/engines/claude-events.mjs';

const env = (raw) => ({ type: raw.type, raw });
const T = 'toolu_member';
const FRAMES = [
  { type: 'assistant', parent_tool_use_id: T, message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 2 },
    content: [{ type: 'text', text: 'working' }, { type: 'tool_use', id: 'I1', name: 'Agent', input: { subagent_type: 'worca-investigator', description: 'look' } }] } },
  { type: 'assistant', parent_tool_use_id: 'I1', message: { content: [{ type: 'text', text: 'deep' }] } },
  { type: 'user', parent_tool_use_id: T, message: { content: [{ type: 'tool_result', tool_use_id: 'I1', content: 'found' }] }, tool_use_result: { totalTokens: 50, resolvedModel: 'claude-haiku-4-5' } },
];

test('member frames are main-stream; its Agent calls are tracked as sub-agents (R1)', () => {
  const n = createClaudeNormalizer({ rootParentId: T });
  const out = FRAMES.flatMap((f) => n(env(f)));
  assert.deepEqual(out.filter((e) => e.type === 'text').map((e) => [e.text, e.parentId]), [['working', null], ['deep', 'I1']]);
  assert.deepEqual(out.filter((e) => e.type === 'subagent').map((e) => [e.event, e.toolUseId]), [['spawn', 'I1'], ['finish', 'I1']]);
  assert.equal(out.find((e) => e.type === 'subagent' && e.event === 'finish').resolvedModel, 'claude-haiku-4-5');
  assert.equal(out.find((e) => e.type === 'usage').parentId, null, 'I1: the member usage counts for its row');
});

test('host frames, child results and child inits never reach a member stream', () => {
  const n = createClaudeNormalizer({ rootParentId: T });
  assert.deepEqual(n(env({ type: 'assistant', message: { content: [{ type: 'text', text: 'host' }] } })), []);
  assert.deepEqual(n(env({ type: 'result', parent_tool_use_id: T, total_cost_usd: 1 })), []);
  assert.deepEqual(n(env({ type: 'system', subtype: 'init', parent_tool_use_id: T, session_id: 'child' })), []);
});

test('without the option: unchanged (the member frames are children, the member Agent call untracked)', () => {
  const out = FRAMES.flatMap((f) => createClaudeNormalizer()(env(f)));
  assert.equal(out.filter((e) => e.type === 'subagent').length, 0);
  assert.equal(out.find((e) => e.type === 'text').parentId, T);
});

const FIXTURE = new URL('./fixtures/session-host/claude-depth2.ndjson', import.meta.url);
test('S9 golden: every recorded depth-2 frame lands under an investigator id', { skip: !existsSync(FIXTURE) && 'S9 fixture not recorded yet (Task 9)' }, () => {
  const frames = readFileSync(FIXTURE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const member = frames.find((f) => f.type === 'assistant' && !f.parent_tool_use_id && f.message?.content?.some((c) => c.type === 'tool_use' && c.name === 'Agent'));
  const root = member.message.content.find((c) => c.name === 'Agent').id;
  const n = createClaudeNormalizer({ rootParentId: root });
  const out = frames.flatMap((f) => n(env(f)));
  const spawned = new Set(out.filter((e) => e.type === 'subagent' && e.event === 'spawn').map((e) => e.toolUseId));
  assert.ok(spawned.size >= 1);
  for (const e of out.filter((x) => x.parentId)) assert.ok(spawned.has(e.parentId), `orphan parent ${e.parentId}`);
});

test('v5 — under a re-root a mock host line is dropped too; the member\'s own system frames other than init reach its row', () => {
  const n = createClaudeNormalizer({ rootParentId: T });
  assert.deepEqual(n({ type: 'assistant', text: 'mock host line', raw: { mock: true, text: 'mock host line' } }), []);
  const retry = n(env({ type: 'system', subtype: 'api_retry', parent_tool_use_id: T, attempt: 2, max_retries: 10, retry_delay_ms: 500, error_status: 529, error: 'overloaded' }));
  assert.deepEqual(retry.map((e) => [e.type, e.parentId, e.attempt]), [['retry', null, 2]]);
});
