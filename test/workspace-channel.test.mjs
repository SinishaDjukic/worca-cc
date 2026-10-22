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
import { folderMemberFiles } from '../src/core/folder-members.mjs';
import { WORKSPACE_SCAN_WORKFLOW_ID } from '../src/core/graph/builtin-workflows.mjs';
import { checkRows } from './helpers/rows.mjs';

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

test('_workspaceChannel names the workspace and each member\'s live project dir; a first scan falls back to the workspaceKey', async () => {
  await checkRows([
    { name: '_workspaceChannel names the workspace and each member\'s live project dir', run: () => {
      const ch = RunHarness.prototype._workspaceChannel.call(self());
      assert.equal(ch.kind, 'metadata');
      assert.equal(ch.workspaceDescription, '# Workspace: Shop\n');
      assert.equal(ch.workspaceId, 'wks-shop-1234abcd');
      assert.equal(ch.workspaceName, 'Shop');
      assert.deepEqual(ch.projects, [
        { projectKey: 'api-1111', projectName: 'api', projectDir: resolve('/live/api'), worktreeDir: '/wt/api', checkpointRef: 'a1', graphInstruction: '' },
        { projectKey: 'web-2222', projectName: 'web', projectDir: resolve('/live/web'), worktreeDir: '/wt/web', checkpointRef: 'b2', graphInstruction: 'use graphify' },
      ]);
    } },
    { name: 'a first scan\'s target has no stored id yet: the channel falls back to the workspaceKey', run: () => {
      const ch = RunHarness.prototype._workspaceChannel.call({ ...self(), workspace: { name: 'Shop' } });
      assert.equal(ch.workspaceId, 'wks-shop-1234abcd');
      assert.equal(ch.workspaceName, 'Shop');
    } },
  ]);
});

// P5: a Folder member rides the channel and the node roster with its changes file — except on a read-only Workspace
// scan, which writes no Changes (S51), so its agents are never pointed at a changes file.
const withFolder = (workflowId) => {
  const members = [
    { projectKey: 'api-1111', projectName: 'api', projectDir: '/live/api' },
    { projectKey: 'notes-9c8d7e6f', projectName: 'notes', projectDir: '/live/notes', workMode: 'folder' },
  ];
  const { _memberWorkMode, _folderFilesFor, _isWorkspaceScan } = RunHarness.prototype;
  return {
    ...self(), members, memberByKey: new Map(members.map((m) => [m.projectKey, m])),
    isWorkspace: true, workflowId, runRootMode: 'detached', pipeline: { dir: '/store/pipelines/p-1' },
    workDirs: new Map([['api-1111', '/rr/repos/api-1111'], ['notes-9c8d7e6f', '/rr/repos/notes-9c8d7e6f']]),
    checkpointRefs: { 'api-1111': 'a1' },
    _memberWorkMode, _folderFilesFor, _isWorkspaceScan,
  };
};

test('a Folder member carries its changes file on the channel and the node roster, but not on a read-only Workspace scan', async () => {
  const PATCH = folderMemberFiles('/store/pipelines/p-1', 'notes-9c8d7e6f').patch;
  await checkRows([
    { name: '_workspaceChannel: a run names the Folder member\'s changes file; a scan names none', run: () => {
      const notes = { projectKey: 'notes-9c8d7e6f', projectName: 'notes', projectDir: resolve('/live/notes'), worktreeDir: '/rr/repos/notes-9c8d7e6f',
        checkpointRef: undefined, graphInstruction: '', workMode: 'folder' };
      const run = RunHarness.prototype._workspaceChannel.call(withFolder('wf_default'));
      assert.deepEqual(run.projects[1], { ...notes, changesPatch: PATCH });
      const scan = RunHarness.prototype._workspaceChannel.call(withFolder(WORKSPACE_SCAN_WORKFLOW_ID));
      assert.deepEqual(scan.projects[1], notes);
      assert.deepEqual(scan.projects[0], run.projects[0], 'the Git member is the same either way');
    } },
    { name: '_reposCtx: a run names the Folder member\'s changes file; a scan names none', run: () => {
      const notes = { projectKey: 'notes-9c8d7e6f', projectName: 'notes', dir: '/rr/repos/notes-9c8d7e6f', relDir: 'repos/notes-9c8d7e6f',
        checkpointRef: null, graphInstruction: '', workMode: 'folder' };
      const run = RunHarness.prototype._reposCtx.call(withFolder('wf_default'));
      assert.deepEqual(run[1], { ...notes, changesPatch: PATCH });
      const scan = RunHarness.prototype._reposCtx.call(withFolder(WORKSPACE_SCAN_WORKFLOW_ID));
      assert.deepEqual(scan[1], notes);
      assert.deepEqual(scan[0], run[0], 'the Git member is the same either way');
    } },
  ]);
});

// #411: relDir names the checkout dir on disk (a shortened projectKey can differ from the key).
test('_reposCtx: relDir is the checkout dir name, not the projectKey; null before the checkout exists and on legacy', () => {
  const self = (runRootMode, workDirs) => ({ members: [{ projectKey: 'identity-access-management-1a2b3c4d', projectName: 'iam' }],
    runRootMode, workDirs: new Map(workDirs), checkpointRefs: {}, toolInstructions: new Map(), isWorkspace: false });
  const [m] = RunHarness.prototype._reposCtx.call(self('detached', [['identity-access-management-1a2b3c4d', '/rr/repos/ident-1a2b3c4d']]));
  assert.equal(m.relDir, 'repos/ident-1a2b3c4d');
  assert.equal(m.dir, '/rr/repos/ident-1a2b3c4d');
  assert.equal(RunHarness.prototype._reposCtx.call(self('detached', []))[0].relDir, 'repos/identity-access-management-1a2b3c4d');
  assert.equal(RunHarness.prototype._reposCtx.call(self('legacy', [['identity-access-management-1a2b3c4d', '/p/.worca-cc/worktrees/x']]))[0].relDir, null);
});
