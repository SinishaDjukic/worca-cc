// P1/T4: the ask_* tables arrive through BOTH the v19 ladder step and the
// schemaGaps() self-heal (a DB stamped current by a divergent ladder must still get
// them). Structure mirrors test/migrate-v14.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, migrate, _resetForTests, SCHEMA_VERSION } from '../src/core/db.mjs';

useTempHome(after);

const ASK_TABLES = ['ask_threads', 'ask_messages', 'ask_attachments', 'ask_run_links'];
const tableNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
const indexNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name);
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

// The same minimal seed migrate-v14 uses: the tables the incremental-column repair ALTERs.
const MINIMAL_SEED = `
  CREATE TABLE pipelines (id TEXT PRIMARY KEY);
  CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
`;

test('fresh DB: user_version = SCHEMA_VERSION, the four ask tables, the index and the §7.1 columns', () => {
  const db = getDb();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  for (const t of ASK_TABLES) assert.ok(tableNames(db).includes(t), `${t} exists`);
  assert.ok(indexNames(db).includes('idx_ask_messages_thread'));
  assert.deepEqual(cols(db, 'ask_threads'),
    ['id', 'title', 'created_at', 'updated_at', 'model', 'effort', 'session_id', 'context', 'totals']);
  assert.deepEqual(cols(db, 'ask_messages'),
    ['id', 'thread_id', 'seq', 'role', 'text', 'blocks', 'status', 'reason', 'model', 'effort', 'usage', 'cost_usd', 'duration_ms', 'created_at']);
  assert.deepEqual(cols(db, 'ask_attachments'), ['id', 'thread_id', 'message_id', 'name', 'bytes', 'created_at']);
  // ALTER TABLE ADD COLUMN appends, so the v22 column is LAST.
  assert.deepEqual(cols(db, 'ask_run_links'),
    ['thread_id', 'run_id', 'pipeline_id', 'card_id', 'status', 'phase', 'created_at', 'comment_ids']);
});

test('ladder: a v17 DB gets the ask tables and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec('PRAGMA user_version = 17');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  for (const t of ASK_TABLES) assert.ok(tableNames(db).includes(t), `${t} created by the ladder`);
});

test('self-heal: a DB already stamped current WITHOUT the ask tables gets them from reconcileSchema, stamp untouched', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`); // divergent ladder: version says done, schema says otherwise
  migrate(db);                          // fast path → reconcileSchema
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamp not rewritten');
  for (const t of ASK_TABLES) assert.ok(tableNames(db).includes(t), `${t} healed`);
  assert.ok(indexNames(db).includes('idx_ask_messages_thread'), 'index healed');
  // M3: ONE migrate() must also close the INCREMENTAL_COLUMNS gap on a table the
  // SAME repair pass created — the ALTER is skipped while table_info is empty.
  assert.deepEqual(cols(db, 'ask_run_links'),
    ['thread_id', 'run_id', 'pipeline_id', 'card_id', 'status', 'phase', 'created_at', 'comment_ids'],
    'comment_ids ALTERed after ASK_DDL created the table, in the SAME migrate()');
});

// P4/T1: the two migration seams the fresh-path test in ask-worktrees-schema
// cannot pin — removing the `if (current < 21)` ladder step, or dropping
// `ask_worktrees` from INCREMENTAL_TABLES, both survive there (the second getDb()
// open falls through to reconcileSchema; the heal test above is missing the other
// ask tables too, which masks the gap).
test('ladder: a v20 DB gets ask_worktrees and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec('PRAGMA user_version = 20');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(tableNames(db).includes('ask_worktrees'), 'ask_worktrees created by its own ladder step (current < 21)');
  assert.ok(indexNames(db).includes('idx_ask_worktrees_thread'), 'index created by the ladder');
});

test('self-heal: a stamped-current DB missing ONLY ask_worktrees is healed, stamp untouched', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec('PRAGMA user_version = 17');            // 17 -> 23: run the ask ladder steps
  migrate(db);
  db.exec('DROP TABLE ask_worktrees');
  assert.ok(!tableNames(db).includes('ask_worktrees'), 'precondition: only this table is missing');
  migrate(db);                                    // stamp is current -> reconcileSchema fast path
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamp not rewritten');
  assert.ok(tableNames(db).includes('ask_worktrees'), 'healed by reconcileSchema');
  assert.ok(indexNames(db).includes('idx_ask_worktrees_thread'), 'index healed');
});

test('self-heal on the real home: dropping the ask tables and reopening recreates them', () => {
  const db = getDb();
  // children first: foreign_keys=ON on this handle (db.mjs:133)
  db.exec('DROP TABLE ask_run_links; DROP TABLE ask_attachments; DROP TABLE ask_messages; DROP TABLE ask_threads;');
  for (const t of ASK_TABLES) assert.ok(!tableNames(db).includes(t));
  _resetForTests();
  const db2 = getDb();
  assert.equal(db2.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  for (const t of ASK_TABLES) assert.ok(tableNames(db2).includes(t), `${t} back after reopen`);
});

test('cascade: deleting a thread removes its messages, attachments and run links', () => {
  const db = getDb();
  db.exec(`
    INSERT INTO ask_threads (id, created_at, updated_at) VALUES ('ask_00000001', 't', 't');
    INSERT INTO ask_messages (id, thread_id, seq, role, created_at) VALUES ('askm_00000001', 'ask_00000001', 1, 'user', 't');
    INSERT INTO ask_attachments (id, thread_id, message_id, name, bytes, created_at) VALUES ('att_00000001', 'ask_00000001', 'askm_00000001', 'a.md', 3, 't');
    INSERT INTO ask_run_links (thread_id, run_id, created_at) VALUES ('ask_00000001', 'run-1', 't');
    DELETE FROM ask_threads WHERE id = 'ask_00000001';
  `);
  for (const t of ['ask_messages', 'ask_attachments', 'ask_run_links']) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n, 0, `${t} cascaded`);
  }
});

test('UNIQUE (thread_id, seq) is enforced', () => {
  const db = getDb();
  db.exec(`INSERT INTO ask_threads (id, created_at, updated_at) VALUES ('ask_00000002', 't', 't');
           INSERT INTO ask_messages (id, thread_id, seq, role, created_at) VALUES ('askm_00000002', 'ask_00000002', 1, 'user', 't');`);
  assert.throws(() => db.exec(
    "INSERT INTO ask_messages (id, thread_id, seq, role, created_at) VALUES ('askm_00000003', 'ask_00000002', 1, 'user', 't')"),
  /UNIQUE/);
});

// Review of PR #376: every per-thread attachment read (threadAttachmentBytes, the
// snapshot, the delete cascade) scanned ask_attachments. The index is IF NOT
// EXISTS and probed by schemaGaps (INCREMENTAL_INDEXES), so an existing
// stamped-current DB heals without a version bump.
test('ask_attachments has a thread_id index on a fresh DB; self-heal recreates it on a stamped-current DB', () => {
  const db = getDb();
  assert.ok(indexNames(db).includes('idx_ask_attachments_thread'));
  db.exec('DROP INDEX idx_ask_attachments_thread');
  assert.ok(!indexNames(db).includes('idx_ask_attachments_thread'));
  _resetForTests();
  const db2 = getDb();
  assert.equal(db2.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamp untouched');
  assert.ok(indexNames(db2).includes('idx_ask_attachments_thread'), 'healed by reconcileSchema');
});
