// test/workspace-scan-run.test.mjs
// The Workspace scan run's core helpers: create validation shared with the launch
// (checkNewWorkspace), the run's prompt/title, and the done-time finalizer that
// creates or updates the workspace from the scanner's output.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { templateRepo } from './helpers/git-dir.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkNewWorkspace, createWorkspace, readWorkspace, workspaceKey } from '../src/core/workspaces.mjs';
import {
  WORKSPACE_SCAN_OUTPUT_FILE, scanRunTitle, scanRunPrompt, finalizeWorkspaceScan,
} from '../src/core/workspace-scan-run.mjs';

useTempHome(after);
const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

function freshRepo() {
  const dir = templateRepo('scanrun', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } });
  created.push(dir);
  return dir;
}
async function pipelineDirWith(text) {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-scanrun-pl-'));
  created.push(dir);
  if (text !== null) await writeFile(join(dir, WORKSPACE_SCAN_OUTPUT_FILE), text);
  return dir;
}
const DESC = '# Workspace: X\n## Overview\nTwo services.\n## Interconnections\n- a -> b: REST API; /v1\n';

test('scanRunTitle / scanRunPrompt name the workspace and every member', () => {
  assert.equal(scanRunTitle('Platform'), 'Workspace scan: Platform');
  const p = scanRunPrompt({ name: 'Platform', projectNames: ['api', 'web'] });
  assert.match(p, /workspace "Platform"/);
  assert.match(p, /Member projects \(2\): api, web\./);
  assert.match(p, /# Workspace: Platform/);
  assert.doesNotMatch(p, /re-scan/);
  assert.match(scanRunPrompt({ name: 'Platform', projectNames: ['api', 'web'], rescan: true }), /re-scan/);
  assert.equal(scanRunTitle('Platform', { partial: true }), 'Workspace partial re-scan: Platform');
  const partial = scanRunPrompt({ name: 'Platform', projectNames: ['api', 'web'], rescan: true, partial: true });
  assert.match(partial, /partial re-scan after a member was removed/);
  assert.doesNotMatch(partial, /describe the code as it is now/);
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

test('finalize refuses to save a scan of a member set the workspace no longer has (SET_CHANGED)', async () => {
  const { addWorkspaceMembers } = await import('../src/core/workspaces.mjs');
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const ws = await createWorkspace({ name: 'Moved On', projectPaths: [a, b], description: 'kept' });
  await addWorkspaceMembers(ws.id, [c]);   // a member change landed while the scan of [a, b] ran
  const res = await finalizeWorkspaceScan({ workspaceId: ws.id, name: 'Moved On', projectPaths: [a, b], pipelineDir: await pipelineDirWith(DESC) });
  assert.equal(res.outcome, 'failed');
  assert.equal(res.code, 'SET_CHANGED');
  assert.equal((await readWorkspace(ws.id)).description, 'kept', 'nothing saved');
  const now = await readWorkspace(ws.id);
  const ok = await finalizeWorkspaceScan({ workspaceId: ws.id, name: 'Moved On', projectPaths: now.projectPaths, pipelineDir: await pipelineDirWith(DESC) });
  assert.equal(ok.outcome, 'updated', 'a scan of the current set saves');
});

test('a partial re-scan of a set that changed again is refused (SET_CHANGED); the stored map and overrides stay', async () => {
  const { removeWorkspaceMember, saveWorkspaceScanResult, readWorkspaceMap, addWorkspaceManualEdge } = await import('../src/core/workspaces.mjs');
  const { sampleMap } = await import('./helpers/wsmap-stored.mjs');
  const [a, b, c, d] = [await freshRepo(), await freshRepo(), await freshRepo(), await freshRepo()];
  const ws = await createWorkspace({ name: 'Partial Moved On', projectPaths: [a, b, c, d] });
  const key = (p) => ws.projectKeys[ws.projectPaths.indexOf(p)];
  const s = sampleMap({ keys: [key(a), key(b)], names: ['a', 'b'], name: ws.name });
  for (const [p, nm] of [[c, 'c'], [d, 'd']]) s.map.members.push({ ...s.map.members[0], key: key(p), name: nm });
  await saveWorkspaceScanResult(ws.id, { map: s.map, synthesis: s.synthesis });
  await addWorkspaceManualEdge(ws.id, { from: key(a), to: key(b), kind: 'http', display: 'zz-keep' });
  await removeWorkspaceMember(ws.id, d);                    // the partial run starts for [a, b, c] …
  const started = await readWorkspace(ws.id);
  const pruned = await readWorkspaceMap(ws.id);
  await removeWorkspaceMember(ws.id, c);                    // … and another removal lands while it runs
  const dir = await pipelineDirWith('# Workspace: x\n');   // cleaned up by the file's `after`; writes workspace-scan.md
  await writeFile(join(dir, 'workspace-map.json'), JSON.stringify(pruned.map));
  await writeFile(join(dir, 'synthesis.json'), JSON.stringify({ ...pruned.synthesis, overview: 'stale partial' }));
  const res = await finalizeWorkspaceScan({ workspaceId: ws.id, name: ws.name, projectPaths: started.projectPaths, pipelineDir: dir });
  assert.equal(res.code, 'SET_CHANGED');
  const now = await readWorkspaceMap(ws.id);
  assert.notEqual(now.synthesis.overview, 'stale partial');
  assert.deepEqual(now.overrides.manual.map((m) => m.display), ['zz-keep']);
});
