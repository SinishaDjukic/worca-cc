import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, SCHEMA_VERSION, _resetForTests } from '../src/core/db.mjs';

useTempHome(after);

test('a DB stamped 27 (no human_in_loop column) gains the column with default 1 and every project flips to wf_auto once', () => {
  let db = getDb();
  assert.ok(SCHEMA_VERSION >= 28);
  db.prepare("INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra) VALUES ('p1', '{}', '[]', 'wf_default', '{}')").run();
  db.prepare("INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra) VALUES ('p2', '{\"planner\":{\"effort\":\"max\"}}', '[]', 'wf_quick-fix', '{\"webUiTesting\":true}')").run();
  db.prepare("INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra) VALUES ('p3', '{}', '[]', NULL, '{}')").run();
  // A faithful 27 DB LACKS the column (a fresh test DB is already at 28 with it):
  // drop it so the ladder really has to add it and backfill the default.
  db.exec('ALTER TABLE project_config DROP COLUMN human_in_loop');
  db.exec('PRAGMA user_version = 27');
  _resetForTests();

  db = getDb();                                   // 27 -> 28 on the ladder
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const cols = db.prepare('PRAGMA table_info(project_config)').all().map((c) => c.name);
  assert.ok(cols.includes('human_in_loop'));
  const rows = db.prepare('SELECT project_key, active_workflow_id, human_in_loop, steps, extra FROM project_config ORDER BY project_key').all();
  assert.deepEqual(rows.map((r) => [r.project_key, r.active_workflow_id, r.human_in_loop]), [['p1', 'wf_auto', 1], ['p2', 'wf_auto', 1], ['p3', 'wf_auto', 1]]);
  assert.equal(rows[1].steps, '{"planner":{"effort":"max"}}', 'sibling columns are untouched');
  assert.equal(rows[1].extra, '{"webUiTesting":true}');

  // The flip is a ONE-TIME ladder step: a later choice survives a reopen.
  db.prepare("UPDATE project_config SET active_workflow_id = 'wf_quick-fix' WHERE project_key = 'p2'").run();
  _resetForTests();
  db = getDb();
  assert.equal(db.prepare("SELECT active_workflow_id FROM project_config WHERE project_key = 'p2'").get().active_workflow_id, 'wf_quick-fix');
});

test('after the ladder the column is present, NOT NULL, default 1', () => {
  _resetForTests();
  const db = getDb();
  const col = db.prepare('PRAGMA table_info(project_config)').all().find((c) => c.name === 'human_in_loop');
  assert.ok(col);
  assert.equal(Number(col.dflt_value), 1);
  assert.equal(col.notnull, 1);
});
