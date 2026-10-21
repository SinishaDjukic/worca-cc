// test/db-migrate-v59.test.mjs — req_briefs and req_cost_ledger.brief_id (plans/requirements-a7-design.md §3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const COLS = ['id', 'scope_type', 'scope_key', 'status', 'sections_json', 'edited_json', 'sources_json', 'files_json',
  'seed_json', 'model', 'cost_usd', 'error_json', 'made_by', 'made_at', 'created_by', 'created_at', 'updated_by', 'updated_at'];

test('fresh DB has req_briefs and the ledger column', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 59);
  assert.deepEqual(cols(db, 'req_briefs'), COLS);
  assert.ok(cols(db, 'req_cost_ledger').includes('brief_id'));
});

test('a DB stamped 58 (ledger without the column) gets both', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE req_briefs; ALTER TABLE req_cost_ledger DROP COLUMN brief_id; PRAGMA user_version = 58');
  assert.ok(!cols(db, 'req_cost_ledger').includes('brief_id'));
  migrate(db);
  assert.deepEqual(cols(db, 'req_briefs'), COLS);
  assert.ok(cols(db, 'req_cost_ledger').includes('brief_id'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
});

test('a DB stamped past this version without the table is repaired', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`DROP TABLE req_briefs; PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  migrate(db);
  assert.deepEqual(cols(db, 'req_briefs'), COLS);
});

test('one brief per scope', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const ins = () => db.prepare("INSERT INTO req_briefs (scope_type, scope_key, status, created_at, updated_at) VALUES ('project','p','empty','t','t')").run();
  ins();
  assert.throws(ins, /UNIQUE/);
});
