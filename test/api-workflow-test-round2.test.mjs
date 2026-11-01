// test/api-workflow-test-round2.test.mjs — workflow tests 3a, final review round 2: a test try's row never resolves to the
// person's folder. rowToState maps it to Worca's copy; Archive / Delete (one or bulk) only clean Worca's copy and run root
// and ask no forge; Discard and Apply to branch refuse it (409 TEST_TRY); Try it never picks it; the schedule's "after"
// list leaves it out. A normal run's paths are unchanged.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { repoSnapshot } from './helpers/repo-snapshot.mjs';

useTempHome(after);
let homeDir, prevHome, srv, base, project, key, artifacts, store;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b || {}) });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftr2-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_FLAGS = 'workflowTests';
  const mod = await import('../ui/server.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  project = templateRepo('wftr2', { branch: 'main', user: true, files: { 'README.md': '# r2\n' } });
  artifacts = await import('../src/core/artifacts.mjs');
  store = await import('../src/core/store.mjs');
  key = store.projectKey(project);
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_FLAGS;
  for (const d of [homeDir, project]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

/** A finished row of `project`; a test try's branch name also exists in the person's repository (a collision). */
async function seed(isTest, { feature, status = 'done', retained = false } = {}) {
  const now = new Date().toISOString();
  const { id, dir } = await artifacts.createPipeline(project, { prompt: 'p', title: isTest ? 'Test: x · try 1' : 'normal', isTest });
  const f = feature || `worca-cc/x-${id}`;
  await artifacts.writeState(dir, { projectKey: key, id, status, startedAt: now, updatedAt: now, steps: [],
    branch: { source: 'main', feature: f, baseSha: 'a'.repeat(40), branchKept: true,
      ...(retained ? { commitFailed: { at: now, step: 'commit', message: 'hook failed' }, worktreeDir: join(homeDir, 'nope', id) } : {}) } });
  return { id, feature: f };
}
const scope = () => `?projectDir=${encodeURIComponent(project)}`;

test('rowToState: a test try reads Worca\'s copy as its project folder; a normal run its own folder', async () => {
  const t = await seed(true);
  const n = await seed(false);
  assert.equal(artifacts.readPipelineStateById(t.id).projectDir, store.testCopyDirFor(key));
  assert.equal(artifacts.readPipelineStateById(n.id).projectDir, project);
  assert.equal(artifacts.projectDirOfRow(artifacts.findPipelineRowById(t.id)), store.testCopyDirFor(key));
});

test('Delete (archive) of a test try never touches the person\'s repository, even with a branch of the same name there', async () => {
  const t = await seed(true);
  git(project, 'branch', t.feature);   // the same name in the person's repository
  const was = repoSnapshot(project);
  const r = await fetch(`${base}/api/runs/${t.id}${scope()}`, { method: 'DELETE' });
  assert.equal(r.status, 200, await r.text());
  assert.equal(repoSnapshot(project), was, 'the person\'s branch is kept, nothing else changed');
  const n = await seed(false);
  git(project, 'branch', n.feature);
  const rn = await fetch(`${base}/api/runs/${n.id}${scope()}`, { method: 'DELETE' });
  assert.equal(rn.status, 200);
  assert.throws(() => git(project, 'rev-parse', '--verify', '--quiet', `refs/heads/${n.feature}`), undefined, 'a normal run\'s own branch still goes');
});

test('bulk archive and delete of a test try never touch the person\'s repository', async () => {
  for (const action of ['archive', 'delete']) {
    const t = await seed(true);
    git(project, 'branch', t.feature);
    const was = repoSnapshot(project);
    const r = await post('/api/runs/bulk', { action, targets: [{ pipelineId: t.id, projectKey: key }] });
    assert.equal(r.status, 200, await r.text());
    assert.equal(repoSnapshot(project), was, action);
  }
});

test('Discard the worktree and Apply to branch refuse a test try (409 TEST_TRY)', async () => {
  const { TRY_STAYS_IN_COPY_TEXT } = await import('../src/shared/workflow-tests/project-text.mjs');
  const t = await seed(true, { retained: true });
  const was = repoSnapshot(project);
  for (const p of ['discard-worktree', 'apply-retained']) {
    const r = await post(`/api/runs/${t.id}/${p}${scope()}`, {});
    assert.equal(r.status, 409, p);
    const j = await r.json();
    assert.deepEqual([j.error, j.code], [TRY_STAYS_IN_COPY_TEXT, 'TEST_TRY'], p);
  }
  assert.equal(repoSnapshot(project), was);
  const { discardRetainedWorktrees, applyRetainedWork } = await import('../src/core/pipeline-delete.mjs');
  await assert.rejects(discardRetainedWorktrees({ key, id: t.id }), { code: 'TEST_TRY' });
  await assert.rejects(applyRetainedWork({ key, id: t.id }), { code: 'TEST_TRY' });
});

test('Try it never picks a test try; the schedule\'s "after" list leaves a running try out', async () => {
  const k2 = templateRepo('wftr2b', { branch: 'main', user: true, files: { 'README.md': '# b\n' } });
  try {
    const now = new Date().toISOString();
    const { id, dir } = await artifacts.createPipeline(k2, { prompt: 'p', title: 'Test: y · try 1', isTest: true });
    const k2key = store.projectKey(k2);
    await artifacts.writeState(dir, { projectKey: k2key, id, status: 'done', startedAt: now, updatedAt: now, steps: [],
      branch: { source: 'main', feature: `worca-cc/y-${id}`, baseSha: 'a'.repeat(40) } });
    const r = await post(`/api/projects/${k2key}/actions/a1/try`, {});
    const j = await r.json();
    assert.equal(j.code, 'NO_FINISHED_RUN', JSON.stringify(j));
    const { id: rid, dir: rdir } = await artifacts.createPipeline(k2, { prompt: 'p', title: 'Test: y · try 2', isTest: true });
    await artifacts.writeState(rdir, { projectKey: k2key, id: rid, status: 'running', startedAt: now, updatedAt: now, steps: [] });
    const c = await (await fetch(`${base}/api/schedules/after-candidates?projectDir=${encodeURIComponent(k2)}`)).json();
    assert.ok(!JSON.stringify(c).includes(rid), 'a running try is no run to wait for');
  } finally { await rm(k2, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
});

test('the other places that turn a row into a folder: Ask worktrees refuse a try, the landing facts and Ask\'s base check read the copy or nothing', async () => {
  const t = await seed(true);
  const { createThread } = await import('../src/core/ask/store.mjs');
  const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
  const th = createThread();
  await assert.rejects(openAskWorktree({ threadId: th.id, runId: t.id }), /workflow-test try/);
  const { landingFacts } = await import('../src/core/shape/changes.mjs');
  const facts = landingFacts(t.id, { findPipelineRowById: artifacts.findPipelineRowById, readPrState: () => null, readRunTags: () => [] });
  assert.equal(facts.run.projectDir, store.testCopyDirFor(key), 'Worca\'s copy, never the person\'s folder');
  const n = await seed(false);
  const nf = landingFacts(n.id, { findPipelineRowById: artifacts.findPipelineRowById, readPrState: () => null, readRunTags: () => [] });
  assert.equal(nf.run.projectDir, project, 'a normal run: its own folder');
});
