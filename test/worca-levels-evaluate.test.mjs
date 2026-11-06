// test/worca-levels-evaluate.test.mjs
// src/core/worca-levels/evaluate.mjs — the pure level evaluation: facts + a person's record -> level,
// latched doneAt, progress toward the next level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/core/worca-levels/evaluate.mjs';
import { WORCA_LEVELS, WORCA_THRESHOLDS } from '../src/shared/worca-levels.mjs';

const NOW = '2026-11-05T10:00:00.000Z';
const LATER = '2026-11-06T10:00:00.000Z';

const ZERO = Object.freeze({
  gettingStartedDone: false,
  gettingStarted: { done: 0, total: 5 },
  requirements: 0,
  requirementsFlag: true,
  startedRuns: 0,
  doneRuns: 0,
  addonsInstalled: 0,
  addonsEnabled: 0,
  spaces: 0,
  schedules: 0,
  scheduledRuns: 0,
  peakParallel: 0,
  statsDays: 0,
});

const SWIMMER = { gettingStartedDone: true, requirements: 1, doneRuns: 1 };
const HUNTER = { addonsInstalled: 1, spaces: 1, schedules: 1, statsDays: 1 };
const POD = {
  peakParallel: WORCA_THRESHOLDS.parallelFeatures,
  addonsEnabled: WORCA_THRESHOLDS.addonsInUse,
  scheduledRuns: WORCA_THRESHOLDS.scheduledRuns,
  statsDays: WORCA_THRESHOLDS.metricsDays,
};

const facts = (...parts) => ({ ...ZERO, ...Object.assign({}, ...parts) });
const record = (level = 1, doneAt = {}) => ({ level, doneAt });

test('no facts and no record: level 1, nothing done, progress toward level 2', () => {
  const r = evaluate(ZERO, undefined, NOW);
  assert.equal(r.level, 1);
  assert.deepEqual(r.doneAt, {});
  assert.deepEqual(r.progress, { done: 0, total: 3 });
  assert.equal(r.top, false);
  assert.deepEqual(r.next.map((a) => a.id), ['gettingStarted', 'firstRequirement', 'firstFeatureDone']);
  assert.ok(r.next.every((a) => a.done === false && a.doneAt === null));
});

test('an action carries its ladder fields into next', () => {
  const { next } = evaluate(ZERO, record(), NOW);
  const [first] = WORCA_LEVELS[1].actions;
  assert.equal(next[0].label, first.label);
  assert.equal(next[0].href, first.href);
});

test('completing the level 2 actions reaches level 2 and latches each at now', () => {
  const r = evaluate(facts(SWIMMER), record(), NOW);
  assert.equal(r.level, 2);
  assert.deepEqual(r.doneAt, {
    gettingStarted: NOW,
    firstRequirement: NOW,
    firstFeatureDone: NOW,
  });
  assert.deepEqual(r.progress, { done: 0, total: 4 });
  assert.equal(r.next.length, 4);
});

test('partial progress counts done actions of the next level', () => {
  const r = evaluate(facts({ gettingStartedDone: true, requirements: 2 }), record(), NOW);
  assert.equal(r.level, 1);
  assert.deepEqual(r.progress, { done: 2, total: 3 });
  const byId = Object.fromEntries(r.next.map((a) => [a.id, a]));
  assert.equal(byId.gettingStarted.done, true);
  assert.equal(byId.gettingStarted.doneAt, NOW);
  assert.equal(byId.firstFeatureDone.done, false);
});

test('firstRequirement: with the requirements flag off, a started run counts (D-6)', () => {
  const off = evaluate(facts({ requirementsFlag: false, startedRuns: 1 }), record(), NOW);
  assert.ok(off.doneAt.firstRequirement);
  const on = evaluate(facts({ requirementsFlag: true, startedRuns: 1 }), record(), NOW);
  assert.equal(on.doneAt.firstRequirement, undefined);
  const flagOffNoRuns = evaluate(facts({ requirementsFlag: false }), record(), NOW);
  assert.equal(flagOffNoRuns.doneAt.firstRequirement, undefined);
});

