// test/workspace-channel.test.mjs
// The run harness's workspace channel — the value every node ctx carries as ctx.workspace — names
// the workspace and each member's LIVE project dir beside its checkout (wsmap P2). The script
// envelope's ctx.workspace (script-runner.mjs workspaceEnvelope) is built from it, in both run-root
// modes, so a map script can tell the checkout it scans from the project it belongs to.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';

useTempHome(after);

const self = () => ({
  workspace: { id: 'wks-shop-1234abcd', name: 'Shop' },
  workspaceKey: 'wks-shop-1234abcd',
  workspaceDescription: '# Workspace: Shop\n',
  members: [
    { projectKey: 'api-1111', projectName: 'api', projectDir: '/live/api' },
    { projectKey: 'web-2222', projectName: 'web', projectDir: '/live/web' },
  ],
  workDirs: new Map([['api-1111', '/wt/api'], ['web-2222', '/wt/web']]),
  checkpointRefs: { 'api-1111': 'a1', 'web-2222': 'b2' },
  toolInstructions: new Map([['web-2222', 'use graphify']]),
});

test('_workspaceChannel names the workspace and each member\'s live project dir', () => {
  const ch = RunHarness.prototype._workspaceChannel.call(self());
  assert.equal(ch.kind, 'metadata');
  assert.equal(ch.workspaceDescription, '# Workspace: Shop\n');
  assert.equal(ch.workspaceId, 'wks-shop-1234abcd');
  assert.equal(ch.workspaceName, 'Shop');
  assert.deepEqual(ch.projects, [
    { projectKey: 'api-1111', projectName: 'api', projectDir: resolve('/live/api'), worktreeDir: '/wt/api', checkpointRef: 'a1', graphInstruction: '' },
    { projectKey: 'web-2222', projectName: 'web', projectDir: resolve('/live/web'), worktreeDir: '/wt/web', checkpointRef: 'b2', graphInstruction: 'use graphify' },
  ]);
});

test('a first scan\'s target has no stored id yet: the channel falls back to the workspaceKey', () => {
  const ch = RunHarness.prototype._workspaceChannel.call({ ...self(), workspace: { name: 'Shop' } });
  assert.equal(ch.workspaceId, 'wks-shop-1234abcd');
  assert.equal(ch.workspaceName, 'Shop');
});
