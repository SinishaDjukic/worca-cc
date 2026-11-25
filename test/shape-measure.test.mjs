// test/shape-measure.test.mjs — Shaper small runs A4 (src/core/shape/measure.mjs): a finished feature's eight figures,
// recorded on this machine in shape_feature_figures, and read back per Care position. Real DB through useTempHome.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { shaperSmallRunsOn } from '../src/core/shape/small-runs.mjs';
import { writeReview } from '../src/core/artifacts.mjs';
import { setFeaturePrOutcome, setRunPrOutcome } from '../src/core/pr-auto.mjs';
import { createSliceFeature, setFeatureAcceptance, recordShip, appendFeatureRun } from '../src/core/shape/features.mjs';
import {
  MEASURE_MIN_FEATURES, NOT_ENOUGH_HISTORY, featureFinished, recordFeatureFigures, recordFiguresAfterRun, featureFigures,
  figuresByCare, summarizeFigures, recordSettledFigures,
} from '../src/core/shape/measure.mjs';

useTempHome(after, 'worca-shape-measure-');

const root = mkdtempSync(join(tmpdir(), 'worca-shape-measure-proj-'));
after(() => rmSync(root, { recursive: true, force: true }));
before(() => { getDb(); });

/** Runs `fn` with `shaperSmallRuns` on or off, restoring WORCA_FLAGS afterwards (test/shape-features.test.mjs). */
async function withSmallRuns(on, fn) {
  const prev = process.env.WORCA_FLAGS;
  try {
    if (on) process.env.WORCA_FLAGS = 'shaperSmallRuns'; else delete process.env.WORCA_FLAGS;
    assert.equal(shaperSmallRunsOn(), on);
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev;
  }
}
const on = (name, fn) => test(name, () => withSmallRuns(true, fn));

const T = Date.parse('2026-11-10T12:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();
let seq = 0;
const nextId = (p = 'm') => `${p}${String(++seq).padStart(6, '0')}`;
const db = () => getDb();

/** A pipelines row; `steps` are [nodeId, status, costUsd, agentKey] tuples. */
function pipe(status = 'done', { startedAt = iso(T - 24 * HOUR), steps = [], branch = {} } = {}) {
  const id = nextId();
  seedPipelineRow({ id, projectKey: projectKey(root), status, title: id, startedAt, branch: { source: 'main', feature: `feat/${id}`, ...branch },
    steps: steps.map(([nodeId, st, costUsd], i) => ({ key: `${i}:${nodeId}`, nodeId, status: st, costUsd })) });
  steps.forEach(([nodeId, , , agent], i) => { if (agent) db().prepare('UPDATE pipeline_steps SET agent_key = ? WHERE pipeline_id = ? AND key = ?').run(agent, id, `${i}:${nodeId}`); });
  return id;
}
const round = (origin, status = 'done', startedAt = iso(T), n = 2) => pipe(status, { startedAt, branch: { roundOf: { pipelineId: origin, round: n } } });
const outlineOf = (n) => ({ why: 'because', slices: Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, title: `Slice ${i + 1}`, goal: `Goal ${i + 1}`,
  inScope: [], outOfScope: [], acceptance: [], dependsOn: [], estimate: 'M' })) });

/** A feature whose slice runs are `pids` (slice 1's run is its origin; later slices fire their tickets as those runs). */
function feature(pids, { care = null } = {}) {
  const { id } = createSliceFeature({ pipelineId: pids[0], projectDir: root, title: 'Charts', outline: outlineOf(pids.length),
    perspectives: ['product'], workflowId: 'wf_shape', startedBy: 'ann' });
  pids.slice(1).forEach((p, i) => fire(id, i + 2, p));
  if (care) db().prepare('UPDATE shape_features SET care = ? WHERE id = ?').run(care, id);
  return id;
}
function fire(fid, idx, pid) {
  const t = db().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(fid, idx).ticket_id;
  db().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(pid, t);
  return t;
}
/** A finished one-run feature that cost `usd` (one implementer step). */
const costFeature = (usd, care) => feature([pipe('done', { steps: [['n_impl', 'done', usd, 'implementer']] })], { care });
const AGREED = [{ id: 'R-po-1', text: 'People see it' }, { id: 'R-ops-1', text: 'It rolls back' }];
const withAgreed = (fid) => {
  const o = JSON.parse(db().prepare('SELECT outline FROM shape_features WHERE id = ?').get(fid).outline);
  db().prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify({ ...o, agreed: AGREED }), fid);
};
const rowOf = (fid) => { const r = db().prepare('SELECT * FROM shape_feature_figures WHERE feature_id = ?').get(fid); return r ? { ...r } : null; };
const count = () => db().prepare('SELECT COUNT(*) AS n FROM shape_feature_figures').get().n;
const clear = () => db().exec('DELETE FROM shape_feature_figures');
const runPrOpened = (pid, at) => {
  db().prepare("UPDATE pipelines SET pr_auto = '{}' WHERE id = ?").run(pid);
  assert.equal(setRunPrOutcome(pid, { status: 'opened', final: true, at }), true);
};
const changes = (fid) => { const r = recordFeatureFigures(fid); assert.equal(r.recorded, true, JSON.stringify(r)); return r.figures.changesAfterShip; };

