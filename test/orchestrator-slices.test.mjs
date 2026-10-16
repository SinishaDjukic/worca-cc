// test/orchestrator-slices.test.mjs — Shape it first slice 4, the engine side: the outline ask inside the Planner's
// execution (plan-outline-<node>-<round>), approve / flat / revise / stop, the feature it creates, the pause and
// withdrawn paths, the audit wording, and Approve each slice's plan (L1, L2, L5, L7, F25, F32, F37).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume, writeClarify } from '../src/core/artifacts.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { createSliceFeature } from '../src/core/shape/features.mjs';
import { MOCK_OUTLINE } from '../src/core/engines/mock.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-slices-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const SHAPE = { perspectives: ['product', 'architect', 'qa'] };
const PROMPT = 'Plan this in slices: demo';
const waitFor = async (pred, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('waitFor timed out');
};
const isOutline = (q) => q.kind === 'plan' && q.plan?.outline;

/** Start a mock run in slicing mode. Outline asks go to `onOutline(q, orch)`, other plan asks to `onPlan`. */
function start(opts = {}, onOutline = () => {}, onPlan = (q, orch) => orch.answer(q.id, { decision: 'approve' })) {
  const { afterSpawn, ...rest } = opts;
  opts = rest;
  const dir = opts.projectDir || gitDir('slices');
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_shape', prompt: PROMPT, claude: { mock: true }, shape: SHAPE, ...opts });
  const outlines = [];
  const plans = [];
  const execs = [];
  const spawns = [];                                           // ctx fields of each agent spawn, in order
  const real = orch._runNodeAttempts.bind(orch);
  orch._runNodeAttempts = async (nc, ctx) => {
    spawns.push({ key: nc.key, slicing: Boolean(ctx.shapeSlicing), note: ctx.shapeOutlineNote?.decision || null,
      feedback: ctx.shapeOutlineNote?.feedback || null, resume: Boolean(ctx.resumeSessionId), scope: Boolean(ctx.shapeSliceScope) });
    const r = await real(nc, ctx);
    if (afterSpawn) await afterSpawn(nc, ctx, spawns.length);
    return r;
  };
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => {
    if (isOutline(q)) { outlines.push(q); setImmediate(() => onOutline(q, orch)); return; }
    if (q.kind === 'plan') { plans.push(q); setImmediate(() => onPlan(q, orch)); return; }
    if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
  });
  const done = opts.resume ? orch.resume() : orch.run();
  return { orch, outlines, plans, execs, spawns, done, dir };
}
const ran = (execs, nodeId) => execs.filter((e) => e.nodeId === nodeId);
const audit = (orch) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(orch.getState().id).map((r) => r.text);
const features = () => getDb().prepare('SELECT * FROM shape_features').all();
const featuresOf = (pid) => getDb().prepare('SELECT * FROM shape_features WHERE origin_pipeline_id = ?').all(pid);
const sliceRows = (fid) => getDb().prepare('SELECT * FROM shape_feature_slices WHERE feature_id = ? ORDER BY idx').all(fid);
const ticketOf = (id) => getDb().prepare('SELECT * FROM scheduled_runs WHERE id = ?').get(id);

test('outline ask: plan-outline-n_plan-1 carries the port, a 5-item check, two slices; Refine has not started', async () => {
  let refineAtAsk = null;
  const h = start({}, (q, orch) => { refineAtAsk = ran(h.execs, 'n_refine').length; orch.answer(q.id, { decision: 'stop' }); });
  assert.equal((await h.done).status, 'stopped');
  const q = h.outlines[0];
  assert.equal(q.id, 'plan-outline-n_plan-1');
  assert.equal(q.plan.port, 'outline');
  assert.equal(q.plan.check.total, 5);
  assert.equal(q.plan.outline.slices.length, 2);
  assert.equal(q.plan.revisable, true);
  assert.equal(refineAtAsk, 0);
});

