// test/worca-levels-evaluate.test.mjs
// src/core/worca-levels/evaluate.mjs — the pure level evaluation (ladder v2): facts + a person's record + now ->
// level 0..5, latched doneAt, reachedAt, progress toward the next level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/core/worca-levels/evaluate.mjs';
import { WORCA_LEVELS } from '../src/shared/worca-levels.mjs';
import { toView, ladderState, modeSuggestionOf } from '../src/core/worca-levels/view.mjs';

const NOW = '2026-11-05T10:00:00.000Z';
const LATER = '2026-11-06T10:00:00.000Z';
const PARALLEL_AT = '2026-10-01T09:00:00.000Z';
const RUNS_AT = '2026-10-02T09:00:00.000Z';
const DAYS_AT = '2026-10-03T09:00:00.000Z';

const ZERO = Object.freeze({
  setupFinished: false,
  providerSignedIn: false,
  runnerSteps: Object.freeze({ done: 0, of: 6 }),
  teamMetricsOn: false,
  teamPolicyOn: false,
  realRuns: 0,
  runsOnDays: Object.freeze({ metAt: null, runs: 0, days: 0 }),
  activeDays: Object.freeze({ inWindow: 0, metAt: null }),
  prsOpened: 0,
  prsMerged: 0,
  prMergedUnknown: false,
  daysUnknown: false,
  scheduledRunDone: false,
  workspaceRunDone: false,
  projects: 0,
  repeatingScheduleRunsMax: 0,
  addonsInstalled: 0,
  addonsAtOnce: 0,
  parallelDoneAt: null,
});

const CURIOUS = { setupFinished: true, providerSignedIn: true };
const RUNNER = { runnerSteps: { done: 6, of: 6 }, realRuns: 3 };
const HOOKED = {
  runsOnDays: { metAt: RUNS_AT, runs: 10, days: 3 },
  prsOpened: 1,
  addonsInstalled: 1,
  scheduledRunDone: true,
};
const WORCAHOLIC = {
  parallelDoneAt: PARALLEL_AT,
  prsMerged: 5,
  addonsAtOnce: 2,
  projects: 3,
};
const COUNCIL = { activeDays: { inWindow: 20, metAt: DAYS_AT } };

const facts = (...parts) => ({ ...ZERO, ...Object.assign({}, ...parts) });
const record = (level = 0, doneAt = {}) => ({ level, doneAt });

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

test('no facts and no record: level 0, progress toward Curious', () => {
  const r = evaluate(ZERO, undefined, NOW);
  assert.equal(r.level, 0);
  assert.deepEqual(r.doneAt, {});
  assert.deepEqual(r.reachedAt, {});
  assert.deepEqual(r.progress, { done: 0, total: 2, unit: 'items' });
  assert.equal(r.top, false);
  assert.deepEqual(r.nextLevel, { index: 1, key: 'curious', name: 'Curious' });
  assert.deepEqual(r.next.map((a) => a.id), ['setupFinished', 'providerSignedIn']);
  assert.ok(r.next.every((a) => a.status === 'todo' && a.done === false && a.doneAt === null));
  assert.deepEqual(Object.keys(r.levels), ['1', '2', '3', '4', '5']);
});

test('setup without provider -> level 0, the provider item is still to do (R-po-25)', () => {
  const r = evaluate(facts({ setupFinished: true }), record(), NOW);
  assert.equal(r.level, 0);
  assert.deepEqual(r.doneAt, { setupFinished: NOW });
  assert.deepEqual(r.next.map((a) => [a.id, a.status]), [['setupFinished', 'done'], ['providerSignedIn', 'todo']]);
});

test('provider latched before setup, signed out at setup -> level 0 (I-8)', () => {
  const before = evaluate(facts({ providerSignedIn: true }), record(), NOW);
  assert.equal(before.doneAt.providerSignedIn, undefined, 'the provider needs setup at the same evaluation');
  const after = evaluate(facts({ setupFinished: true }), record(before.level, before.doneAt), LATER);
  assert.equal(after.level, 0);
  assert.equal(after.doneAt.providerSignedIn, undefined);
});

