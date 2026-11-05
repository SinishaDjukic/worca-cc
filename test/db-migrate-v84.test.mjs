// test/db-migrate-v84.test.mjs — config_workflow_nodes.roles: a project's per-role model picks for a role-review node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('fresh DB: config_workflow_nodes.roles exists', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 84);
  assert.ok(cols(db, 'config_workflow_nodes').includes('roles'));
});

test('a DB stamped 83 without it gets it, keeps a seeded row\'s model, and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('ALTER TABLE config_workflow_nodes DROP COLUMN roles; PRAGMA user_version = 83');
  db.exec("INSERT INTO config_workflow_nodes (project_key, workflow_id, node_id, model) VALUES ('p', 'wf_x', 'n_rev', 'claude-opus-5-5')");
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'config_workflow_nodes').includes('roles'));
  const row = db.prepare('SELECT model, roles FROM config_workflow_nodes').get();
  assert.deepEqual({ ...row }, { model: 'claude-opus-5-5', roles: null });
});

test('a DB stamped current without the column is healed, its stamp untouched', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`ALTER TABLE config_workflow_nodes DROP COLUMN roles; PRAGMA user_version = ${SCHEMA_VERSION}`);
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION, 'stamp untouched');
  assert.ok(cols(db, 'config_workflow_nodes').includes('roles'), 'roles healed');
});
