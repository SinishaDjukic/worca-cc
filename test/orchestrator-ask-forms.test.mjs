// test/orchestrator-ask-forms.test.mjs
// Gate 2 inside the ask-then-resume loop (spec §5). Harness = the one
// test/orchestrator-questions.test.mjs uses: a REAL saved v2 graph, the REAL
// scheduler, auto:false, and an injected `producer` runner standing in for the
// spawn (opts.runners). The runner writes the ask FILE the loop then reads, so a
// mock agent produces a {form,data} payload with no live claude anywhere.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { readStepQuestions } from '../src/core/artifacts.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { getDb } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { execSync } from 'node:child_process';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-askforms-home-'));
  for (const k of ['HOME', 'USERPROFILE']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 3 });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const FORM = {
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

const ASKS = { askQuestions: true };
const G = {
  id: 'wf_forms_single', name: 'Forms single', domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_ask', kind: 'agent', key: 'implementer', x: 200, y: 0, config: { ...ASKS } },
    { id: 'n_end', kind: 'end', x: 400, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_ask', port: 'plan' } },
    { id: 'w2', from: { node: 'n_ask', port: 'done' }, to: { node: 'n_end', port: 'result' } },
  ],
};

function outsOf(ctx) {
  const o = {};
  for (const p of ctx.ports.outputs || []) o[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
  return o;
}

/** Build the orchestrator, then GRAFT the form onto the live registry entry the
 *  resolver handed the node — the cheapest way to give a builtin agent a form
 *  without writing a user-layer sidecar the registry would have to re-scan. */
async function orchWithForm(producer, { tag, auto = false }) {
  await writeGraphWorkflow(G);
  return createOrchestrator({
    projectDir: gitDir(tag), workflowId: G.id, prompt: 'demo',
    claude: { mock: true }, auto, runners: { producer },
  });
}

/** The registry meta the node ctx carries is `resolved.nodes[id].meta`; patch it
 *  once the run has resolved (the first producer call proves it has). */
function graftForm(ctx) {
  ctx.meta.ask = { forms: { 'review-mockups': FORM } };
  ctx.askForms = ctx.meta.ask.forms;
}

const auditLines = (pipelineId) => getDb()
  .prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(pipelineId)
  .map((r) => r.text);

test("exactly one built-in declares forms — the reviewer's reference form (P5); nothing else here is a shipped behaviour change", () => {
  const reg = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
  for (const [key, meta] of Object.entries(reg)) {
    assert.equal('ask' in meta, key === 'reviewer', `${key} unexpectedly ${key === 'reviewer' ? 'lacks' : 'declares'} ask forms`);
  }
});

test('a {form,data} ask: gate 2 resolves it, the envelope is kind:form, the agent resumes with values',
  { timeout: 60000 }, async () => {
  let calls = 0;
  let asked = null;
  const orch = await orchWithForm(async (ctx) => {
    calls += 1;
    if (calls === 1) {
      graftForm(ctx);
      await mkdir(join(ctx.projectDir, 'mockups'), { recursive: true });
      await writeFile(join(ctx.projectDir, 'mockups', 'a.png'), PNG);
      ctx.onEvent({ type: 'session', sessionId: 'sess-form-1' });
      await writeFile(ctx.questionsFile, JSON.stringify({
        form: 'review-mockups',
        data: { summary: 'Two directions.', images: [{ id: 'a', file: 'mockups/a.png' }] },
      }), 'utf8');
    } else {
      asked = { resume: ctx.resumeSessionId, formAnswers: ctx.formAnswers };
    }
    return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
  }, { tag: 'af1' });

  const frames = [];
  orch.on('question', (q) => {
    frames.push(q);
    setImmediate(() => orch.answer(q.id, { values: { verdict: 'changes' } }));
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);

  assert.equal(frames.length, 1);
  const q = frames[0];
  assert.equal(q.kind, 'form');
  assert.equal(q.form, 'review-mockups');
  assert.equal(q.version, 1);
  assert.equal(q.title, 'Review mockups');
  assert.equal(q.id, 'questions-x:n_ask:1-r1', 'the QUESTION id — orch.answer(id, …) takes this');
  assert.equal(q.askId, q.id.replace(/[^A-Za-z0-9_-]/g, '_'), 'the ROUTE token — distinct from `id` (X1)');
  assert.notEqual(q.askId, q.id);
  assert.equal(q.surface, 'any', 'X1/E19: every form ask carries a surface');
  assert.deepEqual(q.answerSchema.properties.verdict.enum, ['approve', 'changes']);
  assert.equal(q.files.length, 1);
  assert.equal(q.files[0].mime, 'image/png');
  assert.equal(q.files[0].rel, 'mockups/a.png');
  assert.deepEqual(q.fileRefs, [{ path: 'data.images[0].file', rel: 'mockups/a.png' }],
    'X16: the renderer looks a bound path up here instead of guessing at the string');
  assert.deepEqual(q.fileRefs.map((r) => r.rel), q.files.map((f) => f.rel), 'index for index');
  assert.ok(existsSync(join(orch.pipeline.dir, 'ask-files', q.askId, '0.png')), 'the snapshot lives in the pipeline dir');

  assert.equal(calls, 2, 'exactly one resume');
  assert.equal(asked.resume, 'sess-form-1', 'the SAME session is resumed');
  assert.deepEqual(asked.formAnswers, [{ form: 'review-mockups', version: 1, values: { verdict: 'changes' } }]);
  assert.equal(existsSync(join(orch.pipeline.dir, 'questions-x-n_ask-c1-r1.json')), false, 'the round file is consumed');

  const rounds = readStepQuestions(orch.pipeline.id).filter((r) => r.nodeId === 'n_ask');
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].ask.kind, 'form');
  assert.equal(rounds[0].ask.form, 'review-mockups');
  assert.equal(rounds[0].ask.files.length, 1);
  assert.deepEqual(rounds[0].ask.values, { verdict: 'changes' }, 'the persisted ask carries the answer (§9)');
  assert.deepEqual(rounds[0].questions, [], 'the legacy arrays stay empty for a form row (E13)');
});

test('gate 2 refusal: the agent is resumed ONCE with the errors and the schema, then the fixed ask gates',
  { timeout: 60000 }, async () => {
  const prompts = [];
  let calls = 0;
  const orch = await orchWithForm(async (ctx) => {
    calls += 1;
    prompts.push(ctx.formRepair ? 'repair' : 'normal');
    if (calls === 1) {
      graftForm(ctx);
      ctx.onEvent({ type: 'session', sessionId: 'sess-bad' });
      await writeFile(ctx.questionsFile, JSON.stringify({ form: 'review-mockups', data: { summary: 'no images' } }), 'utf8');
    } else if (calls === 2) {
      assert.ok(ctx.formRepair, 'the repair ctx is what renders the error list + schema');
      assert.equal(ctx.formRepair.form, 'review-mockups');
      assert.ok(ctx.formRepair.errors.some((e) => e.code === 'required'));
      assert.equal(ctx.formRepair.file, ctx.questionsFile, 'the SAME round file is re-armed');
      await writeFile(ctx.questionsFile, JSON.stringify({ form: 'review-mockups', data: { images: [] } }), 'utf8');
    }
    return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
  }, { tag: 'af2' });

  const frames = [];
  orch.on('question', (q) => { frames.push(q); setImmediate(() => orch.answer(q.id, { values: { verdict: 'approve' } })); });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(prompts, ['normal', 'repair', 'normal'], 'one repair spawn, then the post-answer resume');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].kind, 'form');
  assert.ok(auditLines(orch.pipeline.id).some((l) => /was refused/.test(l)), 'the run log records the refusal');
});

