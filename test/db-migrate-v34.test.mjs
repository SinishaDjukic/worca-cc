// v34 (run chains): scheduled_runs.after_kind/after_id/after_policy/source_from_previous + the
// after_id index — added to a DB stamped 33 by the gap repair, present in a fresh DDL, and
// healed on a DB stamped past current. (test/db-migrate-v33.test.mjs is the money-saved
// human_hours migration — a different feature.)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, migrate, SCHEMA_VERSION, _resetForTests } from '../src/core/db.mjs';

useTempHome(after);

const AFTER_COLS = ['after_kind', 'after_id', 'after_policy', 'source_from_previous'];
const cols = (db) => db.prepare('PRAGMA table_info(scheduled_runs)').all().map((c) => c.name);
const hasAfterIndex = (db) => !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_scheduled_runs_after'").get();
// The index FIRST: SQLite refuses to drop a column an index names.
const dropAfter = (db) => {
  db.exec('DROP INDEX IF EXISTS idx_scheduled_runs_after');
  for (const c of AFTER_COLS) db.exec(`ALTER TABLE scheduled_runs DROP COLUMN ${c}`);
};

test('a DB stamped 33 (no after columns) gains the four columns and the index', () => {
  let db = getDb();
  assert.ok(SCHEMA_VERSION >= 34);
  dropAfter(db);
  db.exec('PRAGMA user_version = 33');
  _resetForTests();

  db = getDb();                                   // 33 -> 34 on the ladder (applySchemaV33 is skipped)
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const names = cols(db);
  for (const c of AFTER_COLS) assert.ok(names.includes(c), c);
  const pol = db.prepare('PRAGMA table_info(scheduled_runs)').all().find((c) => c.name === 'after_policy');
  assert.equal(pol.notnull, 1);
  assert.equal(String(pol.dflt_value).replace(/'/g, ''), 'done');
  assert.ok(hasAfterIndex(db));
});

// The fresh-DB idiom of test/db-migrate-v30.test.mjs: a REAL new database, not a reopen of
// the already-migrated home file (which would assert nothing).
test('a fresh DB has the four columns and the index from the DDL', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const names = cols(db);
  for (const c of AFTER_COLS) assert.ok(names.includes(c), c);
  assert.ok(hasAfterIndex(db));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  db.close();
});

// The self-heal path (reconcileSchema, the idiom of test/db-migrate-v33.test.mjs): stamped PAST
// current with the columns and the index missing — repairSchemaGaps must ALTER the columns
// before it creates the index, and must not re-stamp.
test('self-heal: stamped past current with the after columns and index missing, both come back', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  dropAfter(db);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION + 1);
  for (const c of AFTER_COLS) assert.ok(cols(db).includes(c), c);
  assert.ok(hasAfterIndex(db));
  db.close();
});

// A home missing a SIBLING table of the same DDL block: INCREMENTAL_TABLES maps schedules /
// scheduled_runs / notifications all to SCHEDULED_RUNS_DDL, so the tables loop re-execs the
// whole block, and its CREATE INDEX names after_id — the columns must be ALTERed in BEFORE
// that, not after (the plain tables -> columns -> indexes order still throws here).
test('a sibling table missing from the same DDL block: the re-run CREATE INDEX does not throw', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  dropAfter(db);
  db.exec('DROP TABLE notifications');
  db.exec('PRAGMA user_version = 33');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  for (const c of AFTER_COLS) assert.ok(cols(db).includes(c), c);
  assert.ok(hasAfterIndex(db));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notifications'").get(), 'the sibling is back');
  db.close();
});
