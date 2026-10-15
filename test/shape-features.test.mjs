// test/shape-features.test.mjs — sliced features (src/core/shape/features.mjs): the durable record, the chained
// slice tickets, the feature view and its actions. Real DB through useTempHome, rows through seedPipelineRow.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeReview } from '../src/core/artifacts.mjs';
import { getTicket, runDueTickets, updateTicket } from '../src/core/scheduler.mjs';
import {
  createSliceFeature, retireFeaturesOf, sliceRequest, sliceTitle, featureView, currentFeatureId, featureOfPipeline,
  earlierSliceChanges, cancelRest, resumeFeature, rechainWaiting, replanRest, setApproveEach, featureApprovesEach,
  stackedPrBase, recordShapePlan, listShapePlans, featuresOfTickets,
} from '../src/core/shape/features.mjs';

useTempHome(after, 'worca-shape-features-');

const root = mkdtempSync(join(tmpdir(), 'worca-shape-features-proj-'));
const PK = () => projectKey(root);
after(() => rmSync(root, { recursive: true, force: true }));
before(() => { getDb(); });

const slice = (n, extra = {}) => ({
  id: `s${n}`, title: `Slice ${n}`, goal: `Goal ${n}`, inScope: [`do ${n}`], outOfScope: [], acceptance: [`ok ${n}`],
  dependsOn: [], estimate: 'M', ...extra,
});
const outlineOf = (n) => ({ why: 'because', slices: Array.from({ length: n }, (_, i) => slice(i + 1)) });

let seq = 0;
const nextId = (p = 'p') => `${p}${String(++seq).padStart(6, '0')}`;
const pipe = (status = 'running', { branch = {}, ...extra } = {}) => {
  const id = nextId();
  seedPipelineRow({ id, projectKey: PK(), status, title: id, branch: { source: 'main', feature: `feat/${id}`, ...branch }, ...extra });
  return id;
};
const setPipe = (id, status) => getDb().prepare('UPDATE pipelines SET status = ? WHERE id = ?').run(status, id);
const setTicket = (id, status, extra = {}) => {
  getDb().prepare('UPDATE scheduled_runs SET status = ?, pipeline_id = COALESCE(?, pipeline_id) WHERE id = ?').run(status, extra.pipelineId ?? null, id);
};
const mk = (n, over = {}) => {
  const pid = over.pipelineId || pipe('running');
  const f = createSliceFeature({ pipelineId: pid, projectDir: root, title: 'Charts', outline: outlineOf(n),
    perspectives: ['product'], workflowId: 'wf_shape', startedBy: 'ann', ...over });
  return { ...f, pid };
};
const tickets = (fid) => getDb().prepare('SELECT * FROM shape_feature_slices WHERE feature_id = ? ORDER BY idx').all(fid);
const countTickets = () => getDb().prepare('SELECT count(*) n FROM scheduled_runs').get().n;
const countFeatures = () => getDb().prepare('SELECT count(*) n FROM shape_features').get().n;
const settle = async () => {
  for (let i = 0; i < 20; i++) {
    const r = await runDueTickets({ start: async () => ({ ok: false, error: 'not in this test' }) });
    if (!r.missed.length && !r.failed.length && !r.fired.length) return;
  }
};
const state = (view, i) => view.slices[i - 1].state;

test('sliceTitle and createSliceFeature: row, slice rows, chained tickets', () => {
  assert.equal(sliceTitle('Charts', 2, 3, { title: 'Pin' }), 'Charts · 2/3: Pin');
  const { id, total, pid } = mk(3);
  assert.equal(total, 3);
  assert.match(id, /^feat_[0-9a-f]{12}$/);
  const rows = tickets(id);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].ticket_id, null);
  assert.equal(rows[0].pipeline_id, pid);
  const t2 = getTicket(rows[1].ticket_id);
  const t3 = getTicket(rows[2].ticket_id);
  assert.deepEqual(t2.after, { kind: 'pipeline', id: pid, policy: 'done' });
  assert.deepEqual(t3.after, { kind: 'ticket', id: t2.id, policy: 'done' });
  assert.equal(t2.sourceFromPrevious, true);
  assert.equal(t2.title, 'Charts · 2/3: Slice 2');
  const f = getDb().prepare('SELECT * FROM shape_features WHERE id = ?').get(id);
  assert.equal(f.status, 'active');
  assert.equal(f.origin_pipeline_id, pid);
  assert.equal(f.source_branch, 'main');
  assert.equal(f.approve_each, 1);
  assert.equal(f.created_by, 'ann');
});

