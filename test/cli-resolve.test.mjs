// test/cli-resolve.test.mjs — the shared engine-CLI resolver (src/core/cli-resolve.mjs):
// a Windows npm `.cmd` shim becomes a spawnable program (native .exe or `node <script>`),
// never a shell. Everything is injected (platform/PATH/fs), so no Windows host is needed.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  resolveCliBin, resolveCliCommand, explainUnspawnableCli, parseShim, cliReady, GENERIC_CLI, _testing,
} from '../src/core/cli-resolve.mjs';
import { COPILOT_CLI, CODEX_CLI, GEMINI_CLI } from '../src/core/engines/cli-specs.mjs';

afterEach(() => _testing.reset());

const NPM = 'C:\\Users\\u\\AppData\\Roaming\\npm';
const WIN = { platform: 'win32', pathEnv: `C:\\Windows;${NPM}`, arch: 'x64', execPath: 'C:\\node\\node.exe' };
const has = (...paths) => (p) => paths.includes(p);
const SHIM = join(NPM, 'copilot.cmd');
const COPILOT_NESTED = join(NPM, 'node_modules', '@github', 'copilot', 'node_modules', '@github', 'copilot-win32-x64', 'copilot.exe');
const COPILOT_HOISTED = join(NPM, 'node_modules', '@github', 'copilot-win32-x64', 'copilot.exe');

const NODE_SHIM = (target) => `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\n` +
  `IF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\n` +
  `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*\r\n`;
const EXE_SHIM = (target) => `@ECHO off\r\nSET dp0=%~dp0\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%dp0%\\${target}"   %*\r\n`;
const LEGACY_SHIM = (target) => `@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\${target}" %*\r\n) ELSE (\r\n  @SETLOCAL\r\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n  node  "%~dp0\\${target}" %*\r\n)\r\n`;
const PS1_NODE = (target) => `#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\nif (Test-Path "$basedir/node$exe") {\n  & "$basedir/node$exe"  "$basedir/${target}" $args\n} else {\n  & "node$exe"  "$basedir/${target}" $args\n}\n`;
const PS1_EXE = (target) => `#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n& "$basedir/${target}" $args\n`;

test('a. off win32: as-is, and the filesystem is never touched', () => {
  let calls = 0;
  const exists = () => { calls++; return true; };
  const r = resolveCliBin('copilot', COPILOT_CLI, { platform: 'linux', exists });
  assert.deepEqual(r, { bin: 'copilot', prefixArgs: [], source: 'as-is', note: null, shim: null });
  assert.equal(explainUnspawnableCli('copilot', COPILOT_CLI, { platform: 'darwin', exists }), null);
  assert.equal(calls, 0);
});

test('b. only the npm shim, native copilot.exe nested under it: source npm with a note naming the label', () => {
  const r = resolveCliBin('copilot', COPILOT_CLI, { ...WIN, exists: has(SHIM, COPILOT_NESTED), isNativeExe: has(COPILOT_NESTED) });
  assert.equal(r.source, 'npm');
  assert.equal(r.bin, COPILOT_NESTED);
  assert.deepEqual(r.prefixArgs, []);
  assert.match(r.note, /GitHub Copilot CLI binary/);
  assert.equal(explainUnspawnableCli('copilot', COPILOT_CLI, { ...WIN, exists: has(SHIM, COPILOT_NESTED), isNativeExe: has(COPILOT_NESTED) }), null);
});

test('c. hoisted layout; the host arch is tried first; the first shim WITH a candidate wins while `shim` names the first', () => {
  assert.equal(resolveCliBin('copilot', COPILOT_CLI, { ...WIN, exists: has(SHIM, COPILOT_HOISTED), isNativeExe: () => true }).bin, COPILOT_HOISTED);
  const arm = join(NPM, 'node_modules', '@github', 'copilot', 'node_modules', '@github', 'copilot-win32-arm64', 'copilot.exe');
  const both = resolveCliBin('copilot', COPILOT_CLI, { ...WIN, arch: 'arm64', exists: has(SHIM, COPILOT_NESTED, arm), isNativeExe: () => true });
  assert.equal(both.bin, arm);
  const other = 'D:\\other';
  const shim2 = join(other, 'copilot.cmd');
  const cand2 = join(other, 'node_modules', '@github', 'copilot-win32-x64', 'copilot.exe');
  const r = resolveCliBin('copilot', COPILOT_CLI, { ...WIN, pathEnv: `${NPM};${other}`, exists: has(SHIM, shim2, cand2), isNativeExe: () => true });
  assert.equal(r.bin, cand2);
  assert.equal(r.shim, SHIM);
});

