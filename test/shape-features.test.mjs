// test/shape-features.test.mjs — sliced features (src/core/shape/features.mjs): the durable record, the chained
// slice tickets, the feature view and its actions. Real DB through useTempHome, rows through seedPipelineRow.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replanBrief } from '../src/shared/shape/slices.mjs';
import { world } from './helpers/shape-sixteen-runs.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb, dbPath, SCHEMA_VERSION, _resetForTests } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { shaperSmallRunsOn } from '../src/core/shape/small-runs.mjs';
import { CRITERION_ID_RE } from '../src/shared/review/coverage.mjs';
import { careOfRow } from '../src/shared/shape/feature-record.mjs';
import { writeReview, writeClarify, appendAuditById, recordArtifact } from '../src/core/artifacts.mjs';
import { createThread, linkRun } from '../src/core/ask/store.mjs';
import { getTicket, runDueTickets, updateTicket, createTicket, requestRunNow } from '../src/core/scheduler.mjs';
import { insertRunTags } from '../src/core/run-tags-store.mjs';
import { editRunLabels } from '../src/core/run-labels-store.mjs';
import {
  createSliceFeature, retireFeaturesOf, sliceRequest, sliceTitle, featureView, currentFeatureId, featureOfPipeline,
  earlierSliceChanges, cancelRest, resumeFeature, rechainWaiting, replanRest, setApproveEach, featureHoldsTicket, ticketHeld,
  stackedPrBase, recordShapePlan, listShapePlans, featuresOfTickets, featureClarify, chainFeature, sliceOfPipeline, slicePrPreamble,
  recordShip, clearShip, recordSliceDraft, featureShipSuggestion, featureShipInput, ONE_PR_MAX_LINES,
  liveSliceFrom, shaperCard, featureThread, featureRootSource, sliceOfTicket, busySliceOf, sliceGateState,
  addFeatureNote, featureNotes, appendFeatureRun, featureBase, liveRoundOf, setFeatureAcceptance, chatShipCardOffered,
  changeAgreedRequirements, acceptanceRefusal, shipHold, carriedRequirements, storedAgentFacts,
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

test('setApproveEach stores the switch', () => {
  const a = mk(2, { approveEach: true });
  assert.equal(featureView(a.id).approveEach, true);
  assert.equal(setApproveEach(a.id, false), true);
  assert.equal(featureView(a.id).approveEach, false);
  assert.equal(setApproveEach('missing', true), false);
});

// "Ask me before each run": a fired-and-done slice 1 and a slice 2 ticket that would fire on this tick.
const fireCount = () => { const ids = []; return { ids, start: async (t) => { ids.push(t.id); return { ok: true }; } }; };
const tick = (start) => runDueTickets({ start, hold: featureHoldsTicket });

test('approve each on: slice 2\'s ticket is held when slice 1 is done; featureView reads held', async () => {
  const a = mk(3, { pipelineId: pipe('done'), approveEach: true });
  const [, r2, r3] = tickets(a.id);
  const f = fireCount();
  const out = await tick(f.start);
  assert.deepEqual(out.held, [r2.ticket_id]);
  assert.deepEqual(f.ids, []);
  const t = getTicket(r2.ticket_id);
  assert.equal(t.status, 'scheduled');
  assert.equal(ticketHeld(t), true);
  assert.equal(ticketHeld(getTicket(r3.ticket_id)), false, 'slice 3 still waits for slice 2');
  const v = featureView(a.id);
  assert.deepEqual(v.slices.map((s) => s.state), ['done', 'held', 'planned']);
  assert.deepEqual(v.held, { index: 2, ticketId: r2.ticket_id });
  assert.equal(v.open, true);
  assert.equal(v.halted, null);
  // Start now is Run now: forced skips the hold.
  requestRunNow(r2.ticket_id);
  assert.equal(ticketHeld(getTicket(r2.ticket_id)), false);
  assert.deepEqual((await tick(f.start)).fired, [r2.ticket_id]);
});

test('approve each turned on after the outline holds; turned off releases on the next tick', async () => {
  const a = mk(2, { pipelineId: pipe('done'), approveEach: false });
  const [, r2] = tickets(a.id);
  setApproveEach(a.id, true);
  const f = fireCount();
  assert.deepEqual((await tick(f.start)).held, [r2.ticket_id]);
  assert.equal(featureView(a.id).held.index, 2);
  setApproveEach(a.id, false);
  assert.equal(featureView(a.id).held, null);
  assert.deepEqual((await tick(f.start)).fired, [r2.ticket_id]);
});

test('a non-slice after-ticket and a ticket whose feature row is missing are never held', async () => {
  const p = pipe('done');
  const plain = createTicket({ projectDir: root, title: 'Plain', request: { projectDir: root, prompt: 'x' }, after: { kind: 'pipeline', id: p } });
  assert.equal(featureHoldsTicket(getTicket(plain.id)), false);
  const a = mk(2, { pipelineId: pipe('done'), approveEach: true });
  const [, r2] = tickets(a.id);
  assert.equal(featureHoldsTicket(getTicket(r2.ticket_id)), true);
  getDb().prepare('PRAGMA foreign_keys = OFF').run();
  try { getDb().prepare('DELETE FROM shape_features WHERE id = ?').run(a.id); } finally { getDb().prepare('PRAGMA foreign_keys = ON').run(); }
  assert.equal(featureHoldsTicket(getTicket(r2.ticket_id)), false);
  assert.equal(featureHoldsTicket(null), false);
  const f = fireCount();
  const out = await tick(f.start);
  assert.deepEqual(out.held, []);
  assert.ok(f.ids.includes(plain.id) && f.ids.includes(r2.ticket_id));
});

test('Resume of a stopped slice 2 with the switch on starts it (forced), and slice 3 is held once slice 2 is done', async () => {
  const a = mk(3, { pipelineId: pipe('done'), approveEach: true });
  const [, r2, r3] = tickets(a.id);
  const p2 = pipe('stopped');
  setTicket(r2.ticket_id, 'fired', { pipelineId: p2 });
  setTicket(r3.ticket_id, 'missed');
  const res = resumeFeature(a.id, { by: 'ann' });
  assert.equal(res.action, 'restart');
  assert.equal(getTicket(res.ticketId).forced, true, 'Resume is the owner\'s OK');
  const f = fireCount();
  const out = await tick(f.start);
  assert.deepEqual(out.fired, [res.ticketId]);
  const p2b = pipe('done');
  setTicket(res.ticketId, 'fired', { pipelineId: p2b });
  assert.deepEqual((await tick(f.start)).held, [r3.ticket_id]);
  assert.equal(featureView(a.id).held.index, 3);
});

test('Resume of a stopped slice 2 with the switch off is not forced: nothing holds it', () => {
  const a = mk(2, { pipelineId: pipe('done'), approveEach: false });
  const [, r2] = tickets(a.id);
  setTicket(r2.ticket_id, 'fired', { pipelineId: pipe('stopped') });
  const res = resumeFeature(a.id, { by: 'ann' });
  assert.equal(res.action, 'restart');
  assert.equal(getTicket(res.ticketId).forced, false);
});

test('guard: Cancel the rest cancels a held ticket', async () => {
  const a = mk(2, { pipelineId: pipe('done'), approveEach: true });
  const [, r2] = tickets(a.id);
  await tick(fireCount().start);
  assert.equal(featureView(a.id).held.index, 2);
  assert.deepEqual(cancelRest(a.id), { canceled: 1 });
  assert.equal(getTicket(r2.ticket_id).status, 'canceled');
});

test('guard: Re-plan the rest is not refused by a held slice', async () => {
  const a = mk(2, { pipelineId: pipe('done'), approveEach: true });
  await tick(fireCount().start);
  assert.equal(featureView(a.id).held.index, 2);
  const res = replanRest(a.id);
  assert.ok(res.ticketId);
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

test('featureView ship: a ship whose PRs were all closed unmerged reads as not shipped; clearShip forgets it', () => {
  const f = doneFeature(2);
  const setPr = (pid, n, state) => getDb().prepare('UPDATE pipelines SET pr_url = ?, pr_state = ? WHERE id = ?')
    .run(`https://github.com/o/r/pull/${n}`, state, pid);
  setPr(f.pids[0], 1, 'OPEN'); setPr(f.pids[1], 2, 'OPEN');
  recordShip(f.id, { mode: 'stacked', release: { version: 'v1.2.0', target: 'dev' } });
  assert.equal(featureView(f.id).ship.mode, 'stacked', 'open PRs: shipped');
  setPr(f.pids[0], 1, 'CLOSED');
  assert.equal(featureView(f.id).ship.mode, 'stacked', 'one PR still open: shipped');
  setPr(f.pids[1], 2, 'MERGED');
  assert.equal(featureView(f.id).ship.mode, 'stacked', 'a merged PR: shipped');
  setPr(f.pids[1], 2, 'CLOSED');
  const v = featureView(f.id);
  assert.deepEqual({ ready: v.ship.ready, mode: v.ship.mode, prUrl: v.ship.prUrl, release: v.ship.release, result: v.ship.result },
    { ready: true, mode: null, prUrl: null, release: null, result: null }, 'every PR closed: ships again');
  assert.equal(clearShip(f.id), true);
  assert.equal(getDb().prepare('SELECT ship_mode, release_version FROM shape_features WHERE id = ?').get(f.id).ship_mode, null);
  assert.equal(clearShip(f.id), false, 'nothing left to clear');
  assert.equal(recordShip(f.id, { mode: 'one', prUrl: 'https://github.com/o/r/pull/9' }), true, 'records the new ship');
  const fresh = doneFeature(2);
  recordShip(fresh.id, { mode: 'one' });
  assert.equal(featureView(fresh.id).ship.mode, 'one', 'no PR seen yet: still shipped');
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

// Requirements slices: the agreed ids per slice reach the PR preamble and the feature view's check.
const AGREED3 = [{ id: 'R-po-1', text: 'People see it' }, { id: 'R-ux-1', text: 'It reads well' }, { id: 'R-ops-1', text: 'It rolls back' }];
const reqOutline = () => ({ ...outlineOf(2), agreed: AGREED3, leftOut: [],
  slices: outlineOf(2).slices.map((s, i) => ({ ...s, requirements: i ? [] : ['R-po-1', 'R-ux-1', 'R-ops-1'] })) });

test('slicePrPreamble adds Satisfies only with ids', () => {
  const { pid, id } = mk(2, { outline: reqOutline() });
  assert.match(slicePrPreamble(pid), /^Part of Charts: slice 1 of 2\nSatisfies: R-po-1, R-ux-1, R-ops-1\n\n- Slice 2, Slice 2: not opened yet$/);
  const p2 = pipe('done');
  getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = 2').run(p2, id);
  assert.match(slicePrPreamble(p2), /^Part of Charts: slice 2 of 2\n\n- Slice 1,/, 'a slice with no ids has no Satisfies line');
  const plain = mk(2);
  assert.match(slicePrPreamble(plain.pid), /^Part of Charts: slice 1 of 2\n\n- Slice 2/);
});

test('featureView: requirements.check null before review; 2/3 with one uncovered impl issue; key absent without agreed', async () => {
  const { pid, id } = mk(2, { outline: reqOutline() });
  let v = featureView(id);
  assert.deepEqual(v.slices[0].requirements, { ids: ['R-po-1', 'R-ux-1', 'R-ops-1'], check: null });
  assert.deepEqual(v.slices[1].requirements, { ids: [], check: null }, 'no pipeline yet');
  await writeReview(pid, 'impl', 1, { summary: 'r1', issues: [{ severity: 'major', title: 'requirements-1-1: R-ops-1 · not covered by the diff', detail: '' }] });
  await writeReview(pid, 'refine', 3, { summary: 'plan', issues: [{ severity: 'major', title: 'R-po-1 · not covered by any step', detail: '' }] });
  v = featureView(id);
  const c = v.slices[0].requirements.check;
  assert.deepEqual([c.passed, c.total], [2, 3]);
  assert.deepEqual(c.items.find((i) => !i.pass), { id: 'R-ops-1', label: 'R-ops-1 · not covered by the diff', pass: false, detail: 'It rolls back' });
  await writeReview(pid, 'impl', 2, { summary: 'r2', issues: [] });
  assert.equal(featureView(id).slices[0].requirements.check.passed, 3, 'the highest-cycle code review counts');
  assert.equal((await featureShipInput(featureView(id))).slices[0].requirements.ids.length, 3);
  const plain = mk(2);
  assert.equal('requirements' in featureView(plain.id).slices[0], false);
  assert.equal('requirements' in (await featureShipInput(featureView(plain.id))).slices[0], false);
});

// Shaper requirements s3 (D7, D11): the acceptance ledger in outline.acceptance and on the ship block.
test('setFeatureAcceptance round-trips; ship.acceptance lists every agreed id; absent without agreed requirements', async () => {
  const { pid, id } = mk(2, { outline: reqOutline() });
  let a = featureView(id).ship.acceptance;
  assert.deepEqual([a.ready, a.marked, a.total], [false, 0, 3]);
  assert.deepEqual(a.items.map((i) => i.label), ['R-po-1 · People see it · not marked', 'R-ux-1 · It reads well · not marked',
    'R-ops-1 · It rolls back · not marked']);
  await writeReview(pid, 'impl', 1, { summary: 'r1', issues: [] });
  assert.equal(featureView(id).ship.acceptance.items[0].detail, 'covered by the diff', 'nothing pre-marked, the cover said');
  assert.deepEqual([featureView(id).ship.acceptance.agreed.map((a) => a.id), featureView(id).ship.acceptance.entries],
    [['R-po-1', 'R-ux-1', 'R-ops-1'], []], 'the card repaints from the agreed list and the stored marks');
  const entries = [{ id: 'R-po-1', mark: 'met' }, { id: 'R-ux-1', mark: 'dropped', reason: 'later' }, { id: 'R-ops-1', mark: 'not-met', target: 'Run 5' }];
  assert.equal(setFeatureAcceptance(id, entries), true);
  assert.deepEqual(JSON.parse(getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(id).outline).acceptance, entries);
  a = featureView(id).ship.acceptance;
  assert.deepEqual([a.ready, a.marked, a.total], [true, 3, 3]);
  assert.deepEqual(a.entries, entries);
  assert.equal(featureView(id).slices.length, 2, 'the rest of the outline is kept');
  assert.equal(setFeatureAcceptance('feat_missing', entries), false);
  assert.equal('acceptance' in featureView(mk(2).id).ship, false);
});

test('a follow-up after marks keeps outline.acceptance', () => {
  const { id } = mk(2, { outline: reqOutline() });
  setFeatureAcceptance(id, [{ id: 'R-po-1', mark: 'met' }]);
  appendFeatureRun(id, { title: 'Follow-up: blue bars', goal: 'make the bars blue', kind: 'follow-up' });
  assert.deepEqual(JSON.parse(getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(id).outline).acceptance,
    [{ id: 'R-po-1', mark: 'met' }]);
});

// Shaper requirements s3 (D12): a requirements-first follow-up and the Changes facts of a shipped feature.
test('a requirements-first follow-up asks shape.requirementsFirst; an extra run never does; the Changes facts carry shipped, agreed and the marks', async () => {
  const { landingFactsOfFeature } = await import('../src/core/shape/changes.mjs');
  const { id } = mk(2, { outline: reqOutline() });
  setFeatureAcceptance(id, [{ id: 'R-po-1', mark: 'met' }]);
  const deps = { readPrState: () => null, readRunTags: () => [], readRunLabels: () => [], featureView: (fid) => featureView(fid) };
  assert.equal(landingFactsOfFeature(id, deps).feature.shipped, false);
  getDb().prepare("UPDATE shape_features SET ship_mode = 'one' WHERE id = ?").run(id);
  const facts = landingFactsOfFeature(id, deps).feature;
  assert.deepEqual([facts.shipped, facts.agreed.map((a) => a.id), facts.acceptance, facts.perspectives],
    [true, ['R-po-1', 'R-ux-1', 'R-ops-1'], [{ id: 'R-po-1', mark: 'met' }], ['product']]);
  const a = appendFeatureRun(id, { title: 'Follow-up: blue', goal: 'make it blue', kind: 'follow-up', requirementsFirst: true });
  assert.equal(getTicket(a.ticketId, { withRequest: true }).request.shape.requirementsFirst, true);
  const plain = appendFeatureRun(id, { title: 'Follow-up: red', goal: 'make it red', kind: 'follow-up' });
  assert.equal('requirementsFirst' in getTicket(plain.ticketId, { withRequest: true }).request.shape, false);
  const extra = appendFeatureRun(id, { title: 'Extra', goal: 'more', kind: 'extra', requirementsFirst: true });
  assert.equal('requirementsFirst' in getTicket(extra.ticketId, { withRequest: true }).request.shape, false);
});

test('resumeFeature: a stopped requirements-first follow-up restarts requirements first; a plain one stays plain', () => {
  for (const requirementsFirst of [true, false]) {
    const { id } = mk(2, { outline: reqOutline(), pipelineId: pipe('done') });
    setTicket(tickets(id)[1].ticket_id, 'fired', { pipelineId: pipe('done') });
    const f = appendFeatureRun(id, { title: 'Follow-up: blue', goal: 'make it blue', kind: 'follow-up', requirementsFirst });
    setTicket(f.ticketId, 'fired', { pipelineId: pipe('stopped') });
    const res = resumeFeature(id);
    assert.equal(res.action, 'restart', JSON.stringify(res));
    const shape = getTicket(res.ticketId, { withRequest: true }).request.shape;
    assert.deepEqual([shape.slice.index, shape.requirementsFirst === true], [3, requirementsFirst]);
  }
});

test('createSliceFeature stores pr; a replacing feature copies the replaced feature\'s pr', () => {
  const read = (id) => getDb().prepare('SELECT pr_open, pr_slices, pr_source FROM shape_features WHERE id = ?').get(id);
  const pr = { open: 'draft', slices: 'one', source: { open: 'team', slices: 'project' } };
  const a = mk(2, { pr });
  assert.deepEqual({ ...read(a.id) }, { pr_open: 'draft', pr_slices: 'one', pr_source: JSON.stringify(pr.source) });
  const b = mk(2, { replaces: a.id, pr: { open: 'ready', slices: 'each', source: { open: 'run', slices: 'run' } } });
  assert.deepEqual({ ...read(b.id) }, { pr_open: 'draft', pr_slices: 'one', pr_source: JSON.stringify(pr.source) }, 'a re-plan keeps the decision and its source');
  const none = mk(2);
  assert.deepEqual({ ...read(none.id) }, { pr_open: null, pr_slices: null, pr_source: null }, 'no pr leaves the columns NULL');
  const c = mk(2, { replaces: none.id, pr });
  assert.equal(read(c.id).pr_open, 'draft', 'a replaced feature with no value does not block the new one');
});

test('featureRootSource follows replaces back to the first feature', () => {
  const a = mk(2, { pipelineId: pipe('done', { branch: { source: 'main' } }) });
  const b = mk(2, { replaces: a.id, pipelineId: pipe('done', { branch: { source: 'feat/last-done' } }) });
  const c = mk(2, { replaces: b.id, pipelineId: pipe('done', { branch: { source: 'feat/later' } }) });
  const src = (id) => getDb().prepare('SELECT source_branch FROM shape_features WHERE id = ?').get(id).source_branch;
  assert.equal(src(c.id), 'feat/later');
  assert.equal(featureRootSource(c.id), src(a.id));
  assert.equal(featureRootSource(a.id), src(a.id));
  assert.equal(featureRootSource('feat_missing'), null);
  getDb().prepare('UPDATE shape_features SET replaces = ? WHERE id = ?').run(c.id, a.id);   // a loop stops
  assert.equal(typeof featureRootSource(c.id), 'string');
});

// ---- Shaper small runs A2: the feature record (Care, requirement kinds) ---------------------------------------------

const DEV_KEYS = JSON.parse(readFileSync(new URL('./fixtures/shaper/dev-feature-view-keys.json', import.meta.url), 'utf8'));
const RECORD_COLS = ['care', 'care_chosen_by', 'care_worca_pick', 'requirement_kinds'];
const DEFAULT_CARE = { position: 'balanced', chosenBy: 'default', worcaPick: null };
/** Runs `fn` with `shaperSmallRuns` on or off, restoring WORCA_FLAGS afterwards. */
function withSmallRuns(on, fn) {
  const prev = process.env.WORCA_FLAGS;
  try {
    if (on) process.env.WORCA_FLAGS = 'shaperSmallRuns'; else delete process.env.WORCA_FLAGS;
    assert.equal(shaperSmallRunsOn(), on);
    return fn();
  } finally {
    if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev;
  }
}
const recordRow = (id) => ({ ...getDb().prepare(`SELECT ${RECORD_COLS.join(', ')} FROM shape_features WHERE id = ?`).get(id) });
const reopen = () => { _resetForTests(); getDb(); };
/** 3 agreed requirements over 2 runs: run 1 lists R-po-1, run 2 lists R-qa-1; R-sec-1 is left for a role to confirm. */
const kindsOutline = (n = 2) => {
  const o = outlineOf(n);
  o.slices[0].requirements = ['R-po-1'];
  o.slices[1].requirements = ['R-qa-1'];
  return { ...o, agreed: [{ id: 'R-po-1', text: 'People see it' }, { id: 'R-sec-1', text: 'It is safe' }, { id: 'R-qa-1', text: 'It is tested' }], leftOut: [] };
};
const COMPLIANCE = { 'R-sec-1': { kind: 'confirmed', role: 'Compliance' } };
const KINDS = [{ id: 'R-po-1', kind: 'owned', run: 1 }, { id: 'R-sec-1', kind: 'confirmed', role: 'compliance' }, { id: 'R-qa-1', kind: 'owned', run: 2 }];
const LEAN = { position: 'lean', chosenBy: 'person', worcaPick: 'thorough' };

test('small runs on: a new feature records Balanced, by default, no pick, and reads it back after a reload', () => withSmallRuns(true, () => {
  const { id } = mk(2);
  const v = featureView(id);
  assert.deepEqual(v.care, DEFAULT_CARE);
  assert.deepEqual(v.requirementKinds, []);
  assert.deepEqual(Object.keys(v), [...DEV_KEYS.view, 'care', 'requirementKinds'], "dev's keys first, the 2 new ones last");
  assert.deepEqual(recordRow(id), { care: 'balanced', care_chosen_by: 'default', care_worca_pick: null, requirement_kinds: null });
  reopen();
  assert.deepEqual(featureView(id).care, DEFAULT_CARE);
}));

test('small runs on: ids are stable after a reload, each owned by its run or confirmed by its role', () => withSmallRuns(true, () => {
  const outline = kindsOutline();
  const { id } = mk(2, { outline, requirementKinds: COMPLIANCE });
  assert.deepEqual(featureView(id).requirementKinds, KINDS);
  reopen();
  const kinds = featureView(id).requirementKinds;
  assert.deepEqual(kinds, KINDS);
  assert.deepEqual(kinds.map((k) => k.id), outline.agreed.map((a) => a.id));
  for (const k of kinds) assert.match(k.id, CRITERION_ID_RE);
  assert.deepEqual(JSON.parse(recordRow(id).requirement_kinds),
    { 'R-po-1': { kind: 'owned' }, 'R-sec-1': { kind: 'confirmed', role: 'compliance' }, 'R-qa-1': { kind: 'owned' } });
  // An agreed id no run lists: owned, run null (slice A3's coverage rule judges it, not the record).
  const loose = kindsOutline();
  loose.slices[1].requirements = [];
  assert.deepEqual(featureView(mk(2, { outline: loose }).id).requirementKinds.map((k) => [k.id, k.kind, k.run]),
    [['R-po-1', 'owned', 1], ['R-sec-1', 'owned', null], ['R-qa-1', 'owned', null]]);
}));

test('small runs on: a Care choice returns the same 3 values after a reload', () => withSmallRuns(true, () => {
  const { id } = mk(2, { care: LEAN });
  assert.deepEqual(featureView(id).care, LEAN);
  reopen();
  assert.deepEqual(featureView(id).care, LEAN);
  assert.deepEqual(featureView(mk(2, { care: { position: 'thorough' } }).id).care, { position: 'thorough', chosenBy: 'default', worcaPick: null });
}));

test('a refused record writes nothing', () => withSmallRuns(true, () => {
  const earlier = mk(2, { outline: kindsOutline() });
  const before1 = { f: countFeatures(), t: countTickets() };
  const refused = (over, code) => assert.throws(() => mk(2, { pipelineId: earlier.pid, outline: kindsOutline(), ...over }), (e) => {
    assert.ok(e instanceof Error);
    assert.equal(e.code, code);
    return true;
  });
  refused({ requirementKinds: { 'R-sec-1': { kind: 'confirmed', role: 'Legal' } } }, 'REQUIREMENT_ROLE_NOT_ALLOWED');
  refused({ requirementKinds: { 'R-xx-9': { kind: 'owned' } } }, 'REQUIREMENT_UNKNOWN');
  refused({ care: { position: 'careful' } }, 'CARE_POSITION_UNKNOWN');
  assert.throws(() => mk(2, { pipelineId: earlier.pid, outline: kindsOutline(), requirementKinds: { 'R-sec-1': { kind: 'confirmed', role: 'Legal' } } }),
    { message: 'R-sec-1: "Legal" cannot confirm a requirement. Pick Product, Engineering, Design, DevOps, Security, Compliance or QA.' });
  assert.deepEqual({ f: countFeatures(), t: countTickets() }, before1);
  assert.equal(getDb().prepare('SELECT status FROM shape_features WHERE id = ?').get(earlier.id).status, 'active');
  for (const t of tickets(earlier.id).map((r) => r.ticket_id).filter(Boolean)) assert.equal(getTicket(t).status, 'scheduled');
}));

test('the record commits with the feature', () => withSmallRuns(true, () => {
  const before1 = { f: countFeatures(), t: countTickets() };
  const bad = kindsOutline(3);
  bad.slices[2].title = null;                                    // fails at slice 3's row, after the record's UPDATE
  assert.throws(() => mk(3, { outline: bad, care: LEAN, requirementKinds: COMPLIANCE }));
  assert.deepEqual({ f: countFeatures(), t: countTickets() }, before1);
  assert.equal(getDb().prepare("SELECT count(*) n FROM shape_features WHERE care = 'lean' AND title = 'Charts' AND outline LIKE '%\"title\":null%'").get().n, 0);
}));

test('flag off: no new column is written', () => withSmallRuns(false, () => {
  const { id } = mk(2, { outline: kindsOutline(), care: { position: 'thorough', chosenBy: 'person', worcaPick: 'lean' }, requirementKinds: COMPLIANCE });
  assert.deepEqual(recordRow(id), { care: 'balanced', care_chosen_by: 'default', care_worca_pick: null, requirement_kinds: null });
  // Not read, so not validated either: what would be refused with the flag on is ignored.
  const odd = mk(2, { care: { position: 'careful' }, requirementKinds: { 'R-sec-1': { kind: 'confirmed', role: 'Legal' } } });
  assert.deepEqual(recordRow(odd.id), { care: 'balanced', care_chosen_by: 'default', care_worca_pick: null, requirement_kinds: null });
}));

test("flag off: the view, a slice and ship have dev's exact keys", () => withSmallRuns(false, () => {
  const plain = featureView(mk(2).id);
  assert.deepEqual(Object.keys(plain), DEV_KEYS.view);
  assert.deepEqual(Object.keys(plain.slices[0]), DEV_KEYS.slice);
  assert.deepEqual(Object.keys(plain.ship), DEV_KEYS.ship);
  const agreed = featureView(mk(2, { outline: kindsOutline() }).id);
  assert.deepEqual(Object.keys(agreed), DEV_KEYS.view);
  assert.deepEqual(Object.keys(agreed.slices[0]), DEV_KEYS.sliceWithAgreed);
  assert.deepEqual(Object.keys(agreed.ship), DEV_KEYS.shipWithAgreed);
}));

test("an existing install: a feature written by dev, in dev's schema, reads as Balanced with every requirement owned by its run", () => {
  const outline = kindsOutline();
  outline.slices[1].requirements = ['R-sec-1', 'R-qa-1'];
  const { id } = withSmallRuns(false, () => mk(2, { outline }));
  const earlier = { ...getDb().prepare('SELECT * FROM shape_features WHERE id = ?').get(id) };
  for (const c of RECORD_COLS) delete earlier[c];
  _resetForTests();
  const raw = new DatabaseSync(dbPath());
  raw.exec(`${RECORD_COLS.map((c) => `ALTER TABLE shape_features DROP COLUMN ${c};`).join('')} PRAGMA user_version = 95`);
  assert.equal(raw.prepare('PRAGMA table_info(shape_features)').all().some((c) => RECORD_COLS.includes(c.name)), false);
  raw.close();
  assert.equal(getDb().prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const row = { ...getDb().prepare('SELECT * FROM shape_features WHERE id = ?').get(id) };
  assert.deepEqual(RECORD_COLS.map((c) => row[c]), ['balanced', 'default', null, null]);
  for (const c of RECORD_COLS) delete row[c];
  assert.deepEqual(row, earlier, 'every earlier column is unchanged');
  withSmallRuns(true, () => {
    const v = featureView(id);
    assert.deepEqual(v.care, DEFAULT_CARE);
    assert.deepEqual(v.requirementKinds, [{ id: 'R-po-1', kind: 'owned', run: 1 }, { id: 'R-sec-1', kind: 'owned', run: 2 }, { id: 'R-qa-1', kind: 'owned', run: 2 }]);
  });
  withSmallRuns(false, () => {
    const v = featureView(id);
    assert.deepEqual(Object.keys(v), DEV_KEYS.view);
    assert.deepEqual(Object.keys(v.slices[0]), DEV_KEYS.sliceWithAgreed);
    assert.deepEqual(Object.keys(v.ship), DEV_KEYS.shipWithAgreed);
  });
});

test('created with the flag on, read with it off, then on again: the values stay in the row', () => {
  const { id } = withSmallRuns(true, () => mk(2, { outline: kindsOutline(), care: LEAN, requirementKinds: COMPLIANCE }));
  const off = withSmallRuns(false, () => featureView(id));
  assert.equal('care' in off, false);
  assert.equal('requirementKinds' in off, false);
  assert.deepEqual(Object.keys(off), DEV_KEYS.view);
  assert.equal(recordRow(id).care, 'lean', 'hidden, not erased');
  const on = withSmallRuns(true, () => featureView(id));
  assert.deepEqual(on.care, LEAN);
  assert.deepEqual(on.requirementKinds, KINDS);
});

test('small runs on: a re-plan keeps the replaced feature\'s Care and its confirmed roles for ids still agreed', () => withSmallRuns(true, () => {
  const a = mk(2, { outline: kindsOutline(), care: LEAN, requirementKinds: { ...COMPLIANCE, 'R-qa-1': { kind: 'confirmed', role: 'qa' } } });
  const next = kindsOutline();
  next.agreed = next.agreed.filter((r) => r.id !== 'R-qa-1');          // R-qa-1 is no longer agreed
  next.slices[1].requirements = [];
  const b = mk(2, { replaces: a.id, outline: next });
  const v = featureView(b.id);
  assert.deepEqual(v.care, LEAN);
  assert.deepEqual(v.requirementKinds, [{ id: 'R-po-1', kind: 'owned', run: 1 }, { id: 'R-sec-1', kind: 'confirmed', role: 'compliance' }]);
  // What the caller passes wins over the replaced feature's.
  const c = mk(2, { replaces: b.id, outline: kindsOutline(), care: { position: 'thorough' }, requirementKinds: {} });
  assert.deepEqual(featureView(c.id).care, { position: 'thorough', chosenBy: 'default', worcaPick: null });
  assert.deepEqual(featureView(c.id).requirementKinds.map((k) => k.kind), ['owned', 'owned', 'owned']);
  // A bad stored value on the replaced row falls back to the default: it never refuses the re-plan.
  getDb().prepare("UPDATE shape_features SET care = 'careful', care_worca_pick = 'max', requirement_kinds = '{not json' WHERE id = ?").run(c.id);
  const d = mk(2, { replaces: c.id, outline: kindsOutline() });
  assert.deepEqual(featureView(d.id).care, DEFAULT_CARE);
  assert.deepEqual(featureView(d.id).requirementKinds.map((k) => k.kind), ['owned', 'owned', 'owned']);
  assert.deepEqual(featureView(mk(2, { replaces: 'feat_missing' }).id).care, DEFAULT_CARE);
}));

test('small runs on: an appended run and the acceptance marks leave the stored kinds and Care unchanged', () => withSmallRuns(true, () => {
  const { id } = mk(2, { outline: kindsOutline(), care: LEAN, requirementKinds: COMPLIANCE });
  const stored = recordRow(id);
  appendFeatureRun(id, { title: 'One more', goal: 'more', kind: 'extra' });
  assert.deepEqual(recordRow(id), stored);
  assert.deepEqual([featureView(id).care, featureView(id).requirementKinds, featureView(id).total], [LEAN, KINDS, 3]);
  assert.equal(setFeatureAcceptance(id, [{ id: 'R-po-1', mark: 'met' }]), true);
  assert.deepEqual(recordRow(id), stored);
  assert.deepEqual([featureView(id).care, featureView(id).requirementKinds], [LEAN, KINDS]);
}));

// ── Shaper small runs A5: the slice gate, one slice at a time, resume ─────────
/** Async twin of withSmallRuns: the flag stays set until `fn`'s promise settles. */
async function withSmallRunsAsync(on, fn) {
  const prev = process.env.WORCA_FLAGS;
  try {
    if (on) process.env.WORCA_FLAGS = 'shaperSmallRuns'; else delete process.env.WORCA_FLAGS;
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev;
  }
}
/** 4 slices: 1 and 2 done; slice 4 builds on `deps4`. → { a, r3, r4 } (slice rows). */
const gateWorld = ({ deps4 = [], approveEach = false } = {}) => {
  const outline = outlineOf(4);
  outline.slices[3].dependsOn = deps4;
  const a = mk(4, { pipelineId: pipe('done'), outline, approveEach });
  const [, r2, r3, r4] = tickets(a.id);
  setTicket(r2.ticket_id, 'fired', { pipelineId: pipe('done') });
  return { a, r3, r4 };
};
const s3As = (r3, how) => {
  if (how === 'unrun') return;
  if (how.ticket) { setTicket(r3.ticket_id, how.ticket); return; }
  const p = pipe(how.pipe);
  setTicket(r3.ticket_id, 'fired', { pipelineId: p });
  if (how.archived) getDb().prepare("UPDATE pipelines SET archived_at = '2026-01-01T00:00:00Z' WHERE id = ?").run(p);
};

test('sliceGateState (D4): builds-on links, one slice at a time, lowest index first', () => {
  const rows = [
    // [slice 4 builds on s3?, how slice 3 stands, the gate's answer, reason]
    [true, 'unrun', 'waiting'],
    [true, { pipe: 'stopped' }, 'waiting'],
    [true, { pipe: 'error' }, 'waiting'],
    [true, { pipe: 'paused' }, 'waiting'],
    [true, { pipe: 'interrupted' }, 'waiting'],
    [true, { pipe: 'done' }, 'ok'],
    [true, { ticket: 'missed' }, 'bad', 'was missed'],
    [true, { ticket: 'canceled' }, 'bad', 'was canceled'],
    [true, { ticket: 'failed' }, 'bad', 'could not start'],
    [true, { pipe: 'done', archived: true }, 'bad', 'was archived'],
    [false, { pipe: 'stopped' }, 'ok'],
    [false, { pipe: 'error' }, 'ok'],
    [false, { ticket: 'failed' }, 'ok'],
    [false, { pipe: 'paused' }, 'ok'],
    [false, { pipe: 'running' }, 'waiting'],
    [false, { pipe: 'starting' }, 'waiting'],
    [false, 'unrun', 'waiting'],
  ];
  for (const [dep, how, want, reason] of rows) {
    const { r3, r4 } = gateWorld({ deps4: dep ? ['s3'] : [] });
    s3As(r3, how);
    const g = sliceGateState(getTicket(r4.ticket_id));
    assert.equal(g.state, want, `${dep} ${JSON.stringify(how)}`);
    if (reason) { assert.equal(g.reason, reason); assert.equal(g.title, 'Run 3 · Slice 3'); }
  }
  // Asking a person still holds the feature's one slot.
  const { r3, r4 } = gateWorld();
  const p3 = pipe('running');
  setTicket(r3.ticket_id, 'fired', { pipelineId: p3 });
  const asking = (p) => (p === p3 ? liveSliceFrom({ runId: 'r', status: 'running', pendingQuestion: { kind: 'questions' } }) : null);
  assert.equal(sliceGateState(getTicket(r4.ticket_id), { live: asking }).state, 'waiting');
  // A held earlier slice does not hold back a later one.
  const h = gateWorld({ approveEach: true });
  assert.equal(sliceGateState(getTicket(h.r4.ticket_id)).state, 'ok');
  // Not a slice ticket.
  const plain = createTicket({ projectDir: root, title: 'Plain', request: { projectDir: root, prompt: 'x' }, after: { kind: 'pipeline', id: pipe('done') } });
  assert.equal(sliceGateState(getTicket(plain.id)), null);
  assert.equal(sliceGateState(null), null);
});

test('sliceOfTicket: the feature, index, status and switch of a slice ticket; null otherwise', () => {
  const a = mk(3, { approveEach: true });
  const [, , r3] = tickets(a.id);
  assert.deepEqual(sliceOfTicket(r3.ticket_id), { featureId: a.id, index: 3, status: 'active', approveEach: true });
  assert.equal(sliceOfTicket('nope'), null);
  assert.equal(sliceOfTicket(null), null);
});

test('busySliceOf counts questions and approval as going, paused as not', () => {
  const a = mk(3, { pipelineId: pipe('done') });
  const [, r2] = tickets(a.id);
  const p2 = pipe('running');
  setTicket(r2.ticket_id, 'fired', { pipelineId: p2 });
  const liveAs = (l) => (p) => (p === p2 ? { runId: 'r', ...l } : null);
  assert.deepEqual(busySliceOf(a.id, { live: liveAs({ status: 'running', asking: true }) }), { index: 2 });
  assert.deepEqual(busySliceOf(a.id, { live: liveAs({ status: 'running', waiting: true }) }), { index: 2 });
  assert.equal(busySliceOf(a.id, { live: liveAs({ status: 'paused' }) }), null);
  assert.equal(busySliceOf(a.id, { exclude: 2, live: liveAs({ status: 'running', approved: true }) }), null);
});

test('ticketHeld with the flag on: a held slice behind a stopped one reads held', () => withSmallRuns(true, () => {
  const { a, r3, r4 } = gateWorld({ approveEach: true });
  s3As(r3, { pipe: 'stopped' });
  const v = featureView(a.id);
  assert.equal(state(v, 4), 'held');
  assert.equal(sliceGateState(getTicket(r4.ticket_id)).state, 'ok');
  assert.equal(ticketHeld(getTicket(r4.ticket_id)), true);
  // Flag off: dev's linear predecessor (slice 3, stopped) never opens, so it is not held.
  withSmallRuns(false, () => assert.equal(state(featureView(a.id), 4), 'planned'));
}));

test("small runs: createSliceFeature stores dev's linear chain", () => {
  const shape = (id) => tickets(id).slice(1).map((r) => {
    const t = getTicket(r.ticket_id);
    return [t.after.kind, t.after.policy, t.sourceFromPrevious];
  });
  const on = withSmallRuns(true, () => mk(4, { pipelineId: pipe('done') }));
  const off = withSmallRuns(false, () => mk(4, { pipelineId: pipe('done') }));
  assert.deepEqual(shape(on.id), shape(off.id));
  const r = tickets(on.id);
  assert.deepEqual(getTicket(r[1].ticket_id).after, { kind: 'pipeline', id: on.pid, policy: 'done' });
  assert.deepEqual(getTicket(r[2].ticket_id).after, { kind: 'ticket', id: r[1].ticket_id, policy: 'done' });
  assert.deepEqual(getTicket(r[3].ticket_id).after, { kind: 'ticket', id: r[2].ticket_id, policy: 'done' });
});

test("small runs: restart of slice 3 behind an unrun slice 2 chains after slice 2's ticket", () => withSmallRuns(true, () => {
  const a = mk(3, { pipelineId: pipe('done') });
  const [, r2, r3] = tickets(a.id);
  setTicket(r3.ticket_id, 'fired', { pipelineId: pipe('stopped') });   // slice 3 ran ahead and stopped; slice 2 never ran
  const res = resumeFeature(a.id, { by: 'ann' });
  assert.equal(res.action, 'restart');
  const nt = getTicket(res.ticketId);
  assert.deepEqual(nt.after, { kind: 'ticket', id: r2.ticket_id, policy: 'done' });
  assert.equal(nt.sourceFromPrevious, true);
  assert.equal(tickets(a.id)[2].ticket_id, res.ticketId);
}));

test('small runs: resume or restart while another slice is going is refused 409 and changes nothing', () => withSmallRuns(true, () => {
  // restart: slice 2 stopped, slice 3 running
  const a = mk(3, { pipelineId: pipe('done') });
  const [, r2, r3] = tickets(a.id);
  setTicket(r2.ticket_id, 'fired', { pipelineId: pipe('stopped') });
  setTicket(r3.ticket_id, 'fired', { pipelineId: pipe('running') });
  const n = countTickets();
  const rowsBefore = JSON.stringify(tickets(a.id));
  const res = resumeFeature(a.id);
  assert.deepEqual(res, { status: 409, error: 'Slice 3 is still going: resume this one when it finishes' });
  assert.equal(countTickets(), n);
  assert.equal(JSON.stringify(tickets(a.id)), rowsBefore);
  // resume: slice 2 paused, slice 3 waiting for an answer
  const b = mk(3, { pipelineId: pipe('done') });
  const [, b2, b3] = tickets(b.id);
  setTicket(b2.ticket_id, 'fired', { pipelineId: pipe('paused') });
  const p3 = pipe('running');
  setTicket(b3.ticket_id, 'fired', { pipelineId: p3 });
  const live = (p) => (p === p3 ? { runId: 'r', status: 'running', waiting: true } : null);
  assert.equal(resumeFeature(b.id, { live }).status, 409);
  // Flag off: the same paused slice resumes.
  withSmallRuns(false, () => assert.equal(resumeFeature(b.id, { live }).action, 'resume'));
}));

// ---- Shaper small runs B1: the marker saved on the planning run decides the card, never the live flag -------------------
const mark = (pid) => getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?')
  .run(JSON.stringify({ questions: { asked: 0, skipped: 0 }, revises: [], shapeScore: null, smallRuns: true }), pid);

test('B1: a marked run keeps the one card with the flag off (smallRuns: true, last), before and after the split', () => withSmallRuns(false, () => {
  const solo = pipe('running');
  mark(solo);
  appendAuditById(solo, 'Requirements approval **approve**.');
  assert.deepEqual(shaperCard(solo, { shaped: (p) => p === solo }),
    { pipelineId: solo, feature: null, log: [{ key: 'p-0', run: null, text: 'Requirements agreed', detail: [] }], smallRuns: true });
  const { id, pid } = mk(2);
  mark(pid);
  const c = shaperCard(pid);
  assert.equal(c.feature.id, id);
  assert.deepEqual(Object.keys(c), ['pipelineId', 'feature', 'log', 'smallRuns']);
  assert.equal(c.smallRuns, true);
}));

test('B1: an unmarked run stays dev\'s with the flag on: shaperCard has no smallRuns key', () => withSmallRuns(true, () => {
  const solo = pipe('running');
  appendAuditById(solo, 'Plan approval **approve**.');
  assert.deepEqual(shaperCard(solo, { shaped: () => true }), { pipelineId: solo, feature: null, log: [{ key: 'p-0', run: null, text: 'Plan approved', detail: [] }] });
  const { pid } = mk(2);
  assert.deepEqual(Object.keys(shaperCard(pid)), ['pipelineId', 'feature', 'log']);
}));

test('B1: a re-plan of a marked feature reads marked (its re-plan run inherits the stamp)', () => withSmallRuns(false, () => {
  const a = mk(2);
  mark(a.pid);
  const pidR = pipe('running');
  mark(pidR);                                         // the harness stamps a re-plan run of a marked feature (replacesMarked)
  const b = mk(2, { pipelineId: pidR, replaces: a.id });
  assert.equal(currentFeatureId(a.id), b.id);
  assert.equal(shaperCard(a.pid).feature.id, b.id);
  assert.equal(shaperCard(a.pid).smallRuns, true);
}));

test('B1/B2 (D20): a marked feature with the flag off: shaperCard has smallRuns, featureView reads the marker for its care key', () => withSmallRuns(false, () => {
  const { id, pid } = mk(2);
  mark(pid);
  assert.equal(shaperCard(pid).smallRuns, true);
  assert.deepEqual(featureView(id).care, { position: 'balanced', chosenBy: 'default', worcaPick: null });
  assert.deepEqual(Object.keys(featureView(id)), [...DEV_KEYS.view, 'care', 'requirementKinds']);
  const other = mk(2);
  assert.deepEqual(Object.keys(featureView(other.id)), DEV_KEYS.view, 'an unmarked feature stays dev\'s');
}));

test('B1: the one card\'s log words the split "Runs approved"; featureView without oneCard keeps dev\'s log', () => withSmallRuns(false, () => {
  const { id, pid } = mk(2);
  mark(pid);
  appendAuditById(pid, 'Requirements approval **approve**.');
  appendAuditById(pid, 'Plan approval **approve**.');
  appendAuditById(pid, 'Slice outline **approve** (round 1).');
  assert.deepEqual(featureView(id).log.map((l) => l.text), ['Plan approved', 'Plan approved', 'Split into 2 runs'], 'the feature page: dev\'s words');
  assert.deepEqual(featureView(id, { oneCard: true }).log.map((l) => l.text), ['Requirements agreed', 'Plan approved', 'Runs approved']);
  const c = shaperCard(pid);
  assert.deepEqual(c.log.map((l) => l.text), ['Requirements agreed', 'Plan approved', 'Runs approved']);
  assert.equal(c.log, c.feature.log);
}));

test('B1: chatShipCardOffered is false for a marked feature, true otherwise', () => withSmallRuns(true, () => {
  const a = mk(2);
  const b = mk(2);
  mark(b.pid);
  assert.equal(chatShipCardOffered(featureView(a.id)), true);
  assert.equal(chatShipCardOffered(featureView(b.id)), false);
}));

// ---- Shaper small runs B2: the Care saved at the Start step -----------------------------------------------------------
const START_CARE = { position: 'lean', chosenBy: 'person', worcaPick: 'thorough', reason: 'Worca picks Thorough: it touches payments',
  facts: { touches: ['payments'], requirements: 3, subsystems: [], screens: false, size: 'small' }, at: '2026-11-21T10:00:00.000Z' };
const markWithCare = (pid) => getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?')
  .run(JSON.stringify({ questions: { asked: 0, skipped: 0 }, revises: [], shapeScore: null, smallRuns: true, care: START_CARE }), pid);

test('B2: shaperCard returns care for a marked run with saved Care, before and after the split; none for an unmarked run', () => withSmallRuns(true, () => {
  const solo = pipe('running');
  markWithCare(solo);
  const c = shaperCard(solo, { shaped: () => true });
  assert.deepEqual(c.care, START_CARE);
  assert.deepEqual(Object.keys(c), ['pipelineId', 'feature', 'log', 'smallRuns', 'care']);
  const { pid } = mk(2);
  markWithCare(pid);
  assert.deepEqual(shaperCard(pid).care, START_CARE);
  const plain = pipe('running');
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ care: START_CARE }), plain);
  assert.equal('care' in shaperCard(plain, { shaped: () => true }), false, 'unmarked: no care key');
  const bare = pipe('running');
  mark(bare);
  assert.equal('care' in shaperCard(bare, { shaped: () => true }), false, 'marked, no Care yet');
}));

test('B2: createSliceFeature with smallRuns writes Care with the flag off; smallRuns omitted with the flag off writes none', () => withSmallRuns(false, () => {
  const careRow = (fid) => careOfRow(getDb().prepare('SELECT care, care_chosen_by, care_worca_pick FROM shape_features WHERE id = ?').get(fid));
  const a = mk(2, { care: START_CARE, smallRuns: true });
  assert.deepEqual(careRow(a.id), { position: 'lean', chosenBy: 'person', worcaPick: 'thorough' });
  const b = mk(2, { care: START_CARE });
  assert.deepEqual(careRow(b.id), { position: 'balanced', chosenBy: 'default', worcaPick: null });
}));

// ---- Shaper small runs C1: the Prototype step's record on the card ---------------------------------------------------
const PROTO = { v: 1, state: 'confirmed', screenIds: ['R-ux-1'], designId: 'd_1', buildId: 'b_1', round: 1, version: 2,
  screens: [{ section: 'editor', name: 'Template editor', ids: ['R-ux-1'] }], costUsd: 2.8, findings: [], reviewRounds: 0,
  remarks: 1, rebuilt: true, ref: { dir: '/secret/prototype-confirmed', version: 2, designId: 'd_1' }, at: '2026-11-21T10:00:00.000Z' };
const markWithProto = (pid, extra = { smallRuns: true }) => getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?')
  .run(JSON.stringify({ questions: { asked: 0, skipped: 0 }, revises: [], shapeScore: null, ...extra, prototype: PROTO }), pid);

test('C1: shaperCard returns prototype only for a marked card, with no file path; featureView likewise', () => withSmallRuns(true, () => {
  const solo = pipe('running');
  markWithProto(solo);
  const c = shaperCard(solo, { shaped: () => true });
  assert.equal(c.prototype.state, 'confirmed');
  assert.deepEqual(c.prototype.screens, PROTO.screens);
  assert.equal(c.prototype.version, 2);
  assert.ok(!JSON.stringify(c).includes('/secret/'), 'no ref.dir');
  assert.equal('ref' in c.prototype, false);
  const { id, pid } = mk(2);
  markWithProto(pid);
  assert.equal(shaperCard(pid).prototype.state, 'confirmed');
  assert.equal(featureView(id).prototype.state, 'confirmed');
  assert.ok(!JSON.stringify(featureView(id)).includes('/secret/'));
  const plain = pipe('running');
  markWithProto(plain, {});
  assert.equal('prototype' in shaperCard(plain, { shaped: () => true }), false, 'unmarked: no prototype key');
  const bare = pipe('running');
  mark(bare);
  assert.equal('prototype' in shaperCard(bare, { shaped: () => true }), false, 'marked, no record');
}));

// ── Small runs C3 (D8, D15): an open stop is not going; a held one is; a marked view names the stop and who waits ──
const STOP_PQ = { id: 'g1', kind: 'gate', stop: { reason: 'objection', run: 1 } };
test('C3: rowGoing/busySliceOf: an open stop is not going, a held stop is; dev\'s gate ask and a cost pause are unchanged', () => {
  const f = mk(2);
  const live = (extra) => (pid) => (pid === f.pid ? liveSliceFrom({ runId: 'r1', status: 'running', approved: true, ...extra }) : null);
  assert.equal(busySliceOf(f.id, { live: live({ pendingQuestion: STOP_PQ }) }), null, 'an open stop is not going');
  assert.deepEqual(busySliceOf(f.id, { live: live({ pendingQuestion: STOP_PQ, heldStop: { id: 'g1', after: 2 } }) }), { index: 1 });
  assert.deepEqual(busySliceOf(f.id, { live: live({ pendingQuestion: { id: 'g1', kind: 'gate' } }) }), { index: 1 }, 'dev: a gate ask is going');
  // A live slice paused on a cost limit: the same answer whether or not the feature is marked.
  const paused = live({ status: 'paused', pendingQuestion: null });
  const before = busySliceOf(f.id, { live: paused });
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), f.pid);
  assert.deepEqual(busySliceOf(f.id, { live: paused }), before);
  assert.equal('stop' in liveSliceFrom({ runId: 'r', status: 'running', pendingQuestion: { id: 'c', kind: 'recovery' } }), false);
});

test('C3: featureView of a marked feature: the stopped run carries stop, a run building on it waitsFor; unmarked adds neither', () => {
  const p1 = pipe('running');
  const outline = { why: 'x', slices: [slice(1), slice(2), slice(3, { dependsOn: ['s1'] })] };
  const f = createSliceFeature({ pipelineId: p1, projectDir: root, title: 'Charts', outline, perspectives: ['product'], workflowId: 'wf_shape' });
  const live = (held) => (pid) => (pid === p1 ? liveSliceFrom({ runId: 'r1', status: 'running', pendingQuestion: STOP_PQ, heldStop: held }) : null);
  const plain = featureView(f.id, { live: live(null) });
  assert.ok(plain.slices.every((s) => !('stop' in s) && !('waitsFor' in s)), 'unmarked: no new keys');
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), p1);
  const v = featureView(f.id, { live: live(null) });
  assert.deepEqual(v.slices[0].stop, { reason: 'objection', held: false });
  assert.equal(v.slices[2].waitsFor, 1);
  assert.equal('waitsFor' in v.slices[1], false, 'an independent run waits for nobody');
  assert.deepEqual(featureView(f.id, { live: live({ id: 'g1', after: 2 }) }).slices[0].stop, { reason: 'objection', held: true, after: 2 });
});

