// test/workspace-map-store.test.mjs
// Workspace map storage (schema v40) in src/core/workspaces.mjs: the list carries mapSummary +
// descriptionOrigin but never the map; saveWorkspaceScanResult stores map + a CHECKED synthesis
// (credentials redacted, D21), marks the description 'generated' and re-renders it from the map;
// a CHANGED description through updateWorkspace marks it 'edited', and updateWorkspace re-reads
// under its write lock (a save from another process is never reverted);
// regenerateWorkspaceDescription re-renders on demand.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { sampleMap, DISPLAYS } from './helpers/wsmap-stored.mjs';
import { dbPath, prepare } from '../src/core/db.mjs';
import {
  createWorkspace, listWorkspaces, readWorkspace, updateWorkspace, renameWorkspace,
  readWorkspaceMap, saveWorkspaceScanResult, regenerateWorkspaceDescription, graphLineFor, isWorkspaceMap,
} from '../src/core/workspaces.mjs';

useTempHome(after);
const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));

async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wsmap-'));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}
let seq = 0;
/** A 2-member workspace + a sample map over its real member keys. */
async function scannedWorkspace() {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: `Map WS ${++seq}`, projectPaths: [a, b], description: 'hand notes' });
  const sample = sampleMap({ keys: ws.projectKeys, names: ws.projectPaths.map((p) => basename(p)), name: ws.name });
  return { ws, ...sample };
}
/** A second process: takes the write lock, says so, holds it for `holdMs`, then writes what a
 *  scan's finalize without a map would — the description, origin 'generated', no map (a scan
 *  resumed from the CLI runs in its own process). It talks to the DB file with node:sqlite
 *  directly — never db.mjs, so it migrates nothing. */
const OTHER_PROCESS = `
import { DatabaseSync } from 'node:sqlite';
import { writeSync } from 'node:fs';
const [dbFile, id, text, holdMs] = process.argv.slice(1);
const db = new DatabaseSync(dbFile);
db.exec('PRAGMA busy_timeout = 5000');
db.exec('BEGIN IMMEDIATE');
writeSync(1, 'locked\\n');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(holdMs));
db.prepare("UPDATE workspaces SET description = ?, description_origin = 'generated', map_json = NULL WHERE id = ?").run(text, id);
db.exec('COMMIT');
db.close();
`;

test('a new workspace has no map: mapSummary null, origin null, readWorkspaceMap empty', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Plain', projectPaths: [a, b] });
  assert.equal(ws.mapSummary, null);
  assert.equal(ws.descriptionOrigin, null);
  const stored = await readWorkspaceMap(ws.id);
  assert.equal(stored.map, null);
  assert.equal(stored.synthesis, null);
  assert.deepEqual(stored.overrides, { version: 1, edges: {}, manual: [] });
  assert.equal(stored.descriptionOrigin, null);
  assert.equal(await readWorkspaceMap('wks-nope-00000000'), null);
});

test('saveWorkspaceScanResult stores map + synthesis, renders the description from the map, origin generated', async () => {
  const { ws, map, synthesis } = await scannedWorkspace();
  const saved = await saveWorkspaceScanResult(ws.id, { description: 'IGNORED when a map is given', map, synthesis });
  assert.equal(saved.descriptionOrigin, 'generated');
  assert.doesNotMatch(saved.description, /IGNORED/);
  assert.match(saved.description, new RegExp(`^# Workspace: ${ws.name}`));
  for (const d of Object.values(DISPLAYS)) assert.ok(saved.description.includes(d), d);
  const stored = await readWorkspaceMap(ws.id);
  assert.deepEqual(stored.map, map);
  assert.deepEqual(stored.synthesis, synthesis);
  assert.equal(stored.descriptionOrigin, 'generated');
  assert.equal((await readWorkspace(ws.id)).description, saved.description);
});

test('saveWorkspaceScanResult without a map saves the given description and clears the stored map', async () => {
  const { ws, map, synthesis } = await scannedWorkspace();
  await saveWorkspaceScanResult(ws.id, { description: 'x', map, synthesis });
  const saved = await saveWorkspaceScanResult(ws.id, { description: '# Workspace: prose only\n', map: null });
  assert.equal(saved.description, '# Workspace: prose only\n');
  assert.equal(saved.descriptionOrigin, 'generated');
  assert.equal(saved.mapSummary, null);
  assert.equal((await readWorkspaceMap(ws.id)).map, null);
  await assert.rejects(saveWorkspaceScanResult('wks-nope-00000000', { description: 'x' }), (e) => e.code === 'NOT_FOUND');
});