test('gate 2 refused TWICE: downgrade to one free-text question, never a crash', { timeout: 60000 }, async () => {
  let calls = 0;
  const orch = await orchWithForm(async (ctx) => {
    calls += 1;
    if (calls <= 2) {
      graftForm(ctx);
      ctx.onEvent({ type: 'session', sessionId: 'sess-worse' });
      await writeFile(ctx.questionsFile, JSON.stringify({ form: 'review-mockups', data: { summary: 'still wrong' } }), 'utf8');
    }
    return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
  }, { tag: 'af3' });

  const frames = [];
  orch.on('question', (q) => { frames.push(q); setImmediate(() => orch.answer(q.id, { answers: [{ id: q.questions[0].id, choice: 'do the safe thing' }] })); });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].kind, 'questions', 'downgraded to the LEGACY kind');
  assert.equal(frames[0].questions[0].question, 'Review mockups', 'the form title verbatim (E12)');
  assert.equal(frames[0].questions[0].allowFreeText, true);
  assert.deepEqual(frames[0].questions[0].options, []);
  assert.ok(auditLines(orch.pipeline.id).some((l) => /downgraded/.test(l)));
});

test('an UNKNOWN form id is a gate-2 refusal, not a crash', { timeout: 60000 }, async () => {
  let calls = 0;
  const orch = await orchWithForm(async (ctx) => {
    calls += 1;
    if (calls <= 2) {
      graftForm(ctx);
      ctx.onEvent({ type: 'session', sessionId: 'sess-unknown' });
      await writeFile(ctx.questionsFile, JSON.stringify({ form: 'no-such-form', data: {} }), 'utf8');
    }
    return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
  }, { tag: 'af4' });
  const frames = [];
  orch.on('question', (q) => { frames.push(q); setImmediate(() => orch.answer(q.id, { answers: [{ id: q.questions[0].id, choice: 'ok' }] })); });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(frames[0].kind, 'questions');
  assert.equal(frames[0].questions[0].question, 'no-such-form', 'no title to fall back on => the id');
});

