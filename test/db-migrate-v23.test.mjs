import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

useTempHome(after);

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const tableNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
const pkOrder = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all()
  .filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
const MINIMAL_SEED = `
  CREATE TABLE pipelines (id TEXT PRIMARY KEY);
  CREATE TABLE pipeline_steps (pipeline_id TEXT);
  CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
`;

test('V23 is the current schema version and a fresh DB carries every new column', () => {
  const db = getDb();
  assert.ok(SCHEMA_VERSION >= 23, 'the v23 step is in the ladder');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  for (const c of ['graph', 'archived_at']) assert.ok(cols(db, 'workflows').includes(c), `workflows.${c}`);
  for (const c of ['execution_id', 'exec_kind', 'agent_key', 'ended_at', 'exec_trigger', 'exec_result', 'exec_meta']) {
    assert.ok(cols(db, 'pipeline_steps').includes(c), `pipeline_steps.${c}`);
  }
  assert.ok(cols(db, 'pipelines').includes('outcome'));
  assert.ok(tableNames(db).includes('config_workflow_wires'));
  assert.deepEqual(pkOrder(db, 'config_workflow_wires'), ['project_key', 'workflow_id', 'wire_id']);
});

test('ladder: a v22 DB is stamped 23 and gets the columns + the wires table', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec('PRAGMA user_version = 22');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(cols(db, 'workflows').includes('archived_at'));
  assert.ok(cols(db, 'pipeline_steps').includes('exec_meta'));
  assert.ok(tableNames(db).includes('config_workflow_wires'));
});

// The user's live DB shape: old-branch residue already present, stamped 22, with
// config_workflow_wires in the OLD PK column order. Migrating must be a no-op on
// what exists, must not throw on the duplicate ALTERs, and must stamp 23.
test('gap-heal: old-branch residue migrates cleanly and is left byte-alone', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec(`
    ALTER TABLE workflows ADD COLUMN graph TEXT;
    ALTER TABLE pipeline_steps ADD COLUMN execution_id TEXT;
    ALTER TABLE pipeline_steps ADD COLUMN exec_result TEXT;
    ALTER TABLE pipeline_steps ADD COLUMN exec_trigger TEXT;
    ALTER TABLE pipelines ADD COLUMN outcome TEXT;
    CREATE TABLE config_workflow_wires (
      workflow_id TEXT NOT NULL, project_key TEXT NOT NULL, wire_id TEXT NOT NULL,
      max_cycles INTEGER NOT NULL, PRIMARY KEY (workflow_id, project_key, wire_id));
  `);
  db.prepare('INSERT INTO config_workflow_wires (project_key, workflow_id, wire_id, max_cycles) VALUES (?,?,?,?)')
    .run('proj', 'wf_no-clarify', 'w3', 6);
  db.exec('PRAGMA user_version = 22');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(pkOrder(db, 'config_workflow_wires'), ['workflow_id', 'project_key', 'wire_id'],
    'the residue table is NOT rewritten — every statement names its columns');
  assert.equal(db.prepare('SELECT max_cycles FROM config_workflow_wires WHERE wire_id = ?').get('w3').max_cycles, 6);
  const stepCols = cols(db, 'pipeline_steps');
  assert.equal(stepCols.filter((c) => c === 'execution_id').length, 1, 'no duplicate ALTER');
  for (const c of ['exec_kind', 'agent_key', 'ended_at', 'exec_meta']) assert.ok(stepCols.includes(c), c);
  assert.ok(cols(db, 'workflows').includes('archived_at'));
  migrate(db);                                   // idempotent: second pass is a clean no-op
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
});

test('self-heal: a DB stamped current but missing a v23 column is repaired without a re-stamp', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec('PRAGMA user_version = 22');
  migrate(db);
  db.exec('ALTER TABLE pipelines DROP COLUMN outcome');
  db.exec('DROP TABLE config_workflow_wires');
  migrate(db);                                   // fast path -> reconcileSchema
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamp untouched');
  assert.ok(cols(db, 'pipelines').includes('outcome'), 'column healed');
  assert.ok(tableNames(db).includes('config_workflow_wires'), 'table healed');
});
