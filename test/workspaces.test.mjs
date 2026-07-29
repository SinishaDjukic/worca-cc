// test/workspaces.test.mjs
// Unit coverage for the workspace registry (src/core/workspaces.mjs): key
// derivation (order-independent + rename-stable), D1 duplicate-set dedupe,
// validation codes, the exactly-six-field persist shape, derived read-time
// fields, corrupt-file fail-safe, atomic write, and delete (registry + store).
//
// Each test sandboxes via a throwaway WORCA_HOME (mirrors projects.test.mjs).
// Members must be real git repos because createWorkspace validates isGitRepo.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  workspacesFile,
  workspaceKey,
  rootsHash,
  listWorkspaces,
  readWorkspace,
  createWorkspace,
  updateWorkspace,
  updateWorkspaceDescription,
  renameWorkspace,
  deleteWorkspace,
} from '../src/core/workspaces.mjs';
import { projectKey, workspaceStorePath } from '../src/core/store.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';

const created = [];
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});

async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-ws-home-'));
  created.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
  return dir;
}

/** A real git repo so isGitRepo() validation passes for real. */
async function freshRepo(prefix = 'worca-cc-ws-repo-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

/** A plain (non-git) directory. */
async function freshDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-ws-plain-'));
  created.push(dir);
  return dir;
}

test('workspaceKey is "wks-<nameSlug>-<sha1[:8]>" and order-independent over roots', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const k1 = workspaceKey({ name: 'IoT SP Platform', projectPaths: [a, b] });
  const k2 = workspaceKey({ name: 'IoT SP Platform', projectPaths: [b, a] }); // reversed
  assert.equal(k1, k2, 'sorted roots => order-independent key');
  assert.match(k1, /^wks-[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/);
  assert.ok(k1.startsWith('wks-iot-sp-platform-'), 'name slug embedded');
});

test('rootsHash is name-independent and order-independent (D1 dedupe key)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const h1 = rootsHash([a, b]);
  const h2 = rootsHash([b, a]);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{8}$/);
  // Two differently-named workspaces over the same set share the hash, differ in key.
  const kx = workspaceKey({ name: 'Alpha', projectPaths: [a, b] });
  const ky = workspaceKey({ name: 'Beta', projectPaths: [a, b] });
  assert.notEqual(kx, ky, 'name changes the key');
  assert.ok(kx.endsWith(h1) && ky.endsWith(h1), 'roots-hash tail is shared across names');
});

test('createWorkspace persists the workspace row + ordered member rows (no derived fields stored)', async () => {
  await freshHome();
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Demo WS', projectPaths: [a, b], description: 'desc' });
  assert.equal(ws.id, workspaceKey({ name: 'Demo WS', projectPaths: [a, b] }));
  const db = getDb();
  const row = db.prepare('SELECT name, description, created_at, updated_at FROM workspaces WHERE id = ?').get(ws.id);
  assert.equal(row.name, 'Demo WS');
  assert.equal(row.description, 'desc');
  assert.ok(row.created_at && row.updated_at);
  const members = db.prepare('SELECT ordinal FROM workspace_projects WHERE workspace_id = ? ORDER BY ordinal').all(ws.id);
  assert.deepEqual(members.map((m) => m.ordinal), [0, 1]);
  // projectKeys/exists are derived on read, never stored.
  const cols = db.prepare("PRAGMA table_info('workspaces')").all().map((c) => c.name);
  assert.ok(!cols.includes('project_keys') && !cols.includes('exists'), 'no derived columns');
});

test('createWorkspace defaults description to "" when omitted', async () => {
  await freshHome();
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'No Desc', projectPaths: [a, b] });
  assert.equal(ws.description, '');
  const row = getDb().prepare('SELECT description FROM workspaces WHERE id = ?').get(ws.id);
  assert.equal(row.description, '');
});

test('listWorkspaces annotates derived projectKeys/exists (sorted, never persisted)', async () => {
  await freshHome();
  const a = await freshRepo();
  const b = await freshRepo();
  await createWorkspace({ name: 'Derived', projectPaths: [a, b] });
  const list = await listWorkspaces();
  assert.equal(list.length, 1);
  const ws = list[0];
  // projectKeys present, sorted ascending, index-aligned with projectPaths.
  assert.ok(Array.isArray(ws.projectKeys) && ws.projectKeys.length === 2);
  const sorted = [...ws.projectKeys].sort();
  assert.deepEqual(ws.projectKeys, sorted, 'projectKeys sorted ascending');
  for (let i = 0; i < ws.projectKeys.length; i++) {
    assert.equal(ws.projectKeys[i], projectKey(ws.projectPaths[i]), 'projectKeys index-aligned with paths');
  }
  // exists[] reflects on-disk presence.
  assert.deepEqual(ws.exists, [true, true]);
});