test('set-up-later user finishing setup with a provider -> level 1 (R-po-23)', () => {
  const later = evaluate(ZERO, record(), NOW);
  assert.equal(later.level, 0);
  const r = evaluate(facts(CURIOUS), record(later.level, later.doneAt), LATER);
  assert.equal(r.level, 1);
  assert.deepEqual(r.reachedAt, { 1: LATER });
  assert.deepEqual(r.nextLevel, { index: 2, key: 'runner', name: 'Runner' });
});

test('setup + a Copilot-only provider -> level 1 (R-po-24)', () => {
  // the onboarding source folds Copilot into providerSignedIn; the evaluator only reads that flag
  assert.equal(evaluate(facts({ setupFinished: true, providerSignedIn: true, runnerSteps: { done: 1, of: 6 } }), record(), NOW).level, 1);
});

test('Runner needs steps 1-6 and 3 real runs; steps 7-9 are irrelevant (R-po-4)', () => {
  const r = evaluate(facts(CURIOUS, RUNNER), record(), NOW);
  assert.equal(r.level, 2);
  assert.deepEqual(r.nextLevel, { index: 3, key: 'hooked', name: 'Hooked' });
  for (const drop of [{ runnerSteps: { done: 5, of: 6 } }, { realRuns: 2 }]) {
    assert.equal(evaluate(facts(CURIOUS, RUNNER, drop), record(), NOW).level, 1, JSON.stringify(drop));
  }
  const steps = evaluate(facts(CURIOUS, { runnerSteps: { done: 4, of: 6 }, realRuns: 1 }), record(), NOW);
  const byId = Object.fromEntries(steps.next.map((a) => [a.id, a]));
  assert.deepEqual([byId.runnerSteps.count, byId.runnerSteps.of], [4, 6]);
  assert.deepEqual([byId.realRuns.count, byId.realRuns.of], [1, 3]);
});

test('2 real runs + 10 demo runs -> not Runner (R-po-5)', () => {
  // demo runs are excluded by the facts source, so only the real count reaches the evaluator
  const r = evaluate(facts(CURIOUS, { runnerSteps: { done: 6, of: 6 }, realRuns: 2 }), record(), NOW);
  assert.equal(r.level, 1);
  assert.equal(r.doneAt.realRuns, undefined);
});

test('count/of drop once an item is done', () => {
  const r = evaluate(facts(CURIOUS, RUNNER), record(), NOW);
  assert.equal(r.levels[2].some((a) => a.count !== undefined), false);
});

test('Hooked needs the runs, a PR and any 2 of the five choices', () => {
  const r = evaluate(facts(CURIOUS, RUNNER, HOOKED, { addonsInstalled: 1 }), record(), NOW);
  assert.equal(r.level, 3);
  const one = evaluate(facts(CURIOUS, RUNNER, HOOKED, { addonsInstalled: 0 }), record(), NOW);
  assert.equal(one.level, 2, 'one choice is not enough');
  const pick = one.levels[3].find((v) => v.id === 'hookedPick');
  assert.deepEqual([pick.status, pick.count, pick.of], ['todo', 1, 2]);
  assert.equal(pick.choices.length, 5);
  for (const drop of [{ runsOnDays: { metAt: null, runs: 9, days: 3 } }, { prsOpened: 0 }]) {
    assert.equal(evaluate(facts(CURIOUS, RUNNER, HOOKED, drop), record(), NOW).level, 2, JSON.stringify(drop));
  }
});

test('a pick item is stamped with its need-th choice stamp', () => {
  const stored = record(2, { scheduledRunDone: '2026-10-05T00:00:00.000Z', addonInstalled: '2026-10-09T00:00:00.000Z' });
  const r = evaluate(facts(CURIOUS, RUNNER, HOOKED), stored, NOW);
  const pick = r.levels[3].find((v) => v.id === 'hookedPick');
  assert.equal(pick.status, 'done');
  assert.equal(pick.doneAt, '2026-10-09T00:00:00.000Z');
});

