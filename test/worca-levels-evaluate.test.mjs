// test/worca-levels-evaluate.test.mjs
// src/core/worca-levels/evaluate.mjs — the pure level evaluation: facts + a person's record -> level,
// latched doneAt, progress toward the next level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/core/worca-levels/evaluate.mjs';
import { WORCA_LEVELS } from '../src/shared/worca-levels.mjs';

const NOW = '2026-11-05T10:00:00.000Z';
const LATER = '2026-11-06T10:00:00.000Z';
const PARALLEL_AT = '2026-10-01T09:00:00.000Z';
const OPENED_AT = '2026-10-02T09:00:00.000Z';
const COUNCIL_AT = '2026-10-03T09:00:00.000Z';
const VIEWED_AT = '2026-10-04T09:00:00.000Z';

const ZERO = Object.freeze({
  gettingStartedDone: false,
  gettingStarted: Object.freeze({ done: 0, total: 9 }),
  policyInstalled: false,
  requirements: 0,
  requirementsFlag: true,
  startedRuns: 0,
  doneRuns: 0,
  addonsInstalled: 0,
  addonsAtOnce: 0,
  spaces: 0,
  schedules: false,
  repeatingSchedules: false,
  statsViewedAt: null,
  parallelDoneAt: null,
  teamMetricsRuns: 0,
  teamMetricsOpenedAt: null,
  council: Object.freeze({ current: 0, metAt: null }),
});

const RUNNER = { gettingStartedDone: true, gettingStarted: { done: 9, total: 9 }, requirements: 1, doneRuns: 1 };
const HOOKED = { addonsInstalled: 1, spaces: 1, schedules: true, statsViewedAt: VIEWED_AT };
const WORCAHOLIC = {
  parallelDoneAt: PARALLEL_AT,
  addonsAtOnce: 2,
  repeatingSchedules: true,
  teamMetricsOpenedAt: OPENED_AT,
  teamMetricsRuns: 10,
};
const COUNCIL = { council: { current: 30, metAt: COUNCIL_AT } };

const facts = (...parts) => ({ ...ZERO, ...Object.assign({}, ...parts) });
const record = (level = 1, doneAt = {}) => ({ level, doneAt });

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

test('no facts and no record: level 1, nothing done, progress toward Runner', () => {
  const r = evaluate(ZERO, undefined, NOW);
  assert.equal(r.level, 1);
  assert.deepEqual(r.doneAt, {});
  assert.deepEqual(r.progress, { done: 0, total: 3, unit: 'items' });
  assert.equal(r.top, false);
  assert.deepEqual(r.nextLevel, { index: 2, key: 'runner', name: 'Runner' });
  assert.deepEqual(r.next.map((a) => a.id), ['gettingStarted', 'firstRequirement', 'firstFeatureDone']);
  assert.ok(r.next.every((a) => a.done === false && a.doneAt === null));
});

test('an action carries its ladder fields into next', () => {
  const { next } = evaluate(ZERO, record(), NOW);
  const [first] = WORCA_LEVELS[1].actions;
  assert.equal(next[0].label, first.label);
  assert.equal(next[0].href, first.href);
});

test('Runner rule (R-po-25): Getting started 9/9, a requirement and a finished feature', () => {
  const r = evaluate(facts(RUNNER), record(), NOW);
  assert.equal(r.level, 2);
  assert.deepEqual(r.doneAt, { gettingStarted: NOW, firstRequirement: NOW, firstFeatureDone: NOW });
  assert.deepEqual(r.progress, { done: 0, total: 4, unit: 'items' });
  assert.deepEqual(r.nextLevel, { index: 3, key: 'hooked', name: 'Hooked' });
  for (const missing of ['gettingStartedDone', 'requirements', 'doneRuns']) {
    const partial = evaluate(facts(RUNNER, { [missing]: missing === 'gettingStartedDone' ? false : 0 }), record(), NOW);
    assert.equal(partial.level, 1, `${missing} missing keeps level 1`);
  }
});

test('gettingStarted carries count/of until done, then drops them', () => {
  const part = evaluate(facts({ gettingStarted: { done: 4, total: 9 } }), record(), NOW);
  const gs = part.next.find((a) => a.id === 'gettingStarted');
  assert.equal(gs.count, 4);
  assert.equal(gs.of, 9);
  const done = evaluate(facts(RUNNER), record(), NOW);
  assert.equal(done.next.some((a) => a.count !== undefined), false);
});

