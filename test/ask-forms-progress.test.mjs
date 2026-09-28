// test/ask-forms-progress.test.mjs
// Ask Worca's get_run_progress over a PERSISTED form ask (spec D9, §9; rulings X3, X17).
// X3 leaves the legacy questions/answers arrays [] for a form row, so without a
// `form` field the assistant would see the round as empty — this pins that it
// sees the projection and the answered values instead, and that a legacy row is
// byte-identical to today. tools.mjs is import-free by house rule (pinned by
// test/ask-memory-tools.test.mjs and test/ask-diff-comment-tools.test.mjs), so the
// projection reaches it as the injected `askProgress` dep — the real bundle
// (tool-deps.mjs) is pinned to carry it, or every real read would report null.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { defaultToolDeps } from '../src/core/ask/tool-deps.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { askProgress, PROMPT_PROJECTION_MAX } from '../src/core/ask-projection.mjs';

useTempHome(after);

/** The persisted ask readStepQuestions/readPipelineExtras expose (P2 E13): prepareFormAsk's
 *  ask (executor.mjs `gate.ask`) — NO `agent` (added on the wire only); `agentKey` sits beside the row. */
const ASK = {
  kind: 'form', askId: 'questions-x_n1_1-r1', form: 'review-mockups', version: 1,
  title: 'Review mockups', surface: 'any',
  data: { summary: 'Two directions.', images: [{ id: 'a', caption: 'Option A' }] },
  layout: [
    { widget: 'markdown', bind: 'data.summary' },
    { widget: 'select', field: 'verdict', label: 'Verdict' },
  ],
  answerSchema: { type: 'object', required: ['verdict'], properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'], default: 'approve' } } },
  files: [],
  values: { verdict: 'changes' },
};

const LEGACY_Q = { id: 'q1', question: 'Which db?', options: ['pg', 'sqlite'] };
const LEGACY_A = { id: 'q1', question: 'Which db?', choice: 'pg' };

/** The smallest dep bundle get_run_progress needs: the row lookup resolveRow takes,
 *  the progress reader, redaction, the limits table the factory reads at build time,
 *  and the injected projection. */
function tools(progress, over = {}) {
  return createAskTools({
    limits: ASK_LIMITS,
    findPipelineRowById: (id) => (id === 'r1' ? { id: 'r1' } : null),
    readRunProgress: async () => progress,
    redact: (s) => String(s).replace(/sk-secret/g, '[redacted]'),
    askProgress,
    ...over,
  });
}

const progressWith = (over) => ({
  runId: 'r1', phase: null, status: 'running', phases: [], tasks: [], reviews: [],
  clarify: { questions: [], answers: [], ask: null },
  stepQuestions: [],
  ...over,
});

test('get_run_progress: a form clarify round surfaces the projection and the values', async () => {
  const out = await tools(progressWith({ clarify: { questions: [], answers: [], ask: ASK } }))
    .call('get_run_progress', { runId: 'r1' });
  assert.deepEqual(out.clarify.questions, [], 'X3: the legacy arrays stay empty');
  assert.deepEqual(out.clarify.answers, []);
  assert.match(out.clarify.form.projection, /^Review mockups$/m, 'a persisted row has no agent half; agentKey sits beside the row');
  assert.match(out.clarify.form.projection, /Two directions\./);
  assert.match(out.clarify.form.projection, /1\. Verdict \{verdict\}/);
  assert.equal(out.clarify.form.projection.includes('/answer'), false, 'no ref, no reply line');
  assert.equal(out.clarify.form.values, 'Verdict: changes');
});

test('get_run_progress: a form step round surfaces it too, per round', async () => {
  const out = await tools(progressWith({ stepQuestions: [
    { stepKey: 'x:n1:1', round: 1, nodeId: 'n1', agentKey: 'a', questions: [], answers: [], ask: ASK },
  ] })).call('get_run_progress', { runId: 'r1' });
  const [sq] = out.stepQuestions;
  assert.deepEqual([sq.stepKey, sq.round, sq.nodeId, sq.agentKey], ['x:n1:1', 1, 'n1', 'a']);
  assert.match(sq.form.projection, /Review mockups/);
  assert.equal(sq.form.values, 'Verdict: changes');
});

test('get_run_progress: an UNANSWERED form round has an empty values line, not "undefined"', async () => {
  const out = await tools(progressWith({ clarify: { questions: [], answers: [], ask: { ...ASK, values: null } } }))
    .call('get_run_progress', { runId: 'r1' });
  assert.match(out.clarify.form.projection, /Review mockups/);
  assert.equal(out.clarify.form.values, '');
});

test('REGRESSION: a legacy round is byte-identical to today and reports form: null', async () => {
  const out = await tools(progressWith({
    clarify: { questions: [LEGACY_Q], answers: [LEGACY_A], ask: null },
    stepQuestions: [{ stepKey: 'x:n1:1', round: 1, nodeId: 'n1', agentKey: 'a',
      questions: [LEGACY_Q], answers: [LEGACY_A], ask: null }],
  })).call('get_run_progress', { runId: 'r1' });
  assert.deepEqual(out.clarify.questions, [JSON.stringify(LEGACY_Q)]);
  assert.deepEqual(out.clarify.answers, [JSON.stringify(LEGACY_A)]);
  assert.equal(out.clarify.form, null);
  assert.equal(out.stepQuestions[0].form, null);
  assert.deepEqual(out.stepQuestions[0].questions, [JSON.stringify(LEGACY_Q)]);
  // A legacy row on the readers has NO `ask` key at all (artifacts.mjs formFieldsOf) —
  // the same null, so an older fake bundle is unaffected.
  const bare = await tools(progressWith({ clarify: { questions: [LEGACY_Q], answers: [LEGACY_A] } }))
    .call('get_run_progress', { runId: 'r1' });
  assert.equal(bare.clarify.form, null);
});

test('the form projection is redacted and capped like every other free-text field', async () => {
  // The secret sits in the FIRST display block and a 9000-char filler in the second:
  // projectForm drops display text from the END, so the cap eats the filler and the
  // redacted secret must still be there — a secret inside the clipped block would
  // simply vanish, which proves nothing about redaction.
  const leaky = { ...ASK,
    layout: [{ widget: 'markdown', bind: 'data.summary' }, { widget: 'markdown', bind: 'data.filler' },
      { widget: 'select', field: 'verdict', label: 'Verdict' }],
    data: { summary: 'token sk-secret here', filler: 'y'.repeat(9000), images: [] },
    values: { verdict: 'sk-secret' },
  };
  const out = await tools(progressWith({ clarify: { questions: [], answers: [], ask: leaky } }))
    .call('get_run_progress', { runId: 'r1' });
  assert.match(out.clarify.form.projection, /token \[redacted\] here/);
  assert.equal(out.clarify.form.projection.includes('sk-secret'), false);
  assert.ok(out.clarify.form.projection.length <= PROMPT_PROJECTION_MAX, `${out.clarify.form.projection.length} chars`);
  assert.equal((out.clarify.form.projection.match(/^…$/gm) || []).length, 1, 'exactly one … marker (X9)');
  assert.equal(out.clarify.form.values, 'Verdict: [redacted]', 'the values line is redacted too');
});

test('the REAL reader bundle injects askProgress, and a bundle without it degrades to form: null', async () => {
  assert.equal(typeof defaultToolDeps({ threadId: null }).askProgress, 'function',
    'tool-deps.mjs must carry the projection or every real read reports null');
  const out = await tools(progressWith({ clarify: { questions: [], answers: [], ask: ASK } }), { askProgress: undefined })
    .call('get_run_progress', { runId: 'r1' });
  assert.equal(out.clarify.form, null);
});

test('get_run_progress: the tool description names the form text', () => {
  const def = tools(progressWith({})).list().find((d) => d.name === 'get_run_progress');
  assert.match(def.description, /form ask as text plus its answered values/);
});
