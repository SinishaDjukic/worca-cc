// test/preflight-npm-claude-resolve.test.mjs — npm-installed Claude Code on
// native Windows: the `claude.cmd` shim on PATH is unspawnable by Node, but the
// package's native claude.exe sits at npm's fixed layout next to it. Worca
// resolves and spawns that .exe directly; the remaining unsupported cases get
// an actionable explanation.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveClaudeBin, explainUnspawnableClaude, isNativeExe, NPM_CLAUDE_EXE_SEGMENTS, _testing,
} from '../src/core/preflight.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';

const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };

const NPM = 'C:\\Users\\u\\AppData\\Roaming\\npm';
const SHIM = join(NPM, 'claude.cmd');
const EXE = join(NPM, ...NPM_CLAUDE_EXE_SEGMENTS);
const WIN = { platform: 'win32', pathEnv: `C:\\Windows;${NPM}` };
const has = (...paths) => (p) => paths.includes(p);
const nativeIf = (...paths) => (p) => paths.includes(p);

test('NPM_CLAUDE_EXE_SEGMENTS is npm\'s global layout for the package', () => {
  assert.equal(EXE, join(NPM, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
});

test('off Windows: bin is returned unchanged, no note', () => {
  assert.deepEqual(resolveClaudeBin('claude', { platform: 'darwin', exists: () => true, isNativeExe: () => true }),
    { bin: 'claude', source: 'as-is', note: null });
});

test('win32 + a real .exe on PATH: unchanged (spawn\'s own lookup is right), even with a shim elsewhere', () => {
  const exe = join('C:\\Users\\u\\.local\\bin', 'claude.exe');
  const r = resolveClaudeBin('claude', { platform: 'win32', pathEnv: `C:\\Users\\u\\.local\\bin;${NPM}`, exists: has(exe, SHIM, EXE), isNativeExe: () => true });
  assert.deepEqual(r, { bin: 'claude', source: 'exe', note: null });
});

test('win32 + only the npm shim, native binary next to it: resolves to that .exe with a note', () => {
  const r = resolveClaudeBin('claude', { ...WIN, exists: has(SHIM, EXE), isNativeExe: nativeIf(EXE) });
  assert.equal(r.bin, EXE);
  assert.equal(r.source, 'npm');
  assert.match(r.note, /npm-installed Claude Code binary/);
  assert.ok(r.note.includes(EXE) && r.note.includes('"claude"'));
  // …and there is nothing to explain: the spawn will succeed.
  assert.equal(explainUnspawnableClaude('claude', { ...WIN, exists: has(SHIM, EXE), isNativeExe: nativeIf(EXE) }), null);
});

test('WORCA_CLAUDE_BIN pointing at the .cmd explicitly resolves relative to the shim\'s own dir', () => {
  const r = resolveClaudeBin(SHIM, { ...WIN, pathEnv: '', exists: has(SHIM, EXE), isNativeExe: nativeIf(EXE) });
  assert.equal(r.bin, EXE);
});

test('shim + placeholder binary (postinstall never ran): unchanged, and the explanation names install.cjs', () => {
  const r = resolveClaudeBin('claude', { ...WIN, exists: has(SHIM, EXE), isNativeExe: () => false });
  assert.deepEqual(r, { bin: 'claude', source: 'as-is', note: null });
  const msg = explainUnspawnableClaude('claude', { ...WIN, exists: has(SHIM, EXE), isNativeExe: () => false });
  assert.match(msg, /placeholder/);
  assert.match(msg, /postinstall did not run/);
  assert.ok(msg.includes(join(NPM, 'node_modules', '@anthropic-ai', 'claude-code', 'install.cjs')), msg);
});

test('shim with no native binary next to it (non-npm layout): unchanged, and the explanation says what was looked for', () => {
  const r = resolveClaudeBin('claude', { ...WIN, exists: has(SHIM), isNativeExe: () => true });
  assert.equal(r.source, 'as-is');
  const msg = explainUnspawnableClaude('claude', { ...WIN, exists: has(SHIM), isNativeExe: () => true });
  assert.ok(msg.includes(EXE), 'names the path it looked for');
  assert.match(msg, /install\.ps1/);
  assert.match(msg, /WORCA_CLAUDE_BIN/);
});

test('nothing on PATH at all: unchanged and no explanation (a plain ENOENT)', () => {
  assert.equal(resolveClaudeBin('claude', { ...WIN, exists: () => false }).source, 'as-is');
  assert.equal(explainUnspawnableClaude('claude', { ...WIN, exists: () => false }), null);
});

test('isNativeExe: MZ header and real size; the 500-byte text placeholder and a missing file are not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-pe-'));
  try {
    const real = join(dir, 'real.exe');
    writeFileSync(real, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(8192)]));
    const stub = join(dir, 'stub.exe');
    writeFileSync(stub, 'echo "Error: claude native binary not installed." >&2\nexit 1\n');
    const bigText = join(dir, 'big.exe');
    writeFileSync(bigText, '#!/bin/sh\n' + 'x'.repeat(9000));
    assert.equal(isNativeExe(real), true);
    assert.equal(isNativeExe(stub), false);
    assert.equal(isNativeExe(bigText), false);
    assert.equal(isNativeExe(join(dir, 'missing.exe')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── end to end: the runner spawns the resolved binary ────────────────────────
let prevMock, prevOrch, prevPath, platformDesc, dir;
beforeEach(() => {
  prevMock = process.env.WORCA_MOCK; prevOrch = process.env.ORCH_MOCK; prevPath = process.env.PATH;
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
  platformDesc = Object.getOwnPropertyDescriptor(process, 'platform');
  dir = mkdtempSync(join(tmpdir(), 'worca-cc-npmshim-'));
});
afterEach(() => {
  if (prevMock !== undefined) process.env.WORCA_MOCK = prevMock;
  if (prevOrch !== undefined) process.env.ORCH_MOCK = prevOrch;
  process.env.PATH = prevPath;
  Object.defineProperty(process, 'platform', platformDesc);
  _testing.reset();
  rmSync(dir, { recursive: true, force: true });
});

/** npm's global layout in a temp dir: <dir>/<bin>.cmd + the package's bin/claude.exe
 *  (a shell script here — POSIX ignores the extension; the PE check is swapped out). */
function layoutNpmInstall(bin) {
  writeFileSync(join(dir, `${bin}.cmd`), '@echo off\r\n');
  const exe = join(dir, ...NPM_CLAUDE_EXE_SEGMENTS);
  mkdirSync(join(exe, '..'), { recursive: true });
  writeFileSync(exe,
    '#!/bin/sh\n' +
    `printf '%s\\0' "$@" > ${JSON.stringify(join(dir, 'argv.txt'))}\n` +
    `printf '%s\\n' '{"type":"result","result":"ok"}'\nexit 0\n`);
  chmodSync(exe, 0o755);
  return exe;
}

test('runClaude on a faked win32 host spawns the npm package\'s claude.exe instead of failing on the .cmd shim', POSIX_SHIM, async () => {
  const bin = 'worca-fake-claude-npm';
  const exe = layoutNpmInstall(bin);
  process.env.PATH = dir;
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  _testing.set({ isNativeExe: (p) => p === exe });
  const events = [];
  const out = await runClaude({ bin, prompt: 'hi', cwd: dir, onEvent: (e) => events.push(e) });
  assert.equal(out.exitCode, 0);
  assert.ok(existsSync(join(dir, 'argv.txt')), 'the resolved binary ran');
  const argv = readFileSync(join(dir, 'argv.txt'), 'utf8').split('\0').filter(Boolean);
  assert.deepEqual(argv.slice(0, 2), ['-p', 'hi']);
});

test('runClaude on a faked win32 host with the placeholder binary: ENOENT carries the postinstall explanation', async () => {
  const bin = 'worca-fake-claude-stub';
  layoutNpmInstall(bin);
  process.env.PATH = dir;
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  _testing.set({ isNativeExe: () => false });        // "still the placeholder"
  await assert.rejects(
    runClaude({ bin, prompt: 'hi', cwd: dir, onEvent: () => {} }),
    (err) => /ENOENT/.test(err.message) && /postinstall did not run/.test(err.message) && /install\.cjs/.test(err.message),
  );
});
