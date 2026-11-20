// test/cli-args.test.mjs
// Argv-level refusals on the CLI's run path: the ones that must happen BEFORE a
// pipeline row, a worktree, a feature branch or a paid agent call exists.
// Sibling harness to test/cli-branch-flags.test.mjs (temp one-commit repo +
// useTempHome + spawnSync of the CLI); the interactive stdin harness lives in
// test/cli-interactive.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkRows } from './helpers/rows.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { getDb } from '../src/core/db.mjs';

const CLI = resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'cli', 'worca-cc.mjs');

// Spawned children inherit process.env, so this temp home reaches the CLI too.
useTempHome(after, 'worca-cc-cliargs-home-');

const scratch = [];
after(() => Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true }))));

function freshRepo() {
  const dir = templateRepo('cliargs-repo', { branch: 'main', user: true, files: { 'seed.txt': 'seed\n' } });
  scratch.push(dir);
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

test('MAJ-9: a relative or absolute --file that does not exist fails, names the path, and starts nothing', async () => {
  await checkRows([
    { name: 'MAJ-9: --file pointing at a missing file fails, names the path, and starts nothing', run: () => {
      const repo = freshRepo();
      const before = pipelineCount();
      const r = runCli(['--project', repo, '--file', 'nope/missing.md', '--yes']);
      assert.notEqual(r.status, 0, `expected a non-zero exit\n${r.stdout}`);
      assert.match(r.stderr, /^worca: cannot read prompt file /m);
      assert.ok(r.stderr.includes(join(repo, 'nope', 'missing.md')), r.stderr);
      assert.equal(pipelineCount(), before, 'no pipeline row was created');
      assert.equal(/Pipeline complete\./.test(r.stdout), false, r.stdout);
    } },
    { name: 'MAJ-9: an absolute --file that does not exist fails the same way', run: () => {
      const repo = freshRepo();
      const missing = join(tmpdir(), 'worca-cc-cliargs-never-here.md');
      const before = pipelineCount();
      const r = runCli(['--project', repo, '--file', missing, '--yes']);
      assert.notEqual(r.status, 0, r.stdout);
      assert.ok(r.stderr.includes(missing), r.stderr);
      assert.equal(pipelineCount(), before);
    } },
  ]);
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

// One fresh repo per row: a refusal must leave it with no pipeline row and only `main`.
test('MIN-51: near-miss tokens (plug, metrcs, versoin, hlep) are refused with the suggestion and start nothing', async () => {
  await checkRows([
    ['MIN-51: a strict prefix of a subcommand is refused too', ['plug'], 'plugin'],
    ['MIN-51: a typo of `metrics` is refused, not run as a prompt', ['metrcs'], 'metrics'],
    ['--version: a typo of `version` is refused, not run as a prompt', ['versoin', '--yes'], 'version'],
    ['MIN-51: a typo of `help` itself is refused, not run as a prompt', ['hlep', '--yes'], 'help'],
  ].map(([name, argv, meant]) => ({ name, run: () => {
    const repo = freshRepo();
    const before = pipelineCount();
    const r = runCli(argv, repo);
    assert.equal(r.status, 2, `expected the fail() exit code\n${r.stdout}\n${r.stderr}`);
    assert.equal(
      r.stderr.trim(),
      `worca: unknown subcommand "${argv[0]}" — did you mean "${meant}"? (to run a prompt, use --prompt "…")`,
    );
    assert.equal(pipelineCount(), before, 'no pipeline row');
    assert.equal(branchesOf(repo).trim(), 'main', 'no feature branch');
  } })));
});

// `worca projects list` — the README once listed add/list/remove as "projects (…)", but
// they are top-level verbs; `projects` near-misses nothing, so it ran a pipeline named
// "projects list". A group word with at most one more token is refused like a typo.
test('MIN-51: a group word before a top-level verb (projects list) is refused with the verb, and starts nothing', async () => {
  await checkRows([
    ['projects + a real verb suggests that verb', ['projects', 'list'], 'list'],
    ['singular project works the same', ['project', 'remove'], 'remove'],
    ['a lone group word suggests list', ['projects'], 'list'],
    ['projects add <name> (the real form) suggests add', ['projects', 'add', 'myproj'], 'add'],
    ['singular project remove <name> suggests remove', ['project', 'remove', 'x'], 'remove'],
  ].map(([name, argv, meant]) => ({ name, run: () => {
    const repo = freshRepo();
    const before = pipelineCount();
    const r = runCli(argv, repo);
    assert.equal(r.status, 2, `expected the fail() exit code\n${r.stdout}\n${r.stderr}`);
    assert.equal(
      r.stderr.trim(),
      `worca: unknown subcommand "${argv.join(' ')}" — did you mean "${meant}"? `
        + 'The project commands are top-level: worca add | list | remove (to run a prompt, use --prompt "…")',
    );
    assert.equal(pipelineCount(), before, 'no pipeline row');
    assert.equal(branchesOf(repo).trim(), 'main', 'no feature branch');
  } })));
});

test('MIN-51: a plural of a subcommand (workflows list) is already refused as a near-miss', () => {
  const repo = freshRepo();
  const r = runCli(['workflows', 'list'], repo);
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
  assert.equal(
    r.stderr.trim(),
    'worca: unknown subcommand "workflows" — did you mean "workflow"? (to run a prompt, use --prompt "…")',
  );
});

test('MIN-51: a multi-word positional, a non-near-miss single token and --prompt resume are all prompts', async () => {
  await checkRows([
    ['MIN-51: a multi-word bare positional is still a prompt', (repo) => runCli(['fix the login bug', '--yes'], repo), 'fix the login bug'],
    ['MIN-51: a single-token prompt that is NOT a near-miss still runs', (repo) => runCli(['refactor', '--yes'], repo), 'refactor'],
    ['MIN-51: --prompt resume is a prompt, never a subcommand', (repo) => runCli(['--project', repo, '--prompt', 'resume', '--yes']), 'resume'],
    ['README example: a quoted multi-word bare prompt runs', (repo) => runCli(['Add a /search endpoint', '--yes'], repo), 'Add a /search endpoint'],
    ['a group word inside a longer prompt is still a prompt', (repo) => runCli(['projects', 'need', 'a', 'cleanup', '--yes'], repo), 'projects need a cleanup'],
    ['the longest legitimate prompt starting with a group verb is still a prompt', (repo) => runCli(['project', 'add', 'caching', 'to', 'the', 'API', '--yes'], repo), 'project add caching to the API'],
    ['a 3-token prompt whose second word is not a verb is still a prompt', (repo) => runCli(['projects', 'need', 'cleanup', '--yes'], repo), 'projects need cleanup'],
  ].map(([name, start, prompt]) => ({ name, run: () => {
    const r = start(freshRepo());
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /Pipeline complete\./);
    const row = getDb().prepare('SELECT prompt FROM pipelines ORDER BY rowid DESC LIMIT 1').get();
    assert.equal(row.prompt, prompt);
  } })));
});

test('HELP (--help and bare `worca help`) documents the bare-positional prompt form and --version, and starts nothing', async () => {
  const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  await checkRows([
    { name: 'MIN-51: HELP documents the bare-positional prompt form', run: () => {
      assert.equal(help.status, 0);
      assert.match(help.stdout, /worca "<task>"/);
    } },
    { name: '--version: HELP documents the flag and the bare word', run: () => {
      assert.equal(help.status, 0);
      assert.match(help.stdout, /-v, -V, --version/);
      assert.match(help.stdout, /^  version\s+Print the version/m);
    } },
    { name: 'MIN-51: bare `worca help` prints the help and starts nothing', run: () => {
      const repo = freshRepo();
      const before = pipelineCount();
      const r = runCli(['help'], repo);
      assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout, /^worca — node-graph multi-agent pipelines/);
      assert.match(r.stdout, /Usage:/);
      assert.equal(pipelineCount(), before, 'no pipeline row');
      assert.equal(branchesOf(repo).trim(), 'main', 'no feature branch');
    } },
  ]);
});

// ── --version ──────────────────────────────────────────────────────────────────
// `worca version` was not a subcommand and not a near-miss of one, so before this
// arm existed it ran a real pipeline on the prompt "version" — the `help` bug again.

const PKG_VERSION = JSON.parse(readFileSync(resolve(CLI, '..', '..', '..', 'package.json'), 'utf8')).version;

test('--version: -v / -V / --version / version (and after a bad flag) print "worca <semver>", exit 0, start nothing', async () => {
  await checkRows([
    ...[['-v'], ['-V'], ['--version'], ['version']].map((spelling) => ({
      name: `--version: \`worca ${spelling.join(' ')}\` prints "worca <semver>" and exits 0`,
      run: () => {
        const r = spawnSync(process.execPath, [CLI, ...spelling], { encoding: 'utf8' });
        assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
        assert.equal(r.stdout, `worca ${PKG_VERSION}\n`);
        assert.equal(r.stderr, '');
      },
    })),
    { name: '--version: wins over an otherwise-bad command line', run: () => {
      const r = spawnSync(process.execPath, [CLI, '--bogus-flag', '--version'], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
      assert.equal(r.stdout, `worca ${PKG_VERSION}\n`);
    } },
    { name: '--version: bare `worca version` starts nothing', run: () => {
      const repo = freshRepo();
      const before = pipelineCount();
      const r = runCli(['version'], repo);
      assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
      assert.equal(r.stdout, `worca ${PKG_VERSION}\n`);
      assert.equal(pipelineCount(), before, 'no pipeline row');
      assert.equal(branchesOf(repo).trim(), 'main', 'no feature branch');
    } },
  ]);
});

test('--memory-scope: enum-checked, workflow-checked, documented; the prompt is synthesised so no --prompt is needed', () => {
  const repo = freshRepo();
  const before = pipelineCount();
  let r = runCli(['--memory-scope', 'both', '--workflow', 'wf_memory_defrag'], repo);
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /--memory-scope must be one of global, project, got: both/);
  r = runCli(['--memory-scope', 'global', '--prompt', 'x'], repo);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /memoryScope is only valid with the Memory defragment workflow/);
  r = runCli(['--workflow', 'wf_memory_defrag', '--prompt', 'x'], repo);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /needs memoryScope/);
  assert.equal(pipelineCount(), before, 'no pipeline row for any refusal');
  const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.match(help.stdout, /--memory-scope <s>\s+Memory defragment workflow only: global \| project/);
});

