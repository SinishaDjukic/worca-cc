// P1/T17: the real parser path for a bogus --resume (probe F9 / call-bogus.txt,
// claude 2.1.239): exit 1, the `result` frame on stdout, the message on stderr.
// Technique: test/claude-runner-session.test.mjs:38-49 (canned fake bin).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaude } from '../src/core/claude-runner.mjs';
import { createTurnReducer } from '../src/core/ask/events.mjs';

let prevMock, prevOrch;
beforeEach(() => { prevMock = process.env.WORCA_MOCK; prevOrch = process.env.ORCH_MOCK; delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; });
afterEach(() => {
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  if (prevOrch === undefined) delete process.env.ORCH_MOCK; else process.env.ORCH_MOCK = prevOrch;
});

const ZERO = '00000000-0000-0000-0000-000000000000';
const STDOUT = JSON.stringify({ type: 'result', subtype: 'error_during_execution', duration_ms: 0, duration_api_ms: 0, is_error: true, num_turns: 0, stop_reason: null,
  session_id: ZERO, total_cost_usd: 0, usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }, modelUsage: {}, permission_denials: [],
  uuid: '5cee7e41-318d-45be-8628-91a44a393566', errors: [`No conversation found with session ID: ${ZERO}`] });
const STDERR = `No conversation found with session ID: ${ZERO}`;

async function fakeBin(dir, { stdout = '', stderr = '', code = 0 } = {}) {
  const path = join(dir, 'fake-claude.sh');
  const lines = ['#!/bin/sh'];
  for (const l of stdout.split('\n').filter(Boolean)) lines.push(`printf '%s\\n' ${JSON.stringify(l)}`);
  if (stderr) lines.push(`printf '%s\\n' ${JSON.stringify(stderr)} 1>&2`);
  lines.push(`exit ${code}`);
  await writeFile(path, lines.join('\n') + '\n', 'utf8');
  await chmod(path, 0o755);
  return path;
}

test('bogus --resume: the runner rejects with the stderr text; the reducer shows no model call happened', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-ask-resume-'));
  const bin = await fakeBin(dir, { stdout: STDOUT, stderr: STDERR, code: 1 });
  const frames = [];
  const reducer = createTurnReducer({ onFrame: (f) => frames.push(f) });
  await assert.rejects(
    () => runClaude({ bin, cwd: dir, prompt: 'hi', resumeSessionId: ZERO, onEvent: (e) => reducer.push(e) }),
    (err) => {
      assert.match(err.message, /exited with code 1: No conversation found with session ID/);
      assert.equal(err.stream, 'err');
      return true;
    },
  );
  const s = reducer.finish();
  assert.equal(s.sawInit, false);
  assert.equal(s.sawAssistant, false, 'the §6.2.7 predicate: nothing to lose by retrying without --resume');
  assert.equal(s.sawResult, true);
  assert.equal(s.costUsd, 0);
  assert.equal(s.resultSubtype, 'error_during_execution');
  assert.deepEqual(s.errors, [`No conversation found with session ID: ${ZERO}`]);
  assert.equal(s.status, 'done', 'not a limit subtype — the turn layer classifies from the rejection');
});

test('a healthy run through the same fake-bin path resolves and the reducer sees the assistant', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-ask-resume-'));
  const ok = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1', tools: ['Task'], mcp_servers: [] }),
    JSON.stringify({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'hi back' }], usage: { input_tokens: 1, output_tokens: 2 } }, parent_tool_use_id: null }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess-1', total_cost_usd: 0.001, usage: { input_tokens: 1, output_tokens: 2 }, result: 'hi back', num_turns: 1, duration_ms: 5 }),
  ].join('\n');
  const bin = await fakeBin(dir, { stdout: ok, code: 0 });
  const reducer = createTurnReducer({ onFrame: () => {} });
  const r = await runClaude({ bin, cwd: dir, prompt: 'hi', resumeSessionId: 'sess-1', onEvent: (e) => reducer.push(e) });
  assert.deepEqual(r, { text: 'hi back', exitCode: 0 });
  const s = reducer.finish();
  assert.equal(s.sawAssistant, true);
  assert.equal(s.text, 'hi back');
  assert.equal(s.sessionId, 'sess-1');
});
