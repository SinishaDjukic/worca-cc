// test/shape-run-status.test.mjs — Slice 3 (R-po-1, R-po-3): the one shared run status phrase. Pure: literal objects only.
// src/shared/shape/run-status.mjs does not exist yet, so this file fails to load until the module is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RUN_MARKS, namedWaits, neededByOf, runStatus } from '../src/shared/shape/run-status.mjs';
import { SIXTEEN_RUN_LINKS } from './helpers/shape-sixteen-runs.mjs';

const LINKS = [[1, []], [2, [1]], [3, [1]], [4, [1, 3]], [5, [3, 4]], [6, [3, 5]], [7, [1, 2, 3, 4, 5, 6]], [8, [1, 2]],
  [9, []], [10, [3]], [11, []], [12, [1, 7, 10]], [13, [11]]];
/** A Map run → slice, every run planned unless `over[run]` says otherwise; `buildsOn` from the links. */
const world = (over = {}) => new Map(LINKS.map(([run, buildsOn]) => [run, { index: run, state: 'planned', kind: null, buildsOn, ...(over[run] || {}) }]));
const read = (run, w, extra = {}) => runStatus({ slice: { ...w.get(run), ...extra }, slices: w });
const snapAt = (nodeId) => ({ status: 'running', stepper: { careRun: { roles: [] } }, active: [{ nodeId }], decor: { status: {} } });

test('RUN_MARKS is the closed set of marks', () => {
  assert.deepEqual([...RUN_MARKS], ['done', 'live', 'ask', 'after', 'ring', 'faint', 'failed']);
  assert.ok(Object.isFrozen(RUN_MARKS));
});

test('done', () => {
  assert.deepEqual(runStatus({ slice: { index: 1, state: 'done' } }), { word: 'done', mark: 'done' });
});

test('live phase words: never "working"', () => {
  const slice = { index: 6, state: 'running' };
  assert.deepEqual(runStatus({ slice, snap: snapAt('n_impl') }), { word: 'building', mark: 'live' });
  assert.deepEqual(runStatus({ slice, snap: snapAt('n_roles') }), { word: 'reviewing plan', mark: 'live' });
  assert.deepEqual(runStatus({ slice, snap: snapAt('n_tests') }), { word: 'writing tests', mark: 'live' });
  assert.deepEqual(runStatus({ slice, snap: snapAt('n_review') }), { word: 'reviewing', mark: 'live' });
  for (const n of ['n_clarify', 'n_plan', 'n_roles', 'n_tests', 'n_impl', 'n_review']) assert.notEqual(runStatus({ slice, snap: snapAt(n) }).word, 'working');
});

test('live without snapshot: word null (caller keeps dev text), mark live', () => {
  assert.deepEqual(runStatus({ slice: { index: 6, state: 'running' }, snap: null }), { word: null, mark: 'live' });
});

test('open stop and open ask read "waiting for you"', () => {
  assert.deepEqual(runStatus({ slice: { index: 2, state: 'approval', stop: { reason: 'check', held: false } } }), { word: 'waiting for you', mark: 'ask' });
  assert.deepEqual(runStatus({ slice: { index: 2, state: 'questions' } }), { word: 'waiting for you', mark: 'ask' });
});

test('held before open ask: a held answer reads "after run N", also with nextTurn', () => {
  const slice = { index: 2, state: 'approval', stop: { held: true, after: 3 } };
  assert.deepEqual(runStatus({ slice }), { word: 'after run 3', mark: 'after' });
  assert.deepEqual(runStatus({ slice: { ...slice, nextTurn: true } }), { word: 'after run 3', mark: 'after' });
});

test('failed: error and failed states', () => {
  for (const state of ['error', 'failed']) assert.deepEqual(runStatus({ slice: { index: 5, state } }), { word: 'failed', mark: 'failed' });
});

test('reduction: implied runs are left out (R-po-1)', () => {
  const w = world();
  const seven = { ...w.get(7), waitsFor: [2, 3, 4, 5, 6] };
  const twelve = { ...w.get(12), waitsFor: [7, 10] };
  assert.deepEqual(namedWaits(seven, w), [2, 6]);
  assert.deepEqual(namedWaits(twelve, w), [7, 10]);
  assert.deepEqual(runStatus({ slice: seven, slices: w }), { word: 'waits for run 2, 6', mark: 'faint' });
  assert.deepEqual(runStatus({ slice: twelve, slices: w }), { word: 'waits for run 7, 10', mark: 'faint' });
  assert.deepEqual(namedWaits({}, w), []);
});

test('suffixes: (needs you) and (failed) inside the word (R-po-3)', () => {
  const w = world({ 2: { state: 'approval', stop: { held: false } } });
  assert.equal(read(7, w, { waitsFor: [2, 3, 4, 5, 6] }).word, 'waits for run 2 (needs you), 6');
  const w2 = world({ 5: { state: 'error' } });
  assert.equal(read(6, w2, { waitsFor: [5] }).word, 'waits for run 5 (failed)');
  const w3 = world({ 2: { state: 'questions' } });
  assert.equal(read(8, w3, { waitsFor: [2] }).word, 'waits for run 2 (needs you)');
});

