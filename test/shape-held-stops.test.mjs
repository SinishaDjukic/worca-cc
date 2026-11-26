// test/shape-held-stops.test.mjs — Shaper small runs C3 (D9): a stop's answer is held while another slice of the feature
// is going and delivered once none is; a refusal changes nothing. Real DB (useTempHome); runs-map entries are stand-ins.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { createSliceFeature, liveSliceFrom, busySliceOf } from '../src/core/shape/features.mjs';
import { createHeldStops } from '../src/core/shape/chain.mjs';
import { answeredRefusal, gateStop, heldRefusal, planStop } from '../src/shared/shape/run-stops.mjs';

useTempHome(after, 'worca-held-stops-');
const root = mkdtempSync(join(tmpdir(), 'worca-held-stops-proj-'));
after(() => rmSync(root, { recursive: true, force: true }));
before(() => { getDb(); });

let seq = 0;
const pipe = (status) => {
  const id = `h${String(++seq).padStart(7, '0')}`;
  seedPipelineRow({ id, projectKey: projectKey(root), status, title: id, branch: { source: 'main', feature: `feat/${id}` } });
  return id;
};
const setPipe = (id, status) => getDb().prepare('UPDATE pipelines SET status = ? WHERE id = ?').run(status, id);
const slice = (n) => ({ id: `s${n}`, title: `Slice ${n}`, goal: '', inScope: [], outOfScope: [], acceptance: [], dependsOn: [], estimate: 'M' });
const STOP = gateStop({ run: 2, issues: [{ severity: 'major', title: 'x' }], fixCycles: 3 });

/** A 3-run feature: run 1 done, run 2 live on a stop question, run 3 live and building unless `three` is false. */
function setup({ three = true, applyChange = undefined } = {}) {
  const f = createSliceFeature({ pipelineId: pipe('done'), projectDir: root, title: 'T', outline: { why: '', slices: [1, 2, 3].map(slice) },
    perspectives: ['product'], workflowId: 'wf_shape' });
  const tix = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? ORDER BY idx').all(f.id).map((r) => r.ticket_id);
  const runs = new Map();
  const answers = [];
  const resolved = [];
  const repaints = [];
  const entry = (index, status) => {
    const pid = pipe('running');
    getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(pid, tix[index - 1]);
    const e = { id: `r${index}`, pipelineId: pid, status, pendingQuestion: null, heldStop: null,
      orch: { runShape: { slice: { feature: f.id, index } }, answer: (id, payload, by) => answers.push({ run: index, id, payload, by }) } };
    runs.set(e.id, e);
    return e;
  };
  const e2 = entry(2, 'running');
  e2.pendingQuestion = { id: 'gate-w9-3', kind: 'gate', stop: STOP };
  const e3 = three ? entry(3, 'running') : null;
  const liveSliceOf = (pid) => {
    const e = [...runs.values()].find((x) => x.pipelineId === pid);
    return e && e.status === 'running' ? liveSliceFrom({ runId: e.id, status: e.status, pendingQuestion: e.pendingQuestion, approved: true, heldStop: e.heldStop }) : null;
  };
  const resolvePending = (e, { id, reason }) => {
    if (!e.pendingQuestion || e.pendingQuestion.id !== id) return false;
    e.pendingQuestion = null; resolved.push({ id, reason }); return true;
  };
  const held = createHeldStops({ runs, liveSliceOf, broadcastFeature: (id) => repaints.push(id), resolvePending, now: Date.now, ...(applyChange ? { applyChange } : {}) });
  const finish = (e) => { e.status = 'done'; setPipe(e.pipelineId, 'done'); };
  return { f, e2, e3, held, answers, resolved, repaints, finish, liveSliceOf };
}

test('held while run 3 is going: deliver answers 0 times; after it finishes, once, and pendingQuestion is resolved', () => {
  const { f, e2, e3, held, answers, resolved, finish, liveSliceOf } = setup();
  assert.deepEqual(held.answer(e2, 'gate-w9-3', { decision: 'another' }, 'ann'), { held: true });
  assert.deepEqual(e2.heldStop, { id: 'gate-w9-3', payload: { decision: 'another' }, by: 'ann', after: 3 });
  assert.equal(e2.pendingQuestion.id, 'gate-w9-3', 'the question stays open while held');
  assert.deepEqual(busySliceOf(f.id, { exclude: 3, live: liveSliceOf }), { index: 2 }, 'a held answer counts as going');
  held.deliver();
  assert.equal(answers.length, 0);
  finish(e3);
  held.deliver();
  assert.deepEqual(answers, [{ run: 2, id: 'gate-w9-3', payload: { decision: 'another' }, by: 'ann' }]);
  assert.equal(e2.heldStop, null);
  assert.equal(e2.pendingQuestion, null, 'deliver clears pendingQuestion');
  assert.deepEqual(resolved, [{ id: 'gate-w9-3', reason: 'answered' }], 'question-resolved once');
  assert.deepEqual(busySliceOf(f.id, { live: liveSliceOf }), { index: 2 }, 'the delivered run is going');
  held.deliver();
  assert.equal(answers.length, 1, 'delivered once');
});

