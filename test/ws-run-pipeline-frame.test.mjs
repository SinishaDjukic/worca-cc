// test/ws-run-pipeline-frame.test.mjs — F-7a-02 (server part): a page keyed by run id learns the run's pipeline id
// from a `run-pipeline` frame `{ type, runId, pipelineId }`, sent once per runs-map entry when the id is first known.
// `run-created` stays exactly as it was (same send point, same keys, still no pipelineId).
// Harness: WORCA_HOME before the server import (test/server-pause-resume.test.mjs), the module's own WS server
// (test/api-run-folder.test.mjs "run-created names the mode of a folder run").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { addProject } from '../src/core/projects.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';

let homeDir, prevHome, mod, ws, base, runs, resumableId;
const dirs = [];
const got = [];

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-runpipe-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();

  // A resumable paused pipeline: project onboarded, worktree still on disk.
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-runpipe-proj-')); dirs.push(proj);
  const liveWt = await mkdtemp(join(tmpdir(), 'worca-cc-runpipe-livewt-')); dirs.push(liveWt);
  await addProject({ name: 'runpipe-resume', path: proj });
  ({ id: resumableId } = await seedPipeline(proj, {
    title: 'resumable run', status: 'paused',
    branch: { source: 'main', feature: 'f', worktreeDir: liveWt, reusedExisting: false },
    resumePoint: graphResumePoint({ pipelineDir: proj }),
  }));

  mod = await import('../ui/server.mjs');
  runs = mod.runs;
  if (!mod.server.listening) await new Promise((r) => mod.server.listen(0, '127.0.0.1', r));
  const port = mod.server.address().port;
  base = `http://127.0.0.1:${port}`;
  const { WebSocket } = await import('ws');
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  ws.on('message', (d) => got.push(JSON.parse(String(d))));
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
});

after(async () => {
  if (ws) ws.close();
  if (mod?.server?.listening) await new Promise((r) => mod.server.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const d of [homeDir, ...dirs]) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const api = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const until = async (pred) => { for (let i = 0; i < 250 && !pred(); i++) await new Promise((r) => setTimeout(r, 20)); return pred(); };
const framesOf = (type, runId) => got.filter((f) => f.type === type && f.runId === runId);
const indexOf = (pred) => got.findIndex(pred);
const stopRun = async (runId) => {
  await api('POST', '/api/stop', { runId });
  await runs.get(runId)?.launch;
  await until(() => framesOf('done', runId).length > 0);
};
// Today's run-created key set (announceRun); workMode only rides along for a non-git run.
const RUN_CREATED_KEYS = ['type', 'runId', 'title', 'projectDir', 'kind', 'workspaceId', 'projectNames', 'status',
  'startedAt', 'startedBy', 'lastAction', 'tags', 'labels'];

let fresh = null;   // { runId, pipelineId } of the new run, shared by tests 1-3
async function newRun() {
  if (fresh) return fresh;
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-runpipe-new-')); dirs.push(dir);
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  await api('POST', '/api/projects', { name: 'runpipe-new', path: dir });
  const r = await api('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const runId = r.body.runId;
  await until(() => framesOf('run-pipeline', runId).length > 0);
  fresh = { runId, dir };
  return fresh;
}

test('F-7a-02: a new run\'s run-pipeline frame carries the pipelineId that /api/runs reports', async () => {
  const { runId, dir } = await newRun();
  const frames = framesOf('run-pipeline', runId);
  assert.equal(frames.length, 1, 'exactly one run-pipeline frame');
  assert.deepEqual(Object.keys(frames[0]).sort(), ['pipelineId', 'runId', 'type']);
  const live = (await api('GET', `/api/runs?projectDir=${encodeURIComponent(dir)}`)).body.live || [];
  const row = live.find((l) => l.runId === runId);
  assert.ok(row && typeof row.id === 'string' && row.id, 'the run is listed with its pipeline id');
  assert.equal(frames[0].pipelineId, row.id);
});

test('F-7a-02: run-pipeline follows the first state frame that names the pipeline, and run-created is unchanged', async () => {
  const { runId } = await newRun();
  const pipe = framesOf('run-pipeline', runId)[0];
  assert.ok(pipe, 'a run-pipeline frame arrived');
  const iCreated = indexOf((f) => f.type === 'run-created' && f.runId === runId);
  const iState = indexOf((f) => f.type === 'state' && f.runId === runId && f.id === pipe.pipelineId);
  const iPipe = indexOf((f) => f === pipe);
  assert.ok(iCreated >= 0 && iCreated < iState && iState < iPipe, `order run-created(${iCreated}) < state(${iState}) < run-pipeline(${iPipe})`);
  const created = got[iCreated];
  assert.equal('pipelineId' in created, false, 'run-created still carries no pipelineId');
  const expected = [...RUN_CREATED_KEYS, ...('workMode' in created ? ['workMode'] : [])].sort();
  assert.deepEqual(Object.keys(created).sort(), expected);
  if ('workMode' in created) assert.notEqual(created.workMode, 'git');
});

test('F-7a-02: run-pipeline is sent once per run', async () => {
  const { runId } = await newRun();
  const pipelineId = framesOf('run-pipeline', runId)[0]?.pipelineId;
  await stopRun(runId);
  assert.ok(framesOf('state', runId).filter((f) => f.id === pipelineId).length > 1, 'later state frames named the id again');
  assert.equal(framesOf('run-pipeline', runId).length, 1);
});

test('F-7a-02 resume: run-created is unchanged and run-pipeline names the resumed pipeline once', async () => {
  const r = await api('POST', '/api/resume', { pipelineId: resumableId, mock: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const runId = r.body.runId;
  await until(() => framesOf('run-pipeline', runId).length > 0);
  const iCreated = indexOf((f) => f.type === 'run-created' && f.runId === runId);
  assert.ok(iCreated >= 0, 'resume announced the run');
  const created = got[iCreated];
  assert.equal('pipelineId' in created, false, 'run-created still carries no pipelineId');
  assert.deepEqual(Object.keys(created).sort(), [...RUN_CREATED_KEYS].sort());
  const pipes = framesOf('run-pipeline', runId);
  assert.equal(pipes.length, 1);
  assert.deepEqual(pipes[0], { type: 'run-pipeline', runId, pipelineId: resumableId });
  assert.ok(got.indexOf(pipes[0]) > iCreated, 'run-pipeline follows run-created');
  const iFirstState = indexOf((f) => f.type === 'state' && f.runId === runId);
  if (iFirstState >= 0) assert.ok(got.indexOf(pipes[0]) < iFirstState, 'and comes before the first state frame');
  await stopRun(runId);
  assert.equal(framesOf('run-pipeline', runId).length, 1, 'still exactly one after the resumed run settled');
});
