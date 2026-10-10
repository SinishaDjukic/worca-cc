// P1/T4: the ask_* tables arrive through BOTH the v19 ladder step and the
// schemaGaps() self-heal (a DB stamped current by a divergent ladder must still get
// them). Structure mirrors the migration ladder in test/db.test.mjs. The v21 ask_worktrees table
// (ask-worca-worktrees-design.md §4) is checked here too: columns, FK cascade, index.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { getDb, migrate, _resetForTests, SCHEMA_VERSION } from '../src/core/db.mjs';

useTempHome(after);

const ASK_TABLES = ['ask_threads', 'ask_messages', 'ask_attachments', 'ask_run_links'];
const tableNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
const indexNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name);
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

// The same minimal seed the db.test.mjs migration ladder uses: the tables the incremental-column repair ALTERs.
const MINIMAL_SEED = `
  CREATE TABLE pipelines (id TEXT PRIMARY KEY);
  CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
`;

test('fresh DB: user_version = SCHEMA_VERSION, the five ask tables, indexes, the §7.1 columns and ask_worktrees columns + FK cascade', () => {
  const db = getDb();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  for (const t of [...ASK_TABLES, 'ask_worktrees']) assert.ok(tableNames(db).includes(t), `${t} exists`);
  assert.ok(indexNames(db).includes('idx_ask_messages_thread'));
  assert.deepEqual(cols(db, 'ask_threads'),
    ['id', 'title', 'created_at', 'updated_at', 'model', 'effort', 'session_id', 'context', 'totals', 'created_by', 'mcp_off', 'contexts', 'agent_mode', 'engine', 'mode', 'composer']);   // v37 owner, v45 MCP picker choices, v46 context chips, v51 agent mode, v53 engine appended, v54 composer mode + canvas
  assert.deepEqual(cols(db, 'ask_messages'),
    ['id', 'thread_id', 'seq', 'role', 'text', 'blocks', 'status', 'reason', 'model', 'effort', 'usage', 'cost_usd', 'duration_ms', 'created_at']);
  // ALTER TABLE ADD COLUMN appends, so the v27 columns (#398) are LAST.
  assert.deepEqual(cols(db, 'ask_attachments'), ['id', 'thread_id', 'message_id', 'name', 'bytes', 'created_at', 'kind', 'mime']);
  // ALTER TABLE ADD COLUMN appends, so the v22 column is LAST.
  assert.deepEqual(cols(db, 'ask_run_links'),
    ['thread_id', 'run_id', 'pipeline_id', 'card_id', 'status', 'phase', 'created_at', 'comment_ids']);
  assert.deepEqual(cols(db, 'ask_worktrees'), ['id', 'thread_id', 'project_key', 'project_dir', 'ref',
    'resolved_commit', 'run_id', 'worktree_dir', 'created_at', 'updated_at']);
  const fk = db.prepare('PRAGMA foreign_key_list(ask_worktrees)').all()[0];
  assert.equal(fk.table, 'ask_threads');
  assert.equal(fk.on_delete, 'CASCADE');
  assert.ok(db.prepare('PRAGMA user_version').get().user_version >= 21);
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ask_worktrees'").all().map((r) => r.name);
  assert.ok(idx.includes('idx_ask_worktrees_thread'));
});

// P4/T1: the v20 row pins the two migration seams the fresh-DB test above cannot —
// removing the `if (current < 21)` ladder step, or dropping `ask_worktrees` from
// INCREMENTAL_TABLES, both survive there (the second getDb() open falls through to
// reconcileSchema; the heal test below is missing the other ask tables too, which
// masks the gap).
test('ladder: v17 and v20 DBs get the ask tables (incl. ask_worktrees + its index) and are stamped current', async () => {
  await checkRows([
    { name: 'ladder: a v17 DB gets the ask tables and is stamped current', run: () => {
      const db = new DatabaseSync(':memory:');
      db.exec(MINIMAL_SEED);
      db.exec('PRAGMA user_version = 17');
      migrate(db);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      for (const t of ASK_TABLES) assert.ok(tableNames(db).includes(t), `${t} created by the ladder`);
    } },
    { name: 'ladder: a v20 DB gets ask_worktrees and is stamped current', run: () => {
      const db = new DatabaseSync(':memory:');
      db.exec(MINIMAL_SEED);
      db.exec('PRAGMA user_version = 20');
      migrate(db);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      assert.ok(tableNames(db).includes('ask_worktrees'), 'ask_worktrees created by its own ladder step (current < 21)');
      assert.ok(indexNames(db).includes('idx_ask_worktrees_thread'), 'index created by the ladder');
    } },
  ]);
});

