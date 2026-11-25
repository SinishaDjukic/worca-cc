// test/shape-small-runs.test.mjs — Shaper small runs (flag shaperSmallRuns, docs/feature-flags.md): the one server read
// of the flag (src/core/shape/small-runs.mjs) and the flag-off baseline. Each baseline row runs with the flag off, then on,
// and asserts equal results: the fixed point later slices prove "flag off = dev" against.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb, closeDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { getTicket } from '../src/core/scheduler.mjs';
import { createSliceFeature, featureView } from '../src/core/shape/features.mjs';
import { checkSlices } from '../src/shared/shape/slices.mjs';
import { shaperSmallRunsOn, splitRulesOptions, splitRules, smallRunsAtStart, smallRunsOfPipeline, smallRunsOfFeature, careOfPipeline, careOfFeature, prototypeOfPipeline, prototypeOfFeature } from '../src/core/shape/small-runs.mjs';
import { buildShapeStats, shapeRecordFrom } from '../src/core/shape/stats.mjs';
import { resolveShapeRequest } from '../src/core/shape/run.mjs';

useTempHome(after, 'worca-shape-small-runs-');

const root = mkdtempSync(join(tmpdir(), 'worca-shape-small-runs-proj-'));
after(() => rmSync(root, { recursive: true, force: true }));
before(() => { getDb(); });

const slice = (n) => ({
  id: `s${n}`, title: `Slice ${n}`, goal: `Goal ${n}`, inScope: [`do ${n}`], outOfScope: [], acceptance: [`ok ${n}`],
  dependsOn: [], estimate: 'M',
});
const outlineOf = (n) => ({ why: 'because', slices: Array.from({ length: n }, (_, i) => slice(i + 1)) });

let seq = 0;
const pipe = () => {
  const id = `p${String(++seq).padStart(6, '0')}`;
  seedPipelineRow({ id, projectKey: projectKey(root), status: 'running', title: id, branch: { source: 'main', feature: `feat/${id}` } });
  return id;
};
const mk = (n) => {
  const pid = pipe();
  const f = createSliceFeature({ pipelineId: pid, projectDir: root, title: 'Charts', outline: outlineOf(n),
    perspectives: ['product'], workflowId: 'wf_shape', startedBy: 'ann' });
  return { ...f, pid };
};
const sliceRows = (fid) => getDb().prepare('SELECT * FROM shape_feature_slices WHERE feature_id = ? ORDER BY idx').all(fid);

/** Runs `fn` with WORCA_FLAGS unset, then with `shaperSmallRuns` on, restoring the env afterwards. */
function offAndOn(fn) {
  const prev = process.env.WORCA_FLAGS;
  try {
    delete process.env.WORCA_FLAGS;
    assert.equal(shaperSmallRunsOn(), false, 'flag off');
    const off = fn();
    process.env.WORCA_FLAGS = 'shaperSmallRuns';
    assert.equal(shaperSmallRunsOn(), true, 'flag on');
    const on = fn();
    return { off, on };
  } finally {
    if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev;
  }
}

test('helper: off by default', () => {
  const prev = process.env.WORCA_FLAGS;
  delete process.env.WORCA_FLAGS;
  try { assert.equal(shaperSmallRunsOn(), false); } finally { if (prev !== undefined) process.env.WORCA_FLAGS = prev; }
});

test('helper: WORCA_FLAGS turns it on', () => {
  const prev = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = 'shaperSmallRuns';
  try { assert.equal(shaperSmallRunsOn(), true); } finally {
    if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev;
  }
});

test('helper: the injected reader decides', () => {
  const asked = [];
  assert.equal(shaperSmallRunsOn({ flagEnabled: (k) => { asked.push(k); return k === 'shaperSmallRuns'; } }), true);
  assert.deepEqual(asked, ['shaperSmallRuns']);
  assert.equal(shaperSmallRunsOn({ flagEnabled: () => false }), false);
});

test("baseline: checkSlices keeps dev's 8-slice rule, flag off and on", () => {
  const { off, on } = offAndOn(() => checkSlices(outlineOf(9)));
  const count = off.items.find((i) => i.id === 'count');
  assert.equal(count.pass, false);
  assert.equal(count.detail, '9 slices: never more than 8');
  assert.deepEqual(on, off);
});

test('baseline: createSliceFeature chains linearly, flag off and on', () => {
  const { off, on } = offAndOn(() => {
    const { id, pid } = mk(3);
    const rows = sliceRows(id);
    const t2 = getTicket(rows[1].ticket_id);
    const t3 = getTicket(rows[2].ticket_id);
    assert.deepEqual(t2.after, { kind: 'pipeline', id: pid, policy: 'done' });
    assert.deepEqual(t3.after, { kind: 'ticket', id: t2.id, policy: 'done' });
    assert.deepEqual([t2.sourceFromPrevious, t3.sourceFromPrevious], [true, true]);
    return getDb().prepare('PRAGMA table_info(shape_features)').all().map((c) => c.name);
  });
  assert.deepEqual(on, off);
});

