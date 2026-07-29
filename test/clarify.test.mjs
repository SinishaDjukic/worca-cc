// test/clarify.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildClarifyPrompt, runClarify } from '../src/core/phases.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeClarify, readClarifyRow } from '../src/core/artifacts.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { _resetForTests } from '../src/core/db.mjs';

useTempHome(after); // store writes -> isolated temp home, not real ~/.worca-cc

const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-clarify-'));
  tmpDirs.push(dir);
  return dir;
}
after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

function fakeCtx(dir) {
  return {
    projectDir: dir,
    pipelineDir: dir,
    taskPrompt: 'demo task',
    toolInstruction: '',
    agentPrompts: { clarify: '' },
    claudeOpts: { mock: true },
    signal: undefined,
    onEvent: () => {},
  };
}

test('buildClarifyPrompt re-injects prior answers and forbids re-asking', () => {
  const prompt = buildClarifyPrompt(fakeCtx('/p'), {
    round: 2,
    priorAnswers: [{ id: 'sess', question: 'Where to store sessions?', choice: 'Redis' }],
  });
  assert.match(prompt, /DO NOT ask these again/);
  assert.match(prompt, /Where to store sessions\?/);
  assert.match(prompt, /Redis/);
  assert.match(prompt, /MOCK_PRIOR: 1/);
});

test('buildClarifyPrompt omits the answered section on the first round', () => {
  const prompt = buildClarifyPrompt(fakeCtx('/p'), { round: 1, priorAnswers: [] });
  assert.doesNotMatch(prompt, /DO NOT ask these again/);
  assert.match(prompt, /MOCK_PRIOR: 0/);
});

test('clarify converges once answers are fed back (mock)', async () => {
  const ctx = fakeCtx(await makeTmpDir());
  const r1 = await runClarify(ctx, { round: 1, priorAnswers: [] });
  assert.ok(r1.questions.length > 0, 'round 1 asks at least one question');
  const r2 = await runClarify(ctx, {
    round: 2,
    priorAnswers: [{ id: 'q1', question: 'How handle invalid input?', choice: 'Fail fast' }],
  });
  assert.equal(r2.questions.length, 0, 'round 2 with answers asks nothing');
});

test('orchestrator no longer exposes a clarify round cap', () => {
  const orch = createOrchestrator({});
  assert.equal(orch.maxClarifyCycles, undefined, 'maxClarifyCycles field should be gone');
});

