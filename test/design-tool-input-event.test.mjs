// test/design-tool-input-event.test.mjs — the normalized toolInput event (Design P2, C-4): a main-stream
// tool_use block's streamed arguments, and the consumers (Ask reducer, run harness) that must ignore it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClaudeNormalizer } from '../src/core/engines/claude-events.mjs';
import { createTurnReducer } from '../src/core/ask/events.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

const se = (event, parent = null) => ({ type: 'stream_event', raw: { type: 'stream_event', event, parent_tool_use_id: parent } });
const startM = (id) => se({ type: 'message_start', message: { id, usage: { input_tokens: 1 } } });
const startB = (i, id, name) => se({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id, name, input: {} } });
const deltaB = (i, s, parent) => se({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: s } }, parent);
const stopB = (i) => se({ type: 'content_block_stop', index: i });

test('a tool_use block becomes start, delta, stop on the main stream', () => {
  const n = createClaudeNormalizer();
  n(startM('m1'));
  assert.deepEqual(n(startB(1, 't1', 'Write')), [{ type: 'toolInput', phase: 'start', parentId: null, messageId: 'm1', index: 1, toolUseId: 't1', name: 'Write' }]);
  assert.deepEqual(n(deltaB(1, '{"a')), [{ type: 'toolInput', phase: 'delta', parentId: null, messageId: 'm1', index: 1, toolUseId: 't1', name: 'Write', partialJson: '{"a' }]);
  assert.deepEqual(n(stopB(1)), [{ type: 'toolInput', phase: 'stop', parentId: null, messageId: 'm1', index: 1, toolUseId: 't1', name: 'Write' }]);
  assert.deepEqual(n(deltaB(1, 'late')), [], 'stop forgets the index');
});
test('a child stream, a text block and an unknown index emit nothing', () => {
  const n = createClaudeNormalizer();
  n(startM('m1'));
  assert.deepEqual(n(deltaB(1, 'x', 'toolu_parent')), []);
  assert.deepEqual(n(se({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })), []);
  assert.deepEqual(n(deltaB(7, 'x')), []);
});
test('child-stream tool blocks emit nothing and keep the main map; a non-string partial_json becomes ""', () => {
  const n = createClaudeNormalizer();
  n(startM('m1')); n(startB(1, 't1', 'Write'));
  assert.deepEqual(n(se({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'c1', name: 'Read', input: {} } }, 'toolu_parent')), []);
  assert.deepEqual(n(deltaB(2, 'x', 'toolu_parent')), []);
  assert.deepEqual(n(se({ type: 'content_block_stop', index: 2 }, 'toolu_parent')), []);
  assert.deepEqual(n(deltaB(2, 'x')), [], 'a child start does not register on the main stream');
  n(se({ type: 'message_start', message: { id: 'cm1', usage: {} } }, 'toolu_parent'));
  assert.deepEqual(n(deltaB(1, 5)).map((e) => [e.phase, e.partialJson]), [['delta', '']], 'a child message_start keeps the main map');
});
test('only an input_json_delta feeds a known tool index', () => {
  const n = createClaudeNormalizer();
  n(startM('m1')); n(startB(1, 't1', 'Write'));
  assert.deepEqual(n(se({ type: 'content_block_delta', index: 1, delta: { type: 'signature_delta', signature: 's' } })), []);
});
test('message_start resets the index map', () => {
  const n = createClaudeNormalizer();
  n(startM('m1')); n(startB(1, 't1', 'Write'));
  n(startM('m2'));
  assert.deepEqual(n(deltaB(1, 'x')), []);
});
test('the recorded propose-run fixture joins to its input', () => {
  const frames = readFileSync(new URL('./fixtures/ask/propose-run.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const n = createClaudeNormalizer();
  const got = frames.flatMap((raw) => n({ type: raw.type, raw })).filter((e) => e.type === 'toolInput');
  assert.equal(got[0].name, 'mcp__worca__propose_run');
  assert.deepEqual([got[0].phase, got.at(-1).phase], ['start', 'stop']);
  assert.equal(JSON.parse(got.filter((e) => e.phase === 'delta').map((e) => e.partialJson).join('')).workflowId, 'wf_default');
});
test('the Ask reducer emits the same frames with and without toolInput', () => {
  for (const name of ['plain-text', 'tool-list-runs', 'propose-run', 'task-subagent']) {
    const frames = readFileSync(new URL(`./fixtures/ask/${name}.jsonl`, import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const drive = (feed) => {
      const out = [];
      const r = createTurnReducer({ onFrame: (f) => out.push(f), now: () => 1000, setTimeout: () => 0, clearTimeout: () => {} });
      feed(r);
      return { out, s: r.finish() };
    };
    const n = createClaudeNormalizer();
    const normalized = frames.flatMap((raw) => n({ type: raw.type, raw }));
    const withIt = drive((r) => { for (const e of normalized) r.push(e); });
    const without = drive((r) => { for (const e of normalized) if (e.type !== 'toolInput') r.push(e); });
    assert.deepEqual(withIt, without, name);
  }
});
test('a toolInput before any other event adds no label', () => {
  const drive = (events) => { const out = []; const r = createTurnReducer({ onFrame: (f) => out.push(f), now: () => 1000, setTimeout: () => 0, clearTimeout: () => {} }); for (const e of events) r.push(e); return { out, s: r.finish() }; };
  assert.deepEqual(drive([{ type: 'toolInput', phase: 'start', parentId: null, messageId: 'm', index: 1, toolUseId: 't', name: 'Write' }]), drive([]), 'every fixture starts with a session, so only this row pins the early return');
});
test('the run harness ignores toolInput', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/p' });
  const before = JSON.stringify(orch.state);
  const seen = [];
  orch.on('log', (m) => seen.push(m));
  orch._onAgentEvent('planner', { type: 'toolInput', phase: 'delta', parentId: null, messageId: 'm', index: 1, toolUseId: 't', name: 'Write', partialJson: 'x' }, { nodeId: 'n', stepIndex: 0, cycle: 1, stepKey: '0:n', executionId: 'x' });
  assert.deepEqual(seen, []);
  assert.equal(JSON.stringify(orch.state), before);
});
