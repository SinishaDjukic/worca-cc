// test/server-workspace-source-branches.test.mjs — unit tests for the per-project
// source-branch mapping/validation helpers used by the workspace /api/run arm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceMembers, firstInjectionSource } from '../ui/server.mjs';

const PROJECTS = [
  { projectDir: '/a/svc-iam', projectKey: 'svc-iam-aaaa1111', projectName: 'svc-iam' },
  { projectDir: '/a/svc-ui', projectKey: 'svc-ui-bbbb2222', projectName: 'svc-ui' },
];

test('buildWorkspaceMembers: per-project override wins, others fall back to shared source', () => {
  const branch = { source: 'main', feature: 'add-x' };
  const members = buildWorkspaceMembers(PROJECTS, branch, { 'svc-iam-aaaa1111': 'develop' });
  // overridden member
  assert.deepEqual(members[0].branch, { source: 'develop', feature: 'add-x' });
  // un-overridden member falls back to the shared default source
  assert.deepEqual(members[1].branch, { source: 'main', feature: 'add-x' });
  // original descriptor fields are preserved
  assert.equal(members[0].projectDir, '/a/svc-iam');
  assert.equal(members[1].projectName, 'svc-ui');
});

test('buildWorkspaceMembers: blank/whitespace override → shared default (null stays null)', () => {
  const members = buildWorkspaceMembers(PROJECTS, { source: null, feature: null }, { 'svc-iam-aaaa1111': '   ' });
  assert.equal(members[0].branch.source, null);
  assert.equal(members[1].branch.source, null);
  assert.equal(members[0].branch.feature, null);
});

test('buildWorkspaceMembers: feature branch is always the shared value for every member', () => {
  const members = buildWorkspaceMembers(PROJECTS, { source: 'main', feature: 'shared-feat' },
    { 'svc-iam-aaaa1111': 'develop', 'svc-ui-bbbb2222': 'release' });
  assert.equal(members[0].branch.feature, 'shared-feat');
  assert.equal(members[1].branch.feature, 'shared-feat');
});

test('buildWorkspaceMembers: tolerates a non-object / missing map (returns shared source for all)', () => {
  const branch = { source: 'main', feature: null };
  assert.equal(buildWorkspaceMembers(PROJECTS, branch, undefined)[0].branch.source, 'main');
  assert.equal(buildWorkspaceMembers(PROJECTS, branch, null)[1].branch.source, 'main');
});

test('firstInjectionSource: flags a leading-dash value (option injection), else null', () => {
  assert.equal(firstInjectionSource({ k1: 'main', k2: '--upload-pack=x' }), '--upload-pack=x');
  assert.equal(firstInjectionSource({ k1: 'main', k2: 'develop' }), null);
  assert.equal(firstInjectionSource({}), null);
  assert.equal(firstInjectionSource(undefined), null);
});
