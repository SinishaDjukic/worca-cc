// test/npm-command.test.mjs
// How worca starts npm (Node DEP0190): never an args array together with `shell: true`. POSIX runs
// `npm` directly; Windows runs npm's own npm-cli.js with node, or one quoted command line. No real npm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { npmCommand, runNpm } from '../src/core/npm-command.mjs';

const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const CLI = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
const win = (o = {}) => ({ platform: 'win32', env: {}, execPath: NODE, exists: () => false, ...o });

test('POSIX: plain npm with an args array and no shell', () => {
  for (const platform of ['linux', 'darwin']) {
    assert.deepEqual(npmCommand(['root', '-g'], { platform, env: { npm_execpath: '/x/npm-cli.js' }, exists: () => true }),
      { file: 'npm', args: ['root', '-g'], shell: false });
  }
});

test('win32: npm-cli.js beside node runs with node, no shell', () => {
  const seen = [];
  const c = npmCommand(['root', '-g'], win({ exists: (p) => { seen.push(p); return p === CLI; } }));
  assert.deepEqual(c, { file: NODE, args: [CLI, 'root', '-g'], shell: false });
  assert.deepEqual(seen, [CLI]);
});

test('win32: npm_execpath wins when it is an existing npm-cli.js; another package manager or a missing file does not', () => {
  const own = 'D:\\npm\\node_modules\\npm\\bin\\npm-cli.js';
  assert.deepEqual(npmCommand(['prefix', '-g'], win({ env: { npm_execpath: own }, exists: (p) => p === own || p === CLI })),
    { file: NODE, args: [own, 'prefix', '-g'], shell: false });
  const pnpm = 'D:\\pnpm\\bin\\pnpm.cjs';
  assert.deepEqual(npmCommand(['prefix', '-g'], win({ env: { npm_execpath: pnpm }, exists: () => true })).args[0], CLI);
  assert.deepEqual(npmCommand(['prefix', '-g'], win({ env: { npm_execpath: own }, exists: (p) => p === CLI })).args[0], CLI);
});

test('win32 without npm-cli.js: ONE command line through the shell, no args array; arguments are quoted for cmd.exe', () => {
  assert.deepEqual(npmCommand(['root', '-g'], win()), { file: 'npm root -g', args: null, shell: true });
  assert.equal(npmCommand(['install', '-g', '@worca/app@1.14.0'], win()).file, 'npm install -g @worca/app@1.14.0');
  assert.equal(npmCommand(['--prefix', 'C:\\My Apps\\x\\', ''], win()).file, 'npm --prefix "C:\\My Apps\\x\\\\" ""');
  for (const bad of ['a&b', '50%', 'x"y', 'a|b', 'a^b', 'a!b', '<x', 'x>']) {
    assert.throws(() => npmCommand(['install', bad], win()), /cmd\.exe/, bad);
  }
});

test('runNpm: the exec call never carries an args array with shell true, and keeps the caller\'s options', async () => {
  const calls = [];
  const exec = async (...a) => { calls.push(a); return { stdout: 'ok' }; };
  const opts = { cwd: '/w', timeout: 5, shell: true };
  await runNpm(exec, ['ci'], opts, { platform: 'linux' });
  await runNpm(exec, ['ci'], opts, win({ exists: () => true }));
  await runNpm(exec, ['ci'], opts, win());
  assert.deepEqual(calls, [
    ['npm', ['ci'], { cwd: '/w', timeout: 5, shell: false }],
    [NODE, [CLI, 'ci'], { cwd: '/w', timeout: 5, shell: false }],
    ['npm ci', undefined, { cwd: '/w', timeout: 5, shell: true }],
  ]);
  assert.equal(calls.length, 3);
  for (const [, args, o] of calls) assert.ok(!(Array.isArray(args) && o.shell), 'DEP0190');
  assert.deepEqual(opts, { cwd: '/w', timeout: 5, shell: true }, 'the caller\'s options object is not changed');
});
