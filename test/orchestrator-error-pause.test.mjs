// test/orchestrator-error-pause.test.mjs — POLICY: no error ends a run that has a row.
// Setup-phase, harness-level and post-engine failures pause with a correct resume
// point, and resume() replays whatever setup the paused run never finished.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-errpause-'));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}
const okProducer = async () => ({ status: 'ok', summary: 'ok' });
const okVerifier = async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' });
const runners = () => ({ producer: okProducer, verifier: okVerifier });

test('setup throw AFTER the worktree exists (graph build) -> paused, pre-engine point, worktree kept; resume completes', async () => {
  const dir = gitDir();
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: runners() });
  // The mock guard lives INSIDE _buildWorktreeGraph (run-harness.mjs); an instance
  // override replaces it, so this throw IS reached under claude.mock.
  orch1._buildWorktreeGraph = async () => { throw new Error('graphify exploded'); };
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused', JSON.stringify(r1));
  assert.equal(r1.reason, 'error');
  assert.equal(r1.detail, 'graphify exploded');
  assert.equal(orch1.getState().steps.filter((s) => String(s.key).startsWith('x:') && s.nodeId !== 'preflight').length, 0, 'no execution ever ran');
  const saved = readPipelineForResume(orch1.state.id);
  assert.equal(saved.row.status, 'paused');
  assert.equal(saved.resumePoint.snapshot, null, 'pre-engine point');
  assert.equal(saved.resumePoint.setupIncomplete, true);
  const wt = orch1.getState().branch.worktreeDir;
  assert.ok(wt && existsSync(wt), 'the checkout survives the pause');

  const orch2 = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true }, runners: runners(), resume: saved });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done', JSON.stringify(r2));
  assert.equal(readPipelineForResume(orch1.state.id).row.status, 'done');
  assert.ok(!existsSync(wt), 'done tears the checkout down as on any fresh run');
});

test('setup throw BEFORE the worktree exists (run root) -> paused with no checkout; resume replays the setup INTO a worktree', async () => {
  const dir = gitDir();
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: runners() });
  orch1._setupRunRoot = async () => { throw new Error('worktree add failed: disk full'); };
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused', JSON.stringify(r1));
  assert.equal(r1.reason, 'error');
  assert.equal(orch1.getState().branch, null, 'no checkout was ever created');
  const saved = readPipelineForResume(orch1.state.id);
  assert.equal(saved.resumePoint.setupIncomplete, true);
  assert.ok(saved.resumePoint.checkpointRef, 'the checkpoint (which succeeded) rides the point');

  const seen = [];
  const orch2 = createOrchestrator({
    projectDir: dir, auto: true, claude: { mock: true }, resume: saved,
    runners: { producer: async (ctx) => { seen.push(ctx.projectDir); return okProducer(); }, verifier: okVerifier },
  });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done', JSON.stringify(r2));
  const wt = orch2.getState().branch?.worktreeDir;
  assert.ok(wt && wt !== dir, 'the replay created a real checkout');
  assert.ok(seen.length && seen.every((cwd) => cwd === wt), `every agent ran INSIDE the replayed worktree, never the real dir: ${seen}`);
  assert.ok(!seen.some((cwd) => cwd === dir), 'the user\'s live checkout was never an agent cwd');
  const done = readPipelineForResume(orch1.state.id);
  assert.equal(done.row.status, 'done');
});

test('a throw inside _engineRun before the scheduler (extras) -> paused; resume completes', async () => {
  const dir = gitDir();
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: runners() });
  orch1._collectExtras = async () => { throw new Error('extras unreadable'); };
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused', JSON.stringify(r1));
  assert.equal(r1.reason, 'error');
  const saved = readPipelineForResume(orch1.state.id);
  assert.equal(saved.resumePoint.setupIncomplete, undefined, 'setup HAD finished — nothing to replay');
  assert.equal(saved.resumePoint.snapshot, null, 'the engine never produced a snapshot: pre-engine point');
  const orch2 = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true }, runners: runners(), resume: saved });
  assert.equal((await orch2.resume()).status, 'done');
});

