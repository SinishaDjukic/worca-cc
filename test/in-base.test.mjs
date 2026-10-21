// test/in-base.test.mjs — "Merged · in dev": a run branch whose head is already in its base, local refs only (D6).
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { workInBase, _testing } from '../src/core/in-base.mjs';

let repo;
const g = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } }).stdout.trim();
let start;
before(async () => {
  repo = await mkdtemp(join(tmpdir(), 'worca-cc-inbase-'));
  g('init', '-q', '-b', 'dev'); g('config', 'user.email', 't@example.test'); g('config', 'user.name', 'Test Person');
  await writeFile(join(repo, 'f.txt'), 'a\n'); g('add', '-A'); g('commit', '-qm', 'init');
  start = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'worca-cc/slice-1');
  await writeFile(join(repo, 'f.txt'), 'a\nb\n'); g('commit', '-qam', 'slice 1');
  g('checkout', '-q', '-b', 'worca-cc/idle', start);                       // no commits of its own
  g('checkout', '-q', '-b', 'worca-cc/open', start);
  await writeFile(join(repo, 'g.txt'), 'c\n'); g('add', '-A'); g('commit', '-qm', 'open work');
  g('checkout', '-q', 'dev');
});
after(async () => { await rm(repo, { recursive: true, force: true }); });
afterEach(() => _testing.reset());

test('a branch not in dev yet: null', async () => {
  assert.equal(await workInBase({ repoDir: repo, feature: 'worca-cc/slice-1', source: 'dev', startSha: start }), null);
});

test('after a bundle branch merged it into dev: { base: "dev" }; a branch with no commits of its own never is', async () => {
  g('checkout', '-q', '-b', 'worca-cc/bundle'); g('merge', '-q', '--no-ff', '-m', 'bundle', 'worca-cc/slice-1');
  g('checkout', '-q', 'dev'); g('merge', '-q', '--no-ff', '-m', 'bundle PR', 'worca-cc/bundle');
  assert.deepEqual(await workInBase({ repoDir: repo, feature: 'worca-cc/slice-1', source: 'dev', startSha: start }), { base: 'dev' });
  assert.deepEqual(await workInBase({ repoDir: repo, feature: 'worca-cc/slice-1', source: 'origin/dev', startSha: start }), { base: 'dev' });
  assert.equal(await workInBase({ repoDir: repo, feature: 'worca-cc/idle', source: 'dev', startSha: start }), null);
  assert.equal(await workInBase({ repoDir: repo, feature: 'worca-cc/open', source: 'dev', startSha: null }), null, 'no start sha: unknown');
});

test('the remote-tracking base counts too (local dev behind origin/dev); no fetch is ever run', async () => {
  const calls = [];
  const real = _testing.runner();
  _testing.setRunner((args, cwd) => { calls.push(args[0]); return real(args, cwd); });
  g('update-ref', 'refs/remotes/origin/dev', g('rev-parse', 'worca-cc/open'));
  assert.deepEqual(await workInBase({ repoDir: repo, feature: 'worca-cc/open', source: 'dev', startSha: start }), { base: 'dev' });
  assert.ok(!calls.includes('fetch'));
});

test('cached per (head, base): a second call runs no merge-base', async () => {
  const calls = [];
  const real = _testing.runner();
  _testing.setRunner((args, cwd) => { calls.push(args[0]); return real(args, cwd); });
  await workInBase({ repoDir: repo, feature: 'worca-cc/slice-1', source: 'dev', startSha: start });
  const first = calls.filter((c) => c === 'merge-base').length;
  await workInBase({ repoDir: repo, feature: 'worca-cc/slice-1', source: 'dev', startSha: start });
  assert.equal(calls.filter((c) => c === 'merge-base').length, first, 'no new merge-base on a cache hit');
  assert.ok(first >= 1);
});