test('AUTO mode never primes the loop: no round file, no form question, no hang', { timeout: 60000 }, async () => {
  let calls = 0;
  let primed = null;
  const orch = await orchWithForm(async (ctx) => {
    calls += 1;
    if (calls === 1) {
      graftForm(ctx);
      primed = { enabled: !!ctx.questionsEnabled, file: ctx.questionsFile || null };
      // _primeQuestions hands an auto run NO round file; a producer that wrote to an
      // undefined path would throw and pause the run, which is not what is under test.
      if (ctx.questionsFile) await writeFile(ctx.questionsFile, JSON.stringify({ form: 'review-mockups', data: { images: [] } }), 'utf8');
    }
    return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
  }, { tag: 'af5', auto: true });         // auto is a CONSTRUCTOR option (test/orchestrator-questions.test.mjs)
  const frames = [];
  orch.on('question', (q) => frames.push(q));
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(frames, [], 'auto disables the ask-then-resume gate entirely (_primeQuestions)');
  assert.deepEqual(primed, { enabled: false, file: null }, 'no file is ever handed out, so no {form,data} can be written');
  assert.equal(calls, 1, 'one run, no resume');
});

test('REGRESSION: a legacy {questions} round is untouched', { timeout: 60000 }, async () => {
  let calls = 0;
  const orch = await orchWithForm(async (ctx) => {
    calls += 1;
    if (calls === 1) {
      graftForm(ctx);                     // forms DECLARED but not used
      ctx.onEvent({ type: 'session', sessionId: 'sess-legacy' });
      await writeFile(ctx.questionsFile, JSON.stringify({
        questions: [{ id: 'q1', question: 'Which storage?', options: ['Redis', 'Postgres'] }],
      }), 'utf8');
    }
    return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
  }, { tag: 'af6' });
  const frames = [];
  orch.on('question', (q) => { frames.push(q); setImmediate(() => orch.answer(q.id, { answers: [{ id: 'q1', choice: 'Postgres' }] })); });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(frames[0].kind, 'questions');
  const rounds = readStepQuestions(orch.pipeline.id).filter((r) => r.nodeId === 'n_ask');
  assert.deepEqual(rounds[0].answers, [{ id: 'q1', question: 'Which storage?', choice: 'Postgres' }]);
  assert.equal('ask' in rounds[0], false, 'a legacy row gains no form key (Task 9)');
});

