// test/api-run-no-project.test.mjs — P3: POST /api/run { noProject: true } — the refusals (400, nothing created), a mock
// run in its own folder with its work/ files as artifacts, the same with git missing, and resumeTargetDirs' reserved key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { NO_PROJECT_KEY, noProjectWorkDir } from '../src/core/store.mjs';
import { countProjects, worcaHome } from '../src/core/projects.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
import { createTicket, cancelTicket } from '../src/core/scheduler.mjs';

useTempHome(after);   // outer isolation: /api/run finishes ASYNC in-process (api-run-memory-scope pattern)

let homeDir, prevHome, srv, base, runs, _testing;
const prevFlags = process.env.WORCA_FLAGS;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rmWithRetry(dir, { attempts = 12, stepMs = 25 } = {}) {
  for (let i = 0; ; i++) {
    try { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); return; }
    catch (err) {
      const code = err?.code || '';
      if ((code === 'ENOTEMPTY' || code === 'EBUSY' || code === 'ENOENT') && i < attempts) { await sleep(stepMs); continue; }
      throw err;
    }
  }
}
// A mock run parks at wf_default's HITL gates: answer them as auto mode would (the api-run-tags / api-schedules pattern).
// And wait for entry.settled, not for entry.status: the status reads 'done' from the state frame BEFORE the harness's
// finally tears the run root down, and the work/ harvest (the `work` artifacts) happens in that teardown.
const answered = new Set();
async function untilLanded(runId, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = runs.get(runId);
    if (e && e.settled) return e;
    const pq = e && e.pendingQuestion;
    if (pq && !answered.has(`${runId}:${pq.id}`)) {
      answered.add(`${runId}:${pq.id}`);
      const payload = (pq.kind === 'clarify' || pq.kind === 'questions')
        ? { answers: (pq.questions || []).map((q) => ({ id: q.id, choice: (q.options || []).find((o) => o && o.trim()) || 'auto' })) }
        : { decision: 'continue' };
      await post('/api/answer', { runId, id: pq.id, payload });
    }
    await sleep(50);
  }
  const e = runs.get(runId);
  throw new Error(`run ${runId} never settled: status=${e?.status} question=${e?.pendingQuestion?.id || null}`);
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-np-api-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');   // imported ⇒ no port bind
  ({ runs, _testing } = mod);
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  if (prevFlags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prevFlags;
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rmWithRetry(homeDir);
});

