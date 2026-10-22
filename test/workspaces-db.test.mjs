// test/workspaces-db.test.mjs
// workspaces.mjs stores the workspace registry in SQLite (workspaces +
// workspace_projects). Signatures unchanged; derived projectKeys/exists are
// recomputed on read. Members must be real git repos (createWorkspace validates).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  workspaceKey, listWorkspaces, readWorkspace, createWorkspace, saveWorkspaceScanResult, setWorkspaceScanPick,
} from '../src/core/workspaces.mjs';
import { projectKey } from '../src/core/store.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';
import { checkRows } from './helpers/rows.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

const created = [];
async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wsdb-home-'));
  created.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
  return dir;
}
function freshRepo() {
  const dir = templateRepo('wsdb-repo', { branch: 'main', user: true, files: { 'README.md': '# hi\n' }, prefix: 'worca-cc-wsdb-repo-' });
  created.push(dir);
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
  await assert.rejects(() => renameWorkspace('wks-ghost-00000000', 'x'), (e) => e.code === 'NOT_FOUND');
  const ws = await createWorkspace({ name: 'Immutable', projectPaths: [a, b] });
  const up = await updateWorkspace(ws.id, { description: 'd', projectPaths: ['/evil'] });
  assert.deepEqual(up.projectPaths, ws.projectPaths, 'project set immutable');
});

test('deleteWorkspace: unknown id NOT_FOUND removes nothing; a real delete cascades member rows and removes the store dir', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Delete Me', projectPaths: [a, b] });
  await checkRows([
    { name: 'deleteWorkspace throws NOT_FOUND for an unknown well-formed id and removes nothing', run: async () => {
      await assert.rejects(() => deleteWorkspace('wks-ghost-00000000'), (e) => e.code === 'NOT_FOUND');
      assert.ok(await readWorkspace(ws.id), 'existing workspace untouched');
    } },
    { name: 'deleteWorkspace removes the row, cascades member rows, and removes the store dir', run: async () => {
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
    } },
  ]);
});

// ---- p1t4: workspaces.metricsProject (team-metrics home) ----

// ---- workspaces.scan_models_json (v57): the scan pick captured at creation ----

test('createWorkspace persists a validated scanModels pick; readWorkspace returns it; a missing/blank pick stores NULL', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();   // a NEW member set for the plain pick-less workspace (same set = DUPLICATE_SET)
  const pick = { scanModel: 'claude-opus-5-5', scanEffort: 'high', agentModel: 'fable', agentEffort: 'max' };
  const ws = await createWorkspace({ name: 'Models WS', projectPaths: [a, b], scanModels: pick });
  assert.deepEqual((await readWorkspace(ws.id)).scanModels, pick);
  const db = getDb();
  const row = db.prepare('SELECT scan_models_json FROM workspaces WHERE id = ?').get(ws.id);
  assert.deepEqual(JSON.parse(row.scan_models_json), pick);

  const plain = await createWorkspace({ name: 'Plain WS', projectPaths: [a, c] });
  assert.equal((await readWorkspace(plain.id)).scanModels, null);
});

test('saveWorkspaceScanResult lazily stores a scanModels pick when a workspace has none; never overwrites one; ignores a null pick', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const pick = { scanModel: 'claude-opus-5-5', scanEffort: 'high', agentModel: 'fable', agentEffort: 'max' };
  const other = { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' };
  const ws = await createWorkspace({ name: 'Persist On Scan WS', projectPaths: [a, b] });   // → scan_models_json NULL
  assert.equal(ws.scanModels, null, 'a plain create stores no pick (pre-v57 legacy shape)');

  // A scan result carrying the resolved snapshot establishes the pick…
  await saveWorkspaceScanResult(ws.id, { description: '# Workspace: P\n', scanModels: pick });
  assert.deepEqual((await readWorkspace(ws.id)).scanModels, pick, 'the snapshot became the workspace pick');
  const row1 = getDb().prepare('SELECT scan_models_json, updated_at FROM workspaces WHERE id = ?').get(ws.id);
  assert.deepEqual(JSON.parse(row1.scan_models_json), pick, 'raw row persisted');
  assert.ok(row1.updated_at, 'the pick UPDATE stamps updated_at');

  // …only once: a later snapshot never overwrites the stored pick…
  await saveWorkspaceScanResult(ws.id, { description: '# Workspace: P2\n', scanModels: other });
  assert.deepEqual((await readWorkspace(ws.id)).scanModels, pick, 're-scans keep the stored pick');

  // …and a result without a snapshot leaves a NULL pick alone.
  const plain = await createWorkspace({ name: 'Plain2 WS', projectPaths: [a, c] });
  await saveWorkspaceScanResult(plain.id, { description: '# Workspace: Plain2\n' });
  assert.equal((await readWorkspace(plain.id)).scanModels, null, 'no snapshot, nothing persisted');
});

