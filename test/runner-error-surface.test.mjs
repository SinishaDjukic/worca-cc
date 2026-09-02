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
import { classifyError } from '../src/core/recoverable-error.mjs';

const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };

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

test('non-zero exit + empty stderr: surfaces the stdout is_error result text', POSIX_SHIM, async () => {
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

test('real stderr still takes precedence when present', POSIX_SHIM, async () => {
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

// ── stderr as a first-class log stream ──────────────────────────────────────
// Retry/throttle notices (429/529) and subprocess chatter land on stderr even on
// runs that go on to SUCCEED, where the exit-code path above never reads them.

/** Write a fake `claude` from raw /bin/sh lines (finer control than fakeBin). */
async function fakeShell(dir, body) {
  const path = join(dir, 'fake-claude-sh.sh');
  await writeFile(path, ['#!/bin/sh', ...body].join('\n') + '\n', 'utf8');
  await chmod(path, 0o755);
  return path;
}

const stderrEvents = (events) => events.filter((e) => e.type === 'stderr');

test('stderr lines are emitted as stream:"err" events on a SUCCESSFUL run', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const bin = await fakeShell(dir, [
    `printf '%s\\n' 'Overloaded, retrying in 4s' 1>&2`,
    `printf '%s\\n' '{"type":"result","result":"done"}'`,
    'exit 0',
  ]);
  const events = [];
  const out = await runClaude({ bin, prompt: 'hi', cwd: dir, onEvent: (e) => events.push(e) });
  assert.equal(out.exitCode, 0, 'the run still succeeds');
  assert.deepEqual(stderrEvents(events), [
    { type: 'stderr', stream: 'err', text: 'Overloaded, retrying in 4s' },
  ]);
});

test('each stderr line is its own event, blank lines dropped', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const bin = await fakeShell(dir, [
    `printf '%s\\n\\n%s\\n' 'first' 'second' 1>&2`,
    'exit 0',
  ]);
  const events = [];
  await runClaude({ bin, prompt: 'hi', cwd: dir, onEvent: (e) => events.push(e) });
  assert.deepEqual(stderrEvents(events).map((e) => e.text), ['first', 'second']);
});

test('a final stderr line with NO trailing newline is still emitted', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  // printf without \n: the line only exists in the carry buffer until close.
  const bin = await fakeShell(dir, [`printf '%s' 'no trailing newline' 1>&2`, 'exit 0']);
  const events = [];
  await runClaude({ bin, prompt: 'hi', cwd: dir, onEvent: (e) => events.push(e) });
  assert.deepEqual(stderrEvents(events).map((e) => e.text), ['no trailing newline']);
});

test('a line split across write boundaries is reassembled, not torn in two', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  // Two writes, one logical line: the carry buffer must hold "one half " until
  // the newline arrives with the second write.
  const bin = await fakeShell(dir, [
    `printf '%s' 'one half ' 1>&2`,
    'sleep 0.2',
    `printf '%s\\n' 'and the rest' 1>&2`,
    'exit 0',
  ]);
  const events = [];
  await runClaude({ bin, prompt: 'hi', cwd: dir, onEvent: (e) => events.push(e) });
  assert.deepEqual(stderrEvents(events).map((e) => e.text), ['one half and the rest']);
});

test('a multi-byte UTF-8 character split across write boundaries is not torn into U+FFFD', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  // '…' is E2 80 A6: write E2 80, then A6 + newline in a second write.
  const bin = await fakeShell(dir, [
    `printf '\\342\\200' 1>&2`,
    'sleep 0.2',
    `printf '\\246\\n' 1>&2`,
    'exit 0',
  ]);
  const events = [];
  await runClaude({ bin, prompt: 'hi', cwd: dir, onEvent: (e) => events.push(e) });
  assert.deepEqual(stderrEvents(events).map((e) => e.text), ['…']);
});

test('CR-rewriting progress output is framed live, one event per update', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const bin = await fakeShell(dir, [`printf '10%%\\r20%%\\r30%%\\n' 1>&2`, 'exit 0']);
  const events = [];
  await runClaude({ bin, prompt: 'hi', cwd: dir, onEvent: (e) => events.push(e) });
  assert.deepEqual(stderrEvents(events).map((e) => e.text), ['10%', '20%', '30%']);
});

test('the exit-code stderr detail also survives chunk-split multi-byte characters', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const bin = await fakeShell(dir, [
    `printf '\\342\\200' 1>&2`, 'sleep 0.2', `printf '\\246\\n' 1>&2`, 'exit 1',
  ]);
  await assert.rejects(() => runClaude({ bin, prompt: 'hi', cwd: dir }), (err) => {
    assert.match(err.message, /…/);
    assert.doesNotMatch(err.message, /�/);
    return true;
  });
});

test('the non-zero-exit error is marked stream:"err" only when stderr fed it', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const fromStderr = await fakeBin(dir, { code: 1, stderr: 'boom from stderr' });
  await assert.rejects(
    () => runClaude({ bin: fromStderr, prompt: 'hi', cwd: dir }),
    (err) => { assert.equal(err.stream, 'err'); return true; },
  );

  const dir2 = await makeTmpDir();
  const fromStdout = await fakeBin(dir2, {
    code: 1,
    stdout: '{"type":"result","is_error":true,"result":"Not logged in"}',
  });
  await assert.rejects(
    () => runClaude({ bin: fromStdout, prompt: 'hi', cwd: dir2 }),
    (err) => {
      assert.equal(err.stream, undefined, 'a stdout-borne failure is not an stderr line');
      return true;
    },
  );
});

