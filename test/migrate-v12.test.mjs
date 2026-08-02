// test/migrate-v12.test.mjs
//
// v12 is a REPAIR migration for a cross-branch schema-version collision: the
// ai-enablement-onboarding branch minted its own SCHEMA_VERSION=11 as a DATA-ONLY
// step (workflow seed, no DDL) and stamped the shared ~/.worca-cc DB, so this
// branch's v11 DDL (ask_questions column + step_questions table) was skipped
// forever by the versioned fast path. v12 re-applies the v11 DDL conditionally
// (probe pragma_table_info before ALTER; CREATE TABLE IF NOT EXISTS), so it is a
// no-op on a correct v11 DB and a fix on a stale-stamped one. migrate()'s fast
// path additionally self-heals the same gaps version-independently
// (reconcileSchema) so a FUTURE colliding ladder cannot re-create the dead state.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, migrate, _resetForTests } from '../src/core/db.mjs';

useTempHome(after);

const V10_NODES_SEED = `
  CREATE TABLE config_workflow_nodes (
    project_key TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    node_id     TEXT NOT NULL,
    model       TEXT,
    effort      TEXT,
    fan_out     INTEGER,
    PRIMARY KEY (project_key, workflow_id, node_id)
  );
  CREATE TABLE pipelines (id TEXT PRIMARY KEY);
`;

test('fresh DB migrates to v12 with ask_questions + step_questions present', () => {
  const db = getDb(); // opens + migrates to SCHEMA_VERSION
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 14);
  const cols = db.prepare('PRAGMA table_info(config_workflow_nodes)').all().map((c) => c.name);
  assert.ok(cols.includes('ask_questions'), 'ask_questions column exists');
  const tbl = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='step_questions'").get();
  assert.equal(tbl.n, 1, 'step_questions table exists');
});

test('repairs a stale-stamped v11 DB (version says 11, v11 DDL never ran)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(V10_NODES_SEED);
  db.exec('PRAGMA user_version = 11'); // stamped, but no ask_questions / step_questions
  db.prepare("INSERT INTO config_workflow_nodes (project_key, workflow_id, node_id, model) VALUES ('k1','wf1','n1','opus')").run();

  migrate(db);

  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 14);
  const cols = db.prepare('PRAGMA table_info(config_workflow_nodes)').all().map((c) => c.name);
  assert.ok(cols.includes('ask_questions'), 'repair added ask_questions');
  const tbl = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='step_questions'").get();
  assert.equal(tbl.n, 1, 'repair created step_questions');
  // Existing rows survive with the new column NULL (= inherit manifest default).
  const row = db.prepare('SELECT model, ask_questions FROM config_workflow_nodes WHERE node_id = ?').get('n1');
  assert.equal(row.model, 'opus');
  assert.equal(row.ask_questions, null);
});

// The PRODUCTION path: a stale-stamped file DB at WORCA_HOME must heal on plain
// getDb() (open → migrate), exactly what a server restart does on the live DB.
test('getDb() repairs a stale-stamped on-disk DB at WORCA_HOME', () => {
  const prevHome = process.env.WORCA_HOME;
  const home = mkdtempSync(join(tmpdir(), 'worca-cc-v12-'));
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  const seed = new DatabaseSync(join(home, '.worca-cc', 'worca-cc.db'));
  seed.exec(V10_NODES_SEED);
  seed.exec('PRAGMA user_version = 11');
  seed.close();
  process.env.WORCA_HOME = home;
  _resetForTests();
  try {
    const db = getDb();
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 14);
    const cols = db.prepare('PRAGMA table_info(config_workflow_nodes)').all().map((c) => c.name);
    assert.ok(cols.includes('ask_questions'));
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='step_questions'").get().n, 1);
  } finally {
    process.env.WORCA_HOME = prevHome;
    _resetForTests(); // next getDb() reopens against the suite's temp home
  }
});

// Future-collision guard: a DB stamped AT (or past) the current version by some
// divergent ladder still self-heals on the fast path, version-independently.
test('fast-path reconcile heals missing column/table on a DB already stamped to the current version', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(V10_NODES_SEED);
  db.exec('CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT)'); // pre-`domain` shape
  db.exec('PRAGMA user_version = 14'); // stamped current: the ladder must no-op...
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 14, 'stamp untouched');
  // ...yet the incremental gaps are healed anyway.
  const nodeCols = db.prepare('PRAGMA table_info(config_workflow_nodes)').all().map((c) => c.name);
  assert.ok(nodeCols.includes('ask_questions'), 'ask_questions healed');
  const wfCols = db.prepare('PRAGMA table_info(workflows)').all().map((c) => c.name);
  assert.ok(wfCols.includes('domain'), 'workflows.domain healed');
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='step_questions'").get().n, 1, 'step_questions healed');
});

test('no-op on a correctly-migrated v11 DB (no duplicate-column / existing-table errors)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(V10_NODES_SEED);
  db.exec(`
    ALTER TABLE config_workflow_nodes ADD COLUMN ask_questions INTEGER;
    CREATE TABLE step_questions (
      pipeline_id TEXT NOT NULL,
      step_key    TEXT NOT NULL,
      round       INTEGER NOT NULL,
      node_id     TEXT,
      agent_key   TEXT,
      questions   TEXT,
      answers     TEXT,
      PRIMARY KEY (pipeline_id, step_key, round),
      FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE
    );
    PRAGMA user_version = 11;
  `);
  db.prepare("INSERT INTO config_workflow_nodes (project_key, workflow_id, node_id, ask_questions) VALUES ('k1','wf1','n1',1)").run();
  db.prepare("INSERT INTO pipelines (id) VALUES ('p1')").run(); // FK parent (node:sqlite enforces FKs by default)
  db.prepare("INSERT INTO step_questions (pipeline_id, step_key, round) VALUES ('p1','0:n1',1)").run();

  migrate(db); // must not throw (duplicate column / table exists)

  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 14);
  // Existing data in both v11 structures is untouched.
  assert.equal(db.prepare('SELECT ask_questions FROM config_workflow_nodes WHERE node_id = ?').get('n1').ask_questions, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM step_questions').get().n, 1);
});