test('sliceRequest: model and starter ride internal, engine/mock/guardrailsId at the top level', () => {
  const r = sliceRequest({
    feature: { id: 'feat_x', title: 'Charts' }, index: 2, outline: outlineOf(3), perspectives: ['product'], workflowId: 'wf_shape',
    base: { model: 'm', engine: 'codex', mock: true, guardrailsId: 'g' }, projectDir: root, startedBy: 'ann',
  });
  assert.deepEqual(r.internal, { startedBy: 'ann', model: 'm' });
  assert.equal(r.engine, 'codex');
  assert.equal(r.mock, true);
  assert.equal(r.guardrailsId, 'g');
  assert.equal('model' in r, false);
  assert.deepEqual(r.shape.slice, { feature: 'feat_x', index: 2, total: 3, outline: outlineOf(3) });
  assert.equal(r.shape.slices, 'off');
  assert.equal(r.title, 'Charts · 2/3: Slice 2');
  assert.equal('sourceBranch' in r, false);
  assert.equal(sliceRequest({ feature: { id: 'f', title: 'T' }, index: 1, outline: outlineOf(2), perspectives: [], workflowId: 'w', projectDir: root, sourceBranch: 'dev' }).sourceBranch, 'dev');
});

test('createSliceFeature runs one tx: a failure part-way leaves no feature and no new ticket', () => {
  const before1 = { f: countFeatures(), t: countTickets() };
  const bad = outlineOf(3);
  bad.slices[2].title = null;
  assert.throws(() => createSliceFeature({ pipelineId: pipe(), projectDir: root, title: 'Boom', outline: bad, perspectives: [], workflowId: 'wf_shape' }));
  assert.equal(countFeatures(), before1.f);
  assert.equal(countTickets(), before1.t);
});

test('createSliceFeature is idempotent per origin pipeline: the earlier active feature is canceled and replanned', () => {
  const a = mk(3);
  const old = tickets(a.id).map((r) => r.ticket_id).filter(Boolean);
  const b = mk(2, { pipelineId: a.pid });
  const fa = getDb().prepare('SELECT status, replaced_by FROM shape_features WHERE id = ?').get(a.id);
  assert.deepEqual({ ...fa }, { status: 'replanned', replaced_by: b.id });
  for (const t of old) assert.equal(getTicket(t).status, 'canceled');
});

test('retireFeaturesOf cancels open tickets, marks canceled, returns the count', () => {
  const a = mk(3);
  const ids = tickets(a.id).map((r) => r.ticket_id).filter(Boolean);
  assert.equal(retireFeaturesOf(a.pid, { by: 'ann' }), 1);
  assert.equal(getDb().prepare('SELECT status FROM shape_features WHERE id = ?').get(a.id).status, 'canceled');
  for (const t of ids) assert.equal(getTicket(t).status, 'canceled');
  assert.equal(retireFeaturesOf(a.pid), 0);
  assert.equal(retireFeaturesOf('nope'), 0);
});

test('featureApprovesEach / setApproveEach', () => {
  const a = mk(2);
  assert.equal(featureApprovesEach(a.id), true);
  assert.equal(setApproveEach(a.id, false), true);
  assert.equal(featureApprovesEach(a.id), false);
  assert.equal(featureView(a.id).approveEach, false);
  assert.equal(setApproveEach('missing', true), false);
  assert.equal(featureApprovesEach('missing'), true);
});

test('featureView slice states from a ticket', () => {
  const rows = [['scheduled', 'planned'], ['firing', 'starting'], ['missed', 'missed'], ['canceled', 'canceled'], ['failed', 'failed']];
  for (const [ts, want] of rows) {
    const a = mk(2);
    setTicket(tickets(a.id)[1].ticket_id, ts);
    assert.equal(state(featureView(a.id), 2), want, ts);
  }
  assert.equal(featureView('missing'), null);
});

test('featureView slice states from the live run', () => {
  const a = mk(2);
  const cases = [
    [{ runId: 'r', status: 'running', waiting: true }, 'approval'],
    [{ runId: 'r', status: 'running', asking: true }, 'questions'],
    [{ runId: 'r', status: 'running', approved: true }, 'running'],
    [{ runId: 'r', status: 'paused' }, 'paused'],
    [{ runId: 'r', status: 'running' }, 'shaping'],
  ];
  for (const [l, want] of cases) {
    const v = featureView(a.id, { live: (p) => (p === a.pid ? l : null) });
    assert.equal(state(v, 1), want, JSON.stringify(l));
    assert.equal(v.slices[0].runId, 'r');
  }
});