test('setWorkspaceScanPick persists a pick, clears on null, stamps updated_at, refuses an unknown id, and re-reads under the write lock (never clobbers a landed finalize)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const pick = { scanModel: 'claude-opus-5-5', scanEffort: 'high', agentModel: 'fable', agentEffort: 'max' };
  const other = { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' };
  const ws = await createWorkspace({ name: 'Set Pick WS', projectPaths: [a, b] });
  assert.equal(ws.scanModels, null);

  const set = await setWorkspaceScanPick(ws.id, pick);
  assert.deepEqual(set.scanModels, pick, 'returned on the write');
  assert.deepEqual((await readWorkspace(ws.id)).scanModels, pick, 'persisted');
  const row = getDb().prepare('SELECT scan_models_json, updated_at FROM workspaces WHERE id = ?').get(ws.id);
  assert.deepEqual(JSON.parse(row.scan_models_json), pick, 'raw row persisted');
  assert.ok(row.updated_at, 'the write stamps updated_at');

  // A pick a scan's finalize landed mid-write is never clobbered: the write re-reads under the lock.
  await saveWorkspaceScanResult(ws.id, { description: '# Workspace: X\n', scanModels: other });
  assert.deepEqual((await readWorkspace(ws.id)).scanModels, pick, 'the saved pick survives a finalize snapshot');
  const set2 = await setWorkspaceScanPick(ws.id, other);
  assert.deepEqual(set2.scanModels, other, 'an explicit write replaces the pick');
  assert.deepEqual((await readWorkspace(ws.id)).scanModels, other);

  // ## null clears; an unknown id is NOT_FOUND.
  const cleared = await setWorkspaceScanPick(ws.id, null);
  assert.equal(cleared.scanModels, null, 'null clears');
  assert.equal((await readWorkspace(ws.id)).scanModels, null, 'row returns null');
  await assert.rejects(() => setWorkspaceScanPick('no-such-workspace', pick), (e) => e && e.code === 'NOT_FOUND');
});

test('createWorkspace metricsProject: stored and returned, null when omitted, a non-member is BAD_REQUEST', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const outsider = await freshRepo();
  await checkRows([
    { name: 'createWorkspace({metricsProject}) stores it and returns it on the create response', run: async () => {
      const ws = await createWorkspace({ name: 'Homed', projectPaths: [a, b], metricsProject: a });
      assert.equal(ws.metricsProject, a, 'returned by create, not only by a later read');
      assert.equal((await readWorkspace(ws.id)).metricsProject, a, 'persisted');
    } },
    { name: 'createWorkspace defaults metricsProject to null when omitted', run: async () => {
      const ws = await createWorkspace({ name: 'Homeless', projectPaths: [a, c] });
      assert.equal(ws.metricsProject, null);
      assert.equal((await readWorkspace(ws.id)).metricsProject, null);
    } },
    { name: 'createWorkspace rejects a metricsProject that is not a member path', run: async () => {
      await assert.rejects(
        () => createWorkspace({ name: 'Bad Home', projectPaths: [b, c], metricsProject: outsider }),
        (e) => e.code === 'BAD_REQUEST',
      );
    } },
  ]);
});

