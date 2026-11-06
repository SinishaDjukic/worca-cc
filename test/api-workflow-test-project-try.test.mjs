// test/api-workflow-test-project-try.test.mjs — workflow tests 3a, Task 4 (D42, D43, D55): one project try through the run
// handler (mock engine). It runs in Worca's copy under the real key, is hidden like a Part 2 try, runs its setup first,
// keeps its checkout for its checks, and leaves the person's repository as it was. A normal run is unchanged.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { repoSnapshot } from './helpers/repo-snapshot.mjs';
import { runSettled } from './helpers/run-settled.mjs';

useTempHome(after);
let homeDir, wh, prevHome, prevEnv, srv, base, runs, _testing, artifacts, real, key, pin, copyDir, settled;
const frames = [];
const extra = [];
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b || {}) });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const GRAPH = {
  version: 2, id: 'wf_ptry', name: 'Fix a bug', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } }],
};
const SETUP_OK = 'node -e "const f=require(\'fs\');f.mkdirSync(\'node_modules/x\',{recursive:true});f.writeFileSync(\'node_modules/x/y.txt\',\'x\');f.mkdirSync(\'setup-out\',{recursive:true});f.writeFileSync(\'setup-out/z.txt\',\'z\')"';

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftptry-'));
  wh = join(homeDir, '.worca-cc');   // worcaHome() is <WORCA_HOME>/.worca-cc (src/core/projects.mjs)
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'workflowTests';
  const mod = await import('../ui/server.mjs');
  ({ runs, _testing } = mod);
  settled = runSettled({ runs, answerRun: _testing.answerRun });
  artifacts = await import('../src/core/artifacts.mjs');
  _testing.sockets.add({ readyState: 1, OPEN: 1, send: (t) => frames.push(JSON.parse(t)) });
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  real = templateRepo('wftptry', { branch: 'main', user: true, files: { '.gitignore': 'node_modules/\n', 'README.md': '# hi\n' } });
  extra.push(real);
  const { insertProject } = await import('../src/core/projects.mjs');
  insertProject({ name: 'tickets', path: real });
  key = (await import('../src/core/store.mjs')).projectKey(real);
  const { pinStart } = await import('../src/core/workflow-tests/project-copy.mjs');
  pin = await pinStart({ key, name: 'tickets', projectDir: real });
  copyDir = join(wh, 'workflow-tests', 'repos', key);
  assert.ok(existsSync(join(copyDir, '.git')), 'pinStart made the copy');
  assert.equal((await post('/api/workflows', GRAPH)).status, 201);
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const [k, v] of Object.entries(prevEnv || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete process.env.WORCA_MOCK; delete process.env.WORCA_FLAGS;
  for (const d of [homeDir, ...extra]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const tryBody = async (over = {}) => {
  const { tryRunBody } = await import('../src/core/workflow-tests/try-body.mjs');
  return { ...tryRunBody({ name: 'Ticket 482', request: 'Fix the rounding.' }, [], { workflowId: 'wf_ptry', tryNo: 1,
    project: { copyDir, startCommit: pin.startCommit } }), ...over };
};

test('the run body of a project try: Worca\'s copy, from the start commit', async () => {
  const b = await tryBody();
  assert.deepEqual(b, { projectDir: copyDir, sourceBranch: pin.startCommit, workflowId: 'wf_ptry', prompt: 'Fix the rounding.',
    title: 'Test: Ticket 482 · try 1', extras: [] });
  const { tryRunBody } = await import('../src/core/workflow-tests/try-body.mjs');
  assert.equal(tryRunBody({ name: 'x', request: 'y' }, [], { workflowId: 'wf_ptry', tryNo: 1 }).noProject, true, 'Part 2 unchanged');
});

test('a try names its folder: without a project, or Worca\'s copy of the project it names', async () => {
  const TEXT = "a test try runs without a project, or in Worca's copy of one";
  const own = await _testing.invokeStartRun({ ...(await tryBody()), projectDir: real }, null, { workflowTest: { use: 'draft', project: { key, setupCmd: null } } });
  assert.deepEqual([own.status, own.body.error], [400, TEXT], 'never the person\'s folder');
  const noKey = await _testing.invokeStartRun(await tryBody(), null, { workflowTest: { use: 'draft' } });
  assert.deepEqual([noKey.status, noKey.body.error], [400, TEXT]);
  const otherKey = await _testing.invokeStartRun(await tryBody(), null, { workflowTest: { use: 'draft', project: { key: 'other-1234abcd', setupCmd: null } } });
  assert.deepEqual([otherKey.status, otherKey.body.error], [400, TEXT], 'the copy of the project it names');
  for (const bad of [null, undefined, '', 'Not A Key']) {
    const r = await _testing.invokeStartRun({ ...(await tryBody()), projectDir: real }, null, { workflowTest: { use: 'draft', project: { key: bad, setupCmd: null } } });
    assert.deepEqual([r.status, r.body.error], [400, TEXT], `a project key ${JSON.stringify(bad)} never lets the person's folder through`);
  }
  const same = await _testing.invokeStartRun(await tryBody({ sameAsSource: true }), null, { workflowTest: { use: 'draft', project: { key, setupCmd: null } } });
  assert.deepEqual([same.status, same.body.error], [400, 'a test try starts now, on a branch of its own']);
  const twoLines = await _testing.invokeStartRun(await tryBody(), null, { workflowTest: { use: 'draft', project: { key, setupCmd: 'npm ci\nrm -rf /' } } });
  assert.deepEqual([twoLines.status, twoLines.body.error], [400, 'a test try names its setup command on one line']);
});

test('a project try: the real key, hidden, setup first, its checkout kept, setup output out of the diff, the project only read', { timeout: 240000 }, async () => {
  const was = repoSnapshot(real);
  const out = await _testing.invokeStartRun(await tryBody(), null, { workflowTest: { use: 'draft', project: { key, setupCmd: SETUP_OK } } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const { runId } = out.body;                     // a project run's body carries only runId; the entry has the pipeline id
  const entry = await settled(runId);
  const { pipelineId } = entry;
  assert.equal(entry.isTest, true);
  const row = artifacts.findPipelineRowById(pipelineId);
  assert.deepEqual([row.is_test, row.project_key, row.status], [1, key, 'done']);
  const br = JSON.parse(row.branch);
  assert.equal(br.baseSha, pin.startCommit);
  assert.equal(br.worktreeKept, true);
  assert.equal(br.worktreeRemoved, undefined, 'never stamped removed');
  assert.ok(existsSync(br.worktreeDir), 'kept for the checks');
  assert.ok(existsSync(join(wh, 'runs', pipelineId)), 'and so is its run root');
  assert.ok(existsSync(join(br.worktreeDir, 'setup-out', 'z.txt')), 'the setup ran in the checkout');
  const { readTrySetup } = await import('../src/core/workflow-tests/shell-step.mjs');
  const setup = await readTrySetup(entry.orch.pipeline.dir);
  assert.deepEqual([setup.ok, setup.exitCode, setup.cmd], [true, 0, SETUP_OK]);
  const results = JSON.parse(readFileSync(join(entry.orch.pipeline.dir, 'results.json'), 'utf8'));
  const paths = [...results.newFiles, ...results.changedFiles].map((f) => f.path);
  assert.ok(paths.includes('src/feature.mjs'), 'the mock implementer\'s work is the try\'s change');
  assert.ok(!paths.some((p) => p.startsWith('setup-out/') || p.startsWith('node_modules/')), 'what the setup made is not');
  const committed = git(copyDir, 'ls-tree', '-r', '--name-only', br.feature);
  assert.match(committed, /src\/feature\.mjs/, 'the work is committed on the try\'s branch in the copy');
  assert.doesNotMatch(committed, /setup-out/, 'the setup\'s output is not');
  assert.ok(!frames.some((f) => f.runId === runId), 'no frame of the try reached a tab');
  assert.ok(!_testing.summarizeRuns().some((r) => r.runId === runId), 'not in the hello');
  const h = await (await fetch(`${base}/api/history`)).json();
  assert.ok(!h.pipelines.some((p) => p.id === pipelineId));
  assert.equal(repoSnapshot(real), was, 'nothing in the person\'s repository changed');
});

test('F3: a stored "git is missing" answer is probed once more before a project try is refused', { timeout: 240000 }, async (t) => {
  const ga = await import('../src/core/git-available.mjs');
  const saved = process.env.WORCA_GIT; delete process.env.WORCA_GIT;   // the suite's WORCA_GIT=1 would answer for the stored state
  t.after(() => { if (saved === undefined) delete process.env.WORCA_GIT; else process.env.WORCA_GIT = saved; ga._testing.reset(); });
  ga._testing.reset();
  ga._testing.set({ available: false, reason: 'probe-failed', checkedAt: Date.now() });   // a recent failure: inside the 60 s cache
  let n = 0;
  ga._testing.useProbe(async () => { n += 1; return { available: true, path: 'git', version: '2.43.0', reason: 'ok', checkedAt: Date.now() }; });
  const out = await _testing.invokeStartRun(await tryBody({ title: 'Test: Ticket 482 · try 7' }), null, { workflowTest: { use: 'draft', project: { key, setupCmd: null } } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(n, 1, 'one fresh probe before refusing');
  assert.equal(ga.gitAvailable(), true);
  await settled(out.body.runId);
});

test('a project try is refused when a fresh probe also finds no git: the words say what to do', async (t) => {
  const ga = await import('../src/core/git-available.mjs');
  const saved = process.env.WORCA_GIT; delete process.env.WORCA_GIT;
  t.after(() => { if (saved === undefined) delete process.env.WORCA_GIT; else process.env.WORCA_GIT = saved; ga._testing.reset(); });
  ga._testing.reset();
  ga._testing.set({ available: false, reason: 'not-on-path', checkedAt: Date.now() });
  let n = 0;
  ga._testing.useProbe(async () => { n += 1; return { available: false, path: null, version: null, reason: 'not-on-path', checkedAt: Date.now() }; });
  const out = await _testing.invokeStartRun(await tryBody(), null, { workflowTest: { use: 'draft', project: { key, setupCmd: null } } });
  assert.deepEqual([out.status, out.body.error, n], [400,
    'a project try needs git, and Worca cannot find git on this computer. Install git, then choose Finish the rest', 1]);
});

test('a setup that fails ends the try as a setup failure, before any step', { timeout: 240000 }, async () => {
  const out = await _testing.invokeStartRun(await tryBody({ title: 'Test: Ticket 482 · try 2' }), null,
    { workflowTest: { use: 'draft', project: { key, setupCmd: 'node -e "process.exit(3)"' } } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const entry = await settled(out.body.runId);
  const row = artifacts.findPipelineRowById(entry.pipelineId);
  assert.equal(row.status, 'error');
  const { setupFailedText } = await import('../src/shared/workflow-tests/project-text.mjs');
  assert.ok(entry.events.some((e) => e.type === 'error' && e.message === setupFailedText('node -e "process.exit(3)"')),
    JSON.stringify(entry.events.filter((e) => e.type === 'error')));
  const { readTrySetup } = await import('../src/core/workflow-tests/shell-step.mjs');
  const setup = await readTrySetup(entry.orch.pipeline.dir);
  assert.deepEqual([setup.ok, setup.exitCode, setup.cmd], [false, 3, 'node -e "process.exit(3)"']);
  assert.equal(existsSync(join(entry.orch.pipeline.dir, 'results.json')), false, 'no step ran, nothing changed');
  assert.ok(existsSync(JSON.parse(row.branch).worktreeDir), 'kept: the runner removes it');
});

test('a normal git run is unchanged: its checkout and run root go at teardown', { timeout: 240000 }, async () => {
  const other = templateRepo('wftpnormal', { branch: 'main', user: true, files: { 'README.md': '# n\n' } });
  extra.push(other);
  const out = await _testing.invokeStartRun({ projectDir: other, prompt: 'Add a feature', title: 'Normal run', workflowId: 'wf_ptry' }, null, {});
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const entry = await settled(out.body.runId);
  assert.equal(entry.isTest, undefined);
  for (const k of ['keepCheckout', 'trySetup', 'workflowTest']) assert.equal(entry.orch.opts[k], undefined, `no ${k} on a normal run`);
  assert.equal(entry.orch._trySetupPaths, undefined);
  const row = artifacts.findPipelineRowById(entry.pipelineId);
  const br = JSON.parse(row.branch);
  assert.equal(br.worktreeKept, undefined);
  assert.equal(br.worktreeRemoved, true);
  assert.equal(existsSync(br.worktreeDir), false);
  assert.equal(existsSync(join(wh, 'runs', entry.pipelineId)), false);
  assert.equal(row.is_test, null);
});

test('_excludePathspecs: unchanged without a setup, the setup\'s paths added after the injected ones', async () => {
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const o = createOrchestrator({ projectDir: join(tmpdir(), 'wftptry-unit'), claude: { mock: true } });
  o.injectedPaths = {};
  assert.deepEqual(o._excludePathspecs('pk'), []);
  o.injectedPaths = { pk: [{ path: '.claude/rules/worca', kind: 'memory' }, { path: 'CLAUDE.md', kind: 'claudeMdSection' }] };
  assert.deepEqual(o._excludePathspecs('pk'), [':(exclude).claude/rules/worca']);
  o._trySetupPaths = ['setup-out', 'dist'];
  assert.deepEqual(o._excludePathspecs('pk'), [':(exclude).claude/rules/worca', ':(exclude,literal)setup-out', ':(exclude,literal)dist']);
  o.injectedPaths = {};
  assert.deepEqual(o._excludePathspecs('pk'), [':(exclude,literal)setup-out', ':(exclude,literal)dist']);
  o._trySetupPaths = ['a*b', 'c?[d]'];
  assert.deepEqual(o._excludePathspecs('pk'), [':(exclude,literal)a*b', ':(exclude,literal)c?[d]'], 'never a pattern');
});

test('final review: the setup runs only in the try\'s checkout; an unknown checkout is an error, never the copy\'s folder', async () => {
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const o = createOrchestrator({ projectDir: copyDir, claude: { mock: true }, workflowTest: true, trySetup: { cmd: 'node -e "1"', timeoutMs: 60000 } });
  o.workDirs = new Map();
  o.runCwd = copyDir; o.workDir = copyDir;   // what the old fallback reached for
  o.pipeline = { id: 'x', dir: join(homeDir, 'nope') };
  await assert.rejects(o._runTrySetup(), { code: 'TRY_SETUP_NO_CHECKOUT' });
  assert.equal(o.state.setupStage ?? null, null, 'no setup stage was entered');
});

test('_untrackedDirs: a git failure and a list cut at 200 are logged', async () => {
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const o = createOrchestrator({ projectDir: join(tmpdir(), 'wftptry-unit2'), claude: { mock: true } });
  const logged = [];
  o._log = (scope, level, msg) => logged.push([scope, level, msg]);
  o._git = async () => ({ ok: false, code: 128, stdout: '', stderr: 'fatal: boom' });
  assert.deepEqual(await o._untrackedDirs('x'), []);
  assert.ok(logged.some(([, level, msg]) => level === 'warn' && /git ls-files failed: fatal: boom/.test(msg)), JSON.stringify(logged));
  logged.length = 0;
  const many = Array.from({ length: 205 }, (_, i) => `d${i}/`);
  o._git = async () => ({ ok: true, code: 0, stdout: `${many.join('\0')}\0`, stderr: '' });
  const got = await o._untrackedDirs('x');
  assert.equal(got.length, 200);
  assert.equal(got[0], 'd0');
  assert.ok(logged.some(([, level, msg]) => level === 'warn' && /205 new paths; only the first 200/.test(msg)), JSON.stringify(logged));
  logged.length = 0;
  o._git = async () => ({ ok: true, code: 0, stdout: 'setup-out/\0', stderr: '' });
  assert.deepEqual(await o._untrackedDirs('x'), ['setup-out']);
  assert.deepEqual(logged, [], 'nothing to say');
});

test('a stop during the setup ends the try stopped, not as a setup failure', { timeout: 240000 }, async () => {
  const cmd = 'node -e "setTimeout(() => {}, 120000)"';
  const out = await _testing.invokeStartRun(await tryBody({ title: 'Test: Ticket 482 · try 3' }), null,
    { workflowTest: { use: 'draft', project: { key, setupCmd: cmd } } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const { TRY_SETUP_STAGE, readTrySetup } = await import('../src/core/workflow-tests/shell-step.mjs');
  const t0 = Date.now();
  let entry = runs.get(out.body.runId);
  while (entry.orch.state.setupStage !== TRY_SETUP_STAGE) {
    assert.ok(!entry.settled && Date.now() - t0 < 120000, `the setup never started: ${entry.orch.state.setupStage}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  const stoppedAt = Date.now();
  entry.orch.stop();
  entry = await settled(out.body.runId);
  assert.ok(Date.now() - stoppedAt < 60000, 'the setup command was stopped, not waited out');
  const row = artifacts.findPipelineRowById(entry.pipelineId);
  assert.equal(row.status, 'stopped');
  const { setupFailedText } = await import('../src/shared/workflow-tests/project-text.mjs');
  assert.ok(!entry.events.some((e) => e.type === 'error' && e.message === setupFailedText(cmd)), 'not a setup failure');
  assert.equal(await readTrySetup(entry.orch.pipeline.dir), null, 'no setup record: the setup did not fail, it was stopped');
  assert.ok(existsSync(JSON.parse(row.branch).worktreeDir), 'kept: the runner removes it');
});

test('run-root mode legacy: a try still keeps its checkout under its run root; a normal run keeps legacy', { timeout: 300000 }, async () => {
  const prev = process.env.WORCA_RUN_ROOT;
  process.env.WORCA_RUN_ROOT = 'legacy';
  try {
    const out = await _testing.invokeStartRun(await tryBody({ title: 'Test: Ticket 482 · try 4' }), null,
      { workflowTest: { use: 'draft', project: { key, setupCmd: null } } });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const entry = await settled(out.body.runId);
    const row = artifacts.findPipelineRowById(entry.pipelineId);
    assert.equal(row.status, 'done');
    const br = JSON.parse(row.branch);
    assert.equal(br.runRootMode, 'detached', 'the legacy setting is ignored for a try');
    assert.equal(br.worktreeKept, true);
    assert.ok(String(br.worktreeDir).toLowerCase().startsWith(join(wh, 'runs', entry.pipelineId).toLowerCase()), br.worktreeDir);
    assert.ok(existsSync(br.worktreeDir), 'kept for the checks');

    const other = templateRepo('wftplegacy', { branch: 'main', user: true, files: { 'README.md': '# l\n' } });
    extra.push(other);
    const n = await _testing.invokeStartRun({ projectDir: other, prompt: 'Add a feature', title: 'Legacy run', workflowId: 'wf_ptry' }, null, {});
    assert.equal(n.status, 200, JSON.stringify(n.body));
    const ne = await settled(n.body.runId);
    const nbr = JSON.parse(artifacts.findPipelineRowById(ne.pipelineId).branch);
    assert.equal(nbr.runRootMode, 'legacy', 'a normal run keeps the legacy mode');
    assert.equal(nbr.worktreeKept, undefined);
    assert.equal(existsSync(nbr.worktreeDir), false, 'its checkout went at teardown');
    assert.equal(existsSync(join(wh, 'runs', ne.pipelineId)), false, 'no run root');
  } finally {
    if (prev === undefined) delete process.env.WORCA_RUN_ROOT; else process.env.WORCA_RUN_ROOT = prev;
  }
});

test('final review I2: hooks and an fsmonitor a setup leaves in the copy never run in Worca\'s own git, and the next test unsets them', { timeout: 240000 }, async () => {
  const { mkdirSync, writeFileSync, chmodSync } = await import('node:fs');
  const evil = join(homeDir, 'evil');
  const hooks = join(evil, 'hooks');
  mkdirSync(hooks, { recursive: true });
  const fw = (p) => p.replaceAll('\\', '/');
  const marker = fw(join(evil, 'ran.txt'));
  for (const h of ['pre-commit', 'commit-msg', 'prepare-commit-msg', 'post-commit', 'post-checkout']) {
    writeFileSync(join(hooks, h), `#!/bin/sh\necho "${h} $GH_TOKEN" >> "${marker}"\nexit 0\n`);
    try { chmodSync(join(hooks, h), 0o755); } catch { /* Windows */ }
  }
  const fsmon = join(evil, 'fsmon.sh');
  writeFileSync(fsmon, `#!/bin/sh\necho "fsmonitor $GH_TOKEN" >> "${marker}"\nexit 1\n`);
  try { chmodSync(fsmon, 0o755); } catch { /* Windows */ }
  // What husky's `prepare` (npm ci) does: it points the copy's shared config at the project's hooks.
  const setup = `git config core.hooksPath "${fw(hooks)}" && git config core.fsmonitor "${fw(fsmon)}"`;
  const prevTok = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'secret-token';
  try {
    const out = await _testing.invokeStartRun(await tryBody({ title: 'Test: Ticket 482 · try 5' }), null,
      { workflowTest: { use: 'draft', project: { key, setupCmd: setup } } });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const entry = await settled(out.body.runId);
    const row = artifacts.findPipelineRowById(entry.pipelineId);
    assert.equal(row.status, 'done');
    assert.equal(git(copyDir, 'config', 'core.hooksPath'), fw(hooks), 'the setup did set it (the scenario is real)');
    const br = JSON.parse(row.branch);
    assert.match(git(copyDir, 'ls-tree', '-r', '--name-only', br.feature), /src\/feature\.mjs/, 'the teardown commit still happened');
    assert.equal(existsSync(marker) ? readFileSync(marker, 'utf8') : '', '', 'no hook and no fsmonitor of the copy ran in Worca\'s git');
  } finally {
    if (prevTok === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = prevTok;
  }
  const { ensureStartCommit } = await import('../src/core/workflow-tests/project-copy.mjs');
  // P39 (round 4): the copy is reset when no try is running. The runner removes each try's checkout after its checks; the
  // tries of this file keep theirs, so remove them as the runner would.
  const { rmSync } = await import('node:fs');
  const main = git(copyDir, 'rev-parse', '--show-toplevel').toLowerCase();
  for (const l of git(copyDir, 'worktree', 'list', '--porcelain').split(/\r?\n/).filter((x) => x.startsWith('worktree '))) {
    const wp = l.slice('worktree '.length);
    if (wp.toLowerCase() !== main) rmSync(wp, { recursive: true, force: true });
  }
  await ensureStartCommit({ key, projectDir: real, project: pin });
  for (const k of ['core.hooksPath', 'core.fsmonitor']) assert.throws(() => git(copyDir, 'config', '--get', k), undefined, `${k} unset before the next test`);
});

test('final review round 2: a retained try\'s snapshot never runs the copy\'s filter or fsmonitor, nor gives them the token', { timeout: 240000 }, async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const fw = (p) => p.replaceAll('\\', '/');
  const evil = join(homeDir, 'evil2');
  mkdirSync(evil, { recursive: true });
  const marker = fw(join(evil, 'ran.txt'));
  // A clean filter that fails without GH_TOKEN: the teardown's add (guarded) fails, so the work is retained and the
  // retained-work snapshot runs `git add -A` again. It must not get the token either.
  const filter = join(evil, 'clean.sh');
  writeFileSync(filter, `#!/bin/sh\necho "clean $GH_TOKEN" >> "${marker}"\nif [ -z "$GH_TOKEN" ]; then exit 1; fi\ncat\n`);
  const fsmon = join(evil, 'fsmon.sh');
  writeFileSync(fsmon, `#!/bin/sh\necho "fsmonitor $GH_TOKEN" >> "${marker}"\nexit 1\n`);
  const setup = [
    `git config filter.x.clean "sh ${fw(filter)}"`, 'git config filter.x.smudge cat', 'git config filter.x.required true',
    `git config core.fsmonitor "sh ${fw(fsmon)}"`,
    'node -e "require(\'fs\').writeFileSync(\'.gitattributes\', \'*.mjs filter=x\')"',
  ].join(' && ');
  const prevTok = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'secret-token';
  try {
    const out = await _testing.invokeStartRun(await tryBody({ title: 'Test: Ticket 482 · try 6' }), null,
      { workflowTest: { use: 'draft', project: { key, setupCmd: setup } } });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const entry = await settled(out.body.runId);
    const row = artifacts.findPipelineRowById(entry.pipelineId);
    const br = JSON.parse(row.branch);
    assert.ok(br.commitFailed, `the guarded teardown add failed, so the work was retained: ${row.branch}`);
    const ran = existsSync(marker) ? readFileSync(marker, 'utf8') : '';
    // dev's security G2 (git-guard.mjs): Worca's git never lets the copy's local config pick a command, so neither the
    // filter nor the fsmonitor runs at all (before G2 they ran, only under the try guard).
    assert.doesNotMatch(ran, /^(clean|fsmonitor)/m, `no program of the copy ran:\n${ran}`);
    assert.doesNotMatch(ran, /secret-token/, `no program of the copy saw the token:\n${ran}`);
  } finally {
    if (prevTok === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = prevTok;
    try { git(copyDir, 'config', '--remove-section', 'filter.x'); } catch { /* not set */ }
    try { git(copyDir, 'config', '--unset', 'core.fsmonitor'); } catch { /* not set */ }
  }
});
