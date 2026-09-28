// test/git-push-retry.test.mjs
// Ship's push (git-info.mjs pushBranch) when the remote cannot read the pack git sent
// (worca-01, 2026-09-27: "remote: error: inflate: data stream error (invalid block type) …
// pack has bad object at offset 7126 … remote unpack failed: index-pack failed"): one more
// push, after any running `git gc` in the repository finished, as a self-contained pack.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pushBranch, isRemotePackFailure, _testing } from '../src/core/git-info.mjs';

const WORCA01 = 'remote: error: inflate: data stream error (invalid block type)\nremote: fatal: pack has bad object at offset 7126: inflate returned -3\nerror: remote unpack failed: index-pack failed\nTo https://github.com/SinishaDjukic/worca-cc.git\n ! [remote rejected] worca-cc/show-mock-mode-in-the-ui-4fae3c66 -> worca-cc/show-mock-mode-in-the-ui-4fae3c66 (failed)\nerror: failed to push some refs to \'https://github.com/SinishaDjukic/worca-cc.git\'';

afterEach(() => _testing.reset());

function runner(script, calls, gitDir) {
  return async (cmd, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'rev-parse' && args[1] === '--git-common-dir') return { ok: true, stdout: `${gitDir}\n`, stderr: '' };
    if (args[0] === 'remote') return { ok: true, stdout: 'https://github.com/o/r.git\n', stderr: '' };
    if (args[0] === 'push') return script.shift() || { ok: true, stdout: '', stderr: '' };
    return { ok: true, stdout: '', stderr: '' };
  };
}

test('the signature: what the remote says when it cannot read the pack', () => {
  assert.equal(isRemotePackFailure(WORCA01), true);
  assert.equal(isRemotePackFailure('error: remote unpack failed: unpacker error'), true);
  assert.equal(isRemotePackFailure('fatal: protocol error: bad pack header'), true);
  assert.equal(isRemotePackFailure(' ! [rejected] feat -> feat (non-fast-forward)'), false);
  assert.equal(isRemotePackFailure('remote: Permission to o/r.git denied'), false);
  assert.equal(isRemotePackFailure(''), false);
});

test('a pack the remote could not read is pushed once more, self-contained', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-push-'));
  try {
    const calls = [];
    _testing.setRunner(runner([{ ok: false, stdout: '', stderr: WORCA01 }, { ok: true, stdout: '', stderr: 'To github.com:o/r\n * [new branch] feat -> feat' }], calls, dir));
    const r = await pushBranch(dir, 'feat', 'origin');
    assert.equal(r.ok, true);
    assert.equal(r.retried, true);
    const pushes = calls.filter((c) => c.startsWith('push'));
    assert.deepEqual(pushes, ['push -u origin feat', 'push --no-thin -u origin feat']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('any other push failure is not retried', async () => {
  const calls = [];
  _testing.setRunner(runner([{ ok: false, stdout: '', stderr: ' ! [rejected] feat -> feat (non-fast-forward)' }], calls, '/nonexistent'));
  const r = await pushBranch('/tmp', 'feat', 'origin');
  assert.equal(r.ok, false);
  assert.equal(r.retried, undefined);
  assert.equal(calls.filter((c) => c.startsWith('push')).length, 1);
  assert.match(r.stderr, /non-fast-forward/);
});

test('twice unreadable: the error says what was tried and what to check', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-push-'));
  try {
    _testing.setRunner(runner([{ ok: false, stdout: '', stderr: WORCA01 }, { ok: false, stdout: '', stderr: WORCA01 }], [], dir));
    const r = await pushBranch(dir, 'feat', 'origin');
    assert.equal(r.ok, false);
    assert.equal(r.retried, true);
    assert.match(r.stderr, /pack has bad object/);
    assert.match(r.stderr, /the remote could not read the pack git sent, twice/);
    assert.match(r.stderr, /git fsck --full/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the retry waits while a git gc runs in the repository, and not past the limit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-push-'));
  try {
    // A live gc: this test process's own pid in gc.pid.
    await writeFile(join(dir, 'gc.pid'), `${process.pid} localhost\n`);
    const calls = [];
    _testing.setRunner(runner([{ ok: false, stdout: '', stderr: WORCA01 }, { ok: true, stdout: '', stderr: '' }], calls, dir));
    let slept = 0;
    const t0 = Date.now();
    const r = await pushBranch(dir, 'feat', 'origin', { gcWait: { maxMs: 50, stepMs: 10, sleep: async (ms) => { slept += ms; await new Promise((res) => setTimeout(res, ms)); } } });
    assert.equal(r.ok, true);
    assert.ok(slept >= 30, `waited for the gc (${slept}ms)`);
    assert.ok(Date.now() - t0 < 2_000, 'and gave up at the limit');
    // A stale gc.pid (no such process) is not waited on.
    await writeFile(join(dir, 'gc.pid'), '999999999 localhost\n');
    slept = 0;
    _testing.setRunner(runner([{ ok: false, stdout: '', stderr: WORCA01 }, { ok: true, stdout: '', stderr: '' }], [], dir));
    await pushBranch(dir, 'feat', 'origin', { gcWait: { maxMs: 50, stepMs: 10, sleep: async (ms) => { slept += ms; } } });
    assert.equal(slept, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
