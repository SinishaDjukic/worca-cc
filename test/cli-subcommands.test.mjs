// test/cli-subcommands.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { createWorktree } from '../src/core/worktree.mjs';
import { _resetForTests } from '../src/core/db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');

// Default-isolate store for runs that don't pass an explicit `home`. run()
// spreads process.env into the child, so this temp home propagates.
useTempHome(after);

const created = [];
async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-cli-'));
  created.push(dir);
  return dir;
}
async function freshProj() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-proj-'));
  created.push(dir);
  // Canonicalize to match what process.cwd() reports inside the spawned child
  // (macOS resolves /var -> /private/var and /tmp -> /private/tmp on getcwd).
  return realpath(dir);
}
/** A registered-project-shaped git repo with one commit (the legacy sweep needs git). */
async function freshGitRepo() {
  const dir = await freshProj();
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'seed.txt'), 'seed\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

function run(args, { home, cwd, extraEnv } = {}) {
  return new Promise((res) => {
    const env = { ...process.env };
    if (home) env.WORCA_HOME = home;
    if (extraEnv) Object.assign(env, extraEnv);
    const child = spawn(process.execPath, [CLI, ...args], {
      env,
      cwd: cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}

// Escape a string for safe inclusion as a literal in a RegExp.
function reEsc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('add uses cwd basename as default name', async () => {
  const home = await freshHome();
  const proj = await freshProj();
  const r = await run(['add'], { home, cwd: proj });
  assert.equal(r.code, 0, r.stderr);
  const expectedName = proj.split('/').pop();
  assert.match(r.stdout, new RegExp(`Added project "${reEsc(expectedName)}" -> ${reEsc(proj)}`));
  const list = await run(['list'], { home });
  assert.equal(list.code, 0);
  assert.match(list.stdout, new RegExp(`${reEsc(expectedName)}\\t${reEsc(proj)}`));
});

test('add accepts explicit name and --path', async () => {
  const home = await freshHome();
  const r = await run(['add', 'demo', '--path', '/tmp/nope-explicit'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Added project "demo" -> \/tmp\/nope-explicit/);
});

test('add supports --path=<dir> form', async () => {
  const home = await freshHome();
  const r = await run(['add', 'demo', '--path=/tmp/nope-inline'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /-> \/tmp\/nope-inline/);
});

test('add expands a leading ~ in --path using HOME', async () => {
  const home = await freshHome();
  // Force a known HOME for the spawned CLI so we can predict the expansion.
  const fakeHome = '/tmp/worca-cc-fake-home';
  const r = await run(['add', 'demo', '--path=~/sub/dir'], { home, extraEnv: { HOME: fakeHome } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`-> ${reEsc(fakeHome)}/sub/dir`));
});

test('add rejects --path without a value (exit 2)', async () => {
  const home = await freshHome();
  const r = await run(['add', 'demo', '--path'], { home });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--path requires a value/);
});

test('add rejects unknown flag (exit 2)', async () => {
  const home = await freshHome();
  const r = await run(['add', 'demo', '--bogus'], { home });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Unknown flag: --bogus/);
});

test('duplicate add exits 1 with stderr message', async () => {
  const home = await freshHome();
  await run(['add', 'demo', '--path', '/tmp/x'], { home });
  const r = await run(['add', 'demo', '--path', '/tmp/y'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /already exists/);
});

test('list on empty registry prints hint and exits 0', async () => {
  const home = await freshHome();
  const r = await run(['list'], { home });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /No projects registered/);
});

test('list shows entries, marks missing ones', async () => {
  const home = await freshHome();
  await run(['add', 'ghost', '--path', '/no/such/dir/x'], { home });
  const r = await run(['list'], { home });
  assert.equal(r.code, 0);
  // stdout is from a non-TTY pipe, so [missing] is uncolored.
  assert.match(r.stdout, /ghost\t\/no\/such\/dir\/x\t\[missing\]/);
});

test('remove without name exits 2 (usage)', async () => {
  const home = await freshHome();
  const r = await run(['remove'], { home });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Usage: worca remove/);
});

test('remove on unknown name exits 1', async () => {
  const home = await freshHome();
  const r = await run(['remove', 'nope'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /No project named "nope"/);
});

test('remove drops the entry, exits 0', async () => {
  const home = await freshHome();
  await run(['add', 'demo', '--path', '/tmp/x'], { home });
  const r = await run(['remove', 'demo'], { home });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Removed project "demo"/);
  const list = await run(['list'], { home });
  assert.match(list.stdout, /No projects registered/);
});

test('--help shows Subcommands section and does not regress', async () => {
  const r = await run(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Subcommands:/);
  assert.match(r.stdout, /^\s+add\b/m);
  assert.match(r.stdout, /^\s+list\b/m);
  assert.match(r.stdout, /^\s+remove\b/m);
  assert.match(r.stdout, /^\s+doctor\b/m, 'the doctor subcommand is documented');
});

// ── Phase 1: `worca doctor` (reconcile + run-root sweep) ──────────────────────
// This is what keeps a CLI-only user (who never boots ui/server.mjs) from
// accumulating crashed-run roots under <worcaHome>/runs forever.

test('doctor runs the reconcile + sweep pair and exits 0 on an empty home', async () => {
  const home = await freshHome();
  // §6 intro: pin the mode rather than inheriting it — under `legacy` the legacy
  // sweep is a declared no-op, which is itself part of what this asserts.
  const r = await run(['doctor'], { home, extraEnv: { WORCA_RUN_ROOT: 'legacy' } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /reconciled 0 stale running record\(s\)/, 'the reconcile step ran');
  assert.match(r.stdout, /run roots: kept 0, removed 0, quarantined 0/, 'the sweep step ran');
  assert.match(r.stdout, /legacy worktrees: skipped/, 'and the legacy sweep reports itself skipped');
});

test('doctor reclaims a terminal run root and KEEPS an interrupted one (the keep-set, end to end)', async () => {
  const home = await freshHome();
  // Two run roots with hand-written manifests (no worktrees: the sweep tolerates
  // members whose dirs are already gone) and two pipelines rows to classify them.
  const runs = join(home, '.worca-cc', 'runs');
  for (const [id, status] of [['done0001', 'done'], ['intr0001', 'interrupted']]) {
    await mkdir(join(runs, id, 'repos'), { recursive: true });
    await writeFile(join(runs, id, 'run.json'),
      JSON.stringify({ pipelineId: id, runRootMode: 'detached', isWorkspace: false, members: [] }));
    await writeFile(join(runs, id, 'CLAUDE.md'), '# generated\n');
    void status;
  }
  // Seed the rows from THIS process against the same home the child will read.
  const prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests();
  try {
    seedPipelineRow({ id: 'done0001', status: 'done', startedAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' });
    seedPipelineRow({ id: 'intr0001', status: 'interrupted', startedAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' });
  } finally {
    process.env.WORCA_HOME = prevHome;
    _resetForTests();
  }

  const r = await run(['doctor'], { home, extraEnv: { WORCA_RUN_ROOT: 'legacy' } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /run roots: kept 1, removed 1, quarantined 0/, r.stdout);
  assert.equal(existsSync(join(runs, 'done0001')), false, 'the done run root was reclaimed');
  assert.ok(existsSync(join(runs, 'intr0001')), 'the interrupted run root SURVIVES (resumable)');
  assert.ok(existsSync(join(runs, 'intr0001', 'CLAUDE.md')), 'its contents are untouched');
});

// ── Phase 7: doctor also sweeps the LEGACY <projectDir>/.worca-cc/worktrees base ──
// Same keep-set, same registry fan-out as the server boot — for the CLI-only user
// who never runs ui/server.mjs.

test('doctor prunes leftover legacy worktrees per registered project (detached) and exits 0', async () => {
  const home = await freshHome();
  const repo = await freshGitRepo();
  const other = await freshGitRepo();
  await run(['add', 'lgrepo', '--path', repo], { home });
  await run(['add', 'lgother', '--path', other], { home });

  const gone = await createWorktree({
    projectDir: repo, pipelineId: 'clidone1', sourceBranch: 'main', featureBranch: 'worca-cc/clidone1',
  });
  const kept = await createWorktree({
    projectDir: other, pipelineId: 'clipaus1', sourceBranch: 'main', featureBranch: 'worca-cc/clipaus1',
  });

  const prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests();
  try {
    seedPipelineRow({ id: 'clidone1', status: 'done', startedAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' });
    seedPipelineRow({ id: 'clipaus1', status: 'paused', startedAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' });
  } finally {
    process.env.WORCA_HOME = prevHome;
    _resetForTests();
  }

  const r = await run(['doctor'], { home, extraEnv: { WORCA_RUN_ROOT: 'detached' } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /legacy worktrees: kept 1, removed 1, quarantined 0, skipped 0 across 2 project\(s\)/, r.stdout);
  assert.equal(existsSync(gone.worktreeDir), false, 'the terminal legacy checkout was pruned');
  assert.ok(existsSync(kept.worktreeDir), 'the paused one SURVIVES (resume re-enters it)');
  // Branches are never touched, in any disposition.
  const branches = spawnSync('git', ['-C', repo, 'branch', '--format=%(refname:short)']).stdout.toString();
  assert.match(branches, /worca-cc\/clidone1/);
});
