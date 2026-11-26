// test/shape-chain.test.mjs — Shaper small runs A5 (src/core/shape/chain.mjs): runs start from the feature's latest
// finished work. The slice gate through runDueTickets, one slice at a time, the latest-finished pick, the fire-time
// source, the one-PR ship check (real git) and the flag on → off round trip. Real DB through useTempHome.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { withEnv as withEnvVars } from './helpers/with-env.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { getTicket, runDueTickets, requestRunNow } from '../src/core/scheduler.mjs';
import { createSliceFeature, featureView, resumeFeature, featureHoldsTicket, liveSliceFrom, sliceGateState, appendFeatureRun,
  finishedSlices, smallRunsPrBase, stackedPrBase, shipOrder } from '../src/core/shape/features.mjs';
import { careOfRow, requirementKindsOf } from '../src/shared/shape/feature-record.mjs';
import { featureFigures } from '../src/core/shape/measure.mjs';
import { latestFinishedSlice, latestFinishedSource, sliceChainGate, sliceSourceOf, headMissingSlice, smallRunsChainGate,
  sliceFireStart, oneShipCheck, shipHeadRow, shipHeadBase, heldStopTurn } from '../src/core/shape/chain.mjs';
// Namespace reads, so a missing new export (the dependency combine) fails only its own test, not the whole file.
import * as CHAIN from '../src/core/shape/chain.mjs';
import * as FEATURES from '../src/core/shape/features.mjs';

useTempHome(after, 'worca-shape-chain-');

const root = mkdtempSync(join(tmpdir(), 'worca-shape-chain-proj-'));
after(() => rmSync(root, { recursive: true, force: true }));
before(() => { getDb(); });

const SMALL_ON = { WORCA_FLAGS: 'shaperSmallRuns' };
const SMALL_OFF = { WORCA_FLAGS: undefined };
const ON = { flagEnabled: () => true };
const OFF = { flagEnabled: () => false };

const slice = (n, dependsOn = []) => ({ id: `s${n}`, title: `Slice ${n}`, goal: `Goal ${n}`, inScope: [`do ${n}`], outOfScope: [],
  acceptance: [`ok ${n}`], dependsOn, estimate: 'M' });
const outlineOf = (n, deps = {}) => ({ why: 'because', slices: Array.from({ length: n }, (_, i) => slice(i + 1, deps[i + 1] || [])) });

let seq = 0;
const pipe = (status = 'running', { branch = null, steps = [], updatedAt = null } = {}) => {
  const id = `c${String(++seq).padStart(7, '0')}`;
  seedPipelineRow({ id, projectKey: projectKey(root), status, title: id, updatedAt, steps,
    branch: branch || { source: 'main', feature: `feat/${id}` } });
  return id;
};
const rows = (fid) => getDb().prepare('SELECT * FROM shape_feature_slices WHERE feature_id = ? ORDER BY idx').all(fid);
const fire = (ticketId, pipelineId = null) => getDb().prepare('UPDATE scheduled_runs SET status = ?, pipeline_id = ? WHERE id = ?')
  .run('fired', pipelineId, ticketId);
const setTicket = (ticketId, status) => getDb().prepare('UPDATE scheduled_runs SET status = ? WHERE id = ?').run(status, ticketId);
/** A feature of `n` slices: slice 1 done, slice 2 done unless `two` says otherwise. → { id, t } (t[k] = slice k's ticket id). */
/** Earlier tests' tickets never fire on a later test's tick. */
const quiet = () => getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();
const feature = (n, { deps = {}, approveEach = false, two = 'done' } = {}) => {
  quiet();
  const f = createSliceFeature({ pipelineId: pipe('done'), projectDir: root, title: 'Charts', outline: outlineOf(n, deps),
    perspectives: ['product'], workflowId: 'wf_shape', approveEach });
  const t = rows(f.id).map((r) => r.ticket_id);
  t.unshift(null);
  if (two === 'done') fire(t[2], pipe('done'));
  return { id: f.id, t };
};
const featureOfT = (ticketId) => getDb().prepare('SELECT feature_id FROM shape_feature_slices WHERE ticket_id = ?').get(ticketId).feature_id;
const okStart = async () => ({ ok: true });
const gate = (t, o) => sliceChainGate(t, o, ON);
const tick = (opts = {}) => runDueTickets({ start: okStart, chainGate: gate, hold: featureHoldsTicket, ...opts });
/** slice 3 halted one way or another. */
const halt3 = (t3, how) => {
  if (how === 'failed') setTicket(t3, 'failed');
  else fire(t3, pipe(how));
};

test('flag off: gate and source answer null', () => withEnvVars(SMALL_OFF, () => {
  const { t } = feature(3);
  const tk = getTicket(t[3]);
  assert.equal(sliceChainGate(tk, {}), null);
  assert.equal(sliceSourceOf(tk), null);
  assert.equal(sliceChainGate(tk, {}, OFF), null);
  assert.equal(sliceSourceOf(tk, OFF), null);
  // With the flag on, the same ticket gets an answer; a ticket of no feature still gets none.
  assert.equal(sliceChainGate(tk, {}, ON).state, 'ok');
  assert.ok(sliceSourceOf(tk, ON).sourceBranch);
  assert.equal(sliceChainGate({ id: 'nope' }, {}, ON), null);
  assert.equal(sliceSourceOf({ id: 'nope' }, ON), null);
}));

test('independent slice fires behind a halted or held slice', async () => {
  for (const how of ['stopped', 'error', 'failed', 'paused']) {
    const { t } = feature(4);
    halt3(t[3], how);
    const out = await tick();
    assert.deepEqual(out.fired, [t[4]], how);
    assert.equal(getTicket(t[4]).status, 'fired');
  }
  // Held ("Ask me before each run"): both wait for Start now; Start now on slice 4 starts it while slice 3 stays held.
  const { t } = feature(4, { approveEach: true });
  let out = await tick();
  assert.deepEqual(out.held.sort(), [t[3], t[4]].sort());
  requestRunNow(t[4]);
  out = await tick();
  assert.deepEqual(out.fired, [t[4]]);
  assert.equal(getTicket(t[3]).status, 'scheduled');
});

test('dependent slice waits for its unfinished dependency, then fires', async () => {
  for (const how of ['stopped', 'error', 'paused', 'unrun']) {
    const { t } = feature(4, { deps: { 4: ['s3'] } });
    if (how !== 'unrun') halt3(t[3], how);
    for (let i = 0; i < 3; i++) {
      const out = await tick();
      assert.ok(!out.fired.includes(t[4]) && !out.missed.includes(t[4]), `${how}: tick ${i}`);
      assert.equal(getTicket(t[4]).status, 'scheduled', how);
    }
    if (how === 'unrun') { fire(t[3], pipe('done')); } else {
      getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = ?").run(getTicket(t[3]).pipelineId);
    }
    assert.deepEqual((await tick()).fired, [t[4]], `${how}: fires once slice 3 is done`);
  }
});