test('featureView slice states from the pipelines row', () => {
  const rows = [['done', 'done'], ['stopped', 'stopped'], ['error', 'error'], ['interrupted', 'paused'], ['paused', 'paused'],
    ['created', 'starting'], ['starting', 'starting']];
  for (const [ps, want] of rows) {
    const a = mk(2, { pipelineId: pipe(ps) });
    assert.equal(state(featureView(a.id), 1), want, ps);
  }
});

test('featureView rollups: done count, done status, halted.waiting, projectKey, replacedBy', () => {
  const a = mk(4, { pipelineId: pipe('done') });
  let v = featureView(a.id);
  assert.equal(v.projectKey, PK());
  assert.equal(v.done, 1);
  assert.equal(v.total, 4);
  assert.equal(v.halted, null);
  assert.equal(v.open, true);
  assert.equal(v.status, 'active');
  assert.equal(v.slices[1].goal, 'Goal 2');
  assert.equal(v.slices[1].estimate, 'M');

  const b = mk(2, { pipelineId: pipe('stopped') });
  const t = tickets(b.id)[1].ticket_id;
  setTicket(t, 'missed');
  v = featureView(b.id);
  assert.deepEqual(v.halted, { index: 1, state: 'stopped', waiting: [2] });

  // a missed slice 3 behind a stopped slice 2 is waiting, not the halt
  const c = mk(3, { pipelineId: pipe('done') });
  const [, r2, r3] = tickets(c.id);
  setTicket(r2.ticket_id, 'fired', { pipelineId: pipe('stopped') });
  setTicket(r3.ticket_id, 'missed');
  v = featureView(c.id);
  assert.deepEqual(v.halted, { index: 2, state: 'stopped', waiting: [3] });

  const d = mk(2, { pipelineId: pipe('done') });
  setTicket(tickets(d.id)[1].ticket_id, 'fired', { pipelineId: pipe('done') });
  v = featureView(d.id);
  assert.equal(v.status, 'done');
  assert.equal(v.done, 2);
  assert.equal(v.open, false);

  const e = mk(2);
  const f2 = mk(2, { pipelineId: e.pid });
  assert.equal(featureView(e.id).replacedBy, f2.id);
});

test('featureView stuck (F43): a missed or canceled slice behind a done slice halts the feature', () => {
  for (const ts of ['missed', 'canceled']) {
    const a = mk(3, { pipelineId: pipe('done') });
    setTicket(tickets(a.id)[1].ticket_id, ts);
    const v = featureView(a.id);
    assert.deepEqual(v.halted, { index: 2, state: ts, waiting: [3] }, ts);
  }
});

test('the chain cascade: a stopped slice makes every later ticket missed', async () => {
  const a = mk(4, { pipelineId: pipe('running') });
  setPipe(a.pid, 'stopped');
  await settle();
  const v = featureView(a.id);
  assert.deepEqual(v.slices.map((s) => s.state), ['stopped', 'missed', 'missed', 'missed']);
  assert.deepEqual(v.halted, { index: 1, state: 'stopped', waiting: [2, 3, 4] });
});

test('cancelRest cancels scheduled and missed tickets, leaves a fired one, sets canceled', () => {
  const a = mk(4);
  const [, r2, r3, r4] = tickets(a.id);
  setTicket(r2.ticket_id, 'fired');
  setTicket(r3.ticket_id, 'missed');
  const res = cancelRest(a.id, { by: 'ann' });
  assert.deepEqual(res, { canceled: 2 });
  assert.equal(getTicket(r2.ticket_id).status, 'fired');
  assert.equal(getTicket(r3.ticket_id).status, 'canceled');
  assert.equal(getTicket(r4.ticket_id).status, 'canceled');
  assert.equal(featureView(a.id).status, 'canceled');
  assert.equal(cancelRest('missing'), null);
});

