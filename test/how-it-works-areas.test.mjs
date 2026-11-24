// test/how-it-works-areas.test.mjs
// The shared "How it works" area registry and the seen rule used by the
// server (validation) and the UI (marks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_AREA_IDS, isGuideAreaId, isGuideSeen } from '../src/shared/how-it-works/areas.mjs';

const IDS = [
  'chat', 'design', 'runs', 'new', 'schedules', 'stats', 'team-metrics', 'workflows',
  'requirements', 'marketplace', 'connectors', 'models', 'projects',
  'workspaces', 'team-policy', 'settings',
];

test('GUIDE_AREA_IDS is the exact frozen list of 17 ids, in order', () => {
  assert.deepEqual([...GUIDE_AREA_IDS], IDS);
  assert.equal(Object.isFrozen(GUIDE_AREA_IDS), true);
});

test('isGuideAreaId accepts only listed ids', () => {
  for (const id of IDS) assert.equal(isGuideAreaId(id), true, id);
  for (const bad of ['getting-started', 'profile', 'workspace-create', 'running', '', null, 42]) {
    assert.equal(isGuideAreaId(bad), false, String(bad));
  }
});

test('isGuideSeen reads guidesSeen and is null when prefs are unknown', () => {
  assert.equal(isGuideSeen(null, 'runs'), null);
  assert.equal(isGuideSeen(undefined, 'runs'), null);
  assert.equal(isGuideSeen({}, 'runs'), false);
  assert.equal(isGuideSeen({ guidesSeen: { runs: true } }, 'runs'), true);
  assert.equal(isGuideSeen({ guidesSeen: { runs: false } }, 'runs'), false);
  assert.equal(isGuideSeen({ workspaceGuideSeen: true }, 'runs'), false);
});

test('workspaces is seen by guidesSeen.workspaces OR the legacy workspaceGuideSeen', () => {
  assert.equal(isGuideSeen({ workspaceGuideSeen: true }, 'workspaces'), true);
  assert.equal(isGuideSeen({ guidesSeen: { workspaces: true } }, 'workspaces'), true);
  assert.equal(isGuideSeen({}, 'workspaces'), false);
});

test('isGuideSeen throws on an unknown area id', () => {
  assert.throws(() => isGuideSeen({}, 'nope'), /unknown how-it-works area/);
  assert.throws(() => isGuideSeen(null, 'nope'), /unknown how-it-works area "nope"/);
});