test('ladder: data-carrying column adds — v26→v27 ask_attachments gains kind/mime (rows read as text), v45→v46 ask_threads gains contexts (rows read NULL)', async () => {
  await checkRows([
    { name: 'v27 ladder (#398): a stamped-26 DB with the old ask_attachments shape gains kind/mime; existing rows read as text', run: () => {
      const db = new DatabaseSync(':memory:');
      db.exec(MINIMAL_SEED);
      // the exact pre-v27 table shape, with one row already in it
      db.exec(`CREATE TABLE ask_attachments (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, message_id TEXT, name TEXT NOT NULL,
        bytes INTEGER NOT NULL, created_at TEXT NOT NULL);`);
      db.prepare('INSERT INTO ask_attachments (id, thread_id, message_id, name, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('att_00000001', 'ask_00000001', null, 'notes.md', 5, '2026-08-01T00:00:00.000Z');
      db.exec('PRAGMA user_version = 26');
      migrate(db);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      assert.deepEqual(cols(db, 'ask_attachments'),
        ['id', 'thread_id', 'message_id', 'name', 'bytes', 'created_at', 'kind', 'mime']);
      const row = db.prepare('SELECT kind, mime FROM ask_attachments WHERE id = ?').get('att_00000001');
      assert.equal(row.kind, 'text', "the column DEFAULT backfills every pre-v27 row as 'text'");
      assert.equal(row.mime, null);
    } },
    { name: 'v46 ladder: a stamped-45 DB gains ask_threads.contexts; existing threads read NULL', run: () => {
      const db = new DatabaseSync(':memory:');
      db.exec(MINIMAL_SEED);
      // the exact pre-v46 ask_threads shape (ASK_DDL + v37's created_by + v45's mcp_off), one row in it
      db.exec(`CREATE TABLE ask_threads (
        id TEXT PRIMARY KEY, title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        model TEXT, effort TEXT, session_id TEXT, context TEXT, totals TEXT NOT NULL DEFAULT '{}',
        created_by TEXT, mcp_off TEXT);`);
      db.prepare('INSERT INTO ask_threads (id, created_at, updated_at, context) VALUES (?, ?, ?, ?)')
        .run('ask_00000001', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '{"view":"settings"}');
      db.exec('PRAGMA user_version = 45');
      migrate(db);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      assert.ok(cols(db, 'ask_threads').includes('contexts'));
      const row = db.prepare('SELECT context, contexts FROM ask_threads WHERE id = ?').get('ask_00000001');
      assert.equal(row.contexts, null, 'a pre-v46 chat has no recorded contexts (no indicator)');
      assert.equal(row.context, '{"view":"settings"}', 'the last-context column is untouched');
    } },
  ]);
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

// The ask_worktrees row pins the INCREMENTAL_TABLES seam the heal test above masks.
// Review of PR #376: every per-thread attachment read (the snapshot, the delete
// cascade) scanned ask_attachments. The index is IF NOT EXISTS and probed by
// schemaGaps (INCREMENTAL_INDEXES), so an existing stamped-current DB heals without
// a version bump.
test('self-heal on a stamped-current DB: a missing ask_worktrees table and a missing idx_ask_attachments_thread are recreated, stamp untouched', async () => {
  await checkRows([
    { name: 'self-heal: a stamped-current DB missing ONLY ask_worktrees is healed, stamp untouched', run: () => {
      const db = new DatabaseSync(':memory:');
      db.exec(MINIMAL_SEED);
      db.exec('PRAGMA user_version = 17');            // 17 -> current: run the ask ladder steps
      migrate(db);
      db.exec('DROP TABLE ask_worktrees');
      assert.ok(!tableNames(db).includes('ask_worktrees'), 'precondition: only this table is missing');
      migrate(db);                                    // stamp is current -> reconcileSchema fast path
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamp not rewritten');
      assert.ok(tableNames(db).includes('ask_worktrees'), 'healed by reconcileSchema');
      assert.ok(indexNames(db).includes('idx_ask_worktrees_thread'), 'index healed');
    } },
    { name: 'ask_attachments has a thread_id index on a fresh DB; self-heal recreates it on a stamped-current DB', run: () => {
      const db = getDb();
      assert.ok(indexNames(db).includes('idx_ask_attachments_thread'));
      db.exec('DROP INDEX idx_ask_attachments_thread');
      assert.ok(!indexNames(db).includes('idx_ask_attachments_thread'));
      _resetForTests();
      const db2 = getDb();
      assert.equal(db2.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamp untouched');
      assert.ok(indexNames(db2).includes('idx_ask_attachments_thread'), 'healed by reconcileSchema');
    } },
  ]);
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
