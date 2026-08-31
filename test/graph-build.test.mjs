// test/graph-build.test.mjs
// Unit + integration tests for the in-worktree graphify build: the agent
// instruction, the spawn-with-timeout helper, the orchestrator's
// _buildWorktreeGraph guards, and the end-to-end leak-safety guarantees.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { worktreeGraphInstruction, runGraphifyUpdate } from '../src/core/preflight.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };

const tmpDirs = [];
async function makeTmpDir(prefix = 'worca-cc-graph-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
// Write an executable fake `graphify` into binDir and return that PATH value.
async function fakeGraphify(binDir, body) {
  await writeFile(join(binDir, 'graphify'), body, 'utf8');
  await chmod(join(binDir, 'graphify'), 0o755);
  return binDir;
}
after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

test('worktreeGraphInstruction: cwd-relative, AST-only, lists the query commands', () => {
  const text = worktreeGraphInstruction();
  assert.match(text, /graphify-out/, 'points at graphify-out/');
  assert.match(text, /AST-only|structural/i, 'calls out AST-only nature');
  assert.match(text, /graphify query/, 'lists query');
  assert.match(text, /graphify explain/, 'lists explain');
  assert.match(text, /graphify path/, 'lists path');
  assert.doesNotMatch(text, /<projectDir>/, 'no dead placeholder');
  assert.doesNotMatch(text, /Skill\(/, 'CLI workflow, not the Skill tool');
});

test('runGraphifyUpdate: success — runs in cwd and targets the dir arg', POSIX_SHIM, async () => {
  const binDir = await makeTmpDir('worca-cc-bin-');
  const work = await makeTmpDir('worca-cc-work-');   // the dir arg (target)
  const cwd = await makeTmpDir('worca-cc-cwd-');      // the spawn cwd
  // Fake graphify: prove it received the dir as argv[2] and ran in `cwd`.
  await fakeGraphify(
    binDir,
    '#!/bin/sh\nmkdir -p "$2/graphify-out"\ntouch "$PWD/ran-here"\nexit 0\n',
  );
  const prevPath = process.env.PATH;
  process.env.PATH = binDir + ':' + prevPath; // keep /usr/bin:/bin so mkdir/touch resolve
  try {
    const res = await runGraphifyUpdate({ dir: work, cwd, timeoutMs: 10000 });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.timedOut, false);
    assert.ok(existsSync(join(work, 'graphify-out')), 'graph built under the dir arg');
    assert.ok(existsSync(join(cwd, 'ran-here')), 'spawned with cwd=cwd');
  } finally {
    process.env.PATH = prevPath;
  }
});

test('runGraphifyUpdate: missing binary → ok:false, never throws', async () => {
  const work = await makeTmpDir('worca-cc-work-');
  const prevPath = process.env.PATH;
  process.env.PATH = ''; // nothing named graphify resolvable (intentional)
  try {
    const res = await runGraphifyUpdate({ dir: work, cwd: work, timeoutMs: 10000 });
    assert.equal(res.ok, false);
  } finally {
    process.env.PATH = prevPath;
  }
});

test('runGraphifyUpdate: non-zero exit → ok:false, timedOut:false (clean failure)', POSIX_SHIM, async () => {
  const binDir = await makeTmpDir('worca-cc-bin-');
  const work = await makeTmpDir('worca-cc-work-');
  // Binary runs and FAILS — exercises the close(code!==0) branch, distinct from
  // both the missing-binary (spawn error) and the timeout (SIGKILL) paths.
  await fakeGraphify(binDir, '#!/bin/sh\necho "boom" 1>&2\nexit 1\n');
  const prevPath = process.env.PATH;
  process.env.PATH = binDir + ':' + prevPath;
  try {
    const res = await runGraphifyUpdate({ dir: work, cwd: work, timeoutMs: 10000 });
    assert.equal(res.ok, false);
    assert.equal(res.timedOut, false);
    assert.equal(res.code, 1, 'reports the child exit code');
  } finally {
    process.env.PATH = prevPath;
  }
});

test('runGraphifyUpdate: overrun is killed and reported as timedOut', POSIX_SHIM, async () => {
  const binDir = await makeTmpDir('worca-cc-bin-');
  const work = await makeTmpDir('worca-cc-work-');
  await fakeGraphify(binDir, '#!/bin/sh\nsleep 5\nexit 0\n');
  const prevPath = process.env.PATH;
  process.env.PATH = binDir + ':' + prevPath; // keep /usr/bin:/bin so `sleep` resolves and blocks
  try {
    const res = await runGraphifyUpdate({ dir: work, cwd: work, timeoutMs: 200 });
    assert.equal(res.ok, false);
    assert.equal(res.timedOut, true);
  } finally {
    process.env.PATH = prevPath;
  }
});

// --- constructor timeout resolution (spec open question: default + configurable) ---

test('graphBuildTimeoutMs: defaults to 120000 when neither option nor env is set', async () => {
  const dir = await makeTmpDir();
  const prev = process.env.WORCA_GRAPH_TIMEOUT_MS;
  delete process.env.WORCA_GRAPH_TIMEOUT_MS;
  try {
    const orch = createOrchestrator({ projectDir: dir, prompt: 'x', claude: { mock: true } });
    assert.equal(orch.graphBuildTimeoutMs, 120000);
  } finally {
    if (prev === undefined) delete process.env.WORCA_GRAPH_TIMEOUT_MS;
    else process.env.WORCA_GRAPH_TIMEOUT_MS = prev;
  }
});

test('graphBuildTimeoutMs: option / env / precedence / invalid-env fallback', async () => {
  const dir = await makeTmpDir();
  const mk = (extra) =>
    createOrchestrator({ projectDir: dir, prompt: 'x', claude: { mock: true }, ...extra });
  const prev = process.env.WORCA_GRAPH_TIMEOUT_MS;
  try {
    // Constructor option wins outright (no env).
    delete process.env.WORCA_GRAPH_TIMEOUT_MS;
    assert.equal(mk({ graphBuildTimeoutMs: 5000 }).graphBuildTimeoutMs, 5000, 'option used');
    // Env is used when no option is given.
    process.env.WORCA_GRAPH_TIMEOUT_MS = '7000';
    assert.equal(mk({}).graphBuildTimeoutMs, 7000, 'env used when no option');
    // Option beats env.
    assert.equal(mk({ graphBuildTimeoutMs: 5000 }).graphBuildTimeoutMs, 5000, 'option beats env');
    // Invalid env falls back to the default.
    process.env.WORCA_GRAPH_TIMEOUT_MS = 'not-a-number';
    assert.equal(mk({}).graphBuildTimeoutMs, 120000, 'invalid env → default');
  } finally {
    if (prev === undefined) delete process.env.WORCA_GRAPH_TIMEOUT_MS;
    else process.env.WORCA_GRAPH_TIMEOUT_MS = prev;
  }
});

// --- _buildWorktreeGraph decision logic, exercised on the raw instance (no full run) ---

function newOrch(projectDir) {
  return createOrchestrator({ projectDir, prompt: 'x', auto: true, claude: { mock: false } });
}

test('_buildWorktreeGraph: mock mode skips the build (offline smoke stays clean)', async () => {
  const dir = await makeTmpDir();
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', claude: { mock: true } });
  orch.workDir = await makeTmpDir(); // pretend a worktree exists
  orch.state.tools = { kind: 'cli' };
  orch.pipeline = { dir }; // appendAudit/_log target
  orch.toolInstruction = 'SENTINEL';
  await orch._buildWorktreeGraph();
  assert.equal(orch.toolInstruction, 'SENTINEL', 'mock must not touch the instruction');
});

test('_buildWorktreeGraph: no worktree (workDir===projectDir) skips', async () => {
  const dir = await makeTmpDir();
  const orch = newOrch(dir);
  // workDir defaults to projectDir until _setupRunRoot runs.
  orch.state.tools = { kind: 'cli' };
  orch.pipeline = { dir };
  orch.toolInstruction = 'SENTINEL';
  await orch._buildWorktreeGraph();
  assert.equal(orch.toolInstruction, 'SENTINEL');
});

test('_buildWorktreeGraph: graphify not on PATH (kind!=cli) clears the instruction', async () => {
  const dir = await makeTmpDir();
  const orch = newOrch(dir);
  orch.workDir = await makeTmpDir();
  orch.state.tools = { kind: 'skill' };
  orch.pipeline = { dir };
  orch.toolInstruction = 'SENTINEL';
  await orch._buildWorktreeGraph();
  assert.equal(orch.toolInstruction, '');
});

test('_buildWorktreeGraph: build failure clears the instruction and logs a warning (fail-safe + observable)', async () => {
  const dir = await makeTmpDir();
  const work = await makeTmpDir('worca-cc-work-');
  const binDir = await makeTmpDir('worca-cc-bin-');
  await fakeGraphify(binDir, '#!/bin/sh\necho "kaboom" 1>&2\nexit 1\n'); // on PATH, but fails
  const orch = newOrch(dir);
  orch.workDir = work;
  orch.state.tools = { kind: 'cli' };
  orch.pipeline = { dir };
  orch.toolInstruction = 'SENTINEL';
  // Spy on _log to prove the failure is observable (spec: emit an event on failure).
  const logs = [];
  orch._log = (source, level, text) => logs.push({ source, level, text });
  const prevPath = process.env.PATH;
  process.env.PATH = binDir + ':' + prevPath;
  try {
    await orch._buildWorktreeGraph(); // must NOT throw
  } finally {
    process.env.PATH = prevPath;
  }
  assert.equal(orch.toolInstruction, '', 'instruction cleared on build failure');
  assert.ok(
    logs.some((l) => l.level === 'warn' && /fail|timed out/i.test(l.text)),
    'a warn-level failure event was logged',
  );
});

test('_buildWorktreeGraph: success builds in the worktree and sets the worktree instruction', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const work = await makeTmpDir('worca-cc-work-');
  const binDir = await makeTmpDir('worca-cc-bin-');
  await fakeGraphify(binDir, '#!/bin/sh\nmkdir -p "$2/graphify-out"\nexit 0\n');
  const orch = newOrch(dir);
  orch.workDir = work;
  orch.state.tools = { kind: 'cli' };
  orch.pipeline = { dir }; // appendAudit writes here
  orch.toolInstruction = 'SENTINEL';
  const prevPath = process.env.PATH;
  process.env.PATH = binDir + ':' + prevPath; // keep /usr/bin:/bin so `mkdir` resolves
  try {
    await orch._buildWorktreeGraph();
  } finally {
    process.env.PATH = prevPath;
  }
  assert.equal(orch.toolInstruction, worktreeGraphInstruction());
  assert.ok(existsSync(join(work, 'graphify-out')), 'graph built inside the worktree');
});

