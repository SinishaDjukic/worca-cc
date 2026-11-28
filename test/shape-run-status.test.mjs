// test/shape-run-status.test.mjs — Slice 3 (R-po-1, R-po-3): the one shared run status phrase. Pure: literal objects only.
// src/shared/shape/run-status.mjs does not exist yet, so this file fails to load until the module is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RUN_MARKS, memberStatusOf, namedWaits, neededByOf, runStatus } from '../src/shared/shape/run-status.mjs';
// Slice 6: a namespace read, so a missing new export fails only its own test, not the whole file.
import * as RS from '../src/shared/shape/run-status.mjs';
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

// Slice 16 (H5) replaces direction dd181c89f's "no word of its own": the row names the reduced list with its cause.
test('s16 H5: cannot start reads "cannot start · waits for run 3 (was canceled)", mark faint, never next, wins over waitsFor and nextTurn', () => {
  const w = world();
  const cannotStart = { run: 3, reason: 'was canceled' };
  const want = { word: 'cannot start · waits for run 3 (was canceled)', mark: 'faint' };
  assert.deepEqual(read(4, w, { cannotStart, waitsFor: [3] }), want);
  assert.deepEqual(read(4, w, { cannotStart, nextTurn: true }), want);
});

test('s16 H5: the list is the reduced one other rows name, plus the run that can never finish with its cause, ascending, once each', () => {
  // Run 7 builds on runs 1–6: namedWaits leaves 2 and 6. Run 2 failed (its own cause), run 3 was canceled (implied by 6).
  const w = world({ 2: { state: 'error' }, 3: { state: 'canceled' } });
  const cannotStart = { run: 3, reason: 'was canceled' };
  assert.deepEqual(read(7, w, { cannotStart, waitsFor: [2, 3, 4, 5, 6] }),
    { word: 'cannot start · waits for run 2 (failed), 3 (was canceled), 6', mark: 'faint' });
  // Already in the reduced list: named once, with the cannot-start reason in place of its own suffix.
  assert.equal(read(6, world({ 5: { state: 'error' } }), { cannotStart: { run: 5, reason: 'failed' }, waitsFor: [5] }).word,
    'cannot start · waits for run 5 (failed)');
  // No waitsFor at all (the bad run alone).
  assert.equal(read(4, w, { cannotStart }).word, 'cannot start · waits for run 3 (was canceled)');
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

// ── Slice 5 (D1, D2, R-arch-6): memberStatusOf, the one adapter from a feature's members to runStatus ────────────────
/** The base state's members: runs 1 and 11 done, run 2 at an open stop, run 3 building, the rest planned. */
const baseMembers = () => {
  const w = world({ 1: { state: 'done' }, 11: { state: 'done' }, 2: { state: 'approval', stop: { reason: 'requirement', held: false } },
    3: { state: 'running' }, 7: { waitsFor: [2, 3, 4, 5, 6] }, 12: { waitsFor: [7, 10] } });
  return [...w].map(([position, slice]) => ({ position, slice, ...(position === 3 ? { snap: snapAt('n_impl') } : {}) }));
};

test('S5 memberStatusOf: a member reads what runStatus answers over the members\' own slices (position → slice) and its snap', () => {
  const members = baseMembers();
  const slices = new Map(members.map((m) => [m.position, m.slice]));
  const at = (n) => members.find((m) => m.position === n);
  const status = memberStatusOf(members);
  assert.deepEqual(status(at(12)), runStatus({ slice: at(12).slice, slices, snap: null }));
  assert.deepEqual(status(at(12)), { word: 'waits for run 7, 10', mark: 'faint' });
  assert.deepEqual(status(at(7)), { word: 'waits for run 2 (needs you), 6', mark: 'faint' }, 'the Map reaches the other members\' slices');
  assert.deepEqual(status(at(3)), { word: 'building', mark: 'live' }, 'the member\'s own snapshot');
});

test('S5 memberStatusOf: a member without a slice gives null; an empty or missing list gives a function returning null', () => {
  const status = memberStatusOf([...baseMembers(), { position: 17 }]);
  assert.equal(status({ position: 17 }), null);
  assert.equal(status({ position: 18, slice: null }), null);
  for (const fn of [memberStatusOf([]), memberStatusOf()]) {
    assert.equal(typeof fn, 'function');
    assert.equal(fn({ position: 1 }), null);
  }
});

test('S5 R-arch-6: the sidebar and app.js build runStatus input only through memberStatusOf', () => {
  const text = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const app = text('../ui/public/app.js');
  const list = text('../ui/public/runs-list.mjs');
  assert.match(app, /memberStatusOf\(/);
  assert.match(list, /memberStatusOf\(/);
  for (const [name, src] of [['app.js', app], ['runs-list.mjs', list]]) {
    assert.doesNotMatch(src, /\[\s*\w+\.position\s*,\s*\w+\.slice\s*\]/, `${name}: no position → slice Map of its own`);
  }
  const fn = app.match(/function featureRowStatus\(row\)\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(fn, /memberStatusOf\(row\.members\)/, 'featureRowStatus is one call');
  assert.doesNotMatch(fn, /new Map|runStatus\(/);
});

// ── Slice 6 (R-po-4): holdsUpOf and stopLineText, the only source of a stop line's "holds up" runs and its text ───────
const ALL_LINKS = new Map(SIXTEEN_RUN_LINKS.map((l) => [l.run, l.dependsOn]));
/** The busy state's 16 slices: runs 1 and 3 done, 2, 4 and 11 at stops, 5 failed, 6 building, the rest planned. */
const busySlices = (over = {}) => {
  const states = { 1: 'done', 2: 'approval', 3: 'done', 4: 'questions', 5: 'error', 6: 'running', 11: 'questions' };
  return new Map([...ALL_LINKS].map(([run, dependsOn]) => [run, { index: run, state: states[run] || 'planned', buildsOn: [...dependsOn], ...(over[run] || {}) }]));
};

test('S6 holdsUpOf on the busy slices: every unfinished run that builds on a run directly or through others, ascending', () => {
  const w = busySlices();
  assert.deepEqual(RS.holdsUpOf(2, w), [7, 8, 12, 15, 16]);
  assert.deepEqual(RS.holdsUpOf(4, w), [5, 6, 7, 12, 16], 'the failed run 5 and the live run 6 cannot finish while run 4 is open');
  assert.deepEqual(RS.holdsUpOf(5, w), [6, 7, 12, 16]);
  assert.deepEqual(RS.holdsUpOf(11, w), [13, 14, 15, 16]);
  assert.deepEqual(RS.holdsUpOf(16, w), [], 'nothing builds on run 16');
  assert.deepEqual(RS.holdsUpOf('x', w), []);
  assert.deepEqual(RS.holdsUpOf(2), []);
});

test('S6 holdsUpOf: a done or canceled dependant is not listed, a run behind it is', () => {
  const w = busySlices({ 7: { state: 'done' }, 8: { state: 'canceled' } });
  assert.deepEqual(RS.holdsUpOf(2, w), [12, 15, 16], 'runs 7 and 8 are over; 12 (behind 7) and 15 (behind 8) are still held');
});

test('S6 holdsUpOf: a cycle ends and never lists the run itself; the slices are not changed', () => {
  const w = new Map([[3, { index: 3, state: 'planned', buildsOn: [4] }], [4, { index: 4, state: 'planned', buildsOn: [3] }], [5, { index: 5, state: 'planned', buildsOn: [4] }]]);
  const before = JSON.stringify([...w]);
  assert.deepEqual(RS.holdsUpOf(3, w), [4, 5]);
  assert.deepEqual(RS.holdsUpOf(4, w), [3, 5]);
  assert.equal(JSON.stringify([...w]), before);
});

test('S6 stopLineText: the four busy lines', () => {
  const open = (index, reason, kind, holdsUp) => ({ index, kind, reason, failed: false, holdsUp });
  assert.equal(RS.stopLineText(open(2, 'requirement', 'plan', [7, 8, 12, 15, 16])), 'Run 2 · plan approval · holds up 7, 8, 12, 15, 16');
  assert.equal(RS.stopLineText(open(4, 'check', 'gate', [5, 6, 7, 12, 16])), 'Run 4 · plan approval · holds up 5, 6, 7, 12, 16');
  assert.equal(RS.stopLineText({ index: 5, kind: null, reason: null, failed: true, holdsUp: [6, 7, 12, 16] }), 'Run 5 failed · holds up 6, 7, 12, 16');
  assert.equal(RS.stopLineText(open(11, 'check', 'gate', [13, 14, 15, 16])), 'Run 11 · plan approval · holds up 13, 14, 15, 16');
});

test('S6 stopLineText: a line that holds up nothing has no "holds up" part', () => {
  assert.equal(RS.stopLineText({ index: 9, kind: 'gate', reason: 'objection', failed: false, holdsUp: [] }), 'Run 9 · gate');
  assert.equal(RS.stopLineText({ index: 9, kind: 'plan', reason: 'check', failed: false }), 'Run 9 · plan approval');
  assert.equal(RS.stopLineText({ index: 16, kind: null, reason: null, failed: true, holdsUp: [] }), 'Run 16 failed');
});

test('S6 stopLineText words (D7): a stop\'s reason wins over its kind; without one the kind names the step', () => {
  const word = (kind, reason = null) => RS.stopLineText({ index: 3, kind, reason, failed: false, holdsUp: [] });
  assert.equal(word('gate', 'check'), 'Run 3 · plan approval');
  assert.equal(word('plan', 'requirement'), 'Run 3 · plan approval');
  assert.equal(word('gate', 'objection'), 'Run 3 · gate');
  const KINDS = { plan: 'plan approval', outline: 'runs approval', clarify: 'questions', questions: 'questions', gate: 'gate',
    recovery: 'recovery', care: 'start', prototype: 'prototype' };
  for (const [kind, w] of Object.entries(KINDS)) assert.equal(word(kind), `Run 3 · ${w}`, kind);
  for (const kind of ['mystery', null]) assert.equal(word(kind), 'Run 3 · waiting for you', String(kind));
  assert.ok(Object.isFrozen(RS.STOP_KIND_WORDS));
  assert.deepEqual({ ...RS.STOP_KIND_WORDS }, KINDS);
});

// ── Slice 8 (R-ux-1, R-ux-2): the word of a held resume, and the Resume label ───────────────────────────────────
test('s8: a held resume reads "after run 4" with the after mark; a plain paused run keeps dev\'s text (word null)', () => {
  const slice = { index: 6, state: 'paused', heldResume: { after: 4 } };
  assert.deepEqual(runStatus({ slice }), { word: 'after run 4', mark: 'after' });
  assert.deepEqual(runStatus({ slice: { ...slice, nextTurn: true } }), { word: 'after run 4', mark: 'after' }, 'also as the next in turn');
  assert.deepEqual(runStatus({ slice: { index: 6, state: 'paused' } }), { word: null, mark: null });
  for (const heldResume of [{}, { after: '4' }, null]) {
    assert.deepEqual(runStatus({ slice: { index: 6, state: 'paused', heldResume } }), { word: null, mark: null }, JSON.stringify(heldResume));
  }
});

test('s8: a held stop on the same slice still wins (first match): its own after', () => {
  const heldResume = { after: 4 };
  assert.deepEqual(runStatus({ slice: { index: 6, state: 'paused', heldResume } }), { word: 'after run 4', mark: 'after' }, 'with no stop');
  assert.deepEqual(runStatus({ slice: { index: 6, state: 'approval', stop: { held: true, after: 3 }, heldResume } }), { word: 'after run 3', mark: 'after' });
});

test('s8: resumeLabel(4) is "Resume after run 4"; resumeLabel(undefined), resumeLabel(null) and resumeLabel(\'4\') are "Resume"', () => {
  assert.equal(typeof RS.resumeLabel, 'function', 'run-status.mjs exports resumeLabel');
  assert.equal(RS.resumeLabel(4), 'Resume after run 4');
  for (const after of [undefined, null, '4']) assert.equal(RS.resumeLabel(after), 'Resume', String(after));
});

// ── Shaper small runs slice 11 (R-ux-2): the preview of the run a footer Resume acts on ──────────────────────────
const S11_RUNS = [{ index: 4, pipelineId: 'p4', state: 'paused', resumeAfter: 6 }, { index: 6, pipelineId: 'p6', state: 'running' }];

test('s11: resumeAfterOf reads the resumeAfter of the slice with that pipelineId, so paused run 4 reads "Resume after run 6" and working run 6 "Resume"', () => {
  assert.equal(typeof RS.resumeAfterOf, 'function', 'run-status.mjs exports resumeAfterOf');
  assert.equal(RS.resumeAfterOf(S11_RUNS, 'p4'), 6);
  assert.equal(RS.resumeAfterOf(S11_RUNS, 'p6'), null);
  assert.equal(RS.resumeLabel(RS.resumeAfterOf(S11_RUNS, 'p4')), 'Resume after run 6');
  assert.equal(RS.resumeLabel(RS.resumeAfterOf(S11_RUNS, 'p6')), 'Resume');
  // Two paused runs: each reads its own number, never the other's.
  const two = [{ pipelineId: 'p4', resumeAfter: 6 }, { pipelineId: 'p5' }];
  assert.deepEqual(['p4', 'p5'].map((p) => RS.resumeAfterOf(two, p)), [6, null]);
});

test('s11: resumeAfterOf returns null, and never throws, for an unknown or empty id, no slices, or a resumeAfter that is no integer', () => {
  assert.equal(typeof RS.resumeAfterOf, 'function', 'run-status.mjs exports resumeAfterOf');
  assert.equal(RS.resumeAfterOf(S11_RUNS, 'p9'), null, 'unknown id');
  for (const slices of [null, undefined, {}, 'p4', []]) assert.equal(RS.resumeAfterOf(slices, 'p4'), null, `slices ${JSON.stringify(slices)}`);
  // A run not started yet has no pipelineId: an empty or missing id must not match it.
  const planned = [{ pipelineId: null, resumeAfter: 6 }, { pipelineId: '', resumeAfter: 6 }, { resumeAfter: 6 }];
  for (const id of ['', null, undefined]) assert.equal(RS.resumeAfterOf(planned, id), null, `id ${String(id)}`);
  for (const resumeAfter of ['6', 6.5, null, undefined]) assert.equal(RS.resumeAfterOf([{ pipelineId: 'p4', resumeAfter }], 'p4'), null, `resumeAfter ${String(resumeAfter)}`);
  assert.equal(RS.resumeAfterOf([null, undefined, { pipelineId: 'p4', resumeAfter: 6 }], 'p4'), 6, 'a hole in the list is skipped');
});

test('s11: the hosts read the preview through resumeAfterOf and write none of the words themselves', () => {
  const src = (p) => readFileSync(new URL(`../ui/public/${p}`, import.meta.url), 'utf8');
  for (const p of ['group-page.mjs', 'app.js', 'chat/run-card.mjs']) assert.ok(!src(p).includes('Resume after run'), `${p}: no literal label`);
  for (const p of ['app.js', 'chat/run-card.mjs']) assert.match(src(p), /\bresumeAfterOf\(/, `${p} calls resumeAfterOf`);
});

// ── Slice 16 (R-qa-4): the held and refusal words, one text per cause, all from this module ─────────────────────────
const CLASH = 'runs 2 and 3 clash in a.mjs';
/** One reply of POST /api/resume per cause, as the server sends it. */
const REPLY = {
  saving: { ok: true, held: true, pipelineId: 'p4', after: 3, saving: true },
  turn: { ok: true, held: true, pipelineId: 'p4', after: 3 },
  clash: { error: CLASH, code: 'TAKE_IN_REFUSED' },
  cost: { error: 'total cost limit reached', budget: { blocked: true } },
};
const exported = (...names) => { for (const n of names) assert.equal(typeof RS[n], 'function', `run-status.mjs exports ${n}`); };

test('s16: HELD_TURN_WORD is "waiting for its turn"', () => {
  assert.equal(RS.HELD_TURN_WORD, 'waiting for its turn');
});

test('s16 cause, still saving: the reply reads "Run 3 is still saving its work"', () => {
  exported('resumeCauseOf', 'resumeWhy');
  assert.equal(RS.resumeCauseOf(REPLY.saving), 'saving');
  assert.equal(RS.resumeWhy(REPLY.saving), 'Run 3 is still saving its work');
});

test('s16 cause, another run holds the turn: the reply reads "Run 3 holds the turn"', () => {
  exported('resumeCauseOf', 'resumeWhy');
  assert.equal(RS.resumeCauseOf(REPLY.turn), 'turn');
  assert.equal(RS.resumeWhy(REPLY.turn), 'Run 3 holds the turn');
  assert.equal(RS.resumeCauseOf({ ...REPLY.turn, saving: false }), 'turn', 'only saving: true is a saving hold');
});

test('s16 cause, clash: TAKE_IN_REFUSED reads "Not resumed: " and the clash reason', () => {
  exported('resumeCauseOf', 'resumeWhy');
  assert.equal(RS.resumeCauseOf(REPLY.clash), 'clash');
  assert.equal(RS.resumeWhy(REPLY.clash), 'Not resumed: runs 2 and 3 clash in a.mjs');
});

test('s16 cause, cost or budget: every cost reply reads "Not resumed: the cost limit is reached"', () => {
  exported('resumeCauseOf', 'resumeWhy');
  for (const body of [
    REPLY.cost,
    { error: 'total cost limit reached' },
    { error: 'pipeline cost limit reached' },
    { code: null, error: 'pipeline cost limit reached' },   // the stored resumeRefused record
    { error: 'pipeline cost limit reached', budget: {}, needsOverride: true },
    { error: 'spent too much', budget: { blocked: true } },
    { error: 'spent too much', needsOverride: true },
  ]) {
    assert.equal(RS.resumeCauseOf(body), 'cost', JSON.stringify(body));
    assert.equal(RS.resumeWhy(body), 'Not resumed: the cost limit is reached', JSON.stringify(body));
  }
});

test('s16 cause: each of the four causes has its own text', () => {
  exported('resumeWhy');
  const texts = Object.values(REPLY).map((b) => RS.resumeWhy(b));
  assert.equal(new Set(texts).size, 4, JSON.stringify(texts));
});

test('s16 cause: an unknown refusal says the server\'s own error; a non-object says nothing; neither function throws', () => {
  exported('resumeCauseOf', 'resumeWhy');
  const moved = { code: 'base-moved', error: 'main moved on' };
  assert.equal(RS.resumeCauseOf(moved), null);
  assert.equal(RS.resumeWhy(moved), 'Not resumed: main moved on');
  for (const body of [null, undefined, 'x', 3]) {
    assert.equal(RS.resumeCauseOf(body), null, String(body));
    assert.equal(RS.resumeWhy(body), '', String(body));
  }
  assert.equal(RS.resumeCauseOf({ ok: true, runId: 'r' }), null, 'a run that went on');
});

test('s16 resumeNote (D5): a held press is an info toast, a clash or cost refusal an err toast, both with the cause as detail', () => {
  exported('resumeNote');
  assert.deepEqual(RS.resumeNote(REPLY.turn, 200), { tone: 'info', title: 'Waiting for its turn', detail: 'Run 3 holds the turn' });
  assert.deepEqual(RS.resumeNote(REPLY.saving, 200), { tone: 'info', title: 'Waiting', detail: 'Run 3 is still saving its work' });
  assert.deepEqual(RS.resumeNote(REPLY.clash, 409), { tone: 'err', title: 'Could not resume the run', detail: 'Not resumed: runs 2 and 3 clash in a.mjs' });
  assert.deepEqual(RS.resumeNote(REPLY.cost, 403), { tone: 'err', title: 'Could not resume the run', detail: 'Not resumed: the cost limit is reached' });
});

test('s16 resumeNote (D5): null for a run that went on, and for a needsOverride reply (the cost confirm handles it)', () => {
  exported('resumeNote');
  assert.equal(RS.resumeNote({ ok: true, runId: 'r', pipelineId: 'p4' }, 200), null);
  assert.equal(RS.resumeNote({ error: 'pipeline cost limit reached', needsOverride: true, budget: {} }, 403), null);
});

test('s16: resumeLabel with heldAfter reads "Waiting for its turn"; without one it is today\'s label', () => {
  assert.equal(RS.resumeLabel(null, { heldAfter: 3 }), 'Waiting for its turn');
  assert.equal(RS.resumeLabel(6, { heldAfter: 3 }), 'Waiting for its turn', 'held wins over the preview');
  for (const heldAfter of [null, undefined, '3']) {
    assert.equal(RS.resumeLabel(null, { heldAfter }), 'Resume', String(heldAfter));
    assert.equal(RS.resumeLabel(6, { heldAfter }), 'Resume after run 6', String(heldAfter));
  }
});

test('s16: heldAfterOf reads the heldResume of the slice with that pipelineId, null for anything else, and never throws', () => {
  exported('heldAfterOf');
  const slices = [null, { index: 4, pipelineId: 'p4', state: 'paused', heldResume: { after: 3 } }, { index: 5, pipelineId: 'p5', state: 'paused' }];
  assert.equal(RS.heldAfterOf(slices, 'p4'), 3);
  assert.equal(RS.heldAfterOf(slices, 'p5'), null);
  assert.equal(RS.heldAfterOf(slices, 'p9'), null);
  for (const s of [null, undefined, {}, 'p4', []]) assert.equal(RS.heldAfterOf(s, 'p4'), null, JSON.stringify(s));
  for (const id of ['', null, undefined]) assert.equal(RS.heldAfterOf([{ pipelineId: '', heldResume: { after: 3 } }, { heldResume: { after: 3 } }], id), null, String(id));
  assert.equal(RS.heldAfterOf([{ pipelineId: 'p4', heldResume: { after: '3' } }], 'p4'), null, 'a non-integer after');
});

test('s16: the menu note and the disabled reason of a held Resume', () => {
  exported('heldResumeNote', 'heldResumeTitle');
  assert.equal(RS.heldResumeNote(3), 'Waiting for its turn after run 3');
  assert.equal(RS.heldResumeTitle(3), 'Goes on after run 3');
});

test('s16 D4: a paused run whose held resume was refused reads "not resumed: …" with no mark of its own', () => {
  const refused = (resumeRefused, more = {}) => runStatus({ slice: { index: 4, state: 'paused', resumeRefused, ...more } });
  assert.deepEqual(refused({ code: null, error: 'pipeline cost limit reached' }), { word: 'not resumed: the cost limit is reached', mark: null });
  assert.deepEqual(refused({ code: 'TAKE_IN_REFUSED', error: CLASH }), { word: 'not resumed: runs 2 and 3 clash in a.mjs', mark: null });
  assert.deepEqual(refused({ code: 'base-moved', error: 'main moved on' }), { word: 'not resumed: main moved on', mark: null });
  assert.equal(refused({ code: null, error: 'total cost limit reached' }, { stop: { reason: 'check', held: false } }).word,
    'not resumed: the cost limit is reached', 'before the "waiting for you" check');
});

test('s16 D4: a held resume or answer wins over an old refusal, and only a paused run reads it', () => {
  const resumeRefused = { code: null, error: 'pipeline cost limit reached' };
  assert.deepEqual(runStatus({ slice: { index: 4, state: 'paused', resumeRefused, heldResume: { after: 3 } } }), { word: 'after run 3', mark: 'after' });
  assert.deepEqual(runStatus({ slice: { index: 4, state: 'paused', resumeRefused, stop: { held: true, after: 2 } } }), { word: 'after run 2', mark: 'after' });
  assert.deepEqual(runStatus({ slice: { index: 4, state: 'done', resumeRefused } }), { word: 'done', mark: 'done' });
  assert.deepEqual(runStatus({ slice: { index: 4, state: 'running', resumeRefused } }), { word: null, mark: 'live' });
  assert.deepEqual(runStatus({ slice: { index: 4, state: 'paused' } }), { word: null, mark: null }, 'no refusal: dev\'s text');
});

test('s16 R-arch-7: the hosts write none of the held or refusal words', () => {
  const words = ['waiting for its turn', 'is still saving its work', 'holds the turn', 'not resumed:', 'the cost limit is reached',
    'goes on after run', 'cannot start ·'];
  const code = (p) => readFileSync(new URL(`../ui/public/${p}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[\s;,{}()])\/\/.*$/gm, '$1').toLowerCase();
  for (const p of ['app.js', 'chat/run-card.mjs', 'runs-list.mjs', 'shape/feature-actions.mjs']) {
    const src = code(p);
    for (const w of words) assert.ok(!src.includes(w), `${p}: no literal "${w}"`);
  }
  assert.match(code('app.js'), /\bresumenote\(/, 'app.js asks resumeNote for the toast');
  assert.match(code('chat/run-card.mjs'), /\bheldafterof\(/, 'the chat card reads heldAfterOf');
});