test("baseline: featureView has dev's keys with the flag off; on adds care and requirementKinds, last (A2)", () => {
  const dev = JSON.parse(readFileSync(new URL('./fixtures/shaper/dev-feature-view-keys.json', import.meta.url), 'utf8')).view;
  const { off, on } = offAndOn(() => Object.keys(featureView(mk(3).id)));
  assert.deepEqual(off, dev);
  assert.deepEqual(on, [...dev, 'care', 'requirementKinds']);
});

test("the helper's flag read is visible to the usage scan", () => {
  const src = readFileSync(new URL('../src/core/shape/small-runs.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes("flagEnabled('shaperSmallRuns'"));
});

test('the shared slices module never reads a flag', () => {
  const src = readFileSync(new URL('../src/shared/shape/slices.mjs', import.meta.url), 'utf8');
  assert.ok(!src.includes('flagEnabled'));
  assert.ok(!/flags\.mjs/.test(src));
});

test('splitRules (B4 D3): {} without the marker; the raw Care position with it', () => {
  assert.deepEqual(splitRules(null), {});
  assert.deepEqual(splitRules({ smallRuns: false, care: { position: 'thorough' } }), {});
  assert.deepEqual(splitRules({ smallRuns: true, care: { position: 'thorough' } }), { smallRuns: true, care: 'thorough' });
  assert.deepEqual(splitRules({ smallRuns: true, care: { position: 'bogus' } }), { smallRuns: true, care: 'bogus' });
  assert.deepEqual(splitRules({ smallRuns: true }), { smallRuns: true, care: undefined });
});

test('splitRulesOptions: {} by default, {smallRuns:true, care:\'balanced\'} with the injected reader on', () => {
  const prev = process.env.WORCA_FLAGS;
  delete process.env.WORCA_FLAGS;
  try { assert.deepEqual(splitRulesOptions(), {}); } finally { if (prev !== undefined) process.env.WORCA_FLAGS = prev; }
  assert.deepEqual(splitRulesOptions({ flagEnabled: () => false }), {});
  assert.deepEqual(splitRulesOptions({ flagEnabled: (k) => k === 'shaperSmallRuns' }), { smallRuns: true, care: 'balanced' });
});

const ticketOf15 = () => ({ shape: { slice: { feature: 'f1', index: 2, total: 15, outline: outlineOf(15) } }, workflowId: 'wf_shape' });

test('normalizeSliceRef: a 15-run ticket is accepted with the flag on', () => {
  const { on } = offAndOn(() => resolveShapeRequest(ticketOf15(), { internal: true }));
  assert.equal(on.ok, true, on.error);
  assert.equal(on.shape.slice.total, 15);
  assert.equal(on.shape.slice.outline.slices.length, 15);
});

test('normalizeSliceRef: a stored ref with confirmed keeps its small-runs owners with the flag off', () => {
  const o = outlineOf(3);
  o.slices[0].requirements = ['R-po-1']; o.slices[1].requirements = ['R-po-1']; o.slices[2].requirements = ['R-po-2'];
  Object.assign(o, { agreed: ['R-po-1', 'R-sec-1', 'R-po-2'].map((id) => ({ id, text: id })), confirmed: [{ id: 'R-sec-1', role: 'Security' }] });
  const req = { shape: { slice: { feature: 'f1', index: 2, total: 3, outline: o } }, workflowId: 'wf_shape' };
  const { off } = offAndOn(() => resolveShapeRequest(req, { internal: true }));
  assert.equal(off.ok, true, off.error);
  assert.deepEqual(off.shape.slice.outline.slices[1].requirements, ['R-po-1']);
  assert.deepEqual(off.shape.slice.outline.confirmed, [{ id: 'R-sec-1', role: 'Security' }]);
});

test('normalizeSliceRef: a 15-run ticket stored with the flag on still resumes with the flag off', () => {
  // dev never stores more than 12 slices, so a ref over 12 (or one carrying `confirmed`) was made under small runs.
  const { off } = offAndOn(() => resolveShapeRequest(ticketOf15(), { internal: true }));
  assert.equal(off.ok, true, off.error);
  assert.equal(off.shape.slice.total, 15);
  assert.equal(off.shape.slice.outline.slices.length, 15);
});


// ── B1: the small-runs marker on the planning run (pipelines.shape_stats.smallRuns) ──
const setStats = (pid, v) => getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(v, pid);

test('B1 smallRunsAtStart: true with the flag on, true with replacesMarked, false otherwise', () => {
  const on = { flagEnabled: () => true };
  const off = { flagEnabled: () => false };
  assert.equal(smallRunsAtStart({ deps: on }), true);
  assert.equal(smallRunsAtStart({ replacesMarked: true, deps: off }), true);
  assert.equal(smallRunsAtStart({ deps: off }), false);
  assert.equal(smallRunsAtStart({ replacesMarked: 'yes', deps: off }), false);
});

test('B1 smallRunsOfPipeline / smallRunsOfFeature: a null or empty id answers false before any DB access', () => {
  const getDb = () => { throw new Error('no DB access'); };
  for (const id of [null, undefined, '']) {
    assert.equal(smallRunsOfPipeline(id, { getDb }), false);
    assert.equal(smallRunsOfFeature(id, { getDb }), false);
  }
});

test('B1 smallRunsOfPipeline / smallRunsOfFeature: the origin run\'s stamp; unknown rows and bad JSON read false', () => {
  const f = mk(2);
  assert.equal(smallRunsOfPipeline(f.pid), false, 'no stats');
  assert.equal(smallRunsOfFeature(f.id), false);
  setStats(f.pid, JSON.stringify({ questions: { asked: 0, skipped: 0 }, smallRuns: true }));
  assert.equal(smallRunsOfPipeline(f.pid), true);
  assert.equal(smallRunsOfFeature(f.id), true);
  setStats(f.pid, '{not json');
  assert.equal(smallRunsOfPipeline(f.pid), false);
  assert.equal(smallRunsOfFeature(f.id), false);
  setStats(f.pid, JSON.stringify({ smallRuns: 'true' }));
  assert.equal(smallRunsOfPipeline(f.pid), false);
  assert.equal(smallRunsOfPipeline('p-unknown'), false);
  assert.equal(smallRunsOfFeature('feat-unknown'), false);
});

test('B2 careOfPipeline / careOfFeature: an empty id answers null before any DB access', () => {
  const getDb = () => { throw new Error('no DB access'); };
  for (const id of [null, undefined, '']) {
    assert.equal(careOfPipeline(id, { getDb }), null);
    assert.equal(careOfFeature(id, { getDb }), null);
  }
});

test('B2 careOfPipeline: the saved Care reads back deep-equal after closeDb() and a fresh getDb()', () => {
  const pid = pipe();
  assert.equal(careOfPipeline(pid), null, 'no stats');
  const care = { position: 'lean', chosenBy: 'person', worcaPick: 'thorough', reason: 'Worca picks Thorough: it touches payments',
    facts: { touches: ['payments'], requirements: 3, subsystems: [], screens: false, size: 'small' }, at: '2026-11-21T10:00:00.000Z' };
  const stats = buildShapeStats(shapeRecordFrom({ smallRuns: true, care }), []);
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify(stats), pid);
  closeDb();
  assert.deepEqual(careOfPipeline(pid), care);
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ care: { ...care, position: 'max' } }), pid);
  assert.equal(careOfPipeline(pid), null, 'an invalid record reads null');
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run('{bad', pid);
  assert.equal(careOfPipeline(pid), null);
  assert.equal(careOfPipeline('p-unknown'), null);
});

