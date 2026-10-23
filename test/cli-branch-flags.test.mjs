// test/cli-branch-flags.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkRows } from './helpers/rows.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

const CLI = resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'cli', 'worca-cc.mjs');

// Isolate store: spawned children inherit process.env, so this temp home
// reaches the CLI subprocess too (it passes no env / spreads process.env).
useTempHome(after);

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));
function freshRepo() {
  const dir = templateRepo('cli', { branch: 'main', user: true, files: { a: 'a' } });
  created.push(dir);
  return dir;
}

test('--source-branch / --branch without a value exit 2 with "requires a value"', async () => {
  await checkRows([
    ['--source-branch without value exits 2', '--source-branch', /--source-branch requires a value/],
    ['--branch without value exits 2', '--branch', /--branch requires a value/],
  ].map(([name, flag, message]) => ({ name, run: () => {
    const r = spawnSync(process.execPath, [CLI, '--prompt', 'x', flag]);
    assert.equal(r.status, 2);
    assert.match(r.stderr.toString(), message);
  } })));
});

test('--branch <name> actually reaches the orchestrator (kept on success)', async () => {
  const repo = await freshRepo();
  const r = spawnSync(
    process.execPath,
    [CLI, '--project', repo, '--prompt', 'demo', '--mock', '--yes', '--branch', 'feat/cli-plumbed'],
    { env: { ...process.env, WORCA_MOCK: '1' }, encoding: 'utf8' },
  );
  assert.equal(r.status, 0, `cli failed: ${r.stderr}`);
  // On done the feature branch is kept (C1 policy), proving the flag plumbed
  // through to createWorktree.
  const branches = spawnSync('git', ['-C', repo, 'branch', '--format=%(refname:short)']).stdout.toString();
  assert.match(branches, /feat\/cli-plumbed/);
});

test('--help advertises --on-source-branch', () => {
  const out = spawnSync(process.execPath, [CLI, '--help']).stdout.toString();
  assert.match(out, /--on-source-branch/);
});

test('--on-source-branch with --branch exits 2', () => {
  const r = spawnSync(process.execPath, [CLI, '--prompt', 'x', '--on-source-branch', '--branch', 'feat/x']);
  assert.equal(r.status, 2);
  assert.match(r.stderr.toString(), /--on-source-branch and --branch cannot both be given/);
});

test('--branch equal to --source-branch without --on-source-branch exits 2 and names the flag (never an error run)', () => {
  const r = spawnSync(process.execPath, [CLI, '--prompt', 'x', '--source-branch', 'dev', '--branch', 'dev']);
  assert.equal(r.status, 2);
  assert.match(r.stderr.toString(), /--on-source-branch/);
});

test('--on-source-branch: the run lands on main (checked out + clean), no run branch is left', async () => {
  const repo = await freshRepo();
  const before = spawnSync('git', ['-C', repo, 'rev-parse', 'main'], { encoding: 'utf8' }).stdout.trim();
  const r = spawnSync(process.execPath, [CLI, '--project', repo, '--prompt', 'demo', '--mock', '--yes', '--on-source-branch'],
    { env: { ...process.env, WORCA_MOCK: '1' }, encoding: 'utf8' });
  assert.equal(r.status, 0, `cli failed: ${r.stderr}`);
  const branches = spawnSync('git', ['-C', repo, 'branch', '--format=%(refname:short)'], { encoding: 'utf8' }).stdout;
  assert.match(branches, /^main$/m);
  assert.doesNotMatch(branches, /worca-cc\//, 'the hidden branch is deleted after the merge back');
  assert.notEqual(spawnSync('git', ['-C', repo, 'rev-parse', 'main'], { encoding: 'utf8' }).stdout.trim(), before, 'main moved');
  assert.equal(spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', before, 'main']).status, 0, 'main only moved forward');
});

test('smart run naming on: no --branch gives the pattern name; off gives worca-cc/', async () => {
  for (const [flags, re] of [['smartRunNaming', /^feat\/demo/m], ['-smartRunNaming', /^worca-cc\/demo/m]]) {
    const repo = await freshRepo();
    const r = spawnSync(
      process.execPath,
      [CLI, '--project', repo, '--prompt', 'demo', '--mock', '--yes'],
      { env: { ...process.env, WORCA_MOCK: '1', WORCA_FLAGS: flags }, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, `cli failed: ${r.stderr}`);
    assert.match(spawnSync('git', ['-C', repo, 'branch', '--format=%(refname:short)']).stdout.toString(), re);
  }
});
