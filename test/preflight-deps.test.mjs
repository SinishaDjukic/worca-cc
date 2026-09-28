// test/preflight-deps.test.mjs
// Unit tests for the npm-dependency preflight: the spec matcher, the node_modules
// walk (including a hoisted global-install layout) and the fail-fast wrapper,
// all against throwaway package trees — never the repo's own node_modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  satisfies, installedVersion, checkDeps, formatDepsProblems, preflightDeps, PACKAGE_ROOT,
} from '../src/core/preflight-deps.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worca-deps-'));
  for (const [rel, json] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(json));
  }
  return root;
}

test('PACKAGE_ROOT is the repo root', () => {
  assert.equal(PACKAGE_ROOT, REPO);
});

test('satisfies: exact pins match only the same version', () => {
  assert.equal(satisfies('2.9.1', '2.9.1'), true);
  assert.equal(satisfies('2.9.0', '2.9.1'), false);
  assert.equal(satisfies('2.9.2', '2.9.1'), false);
});

test('satisfies: caret locks the left-most non-zero component', () => {
  assert.equal(satisfies('8.18.0', '^8.18.0'), true);
  assert.equal(satisfies('8.20.3', '^8.18.0'), true);
  assert.equal(satisfies('8.17.9', '^8.18.0'), false, 'below the floor');
  assert.equal(satisfies('9.0.0', '^8.18.0'), false, 'next major');
  assert.equal(satisfies('0.2.9', '^0.2.3'), true);
  assert.equal(satisfies('0.3.0', '^0.2.3'), false, '^0.x locks the minor');
  assert.equal(satisfies('0.0.4', '^0.0.3'), false, '^0.0.x locks the patch');
});

test('satisfies: tilde locks major.minor', () => {
  assert.equal(satisfies('1.2.9', '~1.2.3'), true);
  assert.equal(satisfies('1.3.0', '~1.2.3'), false);
  assert.equal(satisfies('1.2.2', '~1.2.3'), false);
});

test('satisfies: specs it does not model only require presence', () => {
  assert.equal(satisfies('1.0.0', '>=2 <3'), true);
  assert.equal(satisfies('1.0.0', 'latest'), true);
  assert.equal(satisfies('1.0.0', 'github:a/b'), true);
});

test('installedVersion walks up node_modules like Node does (hoisted global install)', () => {
  const root = tree({
    'lib/node_modules/@worca/app/package.json': { dependencies: { yaml: '2.9.1' } },
    'lib/node_modules/yaml/package.json': { version: '2.9.1' },
  });
  const app = path.join(root, 'lib/node_modules/@worca/app');
  assert.equal(installedVersion('yaml', app), '2.9.1');
  assert.equal(installedVersion('smol-toml', app), null);
  assert.deepEqual(checkDeps(app), []);
});

test('installedVersion prefers the nearest copy', () => {
  const root = tree({
    'app/node_modules/ws/package.json': { version: '8.18.0' },
    'node_modules/ws/package.json': { version: '7.0.0' },
  });
  assert.equal(installedVersion('ws', path.join(root, 'app')), '8.18.0');
});

test('checkDeps reports missing and outdated packages, ignores devDependencies', () => {
  const root = tree({
    'package.json': {
      dependencies: { yaml: '2.9.1', 'smol-toml': '1.9.0', ws: '^8.18.0' },
      devDependencies: { playwright: '1.0.0' },
    },
    'node_modules/yaml/package.json': { version: '2.8.0' },
    'node_modules/ws/package.json': { version: '8.19.0' },
  });
  assert.deepEqual(checkDeps(root), [
    { name: 'yaml', spec: '2.9.1', installed: '2.8.0' },
    { name: 'smol-toml', spec: '1.9.0', installed: null },
  ]);
});

test('formatDepsProblems names each package and the fix', () => {
  const msg = formatDepsProblems([
    { name: 'yaml', spec: '2.9.1', installed: '2.8.0' },
    { name: 'smol-toml', spec: '1.9.0', installed: null },
  ], '/src/worca');
  assert.match(msg, /missing\s+smol-toml@1\.9\.0/);
  assert.match(msg, /outdated\s+yaml@2\.9\.1 \(installed 2\.8\.0\)/);
  assert.match(msg, /Run `npm ci` in \/src\/worca/);
});

test('preflightDeps exits 1 with the message on problems, returns quietly otherwise', () => {
  const bad = tree({ 'package.json': { dependencies: { yaml: '2.9.1' } } });
  let code = null;
  let out = '';
  preflightDeps({ root: bad, exit: (c) => { code = c; }, err: (s) => { out += s; } });
  assert.equal(code, 1);
  assert.match(out, /missing\s+yaml@2\.9\.1/);

  const good = tree({
    'package.json': { dependencies: { yaml: '2.9.1' } },
    'node_modules/yaml/package.json': { version: '2.9.1' },
  });
  code = null;
  out = '';
  preflightDeps({ root: good, exit: (c) => { code = c; }, err: (s) => { out += s; } });
  assert.equal(code, null);
  assert.equal(out, '');
});

test('the CLI keeps --version and help usable on a broken install', () => {
  // Stale node_modules or not, these two must answer: they are what gets typed
  // first when something is wrong.
  const cli = path.join(REPO, 'src/cli/worca-cc.mjs');
  for (const args of [['--version'], ['help'], ['--help']]) {
    const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, `worca ${args.join(' ')}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /installed dependencies do not match/);
  }
});