test('B2 careOfFeature: the feature row\'s three Care fields; null for an unknown feature', () => {
  const f = mk(2);
  getDb().prepare('UPDATE shape_features SET care = ?, care_chosen_by = ?, care_worca_pick = ? WHERE id = ?').run('lean', 'person', 'thorough', f.id);
  assert.deepEqual(careOfFeature(f.id), { position: 'lean', chosenBy: 'person', worcaPick: 'thorough' });
  assert.equal(careOfFeature('feat-unknown'), null);
});

test('C1 prototypeOfPipeline / prototypeOfFeature: the origin run\'s saved prototype record and its ref; null otherwise', () => {
  for (const id of [null, '']) {
    assert.equal(prototypeOfPipeline(id, { getDb: () => { throw new Error('no DB'); } }), null);
    assert.equal(prototypeOfFeature(id, { getDb: () => { throw new Error('no DB'); } }), null);
  }
  const f = mk(2);
  assert.equal(prototypeOfFeature(f.id), null, 'no stats');
  const prototype = { v: 1, state: 'confirmed', screenIds: ['R-ux-1'], designId: 'd_1', round: 1, version: 2, screens: [],
    costUsd: 1, findings: [], reviewRounds: 0, remarks: 0, rebuilt: false,
    ref: { dir: '/x/prototype-confirmed', version: 2, designId: 'd_1' }, at: '2026-11-21T10:00:00.000Z' };
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?')
    .run(JSON.stringify(buildShapeStats(shapeRecordFrom({ smallRuns: true, prototype }), [])), f.pid);
  assert.deepEqual(prototypeOfPipeline(f.pid), prototype);
  assert.deepEqual(prototypeOfFeature(f.id).ref, prototype.ref);
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run('{bad', f.pid);
  assert.equal(prototypeOfFeature(f.id), null);
  assert.equal(prototypeOfFeature('feat-unknown'), null);
});
