// test/server-pause-resume.test.mjs
// Endpoint guards only (no live claude): unknown ids 400/404, wrong-status 400,
// paused row with a missing worktree -> 400 with a clear error. Harness mirrors
// test/history-api.test.mjs (env BEFORE the dynamic server import).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { addProject } from '../src/core/projects.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';

let homeDir, srv, base, prevHome, doneId, pausedNoWtId, app, runs, _testing;
let resumableId, liveWt;



before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-pauseapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();

  const projA = await mkdtemp(join(tmpdir(), 'worca-cc-pauseapi-projA-'));
  ({ id: doneId } = await seedPipeline(projA, { title: 'done run', status: 'done' }));

  const projB = await mkdtemp(join(tmpdir(), 'worca-cc-pauseapi-projB-'));
  const goneWt = await mkdtemp(join(tmpdir(), 'worca-cc-pauseapi-wt-'));
  await rm(goneWt, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); // worktree no longer exists
  ({ id: pausedNoWtId } = await seedPipeline(projB, {
    title: 'paused run', status: 'paused',
    branch: { source: 'main', feature: 'f', worktreeDir: goneWt, reusedExisting: false },
    resumePoint: { version: 2, kind: 'boundary', stepIndex: 0, stepCycle: [], loopState: {},
      bus: null, stepModels: null, workflowId: 'wf_default', plan: null, nodes: [], gate: null,
      pipelineDir: projB, pausedAt: '2026-06-09T00:00:00Z' },
  }));

  // A RESUMABLE fixture: paused, worktree still on disk, project onboarded — so the
  // guard chain runs to completion and /api/resume answers its full wire payload.
  const projC = await mkdtemp(join(tmpdir(), 'worca-cc-pauseapi-projC-'));
  liveWt = await mkdtemp(join(tmpdir(), 'worca-cc-pauseapi-livewt-'));
  await addProject({ name: 'pauseapi-projC', path: projC });
  ({ id: resumableId } = await seedPipeline(projC, {
    title: 'resumable run', status: 'paused',
    branch: { source: 'main', feature: 'f', worktreeDir: liveWt, reusedExisting: false },
    resumePoint: graphResumePoint({ pipelineDir: projC }),
  }));

  const mod = await import('../ui/server.mjs');
  ({ app, runs } = mod);
  ({ _testing } = mod);
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  if (liveWt) await rm(liveWt, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function post(path, body) {
  return fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('POST /api/pause: unknown runId -> 400', async () => {
  const res = await post('/api/pause', { runId: 'nope' });
  assert.equal(res.status, 400);
});

// A live run entry the pause action can act on (the seeded rows above are DB-only).
const pauseEntry = (id, pauseResult) => {
  runs.set(id, { id, orch: { pause: () => pauseResult }, status: 'running', events: [], pendingQuestion: null });
  return id;
};

test('pauseRun signals CANNOT_PAUSE via err.code, not message text', async () => {
  const runId = pauseEntry('r-cannot', false);
  await assert.rejects(async () => _testing.chatActions.pause(runId), (err) => err.code === 'CANNOT_PAUSE');
});

test('pauseRun happy path still marks the entry pausing and resolves the pending question', async () => {
  const okRunId = pauseEntry('r-ok', true);
  runs.get(okRunId).pendingQuestion = { id: 'q-1', kind: 'gate' };
  _testing.chatActions.pause(okRunId);
  assert.equal(runs.get(okRunId).status, 'pausing');
  assert.equal(runs.get(okRunId).pendingQuestion, null);
});

test('POST /api/resume: unknown pipelineId -> 404', async () => {
  const res = await post('/api/resume', { pipelineId: 'pl_missing' });
  assert.equal(res.status, 404);
});

test('POST /api/resume: non-paused pipeline -> 400', async () => {
  const res = await post('/api/resume', { pipelineId: doneId });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not resumable/i);
});

test('POST /api/resume: paused row with missing worktree -> 400', async () => {
  const res = await post('/api/resume', { pipelineId: pausedNoWtId });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /worktree/i);
});

// ── resumeRun(): the guard chain is a function, not an HTTP loopback ─────────
// Chat used to POST http://127.0.0.1:4317/api/resume to reuse these guards, which
// breaks under WORCA_HOST and can hit a DIFFERENT instance that happens to own 4317.
test('chat /resume works without a loopback self-fetch (direct helper call)', async () => {
  const out = await _testing.chatActions.resume(pausedNoWtId);
  assert.equal(out.ok, false);
  assert.match(out.error, /worktree missing/);
});

