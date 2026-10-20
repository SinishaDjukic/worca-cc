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
import { writeReview, writeClarify, appendAuditById } from '../src/core/artifacts.mjs';
import { createThread, linkRun } from '../src/core/ask/store.mjs';
import { getTicket, runDueTickets, updateTicket } from '../src/core/scheduler.mjs';
import { insertRunTags } from '../src/core/run-tags-store.mjs';
import { editRunLabels } from '../src/core/run-labels-store.mjs';
import {
  createSliceFeature, retireFeaturesOf, sliceRequest, sliceTitle, featureView, currentFeatureId, featureOfPipeline,
  earlierSliceChanges, cancelRest, resumeFeature, rechainWaiting, replanRest, setApproveEach, featureApprovesEach,
  stackedPrBase, recordShapePlan, listShapePlans, featuresOfTickets, featureClarify, chainFeature, sliceOfPipeline, slicePrPreamble,
  recordShip, recordSliceDraft, featureShipSuggestion, featureShipInput, ONE_PR_MAX_LINES,
  liveSliceFrom, shaperCard, featureThread,
  addFeatureNote, featureNotes, appendFeatureRun, featureBase, liveRoundOf,
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
  // Review D: "Run 2 · Pin charts"; the feature name lives in the run's "Part of …" row. The slice title clips at 40.
  assert.equal(sliceTitle('Charts', 2, 3, { title: 'Pin' }), 'Run 2 · Pin');
  const long = sliceTitle('Charts', 5, 5, { title: 'Customer perspective upgrade safety '.repeat(4).trim() });
  assert.ok(long.startsWith('Run 5 · ') && long.length <= 'Run 5 · '.length + 40, long);
  assert.equal(sliceTitle('Charts', 2, 3, { title: '' }), 'Run 2 · slice 2');
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
  assert.equal(t2.title, 'Run 2 · Slice 2');
  assert.equal(t3.title, 'Run 3 · Slice 3');
  const f = getDb().prepare('SELECT * FROM shape_features WHERE id = ?').get(id);
  assert.equal(f.status, 'active');
  assert.equal(f.origin_pipeline_id, pid);
  assert.equal(f.source_branch, 'main');
  assert.equal(f.approve_each, 0, 'D19: Approve each is off unless chosen');
  assert.equal(f.created_by, 'ann');
  const on = mk(2, { approveEach: true });
  assert.equal(getDb().prepare('SELECT approve_each FROM shape_features WHERE id = ?').get(on.id).approve_each, 1);
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
  assert.equal(r.title, 'Run 2 · Slice 2');
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

test('featureClarify: the origin run\'s clarify row, null when it has none', async () => {
  const { id, pid } = mk(3);
  assert.equal(featureClarify(id), null);
  await writeClarify(pid, { questions: { questions: [{ id: 'q1', question: 'Where?', options: ['A', 'B'] }] },
    answers: { answers: [{ id: 'q1', question: 'Where?', choice: 'B' }], answeredBy: 'local' } });
  const c = featureClarify(id);
  assert.equal(c.answers.answers[0].choice, 'B');
  assert.equal(featureClarify('feat_missing'), null);
});

test('chainFeature: the feature of a chain whose first run is slice 1; null for a plain chain', () => {
  const { id, pid } = mk(3);
  // tickets(id) returns shape_feature_slices rows: row 0 is slice 1 (ticket_id null), row 1 is slice 2.
  const members = [{ pipelineId: pid, ticketId: null }, { pipelineId: null, ticketId: tickets(id)[1].ticket_id }];
  const f = chainFeature(members);
  assert.equal(f.id, id);
  assert.equal(f.title, 'Charts');
  assert.deepEqual(f.slices.map((s) => [s.index, s.title]), [[1, 'Slice 1'], [2, 'Slice 2'], [3, 'Slice 3']]);
  assert.equal(f.slices[1].ticketId, tickets(id)[1].ticket_id);
  assert.equal(f.slices[0].pipelineId, pid);
  assert.equal(chainFeature([{ pipelineId: 'p-plain' }]), null);
  assert.equal(chainFeature([]), null);
  assert.equal(chainFeature(null), null);
  // A chain whose first member is slice 2's ticket (slice 1 already left the chain view) still resolves.
  assert.equal(chainFeature([{ pipelineId: null, ticketId: tickets(id)[1].ticket_id }]).id, id);
});

test('sliceOfPipeline: where a run sits in its feature; null for a plain run', () => {
  const { id, pid } = mk(3);
  assert.deepEqual(sliceOfPipeline(pid), { featureId: id, title: 'Charts', index: 1, total: 3, sliceTitle: 'Slice 1',
    state: 'starting', next: { index: 2, title: 'Slice 2', state: 'planned' } });
  assert.equal(sliceOfPipeline('p-plain'), null);
});

test('slicePrPreamble: "Part of" line and the other slices\' PRs', () => {
  const { pid, id } = mk(3);
  const p2 = pipe('done');
  getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = 2').run(p2, id);
  getDb().prepare('UPDATE pipelines SET pr_url = ?, pr_state = ? WHERE id = ?').run('https://github.com/o/r/pull/2', 'OPEN', p2);
  const text = slicePrPreamble(pid);
  assert.match(text, /^Part of Charts: slice 1 of 3\n\n/);
  assert.match(text, /- Slice 2, Slice 2: https:\/\/github\.com\/o\/r\/pull\/2/);
  assert.match(text, /- Slice 3, Slice 3: not opened yet/);
  assert.doesNotMatch(text, /- Slice 1,/);
  assert.equal(slicePrPreamble('p-plain'), '');
});

test('featureApprovesEach / setApproveEach', () => {
  const a = mk(2, { approveEach: true });
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

test('replanRest after a stopped run: the log names it with the canceled ones, every run after the last done', () => {
  const a = mk(3, { pipelineId: pipe('done') });
  setTicket(tickets(a.id)[1].ticket_id, 'fired', { pipelineId: pipe('stopped') });
  replanRest(a.id);
  const v = featureView(a.id);
  assert.deepEqual(v.slices.map((s) => s.state), ['done', 'stopped', 'canceled']);
  assert.deepEqual([v.log.at(-1).text, v.log.at(-1).detail], ['Re-planning runs 2–3', ['2 · Slice 2', '3 · Slice 3']]);
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

// ---- D24: Ship as (the ship state on the feature, the draft label, the suggestion) ----------------------------------

/** A feature of `n` slices, every slice done as its own pipeline. */
const doneFeature = (n = 2) => {
  const pids = [pipe('done')];
  const f = mk(n, { pipelineId: pids[0] });
  for (let i = 2; i <= n; i++) {
    const p = pipe('done');
    pids.push(p);
    getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = ?').run(p, f.id, i);
  }
  return { ...f, pids };
};
const seedResults = async (pid, results) => {
  const { runDirForRow } = await import('../src/core/artifacts.mjs');
  const real = await runDirForRow(getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get(pid));
  mkdirSync(real, { recursive: true });
  writeFileSync(join(real, 'results.json'), JSON.stringify(results));
};

test('featureView ship: ready only once every slice is done; recordShip sets the mode once', () => {
  const half = mk(2);
  assert.equal(featureView(half.id).ship.ready, false, 'slice 2 still planned');
  const f = doneFeature(2);
  const v = featureView(f.id);
  assert.equal(v.status, 'done');
  assert.deepEqual(v.ship, { ready: true, mode: null, prUrl: null, lastPrUrl: null, suggested: null, linesAdded: null,
    linesRemoved: null, files: null, release: null, result: null });
  assert.equal(recordShip(f.id, { mode: 'one', prUrl: 'https://github.com/o/r/pull/9' }), true);
  const shipped = featureView(f.id);
  assert.equal(shipped.ship.ready, false);
  assert.equal(shipped.ship.mode, 'one');
  assert.equal(shipped.ship.prUrl, 'https://github.com/o/r/pull/9');
  assert.equal(recordShip(f.id, { mode: 'stacked' }), false, 'no overwrite');
  assert.equal(featureView(f.id).ship.mode, 'one');
});

test('pr.draft: true after recordSliceDraft with the recorded PR url; false for another url and once shipped', () => {
  const f = doneFeature(2);
  const url = 'https://github.com/o/r/pull/3';
  getDb().prepare('UPDATE pipelines SET pr_url = ?, pr_state = ? WHERE id = ?').run(url, 'OPEN', f.pids[0]);
  assert.equal(featureView(f.id).slices[0].pr.draft, false);
  assert.equal(recordSliceDraft(f.pids[0], url), true);
  assert.equal(featureView(f.id).slices[0].pr.draft, true);
  assert.equal(featureView(f.id).slices[1].pr, null);
  recordSliceDraft(f.pids[0], 'https://github.com/o/r/pull/99');
  assert.equal(featureView(f.id).slices[0].pr.draft, false);
  recordSliceDraft(f.pids[0], url);
  recordShip(f.id, { mode: 'stacked' });
  assert.equal(featureView(f.id).slices[0].pr.draft, false);
  assert.equal(recordSliceDraft('p-plain', url), false);
});

test('featureShipSuggestion: one PR under the line limit, stacked from it; a slice with no results counts 0', async () => {
  assert.equal(ONE_PR_MAX_LINES, 1500);
  const small = doneFeature(2);
  await seedResults(small.pids[0], { summary: { linesAdded: 840 } });
  assert.deepEqual(await featureShipSuggestion(featureView(small.id)), { suggested: 'one', linesAdded: 840, linesRemoved: 0, files: 0 });
  const big = doneFeature(2);
  await seedResults(big.pids[0], { summary: { linesAdded: 1200 } });
  await seedResults(big.pids[1], { summary: { linesAdded: 800 } });
  assert.deepEqual(await featureShipSuggestion(featureView(big.id)), { suggested: 'stacked', linesAdded: 2000, linesRemoved: 0, files: 0 });
});

test('featureShipSuggestion (s4): lines removed and files (new + changed) summed across the runs', async () => {
  const f = doneFeature(2);
  await seedResults(f.pids[0], { summary: { linesAdded: 500, linesRemoved: 80, filesNew: 2, filesChanged: 5, filesDeleted: 1 } });
  await seedResults(f.pids[1], { summary: { linesAdded: 340, linesRemoved: 40, filesChanged: 5 } });
  assert.deepEqual(await featureShipSuggestion(featureView(f.id)), { suggested: 'one', linesAdded: 840, linesRemoved: 120, files: 12 });
});

test('recordShip with a release (s4): version and target stored; ship.release and ship.result in the view', () => {
  const f = doneFeature(3);
  f.pids.forEach((p, i) => getDb().prepare("UPDATE pipelines SET pr_url = ?, pr_state = 'CLOSED' WHERE id = ?").run(`https://github.com/o/r/pull/${i + 1}`, p));
  assert.equal(featureView(f.id).ship.lastPrUrl, 'https://github.com/o/r/pull/3');
  // The one PR opens on the last slice's row, so that row no longer reads CLOSED: the count is the one recorded.
  getDb().prepare("UPDATE pipelines SET pr_url = 'https://github.com/o/r/pull/9', pr_state = 'OPEN' WHERE id = ?").run(f.pids[2]);
  assert.equal(recordShip(f.id, { mode: 'one', prUrl: 'https://github.com/o/r/pull/9', closed: 3, release: { version: 'v1.12.0', target: 'main' } }), true);
  const row = getDb().prepare('SELECT release_version, release_target FROM shape_features WHERE id = ?').get(f.id);
  assert.deepEqual({ ...row }, { release_version: 'v1.12.0', release_target: 'main' });
  const v = featureView(f.id);
  assert.deepEqual(v.ship.release, { version: 'v1.12.0', url: null, error: null });
  assert.deepEqual(v.ship.result, { mode: 'one', prUrl: 'https://github.com/o/r/pull/9', closed: 3,
    release: { version: 'v1.12.0', url: null, error: null } });
  const s = doneFeature(2);
  s.pids.forEach((p, i) => getDb().prepare("UPDATE pipelines SET pr_url = ?, pr_state = 'OPEN' WHERE id = ?").run(`https://github.com/o/r/pull/${i + 20}`, p));
  recordShip(s.id, { mode: 'stacked' });
  assert.deepEqual(featureView(s.id).ship.result, { mode: 'stacked', prUrl: 'https://github.com/o/r/pull/21', closed: 0, release: null });
});

test('featureShipInput: per slice its summary (capped at 600) and its checklist markdown', async () => {
  const f = doneFeature(2);
  await writeReview(f.pids[0], 'impl', 1, { summary: 'x'.repeat(700), issues: [] });
  await writeReview(f.pids[1], 'impl', 1, { summary: 'Second. More text.', issues: [],
    checklist: [{ id: 'product-1', perspective: 'product', text: 'It works', status: 'pass', note: '' }] });
  const input = await featureShipInput(featureView(f.id));
  assert.equal(input.id, f.id);
  assert.equal(input.title, 'Charts');
  assert.deepEqual(input.slices.map((s) => [s.index, s.title, s.pipelineId]), [[1, 'Slice 1', f.pids[0]], [2, 'Slice 2', f.pids[1]]]);
  assert.equal(input.slices[0].summary.length, 600);
  assert.equal(input.slices[0].checklistMd, '');
  assert.equal(input.slices[1].summary, 'Second. More text.');
  assert.match(input.slices[1].checklistMd, /product-1/);
  assert.ok(Object.hasOwn(input.slices[1], 'pr'));
});

test('liveSliceFrom: plan ask → waiting, other ask → asking, and the ask named with its kind (outline for a Split)', () => {
  assert.deepEqual(liveSliceFrom({ runId: 'r', status: 'running', pendingQuestion: { id: 'plan-n_refine-1', kind: 'plan', plan: {} } }),
    { runId: 'r', status: 'running', waiting: true, asking: false, approved: false, ask: { id: 'plan-n_refine-1', kind: 'plan' } });
  assert.equal(liveSliceFrom({ runId: 'r', status: 'running', pendingQuestion: { id: 'o', kind: 'plan', plan: { outline: { slices: [] } } } }).ask.kind, 'outline');
  assert.deepEqual(liveSliceFrom({ runId: 'r', status: 'running', pendingQuestion: { id: 'g', kind: 'gate' } }).ask, { id: 'g', kind: 'gate' });
  assert.equal(liveSliceFrom({ runId: 'r', status: 'running', approved: { round: 1 } }).ask, null);
});

test('featureView: originPipelineId, the first asking slice as ask, and the log from the audit lines', async () => {
  const { id, pid } = mk(3);
  await writeClarify(pid, { questions: { questions: [{ id: 'q1', question: 'Where?' }, { id: 'q2', question: 'How?' }] },
    answers: { answers: [{ id: 'q1', choice: 'Redis' }, { id: 'q2', choice: 'JSON' }] } });
  appendAuditById(pid, 'Slice outline **approve** (round 1).');
  appendAuditById(pid, 'Plan approval **approve**.');
  const pid2 = pipe('running');
  setTicket(getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(id).ticket_id, 'fired', { pipelineId: pid2 });
  const live = (p) => (p === pid2 ? liveSliceFrom({ runId: 'r2', status: 'running', pendingQuestion: { id: 'plan-n_refine-1', kind: 'plan', plan: {} } }) : null);
  const v = featureView(id, { live });
  assert.equal(v.originPipelineId, pid);
  assert.deepEqual(v.ask, { index: 2, runId: 'r2', pipelineId: pid2, id: 'plan-n_refine-1', kind: 'plan' });
  assert.deepEqual(v.log.map((l) => [l.run, l.text]), [[null, 'Clarify · 2 answers'], [null, 'Split into 3 runs'], [1, 'Plan approved']]);
});

test('shaperCard: null for an unknown or unshaped run, the shaped run\'s own log before a split, the feature after it', async () => {
  assert.equal(shaperCard('p-nope'), null);
  const solo = pipe('running');
  appendAuditById(solo, 'Plan approval **revise**.');
  appendAuditById(solo, 'Plan approval **approve**.');
  assert.equal(shaperCard(solo), null, 'in no feature and not a live shaped run: a plain run card');
  assert.deepEqual(shaperCard(solo, { shaped: (p) => p === solo }),
    { pipelineId: solo, feature: null, log: [{ key: 'p-1', run: null, text: 'Plan approved · after 1 round of changes', detail: [] }] });
  const { id, pid } = mk(2);
  const c = shaperCard(pid);                         // a feature needs no live entry (restart, pre-upgrade rows)
  assert.equal(c.feature.id, id);
  assert.equal(c.log, c.feature.log);
});

test('featureThread: the origin\'s link row; a re-planned feature walks replaces back; null without a link', () => {
  const { id, pid } = mk(2);
  assert.equal(featureThread(id), null);
  const t = createThread({ title: 'charts' });
  linkRun(t.id, { runId: 'run-uuid-x', pipelineId: pid, cardId: 'card_x' });
  assert.deepEqual(featureThread(id), { threadId: t.id, cardId: 'card_x' });
  const pidR = pipe('running');
  const r = mk(2, { pipelineId: pidR, replaces: id });
  assert.deepEqual(featureThread(r.id), { threadId: t.id, cardId: 'card_x' });
});

// ---- Shaper s5: notes, appended runs, live rounds -----------------------------------------------------------------

/** A 3-run feature: run 1 done, run 2 running, run 3 planned (or every run done). */
const three = ({ allDone = false } = {}) => {
  const f = doneFeature(3);
  if (!allDone) {
    setPipe(f.pids[1], 'running');
    getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = NULL WHERE feature_id = ? AND idx = 3').run(f.id);
    setTicket(tickets(f.id)[2].ticket_id, 'scheduled');
  }
  return f;
};

test('s5: addFeatureNote targets the next run not started; featureNotes lists it for that run only', () => {
  const { id } = three();                                      // run 2 running, run 3 planned
  assert.equal(addFeatureNote(id, { kind: 'plan', text: 'make the legend smaller' }).runIndex, 3);
  addFeatureNote(id, { kind: 'idea', text: 'export as PNG' });
  assert.deepEqual(featureNotes(id, 3).map((n) => [n.kind, n.text]), [['plan', 'make the legend smaller'], ['idea', 'export as PNG']]);
  assert.deepEqual(featureNotes(id, 2), []);
  assert.equal(featureView(id).notes.ideas, 1);
});

test('s5: a plan note with no run left to plan stores nothing (an idea still keeps run_index NULL)', () => {
  const { id } = three({ allDone: true });
  assert.deepEqual(addFeatureNote(id, { kind: 'plan', text: 'too late' }), { id: null, runIndex: null });
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM shape_feature_notes WHERE feature_id = ? AND kind = 'plan'").get(id).n, 0);
  assert.equal(addFeatureNote(id, { kind: 'idea', text: 'later' }).runIndex, null);
});

test('s5: appendFeatureRun(extra) adds run 4 after run 3; the outline grows; held notes move to it', () => {
  const { id, pids } = three({ allDone: true });
  addFeatureNote(id, { kind: 'idea', text: 'later' });          // no run left: run_index NULL
  const r = appendFeatureRun(id, { title: 'Bigger legend', goal: 'make the legend smaller', kind: 'extra' });
  assert.equal(r.index, 4);
  const v = featureView(id);
  assert.equal(v.total, 4);
  assert.equal(v.slices[3].kind, 'extra');
  const t = getTicket(r.ticketId, { withRequest: true });     // .request is only there with withRequest
  assert.equal(t.request.shape.slice.total, 4);
  assert.equal(t.request.sourceBranch, undefined, 'sourceFromPrevious: the branch comes at fire time');
  assert.deepEqual([t.after.kind, t.after.id], ['pipeline', pids[2]]);   // after also carries policy
  assert.equal(featureNotes(id, 4).length, 1);
});

test('s5: appendFeatureRun(follow-up) fires from the feature base with no predecessor', () => {
  const { id } = three({ allDone: true });
  getDb().prepare("UPDATE shape_features SET source_branch = 'dev' WHERE id = ?").run(id);   // nullable in seeds
  const r = appendFeatureRun(id, { title: 'Follow-up: blue bars', goal: 'make the bars blue', kind: 'follow-up' });
  const t = getTicket(r.ticketId, { withRequest: true });
  assert.equal(featureBase(id), 'dev');
  assert.equal(t.request.sourceBranch, 'dev');
  assert.equal(t.after, null);
  assert.equal(featureView(id).slices[3].kind, 'follow-up');
});

test('s5: a live round holds the Ship card back and is listed on its run', () => {
  const { id, pids } = three({ allDone: true });
  seedPipelineRow({ id: 'r0000002', status: 'running', branch: { source: 'feat/x', sameAsSource: true, roundOf: { pipelineId: pids[2], round: 2, request: 'blue' } } });
  const v = featureView(id);
  assert.deepEqual(v.slices[2].rounds.map((r) => r.round), [2]);
  assert.equal(v.ship.ready, false);
  assert.equal(liveRoundOf(id).pipelineId, 'r0000002');
});

test('s2: a follow-up slice and a re-plan carry the origin run\'s cost tags and labels in their request; an untagged origin adds none', () => {
  const pid = pipe('done');
  const f = createSliceFeature({ pipelineId: pid, projectDir: root, title: 'Charts', outline: outlineOf(2), perspectives: ['product'],
    workflowId: 'wf_shape', startedBy: 'ann', base: { mock: true } });
  insertRunTags(pid, ['client:acme']); editRunLabels(pid, ['hotfix']);
  const ap = appendFeatureRun(f.id, { title: 'more', goal: 'g', kind: 'follow-up' });
  const req = getTicket(ap.ticketId, { withRequest: true }).request;
  assert.deepEqual([req.tags, req.labels], [['client:acme'], ['hotfix']]);
  const extra = appendFeatureRun(f.id, { title: 'extra', goal: 'g', kind: 'extra' });   // chained: inherits at fire, not in the request
  assert.equal(Object.hasOwn(getTicket(extra.ticketId, { withRequest: true }).request, 'labels'), false);
  const bare = createSliceFeature({ pipelineId: pipe('done'), projectDir: root, title: 'Bare', outline: outlineOf(2), perspectives: ['product'],
    workflowId: 'wf_shape', startedBy: 'ann', base: { mock: true } });
  const req2 = getTicket(appendFeatureRun(bare.id, { title: 'more', goal: 'g', kind: 'follow-up' }).ticketId, { withRequest: true }).request;
  assert.deepEqual([Object.hasOwn(req2, 'tags'), Object.hasOwn(req2, 'labels')], [false, false]);
  // a re-plan with nothing done (as 'replanRest with nothing done …') carries them too
  const r = mk(2, { pipelineId: pipe('stopped') });
  insertRunTags(r.pid, ['client:acme']); editRunLabels(r.pid, ['hotfix']);
  const rq = getTicket(replanRest(r.id).ticketId, { withRequest: true }).request;
  assert.deepEqual([rq.tags, rq.labels], [['client:acme'], ['hotfix']]);
});

test('s2: a slice 1 restart (no predecessor) carries the origin run\'s cost tags and labels', () => {
  const a = mk(2, { pipelineId: pipe('stopped') });   // slice 1 is the origin run, stopped
  insertRunTags(a.pid, ['client:acme']); editRunLabels(a.pid, ['hotfix']);
  const res = resumeFeature(a.id);
  assert.equal(res.action, 'restart', JSON.stringify(res));
  const rq = getTicket(res.ticketId, { withRequest: true }).request;
  assert.deepEqual([rq.tags, rq.labels], [['client:acme'], ['hotfix']]);
});