test('refusals answer 400 before anything is created', async () => {
  const inHour = new Date(Date.now() + 3600_000).toISOString();
  const cases = [
    [{ noProject: 'yes', prompt: 'x' }, 'noProject must be true or false'],
    [{ noProject: true, projectDir: '/x', prompt: 'x' }, 'provide one of projectDir, workspaceId or noProject'],
    [{ noProject: true, workspaceId: 'wks-a-0000abcd', prompt: 'x' }, 'provide one of projectDir, workspaceId or noProject'],
    [{ prompt: 'x' }, 'provide one of projectDir, workspaceId or noProject'],
    [{ noProject: false, prompt: 'x' }, 'provide one of projectDir, workspaceId or noProject'],
    [{ noProject: true, prompt: 'x', scheduledFor: inHour }, 'a run without a project cannot be scheduled yet'],
    [{ noProject: true, prompt: 'x', repeat: { rule: { freq: 'daily', time: '02:00' } } }, 'a run without a project cannot be scheduled yet'],
    [{ noProject: true, prompt: 'x', after: { kind: 'pipeline', id: 'abcd1234' } }, 'a run without a project cannot be scheduled yet'],
    [{ noProject: true, prompt: 'x', sourceFromPrevious: true }, 'a run without a project cannot be scheduled yet'],
    [{ noProject: true, prompt: 'x', workflowId: 'wf_memory_defrag', memoryScope: 'project' }, 'memoryScope needs a project'],
    [{ projectDir: noProjectWorkDir('abcd1234'), prompt: 'x' }, 'this folder belongs to a run without a project'],
  ];
  for (const [body, error] of cases) {
    const r = await post('/api/run', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(await r.json(), { error }, JSON.stringify(body));
  }
  assert.equal(existsSync(join(worcaHome(), 'runs')), false, 'no refusal made a run root');
  // Shape it first on (WORCA_FLAGS locks the flag, as test/api-shape-first.test.mjs does): a sliced shaped run is refused.
  process.env.WORCA_FLAGS = 'shapeFirst';
  try {
    for (const shape of [{ slices: 'auto' }, { perspectives: ['qa'], slices: 'auto' }]) {
      const r = await post('/api/run', { noProject: true, prompt: 'x', shape });
      assert.deepEqual([r.status, (await r.json()).error], [400, 'a run without a project cannot be planned in slices yet'], JSON.stringify(shape));
    }
  } finally { process.env.WORCA_FLAGS = '-shapeFirst'; }
  assert.equal(existsSync(join(worcaHome(), 'runs')), false, 'no refusal made a run root');
});

test('a run work folder is never a team-metrics member either (P3-D11)', async () => {
  await mkdir(noProjectWorkDir('abcd1234'), { recursive: true });
  try {
    const r = await post('/api/workspaces/metrics-scan', { projectPaths: [noProjectWorkDir('abcd1234')] });
    assert.deepEqual([r.status, await r.json()], [400, { error: 'this folder belongs to a run without a project' }]);
  } finally { await rm(join(worcaHome(), 'runs', 'abcd1234'), { recursive: true, force: true }); }
});

test('a mock default run with no project: its own folder, the No project History row, work/ files as artifacts', { timeout: 180000 }, async () => {
  const before = countProjects();
  const r = await post('/api/run', { noProject: true, prompt: 'Make a hello page', workflowId: 'wf_default', mock: true, sourceBranch: 'main', featureBranch: 'x' });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  const { runId, pipelineId } = JSON.parse(text);
  assert.match(pipelineId, /^[0-9a-f]{8}$/, 'the server minted the pipeline id before the harness existed (P3-D2)');
  assert.equal(runs.get(runId).projectDir, noProjectWorkDir(pipelineId));
  assert.equal(runs.get(runId).pipelineId, pipelineId);
  const done = await untilLanded(runId);
  assert.equal(done.status, 'done', JSON.stringify({ status: done.status, reason: done.pauseReason, detail: done.pauseDetail }));
  const arts = await (await fetch(`${base}/api/runs/${pipelineId}/artifacts`)).json();
  assert.ok(arts.artifacts.some((a) => a.kind === 'work' && a.relPath === 'work/src/feature.mjs'), JSON.stringify(arts.artifacts.map((a) => a.relPath)));
  const row = (await (await fetch(`${base}/api/history`)).json()).pipelines.find((p) => p.id === pipelineId);
  assert.deepEqual([row.projectKey, row.projectName, row.projectDir], [NO_PROJECT_KEY, 'No project', noProjectWorkDir(pipelineId)]);
  const detail = await fetch(`${base}/api/history/${NO_PROJECT_KEY}/${pipelineId}`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).state.workMode, 'none');
  // No repository: the PR and branch routes never run git for (or in) a run's work folder.
  const remotes = await fetch(`${base}/api/pr/remotes?id=${pipelineId}&projectKey=${NO_PROJECT_KEY}`);
  assert.deepEqual([remotes.status, (await remotes.json()).error], [400, 'pipeline has no project directory']);
  await mkdir(noProjectWorkDir('abcd0001'), { recursive: true });   // a live run's work folder
  // … under a repository (a worcaHome inside a checkout): a git walk-up from work/ would list that repository's branches
  const up = dirname(noProjectWorkDir('abcd0001'));
  execFileSync('git', ['init', '-q', up]);
  execFileSync('git', ['-C', up, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x']);
  execFileSync('git', ['-C', up, 'branch', 'host-branch']);
  assert.deepEqual(await (await fetch(`${base}/api/branches?projectDir=${encodeURIComponent(noProjectWorkDir('abcd0001'))}`)).json(), { branches: [], current: null, runs: [] });
  const { sync } = await (await fetch(`${base}/api/sync?projectDir=${encodeURIComponent(noProjectWorkDir('abcd0001'))}`)).json();
  assert.deepEqual([sync.base, sync.remote, sync.state], [null, null, 'unknown'], 'never the enclosing repository\'s branch');
  assert.equal(countProjects(), before);
  const projects = await (await fetch(`${base}/api/projects`)).json();
  assert.equal(projects.runsRoot, join(worcaHome(), 'runs'));
});

test('the Shaper with no project (U13, L7): its shaped run is never sliced and ends done after the plan approval', { timeout: 180000 }, async () => {
  process.env.WORCA_FLAGS = 'shapeFirst';
  try {
    const r = await post('/api/run', { noProject: true, prompt: 'Add a charts page.', workflowId: 'wf_shape', mock: true });
    const text = await r.text();
    assert.equal(r.status, 200, text);
    const { runId } = JSON.parse(text);
    const entry = runs.get(runId);
    assert.equal(entry.orch.opts.shape.slices, 'off', 'New run sends no shape: the server turns slicing off');
    let pq;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      pq = entry.pendingQuestion;
      if (pq && pq.kind === 'plan') break;
      if (pq && !answered.has(`${runId}:${pq.id}`)) {
        answered.add(`${runId}:${pq.id}`);
        await post('/api/answer', { runId, id: pq.id, payload: { answers: [] } });
      }
      await sleep(50);
    }
    assert.equal(pq?.kind, 'plan', 'the run reached the plan approval');
    const a = await post(`/api/runs/${runId}/answer`, { id: pq.id, decision: 'approve' });
    assert.equal(a.status, 200, await a.text());
    const done = await untilLanded(runId);
    assert.equal(done.status, 'done', JSON.stringify({ status: done.status, reason: done.pauseReason, detail: done.pauseDetail }));
  } finally { process.env.WORCA_FLAGS = '-shapeFirst'; }
});

test('the noProject arm passes the run options through: guardrails, human in the loop, a markdown task, the title', { timeout: 180000 }, async () => {
  const r = await post('/api/run', { noProject: true, promptMarkdown: '# Make a hello page', title: 'Hello page', workflowId: 'wf_default', mock: true, guardrailsId: 'normal', humanInLoop: false });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  const { runId } = JSON.parse(text);
  const o = runs.get(runId).orch.opts;
  assert.deepEqual([o.guardrailsId, o.humanInLoop, o.source?.type, o.title], ['normal', false, 'markdown', 'Hello page']);
  assert.equal((await untilLanded(runId)).status, 'done');
});

test('a machine without git: POST /api/run { noProject: true } still starts and ends done (no git guard on this path)', { timeout: 180000 }, async (t) => {
  withNoGit(t);
  const r = await post('/api/run', { noProject: true, prompt: 'Make a hello page', workflowId: 'wf_default', mock: true });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  const { runId } = JSON.parse(text);
  assert.equal((await untilLanded(runId)).status, 'done');
});

test('resumeTargetDirs: the reserved key is the row\'s own work folder', async () => {
  assert.deepEqual(await _testing.resumeTargetDirs({ row: { id: 'abcd1234', target: 'project', project_key: NO_PROJECT_KEY } }),
    { projectDir: noProjectWorkDir('abcd1234'), workspace: undefined });
});

test('validateResumeTarget (a scheduled resume): the reserved key is the run\'s own work folder, and its resume ticket is allowed', async () => {
  const { id } = await seedPipeline(noProjectWorkDir('abcd1234'), {
    title: 'paused no-project run', status: 'paused',
    branch: { workMode: 'none', runRootMode: 'detached' },
    resumePoint: graphResumePoint({ pipelineDir: worcaHome() }),
  });
  const v = await _testing.validateResumeTarget(id);
  assert.deepEqual([v.ok, v.projectDir, v.workspaceId], [true, noProjectWorkDir(id), null], JSON.stringify(v));
  const t = createTicket({ projectDir: v.projectDir, runAtMs: Date.now() + 3600_000, request: {}, resumePipelineId: id });
  assert.equal(t.resumePipelineId, id);
  cancelTicket(t.id);
});

test('Memory defragment with no project (U13): global memory runs; project memory needs a project', { timeout: 180000 }, async () => {
  const r = await post('/api/run', { noProject: true, workflowId: 'wf_memory_defrag', memoryScope: 'global', prompt: 'Defragment global memory.', mock: true });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  const { runId, pipelineId } = JSON.parse(text);
  assert.equal((await untilLanded(runId)).status, 'done');
  const detail = await (await fetch(`${base}/api/history/${NO_PROJECT_KEY}/${pipelineId}`)).json();
  assert.equal(detail.state.workMode, 'none');
});

test('Memory defragment with no project: one live defragment per scope (409); the start pair is checked and reaches the run', { timeout: 180000 }, async () => {
  const body = { noProject: true, workflowId: 'wf_memory_defrag', memoryScope: 'global', prompt: 'Defragment global memory.', mock: true };
  runs.set('np-live-g', { id: 'np-live-g', orch: { memoryScope: 'global', pause: () => ({}) }, projectDir: noProjectWorkDir('abcd1234'), kind: 'run', status: 'running', events: [], pendingQuestion: null });
  try {
    const r = await post('/api/run', body);
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), { error: 'a defragment run for this memory scope is already live', runId: 'np-live-g' });
  } finally { runs.delete('np-live-g'); }
  const bad = await post('/api/run', { ...body, model: 'gone-model' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /unknown model "gone-model"/);
  const r = await post('/api/run', { ...body, model: 'CLAUDE-OPUS-5-5', effort: 'medium' });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  const { runId } = JSON.parse(text);
  const entry = runs.get(runId);
  assert.equal((await untilLanded(runId)).status, 'done');
  const node = entry.orch.getState().stepper.graph.nodes.find((n) => n.id === 'n_defrag');
  assert.deepEqual([node.model, node.effort], ['claude-opus-5-5', 'medium'], 'the pair named at start, in the catalog\'s casing');
});
