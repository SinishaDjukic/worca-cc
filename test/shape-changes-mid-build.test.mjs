// test/shape-changes-mid-build.test.mjs — Shaper small runs C4: a requirement change mid-build lands by where the run
// that owns it is (not started, waiting, running, finished), from a chat card or a run's requirement stop, through the
// one path applyRequirementChange (src/core/shape/changes.mjs). Real DB through useTempHome, real git for the finished
// cases, a fake runs map whose orch.stop / orch.answer record calls.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { getTicket } from '../src/core/scheduler.mjs';
import { insertRunTags } from '../src/core/run-tags-store.mjs';
import { createSliceFeature, featureView, liveSliceFrom, resumeFeature, sliceGateState, ticketHeld, cancelRest,
  changeAgreedRequirements } from '../src/core/shape/features.mjs';
import { applyRequirementChange, createRequirementChanges } from '../src/core/shape/changes.mjs';
import { createHeldStops } from '../src/core/shape/held-stops.mjs';
import { planStop } from '../src/shared/shape/run-stops.mjs';
import { reqChangeNotice } from '../src/shared/shape/req-change.mjs';

useTempHome(after, 'worca-mid-build-');
const flags = process.env.WORCA_FLAGS;
process.env.WORCA_FLAGS = 'shaperSmallRuns';
after(() => { if (flags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = flags; });

const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const root = mkdtempSync(join(tmpdir(), 'worca-mid-build-proj-'));
after(() => rmSync(root, { recursive: true, force: true }));
before(() => {
  getDb();
  git(root, 'init', '-q', '-b', 'main'); git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'f.txt'), 'x'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'init');
});

const AGREED = [1, 2, 3, 4].map((i) => ({ id: `R-po-${i}`, text: `requirement ${i} as agreed` }));
const OUTLINE = { why: 'four runs', agreed: AGREED, slices: [1, 2, 3, 4].map((i) => ({ id: `s${i}`, title: `Part ${i}`, goal: `Goal ${i}`, inScope: [],
  outOfScope: [], acceptance: [], dependsOn: [], estimate: 'M', requirements: [`R-po-${i}`] })) };
const CARE = { position: 'lean', chosenBy: 'person', worcaPick: 'balanced' };
const NEW = 'reset emails retry once, within 20 seconds';
const ch = (i, over = {}) => ({ id: `R-po-${i}`, from: `requirement ${i} as agreed`, to: NEW, ...over });

let seq = 0;
const pipe = (status, extra = {}) => {
  const id = `m${String(++seq).padStart(7, '0')}`;
  seedPipelineRow({ id, projectKey: projectKey(root), status, title: id, startedAt: '2026-01-01T00:00:00.000Z',
    branch: { source: 'main', feature: `feat/${id}` }, ...extra });
  return id;
};
/** A done run's branch with one commit of its own (real git): what "finished work is untouched" reads. */
const doneBranch = (pid) => { git(root, 'branch', '-f', `feat/${pid}`, 'main'); git(root, 'checkout', '-q', `feat/${pid}`);
  writeFileSync(join(root, `${pid}.txt`), pid); git(root, 'add', '-A'); git(root, 'commit', '-qm', pid); git(root, 'checkout', '-q', 'main'); };
const headOf = (pid) => ({ sha: git(root, 'rev-parse', `feat/${pid}`), log: git(root, 'log', '--format=%H', `feat/${pid}`),
  branch: getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(pid).branch });

const PIPE_STATUS = { done: 'done', running: 'running', stopped: 'stopped', paused: 'paused', asking: 'running', stop: 'running' };

/**
 * A marked 4-run feature. `states[k-1]` is run k's: planned (not fired), done, running (live), stopped, paused (pipelines
 * row only), asking (live at a Clarify ask), stop (live at a requirement stop, see `ask`).
 */