test('approve: one feature, a chained ticket for slice 2, slice 1 planned and approved, the run ends done', async () => {
  const h = start({ claude: { mock: true, model: 'm-test' } }, (q, orch) => orch.answer(q.id, { decision: 'approve' }, 'ann'));
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const pid = h.orch.getState().id;
  const [f] = featuresOf(pid);
  assert.ok(f, 'a feature row for this run');
  assert.equal(f.proposed, 2);
  assert.equal(f.merges, 0);
  assert.equal(f.approve_each, 0);
  const rows = sliceRows(f.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].pipeline_id, pid);
  const t = ticketOf(rows[1].ticket_id);
  assert.deepEqual(JSON.parse(t.after_ref ?? t.after ?? 'null') ?? { kind: 'pipeline', id: pid }, { kind: 'pipeline', id: pid });
  const req = JSON.parse(t.request);
  assert.equal(req.mock, true);
  assert.equal(req.internal.model, 'm-test');
  assert.equal(req.shape.slices, 'off');
  assert.equal(req.shape.slice.index, 2);
  assert.equal(req.shape.slice.feature, f.id);
  assert.equal(h.orch.runShape.slice.index, 1);
  assert.equal(h.orch.getState().shaping.feature.total, 2);
  assert.equal(h.plans[0].id, 'plan-n_refine-1');
  assert.ok(h.spawns.some((s) => s.key === 'planner' && s.scope), 'the resumed Planner carries the slice scope');
  const texts = audit(h.orch);
  assert.equal(texts.filter((x) => x.startsWith('Slice outline **approve** (round 1) by ann.')).length, 1);
  assert.ok(!texts.some((x) => x.includes('Plan approval **approve**') && x.includes('outline')));
  assert.equal(texts.filter((x) => x.includes('proposed 2 slices')).length, 1);
});

test('approve with a merge that leaves one slice goes flat: no feature, the Planner is resumed with the flat note', async () => {
  const h = start({}, (q, orch) => orch.answer(q.id, { decision: 'approve', edits: [{ op: 'merge', id: 's1' }] }));
  assert.equal((await h.done).status, 'done');
  assert.equal(features().filter((f) => f.origin_pipeline_id === h.orch.getState().id).length, 0);
  assert.ok(h.spawns.some((s) => s.key === 'planner' && s.note === 'flat'));
  assert.equal(h.orch.state.shaping.outline.decided, 'flat');
});

test('flat (Don\'t slice): the Planner resumes with the flat note and the plan ask follows', async () => {
  const h = start({}, (q, orch) => orch.answer(q.id, { decision: 'flat' }));
  assert.equal((await h.done).status, 'done');
  assert.equal(h.outlines.length, 1);
  assert.equal(h.plans[0].id, 'plan-n_refine-1');
  assert.equal(featuresOf(h.orch.getState().id).length, 0);
  assert.deepEqual(h.spawns.filter((s) => s.key === 'planner').map((s) => [s.slicing, s.note]), [[true, null], [false, 'flat']]);
});

test('revise: round 2 is asked; at round 3 the outline is no longer revisable', async () => {
  let n = 0;
  const h = start({}, (q, orch) => {
    n += 1;
    if (n < 3) orch.answer(q.id, { decision: 'revise', feedback: `change ${n}` });
    else orch.answer(q.id, { decision: 'stop' });
  });
  assert.equal((await h.done).status, 'stopped');
  assert.deepEqual(h.outlines.map((q) => q.id), ['plan-outline-n_plan-1', 'plan-outline-n_plan-2', 'plan-outline-n_plan-3']);
  assert.deepEqual(h.outlines.map((q) => q.plan.revisable), [true, true, false]);
  assert.ok(h.spawns.some((s) => s.note === 'revise' && s.feedback === 'change 1'));
});

test('stop on the outline ends the run stopped and starts no feature', async () => {
  const h = start({}, (q, orch) => orch.answer(q.id, { decision: 'stop' }));
  assert.equal((await h.done).status, 'stopped');
  assert.equal(featuresOf(h.orch.getState().id).length, 0);
});

test('no slicing: slices:off, a prompt without the phrase and a --yes run raise no outline ask; --yes never answers one', async () => {
  const off = start({ shape: { ...SHAPE, slices: 'off' } });
  assert.equal((await off.done).status, 'done');
  assert.equal(off.outlines.length, 0);
  assert.ok(off.spawns.filter((s) => s.key === 'planner').every((s) => !s.slicing));

  const plain = start({ prompt: 'demo' });
  assert.equal((await plain.done).status, 'done');
  assert.equal(plain.outlines.length, 0);
  assert.equal(plain.orch._slicingDone, true);

  const yes = start({ auto: true });
  await waitFor(() => yes.outlines.length === 1);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(yes.orch.pendingQuestion?.id, 'plan-outline-n_plan-1', 'waits for a person');
  yes.orch.answer('plan-outline-n_plan-1', { decision: 'stop' });
  assert.equal((await yes.done).status, 'stopped');
});