// ── Small runs C4: a requirement change written in one transaction ──
const AGREED_C4 = [{ id: 'R-po-1', text: 'reset emails send once' }, { id: 'R-po-2', text: 'members only' }];
const outlineC4 = (n) => ({ ...outlineOf(n), agreed: AGREED_C4.map((a) => ({ ...a })),
  slices: outlineOf(n).slices.map((s, i) => ({ ...s, requirements: [i === 0 ? 'R-po-1' : 'R-po-2'] })) });
const mkC4 = (n, over = {}) => mk(n, { outline: outlineC4(n), ...over });
const snapC4 = (fid) => JSON.stringify([getDb().prepare('SELECT * FROM shape_features WHERE id = ?').all(fid),
  getDb().prepare('SELECT * FROM scheduled_runs WHERE id IN (SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ?) ORDER BY id').all(fid),
  getDb().prepare('SELECT * FROM shape_feature_slices WHERE feature_id = ? ORDER BY idx').all(fid)]);
const CH2 = { id: 'R-po-2', from: 'members only', to: 'members and guests' };
const entryC4 = (over = {}) => ({ id: 'R-po-2', from: 'members only', to: 'members and guests', at: new Date().toISOString(), by: 'ann',
  source: { kind: 'chat' }, case: 'not-started', run: 2, ...over });
