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

test('buildClaudeArgs without resume has no --resume flag', () => {
  const args = buildClaudeArgs({ prompt: 'p', permissionMode: 'acceptEdits' });
  assert.ok(!args.includes('--resume'));
  assert.deepEqual(args.slice(0, 2), ['-p', 'p']);
});

test('buildClaudeArgs with resumeSessionId inserts --resume <sid>', () => {
  const args = buildClaudeArgs({ prompt: 'p', permissionMode: 'acceptEdits', resumeSessionId: 'sess-1' });
  const i = args.indexOf('--resume');
  assert.ok(i > -1, 'flag present');
  assert.equal(args[i + 1], 'sess-1');
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
test('real path: system/init surfaces {type:"session", sessionId}', async () => {
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

test('mock resumeSessionId logs a resumed marker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-runner-'));
  const events = [];
  await runClaude({
    cwd: dir, prompt: MOCK_PROMPT, mock: true,
    resumeSessionId: 'mock-session-sessiontest-c2',
    onEvent: (e) => events.push(e),
  });
  assert.ok(events.some((e) => typeof e.text === 'string' && e.text.includes('[mock] resumed session mock-session-sessiontest-c2')));
});
