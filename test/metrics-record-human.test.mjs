// `human` on RunRecord v1 (money-saved design §7): an optional TRAILING key, present only when
// the run earned hours; byPhase mirrors cost.byPhase; policy-less and human-less records keep
// their exact key list.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunRecord, RECORD_FIELDS } from '../src/core/metrics/record.mjs';
import { NOW, projectDone } from './fixtures/team-metrics/snapshots.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

test('hours and byPhase from the steps; key order = RECORD_FIELDS + human', () => {
  // fixture steps: preflight, plan:1, impl:1, rev:1, impl:2, rev:2, done (7)
  const steps = projectDone.steps.map((s, i) => ({ ...s, humanHours: [null, 2.25, 43.05, 11.5, 3.2, 3.9, null][i] }));
  const rec = buildRunRecord({ ...projectDone, steps, humanHours: 56.8 }, { now: new Date(NOW) });
  assert.deepEqual(Object.keys(rec), [...RECORD_FIELDS, 'human']);
  assert.equal(rec.human.hours, 56.8);
  assert.deepEqual(rec.human.byPhase, { plan: 2.25, implement: 46.25, review: 15.4 });
});

test('absent when the run earned nothing', () => {
  const rec = buildRunRecord({ ...projectDone, humanHours: 0 }, { now: new Date(NOW) });
  assert.equal('human' in rec, false);
  assert.deepEqual(Object.keys(rec), RECORD_FIELDS);
});

test('human follows policy when both are present', () => {
  const rec = buildRunRecord({ ...projectDone, humanHours: 1.5, policy: { home: 'acme/policy', sha: 'abcdef1', overrides: [], exceeded: [], deviations: [], unattended: false, reason: null } }, { now: new Date(NOW) });
  assert.deepEqual(Object.keys(rec).slice(-2), ['policy', 'human']);
});