// ── the USER FLOW, with NO injected runner ────────────────────────────────────
// A user-layer sidecar declares the form (Task 1), the agent .md carries the
// MOCK_ASK_FORM marker (X10), questionsPromptBlock emits MOCK_ASK (Task 5), the
// real offline mock writes {form,data} (Task 7), gate 2 snapshots, the human
// answers, and the resume carries NO MOCK_ASK — so the mock asks exactly once.
test('USER FLOW: a declared form rides registry -> prompt -> mock -> gate 2 -> answer -> resume, once', { timeout: 60000 }, async () => {
  const userDir = join(worcaHome(), 'agents');
  await mkdir(userDir, { recursive: true });
  const payload = { form: 'review-mockups', data: { summary: 'Two directions.', images: [{ id: 'a', file: 'mockups/a.png' }] } };
  await writeFile(join(userDir, 'formAgent.md'),
    `# Form agent\n\nYou review mockups.\n\nMOCK_ROLE: implementer\nMOCK_ASK_FORM: ${JSON.stringify(payload)}\n`, 'utf8');
  await writeFile(join(userDir, 'formAgent.meta.json'), JSON.stringify({
    key: 'formAgent', metaVersion: 2, displayName: 'Form Agent', runnerType: 'producer', order: 99,
    asksQuestions: true, agentFile: 'formAgent.md',
    inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }],
    ask: { forms: { 'review-mockups': FORM } },
  }, null, 2), 'utf8');
  const GU = {
    id: 'wf_forms_user', name: 'Forms user agent', domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_ask', kind: 'agent', key: 'formAgent', x: 200, y: 0, config: { ...ASKS } },
      { id: 'n_end', kind: 'end', x: 400, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_ask', port: 'task' } },
      { id: 'w2', from: { node: 'n_ask', port: 'notes' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
  await writeGraphWorkflow(GU);
  const projectDir = gitDir('af7');
  await mkdir(join(projectDir, 'mockups'), { recursive: true });
  await writeFile(join(projectDir, 'mockups', 'a.png'), PNG);
  // The agent runs in the run's WORKTREE, cut from HEAD: an uncommitted file in the
  // project dir is not there, and gate 2 would refuse the ref (file-path). Commit it.
  execSync('git add -A && git -c user.email=t@t -c user.name=t commit -q -m mockups', { cwd: projectDir });
  const orch = createOrchestrator({ projectDir, workflowId: GU.id, prompt: 'demo', claude: { mock: true }, auto: false });
  const frames = [];
  orch.on('question', (q) => { frames.push(q); setImmediate(() => orch.answer(q.id, { values: { verdict: 'changes' } })); });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(frames.length, 1, 'the mock asks ONCE: the resume prompt carries no MOCK_ASK');
  assert.equal(frames[0].kind, 'form');
  assert.equal(frames[0].form, 'review-mockups');
  assert.equal(frames[0].agent, 'Form Agent');
  assert.equal(frames[0].files[0].rel, 'mockups/a.png');
  const rounds = readStepQuestions(orch.pipeline.id).filter((r) => r.nodeId === 'n_ask');
  assert.equal(rounds.length, 1);
  assert.deepEqual(rounds[0].formAnswer, { form: 'review-mockups', version: 1, values: { verdict: 'changes' } });
  assert.ok(auditLines(orch.pipeline.id).some((l) => /asked with form "review-mockups"/.test(l)));
});

test('USER FLOW: a REAL-mock form refused twice downgrades, the free-text answer resumes the run, once', { timeout: 60000 }, async () => {
  // The offline mock rewrites the SAME payload on the repair spawn (the marker lives in
  // its system prompt), so this is the downgrade path end to end: gate 2 refuses the
  // initial ask AND the repair, the user sees ONE legacy question titled with the form,
  // and the resume prompt carries the legacy answer (so MOCK_ASK is suppressed, E21).
  const userDir = join(worcaHome(), 'agents');
  await mkdir(userDir, { recursive: true });
  const bad = { form: 'review-mockups', data: { summary: 'no images here' } };   // `images` is required
  await writeFile(join(userDir, 'badFormAgent.md'),
    `# Bad form agent\n\nYou review mockups.\n\nMOCK_ROLE: implementer\nMOCK_ASK_FORM: ${JSON.stringify(bad)}\n`, 'utf8');
  await writeFile(join(userDir, 'badFormAgent.meta.json'), JSON.stringify({
    key: 'badFormAgent', metaVersion: 2, displayName: 'Bad Form Agent', runnerType: 'producer', order: 99,
    asksQuestions: true, agentFile: 'badFormAgent.md',
    inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }],
    ask: { forms: { 'review-mockups': FORM } },
  }, null, 2), 'utf8');
  const GB = {
    id: 'wf_forms_bad', name: 'Forms bad user agent', domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_ask', kind: 'agent', key: 'badFormAgent', x: 200, y: 0, config: { ...ASKS } },
      { id: 'n_end', kind: 'end', x: 400, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_ask', port: 'task' } },
      { id: 'w2', from: { node: 'n_ask', port: 'notes' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
  await writeGraphWorkflow(GB);
  const orch = createOrchestrator({ projectDir: gitDir('af8'), workflowId: GB.id, prompt: 'demo', claude: { mock: true }, auto: false });
  const frames = [];
  orch.on('question', (q) => {
    frames.push(q);
    setImmediate(() => orch.answer(q.id, { answers: [{ id: q.questions[0].id, choice: 'do the safe thing' }] }));
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(frames.length, 1, 'ONE question: the downgrade — the resume prompt carries no MOCK_ASK');
  assert.equal(frames[0].kind, 'questions');
  assert.equal(frames[0].questions[0].question, 'Review mockups', 'the form title verbatim (E12)');
  const lines = auditLines(orch.pipeline.id);
  assert.equal(lines.filter((l) => /form "review-mockups" was refused/.test(l)).length, 2, 'the initial ask AND the repair');
  assert.ok(lines.some((l) => /downgraded to a free-text question/.test(l)));
  const rounds = readStepQuestions(orch.pipeline.id).filter((r) => r.nodeId === 'n_ask');
  assert.equal(rounds.length, 1, 'the repair consumed no round (E5)');
  assert.equal(rounds[0].ask, undefined, 'a downgraded round is a LEGACY row (E20)');
  assert.deepEqual(rounds[0].answers, [{ id: rounds[0].questions[0].id, question: 'Review mockups', choice: 'do the safe thing' }]);
});