test('updateWorkspace metricsProject: round-trips, omitted keeps it, null clears it, non-member/blank are BAD_REQUEST', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const outsider = await freshRepo();
  const ws = await createWorkspace({ name: 'Rehome', projectPaths: [a, b], metricsProject: a });
  await checkRows([
    { name: 'updateWorkspace({metricsProject}) round-trips via readWorkspace and returns the new value', run: async () => {
      const up = await updateWorkspace(ws.id, { metricsProject: b });
      assert.equal(up.metricsProject, b, 'returned by update');
      assert.equal((await readWorkspace(ws.id)).metricsProject, b, 'persisted');
    } },
    { name: 'updateWorkspace omitting metricsProject leaves the existing home untouched', run: async () => {
      // The row above moved the home to b.
      const up = await updateWorkspace(ws.id, { description: 'new desc' });
      assert.equal(up.metricsProject, b, 'home survives an update that does not mention it');
    } },
    { name: 'updateWorkspace({metricsProject: null}) clears a previously-set home', run: async () => {
      const up = await updateWorkspace(ws.id, { metricsProject: null });
      assert.equal(up.metricsProject, null);
      assert.equal((await readWorkspace(ws.id)).metricsProject, null);
    } },
    { name: 'updateWorkspace rejects a non-member metricsProject with BAD_REQUEST', run: async () => {
      await assert.rejects(
        () => updateWorkspace(ws.id, { metricsProject: outsider }),
        (e) => e.code === 'BAD_REQUEST',
      );
    } },
    { name: 'updateWorkspace rejects a blank-string metricsProject with BAD_REQUEST, not a 500', run: async () => {
      await assert.rejects(
        () => updateWorkspace(ws.id, { metricsProject: '   ' }),
        (e) => e.code === 'BAD_REQUEST',
      );
    } },
  ]);
});

// ---- membership changes: addWorkspaceMembers / removeWorkspaceMember ----
import { addWorkspaceMembers, removeWorkspaceMember } from '../src/core/workspaces.mjs';

test('addWorkspaceMembers appends new members, keeps the frozen id, stamps updatedAt', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const ws = await createWorkspace({ name: 'Grow', projectPaths: [a, b] });
  await new Promise((r) => setTimeout(r, 5));
  const up = await addWorkspaceMembers(ws.id, [c]);
  assert.equal(up.id, ws.id, 'id frozen across a membership change');
  assert.deepEqual([...up.projectPaths].sort(), [a, b, c].sort());
  assert.notEqual(up.updatedAt, ws.updatedAt, 'updatedAt advanced');
  const rows = getDb().prepare('SELECT project_key, ordinal FROM workspace_projects WHERE workspace_id = ? ORDER BY ordinal').all(ws.id);
  assert.deepEqual(rows.map((r) => r.project_key), [a, b, c], 'appended after the existing ordinals');
  assert.deepEqual([...(await readWorkspace(ws.id)).projectPaths].sort(), [a, b, c].sort(), 'persisted');
});

test('addWorkspaceMembers refuses an existing member, a non-dir, a non-git dir and an unknown id', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Picky', projectPaths: [a, b] });
  await assert.rejects(() => addWorkspaceMembers(ws.id, [a]), (e) => e.code === 'BAD_REQUEST' && /already a member/.test(e.message));
  await assert.rejects(() => addWorkspaceMembers(ws.id, []), (e) => e.code === 'BAD_REQUEST');
  await assert.rejects(() => addWorkspaceMembers(ws.id, [join(a, 'nope')]), (e) => e.code === 'BAD_REQUEST' && /does not exist/.test(e.message));
  const plain = await mkdtemp(join(tmpdir(), 'worca-cc-wsdb-plain-'));
  created.push(plain);
  await assert.rejects(() => addWorkspaceMembers(ws.id, [plain]), (e) => e.code === 'BAD_REQUEST' && /not a git repository/.test(e.message));
  await assert.rejects(() => addWorkspaceMembers('wks-ghost-00000000', [a]), (e) => e.code === 'NOT_FOUND');
  assert.equal((await readWorkspace(ws.id)).projectPaths.length, 2, 'nothing written on a refusal');
});

test('addWorkspaceMembers / removeWorkspaceMember refuse a set another workspace already has (DUPLICATE_SET)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const pair = await createWorkspace({ name: 'Pair', projectPaths: [a, b] });
  const trio = await createWorkspace({ name: 'Trio', projectPaths: [a, b, c] });
  await checkRows([
    { name: 'addWorkspaceMembers refuses a set another workspace already has (DUPLICATE_SET)', run: async () => {
      await assert.rejects(() => addWorkspaceMembers(pair.id, [c]), (e) => e.code === 'DUPLICATE_SET');
    } },
    { name: 'removeWorkspaceMember refuses a set another workspace already has (DUPLICATE_SET)', run: async () => {
      await assert.rejects(() => removeWorkspaceMember(trio.id, c), (e) => e.code === 'DUPLICATE_SET');
    } },
  ]);
});

