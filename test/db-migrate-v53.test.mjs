// test/db-migrate-v53.test.mjs — v53 = ask_threads.engine (#635, the engine an Ask chat is locked to). An INCREMENTAL_COLUMNS
// entry: a v52 DB without the column gains it on open through the hoisted repairSchemaGaps (no ladder step).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, SCHEMA_VERSION, _resetForTests } from '../src/core/db.mjs';

useTempHome(after);
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);

test('a DB stamped 52 without ask_threads.engine gains it; user_version reads the current version', () => {
  let db = getDb();
  assert.ok(SCHEMA_VERSION >= 53);
  db.exec('ALTER TABLE ask_threads DROP COLUMN engine');
  db.exec('PRAGMA user_version = 52');
  assert.ok(!cols(db, 'ask_threads').includes('engine'));
  _resetForTests();
  db = getDb();
  assert.ok(cols(db, 'ask_threads').includes('engine'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
});
