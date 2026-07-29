// test/workspaces-db.test.mjs
// workspaces.mjs stores the workspace registry in SQLite (workspaces +
// workspace_projects). Signatures unchanged; derived projectKeys/exists are
// recomputed on read. Members must be real git repos (createWorkspace validates).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  workspaceKey, listWorkspaces, readWorkspace, createWorkspace,
} from '../src/core/workspaces.mjs';
import { projectKey } from '../src/core/store.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';

const created = [];
async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wsdb-home-'));
  created.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
  return dir;
}
async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wsdb-repo-'));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}
beforeEach(freshHome);
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});

test('listWorkspaces / readWorkspace are [] / null on an empty store', async () => {
  assert.deepEqual(await listWorkspaces(), []);
  assert.equal(await readWorkspace('wks-nope-00000000'), null);
  assert.equal(await readWorkspace(''), null);
});

test('createWorkspace persists workspace + member rows; readWorkspace annotates derived fields', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Demo WS', projectPaths: [a, b], description: 'desc' });
  assert.equal(ws.id, workspaceKey({ name: 'Demo WS', projectPaths: [a, b] }));
  assert.equal(ws.description, 'desc');

  // workspaces row + 2 member rows persisted.
  const db = getDb();
  const wrow = db.prepare('SELECT name, description FROM workspaces WHERE id = ?').get(ws.id);
  assert.equal(wrow.name, 'Demo WS');
  const members = db.prepare(
    'SELECT project_key, ordinal FROM workspace_projects WHERE workspace_id = ? ORDER BY ordinal'
  ).all(ws.id);
  assert.equal(members.length, 2);
  assert.deepEqual(members.map((m) => m.ordinal), [0, 1], 'ordinal preserves persisted order');

  // readWorkspace returns annotated derived fields (projectKeys sorted, exists[]).
  const got = await readWorkspace(ws.id);
  assert.ok(Array.isArray(got.projectKeys) && got.projectKeys.length === 2);
  assert.deepEqual(got.projectKeys, [...got.projectKeys].sort(), 'projectKeys sorted ascending');
  for (let i = 0; i < got.projectKeys.length; i++) {
    assert.equal(got.projectKeys[i], projectKey(got.projectPaths[i]), 'projectKeys index-aligned with paths');
  }
  assert.deepEqual(got.exists, [true, true]);
});

test('listWorkspaces marks a vanished member exists=false but keeps the workspace', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  await createWorkspace({ name: 'Vanish', projectPaths: [a, b] });
  await rm(b, { recursive: true, force: true });
  const [ws] = await listWorkspaces();
  assert.equal(ws.projectPaths.length, 2);
  const idx = ws.projectPaths.indexOf(b);
  assert.equal(ws.exists[idx], false);
});

// ---- Task 2.10: updateWorkspace (+ thin setters) and deleteWorkspace ----
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import {
  updateWorkspace, updateWorkspaceDescription, renameWorkspace, deleteWorkspace,
} from '../src/core/workspaces.mjs';
import { workspaceStorePath } from '../src/core/store.mjs';

test('updateWorkspaceDescription edits description, stamps updatedAt, keeps id', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Editable', projectPaths: [a, b], description: 'one' });
  const before = ws.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  const up = await updateWorkspaceDescription(ws.id, 'two');
  assert.equal(up.id, ws.id);
  assert.equal(up.description, 'two');
  assert.notEqual(up.updatedAt, before, 'updatedAt advanced');
  assert.equal(up.createdAt, ws.createdAt, 'createdAt preserved');
  assert.equal((await readWorkspace(ws.id)).description, 'two', 'persisted');
});

test('renameWorkspace changes name but NEVER recomputes id', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Old Name', projectPaths: [a, b] });
  const renamed = await renameWorkspace(ws.id, 'New Name');
  assert.equal(renamed.id, ws.id, 'id frozen across rename');
  assert.equal(renamed.name, 'New Name');
  assert.notEqual(workspaceKey({ name: 'New Name', projectPaths: [a, b] }), ws.id, 'recompute would differ');
});

test('updateWorkspace rejects a NOCASE name clash (DUPLICATE_NAME); self-rename allowed', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  await createWorkspace({ name: 'Taken', projectPaths: [a, b] });
  const other = await createWorkspace({ name: 'Free', projectPaths: [a, c] });
  await assert.rejects(() => renameWorkspace(other.id, 'taken'), (e) => e.code === 'DUPLICATE_NAME');
  assert.equal((await renameWorkspace(other.id, 'FREE')).name, 'FREE', 'self case-variant allowed');
});

test('updateWorkspace throws NOT_FOUND for an unknown id; never mutates projectPaths', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  await assert.rejects(() => updateWorkspace('wks-ghost-00000000', { description: 'x' }), (e) => e.code === 'NOT_FOUND');
  const ws = await createWorkspace({ name: 'Immutable', projectPaths: [a, b] });
  const up = await updateWorkspace(ws.id, { description: 'd', projectPaths: ['/evil'] });
  assert.deepEqual(up.projectPaths, ws.projectPaths, 'project set immutable');
});

test('deleteWorkspace removes the row, cascades member rows, and removes the store dir', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Delete Me', projectPaths: [a, b] });
  const storeDir = workspaceStorePath(ws.id);
  await mkdir(join(storeDir, 'pipelines'), { recursive: true });
  assert.ok(existsSync(storeDir));

  const res = await deleteWorkspace(ws.id);
  assert.equal(res.ok, true);
  assert.equal(await readWorkspace(ws.id), null, 'registry row gone');
  assert.equal(existsSync(storeDir), false, 'store dir removed');
  // FK ON DELETE CASCADE removed the member rows too.
  const { n } = getDb().prepare('SELECT COUNT(*) AS n FROM workspace_projects WHERE workspace_id = ?').get(ws.id);
  assert.equal(n, 0, 'member rows cascaded');
});

test('deleteWorkspace throws NOT_FOUND for an unknown well-formed id and removes nothing', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Keep On Miss', projectPaths: [a, b] });
  await assert.rejects(() => deleteWorkspace('wks-ghost-00000000'), (e) => e.code === 'NOT_FOUND');
  assert.ok(await readWorkspace(ws.id), 'existing workspace untouched');
});

test('deleteWorkspace rejects a path-traversal id and deletes nothing', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Victim', projectPaths: [a, b] });
  for (const evil of ['../..', '../../store/x', '..', 'wks-x/../../..', '/etc']) {
    await assert.rejects(() => deleteWorkspace(evil), (e) => e.code === 'NOT_FOUND');
  }
  assert.ok(await readWorkspace(ws.id), 'the real workspace survives crafted ids');
});
