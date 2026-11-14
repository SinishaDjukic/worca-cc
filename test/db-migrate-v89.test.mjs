// test/db-migrate-v89.test.mjs — the harness and cost kind of every Requirements step (plans/requirements-9c, Task 2).
// Fourteen additive nullable columns (INCREMENTAL_COLUMNS): req_features.model_json, req_briefs.{engine, made_cost_usd, made_cost_kind}, req_cost_ledger.{engine, step,
// cost_kind, input_tokens, output_tokens}, req_turns.{engine, notices_json}, req_helper_messages.{engine, notices_json} and
// req_attachments.read_engine. A fresh DB has them, one at 88 gets them, one stamped past this version without them is repaired.
// It also covers ask_threads.labels (Stillhet chat labels), this branch's own v89 before the two ladders merged at v91.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
function shape(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const out = {};
  for (const { name } of tables) out[name] = cols(db, name).sort();
  out['#indexes'] = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  return out;
}
const FRESH = (() => { const db = new DatabaseSync(':memory:'); migrate(db); return shape(db); })();
const NEW = {
  req_features: ['model_json'],
  req_briefs: ['engine', 'made_cost_usd', 'made_cost_kind'],
  req_cost_ledger: ['engine', 'step', 'cost_kind', 'input_tokens', 'output_tokens'],
  req_turns: ['engine', 'notices_json'],
  req_helper_messages: ['engine', 'notices_json'],
  req_attachments: ['read_engine'],
};
const DROP = Object.entries(NEW).flatMap(([t, cs]) => cs.map((c) => `ALTER TABLE ${t} DROP COLUMN ${c};`)).join(' ');
function assertComplete(db) {
  assert.equal(version(db), SCHEMA_VERSION);
  let n = 0;
  for (const [t, cs] of Object.entries(NEW)) for (const c of cs) { n += 1; assert.ok(cols(db, t).includes(c), `${t}.${c}`); }
  assert.equal(n, 14);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
}
const fromStamp = (sql, stamp) => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${sql} PRAGMA user_version = ${stamp}`);
  migrate(db);
  return db;
};

test('a fresh DB has the new columns at version 89', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 89);
  assertComplete(db);
});

test('a DB at 88 reaches the current version with the new columns and a fresh DB shape', () => {
  const db = fromStamp(DROP, 88);
  assertComplete(db);
});

test('rows already there read NULL in the new columns', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${DROP} INSERT INTO req_cost_ledger (feature_seq, amount_usd, ts) VALUES (1, 0.5, 1); PRAGMA user_version = 88`);
  migrate(db);
  const r = db.prepare('SELECT engine, step, cost_kind, input_tokens, output_tokens FROM req_cost_ledger').get();
  assert.deepEqual({ ...r }, { engine: null, step: null, cost_kind: null, input_tokens: null, output_tokens: null });
});

test('a DB stamped 89 without the columns is repaired', () => {
  assertComplete(fromStamp(DROP, SCHEMA_VERSION));
  const past = fromStamp(DROP, SCHEMA_VERSION + 1);   // a ladder from another checkout stamped it past this version
  for (const [t, cs] of Object.entries(NEW)) for (const c of cs) assert.ok(cols(past, t).includes(c), `${t}.${c}`);
});

test('a DB stamped 88 without ask_threads.labels gains it, keeps its chats (labels NULL) and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec("ALTER TABLE ask_threads DROP COLUMN labels; PRAGMA user_version = 88");
  db.prepare("INSERT INTO ask_threads (id, created_at, updated_at) VALUES ('ask_00000001', 'x', 'x')").run();
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(cols(db, 'ask_threads').at(-1), 'labels');
  assert.equal(db.prepare("SELECT labels FROM ask_threads WHERE id = 'ask_00000001'").get().labels, null);
});