function world(states, { approveEach = false, tags = [] } = {}) {
  getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();
  const runs = new Map();
  const log = { stops: [], answers: [], paused: [], ticks: 0, repaints: [] };
  const origin = pipe(PIPE_STATUS[states[0]]);
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), origin);
  if (tags.length) insertRunTags(origin, tags);
  const f = createSliceFeature({ pipelineId: origin, projectDir: root, title: 'Reset emails', outline: OUTLINE, perspectives: ['product'],
    workflowId: 'wf_shape', smallRuns: true, care: CARE, approveEach, startedBy: 'ann' });
  const pids = [origin];
  states.forEach((st, i) => {
    const k = i + 1;
    let pid = origin;
    if (k > 1) {
      if (st === 'planned') { pids.push(null); return; }
      pid = pipe(PIPE_STATUS[st]);
      const t = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(f.id, k).ticket_id;
      getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(pid, t);
      getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = ?').run(pid, f.id, k);
      pids.push(pid);
    }
    if (st === 'done') doneBranch(pid);
    if (['running', 'asking', 'stop'].includes(st)) {
      const e = { id: `run-${pid}`, pipelineId: pid, status: 'running', pendingQuestion: null, heldStop: null,
        orch: { runShape: { slice: { feature: f.id, index: k } }, state: { shaping: { approved: { file: 'plan.md' } } },
          stop: (by) => { log.stops.push({ run: k, by }); }, answer: (id, payload, by) => { log.answers.push({ run: k, id, payload, by }); } } };
      if (st === 'asking') e.pendingQuestion = { id: `clarify-${k}`, kind: 'questions' };
      runs.set(e.id, e);
    }
  });
  const liveSliceOf = (pid) => {
    const e = [...runs.values()].find((x) => x.pipelineId === pid);
    if (!e || ['done', 'stopped', 'error', 'interrupted'].includes(e.status)) return null;
    return liveSliceFrom({ runId: e.id, status: e.status, pendingQuestion: e.pendingQuestion, approved: true, heldStop: e.heldStop });
  };
  const stopRun = (runId, by) => {
    const e = runs.get(runId);
    e.orch.stop(by); e.status = 'stopped'; e.pendingQuestion = null;
    return { ok: true };
  };
  const reqChanges = createRequirementChanges({ runs, stopRun, liveSliceOf,
    stopPausedPipeline: async (pid, by) => { log.paused.push({ pid, by }); },
    schedulerTick: async () => { log.ticks += 1; }, broadcastFeature: (id) => log.repaints.push(id) });
  const held = createHeldStops({ runs, liveSliceOf, broadcastFeature: () => {}, resolvePending: () => true, applyChange: reqChanges.applyStop });
  const entryOf = (k) => [...runs.values()].find((e) => e.pipelineId === pids[k - 1]);
  const view = () => featureView(f.id, { live: liveSliceOf });
  const ticketOf = (k) => getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(f.id, k).ticket_id;
  const slicesCount = () => getDb().prepare('SELECT COUNT(*) AS n FROM shape_feature_slices WHERE feature_id = ?').get(f.id).n;
  const outline = () => JSON.parse(getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(f.id).outline);
  /** Run `asker` waits at its requirement stop proposing `change`; → its entry and the stop's Change payload. */
  const askAt = (asker, change) => {
    const e = entryOf(asker);
    const stop = planStop({ run: asker, concern: { title: 'too strict', kind: 'requirement', requirements: [change.id],
      proposals: [{ id: change.id, from: change.from, text: change.to }] } });
    e.pendingQuestion = { id: `plan-n_refine-${asker}`, kind: 'plan', stop };
    return { e, stop, payload: { ...stop.options.find((o) => o.value === 'change').payload } };
  };
  return { f, runs, log, pids, liveSliceOf, reqChanges, held, entryOf, view, ticketOf, slicesCount, outline, askAt,
    chat: (changes) => reqChanges.apply(f.id, changes, { kind: 'chat', by: 'ann' }) };
}

const requestOf = (ticketId) => getTicket(ticketId, { withRequest: true }).request;
const openStops = (w) => [...w.runs.values()].filter((e) => e.pendingQuestion && e.pendingQuestion.stop);

// ── the six cases ──

test('not started × chat: the text changes and run 3 plans from it', () => {
  const w = world(['done', 'done', 'planned', 'planned']);
  const old = w.ticketOf(3);
  const r = w.chat([ch(3)]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.result.changes, [{ id: 'R-po-3', case: 'not-started', run: 3 }]);
  assert.equal(w.outline().agreed.find((a) => a.id === 'R-po-3').text, NEW);
  assert.notEqual(w.ticketOf(3), old);
  assert.ok(requestOf(w.ticketOf(3)).prompt.includes(NEW));
  assert.equal(w.view().change.case, 'not-started');
  assert.equal(w.log.ticks, 1);
  assert.deepEqual(w.log.repaints, [w.f.id]);
});