test('clarify runs exactly one round (no clarify phase past cycle 1)', async () => {
  const projectDir = await makeTmpDir();
  const orch = createOrchestrator({
    projectDir,
    prompt: 'demo task',
    auto: true,
    claude: { mock: true },
  });
  const clarifyCycles = [];
  let clarifyQuestions = 0;
  orch.on('phase', ({ phase, cycle }) => {
    if (phase === 'clarify') clarifyCycles.push(cycle);
  });
  // In mock mode the planner always returns questions on the first call
  // (MOCK_PRIOR === 0), so a single clarify round must fire this exactly once.
  orch.on('question', ({ kind }) => {
    if (kind === 'clarify') clarifyQuestions += 1;
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', 'mock pipeline should finish');
  assert.ok(clarifyCycles.length > 0, 'clarify phase should run');
  assert.ok(
    clarifyCycles.every((c) => c === 1),
    `clarify must stay on cycle 1, saw cycles ${clarifyCycles.join(',')}`,
  );
  assert.equal(clarifyQuestions, 1, 'clarify must be asked exactly once');
});

import { normalizeClarify } from '../src/core/protocol.mjs';

test('normalizeClarify caps questions at MAX_CLARIFY_QUESTIONS (8)', () => {
  const many = {
    questions: Array.from({ length: 12 }, (_, i) => ({
      id: `q${i}`,
      question: `Question ${i}?`,
      options: ['a', 'b', 'c'],
    })),
  };
  const out = normalizeClarify(many);
  assert.equal(out.questions.length, 8);
});

test('normalizeClarify allows 2–4 options and never pads', () => {
  const out = normalizeClarify({
    questions: [
      { id: 'binary', question: 'A or B?', options: ['A', 'B'] },                 // 2 kept
      { id: 'triple', question: 'Three?', options: ['x', 'y', 'z'] },             // 3 kept
      { id: 'quad',   question: 'Four?',  options: ['1', '2', '3', '4'] },        // 4 kept
      { id: 'over',   question: 'Five?',  options: ['1', '2', '3', '4', '5'] },   // capped to 4
      { id: 'blanks', question: 'Blanks?', options: ['real', '', '  ', 'b'] },    // blanks dropped
    ],
  });
  assert.deepEqual(out.questions[0].options, ['A', 'B']);
  assert.deepEqual(out.questions[1].options, ['x', 'y', 'z']);
  assert.deepEqual(out.questions[2].options, ['1', '2', '3', '4']);
  assert.deepEqual(out.questions[3].options, ['1', '2', '3', '4']);
  assert.deepEqual(out.questions[4].options, ['real', 'b']);
  assert.ok(out.questions.every((q) => q.allowFreeText === true)); // still forced true
});

import { spawnSync } from 'node:child_process';

test('CLI no longer advertises --max-clarify in help', () => {
  const r = spawnSync(process.execPath, ['src/cli/worca-cc.mjs', '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /--max-clarify/);
});

// ── Task 3.10 — clarify DB writer / history read ───────────────────────────────
// The agent still writes clarify.json (protocol.readClarify parses it for the live
// planner loop); the orchestrator MIRRORS the normalized questions + answers into
// the clarify row so history has a durable record. WORCA_HOME is the file's temp
// home (useTempHome); _resetForTests() gives a clean DB handle for this test.

test('writeClarify upserts questions then answers into the clarify row', () => {
  _resetForTests();
  seedPipelineRow({ id: 'q1id0000', projectKey: 'proj-00000001', status: 'running' });
  writeClarify('q1id0000', { questions: { questions: [{ id: 'q1', question: 'Which DB?', options: ['a', 'b', 'c'], allowFreeText: true }] } });
  let row = readClarifyRow('q1id0000');
  assert.equal(row.questions.questions[0].question, 'Which DB?');
  assert.equal(row.answers, null);
  writeClarify('q1id0000', { answers: { answers: [{ id: 'q1', question: 'Which DB?', choice: 'a' }] } });
  row = readClarifyRow('q1id0000');
  assert.equal(row.questions.questions[0].question, 'Which DB?', 'questions preserved on the answers upsert');
  assert.equal(row.answers.answers[0].choice, 'a');
});

// ── M1.2 — runClarify ingests the agent's clarify into the DB row ─────────
import { _resetForTests as _resetDb2 } from '../src/core/db.mjs';

test('runClarify persists questions to the clarify row and returns them from the DB', async () => {
  _resetDb2();
  const dir = await makeTmpDir();
  // A pipelines row must exist for the clarify FK (seedPipelineRow inserts it).
  seedPipelineRow({ id: 'clrf0001', projectKey: 'proj-00000001', status: 'running' });
  const ctx = { ...fakeCtx(dir), pipelineId: 'clrf0001' };
  const r = await runClarify(ctx, { round: 1, priorAnswers: [] });
  assert.ok(r.questions.length > 0, 'returns questions');
  // Authoritative source: the DB row, written by the runner itself.
  const row = readClarifyRow('clrf0001');
  assert.ok(row.questions, 'clarify row populated by runClarify');
  assert.equal(row.questions.questions[0].id, r.questions[0].id, 'returned questions match the DB row');
});

test('runClarify still works (FS fallback) when ctx has no pipelineId', async () => {
  const ctx = fakeCtx(await makeTmpDir()); // no pipelineId
  const r = await runClarify(ctx, { round: 1, priorAnswers: [] });
  assert.ok(r.questions.length > 0, 'falls back to the FS-parsed clarify when no pipelineId');
});

test('protocol no longer exports writeClarifyAnswers (dead FS write removed)', async () => {
  const protocol = await import('../src/core/protocol.mjs');
  assert.equal(protocol.writeClarifyAnswers, undefined, 'writeClarifyAnswers removed');
});
