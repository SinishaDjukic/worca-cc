import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  WORCA_LEVEL_COUNT,
  WORCA_LEVELS,
  WORCA_THRESHOLDS,
} from '../src/shared/worca-levels.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(join(root, 'ui/public/app.js'), 'utf8');
const viewNames = [
  ...appSrc
    .match(/const VIEW_NAMES = \[([^\]]*)\]/)[1]
    .matchAll(/'([^']+)'/g),
].map((m) => m[1]);

const allActions = WORCA_LEVELS.flatMap((l) => l.actions);
const byId = Object.fromEntries(allActions.map((a) => [a.id, a]));

describe('worca levels ladder', () => {
  it('has 5 levels in order with the agreed keys, names, tints and hues', () => {
    assert.equal(WORCA_LEVEL_COUNT, 5);
    assert.equal(WORCA_LEVELS.length, WORCA_LEVEL_COUNT);
    assert.deepEqual(
      WORCA_LEVELS.map((l) => l.index),
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(
      WORCA_LEVELS.map((l) => l.key),
      ['curious', 'runner', 'hooked', 'worcaholic', 'council'],
    );
    assert.deepEqual(
      WORCA_LEVELS.map((l) => l.name),
      ['Curious', 'Runner', 'Hooked', 'WorcaHolic', "Worca's Council"],
    );
    assert.deepEqual(
      WORCA_LEVELS.map((l) => l.tint),
      ['blue', 'teal', 'purple', 'orange', 'green'],
    );
    assert.deepEqual(
      WORCA_LEVELS.map((l) => l.hue),
      [235, 195, 295, 65, 150],
    );
  });

  it('carries the copy fields for every level', () => {
    assert.deepEqual(
      WORCA_LEVELS.map((l) => l.tagline),
      [
        'new to orchestration',
        'runs a pipeline end to end',
        'extends the pipeline',
        'runs the whole pod',
        'council member',
      ],
    );
    assert.deepEqual(
      WORCA_LEVELS.map((l) => l.hat),
      ['beanie', 'W headband', 'flat cap', 'black W cap', 'graduation cap'],
    );
    assert.deepEqual(
      WORCA_LEVELS.map((l) => l.phrase),
      [
        'Curious',
        'a Runner',
        'Hooked',
        'a WorcaHolic',
        "part of Worca's Council",
      ],
    );
    assert.deepEqual(
      WORCA_LEVELS.map((l) => l.recap),
      [
        null,
        'finished Getting started, wrote a requirement and ran a feature to the end',
        'added an add-on, set up a space and a schedule, and opened Statistics',
        'ran 2 features at once, added 2 add-ons, set up a repeating schedule and saw 10 runs in Team metrics',
        'finished 2 or more workflows a day for 30 days in a row',
      ],
    );
    assert.deepEqual(
      WORCA_LEVELS.map((l) => l.description),
      [
        'New to orchestration. Everyone begins here, exploring a single agent pipeline.',
        'Orchestrates one pipeline: Getting started, a first requirement, a feature run to the end.',
        'Extends orchestration: an add-on, a space, a schedule, Statistics.',
        'Orchestrates the whole pod: parallel features, several add-ons, repeating schedules, Team metrics.',
        'Finishes 2 or more workflows a day, 30 days in a row.',
      ],
    );
  });

  it('points each level at its avatar asset', () => {
    for (const l of WORCA_LEVELS) {
      assert.equal(l.avatar, `/assets/worca-levels/${l.key}.svg`);
    }
  });

  it('lists the agreed action ids per level', () => {
    assert.deepEqual(
      WORCA_LEVELS.map((l) => l.actions.map((a) => a.id)),
      [
        [],
        ['gettingStarted', 'firstRequirement', 'firstFeatureDone'],
        ['addonInstalled', 'spaceSetUp', 'scheduleCreated', 'statsViewed'],
        ['parallelFeatures', 'addonsAtOnce', 'repeatingSchedule', 'teamMetrics'],
        ['councilStreak'],
      ],
    );
  });

  it('keeps the static label, hint, href and openLabel of every action', () => {
    const view = (a) => [a.label, a.hint, a.href, a.openLabel];
    assert.deepEqual(view(byId.gettingStarted), [
      'Finish Getting started',
      'Nine short steps. Starts with connecting Claude Code.',
      '#getting-started',
      'Open Getting started',
    ]);
    assert.deepEqual(view(byId.firstRequirement), [
      'Write your first requirement',
      'Opens Requirements.',
      '#requirements',
      'Open Requirements',
    ]);
    assert.deepEqual(view(byId.firstFeatureDone), [
      'Run a feature to the end',
      'Start a requirement and let it finish.',
      '#requirements',
      'Open Requirements',
    ]);
    assert.deepEqual(view(byId.addonInstalled), [
      'Install an add-on from the Marketplace',
      'Marketplace, under Add-ons.',
      '#marketplace',
      'Open Marketplace',
    ]);
    assert.deepEqual(view(byId.spaceSetUp), [
      'Set up and organise a space',
      'Workspaces, under Manage.',
      '#workspaces',
      'Open Workspaces',
    ]);
    assert.deepEqual(view(byId.scheduleCreated), [
      'Set up a schedule',
      'Schedules. Not in your sidebar in Simple mode; the button opens it.',
      '#schedules',
      'Open Schedules',
    ]);
    assert.deepEqual(view(byId.statsViewed), [
      'Look at Statistics',
      'Statistics shows how your builds are going.',
      '#stats',
      'Open Statistics',
    ]);
    assert.deepEqual(view(byId.parallelFeatures), [
      'Run 2 features at the same time',
      'Both have to finish successfully.',
      '#new',
      'Open New pipeline',
    ]);
    assert.deepEqual(view(byId.addonsAtOnce), [
      'Add 2 or more add-ons',
      'Have 2 or more installed at the same time.',
      '#marketplace',
      'Open Marketplace',
    ]);
    assert.deepEqual(view(byId.repeatingSchedule), [
      'Set up a repeating schedule',
      'Schedules. Not in your sidebar in Simple mode; the button opens it.',
      '#schedules',
      'Open Schedules',
    ]);
    assert.deepEqual(view(byId.teamMetrics), [
      'See 10 of your runs in Team metrics',
      'Install Team policy (you or anyone on your team), get 10 of your finished runs into Team metrics, then open Team metrics. Part of Expert mode; the button opens it.',
      '#team-metrics',
      'Open Team metrics',
    ]);
    assert.deepEqual(view(byId.councilStreak), [
      'Finish 2 workflows a day, 30 days in a row',
      'Weekends count too. A day with fewer than 2 finished successfully starts the count again.',
      '#new',
      'Open New pipeline',
    ]);
  });

  it('exposes the thresholds and ties action thresholds to them', () => {
    assert.deepEqual(
      { ...WORCA_THRESHOLDS },
      {
        parallelFeatures: 2,
        addonsAtOnce: 2,
        teamMetricsRuns: 10,
        councilDays: 30,
        councilDailyRuns: 2,
      },
    );
    assert.equal(byId.parallelFeatures.threshold, 2);
    assert.equal(byId.addonsAtOnce.threshold, 2);
    assert.equal(byId.teamMetrics.threshold, 10);
    assert.equal(byId.councilStreak.threshold, 30);
    for (const id of [
      'gettingStarted',
      'firstRequirement',
      'firstFeatureDone',
      'addonInstalled',
      'spaceSetUp',
      'scheduleCreated',
      'statsViewed',
      'repeatingSchedule',
    ]) {
      assert.equal(byId[id].threshold, undefined, id);
    }
  });

  it('every href resolves to a VIEW_NAMES view', () => {
    assert.ok(viewNames.length > 0);
    for (const a of allActions) {
      assert.match(a.href, /^#[a-z-]+$/, a.id);
      assert.ok(viewNames.includes(a.href.slice(1)), `${a.id}: ${a.href}`);
    }
  });

  it('is deeply frozen', () => {
    assert.ok(Object.isFrozen(WORCA_LEVELS));
    assert.ok(Object.isFrozen(WORCA_THRESHOLDS));
    for (const l of WORCA_LEVELS) {
      assert.ok(Object.isFrozen(l), l.key);
      assert.ok(Object.isFrozen(l.actions), l.key);
      for (const a of l.actions) assert.ok(Object.isFrozen(a), a.id);
    }
  });
});