test('not started × run proposal: through the stop answer; the asker gets the revise once', () => {
  const w = world(['done', 'done', 'planned', 'stop']);
  const { e, payload } = w.askAt(4, ch(3));
  assert.equal(w.held.answer(e, e.pendingQuestion.id, payload, 'ann'), undefined);
  assert.equal(w.outline().agreed.find((a) => a.id === 'R-po-3').text, NEW);
  assert.ok(requestOf(w.ticketOf(3)).prompt.includes(NEW));
  assert.equal(w.log.answers.length, 1);
  assert.equal(w.log.answers[0].payload.decision, 'revise');
  assert.equal(w.log.answers[0].payload.source, 'requirement');
  assert.match(w.log.answers[0].payload.feedback, /R-po-3 now reads: reset emails retry once/);
  assert.match(w.log.answers[0].payload.feedback, /Run 3 builds this change/);
  assert.equal(w.outline().changes.at(-1).source.run, 4);
});

function assertRunningOwner(w, { k = 2, restart }) {
  assert.equal(w.log.stops.filter((s) => s.run === k).length, 1, 'orch.stop once');
  assert.equal(w.entryOf(k).status, 'stopped');
  assert.equal(w.entryOf(k).pendingQuestion, null);
  const t = getTicket(restart, { withRequest: true });
  assert.equal(t.status, 'scheduled');
  if (k > 1) assert.deepEqual(t.after, { kind: 'pipeline', id: w.pids[k - 2], policy: 'done' });
  assert.ok(t.request.prompt.includes(NEW));
  const row = getDb().prepare('SELECT ticket_id, pipeline_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(w.f.id, k);
  assert.deepEqual([row.ticket_id, row.pipeline_id], [restart, null]);
  const v = w.view();
  assert.equal(v.ask, null);
  assert.equal(v.change.case, 'running');
}

test('running × chat: run 2 stops, its slice follows a restart ticket with the new text; no question', () => {
  const w = world(['done', 'running', 'planned', 'planned']);
  const r = w.chat([ch(2)]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.result.changes, [{ id: 'R-po-2', case: 'running', run: 2 }]);
  assertRunningOwner(w, { restart: w.ticketOf(2) });
  assert.deepEqual(sliceGateState(getTicket(w.ticketOf(2)), { live: w.liveSliceOf }), { state: 'ok' });
  assert.deepEqual(openStops(w), []);
});

test('running × chat with "Ask me before each run" on: the restart is fired like Run now, never held or asked', () => {
  const w = world(['done', 'running', 'planned', 'planned'], { approveEach: true });
  assert.equal(w.chat([ch(2)]).ok, true);
  const t = getTicket(w.ticketOf(2));
  assert.equal(t.forced, true);
  assert.equal(ticketHeld(t), false);
  assertRunningOwner(w, { restart: t.id });
  assert.notEqual(w.view().held?.index, 2, 'the restart is not the held run');
  assert.deepEqual(openStops(w), []);
});

test('running × run proposal: the owner is stopped before the turn is read; the asker re-plans and the restart waits for it', () => {
  const w = world(['done', 'running', 'planned', 'stop']);
  const { e, payload } = w.askAt(4, ch(2));
  assert.equal(w.held.answer(e, e.pendingQuestion.id, payload, 'ann'), undefined);
  assert.equal(w.log.answers.length, 1);
  assert.equal(w.log.answers[0].payload.decision, 'revise');
  e.pendingQuestion = null;                                           // the caller resolves it; the asker is going again
  assertRunningOwner(w, { restart: w.ticketOf(2) });
  assert.deepEqual(openStops(w), []);
  assert.deepEqual(sliceGateState(getTicket(w.ticketOf(2)), { live: w.liveSliceOf }), { state: 'waiting' }, 'one run at a time (D12)');
});

test('running × run proposal, run 3 also going: the change applies at once, only the revise is held', () => {
  const w = world(['done', 'running', 'running', 'stop']);
  const { e, payload } = w.askAt(4, ch(2));
  assert.deepEqual(w.held.answer(e, e.pendingQuestion.id, payload, 'ann'), { held: true });
  assert.equal(e.heldStop.after, 3);
  assert.equal(w.outline().agreed.find((a) => a.id === 'R-po-2').text, NEW);
  assert.equal(w.entryOf(2).status, 'stopped');
  assert.deepEqual(w.log.answers, []);
});

function assertFinished(w, r, { k = 2, before, count }) {
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(headOf(w.pids[k - 1]), before, 'the finished run\'s branch, commits and row are as they were');
  assert.equal(w.slicesCount(), count + 1);
  const row = getDb().prepare('SELECT * FROM shape_feature_slices WHERE feature_id = ? ORDER BY idx DESC LIMIT 1').get(w.f.id);
  assert.equal(row.kind, 'change');
  assert.equal(row.title, `Change: R-po-${k}`);
  const o = w.outline();
  assert.deepEqual(o.slices.at(-1).requirements, [`R-po-${k}`]);
  assert.equal(o.agreed.find((a) => a.id === `R-po-${k}`).text, NEW);
  assert.equal(o.changes.at(-1).id, `R-po-${k}`);
  const v = w.view();
  assert.equal(v.change.case, 'finished');
  assert.equal(v.change.added, row.idx);
  assert.ok(requestOf(row.ticket_id).prompt.includes(NEW));
  assert.equal(v.slices.at(-1).state, 'planned');
}

test('finished × chat: one change run is appended; the finished run is untouched', () => {
  const w = world(['done', 'done', 'planned', 'planned']);
  const before = headOf(w.pids[1]);
  const r = w.chat([ch(2)]);
  assertFinished(w, r, { before, count: 4 });
  assert.deepEqual(r.result.changes, [{ id: 'R-po-2', case: 'finished', run: 2, added: 5 }]);
});

test('finished × run proposal: the same through the stop answer; the asker is told run 5 builds it', () => {
  const w = world(['done', 'done', 'planned', 'stop']);
  const before = headOf(w.pids[1]);
  const { e, payload } = w.askAt(4, ch(2));
  w.held.answer(e, e.pendingQuestion.id, payload, 'ann');
  assertFinished(w, { ok: true }, { before, count: 4 });
  assert.match(w.log.answers[0].payload.feedback, /Run 5 builds this change/);
});

// ── run 1 is an owner like any other ──

test('run 1 running: the restart is due now on the source branch with the origin\'s tags; origin_pipeline_id is kept', () => {
  const w = world(['running', 'planned', 'planned', 'planned'], { tags: ['client:acme'] });
  const now = Date.now();
  assert.equal(w.chat([ch(1)]).ok, true);
  const t = getTicket(w.ticketOf(1), { withRequest: true });
  assert.equal(t.after, null);
  assert.ok(Date.parse(t.runAt) <= now + 1000);
  assert.equal(t.request.sourceBranch, 'main');
  assert.deepEqual(t.request.tags, ['client:acme']);
  assertRunningOwner(w, { k: 1, restart: t.id });
  assert.equal(getDb().prepare('SELECT origin_pipeline_id FROM shape_features WHERE id = ?').get(w.f.id).origin_pipeline_id, w.pids[0]);
});

test('run 1 finished: one change run, the finished run untouched, the new text kept', () => {
  const w = world(['done', 'planned', 'planned', 'planned']);
  const before = headOf(w.pids[0]);
  assertFinished(w, w.chat([ch(1)]), { k: 1, before, count: 4 });
});

// ── waiting owners ──

test('waiting: a stopped owner restarts from the new text when resumed', () => {
  const w = world(['done', 'stopped', 'planned', 'planned']);
  const r = w.chat([ch(2)]);
  assert.deepEqual(r.result.changes, [{ id: 'R-po-2', case: 'waiting', run: 2 }]);
  const res = resumeFeature(w.f.id, { live: w.liveSliceOf });
  assert.equal(res.action, 'restart');
  assert.ok(requestOf(res.ticketId).prompt.includes(NEW));
});

test('waiting: a paused owner with no live entry is settled through stopPaused; until then Resume restarts it', () => {
  const w = world(['done', 'paused', 'planned', 'planned']);
  assert.equal(resumeFeature(w.f.id, { live: w.liveSliceOf }).action, 'resume');
  assert.equal(w.chat([ch(2)]).ok, true);
  assert.deepEqual(w.log.paused, [{ pid: w.pids[1], by: 'ann' }]);
  const res = resumeFeature(w.f.id, { live: w.liveSliceOf });
  assert.equal(res.action, 'restart');
  assert.ok(requestOf(res.ticketId).prompt.includes(NEW));
});

test('waiting × run proposal: an owner live at an ask is stopped and its question closed; the notice says so', () => {
  const w = world(['done', 'asking', 'planned', 'stop']);
  const { e, payload } = w.askAt(4, ch(2));
  w.held.answer(e, e.pendingQuestion.id, payload, 'ann');
  assert.equal(w.log.stops.filter((s) => s.run === 2).length, 1);
  const entry = w.outline().changes.at(-1);
  assert.equal(entry.case, 'waiting');
  assert.equal(entry.closedAsk, true);
  assert.match(reqChangeNotice(w.view().change, { time: '15:03' }), /Its open question was closed; it plans from the new text when it resumes\./);
});

test('waiting × run proposal: the asker owns the requirement: it re-plans through its own revise, never stopped', () => {
  const w = world(['done', 'done', 'planned', 'stop']);
  const { e, payload } = w.askAt(4, ch(4));
  assert.equal(w.held.answer(e, e.pendingQuestion.id, payload, 'ann'), undefined);
  assert.deepEqual(w.log.stops, []);
  assert.equal(w.log.answers.length, 1);
  assert.doesNotMatch(w.log.answers[0].payload.feedback, /builds this change/);
  const entry = w.outline().changes.at(-1);
  assert.deepEqual([entry.case, entry.self, entry.run], ['waiting', true, 4]);
});

// ── invariants ──

const snapshot = (fid) => JSON.stringify([
  getDb().prepare('SELECT * FROM shape_features WHERE id = ?').all(fid),
  getDb().prepare('SELECT * FROM scheduled_runs WHERE id IN (SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ?) ORDER BY id').all(fid),
  getDb().prepare('SELECT * FROM shape_feature_slices WHERE feature_id = ? ORDER BY idx').all(fid)]);

test('a refused change leaves the feature, tickets and slices byte-identical', () => {
  const w = world(['done', 'running', 'planned', 'planned']);
  const before = snapshot(w.f.id);
  const cases = [
    ['FEATURE_NOT_FOUND', 404, () => w.reqChanges.apply('feat_000000000000', [ch(2)], { kind: 'chat', by: 'ann' })],
    ['UNKNOWN_REQUIREMENT', 422, () => w.chat([ch(9)]), 'R-po-9 is not an agreed requirement of Reset emails'],
    ['INVALID_TEXT', 422, () => w.chat([ch(2, { to: '  ' })])],
    ['INVALID_TEXT', 422, () => w.chat([ch(2, { to: 'x'.repeat(301) })])],
    ['INVALID_ID', 422, () => w.chat([ch(2, { id: 'R-2' })])],
    ['UNCHANGED', 422, () => w.chat([ch(2, { to: 'requirement 2 as agreed' })])],
    ['STALE', 409, () => w.chat([ch(2, { from: 'what it said yesterday' })]), 'R-po-2 changed since: read it again'],
  ];
  for (const [code, status, run, error] of cases) {
    const r = run();
    assert.deepEqual([r.ok, r.code, r.status], [false, code, status], code);
    if (error) assert.equal(r.error, error);
    assert.equal(snapshot(w.f.id), before, code);
  }
  assert.deepEqual(w.log.stops, []);
  getDb().prepare('UPDATE pipelines SET shape_stats = NULL WHERE id = ?').run(w.pids[0]);
  const off = w.chat([ch(2)]);
  assert.deepEqual([off.code, off.status, off.error], ['NOT_SMALL_RUNS', 409, 'requirement changes need a feature whose runs own its requirements']);
  assert.equal(snapshot(w.f.id), before);
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), w.pids[0]);
  cancelRest(w.f.id);
  const canceled = snapshot(w.f.id);
  const na = w.chat([ch(2)]);
  assert.deepEqual([na.code, na.status, na.error], ['FEATURE_NOT_ACTIVE', 409, 'Reset emails is canceled']);
  assert.equal(snapshot(w.f.id), canceled);
});