test('teamSetUp is required only for people on a team (R-po-31, R-po-35)', () => {
  const solo = evaluate(facts(CURIOUS, RUNNER, HOOKED, { addonsInstalled: 1 }), record(), NOW);
  assert.equal(solo.levels[3].some((v) => v.id === 'teamSetUp'), false);
  assert.equal(solo.level, 3);
  const team = evaluate(facts(CURIOUS, RUNNER, HOOKED, { addonsInstalled: 1, teamMetricsOn: true }), record(), NOW);
  const item = team.levels[3].find((v) => v.id === 'teamSetUp');
  assert.deepEqual(item.parts, [{ count: 1, of: 2 }]);
  assert.equal(team.level, 2);
  const both = evaluate(facts(CURIOUS, RUNNER, HOOKED, { addonsInstalled: 1, teamMetricsOn: true, teamPolicyOn: true }), record(), NOW);
  assert.equal(both.level, 3);
});

const SOLO_HOOKED = [HOOKED, { addonsInstalled: 1 }];
const hookedItems = (r) => r.levels[3].map((v) => v.id);

test('team person with all other Hooked items stays Runner; both team items -> Hooked (R-po-29)', () => {
  const base = [CURIOUS, RUNNER, ...SOLO_HOOKED];
  const one = evaluate(facts(...base, { teamPolicyOn: true }), record(), NOW);
  assert.equal(one.level, 2);
  const both = evaluate(facts(...base, { teamMetricsOn: true, teamPolicyOn: true }), record(), NOW);
  assert.equal(both.level, 3);
  assert.equal(both.doneAt.teamSetUp, NOW);
});

test('solo person reaches Hooked with 10 runs/3 days, 1 PR, 2 choices (R-po-30)', () => {
  const r = evaluate(facts(CURIOUS, RUNNER, ...SOLO_HOOKED), record(), NOW);
  assert.equal(r.level, 3);
  assert.equal(r.doneAt.teamSetUp, undefined);
});

test('Hooked list: 4 items for team, 3 without Team set up for solo, same wording (R-po-31, R-po-35)', () => {
  const solo = evaluate(facts(CURIOUS, RUNNER), record(), NOW);
  const team = evaluate(facts(CURIOUS, RUNNER, { teamMetricsOn: true }), record(), NOW);
  assert.deepEqual(hookedItems(solo), ['hookedRuns', 'prOpened', 'hookedPick']);
  assert.deepEqual(hookedItems(team), ['hookedRuns', 'prOpened', 'teamSetUp', 'hookedPick']);
  const strip = (v) => ({ id: v.id, label: v.label, hint: v.hint, href: v.href, openLabel: v.openLabel });
  const soloById = Object.fromEntries(solo.levels[3].map((v) => [v.id, strip(v)]));
  for (const v of team.levels[3].filter((x) => soloById[x.id])) assert.deepEqual(strip(v), soloById[v.id]);
});

test('only metrics on -> Team set up todo 1 of 2 (R-po-32, R-po-36)', () => {
  const r = evaluate(facts(CURIOUS, RUNNER, { teamMetricsOn: true }), record(), NOW);
  const t = r.levels[3].find((v) => v.id === 'teamSetUp');
  assert.deepEqual([t.status, t.done, t.count, t.of], ['todo', false, 1, 2]);
  const policy = evaluate(facts(CURIOUS, RUNNER, { teamPolicyOn: true }), record(), NOW).levels[3].find((v) => v.id === 'teamSetUp');
  assert.deepEqual([policy.count, policy.of], [1, 2]);
});

