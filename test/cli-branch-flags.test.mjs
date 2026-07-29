// test/cli-branch-flags.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';

const CLI = resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'cli', 'worca-cc.mjs');

// Isolate store: spawned children inherit process.env, so this temp home
// reaches the CLI subprocess too (it passes no env / spreads process.env).
useTempHome(after);

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));
async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-cli-'));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'a'), 'a');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}

test('--help advertises --source-branch and --branch', () => {
  const r = spawnSync(process.execPath, [CLI, '--help']);
  const out = r.stdout.toString();
  assert.match(out, /--source-branch/);
  assert.match(out, /--branch /);
});

test('--source-branch without value exits 2', () => {
  const r = spawnSync(process.execPath, [CLI, '--prompt', 'x', '--source-branch']);
  assert.equal(r.status, 2);
  assert.match(r.stderr.toString(), /--source-branch requires a value/);
});

test('--branch without value exits 2', () => {
  const r = spawnSync(process.execPath, [CLI, '--prompt', 'x', '--branch']);
  assert.equal(r.status, 2);
  assert.match(r.stderr.toString(), /--branch requires a value/);
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