test('stale: a change whose from no longer matches is refused 409 STALE, also when it races into the write', () => {
  const w = world(['done', 'done', 'planned', 'planned']);
  assert.equal(w.chat([ch(3)]).ok, true);
  const second = w.chat([ch(3, { to: 'another text' })]);
  assert.deepEqual([second.code, second.status], ['STALE', 409]);
  // A write whose stored text moved after the view was read: the tx re-checks and rolls back.
  const before = snapshot(w.f.id);
  const r = applyRequirementChange(w.f.id, [ch(4)], { kind: 'chat', by: 'ann' }, {
    view: (fid) => featureView(fid, { live: w.liveSliceOf }), smallRuns: () => true,
    write: (fid, plan) => changeAgreedRequirements(fid, { ...plan, changes: plan.changes.map((c) => ({ ...c, from: 'moved' })) }),
    runNow: () => {}, stopLive: () => 'gone', stopPaused: async () => {}, tick: () => {}, broadcast: () => {} });
  assert.deepEqual([r.code, r.status], ['STALE', 409]);
  assert.equal(snapshot(w.f.id), before);
  // A restart the write cannot make is a coded refusal, not a 500.
  const deps = { view: (fid) => featureView(fid, { live: w.liveSliceOf }), smallRuns: () => true,
    runNow: () => {}, stopLive: () => 'gone', stopPaused: async () => {}, tick: () => {}, broadcast: () => {} };
  const cannot = applyRequirementChange(w.f.id, [ch(4)], { kind: 'chat', by: 'ann' }, { ...deps,
    write: () => { throw Object.assign(new Error('run 4 cannot restart'), { code: 'CANNOT_RESTART', status: 409 }); } });
  assert.deepEqual([cannot.ok, cannot.code, cannot.status, cannot.error], [false, 'CANNOT_RESTART', 409, 'run 4 cannot restart']);
});