const outlineRow = (fid) => JSON.parse(getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(fid).outline);

test('C4: the text and the entry are written; every scheduled or missed ticket is re-issued with the new text, old ones canceled', () => {
  const a = mkC4(4, { pipelineId: pipe('done') });
  const [, r2, r3, r4] = tickets(a.id);
  setTicket(r3.ticket_id, 'missed');
  const out = changeAgreedRequirements(a.id, { changes: [CH2], entries: [entryC4()], by: 'ann' });
  assert.deepEqual(out.added, []); assert.deepEqual(out.restarted, []);
  const o = outlineRow(a.id);
  assert.equal(o.agreed.find((x) => x.id === 'R-po-2').text, 'members and guests');
  assert.equal(o.changes.length, 1);
  const rows = tickets(a.id);
  for (const [i, old] of [[1, r2], [2, r3], [3, r4]]) {
    assert.notEqual(rows[i].ticket_id, old.ticket_id);
    assert.equal(getTicket(old.ticket_id).status, 'canceled');
    const t = getTicket(rows[i].ticket_id, { withRequest: true });
    assert.equal(t.status, 'scheduled');
    assert.equal(t.request.shape.slice.outline.agreed.find((x) => x.id === 'R-po-2').text, 'members and guests');
    assert.match(t.request.prompt, /members and guests/);
    assert.equal(t.request.internal.startedBy, 'ann', 'the old request keeps its starter');
  }
  assert.deepEqual(getTicket(rows[1].ticket_id).after, { kind: 'pipeline', id: a.pid, policy: 'done' });
  assert.deepEqual(getTicket(rows[2].ticket_id).after, { kind: 'ticket', id: rows[1].ticket_id, policy: 'done' });
  assert.deepEqual(getTicket(rows[3].ticket_id).after, { kind: 'ticket', id: rows[2].ticket_id, policy: 'done' });
});

