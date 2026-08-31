// v22: diff_comments + ask_card_comments + ask_run_links.comment_ids. The tables
// arrive through BOTH the ladder step AND the schemaGaps() self-heal (a DB stamped
// current by a divergent ladder must still get them) — structure mirrors
// test/ask-db-schema.test.mjs and test/ask-worktrees-schema.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, prepare, migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

useTempHome(after);

const tableNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
const indexNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name);
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

// The same minimal seed migrate-v14 / ask-db-schema use: the tables the
// incremental-column repair ALTERs.
const MINIMAL_SEED = `
  CREATE TABLE pipelines (id TEXT PRIMARY KEY);
  CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
`;

test('v22: diff_comments has the spec columns, its index, and declares the pipelines cascade', () => {
  getDb();
  assert.deepEqual(prepare('PRAGMA table_info(diff_comments)').all().map((c) => c.name), [
    'id', 'store_key', 'pipeline_id', 'project_key', 'path', 'old_path', 'side', 'line_no',
    'line_text', 'body', 'author', 'resolved', 'resolved_at', 'sent_run_id', 'source',
    'external_url', 'created_at']);
  const fk = prepare('PRAGMA foreign_key_list(diff_comments)').all()[0];
  assert.equal(fk.table, 'pipelines');
  assert.equal(fk.on_delete, 'CASCADE');
  assert.ok(prepare('PRAGMA user_version').get().user_version >= SCHEMA_VERSION);
  const idx = prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='diff_comments'")
    .all().map((r) => r.name);
  assert.ok(idx.includes('idx_diff_comments_run'));
});

test('v22: the table keeps a rowid — creation order (D17) depends on it', () => {
  const db = getDb();
  // A TEXT PRIMARY KEY table is NOT `WITHOUT ROWID`, so rowid is the monotonic
  // insertion counter listDiffComments orders by. If someone ever adds WITHOUT
  // ROWID this throws and the ordering guarantee is caught here, not in prod.
  assert.doesNotThrow(() => db.prepare('SELECT rowid FROM diff_comments LIMIT 1').get());
});

test('v22: ask_card_comments cascades from diff_comments; ask_run_links gained comment_ids', () => {
  getDb();
  assert.deepEqual(prepare('PRAGMA table_info(ask_card_comments)').all().map((c) => c.name),
    ['card_id', 'comment_id', 'created_at']);
  assert.equal(prepare('PRAGMA foreign_key_list(ask_card_comments)').all()[0].table, 'diff_comments');
  // ALTER appends, so comment_ids is LAST — the same order ask-db-schema.test.mjs:33 now pins.
  assert.deepEqual(prepare('PRAGMA table_info(ask_run_links)').all().map((c) => c.name),
    ['thread_id', 'run_id', 'pipeline_id', 'card_id', 'status', 'phase', 'created_at', 'comment_ids']);
});

test('v22: deleting a comment cascades its ask_card_comments rows (foreign_keys=ON on this handle)', () => {
  const db = getDb();
  db.exec(`
    INSERT INTO pipelines (id, project_key, target, status, phase) VALUES ('c0ffee01', 'p-00000001', 'project', 'done', 'done');
    INSERT INTO diff_comments (id, store_key, pipeline_id, path, side, line_no, body, author, created_at)
      VALUES ('dc_11111111', 'p-00000001', 'c0ffee01', 'a.js', 'new', 1, 'b', 'user', 't');
    INSERT INTO ask_card_comments (card_id, comment_id, created_at) VALUES ('card_11111111', 'dc_11111111', 't');
  `);
  db.exec("DELETE FROM diff_comments WHERE id = 'dc_11111111'");
  assert.equal(db.prepare('SELECT count(*) AS n FROM ask_card_comments').get().n, 0);
});

