// test/db-migrate-v25.test.mjs
// v25 = the two sub-agent-model-policy columns. The ONLY real upgrade path for
// them is the LADDER: a DB stamped exactly 24 skips reconcileSchema (fast path
// requires user_version >= SCHEMA_VERSION), so applySchemaV25's repairSchemaGaps
// call is load-bearing — delete it and a stamped-24 DB gets stamped 25 with both
// columns missing (upsertSubAgent then no-ops into its catch; GET /api/config
// 500s on `no such column`). This file pins exactly that path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, SCHEMA_VERSION, _resetForTests } from '../src/core/db.mjs';

useTempHome(after);

const cols = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);

test('a DB stamped exactly 24 gains both v25 columns through the ladder, not reconcile', () => {
  let db = getDb();                       // fresh DB at SCHEMA_VERSION
  assert.ok(SCHEMA_VERSION >= 25, 'the v25 step is on the ladder');
  assert.ok(cols(db, 'sub_agents').includes('run_model'));
  assert.ok(cols(db, 'config_workflow_nodes').includes('subagent_model'));

  // Rewind to a faithful v24 DB: drop the two columns, stamp 24, reopen.
  db.exec('ALTER TABLE sub_agents DROP COLUMN run_model');
  db.exec('ALTER TABLE config_workflow_nodes DROP COLUMN subagent_model');
  db.exec('PRAGMA user_version = 24');
  _resetForTests();

  db = getDb();                           // migrate() takes the 24 -> 25 ladder
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(cols(db, 'sub_agents').includes('run_model'),
    'run_model restored by applySchemaV25 (the ladder is the only repair on this path)');
  assert.ok(cols(db, 'config_workflow_nodes').includes('subagent_model'),
    'subagent_model restored by applySchemaV25');
});
