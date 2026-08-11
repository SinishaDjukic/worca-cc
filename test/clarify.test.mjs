// test/clarify.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeClarify, readClarifyRow } from '../src/core/artifacts.mjs';
import { runClarifierExecution } from '../src/core/graph/executor.mjs';
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

/** A minimal clarifier EXECUTION ctx: the graph engine's replacement for v1's
 *  bound clarify runner. `ask` auto-answers with each question's first option. */
function fakeCtx(dir) {
  const ports = {
    runnerType: 'clarifier',
    displayName: 'Clarify',
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'answers', type: 'json', when: 'always', filename: 'clarify.json', store: 'run', artifactKind: 'clarify' }],
  };
  return {
    node: { id: 'n_clarify', kind: 'agent', key: 'clarify' },
    executionId: 'x:n_clarify:1',
    ordinal: 1,
    projectDir: dir,
    pipelineDir: dir,
    taskPrompt: 'demo task',
    toolInstruction: '',
    agentPrompts: { clarify: '' },
    claudeOpts: { mock: true },
    signal: undefined,
    onEvent: () => {},
    ports,
    meta: ports,
    bindings: {},
    trigger: { freshPorts: ['task'] },
    template: { nodes: [{ id: 'n_clarify', kind: 'agent', key: 'clarify' }], wires: [] },
    runCtx: { pipelineDir: dir, projectDir: dir, baseName: 'demo', datePrefix: '01-01-26' },
    ask: async ({ questions }) => ({
      answers: (questions || []).map((q) => ({ id: q.id, choice: (q.options || ['ok'])[0] })),
    }),
  };
}

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
  orch.on('exec', ({ agentKey, ordinal, status }) => {
    if (agentKey === 'clarify' && status === 'start') clarifyCycles.push(ordinal);
  });
  // In mock mode the clarifier always returns questions on the first call
  // (MOCK_PRIOR === 0), so a single clarify execution must fire this exactly once.
  orch.on('question', ({ kind }) => {
    if (kind === 'clarify') clarifyQuestions += 1;
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', 'mock pipeline should finish');
  assert.ok(clarifyCycles.length > 0, 'the clarify node should run');
  assert.deepEqual(clarifyCycles, [1],
    `clarify must execute exactly once, saw ordinals ${clarifyCycles.join(',')}`);
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

// ── M1.2 — the clarifier executor ingests its questions into the DB row ────
import { _resetForTests as _resetDb2 } from '../src/core/db.mjs';

test('the clarifier executor persists questions to the clarify row', async () => {
  _resetDb2();
  const dir = await makeTmpDir();
  // A pipelines row must exist for the clarify FK (seedPipelineRow inserts it).
  seedPipelineRow({ id: 'clrf0001', projectKey: 'proj-00000001', status: 'running' });
  const ctx = { ...fakeCtx(dir), pipelineId: 'clrf0001' };
  const r = await runClarifierExecution(ctx);
  assert.ok(r.questions.length > 0, 'returns questions');
  // Authoritative source: the DB row, written by the executor itself.
  const row = readClarifyRow('clrf0001');
  assert.ok(row.questions, 'clarify row populated by the executor');
  assert.equal(row.questions.questions[0].id, r.questions[0].id, 'returned questions match the DB row');
  assert.equal(row.answers.answers.length, r.answers.length, 'the gated answers land too');
});

test('the clarifier executor still works (FS only) when ctx has no pipelineId', async () => {
  const ctx = fakeCtx(await makeTmpDir()); // no pipelineId
  const r = await runClarifierExecution(ctx);
  assert.ok(r.questions.length > 0, 'the answers file is parsed with no DB row to write');
});

test('protocol no longer exports writeClarifyAnswers (dead FS write removed)', async () => {
  const protocol = await import('../src/core/protocol.mjs');
  assert.equal(protocol.writeClarifyAnswers, undefined, 'writeClarifyAnswers removed');
});
