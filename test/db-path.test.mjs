// test/db-path.test.mjs — the database's location: under worca's home, or in WORCA_DB_DIR (its own
// volume where the home is a shared network volume); and WORCA_NO_DB, the guard in a worker.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { dbPath, getDb, _resetForTests } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';

const home = useTempHome(after);
const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };

test('dbPath is <worcaHome>/worca-cc.db by default and <WORCA_DB_DIR>/worca-cc.db when set', () => {
  const prev = process.env.WORCA_DB_DIR;
  try {
    delete process.env.WORCA_DB_DIR;
    assert.equal(dbPath(), join(worcaHome(), 'worca-cc.db'));
    process.env.WORCA_DB_DIR = join(home, 'db-volume');
    assert.equal(dbPath(), resolve(home, 'db-volume', 'worca-cc.db'));
  } finally { restore('WORCA_DB_DIR', prev); }
});

test('getDb creates WORCA_DB_DIR and opens the database there, nothing under the home', () => {
  const prev = process.env.WORCA_DB_DIR;
  const dir = join(home, 'db-volume');
  try {
    process.env.WORCA_DB_DIR = dir;
    _resetForTests();
    const db = getDb();
    assert.ok(db);
    assert.ok(existsSync(join(dir, 'worca-cc.db')));
    assert.equal(existsSync(join(worcaHome(), 'worca-cc.db')), false);
  } finally { _resetForTests(); restore('WORCA_DB_DIR', prev); }
});

test('WORCA_NO_DB refuses to open the database at all', () => {
  const prev = process.env.WORCA_NO_DB;
  try {
    _resetForTests();
    process.env.WORCA_NO_DB = '1';
    assert.throws(() => getDb(), /never opens the database/);
  } finally { _resetForTests(); restore('WORCA_NO_DB', prev); }
});
