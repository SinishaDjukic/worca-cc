// test/settings-db.test.mjs
// Guard: settings.mjs stays the file-based bootstrap (no settings table exists),
// and db.mjs resolves its path through worcaHome() -> getWorcaRoot() with no
// import cycle. The ONLY setting is `root`, which must live in settings.json.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readSettings, getWorcaRoot, settingsFile } from '../src/core/settings.mjs';
import { getDb, _resetForTests, dbPath } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';

const homes = [];
async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-set-'));
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

test('readSettings still reads settings.json from the fixed bootstrap path', async () => {
  // settingsFile() is ALWAYS under defaultRoot()/.worca-cc (HOME), never the DB dir.
  // Point HOME at a temp dir so we can write a real settings.json without touching
  // the developer's home.
  const fakeHome = homes[homes.length - 1];
  const prevHome = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    await mkdir(join(fakeHome, '.worca-cc'), { recursive: true });
    await writeFile(settingsFile(), JSON.stringify({ root: '/some/root' }) + '\n', 'utf8');
    assert.equal(getWorcaRoot(), '/some/root', 'root is read from settings.json');
    assert.deepEqual(readSettings(), { root: '/some/root' });
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('db.mjs locates the file via worcaHome() with no import cycle', () => {
  // getDb() must open without throwing (proves settings.mjs -> projects.mjs ->
  // db.mjs -> projects.mjs -> settings.mjs resolves; a cycle would TDZ-throw here).
  const db = getDb();
  assert.ok(db, 'getDb() returns a handle (no cycle / TDZ error)');
  assert.equal(dbPath(), join(worcaHome(), 'worca-cc.db'), 'db path is under worcaHome()');
});

test('there is no settings table in the schema (root stays file-based)', () => {
  const db = getDb();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
    .get();
  assert.equal(row, undefined, 'no settings table — root lives only in settings.json');
});
