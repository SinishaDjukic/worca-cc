// test/db-migrate-v63.test.mjs — v63 (#712 slice 3): schedules and scheduled_runs gain preset_id (the preset a schedule follows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

test('v62 → v63 adds preset_id to schedules and scheduled_runs, keeping rows', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec("INSERT INTO schedules (id, request, rule, created_at, updated_at) VALUES ('sch_00000001', '{}', '{}', 'x', 'x')");
  db.exec('ALTER TABLE schedules DROP COLUMN preset_id; ALTER TABLE scheduled_runs DROP COLUMN preset_id; PRAGMA user_version = 62');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 63);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(cols(db, 'schedules').includes('preset_id'));
  assert.ok(cols(db, 'scheduled_runs').includes('preset_id'));
  assert.equal(db.prepare("SELECT preset_id FROM schedules WHERE id = 'sch_00000001'").get().preset_id, null);
});