test('Team set up appears when one team item is started after Runner (R-po-38)', () => {
  const before = evaluate(facts(CURIOUS, RUNNER), record(), NOW);
  assert.equal(hookedItems(before).includes('teamSetUp'), false);
  const after = evaluate(facts(CURIOUS, RUNNER, { teamPolicyOn: true }), record(before.level, before.doneAt), LATER);
  assert.equal(hookedItems(after).includes('teamSetUp'), true);
  assert.equal(after.level, 2);
});

test('Hooked then team started -> still Hooked (R-po-39)', () => {
  const hooked = evaluate(facts(CURIOUS, RUNNER, ...SOLO_HOOKED), record(), NOW);
  assert.equal(hooked.level, 3);
  const later = evaluate(facts(CURIOUS, RUNNER, ...SOLO_HOOKED, { teamMetricsOn: true }), { level: hooked.level, doneAt: hooked.doneAt, reachedAt: hooked.reachedAt }, LATER);
  assert.equal(later.level, 3);
  assert.equal(later.reachedAt[3], hooked.reachedAt[3]);
  assert.equal(later.levels[3].find((v) => v.id === 'teamSetUp').done, false);
});

test('Hooked then team started: the WorcaHolic items still climb past the held level (A-11)', () => {
  const hooked = evaluate(facts(CURIOUS, RUNNER, ...SOLO_HOOKED), record(), NOW);
  const rec = { level: hooked.level, doneAt: hooked.doneAt, reachedAt: hooked.reachedAt };
  const climbed = evaluate(facts(CURIOUS, RUNNER, ...SOLO_HOOKED, WORCAHOLIC, { teamMetricsOn: true }), rec, LATER);
  assert.equal(climbed.level, 4);
  assert.equal(climbed.levels[3].find((v) => v.id === 'teamSetUp').done, false);
});

test('a v1 floor at level 3 with an undone Runner or Hooked item still climbs on the WorcaHolic items', () => {
  const climbed = evaluate(facts(CURIOUS, WORCAHOLIC), record(3), NOW);
  assert.equal(climbed.level, 4);
  assert.equal(evaluate(facts(CURIOUS), record(3), NOW).level, 3, 'without them the held level is kept');
});

test('team started then removed before Hooked -> not required (A-15)', () => {
  const started = evaluate(facts(CURIOUS, RUNNER, ...SOLO_HOOKED, { teamMetricsOn: true }), record(), NOW);
  assert.equal(started.level, 2);
  const removed = evaluate(facts(CURIOUS, RUNNER, ...SOLO_HOOKED), record(started.level, started.doneAt), LATER);
  assert.equal(removed.level, 3);
  assert.equal(hookedItems(removed).includes('teamSetUp'), false);
});

test('solo reaches WorcaHolic and Council (R-po-9)', () => {
  const r = evaluate(facts(CURIOUS, RUNNER, ...SOLO_HOOKED, WORCAHOLIC, COUNCIL), record(), NOW);
  assert.equal(r.level, 5);
  assert.equal(r.top, true);
  assert.equal(r.doneAt.teamSetUp, undefined);
});

test('Hooked/WorcaHolic/Council never met from page visits; there is no visit fact (R-po-8)', () => {
  assert.equal(Object.keys(ZERO).some((k) => /visit|opened|page/i.test(k) && k !== 'prsOpened'), false);
  const visited = facts(CURIOUS, RUNNER, { pageVisits: { schedules: 9, workspaces: 9, marketplace: 9, team: 9 }, visits: 99, visited: ['#schedules', '#marketplace'] });
  const r = evaluate(visited, record(), NOW);
  assert.equal(r.level, 2);
  for (const id of ['scheduledRunDone', 'workspaceRunDone', 'addonInstalled', 'teamSetUp', 'parallelFeatures', 'councilDays']) {
    assert.equal(r.doneAt[id], undefined, id);
  }
});

