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
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { getTicket } from '../src/core/scheduler.mjs';
import { createSliceFeature, featureView } from '../src/core/shape/features.mjs';
import { checkSlices } from '../src/shared/shape/slices.mjs';
import { shaperSmallRunsOn } from '../src/core/shape/small-runs.mjs';

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