// 3
on('record and read back: a finished 2-run feature records all 8 figures', async () => {
  const p1 = pipe('done', { steps: [['n_plan', 'done', 1, 'planner'], ['n_impl', 'done', 2, 'implementer'], ['n_review', 'done', 0.5, 'reviewer'],
    ['n_impl', 'done', 1.5, 'implementer'], ['n_review', 'done', 0.5, 'reviewer']] });
  const p2 = pipe('done', { steps: [['n_impl', 'done', 3, 'implementer'], ['n_review', 'done', 0.25, 'reviewer']] });
  await writeReview(p1, 'impl', 1, { issues: [{ severity: 'major', title: 'x' }, { severity: 'minor', title: 'y' }] });
  await writeReview(p1, 'impl', 2, { issues: [] });
  await writeReview(p2, 'impl', 1, { issues: [{ severity: 'suggestion', title: 'z' }] });
  const fid = feature([p1, p2]);
  withAgreed(fid);
  setFeatureAcceptance(fid, [{ id: 'R-po-1', mark: 'met' }, { id: 'R-ops-1', mark: 'dropped', reason: 'later' }]);
  const r = recordFeatureFigures(fid, { now: T });
  assert.equal(r.recorded, true);
  assert.deepEqual(featureFigures(fid), r.figures);
  assert.deepEqual(featureFigures(fid), {
    care: 'balanced', runs: 2,
    costPerStep: { planner: 1, implementer: 6.5, reviewer: 1.25 },
    cost: { shaping: 1, building: 7.75, total: 8.75 },
    requirementsMet: { met: 1, total: 2 }, gapsAtEnd: 0,
    reviewFindings: { critical: 0, major: 1, minor: 1, suggestion: 1, total: 3 },
    firstPassRate: 0.5, fixRounds: 1, changesAfterShip: 0,
  });
  assert.equal(rowOf(fid).care, 'balanced');
});

// 4
on('not finished: a running slice records nothing', () => {
  const fid = feature([pipe('done'), pipe('running')]);
  assert.deepEqual(recordFeatureFigures(fid), { recorded: false, reason: 'not-finished' });
  assert.equal(rowOf(fid), null);
});

// 5
on('not finished: an errored round records nothing, and an earlier row stays byte for byte', () => {
  const p1 = pipe('done');
  const fid = feature([p1, pipe('done')]);
  assert.equal(recordFeatureFigures(fid, { now: T }).recorded, true);
  const before = rowOf(fid);
  round(p1, 'error', iso(T + HOUR));
  assert.deepEqual(recordFeatureFigures(fid, { now: T + 2 * HOUR }), { recorded: false, reason: 'not-finished' });
  assert.deepEqual(rowOf(fid), before);
  const other = feature([pipe('done')]);
  round(db().prepare('SELECT origin_pipeline_id AS p FROM shape_features WHERE id = ?').get(other).p, 'error');
  assert.deepEqual(recordFeatureFigures(other), { recorded: false, reason: 'not-finished' });
  assert.equal(rowOf(other), null);
});

// 6
on('no feature: an unknown id and a pipeline outside any feature', () => {
  const n = count();
  assert.deepEqual(recordFeatureFigures('feat_nope'), { recorded: false, reason: 'no-feature' });
  assert.deepEqual(recordFiguresAfterRun(pipe('done')), { recorded: false, reason: 'no-feature' });
  assert.equal(count(), n);
});