test('a one-slice outline resumes flat and the audit says so', async () => {
  let wrote = false;
  const h = start({
    afterSpawn: async (nc, ctx) => {
      if (nc.key !== 'planner' || !ctx.shapeSlicing || wrote) return;
      wrote = true;
      await writeFile(ctx.shapeSlicing.file, JSON.stringify({ slices: [{ title: 'x' }] }));
    },
  });
  assert.equal((await h.done).status, 'done');
  assert.equal(h.outlines.length, 0);
  assert.ok(audit(h.orch).some((x) => x.includes('a one-slice outline')));
  assert.equal(h.orch.state.shaping.outline.decided, 'flat');
});

test('pause while the outline is asked: resume asks the same id, the round is not spent, no second feature', async () => {
  const dir = gitDir('slices-pause');
  const h = start({ projectDir: dir });
  await waitFor(() => h.outlines.length === 1);
  h.orch.pause();
  assert.equal((await h.done).status, 'paused');
  const saved = readPipelineForResume(h.orch.getState().id);
  assert.equal(saved.resumePoint.shaping.outline.decided, null);
  assert.equal(saved.resumePoint.shaping.outline.rounds.length, 1);

  const hold = () => {};                                    // a plan ask stays open, so the pause lands on it
  const h2 = start({ projectDir: dir, resume: saved, shape: undefined }, (q, orch) => orch.answer(q.id, { decision: 'approve' }), hold);
  await waitFor(() => h2.plans.length === 1);
  assert.equal(h2.outlines[0].id, 'plan-outline-n_plan-1');
  assert.equal(h2.outlines[0].plan.revisable, true);
  assert.equal(h2.orch.state.shaping.outline.rounds.length, 1);
  assert.equal(audit(h2.orch).filter((x) => x.includes('proposed 2 slices')).length, 1, 'a re-ask writes no second line');
  h2.orch.pause();
  assert.equal((await h2.done).status, 'paused');

  const saved2 = readPipelineForResume(h2.orch.getState().id);
  assert.equal(saved2.resumePoint.shaping.outline.decided, 'approve');
  assert.equal(saved2.resumePoint.shape.slice.index, 1);
  const h3 = start({ projectDir: dir, resume: saved2, shape: undefined }, undefined, hold);
  await waitFor(() => h3.plans.length === 1);
  assert.equal(h3.outlines.length, 0, 'no second outline ask');
  assert.equal(featuresOf(h3.orch.getState().id).length, 1);
  h3.orch.stop();
  await h3.done;
});

test('withdrawn: the loop returns, no Planner spawn follows and no outline audit line is written', async () => {
  const h = start({});
  await waitFor(() => h.outlines.length === 1);
  const before = h.spawns.filter((s) => s.key === 'planner').length;
  h.orch._dismissPendingAsk();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(h.spawns.filter((s) => s.key === 'planner').length, before);
  assert.ok(!audit(h.orch).some((x) => x.startsWith('Slice outline')));
  h.orch.stop();
  await h.done.catch(() => {});
});

test('failure re-ask: a failed feature creation asks again as -e1 with plan.error and the same round', async () => {
  const dir = gitDir('slices-fail');
  getDb().exec('ALTER TABLE shape_features RENAME TO shape_features_off');
  try {
    let n = 0;
    const h = start({ projectDir: dir }, (q, orch) => {
      n += 1;
      if (n === 1) orch.answer(q.id, { decision: 'approve', edits: [], approveEach: true });
      else orch.answer(q.id, { decision: 'stop' });
    });
    assert.equal((await h.done).status, 'stopped');
    assert.equal(h.outlines[1].id, 'plan-outline-n_plan-1-e1');
    assert.match(h.outlines[1].plan.error, /^Could not set up the later slices/);
    assert.equal(h.outlines[1].plan.approveEach, true, 'the re-ask keeps the ticked switch (D19: off by default)');
    assert.equal(h.orch.state.shaping.outline.rounds.length, 1);
  } finally {
    getDb().exec('ALTER TABLE shape_features_off RENAME TO shape_features');
  }
});

