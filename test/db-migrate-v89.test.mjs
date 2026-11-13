// test/db-migrate-v89.test.mjs — Design (SPEC C-9): designs, design_builds, design_agents, design_cost_ledger.
// First written as v87; dev's PR-when-done #1156 took 87 and Requirements A6.1 took 88, so Design is v89.
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
  assert.ok(SCHEMA_VERSION >= 89);
  assert.deepEqual(cols(db, 'designs'), ['id', 'title', 'kind', 'fast', 'project_key', 'thread_id', 'engine', 'status', 'current_build', 'version', 'created_by', 'created_at', 'updated_at', 'models_json', 'pictures', 'sound_json']);
  assert.deepEqual(cols(db, 'design_builds'), ['id', 'design_id', 'round', 'kind', 'status', 'brief', 'fast', 'reason', 'sections_json', 'agents_total', 'layers', 'cost_usd', 'started_at', 'ended_at', 'created_by']);
  assert.deepEqual(cols(db, 'design_agents'), ['id', 'build_id', 'role', 'section_id', 'job', 'engine', 'model', 'effort', 'session_id', 'status', 'cost_usd', 'cost_known', 'tokens', 'asks', 'started_at', 'ended_at', 'error']);
  assert.deepEqual(cols(db, 'design_cost_ledger'), ['id', 'design_id', 'build_id', 'agent_id', 'amount_usd', 'model', 'ts']);
  for (const i of ['designs_updated', 'design_builds_design', 'design_agents_build', 'design_cost_ledger_ts']) assert.ok(indexes(db).includes(i), i);
});

test('a v88 DB gains them, keeps its rows and is stamped current', () => {
  const db = fresh();
  db.exec(`${TABLES.map((t) => `DROP TABLE ${t};`).join(' ')} PRAGMA user_version = 88`);
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

test('a DB stamped 87 or 88 by Design\'s previous numbering (the Design tables, none of dev\'s v87 and v88 columns) reaches the current version complete', () => {
  for (const stamp of [87, 88]) {
    const db = fresh();
    db.exec(`ALTER TABLE pipelines DROP COLUMN pr_auto; ALTER TABLE workspaces DROP COLUMN settings_json;
      ALTER TABLE req_export_links DROP COLUMN origin; ALTER TABLE req_attachments DROP COLUMN fetch_json;
      ${stamp === 87 ? 'ALTER TABLE designs DROP COLUMN models_json;' : ''} PRAGMA user_version = ${stamp}`);
    db.prepare("INSERT INTO designs (id, title, kind, created_at, updated_at) VALUES ('d_0', 't', 'web', 'now', 'now')").run();
    migrate(db);
    assert.equal(version(db), SCHEMA_VERSION);
    assert.ok(cols(db, 'pipelines').includes('pr_auto'), "#1156's v87 column");
    assert.ok(cols(db, 'workspaces').includes('settings_json'));
    assert.ok(cols(db, 'req_export_links').includes('origin'), "A6.1's v88 column");
    assert.ok(cols(db, 'req_attachments').includes('fetch_json'));
    assert.ok(cols(db, 'designs').includes('models_json'));
    assert.equal(db.prepare('SELECT title FROM designs').get().title, 't');
  }
});
