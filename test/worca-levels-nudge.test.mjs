// test/worca-levels-nudge.test.mjs
// src/core/worca-levels/nudge.mjs — pickNudge(evaluation, record): the one "almost there" toast, once per item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/core/worca-levels/evaluate.mjs';
import { pickNudge, nudgeText } from '../src/core/worca-levels/nudge.mjs';
import { toView } from '../src/core/worca-levels/view.mjs';
import { checkRows } from './helpers/rows.mjs';

const NOW = '2026-11-05T10:00:00.000Z';

const ZERO = {
  setupFinished: false, providerSignedIn: false, runnerSteps: { done: 0, of: 6 }, teamMetricsOn: false, teamPolicyOn: false,
  realRuns: 0, runsOnDays: { metAt: null, runs: 0, days: 0 }, activeDays: { inWindow: 0, metAt: null }, prsOpened: 0,
  prsMerged: 0, prMergedUnknown: false, daysUnknown: false, scheduledRunDone: false, workspaceRunDone: false, projects: 0,
  repeatingScheduleRunsMax: 0, addonsInstalled: 0, addonsAtOnce: 0, parallelDoneAt: null,
};
const CURIOUS = { setupFinished: true, providerSignedIn: true };
const RUNNER = { runnerSteps: { done: 6, of: 6 }, realRuns: 3 };
const HOOKED = { runsOnDays: { metAt: NOW, runs: 10, days: 3 }, prsOpened: 1, addonsInstalled: 1, scheduledRunDone: true };

const facts = (...parts) => ({ ...ZERO, ...Object.assign({}, ...parts) });
const evaluation = (f, level = 0) => evaluate(f, { level, doneAt: {} }, NOW);
const record = (nudged = {}) => ({ nudged });

test('pickNudge: what is offered and what is not', async () => {
  await checkRows([
    { name: '4/5 merged PRs -> "1 more merged PR to WorcaHolic"', run: () => {
      const ev = evaluation(facts(CURIOUS, RUNNER, HOOKED, { prsMerged: 4 }));
      assert.equal(ev.level, 3);
      assert.deepEqual(pickNudge(ev, record()), { id: 'prsMerged', text: '1 more merged PR to WorcaHolic' });
    } },
    { name: '3/5 merged PRs (60%) -> none', run: () => {
      assert.equal(pickNudge(evaluation(facts(CURIOUS, RUNNER, HOOKED, { prsMerged: 3 })), record()), null);
    } },
    { name: 'just under 75% -> none', run: () => {
      // 14/20 active days is 70%; level 4 is held with nothing else close.
      const f = facts(CURIOUS, RUNNER, HOOKED, { parallelDoneAt: NOW, prsMerged: 5, addonsAtOnce: 2, projects: 3, activeDays: { inWindow: 14, metAt: null } });
      assert.equal(pickNudge(evaluation(f), record()), null);
    } },
    { name: 'already nudged -> none (R-po-16)', run: () => {
      const ev = evaluation(facts(CURIOUS, RUNNER, HOOKED, { prsMerged: 4 }));
      assert.equal(pickNudge(ev, record({ prsMerged: NOW })), null);
    } },
    { name: 'below Runner -> none', run: () => {
      const ev = evaluation(facts(CURIOUS, { runnerSteps: { done: 5, of: 6 }, realRuns: 2 }));
      assert.equal(ev.level, 1);
      assert.equal(pickNudge(ev, record()), null);
    } },
    { name: 'both parts short -> "3 more real runs on 1 more day to Hooked"', run: () => {
      const view = { id: 'hookedRuns', parts: [{ count: 7, of: 10 }, { count: 2, of: 3 }] };
      assert.equal(nudgeText(view, 'Hooked'), '3 more real runs on 1 more day to Hooked');
    } },
    { name: 'one part short -> only that part is named', run: () => {
      const ev = evaluation(facts(CURIOUS, RUNNER, { runsOnDays: { metAt: null, runs: 8, days: 3 } }));
      assert.deepEqual(pickNudge(ev, record()), { id: 'hookedRuns', text: '2 more real runs to Hooked' });
    } },
    { name: 'the parts are judged by the weakest: 2 of 3 days is not close enough', run: () => {
      const ev = evaluation(facts(CURIOUS, RUNNER, { runsOnDays: { metAt: null, runs: 10, days: 2 } }));
      assert.equal(pickNudge(ev, record()), null);
    } },
    { name: 'the first candidate in ladder order wins; a nudged one is skipped', run: () => {
      const f = facts(CURIOUS, RUNNER, { runsOnDays: { metAt: null, runs: 8, days: 3 }, prsOpened: 0 });
      const ev = evaluation(f);
      assert.equal(pickNudge(ev, record()).id, 'hookedRuns');
      assert.equal(pickNudge(ev, record({ hookedRuns: NOW })), null);
    } },
    { name: 'an unknown counted item is not offered', run: () => {
      const f = facts(CURIOUS, RUNNER, HOOKED, { prsMerged: 4, prMergedUnknown: true });
      assert.equal(pickNudge(evaluation(f), record()), null);
      const ev = evaluation(facts(CURIOUS, RUNNER, { runsOnDays: { metAt: null, runs: 9, days: 3 }, daysUnknown: true }));
      assert.equal(pickNudge(ev, record()), null);
    } },
    { name: 'the top level has no next level -> none', run: () => {
      const f = facts(CURIOUS, RUNNER, HOOKED, { parallelDoneAt: NOW, prsMerged: 5, addonsAtOnce: 2, projects: 3, activeDays: { inWindow: 20, metAt: NOW } });
      assert.equal(pickNudge(evaluation(f), record()), null);
    } },
    { name: 'no evaluation or record -> none', run: () => {
      assert.equal(pickNudge(null, record()), null);
      const ev = evaluation(facts(CURIOUS, RUNNER, HOOKED, { prsMerged: 4 }));
      assert.deepEqual(pickNudge(ev, null), { id: 'prsMerged', text: '1 more merged PR to WorcaHolic' });
    } },
    { name: 'the view carries the nudge, and null once nudged', run: () => {
      const f = facts(CURIOUS, RUNNER, HOOKED, { prsMerged: 4 });
      const rec = { level: 3, celebrated: 3, doneAt: {}, summary: null, nudged: {} };
      assert.deepEqual(toView(rec, evaluation(f, 3), f).nudge, { id: 'prsMerged', text: '1 more merged PR to WorcaHolic' });
      assert.equal(toView({ ...rec, nudged: { prsMerged: NOW } }, evaluation(f, 3), f).nudge, null);
    } },
  ]);
});

test('nudgeNotice: the toast a view offers', async () => {
  const { nudgeNotice } = await import('../ui/public/worca-level/notices.mjs');
  assert.deepEqual(nudgeNotice({ nudge: { id: 'prsMerged', text: '1 more merged PR to WorcaHolic' } }), { id: 'prsMerged', title: '1 more merged PR to WorcaHolic' });
  for (const view of [null, {}, { nudge: null }, { nudge: { id: '', text: 'x' } }, { nudge: { id: 'a' } }]) {
    assert.equal(nudgeNotice(view), null, JSON.stringify(view));
  }
});