// 7
on('idempotent upsert: recording twice keeps 1 row, recorded_at stays and updated_at moves', () => {
  const fid = feature([pipe('done')]);
  recordFeatureFigures(fid, { now: T });
  recordFeatureFigures(fid, { now: T + HOUR });
  assert.equal(db().prepare('SELECT COUNT(*) AS n FROM shape_feature_figures WHERE feature_id = ?').get(fid).n, 1);
  assert.deepEqual([rowOf(fid).recorded_at, rowOf(fid).updated_at], [iso(T), iso(T + HOUR)]);
});

// 8, 9
on('threshold and positions: 2 lean features are not enough history, a third gives figures; $1 lean and $9 thorough never mix', () => {
  clear();
  for (let i = 0; i < 2; i++) recordFeatureFigures(costFeature(1, 'lean'));
  assert.deepEqual(figuresByCare().lean, { care: 'lean', features: 2, enough: false, note: NOT_ENOUGH_HISTORY });
  assert.equal(NOT_ENOUGH_HISTORY, 'not enough history yet');
  assert.equal(MEASURE_MIN_FEATURES, 3);
  recordFeatureFigures(costFeature(1, 'lean'));
  for (let i = 0; i < 3; i++) recordFeatureFigures(costFeature(9, 'thorough'));
  const by = figuresByCare();
  assert.deepEqual(Object.keys(by), ['lean', 'balanced', 'thorough']);
  assert.deepEqual([by.lean.enough, by.lean.features, by.lean.figures.costPerFeature, by.lean.figures.costPerStep], [true, 3, 1, { implementer: 1 }]);
  assert.deepEqual([by.thorough.enough, by.thorough.figures.costPerFeature, by.thorough.figures.costPerStep], [true, 9, { implementer: 9 }]);
  assert.deepEqual(by.balanced, { care: 'balanced', features: 0, enough: false, note: NOT_ENOUGH_HISTORY });
  assert.equal(figuresByCare({ minFeatures: 4 }).lean.enough, false);
  clear();
});

// 10
on('change after ship: the ship time, a round before counts 0 and one after counts 1', () => {
  const p1 = pipe('done');
  const fid = feature([p1]);
  recordShip(fid, { mode: 'one', now: T });
  round(p1, 'done', iso(T - HOUR), 2);
  assert.equal(changes(fid), 0);
  round(p1, 'done', iso(T + HOUR), 3);
  assert.equal(changes(fid), 1);
});

on('change after ship: the feature PR opened time', () => {
  const p1 = pipe('done');
  const fid = feature([p1]);
  setFeaturePrOutcome(fid, { status: 'opened', final: true, at: iso(T) });
  round(p1, 'done', iso(T - HOUR), 2);
  round(p1, 'done', iso(T + HOUR), 3);
  assert.equal(changes(fid), 1);
});

on('change after ship: a per-run PR counts only for its own slice while no ship or feature PR exists', () => {
  const p1 = pipe('done'); const p2 = pipe('done');
  const fid = feature([p1, p2]);
  runPrOpened(p1, iso(T));
  round(p1, 'done', iso(T + HOUR));
  round(p2, 'done', iso(T + HOUR));
  assert.equal(changes(fid), 1, 'the slice-1 round counts, the slice-2 round does not (its S is unset)');
});

on('change after ship: an appended slice counts by its ticket time, against the ship time or any run PR', () => {
  for (const by of ['ship', 'run-pr']) {
    const p1 = pipe('done');
    const fid = feature([p1]);
    if (by === 'ship') recordShip(fid, { mode: 'one', now: T }); else runPrOpened(p1, iso(T));
    const added = (at) => {
      const { ticketId, index } = appendFeatureRun(fid, { title: 'More', goal: 'more', kind: 'extra', now: at });
      db().prepare('UPDATE scheduled_runs SET created_at = ? WHERE id = ?').run(iso(at), ticketId);
      fire(fid, index, pipe('done'));
    };
    added(T - HOUR);
    assert.equal(changes(fid), 0, `${by}: added before`);
    added(T + HOUR);
    assert.equal(changes(fid), 1, `${by}: added after`);
  }
});

on('change after ship: no PR time at all counts 0, and an unparseable at is ignored', () => {
  const p1 = pipe('done');
  const fid = feature([p1]);
  round(p1, 'done', iso(T + HOUR));
  assert.equal(changes(fid), 0);
  setFeaturePrOutcome(fid, { status: 'opened', final: true, at: 'not a time' });
  assert.equal(changes(fid), 0);
});