test('the text is written first: view, write, runNow, stop, tick, broadcast, with no await before the stop', () => {
  const w = world(['done', 'running', 'planned', 'planned'], { approveEach: true });
  const order = [];
  const rec = (name, fn) => (...a) => { order.push(name); return fn(...a); };
  const r = applyRequirementChange(w.f.id, [ch(2)], { kind: 'chat', by: 'ann' }, {
    view: rec('view', (fid) => featureView(fid, { live: w.liveSliceOf })), smallRuns: () => true,
    write: rec('write', changeAgreedRequirements), runNow: rec('runNow', () => true),
    stopLive: rec('stop', () => 'stopped'), stopPaused: rec('stopPaused', async () => {}), tick: rec('tick', () => {}), broadcast: rec('broadcast', () => {}) });
  assert.equal(typeof r.then, 'undefined', 'synchronous');
  assert.deepEqual(order, ['view', 'write', 'runNow', 'stop', 'tick', 'broadcast']);
});

test('a stop that throws after commit: the result has stopFailed and the restart ticket stays due', () => {
  const w = world(['done', 'running', 'planned', 'planned']);
  const r = applyRequirementChange(w.f.id, [ch(2)], { kind: 'chat', by: 'ann' }, {
    view: (fid) => featureView(fid, { live: w.liveSliceOf }), smallRuns: () => true, write: changeAgreedRequirements,
    runNow: () => false, stopLive: () => { throw new Error('boom'); }, stopPaused: async () => {}, tick: () => {}, broadcast: () => {} });
  assert.equal(r.ok, true);
  assert.equal(r.result.stopFailed, true);
  assert.equal(getTicket(w.ticketOf(2)).status, 'scheduled');
  assert.equal(w.outline().agreed.find((a) => a.id === 'R-po-2').text, NEW);
});