test('C4: a restart index gets its restart ticket from the new text (run 1: due now on the source branch; run k: after run k-1)', () => {
  const a = mkC4(3);                                            // run 1 running
  const now = Date.now();
  const one = changeAgreedRequirements(a.id, { changes: [{ id: 'R-po-1', from: 'reset emails send once', to: 'reset emails retry once' }],
    entries: [entryC4({ id: 'R-po-1', case: 'running', run: 1 })], restart: [1], by: 'ann', now });
  const t1 = getTicket(one.restarted[0].ticketId, { withRequest: true });
  assert.equal(t1.after, null);
  assert.ok(Date.parse(t1.runAt) <= now);
  assert.equal(t1.request.sourceBranch, 'main');
  assert.match(t1.request.prompt, /reset emails retry once/);
  const rows = tickets(a.id);
  assert.equal(rows[0].ticket_id, t1.id); assert.equal(rows[0].pipeline_id, null);
  assert.deepEqual(getTicket(rows[1].ticket_id).after, { kind: 'ticket', id: t1.id, policy: 'done' }, 'run 2 follows the restart');
  assert.equal(getDb().prepare('SELECT origin_pipeline_id FROM shape_features WHERE id = ?').get(a.id).origin_pipeline_id, a.pid);
  const b = mkC4(3, { pipelineId: pipe('done') });
  const p2 = pipe('running');
  setTicket(tickets(b.id)[1].ticket_id, 'fired', { pipelineId: p2 });
  getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = 2').run(p2, b.id);
  const two = changeAgreedRequirements(b.id, { changes: [CH2], entries: [entryC4({ case: 'running' })], restart: [2], by: 'ann' });
  const t2 = getTicket(two.restarted[0].ticketId, { withRequest: true });
  assert.deepEqual(t2.after, { kind: 'pipeline', id: b.pid, policy: 'done' });
  assert.equal(t2.sourceFromPrevious, true);
  assert.match(t2.request.prompt, /members and guests/);
  assert.equal(tickets(b.id)[1].ticket_id, t2.id);
});