test('listWorkspaces marks a vanished member exists=false but keeps the workspace', async () => {
  await freshHome();
  const a = await freshRepo();
  const b = await freshRepo();
  await createWorkspace({ name: 'Vanish', projectPaths: [a, b] });
  // Remove member b after creation.
  await rm(b, { recursive: true, force: true });
  const [ws] = await listWorkspaces();
  assert.equal(ws.projectPaths.length, 2, 'workspace still references both paths');
  const idx = ws.projectPaths.indexOf(b);
  assert.equal(ws.exists[idx], false, 'vanished member flagged exists=false');
});

test('readWorkspace returns the annotated entry or null', async () => {
  await freshHome();
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Read Me', projectPaths: [a, b] });
  const got = await readWorkspace(ws.id);
  assert.equal(got.id, ws.id);
  assert.equal(got.name, 'Read Me');
  assert.ok(Array.isArray(got.projectKeys), 'readWorkspace annotates derived fields too');
  assert.equal(await readWorkspace('wks-nope-00000000'), null);
  assert.equal(await readWorkspace(''), null);
});

test('createWorkspace validation codes: BAD_REQUEST / DUPLICATE_NAME / DUPLICATE_SET', async () => {
  await freshHome();
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();

  // Empty name -> BAD_REQUEST
  await assert.rejects(() => createWorkspace({ name: '', projectPaths: [a, b] }),
    (e) => e.code === 'BAD_REQUEST');
  // <2 paths -> BAD_REQUEST
  await assert.rejects(() => createWorkspace({ name: 'X', projectPaths: [a] }),
    (e) => e.code === 'BAD_REQUEST');
  // A non-git dir member -> BAD_REQUEST
  const plain = await freshDir();
  await assert.rejects(() => createWorkspace({ name: 'Y', projectPaths: [a, plain] }),
    (e) => e.code === 'BAD_REQUEST');
  // A missing path member -> BAD_REQUEST
  await assert.rejects(() => createWorkspace({ name: 'Z', projectPaths: [a, '/no/such/dir/here'] }),
    (e) => e.code === 'BAD_REQUEST');

  // Create one, then duplicate name (case-insensitive) over a DIFFERENT set -> DUPLICATE_NAME
  await createWorkspace({ name: 'Unique', projectPaths: [a, b] });
  await assert.rejects(() => createWorkspace({ name: 'unique', projectPaths: [a, c] }),
    (e) => e.code === 'DUPLICATE_NAME');

  // Same project set under a different name -> DUPLICATE_SET (D1)
  await assert.rejects(() => createWorkspace({ name: 'Totally Different', projectPaths: [b, a] }),
    (e) => e.code === 'DUPLICATE_SET');
});

test('createWorkspace de-dupes members by canonical root; collapse below 2 is BAD_REQUEST', async () => {
  await freshHome();
  const a = await freshRepo();
  const b = await freshRepo();
  // Same repo passed twice (plus a trailing-slash variant) collapses to one root -> <2 -> BAD_REQUEST.
  await assert.rejects(() => createWorkspace({ name: 'Collapse', projectPaths: [a, a + '/'] }),
    (e) => e.code === 'BAD_REQUEST');

  // a duplicated but b distinct => 2 distinct roots after de-dupe => OK, stored as 2.
  const ws = await createWorkspace({ name: 'Dedup OK', projectPaths: [a, a, b] });
  assert.equal(ws.projectPaths.length, 2, 'duplicate canonical roots collapsed to distinct set');
});

test('updateWorkspaceDescription edits description, stamps updatedAt, keeps id', async () => {
  await freshHome();
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Editable', projectPaths: [a, b], description: 'one' });
  const before = ws.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  const updated = await updateWorkspaceDescription(ws.id, 'two');
  assert.equal(updated.id, ws.id, 'id unchanged');
  assert.equal(updated.description, 'two');
  assert.notEqual(updated.updatedAt, before, 'updatedAt advanced');
  assert.equal(updated.createdAt, ws.createdAt, 'createdAt preserved');
  // Persisted.
  const got = await readWorkspace(ws.id);
  assert.equal(got.description, 'two');
});

test('updateWorkspaceDescription stores the FULL description (cap-on-freeze, not cap-on-store)', async () => {
  await freshHome();
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Long Desc', projectPaths: [a, b] });
  const big = 'x'.repeat(5000);
  const updated = await updateWorkspaceDescription(ws.id, big);
  assert.equal(updated.description.length, 5000, 'editable description is never truncated on store');
  const row = getDb().prepare('SELECT description FROM workspaces WHERE id = ?').get(ws.id);
  assert.equal(row.description.length, 5000);
});

test('renameWorkspace changes name but NEVER recomputes id (D1 immutability)', async () => {
  await freshHome();
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Old Name', projectPaths: [a, b] });
  const renamed = await renameWorkspace(ws.id, 'New Name');
  assert.equal(renamed.id, ws.id, 'id frozen across rename');
  assert.equal(renamed.name, 'New Name');
  // The naive recomputation WOULD differ — prove the stored id is NOT that.
  const wouldBe = workspaceKey({ name: 'New Name', projectPaths: [a, b] });
  assert.notEqual(wouldBe, ws.id, 'sanity: recompute over the new name would differ');
  assert.equal(renamed.id, ws.id, 'but stored id stays the original');
});

