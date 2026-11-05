// test/db-migrate-v85.test.mjs — req_features.early_start_reason: the reason kept for starting a feature before Ready.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('fresh DB: req_features.early_start_reason exists', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 85);
  assert.ok(cols(db, 'req_features').includes('early_start_reason'));
});

test('a DB stamped 84 without it gets it, existing rows read NULL, and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('ALTER TABLE req_features DROP COLUMN early_start_reason; PRAGMA user_version = 84');
  db.exec(`INSERT INTO req_features (scope_type, scope_key, title, description, status, spec_json, created_at, updated_at)
    VALUES ('project', 'p', 'T', 'D', 'looking', '{}', '2026-01-01', '2026-01-01')`);
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'req_features').includes('early_start_reason'));
  assert.equal(db.prepare('SELECT early_start_reason AS r FROM req_features').get().r, null);
});

test('a DB stamped current without the column is healed, its stamp untouched', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`ALTER TABLE req_features DROP COLUMN early_start_reason; PRAGMA user_version = ${SCHEMA_VERSION}`);
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'req_features').includes('early_start_reason'));
});

// v85 also numbered the freeform chat tables on the Discord chat branch, so a DB that dev stamped 85 has none of them.
// The migration step for them is gated at < 85; the hoisted schema-gap repair is what creates them.
test('a DB stamped 85 by dev (no chat tables) gets them, header_new_off included, and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE chat_conversations; DROP TABLE chat_controls; DROP TABLE chat_deliveries; DROP TABLE chat_inbound_seen; PRAGMA user_version = 85');
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  for (const t of ['chat_conversations', 'chat_controls', 'chat_deliveries', 'chat_inbound_seen']) assert.ok(cols(db, t).length > 0, t);
  assert.ok(cols(db, 'chat_conversations').includes('header_new_off'));
});