test('C4: an append in the same call keeps the new text in outline.agreed and its ticket carries it', () => {
  const { id } = three({ allDone: true });
  getDb().prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify(outlineC4(3)), id);
  const out = changeAgreedRequirements(id, { changes: [CH2], entries: [entryC4({ case: 'finished', added: 4 })],
    appendFor: [{ ownerIndex: 2, ids: ['R-po-2'], title: 'Change: R-po-2', goal: 'R-po-2 now reads: members and guests' }], by: 'ann' });
  assert.deepEqual(out.added.map((x) => [x.ownerIndex, x.index]), [[2, 4]]);
  const o = outlineRow(id);
  assert.equal(o.agreed.find((x) => x.id === 'R-po-2').text, 'members and guests');
  assert.equal(o.changes.length, 1);
  assert.deepEqual(o.slices[3].requirements, ['R-po-2']);
  const v = featureView(id);
  assert.equal(v.slices[3].kind, 'change');
  assert.match(getTicket(out.added[0].ticketId, { withRequest: true }).request.prompt, /members and guests/);
});

test('C4: a STALE from throws and leaves the row, tickets and slice rows byte-equal', () => {
  const a = mkC4(3, { pipelineId: pipe('done') });
  const before = snapC4(a.id);
  assert.throws(() => changeAgreedRequirements(a.id, { changes: [{ ...CH2, from: 'something else' }], entries: [entryC4()], restart: [], by: 'ann' }),
    (e) => e.code === 'STALE' && e.status === 409 && /R-po-2 changed since: read it again/.test(e.message));
  assert.equal(snapC4(a.id), before);
});

