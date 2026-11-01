// test/api-workflow-test-project-stop.test.mjs — workflow tests 3a, final review C1: a project try that pauses and is
// stopped (the runner's deps.stopRun -> stopPausedPipeline -> stopPausedRun) never touches the person's repository. The
// project has an `origin` remote (a local bare repo) and has run normally before (its store meta names the real folder),
// so a base check that resolved to the real folder would fetch origin there (refs/remotes, FETCH_HEAD, objects).
// The checkout, base-check and update-branch routes refuse a test try's row (409).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { repoSnapshot } from './helpers/repo-snapshot.mjs';
import { runSettled } from './helpers/run-settled.mjs';

useTempHome(after);
let homeDir, prevHome, prevEnv, srv, base, runs, _testing, artifacts, real, key, pin, copyDir, settled, remoteDir;
const extra = [];
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b || {}) });
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
  { cwd, encoding: 'utf8' }).trim();
const GRAPH = {
  version: 2, id: 'wf_pstop', name: 'Fix a bug', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } }],
};

/** A teammate pushes a new commit to origin/main, so a fetch in the person's repo would change refs and objects. */
function teammatePush(n) {
  const b = mkdtempSync(join(tmpdir(), 'worca-cc-wftpstop-b-'));
  extra.push(b);
  execFileSync('git', ['clone', '-q', remoteDir, b]);
  writeFileSync(join(b, `team-${n}.txt`), `${n}\n`);
  git(b, 'add', '-A');
  git(b, 'commit', '-qm', `team ${n}`, '--no-verify');
  git(b, 'push', '-q', 'origin', 'HEAD:main');
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftpstop-'));
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
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  real = templateRepo('wftpstop', { branch: 'main', user: true, files: { '.gitignore': 'node_modules/\n', 'README.md': '# hi\n' } });
  extra.push(real);
  const r = await mkdtemp(join(tmpdir(), 'worca-cc-wftpstop-origin-'));
  extra.push(r);
  remoteDir = join(r, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remoteDir]);
  git(real, 'remote', 'add', 'origin', remoteDir);
  git(real, 'push', '-q', '-u', 'origin', 'main');
  const { insertProject } = await import('../src/core/projects.mjs');
  insertProject({ name: 'tickets', path: real });
  key = (await import('../src/core/store.mjs')).projectKey(real);
  assert.equal((await post('/api/workflows', GRAPH)).status, 201);
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const [k, v] of Object.entries(prevEnv || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete process.env.WORCA_MOCK; delete process.env.WORCA_FLAGS;
  for (const d of [homeDir, ...extra]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('a paused project try stopped by the runner leaves the person\'s repository as it was (no fetch, no base check)', { timeout: 300000 }, async () => {
  // The project has run normally before: its store meta names the real folder (what the old membersOfRow read).
  const n = await _testing.invokeStartRun({ projectDir: real, prompt: 'Add a feature', title: 'Normal run', workflowId: 'wf_pstop' }, null, {});
  assert.equal(n.status, 200, JSON.stringify(n.body));
  await settled(n.body.runId);
  assert.equal(artifacts.readStoreMeta(key)?.path && existsSync(artifacts.readStoreMeta(key).path), true, 'store meta names the real folder');

  const { pinStart } = await import('../src/core/workflow-tests/project-copy.mjs');
  pin = await pinStart({ key, name: 'tickets', projectDir: real });
  copyDir = join(homeDir, '.worca-cc', 'workflow-tests', 'repos', key);
  assert.ok(existsSync(join(copyDir, '.git')));
  teammatePush(1);   // origin moved on: a fetch in `real` would now write refs/remotes/origin/main, objects and FETCH_HEAD
  const was = repoSnapshot(real);

  const { tryRunBody } = await import('../src/core/workflow-tests/try-body.mjs');
  const body = tryRunBody({ name: 'Ticket 482', request: 'Fix the rounding.' }, [], { workflowId: 'wf_pstop', tryNo: 1,
    project: { copyDir, startCommit: pin.startCommit } });
  const out = await _testing.invokeStartRun(body, null, { workflowTest: { use: 'draft', project: { key, setupCmd: null },
    // The first agent step pauses the try (as a step error, a cost cap or a network pause would).
    onOrch: (orch) => {
      orch._runners.producer = async (ctx) => {
        queueMicrotask(() => orch.pause());
        return new Promise((_res, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      };
    } } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const t0 = Date.now();
  let entry = runs.get(out.body.runId);
  while (!(entry.status === 'paused' && entry.pipelineId && entry.settled)) {
    assert.ok(Date.now() - t0 < 120000, `the try never paused: ${entry.status}`);
    await new Promise((r) => setTimeout(r, 50));
    entry = runs.get(out.body.runId);
  }
  const pipelineId = entry.pipelineId;
  assert.equal(artifacts.findPipelineRowById(pipelineId).status, 'paused');

  const res = await _testing.stopPausedPipeline(pipelineId, 'worca');   // what the runner's deps.stopRun does for a paused try
  assert.equal(res.status, 'stopped');
  const row = artifacts.findPipelineRowById(pipelineId);
  assert.deepEqual([row.status, row.is_test], ['stopped', 1]);
  const br = JSON.parse(row.branch);
  assert.equal(br.baseCheck, undefined, 'a try is never checked against its base');
  assert.equal(repoSnapshot(real), was, 'nothing in the person\'s repository changed (refs, remotes, FETCH_HEAD, objects, worktrees, status)');
  assert.equal(existsSync(join(real, '.git', 'FETCH_HEAD')) ? 'kept' : 'absent', was.includes('FETCH_HEAD') ? 'kept' : 'absent');

  // The routes that act on a run's branch refuse a test try's row; they never resolve to the person's folder.
  const { TRY_STAYS_IN_COPY_TEXT } = await import('../src/shared/workflow-tests/project-text.mjs');
  const scope = `?projectDir=${encodeURIComponent(real)}`;
  for (const path of [`/api/runs/${pipelineId}/base-check${scope}`, `/api/runs/${pipelineId}/update-branch${scope}`,
    `/api/runs/${pipelineId}/checkout${scope}`]) {
    const r = await post(path, {});
    assert.equal(r.status, 409, path);
    assert.equal((await r.json()).error, TRY_STAYS_IN_COPY_TEXT, path);
  }
  assert.equal(repoSnapshot(real), was, 'and the routes changed nothing either');

  // Core: whatever reads a try's row resolves to Worca's copy, never the person's folder, and the base check refuses it.
  const { membersOfRow } = await import('../src/core/checkout.mjs');
  const { baseMembersOfRow, checkRunBase } = await import('../src/core/base-conflicts.mjs');
  assert.equal(membersOfRow(row)[0].projectDir, copyDir);
  assert.deepEqual(baseMembersOfRow(row), []);
  assert.deepEqual((await checkRunBase(pipelineId)).members, []);
  // Even a try row whose base reads as a branch name (a source the fetch would follow) is never checked or fetched.
  const { updateBranchRecords } = await import('../src/core/checkout.mjs');
  const { afterRunBaseCheck } = await import('../src/core/base-conflicts.mjs');
  updateBranchRecords(pipelineId, [key], (b) => { b.source = 'main'; });
  await afterRunBaseCheck(pipelineId);
  assert.deepEqual((await checkRunBase(pipelineId)).members, []);
  assert.equal(JSON.parse(artifacts.findPipelineRowById(pipelineId).branch).baseCheck, undefined);
  assert.equal(repoSnapshot(real), was);
});

test('a normal run\'s routes are not refused for that reason', async () => {
  const { TRY_STAYS_IN_COPY_TEXT } = await import('../src/shared/workflow-tests/project-text.mjs');
  const n = await _testing.invokeStartRun({ projectDir: real, prompt: 'Add a feature', title: 'Normal run 2', workflowId: 'wf_pstop' }, null, {});
  const e = await settled(n.body.runId);
  const scope = `?projectDir=${encodeURIComponent(real)}`;
  for (const path of [`/api/runs/${e.pipelineId}/base-check${scope}`, `/api/runs/${e.pipelineId}/update-branch${scope}`]) {
    const r = await post(path, {});
    assert.notEqual((await r.json()).error, TRY_STAYS_IN_COPY_TEXT, path);
  }
  const row = artifacts.findPipelineRowById(e.pipelineId);
  const { membersOfRow } = await import('../src/core/checkout.mjs');
  assert.equal(membersOfRow(row)[0].projectDir, artifacts.readStoreMeta(key).path, 'a normal row still resolves to its project');
});