test('saveWorkspaceScanResult stores a CHECKED synthesis: invalid items dropped, credentials redacted (D21)', async () => {
  const { ws, map } = await scannedWorkspace();
  const synthesis = {
    version: 1,
    overview: 'Billing reads DATABASE_URL=postgres://app:s3cr3t@db:5432/billing at boot.',
    roles: { [ws.projectKeys[0]]: 'Signs requests with API_TOKEN=abc123', 'not-a-member-00000000': 'dropped' },
    coordination: ['Rotate API_TOKEN=abc123 first.', 42],
    orderNotes: 'password: hunter2',
  };
  await saveWorkspaceScanResult(ws.id, { map, synthesis });
  const row = prepare('SELECT map_json, description FROM workspaces WHERE id = ?').get(ws.id);
  for (const secret of ['s3cr3t', 'abc123', 'hunter2']) {
    assert.ok(!row.map_json.includes(secret), `map_json carries ${secret}`);
    assert.ok(!row.description.includes(secret), `the description carries ${secret}`);
  }
  const stored = (await readWorkspaceMap(ws.id)).synthesis;
  assert.match(stored.overview, /postgres:\/\/\*\*\*@db:5432\/billing/);
  assert.deepEqual(stored.roles, { [ws.projectKeys[0]]: 'Signs requests with API_TOKEN=***' }, 'a role for a non-member is dropped');
  assert.deepEqual(stored.coordination, ['Rotate API_TOKEN=*** first.'], 'a note that is not a string is dropped');
  assert.equal(stored.orderNotes, 'password: ***');
});

test('the list carries mapSummary and descriptionOrigin, never the map, synthesis or overrides', async () => {
  const { ws, map, synthesis } = await scannedWorkspace();
  await saveWorkspaceScanResult(ws.id, { map, synthesis });
  const listed = (await listWorkspaces()).find((w) => w.id === ws.id);
  assert.equal(listed.descriptionOrigin, 'generated');
  assert.equal(listed.mapSummary.members, 2);
  assert.equal(listed.mapSummary.edges, 3);
  assert.equal(listed.mapSummary.scannedAt, map.scannedAt);
  for (const k of ['map', 'map_json', 'mapDoc', 'synthesis', 'overrides', 'map_overrides_json']) {
    assert.ok(!(k in listed), `list entry must not carry ${k}`);
  }
});

test('a CHANGED description through updateWorkspace marks it edited; an unchanged save or a rename does not', async () => {
  const { ws, map, synthesis } = await scannedWorkspace();
  const saved = await saveWorkspaceScanResult(ws.id, { map, synthesis });
  assert.equal((await updateWorkspace(ws.id, { description: saved.description })).descriptionOrigin, 'generated', 'unchanged text');
  assert.equal((await renameWorkspace(ws.id, `${ws.name} renamed`)).descriptionOrigin, 'generated', 'rename');
  const edited = await updateWorkspace(ws.id, { description: 'my own words' });
  assert.equal(edited.descriptionOrigin, 'edited');
  assert.equal((await readWorkspaceMap(ws.id)).descriptionOrigin, 'edited');
});