test('updateWorkspace rejects a rename that clashes (case-insensitive) with DUPLICATE_NAME', async () => {
  await freshHome();
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  await createWorkspace({ name: 'Taken', projectPaths: [a, b] });
  const other = await createWorkspace({ name: 'Free', projectPaths: [a, c] });
  await assert.rejects(() => renameWorkspace(other.id, 'taken'),
    (e) => e.code === 'DUPLICATE_NAME');
  // Renaming to its own name (case variant) is allowed (no false self-clash).
  const ok = await renameWorkspace(other.id, 'FREE');
  assert.equal(ok.name, 'FREE');
});

test('updateWorkspace throws NOT_FOUND for an unknown id', async () => {
  await freshHome();
  await assert.rejects(() => updateWorkspace('wks-ghost-00000000', { description: 'x' }),
    (e) => e.code === 'NOT_FOUND');
  await assert.rejects(() => renameWorkspace('wks-ghost-00000000', 'x'),
    (e) => e.code === 'NOT_FOUND');
});

test('updateWorkspace never mutates projectPaths even if passed in the patch', async () => {
  await freshHome();
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Immutable Set', projectPaths: [a, b] });
  // Defense-in-depth: a projectPaths key in the patch is ignored by the module.
  const updated = await updateWorkspace(ws.id, { description: 'd', projectPaths: ['/evil'] });
  assert.deepEqual(updated.projectPaths, ws.projectPaths, 'project set is immutable');
});

test('listWorkspaces returns [] on an empty store', async () => {
  await freshHome();
  assert.deepEqual(await listWorkspaces(), []);
});

test('deleteWorkspace removes the registry entry AND the store/workspaces/<key> dir', async () => {
  await freshHome();
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Delete Me', projectPaths: [a, b] });
  // Seed a store dir for this workspace.
  const storeDir = workspaceStorePath(ws.id);
  await mkdir(join(storeDir, 'pipelines'), { recursive: true });
  assert.ok(existsSync(storeDir));

  const res = await deleteWorkspace(ws.id);
  assert.equal(res.ok, true);
  assert.ok(Array.isArray(res.warnings));
  assert.equal(await readWorkspace(ws.id), null, 'registry entry gone');
  assert.equal(existsSync(storeDir), false, 'store dir removed');
});

test('deleteWorkspace throws NOT_FOUND for an unknown (well-formed) id and removes nothing', async () => {
  await freshHome();
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Keep On Miss', projectPaths: [a, b] });
  const storeDir = workspaceStorePath(ws.id);
  await mkdir(storeDir, { recursive: true });
  // A different, well-formed-but-absent id must not touch the existing one.
  await assert.rejects(() => deleteWorkspace('wks-ghost-00000000'),
    (e) => e.code === 'NOT_FOUND');
  assert.ok(existsSync(storeDir), 'an unrelated workspace store dir is untouched');
  assert.ok(await readWorkspace(ws.id), 'the existing registry entry is untouched');
});

test('deleteWorkspace rejects a path-traversal id and deletes NOTHING outside the namespace', async () => {
  const home = await freshHome();
  const a = await freshRepo();
  const b = await freshRepo();
  // A real workspace + its store dir, plus a sibling project store dir that a
  // crafted "../<key>" id would target. Both MUST survive a traversal attempt.
  const ws = await createWorkspace({ name: 'Victim', projectPaths: [a, b] });
  const wsStore = workspaceStorePath(ws.id);
  await mkdir(join(wsStore, 'pipelines'), { recursive: true });
  const store = join(home, '.worca-cc', 'store');
  const siblingProj = join(store, 'some-proj-12345678');
  await mkdir(siblingProj, { recursive: true });
  await writeFile(join(siblingProj, 'meta.json'), '{}', 'utf8');
  const outsideDir = join(home, '.worca-cc');        // would be hit by '../..'
  assert.ok(existsSync(outsideDir));

  for (const evil of ['../..', '../../store/some-proj-12345678', '..', 'wks-x/../../..', '/etc']) {
    await assert.rejects(() => deleteWorkspace(evil),
      (e) => e.code === 'NOT_FOUND', `crafted id ${JSON.stringify(evil)} must be NOT_FOUND`);
  }

  // Nothing outside the (untouched) namespace was removed.
  assert.ok(existsSync(siblingProj), 'sibling project store dir survives');
  assert.ok(existsSync(join(store, 'workspaces')), 'workspaces container survives');
  assert.ok(existsSync(outsideDir), '.worca-cc dir survives');
  assert.ok(existsSync(wsStore), 'the real workspace store dir survives (no membership match for evil ids)');
  assert.ok(await readWorkspace(ws.id), 'the real registry entry survives');
});

test('workspacesFile is a sibling of projects.json under worcaHome', async () => {
  const home = await freshHome();
  assert.equal(workspacesFile(), join(home, '.worca-cc', 'workspaces.json'));
});
