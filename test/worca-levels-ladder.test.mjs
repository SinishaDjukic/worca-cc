import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { WORCA_LEVELS, WORCA_THRESHOLDS } from '../src/shared/worca-levels.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(join(root, 'ui/public/app.js'), 'utf8');
const viewNames = [
  ...appSrc
    .match(/const VIEW_NAMES = \[([^\]]*)\]/)[1]
    .matchAll(/'([^']+)'/g),
].map((m) => m[1]);

const SIMPLE_HIDDEN = {
  '#schedules': /schedules/i,
  '#stats': /stats/i,
  '#marketplace': /marketplace/i,
  '#workspaces': /workspaces?/i,
};

const allActions = WORCA_LEVELS.flatMap((l) => l.actions);

describe('worca levels ladder (I-1)', () => {
  it('has 4 levels in order with the agreed keys and avatars', () => {
    assert.deepEqual(
      WORCA_LEVELS.map((l) => l.index),
      [1, 2, 3, 4],
    );
    assert.deepEqual(
      WORCA_LEVELS.map((l) => l.key),
      ['calf', 'swimmer', 'hunter', 'pod-leader'],
    );
    assert.deepEqual(
      WORCA_LEVELS.map((l) => l.name),
      ['Calf', 'Swimmer', 'Hunter', 'Pod Leader'],
    );
    for (const l of WORCA_LEVELS) {
      assert.equal(l.avatar, `/assets/worca-levels/${l.key}.svg`);
      assert.ok(l.description.length > 0);
    }
  });

  it('never reuses a mode or theme name', () => {
    const banned = ['simple', 'advanced', 'expert', 'light', 'dark'];
    for (const l of WORCA_LEVELS) {
      assert.ok(!banned.includes(l.name.toLowerCase()), l.name);
    }
  });

  it('gives Calf no actions and every other level 3-5', () => {
    assert.equal(WORCA_LEVELS[0].actions.length, 0);
    for (const l of WORCA_LEVELS.slice(1)) {
      assert.ok(l.actions.length >= 3 && l.actions.length <= 5, l.key);
    }
    assert.deepEqual(
      WORCA_LEVELS.map((l) => l.actions.map((a) => a.id)),
      [
        [],
        ['gettingStarted', 'firstRequirement', 'firstFeatureDone'],
        ['addonInstalled', 'spaceSetUp', 'scheduleCreated', 'statsViewed'],
        ['parallelFeatures', 'addonsInUse', 'scheduledRuns', 'metricsRegular'],
      ],
    );
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

  it('exposes the thresholds and ties action thresholds to them', () => {
    assert.deepEqual(
      { ...WORCA_THRESHOLDS },
      { parallelFeatures: 2, addonsInUse: 2, scheduledRuns: 5, metricsDays: 3 },
    );
    const byId = Object.fromEntries(allActions.map((a) => [a.id, a]));
    assert.equal(byId.parallelFeatures.threshold, 2);
    assert.equal(byId.addonsInUse.threshold, 2);
    assert.equal(byId.scheduledRuns.threshold, 5);
    assert.equal(byId.metricsRegular.threshold, 3);
    for (const id of [
      'gettingStarted',
      'firstRequirement',
      'firstFeatureDone',
      'addonInstalled',
      'spaceSetUp',
      'scheduleCreated',
      'statsViewed',
    ]) {
      assert.equal(byId[id].threshold, null, id);
    }
  });
});

describe('worca levels ladder (I-9)', () => {
  it('maps each action to the agreed hash link', () => {
    const hrefs = Object.fromEntries(allActions.map((a) => [a.id, a.href]));
    assert.deepEqual(hrefs, {
      gettingStarted: '#getting-started',
      firstRequirement: '#requirements',
      firstFeatureDone: '#requirements',
      addonInstalled: '#marketplace',
      spaceSetUp: '#workspaces',
      scheduleCreated: '#schedules',
      statsViewed: '#stats',
      parallelFeatures: '#runs',
      addonsInUse: '#marketplace',
      scheduledRuns: '#schedules',
      metricsRegular: '#stats',
    });
  });

  it('every href resolves to a VIEW_NAMES view', () => {
    assert.ok(viewNames.length > 0);
    for (const a of allActions) {
      assert.match(a.href, /^#[a-z-]+$/, a.id);
      assert.ok(viewNames.includes(a.href.slice(1)), `${a.id}: ${a.href}`);
    }
  });

  it('has id, label, hint on every action and no role gate', () => {
    for (const a of allActions) {
      assert.ok(a.id && a.label && a.hint, a.id);
      assert.deepEqual(Object.keys(a).sort(), [
        'hint',
        'href',
        'id',
        'label',
        'threshold',
      ]);
    }
  });

  it('names the place in the hint for Simple-hidden targets', () => {
    for (const a of allActions) {
      const place = SIMPLE_HIDDEN[a.href];
      if (place) assert.match(a.hint, place, a.id);
    }
  });
});
