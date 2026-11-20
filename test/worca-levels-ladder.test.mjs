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

const leavesOf = (i) => (i.kind === 'pick' ? i.choices : [i]);
const allItems = WORCA_LEVELS.flatMap((l) => l.items);
const allLeaves = allItems.flatMap(leavesOf);
const byId = Object.fromEntries([...allItems, ...allLeaves].map((a) => [a.id, a]));

describe('worca levels ladder', () => {
  it('has 5 levels in order with the agreed keys, names, tints and hues', () => {
    assert.equal(WORCA_LEVEL_COUNT, 5);
    assert.equal(WORCA_LEVELS.length, WORCA_LEVEL_COUNT);
    assert.deepEqual(WORCA_LEVELS.map((l) => l.index), [1, 2, 3, 4, 5]);
    assert.deepEqual(WORCA_LEVELS.map((l) => l.key), ['curious', 'runner', 'hooked', 'worcaholic', 'council']);
    assert.deepEqual(WORCA_LEVELS.map((l) => l.name), ['Curious', 'Runner', 'Hooked', 'WorcaHolic', "Worca's Council"]);
    assert.deepEqual(WORCA_LEVELS.map((l) => l.tint), ['blue', 'teal', 'purple', 'orange', 'green']);
    assert.deepEqual(WORCA_LEVELS.map((l) => l.hue), [235, 195, 295, 65, 150]);
  });

  it('carries the copy fields for every level, Curious included (no null recap)', () => {
    for (const l of WORCA_LEVELS) {
      for (const field of ['tagline', 'description', 'hat', 'phrase', 'recap']) {
        assert.equal(typeof l[field], 'string', `${l.key}.${field}`);
        assert.ok(l[field].length > 0, `${l.key}.${field}`);
      }
    }
    assert.deepEqual(WORCA_LEVELS.map((l) => l.hat), ['beanie', 'W headband', 'flat cap', 'black W cap', 'graduation cap']);
    assert.deepEqual(WORCA_LEVELS.map((l) => l.phrase), ['Curious', 'a Runner', 'Hooked', 'a WorcaHolic', "part of Worca's Council"]);
  });

  it('points each level at its avatar asset', () => {
    for (const l of WORCA_LEVELS) assert.equal(l.avatar, `/assets/worca-levels/${l.key}.svg`);
  });

  it('has no actions key anywhere', () => {
    for (const l of WORCA_LEVELS) assert.equal('actions' in l, false, l.key);
  });

  it('lists the agreed item ids per level, with the pick choices', () => {
    assert.deepEqual(WORCA_LEVELS.map((l) => l.items.map((i) => i.id)), [
      ['setupFinished', 'providerSignedIn'],
      ['runnerSteps', 'realRuns'],
      ['hookedRuns', 'prOpened', 'teamSetUp', 'hookedPick'],
      ['parallelFeatures', 'prsMerged', 'holicPick'],
      ['councilDays'],
    ]);
    assert.deepEqual(byId.hookedPick.choices.map((c) => c.id), ['scheduledRunDone', 'workspaceRunDone', 'addonInstalled', 'prMerged', 'twoProjects']);
    assert.deepEqual(byId.holicPick.choices.map((c) => c.id), ['repeatingScheduleRuns', 'addonsAtOnce', 'threeProjects']);
    assert.deepEqual([byId.hookedPick.need, byId.holicPick.need], [2, 2]);
    assert.equal(byId.teamSetUp.onlyFor, 'team');
  });

  it('every level has <=4 display items (R-po-14)', () => {
    for (const l of WORCA_LEVELS) assert.ok(l.items.length <= 4, l.key);
  });

  it('every item has the contract fields and every choice is a single item', () => {
    for (const i of allItems) {
      assert.ok(['single', 'pick'].includes(i.kind), i.id);
      for (const f of ['id', 'label', 'hint']) assert.equal(typeof i[f], 'string', `${i.id}.${f}`);
      assert.ok(i.href === null || typeof i.href === 'string', i.id);
      assert.ok((i.href === null) === (i.openLabel === null), `${i.id}: href and openLabel go together`);
      if (i.kind === 'pick') assert.ok(Array.isArray(i.choices) && i.choices.length > i.need, i.id);
    }
    for (const c of allItems.filter((i) => i.kind === 'pick').flatMap((i) => i.choices)) assert.equal(c.kind, 'single', c.id);
  });

  it('every item/choice has a condition', async () => {
    const { CONDITIONS } = await import('../src/core/worca-levels/conditions.mjs');
    for (const a of allLeaves) assert.equal(typeof CONDITIONS[a.id], 'function', a.id);
    const none = CONDITIONS.hookedRuns({});
    assert.equal(none.met, false);
    for (const a of allLeaves) assert.doesNotThrow(() => CONDITIONS[a.id]({}), a.id);
  });

  it('no non-team item links to #team-* (A-16)', () => {
    for (const a of [...allItems, ...allLeaves]) {
      if (a.onlyFor === 'team') continue;
      assert.doesNotMatch(a.href ?? '', /^#team-/, a.id);
    }
    assert.equal(byId.teamSetUp.href, '#team-policy');
  });

  it('exposes the thresholds', () => {
    assert.deepEqual({ ...WORCA_THRESHOLDS }, {
      runnerSteps: 6, runnerRealRuns: 3, hookedRuns: 10, hookedDays: 3, hookedPick: 2, hookedProjects: 2, prsOpened: 1,
      parallelFeatures: 2, holicMergedPrs: 5, holicPick: 2, repeatingScheduleRuns: 3, addonsAtOnce: 2, holicProjects: 3,
      councilDays: 20, councilWindow: 30, nudgeAt: 0.75,
    });
    assert.equal(byId.hookedRuns.label, '10 real runs on 3 days');
    assert.equal(byId.realRuns.label, '3 real runs');
    assert.equal(byId.prsMerged.label, '5 merged pull requests');
    assert.equal(byId.councilDays.label, 'Any 20 active days in the last 30');
    assert.equal(byId.parallelFeatures.label, 'Run 2 features at the same time');
    assert.equal(byId.repeatingScheduleRuns.label, 'A repeating schedule with 3 finished runs');
    assert.equal(byId.threeProjects.label, 'Real runs on 3 or more projects');
    assert.equal(byId.parallelFeatures.threshold, 2);
    assert.deepEqual(byId.councilDays.unit, ['active day', 'active days']);
  });

  it('every href resolves to a VIEW_NAMES view', () => {
    assert.ok(viewNames.length > 0);
    for (const a of allLeaves.filter((x) => x.href)) {
      assert.match(a.href, /^#[a-z-]+$/, a.id);
      assert.ok(viewNames.includes(a.href.slice(1)), `${a.id}: ${a.href}`);
    }
  });

  it('is deeply frozen', () => {
    assert.ok(Object.isFrozen(WORCA_LEVELS));
    assert.ok(Object.isFrozen(WORCA_THRESHOLDS));
    for (const l of WORCA_LEVELS) {
      assert.ok(Object.isFrozen(l), l.key);
      assert.ok(Object.isFrozen(l.items), l.key);
      for (const a of l.items) {
        assert.ok(Object.isFrozen(a), a.id);
        if (a.choices) {
          assert.ok(Object.isFrozen(a.choices), a.id);
          for (const c of a.choices) assert.ok(Object.isFrozen(c), c.id);
        }
      }
    }
  });
});