test('level 3 needs every level 2 and 3 action', () => {
  const r = evaluate(facts(SWIMMER, HUNTER), record(), NOW);
  assert.equal(r.level, 3);
  assert.deepEqual(r.progress, { done: 0, total: 4 });
  assert.equal(r.top, false);
});

test('cumulative ordering: Hunter actions without Swimmer leave the level at 1', () => {
  const r = evaluate(facts(HUNTER), record(), NOW);
  assert.equal(r.level, 1);
  assert.ok(r.doneAt.addonInstalled && r.doneAt.statsViewed);
});

test('one missing level 3 action holds the level at 2', () => {
  const r = evaluate(facts(SWIMMER, HUNTER, { schedules: 0 }), record(), NOW);
  assert.equal(r.level, 2);
  assert.deepEqual(r.progress, { done: 3, total: 4 });
});

test('thresholded actions need the threshold, not just one', () => {
  const below = evaluate(
    facts(SWIMMER, HUNTER, POD, {
      peakParallel: WORCA_THRESHOLDS.parallelFeatures - 1,
      addonsEnabled: WORCA_THRESHOLDS.addonsInUse - 1,
      scheduledRuns: WORCA_THRESHOLDS.scheduledRuns - 1,
      statsDays: WORCA_THRESHOLDS.metricsDays - 1,
    }),
    record(),
    NOW,
  );
  assert.equal(below.level, 3);
  assert.deepEqual(below.progress, { done: 0, total: 4 });
});

test('R-po 5: level 4 is top with next and progress null', () => {
  const r = evaluate(facts(SWIMMER, HUNTER, POD), record(), NOW);
  assert.equal(r.level, 4);
  assert.equal(r.top, true);
  assert.equal(r.next, null);
  assert.equal(r.progress, null);
});

test('I-2: level never decreases when every fact is zero', () => {
  const r = evaluate(ZERO, record(3, { gettingStarted: NOW }), LATER);
  assert.equal(r.level, 3);
  assert.deepEqual(r.progress, { done: 0, total: 4 });
});

test('I-2: a latched doneAt survives a fact dropping and keeps its original time', () => {
  const r = evaluate(ZERO, record(2, { spaceSetUp: NOW }), LATER);
  assert.equal(r.doneAt.spaceSetUp, NOW);
  const spaceNext = evaluate(ZERO, record(2, { spaceSetUp: NOW }), LATER).next.find((a) => a.id === 'spaceSetUp');
  assert.equal(spaceNext.done, true);
  assert.equal(spaceNext.doneAt, NOW);
});

test('a still-true fact does not re-stamp an existing latch', () => {
  const r = evaluate(facts(SWIMMER), record(2, { gettingStarted: NOW }), LATER);
  assert.equal(r.doneAt.gettingStarted, NOW);
  assert.equal(r.doneAt.firstRequirement, LATER);
});

test('I-3: a level-up returns the higher level and a repeat with the new record is stable', () => {
  const rec = record(1);
  const first = evaluate(facts(SWIMMER), rec, NOW);
  assert.equal(first.level, 2);
  const second = evaluate(facts(SWIMMER), record(first.level, first.doneAt), LATER);
  assert.equal(second.level, 2);
  assert.deepEqual(second.doneAt, first.doneAt);
  assert.deepEqual(second.next, first.next);
});

test('the record level wins over lower computed facts but facts can raise it', () => {
  assert.equal(evaluate(facts(SWIMMER), record(3), NOW).level, 3);
  assert.equal(evaluate(facts(SWIMMER, HUNTER), record(2), NOW).level, 3);
});

test('does not mutate the record or the facts, and returns a new doneAt object', () => {
  const rec = record(1, { gettingStarted: NOW });
  const f = facts(SWIMMER);
  const recCopy = JSON.parse(JSON.stringify(rec));
  const factsCopy = JSON.parse(JSON.stringify(f));
  const r = evaluate(f, rec, LATER);
  assert.deepEqual(rec, recCopy);
  assert.deepEqual(f, factsCopy);
  assert.notEqual(r.doneAt, rec.doneAt);
});

test('a record with no doneAt is treated as empty', () => {
  const r = evaluate(ZERO, { level: 2 }, NOW);
  assert.equal(r.level, 2);
  assert.deepEqual(r.doneAt, {});
});