test('C4: outline.changes keeps the newest 32; appendFeatureRun(change) stores kind and requirements', () => {
  const a = mkC4(2, { pipelineId: pipe('done') });
  let from = 'members only';
  for (let i = 0; i < 34; i++) {
    const to = `members v${i}`;
    changeAgreedRequirements(a.id, { changes: [{ id: 'R-po-2', from, to }], entries: [entryC4({ from, to, at: `2026-11-22T15:00:${String(i).padStart(2, '0')}Z` })] });
    from = to;
  }
  const o = outlineRow(a.id);
  assert.equal(o.changes.length, 32);
  assert.equal(o.changes[0].to, 'members v2');
  const r = appendFeatureRun(a.id, { title: 'Change: R-po-2', goal: 'g', kind: 'change', requirements: ['R-po-2'] });
  assert.equal(featureView(a.id).slices[2].kind, 'change');
  assert.deepEqual(outlineRow(a.id).slices[2].requirements, ['R-po-2']);
  assert.ok(getTicket(r.ticketId).after, 'a change run chains like extra');
  assert.throws(() => appendFeatureRun(a.id, { title: 'x', kind: 'nope' }), TypeError);
});

test('C4 (D8): a paused slice with a newer waiting change entry restarts instead of resuming', () => {
  const a = mkC4(2, { pipelineId: pipe('paused', { startedAt: '2026-01-01T00:00:00.000Z' }) });
  assert.equal(resumeFeature(a.id).action, 'resume');
  changeAgreedRequirements(a.id, { changes: [{ id: 'R-po-1', from: 'reset emails send once', to: 'reset emails retry once' }],
    entries: [entryC4({ id: 'R-po-1', case: 'waiting', run: 1 })] });
  const res = resumeFeature(a.id, { by: 'ann' });
  assert.equal(res.action, 'restart');
  assert.match(getTicket(res.ticketId, { withRequest: true }).request.prompt, /reset emails retry once/);
});

