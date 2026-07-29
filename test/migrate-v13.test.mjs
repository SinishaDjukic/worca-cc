// test/migrate-v13.test.mjs
//
// v13 adds the plugin task-source columns (plugin-system spec §10):
//   pipelines.source_type TEXT DEFAULT 'prompt'   -- 'prompt' | 'markdown' | 'plugin'
//   pipelines.source_ref  TEXT                    -- JSON {plugin,sourceId,taskId,url,title}; NULL unless plugin
//   workflows.origin      TEXT                    -- 'plugin:<name>' provenance; NULL = user-created
// The step is a CONDITIONAL repair (applySchemaV13 = repairSchemaGaps), not a plain
// DDL string: on any ladder pass from <12, applySchemaV12's version-independent heal
// has ALREADY added these columns (they live in INCREMENTAL_COLUMNS — repo hard rule
// after two recorded cross-branch stamp collisions), so an unconditional ALTER would
// throw "duplicate column". Structure mirrors test/migrate-v12.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, migrate } from '../src/core/db.mjs';

useTempHome(after);

// Minimal v12-era shapes for the two tables the v13 step touches. The version
// ladder only ALTERs existing tables; creating base tables is SCHEMA_V1's job.
const V12_MINIMAL_SEED = `
  CREATE TABLE pipelines (id TEXT PRIMARY KEY);
  CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
`;

test('fresh DB migrates to v13 with source columns + workflow origin, defaults correct', () => {
  const db = getDb(); // opens + migrates to SCHEMA_VERSION
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 13);
  const pipCols = db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name);
  assert.ok(pipCols.includes('source_type'), 'pipelines.source_type exists');
  assert.ok(pipCols.includes('source_ref'), 'pipelines.source_ref exists');
  const wfCols = db.prepare('PRAGMA table_info(workflows)').all().map((c) => c.name);
  assert.ok(wfCols.includes('origin'), 'workflows.origin exists');
  // Defaults: an INSERT that never mentions the new columns reads back 'prompt' / NULL.
  db.prepare("INSERT INTO pipelines (id, project_key) VALUES ('p1', 'k1')").run();
  const row = db.prepare("SELECT source_type, source_ref FROM pipelines WHERE id = 'p1'").get();
  assert.equal(row.source_type, 'prompt', "source_type defaults to 'prompt'");
  assert.equal(row.source_ref, null, 'source_ref defaults to NULL');
  db.prepare("INSERT INTO workflows (id, name, created_at, updated_at) VALUES ('wf1', 'W', 't0', 't0')").run();
  assert.equal(db.prepare("SELECT origin FROM workflows WHERE id = 'wf1'").get().origin, null,
    'origin defaults to NULL (user-created)');
});

test('a v12-stamped DB upgrades: columns added, pre-existing rows backfill the default', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(V12_MINIMAL_SEED);
  db.prepare("INSERT INTO pipelines (id) VALUES ('pre')").run();
  db.exec('PRAGMA user_version = 12');

  migrate(db);

  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 13);
  const row = db.prepare("SELECT source_type, source_ref FROM pipelines WHERE id = 'pre'").get();
  assert.equal(row.source_type, 'prompt', 'legacy row reads the ALTER default');
  assert.equal(row.source_ref, null);
  const wfCols = db.prepare('PRAGMA table_info(workflows)').all().map((c) => c.name);
  assert.ok(wfCols.includes('origin'), 'workflows.origin added');
});

// Cross-branch stamp collision (the recorded hazard on INCREMENTAL_COLUMNS): a
// divergent ladder stamped the shared DB AT this version but this build's columns
// are missing. migrate()'s fast path must heal them WITHOUT touching the stamp.
test('fast-path reconcile heals a v13-stamped DB missing columns (partial gap)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(V12_MINIMAL_SEED);
  db.exec('ALTER TABLE pipelines ADD COLUMN source_ref TEXT'); // present; source_type + origin missing
  db.exec('PRAGMA user_version = 13'); // stamped current: the ladder must no-op...

  migrate(db);

  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 13, 'stamp untouched');
  const pipCols = db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name);
  assert.ok(pipCols.includes('source_type'), 'source_type healed');
  assert.ok(pipCols.includes('source_ref'), 'pre-existing source_ref survived (no duplicate-column throw)');
  const wfCols = db.prepare('PRAGMA table_info(workflows)').all().map((c) => c.name);
  assert.ok(wfCols.includes('origin'), 'workflows.origin healed');
  // The HEALED column still carries its DEFAULT — proves the INCREMENTAL_COLUMNS
  // type string is "TEXT DEFAULT 'prompt'", not bare TEXT.
  db.prepare("INSERT INTO pipelines (id) VALUES ('x')").run();
  assert.equal(db.prepare("SELECT source_type FROM pipelines WHERE id = 'x'").get().source_type, 'prompt');
});

// Guards the applySchemaV13-is-conditional design: from <12, applySchemaV12's heal
// adds the v13 columns FIRST (they are in INCREMENTAL_COLUMNS); the v13 step must
// then no-op. If someone "simplifies" it to a plain ALTER string, this throws.
test('ladder from below 12 does not double-add the v13 columns', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE config_workflow_nodes (
      project_key TEXT NOT NULL, workflow_id TEXT NOT NULL, node_id TEXT NOT NULL,
      model TEXT, effort TEXT, fan_out INTEGER,
      PRIMARY KEY (project_key, workflow_id, node_id)
    );
    CREATE TABLE pipelines (id TEXT PRIMARY KEY);
    CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
    PRAGMA user_version = 11;
  `);
  migrate(db); // v12 heal adds source_*/origin, then the v13 step must no-op — not throw
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 13);
  const pipCols = db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name);
  assert.ok(pipCols.includes('source_type') && pipCols.includes('source_ref'));
});

test('migrate() is idempotent at v13 (second call is a clean no-op)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(V12_MINIMAL_SEED);
  db.exec('PRAGMA user_version = 12');
  migrate(db);
  migrate(db); // fast path + reconcile: must not throw duplicate column / table
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 13);
});
