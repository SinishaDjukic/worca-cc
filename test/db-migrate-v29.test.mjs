// v29: diff_comments.parent_id (reply threads). The ladder path (a DB stamped 28)
// and the self-heal path (stamped current, column missing). The column is rebuilt
// away with CREATE TABLE AS SELECT (the ask_run_links.comment_ids precedent in
// diff-comments-schema.test.mjs) — that also drops the PK and the pipelines FK,
// which is fine: only the column set and the parent_id FK matter here (the
// cascade itself is pinned in the store test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const V28_COLS = 'id, store_key, pipeline_id, project_key, path, old_path, side, line_no, line_text, '
  + 'body, author, resolved, resolved_at, sent_run_id, source, external_url, created_at';

function dbWithoutParentId(stamp) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE pipelines (id TEXT PRIMARY KEY); CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);');
  db.exec('PRAGMA user_version = 17');
  migrate(db);
  db.exec(`
    CREATE TABLE diff_comments_old AS SELECT ${V28_COLS} FROM diff_comments;
    DROP TABLE diff_comments;
    ALTER TABLE diff_comments_old RENAME TO diff_comments;
    PRAGMA user_version = ${stamp};
  `);
  assert.ok(!cols(db, 'diff_comments').includes('parent_id'), 'precondition');
  return db;
}

test('ladder: a DB stamped 28 gains diff_comments.parent_id with its self-FK and is stamped current', () => {
  assert.ok(SCHEMA_VERSION >= 29);
  const db = dbWithoutParentId(28);
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(cols(db, 'diff_comments').includes('parent_id'));
  const fk = db.prepare('PRAGMA foreign_key_list(diff_comments)').all().find((f) => f.from === 'parent_id');
  assert.ok(fk, 'the ALTER kept the REFERENCES clause');
  assert.equal(fk.table, 'diff_comments');
  assert.equal(fk.on_delete, 'CASCADE');
  db.close();
});

// Stamped PAST current — a DB written by a newer build, or by a divergent ladder.
// That is the case the "stamp not rewritten" claim actually guards: the fast path
// must heal the missing column and leave user_version alone, because re-stamping it
// would silently DOWNGRADE the record of what the file has been through. A fixture
// stamped AT SCHEMA_VERSION cannot show that — the assertion would then compare the
// constant with itself and hold even if migrate() did rewrite the stamp.
test('self-heal: a DB stamped past current, missing only parent_id, is ALTERed and never re-stamped', () => {
  const db = dbWithoutParentId(SCHEMA_VERSION + 1);
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION + 1, 'stamp not rewritten');
  assert.ok(cols(db, 'diff_comments').includes('parent_id'), 'healed by reconcileSchema');
  db.close();
});
