// test/clarify-node-forms.test.mjs
// The clarifier publishes its ask on its `answers` PORT (D7), so the form arm
// lives in runClarifierExecution, not in _questionsLoop. Driven against the real
// executor with a stubbed spawn — the `runClaude` seam is claude-runner's mock,
// reached through MOCK_ASK_FORM on the node's agentPrompt (which resolveAgentBody
// turns into the system prompt, and parseMarkers reads system prompts too).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { runClarifierExecution, runAgentExecution } from '../src/core/graph/executor.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { readPipelineExtras } from '../src/core/artifacts.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-clarform-home-'));
  for (const k of ['HOME', 'USERPROFILE']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 3 });
});

const dirs = [];
async function tmp() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-clarform-')); dirs.push(d); return d; }
after(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const FORM = {
  version: 3, title: 'Pick a direction',
  data: { type: 'object', required: ['images'], properties: { images: { type: 'array',
    items: { type: 'object', required: ['id', 'file'], properties: {
      id: { type: 'string' }, file: { type: 'file', accept: ['image/*'] } } } } } },
  answer: { type: 'object', required: ['picked'], properties: {
    picked: { type: 'string', enumFrom: 'data.images[].id' } } },
  layout: [{ widget: 'gallery', bind: 'data.images', field: 'picked' }],
  example: { images: [] },
};

const PORTS = {
  inputs: [{ id: 'task', type: 'md', required: true, as: 'file' }],
  outputs: [{ id: 'answers', type: 'json', when: 'always', filename: 'clarify.json', store: 'run', artifactKind: 'answers' }],
};

/** Build a ctx for the clarifier executor: the offline mock is the spawn, and
 *  `agentPrompt` carries the MOCK markers (resolveAgentBody -> systemPrompt).
 *  `events` collects every runner event (runOpts stamps `role` and forwards them). */
async function ctxFor({ payload, askImpl, forms = { 'pick-one': FORM }, events = null }) {
  const projectDir = await tmp();
  const pipelineDir = await tmp();
  await mkdir(join(projectDir, 'mockups'), { recursive: true });
  await writeFile(join(projectDir, 'mockups', 'a.png'), PNG);
  const answersPath = join(pipelineDir, 'clarify.json');
  return {
    projectDir, pipelineDir, pipelineId: null, taskPrompt: 'demo',
    node: { id: 'n_clarify', kind: 'agent', key: 'clarifier',
      agentPrompt: `You clarify.\n\nMOCK_ROLE: clarify\nMOCK_ASK_FORM: ${JSON.stringify(payload)}\n` },
    meta: { key: 'clarifier', displayName: 'Clarify', runnerType: 'clarifier', ask: { forms } },
    ports: PORTS,
    bindings: {},
    outputs: { answers: { path: answersPath, type: 'json' } },
    verdict: null,
    ordinal: 1,
    executionId: 'x:n_clarify:1',
    runCtx: { pipelineDir, baseName: 'demo' },
    claudeOpts: { mock: true },
    onEvent: events ? (e) => events.push(e) : () => {},
    ask: askImpl,
  };
}

test('a clarifier ask form: gate 2 runs, the gate is kind:form, the port is rewritten as {form,version,values}', async () => {
  const seen = [];
  const ctx = await ctxFor({
    payload: { form: 'pick-one', data: { images: [{ id: 'a', file: 'mockups/a.png' }] } },
    askImpl: async (q) => { seen.push(q); return { form: q.form, version: q.version, values: { picked: 'a' } }; },
  });
  const out = await runClarifierExecution(ctx);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'form');
  assert.equal(seen[0].form, 'pick-one');
  assert.equal(seen[0].version, 3);
  assert.equal(seen[0].id, 'clarify-n_clarify-1', 'the QUESTION id — orch.answer takes this');
  assert.equal(seen[0].askId, 'clarify-n_clarify-1', 'the ROUTE token — identical here only because the node id is already safe');
  assert.equal(seen[0].surface, 'any');
  assert.deepEqual(seen[0].answerSchema.properties.picked.enum, ['a'], 'enumFrom resolved at ask time');
  assert.equal(seen[0].files[0].mime, 'image/png');
  assert.deepEqual(seen[0].fileRefs, [{ path: 'data.images[0].file', rel: 'mockups/a.png' }]);
  assert.deepEqual(seen[0].fileRefs.map((r) => r.rel), seen[0].files.map((f) => f.rel), 'index for index');
  assert.equal(typeof seen[0].validate, 'function', 'gate 3 rides the ask');
  assert.deepEqual(seen[0].validate({ values: { picked: 'zzz' } }).ok, false);

  const written = JSON.parse(await readFile(ctx.outputs.answers.path, 'utf8'));
  assert.deepEqual(written, { form: 'pick-one', version: 3, values: { picked: 'a' } },
    'the agent receives exactly the §4 resume payload on its answers port');
  assert.deepEqual(out.questions, [], 'the legacy halves stay empty for a form ask');
  assert.deepEqual(out.answers, []);
  assert.deepEqual(out.values, { picked: 'a' });
});

