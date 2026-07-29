// test/orchestrator-db-authoritative.test.mjs
// M1-Backend: the clarify + reviews DB tables are the AUTHORITATIVE store. A full
// mock run must leave a readable clarify row (questions + answers) and per-cycle
// review verdicts, and the loop must gate on those — proven by the run finishing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readClarifyRow, readReviewRow } from '../src/core/artifacts.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-dbauth-'));
  tmpDirs.push(dir);
  return dir;
}
after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

test('ctx carries pipelineId to runners (clarify row written by the runner)', async () => {
  const projectDir = await makeTmpDir();
  const orch = createOrchestrator({ projectDir, prompt: 'demo task', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  const pipelineId = orch.getState().id;
  assert.ok(pipelineId, 'run produced a pipeline id');
  // The clarify questions were ingested into the DB row by runClarify itself.
  const row = readClarifyRow(pipelineId);
  assert.ok(row.questions, 'clarify row has questions (runner persisted them)');
  assert.ok(Array.isArray(row.questions.questions), 'questions payload shape');
  assert.ok(row.questions.questions.length > 0, 'mock asks at least one question');
});

test('a full mock run persists per-cycle review verdicts authoritatively (impl kind)', async () => {
  const projectDir = await makeTmpDir();
  const orch = createOrchestrator({ projectDir, prompt: 'demo task', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  const id = orch.getState().id;
  // The default workflow runs reviewer -> implementer loop; mock yields a major at
  // cycle 1 then clears at cycle 2 (claude-runner.mjs mockReviewer). Both cycles'
  // verdicts must be readable from the reviews table (kind 'impl').
  const c1 = readReviewRow(id, 'impl', 1);
  const c2 = readReviewRow(id, 'impl', 2);
  assert.ok(c1, 'cycle 1 impl verdict persisted');
  assert.ok(Array.isArray(c1.issues), 'verdict shape: issues[]');
  assert.equal(c1.issues.some((i) => i.severity === 'major'), true, 'cycle 1 had a blocking major');
  assert.ok(c2, 'cycle 2 impl verdict persisted');
  assert.equal(c2.issues.some((i) => i.severity === 'major'), false, 'cycle 2 cleared the blocker');
});

test('no clarify-answers.json is written; answers live only in the clarify DB row', async () => {
  const projectDir = await makeTmpDir();
  const orch = createOrchestrator({ projectDir, prompt: 'demo task', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  const id = orch.getState().id;
  const runDir = orch.getState().pipelineDir;
  assert.equal(existsSync(join(runDir, 'clarify-answers.json')), false, 'dead FS write removed');
  const row = readClarifyRow(id);
  assert.ok(row.answers, 'answers persisted to the clarify row');
  assert.ok(Array.isArray(row.answers.answers), 'answers payload shape');
  assert.ok(row.answers.answers.length > 0, 'mock auto-answered the question');
  assert.ok(row.answers.answers[0].choice, 'answer carries a choice');
});
