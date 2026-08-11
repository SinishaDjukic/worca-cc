// test/pause-resume-e2e.test.mjs
// Full default workflow in MOCK mode (the real generic executor, mock claude):
// pause mid-run, resume with a fresh instance, finish, and verify the history
// invariants: same id, done status, resume_point cleared, step rows carry mock
// session ids end-to-end.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);

test('mock pipeline pauses at a boundary and resumes to done', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-e2e-'));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });

  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'demo task', auto: true, claude: { mock: true } });
  // Pause the moment the FIRST AGENT execution starts. Agent rows are the only ones
  // that can actually be interrupted (flow cards are instant and $0), and pausing on
  // `start` rather than `done` is deterministic: the mock child is still in flight, so
  // the pause abort always has something to unwind.
  let pausedOnce = false;
  orch1.on('exec', ({ status, agentKey }) => {
    if (!pausedOnce && status === 'start' && agentKey && orch1.state.status === 'running') {
      pausedOnce = true;
      queueMicrotask(() => orch1.pause());
    }
  });
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused');
  const id = orch1.state.id;

  const saved = readPipelineForResume(id);
  assert.equal(saved.resumePoint.version, 2, 'a resume-v2 point');
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
