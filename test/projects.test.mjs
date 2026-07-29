// test/projects.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import {
  addProject,
  removeProject,
  listProjects,
  normalizeProjectPath,
} from '../src/core/projects.mjs';
import { _resetForTests } from '../src/core/db.mjs';

const created = [];
async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-home-'));
  created.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
  return dir;
}
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});

test('add then list returns the entry, flagged existing', async () => {
  const home = await freshHome();
  const list = await addProject({ name: 'demo', path: home });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'demo');
  assert.equal(list[0].path, home);
  assert.equal(list[0].exists, true);
  assert.deepEqual(await listProjects(), list);
});

test('duplicate name is rejected (case-insensitive)', async () => {
  const home = await freshHome();
  await addProject({ name: 'Demo', path: home });
  await assert.rejects(() => addProject({ name: 'demo', path: home }), /already exists/);
});

test('remove drops the entry; removing an absent name is a no-op', async () => {
  const home = await freshHome();
  await addProject({ name: 'demo', path: home });
  let list = await removeProject('demo');
  assert.deepEqual(list, []);
  list = await removeProject('nope'); // no-op
  assert.deepEqual(list, []);
});

test('a path that is a file is rejected', async () => {
  const home = await freshHome();
  const file = join(home, 'afile.txt');
  await writeFile(file, 'x', 'utf8');
  await assert.rejects(() => addProject({ name: 'f', path: file }), /not a directory/);
});

test('a non-existent path is accepted and flagged missing', async () => {
  await freshHome();
  const list = await addProject({ name: 'ghost', path: '/no/such/dir/here' });
  assert.equal(list[0].exists, false);
});

test('missing registry file yields an empty list', async () => {
  await freshHome();
  assert.deepEqual(await listProjects(), []);
});

test('an empty registry yields an empty list (never throws)', async () => {
  await freshHome();
  // No JSON file exists under SQLite; a fresh home simply has no project rows.
  assert.deepEqual(await listProjects(), []);
});

test('leading ~ in a path is expanded', () => {
  const out = normalizeProjectPath('~/somewhere');
  assert.equal(out, join(process.env.HOME || homedir(), 'somewhere'));
});
