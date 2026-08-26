// test/migrate-v20.test.mjs
//
// v20 adds ask_cost_ledger — the append-only, FK-free Ask Worca spend ledger
// (ask-cost-statistics-design.md §6) — and backfills one row per already-
// persisted costed assistant message (cost_usd > 0), ts = the message's
// created_at, tokens = the sum of the stored usage fields, so pre-upgrade chat
// spend lands in Statistics. Threads deleted before the upgrade left no
// messages (CASCADE), so they backfill nothing. Structure mirrors
// test/migrate-v16.test.mjs: seed at current version through the production
// writers, stamp user_version back, reopen — the ladder runs only the v20 step.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, migrate, _resetForTests, SCHEMA_VERSION } from '../src/core/db.mjs';
import { createThread, appendMessage, finishMessage, deleteThread } from '../src/core/ask/store.mjs';

useTempHome(after);

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const tableNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
const indexNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name);

// The same minimal seed the other migrate tests use: only the tables the
// incremental-column repair ALTERs.
const MINIMAL_SEED = `
  CREATE TABLE pipelines (id TEXT PRIMARY KEY);
  CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
`;

const ids = {};

test('v19 -> v20 creates ask_cost_ledger and backfills costed messages', async () => {
  const db = getDb();
  // Fresh-install pin: the ladder (not just the heal) creates table + index.
  assert.ok(tableNames(db).includes('ask_cost_ledger'), 'fresh DB gets the table from the ladder');
  assert.ok(indexNames(db).includes('idx_ask_cost_ledger_ts'));
  assert.equal(db.prepare(
    "SELECT tbl_name FROM sqlite_master WHERE type='index' AND name='idx_ask_cost_ledger_ts'"
  ).get().tbl_name, 'ask_cost_ledger', 'the ts index is on ask_cost_ledger');

  const t1 = createThread(); ids.t1 = t1.id;
  // m1: costed, usage sum 1500, model set the way production sets it —
  // appendMessage's model param (store.mjs:165; ui/server.mjs:3373).
  const m1 = appendMessage(t1.id, { role: 'assistant', text: '', status: 'streaming', model: 'claude-opus-5' });
  finishMessage(m1.id, { text: 'a', blocks: [], status: 'done', reason: null,
    usage: { input: 1000, output: 400, cacheRead: 50, cacheCreation: 50 }, costUsd: 0.42, durationMs: 5 });
  ids.m1 = m1.id;
  // m2: pre-result stop — cost_usd NULL — skipped
  const m2 = appendMessage(t1.id, { role: 'assistant', text: '', status: 'streaming' });
  finishMessage(m2.id, { text: 'b', blocks: [], status: 'stopped', reason: 'user',
    usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: null, durationMs: 5 });
  // m3: $0 (mock) — skipped by cost_usd > 0
  const m3 = appendMessage(t1.id, { role: 'assistant', text: '', status: 'streaming' });
  finishMessage(m3.id, { text: 'c', blocks: [], status: 'done', reason: null,
    usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 5 });
  // m4: costed but unparseable created_at — skipped (v16 precedent)
  const m4 = appendMessage(t1.id, { role: 'assistant', text: '', status: 'streaming' });
  finishMessage(m4.id, { text: 'd', blocks: [], status: 'done', reason: null,
    usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.1, durationMs: 5 });
  db.prepare('UPDATE ask_messages SET created_at = ? WHERE id = ?').run('not-a-date', m4.id);
  // m5: costed, usage NULL, no model — row with tokens NULL and model NULL
  const m5 = appendMessage(t1.id, { role: 'assistant', text: '', status: 'streaming' });
  finishMessage(m5.id, { text: 'e', blocks: [], status: 'done', reason: null,
    usage: null, costUsd: 0.08, durationMs: 5 });
  ids.m5 = m5.id;

  // a thread deleted pre-upgrade: CASCADE removed its messages — nothing to backfill
  const t2 = createThread();
  const m6 = appendMessage(t2.id, { role: 'assistant', text: '', status: 'streaming' });
  finishMessage(m6.id, { text: 'f', blocks: [], status: 'done', reason: null,
    usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 9, durationMs: 5 });
  deleteThread(t2.id);

  // Rewind: drop the table the fresh-DB ladder already made, stamp 19, reopen.
  db.exec('DROP TABLE IF EXISTS ask_cost_ledger');
  db.exec('PRAGMA user_version = 19');
  _resetForTests();
  const db2 = getDb();

  assert.equal(db2.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(tableNames(db2).includes('ask_cost_ledger'));
  assert.ok(indexNames(db2).includes('idx_ask_cost_ledger_ts'));
  assert.deepEqual(cols(db2, 'ask_cost_ledger'),
    ['id', 'thread_id', 'message_id', 'amount_usd', 'tokens', 'model', 'ts']);

  // The backfill SELECT has no ORDER BY — key the assertions by message_id,
  // never by position.
  const rows = db2.prepare('SELECT * FROM ask_cost_ledger').all();
  assert.equal(rows.length, 2, 'only the costed, parseable messages backfill');
  const byMsg = new Map(rows.map((r) => [r.message_id, r]));
  const r1 = byMsg.get(ids.m1);
  assert.ok(r1, 'm1 backfilled');
  assert.equal(r1.thread_id, ids.t1);
  assert.equal(r1.amount_usd, 0.42);
  assert.equal(r1.tokens, 1500);
  assert.equal(r1.model, 'claude-opus-5');
  assert.equal(r1.ts, Date.parse(
    db2.prepare('SELECT created_at FROM ask_messages WHERE id = ?').get(ids.m1).created_at));
  const r5 = byMsg.get(ids.m5);
  assert.ok(r5, 'm5 backfilled');
  assert.equal(r5.amount_usd, 0.08);
  assert.equal(r5.tokens, null, 'NULL usage backfills tokens NULL');
  assert.equal(r5.model, null, 'a message without a model backfills model NULL');
});

test('re-running the v20 step is a no-op: no duplicate rows', () => {
  // A plain reopen takes the fast path and never re-enters applySchemaV20 —
  // re-stamp 19 (partial upgrade / divergent stamp) so the ladder REALLY
  // re-runs the backfill against a populated ledger.
  getDb().exec('PRAGMA user_version = 19');
  _resetForTests();
  const db = getDb();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ask_cost_ledger').get().n, 2,
    'the NOT EXISTS guard suppresses re-inserts');
});

test('self-heal on the real home: dropping ONLY ask_cost_ledger recreates it', () => {
  // Pins the ask_cost_ledger INCREMENTAL_TABLES entry in reconcileSchema's
  // clean-path condition: on an otherwise-healthy DB this table must be the thing
  // that stops the early return. (The minimal-seed heal test below cannot see that
  // gap — its seed has other gaps.)
  const db = getDb();
  db.exec('DROP TABLE ask_cost_ledger');
  _resetForTests();
  assert.ok(tableNames(getDb()).includes('ask_cost_ledger'),
    'reconcileSchema must not early-return on a DB whose only gap is this table');
});

test('ladder: a v19 DB gets ask_cost_ledger and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec('PRAGMA user_version = 19');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(tableNames(db).includes('ask_cost_ledger'), 'created by the ladder');
});

test('self-heal: a DB stamped current WITHOUT the table gets it from reconcileSchema, empty', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`); // divergent ladder: version says done, schema says otherwise
  migrate(db);                          // fast path → reconcileSchema
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamp not rewritten');
  assert.ok(tableNames(db).includes('ask_cost_ledger'), 'healed');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ask_cost_ledger').get().n, 0,
    'no backfill on the heal path (accepted, same as cost_ledger)');
});