test('--memory-scope global with --workflow wf_memory_defrag runs a mock defragment to done without a prompt', () => {
  const repo = freshRepo();
  const r = runCli(['--project', repo, '--workflow', 'wf_memory_defrag', '--memory-scope', 'global', '--mock', '--yes'], repo);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /Memory mounted: \d+ file\(s\) across 1 scope\(s\) — loaded from .*[\\/]\.claude[\\/]rules[\\/]worca, written to .*[\\/]memory/, 'one scope mounted: the rules copy in the cwd, the writable copy under the pipeline dir');
  const row = getDb().prepare('SELECT prompt, status FROM pipelines ORDER BY started_at DESC LIMIT 1').get();
  assert.equal(row.prompt, 'Defragment global memory.');
  assert.equal(row.status, 'done');
});

// Settings › Memory: the CLI start path constructs the same orchestrator, so the defragment pair is
// resolved there too — no CLI-side code. --model is the pair named at start and wins.
test('a CLI defragment run picks up the Settings › Memory pair; --model named at start wins and drops the setting\'s effort', () => {
  const home = mkdtempSync(join(tmpdir(), 'worca-cc-cliargs-dmhome-'));
  scratch.push(home);
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ memory: { defrag: { model: 'claude-haiku-4-5', effort: 'high' } } }));
  // settings.json lives under HOME: sandbox it and lift the test runner's HOME guard for the child.
  const env = { ...process.env, WORCA_MOCK: '1', HOME: home, USERPROFILE: home, WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_PROJECTS_ROOT: home };
  const run = (extra) => spawnSync(process.execPath, [CLI, '--project', freshRepo(), '--workflow', 'wf_memory_defrag', '--memory-scope', 'global', '--mock', '--yes', ...extra], { env, encoding: 'utf8' });
  const nDefrag = () => JSON.parse(getDb().prepare('SELECT stepper FROM pipelines ORDER BY started_at DESC LIMIT 1').get().stepper)
    .graph.nodes.find((n) => n.id === 'n_defrag');
  let r = run([]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /Memory defragment model: claude-haiku-4-5 · high \(Settings › Memory\)/);
  assert.deepEqual([nDefrag().model, nDefrag().effort], ['claude-haiku-4-5', 'high']);
  r = run(['--model', 'claude-opus-5-5']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /Memory defragment model: claude-opus-5-5 \(named at start\)/);
  assert.deepEqual([nDefrag().model, nDefrag().effort], ['claude-opus-5-5', '']);
});