test('d. codex vendor layout expands {triple} for x64 and arm64', () => {
  const vendor = (arch, triple) => join(NPM, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${arch}`, 'vendor', triple, 'codex', 'codex.exe');
  const shim = join(NPM, 'codex.cmd');
  const x64 = resolveCliBin('codex', CODEX_CLI, { ...WIN, exists: has(shim, vendor('x64', 'x86_64-pc-windows-msvc')), isNativeExe: () => true });
  assert.equal(x64.bin, vendor('x64', 'x86_64-pc-windows-msvc'));
  const arm = resolveCliBin('codex', CODEX_CLI, { ...WIN, arch: 'arm64', exists: has(shim, vendor('arm64', 'aarch64-pc-windows-msvc')), isNativeExe: () => true });
  assert.equal(arm.bin, vendor('arm64', 'aarch64-pc-windows-msvc'));
});

test('e. a real .exe later on PATH beats a shim earlier on PATH', () => {
  const exe = join('D:\\bin', 'copilot.exe');
  const r = resolveCliBin('copilot', COPILOT_CLI, { ...WIN, pathEnv: `${NPM};D:\\bin`, exists: has(SHIM, COPILOT_NESTED, exe), isNativeExe: () => true });
  assert.equal(r.source, 'exe');
  assert.equal(r.bin, 'copilot');
});

test('f. a pure-JS shim resolves to node + the entry script; node.exe next to the shim wins, else PATH, else execPath', () => {
  const shim = join(NPM, 'gemini.cmd');
  const script = join(NPM, 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js');
  const readFile = () => NODE_SHIM('node_modules\\@google\\gemini-cli\\bundle\\gemini.js');
  const base = { ...WIN, readFile };
  const viaExecPath = resolveCliBin('gemini', GEMINI_CLI, { ...base, exists: has(shim, script) });
  assert.equal(viaExecPath.source, 'node');
  assert.equal(viaExecPath.bin, 'C:\\node\\node.exe');
  assert.deepEqual(viaExecPath.prefixArgs, [script]);
  assert.match(viaExecPath.note, /as node /);
  const pathNode = join('C:\\Windows', 'node.exe');
  assert.equal(resolveCliBin('gemini', GEMINI_CLI, { ...base, exists: has(shim, script, pathNode) }).bin, pathNode);
  const local = join(NPM, 'node.exe');
  assert.equal(resolveCliBin('gemini', GEMINI_CLI, { ...base, exists: has(shim, script, pathNode, local) }).bin, local);
});

test('g/h. an explicit .exe is unchanged; an explicit .cmd resolves next to itself with an empty PATH', () => {
  assert.equal(resolveCliBin('C:\\x\\copilot.exe', COPILOT_CLI, { ...WIN, exists: () => false }).source, 'exe');
  const r = resolveCliBin(SHIM, COPILOT_CLI, { ...WIN, pathEnv: '', exists: has(SHIM, COPILOT_NESTED), isNativeExe: has(COPILOT_NESTED) });
  assert.equal(r.bin, COPILOT_NESTED);
});

test('i. resolveCliCommand: the prefix comes first, user args follow untouched', () => {
  const shim = join(NPM, 'gemini.cmd');
  const script = join(NPM, 'x', 'g.js');
  const userArgs = ['-p', 'a & b | "c" %PATH%', '--flag'];
  const { file, args } = resolveCliCommand('gemini', userArgs, GEMINI_CLI,
    { ...WIN, exists: has(shim, script), readFile: () => NODE_SHIM('x\\g.js') });
  assert.equal(file, 'C:\\node\\node.exe');
  assert.deepEqual(args, [script, ...userArgs]);
});

test('j/k. a placeholder candidate stays as-is with an explanation naming the path; a resolvable bin explains nothing', () => {
  const o = { ...WIN, exists: has(SHIM, COPILOT_NESTED), isNativeExe: () => false, readFile: () => '' };
  assert.equal(resolveCliBin('copilot', COPILOT_CLI, o).source, 'as-is');
  const msg = explainUnspawnableCli('copilot', COPILOT_CLI, o);
  assert.match(msg, /placeholder/);
  assert.ok(msg.includes(COPILOT_NESTED));
  assert.ok(msg.includes('WORCA_COPILOT_BIN'));
  assert.ok(msg.startsWith(`"copilot" resolves to a script shim (${SHIM}) — the npm install of GitHub Copilot CLI. `));
});

test('l. a shim run by another interpreter stays as-is; the hint names the env var', () => {
  const shim = join(NPM, 'gemini.cmd');
  const target = join(NPM, 'x', 'g.sh');
  const text = NODE_SHIM('x\\g.sh').replace('SET "_prog=node"', 'SET "_prog=sh"');
  const o = { ...WIN, exists: has(shim, target), readFile: () => text };
  assert.equal(resolveCliBin('gemini', GEMINI_CLI, o).source, 'as-is');
  const msg = explainUnspawnableCli('gemini', GEMINI_CLI, o);
  assert.match(msg, /WORCA_GEMINI_BIN/);
  assert.match(msg, /No native binary was found/);
});

test('m. memo: a second uninjected call does no probing; a PATH change re-probes; an unresolved bin is not remembered', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-memo-'));
  const empty = mkdtempSync(join(tmpdir(), 'worca-cc-memo-empty-'));
  mkdirSync(join(dir, 'x'));
  writeFileSync(join(dir, 'zzmemo.cmd'), '');
  writeFileSync(join(dir, 'x', 'z.js'), '');
  let reads = 0;
  _testing.set({ readFile: () => { reads++; return NODE_SHIM('x\\z.js'); } });
  const savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const savedPath = process.env.PATH;
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try {
    process.env.PATH = empty;
    assert.equal(resolveCliBin('zzmemo', GENERIC_CLI).source, 'as-is');
    process.env.PATH = dir;
    assert.equal(resolveCliBin('zzmemo', GENERIC_CLI).source, 'node');   // as-is was not cached
    assert.equal(reads, 1);
    assert.equal(resolveCliBin('zzmemo', GENERIC_CLI).source, 'node');
    assert.equal(reads, 1);                                              // served from the memo
    process.env.PATH = empty;
    assert.equal(resolveCliBin('zzmemo', GENERIC_CLI).source, 'as-is');  // another PATH, another key
  } finally {
    Object.defineProperty(process, 'platform', savedPlatform); process.env.PATH = savedPath;
    rmSync(dir, { recursive: true, force: true }); rmSync(empty, { recursive: true, force: true });
  }
});

test('n. exists / readFile throwing is "absent" — as-is, no hint when no shim was found', () => {
  const boom = () => { throw new Error('boom'); };
  assert.equal(resolveCliBin('copilot', COPILOT_CLI, { ...WIN, exists: boom }).source, 'as-is');
  assert.equal(explainUnspawnableCli('copilot', COPILOT_CLI, { ...WIN, exists: boom }), null);
  const shim = join(NPM, 'gemini.cmd');
  assert.equal(resolveCliBin('gemini', GEMINI_CLI, { ...WIN, exists: has(shim), readFile: boom }).source, 'as-is');
});

test('o. parseShim table', () => {
  assert.deepEqual(parseShim(NODE_SHIM('node_modules\\@github\\copilot\\npm-loader.js'), '.cmd'),
    { kind: 'node', target: 'node_modules\\@github\\copilot\\npm-loader.js' });
  assert.deepEqual(parseShim(EXE_SHIM('node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'), '.cmd'),
    { kind: 'exe', target: 'node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe' });
  assert.deepEqual(parseShim(LEGACY_SHIM('node_modules\\pkg\\cli.js'), '.cmd'), { kind: 'node', target: 'node_modules\\pkg\\cli.js' });
  assert.deepEqual(parseShim(PS1_NODE('node_modules/pkg/cli.js'), '.ps1'), { kind: 'node', target: 'node_modules/pkg/cli.js' });
  assert.deepEqual(parseShim(PS1_EXE('node_modules/pkg/bin/x.exe'), '.ps1'), { kind: 'exe', target: 'node_modules/pkg/bin/x.exe' });
  assert.equal(parseShim('@echo off\r\n', '.cmd'), null);
  assert.equal(parseShim('garbage', '.ps1'), null);
  assert.equal(parseShim(NODE_SHIM('node_modules\\%VAR%\\cli.js'), '.cmd'), null);
  assert.deepEqual(parseShim(NODE_SHIM('a\\b.js').replace('SET "_prog=node"', 'SET "_prog=sh"'), '.cmd'), { kind: 'other', prog: 'sh' });
});

test('cliReady: shim hint, resolvable shim, explicit path and PATH walk', () => {
  const o = (extra) => ({ platform: 'win32', pathEnv: `C:\\Windows;${NPM}`, ...extra });
  const unspawnable = cliReady('copilot', COPILOT_CLI, o({ exists: has(SHIM), readFile: () => '' }));
  assert.equal(unspawnable.ready, false);
  assert.match(unspawnable.hint, /script shim/);
  const ok = cliReady('copilot', COPILOT_CLI, o({ exists: has(SHIM, COPILOT_NESTED), isNativeExe: () => true }));
  assert.deepEqual(ok, { ready: true, bin: COPILOT_NESTED, hint: null });
  assert.equal(cliReady('C:\\x\\tool.cmd', GENERIC_CLI, o({ exists: has('C:\\x\\tool.cmd'), readFile: () => '' })).ready, false);
  assert.equal(cliReady('nothing', GENERIC_CLI, o({ exists: () => false })).ready, false);
});

test('p. memo: a resolution whose target vanished is dropped and probed again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-stale-'));
  mkdirSync(join(dir, 'x'));
  writeFileSync(join(dir, 'zzstale.cmd'), '');
  writeFileSync(join(dir, 'x', 'z.js'), '');
  let reads = 0;
  _testing.set({ readFile: () => { reads++; return NODE_SHIM('x\\z.js'); } });
  const savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const savedPath = process.env.PATH;
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try {
    process.env.PATH = dir;
    assert.equal(resolveCliBin('zzstale', GENERIC_CLI).source, 'node');
    rmSync(join(dir, 'x', 'z.js'));
    assert.equal(resolveCliBin('zzstale', GENERIC_CLI).source, 'as-is');   // stale entry not served
    assert.equal(reads, 2);
  } finally {
    Object.defineProperty(process, 'platform', savedPlatform); process.env.PATH = savedPath;
    rmSync(dir, { recursive: true, force: true });
  }
});