test('audit: pendingQuestion keeps plan {outline, round} for an outline ask only', async () => {
  let seen = null;
  const h = start({}, (q, orch) => { seen = orch.pendingQuestion?.plan; orch.answer(q.id, { decision: 'stop' }); });
  await h.done;
  assert.deepEqual(seen, { outline: true, round: 1 });
});

// D19: a later slice's plan stops only on a failing check or outline-change.md (or Approve each / Away mode). The mock
// plan fails the shape check, so a passing one is stubbed.
const PASS = { ok: true, passed: 8, total: 8, items: [] };
const FAIL = { ok: false, passed: 3, total: 8, items: [] };
const d19 = ({ each = false, check = PASS, change = false, away = false, afterSpawn } = {}) => {
  const pid = `p${Date.now()}${Math.random().toString(36).slice(2, 6)}`;   // the feature's origin id
  const f = createSliceFeature({ pipelineId: pid, projectDir: gitDir(`d19-${pid}`), title: 'T',
    outline: MOCK_OUTLINE, perspectives: SHAPE.perspectives, workflowId: 'wf_shape', approveEach: each });
  const slice = { feature: f.id, index: 2, total: 2, outline: MOCK_OUTLINE };
  const h = start({ prompt: 'demo', shape: { ...SHAPE, slices: 'off', slice }, ...(afterSpawn ? { afterSpawn } : {}) });
  h.orch._planCheck = async () => check;
  if (away) h.orch._nightActiveNow = () => true;
  if (change) h.orch._outlineChangeText = async () => 'Slice 1 did not add the tags table.';
  return h;
};

test('D19: a passing check and no outline-change.md → approved without an ask', async () => {
  const h = d19();
  assert.equal((await h.done).status, 'done');
  assert.equal(h.plans.length, 0);
  assert.ok(audit(h.orch).some((x) => x.includes("Plan approval **approve** (Approve each slice's plan is off)")));
  assert.ok(h.orch.state.shaping.approved);
});
test('D19: a failing check → a plan ask', async () => {
  const h = d19({ check: FAIL });
  assert.equal((await h.done).status, 'done');
  assert.equal(h.plans.length, 1);
  assert.ok(audit(h.orch).some((x) => x.includes('Plan approval held: the shape check did not pass')));
});
test('D19: a null check (the check errored) → a plan ask', async () => {
  const h = d19({ check: null });
  await h.done;
  assert.equal(h.plans.length, 1);
});
test('D19: outline-change.md → a plan ask carrying its text', async () => {
  const h = d19({ change: true });
  await h.done;
  assert.equal(h.plans.length, 1);
  assert.equal(h.plans[0].plan.outlineChange, 'Slice 1 did not add the tags table.');
  assert.ok(audit(h.orch).some((x) => x.includes('Plan approval held: the planner says this slice cannot be built as outlined')));
});
test('D19: the Planner writes outline-change.md into the pipeline dir → a plan ask carrying it', async () => {
  const h = d19({ afterSpawn: async (nc, ctx) => {
    if (nc.key !== 'planner') return;
    assert.ok(ctx.shapeSliceScope.outlineChangeFile.endsWith('outline-change.md'));
    await writeFile(ctx.shapeSliceScope.outlineChangeFile, 'The split no longer fits.\n');
  } });
  await h.done;
  assert.equal(h.plans.length, 1);
  assert.equal(h.plans[0].plan.outlineChange, 'The split no longer fits.');
});
test('D19: a stale outline-change.md is removed before the Planner\'s first spawn', async () => {
  let seen = null;
  const h = d19({ afterSpawn: async (nc, ctx) => { if (nc.key === 'planner' && seen === null) seen = existsSync(ctx.shapeSliceScope.outlineChangeFile); } });
  const real = h.orch._shapeSliceCtx.bind(h.orch);
  h.orch._shapeSliceCtx = async (nc, ctx) => {        // an earlier spawn's file, planted before the ctx is built
    if (nc.key === 'planner') await writeFile(join(h.orch.pipeline.dir, 'outline-change.md'), 'stale');
    return real(nc, ctx);
  };
  await h.done;
  assert.equal(seen, false);
  assert.equal(h.plans.length, 0);
});
test('D19: Approve each on → always a plan ask', async () => {
  const h = d19({ each: true });
  await h.done;
  assert.equal(h.plans.length, 1);
});
test('D19: Away mode → a plan ask', async () => {
  const h = d19({ away: true });
  assert.equal((await h.done).status, 'done');
  assert.equal(h.plans.length, 1);
});

