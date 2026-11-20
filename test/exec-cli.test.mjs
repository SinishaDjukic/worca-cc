// test/exec-cli.test.mjs — execCli: the one execFile engine CLI probes go through.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execCli, cliRefusal, _testing } from '../src/core/engines/exec-cli.mjs';
import { _testing as resolverTesting } from '../src/core/cli-resolve.mjs';
import { GEMINI_CLI } from '../src/core/engines/cli-specs.mjs';

const savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const savedPath = process.env.PATH;
afterEach(() => {
  _testing.reset(); resolverTesting.reset();
  Object.defineProperty(process, 'platform', savedPlatform);
  process.env.PATH = savedPath;
});

const run = (bin = 'gemini', args = [], options = {}) => new Promise((resolve) => execCli(GEMINI_CLI, bin, args, options, resolve));
const enoent = (f, a, o, cb) => cb(Object.assign(new Error('x'), { code: 'ENOENT' }), '', '');

test('off win32 the bin and args go to execFile as given, with windowsHide', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  const calls = [];
  _testing.set({ execFile: (file, args, options, cb) => { calls.push([file, args, options]); cb(null, 'ok', ''); } });
  await run('gemini', ['--version'], { timeout: 5 });
  assert.deepEqual(calls, [['gemini', ['--version'], { windowsHide: true, timeout: 5 }]]);
});

test('an ENOENT is tagged with the resolver explanation, and cliRefusal replaces the install tail with it', async () => {
  _testing.set({ execFile: enoent, explain: (bin, spec) => `hint for ${spec.id}:${bin}` });
  const err = await run();
  assert.equal(err.cliHint, 'hint for gemini:gemini');
  const text = cliRefusal({ bin: 'gemini', err, install: 'npm i -g @google/gemini-cli' });
  assert.equal(text, 'cannot run gemini (ENOENT) — hint for gemini:gemini');
  assert.ok(!text.includes('npm i -g'));
});

test('no shim found: cliRefusal keeps the site\'s install tail verbatim', async () => {
  _testing.set({ execFile: enoent, explain: () => null });
  const err = await run();
  assert.equal(cliRefusal({ bin: 'gemini', err, install: 'install it' }), 'cannot run gemini (ENOENT) — install it');
});

test('a synchronous throw from execFile reaches the callback, tagged', async () => {
  _testing.set({ execFile: () => { throw Object.assign(new Error('EINVAL'), { code: 'EINVAL' }); }, explain: () => 'why' });
  const err = await run();
  assert.equal(err.code, 'EINVAL');
  assert.equal(err.cliHint, 'why');
});

test('win32 pure-JS shim: execFile receives node + the entry script + the args', async () => {
  const shimText = [
    'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', ')',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\g.js" %*',
  ].join('\r\n');
  resolverTesting.set({ readFile: () => shimText });
  const seen = [];
  _testing.set({ execFile: (f, a, o, cb) => { seen.push([f, a, o.windowsHide]); cb(null, '', ''); } });
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-execcli-'));
  try {
    writeFileSync(join(dir, 'gemini.cmd'), '');
    writeFileSync(join(dir, 'g.js'), '');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    process.env.PATH = dir;
    await run('gemini', ['--version']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0][1], [join(dir, 'g.js'), '--version']);
  assert.equal(seen[0][2], true);
});