test('a requirement with no owner, or a canceled one, has case none: the text changes, nothing else', () => {
  const w = world(['done', 'done', 'planned', 'planned']);
  const t3 = w.ticketOf(3);
  getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE id = ?").run(t3);
  const r = w.chat([ch(3)]);
  assert.deepEqual(r.result.changes, [{ id: 'R-po-3', case: 'none', run: null }]);
  assert.equal(w.slicesCount(), 4);
  assert.equal(w.view().change, null);
  assert.ok(w.view().log.some((l) => l.text === 'R-po-3 changed'));
});

test('only writer: the UPDATE shape_features SET outline sites in src/ are the pinned list', () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.mjs') ? [p] : []; });
  const sites = walk(src).flatMap((p) => (readFileSync(p, 'utf8').match(/UPDATE shape_features SET outline/g) || []).map(() => relative(src, p)));
  assert.deepEqual(sites, ['core/shape/features.mjs', 'core/shape/features.mjs', 'core/shape/features.mjs', 'core/shape/verifier.mjs'],
    'setFeatureAcceptance (acceptance), appendRunRows (slices), changeAgreedRequirements (agreed text) and C5 writeChecks (outline.verify only)');
  const body = readFileSync(join(src, 'core/shape/features.mjs'), 'utf8');
  const fn = body.slice(body.indexOf('export function changeAgreedRequirementsIn'));   // C5 (D5): the tx-free body
  assert.match(fn.slice(0, fn.indexOf('\n}\n')), /UPDATE shape_features SET outline/);
  const changes = readFileSync(join(src, 'core/shape/changes.mjs'), 'utf8');
  assert.match(changes, /write: \(fid, plan\) => changeAgreedRequirements\(fid, plan\)/);
});
