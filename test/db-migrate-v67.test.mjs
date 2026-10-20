import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

test('v67 adds run_labels to a v66 DB; one row per (run, label)', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE run_labels; PRAGMA user_version = 66');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 67);
  assert.deepEqual(db.prepare('PRAGMA table_info(run_labels)').all().map((c) => c.name), ['pipeline_id', 'label', 'added_at']);
  db.exec("INSERT INTO pipelines (id, project_key, target, status, phase, cycle) VALUES ('aaaa0001', 'p', 'project', 'done', 'done', 0)");
  const ins = db.prepare("INSERT INTO run_labels (pipeline_id, label, added_at) VALUES ('aaaa0001', ?, 'x')");
  ins.run('hotfix');
  assert.throws(() => ins.run('hotfix'), /UNIQUE|PRIMARY/);
});
