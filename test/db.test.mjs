// test/db.test.mjs
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import { getDb, closeDb, _resetForTests, tx, migrate, SCHEMA_VERSION } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { _migrateFromFsCallCount, _resetMigrateFromFsCallCount } from '../src/core/migrate-fs-to-db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { checkRows } from './helpers/rows.mjs';

// Each test gets its own WORCA_HOME so the singleton DB path is fresh and
// isolated; _resetForTests() drops the cached handle so the next getDb() reopens
// against the new home. Mirrors the temp-home discipline in projects.test.mjs.
// A14: realpath() canonicalizes the temp dir so db.location() (which resolves
// symlinks on macOS) agrees with worcaHome() (which does not canonicalize).
const homes = [];
async function freshHome() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-db-')));
  homes.push(dir);
  _resetForTests();
  _resetMigrateFromFsCallCount();
  process.env.WORCA_HOME = dir;
  return dir;
}

beforeEach(async () => {
  await freshHome();
});

after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

test('getDb() lifecycle: opens <worcaHome>/worca-cc.db, is a singleton, and reopens a fresh handle after closeDb()', async () => {
  await checkRows([
    { name: 'getDb() opens a DatabaseSync at <worcaHome>/worca-cc.db', run: () => {
      const db = getDb();
      assert.ok(db, 'getDb() returns a handle');
      const dbPath = join(worcaHome(), 'worca-cc.db');
      assert.equal(db.location(), dbPath, 'db.location() is <worcaHome>/worca-cc.db');
      assert.ok(existsSync(dbPath), 'the db file is created on disk');
    } },
    { name: 'getDb() is a singleton — same handle across calls', run: () => {
      assert.equal(getDb(), getDb(), 'repeated getDb() returns the same instance');
    } },
    { name: 'closeDb() then getDb() reopens a fresh handle', run: () => {
      const a = getDb();
      closeDb();
      const b = getDb();
      assert.notEqual(a, b, 'a new handle is created after closeDb()');
    } },
  ]);
});

test('first open sets the required pragmas', () => {
  const db = getDb();
  const jm = db.prepare('PRAGMA journal_mode').get();
  assert.equal(String(jm.journal_mode).toLowerCase(), 'wal', 'journal_mode=WAL');

  const fk = db.prepare('PRAGMA foreign_keys').get();
  assert.equal(fk.foreign_keys, 1, 'foreign_keys=ON');

  const bt = db.prepare('PRAGMA busy_timeout').get();
  assert.equal(bt.timeout, 5000, 'busy_timeout=5000ms');

  const sy = db.prepare('PRAGMA synchronous').get();
  assert.equal(sy.synchronous, 1, 'synchronous=NORMAL (1)');
});

// The full set of tables the spec's schema (§3) requires.
const EXPECTED_TABLES = [
  'projects',
  'workspaces',
  'workspace_projects',
  'workflows',
  'project_config',
  'config_workflow_nodes',
  'config_workflow_feedbacks',
  'config_workflow_wires',
  'pipelines',
  'pipeline_steps',
  'pipeline_events',
  'clarify',
  'reviews',
  'store_meta',
  'artifacts',
  'sub_agents',
  'pipeline_phases',
  'pipeline_tasks',
  'step_questions',
];

// Every index the spec mandates (pipelines fan-out indexes, append-only event
// index). Names are stable contracts other phases' EXPLAIN-tuning may rely on.
const EXPECTED_INDEXES = [
  'idx_pipelines_project_started',
  'idx_pipelines_workspace_started',
  'idx_pipelines_status',
  'idx_pipeline_events_pipeline',
  'idx_sub_agents_pipeline',
  'idx_sub_agents_step',
];

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}

function indexNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}

const colsOf = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const hasBindings = (db) => db.prepare(
  "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='source_bindings'"
).get().n === 1;
const NIGHT_COLS = ['id', 'pipeline_id', 'question_id', 'kind', 'ts', 'record'];
// v34 (run chains): scheduled_runs.after_kind/after_id/after_policy/source_from_previous + the after_id index.
const AFTER_COLS = ['after_kind', 'after_id', 'after_policy', 'source_from_previous'];
const scheduledRunCols = (db) => db.prepare('PRAGMA table_info(scheduled_runs)').all().map((c) => c.name);
const hasAfterIndex = (db) => !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_scheduled_runs_after'").get();
// The index FIRST: SQLite refuses to drop a column an index names.
const dropAfter = (db) => {
  db.exec('DROP INDEX IF EXISTS idx_scheduled_runs_after');
  for (const c of AFTER_COLS) db.exec(`ALTER TABLE scheduled_runs DROP COLUMN ${c}`);
};