// ── #718: --tag (repeatable) is normalised before anything starts, and stored on the run ──
test('--tag: an invalid tag exits 2 before any pipeline row; valid tags are stored normalised', () => {
  const repo = freshRepo();
  const before = pipelineCount();
  const bad = runCli(['--project', repo, '--prompt', 'x', '--tag', 'client:'], repo);
  assert.equal(bad.status, 2, `${bad.stdout}\n${bad.stderr}`);
  assert.match(bad.stderr, /--tag: "client:" needs a value/);
  assert.equal(pipelineCount(), before, 'no pipeline row for the refusal');
  for (const raw of ['hello world', 'client']) {
    const r = runCli(['--project', repo, '--prompt', 'x', '--tag', raw], repo);
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.ok(r.stderr.includes(`--tag: "${raw}": a tag is key:value, for example client:acme`), r.stderr);
  }
  assert.equal(pipelineCount(), before, 'no pipeline row for the refusals');
  const ok = runCli(['--project', repo, '--prompt', 'x', '--tag', 'Client: Müller & Söhne, GmbH', '--tag=team:core-ui', '--yes'], repo);
  assert.equal(ok.status, 0, `${ok.stdout}\n${ok.stderr}`);
  const id = getDb().prepare('SELECT id FROM pipelines ORDER BY rowid DESC LIMIT 1').get().id;
  const rows = getDb().prepare('SELECT key, value FROM run_tags WHERE pipeline_id = ? ORDER BY key').all(id).map((r) => `${r.key}=${r.value}`);
  assert.deepEqual(rows, ['client=müller & söhne, gmbh', 'team=core-ui']);
  const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.match(help.stdout, /--tag <tag>\s+tag the run for cost allocation/);
});