test('a missed dependency misses its dependent', async () => {
  for (const [how, reason] of [['missed', 'was missed'], ['canceled', 'was canceled']]) {
    const { t } = feature(4, { deps: { 4: ['s3'] } });
    setTicket(t[3], how);
    const out = await tick();
    assert.deepEqual(out.missed, [t[4]], how);
    assert.equal(getTicket(t[4]).failReason, `The run before it ${reason}.`);
  }
});

test('a dependency whose ticket failed misses its dependent', async () => {
  const { t } = feature(4, { deps: { 4: ['s3'] } });
  setTicket(t[3], 'failed');
  const out = await tick();
  assert.deepEqual(out.missed, [t[4]]);
  assert.equal(getTicket(t[4]).failReason, 'The run before it could not start.');
});

test('two eligible independent slices on one tick: exactly one fires', async () => {
  const { t } = feature(5);
  halt3(t[3], 'stopped');
  const out = await tick();
  assert.deepEqual(out.fired, [t[4]], 'the lowest eligible index');
  assert.deepEqual(out.waiting.sort(), [t[5]].sort());
  assert.equal(getTicket(t[5]).status, 'scheduled');
});

test('a slice ticket fired with no pipeline stalls the others only while it may still start', async () => {
  const { t } = feature(4);
  fire(t[3]);
  assert.deepEqual((await tick()).fired, [], 'just fired: it may still start');
  getDb().prepare('UPDATE scheduled_runs SET updated_at = ? WHERE id = ?').run(new Date(Date.now() - 4 * 60_000).toISOString(), t[3]);
  assert.deepEqual((await tick()).fired, [t[4]], 'older than 3 minutes with no run: it could not start');
});

test('a feature created with the flag off follows the gate once it is on', async () => {
  const { t } = await withEnvVars(SMALL_OFF, () => feature(4));
  halt3(t[3], 'stopped');
  // Flag off: dev's linear gate misses slice 4 behind the stopped slice 3.
  const off = await runDueTickets({ start: okStart, chainGate: (tk, o) => sliceChainGate(tk, o, OFF) });
  assert.deepEqual(off.missed, [t[4]]);
  const { t: t2 } = await withEnvVars(SMALL_OFF, () => feature(4));
  halt3(t2[3], 'stopped');
  const on = await withEnvVars(SMALL_ON, () => runDueTickets({ start: okStart, chainGate: (tk, o) => sliceChainGate(tk, o) }));
  assert.ok(on.fired.includes(t2[4]));
});

test('latestFinishedSlice returns the greatest step finish time, not the highest index', () => {
  const f = createSliceFeature({ pipelineId: pipe('done', { updatedAt: '2026-01-01T00:00:00Z' }), projectDir: root, title: 'C',
    outline: outlineOf(4), perspectives: ['product'], workflowId: 'wf_shape' });
  const t = rows(f.id).map((r) => r.ticket_id);
  const step = (at) => [{ key: 'n_impl', status: 'done', updatedAt: at }];
  const p2 = pipe('done', { steps: step('2026-01-05T00:00:00Z') });
  const p3 = pipe('done', { steps: step('2026-01-03T00:00:00Z'), updatedAt: '2026-01-09T00:00:00Z' });   // a late title change
  fire(t[1], p2); fire(t[2], p3);
  assert.deepEqual(latestFinishedSlice(f.id), { index: 2, pipelineId: p2 });
  assert.deepEqual(latestFinishedSlice(f.id, { exclude: p2 }), { index: 3, pipelineId: p3 });
  // A tie goes to the higher index; an archived or unfinished run never counts.
  const p4 = pipe('done', { steps: step('2026-01-05T00:00:00Z') });
  fire(t[3], p4);
  assert.deepEqual(latestFinishedSlice(f.id), { index: 4, pipelineId: p4 });
  getDb().prepare("UPDATE pipelines SET archived_at = '2026-02-01T00:00:00Z' WHERE id = ?").run(p4);
  getDb().prepare("UPDATE pipelines SET status = 'stopped' WHERE id = ?").run(p2);
  assert.deepEqual(latestFinishedSlice(f.id), { index: 3, pipelineId: p3 });
});

test('sliceSourceOf: the latest finished branch, {pending:true} while it merges back, the base when none finished', () => {
  const { id, t } = feature(4);
  const p2 = getTicket(t[2]).pipelineId;
  assert.deepEqual(sliceSourceOf(getTicket(t[4]), ON), { pipelineId: p2, sourceBranch: `feat/${p2}` });
  // A run on its source branch, done but not merged back yet.
  const p3 = pipe('done', { branch: { source: 'main', feature: 'main', sameAsSource: true, worktreeDir: '/tmp/x' }, updatedAt: new Date().toISOString() });
  fire(t[3], p3);
  getDb().prepare("UPDATE pipelines SET updated_at = ? WHERE id = ?").run(new Date(Date.now() + 1000).toISOString(), p3);
  assert.deepEqual(latestFinishedSource(id), { pending: true });
  assert.deepEqual(sliceSourceOf(getTicket(t[4]), ON), { pending: true });
  // No finished run: the feature's base.
  const f = createSliceFeature({ pipelineId: pipe('stopped'), projectDir: root, title: 'C', outline: outlineOf(2), perspectives: ['product'], workflowId: 'wf_shape' });
  assert.deepEqual(sliceSourceOf(getTicket(rows(f.id)[1].ticket_id), ON), { pipelineId: null, sourceBranch: 'main' });
});