test('C4: re-issue keeps a held ticket held and copies its timing', async () => {
  const a = mkC4(3, { pipelineId: pipe('done'), approveEach: true });
  const old = getTicket(tickets(a.id)[1].ticket_id);
  assert.equal(ticketHeld(old), true);
  changeAgreedRequirements(a.id, { changes: [CH2], entries: [entryC4()] });
  const nt = getTicket(tickets(a.id)[1].ticket_id);
  assert.notEqual(nt.id, old.id);
  assert.equal(ticketHeld(nt), true);
  assert.equal(nt.runAt, old.runAt);
  assert.equal(nt.forced, false);
});

test('C4 (D17): featureView.change is the newest entry whose landing run is not done; the log has every other entry', () => {
  const a = mkC4(3, { pipelineId: pipe('done') });
  assert.equal('change' in featureView(a.id), false, 'no entry: dev\'s shape');
  changeAgreedRequirements(a.id, { changes: [{ id: 'R-po-1', from: 'reset emails send once', to: 'x1' }],
    entries: [entryC4({ id: 'R-po-1', from: 'reset emails send once', to: 'x1', case: 'none', run: null, at: '2026-11-22T15:00:00Z' })] });
  changeAgreedRequirements(a.id, { changes: [CH2], entries: [entryC4({ at: '2026-11-22T15:01:00Z' })] });
  const v = featureView(a.id);
  assert.equal(v.change.id, 'R-po-2');
  assert.equal(v.changes.length, 2);
  const texts = v.log.map((l) => l.text);
  assert.ok(texts.includes('R-po-1 changed'));
  assert.ok(!texts.some((t) => t.startsWith('R-po-2 changed')), 'the notice is not a log row too');
  const p2 = pipe('done');
  setTicket(tickets(a.id)[1].ticket_id, 'fired', { pipelineId: p2 });
  const w = featureView(a.id);
  assert.equal(w.change, null);
  assert.ok(w.log.map((l) => l.text).includes('R-po-2 changed · run 2 plans from the new text'));
});

// ---- Feature D1 (Ship): a marked feature's gate counts only the requirements a person confirms ----

test('D1: a marked gate counts only confirmed ids while ship.acceptance keeps every agreed id; unmarked keeps its keys', () => withSmallRuns(false, () => {
  const pid = pipe('done');
  const { id } = withSmallRuns(true, () => mk(2, { pipelineId: pid, outline: kindsOutline(), requirementKinds: COMPLIANCE }));
  const t2 = tickets(id)[1].ticket_id;
  setTicket(t2, 'fired', { pipelineId: pipe('done') });
  const before = featureView(id);
  assert.equal(before.ship.smallRuns, undefined, 'unmarked: no smallRuns key');
  assert.deepEqual(Object.keys(before.ship), DEV_KEYS.shipWithAgreed);
  assert.match(acceptanceRefusal(before).error, /mark every requirement/);
  mark(pid);
  const v = featureView(id);
  assert.deepEqual(v.ship.acceptance.items.map((i) => i.id), ['R-po-1', 'R-sec-1', 'R-qa-1']);
  assert.deepEqual(v.ship.smallRuns.waiting, ['R-sec-1']);
  assert.deepEqual(acceptanceRefusal(v), { error: 'Waiting for Compliance to confirm R-sec-1', code: 'ACCEPTANCE_INCOMPLETE', missing: ['R-sec-1'], role: 'compliance' });
  assert.deepEqual(v.ship.smallRuns.order.map((o) => [o.index, o.onto]), [[1, null], [2, null]]);
  assert.equal(v.ship.smallRuns.base, 'main');
  assert.equal(v.ship.smallRuns.care.line, "Care: Balanced · Worca's pick");
  assert.equal(chatShipCardOffered(v), false);
  setFeatureAcceptance(id, [{ id: 'R-sec-1', mark: 'met', role: 'compliance', by: 'ann', at: '2026-11-22T16:55:00.000Z' }]);
  const after = featureView(id);
  assert.equal(acceptanceRefusal(after), null, 'owned ids need no mark');
  assert.equal(after.ship.acceptance.ready, false, 'the classic ledger is untouched');
  assert.equal(after.ship.smallRuns.confirmed[0].at, '2026-11-22T16:55:00.000Z');
}));

test('fail closed: flag on, an agreed requirement with no run and no person keeps the feature from being ready; flag off: as today', () => {
  const pid = pipe('done');
  const { id } = withSmallRuns(true, () => mk(2, { pipelineId: pid, outline: kindsOutline() }));   // R-sec-1: no slice, no person
  setTicket(tickets(id)[1].ticket_id, 'fired', { pipelineId: pipe('done') });
  mark(pid);
  withSmallRuns(true, () => {
    const v = featureView(id);
    const reason = 'R-sec-1 is owned by no run and confirmed by no person';
    assert.equal(v.ship.ready, false);
    assert.deepEqual(v.ship.smallRuns.unowned, ['R-sec-1']);
    assert.deepEqual(acceptanceRefusal(v), { error: reason, code: 'ACCEPTANCE_INCOMPLETE', missing: ['R-sec-1'], role: null });
    assert.equal(shipHold(id), reason);
  });
  withSmallRuns(false, () => {
    const v = featureView(id);
    assert.equal(v.ship.ready, true);
    assert.equal('unowned' in v.ship.smallRuns, false);
    assert.equal(acceptanceRefusal(v), null);
  });
  const held = withSmallRuns(true, () => mk(2, { outline: kindsOutline(), requirementKinds: COMPLIANCE }));
  assert.equal(shipHold(held.id), null);
  assert.equal(shipHold('feat_none'), null);
});

// ---- Re-plan the rest carries the requirements no finished run owns ----
/** A marked 4-run feature: run 1 done, run 2 stopped, run 3 waits, run 4 canceled; one id confirmed, one owner-less. */
const carryFeature = (over = {}) => {
  const o = outlineOf(4);
  o.slices.forEach((s, i) => { s.requirements = [`R-po-${i + 1}`]; });
  o.agreed = [...o.slices.map((s, i) => ({ id: `R-po-${i + 1}`, text: `Text ${i + 1}`, ...(i === 1 ? { example: 'e.g. 2' } : {}) })),
    { id: 'R-sec-1', text: 'It is safe' }, { id: 'R-ops-1', text: 'It is watched' }];
  o.leftOut = [];
  const pid = pipe('done');
  const { id } = withSmallRuns(true, () => mk(4, { pipelineId: pid, outline: o, requirementKinds: COMPLIANCE, ...over }));
  const t = tickets(id);
  setTicket(t[1].ticket_id, 'fired', { pipelineId: pipe('stopped') });
  setTicket(t[3].ticket_id, 'canceled');
  mark(pid);
  return id;
};

test('carriedRequirements: a finished owner\'s ids stay behind; every other owner\'s, confirmed and owner-less ones are carried', () => {
  const id = carryFeature();
  assert.deepEqual(carriedRequirements(id), {
    agreed: [{ id: 'R-po-2', text: 'Text 2', example: 'e.g. 2' }, { id: 'R-po-3', text: 'Text 3' }, { id: 'R-po-4', text: 'Text 4' },
      { id: 'R-sec-1', text: 'It is safe' }, { id: 'R-ops-1', text: 'It is watched' }],
    confirmed: [{ id: 'R-sec-1', role: 'compliance' }], done: [1] });
  for (const none of [null, 'feat_none']) assert.deepEqual(carriedRequirements(none), { agreed: [], confirmed: [], done: [] });
});