test('a fresh DB carries every spec table, index and incremental column/table with its declared shape and defaults, stamped SCHEMA_VERSION', async () => {
  await checkRows([
    { name: 'migrate creates all 19 spec tables', run: () => {
      const db = getDb();
      const present = new Set(tableNames(db));
      for (const t of EXPECTED_TABLES) {
        assert.ok(present.has(t), `table "${t}" is present`);
      }
      assert.equal(EXPECTED_TABLES.length, 19, 'the spec defines exactly 19 tables (v23: +config_workflow_wires)');
    } },
    { name: 'migrate creates every required index', run: () => {
      const db = getDb();
      const present = new Set(indexNames(db));
      for (const ix of EXPECTED_INDEXES) {
        assert.ok(present.has(ix), `index "${ix}" is present`);
      }
    } },
    { name: 'migrate stamps user_version = SCHEMA_VERSION', run: () => {
      const db = getDb();
      const { user_version } = db.prepare('PRAGMA user_version').get();
      assert.equal(user_version, SCHEMA_VERSION, 'schema version is current after migrate');
    } },
    { name: 'migrate() reaches v11 and adds workflows.domain + liveness columns', run: () => {
      const db = getDb();                                   // triggers migrate()
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      const wfCols = db.prepare('PRAGMA table_info(workflows)').all().map((c) => c.name);
      assert.ok(wfCols.includes('domain'), 'workflows.domain column exists');
      const pipCols = db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name);
      for (const c of ['owner_pid', 'owner_host', 'heartbeat_at']) {
        assert.ok(pipCols.includes(c), `pipelines.${c} column exists`);
      }
    } },
    { name: 'v8 DB upgrades in place and pre-migration rows survive', run: () => {
      const db = getDb();
      db.exec("INSERT INTO workflows (id,name,version,steps,feedbacks,created_at,updated_at) " +
              "VALUES ('wf_legacy','Legacy',1,'[]','[]','1970-01-01T00:00:00.000Z','1970-01-01T00:00:00.000Z')");
      const row = db.prepare('SELECT domain FROM workflows WHERE id = ?').get('wf_legacy');
      assert.equal(row.domain, null);                       // stored NULL; store layer COALESCEs to 'general'
    } },
    { name: 'v4 adds pipeline_phases + pipeline_tasks with expected columns', run: () => {
      const db = getDb();
      const phaseCols = db.prepare('PRAGMA table_info(pipeline_phases)').all().map((c) => c.name);
      assert.deepEqual(phaseCols, ['pipeline_id', 'ordinal', 'status', 'started_at', 'finished_at']);
      const taskCols = db.prepare('PRAGMA table_info(pipeline_tasks)').all().map((c) => c.name);
      assert.deepEqual(taskCols, [
        'pipeline_id', 'id', 'phase_ordinal', 'task_index', 'title',
        'file_rel_path', 'node_id', 'status', 'started_at', 'finished_at',
      ]);
    } },
    // The fresh-DB halves of the per-version migration files (db-pause-schema, migrate-v10 to v18,
    // db-migrate-v30 to v48). Their ladder and self-heal halves are rows of the tests below.
    { name: 'v5 adds resume_point and session_id columns', run: () => {
      const db = getDb();
      assert.ok(colsOf(db, 'pipelines').includes('resume_point'), 'pipelines.resume_point exists');
      assert.ok(colsOf(db, 'pipeline_steps').includes('session_id'), 'pipeline_steps.session_id exists');
    } },
    { name: 'v10 adds nullable owner_pid/owner_host/heartbeat_at; user_version becomes the current version', run: () => {
      const cols = colsOf(getDb(), 'pipelines');
      for (const c of ['owner_pid', 'owner_host', 'heartbeat_at']) assert.ok(cols.includes(c), c);
    } },
    { name: 'fresh DB migrates to v12 with ask_questions + step_questions present', run: () => {
      const db = getDb();
      assert.ok(colsOf(db, 'config_workflow_nodes').includes('ask_questions'), 'ask_questions column exists');
      const tbl = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='step_questions'").get();
      assert.equal(tbl.n, 1, 'step_questions table exists');
      assert.deepEqual(colsOf(db, 'step_questions'),
        ['pipeline_id', 'step_key', 'round', 'node_id', 'agent_key', 'questions', 'answers'], 'STEP_QUESTIONS_DDL columns');
    } },
    { name: 'fresh DB migrates to v13 with source columns + workflow origin, defaults correct', run: () => {
      const db = getDb();
      const pipCols = colsOf(db, 'pipelines');
      assert.ok(pipCols.includes('source_type'), 'pipelines.source_type exists');
      assert.ok(pipCols.includes('source_ref'), 'pipelines.source_ref exists');
      assert.ok(colsOf(db, 'workflows').includes('origin'), 'workflows.origin exists');
      // Defaults: an INSERT that never mentions the new columns reads back 'prompt' / NULL.
      db.prepare("INSERT INTO pipelines (id, project_key) VALUES ('p-v13', 'k1')").run();
      const row = db.prepare("SELECT source_type, source_ref FROM pipelines WHERE id = 'p-v13'").get();
      assert.equal(row.source_type, 'prompt', "source_type defaults to 'prompt'");
      assert.equal(row.source_ref, null, 'source_ref defaults to NULL');
      db.prepare("INSERT INTO workflows (id, name, created_at, updated_at) VALUES ('wf1', 'W', 't0', 't0')").run();
      assert.equal(db.prepare("SELECT origin FROM workflows WHERE id = 'wf1'").get().origin, null,
        'origin defaults to NULL (user-created)');
    } },
    { name: 'fresh DB migrates to v14 with the guardrail_sets table + pipelines.guardrails_id', run: () => {
      const db = getDb();
      assert.ok(colsOf(db, 'pipelines').includes('guardrails_id'), 'pipelines.guardrails_id exists');
      assert.equal(
        db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='guardrail_sets'").get().n,
        1, 'guardrail_sets table exists',
      );
      assert.deepEqual(colsOf(db, 'guardrail_sets'), ['id', 'name', 'settings', 'origin', 'created_at', 'updated_at']);
      // An INSERT that never mentions the new column reads back NULL (legacy row).
      db.prepare("INSERT INTO pipelines (id, project_key) VALUES ('p-v14', 'k1')").run();
      assert.equal(db.prepare("SELECT guardrails_id FROM pipelines WHERE id = 'p-v14'").get().guardrails_id, null);
    } },
    { name: 'fresh DB lands on the current user_version with cost_ledger and the six new pipelines columns', run: () => {
      const db = getDb();
      const ledger = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='cost_ledger'").get();
      assert.ok(ledger, 'cost_ledger exists');
      assert.deepEqual(colsOf(db, 'cost_ledger'), ['id', 'pipeline_id', 'step_key', 'amount_usd', 'ts']);
      const idx = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_cost_ledger_ts'").get();
      assert.ok(idx, 'idx_cost_ledger_ts exists');
      for (const c of ['archived_at', 'cost_cap_override', 'pr_url', 'pr_number', 'pr_state', 'pr_checked_at']) {
        assert.ok(colsOf(db, 'pipelines').includes(c), `pipelines.${c} exists`);
      }
    } },
    { name: 'cost_cap_override defaults to 0 and archived_at to NULL on new rows', run: async () => {
      // A bare INSERT reads the declared DEFAULTs; the production writer (writeState) agrees.
      const db = getDb();
      db.prepare("INSERT INTO pipelines (id, project_key) VALUES ('p-v15', 'k1')").run();
      const bare = db.prepare('SELECT archived_at, cost_cap_override FROM pipelines WHERE id = ?').get('p-v15');
      assert.equal(bare.archived_at, null);
      assert.equal(bare.cost_cap_override, 0);
      const { id } = await seedPipeline('/tmp/proj-a', { status: 'done' });
      const row = getDb().prepare(
        'SELECT archived_at, cost_cap_override FROM pipelines WHERE id = ?').get(id);
      assert.equal(row.archived_at, null);
      assert.equal(row.cost_cap_override, 0);
    } },
    { name: 'fresh DB migrates to the current version with the source_bindings table', run: () => {
      const db = getDb();
      assert.ok(hasBindings(db), 'source_bindings table exists');
      assert.deepEqual(colsOf(db, 'source_bindings'), ['scope_type', 'scope_key', 'plugin', 'source_id', 'profile', 'updated_at']);
    } },
    { name: 'v30 adds nullable workspaces.metrics_project on a fresh DB', run: () => {
      assert.ok(SCHEMA_VERSION >= 30);
      assert.ok(colsOf(getDb(), 'workspaces').includes('metrics_project'));
    } },
    { name: 'v33 adds the three columns on a fresh DB; human_hours defaults to 0 on the run row', run: () => {
      assert.ok(SCHEMA_VERSION >= 33);
      const db = getDb();
      assert.ok(colsOf(db, 'pipelines').includes('human_hours'));
      assert.ok(colsOf(db, 'pipeline_steps').includes('human_hours'));
      assert.ok(colsOf(db, 'pipeline_steps').includes('human_signals'));
      db.prepare("INSERT INTO pipelines (id, project_key, status) VALUES ('p-v33', 'k', 'done')").run();
      assert.equal(db.prepare("SELECT human_hours FROM pipelines WHERE id = 'p-v33'").get().human_hours, 0);
    } },
    { name: 'a fresh DB has the four columns and the index from the DDL', run: () => {
      const db = getDb();
      const names = scheduledRunCols(db);
      for (const c of AFTER_COLS) assert.ok(names.includes(c), c);
      assert.ok(hasAfterIndex(db));
      const pol = db.prepare('PRAGMA table_info(scheduled_runs)').all().find((c) => c.name === 'after_policy');
      assert.equal(pol.notnull, 1);
      assert.equal(String(pol.dflt_value).replace(/'/g, ''), 'done');
    } },
    { name: 'v40 adds the three nullable workspace-map columns on a fresh DB', run: () => {
      assert.ok(SCHEMA_VERSION >= 40);
      for (const c of ['map_json', 'map_overrides_json', 'description_origin']) assert.ok(colsOf(getDb(), 'workspaces').includes(c), c);
    } },
    { name: 'a fresh DB has resume_pipeline_id from the DDL', run: () => {
      assert.ok(scheduledRunCols(getDb()).includes('resume_pipeline_id'));
    } },
    { name: 'v45 adds the nullable ask_threads.mcp_off on a fresh DB', run: () => {
      assert.ok(SCHEMA_VERSION >= 45);
      assert.ok(colsOf(getDb(), 'ask_threads').includes('mcp_off'));
    } },
    { name: 'v47 adds workspaces.actions_json (fresh-DB half of test/db-migrate-v47.test.mjs)', run: () => {
      assert.ok(SCHEMA_VERSION >= 47);
      assert.ok(colsOf(getDb(), 'workspaces').includes('actions_json'));
    } },
    { name: 'v54 adds ask_threads.mode + composer on a fresh DB', run: () => {
      assert.ok(SCHEMA_VERSION >= 54);
      for (const c of ['mode', 'composer']) assert.ok(colsOf(getDb(), 'ask_threads').includes(c), c);
    } },
    { name: 'a DB stamped 47 gains night_decisions through the ladder (fresh-DB half: the exact column list)', run: () => {
      assert.ok(SCHEMA_VERSION >= 48);
      const db = getDb();
      assert.deepEqual(colsOf(db, 'night_decisions'), NIGHT_COLS);
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_night_decisions_pipeline'").get());
    } },
  ]);
});

test('migrate() is idempotent — second run is a no-op, version stable', () => {
  const db = getDb();
  const before = db.prepare('PRAGMA user_version').get().user_version;
  const tablesBefore = tableNames(db).length;
  // Re-import migrate and run it again directly on the same handle.
  assert.doesNotThrow(() => migrate(db), 'second migrate() does not throw');
  const after = db.prepare('PRAGMA user_version').get().user_version;
  assert.equal(after, before, 'user_version is unchanged by a second migrate()');
  assert.equal(tableNames(db).length, tablesBefore, 'no duplicate/extra tables');
});

// ── Incremental schema ladder ─────────────────────────────────────────────────────
// One table replaces the per-version files (db-migrate-v30/v33/v34/v40/v44/v45/v48,
// migrate-v10/v12/v13/v14/v15/v18, the schema arms of migrate-v20, db-migrate-v47 and
// db-pause-schema). Every rung from v12 up funnels through repairSchemaGaps, so one
// removal + one migrate() proves each addition, from the rung below it AND from its own
// rung (the hoisted `if (current < SCHEMA_VERSION) repairSchemaGaps` is the only thing
// that brings it back there). The ladder arm runs only on rungs >= 25: a FULL DB stamped
// < 24 would run applySchemaV24's v1 workflow sweep over it, so the older rungs climb
// from the minimal seeds further down instead.
const RUNGS = [
  { v: 5, cols: [['pipelines', 'resume_point', null], ['pipeline_steps', 'session_id', null]] },
  { v: 10, cols: [['pipelines', 'owner_pid', null], ['pipelines', 'owner_host', null], ['pipelines', 'heartbeat_at', null]] },
  { v: 15, cols: [['pipelines', 'archived_at', null], ['pipelines', 'cost_cap_override', 0], ['pipelines', 'pr_url', null],
    ['pipelines', 'pr_number', null], ['pipelines', 'pr_state', null], ['pipelines', 'pr_checked_at', null]],
    tables: [['cost_ledger', ['idx_cost_ledger_ts']]] },
  // Dropping ONLY this table on an otherwise-healthy DB pins its INCREMENTAL_TABLES entry in
  // reconcileSchema's clean-path early return.
  { v: 20, tables: [['ask_cost_ledger', ['idx_ask_cost_ledger_ts']]] },
  { v: 30, cols: [['workspaces', 'metrics_project', null]] },
  { v: 33, cols: [['pipelines', 'human_hours', 0], ['pipeline_steps', 'human_hours', null], ['pipeline_steps', 'human_signals', null]] },
  // The index FIRST: SQLite refuses to drop a column an index names.
  { v: 34, indexes: ['idx_scheduled_runs_after'], cols: [['scheduled_runs', 'after_kind', null], ['scheduled_runs', 'after_id', null],
    ['scheduled_runs', 'after_policy', 'done'], ['scheduled_runs', 'source_from_previous', 0]] },
  { v: 40, cols: [['workspaces', 'map_json', null], ['workspaces', 'map_overrides_json', null], ['workspaces', 'description_origin', null]] },
  // v44/v45 were minted on two branches at once: a DB stamped 44 by either side lacks the
  // other's column, so both rungs climb from 44 (v44's own rung, v45's rung below).
  { v: 44, cols: [['scheduled_runs', 'resume_pipeline_id', null]] },
  { v: 45, cols: [['ask_threads', 'mcp_off', null]] },
  { v: 46, cols: [['ask_threads', 'contexts', null]] },
  { v: 47, cols: [['workspaces', 'actions_json', null]] },
  // The old night-mode branch stamped 44/46/47 with night_decisions already present: the
  // own-rung arms of v44..v47 re-run V48's IF NOT EXISTS DDL over the existing table and its
  // seeded row (HOST_ROWS) must survive.
  { v: 48, tables: [['night_decisions', ['idx_night_decisions_pipeline']]] },
  { v: 54, cols: [['ask_threads', 'mode', null], ['ask_threads', 'composer', null]] },
];

// One row per host table, written before the removal: every one must survive the climb,
// and each restored column reads NULL or its DEFAULT on it.
const HOST_ROWS = [
  ['pipelines', 'status', 'done', "INSERT INTO pipelines (id, project_key, status) VALUES ('c0ffee01', 'k', 'done')"],
  ['pipeline_steps', 'status', 'done', "INSERT INTO pipeline_steps (pipeline_id, key, status) VALUES ('c0ffee01', '0:s0_0', 'done')"],
  ['workspaces', 'description', 'kept', "INSERT INTO workspaces (id, name, description, created_at, updated_at) VALUES ('wks-a-00000000', 'A', 'kept', 't', 't')"],
  ['ask_threads', 'title', 'kept', "INSERT INTO ask_threads (id, title, created_at, updated_at) VALUES ('ask_00000001', 'kept', 't', 't')"],
  ['scheduled_runs', 'request', '{}', "INSERT INTO scheduled_runs (id, run_at, request, created_at, updated_at) VALUES ('tkt-00000001', 't', '{}', 't', 't')"],
  ['night_decisions', 'question_id', 'q_1', "INSERT INTO night_decisions (pipeline_id, question_id, kind, ts, record) VALUES ('c0ffee01', 'q_1', 'answer', 't', '{}')"],
];

const rungLabel = (r) => [...(r.cols ?? []).map(([t, c]) => `${t}.${c}`), ...(r.tables ?? []).map(([t]) => t)].join(', ');
const shapeOf = (db, t, c) => {
  const col = db.prepare(`PRAGMA table_info(${t})`).all().find((x) => x.name === c);
  return col && { type: col.type, notnull: col.notnull, dflt_value: col.dflt_value };
};
const schemaOf = (db) => ({
  columns: tableNames(db).flatMap((t) => colsOf(db, t).map((c) => `${t}.${c}`)).sort(),
  indexes: indexNames(db),
});

/**
 * A fully migrated :memory: DB with one row per host table, the rung's additions removed
 * (rows kept), stamped `stamp`, then ONE migrate() as a real process does at boot. Asserts
 * every addition is back with its declared shape, the rows survived with NULL/DEFAULT in the
 * restored columns, the whole schema equals a fresh DB's, and the stamp reads `expectStamp`.
 */
function climbAndCheck(rung, stamp, expectStamp) {
  const at = `v${rung.v} stamp ${stamp}`;
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db);
    const fresh = schemaOf(db);
    const freshShape = Object.fromEntries((rung.cols ?? []).map(([t, c]) => [`${t}.${c}`, shapeOf(db, t, c)]));
    const freshCols = Object.fromEntries((rung.tables ?? []).map(([t]) => [t, colsOf(db, t)]));
    for (const [, , , sql] of HOST_ROWS) db.exec(sql);
    for (const ix of rung.indexes ?? []) db.exec(`DROP INDEX ${ix}`);
    for (const [t] of rung.tables ?? []) db.exec(`DROP TABLE ${t}`);
    for (const [t, c] of rung.cols ?? []) db.exec(`ALTER TABLE ${t} DROP COLUMN ${c}`);
    for (const [t, c] of rung.cols ?? []) assert.ok(!colsOf(db, t).includes(c), `${at} ${t}.${c} removed (precondition)`);
    for (const [t] of rung.tables ?? []) assert.ok(!tableNames(db).includes(t), `${at} ${t} removed (precondition)`);
    db.exec(`PRAGMA user_version = ${stamp}`);

    migrate(db);

    assert.equal(db.prepare('PRAGMA user_version').get().user_version, expectStamp, `${at} stamped ${expectStamp}`);
    for (const [t, c, onRow] of rung.cols ?? []) {
      assert.deepEqual(shapeOf(db, t, c), freshShape[`${t}.${c}`], `${at} ${t}.${c} restored with its declared shape`);
      assert.equal(db.prepare(`SELECT ${c} AS v FROM ${t}`).get().v, onRow, `${at} ${t}.${c} on the existing row`);
    }
    for (const [t, idx] of rung.tables ?? []) {
      assert.deepEqual(colsOf(db, t), freshCols[t], `${at} ${t}.* restored with its exact column list`);
      for (const ix of idx) assert.ok(indexNames(db).includes(ix), `${at} ${t}.${ix} restored`);
    }
    for (const ix of rung.indexes ?? []) assert.ok(indexNames(db).includes(ix), `${at} ${ix} restored`);
    const removed = new Set((rung.tables ?? []).map(([t]) => t));
    for (const [t, c, kept] of HOST_ROWS) {
      if (removed.has(t)) continue;
      assert.equal(db.prepare(`SELECT ${c} AS v FROM ${t}`).get()?.v, kept, `${at} ${t}.${c} row kept`);
    }
    assert.deepEqual(schemaOf(db), fresh, `${at} schema equals a fresh DB's`);
  } finally {
    db.close();
  }
}