test('held dep has no suffix; paused and stopped deps neither', () => {
  assert.equal(read(8, world({ 2: { state: 'approval', stop: { held: true, after: 3 } } }), { waitsFor: [2] }).word, 'waits for run 2');
  assert.equal(read(8, world({ 2: { state: 'paused' } }), { waitsFor: [2] }).word, 'waits for run 2');
  assert.equal(read(8, world({ 2: { state: 'stopped' } }), { waitsFor: [2] }).word, 'waits for run 2');
});

test('missing links name more: a run without buildsOn implies nothing', () => {
  const w = world({ 6: { buildsOn: undefined } });
  assert.deepEqual(namedWaits({ ...w.get(7), waitsFor: [2, 3, 6] }, w), [2, 3, 6]);
  assert.equal(read(7, w, { waitsFor: [2, 3, 6] }).word, 'waits for run 2, 3, 6');
});

test('cycle-safe: two runs building on each other still return', () => {
  const w = new Map([[3, { index: 3, state: 'planned', buildsOn: [4] }], [4, { index: 4, state: 'planned', buildsOn: [3] }], [5, { index: 5, state: 'planned', buildsOn: [3, 4] }]]);
  const named = namedWaits({ ...w.get(5), waitsFor: [3, 4] }, w);
  assert.ok(Array.isArray(named) && named.length >= 1);
  assert.equal(typeof runStatus({ slice: { ...w.get(5), waitsFor: [3, 4] }, slices: w }).word, 'string');
});

test('cannot start (direction dd181c89f): word null, mark faint, never next, wins over waitsFor and nextTurn', () => {
  const w = world();
  const cannotStart = { run: 3, reason: 'was canceled' };
  assert.deepEqual(read(4, w, { cannotStart, waitsFor: [3] }), { word: null, mark: 'faint' });
  assert.deepEqual(read(4, w, { cannotStart, nextTurn: true }), { word: null, mark: 'faint' });
});

test('next and no word', () => {
  const w = world();
  assert.deepEqual(read(9, w, { nextTurn: true }), { word: 'next', mark: 'ring' });
  assert.deepEqual(read(9, w, {}), { word: '', mark: 'ring' });
  assert.deepEqual(read(9, w, { waitsFor: [] }), { word: '', mark: 'ring' });
  assert.deepEqual(read(13, w, { kind: 'change', nextTurn: true }), { word: 'next · small change run', mark: 'ring' });
});

test('nextTurn alone decides next: the function owns no turn rule', () => {
  const w = world();
  const a = { 9: read(9, w, { nextTurn: true }), 10: read(10, w, {}) };
  const b = { 9: read(9, w, {}), 10: read(10, w, { nextTurn: true }) };
  assert.equal(a[9].word, 'next'); assert.equal(a[10].word, '');
  assert.equal(b[9].word, ''); assert.equal(b[10].word, 'next');
  assert.equal(a[9].mark, b[10].mark);
});

test('no input: nothing throws, null word and mark; every mark is in RUN_MARKS or null', () => {
  assert.deepEqual(runStatus({}), { word: null, mark: null });
  assert.deepEqual(runStatus({ slice: null }), { word: null, mark: null });
  assert.deepEqual(runStatus({ slice: { state: 'mystery' } }), { word: null, mark: null });
  for (const slice of [{ state: 'done' }, { state: 'planned' }, { state: 'error' }, { state: 'questions' }, { state: 'planned', waitsFor: [2] }]) {
    const { mark } = runStatus({ slice });
    assert.ok(mark === null || RUN_MARKS.includes(mark));
  }
});

// ── Slice 11 (R-po-6): neededByOf, the runs that directly build on a run ─────────────────────────────────────────────
test('S11-T1 neededByOf over the 16-run links: run 1 → 2,3,4,7,8,12; run 7 → 12; run 16 → none; no buildsOn → none; stays pure', () => {
  const w = new Map(SIXTEEN_RUN_LINKS.map((l) => [l.run, { index: l.run, buildsOn: [...l.dependsOn] }]));
  assert.deepEqual(neededByOf(1, w), [2, 3, 4, 7, 8, 12]);
  assert.deepEqual(neededByOf(7, w), [12]);
  assert.deepEqual(neededByOf(16, w), []);
  assert.deepEqual(neededByOf('x', w), []);
  const bare = new Map(SIXTEEN_RUN_LINKS.map((l) => [l.run, { index: l.run }]));
  assert.deepEqual(neededByOf(1, bare), []);
  assert.deepEqual(neededByOf(1), []);
  const src = readFileSync(new URL('../src/shared/shape/run-status.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*(src\/core|\/core\/|ui\/)/);
});
