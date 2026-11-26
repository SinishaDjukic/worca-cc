// test/shape-held-stops.test.mjs — Shaper small runs C3 (D9): a stop's answer is held while another slice of the feature
// is going and delivered once none is; a refusal changes nothing. Real DB (useTempHome); runs-map entries are stand-ins.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { withEnv } from './helpers/with-env.mjs';
import * as features from '../src/core/shape/features.mjs';
import { createSliceFeature, liveSliceFrom, busySliceOf, sliceWords, featureView } from '../src/core/shape/features.mjs';
import { featureStateLine } from '../ui/public/shape/feature-card.mjs';
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

/** A feature of `slices` runs: run 1 done, run 2 live on a stop question, run 3 live and building unless `three` is false. */
function setup({ three = true, slices = 3, applyChange = undefined, takeIn = undefined } = {}) {
  const f = createSliceFeature({ pipelineId: pipe('done'), projectDir: root, title: 'T', outline: { why: '', slices: Array.from({ length: slices }, (_, i) => slice(i + 1)) },
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
    return e && e.status === 'running' ? liveSliceFrom({ runId: e.id, status: e.status, pendingQuestion: e.pendingQuestion, approved: true, heldStop: e.heldStop, going: !!e.takingIn }) : null;
  };
  const resolvePending = (e, { id, reason }) => {
    if (!e.pendingQuestion || e.pendingQuestion.id !== id) return false;
    e.pendingQuestion = null; resolved.push({ id, reason }); return true;
  };
  const held = createHeldStops({ runs, liveSliceOf, broadcastFeature: (id) => repaints.push(id), resolvePending, now: Date.now,
    ...(applyChange ? { applyChange } : {}), ...(takeIn ? { takeIn } : {}) });
  const finish = (e) => { e.status = 'done'; setPipe(e.pipelineId, 'done'); };
  return { f, e2, e3, runs, held, answers, resolved, repaints, finish, liveSliceOf, entry };
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

// ── Slice 3: the run takes in finished same-base work before an answer goes on (the `takeIn` dep) ───────────────────
const SMALL_ON = { WORCA_FLAGS: 'shaperSmallRuns' };
const SENDING = 'this stop is already answered: its answer is being sent';
const MERGED = { ok: true, merged: [] };
const WAIT = { ok: false, wait: true, after: 3 };
const REFUSED = { ok: false, refused: true, reason: 'runs 2 and 3 clash in src/a.mjs' };
const markFeature = (fid) => getDb()
  .prepare('UPDATE pipelines SET shape_stats = ? WHERE id = (SELECT origin_pipeline_id FROM shape_features WHERE id = ?)')
  .run(JSON.stringify({ smallRuns: true }), fid);
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const ticks = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
/** A marked feature's setup whose `takeIn` records each entry it is asked for and answers `reply(entry, nth, world)`. */
function takeSetup({ three = false, slices = 3, reply = () => MERGED, mark = true, applyChange = undefined } = {}) {
  const taken = [];
  let w = null;
  w = setup({ three, slices, applyChange, takeIn: async (e) => { taken.push(e.id); return reply(e, taken.length, w); } });
  if (mark) markFeature(w.f.id);
  return { ...w, taken };
}
/** Run 2's answer held behind run 3, then run 3 done and settled: the next delivery is due. */
async function heldThenDue(w) {
  assert.deepEqual(await w.held.answer(w.e2, 'gate-w9-3', { decision: 'another' }, 'ann'), { held: true });
  w.finish(w.e3);
  w.e3.settled = true;
}
const quietly = async (fn) => {
  const err = console.error; const errors = [];
  console.error = (...a) => { errors.push(a.join(' ')); };
  try { await fn(); } finally { console.error = err; }
  return errors;
};

test('take-in: a sibling still committing (done, not settled) holds a direct answer; it goes out once the sibling settles', () => withEnv(SMALL_ON, async () => {
  const w = takeSetup({ three: true });
  w.finish(w.e3);                                   // done, not settled
  assert.deepEqual(await w.held.answer(w.e2, 'gate-w9-3', { decision: 'another' }, 'ann'), { held: true });
  assert.equal(w.e2.heldStop.after, 3);
  assert.deepEqual([w.taken, w.answers], [[], []]);
  await w.held.deliver();
  assert.equal(w.e2.heldStop?.after, 3, 'delivery waits too');
  assert.deepEqual([w.taken, w.answers], [[], []]);
  w.e3.settled = true;
  await w.held.deliver();
  assert.deepEqual(w.taken, ['r2']);
  assert.equal(w.answers.length, 1);
  assert.equal(w.e2.heldStop, null);
}));

test('take-in: a settling run on another base does not hold the answer', () => withEnv(SMALL_ON, async () => {
  const w = takeSetup({ three: true });
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?')
    .run(JSON.stringify({ source: 'feat/other', feature: `feat/${w.e3.pipelineId}` }), w.e3.pipelineId);
  w.finish(w.e3);                                   // done, not settled
  assert.equal(await w.held.answer(w.e2, 'gate-w9-3', { decision: 'continue' }, 'ann'), undefined);
  assert.deepEqual(w.taken, ['r2']);
  assert.equal(w.answers.length, 1);
}));

test('take-in: `wait` holds the answer behind the run it names; nothing is answered', () => withEnv(SMALL_ON, async () => {
  const w = takeSetup({ reply: () => WAIT });
  assert.deepEqual(await w.held.answer(w.e2, 'gate-w9-3', { decision: 'another' }, 'ann'), { held: true });
  assert.deepEqual(w.e2.heldStop, { id: 'gate-w9-3', payload: { decision: 'another' }, by: 'ann', after: 3 });
  assert.deepEqual(w.answers, []);
  assert.ok(w.repaints.includes(w.f.id));
  assert.ok(!w.e2.takingIn, 'no longer taking in');
}));

test('take-in: a refusal throws 409 TAKE_IN_REFUSED with the reason, holds nothing and leaves the stop answerable', () => withEnv(SMALL_ON, async () => {
  const w = takeSetup({ reply: (_e, nth) => (nth === 1 ? REFUSED : MERGED) });
  await assert.rejects(async () => w.held.answer(w.e2, 'gate-w9-3', { decision: 'another' }, 'ann'),
    (err) => err.code === 'TAKE_IN_REFUSED' && err.status === 409 && err.message === REFUSED.reason);
  assert.equal(w.e2.heldStop, null);
  assert.deepEqual(w.answers, []);
  assert.equal(w.e2.pendingQuestion.id, 'gate-w9-3');
  assert.ok(!w.e2.takingIn);
  assert.equal(await w.held.answer(w.e2, 'gate-w9-3', { decision: 'another' }, 'ann'), undefined, 'the id was not taken');
  assert.equal(w.answers.length, 1);
}));

test('take-in (D13): another run turning busy during the take-in holds the answer behind it', () => withEnv(SMALL_ON, async () => {
  const w = takeSetup({ reply: (_e, _nth, world) => { world.entry(3, 'running'); return MERGED; } });
  assert.deepEqual(await w.held.answer(w.e2, 'gate-w9-3', { decision: 'another' }, 'ann'), { held: true });
  assert.equal(w.e2.heldStop.after, 3);
  assert.deepEqual(w.answers, []);
}));

test('take-in (D13): a delivery whose run is no longer due after the take-in stays held', () => withEnv(SMALL_ON, async () => {
  const w = takeSetup({ three: true, reply: (_e, _nth, world) => {
    world.e3.status = 'running';
    getDb().prepare("UPDATE pipelines SET status = 'running' WHERE id = ?").run(world.e3.pipelineId);
    return MERGED;
  } });
  await heldThenDue(w);
  await w.held.deliver();
  assert.deepEqual(w.taken, ['r2']);
  assert.deepEqual(w.answers, []);
  assert.equal(w.e2.heldStop?.after, 3);
  assert.deepEqual(w.resolved, []);
}));

test('take-in: while it runs the entry is marked, and a second answer is refused 409 STOP_HELD "being sent"', () => withEnv(SMALL_ON, async () => {
  const gate = deferred();
  const w = takeSetup({ reply: () => gate.promise });
  const first = w.held.answer(w.e2, 'gate-w9-3', { decision: 'another' }, 'ann');
  try {
    await assert.rejects(async () => w.held.answer(w.e2, 'gate-w9-3', { decision: 'continue' }, 'bo'),
      (err) => err.code === 'STOP_HELD' && err.status === 409 && err.message === SENDING);
    assert.equal(w.e2.takingIn, 'gate-w9-3');
    assert.deepEqual(busySliceOf(w.f.id, { live: w.liveSliceOf }), { index: 2 }, 'a run taking in work is going');
  } finally { gate.resolve(MERGED); }
  assert.equal(await first, undefined);
  assert.ok(!w.e2.takingIn);
  assert.deepEqual(w.answers.map((a) => a.by), ['ann']);
}));

test('take-in: a question replaced during the take-in refuses 409 STALE and answers nothing', () => withEnv(SMALL_ON, async () => {
  const w = takeSetup({ reply: (e) => { e.pendingQuestion = { ...e.pendingQuestion, id: 'gate-w9-4' }; return MERGED; } });
  await assert.rejects(async () => w.held.answer(w.e2, 'gate-w9-3', { decision: 'another' }, 'ann'),
    (err) => err.code === 'STALE' && err.status === 409);
  assert.deepEqual(w.answers, []);
  assert.equal(w.e2.heldStop, null);
}));

test('take-in (D14): "Change it" takes nothing in; "Keep it" on the same stop does', () => withEnv(SMALL_ON, async () => {
  const change = takeSetup({ applyChange: () => ({ changeRun: null }) });
  change.e2.pendingQuestion = { id: 'plan-n_refine-2', kind: 'plan', stop: REQ_STOP };
  await change.held.answer(change.e2, 'plan-n_refine-2', { ...CHANGE }, 'ann');
  assert.deepEqual(change.taken, []);
  assert.equal(change.answers.length, 1);
  const keep = takeSetup({ applyChange: () => ({ changeRun: null }) });
  keep.e2.pendingQuestion = { id: 'plan-n_refine-2', kind: 'plan', stop: REQ_STOP };
  await keep.held.answer(keep.e2, 'plan-n_refine-2', { ...KEEP }, 'ann');
  assert.deepEqual(keep.taken, ['r2']);
  assert.equal(keep.answers.length, 1);
}));

test('take-in (R-arch-11): only a marked feature\'s stop with the flag on takes in; every other answer stays synchronous', async () => {
  for (const [why, env, mark] of [['flag off', { WORCA_FLAGS: undefined }, true], ['unmarked', SMALL_ON, false]]) {
    await withEnv(env, async () => {
      const w = takeSetup({ mark });
      assert.equal(w.held.answer(w.e2, 'gate-w9-3', { decision: 'continue' }, 'ann'), undefined, why);
      assert.deepEqual([w.taken.length, w.answers.length], [0, 1], why);
    });
  }
  await withEnv(SMALL_ON, async () => {
    const plain = takeSetup();
    plain.e2.pendingQuestion = { id: 'q1', kind: 'questions' };
    assert.equal(plain.held.answer(plain.e2, 'q1', { answers: [] }, 'ann'), undefined, 'a non-stop question');
    assert.deepEqual(plain.taken, []);
    const marked = takeSetup();
    const out = marked.held.answer(marked.e2, 'gate-w9-3', { decision: 'continue' }, 'ann');
    assert.equal(typeof out?.then, 'function', 'a marked stop answers with a promise');
    await out;
    assert.deepEqual([marked.taken.length, marked.answers.length], [1, 1]);
  });
});

test('take-in: a delivery while one is in flight starts no second loop; the running loop runs once more', () => withEnv(SMALL_ON, async () => {
  const gate = deferred();
  const w = takeSetup({ three: true, reply: (_e, nth) => (nth === 1 ? gate.promise : MERGED) });
  await heldThenDue(w);
  const first = w.held.deliver();
  const second = w.held.deliver();
  try {
    await ticks();
    assert.deepEqual(w.taken, ['r2'], 'one take-in in flight');
    assert.deepEqual(w.answers, []);
  } finally { gate.resolve(WAIT); }
  await Promise.all([first, second]);
  await ticks();
  assert.deepEqual(w.taken, ['r2', 'r2'], 'the second call made the loop run again');
  assert.equal(w.answers.length, 1);
}));

test('take-in: a delivery whose take-in says `wait` stays held behind the named run and repaints', () => withEnv(SMALL_ON, async () => {
  const w = takeSetup({ three: true, reply: () => ({ ok: false, wait: true, after: 1 }) });
  await heldThenDue(w);
  const painted = w.repaints.length;
  await w.held.deliver();
  assert.deepEqual(w.answers, []);
  assert.equal(w.e2.heldStop?.after, 1);
  assert.ok(w.repaints.slice(painted).includes(w.f.id));
}));

test('take-in: a refused delivery drops the held answer, keeps the reason on the entry and leaves the question open', () => withEnv(SMALL_ON, async () => {
  const w = takeSetup({ three: true, reply: (_e, nth) => (nth === 1 ? REFUSED : MERGED) });
  await heldThenDue(w);
  const painted = w.repaints.length;
  await w.held.deliver();
  assert.equal(w.e2.heldStop, null);
  assert.deepEqual([w.answers, w.resolved], [[], []]);
  assert.equal(w.e2.pendingQuestion.id, 'gate-w9-3');
  assert.deepEqual(w.e2.takeInRefused, { id: 'gate-w9-3', reason: REFUSED.reason });
  assert.ok(w.repaints.slice(painted).includes(w.f.id));
  await w.held.answer(w.e2, 'gate-w9-3', { decision: 'another' }, 'ann');
  assert.equal(w.answers.length, 1);
  assert.ok(!w.e2.takeInRefused, 'the next accepted answer clears it');
}));

test('take-in: two runs with no recorded fire-time base are not the same base; a settling one does not hold the answer', () => withEnv(SMALL_ON, async () => {
  const w = takeSetup({ three: true });
  const none = getDb().prepare('UPDATE pipelines SET branch = NULL WHERE id = ?');
  none.run(w.e2.pipelineId); none.run(w.e3.pipelineId);
  w.finish(w.e3);                                   // done, not settled
  assert.equal(await w.held.answer(w.e2, 'gate-w9-3', { decision: 'continue' }, 'ann'), undefined);
  assert.equal(w.answers.length, 1);
}));

test('take-in: a new attempt clears the last refusal, so a second refusal shows one reason', () => withEnv(SMALL_ON, async () => {
  let seen = 'unset';
  const w = takeSetup({ three: true, reply: (e, nth) => { if (nth === 2) seen = e.takeInRefused; return REFUSED; } });
  await heldThenDue(w);
  await w.held.deliver();
  assert.deepEqual(w.e2.takeInRefused, { id: 'gate-w9-3', reason: REFUSED.reason });
  await assert.rejects(w.held.answer(w.e2, 'gate-w9-3', { decision: 'another' }, 'ann'), { code: 'TAKE_IN_REFUSED' });
  assert.equal(seen, null, 'cleared before the second take-in ran');
}));

test('take-in: a take-in that throws drops the held answer and logs it', () => withEnv(SMALL_ON, async () => {
  const w = takeSetup({ three: true, reply: () => { throw new Error('boom'); } });
  await heldThenDue(w);
  const errors = await quietly(() => w.held.deliver());
  assert.deepEqual(w.answers, []);
  assert.equal(w.e2.heldStop, null);
  assert.ok(errors.some((e) => /held stop answer not delivered: boom/.test(e)), errors.join(' | '));
  assert.ok(!w.e2.takingIn);
}));

// ── Slice 6: held answers go on in the order `next` names, lowest run first (one exported turnOrder) ─────────────
const FIVE = { slices: 5, three: false };
/** A live entry for run `n` waiting on an open stop question. */
function stopped(w, n) {
  const e = w.entry(n, 'running');
  e.pendingQuestion = { id: `gate-s6-${n}`, kind: 'gate', stop: STOP };
  return e;
}
const answerStop = (w, e) => w.held.answer(e, e.pendingQuestion.id, { decision: 'another' }, 'person');
const answeredRuns = (w) => w.answers.map((a) => a.run);
/** The runs that read `next` in the words every surface carries. */
const nextRuns = (w) => [...sliceWords(w.f.id, { live: w.liveSliceOf })].filter(([, s]) => s.nextTurn).map(([run]) => run);
/** Run 2 done, run 4 going, then runs 5 and 3 answered while it goes; run 5 sits in the runs map before run 3. */
function heldFiveAndThree(w) {
  w.e2.pendingQuestion = null;
  w.finish(w.e2);
  w.e2.settled = true;
  const e5 = stopped(w, 5);
  const e3 = stopped(w, 3);
  const e4 = w.entry(4, 'running');
  assert.deepEqual(answerStop(w, e5), { held: true });
  assert.deepEqual(answerStop(w, e3), { held: true });
  return { e3, e4, e5 };
}

test('turnOrder: lowest run first, a change run gets no priority; input not mutated', () => {
  const items = [{ index: 5 }, { index: 3 }, { index: 4, kind: 'change' }];
  const out = features.turnOrder(items);
  assert.deepEqual(out.map((i) => i.index), [3, 4, 5]);
  assert.notEqual(out, items, 'a new array');
  assert.deepEqual(items.map((i) => i.index), [5, 3, 4], 'the input keeps its order');
  assert.ok(out[0] === items[1] && out[1] === items[2] && out[2] === items[0], 'the same items, with their extra fields');
  assert.deepEqual(features.turnOrder([{ index: 2, tag: 'a' }, { index: 1 }, { index: 2, tag: 'b' }]).map((i) => i.tag), [undefined, 'a', 'b'], 'stable');
  assert.deepEqual(features.turnOrder([]), []);
});

// R-qa-3, R-po-6 (the held-answer part).
test('s6: held answers on runs 5 and 3 deliver 3 then 5 and the label names run 3', () => withEnv(SMALL_ON, async () => {
  const w = setup(FIVE);
  markFeature(w.f.id);
  const { e3, e4, e5 } = heldFiveAndThree(w);
  assert.deepEqual(nextRuns(w), [3], 'only run 3 reads next');
  assert.match(featureStateLine(featureView(w.f.id, { live: w.liveSliceOf })) || '', /next: run 3$/, 'the state line names run 3');
  assert.deepEqual(answeredRuns(w), []);
  w.finish(e4);
  await w.held.deliver();
  assert.deepEqual(answeredRuns(w), [3], 'run 3 goes on first');
  assert.equal(e5.heldStop?.after, 3, 'run 5 stays held behind run 3');
  w.finish(e3);
  await w.held.deliver();
  assert.deepEqual(answeredRuns(w), [3, 5]);
  assert.equal(e5.heldStop, null);
}));

// R-arch-2: the label and the delivery come from one rule.
test('s6: turn order: label and deliver pick the same run for the same rows', () => withEnv(SMALL_ON, async () => {
  const shapes = [
    { name: 'held on runs 3 and 5', first: 3, build: (w) => { const { e4 } = heldFiveAndThree(w); return e4; } },
    { name: 'held on change run 4 and plain run 2', first: 2, build: (w) => {
      getDb().prepare("UPDATE shape_feature_slices SET kind = 'change' WHERE feature_id = ? AND idx = 4").run(w.f.id);
      const e4 = stopped(w, 4);
      w.runs.delete(w.e2.id); w.runs.set(w.e2.id, w.e2);      // run 4 now sits in the runs map before run 2
      const e3 = w.entry(3, 'running');
      assert.deepEqual(answerStop(w, e4), { held: true });
      assert.deepEqual(answerStop(w, w.e2), { held: true });
      return e3;
    } },
  ];
  for (const { name, first, build } of shapes) {
    const w = setup(FIVE);
    markFeature(w.f.id);
    const going = build(w);
    w.finish(going);
    const heldRows = [...sliceWords(w.f.id, { live: w.liveSliceOf })].filter(([, s]) => s.stop?.held)
      .map(([index, s]) => ({ index, kind: s.kind })).reverse();
    const labelled = nextRuns(w);
    await w.held.deliver();
    assert.deepEqual(labelled, [first], `${name}: the label`);
    assert.equal(answeredRuns(w)[0], first, `${name}: the delivery`);
    assert.equal(features.turnOrder(heldRows)[0].index, first, `${name}: turnOrder`);
  }
}));

test('s6: a held run kept behind a settling sibling blocks later held answers of its feature', () => withEnv(SMALL_ON, async () => {
  const w = takeSetup(FIVE);
  const { e3, e4, e5 } = heldFiveAndThree(w);
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?')
    .run(JSON.stringify({ source: 'feat/other', feature: `feat/${e5.pipelineId}` }), e5.pipelineId);
  w.finish(e4);                                     // done, not settled, on run 3's base and not on run 5's
  assert.deepEqual(nextRuns(w), [3]);
  await w.held.deliver();
  assert.deepEqual([w.taken, answeredRuns(w)], [[], []], 'nothing overtakes run 3');
  assert.equal(e3.heldStop?.after, 4);
  assert.ok(e5.heldStop, 'run 5 stays held');
  e4.settled = true;
  await w.held.deliver();
  assert.deepEqual([w.taken, answeredRuns(w)], [['r3'], [3]]);
  assert.equal(e5.heldStop?.after, 3);
}));

test('s6: a held run kept held by its take-in blocks later held answers of its feature', () => withEnv(SMALL_ON, async () => {
  const w = takeSetup({ ...FIVE, reply: (e) => (e.id === 'r3' ? { ok: false, wait: true, after: 1 } : MERGED) });
  const { e3, e4, e5 } = heldFiveAndThree(w);
  w.finish(e4);
  e4.settled = true;
  await w.held.deliver();
  assert.deepEqual([w.taken, answeredRuns(w)], [['r3'], []], 'run 5 is not asked while run 3 stays held');
  assert.equal(e3.heldStop?.after, 1);
  assert.ok(e5.heldStop, 'run 5 stays held');
}));

test('s6: a refused answer first in turn blocks nothing: the next held answer goes on in the same pass', () => withEnv(SMALL_ON, async () => {
  const w = takeSetup({ ...FIVE, reply: (e) => (e.id === 'r3' ? REFUSED : MERGED) });
  const { e3, e4, e5 } = heldFiveAndThree(w);
  w.finish(e4);
  e4.settled = true;
  await w.held.deliver();
  assert.deepEqual([w.taken, answeredRuns(w)], [['r3', 'r5'], [5]]);
  assert.deepEqual([e3.heldStop, e5.heldStop], [null, null]);
  assert.equal(e3.takeInRefused?.reason, REFUSED.reason);
}));

test('s6 flag off: held answers deliver in runs-map order', () => withEnv({ WORCA_FLAGS: undefined }, async () => {
  const w = setup(FIVE);
  markFeature(w.f.id);
  const { e3, e4 } = heldFiveAndThree(w);
  w.finish(e4);
  await w.held.deliver();
  assert.deepEqual(answeredRuns(w), [5], 'run 5 was inserted first');
  assert.equal(e3.heldStop?.after, 5);
}));

test('s6: the label and deliver read the one exported turnOrder', () => {
  const src = (name) => readFileSync(new URL(`../src/core/shape/${name}`, import.meta.url), 'utf8');
  const label = /\nfunction nextTurnOf\([\s\S]*?\n\}\n/.exec(src('features.mjs'))?.[0] || '';
  assert.ok(label, 'nextTurnOf');
  assert.match(label, /\bturnOrder\(/, 'the label calls turnOrder');
  assert.doesNotMatch(label, /rows\.find\(/, 'no second rule for the held row');
  const delivery = src('held-stops.mjs');
  assert.match(delivery, /import\s*\{[^}]*\bturnOrder\b[^}]*\}\s*from\s*'\.\/features\.mjs'/, 'delivery imports it');
  assert.match(delivery, /\bturnOrder\(/, 'delivery calls it');
});