test('a clarifier ask form refused twice downgrades to one free-text question — never a crash; the repair RESUMES the first session (E6)', async () => {
  const seen = [];
  const events = [];
  const ctx = await ctxFor({
    payload: { form: 'pick-one', data: {} },                    // `images` is required, always
    askImpl: async (q) => { seen.push(q); return { answers: [{ id: q.questions[0].id, choice: 'A' }] }; },
    events,
  });
  const out = await runClarifierExecution(ctx);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'clarify', 'the downgrade takes the clarifier\'s own legacy kind');
  assert.equal(seen[0].questions[0].question, 'Pick a direction');
  assert.equal(seen[0].questions[0].allowFreeText, true);
  const written = JSON.parse(await readFile(ctx.outputs.answers.path, 'utf8'));
  assert.ok(Array.isArray(written.questions) && Array.isArray(written.answers), 'the legacy rewrite shape');
  assert.equal(written.answers[0].choice, 'A');
  assert.ok(out.warnings.some((w) => /downgrad/i.test(w)), 'the downgrade is a run warning');
  // E6: the ONE repair spawn re-attaches the FIRST spawn's session — exactly as _questionsLoop
  // resumes a producer. The mock logs `[mock] resumed session <id>` only when handed an id, so
  // the first spawn logs none and the repair logs the first's id; a fresh-session repair logs nothing.
  const sessions = events.filter((e) => e.type === 'session').map((e) => e.sessionId);
  assert.equal(sessions.length, 2, 'the first spawn and ONE repair spawn');
  assert.deepEqual(events.filter((e) => e.type === 'assistant' && /\[mock\] resumed session/.test(e.text)).map((e) => e.text),
    [`[mock] resumed session ${sessions[0]}`], 'the repair spawn resumes the first spawn\'s session, and nothing else re-attaches');
  assert.equal(out.sessionId, sessions[1], 'the execution reports the session the repair ended on');
});

test('REGRESSION: a legacy {questions} clarifier payload is byte-for-byte what it is today', async () => {
  const seen = [];
  const ctx = await ctxFor({
    payload: { questions: [{ id: 'q1', question: 'Which storage?', options: ['Redis', 'Postgres'] }] },
    askImpl: async (q) => { seen.push(q); return { answers: [{ id: 'q1', choice: 'Postgres' }] }; },
    forms: {},
  });
  const out = await runClarifierExecution(ctx);
  assert.equal(seen[0].kind, 'clarify');
  assert.equal(seen[0].id, 'clarify-n_clarify-1');
  const written = JSON.parse(await readFile(ctx.outputs.answers.path, 'utf8'));
  assert.deepEqual(written.questions[0].options, ['Redis', 'Postgres']);
  assert.deepEqual(written.answers, [{ id: 'q1', question: 'Which storage?', choice: 'Postgres' }]);
  assert.equal(out.questions.length, 1);
});

test('with NO gate (auto / no ctx.ask) a form ask still resolves — the auto answer, never a hang', async () => {
  const ctx = await ctxFor({
    payload: { form: 'pick-one', data: { images: [{ id: 'a', file: 'mockups/a.png' }] } },
    askImpl: undefined,                                  // exactly what the scheduler passes in auto
  });
  const out = await runClarifierExecution(ctx);
  const written = JSON.parse(await readFile(ctx.outputs.answers.path, 'utf8'));
  assert.equal(written.form, 'pick-one');
  assert.deepEqual(written.values, out.values);
  assert.equal(typeof written.values, 'object');
});

