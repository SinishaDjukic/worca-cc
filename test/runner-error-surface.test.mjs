// test/runner-error-surface.test.mjs
// When claude exits non-zero with EMPTY stderr, the real error is reported as a
// stream-json `result` event with is_error:true on STDOUT. The runner must
// surface that text instead of the useless "no stderr" (the bug behind
// "Pipeline error: claude exited with code 1: no stderr").
import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaude } from '../src/core/claude-runner.mjs';

const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-runner-err-'));
  tmpDirs.push(dir);
  return dir;
}
after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

// Mock must be OFF so we exercise the real spawn path; guard against leakage.
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

test('non-zero exit + empty stderr: surfaces the stdout is_error result text', async () => {
  const dir = await makeTmpDir();
  const bin = await fakeBin(dir, {
    code: 1,
    stdout:
      '{"type":"system","subtype":"init"}\n' +
      '{"type":"result","is_error":true,"result":"Not logged in · Please run /login"}',
  });

  await assert.rejects(
    () => runClaude({ bin, prompt: 'hi', cwd: dir }),
    (err) => {
      assert.match(err.message, /exited with code 1/);
      assert.match(err.message, /Not logged in · Please run \/login/, 'real cause must appear');
      assert.doesNotMatch(err.message, /no stderr/, 'must not fall back to the opaque message');
      return true;
    },
  );
});

test('real stderr still takes precedence when present', async () => {
  const dir = await makeTmpDir();
  const bin = await fakeBin(dir, {
    code: 1,
    stderr: 'boom from stderr',
    stdout: '{"type":"result","is_error":true,"result":"stdout error text"}',
  });
  await assert.rejects(
    () => runClaude({ bin, prompt: 'hi', cwd: dir }),
    /exited with code 1: boom from stderr/,
  );
});