test('ladder: each incremental addition, removed (rows kept), is restored by one migrate from the rung below it and from its own rung, NULL/DEFAULT on existing rows, stamped SCHEMA_VERSION', async () => {
  const rows = RUNGS.filter((r) => r.v >= 25).flatMap((r) => [r.v - 1, r.v].map((stamp) => ({
    name: `v${r.v} stamp ${stamp} (${rungLabel(r)})`,
    run: () => climbAndCheck(r, stamp, SCHEMA_VERSION),
  })));
  assert.equal(rows.length, 20, 'ten rungs >= 25, two arms each');
  await checkRows(rows);
});

test('self-heal: each incremental addition, removed on a DB stamped past current, is restored by reconcileSchema and the stamp is not rewritten', async () => {
  // Stamped AT current takes the same fast path (user_version >= SCHEMA_VERSION), the
  // shape a reopen of an already-current home with a dropped column has.
  await checkRows(RUNGS.flatMap((r) => [SCHEMA_VERSION, SCHEMA_VERSION + 1].map((stamp) => ({
    name: `v${r.v} stamp ${stamp} (${rungLabel(r)})`,
    run: () => climbAndCheck(r, stamp, stamp),
  }))));
});

// A home missing a SIBLING table of the same DDL block: INCREMENTAL_TABLES maps schedules /
// scheduled_runs / notifications all to SCHEDULED_RUNS_DDL, so the tables loop re-execs the
// whole block, and its CREATE INDEX names after_id — the columns must be ALTERed in BEFORE
// that, not after (the plain tables -> columns -> indexes order still throws here).
test('a sibling table missing from the same DDL block: the re-run CREATE INDEX does not throw', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  dropAfter(db);
  db.exec('DROP TABLE notifications');
  db.exec('PRAGMA user_version = 33');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  for (const c of AFTER_COLS) assert.ok(scheduledRunCols(db).includes(c), c);
  assert.ok(hasAfterIndex(db));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notifications'").get(), 'the sibling is back');
  db.close();
});

