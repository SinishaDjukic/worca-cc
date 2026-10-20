// test/db-migrate-v65.test.mjs — v65: run groups (the one new named state, runs redesign §3.3) and pipelines.deleted_at
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

test('v65 creates run_groups, run_group_members, pipelines.deleted_at and pipelines.pr_verdict', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 65);
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  assert.deepEqual(cols('run_groups'), ['id', 'title', 'project_key', 'created_by', 'created_at', 'updated_at']);
  assert.deepEqual(cols('run_group_members'), ['pipeline_id', 'group_id', 'position', 'added_by', 'added_at']);
  assert.ok(cols('pipelines').includes('deleted_at'));
  assert.ok(cols('pipelines').includes('pr_verdict'), 'the PR chip verdict (D31)');
  const pk = db.prepare('PRAGMA table_info(run_group_members)').all().filter((c) => c.pk).map((c) => c.name);
  assert.deepEqual(pk, ['pipeline_id'], 'one group at a time');
});

test('v65 upgrades a v64 DB (dev\'s source_path, no run groups yet)', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE run_group_members; DROP TABLE run_groups; PRAGMA user_version = 64');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'run_group_members'").get());
  assert.ok(db.prepare('PRAGMA table_info(ask_attachments)').all().some((c) => c.name === 'source_path'), 'dev\'s v64 column survives');
});