test('a rename racing a scan save in ANOTHER process keeps that save (updateWorkspace re-reads under the lock)', async () => {
  const { ws, map, synthesis } = await scannedWorkspace();
  await saveWorkspaceScanResult(ws.id, { map, synthesis });
  await updateWorkspace(ws.id, { description: 'my own words' });   // origin 'edited' before the other process's save flips it back
  const TEXT = '# Workspace: saved by another process';
  const child = spawn(process.execPath,
    ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', OTHER_PROCESS, dbPath(), ws.id, TEXT, '1000'],
    { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise((res) => child.on('exit', res));
  await new Promise((res, rej) => {
    child.stdout.on('data', (d) => { if (String(d).includes('locked')) res(); });
    child.on('error', rej);
    child.on('exit', (code) => rej(new Error(`the other process ended before taking the lock (exit ${code})`)));
  });
  // Our read happens while the other process holds the lock uncommitted; our write waits for it.
  const renamed = await updateWorkspace(ws.id, { name: `${ws.name} renamed` });
  assert.equal(await exited, 0);
  assert.equal(renamed.description, TEXT);
  const now = await readWorkspace(ws.id);
  assert.equal(now.description, TEXT, 'the other process\'s save survives the rename');
  assert.equal(now.name, `${ws.name} renamed`);
  assert.equal(now.descriptionOrigin, 'generated');
});

test('a rename re-renders a generated description with a map (its title line); a hand-edited one is kept', async () => {
  const { ws, map, synthesis } = await scannedWorkspace();
  await saveWorkspaceScanResult(ws.id, { map, synthesis });
  const renamed = await renameWorkspace(ws.id, `${ws.name} v2`);
  assert.match(renamed.description, new RegExp(`^# Workspace: ${ws.name} v2\\n`));
  assert.ok(renamed.description.includes(DISPLAYS.http), 'the rest is the same render');
  assert.equal(renamed.descriptionOrigin, 'generated');
  assert.equal((await readWorkspace(ws.id)).description, renamed.description);
  await updateWorkspace(ws.id, { description: 'my own words' });
  const again = await renameWorkspace(ws.id, `${ws.name} v3`);
  assert.equal(again.description, 'my own words', 'a hand edit is never re-rendered');
  assert.equal(again.descriptionOrigin, 'edited');
});

test('regenerateWorkspaceDescription re-renders a hand-edited description and marks it generated; no map -> BAD_REQUEST', async () => {
  const { ws, map, synthesis } = await scannedWorkspace();
  await saveWorkspaceScanResult(ws.id, { map, synthesis });
  await updateWorkspace(ws.id, { description: 'my own words' });
  const regen = await regenerateWorkspaceDescription(ws.id);
  assert.equal(regen.descriptionOrigin, 'generated');
  assert.ok(regen.description.includes(DISPLAYS.http));
  assert.doesNotMatch(regen.description, /my own words/);

  const a = await freshRepo();
  const b = await freshRepo();
  const bare = await createWorkspace({ name: 'Bare', projectPaths: [a, b], description: 'prose' });
  await assert.rejects(regenerateWorkspaceDescription(bare.id), (e) => e.code === 'BAD_REQUEST');
  assert.equal((await readWorkspace(bare.id)).description, 'prose');
  await assert.rejects(regenerateWorkspaceDescription('wks-nope-00000000'), (e) => e.code === 'NOT_FOUND');
});

test('corrupt map_json / map_overrides_json read as no map / empty overrides, never a throw', async () => {
  const { ws, map, synthesis } = await scannedWorkspace();
  await saveWorkspaceScanResult(ws.id, { map, synthesis });
  prepare('UPDATE workspaces SET map_json = ?, map_overrides_json = ?, description_origin = ? WHERE id = ?')
    .run('{"map": {"members": 3', 'not json', 'bogus', ws.id);
  const listed = (await listWorkspaces()).find((w) => w.id === ws.id);
  assert.equal(listed.mapSummary, null);
  assert.equal(listed.descriptionOrigin, null);
  const stored = await readWorkspaceMap(ws.id);
  assert.equal(stored.map, null);
  assert.deepEqual(stored.overrides, { version: 1, edges: {}, manual: [] });
});

test('graphLineFor names an absolute graph file only; isWorkspaceMap needs members[] and edges[]', () => {
  const abs = join(tmpdir(), 'workspace-graph.json');
  assert.equal(graphLineFor({ graph: { file: abs } }), `Cross-project graph: ${abs} — graphify query "<question>" --graph "${abs}"`);
  assert.equal(graphLineFor({ graph: { file: 'workspace-graph.json' } }), null);
  assert.equal(graphLineFor({ graph: { file: null } }), null);
  assert.equal(graphLineFor(null), null);
  assert.equal(isWorkspaceMap({ members: [], edges: [] }), true);
  for (const bad of [null, [], 'x', { members: [] }, { edges: [] }]) assert.equal(isWorkspaceMap(bad), false);
});
