import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

test('fresh DB has PR watch ownership tables', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.equal(SCHEMA_VERSION, 55);
  assert.deepEqual(db.prepare('PRAGMA table_info(pr_watches)').all().map((c) => c.name), [
    'pr_url', 'pipeline_id', 'member_key', 'push_remote', 'enabled', 'status', 'reason',
    'fix_runs', 'active_run_id', 'active_pipeline_id', 'handled', 'pending', 'retry_state',
    'enabled_by', 'updated_at',
  ]);
  assert.deepEqual(db.prepare('PRAGMA table_info(pr_watch_runs)').all().map((c) => c.name), [
    'run_id', 'pr_url', 'pipeline_id', 'created_at',
  ]);
});

test('v54 migration creates PR watch tables and cascades watch history', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE pr_watch_runs; DROP TABLE pr_watches; PRAGMA user_version = 54');
  migrate(db);
  db.prepare("INSERT INTO pipelines (id, project_key) VALUES ('origin', 'p')").run();
  db.prepare("INSERT INTO pr_watches(pr_url,pipeline_id,updated_at) VALUES ('https://github.com/o/r/pull/1','origin','now')").run();
  db.prepare("INSERT INTO pr_watch_runs(run_id,pr_url,created_at) VALUES ('fix','https://github.com/o/r/pull/1','now')").run();
  db.prepare("DELETE FROM pipelines WHERE id='origin'").run();
  assert.equal(db.prepare('SELECT count(*) n FROM pr_watches').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM pr_watch_runs').get().n, 0);
});

test('a DB already holding the PR watch tables at v54 migrates to v55 unchanged', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare("INSERT INTO pipelines (id, project_key) VALUES ('origin', 'p')").run();
  db.prepare("INSERT INTO pr_watches(pr_url,pipeline_id,updated_at) VALUES ('https://github.com/o/r/pull/2','origin','now')").run();
  db.exec('PRAGMA user_version = 54');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 55);
  assert.equal(db.prepare('SELECT count(*) n FROM pr_watches').get().n, 1);
});
