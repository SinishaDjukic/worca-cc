// test/claude-runner-sigkill-grace.test.mjs
// Abort = SIGTERM, then SIGKILL after a grace. Claude Code shuts down with
// synchronous fsync'd saves of ~/.claude.json; a SIGKILL landing inside one
// strands ~/.claude.json.tmp.<pid>.<hex> (2026-08-30: 2099 files / 4.4 GB from
// test runs under IO load). The grace must be generous by default and
// overridable so a wedged child can still be exercised quickly here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaude, DEFAULT_SIGKILL_GRACE_MS, sigkillGraceMs } from '../src/core/claude-runner.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'trap/exec shim is POSIX sh' : false };

function restore(name, prev) {
  if (prev === undefined) delete process.env[name]; else process.env[name] = prev;
}

test('default SIGTERM→SIGKILL grace is 5 s; WORCA_SIGKILL_GRACE_MS overrides it', () => {
  const prev = process.env.WORCA_SIGKILL_GRACE_MS;
  try {
    delete process.env.WORCA_SIGKILL_GRACE_MS;
    assert.equal(DEFAULT_SIGKILL_GRACE_MS, 5000);
    assert.equal(sigkillGraceMs(), 5000);
    process.env.WORCA_SIGKILL_GRACE_MS = '200';
    assert.equal(sigkillGraceMs(), 200);
    process.env.WORCA_SIGKILL_GRACE_MS = 'garbage';
    assert.equal(sigkillGraceMs(), 5000, 'unparseable ⇒ default');
    process.env.WORCA_SIGKILL_GRACE_MS = '-1';
    assert.equal(sigkillGraceMs(), 5000, 'negative ⇒ default');
  } finally { restore('WORCA_SIGKILL_GRACE_MS', prev); }
});

test('a child that ignores SIGTERM is SIGKILLed after the overridden grace, not the old 1.5 s', POSIX, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-grace-'));
  const bin = join(dir, 'fake-claude-wedged.sh');
  // exec keeps TERM ignored (SIG_IGN survives exec) and leaves no orphan holding the pipes.
  writeFileSync(bin, '#!/bin/sh\ntrap "" TERM\nexec sleep 30\n');
  chmodSync(bin, 0o755);
  const prevMock = process.env.WORCA_MOCK;
  const prevGrace = process.env.WORCA_SIGKILL_GRACE_MS;
  delete process.env.WORCA_MOCK;
  process.env.WORCA_SIGKILL_GRACE_MS = '200';
  const ac = new AbortController();
  const t0 = Date.now();
  setTimeout(() => ac.abort(), 300);
  try {
    await assert.rejects(
      runClaude({ cwd: dir, prompt: 'x', bin, signal: ac.signal, onEvent: () => {} }),
      (e) => e.name === 'AbortError',
    );
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 1200, `escalated after ~300+200 ms, got ${elapsed} ms (the old fixed 1500 ms grace would be ≥ 1800)`);
  } finally {
    restore('WORCA_MOCK', prevMock);
    restore('WORCA_SIGKILL_GRACE_MS', prevGrace);
    rmSync(dir, { recursive: true, force: true });
  }
});
