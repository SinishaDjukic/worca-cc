// test/workspace-scan-run.test.mjs
// The Workspace scan run's core helpers: create validation shared with the launch
// (checkNewWorkspace), the run's prompt/title, and the done-time finalizer that
// creates or updates the workspace from the scanner's output.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { checkNewWorkspace, createWorkspace, readWorkspace, workspaceKey } from '../src/core/workspaces.mjs';
import {
  WORKSPACE_SCAN_OUTPUT_FILE, scanRunTitle, scanRunPrompt, createWorkspaceWithHomes, finalizeWorkspaceScan,
} from '../src/core/workspace-scan-run.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';

useTempHome(after);
const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-scanrun-'));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}
async function pipelineDirWith(text) {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-scanrun-pl-'));
  created.push(dir);
  if (text !== null) await writeFile(join(dir, WORKSPACE_SCAN_OUTPUT_FILE), text);
  return dir;
}
const DESC = '# Workspace: X\n## Overview\nTwo services.\n## Interconnections\n- a -> b: REST API; /v1\n';

test('WORKSPACE_SCAN_OUTPUT_FILE is the scanner sidecar output filename', () => {
  assert.equal(WORKSPACE_SCAN_OUTPUT_FILE, loadAgentRegistry().workspaceScanner.outputs[0].filename);
});

test('scanRunTitle / scanRunPrompt name the workspace and every member', () => {
  assert.equal(scanRunTitle('Platform'), 'Workspace scan: Platform');
  const p = scanRunPrompt({ name: 'Platform', projectNames: ['api', 'web'] });
  assert.match(p, /workspace "Platform"/);
  assert.match(p, /Member projects \(2\): api, web\./);
  assert.match(p, /# Workspace: Platform/);
  assert.doesNotMatch(p, /re-scan/);
  assert.match(scanRunPrompt({ name: 'Platform', projectNames: ['api', 'web'], rescan: true }), /re-scan/);
});

test('checkNewWorkspace validates like createWorkspace and returns the future id', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const ok = checkNewWorkspace({ name: ' Alpha ', projectPaths: [a, b] });
  assert.equal(ok.name, 'Alpha');
  assert.equal(ok.id, workspaceKey({ name: 'Alpha', projectPaths: [a, b] }));
  assert.equal(ok.projectPaths.length, 2);
  assert.throws(() => checkNewWorkspace({ name: '', projectPaths: [a, b] }), (e) => e.code === 'BAD_REQUEST');
  assert.throws(() => checkNewWorkspace({ name: 'Solo', projectPaths: [a, a] }), (e) => e.code === 'BAD_REQUEST');
  await createWorkspace({ name: 'Alpha', projectPaths: [a, b] });
  assert.throws(() => checkNewWorkspace({ name: 'ALPHA', projectPaths: [a, c] }), (e) => e.code === 'DUPLICATE_NAME');
  assert.throws(() => checkNewWorkspace({ name: 'Beta', projectPaths: [b, a] }), (e) => e.code === 'DUPLICATE_SET');
});

test('finalize creates the workspace from the scanner output (outcome created)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const id = workspaceKey({ name: 'Gamma', projectPaths: [a, b] });
  const res = await finalizeWorkspaceScan({ workspaceId: id, name: 'Gamma', projectPaths: [a, b], pipelineDir: await pipelineDirWith(DESC) });
  assert.deepEqual(res, { outcome: 'created', workspaceId: id });
  assert.equal((await readWorkspace(id)).description, DESC.trim());
});

test('finalize replaces the description of an existing workspace (outcome updated)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Delta', projectPaths: [a, b], description: 'old notes' });
  const res = await finalizeWorkspaceScan({ workspaceId: ws.id, name: 'Delta', projectPaths: [a, b], pipelineDir: await pipelineDirWith(DESC) });
  assert.equal(res.outcome, 'updated');
  const after_ = await readWorkspace(ws.id);
  assert.equal(after_.description, DESC.trim());
  assert.equal(after_.name, 'Delta');
});

test('finalize never throws: empty output and a taken name come back as failed', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const idE = workspaceKey({ name: 'Eps', projectPaths: [a, b] });
  const empty = await finalizeWorkspaceScan({ workspaceId: idE, name: 'Eps', projectPaths: [a, b], pipelineDir: await pipelineDirWith('  \n') });
  assert.equal(empty.outcome, 'failed');
  assert.match(empty.error, /no description/);
  const missing = await finalizeWorkspaceScan({ workspaceId: idE, name: 'Eps', projectPaths: [a, b], pipelineDir: await pipelineDirWith(null) });
  assert.equal(missing.outcome, 'failed');
  assert.equal(await readWorkspace(idE), null, 'nothing created');

  await createWorkspace({ name: 'Zeta', projectPaths: [a, c] });
  const idZ = workspaceKey({ name: 'Zeta', projectPaths: [a, b] });
  const clash = await finalizeWorkspaceScan({ workspaceId: idZ, name: 'Zeta', projectPaths: [a, b], pipelineDir: await pipelineDirWith(DESC) });
  assert.equal(clash.outcome, 'failed');
  assert.equal(clash.code, 'DUPLICATE_NAME');
  assert.equal(await readWorkspace(idZ), null);
});

test('createWorkspaceWithHomes creates like POST /api/workspaces (no recording member -> no home)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace, metricsHomeAuto } = await createWorkspaceWithHomes({ name: 'Eta', projectPaths: [a, b], description: 'd' });
  assert.equal(workspace.name, 'Eta');
  assert.equal(workspace.description, 'd');
  assert.equal(workspace.metricsProject, null);
  assert.equal(metricsHomeAuto, false);
});