test('D19: slice 2 asks no Clarify question and its Planner gets slice 1\'s answers', async () => {
  // A real slice-1 row: the clarify table has a foreign key and writeClarify swallows the error.
  const pid = `p-d19-clarify-${Date.now()}`;
  seedPipelineRow({ id: pid });
  await writeClarify(pid, { questions: { questions: [{ id: 'q1', question: 'Where?', options: ['A', 'B'] }] },
    answers: { answers: [{ id: 'q1', question: 'Where?', choice: 'B' }], answeredBy: 'local' } });
  const f = createSliceFeature({ pipelineId: pid, projectDir: gitDir('slices-d19-clarify'), title: 'T', outline: MOCK_OUTLINE,
    perspectives: SHAPE.perspectives, workflowId: 'wf_shape', approveEach: false });
  const slice = { feature: f.id, index: 2, total: 2, outline: MOCK_OUTLINE };
  const asked = [];
  const h = start({ prompt: 'demo', shape: { ...SHAPE, slices: 'off', slice } });
  h.orch.on('question', (q) => asked.push(q.kind));
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.ok(!asked.includes('clarify'), `asked: ${asked}`);
  const planner = h.orch._graphSnapshot.execs.find((e) => e.nodeId === 'n_plan');
  const answersFile = planner.bindings.answers?.path || planner.bindings.answers;
  const text = await readFile(typeof answersFile === 'string' ? answersFile : answersFile[0].path, 'utf8');
  assert.equal(JSON.parse(text).answers[0].choice, 'B');
  assert.ok(audit(h.orch).some((x) => x.includes("skipped, this slice uses the feature's answers")));
});

test('crash orphan: an outline offered again while its feature exists retires it on Don\'t slice', async () => {
  const dir = gitDir('slices-orphan');
  const h = start({ projectDir: dir });
  await waitFor(() => h.outlines.length === 1);
  h.orch.pause();
  assert.equal((await h.done).status, 'paused');
  const saved = readPipelineForResume(h.orch.getState().id);
  const pid = h.orch.getState().id;
  const f = createSliceFeature({ pipelineId: pid, projectDir: dir, title: 'T', outline: MOCK_OUTLINE,
    perspectives: SHAPE.perspectives, workflowId: 'wf_shape' });
  const h2 = start({ projectDir: dir, resume: saved, shape: undefined }, (q, orch) => orch.answer(q.id, { decision: 'flat' }));
  assert.equal((await h2.done).status, 'done');
  const row = getDb().prepare('SELECT status FROM shape_features WHERE id = ?').get(f.id);
  assert.equal(row.status, 'canceled');
  assert.equal(featuresOf(pid).filter((x) => x.status === 'active').length, 0);
});

test('starter after a resume: the feature and its ticket carry the original starter (F37)', async () => {
  const dir = gitDir('slices-starter');
  const h = start({ projectDir: dir, startedBy: 'ann' });
  await waitFor(() => h.outlines.length === 1);
  h.orch.pause();
  assert.equal((await h.done).status, 'paused');
  const saved = readPipelineForResume(h.orch.getState().id);
  const h2 = start({ projectDir: dir, resume: saved, shape: undefined, resumeOpts: { row: { started_by: 'ann' } } },
    (q, orch) => orch.answer(q.id, { decision: 'approve' }));
  await waitFor(() => h2.plans.length === 1);
  const [f] = featuresOf(h2.orch.getState().id);
  assert.equal(f.created_by, 'ann');
  const t = ticketOf(sliceRows(f.id)[1].ticket_id);
  assert.equal(JSON.parse(t.request).internal.startedBy, 'ann');
  h2.orch.stop();
  await h2.done;
});