test('replanRest: a marked feature with the flag on hands its list to the slice-requirements workflow (the UX one with ux)', () => {
  const requestOf = (id) => withSmallRuns(true, () => getTicket(replanRest(id).ticketId, { withRequest: true }).request);
  const r = requestOf(carryFeature());
  assert.equal(r.workflowId, 'wf_shape_slice_req');
  assert.match(r.prompt, /^## Agreed requirements\n\n- \*\*R-po-2\*\* Text 2\n {2}Example: e\.g\. 2\n- \*\*R-po-3\*\* Text 3$/m);
  assert.match(r.prompt, /R-sec-1 \(Compliance\)/);
  assert.equal(requestOf(carryFeature({ perspectives: ['product', 'ux'] })).workflowId, 'wf_shape_ux_slice_req');
});

test('replanRest: after out-of-order finishes the carried re-plan starts from the run that finished last, which holds every finished run\'s work', () => {
  const o = outlineOf(4);
  o.slices.forEach((s, i) => { s.requirements = [`R-po-${i + 1}`]; });
  o.agreed = o.slices.map((s, i) => ({ id: `R-po-${i + 1}`, text: `Text ${i + 1}` }));
  o.leftOut = [];
  const pid = pipe('done');
  const { id } = withSmallRuns(true, () => mk(4, { pipelineId: pid, outline: o }));
  const t = tickets(id);
  const p2 = pipe('done'); const p3 = pipe('done');
  setTicket(t[1].ticket_id, 'fired', { pipelineId: p2 });
  setTicket(t[2].ticket_id, 'fired', { pipelineId: p3 });
  mark(pid);
  // Run 2 was resumed after run 3 finished: it took run 3's branch in and finished last.
  const at = (p, d) => getDb().prepare('UPDATE pipelines SET updated_at = ? WHERE id = ?').run(d, p);
  at(pid, '2026-03-01T00:00:00Z'); at(p3, '2026-03-03T00:00:00Z'); at(p2, '2026-03-05T00:00:00Z');
  const r = withSmallRuns(true, () => getTicket(replanRest(id).ticketId, { withRequest: true }).request);
  assert.equal(r.sourceBranch, `feat/${p2}`);
  assert.match(r.prompt, /^- \*\*R-po-4\*\* Text 4$/m);
  assert.doesNotMatch(r.prompt, /^- \*\*R-po-[123]\*\*/m);
});

test('replanRest: the flag off, an unmarked feature, or nothing left to carry keeps today\'s request, key for key', () => {
  const wants = (id) => {
    const f = getDb().prepare('SELECT * FROM shape_features WHERE id = ?').get(id);
    const doneCount = featureView(id).done;
    return { prompt: replanBrief({ featureTitle: f.title, outline: JSON.parse(f.outline), doneCount }), workflowId: f.workflow_id,
      shape: { perspectives: JSON.parse(f.perspectives), slices: 'auto', replaces: id } };
  };
  const check = (on, id) => {
    const want = withSmallRuns(on, () => wants(id));
    const r = withSmallRuns(on, () => getTicket(replanRest(id).ticketId, { withRequest: true }).request);
    assert.deepEqual({ prompt: r.prompt, workflowId: r.workflowId, shape: r.shape }, want);
    assert.deepEqual(Object.keys(r).sort(), ['internal', 'projectDir', 'prompt', 'shape', 'sourceBranch', 'title', 'workflowId']);
  };
  check(false, carryFeature());
  const plain = carryFeature();
  getDb().prepare("UPDATE pipelines SET shape_stats = NULL WHERE id = (SELECT origin_pipeline_id FROM shape_features WHERE id = ?)").run(plain);
  check(true, plain);
  // Run 1 (done) owns the only requirement: nothing is left.
  const o = outlineOf(2);
  o.slices[0].requirements = ['R-po-1']; o.slices[1].requirements = [];
  o.agreed = [{ id: 'R-po-1', text: 'People see it' }]; o.leftOut = [];
  const pid = pipe('done');
  const { id } = withSmallRuns(true, () => mk(2, { pipelineId: pid, outline: o }));
  mark(pid);
  check(true, id);
});

test('D3: flag on, marked: every ship.smallRuns entry has shown; flag off: none', () => {
  const pid = pipe('done');
  const { id } = withSmallRuns(true, () => mk(2, { pipelineId: pid, outline: kindsOutline(), requirementKinds: COMPLIANCE }));
  mark(pid);
  const on = withSmallRuns(true, () => featureView(id).ship.smallRuns);
  assert.deepEqual(on.owned.map((o) => [o.id, o.shown.text, o.shown.mark]), [['R-po-1', 'run 1 · met', 'check'], ['R-qa-1', 'run 2 · to do', 'wait']]);
  assert.deepEqual(on.confirmed.map((c) => [c.id, c.shown.text]), [['R-sec-1', 'confirmed by a person · Compliance']]);
  const off = withSmallRuns(false, () => featureView(id).ship.smallRuns);
  assert.ok([...off.owned, ...off.confirmed].every((e) => !('shown' in e)), 'flag off: D1\'s entries');
  assert.deepEqual(off.met, on.met);
});

// ---- Shaper small runs D2 (D7, D8, D14): a run's Owns, Starts from and stored agent facts -----------------------------

const SLICE_DEV_KEYS = ['featureId', 'title', 'index', 'total', 'sliceTitle', 'state', 'next'];
/** A 10-run feature: run k owns R-po-k; each later run's stored source is the previous run's branch (run 1's the base). */
function tenRunFeature({ marked = true, sources = true } = {}) {
  const origin = pipe('done', { branch: { source: 'main', feature: 'feat/run-1' } });
  if (marked) getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run('{"smallRuns":true}', origin);
  const o = outlineOf(10);
  o.slices.forEach((s, i) => { s.requirements = [`R-po-${i + 1}`]; });
  o.agreed = o.slices.map((s, i) => ({ id: `R-po-${i + 1}`, text: `Requirement\n   ${i + 1}` }));
  o.leftOut = [];
  const { id } = mk(10, { pipelineId: origin, outline: o });
  const pids = [origin];
  for (let k = 2; k <= 10; k++) {
    const p = pipe('done', { branch: sources ? { source: `feat/run-${k - 1}`, feature: `feat/run-${k}` } : { feature: `feat/run-${k}`, source: null } });
    getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = ?').run(p, id, k);
    pids.push(p);
  }
  return { id, pids };
}

test('D2 (D8): a marked feature with the flag on: all 10 runs (run 1 included) answer owns and a non-null startsFrom', () => {
  const { pids } = tenRunFeature();
  withSmallRuns(true, () => {
    pids.forEach((pid, i) => {
      const s = sliceOfPipeline(pid);
      assert.equal(s.index, i + 1);
      assert.deepEqual(Object.keys(s).slice(0, SLICE_DEV_KEYS.length), SLICE_DEV_KEYS);
      assert.deepEqual(s.owns, [{ id: `R-po-${i + 1}`, text: `Requirement ${i + 1}`, pass: null, word: 'met', mark: 'check' }], 'D3: the word of a done run');
      assert.ok(s.startsFrom, `run ${i + 1} has a startsFrom`);
      if (i === 0) assert.deepEqual(s.startsFrom, { kind: 'feature', branch: 'main', text: 'the feature branch: nothing is finished yet' });
      else assert.deepEqual(s.startsFrom, { kind: 'run', run: i, branch: `feat/run-${i}`, text: `the latest finished run (run ${i})` });
    });
  });
});

test('D2 (D8): a marked run whose row stores no source answers startsFrom: null and still its owns', () => {
  const { pids } = tenRunFeature({ sources: false });
  withSmallRuns(true, () => {
    const s = sliceOfPipeline(pids[4]);
    assert.equal(s.startsFrom, null);
    assert.ok('startsFrom' in s);
    assert.deepEqual(s.owns.map((r) => r.id), ['R-po-5']);
  });
});

test('D2 (D8): flag off, or an unmarked feature: sliceOfPipeline keeps dev\'s keys (no owns, no startsFrom)', () => {
  const marked = tenRunFeature();
  const plain = tenRunFeature({ marked: false });
  withSmallRuns(false, () => assert.deepEqual(Object.keys(sliceOfPipeline(marked.pids[2])), SLICE_DEV_KEYS));
  withSmallRuns(true, () => assert.deepEqual(Object.keys(sliceOfPipeline(plain.pids[2])), SLICE_DEV_KEYS));
});

test('D2 (D14): storedAgentFacts reads plan versions, a done plan review and a stored test count; it writes nothing', async () => {
  const changes = () => getDb().prepare('SELECT total_changes() AS n').get().n;
  const step = (pid, key, nodeId, status, meta) => getDb().prepare(`INSERT INTO pipeline_steps (pipeline_id, key, node_id, status, exec_meta)
    VALUES (?, ?, ?, ?, ?)`).run(pid, key, nodeId, status, meta == null ? null : JSON.stringify(meta));
  const none = pipe('done');
  let before = changes();
  assert.deepEqual(await storedAgentFacts(none), { planVersion: null, planReviewed: false, tests: null });
  assert.equal(changes(), before);

  const both = pipe('done');
  recordArtifact(both, 'plan', 'plans/x.md');
  recordArtifact(both, 'plan', 'plans/x-v2.md');
  step(both, '3:n_roles', 'n_roles', 'done');
  step(both, '6:n_check', 'n_check', 'done', { tests: { passed: 12, total: 12 } });
  before = changes();
  assert.deepEqual(await storedAgentFacts(both), { planVersion: 2, planReviewed: true, tests: { passed: 12, total: 12 } });
  assert.equal(changes(), before, 'total_changes() unchanged: no write');

  const noReview = pipe('done');
  recordArtifact(noReview, 'plan', 'plans/y-v2.md');
  step(noReview, '3:n_roles', 'n_roles', 'start');
  assert.deepEqual(await storedAgentFacts(noReview), { planVersion: 2, planReviewed: false, tests: null });

  for (const bad of [{ passed: 13, total: 12 }, { passed: 1.5, total: 2 }, { passed: 0, total: 0 }, { passed: -1, total: 2 }, { passed: '3', total: 3 }, 'x']) {
    const p = pipe('done');
    step(p, '5:n_impl', 'n_impl', 'done', { tests: bad });
    assert.equal((await storedAgentFacts(p)).tests, null, JSON.stringify(bad));
  }
  const impl = pipe('done');
  step(impl, '5:n_impl', 'n_impl', 'done', { tests: { passed: 3, total: 4 } });
  assert.deepEqual((await storedAgentFacts(impl)).tests, { passed: 3, total: 4 });
});

// ---- Slice 6 (D12): without an index, Resume still restarts the first halted run, as today --------------------------
test('resumeFeature without an index restarts the first halted run (run 5), not run 9', () => withSmallRuns(true, () => {
  const fx = world(root, { done: [1, 3, 4], states: { 5: { pipe: 'error' }, 9: { pipe: 'error' } } });
  const rowTickets = () => new Map(tickets(fx.featureId).map((r) => [r.idx, r.ticket_id]));
  const before = rowTickets();
  const res = resumeFeature(fx.featureId, { live: fx.live });
  assert.equal(res.action, 'restart');
  assert.equal(rowTickets().get(5), res.ticketId);
  assert.notEqual(res.ticketId, before.get(5));
  assert.equal(rowTickets().get(9), before.get(9));
}));