test('firstRequirement: with the requirements flag off, a started run counts (D-5)', () => {
  const off = evaluate(facts({ requirementsFlag: false, startedRuns: 1 }), record(), NOW);
  assert.ok(off.doneAt.firstRequirement);
  const on = evaluate(facts({ requirementsFlag: true, startedRuns: 1 }), record(), NOW);
  assert.equal(on.doneAt.firstRequirement, undefined);
  const offNoRuns = evaluate(facts({ requirementsFlag: false }), record(), NOW);
  assert.equal(offNoRuns.doneAt.firstRequirement, undefined);
});

test('Hooked rule: add-on, space, schedule and Statistics on top of Runner', () => {
  const r = evaluate(facts(RUNNER, HOOKED), record(), NOW);
  assert.equal(r.level, 3);
  assert.deepEqual(r.progress, { done: 0, total: 4, unit: 'items' });
  assert.equal(r.doneAt.statsViewed, NOW);
  for (const drop of [{ addonsInstalled: 0 }, { spaces: 0 }, { schedules: false }, { statsViewedAt: null }]) {
    assert.equal(evaluate(facts(RUNNER, HOOKED, drop), record(), NOW).level, 2, JSON.stringify(drop));
  }
});

test('WorcaHolic needs all 4 items (R-po-29) and is then the Council step', () => {
  const full = evaluate(facts(RUNNER, HOOKED, WORCAHOLIC), record(), NOW);
  assert.equal(full.level, 4);
  assert.equal(full.top, false);
  const drops = [
    { parallelDoneAt: null },
    { addonsAtOnce: 1 },
    { repeatingSchedules: false },
    { teamMetricsOpenedAt: null },
  ];
  for (const drop of drops) {
    assert.equal(evaluate(facts(RUNNER, HOOKED, WORCAHOLIC, drop), record(), NOW).level, 3, JSON.stringify(drop));
  }
});

test('the stamp uses the fact `at` (R-po-32): parallel, team metrics and council keep their own instants', () => {
  const r = evaluate(facts(RUNNER, HOOKED, WORCAHOLIC, COUNCIL), record(), NOW);
  assert.equal(r.doneAt.parallelFeatures, PARALLEL_AT);
  assert.equal(r.doneAt.teamMetrics, OPENED_AT);
  assert.equal(r.doneAt.councilStreak, COUNCIL_AT);
  assert.equal(r.doneAt.addonsAtOnce, NOW);
});

test('teamMetrics is met by opening it, never by the run count alone', () => {
  const r = evaluate(facts({ teamMetricsRuns: 25 }), record(), NOW);
  assert.equal(r.doneAt.teamMetrics, undefined);
});

test('council via streak (R-po-26): metAt plus WorcaHolic complete is Council, the top', () => {
  const r = evaluate(facts(RUNNER, HOOKED, WORCAHOLIC, COUNCIL), record(), NOW);
  assert.equal(r.level, 5);
  assert.equal(r.top, true);
  assert.equal(r.progress, null);
  assert.equal(r.next, null);
  assert.equal(r.nextLevel, null);
});

test('sequential earning (D-4): WorcaHolic items met but Hooked not met stays at Runner', () => {
  const r = evaluate(facts(RUNNER, WORCAHOLIC), record(), NOW);
  assert.equal(r.level, 2);
  assert.ok(r.doneAt.parallelFeatures && r.doneAt.teamMetrics);
});

test('a Council streak before WorcaHolic is complete: the level waits (D-4)', () => {
  const r = evaluate(facts(RUNNER, HOOKED, COUNCIL), record(), NOW);
  assert.equal(r.level, 3);
  assert.equal(r.doneAt.councilStreak, COUNCIL_AT);
  assert.equal(r.top, false);
});

test('Hunter-style actions without Runner leave the level at 1', () => {
  const r = evaluate(facts(HOOKED), record(), NOW);
  assert.equal(r.level, 1);
  assert.ok(r.doneAt.addonInstalled && r.doneAt.statsViewed);
});

test('progress counts the done items of the next level', () => {
  const r = evaluate(facts(RUNNER, { addonsInstalled: 1, spaces: 1 }), record(), NOW);
  assert.equal(r.level, 2);
  assert.deepEqual(r.progress, { done: 2, total: 4, unit: 'items' });
});