test('facts drop -> level and doneAt unchanged (R-po-11)', () => {
  const full = facts(CURIOUS, RUNNER, ...SOLO_HOOKED, WORCAHOLIC, COUNCIL, { teamMetricsOn: true, teamPolicyOn: true });
  const first = evaluate(full, record(), NOW);
  assert.equal(first.level, 5);
  const dropped = evaluate(ZERO, { level: first.level, doneAt: first.doneAt, reachedAt: first.reachedAt }, LATER);
  assert.equal(dropped.level, 5);
  assert.deepEqual(dropped.doneAt, first.doneAt);
  assert.deepEqual(dropped.reachedAt, first.reachedAt);
});

test('team facts source throws -> not done, no error', () => {
  const f = facts(CURIOUS, RUNNER, ...SOLO_HOOKED);
  for (const key of ['teamMetricsOn', 'teamPolicyOn']) {
    Object.defineProperty(f, key, { enumerable: true, get() { throw new Error('offline'); } });
  }
  let r;
  assert.doesNotThrow(() => { r = evaluate(f, record(), NOW); });
  assert.equal(r.level, 3, 'an unreadable team is treated as not on a team');
  assert.equal(r.doneAt.teamSetUp, undefined);
  const g = facts(CURIOUS, RUNNER, ...SOLO_HOOKED, { teamMetricsOn: true });
  Object.defineProperty(g, 'teamPolicyOn', { enumerable: true, get() { throw new Error('offline'); } });
  const t = evaluate(g, record(), NOW).levels[3].find((v) => v.id === 'teamSetUp');
  assert.deepEqual([t.done, t.count, t.of], [false, 1, 2]);
});

test('an unknown pick choice shows Can\'t count yet only while not met (D-17)', () => {
  const r = evaluate(facts(CURIOUS, RUNNER, HOOKED, { prMergedUnknown: true }), record(), NOW);
  const choice = r.levels[3].find((v) => v.id === 'hookedPick').choices.find((c) => c.id === 'prMerged');
  assert.equal(choice.status, 'unknown');
  const met = evaluate(facts(CURIOUS, RUNNER, HOOKED, { prMergedUnknown: true, prsMerged: 1 }), record(), NOW);
  assert.equal(met.levels[3].find((v) => v.id === 'hookedPick').choices.find((c) => c.id === 'prMerged').status, 'done');
});

test('WorcaHolic needs the parallel pair, 5 merged PRs and any 2 choices; Council is then the top step', () => {
  const full = evaluate(facts(CURIOUS, RUNNER, HOOKED, WORCAHOLIC), record(), NOW);
  assert.equal(full.level, 4);
  assert.equal(full.doneAt.parallelFeatures, PARALLEL_AT);
  for (const drop of [{ parallelDoneAt: null }, { prsMerged: 4 }, { addonsAtOnce: 1, projects: 2 }]) {
    assert.equal(evaluate(facts(CURIOUS, RUNNER, HOOKED, WORCAHOLIC, drop), record(), NOW).level, 3, JSON.stringify(drop));
  }
  const council = evaluate(facts(CURIOUS, RUNNER, HOOKED, WORCAHOLIC, COUNCIL), record(), NOW);
  assert.equal(council.level, 5);
  assert.equal(council.top, true);
  assert.deepEqual([council.progress, council.next, council.nextLevel], [null, null, null]);
  assert.equal(council.doneAt.councilDays, DAYS_AT);
});

test('progress is in days when the next level is Council', () => {
  const r = evaluate(facts(CURIOUS, RUNNER, HOOKED, WORCAHOLIC, { activeDays: { inWindow: 12, metAt: null } }), record(), NOW);
  assert.equal(r.level, 4);
  assert.deepEqual(r.progress, { done: 12, total: 20, unit: 'days' });
  assert.deepEqual(r.nextLevel, { index: 5, key: 'council', name: "Worca's Council" });
  assert.equal(r.next[0].count, 12);
  const capped = evaluate(facts(CURIOUS, RUNNER, HOOKED, WORCAHOLIC, { activeDays: { inWindow: 25, metAt: null } }), record(), NOW);
  assert.equal(capped.level, 5);
});

