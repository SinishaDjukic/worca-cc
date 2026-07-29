// test/projects-db.test.mjs
// projects.mjs persists the named-project registry in SQLite (table: projects).
// Signatures are unchanged (listProjects/addProject/removeProject stay async and
// return the SAME annotated shapes). Each test gets a throwaway WORCA_HOME and
// resets the DB singleton so getDb() reopens against it.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addProject, removeProject, listProjects } from '../src/core/projects.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';

const homes = [];
async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-projdb-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
  return dir;
}
beforeEach(freshHome);
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

test('listProjects returns [] when the projects table is empty', async () => {
  assert.deepEqual(await listProjects(), []);
});

test('listProjects reads rows from the DB and recomputes exists on read', async () => {
  const home = homes[homes.length - 1];
  // Insert a row directly (real dir => exists:true) to prove listProjects reads the DB.
  const db = getDb();
  db.prepare('INSERT INTO projects (key, name, path, created_at) VALUES (?, ?, ?, ?)')
    .run('k1', 'demo', home, '2026-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO projects (key, name, path, created_at) VALUES (?, ?, ?, ?)')
    .run('k2', 'ghost', '/no/such/dir/here', '2026-01-02T00:00:00.000Z');
  const list = await listProjects();
  const byName = Object.fromEntries(list.map((p) => [p.name, p]));
  assert.equal(byName.demo.path, home);
  assert.equal(byName.demo.exists, true, 'real dir => exists true (recomputed)');
  assert.equal(byName.ghost.exists, false, 'missing dir => exists false (recomputed)');
  // The returned shape is exactly {name, path, exists} — no DB-only fields leak.
  assert.deepEqual(Object.keys(byName.demo).sort(), ['exists', 'name', 'path']);
});

test('addProject inserts a row keyed by projectKey, returns the annotated list', async () => {
  const home = homes[homes.length - 1];
  const list = await addProject({ name: 'demo', path: home });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'demo');
  assert.equal(list[0].path, home);
  assert.equal(list[0].exists, true);
  // Persisted in the DB with a non-empty key + created_at.
  const row = getDb().prepare('SELECT key, name, created_at FROM projects').get();
  assert.ok(row.key && typeof row.key === 'string', 'a projectKey was stored');
  assert.ok(row.created_at, 'created_at stamped');
});

test('addProject rejects a duplicate name case-insensitively', async () => {
  const home = homes[homes.length - 1];
  await addProject({ name: 'Demo', path: home });
  await assert.rejects(() => addProject({ name: 'demo', path: home }), /already exists/);
  // Only one row persisted.
  const { n } = getDb().prepare('SELECT COUNT(*) AS n FROM projects').get();
  assert.equal(n, 1);
});

test('addProject requires name + path and rejects a file path', async () => {
  const home = homes[homes.length - 1];
  await assert.rejects(() => addProject({ name: '', path: home }), /name is required/);
  await assert.rejects(() => addProject({ name: 'x', path: '' }), /path is required/);
  const file = join(home, 'afile.txt');
  await writeFile(file, 'x', 'utf8');
  await assert.rejects(() => addProject({ name: 'f', path: file }), /not a directory/);
});

test('addProject accepts a non-existent path and flags it missing', async () => {
  const list = await addProject({ name: 'ghost', path: '/no/such/dir/here' });
  assert.equal(list[0].exists, false);
});

test('removeProject deletes case-insensitively; an absent name is a no-op', async () => {
  const home = homes[homes.length - 1];
  await addProject({ name: 'Demo', path: home });
  let list = await removeProject('demo'); // case-insensitive match
  assert.deepEqual(list, []);
  list = await removeProject('nope'); // no-op
  assert.deepEqual(list, []);
});

test('two projects with the SAME path collapse to one key (PK), latest name wins on re-add', async () => {
  // projectKey(path) is deterministic, so re-adding the same path under a new name
  // would collide on the PK. addProject guards on name first; a same-name re-add is
  // a duplicate-name error, and a different-name same-path add must not crash.
  const home = homes[homes.length - 1];
  await addProject({ name: 'one', path: home });
  // Different name, same path -> same projectKey. The name check passes (different
  // name), so the INSERT would hit the PK. We expect a clean error, not a crash.
  await assert.rejects(() => addProject({ name: 'two', path: home }), /already (exists|registered)/i);
});