// The same minimal seed the other migrate tests use: only the tables the incremental-
// column repair ALTERs.
const MINIMAL_SEED = `
  CREATE TABLE pipelines (id TEXT PRIMARY KEY);
  CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
`;

// v12 is a REPAIR migration for a cross-branch schema-version collision: another branch
// minted its own SCHEMA_VERSION=11 as a DATA-ONLY step and stamped the shared DB, so this
// branch's v11 DDL (ask_questions + step_questions) was skipped by the versioned fast path.
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

test('minimal pre-v15 seeds climb the whole ladder without duplicate-column/table errors and keep their rows', async () => {
  await checkRows([
    { name: 'incremental v9->v10 migration: migrate() adds columns on a v9 DB and stamps 12', run: () => {
      const db = new DatabaseSync(':memory:');
      // Apply V1 schema — a minimal pipelines table (just enough for ALTER TABLE to work)
      db.exec(`
        CREATE TABLE pipelines (
          id TEXT PRIMARY KEY,
          project_key TEXT NOT NULL DEFAULT '',
          workspace_key TEXT,
          target TEXT NOT NULL DEFAULT 'project',
          title TEXT,
          base_name TEXT,
          date_prefix TEXT,
          status TEXT NOT NULL DEFAULT 'created',
          phase TEXT NOT NULL DEFAULT 'created',
          cycle INTEGER NOT NULL DEFAULT 0,
          started_at TEXT,
          updated_at TEXT,
          total_cost_usd REAL NOT NULL DEFAULT 0,
          total_active_ms INTEGER NOT NULL DEFAULT 0,
          prompt TEXT,
          branch TEXT,
          workspace_meta TEXT,
          stepper TEXT,
          tools TEXT,
          resume_point TEXT,
          domain TEXT
        );
        CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, domain TEXT);
        CREATE TABLE IF NOT EXISTS config_workflow_nodes (project_key TEXT, workflow_id TEXT, node_id TEXT, model TEXT, effort TEXT, fan_out INTEGER, PRIMARY KEY (project_key,workflow_id,node_id));
        PRAGMA user_version = 9;
      `);
      // Insert a seed row — its new columns should come back as NULL
      db.prepare(`INSERT INTO pipelines (id, project_key) VALUES ('seed1', 'k1')`).run();

      // Now run the incremental migration
      migrate(db);

      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      const cols = db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name);
      for (const c of ['owner_pid', 'owner_host', 'heartbeat_at']) assert.ok(cols.includes(c), c);
      const row = db.prepare('SELECT owner_pid, owner_host, heartbeat_at FROM pipelines WHERE id = ?').get('seed1');
      assert.equal(row.owner_pid, null);
      assert.equal(row.owner_host, null);
      assert.equal(row.heartbeat_at, null);
    } },
    { name: 'repairs a stale-stamped v11 DB (version says 11, v11 DDL never ran)', run: () => {
      const db = new DatabaseSync(':memory:');
      db.exec(V10_NODES_SEED);
      db.exec('PRAGMA user_version = 11'); // stamped, but no ask_questions / step_questions
      db.prepare("INSERT INTO config_workflow_nodes (project_key, workflow_id, node_id, model) VALUES ('k1','wf1','n1','opus')").run();

      migrate(db);

      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      const cols = db.prepare('PRAGMA table_info(config_workflow_nodes)').all().map((c) => c.name);
      assert.ok(cols.includes('ask_questions'), 'repair added ask_questions');
      const tbl = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='step_questions'").get();
      assert.equal(tbl.n, 1, 'repair created step_questions');
      // Existing rows survive with the new column NULL (= inherit manifest default).
      const row = db.prepare('SELECT model, ask_questions FROM config_workflow_nodes WHERE node_id = ?').get('n1');
      assert.equal(row.model, 'opus');
      assert.equal(row.ask_questions, null);
    } },
    { name: 'no-op on a correctly-migrated v11 DB (no duplicate-column / existing-table errors)', run: () => {
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

      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      // Existing data in both v11 structures is untouched.
      assert.equal(db.prepare('SELECT ask_questions FROM config_workflow_nodes WHERE node_id = ?').get('n1').ask_questions, 1);
      assert.equal(db.prepare('SELECT count(*) AS n FROM step_questions').get().n, 1);
    } },
    { name: 'a v12-stamped DB upgrades: columns added, pre-existing rows backfill the default', run: () => {
      const db = new DatabaseSync(':memory:');
      db.exec(MINIMAL_SEED);
      db.prepare("INSERT INTO pipelines (id) VALUES ('pre')").run();
      db.exec('PRAGMA user_version = 12');

      migrate(db);

      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      const row = db.prepare("SELECT source_type, source_ref FROM pipelines WHERE id = 'pre'").get();
      assert.equal(row.source_type, 'prompt', 'legacy row reads the ALTER default');
      assert.equal(row.source_ref, null);
      const wfCols = db.prepare('PRAGMA table_info(workflows)').all().map((c) => c.name);
      assert.ok(wfCols.includes('origin'), 'workflows.origin added');
    } },
    { name: 'ladder from below 12 does not double-add the v13 columns', run: () => {
      // Guards the applySchemaV13-is-conditional design: from <12, applySchemaV12's heal
      // adds the v13 columns FIRST (they are in INCREMENTAL_COLUMNS); the v13 step must
      // then no-op. If someone "simplifies" it to a plain ALTER string, this throws.
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
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      const pipCols = db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name);
      assert.ok(pipCols.includes('source_type') && pipCols.includes('source_ref'));
    } },
    { name: 'a v13-stamped DB upgrades: column + table added, pre-existing rows read NULL', run: () => {
      const db = new DatabaseSync(':memory:');
      db.exec(MINIMAL_SEED);
      db.prepare("INSERT INTO pipelines (id) VALUES ('pre')").run();
      db.exec('PRAGMA user_version = 13');

      migrate(db);

      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      assert.equal(db.prepare("SELECT guardrails_id FROM pipelines WHERE id = 'pre'").get().guardrails_id, null,
        'legacy row reads NULL (selection unknown)');
      assert.equal(
        db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='guardrail_sets'").get().n,
        1, 'guardrail_sets created');
    } },
    { name: 'ladder from below 13 does not double-add the v14 additions (conditional-repair guard)', run: () => {
      const db = new DatabaseSync(':memory:');
      db.exec(MINIMAL_SEED);
      db.exec('PRAGMA user_version = 12');
      // From stamp 12 the ladder runs only the `current < 13` / `current < 14` steps
      // (applySchemaV12 does NOT run); applySchemaV13's conditional heal adds EVERY
      // INCREMENTAL_COLUMNS gap (including guardrails_id) and asserts the flagged
      // tables BEFORE the v14 step runs. If someone "simplifies" applySchemaV14 to a
      // plain ALTER/CREATE string, this throws "duplicate column" / "table already exists".
      migrate(db);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    } },
    { name: 'a v17-stamped DB upgrades in place: source_bindings created, stamp advances', run: () => {
      const db = new DatabaseSync(':memory:');
      db.exec('PRAGMA user_version = 17'); // pre-profiles DB: ladder runs only the v18 step

      migrate(db);

      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      assert.ok(hasBindings(db), 'source_bindings created');
    } },
    { name: 'ladder: a v19 DB gets ask_cost_ledger and is stamped current', run: () => {
      const db = new DatabaseSync(':memory:');
      db.exec(MINIMAL_SEED);
      db.exec('PRAGMA user_version = 19');
      migrate(db);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      assert.ok(tableNames(db).includes('ask_cost_ledger'), 'created by the ladder');
    } },
  ]);
});