test('_buildWorktreeGraph: success is fail-safe even when the audit write fails', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const work = await makeTmpDir('worca-cc-work-');
  const binDir = await makeTmpDir('worca-cc-bin-');
  await fakeGraphify(binDir, '#!/bin/sh\nmkdir -p "$2/graphify-out"\nexit 0\n');
  const orch = newOrch(dir);
  orch.workDir = work;
  orch.state.tools = { kind: 'cli' };
  // pipeline.dir is a FILE, so appendAudit's write rejects (ENOTDIR) — the method must still not throw.
  const notADir = join(await makeTmpDir('worca-cc-pipe-'), 'iam-a-file');
  writeFileSync(notADir, 'x');
  orch.pipeline = { dir: notADir };
  orch.toolInstruction = 'SENTINEL';
  const prevPath = process.env.PATH;
  process.env.PATH = binDir + ':' + prevPath;
  try {
    await orch._buildWorktreeGraph(); // must NOT throw despite the failing audit write
  } finally {
    process.env.PATH = prevPath;
  }
  assert.equal(orch.toolInstruction, worktreeGraphInstruction(), 'instruction still set on success');
  assert.ok(existsSync(join(work, 'graphify-out')), 'graph still built inside the worktree');
});

// ── §5.2 step 6: the two graph-build paths must NOT be unified ────────────────
// _buildWorktreeGraph (single) is the ONLY writer of the scalar this.toolInstruction
// that every execution consumes via _execCtx.toolInstruction -> buildSystemPrompt.
// _buildWorktreeGraphAll (workspace) fills only the toolInstructions MAP. Collapsing
// single mode into the workspace helper would silently strip in-worktree graphify
// grounding from every single-project prompt — this is the regression guard for the
// collapse that must not happen, asserted on the ctx a real node receives.
test('a single-project run\'s node ctx still carries worktreeGraphInstruction() after the relocation', POSIX_SHIM, async () => {
  for (const mode of ['legacy', 'detached']) {
    const prev = process.env.WORCA_RUN_ROOT;
    process.env.WORCA_RUN_ROOT = mode;
    try {
      const repo = await freshRepoIgnoringGraph();
      const pipelineDir = await makeTmpDir('worca-cc-pipe-');
      const binDir = await makeTmpDir('worca-cc-bin-');
      await fakeGraphify(binDir, '#!/bin/sh\nmkdir -p "$2/graphify-out"\nexit 0\n');
      const orch = createOrchestrator({
        projectDir: repo, prompt: 'x', auto: true, claude: { mock: false },
        branch: { source: 'main', feature: `feat/graph-ctx-${mode}` },
      });
      orch.pipeline = { id: `pg${mode}`, dir: pipelineDir, promptText: 'x' };
      orch.state.id = orch.pipeline.id;
      orch.state.pipelineDir = pipelineDir;
      orch.state.tools = { kind: 'cli' };
      await orch._setupRunRoot();
      const prevPath = process.env.PATH;
      process.env.PATH = binDir + ':' + prevPath;
      try {
        await orch._buildWorktreeGraph();       // the single-project path, as run() calls it
      } finally {
        process.env.PATH = prevPath;
      }
      assert.equal(orch.toolInstruction, worktreeGraphInstruction(),
        `[${mode}] the scalar instruction is set by the single-project graph build`);
      // The value a dispatched execution actually receives. _execCtx reads
      // this.resolved.ports(node) and allocates the node's outputs, so the
      // minimum stub is a port-less node.
      orch.resolved = { ports: () => ({ inputs: [], outputs: [] }) };
      const node = { id: 'n1', kind: 'agent', key: 'implementer', config: {} };
      const ctx = orch._execCtx(node, { key: 'implementer' }, { executionId: 'x:n1:1', ordinal: 1 });
      assert.equal(ctx.toolInstruction, worktreeGraphInstruction(),
        `[${mode}] the execution ctx carries it`);
      assert.equal(ctx.projectDir, orch.runCwd, `[${mode}] and cwd is the run cwd`);
      assert.ok(existsSync(join(orch.runCwd, 'graphify-out')),
        `[${mode}] the graph was built INSIDE the worktree the node runs in`);
      // Teardown so nothing leaks out of the test.
      orch.state.status = 'done';
      await orch._teardownRunRoot();
    } finally {
      if (prev === undefined) delete process.env.WORCA_RUN_ROOT;
      else process.env.WORCA_RUN_ROOT = prev;
    }
  }
});

