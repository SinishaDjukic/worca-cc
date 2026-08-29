// test/cli-args.test.mjs
// Argv-level refusals on the CLI's run path: the ones that must happen BEFORE a
// pipeline row, a worktree, a feature branch or a paid agent call exists.
// Sibling harness to test/cli-branch-flags.test.mjs (temp one-commit repo +
// useTempHome + spawnSync of the CLI); the interactive stdin harness lives in
// test/cli-interactive.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';

const CLI = resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'cli', 'worca-cc.mjs');

// Spawned children inherit process.env, so this temp home reaches the CLI too.
useTempHome(after, 'worca-cc-cliargs-home-');

const scratch = [];
after(() => Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true }))));

function freshRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-cliargs-repo-'));
  scratch.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'seed.txt'), 'seed\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

const runCli = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], {
  env: { ...process.env, WORCA_MOCK: '1' },
  encoding: 'utf8',
  ...(cwd ? { cwd } : {}),
});

const pipelineCount = () => getDb().prepare('SELECT COUNT(*) n FROM pipelines').get().n;
const branchesOf = (repo) =>
  spawnSync('git', ['-C', repo, 'branch', '--format=%(refname:short)'], { encoding: 'utf8' }).stdout;

// ── MAJ-9: --file naming a file that cannot be read ────────────────────────────
// Before the fix this ran a whole 10-execution pipeline on prompt "" and exited 0:
// a typo'd path spent tokens and cut a worktree + feature branch for an empty task.

test('MAJ-9: --file pointing at a missing file fails, names the path, and starts nothing', () => {
  const repo = freshRepo();
  const before = pipelineCount();
  const r = runCli(['--project', repo, '--file', 'nope/missing.md', '--yes']);
  assert.notEqual(r.status, 0, `expected a non-zero exit\n${r.stdout}`);
  assert.match(r.stderr, /^worca: cannot read prompt file /m);
  assert.ok(r.stderr.includes(join(repo, 'nope', 'missing.md')), r.stderr);
  assert.equal(pipelineCount(), before, 'no pipeline row was created');
  assert.equal(/Pipeline complete\./.test(r.stdout), false, r.stdout);
});

test('MAJ-9: an absolute --file that does not exist fails the same way', () => {
  const repo = freshRepo();
  const missing = join(tmpdir(), 'worca-cc-cliargs-never-here.md');
  const before = pipelineCount();
  const r = runCli(['--project', repo, '--file', missing, '--yes']);
  assert.notEqual(r.status, 0, r.stdout);
  assert.ok(r.stderr.includes(missing), r.stderr);
  assert.equal(pipelineCount(), before);
});

test('MAJ-9: a readable --file still runs the pipeline from its contents', () => {
  const repo = freshRepo();
  writeFileSync(join(repo, 'brief.md'), '# real brief\n\nDo the thing.\n');
  const r = runCli(['--project', repo, '--file', 'brief.md', '--yes']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Pipeline complete\./);
  const row = getDb().prepare('SELECT prompt FROM pipelines ORDER BY rowid DESC LIMIT 1').get();
  assert.equal(row.prompt, '# real brief\n\nDo the thing.\n');
});