test('stderr chatter after an abort is not logged into a paused run', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  // `exec` replaces the shell with sleep, so the runner's SIGTERM hits the
  // process actually holding the stderr pipe — without it an orphaned sleep
  // keeps the pipe open and `close` (and this test) stalls the full 5s.
  const bin = await fakeShell(dir, [
    `printf '%s' 'torn half-line' 1>&2`,   // no newline: only flushed when the stream ends
    'exec sleep 5',
  ]);
  const ac = new AbortController();
  const events = [];
  const p = runClaude({ bin, prompt: 'hi', cwd: dir, signal: ac.signal, onEvent: (e) => events.push(e) });
  setTimeout(() => ac.abort(), 250);
  await assert.rejects(p, (err) => { assert.equal(err.name, 'AbortError'); return true; });
  assert.deepEqual(stderrEvents(events), [], 'the torn fragment must not surface as a warn line');
});

test('the non-zero-exit detail is tail-capped so err.message stays bounded', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const bin = await fakeShell(dir, [
    `i=0; while [ $i -lt 300 ]; do printf 'chatter line %s padded padded padded padded\\n' $i 1>&2; i=$((i+1)); done`,
    `printf '%s\\n' 'FINAL CAUSE: boom' 1>&2`,
    'exit 1',
  ]);
  await assert.rejects(() => runClaude({ bin, prompt: 'hi', cwd: dir }), (err) => {
    assert.ok(err.message.length < 2200, `message stays bounded (got ${err.message.length})`);
    assert.match(err.message, /FINAL CAUSE: boom/, 'the tail — the actual cause — survives');
    assert.equal(err.stream, 'err');
    return true;
  });
});

// ── recovery classification must see the WHOLE stderr stream, not the capped tail ──
// classifyError is message-based; the tail cap above means a recovery marker
// printed before hundreds of chatter lines vanishes from err.message. The runner
// therefore classifies line-by-line as stderr streams (surviving the rolling
// buffer trim) and stamps err.errorClass; classifyError() returns the stamp.

test('a usage-limit marker that scrolled past the tail cap still classifies', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const bin = await fakeShell(dir, [
    `printf '%s\\n' "You've hit your session limit · resets 6pm (Europe/Sofia)" 1>&2`,
    `i=0; while [ $i -lt 300 ]; do printf 'chatter line %s padded padded padded padded\\n' $i 1>&2; i=$((i+1)); done`,
    'exit 1',
  ]);
  await assert.rejects(() => runClaude({ bin, prompt: 'hi', cwd: dir }), (err) => {
    assert.ok(err.message.length < 2200, `message stays bounded (got ${err.message.length})`);
    assert.doesNotMatch(err.message, /session limit/, 'precondition: the marker really scrolled past the cap');
    assert.equal(err.errorClass, 'usage_limit', 'class stamped from the full stream');
    assert.equal(classifyError(err), 'usage_limit', 'the orchestrator route pauses instead of hard-failing');
    return true;
  });
});

test('an early auth error is not misrouted to network by connection chatter in the tail', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const bin = await fakeShell(dir, [
    `printf '%s\\n' 'API Error: 401 Invalid authentication credentials' 1>&2`,
    `i=0; while [ $i -lt 300 ]; do printf 'MCP chatter %s: connection reset by peer, retrying\\n' $i 1>&2; i=$((i+1)); done`,
    'exit 1',
  ]);
  await assert.rejects(() => runClaude({ bin, prompt: 'hi', cwd: dir }), (err) => {
    assert.equal(err.errorClass, 'auth', 'auth outranks the network chatter that filled the tail');
    assert.equal(classifyError(err), 'auth');
    return true;
  });
});

test('a long stdout is_error detail keeps its class when the marker is capped away', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const detail = 'Not logged in · Please run /login. ' + 'chatter '.repeat(400); // marker at HEAD, > cap
  const bin = await fakeBin(dir, {
    code: 1,
    stdout: JSON.stringify({ type: 'result', is_error: true, result: detail }),
  });
  await assert.rejects(() => runClaude({ bin, prompt: 'hi', cwd: dir }), (err) => {
    assert.doesNotMatch(err.message, /Not logged in/, 'precondition: marker capped out of the message');
    assert.equal(err.errorClass, 'auth', 'classified against the full errorDetail, not the capped message');
    assert.equal(err.stream, undefined, 'stdout-borne failure is still not stream:err');
    return true;
  });
});

// An unspawnable CLI (not installed / not on PATH) is user-fixable, not a
// pipeline bug: the spawn failure must carry a recovery class so the
// orchestrator's gate pauses the run for manual resume instead of hard-failing.
test('spawn failure (ENOENT) stamps errorClass so the run can pause, not hard-fail', async () => {
  const dir = await makeTmpDir();
  const bin = join(dir, 'no-such-claude');
  await assert.rejects(() => runClaude({ bin, prompt: 'hi', cwd: dir }), (err) => {
    assert.match(err.message, /ENOENT/, 'the spawn cause stays in the message');
    assert.equal(err.errorClass, 'network', 'unspawnable CLI is stamped recoverable');
    assert.equal(classifyError(err), 'network', 'the stamp is authoritative for the gate');
    return true;
  });
});
