// test/preflight-windows-claude-hint.test.mjs — the actionable explanation for
// "spawn claude ENOENT" on native Windows with an npm-installed Claude Code
// (PATH resolves .exe only; Node refuses .cmd/.bat shims without a shell).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explainUnspawnableClaude } from '../src/core/preflight.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';

const POSIX_ONLY = { skip: process.platform === 'win32' ? 'exercises the POSIX branch of a platform switch' : false };

const has = (...paths) => (p) => paths.includes(p);
const WIN = { platform: 'win32', pathEnv: 'C:\\Windows;C:\\Users\\u\\AppData\\Roaming\\npm' };
const SHIM = join('C:\\Users\\u\\AppData\\Roaming\\npm', 'claude.cmd');

test('POSIX: never explains — the OS error stands on its own', () => {
  assert.equal(explainUnspawnableClaude('claude', { platform: 'darwin', pathEnv: '/usr/bin', exists: () => true }), null);
  assert.equal(explainUnspawnableClaude('claude', { platform: 'linux', pathEnv: '/usr/bin', exists: () => true }), null);
});

test('win32 + only claude.cmd on PATH: names the shim, the native installer and WORCA_CLAUDE_BIN', () => {
  const msg = explainUnspawnableClaude('claude', { ...WIN, exists: has(SHIM) });
  assert.ok(msg, 'must explain');
  assert.ok(msg.includes(SHIM), 'names the shim it found');
  assert.match(msg, /install\.ps1/);
  assert.match(msg, /WORCA_CLAUDE_BIN/);
  assert.match(msg, /claude\.exe/);
});

test('win32 + claude.exe reachable on PATH: not this problem (null)', () => {
  const exe = join('C:\\Users\\u\\.local\\bin', 'claude.exe');
  const o = { platform: 'win32', pathEnv: 'C:\\Users\\u\\.local\\bin;C:\\Users\\u\\AppData\\Roaming\\npm', exists: has(exe, SHIM) };
  assert.equal(explainUnspawnableClaude('claude', o), null);
});

test('win32 + nothing on PATH at all: null (a plain "not installed" ENOENT)', () => {
  assert.equal(explainUnspawnableClaude('claude', { ...WIN, exists: () => false }), null);
});

test('win32 + WORCA_CLAUDE_BIN pointing at a .cmd explicitly: explains (Node would EINVAL it)', () => {
  const msg = explainUnspawnableClaude(SHIM, { ...WIN, exists: has(SHIM) });
  assert.ok(msg && msg.includes(SHIM));
  // …but an explicit .exe path that is missing is a real ENOENT, not the shim story.
  assert.equal(explainUnspawnableClaude('C:\\x\\claude.exe', { ...WIN, exists: () => false }), null);
});

test('malformed bin falls back to "claude" and never throws', () => {
  assert.equal(explainUnspawnableClaude('', { ...WIN, exists: () => false }), null);
  assert.equal(explainUnspawnableClaude(undefined, { ...WIN, exists: () => { throw new Error('boom'); } }), null);
});

// Wiring: runClaude's spawn-failure error carries the hint when the host looks
// like win32 (platform + PATH faked; a real .cmd shim sits in a temp dir).
let prevMock, prevOrch, prevPath, platformDesc, dir;
beforeEach(() => {
  prevMock = process.env.WORCA_MOCK; prevOrch = process.env.ORCH_MOCK; prevPath = process.env.PATH;
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
  platformDesc = Object.getOwnPropertyDescriptor(process, 'platform');
  dir = mkdtempSync(join(tmpdir(), 'worca-cc-shim-'));
});
afterEach(() => {
  if (prevMock !== undefined) process.env.WORCA_MOCK = prevMock;
  if (prevOrch !== undefined) process.env.ORCH_MOCK = prevOrch;
  process.env.PATH = prevPath;
  Object.defineProperty(process, 'platform', platformDesc);
  rmSync(dir, { recursive: true, force: true });
});

test('runClaude: ENOENT on a bare name whose only PATH hit is a .cmd shim → error carries the explanation', async () => {
  const bin = 'worca-fake-claude-shim';
  writeFileSync(join(dir, `${bin}.cmd`), '@echo off\r\n');
  process.env.PATH = dir;                                      // single entry: no ; vs : ambiguity
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  await assert.rejects(
    runClaude({ bin, prompt: 'hi', cwd: dir, onEvent: () => {} }),
    (err) => /ENOENT/.test(err.message) && err.message.includes(join(dir, `${bin}.cmd`)) && /WORCA_CLAUDE_BIN/.test(err.message),
  );
});

test('runClaude: the same ENOENT on POSIX stays the plain OS error', POSIX_ONLY, async () => {
  const bin = 'worca-fake-claude-shim';
  writeFileSync(join(dir, `${bin}.cmd`), '@echo off\n');
  process.env.PATH = dir;
  await assert.rejects(
    runClaude({ bin, prompt: 'hi', cwd: dir, onEvent: () => {} }),
    (err) => /ENOENT/.test(err.message) && !/WORCA_CLAUDE_BIN/.test(err.message),
  );
});
