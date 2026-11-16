// test/clarify-max-questions.test.mjs
// Shape it first (spec D3): a Clarify node may cap its questions below the protocol's 8 with
// `config.maxQuestions`. normalizeClarify already dropped the invalid ones, so the cap keeps the FIRST N
// valid questions, in the agent's order. Driven like clarify-node-forms: the offline mock is the spawn and
// MOCK_ASK_FORM on the node's agentPrompt is what it writes verbatim.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { runClarifierExecution } from '../src/core/graph/executor.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-clarmax-home-'));
  for (const k of ['HOME', 'USERPROFILE']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 3 });
});

const dirs = [];
async function tmp() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-clarmax-')); dirs.push(d); return d; }
after(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));

const PORTS = {
  inputs: [{ id: 'task', type: 'md', required: true, as: 'file' }],
  outputs: [{ id: 'answers', type: 'json', when: 'always', filename: 'clarify.json', store: 'run', artifactKind: 'answers' }],
};

const QUESTIONS = Array.from({ length: 5 }, (_, i) => ({
  id: `q${i + 1}`, question: `Question ${i + 1}?`, options: [{ label: 'A' }, { label: 'B' }],
}));

async function ctxFor({ config, seen }) {
  const projectDir = await tmp();
  const pipelineDir = await tmp();
  await mkdir(pipelineDir, { recursive: true });
  return {
    projectDir, pipelineDir, pipelineId: null, taskPrompt: 'demo',
    node: { id: 'n_clarify', kind: 'agent', key: 'clarifier', ...(config ? { config } : {}),
      agentPrompt: `You clarify.\n\nMOCK_ROLE: clarify\nMOCK_ASK_FORM: ${JSON.stringify({ questions: QUESTIONS })}\n` },
    meta: { key: 'clarifier', displayName: 'Clarify', runnerType: 'clarifier' },
    ports: PORTS,
    bindings: {},
    outputs: { answers: { path: join(pipelineDir, 'clarify.json'), type: 'json' } },
    verdict: null,
    ordinal: 1,
    executionId: 'x:n_clarify:1',
    runCtx: { pipelineDir, baseName: 'demo' },
    claudeOpts: { mock: true },
    onEvent: () => {},
    ask: async (q) => { seen.push(q); return { answers: q.questions.map((x) => ({ id: x.id, choice: 'A' })) }; },
  };
}

test('config.maxQuestions keeps the first N questions: the ask, the result and clarify.json all see them', async () => {
  const seen = [];
  const ctx = await ctxFor({ config: { maxQuestions: 3 }, seen });
  const out = await runClarifierExecution(ctx);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].questions.length, 3, 'the ask receives exactly 3');
  assert.deepEqual(out.questions.map((q) => q.id), ['q1', 'q2', 'q3']);
  const written = JSON.parse(await readFile(ctx.outputs.answers.path, 'utf8'));
  assert.equal(written.questions.length, 3);
  assert.equal(written.answers.length, 3);
  assert.ok(out.warnings.some((w) => /n_clarify/.test(w) && /5 questions/.test(w) && /first 3/.test(w)), 'the cap is a run warning');
});

test('without maxQuestions (or with a cap at least as large) all questions are kept and nothing is warned', async () => {
  for (const config of [undefined, {}, { maxQuestions: 5 }, { maxQuestions: 8 }]) {
    const seen = [];
    const out = await runClarifierExecution(await ctxFor({ config, seen }));
    assert.equal(seen[0].questions.length, 5, JSON.stringify(config));
    assert.deepEqual(out.warnings, [], JSON.stringify(config));
  }
});

test('a non-integer or sub-1 maxQuestions is ignored', async () => {
  for (const maxQuestions of [0, -2, 2.5, 'many', null]) {
    const seen = [];
    await runClarifierExecution(await ctxFor({ config: { maxQuestions }, seen }));
    assert.equal(seen[0].questions.length, 5, JSON.stringify(maxQuestions));
  }
});

