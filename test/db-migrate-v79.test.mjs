// test/db-migrate-v79.test.mjs — run_groups.name_source (Add to group: Smart naming for run groups).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const fromStamp = (sql, stamp) => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${sql} PRAGMA user_version = ${stamp}`);
  migrate(db);
  return db;
};

test('a fresh DB has run_groups.name_source, default user', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 79);
  assert.ok(cols(db, 'run_groups').includes('name_source'));
  db.exec("INSERT INTO run_groups (id, title, created_at, updated_at) VALUES ('grp_1', 'A', 'x', 'x')");
  assert.equal(db.prepare("SELECT name_source FROM run_groups WHERE id = 'grp_1'").get().name_source, 'user');
});

test('a DB at 78 gets the column and keeps its groups', () => {
  const db = fromStamp("ALTER TABLE run_groups DROP COLUMN name_source; INSERT INTO run_groups (id, title, created_at, updated_at) VALUES ('grp_2', 'B', 'x', 'x');", 78);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare("SELECT name_source FROM run_groups WHERE id = 'grp_2'").get().name_source, 'user');
});

test('a DB with no run_groups table at all gets it back with the column (hoisted repair)', () => {
  const db = fromStamp('DROP TABLE run_group_members; DROP TABLE run_groups;', 78);
  assert.ok(cols(db, 'run_groups').includes('name_source'));
  assert.ok(cols(db, 'run_group_members').includes('position'));
});