test('removeWorkspaceMember drops one member, keeps the id, refuses going below 2', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const ws = await createWorkspace({ name: 'Shrink', projectPaths: [a, b, c] });
  const up = await removeWorkspaceMember(ws.id, b);
  assert.equal(up.id, ws.id);
  assert.deepEqual([...up.projectPaths].sort(), [a, c].sort());
  assert.deepEqual([...(await readWorkspace(ws.id)).projectPaths].sort(), [a, c].sort(), 'persisted');
  await assert.rejects(() => removeWorkspaceMember(ws.id, a), (e) => e.code === 'BAD_REQUEST' && /at least 2/.test(e.message));
  await assert.rejects(() => removeWorkspaceMember(ws.id, b), (e) => e.code === 'BAD_REQUEST' && /not a member/.test(e.message));
  await assert.rejects(() => removeWorkspaceMember('wks-ghost-00000000', a), (e) => e.code === 'NOT_FOUND');
});

test('removeWorkspaceMember works for a member that vanished from disk', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const ws = await createWorkspace({ name: 'Gone', projectPaths: [a, b, c] });
  await rm(c, { recursive: true, force: true });
  const up = await removeWorkspaceMember(ws.id, c);
  assert.deepEqual([...up.projectPaths].sort(), [a, b].sort());
});

test('removeWorkspaceMember clears the metrics / policy home it removes; other homes stay', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const ws = await createWorkspace({ name: 'Homes', projectPaths: [a, b, c], metricsProject: a, policyProject: b });
  const up = await removeWorkspaceMember(ws.id, a);
  assert.equal(up.metricsProject, null, 'the removed metrics home is cleared');
  assert.equal(up.policyProject, b, 'the policy home is untouched');
  const again = await removeWorkspaceMember((await addWorkspaceMembers(ws.id, [a])).id, b);
  assert.equal(again.policyProject, null, 'the removed policy home is cleared');
  assert.equal((await readWorkspace(ws.id)).policyProject, null, 'persisted');
});

test('a finished workspace run keeps reading its own primary member after the member set changes', async () => {
  const { seedWorkspacePipeline } = await import('./helpers/db-seed.mjs');
  const { listWorkspacePipelines } = await import('../src/core/artifacts.mjs');
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const ws = await createWorkspace({ name: 'History', projectPaths: [a, b] });
  const primary = ws.projectPaths[0];
  spawnSync('git', ['branch', 'worca/feature-x'], { cwd: primary });
  const projects = ws.projectKeys.map((k, i) => ({ projectKey: k, projectDir: ws.projectPaths[i], projectName: 'm' }));
  await seedWorkspacePipeline(primary, ws.id, {
    title: 'old run', status: 'done', projects, branch: { feature: 'worca/feature-x', source: 'main' },
  }, projects);
  // The live registry's primary may now be another member (projectPaths re-sort by key):
  // the run's branch lives only in ITS primary, which the history row must still read.
  await addWorkspaceMembers(ws.id, [c]);
  const [row] = await listWorkspacePipelines(ws.id, c);
  assert.equal(row.survived, true, 'the branch is found in the run\'s own primary, not the live one');
});

test('createWorkspace refuses cleanly when its key is still held by a workspace whose set changed since', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const first = await createWorkspace({ name: 'Same Name', projectPaths: [a, b] });
  await addWorkspaceMembers(first.id, [c]);
  // "Same-Name" is a different name (the NOCASE guard passes) with the same slug, over the
  // first workspace's ORIGINAL set: the same key — a coded refusal, never a raw PK error.
  await assert.rejects(
    () => createWorkspace({ name: 'Same-Name', projectPaths: [a, b] }),
    (e) => e.code === 'DUPLICATE_NAME' && /choose another name/.test(e.message),
  );
});

// ---- a member change and the stored workspace map (schema v40) ----

