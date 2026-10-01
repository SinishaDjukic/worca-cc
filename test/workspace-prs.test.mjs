// test/workspace-prs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changedFileCount, workspaceMembers, memberPrTarget, rollupMemberPrs,
  relatedPrsBlock, withRelatedPrsBlock, RELATED_PRS_START,
} from '../src/core/workspace-prs.mjs';

const STATE = {
  target: 'workspace',
  projects: [
    { projectKey: 'api-00000001', projectDir: '/r/api', projectName: 'api' },
    { projectKey: 'web-00000002', projectDir: '/r/web', projectName: 'web' },
  ],
  branches: {
    'api-00000001': { source: 'main', feature: 'worca-cc/feat-api', worktreeDir: '/wt/api' },
    'web-00000002': { source: 'dev', feature: 'worca-cc/feat-web' },
  },
};

test('changedFileCount counts new + changed (deletes already live in filesChanged)', () => {
  assert.equal(changedFileCount({ filesNew: 1, filesChanged: 2, filesDeleted: 1 }), 3);
  assert.equal(changedFileCount(null), 0);
});

test('workspaceMembers joins projects x branches in projects order', () => {
  assert.deepEqual(workspaceMembers(STATE), [
    { memberKey: 'api-00000001', name: 'api', projectDir: '/r/api', feature: 'worca-cc/feat-api', source: 'main' },
    { memberKey: 'web-00000002', name: 'web', projectDir: '/r/web', feature: 'worca-cc/feat-web', source: 'dev' },
  ]);
  assert.deepEqual(workspaceMembers({}), []);
});

test('memberPrTarget requires a known memberKey', () => {
  assert.deepEqual(memberPrTarget(STATE, ''), { ok: false, error: 'memberKey is required for a workspace run' });
  assert.equal(memberPrTarget(STATE, 'nope-00000009').ok, false);
  assert.deepEqual(memberPrTarget(STATE, 'web-00000002'), { ok: true, target: {
    repoDir: '/r/web', feature: 'worca-cc/feat-web', source: 'dev', memberKey: 'web-00000002', memberName: 'web' } });
});

test('rollupMemberPrs: MERGED as soon as any member is merged, else OPEN; null when none', () => {
  assert.equal(rollupMemberPrs({}), null);
  assert.deepEqual(rollupMemberPrs({ b: { url: 'u2', number: 2, state: 'OPEN' }, a: { url: 'u1', number: 1, state: 'OPEN' } }),
    { url: 'u1', number: 1, state: 'OPEN' });
  assert.deepEqual(rollupMemberPrs({ a: { url: 'u1', number: 1, state: 'OPEN' }, b: { url: 'u2', number: 2, state: 'MERGED' } }),
    { url: 'u2', number: 2, state: 'MERGED' });
  assert.equal(rollupMemberPrs({ a: { url: 'u1', state: 'CLOSED' } }), null);
});

test('withRelatedPrsBlock appends once, replaces on rerun, keeps human text', () => {
  const block1 = relatedPrsBlock({ workspaceName: 'Team', siblings: [{ name: 'web', url: 'https://g/o/web/pull/2', state: 'OPEN' }] });
  const once = withRelatedPrsBlock('Title\n\n---\nStarted by ada via worca', block1);
  assert.ok(once.startsWith('Title\n\n---\nStarted by ada via worca\n\n' + RELATED_PRS_START));
  assert.equal(withRelatedPrsBlock(once, block1), once, 'idempotent');
  const block2 = relatedPrsBlock({ workspaceName: 'Team', siblings: [
    { name: 'web', url: 'https://g/o/web/pull/2', state: 'MERGED' }, { name: 'docs', url: 'https://g/o/docs/pull/9', state: 'OPEN' }] });
  const twice = withRelatedPrsBlock(once + '\n\nhuman note', block2);
  assert.equal(twice.split(RELATED_PRS_START).length, 2, 'exactly one block');
  assert.match(twice, /human note/);
  assert.match(twice, /- web: https:\/\/g\/o\/web\/pull\/2 \(merged\)/);
  assert.match(twice, /- docs: https:\/\/g\/o\/docs\/pull\/9/);
  assert.equal(withRelatedPrsBlock('', block1), block1);
});
