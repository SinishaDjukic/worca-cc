// test/db-migrate-v96.test.mjs — pipelines.finished_at (set once when a run first reaches done) and pipelines.credit_key.
// A comment-only rung: both columns come from INCREMENTAL_COLUMNS, added by the hoisted repairSchemaGaps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('v96 adds finished_at and credit_key; a v95 DB upgrades; self-heal adds them', () => {
  const fresh = new DatabaseSync(':memory:'); migrate(fresh);
  assert.ok(SCHEMA_VERSION >= 96);
  assert.equal(version(fresh), SCHEMA_VERSION);
  for (const c of ['finished_at', 'credit_key']) assert.ok(cols(fresh, 'pipelines').includes(c), `fresh DB has ${c}`);

  const old = new DatabaseSync(':memory:'); migrate(old);
  old.exec('ALTER TABLE pipelines DROP COLUMN finished_at; ALTER TABLE pipelines DROP COLUMN credit_key; PRAGMA user_version = 95');
  assert.equal(cols(old, 'pipelines').includes('finished_at'), false);
  migrate(old);
  assert.equal(version(old), SCHEMA_VERSION);
  for (const c of ['finished_at', 'credit_key']) assert.ok(cols(old, 'pipelines').includes(c), `v95 DB gained ${c}`);

  const healed = new DatabaseSync(':memory:'); migrate(healed);
  healed.exec('ALTER TABLE pipelines DROP COLUMN finished_at; ALTER TABLE pipelines DROP COLUMN credit_key');
  migrate(healed);
  assert.equal(version(healed), SCHEMA_VERSION);
  for (const c of ['finished_at', 'credit_key']) assert.ok(cols(healed, 'pipelines').includes(c), `self-heal added ${c}`);
});