test('resume / replan / cancel refuse a feature that is not active', () => {
  for (const st of ['canceled', 'replanned', 'replanning']) {
    const a = mk(2, { pipelineId: pipe('stopped') });
    getDb().prepare('UPDATE shape_features SET status = ? WHERE id = ?').run(st, a.id);
    const want = { status: 409, error: `this feature is ${st}` };
    assert.deepEqual(resumeFeature(a.id), want, st);
    assert.deepEqual(replanRest(a.id), want, st);
    assert.deepEqual(cancelRest(a.id), want, st);
  }
  assert.equal(resumeFeature('missing'), null);
  assert.equal(replanRest('missing'), null);
});

test('resumeFeature: paused and interrupted give resume; nothing halted gives none', () => {
  for (const ps of ['paused', 'interrupted']) {
    const a = mk(2, { pipelineId: pipe(ps), base: { mock: true } });
    assert.deepEqual(resumeFeature(a.id), { action: 'resume', pipelineId: a.pid, index: 1, mock: true }, ps);
  }
  const b = mk(2, { pipelineId: pipe('running') });
  assert.deepEqual(resumeFeature(b.id, { live: () => ({ runId: 'r', status: 'running', approved: true }) }), { action: 'none' });
  const c = mk(2, { pipelineId: pipe('paused') });
  assert.equal(resumeFeature(c.id).mock, false);
});

test('rechainWaiting (F30): missed tickets after a resumed interrupted slice go back to scheduled with their own ref', async () => {
  const a = mk(4, { pipelineId: pipe('done') });
  const [, r2, r3, r4] = tickets(a.id);
  const p2 = pipe('interrupted');
  setTicket(r2.ticket_id, 'fired', { pipelineId: p2 });
  setTicket(r3.ticket_id, 'missed');
  setTicket(r4.ticket_id, 'missed');
  const afterOf = (id) => getTicket(id).after;
  const orig3 = afterOf(r3.ticket_id);
  const orig4 = afterOf(r4.ticket_id);
  setPipe(p2, 'running');   // the resume
  assert.equal(rechainWaiting(a.id, 2), 2);
  for (const t of [r3.ticket_id, r4.ticket_id]) assert.equal(getTicket(t).status, 'scheduled');
  assert.deepEqual(afterOf(r3.ticket_id), orig3);
  assert.deepEqual(afterOf(r4.ticket_id), orig4);
  await settle();
  assert.equal(getTicket(r3.ticket_id).status, 'scheduled');
  assert.equal(getTicket(r4.ticket_id).status, 'scheduled');
});

test('resumeFeature: a stopped slice 2 is restarted as a new ticket and the waiting slices are re-chained', () => {
  const a = mk(4, { pipelineId: pipe('done') });
  const [, r2, r3, r4] = tickets(a.id);
  const p2 = pipe('stopped');
  setTicket(r2.ticket_id, 'fired', { pipelineId: p2 });
  setTicket(r3.ticket_id, 'missed');
  setTicket(r4.ticket_id, 'missed');
  const res = resumeFeature(a.id, { by: 'ann' });
  assert.equal(res.action, 'restart');
  const nt = getTicket(res.ticketId);
  assert.deepEqual(nt.after, { kind: 'pipeline', id: a.pid, policy: 'done' });
  assert.equal(nt.sourceFromPrevious, true);
  assert.equal(nt.status, 'scheduled');
  const rows = tickets(a.id);
  assert.equal(rows[1].ticket_id, res.ticketId);
  assert.equal(rows[1].pipeline_id, null);
  assert.deepEqual(getTicket(r3.ticket_id).after, { kind: 'ticket', id: res.ticketId, policy: 'done' });
  assert.equal(getTicket(r3.ticket_id).status, 'scheduled');
  assert.deepEqual(getTicket(r4.ticket_id).after, { kind: 'ticket', id: r3.ticket_id, policy: 'done' });
  assert.equal(getTicket(r4.ticket_id).status, 'scheduled');
});

test('resumeFeature: a stopped slice 1 gives a timed ticket on the stored source branch, also when its row has no pipeline', () => {
  const a = mk(3, { pipelineId: pipe('stopped'), base: { model: 'm' } });
  const res = resumeFeature(a.id, { by: 'ann', now: Date.now() });
  assert.equal(res.action, 'restart');
  const t = getTicket(res.ticketId, { withRequest: true });
  assert.equal(t.after, null);
  assert.equal(t.request.sourceBranch, 'main');
  assert.equal(t.request.shape.slice.index, 1);
  assert.equal(t.request.internal.model, 'm');
  // the slice-1 row now follows the new ticket, with no pipeline of its own
  assert.equal(tickets(a.id)[0].pipeline_id, null);
  assert.equal(featureView(a.id).slices[0].state, 'planned');
  // its restart ticket failed before it got a pipeline: still a halted slice 1, still restartable
  setTicket(res.ticketId, 'failed');
  assert.equal(featureView(a.id).halted.index, 1);
  const again = resumeFeature(a.id);
  assert.equal(again.action, 'restart');
  assert.equal(getTicket(again.ticketId, { withRequest: true }).request.sourceBranch, 'main');
});