const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
test('headMissingSlice: a done slice whose tip is not in the head branch; null when all are', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-shape-chain-git-'));
  try {
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
    git(dir, 'config', 'commit.gpgsign', 'false');
    const commitOn = (br, from, file) => {
      git(dir, 'checkout', '-q', '-b', br, from); writeFileSync(join(dir, file), file); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', file);
    };
    writeFileSync(join(dir, 'f.txt'), 'x'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init');
    commitOn('feat/a', 'main', 'a.txt');
    commitOn('feat/b', 'feat/a', 'b.txt');
    commitOn('feat/c', 'feat/a', 'c.txt');   // started from a, not from b
    const p = (br) => pipe('done', { branch: { source: 'main', feature: br } });
    const a = p('feat/a'); const b = p('feat/b'); const c = p('feat/c'); const gone = p('feat/gone');
    assert.equal(await headMissingSlice(dir, 'feat/b', [{ index: 1, pipelineId: a }, { index: 2, pipelineId: b }]), null);
    assert.deepEqual(await headMissingSlice(dir, 'feat/c', [{ index: 1, pipelineId: a }, { index: 2, pipelineId: b }, { index: 3, pipelineId: c }]), { index: 2 });
    assert.deepEqual(await headMissingSlice(dir, 'feat/c', [{ index: 1, pipelineId: a }, { index: 4, pipelineId: gone }]), { index: 4 }, 'a branch that does not resolve is refused');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('headMissingSlice: a done slice with no branch record is refused', async () => {
  const id = `c${String(++seq).padStart(7, '0')}`;
  seedPipelineRow({ id, projectKey: projectKey(root), status: 'done', title: id });
  assert.deepEqual(await headMissingSlice(root, 'feat/x', [{ index: 3, pipelineId: id }], { isAncestor: async () => true }), { index: 3 });
  assert.deepEqual(await headMissingSlice(root, 'feat/x', [{ index: 5, pipelineId: null }], { isAncestor: async () => true }), { index: 5 });
});

test('headMissingSlice: a git failure is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-shape-chain-nogit-'));
  try {
    const a = pipe('done', { branch: { source: 'main', feature: 'feat/a' } });
    assert.deepEqual(await headMissingSlice(dir, 'feat/b', [{ index: 1, pipelineId: a }]), { index: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('headMissingSlice: a timeout (isAncestor false) is refused, refs/heads and 10 s passed', async () => {
  const a = pipe('done', { branch: { source: 'main', feature: 'feat/a' } });
  const calls = [];
  const isAncestor = async (...args) => { calls.push(args); return false; };
  assert.deepEqual(await headMissingSlice('/repo', 'feat/c', [{ index: 1, pipelineId: a }], { isAncestor }), { index: 1 });
  assert.deepEqual(calls, [['/repo', 'refs/heads/feat/a', 'refs/heads/feat/c', { timeout: 10_000 }]]);
});

test("headMissingSlice: the head's own branch is skipped; no dir with rows is refused; no rows is null", async () => {
  const c = pipe('done', { branch: { source: 'main', feature: 'feat/c' } });
  const a = pipe('done', { branch: { source: 'main', feature: 'feat/a' } });
  const calls = [];
  const isAncestor = async (...args) => { calls.push(args); return true; };
  assert.equal(await headMissingSlice('/repo', 'feat/c', [{ index: 1, pipelineId: a }, { index: 2, pipelineId: c }], { isAncestor }), null);
  assert.equal(calls.length, 1, 'the head itself is never checked');
  assert.deepEqual(await headMissingSlice(null, 'feat/c', [{ index: 2, pipelineId: c }], { isAncestor }), { index: 2 });
  assert.deepEqual(await headMissingSlice('/repo', null, [{ index: 2, pipelineId: c }], { isAncestor }), { index: 2 });
  assert.equal(await headMissingSlice(null, null, [], { isAncestor }), null);
  assert.equal(await headMissingSlice('/repo', 'feat/c', [], { isAncestor }), null);
});

test('smallRunsChainGate: null with the flag off; a gate that passes `live` with it on', async () => {
  assert.equal(smallRunsChainGate(() => null, OFF), null);
  assert.equal(await withEnvVars(SMALL_OFF, () => smallRunsChainGate(() => null)), null);
  const { t } = feature(3);
  const live = () => null;
  const st = await withEnvVars(SMALL_ON, () => smallRunsChainGate(live)(getTicket(t[3]), {}));
  assert.ok(st && typeof st.state === 'string', JSON.stringify(st));
  assert.equal(typeof smallRunsChainGate(live, ON), 'function');
});

test('sliceFireStart: flag off gives {own:null, refusal:null} and leaves body untouched', () => {
  const { t } = feature(3);
  const body = { prompt: 'x' };
  assert.deepEqual(sliceFireStart(getTicket(t[3]), body, {}, OFF), { own: null, refusal: null });
  assert.deepEqual(body, { prompt: 'x' });
  // Not a slice ticket: dev's path with the flag on too.
  assert.deepEqual(sliceFireStart({ id: 'no-such-ticket' }, body, {}, ON), { own: null, refusal: null });
  assert.deepEqual(body, { prompt: 'x' });
});

test("sliceFireStart: a slice-1 restart (no after) sets body.sourceBranch to the feature's base", () => {
  quiet();
  const f = createSliceFeature({ pipelineId: pipe('stopped'), projectDir: root, title: 'Restart', outline: outlineOf(2), perspectives: ['product'], workflowId: 'wf_shape' });
  const ticket = { ...getTicket(rows(f.id)[1].ticket_id), after: null };   // a restart carries no predecessor
  const body = { prompt: 'x', sourceBranch: 'elsewhere' };
  const r = sliceFireStart(ticket, body, {}, ON);
  assert.deepEqual(r, { own: { pipelineId: null, sourceBranch: 'main' }, refusal: null });
  assert.equal(body.sourceBranch, 'main');
  // A ticket with a predecessor keeps the body's source (fireTicket's sourceFromPrevious path reads `own`).
  const body2 = { prompt: 'x' };
  sliceFireStart({ ...ticket, after: { pipelineId: 'p' } }, body2, {}, ON);
  assert.equal(body2.sourceBranch, undefined);
});

test('sliceFireStart: a slice whose latest finished run still merges back is refused (transient)', () => {
  const { t } = feature(4);
  const p3 = pipe('done', { branch: { source: 'main', feature: 'main', sameAsSource: true, worktreeDir: '/tmp/x' } });
  fire(t[3], p3);
  getDb().prepare('UPDATE pipelines SET updated_at = ? WHERE id = ?').run(new Date(Date.now() + 5000).toISOString(), p3);
  const r = sliceFireStart(getTicket(t[4]), {}, {}, ON);
  assert.deepEqual(r.refusal, { ok: false, error: 'the run before it is still merging its work back', transient: true });
});

const viewOf = (id, slices) => ({ id, slices });
const NEVER = () => { throw new Error('ctxOf must not be called'); };

test('oneShipCheck: stacked is a no-op; HAS_SLICE_PR refuses with the flag on and off', async () => {
  const v = viewOf('f', [{ index: 1, pipelineId: 'p1', state: 'done', pr: { url: 'u', state: 'OPEN', draft: false } }]);
  assert.deepEqual(await oneShipCheck('f', 'stacked', v, NEVER, ON), { head: null, refusal: null });
  const refusal = { status: 409, body: { code: 'HAS_SLICE_PR', error: 'a run in this feature already has a PR: create one PR per run' } };
  for (const deps of [ON, OFF]) assert.deepEqual(await oneShipCheck('f', 'one', v, NEVER, deps), { head: null, refusal });
  // A closed or draft PR does not count.
  const closed = viewOf('f', [{ index: 1, pipelineId: 'p1', state: 'done', pr: { url: 'u', state: 'CLOSED' } },
    { index: 2, pipelineId: 'p2', state: 'done', pr: { url: 'u', state: 'OPEN', draft: true } }]);
  assert.deepEqual(await oneShipCheck('f', 'one', closed, NEVER, OFF), { head: null, refusal: null });
});

test('oneShipCheck: flag off never calls ctxOf and gives head null', async () => {
  const { id } = feature(3);
  assert.deepEqual(await oneShipCheck(id, 'one', viewOf(id, []), NEVER, OFF), { head: null, refusal: null });
});

test('oneShipCheck: a ctxOf error refuses 409 HEAD_MISSING_WORK (fail-closed)', async () => {
  const { id, t } = feature(3);
  const p2 = getTicket(t[2]).pipelineId;
  const seen = [];
  const r = await oneShipCheck(id, 'one', viewOf(id, []), (h) => { seen.push(h); return { error: 'the last slice has no run' }; }, ON);
  assert.deepEqual(seen, [p2]);
  assert.deepEqual(r, { head: p2, refusal: { status: 409, body: { code: 'HEAD_MISSING_WORK',
    error: 'the branch one PR would ship cannot be checked (the last slice has no run): create one PR per run' } } });
  // The head check passes the done rows and refuses the first one missing from the head.
  const slices = [{ index: 1, pipelineId: 'x1', state: 'done' }, { index: 2, pipelineId: p2, state: 'done' }, { index: 3, pipelineId: null, state: 'waiting' }];
  const ctx = () => ({ target: { repoDir: '/repo', feature: `feat/${p2}` } });
  const miss = await oneShipCheck(id, 'one', viewOf(id, slices), ctx, { ...ON, isAncestor: async () => false });
  assert.deepEqual(miss.refusal.body, { code: 'HEAD_MISSING_WORK', error: "run 1's work is not in the branch one PR would ship: create one PR per run" });
});

test('shipHeadRow/shipHeadBase: null without head; the root source with it', () => {
  const { id, t } = feature(3);
  const p2 = getTicket(t[2]).pipelineId;
  const v = viewOf(id, [{ index: 1, pipelineId: 'x' }, { index: 2, pipelineId: p2 }]);
  assert.equal(shipHeadRow(v, null), null);
  assert.equal(shipHeadBase(v, null), null);
  assert.equal(shipHeadRow(v, 'nope'), null);
  assert.equal(shipHeadBase(v, 'nope'), null);
  assert.deepEqual(shipHeadRow(v, p2), { index: 2, pipelineId: p2 });
  assert.equal(shipHeadBase(v, p2), 'main');
});

test('chain.mjs reads the flag only through shaperSmallRunsOn; features.mjs imports nothing from it', () => {
  const chain = readFileSync(new URL('../src/core/shape/chain.mjs', import.meta.url), 'utf8');
  const features = readFileSync(new URL('../src/core/shape/features.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(chain, /flags\.mjs|flagEnabled\(/);
  assert.match(chain, /from '\.\/features\.mjs'/);
  assert.doesNotMatch(features, /chain\.mjs/);
});

test('flag on, create, flag off, resume: readable and linear', async () => {
  const outline = outlineOf(4, { 4: ['s2'] });
  outline.slices[0].requirements = ['R-po-1'];
  outline.agreed = [{ id: 'R-po-1', text: 'People see it' }, { id: 'R-sec-1', text: 'It is safe' }];
  outline.leftOut = [];
  quiet();
  const origin = pipe('done');
  const FIG = { care: 'thorough', runs: 4, costPerStep: { implementer: 1.5 }, cost: { shaping: 1, building: 2, total: 3 },
    requirementsMet: { met: 1, total: 2 }, gapsAtEnd: 0, reviewFindings: { critical: 0, major: 1, minor: 0, suggestion: 0, total: 1 },
    firstPassRate: 0.5, fixRounds: 1, changesAfterShip: 0 };
  const onRead = await withEnvVars(SMALL_ON, () => {
    const f = createSliceFeature({ pipelineId: origin, projectDir: root, title: 'Round trip', outline, perspectives: ['product'],
      workflowId: 'wf_shape', care: { position: 'thorough' }, requirementKinds: { 'R-sec-1': { kind: 'confirmed', role: 'Compliance' } } });
    getDb().prepare('INSERT INTO shape_feature_figures (feature_id, care, figures, recorded_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(f.id, 'thorough', JSON.stringify(FIG), '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    // Slice 3 ran ahead of an unrun slice 2 and stopped; Resume restarts it behind slice 2's ticket.
    const t = rows(f.id).map((r) => r.ticket_id);
    fire(t[2], pipe('stopped'));
    const res = resumeFeature(f.id);
    assert.equal(res.action, 'restart');
    const v = featureView(f.id);
    return { id: f.id, care: v.care, kinds: v.requirementKinds, figures: featureFigures(f.id), t, restart: res.ticketId };
  });
  await withEnvVars(SMALL_OFF, async () => {
    const DEV_KEYS = JSON.parse(readFileSync(new URL('./fixtures/shaper/dev-feature-view-keys.json', import.meta.url), 'utf8'));
    const v = featureView(onRead.id);
    assert.deepEqual(Object.keys(v), DEV_KEYS.view);
    const row = getDb().prepare('SELECT * FROM shape_features WHERE id = ?').get(onRead.id);
    assert.deepEqual(careOfRow(row), onRead.care);
    assert.deepEqual(careOfRow(row).position, 'thorough');
    const stored = JSON.parse(row.outline);
    assert.deepEqual(requirementKindsOf(JSON.parse(row.requirement_kinds), stored), onRead.kinds);
    assert.notEqual(featureFigures(onRead.id), null);
    assert.deepEqual(featureFigures(onRead.id), onRead.figures);
    assert.deepEqual(stored.slices.map((s) => s.dependsOn), [[], [], [], ['s2']]);
    // Dev's tick: only slice 2 fires; slice 3 (restarted after slice 2's ticket) stays scheduled behind it.
    const [, t2, , t4] = onRead.t;
    const out = await runDueTickets({ start: okStart, hold: featureHoldsTicket });
    assert.deepEqual(out.fired, [t2]);
    assert.equal(getTicket(onRead.restart).status, 'scheduled');
    // Slice 2 finishes, slice 3 runs and stops: the next tick misses slice 4 (dev's cascade).
    fire(t2, pipe('done'));
    const p2 = getTicket(t2).pipelineId;
    fire(onRead.restart, pipe('stopped'));
    const out2 = await runDueTickets({ start: okStart, hold: featureHoldsTicket });
    assert.deepEqual(out2.missed, [t4]);
    const res = resumeFeature(onRead.id);
    assert.equal(res.action, 'restart');
    const nt = getTicket(res.ticketId);
    assert.deepEqual(nt.after, { kind: 'pipeline', id: p2, policy: 'done' });
    assert.equal(nt.sourceFromPrevious, true);
    assert.deepEqual(getTicket(t4).after, { kind: 'ticket', id: res.ticketId, policy: 'done' });
    assert.equal(getTicket(t4).status, 'scheduled');
  });
});

// ── Small runs C3 (D8, D9): a stop question does not hold independent runs; a held answer waits for its turn ───────────
const STOP_Q = (id) => ({ id, kind: 'gate', stop: { reason: 'objection', run: 8 } });
/** A 10-run feature: runs 1..7 done, run 10 builds on run 8. → {id, t, p} (p[k] = run k's pipeline once fired). */
const tenRuns = () => {
  const f = feature(10, { deps: { 10: ['s8'] } });
  const p = [];
  for (let k = 3; k <= 7; k++) fire(f.t[k], (p[k] = pipe('done')));
  return { ...f, p };
};
/** The live overlay: `stops` = {k: heldStop|null} for a run waiting on a stop, `going` = runs at work. */
const liveOf = (p, { stops = {}, going = [] } = {}) => (pid) => {
  const k = p.indexOf(pid);
  if (k < 0) return null;
  if (k in stops) return liveSliceFrom({ runId: `r${k}`, status: 'running', pendingQuestion: STOP_Q(`g${k}`), approved: true, heldStop: stops[k] });
  return going.includes(k) ? liveSliceFrom({ runId: `r${k}`, status: 'running', approved: true }) : null;
};
const tickLive = (live) => tick({ chainGate: (tk, o) => sliceChainGate(tk, { ...o, live }, ON) });

test('C3: stop open on run 8: run 9 fires, run 10 stays scheduled', async () => {
  const { t, p } = tenRuns();
  fire(t[8], (p[8] = pipe('running')));
  const out = await tickLive(liveOf(p, { stops: { 8: null } }));
  assert.deepEqual(out.fired, [t[9]]);
  assert.equal(getTicket(t[10]).status, 'scheduled');
  const v = featureView(featureOfT(t[8]), { live: liveOf(p, { stops: { 8: null } }) });
  assert.equal(v.slices[7].state, 'questions', 'the stopped run still reads as asking');
});

test('C3: held answer: no independent run fires until it is delivered', async () => {
  const { t, p } = tenRuns();
  fire(t[8], (p[8] = pipe('running')));
  const held = await tickLive(liveOf(p, { stops: { 8: { id: 'g8', after: 9, payload: { decision: 'another' } } } }));
  assert.deepEqual(held.fired, [], 'a held answer counts as going');
  const open = await tickLive(liveOf(p, { stops: { 8: null } }));
  assert.deepEqual(open.fired, [t[9]]);
});

test('C3: heldStopTurn: {due:false, after:9} while run 9 is going, {due:true} after; two held answers go one at a time', () => {
  const { id, t, p } = tenRuns();
  fire(t[8], (p[8] = pipe('running')));
  fire(t[9], (p[9] = pipe('running')));
  assert.deepEqual(heldStopTurn(id, 8, { live: liveOf(p, { stops: { 8: {} }, going: [9] }) }), { due: false, after: 9 });
  getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = ?").run(p[9]);
  assert.deepEqual(heldStopTurn(id, 8, { live: liveOf(p, { stops: { 8: {} } }) }), { due: true });
  // Two stopped runs, both answers held: neither waits on the other; once 8 is delivered (going again), 9 waits for it.
  getDb().prepare("UPDATE pipelines SET status = 'running' WHERE id = ?").run(p[9]);
  const both = liveOf(p, { stops: { 8: { after: 9 }, 9: { after: 8 } } });
  assert.deepEqual(heldStopTurn(id, 8, { live: both }), { due: true });
  assert.deepEqual(heldStopTurn(id, 9, { live: liveOf(p, { stops: { 9: { after: 8 } }, going: [8] }) }), { due: false, after: 8 });
});

test('C3: stop open on run 1: independent run 2 fires, a run building on s1 stays scheduled', async () => {
  quiet();
  const p1 = pipe('running');
  const f = createSliceFeature({ pipelineId: p1, projectDir: root, title: 'Charts', outline: outlineOf(3, { 3: ['s1'] }),
    perspectives: ['product'], workflowId: 'wf_shape' });
  const t = rows(f.id).map((r) => r.ticket_id);
  const live = (pid) => (pid === p1 ? liveSliceFrom({ runId: 'r1', status: 'running', pendingQuestion: STOP_Q('g1'), approved: true }) : null);
  const out = await tickLive(live);
  assert.deepEqual(out.fired, [t[1]]);
  assert.equal(getTicket(t[2]).status, 'scheduled');
});

test('C4 (D7): a due change run takes the next turn before an earlier due run; it waits while another run is going', () => {
  const { id, t } = feature(3);
  const c = appendFeatureRun(id, { title: 'Change: R-po-1', goal: 'g', kind: 'change', requirements: ['R-po-1'] });
  assert.equal(c.index, 4);
  const g = (tid) => sliceGateState(getTicket(tid))?.state;
  assert.equal(g(c.ticketId), 'ok', 'the change run goes first');
  assert.equal(g(t[3]), 'waiting', 'run 3 waits for it');
  fire(c.ticketId, pipe('running'));
  assert.equal(g(t[3]), 'waiting', 'run 3 waits while the change run is going');
  const { id: id2, t: t2 } = feature(3);
  const c2 = appendFeatureRun(id2, { title: 'Change: R-po-1', goal: 'g', kind: 'change', requirements: ['R-po-1'] });
  fire(t2[3], pipe('running'));
  assert.equal(g(c2.ticketId), 'waiting', 'a change run waits while another run is going');
});

// ---- Feature D1 (Ship): finish order, the small-runs PR base, the ship order and the marked one-PR check ----

const markFeature = (fid) => {
  const origin = getDb().prepare('SELECT origin_pipeline_id FROM shape_features WHERE id = ?').get(fid).origin_pipeline_id;
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), origin);
};
const stepAt = (at) => [{ key: 'n_impl', status: 'done', updatedAt: at }];
/** A 3-run feature whose runs finish 1, 3, 2 (run 1 is the origin). → { id, p } (p[k] = run k's pipeline id) */
const finishing132 = ({ marked = true } = {}) => {
  quiet();
  const p1 = pipe('done', { steps: stepAt('2026-03-01T00:00:00Z') });
  const f = createSliceFeature({ pipelineId: p1, projectDir: root, title: 'Ship', outline: outlineOf(3), perspectives: ['product'], workflowId: 'wf_shape' });
  const t = rows(f.id).map((r) => r.ticket_id);
  const p2 = pipe('done', { steps: stepAt('2026-03-05T00:00:00Z') });
  const p3 = pipe('done', { steps: stepAt('2026-03-03T00:00:00Z') });
  fire(t[1], p2); fire(t[2], p3);
  if (marked) markFeature(f.id);
  return { id: f.id, p: [null, p1, p2, p3] };
};

test('D1 finishedSlices: ascending finish order [1, 3, 2]; latestFinishedSlice is its last element', () => {
  const { id, p } = finishing132();
  assert.deepEqual(finishedSlices(id).map((s) => s.index), [1, 3, 2]);
  assert.deepEqual(finishedSlices(id, { exclude: p[2] }).map((s) => s.index), [1, 3]);
  assert.ok(finishedSlices(id).every((s) => typeof s.finishedAt === 'string'));
  assert.deepEqual(latestFinishedSlice(id), { index: 2, pipelineId: p[2] });
});

test('D1 smallRunsPrBase: first → root, later → the previous finished run\'s branch; merged or pending predecessor → root', () => {
  const { id, p } = finishing132();
  assert.equal(smallRunsPrBase(p[1]), 'main');
  assert.equal(smallRunsPrBase(p[3]), `feat/${p[1]}`, "run 3's base is run 1's branch");
  assert.equal(smallRunsPrBase(p[2]), `feat/${p[3]}`, "run 2's base is run 3's branch");
  assert.equal(stackedPrBase(p[2], ['main', 'x']), `feat/${p[3]}`);
  // A merged predecessor: the root.
  getDb().prepare("UPDATE pipelines SET pr_url = 'https://github.com/me/repo/pull/3', pr_state = 'MERGED' WHERE id = ?").run(p[3]);
  assert.equal(smallRunsPrBase(p[2]), 'main');
  getDb().prepare("UPDATE pipelines SET pr_state = 'OPEN' WHERE id = ?").run(p[3]);
  // A predecessor still merging its work back: the root.
  getDb().prepare('UPDATE pipelines SET branch = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify({ source: 'main', feature: 'main', sameAsSource: true, worktreeDir: '/tmp/x' }), new Date().toISOString(), p[3]);
  assert.equal(smallRunsPrBase(p[2]), 'main');
  assert.equal(featureView(id).id, id);
});

test('D1 smallRunsPrBase: null for every run of an unmarked feature, so stackedPrBase is stackedPrBaseOf', () => {
  const { p } = finishing132({ marked: false });
  for (const k of [1, 2, 3]) assert.equal(smallRunsPrBase(p[k]), null);
  assert.equal(stackedPrBase(p[1], ['main']), null);
  assert.equal(smallRunsPrBase('nope'), null);
});

test('D1 shipOrder: marked → finish order, an archived run last; unmarked → view.slices itself', () => {
  const { id, p } = finishing132();
  assert.deepEqual(shipOrder(featureView(id)).map((s) => s.index), [1, 3, 2]);
  getDb().prepare("UPDATE pipelines SET archived_at = '2026-04-01T00:00:00Z' WHERE id = ?").run(p[3]);
  assert.deepEqual(shipOrder(featureView(id)).map((s) => s.index), [1, 2, 3]);
  const u = finishing132({ marked: false });
  const v = featureView(u.id);
  assert.equal(shipOrder(v), v.slices);
});

test('D1 oneShipCheck, marked: one → 409 STACKED_ONLY first; stacked → head is the latest finished run', async () => {
  const { id, p } = finishing132();
  const v = viewOf(id, [{ index: 1, pipelineId: p[1], state: 'done', pr: { url: 'u', state: 'OPEN' } }]);
  for (const deps of [ON, OFF]) {
    assert.deepEqual(await oneShipCheck(id, 'one', v, NEVER, deps),
      { head: null, refusal: { status: 409, body: { code: 'STACKED_ONLY', error: 'small runs ship a PR per run' } } });
    assert.deepEqual(await oneShipCheck(id, 'stacked', v, NEVER, deps), { head: p[2], refusal: null });
  }
});

// ── Small runs, a run starts with the work of every run it builds on: the reason and the fire-time gate ──────────────

test('R-arch-4 clashReason: the runs in ascending order and the file they clash in', () => {
  assert.equal(CHAIN.clashReason({ runs: [9, 8], files: ['src/a.mjs'] }), 'runs 8 and 9 clash in src/a.mjs');
  assert.equal(CHAIN.clashReason({ runs: [8, 4, 6], files: ['src/a.mjs'] }), 'runs 4, 6 and 8 clash in src/a.mjs');
});

test('R-arch-4 clashReason: at most 3 files are named, then how many more', () => {
  const files = ['one.mjs', 'two.mjs', 'three.mjs', 'four.mjs', 'five.mjs'];
  const five = CHAIN.clashReason({ runs: [8, 9], files });
  assert.ok(five.startsWith('runs 8 and 9 clash in '), five);
  for (const f of files.slice(0, 3)) assert.ok(five.includes(f), `${five}: names ${f}`);
  for (const f of files.slice(3)) assert.ok(!five.includes(f), `${five}: leaves out ${f}`);
  assert.ok(five.endsWith('and 2 more files'), five);
  // checkCombine caps the list; fileCount is the real number.
  assert.ok(CHAIN.clashReason({ runs: [8, 9], files, fileCount: 250 }).endsWith('and 247 more files'));
  const two = CHAIN.clashReason({ runs: [8, 9], files: files.slice(0, 2) });
  assert.ok(two.includes('one.mjs') && two.includes('two.mjs') && !/more file/.test(two), two);
});

/** A marked 4-run feature, runs 1 to 3 done on their own branches, run 4 building on `dependsOn`; `start` is the run
 *  whose branch run 4 would start from. → { id, ticket, branch: (k) => name, own } */
function combineFeature({ dependsOn = ['s2', 's3'], start = 2 } = {}) {
  const f = feature(4, { deps: { 4: dependsOn } });
  fire(f.t[3], pipe('done'));
  markFeature(f.id);
  const origin = getDb().prepare('SELECT origin_pipeline_id FROM shape_features WHERE id = ?').get(f.id).origin_pipeline_id;
  const p = [null, origin, getTicket(f.t[2]).pipelineId, getTicket(f.t[3]).pipelineId];
  const branch = (k) => `feat/${p[k]}`;
  return { id: f.id, p, ticket: getTicket(f.t[4]), branch, own: { pipelineId: p[start], sourceBranch: branch(start) } };
}
/** Flag on; `check(branches)` is checkCombine's answer, `ancestor(a, b)` isAncestor's. Every call is recorded. */
function combineSeams({ check = () => ({ status: 'clean', files: [], fileCount: 0 }), ancestor = () => false } = {}) {
  const checks = [];
  const ancestors = [];
  return { checks, ancestors, deps: { flagEnabled: () => true,
    checkCombine: async (dir, { branches }) => { checks.push({ dir, branches: [...branches] }); return check(branches); },
    isAncestor: async (dir, a, b) => { ancestors.push([a, b]); return ancestor(a, b); } } };
}
const conflicts = (branches, files = ['src/a.mjs']) => ({ status: 'conflicts', files, fileCount: files.length,
  branch: branches.at(-1), with: branches.slice(0, -1) });

test('sliceCombineGate: a clean check starts the run, checks the start and the missing branches once, and clears an old hold', () => withEnvVars(SMALL_ON, async () => {
  const w = combineFeature();
  const s = combineSeams();
  FEATURES.setClashHold(w.ticket.id, { reason: 'old', runs: [2, 3], files: ['x'], at: Date.now() });
  assert.equal(await CHAIN.sliceCombineGate(w.ticket, w.own, s.deps), null);
  assert.deepEqual(s.checks, [{ dir: w.ticket.projectDir, branches: [w.branch(2), w.branch(3)] }]);
  // Every ancestor question names branches under refs/heads/, so a tag or remote of the same name is never read.
  assert.deepEqual(s.ancestors, [[`refs/heads/${w.branch(3)}`, `refs/heads/${w.branch(2)}`]]);
  assert.equal(FEATURES.clashHoldOf(w.ticket.id), null);
}));

test('sliceCombineGate: nothing missing from the start branch answers null with no combine check', () => withEnvVars(SMALL_ON, async () => {
  const w = combineFeature();
  const s = combineSeams({ ancestor: () => true });
  FEATURES.setClashHold(w.ticket.id, { reason: 'old', runs: [2, 3], files: ['x'], at: Date.now() });
  assert.equal(await CHAIN.sliceCombineGate(w.ticket, w.own, s.deps), null);
  assert.deepEqual(s.checks, []);
  assert.equal(FEATURES.clashHoldOf(w.ticket.id), null);
}));

test('sliceCombineGate: a workspace ticket, no start branch, a pending start and an unmarked feature ask git nothing', () => withEnvVars(SMALL_ON, async () => {
  const w = combineFeature();
  const s = combineSeams({ check: conflicts });
  assert.equal(await CHAIN.sliceCombineGate({ ...w.ticket, workspaceId: 'ws_x' }, w.own, s.deps), null);
  for (const own of [null, { pending: true }, { pipelineId: null, sourceBranch: null }]) {
    assert.equal(await CHAIN.sliceCombineGate(w.ticket, own, s.deps), null, JSON.stringify(own));
  }
  assert.equal(await CHAIN.sliceCombineGate(w.ticket, w.own, { ...s.deps, flagEnabled: () => false }), null);
  getDb().prepare(`UPDATE pipelines SET shape_stats = NULL WHERE id = ?`).run(w.p[1]);
  assert.equal(await CHAIN.sliceCombineGate(w.ticket, w.own, s.deps), null);
  assert.deepEqual([s.checks, s.ancestors], [[], []]);
}));

test('sliceCombineGate: a dependency still merging its work back waits (transient)', () => withEnvVars(SMALL_ON, async () => {
  const w = combineFeature();
  getDb().prepare('UPDATE pipelines SET branch = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify({ source: 'main', feature: 'main', sameAsSource: true, worktreeDir: '/tmp/x' }), new Date().toISOString(), w.p[3]);
  const s = combineSeams();
  assert.deepEqual(await CHAIN.sliceCombineGate(w.ticket, w.own, s.deps),
    { ok: false, error: 'the run before it is still merging its work back', transient: true });
  assert.deepEqual(s.checks, []);
}));

test('sliceCombineGate: a branch that is gone fails the start for good', () => withEnvVars(SMALL_ON, async () => {
  const w = combineFeature();
  const s = combineSeams({ check: () => ({ status: 'no-branch', branch: 'feat/x', files: [], fileCount: 0 }) });
  assert.deepEqual(await CHAIN.sliceCombineGate(w.ticket, w.own, s.deps),
    { ok: false, error: 'branch feat/x no longer exists', transient: false });
}));

test('sliceCombineGate: a check that cannot run is transient only for a failure or a timeout', () => withEnvVars(SMALL_ON, async () => {
  const w = combineFeature();
  for (const [kind, transient] of [['timeout', true], ['failed', true], ['git-too-old', false], ['bad-branch', false], ['bad-request', false]]) {
    const s = combineSeams({ check: () => ({ status: 'error', kind, error: `boom ${kind}`, files: [], fileCount: 0 }) });
    assert.deepEqual(await CHAIN.sliceCombineGate(w.ticket, w.own, s.deps),
      { ok: false, error: `could not combine the work of runs 2 and 3: boom ${kind}`, transient }, kind);
    assert.equal(FEATURES.clashHoldOf(w.ticket.id), null, 'an error is no clash hold');
  }
}));

test('sliceCombineGate (D8): only the runs that clash are named: the third branch clashes with the second, not the first', () => withEnvVars(SMALL_ON, async () => {
  const w = combineFeature({ dependsOn: ['s1', 's2', 's3'], start: 1 });
  const s = combineSeams({ check: (branches) => (branches.includes(w.branch(2)) && branches.includes(w.branch(3))
    ? conflicts(branches) : { status: 'clean', files: [], fileCount: 0 }) });
  assert.deepEqual(await CHAIN.sliceCombineGate(w.ticket, w.own, s.deps),
    { ok: false, hold: true, error: 'runs 2 and 3 clash in src/a.mjs' });
  assert.deepEqual(s.checks[0].branches, [w.branch(1), w.branch(2), w.branch(3)]);
  assert.deepEqual(s.checks.slice(1).map((c) => c.branches).sort(),
    [[w.branch(1), w.branch(3)], [w.branch(2), w.branch(3)]].sort(), 'one pairwise check per branch it was combined with');
  const hold = FEATURES.clashHoldOf(w.ticket.id);
  assert.deepEqual([hold.reason, [...hold.runs].sort(), hold.files], ['runs 2 and 3 clash in src/a.mjs', [2, 3], ['src/a.mjs']]);
}));

test('sliceCombineGate (D8): a clash that needs the whole fold names every run in it', () => withEnvVars(SMALL_ON, async () => {
  const w = combineFeature({ dependsOn: ['s1', 's2', 's3'], start: 1 });
  const s = combineSeams({ check: (branches) => (branches.length > 2 ? conflicts(branches) : { status: 'clean', files: [], fileCount: 0 }) });
  assert.deepEqual(await CHAIN.sliceCombineGate(w.ticket, w.own, s.deps),
    { ok: false, hold: true, error: 'runs 1, 2 and 3 clash in src/a.mjs' });
}));

// ── Slice 3 (R-po-2): what a run that waited at a stop takes in before it goes on (takeInVerdict) ───────────────────
const BASE = 'feat/base';
const REASON = 'runs 2 and 3 clash in src/a.mjs';
/** A marked 4-run feature: run 1 (done) is the shared base's branch, run 2 is the waiting run (live), runs 3 and 4 are
 *  done, each with the record `branches` gives it (`{source}` of the shared base by default) and a finish time.
 *  → { id, p, br, own } */
function takeInFeature({ own = {}, three = {}, four = {}, at = { 3: '2026-03-02T00:00:00Z', 4: '2026-03-03T00:00:00Z' } } = {}) {
  const f = feature(4, { two: 'none' });
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = (SELECT origin_pipeline_id FROM shape_features WHERE id = ?)')
    .run(JSON.stringify({ source: 'main', feature: BASE }), f.id);
  const br = (k) => `feat/take-${f.id}-${k}`;
  const rec = (k, over) => ({ source: BASE, feature: br(k), ...over });
  const p2 = pipe('running', { branch: rec(2, own) });
  const p3 = pipe('done', { branch: rec(3, three), steps: stepAt(at[3]), updatedAt: at[3] });
  const p4 = pipe('done', { branch: rec(4, four), steps: stepAt(at[4]), updatedAt: at[4] });
  fire(f.t[2], p2); fire(f.t[3], p3); fire(f.t[4], p4);
  markFeature(f.id);
  return { id: f.id, p: [null, null, p2, p3, p4], br, own: { featureId: f.id, pipelineId: p2, branch: br(2) } };
}
/** Seams for takeInVerdict: every sibling branch resolves and is missing unless said otherwise (the shared base, run 1's
 *  branch, is held). Every call recorded. */
function takeInSeams({ check = () => ({ status: 'clean', files: [], fileCount: 0 }), ancestor = (a) => a === `refs/heads/${BASE}`, resolves = () => true } = {}) {
  const checks = [];
  const ancestors = [];
  return { checks, ancestors, deps: {
    checkCombine: async (dir, { branches }) => { checks.push([...branches]); return check(branches); },
    isAncestor: async (dir, a, b) => { ancestors.push([a, b]); return ancestor(a, b); },
    resolves: async (dir, ref) => resolves(ref) } };
}
const verdictOf = (w, s) => CHAIN.takeInVerdict(root, w.own, s.deps);

test('takeInVerdict: nothing missing when the run holds every finished sibling; no combine check', () => withEnvVars(SMALL_ON, async () => {
  const w = takeInFeature();
  const s = takeInSeams({ ancestor: () => true });
  assert.deepEqual(await verdictOf(w, s), { status: 'none', skipped: [] });
  assert.deepEqual(s.checks, []);
}));

test('takeInVerdict: a same-base sibling still merging its work back is a wait for its run number', () => withEnvVars(SMALL_ON, async () => {
  const w = takeInFeature();
  getDb().prepare('UPDATE pipelines SET branch = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify({ source: BASE, feature: BASE, sameAsSource: true, worktreeDir: '/tmp/x' }), new Date().toISOString(), w.p[3]);
  assert.deepEqual(await verdictOf(w, takeInSeams()), { status: 'wait', after: 3 });
}));

test('takeInVerdict: clean lists the missing runs in finish order with the combine check', () => withEnvVars(SMALL_ON, async () => {
  const w = takeInFeature({ at: { 3: '2026-03-04T00:00:00Z', 4: '2026-03-03T00:00:00Z' } });
  const s = takeInSeams();
  const v = await verdictOf(w, s);
  assert.equal(v.status, 'clean');
  assert.deepEqual(v.missing, [{ index: 4, branch: w.br(4), pipelineId: w.p[4] }, { index: 3, branch: w.br(3), pipelineId: w.p[3] }], 'finish order');
  assert.deepEqual(s.checks, [[w.br(2), w.br(4), w.br(3)]]);
  assert.equal(v.check.status, 'clean');
  assert.deepEqual(v.skipped, []);
}));

test('takeInVerdict: a sibling whose branch no longer resolves is left out and listed in skipped', () => withEnvVars(SMALL_ON, async () => {
  const w = takeInFeature();
  const v = await verdictOf(w, takeInSeams({ resolves: (ref) => !ref.endsWith(w.br(4)) }));
  assert.equal(v.status, 'clean');
  assert.deepEqual(v.missing.map((m) => m.index), [3]);
  assert.deepEqual(v.skipped, [{ index: 4, branch: w.br(4) }]);
}));

test('takeInVerdict: conflicts are a clash naming the runs and the file', () => withEnvVars(SMALL_ON, async () => {
  const w = takeInFeature();
  const held = (a) => a === `refs/heads/${BASE}` || a === `refs/heads/${w.br(4)}`;   // run 2 already holds run 4's work
  const v = await verdictOf(w, takeInSeams({ check: (branches) => conflicts(branches), ancestor: held }));
  assert.deepEqual([v.status, v.reason, v.runs.slice().sort(), v.files], ['clash', REASON, [2, 3], ['src/a.mjs']]);
}));

test('takeInVerdict: a failed check or a gone branch is an error, and a throwing seam never throws out', () => withEnvVars(SMALL_ON, async () => {
  const w = takeInFeature();
  const timeout = await verdictOf(w, takeInSeams({ check: () => ({ status: 'error', kind: 'timeout', error: 'git timed out', files: [], fileCount: 0 }) }));
  assert.equal(timeout.status, 'error');
  assert.match(timeout.error, /git timed out/);
  const gone = await verdictOf(w, takeInSeams({ check: (branches) => ({ status: 'no-branch', branch: branches[1], files: [], fileCount: 0 }) }));
  assert.equal(gone.status, 'error');
  assert.match(gone.error, /no longer exists/);
  assert.deepEqual(await verdictOf(w, takeInSeams({ ancestor: () => { throw new Error('boom'); } })), { status: 'error', error: 'boom' });
}));

test('takeInVerdict: a finished run on another base is missing too, in finish order, so a wait takes in all dev would', () => withEnvVars(SMALL_ON, async () => {
  const w = takeInFeature({ three: { source: 'feat/other' }, four: { source: 'feat/else' } });
  const s = takeInSeams();
  const v = await verdictOf(w, s);
  assert.deepEqual([v.status, v.missing?.map((m) => m.index)], ['clean', [3, 4]]);
  assert.deepEqual(s.checks, [[w.br(2), w.br(3), w.br(4)]]);
}));

test('takeInVerdict: a waiting run with no recorded fire-time base takes in nothing, and git is not asked', () => withEnvVars(SMALL_ON, async () => {
  const w = takeInFeature();
  getDb().prepare('UPDATE pipelines SET branch = NULL WHERE id = ?').run(w.p[2]);
  const s = takeInSeams();
  assert.deepEqual(await verdictOf(w, s), { status: 'none', skipped: [] });
  assert.deepEqual([s.checks, s.ancestors], [[], []]);
}));

test('takeInVerdict (D5): a run that took work in still has a fire-time base (sourceFrom ?? source); a run on its sibling\'s branch is taken in too', () => withEnvVars(SMALL_ON, async () => {
  // The waiting run and run 3 each took work in since they started from BASE; run 4 started from run 3's branch.
  const w = takeInFeature({ own: { source: 'feat/taken', sourceFrom: BASE }, three: { source: 'feat/else', sourceFrom: BASE } });
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?')
    .run(JSON.stringify({ source: w.br(3), feature: w.br(4) }), w.p[4]);
  const v = await verdictOf(w, takeInSeams());
  assert.deepEqual([v.status, v.missing?.map((m) => m.index)], ['clean', [3, 4]]);
  assert.equal(CHAIN.fireSourceOf(w.p[2]), BASE);
  assert.equal(CHAIN.fireSourceOf(w.p[4]), w.br(3));
  assert.equal(CHAIN.fireSourceOf('nope'), null);
}));

test('combineVerdict is exported for the take-in', () => { assert.equal(typeof CHAIN.combineVerdict, 'function'); });
