// v30: workspaces.metrics_project (team-metrics home). The fresh-DB path, the
// self-heal path (stamped current, column missing), and the ladder path (stamped
// v29, column missing). Modelled on test/db-migrate-v29.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db) => db.prepare('PRAGMA table_info(workspaces)').all().map((c) => c.name);

test('v30 adds nullable workspaces.metrics_project on a fresh DB', () => {
  assert.ok(SCHEMA_VERSION >= 30);
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(cols(db).includes('metrics_project'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  db.close();
});

test('self-heal: stamped past current, missing metrics_project, is ALTERed and not re-stamped', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`CREATE TABLE workspaces_old AS SELECT id, name, description, created_at, updated_at FROM workspaces;
           DROP TABLE workspaces; ALTER TABLE workspaces_old RENAME TO workspaces; PRAGMA user_version = ${SCHEMA_VERSION + 1};`);
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION + 1);
  assert.ok(cols(db).includes('metrics_project'));
  db.close();
});

test('a v29-stamped DB without the column is healed (ladder)', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`CREATE TABLE workspaces_old AS SELECT id, name, description, created_at, updated_at FROM workspaces;
           DROP TABLE workspaces; ALTER TABLE workspaces_old RENAME TO workspaces; PRAGMA user_version = 29;`);
  assert.ok(!cols(db).includes('metrics_project'));
  migrate(db);
  assert.ok(cols(db).includes('metrics_project'));
  db.close();
});