test('resumeFeature: a missed slice 2 behind a done slice 1 is restarted after slice 1', () => {
  const a = mk(2, { pipelineId: pipe('done') });
  setTicket(tickets(a.id)[1].ticket_id, 'missed');
  const res = resumeFeature(a.id);
  assert.equal(res.action, 'restart');
  assert.deepEqual(getTicket(res.ticketId).after, { kind: 'pipeline', id: a.pid, policy: 'done' });
});

test('resumeFeature: a halted slice 3 whose slice 2 never got a pipeline answers 409 and creates no ticket (F43)', () => {
  // slice 2 was started early (fired, no pipeline yet) and slice 3 failed: slice 3 is the halt, its predecessor never ran
  const a = mk(3, { pipelineId: pipe('done') });
  const [, r2, r3] = tickets(a.id);
  setTicket(r2.ticket_id, 'fired');
  setTicket(r3.ticket_id, 'failed');
  const n = countTickets();
  const res = resumeFeature(a.id);
  assert.equal(res.status, 409);
  assert.match(res.error, /slice 2 has not run yet/);
  assert.equal(countTickets(), n);
});

test('replanRest: cancels open tickets, queues a slicing-auto run from the last done slice, sets replanning', () => {
  const a = mk(3, { pipelineId: pipe('done') });
  const [, r2, r3] = tickets(a.id);
  const res = replanRest(a.id, { by: 'ann' });
  assert.ok(res.ticketId);
  assert.equal(getTicket(r2.ticket_id).status, 'canceled');
  assert.equal(getTicket(r3.ticket_id).status, 'canceled');
  const t = getTicket(res.ticketId, { withRequest: true });
  assert.equal(t.request.shape.replaces, a.id);
  assert.equal(t.request.shape.slices, 'auto');
  assert.equal(t.request.sourceBranch, `feat/${a.pid}`);
  assert.equal(t.request.internal.startedBy, 'ann');
  const f = getDb().prepare('SELECT status, replan_ticket_id FROM shape_features WHERE id = ?').get(a.id);
  assert.deepEqual({ ...f }, { status: 'replanning', replan_ticket_id: res.ticketId });
  // the view links to the re-plan run
  let v = featureView(a.id);
  assert.equal(v.status, 'replanning');
  assert.deepEqual(v.replan, { ticketId: res.ticketId, pipelineId: null, runId: null });
  const rp = pipe('running');
  setTicket(res.ticketId, 'fired', { pipelineId: rp });
  v = featureView(a.id, { live: (p) => (p === rp ? { runId: 'run-9', status: 'running' } : null) });
  assert.deepEqual(v.replan, { ticketId: res.ticketId, pipelineId: rp, runId: 'run-9' });
  // when the re-plan's outline is approved, the new feature marks the old one replanned
  const b = createSliceFeature({ pipelineId: rp, projectDir: root, title: 'Charts', outline: outlineOf(2), perspectives: [],
    workflowId: 'wf_shape', replaces: a.id });
  const old = getDb().prepare('SELECT status, replaced_by FROM shape_features WHERE id = ?').get(a.id);
  assert.deepEqual({ ...old }, { status: 'replanned', replaced_by: b.id });
});

test('replanRest with nothing done starts from the stored source branch', () => {
  const a = mk(2, { pipelineId: pipe('stopped') });
  const res = replanRest(a.id);
  assert.equal(getTicket(res.ticketId, { withRequest: true }).request.sourceBranch, 'main');
});

