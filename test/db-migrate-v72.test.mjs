// test/db-migrate-v72.test.mjs — the requirements tables (plans/requirements-design.md §3). Upstream's v71 is
// utility_cost_ledger (Smart run naming); test/db-migrate-v71.test.mjs is upstream's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const TABLES = ['req_features', 'req_turns', 'req_contexts', 'req_cost_ledger'];
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('fresh DB has the requirements tables', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 72);
  assert.deepEqual(cols(db, 'req_features'), [
    'seq', 'scope_type', 'scope_key', 'epic_seq', 'title', 'description', 'status', 'spec_json',
    'orientation_json', 'criteria_seq', 'assumption_seq', 'rounds', 'cost_usd', 'saved_path',
    'created_by', 'created_at', 'updated_by', 'updated_at',
  ]);
  assert.deepEqual(cols(db, 'req_turns'), ['id', 'feature_seq', 'kind', 'payload_json', 'model', 'cost_usd', 'created_by', 'created_at']);
  assert.deepEqual(cols(db, 'req_contexts'), ['scope_type', 'scope_key', 'body', 'look_at_code', 'updated_by', 'updated_at']);
  assert.deepEqual(cols(db, 'req_cost_ledger'), ['id', 'feature_seq', 'turn_id', 'amount_usd', 'model', 'ts', 'brief_id', 'attachment_id', 'helper_message_id']);   // brief_id: v74, attachment_id: v77, helper_message_id: v78
});

test('a v71 DB (upstream dev) gets them at v72', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${TABLES.map((t) => `DROP TABLE ${t};`).join(' ')} DROP TABLE req_starts; DROP TABLE req_briefs; PRAGMA user_version = 71`);
  migrate(db);
  for (const t of [...TABLES, 'req_starts', 'req_briefs', 'utility_cost_ledger']) assert.ok(cols(db, t).length, `${t} exists`);
  assert.ok(cols(db, 'req_cost_ledger').includes('brief_id'));
  assert.equal(version(db), SCHEMA_VERSION);
});

test('a DB stamped 71-73 by the earlier numbering (requirements tables, no utility_cost_ledger) reaches the current version with both', () => {
  for (const stamp of [71, 72, 73]) {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    db.exec(`DROP TABLE utility_cost_ledger; PRAGMA user_version = ${stamp}`);
    db.prepare(`INSERT INTO req_features (scope_type, scope_key, title, description, status, spec_json, created_at, updated_at)
      VALUES ('project', 'p', 'kept', 'd', 'looking', '{}', 'now', 'now')`).run();
    migrate(db);
    assert.equal(version(db), SCHEMA_VERSION, `stamped ${stamp}`);
    for (const t of [...TABLES, 'req_starts', 'req_briefs', 'utility_cost_ledger']) assert.ok(cols(db, t).length, `stamped ${stamp}: ${t}`);
    assert.equal(db.prepare('SELECT title FROM req_features').get().title, 'kept', `stamped ${stamp}: rows kept`);
  }
});

test('a DB stamped past this version by another branch, without the tables, is repaired', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${TABLES.map((t) => `DROP TABLE ${t};`).join(' ')} PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  migrate(db);
  for (const t of TABLES) assert.ok(cols(db, t).length, `${t} repaired`);
});

test('FEAT numbers are never handed out again after a delete (AUTOINCREMENT)', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const ins = db.prepare(`INSERT INTO req_features (scope_type, scope_key, title, description, status, spec_json, created_at, updated_at)
    VALUES ('project', 'p', 't', 'd', 'looking', '{}', 'now', 'now')`);
  const a = Number(ins.run().lastInsertRowid);
  db.prepare('DELETE FROM req_features WHERE seq = ?').run(a);
  assert.equal(Number(ins.run().lastInsertRowid), a + 1);
});
