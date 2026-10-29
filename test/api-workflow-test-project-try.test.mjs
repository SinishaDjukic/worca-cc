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
  assert.deepEqual(o._excludePathspecs('pk'), [':(exclude).claude/rules/worca', ':(exclude)setup-out', ':(exclude)dist']);
  o.injectedPaths = {};
  assert.deepEqual(o._excludePathspecs('pk'), [':(exclude)setup-out', ':(exclude)dist']);
});
