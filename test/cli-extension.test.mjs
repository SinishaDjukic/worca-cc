// test/cli-extension.test.mjs — `worca extension` (src/cli/extension.mjs): folders, versions, install steps, --open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cmdExtension, openCommand, EXTENSION_HELP } from '../src/cli/extension.mjs';

const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));
const ROOT = '/opt/worca';
const built = (b) => ({ browser: b, path: `${ROOT}/extension/dist/${b}`, present: true, version: '1.12.0' });
const missing = (b) => ({ ...built(b), present: false, version: null });
const ALL = () => ({ version: '1.12.0', builds: ['chrome', 'edge', 'firefox'].map(built) });
const io = () => {
  const lines = [], errs = [], fails = [], opened = [];
  return { out: (s) => lines.push(s), err: (s) => errs.push(s), c: (_n, s) => s, fail: (m) => fails.push(m), open: (p) => opened.push(p), root: ROOT, lines, errs, fails, opened };
};

test('no args: every browser with its absolute path, version and steps; exit 0', async () => {
  const o = io();
  assert.equal(await cmdExtension([], { ...o, info: ALL }), 0);
  const text = o.lines.join('\n');
  assert.match(text, /Worca browser extension 1\.12\.0/);
  for (const b of ['chrome', 'edge', 'firefox']) assert.ok(text.includes(`${ROOT}/extension/dist/${b}`), b);
  assert.match(text, /chrome:\/\/extensions/);
  assert.match(text, /about:debugging/);
  assert.match(text, /unsigned/);
  assert.deepEqual(o.opened, []);
});

test('--browser edge shows only Edge', async () => {
  const o = io();
  assert.equal(await cmdExtension(['--browser', 'edge'], { ...o, info: ALL }), 0);
  const text = o.lines.join('\n');
  assert.ok(text.includes('/extension/dist/edge'));
  assert.ok(!text.includes('/extension/dist/chrome') && !text.includes('/extension/dist/firefox'));
  assert.match(text, /edge:\/\/extensions/);
});

test('--browser=firefox form and an unknown browser (usage error)', async () => {
  const o = io();
  assert.equal(await cmdExtension(['--browser=firefox'], { ...o, info: ALL }), 0);
  const bad = io();
  assert.equal(await cmdExtension(['--browser', 'safari'], { ...bad, info: ALL }), 2);
  assert.match(bad.fails[0], /unknown browser: safari/);
});

test('--open opens the one folder with --browser, extension/dist without', async () => {
  const one = io();
  await cmdExtension(['--browser', 'chrome', '--open'], { ...one, info: ALL });
  assert.deepEqual(one.opened, [`${ROOT}/extension/dist/chrome`]);
  const all = io();
  await cmdExtension(['--open'], { ...all, info: ALL });
  assert.equal(all.opened.length, 1);
  assert.match(all.opened[0], /extension[\\/]dist$/);
});

test('openCommand: Finder, Explorer, xdg-open', () => {
  assert.deepEqual(openCommand('darwin', '/p'), ['open', ['/p']]);
  assert.deepEqual(openCommand('win32', 'C:\\p'), ['explorer', ['C:\\p']]);
  assert.deepEqual(openCommand('linux', '/p'), ['xdg-open', ['/p']]);
});

test('no build: exit 1, points to npm run ext:build, opens nothing', async () => {
  const o = io();
  const none = () => ({ version: '1.12.0', builds: ['chrome', 'edge', 'firefox'].map(missing) });
  assert.equal(await cmdExtension(['--open'], { ...o, info: none }), 1);
  assert.match(o.errs.join('\n'), /not built in \/opt\/worca\. Build it with: npm run ext:build/);
  assert.deepEqual(o.opened, []);
  assert.deepEqual(o.lines, []);
});

test('a missing requested browser alone is "not built" (exit 1); a partial build lists the rest (exit 0)', async () => {
  const partial = () => ({ version: '1.12.0', builds: [built('chrome'), missing('edge'), missing('firefox')] });
  const one = io();
  assert.equal(await cmdExtension(['--browser', 'edge'], { ...one, info: partial }), 1);
  const all = io();
  assert.equal(await cmdExtension([], { ...all, info: partial }), 0);
  assert.match(all.lines.join('\n'), /not built \(npm run ext:build\)/);
});

test('the real CLI routes `worca extension help` and lists it in --help', async () => {
  const run = (args) => new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (b) => (stdout += b));
    child.on('exit', (code) => res({ code, stdout }));
  });
  const h = await run(['extension', 'help']);
  assert.equal(h.code, 0);
  assert.equal(h.stdout.trim(), EXTENSION_HELP.trim());
  assert.match((await run(['--help'])).stdout, /extension \[--browser <b>\] \[--open\]/);
  assert.equal((await run(['extension', '--browser', 'safari'])).code, 2);
});