test('a throw AFTER the engine finished (post-processing) pauses on the FINAL snapshot; resume redoes only the post-processing', async () => {
  const dir = gitDir();
  let producerCalls = 0;
  const mk = () => ({ producer: async () => { producerCalls++; return okProducer(); }, verifier: okVerifier });
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: mk() });
  const realBookend = orch1._bookend.bind(orch1);
  orch1._bookend = (name, status) => { if (name === 'done') throw new Error('ledger write failed'); return realBookend(name, status); };
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused', JSON.stringify(r1));
  assert.equal(r1.reason, 'error');
  assert.equal(r1.detail, 'ledger write failed');
  assert.ok(producerCalls > 0, 'the graph ran to completion before the failure');
  const saved = readPipelineForResume(orch1.state.id);
  assert.equal(saved.row.status, 'paused');
  assert.ok(saved.resumePoint.snapshot, 'the FINAL scheduler snapshot is the point (D14)');
  assert.ok(saved.resumePoint.snapshot.ended, 'End was reached in that snapshot');
  assert.ok(!saved.resumePoint.snapshot.execs.some((e) => e.status === 'start' || e.status === 'paused' || e.status === 'error'),
    'nothing is left to re-invoke');
  const before = producerCalls;
  const orch2 = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true }, runners: mk(), resume: saved });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done', JSON.stringify(r2));
  assert.equal(producerCalls, before, 'no agent re-ran: the graph was already complete');
  assert.equal(orch2.getState().endReached, true, 'the restored `ended` re-sets endReached (no quiescence warning)');
  assert.equal(readPipelineForResume(orch1.state.id).row.status, 'done');
});

test('_afterExecution throwing pauses the run; the execution row is paused and re-runs on resume', async () => {
  const dir = gitDir();
  let once = true;
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: runners() });
  const real = orch1._afterExecution.bind(orch1);
  orch1._afterExecution = async (...a) => { if (once) { once = false; throw new Error('review write failed'); } return real(...a); };
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused', JSON.stringify(r1));
  assert.equal(r1.detail, 'review write failed');
  const saved = readPipelineForResume(orch1.state.id);
  assert.ok(saved.steps.some((s) => s.status === 'paused'));
  assert.ok(!saved.steps.some((s) => s.status === 'error'));
  const orch2 = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true }, runners: runners(), resume: saved });
  assert.equal((await orch2.resume()).status, 'done');
});

test('a failure BEFORE createPipeline is still a launch error (nothing to resume)', async () => {
  const dir = gitDir();
  const rowsBefore = getDb().prepare('SELECT COUNT(*) AS n FROM pipelines').get().n;
  const orch = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: runners() });
  orch._preflightAgentKeys = () => { throw new Error('agent "ghost" is not installed'); };
  const errors = [];
  orch.on('error', (e) => errors.push(e));
  const res = await orch.run();
  assert.equal(res.status, 'error');
  assert.equal(res.pipelineDir, null);
  assert.match(res.error, /ghost/);
  assert.equal(errors.length, 1, "the launch-error channel still emits 'error'");
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM pipelines').get().n, rowsBefore, 'no row was created');
});

// ── the RESUME site: a paused run that cannot be rehydrated ENDS ──────────────
// Re-parking it would re-persist the same dead point and re-notify the task source
// on every attempt, forever (failure-policy.mjs: resume/* -> error).
test('resume: a paused run whose checkout was deleted ENDS as an error — it is never re-parked', async () => {
  const dir = gitDir();
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: runners() });
  orch1._buildWorktreeGraph = async () => { throw new Error('graphify exploded'); };
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused', JSON.stringify(r1));
  const wt = orch1.getState().branch.worktreeDir;
  assert.ok(wt && existsSync(wt));
  rmSync(wt, { recursive: true, force: true });            // the checkout is gone
  const saved = readPipelineForResume(orch1.state.id);
  assert.equal(saved.row.status, 'paused');

  const orch2 = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true }, runners: runners(), resume: saved });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'error', JSON.stringify(r2));
  assert.match(r2.error, /worktree missing/);
  const row = getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(orch1.state.id);
  assert.equal(row.status, 'error', 'the row is terminal — a second resume is refused, not repeated');
});

test('setup replay closes the preflight bookend and kicks the title off — a finished run keeps no open preflight row', async () => {
  const dir = gitDir();
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: runners() });
  // Throw INSIDE the checkpoint step — before run() closes the preflight bookend
  // and before the title kickoff — so the paused run carries an open preflight
  // row and its provisional title.
  orch1._ensureGitCheckpoint = async () => { throw new Error('git checkpoint failed: index.lock held'); };
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused', JSON.stringify(r1));
  assert.equal(orch1.getState().steps.find((s) => s.key === 'x:preflight:1')?.status, 'start', 'the pause left preflight open');
  const saved = readPipelineForResume(orch1.state.id);

  const orch2 = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true }, runners: runners(), resume: saved });
  let kicked = 0;
  const realKick = orch2._kickoffTitleGeneration.bind(orch2);
  orch2._kickoffTitleGeneration = () => { kicked++; return realKick(); };
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done', JSON.stringify(r2));
  assert.equal(orch2.getState().steps.find((s) => s.key === 'x:preflight:1')?.status, 'done', 'the replay closed the bookend');
  assert.equal(kicked, 1, 'the replay kicked the title generation off (the original run never reached it)');
});
