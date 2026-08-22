// P1/T17: the fixture sanitiser is a pure function of the capture script —
// home paths, session/message/tool/agent ids and timestamps must never reach
// the committed fixtures (ask-worca-design.md §12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSanitizer } from '../scripts/ask-capture-fixtures.mjs';

const roots = { home: '/Users/zed', base: '/private/tmp/capture-base', repo: '/Users/zed/dev/worca-cc', tmp: '/private/tmp' };

test('paths, uuids, ids, timestamps are replaced consistently; JSON stays valid', () => {
  const s = createSanitizer(roots);
  const line1 = JSON.stringify({ type: 'system', subtype: 'init', cwd: '/private/tmp/capture-base/.worca-cc/tmp/ask', session_id: '53751a6f-6597-431a-9143-bc4fe249b2ed',
    uuid: 'f31ee25b-0d0e-4f4c-a018-baaf6051e48c', memory_paths: { auto: '/Users/zed/.claude/projects/x/memory/' }, messaging_socket_path: '/tmp/cc-socks/6835.sock', claude_code_version: '2.1.239' });
  const out1 = JSON.parse(s(line1));
  assert.equal(out1.cwd, '/WORCA_BASE/.worca-cc/tmp/ask');
  assert.equal(out1.session_id, '00000000-0000-4000-8000-000000000001');
  assert.equal(out1.uuid, '00000000-0000-4000-8000-000000000002');
  assert.equal(out1.memory_paths.auto, '/HOME/.claude/projects/x/memory/');
  assert.equal(out1.messaging_socket_path, '/tmp/cc-socks/0.sock');
  assert.equal(out1.claude_code_version, '2.1.239', 'kept');
  const line2 = JSON.stringify({ type: 'assistant', session_id: '53751a6f-6597-431a-9143-bc4fe249b2ed', message: { id: 'msg_011CeHRZrYgF1ninCrBipbWe', content: [{ type: 'tool_use', id: 'toolu_01R3jtLAJHBL6akxK5WYj4gi', name: 'x', input: {} }, { type: 'thinking', thinking: 'hm', signature: 'Eo8BCkYIAxgCIkBq' }] } });
  const out2 = JSON.parse(s(line2));
  assert.equal(out2.session_id, '00000000-0000-4000-8000-000000000001', 'same uuid → same replacement');
  assert.equal(out2.message.id, 'msg_0001');
  assert.equal(out2.message.content[0].id, 'toolu_0001');
  assert.equal(out2.message.content[1].signature, '');
  const line3 = JSON.stringify({ type: 'user', tool_use_result: { agentId: 'a61fb0ef9162947fb', outputFile: '/Users/zed/dev/worca-cc/tasks/x.output', totalTokens: 4139 }, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_01R3jtLAJHBL6akxK5WYj4gi', content: 'ok 2026-08-22T12:34:56.789Z' }] } });
  const out3 = JSON.parse(s(line3));
  assert.equal(out3.tool_use_result.agentId, 'agent_01');
  assert.equal(out3.tool_use_result.outputFile, '/REPO/tasks/x.output');
  assert.equal(out3.tool_use_result.totalTokens, 4139, 'numbers are kept');
  assert.equal(out3.message.content[0].tool_use_id, 'toolu_0001', 'same tool id → same replacement');
  assert.equal(out3.message.content[0].content, 'ok 2026-01-01T00:00:00.000Z');
  const zero = JSON.parse(s(JSON.stringify({ errors: ['No conversation found with session ID: 00000000-0000-0000-0000-000000000000'] })));
  assert.ok(zero.errors[0].endsWith('00000000-0000-0000-0000-000000000000'), 'the all-zero uuid is left alone');
});

test('secrets are redacted and a plugin marker aborts', () => {
  const s = createSanitizer(roots);
  assert.equal(JSON.parse(s(JSON.stringify({ t: 'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' }))).t, 'key sk-ant-<redacted>');
  const q = JSON.parse(s(JSON.stringify({ url: 'https://x/next?token=abc123&page=2', nested: { arr: ['Authorization: Bearer abc.def'] }, 'token=keep': 1 })));
  assert.equal(q.url, 'https://x/next?token=<redacted>&page=2', 'redaction runs per string value, so the JSON survives');
  assert.equal(q.nested.arr[0], 'Authorization: Bearer <redacted>');
  assert.equal(q['token=keep'], 1, 'keys are never touched');
  assert.throws(() => s(JSON.stringify({ plugins: ['plugin:evil'] })), /recipe violation/);
  assert.throws(() => s('{not json'), /not JSON/);
});