async function threeMemberMapped(name) {
  const { sampleMap, DISPLAYS } = await import('./helpers/wsmap-stored.mjs');
  const { saveWorkspaceScanResult, addWorkspaceManualEdge } = await import('../src/core/workspaces.mjs');
  const [a, b, c] = [await freshRepo(), await freshRepo(), await freshRepo()];
  const ws = await createWorkspace({ name, projectPaths: [a, b, c] });
  const key = (p) => ws.projectKeys[ws.projectPaths.indexOf(p)];
  // Every scanned edge: a uses c. A manual edge b uses c, and one a uses b.
  const { map, synthesis } = sampleMap({ keys: [key(a), key(c)], names: ['a', 'c'], name });
  map.members.push({ ...map.members[0], key: key(b), name: 'b' });
  await saveWorkspaceScanResult(ws.id, { map, synthesis: { ...synthesis, roles: { [key(c)]: 'the c role' } } });
  await addWorkspaceManualEdge(ws.id, { from: key(b), to: key(c), kind: 'http', display: 'zz-manual-b-to-c' });
  await addWorkspaceManualEdge(ws.id, { from: key(a), to: key(b), kind: 'http', display: 'zz-manual-a-to-b' });
  return { ws, a, b, c, key, DISPLAYS };
}

test('removeWorkspaceMember takes the member out of the stored map and its reviews, and re-renders a generated description', async () => {
  const { readWorkspaceMap } = await import('../src/core/workspaces.mjs');
  const { ws, c, key, DISPLAYS } = await threeMemberMapped('Mapped Remove');
  const before = await readWorkspace(ws.id);
  assert.match(before.description, new RegExp(DISPLAYS.http.replace(/[{}]/g, '.')), 'the scanned edge is rendered before');
  const up = await removeWorkspaceMember(ws.id, c);
  const stored = await readWorkspaceMap(ws.id);
  assert.equal(stored.map.members.some((m) => m.key === key(c)), false, 'no longer a map member');
  assert.equal(stored.map.edges.some((e) => e.from === key(c) || e.to === key(c)), false, 'no edge names it');
  assert.equal(JSON.stringify(stored.map.order).includes(key(c)), false, 'not in the change order');
  assert.equal(key(c) in (stored.synthesis.roles || {}), false, 'its role is gone');
  assert.deepEqual(stored.overrides.manual.map((m) => m.display), ['zz-manual-a-to-b'], 'manual edges naming it are gone, others kept');
  assert.equal(up.descriptionOrigin, 'generated');
  assert.doesNotMatch(up.description, /zz-invoices|zz-manual-b-to-c/, 're-rendered without it');
  assert.match(up.description, /zz-manual-a-to-b/, 'the kept manual edge is still rendered');
});

test('removeWorkspaceMember leaves a hand-edited description alone (D8), but still prunes the map', async () => {
  const { readWorkspaceMap } = await import('../src/core/workspaces.mjs');
  const { ws, c, key } = await threeMemberMapped('Mapped Edited');
  await updateWorkspace(ws.id, { description: 'my own words about c' });
  const up = await removeWorkspaceMember(ws.id, c);
  assert.equal(up.description, 'my own words about c');
  assert.equal(up.descriptionOrigin, 'edited');
  assert.equal((await readWorkspaceMap(ws.id)).map.members.some((m) => m.key === key(c)), false);
});

test('addWorkspaceMembers keeps the stored map as it is (the new member has no edges until a re-scan)', async () => {
  const { readWorkspaceMap } = await import('../src/core/workspaces.mjs');
  const { ws } = await threeMemberMapped('Mapped Add');
  const before = await readWorkspaceMap(ws.id);
  const d = await freshRepo();
  await addWorkspaceMembers(ws.id, [d]);
  assert.deepEqual(await readWorkspaceMap(ws.id), before);
});

test('addWorkspaceMembers stops at 40 members: 40 is fine, the 41st is refused and nothing is written', async () => {
  const { WORKSPACE_MAX_PROJECTS } = await import('../src/shared/workspace-size.mjs');
  assert.equal(WORKSPACE_MAX_PROJECTS, 40);
  const ws = await createWorkspace({ name: 'Crowd', projectPaths: [await freshRepo(), await freshRepo()] });
  const more = [];
  for (let i = 0; i < WORKSPACE_MAX_PROJECTS - 2; i++) more.push(await freshRepo());
  assert.equal((await addWorkspaceMembers(ws.id, more)).projectPaths.length, 40);
  const extra = await freshRepo();
  await assert.rejects(() => addWorkspaceMembers(ws.id, [extra]),
    (e) => e.code === 'BAD_REQUEST' && /at most 40 member projects \(41 after this change\)/.test(e.message));
  assert.equal((await readWorkspace(ws.id)).projectPaths.length, 40, 'nothing written on a refusal');
});

