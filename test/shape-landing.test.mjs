// test/shape-landing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landingFor } from '../src/shared/shape/landing.mjs';

const RUN = { pipelineId: 'aaaa0002', title: 'Add a chart', label: 'Run 2', projectDir: '/p', finished: true,
  branch: { source: 'dev', feature: 'worca/charts-2' }, pr: { number: 41, url: 'https://x/pull/41', state: 'OPEN' }, rounds: 1 };
const S = (index, state, over = {}) => ({ index, state, pipelineId: `p${index}`, title: `Part ${index}`,
  branch: { source: index === 1 ? 'dev' : `worca/c-${index - 1}`, feature: `worca/c-${index}` }, pr: null, rounds: 1, ...over });
const FEAT = (slices, over = {}) => ({ id: 'feat-1', title: 'Charts', base: 'dev', slices, shipPr: null, ...over });

test('run done, PR open → round 2 on the same branch and the same PR', () => {
  const l = landingFor({ run: RUN });
  assert.equal(l.kind, 'round');
  assert.equal(l.title, 'Changes to Run 2 · same branch, same PR');
  assert.equal(l.start, 'Start round 2');
  assert.deepEqual(l.target, { roundOf: 'aaaa0002', round: 2, sourceBranch: 'worca/charts-2', pr: { number: 41, url: 'https://x/pull/41' } });
});

test('a round of a round counts on from the origin', () => {
  const l = landingFor({ run: { ...RUN, rounds: 2 } });
  assert.equal(l.start, 'Start round 3');
  assert.equal(l.target.round, 3);
});

test('a plain run still going → null (steer it with → run)', () => {
  assert.equal(landingFor({ run: { ...RUN, finished: false } }), null);
});

test('feature with runs to go → into the next run\'s plan', () => {
  const l = landingFor({ run: RUN, feature: FEAT([S(1, 'done'), S(2, 'running'), S(3, 'planned')]) });
  assert.equal(l.kind, 'next-plan');
  assert.equal(l.title, "Changes to Charts · into Run 3's plan");
  assert.equal(l.start, "Add to Run 3's plan");
  assert.deepEqual(l.target, { featureId: 'feat-1', index: 3 });
});

test('feature still running its last run → one more run after it', () => {
  const l = landingFor({ feature: FEAT([S(1, 'done'), S(2, 'running')]) });
  assert.equal(l.kind, 'extra-run');
  assert.equal(l.title, 'Changes to Charts · as Run 3 after Run 2');
  assert.equal(l.start, 'Add Run 3');
});

test('feature done, not shipped → a round on the last run\'s branch', () => {
  const pr = { number: 52, url: 'https://x/pull/52', state: 'OPEN' };
  const l = landingFor({ feature: FEAT([S(1, 'done'), S(2, 'done'), S(3, 'done', { pr })]) });
  assert.equal(l.kind, 'round');
  assert.equal(l.title, 'Changes to Run 3 · same branch, before Ship');
  assert.equal(l.target.sourceBranch, 'worca/c-3');
  assert.equal(l.target.roundOf, 'p3');
  assert.equal(l.target.pr.number, 52);
});

test('canceled runs are skipped: done + canceled rest → a round on the last done run', () => {
  const l = landingFor({ feature: FEAT([S(1, 'done'), S(2, 'done'), S(3, 'canceled')]) });
  assert.equal(l.kind, 'round');
  assert.equal(l.target.roundOf, 'p2');
});

test('a halted feature has no landing: resume or re-plan it first', () => {
  assert.equal(landingFor({ feature: FEAT([S(1, 'done'), S(2, 'stopped'), S(3, 'planned')]) }), null);
});

test('already merged → a follow-up run from dev, added to the same feature, own PR', () => {
  const merged = { number: 52, url: 'https://x/pull/52', state: 'MERGED' };
  const l = landingFor({ feature: FEAT([S(1, 'done'), S(2, 'done', { pr: merged })], { shipPr: merged }) });
  assert.equal(l.kind, 'follow-up');
  assert.equal(l.title, 'Follow-up to Charts · Run 3 from dev, own PR');
  assert.equal(l.start, 'Start Run 3');
  assert.deepEqual(l.target, { featureId: 'feat-1', sourceBranch: 'dev', index: 3 });
  assert.equal('roundOf' in l.target, false, 'a follow-up is a new member, not a round');
});

test('a plain run that is merged → a follow-up from its base, outside any group', () => {
  const l = landingFor({ run: { ...RUN, pr: { ...RUN.pr, state: 'MERGED' } } });
  assert.equal(l.kind, 'follow-up');
  assert.equal(l.title, 'Follow-up to Add a chart · from dev, own PR');
  assert.equal(l.start, 'Start follow-up');
  assert.deepEqual(l.target, { featureId: null, sourceBranch: 'dev', index: null });
});

test('no branch landed (a scan, a workspace run) → null', () => {
  assert.equal(landingFor({ run: { ...RUN, branch: { source: 'dev', feature: null } } }), null);
});
