// test/db-migrate-v91.test.mjs — pipelines.cost_cap_usd (Stillhet's Raise the cap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const seed = (db) => db.prepare(`INSERT INTO pipelines (id, project_key, status, total_cost_usd)
  VALUES ('p-1', 'k', 'paused', 2.5)`).run();

test('a DB stamped 90 without pipelines.cost_cap_usd gains it, keeps its runs (cap NULL) and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('ALTER TABLE pipelines DROP COLUMN cost_cap_usd; PRAGMA user_version = 90');
  seed(db);
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 91);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(cols(db, 'pipelines').includes('cost_cap_usd'));
  assert.deepEqual({ ...db.prepare("SELECT status, total_cost_usd, cost_cap_usd FROM pipelines WHERE id = 'p-1'").get() },
    { status: 'paused', total_cost_usd: 2.5, cost_cap_usd: null });
});

test('a DB stamped 90 that already has the column opens with no error and no data change', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  seed(db);
  db.exec("UPDATE pipelines SET cost_cap_usd = 12 WHERE id = 'p-1'");
  const before = { ...db.prepare("SELECT * FROM pipelines WHERE id = 'p-1'").get() };
  migrate(db);
  assert.deepEqual({ ...db.prepare("SELECT * FROM pipelines WHERE id = 'p-1'").get() }, before);
});
