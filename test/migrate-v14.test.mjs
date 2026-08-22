// test/migrate-v14.test.mjs
//
// v14 adds the named-guardrail-sets entity storage (guardrails-entity spec, per-run model):
//   guardrail_sets table            -- named sets; the built-ins (permissive/normal/secure) are NEVER rows
//   pipelines.guardrails_id TEXT    -- the run's selected set id (Phase 2); NULL = legacy/pre-entity row
// The step is a CONDITIONAL repair (applySchemaV14 = repairSchemaGaps), not a plain
// DDL string: guardrails_id lives in INCREMENTAL_COLUMNS and guardrail_sets in the
// schemaGaps table flags (repo hard rule after two recorded cross-branch stamp
// collisions), so on any ladder pass from <12 the earlier heals have ALREADY added
// them — an unconditional ALTER/CREATE would throw. Structure mirrors test/migrate-v13.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, migrate } from '../src/core/db.mjs';

useTempHome(after);

// Minimal v13-era shapes for the tables the v14 step touches. The version ladder
// only ALTERs existing tables (creating base tables is SCHEMA_V1's job);
// guardrail_sets is the exception — an IF-NOT-EXISTS DDL asserted by the repair.
const V13_MINIMAL_SEED = `
  CREATE TABLE pipelines (id TEXT PRIMARY KEY);
  CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
`;

test('fresh DB migrates to v14 with the guardrail_sets table + pipelines.guardrails_id', () => {
  const db = getDb(); // opens + migrates to SCHEMA_VERSION
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
  const pipCols = db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name);
  assert.ok(pipCols.includes('guardrails_id'), 'pipelines.guardrails_id exists');
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='guardrail_sets'").get().n,
    1, 'guardrail_sets table exists',
  );
  const setCols = db.prepare('PRAGMA table_info(guardrail_sets)').all().map((c) => c.name);
  assert.deepEqual(setCols, ['id', 'name', 'settings', 'origin', 'created_at', 'updated_at']);
  // An INSERT that never mentions the new column reads back NULL (legacy row).
  db.prepare("INSERT INTO pipelines (id, project_key) VALUES ('p1', 'k1')").run();
  assert.equal(db.prepare("SELECT guardrails_id FROM pipelines WHERE id = 'p1'").get().guardrails_id, null);
});

test('a v13-stamped DB upgrades: column + table added, pre-existing rows read NULL', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(V13_MINIMAL_SEED);
  db.prepare("INSERT INTO pipelines (id) VALUES ('pre')").run();
  db.exec('PRAGMA user_version = 13');

  migrate(db);

  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
  assert.equal(db.prepare("SELECT guardrails_id FROM pipelines WHERE id = 'pre'").get().guardrails_id, null,
    'legacy row reads NULL (selection unknown)');
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='guardrail_sets'").get().n,
    1, 'guardrail_sets created');
});

test('a current-stamped DB missing the additions is healed by the fast-path reconcile, stamp untouched', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(V13_MINIMAL_SEED);
  db.exec('PRAGMA user_version = 18'); // divergent-ladder stamp: version says done, schema says otherwise

  migrate(db); // fast path -> reconcileSchema self-heal

  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18, 'stamp not rewritten');
  const pipCols = db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name);
  assert.ok(pipCols.includes('guardrails_id'), 'column healed');
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='guardrail_sets'").get().n,
    1, 'table healed');
});

test('ladder from below 13 does not double-add the v14 additions (conditional-repair guard)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(V13_MINIMAL_SEED);
  db.exec('PRAGMA user_version = 12');
  // From stamp 12 the ladder runs only the `current < 13` / `current < 14` steps
  // (applySchemaV12 does NOT run); applySchemaV13's conditional heal adds EVERY
  // INCREMENTAL_COLUMNS gap (including guardrails_id) and asserts the flagged
  // tables BEFORE the v14 step runs. If someone "simplifies" applySchemaV14 to a
  // plain ALTER/CREATE string, this throws "duplicate column" / "table already exists".
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
});

test('migrate() is idempotent (second call is a clean no-op)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(V13_MINIMAL_SEED);
  db.exec('PRAGMA user_version = 13');
  migrate(db);
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
});