test('sequential earning: a later level waits for the earlier ones', () => {
  const r = evaluate(facts(CURIOUS, WORCAHOLIC), record(), NOW);
  assert.equal(r.level, 1);
  assert.ok(r.doneAt.parallelFeatures);
});

test('unknown merged-PR and days facts are shown unknown and never met', () => {
  const r = evaluate(facts(CURIOUS, RUNNER, HOOKED, { prMergedUnknown: true, daysUnknown: true }), record(), NOW);
  const pick = r.levels[3].find((v) => v.id === 'hookedPick');
  assert.equal(pick.choices.find((c) => c.id === 'prMerged').status, 'unknown');
  assert.equal(r.levels[4].find((v) => v.id === 'prsMerged').status, 'unknown');
  assert.equal(r.levels[5][0].status, 'unknown');
});

test('latched stamps survive a facts drop (I-2)', () => {
  const stored = { level: 4, doneAt: { addonsAtOnce: NOW, parallelFeatures: PARALLEL_AT, setupFinished: NOW }, reachedAt: { 1: NOW, 4: RUNS_AT } };
  const r = evaluate(ZERO, stored, LATER);
  assert.equal(r.doneAt.addonsAtOnce, NOW);
  assert.equal(r.doneAt.parallelFeatures, PARALLEL_AT);
  assert.equal(r.level, 4);
  assert.equal(r.reachedAt[1], NOW);
  assert.equal(r.reachedAt[4], RUNS_AT);
});

test('reachedAt is the latest stamp among the level items, else now, and is never changed', () => {
  const first = evaluate(facts(CURIOUS, RUNNER), record(), NOW);
  assert.equal(first.level, 2);
  assert.deepEqual(first.reachedAt, { 1: NOW, 2: NOW });
  const second = evaluate(facts(CURIOUS, RUNNER, HOOKED, { addonsInstalled: 1 }), { ...record(first.level, first.doneAt), reachedAt: first.reachedAt }, LATER);
  assert.equal(second.level, 3);
  assert.equal(second.reachedAt[1], NOW);
  assert.equal(second.reachedAt[2], NOW);
  assert.equal(second.reachedAt[3], LATER, 'the latest of the Hooked item stamps (the PR and the pick were met at LATER)');
});

test('a stored level above the earned one is kept (I-1), and facts can raise it', () => {
  assert.equal(evaluate(ZERO, record(3), NOW).level, 3);
  assert.equal(evaluate(facts(CURIOUS, RUNNER), record(3), NOW).level, 3);
  assert.equal(evaluate(facts(CURIOUS, RUNNER, HOOKED, { addonsInstalled: 1 }), record(2), NOW).level, 3);
});

test('a repeat evaluation with the new record is stable', () => {
  const first = evaluate(facts(CURIOUS, RUNNER), record(), NOW);
  const second = evaluate(facts(CURIOUS, RUNNER), { level: first.level, doneAt: first.doneAt, reachedAt: first.reachedAt }, LATER);
  assert.equal(second.level, 2);
  assert.deepEqual(second.doneAt, first.doneAt);
  assert.deepEqual(second.reachedAt, first.reachedAt);
  assert.deepEqual(second.next, first.next);
});

test('evaluate mutates neither input (I-3)', () => {
  const rec = deepFreeze({ level: 1, doneAt: { setupFinished: NOW }, reachedAt: { 1: NOW } });
  const f = deepFreeze(facts(CURIOUS, RUNNER, HOOKED, WORCAHOLIC, COUNCIL));
  const r = evaluate(f, rec, LATER);
  assert.equal(r.level, 5);
  assert.notEqual(r.doneAt, rec.doneAt);
  assert.notEqual(r.reachedAt, rec.reachedAt);
  assert.deepEqual(rec, { level: 1, doneAt: { setupFinished: NOW }, reachedAt: { 1: NOW } });
});

test('a record with no doneAt is treated as empty, and missing facts never throw', () => {
  const r = evaluate(ZERO, { level: 2 }, NOW);
  assert.equal(r.level, 2);
  assert.deepEqual(r.doneAt, {});
  assert.doesNotThrow(() => evaluate({}, undefined, NOW));
  assert.equal(evaluate({}, undefined, NOW).level, 0);
});

