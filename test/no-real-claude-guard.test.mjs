// test/no-real-claude-guard.test.mjs
// The PATH guard that keeps `npm test` hermetic: package.json prepends
// test/helpers/no-real-claude to PATH, so any bare `claude` lookup (a caller that
// forgot claude:{mock}/claude:{bin}/WORCA_MOCK/WORCA_CLAUDE_BIN) hits the shim
// instead of the developer's real Claude Code binary. 2026-08-30: the title kickoff
// did exactly that 157x per suite run — real haiku calls, ~/.claude.json bloat and
// 4.4 GB of stranded ~/.claude.json.tmp.* files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SHIM_DIR = resolve('test/helpers/no-real-claude');
const SHIM = join(SHIM_DIR, 'claude');
const ASSERT = join(SHIM_DIR, 'assert-none.mjs');
const POSIX = { skip: process.platform === 'win32' ? 'the guard is a POSIX sh script' : false };
const UNDER_NPM_TEST = { skip: process.env.npm_lifecycle_event === 'test' ? false : 'only meaningful under `npm test`' };

function withLog(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-guard-'));
  const log = join(dir, 'spawns.log');
  try { return fn(log, { ...process.env, WORCA_NO_REAL_CLAUDE_LOG: log }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test('under `npm test` the guard dir is first on PATH', UNDER_NPM_TEST, () => {
  const head = (process.env.PATH || '').split(':')[0];
  assert.equal(resolve(head), SHIM_DIR);
});

test('guard answers --version and --help like a capable build and logs nothing', POSIX, () => {
  withLog((log, env) => {
    const v = spawnSync(SHIM, ['--version'], { env, encoding: 'utf8' });
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stdout, /^\d+\.\d+\.\d+ \(Claude Code\)/, 'probeClaudeCapabilities parses a semver here');
    const h = spawnSync(SHIM, ['--help'], { env, encoding: 'utf8' });
    assert.equal(h.status, 0, h.stderr);
    assert.ok(h.stdout.includes('--mcp-config'), 'probeClaudeCapabilities reads this flag from --help');
    assert.equal(existsSync(log), false, 'probes are not real spawns');
  });
});

test('guard refuses a prompt run with exit 97 and logs the invocation', POSIX, () => {
  withLog((log, env) => {
    const r = spawnSync(SHIM, ['-p', 'Write the title for this task:\n\nx', '--output-format', 'stream-json'],
      { env, encoding: 'utf8' });
    assert.equal(r.status, 97);
    assert.match(r.stderr, /REAL claude binary/);
    const entry = readFileSync(log, 'utf8');
    assert.match(entry, /\targs=-p Write the title/);
    assert.match(entry, new RegExp(`\\tpid=\\d+\\tppid=${process.pid}\\t`), 'ppid is the spawning test process');
  });
});

test('assert-none exits 0 when no spawn was logged and 1 (naming the offenders) otherwise', () => {
  withLog((log, env) => {
    const clean = spawnSync(process.execPath, [ASSERT], { env, encoding: 'utf8' });
    assert.equal(clean.status, 0, clean.stderr);
    writeFileSync(log, '2026-08-30T00:00:00Z\tpid=1\tppid=2\tcwd=/x\targs=-p hi\n');
    const dirty = spawnSync(process.execPath, [ASSERT], { env, encoding: 'utf8' });
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /1 test spawn\(s\) reached the real-claude guard/);
    assert.match(dirty.stderr, /args=-p hi/);
  });
});
