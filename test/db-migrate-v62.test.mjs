// test/db-migrate-v62.test.mjs — v62 (#712 slice 2): pipelines.run_setup, the run's setup kept at start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

test('v62 adds pipelines.run_setup to a v61 DB; an existing run keeps NULL (no backfill)', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec("INSERT INTO pipelines (id, project_key) VALUES ('legacy01', 'p-12345678')");
  db.exec('ALTER TABLE pipelines DROP COLUMN run_setup; PRAGMA user_version = 61');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 62);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(cols(db, 'pipelines').includes('run_setup'));
  assert.equal(db.prepare("SELECT run_setup FROM pipelines WHERE id = 'legacy01'").get().run_setup, null);
});