test('no other slice going: the answer goes to the run now (the caller resolves the question)', () => {
  const { e2, held, answers } = setup({ three: false });
  assert.equal(held.answer(e2, 'gate-w9-3', { decision: 'continue' }, 'ann'), undefined);
  assert.equal(answers.length, 1);
  assert.equal(e2.heldStop, null);
});

test('a foreign payload is refused on both paths (422), nothing held or answered', () => {
  for (const three of [true, false]) {
    const { e2, held, answers } = setup({ three });
    assert.throws(() => held.answer(e2, 'gate-w9-3', { decision: 'stop' }, 'ann'),
      (err) => err.code === 'INVALID_ANSWER' && err.errors[0].field === 'decision' && /not one of this stop's options/.test(err.errors[0].message));
    assert.equal(e2.heldStop, null);
    assert.equal(answers.length, 0);
    assert.equal(e2.pendingQuestion.id, 'gate-w9-3');
  }
});

test('a second answer while one is held is refused (409) and changes nothing', () => {
  const { e2, held, answers } = setup();
  held.answer(e2, 'gate-w9-3', { decision: 'another' }, 'ann');
  const before = { ...e2.heldStop };
  assert.throws(() => held.answer(e2, 'gate-w9-3', { decision: 'continue' }, 'bo'),
    (err) => err.code === 'STOP_HELD' && err.status === 409 && err.message === heldRefusal(3));
  assert.deepEqual(e2.heldStop, before);
  assert.equal(answers.length, 0);
});

test('clear drops a held answer; deliver re-checks the question id', () => {
  const a = setup();
  a.held.answer(a.e2, 'gate-w9-3', { decision: 'another' }, 'ann');
  a.held.clear(a.e2);
  assert.equal(a.e2.heldStop, null);
  a.finish(a.e3);
  a.held.deliver();
  assert.equal(a.answers.length, 0);
  const b = setup();
  b.held.answer(b.e2, 'gate-w9-3', { decision: 'another' }, 'ann');
  b.e2.pendingQuestion = { ...b.e2.pendingQuestion, id: 'gate-w9-4' };   // the question moved on (paused and re-asked)
  b.finish(b.e3);
  b.held.deliver();
  assert.equal(b.answers.length, 0);
  assert.equal(b.e2.heldStop, null);
});

test('a question without stop goes straight to the run', () => {
  const { e2, held, answers } = setup();
  e2.pendingQuestion = { id: 'q1', kind: 'questions' };
  assert.equal(held.answer(e2, 'q1', { answers: [] }, 'ann'), undefined);
  assert.equal(answers.length, 1);
});

test('a held answer the run refuses at delivery is dropped and the feature repaints', () => {
  const { f, e2, e3, held, repaints, finish } = setup();
  held.answer(e2, 'gate-w9-3', { decision: 'another' }, 'ann');
  e2.orch.answer = () => { throw new Error('refused'); };
  finish(e3);
  const before = repaints.length;
  const err = console.error; console.error = () => {};
  try { held.deliver(); } finally { console.error = err; }
  assert.equal(e2.heldStop, null);
  assert.deepEqual(repaints.slice(before), [f.id]);
});

// Small runs C4 (D11): Change it with a proposal changes the requirement first, then the re-plan takes its turn.
const REQ_STOP = planStop({ run: 2, concern: { title: 'too strict', kind: 'requirement', requirements: ['R-po-1'],
  proposals: [{ id: 'R-po-1', from: 'members only', text: 'members and guests' }] } });
const CHANGE = REQ_STOP.options.find((o) => o.value === 'change').payload;
const KEEP = REQ_STOP.options.find((o) => o.value === 'keep').payload;

test('C4: Change it calls applyChange once, before the turn is read; the re-plan is then held for run 3', () => {
  const calls = [];
  const { e2, held, answers } = setup({ applyChange: (e, stop, by) => { calls.push([e.id, stop.change, by, !!e.heldStop]); return { changeRun: null }; } });
  e2.pendingQuestion = { id: 'plan-n_refine-2', kind: 'plan', stop: REQ_STOP };
  assert.deepEqual(held.answer(e2, 'plan-n_refine-2', { ...CHANGE }, 'ann'), { held: true });
  assert.deepEqual(calls, [['r2', REQ_STOP.change, 'ann', false]]);
  assert.deepEqual(answers, []);
  assert.deepEqual(e2.heldStop.payload, CHANGE);
});

test('C4: a non-owner asker is told which run builds the change', () => {
  const { e2, held, answers } = setup({ three: false, applyChange: () => ({ changeRun: 9 }) });
  e2.pendingQuestion = { id: 'plan-n_refine-2', kind: 'plan', stop: REQ_STOP };
  assert.equal(held.answer(e2, 'plan-n_refine-2', { ...CHANGE }, 'ann'), undefined);
  assert.equal(answers.length, 1);
  assert.match(answers[0].payload.feedback, /Run 9 builds this change/);
  assert.equal(answers[0].payload.source, 'requirement');
});

test('C4: a refused change rethrows code and status, holds nothing and answers nothing; Keep never calls it', () => {
  let n = 0;
  const { e2, held, answers } = setup({ applyChange: () => { n += 1; throw Object.assign(new Error('R-po-1 changed since: read it again'), { code: 'STALE', status: 409 }); } });
  e2.pendingQuestion = { id: 'plan-n_refine-2', kind: 'plan', stop: REQ_STOP };
  assert.throws(() => held.answer(e2, 'plan-n_refine-2', { ...CHANGE }, 'ann'), (e) => e.code === 'STALE' && e.status === 409);
  assert.equal(e2.heldStop, null);
  assert.deepEqual(answers, []);
  assert.equal(e2.pendingQuestion.id, 'plan-n_refine-2');
  held.answer(e2, 'plan-n_refine-2', { ...KEEP }, 'ann');
  assert.equal(n, 1, 'Keep it never applies a change');
});

test('C5: answering a Verifier-run stop (no slice, no other run going) delivers at once', async () => {
  const { verifyStop } = await import('../src/shared/shape/verifier.mjs');
  const runs = new Map();
  const answers = [];
  const stop = verifyStop({ gaps: [{ id: 'R-po-2', why: 'x' }], round: 3, fixCycles: 2 });
  const e = { id: 'rv', pipelineId: pipe('running'), status: 'running', heldStop: null,
    pendingQuestion: { id: 'verify-3-x', kind: 'gate', stop },
    orch: { runShape: { verify: { featureId: 'feat_x', round: 3 } }, answer: (id, payload, by) => answers.push({ id, payload, by }) } };
  runs.set(e.id, e);
  const held = createHeldStops({ runs, liveSliceOf: () => null, broadcastFeature: () => {}, resolvePending: () => true, now: Date.now });
  assert.equal(held.answer(e, 'verify-3-x', { decision: 'another' }, 'ann'), undefined);
  assert.deepEqual(answers, [{ id: 'verify-3-x', payload: { decision: 'another' }, by: 'ann' }]);
  assert.equal(e.heldStop, null);
  assert.throws(() => held.answer(e, 'verify-3-x', { decision: 'revise' }, 'ann'), (err) => err.code === 'INVALID_ANSWER');
});

// One stop, one answer: once a stop is handed to the run (due or delivered), a later answer with its id is refused.
test('a stop answered due, then answered again once its question is gone, is refused STOP_ANSWERED (409)', () => {
  const { e2, held, answers } = setup({ three: false });
  assert.equal(held.answer(e2, 'gate-w9-3', { decision: 'continue' }, 'ann'), undefined);
  e2.pendingQuestion = null;   // the caller resolved it
  assert.throws(() => held.answer(e2, 'gate-w9-3', { decision: 'another' }, 'bo'),
    (err) => err.code === 'STOP_ANSWERED' && err.status === 409 && err.message === answeredRefusal());
  assert.equal(answers.length, 1, 'the run took the stop once');
});

test('a stop held, then delivered, then answered again is refused STOP_ANSWERED', () => {
  const { e2, e3, held, answers, finish } = setup();
  held.answer(e2, 'gate-w9-3', { decision: 'another' }, 'ann');
  finish(e3);
  held.deliver();
  assert.equal(answers.length, 1);
  assert.throws(() => held.answer(e2, 'gate-w9-3', { decision: 'continue' }, 'bo'), (err) => err.code === 'STOP_ANSWERED' && err.status === 409);
  assert.equal(answers.length, 1);
});

test('a stale answer to a non-stop question still goes to the run and does not throw', () => {
  const { e2, held, answers } = setup({ three: false });
  held.answer(e2, 'gate-w9-3', { decision: 'continue' }, 'ann');
  e2.pendingQuestion = null;
  assert.equal(held.answer(e2, 'q-old', { answers: [] }, 'ann'), undefined);
  assert.equal(answers.length, 2);
});

test('a refused answer (422 or STOP_HELD) adds no id: a later valid answer is taken', () => {
  const a = setup({ three: false });
  assert.throws(() => a.held.answer(a.e2, 'gate-w9-3', { decision: 'stop' }, 'ann'), (err) => err.code === 'INVALID_ANSWER');
  assert.equal(a.held.answer(a.e2, 'gate-w9-3', { decision: 'continue' }, 'ann'), undefined);
  assert.equal(a.answers.length, 1);
  const b = setup();
  b.held.answer(b.e2, 'gate-w9-3', { decision: 'another' }, 'ann');
  assert.throws(() => b.held.answer(b.e2, 'gate-w9-3', { decision: 'continue' }, 'bo'), (err) => err.code === 'STOP_HELD');
  b.held.clear(b.e2);   // the held answer is dropped (the run was paused)
  b.finish(b.e3);
  assert.equal(b.held.answer(b.e2, 'gate-w9-3', { decision: 'continue' }, 'bo'), undefined);
  assert.equal(b.answers.length, 1);
});