test('replanRest refusals answer 409 and cancel nothing', () => {
  // pending merge-back on the last done slice
  const pending = pipe('done', { branch: { sameAsSource: true, worktreeDir: '/tmp/x', source: 'main', feature: 'main' } });
  const a = mk(2, { pipelineId: pending });
  let r = replanRest(a.id);
  assert.equal(r.status, 409);
  assert.match(r.error, /still merging/);
  assert.equal(getTicket(tickets(a.id)[1].ticket_id).status, 'scheduled');
  // no branch to start from
  const nob = pipe('done');
  getDb().prepare('UPDATE pipelines SET branch = NULL WHERE id = ?').run(nob);
  const b = mk(2, { pipelineId: nob });
  r = replanRest(b.id);
  assert.equal(r.status, 409);
  assert.match(r.error, /no branch to start from/);
  assert.equal(getTicket(tickets(b.id)[1].ticket_id).status, 'scheduled');
  // a slice still going
  for (const l of [{ runId: 'r', status: 'running', approved: true }, { runId: 'r', status: 'running', waiting: true }]) {
    const c = mk(2, { pipelineId: pipe('running') });
    r = replanRest(c.id, { live: () => l });
    assert.equal(r.status, 409);
    assert.match(r.error, /Slice 1 is still going/);
    assert.equal(getTicket(tickets(c.id)[1].ticket_id).status, 'scheduled');
    assert.equal(getDb().prepare('SELECT status FROM shape_features WHERE id = ?').get(c.id).status, 'active');
  }
});

test('stackedPrBase', () => {
  const a = mk(2, { pipelineId: pipe('done') });
  const p2 = pipe('running');
  setTicket(tickets(a.id)[1].ticket_id, 'fired', { pipelineId: p2 });
  const chain = ['main', `feat/${a.pid}`];
  const setPr = (pid, state) => getDb().prepare('UPDATE pipelines SET pr_url = ?, pr_state = ? WHERE id = ?').run('https://x/pr/1', state, pid);
  setPr(a.pid, 'OPEN');
  assert.equal(stackedPrBase(p2, chain), `feat/${a.pid}`);
  setPr(a.pid, 'MERGED');
  assert.equal(stackedPrBase(p2, chain), null);
  assert.equal(stackedPrBase(a.pid, chain), null, 'slice 1');
  assert.equal(stackedPrBase(p2, ['main']), null, 'a chain of 1');
  assert.equal(stackedPrBase(p2, null), null);
  assert.equal(stackedPrBase('unknown', chain), null);
});

test('featureOfPipeline: slice 1 by row, later slices through their ticket, active wins over replanned', () => {
  const a = mk(3);
  assert.deepEqual({ ...featureOfPipeline(a.pid) }, { featureId: a.id, idx: 1 });
  const p3 = pipe('running');
  setTicket(tickets(a.id)[2].ticket_id, 'fired', { pipelineId: p3 });
  assert.deepEqual({ ...featureOfPipeline(p3) }, { featureId: a.id, idx: 3 });
  assert.equal(featureOfPipeline('nope'), null);
  // a replanned feature shares slice 1's pipeline with the active one
  const b = mk(2, { pipelineId: a.pid });
  assert.equal(featureOfPipeline(a.pid).featureId, b.id);
});

test('origin after a slice-1 restart (F48)', () => {
  const a = mk(2, { pipelineId: pipe('stopped') });
  const first = a.pid;
  const res = resumeFeature(a.id);
  assert.equal(res.action, 'restart');
  assert.equal(tickets(a.id)[0].pipeline_id, null);
  assert.deepEqual({ ...featureOfPipeline(first) }, { featureId: a.id, idx: 1 });
  recordShapePlan({ threadId: 'ask_1', cardId: 'c1', title: 'Charts' });
  getDb().prepare("INSERT INTO ask_threads (id, title, created_at, updated_at) VALUES ('ask_1', 'T', 'now', 'now')").run();
  getDb().prepare("INSERT INTO ask_run_links (thread_id, run_id, pipeline_id, card_id, status, created_at) VALUES ('ask_1', 'run1', ?, 'c1', 'stopped', 'now')").run(first);
  assert.equal(listShapePlans().find((r) => r.threadId === 'ask_1').featureId, a.id);
  // once the new ticket has a pipeline
  const np = pipe('running');
  setTicket(res.ticketId, 'fired', { pipelineId: np });
  assert.deepEqual({ ...featureOfPipeline(np) }, { featureId: a.id, idx: 1 });
  // the crash re-offer finds the feature through its origin
  const b = createSliceFeature({ pipelineId: first, projectDir: root, title: 'Charts', outline: outlineOf(2), perspectives: [], workflowId: 'wf_shape' });
  assert.equal(getDb().prepare('SELECT status FROM shape_features WHERE id = ?').get(a.id).status, 'replanned');
  assert.equal(retireFeaturesOf(first), 1);
  assert.equal(getDb().prepare('SELECT status FROM shape_features WHERE id = ?').get(b.id).status, 'canceled');
});