test('resumeRun maps guard failures to typed errors', async () => {
  await assert.rejects(() => _testing.resumeRun('nope'), (e) => e.status === 404);
});

test('/api/resume still answers { ok, runId, pipelineId }', async () => {
  const res = await post('/api/resume', { pipelineId: resumableId, mock: true });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.runId);
  assert.equal(body.pipelineId, resumableId);
});

// Review of PR #376: resumeRun built a NEW orchestrator but never re-attached
// the Ask follower of a card-linked run, so the link row stayed 'paused' for
// ever and the thread never heard the outcome. The link must follow the resumed
// runId and reach a terminal status through a fresh follower.
test('resumeRun re-attaches the Ask follower of a linked paused run: link moves to the new runId and reaches a terminal status', async () => {
  const { createThread, linkRun, listRunLinks, listMessages } = await import('../src/core/ask/store.mjs');
  const projD = await mkdtemp(join(tmpdir(), 'worca-cc-pauseapi-projD-'));
  const wtD = await mkdtemp(join(tmpdir(), 'worca-cc-pauseapi-livewtD-'));
  await addProject({ name: 'pauseapi-projD', path: projD });
  const { id } = await seedPipeline(projD, {
    title: 'linked paused run', status: 'paused',
    branch: { source: 'main', feature: 'f', worktreeDir: wtD, reusedExisting: false },
    resumePoint: graphResumePoint({ pipelineDir: projD }),
  });
  const t = createThread();
  linkRun(t.id, { runId: 'dead-lineage-uuid', cardId: null, pipelineId: id, status: 'paused' });

  const out = await _testing.resumeRun(id, { mock: true });
  assert.equal(out.ok, true);
  const links = listRunLinks(t.id);
  assert.equal(links.length, 1, 'one link row, taken over — not duplicated');
  assert.equal(links[0].runId, out.runId, 'the link follows the resumed run');
  assert.ok(listMessages(t.id).some((m) => /Run resumed/.test(m.text)), 'the thread hears about the resume');

  // /api/resume never forwards `auto`, so the mock run parks at HITL gates — answer
  // them the way test/ask-api-cards.test.mjs does until the follower reports.
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < 15000) {
    const st = listRunLinks(t.id)[0].status;
    if (/^(done|error|stopped)$/.test(st)) break;
    const pq = runs.get(out.runId)?.pendingQuestion;
    if (pq && pq !== last) {
      last = pq;
      const payload = (pq.kind === 'clarify' || pq.kind === 'questions')
        ? { answers: (pq.questions || []).map((q) => ({ id: q.id, choice: (q.options || []).find((o) => o && o.trim()) || 'auto' })) }
        : { decision: 'continue' };
      await post('/api/answer', { runId: out.runId, id: pq.id, payload });
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  const final = listRunLinks(t.id)[0];
  assert.match(final.status, /^(done|error|stopped)$/, `follower reported a terminal status, got ${final.status}`);
  assert.ok(listMessages(t.id).some((m) => /Run finished|Run failed/.test(m.text)), 'terminal notice posted by the re-attached follower');
  await rm(wtD, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

// P8a: the v1 engine is retired. V24 NULLs the resume points it reaches, but a
// point a divergent ladder left behind must still be refused HONESTLY (409
// ENGINE_RETIRED), never replayed on an engine that no longer exists.
// (Without this test the guard is dead weight — removing it was measured GREEN.)
test('POST /api/resume: a v1 resume point is refused with 409 ENGINE_RETIRED', async () => {
  const projE = await mkdtemp(join(tmpdir(), 'worca-cc-pauseapi-projE-'));
  const { id } = await seedPipeline(projE, {
    title: 'v1 point', status: 'paused',
    resumePoint: { version: 1, kind: 'boundary', pipelineDir: projE },
  });
  // POST /api/resume reads req.body.pipelineId — `{ id }` is refused with 400
  // "pipelineId is required" long before the guard runs.
  const res = await post('/api/resume', { pipelineId: id });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.code, 'ENGINE_RETIRED');
  assert.equal(body.error, 'paused on the v1 engine before the graph rework — not resumable');
  assert.equal(getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(id).status, 'paused',
    'refusing does not mutate the run');
});
