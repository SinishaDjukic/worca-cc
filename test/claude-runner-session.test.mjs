// test/claude-runner-session.test.mjs
// buildClaudeArgs is a new pure export; the mock runner emits a deterministic
// session event and logs a resume marker. NOTE: mock markers are `KEY: value`
// lines (parseMarkers at claude-runner.mjs:341) — NOT `KEY=value`.
import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildClaudeArgs, runClaude } from '../src/core/claude-runner.mjs';
import { checkRows } from './helpers/rows.mjs';

const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };

const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-runner-'));
  tmpDirs.push(dir);
  return dir;
}
after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

// The real-path test below needs mock OFF to exercise the spawn parser; guard
// against env leakage. (Mock tests are unaffected: they pass `mock: true`.)
let prevMock, prevOrch;
beforeEach(() => {
  prevMock = process.env.WORCA_MOCK;
  prevOrch = process.env.ORCH_MOCK;
  delete process.env.WORCA_MOCK;
  delete process.env.ORCH_MOCK;
});
afterEach(() => {
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  if (prevOrch === undefined) delete process.env.ORCH_MOCK; else process.env.ORCH_MOCK = prevOrch;
});

/** Write an executable fake `claude` that mimics a given stdout/stderr/exit. */
async function fakeBin(dir, { stdout = '', stderr = '', code = 0 } = {}) {
  const path = join(dir, 'fake-claude.sh');
  const lines = ['#!/bin/sh'];
  for (const l of stdout.split('\n').filter(Boolean)) {
    lines.push(`printf '%s\\n' ${JSON.stringify(l)}`);
  }
  if (stderr) lines.push(`printf '%s\\n' ${JSON.stringify(stderr)} 1>&2`);
  lines.push(`exit ${code}`);
  await writeFile(path, lines.join('\n') + '\n', 'utf8');
  await chmod(path, 0o755);
  return path;
}

// Unknown MOCK_ROLE -> runMock's default branch: no filesystem side effects.
const MOCK_PROMPT = 'do the thing\nMOCK_ROLE: sessiontest\nMOCK_CYCLE: 2';

test('buildClaudeArgs: --resume <sid> only when resumeSessionId is set', async () => {
  await checkRows([
    { name: 'buildClaudeArgs without resume has no --resume flag', run: () => {
      const args = buildClaudeArgs({ prompt: 'p', permissionMode: 'acceptEdits' });
      assert.ok(!args.includes('--resume'));
      assert.deepEqual(args.slice(0, 2), ['-p', 'p']);
    } },
    { name: 'buildClaudeArgs with resumeSessionId inserts --resume <sid>', run: () => {
      const args = buildClaudeArgs({ prompt: 'p', permissionMode: 'acceptEdits', resumeSessionId: 'sess-1' });
      const i = args.indexOf('--resume');
      assert.ok(i > -1, 'flag present');
      assert.equal(args[i + 1], 'sess-1');
    } },
  ]);
});

test('mock emits a session event with a deterministic id', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-'));
  const events = [];
  await runClaude({ cwd: dir, prompt: MOCK_PROMPT, mock: true, onEvent: (e) => events.push(e) });
  const s = events.find((e) => e.type === 'session');
  assert.ok(s, 'session event emitted');
  assert.equal(s.sessionId, 'mock-session-sessiontest-c2');
});

// Real spawn path (no mock): the stream-json parser must translate the CLI's
// `{"type":"system","subtype":"init","session_id":...}` line into our
// `{type:'session', sessionId}` event (claude-runner.mjs:249-251).
test('real path: system/init surfaces {type:"session", sessionId}', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const bin = await fakeBin(dir, {
    code: 0,
    stdout:
      '{"type":"system","subtype":"init","session_id":"sess-real-1"}\n' +
      '{"type":"result","result":"ok"}',
  });
  const events = [];
  await runClaude({ bin, prompt: 'hi', cwd: dir, onEvent: (e) => events.push(e) });
  assert.equal(events.find((e) => e.type === 'session')?.sessionId, 'sess-real-1');
});

// ── Session groups, Task 39: a host turn reads the runner's RAW envelopes (its demux routes them) ──
test('rawEvents: the raw envelopes reach onEvent unchanged; without it, only the normalized vocabulary', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const bin = await fakeBin(dir, { code: 0, stdout:
    '{"type":"system","subtype":"init","session_id":"sess-raw-1","model":"claude-haiku-4-5"}\n'
    + '{"type":"assistant","message":{"id":"m1","content":[{"type":"tool_use","id":"T1","name":"Agent","input":{"subagent_type":"worca-x-n_a-1-a1"}}]}}\n'
    + '{"type":"result","subtype":"success","result":"DONE","total_cost_usd":0.5}' });
  const raw = [];
  const out = await runClaude({ bin, prompt: 'hi', cwd: dir, rawEvents: true, onEvent: (e) => raw.push(e) });
  assert.equal(out.text, 'DONE');
  assert.deepEqual(raw.map((e) => e.type), ['session', 'system', 'assistant', 'result']);
  assert.equal(raw[1].raw.session_id, 'sess-raw-1');
  assert.equal(raw[2].raw.message.content[0].name, 'Agent');
  assert.equal(raw[3].costUsd, 0.5);
  const norm = [];
  await runClaude({ bin, prompt: 'hi', cwd: dir, onEvent: (e) => norm.push(e) });
  assert.equal(norm.some((e) => e.type === 'system' || e.type === 'assistant'), false, 'an ungrouped spawn still sees only normalized events');
  assert.ok(norm.some((e) => e.type === 'tool' || e.type === 'subagent'));
  const { defaultTransport } = await import('../src/core/session-host.mjs');
  const viaHost = [];
  await defaultTransport({ bin, prompt: 'hi', cwd: dir, onEvent: (e) => viaHost.push(e) });
  assert.deepEqual(viaHost.map((e) => e.type), ['session', 'system', 'assistant', 'result'], 'a real host turn asks for the raw envelopes');
});
