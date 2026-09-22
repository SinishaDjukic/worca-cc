// test/run-harness-ask-form.test.mjs
// The `kind:'form'` ask on the EXISTING 'question' frame (spec §4: "No new
// transport, no new slot"), auto mode's D10 answer, and gate 3 in answer().
// Driven directly against RunHarness's own methods — no run, no spawn, no DB.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { RunHarness, normalizeClarifyAnswer } from '../src/core/run-harness.mjs';

useTempHome(after);   // the constructor touches settings/store readers

/** A harness with just enough state for _ask: no pipeline, no steps, no clocks. */
function harness({ auto = false } = {}) {
  const h = Object.create(RunHarness.prototype);
  h.auto = auto;
  h.pendingQuestion = null;
  h.state = { status: 'running', steps: [], totalActiveMs: 0 };
  h._metricsIv = { questions: 0 };
  h.emitted = [];
  h._emit = (name, payload) => h.emitted.push({ name, payload });
  h._log = () => {};
  h._checkAbort = () => {};
  h._checkPause = () => {};
  h._runningStepKeys = () => [];
  h._persist = async () => {};
  h.getState = () => ({});
  return h;
}

const ASK = {
  id: 'questions-x:n1:1-r1', kind: 'form', agent: 'Mock Reviewer', nodeId: 'n1', executionId: 'x:n1:1',
  askId: 'questions-x_n1_1-r1', form: 'review-mockups', version: 2, title: 'Review mockups', surface: 'any',
  data: { summary: 'Two directions.' },
  layout: [{ widget: 'select', field: 'verdict' }],
  answerSchema: { type: 'object', required: ['verdict'], properties: { verdict: { type: 'string', enum: ['approve', 'changes'] } } },
  fileRefs: [{ path: 'data.images[0].file', rel: 'mockups/a.png' }],
  files: [{ index: 0, rel: 'mockups/a.png', name: 'a.png', mime: 'image/png', bytes: 12, sha256: 'a'.repeat(64) }],
};

/** A gate-3 validator with formAnswerValidator's RESULT-OBJECT contract. */
const validator = (payload) => (payload?.values?.verdict === 'approve' || payload?.values?.verdict === 'changes'
  ? { ok: true, payload: { form: ASK.form, version: ASK.version, values: { verdict: payload.values.verdict } } }
  : { ok: false, errors: [{ path: 'verdict', code: 'enum', message: 'verdict must be approve or changes' }] });

test('the question frame carries the whole envelope — and NEITHER validate NOR autoValues', async () => {
  const h = harness();
  const p = h._ask({ ...ASK, autoValues: { verdict: 'approve' }, validate: validator });
  const ev = h.emitted.find((e) => e.name === 'question').payload;
  assert.equal(ev.kind, 'form');
  for (const k of ['id', 'agent', 'nodeId', 'executionId', 'askId', 'form', 'version', 'title', 'surface', 'data', 'layout', 'answerSchema', 'fileRefs', 'files']) {
    assert.ok(k in ev, `the envelope is missing ${k}`);
  }
  assert.equal(ev.id, 'questions-x:n1:1-r1');
  assert.equal(ev.askId, 'questions-x_n1_1-r1');
  assert.notEqual(ev.id, ev.askId, 'ruling X1: two distinct fields — the answer token and the route token');
  assert.equal(ev.surface, 'any');
  assert.deepEqual(ev.fileRefs, ASK.fileRefs);
  assert.deepEqual(ev.files, ASK.files);
  assert.equal('validate' in ev, false);
  assert.equal('autoValues' in ev, false, 'E3: an argument, never a wire field');
  assert.equal(h.pendingQuestion.id, ASK.id);
  h.answer(ASK.id, { values: { verdict: 'approve' } });
  assert.deepEqual(await p, { form: 'review-mockups', version: 2, values: { verdict: 'approve' } });
});

test('a LEGACY question frame is unchanged: no form keys leak into it', async () => {
  const h = harness();
  h._ask({ id: 'q-1', kind: 'questions', questions: [{ id: 'a', question: 'Q?', options: ['x'] }], agent: 'A' });
  const ev = h.emitted.find((e) => e.name === 'question').payload;
  for (const k of ['askId', 'form', 'version', 'title', 'surface', 'data', 'layout', 'answerSchema', 'fileRefs', 'files']) {
    assert.equal(k in ev, false, `${k} must not appear on a legacy frame`);
  }
  h.answer('q-1', { answers: [] });
});

test('AUTO mode answers a form with the D10 auto answer — no hang, no pending question', async () => {
  const h = harness({ auto: true });
  const answer = await h._ask({ ...ASK, autoValues: { verdict: 'approve' }, validate: validator });
  assert.deepEqual(answer, { form: 'review-mockups', version: 2, values: { verdict: 'approve' } });
  assert.equal(h.pendingQuestion, null, 'auto never installs a pending question');
  const none = await h._ask({ ...ASK, validate: validator });
  assert.deepEqual(none, { form: 'review-mockups', version: 2, values: {} }, 'a missing autoValues degrades to {}, never to a hang');
});

test('gate 3: a REJECTED answer throws INVALID_ANSWER with the errors and keeps the question OPEN', async () => {
  const h = harness();
  const p = h._ask({ ...ASK, validate: validator });
  p.catch(() => {});
  assert.throws(() => h.answer(ASK.id, { values: { verdict: 'maybe' } }), (err) => {
    assert.equal(err.message, 'invalid answer');
    assert.equal(err.code, 'INVALID_ANSWER');
    assert.deepEqual(err.errors, [{ path: 'verdict', code: 'enum', message: 'verdict must be approve or changes' }]);
    return true;
  });
  assert.equal(h.pendingQuestion.id, ASK.id, 'the question stays open (spec §5 gate 3)');
  h.answer(ASK.id, { values: { verdict: 'changes' } });
  assert.deepEqual(await p, { form: 'review-mockups', version: 2, values: { verdict: 'changes' } });
});

test('REGRESSION: a clean|null validator (the Auto proposal) keeps its silent-false contract', async () => {
  const h = harness();
  const legacy = (payload) => (payload && payload.decision === 'accept' ? { decision: 'accept' } : null);
  const p = h._ask({ id: 'auto-1', kind: 'workflow', workflow: { round: 1 }, validate: legacy });
  assert.equal(h.answer('auto-1', { decision: 'garbage' }), false, 'no throw, no resolve — exactly today');
  assert.equal(h.pendingQuestion.id, 'auto-1');
  assert.equal(h.answer('auto-1', { decision: 'accept' }), true);
  assert.deepEqual(await p, { decision: 'accept' });
  assert.equal(h.answer('nope', {}), false, 'an unknown id is still a silent false');
});

test('normalizeClarifyAnswer NEVER touches a form answer (spec §5)', () => {
  const questions = [{ id: 'q1', question: 'Pick?', options: ['A', 'B'] }];
  assert.deepEqual(normalizeClarifyAnswer({ form: 'f', version: 1, values: { verdict: 'approve' } }, questions), [],
    'the "fill with the first option" fallback is legacy-kind only');
  assert.deepEqual(normalizeClarifyAnswer({ answers: [] }, questions), [{ id: 'q1', choice: 'A' }],
    'the legacy fallback is unchanged');
});