// 11
on('first pass: no review step records null; done reviews without an impl row count as passes', async () => {
  const none = feature([pipe('done', { steps: [['n_impl', 'done', 1, 'implementer']] })]);
  assert.equal(recordFeatureFigures(none).figures.firstPassRate, null);
  const reviewed = () => pipe('done', { steps: [['n_review', 'done', 0, 'reviewer']] });
  const a = reviewed(); const b = reviewed(); const c = reviewed();
  await writeReview(c, 'impl', 1, { issues: [{ severity: 'critical', title: 'x' }] });
  await writeReview(c, 'impl', 2, { issues: [] });
  assert.equal(recordFeatureFigures(feature([a, b, c])).figures.firstPassRate, 0.667);
});

// 12
test('flag off: both entry points answer flag-off and write nothing, even for an unknown pipeline', () => withSmallRuns(false, () => {
  clear();
  const p1 = pipe('done');
  const fid = feature([p1]);
  assert.deepEqual(recordFeatureFigures(fid), { recorded: false, reason: 'flag-off' });
  assert.deepEqual(recordFiguresAfterRun(p1), { recorded: false, reason: 'flag-off' });
  assert.deepEqual(recordFiguresAfterRun('no-such-pipeline'), { recorded: false, reason: 'flag-off' });
  assert.equal(count(), 0);
  // The test seam wins over the env both ways.
  process.env.WORCA_FLAGS = 'shaperSmallRuns';
  assert.deepEqual(recordFeatureFigures(fid, { deps: { flagEnabled: () => false } }), { recorded: false, reason: 'flag-off' });
  delete process.env.WORCA_FLAGS;
  assert.equal(count(), 0);
}));

test('recordSettledFigures: records nothing unless done; never throws (unknown id, null state)', () => withSmallRuns(true, () => {
  clear();
  const p1 = pipe('done');
  const fid = feature([p1]);
  for (const st of [null, undefined, {}, { id: p1, status: 'running' }, { id: p1, status: 'error' }]) recordSettledFigures(st);
  assert.equal(count(), 0);
  recordSettledFigures({ id: 'no-such-pipeline', status: 'done' });
  assert.equal(count(), 0);
  recordSettledFigures({ id: p1, status: 'done' });
  assert.ok(rowOf(fid), 'a done run records its feature');
  clear();
}));

// 13
test('rows recorded with the flag on stay readable with it off', async () => {
  clear();
  const fids = await withSmallRuns(true, () => [1, 2, 3].map(() => { const f = costFeature(2, 'lean'); recordFeatureFigures(f); return f; }));
  await withSmallRuns(false, () => {
    assert.equal(featureFigures(fids[0]).costPerStep.implementer, 2);
    assert.deepEqual([figuresByCare().lean.enough, figuresByCare().lean.figures.costPerFeature], [true, 2]);
  });
  clear();
});