test('a minimal or empty seed stamped current is healed by reconcileSchema: stamp untouched, partial gaps kept, healed columns carry their DEFAULT, no backfill', async () => {
  await checkRows([
    { name: 'fast-path reconcile heals missing column/table on a DB already stamped to the current version', run: () => {
      // Future-collision guard: a DB stamped AT (or past) the current version by some
      // divergent ladder still self-heals on the fast path, version-independently.
      const db = new DatabaseSync(':memory:');
      db.exec(V10_NODES_SEED);
      db.exec('CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT)'); // pre-`domain` shape
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`); // stamped current: the ladder must no-op...
      migrate(db);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamp untouched');
      // ...yet the incremental gaps are healed anyway.
      const nodeCols = db.prepare('PRAGMA table_info(config_workflow_nodes)').all().map((c) => c.name);
      assert.ok(nodeCols.includes('ask_questions'), 'ask_questions healed');
      const wfCols = db.prepare('PRAGMA table_info(workflows)').all().map((c) => c.name);
      assert.ok(wfCols.includes('domain'), 'workflows.domain healed');
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='step_questions'").get().n, 1, 'step_questions healed');
    } },
    { name: 'fast-path reconcile heals a current-stamped DB missing the v13 columns (partial gap)', run: () => {
      // Cross-branch stamp collision (the recorded hazard on INCREMENTAL_COLUMNS): a
      // divergent ladder stamped the shared DB AT the current version but this build's
      // columns are missing. migrate()'s fast path must heal them WITHOUT touching the stamp.
      const db = new DatabaseSync(':memory:');
      db.exec(MINIMAL_SEED);
      db.exec('ALTER TABLE pipelines ADD COLUMN source_ref TEXT'); // present; source_type + origin missing
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`); // stamped current: the ladder must no-op...

      migrate(db);

      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamp untouched');
      const pipCols = db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name);
      assert.ok(pipCols.includes('source_type'), 'source_type healed');
      assert.ok(pipCols.includes('source_ref'), 'pre-existing source_ref survived (no duplicate-column throw)');
      const wfCols = db.prepare('PRAGMA table_info(workflows)').all().map((c) => c.name);
      assert.ok(wfCols.includes('origin'), 'workflows.origin healed');
      // The HEALED column still carries its DEFAULT — proves the INCREMENTAL_COLUMNS
      // type string is "TEXT DEFAULT 'prompt'", not bare TEXT.
      db.prepare("INSERT INTO pipelines (id) VALUES ('x')").run();
      assert.equal(db.prepare("SELECT source_type FROM pipelines WHERE id = 'x'").get().source_type, 'prompt');
    } },
    { name: 'a current-stamped DB missing the additions is healed by the fast-path reconcile, stamp untouched', run: () => {
      const db = new DatabaseSync(':memory:');
      db.exec(MINIMAL_SEED);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`); // divergent-ladder stamp: version says done, schema says otherwise

      migrate(db); // fast path -> reconcileSchema self-heal

      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamp not rewritten');
      const pipCols = db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name);
      assert.ok(pipCols.includes('guardrails_id'), 'column healed');
      assert.equal(
        db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='guardrail_sets'").get().n,
        1, 'table healed');
    } },
    { name: 'a current-stamped DB missing the table is healed by the fast-path reconcile, stamp untouched', run: () => {
      const db = new DatabaseSync(':memory:');
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`); // divergent-ladder stamp: version says done, schema says otherwise

      migrate(db); // fast path -> reconcileSchema self-heal

      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamp not rewritten');
      assert.ok(hasBindings(db), 'table healed');
    } },
    { name: 'self-heal: a DB stamped current WITHOUT the table gets it from reconcileSchema, empty', run: () => {
      const db = new DatabaseSync(':memory:');
      db.exec(MINIMAL_SEED);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`); // divergent ladder: version says done, schema says otherwise
      migrate(db);                          // fast path → reconcileSchema
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamp not rewritten');
      assert.ok(tableNames(db).includes('ask_cost_ledger'), 'healed');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ask_cost_ledger').get().n, 0,
        'no backfill on the heal path (accepted, same as cost_ledger)');
    } },
  ]);
});

test('foreign keys enforce referential integrity (pipeline_steps -> pipelines)', () => {
  const db = getDb();
  // No such pipeline row -> inserting a child step must be rejected by the FK.
  const stmt = db.prepare(
    'INSERT INTO pipeline_steps (pipeline_id, key, status) VALUES (?, ?, ?)'
  );
  assert.throws(() => stmt.run('no-such-pipeline', '0:s0_0', 'start'), /FOREIGN KEY/i);
});

test('tx() commits, rolls back on throw, and refuses nesting', async () => {
  await checkRows([
    { name: 'tx() commits on success', run: () => {
      const db = getDb();
      // store_meta has no FK, so it is a clean target for a standalone write.
      const out = tx(() => {
        db.prepare("INSERT INTO store_meta (key, kind, data) VALUES (?, ?, ?)")
          .run('k-commit', 'project', '{"name":"x"}');
        return 'done';
      });
      assert.equal(out, 'done', 'tx() returns the callback result');
      const row = db.prepare('SELECT kind FROM store_meta WHERE key = ?').get('k-commit');
      assert.equal(row.kind, 'project', 'the inserted row is committed');
    } },
    { name: 'tx() rolls back on throw', run: () => {
      const db = getDb();
      assert.throws(() => {
        tx(() => {
          db.prepare("INSERT INTO store_meta (key, kind, data) VALUES (?, ?, ?)")
            .run('k-rollback', 'project', '{}');
          throw new Error('boom');
        });
      }, /boom/, 'the original error propagates');
      const row = db.prepare('SELECT key FROM store_meta WHERE key = ?').get('k-rollback');
      assert.equal(row, undefined, 'the partial write was rolled back');
    } },
    { name: 'tx() is not nestable by default (single-level transaction)', run: () => {
      const db = getDb();
      // A nested tx() would attempt a second BEGIN; assert tx() guards against it
      // rather than corrupting the outer transaction.
      assert.throws(() => {
        tx(() => {
          tx(() => {});
        });
      }, /transaction already active|nested/i);
    } },
  ]);
});

test('getDb() calls maybeMigrateFromFs(db) once after migrate()', () => {
  // A14: ESM namespace exports are non-configurable, so mock.method() throws
  // "Cannot redefine property". Instead the Phase-1 stub increments an exported
  // module-level call counter; we assert the OBSERVABLE effect (called exactly
  // once on first open) AND that the schema was already migrated when it ran
  // (user_version === 7 proves migrate() ran before the hook).
  assert.equal(_migrateFromFsCallCount(), 0, 'counter starts at 0 before first open');
  const db = getDb();
  assert.equal(_migrateFromFsCallCount(), 1, 'hook invoked exactly once on first open');
  // The schema must already exist when the hook runs (it reads/writes rows).
  const { user_version } = db.prepare('PRAGMA user_version').get();
  assert.equal(user_version, SCHEMA_VERSION, 'migrate() ran before the hook');
  // Cached singleton: a repeat getDb() must NOT re-run the one-shot hook.
  getDb();
  assert.equal(_migrateFromFsCallCount(), 1, 'hook not re-run on cached getDb()');
});

// ── M2 — concurrent first-launch CLI+UI race (spec §8) ────────────────────────────
// Two+ processes open the brand-new DB at once; each getDb() runs _configure (the
// journal_mode=WAL header switch) + migrate() (schema + user_version). Both need a
// brief exclusive lock, and the WAL-mode switch returns SQLITE_BUSY the busy-handler
// does NOT retry, so the unfixed code crashed a loser with "database is locked" or
// "table projects already exists". We launch N real child processes sharing this test's
// WORCA_HOME, released together by a wall-clock barrier to maximize overlap, and
// require ALL to open the DB without crashing.
//
// (A single-thread call-migrate()-twice test cannot express this race: migrate() re-
// reads user_version, so a sequential second call sees the committed version and no-ops
// — green even against the bug. Genuine concurrency is required.)
test('getDb() first-launch is concurrency-safe across N processes (no lock/exists crash)', async () => {
  const dbUrl = new URL('../src/core/db.mjs', import.meta.url).href;
  const N = 12;
  // Wall-clock barrier: all children open the DB at ~startAt to maximize overlap. This
  // can only WEAKEN the race (if a child spawns late it opens an already-migrated DB and
  // passes trivially) — it can never cause a false FAILURE. 700ms is ample headroom.
  const startAt = Date.now() + 700;
  const childScript = `
    const delay = Math.max(0, Number(process.env.__M2_START_AT__) - Date.now());
    import(${JSON.stringify(dbUrl)}).then(({ getDb }) => {
      setTimeout(() => {
        try { getDb(); process.exit(0); }
        catch (err) { console.error(String((err && err.message) || err)); process.exit(1); }
      }, delay);
    }).catch((err) => { console.error(String((err && err.message) || err)); process.exit(1); });
  `;
  const kids = Array.from({ length: N }, () => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', childScript], {
      env: { ...process.env, __M2_START_AT__: String(startAt) },
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => resolve({ code, err: err.trim().split('\n').filter(Boolean).pop() || '' }));
  }));
  const results = await Promise.all(kids);
  const failed = results.filter((r) => r.code !== 0);
  assert.equal(failed.length, 0,
    `all ${N} concurrent first-launch processes must open without crashing; failures: ` +
    failed.map((f) => f.err).join(' | '));

  // The shared DB is migrated exactly once: v2 stamped, exactly one projects table.
  const db = getDb();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'migrated to the current version');
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='projects'").get().n,
    1, 'exactly one projects table after the race');
});
