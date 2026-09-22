// v33: pipelines.human_hours + pipeline_steps.human_hours/human_signals (money-saved design
// §6). Fresh DB, self-heal (stamped past current, columns missing), and the ladder from v32.
// Modelled on test/db-migrate-v30.test.mjs; DROP COLUMN needs SQLite >= 3.35 (node 22 ships 3.4x).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const dropCols = (db) => db.exec(`
  ALTER TABLE pipelines DROP COLUMN human_hours;
  ALTER TABLE pipeline_steps DROP COLUMN human_hours;
  ALTER TABLE pipeline_steps DROP COLUMN human_signals;`);

test('v33 adds the three columns on a fresh DB; human_hours defaults to 0 on the run row', () => {
  assert.ok(SCHEMA_VERSION >= 33);
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(cols(db, 'pipelines').includes('human_hours'));
  assert.ok(cols(db, 'pipeline_steps').includes('human_hours'));
  assert.ok(cols(db, 'pipeline_steps').includes('human_signals'));
  db.prepare("INSERT INTO pipelines (id, project_key, status) VALUES ('p1', 'k', 'done')").run();
  assert.equal(db.prepare("SELECT human_hours FROM pipelines WHERE id = 'p1'").get().human_hours, 0);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  db.close();
});

test('self-heal: stamped past current with the columns missing, they are ALTERed and not re-stamped', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  dropCols(db);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION + 1);
  assert.ok(cols(db, 'pipelines').includes('human_hours'));
  assert.ok(cols(db, 'pipeline_steps').includes('human_signals'));
  db.close();
});

test('a v32-stamped DB without the columns is healed by the ladder', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  dropCols(db);
  db.exec('PRAGMA user_version = 32');
  assert.ok(!cols(db, 'pipelines').includes('human_hours'));
  migrate(db);
  assert.ok(cols(db, 'pipelines').includes('human_hours'));
  assert.ok(cols(db, 'pipeline_steps').includes('human_hours'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  db.close();
});
