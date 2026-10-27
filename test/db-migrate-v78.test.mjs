// test/db-migrate-v78.test.mjs — workflow history + named versions (plans/workflow-tests-plan.md Task 1, #721).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const REV_COLS = ['id', 'workflow_id', 'version_no', 'note', 'name', 'domain', 'graph', 'fingerprint', 'parts', 'source', 'made_by', 'created_at'];

test('fresh DB: workflow_revisions exists and workflows has live_version_no', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 78);
  assert.deepEqual(cols(db, 'workflow_revisions'), REV_COLS);
  assert.ok(cols(db, 'workflows').includes('live_version_no'));
});

test('a DB stamped 77 without them gets both and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('ALTER TABLE workflows DROP COLUMN live_version_no; DROP TABLE workflow_revisions; PRAGMA user_version = 77');
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'workflow_revisions'), REV_COLS);
  assert.ok(cols(db, 'workflows').includes('live_version_no'));
});

test('a named version number is unique per workflow; automatic snapshots (NULL) repeat freely', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const ins = db.prepare(`INSERT INTO workflow_revisions (workflow_id, version_no, name, graph, fingerprint, source, created_at)
    VALUES (?, ?, 'W', '{}', 'f', 'save', '2026-10-25T00:00:00Z')`);
  ins.run('wf_a', null); ins.run('wf_a', null); ins.run('wf_a', 1); ins.run('wf_b', 1);
  assert.throws(() => ins.run('wf_a', 1), /UNIQUE/);
});
