// test/deployment.test.mjs
// src/core/deployment.mjs: local / container / hosted, and the GitHub mode Ask Worca is told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDeployment, githubMode, deploymentFacts } from '../src/core/deployment.mjs';

test('detectDeployment: hosted wins, then the image or a data dir, else local', () => {
  assert.equal(detectDeployment({}), 'local');
  assert.equal(detectDeployment({ WORCA_NO_NATIVE_DIALOG: '1' }), 'local', 'a local install may set this too');
  assert.equal(detectDeployment({ WORCA_CONTAINER: '1' }), 'container');
  assert.equal(detectDeployment({ WORCA_CONTAINER: '0' }), 'local');
  assert.equal(detectDeployment({ WORCA_DATA_DIR: '/data' }), 'container');
  assert.equal(detectDeployment({ WORCA_CONTAINER: '1' }, { remoteMode: true }), 'hosted');
  assert.equal(detectDeployment({}, { remoteMode: true }), 'hosted');
});

test('githubMode names the mode, never the token', () => {
  assert.equal(githubMode({}), 'none');
  assert.equal(githubMode({ GH_TOKEN: '  ' }), 'none');
  assert.equal(githubMode({ GH_TOKEN: 'ghp_secret' }), 'single');
  assert.equal(githubMode({ GITHUB_TOKEN: 'ghp_secret' }), 'single');
});

test('deploymentFacts: null locally; the three facts otherwise, with no secret in them', () => {
  assert.equal(deploymentFacts({}, { projectsRoot: '/p' }), null);
  const f = deploymentFacts({ WORCA_CONTAINER: '1', GH_TOKEN: 'ghp_secret' }, { remoteMode: true, projectsRoot: '/data/projects' });
  assert.deepEqual(f, { deployment: 'hosted', projectsRoot: '/data/projects', github: 'single', actions: 'off', terminal: 'off' });
  assert.ok(!JSON.stringify(f).includes('ghp_secret'));
  // Actions: off on a hosted worca unless the operator opted in; never named elsewhere.
  assert.equal(deploymentFacts({ WORCA_ACTIONS_REMOTE: '1' }, { remoteMode: true }).actions, undefined);
  assert.equal(deploymentFacts({ WORCA_CONTAINER: '1' }).actions, undefined);
  assert.equal(deploymentFacts({ WORCA_TERMINAL_REMOTE: '1' }, { remoteMode: true }).terminal, undefined);
  assert.equal(deploymentFacts({ WORCA_CONTAINER: '1' }).terminal, undefined);
});

test('deploymentFacts: azureDevOps names the Azure DevOps mode, and is absent without one', () => {
  const f = deploymentFacts({ WORCA_CONTAINER: '1', GH_TOKEN: 'ghp_secret', WORCA_ADO_TOKEN: 'x' }, { remoteMode: true, projectsRoot: '/data/projects' });
  assert.equal(f.azureDevOps, 'single');
  assert.deepEqual(Object.keys(f), ['deployment', 'projectsRoot', 'github', 'azureDevOps', 'actions', 'terminal']);
  assert.equal(deploymentFacts({ WORCA_CONTAINER: '1', WORCA_ADO_READ_TOKEN: 'r', WORCA_ADO_WRITE_TOKEN: 'w' }).azureDevOps, 'split');
  assert.ok(!JSON.stringify(deploymentFacts({ WORCA_CONTAINER: '1', WORCA_ADO_TOKEN: 'ado_secret' })).includes('ado_secret'));
  assert.equal('azureDevOps' in deploymentFacts({ WORCA_CONTAINER: '1', GH_TOKEN: 'ghp_secret' }, { remoteMode: true }), false);
});