test('every item and choice id in the ladder is met by the full facts', () => {
  const everything = facts(CURIOUS, RUNNER, HOOKED, WORCAHOLIC, COUNCIL, { teamMetricsOn: true, teamPolicyOn: true, prsMerged: 5, scheduledRunDone: true, workspaceRunDone: true, projects: 3, repeatingScheduleRunsMax: 3 });
  const { doneAt } = evaluate(everything, undefined, NOW);
  const ids = WORCA_LEVELS.flatMap((l) => l.items.flatMap((i) => (i.kind === 'pick' ? i.choices : [i]).map((x) => x.id)));
  assert.ok(ids.length > 0);
  for (const id of ids) assert.ok(doneAt[id], `${id} has a working condition`);
});

const viewOf = (f, rec = { level: 0, celebrated: 0, doneAt: {} }) => toView(rec, evaluate(f, rec, NOW), f);

test('view v2 at level 0: level is null, setup.missing says what is left, every ladder entry is next/later (R-po-25)', () => {
  const v = viewOf(facts({ setupFinished: true }));
  assert.equal(v.level, null);
  assert.deepEqual(v.setup, { finished: true, providerSignedIn: false, missing: ['provider'] });
  assert.deepEqual(v.ladder.map((l) => l.state), ['next', 'later', 'later', 'later', 'later']);
  assert.equal(v.celebration, null);
  assert.equal('welcome' in v, false);
  assert.deepEqual(viewOf(ZERO).setup.missing, ['setup', 'provider']);
  assert.deepEqual(viewOf(facts({ providerSignedIn: true })).setup.missing, ['setup']);
});

test('view v2 at level 1+: a level view, no missing, the Runner counters, items on every ladder entry', () => {
  const v = viewOf(facts(CURIOUS, { realRuns: 2, runnerSteps: { done: 4, of: 6 }, teamPolicyOn: true }), { level: 1, celebrated: 1, doneAt: {} });
  assert.equal(v.level.key, 'curious');
  assert.deepEqual(v.setup.missing, []);
  assert.deepEqual(v.runner, { realRuns: 2, of: 3, stepsDone: 4, stepsOf: 6 });
  assert.equal(v.onTeam, true);
  assert.deepEqual(v.ladder.map((l) => l.state), ['current', 'next', 'later', 'later', 'later']);
  assert.ok(v.ladder.every((l) => l.items.length > 0 && l.items.length <= 4));
  assert.equal(v.ladder[0].reachedAt, NOW);
  assert.equal(v.ladder[1].reachedAt, null);
  assert.deepEqual([v.count, v.summary, v.nudge, v.modeSuggestion], [5, null, null, null]);
  assert.equal(v.celebration, null, 'a record that has celebrated level 1 shows nothing');
  const fresh = viewOf(facts(CURIOUS), { level: 0, celebrated: 0, doneAt: {} });
  assert.equal(fresh.celebration.index, 1);
});

test('ladderState at level 0', () => {
  assert.deepEqual([1, 2, 3].map((i) => ladderState(i, 0)), ['next', 'later', 'later']);
});

test('modeSuggestionOf never steps down: a dismissed Expert is not followed by Advanced', () => {
  assert.equal(modeSuggestionOf({ modeSuggestion: { expert: 'dismissed' } }, 4), null);
  assert.equal(modeSuggestionOf({ modeSuggestion: { expert: 'accepted' } }, 4), 'advanced', 'an accepted Expert leaves Advanced answerable (the client hides it)');
  assert.equal(modeSuggestionOf({ modeSuggestion: {} }, 4), 'expert');
  assert.equal(modeSuggestionOf({ modeSuggestion: {} }, 3), 'advanced');
  assert.equal(modeSuggestionOf({ modeSuggestion: { advanced: 'accepted' } }, 4), 'expert');
});
