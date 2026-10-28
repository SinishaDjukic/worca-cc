// test/workflow-test-project-key.test.mjs — workflow tests 3a, Task 1 (D42, D52): the prototype. A git run in Worca's own
// copy of a project runs under the real project's key, reads the real project's settings, and only reads the person's
// repository.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { repoSnapshot } from './helpers/repo-snapshot.mjs';

// worcaHome() is <WORCA_HOME>/.worca-cc (src/core/projects.mjs worcaHome), not WORCA_HOME itself.
const home = join(useTempHome(after, 'worca-cc-wftkey-'), '.worca-cc');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const cleanup = [];
let real, key, copy, store, artifacts, config, server;

// wf_default parks at its clarify gate whatever humanInLoop says (run-harness.mjs: the switch only changes an Auto run):
// answer it as auto mode would (the api-run-no-project pattern).
const answered = new Set();
async function settled(runs, runId, ms = 200000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = runs.get(runId);
    if (e && e.settled) return e;
    const pq = e && e.pendingQuestion;
    if (pq && !answered.has(pq.id)) {
      answered.add(pq.id);
      const payload = (pq.kind === 'clarify' || pq.kind === 'questions')
        ? { answers: (pq.questions || []).map((q) => ({ id: q.id, choice: (q.options || []).find((o) => o && o.trim()) || 'auto' })) }
        : { decision: 'continue' };
      server._testing.answerRun(runId, pq.id, payload);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`run ${runId} never settled`);
}

before(async () => {
  process.env.WORCA_MOCK = '1';
  real = templateRepo('wftkey', { branch: 'main', user: true, files: { 'README.md': '# hi\n', 'src/a.mjs': 'export const a = 1;\n' } });
  cleanup.push(real);
  store = await import('../src/core/store.mjs');
  const projects = await import('../src/core/projects.mjs');
  projects.insertProject({ name: 'real-project', path: real });
  key = store.projectKey(real);
  copy = store.testCopyDirFor(key);
  mkdirSync(store.testCopiesRoot(), { recursive: true });
  git(home, 'clone', '-q', '--local', '--no-checkout', '--no-tags', '--', real, copy);
  git(copy, 'remote', 'remove', 'origin');
  config = await import('../src/core/config.mjs');
  await config.setHumanInLoop(real, false);
  artifacts = await import('../src/core/artifacts.mjs');
  server = await import('../ui/server.mjs');
});
after(() => {
  delete process.env.WORCA_MOCK;
  for (const d of cleanup) rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('the copy and every worktree of it answer the real project key; nothing else does', () => {
  assert.equal(copy, join(home, 'workflow-tests', 'repos', key));
  assert.equal(store.testCopyKeyOf(copy), key);
  assert.equal(store.projectKey(copy), key);
  const wt = join(home, 'wt-probe');
  git(copy, 'worktree', 'add', '-q', '--detach', '--', wt, 'HEAD');
  try { assert.equal(store.projectKey(wt), key, 'a worktree of the copy is the project too'); }
  finally { git(copy, 'worktree', 'remove', '--force', wt); }
  assert.equal(store.testCopyKeyOf(join(copy, 'src')), null, 'only the copy folder itself');
  assert.equal(store.testCopyKeyOf(real), null);
  assert.equal(store.testCopyKeyOf(join(home, 'workflow-tests', 'repos', 'Not A Key')), null);
  assert.throws(() => store.testCopyDirFor('../x'), /not a project key/);
});

test('a run in the copy reads the real project settings', async () => {
  assert.equal((await config.readRunConfig(copy)).humanInLoop, false);
});

test('a test row acts on the copy, a normal row on its project', async () => {
  const lookup = async () => real;
  assert.equal(await store.runProjectDir({ id: 'abcd0001', project_key: key, is_test: 1, target: 'project' }, lookup), copy);
  assert.equal(await store.runProjectDir({ id: 'abcd0002', project_key: key, is_test: null, target: 'project' }, lookup), real);
});

test('a git run in the copy: the real key, a checkout under its run root, and the person\'s repository only read', { timeout: 240000 }, async () => {
  const sha = git(real, 'rev-parse', 'HEAD');
  const was = repoSnapshot(real);
  assert.equal(artifacts.readStoreMeta(key), null, 'the project never ran');
  const out = await server._testing.invokeStartRun({ projectDir: copy, sourceBranch: sha, prompt: 'Add a feature', title: 'Prototype try' }, null, {});
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const { runId } = out.body;                     // the body carries only runId; the entry has the pipeline id
  const { pipelineId } = await settled(server.runs, runId);
  const row = artifacts.findPipelineRowById(pipelineId);
  assert.equal(row.project_key, key);
  const br = JSON.parse(row.branch);
  assert.equal(br.baseSha, sha, 'the run started at the pinned commit');
  assert.ok(String(br.worktreeDir).toLowerCase().startsWith(join(home, 'runs', pipelineId, 'repos', key).toLowerCase()), br.worktreeDir);
  assert.ok(br.feature, 'the run made its own branch');
  assert.ok(git(copy, 'rev-parse', '--verify', `refs/heads/${br.feature}`), 'in the copy');
  assert.throws(() => git(real, 'rev-parse', '--verify', '--quiet', `refs/heads/${br.feature}`), 'never in the person\'s repository');
  const meta = artifacts.readStoreMeta(key);
  assert.ok(!meta || meta.path !== copy, 'the copy is never recorded as the project');
  assert.equal(repoSnapshot(real), was, 'nothing in the person\'s repository changed');
});