test('removeWorkspaceMember keeps the free-text coordination notes and drops the cycles that named the member', async () => {
  const { readWorkspaceMap, saveWorkspaceScanResult } = await import('../src/core/workspaces.mjs');
  const { ws, a, c, key } = await threeMemberMapped('Mapped Notes');
  const cur = await readWorkspaceMap(ws.id);
  const map = { ...cur.map, cycles: [[key(a), key(c)].sort()], order: [[key(a), key(c)].sort(), [ws.projectKeys.find((k) => k !== key(a) && k !== key(c))]] };
  const synthesis = { ...cur.synthesis, coordination: [`Ship ${key(c)} before the others.`, 'Release together.'] };
  await saveWorkspaceScanResult(ws.id, { map, synthesis });
  await removeWorkspaceMember(ws.id, c);
  const stored = await readWorkspaceMap(ws.id);
  assert.deepEqual(stored.synthesis.coordination, synthesis.coordination, 'free text: kept until the next scan');
  assert.deepEqual(stored.map.cycles, [], 'the cycle through the member is gone');
  assert.equal(JSON.stringify(stored.map.order).includes(key(c)), false);
  assert.ok(stored.map.order.every((layer) => layer.length), 'no empty layer left behind');
});

/** Run fn with a `git` on PATH that logs each call, then runs the real git. Returns [result, calls]. */
async function countingGit(fn) {
  const { mkdtemp: mk, writeFile: wf, chmod, readFile } = await import('node:fs/promises');
  const real = spawnSync('sh', ['-c', 'command -v git']).stdout.toString().trim();
  const bin = await mk(join(tmpdir(), 'worca-cc-wsdb-gitshim-'));
  created.push(bin);
  const log = join(bin, 'calls.log');
  await wf(log, '');
  await wf(join(bin, 'git'), `#!/bin/sh\necho "$*" >> "${log}"\nexec "${real}" "$@"\n`);
  await chmod(join(bin, 'git'), 0o755);
  const prev = process.env.PATH;
  process.env.PATH = `${bin}:${prev}`;
  let out;
  try { out = await fn(); } catch (e) { out = e; } finally { process.env.PATH = prev; }
  return [out, (await readFile(log, 'utf8')).split('\n').filter(Boolean)];
}

test('addWorkspaceMembers refuses an oversized add before spawning git for any path', { skip: process.platform === 'win32' }, async () => {
  const ws = await createWorkspace({ name: 'Flood', projectPaths: [await freshRepo(), await freshRepo()] });
  const { mkdirSync } = await import('node:fs');
  const flood = await mkdtemp(join(tmpdir(), 'worca-cc-wsdb-flood-'));
  created.push(flood);
  const many = Array.from({ length: 200 }, (_, i) => join(flood, `d${i}`));
  for (const d of many) mkdirSync(d);   // real directories: git runs (and fails) in each
  const [e, calls] = await countingGit(() => addWorkspaceMembers(ws.id, many));
  assert.equal(e && e.code, 'BAD_REQUEST');
  assert.match(e.message, /at most 40 member projects/);
  assert.equal(calls.length, 0, `no git before the size check (${calls.length} calls)`);
});

test('removeWorkspaceMember re-derives the change order and cycles from the edges left; the order notes go with the old order', async () => {
  const { readWorkspaceMap, saveWorkspaceScanResult, addWorkspaceManualEdge } = await import('../src/core/workspaces.mjs');
  const { ws, a, b, c, key } = await threeMemberMapped('Mapped Cycle');
  const cur = await readWorkspaceMap(ws.id);
  await saveWorkspaceScanResult(ws.id, { map: cur.map, synthesis: { ...cur.synthesis, orderNotes: `Ship ${key(c)} first.` } });
  // With the manual a->b, b->c and the scanned a->c: add b->a and c->b — one cycle over all three.
  await addWorkspaceManualEdge(ws.id, { from: key(b), to: key(a), kind: 'http', display: 'zz-manual-b-to-a' });
  await addWorkspaceManualEdge(ws.id, { from: key(c), to: key(b), kind: 'http', display: 'zz-manual-c-to-b' });
  await removeWorkspaceMember(ws.id, c);
  const stored = await readWorkspaceMap(ws.id);
  const pair = [key(a), key(b)].sort();
  assert.deepEqual(stored.map.cycles, [pair], 'a and b still depend on each other: still a cycle');
  assert.deepEqual(stored.map.order, [pair]);
  assert.equal(stored.synthesis.orderNotes, '', 'the notes described the order before the member left');
});