// A real git repo whose tracked .gitignore excludes graphify-out/ (mirrors the
// product repo), so the worktree checkout inherits the ignore rule.
async function freshRepoIgnoringGraph() {
  const dir = await makeTmpDir('worca-cc-int-');
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'seed.txt'), 'seed\n', 'utf8');
  await writeFile(join(dir, '.gitignore'), 'node_modules/\ngraphify-out/\n', 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

test('integration: in-worktree graph is present but never leaks (reviewer diff, kept commit, main)', async () => {
  const repo = await freshRepoIgnoringGraph();
  const pipelineDir = await makeTmpDir('worca-cc-pipe-');
  const orch = createOrchestrator({
    projectDir: repo,
    prompt: 'integration',
    auto: true,
    claude: { mock: true },
    branch: { source: 'main', feature: 'feat/graph-int' },
  });
  // Minimal real preflight state that _setupRunRoot/_commitWork rely on.
  orch.pipeline = { id: 'p-int', dir: pipelineDir, promptText: 'integration' };
  orch.state.id = 'p-int';
  orch.state.pipelineDir = pipelineDir;
  // The reviewer diffs against the checkpoint; main's HEAD is exactly that base.
  orch.checkpointRef = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD']).stdout.toString().trim();

  // Real worktree off main (checks out the tracked .gitignore). Unpinned mode: this
  // assertion set is mode-agnostic (it drives the worktree, not its location), and
  // the default is `legacy` through Phase 4.
  await orch._setupRunRoot();
  const wt = orch.workDir;
  assert.notEqual(wt, repo, 'a worktree should have been created');

  // Stand in for _buildWorktreeGraph's output + a real agent edit.
  mkdirSync(join(wt, 'graphify-out'), { recursive: true });
  writeFileSync(join(wt, 'graphify-out', 'graph.json'), '{}\n');
  writeFileSync(join(wt, 'graphify-out', 'GRAPH_REPORT.md'), '# report\n');
  writeFileSync(join(wt, 'agent-output.txt'), 'work from the agent\n');

  // (a) the graph is physically present in the worktree.
  assert.ok(existsSync(join(wt, 'graphify-out', 'graph.json')), '(a) graph built inside the worktree');

  // (b) reviewer surface: stage intent-to-add, then diff against the checkpoint.
  await orch._stageWorkingTree();
  const diff = spawnSync('git', ['-C', wt, 'diff', '--name-only', orch.checkpointRef]).stdout.toString();
  assert.match(diff, /agent-output\.txt/, '(b) reviewer diff includes the agent edit');
  assert.doesNotMatch(diff, /graphify-out/, '(b) reviewer diff EXCLUDES the gitignored graph');

  // Keep + commit the branch the way teardown does on success.
  orch.state.status = 'done';
  await orch._teardownWorktree();
  assert.ok(!existsSync(wt), 'worktree dir removed at teardown');
  const feature = orch.getState().branch.feature;

  // (c) kept-branch commit carries the agent file but NOT the graph.
  const fileInCommit = spawnSync('git', ['-C', repo, 'show', `${feature}:agent-output.txt`]);
  assert.equal(fileInCommit.status, 0, '(c) agent-output.txt committed on the kept branch');
  const graphInCommit = spawnSync('git', ['-C', repo, 'show', `${feature}:graphify-out/graph.json`]);
  assert.notEqual(graphInCommit.status, 0, '(c) graphify-out is NOT in the kept-branch commit');

  // (d) main is untouched: never had the graph, in its tree or on disk.
  const graphOnMain = spawnSync('git', ['-C', repo, 'show', 'main:graphify-out/graph.json']);
  assert.notEqual(graphOnMain.status, 0, '(d) main tree has no graphify-out');
  assert.ok(!existsSync(join(repo, 'graphify-out')), '(d) main working dir has no graphify-out');
});
