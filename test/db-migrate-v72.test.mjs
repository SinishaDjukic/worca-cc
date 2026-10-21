// test/db-migrate-v72.test.mjs — v72 = pipeline_commands.result (switch-models answers). An INCREMENTAL_COLUMNS
// entry: a v71 DB without the column gains it on open through the hoisted repairSchemaGaps (no ladder step).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, SCHEMA_VERSION, _resetForTests } from '../src/core/db.mjs';

useTempHome(after);
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);

test('a DB stamped 71 without pipeline_commands.result gains it; user_version reads SCHEMA_VERSION', () => {
  let db = getDb();
  assert.ok(SCHEMA_VERSION >= 72);
  assert.ok(cols(db, 'pipeline_commands').includes('result'), 'a fresh DB has it');
  db.exec('ALTER TABLE pipeline_commands DROP COLUMN result');
  db.exec('PRAGMA user_version = 71');
  _resetForTests();
  db = getDb();
  assert.ok(cols(db, 'pipeline_commands').includes('result'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
});
