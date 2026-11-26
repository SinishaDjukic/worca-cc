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
function setup({ three = true, slices = 3, applyChange = undefined, takeIn = undefined, canResume = true, resumeReply = undefined } = {}) {
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
  const entrySliceOf = (pid) => {
    const e = [...runs.values()].find((x) => x.pipelineId === pid);
    return e && e.status === 'running' ? liveSliceFrom({ runId: e.id, status: e.status, pendingQuestion: e.pendingQuestion, approved: true, heldStop: e.heldStop, going: !!e.takingIn }) : null;
  };
  // Small runs slice 7 (D9): as the server composes it, through the instance's overlay (held and delivering resumes).
  const liveSliceOf = (pid) => (held.overlay ? held.overlay(pid, entrySliceOf(pid)) : entrySliceOf(pid));
  // Slice 7: the fake resumeRun. It records each call; by default the run goes on (its pipeline row reads running).
  const resumed = [];
  const resume = async (pid, opts) => {
    const run = getDb().prepare('SELECT idx FROM shape_feature_slices WHERE pipeline_id = ? OR ticket_id IN (SELECT id FROM scheduled_runs WHERE pipeline_id = ?)')
      .get(pid, pid)?.idx;
    resumed.push({ run, pid, opts });
    if (resumeReply) return resumeReply(pid, opts);
    setPipe(pid, 'running');
    return { ok: true, runId: `resumed-${pid}`, pipelineId: pid };
  };
  const resolvePending = (e, { id, reason }) => {
    if (!e.pendingQuestion || e.pendingQuestion.id !== id) return false;
    e.pendingQuestion = null; resolved.push({ id, reason }); return true;
  };
  const audits = [];
  const held = createHeldStops({ runs, liveSliceOf, broadcastFeature: (id) => repaints.push(id), resolvePending, now: Date.now,
    audit: (pid, text, by) => audits.push({ pid, text, by }),
    ...(applyChange ? { applyChange } : {}), ...(takeIn ? { takeIn } : {}), ...(canResume ? { resume } : {}) });
  const finish = (e) => { e.status = 'done'; setPipe(e.pipelineId, 'done'); };
  return { f, e2, e3, runs, held, answers, resolved, repaints, finish, liveSliceOf, entry, resumed, audits };
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
  // Slice 9 (R-arch-3): Pause resolves the question and leaves the held answer on the entry.
  const c = setup();
  c.held.answer(c.e2, 'gate-w9-3', { decision: 'another' }, 'ann');
  c.e2.status = 'paused';
  c.e2.pendingQuestion = null;
  assert.equal('stop' in liveSliceFrom({ runId: c.e2.id, status: c.e2.status, pendingQuestion: c.e2.pendingQuestion, heldStop: c.e2.heldStop }), false);
  c.finish(c.e3);
  c.held.deliver();
  assert.equal(c.answers.length, 0);
  assert.equal(c.e2.heldStop, null);
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

// ── Small runs slice 7 (R-po-4, R-po-5): a resume waits its turn, held beside the held stop answers ───────────────
const statusOf = (pid) => getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(pid).status;
/** Run `n` paused with no runs-map entry (as after a restart). → its pipeline id */
function pausedRun(w, n) {
  const e = w.entry(n, 'paused');
  setPipe(e.pipelineId, 'paused');
  w.runs.delete(e.id);
  return e.pipelineId;
}
/** A 6-run feature, marked unless `mark` is false: run 2 done, run 4 working, each run in `paused` paused. */
function resumeWorld({ paused = [6], mark = true, ...over } = {}) {
  const w = setup({ slices: 6, three: false, ...over });
  if (mark) markFeature(w.f.id);
  w.e2.pendingQuestion = null;
  w.finish(w.e2);
  w.e2.settled = true;
  const pids = Object.fromEntries(paused.map((n) => [n, pausedRun(w, n)]));
  const e4 = w.entry(4, 'running');
  return { ...w, e4, pids };
}
const resumedRuns = (w) => w.resumed.map((r) => r.run);
const heldAnswerTo = (pid, after) => ({ ok: true, held: true, pipelineId: pid, after });

test('s7: holdResume while run 4 works returns {held, after:4}; resume is not called; heldResumeOf reads {after:4}', () => withEnv(SMALL_ON, async () => {
  const w = resumeWorld();
  const pid = w.pids[6];
  const painted = w.repaints.length;
  assert.deepEqual(w.held.holdResume(pid, { by: 'ann' }), heldAnswerTo(pid, 4));
  assert.deepEqual(w.held.heldResumeOf(pid), { after: 4 });
  assert.ok(w.repaints.slice(painted).includes(w.f.id), 'the feature repaints');
  const once = w.repaints.length;
  assert.deepEqual(w.held.holdResume(pid, { by: 'ann' }), heldAnswerTo(pid, 4), 'a ticket held again on the next tick');
  assert.equal(w.repaints.length, once, 'the same hold does not repaint again');
  assert.equal(busySliceOf(w.f.id, { exclude: 4, live: w.liveSliceOf }), null, 'a held resume holds nothing');
  await w.held.deliver();
  assert.deepEqual(w.resumed, []);
  assert.equal(statusOf(pid), 'paused');
}));

test('s7: deliver after run 4 finishes calls resume once with the stored opts', () => withEnv(SMALL_ON, async () => {
  const w = resumeWorld();
  const pid = w.pids[6];
  w.held.holdResume(pid, { by: 'bo' });
  const latest = { by: 'ann', ignoreCostCap: true };
  assert.deepEqual(w.held.holdResume(pid, latest), heldAnswerTo(pid, 4), 'held again: the latest opts are kept');
  latest.by = 'changed afterwards';
  w.finish(w.e4);
  await w.held.deliver();
  await w.held.deliver();
  assert.deepEqual(w.resumed, [{ run: 6, pid, opts: { by: 'ann', ignoreCostCap: true, heldDelivery: true } }]);
  assert.equal(w.held.heldResumeOf(pid), null);
}));

test('s7: held answer on run 5 and held resume on run 3 go 3, then 5; nextRuns names [3]', () => withEnv(SMALL_ON, async () => {
  const w = resumeWorld({ paused: [3] });
  const e5 = stopped(w, 5);
  assert.deepEqual(answerStop(w, e5), { held: true });
  assert.deepEqual(w.held.holdResume(w.pids[3], { by: 'ann' }), heldAnswerTo(w.pids[3], 4));
  assert.deepEqual(nextRuns(w), [3], 'only run 3 reads next');
  w.finish(w.e4);
  await w.held.deliver();
  assert.deepEqual([resumedRuns(w), answeredRuns(w)], [[3], []], 'run 3 is resumed first');
  assert.equal(e5.heldStop?.after, 3, 'run 5 stays held behind run 3');
  setPipe(w.pids[3], 'done');
  await w.held.deliver();
  assert.deepEqual([resumedRuns(w), answeredRuns(w)], [[3], [5]]);
}));

test('s7 (R-arch-7): one order for both kinds: a held answer on run 3 goes before a held resume on run 5', () => withEnv(SMALL_ON, async () => {
  const w = resumeWorld({ paused: [5] });
  const e3 = stopped(w, 3);
  assert.deepEqual(w.held.holdResume(w.pids[5], { by: 'ann' }), heldAnswerTo(w.pids[5], 4));
  assert.deepEqual(answerStop(w, e3), { held: true });
  assert.deepEqual(nextRuns(w), [3]);
  w.finish(w.e4);
  await w.held.deliver();
  assert.deepEqual([answeredRuns(w), resumedRuns(w)], [[3], []]);
  assert.deepEqual(w.held.heldResumeOf(w.pids[5]), { after: 3 }, 'run 5 is now behind run 3');
  w.finish(e3);
  await w.held.deliver();
  assert.deepEqual(resumedRuns(w), [5]);
}));

test('s7 (D7): a resume held again after its turn blocks the later held items of its feature', () => withEnv(SMALL_ON, async () => {
  const w = resumeWorld({ paused: [3], resumeReply: (pid) => heldAnswerTo(pid, 1) });
  const e5 = stopped(w, 5);
  assert.deepEqual(answerStop(w, e5), { held: true });
  w.held.holdResume(w.pids[3], { by: 'ann' });
  w.finish(w.e4);
  await w.held.deliver();
  assert.deepEqual([resumedRuns(w), answeredRuns(w)], [[3], []], 'run 5 does not overtake run 3');
  assert.ok(w.held.heldResumeOf(w.pids[3]), 'run 3 is put back');
  assert.ok(e5.heldStop, 'run 5 stays held');
}));

test("s7: pausing run 4 (a person's pause) delivers the held resume", () => withEnv(SMALL_ON, async () => {
  const w = resumeWorld();
  w.held.holdResume(w.pids[6], { by: 'ann' });
  w.e4.status = 'paused';
  setPipe(w.e4.pipelineId, 'paused');
  await w.held.deliver();
  assert.deepEqual(resumedRuns(w), [6]);
}));

test('s7: run 4 reaching an unanswered stop delivers the held resume once on the next pass', () => withEnv(SMALL_ON, async () => {
  const w = resumeWorld();
  w.held.holdResume(w.pids[6], { by: 'ann' });
  w.e4.pendingQuestion = { id: 'gate-s7-4', kind: 'gate', stop: STOP };
  await w.held.deliver();
  await w.held.deliver();
  assert.deepEqual(resumedRuns(w), [6]);
}));

test('s7: a held resume whose turn is not due names the run now going and repaints', () => withEnv(SMALL_ON, async () => {
  const w = resumeWorld();
  w.held.holdResume(w.pids[6], { by: 'ann' });
  w.entry(3, 'running');
  w.finish(w.e4);
  const painted = w.repaints.length;
  await w.held.deliver();
  assert.deepEqual(w.resumed, []);
  assert.deepEqual(w.held.heldResumeOf(w.pids[6]), { after: 3 });
  assert.ok(w.repaints.slice(painted).includes(w.f.id));
}));

test('s7: a refused delivery drops the hold, logs and says why on the run (overlay and audit); the run stays paused', () => withEnv(SMALL_ON, async () => {
  for (const [name, resumeReply, code] of [
    ['a refusal', async () => ({ ok: false, error: 'pipeline cost limit reached' }), null],
    ['a throw', async () => { throw Object.assign(new Error('main moved 2 commit(s)'), { status: 409, body: { code: 'base-moved', error: 'main moved 2 commit(s)' } }); }, 'base-moved'],
  ]) {
    const w = resumeWorld({ resumeReply });
    const pid = w.pids[6];
    w.held.holdResume(pid, { by: 'ann' });
    w.finish(w.e4);
    const painted = w.repaints.length;
    const errors = await quietly(() => w.held.deliver());
    assert.equal(w.held.heldResumeOf(pid), null, name);
    assert.ok(errors.some((e) => /held resume not delivered: /.test(e)), `${name}: ${errors.join(' | ')}`);
    assert.equal(statusOf(pid), 'paused', name);
    const error = code ? 'main moved 2 commit(s)' : 'pipeline cost limit reached';
    const why = w.held.overlay(pid, null);
    assert.deepEqual([why?.status, why?.resuming, 'heldResume' in (why || {}), why?.resumeRefused], ['paused', undefined, false, { code, error }], `${name}: the reason reads on the run`);
    assert.deepEqual(w.audits, [{ pid, by: 'ann', text: `The resume held for its turn did not go on: ${error}. Resume again to go on.` }], name);
    assert.ok(w.repaints.slice(painted).includes(w.f.id), name);
    await w.held.deliver();
    assert.equal(w.resumed.length, 1, `${name}: not tried again`);
    w.held.holdResume(pid, { by: 'ann' });
    assert.equal(w.held.overlay(pid, null), null, `${name}: the next Resume clears the reason`);
  }
}));

test('s7: dropResume removes the hold; deliver after run 4 finishes calls nothing', () => withEnv(SMALL_ON, async () => {
  const w = resumeWorld();
  const pid = w.pids[6];
  w.held.holdResume(pid, { by: 'ann' });
  const painted = w.repaints.length;
  assert.equal(w.held.dropResume(pid), true);
  assert.ok(w.repaints.slice(painted).includes(w.f.id));
  assert.equal(w.held.dropResume(pid), false, 'nothing left to drop');
  assert.equal(w.held.heldResumeOf(pid), null);
  w.finish(w.e4);
  await w.held.deliver();
  assert.deepEqual(w.resumed, []);
}));

test('s7: overlay reads heldResume.after while held, resuming while delivering, and neither after dropResume', () => withEnv(SMALL_ON, async () => {
  const gate = deferred();
  const w = resumeWorld({ resumeReply: () => gate.promise });
  const pid = w.pids[6];
  const entry = liveSliceFrom({ runId: 'r6', status: 'paused' });
  assert.equal(w.held.overlay(pid, null), null, 'unchanged while neither');
  assert.equal(w.held.overlay(pid, entry), entry, 'unchanged while neither');

  w.held.holdResume(pid, { by: 'ann' });
  const bare = w.held.overlay(pid, null);
  assert.deepEqual(bare, { ...liveSliceFrom({ runId: null, status: 'paused' }), heldResume: { after: 4 } });
  assert.deepEqual(w.held.overlay(pid, entry), { ...entry, heldResume: { after: 4 } });
  assert.deepEqual(w.held.overlay(pid, bare), bare, 'idempotent');
  w.held.dropResume(pid);
  assert.equal(w.held.overlay(pid, null), null, 'neither after dropResume');

  w.held.holdResume(pid, { by: 'ann' });
  w.finish(w.e4);
  const going = w.held.deliver();
  try {
    await ticks();
    const delivering = w.held.overlay(pid, null);
    assert.equal(delivering?.resuming, true);
    assert.equal(delivering.status, 'paused');
    assert.equal('heldResume' in delivering, false);
    assert.equal(w.held.overlay(pid, entry).resuming, true);
  } finally { gate.resolve({ ok: true, runId: 'r6-resumed' }); }
  await going;
  assert.equal(w.held.overlay(pid, null), null, 'neither once delivered');
}));

test('s7 (I2, I4): while a resume is being delivered the run is going, it is not held again and not delivered twice', () => withEnv(SMALL_ON, async () => {
  const gate = deferred();
  const w = resumeWorld({ resumeReply: () => gate.promise });
  const pid = w.pids[6];
  w.held.holdResume(pid, { by: 'ann' });
  w.finish(w.e4);
  const first = w.held.deliver();
  const second = w.held.deliver();
  try {
    await ticks();
    assert.equal(w.held.holdResume(pid, { by: 'ann', heldDelivery: true }), null, 'the delivery does not hold itself');
    assert.throws(() => w.held.holdResume(pid, { by: 'bo' }), (e) => e.code === 'RESUME_IN_FLIGHT' && e.status === 409, "a person's Resume is refused");
    assert.equal(w.held.heldResumeOf(pid), null);
    assert.deepEqual(busySliceOf(w.f.id, { live: w.liveSliceOf }), { index: 6 });
    assert.equal(w.resumed.length, 1);
  } finally { gate.resolve({ ok: true, runId: 'r6-resumed' }); }
  await Promise.all([first, second]);
  await ticks();
  assert.equal(w.resumed.length, 1, 'delivered once');
}));

test('s7: holdResume answers null (nothing held) with no resume dep, the flag off, an unmarked feature, no feature, or the turn due', async () => {
  const nothing = (w, pid, why) => {
    assert.equal(w.held.holdResume(pid, { by: 'ann' }), null, why);
    assert.equal(w.held.heldResumeOf(pid), null, why);
  };
  await withEnv({ WORCA_FLAGS: undefined }, () => { const w = resumeWorld(); nothing(w, w.pids[6], 'flag off'); });
  await withEnv(SMALL_ON, () => {
    const unmarked = resumeWorld({ mark: false });
    nothing(unmarked, unmarked.pids[6], 'unmarked feature');
    const w = resumeWorld();
    nothing(w, pipe('paused'), 'a pipeline of no feature');
    w.finish(w.e4);
    nothing(w, w.pids[6], 'the turn is due');
    const noDep = resumeWorld({ canResume: false });
    nothing(noDep, noDep.pids[6], 'no resume dep');
  });
});

test('s7 (D12): a resume asked again once its turn is due answers null and drops the old hold', () => withEnv(SMALL_ON, async () => {
  const w = resumeWorld();
  const pid = w.pids[6];
  w.held.holdResume(pid, { by: 'ann' });
  w.finish(w.e4);
  const painted = w.repaints.length;
  assert.equal(w.held.holdResume(pid, { by: 'bo' }), null);
  assert.equal(w.held.heldResumeOf(pid), null);
  assert.ok(w.repaints.slice(painted).includes(w.f.id));
  await w.held.deliver();
  assert.deepEqual(w.resumed, [], 'the caller goes on itself');
}));

test('s7 (D13): with the flag off a left-over held resume is delivered with no turn check', async () => {
  let w = null;
  await withEnv(SMALL_ON, () => { w = resumeWorld(); assert.ok(w.held.holdResume(w.pids[6], { by: 'ann' })); });
  await withEnv({ WORCA_FLAGS: undefined }, async () => {
    await w.held.deliver();
    assert.deepEqual(resumedRuns(w), [6], 'run 4 is still working');
    assert.equal(w.held.heldResumeOf(w.pids[6]), null);
  });
});

test('s7: splitBootPicks keeps the lowest run per marked feature and holds the others after it; unmarked picks pass through', () => withEnv(SMALL_ON, async () => {
  const marked = resumeWorld({ paused: [6, 5, 3] });
  marked.finish(marked.e4);                          // nothing is working at a start
  const unmarked = resumeWorld({ paused: [3, 5], mark: false });
  const pick = (pid, by = 'cy') => ({ pipelineId: pid, by, why: 'drain' });
  const [three, five, six] = [3, 5, 6].map((n) => marked.pids[n]);
  const others = [pick(unmarked.pids[5]), pick(unmarked.pids[3]), pick(pipe('paused'))];
  const picks = [pick(six, 'ann'), pick(five), pick(three), ...others];
  const ids = (list) => list.map((p) => p.pipelineId).sort();
  const out = marked.held.splitBootPicks(picks, { mock: true });
  assert.deepEqual(ids(out), ids([pick(three), ...others]), 'run 3 goes on; the unmarked picks and the pick of no feature pass through');
  assert.deepEqual(marked.held.heldResumeOf(five), { after: 3 });
  assert.deepEqual(marked.held.heldResumeOf(six), { after: 3 });
  assert.equal(marked.held.heldResumeOf(three), null);
  for (const p of others) assert.equal(marked.held.heldResumeOf(p.pipelineId), null);
  assert.deepEqual(ids(marked.held.splitBootPicks(picks, { mock: true })), ids(out), 'idempotent');
  assert.deepEqual(marked.held.heldResumeOf(six), { after: 3 });
}));

test('s7 (D11): of boot picks [6, 4] only run 4 stays a pick; run 6 is resumed later as {by, mock}', () => withEnv(SMALL_ON, async () => {
  const w = resumeWorld({ paused: [6] });
  const four = w.e4.pipelineId;
  w.e4.status = 'paused';
  setPipe(four, 'paused');
  const picks = [{ pipelineId: w.pids[6], by: 'ann', why: 'drain' }, { pipelineId: four, by: 'bo', why: 'drain' }];
  assert.deepEqual(w.held.splitBootPicks(picks, { mock: true }), [picks[1]]);
  assert.deepEqual(w.held.heldResumeOf(w.pids[6]), { after: 4 });
  w.e4.status = 'running';                            // run 4's boot resume is live
  setPipe(four, 'running');
  await w.held.deliver();
  assert.deepEqual(w.resumed, []);
  w.finish(w.e4);
  await w.held.deliver();
  assert.deepEqual(w.resumed, [{ run: 6, pid: w.pids[6], opts: { by: 'ann', mock: true, heldDelivery: true } }]);
}));

test('s7 flag off: splitBootPicks returns every pick and holds nothing', () => withEnv({ WORCA_FLAGS: undefined }, () => {
  const w = resumeWorld({ paused: [3, 6] });
  const picks = [{ pipelineId: w.pids[6], by: 'ann', why: 'drain' }, { pipelineId: w.pids[3], by: 'bo', why: 'drain' }];
  assert.deepEqual(w.held.splitBootPicks(picks, { mock: false }), picks);
  assert.equal(w.held.heldResumeOf(w.pids[6]), null);
}));

test('s7 (I2): a resume whose turn is due claims it until it settles; a second resume meanwhile is held after it or refused', () => withEnv(SMALL_ON, async () => {
  const w = resumeWorld({ paused: [3, 5] });
  w.finish(w.e4);                                     // nothing is going
  const gate = deferred();
  const three = w.held.claimed(w.pids[3], async (ticket) => {
    assert.equal(w.held.holdResume(w.pids[3], { by: 'ann' }, ticket), null, 'run 3 goes on');
    assert.equal(ticket.claimed, true);
    await gate.promise;                               // resumeRun's awaits before its runs-map entry is set
    return { ok: true, runId: 'r3' };
  });
  await ticks();
  assert.equal(w.liveSliceOf(w.pids[3])?.resuming, true, 'run 3 reads as being resumed');
  assert.deepEqual(busySliceOf(w.f.id, { live: w.liveSliceOf }), { index: 3 });
  const five = await w.held.claimed(w.pids[5], async (ticket) => w.held.holdResume(w.pids[5], { by: 'bo' }, ticket) || { ok: true, runId: 'r5' });
  assert.deepEqual(five, heldAnswerTo(w.pids[5], 3), 'run 5 is held after run 3');
  assert.throws(() => w.held.holdResume(w.pids[3], { by: 'cy' }), (e) => e.code === 'RESUME_IN_FLIGHT', 'a second resume of run 3 is refused');
  setPipe(w.pids[3], 'running');                      // its entry is set
  gate.resolve();
  assert.deepEqual(await three, { ok: true, runId: 'r3' });
  assert.equal(w.liveSliceOf(w.pids[3]), null, 'the claim is released once it settled');
  await w.held.deliver();
  assert.deepEqual(w.resumed, [], 'run 5 waits for run 3');
}));

test('s7: a claimed resume that refuses releases the claim; without a ticket nothing is claimed', () => withEnv(SMALL_ON, async () => {
  const w = resumeWorld();
  w.finish(w.e4);
  await assert.rejects(w.held.claimed(w.pids[6], async (ticket) => { w.held.holdResume(w.pids[6], {}, ticket); throw new Error('pipeline is archived'); }), /archived/);
  assert.equal(w.liveSliceOf(w.pids[6]), null);
  assert.equal(w.held.holdResume(w.pids[6], {}), null);
  assert.equal(w.liveSliceOf(w.pids[6]), null, 'no ticket, no claim');
}));

// ── Shaper small runs slice 8 (R-ux-2): the view says before the press which run a Resume would wait for ─────────
/** Run `n`'s slice in the feature view, read through `live`. */
const viewSlice = (w, n, live = w.liveSliceOf) => featureView(w.f.id, { live }).slices.find((s) => s.index === n);
/** `w.liveSliceOf` with pipeline `pid` reading `slice` instead. */
const liveWith = (w, pid, slice) => (at) => (at === pid ? slice : w.liveSliceOf(at));

test('s8: saved paused run 6 (no overlay) gets resumeAfter 4 while run 4 works, and the view creates no hold', () => withEnv(SMALL_ON, () => {
  const w = resumeWorld();
  const pid = w.pids[6];
  assert.equal(w.liveSliceOf(pid), null, 'the fixture: a saved paused run, with no overlay');
  const painted = w.repaints.length;
  const view = featureView(w.f.id, { live: w.liveSliceOf });
  const six = view.slices[5];
  assert.deepEqual([six.index, six.state, six.resumeAfter], [6, 'paused', 4]);
  assert.deepEqual(view.slices.filter((s) => 'resumeAfter' in s).map((s) => s.index), [6], 'only the paused run carries it');
  assert.equal(features.sliceOfPipeline(pid, { live: w.liveSliceOf }).resumeAfter, 4, "the run's own /slice answer");
  assert.equal(sliceWords(w.f.id, { live: w.liveSliceOf }).get(6).resumeAfter, 4, 'the words every surface carries');
  assert.equal(viewSlice(w, 6, liveWith(w, pid, liveSliceFrom({ runId: 'r6', status: 'paused' }))).resumeAfter, 4, 'a paused overlay qualifies too');
  assert.equal(w.held.heldResumeOf(pid), null, 'nothing is held by reading');
  assert.equal(w.liveSliceOf(pid), null, 'nothing is claimed by reading');
  assert.equal(w.repaints.length, painted, 'no repaint');
  assert.deepEqual(w.resumed, []);
}));

test("s8: the preview's 4 equals holdResume's after; once held, run 6 has heldResume {after:4} and no resumeAfter", () => withEnv(SMALL_ON, () => {
  const w = resumeWorld();
  const pid = w.pids[6];
  const preview = viewSlice(w, 6).resumeAfter;
  assert.equal(preview, 4);
  assert.equal(w.held.holdResume(pid, { by: 'ann' }).after, preview, 'the preview and the hold name the same run');
  const six = viewSlice(w, 6);
  assert.deepEqual(six.heldResume, { after: 4 });
  assert.equal('resumeAfter' in six, false, 'one fact: a held run carries no preview');
  const at = features.sliceOfPipeline(pid, { live: w.liveSliceOf });
  assert.equal('resumeAfter' in at, false, "nor does the run's /slice answer");
}));

test('s8: run 4 finished → run 6 has no resumeAfter, and holdResume returns null (nothing works)', () => withEnv(SMALL_ON, () => {
  const w = resumeWorld();
  const pid = w.pids[6];
  assert.equal(viewSlice(w, 6).resumeAfter, 4, 'while run 4 works');
  w.finish(w.e4);
  assert.equal('resumeAfter' in viewSlice(w, 6), false);
  assert.equal('resumeAfter' in features.sliceOfPipeline(pid, { live: w.liveSliceOf }), false);
  assert.equal(w.held.holdResume(pid, { by: 'ann' }), null, 'the Resume goes on at once');
}));

test('s8: run 4 being resumed at boot (resuming overlay) → run 6 resumeAfter 4', () => withEnv(SMALL_ON, () => {
  const w = resumeWorld();
  const four = w.e4.pipelineId;
  w.e4.status = 'paused';
  setPipe(four, 'paused');
  const live = liveWith(w, four, features.liveSliceResuming());
  assert.equal(viewSlice(w, 6, live).resumeAfter, 4);
  assert.equal('resumeAfter' in viewSlice(w, 4, live), false, 'the run being resumed carries none');
}));

test('s8: a paused run that is itself being resumed gets no resumeAfter, even while another run works', () => withEnv(SMALL_ON, () => {
  const w = resumeWorld();
  assert.equal(viewSlice(w, 6).resumeAfter, 4, 'not being resumed: it would wait');
  assert.equal('resumeAfter' in viewSlice(w, 6, liveWith(w, w.pids[6], features.liveSliceResuming())), false);
}));

test('s8: flag off, and flag on with the feature unmarked → no resumeAfter in featureView or sliceOfPipeline', async () => {
  const none = (w, why) => {
    assert.deepEqual(featureView(w.f.id, { live: w.liveSliceOf }).slices.filter((s) => 'resumeAfter' in s), [], `${why}: featureView`);
    assert.equal('resumeAfter' in features.sliceOfPipeline(w.pids[6], { live: w.liveSliceOf }), false, `${why}: sliceOfPipeline`);
    assert.equal('resumeAfter' in sliceWords(w.f.id, { live: w.liveSliceOf }).get(6), false, `${why}: sliceWords`);
  };
  let marked = null;
  await withEnv(SMALL_ON, () => {
    marked = resumeWorld();
    assert.equal(viewSlice(marked, 6).resumeAfter, 4, 'positive control: marked, flag on');
    none(resumeWorld({ mark: false }), 'unmarked');
  });
  await withEnv({ WORCA_FLAGS: undefined }, () => none(marked, 'flag off'));
});
