// test/db-migrate-v24-fresh.test.mjs
// D7: fresh installs keep Default only — the 7 seeds are inserted ONLY on a DB
// that existed before the break. A fresh file has nothing to back up either.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, dbPath, SCHEMA_VERSION } from '../src/core/db.mjs';

useTempHome(after);

test('a FRESH DB lands on V24 unseeded, with no backup file', () => {
  const db = getDb();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT count(*) AS n FROM workflows').get().n, 0, 'no seeds on a fresh install');
  assert.equal(existsSync(`${dbPath()}.pre-v24.bak`), false, 'nothing to back up');
  const meta = db.prepare("SELECT data FROM store_meta WHERE key = 'migration:v24'").get();
  assert.deepEqual(JSON.parse(meta.data).seeded, [], 'the report records an unseeded install');
});
