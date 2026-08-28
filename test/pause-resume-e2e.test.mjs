// test/pause-resume-e2e.test.mjs
// Full default workflow in MOCK mode (real phase runners, mock claude): pause at a
// step boundary (mock nodes finish fast), resume with a fresh instance, finish, and
// verify history invariants: same id, done status, resume_point cleared, step rows
// carry mock session ids end-to-end.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { BOOKEND_EXECUTION_IDS } from '../src/shared/graph/constants.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);

test('mock pipeline pauses at a boundary and resumes to done', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-e2e-'));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });

  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'demo task', auto: true, claude: { mock: true } });
  // Boundary pause: request pause right after the FIRST node completes; the dispatch
  // loop's _checkPause fires before the next step spawns. (Mock nodes are fast, so
  // by the time pause() lands the in-flight step has usually finished -> 'boundary';
  // if the abort catches the next node's start it is a 'node' pause — both valid.)
  // The bookend guard is required: the preflight/done BOOKENDS are executions
  // too (executionId x:preflight:1 / x:done:1) and they also mark 'done'; only a
  // real graph node's execution must trigger the pause.
  let pausedOnce = false;
  orch1.on('exec', ({ status, nodeId, executionId }) => {
    if (!pausedOnce && status === 'done' && nodeId && !BOOKEND_EXECUTION_IDS.includes(executionId)
        && orch1.state.status === 'running') {
      pausedOnce = true;
      orch1.pause();
    }
  });
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused');
  const id = orch1.state.id;

  const saved = readPipelineForResume(id);
  assert.equal(saved.resumePoint.version, 2, 'a graph resume point');
  assert.equal(saved.resumePoint.manifest.version, 2, 'the frozen manifest is the topology');
  assert.ok(Array.isArray(saved.resumePoint.nodes), 'the per-execution session map is frozen');
  assert.equal(saved.resumePoint.workflowId, 'wf_default');

  const orch2 = createOrchestrator({ projectDir: dir, claude: { mock: true }, auto: true, resume: saved });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done');

  const afterRun = readPipelineForResume(id);
  assert.equal(afterRun.row.status, 'done');
  assert.equal(afterRun.row.resume_point, null);
  const stepSessions = getDb().prepare(
    'SELECT session_id FROM pipeline_steps WHERE pipeline_id = ? AND node_id IS NOT NULL',
  ).all(id);
  assert.ok(stepSessions.some((s) => s.session_id && s.session_id.startsWith('mock-session-')),
    'mock session ids recorded on step rows');
});