test('progress is in days when the next level is Council (R-po-27)', () => {
  const r = evaluate(facts(RUNNER, HOOKED, WORCAHOLIC, { council: { current: 12, metAt: null } }), record(), NOW);
  assert.equal(r.level, 4);
  assert.deepEqual(r.progress, { done: 12, total: 30, unit: 'days' });
  assert.deepEqual(r.nextLevel, { index: 5, key: 'council', name: "Worca's Council" });
  const streak = r.next.find((a) => a.id === 'councilStreak');
  assert.equal(streak.count, 12);
  assert.equal(streak.of, 30);
  const capped = evaluate(facts(RUNNER, HOOKED, WORCAHOLIC, { council: { current: 45, metAt: null } }), record(), NOW);
  assert.deepEqual(capped.progress, { done: 30, total: 30, unit: 'days' });
});

test('teamMetrics carries count/of until done (R-po-39)', () => {
  const before = evaluate(facts(RUNNER, HOOKED, { teamMetricsRuns: 6 }), record(), NOW);
  const tm = before.next.find((a) => a.id === 'teamMetrics');
  assert.equal(tm.count, 6);
  assert.equal(tm.of, 10);
  const after = evaluate(facts(RUNNER, HOOKED, { teamMetricsRuns: 6, teamMetricsOpenedAt: OPENED_AT }), record(), NOW);
  const done = after.next.find((a) => a.id === 'teamMetrics');
  assert.equal(done.done, true);
  assert.equal(done.count, undefined);
});

test('the latch survives facts dropping (R-po-28)', () => {
  const stored = record(4, {
    addonsAtOnce: NOW,
    teamMetrics: OPENED_AT,
    parallelFeatures: PARALLEL_AT,
  });
  const r = evaluate(ZERO, stored, LATER);
  assert.equal(r.doneAt.addonsAtOnce, NOW);
  assert.equal(r.doneAt.teamMetrics, OPENED_AT);
  assert.equal(r.doneAt.parallelFeatures, PARALLEL_AT);
  const council = evaluate(ZERO, record(5, { councilStreak: COUNCIL_AT }), LATER);
  assert.equal(council.doneAt.councilStreak, COUNCIL_AT);
  assert.equal(council.level, 5);
});

test('a still-true fact does not re-stamp an existing latch', () => {
  const r = evaluate(facts(RUNNER), record(2, { gettingStarted: NOW }), LATER);
  assert.equal(r.doneAt.gettingStarted, NOW);
  assert.equal(r.doneAt.firstRequirement, LATER);
});

test('a stored level above the earned one is kept (I-1), and facts can raise it', () => {
  assert.equal(evaluate(ZERO, record(3), NOW).level, 3);
  assert.equal(evaluate(facts(RUNNER), record(3), NOW).level, 3);
  assert.equal(evaluate(facts(RUNNER, HOOKED), record(2), NOW).level, 3);
  assert.deepEqual(evaluate(ZERO, record(3), NOW).progress, { done: 0, total: 4, unit: 'items' });
});

test('a repeat evaluation with the new record is stable', () => {
  const first = evaluate(facts(RUNNER), record(1), NOW);
  const second = evaluate(facts(RUNNER), record(first.level, first.doneAt), LATER);
  assert.equal(second.level, 2);
  assert.deepEqual(second.doneAt, first.doneAt);
  assert.deepEqual(second.next, first.next);
});

test('does not mutate the record or the facts, and returns a new doneAt object', () => {
  const rec = deepFreeze(record(1, { gettingStarted: NOW }));
  const f = deepFreeze(facts(RUNNER, HOOKED, WORCAHOLIC, COUNCIL));
  const r = evaluate(f, rec, LATER);
  assert.equal(r.level, 5);
  assert.notEqual(r.doneAt, rec.doneAt);
  assert.deepEqual(rec, { level: 1, doneAt: { gettingStarted: NOW } });
});

test('a record with no doneAt is treated as empty', () => {
  const r = evaluate(ZERO, { level: 2 }, NOW);
  assert.equal(r.level, 2);
  assert.deepEqual(r.doneAt, {});
});

test('every action id in the ladder has a condition', () => {
  const everything = facts(RUNNER, HOOKED, WORCAHOLIC, COUNCIL);
  const { doneAt } = evaluate(everything, undefined, NOW);
  const ids = WORCA_LEVELS.flatMap((l) => l.actions.map((a) => a.id));
  assert.ok(ids.length > 0);
  for (const id of ids) assert.ok(doneAt[id], `${id} has a working condition`);
});
