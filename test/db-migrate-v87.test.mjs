// test/db-migrate-v87.test.mjs — Design (SPEC C-9): designs, design_builds, design_agents, design_cost_ledger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const TABLES = ['designs', 'design_builds', 'design_agents', 'design_cost_ledger'];
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const indexes = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
const fresh = () => { const db = new DatabaseSync(':memory:'); migrate(db); return db; };

test('a fresh DB has the C-9 tables and indexes', () => {
  const db = fresh();
  assert.ok(SCHEMA_VERSION >= 87);
  assert.deepEqual(cols(db, 'designs'), ['id', 'title', 'kind', 'fast', 'project_key', 'thread_id', 'engine', 'status', 'current_build', 'version', 'created_by', 'created_at', 'updated_at']);
  assert.deepEqual(cols(db, 'design_builds'), ['id', 'design_id', 'round', 'kind', 'status', 'brief', 'fast', 'reason', 'sections_json', 'agents_total', 'layers', 'cost_usd', 'started_at', 'ended_at', 'created_by']);
  assert.deepEqual(cols(db, 'design_agents'), ['id', 'build_id', 'role', 'section_id', 'job', 'engine', 'model', 'effort', 'session_id', 'status', 'cost_usd', 'cost_known', 'tokens', 'asks', 'started_at', 'ended_at', 'error']);
  assert.deepEqual(cols(db, 'design_cost_ledger'), ['id', 'design_id', 'build_id', 'agent_id', 'amount_usd', 'model', 'ts']);
  for (const i of ['designs_updated', 'design_builds_design', 'design_agents_build', 'design_cost_ledger_ts']) assert.ok(indexes(db).includes(i), i);
});

test('a v86 DB gains them, keeps its rows and is stamped current', () => {
  const db = fresh();
  db.exec(`${TABLES.map((t) => `DROP TABLE ${t};`).join(' ')} PRAGMA user_version = 86`);
  db.prepare("INSERT INTO store_meta (key, kind, data) VALUES ('k', 'setting', '1')").run();
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  for (const t of TABLES) assert.ok(cols(db, t).length, t);
  assert.equal(db.prepare("SELECT data FROM store_meta WHERE key = 'k'").get().data, '1');
});

test('stamped past this version without them, or missing one sibling: repaired, stamp untouched, rows kept', () => {
  const a = fresh();
  a.exec(`${TABLES.map((t) => `DROP TABLE ${t};`).join(' ')} PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  migrate(a);
  for (const t of TABLES) assert.ok(cols(a, t).length, t);
  assert.equal(version(a), SCHEMA_VERSION + 1);
  const b = fresh();
  b.prepare("INSERT INTO designs (id, title, kind, created_at, updated_at) VALUES ('d_0', 't', 'web', 'now', 'now')").run();
  b.exec('DROP TABLE design_agents');
  migrate(b);
  assert.ok(cols(b, 'design_agents').length);
  assert.equal(b.prepare('SELECT status FROM designs').get().status, 'empty');
});
