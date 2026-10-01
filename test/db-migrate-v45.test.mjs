// test/db-migrate-v45.test.mjs
// v45: per-member PRs of a workspace run. The table arrives through INCREMENTAL_TABLES
// and the step backfills the one PR the old single-repo path could have recorded on a
// workspace row (always the primary member = the row's project_key).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

test('fresh DB has pipeline_member_prs', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 45);
  const cols = db.prepare('PRAGMA table_info(pipeline_member_prs)').all().map((c) => c.name);
  assert.deepEqual(cols, ['pipeline_id', 'member_key', 'pr_url', 'pr_number', 'pr_state', 'pr_checked_at']);
});

test('the ladder from 43 backfills workspace rows only, idempotently', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE pipeline_member_prs');
  db.prepare(`INSERT INTO pipelines (id, project_key, workspace_key, target, pr_url, pr_number, pr_state)
    VALUES ('w1', 'alpha-00000001', 'wks-a-00000001', 'workspace', 'https://github.com/o/a/pull/3', 3, 'MERGED')`).run();
  db.prepare(`INSERT INTO pipelines (id, project_key, target, pr_url) VALUES ('p1', 'beta-00000002', 'project', 'https://github.com/o/b/pull/4')`).run();
  db.exec('PRAGMA user_version = 43');
  migrate(db);
  const rows = db.prepare('SELECT pipeline_id, member_key, pr_url, pr_number, pr_state FROM pipeline_member_prs').all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { pipeline_id: 'w1', member_key: 'alpha-00000001', pr_url: 'https://github.com/o/a/pull/3', pr_number: 3, pr_state: 'MERGED' },
  ]);
  db.exec('PRAGMA user_version = 43');
  migrate(db);                                              // re-entering the step is harmless
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_member_prs').get().n, 1);
});

// M1 (v2 review): the backfill reads BASE columns (project_key, target) that the gap
// repair never adds. The hand-seeded fixture a dozen suites use (db-migrate-v29.test.mjs:18-20)
// must still migrate — a throw here rolls the whole BEGIN IMMEDIATE ladder back.
test('a minimal hand-seeded pipelines(id) DB migrates past v45 without throwing', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE pipelines (id TEXT PRIMARY KEY); CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);');
  db.exec('PRAGMA user_version = 17');
  assert.doesNotThrow(() => migrate(db));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const cols = db.prepare('PRAGMA table_info(pipeline_member_prs)').all().map((c) => c.name);
  assert.ok(cols.includes('member_key'), 'the table still arrives through INCREMENTAL_TABLES');
  db.close();
});

test('a pipelines table WITH project_key but WITHOUT target skips the backfill (stamped 43)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE pipelines (id TEXT PRIMARY KEY, project_key TEXT); CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);');
  db.exec('PRAGMA user_version = 43');
  assert.doesNotThrow(() => migrate(db));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipeline_member_prs').get().n, 0);
  db.close();
});