test('placement: the cap sits after the form downgrade and before `let answers = []`', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/core/graph/executor.mjs', import.meta.url)), 'utf8');
  const fn = src.slice(src.indexOf('export async function runClarifierExecution'));
  const downgrade = fn.indexOf('questions = gate.questions');
  const cap = fn.indexOf('maxQuestions');
  const answers = fn.indexOf('let answers = [];');
  assert.ok(downgrade > 0 && cap > downgrade && answers > cap, `${downgrade} < ${cap} < ${answers}`);
});

// D19: a later slice publishes the feature's Clarify answers (slice 1's) without spawning or asking.
test('carriedClarify: no spawn, no ask; the port file, the result and the clarify row carry the answers', async () => {
  const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
  const { readClarifyRow } = await import('../src/core/artifacts.mjs');
  const rows = [
    { name: 'questions', carried: {
      questions: { questions: [{ id: 'q1', question: 'Where?', options: ['A', 'B'] }] },
      answers: { answers: [{ id: 'q1', question: 'Where?', choice: 'B' }], answeredBy: 'local' } },
    file: (c) => ({ questions: c.questions.questions, answers: c.answers.answers }) },
    { name: 'form', carried: { questions: { form: 'f1' }, answers: { kind: 'form', form: 'f1', version: 2, values: { a: 1 } } },
      file: () => ({ form: 'f1', version: 2, values: { a: 1 } }) },
  ];
  for (const row of rows) {
    const seen = [];
    const ctx = await ctxFor({ seen });
    ctx.pipelineId = `p-carry-${row.name}-${Date.now()}`;
    seedPipelineRow({ id: ctx.pipelineId });
    ctx.ask = async () => { throw new Error('a carried Clarify must not ask'); };
    ctx.claudeOpts = { mock: false, bin: '/nonexistent/claude-must-not-spawn' };
    ctx.carriedClarify = row.carried;
    const out = await runClarifierExecution(ctx);
    const written = JSON.parse(await readFile(ctx.outputs.answers.path, 'utf8'));
    assert.deepEqual(written, row.file(row.carried), row.name);
    assert.deepEqual(out.answers, row.name === 'form' ? [] : row.carried.answers.answers, row.name);
    assert.equal(out.sessionId, null);
    assert.deepEqual(readClarifyRow(ctx.pipelineId), row.carried, row.name);
  }
});

test('1.8: a fenced questions file still asks; a file that yields nothing warns; duplicate ids get their own answer', async () => {
  const { _testing } = await import('../src/core/graph/executor.mjs');
  const { writeFile } = await import('node:fs/promises');
  try {
    const seen = [];
    const ctx = await ctxFor({ seen });
    _testing.runClaude = async () => {
      await writeFile(ctx.outputs.answers.path, 'Here are my questions:\n```json\n' + JSON.stringify({ questions: [
        { id: 'q1', question: 'One?', options: ['A', 'B'] },
        { id: 'q1', question: 'Two?', options: ['C', 'D'] },
      ] }) + '\n```\n', 'utf8');
      return { text: 'asked' };
    };
    const out = await runClarifierExecution(ctx);
    assert.equal(seen.length, 1, 'the fenced file was not silently dropped');
    assert.deepEqual(seen[0].questions.map((q) => q.id), ['q1', 'q1_2'], 'a duplicate id is renamed, not merged');
    assert.equal(out.answers.length, 2);

    const silent = [];
    const ctx2 = await ctxFor({ seen: silent });
    _testing.runClaude = async () => { await writeFile(ctx2.outputs.answers.path, 'I have no questions, but here is prose.', 'utf8'); return { text: '' }; };
    const out2 = await runClarifierExecution(ctx2);
    assert.equal(silent.length, 0);
    assert.ok(out2.warnings.some((w) => /n_clarify/.test(w) && /no questions could be read/.test(w)), JSON.stringify(out2.warnings));

    // A clarifier that wrote NO file chose not to ask: no warning.
    const none = await ctxFor({ seen: [] });
    _testing.runClaude = async () => ({ text: '' });
    assert.deepEqual((await runClarifierExecution(none)).warnings, []);
  } finally { _testing.runClaude = null; }
});