test('ladder: a v21 DB gets the v22 tables and column and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec('PRAGMA user_version = 17');   // 17 -> current first, so ask_run_links exists
  migrate(db);
  db.exec('PRAGMA user_version = 21');   // rewind the stamp only: a real v21 DB
  db.exec('DROP TABLE ask_card_comments');
  db.exec('DROP TABLE diff_comments');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(tableNames(db).includes('diff_comments'), 'created by the v22 ladder step');
  assert.ok(tableNames(db).includes('ask_card_comments'));
  assert.ok(indexNames(db).includes('idx_diff_comments_run'));
  assert.ok(cols(db, 'ask_run_links').includes('comment_ids'));
});

test('self-heal: a stamped-current DB missing only the v22 tables is healed, stamp untouched', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec('PRAGMA user_version = 17');
  migrate(db);
  db.exec('DROP TABLE ask_card_comments');
  db.exec('DROP TABLE diff_comments');
  assert.ok(!tableNames(db).includes('diff_comments'), 'precondition');
  migrate(db);                            // stamp is current -> reconcileSchema fast path
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamp not rewritten');
  assert.ok(tableNames(db).includes('diff_comments'), 'healed by reconcileSchema');
  assert.ok(tableNames(db).includes('ask_card_comments'), 'healed by reconcileSchema');
  assert.ok(indexNames(db).includes('idx_diff_comments_run'), 'the index rides the same DDL');
});

test('self-heal: a stamped-current DB missing only ask_run_links.comment_ids is ALTERed', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec('PRAGMA user_version = 17');
  migrate(db);
  // node:sqlite has no reliable DROP COLUMN — rebuild the table without it.
  // CREATE TABLE AS SELECT loses the PK, which is fine: only the column set matters.
  db.exec(`
    CREATE TABLE ask_run_links_old AS
      SELECT thread_id, run_id, pipeline_id, card_id, status, phase, created_at FROM ask_run_links;
    DROP TABLE ask_run_links;
    ALTER TABLE ask_run_links_old RENAME TO ask_run_links;
  `);
  assert.ok(!cols(db, 'ask_run_links').includes('comment_ids'), 'precondition');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamp not rewritten');
  assert.ok(cols(db, 'ask_run_links').includes('comment_ids'), 'healed by the incremental-column repair');
});

// M3: comment_ids is the first INCREMENTAL_COLUMNS entry whose host table is
// itself created by a gap-repair DDL. Every stamp where ask_run_links is created
// by the SAME repairSchemaGaps pass (20 and 21 via applySchemaV22, the current
// stamp via reconcileSchema) used to end up stamped current with the column
// missing, and
// updateRunLink({commentIds}) threw into the log-only catch at ui/server.mjs:1157.
test('M3: a stamp that creates ask_run_links in the SAME repair pass still gets comment_ids in ONE migrate()', () => {
  for (const stamp of [20, 21, SCHEMA_VERSION]) {
    const db = new DatabaseSync(':memory:');
    db.exec(MINIMAL_SEED);
    db.exec(`PRAGMA user_version = ${stamp}`);
    migrate(db);                                  // ONE pass, as a real process does at boot
    assert.ok(tableNames(db).includes('ask_run_links'), `stamp ${stamp}: ask_run_links created`);
    assert.ok(cols(db, 'ask_run_links').includes('comment_ids'),
      `stamp ${stamp}: comment_ids present after ONE migrate()`);
    db.exec("INSERT INTO ask_threads (id, created_at, updated_at) VALUES ('ask_00000001','t','t')");
    db.exec("INSERT INTO ask_run_links (thread_id, run_id, created_at) VALUES ('ask_00000001','run-1','t')");
    assert.doesNotThrow(() => db.prepare(
      'UPDATE ask_run_links SET comment_ids = ? WHERE thread_id = ? AND run_id = ?'
    ).run('["dc_11111111"]', 'ask_00000001', 'run-1'), `stamp ${stamp}: updateRunLink({commentIds}) works`);
    db.close();
  }
});
