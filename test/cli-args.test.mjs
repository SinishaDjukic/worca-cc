// test/cli-args.test.mjs
// Argv-level refusals on the CLI's run path: the ones that must happen BEFORE a
// pipeline row, a worktree, a feature branch or a paid agent call exists.
// Sibling harness to test/cli-branch-flags.test.mjs (temp one-commit repo +
// useTempHome + spawnSync of the CLI); the interactive stdin harness lives in
// test/cli-interactive.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

// ── MIN-51: a mistyped subcommand must not start a real pipeline ───────────────
// `worca reusme <id>` used to fall through to the bare-positional prompt form and
// run a full pipeline in the cwd, cutting a worktree + feature branch for a task
// literally named "reusme run-abc123".

test('MIN-51: a near-miss subcommand is refused with a suggestion, and starts nothing', () => {
  const repo = freshRepo();
  const before = pipelineCount();
  const r = runCli(['reusme', 'run-abc123'], repo);
  assert.equal(r.status, 2, `expected the fail() exit code\n${r.stdout}\n${r.stderr}`);
  assert.equal(
    r.stderr.trim(),
    'worca: unknown subcommand "reusme" — did you mean "resume"? (to run a prompt, use --prompt "…")',
  );
  assert.equal(pipelineCount(), before, 'no pipeline row');
  // No worktree, no feature branch: the whole point of refusing before the run.
  assert.equal(branchesOf(repo).trim(), 'main');
  const worktrees = spawnSync('git', ['-C', repo, 'worktree', 'list'], { encoding: 'utf8' }).stdout.trim().split('\n');
  assert.equal(worktrees.length, 1, worktrees.join(' | '));
});

test('MIN-51: a strict prefix of a subcommand is refused too', () => {
  const repo = freshRepo();
  const r = runCli(['plug'], repo);
  assert.equal(r.status, 2, r.stdout);
  assert.equal(
    r.stderr.trim(),
    'worca: unknown subcommand "plug" — did you mean "plugin"? (to run a prompt, use --prompt "…")',
  );
});

test('MIN-51: a multi-word bare positional is still a prompt', () => {
  const repo = freshRepo();
  const r = runCli(['fix the login bug', '--yes'], repo);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /Pipeline complete\./);
  const row = getDb().prepare('SELECT prompt FROM pipelines ORDER BY rowid DESC LIMIT 1').get();
  assert.equal(row.prompt, 'fix the login bug');
});

test('MIN-51: a single-token prompt that is NOT a near-miss still runs', () => {
  const repo = freshRepo();
  const r = runCli(['refactor', '--yes'], repo);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /Pipeline complete\./);
});

test('MIN-51: --prompt resume is a prompt, never a subcommand', () => {
  const repo = freshRepo();
  const r = runCli(['--project', repo, '--prompt', 'resume', '--yes']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /Pipeline complete\./);
  const row = getDb().prepare('SELECT prompt FROM pipelines ORDER BY rowid DESC LIMIT 1').get();
  assert.equal(row.prompt, 'resume');
});

test('MIN-51: HELP documents the bare-positional prompt form', () => {
  const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /worca "<task>"/);
});

test('MIN-51: bare `worca help` prints the help and starts nothing', () => {
  const repo = freshRepo();
  const before = pipelineCount();
  const r = runCli(['help'], repo);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^worca — node-graph multi-agent pipelines/);
  assert.match(r.stdout, /Usage:/);
  assert.equal(pipelineCount(), before, 'no pipeline row');
  assert.equal(branchesOf(repo).trim(), 'main', 'no feature branch');
});

// ── --version ──────────────────────────────────────────────────────────────────
// `worca version` was not a subcommand and not a near-miss of one, so before this
// arm existed it ran a real pipeline on the prompt "version" — the `help` bug again.

const PKG_VERSION = JSON.parse(readFileSync(resolve(CLI, '..', '..', '..', 'package.json'), 'utf8')).version;

for (const spelling of [['-v'], ['-V'], ['--version'], ['version']]) {
  test(`--version: \`worca ${spelling.join(' ')}\` prints "worca <semver>" and exits 0`, () => {
    const r = spawnSync(process.execPath, [CLI, ...spelling], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.equal(r.stdout, `worca ${PKG_VERSION}\n`);
    assert.equal(r.stderr, '');
  });
}

test('--version: matches package.json (semver shape)', () => {
  assert.match(PKG_VERSION, /^\d+\.\d+\.\d+/);
});

test('--version: wins over an otherwise-bad command line', () => {
  const r = spawnSync(process.execPath, [CLI, '--bogus-flag', '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(r.stdout, `worca ${PKG_VERSION}\n`);
});

test('--version: bare `worca version` starts nothing', () => {
  const repo = freshRepo();
  const before = pipelineCount();
  const r = runCli(['version'], repo);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(r.stdout, `worca ${PKG_VERSION}\n`);
  assert.equal(pipelineCount(), before, 'no pipeline row');
  assert.equal(branchesOf(repo).trim(), 'main', 'no feature branch');
});

test('--version: a typo of `version` is refused, not run as a prompt', () => {
  const repo = freshRepo();
  const before = pipelineCount();
  const r = runCli(['versoin', '--yes'], repo);
  assert.equal(r.status, 2, `expected the fail() exit code\n${r.stdout}\n${r.stderr}`);
  assert.equal(
    r.stderr.trim(),
    'worca: unknown subcommand "versoin" — did you mean "version"? (to run a prompt, use --prompt "…")',
  );
  assert.equal(pipelineCount(), before, 'no pipeline row');
  assert.equal(branchesOf(repo).trim(), 'main', 'no feature branch');
});

test('--version: HELP documents the flag and the bare word', () => {
  const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /-v, -V, --version/);
  assert.match(r.stdout, /^  version\s+Print the version/m);
});

test('MIN-51: a typo of `help` itself is refused, not run as a prompt', () => {
  const repo = freshRepo();
  const before = pipelineCount();
  const r = runCli(['hlep', '--yes'], repo);
  assert.equal(r.status, 2, `expected the fail() exit code\n${r.stdout}\n${r.stderr}`);
  assert.equal(
    r.stderr.trim(),
    'worca: unknown subcommand "hlep" — did you mean "help"? (to run a prompt, use --prompt "…")',
  );
  assert.equal(pipelineCount(), before, 'no pipeline row');
  assert.equal(branchesOf(repo).trim(), 'main', 'no feature branch');
});