// 14
test('the record module names no network, git or team-metrics module', () => {
  const src = readFileSync(new URL('../src/core/shape/measure.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(src, /metrics\/|team-metrics|git-free|node:https?|node:net|node:child_process|\bfetch\s*\(/);
});

// 15
on('recording makes 0 fetch calls', async () => {
  const p1 = pipe('done', { steps: [['n_review', 'done', 1, 'reviewer']] });
  await writeReview(p1, 'impl', 1, { issues: [] });
  const fid = feature([p1]);
  runPrOpened(p1, iso(T));
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (...a) => { calls += 1; return real(...a); };
  try {
    assert.equal(recordFeatureFigures(fid).recorded, true);
    assert.equal(recordFiguresAfterRun(p1).recorded, true);
  } finally { globalThis.fetch = real; }
  assert.equal(calls, 0);
});

// 16
test('summarizeFigures: means per feature, pooled requirements, null rates without data', () => {
  const f = (o) => ({ care: 'lean', runs: 1, costPerStep: {}, cost: { shaping: 0, building: 0, total: 0 }, requirementsMet: { met: 0, total: 0 },
    gapsAtEnd: 0, reviewFindings: { critical: 0, major: 0, minor: 0, suggestion: 0, total: 0 }, firstPassRate: null, fixRounds: 0,
    changesAfterShip: 0, ...o });
  const s = summarizeFigures([
    f({ costPerStep: { implementer: 1.25, planner: 2 }, cost: { shaping: 0, building: 1, total: 1.005 }, requirementsMet: { met: 1, total: 2 },
      reviewFindings: { critical: 1, major: 0, minor: 2, suggestion: 0, total: 3 }, firstPassRate: 1, fixRounds: 1, changesAfterShip: 3 }),
    f({ costPerStep: { implementer: 2.5 }, cost: { shaping: 0, building: 2, total: 2.0 }, requirementsMet: { met: 2, total: 2 },
      reviewFindings: { critical: 0, major: 1, minor: 0, suggestion: 0, total: 1 }, firstPassRate: null, fixRounds: 0, changesAfterShip: 1 }),
    f({ requirementsMet: { met: 0, total: 0 }, firstPassRate: 0.5, fixRounds: 1, changesAfterShip: 2.2 }),
  ]);
  assert.deepEqual(s, {
    costPerStep: { implementer: 1.88, planner: 2 }, costPerFeature: 1, requirementsMet: { met: 1, total: 1.3, rate: 0.75 }, gapsAtEnd: 0,
    reviewFindings: { critical: 0.3, major: 0.3, minor: 0.7, suggestion: 0, total: 1.3 }, firstPassRate: 0.75, fixRounds: 0.7, changesAfterShip: 2.1,
  });
  const none = summarizeFigures([f({}), f({})]);
  assert.deepEqual([none.firstPassRate, none.requirementsMet], [null, { met: 0, total: 0, rate: null }]);
});

// 17
test('featureFinished: no slices is not finished; every slice and round done is', () => {
  const s = (rounds = []) => ({ rounds });
  assert.equal(featureFinished(null), false);
  assert.equal(featureFinished({ status: 'done', total: 0, slices: [] }), false);
  assert.equal(featureFinished({ status: 'active', total: 1, slices: [s()] }), false);
  assert.equal(featureFinished({ status: 'done', total: 2, slices: [s([{ status: 'done' }]), s()] }), true);
  assert.equal(featureFinished({ status: 'done', total: 2, slices: [s([{ status: 'done' }, { status: 'stopped' }]), s()] }), false);
});

on('figuresByCare with projectDir ignores another project\'s figures', () => {
  clear();
  const ours = [0, 1, 2].map(() => costFeature(1, 'lean'));
  const theirs = [0, 1, 2].map(() => costFeature(50, 'lean'));
  for (const fid of [...ours, ...theirs]) recordFeatureFigures(fid);
  for (const fid of theirs) db().prepare('UPDATE shape_features SET project_dir = ? WHERE id = ?').run('/elsewhere/other', fid);
  const mine = figuresByCare({ projectDir: root });
  assert.deepEqual([mine.lean.features, mine.lean.enough, mine.lean.figures.costPerFeature], [3, true, 1]);
  assert.equal(figuresByCare({ projectDir: '/elsewhere/other' }).lean.figures.costPerFeature, 50);
  assert.equal(figuresByCare({ projectDir: '/nowhere' }).lean.features, 0);
  assert.equal(figuresByCare().lean.features, 6, 'without projectDir every row counts, as before');
  clear();
});

test('C5 (D10): a feature with a Verifier check is finished only once the latest check is clean or accepted', () => {
  const s = (rounds = []) => ({ rounds });
  const v = (state) => ({ status: 'done', total: 1, slices: [s()], verify: { state, gapsFound: 2 } });
  for (const state of ['verifying', 'gaps', 'asking', 'paused', 'halted']) assert.equal(featureFinished(v(state)), false, state);
  for (const state of ['clean', 'accepted']) assert.equal(featureFinished(v(state)), true, state);
});

on('D1: a marked feature records requirementsMet as owned holds plus confirmed marks', async () => {
  const p1 = pipe('done');
  const fid = feature([p1, pipe('done')]);
  const o = JSON.parse(db().prepare('SELECT outline FROM shape_features WHERE id = ?').get(fid).outline);
  o.agreed = [...AGREED, { id: 'R-comp-4', text: 'EU only' }];
  o.slices[0].requirements = ['R-po-1']; o.slices[1].requirements = ['R-ops-1'];
  db().prepare('UPDATE shape_features SET outline = ?, requirement_kinds = ? WHERE id = ?')
    .run(JSON.stringify(o), JSON.stringify({ 'R-comp-4': { kind: 'confirmed', role: 'compliance' } }), fid);
  db().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), p1);
  recordShip(fid, { mode: 'stacked' });   // shipped: no Verifier check is waited for
  assert.deepEqual(recordFeatureFigures(fid).figures.requirementsMet, { met: 2, total: 3 });
  setFeatureAcceptance(fid, [{ id: 'R-comp-4', mark: 'met' }]);
  assert.deepEqual(recordFeatureFigures(fid).figures.requirementsMet, { met: 3, total: 3 });
});