test('currentFeatureId follows replaced_by, stops on a loop', () => {
  const set = (id, to) => getDb().prepare('UPDATE shape_features SET replaced_by = ? WHERE id = ?').run(to, id);
  const a = mk(2); const b = mk(2); const c = mk(2);
  assert.equal(currentFeatureId(a.id), a.id);
  set(a.id, b.id); set(b.id, c.id);
  assert.equal(currentFeatureId(a.id), c.id);
  assert.equal(currentFeatureId('unknown'), 'unknown');
  set(c.id, a.id);   // a loop
  const r = currentFeatureId(a.id);
  assert.ok([a.id, b.id, c.id].includes(r));
});

test('featuresOfTickets', () => {
  const a = mk(3);
  const ids = tickets(a.id).map((r) => r.ticket_id).filter(Boolean);
  assert.deepEqual(featuresOfTickets([]), []);
  assert.deepEqual(featuresOfTickets(ids), [a.id]);
  assert.deepEqual(featuresOfTickets(['nope']), []);
});

test('earlierSliceChanges: results.json files (25-file cap) and the highest impl review summary (F31)', async () => {
  const pid = pipe('done');
  const a = mk(3, { pipelineId: pid });
  const many = Array.from({ length: 30 }, (_, i) => ({ path: `src/f${i}.mjs` }));
  const { runDirForRow } = await import('../src/core/artifacts.mjs');
  // results.json goes where the run's own dir lookup finds it
  const row = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get(pid);
  const real = await runDirForRow(row);
  mkdirSync(real, { recursive: true });
  writeFileSync(join(real, 'results.json'), JSON.stringify({ newFiles: many.slice(0, 10), changedFiles: many.slice(10) }));
  await writeReview(pid, 'refine', 1, { summary: 'refine one', issues: [] });
  await writeReview(pid, 'impl', 1, { summary: 'impl one', issues: [] });
  await writeReview(pid, 'impl', 2, { summary: 'impl two', issues: [] });
  await writeReview(pid, 'plan', 1, { summary: 'plan one', issues: [] });
  await writeReview(pid, 'webui', 1, { summary: 'webui one', issues: [] });
  const out = await earlierSliceChanges(a.id, 3);
  assert.equal(out.length, 1);
  assert.equal(out[0].index, 1);
  assert.equal(out[0].summary, 'impl two');
  assert.equal(out[0].files.length, 25);
  assert.equal(out[0].more, 5);
  assert.deepEqual(await earlierSliceChanges(a.id, 1), []);
});

test('listShapePlans joins the link row, the pipelines status and title, and the feature id, newest first', () => {
  const pid = pipe('running', { title: 'The run title' });
  const a = mk(2, { pipelineId: pid });
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO ask_threads (id, title, created_at, updated_at) VALUES ('ask_a', 'Thread A', 'now', 'now')").run();
  recordShapePlan({ threadId: 'ask_a', cardId: 'ca', title: 'Launch title', now: Date.parse('2026-10-01T00:00:00Z') });
  recordShapePlan({ threadId: 'ask_a', cardId: 'ca', title: 'ignored dup' });
  recordShapePlan({ threadId: 'ask_a', cardId: 'cb', title: 'Newer, no link', now: Date.parse('2026-10-02T00:00:00Z') });
  db.prepare("INSERT INTO ask_run_links (thread_id, run_id, pipeline_id, card_id, status, created_at) VALUES ('ask_a', 'run-a', ?, 'ca', 'running', 'now')").run(pid);
  const rows = listShapePlans().filter((r) => r.threadId === 'ask_a');
  assert.equal(rows.length, 2, 'one row per plan');
  assert.equal(rows[0].cardId, 'cb');
  assert.equal(rows[0].featureId, null);
  assert.equal(rows[0].title, 'Newer, no link');
  const r = rows[1];
  assert.equal(r.title, 'The run title');
  assert.equal(r.runId, 'run-a');
  assert.equal(r.pipelineId, pid);
  assert.equal(r.linkStatus, 'running');
  assert.equal(r.pipelineStatus, 'running');
  assert.equal(r.threadTitle, 'Thread A');
  assert.equal(r.featureId, a.id);
  assert.equal(listShapePlans({ limit: 1 }).length, 1);
});
