// test/workflow-test-shell-step.test.mjs — workflow tests 3a (D55, D57): one command through the OS shell, with a time
// limit and the end of its output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runShellStep, tryShellEnv, writeTrySetup, readTrySetup, TAIL_LINES } from '../src/core/workflow-tests/shell-step.mjs';

const node = (code) => `node -e "${code}"`;
const cwd = tmpdir();

test('a command that passes: exit 0, its output tail', async () => {
  const r = await runShellStep({ command: node("console.log('a'); console.log('3 passed')"), cwd, env: tryShellEnv(), timeoutMs: 30000 });
  assert.deepEqual([r.ok, r.exitCode, r.timedOut], [true, 0, false]);
  assert.match(r.tail, /3 passed/);
});

test('an exit code, a time limit and an abort are not ok', async () => {
  const bad = await runShellStep({ command: node('process.exit(2)'), cwd, env: tryShellEnv(), timeoutMs: 30000 });
  assert.deepEqual([bad.ok, bad.exitCode], [false, 2]);
  const slow = await runShellStep({ command: node('setTimeout(() => {}, 60000)'), cwd, env: tryShellEnv(), timeoutMs: 400 });
  assert.deepEqual([slow.ok, slow.timedOut], [false, true]);
  const ac = new AbortController();
  const p = runShellStep({ command: node('setTimeout(() => {}, 60000)'), cwd, env: tryShellEnv(), timeoutMs: 30000, signal: ac.signal });
  setTimeout(() => ac.abort(), 200);
  assert.equal((await p).ok, false);
});

test('the tail keeps the last 40 lines', async () => {
  const r = await runShellStep({ command: node('for (let i = 1; i <= 100; i++) console.log(\'line \' + i)'), cwd, env: tryShellEnv(), timeoutMs: 30000 });
  const lines = r.tail.split('\n');
  assert.equal(lines.length, TAIL_LINES);
  assert.equal(lines.at(-1), 'line 100');
});

test('the env knows it is a test and holds no Worca home', () => {
  const env = tryShellEnv();
  assert.equal(env.WORCA_TEST, '1');
  assert.equal(env.WORCA_HOME, undefined);
});

test('the setup file round-trips', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-wftsetup-'));
  try {
    assert.equal(await readTrySetup(dir), null);
    await writeTrySetup(dir, { cmd: 'npm ci', ok: false, exitCode: 1, timedOut: false, ms: 5, tail: 'npm error' });
    assert.deepEqual(await readTrySetup(dir), { cmd: 'npm ci', ok: false, exitCode: 1, timedOut: false, ms: 5, tail: 'npm error' });
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
});