test('GRAPH RUN: a user-layer clarifier declaring a form — real mock, the DB branch, History payload, E18 downstream', { timeout: 60000 }, async () => {
  // runClarifierExecution above runs with pipelineId: null, so its writeClarify /
  // writeStepQuestions branch never executes there. This drives the SAME arm through
  // the orchestrator: registry -> baseInstruction forms section -> mockClarify writes
  // {form,data} to the answers port -> gate 2 -> _ask -> DB -> readPipelineExtras
  // (what History and get_run_progress read) -> a downstream `as:'answers'` port.
  const userDir = join(worcaHome(), 'agents');
  await mkdir(userDir, { recursive: true });
  // NOT this file's FORM: `pick-one` cannot auto-answer its own `example` (an empty
  // `images` leaves the required `picked` with a closed, empty enum → `bad-auto`), so the
  // registry's gate 1 DROPS it and the agent "declares none". The executor tests above
  // graft it straight onto ctx.meta and never meet gate 1. A sidecar fixture needs a form
  // whose example auto-answers — here a `default` on the one required field.
  const GRAPH_FORM = {
    version: 1, title: 'Review mockups',
    data: { type: 'object', required: ['images'], properties: {
      summary: { type: 'string' },
      images: { type: 'array', items: { type: 'object', required: ['id', 'file'], properties: {
        id: { type: 'string' }, file: { type: 'file', accept: ['image/*'] } } } } } },
    answer: { type: 'object', required: ['verdict'], properties: {
      verdict: { type: 'string', enum: ['approve', 'changes'], default: 'approve' } } },
    layout: [{ widget: 'gallery', bind: 'data.images' }, { widget: 'select', field: 'verdict' }],
    example: { images: [] },
  };
  const payload = { form: 'review-mockups', data: { summary: 'Two.', images: [{ id: 'a', file: 'mockups/a.png' }] } };
  const writeUserAgent = async (key, md, meta) => {
    await writeFile(join(userDir, `${key}.md`), md, 'utf8');
    await writeFile(join(userDir, `${key}.meta.json`),
      JSON.stringify({ key, metaVersion: 2, agentFile: `${key}.md`, order: 99, ...meta }, null, 2), 'utf8');
  };
  await writeUserAgent('formClarifier', `# Form clarifier\n\nMOCK_ROLE: clarify\nMOCK_ASK_FORM: ${JSON.stringify(payload)}\n`, {
    displayName: 'Form Clarifier', runnerType: 'clarifier', asksQuestions: true,
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'answers', type: 'json', filename: 'clarify.json', artifactKind: 'clarify' }],
    ask: { forms: { 'review-mockups': GRAPH_FORM } },
  });
  await writeUserAgent('consumer', '# Consumer\n\nMOCK_ROLE: implementer\n', {
    displayName: 'Consumer', runnerType: 'producer',
    inputs: [{ id: 'task', type: 'md' }, { id: 'answers', type: 'json', as: 'answers' }],
    outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }],
  });
  const G = {
    id: 'wf_clarform', name: 'Clarifier form', domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_clar', kind: 'agent', key: 'formClarifier', x: 200, y: 0, config: {} },
      { id: 'n_make', kind: 'agent', key: 'consumer', x: 400, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clar', port: 'task' } },
      { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_make', port: 'task' } },
      { id: 'w3', from: { node: 'n_clar', port: 'answers' }, to: { node: 'n_make', port: 'answers' } },
      { id: 'w4', from: { node: 'n_make', port: 'notes' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
  await writeGraphWorkflow(G);
  const projectDir = gitDir('cf1');
  await mkdir(join(projectDir, 'mockups'), { recursive: true });
  await writeFile(join(projectDir, 'mockups', 'a.png'), PNG);
  // The agent runs in the run's WORKTREE, cut from HEAD: commit the file it references.
  execSync('git add -A && git -c user.email=t@t -c user.name=t commit -q -m mockups', { cwd: projectDir });
  // The consumer runs through the REAL executor (the injection only captures its prompt):
  // an injected runner sees the ctx BEFORE readPriorAnswers, so the E18 projection is
  // only visible in the prompt runAgentExecution returns.
  const prompts = [];
  const producer = async (ctx) => { const r = await runAgentExecution(ctx); prompts.push(r.prompt || ''); return r; };
  const orch = createOrchestrator({ projectDir, workflowId: G.id, prompt: 'demo', claude: { mock: true }, auto: false, runners: { producer } });
  const frames = [];
  orch.on('question', (q) => { frames.push(q); setImmediate(() => orch.answer(q.id, { values: { verdict: 'changes' } })); });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].kind, 'form');
  assert.equal(frames[0].id, 'clarify-n_clar-1');
  assert.equal(frames[0].askId, 'clarify-n_clar-1');
  assert.equal(frames[0].agent, 'Form Clarifier');
  assert.deepEqual(frames[0].answerSchema.properties.verdict.enum, ['approve', 'changes']);
  assert.equal(frames[0].files[0].mime, 'image/png');
  assert.ok(existsSync(join(orch.pipeline.dir, 'ask-files', 'clarify-n_clar-1', '0.png')), 'the snapshot lives in the pipeline dir');
  const extras = readPipelineExtras(orch.pipeline.id);
  assert.equal(extras.clarify.ask.form, 'review-mockups', 'X3: History reads clarify.ask');
  assert.equal(extras.clarify.ask.askId, 'clarify-n_clar-1');
  assert.deepEqual(extras.clarify.ask.values, { verdict: 'changes' });
  assert.deepEqual(extras.clarify.formAnswer, { form: 'review-mockups', version: 1, values: { verdict: 'changes' } });
  assert.deepEqual(extras.clarify.questions, [], 'the legacy halves stay empty (E13)');
  assert.deepEqual(extras.clarify.answers, []);
  const rounds = extras.stepQuestions.filter((r) => r.nodeId === 'n_clar');
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].ask.form, 'review-mockups');
  assert.deepEqual(rounds[0].formAnswer, { form: 'review-mockups', version: 1, values: { verdict: 'changes' } });
  assert.equal(prompts.length, 1, 'the consumer ran once');
  assert.match(prompts[0], /## Clarifications already answered/, 'E18: the downstream answers port renders the projection');
  assert.match(prompts[0], /verdict[^\n]*changes/);
});
